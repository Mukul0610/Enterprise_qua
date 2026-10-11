'use client';

import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import {
  SOURCING_MODES,
  CURRENCY,
  formatFileSize,
  RFQ_DOCUMENT_LIMITS,
} from '@/lib/constants';
import { UI_STRINGS, formatString, extractionReasonMessage } from '@/lib/uiStrings';
import {
  createRFQ,
  extractLineItemsFromDocument,
  classifyLineItems,
  uploadRFQAttachment,
  fetchAllVendors,
  requestVendorCategoryUpdateEmail,
} from '@/lib/rfqClient';
import { buildExtractionRequest } from '@/lib/documentExtraction';
import {
  addManualRFQLineItem,
  createEmptyManualRFQForm,
  removeManualRFQLineItem,
  toRFQCreatePayload,
  fromExtractedEntity,
  updateManualRFQLineItem,
  validateManualRFQForm,
} from '@/lib/manualRfqModel';
import { PINCODE_PATTERN, isDummyPincode, validatePincode, PostOfficeDetail } from '@/lib/validationSchemas';
import { getMajorCategories, getMinorCategories, autoCategorizeItem, getDefaultMinorForMajor } from '@/lib/categoryTaxonomy';
import { isBuyerUploaded, isProcucevVendor } from './vendor-summary';
import { extractRfqCategorySignals, matchVendorAgainstSignals } from '@/lib/vendorMatching';
import type {
  ManualRFQForm,
  ManualRFQLineItem,
  RFQAttachment,
  RFQExtractionResult,
  RFQVendorCandidate,
  SourcingMode,
  VendorEntry,
  VendorPageMeta,
} from '@/lib/types';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Send,
  Trash2,
  Plus,
  FileText,
  AlertCircle,
  Paperclip,
  Loader2,
  Mail,
  FileCheck,
  RotateCcw,
  Building2,
  Phone,
  Star,
  Users,
  ShieldCheck,
  Tag,
  Info,
  Check,
  X,
  CheckSquare,
  Square,
  Search,
  ExternalLink,
  Zap,
} from 'lucide-react';

const EXTRACTION = UI_STRINGS.rfqExtraction;
const MODAL = UI_STRINGS.manualRfqModal;

// A synthetic major-category value, never sent to the server as a real
// category (sanitized back to '' before submission) — opts a line item out
// of category-narrowed supplier matching so the marketplace-suppliers panel
// shows the whole real directory instead. Distinct from the "" placeholder
// value so the Minor Category select and validation still treat it as "a
// category was chosen", not "nothing chosen yet".
const ALL_CATEGORIES_OPTION = 'All Categories';
const ALL_VENDORS_PAGE_SIZE = 100;
const ALL_VENDORS_SEARCH_DEBOUNCE_MS = 350;

const SOURCING_VERSION_LABELS: Record<string, string> = {
  mode_0: UI_STRINGS.sourcingModeVersions.mode_0,
  mode_1: UI_STRINGS.sourcingModeVersions.mode_1,
  mode_2: UI_STRINGS.sourcingModeVersions.mode_2,
  mode_3: UI_STRINGS.sourcingModeVersions.mode_3,
};

function taxonomyMajors(): string[] {
  return getMajorCategories();
}

function minorsFor(major: string): string[] {
  return getMinorCategories(major);
}

function withStoredValue(options: string[], value: string): string[] {
  const trimmed = (value || '').trim();
  if (trimmed === '' || options.some((o) => o.toLowerCase() === trimmed.toLowerCase())) return options;
  return [trimmed, ...options];
}

interface IngestionWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  forceSubscription?: 'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none';
  forceRemainingFreeRFQs?: number;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1 font-medium">{message}</p>;
}

export default function IngestionWizard({
  onComplete,
  onCancel,
  forceSubscription,
  forceRemainingFreeRFQs,
}: IngestionWizardProps) {
  const {
    addNewRFQ,
    adoptCreatedRFQ,
    currentMode,
    setCurrentMode,
    showToast,
    activeSubscription: storeSubscription,
    buyerVendors,
    addBuyerVendor,
    categoryTaxonomy,
    remainingFreeRFQs: storeRemaining,
    activeBuyerAccount,
  } = useApp();

  const effectivePlan = forceSubscription ?? activeBuyerAccount?.subscriptionPlan ?? storeSubscription ?? 'free_trial';
  const effectiveRemaining =
    forceRemainingFreeRFQs !== undefined
      ? forceRemainingFreeRFQs
      : (activeBuyerAccount?.remainingFreeRFQs ?? storeRemaining ?? 5);
  const isPaidPlan = ['version_1', 'version_2', 'version_3'].includes(effectivePlan);
  const [form, setForm] = useState<ManualRFQForm>(() => ({
    ...createEmptyManualRFQForm(),
    sourcingMode: currentMode || 'mode_2',
  }));
  const isQuotaExhausted = !isPaidPlan && effectiveRemaining <= 0 && form.sourcingMode !== 'mode_0';

  // Auto-prefill delivery location and pincode from active buyer profile
  useEffect(() => {
    if (activeBuyerAccount) {
      const defaultLoc = activeBuyerAccount.city && activeBuyerAccount.state
        ? `${activeBuyerAccount.city}, ${activeBuyerAccount.state}`
        : (activeBuyerAccount.primaryPlantLocation || '');
      const defaultPin = activeBuyerAccount.pincode || '';
      setForm((prev) => {
        if (!prev.deliveryLocation && !prev.deliveryPincode && (defaultLoc || defaultPin)) {
          return {
            ...prev,
            deliveryLocation: prev.deliveryLocation || defaultLoc,
            deliveryPincode: prev.deliveryPincode || defaultPin,
          };
        }
        return prev;
      });
    }
  }, [activeBuyerAccount]);

  const [mode1VendorSearch, setMode1VendorSearch] = useState('');
  const [isAddVendorModalOpen, setIsAddVendorModalOpen] = useState(false);
  const [vendorFormName, setVendorFormName] = useState('');
  const [vendorFormContactPerson, setVendorFormContactPerson] = useState('');
  const [vendorFormPhone, setVendorFormPhone] = useState('');
  const [vendorFormEmail, setVendorFormEmail] = useState('');
  const [vendorFormMajorCategory, setVendorFormMajorCategory] = useState('');
  const [vendorFormMinorCategories, setVendorFormMinorCategories] = useState<string[]>([]);
  const [vendorFormCity, setVendorFormCity] = useState('');
  const [vendorFormState, setVendorFormState] = useState('');
  const [vendorFormPincode, setVendorFormPincode] = useState('');
  const [vendorFormPincodeError, setVendorFormPincodeError] = useState<string | null>(null);
  const [vendorFormPincodeValidating, setVendorFormPincodeValidating] = useState(false);
  const [vendorFormPincodePostOffices, setVendorFormPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  const vendorFormPincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const raw = vendorFormPincode.trim();
    if (vendorFormPincodeDebounceRef.current) clearTimeout(vendorFormPincodeDebounceRef.current);
    if (!raw) {
      setVendorFormPincodeError(null);
      setVendorFormPincodeValidating(false);
      setVendorFormPincodePostOffices([]);
      return;
    }
    if (isDummyPincode(raw)) {
      setVendorFormPincodeError('Invalid or dummy PIN code');
      setVendorFormPincodeValidating(false);
      setVendorFormPincodePostOffices([]);
      return;
    }
    if (raw.length >= 3 && !PINCODE_PATTERN.test(raw)) {
      setVendorFormPincodeError('Invalid PIN code format');
      setVendorFormPincodeValidating(false);
      setVendorFormPincodePostOffices([]);
      return;
    }
    if (/^\d{6}$/.test(raw)) {
      setVendorFormPincodeValidating(true);
      vendorFormPincodeDebounceRef.current = setTimeout(async () => {
        try {
          const res = await validatePincode(raw);
          if (!res.isValid) {
            setVendorFormPincodeError(res.message || 'Invalid PIN code');
            setVendorFormPincodePostOffices([]);
          } else {
            setVendorFormPincodeError(null);
            setVendorFormPincodePostOffices(res.postOffices || []);
          }
        } catch {
          setVendorFormPincodeError(null);
        } finally {
          setVendorFormPincodeValidating(false);
        }
      }, 350);
    } else {
      setVendorFormPincodeError(null);
      setVendorFormPincodeValidating(false);
      setVendorFormPincodePostOffices([]);
    }
  }, [vendorFormPincode]);
  const [vendorFormGstin, setVendorFormGstin] = useState('');
  const [isSubmittingVendor, setIsSubmittingVendor] = useState(false);
  const [sendingCategoryEmailVendors, setSendingCategoryEmailVendors] = useState<string[]>([]);
  const [sentCategoryEmailVendors, setSentCategoryEmailVendors] = useState<string[]>([]);
  const [vendorCategoryFilterTab, setVendorCategoryFilterTab] = useState<'all' | 'matched' | 'mismatched'>('all');
  const [mode2VendorSearch, setMode2VendorSearch] = useState('');
  const [mode2VendorCategoryFilterTab, setMode2VendorCategoryFilterTab] = useState<'all' | 'matched' | 'mismatched'>('all');

  const handleSendCategoryUpdateEmail = async (vendor: any, rfqCategorySignals: string[]) => {
    const vendorKey = vendor?.id || vendor?.email;
    if (!vendorKey) return;
    setSendingCategoryEmailVendors((prev) => [...prev, vendorKey]);
    try {
      const res = await requestVendorCategoryUpdateEmail({
        vendorId: vendor.id,
        vendorEmail: vendor.email,
        vendorName: vendor.name || vendor.contactPerson,
        rfqCategory: rfqCategorySignals.join(', ') || form.lineItems?.[0]?.majorCategory || 'Requested Category',
        rfqTitle: form.title || 'Procurement Requisition',
      });
      if (res.success) {
        setSentCategoryEmailVendors((prev) => [...prev, vendorKey]);
        showToast(
          'Category Update Email Sent',
          `An email has been sent to ${vendor.name || vendor.contactPerson || 'Vendor'} (${vendor.email}) requesting them to update their category to match this RFQ.`,
          'success'
        );
      } else {
        showToast('Email Delivery Issue', res.error || 'Failed to dispatch email.', 'warning');
      }
    } catch (err: any) {
      showToast('Error', err?.message || 'Failed to send update email.', 'warning');
    } finally {
      setSendingCategoryEmailVendors((prev) => prev.filter((id) => id !== vendorKey));
    }
  };

  const resetAddVendorForm = () => {
    setVendorFormName('');
    setVendorFormContactPerson('');
    setVendorFormPhone('');
    setVendorFormEmail('');
    setVendorFormMajorCategory(taxonomyMajors()[0] || 'IT');
    setVendorFormMinorCategories([]);
    setVendorFormCity('');
    setVendorFormState('');
    setVendorFormPincode('');
    setVendorFormGstin('');
  };

  const handleAddVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !vendorFormName.trim() ||
      !vendorFormContactPerson.trim() ||
      !vendorFormPhone.trim() ||
      !vendorFormEmail.trim() ||
      !vendorFormMajorCategory ||
      !vendorFormCity.trim() ||
      !vendorFormState.trim() ||
      !vendorFormPincode.trim() ||
      !vendorFormGstin.trim()
    ) {
      showToast('Missing Details', 'Please fill in all mandatory fields including City, State, Pincode, and GSTIN.', 'warning');
      return;
    }

    if (!/^[1-9][0-9]{5}$/.test(vendorFormPincode.trim())) {
      showToast('Invalid Pincode', 'Please enter a valid 6-digit PIN code.', 'warning');
      return;
    }
    if (vendorFormPincodeError) {
      showToast('Invalid Pincode', vendorFormPincodeError, 'warning');
      return;
    }

    setIsSubmittingVendor(true);
    try {
      await addBuyerVendor({
        name: vendorFormName.trim(),
        contactPerson: vendorFormContactPerson.trim(),
        phone: vendorFormPhone.trim(),
        email: vendorFormEmail.trim().toLowerCase(),
        majorCategory: vendorFormMajorCategory,
        minorCategories: vendorFormMinorCategories,
        city: vendorFormCity.trim(),
        state: vendorFormState.trim(),
        pincode: vendorFormPincode.trim(),
        gst: vendorFormGstin.trim().toUpperCase(),
        location: `${vendorFormCity.trim()}, ${vendorFormState.trim()}`,
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        rating: 4.5,
        score: 90,
        source: 'buyer_uploaded',
        addedByBuyerCompany: activeBuyerAccount?.organizationName || 'My Organization',
        annualTurnover: '₹1 Cr - ₹10 Cr',
      });
      showToast('Vendor Added', `${vendorFormName.trim()} was successfully added to your approved vendor roster.`, 'success');
      setIsAddVendorModalOpen(false);
      resetAddVendorForm();
    } catch (err: any) {
      showToast('Failed to Add Vendor', err?.message || 'Could not save vendor.', 'warning');
    } finally {
      setIsSubmittingVendor(false);
    }
  };

  let router: any = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter();
  } catch {
    router = null;
  }
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [confirmationRfq, setConfirmationRfq] = useState<any | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // "All Categories" opts a line item out of category-narrowed matching — the
  // marketplace-suppliers panel then browses the whole real vendor directory
  // instead (search + pagination, same server-backed pattern as the Invite
  // Vendors "All Vendors" tab), rather than the always-0-at-scale client match
  // that would otherwise run against the capped bootstrap vendor list.
  const isAllCategories = form.lineItems.some((item) => item.majorCategory === ALL_CATEGORIES_OPTION);
  // The specific category to browse via the same real, paginated,
  // server-backed search — not just the "All Categories" case. Client-side
  // matching against the capped 500-vendor bootstrap snapshot silently
  // undercounts (or misses entirely) at real scale: a bulk import alone put
  // 4000+ vendors in a single category, none of which are guaranteed to be
  // among the 500 vendors that happened to load into that snapshot.
  const selectedMajorCategory = isAllCategories
    ? ''
    : form.lineItems.find((item) => item.majorCategory && item.majorCategory !== ALL_CATEGORIES_OPTION)?.majorCategory || '';
  const [allVendorsSearch, setAllVendorsSearch] = useState('');
  const [debouncedAllVendorsSearch, setDebouncedAllVendorsSearch] = useState('');
  const [allVendorsList, setAllVendorsList] = useState<RFQVendorCandidate[]>([]);
  const [allVendorsPagination, setAllVendorsPagination] = useState<VendorPageMeta | null>(null);
  const [allVendorsLoading, setAllVendorsLoading] = useState(false);
  const [allVendorsLoadingMore, setAllVendorsLoadingMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedAllVendorsSearch(allVendorsSearch), ALL_VENDORS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [allVendorsSearch]);

  const lastAllVendorsKeyRef = useRef<string | null>(null);
  // Guards against a slower, earlier request resolving AFTER a newer,
  // re-searched one and overwriting it with stale results.
  const allVendorsFetchSeqRef = useRef(0);
  useEffect(() => {
    if (!isAllCategories && !selectedMajorCategory) return;
    const key = `${selectedMajorCategory}::${debouncedAllVendorsSearch}`;
    if (allVendorsList.length > 0 && lastAllVendorsKeyRef.current === key) return;
    lastAllVendorsKeyRef.current = key;
    const seq = ++allVendorsFetchSeqRef.current;
    setAllVendorsLoading(true);
    void fetchAllVendors({
      page: 1,
      pageSize: ALL_VENDORS_PAGE_SIZE,
      search: debouncedAllVendorsSearch,
      category: selectedMajorCategory,
    }).then((result) => {
      if (seq !== allVendorsFetchSeqRef.current) return;
      if (result.success) {
        setAllVendorsList(result.candidates);
        setAllVendorsPagination(result.pagination);
      }
      setAllVendorsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allVendorsList is only read as a "has loaded yet" guard, not a re-fetch trigger
  }, [isAllCategories, selectedMajorCategory, debouncedAllVendorsSearch]);

  const loadMoreAllVendors = () => {
    if (!allVendorsPagination || allVendorsLoadingMore) return;
    const nextPage = allVendorsPagination.page + 1;
    if (nextPage > allVendorsPagination.totalPages) return;
    const seq = ++allVendorsFetchSeqRef.current;
    setAllVendorsLoadingMore(true);
    void fetchAllVendors({
      page: nextPage,
      pageSize: ALL_VENDORS_PAGE_SIZE,
      search: debouncedAllVendorsSearch,
      category: selectedMajorCategory,
    }).then((result) => {
      if (seq !== allVendorsFetchSeqRef.current) return;
      if (result.success) {
        setAllVendorsList((prev) => [...prev, ...result.candidates]);
        setAllVendorsPagination(result.pagination);
      }
      setAllVendorsLoadingMore(false);
    });
  };

  /**
   * The "All Categories" branch of the marketplace-suppliers panel: a real
   * server-searched, paginated browse of the whole vendor directory, in
   * place of the client-side category match (which has nothing to match
   * against once "All Categories" is chosen). Shared between Mode 2 and
   * Mode 3 — only the accent color and "no results" copy differ.
   */
  function renderAllVendorsBrowsePanel(accent: 'emerald' | 'indigo') {
    const ring = accent === 'emerald' ? 'focus:ring-emerald-300' : 'focus:ring-indigo-300';
    const border = accent === 'emerald' ? 'border-emerald-200/70 dark:border-emerald-900/50' : 'border-indigo-200/70 dark:border-indigo-900/50';
    const hoverBorder = accent === 'emerald' ? 'hover:border-emerald-400' : 'hover:border-indigo-400';
    const text = accent === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : 'text-indigo-700 dark:text-indigo-300';
    const btnBorder = accent === 'emerald' ? 'border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40' : 'border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40';

    return (
      <>
        <input
          type="text"
          value={allVendorsSearch}
          onChange={(e) => setAllVendorsSearch(e.target.value)}
          placeholder="Search suppliers by name, email or category..."
          className={`w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs focus:outline-none focus:ring-2 ${ring}`}
        />

        {allVendorsLoading ? (
          <div className="p-3.5 text-center text-[11px] text-slate-400 dark:text-gray-500">Loading suppliers…</div>
        ) : allVendorsList.length === 0 ? (
          <div className="p-3.5 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500">
            No suppliers match this search.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto pr-1">
              {allVendorsList.map((v) => (
                <div key={v.id} className={`p-3 rounded-xl bg-white dark:bg-gray-900 border ${border} space-y-1 shadow-2xs ${hoverBorder} transition-colors`}>
                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate block" title={v.name}>
                    {v.name}
                  </span>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                    <span className={`truncate font-semibold ${text}`}>{v.majorCategory || 'General Industrial'}</span>
                    <span className="truncate">{v.city || v.state || v.location || 'India'}</span>
                  </div>
                </div>
              ))}
            </div>
            {allVendorsPagination && allVendorsPagination.page < allVendorsPagination.totalPages && (
              <button
                type="button"
                onClick={loadMoreAllVendors}
                disabled={allVendorsLoadingMore}
                className={`w-full text-[11px] font-semibold ${text} py-2 rounded-lg border ${btnBorder} disabled:opacity-50`}
              >
                {allVendorsLoadingMore ? 'Loading…' : 'Load more suppliers'}
              </button>
            )}
          </>
        )}
      </>
    );
  }

  // Document Upload & AI Extraction State
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDraggingDoc, setIsDraggingDoc] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCategorizing, setIsCategorizing] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionSummary, setExtractionSummary] = useState<{
    model: string;
    accepted: number;
    needsReview: number;
    fileName: string;
  } | null>(null);
  const [showAiInfo, setShowAiInfo] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pincodeError, setPincodeError] = useState<string | null>(null);
  const [pincodeValidating, setPincodeValidating] = useState(false);
  const [pincodePostOffices, setPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  const pincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lineItemsSectionRef = useRef<HTMLElement | null>(null);

  const validation = useMemo(() => validateManualRFQForm(form), [form]);
  const formErrors = submitAttempted ? validation.formErrors : {};
  const lineItemErrors = submitAttempted ? validation.lineItemErrors : {};

  const patchForm = useCallback(<K extends keyof ManualRFQForm>(key: K, value: ManualRFQForm[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'title' && typeof value === 'string' && value.trim().length >= 3) {
        const auto = autoCategorizeItem(value);
        if (auto.majorCategory) {
          if (!next.majorCategory) next.majorCategory = auto.majorCategory;
          if (next.lineItems.length > 0 && !next.lineItems[0].majorCategory) {
            next.lineItems = [
              {
                ...next.lineItems[0],
                majorCategory: auto.majorCategory,
                minorCategory: auto.minorCategory,
              },
              ...next.lineItems.slice(1),
            ];
          }
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const raw = form.deliveryPincode.trim();
    if (pincodeDebounceRef.current) {
      clearTimeout(pincodeDebounceRef.current);
    }
    if (!raw) {
      setPincodeError(null);
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }

    if (isDummyPincode(raw)) {
      setPincodeError(UI_STRINGS.manualRfq.deliveryPincodeDummy);
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }

    if (raw.length >= 3 && !PINCODE_PATTERN.test(raw)) {
      setPincodeError(UI_STRINGS.manualRfq.deliveryPincodeInvalid);
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
            setPincodeError(res.message || UI_STRINGS.manualRfq.deliveryPincodeInvalid);
            setPincodePostOffices([]);
          } else {
            setPincodeError(null);
            setPincodePostOffices(res.postOffices || []);
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
  }, [form.deliveryPincode]);

  const patchItem = useCallback((id: string, patch: Partial<ManualRFQLineItem>) => {
    setForm((prev) => updateManualRFQLineItem(prev, id, patch));
  }, []);

  /** Handles file selection via picker or drag-and-drop */
  const handleFilesSelected = (files: FileList | null | File[]) => {
    if (!files) return;
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    const validFiles: File[] = [];
    for (const file of fileList) {
      if (file.size > RFQ_DOCUMENT_LIMITS.MAX_FILE_SIZE_BYTES) {
        showToast(
          'File Too Large',
          `"${file.name}" exceeds the 15 MB file size limit (${formatFileSize(file.size)}).`,
          'warning'
        );
      } else {
        validFiles.push(file);
      }
    }

    if (validFiles.length > 0) {
      setUploadedFiles((prev) => [...prev, ...validFiles]);
      setExtractionError(null);
    }
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /** AI Extraction: processes uploaded document (.eml, .msg, .xlsx, .pdf, .docx, .csv) into form */
  const handleExtractFromFiles = async () => {
    setIsExtracting(true);
    setExtractionError(null);
    setExtractionSummary(null);

    const primaryFile = uploadedFiles[0];
    try {
      const payload = await buildExtractionRequest(primaryFile);
      const result: RFQExtractionResult = await extractLineItemsFromDocument(payload);

      if (result.success && result.data) {
        const extracted = result.data.extractedEntities.map(fromExtractedEntity);
        const derivedTitle = result.data.title || '';
        const derivedBudget = result.data.estimatedBudget ?? null;
        const derivedMajor = extracted[0]?.majorCategory || '';
        const derivedLocation = result.data.deliveryLocation || '';
        const derivedPincode = result.data.deliveryPincode || '';
        const derivedDate = result.data.targetDeliveryDate || '';

        setForm((prev) => ({
          ...prev,
          title: prev.title || derivedTitle,
          estimatedBudget: prev.estimatedBudget ?? derivedBudget,
          majorCategory: prev.majorCategory || derivedMajor,
          deliveryLocation: prev.deliveryLocation || derivedLocation,
          deliveryPincode: prev.deliveryPincode || derivedPincode,
          targetDeliveryDate: prev.targetDeliveryDate || derivedDate,
          lineItems: extracted.length > 0 ? extracted : prev.lineItems,
        }));

        setExtractionSummary({
          model: result.extraction?.model || 'Gemini 2.5 AI',
          accepted: result.classification?.accepted ?? extracted.length,
          needsReview: result.classification?.needsReview ?? 0,
          fileName: primaryFile.name,
        });

        showToast(
          EXTRACTION.successTitle,
          formatString(EXTRACTION.successToast, { accepted: extracted.length, fileName: primaryFile.name }),
          'success'
        );
      } else {
        const msg = extractionReasonMessage(result.reason, result.error);
        setExtractionError(msg);
        showToast(EXTRACTION.fallbackTitle, msg, 'warning');
      }
    } catch {
      const msg = EXTRACTION.unreadableResponse;
      setExtractionError(msg);
      showToast(EXTRACTION.fallbackTitle, msg, 'warning');
    } finally {
      setIsExtracting(false);
    }
  };

  /**
   * Recovery action from the failure banner: ensure there is at least one line
   * item to key into and bring the line-item table into view, so a failed
   * extraction leads straight into manual entry.
   */
  const handleEnterManually = () => {
    setForm((prev) => (prev.lineItems.length === 0 ? addManualRFQLineItem(prev) : prev));
    setExtractionError(null);
    showToast(EXTRACTION.fallbackTitle, EXTRACTION.manualEntryStarted, 'info');
    lineItemsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** Auto-categorize all line items with AI */
  const handleAutoCategorizeAll = async () => {
    setIsCategorizing(true);
    try {
      let detectedMajor = '';
      const updatedLineItems = form.lineItems.map((item) => {
        const auto = autoCategorizeItem(item.itemName, item.technicalSpecs || form.title);
        const nextMajor = auto.majorCategory || item.majorCategory || form.majorCategory || 'Engineering Spares - Mechanical';
        const nextMinor = auto.minorCategory || (nextMajor ? getDefaultMinorForMajor(nextMajor) : '') || 'Pumps & Accessories';
        if (nextMajor && !detectedMajor) detectedMajor = nextMajor;
        return {
          ...item,
          majorCategory: nextMajor,
          minorCategory: nextMinor,
        };
      });

      setForm((prev) => ({
        ...prev,
        majorCategory: detectedMajor || prev.majorCategory || (prev.title ? autoCategorizeItem(prev.title).majorCategory : '') || 'Engineering Spares - Mechanical',
        lineItems: updatedLineItems,
      }));

      // Also call backend classifyLineItems if items exist
      const quotableEntities = form.lineItems
        .map((item) => ({
          id: item.id,
          itemName: item.itemName,
          technicalSpecs: item.technicalSpecs,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || 'nos',
          targetDate: item.targetDate || '',
          category: item.minorCategory,
          majorCategory: item.majorCategory,
          minorCategory: item.minorCategory,
          confidence: 0,
        }))
        .filter((e) => e.itemName.trim() !== '');

      if (quotableEntities.length > 0) {
        try {
          const result = await classifyLineItems(quotableEntities);
          if (result.success && result.data && Array.isArray(result.data.extractedEntities)) {
            const classified = new Map(result.data.extractedEntities.map((e) => [e.id, e]));
            setForm((prev) => ({
              ...prev,
              lineItems: prev.lineItems.map((item) => {
                const matched = classified.get(item.id);
                if (!matched) return item;
                const nextMajor = matched.majorCategory || item.majorCategory;
                const nextMinor =
                  matched.minorCategory ||
                  item.minorCategory ||
                  (nextMajor ? getDefaultMinorForMajor(nextMajor) : '');
                return {
                  ...item,
                  majorCategory: nextMajor,
                  minorCategory: nextMinor,
                };
              }),
            }));
          }
        } catch {}
      }

      showToast(
        EXTRACTION.classifySuccessTitle,
        `Auto-classified ${form.lineItems.length} line items with appropriate categories.`,
        'success'
      );
    } catch {
      showToast(EXTRACTION.fallbackTitle, 'Category auto-classification updated.', 'info');
    } finally {
      setIsCategorizing(false);
    }
  };

  /** Store uploaded files as RFQ attachments before creating the RFQ */
  const uploadAttachments = async (): Promise<RFQAttachment[]> => {
    if (uploadedFiles.length === 0) return [];
    const attachments: RFQAttachment[] = [];

    for (const file of uploadedFiles) {
      try {
        const res = await uploadRFQAttachment(file);
        if (res.success && res.data) {
          attachments.push(res.data);
        }
      } catch {
        // Continue with other attachments
      }
    }
    return attachments;
  };

  /** Form Submission / RFQ Dispatch */
  const handleSubmit = async () => {
    setSubmitAttempted(true);
    setSubmitError(null);

    if (isQuotaExhausted) {
      setSubmitError(EXTRACTION.quotaExhaustedMessage);
      showToast('Quota Exhausted', 'Please upgrade your plan to continue creating RFQs.', 'warning');
      return;
    }

    const validation = validateManualRFQForm(form);
    if (!validation.isValid) {
      const missing: string[] = [];
      if (validation.formErrors.title) missing.push('RFQ Title');
      if (validation.formErrors.deliveryLocation) missing.push('Delivery Location');
      if (validation.formErrors.deliveryPincode) missing.push('Delivery Pincode');
      if (validation.formErrors.targetDeliveryDate) missing.push('Target Delivery Date (cannot be in the past)');
      if (validation.formErrors.lineItems) missing.push('At least 1 complete line item');
      const lineItemErrCount = Object.keys(validation.lineItemErrors).length;
      if (lineItemErrCount > 0) {
        missing.push(`${lineItemErrCount} line item(s) missing name, quantity, or unit`);
      }
      const errorMsg = missing.length > 0
        ? `Validation Error – Please complete: ${missing.join(', ')}.`
        : 'Validation Error – Please complete all required fields and line items before dispatching.';
      showToast('Validation Error', errorMsg, 'warning');
      return;
    }

    if (isDispatching) return;
    setIsDispatching(true);

    try {
      setCurrentMode(form.sourcingMode);

      // Upload any staged files as attachments
      const storedAttachments = await uploadAttachments();
      const updatedForm: ManualRFQForm = {
        ...form,
        attachments: [...form.attachments, ...storedAttachments],
      };

      type AssignedVendorEntry = {
        id?: string;
        name: string;
        email?: string | null;
        contactPerson?: string | null;
        phone?: string | null;
      };
      const toAssignedVendorEntry = (v: VendorEntry): AssignedVendorEntry => ({
        id: v.id,
        name: v.name || 'Enterprise Vendor',
        email: v.email || null,
        contactPerson: v.contactPerson || v.name || null,
        phone: v.phone || null,
      });

      let mode1AssignedVendors: AssignedVendorEntry[] | undefined = undefined;

      if ((form.sourcingMode === 'mode_1' || form.sourcingMode === 'mode_2') && Array.isArray(buyerVendors)) {
        const pool = form.sourcingMode === 'mode_1'
          ? buyerVendors.filter((v) => isBuyerUploaded(v))
          : buyerVendors;
        const { signals: dispatchSignals } = extractRfqCategorySignals(updatedForm);
        const candidatePool = selectedVendorIds.length > 0
          ? pool.filter((v) => selectedVendorIds.includes(v.id))
          : pool;

        const matchingVendors: typeof candidatePool = [];
        const mismatchedVendors: typeof candidatePool = [];

        for (const v of candidatePool) {
          if (dispatchSignals.length === 0 || matchVendorAgainstSignals(v, dispatchSignals).isMatch) {
            matchingVendors.push(v);
          } else {
            mismatchedVendors.push(v);
          }
        }

        if (mismatchedVendors.length > 0) {
          showToast(
            'Shortlist Adjusted',
            `${mismatchedVendors.length} vendor(s) have category mismatches and were excluded from RFQ shortlist. Update request email dispatched.`,
            'info'
          );
        }

        if (matchingVendors.length > 0) {
          mode1AssignedVendors = matchingVendors.map(toAssignedVendorEntry);
        }
      }

      if (form.sourcingMode === 'mode_1' && (!mode1AssignedVendors || mode1AssignedVendors.length === 0)) {
        setSubmitError('Version 1 (Client Sourcing) requires at least one private vendor to be added/selected before creating the RFQ.');
        showToast('Private Vendor Required', 'Version 1 requires at least one private vendor in your roster before dispatching.', 'warning');
        return;
      }

      // ALL_CATEGORIES_OPTION is a UI-only sentinel that opts a line item out
      // of category-narrowed matching — never a real taxonomy value, so it
      // must never reach the server as this item's majorCategory.
      const sanitizedForm: ManualRFQForm = {
        ...updatedForm,
        lineItems: updatedForm.lineItems.map((item) =>
          item.majorCategory === ALL_CATEGORIES_OPTION ? { ...item, majorCategory: '' } : item
        ),
      };
      const rfqSource = 'ai_extraction';
      const payload = toRFQCreatePayload(sanitizedForm, mode1AssignedVendors, rfqSource);
      if (extractionSummary?.fileName) {
        payload.sourceFileName = extractionSummary.fileName;
      }
      const result = await createRFQ(payload);

      if (!result.success) {
        setSubmitError(result.error || 'Failed to create RFQ.');
        showToast('Creation Failed', result.error || 'Failed to create RFQ.', 'warning');
        return;
      }

      adoptCreatedRFQ(result.rfq);
      setConfirmationRfq(result.rfq);
      setSubmitAttempted(false);
      showToast(
        'RFQ Dispatched',
        `RFQ ${result.rfq.rfqNumber} has been created and dispatched in ${form.sourcingMode.toUpperCase()} mode.`,
        'success'
      );
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to dispatch RFQ.');
    } finally {
      setIsDispatching(false);
    }
  };

  /** Clears all form fields, line items, and uploaded documents */
  const handleClearForm = () => {
    setForm({
      ...createEmptyManualRFQForm(),
      sourcingMode: currentMode || 'mode_2',
    });
    setUploadedFiles([]);
    setExtractionSummary(null);
    setExtractionError(null);
    setSubmitAttempted(false);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    showToast('Form Cleared', 'All fields, line items, and uploaded files have been reset.', 'info');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-2.5 animate-fade-in pb-4">
      {/* Quota Exhausted Banner */}
      {isQuotaExhausted && (
        <div
          data-testid="ingestion-wizard-quota-exhausted-banner"
          className="p-3.5 rounded-xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-emerald-500/10 border border-amber-500/30 dark:bg-amber-950/40 dark:border-amber-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm"
        >
          <div className="flex items-start gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
              <AlertCircle size={20} />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-amber-950 dark:text-amber-200">
                  {EXTRACTION.quotaExhaustedTitle}
                </h3>
                <span className="badge badge-emerald text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                  <Zap size={10} className="fill-current" />
                  {EXTRACTION.v0FreeBadge}
                </span>
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                {EXTRACTION.quotaExhaustedMessage}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => patchForm('sourcingMode', 'mode_0')}
              className="btn btn-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1.5 px-3 py-1.5 text-xs shadow-xs cursor-pointer"
            >
              <Zap size={13} className="fill-current" />
              <span>{EXTRACTION.useV0Action}</span>
            </button>
            <a
              href="/buyer/subscription-center"
              className="btn btn-primary font-bold shrink-0 inline-flex items-center gap-2 px-3 py-1.5 text-xs shadow-md hover:shadow-lg"
            >
              <Sparkles size={13} />
              <span>{EXTRACTION.upgradePlanAction}</span>
            </a>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TOP: DOCUMENT & REQUISITION EMAIL UPLOAD & AI EXTRACTION      */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="glass-panel p-3 sm:p-3.5 rounded-xl space-y-2.5 border border-indigo-100 dark:border-indigo-950 bg-gradient-to-br from-indigo-50/50 via-white to-sky-50/30 dark:from-gray-900/90 dark:via-gray-900/80 dark:to-indigo-950/20 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100/60 dark:border-gray-800 pb-2.5">
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <UploadCloud size={16} className="text-indigo-600 dark:text-indigo-400" />
              Upload Source Documents & Forwarded Emails
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isExtracting}
              className="btn btn-secondary btn-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Paperclip size={13} /> Select Files
            </button>
            <button
              onClick={handleExtractFromFiles}
              disabled={isExtracting || uploadedFiles.length === 0}
              className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
            >
              {isExtracting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {isExtracting ? 'Extracting with AI...' : 'Extract Line Items with AI'}
            </button>
          </div>
        </div>

        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          multiple
          className="hidden"
          accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.eml,.msg"
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />

        {/* Drag & Drop Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingDoc(true);
          }}
          onDragLeave={() => setIsDraggingDoc(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingDoc(false);
            if (e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files);
          }}
          className={`border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer group ${
            isDraggingDoc
              ? 'border-indigo-600 bg-indigo-100/70 dark:bg-indigo-900/50 scale-[1.01]'
              : 'border-indigo-300/80 dark:border-indigo-500/30 hover:border-indigo-500 bg-white/70 dark:bg-gray-900/40 hover:bg-indigo-50/50'
          }`}
        >
          <div className="flex items-center justify-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-600/20 border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
              <FileSpreadsheet size={18} />
            </div>
            <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-600/20 border border-sky-200 dark:border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400 group-hover:scale-110 transition-transform">
              <Mail size={18} />
            </div>
          </div>
          <h3 className="text-xs font-bold text-slate-800 dark:text-white mt-1.5">
            {isExtracting ? 'Gemini AI is parsing document contents...' : 'Drag and drop BOQ spreadsheets or .eml / .msg emails here'}
          </h3>
        </div>

        {/* Uploaded Files List */}
        {uploadedFiles.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-gray-300">
              <span className="flex items-center gap-1.5">
                <FileCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                Uploaded Documents ({uploadedFiles.length})
              </span>
              <span className="text-[10px] text-slate-400">Click &quot;Extract Line Items with AI&quot; to auto-fill form</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {uploadedFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 shadow-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {file.name.endsWith('.eml') || file.name.endsWith('.msg') ? (
                      <Mail size={16} className="text-sky-600 dark:text-sky-400 shrink-0" />
                    ) : (
                      <FileText size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-gray-200 truncate">{file.name}</p>
                      <p className="text-[10px] text-slate-400">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveFile(idx)}
                    className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                    title="Remove file"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Extraction Outcome Banners */}
        {extractionSummary && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs">
            <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Sparkles size={14} /> Extraction Complete
            </div>
            <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200 mt-0.5">
              Successfully extracted <strong>{extractionSummary.accepted} line items</strong> from &ldquo;{extractionSummary.fileName}&rdquo;
            </p>
          </div>
        )}

        {extractionError && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/60 text-xs space-y-2">
            <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
              <AlertCircle size={14} /> {EXTRACTION.fallbackTitle}
            </div>
            <p className="text-[11px] text-amber-900/90 dark:text-amber-200">{extractionError}</p>
            <button
              type="button"
              onClick={handleEnterManually}
              className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 shadow-xs"
            >
              <Plus size={13} />
              <span>{EXTRACTION.manualEntryAction}</span>
            </button>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MERGED SECTIONS 1, 2 & 3: RFQ DETAILS, LINE ITEMS & SOURCING  */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section ref={lineItemsSectionRef} className="glass-panel p-3.5 sm:p-4 rounded-xl space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-gray-800 pb-2.5">
          <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText size={16} className="text-indigo-600 dark:text-indigo-400" />
            1. RFQ Details & Delivery Terms
          </h2>
          <button
            onClick={handleClearForm}
            type="button"
            className="btn btn-secondary btn-sm font-semibold inline-flex items-center gap-1.5 text-slate-600 hover:text-rose-600 dark:text-gray-300 dark:hover:text-rose-400 cursor-pointer self-end sm:self-auto"
          >
            <RotateCcw size={13} />
            <span>Clear Form</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-xs">
          {/* RFQ Title */}
          <div className="xl:col-span-2">
            <label htmlFor="rfq-title" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {MODAL.titleLabel}
            </label>
            <input
              id="rfq-title"
              type="text"
              value={form.title}
              onChange={(e) => patchForm('title', e.target.value)}
              placeholder={MODAL.titlePlaceholder}
              maxLength={200}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500"
            />
            <FieldError message={formErrors.title} />
          </div>

          {/* Estimated Budget */}
          <div>
            <label htmlFor="rfq-budget" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {formatString(MODAL.budgetLabel, { symbol: CURRENCY.SYMBOL })}{' '}
              <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">({MODAL.optionalTag})</span>
            </label>
            <input
              id="rfq-budget"
              type="number"
              min={0}
              value={form.estimatedBudget ?? ''}
              onChange={(e) => patchForm('estimatedBudget', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="e.g. 500000"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white mono font-semibold focus:ring-2 focus:ring-indigo-500"
            />
            <FieldError message={formErrors.estimatedBudget} />
          </div>

          {/* Delivery Pincode */}
          <div>
            <label htmlFor="rfq-pincode" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {MODAL.deliveryPincodeLabel}
              <span className="text-rose-600 dark:text-rose-400 font-bold ml-0.5">*</span>
            </label>
            <div className="relative">
              <input
                id="rfq-pincode"
                type="text"
                required
                value={form.deliveryPincode}
                onChange={(e) => patchForm('deliveryPincode', e.target.value)}
                placeholder={MODAL.deliveryPincodePlaceholder}
                maxLength={10}
                className="w-full px-3 py-2 pr-20 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white mono font-semibold focus:ring-2 focus:ring-indigo-500"
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                {pincodeValidating && (
                  <span className="text-indigo-500 flex items-center gap-1 text-xs">
                    <Loader2 size={14} className="animate-spin" />
                  </span>
                )}
                {!pincodeValidating && pincodePostOffices.length > 0 && !pincodeError && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 shadow-xs">
                    <CheckCircle2 size={11} className="shrink-0 text-emerald-600 dark:text-emerald-400" /> Valid
                  </span>
                )}
                {!pincodeValidating && pincodeError && form.deliveryPincode.trim().length >= 6 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 shadow-xs">
                    <AlertCircle size={11} className="shrink-0 text-rose-600 dark:text-rose-400" /> Invalid
                  </span>
                )}
              </div>
            </div>
            <FieldError message={formErrors.deliveryPincode} />
          </div>

          {/* Delivery Location */}
          <div>
            <label htmlFor="rfq-location" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {MODAL.deliveryLocationLabel}
              <span className="text-rose-600 dark:text-rose-400 font-bold ml-0.5">*</span>
            </label>
            <input
              id="rfq-location"
              type="text"
              required
              value={form.deliveryLocation}
              onChange={(e) => patchForm('deliveryLocation', e.target.value)}
              placeholder={MODAL.deliveryLocationPlaceholder}
              maxLength={200}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500"
            />
            <FieldError message={formErrors.deliveryLocation} />
          </div>

          {/* Target Delivery Date */}
          <div>
            <label htmlFor="rfq-date" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {MODAL.targetDateLabel}
            </label>
            <input
              id="rfq-date"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={form.targetDeliveryDate}
              onChange={(e) => patchForm('targetDeliveryDate', e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500"
            />
            <FieldError message={formErrors.targetDeliveryDate} />
          </div>
        </div>

        {/* ── Section 2: Line Items & Taxonomy ── */}
        <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
                2. Line Items Specification ({form.lineItems.length})
              </h2>
            </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAutoCategorizeAll}
              disabled={isCategorizing || form.lineItems.length === 0}
              className="btn btn-secondary btn-sm text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 flex items-center gap-1 font-semibold disabled:opacity-50"
            >
              {isCategorizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {isCategorizing ? 'Classifying...' : 'Auto-Categorize All (AI)'}
            </button>
            {form.lineItems.length < 5 && (
              <button
                onClick={() => setForm(addManualRFQLineItem(form))}
                className="btn btn-primary btn-sm font-bold flex items-center gap-1 shadow-xs"
              >
                <Plus size={14} /> Add Line Item
              </button>
            )}
          </div>
        </div>

        <FieldError message={formErrors.lineItems} />

        {form.lineItems.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border-2 border-dashed border-slate-300 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-900/40 space-y-3">
            <p className="text-sm font-medium text-slate-600 dark:text-gray-300">No line items added yet.</p>
            <button
              onClick={() => setForm(addManualRFQLineItem(form))}
              className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> Add First Line Item
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800">
            <table className="w-full text-left min-w-[1080px] text-xs">
              <thead className="bg-slate-50 dark:bg-gray-950/60 text-[10px] uppercase tracking-wide text-slate-500 dark:text-gray-400 border-b border-slate-200 dark:border-gray-800">
                <tr>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colItem}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colSpecs}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colQty}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colUnit}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colMajor}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colMinor}</th>
                  <th className="px-3 py-2.5 text-center font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                {form.lineItems.map((item) => {
                  const errors = lineItemErrors[item.id] || {};
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-gray-800/40 transition-colors">
                      {/* Item Name */}
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="text"
                          aria-label={MODAL.colItem}
                          value={item.itemName}
                          onChange={(e) => patchItem(item.id, { itemName: e.target.value })}
                          placeholder={MODAL.itemPlaceholder}
                          className="w-56 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium focus:ring-2 focus:ring-indigo-500"
                        />
                        <FieldError message={errors.itemName} />
                      </td>

                      {/* Specs */}
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="text"
                          aria-label={MODAL.colSpecs}
                          value={item.technicalSpecs}
                          onChange={(e) => patchItem(item.id, { technicalSpecs: e.target.value })}
                          placeholder={MODAL.specsPlaceholder}
                          className="w-48 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500"
                        />
                      </td>

                      {/* Quantity */}
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="number"
                          min={1}
                          aria-label={MODAL.colQty}
                          value={item.quantity ?? ''}
                          onChange={(e) =>
                            patchItem(item.id, {
                              quantity: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          placeholder={MODAL.qtyPlaceholder}
                          className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 mono font-semibold focus:ring-2 focus:ring-indigo-500"
                        />
                        <FieldError message={errors.quantity} />
                      </td>

                      {/* Unit */}
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="text"
                          aria-label={MODAL.colUnit}
                          value={item.unit}
                          onChange={(e) => patchItem(item.id, { unit: e.target.value })}
                          placeholder={MODAL.unitPlaceholder}
                          className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium focus:ring-2 focus:ring-indigo-500"
                        />
                        <FieldError message={errors.unit} />
                      </td>

                      {/* Major Category */}
                      <td className="px-3 py-2.5 align-top">
                        <select
                          aria-label={MODAL.colMajor}
                          value={item.majorCategory}
                          onChange={(e) => patchItem(item.id, { majorCategory: e.target.value })}
                          className="w-44 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">{MODAL.selectPlaceholder}</option>
                          <option value={ALL_CATEGORIES_OPTION}>All Categories</option>
                          {withStoredValue(taxonomyMajors(), item.majorCategory).map((major) => (
                            <option key={major} value={major}>
                              {major}
                            </option>
                          ))}
                        </select>
                        <FieldError message={errors.majorCategory} />
                      </td>

                      {/* Minor Category */}
                      <td className="px-3 py-2.5 align-top">
                        <select
                          aria-label={MODAL.colMinor}
                          value={item.minorCategory}
                          disabled={!item.majorCategory || item.majorCategory === ALL_CATEGORIES_OPTION}
                          onChange={(e) => patchItem(item.id, { minorCategory: e.target.value })}
                          className="w-44 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium disabled:opacity-40 focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">
                            {item.majorCategory === ALL_CATEGORIES_OPTION ? 'Not required' : MODAL.selectPlaceholder}
                          </option>
                          {withStoredValue(minorsFor(item.majorCategory), item.minorCategory).map((minor) => (
                            <option key={minor} value={minor}>
                              {minor}
                            </option>
                          ))}
                        </select>
                        <FieldError message={errors.minorCategory} />
                      </td>

                      {/* Delete */}
                      <td className="px-3 py-2.5 align-top text-center">
                        <button
                          onClick={() => setForm(removeManualRFQLineItem(form, item.id))}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          title="Remove line item"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── When 5+ items exist, place Add Line Item at bottom-right ── */}
        {form.lineItems.length >= 5 && (
          <div className="flex justify-end pt-1">
            <button
              onClick={() => setForm(addManualRFQLineItem(form))}
              className="btn btn-primary btn-sm font-bold flex items-center gap-1 shadow-xs"
            >
              <Plus size={14} /> Add Line Item
            </button>
          </div>
        )}
      </div>

        {/* ── Section 3: Sourcing Mode Selection ── */}
        <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-4">
          <div className="border-b border-slate-100 dark:border-gray-800 pb-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 size={18} className="text-indigo-600 dark:text-indigo-400" />
              3. Select Sourcing Mode
            </h2>
          </div>

          <div className="space-y-3">
            <label htmlFor="sourcing-mode-select" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300">
              Select Sourcing Version
            </label>

            {/* Accessible Native Select for Screen Readers / Automated Test Querying */}
            <select
              id="sourcing-mode-select"
              data-testid="sourcing-mode-select"
              aria-label="Sourcing Mode"
              value={form.sourcingMode}
              onChange={(e) => patchForm('sourcingMode', e.target.value as SourcingMode)}
              className="sr-only"
              tabIndex={-1}
            >
              {SOURCING_MODES.map((mode) => (
                <option
                  key={mode.id}
                  value={mode.id}
                  data-testid={`mode-option-${mode.id}`}
                >
                  {SOURCING_VERSION_LABELS[mode.id] || mode.shortLabel}
                </option>
              ))}
            </select>

            {/* Horizontal Compact Sourcing Mode Selection Buttons */}
            <div
              role="radiogroup"
              aria-label="Select Sourcing Version"
              className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 flex-wrap sm:flex-nowrap"
            >
              {SOURCING_MODES.map((mode) => {
                const isSelected = form.sourcingMode === mode.id;
                const label = SOURCING_VERSION_LABELS[mode.id] || mode.shortLabel;

                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    data-testid={`sourcing-mode-btn-${mode.id}`}
                    onClick={() => patchForm('sourcingMode', mode.id as SourcingMode)}
                    className={`h-9 px-3.5 py-1.5 rounded-xl text-xs font-semibold tracking-tight transition-all duration-150 shrink-0 flex items-center justify-center gap-1.5 border cursor-pointer select-none ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs shadow-indigo-600/20'
                        : 'bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-300 border-slate-200 dark:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-700/60 hover:border-slate-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <span data-testid={`mode-${mode.id}`} aria-hidden="true" className="contents">
                      {isSelected && <Check size={13} className="shrink-0 stroke-[2.5]" />}
                      <span>{label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>



        {/* ── Mode 1: Private Approved Vendor Roster Preview ── */}
        {form.sourcingMode === 'mode_1' && (
          <div className="mt-5 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-5 space-y-4 animate-fade-in shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-blue-100 dark:border-blue-900/40 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-600 text-white shadow-xs">
                  <Building2 size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Mode 1: Buyer&apos;s Approved Vendor Roster</span>
                    <span className="badge badge-blue text-[10px] font-bold">
                      {buyerVendors.filter((v) => isBuyerUploaded(v)).length} Suppliers Found
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                    This RFQ will strictly be dispatched to your private, pre-approved supplier network below.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
                <input
                  type="text"
                  placeholder="Filter vendors..."
                  value={mode1VendorSearch}
                  onChange={(e) => setMode1VendorSearch(e.target.value)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-800 dark:text-gray-200 w-36 sm:w-44 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    resetAddVendorForm();
                    setIsAddVendorModalOpen(true);
                  }}
                  className="btn btn-primary btn-xs py-1.5 px-3 font-bold flex items-center gap-1 shrink-0 cursor-pointer shadow-xs"
                >
                  <Plus size={13} />
                  <span>Add Vendor</span>
                </button>
                <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-900/50 px-2.5 py-1.5 rounded-full border border-blue-200 dark:border-blue-800 shrink-0">
                  🔒 Private Roster Only
                </span>
              </div>
            </div>

            {(() => {
              const allMyVendors = buyerVendors.filter((v) => isBuyerUploaded(v));
              if (allMyVendors.length === 0) {
                return (
                  <div className="p-6 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 space-y-2">
                    <Users size={28} className="mx-auto text-slate-400 opacity-60" />
                    <p className="text-xs font-bold text-slate-700 dark:text-gray-300">No Private Vendors Uploaded Yet</p>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 max-w-md mx-auto">
                      Please ingest your 1–3 Year Pre-Purchase Orders or add approved vendors in the Vendor Directory to auto-dispatch in Mode 1.
                    </p>
                  </div>
                );
              }

              const { signals: mode1Signals } = extractRfqCategorySignals(form);
              const matchingVendors = mode1Signals.length > 0
                ? allMyVendors.filter((v) => matchVendorAgainstSignals(v, mode1Signals).isMatch)
                : allMyVendors;
              const mismatchedVendors = mode1Signals.length > 0
                ? allMyVendors.filter((v) => !matchVendorAgainstSignals(v, mode1Signals).isMatch)
                : [];

              let pool = allMyVendors;
              if (vendorCategoryFilterTab === 'matched') {
                pool = matchingVendors;
              } else if (vendorCategoryFilterTab === 'mismatched') {
                pool = mismatchedVendors;
              }

              const myVendors = mode1VendorSearch.trim()
                ? pool.filter((v) =>
                    v.name.toLowerCase().includes(mode1VendorSearch.toLowerCase()) ||
                    v.email?.toLowerCase().includes(mode1VendorSearch.toLowerCase()) ||
                    v.majorCategory?.toLowerCase().includes(mode1VendorSearch.toLowerCase())
                  )
                : pool;

              const allIds = myVendors.map((v) => v.id);
              const allSelected = allIds.length > 0 && allIds.every((id) => selectedVendorIds.includes(id));

              return (
                <div className="space-y-2.5">
                  {/* Category Filter Tabs & Toolbar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 dark:border-gray-800 pb-2">
                    {mode1Signals.length > 0 && (
                      <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-800 p-0.5 rounded-lg text-[10px] font-semibold">
                        <button
                          type="button"
                          onClick={() => setVendorCategoryFilterTab('all')}
                          className={`px-2.5 py-1 rounded-md transition-all ${
                            vendorCategoryFilterTab === 'all'
                              ? 'bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-300 shadow-2xs font-bold'
                              : 'text-slate-600 dark:text-gray-400 hover:text-slate-900'
                          }`}
                        >
                          All ({allMyVendors.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setVendorCategoryFilterTab('matched')}
                          className={`px-2.5 py-1 rounded-md transition-all ${
                            vendorCategoryFilterTab === 'matched'
                              ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-2xs font-bold'
                              : 'text-slate-600 dark:text-gray-400 hover:text-slate-900'
                          }`}
                        >
                          Matched ({matchingVendors.length})
                        </button>
                        {mismatchedVendors.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setVendorCategoryFilterTab('mismatched')}
                            className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
                              vendorCategoryFilterTab === 'mismatched'
                                ? 'bg-white dark:bg-gray-900 text-amber-700 dark:text-amber-300 shadow-2xs font-bold'
                                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900'
                            }`}
                          >
                            <span>⚠️ Category Mismatch ({mismatchedVendors.length})</span>
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between sm:justify-end gap-2 flex-1 text-[11px]">
                      <div className="text-slate-500 dark:text-gray-400">
                        {selectedVendorIds.length > 0 ? (
                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                            {selectedVendorIds.length} of {matchingVendors.length} matched vendor(s) selected
                          </span>
                        ) : (
                          <span>All {matchingVendors.length} category-matched vendors will receive this RFQ</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const selectableIds = myVendors.filter((v) => {
                            if (mode1Signals.length === 0) return true;
                            return matchVendorAgainstSignals(v, mode1Signals).isMatch;
                          }).map((v) => v.id);

                          if (allSelected) {
                            setSelectedVendorIds([]);
                          } else {
                            setSelectedVendorIds(Array.from(new Set([...selectedVendorIds, ...selectableIds])));
                          }
                        }}
                        className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                        <span>{allSelected ? 'Deselect All' : 'Select All Matched'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
                    {myVendors.map((vendor, idx) => {
                      const rawMinor = vendor.minorCategories as string | string[] | undefined;
                      const minorList: string[] = Array.isArray(rawMinor)
                        ? rawMinor
                        : typeof rawMinor === 'string'
                        ? (rawMinor as string).split(',').map((s: string) => s.trim()).filter(Boolean)
                        : Array.isArray(vendor.vendorSelectedCategories)
                        ? vendor.vendorSelectedCategories
                        : [];
                      
                      const matchResult = mode1Signals.length > 0
                        ? matchVendorAgainstSignals(vendor, mode1Signals)
                        : { isMatch: true };
                      const isCategoryMismatch = mode1Signals.length > 0 && !matchResult.isMatch;

                      const isSelected = !isCategoryMismatch && (selectedVendorIds.includes(vendor.id) || selectedVendorIds.length === 0);

                      return (
                        <div
                          key={vendor.id || idx}
                          onClick={() => {
                            if (isCategoryMismatch) return;
                            setSelectedVendorIds((prev) => {
                              if (prev.length === 0) {
                                return allIds.filter((id) => id !== vendor.id);
                              }
                              return prev.includes(vendor.id)
                                ? prev.filter((id) => id !== vendor.id)
                                : [...prev, vendor.id];
                            });
                          }}
                          className={`rounded-xl border p-3.5 space-y-2 transition-all ${
                            isCategoryMismatch
                              ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50/40 dark:bg-amber-950/20 shadow-2xs'
                              : isSelected
                              ? 'cursor-pointer border-blue-500 bg-blue-50/30 dark:bg-blue-950/20 dark:border-blue-600 shadow-xs'
                              : 'cursor-pointer border-slate-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 opacity-60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                isCategoryMismatch
                                  ? 'bg-amber-500 border-amber-500 text-white opacity-80'
                                  : isSelected
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : 'border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                              }`}>
                                {isCategoryMismatch ? (
                                  <AlertCircle size={12} strokeWidth={2.5} />
                                ) : isSelected ? (
                                  <Check size={12} strokeWidth={3} />
                                ) : null}
                              </span>
                              <span className="text-xs font-bold text-slate-900 dark:text-white truncate" title={vendor.name}>
                                {vendor.name}
                              </span>
                            </div>
                            {isCategoryMismatch ? (
                              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shrink-0">
                                ⚠️ Category Mismatch
                              </span>
                            ) : (
                              <span className="badge badge-emerald text-[9px] font-bold shrink-0">
                                Preferred
                              </span>
                            )}
                          </div>

                          <div className="space-y-1 text-[11px] text-slate-600 dark:text-gray-300">
                            {vendor.contactPerson && (
                              <div className="flex items-center gap-1.5 text-slate-700 dark:text-gray-300">
                                <Users size={11} className="text-slate-400 shrink-0" />
                                <span className="truncate">{vendor.contactPerson}</span>
                              </div>
                            )}
                            {vendor.email && (
                              <div className="flex items-center gap-1.5 text-slate-500 dark:text-gray-400">
                                <Mail size={11} className="text-blue-500 shrink-0" />
                                <span className="font-mono text-[10px] truncate">{vendor.email}</span>
                              </div>
                            )}
                            {vendor.phone && (
                              <div className="flex items-center gap-1.5 text-slate-500 dark:text-gray-400">
                                <Phone size={11} className="text-emerald-500 shrink-0" />
                                <span className="font-mono text-[10px]">{vendor.phone}</span>
                              </div>
                            )}
                          </div>

                          {/* Category Mismatch Warning & Update Button */}
                          {isCategoryMismatch ? (
                            <div className="pt-2 border-t border-amber-200/60 dark:border-amber-900/40 space-y-1.5">
                              <div className="text-[10px] text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200 dark:border-amber-900/50 space-y-0.5">
                                <p className="font-bold flex items-center justify-between">
                                  <span>Registered Category:</span>
                                  <span className="text-amber-900 dark:text-amber-200">{vendor.majorCategory || 'None'}</span>
                                </p>
                                <p className="text-[9px] text-amber-700 dark:text-amber-400">
                                  Excluded from RFQ shortlist until details updated & verified.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSendCategoryUpdateEmail(vendor, mode1Signals);
                                }}
                                disabled={sendingCategoryEmailVendors.includes(vendor.id || vendor.email)}
                                className="w-full py-1.5 px-2.5 rounded-lg text-[10px] font-bold bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                                title="Send email requesting vendor to update their category"
                              >
                                {sendingCategoryEmailVendors.includes(vendor.id || vendor.email) ? (
                                  <>
                                    <Loader2 size={11} className="animate-spin" />
                                    <span>Sending Email...</span>
                                  </>
                                ) : sentCategoryEmailVendors.includes(vendor.id || vendor.email) ? (
                                  <>
                                    <CheckCircle2 size={11} />
                                    <span>Update Email Sent ✓</span>
                                  </>
                                ) : (
                                  <>
                                    <Mail size={11} />
                                    <span>Send Email to Update Category</span>
                                  </>
                                )}
                              </button>
                            </div>
                          ) : (
                            /* Category & Rating */
                            <div className="pt-2 border-t border-slate-100 dark:border-gray-800 space-y-1.5">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="font-semibold text-blue-700 dark:text-blue-300 truncate max-w-[150px]">
                                  {vendor.majorCategory || 'General Industrial'}
                                </span>
                                <span className="text-amber-500 font-bold flex items-center gap-0.5 shrink-0">
                                  <Star size={10} className="fill-amber-400 text-amber-400" />
                                  <span>{vendor.rating || 4.5}</span>
                                </span>
                              </div>
                              {minorList.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {minorList.slice(0, 2).map((cat: string, ci: number) => (
                                    <span
                                      key={ci}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-medium bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-gray-700/60 truncate max-w-[120px]"
                                      title={cat}
                                    >
                                      {cat}
                                    </span>
                                  ))}
                                  {minorList.length > 2 && (
                                    <span className="text-[8px] font-bold text-slate-400 dark:text-gray-500 self-center">
                                      +{minorList.length - 2}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Mode 2: Hybrid Sourcing Pool (Private Roster + AI Routing) ── */}
        {form.sourcingMode === 'mode_2' && (
          <div className="mt-5 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-5 space-y-4 animate-fade-in shadow-xs">
            {(() => {
              const allMyVendors = buyerVendors.filter((v) => isBuyerUploaded(v));
              if (allMyVendors.length === 0) {
                return (
                  <div className="p-6 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 space-y-2">
                    <Users size={28} className="mx-auto text-slate-400 opacity-60" />
                    <p className="text-xs font-bold text-slate-700 dark:text-gray-300">No Approved Vendors Found</p>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 max-w-md mx-auto">
                      Please ingest your approved vendor directory or add vendors in the Vendor Directory to dispatch in Mode 2.
                    </p>
                  </div>
                );
              }

              const { signals: rfqSignals } = extractRfqCategorySignals(form);
              const matchingVendors = rfqSignals.length > 0
                ? allMyVendors.filter((v) => matchVendorAgainstSignals(v, rfqSignals).isMatch)
                : allMyVendors;
              const mismatchedVendors = rfqSignals.length > 0
                ? allMyVendors.filter((v) => !matchVendorAgainstSignals(v, rfqSignals).isMatch)
                : [];

              let pool = allMyVendors;
              if (mode2VendorCategoryFilterTab === 'matched') {
                pool = matchingVendors;
              } else if (mode2VendorCategoryFilterTab === 'mismatched') {
                pool = mismatchedVendors;
              }

              const myVendors = mode2VendorSearch.trim()
                ? pool.filter((v) =>
                    v.name.toLowerCase().includes(mode2VendorSearch.toLowerCase()) ||
                    v.email?.toLowerCase().includes(mode2VendorSearch.toLowerCase()) ||
                    v.majorCategory?.toLowerCase().includes(mode2VendorSearch.toLowerCase()) ||
                    (v.contactPerson || '').toLowerCase().includes(mode2VendorSearch.toLowerCase())
                  )
                : pool;

              const allIds = myVendors.map((v) => v.id);
              const allSelected = allIds.length > 0 && allIds.every((id) => selectedVendorIds.includes(id));

              return (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-100 dark:border-emerald-900/40 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-emerald-600 text-white shadow-xs">
                        <Sparkles size={16} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>Mode 2: Hybrid Sourcing Pool</span>
                          <span className="badge badge-emerald text-[10px] font-bold">
                            {matchingVendors.length} Hybrid Suppliers Matched
                          </span>
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                          Dispatches to your approved internal roster below + automatically matched Procucev verified network suppliers in the background.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowAiInfo(!showAiInfo)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 bg-emerald-100/80 dark:bg-emerald-900/60 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                        title="Learn how AI categorizes and matches suppliers"
                      >
                        <Info size={13} />
                        <span>AI Matching Criteria</span>
                      </button>
                    </div>
                  </div>

                  {/* AI Matching Info Panel */}
                  {showAiInfo && (
                    <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800/60 text-slate-800 dark:text-gray-200 space-y-3 animate-fade-in shadow-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-xs text-emerald-800 dark:text-emerald-200">
                          <Sparkles size={15} className="text-emerald-600 dark:text-emerald-400" />
                          <span>How QUA AI Categorizes Line Items & Matches Suppliers</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAiInfo(false)}
                          className="text-[10px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                          ✕ Close
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[11px] leading-relaxed">
                        <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                          <strong className="text-emerald-800 dark:text-emerald-300 block mb-1">1. BOQ & Line-Item Classification</strong>
                          Extracts items and maps keywords against our 280+ standard industrial category taxonomy.
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                          <strong className="text-emerald-800 dark:text-emerald-300 block mb-1">2. Multi-Signal Supplier Scoring</strong>
                          Matches vendor primary capabilities, registered minor categories, and historical PO delivery records.
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                          <strong className="text-emerald-800 dark:text-emerald-300 block mb-1">3. ≥80% Relevance Threshold</strong>
                          Ensures only verified suppliers with direct capability overlap receive RFQ invitations.
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                          <strong className="text-emerald-800 dark:text-emerald-300 block mb-1">4. Category Benchmarking</strong>
                          Evaluates vendor reliability ratings, location proximity, and verified product specifications.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Category Filter Tabs & Toolbar */}
                  <div className="space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-100 dark:border-emerald-900/40 pb-2">
                      {rfqSignals.length > 0 && (
                        <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-800 p-0.5 rounded-lg text-[10px] font-semibold">
                          <button
                            type="button"
                            onClick={() => setMode2VendorCategoryFilterTab('all')}
                            className={`px-2.5 py-1 rounded-md transition-all ${
                              mode2VendorCategoryFilterTab === 'all'
                                ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-2xs font-bold'
                                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900'
                            }`}
                          >
                            All ({allMyVendors.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setMode2VendorCategoryFilterTab('matched')}
                            className={`px-2.5 py-1 rounded-md transition-all ${
                              mode2VendorCategoryFilterTab === 'matched'
                                ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-2xs font-bold'
                                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900'
                            }`}
                          >
                            Matched ({matchingVendors.length})
                          </button>
                          {mismatchedVendors.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setMode2VendorCategoryFilterTab('mismatched')}
                              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
                                mode2VendorCategoryFilterTab === 'mismatched'
                                  ? 'bg-white dark:bg-gray-900 text-amber-700 dark:text-amber-300 shadow-2xs font-bold'
                                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900'
                              }`}
                            >
                              <span>⚠️ Category Mismatch ({mismatchedVendors.length})</span>
                            </button>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between sm:justify-end gap-2 flex-1 text-[11px]">
                        <div className="text-slate-500 dark:text-gray-400">
                          {selectedVendorIds.length > 0 ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {selectedVendorIds.length} of {matchingVendors.length} matched vendor(s) selected
                            </span>
                          ) : (
                            <span>All {matchingVendors.length} category-matched vendors will receive this RFQ</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const selectableIds = myVendors.filter((v) => {
                              if (rfqSignals.length === 0) return true;
                              return matchVendorAgainstSignals(v, rfqSignals).isMatch;
                            }).map((v) => v.id);

                            if (allSelected) {
                              setSelectedVendorIds([]);
                            } else {
                              setSelectedVendorIds(Array.from(new Set([...selectedVendorIds, ...selectableIds])));
                            }
                          }}
                          className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                          <span>{allSelected ? 'Deselect All' : 'Select All Matched'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Search Bar */}
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type="search"
                        value={mode2VendorSearch}
                        onChange={(e) => setMode2VendorSearch(e.target.value)}
                        placeholder="Search private suppliers by name, category, or contact info..."
                        className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                      />
                    </div>

                    {myVendors.length === 0 ? (
                      <div className="p-4 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500">
                        No vendors match the search or filter criteria.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
                        {myVendors.map((vendor, idx) => {
                          const rawMinor = vendor.minorCategories as string | string[] | undefined;
                          const minorList: string[] = Array.isArray(rawMinor)
                            ? rawMinor
                            : typeof rawMinor === 'string'
                            ? (rawMinor as string).split(',').map((s: string) => s.trim()).filter(Boolean)
                            : Array.isArray(vendor.vendorSelectedCategories)
                            ? vendor.vendorSelectedCategories
                            : [];

                          const matchResult = rfqSignals.length > 0
                            ? matchVendorAgainstSignals(vendor, rfqSignals)
                            : { isMatch: true };
                          const isCategoryMismatch = rfqSignals.length > 0 && !matchResult.isMatch;

                          const isSelected = !isCategoryMismatch && (selectedVendorIds.includes(vendor.id) || selectedVendorIds.length === 0);

                          return (
                            <div
                              key={vendor.id || idx}
                              onClick={() => {
                                if (isCategoryMismatch) return;
                                setSelectedVendorIds((prev) => {
                                  if (prev.length === 0) {
                                    return allIds.filter((id) => id !== vendor.id);
                                  }
                                  return prev.includes(vendor.id)
                                    ? prev.filter((id) => id !== vendor.id)
                                    : [...prev, vendor.id];
                                });
                              }}
                              className={`rounded-xl border p-3.5 space-y-2 transition-all ${
                                isCategoryMismatch
                                  ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50/40 dark:bg-amber-950/20 shadow-2xs'
                                  : isSelected
                                  ? 'cursor-pointer border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20 dark:border-emerald-600 shadow-xs'
                                  : 'cursor-pointer border-slate-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 opacity-60'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                    isCategoryMismatch
                                      ? 'bg-amber-500 border-amber-500 text-white opacity-80'
                                      : isSelected
                                      ? 'bg-emerald-600 border-emerald-600 text-white'
                                      : 'border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                                  }`}>
                                    {isCategoryMismatch ? (
                                      <AlertCircle size={12} strokeWidth={2.5} />
                                    ) : isSelected ? (
                                      <Check size={12} strokeWidth={3} />
                                    ) : null}
                                  </span>
                                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate" title={vendor.name}>
                                    {vendor.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {isBuyerUploaded(vendor) ? (
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-slate-100 text-slate-700 dark:bg-gray-800 dark:text-gray-300 border border-slate-200 dark:border-gray-700">
                                      📁 Internal
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-300 dark:border-sky-700">
                                      ✨ Procucev Vetted
                                    </span>
                                  )}
                                  {isCategoryMismatch ? (
                                    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shrink-0">
                                      ⚠️ Category Mismatch
                                    </span>
                                  ) : (
                                    <span className="badge badge-emerald text-[9px] font-bold shrink-0">
                                      Preferred
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="space-y-1 text-[11px] text-slate-600 dark:text-gray-300">
                                {vendor.contactPerson && (
                                  <div className="flex items-center gap-1.5 text-slate-700 dark:text-gray-300">
                                    <Users size={11} className="text-slate-400 shrink-0" />
                                    <span className="truncate">{vendor.contactPerson}</span>
                                  </div>
                                )}
                                {vendor.email && (
                                  <div className="flex items-center gap-1.5 text-slate-500 dark:text-gray-400">
                                    <Mail size={11} className="text-blue-500 shrink-0" />
                                    <span className="font-mono text-[10px] truncate">{vendor.email}</span>
                                  </div>
                                )}
                                {vendor.phone && (
                                  <div className="flex items-center gap-1.5 text-slate-500 dark:text-gray-400">
                                    <Phone size={11} className="text-emerald-500 shrink-0" />
                                    <span className="font-mono text-[10px]">{vendor.phone}</span>
                                  </div>
                                )}
                              </div>

                              {/* Category Mismatch Warning & Update Button */}
                              {isCategoryMismatch ? (
                                <div className="pt-2 border-t border-amber-200/60 dark:border-amber-900/40 space-y-1.5">
                                  <div className="text-[10px] text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200 dark:border-amber-900/50 space-y-0.5">
                                    <p className="font-bold flex items-center justify-between">
                                      <span>Registered Category:</span>
                                      <span className="text-amber-900 dark:text-amber-200">{vendor.majorCategory || 'None'}</span>
                                    </p>
                                    <p className="text-[9px] text-amber-700 dark:text-amber-400">
                                      Excluded from RFQ shortlist until details updated & verified.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSendCategoryUpdateEmail(vendor, rfqSignals);
                                    }}
                                    disabled={sendingCategoryEmailVendors.includes(vendor.id || vendor.email)}
                                    className="w-full py-1.5 px-2.5 rounded-lg text-[10px] font-bold bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                                    title="Send email requesting vendor to update their category"
                                  >
                                    {sendingCategoryEmailVendors.includes(vendor.id || vendor.email) ? (
                                      <>
                                        <Loader2 size={11} className="animate-spin" />
                                        <span>Sending Email...</span>
                                      </>
                                    ) : sentCategoryEmailVendors.includes(vendor.id || vendor.email) ? (
                                      <>
                                        <CheckCircle2 size={11} />
                                        <span>Update Email Sent ✓</span>
                                      </>
                                    ) : (
                                      <>
                                        <Mail size={11} />
                                        <span>Send Email to Update Category</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              ) : (
                                /* Category & Rating */
                                <div className="pt-2 border-t border-slate-100 dark:border-gray-800 space-y-1.5">
                                  <div className="flex items-center justify-between text-[10px]">
                                    <span className="font-semibold text-emerald-700 dark:text-emerald-300 truncate max-w-[150px]">
                                      {vendor.majorCategory || 'General Industrial'}
                                    </span>
                                    <span className="text-amber-500 font-bold flex items-center gap-0.5 shrink-0">
                                      <Star size={10} className="fill-amber-400 text-amber-400" />
                                      <span>{vendor.rating || 4.5}</span>
                                    </span>
                                  </div>
                                  {minorList.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {minorList.slice(0, 2).map((cat: string, ci: number) => (
                                        <span
                                          key={ci}
                                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-medium bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-gray-700/60 truncate max-w-[120px]"
                                          title={cat}
                                        >
                                          {cat}
                                        </span>
                                      ))}
                                      {minorList.length > 2 && (
                                        <span className="text-[8px] font-bold text-slate-400 dark:text-gray-500 self-center">
                                          +{minorList.length - 2}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Mode 3: Autonomous Sourcing & Double-Blind Verification Protocol (Version 3) ── */}
        {form.sourcingMode === 'mode_3' && (
          <div className="mt-5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-5 space-y-4 animate-fade-in shadow-xs">
            {(() => {
              const allMyVendors = buyerVendors.filter(isBuyerUploaded);
              const { signals: rfqSignals } = extractRfqCategorySignals(form);
              const myVendors = rfqSignals.length > 0
                ? allMyVendors.filter((v) => matchVendorAgainstSignals(v, rfqSignals).isMatch)
                : allMyVendors;

              return (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100 dark:border-indigo-900/40 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-600 text-white shadow-xs">
                        <ShieldCheck size={16} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>Mode 3: Autonomous Sourcing & Double-Blind Verification Protocol</span>
                          <span className="badge badge-indigo text-[10px] font-bold">
                            {myVendors.length} Private Suppliers
                          </span>
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                          Autonomous AI sourcing and evaluation protocol. Your corporate identity remains 100% confidential.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowAiInfo(!showAiInfo)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100 bg-indigo-100/80 dark:bg-indigo-900/60 px-3 py-1 rounded-full border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer"
                        title="Learn how AI categorizes and matches suppliers"
                      >
                        <Info size={13} />
                        <span>AI Matching Criteria</span>
                      </button>
                      <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-900/50 px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-800 shrink-0">
                        🛡️ Double-Blind Active
                      </span>
                    </div>
                  </div>

                  {/* AI Matching Info Panel */}
                  {showAiInfo && (
                    <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800/60 text-slate-800 dark:text-gray-200 space-y-3 animate-fade-in shadow-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-xs text-indigo-800 dark:text-indigo-200">
                          <Sparkles size={15} className="text-indigo-600 dark:text-indigo-400" />
                          <span>How QUA AI Categorizes Line Items & Matches Suppliers for Double-Blind Evaluation</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAiInfo(false)}
                          className="text-[10px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                          ✕ Close
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[11px] leading-relaxed">
                        <div className="p-2.5 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                          <strong className="text-indigo-800 dark:text-indigo-300 block mb-1">1. BOQ & Line-Item Classification</strong>
                          Extracts items and maps keywords against our 280+ standard industrial category taxonomy.
                        </div>
                        <div className="p-2.5 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                          <strong className="text-indigo-800 dark:text-indigo-300 block mb-1">2. Multi-Signal Supplier Scoring</strong>
                          Matches vendor primary capabilities, registered minor categories, and historical PO delivery records.
                        </div>
                        <div className="p-2.5 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                          <strong className="text-indigo-800 dark:text-indigo-300 block mb-1">3. ≥80% Relevance Threshold</strong>
                          Ensures only verified suppliers with direct capability overlap receive RFQ invitations.
                        </div>
                        <div className="p-2.5 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                          <strong className="text-indigo-800 dark:text-indigo-300 block mb-1">4. Double-Blind Confidentiality Protocol</strong>
                          Supplier capability invites are anonymized; buyer identity is withheld until qualification.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Explanatory banner */}
                  <div className="p-3.5 rounded-xl bg-indigo-100/50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 text-[11px] text-indigo-950 dark:text-indigo-200 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-indigo-900 dark:text-indigo-300">
                      <ShieldCheck size={14} />
                      <span>Evaluation-First Protocol Active</span>
                    </div>
                    <p>
                      The RFQ will be routed to your private approved roster. Suppliers will undergo double-blind qualification evaluation while your corporate identity remains 100% confidential.
                    </p>
                  </div>

                  {/* Buyer Approved Roster */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                        <Users size={13} className="text-indigo-600 dark:text-indigo-400" />
                        <span>Buyer Approved Suppliers (Double-Blind Protocol)</span>
                      </h4>
                      <span className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">
                        {myVendors.length} Suppliers
                      </span>
                    </div>

                    {myVendors.length === 0 ? (
                      <div className="p-3.5 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500">
                        No private vendors found — please add vendors in your directory.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto pr-1">
                        {myVendors.map((v, i) => (
                          <div key={v.id || i} className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-indigo-200/70 dark:border-indigo-900/50 space-y-1 shadow-2xs">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{v.name}</span>
                              <span className="badge badge-indigo text-[8px] font-bold shrink-0">Private</span>
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                              <span className="font-semibold text-slate-700 dark:text-gray-300">{v.majorCategory || 'General Industrial'}</span>
                              <span className="text-indigo-600 dark:text-indigo-400 font-semibold">🔒 Double-Blind</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* FOOTER ACTIONS & SUBMISSION                                   */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {isQuotaExhausted && (
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-emerald-500/10 border border-amber-500/30 dark:bg-amber-950/30 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 font-medium flex-wrap">
            <AlertCircle size={16} className="text-amber-600 shrink-0" />
            <span>{EXTRACTION.quotaExhaustedMessage}</span>
            <span className="badge badge-emerald text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
              <Zap size={10} className="fill-current" />
              {EXTRACTION.v0FreeBadge}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => patchForm('sourcingMode', 'mode_0')}
              className="font-bold text-emerald-700 dark:text-emerald-300 hover:underline text-xs inline-flex items-center gap-1 cursor-pointer"
            >
              <Zap size={12} className="fill-current" />
              <span>{EXTRACTION.useV0Action}</span>
            </button>
            <span className="text-slate-300 dark:text-gray-600">|</span>
            <a href="/buyer/subscription-center" className="font-bold underline hover:text-amber-700 text-xs inline-flex items-center gap-1">
              <span>{EXTRACTION.upgradePlanAction}</span>
              <ArrowRight size={13} />
            </a>
          </div>
        </div>
      )}

      {submitError && (
        <p role="alert" className="flex items-start gap-2 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{submitError}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-4 pt-5 pb-6 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <button onClick={onCancel} disabled={isDispatching} type="button" className="btn btn-secondary font-semibold cursor-pointer">
            Cancel
          </button>
          <button
            onClick={handleClearForm}
            disabled={isDispatching}
            type="button"
            className="btn btn-secondary font-semibold inline-flex items-center gap-1.5 text-slate-600 hover:text-rose-600 dark:text-gray-300 dark:hover:text-rose-400 cursor-pointer"
          >
            <RotateCcw size={14} />
            <span>Clear Form</span>
          </button>
        </div>

        {isQuotaExhausted ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => patchForm('sourcingMode', 'mode_0')}
              className="btn btn-secondary text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 font-bold inline-flex items-center gap-1.5 px-4 py-2.5 text-xs shadow-xs cursor-pointer"
            >
              <Zap size={14} className="fill-current" />
              <span>{EXTRACTION.useV0Action}</span>
            </button>
            <a
              href="/buyer/subscription-center"
              className="btn btn-primary font-black flex items-center gap-2 px-6 py-2.5 shadow-md hover:shadow-lg cursor-pointer"
            >
              <Sparkles size={16} />
              <span>Please Upgrade Your Plan</span>
              <ArrowRight size={16} />
            </a>
          </div>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isDispatching}
            className="btn btn-primary font-black flex items-center gap-2 px-6 py-2.5 shadow-md hover:shadow-lg disabled:opacity-50 cursor-pointer"
          >
            {isDispatching ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Creating & Dispatching RFQ...</span>
              </>
            ) : (
              <>
                <Send size={16} />
                <span>Create & Dispatch RFQ</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        )}
      </div>

      {/* ── Inline Add Vendor Modal for Mode 1 Roster ── */}
      {isAddVendorModalOpen && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-gray-800 animate-fade-in flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                  <Plus size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add Approved Vendor</h3>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    Add a vendor you deal with directly — added to your private vendor roster.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddVendorModalOpen(false)}
                disabled={isSubmittingVendor}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-40 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddVendorSubmit} className="overflow-y-auto my-3 space-y-3 pr-1 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  Company Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ashok Industries"
                  value={vendorFormName}
                  onChange={(e) => setVendorFormName(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    Contact Person Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. John Doe"
                    value={vendorFormContactPerson}
                    onChange={(e) => setVendorFormContactPerson(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    Phone <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. 9000000001"
                    value={vendorFormPhone}
                    onChange={(e) => setVendorFormPhone(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="e.g. contact@example.com"
                  value={vendorFormEmail}
                  onChange={(e) => setVendorFormEmail(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  Major Category <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={vendorFormMajorCategory}
                  onChange={(e) => {
                    setVendorFormMajorCategory(e.target.value);
                    setVendorFormMinorCategories([]);
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                >
                  <option value="">Select Major Category...</option>
                  {taxonomyMajors().map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {vendorFormMajorCategory && minorsFor(vendorFormMajorCategory).length > 0 && (
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    Minor Category
                  </label>
                  <select
                    value={vendorFormMinorCategories[0] || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setVendorFormMinorCategories(val ? [val] : []);
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                  >
                    <option value="">Select Minor Category...</option>
                    {minorsFor(vendorFormMajorCategory).map((minor) => (
                      <option key={minor} value={minor}>
                        {minor}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    City <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pune"
                    value={vendorFormCity}
                    onChange={(e) => setVendorFormCity(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    State <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Maharashtra"
                    value={vendorFormState}
                    onChange={(e) => setVendorFormState(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-semibold text-slate-700 dark:text-gray-300">
                      Pincode <span className="text-rose-500">*</span>
                    </label>
                    {vendorFormPincodeValidating && (
                      <span className="text-[10px] text-indigo-500 font-bold flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Checking
                      </span>
                    )}
                    {!vendorFormPincodeValidating && vendorFormPincodePostOffices.length > 0 && !vendorFormPincodeError && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle2 size={10} /> Valid
                      </span>
                    )}
                    {!vendorFormPincodeValidating && vendorFormPincodeError && vendorFormPincode.trim().length >= 6 && (
                      <span className="text-[10px] font-bold text-rose-500 flex items-center gap-0.5">
                        <AlertCircle size={10} /> Invalid
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="e.g. 411001"
                    value={vendorFormPincode}
                    onChange={(e) => setVendorFormPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className={`w-full text-xs p-2 rounded-lg border font-mono ${
                      vendorFormPincodeError ? 'border-rose-400 dark:border-rose-700' : 'border-slate-200 dark:border-gray-700'
                    } bg-white dark:bg-gray-900 text-slate-900 dark:text-white`}
                  />
                  {vendorFormPincodeError && vendorFormPincode.trim().length >= 6 && (
                    <p className="text-[10px] text-rose-500 mt-0.5 font-medium">{vendorFormPincodeError}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  GSTIN / GST Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={15}
                  placeholder="e.g. 27AAAAA0000A1Z5"
                  value={vendorFormGstin}
                  onChange={(e) => setVendorFormGstin(e.target.value.toUpperCase())}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-900 dark:text-white font-mono uppercase"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsAddVendorModalOpen(false)}
                  disabled={isSubmittingVendor}
                  className="btn btn-ghost btn-sm cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingVendor}
                  className="btn btn-primary btn-sm font-bold flex items-center gap-1.5 shadow-md cursor-pointer"
                >
                  {isSubmittingVendor ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  <span>Add Vendor</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── RFQ Dispatch Confirmation Modal ── */}
      {confirmationRfq && (
        <div className="modal-overlay !z-[1200] fixed inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-xl p-6 sm:p-8 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-gray-800 space-y-6 text-center animate-in zoom-in-95">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 size={36} />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">RFQ Dispatched Successfully!</h3>
              <p className="text-sm text-slate-500 dark:text-gray-400 max-w-md mx-auto">
                RFQ <strong className="text-indigo-600 dark:text-indigo-400 font-mono">{confirmationRfq.rfqNumber}</strong> has been created and invitations have been dispatched to matched vendors.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-left">
              <div className="p-3 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200/60 dark:border-gray-800">
                <span className="text-[10px] font-semibold text-slate-400 block uppercase tracking-wider">RFQ Number</span>
                <span className="text-xs font-bold text-slate-800 dark:text-gray-200 font-mono">{confirmationRfq.rfqNumber}</span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200/60 dark:border-gray-800">
                <span className="text-[10px] font-semibold text-slate-400 block uppercase tracking-wider">Category</span>
                <span className="text-xs font-bold text-slate-800 dark:text-gray-200 truncate block">{confirmationRfq.category || confirmationRfq.title}</span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200/60 dark:border-gray-800">
                <span className="text-[10px] font-semibold text-slate-400 block uppercase tracking-wider">Items / Budget</span>
                <span className="text-xs font-bold text-slate-800 dark:text-gray-200">
                  {confirmationRfq.extractedEntities?.length || 1} items {confirmationRfq.budget ? `· ₹${confirmationRfq.budget.toLocaleString()}` : ''}
                </span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200/60 dark:border-gray-800">
                <span className="text-[10px] font-semibold text-slate-400 block uppercase tracking-wider">Mode & Vendors</span>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                  {confirmationRfq.assignedVendors?.length || (confirmationRfq.sourcingMode === 'mode_3' ? 'AI Blind' : '1+ Supplier')}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setConfirmationRfq(null);
                  handleClearForm();
                }}
                className="btn btn-secondary btn-md font-bold cursor-pointer"
              >
                Create Another RFQ
              </button>
              <button
                type="button"
                onClick={() => {
                  const rfqNum = confirmationRfq.rfqNumber;
                  setConfirmationRfq(null);
                  if (onComplete) onComplete();
                  if (router) {
                    router.push(`/buyer/quote-matrix?rfq=${encodeURIComponent(rfqNum)}`);
                  }
                }}
                className="btn btn-secondary btn-md font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Compare in Matrix</span>
                <ExternalLink size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmationRfq(null);
                  if (onComplete) onComplete();
                }}
                className="btn btn-primary btn-md font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Check size={16} />
                <span>Done</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
