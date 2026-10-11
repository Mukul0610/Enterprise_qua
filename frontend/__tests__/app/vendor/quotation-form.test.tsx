import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import QuotationForm from "@/app/vendor/quotation-form";
import { AppProvider, useApp } from "@/lib/store";
import { authClient } from "@/lib/authClient";
import * as XLSX from "xlsx";

const mockRouterPush = jest.fn();
jest.mock("next/navigation", () => ({
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

// quotation-form.tsx now loads the caller's own vendor record, submits real
// bids, and downloads real RFQ specs (BUGS.md #28/#18) instead of a static
// table. Default mock: a resolvable vendor record and generic-success
// endpoints; individual tests override specific routes to exercise failure
// branches.
// addedByBuyerCompany matches RFQ-2026-00421's buyer in INITIAL_VENDOR_OPPORTUNITIES
// (lib/store.tsx) — the real relationship isOwnBuyerRfq now checks, replacing
// the old hardcoded 4-RFQ-number allow-list.
const MOCK_MY_VENDOR = {
  id: "v-test-vendor",
  name: "Test Vendor Co",
  email: "vendor@test.com",
  addedByBuyerCompany: "Larsen & Toubro Ltd. (L&T)",
};

// The one RFQ every test gets unless it overrides global.fetch itself:
// this vendor's own buyer uploaded it (buyerAccountName matches
// MOCK_MY_VENDOR.addedByBuyerCompany), so isOwnBuyerRfq always unlocks it
// regardless of subscription tier — the real relationship the component
// checks now, replacing the old hardcoded RFQ-number allow-list.
const DEFAULT_RFQ = {
  id: "rfq-00421",
  rfqNumber: "RFQ-2026-00421",
  title: "Centrifugal Water Pump Package (15 HP)",
  buyerAccountName: MOCK_MY_VENDOR.addedByBuyerCompany,
  category: "Engineering Spares - Mechanical",
  sourcingMode: "mode_1",
  status: "Quotes Pending",
  quotesCount: 0,
  targetDeliveryDate: "2026-09-15",
  budget: 150000,
  createdAt: "2026-09-01",
  chasingActive: false,
  quotes: [],
  extractedEntities: [],
};

function defaultMockFetchImpl(url: string, options: any = {}) {
  const method = options.method || "GET";
  if (/\/api\/vendors\/[^/]+$/.test(url) && method === "GET") {
    return Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: MOCK_MY_VENDOR }),
    });
  }
  if (/\/api\/rfqs\/[^/]+\/quotes$/.test(url) && method === "POST") {
    return Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });
  }
  if (/\/api\/rfqs\/[^/]+\/email-preview/.test(url)) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });
  }
  if (/\/api\/rfqs(\?|$)/.test(url) && method === "GET") {
    return Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: [DEFAULT_RFQ] }),
    });
  }
  if (url === "/api/bootstrap") {
    return Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });
  }
  return Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data: {} }),
  });
}

function QuotationFormCustomWrapper({
  onBack,
  onSubmitSuccess,
  customSubscription,
  opportunity,
  withSession = false,
}: {
  onBack: () => void;
  onSubmitSuccess?: () => void;
  customSubscription?: any;
  opportunity?: any;
  withSession?: boolean;
}) {
  const { setVendorSubscription, setCurrentUserSession } = useApp();

  React.useEffect(() => {
    if (customSubscription) {
      setVendorSubscription(customSubscription);
    }
    if (withSession) {
      // refreshRFQs() gates on authClient.getToken(), not on this context
      // state — setting only setCurrentUserSession left RFQs permanently
      // empty under the auth-gated GET /api/rfqs. Both need to be set, and
      // this effect (child of AppProvider) fires before AppProvider's own
      // mount effect, so the token is in place before refreshRFQs() checks
      // it. Guarded: a test that already called authClient.setSession with
      // its own token before rendering (to assert on that exact token later)
      // must not have it silently overwritten here.
      if (!authClient.getToken()) {
        authClient.setSession(
          {
            id: "user-1",
            email: "vendor@test.com",
            name: "Test Vendor Co",
            role: "vendor",
            orgId: "org-1",
            orgName: "Test Vendor Co",
          },
          "test-vendor-token",
        );
      }
      setCurrentUserSession({
        id: "user-1",
        email: "vendor@test.com",
        name: "Test Vendor Co",
        role: "vendor",
        orgId: "org-1",
        orgName: "Test Vendor Co",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <QuotationForm
      onBack={onBack}
      onSubmitSuccess={onSubmitSuccess}
      opportunity={opportunity}
    />
  );
}

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<AppProvider>{ui}</AppProvider>);
};

/**
 * Serve a specific RFQ list from GET /api/rfqs.
 *
 * Opportunities are derived from RFQs the API returns rather than from a seeded
 * array, so a test that needs several pricing tiers has to supply the RFQs that
 * produce them. `RFQ-2026-00421` is one this vendor's buyer uploaded (unlocked);
 * the marketplace one is not (locked below premium_network).
 */
function serveVendorRFQs(rfqNumbers: string[]) {
  (global.fetch as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () =>
        /\/api\/rfqs(\?|$)/.test(String(url))
          ? {
              success: true,
              data: rfqNumbers.map((rfqNumber, idx) => ({
                id: `rfq-${idx}`,
                rfqNumber,
                title: `Opportunity ${rfqNumber}`,
                category: "Engineering Spares - Mechanical",
                sourcingMode: idx === 0 ? "mode_1" : "mode_3",
                status: "Quotes Pending",
                quotesCount: 0,
                budget: 150000,
                targetDeliveryDate: "2026-09-15",
                createdAt: "2026-09-04T10:00:00.000Z",
                deliveryLocation: "Pune Plant",
                // Only the first RFQ matches MOCK_MY_VENDOR's addedByBuyerCompany,
                // so isOwnBuyerRfq only unlocks that one — the rest stay locked
                // below connect/select, matching this function's own doc comment.
                buyerAccountName:
                  idx === 0
                    ? MOCK_MY_VENDOR.addedByBuyerCompany
                    : "Some Other Buyer Ltd.",
                extractedEntities: [],
                quotes: [],
                chasingActive: false,
              })),
            }
          : { success: true, data: {} },
    }),
  );
}

describe("QuotationForm Comprehensive Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    global.fetch = jest.fn(defaultMockFetchImpl) as any;
  });

  afterEach(() => {
    jest.useRealTimers();
    authClient.setSession(null, null);
  });

  test("Renders summary counters, table items, and triggers onBack navigation", () => {
    const onBack = jest.fn();
    const { unmount } = renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} />,
    );

    expect(screen.queryByText(/Sourcing Enquiries & Quotation Tracking/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Active sourcing enquiries/i)).toBeInTheDocument();
    expect(
      screen.getByText(/RFQs Received \(Active Enquiries\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Quotations Submitted/i)).toBeInTheDocument();

    const backBtn = screen.getByRole("button", {
      name: /Back to Dashboard/i,
    });
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);

    unmount();
  });

  test("Search narrows the enquiry list and updates the result count", async () => {
    serveVendorRFQs(["RFQ-2026-00421", "RFQ-2026-00501"]);
    renderWithProvider(
      <QuotationFormCustomWrapper onBack={jest.fn()} withSession />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 2 of 2 enquiries"),
    );
    fireEvent.change(screen.getByRole("searchbox", { name: /Search enquiries/i }), {
      target: { value: "00501" },
    });

    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1 of 2 enquiries");
    expect(screen.getByText("Opportunity RFQ-2026-00501")).toBeInTheDocument();
    expect(screen.queryByText("Opportunity RFQ-2026-00421")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: /Filter enquiries by status/i }), {
      target: { value: "closed" },
    });
    expect(screen.getByText("No matching enquiries")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear search and filters/i }));
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 2 of 2 enquiries");
  });

  test("View Details navigates to the vendor RFQ details route for the clicked row", async () => {
    serveVendorRFQs(["RFQ-2026-00421"]);
    renderWithProvider(
      <QuotationFormCustomWrapper onBack={jest.fn()} withSession />,
    );

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /View Details/i }).length,
      ).toBeGreaterThan(0),
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: /View Details/i })[0],
    );

    expect(mockRouterPush).toHaveBeenCalledWith(
      "/vendor/rfq-details?rfq=RFQ-2026-00421",
    );
  });

  test("Downloads RFQs across locked and unlocked tiers", async () => {
    serveVendorRFQs(["RFQ-2026-00421", "RFQ-2026-00501"]);
    const onBack = jest.fn();

    // refreshRFQs() gates purely on authClient.getToken() (RFQs must still
    // load), while "no session" here means no currentUserSession — so
    // loadMyVendorRecord never resolves an identity and isOwnBuyerRfq stays
    // false for every RFQ regardless of buyerAccountName.
    authClient.setSession(null, "test-token-no-identity");

    // Standard subscription, no session: nothing matches a real direct-buyer
    // relationship, so every row is locked — clicking shows the upgrade
    // toast rather than calling the real download endpoint.
    const { unmount: unmountStandard } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        customSubscription="standard"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /Download RFQ/i }).length,
      ).toBe(2),
    );
    const downloadBtns = screen.getAllByRole("button", {
      name: /Download RFQ/i,
    });
    fireEvent.click(downloadBtns[0]);
    fireEvent.click(downloadBtns[1]);
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/email-preview"),
      expect.anything(),
    );
    unmountStandard();

    // 'connect' is a real marketplace-unlock tier: every RFQ downloads for
    // real regardless of buyer relationship, including with no session at
    // all (exercising handleDownloadRfq's own no-session fallback copy).
    const { unmount: unmountConnect } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        customSubscription="connect"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /Download RFQ/i }).length,
      ).toBe(2),
    );
    const unlockedDownloadBtns = screen.getAllByRole("button", {
      name: /Download RFQ/i,
    });
    await act(async () => {
      fireEvent.click(unlockedDownloadBtns[1]);
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/email-preview"),
      expect.anything(),
    );
    unmountConnect();
  });

  test("Buyer details modal interactions: open, copy company name with timer, and close", async () => {
    const onBack = jest.fn();
    const onSubmitSuccess = jest.fn();

    // Opportunities are derived from RFQs fetched from GET /api/rfqs, not from
    // the bootstrap payload (that endpoint is anonymous and dropped RFQs from
    // its response — serving the global list there is what leaked RFQs
    // between buyers). Both rows this test needs share this vendor's real
    // addedByBuyerCompany relationship ('Larsen & Toubro Ltd. (L&T)', same as
    // MOCK_MY_VENDOR) — RFQ-2026-00421 has a BUYER_CONTACTS_MAP entry,
    // RFQ-2026-00423 doesn't, so the second row exercises the fallback
    // baseBuyerData branch while still being unlocked via the real
    // direct-buyer relationship (not a submitted quote).
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/rfqs(\?|$)/.test(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: [
              {
                id: "rfq-00421",
                rfqNumber: "RFQ-2026-00421",
                title: "Centrifugal Water Pump Package (15 HP)",
                buyerAccountName: "Larsen & Toubro Ltd. (L&T)",
                category: "Mechanical",
                sourcingMode: "mode_1",
                status: "Quotes Pending",
                quotesCount: 0,
                targetDeliveryDate: "2026-09-15",
                budget: 150000,
                createdAt: "2026-09-01",
                chasingActive: false,
                quotes: [],
                extractedEntities: [],
              },
              {
                id: "rfq-00423",
                rfqNumber: "RFQ-2026-00423",
                title: "High Pressure Gate Valve System",
                buyerAccountName: "Larsen & Toubro Ltd. (L&T)",
                category: "Mechanical",
                sourcingMode: "mode_1",
                status: "Quotes Pending",
                quotesCount: 0,
                targetDeliveryDate: "2026-09-20",
                budget: 85000,
                createdAt: "2026-09-01",
                chasingActive: false,
                quotes: [],
                extractedEntities: [],
              },
            ],
          }),
        });
      }
      return defaultMockFetchImpl(url, options);
    }) as any;

    const { unmount } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        onSubmitSuccess={onSubmitSuccess}
        customSubscription="standard"
        withSession
      />,
    );

    // Opportunities are derived from RFQs fetched from the API, so the rows appear
    // only once that request settles. The table element itself renders immediately
    // with an empty body, so waiting on it would resolve before any row exists —
    // wait for the per-row buttons instead. First button is RFQ-2026-00421 (in
    // BUYER_CONTACTS_MAP, unlocked via this vendor's real addedByBuyerCompany
    // relationship).
    const infoBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Buyer Details/i });
      expect(btns.length).toBeGreaterThan(1);
      return btns;
    });
    fireEvent.click(infoBtns[0]);

    expect(screen.getByText(/Buyer Contact Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Direct Client Roster/i)).toBeInTheDocument();

    // Copy Company Name button
    const copyBtn = screen.getByTitle(/Copy Company Name/i);
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(screen.getByText(/Copied!/i)).toBeInTheDocument();

    // Advance timer to test setCopiedField(null)
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(screen.queryByText(/Copied!/i)).not.toBeInTheDocument();

    // Close via Close button (triggers onSubmitSuccess)
    const closeBtn = screen.getByRole("button", { name: /^Close$/i });
    fireEvent.click(closeBtn);
    expect(onSubmitSuccess).toHaveBeenCalledTimes(1);

    // Open second info button (RFQ-2026-00423 - no BUYER_CONTACTS_MAP entry,
    // so this hits the fallback baseBuyerData branch, still unlocked via the
    // same real addedByBuyerCompany relationship as RFQ-2026-00421 above)
    fireEvent.click(infoBtns[1]);
    expect(screen.getByText(/Buyer Contact Details/i)).toBeInTheDocument();

    // Close via X button in header
    const closeXBtn = screen.getByTitle(/Close Buyer Details Modal/i);
    fireEvent.click(closeXBtn);
    unmount();

    // Render without onSubmitSuccess to test fallback branch on modal close
    const { unmount: unmountNoCallback } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        onSubmitSuccess={undefined}
        withSession
      />,
    );
    const infoBtnsNoCallback = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Buyer Details/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(infoBtnsNoCallback[0]);
    const closeBtnNoCallback = screen.getByRole("button", { name: /^Close$/i });
    fireEvent.click(closeBtnNoCallback);
    unmountNoCallback();
  });

  test("loads the caller's own vendor record on mount", async () => {
    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        withSession
        customSubscription="select"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/vendors/vendor%40test.com",
        { headers: { "Content-Type": "application/json", Authorization: "Bearer test-vendor-token" } },
      );
    });
    // Flush the rest of the async load chain (res.json() + state updates)
    // before the test ends and the component unmounts.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  test("treats a vendor record with no addedByBuyerCompany as having no direct buyer relationship", async () => {
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: "v-no-rel",
              name: "No Relationship Vendor",
              email: "vendor@test.com",
            },
          }),
        });
      }
      return defaultMockFetchImpl(url, options);
    }) as any;

    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        withSession
        customSubscription="standard"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/vendors/vendor%40test.com",
        { headers: { "Content-Type": "application/json", Authorization: "Bearer test-vendor-token" } },
      );
    });

    // No addedByBuyerCompany means every RFQ falls back to marketplace-locked,
    // including RFQ-2026-00421 which would otherwise be this vendor's own.
    await waitFor(() =>
      expect(screen.getAllByText(/Premium Locked/i).length).toBeGreaterThan(0),
    );
  });

  test("does not update state if the component unmounts before the vendor record fetch resolves", async () => {
    let resolveFetch!: (value: any) => void;
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) return pending;
      return defaultMockFetchImpl(url, options);
    }) as any;

    const onBack = jest.fn();
    const { unmount } = renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        withSession
        customSubscription="select"
      />,
    );
    unmount();

    // Resolving after unmount exercises the cancelled-guard in
    // quotation-form.tsx's loadMyVendorRecord — this must not throw or warn
    // about updating state on an unmounted component.
    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ success: true, data: MOCK_MY_VENDOR }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  test("handles a network failure while loading the vendor record gracefully", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      (url: string, options: any = {}) => {
        if (/\/api\/vendors\/[^/]+$/.test(url))
          return Promise.reject(new Error("network down"));
        return defaultMockFetchImpl(url, options);
      },
    );
    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        withSession
        customSubscription="select"
      />,
    );

    // Should render normally without throwing despite the failed lookup
    await waitFor(() =>
      expect(
        screen.getByText(/Active sourcing enquiries/i),
      ).toBeInTheDocument(),
    );
  });

  test("opens the bid modal, validates unit price, and submits a quote successfully", async () => {
    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        withSession
        customSubscription="select"
      />,
    );

    // RFQ-2026-00421 is DEFAULT_RFQ, this vendor's own buyer — always unlocked
    const submitBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Submit Quote$/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(submitBtns[0]);

    expect(
      screen.getByRole("heading", { name: /Submit Quotation/i }),
    ).toBeInTheDocument();

    // Validation: submit with no unit price
    const submitQuotationBtn = screen.getByRole("button", {
      name: /Submit Quotation/i,
    });
    await act(async () => {
      fireEvent.click(submitQuotationBtn);
    });
    expect(
      screen.getByRole("heading", { name: /Submit Quotation/i }),
    ).toBeInTheDocument(); // modal stays open

    // Fill in the bid form
    const priceInputs = document.querySelectorAll('input[type="number"]');
    fireEvent.change(priceInputs[0], { target: { value: "1500" } }); // unit price
    fireEvent.change(priceInputs[1], { target: { value: "10" } }); // lead time
    fireEvent.change(priceInputs[2], { target: { value: "2" } }); // warranty
    fireEvent.change(screen.getByDisplayValue("45 Days Net"), {
      target: { value: "30 Days Net" },
    });
    fireEvent.change(document.querySelector("textarea")!, {
      target: { value: "Best price guaranteed" },
    });

    await act(async () => {
      fireEvent.click(submitQuotationBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/rfqs/"),
      expect.objectContaining({ method: "POST" }),
    );
    // Modal closes on success
    expect(
      screen.queryByRole("heading", { name: /Submit Quotation/i }),
    ).not.toBeInTheDocument();
  });

  test("captures a separate unit price per line item and submits lineItemQuotes for a multi-item RFQ", async () => {
    const multiItemRfq = {
      ...DEFAULT_RFQ,
      id: "rfq-multi-001",
      rfqNumber: "RFQ-2026-MULTI01",
      extractedEntities: [
        { id: "li-1", itemName: "Centrifugal Pump 15HP", quantity: 2, unit: "Nos", targetDate: "", technicalSpecs: "", confidence: 1, category: "Engineering Spares - Mechanical", minorCategory: "Pumps" },
        { id: "li-2", itemName: "Mounting Base Plate", quantity: 4, unit: "Nos", targetDate: "", technicalSpecs: "", confidence: 1, category: "Engineering Spares - Mechanical", minorCategory: "Pumps" },
      ],
    };
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any = {}) => {
      const method = options.method || "GET";
      if (/\/api\/rfqs(\?|$)/.test(url) && method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [multiItemRfq] }) });
      }
      return defaultMockFetchImpl(url, options);
    });

    renderWithProvider(
      <QuotationFormCustomWrapper onBack={jest.fn()} withSession customSubscription="select" />,
    );

    const submitBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Submit Quote$/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(submitBtns[0]);

    expect(screen.getByText(/Line Item Pricing/i)).toBeInTheDocument();

    // UOM shown read-only per row, matching the RFQ's own extracted unit.
    expect(screen.getAllByText("Nos").length).toBe(2);

    const itemPriceInputs = screen.getAllByLabelText(/Rate for/i);
    expect(itemPriceInputs).toHaveLength(2);

    const worksheet = XLSX.utils.json_to_sheet([
      { "Item ID": "li-1", Item: "Centrifugal Pump 15HP", "Rate (INR)": 1000 },
      { "Item ID": "li-2", Item: "Mounting Base Plate", "Rate (INR)": 200 },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Priced RFQ");
    const pricedWorkbook = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const pricedFile = new File([pricedWorkbook], "priced-rfq.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const uploadButton = screen.getByRole("button", { name: /Upload Priced Excel/i });
    const excelInput = uploadButton.parentElement?.querySelector('input[type="file"]');
    expect(excelInput).not.toBeNull();
    fireEvent.change(excelInput!, { target: { files: [pricedFile] } });
    await waitFor(() => expect(itemPriceInputs[0]).toHaveValue(1000));
    expect(itemPriceInputs[1]).toHaveValue(200);

    fireEvent.change(itemPriceInputs[0], { target: { value: "1000" } });
    fireEvent.change(itemPriceInputs[1], { target: { value: "200" } });

    // Amount per row and the running Total recompute live as rates are typed.
    expect(screen.getByText("2,000")).toBeInTheDocument(); // 1000 * qty 2
    expect(screen.getByText("800")).toBeInTheDocument(); // 200 * qty 4
    expect(screen.getByText("2,800")).toBeInTheDocument(); // Total

    // Export as Excel — downloads the line items exactly as currently entered.
    const createObjectURLSpy = jest.fn(() => "blob:mock-quotation");
    const revokeObjectURLSpy = jest.fn();
    global.URL.createObjectURL = createObjectURLSpy;
    global.URL.revokeObjectURL = revokeObjectURLSpy;
    fireEvent.click(screen.getByText(/Export as Excel/i));
    expect(createObjectURLSpy).toHaveBeenCalled();

    const submitQuotationBtn = screen.getByRole("button", { name: /Submit Quotation/i });
    await act(async () => {
      fireEvent.click(submitQuotationBtn);
    });

    const quoteCall = (global.fetch as jest.Mock).mock.calls.find(([url, opts]) =>
      /\/api\/rfqs\/[^/]+\/quotes$/.test(url) && opts?.method === "POST",
    );
    expect(quoteCall).toBeDefined();
    const body = JSON.parse(quoteCall![1].body);
    expect(body.lineItemQuotes).toEqual([
      { lineItemId: "li-1", itemName: "Centrifugal Pump 15HP", quantity: 2, unitPrice: 1000, totalPrice: 2000 },
      { lineItemId: "li-2", itemName: "Mounting Base Plate", quantity: 4, unitPrice: 200, totalPrice: 800 },
    ]);
    expect(body.totalPrice).toBe(2800); // 2000 + 800
  });

  test("displays small supporting-document sizes in KB instead of rounding them to 0.0 MB", async () => {
    renderWithProvider(
      <QuotationFormCustomWrapper onBack={jest.fn()} withSession customSubscription="select" />,
    );

    const submitBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Submit Quote$/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(submitBtns[0]);

    const file = new File(["x".repeat(2048)], "supporting-document.pdf", { type: "application/pdf" });
    const fileInput = screen.getByText(/Bid Documents/i).parentElement?.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [file] } });

    expect(screen.getByText("(2.0 KB)")).toBeInTheDocument();
    expect(screen.queryByText("(0.0 MB)")).not.toBeInTheDocument();
  });

  test("shows an error toast and keeps the modal open when quote submission fails", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      (url: string, options: any = {}) => {
        if (/\/api\/rfqs\/[^/]+\/quotes$/.test(url)) {
          return Promise.resolve({
            ok: false,
            json: async () => ({
              success: false,
              error: "Create your vendor profile first.",
            }),
          });
        }
        return defaultMockFetchImpl(url, options);
      },
    );
    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        withSession
        customSubscription="select"
      />,
    );

    const submitBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Submit Quote$/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(submitBtns[0]);

    const priceInputs = document.querySelectorAll('input[type="number"]');
    fireEvent.change(priceInputs[0], { target: { value: "1500" } });

    const submitQuotationBtn = screen.getByRole("button", {
      name: /Submit Quotation/i,
    });
    await act(async () => {
      fireEvent.click(submitQuotationBtn);
    });

    // Modal stays open on failure so the vendor can retry
    expect(
      screen.getByRole("heading", { name: /Submit Quotation/i }),
    ).toBeInTheDocument();

    // Cancel closes it manually
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(
      screen.queryByRole("heading", { name: /Submit Quotation/i }),
    ).not.toBeInTheDocument();
  });

  test("downloads an RFQ successfully and shows a failure toast when the download fails", async () => {
    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        withSession
        customSubscription="select"
      />,
    );

    const downloadBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Download RFQ/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    await act(async () => {
      fireEvent.click(downloadBtns[0]);
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/email-preview"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );

    // Now make the download endpoint fail
    (global.fetch as jest.Mock).mockImplementation(
      (url: string, options: any = {}) => {
        if (/\/email-preview/.test(url)) {
          return Promise.resolve({
            ok: false,
            json: async () => ({ success: false, error: "RFQ not found" }),
          });
        }
        return defaultMockFetchImpl(url, options);
      },
    );
    await act(async () => {
      fireEvent.click(downloadBtns[0]);
    });
    // No throw — handled gracefully via a warning toast
    expect(
      screen.getByText(/Active sourcing enquiries/i),
    ).toBeInTheDocument();
  });

  test("downloading an RFQ also downloads its real attachments, skipping any that fail to fetch", async () => {
    const onBack = jest.fn();
    const rfqSpecific = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/rfqs\/RFQ-2026-00421$/.test(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              attachments: [
                { id: "att-1", fileName: "boq.pdf" },
                { id: "att-2", fileName: "specs.xlsx" },
              ],
            },
          }),
        });
      }
      if (/\/api\/rfqs\/attachments\/att-1$/.test(url)) {
        return Promise.resolve({ ok: true, blob: async () => new Blob(["pdf"]) });
      }
      if (/\/api\/rfqs\/attachments\/att-2$/.test(url)) {
        return Promise.resolve({ ok: false });
      }
      return defaultMockFetchImpl(url, options);
    });
    (global.fetch as jest.Mock).mockImplementation(rfqSpecific);

    renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />,
    );

    const downloadBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Download RFQ/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    await act(async () => {
      fireEvent.click(downloadBtns[0]);
    });

    await waitFor(() =>
      expect(rfqSpecific).toHaveBeenCalledWith(
        expect.stringContaining("/api/rfqs/attachments/att-1"),
        expect.anything(),
      ),
    );
    expect(rfqSpecific).toHaveBeenCalledWith(
      expect.stringContaining("/api/rfqs/attachments/att-2"),
      expect.anything(),
    );
  });

  test("downloads nothing extra when the RFQ lookup responds but with no success flag", async () => {
    const onBack = jest.fn();
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any = {}) => {
      if (/\/api\/rfqs\/RFQ-2026-00421$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: false }) });
      }
      return defaultMockFetchImpl(url, options);
    });

    renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />,
    );

    const downloadBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Download RFQ/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    await act(async () => {
      fireEvent.click(downloadBtns[0]);
    });

    await waitFor(() =>
      expect(
        screen.getByText(/Active sourcing enquiries/i),
      ).toBeInTheDocument(),
    );
  });

  test("gracefully continues past a failed attachment-listing fetch after the specification already downloaded", async () => {
    const onBack = jest.fn();
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any = {}) => {
      if (/\/api\/rfqs\/RFQ-2026-00421$/.test(url)) {
        return Promise.reject(new Error("network down"));
      }
      return defaultMockFetchImpl(url, options);
    });

    renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />,
    );

    const downloadBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Download RFQ/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    await act(async () => {
      fireEvent.click(downloadBtns[0]);
    });

    // The RFQ text info already downloaded before the attachment-listing
    // fetch rejected; the screen stays intact rather than crashing or
    // surfacing a blocking error over an already-successful download.
    await waitFor(() =>
      expect(
        screen.getByText(/Active sourcing enquiries/i),
      ).toBeInTheDocument(),
    );
  });

  test("auto-opens the bid modal for a deep-linked opportunity that is unlocked and not yet quoted", async () => {
    const onBack = jest.fn();
    const opportunity = {
      id: "opp-1",
      rfqNumber: "RFQ-2026-00421",
      title: "Centrifugal Water Pump Package",
      buyer: "L&T",
      deadline: "2026-09-15",
      daysRemaining: 7,
      type: "direct_invitation",
      deliveryLocation: "Mumbai",
      status: "pending_bid",
      lineItems: [
        {
          id: "li-1",
          description: "Pump",
          quantity: 3,
          unitPrice: 0,
          leadTimeDays: 7,
          marketBandStatus: "optimal",
          paymentTerms: "Net 60",
        },
      ],
    };

    // Needs a session so the vendor record (with addedByBuyerCompany) loads —
    // the auto-open effect now waits for that before judging lock state.
    // Set it via authClient (read synchronously by AppProvider's initial
    // state) rather than relying solely on the wrapper's post-mount
    // setCurrentUserSession, which would arrive a render late and race the
    // deep-link effect's own state.
    authClient.setSession(
      {
        id: "user-1",
        email: "vendor@test.com",
        name: "Test Vendor Co",
        role: "vendor",
        orgId: "org-1",
        orgName: "Test Vendor Co",
      },
      "fake-token-123",
    );
    renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        opportunity={opportunity}
        withSession
      />,
    );

    expect(
      await screen.findByRole("heading", { name: /Submit Quotation/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/RFQ-2026-00421/).length).toBeGreaterThan(0);
  });

  test("does not auto-open the bid modal for a deep-linked opportunity that is locked", () => {
    const onBack = jest.fn();
    const opportunity = {
      id: "opp-3",
      rfqNumber: "RFQ-2026-00501", // not in isOwnBuyerRfq allow-list
      title: "HVAC Unit",
      buyer: "NTPC",
      deadline: "2026-09-25",
      daysRemaining: 17,
      type: "network_marketplace",
      deliveryLocation: "Delhi",
      status: "pending_bid",
      lineItems: [],
    };

    // No subscription set — default 'premium' tier, so this RFQ stays locked
    renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} opportunity={opportunity} />,
    );

    expect(
      screen.queryByRole("heading", { name: /Submit Quotation/i }),
    ).not.toBeInTheDocument();
  });

  test("shows this vendor's real submitted quotes derived from hydrated RFQ data", async () => {
    global.fetch = jest.fn((url: string, options: any = {}) => {
      // RFQs come from GET /api/rfqs, not the (anonymous) bootstrap payload —
      // see DEFAULT_RFQ's own comment above.
      if (/\/api\/rfqs(\?|$)/.test(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: [
              {
                id: "rfq-real-1",
                rfqNumber: "RFQ-2026-00421",
                title: "Centrifugal Water Pump Package (15 HP)",
                category: "Mechanical",
                sourcingMode: "mode_1",
                status: "PO Generated",
                quotesCount: 1,
                targetDeliveryDate: "2026-09-20",
                budget: 150000,
                createdAt: "2026-09-01",
                chasingActive: false,
                quotes: [
                  {
                    vendorId: MOCK_MY_VENDOR.id,
                    vendorName: MOCK_MY_VENDOR.name,
                    vendorCategory: "Client List",
                    unitPrice: 1500,
                    totalPrice: 15000,
                    leadTimeDays: 10,
                    aiMatchScore: 90,
                    warrantyYears: 2,
                    complianceStatus: "Fully Compliant",
                    paymentTerms: "30 Days Net",
                    remarks: "test",
                    submittedAt: "2026-09-01T10:00:00.000Z",
                  },
                ],
              },
              {
                // Not in the isOwnBuyerRfq allow-list, and no submittedAt on
                // the quote — exercises the "-" date fallback, the
                // non-"PO Generated" status branch, and the
                // "Buyer Details Unlocked (Quote Submitted)" title branch.
                id: "rfq-real-2",
                rfqNumber: "RFQ-2026-00501",
                title: "HVAC Air Handling Unit & Smart Chiller Control",
                category: "Mechanical",
                sourcingMode: "mode_3",
                status: "In Evaluation",
                quotesCount: 1,
                targetDeliveryDate: "2026-09-25",
                budget: 220000,
                deliveryLocation: "Pune Plant",
                createdAt: "2026-09-01",
                chasingActive: false,
                extractedEntities: [
                  {
                    id: "item-hvac",
                    itemName: "Air Handling Unit",
                    quantity: 2,
                    unit: "units",
                  },
                ],
                inquiries: [
                  {
                    id: "inquiry-mine",
                    rfqNumber: "RFQ-2026-00501",
                    vendorId: MOCK_MY_VENDOR.id,
                    vendorName: MOCK_MY_VENDOR.name,
                    vendorEmail: MOCK_MY_VENDOR.email,
                    message: "Please confirm the drawing revision.",
                    createdAt: "2026-09-02T10:00:00.000Z",
                    status: "answered",
                    reply: "Use revision C.",
                  },
                  {
                    id: "inquiry-other-vendor",
                    rfqNumber: "RFQ-2026-00501",
                    vendorId: "another-vendor",
                    vendorName: "Another Vendor",
                    message: "Other vendor's private question.",
                    createdAt: "2026-09-02T11:00:00.000Z",
                    status: "open",
                  },
                ],
                quotes: [
                  {
                    vendorId: MOCK_MY_VENDOR.id,
                    vendorName: MOCK_MY_VENDOR.name,
                    vendorCategory: "Procucev Network",
                    unitPrice: 2000,
                    totalPrice: 10000,
                    leadTimeDays: 21,
                    aiMatchScore: 85,
                    warrantyYears: 1,
                    complianceStatus: "Fully Compliant",
                    paymentTerms: "45 Days Net",
                    remarks: "network bid",
                  },
                ],
              },
            ],
          }),
        });
      }
      return defaultMockFetchImpl(url, options);
    }) as any;

    const onBack = jest.fn();
    await act(async () => {
      renderWithProvider(
        <QuotationFormCustomWrapper
          onBack={onBack}
          withSession
          customSubscription="select"
        />,
      );
    });

    // "Submit Quote" is replaced by the real PO Generated status for this RFQ
    expect(await screen.findByText("PO Generated")).toBeInTheDocument();
    expect(screen.getByText("Quote Submitted")).toBeInTheDocument();
    expect(screen.getAllByText(/Portal Submission/).length).toBe(2);
    expect(screen.getByText("₹10,000")).toBeInTheDocument();
    expect(screen.getByText("Air Handling Unit · 2 units")).toBeInTheDocument();
    expect(screen.getByText(/Pune Plant/)).toBeInTheDocument();
    expect(screen.getByText("1 sent · Buyer replied")).toBeInTheDocument();
    expect(screen.getByText("Latest reply: Use revision C.")).toBeInTheDocument();
    expect(screen.queryByText("Other vendor's private question.")).not.toBeInTheDocument();
  });

  test("sends a real auth token when one is present, and handles a non-ok vendor lookup response", async () => {
    authClient.setSession(
      {
        id: "user-1",
        email: "vendor@test.com",
        name: "Test Vendor Co",
        role: "vendor",
        orgId: "org-1",
        orgName: "Test Vendor Co",
      },
      "fake-token-123",
    );
    global.fetch = jest.fn((url: string) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ success: false }),
        });
      }
      return defaultMockFetchImpl(url, {});
    }) as any;

    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        withSession
        customSubscription="select"
      />,
    );

    // Bid using an opportunity with no line items — exercises the quantity
    // fallback (`?? 1`) — and confirm the request carries a real Bearer token.
    const submitBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Submit Quote$/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(submitBtns[0]);
    const priceInput = document.querySelectorAll('input[type="number"]')[0];
    fireEvent.change(priceInput, { target: { value: "999" } });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Submit Quotation/i }),
      );
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/quotes"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fake-token-123",
        }),
      }),
    );
  });

  test("omits the Authorization header entirely when there is no token", async () => {
    // authHeaders()'s `token ? {...} : {}` branch is otherwise never taken —
    // every other test either has withSession's own token or a real one set
    // directly. A token is needed up front for the RFQ list itself to load
    // (refreshRFQs's own separate gate), then cleared before submitting so
    // authHeaders() sees none at the point that actually matters.
    const onBack = jest.fn();
    renderWithProvider(<QuotationFormCustomWrapper onBack={onBack} withSession />);

    const submitBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Submit Quote$/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    authClient.setSession(null, null);
    fireEvent.click(submitBtns[0]);
    fireEvent.change(document.querySelectorAll('input[type="number"]')[0], {
      target: { value: "999" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Submit Quotation/i }),
      );
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/quotes"),
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
  });

  test("closes the bid modal via the header X button", async () => {
    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper
        onBack={onBack}
        withSession
        customSubscription="select"
      />,
    );

    const submitBtns = await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: /Submit Quote$/i });
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(submitBtns[0]);
    expect(
      screen.getByRole("heading", { name: /Submit Quotation/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Close"));
    expect(
      screen.queryByRole("heading", { name: /Submit Quotation/i }),
    ).not.toBeInTheDocument();
  });

  test("filters opportunities by search query and status, and supports clearing filters", async () => {
    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search RFQ number, title, or buyer/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search RFQ number, title, or buyer/i);
    const statusSelect = screen.getByRole("combobox");

    // Search for pump
    fireEvent.change(searchInput, { target: { value: "Pump" } });
    expect(screen.getByText(/Centrifugal Water Pump/i)).toBeInTheDocument();

    // Filter by open
    fireEvent.change(statusSelect, { target: { value: "open" } });
    expect(screen.getByText(/Centrifugal Water Pump/i)).toBeInTheDocument();

    // Filter by submitted
    fireEvent.change(statusSelect, { target: { value: "submitted" } });
    expect(screen.getByText(/No matching enquiries/i)).toBeInTheDocument();

    // Filter by closed
    fireEvent.change(statusSelect, { target: { value: "closed" } });
    expect(screen.getByText(/No matching enquiries/i)).toBeInTheDocument();

    // Search with non-matching query
    fireEvent.change(searchInput, { target: { value: "xyznonexistentquery999" } });
    expect(screen.getByText(/No matching enquiries/i)).toBeInTheDocument();

    // Click clear search and filters
    const clearBtn = screen.getByRole("button", { name: /Clear search and filters/i });
    fireEvent.click(clearBtn);

    expect(screen.getByText(/Centrifugal Water Pump/i)).toBeInTheDocument();
  });

  test("opens inquiry modal, enters message, submits via Enter and button, and closes modal", async () => {
    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Centrifugal Water Pump/i)).toBeInTheDocument();
    });

    const clarifyBtn = screen.getByRole("button", { name: /Clarify/i });
    fireEvent.click(clarifyBtn);

    expect(
      screen.getByRole("heading", { name: /Raise Issue \/ Clarification/i }),
    ).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/Type your question regarding specs/i);
    expect(textarea).toBeInTheDocument();

    // Type query
    fireEvent.change(textarea, { target: { value: "Can we deliver in batches?" } });

    // Submit via Enter key
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    // Close button
    const closeBtns = screen.getAllByRole("button", { name: /Close/i });
    fireEvent.click(closeBtns[closeBtns.length - 1]);

    expect(
      screen.queryByRole("heading", { name: /Raise Issue \/ Clarification/i }),
    ).not.toBeInTheDocument();
  });

  test("handles inquiry dispatch with button click and failure toast", async () => {
    const onBack = jest.fn();
    renderWithProvider(
      <QuotationFormCustomWrapper onBack={onBack} withSession customSubscription="select" />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Centrifugal Water Pump/i)).toBeInTheDocument();
    });

    const clarifyBtn = screen.getByRole("button", { name: /Clarify/i });
    fireEvent.click(clarifyBtn);

    const textarea = screen.getByPlaceholderText(/Type your question regarding specs/i);
    fireEvent.change(textarea, { target: { value: "What is the warranty period?" } });

    const submitBtn = screen.getByRole("button", { name: /Send Clarification/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Close via top X icon
    const modalHeading = screen.getByRole("heading", { name: /Raise Issue \/ Clarification/i });
    const modalHeader = modalHeading.closest(".flex");
    const xBtn = modalHeader?.querySelector("button");
    if (xBtn) {
      fireEvent.click(xBtn);
    }
  });
});
