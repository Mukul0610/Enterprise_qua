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
import { useApp } from '@/lib/store';
import { isBuyerUploaded, isProcucevVendor } from './vendor-summary';
import { extractRfqCategorySignals, getCategoryMatchedProcucevVendors } from '@/lib/vendorMatching';
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
} from 'lucide-react';
import { getMajorCategories, getMinorCategories } from '@/lib/categoryTaxonomy';
import { CURRENCY, SOURCING_MODES, entitledSourcingModes } from '@/lib/constants';
import { createRFQ, extractLineItemsFromDocument, fetchAllVendors, uploadRFQAttachment } from '@/lib/rfqClient';
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
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type {
  ManualRFQForm,
  ManualRFQLineItem,
  RFQAttachment,
  RFQItem,
  SourcingMode,
  VendorEntry,
} from '@/lib/types';

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
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const store = useApp();
    buyerVendors = store?.buyerVendors || [];
    entitledModes = entitledSourcingModes(store?.activeBuyerAccount?.subscriptionPlan ?? store?.activeSubscription);
    remainingFreeRFQs = store?.activeBuyerAccount?.remainingFreeRFQs ?? store?.remainingFreeRFQs ?? 5;
    activeSubscription = store?.activeBuyerAccount?.subscriptionPlan ?? store?.activeSubscription ?? 'free_trial';
  } catch {
    buyerVendors = [];
  }
  const isPaidPlan = ['version_1', 'version_2', 'version_3'].includes(activeSubscription);
  const isQuotaExhausted = !isPaidPlan && remainingFreeRFQs <= 0;
  const [form, setForm] = useState<ManualRFQForm>(createEmptyManualRFQForm);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
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

  const validation = useMemo(() => validateManualRFQForm(form), [form]);

  // Held back until the buyer tries to save. Validating on open would greet them
  // with a screen of red against fields they have not reached.
  const formErrors = submitAttempted ? validation.formErrors : {};
  const lineItemErrors = submitAttempted ? validation.lineItemErrors : {};

  const patchForm = useCallback(<K extends keyof ManualRFQForm>(key: K, value: ManualRFQForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

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
      // eslint-disable-next-line no-await-in-loop -- each document is reported
      // against itself, so they are read one at a time.
      const request = await buildExtractionRequest(file);
      // eslint-disable-next-line no-await-in-loop
      const result = await extractLineItemsFromDocument(request);

      if (!result.success || !result.data) {
        failures.push(`${file.name}: ${result.error}`);
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

    setForm((prev) => ({
      ...prev,
      title: prev.title || derivedTitle,
      estimatedBudget: prev.estimatedBudget ?? derivedBudget,
      majorCategory: prev.majorCategory || extracted[0].majorCategory,
      lineItems: extracted,
    }));
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

    if (form.sourcingMode === 'mode_1') {
      if (Array.isArray(buyerVendors)) {
        const myUploadedVendors = buyerVendors.filter((v) => isBuyerUploaded(v));
        if (myUploadedVendors.length > 0) {
          mode1AssignedVendors = myUploadedVendors.map((v) => ({
            id: v.id,
            name: v.name || 'Enterprise Vendor',
            email: v.email || null,
            contactPerson: v.contactPerson || v.name || null,
            phone: v.phone || null,
          }));
        }
      }
      if (!mode1AssignedVendors || mode1AssignedVendors.length === 0) {
        setIsSaving(false);
        setSubmitError('Version 1 (Client Sourcing) requires at least one private vendor to be added/selected before creating the RFQ.');
        return;
      }
    }

    const result = await createRFQ(toRFQCreatePayload(form, mode1AssignedVendors));
    setIsSaving(false);

    if (!result.success) {
      setSubmitError(result.error);
      return;
    }

    // The server's record is the authority: it owns the RFQ number, the row id,
    // the created timestamp and the generated summary.
    onCreated(result.rfq);
    setForm(createEmptyManualRFQForm());
    setSubmitAttempted(false);
    onClose();
  };

  const handleClose = () => {
    if (isSaving) return;
    setSubmitError(null);
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

        <div className="px-5 py-4 space-y-5 text-xs">
          {isQuotaExhausted && (
            <div
              data-testid="manual-rfq-quota-exhausted-banner"
              className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 dark:bg-amber-950/40 dark:border-amber-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={18} />
                <div>
                  <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    {MODAL.quotaExhaustedTitle}
                  </h4>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                    {MODAL.quotaExhaustedMessage}
                  </p>
                </div>
              </div>
              <a
                href="/buyer/subscription-center"
                className="btn btn-primary btn-sm font-bold shrink-0 inline-flex items-center gap-1.5 shadow-xs"
              >
                <Sparkles size={13} />
                <span>{MODAL.upgradePlanAction}</span>
              </a>
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
              <p role="alert" className="text-[11px] text-amber-700 dark:text-amber-400">
                {extractError}
              </p>
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
              <label
                htmlFor="manual-rfq-pincode"
                className="block font-semibold text-slate-600 dark:text-gray-400 mb-1"
              >
                {MODAL.deliveryPincodeLabel}
                <span className="text-rose-600 dark:text-rose-400 font-bold" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="manual-rfq-pincode"
                type="text"
                required
                aria-required
                aria-invalid={!!formErrors.deliveryPincode}
                value={form.deliveryPincode}
                onChange={(e) => patchForm('deliveryPincode', e.target.value)}
                placeholder={MODAL.deliveryPincodePlaceholder}
                maxLength={10}
                className="mono font-semibold"
              />
              <FieldError message={formErrors.deliveryPincode} />
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
              <button
                onClick={() => setForm(addManualRFQLineItem(form))}
                className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5"
              >
                <Plus size={13} /> {MODAL.addItemAction}
              </button>
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
                              {taxonomyMajors().map((major) => (
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
                              {minorsFor(item.majorCategory).map((minor) => (
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
              className="grid grid-cols-1 md:grid-cols-3 gap-3"
            >
              {SOURCING_MODES.map((mode, index) => {
                const isSelected = form.sourcingMode === mode.id;
                const isEntitled = entitledModes.includes(mode.id as SourcingMode);

                const modeConfig = [
                  {
                    icon: "🎯",
                    accent: "indigo",
                    badge: index === 0 ? "STARTER" : null,
                  },
                  {
                    icon: "⚡",
                    accent: "violet",
                    badge: index === 1 ? "RECOMMENDED" : null,
                  },
                  {
                    icon: "🚀",
                    accent: "emerald",
                    badge: index === 2 ? "FULL REACH" : null,
                  },
                ][index];

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
                        This RFQ will strictly be dispatched to your private supplier network below.
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-900/50 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800 shrink-0">
                    🔒 Private Roster Only
                  </span>
                </div>

                {(() => {
                  const myVendors = buyerVendors.filter((v) => isBuyerUploaded(v));
                  if (myVendors.length === 0) {
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

                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
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
                            className="rounded-lg border border-slate-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-2.5 space-y-1.5 shadow-2xs"
                          >
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate" title={vendor.name}>
                                {idx + 1}. {vendor.name}
                              </span>
                              <span className="badge badge-emerald text-[8px] font-bold shrink-0">
                                Preferred
                              </span>
                            </div>

                            <div className="space-y-0.5 text-[10px] text-slate-500 dark:text-gray-400">
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
              <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-3 animate-fade-in shadow-2xs">
                {(() => {
                  const myVendors = buyerVendors.filter(isBuyerUploaded);

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
                                {myVendors.length} Private Suppliers Matched
                              </span>
                            </h4>
                            <p className="text-[10px] text-slate-500 dark:text-gray-400">
                              Dispatches to your approved roster ({myVendors.length}) with automated AI qualification and follow-ups.
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
                          <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-900/50 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                            ⚡ Hybrid Active
                          </span>
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

                      {myVendors.length === 0 ? (
                        <div className="p-3 text-center rounded-lg bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[10px] text-slate-500 space-y-1">
                          <p className="font-semibold text-slate-600 dark:text-gray-400">No private vendors uploaded yet.</p>
                          <p className="text-[9px] text-slate-400">Please ingest your approved vendor directory or PO history to dispatch in Mode 2.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                          {myVendors.map((vendor, idx) => (
                            <div
                              key={vendor.id || idx}
                              className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-emerald-200/70 dark:border-emerald-900/50 space-y-1.5 shadow-2xs"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate" title={vendor.name}>{vendor.name}</span>
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200/40 shrink-0">
                                  Approved
                                </span>
                              </div>
                              <div className="text-[9px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                                <span className="truncate font-semibold text-emerald-700 dark:text-emerald-300">{vendor.majorCategory || 'General Industrial'}</span>
                                <span className="truncate">{vendor.city || vendor.state || vendor.location || 'India'}</span>
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
              <a
                href="/buyer/subscription-center"
                className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5"
              >
                <Sparkles size={14} />
                <span>Please Upgrade Your Plan</span>
              </a>
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
      </div>
    </div>
  );
}
