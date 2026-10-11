// ==============================================================================
// LARGE FILE STREAMING INGESTION SERVICE
// ==============================================================================
// Handles ingestion of large CSV files (tens of thousands of rows — see
// VENDOR_INGESTION_CONFIG.MAX_VENDOR_MASTER_ROWS/MAX_PO_ROWS for the real
// caps). Processes rows in configurable chunks, persists live progress to
// `ingestion_jobs` and `vendor_ingestion_sessions`, and continues in the
// background even if the buyer closes the modal or browser — on Workers,
// "background" means handed to ctx.waitUntil() (see the getWaitUntil() calls
// below), since an unawaited promise with nothing extending it can be
// cancelled the instant the response is sent.
//
// The raw upload used to be written to a local temp file (fs.createWriteStream)
// and streamed back off disk. Cloudflare Workers has no persistent local
// filesystem at all, so that produced a job that looked started but could
// never actually read its own file back — the upload now goes to R2 (the
// same store RFQ attachments already use on this deployment) instead, via
// r2Client/@aws-sdk/client-s3. It's read back as one buffered object rather
// than a live stream: bufferBody's for-await-of pattern is what's already
// proven to work against this SDK on Workers (see rfqAttachmentService.js),
// and the real row caps above make a single ~75MB-max buffer safe — nothing
// like the "1,000,000+ rows" this file's old top comment aspired to.
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const queries = require('../db/vendorIngestionQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const r2Client = require('./r2Client');
const { getWaitUntil } = require('../db/d1Bridge');
const { logger } = require('./loggerService');
const {
  VENDOR_INGESTION_SESSION_STATUS,
  VENDOR_INGESTION_STEP,
  VENDOR_INGESTION_CONFIG,
} = require('../config/constants');

/** Same buffering pattern rfqAttachmentService.js already uses against this SDK. */
async function bufferBody(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Store a raw upload in R2 ahead of background processing. Throws if R2 isn't configured. */
async function uploadToR2(key, buffer) {
  const binding = r2Client.getBinding();
  if (binding) {
    // Native R2 binding — see r2Client.js's getBinding() for why this is
    // preferred over the S3Client path below on Workers.
    await binding.put(key, buffer, { httpMetadata: { contentType: 'text/csv' } });
    return;
  }
  const client = r2Client.getClient();
  if (!client) throw new Error('R2 storage is not configured — cannot accept a large file upload.');
  await client.send(
    new PutObjectCommand({ Bucket: r2Client.bucket(), Key: key, Body: buffer, ContentType: 'text/csv' })
  );
}

/** Read the whole uploaded CSV back, or null if it's gone (R2 unconfigured, already cleaned up, etc). */
async function downloadFromR2(key) {
  const binding = r2Client.getBinding();
  if (binding) {
    try {
      const object = await binding.get(key);
      if (!object) return null;
      return Buffer.from(await object.arrayBuffer());
    } catch (err) {
      logger.warn('Large-file R2 download failed', { key, error: err.message }, 'LARGE_FILE_INGESTION');
      return null;
    }
  }
  const client = r2Client.getClient();
  if (!client) return null;
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: r2Client.bucket(), Key: key }));
    return bufferBody(response.Body);
  } catch (err) {
    logger.warn('Large-file R2 download failed', { key, error: err.message }, 'LARGE_FILE_INGESTION');
    return null;
  }
}

/** Best-effort cleanup — the object outliving one failed delete is not itself a correctness problem. */
async function deleteFromR2(key) {
  const binding = r2Client.getBinding();
  if (binding) {
    try {
      await binding.delete(key);
    } catch (err) {
      logger.warn('Failed to clean up R2 ingestion upload', { key, error: err.message }, 'LARGE_FILE_INGESTION');
    }
    return;
  }
  const client = r2Client.getClient();
  if (!client) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: r2Client.bucket(), Key: key }));
  } catch (err) {
    logger.warn('Failed to clean up R2 ingestion upload', { key, error: err.message }, 'LARGE_FILE_INGESTION');
  }
}

const LOG_CATEGORY = 'LARGE_FILE_INGESTION';
const DEFAULT_BATCH_SIZE = 500;
const activeCancellations = new Set();

/** Resolve organization ID from session user or session database record */
async function resolveOrganizationId(sessionUser, sessionId = null) {
  if (sessionUser) {
    if (sessionUser.organizationId) return sessionUser.organizationId;
    if (sessionUser.organization_id) return sessionUser.organization_id;
    if (sessionUser.orgId) return sessionUser.orgId;
    if (sessionUser.sub) {
      try {
        const lookup = await buyerProfileQueries.findProfileByUserId(sessionUser.sub);
        if (lookup && lookup.found && lookup.profile && lookup.profile.organizationId) {
          return lookup.profile.organizationId;
        }
      } catch (e) {
        // continue
      }
    }
    if (sessionUser.userId || sessionUser.id) {
      try {
        const lookup = await buyerProfileQueries.findProfileByUserId(sessionUser.userId || sessionUser.id);
        if (lookup && lookup.found && lookup.profile && lookup.profile.organizationId) {
          return lookup.profile.organizationId;
        }
      } catch (e) {
        // continue
      }
    }
  }

  if (sessionId) {
    try {
      const sess = await queries.findSessionById(sessionId);
      if (sess && sess.organizationId) {
        return sess.organizationId;
      }
    } catch (e) {
      // continue
    }
  }

  return null;
}

/** Split a CSV line respecting quotes */
function parseCsvLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      if (inQuotes && line[i + 1] === char) {
        current += char;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Fuzzy map header names to standard keys */
function extractHeaderIndices(headers, type) {
  const map = {};
  const cleaned = headers.map((h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  function findIndex(aliases) {
    for (const alias of aliases) {
      const aliasClean = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      const idx = cleaned.findIndex((c) => c === aliasClean || c.includes(aliasClean) || aliasClean.includes(c));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  if (type === 'VENDOR_MASTER') {
    map.vendorCode = findIndex(['vendorcode', 'vendor code', 'code', 'vendor id', 'supplier code', 'id']);
    map.companyName = findIndex(['companyname', 'company name', 'vendor name', 'supplier', 'name', 'vendor', 'supplier name']);
    map.contactPerson = findIndex(['contactperson', 'contact person', 'contact', 'person', 'representative', 'contact person name']);
    map.email = findIndex(['email', 'email id', 'email_id', 'mail', 'corporate email']);
    map.phone = findIndex(['phone', 'mobile', 'contact number', 'phone number', 'telephone', 'mobile number']);
    map.address = findIndex(['address', 'location', 'city', 'plant location', 'street', 'office address']);
    map.gstin = findIndex(['gstnumber', 'gstin', 'gst', 'gst number', 'tax id', 'gst no']);
    map.rating = findIndex(['vendorratingscore', 'rating', 'score', 'vendor rating', 'rating 0 100', 'performance score']);
  } else {
    // PO_DUMP
    map.poNumber = findIndex(['ponumber', 'po number', 'po #', 'po no', 'pono', 'order id', 'order number', 'order no']);
    map.poDate = findIndex(['podate', 'po date', 'date', 'order date', 'creation date']);
    map.vendorIdentifier = findIndex(['vendor name', 'vendor identifier', 'vendor', 'supplier name', 'supplier', 'company name', 'vendor code', 'vendor id']);
    map.itemName = findIndex(['line item description', 'line item', 'item description', 'description', 'item name', 'product description', 'product name', 'material description', 'material', 'service description', 'service', 'item']);
    map.specs = findIndex(['specs', 'specification', 'technical specs', 'specifications', 'details', 'item specs', 'grade']);
    map.quantity = findIndex(['quantity', 'qty', 'units', 'count', 'ordered qty', 'volume']);
    map.unit = findIndex(['unit', 'uom', 'unit of measure', 'units']);
    map.unitPrice = findIndex(['unit price inr', 'unit price', 'unit rate', 'rate inr', 'rate', 'price inr', 'price', 'item price']);
    map.spend = findIndex(['total spend inr', 'total spend (inr)', 'total spend rs', 'total spend', 'total amount inr', 'total amount (inr)', 'total amount', 'total inr', 'total (inr)', 'spend inr', 'spend', 'amount inr', 'amount', 'total value', 'po amount', 'total']);
    map.department = findIndex(['department', 'dept', 'cost center', 'plant', 'division', 'category', 'function']);
  }

  return map;
}

/**
 * Normalize a PO number to one consistent shape: trimmed, internal whitespace
 * collapsed, uppercased. Rows commonly spell the same PO as "po 4471",
 * "PO-4471" and "Po4471 " — without this they'd be treated as three
 * different purchase orders instead of deduping to one.
 */
function normalizePoNumber(raw) {
  const value = String(raw || '').trim().replace(/\s+/g, ' ');
  return value === '' ? '' : value.toUpperCase();
}

/**
 * Parse a PO date into a standard ISO (YYYY-MM-DD) string, trying the
 * formats actually seen in buyer PO exports: ISO itself, DD/MM/YYYY (and
 * DD-MM-YYYY), and whatever Date can parse natively (e.g. "15 Jun 2025").
 * Returns null rather than guessing when the value doesn't parse — a wrong
 * silent guess is worse than leaving the date blank for the buyer to fix.
 */
function normalizePoDate(raw) {
  const value = String(raw || '').trim();
  if (value === '') return null;

  // Numeric Excel date serial check (e.g. "45995.00011574074" or 45995)
  const num = Number(value);
  if (!isNaN(num) && isFinite(num) && !value.includes('-') && !value.includes('/') && !value.includes(':')) {
    if (num >= 1 && num <= 100000) {
      const utcDays = Math.floor(num - 25569);
      const d = new Date(utcDays * 86400 * 1000);
      if (!isNaN(d.getTime())) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    if (Number(month) <= 12) return `${dmy[3]}-${month}-${day}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

/** Lower-cased, trimmed email — so the same address in two different casings dedupes to one. */
function normalizeEmail(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value === '' ? '' : value;
}

/**
 * A single phone number in one standard shape: digits and a leading `+`
 * only, so "+91 98000-00000", "919800000000" and "98000 00000" all collapse
 * to the same value instead of being treated as separate contacts.
 */
function normalizePhone(raw) {
  const value = String(raw || '').trim();
  if (value === '') return '';
  const hasPlus = value.trim().startsWith('+');
  const digits = value.replace(/[^0-9]/g, '');
  if (digits === '') return '';
  return hasPlus ? `+${digits}` : digits;
}

/** Map row values array to object using header indices */
function mapRowValues(values, headerMap, type, rowIdx) {
  const get = (key) => {
    const idx = headerMap[key];
    if (idx !== undefined && idx !== -1 && values[idx] !== undefined) {
      return String(values[idx]).trim();
    }
    return '';
  };

  if (type === 'VENDOR_MASTER') {
    // Genuinely missing fields are left blank/null rather than filled with
    // invented placeholder data ("Supplier 7", "contact@supplier7.com") —
    // the buyer should see exactly what their file did and didn't supply,
    // not a fabricated row that looks real. Only companyName is required to
    // process the row at all (enforced in processVendorMasterBatch below).
    const companyName = get('companyName');
    const vendorCode = get('vendorCode') || null;
    const contactPerson = get('contactPerson') || null;
    const email = normalizeEmail(get('email')) || null;
    const phone = normalizePhone(get('phone')) || null;
    const address = get('address') || null;
    const gstin = get('gstin') || null;
    const ratingRaw = get('rating');
    const rating = ratingRaw && !isNaN(Number(ratingRaw)) ? Math.min(100, Math.max(0, Math.round(Number(ratingRaw)))) : null;

    return {
      sourceRowNumber: rowIdx + 1,
      vendorCode,
      companyName,
      contactPerson,
      email,
      phone,
      address,
      gstNumber: gstin,
      rating,
    };
  } else {
    // PO_DUMP — same principle: a PO row with only Vendor Name/Code, Item
    // Details and Category present should still process successfully (see
    // processPoDumpBatch's required-field check below), with every other
    // field left blank rather than invented.
    const poNumber = normalizePoNumber(get('poNumber')) || null;
    const poDate = normalizePoDate(get('poDate'));
    const vendorName = get('vendorIdentifier') || null;
    const itemDescription = get('itemName') || null;
    const specification = get('specs') || null;
    const qtyRaw = get('quantity');
    const quantity = qtyRaw && !isNaN(Number(String(qtyRaw).replace(/[^0-9.]/g, ''))) ? Math.max(1, Math.round(Number(String(qtyRaw).replace(/[^0-9.]/g, '')))) : 1;
    const uom = get('unit') || null;
    const unitPriceRaw = get('unitPrice');
    const spendRaw = get('spend');

    const parsedUnitPrice = unitPriceRaw && !isNaN(Number(String(unitPriceRaw).replace(/[^0-9.]/g, ''))) ? Number(String(unitPriceRaw).replace(/[^0-9.]/g, '')) : 0;
    const parsedSpend = spendRaw && !isNaN(Number(String(spendRaw).replace(/[^0-9.]/g, ''))) ? Number(String(spendRaw).replace(/[^0-9.]/g, '')) : 0;

    const spend = parsedSpend > 0 ? parsedSpend : parsedUnitPrice * quantity;
    const department = get('department') || null;

    return {
      sourceRowNumber: rowIdx + 1,
      poNumber,
      poDate,
      vendorName,
      vendorCode: vendorName && vendorName.startsWith('VND-') ? vendorName : null,
      itemDescription,
      specification,
      quantity,
      uom,
      spend,
      currency: 'INR',
      department,
    };
  }
}

/**
 * Process a batch of Vendor Master records into the database
 */
async function processVendorMasterBatch(sessionId, organizationId, batch) {
  const valid = [];
  const invalid = [];

  for (const row of batch) {
    const companyName = row.companyName || row.company_name || row.vendorName || row.name || '';
    if (!companyName || String(companyName).trim() === '') {
      invalid.push({ row, reason: 'Company Name is required' });
      continue;
    }
    valid.push({
      ...row,
      companyName: String(companyName).trim(),
    });
  }

  let imported = 0;
  let skipped = invalid.length;

  if (valid.length > 0) {
    try {
      const stored = await queries.bulkUpsertVendorMasterRecords(sessionId, organizationId, valid);
      imported = Array.isArray(stored) ? stored.length : (typeof stored === 'number' ? stored : valid.length);
    } catch (err) {
      logger.error('Failed to upsert vendor master batch', err, LOG_CATEGORY);
      skipped += valid.length;
      invalid.push({ reason: `Database error: ${err.message}` });
    }
  }

  return { imported, skipped, failed: invalid.length, errors: invalid.slice(0, 5) };
}

/**
 * Process a batch of PO Dump records into the database
 */
async function processPoDumpBatch(sessionId, organizationId, batch, session) {
  const valid = [];
  const invalid = [];

  // Minimum required to process a PO row at all: Vendor identity, Item
  // Details, and Category (the buyer's own wording for this). Everything
  // else (date, PO number, spend, UOM...) is accepted as-supplied and left
  // blank when absent — a PO missing only its spend figure should still be
  // extracted and processed, not rejected outright.
  for (const row of batch) {
    const vendorName = row.vendorName || row.vendorIdentifier || row.vendor_name || row.supplierName || row.companyName || '';
    const vendorCode = row.vendorCode || row.vendor_code || row.supplierCode || '';
    const itemDescription = row.itemDescription || row.itemName || row.description || '';
    const category = row.department || row.category || '';

    if (!vendorName && !vendorCode) {
      invalid.push({ row, reason: 'Vendor Name or Vendor Code is required' });
      continue;
    }
    if (!itemDescription) {
      invalid.push({ row, reason: 'Item Details are required' });
      continue;
    }
    if (!category) {
      invalid.push({ row, reason: 'Category is required' });
      continue;
    }

    const poDate = normalizePoDate(row.poDate || row.date);

    // Stamp inHorizon — a row with no parseable PO date can't be confirmed
    // inside the buyer's selected window, so it's counted as outside it
    // rather than silently included.
    const horizonConfigured = Boolean(session && session.horizonStart && session.horizonEnd);
    const inHorizon = !horizonConfigured
      ? true
      : Boolean(poDate) && poDate >= session.horizonStart && poDate <= session.horizonEnd;

    valid.push({
      ...row,
      poDate: poDate || row.poDate || null,
      vendorName: vendorName || `Vendor ${vendorCode}`,
      itemDescription,
      department: category,
      quantity: row.quantity !== undefined ? Number(row.quantity) || 1 : 1,
      spend: row.spend !== undefined ? Number(row.spend) || 0 : (Number(row.totalSpend) || 0),
      inHorizon,
    });
  }

  let imported = 0;
  let skipped = invalid.length;

  if (valid.length > 0) {
    try {
      const stored = await queries.bulkInsertPoLineItems(sessionId, organizationId, valid);
      imported = typeof stored === 'number' ? stored : (Array.isArray(stored) ? stored.length : valid.length);
    } catch (err) {
      logger.error('Failed to insert PO dump batch', err, LOG_CATEGORY);
      skipped += valid.length;
      invalid.push({ reason: `Database error: ${err.message}` });
    }
  }

  return { imported, skipped, failed: invalid.length, errors: invalid.slice(0, 5) };
}

/**
 * Execute background streaming ingestion of a CSV or TXT file
 */
async function streamProcessCsvFile({ jobId, sessionId, organizationId, r2Key, fileName, jobType, batchSize = DEFAULT_BATCH_SIZE }) {
  try {
    const session = await queries.findSession(sessionId, organizationId);
    if (!session) {
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        status: 'FAILED',
        errorMessage: 'Session not found',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    let totalLines = 0;
    let processedRecords = 0;
    let importedRecords = 0;
    let skippedRecords = 0;
    let failedRecords = 0;
    const recentErrors = [];

    try {
      // One R2 read for the whole upload — see this file's top comment for why
      // that's a safe amount to buffer (the real row caps top out ~75MB), and
      // why it's buffered rather than fed through as a live stream. The old
      // two-pass fs.createReadStream approach (open once just to count lines,
      // again to actually process) doesn't apply once the content already
      // sits in memory: the line count is immediate, and both "passes" below
      // read from the same buffered text instead of two separate disk/R2 reads.
      const buffer = await downloadFromR2(r2Key);
      if (!buffer) {
        await queries.updateIngestionJobProgress(jobId, organizationId, {
          status: 'FAILED',
          errorMessage: 'Uploaded file could not be read back from storage',
          completedAt: new Date().toISOString(),
        });
        return;
      }
      const text = buffer.toString('utf8');
      const allLines = text.split(/\r\n|\r|\n/);

      totalLines = Math.max(0, allLines.filter((line) => line.trim().length > 0).length - 1); // Exclude header line

      await queries.updateIngestionJobProgress(jobId, organizationId, {
        totalRecords: totalLines,
        status: 'PROCESSING',
      });

      let isHeader = true;
      let headerMap = null;
      let currentBatch = [];
      let delimiter = ',';

      for (const line of allLines) {
        if (!line || line.trim().length === 0) continue;

        if (isHeader) {
          if (line.includes('\t')) delimiter = '\t';
          else if (line.includes(';') && !line.includes(',')) delimiter = ';';
          const headers = parseCsvLine(line, delimiter);
          headerMap = extractHeaderIndices(headers, jobType);
          isHeader = false;
          continue;
        }

        if (activeCancellations.has(jobId) || activeCancellations.has(sessionId)) {
          logger.info(`Ingestion job ${jobId} cancelled by user`, {}, LOG_CATEGORY);
          await queries.updateIngestionJobProgress(jobId, organizationId, {
            status: 'FAILED',
            errorMessage: 'Cancelled by user',
            completedAt: new Date().toISOString(),
          });
          return;
        }

        const values = parseCsvLine(line, delimiter);
        const record = mapRowValues(values, headerMap, jobType, processedRecords);
        currentBatch.push(record);

        if (currentBatch.length >= batchSize) {
          let result;
          if (jobType === 'VENDOR_MASTER') {
            result = await processVendorMasterBatch(sessionId, organizationId, currentBatch);
          } else {
            result = await processPoDumpBatch(sessionId, organizationId, currentBatch, session);
          }

          processedRecords += currentBatch.length;
          importedRecords += result.imported;
          skippedRecords += result.skipped;
          failedRecords += result.failed;
          if (result.errors && result.errors.length > 0) {
            recentErrors.push(...result.errors);
          }

          currentBatch = [];

          // Update progress in database
          await queries.updateIngestionJobProgress(jobId, organizationId, {
            processedRecords,
            importedRecords,
            skippedRecords,
            failedRecords,
            errorDetails: recentErrors.slice(-10),
          });
        }
      }

      // Process remainder batch
      if (currentBatch.length > 0) {
        if (activeCancellations.has(jobId) || activeCancellations.has(sessionId)) {
          await queries.updateIngestionJobProgress(jobId, organizationId, {
            status: 'FAILED',
            errorMessage: 'Cancelled by user',
            completedAt: new Date().toISOString(),
          });
          return;
        }

        let result;
        if (jobType === 'VENDOR_MASTER') {
          result = await processVendorMasterBatch(sessionId, organizationId, currentBatch);
        } else {
          result = await processPoDumpBatch(sessionId, organizationId, currentBatch, session);
        }

        processedRecords += currentBatch.length;
        importedRecords += result.imported;
        skippedRecords += result.skipped;
        failedRecords += result.failed;
        if (result.errors && result.errors.length > 0) {
          recentErrors.push(...result.errors);
        }
      }

      // Finalize session counts and state
      if (jobType === 'VENDOR_MASTER') {
        const totalStored = await queries.countVendorMasterRecords(sessionId, organizationId);
        await queries.updateSession(sessionId, organizationId, {
          vendorMasterFileName: fileName,
          vendorMasterRowCount: totalStored,
          status:
            session.status === VENDOR_INGESTION_SESSION_STATUS.DRAFT
              ? VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED
              : session.status,
          currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.PO_DUMP),
        });
      } else {
        const counts = await queries.countPoLineItems(sessionId, organizationId);
        await queries.updateSession(sessionId, organizationId, {
          poFileName: fileName,
          poRowCount: counts.total,
          poInHorizonCount: counts.inHorizon,
          poOutsideHorizonCount: counts.outsideHorizon,
          status: VENDOR_INGESTION_SESSION_STATUS.PO_STORED,
          currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.AI_CATEGORY_JOIN),
        });
      }

      // Mark job completed
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        totalRecords: Math.max(totalLines, processedRecords),
        processedRecords,
        importedRecords,
        skippedRecords,
        failedRecords,
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        errorDetails: recentErrors.slice(-10),
      });

      logger.info(`Ingestion job ${jobId} completed`, { processedRecords, importedRecords, skippedRecords, failedRecords }, LOG_CATEGORY);
    } catch (err) {
      logger.error(`Ingestion job ${jobId} failed`, err, LOG_CATEGORY);
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        status: 'FAILED',
        errorMessage: err.message || 'Stream processing failure',
        completedAt: new Date().toISOString(),
      });
    }
  } finally {
    // Clean up the R2 upload unconditionally — deleteFromR2 is itself
    // best-effort (logs and swallows its own failure), so this never masks
    // whatever the try block above already reported.
    if (r2Key) {
      await deleteFromR2(r2Key);
    }
  }
}

/**
 * Process memory array or parsed chunks in background
 */
async function processArrayJob({ jobId, sessionId, organizationId, rows, fileName, jobType, batchSize = DEFAULT_BATCH_SIZE }) {
  try {
    const session = await queries.findSession(sessionId, organizationId);
    if (!session) {
      await queries.updateIngestionJobProgress(jobId, organizationId, {
        status: 'FAILED',
        errorMessage: 'Session not found',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    let processedRecords = 0;
    let importedRecords = 0;
    let skippedRecords = 0;
    let failedRecords = 0;
    const recentErrors = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      if (activeCancellations.has(jobId) || activeCancellations.has(sessionId)) {
        logger.info(`Array ingestion job ${jobId} cancelled by user`, {}, LOG_CATEGORY);
        await queries.updateIngestionJobProgress(jobId, organizationId, {
          status: 'FAILED',
          errorMessage: 'Cancelled by user',
          completedAt: new Date().toISOString(),
        });
        return;
      }

      const chunk = rows.slice(i, i + batchSize);
      let result;
      if (jobType === 'VENDOR_MASTER') {
        result = await processVendorMasterBatch(sessionId, organizationId, chunk);
      } else {
        result = await processPoDumpBatch(sessionId, organizationId, chunk, session);
      }

      processedRecords += chunk.length;
      importedRecords += result.imported;
      skippedRecords += result.skipped;
      failedRecords += result.failed;
      if (result.errors && result.errors.length > 0) {
        recentErrors.push(...result.errors);
      }

      await queries.updateIngestionJobProgress(jobId, organizationId, {
        processedRecords,
        importedRecords,
        skippedRecords,
        failedRecords,
        errorDetails: recentErrors.slice(-10),
      });
    }

    if (jobType === 'VENDOR_MASTER') {
      const totalStored = await queries.countVendorMasterRecords(sessionId, organizationId);
      await queries.updateSession(sessionId, organizationId, {
        vendorMasterFileName: fileName,
        vendorMasterRowCount: totalStored,
        status:
          session.status === VENDOR_INGESTION_SESSION_STATUS.DRAFT
            ? VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED
            : session.status,
        currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.PO_DUMP),
      });
    } else {
      const counts = await queries.countPoLineItems(sessionId, organizationId);
      await queries.updateSession(sessionId, organizationId, {
        poFileName: fileName,
        poRowCount: counts.total,
        poInHorizonCount: counts.inHorizon,
        poOutsideHorizonCount: counts.outsideHorizon,
        status: VENDOR_INGESTION_SESSION_STATUS.PO_STORED,
        currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.AI_CATEGORY_JOIN),
      });
    }

    await queries.updateIngestionJobProgress(jobId, organizationId, {
      totalRecords: Math.max(rows.length, processedRecords),
      processedRecords,
      importedRecords,
      skippedRecords,
      failedRecords,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      errorDetails: recentErrors.slice(-10),
    });
  } catch (err) {
    logger.error(`Array Ingestion job ${jobId} failed`, err, LOG_CATEGORY);
    await queries.updateIngestionJobProgress(jobId, organizationId, {
      status: 'FAILED',
      errorMessage: err.message || 'Processing failure',
      completedAt: new Date().toISOString(),
    });
  }
}

/**
 * Start a background ingestion job for an uploaded file or array
 */
async function startIngestionJob({ sessionUser, sessionId, fileBuffer, rows, fileName, jobType, totalHint = 0 }) {
  const organizationId = await resolveOrganizationId(sessionUser, sessionId);
  if (!organizationId) {
    throw new Error('Organization not linked to user');
  }

  // Clear any past cancellation markers for this session
  activeCancellations.delete(sessionId);

  // Uploaded once, synchronously, before this returns — the background job
  // (kicked off further down) reads it back from R2 by this same key, so it
  // must already be durably stored by the time that job runs, not still
  // in flight. This one write is comparatively fast; it's the row-by-row
  // processing after it that's slow enough to need deferring.
  let r2Key = null;
  if (fileBuffer) {
    r2Key = `${VENDOR_INGESTION_CONFIG.UPLOAD_STORAGE_DIR}/${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.csv`;
    await uploadToR2(r2Key, fileBuffer);
  }

  const total = rows ? rows.length : totalHint;

  // Create job in database
  const job = await queries.createIngestionJob({
    sessionId,
    organizationId,
    jobType,
    fileName,
    totalRecords: total,
  });

  if (r2Key) {
    // Wrapped in a Promise constructed and handed to waitUntil synchronously,
    // right here — not inside the setImmediate callback. waitUntil only
    // needs a Promise reference to hold the invocation open for; it doesn't
    // need the underlying work to have started yet. Registering it any later
    // (e.g. from inside the callback, after setImmediate has already fired)
    // risks the response having gone out and the invocation already having
    // ended by then, which is the exact bug this whole waitUntil pattern
    // exists to avoid — see storeService.js's _background() for the fuller
    // rationale, and worker.mjs for where getWaitUntil() ultimately reads
    // Workers' waitUntil from.
    const backgroundJob = new Promise((resolve) => {
      setImmediate(() => {
        streamProcessCsvFile({
          jobId: job.id,
          sessionId,
          organizationId,
          r2Key,
          fileName,
          jobType,
        })
          .catch((err) => logger.error('Background ingestion job error', err, LOG_CATEGORY))
          .then(resolve);
      });
    });
    const waitUntil = getWaitUntil();
    if (waitUntil) waitUntil(backgroundJob);
    return job;
  } else if (Array.isArray(rows)) {
    if (rows.length <= 5000) {
      await processArrayJob({
        jobId: job.id,
        sessionId,
        organizationId,
        rows,
        fileName,
        jobType,
      });
      const updated = await queries.findIngestionJob(job.id, organizationId);
      return updated || {
        ...job,
        status: 'COMPLETED',
        totalRecords: rows.length,
        processedRecords: rows.length,
        importedRecords: rows.length,
        skippedRecords: 0,
        failedRecords: 0,
      };
    } else {
      // Same waitUntil registration pattern as the r2Key branch above.
      const backgroundJob = new Promise((resolve) => {
        setImmediate(() => {
          processArrayJob({
            jobId: job.id,
            sessionId,
            organizationId,
            rows,
            fileName,
            jobType,
          })
            .catch((err) => logger.error('Background array ingestion job error', err, LOG_CATEGORY))
            .then(resolve);
        });
      });
      const waitUntil = getWaitUntil();
      if (waitUntil) waitUntil(backgroundJob);
      return job;
    }
  }

  return job;
}

/**
 * Cancel an active background ingestion job
 */
async function cancelJob(sessionUser, sessionId, jobId = null) {
  const organizationId = await resolveOrganizationId(sessionUser, sessionId);
  if (!organizationId) return false;

  activeCancellations.add(sessionId);
  if (jobId) activeCancellations.add(jobId);

  const activeJobs = await queries.findActiveIngestionJobs(sessionId, organizationId);
  for (const j of activeJobs) {
    if (!jobId || j.id === jobId) {
      activeCancellations.add(j.id);
      await queries.updateIngestionJobProgress(j.id, organizationId, {
        status: 'FAILED',
        errorMessage: 'Cancelled by user',
        completedAt: new Date().toISOString(),
      });
    }
  }
  return true;
}

/**
 * Get the status of an ingestion job or active jobs for a session
 */
async function getJobStatus(sessionUser, sessionId, jobId = null, jobType = null) {
  const organizationId = await resolveOrganizationId(sessionUser, sessionId);
  if (!organizationId) return null;

  if (jobId) {
    return queries.findIngestionJob(jobId, organizationId);
  }

  const activeJobs = await queries.findActiveIngestionJobs(sessionId, organizationId);
  if (jobType) {
    const matching = activeJobs.find((j) => j.jobType === jobType);
    return matching || null;
  }

  if (activeJobs.length > 0) return activeJobs[0];

  return null;
}

module.exports = {
  resolveOrganizationId,
  startIngestionJob,
  cancelJob,
  getJobStatus,
  streamProcessCsvFile,
  processArrayJob,
  processVendorMasterBatch,
  processPoDumpBatch,
  parseCsvLine,
  extractHeaderIndices,
  mapRowValues,
  activeCancellations,
};
