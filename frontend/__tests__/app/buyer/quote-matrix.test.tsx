import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import QuoteMatrix from '../../../app/buyer/quote-matrix';
import { useApp } from '../../../lib/store';
import { formatCurrency } from '../../../lib/constants';

jest.mock('../../../lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('../../../app/components/Modals', () => ({
  PurchaseOrderModal: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="po-modal">
        <button onClick={onClose}>Close PO Modal</button>
      </div>
    ) : null,
  RFQFollowUpDeepDiveModal: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="deep-dive-modal">
        <button onClick={onClose}>Close Vendor Follow-Up Details</button>
      </div>
    ) : null,
}));

describe('QuoteMatrix Component Tests', () => {
  const mockShowToast = jest.fn();
  const mockSetSelectedRFQForMatrix = jest.fn();
  const mockOpenRFQDeepDive = jest.fn();
  const mockSetDeepDiveModalOpen = jest.fn();
  const mockOnBackToDashboard = jest.fn();

  const mockRFQs = [
    {
      id: 'rfq-1',
      rfqNumber: 'RFQ-2026-00421',
      title: 'High Pressure Centrifugal Water Pumps 500 GPM',
      category: 'Engineering Spares - Mechanical',
      intakeSource: 'email_gateway',
      creationDate: '2026-02-28',
      targetDeliveryDate: '2026-03-25',
      budget: 85000,
      quotesCount: 2,
      buyerAccountId: 'buyer-own',
      status: 'In Evaluation' as const,
      chasingActive: true,
      followUpData: {
        totalInvited: 5,
        respondedCount: 3,
        callStats: { total: 5, connected: 4, avgDuration: '1m 45s' },
        whatsappStats: { total: 5, delivered: 5, read: 4, replied: 3 },
        smsStats: { total: 5, delivered: 5, clicked: 4 },
        channels: [],
      },
      quotes: [
        {
          vendorId: 'v-1',
          vendorName: 'Apex Supplies Ltd.',
          vendorCategory: 'Procucev - AI Rec',
          unitPrice: 12500,
          totalPrice: 75000,
          leadTimeDays: 14,
          aiMatchScore: 98,
          isBestPrice: true,
          isPreferred: true,
          warrantyYears: 3,
          complianceStatus: 'Fully Compliant',
          paymentTerms: 'Net 45 Days',
          remarks: 'OEM certified warranty with plant dispatch.',
        },
        {
          vendorId: 'v-2',
          vendorName: 'Kiran Valve Industries',
          vendorCategory: 'Client List',
          unitPrice: 13200,
          totalPrice: 79200,
          leadTimeDays: 21,
          aiMatchScore: 88,
          isBestPrice: false,
          isPreferred: false,
          warrantyYears: 2,
          complianceStatus: 'Minor Exception',
          paymentTerms: 'Net 30 Days',
          remarks: 'Standard mechanical specifications.',
        },
      ],
      lineItems: [
        {
          id: 'li-1',
          itemName: 'Centrifugal Pump 500 GPM',
          quantity: 6,
          unit: 'Units',
          targetDate: '2026-03-25',
          technicalSpecs: '15 HP Motor, 500 GPM',
          confidence: 0.95,
          category: 'Pumps & Accessories',
        },
      ],
    },
    {
      id: 'rfq-2',
      rfqNumber: 'RFQ-2026-00422',
      title: 'LV Switchgear Modular Panels',
      category: 'Engineering Spares - Electrical',
      intakeSource: 'web_portal',
      creationDate: '2026-02-28',
      targetDeliveryDate: '2026-03-30',
      budget: 120000,
      quotesCount: 0,
      buyerAccountId: 'buyer-other',
      status: 'Quotes Pending' as const,
      quotes: [],
      lineItems: [],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: null,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });
  });

  test('renders QuoteMatrix with RFQ switcher, and vendors comparison matrix', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Apex Supplies Ltd./i)).toBeInTheDocument();
    expect(screen.getByText(/Kiran Valve Industries/i)).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(85000))).toBeInTheDocument();
  });

  test('renders a line-item-wise comparison row per RFQ item, highlighting the lowest real price, and downloads an Excel file', () => {
    const itemizedRfq = {
      ...mockRFQs[0],
      id: 'rfq-itemized',
      rfqNumber: 'RFQ-2026-ITEM01',
      extractedEntities: [
        { id: 'li-a', itemName: 'Centrifugal Pump 500 GPM', quantity: 6, unit: 'Units' },
        { id: 'li-b', itemName: 'Mounting Bracket', quantity: 12, unit: 'Units' },
      ],
      quotes: [
        {
          ...mockRFQs[0].quotes[0],
          lineItemQuotes: [
            { lineItemId: 'li-a', itemName: 'Centrifugal Pump 500 GPM', quantity: 6, unitPrice: 12000, totalPrice: 72000 },
            { lineItemId: 'li-b', itemName: 'Mounting Bracket', quantity: 12, unitPrice: 300, totalPrice: 3600 },
          ],
        },
        {
          ...mockRFQs[0].quotes[1],
          // No lineItemQuotes — this vendor never itemized, falls back to its blended price.
        },
      ],
    };
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [itemizedRfq],
      selectedRFQForMatrix: itemizedRfq,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    expect(screen.getByText('Line-Item-Wise Bid Comparison')).toBeInTheDocument();
    expect(screen.getByText('Centrifugal Pump 500 GPM')).toBeInTheDocument();
    expect(screen.getByText('Mounting Bracket')).toBeInTheDocument();
    // Apex itemized this row at 12,000 — real price, rendered as formatted currency.
    expect(screen.getByText(formatCurrency(12000))).toBeInTheDocument();
    // Kiran never itemized — falls back to its blended unit price, marked not itemized.
    expect(screen.getAllByText(/not itemized/i).length).toBeGreaterThan(0);

    const downloadBtn = screen.getByText(/Download Excel/i);
    expect(downloadBtn).toBeInTheDocument();
    // Clicking it should not throw even though xlsx isn't mocked here — it
    // exercises the real export path end to end (jsdom stubs URL.createObjectURL).
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:mock');
    URL.revokeObjectURL = jest.fn();
    fireEvent.click(downloadBtn);
    URL.createObjectURL = originalCreateObjectURL;
  });

  test('allows selecting a different RFQ from dropdown', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'rfq-2' } });

    expect(mockSetSelectedRFQForMatrix).toHaveBeenCalledWith(mockRFQs[1]);
  });

  test('triggers PO generator modal for preferred and non-preferred vendors and closes modal', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

    // Preferred vendor PO action
    const approveBtn = screen.getByText(/\[ APPROVE & GENERATE PRE-PURCHASE ORDER \]/i);
    fireEvent.click(approveBtn);

    expect(screen.getByTestId('po-modal')).toBeInTheDocument();
    const closeBtn = screen.getByText(/Close PO Modal/i);
    fireEvent.click(closeBtn);

    // Non-preferred vendor PO action
    const selectKiranBtn = screen.getByText(/Select Kiran/i);
    fireEvent.click(selectKiranBtn);
  });

  test('triggers openRFQDeepDive and closes deep dive modal', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: null,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: true,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: mockRFQs[0],
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    const deepDiveBtn = screen.getByText(/Vendor Follow-Up Details \(.*Responded\)/i);
    fireEvent.click(deepDiveBtn);

    expect(mockOpenRFQDeepDive).toHaveBeenCalledWith(mockRFQs[0]);

    const closeDeepDiveBtn = screen.getByText(/Close Vendor Follow-Up Details/i);
    fireEvent.click(closeDeepDiveBtn);
    expect(mockSetDeepDiveModalOpen).toHaveBeenCalledWith(false);
  });

  test('triggers onBackToDashboard when back button is clicked', () => {
    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    const backBtn = screen.getByText(/Back to Command Center/i);
    fireEvent.click(backBtn);

    expect(mockOnBackToDashboard).toHaveBeenCalled();
  });

  test('renders empty quotes state when selected RFQ has zero quotes', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: mockRFQs,
      selectedRFQForMatrix: mockRFQs[1],
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/Quotes Pending for this RFQ/i)).toBeInTheDocument();
  });

  test('renders empty state when no RFQs exist', () => {
    (useApp as jest.Mock).mockReturnValue({
      rfqs: [],
      selectedRFQForMatrix: null,
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
    expect(screen.getByText(/No RFQs Available/i)).toBeInTheDocument();
  });

  describe('scopeToOwnBuyerAccount (the buyer route only — category manager leaves this off)', () => {
    // GET /api/rfqs is scoped server-side by the caller's role now (see
    // command-center.tsx), so on the buyer's own route `rfqs` from context
    // already contains only this buyer's own RFQs — there is no client-side
    // re-filtering left to exercise. What's still real and worth testing:
    // selectedRFQForMatrix is app-wide store state, so a stale selection left
    // over from a different role's navigation must not be trusted just
    // because scopeToOwnBuyerAccount is on.
    test('renders the buyer\'s own (already-scoped) RFQ list and default selection', () => {
      (useApp as jest.Mock).mockReturnValue({
        rfqs: [mockRFQs[0]],
        selectedRFQForMatrix: null,
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} scopeToOwnBuyerAccount />);

      expect(screen.getByText('RFQ-2026-00421')).toBeInTheDocument();
      expect(screen.getByText(/Apex Supplies Ltd./i)).toBeInTheDocument();

      const select = screen.getByRole('combobox') as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);
      expect(optionValues).toEqual(['rfq-1']);
    });

    test('ignores a selectedRFQForMatrix left over from another role and falls back to this buyer\'s own list', () => {
      (useApp as jest.Mock).mockReturnValue({
        // The server only ever sends this buyer's own RFQ — rfq-2 belongs to
        // a different buyer account and was never in this list to begin with.
        rfqs: [mockRFQs[0]],
        // A category manager's navigation left this pointed at a foreign RFQ.
        selectedRFQForMatrix: mockRFQs[1],
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} scopeToOwnBuyerAccount />);

      // Falls back to rfq-1 (this buyer's own), never renders the foreign rfq-2 selection
      expect(screen.getByText('RFQ-2026-00421')).toBeInTheDocument();
      expect(screen.queryByText('LV Switchgear Modular Panels')).not.toBeInTheDocument();
    });

    test('without the prop (category manager route), the full cross-buyer list is shown', () => {
      (useApp as jest.Mock).mockReturnValue({
        rfqs: mockRFQs,
        selectedRFQForMatrix: null,
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

      const select = screen.getByRole('combobox') as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);
      expect(optionValues).toEqual(['rfq-1', 'rfq-2']);
    });

    test('does not render the AI Quality / Match Score section (removed from vendor comparison)', () => {
      const rfqWithBreakdown = {
        ...mockRFQs[0],
        quotes: [
          {
            ...mockRFQs[0].quotes[0],
            aiMatchScore: 70,
            scoreBreakdown: {
              price: { score: 100, weighted: 45, maxWeight: 45 },
              leadTime: { score: 0, weighted: 0, maxWeight: 30 },
              warranty: { score: 100, weighted: 25, maxWeight: 25 },
            },
          },
        ],
      };

      (useApp as jest.Mock).mockReturnValue({
        rfqs: [rfqWithBreakdown],
        selectedRFQForMatrix: rfqWithBreakdown,
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);
      expect(screen.queryByText('AI Quality / Match Score')).not.toBeInTheDocument();
      expect(screen.queryByText('P: 45')).not.toBeInTheDocument();
      expect(screen.queryByText('L: 0')).not.toBeInTheDocument();
      expect(screen.queryByText('W: 25')).not.toBeInTheDocument();
    });

    test('renders source badges correctly for both Portal and Email quotes', () => {
      const rfqWithMixedSources = {
        ...mockRFQs[0],
        quotes: [
          {
            ...mockRFQs[0].quotes[0],
            vendorId: 'v-portal-1',
            vendorName: 'Apex Portal Vendor',
            source: 'portal' as const,
          },
          {
            ...mockRFQs[0].quotes[1],
            vendorId: 'v-email-2',
            vendorName: 'Kiran Email Vendor',
            source: 'email' as const,
          },
        ],
      };

      (useApp as jest.Mock).mockReturnValue({
        rfqs: [rfqWithMixedSources],
        selectedRFQForMatrix: rfqWithMixedSources,
        setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
        showToast: mockShowToast,
        openRFQDeepDive: mockOpenRFQDeepDive,
        deepDiveModalOpen: false,
        setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
        selectedRFQForDeepDive: null,
      });

      render(<QuoteMatrix onBackToDashboard={mockOnBackToDashboard} />);

      const portalBadge = screen.getByTestId('quote-source-v-portal-1');
      expect(portalBadge).toBeInTheDocument();
      expect(portalBadge).toHaveTextContent('🌐 Portal');

      const emailBadge = screen.getByTestId('quote-source-v-email-2');
      expect(emailBadge).toBeInTheDocument();
      expect(emailBadge).toHaveTextContent('✉️ Email');
    });
  });
});

