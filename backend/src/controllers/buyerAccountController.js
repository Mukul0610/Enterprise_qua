const storeService = require('../services/storeService');
const buyerAccountResolver = require('../services/buyerAccountResolver');
const zohoPaymentService = require('../services/zohoPaymentService');
const zohoReconciliationService = require('../services/zohoReconciliationService');
const { generateReceiptPdf } = require('../services/invoiceService');
const { logger } = require('../services/loggerService');
const { ZOHO_CONFIG, computeZohoBuyerPlanAmount, BUYER_SUBSCRIPTION_PLANS } = require('../config/constants');
const identityQueries = require('../db/identityQueries');

/**
 * Buyer accounts are buyer-side org records: only a buyer (or an admin acting
 * on their behalf) has any business creating, editing, deleting or switching
 * the active one, or triggering the buyer-only historical-purchase ingestion.
 * Vendors and category managers browse buyer accounts read-only and must not
 * be able to mutate them.
 *
 * This is deliberately a role-level gate and NOT a per-record ownership check
 * like vendorController's assertVendorOwnership: any buyer/admin can still
 * mutate any buyer account record, not just their own — there is no
 * "this buyer account belongs to this specific buyer" concept enforced here.
 * (rfqController.createRFQ *does* resolve the requesting buyer's own account
 * from req.user — via storeService.getBuyerAccountByEmail — to attribute new
 * RFQs correctly; that's a separate, already-solved concern from the
 * buyer-account-record ownership gap this comment is about.)
 */
function assertBuyerAccountRole(req, res) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  if (user.role === 'buyer' || user.role === 'admin') return true;
  logger.warn('Rejected buyer account mutation from a non-buyer role', { role: user.role }, 'BUYER_ACCOUNT_CONTROLLER');
  res.status(403).json({ success: false, error: 'You do not have permission to modify buyer accounts.' });
  return false;
}

function getBuyerAccounts(req, res, next) {
  try {
    logger.info('Fetching buyer accounts', {}, 'BUYER_ACCOUNT_CONTROLLER');
    const accounts = storeService.getBuyerAccounts();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory', data: accounts });
  } catch (err) {
    logger.error('Error fetching buyer accounts', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

/**
 * The signed-in buyer's own account, read from the shared identity schema.
 *
 * Previously returned `buyerAccounts[0]` from a seeded array on an anonymous
 * route, so every session was told it belonged to the same fabricated company.
 * There is no fallback now: if the directory cannot answer, that is reported
 * rather than papered over with invented data.
 */
async function getActiveAccount(req, res, next) {
  try {
    logger.info('Resolving active buyer account from the identity schema', {}, 'BUYER_ACCOUNT_CONTROLLER');
    const resolved = await buyerAccountResolver.resolveActiveBuyerAccount(req.user);

    if (!resolved.ok) {
      return res.status(resolved.status).json({ success: false, error: resolved.error });
    }
    return res.json({ success: true, source: 'identity_database', data: resolved.account });
  } catch (err) {
    logger.error('Error resolving active buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    return next(err);
  }
}

function createBuyerAccount(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const body = req.body;
    if (!body.organizationName || !body.corporateEmail) {
      logger.warn('Failed to create buyer account: Missing organizationName or corporateEmail', { body }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(400).json({ success: false, error: 'organizationName and corporateEmail are required.' });
    }
    logger.info(`Creating new buyer account: ${body.organizationName}`, { organizationName: body.organizationName, email: body.corporateEmail }, 'BUYER_ACCOUNT_CONTROLLER');
    const created = storeService.addBuyerAccount(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

// 'free_trial' is the only subscriptionPlan value this generic endpoint may
// set directly (the free/reset-to-starter path subscription-center.tsx's
// handleResetTrial already relies on). version_1/2/3 are real, paid tiers
// that must only ever be granted by activateBuyerSubscriptionFromPayment
// after a genuine Zoho payment (createSubscriptionPaymentLink ->
// webhook/reconciliation) — this endpoint previously accepted any
// subscriptionPlan value with no check at all, letting any buyer/admin
// grant a paid plan to any buyer account (not even scoped to their own)
// for free.
function sanitizeBuyerAccountUpdates(updates, res) {
  if (!Object.prototype.hasOwnProperty.call(updates, 'subscriptionPlan')) return updates;
  if (updates.subscriptionPlan === 'free_trial') return updates;
  res.status(400).json({
    success: false,
    error: 'subscriptionPlan can only be reset to free_trial here — paid plans can only be granted via a completed Zoho payment.',
  });
  return null;
}

function updateBuyerAccount(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { id } = req.params;
    const updates = sanitizeBuyerAccountUpdates(req.body, res);
    if (!updates) return;
    logger.info(`Updating buyer account ${id}`, { id, updates }, 'BUYER_ACCOUNT_CONTROLLER');
    const updated = storeService.updateBuyerAccount(id, updates);
    if (!updated) {
      logger.warn(`Buyer account not found for update: ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('Error updating buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

function deleteBuyerAccount(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { id } = req.params;
    logger.info(`Deleting buyer account ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
    const deleted = storeService.deleteBuyerAccount(id);
    if (!deleted) {
      logger.warn(`Buyer account not found for deletion: ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({ success: true, message: `Buyer account ${id} deleted successfully.` });
  } catch (err) {
    logger.error('Error deleting buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

function setActiveAccount(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { id } = req.params;
    logger.info(`Setting active buyer account to ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
    const active = storeService.alignActiveBuyerAccount(id);
    if (!active) {
      logger.warn(`Buyer account not found to set active: ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({ success: true, data: active });
  } catch (err) {
    logger.error('Error setting active buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

// 'free_trial' is free/instant (see the frontend's handleSubscribe) and never
// reaches Zoho — only the three paid tiers are real, payable plans.
const ZOHO_PAYABLE_BUYER_PLANS = ['version_1', 'version_2', 'version_3'];

async function createSubscriptionPaymentLink(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { id } = req.params;
    const { plan, billingDuration = '12_months', duration } = req.body || {};
    const normalizedDuration = (billingDuration || duration) === '6_months' ? '6_months' : '12_months';

    // The frontend's activeBuyerAccount comes from the identity-DB-backed
    // GET /active (organisation uuid space) — a different id space from the
    // legacy storeService.buyerAccounts records this feature's subscription
    // fields actually live on (same mismatch the whole 2026-09-04
    // activeBuyerAccount investigation was about). Resolving by the caller's
    // own session email — not trusting :id to already be a
    // storeService.buyerAccounts id — is what makes both id spaces work here;
    // a real buyer with no legacy record yet (registered before this feature,
    // or via the identity DB only) gets one created on first use rather than
    // 404ing. req.user is guaranteed present here — assertBuyerAccountRole
    // above already rejected the request otherwise.
    let existing = await storeService.getBuyerAccountByEmail(req.user.email);
    if (!existing && req.user.email) {
      existing = storeService.addBuyerAccount({
        organizationName: req.user.orgName || req.user.email,
        corporateEmail: req.user.email,
        mobileNumber: '',
      });
    }
    if (!existing) {
      return res.status(404).json({ success: false, error: `Buyer account with ID ${id} not found.` });
    }
    if (!ZOHO_PAYABLE_BUYER_PLANS.includes(plan)) {
      return res.status(400).json({ success: false, error: `plan must be one of: ${ZOHO_PAYABLE_BUYER_PLANS.join(', ')}.` });
    }
    if (!existing.corporateEmail) {
      return res.status(400).json({ success: false, error: 'Buyer account has no email on file to create a payment link for.' });
    }

    // The legacy storeService.buyerAccounts record (`existing`) often has no
    // mobileNumber — e.g. it's auto-created above with '' on first payment
    // attempt, before the buyer ever fills in a profile mobile field. Login
    // itself requires email+mobile+password though, so the identity DB
    // always has a real phone for this user; Zoho's paymentlinks API 400s
    // ("Invalid data provided") on an empty phone, so fall back to the
    // identity record rather than sending a blank value.
    let phone = existing.mobileNumber || '';
    if (!phone) {
      const identityUser = await identityQueries.findUserByEmail(existing.corporateEmail).catch(() => null);
      phone = (identityUser && identityUser.mobile) || '';
    }
    if (!phone) {
      return res.status(400).json({ success: false, error: 'No mobile number on file for this account. Please update your profile with a mobile number before subscribing.' });
    }


    const amount = computeZohoBuyerPlanAmount(plan, normalizedDuration);
    const durationSuffix = normalizedDuration === '6_months' ? ' (6 Months)' : ' (12 Months)';
    const planLabel = ((BUYER_SUBSCRIPTION_PLANS.find((p) => p.id === plan) || {}).name || plan) + durationSuffix;
    // Generated before the Zoho call (not after, like the payment link record's
    // id used to be) so it can be embedded in returnUrl — Zoho's hosted
    // checkout redirects back to this exact URL regardless of whether the
    // buyer actually paid or cancelled, so a hardcoded `?payment=success`
    // here would lie about a real cancellation. The frontend instead looks
    // this id up against GET .../payment-links on return to show the link's
    // real status (PAID/CANCELED/EXPIRED/still CREATED).
    const linkId = `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const returnUrl = `${ZOHO_CONFIG.RETURN_URL_BASE}/buyer/subscription-center?linkId=${linkId}`;

    const result = await zohoPaymentService.createPaymentLink({
      planId: plan,
      planLabel,
      amountInr: amount,
      email: existing.corporateEmail,
      phone,
      returnUrl,
    });

    const link = storeService.createPaymentLinkRecord({
      id: linkId,
      zohoPaymentLinkId: result.zohoPaymentLinkId,
      buyerAccountId: existing.id,
      payerType: 'buyer',
      planId: plan,
      billingDuration: normalizedDuration,
      amount,
      paymentUrl: result.paymentUrl,
      status: result.status || 'CREATED',
      rawResponse: result.rawResponse,
    });

    logger.info(`Created Zoho payment link for buyer account ${id} (${plan}, ${normalizedDuration})`, { id, plan, billingDuration: normalizedDuration, zohoPaymentLinkId: link.zohoPaymentLinkId }, 'BUYER_ACCOUNT_CONTROLLER');
    res.json({ success: true, data: { paymentUrl: link.paymentUrl, paymentLinkId: link.id, status: link.status } });
  } catch (err) {
    logger.error(`Error creating Zoho payment link for buyer account ${req.params.id}`, err, 'BUYER_ACCOUNT_CONTROLLER');
    res.status(502).json({ success: false, error: 'Unable to create a payment link right now. Please try again shortly.' });
  }
}

/**
 * The caller's own billing history — resolved by session email, same
 * reasoning as createSubscriptionPaymentLink above (never trust :id to
 * already be the right storeService.buyerAccounts record). No auto-create
 * here, unlike the payment-link endpoint: a buyer with no legacy billing
 * record yet just sees an empty list.
 *
 * Any of the caller's own links still sitting in a non-terminal status get
 * live re-checked against Zoho before responding (zohoReconciliationService's
 * on-demand path — see its docstring for why: the sandbox webhook has proven
 * unreliable, and a buyer actively opening this list to check "did my
 * payment go through" should get a real answer immediately, not one that
 * depends on a webhook that may never arrive or the 10-minute interval poll).
 */
async function getPaymentLinks(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const existing = await storeService.getBuyerAccountByEmail(req.user.email);
    if (!existing) {
      return res.json({ success: true, data: [] });
    }
    let links = await storeService.getPaymentLinksForBuyer(existing.id);
    const reconciled = await zohoReconciliationService.reconcilePendingLinks(links);
    if (reconciled > 0) {
      links = await storeService.getPaymentLinksForBuyer(existing.id);
    }
    res.json({ success: true, data: links });
  } catch (err) {
    logger.error(`Error fetching payment links for buyer account ${req.params.id}`, err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

/** Stream a PDF receipt for one of the caller's own past payments. */
async function downloadInvoice(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { linkId } = req.params;
    const existing = await storeService.getBuyerAccountByEmail(req.user.email);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'No buyer account found for this session.' });
    }

    const link = await storeService.getPaymentLinkById(linkId);
    if (!link || link.payerType !== 'buyer' || link.buyerAccountId !== existing.id) {
      return res.status(404).json({ success: false, error: `Payment ${linkId} not found for this buyer account.` });
    }

    const planLabel = (BUYER_SUBSCRIPTION_PLANS.find((p) => p.id === link.planId) || {}).name || link.planId;
    const pdf = await generateReceiptPdf({
      link,
      payerName: existing.organizationName || existing.corporateEmail,
      payerEmail: existing.corporateEmail,
      planLabel,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${link.id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error(`Error generating invoice for buyer account ${req.params.id}`, err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

async function ingestHistoricalData(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { period, vendorRecords } = req.body;
    if (!period) {
      logger.warn('Failed to ingest historical data: Missing period', { body: req.body }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(400).json({ success: false, error: 'period is required.' });
    }
    logger.info(`Ingesting historical purchase data for period: ${period}`, { period }, 'BUYER_ACCOUNT_CONTROLLER');
    const requestingBuyerAccount = await storeService.getBuyerAccountByEmail(req.user.email);
    const result = await storeService.processHistoricalPurchaseData(period, vendorRecords || [], requestingBuyerAccount);
    res.json(result);
  } catch (err) {
    logger.error('Error ingesting historical purchase data', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

function aiCrossMatch(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { vendors = [], poLineItems = [] } = req.body;
    logger.info(`Running AI Category Cross-Match API for ${vendors.length} vendors and ${poLineItems.length} POs`, {
      vendorCount: vendors.length,
      poCount: poLineItems.length,
    }, 'BUYER_ACCOUNT_CONTROLLER');

    const matchedVendors = vendors.map((v) => {
      const vName = (v.companyName || '').toLowerCase().trim();
      const vCode = (v.vendorCode || '').toLowerCase().trim();

      const matchingPOs = poLineItems.filter((po) => {
        const pVendor = (po.vendorIdentifier || '').toLowerCase().trim();
        return (
          (vName && (pVendor.includes(vName) || vName.includes(pVendor))) ||
          (vCode && pVendor.includes(vCode))
        );
      });

      const hasMatchingPOs = matchingPOs.length > 0;
      const items = matchingPOs.map((p) => p.itemName).filter(Boolean);
      const totalAmount = matchingPOs.reduce((acc, p) => acc + (Number(p.totalSpend) || 0), 0);

      let firstSetMajor = '';
      let secondSetMinors = [];

      if (hasMatchingPOs) {
        const itemText = (items.join(' ') + ' ' + (v.companyName || '')).toLowerCase();
        if (
          itemText.includes('microsoft') ||
          itemText.includes('google') ||
          itemText.includes('azure') ||
          itemText.includes('workspace') ||
          itemText.includes('cloud') ||
          itemText.includes('license') ||
          itemText.includes('software') ||
          itemText.includes('power bi') ||
          itemText.includes('bigquery') ||
          itemText.includes('gcp') ||
          itemText.includes('saas') ||
          itemText.includes('datacenter')
        ) {
          firstSetMajor = 'Information Technology (IT) & Software';
          if (itemText.includes('cloud') || itemText.includes('azure') || itemText.includes('gcp') || itemText.includes('storage') || itemText.includes('compute') || itemText.includes('credits')) {
            secondSetMinors.push('Cloud Infrastructure & Storage');
          }
          if (itemText.includes('license') || itemText.includes('subscription') || itemText.includes('renewal') || itemText.includes('365') || itemText.includes('workspace') || itemText.includes('teams') || itemText.includes('windows server')) {
            secondSetMinors.push('Enterprise Software & Licenses');
          }
          if (itemText.includes('bigquery') || itemText.includes('power bi') || itemText.includes('analytics') || itemText.includes('data')) {
            secondSetMinors.push('Data & Analytics Platforms');
          }
          if (itemText.includes('datacenter') || itemText.includes('infrastructure') || itemText.includes('server')) {
            secondSetMinors.push('IT Infrastructure');
          }
          if (secondSetMinors.length === 0) {
            secondSetMinors.push('Enterprise Software & Licenses');
          }
        } else if (itemText.includes('pump') || itemText.includes('valve') || itemText.includes('hose') || itemText.includes('compressor')) {
          firstSetMajor = 'Engineering Spares - Mechanical';
          if (itemText.includes('pump')) secondSetMinors.push('Pumps & Accessories');
          if (itemText.includes('valve') || itemText.includes('gate') || itemText.includes('globe')) secondSetMinors.push('Hoses, Valves & Fittings');
          if (itemText.includes('hose')) secondSetMinors.push('Hoses, Valves & Fittings');
          if (itemText.includes('compressor')) secondSetMinors.push('Compressors & Accessories');
          if (itemText.includes('motor')) secondSetMinors.push('Machinery Parts');
        } else if (itemText.includes('switchgear') || itemText.includes('panel') || itemText.includes('breaker') || itemText.includes('cable')) {
          firstSetMajor = 'Engineering Spares - Electrical';
          if (itemText.includes('panel') || itemText.includes('switchgear')) secondSetMinors.push('Panels');
          if (itemText.includes('breaker') || itemText.includes('mccb')) secondSetMinors.push('Circuit Breakers');
        } else if (itemText.includes('tmt') || itemText.includes('steel') || itemText.includes('civil') || itemText.includes('peb')) {
          firstSetMajor = 'Civil Works';
          if (itemText.includes('peb')) secondSetMinors.push('PEB Structure');
          if (itemText.includes('tmt')) secondSetMinors.push('TMT BARS');
          secondSetMinors.push('Roofing Sheets');
        } else {
          firstSetMajor = 'General Spares & Consumables';
          secondSetMinors.push('Customised Parts');
        }

        secondSetMinors = Array.from(new Set(secondSetMinors));
      }

      const formattedTotal = totalAmount >= 10000000
        ? `₹${(totalAmount / 10000000).toFixed(2)} Cr`
        : totalAmount >= 100000
        ? `₹${(totalAmount / 100000).toFixed(2)} Lakh`
        : `₹${totalAmount.toLocaleString('en-IN')}`;

      return {
        id: v.id,
        vendorCode: v.vendorCode,
        companyName: v.companyName,
        email: v.email,
        contactPerson: v.contactPerson,
        phone: v.phone,
        address: v.address,
        gstNumber: v.gstNumber,
        vendorRatingScore: v.vendorRatingScore,
        hasPoHistory: hasMatchingPOs,
        categoriesMappedByBuyer: hasMatchingPOs,
        itemsSupplied: items,
        pastPoSpend: hasMatchingPOs
          ? `${formattedTotal} (${matchingPOs.length} POs)`
          : 'No PO History in Dump',
        poCount: matchingPOs.length,
        firstSetMajorCategory: firstSetMajor,
        secondSetMinorCategories: secondSetMinors,
        secondSetSecondaryMajors: hasMatchingPOs ? ['Engineering Spares - Electrical', 'Civil Works'] : [],
      };
    });

    res.json({
      success: true,
      data: matchedVendors,
      totalMatched: matchedVendors.filter((v) => v.categoriesMappedByBuyer).length,
      totalUnmatched: matchedVendors.filter((v) => !v.categoriesMappedByBuyer).length,
    });
  } catch (err) {
    logger.error('Error running AI Category Cross-Match API', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getBuyerAccounts,
  getActiveAccount,
  createBuyerAccount,
  updateBuyerAccount,
  deleteBuyerAccount,
  setActiveAccount,
  createSubscriptionPaymentLink,
  getPaymentLinks,
  downloadInvoice,
  ingestHistoricalData,
  aiCrossMatch,
};
