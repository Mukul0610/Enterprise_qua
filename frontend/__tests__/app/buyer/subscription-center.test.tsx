import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SubscriptionCenter from '@/app/buyer/subscription-center';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

describe('app/buyer/subscription-center.tsx', () => {
  const mockShowToast = jest.fn();
  const mockRefreshActiveBuyerAccount = jest.fn();
  const mockCreateBuyerPaymentLink = jest.fn();
  const mockCheckBuyerPaymentLinkStatus = jest.fn();
  const originalFetch = global.fetch;

  function mockStore(overrides: Record<string, unknown> = {}) {
    (useApp as jest.Mock).mockReturnValue({
      activeSubscription: 'free_trial',
      remainingFreeRFQs: 4,
      showToast: mockShowToast,
      activeBuyerAccount: { id: 'buyer-1', subscriptionPlan: 'free_trial', remainingFreeRFQs: 4 },
      refreshActiveBuyerAccount: mockRefreshActiveBuyerAccount,
      createBuyerPaymentLink: mockCreateBuyerPaymentLink,
      checkBuyerPaymentLinkStatus: mockCheckBuyerPaymentLinkStatus,
      ...overrides,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders free trial header, quota progress bar, and all 3 subscription plans', () => {
    render(<SubscriptionCenter />);

    expect(screen.getByText(/Free Starter Account — 5 Free RFQs Included/i)).toBeInTheDocument();
    expect(screen.getByText(/Remaining: 4 \/ 5/i)).toBeInTheDocument();
    expect(screen.getByText(/Used: 1 \/ 5/i)).toBeInTheDocument();
    expect(screen.getByText('Version 1 Plan')).toBeInTheDocument();
    expect(screen.getByText('Version 2 Plan')).toBeInTheDocument();
    expect(screen.getByText('Version 3 Plan')).toBeInTheDocument();
  });

  it('renders the Free Starter Account banner with remaining and used quotas', () => {
    mockStore({ activeSubscription: 'free_trial', remainingFreeRFQs: 4 });
    render(<SubscriptionCenter />);

    expect(screen.getByText(/Free Starter Account — 5 Free RFQs Included/i)).toBeInTheDocument();
    expect(screen.getByText('Used: 1 / 5')).toBeInTheDocument();
    expect(screen.getByText('Remaining: 4 / 5')).toBeInTheDocument();
    expect(screen.getByText(/Every new buyer account receives/i)).toBeInTheDocument();
  });

  it('renders active plan status badge instead of free quota alert when on a paid plan', () => {
    mockStore({ activeSubscription: 'version_1' });
    render(<SubscriptionCenter />);

    expect(screen.queryByText(/Free Starter Account — 5 Free RFQs Included/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Active Premium Plan: Version 1/i)).toBeInTheDocument();
  });

  it('clicking a paid plan opens the real Zoho checkout modal instead of granting the plan directly', async () => {
    render(<SubscriptionCenter />);

    fireEvent.click(screen.getByTestId('subscribe-btn-version_2'));
    await waitFor(() => expect(screen.getByText('Secure Payment')).toBeInTheDocument());
    // No direct plan grant — the modal is responsible for creating a real
    // payment link and redirecting to Zoho, not this button.
    expect(mockCreateBuyerPaymentLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Secure Payment')).not.toBeInTheDocument());
  });

  it('renders the active-plan banner and disables the button for the currently active paid plan', () => {
    mockStore({ activeSubscription: 'version_1', remainingFreeRFQs: 0, activeBuyerAccount: { id: 'buyer-1', subscriptionPlan: 'version_1', remainingFreeRFQs: 0 } });
    render(<SubscriptionCenter />);

    expect(screen.getByText(/Active Premium Plan: Version 1/i)).toBeInTheDocument();
    expect(screen.getByText('Active Subscription')).toBeInTheDocument();
  });

  it('shows a toast and re-syncs when the real payment link status comes back PAID, then strips the query param', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue('PAID');
    window.history.pushState({}, '', '/buyer/subscription-center?linkId=pl-1');

    try {
      render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockCheckBuyerPaymentLinkStatus).toHaveBeenCalledWith('pl-1');
      expect(mockShowToast).toHaveBeenCalledWith('Payment Received', expect.any(String), 'success');
      expect(mockRefreshActiveBuyerAccount).toHaveBeenCalled();
      expect(window.location.search).toBe('');
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('shows a cancelled toast when the real payment link status comes back CANCELED, preserving any other query params', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue('CANCELED');
    window.history.pushState({}, '', '/buyer/subscription-center?ref=email&linkId=pl-1');

    try {
      render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockShowToast).toHaveBeenCalledWith('Payment Cancelled', expect.any(String), 'info');
      expect(mockRefreshActiveBuyerAccount).not.toHaveBeenCalled();
      expect(window.location.search).toBe('?ref=email');
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('shows an expired toast when the real payment link status comes back EXPIRED', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue('EXPIRED');
    window.history.pushState({}, '', '/buyer/subscription-center?linkId=pl-1');

    try {
      render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockShowToast).toHaveBeenCalledWith('Payment Link Expired', expect.any(String), 'warning');
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('shows a processing toast when the status is still unresolved (CREATED, or the lookup failed)', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue(null);
    window.history.pushState({}, '', '/buyer/subscription-center?linkId=pl-1');

    try {
      render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockShowToast).toHaveBeenCalledWith('Payment Processing', expect.any(String), 'info');
      expect(mockRefreshActiveBuyerAccount).toHaveBeenCalled();
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('does nothing on mount when there is no linkId query param', async () => {
    render(<SubscriptionCenter />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockRefreshActiveBuyerAccount).not.toHaveBeenCalled();
    expect(mockCheckBuyerPaymentLinkStatus).not.toHaveBeenCalled();
  });

  it('waits for activeBuyerAccount to load before resolving the payment link status', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValue('PAID');
    mockStore({ activeBuyerAccount: null });
    window.history.pushState({}, '', '/buyer/subscription-center?linkId=pl-1');

    try {
      const { rerender } = render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockCheckBuyerPaymentLinkStatus).not.toHaveBeenCalled();

      mockStore({ activeBuyerAccount: { id: 'buyer-1', subscriptionPlan: 'free_trial', remainingFreeRFQs: 4 } });
      rerender(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockCheckBuyerPaymentLinkStatus).toHaveBeenCalledWith('pl-1');
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('renders active premium plan banners for version_1, version_2, and version_3', () => {
    mockStore({ activeSubscription: 'version_1' });
    const { rerender } = render(<SubscriptionCenter />);
    expect(screen.getByText(/Active Premium Plan: Version 1/i)).toBeInTheDocument();

    mockStore({ activeSubscription: 'version_2' });
    rerender(<SubscriptionCenter />);
    expect(screen.getByText(/Active Premium Plan: Version 2/i)).toBeInTheDocument();

    mockStore({ activeSubscription: 'version_3' });
    rerender(<SubscriptionCenter />);
    expect(screen.getByText(/Active Premium Plan: Version 3/i)).toBeInTheDocument();
  });

  it('shows info toast when payment link status returns CANCELED', async () => {
    const originalLocation = window.location.href;
    mockCheckBuyerPaymentLinkStatus.mockResolvedValueOnce('CANCELED');
    window.history.pushState({}, '', '/buyer/subscription-center?linkId=pl-cancelled');

    try {
      render(<SubscriptionCenter />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockShowToast).toHaveBeenCalledWith('Payment Cancelled', 'No changes were made to your subscription.', 'info');
    } finally {
      window.history.pushState({}, '', originalLocation);
    }
  });

  it('switches between 12-month and 6-month durations and updates prices dynamically', () => {
    render(<SubscriptionCenter />);

    // Default: 12-month duration selected
    expect(screen.getByText('₹4,999')).toBeInTheDocument();
    expect(screen.getByText('₹7,499')).toBeInTheDocument();
    expect(screen.getByText('₹9,999')).toBeInTheDocument();
    expect(screen.getAllByText('per month').length).toBe(3);
    expect(screen.getAllByText('+ 18% GST').length).toBe(3);
    expect(screen.queryByText('GST Included')).not.toBeInTheDocument();

    // Old prices must not be present
    expect(screen.queryByText('₹14,999')).not.toBeInTheDocument();
    expect(screen.queryByText('₹19,999')).not.toBeInTheDocument();
    expect(screen.queryByText('₹24,999')).not.toBeInTheDocument();

    // Switch to 6 Months
    fireEvent.click(screen.getByRole('button', { name: '6 Months' }));

    // 6-Month prices must be ₹500 higher: ₹5,499, ₹7,999, ₹10,499
    expect(screen.getByText('₹5,499')).toBeInTheDocument();
    expect(screen.getByText('₹7,999')).toBeInTheDocument();
    expect(screen.getByText('₹10,499')).toBeInTheDocument();
    expect(screen.getAllByText('per month').length).toBe(3);
    expect(screen.getAllByText('+ 18% GST').length).toBe(3);

    // Switch back to 12 Months
    fireEvent.click(screen.getByRole('button', { name: /12 Months/i }));
    expect(screen.getByText('₹4,999')).toBeInTheDocument();
    expect(screen.getByText('₹7,499')).toBeInTheDocument();
    expect(screen.getByText('₹9,999')).toBeInTheDocument();
    expect(screen.getAllByText('per month').length).toBe(3);
  });

  it('opens checkout modal with 6-month price multiplied by 6 months plus 18% GST', async () => {
    mockCreateBuyerPaymentLink.mockResolvedValueOnce('https://payments.zoho.in/mock-buyer-6m');
    render(<SubscriptionCenter />);

    // Switch to 6 Months
    fireEvent.click(screen.getByRole('button', { name: '6 Months' }));

    // Click subscribe on Version 1 (6m price: ₹5,499/mo, 6m base: ₹32,994, with 18% GST: ₹38,932.92)
    fireEvent.click(screen.getByTestId('subscribe-btn-version_1'));

    await waitFor(() => expect(screen.getByText('Secure Payment')).toBeInTheDocument());
    expect(screen.getByText('₹32,994 (₹5,499 × 6 months)')).toBeInTheDocument();
    expect(screen.getByText('₹5,938.92')).toBeInTheDocument();
    expect(screen.getAllByText('₹38,932.92').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('6 Months').length).toBeGreaterThanOrEqual(2);

    // Confirm payment in modal
    fireEvent.click(screen.getByText(/Pay ₹38,932\.92/i));

    await waitFor(() => {
      expect(mockCreateBuyerPaymentLink).toHaveBeenCalledWith('version_1', '6_months');
    });
  });
});
