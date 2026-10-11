'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { OTP_CODE_LENGTH, OTP_EXPIRY_MINUTES, ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
  FORM_SCHEMAS,
  INDIAN_MOBILE_PATTERN,
  validateFormData,
  validatePincode,
  PostOfficeDetail,
  PINCODE_PATTERN,
  isDummyPincode,
} from '@/lib/validationSchemas';
import PasswordInput from '@/app/components/PasswordInput';
import type { UserRole, UserSession } from '@/lib/types';
import {
  Building2,
  Truck,
  Mail,
  Phone,
  Lock,
  ArrowRight,
  Zap,
  Layers,
  ShieldCheck,
  Key,
  Users,
  RotateCcw,
  MapPin,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';

const AUTH = UI_STRINGS.auth;
const MIN_PASSWORD_LENGTH = 8;

export default function LoginPage() {
  const router = useRouter();
  const {
    isLoggedIn,
    currentRole,
    currentUserSession,
    setCurrentRole,
    setIsLoggedIn,
    setCurrentUserSession,
    showToast,
    setRemainingFreeRFQs,
    setActiveSubscription,
    setInitialSetupModalOpen,
    initialSetupCompleted,
    addBuyerAccount,
  } = useApp();

  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);

  // Credentials are always verified server-side, so nothing is pre-filled.
  const [loginEmail, setLoginEmail] = useState('');
  const [loginMobile, setLoginMobile] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [buyerAuthMode, setBuyerAuthMode] = useState<'password' | 'email_otp'>('password');
  const [loginOtpSent, setLoginOtpSent] = useState(false);
  const [loginOtpInput, setLoginOtpInput] = useState('');

  const [regName, setRegName] = useState('');
  const [regOrgName, setRegOrgName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regGstin, setRegGstin] = useState('');
  const [regCity, setRegCity] = useState('');
  const [regState, setRegState] = useState('');
  const [regPincode, setRegPincode] = useState('');
  const [regPincodeError, setRegPincodeError] = useState<string | null>(null);
  const [regPincodeValidating, setRegPincodeValidating] = useState(false);
  const [regPincodePostOffices, setRegPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  const regPincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const raw = regPincode.trim();
    if (regPincodeDebounceRef.current) clearTimeout(regPincodeDebounceRef.current);
    if (!raw) {
      setRegPincodeError(null);
      setRegPincodeValidating(false);
      setRegPincodePostOffices([]);
      return;
    }
    if (isDummyPincode(raw)) {
      setRegPincodeError('Invalid or dummy PIN code');
      setRegPincodeValidating(false);
      setRegPincodePostOffices([]);
      return;
    }
    if (raw.length >= 3 && !PINCODE_PATTERN.test(raw)) {
      setRegPincodeError('Invalid PIN code format');
      setRegPincodeValidating(false);
      setRegPincodePostOffices([]);
      return;
    }
    if (/^\d{6}$/.test(raw)) {
      setRegPincodeValidating(true);
      regPincodeDebounceRef.current = setTimeout(async () => {
        try {
          const res = await validatePincode(raw);
          if (!res.isValid) {
            setRegPincodeError(res.message || 'Invalid PIN code');
            setRegPincodePostOffices([]);
          } else {
            setRegPincodeError(null);
            const pos = res.postOffices || [];
            setRegPincodePostOffices(pos);
            if (pos.length > 0) {
              const primaryPo = pos[0];
              const matchedCity = primaryPo.District || primaryPo.Division || primaryPo.Name || '';
              const matchedState = primaryPo.State || '';
              if (matchedCity) setRegCity(matchedCity);
              if (matchedState) setRegState(matchedState);
            }
          }
        } catch {
          setRegPincodeError(null);
        } finally {
          setRegPincodeValidating(false);
        }
      }, 350);
    } else {
      setRegPincodeError(null);
      setRegPincodeValidating(false);
      setRegPincodePostOffices([]);
    }
  }, [regPincode]);
  const [selectedRegRole, setSelectedRegRole] = useState<'buyer' | 'vendor'>('buyer');
  const [regStep, setRegStep] = useState<'form' | 'dual_otp'>('form');
  const [regEmailOtp, setRegEmailOtp] = useState('');
  const [regMobileOtp, setRegMobileOtp] = useState('');

  // Someone already signed in should not sit on the sign-in screen.
  useEffect(() => {
    if (isLoggedIn) {
      const destination =
        currentUserSession?.role === 'vendor' && currentUserSession.passwordChangeRequired
          ? '/vendor-first-login'
          : ROLE_LANDING_ROUTE[currentRole] || ROLE_LANDING_ROUTE.buyer;
      router.replace(destination);
    }
  }, [isLoggedIn, currentRole, currentUserSession, router]);

  /**
   * Commit a verified session and route to the landing screen for its role.
   * The role always comes from the account record, never the UI selection.
   */
  const establishSession = (user: UserSession) => {
    setCurrentUserSession(user);
    setIsLoggedIn(true);
    setCurrentRole(user.role);
    showToast(
      AUTH.welcomeBackTitle,
      formatString(AUTH.signedInAs, {
        userName: user.name,
        userRole: user.role,
        orgName: user.orgName || '',
      }),
      'success'
    );
    router.replace(
      user.role === 'vendor' && user.passwordChangeRequired
        ? '/vendor-first-login'
        : ROLE_LANDING_ROUTE[user.role] || ROLE_LANDING_ROUTE.buyer
    );
  };

  const fail = (title: string, error?: string) => showToast(title, error || AUTH.serverErrorFallback, 'warning');

  // ── Password sign-in (all roles) ───────────────────────────────────────────
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const email = loginEmail.trim();
    const mobile = loginMobile.trim();

    if (!email || !mobile || !loginPassword) {
      showToast(AUTH.missingFieldsTitle, AUTH.loginFieldsRequired, 'warning');
      return;
    }

    // Formats are checked against the centralized login schema before a request
    // is made, so a malformed mobile number never reaches the identity lookup.
    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.loginForm, {
      email,
      mobile,
      password: loginPassword,
    });
    if (!isValid) {
      showToast(AUTH.signInFailedTitle, Object.values(fieldErrors)[0], 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const response = await authClient.loginWithPassword(email.toLowerCase(), loginPassword, mobile);
      if (response.success && response.user) {
        if (response.user.role === 'buyer' && !initialSetupCompleted) {
          setInitialSetupModalOpen(true);
        }
        establishSession(response.user);
      } else {
        fail(AUTH.signInFailedTitle, response.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Email OTP sign-in ──────────────────────────────────────────────────────
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    const rawMobile = loginMobile.trim();
    const mobile = rawMobile.replace(/[\s\-()]/g, '');

    // The identity service issues the code against the email + mobile pair, so
    // both are required before a code can be requested.
    if (!loginEmail.trim() || !mobile) {
      showToast(AUTH.missingFieldsTitle, AUTH.emailAndMobileRequired, 'warning');
      return;
    }
    if (!INDIAN_MOBILE_PATTERN.test(mobile)) {
      showToast(AUTH.otpRequestFailedTitle, AUTH.mobileInvalid, 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const email = loginEmail.trim().toLowerCase();
      const response = await authClient.requestOtp(
        email,
        mobile
      );
      if (!response.success) {
        fail(AUTH.otpRequestFailedTitle, response.error);
        return;
      }
      setLoginOtpInput(response.demoCode || '');
      setLoginOtpSent(true);
      showToast(
        AUTH.welcomeBackTitle,
        formatString(AUTH.otpDispatched, {
          email,
          codeLength: OTP_CODE_LENGTH,
          expiryMinutes: OTP_EXPIRY_MINUTES,
        }) + (response.demoCode ? ` (Dev OTP: ${response.demoCode})` : ''),
        'success'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendLoginOtp = async () => {
    if (submitting) return;
    const email = loginEmail.trim().toLowerCase();
    const mobile = loginMobile.trim().replace(/[\s\-()]/g, '');
    if (!email || !mobile) {
      showToast(AUTH.missingFieldsTitle, AUTH.emailAndMobileRequired, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const response = await authClient.requestOtp(
        email,
        mobile
      );
      if (!response.success) {
        fail(AUTH.otpRequestFailedTitle, response.error);
        return;
      }
      if (response.demoCode) {
        setLoginOtpInput(response.demoCode);
      }
      showToast(
        'OTP Resent',
        `Fresh verification code dispatched to ${email}` + (response.demoCode ? ` (Dev OTP: ${response.demoCode})` : ''),
        'success'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (loginOtpInput.trim().length !== OTP_CODE_LENGTH) {
      showToast(AUTH.otpInvalidTitle, AUTH.otpRequired, 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const response = await authClient.verifyOtp(
        loginEmail.trim().toLowerCase(),
        loginOtpInput.trim(),
        loginMobile.trim()
      );
      if (response.success && response.user) {
        if (response.user.role === 'buyer' && !initialSetupCompleted) {
          setInitialSetupModalOpen(true);
        }
        establishSession(response.user);
      } else {
        fail(AUTH.otpInvalidTitle, response.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Registration: Step 1 Validate details & request OTPs ──────────────────
  const handleInitiateRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    const rawMobile = regMobile.trim();
    const mobile = rawMobile.replace(/[\s\-()]/g, '');

    if (
      !regName.trim() ||
      !regOrgName.trim() ||
      !regEmail.trim() ||
      !mobile ||
      !regPassword ||
      !regGstin.trim() ||
      !regCity.trim() ||
      !regState.trim() ||
      !regPincode.trim()
    ) {
      showToast(AUTH.missingFieldsTitle, 'Please fill in all mandatory fields including Company Name, GSTIN, City, State, and Pincode.', 'warning');
      return;
    }
    if (regPassword.length < MIN_PASSWORD_LENGTH) {
      showToast(AUTH.registrationFailedTitle, AUTH.passwordTooShort, 'warning');
      return;
    }
    if (!INDIAN_MOBILE_PATTERN.test(mobile)) {
      showToast(AUTH.registrationFailedTitle, AUTH.mobileInvalid, 'warning');
      return;
    }
    if (!/^[1-9][0-9]{5}$/.test(regPincode.trim())) {
      showToast(AUTH.registrationFailedTitle, 'PIN Code must be 6 digits and cannot start with 0.', 'warning');
      return;
    }
    if (regPincodeError) {
      showToast(AUTH.registrationFailedTitle, regPincodeError, 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const email = regEmail.trim().toLowerCase();
      const response = await authClient.requestOtp(
        email,
        mobile,
        selectedRegRole,
        true
      );

      if (!response.success) {
        fail(AUTH.registrationFailedTitle, response.error);
        return;
      }

      setRegStep('dual_otp');
      setRegEmailOtp(response.demoEmailCode || response.demoCode || '');
      setRegMobileOtp(response.demoMobileCode || response.demoCode || '');
      showToast(
        'Verification Codes Sent',
        `6-digit OTPs have been dispatched to ${email} (Email OTP) and mobile +91 ${mobile} (SMS OTP).`,
        'success'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendRegOtp = async () => {
    if (submitting) return;
    const email = regEmail.trim().toLowerCase();
    const mobile = regMobile.trim().replace(/[\s\-()]/g, '');
    if (!email || !mobile) {
      showToast(AUTH.missingFieldsTitle, AUTH.registrationFieldsRequired, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const response = await authClient.requestOtp(
        email,
        mobile,
        selectedRegRole,
        true
      );
      if (!response.success) {
        fail(AUTH.registrationFailedTitle, response.error);
        return;
      }
      if (response.demoEmailCode || response.demoCode) {
        setRegEmailOtp(response.demoEmailCode || response.demoCode || '');
      }
      if (response.demoMobileCode || response.demoCode) {
        setRegMobileOtp(response.demoMobileCode || response.demoCode || '');
      }
      showToast(
        'OTPs Resent',
        `Fresh separate 6-digit OTPs sent to ${email} and +91 ${mobile}.`,
        'success'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Registration: Step 2 Verify Both Email OTP & Mobile OTP and create account ──────────
  const handleVerifyAndCompleteRegistration = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailOtp = regEmailOtp.trim();
    const mobileOtp = regMobileOtp.trim();

    if (emailOtp.length !== OTP_CODE_LENGTH || mobileOtp.length !== OTP_CODE_LENGTH) {
      showToast('Both OTPs Required', 'Please enter both the 6-digit Email OTP and the 6-digit Mobile SMS OTP.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const email = regEmail.trim().toLowerCase();
      const response = await authClient.register({
        name: regName.trim(),
        email,
        password: regPassword,
        mobile: regMobile.trim(),
        role: selectedRegRole,
        orgName: regOrgName.trim() || regName.trim(),
        city: regCity.trim(),
        state: regState.trim(),
        pincode: regPincode.trim(),
        gstin: regGstin.trim().toUpperCase(),
        emailOtp,
        mobileOtp,
        code: mobileOtp || emailOtp,
      });

      if (!response.success || !response.user) {
        fail(AUTH.registrationFailedTitle, response.error);
        return;
      }

      if (selectedRegRole === 'buyer') {
        addBuyerAccount({
          organizationName: regOrgName.trim() || response.user.orgName || regName.trim(),
          brandName: regOrgName.trim() || regName.trim(),
          corporateEmail: email,
          contactPerson: regName.trim(),
          contactDesignation: 'Procurement Specialist',
          mobileNumber: regMobile.trim(),
          gstin: regGstin.trim().toUpperCase(),
          primaryPlantLocation: `${regCity.trim()}, ${regState.trim()} (${regPincode.trim()})`,
          city: regCity.trim(),
          state: regState.trim(),
          pincode: regPincode.trim(),
          industrySector: 'Enterprise SCM & Manufacturing',
          sourcingMode: 'mode_2',
          subscriptionPlan: 'free_trial',
          remainingFreeRFQs: 5,
          accountSource: 'web_registration',
          status: 'ACTIVE_VERIFIED',
          supportedMajorCategories: [],
          supportedMinorCategories: [],
          totalRFQsCreated: 0,
          totalSpend: '₹0',
        });

        setActiveSubscription('free_trial');
        setRemainingFreeRFQs(5);
        setInitialSetupModalOpen(true);
      }

      showToast(
        AUTH.registrationSuccessTitle,
        formatString(AUTH.registrationSuccessMessage, { email }),
        'success'
      );
      establishSession(response.user);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldLabel = 'text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450';
  const iconClass = 'absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none';
  const fieldInput = 'has-leading-icon text-xs';
  const plainInput = 'text-xs !pl-2.5 !pr-2';
  const otpInput = 'has-leading-icon text-xs font-mono font-bold tracking-widest text-center';
  const primaryBtn =
    'btn btn-primary w-full text-xs font-bold py-2.5 flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed';

  const otpModeActive = buyerAuthMode === 'email_otp';

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row min-h-[500px]">

        {/* ── Left Panel: Branding ── */}
        <div className="md:w-1/2 bg-gradient-to-br from-[#011638] via-[#074193] to-[#0a111e] text-white p-8 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#00dbff]/15 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#ff4800]/10 rounded-full blur-3xl" />

          <div className="relative z-10 flex items-center">
            <img
              src="/qua-ai-logo.jpeg"
              alt="Qua AI Logo"
              className="h-20 sm:h-24 w-auto rounded-3xl shadow-xl border border-white/30 object-contain bg-white"
            />
          </div>

          <div className="space-y-6 my-8 relative z-10">
            <h2 className="text-xl sm:text-2xl font-black leading-tight text-white drop-shadow-md">
              Enterprise AI Sourcing &amp; Logistics Matching Roster
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded-lg bg-[#ff4800]/25 text-[#ff4800] mt-0.5 shrink-0">
                  <Zap size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Mode 1, 2, and 3 Sourcing Engines</h4>
                  <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                    Deploy flexible private rosters, hybrid base networks, or 360-degree AI evaluations dynamically.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded-lg bg-[#00dbff]/25 text-[#00dbff] mt-0.5 shrink-0">
                  <Layers size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Automated Chaser Outreach</h4>
                  <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                    Sequenced SMS, Voice Bot Calls, and WhatsApp follow-ups governed strictly by IST working-hour rules.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded-lg bg-[#ff00ff]/25 text-[#ff00ff] mt-0.5 shrink-0">
                  <ShieldCheck size={14} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">OCR Ingestion &amp; Audit Trails</h4>
                  <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                    Autonomous quote extraction from incoming emails with secure cryptographic logging.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="text-[10px] text-[#00dbff] relative z-10 flex justify-between items-center font-semibold">
            <span>Security Level: SHA-256 Compliant</span>
            <span>v2.4.1</span>
          </div>
        </div>

        {/* ── Right Panel: Forms ── */}
        <div className="md:w-1/2 p-8 flex flex-col justify-between bg-white dark:bg-gray-900/40">
          <div className="flex justify-center items-center gap-3 mb-2">
            <img src="/procucev-logo.png" alt="Procucev Logo" className="h-12 w-auto object-contain" />
            <div className="h-7 w-[1px] bg-slate-200 shrink-0" />
            <img src="/qua-ai-logo.jpeg" alt="Qua AI Logo" className="h-9 w-auto object-contain rounded" />
          </div>

          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-gray-800">
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => { setAuthTab('login'); setLoginOtpSent(false); }}
                className={`text-sm font-black pb-2 transition-all ${authTab === 'login'
                    ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                    : 'text-slate-400 dark:text-gray-500 hover:text-slate-600'
                  }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setAuthTab('register'); setLoginOtpSent(false); }}
                className={`text-sm font-black pb-2 transition-all ${authTab === 'register'
                    ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                    : 'text-slate-400 dark:text-gray-500 hover:text-slate-600'
                  }`}
              >
                Create Account
              </button>
            </div>
          </div>

          <div className="my-auto py-6 space-y-4">
            {authTab === 'login' ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-800 dark:text-white">Welcome back</h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                    Sign in with your Procucev account. Credentials are verified against the enterprise user directory.
                  </p>
                </div>

                {/* Auth method switcher */}
                <div className="flex rounded-xl bg-slate-100 dark:bg-gray-800/80 p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => { setBuyerAuthMode('password'); setLoginOtpSent(false); }}
                      className={`flex-1 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1 ${buyerAuthMode === 'password'
                          ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      <Lock size={12} /> Password
                    </button>
                    <button
                      type="button"
                      onClick={() => { setBuyerAuthMode('email_otp'); setLoginOtpSent(false); }}
                      className={`flex-1 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1 ${buyerAuthMode === 'email_otp'
                          ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                      <Mail size={12} /> Email OTP
                    </button>
                  </div>

                {!otpModeActive ? (
                  /* PASSWORD SIGN-IN */
                  <form onSubmit={handlePasswordLogin} className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor="login-email" className={fieldLabel}>Registered Email ID</label>
                      <div className="relative">
                        <Mail className={iconClass} size={14} />
                        <input
                          id="login-email"
                          type="email"
                          autoComplete="username"
                          placeholder="you@company.com"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          className={fieldInput}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="login-mobile" className={fieldLabel}>Registered Mobile Number</label>
                      <div className="relative">
                        <Phone className={iconClass} size={14} />
                        <input
                          id="login-mobile"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel"
                          placeholder="e.g. 9811223344"
                          value={loginMobile}
                          onChange={(e) => setLoginMobile(e.target.value)}
                          className={fieldInput}
                          required
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 italic block mt-0.5">
                        Must match the mobile number on your account record. It is verified together with your email and password.
                      </span>
                    </div>

                    <PasswordInput
                      id="login-password"
                      label="Password"
                      placeholder="Enter your password"
                      value={loginPassword}
                      onChange={setLoginPassword}
                      autoComplete="current-password"
                      required
                    />

                    <button type="submit" disabled={submitting} className={primaryBtn}>
                      {submitting ? 'Verifying...' : 'Sign In'} <ArrowRight size={14} />
                    </button>
                  </form>
                ) : !loginOtpSent ? (
                  /* REQUEST OTP */
                  <form onSubmit={handleRequestOtp} className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor="otp-email" className={fieldLabel}>Registered Email ID</label>
                      <div className="relative">
                        <Mail className={iconClass} size={14} />
                        <input
                          id="otp-email"
                          type="email"
                          autoComplete="username"
                          placeholder="you@company.com"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          className={fieldInput}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="otp-mobile" className={fieldLabel}>Registered Mobile Number</label>
                      <div className="relative">
                        <Phone className={iconClass} size={14} />
                        <input
                          id="otp-mobile"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel"
                          placeholder="e.g. 9811223344"
                          value={loginMobile}
                          onChange={(e) => setLoginMobile(e.target.value)}
                          className={fieldInput}
                          required
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 italic block mt-0.5">
                        A {OTP_CODE_LENGTH}-digit code is emailed to your registered address and expires in{' '}
                        {OTP_EXPIRY_MINUTES} minutes. The code is tied to this email and mobile number pair.
                      </span>
                    </div>

                    <button type="submit" disabled={submitting} className={primaryBtn}>
                      {submitting ? 'Sending...' : 'Request Login OTP'} <ArrowRight size={14} />
                    </button>
                  </form>
                ) : (
                  /* VERIFY OTP */
                  <form onSubmit={handleVerifyOtp} className="space-y-3">
                    <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-[11px] text-indigo-700 dark:text-indigo-300 border border-indigo-200/60">
                      A verification code has been emailed to <strong>{loginEmail}</strong>. Enter it below to sign in.
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="otp-code" className={fieldLabel}>Email Verification Code (OTP)</label>
                      <div className="relative">
                        <Key className={iconClass} size={14} />
                        <input
                          id="otp-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder={`${OTP_CODE_LENGTH}-digit code`}
                          value={loginOtpInput}
                          onChange={(e) => setLoginOtpInput(e.target.value)}
                          className={otpInput}
                          maxLength={OTP_CODE_LENGTH}
                          required
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <button
                        type="button"
                        onClick={handleResendLoginOtp}
                        disabled={submitting}
                        className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1"
                      >
                        <RotateCcw size={12} className={submitting ? 'animate-spin' : ''} />
                        <span>Resend OTP</span>
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <button type="button" onClick={() => setLoginOtpSent(false)} className="btn btn-secondary text-xs w-1/3 py-2.5">
                        Back
                      </button>
                      <button type="submit" disabled={submitting} className={`${primaryBtn} w-2/3`}>
                        {submitting ? 'Verifying...' : 'Verify & Sign In'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : (
              /* ── REGISTER ── */
              <div className="space-y-4">
                {/* Role Switcher for Registration */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-gray-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedRegRole('buyer');
                      setRegStep('form');
                    }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${selectedRegRole === 'buyer'
                        ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-500 dark:text-gray-400 hover:text-slate-700'
                      }`}
                  >
                    <Building2 size={13} />
                    <span>Buyer</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedRegRole('vendor');
                      setRegStep('form');
                    }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${selectedRegRole === 'vendor'
                        ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-500 dark:text-gray-400 hover:text-slate-700'
                      }`}
                  >
                    <Truck size={13} />
                    <span>Vendor Partner</span>
                  </button>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-800 dark:text-white">
                      {selectedRegRole === 'buyer' ? 'Create Buyer Account' : 'Create Vendor Partner Account'}
                    </h3>
                    <span className="badge badge-amber font-bold text-[10px]">
                      {selectedRegRole === 'buyer' ? '5 Free RFQs' : '5 Free Quotes'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                    {selectedRegRole === 'buyer'
                      ? 'Your account is created in the Procucev enterprise user directory and works across every Procucev application.'
                      : 'Join the verified supplier roster and respond to live enterprise RFQs with free quotation credits.'}
                  </p>
                </div>

                {regStep === 'form' ? (
                  <form onSubmit={handleInitiateRegister} className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor="reg-name" className={fieldLabel}>
                        {selectedRegRole === 'buyer' ? 'Full Name / Procurement Lead' : 'Authorized Representative Name'}
                      </label>
                      <div className="relative">
                        <Users className={iconClass} size={14} />
                        <input
                          id="reg-name"
                          type="text"
                          autoComplete="name"
                          placeholder={selectedRegRole === 'buyer' ? 'e.g. Navin Chaudhary' : 'e.g. Rajesh Kumar'}
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                          className={fieldInput}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="reg-org" className={fieldLabel}>
                        {selectedRegRole === 'buyer' ? 'Company Name / Legal Name' : 'Vendor Enterprise / Company Name'} <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Building2 className={iconClass} size={14} />
                        <input
                          id="reg-org"
                          type="text"
                          autoComplete="organization"
                          placeholder={
                            selectedRegRole === 'buyer'
                              ? 'e.g. Larsen & Toubro Procurement'
                              : 'e.g. Precision Engineering Works Pvt Ltd'
                          }
                          value={regOrgName}
                          onChange={(e) => setRegOrgName(e.target.value)}
                          className={fieldInput}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="reg-gstin" className={fieldLabel}>
                        GSTIN / GST Number <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <FileText className={iconClass} size={14} />
                        <input
                          id="reg-gstin"
                          type="text"
                          placeholder="e.g. 27AAAAA0000A1Z5"
                          value={regGstin}
                          onChange={(e) => setRegGstin(e.target.value.toUpperCase())}
                          className={`${fieldInput} font-mono uppercase`}
                          maxLength={15}
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 items-start">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between min-h-[16px]">
                          <label htmlFor="reg-pincode" className={fieldLabel}>
                            Pincode <span className="text-red-500">*</span>
                          </label>
                          {regPincodeValidating && (
                            <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                              <Loader2 size={10} className="animate-spin" /> Checking
                            </span>
                          )}
                          {!regPincodeValidating && regPincodePostOffices.length > 0 && !regPincodeError && (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                              <CheckCircle2 size={10} /> Valid
                            </span>
                          )}
                          {!regPincodeValidating && regPincodeError && regPincode.trim().length >= 6 && (
                            <span className="text-[10px] font-bold text-rose-500 flex items-center gap-0.5">
                              <AlertCircle size={10} /> Invalid
                            </span>
                          )}
                        </div>
                        <input
                          id="reg-pincode"
                          type="text"
                          placeholder="e.g. 411001"
                          value={regPincode}
                          onChange={(e) => setRegPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          className={`${plainInput} font-mono w-full ${
                            regPincodeError ? 'border-red-400 dark:border-red-700' : ''
                          }`}
                          maxLength={6}
                          required
                        />
                        {regPincodeError && regPincode.trim().length >= 6 && (
                          <p className="text-[10px] text-rose-500 font-medium">{regPincodeError}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center min-h-[16px]">
                          <label htmlFor="reg-city" className={fieldLabel}>
                            City <span className="text-red-500">*</span>
                          </label>
                        </div>
                        <input
                          id="reg-city"
                          type="text"
                          placeholder="e.g. Pune"
                          value={regCity}
                          onChange={(e) => setRegCity(e.target.value)}
                          className={`${plainInput} w-full`}
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center min-h-[16px]">
                          <label htmlFor="reg-state" className={fieldLabel}>
                            State <span className="text-red-500">*</span>
                          </label>
                        </div>
                        <input
                          id="reg-state"
                          type="text"
                          placeholder="e.g. Maharashtra"
                          value={regState}
                          onChange={(e) => setRegState(e.target.value)}
                          className={`${plainInput} w-full`}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="reg-email" className={fieldLabel}>Corporate Email ID <span className="text-red-500">*</span></label>
                      <div className="relative">
                        <Mail className={iconClass} size={14} />
                        <input
                          id="reg-email"
                          type="email"
                          autoComplete="email"
                          placeholder={selectedRegRole === 'buyer' ? 'buyer@company.com' : 'vendor@supplier.com'}
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          className={fieldInput}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="reg-mobile" className={fieldLabel}>Mobile Number (WhatsApp Enabled) <span className="text-red-500">*</span></label>
                      <div className="relative">
                        <Phone className={iconClass} size={14} />
                        <input
                          id="reg-mobile"
                          type="tel"
                          autoComplete="tel"
                          placeholder="e.g. 9811223344"
                          value={regMobile}
                          onChange={(e) => setRegMobile(e.target.value)}
                          className={fieldInput}
                          required
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 italic block mt-0.5">
                        Stored as +91XXXXXXXXXX and used for WhatsApp and SMS notifications.
                      </span>
                    </div>

                    <PasswordInput
                      id="reg-password"
                      label="Password"
                      placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                      value={regPassword}
                      onChange={setRegPassword}
                      autoComplete="new-password"
                      minLength={MIN_PASSWORD_LENGTH}
                      required
                    />

                    <button type="submit" disabled={submitting} className={primaryBtn} aria-label="Create Account">
                      <span>Create Account</span> <ArrowRight size={14} />
                    </button>
                  </form>
                ) : (
                  /* ── Dual Email & Mobile OTP Verification Step ── */
                  <form onSubmit={handleVerifyAndCompleteRegistration} className="space-y-4 animate-fade-in">
                    <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/60 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                        <ShieldCheck size={14} />
                        <span>Dual OTP Identity Verification</span>
                      </div>
                      <p className="text-[11px] text-indigo-600/90 dark:text-indigo-300/80 leading-relaxed">
                        To protect your account, enter both the 6-digit codes sent to your corporate email and mobile number.
                      </p>
                    </div>

                    {/* Email OTP Field */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label htmlFor="reg-email-otp" className={fieldLabel}>
                          1. Email Verification Code (OTP) (Sent to {regEmail.toLowerCase()})
                        </label>
                      </div>
                      <div className="relative">
                        <Mail className={iconClass} size={14} />
                        <input
                          id="reg-email-otp"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="6-digit Email OTP"
                          value={regEmailOtp}
                          onChange={(e) => setRegEmailOtp(e.target.value)}
                          className={otpInput}
                          maxLength={OTP_CODE_LENGTH}
                          required
                        />
                      </div>
                    </div>

                    {/* Mobile OTP Field */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label htmlFor="reg-mobile-otp" className={fieldLabel}>
                          2. Mobile OTP (SMS sent to +91 {regMobile})
                        </label>
                      </div>
                      <div className="relative">
                        <Phone className={iconClass} size={14} />
                        <input
                          id="reg-mobile-otp"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="6-digit Mobile OTP"
                          value={regMobileOtp}
                          onChange={(e) => setRegMobileOtp(e.target.value)}
                          className={otpInput}
                          maxLength={OTP_CODE_LENGTH}
                          required
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <button
                        type="button"
                        onClick={handleResendRegOtp}
                        disabled={submitting}
                        className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1"
                      >
                        <RotateCcw size={12} className={submitting ? 'animate-spin' : ''} />
                        <span>Resend Verification Codes</span>
                      </button>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setRegStep('form')}
                        className="btn btn-secondary text-xs w-1/3 py-2.5"
                      >
                        Back
                      </button>
                      <button type="submit" disabled={submitting} className={`${primaryBtn} w-2/3`}>
                        {submitting ? 'Activating...' : 'Verify & Activate Account'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>

          <div className="text-[10px] text-slate-400 text-center border-t border-slate-100 dark:border-gray-800 pt-3">
            Connected to the secure enterprise SSL gateway. Unauthorized access is recorded.
          </div>
        </div>
      </div>
    </div>
  );
}
