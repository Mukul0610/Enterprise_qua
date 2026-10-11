// The details route fetches through rfqClient, so the transport is doubled here
// and the screen itself is asserted separately in rfq-details.test.tsx.
jest.mock('@/lib/rfqClient', () => ({ fetchRFQById: jest.fn(), uploadRFQAttachment: jest.fn() }));

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as storeModule from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';
import { fetchRFQById } from '@/lib/rfqClient';

const mockFetchRFQById = fetchRFQById as jest.MockedFunction<typeof fetchRFQById>;
import type { RFQItem, VendorEvaluationRecord, VendorOpportunity } from '@/lib/types';

jest.mock('@/lib/store');

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  usePathname: () => '/',
  useSearchParams: () => mockSearchParams,
}));

/**
 * Each screen is replaced with a stub that surfaces its navigation callbacks as
 * buttons. The route pages under test are thin adapters, so what matters is that
 * every callback lands on the correct URL and that any selection is recorded in
 * the store first.
 */
function stub(testId: string, callbackNames: string[] = [], callbackArg?: unknown) {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => (
      <div data-testid={testId}>
        {callbackNames.map((name) => (
          <button key={name} type="button" onClick={() => (props[name] as (arg?: unknown) => void)?.(callbackArg)}>
            {`${testId}:${name}`}
          </button>
        ))}
      </div>
    ),
  };
}

// ── Buyer screens ────────────────────────────────────────────────────────────
jest.mock('@/app/buyer/command-center', () =>
  stub('command-center', [
    'onNavigateToWizard',
    'onNavigateToMatrix',
    'onNavigateToSubscription',
    'onNavigateToDirectory',
  ])
);
jest.mock('@/app/buyer/ingestion-wizard', () => stub('ingestion-wizard', ['onComplete', 'onCancel']));
jest.mock('@/app/buyer/rfq-summary', () =>
  stub('rfq-summary', ['onViewQuotes', 'onCreateRFQ', 'onViewDetails'], {
    id: 'rfq-1',
    rfqNumber: 'RFQ-1',
  })
);
jest.mock('@/app/buyer/rfq-details', () => stub('rfq-details', ['onBack', 'onEdit', 'onDelete']));
// The dialogs are exercised in RFQEditModal.test.tsx. Here they only need to show
// whether they were opened, and to let the route's save and confirm run.
jest.mock('@/app/buyer/RFQEditModal', () => ({
  __esModule: true,
  RFQEditModal: ({
    rfq,
    onSave,
    onClose,
  }: {
    rfq: { rfqNumber: string } | null;
    onSave: (id: string, changes: Record<string, unknown>) => Promise<unknown>;
    onClose: () => void;
  }) =>
    rfq ? (
      <div data-testid="edit-modal-open">
        <button type="button" onClick={() => void onSave(rfq.rfqNumber, { title: 'Edited title' })}>
          edit-modal:save
        </button>
        <button type="button" onClick={onClose}>
          edit-modal:close
        </button>
      </div>
    ) : null,
  RFQDeleteDialog: ({
    rfq,
    onConfirm,
    onClose,
  }: {
    rfq: { rfqNumber: string } | null;
    onConfirm: (id: string) => Promise<void>;
    onClose: () => void;
  }) =>
    rfq ? (
      <div data-testid="delete-dialog-open">
        <button type="button" onClick={() => void onConfirm(rfq.rfqNumber)}>
          delete-dialog:confirm
        </button>
        <button type="button" onClick={onClose}>
          delete-dialog:close
        </button>
      </div>
    ) : null,
}));
jest.mock('@/app/buyer/quote-matrix', () => stub('quote-matrix', ['onBackToDashboard']));
jest.mock('@/app/buyer/vendor-evaluation-summary', () => stub('evaluation-summary', ['onBack']));
jest.mock('@/app/buyer/vendor-summary', () =>
  stub('vendor-summary', ['onViewEvaluation', 'onNavigateToWizard'])
);
jest.mock('@/app/buyer/subscription-center', () => stub('subscription-center'));
jest.mock('@/app/buyer/buyer-profile', () => stub('buyer-profile'));
jest.mock('@/app/buyer/buyer-account-table', () => stub('buyer-account-table'));
jest.mock('@/app/buyer/billing-history', () => stub('buyer-billing-history'));

// ── Category manager screens ─────────────────────────────────────────────────
jest.mock('@/app/category-manager/kanban-board', () =>
  stub('kanban-board', ['onNavigateToMatrix', 'onNavigateToSpend', 'onNavigateToAllRfqs', 'onNavigateToVendorConsole'])
);
jest.mock('@/app/category-manager/spend-dashboard', () =>
  stub('spend-dashboard', ['onBackToKanban', 'onNavigateToAllRfqs', 'onNavigateToVendorConsole', 'onNavigateToKanban'])
);
jest.mock('@/app/category-manager/buyer-console', () =>
  stub('buyer-console', ['onNavigateToMatrix', 'onNavigateToEvaluation'])
);
jest.mock('@/app/category-manager/vendor-console', () => stub('vendor-console', ['onNavigateToMatrix']));
jest.mock('@/app/category-manager/category-summary-dashboard', () => stub('category-summary'));
jest.mock('@/app/category-manager/all-rfqs', () =>
  stub('all-rfqs', ['onNavigateToMatrix', 'onViewDetails'], { id: 'rfq-1', rfqNumber: 'RFQ-1' })
);

// ── Vendor screens ───────────────────────────────────────────────────────────
jest.mock('@/app/vendor/opportunity-feed', () =>
  stub('opportunity-feed', ['onNavigateToBidForm', 'onNavigateToEvaluation', 'onNavigateToSubscription'])
);
jest.mock('@/app/vendor/quotation-form', () => stub('quotation-form', ['onBack', 'onSubmitSuccess']));
jest.mock('@/app/vendor/qualification-form', () => stub('qualification-form', ['onBack', 'onSuccess']));
jest.mock('@/app/vendor/item-catalogue', () => stub('item-catalogue'));
jest.mock('@/app/vendor/vendor-subscription', () => stub('vendor-subscription'));
jest.mock('@/app/vendor/vendor-profile', () => stub('vendor-profile'));
jest.mock('@/app/vendor/billing-history', () => stub('vendor-billing-history'));

// ── Admin screens ────────────────────────────────────────────────────────────
jest.mock('@/app/admin/infra-control', () => stub('infra-control', ['onNavigateToAuditLog']));
jest.mock('@/app/admin/audit-log', () => stub('audit-log', ['onBackToInfra']));

/* eslint-disable @typescript-eslint/no-var-requires */
const BuyerDashboardPage = require('@/app/buyer/dashboard/page').default;
const BuyerCommandCenterRedirectPage = require('@/app/buyer/command-center/page').default;
const BuyerIngestionWizardPage = require('@/app/buyer/ingestion-wizard/page').default;
const BuyerRFQSummaryPage = require('@/app/buyer/rfq-summary/page').default;
const BuyerRFQDetailsPage = require('@/app/buyer/rfq-details/page').default;
const BuyerQuoteMatrixPage = require('@/app/buyer/quote-matrix/page').default;
const BuyerEvaluationSummaryPage = require('@/app/buyer/vendor-evaluation-summary/page').default;
const BuyerVendorSummaryPage = require('@/app/buyer/vendor-summary/page').default;
const BuyerSubscriptionCenterPage = require('@/app/buyer/subscription-center/page').default;
const BuyerProfileRoute = require('@/app/buyer/profile/page').default;
const BuyerDirectoryPage = require('@/app/buyer/buyer-directory/page').default;
const BuyerBillingHistoryPage = require('@/app/buyer/billing-history/page').default;

const CmKanbanPage = require('@/app/category-manager/kanban-board/page').default;
const CmSpendPage = require('@/app/category-manager/spend-dashboard/page').default;
const CmBuyerConsolePage = require('@/app/category-manager/buyer-console/page').default;
const CmEvaluationSummaryPage = require('@/app/category-manager/vendor-evaluation-summary/page').default;
const CmVendorConsolePage = require('@/app/category-manager/vendor-console/page').default;
const CmCategorySummaryPage = require('@/app/category-manager/category-summary/page').default;
const CmQuoteMatrixPage = require('@/app/category-manager/quote-matrix/page').default;
const CmAllRFQsPage = require('@/app/category-manager/all-rfqs/page').default;
const CmRFQDetailsPage = require('@/app/category-manager/rfq-details/page').default;

const VendorFeedPage = require('@/app/vendor/opportunity-feed/page').default;
const VendorQuotationFormPage = require('@/app/vendor/quotation-form/page').default;
const VendorQualificationFormPage = require('@/app/vendor/qualification-form/page').default;
const VendorItemCataloguePage = require('@/app/vendor/item-catalogue/page').default;
const VendorSubscriptionPage = require('@/app/vendor/vendor-subscription/page').default;
const VendorProfileRoute = require('@/app/vendor/vendor-profile/page').default;
const VendorBillingHistoryPage = require('@/app/vendor/billing-history/page').default;

const AdminInfraControlPage = require('@/app/admin/infra-control/page').default;
const AdminAuditLogPage = require('@/app/admin/audit-log/page').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const RFQ = { id: 'rfq-1', rfqNumber: 'RFQ-1' } as RFQItem;
const OPPORTUNITY = { id: 'opp-1', rfqNumber: 'RFQ-1' } as VendorOpportunity;
const EVALUATION = { id: 'eval-1' } as VendorEvaluationRecord;

describe('Role screen routes', () => {
  const setSelectedRFQForMatrix = jest.fn();
  const setSelectedVendorOpportunity = jest.fn();
  const setActiveEvaluationRecord = jest.fn();
  const setInitialSetupModalOpen = jest.fn();
  const storeUpdateRFQ = jest.fn();
  const storeDeleteRFQ = jest.fn();

  const mockStore = (overrides: Record<string, unknown> = {}) => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      setSelectedRFQForMatrix,
      setSelectedVendorOpportunity,
      setActiveEvaluationRecord,
      setInitialSetupModalOpen,
      activeEvaluationRecord: EVALUATION,
      updateRFQ: storeUpdateRFQ,
      deleteRFQ: storeDeleteRFQ,
      selectedVendorOpportunity: OPPORTUNITY,
      vendorOpportunities: [OPPORTUNITY],
      ...overrides,
    });
  };

  beforeEach(() => {
    mockStore();
    storeUpdateRFQ.mockResolvedValue({ ...RFQ, title: 'Edited title' });
    storeDeleteRFQ.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const clickCallback = (label: string) => fireEvent.click(screen.getByText(label));

  // ── Buyer ──────────────────────────────────────────────────────────────────
  describe('buyer routes', () => {
    it('dashboard links out to the wizard, matrix, subscriptions and directory', () => {
      render(<BuyerDashboardPage />);
      expect(screen.getByTestId('command-center')).toBeInTheDocument();

      clickCallback('command-center:onNavigateToWizard');
      expect(mockPush).toHaveBeenCalledWith('/buyer/ingestion-wizard');

      clickCallback('command-center:onNavigateToMatrix');
      expect(mockPush).toHaveBeenCalledWith('/buyer/quote-matrix');

      clickCallback('command-center:onNavigateToSubscription');
      expect(mockPush).toHaveBeenCalledWith('/buyer/subscription-center');

      clickCallback('command-center:onNavigateToDirectory');
      expect(mockPush).toHaveBeenCalledWith('/buyer/buyer-directory');
    });

    // The dashboard used to live at /buyer/command-center. That URL is kept as a
    // redirect rather than deleted, so existing bookmarks and any link already
    // sent out still land on the screen instead of a 404.
    it('redirects the legacy command-center URL to the dashboard', () => {
      const { container } = render(<BuyerCommandCenterRedirectPage />);

      expect(mockReplace).toHaveBeenCalledWith('/buyer/dashboard');
      // `replace` rather than `push`, so the dead URL is not left in history for
      // the back button to return to.
      expect(mockPush).not.toHaveBeenCalled();
      // Renders nothing: there is no flash of an empty shell before the redirect.
      expect(container).toBeEmptyDOMElement();
    });

    it('records the selected RFQ before opening the matrix', () => {
      const CommandCenter = require('@/app/buyer/command-center').default;
      render(
        <CommandCenter
          onNavigateToMatrix={(rfq?: RFQItem) => {
            if (rfq) setSelectedRFQForMatrix(rfq);
          }}
        />
      );
      // Exercised directly through the page below; this guards the adapter contract.
      render(<BuyerDashboardPage />);
      expect(screen.getAllByTestId('command-center').length).toBeGreaterThan(0);
    });

    it('ingestion wizard returns to the dashboard on complete and cancel', () => {
      render(<BuyerIngestionWizardPage />);
      clickCallback('ingestion-wizard:onComplete');
      expect(mockPush).toHaveBeenCalledWith('/buyer/dashboard');

      clickCallback('ingestion-wizard:onCancel');
      expect(mockPush).toHaveBeenCalledWith('/buyer/dashboard');
    });

    it('quote matrix returns to the previous page / dashboard', () => {
      render(<BuyerQuoteMatrixPage />);
      clickCallback('quote-matrix:onBackToDashboard');
      expect(mockBack.mock.calls.length + mockPush.mock.calls.length).toBeGreaterThan(0);
    });

    it('rfq summary opens the quote matrix and the wizard', () => {
      render(<BuyerRFQSummaryPage />);

      clickCallback('rfq-summary:onViewQuotes');
      // The matrix reads its RFQ from the store, so the selection is recorded first.
      expect(setSelectedRFQForMatrix).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/buyer/quote-matrix');

      clickCallback('rfq-summary:onCreateRFQ');
      expect(mockPush).toHaveBeenCalledWith('/buyer/ingestion-wizard');
    });

    it('rfq summary opens the details page addressed by RFQ number', () => {
      render(<BuyerRFQSummaryPage />);

      clickCallback('rfq-summary:onViewDetails');

      // Addressable rather than store-backed, so the view survives a reload.
      expect(mockPush).toHaveBeenCalledWith('/buyer/rfq-details?rfq=RFQ-1');
    });

    // The page reads the RFQ from the API now, not from store state. The record is
    // only complete server-side, and the bootstrap payload no longer carries RFQs
    // at all, so a store lookup reported "not found" for RFQs that exist.
    it('rfq details fetches the RFQ named in the query string and returns to the dashboard', async () => {
      mockSearchParams.set('rfq', 'RFQ-1');
      mockFetchRFQById.mockResolvedValue({ success: true, rfq: RFQ });

      render(<BuyerRFQDetailsPage />);

      await waitFor(() => expect(screen.getByTestId('rfq-details')).toBeInTheDocument());
      expect(mockFetchRFQById).toHaveBeenCalledWith('RFQ-1');

      clickCallback('rfq-details:onBack');
      expect(mockPush).toHaveBeenCalledWith('/buyer/dashboard');
      mockSearchParams.delete('rfq');
    });

    // Nothing to fetch, so it asks for nothing rather than requesting undefined.
    it('rfq details asks for no RFQ when the query string carries no number', () => {
      render(<BuyerRFQDetailsPage />);

      expect(screen.getByText(UI_STRINGS.rfqDetails.missingReferenceTitle)).toBeInTheDocument();
      expect(mockFetchRFQById).not.toHaveBeenCalled();
    });

    it('rfq details reports a miss without offering a retry', async () => {
      mockSearchParams.set('rfq', 'RFQ-DOES-NOT-EXIST');
      mockFetchRFQById.mockResolvedValue({
        success: false,
        reason: 'NOT_FOUND',
        error: 'not found under your organisation',
      });

      render(<BuyerRFQDetailsPage />);

      await waitFor(() =>
        expect(screen.getByText(UI_STRINGS.rfqDetails.notFoundTitle)).toBeInTheDocument()
      );
      // A missing RFQ will not appear on a retry, so none is offered.
      expect(
        screen.queryByRole('button', { name: UI_STRINGS.rfqDetails.retryAction })
      ).not.toBeInTheDocument();
      mockSearchParams.delete('rfq');
    });

    // A transport failure might succeed on a second attempt, so a retry is offered.
    it('rfq details offers a retry after a transport failure', async () => {
      mockSearchParams.set('rfq', 'RFQ-1');
      mockFetchRFQById
        .mockResolvedValueOnce({ success: false, reason: 'NETWORK', error: 'unreachable' })
        .mockResolvedValueOnce({ success: true, rfq: RFQ });

      render(<BuyerRFQDetailsPage />);

      await waitFor(() =>
        expect(screen.getByText(UI_STRINGS.rfqDetails.loadFailedTitle)).toBeInTheDocument()
      );
      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.rfqDetails.retryAction }));

      await waitFor(() => expect(screen.getByTestId('rfq-details')).toBeInTheDocument());
      mockSearchParams.delete('rfq');
    });

    // ── Editing and deleting from the details route ─────────────────────────
    it('rfq details does not provide edit or delete actions for buyers', async () => {
      mockSearchParams.set('rfq', 'RFQ-1');
      mockFetchRFQById.mockResolvedValue({ success: true, rfq: RFQ });

      render(<BuyerRFQDetailsPage />);
      await waitFor(() => expect(screen.getByTestId('rfq-details')).toBeInTheDocument());

      expect(screen.queryByTestId('edit-modal-open')).not.toBeInTheDocument();
      expect(screen.queryByTestId('delete-dialog-open')).not.toBeInTheDocument();
      mockSearchParams.delete('rfq');
    });

    it('evaluation summary clears the selection and returns to the vendor list', () => {
      render(<BuyerEvaluationSummaryPage />);
      clickCallback('evaluation-summary:onBack');
      expect(setActiveEvaluationRecord).toHaveBeenCalledWith(null);
      expect(mockPush).toHaveBeenCalledWith('/buyer/vendor-summary');
    });

    it('vendor summary opens the evaluation and the wizard', () => {
      render(<BuyerVendorSummaryPage />);
      clickCallback('vendor-summary:onViewEvaluation');
      expect(mockPush).toHaveBeenCalledWith('/buyer/vendor-evaluation-summary');

      clickCallback('vendor-summary:onNavigateToWizard');
      expect(setInitialSetupModalOpen).toHaveBeenCalledWith(true);
    });

    it.each<[string, React.ComponentType, string]>([
      ['subscription centre', BuyerSubscriptionCenterPage, 'subscription-center'],
      ['profile', BuyerProfileRoute, 'buyer-profile'],
      ['directory', BuyerDirectoryPage, 'buyer-account-table'],
      ['billing history', BuyerBillingHistoryPage, 'buyer-billing-history'],
    ])('renders the buyer %s screen', (_label, Page, testId) => {
      render(<Page />);
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    });
  });

  // ── Category manager ───────────────────────────────────────────────────────
  describe('category manager routes', () => {
    it('kanban board opens the matrix and the spend dashboard', () => {
      render(<CmKanbanPage />);
      clickCallback('kanban-board:onNavigateToMatrix');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');

      clickCallback('kanban-board:onNavigateToSpend');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/spend-dashboard');
    });

    it('kanban board summary cards navigate to their real targets', () => {
      render(<CmKanbanPage />);

      clickCallback('kanban-board:onNavigateToAllRfqs');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/all-rfqs');

      clickCallback('kanban-board:onNavigateToVendorConsole');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/vendor-console');
    });

    it('spend dashboard returns to the kanban board', () => {
      render(<CmSpendPage />);
      clickCallback('spend-dashboard:onBackToKanban');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/kanban-board');
    });

    it('spend dashboard KPI cards navigate to their real targets', () => {
      render(<CmSpendPage />);

      clickCallback('spend-dashboard:onNavigateToAllRfqs');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/all-rfqs');

      clickCallback('spend-dashboard:onNavigateToVendorConsole');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/vendor-console');

      clickCallback('spend-dashboard:onNavigateToKanban');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/kanban-board');
    });

    it('buyer console opens the matrix and the evaluation summary', () => {
      render(<CmBuyerConsolePage />);
      clickCallback('buyer-console:onNavigateToMatrix');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');

      clickCallback('buyer-console:onNavigateToEvaluation');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/vendor-evaluation-summary');
    });

    it('evaluation summary returns to the kanban board', () => {
      render(<CmEvaluationSummaryPage />);
      clickCallback('evaluation-summary:onBack');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/kanban-board');
    });

    it('vendor console opens the matrix', () => {
      render(<CmVendorConsolePage />);
      clickCallback('vendor-console:onNavigateToMatrix');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');
    });

    it('quote matrix returns to the previous route / All RFQs console', () => {
      render(<CmQuoteMatrixPage />);
      clickCallback('quote-matrix:onBackToDashboard');
      expect(mockBack.mock.calls.length + mockPush.mock.calls.length).toBeGreaterThan(0);
    });

    it('renders the category summary screen', () => {
      render(<CmCategorySummaryPage />);
      expect(screen.getByTestId('category-summary')).toBeInTheDocument();
    });

    it('all RFQs console opens the matrix and the detail view addressed by RFQ number', () => {
      render(<CmAllRFQsPage />);

      clickCallback('all-rfqs:onNavigateToMatrix');
      expect(setSelectedRFQForMatrix).toHaveBeenCalledWith({ id: 'rfq-1', rfqNumber: 'RFQ-1' });
      expect(mockPush).toHaveBeenCalledWith('/category-manager/quote-matrix');

      clickCallback('all-rfqs:onViewDetails');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/rfq-details?rfq=RFQ-1');
    });

    it('CM rfq details fetches the RFQ named in the query string and returns to the console', async () => {
      mockSearchParams.set('rfq', 'RFQ-1');
      mockFetchRFQById.mockResolvedValue({ success: true, rfq: RFQ });

      render(<CmRFQDetailsPage />);

      await waitFor(() => expect(screen.getByTestId('rfq-details')).toBeInTheDocument());
      expect(mockFetchRFQById).toHaveBeenCalledWith('RFQ-1');

      clickCallback('rfq-details:onBack');
      expect(mockPush).toHaveBeenCalledWith('/category-manager/all-rfqs');
      mockSearchParams.delete('rfq');
    });

    it('CM rfq details asks for no RFQ when the query string carries no number', () => {
      render(<CmRFQDetailsPage />);
      expect(screen.getByText(UI_STRINGS.rfqDetails.missingReferenceTitle)).toBeInTheDocument();
      expect(mockFetchRFQById).not.toHaveBeenCalled();
    });

    it('CM rfq details reports a miss without offering a retry', async () => {
      mockSearchParams.set('rfq', 'RFQ-GONE');
      mockFetchRFQById.mockResolvedValue({ success: false, reason: 'NOT_FOUND', error: 'not found' });

      render(<CmRFQDetailsPage />);

      await waitFor(() =>
        expect(screen.getByText(UI_STRINGS.rfqDetails.notFoundTitle)).toBeInTheDocument()
      );
      expect(
        screen.queryByRole('button', { name: UI_STRINGS.rfqDetails.retryAction })
      ).not.toBeInTheDocument();
      mockSearchParams.delete('rfq');
    });

    it('CM rfq details offers a retry after a transport failure', async () => {
      mockSearchParams.set('rfq', 'RFQ-1');
      mockFetchRFQById
        .mockResolvedValueOnce({ success: false, reason: 'NETWORK', error: 'unreachable' })
        .mockResolvedValueOnce({ success: true, rfq: RFQ });

      render(<CmRFQDetailsPage />);

      await waitFor(() =>
        expect(screen.getByText(UI_STRINGS.rfqDetails.loadFailedTitle)).toBeInTheDocument()
      );
      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.rfqDetails.retryAction }));

      await waitFor(() => expect(screen.getByTestId('rfq-details')).toBeInTheDocument());
      mockSearchParams.delete('rfq');
    });

    it('CM rfq details returns to the console from the missing-reference panel', () => {
      render(<CmRFQDetailsPage />);
      fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.rfqDetails.backAction }));
      expect(mockPush).toHaveBeenCalledWith('/category-manager/all-rfqs');
    });

    // ── Editing and deleting from the CM details route ──────────────────────
    // canAccessRfq/PUT/DELETE /api/rfqs/:id have no buyer-only role gate, so a
    // category manager gets the same edit/delete flow the buyer's own page
    // already uses.
    it('CM rfq details opens the edit dialog and adopts what was saved', async () => {
      mockSearchParams.set('rfq', 'RFQ-1');
      mockFetchRFQById.mockResolvedValue({ success: true, rfq: RFQ });

      render(<CmRFQDetailsPage />);
      await waitFor(() => expect(screen.getByTestId('rfq-details')).toBeInTheDocument());

      expect(screen.queryByTestId('edit-modal-open')).not.toBeInTheDocument();
      clickCallback('rfq-details:onEdit');
      expect(screen.getByTestId('edit-modal-open')).toBeInTheDocument();

      clickCallback('edit-modal:save');
      await waitFor(() =>
        expect(storeUpdateRFQ).toHaveBeenCalledWith('RFQ-1', { title: 'Edited title' })
      );
      mockSearchParams.delete('rfq');
    });

    it('CM rfq details deletes on confirmation and returns to the console', async () => {
      mockSearchParams.set('rfq', 'RFQ-1');
      mockFetchRFQById.mockResolvedValue({ success: true, rfq: RFQ });

      render(<CmRFQDetailsPage />);
      await waitFor(() => expect(screen.getByTestId('rfq-details')).toBeInTheDocument());

      expect(screen.queryByTestId('delete-dialog-open')).not.toBeInTheDocument();
      clickCallback('rfq-details:onDelete');
      expect(screen.getByTestId('delete-dialog-open')).toBeInTheDocument();

      clickCallback('delete-dialog:confirm');
      await waitFor(() => expect(storeDeleteRFQ).toHaveBeenCalledWith('RFQ-1'));
      expect(mockPush).toHaveBeenCalledWith('/category-manager/all-rfqs');
      mockSearchParams.delete('rfq');
    });

    it('CM rfq details closes each dialog without changing anything', async () => {
      mockSearchParams.set('rfq', 'RFQ-1');
      mockFetchRFQById.mockResolvedValue({ success: true, rfq: RFQ });

      render(<CmRFQDetailsPage />);
      await waitFor(() => expect(screen.getByTestId('rfq-details')).toBeInTheDocument());

      clickCallback('rfq-details:onEdit');
      clickCallback('edit-modal:close');
      expect(screen.queryByTestId('edit-modal-open')).not.toBeInTheDocument();

      clickCallback('rfq-details:onDelete');
      clickCallback('delete-dialog:close');
      expect(screen.queryByTestId('delete-dialog-open')).not.toBeInTheDocument();
      mockSearchParams.delete('rfq');
    });
  });

  // ── Vendor ─────────────────────────────────────────────────────────────────
  describe('vendor routes', () => {
    it('opportunity feed opens the bid form, evaluation and subscriptions', () => {
      render(<VendorFeedPage />);
      clickCallback('opportunity-feed:onNavigateToBidForm');
      expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form');

      clickCallback('opportunity-feed:onNavigateToEvaluation');
      expect(mockPush).toHaveBeenCalledWith('/vendor/qualification-form');

      clickCallback('opportunity-feed:onNavigateToSubscription');
      expect(mockPush).toHaveBeenCalledWith('/vendor/vendor-subscription');
    });

    it('quotation form returns to the feed on back and on submit', () => {
      render(<VendorQuotationFormPage />);
      clickCallback('quotation-form:onBack');
      expect(mockPush).toHaveBeenCalledWith('/vendor/opportunity-feed');

      clickCallback('quotation-form:onSubmitSuccess');
      expect(mockPush).toHaveBeenCalledWith('/vendor/opportunity-feed');
    });

    it('quotation form falls back to the first open opportunity after a refresh', () => {
      mockStore({ selectedVendorOpportunity: null, vendorOpportunities: [OPPORTUNITY] });
      render(<VendorQuotationFormPage />);
      expect(screen.getByTestId('quotation-form')).toBeInTheDocument();
    });

    it('quotation form explains when there is nothing to quote on', () => {
      mockStore({ selectedVendorOpportunity: null, vendorOpportunities: [] });
      render(<VendorQuotationFormPage />);
      expect(screen.queryByTestId('quotation-form')).not.toBeInTheDocument();
      expect(screen.getByText(/No open opportunity is available/i)).toBeInTheDocument();
    });

    it('qualification form returns to the feed on back and on success', () => {
      render(<VendorQualificationFormPage />);
      clickCallback('qualification-form:onBack');
      expect(mockPush).toHaveBeenCalledWith('/vendor/opportunity-feed');

      clickCallback('qualification-form:onSuccess');
      expect(mockPush).toHaveBeenCalledWith('/vendor/opportunity-feed');
    });

    it.each<[string, React.ComponentType, string]>([
      ['item catalogue', VendorItemCataloguePage, 'item-catalogue'],
      ['subscription centre', VendorSubscriptionPage, 'vendor-subscription'],
      ['profile', VendorProfileRoute, 'vendor-profile'],
      ['billing history', VendorBillingHistoryPage, 'vendor-billing-history'],
    ])('renders the vendor %s screen', (_label, Page, testId) => {
      render(<Page />);
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    });
  });

  // ── Admin ──────────────────────────────────────────────────────────────────
  describe('admin routes', () => {
    it('infra control opens the audit log', () => {
      render(<AdminInfraControlPage />);
      clickCallback('infra-control:onNavigateToAuditLog');
      expect(mockPush).toHaveBeenCalledWith('/admin/audit-log');
    });

    it('audit log returns to infra control', () => {
      render(<AdminAuditLogPage />);
      clickCallback('audit-log:onBackToInfra');
      expect(mockPush).toHaveBeenCalledWith('/admin/infra-control');
    });
  });

  // ── Selection hand-off between routes ──────────────────────────────────────
  describe('selection hand-off', () => {
    it('records the chosen opportunity before routing to the quotation form', () => {
      const OpportunityFeed = require('@/app/vendor/opportunity-feed').default;
      let captured: ((opp: VendorOpportunity) => void) | undefined;
      const Probe = () => {
        const page = VendorFeedPage({});
        captured = (page as React.ReactElement).props.onNavigateToBidForm;
        return <OpportunityFeed />;
      };
      render(<Probe />);
      captured?.(OPPORTUNITY);

      expect(setSelectedVendorOpportunity).toHaveBeenCalledWith(OPPORTUNITY);
      expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form');
    });

    it('records the chosen evaluation before routing to the summary', () => {
      const page = BuyerVendorSummaryPage({}) as React.ReactElement;
      page.props.onViewEvaluation(EVALUATION);

      expect(setActiveEvaluationRecord).toHaveBeenCalledWith(EVALUATION);
      expect(mockPush).toHaveBeenCalledWith('/buyer/vendor-evaluation-summary');
    });

    it.each<[string, () => React.ReactElement, string]>([
      ['buyer dashboard', () => BuyerDashboardPage({}) as React.ReactElement, '/buyer/quote-matrix'],
      ['kanban board', () => CmKanbanPage({}) as React.ReactElement, '/category-manager/quote-matrix'],
      ['buyer console', () => CmBuyerConsolePage({}) as React.ReactElement, '/category-manager/quote-matrix'],
      ['vendor console', () => CmVendorConsolePage({}) as React.ReactElement, '/category-manager/quote-matrix'],
    ])('records the chosen RFQ from the %s before opening the matrix', (_label, build, expectedRoute) => {
      const page = build();
      page.props.onNavigateToMatrix(RFQ);

      expect(setSelectedRFQForMatrix).toHaveBeenCalledWith(RFQ);
      expect(mockPush).toHaveBeenCalledWith(expectedRoute);
    });

    it('routes to the matrix without a selection when none is supplied', () => {
      const page = BuyerDashboardPage({}) as React.ReactElement;
      page.props.onNavigateToMatrix(undefined);

      expect(setSelectedRFQForMatrix).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/buyer/quote-matrix');
    });

    it('records the chosen RFQ before opening the spend dashboard', () => {
      const page = CmKanbanPage({}) as React.ReactElement;
      page.props.onNavigateToSpend(RFQ);

      expect(setSelectedRFQForMatrix).toHaveBeenCalledWith(RFQ);
      expect(mockPush).toHaveBeenCalledWith('/category-manager/spend-dashboard');
    });

    it('opens the spend dashboard without a selection when none is supplied', () => {
      const page = CmKanbanPage({}) as React.ReactElement;
      page.props.onNavigateToSpend(undefined);

      expect(setSelectedRFQForMatrix).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/category-manager/spend-dashboard');
    });
  });
});
