'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import {
  expandCategorySelection,
  fetchBuyerProfile,
  fetchCategoryTaxonomy,
  flattenCategorySelection,
  saveBuyerProfile,
} from '@/lib/buyerProfileClient';
import { BUYER_PROFILE_LIMITS, ORGANIZATION_TYPE_OPTIONS } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { FORM_SCHEMAS, validateFormData, validatePincode, PostOfficeDetail, PINCODE_PATTERN, isDummyPincode } from '@/lib/validationSchemas';
import { logger } from '@/lib/logger';
import AccountSecurityPanel from '@/app/components/AccountSecurityPanel';
import type { BuyerProfileUpdatePayload, MajorMinorCategory, OrganizationType } from '@/lib/types';
import {
  Building2,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  KeyRound,
  MapPin,
  User,
  Search,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  Save,
  Globe,
  Sliders,
} from 'lucide-react';

/**
 * Buyer Organization Profile.
 *
 * Every field on this screen is a column of the buyer's own `organization` row in
 * the shared Procucev database, and every category checkbox is a row of
 * `org_division_category`. Nothing is seeded, defaulted from a fixture, or held
 * in memory between sessions: the form is populated by GET /api/buyer-profile/me
 * on mount and persisted by PUT /api/buyer-profile/me on save.
 *
 * The organisation is resolved server-side from the session token, so the screen
 * never names an organisation and a buyer can only ever reach their own record.
 */
export default function BuyerProfilePage() {
  const { addAuditLog, showToast } = useApp();

  const { MAX_MAJOR_CATEGORIES, MAX_MINOR_CATEGORIES } = BUYER_PROFILE_LIMITS;

  // Organization Form State
  const [companyName, setCompanyName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [orgType, setOrgType] = useState<OrganizationType>('Public Limited');
  const [panNumber, setPanNumber] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [cinNumber, setCinNumber] = useState('');
  const [website, setWebsite] = useState('');
  const [annualTurnover, setAnnualTurnover] = useState('');

  // Address State
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [pincodeError, setPincodeError] = useState<string | null>(null);
  const [pincodeValidating, setPincodeValidating] = useState(false);
  const [pincodePostOffices, setPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  const pincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const raw = pincode.trim();
    if (pincodeDebounceRef.current) clearTimeout(pincodeDebounceRef.current);
    if (!raw) {
      setPincodeError(null);
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }
    if (isDummyPincode(raw)) {
      setPincodeError('Invalid or dummy PIN code');
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }
    if (raw.length >= 3 && !PINCODE_PATTERN.test(raw)) {
      setPincodeError('Invalid PIN code format');
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }
    if (/^\d{6}$/.test(raw)) {
      setPincodeValidating(true);
      pincodeDebounceRef.current = setTimeout(async () => {
        try {
          const res = await validatePincode(raw);
          if (!res.isValid) {
            setPincodeError(res.message || 'Invalid PIN code');
            setPincodePostOffices([]);
          } else {
            setPincodeError(null);
            const pos = res.postOffices || [];
            setPincodePostOffices(pos);
            if (pos.length > 0) {
              const primaryPo = pos[0];
              const matchedCity = primaryPo.District || primaryPo.Division || primaryPo.Name || '';
              const matchedState = primaryPo.State || '';
              if (matchedCity) setCity(matchedCity);
              if (matchedState) setState(matchedState);
            }
          }
        } catch {
          setPincodeError(null);
        } finally {
          setPincodeValidating(false);
        }
      }, 350);
    } else {
      setPincodeError(null);
      setPincodeValidating(false);
      setPincodePostOffices([]);
    }
  }, [pincode]);
  const [country, setCountry] = useState('');

  // Contact Person State. Email and mobile belong to the signed-in account's
  // `user` row and are shown as loaded; the save endpoint ignores them so a
  // profile edit can never reassign the login identity.
  const [contactName, setContactName] = useState('');
  const [contactDesignation, setContactDesignation] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Category Selection State: Selected Major Categories and Minor Categories
  const [selectedMajor, setSelectedMajor] = useState<string[]>([]);
  const [selectedMinor, setSelectedMinor] = useState<Record<string, string[]>>({});

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMajor, setExpandedMajor] = useState<Record<string, boolean>>({});

  // The major/minor taxonomy, read from the `category_division` master table.
  // Starts empty because there is no offline copy to show: an unreachable API
  // means the buyer is told the tree could not be loaded, not offered categories
  // that might not exist.
  const [taxonomy, setTaxonomy] = useState<MajorMinorCategory[]>([]);

  // Request state. `isLoaded` gates saving: without a resolved organisation there
  // is nothing to patch, and submitting would post a form the buyer never saw
  // filled in.
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  /**
   * Latest `showToast`, read through a ref.
   *
   * The store recreates `showToast` on every provider render, so it must not be a
   * dependency of the load below. It used to be, and the result was an unbounded
   * request loop: reporting a failed load calls `showToast`, which sets state in
   * the provider, which re-renders it, which yields a new `showToast` identity,
   * which re-creates the loader, which re-runs the mount effect, which requests
   * again. A failing endpoint drove that round indefinitely, and the toast's own
   * auto-dismiss timer would have driven it even on success.
   *
   * A ref keeps the loader's identity stable while still calling the current
   * function, so the profile is fetched once per mount.
   */
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  /** Set once the component unmounts, so a late response cannot set state. */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Load the taxonomy and the buyer's stored profile.
   *
   * Both are requested together because the category tree cannot be rendered
   * without the taxonomy and the selection cannot be shown without the profile,
   * so serialising them would only add a round trip.
   *
   * Deliberately has no dependencies: it reads the store callback through a ref
   * and only ever calls state setters, whose identities React guarantees are
   * stable. That is what keeps the mount effect from re-firing.
   */
  const loadProfile = useCallback(async () => {
    setIsLoading(true);

    const [taxonomyResult, profileResult] = await Promise.all([
      fetchCategoryTaxonomy(),
      fetchBuyerProfile(),
    ]);

    if (!isMountedRef.current) return;

    setTaxonomy(taxonomyResult.data);
    if (!taxonomyResult.success) {
      showToastRef.current(UI_STRINGS.buyerProfile.loadFailedTitle, taxonomyResult.error || '', 'warning');
    }

    if (!profileResult.success || !profileResult.data) {
      setIsLoaded(false);
      setIsLoading(false);
      showToastRef.current(UI_STRINGS.buyerProfile.loadFailedTitle, profileResult.error || '', 'warning');
      return;
    }

    const profile = profileResult.data;
    setCompanyName(profile.companyName);
    setBrandName(profile.brandName);
    // Guard against a stored constitution outside the offered set, which would
    // leave the select bound to a value none of its options carry.
    setOrgType(
      ORGANIZATION_TYPE_OPTIONS.includes(profile.organizationType as OrganizationType)
        ? (profile.organizationType as OrganizationType)
        : 'Public Limited'
    );
    setPanNumber(profile.panNumber);
    setGstNumber(profile.gstNumber);
    setCinNumber(profile.cinNumber);
    setWebsite(profile.website);
    setAnnualTurnover(profile.annualTurnover);
    setStreet(profile.street);
    setCity(profile.city);
    setState(profile.state);
    setPincode(profile.pincode);
    setCountry(profile.country);
    setContactName(profile.contactName);
    setContactDesignation(profile.contactDesignation);
    setContactEmail(profile.contactEmail);
    setContactPhone(profile.contactPhone);

    const { selectedMajor: majors, selectedMinor: minors } = expandCategorySelection(profile.categories);
    setSelectedMajor(majors);
    setSelectedMinor(minors);
    // Open the majors the buyer already sources in, so their existing scope is
    // visible without hunting for it.
    setExpandedMajor(majors.reduce<Record<string, boolean>>((acc, major) => ({ ...acc, [major]: true }), {}));

    setIsLoaded(true);
    setIsLoading(false);
  }, []);

  // Runs once per mount: `loadProfile` is dependency-free, so this effect has a
  // stable dependency and cannot be re-triggered by a provider re-render.
  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // PAN Validation Helper
  const isPanValid = (pan: string) => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.toUpperCase());
  // GST Validation Helper
  const isGstValid = (gst: string) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gst.toUpperCase());

  /**
   * Persist the profile.
   *
   * Validated against FORM_SCHEMAS.buyerProfile first so a malformed statutory
   * identifier is reported before a request is made, then re-validated by the
   * server, which owns the `organization` row. The response is applied back to the
   * form so the buyer sees exactly what was stored, including the server-side
   * uppercasing of PAN/GSTIN/CIN and the currency-symbol rewrite.
   */
  const handleSaveProfile = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    if (isSaving) return;

    if (!isLoaded) {
      showToast(UI_STRINGS.buyerProfile.saveFailedTitle, UI_STRINGS.buyerProfile.loadUnreachable, 'warning');
      return;
    }

    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.buyerProfile, {
      companyName,
      panNumber,
      gstNumber,
      cinNumber,
      website,
      pincode,
    });

    if (!isValid) {
      showToast(
        UI_STRINGS.buyerProfile.validationErrorTitle,
        Object.values(fieldErrors).join(' '),
        'warning'
      );
      return;
    }

    if (pincode.trim() && pincodeError) {
      showToast(UI_STRINGS.buyerProfile.validationErrorTitle, pincodeError, 'warning');
      return;
    }

    const categories = flattenCategorySelection(selectedMajor, selectedMinor);

    const payload: BuyerProfileUpdatePayload = {
      companyName,
      brandName,
      organizationType: orgType,
      panNumber,
      gstNumber,
      cinNumber,
      website,
      annualTurnover,
      street,
      city,
      state,
      pincode,
      country,
      contactName,
      contactDesignation,
      categories,
    };

    setIsSaving(true);
    logger.info('Saving buyer organization profile', { categoryCount: categories.length }, 'BUYER_PROFILE');
    const result = await saveBuyerProfile(payload);
    setIsSaving(false);

    if (!result.success) {
      showToast(UI_STRINGS.buyerProfile.saveFailedTitle, result.error || '', 'warning');
      return;
    }

    // Re-apply the stored record: the server normalises several fields, and
    // leaving the pre-save text on screen would misrepresent what was persisted.
    if (result.data) {
      setCompanyName(result.data.companyName);
      setBrandName(result.data.brandName);
      setPanNumber(result.data.panNumber);
      setGstNumber(result.data.gstNumber);
      setCinNumber(result.data.cinNumber);
      setAnnualTurnover(result.data.annualTurnover);
      setContactName(result.data.contactName);
    }

    addAuditLog(`Updated Buyer Organization Profile for ${companyName}`);
    showToast(
      UI_STRINGS.buyerProfile.savedTitle,
      formatString(UI_STRINGS.buyerProfile.savedMessage, {
        categoryCount: result.categoryCount ?? categories.length,
      }),
      'success'
    );
  };

  return (
    <div className="space-y-2.5 animate-fade-in pb-4">
      {/* Top Action Bar */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleSaveProfile}
          disabled={isLoading || isSaving}
          aria-busy={isSaving}
          className="btn btn-primary btn-sm shadow-sm font-bold flex items-center gap-1.5"
        >
          <Save size={14} /> Save Organization Profile
        </button>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-2.5">
        {/* Section 1: Legal Entity & Tax Compliance */}
        <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-2.5">
            <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="text-indigo-600 dark:text-indigo-400" size={16} /> Section 1: Organization & Tax Registration
            </h2>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 size={12} /> Tax Verified
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3">
            {/* Company Name */}
            <div>
              <label className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Legal Entity Name *
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>

            {/* Brand / Division */}
            <div>
              <label className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Brand / Procurement Division
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>

            {/* Org Type */}
            <div>
              <label className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Organization Constitution *
              </label>
              <select
                value={orgType}
                onChange={(e) => setOrgType(e.target.value as OrganizationType)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              >
                <option value="Public Limited">Public Limited Company</option>
                <option value="Private Limited">Private Limited Company</option>
                <option value="LLP">Limited Liability Partnership (LLP)</option>
                <option value="Partnership">Partnership Firm</option>
                <option value="Sole Proprietorship">Sole Proprietorship</option>
              </select>
            </div>

            {/* PAN Number */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                  PAN Number *
                </label>
                {isPanValid(panNumber) ? (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ Valid PAN</span>
                ) : (
                  <span className="text-[10px] font-bold text-rose-500">Invalid Format</span>
                )}
              </div>
              <input
                type="text"
                value={panNumber}
                onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                maxLength={10}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase tracking-widest"
              />
            </div>

            {/* GST Number */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                  GSTIN / GST Number *
                </label>
                {isGstValid(gstNumber) ? (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ State 27 Verified</span>
                ) : (
                  <span className="text-[10px] font-bold text-rose-500">Invalid GSTIN</span>
                )}
              </div>
              <input
                type="text"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                maxLength={15}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase tracking-widest"
              />
            </div>

            {/* CIN Number */}
            <div>
              <label className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                CIN (Corporate ID Number)
              </label>
              <input
                type="text"
                value={cinNumber}
                onChange={(e) => setCinNumber(e.target.value.toUpperCase())}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-mono font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase"
              />
            </div>

            {/* Website */}
            <div>
              <label className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Corporate Website
              </label>
              <div className="relative">
                <Globe size={14} className="absolute left-3 top-2 text-slate-400" />
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Annual Turnover */}
            <div>
              <label className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Annual Procurement Volume
              </label>
              <input
                type="text"
                value={annualTurnover}
                onChange={(e) => setAnnualTurnover(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Address & Primary Contact */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {/* Registered Address */}
          <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-3">
            <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 dark:border-gray-800 pb-2.5">
              <MapPin className="text-indigo-600 dark:text-indigo-400" size={16} /> Registered Corporate Address
            </h2>
            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Street Address</label>
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">State</label>
                  <input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">PIN Code</label>
                    {pincodeValidating && (
                      <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Checking
                      </span>
                    )}
                    {!pincodeValidating && pincodePostOffices.length > 0 && !pincodeError && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle2 size={10} /> Valid
                      </span>
                    )}
                    {!pincodeValidating && pincodeError && pincode.trim().length >= 6 && (
                      <span className="text-[10px] font-bold text-rose-500 flex items-center gap-0.5">
                        <AlertCircle size={10} /> Invalid
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={pincode}
                    maxLength={6}
                    onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className={`w-full px-3 py-1.5 rounded-lg border text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white ${
                      pincodeError ? 'border-rose-400 dark:border-rose-700' : 'border-slate-200 dark:border-gray-800'
                    }`}
                  />
                  {pincodeError && pincode.trim().length >= 6 && (
                    <p className="text-[10px] text-rose-500 mt-0.5 font-medium">{pincodeError}</p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Country</label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Primary Contact Person */}
          <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-3">
            <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 dark:border-gray-800 pb-2.5">
              <User className="text-indigo-600 dark:text-indigo-400" size={16} /> Key Procurement Contact Person
            </h2>
            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Full Name</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Designation</label>
                <input
                  type="text"
                  value={contactDesignation}
                  onChange={(e) => setContactDesignation(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Email Address</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mobile Number</label>
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Section 3: Account & Security                                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Sits outside the organisation form above on purpose. The panel has its  */}
      {/* own submit handlers, and nesting a <form> inside another is invalid     */}
      {/* HTML — the inner one is dropped during parsing, which would wire the    */}
      {/* password button up to the profile save instead.                        */}
      <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 dark:border-gray-800 pb-2.5">
          <div>
            <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <KeyRound className="text-indigo-600 dark:text-indigo-400" size={16} />{' '}
              {UI_STRINGS.accountSecurity.sectionTitle}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
              {UI_STRINGS.accountSecurity.sectionDescription}
            </p>
          </div>
        </div>

        <AccountSecurityPanel />
      </div>
    </div>
  );
}
