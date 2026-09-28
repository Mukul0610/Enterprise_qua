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
//   2. An ingested RFQ lands in 'Parsing', not 'Quotes Pending'. Nothing has
//      reviewed it, and the category manager kanban already has a Parsing column
//      standing empty. Auto-circulating unreviewed inbound mail to vendors is not
//      something that should happen by default.
//   3. Idempotence comes from our own ledger, not from the IMAP \Seen flag. See
//      db/emailGatewayQueries.js for why the flag alone is not enough.
// ==============================================================================

const { ImapFlow } = require('imapflow');
const emailIngestionService = require('./emailIngestionService');
const geminiService = require('./geminiService');
const rfqIngestionService = require('./rfqIngestionService');
const storeService = require('./storeService');
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
  EMAIL_GATEWAY_SMTP_PORTS,
  EMAIL_INGESTION_STATUS,
  resolveBuyerSourcingMode,
  SYSTEM_ACTOR_EMAIL,
  VENDOR_QUOTE_SUPPORT_CC,
} = require('../config/constants');

const { INGESTION_OUTCOME } = emailGatewayQueries;

/** Live state, reported by getStatus and mutated only by the poll loop. */
const runtime = {
  pollTimer: null,
  isPolling: false,
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
    host: (env.EMAIL_GATEWAY_HOST || '').trim(),
    port: Number(env.EMAIL_GATEWAY_PORT || 993),
    secure: String(env.EMAIL_GATEWAY_SECURE || 'true').toLowerCase() !== 'false',
    // IMAP login. An operational credential — this is the account the backend
    // authenticates as, and it is not what a buyer needs to know.
    user: (env.EMAIL_GATEWAY_USER || '').trim(),
    password: env.EMAIL_GATEWAY_PASSWORD || '',
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
    host: (env.VENDOR_EMAIL_GATEWAY_HOST || env.EMAIL_GATEWAY_HOST || 'imap.gmail.com').trim(),
    port: Number(env.VENDOR_EMAIL_GATEWAY_PORT || env.EMAIL_GATEWAY_PORT || 993),
    secure: String(
      env.VENDOR_EMAIL_GATEWAY_SECURE !== undefined
        ? env.VENDOR_EMAIL_GATEWAY_SECURE
        : env.EMAIL_GATEWAY_SECURE || 'true'
    ).toLowerCase() !== 'false',
    user: (env.VENDOR_EMAIL_GATEWAY_USER || 'srinu20252026@gmail.com').trim(),
    // No hardcoded fallback — a Gmail App Password is a live credential and
    // must come from the environment only. An unset password here means the
    // IMAP connection attempt fails/is skipped, same as any other
    // unconfigured gateway var, rather than silently authenticating with a
    // secret baked into source.
    password: env.VENDOR_EMAIL_GATEWAY_PASSWORD || '',
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
  return !!(config.host && config.user && config.password);
}

/**
 * Catch the misconfiguration that cannot be diagnosed from the socket error.
 *
 * Pointing this at an SMTP host or port fails with
 * `SSL routines::wrong version number`, which says nothing about the cause. The
 * check happens before connecting so the panel can name the wrong variable.
 *
 * Returns a message, or null when the combination looks sane.
 */
function describeConfigurationFault(config = resolveConfig()) {
  if (/^smtp\./i.test(config.host)) {
    return EMAIL_GATEWAY_MESSAGES.SMTP_HOST_CONFIGURED.replace('{host}', config.host);
  }
  if (EMAIL_GATEWAY_SMTP_PORTS.includes(config.port)) {
    return EMAIL_GATEWAY_MESSAGES.SMTP_PORT_CONFIGURED.replace('{port}', String(config.port));
  }
  return null;
}

/**
 * Translate a connection failure into something actionable.
 *
 * The raw errors here are OpenSSL and IMAP protocol text — a stack trace
 * mentioning `SSL routines` tells the reader nothing about which environment
 * variable is wrong. The original message is still logged; only the panel gets
 * this version.
 */
function describeConnectionError(err) {
  const message = String((err && err.message) || '');

  if (/wrong version number|packet length too long|record layer/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.TLS_VERSION_MISMATCH;
  }
  if (/AUTHENTICATIONFAILED|Invalid credentials|Username and Password not accepted|LOGIN failed/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.AUTH_REJECTED;
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.HOST_UNRESOLVED;
  }
  if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|timed out/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.HOST_UNREACHABLE;
  }
  if (/certificate|CERT_|self.signed|altname/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.CERTIFICATE_REJECTED;
  }
  return EMAIL_GATEWAY_MESSAGES.CONNECTION_FAILED_FALLBACK;
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
 * Extract referenced RFQ number and lookup target RFQ from subject, body, or thread references.
 */
function extractRfqReferenceFromEmail(message) {
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

  for (const cand of candidates) {
    const foundRfq = storeService.getRFQById(cand);
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
  const mailboxUser = String(config.user || '').trim().toLowerCase();
  const vendorUser = String(
    process.env.VENDOR_EMAIL_GATEWAY_USER ||
    process.env.VENDOR_SMTP_USER ||
    'srinu20252026@gmail.com'
  ).trim().toLowerCase();
  const buyerUser = String(
    process.env.EMAIL_GATEWAY_USER ||
    process.env.SMTP_USER ||
    'rfqprocucev@gmail.com'
  ).trim().toLowerCase();

  return (
    senderEmail === mailboxUser ||
    senderEmail === vendorUser ||
    senderEmail === buyerUser ||
    senderEmail === 'srinu20252026@gmail.com' ||
    senderEmail === 'rfqprocucev@gmail.com'
  );
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

  // Internal gateway accounts can NEVER be a vendor
  if (
    email === vendorGatewayAddr ||
    email === buyerGatewayAddr ||
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

  // Validate vendor quotation eligibility: 5 free quotation credits, then active subscription required
  const eligibility = storeService.checkVendorQuotationEligibility(vendorRecord);
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

    try {
      await mailerService.sendVendorCreditsExhaustedEmail(message.fromAddress, {
        rfq: targetRfq,
        rfqNumber: targetRfq.rfqNumber,
        rfqTitle: targetRfq.title,
        vendorName: vendorRecord.name,
        upgradeUrl: typeof mailerService.vendorUpgradeUrl === 'function' ? mailerService.vendorUpgradeUrl() : undefined,
        cc: ccList.length > 0 ? ccList.join(', ') : undefined,
      });
    } catch (mailErr) {
      logger.error('Failed to send vendor credits exhausted email', mailErr, 'EMAIL_GATEWAY');
    }

    return {
      status: INGESTION_OUTCOME.CREDITS_EXHAUSTED,
      detail: (EMAIL_GATEWAY_MESSAGES.CREDITS_EXHAUSTED_DETAIL || 'Vendor quotation credits exhausted')
        .replace('{rfqNumber}', targetRfq.rfqNumber)
        .replace('{vendorName}', vendorRecord.name),
      message,
      rfq: targetRfq,
    };
  }

  const extraction = await geminiService.extractQuotationFromEmail(
    {
      bodyText: message.bodyText || message.textBody || message.text,
      subject: message.subject,
      fromAddress: message.fromAddress,
      attachments: message.attachments || [],
    },
    targetRfq
  );

  const rfqItems = targetRfq.extractedEntities || targetRfq.lineItems || [];
  const rfqQty = rfqItems.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0) || 1;

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

    try {
      await mailerService.sendQuoteFailureEmail(message.fromAddress, {
        rfqNumber: targetRfq.rfqNumber,
        rfqTitle: targetRfq.title,
        vendorName: vendorRecord.name,
        reason: 'Unit Price (₹) is mandatory and must be greater than 0.',
        missingFields: ['Unit Price (₹)'],
        cc: ccList.length > 0 ? ccList.join(', ') : undefined,
      });
    } catch (mailErr) {
      logger.error('Failed to send vendor quote failure email', mailErr, 'EMAIL_GATEWAY');
    }

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

  try {
    await mailerService.sendQuoteAcknowledgementEmail(message.fromAddress, {
      rfqNumber: targetRfq.rfqNumber,
      rfqTitle: targetRfq.title,
      vendorName: vendorRecord.name,
      quote,
      cc: ccList.length > 0 ? ccList.join(', ') : undefined,
    });
  } catch (mailErr) {
    logger.error('Failed to send vendor quote acknowledgement email', mailErr, 'EMAIL_GATEWAY');
  }

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
  const { targetRfq, referencedNumber } = extractRfqReferenceFromEmail(message);
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
    if (message.fromAddress) {
      try {
        await mailerService.sendUnauthorizedBuyerNotificationEmail(message.fromAddress, {
          subject: message.subject,
          gatewayAddress: config.user || EMAIL_GATEWAY_CONFIG.DEFAULT_GATEWAY_ADDRESS,
        });
      } catch (mailErr) {
        logger.error('Failed to dispatch registration notification to unauthorized sender', mailErr, 'EMAIL_GATEWAY');
      }
    }
    return { status: INGESTION_OUTCOME.SENDER_NOT_ALLOWED, detail: authorisation.reason, message };
  }

  const extraction = await geminiService.extractLineItems(prepared.extractionInput);
  if (extraction.status !== geminiService.EXTRACTION_STATUS.SUCCESS) {
    return {
      status: INGESTION_OUTCOME.NO_LINE_ITEMS,
      detail: EMAIL_GATEWAY_MESSAGES.EXTRACTION_FAILED.replace('{status}', extraction.status),
      message,
    };
  }

  const buyerLocation = await emailGateway.resolveBuyerRegisteredLocation(authorisation.buyerAccount);
  const groups = emailGateway.processLineItemsAndGroups(extraction.lineItems, extraction, buyerLocation);

  if (groups.length === 0) {
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
      return {
        status: INGESTION_OUTCOME.LINE_ITEMS_EXCEED_LIMIT,
        detail,
        message,
      };
    }
  }

  const createdRFQs = [];
  let totalAccepted = 0;
  let totalNeedsReview = 0;

  for (const group of groups) {
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

    const sourcingMode = resolveBuyerSourcingMode(authorisation.buyerAccount);

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
        attachments: [],
      },
      authorisation.buyerAccount
    );

    createdRFQs.push(created);

    // Dispatch RFQ creation acknowledgement email to the buyer
    if (message.fromAddress) {
      try {
        const buyerName =
          authorisation.buyerAccount?.contactPerson ||
          authorisation.buyerAccount?.organizationName ||
          message.fromName ||
          'Valued Buyer';

        await mailerService.sendRfqAcknowledgementEmail({
          to: message.fromAddress,
          buyerName,
          rfqNumber: created.rfqNumber,
          rfqTitle: created.title,
        });
      } catch (ackErr) {
        logger.error('Failed to dispatch RFQ acknowledgement email to buyer', ackErr, 'EMAIL_GATEWAY');
      }
    }

    logger.audit(
      `RFQ ${created.rfqNumber} raised from inbound email`,
      message.fromAddress,
      { rfqId: created.id, messageId: message.messageId, accepted: classification.accepted }
    );
  }

  if (createdRFQs.length === 0) {
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
 * Read the mailbox once and ingest whatever is new.
 *
 * Only unseen messages are fetched, and only up to `maxPerPoll` per run so a
 * backlog cannot spend an unbounded amount of time (and Gemini quota) in one
 * pass — the remainder is picked up next tick.
 *
 * A message is marked \Seen only after its outcome is in the ledger. Doing it the
 * other way round would lose the requisition entirely if the ledger write failed.
 *
 * Overlapping runs are refused rather than queued: a slow extraction should not
 * cause two passes to fetch the same unseen message concurrently.
 */
async function pollOnce(config = resolveConfig()) {
  if (runtime.isPolling) {
    return { skipped: true, reason: EMAIL_GATEWAY_MESSAGES.POLL_ALREADY_RUNNING };
  }
  if (!isConfigured(config)) {
    return { skipped: true, reason: EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED };
  }

  // Refused before opening a socket: the failure is already certain, and the
  // socket error it would produce names none of the offending variables.
  const configurationFault = describeConfigurationFault(config);
  if (configurationFault) {
    runtime.lastError = configurationFault;
    logger.error(
      'Email gateway is misconfigured and was not contacted',
      new Error(configurationFault),
      'EMAIL_GATEWAY'
    );
    return { skipped: true, reason: configurationFault };
  }

  runtime.isPolling = true;
  runtime.consideredThisRun = 0;
  runtime.ingestedThisRun = 0;
  const startedAt = Date.now();
  const outcomes = [];

  const client = new emailGateway.ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    // The library logs every protocol frame at info level otherwise, which buries
    // app.log and would include message headers.
    logger: false,
  });

  if (typeof client.on === 'function') {
    client.on('error', (err) => {
      logger.warn(
        `IMAP client socket notice: ${err ? err.message : 'Unknown'}`,
        { code: err && err.code, connId: err && err._connId },
        'EMAIL_GATEWAY'
      );
    });
  }

  try {
    await client.connect();
    runtime.lastConnectedAt = new Date().toISOString();
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      // Bounded by when the gateway started watching, not just by the unseen
      // flag. A real mailbox has a backlog — the account this was first pointed at
      // had 110 unread messages — and without this bound the gateway would work
      // through years of unrelated mail, spend its per-poll budget on it, and
      // never reach the requisition that just arrived.
      const unseenUids = await client.search({ seen: false, since: new Date(runtime.watchingSince) });
      const batch = (unseenUids || []).slice(0, config.maxPerPoll);

      for (const uid of batch) {
        runtime.consideredThisRun += 1;
        let messageId = null;
        try {
          const fetched = await client.fetchOne(String(uid), { source: true, envelope: true });
          if (!fetched || !fetched.source) {
            outcomes.push({ uid, status: INGESTION_OUTCOME.UNREADABLE });
            continue;
          }
          messageId = fetched.envelope && fetched.envelope.messageId ? fetched.envelope.messageId : null;
          const dedupeKey = messageId || `uid-${uid}@${config.mailbox}`;

          // Ours is the authoritative dedupe check; see emailGatewayQueries.
          if (await emailGatewayQueries.hasProcessed(dedupeKey)) {
            await client.messageFlagsAdd(String(uid), ['\\Seen']);
            outcomes.push({ uid, messageId: dedupeKey, status: EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED });
            continue;
          }

          const result = await emailGateway.processMessage(fetched.source, config);
          const resolvedMessageId =
            messageId || (result.message && result.message.messageId) || `uid-${uid}@${config.mailbox}`;

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

          if (
            result.status === INGESTION_OUTCOME.INGESTED ||
            result.status === INGESTION_OUTCOME.QUOTE_INGESTED ||
            result.status === INGESTION_OUTCOME.CREDITS_EXHAUSTED ||
            result.status === INGESTION_OUTCOME.SKIPPED_OUTBOUND
          ) {
            if (result.status !== INGESTION_OUTCOME.SKIPPED_OUTBOUND && result.status !== INGESTION_OUTCOME.CREDITS_EXHAUSTED) {
              runtime.ingestedThisRun += 1;
            }
            // Marked read only for a message we actually acted on, and only after
            // the ledger write, so a failed write leaves it to be retried. Mail
            // the gateway rejected is left untouched: it belongs to the mailbox
            // owner, not to us, and the ledger already stops it being
            // reconsidered on the next poll.
            await client.messageFlagsAdd(String(uid), ['\\Seen']);
          }
          outcomes.push({ uid, messageId: resolvedMessageId, status: result.status });
        } catch (err) {
          logger.error('Inbound message could not be processed', err, 'EMAIL_GATEWAY');
          if (messageId) {
            await emailGatewayQueries.recordProcessed({
              messageId,
              status: INGESTION_OUTCOME.FAILED,
              detail: err.message,
            });
          }
          outcomes.push({ uid, messageId, status: INGESTION_OUTCOME.FAILED });
        }
      }

      runtime.lastError = null;
      return {
        skipped: false,
        considered: runtime.consideredThisRun,
        ingested: runtime.ingestedThisRun,
        pending: Math.max((unseenUids || []).length - batch.length, 0),
        outcomes,
      };
    } finally {
      lock.release();
    }
  } catch (err) {
    // A connection or authentication failure. Reported through status rather than
    // thrown, so the panel can explain it and the interval keeps trying. The raw
    // OpenSSL/IMAP text goes to the log; the panel gets the actionable version.
    runtime.lastError = err.message;
    logger.error(`Email gateway poll failed: ${err.message}`, err, 'EMAIL_GATEWAY');
    return { skipped: false, error: err.message, considered: runtime.consideredThisRun, outcomes };
  } finally {
    try {
      await client.logout();
    } catch {
      // Already disconnected; nothing useful to do.
    }
    runtime.isPolling = false;
    runtime.lastPollAt = new Date().toISOString();
    runtime.lastPollDurationMs = Date.now() - startedAt;
  }
}

/**
 * Begin polling on an interval.
 *
 * The first backend background task, so it is deliberately conservative: it
 * refuses to start twice, does nothing when unconfigured or disabled, and unrefs
 * the timer so it can never hold the process open on shutdown.
 */
/**
 * Read the vendor mailbox (srinu20252026@gmail.com) once and ingest vendor quote replies.
 */
async function pollVendorOnce(config = resolveVendorConfig()) {
  if (vendorRuntime.isPolling) {
    return { skipped: true, reason: EMAIL_GATEWAY_MESSAGES.POLL_ALREADY_RUNNING };
  }
  if (!isConfigured(config)) {
    return { skipped: true, reason: EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED };
  }

  const configurationFault = describeConfigurationFault(config);
  if (configurationFault) {
    vendorRuntime.lastError = configurationFault;
    logger.error(
      'Vendor email gateway is misconfigured and was not contacted',
      new Error(configurationFault),
      'EMAIL_GATEWAY'
    );
    return { skipped: true, reason: configurationFault };
  }

  vendorRuntime.isPolling = true;
  vendorRuntime.consideredThisRun = 0;
  vendorRuntime.ingestedThisRun = 0;
  const startedAt = Date.now();
  const outcomes = [];

  const client = new emailGateway.ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  if (typeof client.on === 'function') {
    client.on('error', (err) => {
      logger.warn(
        `Vendor IMAP client socket notice: ${err ? err.message : 'Unknown'}`,
        { code: err && err.code, connId: err && err._connId },
        'EMAIL_GATEWAY'
      );
    });
  }

  try {
    await client.connect();
    vendorRuntime.lastConnectedAt = new Date().toISOString();
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      const unseenUids = await client.search({ seen: false, since: new Date(vendorRuntime.watchingSince) });
      const batch = (unseenUids || []).slice(0, config.maxPerPoll);

      for (const uid of batch) {
        vendorRuntime.consideredThisRun += 1;
        let messageId = null;
        try {
          const fetched = await client.fetchOne(String(uid), { source: true, envelope: true });
          if (!fetched || !fetched.source) {
            outcomes.push({ uid, status: INGESTION_OUTCOME.UNREADABLE });
            continue;
          }
          messageId = fetched.envelope && fetched.envelope.messageId ? fetched.envelope.messageId : null;
          const dedupeKey = messageId || `uid-${uid}@vendor-${config.mailbox}`;

          if (await emailGatewayQueries.hasProcessed(dedupeKey)) {
            await client.messageFlagsAdd(String(uid), ['\\Seen']);
            outcomes.push({ uid, messageId: dedupeKey, status: EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED });
            continue;
          }

          const result = await emailGateway.processMessage(fetched.source, config);
          const resolvedMessageId =
            messageId || (result.message && result.message.messageId) || `uid-${uid}@vendor-${config.mailbox}`;

          await emailGatewayQueries.recordProcessed({
            messageId: resolvedMessageId,
            status: result.status,
            detail: result.detail,
            fromAddress: result.message ? result.message.fromAddress : null,
            subject: result.message ? result.message.subject : null,
            rfqId: result.rfq ? result.rfq.id : null,
            rfqNumber: result.rfq ? result.rfq.rfqNumber : null,
          });

          if (
            result.status === INGESTION_OUTCOME.INGESTED ||
            result.status === INGESTION_OUTCOME.QUOTE_INGESTED ||
            result.status === INGESTION_OUTCOME.CREDITS_EXHAUSTED ||
            result.status === INGESTION_OUTCOME.SKIPPED_OUTBOUND
          ) {
            if (result.status !== INGESTION_OUTCOME.SKIPPED_OUTBOUND && result.status !== INGESTION_OUTCOME.CREDITS_EXHAUSTED) {
              vendorRuntime.ingestedThisRun += 1;
            }
            await client.messageFlagsAdd(String(uid), ['\\Seen']);
          }
          outcomes.push({ uid, messageId: resolvedMessageId, status: result.status });
        } catch (err) {
          logger.error('Inbound vendor message could not be processed', err, 'EMAIL_GATEWAY');
          if (messageId) {
            await emailGatewayQueries.recordProcessed({
              messageId,
              status: INGESTION_OUTCOME.FAILED,
              detail: err.message,
            });
          }
          outcomes.push({ uid, messageId, status: INGESTION_OUTCOME.FAILED });
        }
      }

      vendorRuntime.lastError = null;
      return {
        skipped: false,
        considered: vendorRuntime.consideredThisRun,
        ingested: vendorRuntime.ingestedThisRun,
        pending: Math.max((unseenUids || []).length - batch.length, 0),
        outcomes,
      };
    } finally {
      lock.release();
    }
  } catch (err) {
    vendorRuntime.lastError = err.message;
    logger.error(`Vendor email gateway poll failed: ${err.message}`, err, 'EMAIL_GATEWAY');
    return { skipped: false, error: err.message, considered: vendorRuntime.consideredThisRun, outcomes };
  } finally {
    try {
      await client.logout();
    } catch {
      // Already disconnected
    }
    vendorRuntime.isPolling = false;
    vendorRuntime.lastPollAt = new Date().toISOString();
    vendorRuntime.lastPollDurationMs = Date.now() - startedAt;
  }
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
    { mailbox: config.mailbox, host: config.host },
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
    { mailbox: config.mailbox, host: config.host },
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
    emailGateway.pollVendorOnce(vendorConfig),
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
    host: config.host || null,
    pollIntervalMs: config.pollIntervalMs,
    allowedSenders: config.allowedSenders,
    allowedDomains: config.allowedDomains,
    watchingSince: runtime.watchingSince,
    lastPollAt: runtime.lastPollAt,
    lastPollDurationMs: runtime.lastPollDurationMs,
    lastConnectedAt: runtime.lastConnectedAt,
    lastError,
    isPolling: runtime.isPolling,
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
      host: vendorConfig.host || null,
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
  describeConnectionError,
  resolveConnectionState,
  resolveSenderAuthorisation,
  resolveBuyerRegisteredLocation,
  processLineItemsAndGroups,
  extractRfqReferenceFromEmail,
  resolveVendorFromEmail,
  processVendorQuoteMessage,
  processMessage,
  pollOnce,
  pollVendorOnce,
  pollBothInboxesOnce,
  startPolling,
  startBuyerPolling,
  startVendorPolling,
  stopPolling,
  getStatus,
  ImapFlow,
};

module.exports = emailGateway;
