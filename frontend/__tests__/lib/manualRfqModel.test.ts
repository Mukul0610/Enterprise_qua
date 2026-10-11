// ==============================================================================
// MANUAL RFQ ENTRY MODEL
// ==============================================================================
// These assert the two rules that caused real defects: a blank row must stay
// blank rather than carrying plausible-looking defaults, and the payload must
// never contain an RFQ number, because the server allocates it.
// ==============================================================================

import {
  MANUAL_ENTRY_CONFIDENCE,
  addManualRFQLineItem,
  createEmptyManualRFQForm,
  createEmptyManualRFQLineItem,
  fromExtractedEntity,
  isManualRFQLineItemComplete,
  isPastDateString,
  removeManualRFQLineItem,
  toExtractedEntity,
  toRFQCreatePayload,
  updateManualRFQLineItem,
  validateManualRFQForm,
  validateManualRFQLineItem,
} from '@/lib/manualRfqModel';
import { UI_STRINGS } from '@/lib/uiStrings';
import { CATEGORY_TAXONOMY_FIXTURE as categoriesData } from '../../test-fixtures/categoryTaxonomy';
import type { ExtractedEntity, ManualRFQForm, ManualRFQLineItem } from '@/lib/types';

const MANUAL = UI_STRINGS.manualRfq;

// A hardcoded literal here ('2026-09-30') is a time bomb: validation rejects
// any targetDate earlier than today, so a fixed past-looking date starts
// failing the instant the real calendar date passes it. Computed once per
// test run instead, always valid.
const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function completeItem(overrides: Partial<ManualRFQLineItem> = {}): ManualRFQLineItem {
  return {
    ...createEmptyManualRFQLineItem(),
    itemName: 'Centrifugal Water Pump',
    technicalSpecs: 'SS316 impeller',
    quantity: 12,
    unit: 'Nos',
    targetDate: A_FUTURE_DATE,
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategory: 'Pumps & Accessories',
    ...overrides,
  };
}

function completeForm(overrides: Partial<ManualRFQForm> = {}): ManualRFQForm {
  return {
    ...createEmptyManualRFQForm(),
    title: 'Mechanical Spares Procurement',
    majorCategory: 'Engineering Spares - Mechanical',
    estimatedBudget: 348000,
    targetDeliveryDate: A_FUTURE_DATE,
    deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    deliveryPincode: '400701',
    lineItems: [completeItem()],
    ...overrides,
  };
}

describe('createEmptyManualRFQLineItem', () => {
  // Defaults used to be pre-filled — quantity 1, unit Nos, a target date and the
  // first taxonomy pair — which read as answers the buyer had given.
  it('leaves every field genuinely unanswered', () => {
    const item = createEmptyManualRFQLineItem();

    expect(item.itemName).toBe('');
    expect(item.technicalSpecs).toBe('');
    expect(item.unit).toBe('');
    expect(item.targetDate).toBe('');
    expect(item.majorCategory).toBe('');
    expect(item.minorCategory).toBe('');
  });

  // Null rather than 0: a zero is indistinguishable from a buyer who meant zero,
  // and zero is exactly what got dispatched to vendors unnoticed.
  it('starts the quantity as null rather than zero', () => {
    expect(createEmptyManualRFQLineItem().quantity).toBeNull();
  });

  it('gives each row a distinct id even within the same millisecond', () => {
    const ids = Array.from({ length: 50 }, () => createEmptyManualRFQLineItem().id);
    expect(new Set(ids).size).toBe(50);
  });
});

describe('createEmptyManualRFQForm', () => {
  it('opens with exactly one empty row to key into', () => {
    const form = createEmptyManualRFQForm();
    expect(form.lineItems).toHaveLength(1);
    expect(form.lineItems[0].itemName).toBe('');
  });

  it('leaves the budget unanswered rather than zero', () => {
    expect(createEmptyManualRFQForm().estimatedBudget).toBeNull();
  });

  it('defaults to the first sourcing mode and no attachments', () => {
    const form = createEmptyManualRFQForm();
    expect(form.sourcingMode).toBe('mode_1');
    expect(form.attachments).toEqual([]);
  });
});

describe('validateManualRFQLineItem', () => {
  it('accepts a complete row', () => {
    expect(validateManualRFQLineItem(completeItem())).toEqual({});
    expect(isManualRFQLineItemComplete(completeItem())).toBe(true);
  });

  it('reports every blank field at once', () => {
    const errors = validateManualRFQLineItem(createEmptyManualRFQLineItem());

    expect(errors.itemName).toBe(MANUAL.itemNameRequired);
    expect(errors.quantity).toBe(MANUAL.quantityRequired);
    expect(errors.unit).toBe(MANUAL.unitRequired);
    // Major/minor category are optional — a blank line item is not reported
    // as an error for either.
    expect(errors.majorCategory).toBeUndefined();
    expect(errors.minorCategory).toBeUndefined();
  });

  it('accepts a row with no category set', () => {
    const errors = validateManualRFQLineItem(completeItem({ majorCategory: '', minorCategory: '' }));
    expect(errors).toEqual({});
    expect(isManualRFQLineItemComplete(completeItem({ majorCategory: '', minorCategory: '' }))).toBe(true);
  });

  it.each([[null], [0], [-5], [Number.NaN]])('rejects a quantity of %p', (quantity) => {
    expect(validateManualRFQLineItem(completeItem({ quantity })).quantity).toBe(
      MANUAL.quantityRequired
    );
  });

  it('treats whitespace as blank', () => {
    const errors = validateManualRFQLineItem(
      completeItem({ itemName: '   ', unit: '  ' })
    );
    expect(errors.itemName).toBeDefined();
    expect(errors.unit).toBeDefined();
  });

  // A specification is genuinely optional; plenty of commodity items have none.
  it('does not require a technical specification', () => {
    expect(validateManualRFQLineItem(completeItem({ technicalSpecs: '' }))).toEqual({});
  });

  it('does not require or reject a per-row target date', () => {
    expect(validateManualRFQLineItem(completeItem({ targetDate: '' }))).toEqual({});
    expect(validateManualRFQLineItem(completeItem({ targetDate: '2020-01-01' }))).toEqual({});
  });

  it('validates isPastDateString edge cases', () => {
    expect(isPastDateString('')).toBe(false);
    expect(isPastDateString(null)).toBe(false);
    expect(isPastDateString(undefined)).toBe(false);
    expect(isPastDateString('   ')).toBe(false);
    expect(isPastDateString('not-a-date')).toBe(false);
    expect(isPastDateString('2020-01-01')).toBe(true);
    expect(isPastDateString('2099-12-31')).toBe(false);
  });
});

describe('validateManualRFQForm', () => {
  it('accepts a complete form', () => {
    expect(validateManualRFQForm(completeForm())).toEqual({
      isValid: true,
      formErrors: {},
      lineItemErrors: {},
    });
  });

  it('rejects a form with a target delivery date in the past', () => {
    const { isValid, formErrors } = validateManualRFQForm(completeForm({ targetDeliveryDate: '2020-01-01' }));
    expect(isValid).toBe(false);
    expect(formErrors.targetDeliveryDate).toBe('Target date cannot be earlier than today.');
  });

  // The title falls back to the leading line item, matching how the server
  // derives one, so leaving it blank is legitimate.
  it('allows a blank title', () => {
    expect(validateManualRFQForm(completeForm({ title: '' })).isValid).toBe(true);
  });

  it.each([['ab'], ['x'.repeat(201)]])('rejects a title of length %s', (title) => {
    const { formErrors } = validateManualRFQForm(completeForm({ title }));
    expect(formErrors.title).toContain('between 3 and 200');
  });

  it('requires a delivery location', () => {
    const { isValid, formErrors } = validateManualRFQForm(completeForm({ deliveryLocation: '  ' }));
    expect(isValid).toBe(false);
    expect(formErrors.deliveryLocation).toBe(MANUAL.deliveryLocationRequired);
  });

  it.each([['X'], ['y'.repeat(201)]])('rejects a delivery location of %s', (deliveryLocation) => {
    const { formErrors } = validateManualRFQForm(completeForm({ deliveryLocation }));
    expect(formErrors.deliveryLocation).toContain('between 3 and 200');
  });

  // Blank and malformed are reported differently: telling a buyer who typed
  // nothing that the format is wrong sends them hunting for a typo.
  it('distinguishes a blank pincode from a malformed or dummy one', () => {
    expect(validateManualRFQForm(completeForm({ deliveryPincode: '' })).formErrors.deliveryPincode).toBe(
      MANUAL.deliveryPincodeRequired
    );
    expect(validateManualRFQForm(completeForm({ deliveryPincode: '!!' })).formErrors.deliveryPincode).toBe(
      MANUAL.deliveryPincodeInvalid
    );
    expect(validateManualRFQForm(completeForm({ deliveryPincode: '123456' })).formErrors.deliveryPincode).toBe(
      MANUAL.deliveryPincodeDummy
    );
    expect(validateManualRFQForm(completeForm({ deliveryPincode: '111111' })).formErrors.deliveryPincode).toBe(
      MANUAL.deliveryPincodeDummy
    );
  });

  it('accepts an international zipcode', () => {
    expect(validateManualRFQForm(completeForm({ deliveryPincode: 'SW1A 1AA' })).isValid).toBe(true);
  });

  // Optional, unlike the destination: a buyer need not publish a ceiling.
  it('allows an unanswered budget', () => {
    expect(validateManualRFQForm(completeForm({ estimatedBudget: null })).isValid).toBe(true);
  });

  it('allows a zero budget', () => {
    expect(validateManualRFQForm(completeForm({ estimatedBudget: 0 })).isValid).toBe(true);
  });

  it('rejects a negative budget', () => {
    const { formErrors } = validateManualRFQForm(completeForm({ estimatedBudget: -1 }));
    expect(formErrors.estimatedBudget).toBe(MANUAL.budgetNegative);
  });

  it('requires at least one line item', () => {
    const { isValid, formErrors } = validateManualRFQForm(completeForm({ lineItems: [] }));
    expect(isValid).toBe(false);
    expect(formErrors.lineItems).toBe(MANUAL.lineItemsRequired);
  });

  it('tolerates a lineItems value that is not an array', () => {
    const form = completeForm();
    // Simulates malformed restored state rather than a type-safe caller.
    const { isValid } = validateManualRFQForm({
      ...form,
      lineItems: undefined as unknown as ManualRFQLineItem[],
    });
    expect(isValid).toBe(false);
  });

  // Keyed by row id so the wizard can put each message against its own row.
  it('reports line-item errors keyed by row id', () => {
    const bad = completeItem({ id: 'row-bad', unit: '' });
    const good = completeItem({ id: 'row-good' });

    const { isValid, lineItemErrors } = validateManualRFQForm(
      completeForm({ lineItems: [good, bad] })
    );

    expect(isValid).toBe(false);
    expect(Object.keys(lineItemErrors)).toEqual(['row-bad']);
    expect(lineItemErrors['row-bad'].unit).toBe(MANUAL.unitRequired);
  });

  // Reported together so a screenful can be fixed in one pass.
  it('reports header and line-item problems in the same result', () => {
    const { formErrors, lineItemErrors } = validateManualRFQForm(
      completeForm({ deliveryPincode: '', lineItems: [completeItem({ id: 'r1', itemName: '' })] })
    );

    expect(formErrors.deliveryPincode).toBeDefined();
    expect(lineItemErrors.r1.itemName).toBeDefined();
  });
});

describe('toExtractedEntity', () => {
  it('maps a keyed row onto the shared line-item shape', () => {
    const entity = toExtractedEntity(completeItem());

    expect(entity.itemName).toBe('Centrifugal Water Pump');
    expect(entity.quantity).toBe(12);
    expect(entity.unit).toBe('Nos');
    expect(entity.majorCategory).toBe('Engineering Spares - Mechanical');
    expect(entity.minorCategory).toBe('Pumps & Accessories');
    // `category` mirrors the minor category, as extraction produces.
    expect(entity.category).toBe('Pumps & Accessories');
  });

  // Nothing classified this row, so there is no confidence to report. The details
  // screen reads the zero and labels the row manual rather than claiming 0%.
  it('reports no confidence rather than a low one', () => {
    expect(toExtractedEntity(completeItem()).confidence).toBe(MANUAL_ENTRY_CONFIDENCE);
    expect(MANUAL_ENTRY_CONFIDENCE).toBe(0);
  });

  it('trims every text field', () => {
    const entity = toExtractedEntity(completeItem({ itemName: '  Pump  ', unit: ' Nos ' }));
    expect(entity.itemName).toBe('Pump');
    expect(entity.unit).toBe('Nos');
  });

  it('coerces an unanswered quantity to zero', () => {
    expect(toExtractedEntity(completeItem({ quantity: null })).quantity).toBe(0);
  });
});

describe('toRFQCreatePayload', () => {
  it('builds the API body from a complete form', () => {
    const payload = toRFQCreatePayload(completeForm());

    expect(payload.title).toBe('Mechanical Spares Procurement');
    expect(payload.category).toBe('Engineering Spares - Mechanical');
    expect(payload.source).toBe('manual_entry');
    expect(payload.status).toBe(MANUAL.defaultStatus);
    expect(payload.budget).toBe(348000);
    expect(payload.deliveryPincode).toBe('400701');
    expect(payload.extractedEntities).toHaveLength(1);
  });

  // The server allocates the number, following the Java scheme. The wizard used to
  // mint one with Math.random(), which could collide.
  it('never sends an RFQ number', () => {
    const payload = toRFQCreatePayload(completeForm());
    expect(payload).not.toHaveProperty('rfqNumber');
    expect(payload).not.toHaveProperty('rfqId');
    expect(payload).not.toHaveProperty('id');
  });

  it('falls back to the leading line item for a blank title', () => {
    const payload = toRFQCreatePayload(completeForm({ title: '   ' }));
    expect(payload.title).toBe('Centrifugal Water Pump');
  });

  it('falls back to the leading line item for a blank header category', () => {
    const payload = toRFQCreatePayload(completeForm({ majorCategory: '' }));
    expect(payload.category).toBe('Engineering Spares - Mechanical');
  });

  it('falls back to the leading line item date when no header date was given', () => {
    const payload = toRFQCreatePayload(completeForm({ targetDeliveryDate: '' }));
    expect(payload.targetDeliveryDate).toBe(A_FUTURE_DATE);
  });

  // The column is NOT NULL, and zero renders as "not set" rather than a real
  // ceiling of nothing.
  it('sends zero for an unanswered budget', () => {
    expect(toRFQCreatePayload(completeForm({ estimatedBudget: null })).budget).toBe(0);
  });

  it('handles empty lineItems safely in toRFQCreatePayload', () => {
    const payload = toRFQCreatePayload(completeForm({ title: '', majorCategory: '', targetDeliveryDate: '', lineItems: [] }));
    expect(payload.title).toBe('');
    expect(payload.category).toBe('');
    expect(payload.targetDeliveryDate).toBe('');
  });

  it('tolerates a form with no line items', () => {
    const payload = toRFQCreatePayload(completeForm({ lineItems: [] }));
    expect(payload.title).toBe('Mechanical Spares Procurement');
    expect(payload.extractedEntities).toEqual([]);
  });

  it('carries attachments through unchanged', () => {
    const attachment = {
      id: 'a1',
      fileName: 'annexure.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      uploadedAt: '2026-09-02T11:07:16.000Z',
    };
    expect(toRFQCreatePayload(completeForm({ attachments: [attachment] })).attachments).toEqual([
      attachment,
    ]);
  });

  it('supports passing custom source such as ai_extraction', () => {
    const payload = toRFQCreatePayload(completeForm(), undefined, 'ai_extraction');
    expect(payload.source).toBe('ai_extraction');
  });
});

describe('line item collection helpers', () => {
  it('appends an empty row without mutating the original form', () => {
    const form = completeForm();
    const next = addManualRFQLineItem(form);

    expect(next.lineItems).toHaveLength(2);
    expect(form.lineItems).toHaveLength(1);
    expect(next.lineItems[1].itemName).toBe('');
  });

  it('removes a row by id', () => {
    const form = completeForm({ lineItems: [completeItem({ id: 'a' }), completeItem({ id: 'b' })] });
    expect(removeManualRFQLineItem(form, 'a').lineItems.map((i) => i.id)).toEqual(['b']);
  });

  it('leaves the form alone when removing an unknown id', () => {
    const form = completeForm();
    expect(removeManualRFQLineItem(form, 'nope').lineItems).toHaveLength(1);
  });

  it('patches only the targeted row', () => {
    const form = completeForm({ lineItems: [completeItem({ id: 'a' }), completeItem({ id: 'b' })] });
    const next = updateManualRFQLineItem(form, 'a', { itemName: 'Gate Valve' });

    expect(next.lineItems[0].itemName).toBe('Gate Valve');
    expect(next.lineItems[1].itemName).toBe('Centrifugal Water Pump');
  });

  // A minor category from the previous major is not valid under the new one, and
  // leaving it would dispatch a mismatched pair to vendors.
  it('clears the minor category when the major changes', () => {
    const form = completeForm({ lineItems: [completeItem({ id: 'a' })] });
    const next = updateManualRFQLineItem(form, 'a', { majorCategory: 'Raw Materials & Metals' });

    expect(next.lineItems[0].majorCategory).toBe('Raw Materials & Metals');
    expect(next.lineItems[0].minorCategory).toBe('');
  });

  it('keeps the minor category when the major is re-set to the same value', () => {
    const form = completeForm({ lineItems: [completeItem({ id: 'a' })] });
    const next = updateManualRFQLineItem(form, 'a', {
      majorCategory: 'Engineering Spares - Mechanical',
    });
    expect(next.lineItems[0].minorCategory).toBe('Pumps & Accessories');
  });

  it('keeps the minor category when only another field changes', () => {
    const form = completeForm({ lineItems: [completeItem({ id: 'a' })] });
    const next = updateManualRFQLineItem(form, 'a', { quantity: 4 });
    expect(next.lineItems[0].minorCategory).toBe('Pumps & Accessories');
  });
});

// ==============================================================================
// fromExtractedEntity
// ==============================================================================
// The inverse of toExtractedEntity, used when the buyer presses Extract on the
// manual path. The row's two category dropdowns are built from the shared
// taxonomy, so a value that is not in it has no matching option: the select shows
// nothing while still holding a value validation would accept. Those values are
// dropped here so the field is genuinely empty and the required-field rules ask
// the buyer for it.

describe('fromExtractedEntity', () => {
  const MAJOR = categoriesData[0].majorCategory;
  const MINOR = categoriesData[0].minorCategories[0];

  function extracted(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
    return {
      id: 'ent-1',
      itemName: 'Industrial Electric Motor, 15 HP',
      quantity: 5,
      unit: 'Nos',
      targetDate: A_FUTURE_DATE,
      technicalSpecs: '3-Phase, 415V, IE3 efficiency',
      confidence: 90,
      category: MINOR,
      majorCategory: MAJOR,
      minorCategory: MINOR,
      ...overrides,
    };
  }

  it('carries every extracted field onto an editable row', () => {
    const row = fromExtractedEntity(extracted());

    expect(row).toMatchObject({
      id: 'ent-1',
      itemName: 'Industrial Electric Motor, 15 HP',
      technicalSpecs: '3-Phase, 415V, IE3 efficiency',
      quantity: 5,
      unit: 'Nos',
      targetDate: A_FUTURE_DATE,
      majorCategory: MAJOR,
      minorCategory: MINOR,
    });
  });

  it('mints an id when the extraction supplied none', () => {
    expect(fromExtractedEntity(extracted({ id: '' })).id).toMatch(/^manual-item-/);
  });

  // Zero from an extraction means "could not read one", not "none wanted".
  it('reports an unreadable quantity as unanswered rather than zero', () => {
    expect(fromExtractedEntity(extracted({ quantity: 0 })).quantity).toBeNull();
  });

  it('keeps a fractional quantity', () => {
    expect(fromExtractedEntity(extracted({ quantity: 2.5 })).quantity).toBe(2.5);
  });

  // This is the case that reached the buyer as two blank dropdowns: the server
  // used to stamp a placeholder major that the taxonomy does not contain.
  it('drops a major category the taxonomy does not contain', () => {
    const row = fromExtractedEntity(
      extracted({ majorCategory: 'General Procurement', minorCategory: 'Motors' })
    );

    expect(row.majorCategory).toBe('');
    expect(row.minorCategory).toBe('');
  });

  it('drops a minor category that does not belong to the surviving major', () => {
    const row = fromExtractedEntity(
      extracted({ majorCategory: MAJOR, minorCategory: 'Not A Real Minor' })
    );

    expect(row.majorCategory).toBe(MAJOR);
    expect(row.minorCategory).toBe('');
  });

  it('drops a minor that belongs to a different major', () => {
    const otherMinor = categoriesData[1].minorCategories[0];
    const row = fromExtractedEntity(
      extracted({ majorCategory: MAJOR, minorCategory: otherMinor })
    );

    expect(row.minorCategory).toBe('');
  });

  it('leaves both categories empty when the extraction named neither', () => {
    const row = fromExtractedEntity(
      extracted({ majorCategory: undefined, minorCategory: undefined })
    );

    expect(row.majorCategory).toBe('');
    expect(row.minorCategory).toBe('');
  });

  // A round trip through the payload shape must not lose the pair.
  it('survives a round trip through toExtractedEntity', () => {
    const row = fromExtractedEntity(toExtractedEntity(completeItem()));

    expect(row.majorCategory).toBe(completeItem().majorCategory);
    expect(row.minorCategory).toBe(completeItem().minorCategory);
  });
});
