const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const dns = require('dns');
const { logger } = require('./loggerService');
const {
  UNAUTHORIZED_BUYER_NOTIFICATION,
  RFQ_ACKNOWLEDGEMENT_NOTIFICATION,
  VENDOR_CREDITS_EXHAUSTED_NOTIFICATION,
} = require('../config/constants');

// Force Node.js DNS resolver to prefer IPv4 over IPv6.
// Cloud environments like Render lack IPv6 egress routing; without this,
// smtp.gmail.com resolves to IPv6 (e.g. 2607:f8b0:...) causing errno -101 ESOCKET.
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

/**
 * Reads an environment variable or secret, checking both process.env and
 * Cloudflare Worker globalThis.__CF_ENV__.
 */
function getEnv(key) {
  if (process.env && process.env[key] !== undefined && process.env[key] !== '') {
    return process.env[key];
  }
  if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__[key] !== undefined && globalThis.__CF_ENV__[key] !== '') {
    return globalThis.__CF_ENV__[key];
  }
  return undefined;
}

let transporter;
let vendorTransporter;

/**
 * Lazily builds a Gmail / SMTP transporter from SMTP_USER/SMTP_PASSWORD.
 * Returns undefined if either is unset, so callers can no-op gracefully
 * instead of throwing when SMTP isn't configured.
 */
function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.SMTP_USER;
  const rawPass = process.env.SMTP_PASSWORD;
  if (!user || !rawPass) return undefined;

  const pass = rawPass.replace(/\s+/g, '');
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const isGmail =
    (process.env.SMTP_SERVICE && process.env.SMTP_SERVICE.toLowerCase() === 'gmail') ||
    host.toLowerCase().includes('gmail');

  // On cloud platforms (Render, AWS, etc.), port 587 (STARTTLS) is often blocked
  // or experiences handshake timeouts. Default to port 465 (direct SSL) for Gmail.
  let port;
  let secure;

  if (process.env.SMTP_PORT) {
    port = Number(process.env.SMTP_PORT);
    secure = process.env.SMTP_SECURE !== undefined ? process.env.SMTP_SECURE === 'true' : port === 465;
  } else if (process.env.SMTP_SECURE !== undefined) {
    secure = process.env.SMTP_SECURE === 'true';
    port = secure ? 465 : 587;
  } else if (isGmail) {
    port = 465;
    secure = true;
  } else {
    port = 587;
    secure = false;
  }

  const transportConfig = {
    host,
    port,
    secure,
    family: 4, // CRITICAL: Force IPv4 socket to prevent IPv6 errno -101 ESOCKET on Render/AWS/Docker
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 25000,
    greetingTimeout: 25000,
    socketTimeout: 30000,
  };

  transporter = nodemailer.createTransport(transportConfig);
  return transporter;
}

function fromAddress() {
  const user = process.env.SMTP_FROM || process.env.SMTP_USER || 'manav.procucev@gmail.com';
  if (user.includes('<') && user.includes('>')) {
    return user;
  }
  return `"Procucev Enterprise" <${user}>`;
}

/**
 * Resolves the public frontend URL across all deployment environments
 * (Cloudflare Workers, Vercel, Node, Docker). Configurable via
 * PUBLIC_FRONTEND_URL, APP_PUBLIC_URL, FRONTEND_URL, or globalThis.__CF_ENV__.
 */
function getPublicFrontendUrl() {
  const envVal =
    getEnv('PUBLIC_FRONTEND_URL') ||
    getEnv('APP_PUBLIC_URL') ||
    getEnv('FRONTEND_URL');
  if (envVal && typeof envVal === 'string' && envVal.trim()) {
    return envVal.trim().replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

/**
 * Returns the hosted Procucev logo URL.
 * Email clients cannot fetch images from localhost/127.0.0.1, so in local
 * dev or test environments, it falls back to the public Cloudflare Workers asset.
 */
function getLogoUrl() {
  const base = getPublicFrontendUrl();
  if (!base || base.includes('localhost') || base.includes('127.0.0.1')) {
    return 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/procucev-logo.png';
  }
  return `${base}/procucev-logo.png`;
}

/**
 * Lazily builds a Gmail / SMTP transporter for vendor notifications and invites
 * from VENDOR_SMTP_USER/VENDOR_SMTP_PASSWORD (defaults strictly to srinu20252026@gmail.com).
 * Vendor communications NEVER fall back to buyer SMTP (rfqprocucev@gmail.com).
 */
function getVendorTransporter() {
  if (vendorTransporter) return vendorTransporter;

  const user = getEnv('VENDOR_SMTP_USER');
  const rawPass = getEnv('VENDOR_SMTP_PASSWORD');
  if (!user || !rawPass) return undefined;

  const pass = rawPass.replace(/\s+/g, '');
  const host = getEnv('VENDOR_SMTP_HOST') || 'smtp.gmail.com';
  const isGmail =
    (getEnv('VENDOR_SMTP_SERVICE') && getEnv('VENDOR_SMTP_SERVICE').toLowerCase() === 'gmail') ||
    host.toLowerCase().includes('gmail');

  let port;
  let secure;

  if (getEnv('VENDOR_SMTP_PORT')) {
    port = Number(getEnv('VENDOR_SMTP_PORT'));
    secure = getEnv('VENDOR_SMTP_SECURE') !== undefined ? getEnv('VENDOR_SMTP_SECURE') === 'true' : port === 465;
  } else if (getEnv('VENDOR_SMTP_SECURE') !== undefined) {
    secure = getEnv('VENDOR_SMTP_SECURE') === 'true';
    port = secure ? 465 : 587;
  } else if (isGmail) {
    port = 465;
    secure = true;
  } else {
    port = 587;
    secure = false;
  }

  const transportConfig = {
    host,
    port,
    secure,
    family: 4,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 25000,
    greetingTimeout: 25000,
    socketTimeout: 30000,
  };

  vendorTransporter = nodemailer.createTransport(transportConfig);
  return vendorTransporter;
}

function vendorFromAddress() {
  const user = getEnv('VENDOR_GMAIL_SENDER_EMAIL') || getEnv('VENDOR_SMTP_FROM') || getEnv('VENDOR_SMTP_USER') || 'srinu20252026@gmail.com';
  if (user.includes('<') && user.includes('>')) {
    return user;
  }
  return `"Procucev Enterprise" <${user}>`;
}

function vendorGatewayAddress() {
  return (
    getEnv('VENDOR_EMAIL_GATEWAY_ADDRESS') ||
    getEnv('VENDOR_GMAIL_SENDER_EMAIL') ||
    getEnv('VENDOR_EMAIL_GATEWAY_USER') ||
    getEnv('VENDOR_SMTP_USER') ||
    'srinu20252026@gmail.com'
  );
}

/**
 * Send one message through the vendor transporter.
 *
 * Falls back to the Gmail API (the same account buyer-side mail already uses
 * — see deliver()) when no dedicated vendor mailbox (VENDOR_SMTP_USER or
 * VENDOR_EMAIL_GATEWAY_USER) is configured, rather than silently no-op'ing.
 * This is the actual
 * fix for vendor onboarding emails never arriving: no vendor mailbox has
 * ever been set up (VENDOR_SMTP_USER/PASSWORD are unset), so every one of
 * these calls was already dropping the email before the Gmail API even
 * existed here — it just never surfaced because deliverVendor no-ops
 * quietly. The email will show as sent from the buyer Gmail account until a
 * dedicated vendor mailbox is authorized the same way (see
 * scripts/get-gmail-refresh-token.js).
 */
async function deliverVendor(message, label) {
  if (process.env.NODE_ENV === 'test') {
    return { sent: false, reason: 'test environment' };
  }

  // The dedicated vendor mailbox, same as buyer-side deliver()'s own
  // Gmail-API-first behavior — takes priority over VENDOR_SMTP_*, which can
  // never actually send from Cloudflare Workers (see deliverVendor's own
  // SMTP-failure fallback below for why).
  if (isVendorGmailApiConfigured()) {
    return deliverViaVendorGmailApi(message, label);
  }

  const activeTransporter = getVendorTransporter();
  if (!activeTransporter) {
    if (isGmailApiConfigured()) {
      try {
        return await deliverViaGmailApi(message, label);
      } catch (err) {
        logger.warn(
          `Vendor fallback to Gmail API failed for ${label} — attempting standard SMTP fallback`,
          { errorMessage: err?.message, to: message.to },
          'MAILER_SERVICE'
        );
      }
    }
    const defaultTransporter = getTransporter();
    if (defaultTransporter) {
      try {
        const info = await defaultTransporter.sendMail(message);
        logger.info(`${label} sent successfully to ${message.to} via fallback SMTP`, { messageId: info.messageId }, 'MAILER_SERVICE');
        return { sent: true, messageId: info.messageId };
      } catch (e) {
        logger.warn(`Fallback SMTP send failed for ${label}`, { errorMessage: e?.message }, 'MAILER_SERVICE');
      }
    }
    logger.warn(`Vendor SMTP not configured (VENDOR_SMTP_USER/VENDOR_SMTP_PASSWORD unset) — ${label} not sent`, { to: message.to }, 'MAILER_SERVICE');
    return { sent: false, reason: 'SMTP not configured' };
  }

  logger.info(`Dispatching ${label} to ${message.to}`, { subject: message.subject }, 'MAILER_SERVICE');
  try {
    const info = await activeTransporter.sendMail(message);
    logger.info(`${label} sent successfully to ${message.to}`, { messageId: info.messageId }, 'MAILER_SERVICE');
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    // Raw SMTP (nodemailer) cannot run on Cloudflare Workers at all — its TLS
    // socket layer doesn't implement `rejectUnauthorized`, so every send
    // through a real VENDOR_SMTP_USER/PASSWORD transporter throws "The
    // options.rejectUnauthorized option is not implemented" the moment one
    // gets configured (confirmed live: this silently broke every vendor
    // onboarding/invite email the day VENDOR_SMTP_* secrets were first set,
    // since before that getVendorTransporter() returned undefined and this
    // function's own fallback above never got a chance to run). Falling back
    // to the Gmail API here — the same proven-working path used when no
    // vendor mailbox is configured at all — rather than letting a transport
    // this platform can't support take the whole vendor mail path down.
    if (isGmailApiConfigured()) {
      logger.warn(
        `Vendor SMTP send failed for ${label} — falling back to the Gmail API (buyer account)`,
        { to: message.to, errorMessage: err.message },
        'MAILER_SERVICE'
      );
      return deliverViaGmailApi(message, label);
    }
    if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__) {
      return deliverViaMailChannels(message, label);
    }
    throw err;
  }
}

// ── Autonomous email-gateway: buyer requisition inbound notification ─────────

function buildRequisitionEmail(to, rfq = {}, fromEmail = '') {
  const safeRfq = rfq || {};
  const lineItems = Array.isArray(safeRfq.extractedEntities)
    ? safeRfq.extractedEntities
    : Array.isArray(safeRfq.items)
      ? safeRfq.items
      : [];
  const lineItemsHtml = lineItems.length > 0
    ? lineItems.map((item, index) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px; font-weight: bold;">${index + 1}. ${item.itemName || item.name || 'Line Item'}</td>
          <td style="padding: 10px; text-align: center;">${item.quantity || 1} ${item.unit || item.uom || 'Units'}</td>
          <td style="padding: 10px; font-size: 12px; color: #475569;">${item.technicalSpecs || item.specs || item.description || '-'}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" style="padding: 10px; color: #64748b;">No specific line items itemized.</td></tr>`;

  const frontendUrl = getPublicFrontendUrl();
  const logoUrl = getLogoUrl();
  const reviewUrl = `${frontendUrl}/buyer/rfqs?rfq=${encodeURIComponent(safeRfq.rfqNumber || '')}`;

  return {
    from: fromAddress(),
    to: to || 'navinchaudhary.dev@gmail.com',
    replyTo: fromEmail || safeRfq.sourceEmail || undefined,
    subject: `[Procucev Requisition] ${safeRfq.title || 'New Inbound Requisition'} (${safeRfq.rfqNumber || 'Draft'})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
        <div style="background: #0f172a; padding: 20px; border-radius: 8px 8px 0 0; color: white;">
          <div style="margin-bottom: 12px;">
            <a href="${frontendUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
              <img src="${logoUrl}" alt="Procucev Enterprise" height="36" style="height: 36px; max-height: 40px; width: auto; display: block; border: 0; background: #ffffff; padding: 4px 8px; border-radius: 4px;" />
            </a>
          </div>
          <h2 style="margin: 0; font-size: 18px; letter-spacing: 0.5px;">PROCUCEV ENTERPRISE</h2>
          <p style="margin: 4px 0 0 0; opacity: 0.8; font-size: 13px;">Autonomous Requisition Ingestion Notification</p>
        </div>
        <div style="padding: 20px; border: 1px solid #e2e8f0; border-top: none; background: #ffffff; border-radius: 0 0 8px 8px;">
          <div style="background: #f8fafc; padding: 14px; border-radius: 6px; margin-bottom: 18px; border-left: 4px solid #0284c7;">
            <p style="margin: 0; font-size: 13px;"><strong>From (Buyer / Plant Engineer):</strong> ${fromEmail || rfq.sourceEmail || 'Buyer'}</p>
            <p style="margin: 4px 0 0 0; font-size: 13px;"><strong>RFQ Number:</strong> <span style="font-family: monospace; color: #0284c7; font-weight: bold;">${rfq.rfqNumber}</span></p>
            <p style="margin: 4px 0 0 0; font-size: 13px;"><strong>Category:</strong> ${rfq.category || 'General Procurement'}</p>
            <p style="margin: 4px 0 0 0; font-size: 13px;"><strong>Target Delivery Date:</strong> ${rfq.targetDeliveryDate || 'Immediate'}</p>
          </div>

          <h3 style="font-size: 14px; margin: 0 0 10px 0; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">Extracted Line Items</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
            <thead>
              <tr style="background: #f1f5f9; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b;">
                <th style="padding: 8px 10px;">Item Description</th>
                <th style="padding: 8px 10px; text-align: center;">Qty</th>
                <th style="padding: 8px 10px;">Technical Specs</th>
              </tr>
            </thead>
            <tbody>
              ${lineItemsHtml}
            </tbody>
          </table>

          <div style="padding: 12px; background: #eff6ff; border-radius: 6px; font-size: 12px; color: #1e40af;">
            ⚡ <strong>Status: Parsing.</strong> Matching vendors have been notified.
          </div>

          <div style="text-align: center; margin: 20px 0 8px 0;">
            <a href="${reviewUrl}" style="background: #0284c7; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 13px;">Review Requisition in Buyer Portal</a>
          </div>
        </div>
      </div>
    `,
  };
}

/**
 * Sends one message through Resend's HTTPS API instead of raw SMTP.
 *
 * Render (and several other PaaS hosts) block outbound SMTP (ports
 * 25/465/587) at the network level on every plan — no transporter config
 * (IPv4-forcing, port 465, etc.) can work around that, since the TCP
 * connection itself never completes (ETIMEDOUT/CONN). An HTTPS API call is
 * unaffected. Used automatically whenever RESEND_API_KEY is set; falls back
 * to SMTP otherwise, so local dev (where raw SMTP works fine) is unchanged.
 */
async function deliverViaResend(message, label) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || fromAddress();

  logger.info(`Dispatching ${label} to ${message.to} via Resend`, { subject: message.subject }, 'MAILER_SERVICE');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Resend responded ${res.status}`);
    err.code = 'RESEND_API_ERROR';
    throw err;
  }

  logger.info(`${label} sent successfully to ${message.to}`, { messageId: body.id }, 'MAILER_SERVICE');
  return { sent: true, messageId: body.id };
}

/**
 * Sends email via MailChannels HTTPS API (natively supported on Cloudflare Workers without raw sockets).
 */
async function deliverViaMailChannels(message, label) {
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || 'manav.procucev@gmail.com';
  const fromName = 'Procucev Enterprise';

  logger.info(`Dispatching ${label} to ${message.to} via MailChannels API`, { subject: message.subject }, 'MAILER_SERVICE');
  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.to }] }],
      from: {
        email: fromEmail,
        name: fromName,
      },
      subject: message.subject,
      content: [
        {
          type: 'text/plain',
          value: message.text || (message.html ? message.html.replace(/<[^>]+>/g, ' ') : ''),
        },
        {
          type: 'text/html',
          value: message.html || '',
        },
      ],
    }),
  });

  if (!res.ok && res.status !== 202) {
    const errorBody = await res.text().catch(() => '');
    const err = new Error(`MailChannels responded ${res.status}: ${errorBody}`);
    err.code = 'MAILCHANNELS_API_ERROR';
    throw err;
  }

  logger.info(`${label} sent successfully to ${message.to} via MailChannels`, {}, 'MAILER_SERVICE');
  return { sent: true, provider: 'mailchannels' };
}

let gmailApiDisabled = false;

/** True when GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN are all set and active. */
function isGmailApiConfigured() {
  if (gmailApiDisabled) return false;
  const hasClientId = Boolean(process.env.GMAIL_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.GMAIL_CLIENT_SECRET);
  const hasRefreshToken = Boolean(process.env.GMAIL_REFRESH_TOKEN);
  if (!hasClientId || !hasClientSecret || !hasRefreshToken) {
    logger.warn(
      'Gmail API not configured',
      { hasClientId, hasClientSecret, hasRefreshToken },
      'MAILER_SERVICE'
    );
  }
  return hasClientId && hasClientSecret && hasRefreshToken;
}

let gmailOAuthClient;
let gmailOAuthClientRefreshToken;

function getGmailOAuthClient() {
  const refreshToken = getEnv('GMAIL_REFRESH_TOKEN');
  if (gmailOAuthClient && gmailOAuthClientRefreshToken === refreshToken) {
    return gmailOAuthClient;
  }
  if (!isGmailApiConfigured()) return undefined;
  const clientId = getEnv('GMAIL_CLIENT_ID');
  const clientSecret = getEnv('GMAIL_CLIENT_SECRET');
  gmailOAuthClient = new google.auth.OAuth2(clientId, clientSecret);
  gmailOAuthClient.setCredentials({ refresh_token: refreshToken });
  gmailOAuthClientRefreshToken = refreshToken;
  return gmailOAuthClient;
}

/**
 * Gmail's API takes a full RFC 2822 message, base64url-encoded — there is no
 * separate {to, subject, html} shape like nodemailer/Resend accept. Building
 * it by hand (rather than pulling in a MIME-builder dependency) keeps this
 * to what the three fields this app ever sends actually need.
 */
function buildRawMimeMessage({ from, to, subject, html, replyTo }) {
  // RFC 5322 requires Date and treats Message-ID as strongly recommended.
  // Gmail's own relay normally injects both when a raw message omits them,
  // but leaving them out is still a real gap some stricter receiving filters
  // (spam-sensitive or disposable-inbox providers especially) penalize —
  // cheap to set explicitly rather than rely on the relay's own fallback.
  const domain = (from.match(/<([^>]+)>/)?.[1] || from).split('@')[1] || 'procucev.com';
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject || '', 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
  ].filter(Boolean);
  const raw = `${headers.join('\r\n')}\r\n\r\n${html || ''}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/**
 * Sends one message through the Gmail API (users.messages.send) instead of
 * raw SMTP. Takes priority over Resend/SMTP when configured — this is the
 * intended replacement for buyer-side outbound mail, not an additional
 * fallback.
 */
async function deliverViaGmailApi(message, label) {
  const auth = getGmailOAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  logger.info(`Dispatching ${label} to ${message.to} via Gmail API`, { subject: message.subject }, 'MAILER_SERVICE');
  const sender = getEnv('GMAIL_SENDER_EMAIL');
  const raw = buildRawMimeMessage({
    from: sender ? `"Procucev Enterprise" <${sender}>` : fromAddress(),
    to: message.to,
    subject: message.subject,
    html: message.html,
    replyTo: message.replyTo,
  });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  logger.info(`${label} sent successfully to ${message.to}`, { messageId: res.data.id }, 'MAILER_SERVICE');
  return { sent: true, messageId: res.data.id };
}

function isVendorGmailApiConfigured() {
  return Boolean(getEnv('GMAIL_CLIENT_ID')) && Boolean(getEnv('GMAIL_CLIENT_SECRET')) && Boolean(getEnv('VENDOR_GMAIL_REFRESH_TOKEN'));
}

let vendorGmailOAuthClient;
let vendorGmailOAuthClientRefreshToken;

function getVendorGmailOAuthClient() {
  const refreshToken = getEnv('VENDOR_GMAIL_REFRESH_TOKEN');
  if (vendorGmailOAuthClient && vendorGmailOAuthClientRefreshToken === refreshToken) {
    return vendorGmailOAuthClient;
  }
  if (!isVendorGmailApiConfigured()) return undefined;
  const clientId = getEnv('GMAIL_CLIENT_ID');
  const clientSecret = getEnv('GMAIL_CLIENT_SECRET');
  vendorGmailOAuthClient = new google.auth.OAuth2(clientId, clientSecret);
  vendorGmailOAuthClient.setCredentials({ refresh_token: refreshToken });
  vendorGmailOAuthClientRefreshToken = refreshToken;
  return vendorGmailOAuthClient;
}

async function deliverViaVendorGmailApi(message, label) {
  const auth = getVendorGmailOAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  logger.info(`Dispatching ${label} to ${message.to} via vendor Gmail API`, { subject: message.subject }, 'MAILER_SERVICE');
  const sender = getEnv('VENDOR_GMAIL_SENDER_EMAIL');
  const raw = buildRawMimeMessage({
    from: sender ? `"Procucev Enterprise" <${sender}>` : vendorFromAddress(),
    to: message.to,
    subject: message.subject,
    html: message.html,
    replyTo: message.replyTo,
  });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  logger.info(`${label} sent successfully to ${message.to}`, { messageId: res.data.id }, 'MAILER_SERVICE');
  return { sent: true, messageId: res.data.id };
}

/**
 * True when a dedicated "quote received" alert-mailbox Gmail identity is
 * configured (manav.procucev@gmail.com). Same reused OAuth "app"
 * (GMAIL_CLIENT_ID/SECRET) with its own refresh token, minted the same way
 * as the buyer/vendor identities — kept as a THIRD, separate identity
 * (rather than reusing VENDOR_GMAIL_REFRESH_TOKEN) so this notification's
 * send volume/quota never shares a bucket with either the buyer's inbound-
 * polling mailbox (navin.procucev@gmail.com, GMAIL_REFRESH_TOKEN) or the
 * existing vendor-outbound mailbox (VENDOR_GMAIL_REFRESH_TOKEN) — changing
 * this is explicitly meant not to touch either of those.
 */
function isQuoteAlertGmailApiConfigured() {
  return Boolean(process.env.GMAIL_CLIENT_ID) && Boolean(process.env.GMAIL_CLIENT_SECRET) && Boolean(process.env.QUOTE_ALERT_GMAIL_REFRESH_TOKEN);
}

let quoteAlertGmailOAuthClient;
let quoteAlertGmailOAuthClientRefreshToken;

/** Same staleness problem and fix as getGmailOAuthClient() above. */
function getQuoteAlertGmailOAuthClient() {
  if (
    quoteAlertGmailOAuthClient &&
    quoteAlertGmailOAuthClientRefreshToken === process.env.QUOTE_ALERT_GMAIL_REFRESH_TOKEN
  ) {
    return quoteAlertGmailOAuthClient;
  }
  if (!isQuoteAlertGmailApiConfigured()) return undefined;
  quoteAlertGmailOAuthClient = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  quoteAlertGmailOAuthClient.setCredentials({ refresh_token: process.env.QUOTE_ALERT_GMAIL_REFRESH_TOKEN });
  quoteAlertGmailOAuthClientRefreshToken = process.env.QUOTE_ALERT_GMAIL_REFRESH_TOKEN;
  return quoteAlertGmailOAuthClient;
}

/** Same as deliverViaGmailApi, but signed in as the dedicated quote-alert mailbox. */
async function deliverViaQuoteAlertGmailApi(message, label) {
  const auth = getQuoteAlertGmailOAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  logger.info(`Dispatching ${label} to ${message.to} via quote-alert Gmail API`, { subject: message.subject }, 'MAILER_SERVICE');
  const raw = buildRawMimeMessage({
    from: process.env.QUOTE_ALERT_GMAIL_SENDER_EMAIL ? `"Procucev Enterprise" <${process.env.QUOTE_ALERT_GMAIL_SENDER_EMAIL}>` : fromAddress(),
    to: message.to,
    subject: message.subject,
    html: message.html,
    replyTo: message.replyTo,
  });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  logger.info(`${label} sent successfully to ${message.to}`, { messageId: res.data.id }, 'MAILER_SERVICE');
  return { sent: true, messageId: res.data.id };
}

/**
 * Send one message through the shared transporter.
 *
 * No-ops (without throwing) during test runs and when neither the Gmail API,
 * Resend, nor SMTP is configured, so every caller can fire-and-forget. A
 * genuine transport failure is propagated to the caller — it is real and
 * worth logging/retrying.
 */
async function deliver(message, label) {
  if (process.env.NODE_ENV === 'test') {
    return { sent: false, reason: 'test environment' };
  }

  let lastError;

  if (isGmailApiConfigured()) {
    try {
      return await deliverViaGmailApi(message, label);
    } catch (err) {
      lastError = err;
      if (err?.message?.includes('invalid_grant') || err?.response?.data?.error === 'invalid_grant') {
        gmailApiDisabled = true;
      }
      logger.warn(
        `deliverViaGmailApi failed for ${label} — falling back to secondary transport`,
        { errorMessage: err?.message, to: message.to },
        'MAILER_SERVICE'
      );
    }
  }

  if (process.env.RESEND_API_KEY) {
    try {
      return await deliverViaResend(message, label);
    } catch (err) {
      lastError = err;
      logger.warn(
        `deliverViaResend failed for ${label} — falling back to secondary transport`,
        { errorMessage: err?.message, to: message.to },
        'MAILER_SERVICE'
      );
    }
  }

  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    if (lastError) {
      throw lastError;
    }
    if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__) {
      try {
        return await deliverViaMailChannels(message, label);
      } catch (mcErr) {
        logger.warn(`MailChannels send failed for ${label}`, { errorMessage: mcErr?.message }, 'MAILER_SERVICE');
      }
    }
    logger.warn(`SMTP not configured (SMTP_USER/SMTP_PASSWORD unset) — ${label} not sent`, { to: message.to }, 'MAILER_SERVICE');
    return { sent: false, reason: 'SMTP not configured' };
  }

  try {
    logger.info(`Dispatching ${label} to ${message.to}`, { subject: message.subject }, 'MAILER_SERVICE');
    const info = await activeTransporter.sendMail(message);
    logger.info(`${label} sent successfully to ${message.to}`, { messageId: info.messageId }, 'MAILER_SERVICE');
    return { sent: true, messageId: info.messageId };
  } catch (smtpErr) {
    if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__) {
      return await deliverViaMailChannels(message, label);
    }
    throw smtpErr;
  }
}

/** Shared frame so every Procucev email reads consistently. No invented data. */
function wrapEmail(headline, subline, innerHtml) {
  const frontendUrl = getPublicFrontendUrl();
  const logoUrl = getLogoUrl();
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
      <div style="background: #ffffff; padding: 24px; border-radius: 8px 8px 0 0; border-bottom: 3px solid #0284c7;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="vertical-align: middle;">
              <a href="${frontendUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
                <img src="${logoUrl}" alt="Procucev Enterprise" height="38" style="height: 38px; max-height: 42px; width: auto; display: block; border: 0;" />
              </a>
              <div style="font-size: 11px; font-weight: 600; color: #64748b; letter-spacing: 0.5px; margin-top: 4px;">ENTERPRISE PROCUREMENT</div>
            </td>
            <td style="text-align: right; vertical-align: middle;">
              <div style="font-size: 14px; font-weight: 600; color: #0f172a;">${headline}</div>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${subline}</div>
            </td>
          </tr>
        </table>
      </div>
      <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; background: #ffffff; border-radius: 0 0 8px 8px;">
        ${innerHtml}
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #64748b; margin: 0;">Procucev Enterprise · You are receiving this because your organisation is registered on the platform.</p>
      </div>
    </div>
  `;
}

/** One "field: value" row, only when the value is real. */
function row(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<tr><td style="padding: 6px 10px; font-weight: bold; width: 40%;">${label}</td><td style="padding: 6px 10px;">${value}</td></tr>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── OTP ──────────────────────────────────────────────────────────────────────

function buildOtpEmail(to, code, expiresInSeconds, context = {}) {
  const minutes = Math.max(1, Math.round((expiresInSeconds || 600) / 60));
  const isReg = typeof context === 'object' && context?.isRegistration;
  const headline = isReg ? 'Account Registration Verification' : 'Secure Sign-In Verification';
  const subject = isReg ? 'Your Procucev Enterprise Account Verification Code' : 'Your Procucev Enterprise verification code';
  return {
    from: fromAddress(),
    to,
    subject,
    text: `Your Procucev Enterprise verification code is: ${code}\n\nThis code expires in ${minutes} minute${minutes === 1 ? '' : 's'}.\nIf you did not request this, you can safely ignore this email.`,
    html: wrapEmail(
      'PROCUCEV ENTERPRISE',
      headline,
      `<p>Your one-time verification code is:</p>
       <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; margin: 20px 0; color: #0284c7;">${code}</p>
       <p style="font-size: 13px; color: #64748b; margin: 0;">This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}. If you did not request this, you can safely ignore this email.</p>`
    ),
  };
}

async function sendOtpEmail(to, code, expiresInSeconds, context = {}) {
  return deliver(buildOtpEmail(to, code, expiresInSeconds, context), 'OTP email');
}

// ── New RFQ → matched vendors (buyer raised an enquiry in their category) ─────

function normalizeToAndContext(toOrParams, maybeContext) {
  if (typeof toOrParams === 'object' && toOrParams !== null && !maybeContext) {
    const { to, ...rest } = toOrParams;
    return { to, context: rest };
  }
  return { to: toOrParams, context: maybeContext || {} };
}

function emailGatewayAddress() {
  return process.env.EMAIL_GATEWAY_ADDRESS || process.env.EMAIL_GATEWAY_USER || 'rfqprocucev@gmail.com';
}

function buildRfqInviteEmail(to, context = {}) {
  const { rfq = {}, recipientName, buyerEmail, cc, freeCreditsRemaining, isSubscribed, isReminder = false } = context;
  const items = Array.isArray(rfq.extractedEntities) && rfq.extractedEntities.length > 0
    ? rfq.extractedEntities
    : Array.isArray(rfq.items) && rfq.items.length > 0
      ? rfq.items
      : Array.isArray(rfq.lineItems)
        ? rfq.lineItems
        : [];

  const itemRows = items
    .slice(0, 20)
    .map(
      (it, idx) =>
        `<tr>
          <td style="padding: 8px 10px; border: 1px solid #cbd5e1; font-weight: 600; color: #0f172a;">${idx + 1}. ${it.itemName || it.name || it.item_name || 'Line item'}${it.technicalSpecs || it.specifications || it.specs || it.description ? `<br/><span style="font-weight: normal; font-size: 11px; color: #64748b;">Specs: ${it.technicalSpecs || it.specifications || it.specs || it.description}</span>` : ''}</td>
          <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: #1e293b;">${it.quantity != null ? it.quantity : 1} ${it.unit || it.uom || 'Units'}</td>
          <td style="padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 12px; color: #475569;">${it.deliveryLocation || it.location || rfq.deliveryLocation || '-'}</td>
        </tr>`
    )
    .join('');

  const category = rfq.category || null;
  const subjectPrefix = isReminder ? 'Reminder: RFQ' : 'New RFQ';
  const subject = category
    ? `${subjectPrefix} ${rfq.rfqNumber} in ${category}`
    : `${subjectPrefix} ${rfq.rfqNumber}`;

  const budgetFormatted = rfq.budget != null && rfq.budget !== '' ? `₹${Number(rfq.budget).toLocaleString('en-IN')}` : null;

  const sampleReplyFormat = items.length > 1
    ? items.map((it, idx) => `${idx + 1}. ${it.itemName || it.name || `Item ${idx + 1}`}: Unit Price ₹[Enter Price] (Qty: ${it.quantity != null ? it.quantity : 1} ${it.unit || it.uom || 'Units'})`).join('\n') + '\n\nLead Time: [e.g. 7] Days\nWarranty: [e.g. 1] Year(s)\nPayment Terms: [e.g. Net 30 Days]\nRemarks: [e.g. Inclusions / Delivery terms]'
    : items.length === 1
      ? `Item: ${items[0].itemName || items[0].name || 'Line Item'}\nUnit Price: ₹[Enter Unit Price]\nLead Time: [e.g. 7] Days\nWarranty: [e.g. 1] Year(s)\nPayment Terms: [e.g. Net 30 Days]\nRemarks: [e.g. Inclusions / Delivery terms]`
      : `Unit Price: ₹[Enter Unit Price]\nTotal Price: ₹[Enter Total Price]\nLead Time: [e.g. 7] Days\nWarranty: [e.g. 1] Year(s)\nPayment Terms: [e.g. Net 30 Days]\nRemarks: [e.g. Inclusions / Delivery terms]`;

  const gatewayEmail = vendorGatewayAddress();
  const buyerCc = cc || buyerEmail || undefined;

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p>Greetings from <strong>Procucev!</strong></p>
    <p>QUA by <strong>Procucev</strong> is a trusted AI B2B marketplace connecting genuine buyers and quality sellers across India.</p>
    <p>${isReminder ? 'This is a reminder to submit your quotation for the following verified business enquiry matching your category.' : `We have a new verified business enquiry from ${rfq.buyerAccountName ? `<strong>${rfq.buyerAccountName}</strong>` : 'a corporate buyer'} that matches your category. Please review the details below:`}</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('RFQ Number', rfq.rfqNumber)}
      ${row('Requirement', rfq.title)}
      ${row('Category', category)}
      ${row('Target delivery', rfq.targetDeliveryDate || rfq.deadline)}
      ${row('Delivery location / Pincode', rfq.deliveryPincode ? `${rfq.deliveryLocation || ''} (${rfq.deliveryPincode})` : rfq.deliveryLocation)}
      ${budgetFormatted ? row('Budget', budgetFormatted) : ''}
    </table>
    ${
      itemRows
        ? `<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
             <thead><tr style="background: #f1f5f9; text-align: left;">
               <th style="padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 12px; color: #475569;">Sl No / Description</th>
               <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; font-size: 12px; color: #475569;">Quantity</th>
               <th style="padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 12px; color: #475569;">Delivery Location</th>
             </tr></thead>
             <tbody>${itemRows}</tbody>
           </table>`
        : ''
    }
    <div style="margin: 20px 0; padding: 18px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;">
      ${
        isSubscribed
          ? '<div style="background: #f0fdf4; border: 1px solid #86efac; color: #166534; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 12px;">✨ <strong>Subscribed Supplier:</strong> You have active subscription access with unlimited quotation submissions.</div>'
          : freeCreditsRemaining !== undefined && freeCreditsRemaining !== null
          ? `<div style="background: #f8fafc; border: 1px solid #cbd5e1; color: #334155; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 12px;">📊 <strong>Available Free Quotation Credits:</strong> ${freeCreditsRemaining} / 5 remaining.${freeCreditsRemaining === 0 ? ' <span style="color: #b91c1c; font-weight: bold;">(Plan upgrade required to submit quote)</span>' : ''}</div>`
          : ''
      }
      <h4 style="margin: 0 0 10px 0; color: #1e40af; font-size: 15px; font-weight: 700;">How to Submit Your Quotation</h4>
      <p style="margin: 0 0 10px 0; font-size: 13px; color: #1e293b; line-height: 1.5;">
        You can submit your bid either by <strong>replying directly to this email at <a href="mailto:${gatewayEmail}" style="color: #0284c7; font-weight: bold;">${gatewayEmail}</a></strong> (keep the subject line intact with RFQ number <strong>#${rfq.rfqNumber}</strong>${buyerCc ? ` and keep buyer CC'd: <strong>${buyerCc}</strong>` : ''}), or online via the <a href="${getPublicFrontendUrl()}/vendor/quotation-form?rfq=${encodeURIComponent(rfq.rfqNumber || '')}" style="color: #0284c7; font-weight: bold;">Procucev Quotation Portal</a>.
      </p>

      <p style="margin: 12px 0 6px 0; font-size: 13px; font-weight: 700; color: #1e293b;">Mandatory Quotation Information Required:</p>
      <ul style="margin: 0 0 12px 0; padding-left: 20px; font-size: 13px; color: #334155; line-height: 1.6;">
        <li><strong>Unit Price (₹)*</strong> — <span style="color: #b91c1c; font-weight: bold;">Mandatory</span>: Quoted unit rate (must be greater than ₹0) for each line item.</li>
        <li><strong>Lead Time (Days)</strong> — Expected delivery timeline from PO issuance.</li>
        <li><strong>Warranty (Years)</strong> — Product warranty period.</li>
        <li><strong>Payment Terms</strong> — Commercial terms (e.g., Net 30, Advance).</li>
        <li><strong>Remarks</strong> — Any inclusions, exclusions, or terms.</li>
      </ul>

      <p style="margin: 14px 0 6px 0; font-size: 13px; font-weight: 700; color: #1e293b;">Email Reply Format (Copy, Fill & Send):</p>
      <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; color: #1e293b; white-space: pre-wrap; line-height: 1.4;">${sampleReplyFormat}</div>
      <p style="margin: 8px 0 0 0; font-size: 11px; color: #64748b;"><em>Our automated AI Email Gateway will parse your reply and immediately reflect your bid in Enterprise QUA Vendor Comparison.</em></p>
      ${items.length > 1 ? '<p style="margin: 8px 0 0 0; font-size: 12px; color: #475569;"><em>For multi-item RFQs, please quote unit price per item in your reply.</em></p>' : ''}
    </div>

    <div style="margin: 16px 0; padding: 12px 16px; background: #fdf4ff; border: 1px solid #f0abfc; border-radius: 8px; font-size: 12px; color: #701a75;">
      💬 <strong>WhatsApp Real-time Enquiry Alerts:</strong> Just say Hi to <strong>7090170801</strong> to receive new enquiries matching your categories as soon as they come in.
    </div>

    <p style="font-size: 13px; color: #334155; line-height: 1.5;">
      Please submit your offer on time to increase your chances of getting the order and connecting directly with the B2B client.<br/>
      To receive more RFQs, please update your relevant product categories in the QUA portal. Correct categories help you receive more verified business opportunities.
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${getPublicFrontendUrl()}/vendor/quotation-form?rfq=${encodeURIComponent(rfq.rfqNumber || '')}" style="background: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px; margin-bottom: 10px;">Submit Quotation in 1-Click</a>
      <br />
      <a href="${vendorSignInUrl()}" style="color: #0284c7; text-decoration: underline; font-weight: 600; font-size: 13px;">Open in Vendor Web Portal</a>
    </div>
    <p style="font-size: 12px; color: #64748b; text-align: center;">
      <em>This is a system generated RFQ invitation. You can also check RFQs regularly on <a href="https://www.procucev.com" style="color: #0284c7;">www.procucev.com</a></em>
    </p>
    <p style="font-size: 13px; color: #334155; margin-top: 16px;">
      <strong>Best Regards,</strong><br/>
      <strong>Team Procucev</strong>
    </p>
  `;

  return {
    from: vendorFromAddress(),
    to,
    replyTo: gatewayEmail,
    cc: buyerCc,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', isReminder ? 'RFQ Reminder' : 'New Sourcing Enquiry', inner),
  };
}

async function sendRfqInviteEmail(to, context) {
  return deliverVendor(buildRfqInviteEmail(to, context), 'RFQ invite email');
}

// ── Vendor quote acknowledgement → vendor (with buyer & support CC) ─────────

function buildQuoteAcknowledgementEmail(toOrParams, maybeContext) {
  const { to, context } = normalizeToAndContext(toOrParams, maybeContext);
  const { rfqNumber, rfqTitle, vendorName, quote = {}, cc } = context;
  const subject = `Quotation Received – RFQ ${rfqNumber}`;
  const inner = `
    <p>${vendorName ? `Dear <strong>${vendorName}</strong>,` : 'Hello,'}</p>
    <p>Your quotation for RFQ <strong>#${rfqNumber}</strong>${rfqTitle ? ` (${rfqTitle})` : ''} has been received and successfully recorded in Enterprise QUA.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('RFQ Number', rfqNumber)}
      ${row('Unit Price', quote.unitPrice != null ? `₹${quote.unitPrice}` : '')}
      ${row('Total Price', quote.totalPrice != null ? `₹${quote.totalPrice}` : '')}
      ${row('Lead Time', quote.leadTimeDays != null ? `${quote.leadTimeDays} days` : '')}
      ${row('Warranty', quote.warrantyYears != null ? `${quote.warrantyYears} year(s)` : '')}
      ${row('Payment Terms', quote.paymentTerms)}
      ${row('Remarks', quote.remarks)}
    </table>
    <p style="font-size: 13px; color: #64748b;">The buyer has been notified and your quotation is now available under Vendor Comparison.</p>
  `;

  return {
    from: vendorFromAddress(),
    to,
    replyTo: vendorGatewayAddress(),
    cc: cc || undefined,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Quotation Submission Confirmation', inner),
  };
}

async function sendQuoteAcknowledgementEmail(toOrParams, maybeContext) {
  return deliverVendor(buildQuoteAcknowledgementEmail(toOrParams, maybeContext), 'quote acknowledgement email');
}

// ── Vendor quote failure notification → vendor (with buyer & support CC) ─────

function buildQuoteFailureEmail(toOrParams, maybeContext) {
  const { to, context } = normalizeToAndContext(toOrParams, maybeContext);
  const { rfqNumber, rfqTitle, vendorName, reason, missingFields, cc } = context;
  const subject = `Action Required – Quotation Could Not Be Processed for RFQ ${rfqNumber}`;
  const inner = `
    <p>${vendorName ? `Dear <strong>${vendorName}</strong>,` : 'Hello,'}</p>
    <p>We received your email response regarding RFQ <strong>#${rfqNumber}</strong>${rfqTitle ? ` (${rfqTitle})` : ''}, but your quotation could not be processed due to the following reason:</p>
    <div style="background: #fef2f2; border: 1px solid #f87171; color: #991b1b; padding: 12px; border-radius: 6px; margin: 16px 0;">
      <strong>Validation Issue:</strong> ${reason || (missingFields && missingFields.length ? `Missing required field(s): ${missingFields.join(', ')}` : 'Incomplete quotation details')}
    </div>
    <p><strong>Required Information:</strong></p>
    <ul style="color: #334155; line-height: 1.6;">
      <li><strong>Unit Price (₹)*:</strong> A valid unit price greater than 0 is mandatory.</li>
      <li><strong>Lead Time (Days):</strong> Expected delivery timeline.</li>
      <li><strong>Warranty (Years):</strong> Warranty period if applicable.</li>
      <li><strong>Payment Terms:</strong> Accepted commercial payment terms.</li>
    </ul>
    <p style="font-size: 13px; color: #64748b;">Please reply to this email with the required quotation details or submit your quotation directly via the Procucev vendor portal.</p>
  `;

  return {
    from: vendorFromAddress(),
    to,
    replyTo: vendorGatewayAddress(),
    cc: cc || undefined,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Quotation Submission Notice', inner),
  };
}

async function sendQuoteFailureEmail(toOrParams, maybeContext) {
  return deliverVendor(buildQuoteFailureEmail(toOrParams, maybeContext), 'quote failure notification email');
}

// ── Vendor credits exhausted notification → vendor ───────────────────────────

function buildVendorCreditsExhaustedEmail(toOrParams, maybeContext) {
  const { to, context } = normalizeToAndContext(toOrParams, maybeContext);
  const { rfq = {}, rfqNumber, rfqTitle, vendorName, cc, upgradeUrl } = context;
  const targetRfqNumber = rfqNumber || rfq.rfqNumber || 'RFQ';
  const targetTitle = rfqTitle || rfq.title || 'Procurement Requisition';
  const portalUpgradeLink = upgradeUrl || vendorUpgradeUrl();

  const items = Array.isArray(rfq.extractedEntities) && rfq.extractedEntities.length > 0
    ? rfq.extractedEntities
    : Array.isArray(rfq.items) && rfq.items.length > 0
      ? rfq.items
      : Array.isArray(rfq.lineItems)
        ? rfq.lineItems
        : [];

  const itemRows = items
    .slice(0, 15)
    .map(
      (it, idx) =>
        `<tr>
          <td style="padding: 8px 10px; border: 1px solid #cbd5e1; font-weight: 600; color: #0f172a;">${idx + 1}. ${it.itemName || it.name || 'Line Item'}${it.technicalSpecs || it.specifications || it.specs || it.description ? `<br/><span style="font-weight: normal; font-size: 11px; color: #64748b;">Specs: ${it.technicalSpecs || it.specifications || it.specs || it.description}</span>` : ''}</td>
          <td style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: #1e293b;">${it.quantity != null ? it.quantity : 1} ${it.unit || it.uom || 'Units'}</td>
          <td style="padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 12px; color: #475569;">${it.deliveryLocation || it.location || rfq.deliveryLocation || '-'}</td>
        </tr>`
    )
    .join('');

  const budgetFormatted = rfq.budget != null && rfq.budget !== '' ? `₹${Number(rfq.budget).toLocaleString('en-IN')}` : null;
  const subject = `Action Required – 5 Free Quotation Credits Exhausted for RFQ #${targetRfqNumber}`;

  const inner = `
    <p>${vendorName ? `Dear <strong>${vendorName}</strong>,` : 'Hello,'}</p>
    <p>We received your email quotation response regarding RFQ <strong>#${targetRfqNumber}</strong> (${targetTitle}).</p>
    
    <div style="background: #fffbeb; border: 1px solid #f59e0b; color: #92400e; padding: 14px; border-radius: 6px; margin: 16px 0;">
      <strong>Notice: Free Quotation Credits Exhausted</strong><br/>
      Your <strong>5 free RFQ quotation credits</strong> have been fully used. In accordance with Enterprise QUA procurement policies, an active subscription plan is required to continue submitting quotations and creating bids.
    </div>

    <h3 style="font-size: 14px; margin: 16px 0 8px 0; color: #0f172a; text-transform: uppercase;">Relevant Current RFQ Details</h3>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; background: #f8fafc;">
      ${row('RFQ Number', targetRfqNumber)}
      ${row('Requirement', targetTitle)}
      ${row('Category', rfq.category)}
      ${row('Target Delivery Date', rfq.targetDeliveryDate || rfq.deadline)}
      ${row('Delivery Location', rfq.deliveryLocation)}
      ${budgetFormatted ? row('Estimated Budget', budgetFormatted) : ''}
    </table>

    ${
      itemRows
        ? `<h4 style="font-size: 12px; margin: 0 0 6px 0; color: #475569; text-transform: uppercase;">Requested Line Items</h4>
           <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px;">
             <thead><tr style="background: #f1f5f9; text-align: left;">
               <th style="padding: 8px 10px; border: 1px solid #cbd5e1;">Item Description</th>
               <th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center;">Quantity</th>
               <th style="padding: 8px 10px; border: 1px solid #cbd5e1;">Location</th>
             </tr></thead>
             <tbody>${itemRows}</tbody>
           </table>`
        : ''
    }

    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin: 16px 0;">
      <h4 style="margin: 0 0 8px 0; color: #0f172a; font-size: 13px;">Mandatory Information Required for Quotation</h4>
      <p style="margin: 0 0 8px 0; font-size: 12px; color: #475569;">When you upgrade and submit your quotation, please ensure the following mandatory details are provided:</p>
      <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #334155; line-height: 1.6;">
        <li><strong>Unit Price (₹)*</strong> — <span style="color: #b91c1c; font-weight: bold;">Mandatory</span>: Quoted unit rate (must be greater than ₹0) for each line item.</li>
        <li><strong>Lead Time (Days)</strong> — Expected delivery timeline from PO issuance.</li>
        <li><strong>Warranty (Years)</strong> — Product/service warranty coverage.</li>
        <li><strong>Payment Terms</strong> — Commercial terms (e.g., Net 30, Advance).</li>
        <li><strong>Remarks</strong> — Technical compliance, delivery terms, or scope notes.</li>
      </ul>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUpgradeLink}" style="background: #0284c7; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        Click Here to Go to Portal and Upgrade Plan
      </a>
      <p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b;">Or visit: <a href="${portalUpgradeLink}" style="color: #0284c7;">${portalUpgradeLink}</a></p>
    </div>

    <p style="font-size: 12px; color: #64748b;">
      <em>Please note: No bid has been created from your reply. Once your subscription plan is active on the vendor portal, your quotation can be processed and forwarded to the buyer.</em>
    </p>
  `;

  return {
    from: vendorFromAddress(),
    to,
    replyTo: vendorGatewayAddress(),
    cc: cc || undefined,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Free Quotation Credits Exhausted', inner),
  };
}

async function sendVendorCreditsExhaustedEmail(toOrParams, maybeContext) {
  return deliverVendor(buildVendorCreditsExhaustedEmail(toOrParams, maybeContext), 'vendor credits exhausted email');
}

// ── Vendor quote → owning buyer ─────────────────────────────────────────────

function buildQuoteReceivedEmail(to, { rfq = {}, quote = {}, recipientName }) {
  const isEmailSource = rfq.source === 'email' || rfq.source === 'email_gateway' || rfq.source === 'inbound_email';
  const isV0 =
    rfq.sourcingMode === 'mode_0' ||
    rfq.sourcingMode === 'v0' ||
    rfq.sourcingMode === 'version_0';
  const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
  const createdAtMs = rfq.createdAt ? new Date(rfq.createdAt).getTime() : 0;
  const isWithin48h = !isEmailSource && !isV0 && ((createdAtMs > 0 && Date.now() - createdAtMs < FORTY_EIGHT_HOURS_MS) || Boolean(rfq.quotesHidden));
  const isClosed = rfq.status === 'Closed';
  const isSealed = isWithin48h && !isClosed;

  if (isSealed) {
    const unsealDateStr = createdAtMs > 0
      ? new Date(createdAtMs + FORTY_EIGHT_HOURS_MS).toLocaleString('en-IN')
      : 'in 48 hours';

    const inner = `
      <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
      <p>${quote.vendorName ? `<strong>${quote.vendorName}</strong> has` : 'A vendor has'} submitted a quotation against your RFQ.</p>
      <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
        <p style="margin: 0 0 6px 0; color: #92400e; font-weight: bold; font-size: 13px;">
          🔒 Commercial Bid Details Sealed (48-Hour Bidding Period Active)
        </p>
        <p style="margin: 0 0 6px 0; font-size: 12px; color: #78350f; line-height: 1.5;">
          In accordance with Enterprise QUA procurement policies, commercial bid details (pricing, payment terms, and delivery specifications) remain strictly sealed and hidden from the buyer side for <strong>48 hours</strong> after RFQ release to preserve bidding integrity.
        </p>
        <p style="margin: 0; font-size: 11px; color: #b45309; font-weight: 600;">
          ⏰ Unseals on: ${unsealDateStr} (or upon official RFQ closure)
        </p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
        ${row('RFQ Number', rfq.rfqNumber)}
        ${row('Requirement', rfq.title)}
        ${row('Vendor', quote.vendorName)}
        ${row('Submission Status', 'Quotation Received & Sealed')}
        ${row('Commercial Details', 'Hidden for 48 hours (bidding integrity window)')}
      </table>
      <p style="font-size: 13px; color: #64748b;">Sign in to your Procucev account to track the status of this RFQ. Full quotation details will become visible after the 48-hour period concludes.</p>
    `;

    return {
      from: fromAddress(),
      to,
      subject: `New quote on ${rfq.rfqNumber}${quote.vendorName ? ` from ${quote.vendorName}` : ''} (Sealed for 48h)`,
      html: wrapEmail('PROCUCEV ENTERPRISE', 'Quotation Received (Sealed)', inner),
    };
  }

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p>${quote.vendorName ? `<strong>${quote.vendorName}</strong> has` : 'A vendor has'} submitted a quotation against your RFQ.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('RFQ Number', rfq.rfqNumber)}
      ${row('Requirement', rfq.title)}
      ${row('Vendor', quote.vendorName)}
      ${row('Unit price', quote.unitPrice != null ? quote.unitPrice : null)}
      ${row('Total price', quote.totalPrice != null ? quote.totalPrice : null)}
      ${row('Lead time (days)', quote.leadTimeDays ? quote.leadTimeDays : null)}
      ${row('Payment terms', quote.paymentTerms)}
      ${row('Warranty (years)', quote.warrantyYears ? quote.warrantyYears : null)}
    </table>
    <p style="font-size: 13px; color: #64748b;">Sign in to your Procucev account to open the comparative quote matrix for this RFQ.</p>
  `;

  return {
    from: fromAddress(),
    to,
    subject: `New quote on ${rfq.rfqNumber}${quote.vendorName ? ` from ${quote.vendorName}` : ''}`,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Quotation Received', inner),
  };
}

async function sendQuoteReceivedEmail(to, context) {
  const message = buildQuoteReceivedEmail(to, context);
  if (process.env.NODE_ENV !== 'test' && isQuoteAlertGmailApiConfigured()) {
    return deliverViaQuoteAlertGmailApi(message, 'quote-received email');
  }
  return deliver(message, 'quote-received email');
}

// ── RFQ Final Comparison & Closure email → owning buyer ─────────────────────

function buildRfqFinalComparisonEmail(toOrParams, maybeContext) {
  const { to, context } = normalizeToAndContext(toOrParams, maybeContext);
  const { rfq = {}, quotes = [], recipientName, comparisonUrl } = context;
  const rfqNumber = rfq.rfqNumber || 'RFQ';
  const rfqTitle = rfq.title || 'Procurement Requisition';
  const quotesList = Array.isArray(quotes) && quotes.length > 0 ? quotes : (Array.isArray(rfq.quotes) ? rfq.quotes : []);
  const base = getPublicFrontendUrl();
  const resolvedUrl = comparisonUrl || `${base}/buyer/quote-matrix?rfq=${encodeURIComponent(rfqNumber)}`;

  const sortedQuotes = quotesList.slice().sort((a, b) => (Number(a.unitPrice) || Number(a.totalPrice) || 0) - (Number(b.unitPrice) || Number(b.totalPrice) || 0));
  const quotesRows = sortedQuotes.map((q, idx) => {
    const isLowest = idx === 0 && sortedQuotes.length > 1;
    return `
      <tr style="border-bottom: 1px solid #e2e8f0; ${isLowest ? 'background: #f0fdf4;' : ''}">
        <td style="padding: 10px; font-size: 13px; font-weight: 600; color: #0f172a;">
          ${idx + 1}. ${q.vendorName || 'Vendor'}
          ${isLowest ? '<span style="background: #16a34a; color: white; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">Lowest Bid (L1)</span>' : ''}
        </td>
        <td style="padding: 10px; font-size: 13px; font-weight: bold; color: #1e293b;">${q.unitPrice != null ? `₹${Number(q.unitPrice).toLocaleString('en-IN')}` : '-'}</td>
        <td style="padding: 10px; font-size: 13px; color: #334155;">${q.leadTimeDays != null ? `${q.leadTimeDays} days` : '-'}</td>
        <td style="padding: 10px; font-size: 13px; color: #334155;">${q.warrantyYears != null ? `${q.warrantyYears} yr(s)` : '-'}</td>
        <td style="padding: 10px; font-size: 13px; color: #334155;">${q.aiMatchScore != null ? `${q.aiMatchScore}%` : '-'}</td>
        <td style="padding: 10px; font-size: 12px; color: #475569;">${q.complianceStatus || 'Compliant'}</td>
      </tr>
    `;
  }).join('');

  const subject = `Final RFQ Comparison & Closure Summary – RFQ #${rfqNumber}`;
  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p>The bidding window for RFQ <strong>#${rfqNumber}</strong> (${rfqTitle}) has completed, and the sourcing requisition is officially closed.</p>
    
    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px; margin: 16px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        ${row('RFQ Number', rfqNumber)}
        ${row('Requirement', rfqTitle)}
        ${row('Category', rfq.category || '-')}
        ${row('Delivery Location', rfq.deliveryLocation || '-')}
        ${row('Status', 'Closed / Ready for Evaluation')}
        ${row('Total Quotes Received', `${quotesList.length} quote(s)`)}
      </table>
    </div>

    ${quotesList.length > 0 ? `
      <h3 style="font-size: 14px; margin: 20px 0 10px 0; color: #0f172a; text-transform: uppercase;">Quotation Comparison Matrix</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px;">
        <thead>
          <tr style="background: #f1f5f9; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569;">
            <th style="padding: 10px; border-bottom: 2px solid #cbd5e1;">Vendor</th>
            <th style="padding: 10px; border-bottom: 2px solid #cbd5e1;">Unit Price</th>
            <th style="padding: 10px; border-bottom: 2px solid #cbd5e1;">Lead Time</th>
            <th style="padding: 10px; border-bottom: 2px solid #cbd5e1;">Warranty</th>
            <th style="padding: 10px; border-bottom: 2px solid #cbd5e1;">AI Match</th>
            <th style="padding: 10px; border-bottom: 2px solid #cbd5e1;">Compliance</th>
          </tr>
        </thead>
        <tbody>
          ${quotesRows}
        </tbody>
      </table>
    ` : `
      <div style="background: #fffbeb; border: 1px solid #fef3c7; color: #92400e; padding: 12px; border-radius: 6px; margin: 16px 0;">
        No vendor quotations were submitted during the bidding window for this RFQ.
      </div>
    `}

    <div style="text-align: center; margin: 24px 0;">
      <a href="${resolvedUrl}" style="background: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px;">Open Comparison Matrix in Buyer Portal</a>
    </div>
    <p style="font-size: 12px; color: #64748b; text-align: center;">Sign in to your Procucev Buyer Portal to view detailed line-item quotes, audit logs, and approve Pre-Purchase Orders.</p>
  `;

  return {
    from: fromAddress(),
    to,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'RFQ Final Comparison & Closure', inner),
  };
}

async function sendRfqFinalComparisonEmail(toOrParams, maybeContext) {
  return deliver(buildRfqFinalComparisonEmail(toOrParams, maybeContext), 'RFQ final comparison email');
}

// ── RFQ Auto-Closure Immediate Acknowledgement email → owning buyer ─────────

function buildRfqAutoClosureAcknowledgementEmail(toOrParams, maybeContext) {
  const { to, context } = normalizeToAndContext(toOrParams, maybeContext);
  const { rfq = {}, quotesCount = 0, recipientName } = context;
  const rfqNumber = rfq.rfqNumber || 'RFQ';
  const rfqTitle = rfq.title || 'Procurement Requisition';
  const subject = `All Invited Vendors Quoted – RFQ #${rfqNumber} Automatically Closed`;

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p>Good news! All invited vendors have successfully submitted valid quotations for RFQ <strong>#${rfqNumber}</strong> (<em>${rfqTitle}</em>) before the deadline.</p>
    
    <div style="background: #f0fdf4; border: 1px solid #86efac; color: #166534; padding: 14px; border-radius: 6px; margin: 16px 0;">
      <strong>✓ 100% Vendor Participation Achieved — RFQ Closed Automatically</strong><br/>
      Total <strong>${quotesCount}</strong> valid quote(s) have been received. In accordance with autonomous procurement workflow rules, this RFQ has been closed immediately to preserve bidding integrity.
    </div>

    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px; margin: 16px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        ${row('RFQ Number', rfqNumber)}
        ${row('Requirement', rfqTitle)}
        ${row('Category', rfq.category || '-')}
        ${row('Delivery Location', rfq.deliveryLocation || '-')}
        ${row('Total Bids Received', `${quotesCount} vendor(s)`)}
        ${row('Status', 'Closed & Sealed')}
      </table>
    </div>

    <p style="color: #334155; font-size: 13px;">
      ⏳ <strong>Comparison Notification:</strong> Your comprehensive quotation comparison matrix and SMS summary are being compiled and will be delivered to your inbox and mobile in <strong>5 minutes</strong>.
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${getPublicFrontendUrl()}/buyer/rfq-details?rfq=${encodeURIComponent(rfqNumber)}" style="background: #16a34a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px;">View RFQ Status in Portal</a>
    </div>
  `;

  return {
    from: fromAddress(),
    to,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'RFQ Auto-Closure Notice', inner),
  };
}

async function sendRfqAutoClosureAcknowledgementEmail(toOrParams, maybeContext) {
  return deliver(buildRfqAutoClosureAcknowledgementEmail(toOrParams, maybeContext), 'RFQ auto-closure acknowledgement email');
}

// ── Complex RFQ (>10 items) Portal Redirection Email → vendor ───────────────

function buildComplexRfqPortalRedirectEmail(toOrParams, maybeContext) {
  const { to, context } = normalizeToAndContext(toOrParams, maybeContext);
  const { rfq = {}, vendorName, itemCount = 0 } = context;
  const rfqNumber = rfq.rfqNumber || 'RFQ';
  const rfqTitle = rfq.title || 'Procurement Requisition';
  const base = getPublicFrontendUrl();
  const portalUrl = `${base}/vendor/quotation-form?opportunity=${encodeURIComponent(rfqNumber)}`;
  const subject = `Portal Bidding Required for RFQ #${rfqNumber} (${itemCount} Items)`;

  const inner = `
    <p>${vendorName ? `Dear <strong>${vendorName}</strong>,` : 'Hello,'}</p>
    <p>We received your email quotation submission for RFQ <strong>#${rfqNumber}</strong> (<em>${rfqTitle}</em>).</p>
    
    <div style="background: #eff6ff; border: 1px solid #93c5fd; color: #1e40af; padding: 14px; border-radius: 6px; margin: 16px 0;">
      <strong>Notice: Complex RFQ Sourcing Requirement (${itemCount} Line Items)</strong><br/>
      For procurement requisitions with more than 10 line items, bids must be submitted directly through the Procucev Vendor Portal to ensure precise item-wise pricing, tax computation, and specification compliance.
    </div>

    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px; margin: 16px 0;">
      <h4 style="margin: 0 0 8px 0; color: #0f172a; font-size: 13px;">Simple Steps to Submit Your Bid:</h4>
      <ol style="margin: 0; padding-left: 20px; color: #334155; font-size: 13px; line-height: 1.6;">
        <li>Log in to the <strong>Procucev Vendor Portal</strong> using the button below.</li>
        <li>Download the pre-filled <strong>RFQ Excel Spreadsheet</strong> with all ${itemCount} items.</li>
        <li>Enter your item-wise unit rates, taxes, and lead times in the Excel sheet.</li>
        <li>Upload the priced Excel file and attach any supporting compliance/catalogue documents.</li>
      </ol>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}" style="background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px;">Open Vendor Portal & Submit Bid</a>
    </div>
    <p style="font-size: 12px; color: #64748b; text-align: center;">If you have any questions, please reply directly or access the clarification desk on the portal.</p>
  `;

  return {
    from: fromAddress(),
    to,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Portal Bidding Required', inner),
  };
}

async function sendComplexRfqPortalRedirectEmail(toOrParams, maybeContext) {
  return deliver(buildComplexRfqPortalRedirectEmail(toOrParams, maybeContext), 'Complex RFQ portal redirect email');
}

// ── Vendor Issue / Query reply notification → vendor (with buyer CC) ─────────

function buildVendorIssueAcknowledgementEmail(toOrParams, maybeContext) {
  const { to, context } = normalizeToAndContext(toOrParams, maybeContext);
  const { rfq = {}, rfqNumber, rfqTitle, vendorName, issueMessage, reason, cc } = context;
  const targetRfqNumber = rfqNumber || rfq.rfqNumber || 'RFQ';
  const targetTitle = rfqTitle || rfq.title || 'Procurement Requisition';
  const subject = `Inquiry Logged for RFQ #${targetRfqNumber} – Quotation Not Generated`;

  const inner = `
    <p>${vendorName ? `Dear <strong>${vendorName}</strong>,` : 'Hello,'}</p>
    <p>We received your response regarding RFQ <strong>#${targetRfqNumber}</strong> (${targetTitle}).</p>
    
    <div style="background: #fef2f2; border: 1px solid #f87171; color: #991b1b; padding: 14px; border-radius: 6px; margin: 16px 0;">
      <strong>Notice: Quotation Creation Failed / Bid Not Generated</strong><br/>
      Your submission has been identified as a <strong>clarification query or technical/commercial issue</strong> rather than a complete price quotation. In accordance with enterprise sourcing rules, quotation creation has failed and <strong>no bid has been generated</strong> for this response.
    </div>

    ${issueMessage ? `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin: 16px 0;">
        <strong style="color: #0f172a; font-size: 13px;">Logged Query / Issue Detail:</strong>
        <p style="color: #334155; font-size: 13px; margin: 6px 0 0 0; white-space: pre-wrap;">${issueMessage}</p>
      </div>
    ` : ''}

    <p style="font-size: 13px; color: #334155;">
      ${reason || 'The buyer has been kept in CC on this notification and can review your inquiry directly in the RFQ Clarifications Desk. Once the buyer clarifies the issue, you may submit your formal quotation before the bidding deadline.'}
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${vendorSignInUrl()}" style="background: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px;">Open Vendor Portal</a>
    </div>
    <p style="font-size: 12px; color: #64748b; text-align: center;">Sign in to your Procucev vendor account to view technical specifications or submit a commercial quotation.</p>
  `;

  return {
    from: vendorFromAddress(),
    to,
    replyTo: vendorGatewayAddress(),
    cc: cc || undefined,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Clarification Query Logged', inner),
  };
}

async function sendVendorIssueAcknowledgementEmail(toOrParams, maybeContext) {
  return deliverVendor(buildVendorIssueAcknowledgementEmail(toOrParams, maybeContext), 'vendor issue acknowledgment email');
}

// ── Vendor Category Mismatch: request update & exclude from shortlist ────────

function buildVendorCategoryMismatchEmail(toOrParams, maybeContext) {
  const { to, context } = normalizeToAndContext(toOrParams, maybeContext);
  const {
    rfq = {},
    rfqNumber,
    rfqTitle,
    rfqCategory,
    vendorName,
    vendorCurrentCategory,
    buyerAccountName,
    buyerEmail,
    cc,
  } = context;

  const targetRfqNumber = rfqNumber || rfq.rfqNumber || 'RFQ';
  const targetTitle = rfqTitle || rfq.title || 'Procurement Requisition';
  const targetCategory = rfqCategory || rfq.category || 'Requisition Category';
  const currentCategory = vendorCurrentCategory || 'Not specified / general';
  const subject = `Action Required: Category Mismatch for RFQ #${targetRfqNumber} – Please Update Business Profile`;

  const profileUrl = `${vendorSignInUrl()}?redirect=${encodeURIComponent('/vendor/vendor-profile')}`;

  const inner = `
    <p>${vendorName ? `Dear <strong>${vendorName}</strong>,` : 'Hello,'}</p>
    <p>You were identified as a potential supplier for RFQ <strong>#${targetRfqNumber}</strong> (${targetTitle})${buyerAccountName ? ` released by <strong>${buyerAccountName}</strong>` : ''}.</p>
    
    <div style="background: #fffbeb; border: 1px solid #f59e0b; color: #92400e; padding: 14px; border-radius: 6px; margin: 16px 0;">
      <strong>⚠️ Category Mismatch Identified – Business Profile Update Required</strong><br/>
      Our automated sourcing engine identified that your currently registered supplier category details do not cover the requested procurement category for this RFQ:
      <table style="width: 100%; margin-top: 10px; font-size: 13px; border-collapse: collapse;">
        <tr>
          <td style="padding: 4px 8px; font-weight: bold; width: 40%; color: #78350f;">Requested RFQ Category:</td>
          <td style="padding: 4px 8px; font-weight: bold; color: #1e3a8a;">${targetCategory}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px; font-weight: bold; color: #78350f;">Your Registered Category:</td>
          <td style="padding: 4px 8px; color: #b91c1c;">${currentCategory}</td>
        </tr>
      </table>
    </div>

    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin: 16px 0; color: #334155; font-size: 13px;">
      <strong>Shortlist Status:</strong><br/>
      In accordance with enterprise procurement governance, <strong>your company has not been included in the RFQ vendor shortlist</strong>. To become eligible for this and future sourcing opportunities in this category, please update and verify your business details and category taxonomy profile.
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${profileUrl}" style="background: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px;">Update Business & Category Details</a>
    </div>
    <p style="font-size: 12px; color: #64748b; text-align: center;">Once your category details are updated and verified, your profile will immediately become eligible for shortlisting.</p>
  `;

  return {
    from: vendorFromAddress(),
    to,
    replyTo: vendorGatewayAddress(),
    cc: cc || (buyerEmail ? buyerEmail : undefined),
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Vendor Category Update Required', inner),
  };
}

async function sendVendorCategoryMismatchEmail(toOrParams, maybeContext) {
  return deliverVendor(buildVendorCategoryMismatchEmail(toOrParams, maybeContext), 'vendor category mismatch notification email');
}

/**
 * Sends a requisition notification email when a buyer creates/ingests an RFQ.
 */
async function sendRequisitionNotificationEmail(to, rfq, fromEmail) {
  const safeRfq = rfq || {};
  try {
    return await deliver(buildRequisitionEmail(to, safeRfq, fromEmail), 'requisition notification email');
  } catch (err) {
    logger.error(`Failed to send requisition email to ${to}`, err, 'MAILER_SERVICE');
    return { sent: false, error: err.message };
  }
}

// ── Vendor Master & PO ingestion: category mapping + self-mapping ────────────
// Three templates the buyer dispatches at the end of an ingestion run. All of
// them deliberately carry the sign-in link and nothing else about the buyer's
// internals: no spend figures, no PO numbers, no other supplier's name, and no
// temporary password (the platform's existing OTP sign-in handles credentials,
// so mailing a password would add a secret to an inbox for no gain).

/** Where a supplier signs in. Configurable because it differs per deployment. */
function vendorSignInUrl() {
  const base = getPublicFrontendUrl();
  return `${base}/login`;
}

/** Where a supplier upgrades their subscription plan. */
function vendorUpgradeUrl() {
  const base = getPublicFrontendUrl();
  return `${base}/vendor/vendor-subscription`;
}

/** Where a buyer registers or signs in. Configurable because it differs per deployment. */
function buyerPortalUrl() {
  const base = getPublicFrontendUrl();
  return `${base}/login`;
}

/**
 * Builds the notification email sent to unauthorized/unregistered senders.
 */
function buildUnauthorizedBuyerEmail(to, context = {}) {
  const portalUrl = buyerPortalUrl();
  const gatewayAddress =
    context.gatewayAddress ||
    process.env.EMAIL_GATEWAY_USER ||
    UNAUTHORIZED_BUYER_NOTIFICATION.DEFAULT_GATEWAY_EMAIL;

  const inner = `
    <p>Dear Sir/Madam,</p>
    <p>We received your RFQ email, but the sender email address (<strong>${to}</strong>) is not registered as an authorized buyer in Enterprise QUA.</p>
    <p>To submit RFQs through Enterprise QUA, please register your buyer account and complete the required verification process.</p>
    <div style="background: #f8fafc; padding: 16px; border-radius: 6px; border: 1px solid #cbd5e1; margin: 20px 0;">
      <p style="margin: 0 0 10px 0; font-weight: bold; color: #0f172a;">Please register or sign in through the Enterprise QUA Buyer Portal:</p>
      <p style="margin: 10px 0;">
        <a href="${portalUrl}" style="background: #0284c7; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Enterprise QUA Buyer Portal</a>
      </p>
      <p style="margin: 4px 0; font-size: 12px; color: #64748b;">Registration URL: <a href="${portalUrl}" style="color: #0284c7;">${portalUrl}</a></p>
    </div>
    <p>After completing the registration and verification process, please resend your RFQ email to the Enterprise QUA RFQ email address (<strong>${gatewayAddress}</strong>).</p>
    <p style="font-size: 13px; color: #dc2626; font-weight: 500;">Your RFQ has not been created because the sender email is currently not authorized.</p>
    <p style="margin-top: 24px;">Regards,<br/><strong>Enterprise QUA</strong><br/>ProcureV</p>
  `;

  return {
    from: fromAddress(),
    to,
    subject: UNAUTHORIZED_BUYER_NOTIFICATION.SUBJECT,
    html: wrapEmail(
      UNAUTHORIZED_BUYER_NOTIFICATION.HEADLINE,
      UNAUTHORIZED_BUYER_NOTIFICATION.SUBLINE,
      inner
    ),
  };
}

/**
 * Dispatches a registration notification to an unregistered/unauthorized sender.
 */
async function sendUnauthorizedBuyerNotificationEmail(to, context = {}) {
  if (!to) return { sent: false, reason: 'missing recipient email' };
  return deliver(
    buildUnauthorizedBuyerEmail(to, context),
    'unauthorized-buyer registration notification email'
  );
}

/** A styled list of the categories a supplier has been mapped to. */
function categoryList(items = []) {
  const real = items.filter((item) => typeof item === 'string' && item.trim() !== '');
  if (real.length === 0) return '';
  return `<ul style="margin: 8px 0 0 0; padding-left: 20px;">${real
    .map((item) => `<li style="margin-bottom: 4px;">${item}</li>`)
    .join('')}</ul>`;
}

/**
 * Template A — the buyer has mapped this supplier's categories from PO history.
 *
 * The categories are stated explicitly so the supplier can tell the buyer if
 * they are wrong, which is the main way a mis-classification gets corrected
 * after dispatch.
 */
function buildVendorCategoryMappingEmail({
  to,
  recipientName,
  buyerOrganizationName,
  vendorCode,
  majorCategory,
  minorCategories = [],
  customSubject,
  customMessage,
  tempPassword,
  contactPhone,
}) {
  const buyer = buyerOrganizationName || 'A buyer on Procucev';
  const minorHtml = categoryList(minorCategories);

  const defaultMessage = `<p><strong>${buyer}</strong> has added your organisation to their vendor master and mapped your supply categories from your pre-purchase order history with them.</p>`;
  const messageHtml = (customMessage && customMessage.trim() !== '') ? `<p>${customMessage}</p>` : defaultMessage;

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    ${messageHtml}
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('Buyer', buyer)}
      ${row('Your vendor code', vendorCode)}
      ${row('Registered Email', to)}
      ${contactPhone ? row('Mobile Number', escapeHtml(contactPhone)) : ''}
      ${tempPassword ? row('Temporary Password', tempPassword) : ''}
      ${row('Primary category', majorCategory)}
    </table>
    ${
      minorHtml
        ? `<p style="margin-bottom: 0;"><strong>Sub-categories you are mapped to:</strong></p>${minorHtml}`
        : ''
    }
    <p style="margin-top: 20px;">You will now receive enquiries in these categories. Sign in to review the mapping, and let the buyer know if anything looks wrong.</p>
    <p style="margin: 20px 0;">
      <a href="${vendorSignInUrl()}" style="background: #0284c7; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Sign in to Procucev</a>
    </p>
    <p style="font-size: 13px; color: #64748b; margin: 0;">Sign in with this email address and your password or verification OTP.</p>
  `;

  const subject = (customSubject && customSubject.trim() !== '')
    ? customSubject
    : `${buyer} has mapped your supply categories${majorCategory ? ` — ${majorCategory}` : ''}`;

  return {
    from: fromAddress(),
    to,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Vendor Category Mapping Confirmed', inner),
  };
}

/**
 * Template B — no PO history was found, so the supplier must map itself.
 *
 * The wording states the reason plainly rather than implying the supplier did
 * something wrong: the buyer simply had no purchasing history to categorise them
 * from. Nothing about the buyer's spend or other suppliers is disclosed.
 */
function buildVendorSelfMappingEmail({ to, recipientName, buyerOrganizationName, vendorCode, customSubject, customMessage, tempPassword, contactPhone }) {
  const buyer = buyerOrganizationName || 'A buyer on Procucev';

  const defaultMessage = `
    <p><strong>${buyer}</strong> has added your organisation to their vendor master on Procucev.</p>
    <p>No historical pre-purchase order data was available for your organisation, so your supply categories could not be mapped automatically. <strong>To become eligible for relevant enquiries, please sign in and select the categories you supply.</strong></p>
  `;
  const messageHtml = (customMessage && customMessage.trim() !== '') ? `<p>${customMessage}</p>` : defaultMessage;

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    ${messageHtml}
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('Buyer', buyer)}
      ${row('Your vendor code', vendorCode)}
      ${row('Registered Email', to)}
      ${contactPhone ? row('Mobile Number', escapeHtml(contactPhone)) : ''}
      ${tempPassword ? row('Temporary Password', tempPassword) : ''}
      ${row('Action required', 'Select your supply categories')}
    </table>
    <p style="margin: 20px 0;">
      <a href="${vendorSignInUrl()}" style="background: #0284c7; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Complete your category mapping</a>
    </p>
    <p style="font-size: 13px; color: #64748b; margin: 0;">Sign in with this email address and your password or verification OTP. Until your categories are mapped, you will not be matched to enquiries.</p>
  `;

  const subject = (customSubject && customSubject.trim() !== '')
    ? customSubject
    : 'Complete Your Category Mapping to Receive Enquiries';

  return {
    from: fromAddress(),
    to,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Category Mapping Required', inner),
  };
}

/** Template C — a plain onboarding notice, with no category claim either way. */
function buildVendorOnboardingEmail({ to, recipientName, buyerOrganizationName, vendorCode, tempPassword, contactPhone }) {
  const buyer = buyerOrganizationName || 'A buyer on Procucev';

  const inner = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p style="font-size: 16px; color: #1e293b; margin-bottom: 20px;">
        ${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}
      </p>
      
      <p style="font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6;">
        <strong>${buyer}</strong> has registered your organisation on <strong>Procucev Enterprise</strong>, the platform they use to run sourcing enquiries and manage supplier relationships.
      </p>
      
      <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 1px solid #bae6fd; border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h3 style="color: #0369a1; font-size: 14px; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.5px;">Your Login Credentials</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Email Address</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${to}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Temporary Password</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600; background: #fff; padding: 8px 12px; border-radius: 4px; border: 1px solid #cbd5e1;">${tempPassword || 'Set during first login'}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Vendor Code</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${vendorCode}</td>
          </tr>
          ${contactPhone ? `
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Mobile Number</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${escapeHtml(contactPhone)}</td>
          </tr>
          ` : ''}
        </table>
      </div>
      
      <p style="font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6;">
        Please sign in to review your profile, confirm your supply categories, and start receiving sourcing enquiries from <strong>${buyer}</strong>.
      </p>
      
      <p style="margin: 28px 0;">
        <a href="${vendorSignInUrl()}" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(2, 132, 199, 0.3);">Sign in to Procucev Portal</a>
      </p>
      
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="font-size: 13px; color: #92400e; margin: 0; line-height: 1.5;">
          <strong>🔐 Security Notice:</strong> For your security, please change your temporary password after your first login. Your password should be at least 8 characters with a mix of letters, numbers, and special characters.
        </p>
      </div>
      
      <p style="font-size: 13px; color: #64748b; margin: 0; line-height: 1.6;">
        If you have any questions or need assistance, please contact our support team at <a href="mailto:support@procucev.ai" style="color: #0284c7;">support@procucev.ai</a>
      </p>
    </div>
  `;

  return {
    from: fromAddress(),
    to,
    subject: `[Action Required] Welcome to Procucev - Your Account Credentials from ${buyer}`,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Supplier Onboarding & Login Credentials', inner),
  };
}

/** Template D — Rating revision notification to vendor */
function buildRatingRevisionEmail({ to, recipientName, vendorName, buyerCompany, buyerName, previousRating, newRating, previousScore, newScore, remarks, qualityScore, costScore, deliveryScore }) {
  const inner = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <p style="font-size: 16px; color: #1e293b; margin-bottom: 20px;">
        ${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}
      </p>
      
      <p style="font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6;">
        <strong>${buyerCompany}</strong> has updated your performance rating on <strong>Procucev Enterprise</strong>.
      </p>
      
      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #86efac; border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h3 style="color: #166534; font-size: 14px; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.5px;">Rating Update Summary</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Previous Rating</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${previousRating.toFixed(1)} / 5.0</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">New Rating</td>
            <td style="padding: 12px 0; color: #166534; font-size: 16px; font-weight: bold;">${newRating.toFixed(1)} / 5.0</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Score Change</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${previousScore.toFixed(1)} → ${newScore.toFixed(1)}</td>
          </tr>
        </table>
      </div>
      
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h3 style="color: #334155; font-size: 14px; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.5px;">Performance Breakdown</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Quality Score</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${qualityScore} / 100</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Cost Score</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${costScore} / 100</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Delivery Score</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${deliveryScore} / 100</td>
          </tr>
        </table>
      </div>
      
      <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="font-size: 13px; color: #1e40af; margin: 0; line-height: 1.5;">
          <strong>📝 Remarks:</strong> ${remarks}
        </p>
      </div>
      
      <p style="font-size: 15px; color: #334155; margin-bottom: 20px; line-height: 1.6;">
        Sign in to Procucev to view your complete performance history and track your progress.
      </p>
      
      <p style="margin: 28px 0;">
        <a href="${vendorSignInUrl()}" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(2, 132, 199, 0.3);">View Performance Dashboard</a>
      </p>
      
      <p style="font-size: 13px; color: #64748b; margin: 0; line-height: 1.6;">
        If you have any questions about this rating update, please contact <strong>${buyerCompany}</strong> directly or reach out to our support team at <a href="mailto:support@procucev.ai" style="color: #0284c7;">support@procucev.ai</a>
      </p>
    </div>
  `;

  return {
    from: fromAddress(),
    to,
    subject: `[Rating Update] Your performance rating has been updated by ${buyerCompany}`,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'Vendor Rating Revision', inner),
  };
}

/**
 * Send one already-built ingestion email.
 *
 * Goes through `deliver`, so it no-ops under test and when SMTP is unconfigured
 * and returns `{ sent: false, reason }` rather than throwing. The ingestion
 * service records that reason against the recipient, which is what makes an
 * unconfigured server show up as retryable failures instead of silent success.
 */
async function sendVendorIngestionEmail(message, template) {
  return deliverVendor(message, `vendor ingestion ${template} email`);
}

/**
 * Template E — Buyer RFQ Creation Acknowledgement.
 * Sent to the buyer once their requirement has been converted into an RFQ.
 */
function buildRfqAcknowledgementEmail({ to, buyerName, rfqNumber, rfqTitle }) {
  const rawNumber = String(rfqNumber || '').trim();
  const cleanNumber = rawNumber.replace(/^#+/, '');
  const formattedRfqNumber = cleanNumber ? `#${cleanNumber}` : '#RFQ';
  const name = buyerName || 'Valued Buyer';
  const subject = RFQ_ACKNOWLEDGEMENT_NOTIFICATION.SUBJECT.replace('{rfqNumber}', cleanNumber || 'RFQ');

  const text = `Hi ${name},

Great news! Your requirement has been converted into RFQ ${formattedRfqNumber} and sent to verified suppliers on Procucev right now.

📩 ${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.QUOTES_TIMELINE}

${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.NEED_IT_FASTER}

📞 Call: ${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.SUPPORT_PHONE}
✉️ Email: ${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.SUPPORT_EMAIL}

${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.CLOSING}

${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.TEAM_SIGNATURE}`;

  const inner = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
      <p style="font-size: 16px; margin: 0 0 16px 0;">Hi <strong>${name}</strong>,</p>

      <p style="font-size: 15px; margin: 0 0 18px 0; line-height: 1.6;">
        Great news! Your requirement has been converted into <strong>RFQ <span style="color: #0284c7; font-family: monospace; font-size: 16px;">${formattedRfqNumber}</span></strong> and sent to verified suppliers on Procucev right now.
      </p>

      ${rfqTitle ? `<p style="font-size: 13px; color: #64748b; margin: 0 0 16px 0;"><strong>Requisition:</strong> ${rfqTitle}</p>` : ''}

      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 1px solid #86efac; border-radius: 8px; padding: 14px 18px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #166534; font-weight: 600;">
          📩 ${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.QUOTES_TIMELINE}
        </p>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 18px; margin: 20px 0;">
        <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: bold; color: #0f172a;">
          ${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.NEED_IT_FASTER}
        </p>
        <p style="margin: 0 0 8px 0; font-size: 13px;">
          📞 <strong>Call:</strong> <a href="tel:+917996170801" style="color: #0284c7; text-decoration: none; font-weight: 600;">${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.SUPPORT_PHONE}</a>
        </p>
        <p style="margin: 0; font-size: 13px;">
          ✉️ <strong>Email:</strong> <a href="mailto:RFQ@procucev.com" style="color: #0284c7; text-decoration: none;">RFQ@procucev.com</a> / <a href="mailto:support@procucev.com" style="color: #0284c7; text-decoration: none;">support@procucev.com</a>
        </p>
      </div>

      <p style="font-size: 14px; margin: 20px 0 24px 0; color: #334155;">
        ${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.CLOSING}
      </p>

      <p style="font-size: 15px; font-weight: bold; color: #0f172a; margin: 0;">
        ${RFQ_ACKNOWLEDGEMENT_NOTIFICATION.TEAM_SIGNATURE}
      </p>
    </div>
  `;

  return {
    from: fromAddress(),
    to,
    replyTo: RFQ_ACKNOWLEDGEMENT_NOTIFICATION.DEFAULT_GATEWAY_EMAIL,
    subject,
    text,
    html: wrapEmail(
      RFQ_ACKNOWLEDGEMENT_NOTIFICATION.HEADLINE,
      RFQ_ACKNOWLEDGEMENT_NOTIFICATION.SUBLINE,
      inner
    ),
  };
}

/**
 * Dispatch RFQ creation acknowledgement email to the buyer.
 */
async function sendRfqAcknowledgementEmail(params) {
  const message = buildRfqAcknowledgementEmail(params);
  return deliver(message, 'buyer RFQ acknowledgement');
}

function isConfigured() {
  return isGmailApiConfigured() || Boolean(process.env.RESEND_API_KEY) || Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

function isVendorConfigured() {
  return isVendorGmailApiConfigured() || Boolean(process.env.VENDOR_SMTP_USER && process.env.VENDOR_SMTP_PASSWORD);
}

module.exports = {
  getTransporter,
  getVendorTransporter,
  vendorFromAddress,
  vendorGatewayAddress,
  deliverVendor,
  sendOtpEmail,
  sendRfqInviteEmail,
  sendQuoteReceivedEmail,
  buildRfqInviteEmail,
  buildQuoteReceivedEmail,
  sendRequisitionNotificationEmail,
  buildRequisitionEmail,
  fromAddress,
  emailGatewayAddress,
  vendorSignInUrl,
  buyerPortalUrl,
  buildUnauthorizedBuyerEmail,
  sendUnauthorizedBuyerNotificationEmail,
  categoryList,
  buildVendorCategoryMappingEmail,
  buildVendorSelfMappingEmail,
  buildVendorOnboardingEmail,
  buildRatingRevisionEmail,
  sendVendorIngestionEmail,
  buildRfqAcknowledgementEmail,
  sendRfqAcknowledgementEmail,
  buildQuoteAcknowledgementEmail,
  sendQuoteAcknowledgementEmail,
  buildQuoteFailureEmail,
  sendQuoteFailureEmail,
  buildRfqFinalComparisonEmail,
  sendRfqFinalComparisonEmail,
  buildRfqAutoClosureAcknowledgementEmail,
  sendRfqAutoClosureAcknowledgementEmail,
  buildComplexRfqPortalRedirectEmail,
  sendComplexRfqPortalRedirectEmail,
  buildVendorIssueAcknowledgementEmail,
  sendVendorIssueAcknowledgementEmail,
  buildVendorCategoryMismatchEmail,
  sendVendorCategoryMismatchEmail,
  vendorUpgradeUrl,
  buildVendorCreditsExhaustedEmail,
  sendVendorCreditsExhaustedEmail,
  isConfigured,
  isVendorConfigured,
  isGmailApiConfigured,
  isVendorGmailApiConfigured,
  getVendorGmailOAuthClient,
  isQuoteAlertGmailApiConfigured,
  getGmailOAuthClient,
  getPublicFrontendUrl,
  getLogoUrl,
};
