// ==============================================================================
// VENDOR MASTER & PO DATA INGESTION SERVICE
// ==============================================================================
// Orchestrates the buyer's five-step ingestion run:
//
//   1  Time Horizon      choose and resolve the PO window
//   2  Vendor Master     upload File 1, validate, store
//   3  PO Dump           upload File 2, validate, stamp in/out of horizon, store
//   4  AI Category Join  match PO history to suppliers, classify, buyer reviews
//   5  Dispatch Emails   category notifications and self-map invitations
//
// Three things this service is responsible for that nothing else can be:
//
//   - Organisation scoping. Every entry point resolves organizationId from the
//     session's user row in the database, never from the request body and never
//     from the token's `orgId` claim (the same reasoning as
//     buyerProfileService.resolveBuyerIdentity: a re-parented account must not
//     keep writing to its old organisation with an already-issued token).
//
//   - Step ordering. The business rules are sequential — Vendor Master before PO
//     dump, PO dump before the join, the join before AI — and they are enforced
//     here against the persisted session status, not by hiding a button. A client
//     that posts step 3 first gets a 409 with a readable reason.
//
//   - Keeping the AI suggestion and the buyer's decision apart. Nothing in this
//     file writes an ai_* column on a review path, and nothing writes a buyer_*
//     column on a classification path.
//
// Errors are raised as VendorIngestionError so the controller can map a status
// and a field-level detail without inspecting message text.
// ==============================================================================

const queries = require('../db/vendorIngestionQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const categorizationService = require('./vendorCategorizationService');
const mailerService = require('./mailerService');
const storeService = require('./storeService');
const { logger } = require('./loggerService');
const {
  VALIDATION_SCHEMAS,
  validatePayload,
  formatMessage,
  VENDOR_INGESTION_SESSION_STATUS,
  VENDOR_INGESTION_STEP,
  VENDOR_INGESTION_HORIZON,
  VENDOR_INGESTION_HORIZON_MONTHS,
  VENDOR_MAPPING_STATUS,
  VENDOR_MAPPING_SOURCE,
  VENDOR_AI_PROCESSING_STATUS,
  VENDOR_INGESTION_AI_STATUS,
  VENDOR_DISPATCH_TEMPLATE,
  VENDOR_EMAIL_STATUS,
  VENDOR_DISPATCH_STATUS,
  VENDOR_INGESTION_AUDIT_ACTION,
  VENDOR_CONFIDENCE_BANDS,
  VENDOR_INGESTION_CONFIG,
  VENDOR_INGESTION_MESSAGES,
  normalizePoDate,
} = require('../config/constants');

const LOG_CATEGORY = 'VENDOR_INGESTION_SERVICE';

/**
 * Typed error carrying the HTTP status the controller should respond with.
 *
 * `details` holds per-field validation errors so the client can highlight the
 * offending input rather than showing a single opaque sentence.
 */
class VendorIngestionError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = 'VendorIngestionError';
    this.status = status;
    this.details = details;
  }
}

// ------------------------------------------------------------------------------
// IDENTITY & SCOPING
// ------------------------------------------------------------------------------

/**
 * Resolve the caller to { userId, email, organizationId }.
 *
 * The organisation comes from the `user` row, re-read on every request. The
 * token's own `orgId` claim is deliberately ignored: it was minted when the
 * session started and would let a re-parented account keep writing vendor data
 * into the organisation it used to belong to.
 */
async function resolveBuyerContext(sessionUser) {
  if (!sessionUser || !sessionUser.sub) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.SESSION_MISSING_USER, 401);
  }

  const lookup = await buyerProfileQueries.findProfileByUserId(sessionUser.sub);
  if (!lookup.found) {
    if (lookup.reason === 'ORG_NOT_LINKED') {
      throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.ORGANIZATION_NOT_LINKED, 409);
    }
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.SESSION_MISSING_USER, 401);
  }

  return {
    userId: lookup.profile.userId,
    email: sessionUser.email || lookup.profile.contactEmail || '',
    organizationId: lookup.profile.organizationId,
    organizationName: lookup.profile.companyName || sessionUser.orgName || '',
  };
}

/** Load a session the caller owns, or 404. */
async function requireSession(context, sessionId) {
  const session = await queries.findSession(sessionId, context.organizationId);
  if (!session) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.SESSION_NOT_FOUND, 404);
  }
  return session;
}

// ------------------------------------------------------------------------------
// AUDIT
// ------------------------------------------------------------------------------

/**
 * Record one action in both audit channels.
 *
 * `vendor_ingestion_audit` carries entity_type/entity_id and the before/after
 * values, which is what makes a category change reviewable. `audit_logs` carries
 * the tamper-evident hash chain the rest of the platform uses. Writing one and
 * not the other would leave either the module's history or the chain incomplete.
 *
 * Never throws: an audit write must not be able to fail the operation it records.
 * A failure is logged at ERROR so it is visible rather than silent.
 */
async function recordAudit(context, { sessionId, action, entityType, entityId, oldValue, newValue, summary }) {
  try {
    await queries.insertAuditEntry({
      sessionId,
      organizationId: context.organizationId,
      userId: context.userId,
      userEmail: context.email,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
    });
  } catch (err) {
    logger.error(`Failed to write ingestion audit entry for ${action}`, err, LOG_CATEGORY);
  }

  try {
    storeService.addAuditLog({
      userEmail: context.email,
      action: summary || `Vendor ingestion: ${action}`,
    });
    logger.audit(summary || `Vendor ingestion: ${action}`, context.email, {
      organizationId: context.organizationId,
      sessionId,
      entityType,
      entityId,
    });
  } catch (err) {
    logger.error(`Failed to write hash-chained audit log for ${action}`, err, LOG_CATEGORY);
  }
}

// ------------------------------------------------------------------------------
// TIME HORIZON
// ------------------------------------------------------------------------------

/** Today as YYYY-MM-DD, in UTC so the window does not shift with the server TZ. */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Shift an ISO date back by whole months, clamping an overflowing day. */
function subtractMonths(isoDate, months) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  // The 31st of a month has no counterpart in a 30-day month; clamp to that
  // month's last day rather than silently rolling into the following one, which
  // would widen the horizon by a day.
  const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return target.toISOString().slice(0, 10);
}

/**
 * Resolve the selected horizon to a concrete { type, startDate, endDate }.
 *
 * A predefined option's range is computed here and stored, so a session re-read
 * months later still reports the exact window the PO filter used rather than
 * recomputing a different one from a later "today". Only CUSTOM reads the
 * client's dates, and they are range-checked: a start after an end, or an end in
 * the future, is rejected rather than quietly producing an empty result set the
 * buyer would read as "no PO history".
 */
function resolveTimeHorizon(payload = {}) {
  const { isValid, errors, sanitizedData } = validatePayload(VALIDATION_SCHEMAS.vendorIngestionTimeHorizon, payload);
  if (!isValid) {
    throw new VendorIngestionError(Object.values(errors)[0], 400, errors);
  }

  const type = sanitizedData.horizonType;
  const today = todayIso();

  if (type !== VENDOR_INGESTION_HORIZON.CUSTOM) {
    const months = VENDOR_INGESTION_HORIZON_MONTHS[type];
    return { type, startDate: subtractMonths(today, months), endDate: today };
  }

  const startDate = sanitizedData.startDate;
  const endDate = sanitizedData.endDate;
  if (!startDate || !endDate) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.HORIZON_CUSTOM_DATES_REQUIRED, 400, {
      startDate: VENDOR_INGESTION_MESSAGES.HORIZON_CUSTOM_DATES_REQUIRED,
    });
  }
  if (startDate > endDate) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.HORIZON_START_AFTER_END, 400, {
      startDate: VENDOR_INGESTION_MESSAGES.HORIZON_START_AFTER_END,
    });
  }
  if (endDate > today) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.HORIZON_END_IN_FUTURE, 400, {
      endDate: VENDOR_INGESTION_MESSAGES.HORIZON_END_IN_FUTURE,
    });
  }
  return { type, startDate, endDate };
}

// ------------------------------------------------------------------------------
// SESSION LIFECYCLE
// ------------------------------------------------------------------------------

/** Create a session with a resolved horizon, and audit the choice. */
async function createSession(sessionUser, payload) {
  const context = await resolveBuyerContext(sessionUser);
  const horizon = resolveTimeHorizon(payload);

  const session = await queries.insertSession({
    organizationId: context.organizationId,
    userId: context.userId,
    userEmail: context.email,
    horizon,
  });
  if (!session) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.SESSION_SAVE_FAILED, 503);
  }

  await recordAudit(context, {
    sessionId: session.id,
    action: VENDOR_INGESTION_AUDIT_ACTION.TIME_HORIZON_SELECTED,
    entityType: 'VENDOR_INGESTION_SESSION',
    entityId: session.id,
    newValue: horizon,
    summary: `Started vendor ingestion for ${horizon.startDate} to ${horizon.endDate} (${horizon.type}).`,
  });

  logger.info(
    'Vendor ingestion session created',
    { sessionId: session.id, organizationId: context.organizationId, horizon },
    LOG_CATEGORY
  );
  return session;
}

/** Change the horizon on an existing session, before the PO dump is stored. */
async function updateSessionHorizon(sessionUser, sessionId, payload) {
  const context = await resolveBuyerContext(sessionUser);
  const session = await requireSession(context, sessionId);
  const horizon = resolveTimeHorizon(payload);

  const previous = { type: session.horizonType, startDate: session.horizonStart, endDate: session.horizonEnd };

  // Changing the window changes which PO rows count, so anything derived from
  // the old window is discarded rather than left to disagree with it. Silently
  // keeping stale in_horizon flags is how a supplier ends up classified from
  // spend the buyer has just excluded.
  const hadPoData = session.poRowCount > 0;
  if (hadPoData) {
    await queries.deletePoLineItems(sessionId, context.organizationId);
  }

  const updated = await queries.updateSession(sessionId, context.organizationId, {
    horizonType: horizon.type,
    horizonStart: horizon.startDate,
    horizonEnd: horizon.endDate,
    ...(hadPoData
      ? {
          poRowCount: 0,
          poInHorizonCount: 0,
          poOutsideHorizonCount: 0,
          poFileName: null,
          matchedVendorCount: 0,
          unmatchedVendorCount: 0,
          status:
            session.status === VENDOR_INGESTION_SESSION_STATUS.DRAFT
              ? VENDOR_INGESTION_SESSION_STATUS.DRAFT
              : VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED,
          currentStep: VENDOR_INGESTION_STEP.PO_DUMP,
          aiStatus: VENDOR_INGESTION_AI_STATUS.IDLE,
          aiProcessedCount: 0,
          aiTotalCount: 0,
          aiFailedCount: 0,
        }
      : {}),
  });

  await recordAudit(context, {
    sessionId,
    action: VENDOR_INGESTION_AUDIT_ACTION.TIME_HORIZON_SELECTED,
    entityType: 'VENDOR_INGESTION_SESSION',
    entityId: sessionId,
    oldValue: previous,
    newValue: horizon,
    summary: `Changed vendor ingestion horizon to ${horizon.startDate} to ${horizon.endDate}.${
      hadPoData ? ' Previously uploaded PO data was cleared because the window changed.' : ''
    }`,
  });

  return { session: updated, poDataCleared: hadPoData };
}

/**
 * The session the buyer should resume, with everything the wizard needs to
 * rehydrate: counters, the match summary, mapping stats and dispatch state.
 *
 * Returns `{ session: null }` rather than 404 when the organisation has never
 * run an ingestion, because "no session yet" is the normal first-visit state and
 * not an error the UI should render as one.
 */
async function getResumeState(sessionUser, sessionId) {
  const context = await resolveBuyerContext(sessionUser);
  const session = sessionId
    ? await requireSession(context, sessionId)
    : await queries.findLatestSession(context.organizationId);

  if (!session) {
    return { session: null, categoryMaster: await queries.findOrganizationCategoryMaster(context.organizationId) };
  }

  const [categoryMaster, mappingSummary, emailSummary, poCounts] = await Promise.all([
    queries.findOrganizationCategoryMaster(context.organizationId),
    queries.summarizeCategoryMappings(session.id, context.organizationId),
    queries.summarizeEmailLogs(session.id, context.organizationId),
    queries.countPoLineItems(session.id, context.organizationId),
  ]);

  return {
    session,
    categoryMaster,
    mappingSummary,
    emailSummary,
    poCounts,
    unlockedStep: unlockedStepFor(session),
  };
}

/**
 * The furthest step the session's state legitimately unlocks.
 *
 * Derived from the persisted status rather than stored separately, so it cannot
 * drift out of step with the data. The client uses it to decide which tabs are
 * reachable; the server checks the same thing again on every write, because a
 * disabled button is a hint, not a guard.
 */
function unlockedStepFor(session) {
  switch (session.status) {
    case VENDOR_INGESTION_SESSION_STATUS.DISPATCHED:
    case VENDOR_INGESTION_SESSION_STATUS.AI_COMPLETED:
      return VENDOR_INGESTION_STEP.DISPATCH;
    case VENDOR_INGESTION_SESSION_STATUS.JOINED:
      return VENDOR_INGESTION_STEP.AI_CATEGORY_JOIN;
    case VENDOR_INGESTION_SESSION_STATUS.PO_STORED:
      return VENDOR_INGESTION_STEP.AI_CATEGORY_JOIN;
    case VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED:
      return VENDOR_INGESTION_STEP.PO_DUMP;
    default:
      return VENDOR_INGESTION_STEP.VENDOR_MASTER;
  }
}

// ------------------------------------------------------------------------------
// ROW VALIDATION (shared by both uploads)
// ------------------------------------------------------------------------------

/** Reject an oversized chunk before any per-row work. */
function assertChunkSize(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new VendorIngestionError('rows must be a non-empty array.', 400);
  }
  if (rows.length > VENDOR_INGESTION_CONFIG.MAX_ROWS_PER_REQUEST) {
    throw new VendorIngestionError(
      formatMessage(VENDOR_INGESTION_MESSAGES.TOO_MANY_ROWS, { max: VENDOR_INGESTION_CONFIG.MAX_ROWS_PER_REQUEST }),
      413
    );
  }
}

/**
 * Validate rows against a schema, partitioning rather than filtering.
 *
 * Invalid rows are returned with their reasons and their source row numbers, so
 * the buyer gets a downloadable error report naming the offending line. Silently
 * dropping them — which is what the old setup modal did by defaulting every
 * missing field — is what produced vendor masters full of "Supplier 7" records
 * that could not be contacted.
 */
function partitionRows(rows, schema, extraCheck) {
  const valid = [];
  const invalid = [];

  rows.forEach((row, index) => {
    const sourceRowNumber = Number.isFinite(Number(row.rowNumber)) ? Number(row.rowNumber) : index + 2;
    const { isValid, errors, sanitizedData } = validatePayload(schema, row);
    const reasons = isValid ? [] : Object.values(errors);

    if (isValid && typeof extraCheck === 'function') {
      const extra = extraCheck(sanitizedData);
      if (extra) reasons.push(extra);
    }

    if (reasons.length > 0) {
      invalid.push({ rowNumber: sourceRowNumber, errors: reasons });
      return;
    }
    valid.push({ ...sanitizedData, sourceRowNumber, raw: row });
  });

  return { valid, invalid };
}

/**
 * Reject duplicate keys within one submitted batch.
 *
 * The database's unique constraint would collapse them into an upsert, which
 * looks like success while quietly losing a row. Reporting the duplicate names
 * the two lines that collide.
 */
function rejectDuplicateKeys(rows, keyOf, label) {
  const seen = new Map();
  const kept = [];
  const duplicates = [];

  for (const row of rows) {
    const key = keyOf(row);
    if (key === '') {
      kept.push(row);
      continue;
    }
    const firstSeenAt = seen.get(key);
    if (firstSeenAt !== undefined) {
      duplicates.push({
        rowNumber: row.sourceRowNumber,
        errors: [`Duplicate ${label} — already used on row ${firstSeenAt}.`],
      });
      continue;
    }
    seen.set(key, row.sourceRowNumber);
    kept.push(row);
  }

  return { kept, duplicates };
}

// ------------------------------------------------------------------------------
// STEP 2 — VENDOR MASTER
// ------------------------------------------------------------------------------

/**
 * Validate and store one chunk of Vendor Master rows.
 *
 * `replaceExisting` on the first chunk clears the session's previous vendor
 * master, so re-uploading a corrected file replaces it rather than merging two
 * different versions of the same sheet.
 */
async function confirmVendorMaster(sessionUser, sessionId, { rows, fileName, replaceExisting }) {
  const context = await resolveBuyerContext(sessionUser);
  const session = await requireSession(context, sessionId);
  assertChunkSize(rows);

  const { valid, invalid } = partitionRows(rows, VALIDATION_SCHEMAS.vendorMasterRow);
  const codeCheck = rejectDuplicateKeys(valid, (row) => String(row.vendorCode || '').trim().toLowerCase(), 'Vendor Code');
  const gstinCheck = rejectDuplicateKeys(
    codeCheck.kept,
    (row) => String(row.gstin || '').trim().toUpperCase(),
    'GSTIN'
  );
  const rejected = [...invalid, ...codeCheck.duplicates, ...gstinCheck.duplicates].sort(
    (a, b) => a.rowNumber - b.rowNumber
  );
  const storable = gstinCheck.kept;

  if (replaceExisting) {
    await queries.deleteVendorMasterRecords(sessionId, context.organizationId);
  }

  if (storable.length === 0) {
    // Nothing valid: report it as a failed upload with the reasons, not as an
    // empty success the buyer would read as "my file had no vendors".
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.VENDOR_MASTER_EMPTY, 422, {
      invalidRows: rejected,
    });
  }

  const stored = await queries.bulkUpsertVendorMasterRecords(sessionId, context.organizationId, storable);
  const totalStored = await queries.countVendorMasterRecords(sessionId, context.organizationId);

  if (totalStored > VENDOR_INGESTION_CONFIG.MAX_VENDOR_MASTER_ROWS) {
    throw new VendorIngestionError(
      formatMessage(VENDOR_INGESTION_MESSAGES.VENDOR_MASTER_LIMIT, {
        max: VENDOR_INGESTION_CONFIG.MAX_VENDOR_MASTER_ROWS,
      }),
      413
    );
  }

  const updated = await queries.updateSession(sessionId, context.organizationId, {
    vendorMasterFileName: fileName || session.vendorMasterFileName,
    vendorMasterRowCount: totalStored,
    status:
      session.status === VENDOR_INGESTION_SESSION_STATUS.DRAFT
        ? VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED
        : session.status,
    currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.PO_DUMP),
  });

  await recordAudit(context, {
    sessionId,
    action: VENDOR_INGESTION_AUDIT_ACTION.VENDOR_MASTER_UPLOADED,
    entityType: 'VENDOR_MASTER_UPLOAD',
    entityId: sessionId,
    newValue: {
      fileName: fileName || null,
      submitted: rows.length,
      stored: stored.length,
      rejected: rejected.length,
      totalStored,
    },
    summary: `Stored ${stored.length} vendor master row(s) from ${fileName || 'an uploaded file'} (${rejected.length} rejected).`,
  });

  return {
    session: updated,
    totalRows: rows.length,
    validRows: storable.length,
    storedRows: stored.length,
    invalidRows: invalid.length,
    duplicateRows: codeCheck.duplicates.length + gstinCheck.duplicates.length,
    totalStored,
    rejected,
  };
}

/** The stored vendor master, for the preview table. */
async function getVendorMasterPreview(sessionUser, sessionId) {
  const context = await resolveBuyerContext(sessionUser);
  await requireSession(context, sessionId);
  const records = await queries.findVendorMasterRecords(sessionId, context.organizationId);
  return { records, total: records.length };
}

// ------------------------------------------------------------------------------
// STEP 3 — PO DUMP
// ------------------------------------------------------------------------------

/**
 * Validate and store one chunk of PO line items.
 *
 * Enforces RULE 1 (Vendor Master first) and RULE 2 (the horizon decides which
 * rows count). Rows outside the window are stored but flagged, because the
 * inside/outside split is the check that catches a mis-selected horizon — a
 * buyer who sees "0 inside the period" has learned something useful, whereas one
 * whose out-of-range rows were dropped just sees an empty result.
 */
async function confirmPoDump(sessionUser, sessionId, { rows, fileName, replaceExisting }) {
  const context = await resolveBuyerContext(sessionUser);
  const session = await requireSession(context, sessionId);

  if (session.vendorMasterRowCount === 0) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.VENDOR_MASTER_REQUIRED_FIRST, 409);
  }
  if (!session.horizonStart || !session.horizonEnd) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.HORIZON_REQUIRED, 409);
  }
  assertChunkSize(rows);

  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    poDate: normalizePoDate(row.poDate || row.date) || row.poDate,
  }));

  // A line that identifies no vendor at all cannot be attributed to anyone, so
  // it is rejected rather than stored as permanently unmatched noise.
  const { valid, invalid } = partitionRows(normalizedRows, VALIDATION_SCHEMAS.poLineItemRow, (row) => {
    const hasCode = String(row.vendorCode || '').trim() !== '';
    const hasName = String(row.vendorName || '').trim() !== '';
    if (!hasCode && !hasName) return 'Either a Vendor Code or a Vendor Name is required to attribute the line.';
    return null;
  });

  const stamped = valid.map((row) => ({
    ...row,
    inHorizon: row.poDate >= session.horizonStart && row.poDate <= session.horizonEnd,
  }));

  if (replaceExisting) {
    await queries.deletePoLineItems(sessionId, context.organizationId);
  }

  if (stamped.length === 0) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.PO_DUMP_EMPTY, 422, { invalidRows: invalid });
  }

  await queries.bulkInsertPoLineItems(sessionId, context.organizationId, stamped);
  const counts = await queries.countPoLineItems(sessionId, context.organizationId);

  if (counts.total > VENDOR_INGESTION_CONFIG.MAX_PO_ROWS) {
    throw new VendorIngestionError(
      formatMessage(VENDOR_INGESTION_MESSAGES.PO_LIMIT, { max: VENDOR_INGESTION_CONFIG.MAX_PO_ROWS }),
      413
    );
  }

  const updated = await queries.updateSession(sessionId, context.organizationId, {
    poFileName: fileName || session.poFileName,
    poRowCount: counts.total,
    poInHorizonCount: counts.inHorizon,
    poOutsideHorizonCount: counts.outsideHorizon,
    status: VENDOR_INGESTION_SESSION_STATUS.PO_STORED,
    currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.AI_CATEGORY_JOIN),
  });

  await recordAudit(context, {
    sessionId,
    action: VENDOR_INGESTION_AUDIT_ACTION.PO_DUMP_UPLOADED,
    entityType: 'PO_UPLOAD',
    entityId: sessionId,
    newValue: {
      fileName: fileName || null,
      submitted: rows.length,
      stored: stamped.length,
      rejected: invalid.length,
      horizon: { startDate: session.horizonStart, endDate: session.horizonEnd },
      insidePeriod: counts.inHorizon,
      outsidePeriod: counts.outsideHorizon,
    },
    summary: `Stored ${stamped.length} PO line item(s); ${counts.inHorizon} inside and ${counts.outsideHorizon} outside ${session.horizonStart}–${session.horizonEnd}.`,
  });

  return {
    session: updated,
    totalRows: rows.length,
    validRows: stamped.length,
    invalidRows: invalid.length,
    insidePeriod: counts.inHorizon,
    outsidePeriod: counts.outsideHorizon,
    totalStored: counts.total,
    rejected: invalid,
  };
}

// ------------------------------------------------------------------------------
// STEP 4a — VENDOR / PO JOIN
// ------------------------------------------------------------------------------

/**
 * Match PO history onto the vendor master and seed one mapping per supplier.
 *
 * The matcher runs Vendor Code -> GSTIN -> normalised name in that order (RULE
 * 5). Suppliers with no in-horizon PO history are seeded straight to
 * SELF_MAP_REQUIRED and are never queued for the model (RULE 6/7).
 */
async function runVendorPoJoin(sessionUser, sessionId) {
  const context = await resolveBuyerContext(sessionUser);
  const session = await requireSession(context, sessionId);

  if (session.poRowCount === 0) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.PO_DUMP_REQUIRED_FIRST, 409);
  }

  const matchCounts = await queries.matchPoLineItemsToVendors(sessionId, context.organizationId);
  const profiles = await queries.findVendorPurchasingProfiles(sessionId, context.organizationId);
  await queries.seedCategoryMappings(sessionId, context.organizationId, profiles);

  const matchedVendorCount = profiles.filter((p) => p.hasPoHistory).length;
  const unmatchedVendorCount = profiles.length - matchedVendorCount;
  const unmatchedPoVendors = await queries.findUnmatchedPoVendors(sessionId, context.organizationId);

  const updated = await queries.updateSession(sessionId, context.organizationId, {
    matchedVendorCount,
    unmatchedVendorCount,
    status: VENDOR_INGESTION_SESSION_STATUS.JOINED,
    currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.AI_CATEGORY_JOIN),
    aiStatus: VENDOR_INGESTION_AI_STATUS.IDLE,
    aiProcessedCount: 0,
    aiTotalCount: matchedVendorCount,
    aiFailedCount: 0,
  });

  await recordAudit(context, {
    sessionId,
    action: VENDOR_INGESTION_AUDIT_ACTION.VENDOR_MATCHING_COMPLETED,
    entityType: 'VENDOR_PO_JOIN',
    entityId: sessionId,
    newValue: { totalVendors: profiles.length, matchedVendorCount, unmatchedVendorCount, matchCounts },
    summary: `Matched PO history to ${matchedVendorCount} of ${profiles.length} suppliers; ${unmatchedVendorCount} flagged for self-mapping.`,
  });

  logger.info(
    'Vendor/PO join complete',
    { sessionId, matchedVendorCount, unmatchedVendorCount, ...matchCounts },
    LOG_CATEGORY
  );

  return {
    session: updated,
    totalVendors: profiles.length,
    matchedVendorCount,
    unmatchedVendorCount,
    matchCounts,
    unmatchedPoVendors,
    matchedVendors: profiles
      .filter((p) => p.hasPoHistory)
      .map((p) => ({
        vendorRecordId: p.vendorRecordId,
        vendorCode: p.vendorCode,
        companyName: p.companyName,
        poCount: p.poCount,
        poLineCount: p.poLineCount,
        totalSpend: p.totalSpend,
        purchasedItems: p.lineSummaries.slice(0, 10),
      })),
    selfMapVendors: profiles
      .filter((p) => !p.hasPoHistory)
      .map((p) => ({
        vendorRecordId: p.vendorRecordId,
        vendorCode: p.vendorCode,
        companyName: p.companyName,
        email: p.email,
        status: VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED,
      })),
  };
}

// ------------------------------------------------------------------------------
// STEP 4b — AI CATEGORISATION
// ------------------------------------------------------------------------------

/**
 * Load the buyer's category master, refusing to proceed when it is empty.
 *
 * An empty master would leave the model with nothing to choose from, and the one
 * thing it must not do is invent a taxonomy (RULE 10). Failing loudly here is
 * better than producing a session full of NEW_CATEGORY_SUGGESTION rows.
 */
async function requireCategoryMaster(organizationId) {
  const categoryMaster = await queries.findOrganizationCategoryMaster(organizationId);
  if (categoryMaster.length === 0) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.CATEGORY_MASTER_EMPTY, 409);
  }
  return categoryMaster;
}

/**
 * Run one batch of AI classification and report progress.
 *
 * The client calls this repeatedly rather than waiting on one long request: the
 * job's state lives in the session and the per-mapping processing_status, so the
 * browser can close mid-run and the next caller picks up exactly where it
 * stopped. That is what makes "42 / 100 vendors" honest rather than a spinner.
 *
 * Returns `{ done: true }` once nothing is queued, at which point the session is
 * marked AI_COMPLETED (or FAILED if every vendor failed).
 */
async function processCategorizationBatch(sessionUser, sessionId, { batchSize } = {}) {
  const context = await resolveBuyerContext(sessionUser);
  const session = await requireSession(context, sessionId);

  if (session.status === VENDOR_INGESTION_SESSION_STATUS.DRAFT ||
      session.status === VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.JOIN_REQUIRED_FIRST, 409);
  }

  const categoryMaster = await requireCategoryMaster(context.organizationId);
  const limit = Math.min(
    Number(batchSize) > 0 ? Number(batchSize) : VENDOR_INGESTION_CONFIG.AI_BATCH_SIZE,
    VENDOR_INGESTION_CONFIG.AI_BATCH_SIZE
  );

  const queued = await queries.findQueuedCategoryMappings(sessionId, context.organizationId, limit);

  // First batch of a run: stamp the start so the audit trail records that
  // categorisation began, not only that it finished.
  if (session.aiStatus === VENDOR_INGESTION_AI_STATUS.IDLE || session.aiStatus === VENDOR_INGESTION_AI_STATUS.QUEUED) {
    await queries.updateSession(sessionId, context.organizationId, {
      aiStatus: VENDOR_INGESTION_AI_STATUS.PROCESSING,
      aiStartedAt: new Date().toISOString(),
    });
    await recordAudit(context, {
      sessionId,
      action: VENDOR_INGESTION_AUDIT_ACTION.AI_CATEGORIZATION_STARTED,
      entityType: 'AI_CATEGORIZATION',
      entityId: sessionId,
      newValue: { queuedVendors: session.aiTotalCount, horizon: { start: session.horizonStart, end: session.horizonEnd } },
      summary: `Started AI categorisation for ${session.aiTotalCount} supplier(s) with PO history.`,
    });
  }

  let outcomes = [];
  if (queued.length > 0) {
    const profiles = await queries.findVendorPurchasingProfiles(sessionId, context.organizationId);
    const profilesByRecordId = new Map(profiles.map((p) => [p.vendorRecordId, p]));

    outcomes = await categorizationService.runCategorizationBatch({
      session,
      organizationId: context.organizationId,
      mappings: queued,
      profilesByRecordId,
      categoryMaster,
    });

    for (const outcome of outcomes) {
      if (outcome.status !== categorizationService.CLASSIFICATION_STATUS.SUCCESS) continue;
      await recordAudit(context, {
        sessionId,
        action: VENDOR_INGESTION_AUDIT_ACTION.AI_RECOMMENDATION,
        entityType: 'VENDOR_CATEGORY_MAPPING',
        entityId: outcome.mappingId,
        newValue: {
          majorCategory: outcome.suggestion.majorCategory,
          minorCategories: outcome.suggestion.minorCategories,
          confidence: outcome.suggestion.confidence,
          band: outcome.suggestion.confidenceBand,
          isNewCategorySuggestion: outcome.suggestion.isNewCategorySuggestion,
          model: outcome.suggestion.model,
        },
        summary: `AI suggested ${outcome.suggestion.majorCategory || 'a new category'} for ${outcome.companyName} at ${
          outcome.suggestion.confidence === null ? 'unstated' : `${outcome.suggestion.confidence}%`
        } confidence.`,
      });
    }
  }

  const summary = await queries.summarizeCategoryMappings(sessionId, context.organizationId);
  const remaining = summary.queued + summary.processing;
  const done = remaining === 0;

  const aiStatus = done
    ? summary.failed > 0 && summary.mapped === 0 && summary.pendingReview === 0
      ? VENDOR_INGESTION_AI_STATUS.FAILED
      : VENDOR_INGESTION_AI_STATUS.COMPLETED
    : VENDOR_INGESTION_AI_STATUS.PROCESSING;

  const updated = await queries.updateSession(sessionId, context.organizationId, {
    aiStatus,
    aiProcessedCount: summary.completed,
    aiFailedCount: summary.failed,
    ...(done ? { aiCompletedAt: new Date().toISOString() } : {}),
    ...(done && aiStatus === VENDOR_INGESTION_AI_STATUS.COMPLETED
      ? {
          status: VENDOR_INGESTION_SESSION_STATUS.AI_COMPLETED,
          currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.DISPATCH),
        }
      : {}),
  });

  if (done) {
    await recordAudit(context, {
      sessionId,
      action: VENDOR_INGESTION_AUDIT_ACTION.AI_CATEGORIZATION_COMPLETED,
      entityType: 'AI_CATEGORIZATION',
      entityId: sessionId,
      newValue: summary,
      summary: `AI categorisation finished: ${summary.mapped} mapped, ${summary.pendingReview} awaiting review, ${summary.selfMapRequired} self-map required, ${summary.failed} failed.`,
    });

    try {
      storeService.notifyBuyer(context.email, {
        kind: 'ai_categorization_completed',
        title: 'Vendor AI Categorization Complete',
        message: `Categorization finished for session: ${summary.mapped} mapped, ${summary.pendingReview} awaiting review, ${summary.selfMapRequired} self-map required.`,
        meta: { sessionId, summary },
      });
    } catch (err) {
      logger.warn('Failed to dispatch in-app buyer notification for AI categorization', err, LOG_CATEGORY);
    }
  }

  return {
    session: updated,
    done,
    processedInBatch: outcomes.length,
    outcomes: outcomes.map((o) => ({
      vendorRecordId: o.vendorRecordId,
      companyName: o.companyName,
      status: o.status,
      error: o.error || null,
    })),
    summary,
  };
}

/**
 * Re-run classification for one supplier.
 *
 * Only the AI columns change; a buyer decision already recorded against the row
 * survives, so a re-run offers a fresh suggestion rather than reverting an
 * approval. A supplier with no PO history is refused outright — re-running would
 * mean categorising with no evidence, which is the rule this module exists to
 * uphold.
 */
async function reRunCategorization(sessionUser, sessionId, vendorRecordId) {
  const context = await resolveBuyerContext(sessionUser);
  const session = await requireSession(context, sessionId);
  const categoryMaster = await requireCategoryMaster(context.organizationId);

  const mapping = await queries.findCategoryMappingByVendorRecord(sessionId, context.organizationId, vendorRecordId);
  if (!mapping) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.MAPPING_NOT_FOUND, 404);
  }
  if (!mapping.hasPoHistory) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.MAPPING_NO_PO_HISTORY, 409);
  }

  const profiles = await queries.findVendorPurchasingProfiles(sessionId, context.organizationId);
  const vendorProfile = profiles.find((p) => p.vendorRecordId === vendorRecordId);

  await queries.requeueMapping(mapping.id, context.organizationId);
  await queries.markMappingProcessing(mapping.id, context.organizationId);

  const result = await categorizationService.classifyVendor({
    session,
    organizationId: context.organizationId,
    mapping,
    vendorProfile,
    categoryMaster,
  });

  if (result.status !== categorizationService.CLASSIFICATION_STATUS.SUCCESS) {
    await queries.markMappingFailed(mapping.id, context.organizationId, result.error);
    throw new VendorIngestionError(result.error || VENDOR_INGESTION_MESSAGES.AI_INVALID_RESPONSE, 502);
  }

  const saved = await queries.saveAiSuggestion(mapping.id, context.organizationId, result.suggestion);

  await recordAudit(context, {
    sessionId,
    action: VENDOR_INGESTION_AUDIT_ACTION.AI_RE_RUN,
    entityType: 'VENDOR_CATEGORY_MAPPING',
    entityId: mapping.id,
    oldValue: {
      majorCategory: mapping.aiSuggestion.majorCategory,
      minorCategories: mapping.aiSuggestion.minorCategories,
      confidence: mapping.aiSuggestion.confidence,
    },
    newValue: {
      majorCategory: result.suggestion.majorCategory,
      minorCategories: result.suggestion.minorCategories,
      confidence: result.suggestion.confidence,
    },
    summary: `Re-ran AI categorisation for ${mapping.companyName}.`,
  });

  return { mapping: saved };
}

// ------------------------------------------------------------------------------
// STEP 4c — BUYER REVIEW
// ------------------------------------------------------------------------------

/** Validate a buyer-chosen category pair against the organisation's master. */
function assertCategoriesInMaster(categoryMaster, majorCategory, minorCategories) {
  const majors = categorizationService.indexCategoryMaster(categoryMaster);
  const matched = majors.get(categorizationService.categoryKey(majorCategory));
  if (!matched) {
    throw new VendorIngestionError(
      formatMessage(VENDOR_INGESTION_MESSAGES.MAJOR_CATEGORY_UNKNOWN, { category: majorCategory }),
      422,
      { majorCategory: 'Not a category in your category master.' }
    );
  }
  if (minorCategories.length > VENDOR_INGESTION_CONFIG.MAX_MINOR_CATEGORIES_PER_VENDOR) {
    throw new VendorIngestionError(
      formatMessage(VENDOR_INGESTION_MESSAGES.TOO_MANY_MINOR_CATEGORIES, {
        max: VENDOR_INGESTION_CONFIG.MAX_MINOR_CATEGORIES_PER_VENDOR,
      }),
      422
    );
  }

  const resolved = [];
  for (const minor of minorCategories) {
    const exact = matched.minors.get(categorizationService.categoryKey(minor));
    if (!exact) {
      throw new VendorIngestionError(
        formatMessage(VENDOR_INGESTION_MESSAGES.MINOR_CATEGORY_UNKNOWN, { minor, major: matched.major }),
        422,
        { minorCategories: `"${minor}" is not a sub-category of "${matched.major}".` }
      );
    }
    if (!resolved.includes(exact)) resolved.push(exact);
  }

  return { majorCategory: matched.major, minorCategories: resolved };
}

/**
 * Record the buyer's decision on one mapping.
 *
 * APPROVE accepts the AI suggestion as-is; EDIT replaces the category with the
 * buyer's own choice; REJECT clears the decision and marks the supplier for
 * self-mapping instead of leaving it silently uncategorised.
 *
 * Whichever path runs, the ai_* columns are untouched — `saveBuyerReview` does
 * not name them — so the original recommendation remains readable alongside the
 * decision (RULE 8, RULE 11).
 */
async function reviewMapping(sessionUser, sessionId, vendorRecordId, payload) {
  const context = await resolveBuyerContext(sessionUser);
  const session = await requireSession(context, sessionId);

  const { isValid, errors, sanitizedData } = validatePayload(VALIDATION_SCHEMAS.vendorCategoryReview, payload);
  if (!isValid) {
    throw new VendorIngestionError(Object.values(errors)[0], 400, errors);
  }

  const mapping = await queries.findCategoryMappingByVendorRecord(sessionId, context.organizationId, vendorRecordId);
  if (!mapping) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.MAPPING_NOT_FOUND, 404);
  }

  const action = sanitizedData.action;
  const before = {
    majorCategory: mapping.buyerMajorCategory,
    minorCategories: mapping.buyerMinorCategories,
    status: mapping.status,
  };

  let review;
  let auditAction;

  if (action === 'REJECT') {
    review = {
      majorCategory: '',
      minorCategories: [],
      source: VENDOR_MAPPING_SOURCE.BUYER,
      // Rejecting is not "no category": the supplier still needs one, so it goes
      // to the self-mapping queue rather than sitting in limbo.
      status: VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED,
      reviewAction: 'REJECTED',
      reviewedBy: context.email,
    };
    auditAction = VENDOR_INGESTION_AUDIT_ACTION.BUYER_REJECTION;
  } else if (action === 'EDIT') {
    const categoryMaster = await requireCategoryMaster(context.organizationId);
    const requestedMajor = String(sanitizedData.majorCategory || '').trim();
    if (requestedMajor === '') {
      throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.EDIT_REQUIRES_CATEGORY, 400, {
        majorCategory: VENDOR_INGESTION_MESSAGES.EDIT_REQUIRES_CATEGORY,
      });
    }
    const minors = Array.isArray(sanitizedData.minorCategories)
      ? sanitizedData.minorCategories.filter((m) => typeof m === 'string' && m.trim() !== '')
      : [];
    const resolved = assertCategoriesInMaster(categoryMaster, requestedMajor, minors);
    review = {
      ...resolved,
      source: VENDOR_MAPPING_SOURCE.BUYER,
      status: VENDOR_MAPPING_STATUS.BUYER_APPROVED,
      reviewAction: 'EDITED',
      reviewedBy: context.email,
    };
    auditAction = VENDOR_INGESTION_AUDIT_ACTION.BUYER_EDIT;
  } else {
    // APPROVE. There has to be something to approve — approving a supplier whose
    // classification failed, or one the model could not place in the master,
    // would create an empty live category.
    if (mapping.aiSuggestion.majorCategory === '') {
      throw new VendorIngestionError(
        mapping.isNewCategorySuggestion
          ? `${mapping.companyName} has no category from your category master yet. Edit the mapping to choose one.`
          : VENDOR_INGESTION_MESSAGES.EDIT_REQUIRES_CATEGORY,
        409
      );
    }
    review = {
      majorCategory: mapping.aiSuggestion.majorCategory,
      minorCategories: mapping.aiSuggestion.minorCategories,
      source: VENDOR_MAPPING_SOURCE.AI,
      status: VENDOR_MAPPING_STATUS.BUYER_APPROVED,
      reviewAction: 'APPROVED',
      reviewedBy: context.email,
    };
    auditAction = VENDOR_INGESTION_AUDIT_ACTION.BUYER_APPROVAL;
  }

  const saved = await queries.saveBuyerReview(mapping.id, context.organizationId, review);

  // An approved supplier becomes a real, contactable vendor on the buyer's
  // dashboard. Only on approval — a pending suggestion is not yet a fact.
  if (review.status === VENDOR_MAPPING_STATUS.BUYER_APPROVED) {
    await empanelApprovedVendor(context, sessionId, saved);
  }

  await recordAudit(context, {
    sessionId,
    action: auditAction,
    entityType: 'VENDOR_CATEGORY_MAPPING',
    entityId: mapping.id,
    oldValue: before,
    newValue: {
      majorCategory: review.majorCategory,
      minorCategories: review.minorCategories,
      status: review.status,
      aiSuggested: {
        majorCategory: mapping.aiSuggestion.majorCategory,
        minorCategories: mapping.aiSuggestion.minorCategories,
        confidence: mapping.aiSuggestion.confidence,
      },
    },
    summary: `${review.reviewAction} category mapping for ${mapping.companyName}${
      review.majorCategory ? ` as ${review.majorCategory}` : ''
    }.`,
  });

  void session;
  return { mapping: saved };
}

/**
 * Create or refresh the live `vendors` row behind an approved mapping.
 *
 * Only what the ingestion actually established is written. No rating, no score,
 * no evaluated flag — the same discipline as processHistoricalPurchaseData, and
 * for the same reason: a supplier arriving from a spend extract has not been
 * assessed by anyone, and a fabricated 4.5/85 would then be selected against by
 * the RFQ engine as though it had.
 */
async function empanelApprovedVendor(context, sessionId, mapping) {
  if (!mapping || !mapping.email) return null;

  const record = await queries.findVendorMasterRecord(mapping.vendorRecordId, context.organizationId);
  // 'all': checking for an existing vendor by email to decide create-vs-update
  // — omitting this would miss any buyer-uploaded vendor (buyerId set) and
  // create a duplicate record instead of updating theirs.
  const existing = storeService.getVendorById(mapping.email, 'all');

  const categories = mapping.buyerMinorCategories.length > 0
    ? mapping.buyerMinorCategories
    : mapping.aiSuggestion.minorCategories;

  const payload = {
    name: mapping.companyName,
    email: mapping.email,
    contactPerson: record ? record.contactPerson || null : null,
    phone: record ? record.phone || null : null,
    location: record ? record.address || null : null,
    gstin: record ? record.gstin || null : null,
    majorCategory: mapping.buyerMajorCategory || mapping.aiSuggestion.majorCategory || null,
    minorCategories: categories,
    clientMappedCategories: categories,
    vendorCode: mapping.vendorCode || null,
    addedByBuyerCompany: context.organizationName || null,
  };

  const vendor = existing
    ? storeService.updateVendor(existing.id, payload)
    : storeService.empanelIngestedVendor(payload, context.email);

  if (vendor) {
    await queries.attachVendorId(mapping.id, context.organizationId, vendor.id);
  }
  void sessionId;
  return vendor;
}

// ------------------------------------------------------------------------------
// STEP 4d — REVIEW READS
// ------------------------------------------------------------------------------

/**
 * The review list, with confidence bands attached and both the AI suggestion and
 * the buyer's decision present on every row.
 *
 * Filtering and pagination happen here rather than in the browser so a session
 * with thousands of suppliers does not ship the whole list on every keystroke.
 */
async function listMappings(sessionUser, sessionId, { status, confidence, hasPoHistory, search, limit, offset } = {}) {
  const context = await resolveBuyerContext(sessionUser);
  await requireSession(context, sessionId);

  const all = await queries.findCategoryMappings(sessionId, context.organizationId);
  const needle = String(search || '').trim().toLowerCase();

  const decorated = all.map((mapping) => ({
    ...mapping,
    confidenceBand: categorizationService.confidenceBand(mapping.aiSuggestion.confidence),
    finalMajorCategory: mapping.buyerMajorCategory || mapping.aiSuggestion.majorCategory,
    finalMinorCategories:
      mapping.buyerMinorCategories.length > 0 ? mapping.buyerMinorCategories : mapping.aiSuggestion.minorCategories,
  }));

  const filtered = decorated.filter((mapping) => {
    if (status && status !== 'ALL' && mapping.status !== status) return false;
    if (confidence && confidence !== 'ALL' && mapping.confidenceBand !== confidence) return false;
    if (hasPoHistory === 'YES' && !mapping.hasPoHistory) return false;
    if (hasPoHistory === 'NO' && mapping.hasPoHistory) return false;
    if (needle !== '') {
      const haystack = [
        mapping.companyName,
        mapping.vendorCode,
        mapping.email,
        mapping.finalMajorCategory,
        ...mapping.finalMinorCategories,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const pageSize = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const start = Math.max(Number(offset) || 0, 0);
  const summary = await queries.summarizeCategoryMappings(sessionId, context.organizationId);

  return {
    vendors: filtered.slice(start, start + pageSize),
    total: filtered.length,
    limit: pageSize,
    offset: start,
    summary,
    confidenceBands: VENDOR_CONFIDENCE_BANDS,
  };
}

/**
 * Vendors grouped by their final category, plus a distinct self-mapping bucket.
 *
 * Suppliers awaiting self-mapping are kept out of the category groups: listing
 * them under a category they have not been assigned would misrepresent who is
 * eligible for an enquiry in it.
 */
async function getCategorySegmentation(sessionUser, sessionId) {
  const context = await resolveBuyerContext(sessionUser);
  await requireSession(context, sessionId);

  const rows = await queries.findCategorySegmentation(sessionId, context.organizationId);
  const selfMapStatuses = new Set([VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED, VENDOR_MAPPING_STATUS.SELF_MAPPED]);

  const categories = new Map();
  const selfMapping = [];

  for (const row of rows) {
    if (selfMapStatuses.has(row.status) || row.majorCategory === '') {
      selfMapping.push(...row.companies);
      continue;
    }
    if (!categories.has(row.majorCategory)) {
      categories.set(row.majorCategory, { majorCategory: row.majorCategory, vendorCount: 0, totalSpend: 0, companies: [] });
    }
    const bucket = categories.get(row.majorCategory);
    bucket.vendorCount += row.vendorCount;
    bucket.totalSpend += row.totalSpend;
    bucket.companies.push(...row.companies);
  }

  return {
    categories: Array.from(categories.values()).sort((a, b) => b.totalSpend - a.totalSpend),
    selfMappingRequired: selfMapping,
  };
}

// ------------------------------------------------------------------------------
// STEP 5 — EMAIL DISPATCH
// ------------------------------------------------------------------------------

/**
 * Resolve a dispatch request to a concrete recipient list, server-side.
 *
 * Recipients are re-derived from the stored mappings; the request only supplies
 * a template, an optional category and an optional set of vendor-record ids. No
 * email address is ever read from the payload, so a tampered request cannot
 * redirect a campaign to an outside address (and cannot mail another buyer's
 * suppliers, because every read is organisation-scoped).
 */
async function resolveDispatchRecipients(context, sessionId, { template, majorCategory, vendorRecordIds }) {
  const [mappings, vendorRecords] = await Promise.all([
    queries.findCategoryMappings(sessionId, context.organizationId),
    queries.findVendorMasterRecords(sessionId, context.organizationId).catch(() => []),
  ]);
  const vendorRecordMap = new Map((vendorRecords || []).map((r) => [r.id, r]));
  const requested = Array.isArray(vendorRecordIds) && vendorRecordIds.length > 0 ? new Set(vendorRecordIds) : null;

  const eligible = mappings.filter((mapping) => {
    if (requested && !requested.has(mapping.vendorRecordId)) return false;
    if (mapping.email === '') return false;

    if (template === VENDOR_DISPATCH_TEMPLATE.SELF_MAP_REQUIRED) {
      return mapping.status === VENDOR_MAPPING_STATUS.SELF_MAP_REQUIRED;
    }
    if (template === VENDOR_DISPATCH_TEMPLATE.CATEGORY_MAPPED) {
      // Only a decision the buyer has actually made is worth telling a supplier
      // about; a pending suggestion is not yet their category.
      if (mapping.status !== VENDOR_MAPPING_STATUS.BUYER_APPROVED) return false;
      if (majorCategory && mapping.buyerMajorCategory !== majorCategory) return false;
      return mapping.buyerMajorCategory !== '';
    }
    // GENERAL_ONBOARDING addresses anyone in the vendor master with an address.
    return true;
  });

  return eligible.map((mapping) => {
    const vRec = vendorRecordMap.get(mapping.vendorRecordId);
    return {
      vendorRecordId: mapping.vendorRecordId,
      mappingId: mapping.id,
      companyName: mapping.companyName,
      contactPerson: vRec?.contactPerson || '',
      phone: vRec?.phone || '',
      contactPhone: vRec?.phone || '',
      email: mapping.email,
      vendorCode: mapping.vendorCode,
      majorCategory: mapping.buyerMajorCategory || mapping.aiSuggestion.majorCategory,
      minorCategories:
        mapping.buyerMinorCategories.length > 0 ? mapping.buyerMinorCategories : mapping.aiSuggestion.minorCategories,
      status: mapping.status,
    };
  });
}

/**
 * Show the buyer exactly who will be mailed, and who will be skipped.
 *
 * The already-sent check runs here, before confirmation, so a duplicate is a
 * warning the buyer can act on rather than a surprise in the result (RULE 12).
 */
async function previewDispatch(sessionUser, sessionId, payload) {
  const context = await resolveBuyerContext(sessionUser);
  await requireSession(context, sessionId);

  const { isValid, errors, sanitizedData } = validatePayload(VALIDATION_SCHEMAS.vendorIngestionDispatch, payload);
  if (!isValid) {
    throw new VendorIngestionError(Object.values(errors)[0], 400, errors);
  }

  const template = sanitizedData.template;
  const majorCategory = String(sanitizedData.majorCategory || '').trim();
  const recipients = await resolveDispatchRecipients(context, sessionId, {
    template,
    majorCategory,
    vendorRecordIds: payload.vendorRecordIds,
  });

  if (recipients.length === 0) {
    const reason =
      template === VENDOR_DISPATCH_TEMPLATE.CATEGORY_MAPPED
        ? VENDOR_INGESTION_MESSAGES.DISPATCH_NOT_APPROVED
        : VENDOR_INGESTION_MESSAGES.DISPATCH_NO_RECIPIENTS;
    return { template, majorCategory, recipients: [], alreadySent: [], sendable: [], warning: reason };
  }

  const keys = recipients.map((r) =>
    queries.buildIdempotencyKey({
      organizationId: context.organizationId,
      template,
      recipientEmail: r.email,
      majorCategory: template === VENDOR_DISPATCH_TEMPLATE.CATEGORY_MAPPED ? r.majorCategory : '',
    })
  );
  const existing = await queries.findEmailLogsByIdempotencyKeys(context.organizationId, keys);
  const sentKeys = new Set(existing.filter((log) => log.status === VENDOR_EMAIL_STATUS.SENT).map((l) => l.idempotencyKey));

  const alreadySent = [];
  const sendable = [];
  recipients.forEach((recipient, index) => {
    if (sentKeys.has(keys[index])) alreadySent.push(recipient);
    else sendable.push(recipient);
  });

  return {
    template,
    majorCategory,
    recipients,
    sendable,
    alreadySent,
    warning:
      alreadySent.length > 0
        ? formatMessage(VENDOR_INGESTION_MESSAGES.DISPATCH_ALREADY_SENT, { count: alreadySent.length })
        : null,
  };
}

/** Build the message for one recipient from the chosen template. */
function buildDispatchMessage(context, template, recipient) {
  const shared = {
    to: recipient.email,
    recipientName: recipient.contactPerson || recipient.companyName,
    buyerOrganizationName: context.organizationName,
    vendorCode: recipient.vendorCode,
    contactPhone: recipient.contactPhone || recipient.phone || '',
    tempPassword: recipient.tempPassword || '',
  };

  if (template === VENDOR_DISPATCH_TEMPLATE.SELF_MAP_REQUIRED) {
    return mailerService.buildVendorSelfMappingEmail(shared);
  }
  if (template === VENDOR_DISPATCH_TEMPLATE.CATEGORY_MAPPED) {
    return mailerService.buildVendorCategoryMappingEmail({
      ...shared,
      majorCategory: recipient.majorCategory,
      minorCategories: recipient.minorCategories,
    });
  }
  return mailerService.buildVendorOnboardingEmail(shared);
}

/**
 * Send a dispatch.
 *
 * Idempotency is not advisory here. Every recipient's slot is claimed with an
 * INSERT ... ON CONFLICT whose UPDATE only fires for a FAILED or PENDING row, so
 * a row already SENT returns nothing and is skipped. That makes a double-clicked
 * button, a retried request and a re-run campaign all safe, and it is also why
 * "retry failed" can never re-send a successful email.
 *
 * A per-recipient send failure is recorded and the loop continues: one bad
 * address must not stop a campaign (the same discipline as the RFQ fan-out).
 */
async function sendDispatch(sessionUser, sessionId, payload) {
  const context = await resolveBuyerContext(sessionUser);
  const session = await requireSession(context, sessionId);

  const { isValid, errors, sanitizedData } = validatePayload(VALIDATION_SCHEMAS.vendorIngestionDispatch, payload);
  if (!isValid) {
    throw new VendorIngestionError(Object.values(errors)[0], 400, errors);
  }

  const template = sanitizedData.template;
  const majorCategory = String(sanitizedData.majorCategory || '').trim();
  const recipients = await resolveDispatchRecipients(context, sessionId, {
    template,
    majorCategory,
    vendorRecordIds: payload.vendorRecordIds,
  });

  if (recipients.length === 0) {
    throw new VendorIngestionError(
      template === VENDOR_DISPATCH_TEMPLATE.CATEGORY_MAPPED
        ? VENDOR_INGESTION_MESSAGES.DISPATCH_NOT_APPROVED
        : VENDOR_INGESTION_MESSAGES.DISPATCH_NO_RECIPIENTS,
      422
    );
  }
  if (recipients.length > VENDOR_INGESTION_CONFIG.MAX_RECIPIENTS_PER_DISPATCH) {
    throw new VendorIngestionError(
      formatMessage(VENDOR_INGESTION_MESSAGES.DISPATCH_TOO_MANY, {
        max: VENDOR_INGESTION_CONFIG.MAX_RECIPIENTS_PER_DISPATCH,
      }),
      413
    );
  }

  const dispatch = await queries.insertDispatch({
    sessionId,
    organizationId: context.organizationId,
    template,
    majorCategory,
    recipientCount: recipients.length,
    dispatchedBy: context.email,
  });

  const results = await deliverToRecipients(context, {
    sessionId,
    dispatchId: dispatch ? dispatch.id : null,
    template,
    recipients,
  });

  const finalized = dispatch
    ? await queries.finalizeDispatch(dispatch.id, context.organizationId, {
        sentCount: results.sent,
        failedCount: results.failed,
        skippedCount: results.skipped,
        status:
          results.failed === 0
            ? VENDOR_DISPATCH_STATUS.COMPLETED
            : results.sent > 0
              ? VENDOR_DISPATCH_STATUS.PARTIAL
              : VENDOR_DISPATCH_STATUS.FAILED,
      })
    : null;

  const updated = await queries.updateSession(sessionId, context.organizationId, {
    status: VENDOR_INGESTION_SESSION_STATUS.DISPATCHED,
    currentStep: Math.max(session.currentStep, VENDOR_INGESTION_STEP.DISPATCH),
  });

  await recordAudit(context, {
    sessionId,
    action:
      template === VENDOR_DISPATCH_TEMPLATE.SELF_MAP_REQUIRED
        ? VENDOR_INGESTION_AUDIT_ACTION.SELF_MAP_EMAIL_SENT
        : VENDOR_INGESTION_AUDIT_ACTION.CATEGORY_EMAIL_SENT,
    entityType: 'VENDOR_CATEGORY_DISPATCH',
    entityId: dispatch ? dispatch.id : sessionId,
    newValue: {
      template,
      majorCategory: majorCategory || null,
      recipients: recipients.length,
      sent: results.sent,
      failed: results.failed,
      skippedAsDuplicate: results.skipped,
    },
    summary: `Dispatched ${template} email to ${results.sent} of ${recipients.length} supplier(s); ${results.failed} failed, ${results.skipped} skipped as already sent.`,
  });

  try {
    storeService.notifyBuyer(context.email, {
      kind: 'vendor_dispatch_completed',
      title: 'Vendor Category Emails Dispatched',
      message: `Dispatched ${template} campaign: ${results.sent} sent, ${results.failed} failed, ${results.skipped} skipped.`,
      meta: { sessionId, template, results },
    });
  } catch (err) {
    logger.warn('Failed to dispatch in-app buyer notification for email campaign', err, LOG_CATEGORY);
  }

  const emailSummary = await queries.summarizeEmailLogs(sessionId, context.organizationId);
  return { session: updated, dispatch: finalized || dispatch, ...results, emailSummary };
}

/**
 * Claim a slot and send for each recipient in turn.
 *
 * Shared by the first dispatch and by the retry path, so both go through exactly
 * the same idempotency check — a retry cannot take a shortcut around it.
 */
async function deliverToRecipients(context, { sessionId, dispatchId, template, recipients }) {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const perRecipient = [];

  for (const recipient of recipients) {
    const slot = await queries.claimEmailSlot({
      dispatchId,
      sessionId,
      organizationId: context.organizationId,
      vendorRecordId: recipient.vendorRecordId,
      recipientEmail: recipient.email,
      recipientName: recipient.companyName,
      template,
      majorCategory: template === VENDOR_DISPATCH_TEMPLATE.CATEGORY_MAPPED ? recipient.majorCategory : '',
    });

    // No row came back: the UNIQUE key already exists in a state that is not
    // re-armable, i.e. it was already SENT. Skip rather than send again.
    if (!slot) {
      skipped += 1;
      perRecipient.push({ email: recipient.email, companyName: recipient.companyName, status: 'SKIPPED_ALREADY_SENT' });
      continue;
    }

    try {
      const message = buildDispatchMessage(context, template, recipient);
      const delivery = await mailerService.sendVendorIngestionEmail(message, template);
      if (delivery.sent) {
        await queries.markEmailSent(slot.id, context.organizationId, delivery.messageId);
        sent += 1;
        perRecipient.push({ email: recipient.email, companyName: recipient.companyName, status: VENDOR_EMAIL_STATUS.SENT });
      } else {
        // The transport declined to send — SMTP is unconfigured, or this is a
        // test run. Recorded as FAILED with the reason, never as SENT: the
        // module must not claim to have mailed someone it did not, and FAILED is
        // the state "Retry Failed" can pick up once SMTP is configured.
        await queries.markEmailFailed(slot.id, context.organizationId, delivery.reason || 'Email was not dispatched.');
        failed += 1;
        perRecipient.push({
          email: recipient.email,
          companyName: recipient.companyName,
          status: VENDOR_EMAIL_STATUS.FAILED,
          detail: delivery.reason || null,
        });
      }
    } catch (err) {
      await queries.markEmailFailed(slot.id, context.organizationId, err.message);
      failed += 1;
      perRecipient.push({
        email: recipient.email,
        companyName: recipient.companyName,
        status: VENDOR_EMAIL_STATUS.FAILED,
        detail: err.message,
      });
      logger.error(`Failed to dispatch ${template} email to ${recipient.email}`, err, LOG_CATEGORY);
    }
  }

  return { sent, failed, skipped, perRecipient };
}

/**
 * Retry only the failures.
 *
 * Reads the FAILED rows from the ledger and re-arms exactly those keys. A SENT
 * row is not in the result set and its key would refuse to re-arm anyway, so
 * there are two independent reasons a successful email cannot be resent.
 */
async function retryFailedDispatches(sessionUser, sessionId) {
  const context = await resolveBuyerContext(sessionUser);
  await requireSession(context, sessionId);

  const failedLogs = await queries.findEmailLogs(sessionId, context.organizationId, {
    status: VENDOR_EMAIL_STATUS.FAILED,
  });
  if (failedLogs.length === 0) {
    throw new VendorIngestionError(VENDOR_INGESTION_MESSAGES.DISPATCH_NOTHING_TO_RETRY, 409);
  }

  const mappings = await queries.findCategoryMappings(sessionId, context.organizationId);
  const byRecordId = new Map(mappings.map((m) => [m.vendorRecordId, m]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // Grouped by template so each batch renders the right email.
  const byTemplate = new Map();
  for (const log of failedLogs) {
    if (!byTemplate.has(log.template)) byTemplate.set(log.template, []);
    const mapping = byRecordId.get(log.vendorRecordId);
    byTemplate.get(log.template).push({
      vendorRecordId: log.vendorRecordId,
      companyName: log.recipientName || (mapping ? mapping.companyName : ''),
      email: log.recipientEmail,
      vendorCode: mapping ? mapping.vendorCode : '',
      majorCategory: log.majorCategory || (mapping ? mapping.buyerMajorCategory : ''),
      minorCategories: mapping ? mapping.buyerMinorCategories : [],
    });
  }

  for (const [template, recipients] of byTemplate.entries()) {
    const results = await deliverToRecipients(context, {
      sessionId,
      dispatchId: failedLogs[0].dispatchId,
      template,
      recipients,
    });
    sent += results.sent;
    failed += results.failed;
    skipped += results.skipped;
  }

  await recordAudit(context, {
    sessionId,
    action: VENDOR_INGESTION_AUDIT_ACTION.EMAIL_RETRIED,
    entityType: 'VENDOR_EMAIL_DISPATCH',
    entityId: sessionId,
    newValue: { attempted: failedLogs.length, sent, failed, skipped },
    summary: `Retried ${failedLogs.length} failed ingestion email(s): ${sent} sent, ${failed} still failing.`,
  });

  const emailSummary = await queries.summarizeEmailLogs(sessionId, context.organizationId);
  return { attempted: failedLogs.length, sent, failed, skipped, emailSummary };
}

/** Dispatch campaigns, the per-recipient ledger and the status totals. */
async function getDispatchStatus(sessionUser, sessionId, { status, limit } = {}) {
  const context = await resolveBuyerContext(sessionUser);
  await requireSession(context, sessionId);

  const [dispatches, logs, summary] = await Promise.all([
    queries.findDispatches(sessionId, context.organizationId),
    queries.findEmailLogs(sessionId, context.organizationId, { status, limit }),
    queries.summarizeEmailLogs(sessionId, context.organizationId),
  ]);
  return { dispatches, logs, summary };
}

// ------------------------------------------------------------------------------
// AUDIT & AI LOG READS
// ------------------------------------------------------------------------------

/**
 * The organisation's category master, for the review screen's category pickers.
 *
 * Returned even when empty, with an explicit flag, so the UI can explain *why*
 * classification is unavailable instead of rendering an empty dropdown.
 */
async function getCategoryMaster(sessionUser) {
  const context = await resolveBuyerContext(sessionUser);
  const categoryMaster = await queries.findOrganizationCategoryMaster(context.organizationId);
  return {
    categories: categoryMaster,
    total: categoryMaster.length,
    isEmpty: categoryMaster.length === 0,
    reason: categoryMaster.length === 0 ? VENDOR_INGESTION_MESSAGES.CATEGORY_MASTER_EMPTY : null,
  };
}

async function getAuditTrail(sessionUser, { sessionId, limit, offset } = {}) {
  const context = await resolveBuyerContext(sessionUser);
  if (sessionId) await requireSession(context, sessionId);
  const entries = await queries.findAuditEntries(context.organizationId, { sessionId, limit, offset });
  return { entries, total: entries.length };
}

async function getAiClassificationLogs(sessionUser, sessionId, { limit } = {}) {
  const context = await resolveBuyerContext(sessionUser);
  await requireSession(context, sessionId);
  const logs = await queries.findAiClassificationLogs(sessionId, context.organizationId, { limit });
  return { logs, total: logs.length };
}

/**
 * Approved mappings across all of the organisation's sessions.
 *
 * Consumed by the Vendor Summary screen so it can show the category a supplier
 * is genuinely empanelled under, rather than re-deriving one from a name.
 */
async function getApprovedMappings(sessionUser) {
  const context = await resolveBuyerContext(sessionUser);
  const mappings = await queries.findApprovedMappingsForOrganization(context.organizationId);
  return {
    mappings: mappings.map((mapping) => ({
      vendorId: mapping.vendorId,
      vendorRecordId: mapping.vendorRecordId,
      vendorCode: mapping.vendorCode,
      companyName: mapping.companyName,
      email: mapping.email,
      majorCategory: mapping.buyerMajorCategory || mapping.aiSuggestion.majorCategory,
      minorCategories:
        mapping.buyerMinorCategories.length > 0 ? mapping.buyerMinorCategories : mapping.aiSuggestion.minorCategories,
      source: mapping.source,
      status: mapping.status,
      aiConfidence: mapping.aiSuggestion.confidence,
      confidenceBand: categorizationService.confidenceBand(mapping.aiSuggestion.confidence),
      aiReason: mapping.aiSuggestion.reason,
      poCount: mapping.poCount,
      totalSpend: mapping.totalSpend,
      reviewedBy: mapping.reviewedBy,
      reviewedAt: mapping.reviewedAt,
    })),
    total: mappings.length,
  };
}

module.exports = {
  VendorIngestionError,
  // identity & helpers
  resolveBuyerContext,
  requireSession,
  recordAudit,
  todayIso,
  subtractMonths,
  resolveTimeHorizon,
  unlockedStepFor,
  assertChunkSize,
  partitionRows,
  rejectDuplicateKeys,
  assertCategoriesInMaster,
  requireCategoryMaster,
  buildDispatchMessage,
  resolveDispatchRecipients,
  deliverToRecipients,
  empanelApprovedVendor,
  // sessions
  createSession,
  updateSessionHorizon,
  getResumeState,
  // uploads
  confirmVendorMaster,
  getVendorMasterPreview,
  confirmPoDump,
  // join & AI
  runVendorPoJoin,
  processCategorizationBatch,
  reRunCategorization,
  // review
  reviewMapping,
  listMappings,
  getCategorySegmentation,
  // dispatch
  previewDispatch,
  sendDispatch,
  retryFailedDispatches,
  getDispatchStatus,
  // reads
  getCategoryMaster,
  getAuditTrail,
  getAiClassificationLogs,
  getApprovedMappings,
};
