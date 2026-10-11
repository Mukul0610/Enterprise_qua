import * as XLSX from 'xlsx';

export const CATALOGUE_TEMPLATE_HEADERS = [
  'Product Name',
  'SKU',
  'Category',
  'Specifications',
  'Unit Price',
  'Lead Time Days',
  'MOQ',
] as const;

export interface CatalogueUploadRow {
  name: string;
  sku: string;
  category: string;
  specs: string;
  unitPrice: number;
  leadTimeDays: number;
  moq: number;
  rowNumber: number;
  errors: string[];
}

export type CatalogueParseResult =
  | { success: true; rows: CatalogueUploadRow[]; error: null }
  | { success: false; rows: []; error: string };

export function downloadCatalogueTemplate(): void {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...CATALOGUE_TEMPLATE_HEADERS],
    ['Centrifugal Water Pump', 'SKU-PUMP-500', 'Engineering Spares - Mechanical', '15 HP, cast iron', 850, 5, 10],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Catalogue');
  XLSX.writeFile(workbook, 'catalogue-template.xlsx');
}

export function parseCatalogueWorkbook(data: ArrayBuffer): CatalogueParseResult {
  try {
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { success: false, rows: [], error: 'The workbook has no worksheets.' };

    const worksheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
    if (raw.length === 0) return { success: false, rows: [], error: 'The worksheet has no product rows.' };

    const headers = Object.keys(raw[0]);
    const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const column = (expected: string) => headers.find((header) => normalize(header) === normalize(expected));
    const columns = {
      name: column('Product Name'),
      sku: column('SKU'),
      category: column('Category'),
      specs: column('Specifications'),
      unitPrice: column('Unit Price'),
      leadTimeDays: column('Lead Time Days'),
      moq: column('MOQ'),
    };
    const requiredHeaders = ['name', 'sku', 'category', 'unitPrice', 'leadTimeDays', 'moq'] as const;
    const missing = requiredHeaders.filter((key) => !columns[key]);
    if (missing.length) {
      return { success: false, rows: [], error: `Missing required columns: ${missing.map((key) => key === 'unitPrice' ? 'Unit Price' : key === 'leadTimeDays' ? 'Lead Time Days' : key === 'moq' ? 'MOQ' : key === 'name' ? 'Product Name' : key.toUpperCase()).join(', ')}.` };
    }

    const seenSkus = new Set<string>();
    const rows: CatalogueUploadRow[] = raw.map((item, index) => {
      const value = (key: keyof typeof columns) => String(columns[key] ? item[columns[key]!] ?? '' : '').trim();
      const sku = value('sku').toUpperCase();
      const unitPrice = Number(value('unitPrice'));
      const leadTimeDays = Number(value('leadTimeDays'));
      const moq = Number(value('moq'));
      const errors: string[] = [];
      if (!value('name')) errors.push('Product name is required.');
      if (!sku) errors.push('SKU is required.');
      else if (seenSkus.has(sku)) errors.push('SKU is duplicated in this workbook.');
      if (sku) seenSkus.add(sku);
      if (!value('category')) errors.push('Category is required.');
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) errors.push('Unit Price must be greater than zero.');
      if (!Number.isInteger(leadTimeDays) || leadTimeDays <= 0) errors.push('Lead Time Days must be a positive whole number.');
      if (!Number.isInteger(moq) || moq <= 0) errors.push('MOQ must be a positive whole number.');
      return {
        name: value('name'),
        sku,
        category: value('category'),
        specs: value('specs'),
        unitPrice,
        leadTimeDays,
        moq,
        rowNumber: index + 2,
        errors,
      };
    }).filter((row) => row.name || row.sku || row.category || row.specs || row.unitPrice || row.leadTimeDays || row.moq);

    return rows.length
      ? { success: true, rows, error: null }
      : { success: false, rows: [], error: 'The worksheet has no product rows.' };
  } catch {
    return { success: false, rows: [], error: 'The workbook could not be read. Upload a valid .xlsx file.' };
  }
}
