import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
import { setCategoryTaxonomy } from '@/lib/categoryTaxonomy';
import { CATEGORY_TAXONOMY_FIXTURE } from './test-fixtures/categoryTaxonomy';

// Polyfill TextEncoder and TextDecoder
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder as any;
}

// Ensure Fetch Web APIs are globally available
if (typeof global.Request === 'undefined') {
  global.Request = globalThis.Request;
}
if (typeof global.Response === 'undefined') {
  global.Response = globalThis.Response;
}
if (typeof global.Headers === 'undefined') {
  global.Headers = globalThis.Headers;
}

// A signed-in buyer session.
//
// RFQ reads are authenticated and organisation-scoped now, and the store clears
// the list when there is no token rather than leaving a previous session's RFQs on
// screen. Screen tests therefore need a session to have anything to render, which
// also matches the only state these screens are reachable in.
const TEST_SESSION_USER = {
  id: 'usr-buyer-001',
  email: 'buyer@procucev.com',
  name: 'Test Buyer',
  role: 'buyer',
  orgId: 'org-buyer-01',
  orgName: 'Test Buyer Org',
};

// Written at module scope, not in beforeEach: authClient is a singleton that reads
// localStorage in its constructor when the module is first imported, which happens
// before any beforeEach runs. Setting it later would leave that singleton holding a
// null token.
localStorage.setItem('procucev_auth_token', 'test-session-token');
localStorage.setItem('procucev_user_session', JSON.stringify(TEST_SESSION_USER));

// The procurement category master.
//
// Screens read it from the module registry the store fills after fetching
// `/api/buyer-profile/categories`, and the non-React validation helpers in
// manualRfqModel read the same registry. Priming it here rather than per suite
// mirrors how the app behaves once signed in, and is required because there is no
// bundled categories.json to fall back on any more — an unprimed registry renders
// every category dropdown empty.
//
// Written at module scope as well as in beforeEach so a module evaluated during
// import (rather than during a test) still sees a populated taxonomy.
setCategoryTaxonomy(CATEGORY_TAXONOMY_FIXTURE);

beforeEach(() => {
  localStorage.setItem('procucev_auth_token', 'test-session-token');
  localStorage.setItem('procucev_user_session', JSON.stringify(TEST_SESSION_USER));
  setCategoryTaxonomy(CATEGORY_TAXONOMY_FIXTURE);
});

afterEach(() => {
  jest.clearAllTimers();
});

// Global fetch mock
// RFQs are no longer in the bootstrap payload: that endpoint is anonymous, and
// serving the global RFQ array from it is what leaked RFQs between buyers. They
// are fetched from the authenticated, org-scoped GET /api/rfqs instead, so the
// fixture is shared by both branches of the mock below.
const RFQ_FIXTURES = [
  {
    id: 'rfq-00421',
    rfqNumber: 'RFQ-2026-00421',
    title: 'Centrifugal Water Pumps & Spares',
    category: 'Heavy Industrial Fluid Dynamics & Valves',
    sourcingMode: 'mode_3',
    status: 'AI Recommended',
    createdAt: '2026-08-20',
    targetDeliveryDate: '2026-09-15',
    quotesCount: 3,
    budget: 150000,
    aiScore: 94,
    extractedEntities: [
      {
        id: 'item-1',
        itemName: 'Centrifugal Pump 50HP',
        quantity: 4,
        unit: 'Units',
        targetDate: '2026-09-15',
        technicalSpecs: '50HP 3-Phase 415V Cast Iron',
        confidence: 96,
        category: 'Heavy Industrial Fluid Dynamics & Valves',
      },
    ],
    quotes: [
      {
        vendorId: 'vendor-1',
        vendorName: 'Apex Supplies Ltd.',
        vendorCategory: 'Procucev - AI Rec',
        unitPrice: 24500,
        totalPrice: 98000,
        leadTimeDays: 14,
        aiMatchScore: 95,
        isBestPrice: true,
        isPreferred: true,
        warrantyYears: 2,
        complianceStatus: 'Fully Compliant',
        paymentTerms: '30 Days Net',
        remarks: 'Top rated supplier',
      },
    ],
  },
];

// Allocated by the mock so a created RFQ carries a number the caller did not
// supply, exactly as the server does.
let allocatedRfqCount = 0;

global.fetch = jest.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
  // POST /api/rfqs creates one record; GET /api/rfqs lists them. Returning the
  // list for both made the store adopt an array as though it were one RFQ.
  if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url) && init?.method === 'POST') {
    allocatedRfqCount += 1;
    const sent = JSON.parse(init.body || '{}');
    const allocatedNumber = `RFQ2604090000${String(allocatedRfqCount).padStart(2, '0')}`;
    return Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        data: {
          ...sent,
          id: `rfq-created-${allocatedRfqCount}`,
          rfqId: allocatedNumber,
          rfqNumber: allocatedNumber,
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
    json: async () => {
      if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url)) {
        return { success: true, data: RFQ_FIXTURES };
      }
      // Served in the grouped shape findCategoryTaxonomy returns, so the store's
      // own load path is exercised rather than bypassed.
      if (typeof url === 'string' && url.includes('/api/buyer-profile/categories')) {
        return { success: true, count: CATEGORY_TAXONOMY_FIXTURE.length, data: CATEGORY_TAXONOMY_FIXTURE };
      }
      if (typeof url === 'string' && url.includes('/api/bootstrap')) {
        return {
          success: true,
          data: {
            buyerAccounts: [
              {
                id: 'buyer-acc-001',
                organizationName: 'Larsen & Toubro Heavy Engineering',
                brandName: 'L&T',
                corporateEmail: 'procurement@lt.com',
                contactPerson: 'S. N. Subrahmanyan',
                contactDesignation: 'VP Procurement & Supply Chain',
                mobileNumber: '+91 98201 44820',
                gstin: '27AAACP1234A1Z5',
                industrySector: 'Heavy Infrastructure & Industrial Equipment',
                sourcingMode: 'mode_2',
                subscriptionPlan: 'version_3',
                remainingFreeRFQs: 999,
                accountSource: 'database_seed',
                status: 'ACTIVE_VERIFIED',
                primaryPlantLocation: 'Hazira Works, Surat, GJ',
                supportedMajorCategories: ['Engineering Spares - Mechanical', 'Civil Works'],
                supportedMinorCategories: ['Pumps & Accessories', 'Hoses, Valves & Fittings'],
                totalRFQsCreated: 14,
                totalSpend: '₹12,40,000',
              },
              {
                id: 'buyer-acc-002',
                organizationName: 'Reliance Industries Ltd. (RIL)',
                brandName: 'RIL',
                corporateEmail: 'sourcing@ril.com',
                contactPerson: 'Anjali Deshmukh',
                contactDesignation: 'Category Lead',
                mobileNumber: '+91 98210 55443',
                gstin: '27AAACR5544E1Z2',
                industrySector: 'Petrochemicals & Refining',
                sourcingMode: 'mode_1',
                subscriptionPlan: 'version_1',
                remainingFreeRFQs: 5,
                accountSource: 'database_seed',
                status: 'ACTIVE_VERIFIED',
                primaryPlantLocation: 'Jamnagar, GJ',
                supportedMajorCategories: ['Petrochemicals'],
                totalRFQsCreated: 0,
                totalSpend: '₹0',
              },
            ],
            vendors: [
              {
                id: 'vendor-1',
                name: 'Apex Supplies Ltd.',
                email: 'sales@apexsupplies.com',
                phone: '+91 98201 11223',
                tempPassword: 'Apex@Temp1234#',
                status: 'PREFERRED ENTERPRISE SUPPLIER',
                majorCategory: 'Heavy Industrial Fluid Dynamics & Valves',
                minorCategories: ['Control Valves', 'Industrial Flanges'],
                evaluated: true,
                rating: 4.8,
              },
              {
                id: 'vendor-2',
                name: 'Kiran Valves & Actuators',
                email: 'amit@kiranvalves.com',
                phone: '+91 98202 22334',
                tempPassword: 'Kiran@Temp8821#',
                status: 'VERIFIED SUPPLIER',
                majorCategory: 'Heavy Industrial Fluid Dynamics & Valves',
                minorCategories: ['Ball Valves', 'Butterfly Valves'],
                evaluated: false,
                rating: 4.5,
              },
            ],
            evaluations: [
              {
                id: 'eval-1',
                vendorId: 'vendor-1',
                vendorName: 'Apex Supplies Ltd.',
                category: 'Heavy Industrial Fluid Dynamics & Valves',
                totalScore: 94,
                status: 'PREFERRED ENTERPRISE SUPPLIER',
                submissionDate: '2026-08-20',
                contactPerson: 'Rajesh Nair',
                email: 'sales@apexsupplies.com',
                phone: '+91 98201 11223',
                moduleScores: {
                  commercial: { score: 4.8, maxScore: 5, weight: 25, weightedScore: 24, remarks: 'Optimal pricing' },
                  technical: { score: 4.7, maxScore: 5, weight: 15, weightedScore: 14.1, remarks: 'High precision' },
                  quality: { score: 4.9, maxScore: 5, weight: 20, weightedScore: 19.6, remarks: 'ISO certified' },
                  delivery: { score: 4.6, maxScore: 5, weight: 20, weightedScore: 18.4, remarks: 'Reliable lead time' },
                  financial: { score: 4.5, maxScore: 5, weight: 10, weightedScore: 9, remarks: 'Strong solvency' },
                  governance: { score: 4.8, maxScore: 5, weight: 10, weightedScore: 9.6, remarks: 'Full ESG audit' },
                },
                documents: [],
                questionBreakdown: [],
              },
            ],
            auditLogs: [],
            aiFeed: [],
            systemConfig: {},
          },
        };
      }
      if (typeof url === 'string' && url.includes('/api/ai-feed')) {
        return { success: true, data: [] };
      }
      // GET /api/vendors?buyerId=all&page=...&pageSize=... — the real
      // paginated vendor directory fetch used by VendorConsole and the
      // Invite Vendors modal. Served from the same 2-vendor fixture set as
      // bootstrap so tests exercising the fetched-vendor UI have real data.
      if (typeof url === 'string' && /\/api\/vendors(\?|$)/.test(url) && (!init || init.method === undefined)) {
        const vendorFixtures = [
          {
            id: 'vendor-1',
            name: 'Apex Supplies Ltd.',
            email: 'sales@apexsupplies.com',
            phone: '+91 98201 11223',
            status: 'PREFERRED ENTERPRISE SUPPLIER',
            majorCategory: 'Heavy Industrial Fluid Dynamics & Valves',
            minorCategories: ['Control Valves', 'Industrial Flanges'],
            evaluated: true,
            rating: 4.8,
          },
          {
            id: 'vendor-2',
            name: 'Kiran Valves & Actuators',
            email: 'amit@kiranvalves.com',
            phone: '+91 98202 22334',
            status: 'VERIFIED SUPPLIER',
            majorCategory: 'Heavy Industrial Fluid Dynamics & Valves',
            minorCategories: ['Ball Valves', 'Butterfly Valves'],
            evaluated: false,
            rating: 4.5,
          },
        ];
        const parsedUrl = new URL(url, 'http://localhost');
        const search = (parsedUrl.searchParams.get('search') || '').toLowerCase();
        const filtered = search
          ? vendorFixtures.filter(
              (v) =>
                v.name.toLowerCase().includes(search) ||
                v.email.toLowerCase().includes(search) ||
                v.majorCategory.toLowerCase().includes(search) ||
                v.minorCategories.some((c) => c.toLowerCase().includes(search))
            )
          : vendorFixtures;
        return {
          success: true,
          data: filtered,
          pagination: { page: 1, pageSize: 20, total: filtered.length, totalPages: 1 },
        };
      }
      return { success: true, data: {} };
    },
    text: async () => '',
    blob: async () => new Blob([]),
  });
}) as any;

if (typeof window !== 'undefined') {
  if (typeof (window as any).Request === 'undefined') {
    (window as any).Request = globalThis.Request;
  }
  if (typeof (window as any).Response === 'undefined') {
    (window as any).Response = globalThis.Response;
  }
  if (typeof (window as any).Headers === 'undefined') {
    (window as any).Headers = globalThis.Headers;
  }
  (window as any).fetch = global.fetch;

  // Polyfill scrollIntoView
  if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = jest.fn();
  }

  // Mock window print
  window.print = jest.fn();

  // Mock iframe print and contentWindow
  if (typeof HTMLIFrameElement !== 'undefined') {
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get: () => ({
        document: {
          open: jest.fn(),
          write: jest.fn(),
          close: jest.fn(),
        },
        focus: jest.fn(),
        print: jest.fn(),
      }),
    });
  }

  // Mock window matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  // Mock ResizeObserver
  global.ResizeObserver = class ResizeObserver {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };

  // Mock IntersectionObserver
  global.IntersectionObserver = class IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
    takeRecords = jest.fn().mockReturnValue([]);
    constructor() {}
  } as any;

  // Mock window.scrollTo
  window.scrollTo = jest.fn();

  // Mock window alert, confirm, prompt
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  window.prompt = jest.fn(() => '');

  // Mock clipboard
  Object.assign(navigator, {
    clipboard: {
      writeText: jest.fn().mockResolvedValue(undefined),
      readText: jest.fn().mockResolvedValue(''),
    },
  });

  // Mock URL.createObjectURL and revokeObjectURL
  if (typeof URL.createObjectURL === 'undefined') {
    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  }
  if (typeof URL.revokeObjectURL === 'undefined') {
    URL.revokeObjectURL = jest.fn();
  }
}

// Global test timeout (20s)
jest.setTimeout(20000);
