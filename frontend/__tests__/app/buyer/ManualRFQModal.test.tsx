import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ManualRFQModal from '@/app/buyer/ManualRFQModal';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { SOURCING_MODES } from '@/lib/constants';
import { CATEGORY_TAXONOMY_FIXTURE as categoriesData } from '../../../test-fixtures/categoryTaxonomy';
import type {
  ExtractedEntity,
  RFQAttachment,
  RFQExtractionResult,
  RFQItem,
} from '@/lib/types';

jest.mock('@/lib/rfqClient', () => ({
  createRFQ: jest.fn(),
  uploadRFQAttachment: jest.fn(),
  extractLineItemsFromDocument: jest.fn(),
  fetchAllVendors: jest.fn(),
}));

// The modal reads buyerVendors from useApp() inside a try/catch, since it can
// render outside an AppProvider in some contexts. Defaults to throwing (the
// historical, un-provided case every other test in this file relies on);
// individual Mode 1 roster tests override this to return a real value.
jest.mock('@/lib/store', () => ({
  useApp: jest.fn(() => ({
    buyerVendors: [
      {
        id: 'v-default-1',
        name: 'Default Enterprise Vendor',
        email: 'vendor@test.com',
        source: 'buyer_uploaded',
        // Matches categoriesData[0], which fillRow() always sets as the RFQ's
        // category — Mode 1 assignment is now category-scoped (see the
        // ManualRFQModal source), so a vendor with no category at all would
        // never match any RFQ's category and every generic save test in this
        // file (not specifically testing category-matching) would break.
        majorCategory: require('../../../test-fixtures/categoryTaxonomy').CATEGORY_TAXONOMY_FIXTURE[0].majorCategory,
      },
    ],
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useApp } = require('@/lib/store');

// Reading a File is jsdom's business, not this dialog's: the request builder is
// exercised directly in documentExtraction.test.ts.
jest.mock('@/lib/documentExtraction', () => ({
  buildExtractionRequest: jest.fn(async (file: File) => ({
    fileName: file.name,
    inlineData: 'ZmFrZQ==',
    mimeType: file.type || 'application/pdf',
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rfqClient = require('@/lib/rfqClient');

const MODAL = UI_STRINGS.manualRfqModal;
const MANUAL = UI_STRINGS.manualRfq;

const onClose = jest.fn();
const onCreated = jest.fn();

const renderModal = (isOpen = true) =>
  render(<ManualRFQModal isOpen={isOpen} onClose={onClose} onCreated={onCreated} />);

function savedRFQ(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: '41',
    rfqNumber: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 0,
    createdAt: '2026-09-04T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    ...overrides,
  } as RFQItem;
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

/** The single row the dialog opens with. */
const firstRow = () => screen.getAllByRole('row')[1];

/** Complete every field a line item needs before dispatch. */
function fillRow() {
  const row = firstRow();
  fireEvent.change(within(row).getByLabelText(MODAL.colItem), {
    target: { value: 'Centrifugal Water Pump' },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colMajor), {
    target: { value: categoriesData[0].majorCategory },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colMinor), {
    target: { value: categoriesData[0].minorCategories[0] },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colQty), { target: { value: '12' } });
  fireEvent.change(within(row).getByLabelText(MODAL.colUnit), { target: { value: 'Nos' } });
}

/** Fill the mandatory delivery destination. */
function fillDelivery() {
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryLocationLabel, 'i')), {
    target: { value: 'Navi Mumbai Plant, Gate 3' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryPincodeLabel, 'i')), {
    target: { value: '400701' },
  });
}

const clickSave = () => fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

/** One extracted line item, in the shape the extraction endpoint returns. */
function extractedEntity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Centrifugal Water Pump 500 GPM',
    quantity: 12,
    unit: 'Units',
    targetDate: '2026-10-15',
    technicalSpecs: 'SS316 impeller',
    confidence: 90,
    category: categoriesData[0].minorCategories[0],
    majorCategory: categoriesData[0].majorCategory,
    minorCategory: categoriesData[0].minorCategories[0],
    ...overrides,
  };
}

function extractionResult({
  entities = [extractedEntity()],
  title = 'Pump Requirement',
  estimatedBudget = 250000 as number | null,
}: {
  entities?: ExtractedEntity[];
  title?: string;
  estimatedBudget?: number | null;
} = {}): RFQExtractionResult {
  return {
    success: true,
    data: {
      title,
      category: categoriesData[0].majorCategory,
      targetDeliveryDate: '2026-10-15',
      estimatedBudget,
      extractedEntities: entities,
      source: 'web_portal',
    },
    classification: {
      totalExtracted: entities.length,
      accepted: entities.length,
      duplicatesRemoved: 0,
      needsReview: 0,
      autoClassified: entities.length,
    },
    extraction: { model: 'gemini-3.6-flash' },
  };
}

import { setCategoryTaxonomy } from '@/lib/categoryTaxonomy';

beforeEach(() => {
  jest.clearAllMocks();
  setCategoryTaxonomy(categoriesData);
  (useApp as jest.Mock).mockReturnValue({
    buyerVendors: [
      {
        id: 'v-default-1',
        name: 'Default Enterprise Vendor',
        email: 'vendor@test.com',
        source: 'buyer_uploaded',
        // Matches categoriesData[0], the category fillRow()/extractionResult()
        // always set — Mode 1 assignment is category-scoped now, so a vendor
        // with no category would never match any RFQ's category here.
        majorCategory: categoriesData[0].majorCategory,
      },
    ],
  });
  rfqClient.createRFQ.mockResolvedValue({ success: true, rfq: savedRFQ() });
  // A distinct id and name per upload: the list is keyed on the id, and two
  // documents in one selection must not collide.
  let uploadCount = 0;
  rfqClient.uploadRFQAttachment.mockImplementation((file: File) => {
    uploadCount += 1;
    return Promise.resolve({
      success: true,
      data: attachment({ id: `a${uploadCount}`, fileName: file.name }),
    });
  });
  rfqClient.extractLineItemsFromDocument.mockResolvedValue(extractionResult());
  rfqClient.fetchAllVendors.mockResolvedValue({
    success: true,
    candidates: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
  });
});

describe('ManualRFQModal: visibility', () => {
  it('renders nothing while closed', () => {
    renderModal(false);
    expect(screen.queryByTestId('manual-rfq-modal')).not.toBeInTheDocument();
  });

  it('renders as a labelled modal dialog', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: MODAL.title })).toBeInTheDocument();
  });

  it('closes from the header control and from Cancel', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: MODAL.closeAria }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: MODAL.cancelAction }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('opens with exactly one blank line item', () => {
    renderModal();
    // Header row plus one item row.
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(within(firstRow()).getByLabelText(MODAL.colItem)).toHaveValue('');
  });

  // A blank row must read blank. A zero is indistinguishable from a buyer who
  // meant zero, and zero is what used to reach vendors unnoticed.
  it('shows an unanswered quantity as blank rather than zero', () => {
    renderModal();
    expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(null);
  });

  it('shows an unanswered budget as blank rather than zero', () => {
    renderModal();
    expect(
      screen.getByLabelText(/Estimated Budget/i)
    ).toHaveValue(null);
  });
});

describe('ManualRFQModal: line items', () => {
  it('adds and removes rows', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(MODAL.addItemAction, 'i') }));
    expect(screen.getAllByRole('row')).toHaveLength(3);

    fireEvent.click(
      screen.getAllByRole('button', {
        name: formatString(MODAL.removeItemAria, { item: MODAL.untitledItem }),
      })[0]
    );
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('reports an empty list rather than rendering an empty table', () => {
    renderModal();
    fireEvent.click(
      screen.getByRole('button', {
        name: formatString(MODAL.removeItemAria, { item: MODAL.untitledItem }),
      })
    );
    expect(screen.getByText(MODAL.noItemsMessage)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // Nothing can be chosen until the major is set, because the options depend on it.
  it('disables the minor category until a major is chosen', () => {
    renderModal();
    const row = firstRow();
    expect(within(row).getByLabelText(MODAL.colMinor)).toBeDisabled();

    fireEvent.change(within(row).getByLabelText(MODAL.colMajor), {
      target: { value: categoriesData[0].majorCategory },
    });
    expect(within(row).getByLabelText(MODAL.colMinor)).toBeEnabled();
  });

  // A minor from the previous major is invalid under the new one, and leaving it
  // would dispatch a mismatched pair to vendors.
  it('clears the minor category when the major changes', () => {
    renderModal();
    const row = firstRow();
    const major = within(row).getByLabelText(MODAL.colMajor);
    const minor = within(row).getByLabelText(MODAL.colMinor) as HTMLSelectElement;

    fireEvent.change(major, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(minor, { target: { value: categoriesData[0].minorCategories[0] } });
    expect(minor.value).toBe(categoriesData[0].minorCategories[0]);

    fireEvent.change(major, { target: { value: categoriesData[1].majorCategory } });
    expect(minor.value).toBe('');
  });
});

describe('ManualRFQModal: validation', () => {
  // Validating on open would greet the buyer with a screen of red against fields
  // they have not reached.
  it('shows no errors until the buyer tries to save', () => {
    renderModal();
    expect(screen.queryByText(MANUAL.itemNameRequired)).not.toBeInTheDocument();
    expect(screen.queryByText(MANUAL.deliveryLocationRequired)).not.toBeInTheDocument();
  });

  it('reports every blocking field once Save is pressed', () => {
    renderModal();
    clickSave();

    expect(screen.getByText(MANUAL.itemNameRequired)).toBeInTheDocument();
    expect(screen.getByText(MANUAL.quantityRequired)).toBeInTheDocument();
    expect(screen.getByText(MANUAL.unitRequired)).toBeInTheDocument();
    // Category is optional now — no error shown for a blank major/minor category.
    expect(screen.queryByText(MANUAL.majorCategoryRequired)).not.toBeInTheDocument();
    expect(screen.getByText(MANUAL.deliveryLocationRequired)).toBeInTheDocument();
    expect(screen.getByText(MANUAL.deliveryPincodeRequired)).toBeInTheDocument();
  });

  it('does not post an invalid form', () => {
    renderModal();
    clickSave();
    expect(rfqClient.createRFQ).not.toHaveBeenCalled();
  });

  it('distinguishes a malformed pincode from a blank one', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryPincodeLabel, 'i')), {
      target: { value: '!!' },
    });
    clickSave();

    expect(screen.getByText(MANUAL.deliveryPincodeInvalid)).toBeInTheDocument();
    expect(screen.queryByText(MANUAL.deliveryPincodeRequired)).not.toBeInTheDocument();
  });

  it('rejects a negative budget', () => {
    renderModal();
    fireEvent.change(
      screen.getByLabelText(/Estimated Budget/i),
      { target: { value: '-5' } }
    );
    clickSave();
    expect(screen.getByText(MANUAL.budgetNegative)).toBeInTheDocument();
  });

  it('clears an error once the field is filled', () => {
    renderModal();
    clickSave();
    expect(screen.getByText(MANUAL.deliveryLocationRequired)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryLocationLabel, 'i')), {
      target: { value: 'Navi Mumbai Plant, Gate 3' },
    });
    expect(screen.queryByText(MANUAL.deliveryLocationRequired)).not.toBeInTheDocument();
  });
});

describe('ManualRFQModal: saving', () => {
  it('posts the form and hands back the server record', async () => {
    renderModal();
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalledTimes(1));

    const payload = rfqClient.createRFQ.mock.calls[0][0];
    expect(payload.source).toBe('manual_entry');
    expect(payload.deliveryPincode).toBe('400701');
    expect(payload.extractedEntities).toHaveLength(1);
    // The server allocates the number, so the client must not send one.
    expect(payload).not.toHaveProperty('rfqNumber');

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(savedRFQ()));
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a failure and keeps the dialog open', async () => {
    rfqClient.createRFQ.mockResolvedValue({
      success: false,
      reason: 'SERVER',
      error: 'The RFQ could not be saved.',
    });

    renderModal();
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The RFQ could not be saved.'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the controls while saving', async () => {
    let release: (value: unknown) => void = () => {};
    rfqClient.createRFQ.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    renderModal();
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: MODAL.savingAction })).toBeDisabled()
    );
    expect(screen.getByRole('button', { name: MODAL.cancelAction })).toBeDisabled();

    release({ success: true, rfq: savedRFQ() });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});

describe('ManualRFQModal: supporting documents', () => {
  const chooseFiles = (files: File[]) =>
    fireEvent.change(screen.getByTestId('manual-modal-attachment-input'), { target: { files } });

  it('uploads a chosen document and lists it', async () => {
    renderModal();
    chooseFiles([new File(['x'], 'annexure.pdf', { type: 'application/pdf' })]);

    await waitFor(() => expect(screen.getByText('annexure.pdf')).toBeInTheDocument());
    expect(rfqClient.uploadRFQAttachment).toHaveBeenCalledTimes(1);
  });

  it('ignores a change that carries no files', () => {
    renderModal();
    chooseFiles([]);
    expect(rfqClient.uploadRFQAttachment).not.toHaveBeenCalled();
  });

  // Uploaded one at a time so a rejection names the file that caused it.
  it('reports a refused document against its own file', async () => {
    rfqClient.uploadRFQAttachment
      .mockResolvedValueOnce({ success: true, data: attachment({ id: 'ok', fileName: 'good.pdf' }) })
      .mockResolvedValueOnce({ success: false, error: 'That file type cannot be attached.' });

    renderModal();
    chooseFiles([
      new File(['x'], 'good.pdf', { type: 'application/pdf' }),
      new File(['y'], 'bad.exe', { type: 'application/x-msdownload' }),
    ]);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad.exe'));
    // The one that succeeded is still attached.
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
  });

  it('removes an attachment', async () => {
    renderModal();
    chooseFiles([new File(['x'], 'annexure.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(screen.getByText('annexure.pdf')).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole('button', {
        name: formatString(MODAL.removeAttachmentAria, { fileName: 'annexure.pdf' }),
      })
    );
    expect(screen.queryByText('annexure.pdf')).not.toBeInTheDocument();
  });

  it('carries the attachments onto the saved RFQ', async () => {
    renderModal();
    chooseFiles([new File(['x'], 'annexure.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(screen.getByText('annexure.pdf')).toBeInTheDocument());

    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    expect(rfqClient.createRFQ.mock.calls[0][0].attachments).toHaveLength(1);
  });
});

describe('ManualRFQModal: header and item fields', () => {
  it('records the RFQ title, budget and target date on the payload', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i')), {
      target: { value: 'Monsoon Pump Overhaul' },
    });
    fireEvent.change(screen.getByLabelText(/Estimated Budget/i), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.targetDateLabel, 'i')), {
      target: { value: '2026-10-31' },
    });
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    const payload = rfqClient.createRFQ.mock.calls[0][0];
    expect(payload.title).toBe('Monsoon Pump Overhaul');
    expect(payload.budget).toBe(250000);
    expect(payload.targetDeliveryDate).toBe('2026-10-31');
  });

  it('records the per-item specs on the payload', async () => {
    renderModal();
    fillRow();
    const row = firstRow();
    fireEvent.change(within(row).getByLabelText(MODAL.colSpecs), {
      target: { value: 'SS316 impeller, 415V' },
    });
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    const item = rfqClient.createRFQ.mock.calls[0][0].extractedEntities[0];
    expect(item.technicalSpecs).toBe('SS316 impeller, 415V');
  });

  it('clears an entered budget back to unstated rather than to zero', () => {
    renderModal();
    const budget = screen.getByLabelText(/Estimated Budget/i);
    fireEvent.change(budget, { target: { value: '250000' } });
    expect(budget).toHaveValue(250000);

    fireEvent.change(budget, { target: { value: '' } });
    expect(budget).toHaveValue(null);
  });
});

describe('ManualRFQModal: sourcing mode', () => {
  it('starts on the first mode and switches on selection', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [],
      activeBuyerAccount: { subscriptionPlan: 'version_3' },
    });
    renderModal();
    const mode1 = screen.getByLabelText('Version 1');
    const mode3 = screen.getByLabelText('Version 3');
    expect(mode1).toBeChecked();

    fireEvent.click(mode3);
    expect(mode3).toBeChecked();
    expect(mode1).not.toBeChecked();

    fillRow();
    fillDelivery();
    clickSave();
    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    expect(rfqClient.createRFQ.mock.calls[0][0].sourcingMode).toBe('mode_3');
  });

  it('unlocks all 3 modes for a free_trial buyer', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [],
      activeBuyerAccount: { subscriptionPlan: 'free_trial' },
    });
    renderModal();
    const mode1 = screen.getByLabelText('Version 1');
    const mode2 = screen.getByLabelText('Version 2');
    const mode3 = screen.getByLabelText('Version 3');
    expect(mode1).not.toBeDisabled();
    expect(mode2).not.toBeDisabled();
    expect(mode3).not.toBeDisabled();
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();
  });

  it('locks Mode 2 and Mode 3 for a version_1 buyer and blocks selecting them', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [{ id: 'v-1', name: 'Vendor 1', source: 'buyer_uploaded', majorCategory: categoriesData[0].majorCategory }],
      activeBuyerAccount: { subscriptionPlan: 'version_1' },
    });
    renderModal();
    const mode1 = screen.getByLabelText('Version 1');
    const mode2 = screen.getByLabelText('Version 2');
    const mode3 = screen.getByLabelText('Version 3');

    expect(mode1).not.toBeDisabled();
    expect(mode2).toBeDisabled();
    expect(mode3).toBeDisabled();
    expect(screen.getAllByText('LOCKED')).toHaveLength(2);

    fireEvent.click(mode2);
    expect(mode1).toBeChecked();
    expect(mode2).not.toBeChecked();

    fillRow();
    fillDelivery();
    clickSave();
    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    expect(rfqClient.createRFQ.mock.calls[0][0].sourcingMode).toBe('mode_1');
  });

  it('unlocks every mode for a version_3 buyer', () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [],
      activeBuyerAccount: { subscriptionPlan: 'version_3' },
    });
    renderModal();
    const mode1 = screen.getByLabelText('Version 1');
    const mode2 = screen.getByLabelText('Version 2');
    const mode3 = screen.getByLabelText('Version 3');

    expect(mode1).not.toBeDisabled();
    expect(mode2).not.toBeDisabled();
    expect(mode3).not.toBeDisabled();
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();
  });

  // Each card states the reach that tier buys as well as how it routes, so the
  // three can be compared before one is chosen. Asserted against the constants
  // rather than literals so the copy can be reworded without breaking the test.
  it('shows the routing description and the tier feature summary on every mode card', () => {
    renderModal();

    SOURCING_MODES.forEach((mode) => {
      const card = screen.getByTestId(`manual-mode-${mode.id}`);
      expect(card).toHaveTextContent(mode.description);
      expect(card).toHaveTextContent(mode.featureSummary);
    });
  });

  it('gives each mode its own feature summary naming the tiers it includes', () => {
    renderModal();

    const summaries = SOURCING_MODES.map((mode) => mode.featureSummary);
    // No two cards may claim the same reach, which is what made the tiers
    // indistinguishable on this screen before.
    expect(new Set(summaries).size).toBe(SOURCING_MODES.length);
    // The summaries are cumulative: each tier includes the ones beneath it.
    expect(screen.getByTestId('manual-mode-mode_1')).toHaveTextContent('Features of Version 1');
    expect(screen.getByTestId('manual-mode-mode_2')).toHaveTextContent('Features of Version 1 & 2');
    expect(screen.getByTestId('manual-mode-mode_3')).toHaveTextContent('Features of Version 1, 2 & 3');
  });

  // The bullet is a visual marker, not content, so it must not be announced.
  it('hides the decorative bullet from assistive technology', () => {
    renderModal();
    const card = screen.getByTestId('manual-mode-mode_1');
    expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('ManualRFQModal: extraction from an attached document', () => {
  const chooseFiles = (files: File[]) =>
    fireEvent.change(screen.getByTestId('manual-modal-attachment-input'), { target: { files } });

  const attachOne = async (name = 'boq.pdf') => {
    chooseFiles([new File(['x'], name, { type: 'application/pdf' })]);
    await waitFor(() => expect(rfqClient.uploadRFQAttachment).toHaveBeenCalled());
    // The extract button stays disabled while the upload is in flight
    // (isAttaching), so wait for it to actually be clickable rather than
    // just for the upload call to have started.
    await waitFor(() => expect(extractBtn()).toBeEnabled());
  };

  const extractBtn = () => screen.getByTestId('manual-extract');

  it('opens the file picker from the attach control', () => {
    renderModal();
    const input = screen.getByTestId('manual-modal-attachment-input');
    const click = jest.spyOn(input, 'click');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(MODAL.attachAction, 'i') }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('offers no extraction until a document is attached', async () => {
    renderModal();
    expect(extractBtn()).toBeDisabled();

    await attachOne();
    expect(extractBtn()).toBeEnabled();
  });

  it('fills the table, title, budget and category from the document', async () => {
    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colItem)).toHaveValue(
        'Centrifugal Water Pump 500 GPM'
      )
    );
    expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12);
    expect(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i'))).toHaveValue('Pump Requirement');
    expect(screen.getByLabelText(/Estimated Budget/i)).toHaveValue(250000);
    expect(within(firstRow()).getByLabelText(MODAL.colMajor)).toHaveValue(
      categoriesData[0].majorCategory
    );
  });

  it('leaves rows editable after extraction', async () => {
    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());
    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );

    fireEvent.change(within(firstRow()).getByLabelText(MODAL.colQty), { target: { value: '30' } });
    expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(30);
  });

  it('keeps what the buyer already typed in preference to the document', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i')), {
      target: { value: 'Buyer-supplied title' },
    });
    fireEvent.change(screen.getByLabelText(/Estimated Budget/i), { target: { value: '999' } });
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );
    expect(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i'))).toHaveValue(
      'Buyer-supplied title'
    );
    expect(screen.getByLabelText(/Estimated Budget/i)).toHaveValue(999);
  });

  it('takes nothing from a document that names neither a title nor a budget', async () => {
    rfqClient.extractLineItemsFromDocument.mockResolvedValue(
      extractionResult({ title: '', estimatedBudget: null })
    );

    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );
    expect(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i'))).toHaveValue('');
    expect(screen.getByLabelText(/Estimated Budget/i)).toHaveValue(null);
  });

  it('shows the in-progress label while the document is being read', async () => {
    let release: (value: unknown) => void = () => {};
    rfqClient.extractLineItemsFromDocument.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() => expect(screen.getByText(MODAL.extractingAction)).toBeInTheDocument());
    expect(extractBtn()).toBeDisabled();

    release(extractionResult());
    await waitFor(() => expect(screen.getByText(MODAL.extractAction)).toBeInTheDocument());
  });

  // A failure must cost the buyer nothing they had already keyed.
  it('reports a failed extraction and leaves the keyed rows alone', async () => {
    rfqClient.extractLineItemsFromDocument.mockResolvedValue({
      success: false,
      error: 'The document could not be read.',
    });

    renderModal();
    fillRow();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('The document could not be read.')
    );
    expect(screen.getByRole('alert')).toHaveTextContent('boq.pdf');
    expect(within(firstRow()).getByLabelText(MODAL.colItem)).toHaveValue('Centrifugal Water Pump');
  });

  // A machine reason with no server message must resolve to reason-specific
  // guidance, and the failure banner must offer an explicit manual-entry action.
  it('shows reason-specific guidance and a manual-entry action on failure', async () => {
    rfqClient.extractLineItemsFromDocument.mockResolvedValue({
      success: false,
      reason: 'UNSUPPORTED_TYPE',
    });

    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.rfqExtraction.reasonMessages.UNSUPPORTED_TYPE
      )
    );

    // The recovery action clears the banner and leaves a row to key into.
    fireEvent.click(screen.getByTestId('manual-enter-fallback'));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(within(firstRow()).getByLabelText(MODAL.colItem)).toBeInTheDocument();
  });

  // Reported per document, so one unreadable file does not discard the other's rows.
  it('keeps the rows from a readable document when another fails', async () => {
    rfqClient.extractLineItemsFromDocument
      .mockResolvedValueOnce(extractionResult())
      .mockResolvedValueOnce({ success: false, error: 'Unsupported layout.' });

    renderModal();
    chooseFiles([
      new File(['x'], 'good.pdf', { type: 'application/pdf' }),
      new File(['y'], 'bad.pdf', { type: 'application/pdf' }),
    ]);
    await waitFor(() => expect(rfqClient.uploadRFQAttachment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(extractBtn()).toBeEnabled());

    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );
    expect(screen.getByText(/bad\.pdf: Unsupported layout\./)).toBeInTheDocument();
  });

  it('changes nothing when the document yields no line items', async () => {
    rfqClient.extractLineItemsFromDocument.mockResolvedValue(extractionResult({ entities: [] }));

    renderModal();
    fillRow();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() => expect(rfqClient.extractLineItemsFromDocument).toHaveBeenCalled());
    expect(within(firstRow()).getByLabelText(MODAL.colItem)).toHaveValue('Centrifugal Water Pump');
    expect(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i'))).toHaveValue('');
  });

  it('dispatches the extracted rows on save', async () => {
    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());
    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );

    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    const payload = rfqClient.createRFQ.mock.calls[0][0];
    expect(payload.extractedEntities).toHaveLength(1);
    expect(payload.extractedEntities[0].itemName).toBe('Centrifugal Water Pump 500 GPM');
  });
});

describe('ManualRFQModal: Mode 1 private vendor roster preview', () => {
  it('shows the empty-roster state and blocks dispatch when the buyer has no uploaded vendors for Version 1', async () => {
    (useApp as jest.Mock).mockReturnValue({ buyerVendors: [] });
    renderModal();

    expect(screen.getByText('No Private Vendors Uploaded Yet')).toBeInTheDocument();
    expect(screen.getByText('0 Suppliers Found')).toBeInTheDocument();

    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => {
      expect(screen.getByText(/Version 1 \(Client Sourcing\) requires at least one private vendor/i)).toBeInTheDocument();
    });
    expect(rfqClient.createRFQ).not.toHaveBeenCalled();
  });

  it('lists the buyer-uploaded vendors and dispatches strictly to them on save', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [
        {
          id: 'v-hist-1',
          name: 'Apex Industrial Dynamics',
          contactPerson: 'Rajesh Nair',
          email: 'rajesh@apex.in',
          phone: '+91 98200 11111',
          source: 'historical_purchase_dump',
          majorCategory: categoriesData[0].majorCategory,
        },
        // No name/email/phone/contactPerson: exercises every fallback.
        { id: 'v-hist-2', source: 'historical_purchase_dump', majorCategory: categoriesData[0].majorCategory },
        // Not buyer-uploaded: must be excluded from both the preview and the payload.
        { id: 'v-cm-1', name: 'Category Manager Vendor', source: 'category_manager_upload', majorCategory: categoriesData[0].majorCategory },
      ],
    });
    renderModal();

    expect(screen.getByText('2 Suppliers Found')).toBeInTheDocument();
    expect(screen.getByText(/1\. Apex Industrial Dynamics/)).toBeInTheDocument();
    expect(screen.getByText('Rajesh Nair')).toBeInTheDocument();
    expect(screen.getByText('rajesh@apex.in')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.queryByText('Category Manager Vendor')).not.toBeInTheDocument();

    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    const assignedVendors = rfqClient.createRFQ.mock.calls[0][0].assignedVendors;
    expect(assignedVendors).toEqual([
      {
        id: 'v-hist-1',
        name: 'Apex Industrial Dynamics',
        email: 'rajesh@apex.in',
        contactPerson: 'Rajesh Nair',
        phone: '+91 98200 11111',
      },
      {
        id: 'v-hist-2',
        name: 'Enterprise Vendor',
        email: null,
        contactPerson: null,
        phone: null,
      },
    ]);
  });

  it('does not attach assignedVendors when the selected mode is not Mode 1', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [{ id: 'v-hist-1', name: 'Apex Industrial Dynamics', source: 'historical_purchase_dump' }],
      activeBuyerAccount: { subscriptionPlan: 'version_3' },
    });
    renderModal();

    const mode3Checkbox = screen.getByLabelText('Version 3');
    fireEvent.click(mode3Checkbox);

    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    expect(rfqClient.createRFQ.mock.calls[0][0].assignedVendors).toEqual([]);
  });

  // Regression coverage for a real production bug: a buyer's IT-category
  // vendor was assigned to a Mechanical RFQ because this modal never
  // category-filtered assignedVendors at all — every uploaded vendor was
  // unconditionally dispatched every Mode 1 RFQ regardless of relevance.
  it('excludes an uploaded vendor whose category does not match the RFQ, rather than dispatching to it anyway', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [
        {
          id: 'v-it-1',
          name: 'IT Vendor Co',
          email: 'it@vendor.com',
          source: 'historical_purchase_dump',
          majorCategory: 'IT',
          minorCategories: ['IT'],
        },
      ],
    });
    renderModal();

    // fillRow() sets the RFQ's category to categoriesData[0] ('Civil Works'),
    // which the IT vendor above does not cover at all.
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => {
      expect(screen.getByText(/Version 1 \(Client Sourcing\) requires at least one private vendor/i)).toBeInTheDocument();
    });
    // Must NOT have silently fallen back to dispatching to the mismatched vendor.
    expect(rfqClient.createRFQ).not.toHaveBeenCalled();
  });

  describe('Mode 2 and Mode 3 category-matched vendor previews', () => {
    it('displays private approved roster and AI matching in Mode 2 and Mode 3', async () => {
      const testMajor = 'Professional Services';
      const testMinor = 'Security Service';

      (useApp as jest.Mock).mockReturnValue({
        buyerVendors: [
          { id: 'v-hist-1', name: 'Private Vendor', majorCategory: testMajor, minorCategories: [testMinor], source: 'buyer_uploaded' },
        ],
        activeBuyerAccount: { subscriptionPlan: 'version_3' },
      });
      renderModal();

      const row = screen.getAllByRole('row')[1];
      fireEvent.change(within(row).getByLabelText(MODAL.colMajor), {
        target: { value: testMajor },
      });
      fireEvent.change(within(row).getByLabelText(MODAL.colMinor), {
        target: { value: testMinor },
      });

      // Select Mode 2
      const mode2Checkbox = screen.getByLabelText('Version 2');
      fireEvent.click(mode2Checkbox); // Mode 2

      expect(screen.getByText(/Mode 2: Hybrid Sourcing Pool/i)).toBeInTheDocument();
      expect(screen.getByText('Private Vendor')).toBeInTheDocument();

      // Test AI Info button toggle in Mode 2
      const aiInfoBtn = screen.getByRole('button', { name: /ai matching info/i });
      expect(screen.queryByText(/How QUA AI Categorizes & Matches Suppliers/i)).not.toBeInTheDocument();
      fireEvent.click(aiInfoBtn);
      expect(screen.getByText(/How QUA AI Categorizes & Matches Suppliers/i)).toBeInTheDocument();
      expect(screen.getByText(/BOQ & Line-Item Classification/i)).toBeInTheDocument();

      // Select Mode 3
      const mode3Checkbox = screen.getByLabelText('Version 3');
      fireEvent.click(mode3Checkbox); // Mode 3
      expect(screen.getByText(/Mode 3: Double-Blind Autonomous Sourcing/i)).toBeInTheDocument();
      expect(screen.getByText('Private Vendor')).toBeInTheDocument();

      // Verify Mode 3 container styling
      const mode3Container = screen.getByText(/Mode 3: Double-Blind Autonomous Sourcing/i).closest('.border-indigo-200');
      expect(mode3Container).not.toBeNull();
    });
  });

  describe('ManualRFQModal: Quota exhaustion and upgrade plan', () => {
    it('shows quota exhausted warning banner and upgrade plan CTA when remaining free RFQs are 0 on free_trial', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 },
      });
      renderModal();

      expect(screen.getByTestId('manual-rfq-quota-exhausted-banner')).toBeInTheDocument();
      expect(screen.getByText(MODAL.quotaExhaustedTitle)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Please Upgrade Your Plan/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: MODAL.saveAction })).not.toBeInTheDocument();
    });

    it('does not show quota exhausted banner when user has remaining free RFQs', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 3,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 3 },
      });
      renderModal();

      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
    });

    it('does not show quota exhausted banner for paid subscription users even if remainingFreeRFQs is 0', () => {
      useApp.mockReturnValue({
        activeSubscription: 'version_1',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'version_1', remainingFreeRFQs: 0 },
      });
      renderModal();

      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
    });
  });

  describe('ManualRFQModal: Quota exhaustion and upgrade plan', () => {
    it('shows quota exhausted warning banner and upgrade plan CTA when remaining free RFQs are 0 on free_trial', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 },
      });
      renderModal();

      expect(screen.getByTestId('manual-rfq-quota-exhausted-banner')).toBeInTheDocument();
      expect(screen.getByText(MODAL.quotaExhaustedTitle)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Please Upgrade Your Plan/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: MODAL.saveAction })).not.toBeInTheDocument();
    });

    it('does not show quota exhausted banner when user has remaining free RFQs', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 3,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 3 },
      });
      renderModal();

      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
    });

    it('does not show quota exhausted banner for paid subscription users even if remainingFreeRFQs is 0', () => {
      useApp.mockReturnValue({
        activeSubscription: 'version_1',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'version_1', remainingFreeRFQs: 0 },
      });
      renderModal();

      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
    });
  });
});

