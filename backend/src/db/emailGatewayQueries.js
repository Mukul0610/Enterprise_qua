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
};


/**
 * Has this message already been considered?
 *
 * Fails closed: an unreadable ledger reports the message as already processed, so
 * an outage skips a requisition rather than risking a duplicate RFQ reaching
 * vendors. The message stays unflagged in the mailbox, so it is picked up on a
 * later poll once the database is reachable again.
 */
async function hasProcessed(messageId) {
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
    return true;
  }
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
  listRecent,
  countsByStatus,
};
