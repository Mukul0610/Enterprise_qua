// ==============================================================================
// ZOHO PAYMENTS
// ==============================================================================
// Ported from the reference p2pservices Java app's ZohoOAuthService (token
// caching/refresh), ZohoApiClient (the generic Zoho HTTP client) and
// PaymentLinkService (payment-link creation) collapsed into one module — this
// backend has no equivalent of Spring's separate service/config split, and the
// three responsibilities are small enough to stay together and still be
// independently testable via the exported functions below.
// ==============================================================================

const crypto = require('crypto');
const { ZOHO_CONFIG } = require('../config/constants');
const domainQueries = require('../db/domainQueries');
const { logger } = require('./loggerService');

/**
 * `fetch`, retried on a raw network-level failure.
 *
 * Node's global fetch (undici) keeps a persistent keep-alive connection pool
 * per origin for the life of the process. Observed live against the real
 * accounts.zoho.in/payments.zoho.in hosts: once that pool's connection to a
 * given origin goes bad (the remote end silently closes it, a NAT/proxy
 * resets it, etc.), every subsequent call in this long-running server process
 * fails with an opaque `TypeError: fetch failed` — while a fresh, short-lived
 * process (its own clean connection pool) succeeds immediately against the
 * identical request. A retry recovers from this because undici discards the
 * dead connection and opens a new one on the next attempt, without needing to
 * reach into undici's connection-pool internals directly.
 *
 * Up to 2 retries (3 attempts total), not 1: observed live that a single
 * immediate retry can still land on the same degraded network state and fail
 * too — a real buyer's payment-link request failed on both the first attempt
 * and its one retry, each ~10-20s later, while a fresh short-lived process
 * making the identical call succeeded immediately every time. A short delay
 * before each retry gives a genuinely transient blip more room to clear,
 * rather than firing both attempts back-to-back into the same bad state.
 */
async function fetchWithRetry(url, init, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 400;
  try {
    return await fetch(url, init);
  } catch (err) {
    if (!(err instanceof TypeError) || !/fetch failed/i.test(err.message || '') || attempt >= MAX_ATTEMPTS) {
      throw err;
    }
    logger.warn(`Zoho fetch failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying with a fresh connection`, { url }, 'ZOHO_PAYMENT_SERVICE');
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return fetchWithRetry(url, init, attempt + 1);
  }
}

/**
 * Fetch (and cache in Postgres) a valid Zoho OAuth access token.
 *
 * Mirrors ZohoOAuthService.getValidAccessToken: reuse the cached token while it
 * has more than TOKEN_REFRESH_BUFFER_MS left, otherwise exchange the one
 * long-lived refresh token (ZOHO_CONFIG.REFRESH_TOKEN, never rotated here) for a
 * fresh access token and persist it. The cache is a single row (id='default')
 * so every request in the process shares one token instead of each caller
 * refreshing independently.
 */
async function getValidAccessToken() {
  if (!ZOHO_CONFIG.REFRESH_TOKEN) {
    throw new Error('Zoho refresh token not configured (ZOHO_REFRESH_TOKEN).');
  }

  const cached = await domainQueries.getZohoOAuthTokenFromDB();
  if (cached && cached.access_token && cached.expiry_time) {
    const expiresAt = new Date(cached.expiry_time).getTime();
    if (expiresAt - Date.now() > ZOHO_CONFIG.TOKEN_REFRESH_BUFFER_MS) {
      return cached.access_token;
    }
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: ZOHO_CONFIG.CLIENT_ID,
    client_secret: ZOHO_CONFIG.CLIENT_SECRET,
    refresh_token: ZOHO_CONFIG.REFRESH_TOKEN,
  });

  const res = await fetchWithRetry(ZOHO_CONFIG.OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Zoho OAuth token refresh failed (${res.status}): ${data.error || 'unknown error'}`);
  }

  const expiryTime = new Date(Date.now() + Number(data.expires_in || 0) * 1000).toISOString();
  await domainQueries.upsertZohoOAuthTokenInDB({ accessToken: data.access_token, expiryTime });
  return data.access_token;
}

/** Zoho's own auth scheme — `Zoho-oauthtoken`, not `Bearer`. */
async function zohoAuthHeader() {
  const token = await getValidAccessToken();
  return { Authorization: `Zoho-oauthtoken ${token}` };
}

/**
 * Create a Zoho payment link for a vendor's subscription upgrade.
 *
 * `amountInr` is expected pre-computed (GST-inclusive) by the caller —
 * config.computeZohoPlanAmount — so this module stays a pure Zoho API client
 * with no pricing logic of its own.
 */
async function createPaymentLink({ planId, planLabel, amountInr, email, phone, returnUrl }) {
  const authHeader = await zohoAuthHeader();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const requestBody = {
    amount: amountInr,
    currency: 'INR',
    email,
    phone,
    description: `Subscription plan name : ${planLabel}`,
    reference_id: `PLAN-${planId}-${Date.now()}`,
    notify_user: true,
    return_url: returnUrl,
    expires_at: tomorrow,
  };

  const url = `${ZOHO_CONFIG.PAYMENTS_BASE_URL}/paymentlinks?account_id=${encodeURIComponent(ZOHO_CONFIG.ACCOUNT_ID)}`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify(requestBody),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.payment_links) {
    throw new Error(`Zoho payment-link creation failed (${res.status}): ${data.message || 'unknown error'}`);
  }

  return {
    zohoPaymentLinkId: data.payment_links.payment_link_id,
    paymentUrl: data.payment_links.url,
    status: data.payment_links.status,
    rawResponse: data,
  };
}

/** Poll Zoho for a payment link's current status — used by the reconciliation job. */
async function getPaymentLinkStatus(zohoPaymentLinkId) {
  const authHeader = await zohoAuthHeader();
  const url = `${ZOHO_CONFIG.PAYMENTS_BASE_URL}/paymentlinks/${encodeURIComponent(zohoPaymentLinkId)}?account_id=${encodeURIComponent(ZOHO_CONFIG.ACCOUNT_ID)}`;
  const res = await fetchWithRetry(url, { method: 'GET', headers: { Accept: 'application/json', ...authHeader } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.payment_links) {
    const error = new Error(`Zoho payment-link status fetch failed (${res.status}): ${data.message || 'unknown error'}`);
    error.status = res.status;
    error.statusCode = res.status;
    error.zohoMessage = data.message;
    error.rawResponse = data;
    throw error;
  }
  return {
    status: data.payment_links.status,
    amountPaid: data.payment_links.amount_paid,
    rawResponse: data,
  };
}

/**
 * Verify `X-Zoho-Webhook-Signature: t=<ts>,v=<sig>` against the raw request body.
 *
 * Canonical form: hex(HMAC-SHA256(signing_key_utf8_bytes, "<ts>." + rawBody)),
 * compared case-insensitively via a constant-time comparison. The reference
 * Java implementation tries six key/encoding combinations because the correct
 * one was never conclusively confirmed there; this implements the single
 * documented Zoho convention. If a real webhook delivery fails verification,
 * capture the raw header/body and re-check this against Zoho's docs before
 * assuming the payload is fraudulent.
 */
function verifyWebhookSignature(header, rawBody) {
  if (!header || typeof header !== 'string' || !ZOHO_CONFIG.WEBHOOK_SIGNING_KEY) return false;

  const parts = Object.fromEntries(
    header
      .split(',')
      .map((p) => p.trim().split('='))
      .filter((pair) => pair.length === 2)
      .map(([k, v]) => [k, v])
  );
  const { t: timestamp, v: signature } = parts;
  if (!timestamp || !signature) return false;

  const expected = crypto
    .createHmac('sha256', Buffer.from(ZOHO_CONFIG.WEBHOOK_SIGNING_KEY, 'utf8'))
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected.toLowerCase(), 'utf8');
  const actualBuf = Buffer.from(String(signature).toLowerCase(), 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = {
  getValidAccessToken,
  createPaymentLink,
  getPaymentLinkStatus,
  verifyWebhookSignature,
};
