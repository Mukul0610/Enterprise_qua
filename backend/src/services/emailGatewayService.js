// ==============================================================================
// AUTONOMOUS EMAIL INGESTION GATEWAY
// ==============================================================================
// Watches a mailbox and turns inbound requisitions into RFQs without anyone
// uploading a file.
//
// It owns none of the parsing or extraction logic. A fetched message goes through
// exactly the same emailIngestionService -> geminiService -> rfqIngestionService
// path as an `.eml` a buyer uploads by hand, so there is one implementation of
// "read an email into line items" and both routes cannot drift.
//
// THREE DELIBERATE CONSTRAINTS, none of which are incidental:
//
//   1. The sender must resolve to an existing buyer account. This is both the
//      security control and a functional necessity — RFQs are scoped by
//      buyerAccountId, so a requisition from an unknown address has no owner and
//      would appear on nobody's dashboard. Without this check, anyone who learns
//      the intake address could inject RFQs and reach the vendor panel.
//   2. An ingested RFQ lands in 'Parsing' and is circulated to category-matched
//      vendors immediately, the same as a web-created RFQ.
//   3. Idempotence comes from our own ledger, not from the IMAP \Seen flag. See
//      db/emailGatewayQueries.js for why the flag alone is not enough.
// ==============================================================================

const emailIngestionService = require('./emailIngestionService');
const geminiService = require('./geminiService');
const rfqIngestionService = require('./rfqIngestionService');
const storeService = require('./storeService');
const rfqAttachmentService = require('./rfqAttachmentService');
const domainQueries = require('../db/domainQueries');
const mailerService = require('./mailerService');
const emailGatewayQueries = require('../db/emailGatewayQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const pool = require('../db/pool');
const { logger } = require('./loggerService');
const {
  EMAIL_GATEWAY_CONFIG,
  VENDOR_EMAIL_GATEWAY_CONFIG,
  EMAIL_GATEWAY_MESSAGES,
  EMAIL_GATEWAY_STATE,
  EMAIL_INGESTION_STATUS,
  resolveBuyerSourcingMode,
  SYSTEM_ACTOR_EMAIL,
  VENDOR_QUOTE_SUPPORT_CC,
} = require('../config/constants');

const { INGESTION_OUTCOME } = emailGatewayQueries;

// A poll that never clears its flag (a Gmail or Gemini call that hangs) must not
// block every later run on a warm Worker isolate. The flag only counts as held
// for this long; each external call is also bounded so a hang ends the poll.
//
// Live cron tails show the lock being SET and then nothing further logging for
// that cycle at all -- not even this timeout's own rejection -- which points at
// the platform's own cron invocation duration limit killing the isolate before
// a 60s timer ever fires, leaving withTimeout's setTimeout (and the `finally`
// that clears the lock) orphaned. Lowered well under that ceiling so our own
// timeout wins the race and actually logs the real Gmail error instead of
// going silent.
const POLL_STALE_AFTER_MS = 2 * 60 * 1000;
const POLL_CALL_TIMEOUT_MS = 20 * 1000;
// Gemini gets longer than the other calls: it retries across models inside its
// own budget, and a 20s cap cut off ordinary extractions mid-answer (live:
// "Gemini line-item extraction timed out after 20000ms" on a plain requisition).
const EXTRACTION_TIMEOUT_MS = 45 * 1000;
// No new message is started once a poll has run this long, so a poll that hits
// slow extractions still ends well inside POLL_STALE_AFTER_MS (worst case ≈
// this + one message fetch + one extraction + creation) and never overlaps the
// next cron run. Whatever is left stays unread for the next poll.
const POLL_WORK_BUDGET_MS = 30 * 1000;
// A message whose processing throws is retried on this many polls before it is
// recorded as FAILED and marked read.
const EMAIL_GATEWAY_MAX_ATTEMPTS = 3;
// Unread messages already in the ledger are skipped without using up
// maxPerPoll, so a poll may page past them — bounded so one run stays short.
const EMAIL_GATEWAY_MAX_LIST_PAGES = 5;
const EMAIL_GATEWAY_LEDGER_UNAVAILABLE = 'LEDGER_UNAVAILABLE';

/** The Message-ID header of a raw RFC 822 message, angle brackets included, or ''. */
function extractHeaderMessageId(rawSource) {
  const text = Buffer.isBuffer(rawSource) ? rawSource.toString('utf8') : String(rawSource || '');
  const headerEnd = text.search(/\r?\n\r?\n/);
  const headers = (headerEnd === -1 ? text : text.slice(0, headerEnd)).replace(/\r?\n[ \t]+/g, ' ');
  const match = headers.match(/^message-id:\s*(<[^>\s]+>)/im);
  return match ? match[1] : '';
}

function pollInFlight(state) {
  return state.isPolling && Date.now() - state.pollStartedAt < POLL_STALE_AFTER_MS;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Live state, reported by getStatus and mutated only by the poll loop. */
const runtime = {
  pollTimer: null,
  isPolling: false,
  pollStartedAt: 0,
  // Mail older than this is never considered. Set when watching begins so an
  // existing backlog is left alone; see the search call in pollOnce.
  watchingSince: new Date().toISOString(),
  lastPollAt: null,
  lastPollDurationMs: null,
  lastError: null,
  lastConnectedAt: null,
  consideredThisRun: 0,
  ingestedThisRun: 0,
};

/** Live state for dedicated vendor quotation mailbox watcher (srinu20252026@gmail.com). */
const vendorRuntime = {
  pollTimer: null,
  isPolling: false,
  pollStartedAt: 0,
  watchingSince: new Date().toISOString(),
  lastPollAt: null,
  lastPollDurationMs: null,
  lastError: null,
  lastConnectedAt: null,
  consideredThisRun: 0,
  ingestedThisRun: 0,
};

/**
 * Resolve gateway configuration from the environment.
 *
 * Read on every call rather than captured at import, so a test can vary it and so
 * a deployment does not need a restart to change the allow-list.
 */
function resolveConfig(env = process.env) {
  const splitList = (value) =>
    String(value || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

  return {
    enabled: String(env.EMAIL_GATEWAY_ENABLED || '').toLowerCase() === 'true',
    // The Gmail API login — an operational credential, not what a buyer
    // needs to know. IMAP support was removed: Cloudflare Workers cannot
    // hold an IMAP socket open, so the Gmail REST API (GMAIL_* in
    // mailerService) is the only inbound transport.
    user: (env.EMAIL_GATEWAY_USER || '').trim(),
    // The Procucev intake address buyers actually send their requisition TO.
    // Kept separate from the IMAP login because the two are different things and
    // routinely differ: mail addressed to an alias or shared mailbox such as
    // client@procucev.com can be collected by a login of intake@procucev.com.
    // Conflating them is what put a personal Gmail login in front of buyers as
    // though it were the address to forward requisitions to.
    address: (env.EMAIL_GATEWAY_ADDRESS || env.EMAIL_GATEWAY_USER || EMAIL_GATEWAY_CONFIG.DEFAULT_GATEWAY_ADDRESS).trim(),
    mailbox: (env.EMAIL_GATEWAY_MAILBOX || 'INBOX').trim(),
    pollIntervalMs: Math.max(
      Number(env.EMAIL_GATEWAY_POLL_MS || EMAIL_GATEWAY_CONFIG.DEFAULT_POLL_MS),
      EMAIL_GATEWAY_CONFIG.MIN_POLL_MS
    ),
    maxPerPoll: Math.max(Number(env.EMAIL_GATEWAY_MAX_PER_POLL || EMAIL_GATEWAY_CONFIG.DEFAULT_MAX_PER_POLL), 1),
    // Optional extra restriction on top of the buyer-account requirement.
    allowedDomains: splitList(env.EMAIL_GATEWAY_ALLOWED_DOMAINS),
    allowedSenders: splitList(env.EMAIL_GATEWAY_ALLOWED_SENDERS),
  };
}

/**
 * Resolve vendor gateway configuration from the environment (srinu20252026@gmail.com).
 */
function resolveVendorConfig(env = process.env) {
  const splitList = (value) =>
    String(value || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

  return {
    enabled: String(
      env.VENDOR_EMAIL_GATEWAY_ENABLED !== undefined
        ? env.VENDOR_EMAIL_GATEWAY_ENABLED
        : env.EMAIL_GATEWAY_ENABLED || 'true'
    ).toLowerCase() === 'true',
    // IMAP support was removed — see resolveConfig()'s comment. The vendor
    // mailbox is read exclusively via the vendor Gmail REST API identity
    // (VENDOR_GMAIL_* in mailerService).
    user: (env.VENDOR_EMAIL_GATEWAY_USER || 'srinu20252026@gmail.com').trim(),
    address: (
      env.VENDOR_EMAIL_GATEWAY_ADDRESS ||
      env.VENDOR_EMAIL_GATEWAY_USER ||
      'srinu20252026@gmail.com'
    ).trim(),
    mailbox: (env.VENDOR_EMAIL_GATEWAY_MAILBOX || 'INBOX').trim(),
    pollIntervalMs: Math.max(
      Number(
        env.VENDOR_EMAIL_GATEWAY_POLL_MS ||
        env.EMAIL_GATEWAY_POLL_MS ||
        EMAIL_GATEWAY_CONFIG.DEFAULT_POLL_MS
      ),
      EMAIL_GATEWAY_CONFIG.MIN_POLL_MS
    ),
    maxPerPoll: Math.max(
      Number(
        env.VENDOR_EMAIL_GATEWAY_MAX_PER_POLL ||
        env.EMAIL_GATEWAY_MAX_PER_POLL ||
        EMAIL_GATEWAY_CONFIG.DEFAULT_MAX_PER_POLL
      ),
      1
    ),
    allowedSenders: splitList(env.VENDOR_EMAIL_GATEWAY_ALLOWED_SENDERS || env.EMAIL_GATEWAY_ALLOWED_SENDERS),
    allowedDomains: splitList(env.VENDOR_EMAIL_GATEWAY_ALLOWED_DOMAINS || env.EMAIL_GATEWAY_ALLOWED_DOMAINS),
    isVendorMailbox: true,
  };
}

/** True when enough is configured to attempt a connection. */
function isConfigured(config = resolveConfig()) {
  // Each mailbox has its own Gmail API identity (buyer: GMAIL_*, vendor:
  // VENDOR_GMAIL_*) — checking the wrong one would report the vendor
  // gateway as configured just because the buyer's Gmail API happens to be
  // set up, or vice versa. The Gmail REST API is the only transport now
  // (IMAP support removed — see resolveConfig()'s comment).
  return config.isVendorMailbox
    ? mailerService.isVendorGmailApiConfigured()
    : mailerService.isGmailApiConfigured();
}

/**
 * Catch a misconfiguration that cannot be diagnosed from the API error.
 * Returns a message, or null when nothing is obviously wrong. Reserved for
 * a future Gmail-API-specific check (e.g. insufficient scope); nothing to
 * catch here today since isConfigured() already reports missing credentials.
 */
function describeConfigurationFault() {
  return null;
}

/**
 * Which of the four states the panel should show.
 *
 * A configuration fault counts as a connection error even before a connection has
 * been attempted, because the outcome is already known and the buyer needs to be
 * told the gateway is not going to work.
 */
function resolveConnectionState(config, { lastError, watching } = {}) {
  if (!isConfigured(config)) return EMAIL_GATEWAY_STATE.NOT_CONFIGURED;
  if (describeConfigurationFault(config)) return EMAIL_GATEWAY_STATE.CONNECTION_ERROR;
  if (!config.enabled) return EMAIL_GATEWAY_STATE.SWITCHED_OFF;
  if (lastError) return EMAIL_GATEWAY_STATE.CONNECTION_ERROR;
  if (watching) return EMAIL_GATEWAY_STATE.ACTIVE_LISTENING;
  return EMAIL_GATEWAY_STATE.SWITCHED_OFF;
}

/**
 * May a requisition from this address be ingested?
 *
 * Order matters. An explicit sender allow-list, when set, is the whole rule — that
 * is the tightest configuration and it should not be widened by the account lookup
 * below. Otherwise the address must belong to a buyer account, optionally narrowed
 * further to a set of domains.
 *
 * Returns `{ allowed, reason, buyerAccount }`. `buyerAccount` is needed by the
 * caller regardless, to scope the RFQ.
 */
async function resolveSenderAuthorisation(fromAddress, config = resolveConfig()) {
  const address = String(fromAddress || '').trim().toLowerCase();
  if (!address) {
    return { allowed: false, reason: EMAIL_GATEWAY_MESSAGES.SENDER_MISSING, buyerAccount: null };
  }

  const buyerAccount = (await storeService.getBuyerAccountByEmail(address)) || null;
  const allowedSenders = Array.isArray(config && config.allowedSenders) ? config.allowedSenders : [];
  const allowedDomains = Array.isArray(config && config.allowedDomains) ? config.allowedDomains : [];

  if (allowedSenders.length > 0) {
    if (!allowedSenders.includes(address)) {
      return {
        allowed: false,
        reason: EMAIL_GATEWAY_MESSAGES.SENDER_NOT_LISTED.replace('{address}', address),
        buyerAccount,
      };
    }
    // Still needs an owning account: an RFQ with no buyerAccountId is invisible.
    if (!buyerAccount) {
      return {
        allowed: false,
        reason: EMAIL_GATEWAY_MESSAGES.SENDER_NO_ACCOUNT.replace('{address}', address),
        buyerAccount: null,
      };
    }
    return { allowed: true, reason: null, buyerAccount };
  }

  if (allowedDomains.length > 0) {
    const domain = address.split('@')[1] || '';
    if (!allowedDomains.includes(domain)) {
      return {
        allowed: false,
        reason: EMAIL_GATEWAY_MESSAGES.DOMAIN_NOT_LISTED.replace('{domain}', domain || address),
        buyerAccount,
      };
    }
  }

  if (!buyerAccount) {
    return {
      allowed: false,
      reason: EMAIL_GATEWAY_MESSAGES.SENDER_NO_ACCOUNT.replace('{address}', address),
      buyerAccount: null,
    };
  }

  return { allowed: true, reason: null, buyerAccount };
}

/**
 * Resolves the registered buyer's default delivery location (city, state, pincode)
 * dynamically from the validated buyer account or linked organization profile.
 */
async function resolveBuyerRegisteredLocation(buyerAccount) {
  if (!buyerAccount) {
    return { city: '', state: '', pincode: '' };
  }

  // 1. Direct fields on buyerAccount (in-memory or store service account object)
  const directCity = buyerAccount.city || buyerAccount.deliveryCity || '';
  const directState = buyerAccount.state || buyerAccount.deliveryState || '';
  const directPincode = buyerAccount.pincode || buyerAccount.zipCode || buyerAccount.deliveryPincode || '';

  if (directCity || directState || directPincode) {
    return {
      city: String(directCity).trim(),
      state: String(directState).trim(),
      pincode: String(directPincode).trim(),
    };
  }

  // 2. Query Neon PostgreSQL buyer profile if pool is active and buyer has corporateEmail
  if (pool && pool.pool && buyerAccount.corporateEmail) {
    try {
      const email = String(buyerAccount.corporateEmail).trim().toLowerCase();
      const rows = await pool.rows(
        `${buyerProfileQueries.PROFILE_SELECT} where lower(u.username) = lower($1) or lower(u.email) = lower($1) limit 1`,
        [email]
      );
      if (rows.length > 0) {
        const mapped = buyerProfileQueries.mapRowToProfile(rows[0]);
        if (mapped) {
          return {
            city: mapped.city || '',
            state: mapped.state || '',
            pincode: mapped.pincode || '',
          };
        }
      }
    } catch (dbErr) {
      logger.error('Failed to query buyer profile for location fallback', dbErr, 'EMAIL_GATEWAY');
    }
  }

  return { city: '', state: '', pincode: '' };
}

/**
 * Processes extracted line items, applies deterministic defaults (delivery date and location),
 * and groups items by (delivery_date + delivery_city + delivery_state + delivery_pincode).
 *
 * @param {Array<Object>} lineItems Extracted line items from geminiService
 * @param {Object} extraction Document-level extraction metadata
 * @param {Object} buyerLocation Registered buyer location ({ city, state, pincode })
 * @returns {Array<{ groupKey: string, targetDate: string, deliveryCity: string, deliveryState: string, deliveryPincode: string, deliveryLocation: string, items: Array<Object> }>}
 */
function processLineItemsAndGroups(lineItems, extraction = {}, buyerLocation = {}) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const defaultDate = rfqIngestionService.defaultTargetDate(5);

  const groupsMap = new Map();

  items.forEach((item) => {
    // 1. Delivery Date: Explicit on item -> Explicit on document -> Default (today + 5 days)
    const rawTargetDate =
      item.targetDate ||
      item.deliveryDate ||
      item.delivery_date ||
      extraction.deliveryDate ||
      extraction.targetDeliveryDate;

    const targetDate = String(rawTargetDate || defaultDate).trim();

    // 2. Location Handling:
    const explicitCity = String(item.deliveryCity || item.delivery_city || extraction.deliveryCity || '').trim();
    const explicitState = String(item.deliveryState || item.delivery_state || extraction.deliveryState || '').trim();
    const explicitPincode = String(item.deliveryPincode || item.delivery_pincode || extraction.deliveryPincode || '').trim();
    const explicitLocation = String(item.deliveryLocation || item.delivery_location || extraction.deliveryLocation || '').trim();

    let deliveryCity = explicitCity;
    let deliveryState = explicitState;
    let deliveryPincode = explicitPincode;
    let deliveryLocation = explicitLocation;

    const hasExplicitLocation = Boolean(explicitCity || explicitState || explicitPincode || explicitLocation);

    if (!hasExplicitLocation) {
      // Entirely missing: apply registered buyer's default delivery location
      deliveryCity = buyerLocation.city || '';
      deliveryState = buyerLocation.state || '';
      deliveryPincode = buyerLocation.pincode || '';
      deliveryLocation = [deliveryCity, deliveryState, deliveryPincode].filter(Boolean).join(', ');
    } else {
      // Partial location handling: preserve explicit fields without replacing them with buyer defaults
      if (!deliveryCity && deliveryLocation) {
        deliveryCity = deliveryLocation;
      }
      if (!deliveryLocation) {
        deliveryLocation = [deliveryCity, deliveryState, deliveryPincode].filter(Boolean).join(', ');
      }
    }

    const processedItem = {
      ...item,
      targetDate,
      deliveryCity,
      deliveryState,
      deliveryPincode,
      deliveryLocation,
    };

    // Group key: (delivery_date + delivery_city + delivery_state + delivery_pincode)
    const groupKey = [
      targetDate,
      deliveryCity.toLowerCase(),
      deliveryState.toLowerCase(),
      deliveryPincode.toLowerCase(),
    ].join('|');

    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        groupKey,
        targetDate,
        deliveryCity,
        deliveryState,
        deliveryPincode,
        deliveryLocation,
        items: [],
      });
    }

    groupsMap.get(groupKey).items.push(processedItem);
  });

  return Array.from(groupsMap.values());
}

/**
 * Detects a mail-system bounce/auto-reply (a delivery-failure notice for
 * something the gateway itself sent), so it is never mistaken for a genuine
 * unauthorized sender.
 *
 * This matters beyond mislabeling: treating a bounce as an unauthorized
 * sender makes resolveSenderAuthorisation's rejection path fire another
 * outbound "unauthorized buyer" notification email BACK to the bounce
 * address — which bounces again, generating another copy of the same
 * message. Confirmed live: since SENDER_NOT_ALLOWED is deliberately never
 * marked read (so a human can review a genuine unauthorized sender), an
 * unrecognized bounce is never marked read either, so the exact same
 * handful of bounce messages got reprocessed and re-notified on every
 * single poll cycle indefinitely — sending far more mail than any real
 * traffic would, which is what actually rate-limited the Gmail API account
 * this ran under, blocking every other outbound/poll operation behind it.
 */
function isBounceOrAutoReplyMessage(message) {
  if (!message) return false;
  const fromAddress = String(message.fromAddress || '').trim().toLowerCase();
  if (/^(postmaster|mailer-daemon|mail-daemon|bounce[s]?)@/.test(fromAddress)) return true;
  const subject = String(message.subject || '').trim().toLowerCase();
  if (/^(undeliverable|delivery status notification|mail delivery failed|returned mail|failure notice)/.test(subject)) {
    return true;
  }
  return false;
}

/**
 * Extract referenced RFQ number and lookup target RFQ from subject, body, or thread references.
 */
async function extractRfqReferenceFromEmail(message) {
  if (!message) return { targetRfq: null, referencedNumber: null };
  const sources = [
    message.subject || '',
    message.bodyText || '',
    message.textBody || '',
    message.text || '',
    message.inReplyTo || '',
    message.references || '',
  ].join(' ');

  const rfqRegex = /#?(RFQ[-\w\d]+)/gi;
  const rawMatches = [];
  let m;
  while ((m = rfqRegex.exec(sources)) !== null) {
    rawMatches.push(m[1]);
  }
  if (rawMatches.length === 0) return { targetRfq: null, referencedNumber: null };

  const candidates = [];
  for (const raw of rawMatches) {
    const trimmed = raw.trim();
    const standardMatch = trimmed.match(/RFQ-?\d{4}-\d{4,6}/i) || trimmed.match(/RFQ\d{10,14}/i);
    if (standardMatch) {
      candidates.push(standardMatch[0].toUpperCase());
    }
    const stripped = trimmed.replace(/-(?:dispatch|reply|notification|mailer|inbound|gateway|update)$/i, '');
    candidates.push(stripped.toUpperCase());
    candidates.push(trimmed.toUpperCase());
  }

  // getRFQByIdAsync, not the plain in-memory getRFQById — the same Workers
  // isolate-cache-staleness bug fixed in rfqController.addQuote applies here
  // too: confirmed live, a vendor's quote-reply email referencing a real,
  // currently-open RFQ number came back INVALID_RFQ ("was not found in the
  // system") on whichever isolate the cron tick happened to run on, purely
  // because that isolate hadn't hydrated that particular RFQ.
  for (const cand of candidates) {
    const foundRfq = await storeService.getRFQByIdAsync(cand);
    if (foundRfq) return { targetRfq: foundRfq, referencedNumber: foundRfq.rfqNumber || cand };
  }
  return { targetRfq: null, referencedNumber: (candidates[0] || rawMatches[0].trim()).toUpperCase() };
}

/**
 * Detects whether an email is outbound or sent from the platform itself,
 * so it is never treated as an inbound requisition or vendor quotation reply.
 */
function isOutgoingSystemMessage(message, config = {}) {
  if (!message || !message.fromAddress) return false;
  const senderEmail = String(message.fromAddress).trim().toLowerCase();
  const normalizeAddress = (value) => {
    const address = String(value || '').trim().match(/<\s*([^<>]+)\s*>/);
    return (address ? address[1] : String(value || '')).trim().toLowerCase();
  };
  const platformSenders = [
    config.user,
    config.address,
    process.env.EMAIL_GATEWAY_USER,
    process.env.EMAIL_GATEWAY_ADDRESS,
    process.env.SMTP_USER,
    process.env.SMTP_FROM,
    process.env.GMAIL_SENDER_EMAIL,
    process.env.VENDOR_EMAIL_GATEWAY_USER,
    process.env.VENDOR_EMAIL_GATEWAY_ADDRESS,
    process.env.VENDOR_SMTP_USER,
    process.env.VENDOR_SMTP_FROM,
    process.env.VENDOR_GMAIL_SENDER_EMAIL,
    process.env.QUOTE_ALERT_GMAIL_SENDER_EMAIL,
    'srinu20252026@gmail.com',
    'rfqprocucev@gmail.com',
  ]
    .map(normalizeAddress)
    .filter(Boolean);

  return platformSenders.includes(senderEmail);
}

/**
 * Detects whether an email address is an automated robot / system address
 * (e.g. Google security alerts, mailer-daemon, noreply) that must NEVER be
 * sent an unauthorized registration notification.
 */
function isSystemOrAutomatedSender(email) {
  if (!email) return false;
  const lower = String(email).trim().toLowerCase();
  const [localPart = '', domain = ''] = lower.split('@');
  return (
    AUTOMATED_LOCAL_PART_PATTERN.test(localPart) ||
    AUTOMATED_SUBDOMAIN_PATTERN.test(domain) ||
    lower.endsWith('@accounts.google.com') ||
    lower.endsWith('@google.com') ||
    lower.endsWith('@notifications.google.com') ||
    lower.endsWith('@googlemail.com')
  );
}

// Mailboxes no person reads: no-reply@, notifications@, newsletter@, bounces+x@ ...
const AUTOMATED_LOCAL_PART_PATTERN =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|mail[-_.]?daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletters?|news|updates|digest|marketing|automated|auto[-_.]?confirm)([-+_.].*)?$/;
// Bulk-sending subdomains: news.fly.io, messages.mongodb.com, updates.miro.com ...
const AUTOMATED_SUBDOMAIN_PATTERN = /^(email|messages?|updates?|news|newsletters?|notifications?|alerts?|marketing|bounces?|mailer)\.[^.]+\.[^.]+/;

/** Kinds of automatic reply the gateway sends, each with its own guard window. */
const AUTO_REPLY_KIND = {
  UNAUTHORIZED_SENDER: 'UNAUTHORIZED_SENDER',
  QUOTE_FAILURE: 'QUOTE_FAILURE',
  VENDOR_ISSUE: 'VENDOR_ISSUE',
  CREDITS_EXHAUSTED: 'CREDITS_EXHAUSTED',
  PORTAL_REDIRECT: 'PORTAL_REDIRECT',
  QUOTE_ACK: 'QUOTE_ACK',
  RFQ_ACK: 'RFQ_ACK',
  RFQ_NOT_CREATED: 'RFQ_NOT_CREATED',
};

// The ledger status each notice kind is recorded under, the window, and how many
// notices one sender may get inside it. An unregistered sender gets one a day.
// A vendor notice is per RFQ and allows a few, because a vendor who replies to
// it without fixing the problem should be told again — the cap only stops a
// machine loop (one a minute) from becoming sixty an hour. Acknowledgements of
// real work have no cap.
const VENDOR_NOTICE_LIMIT = { windowMs: 60 * 60 * 1000, maxPerWindow: 3, perRfq: true };
const AUTO_REPLY_COOLDOWN = {
  [AUTO_REPLY_KIND.UNAUTHORIZED_SENDER]: {
    statuses: [INGESTION_OUTCOME.SENDER_NOT_ALLOWED],
    windowMs: 24 * 60 * 60 * 1000,
    maxPerWindow: 1,
    perRfq: false,
  },
  [AUTO_REPLY_KIND.QUOTE_FAILURE]: { statuses: [INGESTION_OUTCOME.QUOTE_VALIDATION_FAILED], ...VENDOR_NOTICE_LIMIT },
  [AUTO_REPLY_KIND.VENDOR_ISSUE]: { statuses: [INGESTION_OUTCOME.QUOTE_VALIDATION_FAILED], ...VENDOR_NOTICE_LIMIT },
  [AUTO_REPLY_KIND.CREDITS_EXHAUSTED]: { statuses: [INGESTION_OUTCOME.CREDITS_EXHAUSTED], ...VENDOR_NOTICE_LIMIT },
  [AUTO_REPLY_KIND.PORTAL_REDIRECT]: { statuses: [INGESTION_OUTCOME.PORTAL_SUBMISSION_REQUIRED], ...VENDOR_NOTICE_LIMIT },
  // A registered buyer is told each time an email of theirs did not become an
  // RFQ, up to a few an hour — enough for someone correcting and resending,
  // not enough for a machine loop.
  [AUTO_REPLY_KIND.RFQ_NOT_CREATED]: {
    statuses: [
      INGESTION_OUTCOME.NO_LINE_ITEMS,
      INGESTION_OUTCOME.LINE_ITEMS_EXCEED_LIMIT,
      INGESTION_OUTCOME.RFQ_CREDITS_EXHAUSTED,
    ],
    windowMs: 60 * 60 * 1000,
    maxPerWindow: 3,
    perRfq: false,
  },
};

// Subjects of the gateway's own notices. Mail arriving with one of these (or a
// Re:/Fwd: of it) is our notice coming back — answering it is how the
// rfq@procucev.com loop sent ~2,000 notices a day.
const OWN_NOTICE_SUBJECT_PREFIXES = [
  'enterprise qua - buyer registration required',
  'action required – quotation could not be processed',
  'action required – 5 free quotation credits exhausted',
  'portal bidding required for rfq',
  'inquiry logged for rfq',
  'action required: category mismatch',
  'action required – your rfq email could not be processed',
  'great news! your requirement has been converted into rfq',
];

const recentAutoReplies = new Map();

function stripReplyPrefixes(subject) {
  return String(subject || '')
    .trim()
    .replace(/^((re|fw|fwd|aw|wg|sv|antw)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();
}

function isOwnNoticeSubject(subject) {
  const stripped = stripReplyPrefixes(subject);
  return OWN_NOTICE_SUBJECT_PREFIXES.some((prefix) => stripped.startsWith(prefix));
}

/** Domains the platform itself sends from (PLATFORM_EMAIL_DOMAINS, default procucev.com). */
function platformDomains() {
  return String(process.env.PLATFORM_EMAIL_DOMAINS || 'procucev.com')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Decide whether an automatic reply may be sent for this inbound message.
 *
 * Every guard exists because its absence caused a live mail storm:
 *   - automated senders and mail carrying auto-submitted / mailing-list headers
 *     never get a reply (newsletters were answered every minute);
 *   - our own notices coming back are never answered (the rfq@procucev.com loop);
 *   - the platform's own domain never gets an "unregistered sender" notice;
 *   - one notice per sender (and RFQ) per window, checked against the ledger so
 *     it holds across Worker isolates, plus an in-memory check for bursts inside
 *     one poll before the ledger row is written.
 *
 * Fails closed: when the ledger cannot be read, the notice is skipped — losing
 * one notice is harmless, an unbounded loop is not.
 */
async function shouldSendAutoReply(message, kind, { rfqNumber = null, config = {} } = {}) {
  const from = String((message && message.fromAddress) || '').trim().toLowerCase();
  if (!from) return { allowed: false, reason: 'no sender address' };
  if (isSystemOrAutomatedSender(from)) return { allowed: false, reason: 'automated sender address' };
  if (isOutgoingSystemMessage(message, config)) return { allowed: false, reason: 'platform sender' };
  if (message.automatedReason) return { allowed: false, reason: `automated message (${message.automatedReason})` };

  const cooldown = AUTO_REPLY_COOLDOWN[kind];
  if (!cooldown) return { allowed: true };

  if (kind === AUTO_REPLY_KIND.UNAUTHORIZED_SENDER || kind === AUTO_REPLY_KIND.RFQ_NOT_CREATED) {
    // A buyer answering our acknowledgement ("Re: Great news! ... RFQ #123 —
    // thanks") has no line items in it; that is not a failed RFQ to report.
    if (isOwnNoticeSubject(message.subject)) return { allowed: false, reason: 'reply to our own notice' };
  }
  if (kind === AUTO_REPLY_KIND.UNAUTHORIZED_SENDER) {
    if (platformDomains().includes(from.split('@')[1])) return { allowed: false, reason: 'platform domain' };
  }

  const now = Date.now();
  const memoryKey = `${kind}|${from}|${cooldown.perRfq ? rfqNumber || '' : ''}`;
  const sentInWindow = (recentAutoReplies.get(memoryKey) || []).filter((sentAt) => now - sentAt < cooldown.windowMs);
  if (sentInWindow.length >= cooldown.maxPerWindow) {
    return { allowed: false, reason: 'notice limit reached for this sender' };
  }

  try {
    const recent = await emailGatewayQueries.countRecentOutcomes({
      fromAddress: from,
      statuses: cooldown.statuses,
      rfqNumber: cooldown.perRfq ? rfqNumber : null,
      since: new Date(now - cooldown.windowMs),
    });
    if (recent >= cooldown.maxPerWindow) return { allowed: false, reason: 'notice limit reached for this sender' };
  } catch (err) {
    logger.warn('Auto-reply cooldown could not be checked — skipping the notice', { errorMessage: err.message, kind }, 'EMAIL_GATEWAY');
    return { allowed: false, reason: 'cooldown unavailable' };
  }

  recentAutoReplies.set(memoryKey, [...sentInWindow, now]);
  if (recentAutoReplies.size > 5000) recentAutoReplies.clear();
  return { allowed: true };
}

/**
 * Send one automatic reply if the guards allow it; never throws. Returns true
 * when the reply was handed to the mailer.
 */
async function sendAutoReply(message, kind, send, { rfqNumber = null, config = {}, failureLog } = {}) {
  const decision = await emailGateway.shouldSendAutoReply(message, kind, { rfqNumber, config });
  if (!decision.allowed) {
    logger.info(
      `Auto-reply ${kind} suppressed for ${message && message.fromAddress}: ${decision.reason}`,
      { subject: message && message.subject, rfqNumber },
      'EMAIL_GATEWAY'
    );
    return false;
  }
  try {
    await send();
    return true;
  } catch (mailErr) {
    logger.error(failureLog || `Failed to send ${kind} auto-reply`, mailErr, 'EMAIL_GATEWAY');
    return false;
  }
}

// A pending acknowledgement older than this is dropped: by then the buyer has
// long since seen the RFQ (or asked about it), and a late "Great news!" confuses.
const ACK_RETRY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const ACK_RETRIES_PER_POLL = 5;

/**
 * Keep an acknowledgement that could not be sent, so a later poll retries it.
 * Before this, a failed send was only logged — every buyer whose RFQ was raised
 * while mail was down never heard back at all.
 */
async function queueAcknowledgement(rfqKey, ack) {
  if (!rfqKey) return;
  await emailGatewayQueries.recordProcessed({
    messageId: `${rfqKey}#ack`,
    status: INGESTION_OUTCOME.ACK_PENDING,
    detail: JSON.stringify({ buyerName: ack.buyerName, rfqTitle: ack.rfqTitle }),
    fromAddress: ack.to,
    subject: ack.rfqTitle,
    rfqNumber: ack.rfqNumber,
  });
}

/** Ledger timestamps are `YYYY-MM-DD HH:MM:SS` UTC (D1) or a Date (Postgres). */
function ledgerTime(value) {
  if (value instanceof Date) return value.getTime();
  return new Date(`${String(value || '').replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(value || '')) ? '' : 'Z'}`).getTime();
}

/**
 * Retry acknowledgements that could not be sent earlier. Bounded per poll and
 * never throws: an acknowledgement must not hold up reading new mail.
 */
async function retryPendingAcknowledgements({ limit = ACK_RETRIES_PER_POLL, now = Date.now() } = {}) {
  const outcome = { sent: 0, abandoned: 0, stillPending: 0 };
  const rows = await emailGatewayQueries.listByStatus(INGESTION_OUTCOME.ACK_PENDING, limit);
  for (const row of rows) {
    const record = (status, detail) =>
      emailGatewayQueries.recordProcessed({
        messageId: row.message_id,
        status,
        detail,
        fromAddress: row.from_address,
        subject: row.subject,
        rfqNumber: row.rfq_number,
      });

    const queuedAt = ledgerTime(row.processed_at);
    if (!row.from_address || !Number.isFinite(queuedAt) || now - queuedAt > ACK_RETRY_MAX_AGE_MS) {
      await record(INGESTION_OUTCOME.ACK_ABANDONED, 'Acknowledgement not sent within 48 hours; dropped');
      outcome.abandoned += 1;
      continue;
    }

    let saved = {};
    try {
      saved = JSON.parse(row.detail || '{}') || {};
    } catch {
      saved = {};
    }
    try {
      await mailerService.sendRfqAcknowledgementEmail({
        to: row.from_address,
        buyerName: saved.buyerName,
        rfqNumber: row.rfq_number,
        rfqTitle: saved.rfqTitle || row.subject,
      });
      await record(INGESTION_OUTCOME.ACK_SENT, 'Acknowledgement sent on retry');
      outcome.sent += 1;
    } catch (err) {
      outcome.stillPending += 1;
      // Every provider is paused: nothing else in this batch can go out either.
      if (err && err.code === 'MAIL_PROVIDERS_COOLING_DOWN') break;
    }
  }
  if (outcome.sent || outcome.abandoned) {
    logger.info('Pending RFQ acknowledgements retried', outcome, 'EMAIL_GATEWAY');
  }
  return outcome;
}

/** Gemini outcomes that say nothing about the email, only that extraction could not run right now. */
function isRetryableExtraction(status) {
  const { AI_FAILED, QUOTA_EXCEEDED, NOT_CONFIGURED } = geminiService.EXTRACTION_STATUS;
  return status === AI_FAILED || status === QUOTA_EXCEEDED || status === NOT_CONFIGURED;
}

/**
 * Thrown for a failure worth retrying on a later poll. The poller retries every
 * thrown error; this one also carries who sent the message and what to do once
 * the retries run out (tell the buyer), so a requirement is never dropped silently.
 */
class RetryableIngestionError extends Error {
  constructor(messageText, { message, onGiveUp } = {}) {
    super(messageText);
    this.name = 'RetryableIngestionError';
    this.fromAddress = (message && message.fromAddress) || null;
    this.subject = (message && message.subject) || null;
    this.onGiveUp = onGiveUp || null;
  }
}

function buyerDisplayName(buyerAccount, message) {
  return (
    (buyerAccount && (buyerAccount.contactPerson || buyerAccount.organizationName)) ||
    (message && message.fromName) ||
    'Valued Buyer'
  );
}

/** Tell a registered buyer their email did not become an RFQ, within the auto-reply guards. */
function notifyRfqNotCreated(message, reason, { buyerAccount = null, config = {}, count, max } = {}) {
  return sendAutoReply(
    message,
    AUTO_REPLY_KIND.RFQ_NOT_CREATED,
    () =>
      mailerService.sendRfqNotCreatedEmail({
        to: message.fromAddress,
        buyerName: buyerDisplayName(buyerAccount, message),
        reason,
        originalSubject: message.subject,
        count,
        max,
      }),
    { config, failureLog: 'Failed to dispatch RFQ-not-created notice to buyer' }
  );
}

/**
 * Whether the buyer can pay for `needed` RFQs at this sourcing mode — the same
 * rule the portal applies: V0 and paid plans are free, a free trial draws one
 * credit per V1/V2/V3 RFQ and is refused once the credits are gone.
 */
function checkRfqCredits(buyerAccount, sourcingMode, needed) {
  if (!buyerAccount || !buyerAccount.id) return { ok: true, applies: false };
  const plan = buyerAccount.subscriptionPlan || 'free_trial';
  const isPaidPlan = plan === 'version_1' || plan === 'version_2' || plan === 'version_3';
  const isV0 = sourcingMode === 'mode_0' || sourcingMode === 'v0' || sourcingMode === 'version_0';
  if (isPaidPlan || isV0) return { ok: true, applies: false };
  const remaining = buyerAccount.remainingFreeRFQs !== undefined ? Number(buyerAccount.remainingFreeRFQs) : 5;
  return { ok: remaining >= needed, applies: true, remaining, needed };
}

/**
 * Store the documents attached to the buyer's email on the RFQ, the same way a
 * portal upload is stored. Best-effort: a file that is the wrong type, too large,
 * or cannot be written is logged and left off — it never stops the RFQ.
 */
async function storeEmailAttachments(message) {
  const saved = [];
  for (const attachment of (message && message.attachments) || []) {
    // Every role is kept ('inline' means "sent to Gemini inline", which is what
    // a PDF requisition is); saveAttachment's MIME allow-list decides what is
    // storable, exactly as for a portal upload.
    if (!attachment || !attachment.content) continue;
    try {
      const result = await withTimeout(
        rfqAttachmentService.saveAttachment({
          fileName: attachment.fileName,
          mimeType: attachment.contentType,
          content: Buffer.isBuffer(attachment.content)
            ? attachment.content.toString('base64')
            : String(attachment.content),
        }),
        POLL_CALL_TIMEOUT_MS,
        'RFQ attachment upload'
      );
      if (result.status === rfqAttachmentService.ATTACHMENT_STATUS.SAVED) {
        saved.push(result.attachment);
      } else {
        logger.warn(
          `Email attachment ${attachment.fileName} not stored on the RFQ (${result.status})`,
          { fileName: attachment.fileName, contentType: attachment.contentType },
          'EMAIL_GATEWAY'
        );
      }
    } catch (err) {
      logger.warn(
        `Email attachment ${attachment.fileName} not stored on the RFQ: ${err.message}`,
        { fileName: attachment.fileName },
        'EMAIL_GATEWAY'
      );
    }
  }
  return saved;
}

/**
 * Resolve vendor record from sender email address or vendor directory.
 * Internal platform / gateway addresses (srinu20252026@gmail.com, rfqprocucev@gmail.com)
 * are NEVER resolved as a vendor.
 */
async function resolveVendorFromEmail(fromAddress, targetRfq = null) {
  if (!fromAddress) return null;
  const email = String(fromAddress).trim().toLowerCase();

  const vendorGatewayAddr = (process.env.VENDOR_EMAIL_GATEWAY_ADDRESS || process.env.VENDOR_EMAIL_GATEWAY_USER || 'srinu20252026@gmail.com').toLowerCase();
  const buyerGatewayAddr = (process.env.EMAIL_GATEWAY_ADDRESS || process.env.EMAIL_GATEWAY_USER || 'rfqprocucev@gmail.com').toLowerCase();
  const gmailApiAddr = String(process.env.GMAIL_SENDER_EMAIL || '').trim().toLowerCase();

  // Internal gateway accounts can NEVER be a vendor
  if (
    email === vendorGatewayAddr ||
    email === buyerGatewayAddr ||
    (gmailApiAddr && email === gmailApiAddr) ||
    email === 'srinu20252026@gmail.com' ||
    email === 'rfqprocucev@gmail.com'
  ) {
    return null;
  }

  // 'all': resolving the sender's own vendor identity by email, not a
  // buyer-scoped list — omitting this silently misses any buyer-uploaded
  // vendor (one with a buyerId set) emailing in a quote reply.
  const direct = storeService.getVendorById(email, 'all');
  if (direct) return direct;

  // A bounded single-row lookup, not storeService.getVendors() — that method
  // re-syncs from the DB with a full unbounded table read on every call (see
  // its own doc comment), and this runs once per inbound email the gateway
  // processes, which would multiply that cost by every email received. No DB
  // configured means there's nothing to bound against, so that in-memory
  // fallback is still needed in that case (e.g. under test).
  const found = pool.hasStorage()
    ? await domainQueries.getVendorByEmailFromDB(email)
    : (await storeService.getVendors()).find(
        (v) => (v.email && v.email.toLowerCase() === email) || (v.corporateEmail && v.corporateEmail.toLowerCase() === email)
      );
  if (found) return found;

  if (targetRfq) {
    const assigned = Array.isArray(targetRfq.assignedVendors) ? targetRfq.assignedVendors : [];
    const assignedMatch = assigned.find((v) => v.email && v.email.toLowerCase() === email);
    if (assignedMatch) return assignedMatch;

    // Match vendor by domain if assigned to this RFQ (excluding generic webmail providers)
    const domain = email.split('@')[1];
    const genericDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'protonmail.com'];
    if (domain && !genericDomains.includes(domain)) {
      const domainMatch = assigned.find((v) => v.email && v.email.toLowerCase().endsWith(`@${domain}`));
      if (domainMatch) return domainMatch;
    }

    // If only one vendor was assigned to this RFQ, attribute non-gateway response to that vendor
    if (assigned.length === 1) {
      return assigned[0];
    }
  }

  return null;
}

function isVendorIssueOrQueryMessage(message) {
  if (!message) return false;
  const text = [message.bodyText, message.textBody, message.text, message.subject].filter(Boolean).join('\n').toLowerCase();
  const issueKeywords = [
    /\b(issue|query|clarification|doubt|question|enquiry|inquiry|concern|problem)\b/i,
    /\b(unable to quote|cannot quote|cannot provide|drawing missing|specification unclear|datasheet missing|specs missing)\b/i,
    /\b(please clarify|could you explain|please confirm|request for clarification|need more info|more details required)\b/i,
    /\b(delivery location unclear|payment terms query|not able to bid|technical question)\b/i,
  ];
  return issueKeywords.some((pattern) => pattern.test(text));
}

/**
 * Ingests a vendor quotation received via email into the referenced RFQ.
 */
async function processVendorQuoteMessage(message, targetRfq, vendorRecord) {
  logger.info(
    `Processing inbound vendor quotation email for RFQ ${targetRfq.rfqNumber} from ${vendorRecord.name} (${message.fromAddress})`,
    { rfqNumber: targetRfq.rfqNumber, vendorId: vendorRecord.id, fromAddress: message.fromAddress },
    'EMAIL_GATEWAY'
  );

  const buyerEmail = storeService.resolveBuyerEmailForRFQ(targetRfq);
  const incomingCc = Array.isArray(message.cc) ? message.cc : (message.cc ? [message.cc] : []);
  const ccList = Array.from(new Set([buyerEmail, ...incomingCc, VENDOR_QUOTE_SUPPORT_CC].filter(Boolean)));

  // Validate vendor quotation eligibility: buyer-mapped vendors get unlimited quotations on their buyer's RFQs;
  // otherwise 5 free quotation credits, then active subscription required
  const eligibility = storeService.checkVendorQuotationEligibility(vendorRecord, targetRfq);
  if (!eligibility.eligible) {
    logger.warn(
      `Vendor quote reply from ${vendorRecord.name} for RFQ ${targetRfq.rfqNumber} rejected: 5 free quotation credits exhausted (subscriptionPlan: ${eligibility.subscriptionPlan})`,
      { rfqNumber: targetRfq.rfqNumber, vendorId: vendorRecord.id, fromAddress: message.fromAddress },
      'EMAIL_GATEWAY'
    );

    storeService.addAuditLog({
      userEmail: message.fromAddress || SYSTEM_ACTOR_EMAIL,
      action: `Quotation email from ${vendorRecord.name} for ${targetRfq.rfqNumber} rejected: 5 free quotation credits exhausted (subscription required)`,
      rfqNumber: targetRfq.rfqNumber,
    });

    await sendAutoReply(
      message,
      AUTO_REPLY_KIND.CREDITS_EXHAUSTED,
      () =>
        mailerService.sendVendorCreditsExhaustedEmail(message.fromAddress, {
          rfq: targetRfq,
          rfqNumber: targetRfq.rfqNumber,
          rfqTitle: targetRfq.title,
          vendorName: vendorRecord.name,
          upgradeUrl: typeof mailerService.vendorUpgradeUrl === 'function' ? mailerService.vendorUpgradeUrl() : undefined,
          cc: ccList.length > 0 ? ccList.join(', ') : undefined,
        }),
      { rfqNumber: targetRfq.rfqNumber, failureLog: 'Failed to send vendor credits exhausted email' }
    );

    return {
      status: INGESTION_OUTCOME.CREDITS_EXHAUSTED,
      detail: (EMAIL_GATEWAY_MESSAGES.CREDITS_EXHAUSTED_DETAIL || 'Vendor quotation credits exhausted')
        .replace('{rfqNumber}', targetRfq.rfqNumber)
        .replace('{vendorName}', vendorRecord.name),
      message,
      rfq: targetRfq,
    };
  }

  const rfqItems =
    Array.isArray(targetRfq.extractedEntities) && targetRfq.extractedEntities.length > 0
      ? targetRfq.extractedEntities
      : Array.isArray(targetRfq.lineItems)
        ? targetRfq.lineItems
        : [];
  const itemCount = rfqItems.length;
  let extraction = null;
  try {
    extraction = await geminiService.extractQuotationFromEmail(
      {
        bodyText: message.bodyText || message.textBody || message.text,
        subject: message.subject,
        fromAddress: message.fromAddress,
        attachments: message.attachments || [],
      },
      targetRfq
    );
  } catch (extractErr) {
    logger.error('AI quotation extraction failed with error', extractErr, 'EMAIL_GATEWAY');
    extraction = null;
  }

  if (!extraction) {
    logger.warn(
      `Vendor quote from ${vendorRecord.name} for RFQ ${targetRfq.rfqNumber} failed AI extraction`,
      { rfqNumber: targetRfq.rfqNumber, vendorId: vendorRecord.id, fromAddress: message.fromAddress },
      'EMAIL_GATEWAY'
    );

    await sendAutoReply(
      message,
      AUTO_REPLY_KIND.QUOTE_FAILURE,
      () =>
        mailerService.sendQuoteFailureEmail(message.fromAddress, {
          rfqNumber: targetRfq.rfqNumber,
          rfqTitle: targetRfq.title,
          vendorName: vendorRecord.name,
          reason: 'Quotation parsing failed due to AI extraction errors. Please ensure all quotation parameters are clearly stated.',
          missingFields: ['Quotation Details / AI Extraction'],
          cc: ccList.length > 0 ? ccList.join(', ') : (buyerEmail || undefined),
        }),
      { rfqNumber: targetRfq.rfqNumber, failureLog: 'Failed to send vendor quote failure email' }
    );

    return {
      status: INGESTION_OUTCOME.QUOTE_VALIDATION_FAILED,
      detail: EMAIL_GATEWAY_MESSAGES.QUOTE_VALIDATION_FAILED_DETAIL
        .replace('{rfqNumber}', targetRfq.rfqNumber)
        .replace('{vendorName}', vendorRecord.name)
        .replace('{reason}', 'AI extraction error'),
      message,
      rfq: targetRfq,
    };
  }

  const rfqQty = rfqItems.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0) || 1;

  const emailText = [message.bodyText, message.textBody, message.text, message.subject].filter(Boolean).join('\n');
  const isIssueOrQuery = isVendorIssueOrQueryMessage(message) || Boolean(extraction && (extraction.isQuery || extraction.hasIssue || extraction.isInquiry));

  if (isIssueOrQuery) {
    logger.warn(
      `Vendor reply from ${vendorRecord.name} for RFQ ${targetRfq.rfqNumber} identified as an issue/query. Failing quotation creation and withholding bid generation.`,
      { rfqNumber: targetRfq.rfqNumber, vendorId: vendorRecord.id, fromAddress: message.fromAddress },
      'EMAIL_GATEWAY'
    );

    storeService.addAuditLog({
      userEmail: message.fromAddress || SYSTEM_ACTOR_EMAIL,
      action: `Quotation creation failed for ${targetRfq.rfqNumber} from ${vendorRecord.name}: Reply identified as vendor issue/query. Bid not generated.`,
      rfqNumber: targetRfq.rfqNumber,
    });

    if (typeof storeService.addInquiryToRFQ === 'function') {
      try {
        storeService.addInquiryToRFQ(targetRfq.id, {
          message: emailText,
          vendorName: vendorRecord.name,
          vendorEmail: message.fromAddress,
          vendorId: vendorRecord.id,
        });
      } catch (inqErr) {
        logger.error('Failed to log vendor inquiry to RFQ', inqErr, 'EMAIL_GATEWAY');
      }
    }

    await sendAutoReply(
      message,
      AUTO_REPLY_KIND.VENDOR_ISSUE,
      () =>
        mailerService.sendVendorIssueAcknowledgementEmail(message.fromAddress, {
          rfq: targetRfq,
          rfqNumber: targetRfq.rfqNumber,
          rfqTitle: targetRfq.title,
          vendorName: vendorRecord.name,
          issueMessage: emailText.slice(0, 500),
          reason: 'Quotation creation has failed and no bid was generated because your email contains an issue or clarification query regarding the RFQ.',
          cc: ccList.length > 0 ? ccList.join(', ') : undefined,
        }),
      { rfqNumber: targetRfq.rfqNumber, failureLog: 'Failed to send vendor issue acknowledgment email' }
    );

    return {
      status: INGESTION_OUTCOME.QUOTE_VALIDATION_FAILED,
      detail: `Quotation creation failed for RFQ ${targetRfq.rfqNumber} from ${vendorRecord.name}: Vendor replied with an issue or query. Quotation has not been generated and buyer has been notified in CC.`,
      message,
      rfq: targetRfq,
      isIssueOrQuery: true,
    };
  }

  // Email bids are supported only for RFQs that have at most ten items.
  if (itemCount > 10) {
    logger.warn(
      `RFQ ${targetRfq.rfqNumber} has ${itemCount} items (>10 items threshold). Directing vendor ${vendorRecord.name} to Vendor Portal for Excel upload.`,
      { rfqNumber: targetRfq.rfqNumber, itemCount, vendorEmail: message.fromAddress },
      'EMAIL_GATEWAY'
    );

    await sendAutoReply(
      message,
      AUTO_REPLY_KIND.PORTAL_REDIRECT,
      () =>
        mailerService.sendComplexRfqPortalRedirectEmail(message.fromAddress, {
          rfq: targetRfq,
          vendorName: vendorRecord.name,
          itemCount,
        }),
      { rfqNumber: targetRfq.rfqNumber, failureLog: 'Failed to send complex RFQ portal redirect email' }
    );

    return {
      status: INGESTION_OUTCOME.PORTAL_SUBMISSION_REQUIRED,
      detail: `RFQ ${targetRfq.rfqNumber} has ${itemCount} line items (>10 limit for email bidding). Vendor directed to Procucev Portal for Excel template upload.`,
      message,
      rfq: targetRfq,
    };
  }

  let unitPriceNum = Number(extraction.unitPrice);
  if ((!extraction.unitPrice || isNaN(unitPriceNum) || unitPriceNum <= 0) && Number(extraction.totalPrice) > 0) {
    extraction.unitPrice = Math.round(Number(extraction.totalPrice) / rfqQty);
    unitPriceNum = extraction.unitPrice;
  }
  if ((!extraction.unitPrice || isNaN(unitPriceNum) || unitPriceNum <= 0) && Array.isArray(extraction.lineItemQuotes)) {
    const firstPriced = extraction.lineItemQuotes.find((lq) => Number(lq.unitPrice) > 0);
    if (firstPriced) {
      extraction.unitPrice = Number(firstPriced.unitPrice);
      unitPriceNum = extraction.unitPrice;
    }
  }

  // Second-chance extraction fallback if initial pass missed the price
  if (!extraction.unitPrice || isNaN(unitPriceNum) || unitPriceNum <= 0) {
    const fallbackText = [message.bodyText, message.textBody, message.text, message.subject].filter(Boolean).join('\n');
    const fallback = geminiService.extractQuotationFallback(fallbackText, targetRfq);
    if (Number(fallback.unitPrice) > 0) {
      Object.assign(extraction, fallback);
      unitPriceNum = Number(extraction.unitPrice);
    }
  }

  if (!extraction.unitPrice || isNaN(unitPriceNum) || unitPriceNum <= 0) {
    logger.warn(
      `Vendor quote from ${vendorRecord.name} for RFQ ${targetRfq.rfqNumber} failed validation: missing or invalid unit price (${extraction.unitPrice})`,
      { rfqNumber: targetRfq.rfqNumber, vendorId: vendorRecord.id, fromAddress: message.fromAddress },
      'EMAIL_GATEWAY'
    );

    await sendAutoReply(
      message,
      AUTO_REPLY_KIND.QUOTE_FAILURE,
      () =>
        mailerService.sendQuoteFailureEmail(message.fromAddress, {
          rfqNumber: targetRfq.rfqNumber,
          rfqTitle: targetRfq.title,
          vendorName: vendorRecord.name,
          reason: 'Unit Price (₹) is mandatory and must be greater than 0.',
          missingFields: ['Unit Price (₹)'],
          cc: ccList.length > 0 ? ccList.join(', ') : undefined,
        }),
      { rfqNumber: targetRfq.rfqNumber, failureLog: 'Failed to send vendor quote failure email' }
    );

    return {
      status: INGESTION_OUTCOME.QUOTE_VALIDATION_FAILED,
      detail: EMAIL_GATEWAY_MESSAGES.QUOTE_VALIDATION_FAILED_DETAIL
        .replace('{rfqNumber}', targetRfq.rfqNumber)
        .replace('{vendorName}', vendorRecord.name)
        .replace('{reason}', 'Missing mandatory unit price'),
      message,
      rfq: targetRfq,
    };
  }

  const quote = {
    vendorId: vendorRecord.id,
    vendorName: vendorRecord.name,
    vendorCategory: vendorRecord.category || 'Client List',
    unitPrice: extraction.unitPrice,
    totalPrice: extraction.totalPrice || extraction.unitPrice,
    leadTimeDays: extraction.leadTimeDays || 7,
    aiMatchScore: 0,
    warrantyYears: extraction.warrantyYears || 1,
    complianceStatus: extraction.complianceStatus || 'Fully Compliant',
    paymentTerms: extraction.paymentTerms || '',
    remarks: extraction.remarks || 'Email quotation submitted',
    submittedAt: new Date().toISOString(),
    source: 'email',
    submissionMethod: 'Email Submission',
    sourceMessageId: message.messageId || null,
    lineItemQuotes: extraction.lineItemQuotes || [],
    taxes: extraction.taxes || 0,
    deliveryCharges: extraction.deliveryCharges || 0,
    deliveryDate: extraction.deliveryDate || null,
    quotationValidity: extraction.quotationValidity || null,
  };

  const updatedRFQ = storeService.addQuoteToRFQ(targetRfq.id, quote);
  storeService.consumeVendorQuotationCredit(vendorRecord.id, targetRfq.id);

  storeService.addAuditLog({
    userEmail: message.fromAddress || SYSTEM_ACTOR_EMAIL,
    action: `Quotation for ${targetRfq.rfqNumber} received via email from ${vendorRecord.name} (Total: ₹${quote.totalPrice})`,
    rfqNumber: targetRfq.rfqNumber,
  });

  logger.audit(
    `Quotation for ${targetRfq.rfqNumber} received via email from ${vendorRecord.name} (Total: ₹${quote.totalPrice})`,
    message.fromAddress,
    {
      rfqNumber: targetRfq.rfqNumber,
      vendorId: vendorRecord.id,
      vendorName: vendorRecord.name,
      totalPrice: quote.totalPrice,
      unitPrice: quote.unitPrice,
      source: 'email',
    }
  );

  await sendAutoReply(
    message,
    AUTO_REPLY_KIND.QUOTE_ACK,
    () =>
      mailerService.sendQuoteAcknowledgementEmail(message.fromAddress, {
        rfqNumber: targetRfq.rfqNumber,
        rfqTitle: targetRfq.title,
        vendorName: vendorRecord.name,
        quote,
      }),
    { rfqNumber: targetRfq.rfqNumber, failureLog: 'Failed to send vendor quote acknowledgement email' }
  );

  if (buyerEmail) {
    try {
      await mailerService.sendQuoteReceivedEmail(buyerEmail, {
        rfq: updatedRFQ || targetRfq,
        quote,
        recipientName: targetRfq.buyerAccountName || 'Buyer',
      });
    } catch (mailErr) {
      logger.error('Failed to send buyer quote received email', mailErr, 'EMAIL_GATEWAY');
    }
  }

  return {
    status: INGESTION_OUTCOME.QUOTE_INGESTED,
    detail: EMAIL_GATEWAY_MESSAGES.QUOTE_INGESTED_DETAIL
      .replace('{rfqNumber}', targetRfq.rfqNumber)
      .replace('{vendorName}', vendorRecord.name),
    message,
    quote,
    rfq: updatedRFQ || targetRfq,
  };
}

/**
 * Turn one raw message into an RFQ or vendor quote.
 *
 * Resolves to the ledger outcome rather than throwing, so one unusable message
 * cannot abort the rest of the batch. Every path records why.
 */
async function processMessage(rawSource, config = resolveConfig()) {
  const prepared = await emailIngestionService.prepareEmailForExtraction({
    // The gateway holds raw bytes; prepareEmailForExtraction takes base64, the
    // same shape the upload route provides.
    fileName: EMAIL_GATEWAY_CONFIG.SYNTHETIC_FILE_NAME,
    content: Buffer.isBuffer(rawSource) ? rawSource.toString('base64') : String(rawSource || ''),
  });

  if (prepared.status !== EMAIL_INGESTION_STATUS.READY) {
    return {
      status: INGESTION_OUTCOME.UNREADABLE,
      detail: EMAIL_GATEWAY_MESSAGES.PREPARE_REFUSED.replace('{status}', prepared.status),
      message: prepared.message || null,
    };
  }

  const { message } = prepared;
  if (message && !message.bodyText && prepared.extractionInput?.documentText) {
    message.bodyText = prepared.extractionInput.documentText;
  }

  // 0. Never process mail the gateway itself sent. Every outbound notification
  // (RFQ acknowledgement, quote acknowledgement/failure, unauthorized-sender
  // notice) replies to whatever address triggered it — and if that address
  // happens to equal the gateway's OWN watched mailbox (e.g. a test vendor
  // reusing the intake address, or a buyer's RFQ-creation ack landing back in
  // the same inbox it was sent from), the reply lands right back in the
  // mailbox being watched. Without this guard the gateway then treats its own
  // notification as a new inbound vendor quote, fails it again, sends another
  // notification, and loops forever — confirmed live: one bad test message
  // generated a new "Quotation Could Not Be Processed" every poll cycle
  // indefinitely, CC'ing the buyer (and, before that CC was removed, a real
  // support inbox) every time.
  //
  // isOutgoingSystemMessage (below) already covers the common case (sender
  // matches config.user or a known vendor/buyer gateway address); this is a
  // supplementary catch-all for config.address specifically, which that
  // check doesn't look at. Both report the same outcome (SKIPPED_OUTBOUND) —
  // there is nothing behaviourally different about "own address" vs "own
  // system message" once either is true, both stop here with no reply sent.
  if (isOutgoingSystemMessage(message, config)) {
    logger.info(`Skipping outbound system message from ${message.fromAddress}`, { subject: message.subject }, 'EMAIL_GATEWAY');
    return {
      status: INGESTION_OUTCOME.SKIPPED_OUTBOUND,
      detail: 'Skipped self-sent or outbound system message',
      message,
    };
  }

  // A bounce/auto-reply is never a real unauthorized sender — see
  // isBounceOrAutoReplyMessage's own comment for the notification-loop this
  // prevents. Reported the same way as an outgoing system message: marked
  // read, no reply sent.
  if (isBounceOrAutoReplyMessage(message)) {
    logger.info(`Skipping mail-system bounce/auto-reply from ${message.fromAddress}`, { subject: message.subject }, 'EMAIL_GATEWAY');
    return {
      status: INGESTION_OUTCOME.SKIPPED_OUTBOUND,
      detail: 'Skipped mail-system bounce/auto-reply notice',
      message,
    };
  }

  const gatewayOwnAddresses = new Set(
    [config.address, config.user].filter(Boolean).map((a) => String(a).trim().toLowerCase())
  );
  if (message.fromAddress && gatewayOwnAddresses.has(String(message.fromAddress).trim().toLowerCase())) {
    logger.warn(
      `Ignoring inbound message from the gateway's own address (${message.fromAddress}) — processing it would risk an outbound-notification loop`,
      { fromAddress: message.fromAddress, subject: message.subject },
      'EMAIL_GATEWAY'
    );
    return {
      status: INGESTION_OUTCOME.SKIPPED_OUTBOUND,
      detail: 'Message originated from the gateway\'s own configured address; ignored to avoid a notification loop.',
      message,
    };
  }

  // 1. Check if this message is a vendor quotation reply for an existing RFQ
  const { targetRfq, referencedNumber } = await extractRfqReferenceFromEmail(message);
  const vendorRecord = await resolveVendorFromEmail(message.fromAddress, targetRfq);

  if (targetRfq && vendorRecord) {
    return await processVendorQuoteMessage(message, targetRfq, vendorRecord);
  }

  if (!targetRfq && referencedNumber && vendorRecord) {
    return {
      status: INGESTION_OUTCOME.INVALID_RFQ,
      detail: EMAIL_GATEWAY_MESSAGES.INVALID_RFQ_REFERENCED.replace('{rfqNumber}', referencedNumber),
      message,
    };
  }

  // If message arrived on the vendor quotation mailbox, vendor submissions require an RFQ.
  // When an email represents a new RFQ/request (from a registered buyer or an RFQ enquiry),
  // it is processed through the RFQ creation pipeline as per dual-inbox requirements.
  if (config && config.isVendorMailbox) {
    const isRegisteredBuyer = Boolean(await storeService.getBuyerAccountByEmail(message.fromAddress));
    const isRfqSubjectOrContent = /rfq|requisition|purchase|material|indent|tender|quot|boq|requirement/i.test(
      `${message.subject || ''} ${message.bodyText || ''}`
    );

    // Non-RFQ vendor correspondence or general enquiries sent to vendor mailbox without an RFQ are rejected
    if (!isRegisteredBuyer && !isRfqSubjectOrContent) {
      return {
        status: INGESTION_OUTCOME.INVALID_RFQ,
        detail: EMAIL_GATEWAY_MESSAGES.VENDOR_GATEWAY_REQUIRES_RFQ,
        message,
      };
    }
  }

  // 2. Otherwise process as Inbound Buyer RFQ Requisition
  const authorisation = await resolveSenderAuthorisation(message.fromAddress, config);
  if (!authorisation.allowed) {
    await sendAutoReply(
      message,
      AUTO_REPLY_KIND.UNAUTHORIZED_SENDER,
      () =>
        mailerService.sendUnauthorizedBuyerNotificationEmail(message.fromAddress, {
          subject: message.subject,
          gatewayAddress: config.user || EMAIL_GATEWAY_CONFIG.DEFAULT_GATEWAY_ADDRESS,
        }),
      { config, failureLog: 'Failed to dispatch registration notification to unauthorized sender' }
    );
    return { status: INGESTION_OUTCOME.SENDER_NOT_ALLOWED, detail: authorisation.reason, message };
  }

  // A transient Gemini failure (timeout, rate limit, outage, missing key) says
  // nothing about the email. It is thrown so the poller retries it; once the
  // retries run out the buyer is told, instead of the requirement being
  // recorded as "no line items" and dropped after one try.
  const notifyContext = { buyerAccount: authorisation.buyerAccount, config };
  const giveUpNotice = () => notifyRfqNotCreated(message, 'PROCESSING_FAILED', notifyContext);
  let extraction;
  try {
    extraction = await withTimeout(
      geminiService.extractLineItems(prepared.extractionInput),
      EXTRACTION_TIMEOUT_MS,
      'Gemini line-item extraction'
    );
  } catch (err) {
    throw new RetryableIngestionError(err.message, { message, onGiveUp: giveUpNotice });
  }
  if (isRetryableExtraction(extraction.status)) {
    throw new RetryableIngestionError(
      EMAIL_GATEWAY_MESSAGES.EXTRACTION_RETRYABLE.replace('{status}', extraction.status),
      { message, onGiveUp: giveUpNotice }
    );
  }
  if (extraction.status !== geminiService.EXTRACTION_STATUS.SUCCESS) {
    await notifyRfqNotCreated(message, 'NO_LINE_ITEMS', notifyContext);
    return {
      status: INGESTION_OUTCOME.NO_LINE_ITEMS,
      detail: EMAIL_GATEWAY_MESSAGES.EXTRACTION_FAILED.replace('{status}', extraction.status),
      message,
    };
  }

  const buyerLocation = await emailGateway.resolveBuyerRegisteredLocation(authorisation.buyerAccount);
  const groups = emailGateway.processLineItemsAndGroups(extraction.lineItems, extraction, buyerLocation);

  if (groups.length === 0) {
    await notifyRfqNotCreated(message, 'NO_LINE_ITEMS', notifyContext);
    return {
      status: INGESTION_OUTCOME.NO_LINE_ITEMS,
      detail: EMAIL_GATEWAY_MESSAGES.NO_ITEMS_ACCEPTED,
      message,
    };
  }

  // Enforce maximum 49 line items per RFQ
  for (const group of groups) {
    if (group.items.length > EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ) {
      const detail = EMAIL_GATEWAY_MESSAGES.LINE_ITEMS_EXCEED_LIMIT
        .replace('{max}', String(EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ))
        .replace('{count}', String(group.items.length));
      logger.warn(
        `RFQ ingestion rejected: line items exceed limit of ${EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ}`,
        { count: group.items.length, max: EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ },
        'EMAIL_GATEWAY'
      );
      await notifyRfqNotCreated(message, 'TOO_MANY_LINE_ITEMS', {
        ...notifyContext,
        count: group.items.length,
        max: EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ,
      });
      return {
        status: INGESTION_OUTCOME.LINE_ITEMS_EXCEED_LIMIT,
        detail,
        message,
      };
    }
  }

  // The portal refuses a V1/V2/V3 RFQ once a free trial's credits are gone;
  // email used to create it anyway. Checked for every RFQ this email would raise
  // before any is created, so the buyer never gets half a requirement.
  const sourcingMode = resolveBuyerSourcingMode(authorisation.buyerAccount);
  const credits = checkRfqCredits(authorisation.buyerAccount, sourcingMode, groups.length);
  if (!credits.ok) {
    logger.warn(
      'Email RFQ refused: free trial RFQ credits exhausted',
      { buyerAccountId: authorisation.buyerAccount.id, sourcingMode, remaining: credits.remaining, needed: credits.needed },
      'EMAIL_GATEWAY'
    );
    await notifyRfqNotCreated(message, 'CREDITS_EXHAUSTED', notifyContext);
    return {
      status: INGESTION_OUTCOME.RFQ_CREDITS_EXHAUSTED,
      detail: EMAIL_GATEWAY_MESSAGES.RFQ_CREDITS_EXHAUSTED_DETAIL
        .replace('{remaining}', String(credits.remaining))
        .replace('{needed}', String(credits.needed)),
      message,
    };
  }

  const createdRFQs = [];
  let totalAccepted = 0;
  let totalNeedsReview = 0;
  // Uploaded once, when the first RFQ is actually created, and shared by every
  // RFQ the email raises.
  let attachmentsPromise = null;
  const emailAttachments = () => {
    if (!attachmentsPromise) attachmentsPromise = storeEmailAttachments(message);
    return attachmentsPromise;
  };

  for (const [groupIndex, group] of groups.entries()) {
    // An email whose processing failed after some of its RFQs were created is
    // retried in full; the ledger row written for each created RFQ stops it
    // being raised (and charged, and acknowledged) a second time.
    const groupKey = message.messageId ? `${message.messageId}#rfq-${groupIndex}` : null;
    const alreadyCreated = groupKey ? await emailGatewayQueries.findProcessed(groupKey) : null;
    if (alreadyCreated) {
      createdRFQs.push({ id: alreadyCreated.rfq_id, rfqNumber: alreadyCreated.rfq_number });
      continue;
    }

    const { draft, classification } = await rfqIngestionService.buildRFQDraft({
      lineItems: group.items,
      title: extraction.documentTitle || message.subject,
      category: extraction.category,
      estimatedBudget: extraction.estimatedBudget,
      source: 'email_gateway',
      sourceEmail: message.fromAddress,
      deliveryLocation: group.deliveryLocation,
      deliveryCity: group.deliveryCity,
      deliveryState: group.deliveryState,
      deliveryPincode: group.deliveryPincode,
      targetDeliveryDate: group.targetDate,
    });

    if (classification.accepted === 0) {
      continue;
    }

    totalAccepted += classification.accepted;
    totalNeedsReview += classification.needsReview;

    const created = storeService.createRFQ(
      {
        title: draft.title,
        category: draft.category,
        sourcingMode,
        // Held for review rather than circulated. Nothing has checked this yet.
        status: EMAIL_GATEWAY_CONFIG.INGESTED_STATUS,
        source: 'email_gateway',
        sourceEmail: message.fromAddress,
        sourceFileName: message.subject || EMAIL_GATEWAY_CONFIG.SYNTHETIC_FILE_NAME,
        raisedByEmail: message.fromAddress,
        budget: draft.estimatedBudget || 0,
        targetDeliveryDate: draft.targetDeliveryDate,
        extractedEntities: draft.extractedEntities,
        deliveryLocation: draft.deliveryLocation,
        deliveryCity: draft.deliveryCity,
        deliveryState: draft.deliveryState,
        deliveryPincode: draft.deliveryPincode,
        attachments: await emailAttachments(),
      },
      authorisation.buyerAccount
    );

    if (groupKey) {
      await emailGatewayQueries.recordProcessed({
        messageId: groupKey,
        status: INGESTION_OUTCOME.RFQ_GROUP_CREATED,
        detail: `RFQ ${groupIndex + 1} of ${groups.length} raised from this email`,
        fromAddress: message.fromAddress,
        subject: message.subject,
        rfqId: created.id,
        rfqNumber: created.rfqNumber,
      });
    }

    // Email-ingested RFQs must draw down sourcing credits the same way a
    // portal/AI-created RFQ does — the HTTP createRFQ controller is bypassed
    // here, so the credit rule is applied explicitly. V0 and paid plans are
    // exempt (handled inside consumeRFQCreditIfApplicable).
    const creditResult = storeService.consumeRFQCreditIfApplicable(authorisation.buyerAccount, sourcingMode);
    if (creditResult.consumed) {
      logger.info(
        `Consumed 1 sourcing credit for email-ingested RFQ ${created.rfqNumber}`,
        { rfqNumber: created.rfqNumber, sourcingMode, remaining: creditResult.remaining },
        'EMAIL_GATEWAY'
      );
    }

    createdRFQs.push(created);

    // Dispatch RFQ creation acknowledgement email to the buyer
    if (message.fromAddress) {
      const ack = {
        to: message.fromAddress,
        buyerName: buyerDisplayName(authorisation.buyerAccount, message),
        rfqNumber: created.rfqNumber,
        rfqTitle: created.title,
      };
      try {
        await mailerService.sendRfqAcknowledgementEmail(ack);
      } catch (ackErr) {
        logger.error('Failed to dispatch RFQ acknowledgement email to buyer', ackErr, 'EMAIL_GATEWAY');
        await queueAcknowledgement(groupKey || created.id, ack);
      }
    }

    logger.audit(
      `RFQ ${created.rfqNumber} raised from inbound email`,
      message.fromAddress,
      { rfqId: created.id, messageId: message.messageId, accepted: classification.accepted }
    );
  }

  if (createdRFQs.length === 0) {
    await notifyRfqNotCreated(message, 'NO_LINE_ITEMS', notifyContext);
    return {
      status: INGESTION_OUTCOME.NO_LINE_ITEMS,
      detail: EMAIL_GATEWAY_MESSAGES.NO_ITEMS_ACCEPTED,
      message,
    };
  }

  return {
    status: INGESTION_OUTCOME.INGESTED,
    detail: EMAIL_GATEWAY_MESSAGES.INGESTED_DETAIL.replace(
      '{count}',
      String(totalAccepted)
    ).replace('{needsReview}', String(totalNeedsReview)),
    message,
    rfq: createdRFQs[0],
    rfqs: createdRFQs,
  };
}

/**
 * Read the buyer intake mailbox once via the Gmail REST API instead of IMAP.
 *
 * IMAP cannot hold a reliable socket open from Cloudflare Workers at all —
 * confirmed live: every scheduled poll here failed with "Unexpected close" /
 * "NoConnection", the same category of TLS-socket limitation that made raw
 * SMTP unusable for outbound mail (see mailerService.deliverVendor's own
 * Gmail-API fallback for that story). The Gmail API is plain HTTPS, so it
 * works from Workers the same way any other fetch call does.
 *
 * Shares the exact same processMessage()/emailGatewayQueries ledger as the
 * IMAP path below — this is only a different transport for fetching
 * messages, not a second parsing pipeline. Uses navin.procucev@gmail.com
 * (whatever GMAIL_SENDER_EMAIL/GMAIL_REFRESH_TOKEN actually point to — no
 * address is hardcoded here) via the same Gmail OAuth client outbound mail
 * already uses, so the refresh token needs the gmail.readonly and
 * gmail.modify scopes in addition to gmail.send (re-authorize via
 * scripts/get-gmail-refresh-token.js if the existing token predates this).
 */
async function pollViaGmailApi(config = resolveConfig(), options = {}) {
  // The lock state and the auth client default to the buyer identity; the vendor
  // inbox passes its own so the two polls never share a lock or a token.
  const state = options.state || runtime;
  if (pollInFlight(state)) {
    logger.warn('Email gateway poll skipped: previous buyer poll still in flight', { isPolling: state.isPolling, startedAt: state.pollStartedAt, ageMs: Date.now() - state.pollStartedAt, now: Date.now() }, 'EMAIL_GATEWAY');
    return { skipped: true, reason: EMAIL_GATEWAY_MESSAGES.POLL_ALREADY_RUNNING };
  }
  const auth = options.auth || mailerService.getGmailOAuthClient();
  if (!auth) {
    return { skipped: true, reason: EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED };
  }

  const { google } = require('googleapis');
  const gmail = google.gmail({ version: 'v1', auth });

  state.isPolling = true;
  state.pollStartedAt = Date.now();
  logger.info('Buyer poll lock SET', { site: 'pollViaGmailApi', startedAt: state.pollStartedAt }, 'EMAIL_GATEWAY');
  state.consideredThisRun = 0;
  state.ingestedThisRun = 0;
  const startedAt = Date.now();
  const outcomes = [];

  try {
    // Deliberately NOT bounded by state.watchingSince the way the IMAP
    // path below is — confirmed live this genuinely breaks on Workers:
    // `state` is plain in-memory module state, and Cloudflare spins up a
    // fresh isolate (resetting it to "now") far more often than a Node
    // process restarts, so `after:<watchingSince>` silently excluded mail
    // sent just seconds earlier in the *previous* isolate — every poll
    // reported considered:0 for a message that was genuinely sitting
    // unread. `is:unread` + maxPerPoll + our own ledger dedupe
    // (emailGatewayQueries.hasProcessed, checked per message below) are
    // sufficient for correctness without a time bound that can't be kept
    // reliably on this platform; a pre-existing backlog is handled by
    // marking it read once out of band, not by a bound in this query.
    // Every message the poll finishes with is marked read, whatever its outcome.
    // Previously only INGESTED/QUOTE_INGESTED/CREDITS_EXHAUSTED/SKIPPED_OUTBOUND
    // were, and the "already processed?" check used a different key
    // (gmail-<id>) from the one the outcome was recorded under (the Message-ID
    // header) — so every rejected message (unregistered sender, invalid RFQ, no
    // line items) stayed unread and was processed again on every poll: a new
    // notice to the same newsletter every minute, a Gemini call every minute,
    // and, once ten such messages piled up, no slot left in `maxPerPoll` for a
    // real requisition behind them.
    const markRead = (id, label) =>
      withTimeout(
        gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['UNREAD'] } }).catch(() => {}),
        POLL_CALL_TIMEOUT_MS,
        label
      ).catch(() => {});

    let pageToken;
    let pages = 0;
    let workDone = 0;
    let ledgerUnavailable = false;
    let outOfTime = false;
    let lastListRes;
    let lastPageSize = 0;
    const seen = new Set();

    do {
      const listRes = await withTimeout(
        gmail.users.messages.list({
          userId: 'me',
          q: 'is:unread',
          maxResults: config.maxPerPoll,
          ...(pageToken ? { pageToken } : {}),
        }),
        POLL_CALL_TIMEOUT_MS,
        'Gmail inbox list'
      );
      pages += 1;
      lastListRes = listRes;
      state.lastConnectedAt = new Date().toISOString();

      const messages = listRes.data.messages || [];
      lastPageSize = messages.length;
      for (const ref of messages) {
        if (workDone >= config.maxPerPoll || ledgerUnavailable) break;
        if (Date.now() - startedAt >= POLL_WORK_BUDGET_MS) {
          outOfTime = true;
          break;
        }
        if (seen.has(ref.id)) continue;
        seen.add(ref.id);
        state.consideredThisRun += 1;
        const dedupeKey = `gmail-${ref.id}`;

        // Ours is the authoritative dedupe check; see emailGatewayQueries. Strict,
        // so a ledger outage leaves mail unread for a later poll instead of
        // marking it read as "already processed" and losing it.
        let alreadyProcessed;
        try {
          alreadyProcessed = await withTimeout(
            emailGatewayQueries.hasProcessed(dedupeKey, { strict: true }),
            POLL_CALL_TIMEOUT_MS,
            'Ledger check'
          );
        } catch (ledgerErr) {
          ledgerUnavailable = true;
          logger.error('Email gateway poll paused: ingestion ledger unavailable', ledgerErr, 'EMAIL_GATEWAY');
          outcomes.push({ uid: ref.id, messageId: dedupeKey, status: EMAIL_GATEWAY_LEDGER_UNAVAILABLE });
          break;
        }
        if (alreadyProcessed) {
          await markRead(ref.id, 'Gmail mark-read');
          outcomes.push({ uid: ref.id, messageId: dedupeKey, status: EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED });
          continue;
        }

        workDone += 1;
        try {
          const full = await withTimeout(
            gmail.users.messages.get({ userId: 'me', id: ref.id, format: 'raw' }),
            POLL_CALL_TIMEOUT_MS,
            'Gmail message fetch'
          );
          if (!full.data || !full.data.raw) {
            await emailGatewayQueries.recordProcessed({
              messageId: dedupeKey,
              status: INGESTION_OUTCOME.UNREADABLE,
              detail: 'Gmail returned no message body',
            });
            await markRead(ref.id, 'Gmail mark-read (unreadable)');
            outcomes.push({ uid: ref.id, status: INGESTION_OUTCOME.UNREADABLE });
            continue;
          }
          const rawSource = Buffer.from(full.data.raw, 'base64url');

          // The same message can reach a watched inbox twice (re-delivered, or
          // sent to both the buyer and vendor mailboxes); its Message-ID header
          // is what the outcome is recorded under, so check that too.
          const headerMessageId = extractHeaderMessageId(rawSource);
          if (
            headerMessageId &&
            (await withTimeout(emailGatewayQueries.hasProcessed(headerMessageId, { strict: true }), POLL_CALL_TIMEOUT_MS, 'Ledger check'))
          ) {
            await markRead(ref.id, 'Gmail mark-read (duplicate)');
            outcomes.push({ uid: ref.id, messageId: headerMessageId, status: EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED });
            continue;
          }

          const result = await emailGateway.processMessage(rawSource, config);
          const resolvedMessageId = (result.message && result.message.messageId) || dedupeKey;

          await emailGatewayQueries.recordProcessed({
            messageId: resolvedMessageId,
            status: result.status,
            detail: result.detail,
            fromAddress: result.message ? result.message.fromAddress : null,
            subject: result.message ? result.message.subject : null,
            rfqId: result.rfq ? result.rfq.id : null,
            rfqNumber:
              result.rfqs && result.rfqs.length > 1
                ? result.rfqs.map((r) => r.rfqNumber).join(', ')
                : result.rfq
                ? result.rfq.rfqNumber
                : null,
          });

          if (result.status === INGESTION_OUTCOME.INGESTED || result.status === INGESTION_OUTCOME.QUOTE_INGESTED) {
            state.ingestedThisRun += 1;
          }
          // After the ledger write, bounded and self-swallowed: a slow mark-read
          // must never reach the catch below and overwrite a correct outcome
          // with FAILED. If it times out the message is still unread and the
          // ledger check above catches it next poll.
          await markRead(ref.id, 'Gmail mark-read (post-process)');
          outcomes.push({ uid: ref.id, messageId: resolvedMessageId, status: result.status });
        } catch (err) {
          // A failure here is usually transient (Gemini or Gmail timeout, D1
          // hiccup). The message is left unread and retried on later polls, up
          // to EMAIL_GATEWAY_MAX_ATTEMPTS, instead of being written off — and
          // marked read — after the first one.
          const attempt = (await emailGatewayQueries.countFailedAttempts(dedupeKey)) + 1;
          const exhausted = attempt >= EMAIL_GATEWAY_MAX_ATTEMPTS;
          logger.error(
            `Inbound message could not be processed (Gmail API), attempt ${attempt}/${EMAIL_GATEWAY_MAX_ATTEMPTS}`,
            err,
            'EMAIL_GATEWAY'
          );
          await emailGatewayQueries
            .recordProcessed({
              messageId: exhausted ? dedupeKey : `${dedupeKey}#attempt-${attempt}`,
              status: INGESTION_OUTCOME.FAILED,
              detail: `${err.message} (attempt ${attempt}/${EMAIL_GATEWAY_MAX_ATTEMPTS})`,
              fromAddress: err.fromAddress || null,
              subject: err.subject || null,
            })
            .catch(() => {});
          if (exhausted) {
            await markRead(ref.id, 'Gmail mark-read (failed)');
            // Out of retries: tell the buyer their requirement was not raised,
            // rather than leaving them waiting for an acknowledgement.
            if (typeof err.onGiveUp === 'function') {
              await Promise.resolve()
                .then(() => err.onGiveUp())
                .catch((notifyErr) => logger.error('Failed to send give-up notice to buyer', notifyErr, 'EMAIL_GATEWAY'));
            }
          }
          outcomes.push({ uid: ref.id, messageId: dedupeKey, status: INGESTION_OUTCOME.FAILED, willRetry: !exhausted });
        }
      }
      pageToken = listRes.data.nextPageToken;
    } while (pageToken && workDone < config.maxPerPoll && !ledgerUnavailable && !outOfTime && pages < EMAIL_GATEWAY_MAX_LIST_PAGES);

    state.lastError = ledgerUnavailable ? 'Email ingestion ledger unavailable; unread mail left for the next poll' : null;

    // Acknowledgements are buyer mail, so only the buyer inbox poll retries
    // them; skipped when the ledger is down or the poll is already out of time.
    let acknowledgements = null;
    if (!config.isVendorMailbox && !ledgerUnavailable && !outOfTime) {
      acknowledgements = await emailGateway.retryPendingAcknowledgements().catch((ackErr) => {
        logger.error('Retrying pending RFQ acknowledgements failed', ackErr, 'EMAIL_GATEWAY');
        return null;
      });
    }

    return {
      skipped: false,
      considered: state.consideredThisRun,
      ingested: state.ingestedThisRun,
      pending: Math.max((lastListRes.data.resultSizeEstimate || lastPageSize) - lastPageSize, 0),
      outcomes,
      acknowledgements,
    };
  } catch (err) {
    // An API or auth failure (e.g. an insufficiently-scoped refresh token).
    // Reported through status rather than thrown, same convention as the
    // IMAP path, so the panel can explain it and the interval keeps trying.
    state.lastError = err.message;
    logger.error(`Email gateway poll failed (Gmail API): ${err.message}`, err, 'EMAIL_GATEWAY');
    return { skipped: false, error: err.message, considered: state.consideredThisRun, outcomes };
  } finally {
    state.isPolling = false;
    state.lastPollAt = new Date().toISOString();
    state.lastPollDurationMs = Date.now() - startedAt;
  }
}

// Vendor replies arrive in the vendor identity's Gmail inbox, read with the
// vendor token. Messages go through the same processMessage path as buyer mail.
async function pollVendorViaGmailApi(config = resolveVendorConfig()) {
  return pollViaGmailApi(config, {
    auth: mailerService.getVendorGmailOAuthClient(),
    state: vendorRuntime,
  });
}

/**
 * Read the mailbox once and ingest whatever is new, via the Gmail REST API.
 *
 * IMAP support was removed: Cloudflare Workers cannot hold an IMAP socket
 * open, so pollViaGmailApi() (defined above) is the only inbound transport
 * now — this is a thin, named entry point kept for callers/tests that poll
 * the buyer inbox specifically.
 */
async function pollOnce(config = resolveConfig()) {
  return emailGateway.pollViaGmailApi(config);
}

/**
 * Read the vendor mailbox once and ingest vendor quote replies, via the
 * vendor Gmail REST API identity. Same reasoning as pollOnce() above.
 */
async function pollVendorOnce(config = resolveVendorConfig()) {
  return emailGateway.pollVendorViaGmailApi(config);
}

/**
 * Start background watching for buyer requisition mailbox.
 */
function startBuyerPolling(config = resolveConfig()) {
  if (runtime.pollTimer) return { started: false, reason: EMAIL_GATEWAY_MESSAGES.ALREADY_STARTED };
  if (!config.enabled) return { started: false, reason: EMAIL_GATEWAY_MESSAGES.DISABLED };
  if (!isConfigured(config)) return { started: false, reason: EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED };

  const configurationFault = describeConfigurationFault(config);
  if (configurationFault) {
    runtime.lastError = configurationFault;
    return { started: false, reason: configurationFault };
  }

  runtime.watchingSince = new Date().toISOString();
  runtime.pollTimer = setInterval(() => {
    emailGateway.pollOnce(resolveConfig()).catch((err) => {
      logger.error('Buyer email gateway interval poll threw', err, 'EMAIL_GATEWAY');
    });
  }, config.pollIntervalMs);
  if (typeof runtime.pollTimer.unref === 'function') runtime.pollTimer.unref();

  logger.info(
    `Buyer email ingestion gateway watching ${config.user} every ${Math.round(config.pollIntervalMs / 1000)}s`,
    { mailbox: config.mailbox },
    'EMAIL_GATEWAY'
  );
  return { started: true, pollIntervalMs: config.pollIntervalMs };
}

/**
 * Start background watching for vendor quotation mailbox.
 */
function startVendorPolling(config = resolveVendorConfig()) {
  if (vendorRuntime.pollTimer) return { started: false, reason: EMAIL_GATEWAY_MESSAGES.ALREADY_STARTED };
  if (!config.enabled) return { started: false, reason: EMAIL_GATEWAY_MESSAGES.DISABLED };
  if (!isConfigured(config)) return { started: false, reason: EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED };

  const configurationFault = describeConfigurationFault(config);
  if (configurationFault) {
    vendorRuntime.lastError = configurationFault;
    return { started: false, reason: configurationFault };
  }

  vendorRuntime.watchingSince = new Date().toISOString();
  vendorRuntime.pollTimer = setInterval(() => {
    emailGateway.pollVendorOnce(resolveVendorConfig()).catch((err) => {
      logger.error('Vendor quotation gateway interval poll threw', err, 'EMAIL_GATEWAY');
    });
  }, config.pollIntervalMs);
  if (typeof vendorRuntime.pollTimer.unref === 'function') vendorRuntime.pollTimer.unref();

  logger.info(
    `Vendor quotation gateway watching ${config.user} every ${Math.round(config.pollIntervalMs / 1000)}s`,
    { mailbox: config.mailbox },
    'EMAIL_GATEWAY'
  );
  return { started: true, pollIntervalMs: config.pollIntervalMs };
}

/**
 * Run one polling pass across both monitored inboxes:
 *   1. Buyer Requisitions Mailbox (e.g. rfq@procucev.com)
 *   2. Vendor Quotations Mailbox (srinu20252026@gmail.com)
 *
 * Executes both in parallel using Promise.allSettled so an error in one inbox
 * never blocks or disrupts the other.
 */
async function pollBothInboxesOnce(buyerConfig = resolveConfig(), vendorConfig = resolveVendorConfig()) {
  logger.info('Executing scheduled dual-inbox email poll cycle', {}, 'EMAIL_GATEWAY');
  const [buyerSettled, vendorSettled] = await Promise.allSettled([
    emailGateway.pollOnce(buyerConfig),
    // Vendor replies are read through the vendor Gmail identity only. The IMAP
    // path cannot connect from a Worker, so it is not used here.
    emailGateway.pollVendorViaGmailApi(vendorConfig),
  ]);

  const buyer = buyerSettled.status === 'fulfilled'
    ? buyerSettled.value
    : { skipped: false, error: (buyerSettled.reason && buyerSettled.reason.message) || 'Buyer poll failed' };

  const vendor = vendorSettled.status === 'fulfilled'
    ? vendorSettled.value
    : { skipped: false, error: (vendorSettled.reason && vendorSettled.reason.message) || 'Vendor poll failed' };

  const result = {
    executedAt: new Date().toISOString(),
    buyerMailbox: {
      address: buyerConfig.address || buyerConfig.user || EMAIL_GATEWAY_CONFIG.DEFAULT_GATEWAY_ADDRESS,
      ...buyer,
    },
    vendorMailbox: {
      address: vendorConfig.address || vendorConfig.user || VENDOR_EMAIL_GATEWAY_CONFIG.DEFAULT_GATEWAY_ADDRESS,
      ...vendor,
    },
    totalConsidered: (buyer.considered || 0) + (vendor.considered || 0),
    totalIngested: (buyer.ingested || 0) + (vendor.ingested || 0),
  };

  logger.info(
    `Dual-inbox poll completed: ${result.totalIngested} ingested of ${result.totalConsidered} considered across both inboxes`,
    {
      buyerIngested: buyer.ingested || 0,
      vendorIngested: vendor.ingested || 0,
      buyerConsidered: buyer.considered || 0,
      vendorConsidered: vendor.considered || 0,
    },
    'EMAIL_GATEWAY'
  );

  return result;
}

/**
 * Begin polling on intervals for both buyer and vendor mailboxes.
 * When called without arguments (e.g. from server.js), launches both buyer and vendor watchers.
 * When called with an explicit config (e.g. unit tests or specific runner), controls that target.
 */
function startPolling(config, vendorConfig) {
  if (arguments.length === 0) {
    const buyerResult = startBuyerPolling(resolveConfig());
    const vendorResult = startVendorPolling(resolveVendorConfig());
    return {
      started: buyerResult.started || vendorResult.started,
      pollIntervalMs: buyerResult.pollIntervalMs || vendorResult.pollIntervalMs,
      buyer: buyerResult,
      vendor: vendorResult,
    };
  }

  const buyerResult = startBuyerPolling(config || resolveConfig());
  if (vendorConfig) {
    const vendorResult = startVendorPolling(vendorConfig);
    return {
      started: buyerResult.started || vendorResult.started,
      pollIntervalMs: buyerResult.pollIntervalMs || vendorResult.pollIntervalMs,
      buyer: buyerResult,
      vendor: vendorResult,
    };
  }

  return buyerResult;
}

/** Stop intervals for both buyer and vendor mailboxes. */
function stopPolling() {
  const buyerWasRunning = !!runtime.pollTimer;
  if (runtime.pollTimer) {
    clearInterval(runtime.pollTimer);
    runtime.pollTimer = null;
  }
  if (vendorRuntime.pollTimer) {
    clearInterval(vendorRuntime.pollTimer);
    vendorRuntime.pollTimer = null;
  }
  runtime.isPolling = false;
  vendorRuntime.isPolling = false;
  return buyerWasRunning;
}

/**
 * Everything the gateway panel needs for both buyer and vendor channels.
 */
async function getStatus() {
  const config = emailGateway.resolveConfig();
  const configured = isConfigured(config);
  const vendorConfig = emailGateway.resolveVendorConfig();
  const vendorConfigured = isConfigured(vendorConfig);

  const configurationFault = configured ? describeConfigurationFault(config) : null;
  const lastError = configurationFault || runtime.lastError;

  const vendorFault = vendorConfigured ? describeConfigurationFault(vendorConfig) : null;
  const vendorLastError = vendorFault || vendorRuntime.lastError;

  return {
    enabled: config.enabled,
    configured,
    watching: !!runtime.pollTimer,
    connectionState: resolveConnectionState(config, { lastError, watching: !!runtime.pollTimer }),
    gatewayAddress: config.address || null,
    mailboxUser: config.user || null,
    mailbox: config.mailbox,
    pollIntervalMs: config.pollIntervalMs,
    allowedSenders: config.allowedSenders,
    allowedDomains: config.allowedDomains,
    watchingSince: runtime.watchingSince,
    lastPollAt: runtime.lastPollAt,
    lastPollDurationMs: runtime.lastPollDurationMs,
    lastConnectedAt: runtime.lastConnectedAt,
    lastError,
    isPolling: runtime.isPolling,
    // Which outbound mailboxes/providers can send right now, and which are
    // cooling down after a rate limit or a rejected credential.
    mailDelivery: mailerService.getDeliveryHealth(),
    counts: configured ? await emailGatewayQueries.countsByStatus() : {},
    recent: configured ? await emailGatewayQueries.listRecent() : [],
    ingestedStatus: EMAIL_GATEWAY_CONFIG.INGESTED_STATUS,
    vendorGateway: {
      enabled: vendorConfig.enabled,
      configured: vendorConfigured,
      watching: !!vendorRuntime.pollTimer,
      gatewayAddress: vendorConfig.address || null,
      mailboxUser: vendorConfig.user || null,
      mailbox: vendorConfig.mailbox,
      pollIntervalMs: vendorConfig.pollIntervalMs,
      watchingSince: vendorRuntime.watchingSince,
      lastPollAt: vendorRuntime.lastPollAt,
      lastPollDurationMs: vendorRuntime.lastPollDurationMs,
      lastConnectedAt: vendorRuntime.lastConnectedAt,
      lastError: vendorLastError,
      isPolling: vendorRuntime.isPolling,
    },
  };
}

// Mutable holder, like viewModule in db/view.js, so the interval callback and
// pollOnce resolve their collaborators at call time and stay substitutable.
const emailGateway = {
  runtime,
  vendorRuntime,
  INGESTION_OUTCOME,
  resolveConfig,
  resolveVendorConfig,
  isConfigured,
  describeConfigurationFault,
  resolveConnectionState,
  resolveSenderAuthorisation,
  resolveBuyerRegisteredLocation,
  processLineItemsAndGroups,
  extractRfqReferenceFromEmail,
  resolveVendorFromEmail,
  processVendorQuoteMessage,
  processMessage,
  isSystemOrAutomatedSender,
  isOwnNoticeSubject,
  shouldSendAutoReply,
  sendAutoReply,
  extractHeaderMessageId,
  checkRfqCredits,
  storeEmailAttachments,
  queueAcknowledgement,
  retryPendingAcknowledgements,
  RetryableIngestionError,
  AUTO_REPLY_KIND,
  EMAIL_GATEWAY_MAX_ATTEMPTS,
  POLL_WORK_BUDGET_MS,
  EMAIL_GATEWAY_LEDGER_UNAVAILABLE,
  resetAutoReplyMemory: () => recentAutoReplies.clear(),
  pollOnce,
  pollViaGmailApi,
  pollVendorOnce,
  pollVendorViaGmailApi,
  pollBothInboxesOnce,
  startPolling,
  startBuyerPolling,
  startVendorPolling,
  stopPolling,
  getStatus,
};

module.exports = emailGateway;
