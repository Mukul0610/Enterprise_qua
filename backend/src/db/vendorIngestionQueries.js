// ==============================================================================
// VENDOR MASTER & PO DATA INGESTION QUERIES (Neon PostgreSQL)
// ==============================================================================
// Read/write helpers for the buyer's vendor-master and PO ingestion tables (see
// the "VENDOR MASTER & PO DATA INGESTION" block at the end of schema.sql).
//
// Two rules hold for every function in this file:
//
//   1. organization_id is part of the WHERE clause of every single read and
//      write. Not "usually" — every one. A session id is a guessable-ish string,
//      so scoping only by it would let one buyer read another buyer's vendor
//      master and spend history by id. The caller passes an organizationId that
//      was resolved from the session's user row, never from the request body.
//
//   2. No function throws for an unconfigured database. `pool.pool` is null when
//      DATABASE_URL is unset, and every helper returns its documented empty
//      value in that case — the same convention as domainQueries and
//      buyerProfileQueries, so the app degrades instead of crashing.
//
// These are typed-column tables rather than the `raw JSONB` domain style,
// because every column is something this module filters, aggregates or joins on.
// A `raw` column still carries the untouched source row for support.
// ==============================================================================

const crypto = require('crypto');
const pool = require('./pool');
const { getD1Binding, getD1HttpClient, batchD1 } = require('./d1Bridge');
const {
  VENDOR_INGESTION_SESSION_STATUS,
  VENDOR_INGESTION_AI_STATUS,
  VENDOR_MAPPING_STATUS,
  VENDOR_AI_PROCESSING_STATUS,
  VENDOR_MATCH_STRATEGY,
  VENDOR_EMAIL_STATUS,
  VENDOR_DISPATCH_STATUS,
  VENDOR_INGESTION_CONFIG,
} = require('../config/constants');

/** Application-assigned id, matching the VARCHAR(64) convention of every table. */
function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Trim a database value, mapping NULL to an empty string. */
function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** NULL rather than '' for an absent optional column, so indexes stay sparse. */
function nullable(value) {
  const trimmed = text(value);
  return trimmed === '' ? null : trimmed;
}

/** A finite number, or null. Never 0-as-a-default: absent is not zero. */
function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** A finite number, defaulting to 0 — for genuine counters and sums. */
function counter(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Coerce a stored boolean column to a plain JS boolean.
 *
 * pg returns a real boolean for BOOLEAN columns. SQLite has no boolean type
 * — D1 stores/returns true/false literals as the integers 1/0, so a bare
 * `=== true` reads every D1-backed row's flag as false. See identityQueries.js's
 * flag() for the same fix applied to the identity tables.
 */
function flag(value) {
  return value === true || value === 1 || value === '1';
}

/**
 * Fallback match key for a vendor name.
 *
 * Lowercases, strips punctuation, collapses whitespace and removes trailing
 * legal-entity suffixes, so "Apex Supplies Ltd." and "Apex Supplies Limited"
 * both reduce to "apex supplies". Vendor Code stays the preferred identifier —
 * this key is only consulted when neither a code nor a GSTIN matched, because
 * name collapsing can genuinely merge two distinct suppliers ("Delta Valve" and
 * "Delta Valves") and a wrong merge attributes one supplier's spend to another.
 *
 * Suffixes are stripped repeatedly so "Apex Supplies Pvt Ltd Co" reduces fully.
 */
function normalizeVendorName(value) {
  let name = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name === '') return '';

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of VENDOR_INGESTION_CONFIG.NAME_NORMALIZATION_SUFFIXES) {
      if (name.endsWith(` ${suffix}`)) {
        name = name.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  // Everything was a suffix ("Limited") — fall back to the collapsed original
  // rather than returning an empty key that would match every other empty key.
  if (name === '') {
    return text(value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return name;
}

// ------------------------------------------------------------------------------
// SESSIONS
// ------------------------------------------------------------------------------

const SESSION_SELECT = `
  select id, organization_id, created_by_user_id, created_by_email, status, current_step,
         horizon_type, horizon_start, horizon_end,
         vendor_master_file_name, vendor_master_row_count,
         po_file_name, po_row_count, po_in_horizon_count, po_outside_horizon_count,
         matched_vendor_count, unmatched_vendor_count,
         ai_status, ai_processed_count, ai_total_count, ai_failed_count,
         ai_started_at, ai_completed_at, created_at, updated_at, raw
    from vendor_ingestion_sessions`;

/** A DATE column comes back as a JS Date; the API speaks YYYY-MM-DD. */
function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapRowToSession(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    status: row.status,
    currentStep: counter(row.current_step),
    horizonType: row.horizon_type,
    horizonStart: dateOnly(row.horizon_start),
    horizonEnd: dateOnly(row.horizon_end),
    vendorMasterFileName: row.vendor_master_file_name,
    vendorMasterRowCount: counter(row.vendor_master_row_count),
    poFileName: row.po_file_name,
    poRowCount: counter(row.po_row_count),
    poInHorizonCount: counter(row.po_in_horizon_count),
    poOutsideHorizonCount: counter(row.po_outside_horizon_count),
    matchedVendorCount: counter(row.matched_vendor_count),
    unmatchedVendorCount: counter(row.unmatched_vendor_count),
    aiStatus: row.ai_status,
    aiProcessedCount: counter(row.ai_processed_count),
    aiTotalCount: counter(row.ai_total_count),
    aiFailedCount: counter(row.ai_failed_count),
    aiStartedAt: row.ai_started_at,
    aiCompletedAt: row.ai_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    meta: row.raw || {},
  };
}

/** Create a session. The caller has already resolved and validated the horizon. */
async function insertSession({ organizationId, userId, userEmail, horizon }) {
  if (!pool.hasStorage()) return null;
  const id = newId('vis');
  const result = await pool.query(
    `insert into vendor_ingestion_sessions
       (id, organization_id, created_by_user_id, created_by_email, status, current_step,
        horizon_type, horizon_start, horizon_end, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning *`,
    [
      id,
      organizationId,
      nullable(userId),
      nullable(userEmail),
      VENDOR_INGESTION_SESSION_STATUS.DRAFT,
      1,
      horizon ? horizon.type : null,
      horizon ? horizon.startDate : null,
      horizon ? horizon.endDate : null,
      JSON.stringify({}),
    ],
    { d1: true }
  );
  return result.rows[0] ? mapRowToSession(result.rows[0]) : null;
}

/**
 * One session, scoped to its organisation.
 *
 * Returns null for both "no such session" and "not yours", so a session id
 * belonging to another buyer is indistinguishable from one that never existed
 * and cannot be probed.
 */
async function findSession(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return null;
  const rows = await pool.rows(
    `${SESSION_SELECT} where id = $1 and organization_id = $2 limit 1`,
    [sessionId, organizationId],
    { d1: true }
  );
  return rows.length > 0 ? mapRowToSession(rows[0]) : null;
}

/** Look up a session by its ID directly to resolve its organization */
async function findSessionById(sessionId) {
  if (!pool.hasStorage() || !sessionId) return null;
  const rows = await pool.rows(`${SESSION_SELECT} where id = $1 limit 1`, [sessionId], { d1: true });
  return rows.length > 0 ? mapRowToSession(rows[0]) : null;
}

/**
 * The organisation's most recent session, so the buyer resumes rather than
 * restarting. Deliberately not filtered by status: a finished run is still the
 * right thing to reopen, showing its results.
 */
async function findLatestSession(organizationId) {
  if (!pool.hasStorage() || !organizationId) return null;
  const rows = await pool.rows(
    `${SESSION_SELECT} where organization_id = $1 order by created_at desc limit 1`,
    [organizationId],
    { d1: true }
  );
  return rows.length > 0 ? mapRowToSession(rows[0]) : null;
}

/** Columns a session update may touch, mapped from API field to column. */
const SESSION_COLUMN_MAP = [
  { field: 'status', column: 'status' },
  { field: 'currentStep', column: 'current_step' },
  { field: 'horizonType', column: 'horizon_type' },
  { field: 'horizonStart', column: 'horizon_start' },
  { field: 'horizonEnd', column: 'horizon_end' },
  { field: 'vendorMasterFileName', column: 'vendor_master_file_name' },
  { field: 'vendorMasterRowCount', column: 'vendor_master_row_count' },
  { field: 'poFileName', column: 'po_file_name' },
  { field: 'poRowCount', column: 'po_row_count' },
  { field: 'poInHorizonCount', column: 'po_in_horizon_count' },
  { field: 'poOutsideHorizonCount', column: 'po_outside_horizon_count' },
  { field: 'matchedVendorCount', column: 'matched_vendor_count' },
  { field: 'unmatchedVendorCount', column: 'unmatched_vendor_count' },
  { field: 'aiStatus', column: 'ai_status' },
  { field: 'aiProcessedCount', column: 'ai_processed_count' },
  { field: 'aiTotalCount', column: 'ai_total_count' },
  { field: 'aiFailedCount', column: 'ai_failed_count' },
  { field: 'aiStartedAt', column: 'ai_started_at' },
  { field: 'aiCompletedAt', column: 'ai_completed_at' },
];

/**
 * Patch a session.
 *
 * Null-skip semantics, same as buildProfileUpdate: an omitted key is left
 * untouched rather than nulled, so a step that only advances `currentStep`
 * cannot wipe the stored horizon. A whitelist rather than a spread, so a
 * request body can never reach a column it has no business writing.
 */
async function updateSession(sessionId, organizationId, patch = {}) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return null;

  const assignments = [];
  const params = [];
  let index = 1;

  for (const { field, column } of SESSION_COLUMN_MAP) {
    if (patch[field] === undefined) continue;
    assignments.push(`${column} = $${index}`);
    params.push(patch[field]);
    index += 1;
  }

  if (assignments.length === 0) return findSession(sessionId, organizationId);

  params.push(sessionId, organizationId);
  const result = await pool.query(
    `update vendor_ingestion_sessions
        set ${assignments.join(', ')}, updated_at = now()
      where id = $${index} and organization_id = $${index + 1}
      returning *`,
    params,
    {
      d1: true,
      d1Text: `update vendor_ingestion_sessions
        set ${assignments.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $${index} and organization_id = $${index + 1}
      returning *`,
    }
  );
  return result.rows[0] ? mapRowToSession(result.rows[0]) : null;
}

// ------------------------------------------------------------------------------
// INGESTION JOBS (Background Progress Tracking)
// ------------------------------------------------------------------------------

const INGESTION_JOB_SELECT = `
  select id, session_id, organization_id, job_type, file_name, status,
         total_records, processed_records, imported_records, skipped_records, failed_records,
         error_message, error_details, started_at, completed_at, created_at, updated_at
    from ingestion_jobs`;

function mapRowToIngestionJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    organizationId: row.organization_id,
    jobType: row.job_type,
    fileName: row.file_name,
    status: row.status,
    totalRecords: counter(row.total_records),
    processedRecords: counter(row.processed_records),
    importedRecords: counter(row.imported_records),
    skippedRecords: counter(row.skipped_records),
    failedRecords: counter(row.failed_records),
    errorMessage: row.error_message || null,
    errorDetails: row.error_details || null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createIngestionJob({ sessionId, organizationId, jobType, fileName, totalRecords = 0 }) {
  if (!pool.hasStorage() || !sessionId || !organizationId) {
    return {
      id: newId('job'),
      sessionId,
      organizationId,
      jobType,
      fileName,
      status: 'PROCESSING',
      totalRecords,
      processedRecords: 0,
      importedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
      startedAt: new Date().toISOString(),
    };
  }

  const id = newId('job');
  const rows = await pool.rows(
    `insert into ingestion_jobs
       (id, session_id, organization_id, job_type, file_name, status, total_records, started_at)
     values ($1, $2, $3, $4, $5, 'PROCESSING', $6, now())
     returning *`,
    [id, sessionId, organizationId, jobType, fileName, totalRecords],
    {
      d1: true,
      d1Text: `insert into ingestion_jobs
       (id, session_id, organization_id, job_type, file_name, status, total_records, started_at)
     values ($1, $2, $3, $4, $5, 'PROCESSING', $6, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     returning *`,
    }
  );
  return rows.length > 0 ? mapRowToIngestionJob(rows[0]) : null;
}

async function updateIngestionJobProgress(jobId, organizationId, patch = {}) {
  if (!pool.hasStorage() || !jobId || !organizationId) return null;

  const assignments = [];
  const params = [];
  let index = 1;

  const fieldMap = {
    totalRecords: 'total_records',
    processedRecords: 'processed_records',
    importedRecords: 'imported_records',
    skippedRecords: 'skipped_records',
    failedRecords: 'failed_records',
    status: 'status',
    errorMessage: 'error_message',
    errorDetails: 'error_details',
    completedAt: 'completed_at',
  };

  for (const [key, column] of Object.entries(fieldMap)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      assignments.push(`${column} = $${index}`);
      if (key === 'errorDetails') {
        params.push(patch[key] ? JSON.stringify(patch[key]) : null);
      } else {
        params.push(patch[key]);
      }
      index += 1;
    }
  }

  if (assignments.length === 0) return findIngestionJob(jobId, organizationId);

  params.push(jobId, organizationId);
  const result = await pool.query(
    `update ingestion_jobs
        set ${assignments.join(', ')}, updated_at = now()
      where id = $${index} and organization_id = $${index + 1}
      returning *`,
    params,
    {
      d1: true,
      d1Text: `update ingestion_jobs
        set ${assignments.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $${index} and organization_id = $${index + 1}
      returning *`,
    }
  );
  return result.rows[0] ? mapRowToIngestionJob(result.rows[0]) : null;
}

async function findIngestionJob(jobId, organizationId) {
  if (!pool.hasStorage() || !jobId || !organizationId) return null;
  const rows = await pool.rows(
    `${INGESTION_JOB_SELECT} where id = $1 and organization_id = $2 limit 1`,
    [jobId, organizationId],
    { d1: true }
  );
  return rows.length > 0 ? mapRowToIngestionJob(rows[0]) : null;
}

async function findLatestIngestionJob(sessionId, organizationId, jobType = null) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return null;
  const params = [sessionId, organizationId];
  let typeClause = '';
  if (jobType) {
    params.push(jobType);
    typeClause = `and job_type = $${params.length}`;
  }
  const rows = await pool.rows(
    `${INGESTION_JOB_SELECT} where session_id = $1 and organization_id = $2 ${typeClause} order by created_at desc limit 1`,
    params,
    { d1: true }
  );
  return rows.length > 0 ? mapRowToIngestionJob(rows[0]) : null;
}

async function findActiveIngestionJobs(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const rows = await pool.rows(
    `${INGESTION_JOB_SELECT} where session_id = $1 and organization_id = $2 and status in ('PENDING', 'PROCESSING') order by created_at desc`,
    [sessionId, organizationId],
    { d1: true }
  );
  return rows.map(mapRowToIngestionJob);
}

// ------------------------------------------------------------------------------
// CATEGORY MASTER (read-only view of the buyer's own taxonomy)
// ------------------------------------------------------------------------------

/**
 * The organisation's category master, grouped major -> minors.
 *
 * Read from `org_division_category` — the buyer's own selected taxonomy — not
 * from the global `category_division` master. That is deliberate: the
 * categoriser must choose from the categories this buyer actually sources in,
 * and RULE 10 forbids inventing a production category. When the buyer has
 * selected nothing, this returns an empty array and the service refuses to run
 * classification rather than letting the model invent a taxonomy.
 */
async function findOrganizationCategoryMaster(organizationId) {
  if (!pool.hasStorage() || !organizationId) return [];
  const rows = await pool.rows(
    `select division, category from org_division_category
      where organization_id = $1 and is_active is not false
        and division is not null and division <> ''
      order by division, category`,
    [organizationId],
    { d1: true }
  );

  const grouped = new Map();
  for (const row of rows) {
    const major = text(row.division);
    if (major === '') continue;
    if (!grouped.has(major)) grouped.set(major, []);
    const minor = text(row.category);
    if (minor !== '' && !grouped.get(major).includes(minor)) {
      grouped.get(major).push(minor);
    }
  }
  return Array.from(grouped.entries()).map(([majorCategory, minorCategories]) => ({
    majorCategory,
    minorCategories,
  }));
}

// ------------------------------------------------------------------------------
// VENDOR MASTER RECORDS
// ------------------------------------------------------------------------------

const VENDOR_MASTER_SELECT = `
  select id, session_id, organization_id, source_row_number, vendor_code, company_name,
         normalized_name, contact_person, email, phone, address, gstin, rating,
         created_at, updated_at, raw
    from vendor_master_records`;

function mapRowToVendorMaster(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    organizationId: row.organization_id,
    sourceRowNumber: row.source_row_number,
    vendorCode: text(row.vendor_code),
    companyName: text(row.company_name),
    normalizedName: text(row.normalized_name),
    contactPerson: text(row.contact_person),
    email: text(row.email),
    phone: text(row.phone),
    address: text(row.address),
    gstin: text(row.gstin),
    rating: numeric(row.rating),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Bound parameters per vendor-master row, matching the INSERT column list below.
// Named rather than inlined so adding a column is one edit, not two that can
// silently drift apart and shift every placeholder in the statement.
const VENDOR_MASTER_STRIDE = 14;

// D1 rejects a statement with too many bound parameters (hit live with
// largeFileIngestionService's DEFAULT_BATCH_SIZE of 500 rows * 14 columns =
// 7000 params — "D1_ERROR: too many SQL variables"). Postgres has no such
// problem at this scale, but sub-chunking here is cheap and keeps this
// function safe under either backend without the caller needing to know
// about a D1-specific limit.
const VENDOR_MASTER_MAX_ROWS_PER_INSERT = 50;

/**
 * Insert one chunk of vendor-master rows.
 *
 * One multi-row INSERT per sub-chunk, never one statement per row. `on
 * conflict (session_id, vendor_code) do update` makes re-confirming the same
 * file idempotent: the row is refreshed rather than duplicated, so a retried
 * chunk cannot double the vendor count.
 *
 * Returns the stored rows so the caller can report exactly what landed.
 */
async function bulkUpsertVendorMasterRecords(sessionId, organizationId, rows = []) {
  if (!pool.hasStorage() || !sessionId || !organizationId || rows.length === 0) return [];

  const d1 = getD1Binding() || getD1HttpClient();
  if (d1) {
    const statements = rows.map((row) => ({
      text: `insert into vendor_master_records
       (id, session_id, organization_id, source_row_number, vendor_code, company_name,
        normalized_name, contact_person, email, phone, address, gstin, rating, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (session_id, vendor_code) do update
       set company_name = excluded.company_name,
           normalized_name = excluded.normalized_name,
           contact_person = excluded.contact_person,
           email = excluded.email,
           phone = excluded.phone,
           address = excluded.address,
           gstin = excluded.gstin,
           rating = excluded.rating,
           source_row_number = excluded.source_row_number,
           raw = excluded.raw,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     returning *`,
      params: [
        newId('vmr'),
        sessionId,
        organizationId,
        row.sourceRowNumber === undefined ? null : row.sourceRowNumber,
        nullable(row.vendorCode),
        text(row.companyName),
        normalizeVendorName(row.companyName),
        nullable(row.contactPerson),
        nullable(row.email) ? String(row.email).trim().toLowerCase() : null,
        nullable(row.phone),
        nullable(row.address),
        nullable(row.gstin || row.gstNumber) ? String(row.gstin || row.gstNumber).trim().toUpperCase() : null,
        numeric(row.rating),
        JSON.stringify(row.raw || row),
      ],
    }));
    const results = await batchD1(d1, statements);
    return results.flatMap((result) => (result.rows || []).map(mapRowToVendorMaster));
  }

  if (rows.length > VENDOR_MASTER_MAX_ROWS_PER_INSERT) {
    const stored = [];
    for (let i = 0; i < rows.length; i += VENDOR_MASTER_MAX_ROWS_PER_INSERT) {
      const slice = rows.slice(i, i + VENDOR_MASTER_MAX_ROWS_PER_INSERT);
      stored.push(...(await bulkUpsertVendorMasterRecords(sessionId, organizationId, slice)));
    }
    return stored;
  }

  const values = [];
  const placeholders = rows.map((row, i) => {
    const base = i * VENDOR_MASTER_STRIDE;
    values.push(
      newId('vmr'),
      sessionId,
      organizationId,
      row.sourceRowNumber === undefined ? null : row.sourceRowNumber,
      nullable(row.vendorCode),
      text(row.companyName),
      normalizeVendorName(row.companyName),
      nullable(row.contactPerson),
      nullable(row.email) ? String(row.email).trim().toLowerCase() : null,
      nullable(row.phone),
      nullable(row.address),
      nullable(row.gstin || row.gstNumber) ? String(row.gstin || row.gstNumber).trim().toUpperCase() : null,
      numeric(row.rating),
      JSON.stringify(row.raw || row)
    );
    const slots = [];
    for (let n = 1; n <= VENDOR_MASTER_STRIDE; n += 1) slots.push(`$${base + n}`);
    return `(${slots.join(', ')})`;
  });

  const result = await pool.query(
    `insert into vendor_master_records
       (id, session_id, organization_id, source_row_number, vendor_code, company_name,
        normalized_name, contact_person, email, phone, address, gstin, rating, raw)
     values ${placeholders.join(', ')}
     on conflict (session_id, vendor_code) do update
       set company_name = excluded.company_name,
           normalized_name = excluded.normalized_name,
           contact_person = excluded.contact_person,
           email = excluded.email,
           phone = excluded.phone,
           address = excluded.address,
           gstin = excluded.gstin,
           rating = excluded.rating,
           source_row_number = excluded.source_row_number,
           raw = excluded.raw,
           updated_at = now()
     returning *`,
    values,
    {
      d1: true,
      d1Text: `insert into vendor_master_records
       (id, session_id, organization_id, source_row_number, vendor_code, company_name,
        normalized_name, contact_person, email, phone, address, gstin, rating, raw)
     values ${placeholders.join(', ')}
     on conflict (session_id, vendor_code) do update
       set company_name = excluded.company_name,
           normalized_name = excluded.normalized_name,
           contact_person = excluded.contact_person,
           email = excluded.email,
           phone = excluded.phone,
           address = excluded.address,
           gstin = excluded.gstin,
           rating = excluded.rating,
           source_row_number = excluded.source_row_number,
           raw = excluded.raw,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     returning *`,
    }
  );
  return result.rows.map(mapRowToVendorMaster);
}

/** Every vendor-master row in a session, ordered as the sheet supplied them. */
async function findVendorMasterRecords(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const rows = await pool.rows(
    `${VENDOR_MASTER_SELECT} where session_id = $1 and organization_id = $2
      order by source_row_number nulls last, company_name`,
    [sessionId, organizationId],
    { d1: true }
  );
  return rows.map(mapRowToVendorMaster);
}

/** One vendor-master row, org-scoped. */
async function findVendorMasterRecord(recordId, organizationId) {
  if (!pool.hasStorage() || !recordId || !organizationId) return null;
  const rows = await pool.rows(
    `${VENDOR_MASTER_SELECT} where id = $1 and organization_id = $2 limit 1`,
    [recordId, organizationId],
    { d1: true }
  );
  return rows.length > 0 ? mapRowToVendorMaster(rows[0]) : null;
}

async function countVendorMasterRecords(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return 0;
  const rows = await pool.rows(
    'select count(*)::int as total from vendor_master_records where session_id = $1 and organization_id = $2',
    [sessionId, organizationId],
    {
      d1: true,
      d1Text:
        'select CAST(count(*) AS INTEGER) as total from vendor_master_records where session_id = $1 and organization_id = $2',
    }
  );
  return rows.length > 0 ? counter(rows[0].total) : 0;
}

/** Clear a session's vendor master so a corrected file replaces it wholesale. */
async function deleteVendorMasterRecords(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return 0;
  const result = await pool.query(
    'delete from vendor_master_records where session_id = $1 and organization_id = $2',
    [sessionId, organizationId],
    { d1: true }
  );
  return result.rowCount || 0;
}

// ------------------------------------------------------------------------------
// PO LINE ITEMS
// ------------------------------------------------------------------------------

const PO_STRIDE = 21;

// Same D1 bound-parameter ceiling as VENDOR_MASTER_MAX_ROWS_PER_INSERT above
// — PO_STRIDE is even wider (21 cols), so largeFileIngestionService's 500-row
// batches would build a 10,500-parameter statement and fail the same way.
const PO_LINE_ITEMS_MAX_ROWS_PER_INSERT = 40;

/**
 * Insert one chunk of PO line items.
 *
 * `inHorizon` is stamped here from the session's resolved window rather than
 * re-derived on read, so the AI aggregation, the spend rollups and the match
 * summary all agree on which rows count. Rows outside the window are still
 * stored — the buyer is shown how many fell outside, which is the check that
 * catches a mis-selected horizon.
 */
async function bulkInsertPoLineItems(sessionId, organizationId, rows = []) {
  if (!pool.hasStorage() || !sessionId || !organizationId || rows.length === 0) return 0;

  const d1 = getD1Binding() || getD1HttpClient();
  if (d1) {
    const statements = rows.map((row) => ({
      text: `insert into po_line_items
       (id, session_id, organization_id, source_row_number, po_number, po_date,
        vendor_code, vendor_name, normalized_vendor_name, vendor_gstin, item_description,
        specification, quantity, uom, spend, currency, department, material_code,
        existing_category, existing_subcategory, in_horizon)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      params: [
        newId('poli'),
        sessionId,
        organizationId,
        row.sourceRowNumber === undefined ? null : row.sourceRowNumber,
        nullable(row.poNumber),
        nullable(row.poDate),
        nullable(row.vendorCode),
        nullable(row.vendorName),
        normalizeVendorName(row.vendorName) || null,
        nullable(row.vendorGstin || row.gstNumber) ? String(row.vendorGstin || row.gstNumber).trim().toUpperCase() : null,
        nullable(row.itemDescription),
        nullable(row.specification),
        numeric(row.quantity),
        nullable(row.uom),
        numeric(row.spend),
        nullable(row.currency),
        nullable(row.department),
        nullable(row.materialCode),
        nullable(row.existingCategory),
        nullable(row.existingSubcategory),
        row.inHorizon !== false ? 1 : 0,
      ],
    }));
    const results = await batchD1(d1, statements);
    return results.reduce((acc, res) => acc + (res.rowCount !== undefined ? res.rowCount : (res.rows ? res.rows.length : 1)), 0);
  }

  if (rows.length > PO_LINE_ITEMS_MAX_ROWS_PER_INSERT) {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += PO_LINE_ITEMS_MAX_ROWS_PER_INSERT) {
      const slice = rows.slice(i, i + PO_LINE_ITEMS_MAX_ROWS_PER_INSERT);
      inserted += await bulkInsertPoLineItems(sessionId, organizationId, slice);
    }
    return inserted;
  }

  const values = [];
  const placeholders = rows.map((row, i) => {
    const base = i * PO_STRIDE;
    values.push(
      newId('poli'),
      sessionId,
      organizationId,
      row.sourceRowNumber === undefined ? null : row.sourceRowNumber,
      nullable(row.poNumber),
      nullable(row.poDate),
      nullable(row.vendorCode),
      nullable(row.vendorName),
      normalizeVendorName(row.vendorName) || null,
      nullable(row.vendorGstin || row.gstNumber) ? String(row.vendorGstin || row.gstNumber).trim().toUpperCase() : null,
      nullable(row.itemDescription),
      nullable(row.specification),
      numeric(row.quantity),
      nullable(row.uom),
      numeric(row.spend),
      nullable(row.currency),
      nullable(row.department),
      nullable(row.materialCode),
      nullable(row.existingCategory),
      nullable(row.existingSubcategory),
      row.inHorizon !== false
    );
    const slots = [];
    for (let n = 1; n <= PO_STRIDE; n += 1) slots.push(`$${base + n}`);
    return `(${slots.join(', ')})`;
  });

  const result = await pool.query(
    `insert into po_line_items
       (id, session_id, organization_id, source_row_number, po_number, po_date,
        vendor_code, vendor_name, normalized_vendor_name, vendor_gstin,
        item_description, specification, quantity, uom, spend, currency, department,
        material_code, existing_category, existing_subcategory, in_horizon)
     values ${placeholders.join(', ')}`,
    values
  );
  return result.rowCount || 0;
}

/** Counts for the "inside / outside the selected period" summary. */
async function countPoLineItems(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return { total: 0, inHorizon: 0, outsideHorizon: 0 };
  const rows = await pool.rows(
    `select count(*)::int as total,
            count(*) filter (where in_horizon)::int as in_horizon,
            count(*) filter (where not in_horizon)::int as outside_horizon
       from po_line_items where session_id = $1 and organization_id = $2`,
    [sessionId, organizationId],
    {
      d1: true,
      d1Text: `select CAST(count(*) AS INTEGER) as total,
            CAST(count(*) filter (where in_horizon) AS INTEGER) as in_horizon,
            CAST(count(*) filter (where not in_horizon) AS INTEGER) as outside_horizon
       from po_line_items where session_id = $1 and organization_id = $2`,
    }
  );
  if (rows.length === 0) return { total: 0, inHorizon: 0, outsideHorizon: 0 };
  return {
    total: counter(rows[0].total),
    inHorizon: counter(rows[0].in_horizon),
    outsideHorizon: counter(rows[0].outside_horizon),
  };
}

async function deletePoLineItems(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return 0;
  const result = await pool.query(
    'delete from po_line_items where session_id = $1 and organization_id = $2',
    [sessionId, organizationId],
    { d1: true }
  );
  return result.rowCount || 0;
}

/**
 * Attribute in-horizon PO lines to vendor-master rows.
 *
 * Runs as three UPDATEs in the documented priority order, each only touching
 * rows still unattributed, so a stronger identifier always wins:
 *
 *   1. Vendor Code — the preferred identifier.
 *   2. GSTIN — a statutory identifier, reliable when the dump carries it.
 *   3. Normalised vendor name — last resort, because name collapsing can merge
 *      two genuinely different suppliers.
 *
 * Only in-horizon rows are matched: an out-of-period line must not create PO
 * history for a supplier the buyer excluded by choosing a shorter window.
 * Everything left over is stamped UNMATCHED so "no PO history" is a recorded
 * fact rather than the absence of one.
 */
async function matchPoLineItemsToVendors(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) {
    return { byVendorCode: 0, byGstin: 0, byName: 0, unmatched: 0 };
  }

  const clearResult = await pool.query(
    `update po_line_items
        set matched_vendor_record_id = null, match_strategy = null
      where session_id = $1 and organization_id = $2`,
    [sessionId, organizationId],
    { d1: true }
  );
  void clearResult;

  // UPDATE ... FROM (a join-based update) is Postgres syntax that SQLite has
  // also supported since 3.33 with an identical shape — verified directly
  // against the real D1 database before relying on it here, so this is one
  // genuinely shared query text, not a d1Text override.
  const byVendorCode = await pool.query(
    `update po_line_items p
        set matched_vendor_record_id = v.id, match_strategy = $3
       from vendor_master_records v
      where p.session_id = $1 and p.organization_id = $2 and p.in_horizon
        and v.session_id = p.session_id and v.organization_id = p.organization_id
        and p.matched_vendor_record_id is null
        and p.vendor_code is not null and p.vendor_code <> ''
        and v.vendor_code is not null and v.vendor_code <> ''
        and lower(trim(p.vendor_code)) = lower(trim(v.vendor_code))`,
    [sessionId, organizationId, VENDOR_MATCH_STRATEGY.VENDOR_CODE],
    { d1: true }
  );

  const byGstin = await pool.query(
    `update po_line_items p
        set matched_vendor_record_id = v.id, match_strategy = $3
       from vendor_master_records v
      where p.session_id = $1 and p.organization_id = $2 and p.in_horizon
        and v.session_id = p.session_id and v.organization_id = p.organization_id
        and p.matched_vendor_record_id is null
        and p.vendor_gstin is not null and p.vendor_gstin <> ''
        and v.gstin is not null and v.gstin <> ''
        and upper(trim(p.vendor_gstin)) = upper(trim(v.gstin))`,
    [sessionId, organizationId, VENDOR_MATCH_STRATEGY.GSTIN],
    { d1: true }
  );

  const byName = await pool.query(
    `update po_line_items p
        set matched_vendor_record_id = v.id, match_strategy = $3
       from vendor_master_records v
      where p.session_id = $1 and p.organization_id = $2 and p.in_horizon
        and v.session_id = p.session_id and v.organization_id = p.organization_id
        and p.matched_vendor_record_id is null
        and p.normalized_vendor_name is not null and p.normalized_vendor_name <> ''
        and v.normalized_name is not null and v.normalized_name <> ''
        and p.normalized_vendor_name = v.normalized_name`,
    [sessionId, organizationId, VENDOR_MATCH_STRATEGY.NORMALIZED_NAME],
    { d1: true }
  );

  const unmatched = await pool.query(
    `update po_line_items
        set match_strategy = $3
      where session_id = $1 and organization_id = $2 and matched_vendor_record_id is null`,
    [sessionId, organizationId, VENDOR_MATCH_STRATEGY.UNMATCHED],
    { d1: true }
  );

  return {
    byVendorCode: byVendorCode.rowCount || 0,
    byGstin: byGstin.rowCount || 0,
    byName: byName.rowCount || 0,
    unmatched: unmatched.rowCount || 0,
  };
}

/**
 * One row per vendor-master record with its in-horizon purchasing profile.
 *
 * A LEFT JOIN, so a supplier with no PO history still appears — with a zero
 * count — instead of vanishing. That row is exactly the SELF_MAP_REQUIRED case,
 * and it has to be visible to be flagged.
 *
 * Descriptions are aggregated here in one grouped query rather than by reading
 * every PO row into Node and reducing it, so the AI aggregation is one round
 * trip regardless of how many line items the dump held.
 */
/**
 * Build the same " | "-joined summary concat_ws(' | ', ...) produces on
 * Postgres, skipping empty/null parts — used only for the D1 path, which
 * fetches the raw description/spec/qty/uom parts instead of a pre-built
 * string (SQLite has no concat_ws, and building it in SQL string-by-string
 * with CASE/COALESCE for each optional part is far more error-prone than
 * doing the equivalent join in JS on data D1 already had to return anyway).
 */
function buildLineSummary(part) {
  const pieces = [
    text(part.desc),
    text(part.spec),
    [text(part.qty), text(part.uom)].filter(Boolean).join(' '),
  ].filter((p) => p !== '');
  return pieces.join(' | ');
}

async function findVendorPurchasingProfiles(sessionId, organizationId, { descriptionLimit } = {}) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const limit = counter(descriptionLimit) || VENDOR_INGESTION_CONFIG.AI_MAX_PO_LINES_PER_VENDOR;

  // The D1 variant aggregates the raw line parts (json_group_array of
  // objects, ordered by spend like the Postgres array_agg) instead of a
  // pre-concatenated string, and defers building + slicing the summary list
  // to JS below — see buildLineSummary(). Postgres's array slice `[1:n]` has
  // no SQLite equivalent either, so line_summaries there is capped in JS the
  // same way regardless of which database served the row.
  const rows = await pool.rows(
    `select v.id                      as vendor_record_id,
            v.vendor_code,
            v.company_name,
            v.email,
            v.contact_person,
            v.phone,
            v.address,
            v.gstin,
            v.rating,
            count(p.id)::int          as po_line_count,
            count(distinct p.po_number)::int as po_count,
            coalesce(sum(p.spend), 0) as total_spend,
            min(p.po_date)            as first_po_date,
            max(p.po_date)            as last_po_date,
            coalesce(
              (array_agg(distinct p.department) filter (where p.department is not null and p.department <> '')),
              '{}'
            ) as departments,
            coalesce(
              (array_agg(distinct p.existing_category)
                 filter (where p.existing_category is not null and p.existing_category <> '')),
              '{}'
            ) as existing_categories,
            coalesce(
              (array_agg(p.line_summary order by p.spend desc nulls last))[1:${limit}],
              '{}'
            ) as line_summaries
       from vendor_master_records v
       left join (
              select id, session_id, organization_id, matched_vendor_record_id, po_number, po_date,
                     spend, department, existing_category,
                     concat_ws(' | ',
                       nullif(item_description, ''),
                       nullif(specification, ''),
                       nullif(concat_ws(' ', nullif(quantity::text, ''), nullif(uom, '')), '')
                     ) as line_summary
                from po_line_items
               where session_id = $1 and organization_id = $2 and in_horizon
                 and matched_vendor_record_id is not null
            ) p
         on p.matched_vendor_record_id = v.id
      where v.session_id = $1 and v.organization_id = $2
      group by v.id, v.vendor_code, v.company_name, v.email, v.contact_person,
               v.phone, v.address, v.gstin, v.rating
      order by coalesce(sum(p.spend), 0) desc, v.company_name`,
    [sessionId, organizationId],
    {
      d1: true,
      d1Text: `select v.id                      as vendor_record_id,
            v.vendor_code,
            v.company_name,
            v.email,
            v.contact_person,
            v.phone,
            v.address,
            v.gstin,
            v.rating,
            CAST(count(p.id) AS INTEGER)          as po_line_count,
            CAST(count(distinct p.po_number) AS INTEGER) as po_count,
            coalesce(sum(p.spend), 0) as total_spend,
            min(p.po_date)            as first_po_date,
            max(p.po_date)            as last_po_date,
            json_group_array(distinct p.department) filter (where p.department is not null and p.department <> '')
              as departments,
            json_group_array(distinct p.existing_category)
              filter (where p.existing_category is not null and p.existing_category <> '')
              as existing_categories,
            json_group_array(json_object('desc', p.item_description, 'spec', p.specification, 'qty', p.quantity, 'uom', p.uom) order by p.spend desc)
              filter (where p.id is not null)
              as line_parts
       from vendor_master_records v
       left join (
              select id, session_id, organization_id, matched_vendor_record_id, po_number, po_date,
                     spend, department, existing_category, item_description, specification, quantity, uom
                from po_line_items
               where session_id = $1 and organization_id = $2 and in_horizon
                 and matched_vendor_record_id is not null
            ) p
         on p.matched_vendor_record_id = v.id
      where v.session_id = $1 and v.organization_id = $2
      group by v.id, v.vendor_code, v.company_name, v.email, v.contact_person,
               v.phone, v.address, v.gstin, v.rating
      order by coalesce(sum(p.spend), 0) desc, v.company_name`,
    }
  );

  return rows.map((row) => {
    // pg: departments/existing_categories/line_summaries are already native
    // arrays (departments/existing_categories) or an array of ready strings
    // (line_summaries). D1: json_group_array columns come back as JSON
    // strings that need parsing, and line_parts needs building into the
    // same " | "-joined summary strings concat_ws produced on pg, then
    // capped to `limit` the same way the pg array slice would have.
    const departments = Array.isArray(row.departments)
      ? row.departments
      : JSON.parse(row.departments || '[]');
    const existingCategories = Array.isArray(row.existing_categories)
      ? row.existing_categories
      : JSON.parse(row.existing_categories || '[]');
    const lineSummaries = Array.isArray(row.line_summaries)
      ? row.line_summaries.slice(0, limit)
      : JSON.parse(row.line_parts || '[]')
          .map(buildLineSummary)
          .filter((s) => s !== '')
          .slice(0, limit);

    return {
      vendorRecordId: row.vendor_record_id,
      vendorCode: text(row.vendor_code),
      companyName: text(row.company_name),
      email: text(row.email),
      contactPerson: text(row.contact_person),
      phone: text(row.phone),
      address: text(row.address),
      gstin: text(row.gstin),
      rating: numeric(row.rating),
      poLineCount: counter(row.po_line_count),
      poCount: counter(row.po_count),
      totalSpend: counter(row.total_spend),
      firstPoDate: dateOnly(row.first_po_date),
      lastPoDate: dateOnly(row.last_po_date),
      departments: departments.filter(Boolean),
      existingCategories: existingCategories.filter(Boolean),
      lineSummaries: lineSummaries.filter(Boolean),
      hasPoHistory: counter(row.po_line_count) > 0,
    };
  });
}

/**
 * PO lines the dump carried for vendors that are not in the vendor master.
 *
 * Surfaced to the buyer because it usually means the vendor master is
 * incomplete, not that the PO data is wrong — and silently dropping the spend
 * would hide that.
 */
async function findUnmatchedPoVendors(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const rows = await pool.rows(
    `select coalesce(nullif(vendor_name, ''), nullif(vendor_code, ''), 'Unidentified vendor') as vendor_label,
            vendor_code,
            count(*)::int as po_line_count,
            coalesce(sum(spend), 0) as total_spend
       from po_line_items
      where session_id = $1 and organization_id = $2 and in_horizon
        and matched_vendor_record_id is null
      group by vendor_label, vendor_code
      order by coalesce(sum(spend), 0) desc
      limit 200`,
    [sessionId, organizationId],
    {
      d1: true,
      d1Text: `select coalesce(nullif(vendor_name, ''), nullif(vendor_code, ''), 'Unidentified vendor') as vendor_label,
            vendor_code,
            CAST(count(*) AS INTEGER) as po_line_count,
            coalesce(sum(spend), 0) as total_spend
       from po_line_items
      where session_id = $1 and organization_id = $2 and in_horizon
        and matched_vendor_record_id is null
      group by vendor_label, vendor_code
      order by coalesce(sum(spend), 0) desc
      limit 200`,
    }
  );
  return rows.map((row) => ({
    vendorLabel: text(row.vendor_label),
    vendorCode: text(row.vendor_code),
    poLineCount: counter(row.po_line_count),
    totalSpend: counter(row.total_spend),
  }));
}

// ------------------------------------------------------------------------------
// CATEGORY MAPPINGS
// ------------------------------------------------------------------------------

const MAPPING_SELECT = `
  select id, session_id, organization_id, vendor_record_id, vendor_code, company_name, email,
         vendor_id, ai_major_category, ai_minor_categories, ai_relevant_products, ai_confidence,
         ai_reason, ai_model, buyer_major_category, buyer_minor_categories, source, status,
         processing_status, processing_error, attempt_count, po_count, total_spend,
         has_po_history, is_new_category_suggestion, suggested_new_category,
         reviewed_by, reviewed_at, review_action, created_at, updated_at
    from vendor_category_mappings`;

/** A JSONB array column, defensively coerced — a hand-edited row may hold null. */
function jsonArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim() !== '');
  return [];
}

function mapRowToMapping(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    organizationId: row.organization_id,
    vendorRecordId: row.vendor_record_id,
    vendorCode: text(row.vendor_code),
    companyName: text(row.company_name),
    email: text(row.email),
    vendorId: row.vendor_id,
    aiSuggestion: {
      majorCategory: text(row.ai_major_category),
      minorCategories: jsonArray(row.ai_minor_categories),
      relevantProducts: jsonArray(row.ai_relevant_products),
      confidence: numeric(row.ai_confidence),
      reason: text(row.ai_reason),
      model: text(row.ai_model),
    },
    buyerMajorCategory: text(row.buyer_major_category),
    buyerMinorCategories: jsonArray(row.buyer_minor_categories),
    source: row.source,
    status: row.status,
    processingStatus: row.processing_status,
    processingError: text(row.processing_error),
    attemptCount: counter(row.attempt_count),
    poCount: counter(row.po_count),
    totalSpend: counter(row.total_spend),
    hasPoHistory: flag(row.has_po_history),
    isNewCategorySuggestion: flag(row.is_new_category_suggestion),
    suggestedNewCategory: text(row.suggested_new_category),
    reviewedBy: text(row.reviewed_by),
    reviewedAt: row.reviewed_at,
    reviewAction: row.review_action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MAPPING_SEED_STRIDE = 13;

/**
 * Create one mapping row per vendor-master record, ready for classification.
 *
 * Seeded from the join result, so the PO count, spend and has_po_history are the
 * matcher's own figures rather than something recomputed later and possibly
 * disagreeing. A supplier with no PO history is seeded straight to
 * SELF_MAP_REQUIRED / COMPLETED and is therefore never handed to the model —
 * that is RULE 6 enforced in the data, not just in the service.
 *
 * `on conflict do update` keeps a re-run of the join idempotent while
 * deliberately preserving `buyer_*`, `reviewed_*` and the AI columns: re-running
 * the match must not discard a decision the buyer already made.
 */
// Same D1 bound-parameter ceiling as the other bulk inserts in this file —
// this one isn't pre-chunked by any caller (seeded from the full vendor/PO
// join in one call), so a large vendor master file hits it just as easily.
const MAPPING_SEED_MAX_ROWS_PER_INSERT = 50;

async function seedCategoryMappings(sessionId, organizationId, profiles = []) {
  if (!pool.hasStorage() || !sessionId || !organizationId || profiles.length === 0) return [];

  const d1 = getD1Binding() || getD1HttpClient();
  if (d1) {
    const statements = profiles.map((profile) => {
      const hasHistory = profile.hasPoHistory === true;
      return {
        text: `insert into vendor_category_mappings
       (id, session_id, organization_id, vendor_record_id, vendor_code, company_name, email,
        po_count, total_spend, has_po_history, status, processing_status, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (session_id, vendor_record_id) do update
       set vendor_code = excluded.vendor_code,
           company_name = excluded.company_name,
           email = excluded.email,
           po_count = excluded.po_count,
           total_spend = excluded.total_spend,
           has_po_history = excluded.has_po_history,
           raw = excluded.raw,
           status = case
             when not excluded.has_po_history then '${VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED}'
             when vendor_category_mappings.status = '${VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED}'
               then '${VENDOR_MAPPING_STATUS.PENDING_REVIEW}'
             else vendor_category_mappings.status
           end,
           processing_status = case
             when not excluded.has_po_history then '${VENDOR_AI_PROCESSING_STATUS.COMPLETED}'
             when vendor_category_mappings.processing_status = '${VENDOR_AI_PROCESSING_STATUS.COMPLETED}'
               then vendor_category_mappings.processing_status
             else '${VENDOR_AI_PROCESSING_STATUS.QUEUED}'
           end,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     returning *`,
        params: [
          newId('vcm'),
          sessionId,
          organizationId,
          profile.vendorRecordId,
          nullable(profile.vendorCode),
          text(profile.companyName),
          nullable(profile.email) ? String(profile.email).trim().toLowerCase() : null,
          counter(profile.poCount),
          counter(profile.totalSpend),
          hasHistory ? 1 : 0,
          hasHistory ? VENDOR_MAPPING_STATUS.PENDING_REVIEW : VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED,
          hasHistory ? VENDOR_AI_PROCESSING_STATUS.QUEUED : VENDOR_AI_PROCESSING_STATUS.COMPLETED,
          JSON.stringify({ departments: profile.departments || [], existingCategories: profile.existingCategories || [] }),
        ],
      };
    });
    const results = await batchD1(d1, statements);
    return results.flatMap((result) => (result.rows || []).map(mapRowToMapping));
  }

  if (profiles.length > MAPPING_SEED_MAX_ROWS_PER_INSERT) {
    const stored = [];
    for (let i = 0; i < profiles.length; i += MAPPING_SEED_MAX_ROWS_PER_INSERT) {
      const slice = profiles.slice(i, i + MAPPING_SEED_MAX_ROWS_PER_INSERT);
      stored.push(...(await seedCategoryMappings(sessionId, organizationId, slice)));
    }
    return stored;
  }

  const values = [];
  const placeholders = profiles.map((profile, i) => {
    const base = i * MAPPING_SEED_STRIDE;
    const hasHistory = profile.hasPoHistory === true;
    values.push(
      newId('vcm'),
      sessionId,
      organizationId,
      profile.vendorRecordId,
      nullable(profile.vendorCode),
      text(profile.companyName),
      nullable(profile.email) ? String(profile.email).trim().toLowerCase() : null,
      counter(profile.poCount),
      counter(profile.totalSpend),
      hasHistory,
      hasHistory ? VENDOR_MAPPING_STATUS.PENDING_REVIEW : VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED,
      hasHistory ? VENDOR_AI_PROCESSING_STATUS.QUEUED : VENDOR_AI_PROCESSING_STATUS.COMPLETED,
      JSON.stringify({ departments: profile.departments || [], existingCategories: profile.existingCategories || [] })
    );
    const slots = [];
    for (let n = 1; n <= MAPPING_SEED_STRIDE; n += 1) slots.push(`$${base + n}`);
    return `(${slots.join(', ')})`;
  });

  const result = await pool.query(
    `insert into vendor_category_mappings
       (id, session_id, organization_id, vendor_record_id, vendor_code, company_name, email,
        po_count, total_spend, has_po_history, status, processing_status, raw)
     values ${placeholders.join(', ')}
     on conflict (session_id, vendor_record_id) do update
       set vendor_code = excluded.vendor_code,
           company_name = excluded.company_name,
           email = excluded.email,
           po_count = excluded.po_count,
           total_spend = excluded.total_spend,
           has_po_history = excluded.has_po_history,
           raw = excluded.raw,
           -- A supplier that has just lost its PO history (a shorter horizon was
           -- chosen) moves to SELF_MAP_REQUIRED; one that has gained history is
           -- re-queued. An existing buyer decision is otherwise left alone.
           status = case
             when not excluded.has_po_history then '${VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED}'
             when vendor_category_mappings.status = '${VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED}'
               then '${VENDOR_MAPPING_STATUS.PENDING_REVIEW}'
             else vendor_category_mappings.status
           end,
           processing_status = case
             when not excluded.has_po_history then '${VENDOR_AI_PROCESSING_STATUS.COMPLETED}'
             when vendor_category_mappings.processing_status = '${VENDOR_AI_PROCESSING_STATUS.COMPLETED}'
               then vendor_category_mappings.processing_status
             else '${VENDOR_AI_PROCESSING_STATUS.QUEUED}'
           end,
           updated_at = now()
     returning *`,
    values,
    { d1: true }
  );
  return result.rows.map(mapRowToMapping);
}

/** Every mapping in a session, richest-spend first. */
async function findCategoryMappings(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const rows = await pool.rows(
    `${MAPPING_SELECT} where session_id = $1 and organization_id = $2
      order by total_spend desc, company_name`,
    [sessionId, organizationId],
    { d1: true }
  );
  return rows.map(mapRowToMapping);
}

/** One mapping by its vendor-master record id, org-scoped. */
async function findCategoryMappingByVendorRecord(sessionId, organizationId, vendorRecordId) {
  if (!pool.hasStorage() || !sessionId || !organizationId || !vendorRecordId) return null;
  const rows = await pool.rows(
    `${MAPPING_SELECT} where session_id = $1 and organization_id = $2 and vendor_record_id = $3 limit 1`,
    [sessionId, organizationId, vendorRecordId],
    { d1: true }
  );
  return rows.length > 0 ? mapRowToMapping(rows[0]) : null;
}

/**
 * Mappings still awaiting classification, oldest-queued first.
 *
 * `for update skip locked` inside the caller's transaction is deliberately NOT
 * used: this module runs one categorisation job per session at a time (guarded
 * by the session's ai_status), so a simple ordered read is enough and avoids
 * holding row locks across a network call to the model.
 */
async function findQueuedCategoryMappings(sessionId, organizationId, limit) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const rows = await pool.rows(
    `${MAPPING_SELECT}
      where session_id = $1 and organization_id = $2
        and has_po_history
        and processing_status in ($3, $4)
      order by total_spend desc, company_name
      limit $5`,
    [
      sessionId,
      organizationId,
      VENDOR_AI_PROCESSING_STATUS.QUEUED,
      VENDOR_AI_PROCESSING_STATUS.PROCESSING,
      counter(limit) || VENDOR_INGESTION_CONFIG.AI_BATCH_SIZE,
    ],
    { d1: true }
  );
  return rows.map(mapRowToMapping);
}

/** Flip one mapping to PROCESSING and count the attempt. */
async function markMappingProcessing(mappingId, organizationId) {
  if (!pool.hasStorage() || !mappingId || !organizationId) return null;
  const result = await pool.query(
    `update vendor_category_mappings
        set processing_status = $3, attempt_count = attempt_count + 1, updated_at = now()
      where id = $1 and organization_id = $2
      returning *`,
    [mappingId, organizationId, VENDOR_AI_PROCESSING_STATUS.PROCESSING],
    { d1: true }
  );
  return result.rows[0] ? mapRowToMapping(result.rows[0]) : null;
}

/**
 * Store a validated AI suggestion.
 *
 * Writes only the `ai_*` columns and the status. The buyer's own columns are
 * untouched, which is what keeps "what the model suggested" and "what the buyer
 * approved" independently readable for the audit trail (RULE 8).
 */
async function saveAiSuggestion(mappingId, organizationId, suggestion) {
  if (!pool.hasStorage() || !mappingId || !organizationId) return null;
  const result = await pool.query(
    `update vendor_category_mappings
        set ai_major_category = $3,
            ai_minor_categories = $4::jsonb,
            ai_relevant_products = $5::jsonb,
            ai_confidence = $6,
            ai_reason = $7,
            ai_model = $8,
            source = $9,
            status = $10,
            processing_status = $11,
            processing_error = null,
            is_new_category_suggestion = $12,
            suggested_new_category = $13,
            updated_at = now()
      where id = $1 and organization_id = $2
      returning *`,
    [
      mappingId,
      organizationId,
      nullable(suggestion.majorCategory),
      JSON.stringify(suggestion.minorCategories || []),
      JSON.stringify(suggestion.relevantProducts || []),
      numeric(suggestion.confidence),
      nullable(suggestion.reason),
      nullable(suggestion.model),
      suggestion.source,
      suggestion.status,
      VENDOR_AI_PROCESSING_STATUS.COMPLETED,
      suggestion.isNewCategorySuggestion === true,
      nullable(suggestion.suggestedNewCategory),
    ],
    {
      d1: true,
      // ::jsonb is Postgres-only cast syntax; D1's ai_minor_categories/
      // ai_relevant_products columns are plain TEXT, so the same JSON-string
      // params bind directly with no cast needed.
      d1Text: `update vendor_category_mappings
        set ai_major_category = $3,
            ai_minor_categories = $4,
            ai_relevant_products = $5,
            ai_confidence = $6,
            ai_reason = $7,
            ai_model = $8,
            source = $9,
            status = $10,
            processing_status = $11,
            processing_error = null,
            is_new_category_suggestion = $12,
            suggested_new_category = $13,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and organization_id = $2
      returning *`,
    }
  );
  return result.rows[0] ? mapRowToMapping(result.rows[0]) : null;
}

/**
 * Record a classification failure without touching the stored category.
 *
 * A failed attempt must never leave a half-written category behind — that is
 * how vendor data gets corrupted by a bad model reply. The row keeps whatever it
 * had and carries a readable reason plus a retryable FAILED state.
 */
async function markMappingFailed(mappingId, organizationId, errorMessage) {
  if (!pool.hasStorage() || !mappingId || !organizationId) return null;
  const result = await pool.query(
    `update vendor_category_mappings
        set processing_status = $3, status = $4, processing_error = $5, updated_at = now()
      where id = $1 and organization_id = $2
      returning *`,
    [
      mappingId,
      organizationId,
      VENDOR_AI_PROCESSING_STATUS.FAILED,
      VENDOR_MAPPING_STATUS.FAILED,
      nullable(errorMessage),
    ],
    { d1: true }
  );
  return result.rows[0] ? mapRowToMapping(result.rows[0]) : null;
}

/** Re-queue one mapping for another classification pass. */
async function requeueMapping(mappingId, organizationId) {
  if (!pool.hasStorage() || !mappingId || !organizationId) return null;
  const result = await pool.query(
    `update vendor_category_mappings
        set processing_status = $3, processing_error = null, updated_at = now()
      where id = $1 and organization_id = $2 and has_po_history
      returning *`,
    [mappingId, organizationId, VENDOR_AI_PROCESSING_STATUS.QUEUED],
    { d1: true }
  );
  return result.rows[0] ? mapRowToMapping(result.rows[0]) : null;
}

/**
 * Record the buyer's decision.
 *
 * The AI columns are not in this statement at all, so no review path can
 * overwrite the original recommendation.
 */
async function saveBuyerReview(mappingId, organizationId, review) {
  if (!pool.hasStorage() || !mappingId || !organizationId) return null;
  const result = await pool.query(
    `update vendor_category_mappings
        set buyer_major_category = $3,
            buyer_minor_categories = $4::jsonb,
            source = $5,
            status = $6,
            review_action = $7,
            reviewed_by = $8,
            reviewed_at = now(),
            updated_at = now()
      where id = $1 and organization_id = $2
      returning *`,
    [
      mappingId,
      organizationId,
      nullable(review.majorCategory),
      JSON.stringify(review.minorCategories || []),
      review.source,
      review.status,
      review.reviewAction,
      nullable(review.reviewedBy),
    ],
    {
      d1: true,
      d1Text: `update vendor_category_mappings
        set buyer_major_category = $3,
            buyer_minor_categories = $4,
            source = $5,
            status = $6,
            review_action = $7,
            reviewed_by = $8,
            reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and organization_id = $2
      returning *`,
    }
  );
  return result.rows[0] ? mapRowToMapping(result.rows[0]) : null;
}

/** Link a mapping to the live `vendors` row it produced. */
async function attachVendorId(mappingId, organizationId, vendorId) {
  if (!pool.hasStorage() || !mappingId || !organizationId) return null;
  const result = await pool.query(
    `update vendor_category_mappings set vendor_id = $3, updated_at = now()
      where id = $1 and organization_id = $2 returning *`,
    [mappingId, organizationId, nullable(vendorId)],
    { d1: true }
  );
  return result.rows[0] ? mapRowToMapping(result.rows[0]) : null;
}

/** Headline counts for the review screen, computed in the database. */
async function summarizeCategoryMappings(sessionId, organizationId) {
  const empty = {
    total: 0,
    mapped: 0,
    approved: 0,
    pendingReview: 0,
    selfMapRequired: 0,
    selfMapped: 0,
    rejected: 0,
    newCategorySuggestions: 0,
    failed: 0,
    queued: 0,
    processing: 0,
    completed: 0,
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
  };
  if (!pool.hasStorage() || !sessionId || !organizationId) return empty;

  const rows = await pool.rows(
    `select count(*)::int as total,
            count(*) filter (where status = $3)::int as ai_mapped,
            count(*) filter (where status = $4)::int as approved,
            count(*) filter (where status = $5)::int as pending_review,
            count(*) filter (where status = $6)::int as self_map_required,
            count(*) filter (where status = $7)::int as self_mapped,
            count(*) filter (where status = $8)::int as rejected,
            count(*) filter (where status = $9)::int as new_category_suggestions,
            count(*) filter (where status = $10)::int as failed,
            count(*) filter (where processing_status = $11)::int as queued,
            count(*) filter (where processing_status = $12)::int as processing,
            count(*) filter (where processing_status = $13)::int as completed,
            count(*) filter (where ai_confidence >= $14)::int as high_confidence,
            count(*) filter (where ai_confidence >= $15 and ai_confidence < $14)::int as medium_confidence,
            count(*) filter (where ai_confidence is not null and ai_confidence < $15)::int as low_confidence
       from vendor_category_mappings
      where session_id = $1 and organization_id = $2`,
    [
      sessionId,
      organizationId,
      VENDOR_MAPPING_STATUS.AI_MAPPED,
      VENDOR_MAPPING_STATUS.BUYER_APPROVED,
      VENDOR_MAPPING_STATUS.PENDING_REVIEW,
      VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED,
      VENDOR_MAPPING_STATUS.SELF_MAPPED,
      VENDOR_MAPPING_STATUS.REJECTED,
      VENDOR_MAPPING_STATUS.NEW_CATEGORY_SUGGESTION,
      VENDOR_MAPPING_STATUS.FAILED,
      VENDOR_AI_PROCESSING_STATUS.QUEUED,
      VENDOR_AI_PROCESSING_STATUS.PROCESSING,
      VENDOR_AI_PROCESSING_STATUS.COMPLETED,
      90,
      70,
    ],
    {
      d1: true,
      d1Text: `select CAST(count(*) AS INTEGER) as total,
            CAST(count(*) filter (where status = $3) AS INTEGER) as ai_mapped,
            CAST(count(*) filter (where status = $4) AS INTEGER) as approved,
            CAST(count(*) filter (where status = $5) AS INTEGER) as pending_review,
            CAST(count(*) filter (where status = $6) AS INTEGER) as self_map_required,
            CAST(count(*) filter (where status = $7) AS INTEGER) as self_mapped,
            CAST(count(*) filter (where status = $8) AS INTEGER) as rejected,
            CAST(count(*) filter (where status = $9) AS INTEGER) as new_category_suggestions,
            CAST(count(*) filter (where status = $10) AS INTEGER) as failed,
            CAST(count(*) filter (where processing_status = $11) AS INTEGER) as queued,
            CAST(count(*) filter (where processing_status = $12) AS INTEGER) as processing,
            CAST(count(*) filter (where processing_status = $13) AS INTEGER) as completed,
            CAST(count(*) filter (where ai_confidence >= $14) AS INTEGER) as high_confidence,
            CAST(count(*) filter (where ai_confidence >= $15 and ai_confidence < $14) AS INTEGER) as medium_confidence,
            CAST(count(*) filter (where ai_confidence is not null and ai_confidence < $15) AS INTEGER) as low_confidence
       from vendor_category_mappings
      where session_id = $1 and organization_id = $2`,
    }
  );
  if (rows.length === 0) return empty;
  const row = rows[0];
  return {
    total: counter(row.total),
    mapped: counter(row.ai_mapped) + counter(row.approved),
    approved: counter(row.approved),
    pendingReview: counter(row.pending_review),
    selfMapRequired: counter(row.self_map_required),
    selfMapped: counter(row.self_mapped),
    rejected: counter(row.rejected),
    newCategorySuggestions: counter(row.new_category_suggestions),
    failed: counter(row.failed),
    queued: counter(row.queued),
    processing: counter(row.processing),
    completed: counter(row.completed),
    highConfidence: counter(row.high_confidence),
    mediumConfidence: counter(row.medium_confidence),
    lowConfidence: counter(row.low_confidence),
  };
}

/**
 * Vendors grouped by their final category, for the segmentation view.
 *
 * Groups on the buyer-approved category when there is one and the AI category
 * otherwise, so a supplier appears under the category that is actually in force.
 * Suppliers awaiting self-mapping are grouped under a null category, which the
 * service renders as its own "Self Mapping Required" bucket.
 */
async function findCategorySegmentation(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const rows = await pool.rows(
    `select coalesce(nullif(buyer_major_category, ''), nullif(ai_major_category, '')) as major_category,
            status,
            count(*)::int as vendor_count,
            coalesce(sum(total_spend), 0) as total_spend,
            array_agg(company_name order by total_spend desc, company_name) as companies
       from vendor_category_mappings
      where session_id = $1 and organization_id = $2
      group by major_category, status
      order by major_category nulls last, status`,
    [sessionId, organizationId],
    {
      d1: true,
      // json_group_array(x ORDER BY y) is D1/SQLite's array_agg(x ORDER BY y)
      // equivalent — confirmed directly against the real database before
      // relying on it — and comes back as a JSON string, parsed below.
      d1Text: `select coalesce(nullif(buyer_major_category, ''), nullif(ai_major_category, '')) as major_category,
            status,
            CAST(count(*) AS INTEGER) as vendor_count,
            coalesce(sum(total_spend), 0) as total_spend,
            json_group_array(company_name order by total_spend desc, company_name) as companies
       from vendor_category_mappings
      where session_id = $1 and organization_id = $2
      group by major_category, status
      order by major_category nulls last, status`,
    }
  );
  return rows.map((row) => ({
    majorCategory: text(row.major_category),
    status: row.status,
    vendorCount: counter(row.vendor_count),
    totalSpend: counter(row.total_spend),
    companies: (Array.isArray(row.companies) ? row.companies : JSON.parse(row.companies || '[]')).filter(Boolean),
  }));
}

/**
 * Every approved mapping for an organisation, regardless of session.
 *
 * Powers the buyer's Vendor Summary screen, which shows the category a supplier
 * is actually empanelled under rather than re-deriving it from the ingestion
 * wizard. Only decided rows are returned — a pending suggestion is not a fact
 * about a vendor yet.
 */
async function findApprovedMappingsForOrganization(organizationId) {
  if (!pool.hasStorage() || !organizationId) return [];
  const rows = await pool.rows(
    `${MAPPING_SELECT}
      where organization_id = $1
        and status in ($2, $3, $4)
      order by updated_at desc`,
    [
      organizationId,
      VENDOR_MAPPING_STATUS.BUYER_APPROVED,
      VENDOR_MAPPING_STATUS.AI_MAPPED,
      VENDOR_MAPPING_STATUS.SELF_MAPPED,
    ],
    { d1: true }
  );
  return rows.map(mapRowToMapping);
}

// ------------------------------------------------------------------------------
// DISPATCHES & EMAIL LEDGER
// ------------------------------------------------------------------------------

function mapRowToDispatch(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    organizationId: row.organization_id,
    template: row.template,
    majorCategory: text(row.major_category),
    recipientCount: counter(row.recipient_count),
    sentCount: counter(row.sent_count),
    failedCount: counter(row.failed_count),
    skippedCount: counter(row.skipped_count),
    status: row.status,
    dispatchedBy: text(row.dispatched_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertDispatch({ sessionId, organizationId, template, majorCategory, recipientCount, dispatchedBy }) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `insert into vendor_category_dispatches
       (id, session_id, organization_id, template, major_category, recipient_count, status, dispatched_by, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      newId('vcd'),
      sessionId,
      organizationId,
      template,
      nullable(majorCategory),
      counter(recipientCount),
      VENDOR_DISPATCH_STATUS.QUEUED,
      nullable(dispatchedBy),
      JSON.stringify({}),
    ],
    { d1: true }
  );
  return result.rows[0] ? mapRowToDispatch(result.rows[0]) : null;
}

async function finalizeDispatch(dispatchId, organizationId, { sentCount, failedCount, skippedCount, status }) {
  if (!pool.hasStorage() || !dispatchId || !organizationId) return null;
  const result = await pool.query(
    `update vendor_category_dispatches
        set sent_count = $3, failed_count = $4, skipped_count = $5, status = $6, updated_at = now()
      where id = $1 and organization_id = $2
      returning *`,
    [dispatchId, organizationId, counter(sentCount), counter(failedCount), counter(skippedCount), status],
    { d1: true }
  );
  return result.rows[0] ? mapRowToDispatch(result.rows[0]) : null;
}

async function findDispatches(sessionId, organizationId) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const rows = await pool.rows(
    `select * from vendor_category_dispatches
      where session_id = $1 and organization_id = $2 order by created_at desc limit 100`,
    [sessionId, organizationId],
    { d1: true }
  );
  return rows.map(mapRowToDispatch);
}

/**
 * The idempotency key for one (organisation, template, recipient, category) send.
 *
 * Category is part of the key on purpose: a supplier legitimately mapped to two
 * major categories should receive one notification per category, but never two
 * for the same one. The recipient is lowercased so a re-uploaded sheet with
 * different casing cannot slip past the UNIQUE index.
 */
function buildIdempotencyKey({ organizationId, template, recipientEmail, majorCategory }) {
  return [
    organizationId,
    template,
    String(recipientEmail || '').trim().toLowerCase(),
    text(majorCategory).toLowerCase(),
  ].join('|');
}

function mapRowToEmailLog(row) {
  return {
    id: row.id,
    dispatchId: row.dispatch_id,
    sessionId: row.session_id,
    organizationId: row.organization_id,
    vendorRecordId: row.vendor_record_id,
    recipientEmail: text(row.recipient_email),
    recipientName: text(row.recipient_name),
    template: row.template,
    majorCategory: text(row.major_category),
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attemptCount: counter(row.attempt_count),
    messageId: text(row.message_id),
    detail: text(row.detail),
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Which of these idempotency keys have already been used, and in what state.
 *
 * Read before a dispatch so the buyer can be warned "4 of these already
 * received this email" *before* confirming, rather than discovering it in the
 * result. Keys are matched with `= any($2)` so one round trip covers the whole
 * recipient list.
 */
async function findEmailLogsByIdempotencyKeys(organizationId, keys = []) {
  if (!pool.hasStorage() || !organizationId || keys.length === 0) return [];
  // = any($2) binds a single array parameter — a Postgres-only construct.
  // SQLite has no array parameter type at all, so the D1 path expands to a
  // dynamic IN (...) with one placeholder per key, each bound individually
  // via d1Params rather than sharing pg's [organizationId, keys] shape.
  const inPlaceholders = keys.map((_, i) => `$${i + 2}`).join(', ');
  const rows = await pool.rows(
    'select * from vendor_email_dispatch_log where organization_id = $1 and idempotency_key = any($2)',
    [organizationId, keys],
    {
      d1: true,
      d1Text: `select * from vendor_email_dispatch_log where organization_id = $1 and idempotency_key in (${inPlaceholders})`,
      d1Params: [organizationId, ...keys],
    }
  );
  return rows.map(mapRowToEmailLog);
}

/**
 * Claim a send slot for one recipient.
 *
 * `on conflict (idempotency_key)` is the duplicate-send defence, and the
 * `where` on the update is what makes it safe: an existing row is only re-armed
 * when it is FAILED or PENDING. A row already SENT matches nothing, so the
 * statement returns no row and the caller skips it — a successful email can
 * never be sent twice, including by a retry.
 */
async function claimEmailSlot({
  dispatchId,
  sessionId,
  organizationId,
  vendorRecordId,
  recipientEmail,
  recipientName,
  template,
  majorCategory,
}) {
  if (!pool.hasStorage()) return null;
  const idempotencyKey = buildIdempotencyKey({ organizationId, template, recipientEmail, majorCategory });
  const result = await pool.query(
    `insert into vendor_email_dispatch_log
       (id, dispatch_id, session_id, organization_id, vendor_record_id, recipient_email,
        recipient_name, template, major_category, idempotency_key, status, attempt_count)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
     on conflict (idempotency_key) do update
       set status = $11,
           dispatch_id = $2,
           attempt_count = vendor_email_dispatch_log.attempt_count + 1,
           detail = null,
           updated_at = now()
       where vendor_email_dispatch_log.status in ($12, $13)
     returning *`,
    [
      newId('vedl'),
      dispatchId,
      sessionId,
      organizationId,
      nullable(vendorRecordId),
      String(recipientEmail || '').trim().toLowerCase(),
      nullable(recipientName),
      template,
      nullable(majorCategory),
      idempotencyKey,
      VENDOR_EMAIL_STATUS.QUEUED,
      VENDOR_EMAIL_STATUS.FAILED,
      VENDOR_EMAIL_STATUS.PENDING,
    ],
    { d1: true }
  );
  return result.rows[0] ? mapRowToEmailLog(result.rows[0]) : null;
}

async function markEmailSent(logId, organizationId, messageId) {
  if (!pool.hasStorage() || !logId || !organizationId) return null;
  const result = await pool.query(
    `update vendor_email_dispatch_log
        set status = $3, message_id = $4, detail = null, sent_at = now(), updated_at = now()
      where id = $1 and organization_id = $2
      returning *`,
    [logId, organizationId, VENDOR_EMAIL_STATUS.SENT, nullable(messageId)],
    { d1: true }
  );
  return result.rows[0] ? mapRowToEmailLog(result.rows[0]) : null;
}

async function markEmailFailed(logId, organizationId, detail) {
  if (!pool.hasStorage() || !logId || !organizationId) return null;
  const result = await pool.query(
    `update vendor_email_dispatch_log
        set status = $3, detail = $4, updated_at = now()
      where id = $1 and organization_id = $2
      returning *`,
    [logId, organizationId, VENDOR_EMAIL_STATUS.FAILED, nullable(detail)],
    { d1: true }
  );
  return result.rows[0] ? mapRowToEmailLog(result.rows[0]) : null;
}

async function findEmailLogs(sessionId, organizationId, { status, limit } = {}) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const params = [sessionId, organizationId];
  let where = 'where session_id = $1 and organization_id = $2';
  if (status) {
    params.push(status);
    where += ` and status = $${params.length}`;
  }
  params.push(counter(limit) || 500);
  const rows = await pool.rows(
    `select * from vendor_email_dispatch_log ${where} order by created_at desc limit $${params.length}`,
    params,
    { d1: true }
  );
  return rows.map(mapRowToEmailLog);
}

/** Totals for the email status panel. */
async function summarizeEmailLogs(sessionId, organizationId) {
  const empty = { total: 0, pending: 0, queued: 0, sent: 0, failed: 0, delivered: 0, bounced: 0 };
  if (!pool.hasStorage() || !sessionId || !organizationId) return empty;
  const rows = await pool.rows(
    `select count(*)::int as total,
            count(*) filter (where status = $3)::int as pending,
            count(*) filter (where status = $4)::int as queued,
            count(*) filter (where status = $5)::int as sent,
            count(*) filter (where status = $6)::int as failed,
            count(*) filter (where status = $7)::int as delivered,
            count(*) filter (where status = $8)::int as bounced
       from vendor_email_dispatch_log
      where session_id = $1 and organization_id = $2`,
    [
      sessionId,
      organizationId,
      VENDOR_EMAIL_STATUS.PENDING,
      VENDOR_EMAIL_STATUS.QUEUED,
      VENDOR_EMAIL_STATUS.SENT,
      VENDOR_EMAIL_STATUS.FAILED,
      VENDOR_EMAIL_STATUS.DELIVERED,
      VENDOR_EMAIL_STATUS.BOUNCED,
    ],
    {
      d1: true,
      d1Text: `select CAST(count(*) AS INTEGER) as total,
            CAST(count(*) filter (where status = $3) AS INTEGER) as pending,
            CAST(count(*) filter (where status = $4) AS INTEGER) as queued,
            CAST(count(*) filter (where status = $5) AS INTEGER) as sent,
            CAST(count(*) filter (where status = $6) AS INTEGER) as failed,
            CAST(count(*) filter (where status = $7) AS INTEGER) as delivered,
            CAST(count(*) filter (where status = $8) AS INTEGER) as bounced
       from vendor_email_dispatch_log
      where session_id = $1 and organization_id = $2`,
    }
  );
  if (rows.length === 0) return empty;
  const row = rows[0];
  return {
    total: counter(row.total),
    pending: counter(row.pending),
    queued: counter(row.queued),
    sent: counter(row.sent),
    failed: counter(row.failed),
    delivered: counter(row.delivered),
    bounced: counter(row.bounced),
  };
}

// ------------------------------------------------------------------------------
// AUDIT & AI LOGS
// ------------------------------------------------------------------------------

/**
 * Append one module audit entry.
 *
 * Fire-and-forget from the caller's point of view but awaited here, so an audit
 * write failure surfaces in the service's own error handling rather than as an
 * unhandled rejection. old_value/new_value are the before/after of a change —
 * that pair is why this table exists alongside the hash-chained `audit_logs`.
 */
async function insertAuditEntry({
  sessionId,
  organizationId,
  userId,
  userEmail,
  action,
  entityType,
  entityId,
  oldValue,
  newValue,
}) {
  if (!pool.hasStorage() || !organizationId || !action) return null;
  const result = await pool.query(
    `insert into vendor_ingestion_audit
       (id, session_id, organization_id, user_id, user_email, action, entity_type, entity_id,
        old_value, new_value)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
     returning id, created_at`,
    [
      newId('via'),
      nullable(sessionId),
      organizationId,
      nullable(userId),
      nullable(userEmail),
      action,
      nullable(entityType),
      nullable(entityId),
      oldValue === undefined || oldValue === null ? null : JSON.stringify(oldValue),
      newValue === undefined || newValue === null ? null : JSON.stringify(newValue),
    ],
    {
      d1: true,
      d1Text: `insert into vendor_ingestion_audit
       (id, session_id, organization_id, user_id, user_email, action, entity_type, entity_id,
        old_value, new_value)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id, created_at`,
    }
  );
  return result.rows[0] || null;
}

async function findAuditEntries(organizationId, { sessionId, limit, offset } = {}) {
  if (!pool.hasStorage() || !organizationId) return [];
  const params = [organizationId];
  let where = 'where organization_id = $1';
  if (sessionId) {
    params.push(sessionId);
    where += ` and session_id = $${params.length}`;
  }
  params.push(Math.min(counter(limit) || 100, 500));
  const limitSlot = params.length;
  params.push(counter(offset));
  const offsetSlot = params.length;

  // sequence is a Postgres-side auto-generated identity column, same as
  // audit_logs/notifications/ai_feed — see getAuditLogsFromDB's comment in
  // domainQueries.js. The D1 path orders by SQLite's own implicit rowid.
  const rows = await pool.rows(
    `select id, sequence, session_id, organization_id, user_id, user_email, action,
            entity_type, entity_id, old_value, new_value, created_at
       from vendor_ingestion_audit ${where}
      order by sequence desc limit $${limitSlot} offset $${offsetSlot}`,
    params,
    {
      d1: true,
      d1Text: `select id, sequence, session_id, organization_id, user_id, user_email, action,
            entity_type, entity_id, old_value, new_value, created_at
       from vendor_ingestion_audit ${where}
      order by rowid desc limit $${limitSlot} offset $${offsetSlot}`,
    }
  );
  return rows.map((row) => ({
    id: row.id,
    sequence: Number(row.sequence),
    sessionId: row.session_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    userEmail: text(row.user_email),
    action: row.action,
    entityType: text(row.entity_type),
    entityId: text(row.entity_id),
    oldValue: typeof row.old_value === 'string' ? JSON.parse(row.old_value) : row.old_value,
    newValue: typeof row.new_value === 'string' ? JSON.parse(row.new_value) : row.new_value,
    createdAt: row.created_at,
  }));
}

/**
 * Log one classification attempt, successful or not.
 *
 * The prompt text is deliberately not stored — only its length. It embeds the
 * buyer's category master and spend detail, and this table is read by support
 * tooling that has no business seeing either.
 */
async function insertAiClassificationLog({
  sessionId,
  organizationId,
  vendorRecordId,
  vendorCode,
  model,
  status,
  attempt,
  promptChars,
  poCount,
  durationMs,
  error,
  response,
}) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return null;
  const result = await pool.query(
    `insert into ai_classification_logs
       (id, session_id, organization_id, vendor_record_id, vendor_code, model, status,
        attempt, prompt_chars, po_count, duration_ms, error, response)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     returning id`,
    [
      newId('aicl'),
      sessionId,
      organizationId,
      nullable(vendorRecordId),
      nullable(vendorCode),
      nullable(model),
      status,
      counter(attempt) || 1,
      counter(promptChars),
      counter(poCount),
      counter(durationMs),
      nullable(error),
      response === undefined || response === null ? null : JSON.stringify(response),
    ],
    {
      d1: true,
      d1Text: `insert into ai_classification_logs
       (id, session_id, organization_id, vendor_record_id, vendor_code, model, status,
        attempt, prompt_chars, po_count, duration_ms, error, response)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning id`,
    }
  );
  return result.rows[0] || null;
}

async function findAiClassificationLogs(sessionId, organizationId, { limit } = {}) {
  if (!pool.hasStorage() || !sessionId || !organizationId) return [];
  const rows = await pool.rows(
    `select id, vendor_record_id, vendor_code, model, status, attempt, prompt_chars,
            po_count, duration_ms, error, created_at
       from ai_classification_logs
      where session_id = $1 and organization_id = $2
      order by created_at desc limit $3`,
    [sessionId, organizationId, Math.min(counter(limit) || 200, 500)],
    { d1: true }
  );
  return rows.map((row) => ({
    id: row.id,
    vendorRecordId: row.vendor_record_id,
    vendorCode: text(row.vendor_code),
    model: text(row.model),
    status: row.status,
    attempt: counter(row.attempt),
    promptChars: counter(row.prompt_chars),
    poCount: counter(row.po_count),
    durationMs: counter(row.duration_ms),
    error: text(row.error),
    createdAt: row.created_at,
  }));
}

module.exports = {
  // helpers (exported for the service and for direct unit testing)
  newId,
  text,
  nullable,
  numeric,
  counter,
  dateOnly,
  jsonArray,
  normalizeVendorName,
  buildIdempotencyKey,
  mapRowToSession,
  mapRowToVendorMaster,
  mapRowToMapping,
  mapRowToDispatch,
  mapRowToEmailLog,
  SESSION_COLUMN_MAP,
  // sessions
  insertSession,
  findSession,
  findSessionById,
  findLatestSession,
  updateSession,
  // ingestion jobs
  createIngestionJob,
  updateIngestionJobProgress,
  findIngestionJob,
  findLatestIngestionJob,
  findActiveIngestionJobs,
  mapRowToIngestionJob,
  // category master
  findOrganizationCategoryMaster,
  // vendor master
  bulkUpsertVendorMasterRecords,
  findVendorMasterRecords,
  findVendorMasterRecord,
  countVendorMasterRecords,
  deleteVendorMasterRecords,
  // po data
  bulkInsertPoLineItems,
  countPoLineItems,
  deletePoLineItems,
  matchPoLineItemsToVendors,
  findVendorPurchasingProfiles,
  findUnmatchedPoVendors,
  // mappings
  seedCategoryMappings,
  findCategoryMappings,
  findCategoryMappingByVendorRecord,
  findQueuedCategoryMappings,
  markMappingProcessing,
  saveAiSuggestion,
  markMappingFailed,
  requeueMapping,
  saveBuyerReview,
  attachVendorId,
  summarizeCategoryMappings,
  findCategorySegmentation,
  findApprovedMappingsForOrganization,
  // dispatch
  insertDispatch,
  finalizeDispatch,
  findDispatches,
  claimEmailSlot,
  markEmailSent,
  markEmailFailed,
  findEmailLogs,
  findEmailLogsByIdempotencyKeys,
  summarizeEmailLogs,
  // audit & ai logs
  insertAuditEntry,
  findAuditEntries,
  insertAiClassificationLog,
  findAiClassificationLogs,
  VENDOR_INGESTION_AI_STATUS,
};
