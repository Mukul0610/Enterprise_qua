import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AllRFQsConsole from '@/app/category-manager/all-rfqs';
import CategoryManagerAllRFQsPage from '@/app/category-manager/all-rfqs/page';
import * as rfqClient from '@/lib/rfqClient';
import * as storeModule from '@/lib/store';
import { RFQItem } from '@/lib/types';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

jest.mock('@/lib/rfqClient');
jest.mock('@/lib/store');

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const S = UI_STRINGS.allRfqs;
const S2 = UI_STRINGS.inviteVendors;

function makeRfq(overrides: Partial<RFQItem> & { id: string }): RFQItem {
  return {
    rfqNumber: `RFQ-2026-${overrides.id}`,
    title: 'Test RFQ',
    category: 'Cables',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-12-01',
    budget: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    buyerAccountName: 'Alpha Buyer Co',
    ...overrides,
  };
}

const ROWS: RFQItem[] = [
  makeRfq({ id: '001', title: 'Copper Cable', category: 'Cables', status: 'Quotes Pending', budget: 150000, buyerAccountName: 'Alpha Buyer Co' }),
  makeRfq({ id: '002', title: 'Steel Pumps', category: 'Pumps', status: 'PO Generated', quotesCount: 3, buyerAccountName: 'Beta Buyer Co' }),
  makeRfq({ id: '003', title: 'Valves Lot', category: 'Valves', status: 'Parsing', buyerAccountName: null }),
];

const mockFetch = rfqClient.fetchAllRFQs as jest.Mock;
const mockShowToast = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  push.mockClear();
  mockFetch.mockResolvedValue({ success: true, rfqs: ROWS });
  (storeModule.useApp as jest.Mock).mockReturnValue({ showToast: mockShowToast });
});

describe('AllRFQsConsole', () => {
  it('loads and renders every RFQ with its buyer attribution', async () => {
    render(<AllRFQsConsole />);

    expect(screen.getByText(S.loading)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());
    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
    // Appears both as a table cell and as a filter option.
    expect(screen.getAllByText('Beta Buyer Co').length).toBeGreaterThanOrEqual(1);
    // The unattributed RFQ falls back to a placeholder rather than a blank cell.
    expect(screen.getByText(S.buyerUnknown)).toBeInTheDocument();
    // 3 RFQs across 2 named buyers.
    expect(screen.getByTestId('all-rfqs-count')).toHaveTextContent('3');
    expect(screen.getByTestId('all-rfqs-count')).toHaveTextContent('2');
  });

  it('formats a stated budget and marks an unstated one', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    expect(screen.getAllByText(S.budgetUnset).length).toBeGreaterThan(0);
    expect(screen.getByText(/1,50,000|150,000/)).toBeInTheDocument();
  });

  it('filters by free-text search', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'pumps' } });

    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
    expect(screen.queryByText('Copper Cable')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 3 RFQs')).toBeInTheDocument();
  });

  it('clears all active search and filter values', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'pumps' } });
    fireEvent.change(screen.getByLabelText(S.statusFilterLabel), { target: { value: 'PO Generated' } });
    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: S.clearFilters }));

    expect(screen.getByLabelText(S.searchLabel)).toHaveValue('');
    expect(screen.getByLabelText(S.statusFilterLabel)).toHaveValue('all');
    expect(screen.getByLabelText(S.buyerFilterLabel)).toHaveValue('all');
    expect(screen.getByText('Copper Cable')).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 3 RFQs')).toBeInTheDocument();
  });

  it('clears the search field without resetting the other filters', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'pumps' } });
    fireEvent.change(screen.getByLabelText(S.statusFilterLabel), { target: { value: 'PO Generated' } });
    fireEvent.click(screen.getByRole('button', { name: S.clearSearch }));

    expect(screen.getByLabelText(S.searchLabel)).toHaveValue('');
    expect(screen.getByLabelText(S.statusFilterLabel)).toHaveValue('PO Generated');
    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
    expect(screen.queryByText('Copper Cable')).not.toBeInTheDocument();
  });

  it('filters by status', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.statusFilterLabel), { target: { value: 'PO Generated' } });

    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
    expect(screen.queryByText('Copper Cable')).not.toBeInTheDocument();
  });

  it('filters by buyer', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.buyerFilterLabel), { target: { value: 'Alpha Buyer Co' } });

    expect(screen.getByText('Copper Cable')).toBeInTheDocument();
    expect(screen.queryByText('Steel Pumps')).not.toBeInTheDocument();
  });

  it('shows a no-matches message when filters exclude everything', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'zzz-nothing' } });

    expect(screen.getByText(S.noMatches)).toBeInTheDocument();
  });

  it('shows the empty state when the system has no RFQs', async () => {
    mockFetch.mockResolvedValue({ success: true, rfqs: [] });
    render(<AllRFQsConsole />);

    await waitFor(() => expect(screen.getByText(S.empty)).toBeInTheDocument());
  });

  it('surfaces a load failure and retries on demand', async () => {
    mockFetch.mockResolvedValueOnce({ success: false, error: 'Boom.' });
    render(<AllRFQsConsole />);

    await waitFor(() => expect(screen.getByText('Boom.')).toBeInTheDocument());

    mockFetch.mockResolvedValueOnce({ success: true, rfqs: ROWS });
    fireEvent.click(screen.getAllByRole('button', { name: S.retryAction })[1]);

    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());
  });

  it('reloads when the header refresh button is pressed', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Copper Cable')).toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('button', { name: S.retryAction })[0]);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it('invokes the matrix navigation callback for the chosen RFQ', async () => {
    const onNavigateToMatrix = jest.fn();
    render(<AllRFQsConsole onNavigateToMatrix={onNavigateToMatrix} />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Open the comparative quote matrix for ${ROWS[1].rfqNumber}`));

    expect(onNavigateToMatrix).toHaveBeenCalledWith(ROWS[1]);
  });

  it('invokes the details callback for the chosen RFQ', async () => {
    const onViewDetails = jest.fn();
    render(<AllRFQsConsole onViewDetails={onViewDetails} />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`View the full submitted detail for ${ROWS[1].rfqNumber}`));

    expect(onViewDetails).toHaveBeenCalledWith(ROWS[1]);
  });

  it('does not throw when no navigation callbacks are supplied', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Open the comparative quote matrix for ${ROWS[1].rfqNumber}`));
    fireEvent.click(screen.getByLabelText(`View the full submitted detail for ${ROWS[1].rfqNumber}`));
    // No assertion beyond "it rendered and clicked without error".
    expect(screen.getByText('Steel Pumps')).toBeInTheDocument();
  });

  it('opens the Invite Vendors modal for a row, and applies the updated RFQ to the table on success', async () => {
    const mockFetchCandidates = rfqClient.fetchVendorCandidates as jest.Mock;
    const mockInvite = rfqClient.inviteVendorsToRFQ as jest.Mock;
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [{ id: 'v-1', name: 'Steel Vendor', majorCategory: 'Pumps', alreadyInvited: false }],
    });
    const updatedRow = { ...ROWS[1], quotesCount: 9 };
    mockInvite.mockResolvedValue({ success: true, rfq: updatedRow, invitedCount: 1 });

    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Invite vendors to ${ROWS[1].rfqNumber}`));

    await waitFor(() => expect(mockFetchCandidates).toHaveBeenCalledWith(ROWS[1].id));
    await waitFor(() => expect(screen.getByText('Steel Vendor')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: formatString(S2.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockInvite).toHaveBeenCalledWith(ROWS[1].id, ['v-1']));
    // The modal closes and the row's quotesCount reflects the server's updated RFQ.
    await waitFor(() => expect(screen.queryByTestId('invite-vendors-modal')).not.toBeInTheDocument());
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('closes the Invite Vendors modal without changing the table when cancelled', async () => {
    render(<AllRFQsConsole />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Invite vendors to ${ROWS[1].rfqNumber}`));
    await waitFor(() => expect(screen.getByTestId('invite-vendors-modal')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(S2.closeAria));
    await waitFor(() => expect(screen.queryByTestId('invite-vendors-modal')).not.toBeInTheDocument());
  });
});

describe('CategoryManagerAllRFQsPage', () => {
  it('wires the matrix action to the shared quote-matrix route', async () => {
    const setSelectedRFQForMatrix = jest.fn();
    (storeModule.useApp as jest.Mock).mockReturnValue({ setSelectedRFQForMatrix });

    render(<CategoryManagerAllRFQsPage />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`Open the comparative quote matrix for ${ROWS[1].rfqNumber}`));

    expect(setSelectedRFQForMatrix).toHaveBeenCalledWith(ROWS[1]);
    expect(push).toHaveBeenCalledWith('/category-manager/quote-matrix');
  });

  it('wires the details action to the CM rfq-details route addressed by RFQ number', async () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({ setSelectedRFQForMatrix: jest.fn() });

    render(<CategoryManagerAllRFQsPage />);
    await waitFor(() => expect(screen.getByText('Steel Pumps')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`View the full submitted detail for ${ROWS[1].rfqNumber}`));

    expect(push).toHaveBeenCalledWith(`/category-manager/rfq-details?rfq=${ROWS[1].rfqNumber}`);
  });
});
