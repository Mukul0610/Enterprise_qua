// ==============================================================================
// DOMAIN QUERIES (Neon PostgreSQL)
// ==============================================================================
// Thin read/write helpers over the `raw JSONB` tables in schema.sql: vendors,
// RFQs, evaluations, vendor catalogue, buyer accounts, AI feed and audit logs.
//
// Every function no-ops (returns [] / null / false) when the pool isn't
// configured, so storeService.js can call these unconditionally without its own
// guards. Note that a no-op read is NOT a fallback to seed data — storeService
// treats the empty result as an empty collection and reports the database as
// unavailable; there is nothing else to serve.
// ==============================================================================

const pool = require('./pool');
const { getD1Binding, batchD1 } = require('./d1Bridge');

// ── Vendors ──────────────────────────────────────────────────────────────────

async function getVendorsFromDB() {
  if (!pool.hasStorage()) return [];
  const result = await pool.query(
    'SELECT raw FROM vendors ORDER BY created_at DESC',
    [],
    { d1: true }
  );
  return (result && result.rows) ? result.rows.map((row) => parseRaw(row.raw)) : [];
}

/**
 * One page of vendors, filtered and counted entirely in Postgres.
 *
 * getVendorsFromDB() fetches every row's full `raw` JSONB — fine for a
 * one-time boot hydration, but a real request hit it on every single "Load
 * more" click once the vendor table reached 80k+ rows (a bulk Vendor Master
 * import): each click re-fetched and re-serialized the entire table just to
 * throw away all but 50 rows, slow/heavy enough to hang the browser mid-
 * pagination. This does the LIMIT/OFFSET/search filtering in SQL instead, so
 * a page request only ever touches the rows it actually returns.
 */
async function getVendorsPageFromDB({ limit, offset, search = '', category = '', publicOnly = false, scopedBuyerId = '' } = {}) {
  if (!pool.hasStorage()) return { rows: [], total: 0 };
  const params = [];
  // Two parallel condition lists, not one translated after the fact: ILIKE
  // has no SQLite equivalent (LIKE + lower() instead), raw->>'x' is Postgres
  // JSONB syntax (SQLite's is json_extract(raw,'$.x'), which already returns
  // text for a scalar — no separate ::text cast needed), and (raw->'x')::text
  // likewise becomes json_extract. Both lists push the exact same params in
  // the exact same order, so one params array serves either query text.
  const conditions = [];
  const d1Conditions = [];
  if (search) {
    params.push(`%${search}%`);
    // major_category/email/name/minorCategories are all backed by a trigram
    // GIN index (idx_vendors_*_trgm in schema.sql) so this substring ILIKE
    // doesn't force a sequential scan of the whole table at 600k+ rows.
    conditions.push(`(major_category ILIKE $${params.length}
      OR email ILIKE $${params.length}
      OR raw->>'name' ILIKE $${params.length}
      OR (raw->'minorCategories')::text ILIKE $${params.length})`);
    d1Conditions.push(`(lower(major_category) LIKE lower($${params.length})
      OR lower(email) LIKE lower($${params.length})
      OR lower(json_extract(raw,'$.name')) LIKE lower($${params.length})
      OR lower(json_extract(raw,'$.minorCategories')) LIKE lower($${params.length}))`);
  }
  if (category) {
    // An exact-match category filter (the CM's category dropdown), separate
    // from the free-text `search` above — combinable with it via AND. Uses
    // the existing plain btree idx_vendors_major_category index (an equality
    // match, unlike search's leading-wildcard ILIKE, so no trigram needed).
    params.push(category);
    conditions.push(`major_category = $${params.length}`);
    d1Conditions.push(`major_category = $${params.length}`);
  }
  if (publicOnly) {
    // Mirrors storeService.getVendors' unscoped filter: a vendor tagged to a
    // specific buyer (buyerId/buyerAccountId set inside `raw`) is only meant
    // to be visible to that buyer, never in an anonymous/public listing.
    conditions.push(`(raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL`);
    d1Conditions.push(`json_extract(raw,'$.buyerId') IS NULL AND json_extract(raw,'$.buyerAccountId') IS NULL`);
  }
  if (scopedBuyerId) {
    // A buyer's paginated listing must include every public vendor (no
    // buyerId/buyerAccountId at all) plus their own uploads — the same rule
    // storeService.getVendors applies in memory. Previously only the fully-
    // open ("all") listing got this SQL fast path; any buyer-scoped page
    // request fell through to storeService.getVendors(buyerId), which
    // re-fetches and re-serializes every one of 600k+ rows on every single
    // call regardless of scope, since almost all vendors are public and thus
    // visible to every buyer anyway. Backed by idx_vendors_buyer_id/
    // idx_vendors_buyer_account_id (schema.sql) so the OR still uses indexes
    // instead of a sequential scan.
    params.push(scopedBuyerId);
    const p = params.length;
    conditions.push(`(
      ((raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL)
      OR lower(raw->>'buyerId') = lower($${p})
      OR lower(raw->>'buyerAccountId') = lower($${p})
      OR lower(raw->>'buyerEmail') = lower($${p})
    )`);
    d1Conditions.push(`(
      (json_extract(raw,'$.buyerId') IS NULL AND json_extract(raw,'$.buyerAccountId') IS NULL)
      OR lower(json_extract(raw,'$.buyerId')) = lower($${p})
      OR lower(json_extract(raw,'$.buyerAccountId')) = lower($${p})
      OR lower(json_extract(raw,'$.buyerEmail')) = lower($${p})
    )`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const d1Where = d1Conditions.length ? `WHERE ${d1Conditions.join(' AND ')}` : '';

  // Separate param arrays for the count vs. data query — sharing and
  // mutating one array across both calls works with a driver that sends the
  // query immediately, but is a needless footgun (and confusing to inspect
  // in tests) for no benefit.
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM vendors ${where}`,
    [...params],
    { d1: true, d1Text: `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM vendors ${d1Where}` }
  );
  const total = countResult.rows[0]?.total || 0;

  const dataParams = [...params, limit, offset];
  const dataResult = await pool.query(
    `SELECT raw FROM vendors ${where} ORDER BY created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams,
    {
      d1: true,
      d1Text: `SELECT raw FROM vendors ${d1Where} ORDER BY created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    }
  );
  return { rows: dataResult.rows.map((row) => parseRaw(row.raw)), total };
}

/** Single-row lookup by email — used to guarantee a specific vendor is
 * present in a capped/paginated listing without fetching the whole table. */
async function getVendorByEmailFromDB(email) {
  if (!pool.hasStorage() || !email) return null;
  // Matches the `email` column OR raw->>'corporateEmail' — a vendor's inbound
  // gateway email can be the corporate contact address rather than the
  // primary login email, and the in-memory lookup this replaces checked both.
  const result = await pool.query(
    `SELECT raw FROM vendors
     WHERE lower(email) = lower($1) OR lower(raw->>'corporateEmail') = lower($1)
     LIMIT 1`,
    [email],
    {
      d1: true,
      d1Text: `SELECT raw FROM vendors
     WHERE lower(email) = lower($1) OR lower(json_extract(raw,'$.corporateEmail')) = lower($1)
     LIMIT 1`,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

/**
 * A buyer's own uploaded/added vendors only (never the public network) —
 * bounded, so it never reads more than `limit` rows regardless of table
 * size. Used by storeService.getBootstrapData's buyer-scoped branch, which
 * used to call storeService.getVendors() (a full unbounded re-sync of the
 * entire vendors table) on every single bootstrap request for every buyer
 * page load — the actual cause of D1's free-tier daily row-read cap being
 * exhausted (6.7M rows read in 24h against a 20k-row table: confirmed live
 * via `wrangler d1 info`). A buyer's own vendor count is realistically
 * small, but this stays bounded rather than trusting that assumption.
 */
async function getVendorsByBuyerFromDB(buyerId, limit) {
  if (!pool.hasStorage() || !buyerId) return [];
  const result = await pool.query(
    `SELECT raw FROM vendors
     WHERE lower(raw->>'buyerId') = lower($1)
        OR lower(raw->>'buyerAccountId') = lower($1)
        OR lower(raw->>'buyerEmail') = lower($1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [buyerId, limit],
    {
      d1: true,
      d1Text: `SELECT raw FROM vendors
     WHERE lower(json_extract(raw,'$.buyerId')) = lower($1)
        OR lower(json_extract(raw,'$.buyerAccountId')) = lower($1)
        OR lower(json_extract(raw,'$.buyerEmail')) = lower($1)
     ORDER BY created_at DESC
     LIMIT $2`,
    }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

/** Single-row lookup by id — same reasoning as getVendorByEmailFromDB, keyed
 * on the primary key instead. storeService.getVendorById only searches the
 * in-memory this.vendors cache, which at 600k+ real vendors is a capped
 * subset (see getVendorsPageFromDB's own comment) — a vendor surfaced by a
 * live, D1-backed paginated search (e.g. the CM's "All Vendors" invite
 * picker) can be entirely absent from that cache, making an id it just
 * returned fail to resolve moments later. This is the D1 fallback for that. */
async function getVendorByIdFromDB(id) {
  if (!pool.hasStorage() || !id) return null;
  const result = await pool.query(
    'SELECT raw FROM vendors WHERE id = $1 LIMIT 1',
    [id],
    { d1: true }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function upsertVendorInDB(vendor) {
  if (!pool.hasStorage()) return null;
  const { id, email, majorCategory, status, source } = vendor;
  // See upsertEvaluationInDB's comment for why the D1 path needs its own
  // ISO-formatted timestamp rather than plain CURRENT_TIMESTAMP/now() —
  // created_at is sorted on directly by getVendorsFromDB/getVendorsPageFromDB.
  const result = await pool.query(
    `INSERT INTO vendors (id, email, major_category, status, source, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       major_category = EXCLUDED.major_category,
       status = EXCLUDED.status,
       source = EXCLUDED.source,
       raw = EXCLUDED.raw,
       updated_at = now()
     RETURNING raw`,
    [id, email || null, majorCategory || null, status || null, source || null, JSON.stringify(vendor)],
    {
      d1: true,
      d1Text: `INSERT INTO vendors (id, email, major_category, status, source, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       major_category = EXCLUDED.major_category,
       status = EXCLUDED.status,
       source = EXCLUDED.source,
       raw = EXCLUDED.raw,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING raw`,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function deleteVendorInDB(id) {
  if (!pool.hasStorage()) return false;
  const result = await pool.query(
    'DELETE FROM vendors WHERE id = $1',
    [id],
    { d1: true }
  );
  return result.rowCount > 0;
}

// One multi-row INSERT for a whole batch of newly bulk-uploaded vendors,
// rather than one round trip per row (what the reference p2pservices app
// does — confirmed not to scale). `ON CONFLICT (email) DO NOTHING` is a
// defensive backstop against a duplicate slipping in between the caller's
// own in-memory/pre-query dedup check and this insert (e.g. a concurrent
// upload); RETURNING email tells the caller exactly which rows really
// landed versus were silently skipped as a race-condition duplicate, so it
// never has to guess or trust a fire-and-forget write.
//
// D1 (Cloudflare's SQLite) enforces two separate limits a single big
// multi-row INSERT can hit: at most 100 bound parameters per statement (at 6
// params/row, ~16 rows), and a per-Worker-invocation cap on the number of
// subrequests it may make (as low as 50 on some plans) — each individual D1
// call is its own subrequest. Splitting one INSERT into many 16-row INSERTs
// fixes the first limit but immediately hits the second (confirmed live: a
// 1000-row chunk split into ~63 sequential 16-row INSERTs failed with "Too
// many API requests by single Worker invocation"). `batchD1` (see
// d1Bridge.js) solves both at once: every row becomes its own single-row
// INSERT (well under the parameter cap), and the whole set is sent to D1 as
// one `db.batch()` call — one subrequest total, regardless of row count.
// Postgres has no such caps, so it keeps the original single multi-row
// INSERT (its own 65535-parameter ceiling is far above anything a single
// request already caps out at via MAX_BULK_IMPORT_ROWS_PER_REQUEST).
async function bulkInsertVendorsInDB(vendors) {
  if (!pool.hasStorage() || vendors.length === 0) return [];

  const d1 = getD1Binding();
  if (d1) {
    const statements = vendors.map((vendor) => ({
      text: `INSERT INTO vendors (id, email, major_category, status, source, raw, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT (email) DO NOTHING
       RETURNING email`,
      params: [
        vendor.id,
        vendor.email || null,
        vendor.majorCategory || null,
        vendor.status || null,
        vendor.source || null,
        JSON.stringify(vendor),
      ],
    }));
    const results = await batchD1(d1, statements);
    return results.flatMap((result) => result.rows.map((row) => row.email));
  }

  const values = [];
  const placeholders = [];
  vendors.forEach((vendor, i) => {
    const base = i * 6;
    values.push(
      vendor.id,
      vendor.email || null,
      vendor.majorCategory || null,
      vendor.status || null,
      vendor.source || null,
      JSON.stringify(vendor)
    );
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, now())`);
  });
  const result = await pool.query(
    `INSERT INTO vendors (id, email, major_category, status, source, raw, updated_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (email) DO NOTHING
     RETURNING email`,
    values
  );
  return result.rows.map((row) => row.email);
}

// ── Bulk vendor import sessions ─────────────────────────────────────────────

async function createBulkImportSessionInDB(id, createdByEmail, totalRowsDeclared) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `INSERT INTO bulk_vendor_import_sessions (id, created_by_email, total_rows_declared)
     VALUES ($1, $2, $3)
     RETURNING id, status, total_rows_declared, processed_count, imported_count,
               missing_email_count, duplicate_count, invalid_count`,
    [id, createdByEmail, totalRowsDeclared || 0],
    { d1: true }
  );
  return result.rows[0] || null;
}

async function getBulkImportSessionFromDB(id) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `SELECT id, status, total_rows_declared, processed_count, imported_count,
            missing_email_count, duplicate_count, invalid_count
     FROM bulk_vendor_import_sessions WHERE id = $1`,
    [id],
    { d1: true }
  );
  return result.rows[0] || null;
}

async function incrementBulkImportSessionInDB(id, delta) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `UPDATE bulk_vendor_import_sessions SET
       processed_count = processed_count + $2,
       imported_count = imported_count + $3,
       missing_email_count = missing_email_count + $4,
       duplicate_count = duplicate_count + $5,
       invalid_count = invalid_count + $6,
       status = CASE WHEN processed_count + $2 >= total_rows_declared THEN 'COMPLETED' ELSE status END,
       updated_at = now()
     WHERE id = $1
     RETURNING id, status, total_rows_declared, processed_count, imported_count,
               missing_email_count, duplicate_count, invalid_count`,
    [id, delta.processed || 0, delta.imported || 0, delta.missingEmail || 0, delta.duplicate || 0, delta.invalid || 0],
    {
      d1: true,
      d1Text: `UPDATE bulk_vendor_import_sessions SET
       processed_count = processed_count + $2,
       imported_count = imported_count + $3,
       missing_email_count = missing_email_count + $4,
       duplicate_count = duplicate_count + $5,
       invalid_count = invalid_count + $6,
       status = CASE WHEN processed_count + $2 >= total_rows_declared THEN 'COMPLETED' ELSE status END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = $1
     RETURNING id, status, total_rows_declared, processed_count, imported_count,
               missing_email_count, duplicate_count, invalid_count`,
    }
  );
  return result.rows[0] || null;
}

// ── RFQs ─────────────────────────────────────────────────────────────────────

async function getRFQsFromDB() {
  if (!pool.hasStorage()) return [];
  const result = await pool.query(
    'SELECT raw FROM rfqs ORDER BY created_at DESC',
    [],
    { d1: true }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function upsertRFQInDB(rfq) {
  if (!pool.hasStorage()) return null;
  const { id, rfqNumber, category, status, sourcingMode, budget } = rfq;
  // See upsertEvaluationInDB's comment for why the D1 path needs its own
  // ISO-formatted timestamp rather than plain CURRENT_TIMESTAMP.
  const result = await pool.query(
    `INSERT INTO rfqs (id, rfq_number, category, status, sourcing_mode, budget, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO UPDATE SET
       rfq_number = EXCLUDED.rfq_number,
       category = EXCLUDED.category,
       status = EXCLUDED.status,
       sourcing_mode = EXCLUDED.sourcing_mode,
       budget = EXCLUDED.budget,
       raw = EXCLUDED.raw,
       updated_at = now()
     RETURNING raw`,
    [
      id,
      rfqNumber || null,
      category || null,
      status || null,
      sourcingMode || null,
      Number.isFinite(Number(budget)) ? Number(budget) : null,
      JSON.stringify(rfq),
    ],
    {
      d1: true,
      d1Text: `INSERT INTO rfqs (id, rfq_number, category, status, sourcing_mode, budget, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT (id) DO UPDATE SET
       rfq_number = EXCLUDED.rfq_number,
       category = EXCLUDED.category,
       status = EXCLUDED.status,
       sourcing_mode = EXCLUDED.sourcing_mode,
       budget = EXCLUDED.budget,
       raw = EXCLUDED.raw,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING raw`,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function deleteRFQInDB(id) {
  if (!pool.hasStorage()) return false;
  const result = await pool.query(
    'DELETE FROM rfqs WHERE id = $1',
    [id],
    { d1: true }
  );
  return result.rowCount > 0;
}

// ── Evaluations (append-only — no update/delete method exists) ────────────────

async function getEvaluationsFromDB() {
  if (!pool.hasStorage()) return [];
  const result = await pool.query(
    'SELECT raw FROM evaluations ORDER BY created_at DESC',
    [],
    { d1: true }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function upsertEvaluationInDB(evaluation) {
  if (!pool.hasStorage()) return null;
  const { id, vendorId, status } = evaluation;
  // updated_at doesn't drive getEvaluationsFromDB's sort — created_at does,
  // separately defaulted at the schema level — but CURRENT_TIMESTAMP still
  // needs a D1-specific ISO form here: plain CURRENT_TIMESTAMP renders as
  // "YYYY-MM-DD HH:MM:SS" on SQLite, which would sort inconsistently against
  // any ISO-formatted ("...T...Z") timestamp already in the column from
  // migrated data — same trap as authSessionQueries' purge comparison.
  const result = await pool.query(
    `INSERT INTO evaluations (id, vendor_id, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    [id, vendorId || null, status || null, JSON.stringify(evaluation)],
    {
      d1: true,
      d1Text: `INSERT INTO evaluations (id, vendor_id, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING raw`,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

// ── Vendor catalogue ────────────────────────────────────────────────────────

async function getVendorCatalogueFromDB() {
  if (!pool.hasStorage()) return [];
  const result = await pool.query(
    'SELECT raw FROM vendor_catalogue ORDER BY created_at DESC',
    [],
    { d1: true }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function upsertCatalogueProductInDB(product) {
  if (!pool.hasStorage()) return null;
  const { id, vendorId, sku, category } = product;
  // See upsertEvaluationInDB's comment: CURRENT_TIMESTAMP on D1 renders in a
  // format that doesn't sort correctly against the ISO created_at/updated_at
  // already in the column from migrated data, since this table's D1 default
  // needs the same ISO form.
  const result = await pool.query(
    `INSERT INTO vendor_catalogue (id, vendor_id, sku, category, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       sku = EXCLUDED.sku,
       category = EXCLUDED.category,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    [id, vendorId || null, sku || null, category || null, JSON.stringify(product)],
    {
      d1: true,
      d1Text: `INSERT INTO vendor_catalogue (id, vendor_id, sku, category, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       sku = EXCLUDED.sku,
       category = EXCLUDED.category,
       raw = EXCLUDED.raw,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING raw`,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function deleteCatalogueProductInDB(id) {
  if (!pool.hasStorage()) return false;
  const result = await pool.query(
    'DELETE FROM vendor_catalogue WHERE id = $1',
    [id],
    { d1: true }
  );
  return result.rowCount > 0;
}

// ── Buyer accounts ──────────────────────────────────────────────────────────
// activeBuyerAccount is a pointer into this same collection, not a separate
// record, so it's modelled as an is_active flag rather than its own row —
// getBuyerAccountsFromDB returns both the accounts and which id (if any) is
// flagged active, so storeService can resolve the same object-reference
// invariant it already has in memory.

async function getBuyerAccountsFromDB() {
  if (!pool.hasStorage()) return { accounts: [], activeId: null };
  const result = await pool.query(
    'SELECT id, is_active, raw FROM buyer_accounts ORDER BY created_at DESC',
    [],
    { d1: true }
  );
  const accounts = result.rows.map((row) => parseRaw(row.raw));
  const activeRow = result.rows.find((row) => row.is_active);
  return { accounts, activeId: activeRow ? activeRow.id : null };
}

// Reads straight from Postgres rather than an in-memory cache, so a plan/role
// change made by any other process (a script, another instance) is visible on
// the very next request instead of requiring this process to restart.
async function getBuyerAccountByEmailFromDB(email) {
  if (!pool.hasStorage() || !email) return null;
  const result = await pool.query(
    'SELECT raw FROM buyer_accounts WHERE lower(corporate_email) = lower($1) LIMIT 1',
    [email],
    { d1: true }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function upsertBuyerAccountInDB(account) {
  if (!pool.hasStorage()) return null;
  const { id, corporateEmail, status } = account;
  // is_active is deliberately not touched here — this saves the account's own
  // data, not which account is active. setActiveBuyerAccountInDB owns that flag.
  // See upsertEvaluationInDB's comment for why the D1 path needs its own
  // ISO-formatted timestamp rather than plain CURRENT_TIMESTAMP.
  const result = await pool.query(
    `INSERT INTO buyer_accounts (id, corporate_email, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       corporate_email = EXCLUDED.corporate_email,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = now()
     RETURNING raw`,
    [id, corporateEmail || null, status || null, JSON.stringify(account)],
    {
      d1: true,
      d1Text: `INSERT INTO buyer_accounts (id, corporate_email, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT (id) DO UPDATE SET
       corporate_email = EXCLUDED.corporate_email,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING raw`,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function deleteBuyerAccountInDB(id) {
  if (!pool.hasStorage()) return false;
  const result = await pool.query(
    'DELETE FROM buyer_accounts WHERE id = $1',
    [id],
    { d1: true }
  );
  return result.rowCount > 0;
}

// Exactly one row (or none) carries is_active=true at a time. Passing an id
// that doesn't exist in the table just clears every row's flag, matching
// alignActiveBuyerAccount's in-memory "not found" behaviour of leaving the
// pointer unchanged from the caller's perspective (no row matches either way).
async function setActiveBuyerAccountInDB(id) {
  if (!pool.hasStorage()) return;
  // (id = $1) evaluates to a boolean in Postgres and to 0/1 in SQLite —
  // both assignable straight into is_active, no divergence needed here.
  await pool.query(
    'UPDATE buyer_accounts SET is_active = (id = $1)',
    [id],
    { d1: true }
  );
}

// ── AI feed (100-item cap, trimmed here so triggerBatchChaser's bulk-insert
// path — which bypasses addAIFeedItem's in-memory pop() — gets the same
// trim without needing its own bookkeeping of which item to evict) ──────────

async function getAIFeedFromDB() {
  if (!pool.hasStorage()) return [];
  // sequence is a Postgres-side auto-generated identity column, same as
  // notifications.sequence — see getNotificationsFromDB's comment. The D1
  // path orders by SQLite's own implicit rowid instead.
  const result = await pool.query(
    'SELECT raw FROM ai_feed ORDER BY sequence DESC',
    [],
    { d1: true, d1Text: 'SELECT raw FROM ai_feed ORDER BY rowid DESC' }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function upsertAIFeedItemInDB(item) {
  if (!pool.hasStorage()) return null;
  const { id } = item;
  const result = await pool.query(
    `INSERT INTO ai_feed (id, raw) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET raw = EXCLUDED.raw
     RETURNING raw`,
    [id, JSON.stringify(item)],
    { d1: true }
  );
  await pool.query(
    `DELETE FROM ai_feed WHERE id NOT IN (SELECT id FROM ai_feed ORDER BY sequence DESC LIMIT 100)`,
    [],
    {
      d1: true,
      d1Text: `DELETE FROM ai_feed WHERE id NOT IN (SELECT id FROM ai_feed ORDER BY rowid DESC LIMIT 100)`,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

// ── Audit logs (SHA-256 hash chain — sequence must reflect exact insertion
// order, see schema.sql's comment on audit_logs.sequence) ───────────────────

async function getAuditLogsFromDB() {
  if (!pool.hasStorage()) return [];
  // Reconstructing exact insertion order is load-bearing here — auditService
  // walks this newest-first list checking each entry's previousHash against
  // the next (older) one's own hash, so a wrong order looks like a broken
  // tamper chain. Same sequence -> rowid substitution as ai_feed/
  // notifications; SQLite's rowid gives the identical "strictly increases in
  // insertion order" guarantee Postgres's BIGSERIAL sequence does.
  const result = await pool.query(
    'SELECT raw FROM audit_logs ORDER BY sequence DESC',
    [],
    { d1: true, d1Text: 'SELECT raw FROM audit_logs ORDER BY rowid DESC' }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function upsertAuditLogInDB(entry) {
  if (!pool.hasStorage()) return null;
  const { id } = entry;
  const result = await pool.query(
    `INSERT INTO audit_logs (id, raw) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET raw = EXCLUDED.raw
     RETURNING raw`,
    [id, JSON.stringify(entry)],
    { d1: true }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

// ── Notifications ────────────────────────────────────────────────────────────

async function getNotificationsFromDB() {
  if (!pool.hasStorage()) return [];
  // `sequence` is a Postgres-side auto-generated identity column — it's
  // never in any INSERT's column list, so a D1 row would have it NULL. D1
  // has no auto-increment-on-conflict-free-PK equivalent here (id is TEXT,
  // and SQLite's autoincrement rowid needs an INTEGER PRIMARY KEY), so the
  // D1 path orders by SQLite's own implicit rowid instead, which already
  // increases in insertion order and serves the same "newest first" need.
  const result = await pool.query(
    'SELECT raw FROM notifications ORDER BY sequence DESC',
    [],
    { d1: true, d1Text: 'SELECT raw FROM notifications ORDER BY rowid DESC' }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function insertNotificationInDB(notification) {
  if (!pool.hasStorage()) return null;
  const { id, recipientType, recipientId, kind, rfqId, read } = notification;
  const result = await pool.query(
    `INSERT INTO notifications (id, recipient_type, recipient_id, kind, rfq_id, is_read, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       is_read = EXCLUDED.is_read,
       raw = EXCLUDED.raw
     RETURNING raw`,
    [id, recipientType, recipientId, kind, rfqId || null, !!read, JSON.stringify(notification)],
    { d1: true }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

// One multi-row INSERT for the whole fan-out of a single RFQ to every matched
// vendor, rather than a write per vendor.
async function bulkInsertNotificationsInDB(notifications) {
  if (!pool.hasStorage() || notifications.length === 0) return [];
  const values = [];
  const placeholders = notifications.map((n, i) => {
    const base = i * 7;
    values.push(
      n.id,
      n.recipientType,
      n.recipientId,
      n.kind,
      n.rfqId || null,
      !!n.read,
      JSON.stringify(n)
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });
  const result = await pool.query(
    `INSERT INTO notifications (id, recipient_type, recipient_id, kind, rfq_id, is_read, raw)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    values,
    { d1: true }
  );
  return result.rows.map((row) => row.id);
}

async function markNotificationReadInDB(id) {
  if (!pool.hasStorage()) return false;
  // jsonb_set has no shared Postgres/SQLite spelling (SQLite's equivalent is
  // json_set, and 'true'::jsonb is Postgres-only cast syntax), so this needs
  // a real second SQL string for the D1 path rather than a placeholder swap.
  const result = await pool.query(
    `UPDATE notifications
       SET is_read = true, raw = jsonb_set(raw, '{read}', 'true'::jsonb)
     WHERE id = $1`,
    [id],
    {
      d1: true,
      d1Text: `UPDATE notifications
       SET is_read = 1, raw = json_set(raw, '$.read', json('true'))
     WHERE id = $1`,
    }
  );
  return result.rowCount > 0;
}

async function markAllNotificationsReadInDB(recipientType, recipientId) {
  if (!pool.hasStorage()) return 0;
  const result = await pool.query(
    `UPDATE notifications
       SET is_read = true, raw = jsonb_set(raw, '{read}', 'true'::jsonb)
     WHERE recipient_type = $1 AND recipient_id = $2 AND is_read = false`,
    [recipientType, recipientId],
    {
      d1: true,
      d1Text: `UPDATE notifications
       SET is_read = 1, raw = json_set(raw, '$.read', json('true'))
     WHERE recipient_type = $1 AND recipient_id = $2 AND is_read = false`,
    }
  );
  return result.rowCount;
}

// ── Zoho OAuth token (single-row cache) ────────────────────────────────────────

async function getZohoOAuthTokenFromDB() {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    "SELECT access_token, expiry_time FROM zoho_oauth_token WHERE id = 'default'",
    [],
    { d1: true }
  );
  return result.rows[0] || null;
}

async function upsertZohoOAuthTokenInDB({ accessToken, expiryTime }) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `INSERT INTO zoho_oauth_token (id, access_token, expiry_time, last_updated)
     VALUES ('default', $1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       expiry_time = EXCLUDED.expiry_time,
       last_updated = CURRENT_TIMESTAMP
     RETURNING access_token, expiry_time`,
    [accessToken || null, expiryTime || null],
    { d1: true }
  );
  return result.rows[0] || null;
}

// ── Zoho payment links ──────────────────────────────────────────────────────────

/**
 * Postgres's jsonb columns are parsed into objects by the pg driver already;
 * D1 has no JSON column type, so `raw` is stored/read there as plain TEXT and
 * comes back as a string. Parsing only when it's a string keeps this one
 * function correct against either backend without the callers needing to
 * know which one actually served the row.
 */
function parseRaw(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function getPaymentLinksFromDB() {
  if (!pool.hasStorage()) return [];
  const result = await pool.query(
    'SELECT raw FROM payment_links ORDER BY created_at DESC',
    [],
    { d1: true }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function getPaymentLinkByZohoIdFromDB(zohoPaymentLinkId) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    'SELECT raw FROM payment_links WHERE zoho_payment_link_id = $1',
    [zohoPaymentLinkId],
    { d1: true }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function upsertPaymentLinkInDB(link) {
  if (!pool.hasStorage()) return null;
  const { id, zohoPaymentLinkId, vendorId, buyerAccountId, payerType, status } = link;
  const result = await pool.query(
    `INSERT INTO payment_links (id, zoho_payment_link_id, vendor_id, buyer_account_id, payer_type, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       zoho_payment_link_id = EXCLUDED.zoho_payment_link_id,
       vendor_id = EXCLUDED.vendor_id,
       buyer_account_id = EXCLUDED.buyer_account_id,
       payer_type = EXCLUDED.payer_type,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    [id, zohoPaymentLinkId || null, vendorId || null, buyerAccountId || null, payerType || 'vendor', status || null, JSON.stringify(link)],
    { d1: true }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

module.exports = {
  getVendorsFromDB,
  getVendorsPageFromDB,
  getVendorByEmailFromDB,
  getVendorsByBuyerFromDB,
  getVendorByIdFromDB,
  createBulkImportSessionInDB,
  getBulkImportSessionFromDB,
  incrementBulkImportSessionInDB,
  upsertVendorInDB,
  deleteVendorInDB,
  bulkInsertVendorsInDB,
  getRFQsFromDB,
  upsertRFQInDB,
  deleteRFQInDB,
  getEvaluationsFromDB,
  upsertEvaluationInDB,
  getVendorCatalogueFromDB,
  upsertCatalogueProductInDB,
  deleteCatalogueProductInDB,
  getBuyerAccountsFromDB,
  getBuyerAccountByEmailFromDB,
  upsertBuyerAccountInDB,
  deleteBuyerAccountInDB,
  setActiveBuyerAccountInDB,
  getAIFeedFromDB,
  upsertAIFeedItemInDB,
  getAuditLogsFromDB,
  upsertAuditLogInDB,
  getNotificationsFromDB,
  insertNotificationInDB,
  bulkInsertNotificationsInDB,
  markNotificationReadInDB,
  markAllNotificationsReadInDB,
  getZohoOAuthTokenFromDB,
  upsertZohoOAuthTokenInDB,
  getPaymentLinksFromDB,
  getPaymentLinkByZohoIdFromDB,
  upsertPaymentLinkInDB,
};
