'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { findMajorForMinor, getMinorCategories } from '@/lib/categoryTaxonomy';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  ShieldCheck,
  CheckCircle2,
  MapPin,
  User,
  Mail,
  Phone,
  Search,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  Save,
  Globe,
  Sliders,
  Layers,
  CreditCard,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { validatePincode, PostOfficeDetail, PINCODE_PATTERN, isDummyPincode } from '@/lib/validationSchemas';

export default function VendorProfilePage() {
  const {
    addAuditLog,
    showToast,
    vendorSubscription,
    completeVendorProfile,
    clientMappedCategories,
    vendorSelectedCategories,
    saveVendorProfileCategories,
    currentUserSession,
    // The category master, read from the database rather than a bundled copy.
    categoryTaxonomy,
    categoryTaxonomyError,
  } = useApp();

  const MAX_CATEGORIES = 10;

  // Vendor Organization State — starts blank; populated from the authenticated
  // vendor's own backend record once it loads (see the profile-load effect below).
  const [companyName, setCompanyName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [orgType, setOrgType] = useState<'Private Limited' | 'Public Limited' | 'Partnership' | 'Sole Proprietorship' | 'LLP'>('Private Limited');
  const [panNumber, setPanNumber] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [msmeNumber, setMsmeNumber] = useState('');
  const [website, setWebsite] = useState('');
  const [annualTurnover, setAnnualTurnover] = useState('');

  // Address State
  const [factoryAddress, setFactoryAddress] = useState('');
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
  const [country, setCountry] = useState('India');

  // Contact Person State. Email is the vendor's own login identity (see the
  // read-only field below) — it's what the backend uses to find this vendor's
  // record and to authorize edits to it, so it can't be freely retyped here.
  const [contactName, setContactName] = useState('');
  const [contactDesignation, setContactDesignation] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Category Selection State: Selected Major Categories and Minor Categories (Max 10)
  const [selectedMajor, setSelectedMajor] = useState<string[]>([]);
  const [selectedMinor, setSelectedMinor] = useState<Record<string, string[]>>({});

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMajor, setExpandedMajor] = useState<Record<string, boolean>>({});

  // Backend load/save state
  const [vendorRecordId, setVendorRecordId] = useState<string | null>(null);
  const [loadedClientCats, setLoadedClientCats] = useState<string[]>([]);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Groups a flat list of minor category names (as persisted by the backend)
  // back into the major->minor shape this screen's selector state uses.
  const groupMinorCategories = (flat: string[]) => {
    const majors: string[] = [];
    const minorMap: Record<string, string[]> = {};
    flat.forEach((minorName) => {
      const major = findMajorForMinor(minorName);
      if (!major) return;
      if (!minorMap[major]) {
        minorMap[major] = [];
        majors.push(major);
      }
      minorMap[major].push(minorName);
    });
    return { majors, minorMap };
  };

  useEffect(() => {
    let cancelled = false;

    async function loadVendorProfile() {
      const email = currentUserSession?.email;
      if (!email) {
        setIsLoadingProfile(false);
        return;
      }
      try {
        const token = authClient.getToken();
        const res = await fetch(`/api/vendors/${encodeURIComponent(email)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status === 404) {
          // No backend record yet for this vendor — first-time profile, blank form.
          if (!cancelled) setContactEmail(email);
          return;
        }
        const data = await res.json();
        if (cancelled || !res.ok || !data.success || !data.data) return;

        const v = data.data;
        setVendorRecordId(v.id);
        setCompanyName(v.name || '');
        setBrandName(v.brandName || '');
        if (v.orgType) setOrgType(v.orgType);
        setPanNumber(v.pan || '');
        setGstNumber(v.gst || '');
        setMsmeNumber(v.msme || '');
        setWebsite(v.website || '');
        setAnnualTurnover(v.annualTurnover || '');
        setFactoryAddress(v.factoryAddress || '');
        setCity(v.city || '');
        setState(v.state || '');
        setPincode(v.pincode || '');
        setCountry(v.country || 'India');
        setContactName(v.contactPerson || '');
        setContactDesignation(v.contactDesignation || '');
        setContactEmail(email);
        setContactPhone(v.phone || '');
        setLoadedClientCats(v.clientMappedCategories || []);

        const { majors, minorMap } = groupMinorCategories(v.vendorSelectedCategories || []);
        setSelectedMajor(majors);
        setSelectedMinor(minorMap);
        setExpandedMajor(Object.fromEntries(majors.map((m) => [m, true])));
      } catch {
        // Network failure loading the profile: leave the form blank rather
        // than showing fabricated placeholder data for the wrong vendor.
        if (!cancelled) setContactEmail(email);
      } finally {
        if (!cancelled) setIsLoadingProfile(false);
      }
    }

    loadVendorProfile();
    return () => {
      cancelled = true;
    };
  }, [currentUserSession?.email]);

  // Calculate totals
  const totalSelectedMinorCount = Object.values(selectedMinor).reduce((acc, curr) => acc + curr.length, 0);

  // PAN Validation Helper
  const isPanValid = (pan: string) => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.toUpperCase());
  // GST Validation Helper
  const isGstValid = (gst: string) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gst.toUpperCase());

  // Toggle Major Category
  const toggleMajorCategory = (majorName: string) => {
    if (selectedMajor.includes(majorName)) {
      setSelectedMajor((prev) => prev.filter((m) => m !== majorName));
      setSelectedMinor((prev) => {
        const next = { ...prev };
        delete next[majorName];
        return next;
      });
    } else {
      setSelectedMajor((prev) => [...prev, majorName]);
      const allMinor = getMinorCategories(majorName);
      const remainingSlots = MAX_CATEGORIES - totalSelectedMinorCount;
      if (remainingSlots <= 0) {
        showToast('Limit Reached', `Maximum ${MAX_CATEGORIES} categories allowed. Please uncheck some categories first.`, 'warning');
        return;
      }
      const allowedMinors = allMinor.slice(0, remainingSlots);
      setSelectedMinor((prev) => ({ ...prev, [majorName]: allowedMinors }));
    }
  };

  // Toggle Minor Category (Strict Max 10 Check)
  const toggleMinorCategory = (majorName: string, minorName: string) => {
    setSelectedMinor((prev) => {
      const currentList = prev[majorName] || [];
      const isCurrentlyChecked = currentList.includes(minorName);

      if (!isCurrentlyChecked) {
        if (totalSelectedMinorCount >= MAX_CATEGORIES) {
          showToast(
            'Maximum 10 Categories Reached',
            `You have selected ${totalSelectedMinorCount}/${MAX_CATEGORIES} categories. Please uncheck a category to add "${minorName}".`,
            'warning'
          );
          return prev;
        }

        setSelectedMajor((majors) => (majors.includes(majorName) ? majors : [...majors, majorName]));
        return {
          ...prev,
          [majorName]: [...currentList, minorName],
        };
      } else {
        const updated = currentList.filter((m) => m !== minorName);
        const next = { ...prev, [majorName]: updated };
        if (updated.length === 0) {
          delete next[majorName];
          setSelectedMajor((majors) => majors.filter((m) => m !== majorName));
        }
        return next;
      }
    });
  };

  // Filtered Categories based on search
  const filteredCategories = categoryTaxonomy.filter((cat) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesMajor = cat.majorCategory.toLowerCase().includes(term);
    const matchesMinor = cat.minorCategories.some((m) => m.toLowerCase().includes(term));
    return matchesMajor || matchesMinor;
  });

  // Reconciled Dual Stream Categories — prefer this vendor's own backend
  // record over the shared client-side store fallback (which isn't scoped
  // to a specific vendor and only reflects whichever profile was last saved
  // in this browser session).
  const clientCats =
    loadedClientCats.length > 0
      ? loadedClientCats
      : clientMappedCategories && clientMappedCategories.length > 0
      ? clientMappedCategories
      : ['Bearings & Accessories', 'Pumps & Accessories'];
  const flatSelectedCategories = Object.values(selectedMinor).flat();
  const clientLower = clientCats.map((c: string) => c.toLowerCase().trim());
  const vendorLower = flatSelectedCategories.map((c) => c.toLowerCase().trim());

  const commonCategories = flatSelectedCategories.filter((v) => clientLower.includes(v.toLowerCase().trim()));
  const vendorOnlyCategories = flatSelectedCategories.filter((v) => !clientLower.includes(v.toLowerCase().trim()));
  const clientOnlyCategories = clientCats.filter((c: string) => !vendorLower.includes(c.toLowerCase().trim()));
  const isAligned = clientCats.length > 0 && commonCategories.length === clientCats.length && flatSelectedCategories.length === clientCats.length;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !panNumber.trim() || !gstNumber.trim()) {
      showToast('Validation Error', 'Company Name, PAN, and GSTIN are required.', 'warning');
      return;
    }
    if (!isPanValid(panNumber)) {
      showToast('Validation Error', 'PAN number format is invalid (expected e.g. AAACA9876K).', 'warning');
      return;
    }
    if (!isGstValid(gstNumber)) {
      showToast('Validation Error', 'GSTIN format is invalid.', 'warning');
      return;
    }
    if (flatSelectedCategories.length === 0) {
      showToast('Validation Error', 'Select at least one manufacturing / supply category.', 'warning');
      return;
    }
    if (pincode.trim() && pincodeError) {
      showToast('Validation Error', pincodeError, 'warning');
      return;
    }
    if (!currentUserSession?.email) {
      showToast('Not Signed In', 'Your session could not be verified. Please sign in again.', 'warning');
      return;
    }

    const token = authClient.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    setIsSaving(true);
    try {
      const profilePayload = {
        name: companyName,
        brandName,
        orgType,
        pan: panNumber,
        gst: gstNumber,
        msme: msmeNumber,
        website,
        annualTurnover,
        factoryAddress,
        city,
        state,
        pincode,
        country,
        location: [factoryAddress, city, state && pincode ? `${state} ${pincode}` : state, country]
          .filter((part) => part && part.trim())
          .join(', '),
        contactPerson: contactName,
        contactDesignation,
        phone: contactPhone,
        majorCategory: selectedMajor[0] || '',
        minorCategories: flatSelectedCategories,
      };

      let currentId = vendorRecordId;
      if (currentId) {
        const res = await fetch(`/api/vendors/${encodeURIComponent(currentId)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(profilePayload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to save profile.');
        }
      } else {
        const res = await fetch('/api/vendors', {
          method: 'POST',
          headers,
          body: JSON.stringify(profilePayload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to create vendor profile.');
        }
        currentId = data.data.id;
        setVendorRecordId(currentId);
      }

      const catRes = await fetch(`/api/vendors/${encodeURIComponent(currentId as string)}/categories`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          clientMappedCategories: clientCats,
          vendorSelectedCategories: flatSelectedCategories,
        }),
      });
      const catData = await catRes.json();
      if (!catRes.ok || !catData.success) {
        throw new Error(catData.error || 'Failed to save category taxonomy.');
      }
      setLoadedClientCats(catData.data.clientMappedCategories || clientCats);

      if (saveVendorProfileCategories) {
        saveVendorProfileCategories(contactEmail, clientCats, flatSelectedCategories);
      }
      addAuditLog(`Updated Vendor Supplier Profile & Manufacturing Capabilities for ${companyName}`);
      showToast('Profile Saved', 'Supplier details and manufacturing categories updated successfully.', 'success');
    } catch (err: any) {
      showToast('Save Failed', err?.message || 'Could not save the supplier profile. Please try again.', 'warning');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <span className="badge badge-emerald font-mono uppercase">
            {vendorSubscription} Tier Supplier
          </span>
          <p className="max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-gray-400">
            Manage company registration, PAN/GSTIN compliance, and define your manufacturing / supply categories for direct buyer RFQs.
          </p>
        </div>
        <button
          onClick={handleSaveProfile}
          disabled={isLoadingProfile || isSaving}
          className="btn btn-emerald btn-md shadow-lg shadow-emerald-600/20 font-bold flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Save size={16} /> {isSaving ? 'Saving...' : 'Save Supplier Profile'}
        </button>
      </div>

      {isLoadingProfile && (
        <p className="text-xs text-slate-500 dark:text-gray-400 -mt-2">Loading your supplier profile…</p>
      )}

      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Section 1: Legal Entity & Tax Compliance */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="text-emerald-600 dark:text-emerald-400" size={18} /> Section 1: Supplier Tax & Business Details
            </h2>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 size={12} /> Verified Vendor
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Company Name */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Vendor Legal Entity Name *
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>

            {/* Trade Name */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Trade Name / Brand
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>

            {/* Org Type */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Business Constitution *
              </label>
              <select
                value={orgType}
                onChange={(e) => setOrgType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              >
                <option value="Private Limited">Private Limited Company</option>
                <option value="Public Limited">Public Limited Company</option>
                <option value="LLP">Limited Liability Partnership (LLP)</option>
                <option value="Partnership">Partnership Firm</option>
                <option value="Sole Proprietorship">Sole Proprietorship</option>
              </select>
            </div>

            {/* PAN Number */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
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
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase tracking-widest"
              />
            </div>

            {/* GST Number */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
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
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase tracking-widest"
              />
            </div>

            {/* MSME / Udyam Number */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                MSME / Udyam Registration
              </label>
              <input
                type="text"
                value={msmeNumber}
                onChange={(e) => setMsmeNumber(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white uppercase"
              />
            </div>

            {/* Website */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Company Website
              </label>
              <div className="relative">
                <Globe size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Annual Turnover */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400 block mb-1">
                Annual Turnover
              </label>
              <input
                type="text"
                value={annualTurnover}
                onChange={(e) => setAnnualTurnover(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Address & Sales Contact */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Factory / Works Address */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 dark:border-gray-800 pb-3">
              <MapPin className="text-emerald-600 dark:text-emerald-400" size={18} /> Works / Factory Address
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Street / Industrial Area</label>
                <input
                  type="text"
                  value={factoryAddress}
                  onChange={(e) => setFactoryAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">State</label>
                  <input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
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
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5 ${
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
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Primary Sales Contact */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 dark:border-gray-800 pb-3">
              <User className="text-emerald-600 dark:text-emerald-400" size={18} /> Sales & RFQ Contact Person
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Full Name</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Designation</label>
                <input
                  type="text"
                  value={contactDesignation}
                  onChange={(e) => setContactDesignation(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-semibold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Email Address</label>
                  <input
                    type="email"
                    value={contactEmail}
                    disabled
                    title="This is your account login email and can't be changed here."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-100 dark:bg-gray-900 text-slate-500 dark:text-gray-400 mt-0.5 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mobile Number</label>
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white mt-0.5"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Consolidated Major & Minor Categories Selector & Dual-Stream Reconciliation */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="text-emerald-600 dark:text-emerald-400" size={18} /> Section 3: Dual-Stream Category Reconciliation &amp; Taxonomy (Max 10 Categories)
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50">
                  Backend Dual-Stream Active
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Manage your self-selected supply capabilities (up to 10 categories). The system reconciles buyer-mapped categories and routes RFQs across both streams.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full border ${
                totalSelectedMinorCount >= MAX_CATEGORIES
                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200'
              }`}>
                {totalSelectedMinorCount} / {MAX_CATEGORIES} Categories Selected
              </span>
            </div>
          </div>

          {/* DUAL-STREAM CATEGORY RECONCILIATION SUMMARY DASHBOARD */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-gray-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Layers className="text-indigo-600 dark:text-indigo-400" size={16} />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Category Alignment &amp; Backend Storage Status
                </h3>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 ${
                isAligned
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300'
                  : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-300'
              }`}>
                {isAligned ? '✓ 100% Categories Aligned' : '🛡️ Dual-Category Backend Storage Active'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Card 1: Client Mapped Categories (from PO / Historical Data) */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                    🏢 Client Mapped Categories <span className="text-slate-400 text-[10px] font-normal">(Buyer Empanelled)</span>
                  </span>
                  <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    {clientCats.length} Categories
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[36px]">
                  {clientCats.length > 0 ? (
                    clientCats.map((c: string) => (
                      <span
                        key={c}
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50"
                      >
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">No buyer-mapped categories assigned yet.</span>
                  )}
                </div>
                <p className="text-[9.5px] text-slate-400">
                  Extracted from historical buyer pre-purchase orders &amp; master records (Larsen &amp; Toubro).
                </p>
              </div>

              {/* Card 2: Vendor Profile Self-Selected Categories */}
              <div className="p-3 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                    ⚙️ Vendor Self-Selected <span className="text-slate-400 text-[10px] font-normal">(Max 10)</span>
                  </span>
                  <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {flatSelectedCategories.length} / {MAX_CATEGORIES} Selected
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[36px]">
                  {flatSelectedCategories.length > 0 ? (
                    flatSelectedCategories.map((c) => {
                      const isCommon = commonCategories.includes(c);
                      return (
                        <span
                          key={c}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1 ${
                            isCommon
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200'
                              : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200'
                          }`}
                        >
                          {isCommon && <span className="text-[9px]">✓</span>}
                          {c}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">No categories selected. Pick up to 10 below.</span>
                  )}
                </div>
                <p className="text-[9.5px] text-slate-400">
                  Selected directly by vendor. Chips with ✓ indicate common match with buyer roster.
                </p>
              </div>
            </div>

            {/* Reconciliation Breakdown & Dispatch Policy */}
            <div className="p-3 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-900/40 text-[11px] space-y-1.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-indigo-600 dark:text-indigo-400" />
                  Backend Storage &amp; Dual RFQ Dispatch Policy:
                </span>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold">
                    {commonCategories.length} Aligned
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 font-bold">
                    +{vendorOnlyCategories.length} Vendor-Extended
                  </span>
                  {clientOnlyCategories.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold">
                      +{clientOnlyCategories.length} Client-Only
                    </span>
                  )}
                </div>
              </div>
              <p className="text-slate-600 dark:text-gray-300 text-[10.5px] leading-relaxed">
                {isAligned
                  ? 'All categories perfectly match between buyer roster and your self-selection. RFQs are fully aligned.'
                  : 'If there is any discrepancy between client-mapped categories and your self-selected categories, our backend permanently saves BOTH category sets. The matching engine routes RFQs corresponding to both streams to your opportunity feed so you never miss an opportunity.'}
              </p>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search supply categories (e.g. Valves, Bearings, Motors, Cables, Fasteners)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
            />
          </div>

          {/* Categories Selector Grid */}
          <div className="space-y-3 pt-1">
            {categoryTaxonomy.length === 0 && (
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                {categoryTaxonomyError || UI_STRINGS.buyerProfile.taxonomyEmpty}
              </p>
            )}
            {filteredCategories.map((cat) => {
              const isMajorSelected = selectedMajor.includes(cat.majorCategory);
              const selectedMinorsInCat = selectedMinor[cat.majorCategory] || [];
              const isExpanded = expandedMajor[cat.majorCategory] || false;

              return (
                <div
                  key={cat.majorCategory}
                  className={`rounded-2xl border transition-all ${
                    isMajorSelected
                      ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/60'
                  }`}
                >
                  {/* Major Category Bar */}
                  <div className="p-3.5 flex items-center justify-between gap-3 cursor-pointer">
                    <div className="flex items-center gap-3 flex-1" onClick={() => toggleMajorCategory(cat.majorCategory)}>
                      <button type="button" className="text-emerald-600 dark:text-emerald-400">
                        {isMajorSelected ? <CheckSquare size={18} /> : <Square size={18} className="text-slate-400" />}
                      </button>
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                          {cat.majorCategory}
                        </h3>
                        <p className="text-[10px] text-slate-500 dark:text-gray-400">
                          {cat.minorCategories.length} Minor Categories available
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 mono bg-white dark:bg-gray-900 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                        {selectedMinorsInCat.length} Selected
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedMajor((prev) => ({ ...prev, [cat.majorCategory]: !prev[cat.majorCategory] }))
                        }
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-gray-200"
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Minor Categories Grid */}
                  {isExpanded && (
                    <div className="p-3.5 pt-0 border-t border-slate-200/60 dark:border-gray-800/80 space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] pt-2">
                        <span className="font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                          Minor Supply Items (Click to select/unselect)
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {totalSelectedMinorCount} / {MAX_CATEGORIES} total profile limit
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {cat.minorCategories.map((minor) => {
                          const isMinorChecked = selectedMinorsInCat.includes(minor);
                          const isClientMapped = clientCats.includes(minor);
                          return (
                            <label
                              key={minor}
                              className={`p-2 rounded-xl border text-[11px] font-medium flex items-center gap-2 cursor-pointer transition-colors ${
                                isMinorChecked
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                  : 'bg-slate-50 dark:bg-gray-950 text-slate-700 dark:text-gray-300 border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isMinorChecked}
                                onChange={() => toggleMinorCategory(cat.majorCategory, minor)}
                                className="sr-only"
                              />
                              <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border ${isMinorChecked ? 'bg-white text-emerald-600 border-white' : 'border-slate-400'}`}>
                                {isMinorChecked && <span className="text-[10px] font-bold">✓</span>}
                              </div>
                              <span className="truncate flex-1" title={minor}>{minor}</span>
                              {isClientMapped && (
                                <span className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase shrink-0 ${isMinorChecked ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'}`} title="Mapped by buyer">
                                  Buyer
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isLoadingProfile || isSaving}
            className="btn btn-emerald btn-lg shadow-xl shadow-emerald-600/20 font-bold flex items-center gap-2 px-8 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save size={18} /> {isSaving ? 'Saving...' : 'Save & Reconcile Vendor Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
