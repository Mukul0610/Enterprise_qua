/**
 * Gemini AI Document Extraction Service
 *
 * Extracts RFQ line items from an uploaded document. This is the Node equivalent
 * of AIExtractionService + GeminiApiClient in the Java p2pservices app, and it
 * keeps that service's two most important guarantees:
 *
 *   - Accuracy over completeness. The model is told never to guess a quantity,
 *     never to default it to 1, and never to reuse a number from the
 *     specification as the purchase quantity. A missing value comes back null so
 *     the buyer is asked, rather than being handed a fabricated figure.
 *   - Strict JSON. The response is parsed, not interpreted; anything that is not
 *     valid JSON with an `items` array is treated as a failed extraction.
 *
 * The API key is read from the environment on the server only. Callers receive a
 * documented failure reason instead of an exception, so the wizard can fall back
 * to manual line-item entry.
 */

const { GEMINI_CONFIG, GEMINI_INLINE_MIME_TYPES } = require('../config/constants');
const { logger } = require('./loggerService');
// Monetary parsing lives with the ingestion layer that consumes these rows, so
// prices from a model reply and prices from a browser-parsed BOQ normalise identically.
const { normalizeAmount, ensureTaxonomyLoaded, taxonomyCategoryNames } = require('./rfqIngestionService');

/** Machine-readable outcomes the route maps onto responses. */
const EXTRACTION_STATUS = {
  SUCCESS: 'SUCCESS',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NO_CONTENT: 'NO_CONTENT',
  DOCUMENT_TOO_LARGE: 'DOCUMENT_TOO_LARGE',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  AI_FAILED: 'AI_FAILED',
  NO_ITEMS_FOUND: 'NO_ITEMS_FOUND',
};

/**
 * Instruction block sent with every request.
 *
 * Condensed from prompts/rfq_prompt.txt in the Java service. The prohibitions are
 * load-bearing: without them the model routinely lifted a dimension out of the
 * specification and returned it as the order quantity.
 */
const EXTRACTION_PROMPT = `You are an enterprise RFQ extraction engine. Extract ONLY procurement line items that are explicitly present in the supplied document.

ACCURACY IS MORE IMPORTANT THAN COMPLETENESS. DO NOT GUESS.
- DO NOT infer a purchase quantity from a specification, dimension or model number.
- DO NOT default a missing quantity to 1. Return null instead.
- DO NOT invent items, units, dates or specifications that are not stated.
- A spreadsheet may be flattened with cells separated by " | ", one row per line. A label may sit in one cell with its value in the next cell on the same line, or as a column header with values in the rows beneath it. Read both layouts.
- If the document is an image or a scan, read the table structure and match each quantity to the row it sits on.

EXHAUSTIVE EXTRACTION ACROSS ALL WORKSHEETS (NO ARBITRARY LIMITS):
- Extract ALL valid procurement line items across all worksheets (indicated by "SHEET: <sheetName>") and all sections in the document.
- Do NOT limit extraction to 10 items or provide an arbitrary sample. If the document contains 50, 100, 200, or more items, extract every single valid item.
- VALID LINE ITEM RULES: Only extract items that have an explicit product description and a valid stated positive purchase quantity (> 0).
- If a row in the document lacks a quantity, or has a zero, negative, or invalid quantity, do NOT extract it and do NOT default the quantity to 1.

DESCRIPTION vs SPECIFICATION
- When a document prices items with a separate specification column, use it as stated.
- When one description carries both the item and its technical detail, split it. Keep the product name plus any size, dimension, bore, length or model token that IDENTIFIES the item in "itemDescription", and move the qualifying detail — material grade, standard, class, rating, voltage, phase, efficiency, certification, finish — into "specification".
- Splitting only moves text that is already written in the document. Never add a specification that is not stated, and never drop a token: every word of the original description must appear in one field or the other.
- Example: "Industrial Ball Valve, 2 inch, SS316, Class 150, threaded" becomes itemDescription "Industrial Ball Valve 2 inch" and specification "SS316, Class 150, threaded", because the bore identifies the valve while the material and class qualify it.

MONETARY VALUES
- Report money as a plain number with no currency symbol, thousands separator or words. "Rs. 1,45,000/-" becomes 145000.
- DO NOT calculate, estimate or infer a price that is not printed in the document. Return null instead.
- "estimatedBudget" is only for a stated overall value such as a grand total, total amount, estimated value or budget ceiling. If the document only prices individual lines, leave it null; the totals are derived from those lines instead.

Return a SINGLE JSON object with EXACTLY this shape and no surrounding prose or markdown:
{
  "documentTitle": "String, a short title for the overall requirement, or null",
  "category": "String, the overall category if stated, copied exactly from the CATEGORY LIST, or null if no listed category is stated",
  "deliveryDate": "String in YYYY-MM-DD if a delivery or required-by date is stated, else null",
  "deliveryLocation": "String, overall delivery location or destination if stated, or null",
  "deliveryCity": "String, overall delivery city if stated, or null",
  "deliveryState": "String, overall delivery state if stated, or null",
  "deliveryPincode": "String, overall delivery pincode or postal code if stated, or null",
  "estimatedBudget": "Number, the overall stated total value or budget of the requirement, or null",
  "items": [
    {
      "itemDescription": "String, the product or material name including any size, dimension or model token that identifies it. Never an empty string.",
      "quantity": "Number, the purchase quantity exactly as stated, or null if not stated",
      "unit": "String, unit of measure as stated e.g. Nos, Units, Meters, Kg, Sets, or null",
      "specification": "String, technical specification, grade, material or standard as stated, or null",
      "brand": "String, brand or manufacturer if stated, or null",
      "category": "String, item level category if stated, or null",
      "targetDate": "String in YYYY-MM-DD if this line has its own date, else null",
      "deliveryCity": "String, destination city for this item if stated, else null",
      "deliveryState": "String, destination state for this item if stated, else null",
      "deliveryPincode": "String, destination pincode for this item if stated, else null",
      "deliveryLocation": "String, destination location for this item if stated, else null",
      "unitPrice": "Number, the stated rate or price for ONE unit of this line, or null",
      "totalPrice": "Number, the stated line total or amount for this line, or null"
    }
  ]
}

If the document contains no procurement line items at all, return {"items": []}.`;

/** True when a real extraction call can be attempted. */
function isConfigured() {
  return resolveApiKeys().length > 0;
}

/** Resolve API keys pool from GEMINI_CONFIG.API_KEY (supports comma-separated multiple keys). */
function resolveApiKeys() {
  const raw = String(GEMINI_CONFIG.API_KEY || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Models to attempt, primary first, deduplicated. */
function resolveModelChain() {
  return Array.from(new Set([GEMINI_CONFIG.PRIMARY_MODEL, ...GEMINI_CONFIG.FALLBACK_MODELS].filter(Boolean)));
}

/**
 * Pull the model's text out of a generateContent response, tolerating the
 * multi-part shape the API can return.
 */
function extractResponseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

/**
 * Parse the model's reply into an object.
 *
 * Models occasionally wrap JSON in a ```json fence despite being told not to, so
 * the fence is stripped and the outermost object is isolated before parsing.
 * Anything still unparseable is a failed extraction, never a partial guess.
 */
function parseExtractionJson(text) {
  if (!text) return null;

  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidate = fenced[1].trim();

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  candidate = candidate.slice(firstBrace, lastBrace + 1);

  // The candidate always starts with '{' and ends with '}', so a successful parse
  // is necessarily an object; anything else throws and is reported as a failure.
  try {
    return JSON.parse(candidate);
  } catch {
    // One repair pass for the single most common defect in model JSON: a trailing
    // comma before a closing } or ]. This only removes a stray separator, so it
    // cannot turn malformed data into fabricated values; anything still invalid
    // falls through to null and is reported as a failed extraction (fail-closed).
    try {
      const repaired = candidate.replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

/**
 * Map the model's item shape onto the raw row shape rfqIngestionService expects.
 *
 * A row with no description cannot be quoted against and is dropped here. A null
 * quantity is passed through untouched so the ingestion layer applies the same
 * documented default the Java service used, rather than the model inventing one.
 */
function toRawLineItems(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const docDate = typeof parsed?.deliveryDate === 'string' ? parsed.deliveryDate.trim() : '';

  return items
    .map((item) => {
      const row = {
        itemName: typeof item?.itemDescription === 'string' ? item.itemDescription.trim() : '',
        quantity: item?.quantity,
        unit: typeof item?.unit === 'string' ? item.unit.trim() : '',
        technicalSpecs: typeof item?.specification === 'string' ? item.specification.trim() : '',
        category: typeof item?.category === 'string' ? item.category.trim() : '',
        targetDate: typeof item?.targetDate === 'string' ? item.targetDate.trim() : docDate,
        unitPrice: normalizeAmount(item?.unitPrice),
        totalPrice: normalizeAmount(item?.totalPrice),
      };

      if (item?.brand) row.brand = String(item.brand).trim();
      if (item?.deliveryCity || parsed?.deliveryCity) {
        row.deliveryCity = String(item?.deliveryCity || parsed.deliveryCity).trim();
      }
      if (item?.deliveryState || parsed?.deliveryState) {
        row.deliveryState = String(item?.deliveryState || parsed.deliveryState).trim();
      }
      if (item?.deliveryPincode || parsed?.deliveryPincode) {
        row.deliveryPincode = String(item?.deliveryPincode || parsed.deliveryPincode).trim();
      }
      if (item?.deliveryLocation || parsed?.deliveryLocation) {
        row.deliveryLocation = String(item?.deliveryLocation || parsed.deliveryLocation).trim();
      }

      return row;
    })
    .filter((item) => item.itemName !== '');
}

/**
 * Match a header cell text to a known line-item field name.
 */
function matchHeaderField(headerText) {
  if (typeof headerText !== 'string') return null;
  const clean = headerText.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!clean) return null;
  if (/^(?:item|itemname|itemdesc|itemdescription|product|material|description|particulars|lineitem|itemdetails|materialdescription)$/.test(clean)) return 'itemDescription';
  if (/^(?:qty|quantity|purchaseqty|orderqty|count|volume|reqqty|requiredqty|orderquantity)$/.test(clean)) return 'quantity';
  if (/^(?:unit|uom|unitofmeasure|units|measure)$/.test(clean)) return 'unit';
  if (/^(?:spec|specs|specification|specifications|techspec|techspecs|technicalspecs|technicalspecifications|technicalspecification|grade|materialgrade|standard|dimensions|size|details)$/.test(clean)) return 'specification';
  if (/^(?:unitprice|rate|unitrate|priceperunit|price|rateperunit)$/.test(clean)) return 'unitPrice';
  if (/^(?:totalprice|totalamount|total|linetotal|amount)$/.test(clean)) return 'totalPrice';
  if (/^(?:brand|make|manufacturer)$/.test(clean)) return 'brand';
  if (/^(?:deliverydate|targetdate|requiredby|duedate|deliveryby|date)$/.test(clean)) return 'targetDate';
  if (/^(?:deliverycity|destinationcity|city)$/.test(clean)) return 'deliveryCity';
  if (/^(?:deliverystate|state)$/.test(clean)) return 'deliveryState';
  if (/^(?:deliverypincode|postalcode|pincode|pincode|zip|zipcode)$/.test(clean)) return 'deliveryPincode';
  if (/^(?:deliverylocation|destination|location|site)$/.test(clean)) return 'deliveryLocation';
  if (/^(?:category|majorcategory|minorcategory)$/.test(clean)) return 'category';
  if (/^(?:sno|slno|srno|itemno|no)$/.test(clean)) return 'sNo';
  return null;
}

/**
 * Coerce raw string/cell into a positive quantity number.
 * Returns null if missing, non-numeric, or <= 0 according to existing validation rules.
 */
function parseValidQuantity(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const cleaned = str.replace(/,/g, '');
  const match = cleaned.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

/**
 * Parses pipe-delimited spreadsheet text flattened from workbooks across all worksheets.
 * Extracts item description, quantity, unit, specification, brand, prices, and dates.
 * Only accepts valid items: non-empty description and valid positive quantity (> 0).
 */
function extractSpreadsheetLineItems(text) {
  if (typeof text !== 'string' || !text.trim()) return [];

  // Parse sheets
  const sheetBlocks = [];
  const sheetHeaderRegex = /(?:^|\n\n|\r\n\r\n)SHEET:\s*([^\n\r]+)[\n\r]+/g;
  const matches = [...text.matchAll(sheetHeaderRegex)];

  if (matches.length === 0) {
    sheetBlocks.push({ sheetName: '', content: text });
  } else {
    for (let i = 0; i < matches.length; i++) {
      const sheetName = matches[i][1].trim();
      const startIndex = matches[i].index + matches[i][0].length;
      const endIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const content = text.slice(startIndex, endIndex).trim();
      sheetBlocks.push({ sheetName, content });
    }
  }

  const allItems = [];

  for (const sheet of sheetBlocks) {
    const lines = sheet.content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.includes('|'));
    if (lines.length === 0) continue;

    // Detect header row
    let headerIndex = -1;
    let headerColMap = new Map();

    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const cells = lines[i].split('|').map((c) => c.trim());
      const tempMap = new Map();
      let recognizedCount = 0;

      cells.forEach((cell, idx) => {
        const field = matchHeaderField(cell);
        if (field && field !== 'sNo') {
          tempMap.set(field, idx);
          recognizedCount++;
        }
      });

      if (recognizedCount >= 2 || (tempMap.has('itemDescription') && tempMap.has('quantity'))) {
        headerIndex = i;
        headerColMap = tempMap;
        break;
      }
    }

    const dataLines = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;

    // Fallback column inference if no explicit header row was detected
    if (headerIndex === -1 && lines.length > 0) {
      const firstRowCells = lines[0].split('|').map((c) => c.trim());
      firstRowCells.forEach((cell, idx) => {
        const qtyVal = parseValidQuantity(cell);
        if (qtyVal !== null && !headerColMap.has('quantity')) {
          headerColMap.set('quantity', idx);
        } else if (/^(?:nos|units|meters|m|kg|pcs|sets|bags|boxes|mtrs|cu\.m|sq\.ft|ltrs|liters|pairs)$/i.test(cell) && !headerColMap.has('unit')) {
          headerColMap.set('unit', idx);
        } else if (cell.length > 0 && !headerColMap.has('itemDescription')) {
          headerColMap.set('itemDescription', idx);
        } else if (cell.length > 0 && !headerColMap.has('specification')) {
          headerColMap.set('specification', idx);
        }
      });
    }

    const descIdx = headerColMap.get('itemDescription') ?? 0;
    const qtyIdx = headerColMap.get('quantity') ?? 1;
    const unitIdx = headerColMap.get('unit');
    const specIdx = headerColMap.get('specification');
    const unitPriceIdx = headerColMap.get('unitPrice');
    const totalPriceIdx = headerColMap.get('totalPrice');
    const brandIdx = headerColMap.get('brand');
    const dateIdx = headerColMap.get('targetDate');
    const cityIdx = headerColMap.get('deliveryCity');
    const stateIdx = headerColMap.get('deliveryState');
    const pincodeIdx = headerColMap.get('deliveryPincode');
    const locIdx = headerColMap.get('deliveryLocation');
    const catIdx = headerColMap.get('category');

    for (const line of dataLines) {
      const cells = line.split('|').map((c) => c.trim());
      if (cells.length < 2) continue;

      const rawDesc = cells[descIdx] || '';
      const rawQty = cells[qtyIdx];

      // Validate quantity according to existing validation rules
      const validQty = parseValidQuantity(rawQty);
      if (validQty === null) {
        // Skip rows without valid positive quantities
        continue;
      }

      const itemName = rawDesc.trim();
      if (!itemName) {
        // Skip rows without description
        continue;
      }

      // Skip lines that look like repeating headers
      if (matchHeaderField(itemName)) continue;

      let spec = specIdx !== undefined && cells[specIdx] ? cells[specIdx].trim() : '';
      let cleanItemName = itemName;

      // If no explicit specification column, check if description can be split
      if (!spec && itemName.includes(',')) {
        const parts = itemName.split(',').map((p) => p.trim());
        if (parts.length >= 2) {
          cleanItemName = parts[0];
          spec = parts.slice(1).join(', ');
        }
      }

      const rawUnit = unitIdx !== undefined ? cells[unitIdx] : '';
      const unit = rawUnit ? rawUnit.trim() : 'Nos';

      const row = {
        itemName: cleanItemName,
        quantity: validQty,
        unit,
        technicalSpecs: spec,
        category: (catIdx !== undefined && cells[catIdx]) ? cells[catIdx].trim() : (sheet.sheetName || ''),
        targetDate: dateIdx !== undefined && cells[dateIdx] ? cells[dateIdx].trim() : '',
        unitPrice: unitPriceIdx !== undefined ? normalizeAmount(cells[unitPriceIdx]) : null,
        totalPrice: totalPriceIdx !== undefined ? normalizeAmount(cells[totalPriceIdx]) : null,
      };

      if (brandIdx !== undefined && cells[brandIdx]) row.brand = cells[brandIdx].trim();
      if (locIdx !== undefined && cells[locIdx]) row.deliveryLocation = cells[locIdx].trim();
      if (cityIdx !== undefined && cells[cityIdx]) row.deliveryCity = cells[cityIdx].trim();
      if (stateIdx !== undefined && cells[stateIdx]) row.deliveryState = cells[stateIdx].trim();
      if (pincodeIdx !== undefined && cells[pincodeIdx]) row.deliveryPincode = cells[pincodeIdx].trim();

      allItems.push(row);
    }
  }

  return allItems;
}

/**
 * The category instruction block, listing only names held in the category master.
 * The model may not invent a category: a stated category that matches nothing in
 * the master comes back null, and classification then falls back to the items.
 */
function categoryPromptBlock() {
  const { majors, minors } = taxonomyCategoryNames();
  if (majors.length === 0 && minors.length === 0) return '';
  return `

CATEGORY LIST
If the document states a procurement category (for example "Category: Civil Works"), set "category" to the matching name copied exactly from this list. Use a major category name or a minor category name. Never invent a category, never reword one, and never use a name that is not in this list. If nothing stated matches the list, return null.
Major categories: ${majors.join(' | ')}
Minor categories: ${minors.join(' | ')}`;
}

/**
 * Build the generateContent request body, sending the document either as text or
 * as inline base64 data depending on what the caller could produce.
 */
function buildRequestBody({ documentText, inlineData, mimeType, fileName }) {
  const parts = [{ text: EXTRACTION_PROMPT + categoryPromptBlock() }];

  if (fileName) {
    parts.push({ text: `\nDOCUMENT FILE NAME: ${fileName}` });
  }
  if (documentText) {
    parts.push({ text: `\nDOCUMENT TEXT:\n${documentText}` });
  }
  if (inlineData) {
    parts.push({ inline_data: { mime_type: mimeType, data: inlineData } });
  }

  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: GEMINI_CONFIG.TEMPERATURE,
      response_mime_type: 'application/json',
      max_output_tokens: 32768,
    },
  };
}

let activeKeyIndex = 0;

function getActiveKeyIndex() {
  return activeKeyIndex;
}

function setActiveKeyIndex(idx) {
  activeKeyIndex = Number(idx) || 0;
}

/**
 * Call one model, returning its parsed JSON or throwing so the caller can try
 * the next model in the chain. Supports multiple API keys with recursive loop failover.
 */
async function callModel(model, requestBody, timeoutMs = GEMINI_CONFIG.REQUEST_TIMEOUT_MS) {
  const url = `${GEMINI_CONFIG.BASE_URL}/${model}:generateContent`;
  const keys = resolveApiKeys();
  if (keys.length === 0) {
    throw new Error('No Gemini API key available');
  }

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyIdx = (activeKeyIndex + attempt) % keys.length;
    const apiKey = keys[keyIdx];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header auth keeps the key out of the URL and therefore out of logs.
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Gemini ${model} responded ${res.status}: ${detail.slice(0, 200)}`);
      }

      const payload = await res.json();
      const parsed = parseExtractionJson(extractResponseText(payload));
      if (!parsed) {
        throw new Error(`Gemini ${model} returned no parseable JSON`);
      }
      activeKeyIndex = keyIdx;
      return parsed;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw err;
      }
      logger.warn(
        `Gemini API key ${keyIdx + 1}/${keys.length} failed for ${model}: ${err.message}. Rotating to next key...`,
        { keyIndex: keyIdx + 1, totalKeys: keys.length, model, error: err.message },
        'GEMINI'
      );
      if (attempt < keys.length - 1) {
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Extract line items from a document.
 *
 * Never throws: every failure mode is reported as a status the caller can act on.
 *
 * @param {Object} input
 * @param {string} [input.documentText] flattened text extracted by the client
 * @param {string} [input.inlineData] base64 document body for PDFs and images
 * @param {string} [input.mimeType] required when inlineData is supplied
 * @param {string} [input.fileName]
 * @returns {Promise<{status: string, lineItems: Array<Object>, model: string|null,
 *   documentTitle: string|null, category: string|null, deliveryDate: string|null,
 *   estimatedBudget: number|null, error: string|null}>}
 */
async function extractLineItems(input = {}) {
  const { documentText, inlineData, mimeType, fileName } = input;

  const base = {
    lineItems: [],
    model: null,
    documentTitle: null,
    category: null,
    deliveryDate: null,
    estimatedBudget: null,
    error: null,
  };

  if (!isConfigured()) {
    logger.warn('Gemini extraction skipped: GEMINI_API_KEY is not set', {}, 'GEMINI');
    return { ...base, status: EXTRACTION_STATUS.NOT_CONFIGURED };
  }

  const trimmedText = typeof documentText === 'string' ? documentText.trim() : '';
  if (!trimmedText && !inlineData) {
    return { ...base, status: EXTRACTION_STATUS.NO_CONTENT };
  }

  const tabularItems = (trimmedText && (trimmedText.includes('SHEET:') || trimmedText.includes('|')))
    ? extractSpreadsheetLineItems(trimmedText)
    : [];

  if (inlineData) {
    if (!mimeType || !GEMINI_INLINE_MIME_TYPES.includes(mimeType)) {
      return { ...base, status: EXTRACTION_STATUS.UNSUPPORTED_TYPE };
    }
    // base64 inflates by 4/3; compare the decoded size against the cap.
    const approxBytes = Math.floor((inlineData.length * 3) / 4);
    if (approxBytes > GEMINI_CONFIG.MAX_DOCUMENT_BYTES) {
      return { ...base, status: EXTRACTION_STATUS.DOCUMENT_TOO_LARGE };
    }
  }

  // Loaded before the request is built so the category list is current.
  await ensureTaxonomyLoaded();
  const requestBody = buildRequestBody({
    // Oversized text is truncated rather than rejected: the head of a BOQ still
    // carries the line items, and a hard failure would lose them entirely.
    documentText: trimmedText.slice(0, GEMINI_CONFIG.MAX_DOCUMENT_TEXT_CHARS),
    inlineData,
    mimeType,
    fileName,
  });

  const failures = [];
  // One shared deadline for the whole chain, so a run of slow failures degrades
  // into a reported fallback instead of a request nobody is still waiting on.
  const deadline = Date.now() + GEMINI_CONFIG.TOTAL_BUDGET_MS;

  for (const model of resolveModelChain()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < GEMINI_CONFIG.MIN_ATTEMPT_MS) {
      failures.push(`skipped ${model}: extraction time budget exhausted`);
      logger.warn(
        `Gemini extraction budget exhausted before trying ${model}`,
        { budgetMs: GEMINI_CONFIG.TOTAL_BUDGET_MS },
        'GEMINI'
      );
      break;
    }

    try {
      // Never overrun the shared deadline, even if the per-attempt timeout is larger.
      const parsed = await callModel(model, requestBody, Math.min(GEMINI_CONFIG.REQUEST_TIMEOUT_MS, remainingMs));
      let lineItems = toRawLineItems(parsed);

      if (tabularItems.length > lineItems.length) {
        logger.info(
          `Tabular extraction identified ${tabularItems.length} valid line items across worksheets vs ${lineItems.length} from ${model}. Preserving all valid items.`,
          { tabularCount: tabularItems.length, modelCount: lineItems.length, model },
          'GEMINI'
        );
        lineItems = tabularItems;
      }

      if (lineItems.length === 0) {
        logger.info(`Gemini ${model} found no line items in ${fileName || 'document'}`, {}, 'GEMINI');
        return { ...base, status: EXTRACTION_STATUS.NO_ITEMS_FOUND, model };
      }

      logger.info(
        `Gemini ${model} extracted ${lineItems.length} line items from ${fileName || 'document'}`,
        { model, itemCount: lineItems.length },
        'GEMINI'
      );

      return {
        status: EXTRACTION_STATUS.SUCCESS,
        lineItems,
        model,
        documentTitle: typeof parsed.documentTitle === 'string' ? parsed.documentTitle : null,
        category: typeof parsed.category === 'string' ? parsed.category : null,
        deliveryDate: typeof parsed.deliveryDate === 'string' ? parsed.deliveryDate : null,
        deliveryLocation: typeof parsed.deliveryLocation === 'string' ? parsed.deliveryLocation : null,
        deliveryCity: typeof parsed.deliveryCity === 'string' ? parsed.deliveryCity : null,
        deliveryState: typeof parsed.deliveryState === 'string' ? parsed.deliveryState : null,
        deliveryPincode: typeof parsed.deliveryPincode === 'string' ? parsed.deliveryPincode : null,
        estimatedBudget: normalizeAmount(parsed.estimatedBudget),
        error: null,
      };
    } catch (err) {
      failures.push(`${model}: ${err.message}`);
      logger.warn(`Gemini extraction attempt failed on ${model}`, { error: err.message }, 'GEMINI');
    }
  }

  return {
    ...base,
    status: EXTRACTION_STATUS.AI_FAILED,
    error: failures.join(' | '),
  };
}

/**
 * Run an arbitrary JSON-returning prompt through the same model chain, deadline
 * and timeout handling as extraction.
 *
 * Exists so callers that need a different prompt (the RFQ summary, for one) do
 * not each re-implement the transport, the fallback chain and the shared budget.
 * Like extractLineItems it never throws: the caller gets a status to act on.
 *
 * @param {object} input
 * @param {string} input.prompt the full prompt text
 * @param {string} [input.label] used in logs to say what was being generated
 * @returns {Promise<{status: string, data: object|null, model: string|null, error: string|null}>}
 */
async function generateJson(input = {}) {
  const { prompt, label = 'generation' } = input;

  const base = { data: null, model: null, error: null };

  if (!isConfigured()) {
    logger.warn(`Gemini ${label} skipped: GEMINI_API_KEY is not set`, {}, 'GEMINI');
    return { ...base, status: EXTRACTION_STATUS.NOT_CONFIGURED };
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return { ...base, status: EXTRACTION_STATUS.NO_CONTENT };
  }

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: GEMINI_CONFIG.TEMPERATURE,
      response_mime_type: 'application/json',
    },
  };

  const failures = [];
  const deadline = Date.now() + GEMINI_CONFIG.TOTAL_BUDGET_MS;

  for (const model of resolveModelChain()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < GEMINI_CONFIG.MIN_ATTEMPT_MS) {
      failures.push(`skipped ${model}: time budget exhausted`);
      break;
    }

    try {
      const parsed = await callModel(
        model,
        requestBody,
        Math.min(GEMINI_CONFIG.REQUEST_TIMEOUT_MS, remainingMs)
      );
      logger.info(`Gemini ${model} completed ${label}`, { model }, 'GEMINI');
      return { status: EXTRACTION_STATUS.SUCCESS, data: parsed, model, error: null };
    } catch (err) {
      failures.push(`${model}: ${err.message}`);
      logger.warn(`Gemini ${label} attempt failed on ${model}`, { error: err.message }, 'GEMINI');
    }
  }

  return { ...base, status: EXTRACTION_STATUS.AI_FAILED, error: failures.join(' | ') };
}

function cleanEmailText(text = '') {
  return String(text || '')
    .replace(/\u00e2\u201a\u00b9/g, '₹') // mojibake â‚¹
    .replace(/&#8377;|&amp;#8377;|&#x20b9;|&amp;#x20b9;|&rupee;/gi, '₹')
    .replace(/&nbsp;|&amp;nbsp;|\u00a0/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/**
 * Fallback heuristic/regex extraction when Gemini AI is not configured or fails.
 */
function extractQuotationFallback(text = '', rfqContext = {}) {
  const sanitized = cleanEmailText(text);
  const clean = sanitized.replace(/\r?\n/g, ' ');

  let unitPrice = 0;
  let totalPrice = 0;

  const unitMatch = clean.match(
    /(?:unit\s*price|price\s*per\s*unit|unit\s*rate|unit\s*cost|rate\s*per\s*unit|\brate\b)(?:\s*\([^)]*\)|\[[^\]]*\])?[\s:=~–—\-\/₹RsINR\.]*([\d,]+(?:\.\d+)?)/i
  );
  const totalMatch = clean.match(
    /(?:total\s*quoted\s*value|total\s*quoted\s*amount|total\s*order\s*value|total\s*value|total\s*cost|total\s*price|total\s*amount|grand\s*total|total\s*bid|total\s*quote|quoted\s*value)(?:\s*\([^)]*\)|\[[^\]]*\])?[\s:=~–—\-\/₹RsINR\.]*([\d,]+(?:\.\d+)?)/i
  ) || clean.match(/(?:\btotal\b)(?:\s*\([^)]*\)|\[[^\]]*\])?[\s:=~–—\-\/₹RsINR\.]*([\d,]+(?:\.\d+)?)(?!\s*(?:units?|nos?|items?|pcs?|pieces?|quantity|qty))/i);
  const generalPriceMatch =
    clean.match(/(?:(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?))/i) ||
    clean.match(/(?:price|quote|bid)[\s:=~–—\-\/]*([\d,]+(?:\.\d+)?)/i);

  const parseNum = (str) => (str ? Number(String(str).replace(/,/g, '')) : 0);

  if (unitMatch) unitPrice = parseNum(unitMatch[1]);
  if (totalMatch) totalPrice = parseNum(totalMatch[1]);
  if (!unitPrice && !totalMatch && generalPriceMatch) unitPrice = parseNum(generalPriceMatch[1]);

  const rfqItems = rfqContext.extractedEntities || rfqContext.lineItems || [];
  const rfqQty = rfqItems.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0) || 1;

  if (unitPrice > 0 && !totalPrice) {
    totalPrice = unitPrice * rfqQty;
  } else if (totalPrice > 0 && !unitPrice) {
    unitPrice = Math.round(totalPrice / rfqQty);
  }

  let leadTimeDays = 7;
  const leadMatch = clean.match(/(?:lead\s*time|delivery\s*time|delivery\s*period|dispatch\s*in)[\s:=]*(\d+)\s*(days?|weeks?|months?)/i) ||
    clean.match(/(\d+)\s*(?:working\s*)?(days?|weeks?)\s*(?:delivery|lead\s*time|dispatch)/i);
  if (leadMatch) {
    const val = Number(leadMatch[1]);
    const unit = (leadMatch[2] || '').toLowerCase();
    if (unit.startsWith('week')) leadTimeDays = val * 7;
    else if (unit.startsWith('month')) leadTimeDays = val * 30;
    else leadTimeDays = val;
  }

  let warrantyYears = 1;
  const warMatch = clean.match(/(?:warranty|guarantee)[\s:=]*(\d+)\s*(years?|months?)/i) ||
    clean.match(/(\d+)\s*(years?|months?)\s*(?:warranty|guarantee)/i);
  if (warMatch) {
    const val = Number(warMatch[1]);
    const unit = (warMatch[2] || '').toLowerCase();
    if (unit.startsWith('month')) warrantyYears = Math.max(1, Math.round(val / 12));
    else warrantyYears = val;
  }

  let paymentTerms = 'Standard Terms';
  const payMatch = sanitized.match(/(?:payment\s*terms?|payment)[\s:=]*([^\n\r,;\.]{2,40})/i);
  if (payMatch) {
    paymentTerms = payMatch[1].replace(/(?:taxes|gst|freight|remarks|delivery).*/i, '').trim();
  }

  let taxes = 0;
  const taxMatch = clean.match(/(?:gst|tax(?:es)?)[\s:=@]*(\d+(?:\.\d+)?)\s*%/i);
  if (taxMatch && totalPrice > 0) {
    taxes = Math.round((totalPrice * Number(taxMatch[1])) / 100);
  }

  let deliveryCharges = 0;
  const delMatch = clean.match(/(?:delivery\s*charges?|freight\s*charges?|freight|shipping(?:\s*charges?)?)[\s:=₹RsINR\.]*([\d,]+(?:\.\d+)?)/i);
  if (delMatch) {
    deliveryCharges = parseNum(delMatch[1]);
  }

  const lineItemQuotes = rfqItems.map((rfqItem, idx) => {
    const itemName = rfqItem.itemName || rfqItem.description || `Item ${idx + 1}`;
    const qty = Number(rfqItem.quantity) || 1;
    let itemUnitPrice = unitPrice;

    // Search for item-specific price in the email text
    const escaped = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).slice(0, 2).join('\\s+');
    const itemRegex = new RegExp(
      `(?:${escaped})[^\\n\\r]*?(?:INR|Rs\\.?|₹)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:per|/|unit|each|piece)?`,
      'i'
    );
    let itemMatch = sanitized.match(itemRegex);
    if (!itemMatch) {
      const itemBlockRegex = new RegExp(
        `(?:${escaped})[\\s\\S]{0,140}?(?:unit\\s*price|rate|price|quote)(?:\\s*\\([^)]*\\)|\\[[^\\]]*\\])?[\\s:=~–—\\-\\/₹RsINR\\.]*([\\d,]+(?:\\.\\d+)?)`,
        'i'
      );
      itemMatch = sanitized.match(itemBlockRegex);
    }
    if (itemMatch) {
      const parsed = parseNum(itemMatch[1]);
      if (parsed > 0) itemUnitPrice = parsed;
    }

    return {
      itemName,
      quantity: qty,
      unit: rfqItem.unit || 'Units',
      unitPrice: itemUnitPrice || 0,
      totalPrice: (itemUnitPrice || 0) * qty,
      tax: taxes ? Math.round(taxes / (rfqItems.length || 1)) : 0,
      deliveryDate: rfqItem.targetDate || rfqContext.targetDeliveryDate || '',
    };
  });

  const calculatedTotal = lineItemQuotes.reduce((acc, it) => acc + (it.totalPrice || 0), 0);
  if (calculatedTotal > 0) {
    totalPrice = calculatedTotal;
  }

  if (!unitPrice && lineItemQuotes.length > 0 && lineItemQuotes[0].unitPrice > 0) {
    unitPrice = lineItemQuotes[0].unitPrice;
  }

  return {
    unitPrice,
    totalPrice: totalPrice || unitPrice,
    leadTimeDays,
    warrantyYears,
    paymentTerms,
    remarks: 'Extracted from vendor email quotation reply',
    taxes,
    deliveryCharges,
    complianceStatus: 'Fully Compliant',
    lineItemQuotes,
    extractionMethod: 'heuristic_fallback',
  };
}

/**
 * Extract structured vendor quotation details from email content for an RFQ.
 *
 * @param {object} input
 * @param {string} input.bodyText - Email body text (or flattened HTML)
 * @param {string} [input.subject] - Email subject
 * @param {string} [input.fromAddress] - Vendor email
 * @param {object} [rfqContext] - Target RFQ metadata for matching line items
 * @returns {Promise<object>} Extracted quotation payload
 */
async function extractQuotationFromEmail(input = {}, rfqContext = {}) {
  const text = input.bodyText || input.text || '';
  const rfqItems = rfqContext.extractedEntities || rfqContext.lineItems || [];

  if (!isConfigured()) {
    logger.info('Extracting quotation details via heuristic parser (API key not configured)', {}, 'GEMINI');
    return extractQuotationFallback(text, rfqContext);
  }

  const rfqSummary = {
    rfqNumber: rfqContext.rfqNumber || 'RFQ',
    title: rfqContext.title || '',
    category: rfqContext.category || '',
    budget: rfqContext.budget || 0,
    lineItems: rfqItems.map((item, idx) => ({
      index: idx + 1,
      itemName: item.itemName || item.description || '',
      quantity: Number(item.quantity) || 1,
      unit: item.unit || 'Units',
      specification: item.technicalSpecs || item.specification || '',
    })),
  };

  const prompt = `You are an enterprise procurement bid extraction system.
Analyze the following vendor email quotation response for the given RFQ and extract all commercial and technical bid parameters in strict JSON format.

RFQ DETAILS:
${JSON.stringify(rfqSummary, null, 2)}

VENDOR EMAIL CONTENT:
Subject: ${input.subject || ''}
From: ${input.fromAddress || ''}
Body:
${text}

Extract and return ONLY a JSON object with this EXACT structure:
{
  "unitPrice": Number (primary or base unit price per item, non-negative number),
  "totalPrice": Number (grand total quoted amount for the RFQ, non-negative number),
  "leadTimeDays": Number (delivery lead time in days, integer >= 0),
  "warrantyYears": Number (warranty period in years, integer >= 0),
  "paymentTerms": "String (e.g. Net 30, 100% advance, 30 days against invoice, or as stated)",
  "complianceStatus": "String (one of: 'Fully Compliant', 'Minor Exception', 'Pending Review')",
  "remarks": "String (any vendor notes, exclusions, or commercial conditions stated in the email)",
  "taxes": Number (total tax or GST amount if stated or calculated, else 0),
  "deliveryCharges": Number (freight or delivery charges if stated, else 0),
  "deliveryDate": "String in YYYY-MM-DD if explicit delivery date is stated, else null",
  "quotationValidity": "String (quotation validity period e.g. '30 days', '15 days', or null)",
  "lineItemQuotes": [
    {
      "itemName": "String (matched RFQ line item name)",
      "quantity": Number (quoted quantity),
      "unitPrice": Number (unit rate quoted for this specific item),
      "totalPrice": Number (line total quoted for this specific item),
      "tax": Number (tax amount for this line item, else 0),
      "deliveryDate": "String in YYYY-MM-DD or null"
    }
  ]
}

If specific values are missing from the email, provide reasonable procurement defaults (e.g. leadTimeDays: 7, warrantyYears: 1, paymentTerms: "Standard Terms", complianceStatus: "Fully Compliant") based on the text.
Do NOT include markdown fences, prose or explanation outside the JSON object.`;

  const result = await generateJson({ prompt, label: 'vendor-quote-extraction' });

  if (result.status === EXTRACTION_STATUS.SUCCESS && result.data && typeof result.data === 'object') {
    const data = result.data;
    let unitPrice = normalizeAmount(data.unitPrice) || 0;
    let totalPrice = normalizeAmount(data.totalPrice) || (unitPrice * (rfqItems.length || 1));

    if (totalPrice > 0 && (!unitPrice || unitPrice === 0)) {
      unitPrice = Math.round(totalPrice / (rfqItems.length || 1));
    }

    const leadTimeDays = Number(data.leadTimeDays) || 7;
    const warrantyYears = Number(data.warrantyYears) || 1;
    const paymentTerms = String(data.paymentTerms || 'Standard Terms').trim();
    const complianceStatus = ['Fully Compliant', 'Minor Exception', 'Pending Review'].includes(data.complianceStatus)
      ? data.complianceStatus
      : 'Fully Compliant';
    const remarks = String(data.remarks || '').trim();
    const taxes = normalizeAmount(data.taxes) || 0;
    const deliveryCharges = normalizeAmount(data.deliveryCharges) || 0;

    let lineItemQuotes = Array.isArray(data.lineItemQuotes) && data.lineItemQuotes.length > 0
      ? data.lineItemQuotes.map((lq, idx) => {
          const lqUnit = normalizeAmount(lq.unitPrice) || unitPrice || 0;
          const lqQty = Number(lq.quantity) || Number(rfqItems[idx]?.quantity) || 1;
          const lqTotal = normalizeAmount(lq.totalPrice) || (lqUnit * lqQty);
          return {
            itemName: lq.itemName || rfqItems[idx]?.itemName || `Item ${idx + 1}`,
            quantity: lqQty,
            unitPrice: lqUnit,
            totalPrice: lqTotal,
            tax: normalizeAmount(lq.tax) || 0,
            deliveryDate: lq.deliveryDate || null,
          };
        })
      : rfqItems.map((rfqItem, idx) => ({
          itemName: rfqItem.itemName || rfqItem.description || `Item ${idx + 1}`,
          quantity: Number(rfqItem.quantity) || 1,
          unitPrice: unitPrice || 0,
          totalPrice: (unitPrice || 0) * (Number(rfqItem.quantity) || 1),
          tax: taxes ? Math.round(taxes / (rfqItems.length || 1)) : 0,
          deliveryDate: rfqItem.targetDate || rfqContext.targetDeliveryDate || null,
        }));

    if (!unitPrice && lineItemQuotes.length > 0 && lineItemQuotes[0].unitPrice > 0) {
      unitPrice = lineItemQuotes[0].unitPrice;
      if (!totalPrice) {
        totalPrice = lineItemQuotes.reduce((acc, it) => acc + (it.totalPrice || 0), 0);
      }
    }

    return {
      unitPrice,
      totalPrice: totalPrice || unitPrice,
      leadTimeDays,
      warrantyYears,
      paymentTerms,
      complianceStatus,
      remarks,
      taxes,
      deliveryCharges,
      deliveryDate: data.deliveryDate || null,
      quotationValidity: data.quotationValidity || null,
      lineItemQuotes,
      extractionMethod: 'gemini_ai',
    };
  }

  logger.warn('Gemini quotation extraction fell back to heuristic parser', { status: result.status, error: result.error }, 'GEMINI');
  return extractQuotationFallback(text, rfqContext);
}

module.exports = {
  EXTRACTION_STATUS,
  EXTRACTION_PROMPT,
  isConfigured,
  resolveModelChain,
  resolveApiKeys,
  getActiveKeyIndex,
  setActiveKeyIndex,
  callModel,
  generateJson,
  extractResponseText,
  parseExtractionJson,
  toRawLineItems,
  buildRequestBody,
  extractLineItems,
  extractQuotationFromEmail,
  extractQuotationFallback,
  extractSpreadsheetLineItems,
  parseValidQuantity,
  matchHeaderField,
};
