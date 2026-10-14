// ==============================================================================
// MAIL TRANSPORT PRIMITIVES
// ==============================================================================
// Provider-agnostic building blocks the mailer's routing chain is made of:
//
//   - buildRawMimeMessage: one RFC 5322 message (text + HTML alternative, Cc,
//     Bcc, Reply-To, threading headers) for the Gmail API's `raw` field.
//   - classifyDeliveryError: turns a provider error into RATE_LIMITED /
//     AUTH_REVOKED / TRANSIENT / PERMANENT so the chain knows whether to back off.
//   - provider cooldowns: a provider that was rate-limited or lost its OAuth
//     grant is skipped until it can work again, instead of being retried on every
//     send. Confirmed live: a rate-limited Gmail identity was still being asked
//     first for every message, adding a guaranteed failure to each send.
//   - HTTP providers (Resend, SendGrid, Brevo, MailChannels): plain HTTPS, so they
//     work on Cloudflare Workers where raw SMTP cannot.
// ==============================================================================

const { logger } = require('./loggerService');

const DELIVERY_ERROR_KIND = {
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH_REVOKED: 'AUTH_REVOKED',
  TRANSIENT: 'TRANSIENT',
  PERMANENT: 'PERMANENT',
};

const MAIL_TRANSPORT_CONFIG = {
  // Gmail usually names its own retry time; this is only used when it doesn't.
  DEFAULT_RATE_LIMIT_COOLDOWN_MS: 15 * 60 * 1000,
  // A revoked/expired refresh token never recovers by itself. Re-checked
  // periodically anyway so a rotated secret is picked up without a redeploy.
  AUTH_REVOKED_COOLDOWN_MS: 30 * 60 * 1000,
  MAX_COOLDOWN_MS: 24 * 60 * 60 * 1000,
  HTTP_TIMEOUT_MS: 15000,
  DEFAULT_FROM_NAME: 'Procucev Enterprise',
};

const cooldowns = new Map();

function getEnv(key) {
  if (process.env && process.env[key] !== undefined && process.env[key] !== '') {
    return process.env[key];
  }
  if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__[key] !== undefined && globalThis.__CF_ENV__[key] !== '') {
    return globalThis.__CF_ENV__[key];
  }
  return undefined;
}

/** True when running inside a Cloudflare Worker, where raw SMTP sockets cannot work. */
function isWorkersRuntime() {
  return typeof globalThis !== 'undefined' && Boolean(globalThis.__CF_ENV__);
}

function splitList(value) {
  return String(value || '')
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Normalise a to/cc/bcc value (string, comma list or array) into a list of addresses. */
function toAddressList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => toAddressList(entry));
  return splitList(value);
}

/** Bare address from `"Name" <a@b.com>` or `a@b.com`. */
function bareAddress(value) {
  const text = String(value || '').trim();
  const match = text.match(/<\s*([^<>]+)\s*>/);
  return (match ? match[1] : text).trim();
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Build a base64url-encoded RFC 5322 message for the Gmail API.
 *
 * Carries Cc and Bcc: the previous builder only wrote To, so every CC'd buyer
 * and support copy on quote acknowledgements, failure notices and vendor issue
 * acknowledgements was silently dropped whenever mail went out through Gmail.
 * A plain-text alternative is included because text-less HTML mail scores
 * worse with spam filters.
 *
 * No Message-ID is written: Gmail assigns its own (<...@mail.gmail.com>). A
 * self-made `<random@gmail.com>` id is one Gmail's servers never issued, which
 * spam filters read as a forged header.
 */
function buildRawMimeMessage({ from, to, cc, bcc, subject, html, text, replyTo, inReplyTo, references, headers }) {
  const ccList = toAddressList(cc);
  const bccList = toAddressList(bcc);
  const toList = toAddressList(to);
  const lines = [
    `From: ${from}`,
    `To: ${toList.join(', ')}`,
    ccList.length ? `Cc: ${ccList.join(', ')}` : null,
    bccList.length ? `Bcc: ${bccList.join(', ')}` : null,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject || '', 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    ...Object.entries(headers || {}).map(([name, value]) => `${name}: ${value}`),
    'MIME-Version: 1.0',
  ].filter(Boolean);

  const plain = text || htmlToText(html);
  let body;
  if (html) {
    const boundary = `=_procucev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      plain,
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html,
      `--${boundary}--`,
      '',
    ].join('\r\n');
  } else {
    lines.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit');
    body = plain;
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
}

function errorText(err) {
  if (!err) return '';
  const data = err.response && err.response.data;
  const nested = data && (data.error_description || (data.error && (data.error.message || data.error)));
  return [err.message, typeof nested === 'string' ? nested : '', err.code, data && data.message]
    .filter((part) => typeof part === 'string' && part)
    .join(' ');
}

function errorStatus(err) {
  if (!err) return undefined;
  const status = err.status || err.statusCode || (err.response && err.response.status) || err.code;
  const numeric = Number(status);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/** Parse Gmail's "Retry after 2026-10-13T11:48:37.516Z" (or a Retry-After seconds value). */
function parseRetryAfterMs(err, now = Date.now()) {
  const text = errorText(err);
  const isoMatch = text.match(/retry after\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i);
  if (isoMatch) {
    const at = Date.parse(isoMatch[1]);
    if (Number.isFinite(at) && at > now) return at - now;
  }
  const headers = err && err.response && err.response.headers;
  const headerValue = headers && (typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after']);
  if (headerValue !== undefined && headerValue !== null && headerValue !== '') {
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return null;
}

/**
 * Decide what a failure means for the provider that produced it.
 *
 *   RATE_LIMITED — daily/user sending limit hit; back off until it resets.
 *   AUTH_REVOKED — OAuth grant expired/revoked or API key rejected; back off and
 *                  flag loudly, because only a new secret fixes it.
 *   TRANSIENT    — network/5xx; try the next provider now, this one next time.
 *   PERMANENT    — the provider rejected this message specifically.
 */
function classifyDeliveryError(err) {
  const text = errorText(err).toLowerCase();
  const status = errorStatus(err);
  if (
    status === 429 ||
    /rate.?limit|quota|too many requests|daily (user )?sending|limit exceeded|retry after/.test(text)
  ) {
    return DELIVERY_ERROR_KIND.RATE_LIMITED;
  }
  if (
    /invalid_grant|unauthorized_client|invalid_client|token has been (expired|revoked)|invalid credentials|api key|unauthenticated|authorization required/.test(text) ||
    status === 401 ||
    status === 403
  ) {
    return DELIVERY_ERROR_KIND.AUTH_REVOKED;
  }
  if (
    (status !== undefined && status >= 500) ||
    /timed? ?out|econnreset|enotfound|eai_again|socket hang up|network|fetch failed|unexpected close/.test(text)
  ) {
    return DELIVERY_ERROR_KIND.TRANSIENT;
  }
  return DELIVERY_ERROR_KIND.PERMANENT;
}

function isCoolingDown(providerKey, now = Date.now()) {
  const entry = cooldowns.get(providerKey);
  if (!entry) return false;
  if (entry.until <= now) {
    cooldowns.delete(providerKey);
    return false;
  }
  return true;
}

function getCooldown(providerKey) {
  return isCoolingDown(providerKey) ? cooldowns.get(providerKey) : null;
}

function startCooldown(providerKey, durationMs, reason, now = Date.now()) {
  const capped = Math.min(Math.max(Number(durationMs) || 0, 1000), MAIL_TRANSPORT_CONFIG.MAX_COOLDOWN_MS);
  const entry = { until: now + capped, reason, since: now };
  cooldowns.set(providerKey, entry);
  return entry;
}

/**
 * Record a provider failure and start a cooldown when the failure means the
 * provider cannot succeed for a while. Returns the classification.
 */
function noteProviderFailure(providerKey, err, now = Date.now()) {
  const kind = classifyDeliveryError(err);
  if (kind === DELIVERY_ERROR_KIND.RATE_LIMITED) {
    const waitMs = parseRetryAfterMs(err, now) || MAIL_TRANSPORT_CONFIG.DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    startCooldown(providerKey, waitMs, `rate limited: ${errorText(err).slice(0, 200)}`, now);
  } else if (kind === DELIVERY_ERROR_KIND.AUTH_REVOKED) {
    startCooldown(providerKey, MAIL_TRANSPORT_CONFIG.AUTH_REVOKED_COOLDOWN_MS, `credentials rejected: ${errorText(err).slice(0, 200)}`, now);
    logger.error(
      `Mail provider ${providerKey} rejected its credentials — it will be skipped until the secret is replaced (re-run scripts/get-gmail-refresh-token.js for a Gmail identity)`,
      { providerKey, errorMessage: errorText(err).slice(0, 300) },
      'MAIL_TRANSPORT'
    );
  }
  return kind;
}

function clearCooldown(providerKey) {
  cooldowns.delete(providerKey);
}

function resetCooldowns() {
  cooldowns.clear();
}

function listCooldowns(now = Date.now()) {
  const out = {};
  for (const [key, entry] of cooldowns.entries()) {
    if (entry.until > now) {
      out[key] = { until: new Date(entry.until).toISOString(), reason: entry.reason };
    }
  }
  return out;
}

async function fetchWithTimeout(url, init, timeoutMs = MAIL_TRANSPORT_CONFIG.HTTP_TIMEOUT_MS) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, controller ? { ...init, signal: controller.signal } : init);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function httpError(provider, res, bodyText) {
  const err = new Error(`${provider} responded ${res.status}: ${String(bodyText || '').slice(0, 300)}`);
  err.status = res.status;
  err.code = `${provider.toUpperCase()}_API_ERROR`;
  err.response = { status: res.status, headers: res.headers };
  return err;
}

function parseFrom(from) {
  return { email: bareAddress(from), name: (String(from || '').match(/^"?([^"<]+?)"?\s*</) || [])[1] || MAIL_TRANSPORT_CONFIG.DEFAULT_FROM_NAME };
}

/** Each HTTP provider: { key, isConfigured(), send(message, from) → { messageId } }. */
const HTTP_PROVIDERS = [
  {
    key: 'resend',
    isConfigured: () => Boolean(getEnv('RESEND_API_KEY')),
    fromAddress: () => getEnv('RESEND_FROM_EMAIL'),
    async send(message, from) {
      const res = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getEnv('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: message.to,
          ...(toAddressList(message.cc).length ? { cc: toAddressList(message.cc) } : {}),
          ...(toAddressList(message.bcc).length ? { bcc: toAddressList(message.bcc) } : {}),
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          subject: message.subject,
          ...(message.headers ? { headers: message.headers } : {}),
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = httpError('Resend', res, body.message || JSON.stringify(body));
        err.message = body.message || err.message;
        throw err;
      }
      return { messageId: body.id };
    },
  },
  {
    key: 'sendgrid',
    isConfigured: () => Boolean(getEnv('SENDGRID_API_KEY')),
    fromAddress: () => getEnv('SENDGRID_FROM_EMAIL'),
    async send(message, from) {
      const sender = parseFrom(from);
      const personalization = { to: toAddressList(message.to).map((email) => ({ email: bareAddress(email) })) };
      if (toAddressList(message.cc).length) personalization.cc = toAddressList(message.cc).map((email) => ({ email: bareAddress(email) }));
      if (toAddressList(message.bcc).length) personalization.bcc = toAddressList(message.bcc).map((email) => ({ email: bareAddress(email) }));
      const res = await fetchWithTimeout('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getEnv('SENDGRID_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [personalization],
          from: { email: sender.email, name: sender.name },
          ...(message.replyTo ? { reply_to: { email: bareAddress(message.replyTo) } } : {}),
          subject: message.subject,
          ...(message.headers ? { headers: message.headers } : {}),
          content: [
            { type: 'text/plain', value: message.text || htmlToText(message.html) || ' ' },
            ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
          ],
        }),
      });
      if (!res.ok) throw httpError('SendGrid', res, await res.text().catch(() => ''));
      return { messageId: (res.headers && typeof res.headers.get === 'function' && res.headers.get('x-message-id')) || undefined };
    },
  },
  {
    key: 'brevo',
    isConfigured: () => Boolean(getEnv('BREVO_API_KEY')),
    fromAddress: () => getEnv('BREVO_FROM_EMAIL'),
    async send(message, from) {
      const sender = parseFrom(from);
      const res = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': getEnv('BREVO_API_KEY'), 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: sender.email, name: sender.name },
          to: toAddressList(message.to).map((email) => ({ email: bareAddress(email) })),
          ...(toAddressList(message.cc).length ? { cc: toAddressList(message.cc).map((email) => ({ email: bareAddress(email) })) } : {}),
          ...(toAddressList(message.bcc).length ? { bcc: toAddressList(message.bcc).map((email) => ({ email: bareAddress(email) })) } : {}),
          ...(message.replyTo ? { replyTo: { email: bareAddress(message.replyTo) } } : {}),
          subject: message.subject,
          ...(message.headers ? { headers: message.headers } : {}),
          htmlContent: message.html || undefined,
          textContent: message.text || htmlToText(message.html) || ' ',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError('Brevo', res, body.message || JSON.stringify(body));
      return { messageId: body.messageId };
    },
  },
  {
    // MailChannels stopped accepting unauthenticated sends from Workers in 2024 —
    // every attempt returned 401. It is only used now when an API key is set.
    key: 'mailchannels',
    isConfigured: () => Boolean(getEnv('MAILCHANNELS_API_KEY')),
    fromAddress: () => getEnv('MAILCHANNELS_FROM_EMAIL'),
    async send(message, from) {
      const sender = parseFrom(from);
      const personalization = { to: toAddressList(message.to).map((email) => ({ email: bareAddress(email) })) };
      if (toAddressList(message.cc).length) personalization.cc = toAddressList(message.cc).map((email) => ({ email: bareAddress(email) }));
      if (toAddressList(message.bcc).length) personalization.bcc = toAddressList(message.bcc).map((email) => ({ email: bareAddress(email) }));
      const res = await fetchWithTimeout('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'X-Api-Key': getEnv('MAILCHANNELS_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [personalization],
          from: { email: sender.email, name: sender.name },
          ...(message.replyTo ? { reply_to: { email: bareAddress(message.replyTo) } } : {}),
          subject: message.subject,
          ...(message.headers ? { headers: message.headers } : {}),
          content: [
            { type: 'text/plain', value: message.text || htmlToText(message.html) || ' ' },
            ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
          ],
        }),
      });
      if (!res.ok && res.status !== 202) throw httpError('MailChannels', res, await res.text().catch(() => ''));
      return { messageId: undefined };
    },
  },
];

function configuredHttpProviders() {
  return HTTP_PROVIDERS.filter((provider) => provider.isConfigured());
}

module.exports = {
  DELIVERY_ERROR_KIND,
  MAIL_TRANSPORT_CONFIG,
  HTTP_PROVIDERS,
  getEnv,
  isWorkersRuntime,
  splitList,
  toAddressList,
  bareAddress,
  htmlToText,
  buildRawMimeMessage,
  errorText,
  parseRetryAfterMs,
  classifyDeliveryError,
  isCoolingDown,
  getCooldown,
  startCooldown,
  noteProviderFailure,
  clearCooldown,
  resetCooldowns,
  listCooldowns,
  fetchWithTimeout,
  configuredHttpProviders,
};
