import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RFQDeleteDialog, RFQEditModal, changedFields, toFormState, validateRFQEdit } from '@/app/buyer/RFQEditModal';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { formatIndianDateTime } from '@/lib/constants';
import { CATEGORY_TAXONOMY_FIXTURE as categoriesData } from '../../../test-fixtures/categoryTaxonomy';
import type { ExtractedEntity, RFQAttachment, RFQEditFormState, RFQItem } from '@/lib/types';

jest.mock('@/lib/rfqClient', () => ({
  uploadRFQAttachment: jest.fn(),
  classifyLineItems: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rfqClient = require('@/lib/rfqClient');

const EDIT = UI_STRINGS.rfqEdit;
const DETAILS = UI_STRINGS.rfqDetails;

const MAJOR = categoriesData[0].majorCategory;
const MINOR = categoriesData[0].minorCategories[0];
const OTHER_MAJOR = categoriesData[1].majorCategory;
const OTHER_MINOR = categoriesData[1].minorCategories[0];

// A hardcoded literal here ('2026-09-30' or '2026-10-15') is a time bomb: validateRFQEdit
// rejects any targetDeliveryDate earlier than today, so a fixed past-looking
// date starts failing the instant the real calendar date passes it. Computed
// once per test run instead, always valid.
const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
// A second, distinct future date for tests that change targetDeliveryDate
// away from buildRFQ()'s default and assert the new value was sent — offset
// far enough from A_FUTURE_DATE (60 days vs 30) that the two can never
// collide and hide a real field change.
const A_DIFFERENT_FUTURE_DATE = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function entity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Centrifugal Water Pump 500 GPM',
    quantity: 12,
    unit: 'Nos',
    targetDate: A_FUTURE_DATE,
    technicalSpecs: 'SS316 impeller',
    confidence: 95,
    category: MINOR,
    majorCategory: MAJOR,
    minorCategory: MINOR,
    ...overrides,
  };
}

function attachment(overrides: Partial<RFQAttachment> = {}): RFQAttachment {
  return {
    id: 'a1',
    fileName: 'annexure.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    uploadedAt: '2026-09-02T11:07:16.000Z',
    ...overrides,
  };
}

function buildRFQ(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: '41',
    rfqNumber: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: MAJOR,
    sourcingMode: 'mode_2',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: A_FUTURE_DATE,
    budget: 348000,
    deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    deliveryPincode: '400701',
    createdAt: '2026-09-04T10:00:00.000Z',
    extractedEntities: [entity()],
    attachments: [attachment()],
    quotes: [],
    chasingActive: false,
    source: 'manual_entry',
    raisedByEmail: 'buyer@procucev.com',
    ...overrides,
  } as RFQItem;
}

const onClose = jest.fn();
const onSave = jest.fn();
const onConfirm = jest.fn();

const renderEdit = (rfq: RFQItem | null = buildRFQ()) =>
  render(<RFQEditModal rfq={rfq} onClose={onClose} onSave={onSave} />);

const renderDelete = (rfq: RFQItem | null = buildRFQ()) =>
  render(<RFQDeleteDialog rfq={rfq} onClose={onClose} onConfirm={onConfirm} />);

const clickSave = () => fireEvent.click(screen.getByRole('button', { name: EDIT.saveAction }));
const itemRows = () => screen.getAllByRole('row').slice(1);
const firstRow = () => itemRows()[0];

beforeEach(() => {
  jest.clearAllMocks();
  onSave.mockResolvedValue(buildRFQ());
  onConfirm.mockResolvedValue(undefined);
  rfqClient.uploadRFQAttachment.mockResolvedValue({
    success: true,
    data: attachment({ id: 'a2', fileName: 'addendum.pdf' }),
  });
});

// ==============================================================================
// PURE HELPERS
// ==============================================================================

describe('toFormState', () => {
  it('seeds every editable field from the record', () => {
    const form = toFormState(buildRFQ());

    expect(form).toMatchObject({
      title: 'Mechanical Spares Procurement',
      category: MAJOR,
      status: 'Quotes Pending',
      budget: 348000,
      targetDeliveryDate: A_FUTURE_DATE,
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
    });
    expect(form.lineItems).toHaveLength(1);
    expect(form.attachments).toHaveLength(1);
  });

  // A blank ceiling and a ceiling of nothing are different answers.
  it('reports an unstated budget as unanswered rather than zero', () => {
    expect(toFormState(buildRFQ({ budget: 0 })).budget).toBeNull();
  });

  it('reports a zero quantity as unanswered', () => {
    const form = toFormState(buildRFQ({ extractedEntities: [entity({ quantity: 0 })] }));
    expect(form.lineItems[0].quantity).toBeNull();
  });

  it('mints a row id when the stored item has none', () => {
    const form = toFormState(buildRFQ({ extractedEntities: [entity({ id: '' })] }));
    expect(form.lineItems[0].id).toMatch(/^rfq-item-/);
  });

  it('tolerates a record with no line items or attachments at all', () => {
    const form = toFormState(
      buildRFQ({ extractedEntities: undefined, attachments: undefined } as unknown as Partial<RFQItem>)
    );
    expect(form.lineItems).toEqual([]);
    expect(form.attachments).toEqual([]);
  });

  it('defaults every optional string to empty', () => {
    const form = toFormState(
      buildRFQ({
        title: undefined,
        category: undefined,
        targetDeliveryDate: undefined,
        deliveryLocation: undefined,
        deliveryPincode: undefined,
      } as unknown as Partial<RFQItem>)
    );
    expect(form.title).toBe('');
    expect(form.category).toBe('');
    expect(form.targetDeliveryDate).toBe('');
    expect(form.deliveryLocation).toBe('');
    expect(form.deliveryPincode).toBe('');
  });

  // The seeding reads a few alternative key spellings, because records written by
  // earlier ingestion paths did not all use the current field names. Without these
  // a legacy row opened with its quantity and unit apparently blank.
  describe('alternative key spellings on a stored record', () => {
    it('reads line items held under lineItems', () => {
      const form = toFormState({
        ...buildRFQ({ extractedEntities: undefined } as unknown as Partial<RFQItem>),
        lineItems: [entity()],
      } as unknown as RFQItem);

      expect(form.lineItems).toHaveLength(1);
      expect(form.lineItems[0].quantity).toBe(12);
    });

    it.each([
      ['qty', { quantity: undefined, qty: 7 }],
      ['Quantity', { quantity: undefined, Quantity: 7 }],
    ])('reads a quantity held under %s', (_key, patch) => {
      const form = toFormState(
        buildRFQ({ extractedEntities: [{ ...entity(), ...patch }] } as unknown as Partial<RFQItem>)
      );

      expect(form.lineItems[0].quantity).toBe(7);
    });

    it.each([
      ['uom', { unit: undefined, uom: 'Mtr' }],
      ['UOM', { unit: undefined, UOM: 'Mtr' }],
    ])('reads a unit held under %s', (_key, patch) => {
      const form = toFormState(
        buildRFQ({ extractedEntities: [{ ...entity(), ...patch }] } as unknown as Partial<RFQItem>)
      );

      expect(form.lineItems[0].unit).toBe('Mtr');
    });

    // A quantity that arrives as a string still has to become a number, or the
    // number input renders nothing.
    it('coerces a quantity that arrived as a string', () => {
      const form = toFormState(
        buildRFQ({ extractedEntities: [{ ...entity(), quantity: '42' }] } as unknown as Partial<RFQItem>)
      );

      expect(form.lineItems[0].quantity).toBe(42);
    });

    it('reports an unreadable quantity as unanswered', () => {
      const form = toFormState(
        buildRFQ({
          extractedEntities: [{ ...entity(), quantity: 'not a number' }],
        } as unknown as Partial<RFQItem>)
      );

      expect(form.lineItems[0].quantity).toBeNull();
    });

    it.each([
      ['snake_case delivery fields', { deliveryLocation: undefined, delivery_location: 'Pune' }, 'deliveryLocation', 'Pune'],
      ['snake_case pincode', { deliveryPincode: undefined, delivery_pincode: '411001' }, 'deliveryPincode', '411001'],
      ['estimatedBudget', { budget: undefined, estimatedBudget: 900 }, 'budget', 900],
    ])('reads %s', (_case, patch, field, expected) => {
      const form = toFormState(buildRFQ(patch as unknown as Partial<RFQItem>));

      expect(form[field as 'deliveryLocation']).toBe(expected);
    });

    it('defaults a missing status to the first pipeline state', () => {
      const form = toFormState(buildRFQ({ status: undefined } as unknown as Partial<RFQItem>));

      expect(form.status).toBe('Parsing');
    });
  });

  it('carries a missing specification through as empty', () => {
    const form = toFormState(
      buildRFQ({ extractedEntities: [entity({ technicalSpecs: undefined, unit: undefined, targetDate: undefined, majorCategory: undefined, minorCategory: undefined, confidence: undefined })] } as unknown as Partial<RFQItem>)
    );
    expect(form.lineItems[0]).toMatchObject({
      technicalSpecs: '',
      unit: '',
      targetDate: '',
      majorCategory: '',
      minorCategory: '',
      confidence: 0,
    });
  });
});

describe('validateRFQEdit', () => {
  const valid = (): RFQEditFormState => toFormState(buildRFQ());

  it('accepts a complete form', () => {
    expect(validateRFQEdit(valid())).toEqual({});
  });

  it.each([
    ['title', { title: 'ab' }, 'title', EDIT.titleRequired],
    ['blank category', { category: '  ' }, 'category', EDIT.categoryRequired],
    ['negative budget', { budget: -1 }, 'budget', EDIT.budgetNegative],
    ['short location', { deliveryLocation: 'ab' }, 'deliveryLocation', EDIT.deliveryLocationRequired],
    ['blank pincode', { deliveryPincode: '  ' }, 'deliveryPincode', EDIT.deliveryPincodeRequired],
    ['malformed pincode', { deliveryPincode: '!!' }, 'deliveryPincode', EDIT.deliveryPincodeInvalid],
    ['dummy pincode', { deliveryPincode: '123456' }, 'deliveryPincode', EDIT.deliveryPincodeDummy],
  ])('rejects a %s', (_case, patch, field, message) => {
    expect(validateRFQEdit({ ...valid(), ...patch })[field as 'title']).toBe(message);
  });

  it('accepts a blank budget', () => {
    expect(validateRFQEdit({ ...valid(), budget: null }).budget).toBeUndefined();
  });

  // An RFQ with no line items has nothing for a vendor to quote against.
  it('rejects a form with no line items', () => {
    expect(validateRFQEdit({ ...valid(), lineItems: [] }).lineItems).toBe(EDIT.lineItemsRequired);
  });

  // Reported against the row number: a long BOQ gives no clue otherwise.
  it.each([
    ['description', { itemName: '   ' }, EDIT.itemNameRequired],
    ['quantity', { quantity: null }, EDIT.quantityRequired],
    ['zero quantity', { quantity: 0 }, EDIT.quantityRequired],
    ['unit', { unit: '' }, EDIT.unitRequired],
    ['major category', { majorCategory: '' }, EDIT.majorCategoryRequired],
  ])('names the row that is missing its %s', (_case, patch, message) => {
    const form = valid();
    const errors = validateRFQEdit({
      ...form,
      lineItems: [form.lineItems[0], { ...form.lineItems[0], id: 'row-2', ...patch }],
    });

    expect(errors.lineItems).toBe(formatString(EDIT.lineItemErrorSummary, { row: 2, message }));
  });

  it('reports only the first faulty row', () => {
    const form = valid();
    const broken = { ...form.lineItems[0], id: 'r', itemName: '' };
    const errors = validateRFQEdit({ ...form, lineItems: [broken, { ...broken, id: 'r2' }] });

    expect(errors.lineItems).toContain('Row 1');
  });
});

describe('changedFields', () => {
  it('reports nothing when the form matches the record', () => {
    const rfq = buildRFQ();
    expect(changedFields(rfq, toFormState(rfq))).toEqual({});
  });

  it.each([
    ['title', { title: ' Revised ' }, { title: 'Revised' }],
    ['category', { category: OTHER_MAJOR }, { category: OTHER_MAJOR }],
    ['status', { status: 'In Evaluation' as const }, { status: 'In Evaluation' }],
    ['budget', { budget: 500 }, { budget: 500 }],
    ['targetDeliveryDate', { targetDeliveryDate: A_DIFFERENT_FUTURE_DATE }, { targetDeliveryDate: A_DIFFERENT_FUTURE_DATE }],
    ['deliveryLocation', { deliveryLocation: ' Pune Plant ' }, { deliveryLocation: 'Pune Plant' }],
    ['deliveryPincode', { deliveryPincode: ' 411001 ' }, { deliveryPincode: '411001' }],
  ])('sends only %s when only that changed', (_case, patch, expected) => {
    const rfq = buildRFQ();
    expect(changedFields(rfq, { ...toFormState(rfq), ...patch })).toEqual(expected);
  });

  // A cleared budget is a real change from a stated one.
  it('sends zero when the buyer clears a stated budget', () => {
    const rfq = buildRFQ();
    expect(changedFields(rfq, { ...toFormState(rfq), budget: null })).toEqual({ budget: 0 });
  });

  it('sends nothing when a blank budget stays blank', () => {
    const rfq = buildRFQ({ budget: 0 });
    expect(changedFields(rfq, { ...toFormState(rfq), budget: null })).toEqual({});
  });

  it('sends the whole line-item collection when a row changed', () => {
    const rfq = buildRFQ();
    const form = toFormState(rfq);
    const changes = changedFields(rfq, {
      ...form,
      lineItems: [{ ...form.lineItems[0], quantity: 30 }],
    });

    expect(changes.extractedEntities).toHaveLength(1);
    expect(changes.extractedEntities?.[0].quantity).toBe(30);
  });

  it('sends the collection when a row was added or removed', () => {
    const rfq = buildRFQ();
    const form = toFormState(rfq);

    expect(changedFields(rfq, { ...form, lineItems: [] }).extractedEntities).toEqual([]);
  });

  // The confidence records how the row was produced, so editing a description
  // must not silently reclassify it.
  it('preserves the confidence of an edited row', () => {
    const rfq = buildRFQ();
    const form = toFormState(rfq);
    const changes = changedFields(rfq, {
      ...form,
      lineItems: [{ ...form.lineItems[0], itemName: 'Renamed pump' }],
    });

    expect(changes.extractedEntities?.[0].confidence).toBe(95);
  });

  it('keeps the minor category as the searchable category', () => {
    const rfq = buildRFQ();
    const form = toFormState(rfq);
    const changes = changedFields(rfq, {
      ...form,
      lineItems: [{ ...form.lineItems[0], minorCategory: OTHER_MINOR, majorCategory: OTHER_MAJOR }],
    });

    expect(changes.extractedEntities?.[0].category).toBe(OTHER_MINOR);
  });

  it('falls back to the major category when a row has no minor', () => {
    const rfq = buildRFQ();
    const form = toFormState(rfq);
    const changes = changedFields(rfq, {
      ...form,
      lineItems: [{ ...form.lineItems[0], minorCategory: '' }],
    });

    expect(changes.extractedEntities?.[0].category).toBe(MAJOR);
  });

  it('sends a null quantity as zero so the API sees a number', () => {
    const rfq = buildRFQ();
    const form = toFormState(rfq);
    const changes = changedFields(rfq, {
      ...form,
      lineItems: [{ ...form.lineItems[0], quantity: null }],
    });

    expect(changes.extractedEntities?.[0].quantity).toBe(0);
  });

  it('sends the attachments when one was removed', () => {
    const rfq = buildRFQ();
    expect(changedFields(rfq, { ...toFormState(rfq), attachments: [] }).attachments).toEqual([]);
  });

  it('sends the attachments when one was added', () => {
    const rfq = buildRFQ();
    const added = attachment({ id: 'a2', fileName: 'addendum.pdf' });
    const changes = changedFields(rfq, {
      ...toFormState(rfq),
      attachments: [attachment(), added],
    });

    expect(changes.attachments).toHaveLength(2);
  });

  it('tolerates a record with no stored line items', () => {
    const rfq = buildRFQ({ extractedEntities: undefined } as unknown as Partial<RFQItem>);
    expect(changedFields(rfq, toFormState(rfq))).toEqual({});
  });
});

// ==============================================================================
// THE EDIT DIALOG
// ==============================================================================

describe('RFQEditModal: visibility and provenance', () => {
  it('renders nothing without an RFQ', () => {
    renderEdit(null);
    expect(screen.queryByTestId('rfq-edit-modal')).not.toBeInTheDocument();
  });

  it('renders as a labelled modal dialog naming the RFQ', () => {
    renderEdit();

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: EDIT.dialogTitle })).toBeInTheDocument();
    // Named in the subtitle and again as read-only provenance.
    expect(screen.getAllByText(/RFQ260409000512/).length).toBeGreaterThan(1);
  });

  // Shown so the buyer can see what an edit cannot change, rather than wondering
  // where the field went.
  it('shows the provenance read-only, with the raised time in IST', () => {
    renderEdit();

    expect(screen.getByText(EDIT.readOnlyNote)).toBeInTheDocument();
    expect(screen.getByText(EDIT.rfqNumberLabel)).toBeInTheDocument();
    expect(screen.getByText(formatIndianDateTime('2026-09-04T10:00:00.000Z'))).toBeInTheDocument();
    expect(screen.getByText('buyer@procucev.com')).toBeInTheDocument();
    expect(screen.getByText(DETAILS.sourceManualEntry)).toBeInTheDocument();
  });

  it('marks absent provenance as unset', () => {
    renderEdit(buildRFQ({ raisedByEmail: undefined, source: undefined }));

    expect(screen.getAllByText(DETAILS.unsetValue).length).toBeGreaterThan(0);
  });

  it('shows an unrecognised intake source verbatim', () => {
    renderEdit(buildRFQ({ source: 'carrier_pigeon' } as unknown as Partial<RFQItem>));

    expect(screen.getByText('carrier_pigeon')).toBeInTheDocument();
  });

  it('closes from the header control and from Cancel', () => {
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: EDIT.closeAria }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: EDIT.cancelAction }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // Closing must discard the form, or reopening the same RFQ would show whatever
  // was half-typed the previous time instead of what is stored.
  it('discards the form when the dialog is closed', () => {
    const { rerender } = renderEdit();

    fireEvent.change(screen.getByLabelText(EDIT.titleLabel), { target: { value: 'Half-typed' } });
    rerender(<RFQEditModal rfq={null} onClose={onClose} onSave={onSave} />);
    expect(screen.queryByTestId('rfq-edit-modal')).not.toBeInTheDocument();

    rerender(<RFQEditModal rfq={buildRFQ()} onClose={onClose} onSave={onSave} />);
    expect(screen.getByLabelText(EDIT.titleLabel)).toHaveValue('Mechanical Spares Procurement');
  });

  // Opening a different row must not leave the previous RFQ's values on the form.
  it('reseeds when a different RFQ is opened', () => {
    const { rerender } = renderEdit();
    expect(screen.getByLabelText(EDIT.titleLabel)).toHaveValue('Mechanical Spares Procurement');

    rerender(
      <RFQEditModal
        rfq={buildRFQ({ rfqNumber: 'RFQ260409000513', title: 'Second RFQ' })}
        onClose={onClose}
        onSave={onSave}
      />
    );
    expect(screen.getByLabelText(EDIT.titleLabel)).toHaveValue('Second RFQ');
  });
});

describe('RFQEditModal: commercial and delivery', () => {
  it('offers every taxonomy major as the category', () => {
    renderEdit();

    const select = screen.getByLabelText(EDIT.categoryLabel) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(
      categoriesData.map((group) => group.majorCategory)
    );
  });

  // A select whose value matches none of its options renders blank, which read as
  // "this RFQ has no category" on a record that has one — and saving would then
  // have been rejected for a missing required field.
  it('selects an off-taxonomy category rather than rendering blank', () => {
    renderEdit(buildRFQ({ category: 'General Procurement' }));

    expect(screen.getByLabelText(EDIT.categoryLabel)).toHaveValue('General Procurement');
    expect(screen.getByRole('option', { name: 'General Procurement' })).toBeInTheDocument();
  });

  it('offers the taxonomy alongside an off-taxonomy category', () => {
    renderEdit(buildRFQ({ category: 'General Procurement' }));

    const select = screen.getByLabelText(EDIT.categoryLabel) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'General Procurement',
      ...categoriesData.map((group) => group.majorCategory),
    ]);
  });

  // Only when there genuinely is none, so an RFQ that has a category cannot be
  // saved back without one.
  it('offers a blank category choice only when the record has none', () => {
    const { unmount } = renderEdit(buildRFQ({ category: '' }));
    expect(screen.getByLabelText(EDIT.categoryLabel)).toHaveValue('');
    unmount();

    renderEdit(buildRFQ({ category: 'General Procurement' }));
    const select = screen.getByLabelText(EDIT.categoryLabel) as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.value === '')).toBe(false);
  });

  it('offers every RFQ status', () => {
    renderEdit();

    const select = screen.getByLabelText(EDIT.statusLabel) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain('PO Generated');
  });

  it('sends each changed commercial field', async () => {
    renderEdit();

    fireEvent.change(screen.getByLabelText(EDIT.titleLabel), { target: { value: 'Revised title' } });
    fireEvent.change(screen.getByLabelText(EDIT.categoryLabel), { target: { value: OTHER_MAJOR } });
    fireEvent.change(screen.getByLabelText(EDIT.statusLabel), { target: { value: 'In Evaluation' } });
    fireEvent.change(screen.getByLabelText(/Estimated Budget/i), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText(EDIT.targetDateLabel), { target: { value: A_DIFFERENT_FUTURE_DATE } });
    fireEvent.change(screen.getByLabelText(EDIT.deliveryLocationLabel), { target: { value: 'Pune Plant Gate 2' } });
    fireEvent.change(screen.getByLabelText(EDIT.deliveryPincodeLabel), { target: { value: '411001' } });
    clickSave();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith('RFQ260409000512', {
      title: 'Revised title',
      category: OTHER_MAJOR,
      status: 'In Evaluation',
      budget: 500000,
      targetDeliveryDate: A_DIFFERENT_FUTURE_DATE,
      deliveryLocation: 'Pune Plant Gate 2',
      deliveryPincode: '411001',
    });
  });

  it('clears an entered budget back to unstated rather than to zero on screen', () => {
    renderEdit();
    const budget = screen.getByLabelText(/Estimated Budget/i);

    fireEvent.change(budget, { target: { value: '' } });
    expect(budget).toHaveValue(null);
  });
});

describe('RFQEditModal: line items', () => {
  it('renders one editable row per stored line item', () => {
    renderEdit();

    expect(within(firstRow()).getByLabelText(EDIT.colItem)).toHaveValue('Centrifugal Water Pump 500 GPM');
    expect(within(firstRow()).getByLabelText(EDIT.colQty)).toHaveValue(12);
    expect(within(firstRow()).getByLabelText(EDIT.colUnit)).toHaveValue('Nos');
    expect(within(firstRow()).getByLabelText(EDIT.colSpecs)).toHaveValue('SS316 impeller');
    expect(within(firstRow()).getByLabelText(EDIT.colTargetDate)).toHaveValue(A_FUTURE_DATE);
  });

  it('counts the rows in the section heading', () => {
    renderEdit(buildRFQ({ extractedEntities: [entity(), entity({ id: 'ent-2' })] }));

    expect(itemRows()).toHaveLength(2);
  });

  it('adds a blank row', () => {
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(EDIT.addItemAction, 'i') }));

    expect(itemRows()).toHaveLength(2);
    expect(within(itemRows()[1]).getByLabelText(EDIT.colItem)).toHaveValue('');
    expect(within(itemRows()[1]).getByLabelText(EDIT.colQty)).toHaveValue(null);
  });

  it('removes a row', () => {
    renderEdit();

    fireEvent.click(
      screen.getByRole('button', {
        name: formatString(EDIT.removeItemAria, { item: 'Centrifugal Water Pump 500 GPM' }),
      })
    );

    expect(screen.getByText(EDIT.noItemsMessage)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('labels the remove control for an unnamed row', () => {
    renderEdit(buildRFQ({ extractedEntities: [entity({ itemName: '' })] }));

    expect(
      screen.getByRole('button', {
        name: formatString(EDIT.removeItemAria, { item: EDIT.untitledItem }),
      })
    ).toBeInTheDocument();
  });

  // The minor options depend on the major, so nothing can be chosen until it is set.
  it('disables the minor category until a major is chosen', () => {
    renderEdit(buildRFQ({ extractedEntities: [entity({ majorCategory: '', minorCategory: '' })] }));

    expect(within(firstRow()).getByLabelText(EDIT.colMinor)).toBeDisabled();
    expect(screen.getByText(EDIT.selectMajorFirst)).toBeInTheDocument();

    fireEvent.change(within(firstRow()).getByLabelText(EDIT.colMajor), { target: { value: MAJOR } });
    expect(within(firstRow()).getByLabelText(EDIT.colMinor)).toBeEnabled();
  });

  // A minor from the previous major is invalid under the new one, and leaving it
  // would dispatch a mismatched pair to vendors.
  it('clears the minor category when the major changes', () => {
    renderEdit();
    const minor = within(firstRow()).getByLabelText(EDIT.colMinor) as HTMLSelectElement;
    expect(minor.value).toBe(MINOR);

    fireEvent.change(within(firstRow()).getByLabelText(EDIT.colMajor), { target: { value: OTHER_MAJOR } });
    expect((within(firstRow()).getByLabelText(EDIT.colMinor) as HTMLSelectElement).value).toBe('');
  });

  it('offers only the minors belonging to the chosen major', () => {
    renderEdit();

    const minor = within(firstRow()).getByLabelText(EDIT.colMinor) as HTMLSelectElement;
    const offered = Array.from(minor.options).map((o) => o.value).filter(Boolean);
    expect(offered).toEqual(categoriesData[0].minorCategories);
  });

  // ── Off-taxonomy categories on a stored row ────────────────────────────────
  // The ingestion default used to stamp 'General Procurement', which is not a
  // major in categories.json. Offering only taxonomy entries left both dropdowns
  // with no matching option, so the row opened with its categories apparently
  // blank even though the record held them.
  describe('a row whose categories are outside the taxonomy', () => {
    const offTaxonomy = () =>
      buildRFQ({
        category: 'General Procurement',
        extractedEntities: [
          entity({ majorCategory: 'General Procurement', minorCategory: 'Motors', category: 'Motors' }),
        ],
      });

    it('shows the stored major instead of an empty select', () => {
      renderEdit(offTaxonomy());

      expect(within(firstRow()).getByLabelText(EDIT.colMajor)).toHaveValue('General Procurement');
    });

    it('shows the stored minor instead of an empty select', () => {
      renderEdit(offTaxonomy());

      expect(within(firstRow()).getByLabelText(EDIT.colMinor)).toHaveValue('Motors');
    });

    it('leaves the minor selectable rather than disabled', () => {
      renderEdit(offTaxonomy());

      expect(within(firstRow()).getByLabelText(EDIT.colMinor)).toBeEnabled();
    });

    // Nothing is sent until the buyer actually changes something: an RFQ opened and
    // closed must not be rewritten just because its category is unusual.
    it('reports no change when the dialog is only opened', async () => {
      renderEdit(offTaxonomy());

      clickSave();

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(EDIT.noChanges));
      expect(onSave).not.toHaveBeenCalled();
    });

    // The buyer can still move the row onto the real taxonomy.
    it('lets the buyer reclassify the row onto a taxonomy pair', async () => {
      renderEdit(offTaxonomy());

      fireEvent.change(within(firstRow()).getByLabelText(EDIT.colMajor), { target: { value: MAJOR } });
      fireEvent.change(within(firstRow()).getByLabelText(EDIT.colMinor), { target: { value: MINOR } });
      clickSave();

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      const item = onSave.mock.calls[0][1].extractedEntities[0];
      expect(item.majorCategory).toBe(MAJOR);
      expect(item.minorCategory).toBe(MINOR);
    });

    // Everything else on the row always filled correctly; these pin that down so a
    // future change to the category handling cannot quietly break them.
    it('still fills the quantity, unit, description, specification and date', () => {
      renderEdit(offTaxonomy());

      expect(within(firstRow()).getByLabelText(EDIT.colQty)).toHaveValue(12);
      expect(within(firstRow()).getByLabelText(EDIT.colUnit)).toHaveValue('Nos');
      expect(within(firstRow()).getByLabelText(EDIT.colItem)).toHaveValue('Centrifugal Water Pump 500 GPM');
      expect(within(firstRow()).getByLabelText(EDIT.colSpecs)).toHaveValue('SS316 impeller');
      expect(within(firstRow()).getByLabelText(EDIT.colTargetDate)).toHaveValue(A_FUTURE_DATE);
    });

    // A six-figure BOQ quantity was being clipped by a 112px input, which read as
    // an empty field rather than a full one.
    it('fills a large quantity in full', () => {
      renderEdit(buildRFQ({ extractedEntities: [entity({ quantity: 242621 })] }));

      expect(within(firstRow()).getByLabelText(EDIT.colQty)).toHaveValue(242621);
    });

    it('still lists the attached documents', () => {
      renderEdit(offTaxonomy());

      expect(screen.getByText('annexure.pdf')).toBeInTheDocument();
    });
  });

  it('sends the edited rows on save', async () => {
    renderEdit();

    fireEvent.change(within(firstRow()).getByLabelText(EDIT.colItem), { target: { value: 'Renamed pump' } });
    fireEvent.change(within(firstRow()).getByLabelText(EDIT.colQty), { target: { value: '30' } });
    clickSave();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const changes = onSave.mock.calls[0][1];
    expect(changes.extractedEntities[0].itemName).toBe('Renamed pump');
    expect(changes.extractedEntities[0].quantity).toBe(30);
  });

  it('clears a quantity back to unanswered rather than zero', () => {
    renderEdit();
    const qty = within(firstRow()).getByLabelText(EDIT.colQty);

    fireEvent.change(qty, { target: { value: '' } });
    expect(qty).toHaveValue(null);
  });
});

describe('RFQEditModal: supporting documents', () => {
  const chooseFiles = (files: File[]) =>
    fireEvent.change(screen.getByTestId('rfq-edit-attachment-input'), { target: { files } });

  it('lists the attached documents with their size', () => {
    renderEdit();

    expect(screen.getByText('annexure.pdf')).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
  });

  it('reports an RFQ with no documents', () => {
    renderEdit(buildRFQ({ attachments: [] }));

    expect(screen.getByText(EDIT.noAttachmentsMessage)).toBeInTheDocument();
  });

  it('opens the file picker from the attach control', () => {
    renderEdit();
    const input = screen.getByTestId('rfq-edit-attachment-input');
    const click = jest.spyOn(input, 'click');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(EDIT.attachAction, 'i') }));

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('uploads a chosen document and lists it', async () => {
    renderEdit();
    chooseFiles([new File(['x'], 'addendum.pdf', { type: 'application/pdf' })]);

    await waitFor(() => expect(screen.getByText('addendum.pdf')).toBeInTheDocument());
    expect(rfqClient.uploadRFQAttachment).toHaveBeenCalledTimes(1);
  });

  it('ignores a change that carries no files', () => {
    renderEdit();
    chooseFiles([]);

    expect(rfqClient.uploadRFQAttachment).not.toHaveBeenCalled();
  });

  // Uploaded one at a time so a rejection names the file that caused it.
  it('reports a refused document against its own file', async () => {
    rfqClient.uploadRFQAttachment
      .mockResolvedValueOnce({ success: true, data: attachment({ id: 'ok', fileName: 'good.pdf' }) })
      .mockResolvedValueOnce({ success: false, error: 'That file type cannot be attached.' });

    renderEdit();
    chooseFiles([
      new File(['x'], 'good.pdf', { type: 'application/pdf' }),
      new File(['y'], 'bad.exe', { type: 'application/x-msdownload' }),
    ]);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad.exe'));
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
  });

  it('removes an attachment', () => {
    renderEdit();

    fireEvent.click(
      screen.getByRole('button', {
        name: formatString(EDIT.removeAttachmentAria, { fileName: 'annexure.pdf' }),
      })
    );

    expect(screen.queryByText('annexure.pdf')).not.toBeInTheDocument();
    expect(screen.getByText(EDIT.noAttachmentsMessage)).toBeInTheDocument();
  });

  it('sends the attachment list on save', async () => {
    renderEdit();

    fireEvent.click(
      screen.getByRole('button', {
        name: formatString(EDIT.removeAttachmentAria, { fileName: 'annexure.pdf' }),
      })
    );
    clickSave();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1].attachments).toEqual([]);
  });
});

describe('RFQEditModal: saving', () => {
  it('holds validation back until the buyer tries to save', () => {
    renderEdit(buildRFQ({ title: 'ab' }));

    expect(screen.queryByText(EDIT.titleRequired)).not.toBeInTheDocument();

    clickSave();
    expect(screen.getByText(EDIT.titleRequired)).toBeInTheDocument();
  });

  it('does not save an invalid form', () => {
    renderEdit();

    fireEvent.change(screen.getByLabelText(EDIT.deliveryPincodeLabel), { target: { value: '!!' } });
    clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(EDIT.deliveryPincodeInvalid)).toBeInTheDocument();
  });

  it('reports a faulty line item rather than saving it', () => {
    renderEdit();

    fireEvent.change(within(firstRow()).getByLabelText(EDIT.colItem), { target: { value: '' } });
    clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Row 1/)).toBeInTheDocument();
  });

  // A no-op save would only move updated_at, so it is refused with an explanation.
  it('says so when nothing has been changed', () => {
    renderEdit();

    clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(EDIT.noChanges);
  });

  it('closes once the save succeeds', async () => {
    renderEdit();

    fireEvent.change(screen.getByLabelText(EDIT.titleLabel), { target: { value: 'Revised title' } });
    clickSave();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the dialog open and reports the reason when the save fails', async () => {
    onSave.mockRejectedValue(new Error('The RFQ could not be updated.'));
    renderEdit();

    fireEvent.change(screen.getByLabelText(EDIT.titleLabel), { target: { value: 'Revised title' } });
    clickSave();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('The RFQ could not be updated.')
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the failure carries none', async () => {
    onSave.mockRejectedValue('not an error object');
    renderEdit();

    fireEvent.change(screen.getByLabelText(EDIT.titleLabel), { target: { value: 'Revised title' } });
    clickSave();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(EDIT.saveFailed));
  });

  it('disables the controls while saving', async () => {
    let release: (value: RFQItem) => void = () => {};
    onSave.mockReturnValue(
      new Promise<RFQItem>((resolve) => {
        release = resolve;
      })
    );

    renderEdit();
    fireEvent.change(screen.getByLabelText(EDIT.titleLabel), { target: { value: 'Revised title' } });
    clickSave();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: EDIT.savingAction })).toBeDisabled()
    );
    expect(screen.getByRole('button', { name: EDIT.cancelAction })).toBeDisabled();

    // Closing is refused mid-save, so a half-applied edit cannot be abandoned.
    fireEvent.click(screen.getByRole('button', { name: EDIT.cancelAction }));
    expect(onClose).not.toHaveBeenCalled();

    release(buildRFQ());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ==============================================================================
// THE DELETE CONFIRMATION
// ==============================================================================

describe('RFQDeleteDialog', () => {
  it('renders nothing without an RFQ', () => {
    renderDelete(null);
    expect(screen.queryByTestId('rfq-delete-dialog')).not.toBeInTheDocument();
  });

  // The number alone is what distinguishes one row from the next, so the title and
  // the item count are named too.
  it('names the RFQ, its title and how many line items go with it', () => {
    renderDelete();

    expect(
      screen.getByText(
        formatString(EDIT.deleteConfirmMessage, {
          rfqNumber: 'RFQ260409000512',
          title: 'Mechanical Spares Procurement',
          itemCount: 1,
        })
      )
    ).toBeInTheDocument();
  });

  it('counts zero items for an RFQ with none', () => {
    renderDelete(buildRFQ({ extractedEntities: undefined } as unknown as Partial<RFQItem>));

    expect(screen.getByText(/0 line items/)).toBeInTheDocument();
  });

  it('closes without deleting from Cancel', () => {
    renderDelete();

    fireEvent.click(screen.getByRole('button', { name: EDIT.cancelAction }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('deletes on confirmation and closes', async () => {
    renderDelete();

    fireEvent.click(screen.getByRole('button', { name: EDIT.deleteConfirmAction }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('RFQ260409000512'));
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open and reports the reason when the delete fails', async () => {
    onConfirm.mockRejectedValue(new Error('The RFQ could not be deleted.'));
    renderDelete();

    fireEvent.click(screen.getByRole('button', { name: EDIT.deleteConfirmAction }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('The RFQ could not be deleted.')
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the failure carries none', async () => {
    onConfirm.mockRejectedValue('not an error object');
    renderDelete();

    fireEvent.click(screen.getByRole('button', { name: EDIT.deleteConfirmAction }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(EDIT.deleteFailed));
  });

  it('disables the controls while deleting', async () => {
    let release: () => void = () => {};
    onConfirm.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );

    renderDelete();
    fireEvent.click(screen.getByRole('button', { name: EDIT.deleteConfirmAction }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: EDIT.deletingAction })).toBeDisabled()
    );

    fireEvent.click(screen.getByRole('button', { name: EDIT.cancelAction }));
    expect(onClose).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders field level error badges and messages on invalid delivery location and pincode', async () => {
    renderEdit(buildRFQ({ deliveryLocation: '', deliveryPincode: '' }));
    clickSave();
    await waitFor(() => {
      expect(screen.getByText(EDIT.deliveryLocationRequired)).toBeInTheDocument();
      expect(screen.getByText(EDIT.deliveryPincodeRequired)).toBeInTheDocument();
    });
  });

  it('triggers handleAutoCategorizeAll and fills categories from the server', async () => {
    // Auto-Categorize now delegates to the server (classifyLineItems), which owns
    // the real taxonomy. The browser no longer guesses with a local keyword table.
    rfqClient.classifyLineItems.mockResolvedValueOnce({
      success: true,
      data: {
        extractedEntities: [
          entity({ id: 'ent-1', majorCategory: 'Engineering Spares - Mechanical', minorCategory: 'Pumps & Accessories' }),
        ],
      },
    });

    renderEdit(buildRFQ({ extractedEntities: [entity({ itemName: 'Centrifugal Pump', majorCategory: '', minorCategory: '' })] }));
    const autoBtn = screen.getByText(/Auto-Categorize All/i);
    fireEvent.click(autoBtn);

    await waitFor(() => expect(rfqClient.classifyLineItems).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByDisplayValue(/Engineering Spares - Mechanical/i).length).toBeGreaterThan(0)
    );
  });

  it('auto-populates delivery location on PIN code blur in RFQEditModal', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          Status: 'Success',
          PostOffice: [
            {
              Name: 'Vashi',
              District: 'Thane',
              State: 'Maharashtra',
            },
          ],
        },
      ],
    } as Response);

    renderEdit(buildRFQ({ deliveryLocation: '', deliveryPincode: '' }));
    const pinInput = document.getElementById('rfq-edit-pincode') as HTMLInputElement;
    fireEvent.change(pinInput, { target: { value: '400703' } });
    fireEvent.blur(pinInput);

    await waitFor(() => {
      const locInput = document.getElementById('rfq-edit-location') as HTMLInputElement;
      expect(locInput.value).toBe('Thane, Maharashtra');
    });
  });
});
