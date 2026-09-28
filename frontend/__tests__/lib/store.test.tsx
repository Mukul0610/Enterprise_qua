import React from 'react';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { AppProvider, useApp } from '@/lib/store';
import { RFQItem, VendorEntry, BuyerAccount, VendorEvaluationRecord, ExtractedEntity } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import { authClient } from '@/lib/authClient';

// Mock global fetch for API calls triggered by store
const mockFetch = jest.fn();
global.fetch = mockFetch;

// RFQs are served from the authenticated GET /api/rfqs, which returns a bare
// array, while /api/bootstrap returns the reference-data object. The mock has to
// distinguish them or the store reads the wrong shape and reports no RFQs.
const STORE_RFQ_FIXTURES = [
  {
    id: 'rfq-1',
    title: 'Centrifugal Slurry Pumps',
    category: 'Mechanical',
    createdAt: '2026-08-29',
    targetDeliveryDate: '2026-09-20',
    status: 'Quotes Pending',
    sourcingMode: 'mode_1',
    quotesCount: 2,
    budget: 500000,
    extractedEntities: [
      {
        id: 'ent-1',
        itemName: 'Centrifugal Pump 50HP',
        quantity: 4,
        unit: 'units',
        targetDate: '2026-09-20',
        technicalSpecs: '50HP 1450RPM',
        confidence: 95,
        category: 'Centrifugal Pumps',
      },
    ],
    quotes: [
      {
        id: 'q-1',
        vendorId: 'v-001',
        vendorName: 'Apex Industrial Dynamics Pvt Ltd',
        unitPrice: 37500,
        totalPrice: 150000,
        leadTimeDays: 14,
        complianceScore: 96,
        status: 'Under Review',
        submittedAt: '2026-08-29',
        deviationNotes: 'Exact spec match',
      },
    ],
    chasingActive: true,
    followUpData: {
      totalTargetVendors: 3,
      respondedVendors: 1,
      pendingVendors: 2,
      nextScheduledChaser: 'Today 04:00 PM',
      channelStats: { whatsappDelivered: 3, whatsappRead: 2, callsConnected: 2, smsSent: 3 },
      callStats: { connected: 2, total: 3, avgDuration: '1m 30s' },
      whatsappStats: { read: 2, total: 3, responseRate: '66%' },
      smsStats: { delivered: 3, total: 3 },
      emailStats: { opened: 2, total: 3 },
      vendors: [
        {
          vendorId: 'v-001',
          vendorName: 'Apex Supplies Ltd.',
          phone: '+91 98201 44820',
          contactPerson: 'Rajesh Nair',
          call: { status: 'completed', lastAttempt: '2h ago' },
          whatsapp: { status: 'read', lastAttempt: '1h ago' },
          sms: { status: 'delivered', lastAttempt: '3h ago' },
          email24h: { is24hReminderSent: true },
          overallStatus: 'Pending',
          lastInteraction: '1h ago',
          attemptsCount: 3,
          bidStatus: 'Pending',
        },
        {
          vendorId: 'v-002',
          vendorName: 'Global Valve Systems Ltd',
          phone: '+91 98201 44777',
          contactPerson: 'Karan Mehra',
          call: { status: 'pending', lastAttempt: 'never' },
          whatsapp: { status: 'pending', lastAttempt: 'never' },
          sms: { status: 'pending', lastAttempt: 'never' },
          email24h: { is24hReminderSent: false },
          overallStatus: 'Pending',
          lastInteraction: 'never',
          attemptsCount: 0,
          bidStatus: 'Pending',
        },
      ],
    },
  },
];

describe('lib/store.tsx - AppProvider and useApp', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // RFQs come from GET /api/rfqs as a bare array; /api/bootstrap returns the
    // reference-data object. Distinguished here or the store reads the wrong shape.
    const bootstrapPayload = {
  success: true,
  data: {
    buyerAccounts: [
      {
        id: 'buyer-acc-1',
        organizationName: 'Larsen & Toubro Limited',
        industry: 'Engineering & Construction',
        corporateEmail: 'buyer@procucev.com',
        contactPerson: 'Vikram Malhotra',
        phone: '+91 98201 44820',
        sourcingMode: 'mode_1',
        subscriptionPlan: 'version_1',
        remainingFreeRFQs: 5,
        totalRFQsCreated: 2,
        totalSpend: '$450,000',
        accountSource: 'direct_enterprise_signup',
        syncTimestamp: '2026-08-29 10:00 UTC',
        createdDate: '2026-08-29',
      },
      {
        id: 'buyer-acc-2',
        organizationName: 'Siemens Energy Ltd',
        industry: 'Power',
        corporateEmail: 'siemens@procucev.com',
        contactPerson: 'Ravi Verma',
        phone: '+91 98201 55667',
        sourcingMode: 'mode_2',
        subscriptionPlan: 'version_2',
        remainingFreeRFQs: 10,
        accountSource: 'direct_enterprise_signup',
      },
    ],
    vendors: [
      {
        id: 'v-001',
        name: 'Apex Industrial Dynamics Pvt Ltd',
        contactPerson: 'Rajesh Nair',
        email: 'rajesh@apexindustrial.in',
        phone: '+91 98201 44820',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Centrifugal Pumps', 'Slurry Pumps'],
        clientMappedCategories: ['Centrifugal Pumps'],
        vendorSelectedCategories: ['Centrifugal Pumps'],
        location: 'Pune, Maharashtra',
        rating: 4.8,
        source: 'buyer_manual',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        score: 94,
        evaluated: true,
        hasRecord: true,
      },
      {
        id: 'v-002',
        name: 'Global Valve Systems Ltd',
        contactPerson: 'Karan Mehra',
        email: 'karan@globalvalves.in',
        phone: '+91 98201 44777',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Slurry Valves'],
        clientMappedCategories: ['Slurry Valves'],
        vendorSelectedCategories: [],
        location: 'Delhi',
        rating: 4.3,
        source: 'platform_database',
        status: 'REGISTERED / NOT EVALUATED',
        score: 76,
        evaluated: false,
        hasRecord: false,
      },
      {
        id: 'v-003',
        name: 'Mumbai Tech Dynamics',
        contactPerson: 'Sanjay Deshmukh',
        email: 'sanjay@mumbaitech.in',
        phone: '+91 98201 44666',
        majorCategory: 'Electrical',
        minorCategories: ['Switchgears'],
        location: 'Mumbai',
        rating: 0,
        source: 'buyer_manual',
        status: 'REGISTERED / NOT EVALUATED',
        evaluated: false,
      },
      {
        id: 'v-004',
        name: 'MH Spares Ltd',
        contactPerson: 'Nitin Patel',
        email: 'nitin@mhspares.in',
        phone: '+91 98201 44555',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Custom Spares'],
        location: 'MH Hub',
        rating: 4.2,
        source: 'buyer_excel',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        evaluated: true,
      },
    ],
    evaluations: [
      {
        id: 'eval-1',
        vendorId: 'v-001',
        vendorName: 'Apex Industrial Dynamics Pvt Ltd',
        contactPerson: 'Rajesh Nair',
        email: 'rajesh@apexindustrial.in',
        phone: '+91 98201 44820',
        category: 'Engineering Spares - Mechanical',
        submissionDate: '2026-08-29',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        overallScore: 92.4,
        systemAction: 'Auto-Promoted to Preferred Tier',
        moduleScores: {
          commercial: { score: 92, weightedScore: 23.0, maxScore: 25, weight: 25, remarks: 'Fair price' },
          technical: { score: 90, weightedScore: 13.5, maxScore: 15, weight: 15, remarks: 'High tech' },
          quality: { score: 94, weightedScore: 18.8, maxScore: 20, weight: 20, remarks: 'High quality' },
          delivery: { score: 93, weightedScore: 18.6, maxScore: 20, weight: 20, remarks: 'Fast delivery' },
          financial: { score: 80, weightedScore: 8.0, maxScore: 10, weight: 10, remarks: 'Solid finances' },
          governance: { score: 94, weightedScore: 9.4, maxScore: 10, weight: 10, remarks: 'Compliant' },
        },
        documents: [
          { id: 'doc-1', name: 'ISO 9001.pdf', type: 'Quality', uploadDate: '2026-08-29', verified: true, status: 'Verified' },
        ],
      },
      {
        id: 'eval-2',
        vendorId: 'v-002',
        vendorName: 'Global Valve Systems Ltd',
        contactPerson: 'Karan Mehra',
        email: 'karan@globalvalves.in',
        phone: '+91 98201 44777',
        category: 'Engineering Spares - Mechanical',
        submissionDate: '2026-08-29',
        status: 'CONDITIONAL / UNDER REVIEW',
        overallScore: 76.0,
        systemAction: 'Pending Review',
        moduleScores: {
          commercial: { score: 75, weightedScore: 18.75, maxScore: 25, weight: 25, remarks: 'Standard price' },
          technical: { score: 80, weightedScore: 12.0, maxScore: 15, weight: 15, remarks: 'Acceptable tech' },
          quality: { score: 75, weightedScore: 15.0, maxScore: 20, weight: 20, remarks: 'Standard quality' },
          delivery: { score: 75, weightedScore: 15.0, maxScore: 20, weight: 20, remarks: 'Standard delivery' },
          financial: { score: 70, weightedScore: 7.0, maxScore: 10, weight: 10, remarks: 'Stable' },
          governance: { score: 80, weightedScore: 8.0, maxScore: 10, weight: 10, remarks: 'Compliant' },
        },
        documents: [],
      },
    ],
    auditLogs: [
      {
        id: 'log-1',
        timestamp: '2026-08-29 10:00:00',
        action: 'Initial system bootstrap',
        user: 'System Bot',
        hash: 'abc123sha256',
      },
    ],
    aiFeed: [
      {
        id: 'feed-1',
        timestamp: '10:00 AM',
        title: 'Bootstrap Completed',
        message: 'System loaded successfully',
        type: 'system',
      },
    ],
    systemConfig: {
      ollamaModel: 'Llama 3 (8B Instruct)',
      ollamaActive: true,
      ocrExtractionThreshold: 85,
      whatsappAutoChaser: true,
      voiceCallAutoChaser: true,
      smsAutoChaser: true,
      escalationIntervalHours: 24,
    },
  },
    };
    // Method-aware: GET /api/rfqs lists (an array), POST /api/rfqs creates (one
    // record). The server allocates the RFQ number, so the created record carries
    // one the caller did not supply — which is exactly what the store must adopt.
    let allocated = 0;
    let allocatedVendors = 0;
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const isRfqEndpoint = typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url);
      const isVendorsEndpoint = typeof url === 'string' && /\/api\/vendors(\?|$)/.test(url);
      if (isVendorsEndpoint && init?.method === 'POST') {
        allocatedVendors += 1;
        const sent = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: { ...sent, id: `v-added-${allocatedVendors}` } }),
        });
      }
      if (isRfqEndpoint && init?.method === 'POST') {
        allocated += 1;
        const sent = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              ...sent,
              id: `${allocated}`,
              rfqId: `RFQ26040900000${allocated}`,
              rfqNumber: `RFQ26040900000${allocated}`,
              createdAt: '2026-09-04T10:00:00.000Z',
              quotes: [],
              quotesCount: 0,
              chasingActive: false,
              aiSummary: null,
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => (isRfqEndpoint ? { success: true, data: STORE_RFQ_FIXTURES } : bootstrapPayload),
      });
    });
  });

  it('throws error when useApp is called outside of AppProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const TestComponent = () => {
      useApp();
      return <div>Test</div>;
    };
    expect(() => render(<TestComponent />)).toThrow('useApp must be used within an AppProvider');
    spy.mockRestore();
  });

  it('hydrates initial state from /api/bootstrap and exposes store contexts', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return (
        <div>
          <span data-testid="role">{contextValue.currentRole}</span>
          <span data-testid="mode">{contextValue.currentMode}</span>
          <span data-testid="theme">{contextValue.theme}</span>
          <span data-testid="db">{contextValue.dbConnected ? 'connected' : 'disconnected'}</span>
          <span data-testid="rfq-count">{contextValue.rfqs.length}</span>
          <button onClick={() => contextValue.toggleTheme()}>Toggle Theme</button>
        </div>
      );
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('rfq-count')).toHaveTextContent('1');
    });

    expect(contextValue.rfqs.length).toBe(1);
    expect(contextValue.buyerAccounts.length).toBe(2);
    expect(contextValue.buyerVendors.length).toBe(4);
    expect(contextValue.vendorEvaluations.length).toBe(2);

    // Call refreshFromDB again when activeBuyerAccount is already set
    await act(async () => {
      await contextValue.refreshFromDB();
    });

    // Call refreshFromDB when data is empty object (takes all fallback branches)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {},
      }),
    });
    await act(async () => {
      await contextValue.refreshFromDB();
    });

    // Test Theme toggle twice (light -> dark -> light)
    fireEvent.click(screen.getByText('Toggle Theme'));
    expect(contextValue.theme).toBe('dark');
    fireEvent.click(screen.getByText('Toggle Theme'));
    expect(contextValue.theme).toBe('light');

    // Test mount with saved 'dark' theme in localStorage
    localStorage.setItem('procucev_theme', 'dark');
    let darkThemeContext: any;
    const DarkConsumer = () => {
      darkThemeContext = useApp();
      return <div>Theme: {darkThemeContext.theme}</div>;
    };
    render(
      <AppProvider>
        <DarkConsumer />
      </AppProvider>
    );
    expect(darkThemeContext.theme).toBe('dark');
    localStorage.removeItem('procucev_theme');

    // Call refreshFromDB when activeBuyerAccount is already set to buyer-acc-1 (matching)
    act(() => {
      contextValue.alignActiveBuyerAccount('buyer-acc-1');
    });
    await act(async () => {
      await contextValue.refreshFromDB();
    });
  });

  it('handles role switching and tab defaults', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return (
        <div>
          <span data-testid="role">{contextValue.currentRole}</span>
          <span data-testid="tab">{contextValue.activeTab}</span>
        </div>
      );
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.dbConnected).toBe(true));

    act(() => {
      contextValue.setCurrentRole('category_manager');
    });
    expect(contextValue.activeTab).toBe('kanban_board');

    act(() => {
      contextValue.setCurrentRole('vendor');
    });
    expect(contextValue.activeTab).toBe('vendor_feed');

    act(() => {
      contextValue.setCurrentRole('admin');
    });
    expect(contextValue.activeTab).toBe('infra_control');

    act(() => {
      contextValue.setCurrentRole('buyer');
    });
    expect(contextValue.activeTab).toBe('command_center');
  });

  it('handles all state setters (systemConfig, subscriptions, catalogue, selfEvaluation)', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Config: {contextValue.systemConfig.ollamaModel}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.dbConnected).toBe(true));

    act(() => {
      contextValue.setIsLoggedIn(false);
      contextValue.setCurrentMode('mode_3');
      contextValue.setActiveTab('custom_tab');
      contextValue.setSystemConfig({ ...contextValue.systemConfig, ollamaActive: false });
      contextValue.setRemainingFreeRFQs(3);
      contextValue.setActiveSubscription('version_3');
      contextValue.setVendorSubscription('select');
      contextValue.setVendorRfqDownloadsUsed(10);
      contextValue.setVendorCatalogue([{ id: 'cat-1', name: 'Item SKU 1' }]);
      contextValue.setVendorSelfEvaluationCompleted(true);
      contextValue.setVendorSelfEvaluationScore(98.5);
      contextValue.setInitialSetupModalOpen(true);
      contextValue.setInitialSetupCompleted(true);
      contextValue.setHistoricalPurchaseDataPeriod('3_years');
      contextValue.setSelectedRFQForMatrix(null);
    });

    expect(contextValue.isLoggedIn).toBe(false);
    expect(contextValue.currentMode).toBe('mode_3');
    expect(contextValue.activeTab).toBe('custom_tab');
    expect(contextValue.vendorSubscription).toBe('select');
    expect(contextValue.isVendorEvaluationFeeWaived).toBe(true);
    expect(contextValue.vendorSelfEvaluationScore).toBe(98.5);
    expect(contextValue.vendorCatalogue.length).toBe(1);
    expect(contextValue.initialSetupCompleted).toBe(true);
    expect(contextValue.historicalPurchaseDataPeriod).toBe('3_years');
  });

  it('handles buyer accounts operations (add, update, delete, align, import)', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Buyer Accounts: {contextValue.buyerAccounts.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.dbConnected).toBe(true));

    // 1. Add Buyer Account
    let newAcc: BuyerAccount;
    act(() => {
      newAcc = contextValue.addBuyerAccount({
        organizationName: 'Tata Projects Ltd',
        industry: 'Infrastructure',
        corporateEmail: 'tata@procucev.com',
        contactPerson: 'Karan Sharma',
        phone: '+91 98201 11223',
        sourcingMode: 'mode_2',
        subscriptionPlan: 'version_2',
        remainingFreeRFQs: 10,
        accountSource: 'direct_enterprise_signup',
      });
    });

    // 2. Update Buyer Account when active vs inactive
    act(() => {
      contextValue.alignActiveBuyerAccount(newAcc.id);
    });

    // updateBuyerAccount now PUTs to the real, gated /api/buyer-accounts/:id
    // route and only applies the change locally once the server confirms it
    // (see the fix in lib/store.tsx) — so the mock has to actually answer
    // that route for these assertions to resolve.
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const match = typeof url === 'string' && url.match(/\/api\/buyer-accounts\/([^/]+)$/);
      if (match && init?.method === 'PUT') {
        const id = match[1];
        const sent = JSON.parse(init.body || '{}');
        const known = [...contextValue.buyerAccounts, newAcc].find((a: BuyerAccount) => a.id === id);
        if (!known) {
          return Promise.resolve({
            ok: false,
            status: 404,
            json: async () => ({ success: false, error: `Buyer account ${id} not found.` }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { ...known, ...sent } }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
    });

    act(() => {
      contextValue.updateBuyerAccount(newAcc.id, {
        industry: 'Heavy Infrastructure & Power',
      });
      // update inactive account
      contextValue.updateBuyerAccount('buyer-acc-2', {
        industry: 'Renewable Power',
      });
      // update non-existent account (server 404s; handled without throwing)
      contextValue.updateBuyerAccount('non-existent-id', {
        industry: 'Noop',
      });
    });
    await waitFor(() =>
      expect(contextValue.activeBuyerAccount?.industry).toBe('Heavy Infrastructure & Power')
    );

    // 3. Align non-existent account does not throw
    act(() => {
      contextValue.alignActiveBuyerAccount('non-existent-id');
    });

    // 4. Import Public Buyer Database
    act(() => {
      const importedCount = contextValue.importPublicBuyerDatabase([
        {
          organizationName: 'Reliance Industries Ltd',
          industry: 'Petrochemicals',
          corporateEmail: 'ril@procucev.com',
          contactPerson: 'Anil Deshmukh',
          phone: '+91 98201 33445',
          sourcingMode: 'mode_3',
          subscriptionPlan: 'version_3',
          remainingFreeRFQs: 20,
          accountSource: 'public_database_sync',
        },
      ]);
      expect(importedCount).toBe(1);
    });

    // 5. Delete Buyer Account (active account vs other)
    act(() => {
      contextValue.deleteBuyerAccount(newAcc.id);
    });
    expect(contextValue.buyerAccounts.some((a: BuyerAccount) => a.id === newAcc.id)).toBe(false);
  });

  it('handles buyer vendors, matching, reminders, and profile completion with dual-stream category resolution', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Vendors: {contextValue.buyerVendors.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.buyerVendors.length).toBeGreaterThan(0));

    // 1. Add single Buyer Vendor (new and existing in DB)
    let addedVendor: VendorEntry | null = null;
    await act(async () => {
      addedVendor = await contextValue.addBuyerVendor({
        name: 'Precision Hydro Pumps',
        contactPerson: 'Karan Sharma',
        email: 'karan@precisionhydro.in',
        phone: '+91 98201 44999',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Centrifugal Pumps'],
        clientMappedCategories: ['Centrifugal Pumps'],
        vendorSelectedCategories: ['Centrifugal Pumps'],
        location: 'Ahmedabad, Gujarat',
        rating: 4.5,
        source: 'buyer_manual',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        score: 88,
        evaluated: true,
      });
      // Add existing vendor in DB
      await contextValue.addBuyerVendor({
        name: 'Apex Industrial Dynamics Pvt Ltd',
        contactPerson: 'Rajesh Nair',
        email: 'rajesh@apexindustrial.in',
        phone: '+91 98201 44820',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Centrifugal Pumps'],
        location: 'Pune',
      });
    });
    expect(contextValue.buyerVendors.some((v: VendorEntry) => v.name === 'Precision Hydro Pumps')).toBe(true);

    // 2. Add further buyer vendors with diverse category mappings (real bulk
    // upload now goes through POST /api/vendors/bulk-import, covered
    // separately in VendorUploadModal.test.tsx and the backend's own
    // storeService.test.js — this just needs more vendors on the client-side
    // buyerVendors list for the matching assertions below).
    await act(async () => {
      await contextValue.addBuyerVendor({
        name: 'FlowTech Systems',
        contactPerson: 'Sunil Rao',
        email: 'sunil@flowtech.in',
        phone: '+91 98201 44111',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Slurry Pumps'],
        clientMappedCategories: ['Slurry Pumps'],
        vendorSelectedCategories: [],
        location: 'Mumbai, Maharashtra',
        rating: 4.6,
        source: 'buyer_manual',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        score: 90,
        evaluated: true,
      });
      await contextValue.addBuyerVendor({
        name: 'Self Declared Vendor',
        contactPerson: 'Amit Kumar',
        email: 'amit@selfdeclared.in',
        phone: '+91 98201 44222',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: [],
        clientMappedCategories: [],
        vendorSelectedCategories: ['High Pressure Valves'],
        location: '', // empty location branch
        rating: 0,    // rating 0 branch
        source: 'buyer_manual',
        status: 'REGISTERED / NOT EVALUATED',
        evaluated: false,
      });
    });
    expect(contextValue.buyerVendors.some((v: VendorEntry) => v.name === 'FlowTech Systems')).toBe(true);

    // 3. Match Suitable Vendors across mode_1, mode_2, mode_3, unmatched categories, and customList
    const entities: ExtractedEntity[] = [
      {
        id: 'e1',
        itemName: 'Centrifugal Pump 50HP',
        quantity: 2,
        unit: 'units',
        targetDate: '2026-10-15',
        technicalSpecs: '50HP',
        confidence: 90,
        category: 'Centrifugal Pumps',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Centrifugal Pumps',
      },
      {
        id: 'e2',
        itemName: 'Slurry Pump 100GPM',
        quantity: 1,
        unit: 'units',
        targetDate: '2026-10-15',
        technicalSpecs: '100GPM',
        confidence: 90,
        category: 'Slurry Pumps',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Slurry Pumps',
      },
      {
        id: 'e3',
        itemName: 'High Pressure Valve 4-inch',
        quantity: 5,
        unit: 'units',
        targetDate: '2026-10-15',
        technicalSpecs: '4-inch',
        confidence: 90,
        category: 'High Pressure Valves',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'High Pressure Valves',
      },
    ];

    const unmatchedEntities: ExtractedEntity[] = [
      {
        id: 'e-unmatched',
        itemName: 'Obscure Aerospace Part XYZ',
        quantity: 1,
        unit: 'units',
        targetDate: '2026-10-15',
        technicalSpecs: 'XYZ',
        confidence: 10,
        category: 'Aerospace Obscurity',
        majorCategory: 'Aerospace',
        minorCategory: 'Aerospace Obscurity',
      },
    ];

    let matchedMode1: VendorEntry[] = [];
    let matchedMode2: VendorEntry[] = [];
    let matchedMode3: VendorEntry[] = [];
    let matchedCustom: VendorEntry[] = [];
    let matchedFallbackMode1: VendorEntry[] = [];
    let matchedFallbackMode2: VendorEntry[] = [];
    let matchedFallbackMode3: VendorEntry[] = [];

    act(() => {
      matchedMode1 = contextValue.matchSuitableVendors(entities, 'mode_1');
      matchedMode2 = contextValue.matchSuitableVendors(entities, 'mode_2');
      matchedMode3 = contextValue.matchSuitableVendors(entities, 'mode_3');
      matchedCustom = contextValue.matchSuitableVendors(entities, 'mode_1', [addedVendor, addedVendor]);
      matchedFallbackMode1 = contextValue.matchSuitableVendors(unmatchedEntities, 'mode_1');
      matchedFallbackMode2 = contextValue.matchSuitableVendors(unmatchedEntities, 'mode_2');
      matchedFallbackMode3 = contextValue.matchSuitableVendors(unmatchedEntities, 'mode_3');

      // Test sorting permutations for mode 2 and mode 3 (unevaluated vs evaluated, and equal evaluations)
      const unEvalVendor: VendorEntry = { id: 'v-uneval', name: 'Unevaluated Corp', contactPerson: 'Tester', phone: '+91 99999 11111', majorCategory: 'Mechanical', minorCategories: ['Centrifugal Pumps'], email: 'un@eval.com', rating: 0, location: 'Delhi', source: 'buyer_manual', status: 'REGISTERED / NOT EVALUATED' };
      const evalVendor: VendorEntry = { id: 'v-eval', name: 'Evaluated Corp', contactPerson: 'Tester', phone: '+91 99999 22222', majorCategory: 'Mechanical', minorCategories: ['Centrifugal Pumps'], email: 'ev@eval.com', rating: 4.5, location: 'Mumbai', source: 'buyer_manual', status: 'PREFERRED ENTERPRISE SUPPLIER' };
      contextValue.matchSuitableVendors(entities, 'mode_2', [unEvalVendor, evalVendor]);
      contextValue.matchSuitableVendors(entities, 'mode_2', [evalVendor, evalVendor]);
      contextValue.matchSuitableVendors(entities, 'mode_3', [unEvalVendor, evalVendor]);
      contextValue.matchSuitableVendors(entities, 'mode_3', [evalVendor, evalVendor]);
    });
    expect(matchedMode1.length).toBeGreaterThan(0);
    expect(matchedMode2.length).toBeGreaterThan(0);
    expect(matchedMode3.length).toBeGreaterThan(0);
    expect(matchedCustom.length).toBe(2);
    expect(matchedFallbackMode1.length).toBeGreaterThan(0);
    expect(matchedFallbackMode2.length).toBeGreaterThan(0);
    expect(matchedFallbackMode3.length).toBeGreaterThan(0);

    // 4. Generate Standard RFQ Email (mode_1, mode_2, mode_3)
    const sampleRfq: RFQItem = {
      id: 'r-1',
      rfqNumber: 'RFQ260409000001',
      title: 'Sample RFQ',
      category: 'Mechanical',
      createdAt: '2026-08-29',
      targetDeliveryDate: '2026-09-30',
      status: 'Quotes Pending',
      sourcingMode: 'mode_2',
      quotesCount: 0,
      budget: 100000,
      extractedEntities: entities,
      quotes: [],
      chasingActive: true,
    };
    const rfqEmailMode2 = contextValue.generateStandardRFQEmail(sampleRfq, addedVendor!);
    expect(rfqEmailMode2.specialInstructions).toContain('Hybrid Competitive Sourcing');

    const sampleRfqMode3: RFQItem = { ...sampleRfq, sourcingMode: 'mode_3' };
    const rfqEmailMode3 = contextValue.generateStandardRFQEmail(sampleRfqMode3, { ...addedVendor!, minorCategories: [] });
    expect(rfqEmailMode3.specialInstructions).toContain('Mode 3 360-Degree');

    // Test mode 1 with vendor without minor categories, empty majorCategory, empty contact fields and empty extracted entities
    const sampleRfqMode1: RFQItem = { ...sampleRfq, sourcingMode: 'mode_1', budget: 0, category: '', createdAt: '', extractedEntities: [{ itemName: 'Bare Item' } as any] };
    const rfqEmailMode1 = contextValue.generateStandardRFQEmail(sampleRfqMode1, {
      id: 'v-fallback',
      name: 'Fallback Vendor',
      email: 'fallback@vendor.com',
      majorCategory: '',
      minorCategories: [],
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: false,
    });
    expect(rfqEmailMode1.specialInstructions).toContain('Strict Single-Roster');
    expect(rfqEmailMode1.matchedMajorCategory).toBe('Industrial Procurement');

    // Test invalid sourcing mode fallback
    const invalidModeEmail = contextValue.generateStandardRFQEmail({ ...sampleRfq, sourcingMode: 'invalid_mode' as any }, addedVendor!);
    expect(invalidModeEmail.sourcingModeName).toBeDefined();

    // Open standard email modal without passing vendor and with followUpData null or non-matching vendor
    act(() => {
      contextValue.openStandardEmailModal(sampleRfq);
      contextValue.openStandardEmailModal({ ...sampleRfq, followUpData: undefined as any });
      contextValue.openStandardEmailModal({ ...sampleRfq, followUpData: { vendors: [{ vendorName: 'Unknown Nonexistent Supplier' }] } as any });
    });
    expect(contextValue.emailModalOpen).toBe(true);

    // 5. Open Onboarding Email Modal & Generate Onboarding Email
    const emailNew = contextValue.generateVendorOnboardingEmail({
      ...addedVendor!,
      minorCategories: ['Centrifugal Pumps'],
    }, false, 'CustomPass123#');
    expect(emailNew.subject).toContain('Preferred Vendor Network');

    const emailExistingMapped = contextValue.generateVendorOnboardingEmail({
      ...addedVendor!,
      minorCategories: ['Centrifugal Pumps'],
    }, true, 'CustomPass123#');
    expect(emailExistingMapped.subject).toContain('Network Association');

    const emailUnmapped = contextValue.generateVendorOnboardingEmail({
      ...addedVendor!,
      majorCategory: 'Uncategorized (No Past POs)',
      minorCategories: [],
    }, false);
    expect(emailUnmapped.subject).toContain('Set Up Categories');

    const emailUnassigned = contextValue.generateVendorOnboardingEmail({
      ...addedVendor!,
      majorCategory: '(None Assigned by Buyer)',
      minorCategories: [],
    }, false);
    expect(emailUnassigned.assignedMajorCategory).toBe('(None Assigned by Buyer)');

    act(() => {
      contextValue.openOnboardingEmailModal(addedVendor!);
    });
    expect(contextValue.onboardingEmailModalOpen).toBe(true);
    expect(contextValue.selectedOnboardingEmail).not.toBeNull();

    // 6. Trigger Vendor Reminder & Complete Profile
    act(() => {
      contextValue.triggerVendorReminder(addedVendor!.id);
      contextValue.triggerVendorReminder('non-existent-vendor');
      contextValue.completeVendorProfile('karan@precisionhydro.in', ['Custom Valves']);
      contextValue.completeVendorProfile('unknown@precisionhydro.in');
    });

    // 7. Save Vendor Profile Categories (aligned and mismatched)
    act(() => {
      // Aligned: clientCats and vendorCats identical (hitting line 694)
      contextValue.saveVendorProfileCategories('karan@precisionhydro.in', ['Centrifugal Pumps'], ['Centrifugal Pumps']);
      // Mismatched: clientCats and vendorCats different
      contextValue.saveVendorProfileCategories('karan@precisionhydro.in', ['Cat A', 'Cat B'], ['Cat A', 'Cat C']);
      // Non-matching vendor email
      contextValue.saveVendorProfileCategories('nobody@nowhere.com', ['Cat A'], ['Cat B']);
      contextValue.setClientMappedCategories(['Cat A']);
      contextValue.setVendorSelectedCategories(['Cat B']);
    });

    // 8. Delete Buyer Vendor
    act(() => {
      contextValue.deleteBuyerVendor(addedVendor!.id);
      contextValue.deleteBuyerVendor('non-existent-vendor-id');
    });
    expect(contextValue.buyerVendors.some((v: VendorEntry) => v.id === addedVendor!.id)).toBe(false);
  });

  it('handles RFQ creation, working hours calculations, subscription limits validation, and sequence timers', async () => {
    jest.useFakeTimers();
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>RFQs: {contextValue.rfqs.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.buyerVendors.length).toBeGreaterThan(0));

    // 1. Subscription limit validation errors inside act
    act(() => {
      contextValue.setActiveSubscription('none');
    });
    // Rejected rather than thrown: addNewRFQ persists before touching state.
    await expect(
      contextValue.addNewRFQ({
        title: 'Error RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 100000,
        extractedEntities: [],
      })
    ).rejects.toThrow('Subscription required');

    act(() => {
      contextValue.setActiveSubscription('free_trial');
      contextValue.setRemainingFreeRFQs(0);
    });
    await expect(
      contextValue.addNewRFQ({
        title: 'Error RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 100000,
        extractedEntities: [],
      })
    ).rejects.toThrow('Free account quota exhausted');

    act(() => {
      contextValue.setActiveSubscription('version_1');
    });
    await expect(
      contextValue.addNewRFQ({
          title: 'Error RFQ',
          category: 'Mechanical',
          targetDeliveryDate: '2026-10-15',
          sourcingMode: 'mode_2',
          budget: 100000,
          extractedEntities: [],
        })
    ).rejects.toThrow('Subscription required');

    await expect(
      contextValue.addNewRFQ({
          title: 'Error RFQ',
          category: 'Mechanical',
          targetDeliveryDate: '2026-10-15',
          sourcingMode: 'mode_3',
          budget: 100000,
          extractedEntities: [],
        })
    ).rejects.toThrow('Subscription required');

    // 2. Add New RFQ with free_trial and mode_1
    act(() => {
      contextValue.setActiveSubscription('free_trial');
      contextValue.setRemainingFreeRFQs(5);
    });

    // Test addWorkingHours on Saturday night at 20:00 (rolls over Sunday to Monday)
    const saturdayNight = new Date(2026, 7, 29, 20, 0, 0); // Saturday 8 PM local
    jest.setSystemTime(saturdayNight);

    let createdRfqMode1: RFQItem;
    await act(async () => {
      createdRfqMode1 = await contextValue.addNewRFQ({
        title: 'High Pressure Water Turbines',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 600000,
        extractedEntities: [
          {
            id: 'ent-99',
            itemName: 'Water Turbine 100kW',
            quantity: 2,
            unit: 'units',
            targetDate: '2026-10-15',
            technicalSpecs: '100kW Pelton Turbine',
            confidence: 92,
            category: 'Turbines',
          },
        ],
        customMatchedVendors: [
          {
            id: 'v-apex-custom',
            name: 'Apex Supplies Ltd.',
            contactPerson: 'Rajesh Nair',
            email: 'rajesh@apex.in',
            phone: '+91 98201 44820',
            majorCategory: 'Mechanical',
            minorCategories: ['Turbines'],
            location: 'Pune',
            rating: 4.8,
            source: 'buyer_manual',
            status: 'PREFERRED ENTERPRISE SUPPLIER',
            evaluated: true,
          },
          {
            id: 'v-other-custom',
            name: 'Other Non-Apex Vendor',
            contactPerson: 'Karan Mehra',
            email: 'karan@other.in',
            phone: '+91 98201 44777',
            majorCategory: 'Mechanical',
            minorCategories: ['Turbines'],
            location: 'Delhi',
            rating: 4.3,
            source: 'buyer_manual',
            status: 'REGISTERED / NOT EVALUATED',
            evaluated: false,
          },
          {
            id: 'v-dup',
            name: 'Duplicate Vendor',
            email: 'karan@other.in', // Duplicate email exercises seenKeys.has(key)
            location: 'Delhi',
          },
          {
            id: '',
            name: 'Nameless Vendor',
            phone: '',
            contactPerson: '',
            location: 'Delhi',
          },
        ],
      });
      contextValue.setSelectedRFQForDeepDive(createdRfqMode1);
    });
    // Server-allocated: the client no longer chooses this.
    expect(createdRfqMode1!.rfqNumber).toMatch(/^RFQ\d+$/);

    // Test Sunday start with budget = 0 and source email_gateway
    const sundayDate = new Date(2026, 7, 30, 10, 0, 0); // Sunday 10 AM local
    jest.setSystemTime(sundayDate);
    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Sunday RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_2',
        budget: 0,
        extractedEntities: [],
        source: 'email_gateway',
      });
    });

    // Test free_trial with mode_3 (testing 'Version 3 (Autonomous AI)' branch in modeName)
    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Free Trial Mode 3 RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_3',
        budget: 200000,
        extractedEntities: [],
      });
    });

    // Test early morning before 8 AM
    const earlyDate = new Date(2026, 7, 31, 5, 0, 0); // Monday 5 AM local
    jest.setSystemTime(earlyDate);
    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Early Morning RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_2',
        budget: 100000,
        extractedEntities: [],
      });
    });

    // First advance timers with matching selectedRFQForDeepDive (executing lines 1955-1970)
    act(() => {
      jest.advanceTimersByTime(20000);
    });

    // Create another mode 1 RFQ and advance timers with non-matching selectedRFQForDeepDive (executing line 1978)
    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Turbine Spares B',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 50000,
        extractedEntities: [],
        customMatchedVendors: [
          {
            id: 'v-apex-b',
            name: 'Apex Supplies Ltd.',
            contactPerson: 'Rajesh Nair',
            email: 'rajesh@apex.in',
            phone: '+91 98201 44820',
            majorCategory: 'Mechanical',
            minorCategories: ['Turbines'],
            location: 'Pune',
            rating: 4.8,
            source: 'buyer_manual',
            status: 'PREFERRED ENTERPRISE SUPPLIER',
            evaluated: true,
          },
        ],
      });
      contextValue.setSelectedRFQForDeepDive({ id: 'other-rfq', rfqNumber: 'RFQ-OTHER' } as any);
    });

    act(() => {
      jest.advanceTimersByTime(20000);
    });

    // 3. Add New RFQ with mode_3 and version_3 plan
    act(() => {
      contextValue.setActiveSubscription('version_3');
    });

    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Autonomous Slurry Valves',
        category: 'Mechanical',
        targetDeliveryDate: '2026-11-20',
        sourcingMode: 'mode_3',
        budget: 450000,
        extractedEntities: [
          {
            id: 'ent-m3',
            itemName: 'Slurry Valve 8-inch',
            quantity: 5,
            unit: 'units',
            targetDate: '2026-11-20',
            technicalSpecs: '8-inch Flanged ANSI 300',
            confidence: 94,
            category: 'Valves',
          },
        ],
      });
    });

    // 4. Chaser Triggers (WhatsApp, Single Channel, Batch Channel) across all 4 channels
    act(() => {
      contextValue.triggerWhatsAppChaser('RFQ-2026-001');
      contextValue.triggerChannelChaser('RFQ-2026-001', 'call'); // default vendorName parameter
      contextValue.triggerChannelChaser('RFQ-2026-001', 'call', 'Apex Supplies Ltd.', 'Custom Voice Note');
      contextValue.triggerChannelChaser('RFQ-2026-001', 'sms', 'Apex Supplies Ltd.', 'SMS Alert');
      contextValue.triggerChannelChaser('RFQ-2026-001', 'email', 'Apex Supplies Ltd.', '24h Email');
      contextValue.triggerChannelChaser('RFQ-2026-001', 'call', 'Non-existent RFQ vendor');
      contextValue.triggerBatchChannelChaser('RFQ-2026-001', ['call', 'whatsapp', 'sms']);
    });

    // 5. Submit Vendor Bid (both existing and new)
    act(() => {
      contextValue.submitVendorBid('RFQ-2026-999', 290000, 21, 'Discounted price for quick turnaround');
      contextValue.submitVendorBid('RFQ-2026-999', 280000, 18, 'Updated quote');
      contextValue.submitVendorBid('RFQ-2026-NONEXISTENT', 1000, 5, 'Invalid bid');
    });

    // 6. Approve PO
    await act(async () => {
      await contextValue.approvePO('RFQ-2026-999', 'v-apex-b', 'Apex Supplies Ltd.', 580000, 'Test approval note');
      await contextValue.approvePO('RFQ-2026-NONEXISTENT', null, 'Unknown', 100);
    });

    // Approve PO failure paths: a rejected response and a network-level throw
    // must both resolve to { success: false } without navigating or updating
    // RFQ state, rather than throwing out of the handler.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, error: 'PO rejected' }) });
    await act(async () => {
      const result = await contextValue.approvePO('RFQ-2026-999', 'v-apex-b', 'Apex Supplies Ltd.', 580000, 'Rejected case');
      expect(result.success).toBe(false);
    });

    mockFetch.mockRejectedValueOnce(new Error('Network down'));
    await act(async () => {
      const result = await contextValue.approvePO('RFQ-2026-999', 'v-apex-b', 'Apex Supplies Ltd.', 580000, 'Network failure case');
      expect(result.success).toBe(false);
    });

    // 7. Open Deep Dive & Modal triggers
    act(() => {
      contextValue.openRFQDeepDive(createdRfqMode1!);
      contextValue.openStandardEmailModal(createdRfqMode1!);
    });
    expect(contextValue.deepDiveModalOpen).toBe(true);
    expect(contextValue.emailModalOpen).toBe(true);

    jest.useRealTimers();
  });

  it('projects a vendor opportunity from an RFQ with no deadline or budget without inventing values', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>RFQs: {contextValue.rfqs.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.buyerVendors.length).toBeGreaterThan(0));

    act(() => {
      contextValue.setActiveSubscription('version_3');
    });

    let created: RFQItem;
    await act(async () => {
      created = await contextValue.addNewRFQ({
        rfqNumber: 'RFQ-NO-DEADLINE',
        title: 'Undated Sourcing Request',
        category: 'Mechanical',
        targetDeliveryDate: '',
        sourcingMode: 'mode_1',
        budget: 0,
        extractedEntities: [],
      });
    });

    // The server allocates the real rfqNumber, ignoring whatever the client sent.
    const opportunity = contextValue.vendorOpportunities.find((o: any) => o.rfqNumber === created.rfqNumber);
    expect(opportunity).toBeDefined();
    // No deadline was ever set — daysRemaining must not fall back to a
    // fabricated countdown, and estimatedValue must not fall back to a
    // fabricated budget ceiling the buyer never stated.
    expect(opportunity.deadline).toBe('');
    expect(opportunity.daysRemaining).toBe(0);
    expect(opportunity.estimatedValue).toBeUndefined();
  });

  it('handles vendor evaluation, rating revisions, audit logs, and feed items', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Logs: {contextValue.auditLogs.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.vendorEvaluations.length).toBeGreaterThan(0));

    // 1. Add Vendor Evaluation Record
    const evalRecord: VendorEvaluationRecord = {
      id: 'eval-99',
      vendorId: 'v-001',
      vendorName: 'Apex Industrial Dynamics Pvt Ltd',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apexindustrial.in',
      phone: '+91 98201 44820',
      category: 'Mechanical',
      submissionDate: '2026-08-29',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      overallScore: 95.0,
      systemAction: 'Promoted',
      moduleScores: {
        commercial: { score: 95, weightedScore: 23.75, maxScore: 25, weight: 25, remarks: 'Best' },
        technical: { score: 95, weightedScore: 14.25, maxScore: 15, weight: 15, remarks: 'High' },
        quality: { score: 95, weightedScore: 19.0, maxScore: 20, weight: 20, remarks: 'High' },
        delivery: { score: 95, weightedScore: 19.0, maxScore: 20, weight: 20, remarks: 'Fast delivery' },
        financial: { score: 90, weightedScore: 9.0, maxScore: 10, weight: 10, remarks: 'Strong' },
        governance: { score: 95, weightedScore: 9.5, maxScore: 10, weight: 10, remarks: 'Compliant' },
      },
      documents: [
        { id: 'd1', name: 'Cert.pdf', type: 'Quality', uploadDate: '2026-08-29', verified: true, status: 'Verified' },
      ],
    };

    await act(async () => {
      const saved = await contextValue.addVendorEvaluation(evalRecord);
      expect(saved).toBe(true);
      contextValue.openVendorEvaluationSummary(evalRecord);
    });
    expect(contextValue.evaluationModalOpen).toBe(true);

    // Failure paths: the caller must learn a submission was NOT saved,
    // whether the request itself failed or the server reported success:false.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, error: 'Server error' }) });
    await act(async () => {
      const saved = await contextValue.addVendorEvaluation({ ...evalRecord, id: 'eval-fail-1' });
      expect(saved).toBe(false);
    });

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: false, error: 'Rejected' }) });
    await act(async () => {
      const saved = await contextValue.addVendorEvaluation({ ...evalRecord, id: 'eval-fail-2' });
      expect(saved).toBe(false);
    });

    // 2. Revise Vendor Rating (preferred, conditional, disqualified, and unknown vendor).
    // reviseVendorRating awaits the real POST /api/vendors/:id/rating-revision and
    // uses the server's response as the source of truth, so each call needs an
    // explicit mocked response shaped like the real endpoint's { success, data:
    // { revisionRecord, updatedVendor } } payload.
    const mockRevisionResponse = (overrides: Record<string, unknown> = {}) => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          revisionRecord: {
            id: `rev-${Date.now()}`,
            vendorId: 'v-001',
            vendorName: 'Apex Supplies Ltd.',
            buyerCompany: 'Larsen & Toubro Limited',
            buyerName: 'Vikram Malhotra',
            buyerEmail: 'buyer@procucev.com',
            timestamp: new Date().toISOString(),
            qualityScore: 92,
            costScore: 94,
            deliveryScore: 90,
            buyerAverage: 92,
            previousScore: 85,
            newCompositeScore: 90,
            previousRating: 4.3,
            newRating: 4.5,
            remarks: 'Excellent quality performance',
            emailDispatched: true,
            shaSignature: 'sha256-test',
            ...overrides,
          },
          updatedVendor: { id: 'v-001', score: 90, rating: 4.5 },
        },
      }),
    });

    let revision1: any;
    await act(async () => {
      mockFetch.mockResolvedValueOnce(mockRevisionResponse());
      revision1 = await contextValue.reviseVendorRating('v-001', 92, 94, 90, 'Excellent quality performance');
      contextValue.openRatingRevisionEmailModal(revision1);

      mockFetch.mockResolvedValueOnce(mockRevisionResponse({ newCompositeScore: 65, remarks: 'Conditional review' }));
      const revision2 = await contextValue.reviseVendorRating('v-001', 65, 70, 60, 'Conditional review');
      expect(revision2.newCompositeScore).toBeDefined();

      mockFetch.mockResolvedValueOnce(
        mockRevisionResponse({ newCompositeScore: 40, remarks: 'Disqualified due to performance' })
      );
      const revision3 = await contextValue.reviseVendorRating('v-001', 40, 45, 40, 'Disqualified due to performance');
      expect(revision3.newCompositeScore).toBeDefined();

      // Revise with empty remarks and unknown vendor
      mockFetch.mockResolvedValueOnce(mockRevisionResponse({ vendorId: 'unknown-vendor-id', remarks: '' }));
      await contextValue.reviseVendorRating('unknown-vendor-id', 80, 80, 80, '');
      // Revise vendor with score 0
      mockFetch.mockResolvedValueOnce(mockRevisionResponse({ vendorId: 'v-003' }));
      await contextValue.reviseVendorRating('v-003', 70, 70, 70, 'Revised score 0 vendor');
    });
    expect(contextValue.ratingRevisionEmailModalOpen).toBe(true);

    // Failure paths: the caller must learn a revision was NOT saved, whether the
    // request itself failed or the server reported success:false.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, error: 'Server error' }) });
    await act(async () => {
      const saved = await contextValue.reviseVendorRating('v-001', 50, 50, 50, 'Network failure case');
      expect(saved).toBeNull();
    });

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: false, error: 'Rejected' }) });
    await act(async () => {
      const saved = await contextValue.reviseVendorRating('v-001', 50, 50, 50, 'Rejected case');
      expect(saved).toBeNull();
    });

    // 3. Add Audit Log & Feed Item across all role contexts and feed types
    act(() => {
      contextValue.addAuditLog('Custom administrative policy update', 'RFQ-2026-001', 'Admin Vikram');
      contextValue.addAuditLog('Userless log with buyer role');
      contextValue.setCurrentRole('category_manager');
      contextValue.addAuditLog('Userless log with CM role');
      contextValue.setCurrentRole('vendor');
      contextValue.addAuditLog('Userless log with vendor role');
      contextValue.setCurrentRole('admin');
      contextValue.addAuditLog('Userless log with admin role');
      contextValue.setCurrentRole('buyer');

      // Feed items with implicit and explicit channels
      contextValue.addFeedItem('Urgent Call Notification', 'Action required', 'call');
      contextValue.addFeedItem('WhatsApp Alert', 'Dispatched WA', 'whatsapp');
      contextValue.addFeedItem('SMS Alert', 'Dispatched SMS', 'sms');
      contextValue.addFeedItem('Email Alert', 'Dispatched Email', 'email');
      contextValue.addFeedItem('System Scoring', 'Evaluation done', 'scoring', 'RFQ-2026-001', 'Apex', 'system');
      contextValue.addFeedItem('Plain Feed', 'Message only', 'system');
    });
    expect(contextValue.auditLogs.some((l: any) => l.action.includes('Custom administrative policy update'))).toBe(true);

    // 4. Toast Notifications
    act(() => {
      contextValue.showToast('Test Toast', 'Description toast', 'success');
      contextValue.showToast('Default Info Toast', 'Default info description');
    });
    expect(contextValue.toastMessage).toEqual({
      title: 'Default Info Toast',
      description: 'Default info description',
      type: 'info',
    });
    act(() => {
      contextValue.dismissToast();
    });
    expect(contextValue.toastMessage).toBeNull();

    // 5. Process Historical Purchase Data (1_year, 2_years, 3_years). This now
    // awaits the real POST /api/buyer-accounts/historical-data and returns
    // whatever importedCount the server reports (dedup happens server-side),
    // so each call needs its own mocked response.
    const mockIngestResponse = (importedCount: number) => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, importedCount, period: '1_year', totalVendors: importedCount }),
    });

    await act(async () => {
      mockFetch.mockResolvedValueOnce(mockIngestResponse(1));
      const processedCount1 = await contextValue.processHistoricalPurchaseData('1_year', [
        {
          id: 'h-0',
          companyName: 'One Year Vendor Ltd',
          contactPerson: 'Rohan Sen',
          email: 'rohan@oneyear.in',
          phone: '+91 98888 00000',
          address: 'Chennai',
          gstNumber: '33AAAAA1234A1Z1',
          hasPoHistory: true,
          categoriesMappedByBuyer: true,
          itemsSupplied: ['Pipes'],
          vendorRatingScore: 85,
          firstSetMajorCategory: 'Raw Materials',
          secondSetMinorCategories: ['Steel Pipes'],
        },
      ]);
      expect(processedCount1).toBe(1);

      mockFetch.mockResolvedValueOnce(mockIngestResponse(2));
      const processedCount2 = await contextValue.processHistoricalPurchaseData('2_years', [
        {
          id: 'h-1',
          companyName: 'Historical Steel Dynamics Ltd',
          contactPerson: 'Sanjay Gupta',
          email: 'sanjay@steel.in',
          phone: '+91 98888 11111',
          address: 'Mumbai, Maharashtra',
          gstNumber: '27AAAAA1234A1Z5',
          hasPoHistory: true,
          categoriesMappedByBuyer: true,
          itemsSupplied: ['Steel Plates'],
          vendorRatingScore: 75,
          firstSetMajorCategory: 'Raw Materials',
          secondSetMinorCategories: ['Steel Plates'],
        },
        {
          id: 'h-2',
          companyName: 'Uncategorized Vendor Ltd',
          contactPerson: 'Arun Varma',
          email: 'arun@uncat.in',
          phone: '+91 98888 22222',
          address: 'Delhi',
          gstNumber: '07AAAAA1234A1Z6',
          hasPoHistory: false,
          categoriesMappedByBuyer: false,
          itemsSupplied: [],
          firstSetMajorCategory: '',
          secondSetMinorCategories: [],
        },
      ]);
      expect(processedCount2).toBe(2);

      // Process 3_years with unmapped categories and custom tempPassword
      mockFetch.mockResolvedValueOnce(mockIngestResponse(1));
      const processedCount3 = await contextValue.processHistoricalPurchaseData('3_years', [
        {
          id: 'h-3',
          companyName: 'Three Year Vendor Ltd',
          contactPerson: '',
          email: 'three@vendor.in',
          phone: '+91 98888 33333',
          address: 'Kolkata',
          gstNumber: '19AAAAA1234A1Z7',
          hasPoHistory: true,
          categoriesMappedByBuyer: true,
          itemsSupplied: ['Valves'],
          vendorRatingScore: undefined,
          tempPassword: 'CustomPassword123#',
          firstSetMajorCategory: '',
          secondSetMinorCategories: [],
        },
      ]);
      expect(processedCount3).toBe(1);
    });

    // Failure paths: the caller must learn the import did NOT happen, whether
    // the request itself failed or the server reported success:false.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, error: 'Server error' }) });
    await act(async () => {
      const processedCount = await contextValue.processHistoricalPurchaseData('1_year', []);
      expect(processedCount).toBe(0);
    });

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: false, error: 'Rejected' }) });
    await act(async () => {
      const processedCount = await contextValue.processHistoricalPurchaseData('1_year', []);
      expect(processedCount).toBe(0);
    });

    mockFetch.mockRejectedValueOnce(new Error('Network down'));
    await act(async () => {
      const processedCount = await contextValue.processHistoricalPurchaseData('1_year', []);
      expect(processedCount).toBe(0);
    });
  });


  // A failed RFQ save used to be swallowed by an unawaited POST, leaving the RFQ on
  // screen as though it had been dispatched while the database held nothing. It now
  // rejects and adds nothing.
  it('rejects an RFQ save failure instead of showing an RFQ the database does not hold', async () => {
    mockFetch.mockRejectedValue(new Error('Background write failed'));
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div data-testid="count">{contextValue.rfqs.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );
    await waitFor(() => expect(contextValue.isLoadingDB).toBe(false));

    const before = contextValue.rfqs.length;

    await expect(
      contextValue.addNewRFQ({
        title: 'RFQ DB Fail',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 100000,
        extractedEntities: [],
      })
    ).rejects.toThrow();

    expect(contextValue.rfqs.length).toBe(before);
  });

  it('handles background DB write rejections cleanly without unhandled exceptions', async () => {
    mockFetch.mockRejectedValue(new Error('Background write failed'));
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Test</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => {
      expect(contextValue.isLoadingDB).toBe(false);
    });

    let addedAcc: BuyerAccount;
    act(() => {
      addedAcc = contextValue.addBuyerAccount({
        organizationName: 'Async Error Corp',
        industry: 'Testing',
        corporateEmail: 'err@procucev.com',
        contactPerson: 'Tester',
        phone: '+91 99999 99999',
        sourcingMode: 'mode_1',
        subscriptionPlan: 'version_1',
        remainingFreeRFQs: 5,
        accountSource: 'direct_enterprise_signup',
      });
    });

    act(() => {
      contextValue.updateBuyerAccount(addedAcc.id, {
        industry: 'Heavy Testing',
      });
      contextValue.importPublicBuyerDatabase([
        {
          organizationName: 'Async Public Corp',
          industry: 'Testing',
          corporateEmail: 'pub@procucev.com',
          contactPerson: 'Tester 2',
          phone: '+91 99999 88888',
          sourcingMode: 'mode_1',
          subscriptionPlan: 'version_1',
          remainingFreeRFQs: 5,
          accountSource: 'public_database_sync',
        },
      ]);
      contextValue.reviseVendorRating('v-1', 85, 85, 85, 'Revision DB failure');
      contextValue.addAuditLog('Action with rejected DB');
      contextValue.addFeedItem('Feed with rejected DB', 'msg', 'system');
      contextValue.addVendorEvaluation({
        id: 'eval-err',
        vendorId: 'v-err',
        vendorName: 'Error Vendor',
        contactPerson: 'Tester',
        email: 'err@vendor.com',
        phone: '+91 99999 99999',
        category: 'Test',
        submissionDate: '2026-08-29',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        overallScore: 80,
        systemAction: 'None',
        moduleScores: {
          commercial: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          technical: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          quality: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          delivery: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          financial: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          governance: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
        },
        documents: [],
      });
    });
  });

  it('resolves activeBuyerAccount from the real identity-schema endpoint on session change, with no fallback on failure', async () => {
    // The signed-in buyer's account is resolved via GET /api/buyer-accounts/active
    // (buyerAccountResolver on the backend) rather than matching session email
    // against the bootstrap-hydrated buyerAccounts array — that match was never
    // reliable since the shared identity schema has no unique index on email.
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/buyer-accounts/active')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { id: 'buyer-acc-99', organizationName: 'Session Matched Org', corporateEmail: 'pub@procucev.com' },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });

    authClient.setSession(
      { id: 'u-1', email: 'pub@procucev.com', name: 'Test User', role: 'buyer', orgId: 'org-1', orgName: 'Test Org' },
      'test-token'
    );

    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Test</div>;
    };
    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.activeBuyerAccount?.id).toBe('buyer-acc-99'));

    // A failed lookup clears it rather than falling back to any previous or
    // fabricated value — showing another organisation's account is the bug
    // this design replaced.
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/buyer-accounts/active')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: false, error: 'not linked' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });
    authClient.setSession(
      { id: 'u-2', email: 'other@procucev.com', name: 'Other User', role: 'buyer', orgId: 'org-2', orgName: 'Other Org' },
      'other-token'
    );
    await act(async () => {
      await contextValue.setCurrentUserSession({ id: 'u-2', email: 'other@procucev.com', name: 'Other User', role: 'buyer', orgId: 'org-2', orgName: 'Other Org' });
    });

    await waitFor(() => expect(contextValue.activeBuyerAccount).toBeNull());
    authClient.setSession(null);
  });

  it('handles error gracefully when refreshFromDB fetch fails or returns false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false }),
    });
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>DB: {contextValue.dbConnected ? 'ok' : 'failed'}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => {
      expect(contextValue.isLoadingDB).toBe(false);
    });
    expect(contextValue.dbConnected).toBe(false);
  });
});

// ==============================================================================
// EDITING, ADOPTING AND DELETING AN RFQ
// ==============================================================================
// All three only touch local state once the API has confirmed. The alternative —
// patching state from the request and hoping the two agree — is the failure the
// RFQ create path already had: the browser and the database ended up holding
// different records for the same RFQ.
// ==============================================================================

describe('lib/store.tsx - RFQ edit and delete', () => {
  // Given an explicit rfqNumber. The shared fixture above has none, and every
  // assertion here turns on matching that number — without one the store would be
  // comparing undefined to undefined and the tests would pass regardless.
  const STORED = {
    ...(STORE_RFQ_FIXTURES[0] as unknown as RFQItem),
    id: 'rfq-1',
    rfqNumber: 'RFQ260409000512',
  } as RFQItem;

  /**
   * Serve the RFQ list, then answer PUT and DELETE however the test asks.
   * The list is served first so the store has a row to act on.
   */
  function serveRFQs(
    handlers: {
      put?: (body: unknown) => { status: number; body: unknown };
      del?: () => { status: number; body: unknown };
    } = {}
  ) {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const isRfqEndpoint = typeof url === 'string' && /\/api\/rfqs/.test(url);

      if (isRfqEndpoint && init?.method === 'PUT') {
        const answer = handlers.put
          ? handlers.put(JSON.parse(init.body || '{}'))
          : { status: 200, body: { success: true, data: { ...STORED, title: 'Revised title' } } };
        return Promise.resolve({
          ok: answer.status >= 200 && answer.status < 300,
          status: answer.status,
          json: async () => answer.body,
        });
      }

      if (isRfqEndpoint && init?.method === 'DELETE') {
        const answer = handlers.del
          ? handlers.del()
          : { status: 200, body: { success: true, data: { rfqNumber: STORED.rfqNumber } } };
        return Promise.resolve({
          ok: answer.status >= 200 && answer.status < 300,
          status: answer.status,
          json: async () => answer.body,
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          /\/api\/rfqs(\?|$)/.test(String(url))
            ? { success: true, data: [STORED] }
            : { success: true, data: {} },
      });
    });
  }

  /** Mount the provider and wait for the RFQ list to arrive. */
  async function mountStore() {
    // refreshRFQs clears the list (and never calls fetchRFQList) when there is
    // no token, so a session must exist before mounting.
    authClient.setSession(
      { id: 'usr-buyer-001', email: 'buyer@procucev.com', name: 'Test Buyer', role: 'buyer', orgId: 'org-buyer-01', orgName: 'Test Buyer Org' },
      'test-session-token'
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ctx: any;
    const Consumer = () => {
      ctx = useApp();
      return <div data-testid="rfq-count">{ctx.rfqs.length}</div>;
    };
    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );
    await waitFor(() => expect(screen.getByTestId('rfq-count')).toHaveTextContent('1'));
    return () => ctx;
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updateRFQ', () => {
    it('adopts the record the API stored, not the change that was sent', async () => {
      serveRFQs({
        put: () => ({
          status: 200,
          // Deliberately different from what the caller sent: the response wins.
          body: { success: true, data: { ...STORED, title: 'What the database holds' } },
        }),
      });
      const ctx = await mountStore();

      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'What the caller sent' });
      });

      expect(ctx().rfqs[0].title).toBe('What the database holds');
    });

    it('sends only the fields it was given', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { status: 'In Evaluation' });
      });

      const put = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
      expect(JSON.parse(put?.[1].body)).toEqual({ status: 'In Evaluation' });
    });

    it('reports the edit on screen and in the audit log', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'Revised title' });
      });

      expect(ctx().toastMessage?.title).toBe(UI_STRINGS.rfqEdit.savedTitle);
      expect(ctx().auditLogs[0].action).toContain('Edited');
    });

    it('keeps the vendor opportunity for that RFQ in step', async () => {
      serveRFQs({
        put: () => ({
          status: 200,
          body: { success: true, data: { ...STORED, title: 'Renamed for vendors' } },
        }),
      });
      const ctx = await mountStore();

      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'Renamed for vendors' });
      });

      const opp = ctx().vendorOpportunities.find(
        (o: { rfqNumber: string }) => o.rfqNumber === STORED.rfqNumber
      );
      expect(opp.title).toBe('Renamed for vendors');
    });

    // A screen already holding this RFQ would otherwise show the pre-edit terms.
    it('refreshes a selection pointing at the edited RFQ', async () => {
      serveRFQs({
        put: () => ({
          status: 200,
          body: { success: true, data: { ...STORED, title: 'Refreshed selection' } },
        }),
      });
      const ctx = await mountStore();

      await act(async () => {
        ctx().setSelectedRFQForMatrix(STORED);
        ctx().openRFQDeepDive(STORED);
      });
      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'Refreshed selection' });
      });

      expect(ctx().selectedRFQForMatrix.title).toBe('Refreshed selection');
      expect(ctx().selectedRFQForDeepDive.title).toBe('Refreshed selection');
    });

    it('leaves an unrelated selection alone', async () => {
      serveRFQs();
      const other = { ...STORED, id: 'other', rfqNumber: 'RFQ-OTHER' } as RFQItem;
      const ctx = await mountStore();

      await act(async () => {
        ctx().setSelectedRFQForMatrix(other);
      });
      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'Revised title' });
      });

      expect(ctx().selectedRFQForMatrix.rfqNumber).toBe('RFQ-OTHER');
    });

    // A rejected edit must not leave the dashboard showing a change the database
    // does not hold.
    it('throws and changes nothing when the API rejects the edit', async () => {
      serveRFQs({ put: () => ({ status: 500, body: { error: 'Database unavailable.' } }) });
      const ctx = await mountStore();

      await act(async () => {
        await expect(ctx().updateRFQ(STORED.rfqNumber, { title: 'Revised title' })).rejects.toThrow(
          'Database unavailable.'
        );
      });

      expect(ctx().rfqs[0].title).toBe(STORED.title);
      expect(ctx().toastMessage?.title).toBe(UI_STRINGS.rfqEdit.saveFailedTitle);
    });

    it('throws when the RFQ belongs to another organisation', async () => {
      serveRFQs({ put: () => ({ status: 404, body: { error: 'Not found under your organisation.' } }) });
      const ctx = await mountStore();

      await act(async () => {
        await expect(ctx().updateRFQ('RFQ-SOMEONE-ELSE', { title: 'Rewritten' })).rejects.toThrow(
          'Not found under your organisation.'
        );
      });

      expect(ctx().rfqs).toHaveLength(1);
    });
  });

  describe('deleteRFQ', () => {
    it('drops the RFQ from every list once the API confirms', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        await ctx().deleteRFQ(STORED.rfqNumber);
      });

      expect(ctx().rfqs).toHaveLength(0);
      expect(
        ctx().vendorOpportunities.some((o: { rfqNumber: string }) => o.rfqNumber === STORED.rfqNumber)
      ).toBe(false);
    });

    it('reports the deletion on screen and in the audit log', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        await ctx().deleteRFQ(STORED.rfqNumber);
      });

      expect(ctx().toastMessage?.title).toBe(UI_STRINGS.rfqEdit.deletedTitle);
      expect(ctx().auditLogs[0].action).toContain('Deleted');
    });

    // A selection pointing at a deleted record would render a stale RFQ.
    it('clears a selection pointing at the deleted RFQ', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        ctx().setSelectedRFQForMatrix(STORED);
        ctx().openRFQDeepDive(STORED);
      });
      await act(async () => {
        await ctx().deleteRFQ(STORED.rfqNumber);
      });

      expect(ctx().selectedRFQForMatrix).toBeNull();
      expect(ctx().selectedRFQForDeepDive).toBeNull();
    });

    it('leaves an unrelated selection alone', async () => {
      serveRFQs();
      const other = { ...STORED, id: 'other', rfqNumber: 'RFQ-OTHER' } as RFQItem;
      const ctx = await mountStore();

      await act(async () => {
        ctx().setSelectedRFQForMatrix(other);
      });
      await act(async () => {
        await ctx().deleteRFQ(STORED.rfqNumber);
      });

      expect(ctx().selectedRFQForMatrix.rfqNumber).toBe('RFQ-OTHER');
    });

    // Removing the row anyway would hide a record the database still holds.
    it('throws and keeps the row when the API refuses', async () => {
      serveRFQs({ del: () => ({ status: 500, body: { error: 'Delete failed.' } }) });
      const ctx = await mountStore();

      await act(async () => {
        await expect(ctx().deleteRFQ(STORED.rfqNumber)).rejects.toThrow('Delete failed.');
      });

      expect(ctx().rfqs).toHaveLength(1);
      expect(ctx().toastMessage?.title).toBe(UI_STRINGS.rfqEdit.deleteFailedTitle);
    });

    // The API echoes the number it removed, which is what the store drops.
    it('drops the row the API named rather than the identifier it was given', async () => {
      serveRFQs({
        del: () => ({ status: 200, body: { success: true, data: { rfqNumber: STORED.rfqNumber } } }),
      });
      const ctx = await mountStore();

      // Addressed by row id; the response names the RFQ number.
      await act(async () => {
        await ctx().deleteRFQ('rfq-1');
      });

      expect(ctx().rfqs).toHaveLength(0);
    });
  });

  describe('adoptCreatedRFQ', () => {
    it('takes a server-created RFQ into state and logs it', async () => {
      serveRFQs();
      const ctx = await mountStore();
      const created = { ...STORED, id: '99', rfqNumber: 'RFQ260409000099' } as RFQItem;

      await act(async () => {
        ctx().adoptCreatedRFQ(created);
      });

      expect(ctx().rfqs[0].rfqNumber).toBe('RFQ260409000099');
      expect(ctx().auditLogs[0].action).toContain('Created');
    });

    // A concurrent refresh must not leave two copies of one RFQ.
    it('replaces an existing entry with the same number', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        ctx().adoptCreatedRFQ({ ...STORED, title: 'Adopted again' } as RFQItem);
      });

      expect(ctx().rfqs).toHaveLength(1);
      expect(ctx().rfqs[0].title).toBe('Adopted again');
    });
  });
});

// ==============================================================================
// MULTI-CHANNEL CHASER TELEMETRY
// ==============================================================================
// These branches only run for an RFQ that carries followUpData. The persisted
// mapper does not return that field, so they are unreachable through the API path
// today — but the chaser screens still read them, and an RFQ that does carry the
// block has to be updated correctly rather than silently ignored.
// ==============================================================================

describe('lib/store.tsx - channel chasers and bids', () => {
  const VENDOR = 'Apex Supplies Ltd.';
  const OTHER_VENDOR = 'Global Valve Systems Ltd';

  /** An RFQ with outreach telemetry, which is what these paths act on. */
  const withTelemetry = () =>
    ({
      ...(STORE_RFQ_FIXTURES[0] as unknown as RFQItem),
      id: 'rfq-chase',
      rfqNumber: 'RFQ260409000900',
    }) as RFQItem;

  function serve(rfq: RFQItem) {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          /\/api\/rfqs(\?|$)/.test(String(url))
            ? { success: true, data: [rfq] }
            : { success: true, data: {} },
      })
    );
  }

  async function mountStore(rfq: RFQItem = withTelemetry()) {
    // refreshRFQs clears the list (and never calls fetchRFQList) when there is
    // no token, so a session must exist before mounting for the fixture below
    // to actually be fetched and hydrated.
    authClient.setSession(
      { id: 'usr-buyer-001', email: 'buyer@procucev.com', name: 'Test Buyer', role: 'buyer', orgId: 'org-buyer-01', orgName: 'Test Buyer Org' },
      'test-session-token'
    );
    serve(rfq);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ctx: any;
    const Consumer = () => {
      ctx = useApp();
      return <div data-testid="rfq-count">{ctx.rfqs.length}</div>;
    };
    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );
    await waitFor(() => expect(screen.getByTestId('rfq-count')).toHaveTextContent('1'));
    return () => ctx;
  }

  /** The telemetry record for one vendor on the first RFQ. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vendorRecord = (ctx: () => any, name = VENDOR) =>
    ctx().rfqs[0].followUpData.vendors.find(
      (v: { vendorName: string }) => v.vendorName === name
    );

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('triggerChannelChaser', () => {
    it.each([
      ['call', 'call', 'completed'],
      ['whatsapp', 'whatsapp', 'read'],
      ['sms', 'sms', 'delivered'],
    ])('records a %s attempt against the vendor', async (channel, field, status) => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', channel, VENDOR);
      });

      const record = vendorRecord(ctx);
      expect(record[field].status).toBe(status);
      expect(record.overallStatus).toBe('Follow-up Active');
      expect(record.attemptsCount).toBeGreaterThan(0);
    });

    it('records an email attempt', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'email', VENDOR);
      });

      expect(vendorRecord(ctx).email24h.is24hReminderSent).toBe(true);
    });

    // Only the vendor being chased is touched; the rest of the roster is left as it was.
    it('leaves the other vendors untouched', async () => {
      const ctx = await mountStore();
      const before = vendorRecord(ctx, OTHER_VENDOR).attemptsCount;

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR);
      });

      expect(vendorRecord(ctx, OTHER_VENDOR).attemptsCount).toBe(before);
    });

    // Matched loosely in both directions, so 'Apex' finds 'Apex Supplies Ltd.'
    it('matches a vendor named only in part', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'sms', 'Apex');
      });

      expect(vendorRecord(ctx).sms.status).toBe('delivered');
    });

    it('counts the attempt on the channel totals', async () => {
      const ctx = await mountStore();
      const before = ctx().rfqs[0].followUpData.callStats.total;

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR);
      });

      expect(ctx().rfqs[0].followUpData.callStats.total).toBe(before + 1);
    });

    it('records the chase in the audit log and on screen', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'whatsapp', VENDOR);
      });

      expect(ctx().auditLogs[0].action).toContain('WHATSAPP');
      expect(ctx().toastMessage).not.toBeNull();
    });

    it('accepts a custom note on the attempt', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR, 'Chasing the revised price');
      });

      expect(vendorRecord(ctx).attemptsCount).toBeGreaterThan(0);
    });

    // An RFQ without telemetry has nothing to update, and must not throw.
    it('does nothing for an RFQ that carries no telemetry', async () => {
      const bare = { ...withTelemetry(), followUpData: undefined } as unknown as RFQItem;
      const ctx = await mountStore(bare);

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR);
      });

      expect(ctx().rfqs[0].followUpData).toBeUndefined();
    });

    it('does nothing for an RFQ number it does not hold', async () => {
      const ctx = await mountStore();
      const before = vendorRecord(ctx).attemptsCount;

      await act(async () => {
        ctx().triggerChannelChaser('RFQ-NOT-HERE', 'call', VENDOR);
      });

      expect(vendorRecord(ctx).attemptsCount).toBe(before);
    });

    it('refreshes a deep-dive selection pointing at the chased RFQ', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().openRFQDeepDive(ctx().rfqs[0]);
      });
      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR);
      });

      const selected = ctx().selectedRFQForDeepDive.followUpData.vendors.find(
        (v: { vendorName: string }) => v.vendorName === VENDOR
      );
      expect(selected.call.status).toBe('completed');
    });
  });

  describe('triggerWhatsAppChaser', () => {
    it('chases over WhatsApp', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().triggerWhatsAppChaser('RFQ260409000900', VENDOR);
      });

      expect(vendorRecord(ctx).whatsapp.status).toBe('read');
    });
  });

  describe('submitVendorBid', () => {
    it('adds the quote and marks it the one to beat', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().submitVendorBid('RFQ260409000900', 1000, 10, 'Best and final');
      });

      const rfq = ctx().rfqs[0];
      expect(rfq.quotesCount).toBeGreaterThan(0);
      expect(rfq.quotes[rfq.quotes.length - 1].isBestPrice).toBe(true);
      expect(rfq.quotes[rfq.quotes.length - 1].remarks).toBe('Best and final');
    });

    it('does nothing for an RFQ number it does not hold', async () => {
      const ctx = await mountStore();
      const before = ctx().rfqs[0].quotes.length;

      await act(async () => {
        ctx().submitVendorBid('RFQ-NOT-HERE', 1000, 10, 'Ignored');
      });

      expect(ctx().rfqs[0].quotes).toHaveLength(before);
    });
  });

  describe('approvePO', () => {
    it('records the approval against the RFQ', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().approvePO('RFQ260409000900', VENDOR, 250000);
      });

      expect(ctx().rfqs[0].status).toBe('PO Generated');
      expect(ctx().auditLogs[0].action).toContain('PO');
    });
  });

  describe('updateBuyerVendor & deleteBuyerVendor', () => {
    it('updates a buyer vendor and syncs to backend', async () => {
      const ctx = await mountStore();
      let createdVendor: any = null;
      await act(async () => {
        createdVendor = ctx().addBuyerVendor({
          name: 'Store Test Vendor',
          email: 'storetest@vendor.com',
          phone: '+91 9876543210',
          categories: ['Industrial Valves'],
          rating: 4.5,
          location: 'Mumbai',
        });
      });
      expect(createdVendor).toBeTruthy();

      await act(async () => {
        ctx().updateBuyerVendor(createdVendor.id, { name: 'Updated Store Vendor' });
        // Also call with non-matching ID to cover the ternary false branch
        ctx().updateBuyerVendor('non-existent-vendor-id-999', { name: 'Ignored' });
      });
      expect(ctx().buyerVendors.find((v: { id: string }) => v.id === createdVendor.id)?.name).toBe('Updated Store Vendor');

      await act(async () => {
        ctx().deleteBuyerVendor(createdVendor.id);
      });
      expect(ctx().buyerVendors.find((v: { id: string }) => v.id === createdVendor.id)).toBeUndefined();
    });

    it('handles addBuyerVendor API error and network failure in update/delete', async () => {
      const ctx = await mountStore();

      mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/vendors')) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({ success: false, error: 'Validation failed' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        });
      });

      let failedVendorResult: any = 'not-null';
      await act(async () => {
        failedVendorResult = await ctx().addBuyerVendor({
          name: 'Fail Vendor',
          email: 'fail@vendor.com',
          phone: '1234567890',
          categories: ['Valves'],
          rating: 4.0,
          location: 'Delhi',
        });
      });
      expect(failedVendorResult).toBeNull();

      // Network throw on addBuyerVendor
      mockFetch.mockRejectedValue(new Error('Network error on add'));
      let netErrResult: any = 'not-null';
      await act(async () => {
        netErrResult = await ctx().addBuyerVendor({
          name: 'Net Err Vendor',
          email: 'neterr@vendor.com',
          phone: '1234567890',
          categories: ['Valves'],
          rating: 4.0,
          location: 'Delhi',
        });
      });
      expect(netErrResult).toBeNull();

      // res.json() parse failure on addBuyerVendor
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('JSON parse error')),
        })
      );
      let jsonErrResult: any = 'not-null';
      await act(async () => {
        jsonErrResult = await ctx().addBuyerVendor({
          name: 'Json Err Vendor',
          email: 'jsonerr@vendor.com',
          phone: '1234567890',
          categories: ['Valves'],
          rating: 4.0,
          location: 'Delhi',
        });
      });
      expect(jsonErrResult).toBeNull();

      // Network rejection on update & delete
      mockFetch.mockRejectedValue(new Error('Network error'));
      await act(async () => {
        ctx().updateBuyerVendor('v-net-err', { name: 'Net Err' });
        ctx().deleteBuyerVendor('v-net-err');
      });
    });

    it('exercises payment link methods for buyer and vendor', async () => {
      const ctx = await mountStore();

      // checkBuyerPaymentLinkStatus when activeBuyerAccount is null / present
      const nullBuyerLinkStatus = await ctx().checkBuyerPaymentLinkStatus('link-1');
      expect(nullBuyerLinkStatus).toBeNull();

      // checkVendorPaymentLinkStatus when myVendor is null
      const nullVendorLinkStatus = await ctx().checkVendorPaymentLinkStatus('link-1');
      expect(nullVendorLinkStatus).toBeNull();

      // createBuyerPaymentLink when activeBuyerAccount is missing
      const noBuyerPayResult = await ctx().createBuyerPaymentLink('annual_pro');
      expect(noBuyerPayResult).toBeNull();
    });
  });
});
