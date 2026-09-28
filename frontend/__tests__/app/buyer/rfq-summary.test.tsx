import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RFQSummary from '@/app/buyer/rfq-summary';
import { useApp } from '@/lib/store';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { SOURCING_MODES, formatCurrency, formatIndianDate } from '@/lib/constants';
import type { RFQItem, SourcingMode, RFQSource } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));

const RFQ = UI_STRINGS.rfqSummary;
const SCREEN = UI_STRINGS.screens.rfqSummary;

/** Matches the activeBuyerAccount mockStore supplies, so a buildRFQ() default is in scope. */
const TEST_BUYER_ACCOUNT = { id: 'buyer-acc-test', organizationName: 'Test Buyer Co' };

/** Minimal but type-complete RFQ, so tests only state what they care about. */
function buildRFQ(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: 'rfq-1',
    rfqNumber: 'RFQ-2026-00421',
    title: 'Centrifugal Water Pumps 500 GPM',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1' as SourcingMode,
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-15',
    budget: 145000,
    createdAt: '2026-09-01 10:00 UTC',
    buyerAccountId: TEST_BUYER_ACCOUNT.id,
    extractedEntities: [
      {
        id: 'ent-1',
        itemName: 'Centrifugal Water Pump',
        quantity: 12,
        unit: 'Units',
        targetDate: '2026-09-15',
        technicalSpecs: 'SS316 impeller',
        confidence: 98,
        category: 'Pumps & Accessories',
      },
    ],
    quotes: [],
    chasingActive: true,
    source: 'web_portal',
    followUpData: {
      rfqNumber: 'RFQ-2026-00421',
      totalInvited: 5,
      respondedCount: 2,
      callStats: { total: 5, connected: 3, avgDuration: '1m 20s' },
      whatsappStats: { total: 5, delivered: 5, read: 4, replied: 2 },
      smsStats: { total: 5, delivered: 5, clicked: 1 },
      autoChasingEnabled: true,
      vendors: [],
    },
    ...overrides,
  } as RFQItem;
}

describe('Buyer RFQ Summary (Screen 1.3)', () => {
  const showToast = jest.fn();
  const setSelectedRFQForMatrix = jest.fn();
  const openRFQDeepDive = jest.fn();
  const onViewQuotes = jest.fn();
  const onCreateRFQ = jest.fn();
  const onViewDetails = jest.fn();

  const mockStore = (rfqs: RFQItem[]) => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs,
      activeBuyerAccount: TEST_BUYER_ACCOUNT,
      showToast,
      setSelectedRFQForMatrix,
      openRFQDeepDive,
    });
  };

  const renderScreen = (rfqs: RFQItem[]) => {
    mockStore(rfqs);
    return render(
      <RFQSummary onViewQuotes={onViewQuotes} onCreateRFQ={onCreateRFQ} onViewDetails={onViewDetails} />
    );
  };

  /** Data rows only, excluding the header row. */
  const dataRows = () => screen.getAllByRole('row').slice(1);

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('header & empty state', () => {
    it('renders the screen title from UI_STRINGS', () => {
      renderScreen([buildRFQ()]);
      expect(screen.getByRole('heading', { name: SCREEN.title })).toBeInTheDocument();
    });

    it('shows a guided empty state with no RFQs and no table', () => {
      renderScreen([]);
      expect(screen.getByText(RFQ.emptyPortfolioTitle)).toBeInTheDocument();
      expect(screen.getByText(RFQ.emptyPortfolioMessage)).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('routes to the wizard from either create-RFQ affordance', () => {
      renderScreen([]);
      // Header button plus the empty-state call to action.
      const buttons = screen.getAllByRole('button', { name: new RegExp(RFQ.createRFQAction, 'i') });
      expect(buttons).toHaveLength(2);
      fireEvent.click(buttons[0]);
      fireEvent.click(buttons[1]);
      expect(onCreateRFQ).toHaveBeenCalledTimes(2);
    });
  });

  describe('KPI roll-ups derived from the RFQ list', () => {
    /** Read a KPI card's value by its label, since bare numbers repeat on screen. */
    const kpiValue = (label: string) => {
      const card = screen.getByText(label).closest('div')?.parentElement as HTMLElement;
      return card.querySelector('.mono')?.textContent;
    };

    it('counts the portfolio, active chasers, awaiting quotes, budget and vendors', () => {
      renderScreen([
        buildRFQ({ id: 'a', rfqNumber: 'RFQ-A', budget: 100, quotesCount: 0, chasingActive: true }),
        buildRFQ({ id: 'b', rfqNumber: 'RFQ-B', budget: 400, quotesCount: 3, chasingActive: false }),
      ]);

      expect(kpiValue(RFQ.kpiTotalRFQs)).toBe('2');
      expect(kpiValue(RFQ.kpiAwaitingQuotes)).toBe('1');
      expect(kpiValue(RFQ.kpiPortfolioValue)).toBe(formatCurrency(500));
      expect(kpiValue(RFQ.kpiVendorsEngaged)).toBe('10');

      // 3 quotes over 2 RFQs; 10 vendors invited and 4 responded across fixtures.
      expect(screen.getByText(formatString(RFQ.kpiPortfolioValueHint, { average: 1.5 }))).toBeInTheDocument();
      expect(screen.getByText(formatString(RFQ.kpiTotalRFQsHint, { activeCount: 1 }))).toBeInTheDocument();
      expect(screen.getByText(formatString(RFQ.kpiAwaitingQuotesHint, { quoteCount: 3 }))).toBeInTheDocument();
      expect(screen.getByText(formatString(RFQ.kpiVendorsEngagedHint, { responded: 4 }))).toBeInTheDocument();
    });

    it('avoids dividing by zero when the portfolio is empty', () => {
      renderScreen([]);
      expect(screen.getByText(formatString(RFQ.kpiPortfolioValueHint, { average: 0 }))).toBeInTheDocument();
      expect(kpiValue(RFQ.kpiPortfolioValue)).toBe(formatCurrency(0));
      expect(kpiValue(RFQ.kpiTotalRFQs)).toBe('0');
    });

    it('tolerates RFQs with no follow-up telemetry', () => {
      renderScreen([buildRFQ({ followUpData: undefined })]);
      expect(screen.getByText(formatString(RFQ.kpiVendorsEngagedHint, { responded: 0 }))).toBeInTheDocument();
    });
  });

  describe('sourcing mode distribution', () => {
    it('reports each mode share as a percentage of the portfolio', () => {
      renderScreen([
        buildRFQ({ id: 'a', rfqNumber: 'RFQ-A', sourcingMode: 'mode_1' }),
        buildRFQ({ id: 'b', rfqNumber: 'RFQ-B', sourcingMode: 'mode_1' }),
        buildRFQ({ id: 'c', rfqNumber: 'RFQ-C', sourcingMode: 'mode_3' }),
      ]);

      const mode1 = SOURCING_MODES.find((m) => m.id === 'mode_1')!;
      const mode3 = SOURCING_MODES.find((m) => m.id === 'mode_3')!;
      expect(
        screen.getByText(formatString(RFQ.modeSharePercent, { modeCode: mode1.code, share: 67 }))
      ).toBeInTheDocument();
      expect(
        screen.getByText(formatString(RFQ.modeSharePercent, { modeCode: mode3.code, share: 33 }))
      ).toBeInTheDocument();
    });

    it('exposes each share as an accessible progress bar', () => {
      renderScreen([buildRFQ({ sourcingMode: 'mode_2' })]);
      const bars = screen.getAllByRole('progressbar');
      expect(bars).toHaveLength(SOURCING_MODES.length);
      const mode2 = SOURCING_MODES.find((m) => m.id === 'mode_2')!;
      expect(
        screen.getByRole('progressbar', {
          name: formatString(RFQ.modeSharePercent, { modeCode: mode2.code, share: 100 }),
        })
      ).toHaveAttribute('aria-valuenow', '100');
    });

    it('shows zero shares rather than NaN for an empty portfolio', () => {
      renderScreen([]);
      screen.getAllByRole('progressbar').forEach((bar) => {
        expect(bar).toHaveAttribute('aria-valuenow', '0');
      });
    });
  });

  describe('search & filters', () => {
    const portfolio = () => [
      buildRFQ({ id: 'a', rfqNumber: 'RFQ-AAA', title: 'Pump Overhaul', sourcingMode: 'mode_1', status: 'Quotes Pending', source: 'web_portal' }),
      buildRFQ({
        id: 'b',
        rfqNumber: 'RFQ-BBB',
        title: 'Switchgear Panels',
        category: 'Engineering Spares - Electrical',
        sourcingMode: 'mode_3',
        status: 'AI Recommended',
        source: 'email_gateway',
        extractedEntities: [
          {
            id: 'ent-b',
            itemName: 'LV Panel',
            quantity: 2,
            unit: 'Sets',
            targetDate: '2026-09-28',
            technicalSpecs: 'IP54',
            confidence: 97,
            category: 'Panels',
            majorCategory: 'Engineering Spares - Electrical',
            minorCategory: 'Panels',
          },
        ],
      }),
    ];

    it('filters on RFQ number', () => {
      renderScreen(portfolio());
      fireEvent.change(screen.getByLabelText(RFQ.searchLabel), { target: { value: 'RFQ-BBB' } });
      expect(dataRows()).toHaveLength(1);
      expect(screen.getByText('RFQ-BBB')).toBeInTheDocument();
    });

    it('filters on title, category and line item name', () => {
      renderScreen(portfolio());
      const box = screen.getByLabelText(RFQ.searchLabel);

      fireEvent.change(box, { target: { value: 'overhaul' } });
      expect(dataRows()).toHaveLength(1);

      fireEvent.change(box, { target: { value: 'electrical' } });
      expect(dataRows()).toHaveLength(1);

      // The search reaches into extracted line items, not just the header.
      fireEvent.change(box, { target: { value: 'lv panel' } });
      expect(dataRows()).toHaveLength(1);
      expect(screen.getByText('RFQ-BBB')).toBeInTheDocument();
    });

    it('reports the filtered result count', () => {
      renderScreen(portfolio());
      fireEvent.change(screen.getByLabelText(RFQ.searchLabel), { target: { value: 'pump' } });
      expect(screen.getByText(formatString(RFQ.resultCount, { shown: 1, total: 2 }))).toBeInTheDocument();
    });

    it('filters by status and offers only statuses present', () => {
      renderScreen(portfolio());
      const select = screen.getByLabelText(RFQ.statusFilterLabel);
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
        RFQ.allStatuses,
        'AI Recommended (1)',
        'Quotes Pending (1)',
      ]);

      fireEvent.change(select, { target: { value: 'AI Recommended' } });
      expect(dataRows()).toHaveLength(1);
    });

    it('filters by sourcing mode', () => {
      renderScreen(portfolio());
      fireEvent.change(screen.getByLabelText(RFQ.modeFilterLabel), { target: { value: 'mode_3' } });
      expect(dataRows()).toHaveLength(1);
      expect(screen.getByText('RFQ-BBB')).toBeInTheDocument();
    });

    it('filters by intake source', () => {
      renderScreen(portfolio());
      fireEvent.change(screen.getByLabelText(RFQ.sourceFilterLabel), { target: { value: 'email_gateway' } });
      expect(dataRows()).toHaveLength(1);
      expect(screen.getByText('RFQ-BBB')).toBeInTheDocument();
    });

    // Legacy rows predate intake tracking and must still be reachable.
    it('treats an RFQ with no source as web portal', () => {
      renderScreen([buildRFQ({ source: undefined })]);
      expect(screen.getByText(RFQ.sourceWebPortal)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(RFQ.sourceFilterLabel), { target: { value: 'web_portal' } });
      expect(dataRows()).toHaveLength(1);
    });

    it('shows a no-match message when filters exclude everything', () => {
      renderScreen(portfolio());
      fireEvent.change(screen.getByLabelText(RFQ.searchLabel), { target: { value: 'zzzz-no-such-rfq' } });
      expect(screen.getByText(RFQ.noMatchesMessage)).toBeInTheDocument();
      expect(screen.queryByText('RFQ-AAA')).not.toBeInTheDocument();
    });
  });

  describe('intake source badges', () => {
    it.each<[RFQSource, string]>([
      ['email_gateway', RFQ.sourceEmailGateway],
      ['email_upload', RFQ.sourceEmailUpload],
      ['manual_entry', RFQ.sourceManualEntry],
      ['web_portal', RFQ.sourceWebPortal],
    ])('labels the %s source as %s', (source, label) => {
      renderScreen([buildRFQ({ source })]);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  describe('table content', () => {
    it('renders line item counts, quote counts, budget and delivery date', () => {
      renderScreen([buildRFQ({ quotesCount: 3, budget: 145000 })]);
      const row = dataRows()[0];
      expect(within(row).getByText('RFQ-2026-00421')).toBeInTheDocument();
      expect(within(row).getByText('Centrifugal Water Pumps 500 GPM')).toBeInTheDocument();
      expect(within(row).getByText('Engineering Spares - Mechanical')).toBeInTheDocument();
      // Grouping is locale-dependent, so the expectation is derived the same way.
      expect(within(row).getByText(formatCurrency(145000))).toBeInTheDocument();
      // Delivery dates read in the Indian style, not as the stored ISO value.
      expect(within(row).getByText(formatIndianDate('2026-09-15'))).toBeInTheDocument();
      expect(within(row).queryByText('2026-09-15')).not.toBeInTheDocument();
    });

    it('flags RFQs whose chasers are still running', () => {
      renderScreen([
        buildRFQ({ id: 'a', rfqNumber: 'RFQ-A', chasingActive: true }),
        buildRFQ({ id: 'b', rfqNumber: 'RFQ-B', chasingActive: false }),
      ]);
      expect(screen.getAllByText(RFQ.chasingActive)).toHaveLength(1);
    });

    it.each<RFQItem['status']>(['Parsing', 'In Evaluation', 'AI Recommended', 'PO Generated', 'Quotes Pending'])(
      'renders a badge for the %s status',
      (status) => {
        renderScreen([buildRFQ({ status })]);
        expect(screen.getByText(status)).toBeInTheDocument();
      }
    );

    it('renders nothing for an unrecognised sourcing mode rather than crashing', () => {
      renderScreen([buildRFQ({ sourcingMode: 'mode_99' as SourcingMode })]);
      expect(dataRows()).toHaveLength(1);
    });

    // Regression: RFQs loaded from the API arrive with `lineItems`/`deadline`
    // rather than `extractedEntities`/`targetDeliveryDate`. The store normalises
    // them, but the screen must not crash if an un-normalised row reaches it.
    it('survives a persisted RFQ with no extractedEntities or delivery date', () => {
      const persisted = {
        ...buildRFQ(),
        extractedEntities: undefined,
        targetDeliveryDate: undefined,
      } as unknown as RFQItem;

      renderScreen([persisted]);

      // Column order: identity, status, items, budget, delivery, actions. The items
      // cell also carries the quote count as a sub-line.
      const cells = dataRows()[0].querySelectorAll('td');
      expect(cells[2].textContent).toContain('0');
      expect(within(dataRows()[0]).getByText(RFQ.deliveryDateUnset)).toBeInTheDocument();
    });

    it('searches a persisted RFQ without line items instead of throwing', () => {
      const persisted = { ...buildRFQ(), extractedEntities: undefined } as unknown as RFQItem;
      renderScreen([persisted]);

      fireEvent.change(screen.getByLabelText(RFQ.searchLabel), { target: { value: 'centrifugal' } });

      // Matches on the title, and the missing line-item array is tolerated.
      expect(dataRows()).toHaveLength(1);
    });

    // Every searchable field is coerced, so a record missing any of them is
    // simply excluded from the results rather than crashing the screen.
    it('searches an RFQ whose number, title, category and item name are all absent', () => {
      const sparse = {
        ...buildRFQ(),
        rfqNumber: undefined,
        title: undefined,
        category: undefined,
        extractedEntities: [{ id: 'ent-x', quantity: 1 }],
      } as unknown as RFQItem;

      renderScreen([sparse]);
      expect(dataRows()).toHaveLength(1);

      fireEvent.change(screen.getByLabelText(RFQ.searchLabel), { target: { value: 'pump' } });

      expect(screen.getByText(RFQ.noMatchesMessage)).toBeInTheDocument();
    });
  });

  describe('drill-through actions', () => {
    it('opens the quote matrix and records the selection when quotes exist', () => {
      const rfq = buildRFQ({ quotesCount: 4 });
      renderScreen([rfq]);

      fireEvent.click(screen.getByRole('button', { name: formatString(RFQ.viewQuotesAria, { rfqNumber: rfq.rfqNumber }) }));

      expect(setSelectedRFQForMatrix).toHaveBeenCalledWith(rfq);
      expect(onViewQuotes).toHaveBeenCalledWith(rfq);
      expect(showToast).not.toHaveBeenCalled();
    });

    // Navigating to an empty matrix is a dead end, so the buyer is told why.
    it('explains that no quotes have arrived instead of navigating', () => {
      const rfq = buildRFQ({ quotesCount: 0 });
      renderScreen([rfq]);

      fireEvent.click(screen.getByRole('button', { name: formatString(RFQ.viewQuotesAria, { rfqNumber: rfq.rfqNumber }) }));

      expect(showToast).toHaveBeenCalledWith(
        RFQ.noQuotesYetTitle,
        formatString(RFQ.noQuotesYetMessage, { rfqNumber: rfq.rfqNumber }),
        'info'
      );
      expect(onViewQuotes).not.toHaveBeenCalled();
      expect(setSelectedRFQForMatrix).not.toHaveBeenCalled();
    });

    it('opens the multi-channel follow-up deep dive', () => {
      const rfq = buildRFQ();
      renderScreen([rfq]);
      fireEvent.click(
        screen.getByRole('button', { name: formatString(RFQ.viewFollowUpsAria, { rfqNumber: rfq.rfqNumber }) })
      );
      expect(openRFQDeepDive).toHaveBeenCalledWith(rfq);
    });
  });

  describe('pagination', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        buildRFQ({ id: `rfq-${i}`, rfqNumber: `RFQ-${String(i).padStart(3, '0')}` })
      );

    it('shows only the first page by default', () => {
      renderScreen(many(12));
      expect(dataRows()).toHaveLength(10);
      expect(screen.getByText(formatString(RFQ.pageIndicator, { current: 1, total: 2 }))).toBeInTheDocument();
      expect(screen.getByText(formatString(RFQ.pageRange, { from: 1, to: 10, total: 12 }))).toBeInTheDocument();
    });

    it('advances and returns between pages', () => {
      renderScreen(many(12));

      fireEvent.click(screen.getByRole('button', { name: RFQ.nextPageAria }));
      expect(dataRows()).toHaveLength(2);
      expect(screen.getByText(formatString(RFQ.pageRange, { from: 11, to: 12, total: 12 }))).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: RFQ.previousPageAria }));
      expect(dataRows()).toHaveLength(10);
    });

    it('disables the arrows at both ends', () => {
      renderScreen(many(12));
      expect(screen.getByRole('button', { name: RFQ.previousPageAria })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: RFQ.nextPageAria }));
      expect(screen.getByRole('button', { name: RFQ.nextPageAria })).toBeDisabled();
    });

    it('changes the page size and returns to the first page', () => {
      renderScreen(many(12));
      fireEvent.click(screen.getByRole('button', { name: RFQ.nextPageAria }));

      fireEvent.change(screen.getByLabelText(RFQ.rowsPerPageLabel), { target: { value: '5' } });

      expect(dataRows()).toHaveLength(5);
      expect(screen.getByText(formatString(RFQ.pageIndicator, { current: 1, total: 3 }))).toBeInTheDocument();
    });

    // Filtering while on a later page must not leave the buyer on a blank page.
    it('clamps the page when a filter shrinks the result set', () => {
      renderScreen(many(12));
      fireEvent.click(screen.getByRole('button', { name: RFQ.nextPageAria }));
      expect(screen.getByText(formatString(RFQ.pageIndicator, { current: 2, total: 2 }))).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(RFQ.searchLabel), { target: { value: 'RFQ-000' } });

      expect(dataRows()).toHaveLength(1);
      expect(screen.getByText(formatString(RFQ.pageIndicator, { current: 1, total: 1 }))).toBeInTheDocument();
    });

    it('hides the pager when filters exclude every row', () => {
      renderScreen(many(12));
      fireEvent.change(screen.getByLabelText(RFQ.searchLabel), { target: { value: 'nothing-matches' } });
      expect(screen.queryByRole('button', { name: RFQ.nextPageAria })).not.toBeInTheDocument();
    });
  });
});

describe('Buyer RFQ Summary: details action and unset budget', () => {
  const onViewQuotes = jest.fn();
  const onCreateRFQ = jest.fn();
  const onViewDetails = jest.fn();

  const renderWith = (rfqs: RFQItem[]) => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs,
      activeBuyerAccount: TEST_BUYER_ACCOUNT,
      showToast: jest.fn(),
      setSelectedRFQForMatrix: jest.fn(),
      openRFQDeepDive: jest.fn(),
    });
    return render(
      <RFQSummary onViewQuotes={onViewQuotes} onCreateRFQ={onCreateRFQ} onViewDetails={onViewDetails} />
    );
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('hands the row through when View Details is pressed', () => {
    const rfq = buildRFQ({ rfqNumber: 'RFQ-2026-00462' });
    renderWith([rfq]);

    fireEvent.click(
      screen.getByRole('button', { name: formatString(RFQ.viewDetailsAria, { rfqNumber: rfq.rfqNumber }) })
    );

    expect(onViewDetails).toHaveBeenCalledWith(rfq);
  });

  /** The row cell, scoped so the KPI strip's own currency is not matched. */
  const budgetCell = () => screen.getAllByRole('row')[1];

  // Zero means the buyer stated no ceiling, which must not read as a real budget
  // of nil now that the field is optional.
  it('shows an unstated budget as not set rather than as zero', () => {
    renderWith([buildRFQ({ budget: 0 })]);

    expect(within(budgetCell()).getByText(RFQ.budgetUnset)).toBeInTheDocument();
    expect(within(budgetCell()).queryByText(formatCurrency(0))).not.toBeInTheDocument();
  });

  it('still formats a stated budget as currency', () => {
    renderWith([buildRFQ({ budget: 145000 })]);

    expect(within(budgetCell()).getByText(formatCurrency(145000))).toBeInTheDocument();
  });
});
