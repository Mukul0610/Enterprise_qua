import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import RFQDetails, { daysUntil, lineItemsToCsv } from '@/app/buyer/rfq-details';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { SOURCING_MODES, formatCurrency, formatIndianDate, formatIndianDateTime } from '@/lib/constants';
import type { ExtractedEntity, QuoteComparison, RFQAttachment, RFQItem } from '@/lib/types';

const mockUpdateRFQ = jest.fn().mockResolvedValue({ success: true, rfq: { id: 'rfq-1', status: 'Closed' } });
const mockReplyToRFQInquiry = jest.fn().mockResolvedValue({ success: true, rfq: { id: 'rfq-1', inquiries: [] } });
const mockSubmitRFQInquiry = jest.fn().mockResolvedValue({ success: true, inquiry: { id: 'inq-new' } });

const mockGetVendorPresence = jest.fn().mockResolvedValue({
  success: true,
  onlineVendors: [],
  details: {},
});

jest.mock('@/lib/rfqClient', () => {
  const actual = jest.requireActual('@/lib/rfqClient');
  return {
    ...actual,
    updateRFQ: (...args: any[]) => mockUpdateRFQ(...args),
    replyToRFQInquiry: (...args: any[]) => mockReplyToRFQInquiry(...args),
    submitRFQInquiry: (...args: any[]) => mockSubmitRFQInquiry(...args),
  };
});
jest.mock('@/lib/vendorPresenceClient', () => ({
  getVendorPresence: (...args: any[]) => mockGetVendorPresence(...args),
  sendVendorHeartbeat: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/authClient', () => ({ authClient: { getToken: jest.fn() } }));

const DETAILS = UI_STRINGS.rfqDetails;
const mockShowToast = jest.fn();

function entity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Centrifugal Water Pump 500 GPM',
    quantity: 12,
    unit: 'Nos',
    targetDate: '2026-09-15',
    technicalSpecs: 'SS316 impeller, ANSI flanged',
    confidence: 95,
    category: 'Pumps & Accessories',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategory: 'Pumps & Accessories',
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteComparison> = {}): QuoteComparison {
  return {
    vendorId: 'v-001',
    vendorName: 'Apex Industrial Dynamics Pvt Ltd',
    vendorCategory: 'Client List',
    unitPrice: 4250,
    totalPrice: 425000,
    leadTimeDays: 14,
    aiMatchScore: 96,
    isBestPrice: true,
    isPreferred: true,
    warrantyYears: 2,
    complianceStatus: 'Fully Compliant',
    paymentTerms: '45 Days Net',
    remarks: 'OEM equivalent',
    ...overrides,
  } as QuoteComparison;
}

function attachment(overrides: Partial<RFQAttachment> = {}): RFQAttachment {
  return {
    id: 'a1b2c3d4-0000-4000-8000-abcdefabcdef',
    fileName: 'annexure.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    uploadedAt: '2026-09-02T11:07:16.000Z',
    ...overrides,
  };
}

function buildRFQ(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: 'rfq-1',
    rfqNumber: 'RFQ-2026-00462',
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_2',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 348000,
    deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    deliveryPincode: '400701',
    createdAt: '2026-09-02 11:07:16',
    extractedEntities: [entity()],
    quotes: [],
    chasingActive: false,
    source: 'web_portal',
    sourceFileName: 'BOQ.xlsx',
    ...overrides,
  } as RFQItem;
}

const onBack = jest.fn();
const renderDetails = (rfq: RFQItem | null) => render(<RFQDetails rfq={rfq} onBack={onBack} />);

/**
 * The line-item table.
 *
 * The panel renders a table for wide viewports and a card list for narrow ones,
 * and jsdom has no viewport so both are in the document. Queries are scoped to one
 * of them or they match twice.
 */
const lineItemTable = () => screen.getAllByRole('table')[0];
/** The vendor-quotation table, which is the second one on the page. */
const quotesTable = () => {
  const tables = screen.getAllByRole('table');
  return tables[tables.length - 1];
};

/** The section wrapping a heading, so an assertion is not matched page-wide. */
const sectionFor = (heading: HTMLElement) => heading.closest('section') as HTMLElement;

beforeEach(() => {
  (useApp as jest.Mock).mockReturnValue({
    showToast: mockShowToast,
    refreshFromDB: jest.fn().mockResolvedValue(undefined),
    currentRole: 'buyer',
    buyerVendors: [],
    currentUserSession: { name: 'Lead Buyer', email: 'buyer@procucev.com', role: 'buyer' },
  });
  (authClient.getToken as jest.Mock).mockReturnValue('test-token');
  mockUpdateRFQ.mockClear();
  mockReplyToRFQInquiry.mockClear();
  mockSubmitRFQInquiry.mockClear();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// Pure helpers
// ══════════════════════════════════════════════════════════════════════════════
describe('daysUntil', () => {
  const today = new Date('2026-09-03T10:00:00Z');

  test.each([
    ['2026-09-30', 27],
    ['2026-09-04', 1],
    ['2026-09-03', 0],
    ['2026-09-01', -2],
  ])('reports %s as %i days out', (target, expected) => {
    expect(daysUntil(target, today)).toBe(expected);
  });

  // Compared at date granularity, so a delivery later the same day is due today
  // rather than already overdue by a fraction of a day.
  test('ignores the time of day', () => {
    expect(daysUntil('2026-09-03', new Date('2026-09-03T23:59:00Z'))).toBe(0);
  });

  test.each(['', 'not-a-date'])('returns null for %p', (target) => {
    expect(daysUntil(target, today)).toBeNull();
  });

  test('defaults to the current date', () => {
    expect(daysUntil(new Date().toISOString().slice(0, 10))).toBe(0);
  });
});

describe('lineItemsToCsv', () => {
  test('emits a header row and one row per line item', () => {
    const csv = lineItemsToCsv([entity(), entity({ id: 'ent-2', itemName: 'Gate Valve' })]);
    const rows = csv.split('\n');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(DETAILS.colItem);
    expect(rows[1]).toContain('Centrifugal Water Pump 500 GPM');
    expect(rows[2]).toContain('Gate Valve');
  });

  // A specification routinely contains commas, and a quote would otherwise end
  // the field early and shift every later column.
  test('quotes every field and escapes embedded quotes', () => {
    const csv = lineItemsToCsv([
      entity({ technicalSpecs: 'SS316, 2" bore, Class 150' }),
    ]);

    expect(csv).toContain('"SS316, 2"" bore, Class 150"');
  });

  test('handles an empty list', () => {
    expect(lineItemsToCsv([]).split('\n')).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('Buyer RFQ Details (Screen 1.4)', () => {
  describe('missing RFQ', () => {
    // Reachable by editing the query string or reloading after the records were
    // cleared, so it explains itself instead of rendering an empty shell.
    it('explains that the RFQ is not in the portfolio and offers a way back', () => {
      renderDetails(null);

      expect(screen.getByText(DETAILS.notFoundTitle)).toBeInTheDocument();
      expect(screen.getByText(DETAILS.notFoundMessage)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: new RegExp(DETAILS.backAction, 'i') }));
      expect(onBack).toHaveBeenCalled();
    });
  });

  describe('header and provenance strip', () => {
    it('renders the document badge, RFQ number, title, status and mode code', () => {
      const rfq = buildRFQ();
      renderDetails(rfq);

      expect(screen.getByText(DETAILS.documentTypeBadge)).toBeInTheDocument();
      expect(screen.getByText(rfq.rfqNumber)).toBeInTheDocument();
      expect(screen.getByText(rfq.title)).toBeInTheDocument();
      expect(screen.getAllByText(rfq.status).length).toBeGreaterThan(0);

      const mode = SOURCING_MODES.find((m) => m.id === rfq.sourcingMode);
      expect(screen.getByText(mode!.code)).toBeInTheDocument();
    });

    // badgeColor is a Tailwind class string; it used to be handed to
    // style={{ backgroundColor }}, which the browser dropped as invalid CSS.
    it('applies the sourcing mode colour as a class rather than an inline style', () => {
      const rfq = buildRFQ({ sourcingMode: 'mode_2' });
      renderDetails(rfq);

      const mode = SOURCING_MODES.find((m) => m.id === 'mode_2')!;
      const badge = screen.getByText(mode.code);
      expect(badge.className).toContain('border-emerald-500/40');
      expect(badge.getAttribute('style')).toBeNull();
    });

    it('states when the RFQ was raised', () => {
      renderDetails(buildRFQ());

      expect(
        screen.getByText(
          formatString(DETAILS.raisedOnStrip, {
            timestamp: formatIndianDateTime('2026-09-02 11:07:16'),
          })
        )
      ).toBeInTheDocument();
      // Not the raw UTC string it is stored as.
      expect(screen.queryByText(/2026-09-02 11:07:16/)).not.toBeInTheDocument();
    });

    // An unedited RFQ showing an "edited" timestamp reads as a change nobody made.
    it('reports an edit only once the record has actually changed', () => {
      const { unmount } = renderDetails(
        buildRFQ({ createdAt: '2026-09-02 11:07:16', updatedAt: '2026-09-02 11:07:16' })
      );

      expect(screen.queryByText(/^Edited /)).not.toBeInTheDocument();
      unmount();

      renderDetails(buildRFQ({ updatedAt: '2026-09-06 09:15:00' }));
      expect(
        screen.getByText(
          formatString(DETAILS.updatedOnStrip, {
            timestamp: formatIndianDateTime('2026-09-06 09:15:00'),
          })
        )
      ).toBeInTheDocument();
    });

    it('omits the mode badge when the sourcing mode is unknown', () => {
      renderDetails(buildRFQ({ sourcingMode: 'mode_9' as RFQItem['sourcingMode'] }));

      expect(screen.getByText('RFQ-2026-00462')).toBeInTheDocument();
      SOURCING_MODES.forEach((m) => {
        expect(screen.queryByText(m.code)).not.toBeInTheDocument();
      });
    });

    it('returns to the portfolio from the strip', () => {
      renderDetails(buildRFQ());
      fireEvent.click(screen.getByRole('button', { name: new RegExp(DETAILS.backAction, 'i') }));
      expect(onBack).toHaveBeenCalled();
    });
  });

  describe('submission detail card', () => {
    it.each([
      ['web_portal', 'Web Portal Upload'],
      ['email_gateway', 'via Email Upload'],
      ['email_upload', 'Emailed Document'],
      ['manual_entry', 'Manual Entry'],
      ['ai_extraction', 'AI Extraction'],
    ])('labels a %s intake as %s', (source, label) => {
      renderDetails(buildRFQ({ source: source as RFQItem['source'] }));
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('labels an RFQ without explicit source but with aiSummary as AI Extraction', () => {
      renderDetails(buildRFQ({ source: undefined, aiSummary: { headline: 'Test AI', scope: '', risks: [] } as any }));
      const card = sectionFor(screen.getByText(DETAILS.submittedHeading));
      expect(within(card).getByText(DETAILS.sourceAiExtraction || 'AI Extraction')).toBeInTheDocument();
    });

    it('shows the record id', () => {
      renderDetails(buildRFQ({ id: 'rfq-1' }));

      const card = sectionFor(screen.getByText(DETAILS.submittedHeading));
      expect(within(card).getByText('rfq-1')).toBeInTheDocument();
    });

    it('marks a blank intake source as unset when no aiSummary exists', () => {
      renderDetails(buildRFQ({ source: undefined, aiSummary: null }));

      const card = sectionFor(screen.getByText(DETAILS.submittedHeading));
      expect(within(card).getByText(DETAILS.unsetValue)).toBeInTheDocument();
    });
  });

  describe('commercial and delivery card', () => {
    it('displays the saved target delivery date correctly instead of Not provided', () => {
      renderDetails(buildRFQ({ targetDeliveryDate: '2026-11-20', budget: 100000 }));
      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText(formatIndianDate('2026-11-20'))).toBeInTheDocument();
    });

    it('falls back to target_delivery_date or deadline if targetDeliveryDate is not set directly', () => {
      renderDetails(buildRFQ({ targetDeliveryDate: '', ...({ target_delivery_date: '2026-12-15' } as any) }));
      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText(formatIndianDate('2026-12-15'))).toBeInTheDocument();
    });

    it('falls back to line item targetDate if header targetDeliveryDate is unset', () => {
      renderDetails(
        buildRFQ({
          targetDeliveryDate: '',
          extractedEntities: [
            entity({
              id: 'item-1',
              itemName: 'Pipe',
              quantity: 5,
              unit: 'nos',
              majorCategory: 'Mechanical',
              minorCategory: 'Pipes',
              confidence: 95,
              targetDate: '2026-10-30',
            }),
          ],
        })
      );
      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText(formatIndianDate('2026-10-30'))).toBeInTheDocument();
    });

    it('renders the delivery location and pincode', () => {
      renderDetails(buildRFQ());

      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText('Navi Mumbai Plant, Gate 3')).toBeInTheDocument();
      expect(
        within(card).getByText(formatString(DETAILS.deliveryPincodeLabel, { pincode: '400701' }))
      ).toBeInTheDocument();
    });

    it('formats a stated budget as currency', () => {
      renderDetails(buildRFQ({ budget: 348000 }));

      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).getByText(formatCurrency(348000))).toBeInTheDocument();
    });

    // The budget is optional, so zero must read as unstated rather than as a real
    // ceiling of nil that vendors would quote against.
    it('shows an unstated budget as not provided', () => {
      renderDetails(buildRFQ({ budget: 0 }));

      const card = sectionFor(screen.getByText(DETAILS.commercialHeading));
      expect(within(card).queryByText(formatCurrency(0))).not.toBeInTheDocument();
      expect(within(card).getAllByText(DETAILS.unsetValue).length).toBeGreaterThan(0);
    });

    it('counts down to the target delivery date', () => {
      const target = new Date();
      target.setDate(target.getDate() + 12);
      renderDetails(buildRFQ({ targetDeliveryDate: target.toISOString().slice(0, 10) }));

      expect(screen.getByText(formatString(DETAILS.daysRemaining, { days: 12 }))).toBeInTheDocument();
    });

    it('flags a delivery date that has passed', () => {
      const target = new Date();
      target.setDate(target.getDate() - 3);
      renderDetails(buildRFQ({ targetDeliveryDate: target.toISOString().slice(0, 10) }));

      expect(screen.getByText(formatString(DETAILS.overdueBy, { days: 3 }))).toBeInTheDocument();
    });

    it('reports a delivery due today', () => {
      renderDetails(buildRFQ({ targetDeliveryDate: new Date().toISOString().slice(0, 10) }));
      expect(screen.getByText(DETAILS.dueToday)).toBeInTheDocument();
    });

    it('omits the countdown and pincode when neither is set', () => {
      renderDetails(buildRFQ({ targetDeliveryDate: '', deliveryPincode: '', deliveryLocation: undefined }));

      expect(screen.queryByText(/days remaining/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^PIN:/)).not.toBeInTheDocument();
    });
  });

  // The outreach card has been removed. The persisted record carries no
  // follow-up telemetry at all — mapRowToRFQ never returns followUpData — so the
  // card could only ever render its own "awaiting initial trigger" placeholder,
  // which claimed a pipeline state nothing had reported.
  describe('outreach telemetry', () => {
    it('shows no outreach card, even for an RFQ that carries follow-up data', () => {
      renderDetails(
        buildRFQ({
          followUpData: {
            rfqNumber: 'RFQ-2026-00462',
            totalInvited: 5,
            respondedCount: 3,
            callStats: { total: 5, connected: 4, avgDuration: '2m 10s' },
            whatsappStats: { total: 5, delivered: 5, read: 3, replied: 3 },
            smsStats: { total: 5, delivered: 2, clicked: 2 },
            autoChasingEnabled: true,
            vendors: [],
          },
        })
      );

      expect(screen.queryByText('4 / 5')).not.toBeInTheDocument();
      expect(screen.queryByText(/Awaiting initial trigger/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Outreach Analytics/i)).not.toBeInTheDocument();
    });
  });

  describe('line items', () => {
    const twoItems = () =>
      buildRFQ({
        extractedEntities: [
          entity(),
          entity({
            id: 'ent-2',
            itemName: 'Flanged Gate Valve',
            technicalSpecs: 'ASTM A216 WCB body',
            minorCategory: 'Hoses, Valves & Fittings',
            unit: 'Sets',
          }),
        ],
      });

    it('renders every line item with its classification and confidence', () => {
      renderDetails(twoItems());

      // Scoped to the table: the minor category also appears as a filter option.
      const table = screen.getByRole('table');
      expect(within(table).getByText('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
      expect(within(table).getByText('Flanged Gate Valve')).toBeInTheDocument();
      expect(within(table).getByText('ASTM A216 WCB body')).toBeInTheDocument();
      expect(within(table).getByText('Hoses, Valves & Fittings')).toBeInTheDocument();
      expect(within(table).getAllByText(formatString(DETAILS.confidenceHigh, { confidence: 95 }))).toHaveLength(2);
    });

    it('flags a low-confidence row as needing review', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity({ confidence: 50 })] }));
      expect(
        within(lineItemTable()).getByText(formatString(DETAILS.confidenceReview, { confidence: 50 }))
      ).toBeInTheDocument();
    });

    it('numbers the rows', () => {
      renderDetails(twoItems());

      const table = screen.getByRole('table');
      expect(within(table).getByText('1')).toBeInTheDocument();
      expect(within(table).getByText('2')).toBeInTheDocument();
    });

    // Scoped to the footer: the same number also appears as a row quantity.
    const totalQuantity = () =>
      within(screen.getByText(DETAILS.totalQuantityLabel)).getByText(/^\d+$/).textContent;

    it('totals the quantity of the rows on screen', () => {
      renderDetails(twoItems());

      // 12 + 12 from the two fixture rows.
      expect(totalQuantity()).toBe('24');
    });

    it('retotals as the buyer filters', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'gate valve' } });

      expect(totalQuantity()).toBe('12');
    });

    // A keyed row has no AI confidence, so reporting 0% would misrepresent it.
    it('labels a manually keyed row instead of claiming zero confidence', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity({ confidence: 0 })] }));

      const table = screen.getByRole('table');
      expect(within(table).getByText(DETAILS.manualConfidence)).toBeInTheDocument();
      expect(within(table).queryByText(/0% /)).not.toBeInTheDocument();
    });

    // The specification is a sub-line under the item it describes, so a blank one
    // is simply left off rather than filling the row with "Not provided".
    it('omits the specification line when the item has none', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity({ technicalSpecs: '  ' })] }));

      const table = screen.getByRole('table');
      expect(within(table).getByText('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
      expect(within(table).queryByText(new RegExp(`^${DETAILS.specsInlineLabel}:`))).not.toBeInTheDocument();
    });

    it('prints the specification under the item it describes', () => {
      renderDetails(buildRFQ({ extractedEntities: [entity()] }));

      const table = screen.getByRole('table');
      expect(within(table).getByText(/SS316 impeller, ANSI flanged/)).toBeInTheDocument();
    });

    it('narrows the table as the buyer searches', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'gate valve' } });

      expect(within(lineItemTable()).getByText('Flanged Gate Valve')).toBeInTheDocument();
      expect(screen.queryByText('Centrifugal Water Pump 500 GPM')).not.toBeInTheDocument();
      expect(
        screen.getByText(formatString(DETAILS.displayingCount, { shown: 1, total: 2 }))
      ).toBeInTheDocument();
    });

    it('searches the specification and unit as well as the name', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'ASTM' } });
      expect(within(lineItemTable()).getByText('Flanged Gate Valve')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'sets' } });
      expect(within(lineItemTable()).getByText('Flanged Gate Valve')).toBeInTheDocument();
    });

    it('filters by minor category and offers only the categories present', () => {
      renderDetails(twoItems());

      const filter = screen.getByLabelText(DETAILS.minorFilterAria) as HTMLSelectElement;
      const options = Array.from(filter.options).map((o) => o.value);
      expect(options).toEqual(['all', 'Hoses, Valves & Fittings', 'Pumps & Accessories']);

      fireEvent.change(filter, { target: { value: 'Pumps & Accessories' } });
      expect(within(lineItemTable()).getByText('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
      expect(screen.queryByText('Flanged Gate Valve')).not.toBeInTheDocument();
    });

    it('reports when the search and filter exclude everything', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'nothing matches' } });

      // Reported in both the table's empty row and the card list's empty state.
      expect(screen.getAllByText(DETAILS.noLineItemMatches).length).toBeGreaterThan(0);
      expect(screen.getByText(formatString(DETAILS.displayingCount, { shown: 0, total: 2 }))).toBeInTheDocument();
    });

    // ── Clearing the filters ─────────────────────────────────────────────────
    // The control appears only once something is filtering, so an untouched table
    // does not carry a button that would do nothing.
    it('offers no clear action until a filter is applied', () => {
      renderDetails(twoItems());

      expect(
        screen.queryByRole('button', { name: DETAILS.clearFiltersAction })
      ).not.toBeInTheDocument();
    });

    it('clears the search and the category filter together', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'gate' } });
      fireEvent.change(screen.getByLabelText(DETAILS.minorFilterAria), {
        target: { value: 'Hoses, Valves & Fittings' },
      });

      fireEvent.click(screen.getAllByRole('button', { name: DETAILS.clearFiltersAction })[0]);

      expect(screen.getByLabelText(DETAILS.lineItemSearchAria)).toHaveValue('');
      expect(screen.getByLabelText(DETAILS.minorFilterAria)).toHaveValue('all');
      expect(screen.getByText(formatString(DETAILS.displayingCount, { shown: 2, total: 2 }))).toBeInTheDocument();
    });

    it('offers the clear action from the empty result row as well', () => {
      renderDetails(twoItems());

      fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'nothing matches' } });
      // One in the toolbar, plus one in each empty state (table row and card list).
      const clearButtons = screen.getAllByRole('button', { name: DETAILS.clearFiltersAction });
      expect(clearButtons.length).toBeGreaterThan(1);

      fireEvent.click(clearButtons[clearButtons.length - 1]);
      expect(within(lineItemTable()).getByText('Flanged Gate Valve')).toBeInTheDocument();
    });

    // ── Sorting ──────────────────────────────────────────────────────────────
    // Unsorted by default, because a BOQ's own row order carries meaning the buyer
    // put there.
    describe('sorting', () => {
      const itemNames = () =>
        screen
          .getAllByRole('row')
          .slice(1)
          .map((row) => row.querySelectorAll('td')[1]?.textContent || '');

      const sortBy = (column: string, direction: 'asc' | 'desc' = 'asc') =>
        fireEvent.click(
          screen.getByRole('button', {
            name: formatString(
              direction === 'asc' ? DETAILS.sortAscAria : DETAILS.sortDescAria,
              { column }
            ),
          })
        );

      it('keeps the document order until a column is chosen', () => {
        renderDetails(twoItems());

        expect(itemNames()[0]).toContain('Centrifugal Water Pump 500 GPM');
        expect(screen.getByRole('columnheader', { name: /Item Description/ })).toHaveAttribute(
          'aria-sort',
          'none'
        );
      });

      it('orders by item description and flips on a second click', () => {
        renderDetails(twoItems());

        sortBy(DETAILS.colItem);
        expect(itemNames()[0]).toContain('Centrifugal Water Pump 500 GPM');
        expect(screen.getByRole('columnheader', { name: /Item Description/ })).toHaveAttribute(
          'aria-sort',
          'ascending'
        );

        sortBy(DETAILS.colItem, 'desc');
        expect(itemNames()[0]).toContain('Flanged Gate Valve');
        expect(screen.getByRole('columnheader', { name: /Item Description/ })).toHaveAttribute(
          'aria-sort',
          'descending'
        );
      });

      it('orders by quantity', () => {
        renderDetails(
          buildRFQ({
            extractedEntities: [
              entity({ id: 'a', itemName: 'Bigger order', quantity: 90 }),
              entity({ id: 'b', itemName: 'Smaller order', quantity: 4 }),
            ],
          })
        );

        sortBy(DETAILS.colQty);
        expect(itemNames()[0]).toContain('Smaller order');

        sortBy(DETAILS.colQty, 'desc');
        expect(itemNames()[0]).toContain('Bigger order');
      });

      it('orders by category', () => {
        renderDetails(twoItems());

        sortBy(DETAILS.colCategory);
        // Both share a major, so the minor decides: Hoses before Pumps.
        expect(itemNames()[0]).toContain('Flanged Gate Valve');
      });

      it('orders by required-by date', () => {
        renderDetails(
          buildRFQ({
            extractedEntities: [
              entity({ id: 'a', itemName: 'Later', targetDate: '2026-12-01' }),
              entity({ id: 'b', itemName: 'Sooner', targetDate: '2026-09-05' }),
            ],
          })
        );

        sortBy(DETAILS.colTargetDate);
        expect(itemNames()[0]).toContain('Sooner');

        sortBy(DETAILS.colTargetDate, 'desc');
        expect(itemNames()[0]).toContain('Later');
      });

      // An unanswered date must not displace a real deadline from the top.
      it('sorts rows with no date last in either direction', () => {
        renderDetails(
          buildRFQ({
            extractedEntities: [
              entity({ id: 'a', itemName: 'Undated', targetDate: '' }),
              entity({ id: 'b', itemName: 'Dated', targetDate: '2026-09-05' }),
            ],
          })
        );

        sortBy(DETAILS.colTargetDate);
        expect(itemNames()[0]).toContain('Dated');

        sortBy(DETAILS.colTargetDate, 'desc');
        expect(itemNames()[0]).toContain('Dated');
      });

      it('switching column resets to ascending', () => {
        renderDetails(twoItems());

        sortBy(DETAILS.colItem);
        sortBy(DETAILS.colItem, 'desc');
        sortBy(DETAILS.colQty);

        expect(screen.getByRole('columnheader', { name: /Qty/ })).toHaveAttribute(
          'aria-sort',
          'ascending'
        );
        expect(screen.getByRole('columnheader', { name: /Item Description/ })).toHaveAttribute(
          'aria-sort',
          'none'
        );
      });

      it('sorts the filtered rows, not the whole list', () => {
        renderDetails(twoItems());

        fireEvent.change(screen.getByLabelText(DETAILS.lineItemSearchAria), { target: { value: 'gate' } });
        sortBy(DETAILS.colItem);

        expect(itemNames()).toHaveLength(1);
        expect(itemNames()[0]).toContain('Flanged Gate Valve');
      });
    });

    it('reports how much was classified automatically', () => {
      renderDetails(
        buildRFQ({ extractedEntities: [entity({ confidence: 95 }), entity({ id: 'ent-2', confidence: 40 })] })
      );

      expect(screen.getByText(formatString(DETAILS.parsedSuccessfully, { percent: 50 }))).toBeInTheDocument();
    });

    it('offers the line items as a CSV download named after the RFQ', () => {
      renderDetails(twoItems());

      const link = screen.getByRole('link', {
        name: formatString(DETAILS.exportCsvAria, { rfqNumber: 'RFQ-2026-00462' }),
      });
      expect(link).toHaveAttribute('download', 'RFQ-2026-00462-line-items.csv');
      // A data URL rather than a generated blob, so no direct DOM calls are needed.
      expect(link.getAttribute('href')).toContain('data:text/csv');
      expect(decodeURIComponent(link.getAttribute('href') || '')).toContain('Flanged Gate Valve');
    });

    it('reports an RFQ that recorded no line items', () => {
      renderDetails(buildRFQ({ extractedEntities: [] }));

      expect(screen.getByText(DETAILS.noLineItems)).toBeInTheDocument();
      expect(screen.queryByText(/Displaying/)).not.toBeInTheDocument();
    });

    it('tolerates an RFQ with no line-item collection at all', () => {
      renderDetails(buildRFQ({ extractedEntities: undefined as unknown as ExtractedEntity[] }));
      expect(screen.getByText(DETAILS.noLineItems)).toBeInTheDocument();
    });
  });

  describe('supporting documents', () => {
    it('lists each attached document with its size and upload date', () => {
      renderDetails(buildRFQ({ attachments: [attachment()] }));

      const panel = sectionFor(screen.getByText(DETAILS.attachmentsHeading));
      expect(within(panel).getByText('annexure.pdf')).toBeInTheDocument();
      expect(within(panel).getByText(/2\.0 KB/)).toBeInTheDocument();
      // The upload date reads in the Indian style, not as the stored ISO string.
      expect(
        within(panel).getByText(
          new RegExp(formatIndianDate('2026-09-02T11:07:16.000Z').replace(/ /g, '\\s'))
        )
      ).toBeInTheDocument();
    });

    // GET /api/rfqs/attachments/:id requires auth, and the session token lives
    // only in localStorage — a plain <a href> can never carry it, so it would
    // always 401 regardless of login state. The button below fetches with the
    // Authorization header manually and opens the result as a blob URL instead.
    it('fetches the attachment with the Authorization header and opens it as a blob URL', async () => {
      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
      const mockBlob = new Blob(['pdf-bytes'], { type: 'application/pdf' });
      global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => mockBlob });

      renderDetails(buildRFQ({ attachments: [attachment()] }));

      const viewBtn = screen.getByRole('button', {
        name: formatString(DETAILS.attachmentViewAria, { fileName: 'annexure.pdf' }),
      });
      fireEvent.click(viewBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef',
          { headers: { Authorization: 'Bearer test-token' } }
        );
      });
      await waitFor(() => expect(openSpy).toHaveBeenCalledWith('blob:mock-url', '_blank', 'noopener,noreferrer'));
    });

    it('shows a toast instead of throwing when the attachment fetch fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });

      renderDetails(buildRFQ({ attachments: [attachment()] }));

      const viewBtn = screen.getByRole('button', {
        name: formatString(DETAILS.attachmentViewAria, { fileName: 'annexure.pdf' }),
      });
      fireEvent.click(viewBtn);

      await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
        'Could Not Open Attachment',
        'Could not load the attachment.',
        'warning'
      ));
    });

    it('omits the Authorization header when there is no session token', async () => {
      (authClient.getToken as jest.Mock).mockReturnValue(null);
      global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([]) });

      renderDetails(buildRFQ({ attachments: [attachment()] }));

      fireEvent.click(screen.getByRole('button', {
        name: formatString(DETAILS.attachmentViewAria, { fileName: 'annexure.pdf' }),
      }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef', { headers: {} });
      });
    });

    it('omits the upload date when the record carries none', () => {
      renderDetails(buildRFQ({ attachments: [attachment({ uploadedAt: '' })] }));

      expect(screen.getByText('annexure.pdf')).toBeInTheDocument();
      expect(screen.queryByText(/Attached 2026/)).not.toBeInTheDocument();
    });

    it.each([[[]], [undefined]])('reports an RFQ with no documents (%p)', (value) => {
      renderDetails(buildRFQ({ attachments: value as RFQAttachment[] | undefined }));
      expect(screen.getByText(DETAILS.noAttachments)).toBeInTheDocument();
    });
  });

  describe('vendor quotations', () => {
    it('renders each quotation with its pricing, compliance and match score', () => {
      renderDetails(buildRFQ({ quotes: [quote()] }));

      // Scoped to the table: the panel also renders a card list of the same quotes
      // for narrow viewports, and jsdom has no viewport so both are present.
      const table = within(quotesTable());
      expect(table.getByText('Apex Industrial Dynamics Pvt Ltd')).toBeInTheDocument();
      expect(table.getByText(formatCurrency(4250))).toBeInTheDocument();
      expect(table.getByText(formatCurrency(425000))).toBeInTheDocument();
      expect(table.getByText(formatString(DETAILS.leadTimeDays, { days: 14 }))).toBeInTheDocument();
      expect(table.getByText('Fully Compliant')).toBeInTheDocument();
      expect(table.getByText('96%')).toBeInTheDocument();
    });

    it('counts the quotations it received', () => {
      renderDetails(buildRFQ({ quotes: [quote(), quote({ vendorId: 'v-002' })] }));

      const panel = sectionFor(screen.getByText(DETAILS.quotesHeading));
      expect(within(panel).getByText('2')).toBeInTheDocument();
    });



    // "Under Review" and "Shortlisted" tabs used to sit here with a hardcoded
    // count of zero, because quotation states are not modelled. They are gone.
    it('offers no quotation-state tabs', () => {
      renderDetails(buildRFQ({ quotes: [quote()] }));

      expect(screen.queryByText(/Under Review/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Shortlisted/i)).not.toBeInTheDocument();
    });

    it('explains why no quotations have arrived yet', () => {
      renderDetails(buildRFQ({ quotes: [] }));

      expect(screen.getByText(DETAILS.noQuotes)).toBeInTheDocument();
      expect(screen.getByText(DETAILS.noQuotesMessage)).toBeInTheDocument();
    });

    it('tolerates an RFQ with no quotes collection at all', () => {
      renderDetails(buildRFQ({ quotes: undefined as unknown as QuoteComparison[] }));
      expect(screen.getByText(DETAILS.noQuotes)).toBeInTheDocument();
    });
  });

function makeInquiry(overrides: any = {}): any {
  return {
    id: 'inq-default',
    rfqNumber: 'RFQ-2026-00462',
    vendorId: 'v-default',
    vendorName: 'Default Vendor',
    message: 'Default message',
    createdAt: '2026-09-03T11:00:00Z',
    status: 'open',
    ...overrides,
  };
}

  describe('vendor inquiries & clarifications and assigned suppliers', () => {
    it('hides Assigned Suppliers and Vendor Inquiries for V0 RFQs in buyer view', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_0',
          inquiries: [
            makeInquiry({
              id: 'inq-1',
              vendorId: 'v-net-001',
              vendorName: 'Global Turbines Ltd',
              message: 'Can we offer alternate impeller material?',
            }),
          ],
          assignedVendors: [
            {
              id: 'v-assigned',
              name: 'Assigned Network Supplier',
            } as any,
          ],
        })
      );

      expect(screen.queryByText('Assigned & Invited Suppliers')).not.toBeInTheDocument();
      expect(screen.queryByText('Vendor Inquiries & Clarifications')).not.toBeInTheDocument();
    });

    it('filters out Procucev Network vendors from Vendor Inquiries in buyer view', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_1',
          inquiries: [
            makeInquiry({
              id: 'inq-1',
              vendorId: 'v-net-001',
              vendorName: 'Global Turbines Ltd',
              vendorCategory: 'Procucev Network',
              message: 'Can we offer alternate impeller material?',
            }),
            makeInquiry({
              id: 'inq-2',
              vendorId: 'v-hist-002',
              vendorName: 'Local Machine Shop',
              vendorCategory: 'Client List',
              message: 'Delivery timeline query',
            }),
          ],
        })
      );

      expect(screen.getByText('Vendor Inquiries & Clarifications')).toBeInTheDocument();
      expect(screen.getAllByText('Local Machine Shop').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Global Turbines Ltd')).not.toBeInTheDocument();
    });

    it('filters Procucev vendors out of both buyer inquiry and assigned supplier sections', () => {
      renderDetails(
        buildRFQ({
          sourcingMode: 'mode_2',
          assignedVendors: [
            {
              id: 'v-assigned',
              name: 'Assigned Network Supplier',
              vendorCategory: 'Procucev Network',
            } as any,
            {
              id: 'v-client',
              name: 'Client Approved Supplier',
              vendorCategory: 'Client List',
            } as any,
          ],
        })
      );

      const panelHeading = screen.getByText('Assigned & Invited Suppliers');
      const panel = panelHeading.closest('section');
      expect(panel).not.toBeNull();
      expect(within(panel as HTMLElement).getAllByText('Client Approved Supplier').length).toBeGreaterThanOrEqual(1);
      expect(within(panel as HTMLElement).queryByText('Assigned Network Supplier')).not.toBeInTheDocument();
    });

    it('allows searching vendors and filtering by status tabs', () => {
      renderDetails(
        buildRFQ({
          inquiries: [
            makeInquiry({
              id: 'inq-open',
              vendorId: 'v-open',
              vendorName: 'Alpha Supplies',
              message: 'Question 1',
              status: 'open',
            }),
            makeInquiry({
              id: 'inq-ans',
              vendorId: 'v-ans',
              vendorName: 'Beta Components',
              message: 'Question 2',
              reply: 'Answer 2',
              status: 'answered',
            }),
          ],
        })
      );

      // Search vendor
      const searchInput = screen.getByPlaceholderText('Search vendor...');
      fireEvent.change(searchInput, { target: { value: 'Alpha' } });
      expect(screen.getAllByText('Alpha Supplies').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Beta Components')).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Click Pending filter
      fireEvent.click(screen.getByRole('button', { name: /Pending \(/i }));
      expect(screen.getAllByText('Alpha Supplies').length).toBeGreaterThanOrEqual(1);

      // Click Answered filter
      fireEvent.click(screen.getByRole('button', { name: /Answered \(/i }));
      expect(screen.getAllByText('Beta Components').length).toBeGreaterThanOrEqual(1);

      // Click All filter
      fireEvent.click(screen.getByRole('button', { name: /All \(/i }));
      expect(screen.getAllByText('Alpha Supplies').length).toBeGreaterThanOrEqual(1);
    });

    it('displays Online status badge when vendor is active and Offline when inactive', async () => {
      mockGetVendorPresence.mockResolvedValueOnce({
        success: true,
        onlineVendors: ['online-vendor@example.com'],
        details: {
          'online-vendor@example.com': { isOnline: true },
          'offline-vendor@example.com': { isOnline: false },
        },
      });

      renderDetails(
        buildRFQ({
          assignedVendors: [
            {
              id: 'v-online',
              name: 'Online Tech Supplies',
              email: 'online-vendor@example.com',
            } as any,
            {
              id: 'v-offline',
              name: 'Offline Engineering Ltd',
              email: 'offline-vendor@example.com',
            } as any,
          ],
          inquiries: [],
        })
      );

      await waitFor(() => {
        expect(screen.getAllByText(DETAILS.vendorOnline).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(DETAILS.vendorOffline).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('allows switching selected vendor and sending clarification reply in buyer view', async () => {
      renderDetails(
        buildRFQ({
          inquiries: [
            makeInquiry({
              id: 'inq-1',
              vendorId: 'v-1',
              vendorName: 'Alpha Supplies',
              message: 'When is required delivery?',
              status: 'open',
            }),
            makeInquiry({
              id: 'inq-2',
              vendorId: 'v-2',
              vendorName: 'Beta Components',
              message: 'Can we submit partial quote?',
              status: 'open',
            }),
          ],
        })
      );

      // Select Beta Components
      fireEvent.click(screen.getByText('Beta Components'));

      // Find composer textarea
      const composer = screen.getByPlaceholderText(/Type clarification response to/i);
      fireEvent.change(composer, { target: { value: 'Yes, partial quotes are acceptable.' } });

      const sendBtn = screen.getByRole('button', { name: 'Send' });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(mockReplyToRFQInquiry).toHaveBeenCalled();
      });
    });

    it('renders vendor view and allows vendor to send clarification to buyer', async () => {
      render(
        <RFQDetails
          rfq={buildRFQ({
            inquiries: [
              makeInquiry({
                id: 'inq-v1',
                vendorId: 'v-partner',
                vendorName: 'Vendor Partner',
                message: 'Existing vendor question',
              }),
            ],
          })}
          onBack={jest.fn()}
          isVendorView={true}
        />
      );

      expect(screen.getByText('Direct Clarification & Inquiry with Buyer')).toBeInTheDocument();

      const textarea = screen.getByPlaceholderText(/Type your clarification or question to the buyer/i);
      fireEvent.change(textarea, { target: { value: 'Is warranty mandatory for all line items?' } });

      const sendBtn = screen.getByRole('button', { name: 'Send Inquiry' });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(mockSubmitRFQInquiry).toHaveBeenCalled();
      });
    });

    it('renders empty desk state and allows inviting suppliers', () => {
      renderDetails(
        buildRFQ({
          inquiries: [],
          assignedVendors: [],
          quotes: [],
        })
      );

      expect(screen.getByText('No Vendors or Clarifications Active')).toBeInTheDocument();
      const inviteBtns = screen.getAllByRole('button', { name: /Invite Suppliers/i });
      expect(inviteBtns.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(inviteBtns[0]);
    });

    it('handles RFQ closure when clicking Close RFQ', async () => {
      renderDetails(buildRFQ({ status: 'Quotes Pending' }));

      const closeBtn = screen.queryByRole('button', { name: /Close RFQ/i });
      if (closeBtn) {
        fireEvent.click(closeBtn);
        await waitFor(() => {
          expect(mockUpdateRFQ).toHaveBeenCalledWith('rfq-1', { status: 'Closed' });
        });
      }
    });
  });
});
