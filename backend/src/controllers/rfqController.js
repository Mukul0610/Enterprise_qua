const storeService = require('../services/storeService');
const { generateStandardRFQEmail } = require('../services/emailService');
// Called through the module namespace (like storeService below) so the ingestion
// pipeline stays substitutable in tests rather than being bound at import time.
const rfqIngestionService = require('../services/rfqIngestionService');
const geminiService = require('../services/geminiService');
const rfqAttachmentService = require('../services/rfqAttachmentService');
const quoteAttachmentService = require('../services/quoteAttachmentService');
const rfqSummaryService = require('../services/rfqSummaryService');
const { logger } = require('../services/loggerService');
const emailGatewayService = require('../services/emailGatewayService');
const emailIngestionService = require('../services/emailIngestionService');
const mailerService = require('../services/mailerService');
const {
  VALIDATION_SCHEMAS,
  validatePayload,
  EXTRACTION_REASON_MESSAGES,
  RFQ_ATTACHMENT_CONFIG,
  EMAIL_INGESTION_STATUS,
} = require('../config/constants');

// A newly created RFQ is awaiting vendor quotations.
const RFQ_DEFAULT_STATUS = 'Quotes Pending';

// Which sourcing modes each buyer subscription plan includes. Cumulative —
// each paid tier adds one mode on top of the last, matching store.tsx's
// existing client-side gate (addNewRFQ) that this mirrors server-side.
const SUBSCRIPTION_MODE_ENTITLEMENTS = {
  free_trial: ['mode_0', 'mode_1', 'mode_2', 'mode_3', 'v0', 'v1', 'v2', 'v3', 'version_0', 'version_1', 'version_2', 'version_3'],
  version_0: ['mode_0', 'v0', 'version_0'],
  v0: ['mode_0', 'v0', 'version_0'],
  version_1: ['mode_0', 'mode_1', 'v0', 'v1', 'version_0', 'version_1'],
  v1: ['mode_0', 'mode_1', 'v0', 'v1', 'version_0', 'version_1'],
  version_2: ['mode_0', 'mode_1', 'mode_2', 'v0', 'v1', 'v2', 'version_0', 'version_1', 'version_2'],
  v2: ['mode_0', 'mode_1', 'mode_2', 'v0', 'v1', 'v2', 'version_0', 'version_1', 'version_2'],
  version_3: ['mode_0', 'mode_1', 'mode_2', 'mode_3', 'v0', 'v1', 'v2', 'v3', 'version_0', 'version_1', 'version_2', 'version_3'],
  v3: ['mode_0', 'mode_1', 'mode_2', 'mode_3', 'v0', 'v1', 'v2', 'v3', 'version_0', 'version_1', 'version_2', 'version_3'],
};

/**
 * Checks whether an ISO date string (YYYY-MM-DD...) represents a calendar date in the past.
 */
function isPastDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  if (!trimmed) return false;
  const dateOnly = trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return dateOnly < today;
}

/** Buyer-facing reason for each attachment rejection. */
const ATTACHMENT_ERRORS = {
  NO_CONTENT: 'That file appears to be empty. Choose a file with content and try again.',
  TOO_LARGE: `That file is larger than the ${Math.floor(
    RFQ_ATTACHMENT_CONFIG.MAX_BYTES / (1024 * 1024)
  )}MB limit. Attach a smaller file.`,
  UNSUPPORTED_TYPE:
    'That file type cannot be attached. Use a PDF, spreadsheet, Word document, text file or image.',
  WRITE_FAILED: 'The document could not be stored. Try again, and if it persists the storage volume may be full.',
};

/**
 * Which RFQs a caller may see.
 *
 * Buyers are scoped to their own buyerAccountId, resolved server-side from
 * the authenticated session — never trusted from the client. Vendors are
 * scoped to the RFQs their category profile covers (plus RFQs their buyer
 * added them to, or invited them onto) — the same `vendorCoversRFQ` rule the
 * opportunity feed relies on, so an enquiry only ever reaches a relevant
 * supplier. Category managers and admins see the full cross-buyer list
 * (quote-matrix.tsx's own CM route depends on this).
 */
async function resolveRfqReadScope(req) {
  const role = req.user && req.user.role;
  if (role === 'buyer') {
    const account = await storeService.getBuyerAccountByEmail(req.user.email);
    return { role, restricted: true, buyerAccountId: account ? account.id : null };
  }
  if (role === 'vendor') {
    // 'all': resolving the caller's own vendor identity by session email, not
    // filtering a buyer-scoped list — getVendorById otherwise refuses to
    // resolve any vendor that has a buyerId set (i.e. every buyer-uploaded
    // vendor), which silently made every RFQ invisible to them regardless of
    // addedByBuyerCompany matching or being invited.
    const vendor = storeService.getVendorById(req.user.email, 'all');
    return { role, restricted: true, vendor: vendor || null };
  }
  return { role, restricted: false };
}

/**
 * Whether the caller may read or write this specific RFQ.
 *
 * A buyer requesting an RFQ outside their own account, or a vendor requesting
 * one outside their category, gets the same 404 as an id that doesn't exist —
 * "not found" covers both, so a caller can't enumerate other parties' RFQ ids.
 * CM/admin are unrestricted.
 */
async function canAccessRfq(req, rfq) {
  const scope = await resolveRfqReadScope(req);
  if (!scope.restricted) return true;
  if (scope.role === 'vendor') return storeService.vendorCoversRFQ(scope.vendor, rfq);
  return !!scope.buyerAccountId && rfq.buyerAccountId === scope.buyerAccountId;
}

/**
 * Received quotes shall remain hidden from the buyer for 48 hours after RFQ release.
 * After 48 hours or upon RFQ closure, quotes become visible.
 */
function applyQuotesVisibility(rfq, role) {
  if (!rfq) return rfq;
  if (role !== 'buyer') return rfq;

  const isV0 =
    rfq.sourcingMode === 'mode_0' ||
    rfq.sourcingMode === 'v0' ||
    rfq.sourcingMode === 'version_0';

  if (isV0) {
    // For V0: Quotes and vendor details are not displayed in the buyer portal.
    // The 48-hour restriction does not apply to V0.
    return {
      ...rfq,
      quotes: [],
      assignedVendors: [],
      quotesHidden: false,
    };
  }

  const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
  const createdAtMs = rfq.createdAt ? new Date(rfq.createdAt).getTime() : 0;
  const isWithin48h = createdAtMs > 0 && Date.now() - createdAtMs < FORTY_EIGHT_HOURS_MS;
  const isClosed = rfq.status === 'Closed';

  if (isWithin48h && !isClosed) {
    const unhideAt = new Date(createdAtMs + FORTY_EIGHT_HOURS_MS).toISOString();
    return {
      ...rfq,
      quotes: [],
      quotesHidden: true,
      quotesHiddenUntil: unhideAt,
      quotesHiddenReason: 'Received quotes remain hidden from the buyer for 48 hours after release to preserve bidding integrity.',
    };
  }

  return {
    ...rfq,
    quotesHidden: false,
  };
}

/** Apply a read scope to the full RFQ list. */
function scopedRfqList(scope) {
  const all = storeService.getRFQs();
  if (!scope.restricted) return all;
  if (scope.role === 'vendor') return all.filter((rfq) => storeService.vendorCoversRFQ(scope.vendor, rfq));
  const buyerRfqs = all.filter((rfq) => !!scope.buyerAccountId && rfq.buyerAccountId === scope.buyerAccountId);
  return buyerRfqs.map((rfq) => applyQuotesVisibility(rfq, scope.role));
}

// Fields a buyer's own edit may touch. Deliberately a whitelist: id,
// rfqNumber, buyerAccountId, buyerAccountName, quotes and createdAt
// establish ownership/identity and must never be writable through a plain
// edit, or a malicious body could hand an RFQ to another buyer or fabricate
// quotes — storeService.updateRFQ merges whatever object it's given, with
// no column whitelist of its own.
const RFQ_UPDATABLE_FIELDS = [
  'title',
  'category',
  'sourcingMode',
  'status',
  'budget',
  'targetDeliveryDate',
  'deliveryLocation',
  'deliveryPincode',
  'extractedEntities',
  'attachments',
  'inquiries',
  'assignedVendors',
];

function pickUpdatableRfqFields(body) {
  const updates = {};
  for (const field of RFQ_UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field];
    }
  }
  return updates;
}

/**
 * List RFQs visible to the caller.
 *
 * This used to be `storeService.getRFQs()` — the entire global array, on an
 * unauthenticated route. That is what put one buyer's RFQs on another
 * buyer's dashboard.
 */
async function getRFQs(req, res, next) {
  try {
    await storeService.syncRFQsFromDB();
    const scope = await resolveRfqReadScope(req);
    const rfqs = scopedRfqList(scope);
    logger.info('Fetching RFQs list', { role: scope.role, restricted: scope.restricted, count: rfqs.length }, 'RFQ_CONTROLLER');
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory', data: rfqs });
  } catch (err) {
    logger.error('Error fetching RFQs list', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Every RFQ in the system, for the category manager's "All RFQs" console.
 *
 * Deliberately a separate endpoint from getRFQs rather than a query flag on
 * it: getRFQs' scoping rules are about who owns which RFQ and are expected to
 * keep evolving, whereas this view has one fixed contract — the whole
 * cross-buyer list, newest first, for a role that oversees all sourcing. The
 * route is gated to category_manager/admin, so the "no scope" here can never
 * be reached by a buyer or vendor.
 */
async function getAllRFQs(req, res, next) {
  try {
    await storeService.syncRFQsFromDB();
    const rfqs = storeService
      .getRFQs()
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    logger.info('Fetching all RFQs for CM console', { count: rfqs.length }, 'RFQ_CONTROLLER');
    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory',
      data: rfqs,
    });
  } catch (err) {
    logger.error('Error fetching all RFQs', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * The category-matched vendor pool a category manager or buyer can invite from.
 *
 * Grants no access by itself — see storeService.candidateVendorsForRFQ.
 */
async function getVendorCandidates(req, res, next) {
  try {
    const { id } = req.params;
    const rfq = await storeService.getRFQByIdAsync(id);
    if (!rfq || !(await canAccessRfq(req, rfq))) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    const candidates = storeService.candidateVendorsForRFQ(rfq);
    res.json({ success: true, data: candidates });
  } catch (err) {
    logger.error(`Error fetching vendor candidates for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * A category manager or buyer invites specific vendors to an RFQ.
 *
 * Only invited vendors (plus any the buyer directly added) can see, be
 * notified about, be emailed about, or quote this RFQ afterward — see
 * storeService.vendorCoversRFQ.
 */
async function inviteVendors(req, res, next) {
  try {
    const { id } = req.params;
    const { vendorIds } = req.body || {};
    if (!Array.isArray(vendorIds) || vendorIds.length === 0) {
      return res.status(400).json({ success: false, error: 'vendorIds must be a non-empty array.' });
    }
    const rfq = await storeService.getRFQByIdAsync(id);
    if (!rfq || !(await canAccessRfq(req, rfq))) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    const result = await storeService.inviteVendorsToRFQ(id, vendorIds, req.user && req.user.email);
    res.json({
      success: true,
      data: result.updatedRFQ,
      invitedCount: result.invitedCount,
      excludedCount: result.excludedCount || 0,
      excludedVendors: result.excludedVendors || [],
    });
  } catch (err) {
    logger.error(`Error inviting vendors to RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Validate vendor candidates against RFQ category before shortlisting.
 * Excludes category mismatched vendors and dispatches profile update emails.
 */
async function validateVendorCategories(req, res, next) {
  try {
    const { id } = req.params;
    const { vendorIds } = req.body || {};
    if (!Array.isArray(vendorIds) || vendorIds.length === 0) {
      return res.status(400).json({ success: false, error: 'vendorIds must be a non-empty array.' });
    }
    const rfq = await storeService.getRFQByIdAsync(id);
    if (!rfq || !(await canAccessRfq(req, rfq))) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    const resolvedVendors = vendorIds.map((vid) => storeService.getVendorById(vid, 'all') || { id: vid }).filter(Boolean);
    const result = storeService.validateAndShortlistVendors(rfq, resolvedVendors, req.user && req.user.email);
    res.json({
      success: true,
      shortlisted: result.shortlisted,
      excluded: result.excluded,
      message: result.excluded.length > 0
        ? `${result.excluded.length} vendor(s) have category mismatches and were excluded from shortlist. Profile update emails sent.`
        : 'All vendors match RFQ category.',
    });
  } catch (err) {
    logger.error(`Error validating vendor categories for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Buyer-triggered email requesting a vendor to update their category details.
 * Useful during RFQ creation when a vendor's registered category does not match
 * the required category of the RFQ line items.
 */
async function requestVendorCategoryUpdate(req, res, next) {
  try {
    const { vendorId, vendorEmail, vendorName, rfqCategory, rfqTitle, rfqNumber } = req.body || {};
    let vendor = vendorId ? storeService.getVendorById(vendorId, 'all') : null;
    if (!vendor && vendorEmail) {
      vendor = typeof storeService.getVendorByEmail === 'function' ? storeService.getVendorByEmail(vendorEmail) : null;
    }
    const targetEmail = vendor ? vendor.email : vendorEmail;
    if (!targetEmail) {
      return res.status(400).json({ success: false, error: 'Target vendor email or valid vendorId is required.' });
    }

    const buyerAccount = req.user && req.user.email ? await storeService.getBuyerAccountByEmail(req.user.email) : null;
    const buyerName = buyerAccount ? (buyerAccount.companyName || buyerAccount.name) : (req.user ? req.user.name : 'Buyer');
    const buyerEmail = buyerAccount ? buyerAccount.corporateEmail : (req.user ? req.user.email : null);

    const targetVendorName = vendor ? (vendor.name || vendor.contactPerson) : (vendorName || 'Supplier');
    const targetCurrentCategory = vendor ? (vendor.majorCategory || (Array.isArray(vendor.minorCategories) ? vendor.minorCategories.join(', ') : '')) : 'Not specified';

    await mailerService.sendVendorCategoryMismatchEmail(targetEmail, {
      rfqNumber: rfqNumber || 'NEW-RFQ',
      rfqTitle: rfqTitle || 'Procurement Requisition',
      rfqCategory: rfqCategory || 'Required Procurement Category',
      vendorName: targetVendorName,
      vendorCurrentCategory: targetCurrentCategory,
      buyerAccountName: buyerName,
      buyerEmail,
    });

    if (typeof storeService.recordAuditEntry === 'function') {
      storeService.recordAuditEntry({
        actor: req.user ? req.user.email : 'system',
        actorType: 'buyer',
        action: 'vendor_category_update_requested',
        target: targetEmail,
        details: {
          vendorId: vendor ? vendor.id : vendorId,
          rfqCategory,
          vendorCurrentCategory: targetCurrentCategory,
        },
      });
    } else if (typeof storeService.addAuditLog === 'function') {
      storeService.addAuditLog({
        userEmail: req.user ? req.user.email : 'buyer',
        action: `Requested category update from vendor ${targetVendorName} (${targetEmail}) for RFQ ${rfqNumber || 'NEW-RFQ'}`,
        rfqNumber: rfqNumber || undefined,
      });
    }

    return res.json({
      success: true,
      message: `Category update email sent to ${targetVendorName} (${targetEmail}).`,
    });
  } catch (err) {
    logger.error('Failed to request vendor category update', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * One RFQ, by RFQ number or row id.
 *
 * A hit on another buyer's RFQ returns the same 404 as an id that does not
 * exist, so the response cannot be used to probe what other buyers have
 * raised.
 */
async function getRFQById(req, res, next) {
  try {
    const { id } = req.params;
    logger.info(`Fetching RFQ by ID: ${id}`, { id }, 'RFQ_CONTROLLER');
    const rfq = await storeService.getRFQByIdAsync(id);
    if (!rfq || !(await canAccessRfq(req, rfq))) {
      logger.warn(`RFQ not found for ID: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    const role = req.user && req.user.role;
    res.json({ success: true, data: applyQuotesVisibility(rfq, role) });
  } catch (err) {
    logger.error(`Error fetching RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Create an RFQ owned by the signed-in buyer's account.
 */
async function createRFQ(req, res, next) {
  let consumedFreeTrial = false;
  let requestingBuyerAccount = null;
  try {
    const body = req.body || {};

    // Validated against the centralized schema at the entry boundary so a
    // malformed RFQ never reaches the store. deliveryLocation/deliveryPincode
    // are required here: vendors price freight against the destination, and a
    // quote raised without it can't be compared against one that has it.
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.createRFQ, body);
    if (!isValid) {
      logger.warn('Failed to create RFQ: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    if (isPastDate(body.targetDeliveryDate)) {
      logger.warn('Failed to create RFQ: targetDeliveryDate is in the past', { targetDeliveryDate: body.targetDeliveryDate }, 'RFQ_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: 'Target date cannot be earlier than today.',
        fieldErrors: { targetDeliveryDate: 'Target date cannot be earlier than today.' },
      });
    }

    const lineItems = Array.isArray(body.extractedEntities) ? body.extractedEntities : body.lineItems || [];
    for (const item of lineItems) {
      if (item && isPastDate(item.targetDate)) {
        logger.warn('Failed to create RFQ: line item targetDate is in the past', { targetDate: item.targetDate }, 'RFQ_CONTROLLER');
        return res.status(400).json({
          success: false,
          error: 'Target date cannot be earlier than today.',
          fieldErrors: { targetDate: 'Target date cannot be earlier than today.' },
        });
      }
    }

    // Resolved server-side from the authenticated session, never trusted from
    // the request body, so the RFQ is attributed to whoever is actually
    // logged in rather than a client-supplied or globally-shared value.
    requestingBuyerAccount = req.user ? await storeService.getBuyerAccountByEmail(req.user.email) : null;

    // Server-side re-validation of the buyer's subscription entitlement —
    // mirrors the vendor download-quota check below (generateEmailPreview).
    // The frontend already gates on the same rules (store.tsx's addNewRFQ) for
    // a fast, friendly error; this is what actually stops a buyer who calls
    // this endpoint directly from bypassing the trial limit or a mode their
    // plan doesn't include. Skipped entirely when the caller has no resolved
    // buyer-account record at all (e.g. admin/CM-raised RFQs) — there is no
    // subscription to enforce against.
    if (requestingBuyerAccount) {
      const plan = requestingBuyerAccount.subscriptionPlan || 'free_trial';
      const isPaidPlan = ['version_1', 'version_2', 'version_3'].includes(plan);
      const entitledModes = SUBSCRIPTION_MODE_ENTITLEMENTS[plan] || SUBSCRIPTION_MODE_ENTITLEMENTS.free_trial;
      const requestedMode = body.sourcingMode || 'mode_0';
      const remainingCredits =
        requestingBuyerAccount.remainingFreeRFQs !== undefined
          ? requestingBuyerAccount.remainingFreeRFQs
          : 5;

      const isV0 = requestedMode === 'mode_0' || requestedMode === 'v0' || requestedMode === 'version_0';

      // Enterprise QUA – V0 (Free Starter Trial) is universally available to all accounts (0 credits consumed).
      // Entitlement check is NEVER applied to V0 (always allowed). Only enforced for V1 / V2 / V3.
      if (!isV0 && !entitledModes.includes(requestedMode)) {
        logger.warn(
          `Rejected RFQ creation: ${plan} plan does not include ${requestedMode}`,
          { plan, requestedMode },
          'RFQ_CONTROLLER'
        );
        return res.status(403).json({
          success: false,
          error: `Your ${plan} subscription does not include ${requestedMode}. Upgrade to unlock it.`,
        });
      }

      // Enterprise QUA – V0 (Free Starter Trial) Flow:
      // V0 RFQ = No credit deduction (0 credits consumed). Allowed unconditionally even when remaining credits are 0.
      // V1 / V2 / V3 RFQ = 1 credit deducted per RFQ from buyer's 5 free RFQ credits (if on free trial).
      // Once 5 free credits are 0, V1/V2/V3 RFQs require paid subscription.
      if (isV0) {
        // V0 RFQ: No credit deduction
        consumedFreeTrial = false;
      } else {
        // V1, V2, or V3:
        if (!isPaidPlan) {
          if (remainingCredits <= 0) {
            logger.warn('Rejected RFQ creation: free credits exhausted for V1/V2/V3', { buyerAccountId: requestingBuyerAccount.id, requestedMode }, 'RFQ_CONTROLLER');
            return res.status(403).json({
              success: false,
              error: 'Your 5 free trial RFQ credits for V1/V2/V3 have been fully used. Upgrade to a paid plan to raise more V1/V2/V3 RFQs, or continue using V0 Free Starter for Procucev Network RFQs.',
            });
          }
          const consumeResult = storeService.tryConsumeFreeRFQ(requestingBuyerAccount.id);
          if (!consumeResult.ok) {
            logger.warn('Rejected RFQ creation: free trial exhausted', { buyerAccountId: requestingBuyerAccount.id }, 'RFQ_CONTROLLER');
            return res.status(403).json({
              success: false,
              error: 'Your free trial RFQs are used up. Upgrade to a paid plan to raise more.',
            });
          }
          consumedFreeTrial = true;
        }
      }
    }

    // Generated from the line items the buyer confirmed, so the summary
    // always describes what was actually dispatched. A model or network
    // failure here must not block RFQ creation — buildRFQSummary already
    // falls back to a deterministic summary rather than throwing.
    const aiSummary = await rfqSummaryService.buildRFQSummary(
      { ...body, extractedEntities: lineItems },
      { orgName: (req.user && req.user.orgName) || '' }
    );

    logger.info(`Creating new RFQ: ${body.title}`, { title: body.title, category: body.category, budget: body.budget }, 'RFQ_CONTROLLER');

    const created = storeService.createRFQ({ ...body, extractedEntities: lineItems, aiSummary }, requestingBuyerAccount);

    // Dispatch real email notification to target gateway address (e.g. RFQ@procucev.com)
    if (body.source === 'email_gateway' || body.targetGatewayEmail) {
      const recipientEmail = body.targetGatewayEmail || 'RFQ@procucev.com';
      void mailerService.sendRequisitionNotificationEmail(
        recipientEmail,
        created,
        body.sourceEmail || (req.user && req.user.email)
      );
    }

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    if (consumedFreeTrial && requestingBuyerAccount) {
      storeService.refundFreeRFQ(requestingBuyerAccount.id);
    }
    logger.error('Error creating RFQ', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Classify raw extracted BOQ/email rows into review-ready RFQ line items.
 *
 * This is the server half of AI ingestion: the client extracts rows from the
 * document, this endpoint normalises and categorises them, and the wizard renders
 * the returned draft for the buyer to confirm before dispatch.
 */
async function ingestRFQ(req, res, next) {
  try {
    const body = req.body || {};

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.ingestRFQ, body);
    if (!isValid) {
      logger.warn('Failed to ingest RFQ: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const { draft, classification } = await rfqIngestionService.buildRFQDraft(body);

    // An upload that yielded nothing usable is a failed ingestion, not an empty
    // success: returning 422 lets the wizard keep the buyer on the upload step.
    if (classification.accepted === 0) {
      logger.warn('RFQ ingestion produced no usable line items', classification, 'RFQ_CONTROLLER');
      return res.status(422).json({
        success: false,
        error: 'No usable line items could be extracted. Check that the document has a description column.',
        classification,
      });
    }

    logger.info(`RFQ ingestion complete: ${classification.accepted} line items`, classification, 'RFQ_CONTROLLER');
    res.json({ success: true, data: draft, classification });
  } catch (err) {
    logger.error('Error ingesting RFQ line items', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Report the autonomous mailbox gateway's state.
 *
 * Diagnostic, and readable by any signed-in user: the buyer needs to know which
 * address to forward requisitions to and whether anything is being watched.
 * Credentials are never part of the payload.
 */
async function getEmailGatewayStatus(req, res, next) {
  try {
    const status = await emailGatewayService.getStatus();
    return res.json({ success: true, data: status });
  } catch (err) {
    logger.error('Error reading email gateway status', err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

/**
 * Check the mailbox now rather than waiting for the next interval.
 *
 * Exists because a two-minute poll makes the feature untestable by hand. The
 * ingestion ledger still de-duplicates, so pressing this repeatedly cannot raise
 * the same requisition twice.
 */
async function pollEmailGateway(req, res, next) {
  try {
    const result = await emailGatewayService.pollOnce();

    if (result.skipped) {
      // Not a fault: the gateway is off, unconfigured, or a check is already
      // running. A 409 lets the UI explain rather than report a failure.
      return res.status(409).json({ success: false, error: result.reason });
    }
    if (result.error) {
      return res.status(502).json({ success: false, error: result.error });
    }

    logger.info(
      `Manual mailbox check by ${req.user && req.user.email}: ${result.ingested} of ${result.considered} ingested`,
      { considered: result.considered, ingested: result.ingested, pending: result.pending },
      'RFQ_CONTROLLER'
    );
    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Error polling the email gateway', err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

/**
 * Extract RFQ line items from an uploaded document using Gemini, then classify
 * them through the same ingestion pipeline the manual path uses.
 *
 * A failed or empty extraction is not a server error — it is an expected outcome
 * that the wizard handles by inviting the buyer to key the line items instead.
 * The response therefore always carries a machine-readable `reason` so the UI can
 * explain precisely what happened (no API key, unreadable file, nothing found).
 */
async function extractRFQFromDocument(req, res, next) {
  try {
    const body = req.body || {};

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.extractRFQ, body);
    if (!isValid) {
      logger.warn('Document extraction rejected: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    // A buyer uploading their own .eml through the authenticated web app is a
    // different trust path from the IMAP gateway's inbound mail (see
    // emailGatewayService.resolveSenderAuthorisation) — the session itself is
    // the authorization here, so this reuses prepareEmailForExtraction's real
    // MIME parsing without the gateway's sender-allow-list check.
    let extractionInput = {
      documentText: body.documentText,
      inlineData: body.inlineData,
      mimeType: body.mimeType,
      fileName: body.fileName,
    };
    let sourceEmail;

    if (
      emailIngestionService.isEmailFileName(body.fileName) ||
      emailIngestionService.isOutlookMsgFileName(body.fileName)
    ) {
      const prepared = await emailIngestionService.prepareEmailForExtraction({
        fileName: body.fileName,
        content: body.inlineData,
      });
      if (prepared.status !== EMAIL_INGESTION_STATUS.READY) {
        logger.warn(
          `Email upload could not be prepared for extraction (${prepared.status})`,
          { fileName: body.fileName, status: prepared.status },
          'RFQ_CONTROLLER'
        );
        return res.status(422).json({
          success: false,
          reason: prepared.status,
          error: EXTRACTION_REASON_MESSAGES[prepared.status] || EXTRACTION_REASON_MESSAGES.AI_FAILED,
        });
      }
      extractionInput = prepared.extractionInput;
      sourceEmail = prepared.message.fromAddress;
    }

    const extraction = await geminiService.extractLineItems(extractionInput);

    if (extraction.status !== geminiService.EXTRACTION_STATUS.SUCCESS) {
      logger.warn(
        `Document extraction produced no line items (${extraction.status})`,
        { fileName: body.fileName, status: extraction.status },
        'RFQ_CONTROLLER'
      );
      return res.status(422).json({
        success: false,
        reason: extraction.status,
        error: EXTRACTION_REASON_MESSAGES[extraction.status] || EXTRACTION_REASON_MESSAGES.AI_FAILED,
      });
    }

    // Reuse the shared normalisation + taxonomy classification so an AI-extracted
    // RFQ is shaped identically to one keyed by hand.
    const { draft, classification } = await rfqIngestionService.buildRFQDraft({
      lineItems: extraction.lineItems,
      title: extraction.documentTitle,
      category: extraction.category,
      estimatedBudget: extraction.estimatedBudget,
      targetDeliveryDate: extraction.deliveryDate,
      source: 'ai_extraction',
      sourceFileName: body.fileName,
      ...(sourceEmail ? { sourceEmail } : {}),
      requireValidQuantity: true,
    });

    if (classification.accepted === 0) {
      return res.status(422).json({
        success: false,
        reason: geminiService.EXTRACTION_STATUS.NO_ITEMS_FOUND,
        error: EXTRACTION_REASON_MESSAGES.NO_ITEMS_FOUND,
      });
    }

    logger.info(
      `Document extraction complete: ${classification.accepted} line items via ${extraction.model}`,
      { ...classification, model: extraction.model },
      'RFQ_CONTROLLER'
    );

    res.json({
      success: true,
      data: draft,
      classification,
      extraction: { model: extraction.model, deliveryDate: extraction.deliveryDate },
    });
  } catch (err) {
    logger.error('Error extracting RFQ line items from document', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Portfolio roll-up backing the buyer RFQ Summary screen.
 *
 * Derived from only the RFQs visible to the caller (see
 * resolveRfqReadScope) — previously reduced over the global array, so every
 * buyer saw the same portfolio totals, including spend figures belonging to
 * other companies.
 */
async function getRFQSummary(req, res, next) {
  try {
    await storeService.syncRFQsFromDB();
    const scope = await resolveRfqReadScope(req);
    const rfqs = scopedRfqList(scope);
    logger.info('Building RFQ portfolio summary', { role: scope.role, restricted: scope.restricted, count: rfqs.length }, 'RFQ_CONTROLLER');
    res.json({ success: true, data: rfqSummaryService.buildPortfolioSummary(rfqs) });
  } catch (err) {
    logger.error('Error building RFQ summary', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Store a supporting document for an RFQ and return its metadata.
 *
 * Deliberately does not invoke Gemini. This is the manual path: the buyer is
 * keying the line items themselves and the document is evidence to attach, not
 * something to be read. Only the returned metadata goes onto the RFQ; the bytes
 * stay on disk and are fetched by id.
 */
async function uploadRFQAttachment(req, res, next) {
  try {
    const body = req.body || {};

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.uploadRFQAttachment, body);
    if (!isValid) {
      logger.warn('Attachment upload rejected: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const result = await rfqAttachmentService.saveAttachment({
      fileName: body.fileName,
      mimeType: body.mimeType,
      content: body.content,
    });

    if (result.status !== rfqAttachmentService.ATTACHMENT_STATUS.SAVED) {
      logger.warn(
        `Attachment upload refused (${result.status})`,
        { fileName: body.fileName, mimeType: body.mimeType, status: result.status },
        'RFQ_CONTROLLER'
      );
      // A refused upload is an expected outcome the buyer can act on, not a fault.
      const status = result.status === rfqAttachmentService.ATTACHMENT_STATUS.WRITE_FAILED ? 500 : 422;
      return res.status(status).json({
        success: false,
        reason: result.status,
        error: ATTACHMENT_ERRORS[result.status] || ATTACHMENT_ERRORS.WRITE_FAILED,
      });
    }

    res.status(201).json({ success: true, data: result.attachment });
  } catch (err) {
    logger.error('Error storing RFQ attachment', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Stream one stored attachment back to the buyer.
 *
 * The name and content type come from the stored sidecar rather than the request,
 * so a caller cannot influence how the file is served. Content-Disposition is
 * `inline` so the browser previews a PDF or image instead of forcing a download.
 */
async function downloadRFQAttachment(req, res, next) {
  try {
    const { attachmentId } = req.params;
    const stored = await rfqAttachmentService.loadAttachment(attachmentId);

    if (!stored) {
      logger.warn('Attachment not found', { attachmentId }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: 'That document is no longer available.' });
    }

    res.setHeader('Content-Type', stored.meta.mimeType);
    res.setHeader('Content-Length', stored.content.length);
    // The stored name is already reduced to a leaf and quoted, so it cannot inject
    // extra header directives.
    res.setHeader('Content-Disposition', `inline; filename="${stored.meta.fileName.replace(/"/g, '')}"`);
    res.send(stored.content);
  } catch (err) {
    logger.error('Error reading RFQ attachment', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

async function uploadQuoteAttachment(req, res, next) {
  try {
    if (req.user?.role !== 'vendor') {
      return res.status(403).json({ success: false, error: 'Only vendors can attach bid documents.' });
    }
    const rfq = await storeService.getRFQByIdAsync(req.params.id);
    const vendor = storeService.getVendorById(req.user.email, 'all');
    if (!rfq || !(await canAccessRfq(req, rfq)) || !vendor) {
      return res.status(404).json({ success: false, error: 'RFQ or vendor profile not found.' });
    }

    const result = await quoteAttachmentService.saveQuoteAttachment(
      {
        fileName: req.body?.fileName,
        mimeType: req.body?.mimeType,
        content: req.body?.content,
      },
      { rfqId: rfq.id, vendorId: vendor.id }
    );
    if (result.status !== rfqAttachmentService.ATTACHMENT_STATUS.SAVED) {
      const status = result.status === rfqAttachmentService.ATTACHMENT_STATUS.WRITE_FAILED ? 500 : 422;
      return res.status(status).json({
        success: false,
        reason: result.status,
        error: ATTACHMENT_ERRORS[result.status] || ATTACHMENT_ERRORS.WRITE_FAILED,
      });
    }
    return res.status(201).json({ success: true, data: result.attachment });
  } catch (err) {
    logger.error('Error storing vendor bid attachment', err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

async function downloadQuoteAttachment(req, res, next) {
  try {
    const rfq = await storeService.getRFQByIdAsync(req.params.id);
    if (!rfq || !(await canAccessRfq(req, rfq))) {
      return res.status(404).json({ success: false, error: 'Document not found.' });
    }

    if (req.user?.role === 'buyer' && storeService.isWithin48HourWindow(rfq)) {
      return res.status(403).json({ success: false, error: 'Bid documents remain sealed during the bidding window.' });
    }

    const attachmentId = req.params.attachmentId;
    const quote = (rfq.quotes || []).find((item) =>
      (item.attachments || []).some((attachment) => attachment.id === attachmentId)
    );
    if (!quote) {
      return res.status(404).json({ success: false, error: 'Document not found.' });
    }

    if (req.user?.role === 'vendor') {
      const vendor = storeService.getVendorById(req.user.email, 'all');
      if (!vendor || quote.vendorId !== vendor.id) {
        return res.status(404).json({ success: false, error: 'Document not found.' });
      }
    }

    const stored = await quoteAttachmentService.loadQuoteAttachment(attachmentId);
    if (
      !stored ||
      stored.access?.rfqId !== rfq.id ||
      stored.access?.vendorId !== quote.vendorId
    ) {
      return res.status(404).json({ success: false, error: 'Document not found.' });
    }

    res.setHeader('Content-Type', stored.meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', stored.content.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${stored.meta.fileName.replace(/["\r\n]/g, '')}"`);
    return res.send(stored.content);
  } catch (err) {
    logger.error('Error reading vendor bid attachment', err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

/**
 * Apply a buyer's edit to one of their own RFQs.
 *
 * A hit on another buyer's RFQ, or on an id that doesn't exist, reports the
 * same 404 either way (see canAccessRfq). Only RFQ_UPDATABLE_FIELDS are ever
 * written — ownership/identity fields are not part of a plain edit.
 */
async function updateRFQ(req, res, next) {
  const { id } = req.params;
  try {
    const existing = storeService.getRFQById(id);
    if (!existing || !(await canAccessRfq(req, existing))) {
      logger.warn(`RFQ not found for update: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    const body = req.body || {};
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.updateRFQ, body);
    if (!isValid) {
      logger.warn('RFQ edit rejected: payload validation failed', { id, errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    if (body.targetDeliveryDate && isPastDate(body.targetDeliveryDate)) {
      logger.warn('RFQ edit rejected: targetDeliveryDate is in the past', { id, targetDeliveryDate: body.targetDeliveryDate }, 'RFQ_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: 'Target date cannot be earlier than today.',
        fieldErrors: { targetDeliveryDate: 'Target date cannot be earlier than today.' },
      });
    }

    if (Array.isArray(body.extractedEntities)) {
      for (const item of body.extractedEntities) {
        if (item && isPastDate(item.targetDate)) {
          logger.warn('RFQ edit rejected: line item targetDate is in the past', { id, targetDate: item.targetDate }, 'RFQ_CONTROLLER');
          return res.status(400).json({
            success: false,
            error: 'Target date cannot be earlier than today.',
            fieldErrors: { targetDate: 'Target date cannot be earlier than today.' },
          });
        }
      }
    }

    const updates = pickUpdatableRfqFields(body);
    logger.info(`Updating RFQ ${id}`, { id, fields: Object.keys(updates) }, 'RFQ_CONTROLLER');
    const updated = storeService.updateRFQ(id, updates);
    if (!updated) {
      logger.warn(`RFQ not found for update: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    const role = req.user && req.user.role;
    res.json({ success: true, data: applyQuotesVisibility(updated, role) });
  } catch (err) {
    logger.error(`Error updating RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Withdraw one of the buyer's own RFQs.
 *
 * A hard delete. Reports the same 404 for another buyer's RFQ as for an id
 * that doesn't exist, so the response cannot be used to discover which ids
 * exist elsewhere.
 */
async function deleteRFQ(req, res, next) {
  const { id } = req.params;
  try {
    const existing = storeService.getRFQById(id);
    if (!existing || !(await canAccessRfq(req, existing))) {
      logger.warn(`RFQ not found for deletion: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    const removed = storeService.deleteRFQ(id);
    if (!removed) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    logger.info('Deleted RFQ', { id, rfqNumber: existing.rfqNumber }, 'RFQ_CONTROLLER');
    // The deleted number is echoed so the client can drop that row without
    // guessing which of the two identifiers it had sent.
    return res.json({ success: true, data: { rfqNumber: existing.rfqNumber, rfqId: existing.id } });
  } catch (err) {
    logger.error(`Error deleting RFQ ${id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

async function addQuote(req, res, next) {
  try {
    const { id } = req.params;
    // A quote's vendor identity must come from the authenticated session, not
    // whatever vendorName/vendorId the client body claims — otherwise any
    // authenticated user could submit a bid posing as any vendor by name.
    if (req.user.role !== 'vendor') {
      return res.status(403).json({ success: false, error: 'Only a vendor can submit a quote.' });
    }
    // 'all': resolving the caller's own vendor identity, not a buyer-scoped
    // list — see resolveRfqReadScope above for why the scope arg matters.
    const vendorRecord = storeService.getVendorById(req.user.email, 'all');
    if (!vendorRecord) {
      return res.status(400).json({ success: false, error: 'Create your vendor profile before submitting a quote.' });
    }

    const { unitPrice, totalPrice, leadTimeDays, warrantyYears, paymentTerms, remarks, vendorCategory, complianceStatus, lineItemQuotes } = req.body;
    const requestedAttachments = req.body?.attachments;
    if (requestedAttachments !== undefined && !Array.isArray(requestedAttachments)) {
      return res.status(400).json({ success: false, error: 'Bid documents must be provided as a list.' });
    }
    if (
      requestedAttachments &&
      (requestedAttachments.length > 5 || requestedAttachments.some((item) => !item?.id))
    ) {
      return res.status(400).json({ success: false, error: 'Attach no more than five valid bid documents.' });
    }
    if (!unitPrice) {
      logger.warn(`Failed to add quote to RFQ ${id}: Missing unitPrice`, { id }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: 'unitPrice is required.' });
    }
    // A vendor can only quote an RFQ they were actually eligible to see. An
    // enquiry outside their category (and not one they were invited onto)
    // reports the same 404 as an unknown id — they had no way to reach it.
    //
    // getRFQByIdAsync (not the plain in-memory getRFQById) matters here for a
    // Workers-specific reason: each isolate hydrates its own copy of `rfqs`
    // once, lazily, on its first request, and nothing re-syncs it afterward
    // except this async path's own D1 fallback. A vendor quoting an RFQ some
    // *other* isolate created got a guaranteed, permanent 404 on whichever
    // isolate served their POST until that isolate happened to restart —
    // confirmed live: 10/10 attempts against a real RFQ failed with "not
    // found" even immediately after a full hydrateFromDB() refresh, because
    // that refresh ran on a different isolate than the one serving the next
    // request. getRFQByIdAsync's DB fallback also backfills this.rfqs, so
    // the addQuoteToRFQ call below (which still uses the sync, in-memory
    // getRFQById) finds it too.
    const targetRfq = await storeService.getRFQByIdAsync(id);
    if (!targetRfq || !(await canAccessRfq(req, targetRfq))) {
      logger.warn(`RFQ not found or out of scope for quote submission: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    const isMode0 = targetRfq.sourcingMode === 'mode_0' || targetRfq.sourcingMode === 'v0';
    const isUnlocked = storeService.isRfqUnlockedForVendor(vendorRecord.id, targetRfq.id);
    if (isMode0 && !isUnlocked) {
      logger.warn(
        `Vendor ${vendorRecord.name} (${vendorRecord.id}) attempted to quote RFQ ${id} without downloading/unlocking it first`,
        { id, vendorId: vendorRecord.id },
        'RFQ_CONTROLLER'
      );
      return res.status(403).json({
        success: false,
        error: 'Please download the RFQ before submitting your bid.',
        downloadRequired: true,
      });
    }

    const eligibility = storeService.checkVendorQuotationEligibility(vendorRecord, targetRfq);
    if (!eligibility.eligible) {
      logger.warn(
        `Vendor ${vendorRecord.name} (${vendorRecord.id}) attempted to quote RFQ ${id} but 5 free quotation credits are exhausted`,
        { id, vendorId: vendorRecord.id, freeCreditsRemaining: eligibility.freeCreditsRemaining, subscriptionPlan: eligibility.subscriptionPlan },
        'RFQ_CONTROLLER'
      );
      return res.status(403).json({
        success: false,
        error: 'Your 5 free quotation credits have been used. Please upgrade your subscription plan to continue submitting quotations.',
        upgradeRequired: true,
        freeCreditsRemaining: 0,
        subscriptionPlan: eligibility.subscriptionPlan,
      });
    }

    const bidAttachments = [];
    for (const requested of requestedAttachments || []) {
      const stored = await quoteAttachmentService.loadQuoteAttachment(requested.id);
      if (
        !stored ||
        stored.access?.rfqId !== targetRfq.id ||
        stored.access?.vendorId !== vendorRecord.id
      ) {
        return res.status(400).json({ success: false, error: 'One or more bid documents are invalid or belong to another RFQ.' });
      }
      bidAttachments.push(stored.meta);
    }

    const quote = {
      vendorId: vendorRecord.id,
      vendorName: vendorRecord.name,
      vendorCategory: vendorCategory || 'Client List',
      unitPrice,
      totalPrice: totalPrice || unitPrice,
      leadTimeDays: leadTimeDays || 0,
      aiMatchScore: 0,
      warrantyYears: warrantyYears || 0,
      complianceStatus: complianceStatus || 'Pending Review',
      paymentTerms: paymentTerms || '',
      remarks: remarks || '',
      submittedAt: new Date().toISOString(),
      // Per-line-item pricing from the portal quote form, when the RFQ has
      // more than one line item — same shape the email-ingestion path
      // already populates (see emailGatewayService.js), so quote-matrix.tsx
      // compares portal and email quotes the same way regardless of
      // submission channel.
      ...(Array.isArray(lineItemQuotes) && lineItemQuotes.length > 0 ? { lineItemQuotes } : {}),
      ...(bidAttachments.length > 0 ? { attachments: bidAttachments } : {}),
    };
    logger.info(`Adding quote from ${quote.vendorName} to RFQ ${id}`, { id, vendorName: quote.vendorName, price: quote.unitPrice }, 'RFQ_CONTROLLER');
    const updatedRFQ = storeService.addQuoteToRFQ(id, quote);
    if (!updatedRFQ) {
      logger.warn(`RFQ not found for quote submission: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    storeService.consumeVendorQuotationCredit(vendorRecord.id, targetRfq.id);
    res.json({ success: true, data: updatedRFQ });
  } catch (err) {
    logger.error(`Error adding quote to RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

async function downloadRFQ(req, res, next) {
  try {
    const { id } = req.params;
    const rfq = await storeService.getRFQByIdAsync(id);
    if (!rfq || !(await canAccessRfq(req, rfq))) {
      logger.warn(`RFQ not found or access denied for download: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    if (req.user && req.user.role === 'vendor') {
      const requestingVendor = storeService.getVendorById(req.user.email, 'all');
      if (!requestingVendor) {
        return res.status(400).json({ success: false, error: 'Vendor profile not found.' });
      }

      const used = requestingVendor.rfqDownloadsUsed || 0;
      storeService.updateVendor(requestingVendor.id, { rfqDownloadsUsed: used + 1 });

      const unlockResult = await storeService.unlockRFQForVendor(requestingVendor.id, rfq.id);
      if (!unlockResult.success && unlockResult.creditsExhausted) {
        return res.status(403).json({
          success: false,
          error: unlockResult.error || 'You have used all 5 free RFQ download credits. You cannot download another RFQ using your free allowance.',
          freeCreditsRemaining: unlockResult.freeCreditsRemaining ?? 0,
          exhausted: true,
        });
      }

      const vendor = storeService.getVendorById(requestingVendor.id, 'all');
      const emailPayload = generateStandardRFQEmail(rfq, vendor);
      return res.json({
        success: true,
        data: emailPayload,
        unlocked: true,
        alreadyUnlocked: !!unlockResult.alreadyUnlocked,
        creditBalance: unlockResult.creditBalance,
        freeCreditsRemaining: unlockResult.freeCreditsRemaining,
      });
    }

    const emailPayload = generateStandardRFQEmail(rfq, null);
    res.json({ success: true, data: emailPayload });
  } catch (err) {
    logger.error(`Error downloading RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

async function generateEmailPreview(req, res, next) {
  try {
    const { id } = req.params;
    const { vendorId } = req.query;
    logger.info(`Generating email preview for RFQ ${id}`, { id, vendorId }, 'RFQ_CONTROLLER');
    const rfq = storeService.getRFQById(id);
    if (!rfq || !(await canAccessRfq(req, rfq))) {
      logger.warn(`RFQ not found for email preview: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    if (req.user && req.user.role === 'vendor') {
      const requestingVendor = storeService.getVendorById(req.user.email, 'all');
      if (requestingVendor) {
        const used = requestingVendor.rfqDownloadsUsed || 0;
        storeService.updateVendor(requestingVendor.id, { rfqDownloadsUsed: used + 1 });
        const unlockResult = await storeService.unlockRFQForVendor(requestingVendor.id, rfq.id);
        if (!unlockResult.success && unlockResult.creditsExhausted) {
          return res.status(403).json({
            success: false,
            error: unlockResult.error || 'You have used all 5 free RFQ download credits. You cannot download another RFQ using your free allowance.',
            freeCreditsRemaining: unlockResult.freeCreditsRemaining ?? 0,
            exhausted: true,
          });
        }
      }
    }

    const vendor = vendorId ? storeService.getVendorById(vendorId, 'all') : null;
    const emailPayload = generateStandardRFQEmail(rfq, vendor);
    res.json({ success: true, data: emailPayload });
  } catch (err) {
    logger.error(`Error generating email preview for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

function triggerBatchChaser(req, res, next) {
  try {
    const { id } = req.params;
    const { channels } = req.body;
    logger.info(`Triggering batch chasers for RFQ ${id}`, { id, channels }, 'RFQ_CONTROLLER');
    const result = storeService.triggerBatchChaser(id, channels || ['call', 'whatsapp', 'sms']);
    if (!result) {
      logger.warn(`RFQ not found for batch chasers: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`Error triggering batch chasers for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

function approvePO(req, res, next) {
  try {
    const { id } = req.params;
    // Awarding a PO is a buyer-side decision — a vendor has no business
    // approving their own (or anyone else's) award.
    if (!['buyer', 'category_manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to approve a pre-purchase order.' });
    }
    const { vendorId, vendorName, totalAmount, approverNotes } = req.body;
    if (!vendorName || !totalAmount) {
      logger.warn(`Failed to approve PO for RFQ ${id}: Missing vendorName or totalAmount`, { id, body: req.body }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: 'vendorName and totalAmount are required.' });
    }
    logger.info(`Approving Pre-Purchase Order for RFQ ${id}`, { id, vendorId, vendorName, totalAmount, approverNotes }, 'RFQ_CONTROLLER');
    const result = storeService.approvePurchaseOrder(id, vendorId, vendorName, totalAmount, approverNotes, req.user.email);
    if (!result) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json(result);
  } catch (err) {
    logger.error(`Error approving PO for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

async function addInquiry(req, res, next) {
  try {
    const { id } = req.params;
    const { message, vendorName, vendorEmail } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Clarification message is required.' });
    }

    const rfq = await storeService.getRFQByIdAsync(id);
    if (!rfq) {
      return res.status(404).json({ success: false, error: 'RFQ not found.' });
    }

    const result = storeService.addInquiryToRFQ(rfq.id, {
      message: message.trim(),
      vendorName: vendorName || (req.user && req.user.name) || 'Vendor Partner',
      vendorEmail: vendorEmail || (req.user && req.user.email) || null,
      vendorId: req.user && req.user.role === 'vendor' ? req.user.id : undefined,
    });

    if (!result) {
      return res.status(404).json({ success: false, error: 'Failed to add inquiry to RFQ.' });
    }

    // Dispatch acknowledgment email to vendor with buyer in CC
    const recipientVendorEmail = vendorEmail || (req.user && req.user.email);
    const buyerEmail = storeService.resolveBuyerEmailForRFQ(rfq);
    if (recipientVendorEmail) {
      mailerService
        .sendVendorIssueAcknowledgementEmail(recipientVendorEmail, {
          rfq,
          rfqNumber: rfq.rfqNumber,
          rfqTitle: rfq.title,
          vendorName: vendorName || (req.user && req.user.name) || 'Vendor Partner',
          issueMessage: message.trim(),
          cc: buyerEmail || undefined,
        })
        .catch((err) => logger.error('Failed to send vendor inquiry acknowledgment email', err, 'RFQ_CONTROLLER'));
    }

    res.status(201).json({ success: true, data: result.inquiry, rfq: result.updatedRfq });
  } catch (err) {
    logger.error(`Error adding inquiry for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

async function replyInquiry(req, res, next) {
  try {
    const { id, inquiryId } = req.params;
    const { reply } = req.body;
    if (!reply || typeof reply !== 'string' || !reply.trim()) {
      return res.status(400).json({ success: false, error: 'Reply message is required.' });
    }

    const rfq = await storeService.getRFQByIdAsync(id);
    if (!rfq) {
      return res.status(404).json({ success: false, error: 'RFQ not found.' });
    }

    const result = storeService.replyToRFQInquiry(rfq.id, inquiryId, {
      reply: reply.trim(),
      repliedBy: (req.user && req.user.name) || 'Procurement Officer',
      repliedByEmail: req.user && req.user.email,
    });

    if (!result) {
      return res.status(404).json({ success: false, error: 'Inquiry not found on this RFQ.' });
    }

    res.status(200).json({ success: true, data: result.inquiry, rfq: result.updatedRfq });
  } catch (err) {
    logger.error(`Error replying to inquiry for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getRFQs,
  getAllRFQs,
  getVendorCandidates,
  inviteVendors,
  getRFQById,
  getRFQSummary,
  createRFQ,
  ingestRFQ,
  extractRFQFromDocument,
  getEmailGatewayStatus,
  pollEmailGateway,
  uploadRFQAttachment,
  downloadRFQAttachment,
  uploadQuoteAttachment,
  downloadQuoteAttachment,
  updateRFQ,
  deleteRFQ,
  downloadRFQ,
  addQuote,
  generateEmailPreview,
  triggerBatchChaser,
  approvePO,
  addInquiry,
  replyInquiry,
  validateVendorCategories,
  requestVendorCategoryUpdate,
};
