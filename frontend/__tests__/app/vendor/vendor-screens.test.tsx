import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ItemCatalogue from '@/app/vendor/item-catalogue';
import OpportunityFeed from '@/app/vendor/opportunity-feed';
import VendorQualificationForm from '@/app/vendor/qualification-form';
import QuotationForm from '@/app/vendor/quotation-form';
import VendorProfilePage from '@/app/vendor/vendor-profile';
import VendorSubscriptionCenter from '@/app/vendor/vendor-subscription';
import { AppProvider, useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

let vendorProfileResponse: Record<string, unknown> | null = null;

function VendorSessionBootstrap() {
  const { setCurrentRole, setCurrentUserSession, setIsLoggedIn } = useApp();
  React.useEffect(() => {
    setCurrentUserSession({
      id: 'vendor-test-id',
      email: 'vendor@example.com',
      name: 'Test Vendor',
      role: 'vendor',
      orgId: 'vendor-test-org',
      orgName: 'Test Vendor Ltd.',
    });
    setCurrentRole('vendor');
    setIsLoggedIn(true);
  }, [setCurrentRole, setCurrentUserSession, setIsLoggedIn]);
  return null;
}

/** The provider exposes the toast in context but does not render it. */
function ToastProbe() {
  const { toastMessage } = useApp();
  if (!toastMessage) return null;
  return (
    <div data-testid="toast">
      <span>{toastMessage.title}</span>
      <span>{toastMessage.description}</span>
    </div>
  );
}

function renderWithToast(ui: React.ReactElement) {
  return render(
    <AppProvider>
      <ToastProbe />
      {ui}
    </AppProvider>
  );
}

// These screens now call real backend endpoints (vendor profile, catalogue,
// quotes, RFQ download, PO approval) instead of only touching local state.
// A generic success-shaped mock keeps these smoke tests focused on UI
// behavior without needing a running backend.
function mockFetchImpl(url: string, options: any = {}) {
  const method = options.method || 'GET';
  if (/\/api\/bootstrap/.test(url)) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          vendors: [
            {
              id: 'v-mock-apex',
              name: 'Apex Supplies Ltd.',
              email: 'sales@apexsupplies.com',
              majorCategory: 'Heavy Industrial Fluid Dynamics & Valves',
              rating: 4.8,
            },
          ],
        },
      }),
    });
  }
  if (/\/api\/vendors\/v-mock-apex\/subscription$/.test(url) && method === 'PUT') {
    const body = options.body ? JSON.parse(options.body) : {};
    return Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: { id: 'v-mock-apex', subscriptionPlan: body.plan, rfqDownloadsUsed: 0 } }),
    });
  }
  if (/\/api\/vendors\/v-mock-apex\/payment-link$/.test(url) && method === 'POST') {
    const body = options.body ? JSON.parse(options.body) : {};
    return Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        data: { paymentUrl: `https://payments.zoho.in/mock/${body.plan}`, paymentLinkId: `pl-${body.plan}`, status: 'CREATED' },
      }),
    });
  }
  if (/\/api\/vendors\/v-mock-apex\/payment-links$/.test(url) && method === 'GET') {
    return Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'pl-1', status: 'PAID' }] }),
    });
  }
  if (/\/api\/catalogue/.test(url) && method === 'GET') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
  }
  if (url === '/api/catalogue' && method === 'POST') {
    const body = options.body ? JSON.parse(options.body) : {};
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: `prod-${Math.random().toString(36).slice(2)}`, ...body } }) });
  }
  if (/\/api\/catalogue\/[^/]+$/.test(url) && (method === 'PUT' || method === 'DELETE')) {
    const body = options.body ? JSON.parse(options.body) : {};
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'prod-mock', ...body } }) });
  }
  if (/\/api\/vendors\/[^/]+\/categories$/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { clientMappedCategories: [], vendorSelectedCategories: [] } }) });
  }
  if (/\/api\/vendors$/.test(url) && method === 'POST') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'v-mock-1', name: 'Mock Vendor' } }) });
  }
  if (/\/api\/vendors\/[^/]+$/.test(url)) {
    if (vendorProfileResponse) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: vendorProfileResponse }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false, error: 'Not found' }) });
  }
  if (/\/api\/rfqs\/[^/]+\/quotes$/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
  }
  if (/\/api\/rfqs\/[^/]+\/email-preview/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
  }
  if (/\/api\/rfqs\/[^/]+\/approve-po$/.test(url)) {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, poNumber: 'PO-2026-MOCK', issueDate: '2026-09-02', shaSignature: 'a'.repeat(64), lineItems: [] }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
}

describe('Vendor Screens Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vendorProfileResponse = null;
    global.fetch = jest.fn(mockFetchImpl) as any;
  });

  describe('ItemCatalogue Screen', () => {
    test('renders catalogue, adds a product, filters category, performs bulk simulation and deletes product', async () => {
      renderWithProvider(<ItemCatalogue />);

      expect(screen.getByText(/Product Catalogue Management/i)).toBeInTheDocument();
      expect(screen.getByText(/Catalogue Capacity/i)).toBeInTheDocument();

      // Wait for the initial (no-session) catalogue load to settle
      await waitFor(() => expect(screen.queryByText(/Saving\.\.\./i)).not.toBeInTheDocument());

      // Add a product
      const nameInput = screen.getByPlaceholderText(/e\.g\. Centrifugal Water Pump/i);
      const skuInput = screen.getByPlaceholderText(/^SKU-PUMP-500$/i);
      const priceInput = screen.getByPlaceholderText(/^850$/);
      const leadTimeInput = screen.getByPlaceholderText(/^5$/);
      const moqInput = screen.getByPlaceholderText(/^10$/);

      fireEvent.change(nameInput, { target: { value: 'High Pressure Cryo Valve' } });
      fireEvent.change(skuInput, { target: { value: 'SKU-CRYO-900' } });
      fireEvent.change(priceInput, { target: { value: '1200' } });
      fireEvent.change(leadTimeInput, { target: { value: '7' } });
      fireEvent.change(moqInput, { target: { value: '5' } });

      const addBtn = screen.getByRole('button', { name: /Add Item/i });
      await act(async () => {
        fireEvent.click(addBtn);
      });

      await waitFor(() => expect(screen.getByText(/SKU-CRYO-900/i)).toBeInTheDocument());

      // Category filter dropdown
      const categorySelect = screen.getByRole('combobox');
      fireEvent.change(categorySelect, { target: { value: 'Valves' } });
      fireEvent.change(categorySelect, { target: { value: 'All' } });

      // Test Download Excel Template & Upload Input
      const downloadBtn = screen.getByRole('button', { name: /Download Excel Template/i });
      fireEvent.click(downloadBtn);

      const uploadInput = screen.getByLabelText(/Upload catalogue Excel workbook/i);
      expect(uploadInput).toBeInTheDocument();

      // Test Summary filter toggle
      const summaryBtn = screen.getByRole('button', { name: /Summary:/i });
      fireEvent.click(summaryBtn);
      fireEvent.click(summaryBtn);

      // Delete an item
      const deleteBtns = screen.queryAllByTitle(/Delete Product/i);
      if (deleteBtns.length > 0) {
        await act(async () => {
          fireEvent.click(deleteBtns[0]);
        });
      }
    });
  });

  describe('OpportunityFeed Screen', () => {
    test('renders opportunity feed, handles search, filters, download RFQ, and modal upgrade flows', () => {
      const onBid = jest.fn();
      const onEval = jest.fn();
      const onSub = jest.fn();

      renderWithProvider(
        <OpportunityFeed
          onNavigateToBidForm={onBid}
          onNavigateToEvaluation={onEval}
          onNavigateToSubscription={onSub}
        />
      );

      expect(screen.queryByRole('heading', { name: /Vendor Workspace & Opportunity Feed/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Apex Supplies Ltd\./i)).not.toBeInTheDocument();

      // Test search inputs
      const searchInputs = screen.getAllByPlaceholderText(/Specs, location, keywords\.\.\./i);
      if (searchInputs.length > 0) {
        fireEvent.change(searchInputs[0], { target: { value: 'Pumps' } });
        fireEvent.change(searchInputs[0], { target: { value: '' } });
      }

      // Test category dropdowns
      const selects = screen.getAllByRole('combobox');
      if (selects.length > 0) {
        fireEvent.change(selects[0], { target: { value: 'Mechanical & Fluid Equipment' } });
        fireEvent.change(selects[0], { target: { value: 'all' } });
      }

      // Test download RFQ
      const downloadBtns = screen.queryAllByRole('button', { name: /Download RFQ/i });
      if (downloadBtns.length > 0) {
        fireEvent.click(downloadBtns[0]);
      }

      // Test express interest / bid
      const bidBtns = screen.queryAllByRole('button', { name: /Submit Online Bid|Express Interest/i });
      if (bidBtns.length > 0) {
        fireEvent.click(bidBtns[0]);
      }

      expect(screen.queryByRole('button', { name: /Start Self-Evaluation|View AI Rating/i })).not.toBeInTheDocument();
      expect(onEval).not.toHaveBeenCalled();
    });

    test('shows the buyer-added badge with the buyer company in the dashboard header', async () => {
      vendorProfileResponse = {
        source: 'buyer_manual',
        buyerId: 'buyer-123',
        addedByBuyerCompany: 'Acme Manufacturing',
      };

      render(
        <AppProvider>
          <VendorSessionBootstrap />
          <OpportunityFeed onNavigateToBidForm={jest.fn()} />
        </AppProvider>
      );

      expect(await screen.findByText('Procucev buyer added you · Acme Manufacturing')).toBeInTheDocument();
    });

    test('shows the self-onboarded badge for vendor self-registration', async () => {
      vendorProfileResponse = { source: 'self_registration' };

      render(
        <AppProvider>
          <VendorSessionBootstrap />
          <OpportunityFeed onNavigateToBidForm={jest.fn()} />
        </AppProvider>
      );

      expect(await screen.findByText('Self-onboarded vendor')).toBeInTheDocument();
    });
  });

  describe('VendorQualificationForm Screen', () => {
    test('navigates through 6 module tabs, updates question scores/remarks and submits qualification', async () => {
      jest.useFakeTimers();
      const onBack = jest.fn();
      const onSuccess = jest.fn();

      const { container } = renderWithProvider(<VendorQualificationForm onBack={onBack} onSuccess={onSuccess} />);

      expect(screen.getByText(/360-Degree AI Self-Evaluation/i)).toBeInTheDocument();
      expect(screen.getByText(/Module 1: Commercial Terms/i)).toBeInTheDocument();

      // Module 1 to Module 2
      const nextBtn = screen.getByRole('button', { name: /Next Module/i });
      fireEvent.click(nextBtn);
      expect(screen.getByText(/Module 2: Technical Capabilities/i)).toBeInTheDocument();

      // Previous button
      const prevBtn = screen.getByRole('button', { name: /Previous Module/i });
      fireEvent.click(prevBtn);
      expect(screen.getByText(/Module 1: Commercial Terms/i)).toBeInTheDocument();

      // Attach an evidence file to every question on every tab — submission
      // is now blocked (BUGS.md #50) until all 24 questions have real
      // evidence attached, so a smoke test of the full submit flow needs to
      // actually attach one to each.
      const attachFilesOnCurrentTab = () => {
        const fileInputs = container.querySelectorAll('input[type="file"]');
        fileInputs.forEach((input, idx) => {
          const file = new File(['dummy'], `evidence-${idx}.pdf`, { type: 'application/pdf' });
          fireEvent.change(input, { target: { files: [file] } });
        });
      };
      const moduleTabNames = [
        /1 Commercial Terms/i,
        /2 Technical Capabilities/i,
        /3 Quality & Warranty/i,
        /4 Operational Delivery/i,
        /5 Financial Stability/i,
        /6 Governance & ESG/i,
      ];
      moduleTabNames.forEach((name) => {
        fireEvent.click(screen.getByRole('button', { name }));
        attachFilesOnCurrentTab();
      });

      // Jump directly to Module 6 (already attached above)
      const m6Tab = screen.getByRole('button', { name: /6 Governance & ESG/i });
      fireEvent.click(m6Tab);

      // Remarks input
      const remarkInputs = screen.queryAllByPlaceholderText(/Add comments or compliance reference/i);
      if (remarkInputs.length > 0) {
        fireEvent.change(remarkInputs[0], { target: { value: 'Compliant with ISO 14001 ESG' } });
      }

      // Submit Final Qualification
      const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
      fireEvent.click(submitBtn);

      // The submit handler's setTimeout callback is now async (it awaits a
      // real fetch), so advancing fake timers must also flush that
      // microtask chain, not just fire the timer synchronously.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });

      expect(onSuccess).toHaveBeenCalled();
      jest.useRealTimers();
    });

    test('blocks submission when evidence is missing', () => {
      const onBack = jest.fn();
      const onSuccess = jest.fn();
      renderWithProvider(<VendorQualificationForm onBack={onBack} onSuccess={onSuccess} />);

      // Submit only appears on the last module tab
      fireEvent.click(screen.getByRole('button', { name: /6 Governance & ESG/i }));

      const submitBtn = screen.getByRole('button', { name: /Submit Final Qualification/i });
      fireEvent.click(submitBtn);

      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  describe('QuotationForm Screen', () => {
    test('renders submitted quotations, downloads RFQ, and interacts with buyer modal', () => {
      const onBack = jest.fn();
      // 'connect' is a real marketplace-unlock tier — used here (rather than
      // leaving this vendor session-less) so the buyer-details/download rows
      // below actually unlock, matching this smoke test's original intent.
      function QuotationFormConnectWrapper({ onBack }: { onBack: () => void }) {
        const { setVendorSubscription } = useApp();
        React.useEffect(() => {
          setVendorSubscription('connect');
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return <QuotationForm onBack={onBack} />;
      }
      renderWithProvider(<QuotationFormConnectWrapper onBack={onBack} />);

      expect(screen.queryByText(/Sourcing Enquiries & Quotation Tracking/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Active sourcing enquiries/i)).toBeInTheDocument();
      expect(screen.getAllByText(/RFQs Received/i)[0]).toBeInTheDocument();

      // Test Download RFQ button inside table
      const dlBtns = screen.queryAllByRole('button', { name: /Download RFQ/i });
      if (dlBtns.length > 0) {
        fireEvent.click(dlBtns[0]);
      }

      // Open buyer contact details modal. Queried by role rather than title —
      // the locked-row placeholder also carries a title containing "Buyer
      // Details" text, but only the real button has role="button".
      const infoBtns = screen.queryAllByRole('button', { name: /Buyer Details/i });
      if (infoBtns.length > 0) {
        fireEvent.click(infoBtns[0]);
        expect(screen.getByText(/Buyer Contact Details/i)).toBeInTheDocument();

        // Copy button in modal
        const copyBtns = screen.queryAllByRole('button', { name: /Copy/i });
        if (copyBtns.length > 0) {
          fireEvent.click(copyBtns[0]);
        }

        const closeBtns = screen.getAllByRole('button', { name: /Close/i });
        if (closeBtns.length > 0) {
          fireEvent.click(closeBtns[closeBtns.length - 1]);
        }
      }

      const backBtn = screen.getByRole('button', { name: /Back to Dashboard/i });
      fireEvent.click(backBtn);
      expect(onBack).toHaveBeenCalled();
    });
  });

  describe('VendorProfilePage Screen', () => {
    test('renders profile form, modifies inputs, toggles categories, and saves vendor profile', () => {
      renderWithProvider(<VendorProfilePage />);

      expect(screen.queryByRole('heading', { name: /Vendor Supplier Profile/i })).not.toBeInTheDocument();
      expect(screen.getByText(/Section 1: Supplier Tax & Business Details/i)).toBeInTheDocument();

      // Input changes
      const inputs = screen.getAllByRole('textbox');
      if (inputs.length > 0) {
        fireEvent.change(inputs[0], { target: { value: 'Apex Global Supplies Ltd.' } });
      }

      // Save profile
      const saveBtn = screen.getAllByRole('button', { name: /Save Supplier Profile|Save & Reconcile/i })[0];
      fireEvent.click(saveBtn);
    });
  });

  describe('VendorSubscriptionCenter Screen', () => {
    test('renders all subscription plans, starts a real Zoho checkout for a paid plan, and resets quota', async () => {
      // Plan switches now call the real PUT /api/vendors/:id/subscription and
      // only take effect once the backend confirms — that lookup is by the
      // signed-in vendor's own email, so a matching session + vendor record
      // (from the shared bootstrap mock) is needed for the switch to resolve.
      authClient.setSession({
        id: 'u-vendor-1',
        email: 'sales@apexsupplies.com',
        name: 'Test Vendor',
        role: 'vendor',
        orgId: 'org-vendor-1',
        orgName: 'Apex Supplies Ltd.',
      });

      renderWithProvider(<VendorSubscriptionCenter />);
      // Let the initial bootstrap fetch resolve (real timers) before
      // switching to fake timers for the payment-modal interactions below.
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByRole('heading', { name: /Vendor Subscription Plans & Quotas/i })).not.toBeInTheDocument();
      expect(screen.getAllByText(/Premium Model/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Connect Model/i)[0]).toBeInTheDocument();
      expect(screen.getAllByText(/Select Model/i)[0]).toBeInTheDocument();

      // Connect/Select are paid tiers — clicking opens the real Zoho checkout
      // modal rather than switching instantly. Paying now creates a real
      // payment link and redirects to Zoho; the plan itself only flips once
      // the backend's webhook (or reconciliation poller) confirms payment, so
      // this UI no longer flips it client-side.
      const connectBtn = screen.getByRole('button', { name: /Switch to Connect Model/i });
      fireEvent.click(connectBtn);
      expect(screen.getByText(/Secure Payment/i)).toBeInTheDocument();

      const payBtn = screen.getByRole('button', { name: /Pay ₹2/i });
      await act(async () => {
        fireEvent.click(payBtn);
        await Promise.resolve();
      });
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/v-mock-apex/payment-link',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'connect' }) })
      );

      // Reset Quota Counter — unrelated to payment, still switches instantly.
      const resetBtn = screen.getByRole('button', { name: /Reset Quota Counter/i });
      fireEvent.click(resetBtn);
      authClient.setSession(null);
    });

    test('switches to Premium (free) instantly, no checkout, and closes the modal via Cancel', async () => {
      authClient.setSession({
        id: 'u-vendor-1',
        email: 'sales@apexsupplies.com',
        name: 'Test Vendor',
        role: 'vendor',
        orgId: 'org-vendor-1',
        orgName: 'Apex Supplies Ltd.',
      });
      const connectPlanImpl = (url: string, options: any = {}) => {
        if (/\/api\/bootstrap/.test(url)) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                vendors: [
                  {
                    id: 'v-mock-apex',
                    name: 'Apex Supplies Ltd.',
                    email: 'sales@apexsupplies.com',
                    majorCategory: 'Heavy Industrial Fluid Dynamics & Valves',
                    rating: 4.8,
                    subscriptionPlan: 'connect',
                  },
                ],
              },
            }),
          });
        }
        return mockFetchImpl(url, options);
      };
      global.fetch = jest.fn(connectPlanImpl) as any;

      renderWithToast(<VendorSubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
      });

      const premBtn = await screen.findByRole('button', { name: /Switch to Premium Model/i });
      await act(async () => {
        fireEvent.click(premBtn);
      });
      expect(screen.getByText(/Vendor Subscription Updated!/i)).toBeInTheDocument();

      // Cancel also closes the (Connect/Select) checkout modal without paying.
      const connectBtn = await screen.findByRole('button', { name: /Switch to Connect Model/i });
      fireEvent.click(connectBtn);
      expect(screen.getByText(/Secure Payment/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
      expect(screen.queryByText(/Secure Payment/i)).not.toBeInTheDocument();

      authClient.setSession(null);
    });

    test('renders the Select-tier status banner and quota bar (near/over quota styling)', async () => {
      authClient.setSession({
        id: 'u-vendor-1',
        email: 'sales@apexsupplies.com',
        name: 'Test Vendor',
        role: 'vendor',
        orgId: 'org-vendor-1',
        orgName: 'Apex Supplies Ltd.',
      });
      const selectPlanImpl = (url: string, options: any = {}) => {
        if (/\/api\/bootstrap/.test(url)) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                vendors: [
                  {
                    id: 'v-mock-apex',
                    name: 'Apex Supplies Ltd.',
                    email: 'sales@apexsupplies.com',
                    majorCategory: 'Heavy Industrial Fluid Dynamics & Valves',
                    rating: 4.8,
                    subscriptionPlan: 'select',
                    rfqDownloadsUsed: 100,
                  },
                ],
              },
            }),
          });
        }
        return mockFetchImpl(url, options);
      };
      global.fetch = jest.fn(selectPlanImpl) as any;

      renderWithProvider(<VendorSubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getAllByText('Select Model').length).toBeGreaterThan(0));
      expect(screen.getByText(/Full tier active: Item Catalogue unlocked/i)).toBeInTheDocument();

      authClient.setSession(null);
    });

    test('shows a toast and re-syncs when the real payment link status comes back PAID, then strips the query param', async () => {
      authClient.setSession({
        id: 'u-vendor-1',
        email: 'sales@apexsupplies.com',
        name: 'Test Vendor',
        role: 'vendor',
        orgId: 'org-vendor-1',
        orgName: 'Apex Supplies Ltd.',
      });
      const originalLocation = window.location.href;
      window.history.pushState({}, '', '/vendor/vendor-subscription?linkId=pl-1');

      try {
        renderWithToast(<VendorSubscriptionCenter />);

        await waitFor(() => expect(screen.getByText(/Payment Received/i)).toBeInTheDocument());
        expect(window.location.search).toBe('');
      } finally {
        authClient.setSession(null);
        window.history.pushState({}, '', originalLocation);
      }
    });

    test('shows a cancelled toast when the real payment link status comes back CANCELED, preserving any other query params', async () => {
      authClient.setSession({
        id: 'u-vendor-1',
        email: 'sales@apexsupplies.com',
        name: 'Test Vendor',
        role: 'vendor',
        orgId: 'org-vendor-1',
        orgName: 'Apex Supplies Ltd.',
      });
      const cancelledImpl = (url: string, options: any = {}) => {
        if (/\/api\/vendors\/v-mock-apex\/payment-links$/.test(url)) {
          return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [{ id: 'pl-1', status: 'CANCELED' }] }) });
        }
        return mockFetchImpl(url, options);
      };
      global.fetch = jest.fn(cancelledImpl) as any;

      const originalLocation = window.location.href;
      window.history.pushState({}, '', '/vendor/vendor-subscription?ref=email&linkId=pl-1');

      try {
        renderWithToast(<VendorSubscriptionCenter />);

        await waitFor(() => expect(screen.getByText(/Payment Cancelled/i)).toBeInTheDocument());
        expect(window.location.search).toBe('?ref=email');
      } finally {
        authClient.setSession(null);
        window.history.pushState({}, '', originalLocation);
      }
    });

    test('does nothing when there is no linkId query param', async () => {
      renderWithProvider(<VendorSubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByText(/Payment Received/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Payment Cancelled/i)).not.toBeInTheDocument();
    });

    test('createVendorPaymentLink toasts a warning and does not redirect when the caller has no matching vendor profile', async () => {
      authClient.setSession({
        id: 'u-no-vendor',
        email: 'nobody@nowhere.test',
        name: 'No Vendor',
        role: 'vendor',
        orgId: 'org-x',
        orgName: 'X',
      });

      renderWithToast(<VendorSubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole('button', { name: /Switch to Connect Model/i }));
      const payBtn = screen.getByRole('button', { name: /Pay ₹2/i });
      await act(async () => {
        fireEvent.click(payBtn);
        await Promise.resolve();
      });

      expect(screen.getByText(/Could not find your vendor profile/i)).toBeInTheDocument();
      authClient.setSession(null);
    });

    test('createVendorPaymentLink toasts the server error when payment-link creation fails', async () => {
      authClient.setSession({
        id: 'u-vendor-1',
        email: 'sales@apexsupplies.com',
        name: 'Test Vendor',
        role: 'vendor',
        orgId: 'org-vendor-1',
        orgName: 'Apex Supplies Ltd.',
      });
      const failingImpl = (url: string, options: any = {}) => {
        if (/\/api\/vendors\/v-mock-apex\/payment-link$/.test(url)) {
          return Promise.resolve({ ok: false, status: 502, json: async () => ({ success: false, error: 'Zoho is unreachable.' }) });
        }
        return mockFetchImpl(url, options);
      };
      global.fetch = jest.fn(failingImpl) as any;

      renderWithProvider(<VendorSubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole('button', { name: /Switch to Connect Model/i }));
      const payBtn = screen.getByRole('button', { name: /Pay ₹2/i });
      await act(async () => {
        fireEvent.click(payBtn);
        await Promise.resolve();
      });

      expect(screen.getByText(/Could not start checkout/i)).toBeInTheDocument();
      authClient.setSession(null);
    });
  });
});
