// Cloudflare Workers entry point for the existing Express app.
//
// Reuses src/app.js as-is (the Express app, without .listen()) via
// httpServerHandler, which bridges Workers' fetch(request) model to a real
// Node http.Server under nodejs_compat. See src/server.js for the
// Node/Render entry point this parallels — that one stays the source of
// truth for local dev and the current Render deploy; this file is additive.
import { httpServerHandler } from 'cloudflare:node';
import { env, waitUntil } from 'cloudflare:workers';
import app from './app.js';
import emailGatewayService from './services/emailGatewayService.js';
import zohoReconciliationService from './services/zohoReconciliationService.js';
import rfqChaserScheduler from './services/rfqChaserScheduler.js';

// d1Bridge.js (required by the CommonJS backend, deep under app.js) cannot
// reach `env` itself: `require('cloudflare:workers')` at call time throws
// "Dynamic require of 'cloudflare:workers' is not supported" — the bundler
// only resolves cloudflare: specifiers through a static ESM import, and this
// is the only file in the backend that's real ESM. Every D1-ported query
// silently fell back to the pg pool because of this (queryD1 never ran; only
// the try/catch in getD1Binding swallowing the throw). Stashing the binding
// on globalThis here, once, lets d1Bridge.js read it synchronously without
// its own require/import of the virtual module.
globalThis.__CF_ENV__ = env;
if (env && typeof env === 'object') {
  try {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string' && !process.env[k]) {
        process.env[k] = v;
      }
    }
  } catch {}
}

// storeService.js's persistence writes are all fire-and-forget: `promise
// .catch(err => logger.error(...))`, never awaited by the caller, so the
// HTTP response doesn't wait on the DB write. That is fine on Node/Render,
// where the process just keeps running — but on Workers, once the response
// has been sent, an unawaited promise not passed to ctx.waitUntil() can be
// cancelled before it finishes, dropping the write entirely (confirmed live:
// a created RFQ never made it into D1). `waitUntil` imported here from
// cloudflare:workers works the same as ctx.waitUntil() but from anywhere,
// without threading `ctx` through Express — stashed on globalThis for the
// same require/import reason __CF_ENV__ is.
globalThis.__CF_WAIT_UNTIL__ = waitUntil;

const PORT = 4000;
app.listen(PORT);

const httpHandler = httpServerHandler({ port: PORT });

// server.js's bootstrapServer() (Node/Render only) starts both of these via
// setInterval — emailGatewayService.startPolling() (IMAP -> auto-RFQ
// ingestion) and zohoReconciliationService.startPolling() (payment-link
// reconciliation). worker.mjs never calls bootstrapServer(), and a
// setInterval wouldn't survive a Worker's request-scoped lifetime even if it
// did — Workers has no persistent background process to hold it. Cloudflare
// Cron Triggers (the `crons` array in wrangler.jsonc, wired to this
// `scheduled` export) are the platform's actual mechanism for periodic
// background work: each trigger fire is its own short-lived invocation that
// calls the same single-shot polling functions (pollBothInboxesOnce /
// reconcileOnce) and dispatches due D1-backed chaser jobs.
async function scheduled(controller, workerEnv, ctx) {
  if (workerEnv && typeof workerEnv === 'object') {
    globalThis.__CF_ENV__ = workerEnv;
    try {
      for (const [k, v] of Object.entries(workerEnv)) {
        if (typeof v === 'string') {
          process.env[k] = v;
        }
      }
    } catch {}
  }
  // The cron entry point never serves a web request, so nothing else loads the
  // vendor list into this isolate. Without it, an email RFQ finds no vendors to
  // invite. Same guard and call as the lazy hydration in app.js.
  const { default: storeService } = await import('./services/storeService.js');
  if (!storeService.isHydratedFromDB) {
    await storeService.hydrateFromDB().catch((err) => console.error('[CRON] hydration failed', err));
  }
  const cron = controller.cron;
  if (cron === EMAIL_GATEWAY_CRON) {
    const results = await Promise.allSettled([
      emailGatewayService.pollBothInboxesOnce(),
      rfqChaserScheduler.dispatchDueChaserJobs(),
    ]);
    const rejected = results.find((r) => r.status === 'rejected');
    if (rejected) throw rejected.reason;
    return;
  }
  if (cron === ZOHO_RECONCILIATION_CRON) {
    await zohoReconciliationService.reconcileOnce();
    return;
  }
  // Unrecognised cron pattern: run all rather than silently doing nothing,
  // so a wrangler.jsonc edit that adds/renames a trigger doesn't go quiet.
  const results = await Promise.allSettled([
    emailGatewayService.pollBothInboxesOnce(),
    zohoReconciliationService.reconcileOnce(),
    rfqChaserScheduler.dispatchDueChaserJobs(),
  ]);
  const rejected = results.find((r) => r.status === 'rejected');
  if (rejected) throw rejected.reason;
}

// Must match the `crons` entries in wrangler.jsonc exactly — Cloudflare
// passes the matched cron expression string back on `controller.cron`.
const EMAIL_GATEWAY_CRON = '* * * * *';
const ZOHO_RECONCILIATION_CRON = '*/10 * * * *';

const originalFetch = httpHandler.fetch;
httpHandler.fetch = function (request, workerEnv, ctx) {
  if (workerEnv && typeof workerEnv === 'object') {
    globalThis.__CF_ENV__ = workerEnv;
    try {
      for (const [k, v] of Object.entries(workerEnv)) {
        if (typeof v === 'string') {
          process.env[k] = v;
        }
      }
    } catch {}
  }
  return originalFetch.call(this, request, workerEnv, ctx);
};

httpHandler.scheduled = scheduled;

export default httpHandler;
