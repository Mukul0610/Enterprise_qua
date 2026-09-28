'use client';

import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useApp } from '@/lib/store';
import {
  SOURCING_MODES,
  CURRENCY,
  formatFileSize,
  RFQ_DOCUMENT_LIMITS,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
  createRFQ,
  extractLineItemsFromDocument,
  classifyLineItems,
  uploadRFQAttachment,
  fetchAllVendors,
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
import { getMajorCategories, getMinorCategories } from '@/lib/categoryTaxonomy';
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
  ChevronDown,
  Check,
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

function taxonomyMajors(): string[] {
  return getMajorCategories();
}

function minorsFor(major: string): string[] {
  return getMinorCategories(major);
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
    remainingFreeRFQs: storeRemaining,
    activeBuyerAccount,
  } = useApp();

  const effectivePlan = forceSubscription ?? activeBuyerAccount?.subscriptionPlan ?? storeSubscription ?? 'free_trial';
  const effectiveRemaining =
    forceRemainingFreeRFQs !== undefined
      ? forceRemainingFreeRFQs
      : (activeBuyerAccount?.remainingFreeRFQs ?? storeRemaining ?? 5);
  const isPaidPlan = ['version_1', 'version_2', 'version_3'].includes(effectivePlan);
  const isQuotaExhausted = !isPaidPlan && effectiveRemaining <= 0;

  const [form, setForm] = useState<ManualRFQForm>(() => ({
    ...createEmptyManualRFQForm(),
    sourcingMode: currentMode || 'mode_2',
  }));

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSourcingDropdownOpen, setIsSourcingDropdownOpen] = useState(false);
  const sourcingDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sourcingDropdownRef.current && !sourcingDropdownRef.current.contains(event.target as Node)) {
        setIsSourcingDropdownOpen(false);
      }
    }
    if (isSourcingDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isSourcingDropdownOpen]);

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

  const validation = useMemo(() => validateManualRFQForm(form), [form]);
  const formErrors = submitAttempted ? validation.formErrors : {};
  const lineItemErrors = submitAttempted ? validation.lineItemErrors : {};

  const patchForm = useCallback(<K extends keyof ManualRFQForm>(key: K, value: ManualRFQForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

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
          `Extracted ${extracted.length} line items successfully from "${primaryFile.name}".`,
          'success'
        );
      } else {
        setExtractionError(result.error || EXTRACTION.unreadableResponse);
        showToast(EXTRACTION.fallbackTitle, result.error || EXTRACTION.unreadableResponse, 'warning');
      }
    } catch (err: any) {
      const msg = err?.message || EXTRACTION.unreadableResponse;
      setExtractionError(msg);
      showToast(EXTRACTION.fallbackTitle, msg, 'warning');
    } finally {
      setIsExtracting(false);
    }
  };

  /** Auto-categorize all line items with AI */
  const handleAutoCategorizeAll = async () => {
    const quotableEntities = form.lineItems.map((item) => ({
      id: item.id,
      itemName: item.itemName,
      technicalSpecs: item.technicalSpecs,
      quantity: Number(item.quantity) || 0,
      unit: item.unit,
      targetDate: item.targetDate,
      category: item.minorCategory,
      majorCategory: item.majorCategory,
      minorCategory: item.minorCategory,
      confidence: 0,
    })).filter((e) => e.itemName.trim() !== '');

    if (quotableEntities.length === 0) {
      showToast(EXTRACTION.classifyEmptyTitle, 'Please enter at least one item name to categorize.', 'warning');
      return;
    }

    setIsCategorizing(true);
    try {
      const result = await classifyLineItems(quotableEntities);
      if (!result.success || !result.data) {
        showToast(EXTRACTION.fallbackTitle, result.error || EXTRACTION.classifyFailed, 'warning');
        return;
      }

      const classified = new Map(result.data.extractedEntities.map((e) => [e.id, e]));
      setForm((prev) => ({
        ...prev,
        lineItems: prev.lineItems.map((item) => {
          const matched = classified.get(item.id);
          if (!matched) return item;
          return {
            ...item,
            majorCategory: matched.majorCategory || item.majorCategory,
            minorCategory: matched.minorCategory || item.minorCategory,
          };
        }),
      }));

      showToast(
        EXTRACTION.classifySuccessTitle,
        `Auto-classified ${result.data.extractedEntities.length} items across standardized categories.`,
        'success'
      );
    } catch {
      showToast(EXTRACTION.fallbackTitle, 'Category classification service unavailable.', 'warning');
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
        const allMyUploadedVendors = buyerVendors.filter((v) => isBuyerUploaded(v));
        const { signals: dispatchSignals } = extractRfqCategorySignals(updatedForm);
        const matched = dispatchSignals.length > 0
          ? allMyUploadedVendors.filter((v) => matchVendorAgainstSignals(v, dispatchSignals).isMatch)
          : [];
        const myUploadedVendors = matched.length > 0 ? matched : allMyUploadedVendors;
        if (myUploadedVendors.length > 0) {
          mode1AssignedVendors = myUploadedVendors.map(toAssignedVendorEntry);
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
      const payload = toRFQCreatePayload(sanitizedForm, mode1AssignedVendors);
      const result = await createRFQ(payload);

      if (!result.success) {
        setSubmitError(result.error || 'Failed to create RFQ.');
        showToast('Creation Failed', result.error || 'Failed to create RFQ.', 'warning');
        return;
      }

      adoptCreatedRFQ(result.rfq);
      showToast(
        'RFQ Dispatched',
        `RFQ ${result.rfq.rfqNumber} has been created and dispatched in ${form.sourcingMode.toUpperCase()} mode.`,
        'success'
      );
      onComplete();
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
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            AI RFQ Ingestion & Multi-Mode Sourcing Dispatch
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearForm}
            type="button"
            className="btn btn-secondary btn-sm font-semibold inline-flex items-center gap-1.5 text-slate-600 hover:text-rose-600 dark:text-gray-300 dark:hover:text-rose-400 cursor-pointer"
          >
            <RotateCcw size={13} />
            <span>Clear Form</span>
          </button>
          <button onClick={onCancel} className="btn btn-secondary btn-sm font-semibold cursor-pointer">
            Exit Wizard
          </button>
        </div>
      </div>

      {/* Quota Exhausted Banner */}
      {isQuotaExhausted && (
        <div
          data-testid="ingestion-wizard-quota-exhausted-banner"
          className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 dark:bg-amber-950/40 dark:border-amber-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
              <AlertCircle size={22} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-950 dark:text-amber-200">
                {EXTRACTION.quotaExhaustedTitle}
              </h3>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                {EXTRACTION.quotaExhaustedMessage}
              </p>
            </div>
          </div>
          <a
            href="/buyer/subscription-center"
            className="btn btn-primary font-bold shrink-0 inline-flex items-center gap-2 px-4 py-2 text-xs shadow-md hover:shadow-lg"
          >
            <Sparkles size={14} />
            <span>{EXTRACTION.upgradePlanAction}</span>
          </a>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TOP: DOCUMENT & REQUISITION EMAIL UPLOAD & AI EXTRACTION      */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="glass-panel p-6 rounded-2xl space-y-4 border border-indigo-100 dark:border-indigo-950 bg-gradient-to-br from-indigo-50/50 via-white to-sky-50/30 dark:from-gray-900/90 dark:via-gray-900/80 dark:to-indigo-950/20 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100/60 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <UploadCloud size={18} className="text-indigo-600 dark:text-indigo-400" />
              Upload Source Documents & Forwarded Emails
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Upload BOQ files (<span className="font-semibold text-slate-700 dark:text-slate-300">.xlsx, .xls, .csv, .pdf, .docx, .txt</span>) or Forwarded Requisition Emails (<span className="font-semibold text-indigo-600 dark:text-indigo-400">.eml, .msg</span>) — <span className="inline-flex items-center font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded text-[11px]">Max 15 MB per file</span>
            </p>
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
          className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
            isDraggingDoc
              ? 'border-indigo-600 bg-indigo-100/70 dark:bg-indigo-900/50 scale-[1.01]'
              : 'border-indigo-300/80 dark:border-indigo-500/30 hover:border-indigo-500 bg-white/70 dark:bg-gray-900/40 hover:bg-indigo-50/50'
          }`}
        >
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-600/20 border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
              <FileSpreadsheet size={20} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-600/20 border border-sky-200 dark:border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400 group-hover:scale-110 transition-transform">
              <Mail size={20} />
            </div>
          </div>
          <h3 className="text-xs font-bold text-slate-800 dark:text-white mt-2">
            {isExtracting ? 'Gemini AI is parsing document contents...' : 'Drag and drop BOQ spreadsheets or .eml / .msg emails here'}
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
            Supports Excel (.xlsx, .xls), CSV, PDF specs, Word (.docx), Plain Text (.txt), and Outlook/MIME Email (.eml, .msg) — <span className="font-semibold text-slate-700 dark:text-slate-300">Max 15 MB</span>.
          </p>
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
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs">
            <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Sparkles size={14} /> Extraction Complete
            </div>
            <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200 mt-0.5">
              Successfully extracted <strong>{extractionSummary.accepted} line items</strong> from &ldquo;{extractionSummary.fileName}&rdquo; using {extractionSummary.model}. Review and adjust details below.
            </p>
          </div>
        )}

        {extractionError && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/60 text-xs space-y-1">
            <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
              <AlertCircle size={14} /> Document Parsing Notice
            </div>
            <p className="text-[11px] text-amber-900/90 dark:text-amber-200">{extractionError}</p>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-300 font-semibold">
              You can key line items directly in the table below.
            </p>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 1: RFQ DETAILS & DELIVERY SPECIFICATIONS              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="glass-panel p-6 rounded-2xl space-y-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs">
        <div className="border-b border-slate-100 dark:border-gray-800 pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText size={18} className="text-indigo-600 dark:text-indigo-400" />
            1. RFQ Details & Delivery Terms
          </h2>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
            Specify the procurement title, target location, and financial parameters for this requirement.
          </p>
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

          {/* Delivery Pincode */}
          <div>
            <label htmlFor="rfq-pincode" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {MODAL.deliveryPincodeLabel}
              <span className="text-rose-600 dark:text-rose-400 font-bold ml-0.5">*</span>
            </label>
            <input
              id="rfq-pincode"
              type="text"
              required
              value={form.deliveryPincode}
              onChange={(e) => patchForm('deliveryPincode', e.target.value)}
              placeholder={MODAL.deliveryPincodePlaceholder}
              maxLength={10}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white mono font-semibold focus:ring-2 focus:ring-indigo-500"
            />
            <FieldError message={formErrors.deliveryPincode} />
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
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 2: LINE ITEMS & TAXONOMY CATEGORIZATION TABLE         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="glass-panel p-6 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
              2. Line Items Specification ({form.lineItems.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Classify each item into its standardized <strong>Major Category</strong> and <strong>Minor Category</strong> from the verified taxonomy.
            </p>
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
            <button
              onClick={() => setForm(addManualRFQLineItem(form))}
              className="btn btn-primary btn-sm font-bold flex items-center gap-1 shadow-xs"
            >
              <Plus size={14} /> Add Line Item
            </button>
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
                          {taxonomyMajors().map((major) => (
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
                          {minorsFor(item.majorCategory).map((minor) => (
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
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 3: SOURCING MODE SELECTION (DROPDOWN)                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="glass-panel p-6 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs">
        <div className="border-b border-slate-100 dark:border-gray-800 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 size={18} className="text-indigo-600 dark:text-indigo-400" />
              3. Select Sourcing Mode
            </h2>
            <span className="text-xs font-semibold text-slate-500 dark:text-gray-400">
              Choose how suppliers are matched and invited
            </span>
          </div>
        </div>

        <div className="space-y-3" ref={sourcingDropdownRef}>
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
                {mode.shortLabel}: {mode.description} • [{mode.featureSummary}]
              </option>
            ))}
          </select>

          {/* Custom Rich Dropdown Selector */}
          <div className="relative">
            {(() => {
              const activeMode = SOURCING_MODES.find((m) => m.id === form.sourcingMode) || SOURCING_MODES[0];
              const badgeConfigs: Record<string, { icon: string; badge: string; badgeStyle: string }> = {
                mode_1: {
                  icon: '🎯',
                  badge: 'STARTER',
                  badgeStyle: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                },
                mode_2: {
                  icon: '⚡',
                  badge: 'RECOMMENDED',
                  badgeStyle: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
                },
                mode_3: {
                  icon: '🚀',
                  badge: 'FULL REACH',
                  badgeStyle: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
                },
              };
              const activeConfig = badgeConfigs[activeMode.id] || badgeConfigs.mode_1;

              return (
                <div>
                  <button
                    type="button"
                    onClick={() => setIsSourcingDropdownOpen((prev) => !prev)}
                    aria-expanded={isSourcingDropdownOpen}
                    className="w-full text-left rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/90 p-3.5 hover:border-indigo-400 dark:hover:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 transition-all flex items-center justify-between gap-4 shadow-2xs cursor-pointer group"
                  >
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/50 text-lg shadow-2xs group-hover:scale-105 transition-transform">
                        {activeConfig.icon}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-slate-900 dark:text-white">
                            {activeMode.shortLabel}
                          </span>
                          <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider border ${activeConfig.badgeStyle}`}>
                            {activeConfig.badge}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-gray-400 truncate hidden lg:inline">
                            — {activeMode.description}
                          </span>
                        </div>
                        {/* Selected Mode Feature Badge Pill */}
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-slate-50 dark:bg-gray-900/90 border border-slate-200/80 dark:border-gray-700/80 text-[11px] font-semibold text-slate-700 dark:text-gray-300">
                          <CheckCircle2 size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                          <span>{activeMode.featureSummary}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hidden sm:inline">
                        Change
                      </span>
                      <div className="p-1 rounded-lg bg-slate-100 dark:bg-gray-700/60 text-slate-500 dark:text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                        <ChevronDown
                          size={16}
                          className={`transition-transform duration-200 ${
                            isSourcingDropdownOpen ? 'rotate-180 text-indigo-600 dark:text-indigo-400' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </button>

                  {/* Dropdown Menu Popover */}
                  {isSourcingDropdownOpen && (
                    <div className="absolute z-50 mt-2 w-full rounded-2xl border border-slate-200/90 dark:border-gray-700/80 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-2xl shadow-slate-900/10 dark:shadow-black/60 p-2 space-y-2 animate-fade-in">
                      {SOURCING_MODES.map((mode, index) => {
                        const isSelected = form.sourcingMode === mode.id;
                        const config = [
                          {
                            icon: '🎯',
                            badge: 'STARTER',
                            badgeStyle: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                          },
                          {
                            icon: '⚡',
                            badge: 'RECOMMENDED',
                            badgeStyle: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
                          },
                          {
                            icon: '🚀',
                            badge: 'FULL REACH',
                            badgeStyle: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
                          },
                        ][index];

                        return (
                          <div
                            key={mode.id}
                            data-testid={`custom-mode-option-${mode.id}`}
                            onClick={() => {
                              patchForm('sourcingMode', mode.id as SourcingMode);
                              setIsSourcingDropdownOpen(false);
                            }}
                            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                              isSelected
                                ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700/80 shadow-xs'
                                : 'bg-slate-50/50 dark:bg-gray-800/30 border-slate-100 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 hover:bg-white dark:hover:bg-gray-800/80'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5">
                                <span className="text-lg shrink-0" aria-hidden="true">{config.icon}</span>
                                <h4 className={`text-sm font-bold ${isSelected ? 'text-indigo-950 dark:text-indigo-200' : 'text-slate-900 dark:text-white'}`}>
                                  {mode.shortLabel}
                                </h4>
                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider border ${config.badgeStyle}`}>
                                  {config.badge}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {isSelected ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-100/70 dark:bg-indigo-900/50 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
                                    <Check size={12} /> Active
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-medium text-slate-400 hover:text-indigo-600 transition-colors">
                                    Select
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Description */}
                            <p className="text-xs text-slate-600 dark:text-gray-300 leading-relaxed pl-7">
                              {mode.description}
                            </p>

                            {/* Feature Badge Pill */}
                            <div className="pl-7 pt-0.5">
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/90 dark:bg-gray-950/60 border border-slate-200/90 dark:border-gray-700/80 text-[11px] font-semibold text-slate-700 dark:text-gray-300 shadow-2xs">
                                <CheckCircle2 size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                                <span>{mode.featureSummary}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Test & Quick Selector Target */}
          <div className="hidden" aria-hidden="true">
            {SOURCING_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                data-testid={`mode-${mode.id}`}
                onClick={() => patchForm('sourcingMode', mode.id as SourcingMode)}
              >
                {mode.shortLabel}
              </button>
            ))}
          </div>
        </div>

        {/* ── Mode 1: Private Approved Vendor Roster Preview ── */}
        {form.sourcingMode === 'mode_1' && (
          <div className="mt-5 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-5 space-y-4 animate-fade-in shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-100 dark:border-blue-900/40 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-600 text-white shadow-xs">
                  <Building2 size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Mode 1: Buyer&apos;s Approved Vendor Roster</span>
                    <span className="badge badge-blue text-[10px] font-bold">
                      {(() => {
                        const uploaded = buyerVendors.filter((v) => isBuyerUploaded(v));
                        const { signals } = extractRfqCategorySignals(form);
                        const matched = signals.length > 0
                          ? uploaded.filter((v) => matchVendorAgainstSignals(v, signals).isMatch)
                          : [];
                        const effective = matched.length > 0 ? matched : uploaded;
                        return effective.length;
                      })()} Suppliers Found
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                    This RFQ will strictly be dispatched to your private, pre-approved supplier network below.
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-900/50 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800 shrink-0">
                🔒 Private Roster Only
              </span>
            </div>

            {(() => {
              const allMyVendors = buyerVendors.filter((v) => isBuyerUploaded(v));
              const { signals: mode1Signals } = extractRfqCategorySignals(form);
              const matched = mode1Signals.length > 0
                ? allMyVendors.filter((v) => matchVendorAgainstSignals(v, mode1Signals).isMatch)
                : [];
              const myVendors = matched.length > 0 ? matched : allMyVendors;
              if (myVendors.length === 0) {
                return (
                  <div className="p-6 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 space-y-2">
                    <Users size={28} className="mx-auto text-slate-400 opacity-60" />
                    <p className="text-xs font-bold text-slate-700 dark:text-gray-300">No Private Vendors Uploaded Yet</p>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 max-w-md mx-auto">
                      Please ingest your 1–3 Year Purchase Orders or add approved vendors in the Vendor Directory to auto-dispatch in Mode 1.
                    </p>
                  </div>
                );
              }

              return (
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

                    return (
                      <div
                        key={vendor.id || idx}
                        className="rounded-xl border border-slate-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-3.5 space-y-2 shadow-2xs hover:border-blue-300 dark:hover:border-blue-700 transition-all"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-xs font-bold font-mono">
                              {idx + 1}
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate" title={vendor.name}>
                              {vendor.name}
                            </span>
                          </div>
                          <span className="badge badge-emerald text-[9px] font-bold shrink-0">
                            Preferred
                          </span>
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

                        {/* Category & Rating */}
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
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Mode 2: Hybrid Sourcing Pool (Private Roster + AI Routing) ── */}
        {form.sourcingMode === 'mode_2' && (
          <div className="mt-5 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-5 space-y-4 animate-fade-in shadow-xs">
            {(() => {
              const allMyVendors = buyerVendors.filter(isBuyerUploaded);
              const { signals: rfqSignals } = extractRfqCategorySignals(form);
              const myVendors = rfqSignals.length > 0
                ? allMyVendors.filter((v) => matchVendorAgainstSignals(v, rfqSignals).isMatch)
                : allMyVendors;

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
                            {myVendors.length} Private Suppliers Matched
                          </span>
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                          Dispatches to your approved roster ({myVendors.length}) with automated AI qualification and follow-ups.
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
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-900/50 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 shrink-0">
                        ⚡ Hybrid Active
                      </span>
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

                  {/* Buyer Approved Roster */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                        <Building2 size={13} className="text-blue-600 dark:text-blue-400" />
                        <span>Buyer Approved Roster ({myVendors.length} Private Vendors)</span>
                      </h4>
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">Direct Invites</span>
                    </div>

                    {myVendors.length === 0 ? (
                      <div className="p-3.5 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500">
                        No private vendors found — please add vendors in your directory.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto pr-1">
                        {myVendors.map((v, i) => (
                          <div key={v.id || i} className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200/80 dark:border-gray-800 space-y-1 shadow-2xs">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{v.name}</span>
                              <span className="badge badge-blue text-[8px] font-bold shrink-0">Private</span>
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                              <span className="font-semibold text-slate-700 dark:text-gray-300">{v.majorCategory || 'General Industrial'}</span>
                              <span>{v.location || v.city || v.state || 'India'}</span>
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
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* FOOTER ACTIONS & SUBMISSION                                   */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {isQuotaExhausted && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle size={16} className="text-amber-600 shrink-0" />
            <span>{EXTRACTION.quotaExhaustedMessage}</span>
          </div>
          <a href="/buyer/subscription-center" className="font-bold underline hover:text-amber-700 text-xs shrink-0 inline-flex items-center gap-1">
            <span>{EXTRACTION.upgradePlanAction}</span>
            <ArrowRight size={13} />
          </a>
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
          <a
            href="/buyer/subscription-center"
            className="btn btn-primary font-black flex items-center gap-2 px-6 py-2.5 shadow-md hover:shadow-lg cursor-pointer"
          >
            <Sparkles size={16} />
            <span>Please Upgrade Your Plan</span>
            <ArrowRight size={16} />
          </a>
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
    </div>
  );
}
