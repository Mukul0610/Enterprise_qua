import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import VendorRFQDetailsPage from '@/app/vendor/rfq-details/page';
import { fetchRFQById } from '@/lib/rfqClient';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';

jest.mock('@/lib/rfqClient', () => ({
  fetchRFQById: jest.fn(),
}));

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));

const mockPush = jest.fn();
let mockSearchParamsValue: string | null = 'RFQ-2026-1902';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'rfq' ? mockSearchParamsValue : null),
  }),
}));

const mockedFetchRFQById = fetchRFQById as jest.Mock;

const BASE_RFQ: RFQItem = {
  id: 'rfq-1',
  rfqNumber: 'RFQ-2026-1902',
  title: 'Steel Bottle RFQ Requirement',
  category: 'Mechanical',
  sourcingMode: 'mode_1' as any,
  status: 'In Evaluation',
  quotesCount: 1,
  targetDeliveryDate: '2026-09-20',
  budget: 250000,
  deliveryLocation: 'Pune Plant',
  attachments: [],
  createdAt: '2026-09-01T10:00:00.000Z',
  extractedEntities: [
    {
      itemName: 'Steel Bottle',
      quantity: 500,
      unit: 'Nos',
      technicalSpecs: 'IS 3177 Grade A',
    } as any,
  ],
  quotes: [
    { vendorId: 'v-me', vendorName: 'My Vendor Co', unitPrice: 22000, totalPrice: 11000000 } as any,
    { vendorId: 'v-other', vendorName: 'Competitor Supplies', unitPrice: 19000, totalPrice: 9500000 } as any,
  ],
  chasingActive: false,
  buyerAccountId: 'buyer-1',
  buyerAccountName: 'Manav Buyer Enterprise',
};

const realFetch = global.fetch;

describe('Vendor RFQ Details page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParamsValue = 'RFQ-2026-1902';
    (useApp as jest.Mock).mockReturnValue({
      showToast: jest.fn(),
      currentUserSession: { email: 'me@vendor.com' },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'v-me' } }),
    }) as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('loads and renders the RFQ, reusing the shared RFQDetails component', async () => {
    mockedFetchRFQById.mockResolvedValue({ success: true, rfq: BASE_RFQ });

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );
    expect(mockedFetchRFQById).toHaveBeenCalledWith('RFQ-2026-1902');
    expect(screen.getAllByText('Steel Bottle').length).toBeGreaterThan(0);
  });

  test('shows only this vendor\'s own quote, never a competitor\'s', async () => {
    mockedFetchRFQById.mockResolvedValue({ success: true, rfq: BASE_RFQ });

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );
    expect(screen.getAllByText('My Vendor Co').length).toBeGreaterThan(0);
    expect(screen.queryByText('Competitor Supplies')).not.toBeInTheDocument();
    expect(screen.queryByText('19000')).not.toBeInTheDocument();
  });

  test('does not show Assigned & Invited Suppliers section or Invite Suppliers affordance to vendors', async () => {
    mockedFetchRFQById.mockResolvedValue({
      success: true,
      rfq: {
        ...BASE_RFQ,
        assignedVendors: [{ id: 'v-me', name: 'My Vendor Co' }, { id: 'v-comp', name: 'Competitor' }],
      },
    });

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Assigned & Invited Suppliers/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invite Suppliers/i })).not.toBeInTheDocument();
  });

  test('shows zero quotes when this vendor has no record resolved', async () => {
    mockedFetchRFQById.mockResolvedValue({ success: true, rfq: BASE_RFQ });
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );
    expect(screen.queryByText('My Vendor Co')).not.toBeInTheDocument();
    expect(screen.queryByText('Competitor Supplies')).not.toBeInTheDocument();
  });

  test('shows zero quotes when the vendor lookup request throws', async () => {
    mockedFetchRFQById.mockResolvedValue({ success: true, rfq: BASE_RFQ });
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );
    expect(screen.queryByText('My Vendor Co')).not.toBeInTheDocument();
    expect(screen.queryByText('Competitor Supplies')).not.toBeInTheDocument();
  });

  test('handles vendor lookup response without data property', async () => {
    mockedFetchRFQById.mockResolvedValue({ success: true, rfq: BASE_RFQ });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    }) as any;

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );
    expect(screen.queryByText('My Vendor Co')).not.toBeInTheDocument();
  });

  test('handles RFQ without quotes collection gracefully', async () => {
    const rfqWithoutQuotes = { ...BASE_RFQ };
    delete (rfqWithoutQuotes as any).quotes;
    mockedFetchRFQById.mockResolvedValue({ success: true, rfq: rfqWithoutQuotes });

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );
    expect(screen.queryByText('My Vendor Co')).not.toBeInTheDocument();
  });

  test('shows zero quotes when there is no signed-in session to resolve a vendor from', async () => {
    (useApp as jest.Mock).mockReturnValue({ showToast: jest.fn(), currentUserSession: null });
    mockedFetchRFQById.mockResolvedValue({ success: true, rfq: BASE_RFQ });

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/vendors\/(?!presence)/),
      expect.anything(),
    );
    expect(screen.queryByText('My Vendor Co')).not.toBeInTheDocument();
  });

  test('navigates back to the vendor Bid Quotes screen', async () => {
    mockedFetchRFQById.mockResolvedValue({ success: true, rfq: BASE_RFQ });

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );

    const backButtons = screen.getAllByRole('button', { name: /Back to RFQs/i });
    fireEvent.click(backButtons[0]);
    expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form');
  });

  test('shows the missing-reference panel when no rfq query param is present', () => {
    mockSearchParamsValue = null;

    render(<VendorRFQDetailsPage />);

    expect(screen.getByText('No RFQ Selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back to RFQs/i }));
    expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form');
  });

  test('shows a not-found panel (no retry) when the RFQ is out of the vendor scope', async () => {
    mockedFetchRFQById.mockResolvedValue({
      success: false,
      reason: 'NOT_FOUND',
      error: 'This RFQ was not found under your organisation.',
    });

    render(<VendorRFQDetailsPage />);

    await waitFor(() => expect(screen.getByText('RFQ Not Found')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Try Again/i })).not.toBeInTheDocument();
  });

  test('shows a retryable error panel on a server/network failure and retries successfully', async () => {
    mockedFetchRFQById
      .mockResolvedValueOnce({ success: false, reason: 'SERVER', error: 'Could not load.' })
      .mockResolvedValueOnce({ success: true, rfq: BASE_RFQ });

    render(<VendorRFQDetailsPage />);

    await waitFor(() =>
      expect(screen.getByText('RFQ Could Not Be Loaded')).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Try Again/i }));
    });

    await waitFor(() =>
      expect(screen.getByText('Steel Bottle RFQ Requirement')).toBeInTheDocument(),
    );
    expect(mockedFetchRFQById).toHaveBeenCalledTimes(2);
  });
});
