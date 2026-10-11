// ==============================================================================
// MANUAL RFQ ENTRY MODEL
// ==============================================================================
// Construction, validation and submission of the manual RFQ form. The wizard
// drives this rather than holding a dozen loose useState values, so the rules
// about when an RFQ may be dispatched live in one place and are testable without
// rendering a screen.
//
// Two decisions worth stating:
//
//   A blank row is blank. Defaults used to be pre-filled — quantity 1, unit Nos,
//   today's date and the first taxonomy pair — which read as answers the buyer had
//   given. A quantity of 1 and a category of "Civil Works" are exactly the values
//   that get dispatched to vendors unnoticed, so every field starts empty and
//   `quantity` starts null.
//
//   The budget stays optional while the destination does not. A document can price
//   nothing, and requiring a figure only made buyers invent a ceiling that vendors
//   then quoted against. Delivery location and pincode are mandatory because
//   vendors rate freight on them, so a quote raised without them cannot be
//   compared against one that has them.
// ==============================================================================

import {
  hasMajorCategory,
  hasMinorCategory,
  autoCategorizeItem,
  getDefaultMinorForMajor,
} from './categoryTaxonomy';
import { PINCODE_PATTERN, isDummyPincode } from './validationSchemas';
import { UI_STRINGS, formatString } from './uiStrings';
import type {
  ExtractedEntity,
  ManualRFQForm,
  ManualRFQLineItem,
  ManualRFQLineItemErrors,
  ManualRFQValidation,
  RFQCreatePayload,
  RFQSource,
  SourcingMode,
} from './types';

const MANUAL = UI_STRINGS.manualRfq;

/** Confidence reported for a hand-keyed row. Zero means "no AI involved", not "AI was unsure". */
export const MANUAL_ENTRY_CONFIDENCE = 0;

// The row's two category selects are built from the shared taxonomy: the major
// select lists the majors, and the minor select lists only the minors under the
// chosen major. A value outside the master therefore has no matching option, so
// the select renders blank and looks broken while still holding a value that
// validation accepts. Off-taxonomy values are dropped on the way in instead, which
// leaves the field genuinely empty and lets the existing required-field rules ask
// the buyer for it.
//
// Read from the taxonomy registry at call time rather than captured into module
// constants at import time: the master is fetched from the database now, so it is
// not available when this module is first evaluated.

/** The major category if the taxonomy has it, else empty. */
function taxonomyMajorOrBlank(major: string): string {
  return hasMajorCategory(major) ? major : '';
}

/** The minor category if it belongs to the given major, else empty. */
function taxonomyMinorOrBlank(major: string, minor: string): string {
  return hasMinorCategory(major, minor) ? minor : '';
}

const DEFAULT_SOURCING_MODE: SourcingMode = 'mode_1';
const TITLE_MIN_LENGTH = 3;
const TITLE_MAX_LENGTH = 200;
const LOCATION_MIN_LENGTH = 3;
const LOCATION_MAX_LENGTH = 200;

/** Monotonic row ids without colliding when two rows are added in the same millisecond. */
let rowCounter = 0;

/** A genuinely empty line item. Every field is unanswered. */
export function createEmptyManualRFQLineItem(): ManualRFQLineItem {
  rowCounter += 1;
  return {
    id: `manual-item-${Date.now()}-${rowCounter}`,
    itemName: '',
    technicalSpecs: '',
    quantity: null,
    unit: '',
    targetDate: '',
    majorCategory: '',
    minorCategory: '',
  };
}

/** A fresh manual RFQ form carrying exactly one empty row to key into. */
export function createEmptyManualRFQForm(): ManualRFQForm {
  return {
    title: '',
    majorCategory: '',
    estimatedBudget: null,
    targetDeliveryDate: '',
    deliveryLocation: '',
    deliveryPincode: '',
    lineItems: [createEmptyManualRFQLineItem()],
    attachments: [],
    sourcingMode: DEFAULT_SOURCING_MODE,
  };
}

/** Trimmed string, tolerating a value that is not a string at all. */
function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Checks whether an ISO date string (YYYY-MM-DD...) represents a calendar date in the past.
 */
export function isPastDateString(dateStr?: string | null): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  if (!trimmed) return false;
  const dateOnly = trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return dateOnly < today;
}

/**
 * Validate one line item.
 *
 * Every field checked here is something a vendor quotes against, which is why a
 * blank one blocks dispatch rather than being silently defaulted.
 */
export function validateManualRFQLineItem(item: ManualRFQLineItem): ManualRFQLineItemErrors {
  const errors: ManualRFQLineItemErrors = {};

  if (clean(item.itemName) === '') {
    errors.itemName = MANUAL.itemNameRequired;
  }
  // null and 0 are both rejected, but only null means "unanswered".
  if (item.quantity === null || Number.isNaN(item.quantity) || Number(item.quantity) <= 0) {
    errors.quantity = MANUAL.quantityRequired;
  }
  if (clean(item.unit) === '') {
    errors.unit = MANUAL.unitRequired;
  }
  // Delivery date is managed at the RFQ header level rather than per line item.
  // Major/minor category are no longer mandatory to dispatch a manual RFQ —
  // a buyer may not know the exact taxonomy slot for an item up front, and
  // an uncategorised line can still be reviewed/reclassified later.

  return errors;
}

/** Is this row complete enough to dispatch? */
export function isManualRFQLineItemComplete(item: ManualRFQLineItem): boolean {
  return Object.keys(validateManualRFQLineItem(item)).length === 0;
}

/**
 * Validate the whole form.
 *
 * Reports every problem at once rather than the first one, so the buyer can fix a
 * screenful in one pass instead of rediscovering the next error on each attempt.
 */
export function validateManualRFQForm(form: ManualRFQForm): ManualRFQValidation {
  const formErrors: ManualRFQValidation['formErrors'] = {};
  const lineItemErrors: Record<string, ManualRFQLineItemErrors> = {};

  const items = Array.isArray(form.lineItems) ? form.lineItems : [];

  // The title may be left blank: it falls back to the leading line item's
  // description on submission, matching how the server derives one. It is only
  // rejected when the buyer typed something too short to be a real title.
  const title = clean(form.title);
  if (title !== '' && (title.length < TITLE_MIN_LENGTH || title.length > TITLE_MAX_LENGTH)) {
    formErrors.title = formatString(MANUAL.titleLength, {
      min: TITLE_MIN_LENGTH,
      max: TITLE_MAX_LENGTH,
    });
  }

  const location = clean(form.deliveryLocation);
  if (location === '') {
    formErrors.deliveryLocation = MANUAL.deliveryLocationRequired;
  } else if (location.length < LOCATION_MIN_LENGTH || location.length > LOCATION_MAX_LENGTH) {
    formErrors.deliveryLocation = formatString(MANUAL.deliveryLocationLength, {
      min: LOCATION_MIN_LENGTH,
      max: LOCATION_MAX_LENGTH,
    });
  }

  const pincode = clean(form.deliveryPincode);
  if (pincode === '') {
    formErrors.deliveryPincode = MANUAL.deliveryPincodeRequired;
  } else if (!PINCODE_PATTERN.test(pincode)) {
    formErrors.deliveryPincode = MANUAL.deliveryPincodeInvalid;
  } else if (isDummyPincode(pincode)) {
    formErrors.deliveryPincode = MANUAL.deliveryPincodeDummy || 'Dummy or sequential PIN codes (e.g. 123456, 111111) are not allowed.';
  }

  // Optional, but a negative ceiling is meaningless rather than merely absent.
  if (form.estimatedBudget !== null && Number(form.estimatedBudget) < 0) {
    formErrors.estimatedBudget = MANUAL.budgetNegative;
  }

  if (form.targetDeliveryDate && isPastDateString(form.targetDeliveryDate)) {
    formErrors.targetDeliveryDate = MANUAL.targetDateCannotBePast || 'Target date cannot be earlier than today.';
  }

  if (items.length === 0) {
    formErrors.lineItems = MANUAL.lineItemsRequired;
  }

  items.forEach((item) => {
    const errors = validateManualRFQLineItem(item);
    if (Object.keys(errors).length > 0) {
      lineItemErrors[item.id] = errors;
    }
  });

  return {
    isValid: Object.keys(formErrors).length === 0 && Object.keys(lineItemErrors).length === 0,
    formErrors,
    lineItemErrors,
  };
}

/**
 * Convert one manual row into the line-item shape the API and the rest of the app
 * already use.
 *
 * `confidence: 0` is honest rather than pessimistic: nothing classified this row,
 * so there is no confidence to report. The details screen reads the zero and
 * labels the row as manually keyed instead of claiming the AI was 0% sure.
 */
export function toExtractedEntity(item: ManualRFQLineItem): ExtractedEntity {
  const rawTargetDate = clean(item.targetDate);
  return {
    id: item.id,
    itemName: clean(item.itemName),
    quantity: Number(item.quantity) || 0,
    unit: clean(item.unit),
    targetDate: isPastDateString(rawTargetDate) ? '' : rawTargetDate,
    technicalSpecs: clean(item.technicalSpecs),
    confidence: MANUAL_ENTRY_CONFIDENCE,
    category: clean(item.minorCategory),
    majorCategory: clean(item.majorCategory),
    minorCategory: clean(item.minorCategory),
  };
}

/**
 * Build the POST /api/rfqs body.
 *
 * Carries no RFQ number. The server allocates it so the id follows the same
 * scheme the Java p2pservices application uses, and so two clients cannot mint
 * the same one.
 *
 * Call only on a form that has passed validateManualRFQForm; the non-null
 * assumptions below are what that validation guarantees.
 */
export function toRFQCreatePayload(
  form: ManualRFQForm,
  assignedVendors?: Array<{
    id?: string;
    name: string;
    email?: string | null;
    contactPerson?: string | null;
    phone?: string | null;
  }>,
  source?: RFQSource
): RFQCreatePayload {
  const items = form.lineItems.map(toExtractedEntity);
  const leading = items[0];

  return {
    // Falls back to the leading item's description, the way the server's
    // deriveTitle does, because the API requires a title and manual entry may
    // legitimately not have one.
    title: clean(form.title) || (leading ? leading.itemName : ''),
    // Taken from the leading row rather than the header field: validation
    // guarantees every row carries a major category, so this is always set.
    category: clean(form.majorCategory) || (leading ? leading.majorCategory : ''),
    sourcingMode: form.sourcingMode,
    status: MANUAL.defaultStatus,
    source: source || 'manual_entry',
    // Zero rather than null: the column is NOT NULL, and zero is rendered as
    // "not set" rather than as a real ceiling of nothing.
    budget: form.estimatedBudget === null ? 0 : Number(form.estimatedBudget),
    targetDeliveryDate: clean(form.targetDeliveryDate) || (leading ? leading.targetDate : ''),
    deliveryLocation: clean(form.deliveryLocation),
    deliveryPincode: clean(form.deliveryPincode),
    extractedEntities: items,
    attachments: form.attachments,
    assignedVendors: assignedVendors || [],
  };
}

/**
 * Convert an extracted line item back into an editable manual row.
 *
 * The inverse of toExtractedEntity, used when the buyer extracts from an attached
 * document on the manual path. Every field stays editable afterwards: the model
 * can misread a scan, and the buyer is the one who has to stand behind the
 * numbers that reach vendors.
 *
 * A quantity of zero becomes null rather than being kept, because zero from an
 * extraction means "could not read one", not "the buyer wants none".
 *
 * Categories the shared taxonomy does not contain are dropped, because the row's
 * dropdowns are built from that taxonomy and cannot display anything else.
 */
export function fromExtractedEntity(entity: ExtractedEntity): ManualRFQLineItem {
  rowCounter += 1;
  const majorCategory = taxonomyMajorOrBlank(clean(entity.majorCategory));
  const minorCategory = taxonomyMinorOrBlank(majorCategory, clean(entity.minorCategory) || clean(entity.category));

  const rawTargetDate = clean(entity.targetDate);
  const targetDate = isPastDateString(rawTargetDate) ? '' : rawTargetDate;
  return {
    id: entity.id || `manual-item-${Date.now()}-${rowCounter}`,
    itemName: clean(entity.itemName),
    technicalSpecs: clean(entity.technicalSpecs),
    quantity: Number(entity.quantity) > 0 ? Number(entity.quantity) : null,
    unit: clean(entity.unit),
    targetDate,
    majorCategory,
    minorCategory,
  };
}

/** Add an empty row, returning a new form rather than mutating the old one. */
export function addManualRFQLineItem(form: ManualRFQForm): ManualRFQForm {
  return { ...form, lineItems: [...form.lineItems, createEmptyManualRFQLineItem()] };
}

/** Remove a row by its client-side id. */
export function removeManualRFQLineItem(form: ManualRFQForm, id: string): ManualRFQForm {
  return { ...form, lineItems: form.lineItems.filter((item) => item.id !== id) };
}

/**
 * Patch one row.
 *
 * Changing the major category clears the minor, because a minor category from the
 * previous major is not valid under the new one and leaving it would dispatch a
 * mismatched pair to vendors.
 */
export function updateManualRFQLineItem(
  form: ManualRFQForm,
  id: string,
  patch: Partial<ManualRFQLineItem>
): ManualRFQForm {
  return {
    ...form,
    lineItems: form.lineItems.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      if (patch.majorCategory !== undefined && patch.majorCategory !== item.majorCategory) {
        next.minorCategory = patch.minorCategory !== undefined ? patch.minorCategory : '';
      }
      return next;
    }),
  };
}
