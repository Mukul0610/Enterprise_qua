import React from 'react';
import * as XLSX from 'xlsx';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ItemCatalogue from '@/app/vendor/item-catalogue';
import { AppProvider, useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

function catalogueWorkbookFile(sku = 'SKU-IMPORT-1'): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Product Name', 'SKU', 'Category', 'Specifications', 'Unit Price', 'Lead Time Days', 'MOQ'],
    ['Imported Pump', sku, 'Engineering Spares - Mechanical', '15 HP', 500, 7, 2],
  ]), 'Catalogue');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], 'catalogue.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// item-catalogue.tsx now calls the real backend for add/edit/delete/bulk
// import (BUGS.md #24) instead of only touching local state — mock a
// generically-successful backend so these UI-focused tests don't need a
// running server.
function mockFetchImpl(url: string, options: any = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  if (url === '/api/catalogue' && method === 'POST') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: `prod-${Math.random().toString(36).slice(2)}`, ...body } }) });
  }
  if (/\/api\/catalogue\/[^/]+$/.test(url) && method === 'PUT') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: url.split('/').pop(), ...body } }) });
  }
  if (/\/api\/catalogue\/[^/]+$/.test(url) && method === 'DELETE') {
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  }
  if (/\/api\/vendors\/[^/]+$/.test(url)) {
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false, error: 'Not found' }) });
  }
  // A single RFQ whose title overlaps enough tokens with the catalogue
  // product added in "Product Add, Edit, Delete..." below to exercise
  // getMatchingRfqsForProduct's positive-match branch, not just the
  // zero-match one the dedicated filter test covers.
  if (/\/api\/rfqs(\?|$)/.test(url) && method === 'GET') {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'rfq-catalogue-match',
            rfqNumber: 'RFQ-2026-00930',
            title: 'Centrifugal Water Pumps & Spares',
            buyerAccountName: 'Larsen & Toubro Ltd. (L&T)',
            category: 'Pumps & Fluid Dynamics',
            sourcingMode: 'mode_1',
            status: 'Quotes Pending',
            createdAt: '2026-09-01',
            targetDeliveryDate: '2026-09-15',
            budget: 50000,
            extractedEntities: [],
            quotes: [],
          },
        ],
      }),
    });
  }
  return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
}

function ItemCatalogueWithSession() {
  const { setCurrentUserSession } = useApp();
  React.useEffect(() => {
    setCurrentUserSession({
      id: 'user-1',
      email: 'vendor@test.com',
      name: 'Test Vendor',
      role: 'vendor',
      orgId: 'org-1',
      orgName: 'Test Vendor Co',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <ItemCatalogue />;
}

function ItemCatalogueCustomWrapper({
  customSubscription = 'select',
  customCatalogue = [],
}: {
  customSubscription?: any;
  customCatalogue?: any[];
}) {
  const { setVendorSubscription, setVendorCatalogue } = useApp();

  React.useEffect(() => {
    setVendorSubscription(customSubscription);
    if (customCatalogue.length > 0) {
      setVendorCatalogue(customCatalogue);
    }
  }, [setVendorSubscription, setVendorCatalogue, customSubscription, customCatalogue]);

  return <ItemCatalogue />;
}

describe('ItemCatalogue Comprehensive Suite', () => {
  afterEach(() => {
    authClient.setSession(null, null);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(mockFetchImpl) as any;
  });

  test('Form Validation Edge Cases: Empty fields, invalid Price, invalid Lead Time, invalid MOQ', async () => {
    renderWithProvider(<ItemCatalogue />);

    const form = document.querySelector('form')!;

    // 1. Submit with empty fields
    await act(async () => {
      fireEvent.submit(form);
    });

    // 2. Fill Name & SKU but leave others blank
    const nameInput = screen.getByPlaceholderText(/e.g. Centrifugal Water Pump/i);
    const skuInput = screen.getByPlaceholderText('SKU-PUMP-500');
    fireEvent.change(nameInput, { target: { value: 'High Pressure Pump' } });
    fireEvent.change(skuInput, { target: { value: 'SKU-HP-100' } });
    await act(async () => {
      fireEvent.submit(form);
    });

    // 3. Invalid unit price (e.g. -10)
    const priceInput = screen.getByPlaceholderText('850');
    const leadTimeInput = screen.getByPlaceholderText('5');
    const moqInput = screen.getByPlaceholderText('10');

    fireEvent.change(priceInput, { target: { value: '-10' } });
    fireEvent.change(leadTimeInput, { target: { value: '7' } });
    fireEvent.change(moqInput, { target: { value: '5' } });
    await act(async () => {
      fireEvent.submit(form);
    });

    // 4. Invalid lead time (e.g. 0)
    fireEvent.change(priceInput, { target: { value: '250' } });
    fireEvent.change(leadTimeInput, { target: { value: '0' } });
    await act(async () => {
      fireEvent.submit(form);
    });

    // 5. Invalid MOQ (e.g. -2)
    fireEvent.change(leadTimeInput, { target: { value: '5' } });
    fireEvent.change(moqInput, { target: { value: '-2' } });
    await act(async () => {
      fireEvent.submit(form);
    });
  });

  test('Product Add, Edit, Delete, Reset Form, and Search Filter flow', async () => {
    // vendorOpportunities (read by getMatchingRfqsForProduct below) only
    // loads once refreshRFQs sees a token — the previous test's afterEach
    // clears authClient's session, so this needs its own.
    authClient.setSession(null, 'test-token-item-catalogue');
    renderWithProvider(<ItemCatalogue />);

    const form = document.querySelector('form')!;
    const nameInput = screen.getByPlaceholderText(/e.g. Centrifugal Water Pump/i);
    const skuInput = screen.getByPlaceholderText('SKU-PUMP-500');
    const specsInput = screen.getByPlaceholderText(/Details of materials, sizes/i);
    const priceInput = screen.getByPlaceholderText('850');
    const leadTimeInput = screen.getByPlaceholderText('5');
    const moqInput = screen.getByPlaceholderText('10');
    const categorySelect = screen.getByDisplayValue(/Pumps & Fluid/i);

    // Add a matching RFQ product to trigger matching word comparison and tooltip
    fireEvent.change(nameInput, { target: { value: 'Centrifugal Water Pump with 15 HP Electric Motor' } });
    fireEvent.change(categorySelect, { target: { value: 'Pumps & Fluid Dynamics' } });
    fireEvent.change(skuInput, { target: { value: 'SKU-PUMP-MATCH' } });
    fireEvent.change(specsInput, { target: { value: 'Centrifugal industrial water pump with impeller' } });
    fireEvent.change(priceInput, { target: { value: '1200' } });
    fireEvent.change(leadTimeInput, { target: { value: '7' } });
    fireEvent.change(moqInput, { target: { value: '2' } });
    await act(async () => {
      fireEvent.submit(form);
    });

    // Add a new product
    fireEvent.change(nameInput, { target: { value: 'Stainless Steel Flange Adapter' } });
    fireEvent.change(categorySelect, { target: { value: 'Pipes & Fittings' } });
    fireEvent.change(skuInput, { target: { value: 'SKU-FLG-SS304' } });
    fireEvent.change(specsInput, { target: { value: 'SS304 Class 150 flanged 4-inch adapter' } });
    fireEvent.change(priceInput, { target: { value: '450' } });
    fireEvent.change(leadTimeInput, { target: { value: '14' } });
    fireEvent.change(moqInput, { target: { value: '10' } });

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(screen.getByText('SKU-FLG-SS304')).toBeInTheDocument();

    // Edit the product
    const editBtns = screen.getAllByTitle('Edit Product');
    if (editBtns.length > 0) {
      fireEvent.click(editBtns[0]);
    }

    expect(screen.getByRole('button', { name: /Update Item/i })).toBeInTheDocument();

    // Change price and save
    fireEvent.change(screen.getByPlaceholderText('850'), { target: { value: '499' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Update Item/i }));
    });

    // Reset Form / Cancel Editing
    const editBtnsAgain = screen.getAllByTitle('Edit Product');
    if (editBtnsAgain.length > 0) {
      fireEvent.click(editBtnsAgain[0]);
      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);
    }

    // Search and RFQ Filter
    const searchInput = screen.getByPlaceholderText(/Search SKU, name, specs/i);
    fireEvent.change(searchInput, { target: { value: 'SS304' } });
    expect(screen.getByText('SKU-FLG-SS304')).toBeInTheDocument();

    // Search for nonexistent term
    fireEvent.change(searchInput, { target: { value: 'NonExistentItemXYZ' } });
    expect(screen.queryByText('SKU-FLG-SS304')).not.toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: '' } });

    // Toggle filter matching open RFQs
    const rfqFilterToggle = screen.getByRole('button', { name: /Summary:/i });
    fireEvent.click(rfqFilterToggle);
    fireEvent.click(rfqFilterToggle);

    // Delete the product
    const deleteBtns = screen.getAllByTitle('Delete Product');
    if (deleteBtns.length > 0) {
      await act(async () => {
        fireEvent.click(deleteBtns[0]);
      });
    }
  });

  test('Excel import uses uploaded workbook and enforces the client capacity limit', async () => {
    const { unmount } = renderWithProvider(<ItemCatalogue />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Upload catalogue Excel workbook/i), {
        target: { files: [catalogueWorkbookFile()] },
      });
    });
    expect(await screen.findByText('Ready to import')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Import Valid Rows/i })));
    expect(await screen.findByText('SKU-IMPORT-1')).toBeInTheDocument();
    unmount();

    // 2. Test 95% capacity gradient bar (>90% red) and limit behavior
    const mock95Catalogue = Array.from({ length: 95 }, (_, i) => ({
      id: `prod-95-${i}`,
      name: `Pump Item ${i}`,
      category: 'Pumps & Fluid Dynamics',
      sku: `SKU-PUMP-95-${i}`,
      specs: '95 percent test pump item',
      unitPrice: 150,
      leadTimeDays: 4,
      moq: 1,
    }));

    const { unmount: unmount95 } = renderWithProvider(
      <ItemCatalogueCustomWrapper customSubscription="select" customCatalogue={mock95Catalogue} />
    );

    // Filter by matching RFQs when multiple products have matches
    const rfqSummaryBtn = screen.getByRole('button', { name: /Summary:/i });
    fireEvent.click(rfqSummaryBtn);
    fireEvent.click(rfqSummaryBtn);

    unmount95();

    // 3. Test bulk import and Add product when capacity is at 100 items (MAX_LIMIT)
    const mockFullCatalogue = Array.from({ length: 100 }, (_, i) => ({
      id: `prod-full-${i}`,
      name: `Full Product Item ${i}`,
      category: 'Pipes & Fittings',
      sku: `SKU-FULL-${i}`,
      specs: 'Full test item',
      unitPrice: 100,
      leadTimeDays: 5,
      moq: 1,
    }));

    const { unmount: unmountFull } = renderWithProvider(
      <ItemCatalogueCustomWrapper customCatalogue={mockFullCatalogue} />
    );

    // Attempt adding single product at limit
    fireEvent.change(screen.getByPlaceholderText(/e.g. Centrifugal Water Pump/i), { target: { value: 'Extra Item' } });
    fireEvent.change(screen.getByPlaceholderText('SKU-PUMP-500'), { target: { value: 'SKU-EXTRA' } });
    fireEvent.change(screen.getByPlaceholderText('850'), { target: { value: '100' } });
    fireEvent.change(screen.getByPlaceholderText('5'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('10'), { target: { value: '2' } });

    const formFull = document.querySelector('form')!;
    fireEvent.submit(formFull);
    unmountFull();

    // 4. Test 75% capacity gradient bar branch (> 70%) and standard subscription
    const mock75Catalogue = Array.from({ length: 75 }, (_, i) => ({
      id: `prod-75-${i}`,
      name: `75% Product ${i}`,
      category: 'Pumps & Fluid Dynamics',
      sku: `SKU-75-${i}`,
      specs: '75 percent test item',
      unitPrice: 100,
      leadTimeDays: 5,
      moq: 1,
    }));

    renderWithProvider(
      <ItemCatalogueCustomWrapper customSubscription="standard" customCatalogue={mock75Catalogue} />
    );

    expect(screen.getByText(/Select Model Required/i)).toBeInTheDocument();
  });

  test('loads the catalogue for a logged-in vendor (successful GET .../vendors and .../catalogue)', async () => {
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'v-session-1' } }) });
      }
      if (/\/api\/catalogue\?vendorId=/.test(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [{ id: 'prod-s1', name: 'Loaded Product', category: 'Valves & Flow Control', sku: 'SKU-LOADED-1', specs: 'test', unitPrice: 10, leadTimeDays: 5, moq: 1 }] }),
        });
      }
      return mockFetchImpl(url, options);
    }) as any;

    await act(async () => {
      renderWithProvider(<ItemCatalogueWithSession />);
    });

    expect(await screen.findByText('SKU-LOADED-1')).toBeInTheDocument();
  });

  test('handles a 404 vendor lookup and a network failure while loading the catalogue', async () => {
    // Case A: vendor lookup 404s -> catalogue stays empty, no throw
    global.fetch = jest.fn((url: string) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
    }) as any;
    const { unmount } = await act(async () => renderWithProvider(<ItemCatalogueWithSession />));
    expect(screen.getByText(/Product Catalogue Management/i)).toBeInTheDocument();
    unmount();

    // Case B: network failure on the vendor lookup itself
    global.fetch = jest.fn(() => Promise.reject(new Error('network down'))) as any;
    await act(async () => renderWithProvider(<ItemCatalogueWithSession />));
    expect(screen.getByText(/Product Catalogue Management/i)).toBeInTheDocument();
  });

  test('shows failure toasts when add and catalogue import fail at the network level', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as any;
    renderWithProvider(<ItemCatalogue />);

    // Add product -> outer catch branch
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Centrifugal Water Pump/i), { target: { value: 'Offline Item' } });
    fireEvent.change(screen.getByPlaceholderText('SKU-PUMP-500'), { target: { value: 'SKU-OFFLINE' } });
    fireEvent.change(screen.getByPlaceholderText('850'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('5'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('10'), { target: { value: '1' } });
    const form = document.querySelector('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });
    // Product was not added since the network call failed
    expect(screen.queryByText('SKU-OFFLINE')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Upload catalogue Excel workbook/i), {
      target: { files: [catalogueWorkbookFile('SKU-NETWORK-FAIL')] },
    });
    expect(await screen.findByText('Ready to import')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Valid Rows/i }));
    });
  });

  test('deleting a product surfaces a failure toast when the request fails', async () => {
    // Seed one product via the custom wrapper (bypasses fetch), then fail the DELETE call
    renderWithProvider(
      <ItemCatalogueCustomWrapper
        customCatalogue={[{ id: 'prod-del-1', name: 'Delete Me', category: 'Valves & Flow Control', sku: 'SKU-DEL-1', specs: 'x', unitPrice: 5, leadTimeDays: 2, moq: 1 }]}
      />
    );
    global.fetch = jest.fn(() => Promise.reject(new Error('delete failed'))) as any;

    const deleteBtn = screen.getAllByTitle('Delete Product')[0];
    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    // Still present since the delete failed
    expect(screen.getByText('SKU-DEL-1')).toBeInTheDocument();
  });

  test('RFQ-match filter hides products with zero matching opportunities', () => {
    renderWithProvider(
      <ItemCatalogueCustomWrapper
        customCatalogue={[
          { id: 'prod-nomatch', name: 'Totally Unrelated Widget', category: 'Sensors & Instrumentation', sku: 'SKU-NOMATCH', specs: 'nothing like any RFQ title', unitPrice: 5, leadTimeDays: 2, moq: 1 },
        ]}
      />
    );

    const rfqFilterToggle = screen.getByRole('button', { name: /Summary:/i });
    fireEvent.click(rfqFilterToggle);
    expect(screen.queryByText('SKU-NOMATCH')).not.toBeInTheDocument();
  });

  test('leaves the catalogue empty when the vendor record has no id', async () => {
    global.fetch = jest.fn((url: string) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) }); // no id
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
    }) as any;

    await act(async () => renderWithProvider(<ItemCatalogueWithSession />));
    expect(screen.getByText(/Product Catalogue Management/i)).toBeInTheDocument();
  });

  test('surfaces server-side rejections (ok, but success:false) for add, edit, and delete', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: async () => ({ success: false, error: 'Rejected by server' }) })) as any;

    renderWithProvider(
      <ItemCatalogueCustomWrapper
        customCatalogue={[{ id: 'prod-e1', name: 'Editable Item', category: 'Valves & Flow Control', sku: 'SKU-EDIT-1', specs: '', unitPrice: 5, leadTimeDays: 2, moq: 1 }]}
      />
    );

    // Edit -> PUT rejected
    fireEvent.click(screen.getAllByTitle('Edit Product')[0]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Update Item/i }));
    });
    expect(screen.getByText('SKU-EDIT-1')).toBeInTheDocument(); // unchanged

    // Add -> POST rejected
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Centrifugal Water Pump/i), { target: { value: 'Rejected Item' } });
    fireEvent.change(screen.getByPlaceholderText('SKU-PUMP-500'), { target: { value: 'SKU-REJECTED' } });
    fireEvent.change(screen.getByPlaceholderText('850'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('5'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('10'), { target: { value: '1' } });
    await act(async () => {
      fireEvent.submit(document.querySelector('form')!);
    });
    expect(screen.queryByText('SKU-REJECTED')).not.toBeInTheDocument();

    // Delete -> DELETE rejected
    await act(async () => {
      fireEvent.click(screen.getAllByTitle('Delete Product')[0]);
    });
    expect(screen.getByText('SKU-EDIT-1')).toBeInTheDocument(); // still present

    // Excel import -> server-side rejection is shown and no product is added.
    fireEvent.change(screen.getByLabelText(/Upload catalogue Excel workbook/i), {
      target: { files: [catalogueWorkbookFile('SKU-SERVER-REJECTED')] },
    });
    expect(await screen.findByText('Ready to import')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Valid Rows/i }));
    });
    expect(screen.getByText('SKU-EDIT-1')).toBeInTheDocument();
  });

  test('leaves the catalogue empty when the vendor is found but the catalogue fetch itself fails', async () => {
    global.fetch = jest.fn((url: string) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'v-ok-1' } }) });
      }
      if (/\/api\/catalogue\?vendorId=/.test(url)) {
        return Promise.resolve({ ok: false, json: async () => ({ success: false, error: 'Catalogue fetch failed' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
    }) as any;

    await act(async () => renderWithProvider(<ItemCatalogueWithSession />));
    expect(screen.getByText(/Product Catalogue Management/i)).toBeInTheDocument();
  });

  test('sends a real auth token on a mutating request when one is present', async () => {
    authClient.setSession(
      { id: 'user-1', email: 'vendor@test.com', name: 'Test Vendor', role: 'vendor', orgId: 'org-1', orgName: 'Test Vendor Co' },
      'fake-token-xyz'
    );
    // Loads succeed normally; only inspecting the outgoing add-product request.
    global.fetch = jest.fn((url: string, options: any = {}) => {
      if (/\/api\/vendors\/[^/]+$/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'v-token-1' } }) });
      }
      if (/\/api\/catalogue\?vendorId=/.test(url)) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { id: 'prod-new-1', ...JSON.parse(options.body || '{}') } }) });
    }) as any;

    await act(async () => renderWithProvider(<ItemCatalogueWithSession />));

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Centrifugal Water Pump/i), { target: { value: 'Token Item' } });
    fireEvent.change(screen.getByPlaceholderText('SKU-PUMP-500'), { target: { value: 'SKU-TOKEN-1' } });
    fireEvent.change(screen.getByPlaceholderText('850'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('5'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('10'), { target: { value: '1' } });
    await act(async () => {
      fireEvent.submit(document.querySelector('form')!);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/catalogue',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fake-token-xyz' }) })
    );
  });
});
