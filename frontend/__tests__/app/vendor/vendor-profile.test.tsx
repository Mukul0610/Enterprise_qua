import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import VendorProfilePage from '@/app/vendor/vendor-profile';
import { AppProvider, useApp } from '@/lib/store';
import { CATEGORY_TAXONOMY_FIXTURE } from '../../../test-fixtures/categoryTaxonomy';

// vendor-profile.tsx now loads the logged-in vendor's real record from the
// backend on mount (starts blank otherwise — BUGS.md #22) and saves via real
// PUT/POST calls (BUGS.md #38) instead of local-only state. This mock vendor
// record mirrors the values the component used to hardcode as defaults, so
// most of the original test assertions still hold once the async load settles.
const MOCK_VENDOR = {
  id: 'v-test-1',
  name: 'Apex Supplies & Contracting Ltd.',
  brandName: 'Apex Flow Controls & Engineering',
  orgType: 'Private Limited',
  pan: 'AAACA9876K',
  gst: '27AAACA9876K1Z9',
  msme: 'UDYAM-MH-03-0048291',
  website: 'https://www.apexsupplies.com',
  annualTurnover: '₹ 85.4 Cr',
  factoryAddress: 'Plot 42, MIDC Industrial Area, Thane West',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400604',
  country: 'India',
  contactPerson: 'Vikram Malhotra',
  contactDesignation: 'Head of Sales & Business Development',
  email: 'vendor@apex.com',
  phone: '+91 98920 11420',
  clientMappedCategories: ['Bearings & Accessories', 'Pumps & Accessories'],
  vendorSelectedCategories: [
    'Bearings & Accessories',
    'Pumps & Accessories',
    'Pipes & Pipe Fittings',
    'Hoses, Valves & Fittings',
    'Fasteners',
    'Cables',
    'Panels',
  ],
};

function mockFetchImpl(url: string, options: any = {}) {
  const method = options.method || 'GET';
  // The category master is fetched from the database now rather than imported from
  // a bundled categories.json, so this suite has to serve it: the selector renders
  // straight from what the store loaded, and an unanswered request leaves it empty.
  // Matched before the vendor-category route below, whose pattern also ends in
  // '/categories'.
  if (url.includes('/api/buyer-profile/categories')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        count: CATEGORY_TAXONOMY_FIXTURE.length,
        data: CATEGORY_TAXONOMY_FIXTURE,
      }),
    });
  }
  if (/\/api\/vendors\/[^/]+\/categories$/.test(url)) {
    const body = options.body ? JSON.parse(options.body) : {};
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { ...MOCK_VENDOR, ...body } }) });
  }
  if (/\/api\/vendors\/[^/]+$/.test(url) && method === 'GET') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: MOCK_VENDOR }) });
  }
  if (/\/api\/vendors\/[^/]+$/.test(url) && method === 'PUT') {
    const body = options.body ? JSON.parse(options.body) : {};
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { ...MOCK_VENDOR, ...body } }) });
  }
  if (url === '/api/vendors' && method === 'POST') {
    const body = options.body ? JSON.parse(options.body) : {};
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { ...MOCK_VENDOR, ...body, id: 'v-test-new' } }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
}

function VendorProfileWithSession() {
  const { setCurrentUserSession } = useApp();
  React.useEffect(() => {
    setCurrentUserSession({
      id: 'user-1',
      email: 'vendor@apex.com',
      name: 'Vikram Malhotra',
      role: 'vendor',
      orgId: 'org-1',
      orgName: 'Apex Supplies & Contracting Ltd.',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <VendorProfilePage />;
}

const renderWithProvider = async () => {
  const utils = render(
    <AppProvider>
      <VendorProfileWithSession />
    </AppProvider>
  );
  // Wait for the profile-load effect (GET /api/vendors/:email) to settle
  await waitFor(() => expect(screen.getByDisplayValue('Apex Supplies & Contracting Ltd.')).toBeInTheDocument());
  return utils;
};

describe('VendorProfilePage Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(mockFetchImpl) as any;
  });

  test('Renders all sections, updates form inputs, and validates PAN / GST formats', async () => {
    const { unmount } = await renderWithProvider();

    expect(screen.queryByRole('heading', { name: /Vendor Supplier Profile/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Section 1: Supplier Tax & Business Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Works \/ Factory Address/i)).toBeInTheDocument();
    expect(screen.getByText(/Sales & RFQ Contact Person/i)).toBeInTheDocument();

    // 1. Legal Entity & Tax Form Inputs
    const companyInput = screen.getByDisplayValue('Apex Supplies & Contracting Ltd.');
    fireEvent.change(companyInput, { target: { value: 'Apex Industrial Solutions Pvt Ltd' } });

    const brandInput = screen.getByDisplayValue('Apex Flow Controls & Engineering');
    fireEvent.change(brandInput, { target: { value: 'Apex Flow Tech' } });

    const orgSelect = screen.getByDisplayValue('Private Limited Company');
    fireEvent.change(orgSelect, { target: { value: 'Public Limited' } });
    fireEvent.change(orgSelect, { target: { value: 'LLP' } });
    fireEvent.change(orgSelect, { target: { value: 'Partnership' } });
    fireEvent.change(orgSelect, { target: { value: 'Sole Proprietorship' } });
    fireEvent.change(orgSelect, { target: { value: 'Private Limited' } });

    // PAN validation
    const panInput = screen.getByDisplayValue('AAACA9876K');
    expect(screen.getByText('✓ Valid PAN')).toBeInTheDocument();
    fireEvent.change(panInput, { target: { value: 'INVALIDPAN' } });
    expect(screen.getByText('Invalid Format')).toBeInTheDocument();
    fireEvent.change(panInput, { target: { value: 'ABCDE1234F' } });
    expect(screen.getByText('✓ Valid PAN')).toBeInTheDocument();

    // GSTIN validation
    const gstInput = screen.getByDisplayValue('27AAACA9876K1Z9');
    expect(screen.getByText('✓ State 27 Verified')).toBeInTheDocument();
    fireEvent.change(gstInput, { target: { value: 'INVALIDGSTIN' } });
    expect(screen.getByText('Invalid GSTIN')).toBeInTheDocument();
    fireEvent.change(gstInput, { target: { value: '27ABCDE1234F1Z5' } });
    expect(screen.getByText('✓ State 27 Verified')).toBeInTheDocument();

    const msmeInput = screen.getByDisplayValue('UDYAM-MH-03-0048291');
    fireEvent.change(msmeInput, { target: { value: 'UDYAM-MH-03-9999999' } });

    const websiteInput = screen.getByDisplayValue('https://www.apexsupplies.com');
    fireEvent.change(websiteInput, { target: { value: 'https://www.apexflow.com' } });

    const turnoverInput = screen.getByDisplayValue('₹ 85.4 Cr');
    fireEvent.change(turnoverInput, { target: { value: '₹ 120 Cr' } });

    // 2. Factory / Works Address inputs
    const addressInput = screen.getByDisplayValue('Plot 42, MIDC Industrial Area, Thane West');
    fireEvent.change(addressInput, { target: { value: 'Plot 88, Rabale MIDC' } });

    const cityInput = screen.getByDisplayValue('Mumbai');
    fireEvent.change(cityInput, { target: { value: 'Navi Mumbai' } });

    const stateInput = screen.getByDisplayValue('Maharashtra');
    fireEvent.change(stateInput, { target: { value: 'Gujarat' } });

    const pinInput = screen.getByDisplayValue('400604');
    fireEvent.change(pinInput, { target: { value: '400701' } });

    const countryInput = screen.getByDisplayValue('India');
    fireEvent.change(countryInput, { target: { value: 'Bharat' } });

    // 3. Contact Person inputs
    const contactInput = screen.getByDisplayValue('Vikram Malhotra');
    fireEvent.change(contactInput, { target: { value: 'Rohan Sharma' } });

    const desigInput = screen.getByDisplayValue('Head of Sales & Business Development');
    fireEvent.change(desigInput, { target: { value: 'Director of Procurement' } });

    // Contact email is now pinned to the session's login email (read-only) —
    // it's the backend join key, freely editing it would silently not persist.
    const emailInput = screen.getByDisplayValue('vendor@apex.com');
    expect(emailInput).toBeDisabled();

    const phoneInput = screen.getByDisplayValue('+91 98920 11420');
    fireEvent.change(phoneInput, { target: { value: '+91 98200 99999' } });

    unmount();
  });

  test('Category selection: search, expand/collapse, alignment, toggle major, toggle minor, and limit enforcement', async () => {
    const { unmount } = await renderWithProvider();

    // Search categories (matches major)
    const searchInput = screen.getByPlaceholderText(/Search supply categories/i);
    fireEvent.change(searchInput, { target: { value: 'Mechanical' } });
    expect(screen.getByText('Engineering Spares - Mechanical')).toBeInTheDocument();

    // Search categories (matches minor)
    fireEvent.change(searchInput, { target: { value: 'Bearings' } });
    expect(screen.getByText('Engineering Spares - Mechanical')).toBeInTheDocument();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Unselect all minors in Electrical to remove Electrical from selectedMajor
    const cablesCheckbox = screen.getByRole('checkbox', { name: /Cables/i });
    const panelsCheckbox = screen.getByRole('checkbox', { name: /Panels/i });
    fireEvent.click(cablesCheckbox);
    fireEvent.click(panelsCheckbox);

    // Uncheck pipes, hoses, fasteners from Mechanical so only Bearings and Pumps remain -> triggers isAligned === true!
    const pipesCb = screen.getByRole('checkbox', { name: /Pipes & Pipe Fittings/i });
    const hosesCb = screen.getByRole('checkbox', { name: /Hoses, Valves & Fittings/i });
    const fastenersCb = screen.getByRole('checkbox', { name: /Fasteners/i });
    fireEvent.click(pipesCb);
    fireEvent.click(hosesCb);
    fireEvent.click(fastenersCb);

    // Expect aligned status to appear
    expect(screen.getByText(/✓ 100% Categories Aligned/i)).toBeInTheDocument();

    // Now click Cables checkbox when Electrical is NOT in selectedMajor (tests line 127)
    fireEvent.click(cablesCheckbox);

    // Expand Civil Construction & Raw Materials to get more checkboxes
    const allHeaders = screen.getAllByRole('heading', { level: 3 });
    const civilHeader = allHeaders.find(h => h.textContent?.includes('Civil') || h.textContent?.includes('Raw Material'));
    if (civilHeader) {
      fireEvent.click(civilHeader); // toggles major category
    }

    // Now select checkboxes up to 10 limit
    const allCheckboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    allCheckboxes.forEach((cb) => {
      if (!cb.checked) {
        fireEvent.click(cb);
      }
    });

    // When 10 are selected, click an unchecked checkbox (tests toggleMinorCategory limit reached toast)
    const uncheckedCb = allCheckboxes.find((cb) => !cb.checked);
    if (uncheckedCb) {
      fireEvent.click(uncheckedCb);
    }

    // When 10 are selected, click an unselected Major category (tests toggleMajorCategory remainingSlots <= 0 toast)
    const itHeader = screen.getByText('IT');
    fireEvent.click(itHeader);

    // Toggle off Mechanical Major (tests unselecting major category)
    const mechanicalMajorHeader = screen.getByText('Engineering Spares - Mechanical');
    fireEvent.click(mechanicalMajorHeader);

    unmount();
  });

  test('Form submission: validation error branches and successful save', async () => {
    const { unmount } = await renderWithProvider();

    const topSaveBtn = screen.getByRole('button', { name: /Save Supplier Profile/i });
    const bottomSaveBtn = screen.getByRole('button', { name: /Save & Reconcile Vendor Profile/i });

    // 1. Successful save via top button
    await act(async () => {
      fireEvent.click(topSaveBtn);
    });

    // 2. Successful save via bottom button
    await act(async () => {
      fireEvent.click(bottomSaveBtn);
    });

    // 3. Validation error: clear company name
    const companyInput = screen.getByDisplayValue('Apex Supplies & Contracting Ltd.');
    fireEvent.change(companyInput, { target: { value: '' } });
    fireEvent.click(topSaveBtn);

    // Reset company name, clear PAN
    fireEvent.change(companyInput, { target: { value: 'Apex Ltd' } });
    const panInput = screen.getByDisplayValue('AAACA9876K');
    fireEvent.change(panInput, { target: { value: '' } });
    fireEvent.click(topSaveBtn);

    // Reset PAN, clear GST
    fireEvent.change(panInput, { target: { value: 'AAACA9876K' } });
    const gstInput = screen.getByDisplayValue('27AAACA9876K1Z9');
    fireEvent.change(gstInput, { target: { value: '' } });
    fireEvent.click(topSaveBtn);

    unmount();
  });

  test('blocks save on invalid PAN format, invalid GST format, and zero selected categories', async () => {
    await renderWithProvider();
    const topSaveBtn = screen.getByRole('button', { name: /Save Supplier Profile/i });

    // Invalid (non-empty) PAN format
    const panInput = screen.getByDisplayValue('AAACA9876K');
    fireEvent.change(panInput, { target: { value: '1234567890' } });
    fireEvent.click(topSaveBtn);
    expect(screen.queryByText(/Profile Saved/i)).not.toBeInTheDocument();

    // Reset PAN, break GST format instead
    fireEvent.change(panInput, { target: { value: 'AAACA9876K' } });
    const gstInput = screen.getByDisplayValue('27AAACA9876K1Z9');
    fireEvent.change(gstInput, { target: { value: '1234567890123X' } });
    fireEvent.click(topSaveBtn);

    // Reset GST, uncheck every category
    fireEvent.change(gstInput, { target: { value: '27AAACA9876K1Z9' } });
    const checkedBoxes = screen.getAllByRole('checkbox').filter((cb) => (cb as HTMLInputElement).checked);
    checkedBoxes.forEach((cb) => fireEvent.click(cb));
    fireEvent.click(topSaveBtn);
  });

  test('blocks save when there is no active session', async () => {
    // Deliberately render without VendorProfileWithSession — no session ever
    // gets set, so the profile stays blank (no GET fires) but required
    // fields can still be filled in manually to reach the session check.
    render(
      <AppProvider>
        <VendorProfilePage />
      </AppProvider>
    );

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'No Session Co' } }); // Company Name

    const panInputs = inputs.filter((el) => (el as HTMLInputElement).maxLength === 10);
    if (panInputs.length > 0) fireEvent.change(panInputs[0], { target: { value: 'AAACA9876K' } });
    const gstInputs = screen.getAllByRole('textbox').filter((el) => (el as HTMLInputElement).maxLength === 15);
    if (gstInputs.length > 0) fireEvent.change(gstInputs[0], { target: { value: '27AAACA9876K1Z9' } });

    // Select a category so validation reaches the session check
    await waitFor(() => expect(screen.getByText('Engineering Spares - Mechanical')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Engineering Spares - Mechanical'));

    const saveBtn = screen.getByRole('button', { name: /Save Supplier Profile/i });
    fireEvent.click(saveBtn);
    expect(screen.queryByText(/Profile Saved/i)).not.toBeInTheDocument();
  });

  test('creates a new vendor record (POST) when none exists yet, and surfaces PUT/categories failures', async () => {
    // No existing record: GET 404s
    global.fetch = jest.fn((url: string, options: any = {}) => {
      const method = options.method || 'GET';
      if (/\/api\/vendors\/[^/]+\/categories$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { clientMappedCategories: [] } }) });
      }
      if (/\/api\/vendors\/[^/]+$/.test(url) && method === 'GET') {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false }) });
      }
      if (url === '/api/vendors' && method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'v-new-1' } }) });
      }
      return mockFetchImpl(url, options);
    }) as any;

    render(
      <AppProvider>
        <VendorProfileWithSession />
      </AppProvider>
    );

    // Blank form (no record found) — fill required fields and pick a category
    await waitFor(() => expect(screen.getByRole('button', { name: /Save Supplier Profile/i })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Engineering Spares - Mechanical')).toBeInTheDocument());
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Brand New Vendor Co' } });

    const panInputs = screen.getAllByRole('textbox').filter((el) => (el as HTMLInputElement).maxLength === 10);
    if (panInputs.length > 0) fireEvent.change(panInputs[0], { target: { value: 'AAACA9876K' } });
    const gstInputs = screen.getAllByRole('textbox').filter((el) => (el as HTMLInputElement).maxLength === 15);
    if (gstInputs.length > 0) fireEvent.change(gstInputs[0], { target: { value: '27AAACA9876K1Z9' } });

    // Select at least one category
    const mechanicalHeader = screen.getByText('Engineering Spares - Mechanical');
    fireEvent.click(mechanicalHeader);

    const saveBtn = screen.getByRole('button', { name: /Save Supplier Profile/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/vendors', expect.objectContaining({ method: 'POST' }));
  });

  test('surfaces a failure toast when PUT /api/vendors/:id fails on save', async () => {
    await renderWithProvider();
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any = {}) => {
      const method = options.method || 'GET';
      if (/\/api\/vendors\/[^/]+$/.test(url) && method === 'PUT') {
        return Promise.resolve({ ok: false, json: async () => ({ success: false, error: 'Save rejected' }) });
      }
      return mockFetchImpl(url, options);
    });

    const saveBtn = screen.getByRole('button', { name: /Save Supplier Profile/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(screen.queryByText(/Profile Saved/i)).not.toBeInTheDocument();
  });

  test('surfaces a failure toast when the categories PUT fails on save', async () => {
    await renderWithProvider();
    (global.fetch as jest.Mock).mockImplementation((url: string, options: any = {}) => {
      const method = options.method || 'GET';
      if (/\/api\/vendors\/[^/]+\/categories$/.test(url) && method === 'PUT') {
        return Promise.resolve({ ok: false, json: async () => ({ success: false, error: 'Category save rejected' }) });
      }
      return mockFetchImpl(url, options);
    });

    const saveBtn = screen.getByRole('button', { name: /Save Supplier Profile/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(screen.queryByText(/Profile Saved/i)).not.toBeInTheDocument();
  });

  test('leaves the form blank when the profile GET 404s (new vendor) or the network fails', async () => {
    // 404 case
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false }) });
      }
      return mockFetchImpl(url, options);
    }) as any;
    const { unmount } = render(
      <AppProvider>
        <VendorProfileWithSession />
      </AppProvider>
    );
    await waitFor(() => expect(screen.getByText(/Section 1: Supplier Tax & Business Details/i)).toBeInTheDocument());
    unmount();

    // Network failure case
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/api/buyer-profile/categories')) {
        return mockFetchImpl(url);
      }
      return Promise.reject(new Error('offline'));
    }) as any;
    render(
      <AppProvider>
        <VendorProfileWithSession />
      </AppProvider>
    );
    await waitFor(() => expect(screen.getByText(/Section 1: Supplier Tax & Business Details/i)).toBeInTheDocument());
  });

  test('surfaces a failure toast when creating a new vendor profile (POST) fails', async () => {
    global.fetch = jest.fn((url: string, options: any = {}) => {
      const method = options.method || 'GET';
      if (/\/api\/vendors\/[^/]+$/.test(url) && method === 'GET') {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false }) });
      }
      if (url === '/api/vendors' && method === 'POST') {
        return Promise.resolve({ ok: false, json: async () => ({ success: false, error: 'Create rejected' }) });
      }
      return mockFetchImpl(url, options);
    }) as any;

    render(
      <AppProvider>
        <VendorProfileWithSession />
      </AppProvider>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /Save Supplier Profile/i })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Engineering Spares - Mechanical')).toBeInTheDocument());
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'New Vendor Co' } });
    const panInputs = inputs.filter((el) => (el as HTMLInputElement).maxLength === 10);
    if (panInputs.length > 0) fireEvent.change(panInputs[0], { target: { value: 'AAACA9876K' } });
    const gstInputs = screen.getAllByRole('textbox').filter((el) => (el as HTMLInputElement).maxLength === 15);
    if (gstInputs.length > 0) fireEvent.change(gstInputs[0], { target: { value: '27AAACA9876K1Z9' } });
    fireEvent.click(screen.getByText('Engineering Spares - Mechanical'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Supplier Profile/i }));
    });
    expect(screen.queryByText(/Profile Saved/i)).not.toBeInTheDocument();
  });

  test('loads a sparse vendor record (most fields absent) and falls back to blanks', async () => {
    global.fetch = jest.fn((url: string) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        // Only id and name present — every other field's `|| ''` fallback
        // and the `if (v.orgType)` skip-branch should engage here.
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'v-sparse-1', name: 'Sparse Vendor Co' } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    }) as any;

    render(
      <AppProvider>
        <VendorProfileWithSession />
      </AppProvider>
    );

    await waitFor(() => expect(screen.getByDisplayValue('Sparse Vendor Co')).toBeInTheDocument());
    // Org type falls back to the component's own default since v.orgType is absent
    expect(screen.getByDisplayValue('Private Limited Company')).toBeInTheDocument();
  });
});
