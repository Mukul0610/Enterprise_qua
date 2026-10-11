import * as XLSX from 'xlsx';
import type { ExtractedEntity, LineItemBid, QuoteComparison, RFQItem } from './types';

/** Shared build-workbook-and-download-it tail for single-sheet exports. */
function downloadWorkbook(sheetName: string, rows: Record<string, string | number>[], header: string[], fileName: string): void {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header });
  const workbook: XLSX.WorkBook = { Sheets: { [sheetName]: worksheet }, SheetNames: [sheetName] };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Multi-sheet workbook downloader for full RFQ quote packages. */
export function downloadMultiSheetWorkbook(
  sheets: Array<{ name: string; rows: Record<string, any>[]; header?: string[] }>,
  fileName: string
): void {
  const sheetsObj: Record<string, XLSX.WorkSheet> = {};
  const sheetNames: string[] = [];

  sheets.forEach(({ name, rows, header }) => {
    // Excel sheet names cannot exceed 31 chars
    const safeName = name.slice(0, 31);
    const worksheet = header ? XLSX.utils.json_to_sheet(rows, { header }) : XLSX.utils.json_to_sheet(rows);
    sheetsObj[safeName] = worksheet;
    sheetNames.push(safeName);
  });

  const workbook: XLSX.WorkBook = { Sheets: sheetsObj, SheetNames: sheetNames };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Finds a vendor's priced line item matching an RFQ line item — by
 * lineItemId first (the real link once both sides carry it), falling back
 * to a case-insensitive description match for quotes that only have the
 * item name (e.g. older email-extracted quotes).
 */
function findVendorLineItemPrice(quote: QuoteComparison, rfqItem: ExtractedEntity) {
  const items = quote.lineItemQuotes || [];
  const byId = rfqItem.id ? items.find((li) => li.lineItemId === rfqItem.id) : undefined;
  if (byId) return byId;
  const name = (rfqItem.itemName || '').trim().toLowerCase();
  if (!name) return undefined;
  return items.find((li) => (li.itemName || '').trim().toLowerCase() === name);
}

/**
 * Builds and downloads a line-item-by-vendor bid comparison workbook — one
 * row per RFQ line item, two columns per vendor (Unit Price, Total). A
 * vendor with no itemized breakdown for this RFQ (lineItemQuotes empty —
 * an older quote, or one submitted before this feature existed) shows its
 * single blended unit price in every row, suffixed "(not itemized)" rather
 * than left blank, so the sheet still reflects what was actually quoted.
 */
export function downloadBidComparisonExcel(rfq: RFQItem, quotes: QuoteComparison[]): void {
  const lineItems = rfq.extractedEntities || [];
  const rows = lineItems.map((item) => {
    const row: Record<string, string | number> = {
      Item: item.itemName,
      Quantity: item.quantity,
    };
    quotes.forEach((quote) => {
      const matched = findVendorLineItemPrice(quote, item);
      if (matched) {
        row[`${quote.vendorName} — Unit Price`] = matched.unitPrice;
        row[`${quote.vendorName} — Total`] = matched.totalPrice;
      } else {
        row[`${quote.vendorName} — Unit Price`] = `${quote.unitPrice} (not itemized)`;
        row[`${quote.vendorName} — Total`] = `${quote.totalPrice} (not itemized)`;
      }
    });
    return row;
  });

  const header = ['Item', 'Quantity', ...quotes.flatMap((q) => [`${q.vendorName} — Unit Price`, `${q.vendorName} — Total`])];
  downloadWorkbook('Bid Comparison', rows, header, `Bid_Comparison_${rfq.rfqNumber}.xlsx`);
}

/**
 * Comprehensive multi-tab Excel export containing:
 *  1. Quotes Overview (all vendors summary, scores, terms, lead time, warranty)
 *  2. Line Item Comparison Matrix (RFQ line items with side-by-side vendor quotes)
 *  3. All Itemized Line Quotes (granular list of line-item bids submitted by all vendors)
 */
export function downloadFullQuotesExcel(rfq: RFQItem, quotes: QuoteComparison[]): void {
  const safeQuotes = quotes || [];
  const lineItems = rfq.extractedEntities || [];

  // Sheet 1: Quotes Summary
  const summaryRows = safeQuotes.map((q) => {
    const pricePts = q.scoreBreakdown?.price?.weighted ?? Math.round((q.isBestPrice ? 100 : 80) * 0.45);
    const leadPts = q.scoreBreakdown?.leadTime?.weighted ?? Math.round(Math.max(0, Math.min(100, 100 - (q.leadTimeDays || 14) * 2)) * 0.3);
    const warPts = q.scoreBreakdown?.warranty?.weighted ?? Math.round(Math.min(100, Math.max(0, 50 + (q.warrantyYears || 1) * 10)) * 0.25);
    const displayScore = q.aiMatchScore ?? (pricePts + leadPts + warPts);

    return {
      'RFQ Number': rfq.rfqNumber,
      'RFQ Title': rfq.title,
      'Vendor Name': q.vendorName,
      'Vendor Category': q.vendorCategory || 'Client List',
      'Total Price (INR)': q.totalPrice || 0,
      'Blended / Avg Unit Price (INR)': q.unitPrice || 0,
      'Lead Time (Days)': q.leadTimeDays || 0,
      'Warranty (Years)': q.warrantyYears || 0,
      'Compliance Status': q.complianceStatus || 'Pending Review',
      'AI Match Score (%)': displayScore,
      'Best Price': q.isBestPrice ? 'Yes' : 'No',
      'Payment Terms': q.paymentTerms || 'N/A',
      'Itemized Items Count': Array.isArray(q.lineItemQuotes) ? q.lineItemQuotes.length : 0,
      'Submitted At': q.submittedAt ? new Date(q.submittedAt).toLocaleString('en-IN') : 'N/A',
      'Remarks': q.remarks || '',
    };
  });

  // Sheet 2: Line Item Comparison Matrix
  const matrixRows = lineItems.map((item) => {
    const row: Record<string, any> = {
      'Item ID': item.id,
      'Item Name': item.itemName,
      'Major Category': item.majorCategory || rfq.category || '',
      'Minor Category': item.minorCategory || '',
      'Quantity': item.quantity,
      'Unit': item.unit || '',
      'Target Date': item.targetDate || '',
      'Technical Specs': item.technicalSpecs || '',
    };

    safeQuotes.forEach((quote) => {
      const matched = findVendorLineItemPrice(quote, item);
      if (matched) {
        row[`${quote.vendorName} — Unit Price (INR)`] = matched.unitPrice;
        row[`${quote.vendorName} — Total (INR)`] = matched.totalPrice;
      } else {
        row[`${quote.vendorName} — Unit Price (INR)`] = `${quote.unitPrice} (Blended)`;
        row[`${quote.vendorName} — Total (INR)`] = `${quote.totalPrice} (Blended)`;
      }
    });

    return row;
  });

  // Sheet 3: Granular Itemized Line Item Quotes
  const itemizedRows: Record<string, any>[] = [];
  safeQuotes.forEach((quote) => {
    if (Array.isArray(quote.lineItemQuotes) && quote.lineItemQuotes.length > 0) {
      quote.lineItemQuotes.forEach((li) => {
        itemizedRows.push({
          'Vendor Name': quote.vendorName,
          'Line Item ID': li.lineItemId || '',
          'Item Name': li.itemName,
          'Quantity': li.quantity,
          'Unit': li.unit || '',
          'Unit Price (INR)': li.unitPrice,
          'Total Price (INR)': li.totalPrice,
          'Lead Time (Days)': li.leadTimeDays ?? quote.leadTimeDays ?? '',
          'Warranty (Years)': li.warrantyYears ?? quote.warrantyYears ?? '',
          'Payment Terms': quote.paymentTerms || '',
          'Remarks': quote.remarks || '',
        });
      });
    } else {
      // For non-itemized quotes, add a single summary row
      itemizedRows.push({
        'Vendor Name': quote.vendorName,
        'Line Item ID': 'All Items (Blended)',
        'Item Name': rfq.title,
        'Quantity': lineItems.reduce((acc, cur) => acc + (cur.quantity || 0), 0) || 1,
        'Unit': 'Lot',
        'Unit Price (INR)': quote.unitPrice,
        'Total Price (INR)': quote.totalPrice,
        'Lead Time (Days)': quote.leadTimeDays || '',
        'Warranty (Years)': quote.warrantyYears || '',
        'Payment Terms': quote.paymentTerms || '',
        'Remarks': quote.remarks || '(Blended quote)',
      });
    }
  });

  downloadMultiSheetWorkbook(
    [
      { name: 'Quotes Summary', rows: summaryRows },
      { name: 'Line Item Matrix', rows: matrixRows },
      { name: 'All Itemized Bids', rows: itemizedRows },
    ],
    `Full_Quotes_${rfq.rfqNumber}.xlsx`
  );
}

/**
 * Downloads a single vendor's quotation in Excel format.
 */
export function downloadSingleVendorQuoteExcel(rfq: RFQItem, quote: QuoteComparison): void {
  const items = Array.isArray(quote.lineItemQuotes) && quote.lineItemQuotes.length > 0
    ? quote.lineItemQuotes
    : (rfq.extractedEntities || []).map((e) => ({
        lineItemId: e.id,
        itemName: e.itemName,
        quantity: e.quantity,
        unit: e.unit,
        unitPrice: quote.unitPrice,
        totalPrice: quote.totalPrice,
        leadTimeDays: quote.leadTimeDays,
        warrantyYears: quote.warrantyYears,
      }));

  const rows: Record<string, string | number>[] = items.map((item, idx) => ({
    'S.No': idx + 1,
    'Item ID': item.lineItemId || '',
    'Item Name': item.itemName,
    'Quantity': item.quantity,
    'Unit': item.unit || 'Nos',
    'Unit Price (INR)': item.unitPrice,
    'Total Price (INR)': item.totalPrice,
    'Lead Time (Days)': (item as any).leadTimeDays ?? quote.leadTimeDays ?? '',
    'Warranty (Years)': (item as any).warrantyYears ?? quote.warrantyYears ?? '',
  }));

  // Append summary row
  rows.push({
    'S.No': '',
    'Item ID': '',
    'Item Name': 'TOTAL BID AMOUNT',
    'Quantity': '',
    'Unit': '',
    'Unit Price (INR)': '',
    'Total Price (INR)': quote.totalPrice,
    'Lead Time (Days)': quote.leadTimeDays || '',
    'Warranty (Years)': quote.warrantyYears || '',
  });

  const vendorSafeName = quote.vendorName.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadWorkbook(
    'Quotation',
    rows,
    [
      'S.No',
      'Item ID',
      'Item Name',
      'Quantity',
      'Unit',
      'Unit Price (INR)',
      'Total Price (INR)',
      'Lead Time (Days)',
      'Warranty (Years)',
    ],
    `Quote_${vendorSafeName}_${rfq.rfqNumber}.xlsx`
  );
}

/**
 * Builds and downloads the vendor's own line-item quotation as it currently
 * stands in the bid form — Item / Qty / UOM / Rate / Amount, same shape as
 * the on-screen table — so a vendor has a real record of exactly what
 * they're about to submit (or just submitted).
 */
export function downloadVendorQuotationExcel(
  rfqNumber: string,
  lineItems: LineItemBid[],
  rates: Record<string, string>
): void {
  const rows = lineItems.map((item) => {
    const rate = Number(rates[item.id]) || 0;
    return {
      Item: item.description,
      Quantity: item.quantity,
      UOM: item.unit || '',
      'Rate (INR)': rate || '',
      'Amount (INR)': rate > 0 ? rate * item.quantity : '',
    };
  });

  downloadWorkbook(
    'Quotation',
    rows,
    ['Item', 'Quantity', 'UOM', 'Rate (INR)', 'Amount (INR)'],
    `Quotation_${rfqNumber}.xlsx`
  );
}
