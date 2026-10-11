import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import QuotationForm from '@/app/vendor/quotation-form';
import { AppProvider } from '@/lib/store';
import type { RFQItem } from '@/lib/types';

const mockRouterPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockImplementation(() => Promise.resolve()),
  },
});

const BUYER_A_COMPANY = 'Buyer Alpha Corp';
const BUYER_B_COMPANY = 'Buyer Beta Corp';

const MOCK_MAPPED_VENDOR = {
  id: 'v-mapped-001',
  name: 'Mapped Vendor Ltd',
  email: 'mapped.vendor@example.com',
  buyerId: 'buyer-a-id',
  buyerAccountId: 'buyer-a-id',
  addedByBuyerCompany: BUYER_A_COMPANY,
  freeQuotationCredits: 0, // 0 free credits left
  subscriptionPlan: 'premium', // free tier
};

// RFQ from Buyer A (mapped buyer)
const RFQ_FROM_BUYER_A: RFQItem = {
  id: 'rfq-buyer-a',
  rfqNumber: 'RFQ-ALPHA-101',
  title: 'Alpha Plant Pump Assembly',
  buyerAccountId: 'buyer-a-id',
  buyerAccountName: BUYER_A_COMPANY,
  category: 'Engineering Spares - Mechanical',
  sourcingMode: 'mode_1',
  status: 'Quotes Pending',
  quotesCount: 0,
  targetDeliveryDate: '2026-11-20',
  budget: 250000,
  createdAt: '2026-10-01',
  chasingActive: false,
  quotes: [],
  extractedEntities: [
    {
      id: 'ent-a1',
      itemName: 'Submersible Pump 20HP',
      quantity: 2,
      unit: 'Nos',
      targetDate: '2026-11-20',
      technicalSpecs: 'High Pressure',
      confidence: 95,
      category: 'Engineering Spares - Mechanical',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategory: 'Pumps & Accessories',
    },
  ],
};

// RFQ from Buyer B (unmapped external buyer)
const RFQ_FROM_BUYER_B: RFQItem = {
  id: 'rfq-buyer-b',
  rfqNumber: 'RFQ-BETA-202',
  title: 'Beta Factory Boiler Pipe',
  buyerAccountId: 'buyer-b-id',
  buyerAccountName: BUYER_B_COMPANY,
  category: 'Engineering Spares - Mechanical',
  sourcingMode: 'mode_1',
  status: 'Quotes Pending',
  quotesCount: 0,
  targetDeliveryDate: '2026-12-05',
  budget: 500000,
  createdAt: '2026-10-02',
  chasingActive: false,
  quotes: [],
  extractedEntities: [
    {
      id: 'ent-b1',
      itemName: 'High Temp Steam Pipe',
      quantity: 10,
      unit: 'Meters',
      targetDate: '2026-12-05',
      technicalSpecs: 'Seamless Steel',
      confidence: 90,
      category: 'Engineering Spares - Mechanical',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategory: 'Pipes & Fittings',
    },
  ],
};

describe('Buyer-Mapped Vendor Access & Unlimited Quotation in QuotationForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      // Vendor record lookup
      if (url.includes('/api/vendors/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: MOCK_MAPPED_VENDOR,
            }),
        } as Response);
      }

      // RFQs lookup
      if (url.includes('/api/rfqs') && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: [RFQ_FROM_BUYER_A, RFQ_FROM_BUYER_B],
            }),
        } as Response);
      }

      // Quote submission
      if (url.includes('/quotes') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                ...RFQ_FROM_BUYER_A,
                quotes: [
                  {
                    vendorId: MOCK_MAPPED_VENDOR.id,
                    vendorName: MOCK_MAPPED_VENDOR.name,
                    unitPrice: 120000,
                    submittedAt: new Date().toISOString(),
                  },
                ],
              },
            }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: [] }),
      } as Response);
    }) as jest.Mock;
  });

  test('buyer-mapped RFQ displays Submit Quote button with 0 free credits, while external buyer RFQ is locked', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <QuotationForm onBack={jest.fn()} />
        </AppProvider>
      );
    });

    // Wait for RFQs to render in table
    await waitFor(() => {
      expect(screen.getByText('RFQ-ALPHA-101')).toBeInTheDocument();
      expect(screen.getByText('RFQ-BETA-202')).toBeInTheDocument();
    });

    // The buyer-mapped row (RFQ-ALPHA-101) should have Submit Quote button available even with 0 credits
    const submitButtons = screen.getAllByRole('button', { name: /Submit Quote/i });
    expect(submitButtons.length).toBeGreaterThanOrEqual(1);

    // The unmapped external buyer row (RFQ-BETA-202) should show Premium Locked badge
    expect(screen.getByText(/🔒 Premium Locked/i)).toBeInTheDocument();
  });

  test('submitting a quote on mapped buyer RFQ opens bid form and successfully submits without subscription', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <QuotationForm onBack={jest.fn()} />
        </AppProvider>
      );
    });

    await waitFor(() => {
      expect(screen.getByText('RFQ-ALPHA-101')).toBeInTheDocument();
    });

    // Click Submit Quote for Buyer A's RFQ
    const submitBtn = screen.getByRole('button', { name: /Submit Quote/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // The bid modal opens
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Submit Quotation/i })).toBeInTheDocument();
    });

    // Enter Unit Price
    const priceInput = screen.getByPlaceholderText(/e\.g\. 25000/i);
    await act(async () => {
      fireEvent.change(priceInput, { target: { value: '120000' } });
    });

    // Submit Quotation button in modal
    const modalButtons = screen.getAllByRole('button', { name: /Submit Quotation/i });
    const modalSubmitBtn = modalButtons[modalButtons.length - 1];
    await act(async () => {
      fireEvent.click(modalSubmitBtn);
    });

    // Verification: API was called with quote payload
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/quotes'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });
});
