// ==============================================================================
// EMAIL-TO-RFQ INGESTION
// ==============================================================================
// Turns a real email message into the input POST /api/rfqs/extract already
// accepts, so an emailed requisition runs through exactly the same Gemini
// extraction, normalisation and taxonomy classification as one uploaded through
// the web portal. Nothing about the downstream pipeline changes.
//
// This module deliberately knows nothing about where the message came from. It
// parses a byte buffer, which is what an uploaded `.eml` gives us today and what
// a mailbox poller would give us later — the transport can be added without
// touching any of the logic here.
//
// WHAT IT DOES NOT DO: it does not parse spreadsheet attachments. `xlsx` is not a
// backend dependency on purpose. Its published advisories are prototype-pollution
// class, and an inbound mailbox would be feeding it attacker-controlled workbooks;
// that is a much worse position than the browser parsing a file the buyer chose
// themselves. A workbook attachment is reported by name so the buyer is told to
// send it through the BOQ upload tab, which flattens it client-side.
// ==============================================================================

const { simpleParser } = require('mailparser');
const { logger } = require('./loggerService');
const { EMAIL_INGESTION_CONFIG, EMAIL_INGESTION_STATUS } = require('../config/constants');

/** True when the file name looks like a message container this module handles. */
function isEmailFileName(fileName) {
  return EMAIL_INGESTION_CONFIG.EML_PATTERN.test(String(fileName || '').trim());
}

/**
 * True for Outlook's proprietary `.msg`.
 *
 * `.msg` is a Compound File Binary container, not RFC822, and mailparser cannot
 * read it. It is detected explicitly so the buyer gets told to export the message
 * as `.eml` instead of watching a silent failure — which is what happened before,
 * because the wizard's file picker offered `.msg` and then handed the bytes to
 * Gemini labelled `application/pdf`.
 */
function isOutlookMsgFileName(fileName) {
  return EMAIL_INGESTION_CONFIG.MSG_PATTERN.test(String(fileName || '').trim());
}

/** Collapse a mailparser address object into a bare lowercase address. */
function firstAddress(addressObject) {
  const entry = addressObject && Array.isArray(addressObject.value) ? addressObject.value[0] : null;
  const address = entry && typeof entry.address === 'string' ? entry.address.trim() : '';
  return address.toLowerCase();
}

/** Display name for an address, falling back to the local part of the address. */
function firstAddressName(addressObject, fallbackAddress) {
  const entry = addressObject && Array.isArray(addressObject.value) ? addressObject.value[0] : null;
  const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
  if (name) return name;
  return fallbackAddress ? fallbackAddress.split('@')[0] : '';
}

/**
 * Strip a quoted reply chain and signature block off the body.
 *
 * A forwarded requisition usually carries the whole thread beneath it. Feeding
 * that to the extractor pulls line items out of older revisions of the same
 * enquiry, so only the top-most message is kept.
 */
function stripQuotedReplies(text) {
  const lines = String(text || '').split(/\r?\n/);
  const cutAt = lines.findIndex((line) => EMAIL_INGESTION_CONFIG.QUOTE_MARKERS.some((marker) => marker.test(line)));
  const kept = cutAt === -1 ? lines : lines.slice(0, cutAt);
  return kept.join('\n').trim();
}

/**
 * Flatten an HTML body to text, preserving row and cell structure.
 *
 * Cells are joined with " | " to match the layout the extraction prompt describes
 * for flattened spreadsheets, so a BOQ in an HTML table reads the same way to the
 * extractor as one from an uploaded workbook.
 */
function flattenHtmlBody(html) {
  return String(html || '')
    .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/\s*t[dh]\s*>/gi, ' | ')
    .replace(/<\s*(br|\/p|\/div|\/tr|\/h[1-6]|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Last, so an escaped entity elsewhere cannot be double-decoded into a tag.
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\|\s*$/gm, '')
    .replace(/^\s+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Best available plain-text body.
 *
 * mailparser synthesises `text` from the HTML part when a message has no text
 * part, but that conversion drops table cell boundaries — "ACB 630A 4 Pole3 Nos"
 * instead of "ACB 630A 4 Pole | 3 Nos". A BOQ is precisely what arrives in a
 * table, and the quantity is what gets lost, so a table in the HTML wins over
 * mailparser's own flattening. Anything else prefers the authored text part.
 */
function resolveBodyText(parsed) {
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  const hasTabularMarkup = /<\s*table/i.test(html);
  if (!hasTabularMarkup && parsed.text && parsed.text.trim()) return parsed.text;
  if (html) return flattenHtmlBody(html);
  return typeof parsed.text === 'string' ? parsed.text : '';
}

/**
 * Classify an attachment into how it can contribute to extraction.
 *
 * - `text`   decoded inline and appended to the document text
 * - `inline` handed to Gemini as base64 (it reads PDFs and images natively)
 * - `manual` recognised but unreadable here; reported by name
 */
function classifyAttachment(attachment) {
  const contentType = String(attachment.contentType || '').toLowerCase();
  if (EMAIL_INGESTION_CONFIG.TEXT_ATTACHMENT_MIME_TYPES.includes(contentType)) return 'text';
  if (EMAIL_INGESTION_CONFIG.INLINE_ATTACHMENT_MIME_TYPES.includes(contentType)) return 'inline';
  return 'manual';
}

/** Extract list of lowercase email addresses from mailparser address object. */
function extractCcAddresses(addressObject) {
  if (!addressObject) return [];
  if (Array.isArray(addressObject.value)) {
    return addressObject.value
      .map((entry) => (entry && typeof entry.address === 'string' ? entry.address.trim().toLowerCase() : ''))
      .filter(Boolean);
  }
  if (typeof addressObject.text === 'string') {
    return addressObject.text
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function headerText(headers, name) {
  if (!headers || typeof headers.get !== 'function') return '';
  const value = headers.get(name);
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(' ');
  if (typeof value === 'object') return value.text || value.value || JSON.stringify(value);
  return String(value);
}

/**
 * Why a message was machine-generated, or null for mail a person sent.
 *
 * Decided from the standard headers automated senders set (RFC 3834
 * Auto-Submitted, Precedence, mailing-list headers, Microsoft's
 * X-Auto-Response-Suppress). An automatic reply must never be sent to such a
 * message: confirmed live, replying to newsletters and to an auto-forwarding
 * mailbox produced thousands of notices a day and exhausted the sending quota
 * that OTP mail depends on.
 */
function detectAutomatedMessage(headers) {
  const autoSubmitted = headerText(headers, 'auto-submitted').trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return `auto-submitted: ${autoSubmitted}`;
  const precedence = headerText(headers, 'precedence').trim().toLowerCase();
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) return `precedence: ${precedence}`;
  // mailparser folds every List-* header into one `list` entry ({ unsubscribe, id, ... }).
  if (headerText(headers, 'list') || headerText(headers, 'list-unsubscribe') || headerText(headers, 'list-id')) return 'mailing list';
  const suppress = headerText(headers, 'x-auto-response-suppress').toLowerCase();
  if (/\b(all|autoreply|oof)\b/.test(suppress)) return `x-auto-response-suppress: ${suppress}`;
  if (headerText(headers, 'x-autoreply') || headerText(headers, 'x-autorespond')) return 'auto-responder';
  return null;
}

function referencesText(value) {
  if (Array.isArray(value)) return value.join(' ');
  return typeof value === 'string' ? value : '';
}

/**
 * Parse a raw RFC822 message.
 *
 * Returns a plain description of the message. Throws nothing for a malformed
 * body — mailparser is tolerant and yields empty fields instead, which the caller
 * turns into a NO_CONTENT outcome.
 */
async function parseEmailMessage(rawBuffer) {
  const parsed = await simpleParser(rawBuffer, { skipImageLinks: true });

  const fromAddress = firstAddress(parsed.from);
  const attachments = (parsed.attachments || [])
    .filter((attachment) => attachment && attachment.content)
    .slice(0, EMAIL_INGESTION_CONFIG.MAX_ATTACHMENTS)
    .map((attachment) => ({
      fileName: String(attachment.filename || 'attachment').trim(),
      contentType: String(attachment.contentType || 'application/octet-stream').toLowerCase(),
      size: attachment.content.length,
      role: classifyAttachment(attachment),
      content: attachment.content,
    }));

  return {
    messageId: String(parsed.messageId || '').trim(),
    subject: String(parsed.subject || '').trim(),
    fromAddress,
    fromName: firstAddressName(parsed.from, fromAddress),
    toAddress: firstAddress(parsed.to),
    cc: extractCcAddresses(parsed.cc),
    sentAt: parsed.date instanceof Date ? parsed.date.toISOString() : null,
    bodyText: stripQuotedReplies(resolveBodyText(parsed)),
    attachments,
    // Threading headers: a vendor reply to an RFQ invite names the RFQ here
    // even when the vendor rewrote the subject.
    inReplyTo: String(parsed.inReplyTo || '').trim(),
    references: referencesText(parsed.references),
    automatedReason: detectAutomatedMessage(parsed.headers),
  };
}

/**
 * Compose the text handed to the extractor.
 *
 * Subject and sender are included because they routinely carry the project name
 * and the requesting site, which the extractor uses for the RFQ title when the
 * body itself only lists parts.
 */
function buildDocumentText(message) {
  const sections = [];
  if (message.subject) sections.push(`SUBJECT: ${message.subject}`);
  if (message.fromAddress) {
    sections.push(`FROM: ${message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress}`);
  }
  if (message.sentAt) sections.push(`SENT: ${message.sentAt}`);
  if (message.bodyText) sections.push(`\nBODY:\n${message.bodyText}`);

  message.attachments
    .filter((attachment) => attachment.role === 'text')
    .forEach((attachment) => {
      const decoded = attachment.content
        .toString('utf8')
        .slice(0, EMAIL_INGESTION_CONFIG.MAX_TEXT_ATTACHMENT_CHARS)
        .trim();
      if (decoded) sections.push(`\nATTACHMENT: ${attachment.fileName}\n${decoded}`);
    });

  return sections.join('\n').trim();
}

/**
 * Prepare an email for extraction.
 *
 * Resolves to `{ status, message?, extractionInput?, unreadableAttachments? }`.
 * A refusal is an expected outcome rather than an error: the wizard turns each
 * status into copy that names the recovery path.
 */
async function prepareEmailForExtraction({ fileName, content }) {
  if (isOutlookMsgFileName(fileName)) {
    return { status: EMAIL_INGESTION_STATUS.OUTLOOK_MSG_UNSUPPORTED };
  }
  if (!isEmailFileName(fileName)) {
    return { status: EMAIL_INGESTION_STATUS.NOT_AN_EMAIL };
  }

  // Not wrapped in a try: base64 decoding does not throw on malformed input, it
  // discards the invalid characters. A body that decodes to nothing usable is
  // caught by the length check below and, failing that, by the parse itself.
  const rawBuffer = Buffer.from(String(content || ''), 'base64');
  if (rawBuffer.length === 0) {
    return { status: EMAIL_INGESTION_STATUS.NO_CONTENT };
  }
  if (rawBuffer.length > EMAIL_INGESTION_CONFIG.MAX_BYTES) {
    return { status: EMAIL_INGESTION_STATUS.TOO_LARGE };
  }

  let message;
  try {
    // Called through the module object, like viewModule in db/view.js, so the
    // parse stays substitutable in tests rather than being bound at import time.
    message = await emailIngestion.parseEmailMessage(rawBuffer);
  } catch (err) {
    logger.warn('Email message could not be parsed', { fileName, error: err.message }, 'EMAIL_INGESTION');
    return { status: EMAIL_INGESTION_STATUS.UNREADABLE };
  }

  const documentText = buildDocumentText(message);
  // A PDF requisition attached to a covering note is the common shape, so the
  // first natively readable attachment is passed through as inline data.
  const inlineAttachment = message.attachments.find((attachment) => attachment.role === 'inline');
  const unreadableAttachments = message.attachments
    .filter((attachment) => attachment.role === 'manual')
    .map((attachment) => attachment.fileName);

  // Headers alone are not extractable. `documentText` always carries the subject
  // and sender, so testing it for emptiness would call a message with nothing but
  // headers ready and then send a guaranteed-fruitless request to the extractor.
  const hasExtractableContent =
    !!message.bodyText ||
    !!inlineAttachment ||
    message.attachments.some((attachment) => attachment.role === 'text');

  if (!hasExtractableContent) {
    return { status: EMAIL_INGESTION_STATUS.NO_CONTENT, unreadableAttachments };
  }

  logger.info(
    `Email prepared for extraction: ${message.attachments.length} attachment(s)`,
    {
      fileName,
      fromAddress: message.fromAddress,
      hasBody: !!message.bodyText,
      inlineAttachment: inlineAttachment ? inlineAttachment.fileName : null,
      unreadableAttachments,
    },
    'EMAIL_INGESTION'
  );

  return {
    status: EMAIL_INGESTION_STATUS.READY,
    message: {
      messageId: message.messageId,
      subject: message.subject,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      toAddress: message.toAddress,
      cc: message.cc || [],
      sentAt: message.sentAt,
      bodyText: message.bodyText || '',
      attachments: message.attachments || [],
      attachmentNames: message.attachments.map((attachment) => attachment.fileName),
      inReplyTo: message.inReplyTo || '',
      references: message.references || '',
      automatedReason: message.automatedReason || null,
    },
    extractionInput: {
      fileName,
      documentText: documentText || undefined,
      ...(inlineAttachment
        ? {
            inlineData: inlineAttachment.content.toString('base64'),
            mimeType: inlineAttachment.contentType,
          }
        : {}),
    },
    unreadableAttachments,
  };
}

// Mutable holder so a test can swap `parseEmailMessage` without re-requiring the
// module, and so prepareEmailForExtraction resolves it at call time.
const emailIngestion = {
  isEmailFileName,
  isOutlookMsgFileName,
  stripQuotedReplies,
  flattenHtmlBody,
  resolveBodyText,
  classifyAttachment,
  buildDocumentText,
  parseEmailMessage,
  prepareEmailForExtraction,
  extractCcAddresses,
  detectAutomatedMessage,
};

module.exports = emailIngestion;
