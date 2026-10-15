import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import EnterpriseInquiriesConsole from '@/app/category-manager/enterprise-inquiries';
import { useApp } from '@/lib/store';

jest.mock('@/lib/store');

const mockUseApp = useApp as jest.MockedFunction<typeof useApp>;
const mockShowToast = jest.fn();

const MOCK_ENTERPRISE_INQUIRIES = [
  {
    id: 'ent-inq-1',
    companyName: 'Larsen & Toubro Heavy Engineering',
    email: 'procurement@lntecc.com',
    mobile: '+91 98200 12345',
    buyerAccountId: 'buyer-lnt',
    notes: 'Requested custom ERP SAP Ariba integration with 30-day billing terms.',
    status: 'NEW',
    createdAt: '2026-10-15T09:00:00Z',
  },
  {
    id: 'ent-inq-2',
    companyName: 'Tata Motors Limited',
    email: 'commercial@tatamotors.com',
    mobile: '+91 98450 67890',
    buyerAccountId: 'buyer-tata',
    notes: 'SLA negotiation underway for 200+ annual vendor evaluations.',
    status: 'IN_DISCUSSION',
    createdAt: '2026-10-14T14:30:00Z',
    contactedBy: 'Rohan (Category Manager)',
    contactedAt: '2026-10-14T16:00:00Z',
  },
  {
    id: 'ent-inq-3',
    companyName: 'Adani Green Energy Ltd',
    email: 'contracts@adani.com',
    mobile: '+91 97120 44556',
    status: 'CONTRACT_SIGNED',
    createdAt: '2026-10-10T11:00:00Z',
  },
];

describe('EnterpriseInquiriesConsole (Category Manager)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseApp.mockReturnValue({
      showToast: mockShowToast,
      currentUserSession: {
        id: 'cm-1',
        name: 'Vikas Sharma',
        email: 'vikas@procucev.com',
        role: 'category_manager',
      },
    } as any);

    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      if (typeof url === 'string' && url.includes('/api/enterprise-inquiries') && options?.method === 'PATCH') {
        const body = JSON.parse(options.body || '{}');
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { id: 'ent-inq-1', ...body },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          data: MOCK_ENTERPRISE_INQUIRIES,
        }),
      });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders header, Screen 2.8 badge, and accurate KPI statistics', async () => {
    render(<EnterpriseInquiriesConsole />);

    expect(screen.getByText('Enterprise Contracts Inquiries')).toBeInTheDocument();
    expect(screen.getByText('Screen 2.8')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Larsen & Toubro Heavy Engineering')).toBeInTheDocument();
    });

    // Check KPI counts: 3 total, 1 new, 1 in discussion, 1 signed
    expect(screen.getByText('Total Inquiries')).toBeInTheDocument();
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('New / Pending')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('In Discussion').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Contracts Signed').length).toBeGreaterThanOrEqual(1);
  });

  it('renders leads list with company name, email, mobile, and status badges', async () => {
    render(<EnterpriseInquiriesConsole />);

    await waitFor(() => {
      expect(screen.getByText('Larsen & Toubro Heavy Engineering')).toBeInTheDocument();
    });

    expect(screen.getByText('procurement@lntecc.com')).toBeInTheDocument();
    expect(screen.getByText('+91 98200 12345')).toBeInTheDocument();

    expect(screen.getByText('Tata Motors Limited')).toBeInTheDocument();
    expect(screen.getByText('commercial@tatamotors.com')).toBeInTheDocument();
    expect(screen.getByText('+91 98450 67890')).toBeInTheDocument();

    expect(screen.getByText('Adani Green Energy Ltd')).toBeInTheDocument();
    expect(screen.getByText('contracts@adani.com')).toBeInTheDocument();
    expect(screen.getByText('+91 97120 44556')).toBeInTheDocument();
  });

  it('filters leads by status tab: New, In Discussion, Signed, All', async () => {
    render(<EnterpriseInquiriesConsole />);

    await waitFor(() => {
      expect(screen.getByText('Larsen & Toubro Heavy Engineering')).toBeInTheDocument();
    });

    // Filter to New
    fireEvent.click(screen.getByRole('button', { name: /^New/i }));
    expect(screen.getByText('Larsen & Toubro Heavy Engineering')).toBeInTheDocument();
    expect(screen.queryByText('Tata Motors Limited')).not.toBeInTheDocument();
    expect(screen.queryByText('Adani Green Energy Ltd')).not.toBeInTheDocument();

    // Filter to In Discussion
    fireEvent.click(screen.getByRole('button', { name: /In Discussion/i }));
    expect(screen.getByText('Tata Motors Limited')).toBeInTheDocument();
    expect(screen.queryByText('Larsen & Toubro Heavy Engineering')).not.toBeInTheDocument();

    // Filter to Signed
    fireEvent.click(screen.getByRole('button', { name: /^Signed/i }));
    expect(screen.getByText('Adani Green Energy Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Tata Motors Limited')).not.toBeInTheDocument();

    // Back to All
    fireEvent.click(screen.getByRole('button', { name: /All Leads/i }));
    expect(screen.getByText('Larsen & Toubro Heavy Engineering')).toBeInTheDocument();
    expect(screen.getByText('Tata Motors Limited')).toBeInTheDocument();
    expect(screen.getByText('Adani Green Energy Ltd')).toBeInTheDocument();
  });

  it('searches leads by company name, email, or mobile number', async () => {
    render(<EnterpriseInquiriesConsole />);

    await waitFor(() => {
      expect(screen.getByText('Larsen & Toubro Heavy Engineering')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by company name, email, or phone/i);

    // Search by company
    fireEvent.change(searchInput, { target: { value: 'Larsen' } });
    expect(screen.getByText('Larsen & Toubro Heavy Engineering')).toBeInTheDocument();
    expect(screen.queryByText('Tata Motors Limited')).not.toBeInTheDocument();

    // Search by email
    fireEvent.change(searchInput, { target: { value: 'adani.com' } });
    expect(screen.getByText('Adani Green Energy Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Larsen & Toubro Heavy Engineering')).not.toBeInTheDocument();

    // Search with no results
    fireEvent.change(searchInput, { target: { value: 'nomatchxyzcompany' } });
    expect(screen.getByText('No Enterprise Contract Inquiries Found')).toBeInTheDocument();
  });

  it('opens manage modal and updates notes on a lead', async () => {
    render(<EnterpriseInquiriesConsole />);

    await waitFor(() => {
      expect(screen.getByText('Larsen & Toubro Heavy Engineering')).toBeInTheDocument();
    });

    // Click Manage & Notes on the first lead
    const manageBtns = screen.getAllByRole('button', { name: /Manage & Notes/i });
    fireEvent.click(manageBtns[0]);

    // Modal opens
    expect(screen.getByText('Enterprise Contracts Inquiry Details')).toBeInTheDocument();

    // Edit notes
    const notesTextarea = screen.getByPlaceholderText(/Add conversation notes/i);
    fireEvent.change(notesTextarea, {
      target: { value: 'Agreed on 15% volume rebate for annual contract.' },
    });

    // Save notes
    fireEvent.click(screen.getByRole('button', { name: /Save Notes/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/enterprise-inquiries/ent-inq-1'),
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('Agreed on 15% volume rebate for annual contract.'),
        })
      );
    });

    expect(mockShowToast).toHaveBeenCalledWith('Lead Updated', 'Enterprise inquiry details saved.', 'success');
  });
});
