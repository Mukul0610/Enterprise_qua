const app = require('./app');
const pool = require('./db/pool');
const storeService = require('./services/storeService');
const emailGatewayService = require('./services/emailGatewayService');
const zohoReconciliationService = require('./services/zohoReconciliationService');
const { logger } = require('./services/loggerService');
const PORT = process.env.PORT || 4000; // Reloaded with SMTP_FROM=manav.procucev@gmail.com

/**
 * Report database reachability at boot.
 *
 * There is one connection and everything depends on it — authentication, the
 * buyer profile, the category taxonomy and every domain record — so a failure is
 * logged loudly here instead of surfacing later as an unexplained login
 * rejection or an empty dashboard.
 */
async function reportDatabaseHealth() {
  try {
    const health = await pool.checkDatabaseHealth();
    if (health.isConnected) {
      logger.info(
        `Database connected: ${health.providerLabel} (${health.database}) — ${health.userCount} active accounts, ${health.vendorCount} vendors, ${health.rfqCount} RFQs, ${health.latencyMs}ms`,
        {},
        'SERVER'
      );
    } else {
      logger.error(
        `Database UNAVAILABLE (${health.providerLabel}): ${health.errorMessage}. Logins and all data-backed requests will be rejected until this is resolved.`,
        null,
        'SERVER'
      );
    }
    return health;
  } catch (err) {
    logger.error('Database health check threw', err, 'SERVER');
    return null;
  }
}

/**
 * Record a crash before the process dies.
 *
 * Node exits on an unhandled rejection, which closes every in-flight socket. The
 * client sees only "socket hang up" and nothing reaches app.log, so the cause is
 * unrecoverable after the fact — which is precisely how a failing extraction
 * became impossible to diagnose. Default exit behaviour is preserved; this just
 * makes the reason survive.
 *
 * `proc` is injectable so a test can assert the logging without exiting the
 * Jest worker.
 */
function installCrashHandlers(proc = process) {
  proc.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled promise rejection', err, 'SERVER');
  });

  proc.on('uncaughtException', (err) => {
    const isTransient =
      err &&
      (err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'EPIPE' ||
        err.code === 'ECONNABORTED' ||
        err.message?.includes('Connection terminated unexpectedly') ||
        err.message?.includes('read ECONNRESET') ||
        err.message?.includes('remaining connection slots are reserved'));
    if (isTransient) {
      logger.error('Ignored transient network socket reset', err, 'SERVER');
      return;
    }
    logger.error('Uncaught exception — the process is exiting', err, 'SERVER');
    proc.exit(1);
  });

  return proc;
}

async function bootstrapServer(port = PORT) {
  await reportDatabaseHealth();
  await storeService.hydrateFromDB();


  const server = app.listen(port);
  // Started after the store is hydrated: ingesting a requisition needs the buyer
  // accounts loaded to attribute it to one. No-ops unless a mailbox is configured
  // and EMAIL_GATEWAY_ENABLED is true.
  const gateway = emailGatewayService.startPolling();
  if (!gateway.started) {
    logger.info(`Email ingestion gateway not started: ${gateway.reason}`, {}, 'SERVER');
  }
  const zohoReconciliation = zohoReconciliationService.startPolling();
  if (!zohoReconciliation.started) {
    logger.info(`Zoho payment-link reconciliation not started: ${zohoReconciliation.reason}`, {}, 'SERVER');
  }
  return server;
}

async function start(port = PORT) {
  try {
    return await bootstrapServer(port);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && (process.env.AUTO_START_SERVER === 'true' || require.main === module)) {
  // Installed only on a real boot. Registering these on the Jest process would
  // both leak listeners across suites and swallow failures the runner should see.
  installCrashHandlers();
  start();
}

module.exports = { app, bootstrapServer, start, reportDatabaseHealth, installCrashHandlers };

