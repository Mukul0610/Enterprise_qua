import * as XLSX from 'xlsx';
import {
  CATALOGUE_TEMPLATE_HEADERS,
  downloadCatalogueTemplate,
  parseCatalogueWorkbook,
} from '@/lib/catalogueUploadClient';

jest.mock('xlsx', () => {
  const actual = jest.requireActual('xlsx');
  return {
    ...actual,
    read: jest.fn(actual.read),
    writeFile: jest.fn(),
    utils: {
      ...actual.utils,
      sheet_to_json: jest.fn(actual.utils.sheet_to_json),
    },
  };
});

function workbookBuffer(headers: string[], rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    'Catalogue'
  );
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('catalogueUploadClient', () => {
  test('exports the catalogue template as an Excel workbook', () => {
    downloadCatalogueTemplate();
    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.any(Object), 'catalogue-template.xlsx');
    expect(CATALOGUE_TEMPLATE_HEADERS).toContain('Unit Price');
  });

  test('parses and validates valid rows and flags duplicate SKUs', () => {
    const headers = [...CATALOGUE_TEMPLATE_HEADERS];
    const parsed = parseCatalogueWorkbook(workbookBuffer(headers, [
      ['Pump', 'P-1', 'Mechanical', '15 HP', 100, 4, 2],
      ['Pump duplicate', 'p-1', 'Mechanical', '', 150, 6, 1],
      ['Bad item', 'P-3', 'Mechanical', '', 0, 0, 0],
    ]));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.rows[0]).toMatchObject({ sku: 'P-1', unitPrice: 100, rowNumber: 2, errors: [] });
    expect(parsed.rows[1].errors).toContain('SKU is duplicated in this workbook.');
    expect(parsed.rows[2].errors).toEqual(expect.arrayContaining([
      'Unit Price must be greater than zero.',
      'Lead Time Days must be a positive whole number.',
      'MOQ must be a positive whole number.',
    ]));
  });

  test('reports empty sheets, missing required columns, and malformed workbooks', () => {
    (XLSX.read as jest.Mock).mockReturnValueOnce({ SheetNames: [], Sheets: {} });
    expect(parseCatalogueWorkbook(new ArrayBuffer(0)))
      .toMatchObject({ success: false, error: 'The workbook has no worksheets.' });

    const empty = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(empty, XLSX.utils.aoa_to_sheet([['Product Name']]), 'Empty');
    expect(parseCatalogueWorkbook(XLSX.write(empty, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer))
      .toMatchObject({ success: false, error: 'The worksheet has no product rows.' });

    const missing = parseCatalogueWorkbook(workbookBuffer(['Name'], [['Pump']]));
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error).toContain('Missing required columns');

    expect(parseCatalogueWorkbook(new ArrayBuffer(0)).success).toBe(false);
  });

  test('validates missing row values, decimal quantities, and absent optional columns', () => {
    const parsed = parseCatalogueWorkbook(workbookBuffer(
      ['Product Name', 'SKU', 'Category', 'Unit Price', 'Lead Time Days', 'MOQ'],
      [
        ['', '', '', 10, 2.5, -1],
        ['Valid name', 'SKU-2', 'Electrical', 12, 3, 1],
      ]
    ));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.rows[0].errors).toEqual(expect.arrayContaining([
      'Product name is required.',
      'SKU is required.',
      'Category is required.',
      'Lead Time Days must be a positive whole number.',
      'MOQ must be a positive whole number.',
    ]));
    expect(parsed.rows[1].specs).toBe('');
  });

  test('ignores a blank row and handles null optional cells', () => {
    (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValueOnce([{
      'Product Name': '',
      SKU: '',
      Category: '',
      Specifications: null,
      'Unit Price': '',
      'Lead Time Days': '',
      MOQ: '',
    }]);
    expect(parseCatalogueWorkbook(new ArrayBuffer(0)))
      .toMatchObject({ success: false, error: 'The worksheet has no product rows.' });
  });
});
