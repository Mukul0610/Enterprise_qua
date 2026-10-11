import * as XLSX from 'xlsx';
import { authClient } from './authClient';
import { EMAIL_PATTERN, GSTIN_PATTERN, INDIAN_MOBILE_PATTERN, INDIAN_PINCODE_PATTERN } from './validationSchemas';
import type { VendorUploadImportResponse, VendorUploadRow, VendorUploadRowResult } from './types';

/**
 * Category manager vendor bulk upload — parsing, validation, template
 * generation, and chunked import against POST /api/vendors/bulk-import.
 *
 * Mirrors the real p2pservices Vendor Master sheet columns (verified against
 * both the Java backend's Apache POI row reader and a real sample export):
 * Company Name, Person Name, Email Id, Mobile No, GSTIN, Pin Code, City,
 * State, Cate-1..5, Products. The old system's own bulk path only ever
 * required company name, email and mobile — everything else here is
 * format-checked only when the row actually supplies it, matching that.
 */

export const VENDOR_TEMPLATE_HEADERS = [
  'Vendor Code',
  'Company Name',
  'Person Name',
  'Email Id',
  'Mobile No',
  'GSTIN',
  'Pin Code',
  'City',
  'State',
  'Category',
  'Products',
] as const;

const ALLOWED_UPLOAD_EXTENSIONS = ['.xlsx'];

export function isAllowedVendorUploadFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ALLOWED_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// A vendor master file this large risks freezing the tab while XLSX parses
// it in the main thread — reject it client-side with a clear reason rather
// than letting the browser hang with no explanation.
export const MAX_VENDOR_UPLOAD_FILE_BYTES = 10 * 1024 * 1024; // 10MB

/** Matches a header cell against any of several acceptable spellings, tolerant of case/spacing/punctuation. */
function findColumn(headerKeys: string[], candidates: string[]): string | undefined {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedCandidates = candidates.map(normalize);
  return headerKeys.find((k) => normalizedCandidates.includes(normalize(k)));
}

function cellToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export interface ParsedVendorFile {
  rows: VendorUploadRow[];
  /** Rows that were entirely blank (every cell empty) — skipped, not counted as errors. */
  blankRowCount: number;
}

export type ParseVendorFileResult = { success: true; data: ParsedVendorFile } | { success: false; error: string };

/**
 * Reads a .xlsx File in the browser, maps its columns onto the vendor
 * shape, and validates every row. Nothing is fabricated for a missing
 * field — a row missing a required value is reported invalid, never
 * silently defaulted (see initial-setup-modal.tsx's Vendor Master upload
 * for the pattern this deliberately does NOT repeat).
 */
export function parseVendorUploadFile(file: File): Promise<ParseVendorFileResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          resolve({ success: false, error: 'The uploaded file has no sheets.' });
          return;
        }
        const worksheet = workbook.Sheets[firstSheetName];
        const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rawRows || rawRows.length === 0) {
          resolve({ success: false, error: 'The uploaded file has no readable data rows.' });
          return;
        }

        const headerKeys = Object.keys(rawRows[0]);
        const duplicateHeaderCheck = new Set<string>();
        const normalizedHeaders = headerKeys.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
        const hasDuplicateHeaders = normalizedHeaders.some((h) => {
          if (duplicateHeaderCheck.has(h)) return true;
          duplicateHeaderCheck.add(h);
          return false;
        });
        if (hasDuplicateHeaders) {
          resolve({ success: false, error: 'The file has duplicate column headers — each column must be unique.' });
          return;
        }

        const codeCol = findColumn(headerKeys, ['vendorcode', 'vendor code', 'vendor_code', 'code', 'vendor id']);
        const nameCol = findColumn(headerKeys, ['companyname', 'company name', 'vendor name', 'name']);
        const contactCol = findColumn(headerKeys, ['personname', 'person name', 'contactperson', 'contact person']);
        const emailCol = findColumn(headerKeys, ['emailid', 'email id', 'email']);
        const phoneCol = findColumn(headerKeys, ['mobileno', 'mobile no', 'mobile', 'phone', 'phone number', 'phonenumber']);
        const gstinCol = findColumn(headerKeys, ['gstin']);
        const pincodeCol = findColumn(headerKeys, ['pincode', 'pin code']);
        const cityCol = findColumn(headerKeys, ['city']);
        const stateCol = findColumn(headerKeys, ['state']);
        const productsCol = findColumn(headerKeys, ['products']);
        // Category may be one combined column (including the marketplace
        // scrape's misspelled "Categorys") or the sheet's real Cate-1..5 spread.
        const categoryCols = headerKeys.filter(
          (k) => /^cate\s*-?\s*[1-5]$/i.test(k.trim()) || /^categor(y|ys|ies)$/i.test(k.trim())
        );

        if (!nameCol && !emailCol && !phoneCol) {
          resolve({
            success: false,
            error: 'Could not find Company Name, Email Id or Mobile No columns — check the file matches the Vendor Master Template.',
          });
          return;
        }

        const seenEmails = new Map<string, number>(); // email -> first rowNumber it appeared on
        const seenVendorCodes = new Map<string, number>(); // vendorCode -> first rowNumber it appeared on
        const rows: VendorUploadRow[] = [];
        let blankRowCount = 0;

        rawRows.forEach((raw, idx) => {
          const rowNumber = idx + 2; // header is row 1
          const allValues = Object.values(raw).map(cellToString);
          if (allValues.every((v) => v === '')) {
            blankRowCount += 1;
            return;
          }

          const vendorCode = codeCol ? cellToString(raw[codeCol]) : '';
          const name = nameCol ? cellToString(raw[nameCol]) : '';
          const contactPerson = contactCol ? cellToString(raw[contactCol]) : '';
          const email = emailCol ? cellToString(raw[emailCol]).toLowerCase() : '';
          const phone = phoneCol ? cellToString(raw[phoneCol]) : '';
          const gstin = gstinCol ? cellToString(raw[gstinCol]).toUpperCase() : '';
          const pincode = pincodeCol ? cellToString(raw[pincodeCol]) : '';
          const city = cityCol ? cellToString(raw[cityCol]) : '';
          const state = stateCol ? cellToString(raw[stateCol]) : '';
          const products = productsCol ? cellToString(raw[productsCol]) : '';
          const majorCategory = categoryCols.map((c) => cellToString(raw[c])).filter(Boolean)[0] || '';

          const errors: string[] = [];
          if (!name) errors.push('Company name is required.');
          // A row with no email is not rejected — it still uploads with a
          // null email (never fabricated) and is flagged via `missingEmail`
          // instead, so a large marketplace-directory import doesn't drop or
          // invent contact data for the many real rows that genuinely have
          // none. A row that DOES supply an email is still format-checked.
          const missingEmail = !email;
          if (email && !EMAIL_PATTERN.test(email)) errors.push('Email is not a valid email address.');
          if (!phone) errors.push('Mobile number is required.');
          else if (!INDIAN_MOBILE_PATTERN.test(phone)) errors.push('Mobile number must be a valid 10-digit Indian number.');
          if (gstin && !GSTIN_PATTERN.test(gstin)) errors.push('GSTIN format is invalid.');
          if (pincode && !INDIAN_PINCODE_PATTERN.test(pincode)) errors.push('PIN code must be 6 digits and not start with 0.');

          if (vendorCode) {
            const firstSeenCodeAt = seenVendorCodes.get(vendorCode.toLowerCase());
            if (firstSeenCodeAt !== undefined) {
              errors.push(`Duplicate Vendor Code "${vendorCode}" — already used on row ${firstSeenCodeAt}.`);
            } else {
              seenVendorCodes.set(vendorCode.toLowerCase(), rowNumber);
            }
          }

          if (email) {
            const firstSeenAt = seenEmails.get(email);
            if (firstSeenAt !== undefined) {
              errors.push(`Duplicate email — already used on row ${firstSeenAt}.`);
            } else {
              seenEmails.set(email, rowNumber);
            }
          }

          rows.push({
            rowNumber,
            vendor: { vendorCode, name, email, phone, contactPerson, gstin, city, state, pincode, majorCategory, products },
            isValid: errors.length === 0,
            errors,
            missingEmail,
          });
        });

        resolve({ success: true, data: { rows, blankRowCount } });
      } catch (err: unknown) {
        resolve({ success: false, error: err instanceof Error ? err.message : 'Could not parse the file — is it a valid .xlsx workbook?' });
      }
    };

    reader.onerror = () => resolve({ success: false, error: 'Failed to read the file from disk.' });
    reader.readAsArrayBuffer(file);
  });
}

/** Builds and downloads a blank Vendor Master template with one example row. */
export function downloadVendorUploadTemplate(): void {
  const exampleRow = {
    'Vendor Code': 'VEND-001',
    'Company Name': 'Acme Hydraulics Pvt Ltd',
    'Person Name': 'Ramesh Kumar',
    'Email Id': 'ramesh@acmehydraulics.example',
    'Mobile No': '9876543210',
    GSTIN: '29AAAPL5929R1ZX',
    'Pin Code': '560047',
    City: 'Bengaluru',
    State: 'Karnataka',
    Category: 'Hoses, Valves & Fittings',
    Products: 'Hydraulic pumps, valves, cylinders',
  };
  const worksheet = XLSX.utils.json_to_sheet([exampleRow], { header: [...VENDOR_TEMPLATE_HEADERS] });
  const workbook: XLSX.WorkBook = { Sheets: { 'Vendor Master': worksheet }, SheetNames: ['Vendor Master'] };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Vendor_Master_Template.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// 1000 rows/chunk against a batched multi-row INSERT (never one query per
// row server-side) cuts a 634k-row upload down to ~635 requests instead of
// ~3,200 at the old 200/chunk size.
const BULK_IMPORT_CHUNK_SIZE = 15;

/**
 * Sends only the already-valid rows to the backend, in bounded chunks —
 * never one request per vendor, never the whole file in a single request.
 * `onProgress` fires after each chunk so the caller can show a running
 * imported/missing-email/duplicate/failed count while a large upload is
 * still in flight.
 *
 * `resumeSessionId` lets a later call (e.g. after a page reload) attach to
 * an upload run already in progress on the server, so a dropped
 * connection/tab doesn't lose the running totals a very large upload has
 * already accumulated.
 */
export async function bulkImportVendorRows(
  validRows: VendorUploadRow[],
  onProgress?: (soFar: VendorUploadImportResponse) => void,
  resumeSessionId?: string
): Promise<VendorUploadImportResponse> {
  const token = authClient.getToken();
  const aggregate: VendorUploadImportResponse = {
    sessionId: resumeSessionId,
    total: 0,
    imported: 0,
    missingEmail: 0,
    duplicates: 0,
    failed: 0,
    onboardingFailed: 0,
    results: [],
  };

  for (let i = 0; i < validRows.length; i += BULK_IMPORT_CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + BULK_IMPORT_CHUNK_SIZE);
    const payload = chunk.map((r) => ({ rowNumber: r.rowNumber, ...r.vendor, email: r.vendor.email || undefined }));

    let res: Response;
    try {
      res = await fetch('/api/vendors/bulk-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          vendors: payload,
          sessionId: aggregate.sessionId,
          totalRowsDeclared: validRows.length,
        }),
      });
    } catch {
      const results: VendorUploadRowResult[] = chunk.map((r) => ({
        rowNumber: r.rowNumber,
        status: 'failed',
        errors: ['Network error — could not reach the server.'],
      }));
      aggregate.total += chunk.length;
      aggregate.failed += chunk.length;
      aggregate.results.push(...results);
      onProgress?.({ ...aggregate });
      continue;
    }

    let body: { success?: boolean; data?: VendorUploadImportResponse; error?: string } = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }

    if (!res.ok || !body.success || !body.data) {
      const results: VendorUploadRowResult[] = chunk.map((r) => ({
        rowNumber: r.rowNumber,
        status: 'failed',
        errors: [body.error || `Server error (${res.status}).`],
      }));
      aggregate.total += chunk.length;
      aggregate.failed += chunk.length;
      aggregate.results.push(...results);
    } else {
      aggregate.sessionId = body.data.sessionId || aggregate.sessionId;
      aggregate.total += body.data.total;
      aggregate.imported += body.data.imported;
      aggregate.missingEmail += body.data.missingEmail || 0;
      aggregate.duplicates += body.data.duplicates;
      aggregate.failed += body.data.failed;
      aggregate.onboardingFailed = (aggregate.onboardingFailed || 0) + (body.data.onboardingFailed || 0);
      aggregate.results.push(...body.data.results);
    }

    onProgress?.({ ...aggregate });
  }

  return aggregate;
}
