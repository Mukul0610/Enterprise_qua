// ==============================================================================
// EMAIL INGESTION GATEWAY QUERIES (Neon PostgreSQL)
// ==============================================================================
// The ledger of inbound messages the autonomous gateway has already considered.
//
// Its job is idempotence. Marking a message \Seen over IMAP is not a sufficient
// guard: the flag write can fail after the RFQ was already created, another mail
// client can clear it, and a re-delivered message arrives unflagged. Any of those
// would raise the same requisition twice and circulate it to vendors again, so the
// authoritative check is this table, keyed on the message's own Message-ID.
// ==============================================================================

const pool = require('./pool');
const { logger } = require('../services/loggerService');

const memoryProcessedMessageIds = new Set();

/** Outcomes recorded against a considered message. */
const INGESTION_OUTCOME = {
  INGESTED: 'INGESTED',
  QUOTE_INGESTED: 'QUOTE_INGESTED',
  QUOTE_VALIDATION_FAILED: 'QUOTE_VALIDATION_FAILED',
  SENDER_NOT_ALLOWED: 'SENDER_NOT_ALLOWED',
  NO_LINE_ITEMS: 'NO_LINE_ITEMS',
  UNREADABLE: 'UNREADABLE',
  FAILED: 'FAILED',
  LINE_ITEMS_EXCEED_LIMIT: 'LINE_ITEMS_EXCEED_LIMIT',
  INVALID_RFQ: 'INVALID_RFQ',
  VENDOR_NOT_FOUND: 'VENDOR_NOT_FOUND',
  SELF_MAIL_IGNORED: 'SELF_MAIL_IGNORED',
  SKIPPED_OUTBOUND: 'SKIPPED_OUTBOUND',
  CREDITS_EXHAUSTED: 'CREDITS_EXHAUSTED',
  PORTAL_SUBMISSION_REQUIRED: 'PORTAL_SUBMISSION_REQUIRED',
  // A buyer's emailed RFQ refused because their free trial credits ran out —
  // kept apart from CREDITS_EXHAUSTED, which is the vendor quotation limit.
  RFQ_CREDITS_EXHAUSTED: 'RFQ_CREDITS_EXHAUSTED',
  // One RFQ raised from one delivery-location group of an email, keyed
  // `<Message-ID>#rfq-<n>`, so a retried email does not raise it a second time.
  RFQ_GROUP_CREATED: 'RFQ_GROUP_CREATED',
  // An RFQ acknowledgement the buyer has not been sent yet (every mail provider
  // failed), keyed `<RFQ key>#ack`. The poller retries it until it goes out
  // (ACK_SENT) or is too old to be useful (ACK_ABANDONED).
  ACK_PENDING: 'ACK_PENDING',
  ACK_SENT: 'ACK_SENT',
  ACK_ABANDONED: 'ACK_ABANDONED',
};


/**
 * Has this message already been considered?
 *
 * Fails closed: an unreadable ledger reports the message as already processed, so
 * an outage skips a requisition rather than risking a duplicate RFQ reaching
 * vendors. The message stays unflagged in the mailbox, so it is picked up on a
 * later poll once the database is reachable again.
 *
 * `strict: true` throws instead of guessing, for the inbox poller: it marks
 * "already processed" messages read, so a guessed `true` during an outage
 * would silently drop every message that arrived in it.
 */
async function hasProcessed(messageId, { strict = false } = {}) {
  if (!messageId) return false;
  const key = String(messageId);
  if (process.env.NODE_ENV !== 'test' && memoryProcessedMessageIds.has(key)) return true;
  try {
    const rows = await pool.rows(
      'select 1 from email_ingestion_log where message_id = $1 limit 1',
      [key],
      { d1: true }
    );
    if (rows.length > 0) {
      memoryProcessedMessageIds.add(key);
      return true;
    }
    return false;
  } catch (err) {
    logger.error('Email ingestion ledger could not be read', err, 'EMAIL_GATEWAY');
    if (strict) throw err;
    return true;
  }
}

/**
 * How many earlier messages from this sender ended in one of `statuses` since
 * `since` (optionally for one RFQ). Drives the auto-reply cooldown, so a sender
 * that keeps writing — or an auto-responder replying to our replies — gets one
 * notice per window instead of one per message.
 *
 * Throws on a ledger error; the caller decides which way to fail.
 */
async function countRecentOutcomes({ fromAddress, statuses = [], rfqNumber = null, since }) {
  if (!fromAddress || statuses.length === 0) return 0;
  const params = [String(fromAddress).trim().toLowerCase(), toLedgerTimestamp(since)];
  const statusPlaceholders = statuses.map((status) => {
    params.push(status);
    return `$${params.length}`;
  });
  let rfqClause = '';
  if (rfqNumber) {
    params.push(String(rfqNumber));
    rfqClause = ` and rfq_number = $${params.length}`;
  }
  const rows = await pool.rows(
    `select CAST(count(*) AS INTEGER) as total
       from email_ingestion_log
      where lower(from_address) = $1
        and processed_at >= $2
        and status in (${statusPlaceholders.join(', ')})${rfqClause}`,
    params,
    { d1: true }
  );
  return Number((rows[0] && rows[0].total) || 0);
}

/**
 * Failed attempts already recorded for a message (rows keyed
 * `<messageKey>#attempt-<n>`), so a transient failure is retried a bounded
 * number of times instead of being dropped after the first one.
 */
async function countFailedAttempts(messageKey) {
  if (!messageKey) return 0;
  try {
    const rows = await pool.rows(
      'select CAST(count(*) AS INTEGER) as total from email_ingestion_log where message_id like $1',
      [`${String(messageKey)}#attempt-%`],
      { d1: true }
    );
    return Number((rows[0] && rows[0].total) || 0);
  } catch (err) {
    logger.error('Email ingestion attempt count could not be read', err, 'EMAIL_GATEWAY');
    return 0;
  }
}

/**
 * The ledger row recorded under this key, or null when there is none.
 *
 * Throws when the ledger cannot be read: the caller uses it to avoid raising a
 * duplicate RFQ, and a guessed "not there" during an outage would do exactly that.
 */
async function findProcessed(messageId) {
  // No store at all (local run without a database): nothing can have been
  // recorded, so there is nothing to find. Same guard as domainQueries.
  if (!messageId || !pool.hasStorage()) return null;
  const rows = await pool.rows(
    'select message_id, rfq_id, rfq_number, status from email_ingestion_log where message_id = $1 limit 1',
    [String(messageId)],
    { d1: true }
  );
  return rows[0] || null;
}

/**
 * Oldest-first ledger rows in one status, for work the poller retries (pending
 * acknowledgements). Empty on a ledger error: a retry can always wait a poll.
 */
async function listByStatus(status, limit = 5) {
  if (!status || !pool.hasStorage()) return [];
  const capped = Math.min(Math.max(Number(limit) || 5, 1), 50);
  try {
    return await pool.rows(
      `select message_id, rfq_id, rfq_number, from_address, subject, status, detail, processed_at
         from email_ingestion_log
        where status = $1
        order by processed_at asc
        limit $2`,
      [String(status), capped],
      { d1: true }
    );
  } catch (err) {
    logger.error('Email ingestion ledger could not be listed by status', err, 'EMAIL_GATEWAY');
    return [];
  }
}

/**
 * CURRENT_TIMESTAMP is stored as `YYYY-MM-DD HH:MM:SS` (UTC) in D1, so cutoffs
 * are compared in that same text form; Postgres casts it the same way.
 */
function toLedgerTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Record the outcome of considering a message.
 *
 * Upsert rather than insert: a message re-examined after a transient failure has
 * to end up with its final outcome, and a primary-key violation would otherwise
 * abort the poll partway through the batch.
 */
async function recordProcessed({
  messageId,
  status,
  detail = null,
  fromAddress = null,
  subject = null,
  rfqId = null,
  rfqNumber = null,
}) {
  if (!messageId) return false;
  memoryProcessedMessageIds.add(String(messageId));
  try {
    // email_ingestion_log has already been ported to D1 (see d1Bridge.js).
    // CURRENT_TIMESTAMP (not now()) and CAST(... AS INTEGER) (not ::int, below
    // in countsByStatus) are used throughout this file because both are
    // understood by Postgres and SQLite/D1 alike — one query, either backend.
    await pool.query(
      `insert into email_ingestion_log
         (message_id, rfq_id, rfq_number, from_address, subject, status, detail, processed_at)
       values ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       on conflict (message_id) do update set
         rfq_id = excluded.rfq_id,
         rfq_number = excluded.rfq_number,
         from_address = excluded.from_address,
         subject = excluded.subject,
         status = excluded.status,
         detail = excluded.detail,
         processed_at = CURRENT_TIMESTAMP`,
      [
        String(messageId),
        rfqId,
        rfqNumber,
        fromAddress ? String(fromAddress).slice(0, 320) : null,
        subject ? String(subject).slice(0, 2000) : null,
        status,
        detail ? String(detail).slice(0, 2000) : null,
      ],
      { d1: true }
    );
    return true;
  } catch (err) {
    logger.error('Email ingestion outcome could not be recorded', err, 'EMAIL_GATEWAY');
    return false;
  }
}

/**
 * Most recently considered messages, newest first, for the gateway panel.
 *
 * Returns an empty list rather than throwing: the panel is diagnostic, and an
 * unreadable ledger should not take the wizard down with it.
 */
async function listRecent(limit = 15) {
  const capped = Math.min(Math.max(Number(limit) || 15, 1), 100);
  try {
    return await pool.rows(
      `select message_id, rfq_id, rfq_number, from_address, subject, status, detail, processed_at
         from email_ingestion_log
        order by processed_at desc
        limit $1`,
      [capped],
      { d1: true }
    );
  } catch (err) {
    logger.error('Email ingestion ledger could not be listed', err, 'EMAIL_GATEWAY');
    return [];
  }
}

/** Tally by outcome, so the panel can show how the gateway is performing. */
async function countsByStatus() {
  try {
    const rows = await pool.rows(
      'select status, CAST(count(*) AS INTEGER) as total from email_ingestion_log group by status',
      [],
      { d1: true }
    );
    return rows.reduce((acc, row) => ({ ...acc, [row.status]: row.total }), {});
  } catch (err) {
    logger.error('Email ingestion ledger counts could not be read', err, 'EMAIL_GATEWAY');
    return {};
  }
}

module.exports = {
  INGESTION_OUTCOME,
  hasProcessed,
  recordProcessed,
  countRecentOutcomes,
  countFailedAttempts,
  findProcessed,
  listByStatus,
  toLedgerTimestamp,
  listRecent,
  countsByStatus,
};
