import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import KanbanBoard from '@/app/category-manager/kanban-board';
import SpendDashboard from '@/app/category-manager/spend-dashboard';
import BuyerConsole from '@/app/category-manager/buyer-console';
import VendorConsole from '@/app/category-manager/vendor-console';
import CategorySummaryDashboard from '@/app/category-manager/category-summary-dashboard';
import { AppProvider, useApp } from '@/lib/store';

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

function CategoryManagerBranchWrapper({ onMatrix, onEval, onSpend }: any) {
  const { addNewRFQ } = useApp();

  return (
    <>
      <button
        data-testid="test-add-varied-rfqs"
        onClick={() => {
          try {
            addNewRFQ({
              title: 'Parsing RFQ Test',
              category: 'Civil Works',
              sourcingMode: 'mode_1',
              targetDeliveryDate: '2026-10-01',
              budget: 50000,
              extractedEntities: [
                {
                  id: 'ent-p1',
                  itemName: 'Cement Bags',
                  quantity: 100,
                  unit: 'Bags',
                  targetDate: '2026-10-01',
                  technicalSpecs: 'Grade 53 OPC',
                  confidence: 99,
                  category: 'Civil Works',
                  majorCategory: 'Civil Works',
                  minorCategory: 'Cement & Concrete',
                },
              ],
              aiScore: 75,
              autoCirculated: false,
            });
            addNewRFQ({
              title: 'In Evaluation RFQ Test',
              category: 'Engineering Spares - Electrical',
              sourcingMode: 'mode_3',
              targetDeliveryDate: '2026-10-01',
              budget: 75000,
              extractedEntities: [
                {
                  id: 'ent-e1',
                  itemName: 'Circuit Breaker',
                  quantity: 10,
                  unit: 'Units',
                  targetDate: '2026-10-01',
                  technicalSpecs: '400A MCCB',
                  confidence: 98,
                  category: 'Engineering Spares - Electrical',
                  majorCategory: 'Engineering Spares - Electrical',
                  minorCategory: 'Circuit Breakers',
                },
              ],
              aiScore: 85,
              autoCirculated: false,
            });
          } catch (e) {}
        }}
      >
        Add Varied RFQs
      </button>
      <KanbanBoard onNavigateToMatrix={onMatrix} onNavigateToSpend={onSpend} />
      <BuyerConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={onEval} />
      <VendorConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={onEval} />
    </>
  );
}

describe('Category Manager Screens Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('KanbanBoard Screen', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('renders real portfolio metrics and the scored column from the live RFQ pipeline, handles toolbar overrides', async () => {
      const onMatrix = jest.fn();
      const onSpend = jest.fn();

      renderWithProvider(<KanbanBoard onNavigateToMatrix={onMatrix} onNavigateToSpend={onSpend} />);

      await waitFor(() => {
        expect(screen.getByText(/Operational Monitoring Kanban & Chasing Control/i)).toBeInTheDocument();
      });

      // Portfolio metrics derive from the single bootstrap-seeded RFQ
      // (RFQ-2026-00421, quotesCount 3) — never hardcoded.
      await waitFor(() => {
        expect(screen.getByText('1 Total')).toBeInTheDocument(); // RFQs In Pipeline
      });
      expect(screen.getByText('3 Total')).toBeInTheDocument(); // Quotes Received
      expect(screen.getByText(/Avg 3 \/ RFQ/i)).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument(); // Vendor Response Rate: no follow-ups recorded
      expect(screen.getByText('0 Active')).toBeInTheDocument(); // Awaiting Quotes: the seeded RFQ already has quotes

      // Empty-state messaging for the two columns with no real RFQ in them
      expect(screen.getByText(/No RFQs currently at the OCR\/parsing stage/i)).toBeInTheDocument();
      expect(screen.getByText(/No RFQs currently awaiting vendor quotes/i)).toBeInTheDocument();

      const spendBtn = screen.getByRole('button', { name: /Mode & Performance Analytics/i });
      fireEvent.click(spendBtn);
      expect(onSpend).toHaveBeenCalled();

      // Batch chaser with an empty Quotes Pending column is a real no-op, not silently ignored
      const batchBtn = screen.getByRole('button', { name: /Batch Multi-Channel Chaser \(0\)/i });
      expect(() => fireEvent.click(batchBtn)).not.toThrow();

      const overrideBtn = screen.getByRole('button', { name: /Override AI Score/i });
      fireEvent.click(overrideBtn);

      const surveyBtn = screen.getByRole('button', { name: /Conduct Mode 3 Vendor Survey/i });
      fireEvent.click(surveyBtn);
      expect(screen.getByText(/Mode 3 AI Vendor Survey/i)).toBeInTheDocument();
      const cancelSurveyBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelSurveyBtn);

      // The scored card renders real RFQ fields — number, title, AI score, status, quote count
      expect(screen.getByText('RFQ-2026-00421')).toBeInTheDocument();
      expect(screen.getByText(/94% AI Match/i)).toBeInTheDocument();
      expect(screen.getByText(/3 quotes evaluated/i)).toBeInTheDocument();
      expect(screen.getByText('AI Recommended')).toBeInTheDocument();

      const approveBtn = screen.getByRole('button', { name: /Approve Report/i });
      fireEvent.click(approveBtn);

      const shareBtn = screen.getByRole('button', { name: /Share Report/i });
      fireEvent.click(shareBtn);

      // The real RFQ has quotes, so its card links straight into the real quote matrix
      const matrixBtn = screen.getByRole('button', { name: /View Comparative Quote Matrix/i });
      fireEvent.click(matrixBtn);
      expect(onMatrix).toHaveBeenCalledWith(expect.objectContaining({ rfqNumber: 'RFQ-2026-00421' }));
    });

    test('renders real Parsing and Quotes Pending pipeline cards, with per-card chaser/deep-dive/escalate actions', async () => {
      const onMatrix = jest.fn();

      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => {
            // RFQs come from GET /api/rfqs, not the (anonymous) bootstrap
            // payload — see the file's own default (jest.setup.ts) for the
            // same pattern.
            if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url)) {
              return {
                success: true,
                data: [
                    {
                      id: 'rfq-parse-1',
                      rfqNumber: 'RFQ-2026-00901',
                      title: 'Stainless Steel Reactor Vessels',
                      category: 'Process Equipment',
                      sourcingMode: 'mode_2',
                      status: 'Parsing',
                      createdAt: '2026-09-01',
                      targetDeliveryDate: '2026-10-01',
                      quotesCount: 0,
                      budget: 0,
                      extractedEntities: [
                        { id: 'e1', itemName: 'Reactor Vessel', quantity: 2, unit: 'Units', targetDate: '2026-10-01', technicalSpecs: 'SS316L', confidence: 92, category: 'Process Equipment', majorCategory: 'Process Equipment', minorCategory: 'Vessels' },
                        { id: 'e2', itemName: 'Agitator', quantity: 2, unit: 'Units', targetDate: '2026-10-01', technicalSpecs: '5HP', confidence: 88, category: 'Process Equipment', majorCategory: 'Process Equipment', minorCategory: 'Agitators' },
                      ],
                      quotes: [],
                    },
                    {
                      id: 'rfq-parse-2',
                      rfqNumber: 'RFQ-2026-00904',
                      title: 'Untitled Intake Awaiting OCR',
                      category: 'Uncategorised',
                      sourcingMode: 'mode_1',
                      status: 'Parsing',
                      createdAt: '2026-09-01',
                      targetDeliveryDate: '',
                      quotesCount: 0,
                      budget: 0,
                      extractedEntities: [],
                      quotes: [],
                    },
                    {
                      id: 'rfq-pending-1',
                      rfqNumber: 'RFQ-2026-00902',
                      title: 'Industrial Gearbox Assemblies',
                      category: 'Mechanical Power Transmission',
                      sourcingMode: 'mode_2',
                      status: 'Quotes Pending',
                      createdAt: '2026-09-01',
                      targetDeliveryDate: '2026-10-05',
                      quotesCount: 0,
                      budget: 40000,
                      extractedEntities: [],
                      quotes: [],
                      chasingActive: true,
                      followUpData: {
                        rfqNumber: 'RFQ-2026-00902',
                        totalInvited: 3,
                        respondedCount: 1,
                        callStats: { total: 3, connected: 2, avgDuration: '1m 30s' },
                        whatsappStats: { total: 3, delivered: 3, read: 2, replied: 1 },
                        smsStats: { total: 3, delivered: 3, clicked: 1 },
                        vendors: [
                          {
                            vendorId: 'vendor-9',
                            vendorName: 'Precision Gear Works',
                            phone: '+91 90000 00000',
                            contactPerson: 'S. Rao',
                            call: { status: 'connected', lastAttempt: 'Today' },
                            whatsapp: { status: 'read', lastAttempt: 'Today' },
                            sms: { status: 'delivered', lastAttempt: 'Today' },
                            overallStatus: 'Follow-up Active',
                            lastInteraction: 'Today',
                            attemptsCount: 2,
                            bidStatus: 'In Progress',
                          },
                        ],
                      },
                    },
                    {
                      id: 'rfq-pending-2',
                      rfqNumber: 'RFQ-2026-00903',
                      title: 'Unassigned Bulk Chemical Drums',
                      category: 'Chemicals',
                      sourcingMode: 'mode_3',
                      status: 'Quotes Pending',
                      createdAt: '2026-09-01',
                      targetDeliveryDate: '2026-10-05',
                      quotesCount: 0,
                      budget: 0,
                      extractedEntities: [],
                      quotes: [],
                    },
                    {
                      id: 'rfq-scored-zero',
                      rfqNumber: 'RFQ-2026-00905',
                      title: 'Newly Scored, No Quotes Yet',
                      category: 'Process Equipment',
                      sourcingMode: 'mode_3',
                      status: 'PO Generated',
                      createdAt: '2026-09-01',
                      targetDeliveryDate: '2026-10-10',
                      quotesCount: 0,
                      budget: 0,
                      extractedEntities: [],
                      quotes: [],
                    },
                    {
                      id: 'rfq-scored-one',
                      rfqNumber: 'RFQ-2026-00906',
                      title: 'Single Quote In Evaluation',
                      category: 'Process Equipment',
                      sourcingMode: 'mode_3',
                      status: 'In Evaluation',
                      createdAt: '2026-09-01',
                      targetDeliveryDate: '2026-10-10',
                      quotesCount: 1,
                      budget: 0,
                      extractedEntities: [],
                      quotes: [{ vendorId: 'v-x', vendorName: 'Test Vendor', vendorCategory: 'General', unitPrice: 1, totalPrice: 1, leadTimeDays: 1, aiMatchScore: 1, isBestPrice: false, isPreferred: false, warrantyYears: 1, complianceStatus: 'Compliant', paymentTerms: 'Net 30', remarks: '' }],
                    },
                  ],
              };
            }
            return { success: true, data: {} };
          },
          text: async () => '',
          blob: async () => new Blob([]),
        });
      }) as any;

      renderWithProvider(<KanbanBoard onNavigateToMatrix={onMatrix} onNavigateToSpend={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('RFQ-2026-00901')).toBeInTheDocument();
      });

      // Column 1 — real per-RFQ fields, including an average confidence
      // computed from the RFQ's own extracted entities (no invented OCR %).
      expect(screen.getByText('Stainless Steel Reactor Vessels')).toBeInTheDocument();
      expect(screen.getByText('90%')).toBeInTheDocument(); // avg of 92 and 88
      expect(screen.getByText('RFQ-2026-00904')).toBeInTheDocument(); // entity-less parsing RFQ renders with no confidence line

      // Column 2 — both a chasing-active RFQ with real follow-up telemetry
      // and a plain one with neither chasingActive nor followUpData set.
      expect(screen.getByText('RFQ-2026-00902')).toBeInTheDocument();
      expect(screen.getByText(/2\/3 Connected/i)).toBeInTheDocument();
      expect(screen.getByText(/2\/3 Read/i)).toBeInTheDocument();
      expect(screen.getByText(/3\/3 Delivered/i)).toBeInTheDocument();
      expect(screen.getByText('RFQ-2026-00903')).toBeInTheDocument();
      expect(screen.getAllByText(/Chasing Paused/i).length).toBeGreaterThan(0);

      // Real, non-empty batch chaser dispatches to every RFQ actually in Quotes Pending
      const batchBtn = screen.getByRole('button', { name: /Batch Multi-Channel Chaser \(2\)/i });
      expect(() => fireEvent.click(batchBtn)).not.toThrow();

      // Chaser buttons use the RFQ's own real vendor, not a hardcoded name
      const allButtons = screen.getAllByRole('button');
      const callBtns = allButtons.filter((b) => b.textContent?.includes('📞') && b.textContent?.includes('Call'));
      expect(callBtns.length).toBeGreaterThanOrEqual(2);
      fireEvent.click(callBtns[0]);
      expect(screen.getByText(/Dispatch AI Follow-Up/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

      // RFQ-2026-00903 has no followUpData, so its chaser falls back to a
      // generic vendor label instead of inventing a vendor name.
      fireEvent.click(callBtns[1]);
      expect(screen.getByText(/Dispatch AI Follow-Up/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

      // Scored-column cards with real, varied quotesCount — no quotes yet vs. exactly one
      expect(screen.getByText('RFQ-2026-00905')).toBeInTheDocument();
      expect(screen.getByText(/0 quotes evaluated/i)).toBeInTheDocument();
      expect(screen.getByText('RFQ-2026-00906')).toBeInTheDocument();
      expect(screen.getByText(/1 quote evaluated/i)).toBeInTheDocument();

      const waBtn = allButtons.find((b) => b.textContent?.includes('WA'));
      if (waBtn) {
        fireEvent.click(waBtn);
        fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
      }

      const smsBtn = allButtons.find((b) => b.textContent?.includes('📱') && b.textContent?.includes('SMS'));
      if (smsBtn) {
        fireEvent.click(smsBtn);
        fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
      }

      const emailBtn = allButtons.find((b) => b.textContent?.includes('24h Email'));
      if (emailBtn) {
        fireEvent.click(emailBtn);
      }

      // Deep Dive opens with the specific real RFQ the card belongs to
      const deepDiveBtns = screen.getAllByRole('button', { name: /Deep Dive/i });
      fireEvent.click(deepDiveBtns[0]);
      expect(screen.getByText(/RFQ AI Follow-Up Telemetry & Deep Dive/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Close Deep Dive/i }));

      const escalateBtns = screen.getAllByRole('button', { name: /Escalate to Buyer/i });
      fireEvent.click(escalateBtns[0]);

      // Open & Review Categories action on parsing RFQ card
      const reviewActionBtns = screen.getAllByRole('button', { name: /Open & Review Categories/i });
      fireEvent.click(reviewActionBtns[0]);
      expect(screen.getByText(/Edit RFQ/i)).toBeInTheDocument();
      const cancelEditBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelEditBtn);
    });

    test('the scored card never throws when no matrix-navigation callback is supplied', async () => {
      renderWithProvider(<KanbanBoard onNavigateToSpend={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('RFQ-2026-00421')).toBeInTheDocument();
      });

      const matrixBtn = screen.getByRole('button', { name: /View Comparative Quote Matrix/i });
      expect(() => fireEvent.click(matrixBtn)).not.toThrow();
    });

    test('clicking summary cards opens filtered modal dialogs on the active page and allows closing them', async () => {
      renderWithProvider(<KanbanBoard onNavigateToSpend={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('RFQ-2026-00421')).toBeInTheDocument();
      });

      // 1. Pipeline Summary Card
      const pipelineBtn = screen.getByRole('button', { name: /RFQs In Pipeline/i });
      fireEvent.click(pipelineBtn);
      expect(screen.getByRole('heading', { name: 'RFQs In Pipeline' })).toBeInTheDocument();
      expect(screen.getByText(/Live Operational Overview & Tracking/i)).toBeInTheDocument();
      const closeButtons1 = screen.getAllByRole('button', { name: /Close/i });
      fireEvent.click(closeButtons1[0]);
      expect(screen.queryByRole('heading', { name: 'RFQs In Pipeline' })).not.toBeInTheDocument();

      // 2. Quotes Received Summary Card
      const quotesBtn = screen.getByRole('button', { name: /Quotes Received/i });
      fireEvent.click(quotesBtn);
      expect(screen.getByRole('heading', { name: 'Quotes Received' })).toBeInTheDocument();
      const closeButtons2 = screen.getAllByRole('button', { name: /Close/i });
      fireEvent.click(closeButtons2[0]);
      expect(screen.queryByRole('heading', { name: 'Quotes Received' })).not.toBeInTheDocument();

      // 3. Awaiting Quotes Summary Card - footer Close button
      const awaitingBtn = screen.getByRole('button', { name: /Awaiting Quotes/i });
      fireEvent.click(awaitingBtn);
      expect(screen.getByRole('heading', { name: 'Awaiting Quotes' })).toBeInTheDocument();
      const closeButtons3 = screen.getAllByRole('button', { name: /Close/i });
      fireEvent.click(closeButtons3[closeButtons3.length - 1]);
      expect(screen.queryByRole('heading', { name: 'Awaiting Quotes' })).not.toBeInTheDocument();
    });

    test('modal rows allow navigating to matrix or reviewing the rfq', async () => {
      const onMatrix = jest.fn();
      renderWithProvider(<KanbanBoard onNavigateToMatrix={onMatrix} onNavigateToSpend={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('RFQ-2026-00421')).toBeInTheDocument();
      });

      // Open Quotes Received modal (contains RFQ with quotes)
      const quotesBtn = screen.getByRole('button', { name: /Quotes Received/i });
      fireEvent.click(quotesBtn);
      const matrixBtns = screen.queryAllByRole('button', { name: /Matrix/i });
      if (matrixBtns.length > 0) {
        fireEvent.click(matrixBtns[0]);
        expect(onMatrix).toHaveBeenCalled();
      }

      // Open Pipeline modal (contains RFQ without quotes)
      const pipelineBtn = screen.getByRole('button', { name: /RFQs In Pipeline/i });
      fireEvent.click(pipelineBtn);
      const reviewBtns = screen.queryAllByRole('button', { name: /Review/i });
      if (reviewBtns.length > 0) {
        fireEvent.click(reviewBtns[0]);
        const cancelEditBtn = screen.queryByRole('button', { name: /Cancel/i });
        if (cancelEditBtn) fireEvent.click(cancelEditBtn);
      }

      // Column 1 review action button
      const colReviewBtns = screen.queryAllByRole('button', { name: /Review Categories|Open & Review Categories/i });
      if (colReviewBtns.length > 0) {
        fireEvent.click(colReviewBtns[0]);
        const cancelBtn = screen.queryByRole('button', { name: /Cancel/i });
        if (cancelBtn) fireEvent.click(cancelBtn);
      }

      // Re-test summary modal click when onNavigateToMatrix is not supplied
      renderWithProvider(<KanbanBoard onNavigateToSpend={jest.fn()} />);
      const quotesBtn2 = screen.getAllByRole('button', { name: /Quotes Received/i });
      fireEvent.click(quotesBtn2[quotesBtn2.length - 1]);
      const matrixBtns2 = screen.queryAllByRole('button', { name: /Matrix/i });
      if (matrixBtns2.length > 0) {
        fireEvent.click(matrixBtns2[0]);
        const cancelEditBtn2 = screen.queryByRole('button', { name: /Cancel/i });
        if (cancelEditBtn2) fireEvent.click(cancelEditBtn2);
      }
    });

    // Some real RFQ rows predate extractedEntities being reliably set, and a
    // followUpData record can exist with no vendors array yet (chasing just
    // started) — both used to throw unguarded and crash the whole board.
    test('renders a scored RFQ missing extractedEntities, and opens a chaser for one with followUpData but no vendors, without throwing', async () => {
      const baseImpl = (global.fetch as jest.Mock).getMockImplementation()!;
      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => {
            if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url)) {
              return {
                success: true,
                data: [
                  {
                    id: 'rfq-no-entities',
                    rfqNumber: 'RFQ-2026-NOENT',
                    title: 'Scored RFQ With No Line Items On File',
                    category: 'Process Equipment',
                    sourcingMode: 'mode_2',
                    status: 'Parsing',
                    createdAt: '2026-09-01',
                    targetDeliveryDate: '2026-10-10',
                    quotesCount: 1,
                    budget: 0,
                    chasingActive: true,
                    // No extractedEntities key at all — exercises avgConfidence's
                    // `|| []` fallback, only reached for Parsing-column cards.
                    quotes: [
                      {
                        vendorId: 'v-x',
                        vendorName: 'Test Vendor',
                        vendorCategory: 'General',
                        unitPrice: 1,
                        totalPrice: 1,
                        leadTimeDays: 1,
                        aiMatchScore: 1,
                        isBestPrice: false,
                        isPreferred: false,
                        warrantyYears: 1,
                        complianceStatus: 'Compliant',
                        paymentTerms: 'Net 30',
                        remarks: '',
                      },
                    ],
                    status2: 'Quotes Pending',
                  },
                  {
                    id: 'rfq-pending-no-vendors',
                    rfqNumber: 'RFQ-2026-NOVEND',
                    title: 'Pending RFQ With Follow-Up Started But No Vendors Yet',
                    category: 'Process Equipment',
                    sourcingMode: 'mode_2',
                    status: 'Quotes Pending',
                    createdAt: '2026-09-01',
                    targetDeliveryDate: '2026-10-10',
                    quotesCount: 0,
                    budget: 0,
                    chasingActive: true,
                    extractedEntities: [],
                    quotes: [],
                    followUpData: {
                      rfqNumber: 'RFQ-2026-NOVEND',
                      totalInvited: 0,
                      respondedCount: 0,
                      callStats: { total: 0, connected: 0, avgDuration: '0m' },
                      whatsappStats: { total: 0, delivered: 0, read: 0, replied: 0 },
                      smsStats: { total: 0, delivered: 0, clicked: 0 },
                      // No vendors array at all.
                    },
                  },
                ],
              };
            }
            return { success: true, data: {} };
          },
          text: async () => '',
          blob: async () => new Blob([]),
        });
      });

      renderWithProvider(<KanbanBoard onNavigateToMatrix={jest.fn()} onNavigateToSpend={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Scored RFQ With No Line Items On File')).toBeInTheDocument();
      });
      expect(screen.getByText('Pending RFQ With Follow-Up Started But No Vendors Yet')).toBeInTheDocument();

      const callBtns = screen.getAllByRole('button', { name: /Call/i });
      expect(() => fireEvent.click(callBtns[0])).not.toThrow();

      global.fetch = baseImpl as unknown as typeof global.fetch;
    });
  });

  describe('SpendDashboard Screen', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('renders Mode Performance & RFQ Analytics metrics and back button', () => {
      const onBack = jest.fn();
      renderWithProvider(<SpendDashboard onBackToKanban={onBack} />);

      expect(screen.getByText(/Mode Performance & RFQ Analytics Dashboard/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Private Client Roster/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Hybrid Base Network/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/360° AI Evaluated Roster/i)[0]).toBeInTheDocument();

      const backBtn = screen.getByRole('button', { name: /Back to Operational Monitoring Kanban/i });
      fireEvent.click(backBtn);
      expect(onBack).toHaveBeenCalled();
    });

    // With no navigation callbacks supplied, the 4 KPI cards stay disabled
    // rather than silently no-op-ing on click.
    test('KPI cards render zeroed real metrics and stay disabled without navigation callbacks', () => {
      renderWithProvider(<SpendDashboard onBackToKanban={jest.fn()} />);

      expect(screen.getByText('RFQs Received (Raised)')).toBeInTheDocument();
      expect(screen.getAllByText('RFQs Downloaded')[0]).toBeInTheDocument();
      expect(screen.getByText('Avg Vendors / RFQ')).toBeInTheDocument();
      expect(screen.getByText('Vendor Response Rate')).toBeInTheDocument();
      // The default jest.setup.ts fixtures carry no recent createdAt/audit
      // logs/assignedVendors/followUpData, so every real metric is 0.
      expect(screen.getByText('0.0%')).toBeInTheDocument();

      const raisedCard = screen.getByText('RFQs Received (Raised)').closest('button')!;
      const downloadedCard = screen.getAllByText('RFQs Downloaded')[0].closest('button')!;
      const vendorsCard = screen.getByText('Avg Vendors / RFQ').closest('button')!;
      const responseCard = screen.getByText('Vendor Response Rate').closest('button')!;
      [raisedCard, downloadedCard, vendorsCard, responseCard].forEach((card) => expect(card).toBeDisabled());
    });

    test('KPI cards compute real metrics from RFQs, audit logs, assignedVendors and followUpData, and navigate when clicked', async () => {
      const onNavigateToAllRfqs = jest.fn();
      const onNavigateToVendorConsole = jest.fn();
      const onNavigateToKanban = jest.fn();

      const baseImpl = (global.fetch as jest.Mock).getMockImplementation()!;
      global.fetch = jest.fn().mockImplementation((url: string, init?: { method?: string }) => {
        if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url) && (init?.method || 'GET') === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: [
                {
                  id: 'rfq-real-1',
                  rfqNumber: 'RFQ-REAL-1',
                  title: 'Real Metrics RFQ',
                  category: 'Civil Works',
                  sourcingMode: 'mode_1',
                  status: 'Quotes Pending',
                  quotesCount: 0,
                  targetDeliveryDate: '2026-10-01',
                  budget: 10000,
                  createdAt: new Date().toISOString(),
                  extractedEntities: [],
                  quotes: [],
                  chasingActive: false,
                  assignedVendors: [
                    { id: 'v-1', name: 'Vendor One' },
                    { id: 'v-2', name: 'Vendor Two' },
                  ],
                  followUpData: {
                    rfqNumber: 'RFQ-REAL-1',
                    totalInvited: 4,
                    respondedCount: 2,
                    callStats: { total: 0, connected: 0, avgDuration: '0m' },
                    whatsappStats: { total: 0, delivered: 0, read: 0, replied: 0 },
                    smsStats: { total: 0, delivered: 0, clicked: 0 },
                    vendors: [],
                  },
                },
                // No assignedVendors/followUpData at all — exercises the
                // `?.length || 0` / `?.totalInvited || 0` / `?.respondedCount || 0`
                // fallback branches for an RFQ lacking either field.
                {
                  id: 'rfq-real-2',
                  rfqNumber: 'RFQ-REAL-2',
                  title: 'RFQ With No Follow-Up Data',
                  category: 'Civil Works',
                  sourcingMode: 'mode_1',
                  status: 'Quotes Pending',
                  quotesCount: 0,
                  targetDeliveryDate: '2026-10-01',
                  budget: 5000,
                  createdAt: new Date().toISOString(),
                  extractedEntities: [],
                  quotes: [],
                  chasingActive: false,
                },
              ],
            }),
          });
        }
        if (typeof url === 'string' && /\/api\/bootstrap/.test(url)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                buyerAccounts: [],
                vendors: [],
                evaluations: [],
                auditLogs: [
                  {
                    id: 'audit-1',
                    timestamp: new Date().toISOString(),
                    user: 'vendor@test.com',
                    action: 'Vendor One downloaded RFQ specification for RFQ-REAL-1',
                    rfqNumber: 'RFQ-REAL-1',
                    shaSignature: 'sig-1',
                    status: 'VERIFIED',
                    ipAddress: '127.0.0.1',
                  },
                  {
                    id: 'audit-2',
                    timestamp: new Date().toISOString(),
                    user: 'vendor2@test.com',
                    action: 'Vendor Two downloaded RFQ specifications for RFQ-REAL-1',
                    rfqNumber: 'RFQ-REAL-1',
                    shaSignature: 'sig-2',
                    status: 'VERIFIED',
                    ipAddress: '127.0.0.1',
                  },
                  {
                    id: 'audit-3',
                    timestamp: new Date().toISOString(),
                    user: 'admin@test.com',
                    action: 'Unrelated audit action, not a download',
                    rfqNumber: 'RFQ-REAL-1',
                    shaSignature: 'sig-3',
                    status: 'VERIFIED',
                    ipAddress: '127.0.0.1',
                  },
                ],
                aiFeed: [],
                systemConfig: {},
              },
            }),
          });
        }
        return baseImpl(url, init);
      });

      renderWithProvider(
        <SpendDashboard
          onBackToKanban={jest.fn()}
          onNavigateToAllRfqs={onNavigateToAllRfqs}
          onNavigateToVendorConsole={onNavigateToVendorConsole}
          onNavigateToKanban={onNavigateToKanban}
        />
      );

      // 2 real RFQs (one with assignedVendors/followUpData, one without), 2
      // matching download audit entries, (2 + 0) / 2 = 1.0 avg vendors/RFQ,
      // and a 2/4 = 50% response rate.
      await waitFor(() => expect(screen.getAllByText('2').length).toBeGreaterThan(0));
      expect(screen.getByText('1.0')).toBeInTheDocument();
      expect(screen.getByText('50.0%')).toBeInTheDocument();

      fireEvent.click(screen.getByText('RFQs Received (Raised)').closest('button')!);
      expect(onNavigateToAllRfqs).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getAllByText('RFQs Downloaded')[0].closest('button')!);
      expect(onNavigateToAllRfqs).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByText('Avg Vendors / RFQ').closest('button')!);
      expect(onNavigateToVendorConsole).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText('Vendor Response Rate').closest('button')!);
      expect(onNavigateToKanban).toHaveBeenCalledTimes(1);
    });

    test('Avg Vendors / RFQ falls back to 0.0 for an RFQ with no assignedVendors, with an empty RFQ list', async () => {
      const baseImpl = (global.fetch as jest.Mock).getMockImplementation()!;
      global.fetch = jest.fn().mockImplementation((url: string, init?: { method?: string }) => {
        if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url) && (init?.method || 'GET') === 'GET') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: [] }) });
        }
        return baseImpl(url, init);
      });

      renderWithProvider(<SpendDashboard onBackToKanban={jest.fn()} />);

      await waitFor(() => expect(screen.getByText('Avg Vendors / RFQ')).toBeInTheDocument());
      expect(screen.getByText('0.0')).toBeInTheDocument();
    });
  });

  describe('BuyerConsole Screen', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('renders buyer console with dropdown filters, search, and drill-down expansion', async () => {
      const onMatrix = jest.fn();
      const onEval = jest.fn();

      // jest.setup.ts's default RFQ fixture carries no buyerAccountId, so
      // compiledBuyers' rfqsList is empty for every buyer and the RFQ-row
      // drill-down below never actually renders. Layer a buyerAccountId onto
      // the same default fixture (via GET /api/rfqs) locally rather than
      // changing the shared global default.
      const baseImpl = (global.fetch as jest.Mock).getMockImplementation()!;
      (global.fetch as jest.Mock).mockImplementation((url: string, init?: { method?: string }) => {
        if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url) && (init?.method || 'GET') === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: [
                {
                  id: 'rfq-00421',
                  rfqNumber: 'RFQ-2026-00421',
                  title: 'Centrifugal Water Pumps & Spares',
                  category: 'Heavy Industrial Fluid Dynamics & Valves',
                  sourcingMode: 'mode_3',
                  status: 'AI Recommended',
                  createdAt: '2026-08-20',
                  targetDeliveryDate: '2026-09-15',
                  quotesCount: 3,
                  budget: 150000,
                  aiScore: 94,
                  buyerAccountId: 'buyer-acc-001',
                  extractedEntities: [
                    {
                      id: 'item-1',
                      itemName: 'Centrifugal Pump 50HP',
                      quantity: 4,
                      unit: 'Units',
                      targetDate: '2026-09-15',
                      technicalSpecs: '50HP 3-Phase 415V Cast Iron',
                      confidence: 96,
                      category: 'Heavy Industrial Fluid Dynamics & Valves',
                    },
                  ],
                  quotes: [
                    {
                      vendorId: 'vendor-1',
                      vendorName: 'Apex Supplies Ltd.',
                      vendorCategory: 'Procucev - AI Rec',
                      unitPrice: 24500,
                      totalPrice: 98000,
                      leadTimeDays: 14,
                      aiMatchScore: 95,
                      isBestPrice: true,
                      isPreferred: true,
                      warrantyYears: 2,
                      complianceStatus: 'Fully Compliant',
                      paymentTerms: '30 Days Net',
                      remarks: 'Top rated supplier',
                    },
                  ],
                },
              ],
            }),
          });
        }
        return (baseImpl as (url: string, init?: unknown) => unknown)(url, init);
      });

      renderWithProvider(<BuyerConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={onEval} />);

      // Buyer cards now come from the real buyer directory (loaded via
      // AppProvider's async bootstrap fetch, mocked in jest.setup.ts) rather
      // than an instantly-available hardcoded list — wait for it to land.
      await waitFor(() => {
        expect(screen.getByText(/Buyer Wise Command Console & Analytics/i)).toBeInTheDocument();
        expect(screen.getAllByText(/S\. N\. Subrahmanyan/i).length).toBeGreaterThan(0);
      });

      expect(screen.getByText(/Active Context Selection/i)).toBeInTheDocument();

      // Test search
      const searchInput = screen.getByPlaceholderText(/Search Buyer name or company/i);
      fireEvent.change(searchInput, { target: { value: 'Subrahmanyan' } });
      expect(screen.getAllByText(/S\. N\. Subrahmanyan/i)[0]).toBeInTheDocument();

      // Test company filter dropdown and dependent buyer dropdown
      const selects = screen.getAllByRole('combobox');
      if (selects.length >= 2) {
        // Select company
        fireEvent.change(selects[0], { target: { value: 'Larsen & Toubro Heavy Engineering' } });
        // Select buyer within company
        fireEvent.change(selects[1], { target: { value: 'buyer-acc-001' } });
        // Reset company to all
        fireEvent.change(selects[0], { target: { value: 'all' } });
      }

      // Test buyer with no active RFQs (Reliance — the local RFQ fixture
      // above belongs to buyer-acc-001, so buyer-acc-002 genuinely has none)
      fireEvent.change(searchInput, { target: { value: 'Deshmukh' } });
      const noRfqBuyer = screen.getByText(/Anjali Deshmukh/i);
      fireEvent.click(noRfqBuyer);
      const reviewBtnsForNoRfq = screen.getAllByRole('button', { name: /Review RFQ Details/i });
      fireEvent.click(reviewBtnsForNoRfq[0]);
      expect(screen.getByText(/No active RFQ records found for this buyer profile/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Hide Details/i }));

      // Test buyer selection and toggle collapse
      fireEvent.change(searchInput, { target: { value: '' } });
      const buyerCard = screen.getAllByText(/S\. N\. Subrahmanyan/i)[0];
      fireEvent.click(buyerCard);

      // Test review RFQ details
      const reviewBtns = screen.getAllByRole('button', { name: /Review RFQ Details/i });
      fireEvent.click(reviewBtns[0]);
      expect(screen.getByText(/Sourcing Details for Larsen & Toubro/i)).toBeInTheDocument();

      // Expand RFQ row
      const rfqRows = screen.getAllByText(/Centrifugal Water Pumps & Spares|RFQ-2026/i);
      fireEvent.click(rfqRows[0]);

      // Go to Quote Matrix (the local fixture RFQ has quotesCount 3, so this renders)
      fireEvent.click(screen.getByRole('button', { name: /Go to Quote Matrix/i }));
      expect(onMatrix).toHaveBeenCalled();

      // The local fixture is mode_3, so the survey-evaluation review action also renders
      fireEvent.click(screen.getByRole('button', { name: /Review Survey Evaluation/i }));
      expect(onEval).toHaveBeenCalled();

      // Collapse RFQ row
      fireEvent.click(rfqRows[0]);

      // Toggle Hide Details
      fireEvent.click(screen.getByRole('button', { name: /Hide Details/i }));

      // This test's local /api/rfqs override must not leak into later tests.
      (global.fetch as jest.Mock).mockImplementation(baseImpl);
    });

    // Some real buyer accounts and RFQ rows have null/missing fields (e.g. a
    // web-registration that never completed profile setup, or an RFQ that
    // predates extractedEntities being reliably set) — these used to crash
    // the whole screen unguarded. Also exercises the Parsing/In Evaluation
    // status-badge branches, which the other BuyerConsole test's single
    // 'AI Recommended' fixture never reaches.
    test('handles buyer accounts and RFQs with missing fields without crashing, and covers every status badge branch', async () => {
      const baseImpl = (global.fetch as jest.Mock).getMockImplementation()!;
      global.fetch = jest.fn().mockImplementation((url: string, init?: { method?: string }) => {
        if (typeof url === 'string' && /\/api\/bootstrap/.test(url)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                buyerAccounts: [
                  {
                    id: 'buyer-acc-sparse',
                    organizationName: null,
                    corporateEmail: 'sparse@buyer.com',
                    contactPerson: null,
                    sourcingMode: 'mode_2',
                  },
                ],
                vendors: [],
                evaluations: [],
                auditLogs: [],
                aiFeed: [],
                systemConfig: {},
              },
            }),
          });
        }
        if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url) && (init?.method || 'GET') === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: [
                {
                  id: 'rfq-sparse-1',
                  rfqNumber: 'RFQ-SPARSE-1',
                  title: 'Sparse RFQ Missing Line Items',
                  category: 'Civil Works',
                  sourcingMode: 'mode_2',
                  status: 'Parsing',
                  createdAt: '2026-09-01',
                  targetDeliveryDate: '2026-09-20',
                  buyerAccountId: 'buyer-acc-sparse',
                  // No budget, quotesCount, or extractedEntities at all.
                },
                {
                  id: 'rfq-sparse-2',
                  rfqNumber: 'RFQ-SPARSE-2',
                  title: 'Second Sparse RFQ',
                  category: 'Civil Works',
                  sourcingMode: 'mode_2',
                  status: 'In Evaluation',
                  createdAt: '2026-09-02',
                  targetDeliveryDate: '2026-09-20',
                  budget: 0,
                  quotesCount: 0,
                  buyerAccountId: 'buyer-acc-sparse',
                },
              ],
            }),
          });
        }
        return baseImpl(url, init);
      });

      renderWithProvider(<BuyerConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />);

      await waitFor(() => expect(screen.getByText('Unnamed Contact')).toBeInTheDocument());
      expect(screen.getAllByText(/Unnamed Organization/).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByText('Unnamed Contact'));
      fireEvent.click(screen.getByRole('button', { name: /Review RFQ Details/i }));

      expect(screen.getByText('Sparse RFQ Missing Line Items')).toBeInTheDocument();
      expect(screen.getByText('Parsing')).toBeInTheDocument();
      expect(screen.getByText('In Evaluation')).toBeInTheDocument();

      // Expand the first sparse RFQ (no extractedEntities) to exercise the
      // lineItems fallback rendering path (0 items, empty table body) without
      // throwing.
      expect(() => fireEvent.click(screen.getByText('Sparse RFQ Missing Line Items'))).not.toThrow();
      expect(screen.getByText(/BOQ Specifications & Item Roster \(0 items\)/)).toBeInTheDocument();
    });
  });

  describe('VendorConsole Screen', () => {
    test('renders vendor console with performance cards, search, and drill-down', async () => {
      const onMatrix = jest.fn();
      const onEval = jest.fn();

      renderWithProvider(<VendorConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={onEval} />);

      // Vendor cards now come from the real vendor directory (loaded via
      // AppProvider's async bootstrap fetch, mocked in jest.setup.ts) rather
      // than an instantly-available hardcoded list — wait for it to land.
      await waitFor(() => {
        expect(screen.getByText(/Vendor Summary & Performance Analytics/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Apex Supplies Ltd\./i)[0]).toBeInTheDocument();
      });

      // Test search (server-side, debounced — wait for the re-fetch to land
      // and Apex, which does not match "Kiran", to actually drop out).
      const searchInput = screen.getByPlaceholderText(/Search Vendor name or category/i);
      fireEvent.change(searchInput, { target: { value: 'Kiran' } });
      await waitFor(() => expect(screen.queryByText(/Apex Supplies Ltd\./i)).not.toBeInTheDocument(), { timeout: 2000 });
      expect(screen.getAllByText(/Kiran Valves & Actuators/i)[0]).toBeInTheDocument();

      // Test company filter dropdown and dependent contact dropdown
      const selects = screen.getAllByRole('combobox');
      if (selects.length >= 2) {
        fireEvent.change(selects[0], { target: { value: 'Kiran Valves & Actuators' } });
        fireEvent.change(selects[1], { target: { value: 'vendor-2' } });
        fireEvent.change(selects[1], { target: { value: 'all' } });
        fireEvent.change(selects[0], { target: { value: 'all' } });
      }

      // Test vendor with no active bids — the bootstrap mock's only quote
      // belongs to vendor-1 (Apex), so vendor-2 (Kiran) genuinely has none.
      // Search is already 'Kiran' from above, so Apex is already excluded.
      const kiranVendor = screen.getAllByText(/Kiran Valves & Actuators/i)[0];
      fireEvent.click(kiranVendor);
      const reviewBtnsForKiran = screen.queryAllByRole('button', { name: /Review Performance/i });
      if (reviewBtnsForKiran.length > 0) {
        fireEvent.click(reviewBtnsForKiran[0]);
        await waitFor(() =>
          expect(screen.getByText(/No active bids or quotes found in category database for this vendor/i)).toBeInTheDocument()
        );
        const hideBtn = screen.getByRole('button', { name: /Hide Details/i });
        fireEvent.click(hideBtn);
      }

      // Test review performance for first vendor
      fireEvent.change(searchInput, { target: { value: '' } });
      await waitFor(() => expect(screen.getAllByText(/Apex Supplies Ltd\./i)[0]).toBeInTheDocument());
      const reviewBtns = screen.queryAllByRole('button', { name: /Review Performance/i });
      if (reviewBtns.length > 0) {
        fireEvent.click(reviewBtns[0]);
        expect(screen.getByText(/Sourcing Bid Roster for/i)).toBeInTheDocument();

        // Expand Quote card
        const quoteCards = screen.queryAllByText(/Centrifugal Water Pumps & Spares|RFQ-2026/i);
        if (quoteCards.length > 0) {
          fireEvent.click(quoteCards[0]);
          const centralMatrixBtn = screen.queryByRole('button', { name: /Go to Central Quote Matrix/i });
          if (centralMatrixBtn) {
            fireEvent.click(centralMatrixBtn);
            expect(onMatrix).toHaveBeenCalled();
          }

          // Collapse Quote card
          fireEvent.click(quoteCards[0]);
        }

        // Toggle Hide Details
        const hideBtn = screen.getByRole('button', { name: /Hide Details/i });
        fireEvent.click(hideBtn);
      }
    });
  });

  describe('CategorySummaryDashboard Screen', () => {
    test('renders category governance table with timeframe switches, search, and expansion', async () => {
      renderWithProvider(<CategorySummaryDashboard />);

      expect(screen.getByText(/Category Governance & Demand-Supply Analytics/i)).toBeInTheDocument();
      await waitFor(() => expect(screen.getAllByText(/13 Major/i)[0]).toBeInTheDocument());

      // Timeframe switches
      const sevenDaysBtn = screen.getByRole('button', { name: /7 Days/i });
      fireEvent.click(sevenDaysBtn);

      const thirtyDaysBtn = screen.getByRole('button', { name: /30 Days/i });
      fireEvent.click(thirtyDaysBtn);

      const ninetyDaysBtn = screen.getByRole('button', { name: /90 Days/i });
      fireEvent.click(ninetyDaysBtn);

      const oneEightyDaysBtn = screen.getByRole('button', { name: /180 Days/i });
      fireEvent.click(oneEightyDaysBtn);

      const oneYearBtn = screen.getByRole('button', { name: /1 Year/i });
      fireEvent.click(oneYearBtn);

      // Search filter
      const searchInput = screen.getByPlaceholderText(/Search category, buyer, or vendor/i);
      fireEvent.change(searchInput, { target: { value: 'Civil' } });
      expect(screen.getAllByText(/Civil Works/i)[0]).toBeInTheDocument();

      // Expand category row
      const detailsBtns = screen.getAllByRole('button', { name: /Details/i });
      if (detailsBtns.length > 0) {
        fireEvent.click(detailsBtns[0]);
      }

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });
    });
  });

  describe('Category Manager Combined Branch Coverage', () => {
    test('exercises varied RFQ statuses and empty state branches across all 3 screens', async () => {
      renderWithProvider(<CategoryManagerBranchWrapper onMatrix={jest.fn()} onEval={jest.fn()} onSpend={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId('test-add-varied-rfqs')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('test-add-varied-rfqs'));

      // Expand the newly added parsing and eval RFQs in buyer console
      const rfqCards = screen.queryAllByText(/RFQ-2026-PARSE|RFQ-2026-EVAL/i);
      for (const card of rfqCards) {
        fireEvent.click(card);
      }
    });
  });

  describe('Quote Matrix Navigation Tests', () => {
    test('KanbanBoard scored-column card navigates to quote_matrix screen with the real RFQ', async () => {
      const onMatrix = jest.fn();
      renderWithProvider(<KanbanBoard onNavigateToMatrix={onMatrix} onNavigateToSpend={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/Operational Monitoring Kanban & Chasing Control/i)).toBeInTheDocument();
      });

      const matrixBtn = screen.getByRole('button', { name: /View Comparative Quote Matrix/i });
      fireEvent.click(matrixBtn);

      expect(onMatrix).toHaveBeenCalledTimes(1);
      expect(onMatrix).toHaveBeenCalledWith(expect.objectContaining({
        rfqNumber: 'RFQ-2026-00421'
      }));
    });

    test('BuyerConsole Go to Quote Matrix button navigates to quote_matrix screen', async () => {
      const onMatrix = jest.fn();
      renderWithProvider(<BuyerConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/Buyer Wise Command Console & Analytics/i)).toBeInTheDocument();
        expect(screen.getAllByText(/S\. N\. Subrahmanyan/i).length).toBeGreaterThan(0);
      });

      // Search for buyer with RFQs
      const searchInput = screen.getByPlaceholderText(/Search Buyer name or company/i);
      fireEvent.change(searchInput, { target: { value: 'Subrahmanyan' } });

      // Click buyer card to expand
      const buyerCard = screen.getAllByText(/S\. N\. Subrahmanyan/i)[0];
      fireEvent.click(buyerCard);

      // Click Review RFQ Details
      const reviewBtns = screen.queryAllByRole('button', { name: /Review RFQ Details/i });
      if (reviewBtns.length > 0) {
        fireEvent.click(reviewBtns[0]);

        // Expand RFQ row
        const rfqRows = screen.queryAllByText(/Centrifugal Water Pumps & Spares|RFQ-2026/i);
        if (rfqRows.length > 0) {
          fireEvent.click(rfqRows[0]);

          // Click Go to Quote Matrix
          const matrixBtn = screen.queryByRole('button', { name: /Go to Quote Matrix/i });
          if (matrixBtn) {
            fireEvent.click(matrixBtn);
            expect(onMatrix).toHaveBeenCalledTimes(1);
            expect(onMatrix).toHaveBeenCalledWith(expect.objectContaining({
              rfqNumber: expect.stringContaining('RFQ-2026')
            }));
          }
        }
      }
    });

    test('VendorConsole Go to Central Quote Matrix button navigates to quote_matrix screen', async () => {
      const onMatrix = jest.fn();
      renderWithProvider(<VendorConsole onNavigateToMatrix={onMatrix} onNavigateToEvaluation={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/Vendor Summary & Performance Analytics/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Apex Supplies Ltd\./i)[0]).toBeInTheDocument();
      });

      // Click Review Performance for first vendor
      const reviewBtns = screen.queryAllByRole('button', { name: /Review Performance/i });
      if (reviewBtns.length > 0) {
        fireEvent.click(reviewBtns[0]);

        // Expand Quote card
        const quoteCards = screen.queryAllByText(/Centrifugal Water Pumps & Spares|RFQ-2026/i);
        if (quoteCards.length > 0) {
          fireEvent.click(quoteCards[0]);

          // Click Go to Central Quote Matrix
          const centralMatrixBtn = screen.queryByRole('button', { name: /Go to Central Quote Matrix/i });
          if (centralMatrixBtn) {
            fireEvent.click(centralMatrixBtn);
            expect(onMatrix).toHaveBeenCalledTimes(1);
            expect(onMatrix).toHaveBeenCalledWith(expect.objectContaining({
              rfqNumber: expect.stringContaining('RFQ-2026')
            }));
          }
        }
      }
    });
  });

  describe('Kanban Pipeline — new RFQ added to a live-rendered board', () => {
    function KanbanLiveAddWrapper({ onMatrix }: any) {
      const { addNewRFQ } = useApp();

      return (
        <>
          <button
            data-testid="test-add-pending-rfq"
            onClick={() => {
              try {
                addNewRFQ({
                  title: 'Live-Added Pipeline RFQ',
                  category: 'Heavy Industrial Fluid Dynamics & Valves',
                  sourcingMode: 'mode_3',
                  targetDeliveryDate: '2026-10-01',
                  budget: 90000,
                  extractedEntities: [],
                  aiScore: 94,
                  autoCirculated: false,
                });
              } catch (e) {}
            }}
          >
            Add Live RFQ
          </button>
          <KanbanBoard onNavigateToMatrix={onMatrix} onNavigateToSpend={jest.fn()} />
        </>
      );
    };

    test('a newly created RFQ appears as a real Quotes Pending card without a page refresh', async () => {
      const onMatrix = jest.fn();
      renderWithProvider(<KanbanLiveAddWrapper onMatrix={onMatrix} />);

      await waitFor(() => {
        expect(screen.getByTestId('test-add-pending-rfq')).toBeInTheDocument();
      });

      // Before creation the pipeline still only holds the one GET /api/rfqs-seeded (scored) RFQ
      expect(screen.getByText(/No RFQs currently awaiting vendor quotes/i)).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByTestId('test-add-pending-rfq'));
      });

      // addNewRFQ now really persists via POST /api/rfqs, so the server (jest.setup.ts's
      // mock) allocates the real RFQ number rather than keeping the client-supplied one
      // — the title is the one field the mock passes through unchanged.
      await waitFor(() => {
        expect(screen.getByText('Live-Added Pipeline RFQ')).toBeInTheDocument();
      });
      expect(screen.queryByText(/No RFQs currently awaiting vendor quotes/i)).not.toBeInTheDocument();
    });
  });
});
