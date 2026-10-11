// ==============================================================================
// RFQ EDIT AND DELETE DIALOGS
// ==============================================================================
// Shared by the portfolio summary and the RFQ details screen, so an edit started
// from either place applies the same validation and sends the same request.
//
// The dialog covers everything about an RFQ that a buyer can change: its title,
// the commercial and delivery terms, the line items, and the supporting
// documents. What it deliberately does not offer is the provenance — the RFQ
// number, who raised it, when, and how it arrived. Those are shown read-only,
// because the server allocates them and the API's column whitelist would ignore
// an attempt to write them anyway; showing them makes that visible rather than
// leaving the buyer wondering where the field went.
//
// Only what changed is sent. The API treats PUT as a partial update, so posting
// the whole record back would make a one-field correction able to overwrite
// anything another session had changed, and would move `updated_at` for fields
// nobody touched.
// ==============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Paperclip, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';
import { getMajorCategories, getMinorCategories, autoCategorizeItem, getDefaultMinorForMajor } from '@/lib/categoryTaxonomy';
import { CURRENCY, RFQ_STATUSES, formatFileSize, formatIndianDateTime } from '@/lib/constants';
import { PINCODE_PATTERN, isDummyPincode, validatePincode, PostOfficeDetail } from '@/lib/validationSchemas';
import { uploadRFQAttachment } from '@/lib/rfqClient';
import { isPastDateString } from '@/lib/manualRfqModel';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type {
  ExtractedEntity,
  RFQAttachment,
  RFQEditFormErrors,
  RFQEditFormState,
  RFQEditLineItem,
  RFQItem,
  RFQUpdatePayload,
} from '@/lib/types';

const EDIT = UI_STRINGS.rfqEdit;
const DETAILS = UI_STRINGS.rfqDetails;

// Read at render time from the taxonomy registry the store populates from the
// database, rather than captured at module scope from a bundled JSON file.
function taxonomyMajors(): string[] {
  return getMajorCategories();
}

function minorsFor(major: string): string[] {
  return getMinorCategories(major);
}

/**
 * Options for a category select that has to be able to display what is stored.
 *
 * A select whose value matches none of its options renders blank, so offering only
 * taxonomy entries hid whatever the record actually held. RFQs classified into a
 * bucket outside categories.json — 'General Procurement' is the one the ingestion
 * default used to produce — arrived in this dialog with both category dropdowns
 * empty, which read as "this RFQ has no category" on a record that has one.
 *
 * The stored value is prepended rather than appended so it is the visible choice,
 * and the buyer can still pick a taxonomy value over it.
 */
function withStoredValue(options: string[], stored: string): string[] {
  return stored !== '' && !options.includes(stored) ? [stored, ...options] : options;
}

/** Human label for each intake channel, matching the details page. */
const SOURCE_LABELS: Record<string, string> = {
  web_portal: DETAILS.sourceWebPortal,
  email_gateway: DETAILS.sourceEmailGateway,
  email_upload: DETAILS.sourceEmailUpload,
  manual_entry: DETAILS.sourceManualEntry,
  ai_extraction: DETAILS.sourceAiExtraction || 'AI Extraction',
};

/** Row counter for ids on rows the buyer adds, so React keys stay stable. */
let addedRowCounter = 0;

/**
 * A stored line item as an editable row.
 *
 * `quantity` becomes null when the record holds zero or empty, because a blank field
 * and a quantity of nothing are different answers and zero is what silently reaches
 * vendors otherwise.
 */
function toEditRow(entity: ExtractedEntity | any): RFQEditLineItem {
  const rawQty = entity.quantity ?? entity.qty ?? entity.Quantity;
  const numQty =
    rawQty !== null && rawQty !== undefined && rawQty !== '' && !isNaN(Number(rawQty))
      ? Number(rawQty)
      : null;
  const rawUnit = entity.unit ?? entity.uom ?? entity.Unit ?? entity.UOM ?? '';
  const rawName = entity.itemName ?? entity.name ?? entity.item ?? entity.description ?? '';
  const rawSpecs = entity.technicalSpecs ?? entity.specs ?? entity.specifications ?? '';
  const rawTargetDate = entity.targetDate ?? entity.target_date ?? entity.deliveryDate ?? '';
  const rawMajor = entity.majorCategory ?? entity.major_category ?? '';
  const rawMinor = entity.minorCategory ?? entity.minor_category ?? '';

  return {
    id: entity.id || `rfq-item-${Date.now()}-${(addedRowCounter += 1)}`,
    itemName: String(rawName || ''),
    technicalSpecs: String(rawSpecs || ''),
    quantity: numQty !== null && numQty > 0 ? numQty : null,
    unit: String(rawUnit || ''),
    targetDate: String(rawTargetDate || ''),
    majorCategory: String(rawMajor || ''),
    minorCategory: String(rawMinor || ''),
    confidence: Number(entity.confidence) || 0,
  };
}

function emptyEditRow(): RFQEditLineItem {
  addedRowCounter += 1;
  return {
    id: `rfq-item-new-${Date.now()}-${addedRowCounter}`,
    itemName: '',
    technicalSpecs: '',
    quantity: null,
    unit: '',
    targetDate: '',
    majorCategory: '',
    minorCategory: '',
    // Zero means "no AI involved", which is exactly true of a row keyed here.
    confidence: 0,
  };
}

/** Turn an editable row back into the shape the API stores. */
function toExtractedEntity(row: RFQEditLineItem): ExtractedEntity {
  return {
    id: row.id,
    itemName: row.itemName.trim(),
    technicalSpecs: row.technicalSpecs.trim(),
    quantity: row.quantity ?? 0,
    unit: row.unit.trim(),
    targetDate: row.targetDate,
    majorCategory: row.majorCategory,
    minorCategory: row.minorCategory,
    // The details page filters on the minor category, so it is kept in step.
    category: row.minorCategory || row.majorCategory,
    confidence: row.confidence,
  };
}

/** Seed the form from the record, so all existing details auto-fill into the edit dialog. */
export function toFormState(rfq: RFQItem | any): RFQEditFormState {
  const rawEntities =
    rfq.extractedEntities ?? rfq.lineItems ?? rfq.items ?? rfq.entities ?? [];
  const entitiesList = Array.isArray(rawEntities) ? rawEntities : [];
  const rawBudget = rfq.budget ?? rfq.estimatedBudget ?? rfq.estimated_budget;
  const numBudget =
    rawBudget !== null && rawBudget !== undefined && rawBudget !== '' && !isNaN(Number(rawBudget))
      ? Number(rawBudget)
      : null;

  return {
    title: rfq.title || '',
    category: rfq.category || '',
    status: rfq.status || 'Parsing',
    budget: numBudget !== null && numBudget > 0 ? numBudget : null,
    targetDeliveryDate:
      rfq.targetDeliveryDate ||
      (rfq as any).target_delivery_date ||
      (rfq as any).deadline ||
      (rfq as any).deliveryDate ||
      '',
    deliveryLocation: rfq.deliveryLocation || rfq.delivery_location || '',
    deliveryPincode: rfq.deliveryPincode || rfq.delivery_pincode || '',
    lineItems: entitiesList.map(toEditRow),
    attachments: rfq.attachments || [],
  };
}

/**
 * Validate the edit against the same rules creation uses, so an edit cannot
 * introduce a value that could not have been created in the first place.
 */
export function validateRFQEdit(form: RFQEditFormState, apiPincodeError?: string | null): RFQEditFormErrors {
  const errors: RFQEditFormErrors = {};

  if (form.title.trim().length < 3) errors.title = EDIT.titleRequired;
  if (form.category.trim() === '') errors.category = EDIT.categoryRequired;
  if (form.budget !== null && form.budget < 0) errors.budget = EDIT.budgetNegative;
  if (form.targetDeliveryDate && isPastDateString(form.targetDeliveryDate)) {
    errors.targetDeliveryDate = EDIT.targetDateCannotBePast;
  }
  if (form.deliveryLocation.trim().length < 3) errors.deliveryLocation = EDIT.deliveryLocationRequired;

  const pincode = form.deliveryPincode.trim();
  if (pincode === '') {
    errors.deliveryPincode = EDIT.deliveryPincodeRequired;
  } else if (!PINCODE_PATTERN.test(pincode)) {
    errors.deliveryPincode = EDIT.deliveryPincodeInvalid;
  } else if (isDummyPincode(pincode)) {
    errors.deliveryPincode = EDIT.deliveryPincodeDummy;
  } else if (apiPincodeError) {
    errors.deliveryPincode = apiPincodeError;
  }

  // An RFQ with no line items has nothing for a vendor to quote against.
  if (form.lineItems.length === 0) {
    errors.lineItems = EDIT.lineItemsRequired;
  } else {
    // Reported against the row number rather than as one generic message, because
    // a long BOQ gives no clue which row is at fault otherwise.
    const rowFault = form.lineItems.reduce<string | null>((found, row, index) => {
      if (found) return found;
      const message =
        row.itemName.trim() === ''
          ? EDIT.itemNameRequired
          : row.quantity === null || row.quantity <= 0
          ? EDIT.quantityRequired
          : row.unit.trim() === ''
          ? EDIT.unitRequired
          : row.majorCategory.trim() === ''
          ? EDIT.majorCategoryRequired
          : row.targetDate && isPastDateString(row.targetDate)
          ? EDIT.targetDateCannotBePast
          : null;
      return message ? formatString(EDIT.lineItemErrorSummary, { row: index + 1, message }) : null;
    }, null);
    if (rowFault) errors.lineItems = rowFault;
  }

  return errors;
}

/** Whether two line-item collections describe the same requirement. */
function sameLineItems(stored: ExtractedEntity[], edited: RFQEditLineItem[]): boolean {
  if (stored.length !== edited.length) return false;
  return stored.every((entity, index) => {
    const row = toExtractedEntity(edited[index]);
    return (
      entity.itemName === row.itemName &&
      (entity.technicalSpecs || '') === row.technicalSpecs &&
      Number(entity.quantity) === row.quantity &&
      (entity.unit || '') === row.unit &&
      (entity.targetDate || '') === row.targetDate &&
      (entity.majorCategory || '') === row.majorCategory &&
      (entity.minorCategory || '') === row.minorCategory
    );
  });
}

/**
 * The fields that actually differ from the stored record.
 *
 * Returns an empty object when nothing changed, which the caller uses to skip the
 * request entirely rather than issuing a write that would only move `updated_at`.
 */
export function changedFields(rfq: RFQItem, form: RFQEditFormState): RFQUpdatePayload {
  const changes: RFQUpdatePayload = {};
  const original = toFormState(rfq);

  if (form.title.trim() !== original.title) changes.title = form.title.trim();
  if (form.category !== original.category) changes.category = form.category;
  if (form.status !== original.status) changes.status = form.status;
  if ((form.budget ?? 0) !== (original.budget ?? 0)) changes.budget = form.budget ?? 0;
  if (form.targetDeliveryDate !== original.targetDeliveryDate) {
    changes.targetDeliveryDate = form.targetDeliveryDate;
  }
  if (form.deliveryLocation.trim() !== original.deliveryLocation) {
    changes.deliveryLocation = form.deliveryLocation.trim();
  }
  if (form.deliveryPincode.trim() !== original.deliveryPincode) {
    changes.deliveryPincode = form.deliveryPincode.trim();
  }
  if (!sameLineItems(rfq.extractedEntities || [], form.lineItems)) {
    changes.extractedEntities = form.lineItems.map(toExtractedEntity);
  }
  // Compared by id: the metadata is server-owned, so an unchanged list is
  // identical id-for-id and in the same order.
  const storedAttachmentIds = (rfq.attachments || []).map((file) => file.id).join('|');
  if (form.attachments.map((file) => file.id).join('|') !== storedAttachmentIds) {
    changes.attachments = form.attachments;
  }

  return changes;
}

/** A field-level validation message, shown only once the buyer has submitted. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[10px] text-rose-700 dark:text-rose-400 mt-1">{message}</p>;
}

/** One read-only provenance fact. */
function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[9px] uppercase font-bold tracking-wide text-slate-400 dark:text-gray-500">
        {label}
      </span>
      <span className="block text-[11px] font-semibold text-slate-700 dark:text-gray-300 truncate">
        {value || DETAILS.unsetValue}
      </span>
    </div>
  );
}

export interface RFQEditModalProps {
  /** The RFQ being edited, or null when the dialog is closed. */
  rfq: RFQItem | null;
  onClose: () => void;
  /** Persist the change. Rejects with a reason, which the dialog surfaces. */
  onSave: (identifier: string, changes: RFQUpdatePayload) => Promise<RFQItem>;
}

export function RFQEditModal({ rfq, onClose, onSave }: RFQEditModalProps) {
  const [form, setForm] = useState<RFQEditFormState | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const [pincodeError, setPincodeError] = useState<string | null>(null);
  const [pincodeValidating, setPincodeValidating] = useState(false);
  const [pincodePostOffices, setPincodePostOffices] = useState<PostOfficeDetail[]>([]);
  const [isCategorizing, setIsCategorizing] = useState(false);
  const pincodeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!form?.deliveryPincode) {
      setPincodeError(null);
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }
    const raw = form.deliveryPincode.trim();
    if (pincodeDebounceRef.current) clearTimeout(pincodeDebounceRef.current);
    if (!raw) {
      setPincodeError(null);
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }
    if (isDummyPincode(raw)) {
      setPincodeError(EDIT.deliveryPincodeDummy);
      setPincodeValidating(false);
      setPincodePostOffices([]);
      return;
    }
    if (raw.length >= 3 && !PINCODE_PATTERN.test(raw)) {
      setPincodeError(EDIT.deliveryPincodeInvalid);
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
            setPincodeError(res.message || EDIT.deliveryPincodeInvalid);
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
  }, [form?.deliveryPincode]);

  // Reseeded whenever an RFQ is opened or changed, derived from the prop rather than
  // an effect so the form and the record cannot be a render out of step.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const rfqIdentifier = rfq ? (rfq.rfqNumber || rfq.id || 'current-rfq') : null;

  if (rfq && seededFor !== rfqIdentifier) {
    setSeededFor(rfqIdentifier);
    setForm(toFormState(rfq));
    setSubmitAttempted(false);
    setSaveError(null);
    setAttachError(null);
  } else if (!rfq && seededFor !== null) {
    setSeededFor(null);
    setForm(null);
  }

  if (!rfq || !form) return null;

  const errors = submitAttempted ? validateRFQEdit(form, pincodeError) : {};
  const pending = changedFields(rfq, form);
  const hasChanges = Object.keys(pending).length > 0;

  const patch = <K extends keyof RFQEditFormState>(key: K, value: RFQEditFormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const patchRow = (id: string, changes: Partial<RFQEditLineItem>) => {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lineItems: prev.lineItems.map((row) => {
          if (row.id !== id) return row;
          const nextRow = { ...row, ...changes };
          if (changes.majorCategory !== undefined && changes.majorCategory !== row.majorCategory) {
            if (changes.minorCategory !== undefined) {
              nextRow.minorCategory = changes.minorCategory;
            } else if (changes.majorCategory) {
              nextRow.minorCategory = getDefaultMinorForMajor(changes.majorCategory);
            } else {
              nextRow.minorCategory = '';
            }
          } else if (changes.itemName !== undefined || changes.technicalSpecs !== undefined) {
            const auto = autoCategorizeItem(nextRow.itemName, nextRow.technicalSpecs || prev.title);
            if (auto.majorCategory && (!row.majorCategory || changes.itemName !== undefined)) {
              nextRow.majorCategory = auto.majorCategory;
              nextRow.minorCategory = auto.minorCategory || getDefaultMinorForMajor(auto.majorCategory);
            } else if (nextRow.majorCategory && !nextRow.minorCategory) {
              nextRow.minorCategory = getDefaultMinorForMajor(nextRow.majorCategory);
            }
          }
          return nextRow;
        }),
      };
    });
  };

  const handleAutoCategorizeAll = () => {
    if (!form) return;
    setIsCategorizing(true);
    try {
      let detectedMajor = '';
      const updatedLineItems = form.lineItems.map((item) => {
        const auto = autoCategorizeItem(item.itemName, item.technicalSpecs || form.title);
        const nextMajor = auto.majorCategory || item.majorCategory || form.category || 'Engineering Spares - Mechanical';
        const nextMinor = auto.minorCategory || (nextMajor ? getDefaultMinorForMajor(nextMajor) : '') || 'Pumps & Accessories';
        if (nextMajor && !detectedMajor) detectedMajor = nextMajor;
        return {
          ...item,
          majorCategory: nextMajor,
          minorCategory: nextMinor,
        };
      });

      setForm((prev) => (prev ? {
        ...prev,
        category: detectedMajor || prev.category || 'Engineering Spares - Mechanical',
        lineItems: updatedLineItems,
      } : prev));
    } finally {
      setIsCategorizing(false);
    }
  };

  const addRow = () => patch('lineItems', [...form.lineItems, emptyEditRow()]);
  const removeRow = (id: string) =>
    patch('lineItems', form.lineItems.filter((row) => row.id !== id));

  /**
   * Upload each chosen file and keep only its metadata on the form.
   *
   * Uploaded one at a time so a single rejected file is reported against that file
   * rather than failing the whole selection.
   */
  const handleAttach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsAttaching(true);
    setAttachError(null);
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
      setForm((prev) => (prev ? { ...prev, attachments: [...prev.attachments, ...stored] } : prev));
    }
    if (failures.length > 0) setAttachError(failures.join(' | '));

    setIsAttaching(false);
    // Cleared so choosing the same file again still fires a change event.
    if (attachInputRef.current) attachInputRef.current.value = '';
  };

  const handleClose = () => {
    if (isSaving) return;
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitAttempted(true);
    setSaveError(null);

    if (Object.keys(validateRFQEdit(form, pincodeError)).length > 0 || pincodeError) return;
    if (!hasChanges) {
      setSaveError(EDIT.noChanges);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(rfq.rfqNumber, pending);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : EDIT.saveFailed);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rfq-edit-title"
      data-testid="rfq-edit-modal"
    >
      <div className="w-full max-w-5xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-800 my-auto">
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-gray-800">
          <div>
            <h2 id="rfq-edit-title" className="text-base font-bold text-slate-900 dark:text-white">
              {EDIT.dialogTitle}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 max-w-2xl">
              {formatString(EDIT.dialogSubtitle, { rfqNumber: rfq.rfqNumber })}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isSaving}
            aria-label={EDIT.closeAria}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-5 text-xs">
          {/* ── Provenance, read-only ──────────────────────────────────────── */}
          <section className="p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-950/40">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">{EDIT.sectionProvenance}</h3>
              <span className="text-[10px] text-slate-400 dark:text-gray-500">{EDIT.readOnlyNote}</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <ReadOnlyRow label={EDIT.rfqNumberLabel} value={rfq.rfqNumber} />
              <ReadOnlyRow label={EDIT.raisedOnLabel} value={formatIndianDateTime(rfq.createdAt)} />
              <ReadOnlyRow label={EDIT.raisedByLabel} value={rfq.raisedByEmail || ''} />
              <ReadOnlyRow
                label={EDIT.intakeSourceLabel}
                value={
                  rfq.source
                    ? SOURCE_LABELS[rfq.source] || rfq.source
                    : rfq.aiSummary
                      ? (DETAILS.sourceAiExtraction || 'AI Extraction')
                      : ''
                }
              />
            </div>
          </section>

          {/* ── Title ──────────────────────────────────────────────────────── */}
          <div>
            <label htmlFor="rfq-edit-title-field" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
              {EDIT.titleLabel}
            </label>
            <input
              id="rfq-edit-title-field"
              type="text"
              value={form.title}
              onChange={(e) => patch('title', e.target.value)}
              aria-invalid={!!errors.title}
              maxLength={200}
              className="font-medium"
            />
            <FieldError message={errors.title} />
          </div>

          {/* ── Commercial & delivery ──────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white">{EDIT.sectionCommercial}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label htmlFor="rfq-edit-category" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                  {EDIT.categoryLabel}
                </label>
                <select
                  id="rfq-edit-category"
                  value={form.category}
                  onChange={(e) => patch('category', e.target.value)}
                  aria-invalid={!!errors.category}
                  className="font-semibold"
                >
                  {/* A blank choice only while the record genuinely has no category,
                      so an RFQ that has one cannot be saved back without it. */}
                  {form.category === '' && <option value="" />}
                  {withStoredValue(taxonomyMajors(), form.category).map((major) => (
                    <option key={major} value={major}>
                      {major}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.category} />
              </div>

              <div>
                <label htmlFor="rfq-edit-status" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                  {EDIT.statusLabel}
                </label>
                <select
                  id="rfq-edit-status"
                  value={form.status}
                  onChange={(e) => patch('status', e.target.value as RFQItem['status'])}
                  className="font-semibold"
                >
                  {RFQ_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="rfq-edit-budget" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                  {formatString(EDIT.budgetLabel, { symbol: CURRENCY.SYMBOL })}{' '}
                  <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                    ({EDIT.optionalTag})
                  </span>
                </label>
                <input
                  id="rfq-edit-budget"
                  type="number"
                  min={0}
                  value={form.budget ?? ''}
                  onChange={(e) => patch('budget', e.target.value === '' ? null : Number(e.target.value))}
                  aria-invalid={!!errors.budget}
                  className="mono font-semibold"
                />
                <FieldError message={errors.budget} />
              </div>

              <div>
                <label htmlFor="rfq-edit-date" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                  {EDIT.targetDateLabel}
                </label>
                <input
                  id="rfq-edit-date"
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={form.targetDeliveryDate}
                  onChange={(e) => patch('targetDeliveryDate', e.target.value)}
                  className="font-medium"
                />
                <FieldError message={errors.targetDeliveryDate} />
              </div>

              {/* Delivery Pincode */}
              <div>
                <label htmlFor="rfq-edit-pincode" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                  {EDIT.deliveryPincodeLabel}
                </label>
                <div className="relative">
                  <input
                    id="rfq-edit-pincode"
                    type="text"
                    value={form.deliveryPincode}
                    onChange={(e) => patch('deliveryPincode', e.target.value)}
                    aria-invalid={!!errors.deliveryPincode || !!pincodeError}
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
                <FieldError message={errors.deliveryPincode} />
              </div>

              {/* Delivery Location */}
              <div>
                <label htmlFor="rfq-edit-location" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                  {EDIT.deliveryLocationLabel}
                </label>
                <input
                  id="rfq-edit-location"
                  type="text"
                  value={form.deliveryLocation}
                  onChange={(e) => patch('deliveryLocation', e.target.value)}
                  aria-invalid={!!errors.deliveryLocation}
                  maxLength={200}
                  className="font-medium"
                />
                <FieldError message={errors.deliveryLocation} />
              </div>
            </div>
          </section>

          {/* ── Line items ─────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                {EDIT.sectionLineItems}
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[10px] mono font-bold">
                  {form.lineItems.length}
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAutoCategorizeAll}
                  disabled={isCategorizing || form.lineItems.length === 0}
                  className="btn btn-secondary btn-xs text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 flex items-center gap-1 font-semibold disabled:opacity-50"
                  title="Auto-identify and assign major/minor categories for all items"
                >
                  {isCategorizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {isCategorizing ? 'Classifying...' : 'Auto-Categorize All (AI)'}
                </button>
                <button
                  onClick={addRow}
                  className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plus size={12} /> {EDIT.addItemAction}
                </button>
              </div>
            </div>

            <FieldError message={errors.lineItems} />

            {form.lineItems.length === 0 ? (
              <p className="p-5 text-center rounded-xl border border-dashed border-slate-300 dark:border-gray-700 text-slate-500 dark:text-gray-400">
                {EDIT.noItemsMessage}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800">
                {/* Widened to match the columns inside it: the quantity and unit
                    fields grew, and leaving the table at its old width squeezed
                    them back to where a long value was clipped again. */}
                <table className="w-full text-left min-w-[1060px]">
                  <thead className="bg-slate-50 dark:bg-gray-950/60 text-[10px] uppercase tracking-wide text-slate-500 dark:text-gray-400">
                    <tr>
                      <th scope="col" className="px-2 py-2 font-bold">{EDIT.colItem}</th>
                      <th scope="col" className="px-2 py-2 font-bold">{EDIT.colSpecs}</th>
                      <th scope="col" className="px-2 py-2 font-bold">{EDIT.colMajor}</th>
                      <th scope="col" className="px-2 py-2 font-bold">{EDIT.colMinor}</th>
                      <th scope="col" className="px-2 py-2 font-bold">{EDIT.colQty}</th>
                      <th scope="col" className="px-2 py-2 font-bold">{EDIT.colUnit}</th>
                      <th scope="col" className="px-2 py-2 font-bold">{EDIT.colTargetDate}</th>
                      <th scope="col" className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                    {form.lineItems.map((row) => (
                      <tr key={row.id} data-testid={`rfq-edit-row-${row.id}`}>
                        <td className="px-2 py-2 align-top">
                          <input
                            type="text"
                            aria-label={EDIT.colItem}
                            value={row.itemName}
                            onChange={(e) => patchRow(row.id, { itemName: e.target.value })}
                            className="font-medium min-w-[11rem]"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            type="text"
                            aria-label={EDIT.colSpecs}
                            value={row.technicalSpecs}
                            onChange={(e) => patchRow(row.id, { technicalSpecs: e.target.value })}
                            className="min-w-[10rem]"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <select
                            aria-label={EDIT.colMajor}
                            value={row.majorCategory}
                            onChange={(e) =>
                              // Changing the major clears the minor: one from the
                              // previous major is not valid under the new one, and
                              // leaving it would dispatch a mismatched pair.
                              patchRow(row.id, { majorCategory: e.target.value, minorCategory: '' })
                            }
                            className="min-w-[10rem] font-semibold"
                          >
                            <option value="" />
                            {withStoredValue(taxonomyMajors(), row.majorCategory).map((major) => (
                              <option key={major} value={major}>
                                {major}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <select
                            aria-label={EDIT.colMinor}
                            value={row.minorCategory}
                            onChange={(e) => patchRow(row.id, { minorCategory: e.target.value })}
                            disabled={row.majorCategory === ''}
                            className="min-w-[10rem] font-semibold disabled:opacity-50"
                          >
                            <option value="">
                              {row.majorCategory === '' ? EDIT.selectMajorFirst : ''}
                            </option>
                            {withStoredValue(minorsFor(row.majorCategory), row.minorCategory).map(
                              (minor) => (
                                <option key={minor} value={minor}>
                                  {minor}
                                </option>
                              )
                            )}
                          </select>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            type="number"
                            min={0}
                            aria-label={EDIT.colQty}
                            value={row.quantity ?? ''}
                            onChange={(e) =>
                              patchRow(row.id, {
                                quantity: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            // Wide enough for a real BOQ quantity plus the number
                            // spinners. At w-28 a six-figure quantity was clipped,
                            // which read as though the field had not been filled in.
                            className="mono font-semibold w-32 min-w-[7rem]"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            type="text"
                            aria-label={EDIT.colUnit}
                            value={row.unit}
                            onChange={(e) => patchRow(row.id, { unit: e.target.value })}
                            className="w-32 min-w-[6rem]"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            type="date"
                            aria-label={EDIT.colTargetDate}
                            min={new Date().toISOString().slice(0, 10)}
                            value={row.targetDate}
                            onChange={(e) => patchRow(row.id, { targetDate: e.target.value })}
                            className="w-36"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <button
                            onClick={() => removeRow(row.id)}
                            aria-label={formatString(EDIT.removeItemAria, {
                              item: row.itemName.trim() || EDIT.untitledItem,
                            })}
                            className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Supporting documents ───────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">{EDIT.sectionDocuments}</h3>
                <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">{EDIT.attachHint}</p>
              </div>
              <button
                onClick={() => attachInputRef.current?.click()}
                disabled={isAttaching}
                className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Paperclip size={12} />
                {isAttaching ? EDIT.attachingAction : EDIT.attachAction}
              </button>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.eml,.msg"
                data-testid="rfq-edit-attachment-input"
                className="hidden"
                onChange={(e) => handleAttach(e.target.files)}
              />
            </div>

            {attachError && (
              <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-400">
                {attachError}
              </p>
            )}

            {form.attachments.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-gray-400">{EDIT.noAttachmentsMessage}</p>
            ) : (
              <ul className="space-y-1.5">
                {form.attachments.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50/60 dark:bg-gray-950/40 border border-slate-200 dark:border-gray-800"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Paperclip size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-[11px] font-semibold text-slate-800 dark:text-gray-200 truncate">
                          {file.fileName}
                        </span>
                        <span className="block text-[10px] text-slate-400 dark:text-gray-500 mono">
                          {formatFileSize(file.size)}
                        </span>
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        patch('attachments', form.attachments.filter((a) => a.id !== file.id))
                      }
                      aria-label={formatString(EDIT.removeAttachmentAria, { fileName: file.fileName })}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {saveError && (
            <p
              role="alert"
              className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{saveError}</span>
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 dark:border-gray-800">
          <button onClick={handleClose} disabled={isSaving} className="btn btn-secondary btn-sm font-bold">
            {EDIT.cancelAction}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isSaving ? EDIT.savingAction : EDIT.saveAction}
          </button>
        </footer>
      </div>
    </div>
  );
}

export interface RFQDeleteDialogProps {
  /** The RFQ to delete, or null when the dialog is closed. */
  rfq: RFQItem | null;
  onClose: () => void;
  /** Perform the delete. Rejects with a reason, which the dialog surfaces. */
  onConfirm: (identifier: string) => Promise<void>;
}

/**
 * Confirm a delete before it happens.
 *
 * The RFQ number, its title and its line-item count are all named, because the
 * number alone is what distinguishes one row from the next and a buyer clicking
 * the wrong row would otherwise have no way to notice.
 */
export function RFQDeleteDialog({ rfq, onClose, onConfirm }: RFQDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!rfq) return null;

  const handleClose = () => {
    if (isDeleting) return;
    setDeleteError(null);
    onClose();
  };

  const handleConfirm = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await onConfirm(rfq.rfqNumber);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : EDIT.deleteFailed);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rfq-delete-title"
      data-testid="rfq-delete-dialog"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-800 p-5 space-y-4 text-xs">
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 shrink-0">
            <Trash2 size={18} />
          </span>
          <div>
            <h2 id="rfq-delete-title" className="text-base font-bold text-slate-900 dark:text-white">
              {EDIT.deleteTitle}
            </h2>
            <p className="text-[11px] text-slate-600 dark:text-gray-300 mt-1 leading-relaxed">
              {formatString(EDIT.deleteConfirmMessage, {
                rfqNumber: rfq.rfqNumber,
                title: rfq.title,
                itemCount: (rfq.extractedEntities || []).length,
              })}
            </p>
          </div>
        </div>

        {deleteError && (
          <p
            role="alert"
            className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300"
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{deleteError}</span>
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={handleClose} disabled={isDeleting} className="btn btn-secondary btn-sm font-bold">
            {EDIT.cancelAction}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isDeleting}
            className="btn btn-sm font-bold inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60"
          >
            {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {isDeleting ? EDIT.deletingAction : EDIT.deleteConfirmAction}
          </button>
        </div>
      </div>
    </div>
  );
}
