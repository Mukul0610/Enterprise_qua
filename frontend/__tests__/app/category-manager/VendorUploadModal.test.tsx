import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import VendorUploadModal from '@/app/category-manager/VendorUploadModal';
import { useApp } from '@/lib/store';
import * as vendorUploadClient from '@/lib/vendorUploadClient';
import type { VendorUploadRow } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/vendorUploadClient', () => ({
  ...jest.requireActual('@/lib/vendorUploadClient'),
  parseVendorUploadFile: jest.fn(),
  bulkImportVendorRows: jest.fn(),
  downloadVendorUploadTemplate: jest.fn(),
}));

const mockShowToast = jest.fn();
const mockRefreshFromDB = jest.fn().mockResolvedValue(undefined);

function validRow(overrides: Partial<VendorUploadRow> = {}, n = 2): VendorUploadRow {
  return {
    rowNumber: n,
    vendor: { name: `Vendor ${n}`, email: `vendor${n}@example.com`, phone: '9876543210', gstin: '', city: 'Pune' },
    isValid: true,
    errors: [],
    missingEmail: false,
    ...overrides,
  };
}

function invalidRow(overrides: Partial<VendorUploadRow> = {}, n = 3): VendorUploadRow {
  return {
    rowNumber: n,
    vendor: { name: '', email: '', phone: '' },
    isValid: false,
    errors: ['Company name is required.'],
    missingEmail: true,
    ...overrides,
  };
}

function pickFile(file: File) {
  const input = screen.getByTestId('vendor-upload-file-input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('VendorUploadModal', () => {
  const onClose = jest.fn();
  const onImportComplete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshFromDB.mockResolvedValue(undefined);
    (useApp as jest.Mock).mockReturnValue({ showToast: mockShowToast, refreshFromDB: mockRefreshFromDB });
  });

  test('renders nothing when closed', () => {
    const { container } = render(<VendorUploadModal isOpen={false} onClose={onClose} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('downloads the template when the template button is clicked', () => {
    render(<VendorUploadModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByText('Download Vendor Master Template'));
    expect(vendorUploadClient.downloadVendorUploadTemplate).toHaveBeenCalledTimes(1);
  });

  test('rejects a non-.xlsx file client-side without ever calling the parser', () => {
    render(<VendorUploadModal isOpen onClose={onClose} />);
    const badFile = new File(['x'], 'vendors.csv', { type: 'text/csv' });
    pickFile(badFile);
    expect(mockShowToast).toHaveBeenCalledWith('Unsupported File Type', expect.any(String), 'warning');
    expect(vendorUploadClient.parseVendorUploadFile).not.toHaveBeenCalled();
  });

  test('rejects an oversized file client-side without ever calling the parser', () => {
    render(<VendorUploadModal isOpen onClose={onClose} />);
    const bigFile = new File(['x'], 'vendors.xlsx');
    Object.defineProperty(bigFile, 'size', { value: vendorUploadClient.MAX_VENDOR_UPLOAD_FILE_BYTES + 1 });
    pickFile(bigFile);
    expect(mockShowToast).toHaveBeenCalledWith('File Too Large', expect.any(String), 'warning');
    expect(vendorUploadClient.parseVendorUploadFile).not.toHaveBeenCalled();
  });

  test('shows a toast and stays on the select step when the parser reports an error', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: false,
      error: 'The file has duplicate column headers — each column must be unique.',
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'Could Not Read File',
        'The file has duplicate column headers — each column must be unique.',
        'warning'
      )
    );
    expect(screen.getByTestId('vendor-upload-dropzone')).toBeInTheDocument();
  });

  test('shows a toast when every row in the file was blank', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [], blankRowCount: 5 },
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('No Vendor Rows Found', expect.any(String), 'warning')
    );
  });

  test('advances to the preview step and shows total/valid/error counts on a successful parse', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2), invalidRow({}, 3)], blankRowCount: 1 },
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));

    await screen.findByText('vendors.xlsx');
    expect(screen.getByText('(1 blank row(s) skipped)')).toBeInTheDocument();
    expect(screen.getByText(/Import 2 Vendors/)).toBeInTheDocument();
    expect(screen.getByText(/\(1 with issues\)/)).toBeInTheDocument();
    expect(screen.getByText('Vendor 2')).toBeInTheDocument();
    expect(screen.getByText('Company name is required.')).toBeInTheDocument();
  });

  test('shows the Missing Email stat tile with the right count in the preview step', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        rows: [
          validRow({}, 2),
          validRow({ vendor: { name: 'No Email Co', email: '', phone: '9876543210' }, missingEmail: true }, 4),
          invalidRow({}, 3),
        ],
        blankRowCount: 0,
      },
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');

    expect(screen.getByText('Missing Email')).toBeInTheDocument();
    const tile = screen.getByText('Missing Email').closest('div');
    expect(tile).not.toBeNull();
    expect(within(tile!.parentElement as HTMLElement).getByText('1')).toBeInTheDocument();
  });

  test('highlights a missing-email row amber and badges it "No Email" in the preview table', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        rows: [validRow({ vendor: { name: 'No Email Co', email: '', phone: '9876543210' }, missingEmail: true }, 5)],
        blankRowCount: 0,
      },
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');

    expect(screen.getByText('No Email Co')).toBeInTheDocument();
    expect(screen.getAllByText('No Email').length).toBeGreaterThan(0);
    const row = screen.getByText('No Email Co').closest('tr');
    expect(row?.className).toContain('bg-amber-50');
  });

  test('filters the preview table between all/valid/invalid', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2), invalidRow({}, 3)], blankRowCount: 0 },
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');

    fireEvent.click(screen.getByRole('button', { name: 'valid' }));
    expect(screen.getByText('Vendor 2')).toBeInTheDocument();
    expect(screen.queryByText('Company name is required.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'invalid' }));
    expect(screen.queryByText('Vendor 2')).not.toBeInTheDocument();
    expect(screen.getByText('Company name is required.')).toBeInTheDocument();
  });

  test('paginates the preview table beyond 50 rows', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => validRow({}, i + 2));
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows, blankRowCount: 0 },
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Vendor 2')).toBeInTheDocument();
    expect(screen.queryByText('Vendor 55')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Vendor 55')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Previous'));
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Vendor 2')).toBeInTheDocument();
  });

  test('clicking the dropzone opens the native file picker via the hidden input', () => {
    render(<VendorUploadModal isOpen onClose={onClose} />);
    const input = screen.getByTestId('vendor-upload-file-input') as HTMLInputElement;
    // jsdom's real input.click() bubbles a click event back up to this same
    // dropzone, re-entering the handler — its own click()-in-progress guard
    // makes that a no-op, but the JS-level call is still observed by the spy,
    // so this asserts "at least once" rather than an exact count.
    const clickSpy = jest.spyOn(input, 'click');
    fireEvent.click(screen.getByTestId('vendor-upload-dropzone'));
    expect(clickSpy).toHaveBeenCalled();
  });

  test('the import button is enabled (imports issue rows too) even when there are zero valid rows', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [invalidRow({}, 2)], blankRowCount: 0 },
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');
    expect(screen.getByText(/Import 1 Vendor/)).not.toBeDisabled();
    expect(vendorUploadClient.bulkImportVendorRows).not.toHaveBeenCalled();
  });

  test('"Choose a Different File" resets back to the select step', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2)], blankRowCount: 0 },
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');

    fireEvent.click(screen.getAllByText(/Choose (a Different|Another) File/i)[0]);
    expect(screen.getByTestId('vendor-upload-dropzone')).toBeInTheDocument();
  });

  test('imports the valid rows only, shows progress, refreshes the store, and reports the real result', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2), invalidRow({}, 3)], blankRowCount: 0 },
    });
    let resolveImport: (v: unknown) => void = () => {};
    (vendorUploadClient.bulkImportVendorRows as jest.Mock).mockImplementation(
      (rows, onProgress) =>
        new Promise((resolve) => {
          onProgress?.({ total: 1, imported: 1, missingEmail: 0, duplicates: 0, failed: 0, results: [] });
          resolveImport = resolve;
        })
    );

    render(<VendorUploadModal isOpen onClose={onClose} onImportComplete={onImportComplete} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');

    fireEvent.click(screen.getByText(/Import 2 Vendors/));

    expect(vendorUploadClient.bulkImportVendorRows).toHaveBeenCalledWith(
      [expect.objectContaining({ rowNumber: 2 }), expect.objectContaining({ rowNumber: 3 })],
      expect.any(Function)
    );
    await screen.findByText('Importing vendors…');
    expect(
      screen.getByText('1 of 2 processed — 1 imported (0 missing email), 0 duplicate, 0 failed, 0 credential email(s) failed')
    ).toBeInTheDocument();

    resolveImport({
      total: 1,
      imported: 1,
      missingEmail: 0,
      duplicates: 0,
      failed: 0,
      results: [{ rowNumber: 2, status: 'imported' }],
    });

    await screen.findByText('Upload Completed');
    expect(screen.getByText('Total: 2 · Imported: 1 · Failed: 0 · Duplicates: 0')).toBeInTheDocument();
    expect(mockRefreshFromDB).toHaveBeenCalledTimes(1);
    expect(onImportComplete).toHaveBeenCalledTimes(1);
  });

  test('does not refresh the store or call onImportComplete when nothing was actually imported', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2)], blankRowCount: 0 },
    });
    (vendorUploadClient.bulkImportVendorRows as jest.Mock).mockResolvedValue({
      total: 1,
      imported: 0,
      missingEmail: 0,
      duplicates: 1,
      failed: 0,
      results: [{ rowNumber: 2, status: 'duplicate', email: 'vendor2@example.com' }],
    });

    render(<VendorUploadModal isOpen onClose={onClose} onImportComplete={onImportComplete} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');
    fireEvent.click(screen.getByText('Import 1 Vendor'));

    await screen.findByText('Upload Completed');
    expect(mockRefreshFromDB).not.toHaveBeenCalled();
    expect(onImportComplete).not.toHaveBeenCalled();
    expect(screen.getByText('Download Error Report')).toBeInTheDocument();
  });

  test('downloads a CSV error report listing failed/duplicate rows', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2)], blankRowCount: 0 },
    });
    (vendorUploadClient.bulkImportVendorRows as jest.Mock).mockResolvedValue({
      total: 1,
      imported: 0,
      missingEmail: 0,
      duplicates: 1,
      failed: 0,
      results: [{ rowNumber: 2, status: 'duplicate', email: 'vendor2@example.com', reason: 'Already exists' }],
    });

    const clickSpy = jest.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = jest.fn();
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = clickSpy;

    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');
    fireEvent.click(screen.getByText('Import 1 Vendor'));
    await screen.findByText('Upload Completed');

    fireEvent.click(screen.getByText('Download Error Report'));
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();

    HTMLAnchorElement.prototype.click = originalClick;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  test('"Upload Another File" from the result step resets back to select', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2)], blankRowCount: 0 },
    });
    (vendorUploadClient.bulkImportVendorRows as jest.Mock).mockResolvedValue({
      total: 1,
      imported: 1,
      missingEmail: 0,
      duplicates: 0,
      failed: 0,
      results: [{ rowNumber: 2, status: 'imported' }],
    });

    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');
    fireEvent.click(screen.getByText('Import 1 Vendor'));
    await screen.findByText('Upload Completed');

    fireEvent.click(screen.getByText('Upload Another File'));
    expect(screen.getByTestId('vendor-upload-dropzone')).toBeInTheDocument();
  });

  test('the close button and "Done" both close and reset the modal after a completed import', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2)], blankRowCount: 0 },
    });
    (vendorUploadClient.bulkImportVendorRows as jest.Mock).mockResolvedValue({
      total: 1,
      imported: 1,
      missingEmail: 0,
      duplicates: 0,
      failed: 0,
      results: [{ rowNumber: 2, status: 'imported' }],
    });

    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');
    fireEvent.click(screen.getByText('Import 1 Vendor'));
    await screen.findByText('Upload Completed');

    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the close button is disabled while an import is in flight, preventing teardown mid-import', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2)], blankRowCount: 0 },
    });
    (vendorUploadClient.bulkImportVendorRows as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');
    fireEvent.click(screen.getByText('Import 1 Vendor'));
    await screen.findByText('Importing vendors…');

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('cancelling the native file dialog (no file selected) does not attempt to parse', () => {
    render(<VendorUploadModal isOpen onClose={onClose} />);
    const input = screen.getByTestId('vendor-upload-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(vendorUploadClient.parseVendorUploadFile).not.toHaveBeenCalled();
  });

  test('dropping with no file attached is a no-op', () => {
    render(<VendorUploadModal isOpen onClose={onClose} />);
    fireEvent.drop(screen.getByTestId('vendor-upload-dropzone'), { dataTransfer: { files: [] } });
    expect(vendorUploadClient.parseVendorUploadFile).not.toHaveBeenCalled();
  });

  test('the CSV error report covers rows carrying an errors array as well as a bare reason, with or without an email', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2)], blankRowCount: 0 },
    });
    (vendorUploadClient.bulkImportVendorRows as jest.Mock).mockResolvedValue({
      total: 1,
      imported: 0,
      duplicates: 0,
      failed: 1,
      results: [{ rowNumber: 2, status: 'failed', errors: ['Server rejected the row.'] }],
    });

    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = jest.fn();
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = jest.fn();

    render(<VendorUploadModal isOpen onClose={onClose} />);
    pickFile(new File(['x'], 'vendors.xlsx'));
    await screen.findByText('vendors.xlsx');
    fireEvent.click(screen.getByText('Import 1 Vendor'));
    await screen.findByText('Upload Completed');

    expect(() => fireEvent.click(screen.getByText('Download Error Report'))).not.toThrow();

    HTMLAnchorElement.prototype.click = originalClick;
  });

  test('drag-and-drop onto the dropzone parses the dropped file', async () => {
    (vendorUploadClient.parseVendorUploadFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { rows: [validRow({}, 2)], blankRowCount: 0 },
    });
    render(<VendorUploadModal isOpen onClose={onClose} />);
    const dropzone = screen.getByTestId('vendor-upload-dropzone');
    const file = new File(['x'], 'dropped.xlsx');

    fireEvent.dragOver(dropzone);
    fireEvent.dragLeave(dropzone);
    fireEvent.dragOver(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await screen.findByText('dropped.xlsx');
    expect(vendorUploadClient.parseVendorUploadFile).toHaveBeenCalledWith(file);
  });
});
