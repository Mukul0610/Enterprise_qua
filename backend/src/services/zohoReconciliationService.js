// ==============================================================================
// ZOHO PAYMENT LINK RECONCILIATION
// ==============================================================================
// Every RECONCILIATION_INTERVAL_MS, re-check every payment link still sitting
// in CREATED/pending against Zoho's own status, in case a webhook delivery was
// lost or delayed. Mirrors the reference app's PaymentReconciliationJob (a
// `0 */10 * * * *` cron), collapsed to a setInterval since this backend has no
// job scheduler — same shape as emailGatewayService.startPolling().
//
// Deliberate improvement over the reference implementation, which has an
// explicit TODO leaving this half-finished: if reconciliation discovers a link
// is now paid, it activates the subscription here too (via the same idempotent
// activateVendorSubscriptionFromPayment the webhook uses), rather than only
// updating the status and leaving the vendor stuck on their old plan.
// ==============================================================================

const storeService = require('../services/storeService');
const zohoPaymentService = require('./zohoPaymentService');
const { ZOHO_CONFIG } = require('../config/constants');
const { logger } = require('./loggerService');

const runtime = { timer: null };

// 'CREATED'/'pending' are this app's own placeholder status
// (createPaymentLinkRecord's `status || 'CREATED'` fallback); 'active' is
// what Zoho's create-payment-link response actually returns as the initial
// status for a real, live, unpaid link (confirmed against a real response —
// `payment_links.status: "active"`). Every link this app has ever created
// came back 'active', so omitting it here meant reconciliation never once
// re-checked a real payment link's status with Zoho.
const RECONCILABLE_STATUSES = ['CREATED', 'pending', 'active'];

/**
 * Re-check a single payment link against Zoho's own status and activate the
 * subscription if it's now paid. Shared by the bulk interval poll below and
 * by an on-demand check (GET .../payment-links re-verifies any of the
 * caller's own still-pending links this same way before responding) — the
 * sandbox webhook subscription has proven unreliable in practice (delivery
 * never observed even when the console reports it enabled and subscribed to
 * every event), so a user actively checking their own payment status should
 * never have to wait on it or the 10-minute interval.
 */
async function reconcileLink(link) {
  if (!link || !link.zohoPaymentLinkId) {
    logger.warn(`Payment link ${link?.id} has no zohoPaymentLinkId; marking as expired`, { linkId: link?.id }, 'ZOHO_RECONCILIATION');
    storeService.updatePaymentLinkRecord(link?.id, {
      status: 'expired',
      rawResponse: { error: 'Missing zohoPaymentLinkId', reconciledAt: new Date().toISOString() },
    });
    return { status: 'expired', nonExistent: true };
  }

  let result;
  try {
    result = await zohoPaymentService.getPaymentLinkStatus(link.zohoPaymentLinkId);
  } catch (err) {
    const msg = String(err?.message || '');
    const isNotFound =
      err?.status === 404 ||
      err?.statusCode === 404 ||
      (err?.status === 400 && /does not exist/i.test(msg)) ||
      /payment link does not exist/i.test(msg);

    if (isNotFound) {
      logger.warn(
        `Zoho payment link ${link.id} (${link.zohoPaymentLinkId}) does not exist in Zoho; marking as expired`,
        { linkId: link.id, zohoPaymentLinkId: link.zohoPaymentLinkId, message: msg },
        'ZOHO_RECONCILIATION'
      );
      storeService.updatePaymentLinkRecord(link.id, {
        status: 'expired',
        rawResponse: { error: msg, reconciledAt: new Date().toISOString() },
      });
      return { status: 'expired', nonExistent: true };
    }
    throw err;
  }

  storeService.updatePaymentLinkRecord(link.id, { status: result.status, rawResponse: result.rawResponse });
  // Zoho's own status strings are lowercase ('active', 'paid', 'expired',
  // 'cancelled') — compared case-insensitively since the webhook path
  // separately writes its own app-invented 'PAID' (uppercase) for the
  // same lifecycle point, and this check needs to recognize either.
  if (String(result.status || '').toLowerCase() === 'paid') {
    if (link.payerType === 'buyer') {
      storeService.activateBuyerSubscriptionFromPayment(link.id);
    } else {
      storeService.activateVendorSubscriptionFromPayment(link.id);
    }
  }
  return result;
}

async function reconcileOnce() {
  const pending = await storeService.getPaymentLinksByStatusIn(RECONCILABLE_STATUSES);
  for (const link of pending) {
    try {
      await reconcileLink(link);
    } catch (err) {
      logger.error(`Zoho reconciliation failed for payment link ${link.id}`, err, 'ZOHO_RECONCILIATION');
    }
  }
  return { checked: pending.length };
}

/**
 * Re-check every one of `links` that's still in a non-terminal status,
 * in place, swallowing per-link failures (a Zoho blip re-checking one link
 * shouldn't fail the whole list for the caller). Returns the same array
 * reference with any reconciled links' entries already updated in
 * `storeService`, so callers just re-read from storeService afterward.
 */
async function reconcilePendingLinks(links) {
  const pending = links.filter((l) => RECONCILABLE_STATUSES.includes(l.status));
  await Promise.all(
    pending.map((link) =>
      reconcileLink(link).catch((err) => logger.error(`On-demand Zoho reconciliation failed for payment link ${link.id}`, err, 'ZOHO_RECONCILIATION'))
    )
  );
  return pending.length;
}

/** Begin polling on an interval. Refuses to start twice or when disabled/unconfigured. */
function startPolling(config = ZOHO_CONFIG) {
  if (runtime.timer) return { started: false, reason: 'Already started.' };
  if (!config.RECONCILIATION_ENABLED) return { started: false, reason: 'ZOHO_RECONCILIATION_ENABLED is not true.' };
  if (!config.REFRESH_TOKEN) return { started: false, reason: 'ZOHO_REFRESH_TOKEN is not configured.' };

  runtime.timer = setInterval(() => {
    reconcileOnce().catch((err) => logger.error('Zoho reconciliation interval poll threw', err, 'ZOHO_RECONCILIATION'));
  }, config.RECONCILIATION_INTERVAL_MS);
  if (typeof runtime.timer.unref === 'function') runtime.timer.unref();

  logger.info(
    `Zoho payment-link reconciliation polling every ${Math.round(config.RECONCILIATION_INTERVAL_MS / 1000)}s`,
    {},
    'ZOHO_RECONCILIATION'
  );
  return { started: true, intervalMs: config.RECONCILIATION_INTERVAL_MS };
}

/** Stop the interval. Safe to call when it was never started. */
function stopPolling() {
  if (!runtime.timer) return false;
  clearInterval(runtime.timer);
  runtime.timer = null;
  return true;
}

module.exports = { reconcileOnce, reconcilePendingLinks, startPolling, stopPolling };
