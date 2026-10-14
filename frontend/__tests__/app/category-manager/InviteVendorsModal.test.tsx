import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InviteVendorsModal from '@/app/category-manager/InviteVendorsModal';
import { useApp } from '@/lib/store';
import * as rfqClient from '@/lib/rfqClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQItem, RFQVendorCandidate } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/rfqClient', () => ({
  fetchVendorCandidates: jest.fn(),
  fetchAllVendors: jest.fn(),
  inviteVendorsToRFQ: jest.fn(),
}));

const S = UI_STRINGS.inviteVendors;
const mockShowToast = jest.fn();
const mockOnClose = jest.fn();
const mockOnInvited = jest.fn();

const RFQ: RFQItem = {
  id: 'rfq-1',
  rfqNumber: 'RFQ-2026-001',
  title: 'Copper Cable',
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
};

function candidate(overrides: Partial<RFQVendorCandidate> & { id: string }): RFQVendorCandidate {
  return {
    name: `Vendor ${overrides.id}`,
    majorCategory: 'Cables',
    alreadyInvited: false,
    ...overrides,
  } as RFQVendorCandidate;
}

const mockFetchCandidates = rfqClient.fetchVendorCandidates as jest.Mock;
const mockFetchAllVendors = rfqClient.fetchAllVendors as jest.Mock;
const mockInvite = rfqClient.inviteVendorsToRFQ as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (useApp as jest.Mock).mockReturnValue({ showToast: mockShowToast });
  mockFetchCandidates.mockResolvedValue({ success: true, candidates: [] });
  mockFetchAllVendors.mockResolvedValue({
    success: true,
    candidates: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
  });
});

describe('InviteVendorsModal', () => {
  it('renders nothing when closed or when there is no RFQ', () => {
    const { container, rerender } = render(
      <InviteVendorsModal isOpen={false} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<InviteVendorsModal isOpen={true} rfq={null} onClose={mockOnClose} onInvited={mockOnInvited} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading state, then the fetched candidates', async () => {
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-1' }), candidate({ id: 'v-2', alreadyInvited: true })],
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    expect(screen.getByText(S.loading)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());
    expect(screen.getByText('Vendor v-2')).toBeInTheDocument();
    expect(screen.getByText(S.alreadyInvitedBadge)).toBeInTheDocument();
    expect(mockFetchCandidates).toHaveBeenCalledWith('rfq-1');
  });

  it('shows an error state when the candidate fetch fails', async () => {
    mockFetchCandidates.mockResolvedValue({ success: false, reason: 'SERVER', error: 'Boom.' });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => expect(screen.getByText('Boom.')).toBeInTheDocument());
  });

  it('falls back to the default load-failed message when the server gives no error text', async () => {
    mockFetchCandidates.mockResolvedValue({ success: false, reason: 'SERVER', error: '' });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => expect(screen.getByText(S.loadFailed)).toBeInTheDocument());
  });

  it('shows an empty state when there are no candidates', async () => {
    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
  });

  it('selects and deselects an individual candidate, gating the submit button on selection', async () => {
    mockFetchCandidates.mockResolvedValue({ success: true, candidates: [candidate({ id: 'v-1' })] });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    const submitButton = screen.getByRole('button', { name: formatString(S.inviteAction, { count: 0 }) });
    expect(submitButton).toBeDisabled();

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 1 }) })).not.toBeDisabled();

    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 0 }) })).toBeDisabled();
  });

  it('does not toggle an already-invited candidate (disabled checkbox)', async () => {
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-1', alreadyInvited: true })],
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('select-all / deselect-all toggles every invitable candidate, skipping already-invited ones', async () => {
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-1' }), candidate({ id: 'v-2' }), candidate({ id: 'v-3', alreadyInvited: true })],
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: S.selectAll }));
    expect(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 2 }) })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: S.deselectAll }));
    expect(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 0 }) })).toBeDisabled();
  });

  it('does not show the select-all control when there is nobody left to invite', async () => {
    mockFetchCandidates.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-1', alreadyInvited: true })],
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: S.selectAll })).not.toBeInTheDocument();
  });

  it('submits the selected vendor ids, toasts success, calls onInvited, and closes', async () => {
    mockFetchCandidates.mockResolvedValue({ success: true, candidates: [candidate({ id: 'v-1' })] });
    const updatedRfq = { ...RFQ, quotesCount: 1 };
    mockInvite.mockResolvedValue({ success: true, rfq: updatedRfq, invitedCount: 1 });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockInvite).toHaveBeenCalledWith('rfq-1', ['v-1']));
    expect(mockShowToast).toHaveBeenCalledWith(
      S.successTitle,
      formatString(S.successMessage, { count: 1, rfqNumber: RFQ.rfqNumber }),
      'success'
    );
    expect(mockOnInvited).toHaveBeenCalledWith(updatedRfq, 1);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('toasts a warning and stays open when the invite call fails', async () => {
    mockFetchCandidates.mockResolvedValue({ success: true, candidates: [candidate({ id: 'v-1' })] });
    mockInvite.mockResolvedValue({ success: false, reason: 'SERVER', error: 'Invite failed.' });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockInvite).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(S.failTitle, 'Invite failed.', 'warning');
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('does not submit when nothing is selected', async () => {
    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 0 }) }));
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('closes via the header close button and the footer cancel button', async () => {
    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(S.closeAria));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: S.cancelAction }));
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });

  it('works without an onInvited callback', async () => {
    mockFetchCandidates.mockResolvedValue({ success: true, candidates: [candidate({ id: 'v-1' })] });
    mockInvite.mockResolvedValue({ success: true, rfq: RFQ, invitedCount: 1 });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} />);
    await waitFor(() => expect(screen.getByText('Vendor v-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
  });
});

describe('InviteVendorsModal — All Vendors tab', () => {
  it('lazily fetches all vendors only on first switch to the All Vendors tab', async () => {
    mockFetchAllVendors.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-9', name: 'Bolt Supplies', majorCategory: 'Fasteners' })],
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
    expect(mockFetchAllVendors).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('invite-tab-all'));

    expect(screen.getByText(S.loading)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Bolt Supplies')).toBeInTheDocument());
    expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);

    // Switching away and back does not refetch.
    fireEvent.click(screen.getByTestId('invite-tab-category'));
    fireEvent.click(screen.getByTestId('invite-tab-all'));
    expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);
  });

  it('shows an error state when the all-vendors fetch fails, falling back to the default message', async () => {
    mockFetchAllVendors.mockResolvedValue({ success: false, reason: 'SERVER', error: '' });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('invite-tab-all'));

    await waitFor(() => expect(screen.getByText(S.allVendorsLoadFailed)).toBeInTheDocument());
  });

  it('shows an empty state when there are no vendors found', async () => {
    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('invite-tab-all'));

    await waitFor(() => expect(screen.getByText(S.noVendorsFound)).toBeInTheDocument());
  });

  it('sends the search term to the server (debounced) and renders only what it returns', async () => {
    const alpha = candidate({ id: 'v-1', name: 'Alpha Traders', majorCategory: 'Cables', email: 'a@x.com', minorCategories: ['Copper'] });
    const bolt = candidate({ id: 'v-2', name: 'Bolt Supplies', majorCategory: 'Fasteners', email: 'b@y.com', minorCategories: ['Steel'] });
    const page = (candidates: RFQVendorCandidate[]) => ({
      success: true,
      candidates,
      pagination: { page: 1, pageSize: 50, total: candidates.length, totalPages: 1 },
    });

    // The real endpoint filters server-side; this mock stands in for that by
    // inspecting the `search` option the component sent.
    mockFetchAllVendors.mockImplementation(async (opts: { search?: string } = {}) => {
      const q = (opts.search || '').toLowerCase();
      if (!q) return page([alpha, bolt]);
      const all = [alpha, bolt];
      return page(
        all.filter((v) =>
          [v.name, v.majorCategory, v.email, ...(v.minorCategories || [])].some((f) =>
            String(f || '').toLowerCase().includes(q)
          )
        )
      );
    });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-tab-all'));
    await waitFor(() => expect(screen.getByText('Alpha Traders')).toBeInTheDocument());
    expect(screen.getByText('Bolt Supplies')).toBeInTheDocument();

    const search = screen.getByPlaceholderText(S.searchPlaceholder);

    fireEvent.change(search, { target: { value: 'bolt' } });
    await waitFor(() => expect(mockFetchAllVendors).toHaveBeenCalledWith(expect.objectContaining({ search: 'bolt' })));
    await waitFor(() => expect(screen.queryByText('Alpha Traders')).not.toBeInTheDocument());
    expect(screen.getByText('Bolt Supplies')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'copper' } });
    await waitFor(() => expect(screen.getByText('Alpha Traders')).toBeInTheDocument());
    expect(screen.queryByText('Bolt Supplies')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'y.com' } });
    await waitFor(() => expect(screen.getByText('Bolt Supplies')).toBeInTheDocument());
    expect(screen.queryByText('Alpha Traders')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(screen.getByText('Alpha Traders')).toBeInTheDocument());
    expect(screen.getByText('Bolt Supplies')).toBeInTheDocument();
  });

  it('shows a Load More button when more pages remain, and appends the next page on click', async () => {
    const first = Array.from({ length: 2 }, (_, i) => candidate({ id: `v-${i}`, name: `Vendor ${i}` }));
    const second = [candidate({ id: 'v-extra', name: 'Extra Vendor' })];
    mockFetchAllVendors
      .mockResolvedValueOnce({ success: true, candidates: first, pagination: { page: 1, pageSize: 2, total: 3, totalPages: 2 } })
      .mockResolvedValueOnce({ success: true, candidates: second, pagination: { page: 2, pageSize: 2, total: 3, totalPages: 2 } });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-tab-all'));
    await waitFor(() => expect(screen.getByText('Vendor 0')).toBeInTheDocument());

    const loadMore = screen.getByTestId('load-more-vendors');
    fireEvent.click(loadMore);

    await waitFor(() => expect(screen.getByText('Extra Vendor')).toBeInTheDocument());
    expect(screen.getByText('Vendor 0')).toBeInTheDocument();
    expect(mockFetchAllVendors).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
  });

  it('shows an error and falls back to the default message when Load More itself fails', async () => {
    const first = Array.from({ length: 2 }, (_, i) => candidate({ id: `v-${i}`, name: `Vendor ${i}` }));
    mockFetchAllVendors
      .mockResolvedValueOnce({ success: true, candidates: first, pagination: { page: 1, pageSize: 2, total: 4, totalPages: 2 } })
      .mockResolvedValueOnce({ success: false, reason: 'SERVER', error: '' });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-tab-all'));
    await waitFor(() => expect(screen.getByText('Vendor 0')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('load-more-vendors'));

    // allVendorsError is shared with the initial-load error state, so a
    // failed Load More replaces the list with the error message rather than
    // leaving the already-loaded first page visible underneath it.
    await waitFor(() => expect(screen.getByText(S.allVendorsLoadFailed)).toBeInTheDocument());
    expect(screen.queryByText('Vendor 0')).not.toBeInTheDocument();
  });

  it('shows the outside-category badge only for all-vendor rows whose category does not match the RFQ signals, including extractedEntities-derived signals', async () => {
    mockFetchAllVendors.mockResolvedValue({
      success: true,
      candidates: [
        candidate({ id: 'v-1', name: 'Matches RFQ', majorCategory: 'Cables' }),
        candidate({ id: 'v-2', name: 'No Match', majorCategory: 'Fasteners', minorCategories: ['Screws'] }),
        candidate({ id: 'v-3', name: 'Matches Minor', majorCategory: 'Copper Wire' }),
        candidate({ id: 'v-4', name: 'Matches Entity Category', majorCategory: 'Insulation' }),
      ],
    });
    const rfqWithEntities: RFQItem = {
      ...RFQ,
      extractedEntities: [{ majorCategory: 'Electricals', minorCategory: 'Copper Wire', category: 'Insulation' } as any],
    };

    render(<InviteVendorsModal isOpen={true} rfq={rfqWithEntities} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-tab-all'));
    await waitFor(() => expect(screen.getByText('Matches RFQ')).toBeInTheDocument());

    const badges = screen.getAllByTestId('outside-category-badge');
    expect(badges).toHaveLength(1);
    expect(screen.getByText('No Match').closest('label')).toContainElement(badges[0]);
    expect(screen.getByText('Matches RFQ').closest('label')?.querySelector('[data-testid="outside-category-badge"]')).toBeNull();
  });

  it('derives alreadyInvited for all-vendor rows from the RFQ\'s own assignedVendors, hiding the outside-category badge for them', async () => {
    mockFetchAllVendors.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-1', name: 'Already In', majorCategory: 'Fasteners' })],
    });
    const rfqWithAssigned: RFQItem = { ...RFQ, assignedVendors: [{ id: 'v-1', name: 'Already In' } as any] };

    render(<InviteVendorsModal isOpen={true} rfq={rfqWithAssigned} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-tab-all'));
    await waitFor(() => expect(screen.getByText('Already In')).toBeInTheDocument());

    expect(screen.getByText(S.alreadyInvitedBadge)).toBeInTheDocument();
    expect(screen.queryByTestId('outside-category-badge')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('selects and invites a vendor found only via the All Vendors tab', async () => {
    mockFetchAllVendors.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-9', name: 'Bolt Supplies', majorCategory: 'Fasteners' })],
    });
    mockInvite.mockResolvedValue({ success: true, rfq: RFQ, invitedCount: 1 });

    render(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-tab-all'));
    await waitFor(() => expect(screen.getByText('Bolt Supplies')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: formatString(S.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockInvite).toHaveBeenCalledWith('rfq-1', ['v-9']));
  });

  it('resets tab, search, and all-vendors state each time the modal is reopened', async () => {
    mockFetchAllVendors.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-9', name: 'Bolt Supplies', majorCategory: 'Fasteners' })],
    });

    const { rerender } = render(
      <InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />
    );
    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-tab-all'));
    await waitFor(() => expect(screen.getByText('Bolt Supplies')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(S.searchPlaceholder), { target: { value: 'bolt' } });

    rerender(<InviteVendorsModal isOpen={false} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);
    rerender(<InviteVendorsModal isOpen={true} rfq={RFQ} onClose={mockOnClose} onInvited={mockOnInvited} />);

    await waitFor(() => expect(screen.getByText(S.noCandidates)).toBeInTheDocument());
    expect(screen.getByTestId('invite-tab-category')).toHaveClass('bg-indigo-600');
    expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);
  });

  it('selects All Vendors tab initially and starts paginated vendor fetch for uncategorized V0 RFQ', async () => {
    const uncategorizedV0Rfq: RFQItem = {
      ...RFQ,
      id: 'rfq-v0-uncat',
      rfqNumber: 'RFQ-V0-001',
      category: '',
      sourcingMode: 'mode_0',
      extractedEntities: [],
      needsCategoryManagerAssignment: true,
    };

    mockFetchAllVendors.mockResolvedValue({
      success: true,
      candidates: [candidate({ id: 'v-all-1', name: 'Global Hardware Supply', majorCategory: 'Fasteners' })],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    });

    render(
      <InviteVendorsModal isOpen={true} rfq={uncategorizedV0Rfq} onClose={mockOnClose} onInvited={mockOnInvited} />
    );

    // Initial tab must be 'all'
    expect(screen.getByTestId('invite-tab-all')).toHaveClass('bg-indigo-600');
    // Paginated vendor fetch starts automatically
    await waitFor(() => {
      expect(mockFetchAllVendors).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 50,
          search: '',
          category: '',
        })
      );
      expect(screen.getByText('Global Hardware Supply')).toBeInTheDocument();
    });
  });
});
