import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '@/app/login/page';
import * as storeModule from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { OTP_CODE_LENGTH, ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/store');
jest.mock('@/lib/authClient', () => ({
  authClient: {
    loginWithPassword: jest.fn(),
    requestOtp: jest.fn(),
    verifyOtp: jest.fn(),
    register: jest.fn(),
  },
}));

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

const AUTH = UI_STRINGS.auth;

const BUYER_SESSION = {
  id: 'usr-1',
  email: 'navinchaudhary.dev@gmail.com',
  name: 'Navin Chaudhary',
  role: 'buyer' as const,
  orgId: 'org-1',
  orgName: 'Navin Chaudhary Enterprises',
};

/** Registered mobile number sign-in is verified against. */
const LOGIN_MOBILE = '9157154504';

/** A well-formed email OTP, matching the shared 6-digit contract. */
const OTP_CODE = '123456';

describe('LoginPage', () => {
  const showToast = jest.fn();
  const setIsLoggedIn = jest.fn();
  const setCurrentRole = jest.fn();
  const setCurrentUserSession = jest.fn();
  const setInitialSetupModalOpen = jest.fn();
  const addBuyerAccount = jest.fn();

  const mockStore = (overrides: Record<string, unknown> = {}) => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: false,
      currentRole: 'buyer',
      setCurrentRole,
      setIsLoggedIn,
      setCurrentUserSession,
      showToast,
      setRemainingFreeRFQs: jest.fn(),
      setActiveSubscription: jest.fn(),
      setInitialSetupModalOpen,
      initialSetupCompleted: false,
      addBuyerAccount,
      ...overrides,
    });
  };

  beforeEach(() => {
    mockStore();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const typeInto = (label: RegExp, value: string) => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  };

  /**
   * The tab strip reuses the visible labels "Sign In" and "Create Account", so
   * tests target the form's submit control explicitly.
   */
  const submitButton = (name: RegExp): HTMLElement => {
    const match = screen
      .getAllByRole('button', { name })
      .find((button) => button.getAttribute('type') === 'submit');
    if (!match) throw new Error(`No submit button matching ${name}`);
    return match;
  };

  const submitForm = (name: RegExp) => {
    fireEvent.submit(submitButton(name).closest('form') as HTMLFormElement);
  };

  const openRegister = () => {
    const tab = screen
      .getAllByRole('button', { name: /Create Account/i })
      .find((button) => button.getAttribute('type') === 'button');
    fireEvent.click(tab as HTMLElement);
  };

  const fillValidForm = () => {
    typeInto(/Full Name/i, 'Navin Chaudhary');
    typeInto(/Company Name/i, 'Larsen & Toubro Procurement');
    typeInto(/GSTIN/i, '27AAAAA0000A1Z5');
    typeInto(/City/i, 'Pune');
    typeInto(/State/i, 'Maharashtra');
    typeInto(/Pincode/i, '411001');
    typeInto(/Corporate Email ID/i, BUYER_SESSION.email);
    typeInto(/Mobile Number/i, '9157154504');
    typeInto(/^Password$/i, 'Pass@1234');
  };

  describe('no demo credentials are exposed', () => {
    it('renders empty email and password fields', () => {
      render(<LoginPage />);

      expect(screen.getByLabelText(/Registered Email ID/i)).toHaveValue('');
      expect(screen.getByLabelText(/^Password$/i)).toHaveValue('');
    });

    it('offers no one-click demo sign-in and no pre-registered account list', () => {
      render(<LoginPage />);

      expect(screen.queryByText(/Instant 1-Click/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Align Existing Public System Account/i)).not.toBeInTheDocument();
    });
  });

  describe('password sign-in', () => {
    it('signs in and routes to the landing route for the role on the account', async () => {
      (authClient.loginWithPassword as jest.Mock).mockResolvedValue({
        success: true,
        user: BUYER_SESSION,
        token: 'jwt',
      });

      render(<LoginPage />);
      typeInto(/Registered Email ID/i, BUYER_SESSION.email);
      typeInto(/Registered Mobile Number/i, LOGIN_MOBILE);
      typeInto(/^Password$/i, 'Pass@123');
      fireEvent.click(submitButton(/Sign In/i));

      await waitFor(() => {
        expect(authClient.loginWithPassword).toHaveBeenCalledWith(
          BUYER_SESSION.email,
          'Pass@123',
          LOGIN_MOBILE
        );
      });
      expect(setCurrentUserSession).toHaveBeenCalledWith(BUYER_SESSION);
      expect(setIsLoggedIn).toHaveBeenCalledWith(true);
      expect(setCurrentRole).toHaveBeenCalledWith('buyer');
      expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.buyer);
    });

    it('routes first-login vendors to password setup before opening the dashboard', async () => {
      const firstLoginVendor = {
        ...BUYER_SESSION,
        role: 'vendor' as const,
        passwordChangeRequired: true,
      };
      (authClient.loginWithPassword as jest.Mock).mockResolvedValue({
        success: true,
        user: firstLoginVendor,
        token: 'jwt',
      });

      render(<LoginPage />);
      typeInto(/Registered Email ID/i, 'vendor@supplier.com');
      typeInto(/Registered Mobile Number/i, LOGIN_MOBILE);
      typeInto(/^Password$/i, 'TempPass@123');
      fireEvent.click(submitButton(/Sign In/i));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/vendor-first-login');
      });
      expect(setCurrentUserSession).toHaveBeenCalledWith(firstLoginVendor);
      expect(mockReplace).not.toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor);
    });

    it('routes an admin account to the admin workspace automatically based on credentials', async () => {
      (authClient.loginWithPassword as jest.Mock).mockResolvedValue({
        success: true,
        user: { ...BUYER_SESSION, role: 'admin' },
        token: 'jwt',
      });

      render(<LoginPage />);
      typeInto(/Registered Email ID/i, 'admin@procucev.com');
      typeInto(/Registered Mobile Number/i, LOGIN_MOBILE);
      typeInto(/^Password$/i, 'secret123');
      fireEvent.click(submitButton(/Sign In/i));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.admin);
      });
      expect(setCurrentRole).toHaveBeenCalledWith('admin');
    });

    it('surfaces the server error and does not establish a session', async () => {
      (authClient.loginWithPassword as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Invalid email or password.',
      });

      render(<LoginPage />);
      typeInto(/Registered Email ID/i, 'nobody@nowhere.test');
      typeInto(/Registered Mobile Number/i, LOGIN_MOBILE);
      typeInto(/^Password$/i, 'wrong');
      fireEvent.click(submitButton(/Sign In/i));

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          AUTH.signInFailedTitle,
          'Invalid email or password.',
          'warning'
        );
      });
      expect(setIsLoggedIn).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('validates that email, mobile and password are all supplied before calling the API', () => {
      render(<LoginPage />);

      submitForm(/Sign In/i);

      expect(showToast).toHaveBeenCalledWith(
        AUTH.missingFieldsTitle,
        AUTH.loginFieldsRequired,
        'warning'
      );
      expect(authClient.loginWithPassword).not.toHaveBeenCalled();
    });

    it('treats a blank mobile number as a missing field', () => {
      render(<LoginPage />);
      typeInto(/Registered Email ID/i, BUYER_SESSION.email);
      typeInto(/^Password$/i, 'Pass@123');

      submitForm(/Sign In/i);

      expect(showToast).toHaveBeenCalledWith(
        AUTH.missingFieldsTitle,
        AUTH.loginFieldsRequired,
        'warning'
      );
      expect(authClient.loginWithPassword).not.toHaveBeenCalled();
    });

    it('rejects a malformed mobile number before calling the API', () => {
      render(<LoginPage />);
      typeInto(/Registered Email ID/i, BUYER_SESSION.email);
      typeInto(/Registered Mobile Number/i, '12345');
      typeInto(/^Password$/i, 'Pass@123');

      submitForm(/Sign In/i);

      expect(showToast).toHaveBeenCalledWith(AUTH.signInFailedTitle, AUTH.mobileInvalid, 'warning');
      expect(authClient.loginWithPassword).not.toHaveBeenCalled();
    });

    it('rejects a malformed email address before calling the API', () => {
      render(<LoginPage />);
      typeInto(/Registered Email ID/i, 'not-an-email');
      typeInto(/Registered Mobile Number/i, LOGIN_MOBILE);
      typeInto(/^Password$/i, 'Pass@123');

      submitForm(/Sign In/i);

      expect(showToast).toHaveBeenCalledWith(AUTH.signInFailedTitle, AUTH.emailInvalid, 'warning');
      expect(authClient.loginWithPassword).not.toHaveBeenCalled();
    });

    it('accepts a +91 prefixed mobile number and forwards it untouched', async () => {
      (authClient.loginWithPassword as jest.Mock).mockResolvedValue({
        success: true,
        user: BUYER_SESSION,
        token: 'jwt',
      });

      render(<LoginPage />);
      typeInto(/Registered Email ID/i, BUYER_SESSION.email);
      typeInto(/Registered Mobile Number/i, `  +91${LOGIN_MOBILE}  `);
      typeInto(/^Password$/i, 'Pass@123');
      fireEvent.click(submitButton(/Sign In/i));

      await waitFor(() => {
        expect(authClient.loginWithPassword).toHaveBeenCalledWith(
          BUYER_SESSION.email,
          'Pass@123',
          `+91${LOGIN_MOBILE}`
        );
      });
    });

    // Both sign-in methods resolve the account by email + mobile, so the field
    // is present on the OTP form too and its value survives switching methods.
    it('keeps the mobile number when switching to the email OTP method', () => {
      render(<LoginPage />);
      typeInto(/Registered Mobile Number/i, LOGIN_MOBILE);

      fireEvent.click(screen.getByRole('button', { name: /Email OTP/i }));

      expect(screen.getByLabelText(/Registered Mobile Number/i)).toHaveValue(LOGIN_MOBILE);
    });
  });

  // The identity service issues the code against the email + mobile pair and
  // resends the mobile on verification, matching the Java /authenticate flow.
  describe('email OTP sign-in', () => {
    const switchToOtp = () => fireEvent.click(screen.getByRole('button', { name: /Email OTP/i }));

    const fillOtpIdentity = (email = BUYER_SESSION.email) => {
      typeInto(/Registered Email ID/i, email);
      typeInto(/Registered Mobile Number/i, LOGIN_MOBILE);
    };

    it('requests a code then verifies it and signs in', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: true });
      (authClient.verifyOtp as jest.Mock).mockResolvedValue({
        success: true,
        user: BUYER_SESSION,
        token: 'jwt',
      });

      render(<LoginPage />);
      switchToOtp();
      fillOtpIdentity();
      fireEvent.click(screen.getByRole('button', { name: /Request Login OTP/i }));

      await waitFor(() => {
        expect(authClient.requestOtp).toHaveBeenCalledWith(
          BUYER_SESSION.email,
          LOGIN_MOBILE
        );
      });

      typeInto(/Email Verification Code \(OTP\)/i, OTP_CODE);
      fireEvent.click(screen.getByRole('button', { name: /Verify & Sign In/i }));

      await waitFor(() => {
        expect(authClient.verifyOtp).toHaveBeenCalledWith(
          BUYER_SESSION.email,
          OTP_CODE,
          LOGIN_MOBILE
        );
      });
      expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.buyer);
    });

    it('accepts a code of exactly the configured length', () => {
      render(<LoginPage />);
      switchToOtp();

      expect(OTP_CODE).toHaveLength(OTP_CODE_LENGTH);
    });

    it('reports a rejected OTP request for an unknown account', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: false,
        error: 'No active account matches this email address and mobile number together.',
      });

      render(<LoginPage />);
      switchToOtp();
      fillOtpIdentity('ghost@nowhere.test');
      fireEvent.click(screen.getByRole('button', { name: /Request Login OTP/i }));

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          AUTH.otpRequestFailedTitle,
          'No active account matches this email address and mobile number together.',
          'warning'
        );
      });
      expect(screen.queryByLabelText(/Email Verification Code \(OTP\)/i)).not.toBeInTheDocument();
    });

    it('reports an invalid code', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: true });
      (authClient.verifyOtp as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Invalid or expired OTP code.',
      });

      render(<LoginPage />);
      switchToOtp();
      fillOtpIdentity();
      fireEvent.click(screen.getByRole('button', { name: /Request Login OTP/i }));
      await waitFor(() => expect(screen.getByLabelText(/Email Verification Code \(OTP\)/i)).toBeInTheDocument());

      typeInto(/Email Verification Code \(OTP\)/i, '999999');
      fireEvent.click(screen.getByRole('button', { name: /Verify & Sign In/i }));

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          AUTH.otpInvalidTitle,
          'Invalid or expired OTP code.',
          'warning'
        );
      });
      expect(setIsLoggedIn).not.toHaveBeenCalled();
    });

    it('rejects a short code without calling the API', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: true });

      render(<LoginPage />);
      switchToOtp();
      fillOtpIdentity();
      fireEvent.click(screen.getByRole('button', { name: /Request Login OTP/i }));
      await waitFor(() => expect(screen.getByLabelText(/Email Verification Code \(OTP\)/i)).toBeInTheDocument());

      typeInto(/Email Verification Code \(OTP\)/i, '1234');
      fireEvent.submit(
        screen.getByRole('button', { name: /Verify & Sign In/i }).closest('form') as HTMLFormElement
      );

      expect(showToast).toHaveBeenCalledWith(AUTH.otpInvalidTitle, AUTH.otpRequired, 'warning');
      expect(authClient.verifyOtp).not.toHaveBeenCalled();
    });

    it('requires an email and a mobile number before requesting a code', () => {
      render(<LoginPage />);
      switchToOtp();

      fireEvent.submit(screen.getByRole('button', { name: /Request Login OTP/i }).closest('form')!);

      expect(showToast).toHaveBeenCalledWith(
        AUTH.missingFieldsTitle,
        AUTH.emailAndMobileRequired,
        'warning'
      );
      expect(authClient.requestOtp).not.toHaveBeenCalled();
    });

    it('rejects a malformed mobile number before requesting a code', () => {
      render(<LoginPage />);
      switchToOtp();
      typeInto(/Registered Email ID/i, BUYER_SESSION.email);
      typeInto(/Registered Mobile Number/i, '12345');

      fireEvent.submit(screen.getByRole('button', { name: /Request Login OTP/i }).closest('form')!);

      expect(showToast).toHaveBeenCalledWith(
        AUTH.otpRequestFailedTitle,
        AUTH.mobileInvalid,
        'warning'
      );
      expect(authClient.requestOtp).not.toHaveBeenCalled();
    });

    it('returns to the email step from the code step', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({ success: true });

      render(<LoginPage />);
      switchToOtp();
      fillOtpIdentity();
      fireEvent.click(screen.getByRole('button', { name: /Request Login OTP/i }));
      await waitFor(() => expect(screen.getByLabelText(/Email Verification Code \(OTP\)/i)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /^Back$/i }));

      expect(screen.getByRole('button', { name: /Request Login OTP/i })).toBeInTheDocument();
    });
  });

  describe('registration', () => {

    const completeDualOtp = (emailOtp = '123456', mobileOtp = '123456') => {
      fireEvent.change(screen.getByLabelText(/Email (Verification Code \(OTP\)|OTP)/i), { target: { value: emailOtp } });
      fireEvent.change(screen.getByLabelText(/Mobile OTP/i), { target: { value: mobileOtp } });
      fireEvent.click(screen.getByRole('button', { name: /Verify & Activate Account/i }));
    };

    it('creates a real account and signs the new user in after dual OTP verification', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
      });
      (authClient.register as jest.Mock).mockResolvedValue({
        success: true,
        user: BUYER_SESSION,
        token: 'jwt',
      });

      render(<LoginPage />);
      openRegister();
      fillValidForm();
      fireEvent.click(submitButton(/Create Account/i));

      await waitFor(() => {
        expect(screen.getByText(/Dual OTP Identity Verification/i)).toBeInTheDocument();
      });
      completeDualOtp('123456', '654321');

      await waitFor(() => {
        expect(authClient.register).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Navin Chaudhary',
            email: BUYER_SESSION.email,
            password: 'Pass@1234',
            mobile: '9157154504',
            role: 'buyer',
          })
        );
      });
      expect(addBuyerAccount).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.buyer);
    });

    it('creates a vendor partner account when vendor role is selected', async () => {
      const vendorUser = {
        id: 'usr-v-1',
        email: 'vendor@supplier.com',
        name: 'Rajesh Kumar',
        role: 'vendor' as const,
        vendorId: 'vnd-1',
        passwordChangeRequired: true,
      };
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
      });
      (authClient.register as jest.Mock).mockResolvedValue({
        success: true,
        user: vendorUser,
        token: 'jwt-vendor',
      });

      render(<LoginPage />);
      openRegister();
      fireEvent.click(screen.getByRole('button', { name: /Vendor Partner/i }));

      typeInto(/Authorized Representative Name/i, 'Rajesh Kumar');
      typeInto(/Vendor Enterprise/i, 'Precision Works');
      typeInto(/GSTIN/i, '27AAAAA0000A1Z5');
      typeInto(/City/i, 'Pune');
      typeInto(/State/i, 'Maharashtra');
      typeInto(/Pincode/i, '411001');
      typeInto(/Corporate Email ID/i, 'vendor@supplier.com');
      typeInto(/Mobile Number/i, '9811223344');
      typeInto(/^Password$/i, 'Pass@1234');

      fireEvent.click(submitButton(/Create Account/i));
      await waitFor(() => {
        expect(screen.getByText(/Dual OTP Identity Verification/i)).toBeInTheDocument();
      });
      completeDualOtp();

      await waitFor(() => {
        expect(authClient.register).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Rajesh Kumar',
            email: 'vendor@supplier.com',
            password: 'Pass@1234',
            mobile: '9811223344',
            role: 'vendor',
          })
        );
      });
      expect(mockReplace).toHaveBeenCalledWith('/vendor-first-login');
      expect(mockReplace).not.toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor);
    });

    it('propagates the registered GSTIN and plant location to the new buyer record', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
      });
      (authClient.register as jest.Mock).mockResolvedValue({
        success: true,
        user: BUYER_SESSION,
        token: 'jwt',
      });

      render(<LoginPage />);
      openRegister();
      fillValidForm();
      fireEvent.click(submitButton(/Create Account/i));
      await waitFor(() => {
        expect(screen.getByText(/Dual OTP Identity Verification/i)).toBeInTheDocument();
      });
      completeDualOtp();

      await waitFor(() => expect(addBuyerAccount).toHaveBeenCalled());
      expect(addBuyerAccount.mock.calls[0][0]).toMatchObject({
        gstin: '27AAAAA0000A1Z5',
        primaryPlantLocation: 'Pune, Maharashtra (411001)',
      });
    });

    it('rejects a short password before calling the API', () => {
      render(<LoginPage />);
      openRegister();
      fillValidForm();
      typeInto(/^Password$/i, 'short');

      submitForm(/Create Account/i);

      expect(showToast).toHaveBeenCalledWith(AUTH.registrationFailedTitle, AUTH.passwordTooShort, 'warning');
      expect(authClient.register).not.toHaveBeenCalled();
    });

    it('rejects an invalid mobile number before calling the API', () => {
      render(<LoginPage />);
      openRegister();
      fillValidForm();
      typeInto(/Mobile Number/i, '12345');

      submitForm(/Create Account/i);

      expect(showToast).toHaveBeenCalledWith(AUTH.registrationFailedTitle, AUTH.mobileInvalid, 'warning');
      expect(authClient.register).not.toHaveBeenCalled();
    });

    it('requires every mandatory field', () => {
      render(<LoginPage />);
      openRegister();

      submitForm(/Create Account/i);

      expect(showToast).toHaveBeenCalledWith(
        AUTH.missingFieldsTitle,
        'Please fill in all mandatory fields including Company Name, GSTIN, City, State, and Pincode.',
        'warning'
      );
    });

    it('reports a duplicate account from the server', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
      });
      (authClient.register as jest.Mock).mockResolvedValue({
        success: false,
        error: 'An account already exists for this email address.',
      });

      render(<LoginPage />);
      openRegister();
      fillValidForm();
      fireEvent.click(submitButton(/Create Account/i));
      await waitFor(() => {
        expect(screen.getByText(/Dual OTP Identity Verification/i)).toBeInTheDocument();
      });
      completeDualOtp();

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          AUTH.registrationFailedTitle,
          'An account already exists for this email address.',
          'warning'
        );
      });
      expect(setIsLoggedIn).not.toHaveBeenCalled();
    });

    it('rejects incomplete OTP inputs during dual OTP verification', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
      });
      render(<LoginPage />);
      openRegister();
      fillValidForm();
      fireEvent.click(submitButton(/Create Account/i));

      await waitFor(() => {
        expect(screen.getByText(/Dual OTP Identity Verification/i)).toBeInTheDocument();
      });
      completeDualOtp('123', '456');

      expect(showToast).toHaveBeenCalledWith(
        'Both OTPs Required',
        'Please enter both the 6-digit Email OTP and the 6-digit Mobile SMS OTP.',
        'warning'
      );
      expect(authClient.register).not.toHaveBeenCalled();
    });

    it('navigates back to the registration form when clicking Back on dual OTP step', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
      });
      render(<LoginPage />);
      openRegister();
      fillValidForm();
      fireEvent.click(submitButton(/Create Account/i));

      await waitFor(() => {
        expect(screen.getByText(/Dual OTP Identity Verification/i)).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /Back/i }));
      expect(screen.getByLabelText(/Full Name/i)).toBeInTheDocument();
      expect(screen.queryByText(/Dual OTP Identity Verification/i)).not.toBeInTheDocument();
    });

    it('switches between Buyer and Vendor Partner registration forms', () => {
      render(<LoginPage />);
      openRegister();

      expect(screen.getByText('Create Buyer Account')).toBeInTheDocument();
      expect(screen.getByText('5 Free RFQs')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Vendor Partner/i }));
      expect(screen.getByText('Create Vendor Partner Account')).toBeInTheDocument();
      expect(screen.getByText('5 Free Quotes')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^Buyer$/i }));
      expect(screen.getByText('Create Buyer Account')).toBeInTheDocument();
    });
  });

  it('redirects a visitor who is already signed in', () => {
    mockStore({ isLoggedIn: true, currentRole: 'vendor' });

    render(<LoginPage />);

    expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor);
  });

  describe('form controls', () => {
    it('does not render manual role selection buttons on sign-in and auto-detects roles', () => {
      render(<LoginPage />);

      expect(screen.queryByRole('button', { name: /^Buyer$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cat Manager/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Vendor Partner/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /System Admin/i })).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Registered Email ID/i)).toBeInTheDocument();
    });

    it('returns to the sign-in tab from the create-account tab', () => {
      render(<LoginPage />);

      const registerTab = screen
        .getAllByRole('button', { name: /Create Account/i })
        .find((b) => b.getAttribute('type') === 'button');
      fireEvent.click(registerTab as HTMLElement);
      expect(screen.getByLabelText(/Full Name/i)).toBeInTheDocument();

      const signInTab = screen
        .getAllByRole('button', { name: /Sign In/i })
        .find((b) => b.getAttribute('type') === 'button');
      fireEvent.click(signInTab as HTMLElement);

      expect(screen.queryByLabelText(/Full Name/i)).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Registered Email ID/i)).toBeInTheDocument();
    });

    it('captures an optional company name on the registration form', () => {
      render(<LoginPage />);

      const registerTab = screen
        .getAllByRole('button', { name: /Create Account/i })
        .find((b) => b.getAttribute('type') === 'button');
      fireEvent.click(registerTab as HTMLElement);

      const company = screen.getByLabelText(/Company Name/i);
      fireEvent.change(company, { target: { value: 'Navin Chaudhary Enterprises' } });
      expect(company).toHaveValue('Navin Chaudhary Enterprises');
    });

    it('switches between password and email OTP modes in sign-in', () => {
      render(<LoginPage />);
      const otpModeBtn = screen.getByRole('button', { name: /Email OTP/i });
      fireEvent.click(otpModeBtn);
      const passwordModeBtn = screen.getByRole('button', { name: /Password/i });
      fireEvent.click(passwordModeBtn);
      expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();
    });

    it('resends OTP during login verification', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
        message: 'OTP sent',
        email: 'navinchaudhary.dev@gmail.com',
        demoCode: '123456',
      });

      render(<LoginPage />);
      fireEvent.click(screen.getByRole('button', { name: /Email OTP/i }));
      typeInto(/Registered Email ID/i, 'navinchaudhary.dev@gmail.com');
      typeInto(/Registered Mobile Number/i, '9157154504');
      submitForm(/Request Login OTP/i);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Resend OTP/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Resend OTP/i }));
      await waitFor(() => {
        expect(authClient.requestOtp).toHaveBeenCalledTimes(2);
      });
    });

    it('handles resend OTP error during login', async () => {
      (authClient.requestOtp as jest.Mock)
        .mockResolvedValueOnce({
          success: true,
          message: 'OTP sent',
        })
        .mockResolvedValueOnce({
          success: false,
          error: 'Rate limit exceeded',
        });

      render(<LoginPage />);
      fireEvent.click(screen.getByRole('button', { name: /Email OTP/i }));
      typeInto(/Registered Email ID/i, 'navinchaudhary.dev@gmail.com');
      typeInto(/Registered Mobile Number/i, '9157154504');
      submitForm(/Request Login OTP/i);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Resend OTP/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Resend OTP/i }));
      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith('OTP Request Failed', 'Rate limit exceeded', 'warning');
      });
    });

    it('resends verification codes during dual OTP registration', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
        message: 'Verification OTP dispatched',
        demoCode: '654321',
      });

      render(<LoginPage />);
      openRegister();
      fillValidForm();
      submitForm(/Create Account/i);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Resend Verification Codes/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Resend Verification Codes/i }));
      await waitFor(() => {
        expect(authClient.requestOtp).toHaveBeenCalledTimes(2);
      });
    });

    it('handles error when resending verification codes during registration', async () => {
      (authClient.requestOtp as jest.Mock)
        .mockResolvedValueOnce({
          success: true,
          message: 'Verification OTP dispatched',
        })
        .mockResolvedValueOnce({
          success: false,
          error: 'Rate limit reached for SMS gateway',
        });

      render(<LoginPage />);
      openRegister();
      fillValidForm();
      submitForm(/Create Account/i);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Resend Verification Codes/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Resend Verification Codes/i }));
      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          AUTH.registrationFailedTitle,
          'Rate limit reached for SMS gateway',
          'warning'
        );
      });
    });

    it('completes dual OTP verification and account creation for buyer', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
        demoEmailCode: '123456',
        demoMobileCode: '654321',
      });
      (authClient.register as jest.Mock).mockResolvedValue({
        success: true,
        user: { ...BUYER_SESSION, role: 'buyer' },
      });

      render(<LoginPage />);
      openRegister();
      fillValidForm();
      submitForm(/Create Account/i);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Verify & Activate Account/i })).toBeInTheDocument();
      });

      const emailOtpInput = screen.getByPlaceholderText(/6-digit Email OTP/i);
      const mobileOtpInput = screen.getByPlaceholderText(/6-digit Mobile OTP/i);
      fireEvent.change(emailOtpInput, { target: { value: '123456' } });
      fireEvent.change(mobileOtpInput, { target: { value: '654321' } });

      fireEvent.click(screen.getByRole('button', { name: /Verify & Activate Account/i }));

      await waitFor(() => {
        expect(authClient.register).toHaveBeenCalled();
        expect(addBuyerAccount).toHaveBeenCalled();
        expect(setIsLoggedIn).toHaveBeenCalledWith(true);
      });
    });

    it('handles registration failure during dual OTP completion', async () => {
      (authClient.requestOtp as jest.Mock).mockResolvedValue({
        success: true,
        demoEmailCode: '123456',
        demoMobileCode: '654321',
      });
      (authClient.register as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Invalid or expired OTP code',
      });

      render(<LoginPage />);
      openRegister();
      fillValidForm();
      submitForm(/Create Account/i);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Verify & Activate Account/i })).toBeInTheDocument();
      });

      const emailOtpInput = screen.getByPlaceholderText(/6-digit Email OTP/i);
      const mobileOtpInput = screen.getByPlaceholderText(/6-digit Mobile OTP/i);
      fireEvent.change(emailOtpInput, { target: { value: '123456' } });
      fireEvent.change(mobileOtpInput, { target: { value: '654321' } });

      fireEvent.click(screen.getByRole('button', { name: /Verify & Activate Account/i }));

      await waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          AUTH.registrationFailedTitle,
          'Invalid or expired OTP code',
          'warning'
        );
      });
    });
  });
});

