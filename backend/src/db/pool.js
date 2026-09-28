// ==============================================================================
// DATABASE POOL (Neon PostgreSQL) — the only database connection
// ==============================================================================
// One pool, one database. This backend used to open a second pool against a
// shared MySQL identity schema and keep authentication there while Postgres held
// the domain records; that pool is gone, along with the `mysql2` driver and every
// MYSQL_* setting. Identity, taxonomy and domain tables all live here now (see
// schema.sql), so a request never has to reconcile two datastores.
//
// Every value is read from the environment — no credentials are hardcoded here.
// ==============================================================================

const { Pool } = require('pg');
const { getD1Binding, queryD1 } = require('./d1Bridge');

const DEFAULT_POOL_MAX = 10;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
// Neon bills for compute time while a connection is open, so idle clients are
// released aggressively rather than held for the process lifetime.
const DEFAULT_IDLE_TIMEOUT_MS = 10000;

/**
 * Resolve database settings from the environment.
 *
 * Returns `null` when DATABASE_URL is absent. Callers treat that as
 * "the database is not configured" and fail closed with a descriptive error —
 * it is no longer a signal to serve seed data from memory.
 */
function resolveConfig(env = process.env) {
  const connectionString = env.DATABASE_URL || '';
  if (!connectionString) return null;

  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  // Neon's certificate chain is publicly trusted, so full verification is used
  // there. Other managed providers (e.g. Aiven) issue from their own CA by
  // default, which Node has no trust anchor for — verification would fail
  // even though the connection is genuinely encrypted, so it's relaxed to
  // encrypt-without-verify for anything not on a known-public-CA host.
  const hasPublicCA = connectionString.includes('neon.tech');

  // pg-connection-string parses a `sslmode` query param out of the URL into
  // its own ssl object and that takes precedence over the `ssl` field passed
  // alongside `connectionString` below — so a URL carrying `sslmode=require`
  // (Aiven's default) silently re-enables full verification regardless of
  // hasPublicCA. Stripped here so this file's ssl setting is the only one in
  // effect; the encryption itself is unaffected, only which layer configures it.
  let sanitizedConnectionString = connectionString;
  if (!isLocal) {
    try {
      const url = new URL(connectionString);
      url.searchParams.delete('sslmode');
      url.searchParams.delete('channel_binding');
      sanitizedConnectionString = url.toString();
    } catch {
      // Malformed URL: fall through unmodified and let `pg` surface its own error.
    }
  }

  return {
    connectionString: sanitizedConnectionString,
    max: env.DATABASE_POOL_MAX ? parseInt(env.DATABASE_POOL_MAX, 10) : DEFAULT_POOL_MAX,
    connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS
      ? parseInt(env.DATABASE_CONNECT_TIMEOUT_MS, 10)
      : DEFAULT_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS
      ? parseInt(env.DATABASE_IDLE_TIMEOUT_MS, 10)
      : DEFAULT_IDLE_TIMEOUT_MS,
    // A local Postgres is assumed to be plaintext on the loopback interface.
    ssl: isLocal ? false : { rejectUnauthorized: hasPublicCA },
  };
}

/**
 * Create a PostgreSQL connection pool, or `null` when nothing is configured.
 */
function createPool(env = process.env) {
  const config = resolveConfig(env);
  if (!config) return null;
  const pool = new Pool(config);
  pool.on('error', (err) => {
    // Idle client dropped connection or transient network reset - log and prevent process termination
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[DATABASE_POOL] Transient idle client error (recovering):', err.message);
    }
  });
  return pool;
}

function detectProvider(connectionString) {
  const lower = connectionString.toLowerCase();
  if (lower.includes('neon.tech')) {
    return { provider: 'neon', providerLabel: 'Neon PostgreSQL' };
  }
  return { provider: 'postgres', providerLabel: 'PostgreSQL' };
}

/** Extract the database name from a connection string for display only. */
function detectDatabaseName(connectionString) {
  const match = /\/([^/?]+)(\?|$)/.exec(connectionString || '');
  return match ? match[1] : '';
}

// Mutable holder so tests can swap the pool without re-requiring the module.
const poolModule = {
  pool: createPool(),
  isConfigured: !!resolveConfig(),
};

/** The message every caller uses when the database is absent. */
const NOT_CONFIGURED_MESSAGE = 'The database is not configured. Set DATABASE_URL so records can be read and written.';

/**
 * Whether *some* backing store is reachable — pg pool or D1 binding.
 *
 * domainQueries.js/vendorIngestionQueries.js/identityQueries.js guard every
 * ported function with `if (!pool.hasStorage()) return <empty>;` before
 * calling query()/rows(). On Cloudflare there is no DATABASE_URL and
 * `poolModule.pool` is always null, so a guard that only checked `pool.pool`
 * would short-circuit every D1-ported call before it ever reached the D1
 * branch inside query(). This checks both so the guard only fires when
 * neither store is configured.
 */
function hasStorage() {
  return !!poolModule.pool || !!getD1Binding();
}

/**
 * Run a parameterised query and return the full pg result.
 *
 * Pass `{ d1: true }` for a query against a table that has already been
 * ported to Cloudflare D1 (see d1Bridge.js) — an explicit per-call-site
 * opt-in, not automatic table sniffing, so only queries that have actually
 * been verified against the migrated D1 schema take that path. On Node/Render
 * (no Workers runtime, no D1 binding) this option is a no-op and the call
 * falls straight through to the normal pg pool, unchanged.
 *
 * Most ported queries share one SQL string across both backends (placeholder
 * syntax is the only difference, and d1Bridge.toD1Sql handles that). A few
 * genuinely can't — e.g. Postgres's jsonb_set() has no Postgres/SQLite-shared
 * spelling, SQLite's equivalent is json_set(). For those, pass `d1Text` with
 * the SQLite version; it's used only on the D1 path, `text` is untouched for
 * pg.
 *
 * Pass `d1Params` too when the two versions don't just differ in SQL text but
 * need a different-shaped params array — e.g. Postgres's `= any($n)` binds
 * one array parameter, but SQLite has no array parameter type at all, so the
 * D1 side expands to `in (?, ?, ...)` and needs each value as its own bound
 * param instead of one array.
 */
async function query(text, params = [], options = {}) {
  if (options.d1) {
    const db = getD1Binding();
    if (db) return queryD1(db, options.d1Text || text, options.d1Params || params);
  }
  if (!poolModule.pool) {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
  return poolModule.pool.query(text, params);
}

/**
 * Run a parameterised query and return just the rows.
 *
 * Most call sites only ever want `result.rows`, and unwrapping here keeps them
 * from repeating the same destructuring — and from silently reading `.rows` off
 * an undefined result if a mock forgets to supply it.
 */
async function rows(text, params = [], options = {}) {
  const result = await query(text, params, options);
  return result.rows || [];
}

/**
 * Run `fn` inside a single transaction on one dedicated client.
 *
 * The client is always released and the transaction is always resolved, so a
 * failure part-way cannot leave a connection checked out of the pool holding an
 * open transaction — which on a serverless provider means paying for an idle
 * compute instance until the statement timeout fires.
 */
async function withTransaction(fn) {
  if (!poolModule.pool) {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
  const client = await poolModule.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // A rollback can itself fail if the connection has already dropped. The
    // original error is what the caller needs to see, so this one is swallowed.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Report database reachability for the admin infrastructure screen.
 *
 * Counts accounts as well as domain rows: authentication reads the same
 * connection now, so a single reachability answer covers login and the
 * dashboards together rather than reporting two independent datastores.
 */
async function checkDatabaseHealth() {
  const config = resolveConfig();
  const timestamp = new Date().toISOString();

  if (!poolModule.pool || !config) {
    return {
      isConfigured: false,
      isConnected: false,
      provider: 'not_configured',
      providerLabel: 'Database not configured',
      poolStatus: 'NOT_CONFIGURED',
      database: '',
      latencyMs: 0,
      userCount: 0,
      vendorCount: 0,
      rfqCount: 0,
      errorMessage: 'DATABASE_URL is not set.',
      timestamp,
    };
  }

  const { provider, providerLabel } = detectProvider(config.connectionString);
  const database = detectDatabaseName(config.connectionString);
  const startedAt = Date.now();
  try {
    // One round trip rather than three: the health check runs on every admin
    // page load and on boot, and three separate counts meant three billable
    // queries for one answer.
    //
    // Bounded with a hard timeout — confirmed live via `wrangler tail` that
    // this occasionally hangs indefinitely (Neon compute cold-starting, or a
    // stalled TCP socket the `pg` driver's own connectionTimeoutMillis
    // doesn't cover, since that only bounds acquiring a connection, not a
    // query already in flight on one). Cloudflare's runtime then hard-kills
    // the whole request with an opaque "Worker hung" error instead of this
    // catch block's normal isConnected:false response. A timeout here turns
    // that into the same clean error response every other failure gets.
    let timeoutHandle;
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Database health check timed out after 8000ms')), 8000);
    });
    let result;
    try {
      result = await Promise.race([
        query(
          `select (select count(*) from "user" where is_active = true) as user_count,
              (select count(*) from vendors) as vendor_count,
              (select count(*) from rfqs) as rfq_count`
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(timeoutHandle);
    }
    const row = (result.rows && result.rows[0]) || {};
    return {
      isConfigured: true,
      isConnected: true,
      provider,
      providerLabel,
      poolStatus: `ACTIVE (max ${config.max} connections)`,
      database,
      latencyMs: Date.now() - startedAt,
      userCount: Number(row.user_count || 0),
      vendorCount: Number(row.vendor_count || 0),
      rfqCount: Number(row.rfq_count || 0),
      timestamp,
    };
  } catch (err) {
    return {
      isConfigured: true,
      isConnected: false,
      provider,
      providerLabel,
      poolStatus: 'UNREACHABLE',
      database,
      latencyMs: Date.now() - startedAt,
      userCount: 0,
      vendorCount: 0,
      rfqCount: 0,
      errorMessage: err.message || 'Database connection failed.',
      timestamp,
    };
  }
}

/**
 * Close the pool (used by tests and graceful shutdown).
 */
async function closePool() {
  if (!poolModule.pool) return;
  await poolModule.pool.end();
  poolModule.pool = null;
}

poolModule.NOT_CONFIGURED_MESSAGE = NOT_CONFIGURED_MESSAGE;
poolModule.hasStorage = hasStorage;
poolModule.resolveConfig = resolveConfig;
poolModule.createPool = createPool;
poolModule.detectProvider = detectProvider;
poolModule.detectDatabaseName = detectDatabaseName;
poolModule.query = query;
poolModule.rows = rows;
poolModule.withTransaction = withTransaction;
poolModule.checkDatabaseHealth = checkDatabaseHealth;
poolModule.checkDomainDBHealth = checkDatabaseHealth;
poolModule.closePool = closePool;

module.exports = poolModule;
