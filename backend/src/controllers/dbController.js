// ==============================================================================
// DATABASE STATUS CONTROLLER
// ==============================================================================
// Reports on the PostgreSQL connection, which is the only database this backend
// has. It backs authentication (`user`, `role`, `organization`), the procurement
// category taxonomy, and every domain record.
//
// This used to report two datastores side by side — a shared MySQL identity
// schema plus Postgres for vendors and RFQs — and a `domainStore.mode` field that
// said whether the app was serving persisted rows or in-memory seed data. Neither
// distinction exists any more: there is one connection, and no seed to fall back
// to.
// ==============================================================================

const pool = require('../db/pool');
// Referenced through the module object rather than destructured so the helper
// stays observable to tests.
const optimizationMetrics = require('../db/optimizationMetrics');
const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

/**
 * GET /api/db/status - database reachability plus loaded record counts.
 */
async function getDBStatus(req, res, next) {
  try {
    logger.info('Checking database connection status', {}, 'DB_CONTROLLER');
    const health = await pool.checkDatabaseHealth();
    res.json({
      success: true,
      ...health,
      // What this process currently holds in memory, which is a cache of the
      // rows above rather than an independent source.
      loadedRecords: {
        isLoadedFromDatabase: storeService.isHydratedFromDB,
        buyerAccounts: storeService.getBuyerAccounts().length,
        // storeService.getVendors() re-syncs from the DB on every call (a full
        // unbounded table read — see its own doc comment) — wrong for a
        // status endpoint whose own comment above says it reports what this
        // process holds "in memory", not a live re-fetch. this.vendors is
        // itself now a bounded hydration subset (see MAX_HYDRATION_VENDORS in
        // storeService.js), so the real table-wide count is vendorsTotal when
        // available, falling back to the in-memory length pre-hydration.
        vendors: storeService.vendorsTotal ?? storeService.vendors.length,
        rfqs: storeService.getRFQs().length,
      },
    });
  } catch (err) {
    logger.error('Error checking database status', err, 'DB_CONTROLLER');
    next(err);
  }
}

/**
 * GET /api/db/metrics - query cache and audit efficiency report.
 */
async function getDBMetrics(req, res, next) {
  try {
    res.json({ success: true, ...optimizationMetrics.getOptimizationMetrics() });
  } catch (err) {
    logger.error('Error building optimization metrics', err, 'DB_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getDBStatus,
  getDBMetrics,
};
