import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import VendorQuotationFormPage from '@/app/vendor/quotation-form/page';
import { AppProvider, useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';

const mockRouterPush = jest.fn();
let mockSearchParams = new Map<string, string>();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key) || null,
  }),
}));

const SAMPLE_RFQ: any = {
  id: 'rfq-00421',
  rfqNumber: 'RFQ-2026-00421',
  title: 'Centrifugal Water Pump Package (15 HP)',
  buyerAccountName: 'Larsen & Toubro Ltd. (L&T)',
  category: 'Engineering Spares - Mechanical',
  sourcingMode: 'mode_1',
  status: 'Quotes Pending',
  quotesCount: 0,
  targetDeliveryDate: '2026-09-15',
  budget: 150000,
  createdAt: '2026-09-01',
  chasingActive: false,
  extractedEntities: [
    {
      id: 'item-1',
      itemName: 'Centrifugal Pump Unit',
      quantity: 5,
      unit: 'Units',
      category: 'Pumps & Accessories',
      majorCategory: 'Engineering Spares - Mechanical',
    },
  ],
};

function PageWrapper({ seedRFQ }: { seedRFQ?: boolean }) {
  const { adoptCreatedRFQ } = useApp();
  const seededRef = React.useRef(false);

  React.useEffect(() => {
    if (seedRFQ && !seededRef.current) {
      seededRef.current = true;
      adoptCreatedRFQ(SAMPLE_RFQ);
    }
  }, [seedRFQ, adoptCreatedRFQ]);

  return <VendorQuotationFormPage />;
}

describe('VendorQuotationFormPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new Map();
    authClient.setSession(
      {
        id: 'user-1',
        email: 'vendor@test.com',
        name: 'Test Vendor Co',
        role: 'vendor',
        orgId: 'org-1',
        orgName: 'Test Vendor Co',
      },
      'fake-test-token',
    );
  });

  test('renders quotation form for targeted rfq from search params', async () => {
    mockSearchParams.set('rfq', 'RFQ-2026-00421');

    render(
      <AppProvider>
        <PageWrapper seedRFQ />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/RFQs Received \(Active Enquiries\)/i)).toBeInTheDocument();
    });
  });

  test('renders fallback empty message when no opportunities are available', async () => {
    render(
      <AppProvider>
        <PageWrapper seedRFQ={false} />
      </AppProvider>
    );

    expect(
      screen.getByText(/No open opportunity is available to quote on right now/i)
    ).toBeInTheDocument();
  });
});
