import * as XLSX from 'xlsx';
import {
  bulkImportVendorRows,
  downloadVendorUploadTemplate,
  isAllowedVendorUploadFile,
  MAX_VENDOR_UPLOAD_FILE_BYTES,
  parseVendorUploadFile,
} from '@/lib/vendorUploadClient';
import { authClient } from '@/lib/authClient';
import type { VendorUploadRow } from '@/lib/types';

// Same MockFileReader technique as initial-setup-modal.test.tsx: jsdom's real
// File/Blob don't expose their bytes to FileReader synchronously in tests, so
// the file's real xlsx buffer is stashed on a __buffer property the mock reads.
class MockFileReader {
  onload: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;

  readAsArrayBuffer(file: any) {
    if (file.__error) {
      if (this.onerror) this.onerror(new Error('Read error'));
      return;
    }
    if (file.__corrupt) {
      if (this.onload) this.onload(null as any);
      return;
    }
    const buf = file.__buffer !== undefined ? file.__buffer : new ArrayBuffer(0);
    if (this.onload) this.onload({ target: { result: buf } });
  }
}

function xlsxFile(rows: Record<string, unknown>[], name = 'vendors.xlsx'): any {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook: XLSX.WorkBook = { Sheets: { Sheet1: worksheet }, SheetNames: ['Sheet1'] };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const file: any = new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  file.__buffer = buffer;
  return file;
}

describe('vendorUploadClient', () => {
  const originalFileReader = global.FileReader;

  beforeAll(() => {
    (global as any).FileReader = MockFileReader;
  });

  afterAll(() => {
    global.FileReader = originalFileReader;
  });

  describe('isAllowedVendorUploadFile', () => {
    test('accepts only .xlsx, case-insensitively', () => {
      expect(isAllowedVendorUploadFile(new File([], 'a.xlsx'))).toBe(true);
      expect(isAllowedVendorUploadFile(new File([], 'A.XLSX'))).toBe(true);
      expect(isAllowedVendorUploadFile(new File([], 'a.xls'))).toBe(false);
      expect(isAllowedVendorUploadFile(new File([], 'a.csv'))).toBe(false);
    });
  });

  describe('parseVendorUploadFile', () => {
    test('parses valid rows using the real Vendor Master column names', async () => {
      const file = xlsxFile([
        {
          'Company Name': 'Hydrocare Fluid Power Systems',
          'Person Name': 'Hydrocare',
          'Email Id': 'hydrocare.service@gmail.com',
          'Mobile No': '9243047807',
          GSTIN: '29AAAPL5929R1ZX',
          'Pin Code': '560047',
          City: 'Bengaluru',
          State: 'Karnataka',
          'Cate - 1': 'Hoses, Valves & Fittings',
          Products: 'Hydraulic Pumps, Valves',
        },
      ]);

      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.rows).toHaveLength(1);
      const row = result.data.rows[0];
      expect(row.isValid).toBe(true);
      expect(row.errors).toEqual([]);
      expect(row.vendor).toMatchObject({
        name: 'Hydrocare Fluid Power Systems',
        contactPerson: 'Hydrocare',
        email: 'hydrocare.service@gmail.com',
        phone: '9243047807',
        gstin: '29AAAPL5929R1ZX',
        pincode: '560047',
        city: 'Bengaluru',
        state: 'Karnataka',
        majorCategory: 'Hoses, Valves & Fittings',
      });
    });

    test('reports required-field errors without fabricating a fallback value', async () => {
      // A row where every mapped field is blank is dropped as a blank row entirely
      // (see the blank-row test below) — City carries a value so the row survives
      // into `rows` while still triggering the required-field checks. Email is no
      // longer a required-field error — see the missing-email test below.
      const file = xlsxFile([{ 'Company Name': '', 'Email Id': '', 'Mobile No': '', City: 'Mumbai' }]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data.rows[0];
      expect(row.isValid).toBe(false);
      expect(row.vendor.name).toBe('');
      expect(row.missingEmail).toBe(true);
      expect(row.errors).toEqual(expect.arrayContaining(['Company name is required.', 'Mobile number is required.']));
      expect(row.errors).not.toEqual(expect.arrayContaining(['Email is required.']));
    });

    test('a row with no email is not rejected — it is flagged missingEmail and stays valid', async () => {
      const file = xlsxFile([
        { 'Company Name': 'No Email Co', 'Email Id': '', 'Mobile No': '9876543210' },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data.rows[0];
      expect(row.missingEmail).toBe(true);
      expect(row.isValid).toBe(true);
      expect(row.errors).toEqual([]);
      expect(row.vendor.email).toBe('');
    });

    test('normalizes the "Phone number" and "Categorys" header aliases', async () => {
      const file = xlsxFile([
        {
          'Company Name': 'Alias Co',
          'Email Id': 'alias@example.com',
          'Phone number': '9876543210',
          Categorys: 'Fasteners',
        },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data.rows[0];
      expect(row.isValid).toBe(true);
      expect(row.vendor.phone).toBe('9876543210');
      expect(row.vendor.majorCategory).toBe('Fasteners');
    });

    test('flags an invalid email/phone/GSTIN/pincode format without rejecting the whole row silently', async () => {
      const file = xlsxFile([
        {
          'Company Name': 'Bad Data Co',
          'Email Id': 'not-an-email',
          'Mobile No': '12345',
          GSTIN: 'NOTAGSTIN',
          'Pin Code': '0abc',
        },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data.rows[0];
      expect(row.isValid).toBe(false);
      expect(row.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('valid email'),
          expect.stringContaining('10-digit'),
          expect.stringContaining('GSTIN'),
          expect.stringContaining('PIN code'),
        ])
      );
    });

    test('counts a fully blank row separately from parsed rows and does not report it as an error', async () => {
      const file = xlsxFile([
        { 'Company Name': 'Real Co', 'Email Id': 'real@example.com', 'Mobile No': '9876543210' },
        { 'Company Name': '', 'Email Id': '', 'Mobile No': '' },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.blankRowCount).toBe(1);
    });

    test('flags the second occurrence of a duplicate email within the same file', async () => {
      const file = xlsxFile([
        { 'Company Name': 'First Co', 'Email Id': 'dup@example.com', 'Mobile No': '9876543210' },
        { 'Company Name': 'Second Co', 'Email Id': 'dup@example.com', 'Mobile No': '9876543211' },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.rows[0].isValid).toBe(true);
      expect(result.data.rows[1].isValid).toBe(false);
      expect(result.data.rows[1].errors[0]).toContain('Duplicate email');
    });

    test('rejects a file with duplicate column headers', async () => {
      // XLSX itself disambiguates two identical header strings by appending
      // "_1", which would defeat this test — two headers that normalize to the
      // same key without being byte-identical ("Email Id" / "EMAIL ID") reach
      // parseVendorUploadFile's own normalized-duplicate check instead.
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['Email Id', 'EMAIL ID', 'Company Name'],
        ['a@b.com', 'x@y.com', 'Acme'],
      ]);
      const workbook: XLSX.WorkBook = { Sheets: { Sheet1: worksheet }, SheetNames: ['Sheet1'] };
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const file: any = new File([buffer], 'dup-headers.xlsx');
      file.__buffer = buffer;

      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('duplicate column headers');
    });

    test('rejects a file with none of the expected columns', async () => {
      const file = xlsxFile([{ Foo: 'bar', Baz: 'qux' }]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('Vendor Master Template');
    });

    test('reports an empty workbook as an error', async () => {
      const worksheet = XLSX.utils.json_to_sheet([]);
      const workbook: XLSX.WorkBook = { Sheets: { Sheet1: worksheet }, SheetNames: ['Sheet1'] };
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const file: any = new File([buffer], 'empty.xlsx');
      file.__buffer = buffer;

      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('no readable data rows');
    });

    test('reports a corrupt/unreadable file as an error rather than throwing', async () => {
      const file: any = new File([], 'corrupt.xlsx');
      file.__corrupt = true;
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
    });

    test('reports a disk read failure as an error', async () => {
      const file: any = new File([], 'err.xlsx');
      file.__error = true;
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('Failed to read the file');
    });
  });

  describe('downloadVendorUploadTemplate', () => {
    test('triggers a download of an .xlsx file without throwing', () => {
      const clickSpy = jest.fn();
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = jest.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = jest.fn();
      const originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = clickSpy;

      expect(() => downloadVendorUploadTemplate()).not.toThrow();
      expect(clickSpy).toHaveBeenCalled();
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalled();

      HTMLAnchorElement.prototype.click = originalClick;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });
  });

  describe('bulkImportVendorRows', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      authClient.setSession(null, null);
      jest.restoreAllMocks();
    });

    function makeRow(rowNumber: number, email: string): VendorUploadRow {
      return {
        rowNumber,
        vendor: { name: `Co ${rowNumber}`, email, phone: '9876543210' },
        isValid: true,
        errors: [],
        missingEmail: !email,
      };
    }

    test('sends a real Bearer token and aggregates a single chunk\'s response', async () => {
      authClient.setSession(
        { id: 'u1', email: 'cm@procucev.com', name: 'CM', role: 'category_manager', orgId: 'o1', orgName: 'Org' },
        'fake-token'
      );
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sessionId: 'bulk-import-1',
            total: 2,
            imported: 2,
            missingEmail: 0,
            duplicates: 0,
            failed: 0,
            onboardingFailed: 0,
            results: [{ rowNumber: 1, status: 'imported' }, { rowNumber: 2, status: 'imported' }],
          },
        }),
      });

      const onProgress = jest.fn();
      const result = await bulkImportVendorRows([makeRow(1, 'a@x.com'), makeRow(2, 'b@x.com')], onProgress);

      expect(result).toEqual({
        sessionId: 'bulk-import-1',
        total: 2,
        imported: 2,
        missingEmail: 0,
        duplicates: 0,
        failed: 0,
        onboardingFailed: 0,
        results: [{ rowNumber: 1, status: 'imported' }, { rowNumber: 2, status: 'imported' }],
      });
      expect(onProgress).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('/api/vendors/bulk-import');
      expect(options.headers.Authorization).toBe('Bearer fake-token');
      expect(JSON.parse(options.body).vendors).toHaveLength(2);
    });

    test('splits uploads into bounded chunks that the backend can provision synchronously', async () => {
      global.fetch = jest.fn().mockImplementation(async (_url, options) => {
        const sent = JSON.parse(options.body).vendors;
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { total: sent.length, imported: sent.length, missingEmail: 0, duplicates: 0, failed: 0, results: sent.map((v: any) => ({ rowNumber: v.rowNumber, status: 'imported' })) },
          }),
        };
      });

      const rows = Array.from({ length: 2250 }, (_, i) => makeRow(i + 1, `row${i}@example.com`));
      const result = await bulkImportVendorRows(rows);

      expect(global.fetch).toHaveBeenCalledTimes(150); // 15 vendors per request
      expect(result.total).toBe(2250);
      expect(result.imported).toBe(2250);
    });

    test('passes sessionId and totalRowsDeclared in the request body and aggregates missingEmail across chunks', async () => {
      global.fetch = jest.fn().mockImplementation(async (_url, options) => {
        const body = JSON.parse(options.body);
        expect(body.totalRowsDeclared).toBe(2);
        expect(body.sessionId).toBeUndefined();
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sessionId: 'session-abc',
              total: 2,
              imported: 1,
              missingEmail: 1,
              duplicates: 0,
              failed: 0,
              results: [
                { rowNumber: 1, status: 'imported', missingEmail: true },
                { rowNumber: 2, status: 'imported' },
              ],
            },
          }),
        };
      });

      const result = await bulkImportVendorRows([makeRow(1, ''), makeRow(2, 'b@x.com')]);

      expect(result.sessionId).toBe('session-abc');
      expect(result.missingEmail).toBe(1);
      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const sentBody = JSON.parse(options.body);
      expect(sentBody.sessionId).toBeUndefined();
      expect(sentBody.totalRowsDeclared).toBe(2);
    });

    test('a network failure for one chunk is reported as failed rows, not a thrown error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
      const result = await bulkImportVendorRows([makeRow(1, 'a@x.com')]);
      expect(result.failed).toBe(1);
      expect(result.results[0]).toMatchObject({ rowNumber: 1, status: 'failed' });
    });

    test('a non-ok server response is reported as failed rows with the server error message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ success: false, error: 'Only a category manager may bulk-import vendors.' }),
      });
      const result = await bulkImportVendorRows([makeRow(1, 'a@x.com')]);
      expect(result.failed).toBe(1);
      expect(result.results[0].errors).toEqual(['Only a category manager may bulk-import vendors.']);
    });

    test('an unparsable response body still reports a failure rather than throwing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      });
      const result = await bulkImportVendorRows([makeRow(1, 'a@x.com')]);
      expect(result.failed).toBe(1);
    });

    test('an empty row list resolves immediately with all-zero totals', async () => {
      global.fetch = jest.fn();
      const result = await bulkImportVendorRows([]);
      expect(result).toEqual({
        sessionId: undefined,
        total: 0,
        imported: 0,
        missingEmail: 0,
        duplicates: 0,
        failed: 0,
        onboardingFailed: 0,
        results: [],
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
