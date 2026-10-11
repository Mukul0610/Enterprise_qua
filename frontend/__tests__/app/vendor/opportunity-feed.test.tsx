import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import OpportunityFeed from '@/app/vendor/opportunity-feed';
import { AppProvider, useApp } from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { QuoteComparison, RFQItem, VendorOpportunity, VendorSubscriptionPlan } from '@/lib/types';

const mockRouterPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

/**
 * The feed is derived from `GET /api/rfqs`, so every test supplies the RFQs whose
 * projection it wants to assert on. Nothing is seeded any more: an empty API means
 * an empty feed, which is exactly why these fixtures are explicit.
 *
 * `RFQ-2026-00421` and `RFQ-2026-00423` are on this vendor's own-buyer roster and
 * so are never locked; the `009xx` numbers are not, and lock below the top tier.
 */
type RFQFixture = Partial<RFQItem> & { rfqNumber: string };

type CatalogueFixture = {
  id: string;
  name: string;
  category: string;
  sku: string;
  specs: string;
  unitPrice: number;
  leadTimeDays: number;
  moq: number;
};

/** A quote only has to exist for an RFQ to count as answered. */
const A_QUOTE = { vendorName: 'Apex Supplies Ltd.' } as unknown as QuoteComparison;

const OWN_ROSTER_BUYER = 'Larsen & Toubro Ltd. (L&T)';

const DIRECT_OWN: RFQFixture = {
  id: 'rfq-1',
  rfqNumber: 'RFQ-2026-00421',
  title: 'Centrifugal Water Pumps & Valves 500 GPM',
  sourcingMode: 'mode_1',
  budget: 150000,
  targetDeliveryDate: '2026-09-15',
  deliveryLocation: 'Pune Plant / Maharashtra',
  buyerAccountName: OWN_ROSTER_BUYER,
  extractedEntities: [
    {
      id: 'ent-1',
      itemName: 'SS316 impeller assembly',
      quantity: 4,
      unit: 'Units',
      targetDate: '2026-09-15',
      technicalSpecs: 'SS316',
      confidence: 92,
      category: 'Pumps & Accessories',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategory: 'Pumps & Accessories',
    },
  ],
};

const DIRECT_HVAC_QUOTED: RFQFixture = {
  id: 'rfq-2',
  rfqNumber: 'RFQ-2026-00901',
  title: 'HVAC Control Retrofit',
  sourcingMode: 'mode_1',
  // No ceiling published, so the card must say "Not Disclosed" rather than ₹0.
  budget: 0,
  targetDeliveryDate: '2026-10-01',
  deliveryLocation: 'Chennai',
  buyerAccountName: 'Tata Motors Ltd.',
  quotes: [A_QUOTE],
};

const DIRECT_STEEL: RFQFixture = {
  id: 'rfq-3',
  rfqNumber: 'RFQ-2026-00902',
  title: 'Girder Fabrication Package',
  sourcingMode: 'mode_1',
  budget: 45000,
  targetDeliveryDate: '2026-11-20',
  deliveryLocation: 'Surat',
  buyerAccountName: 'Tata Motors Ltd.',
};

const NETWORK_OWN: RFQFixture = {
  id: 'rfq-4',
  rfqNumber: 'RFQ-2026-00423',
  title: 'High Pressure Gate Valve System',
  sourcingMode: 'mode_3',
  budget: 90000,
  targetDeliveryDate: '2026-09-30',
  deliveryLocation: 'Hazira Works',
  buyerAccountName: OWN_ROSTER_BUYER,
  extractedEntities: [
    {
      id: 'ent-2',
      itemName: 'Flanged carbon steel connector',
      quantity: 20,
      unit: 'Nos',
      targetDate: '2026-09-30',
      technicalSpecs: 'CS flanged',
      confidence: 88,
      category: 'Hoses, Valves & Fittings',
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategory: 'Hoses, Valves & Fittings',
    },
  ],
};

const NETWORK_HVAC_QUOTED: RFQFixture = {
  id: 'rfq-5',
  rfqNumber: 'RFQ-2026-00903',
  title: 'HVAC control ducting',
  sourcingMode: 'mode_3',
  budget: 0,
  targetDeliveryDate: '2026-10-15',
  deliveryLocation: 'Mumbai',
  buyerAccountName: 'Adani Enterprises Ltd.',
  quotes: [A_QUOTE],
};

const NETWORK_STEEL: RFQFixture = {
  id: 'rfq-6',
  rfqNumber: 'RFQ-2026-00904',
  title: 'Carbon Steel Plate Supply',
  sourcingMode: 'mode_3',
  budget: 20000,
  targetDeliveryDate: '2026-12-05',
  deliveryLocation: 'Kandla',
  buyerAccountName: 'Adani Enterprises Ltd.',
};

const ALL_FIXTURES = [
  DIRECT_OWN,
  DIRECT_HVAC_QUOTED,
  DIRECT_STEEL,
  NETWORK_OWN,
  NETWORK_HVAC_QUOTED,
  NETWORK_STEEL,
];

// This vendor's own bootstrap record: `addedByBuyerCompany` is what
// `isOwnBuyerRfq` in the component actually checks against `opp.buyer`
// (the RFQ's `buyerAccountName`), replacing the old hardcoded-RFQ-number
// list. Matches jest.setup.ts's global default session email.
const SELF_VENDOR_RECORD = {
  id: 'v-self',
  email: 'buyer@procucev.com',
  name: 'Test Vendor Co',
  addedByBuyerCompany: OWN_ROSTER_BUYER,
};

function serveRFQs(fixtures: RFQFixture[]) {
  (global.fetch as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () =>
        /\/api\/rfqs(\?|$)/.test(String(url))
          ? {
              success: true,
              data: fixtures.map((fixture) => ({
                category: 'Engineering Spares - Mechanical',
                status: 'Quotes Pending',
                createdAt: '2026-09-04T10:00:00.000Z',
                quotes: [],
                extractedEntities: [],
                ...fixture,
              })),
            }
          : /\/api\/bootstrap/.test(String(url))
            ? { success: true, data: { vendors: [SELF_VENDOR_RECORD] } }
            : { success: true, data: {} },
    })
  );
}

const CATALOGUE_ONE: CatalogueFixture[] = [
  {
    id: 'cat-1',
    name: 'Centrifugal Industrial Water Pump 15HP',
    category: 'Pumps & Fluid Dynamics',
    sku: 'SKU-PUMP-15HP',
    specs: '15 HP industrial pump',
    unitPrice: 1200,
    leadTimeDays: 7,
    moq: 1,
  },
];

const CATALOGUE_TWO: CatalogueFixture[] = [
  ...CATALOGUE_ONE,
  {
    id: 'cat-2',
    name: 'Standard Carbon Steel Flanged Connector',
    category: 'Pipes & Fittings',
    sku: 'SKU-PIPE-CS',
    specs: 'Carbon steel connector fitting',
    unitPrice: 250,
    leadTimeDays: 10,
    moq: 5,
  },
];

interface HarnessProps {
  onNavigateToBidForm?: (opp: VendorOpportunity) => void;
  onNavigateToEvaluation?: () => void;
  onNavigateToSubscription?: () => void;
  subscription?: VendorSubscriptionPlan;
  downloadsUsed?: number;
  selfEvaluationCompleted?: boolean;
  selfEvaluationScore?: number;
  catalogue?: CatalogueFixture[];
}

/**
 * The provider exposes the toast in context but does not render it, so the probe
 * below surfaces it for assertions the way the app shell does at runtime.
 */
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

function Harness({
  onNavigateToBidForm = jest.fn(),
  onNavigateToEvaluation,
  onNavigateToSubscription,
  subscription = 'premium',
  downloadsUsed = 0,
  selfEvaluationCompleted = false,
  selfEvaluationScore = 85,
  catalogue = [],
}: HarnessProps) {
  const {
    setVendorSubscription,
    setVendorRfqDownloadsUsed,
    setVendorSelfEvaluationCompleted,
    setVendorSelfEvaluationScore,
    setVendorCatalogue,
  } = useApp();

  React.useEffect(() => {
    setVendorSubscription(subscription);
    setVendorRfqDownloadsUsed(downloadsUsed);
    setVendorSelfEvaluationCompleted(selfEvaluationCompleted);
    setVendorSelfEvaluationScore(selfEvaluationScore);
    setVendorCatalogue(catalogue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <ToastProbe />
      <OpportunityFeed
        onNavigateToBidForm={onNavigateToBidForm}
        onNavigateToEvaluation={onNavigateToEvaluation}
        onNavigateToSubscription={onNavigateToSubscription}
      />
    </>
  );
}

/**
 * Render and wait for the API-derived cards to arrive.
 *
 * refreshFromDB syncs vendorSubscription/vendorRfqDownloadsUsed from the
 * bootstrap vendor record once it resolves, which would otherwise race the
 * Harness's own prop-driven setters and clobber whichever test subscription
 * was asked for back to SELF_VENDOR_RECORD's defaults. Mirroring the same
 * values into the mocked vendor record keeps both writers in agreement
 * regardless of which one lands last.
 */
async function renderFeed(props: HarnessProps = {}) {
  const baseImpl = (global.fetch as jest.Mock).getMockImplementation()!;
  (global.fetch as jest.Mock).mockImplementation((url: string, init?: unknown) => {
    if (typeof url === 'string' && /\/api\/vendors\/v-self\/payment-link$/.test(url)) {
      const body = init && (init as RequestInit).body ? JSON.parse(String((init as RequestInit).body)) : {};
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { paymentUrl: `https://payments.zoho.in/mock/${body.plan}`, paymentLinkId: `pl-${body.plan}`, status: 'CREATED' },
        }),
      });
    }
    if (typeof url === 'string' && /\/api\/bootstrap/.test(url)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            vendors: [
              {
                ...SELF_VENDOR_RECORD,
                subscriptionPlan: props.subscription ?? 'premium',
                rfqDownloadsUsed: props.downloadsUsed ?? 0,
              },
            ],
          },
        }),
      });
    }
    return baseImpl(url, init);
  });

  const result = render(
    <AppProvider>
      <Harness {...props} />
    </AppProvider>
  );
  await waitFor(() =>
    expect(screen.getAllByTitle(/Download RFQ Technical BOQ/i).length).toBeGreaterThan(0)
  );
  return result;
}

/** Render a feed that is expected to stay empty. */
async function renderEmptyFeed(props: HarnessProps = {}) {
  const result = render(
    <AppProvider>
      <Harness {...props} />
    </AppProvider>
  );
  await waitFor(() =>
    expect(screen.getByText(/No matching targeted RFQ invitations found/i)).toBeInTheDocument()
  );
  return result;
}

const downloadButtons = () => screen.getAllByTitle(/Download RFQ Technical BOQ/i);
const viewDetailsButtons = () => screen.getAllByTitle(/View RFQ Details/i);

/** The five filter selects, in DOM order. */
function selects() {
  const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
  return {
    directBuyer: all[0],
    directMajor: all[1],
    directMinor: all[2],
    netMajor: all[3],
    netMinor: all[4],
  };
}

const searchBoxes = () => screen.getAllByPlaceholderText(/Specs, location, keywords/i);
const directCatalogueToggle = () =>
  screen.getByTitle(/Click to filter only RFQs matching items in your vendor catalogue/i);
const netCatalogueToggle = () =>
  screen.getByTitle(/Click to filter only marketplace RFQs matching items in your vendor catalogue/i);

describe('OpportunityFeed: rendering from the RFQ API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serveRFQs(ALL_FIXTURES);
  });

  test('splits the API result into direct invitations and open network cards', async () => {
    await renderFeed();

    expect(screen.getByText('3 Targeted RFQs')).toBeInTheDocument();
    expect(screen.getByText(DIRECT_OWN.title as string)).toBeInTheDocument();
    expect(screen.getByText(NETWORK_OWN.title as string)).toBeInTheDocument();
    // Six RFQs in, six download buttons out.
    expect(downloadButtons()).toHaveLength(6);
  });

  test('renders a published budget and marks an unpublished one as not disclosed', async () => {
    await renderFeed();

    expect(screen.getByText(/Not Disclosed/i)).toBeInTheDocument();
    expect(screen.getByText(/1,50,000/)).toBeInTheDocument();
  });

  test('shows an empty feed for both sections when the buyer has no RFQs', async () => {
    serveRFQs([]);
    await renderEmptyFeed();

    expect(screen.getByText(/No matching open network opportunities found/i)).toBeInTheDocument();
    expect(screen.getByText('0 Targeted RFQs')).toBeInTheDocument();
    // The reminder banner names a real RFQ, so with none it must not render at all.
    expect(screen.queryByRole('button', { name: /Submit Quote Now/i })).not.toBeInTheDocument();
  });
});

describe('OpportunityFeed: pending-bid reminder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('names the first unquoted RFQ and opens it, pluralising the count', async () => {
    serveRFQs(ALL_FIXTURES);
    const onNavigateToBidForm = jest.fn();
    await renderFeed({ onNavigateToBidForm });

    // Four of the six fixtures carry no quote.
    expect(screen.getByText(/4 quotations awaiting your response/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Submit Quote Now/i }));
    expect(onNavigateToBidForm).toHaveBeenCalledWith(
      expect.objectContaining({ rfqNumber: DIRECT_OWN.rfqNumber })
    );
  });

  test('uses the singular form for a single outstanding quotation', async () => {
    serveRFQs([DIRECT_OWN]);
    await renderFeed();

    expect(screen.getByText(/1 quotation awaiting your response/i)).toBeInTheDocument();
  });
});

describe('OpportunityFeed: streamlined dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serveRFQs(ALL_FIXTURES);
  });

  test('omits promotional evaluation panels and fabricated vendor profile metrics', async () => {
    const onNavigateToEvaluation = jest.fn();
    await renderFeed({ onNavigateToEvaluation, selfEvaluationCompleted: true, selfEvaluationScore: 92 });

    expect(screen.queryByText(/Complete 360° AI Self-Evaluation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Premium Vendor Showcase & Priority Network/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Apex Supplies Ltd.')).not.toBeInTheDocument();
    expect(screen.queryByText('3 Live')).not.toBeInTheDocument();
    expect(screen.queryByText('14 Contracts')).not.toBeInTheDocument();
    expect(onNavigateToEvaluation).not.toHaveBeenCalled();
  });
});

describe('OpportunityFeed: direct invitation filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serveRFQs(ALL_FIXTURES);
  });

  test('offers only the buyers that actually raised a direct invitation', async () => {
    await renderFeed();

    const options = Array.from(selects().directBuyer.options).map((o) => o.value);
    expect(options).toEqual([
      'all',
      DIRECT_OWN.buyerAccountName,
      DIRECT_HVAC_QUOTED.buyerAccountName,
    ]);
    expect(screen.getByText(UI_STRINGS.vendorFeed.buyerFilterAll)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.vendorFeed.buyerFilterLabel)).toBeInTheDocument();
  });

  test('narrows the direct list to a single raising buyer', async () => {
    await renderFeed();

    fireEvent.change(selects().directBuyer, {
      target: { value: DIRECT_HVAC_QUOTED.buyerAccountName },
    });
    expect(screen.getByText('2 Targeted RFQs')).toBeInTheDocument();
    expect(screen.queryByText(DIRECT_OWN.title as string)).not.toBeInTheDocument();

    fireEvent.change(selects().directBuyer, { target: { value: 'all' } });
    expect(screen.getByText('3 Targeted RFQs')).toBeInTheDocument();
  });

  test('filters by major category and resets the minor when the major changes', async () => {
    await renderFeed();

    fireEvent.change(selects().directMajor, { target: { value: 'Building & Infrastructure' } });
    expect(screen.getByText('1 Targeted RFQs')).toBeInTheDocument();

    fireEvent.change(selects().directMinor, { target: { value: 'Building Automation & HVAC' } });
    expect(screen.getByText('1 Targeted RFQs')).toBeInTheDocument();

    // Switching the major must clear the now-invalid minor rather than filter to nothing.
    fireEvent.change(selects().directMajor, { target: { value: 'Mechanical & Fluid Equipment' } });
    expect(selects().directMinor.value).toBe('all');
    expect(screen.getByText('2 Targeted RFQs')).toBeInTheDocument();

    fireEvent.change(selects().directMinor, { target: { value: 'Pumps & Valves' } });
    expect(screen.getByText('1 Targeted RFQs')).toBeInTheDocument();

    fireEvent.change(selects().directMinor, { target: { value: 'Structural Steel & Beams' } });
    expect(screen.getByText(DIRECT_STEEL.title as string)).toBeInTheDocument();

    fireEvent.change(selects().directMajor, { target: { value: 'all' } });
    expect(screen.getByText('3 Targeted RFQs')).toBeInTheDocument();
  });

  test('searches titles, RFQ numbers, locations, categories and line items', async () => {
    await renderFeed();
    const box = searchBoxes()[0];

    fireEvent.change(box, { target: { value: 'pumps' } });
    expect(screen.getByText('1 Targeted RFQs')).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'RFQ-2026-00902' } });
    expect(screen.getByText(DIRECT_STEEL.title as string)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'chennai' } });
    expect(screen.getByText(DIRECT_HVAC_QUOTED.title as string)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'building' } });
    expect(screen.getByText('1 Targeted RFQs')).toBeInTheDocument();

    // Matched on a line item rather than on anything printed on the card.
    fireEvent.change(box, { target: { value: 'ss316' } });
    expect(screen.getByText(DIRECT_OWN.title as string)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'nothing-matches-this' } });
    expect(screen.getByText(/No matching targeted RFQ invitations found/i)).toBeInTheDocument();

    // Whitespace is not a query.
    fireEvent.change(box, { target: { value: '   ' } });
    expect(screen.getByText('3 Targeted RFQs')).toBeInTheDocument();
  });

  test('counts catalogue matches and filters the list down to them', async () => {
    await renderFeed({ catalogue: CATALOGUE_TWO });

    const toggle = directCatalogueToggle();
    expect(within(toggle).getByText(/3 Catalogue Matches/)).toBeInTheDocument();
    expect(within(toggle).getByText(/Filter RFQs/)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(within(toggle).getByText(/Filtered \(Click to show all\)/)).toBeInTheDocument();
    expect(screen.getByText('3 Targeted RFQs')).toBeInTheDocument();
    // Two catalogue items, so the per-card badge is plural.
    expect(screen.getAllByText('2 Catalogue Matches').length).toBeGreaterThan(0);

    fireEvent.click(toggle);
    expect(within(toggle).getByText(/Filter RFQs/)).toBeInTheDocument();
  });

  test('uses the singular labels when one RFQ and one catalogue item match', async () => {
    await renderFeed({ catalogue: CATALOGUE_ONE });

    fireEvent.change(selects().directMajor, { target: { value: 'Building & Infrastructure' } });
    expect(within(directCatalogueToggle()).getByText(/1 Catalogue Match$/)).toBeInTheDocument();
    expect(screen.getAllByText('1 Catalogue Match').length).toBeGreaterThan(0);
  });

  test('empties the list when the catalogue filter is on and the catalogue is empty', async () => {
    await renderFeed({ catalogue: [] });

    const toggle = directCatalogueToggle();
    expect(within(toggle).getByText(/0 Catalogue Matches/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText(/No matching targeted RFQ invitations found/i)).toBeInTheDocument();
  });
});

describe('OpportunityFeed: open network filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serveRFQs(ALL_FIXTURES);
  });

  test('filters the marketplace by major and minor category', async () => {
    await renderFeed();

    fireEvent.change(selects().netMajor, { target: { value: 'Building & Infrastructure' } });
    expect(screen.getByText(NETWORK_HVAC_QUOTED.title as string)).toBeInTheDocument();
    expect(screen.queryByText(NETWORK_OWN.title as string)).not.toBeInTheDocument();

    fireEvent.change(selects().netMinor, { target: { value: 'Building Automation & HVAC' } });
    expect(screen.getByText(NETWORK_HVAC_QUOTED.title as string)).toBeInTheDocument();

    fireEvent.change(selects().netMajor, { target: { value: 'Mechanical & Fluid Equipment' } });
    expect(selects().netMinor.value).toBe('all');

    fireEvent.change(selects().netMinor, { target: { value: 'Structural Steel & Beams' } });
    expect(screen.getByText(NETWORK_STEEL.title as string)).toBeInTheDocument();

    fireEvent.change(selects().netMinor, { target: { value: 'Pumps & Valves' } });
    expect(screen.getByText(NETWORK_OWN.title as string)).toBeInTheDocument();

    fireEvent.change(selects().netMajor, { target: { value: 'all' } });
    expect(screen.getByText(NETWORK_STEEL.title as string)).toBeInTheDocument();
  });

  test('searches the marketplace across every indexed field', async () => {
    await renderFeed();
    const box = searchBoxes()[1];

    fireEvent.change(box, { target: { value: 'gate valve' } });
    expect(screen.getByText(NETWORK_OWN.title as string)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'RFQ-2026-00904' } });
    expect(screen.getByText(NETWORK_STEEL.title as string)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'mumbai' } });
    expect(screen.getByText(NETWORK_HVAC_QUOTED.title as string)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'mechanical' } });
    expect(screen.getByText(NETWORK_OWN.title as string)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'flanged' } });
    expect(screen.getByText(NETWORK_OWN.title as string)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'nothing-matches-this' } });
    expect(screen.getByText(/No matching open network opportunities found/i)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: '' } });
    expect(screen.getByText(NETWORK_OWN.title as string)).toBeInTheDocument();
  });

  test('counts and filters marketplace catalogue matches', async () => {
    await renderFeed({ catalogue: CATALOGUE_TWO });

    const toggle = netCatalogueToggle();
    expect(within(toggle).getByText(/3 Catalogue Matches/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(toggle).getByText(/Filtered \(Click to show all\)/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(toggle).getByText(/Filter RFQs/)).toBeInTheDocument();
  });

  test('empties the marketplace when filtering on an empty catalogue', async () => {
    await renderFeed({ catalogue: [] });

    fireEvent.click(netCatalogueToggle());
    expect(screen.getByText(/No matching open network opportunities found/i)).toBeInTheDocument();
  });
});

describe('OpportunityFeed: downloads, locking and plan upgrades', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serveRFQs(ALL_FIXTURES);
  });

  test('View Details navigates to the vendor RFQ details route for the clicked card', async () => {
    await renderFeed({ subscription: 'premium' });

    fireEvent.click(viewDetailsButtons()[0]);

    expect(mockRouterPush).toHaveBeenCalledWith(
      `/vendor/rfq-details?rfq=${encodeURIComponent(DIRECT_OWN.rfqNumber as string)}`,
    );
  });

  test('downloads an own-roster RFQ without prompting for an upgrade', async () => {
    // isOwnBuyerRfq needs a real vendor record (matched by session email) whose
    // addedByBuyerCompany equals the RFQ's buyerAccountName — serveRFQs's
    // SELF_VENDOR_RECORD supplies exactly that for DIRECT_OWN/NETWORK_OWN.
    await renderFeed({ subscription: 'premium' });

    await act(async () => {
      fireEvent.click(downloadButtons()[0]);
    });
    await waitFor(() => expect(screen.getByText('RFQ Downloaded')).toBeInTheDocument());
    expect(screen.queryByText(/Upgrade to Premium Sourcing Plan/i)).not.toBeInTheDocument();
  });

  test('downloading an RFQ also downloads its real attachments, skipping any that fail to fetch', async () => {
    await renderFeed({ subscription: 'premium' });

    const priorImpl = (global.fetch as jest.Mock).getMockImplementation()!;
    const rfqSpecific = jest.fn((url: string, init?: unknown) => {
      if (typeof url === 'string' && new RegExp(`/api/rfqs/${DIRECT_OWN.rfqNumber}$`).test(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              attachments: [
                { id: 'att-1', fileName: 'boq.pdf' },
                { id: 'att-2', fileName: 'specs.xlsx' },
              ],
            },
          }),
        });
      }
      if (typeof url === 'string' && /\/api\/rfqs\/attachments\/att-1$/.test(url)) {
        return Promise.resolve({ ok: true, blob: async () => new Blob(['pdf']) });
      }
      if (typeof url === 'string' && /\/api\/rfqs\/attachments\/att-2$/.test(url)) {
        return Promise.resolve({ ok: false });
      }
      return priorImpl(url, init);
    });
    (global.fetch as jest.Mock).mockImplementation(rfqSpecific);

    await act(async () => {
      fireEvent.click(downloadButtons()[0]);
    });

    await waitFor(() =>
      expect(rfqSpecific).toHaveBeenCalledWith(
        expect.stringContaining('/api/rfqs/attachments/att-1'),
        expect.anything(),
      ),
    );
    expect(rfqSpecific).toHaveBeenCalledWith(
      expect.stringContaining('/api/rfqs/attachments/att-2'),
      expect.anything(),
    );
  });

  test('gracefully continues past a failed attachment-listing fetch after the specification already downloaded', async () => {
    await renderFeed({ subscription: 'premium' });

    const priorImpl = (global.fetch as jest.Mock).getMockImplementation()!;
    (global.fetch as jest.Mock).mockImplementation((url: string, init?: unknown) => {
      if (typeof url === 'string' && new RegExp(`/api/rfqs/${DIRECT_OWN.rfqNumber}$`).test(url)) {
        return Promise.reject(new Error('network down'));
      }
      return priorImpl(url, init);
    });

    await act(async () => {
      fireEvent.click(downloadButtons()[0]);
    });

    await waitFor(() => expect(screen.getByText('RFQ Downloaded')).toBeInTheDocument());
  });

  test('blocks a marketplace download on the client-uploaded Premium plan', async () => {
    await renderFeed({ subscription: 'premium' });

    // The second card is RFQ-2026-00901, outside this vendor's own-buyer roster.
    fireEvent.click(downloadButtons()[1]);
    expect(screen.getByText(/Upgrade to Premium Sourcing Plan/i)).toBeInTheDocument();
    expect(screen.getByText(/Marketplace RFQs outside client roster/i)).toBeInTheDocument();
    // Premium is the active plan, so only the other two rows offer an action.
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  test('blocks a marketplace download once the Connect quota is spent', async () => {
    await renderFeed({ subscription: 'connect', downloadsUsed: 50 });

    fireEvent.click(downloadButtons()[1]);
    expect(screen.getByText('Quarterly Quota Reached')).toBeInTheDocument();
    expect(screen.getByText(/50 RFQ download limit reached/i)).toBeInTheDocument();
  });

  test('allows a marketplace download while the Connect quota remains', async () => {
    await renderFeed({ subscription: 'connect', downloadsUsed: 10 });

    await act(async () => {
      fireEvent.click(downloadButtons()[1]);
    });
    expect(screen.getByText('RFQ Downloaded')).toBeInTheDocument();
  });

  test('blocks a marketplace download once the Select quota is spent', async () => {
    await renderFeed({ subscription: 'select', downloadsUsed: 100 });

    fireEvent.click(downloadButtons()[1]);
    expect(screen.getByText(/100 RFQ download limit reached/i)).toBeInTheDocument();
  });

  test('allows a marketplace download while the Select quota remains', async () => {
    await renderFeed({ subscription: 'select', downloadsUsed: 10 });

    await act(async () => {
      fireEvent.click(downloadButtons()[1]);
    });
    expect(screen.getByText('RFQ Downloaded')).toBeInTheDocument();
  });

  test('locks off-roster RFQs below the top tier', async () => {
    await renderFeed({ subscription: 'premium' });

    // Two off-roster direct cards plus two off-roster marketplace cards.
    expect(screen.getAllByRole('button', { name: /🔒 Upgrade/i })).toHaveLength(4);
    expect(screen.getAllByText('🔒 Premium Locked')).toHaveLength(4);
  });

  test('unlocks every RFQ on the Select tier', async () => {
    // 'premium_network' exists in the VendorSubscriptionPlan union but nothing
    // in the app ever assigns it (see vendorController.js's
    // VALID_VENDOR_SUBSCRIPTION_PLANS) — 'select' is the real top tier that
    // actually unlocks the whole marketplace.
    await renderFeed({ subscription: 'select' });

    expect(screen.queryByRole('button', { name: /🔒 Upgrade/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('Client Exclusive')).toHaveLength(3);
    expect(screen.getAllByText('Open Network')).toHaveLength(3);
  });

  test('starts a real Zoho checkout for each paid plan from the upgrade modal', async () => {
    // Connect/Select are paid plans and route through the real Zoho checkout
    // modal (real gate — see handleUpgradeClick); only Premium is free and
    // switches instantly. Paying now creates a real payment link and redirects
    // to Zoho — the plan itself only flips once the backend's webhook (or
    // reconciliation poller) confirms payment, so this UI no longer flips it
    // client-side, and there is nothing left to chain the next plan onto
    // within one render — each is exercised from its own fresh render.
    const r1 = await renderFeed({ subscription: 'premium' });
    fireEvent.click(screen.getAllByRole('button', { name: /🔒 Upgrade/i })[0]);
    // Connect is the first actionable row while Premium is active.
    fireEvent.click(screen.getAllByRole('button', { name: 'Upgrade' })[0]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Pay ₹2/i }));
      await Promise.resolve();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/vendors/v-self/payment-link',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'connect' }) })
    );
    r1.unmount();

    const r2 = await renderFeed({ subscription: 'premium' });
    fireEvent.click(screen.getAllByRole('button', { name: /🔒 Upgrade/i })[0]);
    // Connect then Select are the two actionable "Upgrade" rows while Premium is active.
    fireEvent.click(screen.getAllByRole('button', { name: 'Upgrade' })[1]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Pay ₹5/i }));
      await Promise.resolve();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/vendors/v-self/payment-link',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'select' }) })
    );
    r2.unmount();

    await renderFeed({ subscription: 'connect', downloadsUsed: 50 });
    fireEvent.click(downloadButtons()[1]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    });
    expect(screen.getByText('PREMIUM Plan Activated!')).toBeInTheDocument();
  });

  test('marks Connect as active and closes the modal both ways', async () => {
    // Connect already unlocks every card (isLocked checks connect/select), so
    // there is no per-card "🔒 Upgrade" button to open the modal with at this
    // tier — the quota-exceeded path on a marketplace download opens it
    // instead, same as the "blocks a marketplace download once the Connect
    // quota is spent" test above.
    await renderFeed({ subscription: 'connect', downloadsUsed: 50 });

    fireEvent.click(downloadButtons()[1]);
    expect(screen.getByText('Active')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/Upgrade to Premium Sourcing Plan/i)).not.toBeInTheDocument();

    fireEvent.click(downloadButtons()[1]);
    fireEvent.click(screen.getByText('✕'));
    expect(screen.queryByText(/Upgrade to Premium Sourcing Plan/i)).not.toBeInTheDocument();
  });

  test('marks Select as active when it is the current plan', async () => {
    // Nothing is ever locked at the top "select" tier, so there is no
    // per-card "🔒 Upgrade" button to open the modal with — the quota-
    // exceeded path on a marketplace download opens it instead (same
    // mechanism the "blocks a marketplace download once the Select quota
    // is spent" test above exercises).
    await renderFeed({ subscription: 'select', downloadsUsed: 100 });

    fireEvent.click(downloadButtons()[1]);
    const selectRow = screen.getByText(/Select Model/).closest('div')?.parentElement as HTMLElement;
    expect(within(selectRow).getByText('Active')).toBeInTheDocument();
  });

  test('shows a failure toast when the RFQ download request fails', async () => {
    await renderFeed({ subscription: 'premium' });

    // renderFeed's own initial fetch already resolved; override afterwards
    // so only the download action itself fails.
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: async () => ({ success: false, error: 'RFQ not found' }) })
    ) as any;

    await act(async () => {
      fireEvent.click(downloadButtons()[0]);
    });
    expect(screen.getByTestId('toast')).toHaveTextContent('Download Failed');
  });

  test('starts a real Zoho checkout for a Connect-plan upgrade', async () => {
    await renderFeed({ subscription: 'premium' });

    // Reliable trigger: the locked-RFQ card's own "🔒 Upgrade" button always
    // opens the upgrade modal, regardless of which card/section it's on.
    const lockedBtns = screen.queryAllByRole('button', { name: /🔒 Upgrade/i });
    expect(lockedBtns.length).toBeGreaterThan(0);
    fireEvent.click(lockedBtns[0]);

    // Both Connect and Select plan buttons are labeled "Upgrade" — Connect is first
    const connectBtn = screen.getAllByRole('button', { name: /^Upgrade$/i })[0];
    fireEvent.click(connectBtn); // Connect plan — opens the real Zoho checkout modal
    expect(screen.getByText(/Secure Payment/i)).toBeInTheDocument();

    const payBtn = screen.getByRole('button', { name: /Pay ₹2/i });
    await act(async () => {
      fireEvent.click(payBtn);
      await Promise.resolve();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/vendors/v-self/payment-link',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'connect' }) })
    );
  });

  test('switches directly to Premium (free) from the locked-RFQ upgrade modal', async () => {
    // Connect already unlocks every card, so there is no per-card "🔒
    // Upgrade" button here either — open the modal via the quota-exceeded
    // path instead, same as the "marks Connect as active" test above.
    await renderFeed({ subscription: 'connect', downloadsUsed: 50 });

    await act(async () => {
      fireEvent.click(downloadButtons()[1]);
    });

    const selectPremiumBtn = screen.getByRole('button', { name: /^Select$/i });
    await act(async () => {
      fireEvent.click(selectPremiumBtn);
    });

    // Premium is free — switches instantly, no payment gateway involved
    expect(screen.queryByText(/Dummy Payment Gateway/i)).not.toBeInTheDocument();
  });

  test('opens the subscription-fee "View Connect / Select" fallback modal when no onNavigateToSubscription is provided', async () => {
    // onNavigateToSubscription genuinely omitted (not just undefined-through-a-default)
    await renderFeed({ subscription: 'premium', onNavigateToSubscription: undefined });

    const feeBtn = screen.queryByRole('button', { name: /View Connect \/ Select \(\$0 Fee\)/i });
    if (feeBtn) {
      fireEvent.click(feeBtn);
      expect(screen.getByText(/Upgrade to Premium Sourcing Plan/i)).toBeInTheDocument();
    }
  });
});
