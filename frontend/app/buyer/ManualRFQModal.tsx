'use client';

// ==============================================================================
// MANUAL RFQ ENTRY MODAL
// ==============================================================================
// Opened from the Manual tab on the ingestion wizard. Everything the buyer keys
// lives in a single ManualRFQForm from lib/manualRfqModel, so the rules about when
// an RFQ may be dispatched are stated once and tested without rendering a screen.
//
// The RFQ number is not shown or chosen here. The server allocates it under the
// same scheme the Java p2pservices application uses, and this dialog adopts what
// the server returns rather than assuming what it saved.
// ==============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { isBuyerUploaded, isProcucevVendor } from './vendor-summary';
import { extractRfqCategorySignals, getCategoryMatchedProcucevVendors, matchVendorAgainstSignals } from '@/lib/vendorMatching';
import {
  Plus,
  Trash2,
  X,
  Loader2,
  Send,
  AlertCircle,
  Paperclip,
  FileText,
  Sparkles,
  CheckCircle2,
  Building2,
  Mail,
  Phone,
  Users,
  Star,
  ShieldCheck,
  Info,
  Check,
  CheckSquare,
  Square,
  Search,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { getMajorCategories, getMinorCategories, autoCategorizeItem, getDefaultMinorForMajor } from '@/lib/categoryTaxonomy';
import { CURRENCY, SOURCING_MODES, entitledSourcingModes, RFQ_DOCUMENT_LIMITS } from '@/lib/constants';
import { createRFQ, extractLineItemsFromDocument, fetchAllVendors, uploadRFQAttachment, requestVendorCategoryUpdateEmail } from '@/lib/rfqClient';
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
import { UI_STRINGS, formatString, extractionReasonMessage } from '@/lib/uiStrings';
import type {
  ManualRFQForm,
  ManualRFQLineItem,
  RFQAttachment,
  RFQItem,
  SourcingMode,
  VendorEntry,
} from '@/lib/types';

const EXTRACTION = UI_STRINGS.rfqExtraction;

const MANUAL = UI_STRINGS.manualRfq;
const MODAL = UI_STRINGS.manualRfqModal;

// Read at render time from the taxonomy registry the store populates from the
// database, not captured at module scope from a bundled JSON file. A bundled copy
// could offer a category the master no longer contains, and the row is dispatched
// to vendors under whatever is selected here.
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

interface ManualRFQModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the server's saved record once the RFQ is created. */
  onCreated: (rfq: RFQItem) => void;
}

/** A field-level validation message, rendered only once the buyer has submitted. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[10px] text-rose-700 dark:text-rose-400 mt-1">{message}</p>;
}

export default function ManualRFQModal({ isOpen, onClose, onCreated }: ManualRFQModalProps) {
  let buyerVendors: any[] = [];
  let entitledModes: ReturnType<typeof entitledSourcingModes> = entitledSourcingModes(null);
  let remainingFreeRFQs = 5;
  let activeSubscription = 'free_trial';
  let activeBuyerAccount: any = null;
  let store: ReturnType<typeof useApp> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    store = useApp();
    buyerVendors = store?.buyerVendors || [];
    entitledModes = entitledSourcingModes(
      store?.activeBuyerAccount?.subscriptionPlan ?? store?.activeSubscription,
      store?.activeBuyerAccount?.remainingFreeRFQs ?? store?.remainingFreeRFQs
    );
    remainingFreeRFQs = store?.activeBuyerAccount?.remainingFreeRFQs ?? store?.remainingFreeRFQs ?? 5;
    activeSubscription = store?.activeBuyerAccount?.subscriptionPlan ?? store?.activeSubscription ?? 'free_trial';
    activeBuyerAccount = store?.activeBuyerAccount;
  } catch {
    buyerVendors = [];
  }
  const [form, setForm] = useState<ManualRFQForm>(createEmptyManualRFQForm);
  const isPaidPlan = ['version_1', 'version_2', 'version_3'].includes(activeSubscription);
  const isQuotaExhausted = !isPaidPlan && remainingFreeRFQs <= 0 && form.sourcingMode !== 'mode_0';

  useEffect(() => {
    if (isOpen && activeBuyerAccount) {
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
  }, [isOpen, activeBuyerAccount]);
  let router: any = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter();
  } catch {
    router = null;
  }
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [vendorSearchQuery, setVendorSearchQuery] = useState<string>('');
  const [confirmationRfq, setConfirmationRfq] = useState<RFQItem | null>(null);
  const [sendingCategoryEmailVendors, setSendingCategoryEmailVendors] = useState<string[]>([]);
  const [sentCategoryEmailVendors, setSentCategoryEmailVendors] = useState<string[]>([]);

  const handleSendCategoryUpdateEmail = async (vendor: any, signals: string[]) => {
    const vendorKey = vendor?.id || vendor?.email;
    if (!vendorKey) return;
    setSendingCategoryEmailVendors((prev) => [...prev, vendorKey]);
    try {
      const res = await requestVendorCategoryUpdateEmail({
        vendorId: vendor.id,
        vendorEmail: vendor.email,
        vendorName: vendor.name || vendor.contactPerson,
        rfqCategory: signals.join(', ') || form.lineItems?.[0]?.majorCategory || 'Requested Category',
        rfqTitle: form.title || 'Procurement Requisition',
      });
      if (res.success) {
        setSentCategoryEmailVendors((prev) => [...prev, vendorKey]);
        store?.showToast?.(
          'Category Update Email Sent',
          `An email has been sent to ${vendor.name || vendor.contactPerson || 'Vendor'} (${vendor.email}) requesting them to update their category to match this RFQ.`,
          'success'
        );
      } else {
        store?.showToast?.('Email Delivery Issue', res.error || 'Failed to dispatch email.', 'warning');
      }
    } catch (err: any) {
      store?.showToast?.('Error', err?.message || 'Failed to send update email.', 'warning');
    } finally {
      setSendingCategoryEmailVendors((prev) => prev.filter((id) => id !== vendorKey));
    }
  };
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [hasExtracted, setHasExtracted] = useState(false);
  const [showAiInfo, setShowAiInfo] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  /**
   * The chosen File objects, kept only so extraction can re-read their bytes.
   *
   * A ref rather than state: the uploaded attachment metadata is what the form
   * carries, and re-rendering on every file selection buys nothing. The bytes
   * themselves are never put on the form, because a 10MB PDF is roughly 13MB of
   * base64 in every subsequent render.
   */
  const pendingFilesRef = useRef<File[]>([]);

  // Mode 2/3's "Procucev marketplace matches" used to score-match against
  // `buyerVendors` — the same 500-row bootstrap-capped list used app-wide for
  // startup. Once the real directory grew into the tens of thousands, that
  // cap became dominated by whatever category happened to be uploaded most
  // recently (e.g. 495/500 "bearings and accessories" after one bulk
  // import), so a buyer creating an RFQ for almost any other category saw
  // next to nothing — not because no matches existed, but because the form
  // never looked past the first 500 rows of an 80k+-row table. Fetched from
  // the real paginated/searchable directory instead, scoped to the RFQ's
  // own category signals, same as every other screen fixed this session.
  const { rawSignals: categoryFetchSignals } = useMemo(() => extractRfqCategorySignals(form), [form]);
  const [fetchedCategoryVendors, setFetchedCategoryVendors] = useState<VendorEntry[]>([]);
  const lastFetchedCategorySignalsRef = useRef<string>('');
  useEffect(() => {
    const key = categoryFetchSignals.slice().sort().join('|');
    if (!key) {
      setFetchedCategoryVendors([]);
      lastFetchedCategorySignalsRef.current = '';
      return;
    }
    if (key === lastFetchedCategorySignalsRef.current) return;
    const t = setTimeout(() => {
      lastFetchedCategorySignalsRef.current = key;
      void Promise.all(
        categoryFetchSignals.slice(0, 5).map((signal) =>
          fetchAllVendors({ page: 1, pageSize: 50, search: signal })
        )
      ).then((results) => {
        const byId = new Map<string, VendorEntry>();
        for (const result of results) {
          if (result.success) {
            for (const v of result.candidates) byId.set(v.id, v as unknown as VendorEntry);
          }
        }
        setFetchedCategoryVendors(Array.from(byId.values()));
      });
    }, 350);
    return () => clearTimeout(t);
  }, [categoryFetchSignals]);

  const [pincodeError, setPincodeError] = useState<string | null>(null);
  const [pincodeValidating, setPincodeValidating] = useState(false);
  const [pincodePostOffices, setPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  const pincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const validation = useMemo(() => validateManualRFQForm(form), [form]);

  // Held back until the buyer tries to save. Validating on open would greet them
  // with a screen of red against fields they have not reached.
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

  const [isCategorizing, setIsCategorizing] = useState(false);

  const handleAutoCategorizeAll = () => {
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
    } finally {
      setIsCategorizing(false);
    }
  };

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

  /**
   * Upload each chosen file and keep only its metadata on the form.
   *
   * Uploaded one at a time so a single rejected file is reported against that
   * file rather than failing the whole selection.
   */
  const handleAttach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsAttaching(true);
    setAttachError(null);
    // Retained for extraction, which needs the bytes rather than the metadata.
    pendingFilesRef.current = [...pendingFilesRef.current, ...Array.from(files)];
    const stored: RFQAttachment[] = [];
    const failures: string[] = [];

    for (const file of Array.from(files)) {
      if (file.size > RFQ_DOCUMENT_LIMITS.MAX_FILE_SIZE_BYTES) {
        failures.push(`${file.name}: File exceeds the 15 MB limit`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- reported per file, so each
      // upload has to resolve before the next is attempted.
      const result = await uploadRFQAttachment(file);
      if (result.success && result.data) stored.push(result.data);
      else failures.push(`${file.name}: ${result.error || ''}`.trim());
    }

    if (stored.length > 0) {
      setForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...stored] }));
    }
    if (failures.length > 0) setAttachError(failures.join(' | '));

    setIsAttaching(false);
    // Cleared so choosing the same file again still fires a change event.
    if (attachInputRef.current) attachInputRef.current.value = '';
  };

  /**
   * Read the attached documents and fill the line-item table from them.
   *
   * Optional on this path: the buyer may key everything by hand. When extraction
   * succeeds the rows are replaced with what was read, and they remain fully
   * editable — nothing is locked, because the model can misread a scan and the
   * buyer is the one who has to stand behind the numbers sent to vendors.
   *
   * A failure is reported and changes nothing, so a bad extraction never costs the
   * buyer rows they had already keyed.
   */
  const handleExtractFromDocuments = async () => {
    const files = pendingFilesRef.current;
    if (files.length === 0) return;

    setIsExtracting(true);
    setExtractError(null);

    const extracted: ManualRFQLineItem[] = [];
    const failures: string[] = [];
    let derivedTitle = '';
    let derivedBudget: number | null = null;

    for (const file of files) {
      if (file.size > RFQ_DOCUMENT_LIMITS.MAX_FILE_SIZE_BYTES) {
        failures.push(`${file.name}: File exceeds the 15 MB limit`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- each document is reported
      // against itself, so they are read one at a time.
      const request = await buildExtractionRequest(file);
      // eslint-disable-next-line no-await-in-loop
      const result = await extractLineItemsFromDocument(request);

      if (!result.success || !result.data) {
        failures.push(`${file.name}: ${extractionReasonMessage(result.reason, result.error)}`);
        continue;
      }
      if (!derivedTitle && result.data.title) derivedTitle = result.data.title;
      if (derivedBudget === null && result.data.estimatedBudget) {
        derivedBudget = result.data.estimatedBudget;
      }
      extracted.push(...result.data.extractedEntities.map(fromExtractedEntity));
    }

    setIsExtracting(false);

    if (failures.length > 0) setExtractError(failures.join(' | '));
    if (extracted.length === 0) return;

    setHasExtracted(true);
    setForm((prev) => ({
      ...prev,
      title: prev.title || derivedTitle,
      estimatedBudget: prev.estimatedBudget ?? derivedBudget,
      majorCategory: prev.majorCategory || extracted[0].majorCategory,
      lineItems: extracted,
    }));
  };

  /**
   * Recovery action from the extraction-failure notice: clear the error and make
   * sure there is at least one blank row to key into, so the buyer can proceed
   * manually without hunting for the add-item button.
   */
  const handleEnterManually = () => {
    setExtractError(null);
    setForm((prev) => (prev.lineItems.length === 0 ? addManualRFQLineItem(prev) : prev));
  };

  const handleSubmit = async () => {
    setSubmitAttempted(true);
    setSubmitError(null);

    if (isQuotaExhausted) {
      setSubmitError(MODAL.quotaExhaustedMessage);
      return;
    }

    if (!validateManualRFQForm(form).isValid) return;

    setIsSaving(true);
    let mode1AssignedVendors: Array<{
      id?: string;
      name: string;
      email?: string | null;
      contactPerson?: string | null;
      phone?: string | null;
    }> | undefined = undefined;

    if (form.sourcingMode === 'mode_1' || form.sourcingMode === 'mode_2') {
      if (Array.isArray(buyerVendors)) {
        const pool = form.sourcingMode === 'mode_1'
          ? buyerVendors.filter((v) => isBuyerUploaded(v))
          : buyerVendors;
        const { signals } = extractRfqCategorySignals(form);
        const candidatePool = selectedVendorIds.length > 0
          ? pool.filter((v) => selectedVendorIds.includes(v.id))
          : pool;

        const matchingVendors: typeof candidatePool = [];
        const mismatchedVendors: typeof candidatePool = [];

        for (const v of candidatePool) {
          if (signals.length === 0 || matchVendorAgainstSignals(v, signals).isMatch) {
            matchingVendors.push(v);
          } else {
            mismatchedVendors.push(v);
          }
        }

        if (mismatchedVendors.length > 0) {
          store?.showToast?.(
            'Shortlist Adjusted',
            `${mismatchedVendors.length} vendor(s) have category mismatches and were excluded from RFQ shortlist. Update request email dispatched.`,
            'info'
          );
        }

        if (matchingVendors.length > 0) {
          mode1AssignedVendors = matchingVendors.map((v) => ({
            id: v.id,
            name: v.name || 'Enterprise Vendor',
            email: v.email || null,
            contactPerson: v.contactPerson || v.name || null,
            phone: v.phone || (v as any).mobile || (v as any).mobileNumber || null,
          }));
        }
      }
      if (form.sourcingMode === 'mode_1' && (!mode1AssignedVendors || mode1AssignedVendors.length === 0)) {
        setIsSaving(false);
        setSubmitError('Version 1 (Client Sourcing) requires at least one private vendor to be selected before creating the RFQ.');
        return;
      }
    }

    const result = await createRFQ(
      toRFQCreatePayload(form, mode1AssignedVendors, hasExtracted ? 'ai_extraction' : 'manual_entry')
    );
    setIsSaving(false);

    if (!result.success) {
      setSubmitError(result.error);
      return;
    }

    onCreated(result.rfq);
    onClose();
    setSubmitAttempted(false);
  };

  const handleClose = () => {
    if (isSaving) return;
    setSubmitError(null);
    setConfirmationRfq(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-rfq-modal-title"
      data-testid="manual-rfq-modal"
    >
      <div className="w-full max-w-5xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-800 my-auto">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-gray-800">
          <div>
            <h2
              id="manual-rfq-modal-title"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              {MODAL.title}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 max-w-2xl">
              {MODAL.subtitle}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isSaving}
            aria-label={MODAL.closeAria}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        {confirmationRfq ? (
          <div className="p-8 text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 size={36} />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">RFQ Created & Dispatched Successfully!</h3>
              <p className="text-sm text-slate-500 dark:text-gray-400 max-w-md mx-auto">
                Your RFQ <strong className="text-indigo-600 dark:text-indigo-400 font-mono">{confirmationRfq.rfqNumber}</strong> has been saved and invitations have been queued for matched suppliers.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto text-left">
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
                <span className="text-[10px] font-semibold text-slate-400 block uppercase tracking-wider">Vendors Assigned</span>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                  {confirmationRfq.assignedVendors?.length || (confirmationRfq.sourcingMode === 'mode_3' ? 'AI Matched' : '1+ Supplier')}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-200 dark:border-gray-800">
              <button
                onClick={() => {
                  setConfirmationRfq(null);
                  setForm(createEmptyManualRFQForm());
                }}
                className="btn btn-secondary btn-md font-bold"
              >
                Create Another RFQ
              </button>
              <button
                onClick={() => {
                  handleClose();
                  router.push(`/buyer/quote-matrix?rfq=${encodeURIComponent(confirmationRfq.rfqNumber)}`);
                }}
                className="btn btn-secondary btn-md font-bold inline-flex items-center gap-1.5"
              >
                <span>View Quotation Matrix</span>
                <ExternalLink size={14} />
              </button>
              <button
                onClick={handleClose}
                className="btn btn-primary btn-md font-bold inline-flex items-center gap-1.5"
              >
                <Check size={16} />
                <span>Done / Close</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-5 text-xs">
          {isQuotaExhausted && (
            <div
              data-testid="manual-rfq-quota-exhausted-banner"
              className="p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-emerald-500/10 border border-amber-500/30 dark:bg-amber-950/40 dark:border-amber-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={18} />
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                      {MODAL.quotaExhaustedTitle}
                    </h4>
                    <span className="badge badge-emerald text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                      <Zap size={10} className="fill-current" />
                      {MODAL.v0FreeBadge}
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 dark:text-amber-300">
                    {MODAL.quotaExhaustedMessage}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, sourcingMode: 'mode_0' }))}
                  className="btn btn-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Zap size={13} className="fill-current" />
                  <span>{MODAL.useV0Action}</span>
                </button>
                <a
                  href="/buyer/subscription-center"
                  className="btn btn-primary btn-sm font-bold shrink-0 inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Sparkles size={13} />
                  <span>{MODAL.upgradePlanAction}</span>
                </a>
              </div>
            </div>
          )}

          {/* ── Supporting documents ──────────────────────────────────────── */}
          {/* Stored server-side and downloadable from the RFQ. Never sent for AI
              extraction: this is the manual path, so the document is evidence to
              attach rather than something to be read. */}
          <section className="p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-950/40 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Paperclip size={13} className="text-slate-500 dark:text-gray-400" />
                  {MODAL.attachHeading}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 max-w-xl">
                  {MODAL.attachHint}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => attachInputRef.current?.click()}
                  disabled={isAttaching || isExtracting}
                  className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Paperclip size={13} />
                  {isAttaching ? MODAL.attachingAction : MODAL.attachAction}
                </button>
                {/* Optional. Extraction reads the document and fills the table
                    below; the buyer can still key or correct every row after. */}
                <button
                  onClick={handleExtractFromDocuments}
                  disabled={isAttaching || isExtracting || pendingFilesRef.current.length === 0}
                  data-testid="manual-extract"
                  className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isExtracting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {isExtracting ? MODAL.extractingAction : MODAL.extractAction}
                </button>
              </div>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.eml,.msg"
                data-testid="manual-modal-attachment-input"
                className="hidden"
                onChange={(e) => handleAttach(e.target.files)}
              />
            </div>

            {attachError && (
              <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-400">
                {attachError}
              </p>
            )}
            {/* An extraction failure changes nothing, so it is reported without
                disturbing rows the buyer has already keyed. */}
            {extractError && (
              <div role="alert" className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/60 text-xs space-y-2">
                <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertCircle size={14} /> {EXTRACTION.fallbackTitle}
                </div>
                <p className="text-[11px] text-amber-900/90 dark:text-amber-200">{extractError}</p>
                <button
                  type="button"
                  onClick={handleEnterManually}
                  data-testid="manual-enter-fallback"
                  className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Plus size={13} />
                  <span>{EXTRACTION.manualEntryAction}</span>
                </button>
              </div>
            )}

            {form.attachments.length > 0 && (
              <ul className="space-y-1.5">
                {form.attachments.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <FileText size={13} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-gray-200 truncate">
                        {file.fileName}
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        patchForm(
                          'attachments',
                          form.attachments.filter((a) => a.id !== file.id)
                        )
                      }
                      aria-label={formatString(MODAL.removeAttachmentAria, { fileName: file.fileName })}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Header fields ─────────────────────────────────────────────── */}
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <div className="xl:col-span-2">
              <label htmlFor="manual-rfq-title" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                {MODAL.titleLabel}
              </label>
              <input
                id="manual-rfq-title"
                type="text"
                value={form.title}
                onChange={(e) => patchForm('title', e.target.value)}
                placeholder={MODAL.titlePlaceholder}
                maxLength={200}
                className="font-medium"
              />
              <FieldError message={formErrors.title} />
            </div>

            <div>
              <label htmlFor="manual-rfq-budget" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                {formatString(MODAL.budgetLabel, { symbol: CURRENCY.SYMBOL })}{' '}
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                  ({MODAL.optionalTag})
                </span>
              </label>
              <input
                id="manual-rfq-budget"
                type="number"
                min={0}
                value={form.estimatedBudget ?? ''}
                onChange={(e) =>
                  patchForm('estimatedBudget', e.target.value === '' ? null : Number(e.target.value))
                }
                placeholder={MODAL.budgetPlaceholder}
                className="mono font-semibold"
              />
              <FieldError message={formErrors.estimatedBudget} />
            </div>

            {/* Delivery Pincode */}
            <div>
              <label
                htmlFor="manual-rfq-pincode"
                className="block font-semibold text-slate-600 dark:text-gray-400 mb-1"
              >
                {MODAL.deliveryPincodeLabel}
                <span className="text-rose-600 dark:text-rose-400 font-bold" aria-hidden="true">
                  *
                </span>
              </label>
              <div className="relative">
                <input
                  id="manual-rfq-pincode"
                  type="text"
                  required
                  aria-required
                  aria-invalid={!!formErrors.deliveryPincode || !!pincodeError}
                  value={form.deliveryPincode}
                  onChange={(e) => patchForm('deliveryPincode', e.target.value)}
                  placeholder={MODAL.deliveryPincodePlaceholder}
                  maxLength={10}
                  className="mono font-semibold pr-20"
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
              <label
                htmlFor="manual-rfq-location"
                className="block font-semibold text-slate-600 dark:text-gray-400 mb-1"
              >
                {MODAL.deliveryLocationLabel}
                <span className="text-rose-600 dark:text-rose-400 font-bold" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="manual-rfq-location"
                type="text"
                required
                aria-required
                aria-invalid={!!formErrors.deliveryLocation}
                value={form.deliveryLocation}
                onChange={(e) => patchForm('deliveryLocation', e.target.value)}
                placeholder={MODAL.deliveryLocationPlaceholder}
                maxLength={200}
                className="font-medium"
              />
              <FieldError message={formErrors.deliveryLocation} />
            </div>

            <div>
              <label htmlFor="manual-rfq-date" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                {MODAL.targetDateLabel}
              </label>
              <input
                id="manual-rfq-date"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={form.targetDeliveryDate}
                onChange={(e) => patchForm('targetDeliveryDate', e.target.value)}
                className="font-medium"
              />
              <FieldError message={formErrors.targetDeliveryDate} />
            </div>

          </section>

          {/* ── Line items ────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                {formatString(MODAL.lineItemsHeading, { count: form.lineItems.length })}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAutoCategorizeAll}
                  disabled={isCategorizing || form.lineItems.length === 0}
                  className="btn btn-secondary btn-sm text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 flex items-center gap-1 font-semibold disabled:opacity-50"
                  title="Auto-identify and assign major/minor categories for all items"
                >
                  {isCategorizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {isCategorizing ? 'Classifying...' : 'Auto-Categorize All (AI)'}
                </button>
                <button
                  onClick={() => setForm(addManualRFQLineItem(form))}
                  className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5"
                >
                  <Plus size={13} /> {MODAL.addItemAction}
                </button>
              </div>
            </div>

            <FieldError message={formErrors.lineItems} />

            {form.lineItems.length === 0 ? (
              <p className="p-6 text-center rounded-xl border border-dashed border-slate-300 dark:border-gray-700 text-slate-500 dark:text-gray-400">
                {MODAL.noItemsMessage}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800">
                <table className="w-full text-left min-w-[1080px]">
                  <thead className="bg-slate-50 dark:bg-gray-950/60 text-[10px] uppercase tracking-wide text-slate-500 dark:text-gray-400">
                    <tr>
                      <th className="px-2 py-2 font-bold">{MODAL.colItem}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colSpecs}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colMajor}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colMinor}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colQty}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colUnit}</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                    {form.lineItems.map((item) => {
                      const errors = lineItemErrors[item.id] || {};
                      return (
                        <tr key={item.id} data-testid={`manual-row-${item.id}`}>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="text"
                              aria-label={MODAL.colItem}
                              aria-invalid={!!errors.itemName}
                              value={item.itemName}
                              onChange={(e) => patchItem(item.id, { itemName: e.target.value })}
                              placeholder={MODAL.itemPlaceholder}
                              className="font-medium w-56"
                            />
                            <FieldError message={errors.itemName} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="text"
                              aria-label={MODAL.colSpecs}
                              value={item.technicalSpecs}
                              onChange={(e) => patchItem(item.id, { technicalSpecs: e.target.value })}
                              placeholder={MODAL.specsPlaceholder}
                              className="w-48"
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <select
                              aria-label={MODAL.colMajor}
                              aria-invalid={!!errors.majorCategory}
                              value={item.majorCategory}
                              onChange={(e) => patchItem(item.id, { majorCategory: e.target.value })}
                              className="w-44"
                            >
                              <option value="">{MODAL.selectPlaceholder}</option>
                              {withStoredValue(taxonomyMajors(), item.majorCategory).map((major) => (
                                <option key={major} value={major}>
                                  {major}
                                </option>
                              ))}
                            </select>
                            <FieldError message={errors.majorCategory} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <select
                              aria-label={MODAL.colMinor}
                              aria-invalid={!!errors.minorCategory}
                              value={item.minorCategory}
                              disabled={item.majorCategory === ''}
                              onChange={(e) => patchItem(item.id, { minorCategory: e.target.value })}
                              className="w-44 disabled:opacity-50"
                            >
                              <option value="">{MODAL.selectPlaceholder}</option>
                              {withStoredValue(minorsFor(item.majorCategory), item.minorCategory).map((minor) => (
                                <option key={minor} value={minor}>
                                  {minor}
                                </option>
                              ))}
                            </select>
                            <FieldError message={errors.minorCategory} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="number"
                              min={1}
                              aria-label={MODAL.colQty}
                              aria-invalid={!!errors.quantity}
                              // Empty string for null so a blank row shows blank
                              // rather than a zero the buyer never typed.
                              value={item.quantity ?? ''}
                              onChange={(e) =>
                                patchItem(item.id, {
                                  quantity: e.target.value === '' ? null : Number(e.target.value),
                                })
                              }
                              placeholder={MODAL.qtyPlaceholder}
                              className="mono w-28"
                            />
                            <FieldError message={errors.quantity} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="text"
                              aria-label={MODAL.colUnit}
                              aria-invalid={!!errors.unit}
                              value={item.unit}
                              onChange={(e) => patchItem(item.id, { unit: e.target.value })}
                              placeholder={MODAL.unitPlaceholder}
                              className="w-28"
                            />
                            <FieldError message={errors.unit} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <button
                              onClick={() => setForm(removeManualRFQLineItem(form, item.id))}
                              aria-label={formatString(MODAL.removeItemAria, {
                                item: item.itemName || MODAL.untitledItem,
                              })}
                              className="p-1.5 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                            >
                              <Trash2 size={14} />
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

          {/* ── Sourcing mode ─────────────────────────────────────────────────
              Last, because it is the dispatch decision: it only makes sense once
              the buyer can see what is actually being sourced. Cards rather than a
              dropdown so the three modes can be compared before choosing. */}
          {/* ── Sourcing mode ─────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {MODAL.sourcingModeLabel}
                </h3>

                <span className="text-[10px] font-medium text-slate-400 dark:text-gray-500">
                  Choose how vendors will be sourced
                </span>
              </div>
            </div>

            <div
              aria-label={MODAL.sourcingModeLabel}
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"
            >
              {SOURCING_MODES.map((mode) => {
                const isSelected = form.sourcingMode === mode.id;
                const isEntitled = entitledModes.includes(mode.id as SourcingMode);

                const modeConfigMap: Record<string, { icon: string; accent: string; badge: string | null }> = {
                  mode_0: {
                    icon: "🌱",
                    accent: "sky",
                    badge: "FREE STARTER",
                  },
                  mode_1: {
                    icon: "🎯",
                    accent: "indigo",
                    badge: "STARTER",
                  },
                  mode_2: {
                    icon: "⚡",
                    accent: "violet",
                    badge: "RECOMMENDED",
                  },
                  mode_3: {
                    icon: "🚀",
                    accent: "emerald",
                    badge: "FULL REACH",
                  },
                };

                const modeConfig = modeConfigMap[mode.id] || {
                  icon: "📦",
                  accent: "indigo",
                  badge: null,
                };

                return (
                  <div
                    key={mode.id}
                    data-testid={`manual-mode-${mode.id}`}
                    onClick={() => {
                      if (!isEntitled) return;
                      patchForm("sourcingMode", mode.id as SourcingMode);
                    }}
                    className={`
            group relative text-left rounded-2xl border p-4 cursor-pointer
            transition-all duration-200
            ${!isEntitled
                        ? "border-slate-200 bg-slate-50/70 opacity-60 cursor-not-allowed dark:border-gray-800 dark:bg-gray-900/40"
                        : isSelected
                        ? "border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/30 shadow-sm ring-2 ring-indigo-500/15"
                        : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50/70 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                      }
          `}
                  >
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-3">
                      <div
                        aria-hidden="true"
                        className={`
                flex h-9 w-9 shrink-0 items-center justify-center
                rounded-xl text-base
                ${isSelected
                            ? "bg-indigo-100 dark:bg-indigo-900/50"
                            : "bg-slate-100 dark:bg-gray-800"
                          }
              `}
                      >
                        {modeConfig.icon}
                      </div>

                      <div className="flex items-center gap-2">
                        {!isEntitled && (
                          <span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                            LOCKED
                          </span>
                        )}
                        {isEntitled && modeConfig.badge && (
                          <span
                            className={`
                    rounded-full px-2 py-0.5 text-[8px]
                    font-extrabold tracking-wider
                    ${isSelected
                                ? "bg-indigo-600 text-white"
                                : "bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-gray-400"
                              }
                  `}
                          >
                            {modeConfig.badge}
                          </span>
                        )}

                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isEntitled}
                          aria-label={mode.shortLabel}
                          onChange={() => {
                            if (!isEntitled) return;
                            patchForm("sourcingMode", mode.id as SourcingMode);
                          }}
                          className="h-4 w-4 rounded text-indigo-600 border-slate-300 dark:border-gray-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Title */}
                    <div className="mt-3">
                      <h4
                        className={`
                text-sm font-bold
                ${isSelected
                            ? "text-indigo-950 dark:text-indigo-100"
                            : "text-slate-900 dark:text-white"
                          }
              `}
                      >
                        {mode.shortLabel}
                      </h4>

                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-gray-400">
                        {mode.description}
                      </p>
                    </div>

                    {/* Main feature */}
                    <div
                      className={`
              mt-3 rounded-lg px-2.5 py-2
              ${isSelected
                          ? "bg-white/80 dark:bg-gray-900/60"
                          : "bg-slate-50 dark:bg-gray-950/60"
                        }
            `}
                    >
                      <div className="flex items-start gap-2">
                        <CheckCircle2
                          aria-hidden="true"
                          size={13}
                          className={`
                  mt-0.5 shrink-0
                  ${isSelected
                              ? "text-indigo-600"
                              : "text-slate-400 dark:text-gray-500"
                            }
                `}
                        />

                        <span className="text-[10px] font-semibold leading-relaxed text-slate-700 dark:text-gray-300">
                          {mode.featureSummary}
                        </span>
                      </div>
                    </div>

                    {/* Selected / locked footer */}
                    {isEntitled && isSelected && (
                      <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                        <CheckCircle2 size={12} />
                        Selected sourcing mode
                      </div>
                    )}
                    {!isEntitled && (
                      <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                        <AlertCircle size={12} />
                        Upgrade your subscription to unlock
                      </div>
                    )}
                  </div>
                );
              })}
            </div>



            {/* ── Mode 1: Private Approved Vendor Roster Preview ── */}
            {form.sourcingMode === 'mode_1' && (
              <div className="mt-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-3 animate-fade-in shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-100 dark:border-blue-900/40 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded-lg bg-blue-600 text-white shadow-2xs">
                      <Building2 size={14} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>Mode 1: Buyer&apos;s Approved Vendor Roster</span>
                        <span className="badge badge-blue text-[9px] font-bold">
                          {buyerVendors.filter((v) => isBuyerUploaded(v)).length} Suppliers Found
                        </span>
                      </h4>
                      <p className="text-[10px] text-slate-500 dark:text-gray-400">
                        This RFQ will strictly be dispatched to your selected private suppliers below.
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-900/50 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800 shrink-0">
                    🔒 Private Roster Only
                  </span>
                </div>

                {(() => {
                  const allMyVendors = buyerVendors.filter((v) => isBuyerUploaded(v));
                  if (allMyVendors.length === 0) {
                    return (
                      <div className="p-4 text-center rounded-lg bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 space-y-1">
                        <Users size={22} className="mx-auto text-slate-400 opacity-60" />
                        <p className="text-xs font-bold text-slate-700 dark:text-gray-300">No Private Vendors Uploaded Yet</p>
                        <p className="text-[10px] text-slate-500 dark:text-gray-400">
                          Please ingest your PO history or add approved vendors in the Vendor Directory to dispatch in Mode 1.
                        </p>
                      </div>
                    );
                  }

                  const term = vendorSearchQuery.trim().toLowerCase();
                  const myVendors = allMyVendors.filter((v) => {
                    if (!term) return true;
                    return (
                      (v.name || '').toLowerCase().includes(term) ||
                      (v.email || '').toLowerCase().includes(term) ||
                      (v.majorCategory || '').toLowerCase().includes(term) ||
                      (v.contactPerson || '').toLowerCase().includes(term)
                    );
                  });

                  const isAllSelected = myVendors.every((v) => selectedVendorIds.includes(v.id));

                  return (
                    <div className="space-y-2.5">
                      {/* Search & Bulk Select Toolbar */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                        <div className="relative flex-1">
                          <Search size={12} className="absolute left-2.5 top-2 text-slate-400" />
                          <input
                            type="search"
                            value={vendorSearchQuery}
                            onChange={(e) => setVendorSearchQuery(e.target.value)}
                            placeholder="Search suppliers by name, category, or email..."
                            className="w-full text-xs pl-7 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                          />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              if (isAllSelected) {
                                setSelectedVendorIds((prev) => prev.filter((id) => !myVendors.some((v) => v.id === id)));
                              } else {
                                const newIds = Array.from(new Set([...selectedVendorIds, ...myVendors.map((v) => v.id)]));
                                setSelectedVendorIds(newIds);
                              }
                            }}
                            className="btn btn-secondary btn-xs text-[10px] font-bold inline-flex items-center gap-1"
                          >
                            {isAllSelected ? <Square size={11} /> : <CheckSquare size={11} />}
                            <span>{isAllSelected ? 'Deselect All' : 'Select All'}</span>
                          </button>
                          <span className="text-[10px] text-slate-500 font-semibold mono">
                            {selectedVendorIds.length > 0 ? selectedVendorIds.length : allMyVendors.length} / {allMyVendors.length} selected
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                        {myVendors.map((vendor, idx) => {
                          const isSelected = selectedVendorIds.length === 0 || selectedVendorIds.includes(vendor.id);
                          const rawMinor = vendor.minorCategories as string | string[] | undefined;
                          const minorList: string[] = Array.isArray(rawMinor)
                            ? rawMinor
                            : typeof rawMinor === 'string'
                            ? (rawMinor as string).split(',').map((s: string) => s.trim()).filter(Boolean)
                            : Array.isArray(vendor.vendorSelectedCategories)
                            ? vendor.vendorSelectedCategories
                            : [];

                          const matchResult = categoryFetchSignals.length > 0
                            ? matchVendorAgainstSignals(vendor, categoryFetchSignals)
                            : { isMatch: true };
                          const isCategoryMismatch = categoryFetchSignals.length > 0 && !matchResult.isMatch;

                          return (
                            <div
                              key={vendor.id || idx}
                              onClick={() => {
                                setSelectedVendorIds((prev) => {
                                  const currentlySelected = prev.length === 0 ? allMyVendors.map((v) => v.id) : prev;
                                  if (currentlySelected.includes(vendor.id)) {
                                    return currentlySelected.filter((id) => id !== vendor.id);
                                  } else {
                                    return [...currentlySelected, vendor.id];
                                  }
                                });
                              }}
                              className={`rounded-lg border p-2.5 space-y-1.5 shadow-2xs cursor-pointer transition-all ${
                                isSelected
                                  ? isCategoryMismatch
                                    ? 'border-amber-400 dark:border-amber-600 bg-amber-50/30 dark:bg-amber-950/20 ring-1 ring-amber-400/40'
                                    : 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/30 dark:bg-emerald-950/20 ring-1 ring-emerald-400/40'
                                  : 'border-slate-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 opacity-60'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border text-[9px] ${
                                    isSelected
                                      ? isCategoryMismatch
                                        ? 'bg-amber-600 border-amber-600 text-white'
                                        : 'bg-emerald-600 border-emerald-600 text-white'
                                      : 'border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                                  }`}>
                                    {isSelected && <Check size={10} />}
                                  </div>
                                  <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate" title={vendor.name}>
                                    {idx + 1}. {vendor.name}
                                  </span>
                                </div>
                                {isCategoryMismatch ? (
                                  <span
                                    data-testid="category-mismatch-badge"
                                    className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shrink-0"
                                    title="Category mismatch with RFQ. Excluded from shortlist until updated."
                                  >
                                    ⚠️ Mismatch
                                  </span>
                                ) : (
                                  <span className="badge badge-emerald text-[8px] font-bold shrink-0">
                                    Preferred
                                  </span>
                                )}
                              </div>

                              <div className="space-y-0.5 text-[10px] text-slate-500 dark:text-gray-400 pl-5">
                                {vendor.contactPerson && (
                                  <div className="flex items-center gap-1 text-slate-700 dark:text-gray-300">
                                    <Users size={10} className="text-slate-400 shrink-0" />
                                    <span className="truncate">{vendor.contactPerson}</span>
                                  </div>
                                )}
                                {vendor.email && (
                                  <div className="flex items-center gap-1">
                                    <Mail size={10} className="text-blue-500 shrink-0" />
                                    <span className="font-mono truncate">{vendor.email}</span>
                                  </div>
                                )}
                                {vendor.phone && (
                                  <div className="flex items-center gap-1">
                                    <Phone size={10} className="text-emerald-500 shrink-0" />
                                    <span className="font-mono">{vendor.phone}</span>
                                  </div>
                                )}
                              </div>

                              {/* Category Badges */}
                              <div className="pt-1.5 border-t border-slate-100 dark:border-gray-800 space-y-1">
                                <div className="flex items-center justify-between text-[9px] text-slate-500 dark:text-gray-400">
                                  <span className="font-semibold text-blue-700 dark:text-blue-300 truncate">
                                    {vendor.majorCategory || 'General Industrial'}
                                  </span>
                                  <span className="truncate">{vendor.city || vendor.state || vendor.location || 'India'}</span>
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
                              {isCategoryMismatch && (
                                <div className="pt-1.5 border-t border-amber-200/60 dark:border-amber-900/40">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSendCategoryUpdateEmail(vendor, categoryFetchSignals);
                                    }}
                                    disabled={sendingCategoryEmailVendors.includes(vendor.id || vendor.email)}
                                    className="w-full py-1 px-2 rounded-md text-[9px] font-bold bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white flex items-center justify-center gap-1 transition-all shadow-2xs cursor-pointer disabled:opacity-50"
                                    title="Send email requesting vendor to update category"
                                  >
                                    {sendingCategoryEmailVendors.includes(vendor.id || vendor.email) ? (
                                      <>
                                        <Loader2 size={10} className="animate-spin" />
                                        <span>Sending Email...</span>
                                      </>
                                    ) : sentCategoryEmailVendors.includes(vendor.id || vendor.email) ? (
                                      <>
                                        <CheckCircle2 size={10} />
                                        <span>Update Email Sent ✓</span>
                                      </>
                                    ) : (
                                      <>
                                        <Mail size={10} />
                                        <span>Send Email to Update Category</span>
                                      </>
                                    )}
                                  </button>
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
              <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-3 animate-fade-in shadow-2xs">
                {(() => {
                  const allMyVendors = buyerVendors.filter((v) => isBuyerUploaded(v));

                  return (
                    <>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-100 dark:border-emerald-900/40 pb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="p-1 rounded-lg bg-emerald-600 text-white shadow-2xs">
                            <Sparkles size={14} />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                              <span>Mode 2: Hybrid Sourcing Pool</span>
                              <span className="badge badge-emerald text-[9px] font-bold">
                                {allMyVendors.length} Approved Suppliers
                              </span>
                            </h4>
                            <p className="text-[10px] text-slate-500 dark:text-gray-400">
                              Dispatches to your approved internal roster below + automatically matched Procucev verified network suppliers in the background.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setShowAiInfo(!showAiInfo)}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 bg-emerald-100/70 dark:bg-emerald-900/50 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 transition-colors"
                            title="Learn how AI categorizes and matches suppliers"
                          >
                            <Info size={11} />
                            <span>AI Matching Info</span>
                          </button>
                        </div>
                      </div>

                      {/* AI Matching Info Panel */}
                      {showAiInfo && (
                        <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800/60 text-slate-800 dark:text-gray-200 space-y-2 animate-fade-in shadow-2xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 font-bold text-[11px] text-emerald-800 dark:text-emerald-200">
                              <Sparkles size={13} className="text-emerald-600 dark:text-emerald-400" />
                              <span>How QUA AI Categorizes & Matches Suppliers</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowAiInfo(false)}
                              className="text-[9px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                            >
                              ✕ Close
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] leading-relaxed">
                            <div className="p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                              <strong className="text-emerald-800 dark:text-emerald-300 block mb-0.5">1. BOQ & Line-Item Classification</strong>
                              Extracts items and maps keywords against our 280+ standard industrial category taxonomy.
                            </div>
                            <div className="p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                              <strong className="text-emerald-800 dark:text-emerald-300 block mb-0.5">2. Multi-Signal Supplier Scoring</strong>
                              Matches vendor primary capabilities, registered minor categories, and historical PO delivery records.
                            </div>
                            <div className="p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                              <strong className="text-emerald-800 dark:text-emerald-300 block mb-0.5">3. ≥80% Relevance Threshold</strong>
                              Ensures only verified suppliers with direct capability overlap receive RFQ invitations.
                            </div>
                            <div className="p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                              <strong className="text-emerald-800 dark:text-emerald-300 block mb-0.5">4. Category Benchmarking</strong>
                              Evaluates vendor reliability ratings, location proximity, and verified product specifications.
                            </div>
                          </div>
                        </div>
                      )}

                      {allMyVendors.length === 0 ? (
                        <div className="p-3 text-center rounded-lg bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[10px] text-slate-500 space-y-1">
                          <p className="font-semibold text-slate-600 dark:text-gray-400">No vendors found in directory.</p>
                          <p className="text-[9px] text-slate-400">Please ingest your approved vendor directory or explore Procucev network vendors.</p>
                        </div>
                      ) : (() => {
                        const term = vendorSearchQuery.trim().toLowerCase();
                        const myVendors = allMyVendors.filter((v) => {
                          if (!term) return true;
                          return (
                            (v.name || '').toLowerCase().includes(term) ||
                            (v.email || '').toLowerCase().includes(term) ||
                            (v.majorCategory || '').toLowerCase().includes(term) ||
                            (v.contactPerson || '').toLowerCase().includes(term)
                          );
                        });

                        const isAllSelected = myVendors.length > 0 && myVendors.every((v) => selectedVendorIds.includes(v.id));

                        return (
                          <div className="space-y-2.5">
                            {/* Search & Bulk Select Toolbar */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                              <div className="relative flex-1">
                                <Search size={12} className="absolute left-2.5 top-2 text-slate-400" />
                                <input
                                  type="search"
                                  value={vendorSearchQuery}
                                  onChange={(e) => setVendorSearchQuery(e.target.value)}
                                  placeholder="Search suppliers by name, category, or email..."
                                  className="w-full text-xs pl-7 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-slate-900 dark:text-white"
                                />
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isAllSelected) {
                                      setSelectedVendorIds((prev) => prev.filter((id) => !myVendors.some((v) => v.id === id)));
                                    } else {
                                      const newIds = Array.from(new Set([...selectedVendorIds, ...myVendors.map((v) => v.id)]));
                                      setSelectedVendorIds(newIds);
                                    }
                                  }}
                                  className="btn btn-secondary btn-xs text-[10px] font-bold inline-flex items-center gap-1"
                                >
                                  {isAllSelected ? <Square size={11} /> : <CheckSquare size={11} />}
                                  <span>{isAllSelected ? 'Deselect All' : 'Select All'}</span>
                                </button>
                                <span className="text-[10px] text-slate-500 font-semibold mono">
                                  {selectedVendorIds.length > 0 ? selectedVendorIds.length : allMyVendors.length} / {allMyVendors.length} selected
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                              {myVendors.map((vendor, idx) => {
                                const isSelected = selectedVendorIds.length === 0 || selectedVendorIds.includes(vendor.id);
                                const rawMinor = vendor.minorCategories as string | string[] | undefined;
                                const minorList: string[] = Array.isArray(rawMinor)
                                  ? rawMinor
                                  : typeof rawMinor === 'string'
                                  ? (rawMinor as string).split(',').map((s: string) => s.trim()).filter(Boolean)
                                  : Array.isArray(vendor.vendorSelectedCategories)
                                  ? vendor.vendorSelectedCategories
                                  : [];

                                const matchResult = categoryFetchSignals.length > 0
                                  ? matchVendorAgainstSignals(vendor, categoryFetchSignals)
                                  : { isMatch: true };
                                const isCategoryMismatch = categoryFetchSignals.length > 0 && !matchResult.isMatch;

                                return (
                                  <div
                                    key={vendor.id || idx}
                                    onClick={() => {
                                      setSelectedVendorIds((prev) => {
                                        const currentlySelected = prev.length === 0 ? allMyVendors.map((v) => v.id) : prev;
                                        if (currentlySelected.includes(vendor.id)) {
                                          return currentlySelected.filter((id) => id !== vendor.id);
                                        } else {
                                          return [...currentlySelected, vendor.id];
                                        }
                                      });
                                    }}
                                    className={`rounded-lg border p-2.5 space-y-1.5 shadow-2xs cursor-pointer transition-all ${
                                      isSelected
                                        ? isCategoryMismatch
                                          ? 'border-amber-400 dark:border-amber-600 bg-amber-50/30 dark:bg-amber-950/20 ring-1 ring-amber-400/40'
                                          : 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/30 dark:bg-emerald-950/20 ring-1 ring-emerald-400/40'
                                        : 'border-slate-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 opacity-60'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-1">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border text-[9px] ${
                                          isSelected
                                            ? isCategoryMismatch
                                              ? 'bg-amber-600 border-amber-600 text-white'
                                              : 'bg-emerald-600 border-emerald-600 text-white'
                                            : 'border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                                        }`}>
                                          {isSelected && <Check size={10} />}
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate" title={vendor.name}>
                                          <span className="mr-1">{idx + 1}.</span>
                                          <span>{vendor.name}</span>
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
                                          <span
                                            data-testid="category-mismatch-badge"
                                            className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shrink-0"
                                            title="Category mismatch with RFQ. Excluded from shortlist until updated."
                                          >
                                            ⚠️ Mismatch
                                          </span>
                                        ) : (
                                          <span className="badge badge-emerald text-[8px] font-bold shrink-0">
                                            Preferred
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="space-y-0.5 text-[10px] text-slate-500 dark:text-gray-400 pl-5">
                                      {vendor.contactPerson && (
                                        <div className="flex items-center gap-1 text-slate-700 dark:text-gray-300">
                                          <Users size={10} className="text-slate-400 shrink-0" />
                                          <span className="truncate">{vendor.contactPerson}</span>
                                        </div>
                                      )}
                                      {vendor.email && (
                                        <div className="flex items-center gap-1">
                                          <Mail size={10} className="text-blue-500 shrink-0" />
                                          <span className="font-mono truncate">{vendor.email}</span>
                                        </div>
                                      )}
                                      {vendor.phone && (
                                        <div className="flex items-center gap-1">
                                          <Phone size={10} className="text-emerald-500 shrink-0" />
                                          <span className="font-mono">{vendor.phone}</span>
                                        </div>
                                      )}
                                    </div>

                                    {/* Category Badges */}
                                    <div className="pt-1.5 border-t border-slate-100 dark:border-gray-800 space-y-1">
                                      <div className="flex items-center justify-between text-[9px] text-slate-500 dark:text-gray-400">
                                        <span className="font-semibold text-blue-700 dark:text-blue-300 truncate">
                                          {vendor.majorCategory || 'General Industrial'}
                                        </span>
                                        <span className="truncate">{vendor.city || vendor.state || vendor.location || 'India'}</span>
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
                                    {isCategoryMismatch && (
                                      <div className="pt-1.5 border-t border-amber-200/60 dark:border-amber-900/40">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleSendCategoryUpdateEmail(vendor, categoryFetchSignals);
                                          }}
                                          disabled={sendingCategoryEmailVendors.includes(vendor.id || vendor.email)}
                                          className="w-full py-1 px-2 rounded-md text-[9px] font-bold bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white flex items-center justify-center gap-1 transition-all shadow-2xs cursor-pointer disabled:opacity-50"
                                          title="Send email requesting vendor to update category"
                                        >
                                          {sendingCategoryEmailVendors.includes(vendor.id || vendor.email) ? (
                                            <>
                                              <Loader2 size={10} className="animate-spin" />
                                              <span>Sending Email...</span>
                                            </>
                                          ) : sentCategoryEmailVendors.includes(vendor.id || vendor.email) ? (
                                            <>
                                              <CheckCircle2 size={10} />
                                              <span>Update Email Sent ✓</span>
                                            </>
                                          ) : (
                                            <>
                                              <Mail size={10} />
                                              <span>Send Email to Update Category</span>
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  );
                })()}
              </div>
            )}

            {/* ── Mode 3: Autonomous Sourcing & Double-Blind Verification Protocol (Version 3) ── */}
            {form.sourcingMode === 'mode_3' && (
              <div className="mt-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-3 animate-fade-in shadow-2xs">
                {(() => {
                  const myVendors = buyerVendors.filter(isBuyerUploaded);

                  return (
                    <>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100 dark:border-indigo-900/40 pb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="p-1 rounded-lg bg-indigo-600 text-white shadow-2xs">
                            <ShieldCheck size={14} />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                              <span>Mode 3: Double-Blind Autonomous Sourcing</span>
                              <span className="badge badge-indigo text-[9px] font-bold">
                                {myVendors.length} Verified Suppliers
                              </span>
                            </h4>
                            <p className="text-[10px] text-slate-500 dark:text-gray-400">
                              Double-blind anonymous evaluation protocol. Buyer identity is shielded until final quote evaluation.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setShowAiInfo(!showAiInfo)}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100 bg-indigo-100/70 dark:bg-indigo-900/50 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800 transition-colors"
                            title="Learn how AI categorizes and matches suppliers"
                          >
                            <Info size={11} />
                            <span>AI Matching Info</span>
                          </button>
                          <span className="text-[9px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-900/50 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800 shrink-0">
                            🛡️ Double-Blind Active
                          </span>
                        </div>
                      </div>

                      {/* AI Matching Info Panel */}
                      {showAiInfo && (
                        <div className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800/60 text-slate-800 dark:text-gray-200 space-y-2 animate-fade-in shadow-2xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 font-bold text-[11px] text-indigo-800 dark:text-indigo-200">
                              <Sparkles size={13} className="text-indigo-600 dark:text-indigo-400" />
                              <span>How QUA AI Categorizes & Matches Suppliers</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowAiInfo(false)}
                              className="text-[9px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                            >
                              ✕ Close
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] leading-relaxed">
                            <div className="p-2 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                              <strong className="text-indigo-800 dark:text-indigo-300 block mb-0.5">1. BOQ & Line-Item Classification</strong>
                              Extracts items and maps keywords against our 280+ standard industrial category taxonomy.
                            </div>
                            <div className="p-2 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                              <strong className="text-indigo-800 dark:text-indigo-300 block mb-0.5">2. Multi-Signal Supplier Scoring</strong>
                              Matches vendor primary capabilities, registered minor categories, and historical PO delivery records.
                            </div>
                            <div className="p-2 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                              <strong className="text-indigo-800 dark:text-indigo-300 block mb-0.5">3. ≥80% Relevance Threshold</strong>
                              Ensures only verified suppliers with direct capability overlap receive RFQ invitations.
                            </div>
                            <div className="p-2 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                              <strong className="text-indigo-800 dark:text-indigo-300 block mb-0.5">4. Double-Blind Confidentiality Protocol</strong>
                              Supplier capability invites are anonymized; buyer identity is withheld until qualification.
                            </div>
                          </div>
                        </div>
                      )}

                      {myVendors.length === 0 ? (
                        <div className="p-3 text-center rounded-lg bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[10px] text-slate-500 space-y-1">
                          <p className="font-semibold text-slate-600 dark:text-gray-400">No private vendors uploaded yet.</p>
                          <p className="text-[9px] text-slate-400">The RFQ will be routed through autonomous AI category matching once vendors are added.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                          {myVendors.map((vendor, idx) => (
                            <div
                              key={vendor.id || idx}
                              className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-indigo-200/70 dark:border-indigo-900/50 space-y-1.5 shadow-2xs"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate" title={vendor.name}>{vendor.name}</span>
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40 shrink-0">
                                  Approved
                                </span>
                              </div>
                              <div className="text-[9px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                                <span className="truncate font-semibold text-indigo-700 dark:text-indigo-300">{vendor.majorCategory || 'General Industrial'}</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">🔒 Double-Blind</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </section>

          {submitError && (
            <p
              role="alert"
              className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </p>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-200 dark:border-gray-800">
          <p className="text-[11px] text-slate-400 dark:text-gray-500">
            {isQuotaExhausted ? MODAL.quotaExhaustedMessage : MODAL.serverAllocatesNumber}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} disabled={isSaving} className="btn btn-secondary btn-sm font-bold">
              {MODAL.cancelAction}
            </button>
            {isQuotaExhausted ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, sourcingMode: 'mode_0' }))}
                  className="btn btn-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Zap size={13} className="fill-current" />
                  <span>{MODAL.useV0Action}</span>
                </button>
                <a
                  href="/buyer/subscription-center"
                  className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Sparkles size={14} />
                  <span>Please Upgrade Your Plan</span>
                </a>
              </div>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSaving}
                className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {isSaving ? MODAL.savingAction : MODAL.saveAction}
              </button>
            )}
          </div>
        </footer>
          </>
        )}
      </div>
    </div>
  );
}
