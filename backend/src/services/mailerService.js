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
  const user = process.env.SMTP_FROM || process.env.SMTP_USER || 'RFQ@procucev.com';
  if (user.includes('<') && user.includes('>')) {
    return user;
  }
  return `"Procucev Enterprise" <${user}>`;
}

/**
 * Lazily builds a Gmail / SMTP transporter for vendor notifications and invites
 * from VENDOR_SMTP_USER/VENDOR_SMTP_PASSWORD (defaults strictly to srinu20252026@gmail.com).
 * Vendor communications NEVER fall back to buyer SMTP (rfqprocucev@gmail.com).
 */
function getVendorTransporter() {
  if (vendorTransporter) return vendorTransporter;

  const user = process.env.VENDOR_SMTP_USER;
  const rawPass = process.env.VENDOR_SMTP_PASSWORD;
  if (!user || !rawPass) return undefined;

  const pass = rawPass.replace(/\s+/g, '');
  const host = process.env.VENDOR_SMTP_HOST || 'smtp.gmail.com';
  const isGmail =
    (process.env.VENDOR_SMTP_SERVICE && process.env.VENDOR_SMTP_SERVICE.toLowerCase() === 'gmail') ||
    host.toLowerCase().includes('gmail');

  let port;
  let secure;

  if (process.env.VENDOR_SMTP_PORT) {
    port = Number(process.env.VENDOR_SMTP_PORT);
    secure = process.env.VENDOR_SMTP_SECURE !== undefined ? process.env.VENDOR_SMTP_SECURE === 'true' : port === 465;
  } else if (process.env.VENDOR_SMTP_SECURE !== undefined) {
    secure = process.env.VENDOR_SMTP_SECURE === 'true';
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
  const user = process.env.VENDOR_SMTP_FROM || process.env.VENDOR_SMTP_USER || 'srinu20252026@gmail.com';
  if (user.includes('<') && user.includes('>')) {
    return user;
  }
  return `"Procucev Enterprise" <${user}>`;
}

function vendorGatewayAddress() {
  return (
    process.env.VENDOR_EMAIL_GATEWAY_ADDRESS ||
    process.env.VENDOR_EMAIL_GATEWAY_USER ||
    process.env.VENDOR_SMTP_USER ||
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

  const activeTransporter = getVendorTransporter();
  if (!activeTransporter) {
    if (isGmailApiConfigured()) {
      logger.warn(
        `Vendor SMTP not configured — falling back to the Gmail API (buyer account) for ${label}`,
        { to: message.to },
        'MAILER_SERVICE'
      );
      return deliverViaGmailApi(message, label);
    }
    logger.warn(`Vendor SMTP not configured (VENDOR_SMTP_USER/VENDOR_SMTP_PASSWORD unset) — ${label} not sent`, { to: message.to }, 'MAILER_SERVICE');
    return { sent: false, reason: 'SMTP not configured' };
  }

  logger.info(`Dispatching ${label} to ${message.to}`, { subject: message.subject }, 'MAILER_SERVICE');
  const info = await activeTransporter.sendMail(message);
  logger.info(`${label} sent successfully to ${message.to}`, { messageId: info.messageId }, 'MAILER_SERVICE');
  return { sent: true, messageId: info.messageId };
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

  return {
    from: fromAddress(),
    to: to || 'navinchaudhary.dev@gmail.com',
    replyTo: fromEmail || safeRfq.sourceEmail || undefined,
    subject: `[Procucev Requisition] ${safeRfq.title || 'New Inbound Requisition'} (${safeRfq.rfqNumber || 'Draft'})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
        <div style="background: #0f172a; padding: 20px; border-radius: 8px 8px 0 0; color: white;">
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
            ⚡ <strong>Status: Parsing / Held for Category Manager Review.</strong> No vendors have been released yet.
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

/** True when GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN are all set. */
function isGmailApiConfigured() {
  const hasClientId = Boolean(process.env.GMAIL_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.GMAIL_CLIENT_SECRET);
  const hasRefreshToken = Boolean(process.env.GMAIL_REFRESH_TOKEN);
  if (!hasClientId || !hasClientSecret || !hasRefreshToken) {
    // Diagnostic only — booleans, never the secret values themselves.
    // Added while tracking down why the Gmail API branch wasn't firing in
    // production despite `wrangler secret list` confirming all three are
    // registered on the Worker.
    logger.warn(
      'Gmail API not configured',
      { hasClientId, hasClientSecret, hasRefreshToken },
      'MAILER_SERVICE'
    );
  }
  return hasClientId && hasClientSecret && hasRefreshToken;
}

let gmailOAuthClient;

/**
 * Lazily builds an OAuth2 client from the refresh token minted once via
 * scripts/get-gmail-refresh-token.js. googleapis' OAuth2Client caches and
 * auto-refreshes the short-lived access token internally — no manual token
 * refresh logic needed here.
 */
function getGmailOAuthClient() {
  if (gmailOAuthClient) return gmailOAuthClient;
  if (!isGmailApiConfigured()) return undefined;
  gmailOAuthClient = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  gmailOAuthClient.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return gmailOAuthClient;
}

/**
 * Gmail's API takes a full RFC 2822 message, base64url-encoded — there is no
 * separate {to, subject, html} shape like nodemailer/Resend accept. Building
 * it by hand (rather than pulling in a MIME-builder dependency) keeps this
 * to what the three fields this app ever sends actually need.
 */
function buildRawMimeMessage({ from, to, subject, html, replyTo }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject || '', 'utf8').toString('base64')}?=`,
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
  const raw = buildRawMimeMessage({
    from: process.env.GMAIL_SENDER_EMAIL ? `"Procucev Enterprise" <${process.env.GMAIL_SENDER_EMAIL}>` : fromAddress(),
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

  if (isGmailApiConfigured()) {
    return deliverViaGmailApi(message, label);
  }

  if (process.env.RESEND_API_KEY) {
    return deliverViaResend(message, label);
  }

  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    logger.warn(`SMTP not configured (SMTP_USER/SMTP_PASSWORD unset) — ${label} not sent`, { to: message.to }, 'MAILER_SERVICE');
    return { sent: false, reason: 'SMTP not configured' };
  }

  logger.info(`Dispatching ${label} to ${message.to}`, { subject: message.subject }, 'MAILER_SERVICE');
  const info = await activeTransporter.sendMail(message);
  logger.info(`${label} sent successfully to ${message.to}`, { messageId: info.messageId }, 'MAILER_SERVICE');
  return { sent: true, messageId: info.messageId };
}

/** Shared frame so every Procucev email reads consistently. No invented data. */
function wrapEmail(headline, subline, innerHtml) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
      <div style="background: #ffffff; padding: 24px; border-radius: 8px 8px 0 0; border-bottom: 3px solid #0284c7;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="vertical-align: middle;">
              <div style="font-size: 24px; font-weight: bold; color: #0284c7;">PROCUCEV</div>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">ENTERPRISE</div>
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

// ── OTP ──────────────────────────────────────────────────────────────────────

function buildOtpEmail(to, code, expiresInSeconds) {
  const minutes = Math.max(1, Math.round((expiresInSeconds || 600) / 60));
  return {
    from: fromAddress(),
    to,
    subject: 'Your Procucev Enterprise verification code',
    html: wrapEmail(
      'PROCUCEV ENTERPRISE',
      'Secure Sign-In Verification',
      `<p>Your one-time verification code is:</p>
       <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; margin: 20px 0; color: #0284c7;">${code}</p>
       <p style="font-size: 13px; color: #64748b; margin: 0;">This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}. If you did not request this, you can safely ignore this email.</p>`
    ),
  };
}

async function sendOtpEmail(to, code, expiresInSeconds) {
  return deliver(buildOtpEmail(to, code, expiresInSeconds), 'OTP email');
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
  const { rfq = {}, recipientName, buyerEmail, cc, freeCreditsRemaining, isSubscribed } = context;
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
  const subject = category
    ? `New RFQ ${rfq.rfqNumber} in ${category}`
    : `New RFQ ${rfq.rfqNumber}`;

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
    <p>${rfq.buyerAccountName ? `<strong>${rfq.buyerAccountName}</strong> has` : 'A buyer has'} raised a request for quotation your organisation is matched to.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('RFQ Number', rfq.rfqNumber)}
      ${row('Requirement', rfq.title)}
      ${row('Category', category)}
      ${row('Target delivery', rfq.targetDeliveryDate || rfq.deadline)}
      ${row('Delivery location', rfq.deliveryLocation)}
      ${budgetFormatted ? row('Budget', budgetFormatted) : ''}
    </table>
    ${
      itemRows
        ? `<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
             <thead><tr style="background: #f1f5f9; text-align: left;">
               <th style="padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 12px; color: #475569;">Item Description</th>
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
          : freeCreditsRemaining !== undefined
          ? `<div style="background: #f8fafc; border: 1px solid #cbd5e1; color: #334155; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 12px;">📊 <strong>Available Free Quotation Credits:</strong> ${freeCreditsRemaining} / 5 remaining.${freeCreditsRemaining === 0 ? ' <span style="color: #b91c1c; font-weight: bold;">(Plan upgrade required to submit quote)</span>' : ''}</div>`
          : ''
      }
      <h4 style="margin: 0 0 10px 0; color: #1e40af; font-size: 15px; font-weight: 700;">How to Submit Your Quotation</h4>
      <p style="margin: 0 0 10px 0; font-size: 13px; color: #1e293b; line-height: 1.5;">
        You can submit your bid either by <strong>replying directly to this email at <a href="mailto:${gatewayEmail}" style="color: #0284c7; font-weight: bold;">${gatewayEmail}</a></strong> (keep the subject line intact with RFQ number <strong>#${rfq.rfqNumber}</strong>${buyerCc ? ` and keep buyer CC'd: <strong>${buyerCc}</strong>` : ''}), or online via the Procucev Vendor Portal.
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
    <div style="text-align: center; margin: 24px 0;">
      <a href="${vendorSignInUrl()}" style="background: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 14px;">Open in Vendor Web Portal</a>
    </div>
    <p style="font-size: 13px; color: #64748b; text-align: center;">Sign in to your Procucev vendor account to review the full enquiry and submit a quotation.</p>
  `;

  return {
    from: vendorFromAddress(),
    to,
    replyTo: gatewayEmail,
    cc: buyerCc,
    subject,
    html: wrapEmail('PROCUCEV ENTERPRISE', 'New Sourcing Enquiry', inner),
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

function buildQuoteReceivedEmail(to, { rfq, quote, recipientName }) {
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
  return deliver(buildQuoteReceivedEmail(to, context), 'quote-received email');
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
  const base = process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${String(base).replace(/\/+$/, '')}/login`;
}

/** Where a supplier upgrades their subscription plan. */
function vendorUpgradeUrl() {
  const base = process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${String(base).replace(/\/+$/, '')}/vendor/vendor-subscription`;
}

/** Where a buyer registers or signs in. Configurable because it differs per deployment. */
function buyerPortalUrl() {
  const base = process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${String(base).replace(/\/+$/, '')}/login`;
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
}) {
  const buyer = buyerOrganizationName || 'A buyer on Procucev';
  const minorHtml = categoryList(minorCategories);

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p><strong>${buyer}</strong> has added your organisation to their vendor master and mapped your supply categories from your purchase order history with them.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('Buyer', buyer)}
      ${row('Your vendor code', vendorCode)}
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
    <p style="font-size: 13px; color: #64748b; margin: 0;">Sign in with this email address; a one-time verification code will be sent to it.</p>
  `;

  return {
    from: fromAddress(),
    to,
    subject: `${buyer} has mapped your supply categories${majorCategory ? ` — ${majorCategory}` : ''}`,
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
function buildVendorSelfMappingEmail({ to, recipientName, buyerOrganizationName, vendorCode }) {
  const buyer = buyerOrganizationName || 'A buyer on Procucev';

  const inner = `
    <p>${recipientName ? `Dear <strong>${recipientName}</strong>,` : 'Hello,'}</p>
    <p><strong>${buyer}</strong> has added your organisation to their vendor master on Procucev.</p>
    <p>No historical purchase order data was available for your organisation, so your supply categories could not be mapped automatically. <strong>To become eligible for relevant enquiries, please sign in and select the categories you supply.</strong></p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc;">
      ${row('Buyer', buyer)}
      ${row('Your vendor code', vendorCode)}
      ${row('Action required', 'Select your supply categories')}
    </table>
    <p style="margin: 20px 0;">
      <a href="${vendorSignInUrl()}" style="background: #0284c7; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Complete your category mapping</a>
    </p>
    <p style="font-size: 13px; color: #64748b; margin: 0;">Sign in with this email address; a one-time verification code will be sent to it. Until your categories are mapped, you will not be matched to enquiries.</p>
  `;

  return {
    from: fromAddress(),
    to,
    subject: 'Complete Your Category Mapping to Receive Enquiries',
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
            <td style="padding: 12px 0; color: #64748b; font-size: 13px; font-weight: 600;">Contact Number</td>
            <td style="padding: 12px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${contactPhone}</td>
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
  return Boolean(process.env.VENDOR_SMTP_USER && process.env.VENDOR_SMTP_PASSWORD);
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
  vendorUpgradeUrl,
  buildVendorCreditsExhaustedEmail,
  sendVendorCreditsExhaustedEmail,
  isConfigured,
  isVendorConfigured,
  isGmailApiConfigured,
};

