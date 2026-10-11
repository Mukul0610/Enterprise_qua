const {
  INITIAL_SYSTEM_CONFIG,
  INITIAL_AZURE_HEALTH,
  DATABASE_HEALTH_SERVICE_LABEL,
  SYSTEM_ACTOR_EMAIL,
  RFQ_DEFAULTS,
  resolveBuyerSourcingMode,
  VENDOR_FREE_CREDITS_LIMIT,
} = require('../config/constants');
const pool = require('../db/pool');
const domainQueries = require('../db/domainQueries');
const identityQueries = require('../db/identityQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const { getWaitUntil } = require('../db/d1Bridge');
const { createAuditEntry, verifyAuditTrail } = require('./auditService');
const { evaluateQuotes, calculate360Evaluation, calculateRevisedRating } = require('./evaluationService');
const { simulateChaserOutreach, generateAIFeedItem } = require('./aiChaserService');
// Called through the namespace so tests can stub the senders without rewiring
// storeService; every send is fire-and-forget and no-ops under test / when SMTP
// is unconfigured.
const mailerService = require('./mailerService');
// Real multi-channel outreach services — both are fire-and-forget and
// no-op under test (NODE_ENV === 'test') or when credentials are not
// configured, matching the same pattern mailerService uses above.
const whatsAppService = require('./whatsAppService');
const smsService = require('./smsService');
const rfqChaserScheduler = require('./rfqChaserScheduler');
const { logger } = require('./loggerService');

// Bound on the vendors table read at boot hydration (see hydrateFromDB) —
// same cap the bootstrap payload already applies (MAX_BOOTSTRAP_VENDORS
// below), reused here rather than invented separately: this.vendors is one
// shared in-memory cache used by both paths, so they should stay consistent.
const MAX_HYDRATION_VENDORS = 500;

class StoreService {
  constructor() {
    // Every collection starts empty and is filled from Neon by hydrateFromDB().
    //
    // Nothing here is seeded. The vendor, evaluation and catalogue seeds this
    // constructor used to inflate — five invented supplier companies with
    // contact names, phone numbers and ratings, one fabricated 360° audit, and
    // three demo SKUs — were indistinguishable from real records once loaded:
    // they appeared in the vendor master, in category dashboards and in RFQ
    // vendor selection, and the buyer had no way to tell which suppliers
    // actually existed. Buyer accounts were worse: the seed shipped four real
    // company names with invented spend and `activeBuyerAccount` was simply
    // `buyerAccounts[0]`, so whoever signed in, the dashboard attributed their
    // work to the first seeded company.
    //
    // An empty collection now means exactly that — no rows — and is reported as
    // such rather than back-filled.
    this.buyerAccounts = [];
    this.activeBuyerAccount = null;
    this.vendors = [];
    this.rfqs = [];
    this.evaluations = [];
    this.auditLogs = [];
    this.aiFeed = [];
    this.notifications = [];
    this.vendorCatalogue = [];
    this.paymentLinks = [];
    this.systemConfig = JSON.parse(JSON.stringify(INITIAL_SYSTEM_CONFIG));
    this.azureHealth = JSON.parse(JSON.stringify(INITIAL_AZURE_HEALTH));
    this.isHydratedFromDB = false;
  }

  reset() {
    this.buyerAccounts = [];
    this.activeBuyerAccount = null;
    this.vendors = [];
    this.rfqs = [];
    this.evaluations = [];
    this.auditLogs = [];
    this.aiFeed = [];
    this.notifications = [];
    this.vendorCatalogue = [];
    this.paymentLinks = [];
    this.systemConfig = JSON.parse(JSON.stringify(INITIAL_SYSTEM_CONFIG));
    this.azureHealth = JSON.parse(JSON.stringify(INITIAL_AZURE_HEALTH));
    this.isHydratedFromDB = false;
  }

  /**
   * Load every domain collection from Neon.
   *
   * Assignment is unconditional: an empty table overwrites the in-memory copy
   * with an empty array. That is the whole point of the change — the previous
   * version applied each collection only `if (rows.length > 0)`, which meant an
   * empty table silently left the seed in place and the API then served invented
   * records while reporting itself healthy.
   *
   * `isHydratedFromDB` now reports whether the read *succeeded*, not whether it
   * happened to return rows, so a legitimately empty database is still "loaded
   * from the database" rather than being mislabelled as an in-memory fallback.
   *
   * A missing DATABASE_URL or a failed read is surfaced to the caller instead of
   * being swallowed: there is no second datastore to fall back to.
   */
  async hydrateFromDB() {
    if (!pool.hasStorage()) {
      this.isHydratedFromDB = false;
      logger.error(
        'DATABASE_URL is not set — no records can be loaded and every data-backed request will fail.',
        null,
        'STORE_SERVICE'
      );
      return { hydrated: false, source: 'not_configured', error: pool.NOT_CONFIGURED_MESSAGE };
    }

    try {
      const [vendorPage, rfqs, evaluations, vendorCatalogue, buyerAccountsResult, aiFeed, auditLogs, notifications, paymentLinks] =
        await Promise.all([
          // Bounded, not domainQueries.getVendorsFromDB() (a full unbounded
          // table read) — this runs on every Worker cold start, and D1's
          // free-tier daily row-read cap was exhausted twice by exactly this:
          // Cloudflare's edge fan-out spins up many isolates under load /
          // during a deploy, each one re-reading the entire vendors table
          // once at boot. this.vendors is already documented elsewhere
          // (getVendorByIdWithDBFallback) as "a capped, bootstrap-time
          // subset" that individual DB fallbacks paper over — hydration
          // should actually honor that instead of loading everything.
          domainQueries.getVendorsPageFromDB({ limit: MAX_HYDRATION_VENDORS, offset: 0 }),
          domainQueries.getRFQsFromDB(),
          domainQueries.getEvaluationsFromDB(),
          domainQueries.getVendorCatalogueFromDB(),
          domainQueries.getBuyerAccountsFromDB(),
          domainQueries.getAIFeedFromDB(),
          domainQueries.getAuditLogsFromDB(),
          domainQueries.getNotificationsFromDB(),
          domainQueries.getPaymentLinksFromDB(),
        ]);

      this.vendors = vendorPage.rows;
      this.vendorsTotal = vendorPage.total;
      this.rfqs = rfqs;
      this.evaluations = evaluations;
      this.vendorCatalogue = vendorCatalogue;
      this.notifications = notifications;
      this.paymentLinks = paymentLinks;
      this.buyerAccounts = buyerAccountsResult.accounts;
      // activeBuyerAccount must stay a reference into this.buyerAccounts (the
      // same invariant every mutator keeps), not a separately-hydrated duplicate.
      this.activeBuyerAccount =
        this.buyerAccounts.find((a) => a.id === buyerAccountsResult.activeId) || this.buyerAccounts[0] || null;
      this.aiFeed = aiFeed;
      this.auditLogs = auditLogs;

      this.isHydratedFromDB = true;
      // The admin infrastructure list should describe the connection this load
      // just used, not a placeholder, so it is refreshed off the same boot.
      await this.refreshInfrastructureHealth().catch((err) =>
        logger.warn('Infrastructure health probe failed after hydration', { error: err.message }, 'STORE_SERVICE')
      );
      logger.info(
        'Domain records loaded from PostgreSQL',
        {
          vendors: vendorPage.rows.length,
          vendorsTotal: vendorPage.total,
          rfqs: rfqs.length,
          evaluations: evaluations.length,
          vendorCatalogue: vendorCatalogue.length,
          buyerAccounts: this.buyerAccounts.length,
          aiFeed: aiFeed.length,
          auditLogs: auditLogs.length,
          notifications: notifications.length,
          paymentLinks: paymentLinks.length,
        },
        'STORE_SERVICE'
      );
      return { hydrated: true, source: 'postgres' };
    } catch (err) {
      logger.error('Failed to load domain records from PostgreSQL', err, 'STORE_SERVICE');
      this.isHydratedFromDB = false;
      return { hydrated: false, source: 'unavailable', error: err.message };
    }
  }

  // Fire-and-forget write-through helpers — never awaited by callers, mirroring
  // the pattern already used for identity-DB writes elsewhere in this backend.
  _generateTempPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * Runs a fire-and-forget persistence write, logging on failure instead of
   * propagating it to the (already-responded) caller.
   *
   * On Workers, an async call that's neither awaited nor passed to
   * ctx.waitUntil() can be cancelled the moment the HTTP response is sent —
   * confirmed live: a created RFQ's write never reached D1 at all. This
   * hands the same promise to Workers' waitUntil (imported once in
   * worker.mjs, read back via getWaitUntil()) so the write actually
   * completes after the response goes out; a plain no-op wrapper on
   * Node/Render, where the process just keeps running regardless.
   */
  _background(promise, errorMessage) {
    const tracked = promise.catch((err) => logger.error(errorMessage, err, 'STORE_SERVICE'));
    const waitUntil = getWaitUntil();
    if (waitUntil) waitUntil(tracked);
    return tracked;
  }

  _persistVendor(vendor) {
    this._background(domainQueries.upsertVendorInDB(vendor), 'Failed to persist vendor');
  }

  /**
   * Awaits real Postgres confirmation for a just-created vendor, specifically
   * to surface a duplicate-email conflict (`vendors.email` is UNIQUE) that
   * `addVendor`'s normal fire-and-forget `_persistVendor` swallows into a log
   * line — the caller previously got a 201 for a vendor whose insert then
   * silently failed. On a real conflict, the in-memory row is rolled back so
   * the API's response matches what Postgres actually holds, and there is no
   * audit-log entry (unlike deleteVendor — this vendor was never really
   * "added" as far as the durable record is concerned).
   *
   * No-ops when no DB pool is configured, matching every other query in
   * domainQueries.js — nothing to confirm against.
   */
  async confirmVendorPersisted(vendor) {
    if (!pool.hasStorage()) return { persisted: null };
    try {
      await domainQueries.upsertVendorInDB(vendor);
      return { persisted: true };
    } catch (err) {
      const isUniqueConflict =
        (err && err.code === '23505') ||
        (err && typeof err.message === 'string' && /unique constraint/i.test(err.message)) ||
        (err && err.cause && typeof err.cause.message === 'string' && /unique constraint/i.test(err.cause.message));
      if (isUniqueConflict) {
        this.vendors = this.vendors.filter((v) => v.id !== vendor.id);
        const conflictErr = new Error(`A vendor with the email ${vendor.email} already exists.`);
        conflictErr.statusCode = 409;
        throw conflictErr;
      }
      // Any other DB failure: leave the in-memory row in place (matches the
      // existing fire-and-forget behavior elsewhere) but surface it instead
      // of reporting false success.
      logger.error('Failed to persist vendor', err, 'STORE_SERVICE');
      const persistErr = new Error('The vendor was not saved. Try again.');
      persistErr.statusCode = 500;
      throw persistErr;
    }
  }

  _removeVendor(id) {
    this._background(domainQueries.deleteVendorInDB(id), 'Failed to delete persisted vendor');
  }

  _persistPaymentLink(link) {
    this._background(domainQueries.upsertPaymentLinkInDB(link), 'Failed to persist payment link');
  }

  _persistRFQ(rfq) {
    this._background(domainQueries.upsertRFQInDB(rfq), 'Failed to persist RFQ');
  }

  _removeRFQ(id) {
    this._background(domainQueries.deleteRFQInDB(id), 'Failed to delete persisted RFQ');
  }

  _persistEvaluation(evaluation) {
    this._background(domainQueries.upsertEvaluationInDB(evaluation), 'Failed to persist evaluation');
  }

  _persistCatalogueProduct(product) {
    this._background(domainQueries.upsertCatalogueProductInDB(product), 'Failed to persist catalogue product');
  }

  _removeCatalogueProduct(id) {
    this._background(domainQueries.deleteCatalogueProductInDB(id), 'Failed to delete persisted catalogue product');
  }

  _persistBuyerAccount(account) {
    this._background(domainQueries.upsertBuyerAccountInDB(account), 'Failed to persist buyer account');
  }

  _removeBuyerAccount(id) {
    this._background(domainQueries.deleteBuyerAccountInDB(id), 'Failed to delete persisted buyer account');
  }

  _setActiveBuyerAccount(id) {
    this._background(domainQueries.setActiveBuyerAccountInDB(id), 'Failed to persist active buyer account');
  }

  _persistAIFeedItem(item) {
    this._background(domainQueries.upsertAIFeedItemInDB(item), 'Failed to persist AI feed item');
  }

  _persistAuditLog(entry) {
    this._background(domainQueries.upsertAuditLogInDB(entry), 'Failed to persist audit log entry');
  }

  _persistNotification(notification) {
    this._background(domainQueries.insertNotificationInDB(notification), 'Failed to persist notification');
  }

  _persistNotificationBatch(notifications) {
    this._background(domainQueries.bulkInsertNotificationsInDB(notifications), 'Failed to persist notification batch');
  }

  // ==========================================
  // 1. BUYER ACCOUNTS
  // ==========================================
  getBuyerAccounts() {
    return this.buyerAccounts;
  }

  getActiveBuyerAccount() {
    return this.activeBuyerAccount;
  }

  /**
   * Resolves a buyer account by its login email, case-insensitively — reads
   * straight from Postgres on every call rather than the in-memory
   * `buyerAccounts` cache, so a plan/role change made by another process (a
   * one-off script, another running instance) is visible immediately instead
   * of only after this process restarts and re-hydrates.
   *
   * Falls back to the in-memory cache when no database is configured
   * (`pool.pool` unset — the same guard every other DB-backed read in this
   * file uses, and how the test suite runs: `jest.setup.js` blanks
   * `DATABASE_URL` so tests never touch the real, shared Neon database).
   *
   * The in-memory cache entry is refreshed as a side effect so the handful of
   * other in-process paths that still iterate `this.buyerAccounts` directly
   * (e.g. `getBuyerAccounts()`) stay consistent with what was just read.
   */
  async getBuyerAccountByEmail(email) {
    if (!email) return null;
    const target = email.toLowerCase();

    if (!pool.hasStorage()) {
      return this.buyerAccounts.find((a) => (a.corporateEmail || '').toLowerCase() === target) || null;
    }

    const fresh = await domainQueries.getBuyerAccountByEmailFromDB(email);
    if (!fresh) return null;

    const idx = this.buyerAccounts.findIndex((a) => a.id === fresh.id);
    if (idx === -1) {
      this.buyerAccounts.unshift(fresh);
    } else {
      this.buyerAccounts[idx] = fresh;
    }
    if (this.activeBuyerAccount && this.activeBuyerAccount.id === fresh.id) {
      this.activeBuyerAccount = fresh;
    }
    return fresh;
  }

  addBuyerAccount(accData) {
    const newAcc = {
      ...accData,
      id: accData.id || `buyer-acc-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      totalRFQsCreated: accData.totalRFQsCreated || 0,
      totalSpend: accData.totalSpend || '$0',
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      createdDate: accData.createdDate || new Date().toISOString().substring(0, 10),
      status: accData.status || 'ACTIVE_VERIFIED',
      sourcingMode: accData.sourcingMode || 'mode_1',
      subscriptionPlan: accData.subscriptionPlan || 'free_trial',
      remainingFreeRFQs: accData.remainingFreeRFQs !== undefined ? accData.remainingFreeRFQs : 5,
    };

    this.buyerAccounts.unshift(newAcc);
    this._persistBuyerAccount(newAcc);
    this.addAuditLog({
      userEmail: newAcc.corporateEmail,
      action: `Created buyer account for ${newAcc.organizationName} (${newAcc.corporateEmail})`,
    });

    return newAcc;
  }

  updateBuyerAccount(id, updates) {
    const idx = this.buyerAccounts.findIndex((a) => a.id === id);
    if (idx === -1) return null;

    const updated = {
      ...this.buyerAccounts[idx],
      ...updates,
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
    };
    this.buyerAccounts[idx] = updated;
    this._persistBuyerAccount(updated);

    if (this.activeBuyerAccount && this.activeBuyerAccount.id === id) {
      this.activeBuyerAccount = updated;
    }

    return updated;
  }

  deleteBuyerAccount(id) {
    const beforeLen = this.buyerAccounts.length;
    this.buyerAccounts = this.buyerAccounts.filter((a) => a.id !== id);
    if (this.buyerAccounts.length < beforeLen) {
      this._removeBuyerAccount(id);
      if (this.activeBuyerAccount && this.activeBuyerAccount.id === id) {
        this.activeBuyerAccount = this.buyerAccounts[0] || null;
        if (this.activeBuyerAccount) this._setActiveBuyerAccount(this.activeBuyerAccount.id);
      }
      return true;
    }
    return false;
  }

  alignActiveBuyerAccount(id) {
    const target = this.buyerAccounts.find((a) => a.id === id);
    if (!target) return null;
    this.activeBuyerAccount = target;
    this._setActiveBuyerAccount(id);
    return target;
  }

  /**
   * Atomically check and consume one free trial RFQ slot for a buyer account.
   * Eliminates race conditions from concurrent RFQ creation requests.
   */
  tryConsumeFreeRFQ(id) {
    const idx = this.buyerAccounts.findIndex((a) => a.id === id);
    if (idx === -1) return { ok: false, remaining: 0 };
    const buyer = this.buyerAccounts[idx];
    const remaining = buyer.remainingFreeRFQs !== undefined ? buyer.remainingFreeRFQs : 5;
    if (remaining <= 0) {
      return { ok: false, remaining: 0 };
    }
    const updated = {
      ...buyer,
      remainingFreeRFQs: remaining - 1,
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
    };
    this.buyerAccounts[idx] = updated;
    this._persistBuyerAccount(updated);
    if (this.activeBuyerAccount && this.activeBuyerAccount.id === id) {
      this.activeBuyerAccount = updated;
    }
    return { ok: true, remaining: updated.remainingFreeRFQs };
  }

  /**
   * Refund a reserved free trial RFQ slot if RFQ creation fails downstream.
   */
  refundFreeRFQ(id) {
    const idx = this.buyerAccounts.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const buyer = this.buyerAccounts[idx];
    const current = buyer.remainingFreeRFQs !== undefined ? buyer.remainingFreeRFQs : 0;
    const updated = {
      ...buyer,
      remainingFreeRFQs: Math.min(5, current + 1),
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
    };
    this.buyerAccounts[idx] = updated;
    this._persistBuyerAccount(updated);
    if (this.activeBuyerAccount && this.activeBuyerAccount.id === id) {
      this.activeBuyerAccount = updated;
    }
  }

  // ==========================================
  // 2. VENDORS
  // ==========================================
  /**
   * Re-syncs `this.vendors` from Neon before reading. A vendor row written by
   * a different process instance (another backend deploy, or a bulk import
   * that ran against a process other than the one serving this request)
   * would otherwise be invisible forever — the in-memory cache only reflects
   * what this specific process happened to load at boot or write itself.
   * Same pattern as getPaymentLinksForVendor/getPaymentLinksForBuyer.
   */
  async getVendors(scopedBuyerId = null) {
    if (pool.hasStorage()) {
      const allFromDB = await domainQueries.getVendorsFromDB();
      const byId = new Map(this.vendors.map((v) => [v.id, v]));
      for (const vendor of allFromDB) byId.set(vendor.id, vendor);
      this.vendors = Array.from(byId.values());
    }
    if (scopedBuyerId === 'all') {
      return this.vendors;
    }
    return this.vendors.filter((v) => {
      // Platform / network vendors with no buyerId are public
      if (!v.buyerId && !v.buyerAccountId) {
        return true;
      }
      // Buyer-uploaded vendors are only visible if scopedBuyerId matches
      if (!scopedBuyerId) {
        return false;
      }
      const sId = String(scopedBuyerId).toLowerCase();
      return (
        (v.buyerId && String(v.buyerId).toLowerCase() === sId) ||
        (v.buyerAccountId && String(v.buyerAccountId).toLowerCase() === sId) ||
        (v.buyerEmail && String(v.buyerEmail).toLowerCase() === sId)
      );
    });
  }

  getVendorById(id, scopedBuyerId = null) {
    const vendor = this.vendors.find((v) => v.id === id || v.email === id);
    if (!vendor) return undefined;
    if (scopedBuyerId === 'all') return vendor;
    if (!vendor.buyerId && !vendor.buyerAccountId) return vendor;
    if (!scopedBuyerId) return undefined;
    const sId = String(scopedBuyerId).toLowerCase();
    const matches =
      (vendor.buyerId && String(vendor.buyerId).toLowerCase() === sId) ||
      (vendor.buyerAccountId && String(vendor.buyerAccountId).toLowerCase() === sId) ||
      (vendor.buyerEmail && String(vendor.buyerEmail).toLowerCase() === sId);
    return matches ? vendor : undefined;
  }

  /**
   * getVendorById, but falls back to a direct D1/Postgres lookup (by id, then
   * by email) when the in-memory `this.vendors` subset doesn't have the row.
   *
   * this.vendors is a capped, bootstrap-time subset (600k+ real vendors can't
   * all live in memory — see getVendorsPageFromDB), so a vendor that exists
   * for real but wasn't in that subset previously 404'd here even though it
   * was genuinely persisted. That silently broke a vendor's own "load my
   * profile" GET, which made the frontend treat it as a first-time profile
   * (blank form) and then hit the real UNIQUE-email conflict on save. Mirrors
   * the identical fallback already used for RFQ-invite vendor resolution.
   */
  async getVendorByIdWithDBFallback(id, scopedBuyerId = null) {
    const inMemory = this.getVendorById(id, scopedBuyerId);
    if (inMemory) return inMemory;
    let vendor = await domainQueries.getVendorByIdFromDB(id);
    if (!vendor) vendor = await domainQueries.getVendorByEmailFromDB(id);
    if (!vendor) return undefined;
    if (!this.vendors.some((v) => v.id === vendor.id)) this.vendors.push(vendor);
    return this.getVendorById(vendor.id, scopedBuyerId);
  }

  addVendor(vendorData, actorEmail = null, buyerId = null) {
    // A client-supplied id was previously trusted as-is (never checked for
    // uniqueness) and the auto-generated fallback was only the last 4 digits
    // of Date.now() — collision-prone within the same ~10s window, and a
    // deliberate duplicate `id` in the request body would shadow an existing
    // vendor for every future id-based lookup (getVendorById/updateVendor
    // resolve by the *first* array match). The id is now always generated
    // server-side; nothing in the app currently has a legitimate reason to
    // request a specific vendor id.
    const { id: _ignoredClientId, ...safeVendorData } = vendorData;
    const resolvedBuyerId = buyerId || vendorData.buyerId || vendorData.buyerAccountId || null;
    const newVendor = {
      ...safeVendorData,
      id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      buyerId: resolvedBuyerId,
      buyerAccountId: resolvedBuyerId,
      rating: vendorData.rating || 4.5,
      score: vendorData.score || 85.0,
      source: vendorData.source || (resolvedBuyerId || vendorData.addedByBuyerCompany ? 'buyer_manual' : 'procucev_network'),
      status: vendorData.status || 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: vendorData.evaluated !== undefined ? vendorData.evaluated : false,
      hasRecord: vendorData.hasRecord !== undefined ? vendorData.hasRecord : false,
      isExistingInDatabase: vendorData.isExistingInDatabase !== undefined ? vendorData.isExistingInDatabase : true,
      // Was defaulting to 'sent' unconditionally even though nothing below
      // ever actually sent an email — a buyer adding a vendor by email saw a
      // "sent" status that was simply a lie. Now starts 'pending' and only
      // flips to 'sent' once mailerService confirms real delivery, mirroring
      // bulkAddVendors' already-correct pattern below.
      onboardingEmailStatus: vendorData.email ? 'pending' : (vendorData.onboardingEmailStatus || 'sent'),
      isCategoryAligned: vendorData.isCategoryAligned !== undefined ? vendorData.isCategoryAligned : true,
      // Every vendor starts on the free client-uploaded tier with a clean
      // download counter and initial free quotation credits.
      subscriptionPlan: vendorData.subscriptionPlan || 'premium',
      rfqDownloadsUsed: vendorData.rfqDownloadsUsed || 0,
      freeQuotationCredits: vendorData.freeQuotationCredits !== undefined
        ? Number(vendorData.freeQuotationCredits)
        : VENDOR_FREE_CREDITS_LIMIT,
      quotedRfqIds: Array.isArray(vendorData.quotedRfqIds) ? vendorData.quotedRfqIds : [],
    };

    this.vendors.unshift(newVendor);
    this._persistVendor(newVendor);
    this.addAuditLog({
      // The signed-in caller when the controller could resolve one. Falls back to
      // the system marker rather than naming a fabricated procurement mailbox.
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Registered vendor ${newVendor.name} in category ${newVendor.majorCategory}`,
    });

    // Onboarding provisioning is NOT auto-fired here anymore. It used to run
    // via this._background(), a fire-and-forget waitUntil call — but that can
    // silently never complete on Workers (confirmed live: a buyer added a
    // vendor, got a normal 201, and the vendor had no login at all
    // afterward, no error surfaced anywhere). Worse, once the controller
    // started awaiting provisioning itself (see createVendor), having BOTH
    // this background call and the controller's explicit await fire at once
    // raced past _provisionVendorOnboarding's existing-identity guard before
    // either had committed, creating two separate "user" rows for the same
    // email with two different temp passwords — confirmed live. addVendor's
    // only caller (createVendor) now awaits provisionVendorOnboarding
    // itself, synchronously, before responding — see that controller.
    return newVendor;
  }

  /**
   * Public entry point for callers that need onboarding provisioning to
   * genuinely complete before they respond — e.g. createVendor's controller,
   * which awaits this directly rather than relying on addVendor's internal
   * fire-and-forget call (below). Safe to call twice for the same vendor:
   * _provisionVendorOnboarding checks for an existing identity account first
   * and no-ops if one is already there, so this and addVendor's own
   * background attempt don't race into a double-create.
   */
  async provisionVendorOnboarding(vendor, actorEmail = null) {
    return this._provisionVendorOnboarding(vendor, actorEmail);
  }

  async _provisionVendorOnboarding(vendor, actorEmail = null) {
    // Real, previously-shipped bug found live: identityQueries.insertVendorAccount
    // unconditionally resets password + phone on an *existing* identity
    // account when one is found for the email — correct for the CLI
    // provisioning script this function shares that code with (an explicit
    // admin action recreating known credentials), but this function runs
    // automatically on every ordinary vendor-profile creation, including for
    // an email that already has a real login the vendor actually knows and
    // uses. That combination silently clobbered a real account's password
    // with a random temp one the vendor was never told, breaking their login
    // with no warning (confirmed live: yagnik.c@ahduni.edu.in). A vendor
    // *profile* being created is not the same event as a vendor *identity*
    // being created — this only provisions identity/sends onboarding
    // credentials when there is genuinely no identity account yet.
    const existingIdentity = await identityQueries.findUserByEmail(vendor.email).catch(() => null);
    if (existingIdentity) {
      logger.info(
        `Skipped onboarding identity provisioning for ${vendor.email}: an identity account already exists`,
        { vendorId: vendor.id },
        'STORE_SERVICE'
      );
      return;
    }

    const tempPassword = this._generateTempPassword();

    let identityCreated = false;
    for (let attempt = 1; attempt <= 2 && !identityCreated; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await identityQueries.insertVendorAccount({
          email: vendor.email,
          password: tempPassword,
          phone: vendor.phone || null,
          fullName: vendor.contactPerson || vendor.name,
          organizationName: vendor.name,
          createdBy: actorEmail || 'buyer-manual-add',
        });
        identityCreated = true;
      } catch (err) {
        logger.error(
          `Failed to create vendor identity account for ${vendor.email} (attempt ${attempt}/2)`,
          err,
          'STORE_SERVICE'
        );
      }
    }

    if (!identityCreated) {
      this.updateVendor(vendor.id, { onboardingEmailStatus: 'failed' });
      return;
    }

    const emailPayload = mailerService.buildVendorOnboardingEmail({
      to: vendor.email,
      recipientName: vendor.contactPerson || vendor.name,
      buyerOrganizationName: 'Procucev Enterprise',
      vendorCode: vendor.id,
      tempPassword,
      contactPhone: vendor.phone,
    });

    try {
      const delivery = await mailerService.sendVendorIngestionEmail(emailPayload, 'onboarding');
      if (delivery.sent) {
        this.updateVendor(vendor.id, { onboardingEmailStatus: 'sent', tempPassword });
        logger.info(`Onboarding email sent to ${vendor.email}`, { vendorId: vendor.id }, 'STORE_SERVICE');
      } else {
        this.updateVendor(vendor.id, { onboardingEmailStatus: 'failed' });
        logger.warn(`Failed to send onboarding email to ${vendor.email}`, { reason: delivery.reason }, 'STORE_SERVICE');
      }
    } catch (err) {
      this.updateVendor(vendor.id, { onboardingEmailStatus: 'failed' });
      logger.error(`Error sending onboarding email to ${vendor.email}`, err, 'STORE_SERVICE');
    }
  }

  /**
   * Bulk-import already-validated vendor rows from a category manager's
   * Excel upload (one call per uploaded-file chunk from the client, not one
   * call per row). Unlike addVendor's fire-and-forget persistence, this
   * awaits the real Neon write so the caller's per-row result — imported,
   * duplicate, or failed — reflects what was actually stored, not an
   * optimistic guess. The reference p2pservices app reports every row as
   * "Failed" regardless of outcome (it re-checks each row against the
   * record it just inserted); the whole point of this method is to never
   * repeat that.
   *
   * @param {object[]} rows - Rows that already passed field-format
   *   validation (VALIDATION_SCHEMAS.vendorBulkImportRow) — this method's
   *   only remaining job is duplicate detection and the actual bulk write.
   * @returns {Promise<{results: object[], importedCount: number, duplicateCount: number}>}
   */
  async bulkAddVendors(rows) {
    // Neon is the single source of truth for vendor records (see the standing
    // "no in-memory-only data path" principle). A bulk import with no database
    // configured must fail loudly, not silently accept rows into `this.vendors`
    // that vanish on the next restart and were never really "imported".
    if (!pool.hasStorage()) {
      const err = new Error('Database is not configured — vendors cannot be bulk-imported right now.');
      err.statusCode = 500;
      throw err;
    }

    const existingEmails = new Set(this.vendors.map((v) => (v.email || '').toLowerCase()));
    const seenInBatch = new Set();
    const seenVendorCodesInBatch = new Set();
    const results = [];
    const toInsert = [];

    rows.forEach((row, idx) => {
      const email = (row.email || '').toLowerCase();
      const vendorCode = (row.vendorCode || '').trim().toLowerCase();

      if (vendorCode) {
        if (seenVendorCodesInBatch.has(vendorCode)) {
          results.push({
            rowNumber: row.rowNumber,
            status: 'duplicate',
            email: row.email,
            reason: `Duplicate Vendor Code "${row.vendorCode}" within the uploaded file.`,
          });
          return;
        }
        seenVendorCodesInBatch.add(vendorCode);
      }

      if (email) {
        if (existingEmails.has(email)) {
          results.push({ rowNumber: row.rowNumber, status: 'duplicate', email: row.email, reason: 'A vendor with this email already exists.' });
          return;
        }
        if (seenInBatch.has(email)) {
          results.push({ rowNumber: row.rowNumber, status: 'duplicate', email: row.email, reason: 'Duplicate email within the uploaded file.' });
          return;
        }
        seenInBatch.add(email);
      }

      const newVendor = {
        id: `v-bulk-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        vendorCode: row.vendorCode || '',
        name: row.name,
        contactPerson: row.contactPerson || '',
        phone: row.phone,
        email: row.email || null,
        majorCategory: row.majorCategory || 'Uncategorised',
        minorCategories: row.minorCategories || [],
        location: row.city || '',
        city: row.city || '',
        state: row.state || '',
        pincode: row.pincode || '',
        gstin: row.gstin || '',
        products: row.products || '',
        rating: 4.5,
        score: 85.0,
        // A category manager's upload feeds the shared Procucev network
        // ('excel', unscoped); a buyer's own upload is their private roster
        // and carries buyerId/addedByBuyerCompany through from the
        // controller (see vendorController.bulkImportVendors) — same
        // attribution the single-add createVendor path already applies.
        source: row.source || 'excel',
        ...(row.buyerId ? { buyerId: row.buyerId } : {}),
        ...(row.addedByBuyerCompany ? { addedByBuyerCompany: row.addedByBuyerCompany } : {}),
        status: 'REGISTERED / NOT EVALUATED',
        evaluated: false,
        hasRecord: false,
        isExistingInDatabase: true,
        onboardingEmailStatus: 'pending',
        isCategoryAligned: true,
        subscriptionPlan: 'premium',
        rfqDownloadsUsed: 0,
        freeQuotationCredits: VENDOR_FREE_CREDITS_LIMIT,
        quotedRfqIds: [],
        // Carried through from the request's server-side re-validation
        // (see vendorController.bulkImportVendors) so a row that failed a
        // format check (bad email/phone/GSTIN/pincode, or a normally-
        // required field left blank) still lands as a real vendor record —
        // just one the CM can see is questionable, not one that got
        // silently dropped or had a value invented for it.
        hasIssues: !!row.hasIssues,
        issues: Array.isArray(row.issues) ? row.issues : [],
      };
      toInsert.push({ rowNumber: row.rowNumber, vendor: newVendor });
    });

    let insertedEmails = [];
    if (toInsert.length > 0) {
      insertedEmails = await domainQueries.bulkInsertVendorsInDB(toInsert.map((r) => r.vendor));
    }
    const insertedEmailSet = new Set(insertedEmails.map((e) => (e || '').toLowerCase()));

    // One round trip for the whole batch instead of one findUserByEmail call
    // per row — a bulk import chunk in the hundreds/thousands of rows made
    // that many sequential D1 subrequests inside this loop alone, which hit
    // the Workers per-invocation subrequest cap outright ("Too many API
    // requests by single Worker invocation"), confirmed live.
    const existingUsernames = await identityQueries
      .findExistingUsernames(insertedEmails.filter(Boolean))
      .catch(() => new Set());

    // insertVendorAccount itself makes several sequential subrequests per
    // call (role/org-type/status resolution + an org lookup + the insert),
    // so firing it for every new row in a large chunk hits the same
    // per-invocation subrequest cap the insert/lookup batching above just
    // fixed — a 1000-new-row chunk alone would need ~5000 more subrequests.
    // Capped rather than removed: a typical CM/buyer upload chunk (a
    // realistic mix of duplicates/existing-in-DB rows, not 1000 all-new
    // synthetic emails) stays exactly as responsive as before for the
    // common case; only the excess beyond this cap is deferred, left
    // 'pending' (already the row's default), for a follow-up onboarding
    // pass rather than crashing the whole request.
    const MAX_SYNCHRONOUS_ONBOARDING_PER_IMPORT = 15;
    let provisionedThisImport = 0;

    for (const { rowNumber, vendor } of toInsert) {
      // A null-email row can never hit the ON CONFLICT (email) target, so it
      // always inserts — there is nothing to look up in insertedEmailSet.
      const persisted = !vendor.email || insertedEmailSet.has(vendor.email.toLowerCase());
      if (persisted) {
        this.vendors.unshift(vendor);
        results.push({
          rowNumber,
          status: 'imported',
          email: vendor.email,
          missingEmail: !vendor.email,
          hasIssues: vendor.hasIssues,
          issues: vendor.issues,
          vendor,
        });

        if (vendor.email && existingUsernames.has(vendor.email.toLowerCase())) {
          // Same real bug as _provisionVendorOnboarding's comment describes:
          // insertVendorAccount resets password+phone on an existing
          // identity account. A bulk import row for an email that already
          // has a real login must never touch it or mail out fake "new"
          // credentials for an account the buyer/vendor already uses.
          logger.info(
            `Skipped onboarding identity provisioning for ${vendor.email}: an identity account already exists`,
            { vendorId: vendor.id },
            'STORE_SERVICE'
          );
        } else if (vendor.email && provisionedThisImport < MAX_SYNCHRONOUS_ONBOARDING_PER_IMPORT) {
          provisionedThisImport += 1;
          const tempPassword = this._generateTempPassword();
          // Both handed to waitUntil (via _background) — bare fire-and-forget
          // here meant Workers could cancel either before it actually ran,
          // same bug confirmed live in addVendor's own onboarding call (see
          // that comment). A bulk-imported vendor with no identity account
          // and no onboarding email is a vendor with no way to ever log in.
          this._background(
            identityQueries.insertVendorAccount({
              email: vendor.email,
              password: tempPassword,
              phone: vendor.phone || null,
              fullName: vendor.contactPerson || vendor.name,
              organizationName: vendor.name,
              createdBy: 'vendor-bulk-import',
            }),
            `Failed to create vendor identity account for ${vendor.email}`
          );

          const emailPayload = mailerService.buildVendorOnboardingEmail({
            to: vendor.email,
            recipientName: vendor.contactPerson || vendor.name,
            buyerOrganizationName: 'Procucev Enterprise',
            vendorCode: vendor.id,
            tempPassword,
            contactPhone: vendor.phone,
          });

          this._background(
            mailerService.sendVendorIngestionEmail(emailPayload, 'onboarding').then((delivery) => {
              if (delivery.sent) {
                this.updateVendor(vendor.id, { onboardingEmailStatus: 'sent', tempPassword });
                logger.info(`Onboarding email sent to ${vendor.email}`, { vendorId: vendor.id }, 'STORE_SERVICE');
              } else {
                logger.warn(`Failed to send onboarding email to ${vendor.email}`, { reason: delivery.reason }, 'STORE_SERVICE');
              }
            }),
            `Error sending onboarding email to ${vendor.email}`
          );
        } else if (vendor.email) {
          logger.info(
            `Deferred onboarding provisioning for ${vendor.email}: synchronous cap (${MAX_SYNCHRONOUS_ONBOARDING_PER_IMPORT}) reached for this import`,
            { vendorId: vendor.id },
            'STORE_SERVICE'
          );
        }
      } else {
        results.push({ rowNumber, status: 'duplicate', email: vendor.email, reason: 'A vendor with this email already exists.' });
      }
    }

    const importedCount = results.filter((r) => r.status === 'imported').length;
    const duplicateCount = results.filter((r) => r.status === 'duplicate').length;
    const missingEmailCount = results.filter((r) => r.status === 'imported' && r.missingEmail).length;

    if (importedCount > 0) {
      this.addAuditLog({
        userEmail: 'procurement@enterprise.com',
        action: `Bulk-imported ${importedCount} vendor(s) via Excel upload (${duplicateCount} duplicate row(s) skipped, ${missingEmailCount} missing an email)`,
      });
    }

    return { results, importedCount, duplicateCount, missingEmailCount };
  }

  updateVendor(id, updates) {
    const idx = this.vendors.findIndex((v) => v.id === id || v.email === id);
    if (idx === -1) return null;

    // A client payload must never be able to reassign the record's primary
    // key (would corrupt this.vendors' id-uniqueness and orphan the old id).
    const { id: _ignoredId, ...safeUpdates } = updates;
    const updated = { ...this.vendors[idx], ...safeUpdates };
    this.vendors[idx] = updated;
    this._persistVendor(updated);

    return updated;
  }

  deleteVendor(id, actorEmail = null) {
    const target = this.vendors.find((v) => v.id === id || v.email === id);
    const beforeLen = this.vendors.length;
    this.vendors = this.vendors.filter((v) => v.id !== id && v.email !== id);
    if (this.vendors.length < beforeLen) {
      this._removeVendor(target ? target.id : id);
      // Deletion was the only vendor mutation that wrote no audit entry, so a
      // vendor disappearing from the master left no record of who removed it or
      // when — the addVendor and updateVendor paths both log, and the removal of
      // a supplier is the change most worth being able to account for.
      this.addAuditLog({
        userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
        action: `Removed vendor ${target ? target.name : id} (${target && target.email ? target.email : 'no email on record'}) from the vendor master`,
      });
      return true;
    }
    return false;
  }



  /**
   * Checks whether a vendor is mapped to / owned by the buyer who created the given RFQ.
   *
   * A vendor is buyer-mapped when uploaded or added by that respective buyer:
   *  - vendor.buyerId / vendor.buyerAccountId matches rfq.buyerAccountId
   *  - vendor.addedByBuyerCompany matches rfq.buyerAccountName
   *  - vendor.buyerEmail matches rfq.buyerEmail / rfq.raisedByEmail
   *  - vendor.mappedBuyerIds / vendor.buyerIds includes rfq.buyerAccountId
   *  - or the resolved buyerAccount for the RFQ matches the vendor's buyer fields.
   */
  isVendorMappedToRfqBuyer(vendor, rfq) {
    if (!vendor || !rfq) return false;

    const rfqBuyerId = rfq.buyerAccountId ? String(rfq.buyerAccountId).trim().toLowerCase() : null;
    const rfqBuyerName = rfq.buyerAccountName ? String(rfq.buyerAccountName).trim().toLowerCase() : null;
    const rfqBuyerEmail = (rfq.buyerEmail || rfq.raisedByEmail) ? String(rfq.buyerEmail || rfq.raisedByEmail).trim().toLowerCase() : null;

    const vBuyerId = vendor.buyerId ? String(vendor.buyerId).trim().toLowerCase() : null;
    const vBuyerAccountId = vendor.buyerAccountId ? String(vendor.buyerAccountId).trim().toLowerCase() : null;
    const vAddedBy = vendor.addedByBuyerCompany ? String(vendor.addedByBuyerCompany).trim().toLowerCase() : null;
    const vBuyerEmail = vendor.buyerEmail ? String(vendor.buyerEmail).trim().toLowerCase() : null;

    // Direct id match
    if (rfqBuyerId && (vBuyerId === rfqBuyerId || vBuyerAccountId === rfqBuyerId)) {
      return true;
    }

    // Direct company name match
    if (rfqBuyerName && vAddedBy && vAddedBy === rfqBuyerName) {
      return true;
    }

    // Direct email match
    if (rfqBuyerEmail && vBuyerEmail && vBuyerEmail === rfqBuyerEmail) {
      return true;
    }

    // Array of mapped buyer ids if present
    const mappedIds = Array.isArray(vendor.mappedBuyerIds)
      ? vendor.mappedBuyerIds
      : (Array.isArray(vendor.buyerIds) ? vendor.buyerIds : []);
    if (rfqBuyerId && mappedIds.some((id) => String(id).trim().toLowerCase() === rfqBuyerId)) {
      return true;
    }

    // Fallback: check buyerAccount lookup if one side only has email/id and the other has company name
    if (rfqBuyerId && Array.isArray(this.buyerAccounts)) {
      const buyerAcc = this.buyerAccounts.find(
        (a) => a && (String(a.id).trim().toLowerCase() === rfqBuyerId || (a.corporateEmail && String(a.corporateEmail).trim().toLowerCase() === rfqBuyerId))
      );
      if (buyerAcc) {
        const orgName = (buyerAcc.organizationName || '').trim().toLowerCase();
        const corpEmail = (buyerAcc.corporateEmail || '').trim().toLowerCase();
        if (orgName && vAddedBy && vAddedBy === orgName) return true;
        if (corpEmail && vBuyerEmail && vBuyerEmail === corpEmail) return true;
      }
    }

    // Direct invitation match: buyer specifically assigned or invited this vendor to this RFQ
    const vId = vendor.id ? String(vendor.id).trim().toLowerCase() : null;
    const vEmail = vendor.email ? String(vendor.email).trim().toLowerCase() : null;
    const vName = vendor.name ? String(vendor.name).trim().toLowerCase() : null;

    if (Array.isArray(rfq.assignedVendors)) {
      const isAssigned = rfq.assignedVendors.some((av) => {
        if (!av) return false;
        const avId = av.id ? String(av.id).trim().toLowerCase() : null;
        const avEmail = av.email ? String(av.email).trim().toLowerCase() : null;
        const avName = av.name ? String(av.name).trim().toLowerCase() : null;
        return (vId && avId && vId === avId) || (vEmail && avEmail && vEmail === avEmail) || (vName && avName && vName === avName);
      });
      if (isAssigned) return true;
    }

    if (rfq.followUpData && Array.isArray(rfq.followUpData.vendors)) {
      const isInvited = rfq.followUpData.vendors.some((fv) => {
        if (!fv) return false;
        const fvId = (fv.id || fv.vendorId) ? String(fv.id || fv.vendorId).trim().toLowerCase() : null;
        const fvEmail = fv.email ? String(fv.email).trim().toLowerCase() : null;
        const fvName = (fv.name || fv.vendorName) ? String(fv.name || fv.vendorName).trim().toLowerCase() : null;
        return (vId && fvId && vId === fvId) || (vEmail && fvEmail && vEmail === fvEmail) || (vName && fvName && vName === fvName);
      });
      if (isInvited) return true;
    }

    return false;
  }

  /**
   * Check whether a vendor is eligible to submit a quotation for an RFQ.
   *
   * Buyer-specific vendor access rule:
   * When a buyer uploads or adds a vendor to their vendor list, that vendor is eligible
   * to submit unlimited quotations for RFQs created by that respective buyer, without requiring
   * a subscription or consuming the vendor's 5 free bid credits.
   *
   * Otherwise (for other buyers' RFQs or network RFQs):
   * Initial allowance: Each vendor starts with 5 free quotation credits.
   * Once free credits are exhausted, an active paid subscription ('connect' or 'select')
   * is strictly required.
   */
  checkVendorQuotationEligibility(vendor, rfq = null) {
    if (!vendor) {
      return {
        eligible: false,
        reason: 'Vendor record not found',
        freeCreditsRemaining: 0,
        isSubscribed: false,
        isBuyerMapped: false,
        subscriptionPlan: 'none',
      };
    }

    const isBuyerMapped = Boolean(rfq && this.isVendorMappedToRfqBuyer(vendor, rfq));

    const freeCredits = vendor.freeQuotationCredits !== undefined
      ? Number(vendor.freeQuotationCredits)
      : (vendor.freeRfqDownloadCredits !== undefined ? Number(vendor.freeRfqDownloadCredits) : VENDOR_FREE_CREDITS_LIMIT);

    const isSubscribed = Boolean(
      vendor.subscriptionPlan === 'connect' ||
      vendor.subscriptionPlan === 'select' ||
      vendor.isSubscribed === true ||
      vendor.subscriptionStatus === 'active'
    );

    // If buyer-mapped for this respective buyer's RFQ: unlimited quotations, no subscription needed.
    const eligible = isBuyerMapped || freeCredits > 0 || isSubscribed;

    return {
      eligible,
      freeCreditsRemaining: Math.max(0, freeCredits),
      isSubscribed: isSubscribed || isBuyerMapped,
      isBuyerMapped,
      subscriptionPlan: vendor.subscriptionPlan || 'premium',
    };
  }

  /**
   * Retrieves authoritative RFQ download credit balance & stats for a vendor.
   */
  getVendorRfqCredits(vendorIdOrEmail) {
    const vendor = this.getVendorById(vendorIdOrEmail, 'all');
    if (!vendor) {
      return {
        vendorId: vendorIdOrEmail,
        freeCreditsAllocated: VENDOR_FREE_CREDITS_LIMIT,
        freeCreditsUsed: 0,
        freeCreditsRemaining: 0,
        isSubscribed: false,
        subscriptionPlan: 'none',
        unlockedRfqIds: [],
      };
    }

    const freeCredits = vendor.freeQuotationCredits !== undefined
      ? Number(vendor.freeQuotationCredits)
      : (vendor.freeRfqDownloadCredits !== undefined ? Number(vendor.freeRfqDownloadCredits) : VENDOR_FREE_CREDITS_LIMIT);

    const isSubscribed = Boolean(
      vendor.subscriptionPlan === 'connect' ||
      vendor.subscriptionPlan === 'select' ||
      vendor.isSubscribed === true ||
      vendor.subscriptionStatus === 'active'
    );

    const allocated = vendor.freeCreditsAllocated !== undefined ? Number(vendor.freeCreditsAllocated) : VENDOR_FREE_CREDITS_LIMIT;
    const remaining = Math.max(0, freeCredits);
    const used = vendor.freeCreditsUsed !== undefined ? Number(vendor.freeCreditsUsed) : Math.max(0, allocated - remaining);

    return {
      vendorId: vendor.id,
      freeCreditsAllocated: allocated,
      freeCreditsUsed: used,
      freeCreditsRemaining: remaining,
      isSubscribed,
      subscriptionPlan: vendor.subscriptionPlan || 'premium',
      unlockedRfqIds: Array.isArray(vendor.unlockedRfqIds) ? vendor.unlockedRfqIds : [],
    };
  }

  /**
   * Checks whether an RFQ has been unlocked / downloaded by a given vendor.
   * Buyer-mapped vendors quoting their own buyer's RFQs are always unlocked.
   */
  isRfqUnlockedForVendor(vendorIdOrEmail, rfqIdOrNumber) {
    if (!vendorIdOrEmail || !rfqIdOrNumber) return false;
    const vendor = this.getVendorById(vendorIdOrEmail, 'all');
    if (!vendor) return false;
    const rfq = this.getRFQById(rfqIdOrNumber);

    // Direct buyer-mapped vendors always have access without lock
    if (rfq && this.isVendorMappedToRfqBuyer(vendor, rfq)) {
      return true;
    }

    const normRfqId = rfq ? String(rfq.id).toLowerCase() : String(rfqIdOrNumber).toLowerCase();
    const normRfqNum = rfq && rfq.rfqNumber ? String(rfq.rfqNumber).toLowerCase() : String(rfqIdOrNumber).toLowerCase();

    const unlockedList = Array.isArray(vendor.unlockedRfqIds) ? vendor.unlockedRfqIds : [];
    return unlockedList.some((id) => {
      const s = String(id).toLowerCase();
      return s === normRfqId || s === normRfqNum;
    });
  }

  /**
   * Atomically unlocks / downloads an RFQ for a vendor, consuming 1 credit if using free allowance.
   * Re-downloading an already-unlocked RFQ does NOT deduct another credit.
   */
  async unlockRFQForVendor(vendorIdOrEmail, rfqIdOrNumber, options = {}) {
    const vendor = this.getVendorById(vendorIdOrEmail, 'all');
    if (!vendor) {
      return {
        success: false,
        error: 'Vendor record not found.',
        notFound: true,
      };
    }

    const rfq = (await this.getRFQByIdAsync(rfqIdOrNumber)) || this.getRFQById(rfqIdOrNumber);
    if (!rfq) {
      return {
        success: false,
        error: `RFQ ${rfqIdOrNumber} not found.`,
        notFound: true,
      };
    }

    // Check if vendor has permission to access the RFQ
    if (!this.vendorCoversRFQ(vendor, rfq)) {
      return {
        success: false,
        error: 'You do not have permission to access this RFQ.',
        unauthorized: true,
      };
    }

    // Check if RFQ has already been unlocked for this vendor
    const isDirect = this.isVendorMappedToRfqBuyer(vendor, rfq);
    const unlockedList = Array.isArray(vendor.unlockedRfqIds) ? [...vendor.unlockedRfqIds] : [];
    const normRfqId = String(rfq.id);
    const normRfqNum = rfq.rfqNumber ? String(rfq.rfqNumber) : normRfqId;
    const isAlreadyUnlocked = unlockedList.includes(normRfqId) || unlockedList.includes(normRfqNum) || isDirect;

    const creditInfo = this.getVendorRfqCredits(vendor.id);

    if (isAlreadyUnlocked) {
      return {
        success: true,
        alreadyUnlocked: true,
        unlocked: true,
        freeCreditsRemaining: creditInfo.freeCreditsRemaining,
        creditCharged: 0,
        rfq,
        vendor,
      };
    }

    // Direct buyer-mapped or subscribed vendors do not consume free credits
    if (isDirect || creditInfo.isSubscribed) {
      if (!unlockedList.includes(normRfqId)) unlockedList.push(normRfqId);
      if (rfq.rfqNumber && !unlockedList.includes(normRfqNum)) unlockedList.push(normRfqNum);

      vendor.unlockedRfqIds = unlockedList;
      this.updateVendor(vendor.id, { unlockedRfqIds: unlockedList });
      await domainQueries.unlockRFQInDB({
        id: `unl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        vendorId: vendor.id,
        rfqId: rfq.id,
        creditCharged: 0,
        source: isDirect ? 'buyer_mapped' : 'subscription',
      });

      this.addAuditLog({
        userEmail: vendor.email || SYSTEM_ACTOR_EMAIL,
        action: `Vendor ${vendor.name || vendor.id} unlocked RFQ ${rfq.rfqNumber} (unlimited entitlement).`,
        rfqNumber: rfq.rfqNumber,
      });

      return {
        success: true,
        alreadyUnlocked: false,
        unlocked: true,
        freeCreditsRemaining: creditInfo.freeCreditsRemaining,
        creditCharged: 0,
        rfq,
        vendor,
      };
    }

    // Free allowance check
    if (creditInfo.freeCreditsRemaining <= 0) {
      this.addAuditLog({
        userEmail: vendor.email || SYSTEM_ACTOR_EMAIL,
        action: `Download rejected for Vendor ${vendor.name || vendor.id} on RFQ ${rfq.rfqNumber}: Free RFQ download credits exhausted (0 balance).`,
        rfqNumber: rfq.rfqNumber,
      });
      return {
        success: false,
        error: 'You have used all 5 free RFQ download credits. You cannot download another RFQ using your free allowance.',
        creditsExhausted: true,
        freeCreditsRemaining: 0,
      };
    }

    // Deduct 1 credit atomically and record unlock
    const newRemaining = Math.max(0, creditInfo.freeCreditsRemaining - 1);
    const newUsed = (creditInfo.freeCreditsUsed || 0) + 1;
    if (!unlockedList.includes(normRfqId)) unlockedList.push(normRfqId);
    if (rfq.rfqNumber && !unlockedList.includes(normRfqNum)) unlockedList.push(normRfqNum);

    vendor.freeQuotationCredits = newRemaining;
    vendor.freeRfqDownloadCredits = newRemaining;
    vendor.freeCreditsUsed = newUsed;
    vendor.unlockedRfqIds = unlockedList;

    this.updateVendor(vendor.id, {
      freeQuotationCredits: newRemaining,
      freeRfqDownloadCredits: newRemaining,
      freeCreditsUsed: newUsed,
      unlockedRfqIds: unlockedList,
    });

    const unlockRecordId = `unl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await domainQueries.unlockRFQInDB({
      id: unlockRecordId,
      vendorId: vendor.id,
      rfqId: rfq.id,
      creditCharged: 1,
      source: 'free_credit',
    });

    await domainQueries.recordCreditTransactionInDB({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      vendorId: vendor.id,
      rfqId: rfq.id,
      transactionType: 'RFQ_UNLOCK',
      amount: -1,
      balanceAfter: newRemaining,
      idempotencyKey: `tx-${vendor.id}-${rfq.id}`,
    });

    this.addAuditLog({
      userEmail: vendor.email || SYSTEM_ACTOR_EMAIL,
      action: `Vendor ${vendor.name || vendor.id} unlocked RFQ ${rfq.rfqNumber}. 1 credit consumed. Balance remaining: ${newRemaining}.`,
      rfqNumber: rfq.rfqNumber,
    });

    return {
      success: true,
      alreadyUnlocked: false,
      unlocked: true,
      freeCreditsRemaining: newRemaining,
      creditCharged: 1,
      rfq,
      vendor,
    };
  }

  /**
   * Deduct 1 quotation credit from a vendor after quotation submission on a new RFQ.
   * Resubmitting/updating a quote for the same RFQ does not consume an extra credit.
   * Buyer-mapped vendors quoting their respective buyer's RFQs do NOT consume free credits.
   * Subscribed vendors do not consume free credits below 0.
   */
  consumeVendorQuotationCredit(vendorId, rfqId) {
    const vendor = this.getVendorById(vendorId, 'all');
    if (!vendor) return null;

    const rfq = rfqId ? this.getRFQById(rfqId) : null;
    const isBuyerMapped = Boolean(rfq && this.isVendorMappedToRfqBuyer(vendor, rfq));

    const eligibility = this.checkVendorQuotationEligibility(vendor, rfq);
    const quotedRfqIds = Array.isArray(vendor.quotedRfqIds) ? [...vendor.quotedRfqIds] : [];
    const normalizedRfqId = rfqId ? String(rfqId).trim() : null;
    const alreadyQuoted = normalizedRfqId && quotedRfqIds.includes(normalizedRfqId);

    if (!alreadyQuoted && normalizedRfqId) {
      quotedRfqIds.push(normalizedRfqId);
    }

    // Also ensure RFQ is marked in unlockedRfqIds
    const unlockedList = Array.isArray(vendor.unlockedRfqIds) ? [...vendor.unlockedRfqIds] : [];
    if (normalizedRfqId && !unlockedList.includes(normalizedRfqId)) {
      unlockedList.push(normalizedRfqId);
    }
    if (rfq && rfq.rfqNumber && !unlockedList.includes(String(rfq.rfqNumber))) {
      unlockedList.push(String(rfq.rfqNumber));
    }

    let newCredits = eligibility.freeCreditsRemaining;
    // If the credit was not previously consumed during unlock, deduct it now
    if (!alreadyQuoted && !eligibility.isSubscribed && !isBuyerMapped) {
      newCredits = Math.max(0, eligibility.freeCreditsRemaining - 1);
    }

    vendor.freeQuotationCredits = newCredits;
    vendor.freeRfqDownloadCredits = newCredits;
    vendor.quotedRfqIds = quotedRfqIds;
    vendor.unlockedRfqIds = unlockedList;

    const updated = this.updateVendor(vendor.id, {
      freeQuotationCredits: newCredits,
      freeRfqDownloadCredits: newCredits,
      quotedRfqIds,
      unlockedRfqIds: unlockedList,
    });

    logger.info(
      `Quotation credit updated for vendor ${vendor.name || vendor.id}: remaining ${newCredits} (RFQ ${rfqId || 'N/A'}, subscribed: ${eligibility.isSubscribed}, buyerMapped: ${isBuyerMapped})`,
      { vendorId: vendor.id, freeQuotationCredits: newCredits, isSubscribed: eligibility.isSubscribed, isBuyerMapped },
      'STORE_SERVICE'
    );

    return updated;
  }


  // ==========================================
  // ZOHO PAYMENT LINKS
  // ==========================================

  /**
   * Look up a payment link by Zoho's own id — the identifier the webhook and
   * the reconciliation poller both key off.
   *
   * Falls back to Neon when the in-memory cache misses, rather than trusting
   * only whatever this process happened to hydrate at boot. This matters
   * concretely: the link may have been created by a *different* process
   * instance than the one now receiving Zoho's webhook (a redeploy, a
   * cold-started serverless/sleeping-dyno backend between checkout and the
   * webhook firing, or simply two instances behind a load balancer) — that
   * process's in-memory paymentLinks array never saw the link get created, so
   * a memory-only lookup here silently reports "unknown payment link" and the
   * subscription never activates, even though the row is sitting right there
   * in Neon. A DB hit is hydrated into the in-memory cache so the immediately
   * following updatePaymentLinkRecord/activate* calls (which are memory-only)
   * still work.
   */
  async getPaymentLinkByZohoId(zohoPaymentLinkId) {
    const cached = this.paymentLinks.find((l) => l.zohoPaymentLinkId === zohoPaymentLinkId);
    if (cached) return cached;
    if (!pool.hasStorage()) return null;
    const fromDB = await domainQueries.getPaymentLinkByZohoIdFromDB(zohoPaymentLinkId);
    if (!fromDB) return null;
    if (!this.paymentLinks.some((l) => l.id === fromDB.id)) {
      this.paymentLinks.unshift(fromDB);
    }
    return fromDB;
  }

  /**
   * Payment links still in a reconcilable status, re-synced from Neon first —
   * same cross-process reasoning as getPaymentLinkByZohoId: the reconciliation
   * poller runs in whichever process happens to be alive at the 10-minute
   * mark, which is not guaranteed to be the process that created the link.
   */
  async getPaymentLinksByStatusIn(statuses) {
    if (pool.hasStorage()) {
      const allFromDB = await domainQueries.getPaymentLinksFromDB();
      const byId = new Map(this.paymentLinks.map((l) => [l.id, l]));
      for (const link of allFromDB) {
        byId.set(link.id, link);
      }
      this.paymentLinks = Array.from(byId.values());
    }
    return this.paymentLinks.filter((l) => statuses.includes(l.status));
  }

  /**
   * A vendor's own billing history, newest first — re-synced from Neon first
   * for the same reason getPaymentLinksByStatusIn is: a link created by a
   * different process instance than the one now serving this request would
   * otherwise be invisible.
   */
  async getPaymentLinksForVendor(vendorId) {
    if (pool.hasStorage()) {
      const allFromDB = await domainQueries.getPaymentLinksFromDB();
      const byId = new Map(this.paymentLinks.map((l) => [l.id, l]));
      for (const link of allFromDB) byId.set(link.id, link);
      this.paymentLinks = Array.from(byId.values());
    }
    return this.paymentLinks
      .filter((l) => l.payerType === 'vendor' && l.vendorId === vendorId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** Same as getPaymentLinksForVendor, scoped to a buyer account instead. */
  async getPaymentLinksForBuyer(buyerAccountId) {
    if (pool.hasStorage()) {
      const allFromDB = await domainQueries.getPaymentLinksFromDB();
      const byId = new Map(this.paymentLinks.map((l) => [l.id, l]));
      for (const link of allFromDB) byId.set(link.id, link);
      this.paymentLinks = Array.from(byId.values());
    }
    return this.paymentLinks
      .filter((l) => l.payerType === 'buyer' && l.buyerAccountId === buyerAccountId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Look up a single payment link by its own (not Zoho's) id — used by the
   * invoice download route. Falls back to Neon on a memory miss, same
   * cross-process reasoning as getPaymentLinkByZohoId.
   */
  async getPaymentLinkById(id) {
    const cached = this.paymentLinks.find((l) => l.id === id);
    if (cached) return cached;
    if (!pool.hasStorage()) return null;
    const allFromDB = await domainQueries.getPaymentLinksFromDB();
    const fromDB = allFromDB.find((l) => l.id === id);
    if (!fromDB) return null;
    if (!this.paymentLinks.some((l) => l.id === fromDB.id)) {
      this.paymentLinks.unshift(fromDB);
    }
    return fromDB;
  }

  createPaymentLinkRecord({
    id,
    zohoPaymentLinkId,
    vendorId,
    buyerAccountId,
    payerType = 'vendor',
    planId,
    amount,
    paymentUrl,
    status,
    rawResponse,
  }) {
    const link = {
      id,
      zohoPaymentLinkId,
      vendorId: vendorId || null,
      buyerAccountId: buyerAccountId || null,
      payerType,
      planId,
      amount,
      paymentUrl,
      status,
      rawResponse: rawResponse || null,
      activated: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.paymentLinks.unshift(link);
    this._persistPaymentLink(link);
    return link;
  }

  updatePaymentLinkRecord(id, updates) {
    const idx = this.paymentLinks.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    const updated = { ...this.paymentLinks[idx], ...updates, updatedAt: new Date().toISOString() };
    this.paymentLinks[idx] = updated;
    this._persistPaymentLink(updated);
    return updated;
  }

  /**
   * Grant a vendor the plan they just paid for.
   *
   * Mirrors the reference app's PaymentLink activation: flips the vendor's
   * subscriptionPlan and resets their download quota. Idempotent — a link
   * already marked `activated` is a no-op, so both the webhook and the
   * reconciliation poller can safely call this for the same paid link without
   * double-granting.
   */
  activateVendorSubscriptionFromPayment(paymentLinkId) {
    const link = this.paymentLinks.find((l) => l.id === paymentLinkId);
    if (!link || link.activated) return null;

    const vendor = this.getVendorById(link.vendorId);
    if (!vendor) return null;

    this.updateVendor(vendor.id, { subscriptionPlan: link.planId, rfqDownloadsUsed: 0 });
    const updatedLink = this.updatePaymentLinkRecord(link.id, { activated: true });

    this.addAuditLog({
      userEmail: SYSTEM_ACTOR_EMAIL,
      action: `Activated ${link.planId} subscription for vendor ${vendor.name || vendor.email} via Zoho payment ${link.zohoPaymentLinkId}`,
    });

    return updatedLink;
  }

  /**
   * Grant a buyer the plan they just paid for.
   *
   * Mirrors activateVendorSubscriptionFromPayment. `remainingFreeRFQs` is only
   * reset for `free_trial` — the three paid tiers gate by sourcing mode, not a
   * numeric RFQ quota, so there is nothing to reset for them.
   */
  activateBuyerSubscriptionFromPayment(paymentLinkId) {
    const link = this.paymentLinks.find((l) => l.id === paymentLinkId);
    if (!link || link.activated) return null;

    const buyer = this.buyerAccounts.find((a) => a.id === link.buyerAccountId);
    if (!buyer) return null;

    const updates = { subscriptionPlan: link.planId };
    if (link.planId === 'free_trial') {
      updates.remainingFreeRFQs = 5;
    }
    this.updateBuyerAccount(buyer.id, updates);
    const updatedLink = this.updatePaymentLinkRecord(link.id, { activated: true });

    this.addAuditLog({
      userEmail: SYSTEM_ACTOR_EMAIL,
      action: `Activated ${link.planId} subscription for buyer ${buyer.organizationName || buyer.corporateEmail} via Zoho payment ${link.zohoPaymentLinkId}`,
    });

    return updatedLink;
  }

  reviseVendorRating(vendorId, ratingData, scopedBuyerId = null) {
    const vendor = this.getVendorById(vendorId, scopedBuyerId);
    if (!vendor) return null;

    // Nothing here is defaulted to an invented buyer. A revision is a record of
    // who rated whom, so an unattributed one is stored as unattributed (null)
    // rather than credited to a placeholder company and contact name.
    const { qualityScore, costScore, deliveryScore, remarks, buyerCompany, buyerName, buyerEmail } = ratingData;
    const { buyerAverage, newCompositeScore, newRating } = calculateRevisedRating({
      qualityScore: Number(qualityScore),
      costScore: Number(costScore),
      deliveryScore: Number(deliveryScore),
      previousScore: Number(vendor.score || 85),
    });

    const revisionRecord = {
      id: `rev-${Date.now()}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      buyerCompany: buyerCompany || null,
      buyerName: buyerName || null,
      buyerEmail: buyerEmail || null,
      timestamp: new Date().toISOString(),
      qualityScore,
      costScore,
      deliveryScore,
      buyerAverage,
      previousScore: vendor.score || 85,
      newCompositeScore,
      previousRating: vendor.rating || 4.5,
      newRating,
      remarks: remarks || 'Periodic Buyer Rating Assessment',
      emailDispatched: true,
      shaSignature: `sha256-${Date.now()}`,
    };

    const history = vendor.ratingRevisionHistory || [];
    history.unshift(revisionRecord);

    const updatedVendor = this.updateVendor(vendor.id, {
      score: newCompositeScore,
      rating: newRating,
      latestRatingRevision: revisionRecord,
      ratingRevisionHistory: history,
    });

    // Send rating revision email to the vendor
    if (vendor.email) {
      const emailPayload = mailerService.buildRatingRevisionEmail({
        to: vendor.email,
        recipientName: vendor.contactPerson || vendor.name,
        vendorName: vendor.name,
        buyerCompany: buyerCompany || 'A buyer on Procucev',
        buyerName: buyerName || '',
        previousRating: vendor.rating || 4.5,
        newRating: newRating,
        previousScore: vendor.score || 85,
        newScore: newCompositeScore,
        remarks: remarks || 'Periodic Buyer Rating Assessment',
        qualityScore,
        costScore,
        deliveryScore,
      });

      mailerService.sendVendorIngestionEmail(emailPayload, 'rating-revision')
        .then((delivery) => {
          if (delivery.sent) {
            logger.info(`Rating revision email sent to ${vendor.email}`, { vendorId: vendor.id }, 'STORE_SERVICE');
          } else {
            logger.warn(`Failed to send rating revision email to ${vendor.email}`, { reason: delivery.reason }, 'STORE_SERVICE');
          }
        })
        .catch((err) => {
          logger.error(`Error sending rating revision email to ${vendor.email}`, err, 'STORE_SERVICE');
        });
    }

    this.addAuditLog({
      userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
      action: `Revised vendor rating for ${vendor.name}: ${vendor.rating} -> ${newRating} (Score: ${newCompositeScore})`,
    });

    return { updatedVendor, revisionRecord };
  }

  // ==========================================
  // 3. RFQS
  // ==========================================
  /**
   * Checks all open RFQs that have reached 48 hours after release and officially closes them,
   * triggering final comparison evaluation email and SMS acknowledgment to the buyer.
   */
  checkAndClose48HourRFQs() {
    const now = Date.now();
    const fortyEightHoursMs = 48 * 60 * 60 * 1000;
    const closedList = [];

    for (let i = 0; i < this.rfqs.length; i++) {
      const rfq = this.rfqs[i];
      if (rfq && rfq.status !== 'Closed') {
        const createdMs = rfq.createdAt ? new Date(rfq.createdAt).getTime() : 0;
        if (createdMs > 0 && now - createdMs >= fortyEightHoursMs) {
          const updated = {
            ...rfq,
            status: 'Closed',
            closedAt: new Date(now).toISOString(),
            closedReason: 'Official closure 48 hours after release',
          };
          this.rfqs[i] = updated;
          this._persistRFQ(updated);
          this.notifyOfRFQClosure(updated);
          closedList.push(updated);
        }
      }
    }
    return closedList;
  }

  getRFQs() {
    this.checkAndClose48HourRFQs();
    return this.rfqs.map((r) => (r.quotes ? { ...r, quotes: evaluateQuotes(r.quotes) } : r));
  }

  /**
   * Re-sync RFQs from Neon PostgreSQL so records inserted by external processes
   * (e.g. check-email CLI, background workers) are merged into memory.
   */
  async syncRFQsFromDB() {
    if (!pool.hasStorage()) return this.getRFQs();
    try {
      const allFromDB = await domainQueries.getRFQsFromDB();
      if (Array.isArray(allFromDB)) {
        const byId = new Map(this.rfqs.map((r) => [r.id, r]));
        for (const rfq of allFromDB) {
          byId.set(rfq.id, rfq);
        }
        this.rfqs = Array.from(byId.values()).sort(
          (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
      }
    } catch (err) {
      logger.error('Failed to sync RFQs from database', err, 'STORE_SERVICE');
    }
    return this.getRFQs();
  }

  async getRFQByIdAsync(id) {
    let rfq = this.getRFQById(id);
    if (!rfq && pool.hasStorage()) {
      await this.syncRFQsFromDB();
      rfq = this.getRFQById(id);
    }
    return rfq;
  }

  getRFQById(id) {
    this.checkAndClose48HourRFQs();
    const rfq = this.rfqs.find((r) => r.id === id || r.rfqNumber === id);
    if (!rfq) return undefined;
    return rfq.quotes
      ? {
        ...rfq,
        quotes: evaluateQuotes(rfq.quotes),
      }
      : rfq;
  }

  /**
   * Generates a unique RFQ number matching p2pservices_v1_qua AutomaticRfqServiceImpl:
   * [Company prefix (3 letters uppercase, default 'RFQ')][yyddMM][6-digit suffix]
   * e.g., RFQ261109000123 (matching ^RFQ\\d{12}$)
   */
  generateRFQNumber(company = 'RFQ') {
    let companyLetters = 'RFQ';
    if (company && typeof company === 'string' && company.trim().length > 0) {
      const clean = company.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      companyLetters = clean.length >= 3 ? clean.substring(0, 3) : clean.padEnd(3, 'X');
    }

    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const datePart = `${yy}${dd}${mm}`;

    const existing = new Set(this.rfqs.map((r) => r.rfqNumber));
    let candidate;
    let attempts = 0;
    do {
      const suffix = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      candidate = `${companyLetters}${datePart}${suffix}`;
      attempts++;
    } while (existing.has(candidate) && attempts < 1000000);
    return candidate;
  }

  createRFQ(rfqData, requestingBuyerAccount = null) {
    const rfqNumber = rfqData.rfqNumber || this.generateRFQNumber();
    const id = rfqData.id || `rfq-${Date.now()}`;

    const newRFQ = {
      id,
      rfqNumber,
      title: rfqData.title || 'Untitled RFQ',
      // Not defaulted to a category the buyer never chose: 'Engineering Spares -
      // Mechanical' used to be substituted here, which silently mis-filed the RFQ
      // and routed it to the wrong vendor pool.
      category: rfqData.category || null,
      createdAt: rfqData.createdAt || new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      // No hardcoded fallback date. A fixed '2026-09-20' was previously stamped on
      // any RFQ that arrived without one, so an RFQ could show a deadline the
      deadline: rfqData.deadline || rfqData.targetDeliveryDate || rfqData.target_delivery_date || null,
      targetDeliveryDate: rfqData.targetDeliveryDate || rfqData.target_delivery_date || rfqData.deadline || null,
      // Budget was previously dropped here, so an RFQ saved through the API came
      // back from hydration with no budget at all: the portfolio value totalled
      // zero and the quote matrix crashed reading it. It is validated as a
      // required positive number by VALIDATION_SCHEMAS.createRFQ.
      budget: Number(rfqData.budget) || 0,
      // Vendors price freight against these, so they round-trip with the RFQ.
      deliveryLocation: rfqData.deliveryLocation || '',
      deliveryCity: rfqData.deliveryCity || '',
      deliveryState: rfqData.deliveryState || '',
      deliveryPincode: rfqData.deliveryPincode || '',
      // Metadata only. The bytes live in object storage under
      // rfqAttachmentService, so the bootstrap payload stays a fixed size no
      // matter how much is attached.
      attachments: Array.isArray(rfqData.attachments) ? rfqData.attachments : [],
      // Provenance. All four of these were previously dropped here — the field
      // list below simply did not mention them — so every stored RFQ came back
      // with a null `source` and a null `sourceFileName`. That mattered twice
      // over: the RFQ details screen had no way to say where a record came from,
      // and the ingestion wizard's own documented fallback for the uploaded
      // document ("recorded as sourceFileName instead") could never have worked,
      // because the value never reached the database.
      source: rfqData.source || null,
      sourceFileName: rfqData.sourceFileName || null,
      sourceEmail: rfqData.sourceEmail || null,
      raisedByEmail: requestingBuyerAccount ? requestingBuyerAccount.corporateEmail : rfqData.raisedByEmail || null,
      status: rfqData.status || 'Quotes Pending',
      // Stamped from the authenticated caller's own buyer account (resolved
      // by the controller/resolver from the session, never trusted from the
      // client body) so an RFQ is attributed to whoever actually created it.
      // Falls back to the legacy system-wide "active" buyer account only for
      // callers that don't have a per-request buyer identity to resolve
      // (e.g. historical-data ingestion, admin-driven creation).
      buyerAccountId: requestingBuyerAccount
        ? requestingBuyerAccount.id
        : this.activeBuyerAccount ? this.activeBuyerAccount.id : null,
      buyerAccountName: requestingBuyerAccount
        ? requestingBuyerAccount.organizationName
        : this.activeBuyerAccount ? this.activeBuyerAccount.organizationName : null,
      sourcingMode: rfqData.sourcingMode || (requestingBuyerAccount ? resolveBuyerSourcingMode(requestingBuyerAccount) : 'mode_1'),
      quotesCount: rfqData.quotes ? rfqData.quotes.length : 0,
      chasingActive: rfqData.chasingActive !== undefined ? rfqData.chasingActive : true,
      allocatedTime: rfqData.allocatedTime || RFQ_DEFAULTS.ALLOCATED_TIME,
      elapsedTime: rfqData.elapsedTime || RFQ_DEFAULTS.ELAPSED_TIME,
      // A savings target is a commitment the buyer sets, not a number the system
      // invents. '12-18%' was previously stamped on every RFQ regardless.
      targetSavings: rfqData.targetSavings || null,
      quotes: evaluateQuotes(rfqData.quotes || []),
      // Real line items the buyer's document extraction produced. Previously
      // only the legacy `lineItems` key was read here, so a real RFQ created
      // through the actual app flow (which sends `extractedEntities`, the
      // RFQItem field) silently lost every item on persistence — the buyer's
      // own optimistic client state showed them, but a refresh (re-hydrated
      // from this persisted shape) showed none, and PO generation
      // (approvePurchaseOrder, which reads rfq.extractedEntities) produced
      // an empty line-item PO for any RFQ created this way.
      extractedEntities: rfqData.extractedEntities || rfqData.lineItems || [],
      // AI-generated headline/scope/risk-notes built from the line items above,
      // before the RFQ is constructed here (see rfqController.createRFQ) — a
      // deterministic fallback when there's nothing to summarise or the model
      // call fails, never fabricated content.
      aiSummary: rfqData.aiSummary || null,
      assignedVendors: Array.isArray(rfqData.assignedVendors) ? rfqData.assignedVendors : [],
      // Counters start at zero and are driven up by real outreach. They used to be
      // seeded with a channel total of 3 and 3 messages already "delivered" on
      // every RFQ — including RFQs with no vendors assigned at all — so the
      // follow-up panel reported delivery for messages that were never sent.
      followUpData: rfqData.followUpData || {
        rfqNumber,
        totalInvited: (Array.isArray(rfqData.assignedVendors) ? rfqData.assignedVendors : []).length,
        respondedCount: 0,
        callStats: { total: 0, connected: 0, avgDuration: '0s' },
        whatsappStats: { total: 0, delivered: 0, read: 0, replied: 0 },
        smsStats: { total: 0, delivered: 0, clicked: 0 },
        autoChasingEnabled: true,
      },
    };

    // Verify each vendor in assignedVendors against the RFQ's category signals.
    // If a vendor does not match the category:
    // 1. Exclude the vendor from the RFQ vendor shortlist (assignedVendors).
    // 2. Dispatch an email to the vendor requesting them to update their category/business details.
    // 3. Record an audit log.
    const rfqCategorySignals = this._rfqCategorySignals(newRFQ);
    const buyerEmail = requestingBuyerAccount ? requestingBuyerAccount.corporateEmail : rfqData.raisedByEmail || null;
    if (rfqCategorySignals.length > 0 && Array.isArray(newRFQ.assignedVendors) && newRFQ.assignedVendors.length > 0) {
      const shortlisted = [];
      const mismatched = [];

      for (const v of newRFQ.assignedVendors) {
        const resolved = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
        const hasCategory = resolved.majorCategory || (Array.isArray(resolved.minorCategories) && resolved.minorCategories.length > 0);
        const isMatch = !hasCategory || rfqCategorySignals.some((sig) => this.vendorCoversCategory(resolved, sig));
        if (isMatch) {
          shortlisted.push(v);
        } else {
          mismatched.push(resolved);
        }
      }

      newRFQ.assignedVendors = shortlisted;
      if (newRFQ.followUpData) {
        newRFQ.followUpData.totalInvited = shortlisted.length;
        newRFQ.followUpData.vendors = shortlisted;
      }

      for (const vendor of mismatched) {
        this.addAuditLog({
          userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
          action: `Vendor ${vendor.name || vendor.id} excluded from automatic RFQ matching due to category mismatch.`,
          rfqNumber,
        });
      }
    }

    // Enterprise QUA – V0 (Free Starter Trial) Flow:
    // When buyer raises RFQ from V0 (mode_0), RFQ is sent ONLY to Procucev vendors.
    // Buyer-uploaded vendors are excluded from V0 RFQs.
    if (newRFQ.sourcingMode === 'mode_0' || newRFQ.sourcingMode === 'v0') {
      const MAX_V0_CATEGORY_INVITES = 100;
      // Filter existing assignedVendors to strictly Procucev vendors
      newRFQ.assignedVendors = (Array.isArray(newRFQ.assignedVendors) ? newRFQ.assignedVendors : []).filter((v) => {
        const resolved = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
        return this.isProcucevVendor(resolved);
      });

      const signals = this._rfqCategorySignals(newRFQ);
      if (signals.length > 0) {
        for (const v of this.vendors) {
          if (this.isProcucevVendor(v)) {
            const hasCategory = v.majorCategory || (Array.isArray(v.minorCategories) && v.minorCategories.length > 0);
            const isMatch = signals.some((sig) => this.vendorCoversCategory(v, sig));
            if (hasCategory && !isMatch) {
              this.addAuditLog({
                userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
                action: `Vendor ${v.name || v.id} excluded from automatic RFQ matching due to category mismatch.`,
                rfqNumber,
              });
            }
          }
        }
      }

      // Auto-populate category-matched Procucev verified vendors
      let procucevMatches = this.candidateVendorsForRFQ(newRFQ)
        .filter((v) => this.isProcucevVendor(v))
        .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));

      if (newRFQ.deliveryPincode) {
        const targetPincode = String(newRFQ.deliveryPincode).trim();
        const pinMatches = procucevMatches.filter(
          (v) => v.pincode && String(v.pincode).trim() === targetPincode
        );
        const pinNonMatches = procucevMatches.filter(
          (v) => !(v.pincode && String(v.pincode).trim() === targetPincode)
        );
        procucevMatches = [...pinMatches, ...pinNonMatches].slice(0, MAX_V0_CATEGORY_INVITES);
      } else {
        procucevMatches = procucevMatches.slice(0, MAX_V0_CATEGORY_INVITES);
      }

      const existingKeys = new Set(
        (newRFQ.assignedVendors || []).map((v) => (v.id || v.email || v.name || '').toLowerCase())
      );
      const additions = procucevMatches
        .filter((v) => !existingKeys.has((v.id || v.email || v.name || '').toLowerCase()))
        .map((v) => ({
          id: v.id,
          name: v.name,
          email: v.email || null,
          contactPerson: v.contactPerson || null,
          phone: v.phone || null,
          source: v.source || 'procucev_network',
        }));

      if (additions.length > 0) {
        newRFQ.assignedVendors = [...newRFQ.assignedVendors, ...additions];
      }
      if (newRFQ.followUpData) {
        newRFQ.followUpData.totalInvited = newRFQ.assignedVendors.length;
        newRFQ.followUpData.vendors = newRFQ.assignedVendors;
      }
    }

    // Category-based network-wide vendor invite — Version 2 (mode_2, "Hybrid
    // Sourcing Pool: Private Roster + AI Routing") ONLY. Every vendor whose
    // major/minor category matches this RFQ is merged into assignedVendors,
    // in addition to whatever the client already supplied. Reuses
    // candidateVendorsForRFQ (same category-match rule the CM's invite
    // picker uses) — this bypasses the invite-only requirement deliberately,
    // but only for mode_2, which is explicitly advertised to buyers as
    // hybrid. Version 1 (mode_1) is advertised as "🔒 Private Roster Only" /
    // "strictly dispatched to your private, pre-approved supplier network"
    // (see ingestion-wizard.tsx) — this used to also run for mode_1, quietly
    // pulling in network-wide vendors having nothing to do with the buyer's
    // own roster and breaking that explicit promise (confirmed live: a
    // vendor never added to a buyer's private roster received a mode_1 RFQ
    // meant to stay strictly private). mode_1 now only ever gets whatever
    // the client-supplied assignedVendors already contains (the buyer's own
    // roster, category-filtered on the frontend).
    if (newRFQ.sourcingMode === 'mode_2' || newRFQ.source === 'email_gateway') {
      // Capped: a bulk-imported category can match thousands of vendors (seen
      // live: 3000+ on a single RFQ, a 787KB payload) — embedding all of them
      // in assignedVendors on every future read of this RFQ is exactly the
      // "crashes the browser at scale" problem this codebase has already hit
      // and capped elsewhere (MAX_VENDOR_PAGE_SIZE, MAX_BOOTSTRAP_VENDORS).
      const MAX_CATEGORY_MATCHED_INVITES = 200;
      // Relevance (category match) decides who qualifies at all; rating
      // breaks ties within that pool. mode_2 additionally reorders the
      // qualified pool by delivery-pincode proximity before trimming to its
      // own smaller cap — pincode is a re-sort of who's already relevant,
      // never a replacement for relevance itself.
      let categoryMatches = this.candidateVendorsForRFQ(newRFQ).sort(
        (a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0)
      );

      if (newRFQ.deliveryPincode) {
        const MAX_MODE2_PINCODE_INVITES = 100;
        const targetPincode = String(newRFQ.deliveryPincode).trim();
        const pincodeMatches = categoryMatches.filter(
          (v) => v.pincode && String(v.pincode).trim() === targetPincode
        );
        const pincodeNonMatches = categoryMatches.filter(
          (v) => !(v.pincode && String(v.pincode).trim() === targetPincode)
        );
        // Pincode match ranked first (rating already sorted within each
        // group from the sort above); non-matches backfill any remaining
        // slots up to the cap so mode_2 never returns an under-filled list
        // when pincode coverage in that area is thin.
        categoryMatches = [...pincodeMatches, ...pincodeNonMatches].slice(0, MAX_MODE2_PINCODE_INVITES);
      } else {
        categoryMatches = categoryMatches.slice(0, MAX_CATEGORY_MATCHED_INVITES);
      }

      const existingKeys = new Set(
        (newRFQ.assignedVendors || []).map((v) => (v.id || v.email || v.name || '').toLowerCase())
      );
      const additions = categoryMatches
        .filter((v) => !existingKeys.has((v.id || v.email || v.name || '').toLowerCase()))
        .map((v) => ({
          id: v.id,
          name: v.name,
          email: v.email || null,
          contactPerson: v.contactPerson || null,
          phone: v.phone || null,
        }));
      if (additions.length > 0) {
        newRFQ.assignedVendors = [...newRFQ.assignedVendors, ...additions];
        newRFQ.followUpData.totalInvited = newRFQ.assignedVendors.length;
        newRFQ.followUpData.vendors = newRFQ.assignedVendors;
      }
    }

    this.rfqs.unshift(newRFQ);
    this._persistRFQ(newRFQ);

    this.addAuditLog({
      // Attributed to the buyer account the controller resolved from the session.
      userEmail: requestingBuyerAccount
        ? requestingBuyerAccount.corporateEmail
        : this.activeBuyerAccount ? this.activeBuyerAccount.corporateEmail : SYSTEM_ACTOR_EMAIL,
      action: `Created ${rfqNumber} (${newRFQ.title}) under Sourcing ${newRFQ.sourcingMode}`,
      rfqNumber,
    });

    // Simulate multi-channel outreach actions
    if (newRFQ.assignedVendors && newRFQ.assignedVendors.length > 0) {
      newRFQ.assignedVendors.forEach((v) => {
        const chaserLogs = simulateChaserOutreach(newRFQ, v);
        chaserLogs.forEach((log) => this.addAIFeedItem(log));
      });
    }

    // System event for RFQ creation
    this.addAIFeedItem(
      generateAIFeedItem({
        type: 'ingestion',
        title: `Autonomous Sourcing Engine Initialized: ${rfqNumber}`,
        message: `RFQ ${rfqNumber} created with ${(newRFQ.extractedEntities || []).length} line items. Multi-channel AI chasers dispatched across ${(newRFQ.assignedVendors || []).length} vendor(s).`,
        recipient: 'Procurement AI Orchestrator',
        rfqNumber,
        buyerAccountId: newRFQ.buyerAccountId,
      })
    );

    // In-app alert to every vendor whose category covers this RFQ, and an email
    // to the top matched vendors (same category, ranked by pincode + tier).
    this.notifyVendorsOfNewRFQ(newRFQ);
    this.emailRFQToMatchedVendors(newRFQ);

    // Timed multi-channel chaser sequence for every assigned vendor:
    //   • Within 5 minutes → SMS reminder
    //   • After 6 hours   → Call reminder (logic kept, telephony deferred)
    //   • After 12 hours  → WhatsApp reminder
    //   • After 24 hours  → Email reminder
    if (
      Array.isArray(newRFQ.assignedVendors) &&
      newRFQ.assignedVendors.length > 0
    ) {
      const resolvedVendors = newRFQ.assignedVendors.map((v) => {
        const full = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
        return {
          ...v,
          phone: full.phone || full.mobile || full.mobileNumber || v.phone,
          email: full.email || v.email,
          name: full.name || v.name,
          contactPerson: full.contactPerson || v.contactPerson,
        };
      });

      rfqChaserScheduler.scheduleRFQChasers(
        newRFQ,
        resolvedVendors,
        (vendor) => this.checkVendorQuotationEligibility(vendor)
      );
    }

    return newRFQ;
  }

  updateRFQ(id, updates) {
    const idx = this.rfqs.findIndex((r) => r.id === id || r.rfqNumber === id);
    if (idx === -1) return null;

    const oldStatus = this.rfqs[idx].status;
    let quotes = updates.quotes ? evaluateQuotes(updates.quotes) : this.rfqs[idx].quotes;

    const updated = {
      ...this.rfqs[idx],
      ...updates,
      quotes,
      quotesCount: quotes.length,
    };
    this.rfqs[idx] = updated;
    this._persistRFQ(updated);

    if (updates.status === 'Closed' && oldStatus !== 'Closed') {
      this.notifyOfRFQClosure(updated);
    } else if (
      (updates.status === 'AI Recommended' || updates.status === 'In Evaluation') &&
      oldStatus !== updates.status &&
      updated.quotesCount >= 1
    ) {
      this.notifyBuyerOfFinalComparison(updated);
    }

    return updated;
  }

  addQuoteToRFQ(rfqId, quote) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    // A resubmission from the same vendor replaces their previous quote on
    // this RFQ rather than piling up duplicates, preserving quotation integrity.
    const existingQuotes = rfq.quotes || [];
    const quotes = quote.vendorId
      ? [...existingQuotes.filter((q) => q.vendorId !== quote.vendorId), quote]
      : [...existingQuotes, quote];

    // Update followUpData telemetry if present
    let followUpData = rfq.followUpData;
    if (followUpData && Array.isArray(followUpData.vendors)) {
      const vIdx = followUpData.vendors.findIndex(
        (v) => v.vendorId === quote.vendorId || (quote.vendorName && v.vendorName === quote.vendorName)
      );
      if (vIdx !== -1) {
        const wasSubmitted = followUpData.vendors[vIdx].bidStatus === 'Submitted';
        followUpData.vendors[vIdx] = {
          ...followUpData.vendors[vIdx],
          bidStatus: 'Submitted',
          overallStatus: 'Responded',
          lastInteraction: quote.submittedAt || new Date().toISOString(),
        };
        if (!wasSubmitted) {
          followUpData.respondedCount = (followUpData.respondedCount || 0) + 1;
        }
      }
    }

    const isV0 =
      rfq.sourcingMode === 'mode_0' ||
      rfq.sourcingMode === 'v0' ||
      rfq.sourcingMode === 'version_0';

    rfq.quotes = quotes;
    rfq.quotesCount = quotes.length;

    const nextStatus = isV0 ? 'Quotes Received' : (rfq.status === 'PO Generated' ? 'PO Generated' : 'In Evaluation');

    // Requirement 1: Automatic RFQ Closure as soon as 100% of invited vendors submit valid quotes
    const assignedVendors = Array.isArray(rfq.assignedVendors) && rfq.assignedVendors.length > 0
      ? rfq.assignedVendors
      : (followUpData && Array.isArray(followUpData.vendors) ? followUpData.vendors : []);

    const allInvitedSubmitted =
      assignedVendors.length > 0 &&
      assignedVendors.every((av) => {
        if (!av) return false;
        const avId = av.id || av.vendorId;
        const avEmail = av.email;
        const avName = av.name || av.vendorName;
        return quotes.some((q) =>
          (avId && String(q.vendorId) === String(avId)) ||
          (avEmail && String(q.vendorEmail || '').toLowerCase() === String(avEmail).toLowerCase()) ||
          (avName && String(q.vendorName || '').trim().toLowerCase() === String(avName).trim().toLowerCase())
        );
      });

    let autoClosed = false;
    let finalStatus = nextStatus;

    if (allInvitedSubmitted && rfq.status !== 'Closed' && rfq.status !== 'PO Generated') {
      finalStatus = 'Closed';
      autoClosed = true;
      logger.info(
        `[AUTO_RFQ_CLOSURE] 100% of invited vendors (${assignedVendors.length}) submitted quotes for RFQ ${rfq.rfqNumber}. Closing RFQ immediately.`,
        { rfqNumber: rfq.rfqNumber, quotesCount: quotes.length, invitedCount: assignedVendors.length },
        'STORE_SERVICE'
      );
    }

    const updated = this.updateRFQ(rfq.id, {
      quotes,
      quotesCount: quotes.length,
      status: finalStatus,
      ...(autoClosed ? { quotesHidden: false, closedAt: new Date().toISOString(), autoClosedReason: 'All invited vendors submitted quotes' } : {}),
      followUpData,
    });

    if (autoClosed) {
      this.cancelDelayedQuoteTimers(rfq.id);
      this.notifyBuyerOfAutoClosureAndScheduleComparison(updated, quotes);
    } else {
      // Tell the RFQ's owning buyer a quote has landed — in-app and by email.
      this.notifyBuyerOfQuote(rfq, quote);
      this.emailQuoteToBuyer(rfq, quote);
    }

    return updated;
  }

  cancelDelayedQuoteTimers(rfqId) {
    if (!rfqId || !this._delayedQuoteTimers) return;
    const timers = this._delayedQuoteTimers.get(rfqId);
    if (Array.isArray(timers)) {
      timers.forEach((t) => clearTimeout(t));
      this._delayedQuoteTimers.delete(rfqId);
    }
  }

  notifyBuyerOfAutoClosureAndScheduleComparison(rfq, quotes) {
    if (!rfq) return;
    const buyerEmail = this.resolveBuyerEmailForRFQ(rfq);
    const buyer = (rfq.buyerAccountId && this.buyerAccounts.find((a) => a.id === rfq.buyerAccountId)) || {
      id: rfq.buyerAccountId || null,
      corporateEmail: buyerEmail,
      organizationName: rfq.buyerAccountName || rfq.buyerName || 'Buyer',
      phone: rfq.buyerPhone || null,
    };

    // 1. In-app notification for buyer
    if (rfq.buyerAccountId) {
      const notification = this._buildNotification({
        recipientType: 'buyer',
        recipientId: rfq.buyerAccountId,
        kind: 'rfq_auto_closed',
        rfq,
        title: `RFQ ${rfq.rfqNumber} Auto-Closed (100% Quotes Received)`,
        message: `All ${quotes.length} invited vendor(s) have submitted quotes for RFQ ${rfq.rfqNumber} — ${rfq.title}. RFQ is closed. Comparative evaluation will be ready in 5 minutes.`,
        meta: {
          quotesCount: quotes.length,
          autoClosed: true,
        },
      });
      this.notifications.unshift(notification);
      this._persistNotification(notification);
    }

    // 2. Immediate RFQ Auto-Closure Acknowledgement Email to buyer
    if (buyer.corporateEmail) {
      this._background(
        mailerService.sendRfqAutoClosureAcknowledgementEmail(buyer.corporateEmail, {
          rfq,
          quotesCount: quotes.length,
          recipientName: buyer.organizationName,
        }),
        'Failed to email auto-closure acknowledgement to buyer'
      );
    }

    // 3. Schedule 5-Minute Comparison-Ready Notification (Email + SMS)
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    const timer = setTimeout(() => {
      try {
        const freshRfq = this.getRFQById(rfq.id) || rfq;
        logger.info(
          `[AUTO_CLOSURE] 5-minute comparison delay complete for RFQ ${freshRfq.rfqNumber}. Dispatching final comparison email and SMS.`,
          { rfqNumber: freshRfq.rfqNumber, quotesCount: quotes.length, buyerEmail: buyer.corporateEmail },
          'STORE_SERVICE'
        );

        // Send comparison email
        if (buyer.corporateEmail) {
          this._background(
            mailerService.sendRfqFinalComparisonEmail(buyer.corporateEmail, {
              rfq: freshRfq,
              quotes,
              recipientName: buyer.organizationName,
            }),
            'Failed to dispatch 5-minute comparison email to buyer'
          );
        }

        // Send comparison SMS to buyer's phone
        const buyerPhone = buyer.phone || buyer.corporatePhone || freshRfq.buyerPhone;
        if (buyerPhone) {
          this._background(
            smsService.sendBuyerComparisonSms(buyerPhone, {
              rfqNumber: freshRfq.rfqNumber,
              quotesCount: quotes.length,
              buyerName: buyer.organizationName,
            }),
            'Failed to dispatch 5-minute comparison SMS to buyer'
          );
        }
      } catch (err) {
        logger.error(`Error in 5-minute comparison notification dispatch for ${rfq.rfqNumber}`, err, 'STORE_SERVICE');
      }
    }, FIVE_MINUTES_MS);

    if (timer && timer.unref) {
      timer.unref();
    }
  }

  addInquiryToRFQ(rfqId, inquiry) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    const existingInquiries = Array.isArray(rfq.inquiries) ? rfq.inquiries : [];
    const timestamp = inquiry.createdAt || new Date().toISOString();
    const vendorEmail = inquiry.vendorEmail || null;
    const vendorName = inquiry.vendorName || 'Vendor Partner';
    const vendorId = inquiry.vendorId || null;

    const chatMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderRole: 'vendor',
      senderName: vendorName,
      senderEmail: vendorEmail,
      message: inquiry.message || '',
      timestamp,
    };

    // Check if there is an existing thread for this vendor
    const existingIndex = existingInquiries.findIndex(
      (inq) =>
        (vendorId && inq.vendorId === vendorId) ||
        (vendorEmail && inq.vendorEmail && inq.vendorEmail.toLowerCase() === vendorEmail.toLowerCase()) ||
        (inq.vendorName && inq.vendorName.toLowerCase() === vendorName.toLowerCase())
    );

    let updatedInquiry;
    let inquiries;

    if (existingIndex !== -1) {
      const target = existingInquiries[existingIndex];
      const prevMsgs = Array.isArray(target.messages) && target.messages.length > 0
        ? target.messages
        : [
            {
              id: `msg-${target.id}-orig`,
              senderRole: 'vendor',
              senderName: target.vendorName,
              senderEmail: target.vendorEmail,
              message: target.message,
              timestamp: target.createdAt,
            },
            ...(target.reply
              ? [
                  {
                    id: `msg-${target.id}-reply`,
                    senderRole: 'buyer',
                    senderName: target.repliedBy || 'Procurement Team',
                    message: target.reply,
                    timestamp: target.repliedAt || target.createdAt,
                  },
                ]
              : []),
          ];

      updatedInquiry = {
        ...target,
        message: inquiry.message || target.message,
        createdAt: timestamp,
        status: 'open',
        messages: [...prevMsgs, chatMsg],
      };
      existingInquiries[existingIndex] = updatedInquiry;
      inquiries = existingInquiries;
    } else {
      updatedInquiry = {
        id: inquiry.id || `inq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        rfqNumber: rfq.rfqNumber,
        rfqId: rfq.id,
        vendorId,
        vendorName,
        vendorEmail,
        message: inquiry.message || '',
        createdAt: timestamp,
        status: 'open',
        messages: [chatMsg],
      };
      inquiries = [...existingInquiries, updatedInquiry];
    }

    rfq.inquiries = inquiries;
    const updated = this.updateRFQ(rfq.id, { inquiries });

    this.addFeedItem({
      type: 'system',
      channel: 'email',
      title: `Vendor Clarification on ${rfq.rfqNumber}`,
      message: `${vendorName} asked: "${inquiry.message.slice(0, 120)}"`,
      recipient: rfq.raisedByEmail || rfq.buyerAccountName,
      rfqNumber: rfq.rfqNumber,
    });

    this.addAuditLog({
      action: `Inquiry / Clarification submitted by ${vendorName} on ${rfq.rfqNumber}: "${inquiry.message.slice(0, 100)}"`,
      rfqNumber: rfq.rfqNumber,
      userEmail: vendorEmail || 'system@procucev.ai',
    });

    // Notify buyer
    if (rfq.buyerAccountId) {
      this.notifyBuyerOfInquiry(rfq, updatedInquiry);
    }

    return { updatedRfq: updated, inquiry: updatedInquiry };
  }

  replyToRFQInquiry(rfqId, inquiryId, replyData) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    const existingInquiries = Array.isArray(rfq.inquiries) ? rfq.inquiries : [];
    const inqIndex = existingInquiries.findIndex((i) => i.id === inquiryId);
    if (inqIndex === -1) return null;

    const target = existingInquiries[inqIndex];
    const timestamp = new Date().toISOString();
    const repliedBy = replyData.repliedBy || 'Procurement Officer';

    const prevMsgs = Array.isArray(target.messages) && target.messages.length > 0
      ? target.messages
      : [
          {
            id: `msg-${target.id}-orig`,
            senderRole: 'vendor',
            senderName: target.vendorName,
            senderEmail: target.vendorEmail,
            message: target.message,
            timestamp: target.createdAt,
          },
          ...(target.reply
            ? [
                {
                  id: `msg-${target.id}-reply`,
                  senderRole: 'buyer',
                  senderName: target.repliedBy || 'Procurement Team',
                  message: target.reply,
                  timestamp: target.repliedAt || target.createdAt,
                },
              ]
            : []),
        ];

    const replyMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderRole: 'buyer',
      senderName: repliedBy,
      message: replyData.reply || '',
      timestamp,
    };

    const updatedInquiry = {
      ...target,
      reply: replyData.reply || '',
      repliedAt: timestamp,
      repliedBy,
      status: 'answered',
      messages: [...prevMsgs, replyMsg],
    };

    existingInquiries[inqIndex] = updatedInquiry;
    rfq.inquiries = existingInquiries;
    const updated = this.updateRFQ(rfq.id, { inquiries: existingInquiries });

    this.addFeedItem({
      type: 'system',
      channel: 'email',
      title: `Clarification Answered on ${rfq.rfqNumber}`,
      message: `Buyer replied to ${updatedInquiry.vendorName}: "${(replyData.reply || '').slice(0, 120)}"`,
      recipient: updatedInquiry.vendorEmail || updatedInquiry.vendorName,
      rfqNumber: rfq.rfqNumber,
    });

    this.addAuditLog({
      action: `Buyer replied to vendor inquiry on ${rfq.rfqNumber} for ${updatedInquiry.vendorName}: "${(replyData.reply || '').slice(0, 100)}"`,
      rfqNumber: rfq.rfqNumber,
      userEmail: replyData.repliedByEmail || 'system@procucev.ai',
    });

    return { updatedRfq: updated, inquiry: updatedInquiry };
  }

  deleteRFQ(id) {
    const beforeLen = this.rfqs.length;
    this.rfqs = this.rfqs.filter((r) => r.id !== id && r.rfqNumber !== id);
    const removed = this.rfqs.length < beforeLen;
    if (removed) {
      this._removeRFQ(id);
      if (this._delayedQuoteTimers && this._delayedQuoteTimers.has(id)) {
        const handles = this._delayedQuoteTimers.get(id) || [];
        handles.forEach((h) => clearTimeout(h));
        this._delayedQuoteTimers.delete(id);
      }
    }
    return removed;
  }

  // getRFQSummary was removed with the RFQ seeds. The portfolio roll-up now
  // lives in rfqSummaryService.buildPortfolioSummary, which is handed one
  // organisation's rows rather than reducing over a single global array, and
  // which no longer invents follow-up channel statistics.

  // ==========================================
  // 3b. NOTIFICATIONS
  // ==========================================
  // In-app alerts, persisted to Neon like every other domain collection. Two
  // producers today: a category-matched RFQ fan-out to vendors (createRFQ) and
  // a "quote received" alert to the RFQ's owning buyer (addQuoteToRFQ). Reads
  // are always scoped to one recipient — the controller resolves the caller's
  // vendor row or buyer account from the session and passes its id here.

  /** Every notification addressed to one recipient, newest first. */
  getNotificationsFor(recipientType, recipientId) {
    if (!recipientId) return [];
    return this.notifications.filter(
      (n) => n.recipientType === recipientType && n.recipientId === recipientId
    );
  }

  /** Count of that recipient's unread notifications. */
  getUnreadNotificationCountFor(recipientType, recipientId) {
    return this.getNotificationsFor(recipientType, recipientId).filter((n) => !n.read).length;
  }

  // Both producers pass a real RFQ and a meta object; keep it that way so this
  // has no defensive branches to leave uncovered.
  _buildNotification({ recipientType, recipientId, kind, rfq, title, message, meta }) {
    return {
      id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      recipientType,
      recipientId,
      kind,
      rfqId: rfq ? rfq.id : (meta && meta.rfqId) || null,
      rfqNumber: rfq ? rfq.rfqNumber : (meta && meta.rfqNumber) || null,
      title,
      message,
      meta,
      read: false,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Mark one notification read, but only if it belongs to the caller — a
   * recipient must not be able to flip another recipient's notification by id.
   * Returns the updated notification, or null when it is not theirs / not found.
   */
  markNotificationRead(id, recipientType, recipientId) {
    const notification = this.notifications.find(
      (n) => n.id === id && n.recipientType === recipientType && n.recipientId === recipientId
    );
    if (!notification) return null;
    if (!notification.read) {
      notification.read = true;
      this._background(domainQueries.markNotificationReadInDB(id), 'Failed to persist notification read');
    }
    return notification;
  }

  /** Mark all of one recipient's notifications read. Returns how many changed. */
  markAllNotificationsRead(recipientType, recipientId) {
    let changed = 0;
    for (const n of this.notifications) {
      if (n.recipientType === recipientType && n.recipientId === recipientId && !n.read) {
        n.read = true;
        changed += 1;
      }
    }
    if (changed > 0) {
      this._background(
        domainQueries.markAllNotificationsReadInDB(recipientType, recipientId),
        'Failed to persist bulk notification read'
      );
    }
    return changed;
  }

  isBuyerUploaded(vendor) {
    if (!vendor) return false;
    if (vendor.addedByBuyerCompany || vendor.buyerAccountId || vendor.buyerId) return true;
    const s = String(vendor.source || '').toLowerCase().trim();
    const id = String(vendor.id || '').toLowerCase().trim();
    return Boolean(
      s === 'buyer_uploaded' ||
      s === 'vendor_master_ingestion' ||
      s === 'historical_purchase_dump' ||
      s === 'buyer_manual' ||
      s === 'buyer_excel' ||
      s === 'excel_upload' ||
      s === 'po_ingestion' ||
      s === 'client_uploaded' ||
      s === 'buyer' ||
      s.includes('buyer') ||
      s.includes('ingestion') ||
      s.includes('purchase_dump') ||
      id.startsWith('v-hist-') ||
      id.startsWith('vm-') ||
      id.startsWith('v-ingest-') ||
      id.startsWith('v-buyer-')
    );
  }

  isProcucevVendor(vendor) {
    if (!vendor) return false;
    return !this.isBuyerUploaded(vendor);
  }

  /**
   * Whether a vendor covers an RFQ's category.
   *
   * The RFQ carries one `category` string (major or minor). A vendor covers it
   * when it equals their `majorCategory` or appears in `minorCategories` /
   * `vendorSelectedCategories` / `clientMappedCategories`. Compared
   * case-insensitively and trimmed, because the taxonomy master and the vendor
   * upload sheets disagree on casing.
   */
  vendorCoversCategory(vendor, category) {
    if (!category) return false;
    const target = String(category).trim().toLowerCase();
    if (!target) return false;
    const pools = [
      vendor.majorCategory,
      ...(Array.isArray(vendor.minorCategories) ? vendor.minorCategories : []),
      ...(Array.isArray(vendor.vendorSelectedCategories) ? vendor.vendorSelectedCategories : []),
      ...(Array.isArray(vendor.clientMappedCategories) ? vendor.clientMappedCategories : []),
    ];
    return pools.some((c) => String(c || '').trim().toLowerCase() === target);
  }

  /**
   * Every category string an RFQ carries — its own `category` plus each
   * confirmed line item's major/minor/category. An RFQ raised from a BOQ often
   * only tags the line items, not the RFQ header, so matching on the header
   * alone would route nothing.
   */
  _rfqCategorySignals(rfq) {
    const signals = [];
    if (rfq.category) signals.push(rfq.category);
    for (const ent of Array.isArray(rfq.extractedEntities) ? rfq.extractedEntities : []) {
      if (ent.majorCategory) signals.push(ent.majorCategory);
      if (ent.minorCategory) signals.push(ent.minorCategory);
      if (ent.category) signals.push(ent.category);
    }
    return signals;
  }

  /**
   * Whether a vendor was uploaded privately by a buyer (via Excel, PO ingestion, ERP dump, or buyer roster).
   */
  isBuyerUploaded(vendor) {
    if (!vendor) return false;
    const src = String(vendor.source || '').toLowerCase();
    const buyerKeywords = [
      'buyer',
      'client',
      'excel',
      'po_ingestion',
      'ingestion',
      'dump',
      'historical',
      'manual',
      'erp',
      'upload',
      'vendor_master',
      'raw_ingestion',
    ];
    if (src && buyerKeywords.some((k) => src.includes(k))) {
      return true;
    }
    if (vendor.buyerId || vendor.buyerAccountId || vendor.addedByBuyerCompany) return true;
    const vid = String(vendor.id || '');
    if (vid.startsWith('v-hist-') || vid.startsWith('vm-') || vid.startsWith('v-ingest-') || vid.startsWith('v-buyer-')) {
      return true;
    }
    return false;
  }

  /**
   * Whether a vendor belongs to the Procucev Network vendor pool (mode_0 / V0).
   * Private buyer-uploaded vendors (having buyerId, buyerAccountId, or addedByBuyerCompany)
   * are excluded from the public Procucev Network pool.
   */
  isProcucevVendor(vendor) {
    if (!vendor) return false;
    if (this.isBuyerUploaded(vendor)) return false;
    return true;
  }

  /**
   * Whether an RFQ should reach a given vendor.
   *
   * True when the vendor was explicitly added by the RFQ's buyer
   * (`addedByBuyerCompany`) or is on the RFQ's `assignedVendors` invite list —
   * that's it. Category coverage alone is deliberately NOT enough: it used to
   * grant access directly, but a category manager now has to review the
   * category-matched pool (`candidateVendorsForRFQ`) and explicitly invite
   * from it (`inviteVendorsToRFQ`) before a vendor can see, be notified about,
   * be emailed about, or quote an RFQ.
   */
  vendorCoversRFQ(vendor, rfq) {
    if (!vendor || !rfq) return false;

    // Enterprise QUA – V0 Flow: When RFQ is raised from V0 (mode_0), it reaches ONLY Procucev vendors.
    if (rfq.sourcingMode === 'mode_0' || rfq.sourcingMode === 'v0') {
      if (!this.isProcucevVendor(vendor)) {
        return false;
      }
      const signals = this._rfqCategorySignals(rfq);
      if (signals.length > 0 && signals.some((c) => this.vendorCoversCategory(vendor, c))) {
        return true;
      }
      return this._isInvitedVendor(vendor, rfq);
    }

    // Same-buyer-company match alone used to grant a private-roster vendor
    // blanket access to every RFQ that buyer ever creates, regardless of
    // whether the vendor's own category has anything to do with the RFQ —
    // a Version 1 (Mode 1) RFQ for one category was reaching every vendor
    // the buyer had ever uploaded, not just the ones actually relevant to
    // it. Now also requires the vendor's own category to cover the RFQ,
    // same rule candidateVendorsForRFQ/vendorCoversCategory already apply
    // to the network-wide invite pool — a private roster relationship
    // grants eligibility, it never bypasses relevance.
    // Buyer-specific vendor access rule:
    // When a buyer uploads or adds a vendor to their vendor list, that vendor can view
    // RFQs created by that respective buyer.
    if (this.isVendorMappedToRfqBuyer(vendor, rfq)) {
      const signals = this._rfqCategorySignals(rfq);
      if (signals.length === 0 || !vendor.majorCategory || signals.some((c) => this.vendorCoversCategory(vendor, c))) {
        return true;
      }
      return this._isInvitedVendor(vendor, rfq);
    }

    if (
      vendor.addedByBuyerCompany &&
      rfq.buyerAccountName &&
      vendor.addedByBuyerCompany.trim().toLowerCase() === rfq.buyerAccountName.trim().toLowerCase()
    ) {
      const signals = this._rfqCategorySignals(rfq);
      if (signals.some((c) => this.vendorCoversCategory(vendor, c))) {
        return true;
      }
    }

    return this._isInvitedVendor(vendor, rfq);
  }

  /** Whether a vendor is on the RFQ's assignedVendors invite list. */
  _isInvitedVendor(vendor, rfq) {
    const invited = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    return invited.some(
      (v) =>
        v &&
        ((v.id && v.id === vendor.id) ||
          (v.email && vendor.email && v.email.toLowerCase() === vendor.email.toLowerCase()) ||
          (v.name && vendor.name && v.name.toLowerCase() === vendor.name.toLowerCase()))
    );
  }

  /**
   * Every vendor whose category covers this RFQ — the candidate pool a
   * category manager picks invitees from. Grants no access by itself; only
   * `inviteVendorsToRFQ` (via `assignedVendors`) does that. Flags which
   * candidates are already invited so a picker UI can show that state.
   */
  candidateVendorsForRFQ(rfq) {
    const signals = this._rfqCategorySignals(rfq);
    return this.vendors
      .filter((v) => signals.some((c) => this.vendorCoversCategory(v, c)))
      .map((v) => ({ ...v, alreadyInvited: this._isInvitedVendor(v, rfq) }));
  }

  /**
   * A category manager invites specific vendors to an RFQ.
   *
   * Merges the given vendor ids into `assignedVendors` (dedup'd against
   * whoever's already on it), then — for each vendor newly added — fires the
   * same simulated multi-channel chaser outreach `createRFQ` fires fo  /**
   * Inviting specific vendors to an RFQ (Category Manager manual assignment or override).
   *
   * Only invited vendors (plus any direct buyer roster matches) can see, be
   * notified about, or quote this RFQ afterward.
   *
   * Category Manager manual assignments allow manual override even if category
   * does not automatically match, logging the override and sending normal RFQ
   * invitation emails. Category mismatch emails are disabled.
   */
  async inviteVendorsToRFQ(rfqId, vendorIds, actorEmail) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    const existing = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    const newlyInvited = [];
    const overrideVendors = [];
    const signals = this._rfqCategorySignals(rfq);

    for (const id of Array.isArray(vendorIds) ? vendorIds : []) {
      let vendor = this.getVendorById(id);
      if (!vendor) {
        vendor = await domainQueries.getVendorByIdFromDB(id);
        if (vendor && !this.vendors.some((v) => v.id === vendor.id)) {
          this.vendors.push(vendor);
        }
      }
      if (!vendor) continue;
      if (this._isInvitedVendor(vendor, rfq)) continue;

      const hasCategory = vendor.majorCategory || (Array.isArray(vendor.minorCategories) && vendor.minorCategories.length > 0);
      const isMatch = signals.length === 0 || !hasCategory || signals.some((c) => this.vendorCoversCategory(vendor, c));

      if (!isMatch) {
        overrideVendors.push(vendor);
      }

      newlyInvited.push(vendor);
    }

    if (newlyInvited.length === 0) {
      return { updatedRFQ: rfq, invitedCount: 0 };
    }

    const entries = newlyInvited.map((v) => ({
      id: v.id,
      name: v.name,
      email: v.email || null,
      contactPerson: v.contactPerson || null,
      phone: v.phone || v.mobile || v.mobileNumber || null,
    }));
    const updatedRFQ = this.updateRFQ(rfq.id, { assignedVendors: [...existing, ...entries] });

    for (const vendor of newlyInvited) {
      const isOverride = overrideVendors.some((ov) => ov.id === vendor.id);
      this.addAuditLog({
        userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
        action: isOverride
          ? `Category Manager manual override: Vendor ${vendor.name} (${vendor.id}) invited to RFQ ${rfq.rfqNumber}`
          : `Category Manager manual assignment: Vendor ${vendor.name} (${vendor.id}) invited to RFQ ${rfq.rfqNumber}`,
        rfqNumber: rfq.rfqNumber,
      });

      // Simulated multi-channel chaser outreach
      const chaserLogs = simulateChaserOutreach(updatedRFQ, vendor);
      chaserLogs.forEach((log) => this.addAIFeedItem(log));

      // Real in-app notification
      const categoryLabel = updatedRFQ.category || this._rfqCategorySignals(updatedRFQ)[0] || 'your categories';
      const notification = this._buildNotification({
        recipientType: 'vendor',
        recipientId: vendor.id,
        kind: 'rfq_category_match',
        rfq: updatedRFQ,
        title: `New RFQ in ${categoryLabel}`,
        message: `${updatedRFQ.buyerAccountName || 'A buyer'} invited you to ${updatedRFQ.rfqNumber} — ${updatedRFQ.title}.`,
        meta: { category: categoryLabel, buyerAccountName: updatedRFQ.buyerAccountName || null },
      });
      this.notifications.unshift(notification);
      this._persistNotification(notification);

      // Real invite email
      if (vendor.email) {
        const buyerEmail = this.resolveBuyerEmailForRFQ(updatedRFQ);
        const creditInfo = this.checkVendorQuotationEligibility(vendor);
        logger.info(
          `Checking quotation credits for invited vendor ${vendor.name || vendor.email}: ${creditInfo.freeCreditsRemaining} free credits, subscribed: ${creditInfo.isSubscribed}`,
          { vendorId: vendor.id, freeCreditsRemaining: creditInfo.freeCreditsRemaining, isSubscribed: creditInfo.isSubscribed },
          'STORE_SERVICE'
        );
        this._background(
          mailerService.sendRfqInviteEmail(vendor.email, {
            rfq: updatedRFQ,
            recipientName: vendor.contactPerson || vendor.name,
            buyerEmail,
            cc: buyerEmail || undefined,
            freeCreditsRemaining: creditInfo.freeCreditsRemaining,
            isSubscribed: creditInfo.isSubscribed,
          }),
          'Failed to email RFQ invite to vendor'
        );
      }
    }

    this.addAuditLog({
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Invited ${newlyInvited.length} vendor(s) to ${rfq.rfqNumber}`,
      rfqNumber: rfq.rfqNumber,
    });

    return {
      updatedRFQ,
      invitedCount: newlyInvited.length,
      overrideCount: overrideVendors.length,
    };
  }

  /**
   * Validates vendor candidates against RFQ category signals.
   * Shortlists vendors matching the category, and excludes mismatched vendors
   * without sending mismatch emails.
   */
  validateAndShortlistVendors(rfq, vendorList, buyerEmail) {
    if (!rfq || !Array.isArray(vendorList)) return { shortlisted: [], excluded: [] };
    const signals = this._rfqCategorySignals(rfq);
    const shortlisted = [];
    const excluded = [];

    for (const v of vendorList) {
      const vendorRecord = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
      const hasCategory = vendorRecord.majorCategory || (Array.isArray(vendorRecord.minorCategories) && vendorRecord.minorCategories.length > 0);
      const isMatch = signals.length === 0 || !hasCategory || signals.some((sig) => this.vendorCoversCategory(vendorRecord, sig));

      if (isMatch) {
        shortlisted.push(v);
      } else {
        excluded.push(vendorRecord);
      }
    }

    for (const vendor of excluded) {
      this.addAuditLog({
        userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
        action: `Vendor ${vendor.name || vendor.id} excluded from automatic RFQ matching due to category mismatch.`,
        rfqNumber: rfq.rfqNumber,
      });
    }

    return { shortlisted, excluded };
  }

  /** The RFQs one vendor may see, in the store's current (newest-first) order. */
  getRFQsForVendor(vendorIdOrEmail) {
    const vendor = this.getVendorById(vendorIdOrEmail);
    if (!vendor) return [];
    return this.rfqs.filter((rfq) => this.vendorCoversRFQ(vendor, rfq));
  }

  /**
   * Raise a notification for every vendor an RFQ should reach.
   *
   * Fired from createRFQ. Uses the exact same `vendorCoversRFQ` rule the
   * opportunity feed and RFQ reads are scoped by, so a vendor is notified about
   * precisely the RFQs they can actually see. The whole fan-out is one batched
   * insert.
   */
  notifyVendorsOfNewRFQ(rfq) {
    const matches = this.vendors.filter((v) => this.vendorCoversRFQ(v, rfq));
    if (matches.length === 0) return [];

    const categoryLabel = rfq.category || this._rfqCategorySignals(rfq)[0] || 'your categories';

    const created = matches.map((vendor) =>
      this._buildNotification({
        recipientType: 'vendor',
        recipientId: vendor.id,
        kind: 'rfq_category_match',
        rfq,
        title: `New RFQ in ${categoryLabel}`,
        message: `${rfq.buyerAccountName || 'A buyer'} raised ${rfq.rfqNumber} — ${rfq.title}.`,
        meta: { category: categoryLabel, buyerAccountName: rfq.buyerAccountName || null },
      })
    );

    this.notifications.unshift(...created);
    this._persistNotificationBatch(created);
    return created;
  }

  /**
   * Tell an RFQ's owning buyer that a vendor has quoted.
   *
   * Fired from addQuoteToRFQ. The buyer is resolved from the RFQ's
   * `buyerAccountId` (the Neon buyer-account id stamped at creation), so a
   * quote against an RFQ with no owner attributed raises nothing.
   */
  notifyBuyerOfQuote(rfq, quote) {
    // Only reached from addQuoteToRFQ, which has already resolved a real RFQ and
    // built the quote — the one thing that can be missing is an owning buyer.
    if (!rfq.buyerAccountId) return null;
    const isHidden = this.isPortalRFQ(rfq) && this.isWithin48HourWindow(rfq);

    const notification = this._buildNotification({
      recipientType: 'buyer',
      recipientId: rfq.buyerAccountId,
      kind: 'quote_received',
      rfq,
      title: isHidden ? `New quote on ${rfq.rfqNumber} (Sealed)` : `New quote on ${rfq.rfqNumber}`,
      message: isHidden
        ? `${quote.vendorName || 'A vendor'} submitted a quotation on ${rfq.rfqNumber} — ${rfq.title}. (Commercial bid details sealed under 48-hour bidding integrity rule).`
        : `${quote.vendorName || 'A vendor'} submitted a quote on ${rfq.rfqNumber} — ${rfq.title}.`,
      meta: {
        vendorId: quote.vendorId || null,
        vendorName: quote.vendorName || null,
        totalPrice: quote.totalPrice,
        bidSealed: isHidden,
      },
    });
    this.notifications.unshift(notification);
    this._persistNotification(notification);
    return notification;
  }

  notifyBuyerOfInquiry(rfq, inquiry) {
    if (!rfq.buyerAccountId) return null;
    const notification = this._buildNotification({
      recipientType: 'buyer',
      recipientId: rfq.buyerAccountId,
      kind: 'vendor_inquiry',
      rfq,
      title: `New vendor clarification on ${rfq.rfqNumber}`,
      message: `${inquiry.vendorName || 'A vendor'} submitted a question on ${rfq.rfqNumber}: "${(inquiry.message || '').slice(0, 100)}"`,
      meta: {
        inquiryId: inquiry.id,
        vendorName: inquiry.vendorName,
        vendorEmail: inquiry.vendorEmail,
      },
    });
    this.notifications.unshift(notification);
    this._persistNotification(notification);
    return notification;
  }

  notifyBuyer(emailOrId, { kind, title, message, meta } = {}) {
    if (!emailOrId) return null;
    let buyerAccount = this.buyerAccounts.find(
      (a) => a.id === emailOrId || (a.corporateEmail && a.corporateEmail.toLowerCase() === String(emailOrId).toLowerCase())
    );
    const recipientId = buyerAccount ? buyerAccount.id : emailOrId;
    const notification = this._buildNotification({
      recipientType: 'buyer',
      recipientId,
      kind: kind || 'system_alert',
      title: title || 'System Update',
      message: message || '',
      meta: meta || {},
    });
    this.notifications.unshift(notification);
    this._persistNotification(notification);
    return notification;
  }

  notifyBuyerOfFinalComparison(rfq) {
    if (!rfq || !rfq.buyerAccountId) return null;

    const isPortal = this.isPortalRFQ(rfq);
    const in48hWindow = this.isWithin48HourWindow(rfq);

    // During the 48-hour bidding integrity window on portal RFQs, commercial comparisons
    // must NOT be emailed to the buyer.
    if (isPortal && in48hWindow) {
      logger.info(
        `[48H_BID_RULE] Portal RFQ ${rfq.rfqNumber}: suppressed final comparison email to buyer during 48-hour sealed window.`,
        { rfqNumber: rfq.rfqNumber },
        'STORE_SERVICE'
      );
      return null;
    }

    const notification = this._buildNotification({
      recipientType: 'buyer',
      recipientId: rfq.buyerAccountId,
      kind: 'rfq_final_comparison',
      rfq,
      title: `Final Evaluation Matrix Ready: ${rfq.rfqNumber}`,
      message: `Quotation comparison & AI scoring matrix is ready for ${rfq.rfqNumber} (${rfq.quotesCount || 0} quotes received).`,
      meta: {
        rfqNumber: rfq.rfqNumber,
        quotesCount: rfq.quotesCount || 0,
      },
    });
    this.notifications.unshift(notification);
    this._persistNotification(notification);

    // Dispatches final comparison email to the buyer
    const buyerEmail = this.resolveBuyerEmailForRFQ(rfq);
    if (buyerEmail) {
      mailerService
        .sendRfqFinalComparisonEmail(buyerEmail, {
          rfq,
          quotes: rfq.quotes || [],
          recipientName: rfq.buyerAccountName || rfq.buyerName,
        })
        .catch((err) => logger.error(`Failed to send RFQ final comparison email for ${rfq.rfqNumber}`, err, 'STORE_SERVICE'));
    }

    return notification;
  }

  notifyOfRFQClosure(rfq) {
    if (rfq.buyerAccountId) {
      const buyerNotif = this._buildNotification({
        recipientType: 'buyer',
        recipientId: rfq.buyerAccountId,
        kind: 'rfq_closed',
        rfq,
        title: `RFQ Closed: ${rfq.rfqNumber}`,
        message: `Sourcing requisition ${rfq.rfqNumber} (${rfq.title}) has been officially closed.`,
        meta: { rfqNumber: rfq.rfqNumber },
      });
      this.notifications.unshift(buyerNotif);
      this._persistNotification(buyerNotif);

      // Dispatches final comparison & closure result email to the buyer
      const buyerEmail = this.resolveBuyerEmailForRFQ(rfq);
      if (buyerEmail) {
        mailerService
          .sendRfqFinalComparisonEmail(buyerEmail, {
            rfq,
            quotes: rfq.quotes || [],
            recipientName: rfq.buyerAccountName || rfq.buyerName,
          })
          .catch((err) => logger.error(`Failed to send RFQ final closure comparison email for ${rfq.rfqNumber}`, err, 'STORE_SERVICE'));
      }

      // Dispatches SMS acknowledgment regarding quotation comparison to the buyer within 10 minutes
      this.scheduleBuyerComparisonSms(rfq, 0);

      // Clear any pending delayed quote email timers since final closure email was sent
      if (this._delayedQuoteTimers && this._delayedQuoteTimers.has(rfq.id)) {
        const handles = this._delayedQuoteTimers.get(rfq.id) || [];
        handles.forEach((h) => clearTimeout(h));
        this._delayedQuoteTimers.delete(rfq.id);
      }
    }
    const matches = this.vendors.filter((v) => this.vendorCoversRFQ(v, rfq));
    if (matches.length > 0) {
      const vendorNotifs = matches.map((vendor) =>
        this._buildNotification({
          recipientType: 'vendor',
          recipientId: vendor.id,
          kind: 'rfq_closed',
          rfq,
          title: `RFQ Closed: ${rfq.rfqNumber}`,
          message: `Requisition ${rfq.rfqNumber} has been closed by the buyer. Bidding is now concluded.`,
          meta: { rfqNumber: rfq.rfqNumber },
        })
      );
      this.notifications.unshift(...vendorNotifs);
      this._persistNotificationBatch(vendorNotifs);
    }
  }

  /**
   * Schedules an SMS acknowledgment to the buyer regarding quotation comparison upon RFQ closure within 10 minutes.
   */
  async scheduleBuyerComparisonSms(rfq, delayMs = 0) {
    const effectiveDelay = Math.min(Math.max(0, delayMs), 10 * 60 * 1000);
    const trigger = async () => {
      try {
        const buyer = rfq.buyerEmail ? await this.getBuyerAccountByEmail(rfq.buyerEmail) : null;
        const mobile = rfq.buyerPhone || (buyer && (buyer.phone || buyer.mobile || buyer.contactPhone));
        if (mobile) {
          await smsService.sendBuyerComparisonSms({
            mobile,
            buyerName: rfq.buyerAccountName || rfq.buyerName,
            rfqNumber: rfq.rfqNumber,
            quotesCount: rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0),
          });
        }
      } catch (err) {
        logger.error(`Error sending buyer comparison SMS for ${rfq.rfqNumber}`, err, 'STORE_SERVICE');
      }
    };

    if (effectiveDelay > 0 && process.env.NODE_ENV !== 'test') {
      setTimeout(trigger, effectiveDelay);
    } else {
      await trigger();
    }
  }

  // ==========================================
  // 3c. TRANSACTIONAL EMAIL (RFQ fan-out + quote-received)
  // ==========================================
  // Every send is fire-and-forget: mailerService no-ops under test and when
  // SMTP is unconfigured, and a real per-recipient failure is logged, never
  // thrown, so one bad address can't stop the rest of a fan-out.

  /** Subscription-tier priority for RFQ-email ranking. Unknown/free → 0. */
  _vendorTierRank(plan) {
    if (plan === 'select') return 3;
    if (plan === 'connect') return 2;
    if (plan === 'premium' || plan === 'premium_network') return 1;
    return 0;
  }

  /**
   * Up to `limit` vendors to email a new RFQ to.
   *
   * Starts from the vendors the RFQ actually reaches (`vendorCoversRFQ` — same
   * category rule as the opportunity feed), keeps only those with an email
   * address, then ranks by subscription tier, a delivery-pincode match, and
   * rating so the enquiry lands with the best-matched suppliers first.
   */
  selectVendorsForRFQEmail(rfq, limit = 10) {
    const pincode = rfq.deliveryPincode ? String(rfq.deliveryPincode).trim() : null;
    const rawSignals = this._rfqCategorySignals(rfq);
    const distinctSignals = Array.from(new Set(rawSignals.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)));

    const rankVendor = (v) => ({
      vendor: v,
      score:
        this._vendorTierRank(v.subscriptionPlan) * 1000 +
        (pincode && v.pincode && String(v.pincode).trim() === pincode ? 100 : 0) +
        (Number(v.rating) || 0),
    });

    const eligible = this.vendors.filter((v) => v.email && this.vendorCoversRFQ(v, rfq));

    if (distinctSignals.length > 3) {
      const selected = new Map();
      for (const sig of distinctSignals) {
        const catMatched = eligible
          .filter((v) => this.vendorCoversCategory(v, sig))
          .map(rankVendor)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((x) => x.vendor);

        for (const v of catMatched) {
          const key = v.id || v.email;
          if (key && !selected.has(key)) {
            selected.set(key, v);
          }
        }
      }
      return Array.from(selected.values());
    }

    return eligible
      .map(rankVendor)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.vendor);
  }

  /** Email a newly-created RFQ to its top matched vendors and assigned vendors. Fired from createRFQ. */
  emailRFQToMatchedVendors(rfq) {
    if (!rfq || rfq.status === 'Draft') {
      return 0;
    }
    const recipients = this.selectVendorsForRFQEmail(rfq);
    const assigned = (Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : []).filter((v) => v && v.email);
    const allEmails = new Set();

    for (const vendor of recipients) {
      if (vendor.email && !allEmails.has(vendor.email.toLowerCase())) {
        allEmails.add(vendor.email.toLowerCase());
        const creditInfo = this.checkVendorQuotationEligibility(vendor);
        this._background(
          mailerService.sendRfqInviteEmail(vendor.email, {
            rfq,
            recipientName: vendor.contactPerson || vendor.name,
            freeCreditsRemaining: creditInfo.freeCreditsRemaining,
            isSubscribed: creditInfo.isSubscribed,
          }),
          'Failed to email RFQ invite to matched vendor'
        );
      }
    }

    for (const vendor of assigned) {
      if (vendor.email && !allEmails.has(vendor.email.toLowerCase())) {
        allEmails.add(vendor.email.toLowerCase());
        const resolvedVendor = this.getVendorById(vendor.id || vendor.email, 'all');
        const creditInfo = this.checkVendorQuotationEligibility(resolvedVendor || vendor);
        this._background(
          mailerService.sendRfqInviteEmail(vendor.email, {
            rfq,
            recipientName: vendor.contactPerson || vendor.name,
            freeCreditsRemaining: creditInfo.freeCreditsRemaining,
            isSubscribed: creditInfo.isSubscribed,
          }),
          'Failed to email RFQ invite to assigned vendor'
        );
      }
    }

    return allEmails.size;
  }

  /**
   * Whether an RFQ originated from the web portal (vs inbound email gateway).
   */
  isPortalRFQ(rfq) {
    if (!rfq) return false;
    const src = String(rfq.source || '').toLowerCase().trim();
    return src !== 'email' && src !== 'email_gateway' && src !== 'inbound_email';
  }

  /**
   * Whether an RFQ is currently within its 48-hour bidding integrity window.
   */
  isWithin48HourWindow(rfq) {
    if (!rfq || rfq.status === 'Closed') return false;
    const isV0 =
      rfq.sourcingMode === 'mode_0' ||
      rfq.sourcingMode === 'v0' ||
      rfq.sourcingMode === 'version_0';
    if (isV0) return false;
    if (rfq.quotesHidden) return true;
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    let createdAtMs = 0;
    if (rfq.createdAt) {
      const parsed = Date.parse(rfq.createdAt);
      if (!isNaN(parsed) && parsed > 0) {
        createdAtMs = parsed;
      }
    }
    if (createdAtMs <= 0) return true;
    return Date.now() - createdAtMs < FORTY_EIGHT_HOURS_MS;
  }

  /**
   * Calculates the remaining milliseconds in the 48-hour bidding window.
   */
  getRemaining48HourMs(rfq) {
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    let createdAtMs = 0;
    if (rfq && rfq.createdAt) {
      const parsed = Date.parse(rfq.createdAt);
      if (!isNaN(parsed) && parsed > 0) {
        createdAtMs = parsed;
      }
    }
    if (createdAtMs <= 0) return FORTY_EIGHT_HOURS_MS;
    const elapsed = Date.now() - createdAtMs;
    return Math.max(0, FORTY_EIGHT_HOURS_MS - elapsed);
  }

  /**
   * Schedules a delayed quotation notification email to the buyer after the 48-hour window expires.
   */
  scheduleDelayedBuyerQuoteEmail(rfq, quote, buyer, delayMs) {
    const timer = setTimeout(() => {
      try {
        const currentRfq = this.getRFQById(rfq.id) || rfq;
        if (!currentRfq) return;
        logger.info(
          `[48H_BID_RULE] 48-hour sealed window expired for portal RFQ ${currentRfq.rfqNumber}. Dispatching quote email to buyer (${buyer.corporateEmail}).`,
          { rfqNumber: currentRfq.rfqNumber, quoteVendor: quote.vendorName, buyerEmail: buyer.corporateEmail },
          'STORE_SERVICE'
        );
        this._background(
          mailerService.sendQuoteReceivedEmail(buyer.corporateEmail, {
            rfq: currentRfq,
            quote,
            recipientName: buyer.organizationName,
          }),
          'Failed to dispatch delayed 48-hour quote email to buyer'
        );
      } catch (err) {
        logger.error(`Error in delayed quote email dispatch for ${rfq.rfqNumber}`, err, 'STORE_SERVICE');
      }
    }, delayMs);

    if (timer && timer.unref) {
      timer.unref();
    }

    if (!this._delayedQuoteTimers) {
      this._delayedQuoteTimers = new Map();
    }
    const list = this._delayedQuoteTimers.get(rfq.id) || [];
    list.push(timer);
    this._delayedQuoteTimers.set(rfq.id, list);
  }

  /**
   * Email a submitted quote to the RFQ's owning buyer. Fired from addQuoteToRFQ.
   *
   * For Portal RFQ flow:
   *   Stops the buyer from receiving the quote email for 48 hours.
   *   Schedules dispatch after the 48-hour bidding integrity window elapses.
   *
   * For Email RFQ flow (or once 48 hours have elapsed / RFQ is closed):
   *   Dispatches the quote email immediately.
   */
  emailQuoteToBuyer(rfq, quote) {
    if (!rfq) return false;
    const buyerEmail = this.resolveBuyerEmailForRFQ(rfq);
    if (!buyerEmail) return false;

    const buyer = (rfq.buyerAccountId && this.buyerAccounts.find((a) => a.id === rfq.buyerAccountId)) || {
      id: rfq.buyerAccountId || null,
      corporateEmail: buyerEmail,
      organizationName: rfq.buyerAccountName || rfq.buyerName || 'Buyer',
    };

    const isV0 =
      rfq.sourcingMode === 'mode_0' ||
      rfq.sourcingMode === 'v0' ||
      rfq.sourcingMode === 'version_0';

    const isPortal = this.isPortalRFQ(rfq);
    const in48hWindow = this.isWithin48HourWindow(rfq);

    // For V0: Quotes are sent directly to the buyer's email immediately (48-hour restriction does not apply to V0).
    // For non-V0 Portal RFQs within 48h: Delay email dispatch.
    if (isPortal && in48hWindow && !isV0) {
      const delayMs = this.getRemaining48HourMs(rfq);
      logger.info(
        `[48H_BID_RULE] Portal RFQ ${rfq.rfqNumber}: stopped quote email to buyer (${buyerEmail}) for 48 hours. Scheduled dispatch in ${Math.round(delayMs / 1000 / 60)} minutes.`,
        { rfqNumber: rfq.rfqNumber, quoteVendor: quote.vendorName, buyerEmail, delayMs },
        'STORE_SERVICE'
      );
      this.scheduleDelayedBuyerQuoteEmail(rfq, quote, buyer, delayMs);
      return { delayed: true, delayMs, sent: false };
    }

    this._background(
      mailerService.sendQuoteReceivedEmail(buyer.corporateEmail, { rfq, quote, recipientName: buyer.organizationName }),
      'Failed to email quote to buyer'
    );
    return true;
  }

  /**
   * Resolve the owning buyer's corporate email for an RFQ.
   *
   * Used by the email gateway to CC the buyer on vendor quotation
   * acknowledgements and failure notifications. Falls back to the RFQ's
   * `raisedByEmail` when no buyer account is attributed.
   */
  resolveBuyerEmailForRFQ(rfq) {
    if (!rfq) return null;
    if (rfq.buyerAccountId) {
      const buyer = this.buyerAccounts.find((a) => a.id === rfq.buyerAccountId);
      if (buyer && buyer.corporateEmail) return buyer.corporateEmail;
    }
    return rfq.raisedByEmail || rfq.sourceEmail || rfq.buyerEmail || null;
  }

  // ==========================================
  // 4. EVALUATIONS
  // ==========================================
  getEvaluations() {
    return this.evaluations;
  }

  createEvaluation(evalData) {
    const { moduleScores, overallScore, status, systemAction } = calculate360Evaluation(evalData.moduleScores || {});

    const mergedModuleScores = { ...moduleScores };
    if (evalData.moduleScores && typeof evalData.moduleScores === 'object') {
      for (const [key, val] of Object.entries(evalData.moduleScores)) {
        if (mergedModuleScores[key] && typeof val === 'object') {
          mergedModuleScores[key] = { ...mergedModuleScores[key], ...val };
        } else if (val) {
          mergedModuleScores[key] = val;
        }
      }
    }

    const newEval = {
      id: evalData.id || `eval-${Date.now()}`,
      vendorId: evalData.vendorId || `v-${Date.now()}`,
      // An evaluation identifies a real supplier or it identifies nobody. These
      // used to default to 'Enterprise Supplier' / 'vendor@supplier.com' /
      // '+91 98000 00000', which produced audit records that looked like a
      // genuine assessment of a company that did not exist.
      vendorName: evalData.vendorName || null,
      contactPerson: evalData.contactPerson || null,
      email: evalData.email || null,
      phone: evalData.phone || null,
      category: evalData.category || null,
      submissionDate: evalData.submissionDate || new Date().toISOString().substring(0, 10),
      status: evalData.status || status,
      overallScore: evalData.overallScore || overallScore,
      systemAction: evalData.systemAction || systemAction,
      moduleScores: mergedModuleScores,
      documents: evalData.documents || [],
      // The per-question detail was previously silently dropped here even
      // though the client always sent it — only the rolled-up moduleScores
      // survived.
      questionBreakdown: evalData.questionBreakdown || [],
    };

    this.evaluations.unshift(newEval);
    this._persistEvaluation(newEval);

    this.addAuditLog({
      userEmail: evalData.actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Executed 360° AI Supplier Audit for ${newEval.vendorName || newEval.vendorId}: Score ${newEval.overallScore}% (${newEval.status})`,
    });

    return newEval;
  }

  // ==========================================
  // 5. AUDIT LOGS & CRYPTO VERIFICATION
  // ==========================================
  getAuditLogs() {
    return this.auditLogs;
  }

  addAuditLog({ userEmail, action, rfqNumber, ipAddress }) {
    const previousHash = this.auditLogs.length > 0 ? this.auditLogs[0].shaSignature : '';
    const entry = createAuditEntry({ userEmail, action, rfqNumber, ipAddress, previousHash });
    this.auditLogs.unshift(entry);
    this._persistAuditLog(entry);

    logger.audit(action, userEmail || 'system@procucev.ai', { rfqNumber, ipAddress, shaSignature: entry.shaSignature }, rfqNumber);

    return entry;
  }

  verifyAuditIntegrity() {
    return verifyAuditTrail(this.auditLogs);
  }

  // ==========================================
  // 6. AI BOT FEED
  // ==========================================
  getAIFeed() {
    return this.aiFeed;
  }

  addAIFeedItem(feedItem) {
    let buyerAccountId = feedItem.buyerAccountId || null;
    if (!buyerAccountId && feedItem.rfqNumber) {
      const rfq = this.getRFQById(feedItem.rfqNumber);
      if (rfq && rfq.buyerAccountId) {
        buyerAccountId = rfq.buyerAccountId;
      }
    }

    const item = {
      id: feedItem.id || `feed-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      timestamp: feedItem.timestamp || new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      timeAgo: feedItem.timeAgo || 'Just now',
      type: feedItem.type || 'call',
      channel: feedItem.channel || 'call',
      title: feedItem.title || 'AI Bot Event',
      message: feedItem.message || '',
      recipient: feedItem.recipient || 'Vendor Contact',
      rfqNumber: feedItem.rfqNumber || null,
      buyerAccountId,
      status: feedItem.status || 'delivered',
      channelDetails: feedItem.channelDetails || {},
    };

    this.aiFeed.unshift(item);
    if (this.aiFeed.length > 100) this.aiFeed.pop();
    // The DB-side upsert trims to the newest 100 rows itself (see
    // domainQueries.upsertAIFeedItemInDB), so it stays in sync with the
    // in-memory cap without needing to know which item .pop() just evicted.
    this._persistAIFeedItem(item);
    return item;
  }

  // ==========================================
  // 7. SYSTEM CONFIG & AZURE HEALTH
  // ==========================================
  getSystemConfig() {
    return this.systemConfig;
  }

  updateSystemConfig(updates) {
    this.systemConfig = { ...this.systemConfig, ...updates };
    return this.systemConfig;
  }

  getAzureHealth() {
    return this.azureHealth;
  }

  /**
   * Replace the database row in the infrastructure list with a live probe result.
   *
   * The row is reported from an actual connection attempt rather than asserted:
   * `latency` is the measured round trip and `status` reflects whether the query
   * succeeded. `uptime` is left as '—' because nothing in this process observes
   * it — the previous hardcoded '99.99%' was not measured from anything.
   */
  async refreshInfrastructureHealth() {
    const health = await pool.checkDatabaseHealth();
    const row = {
      service: health.isConfigured
        ? `${health.providerLabel}${health.database ? ` — ${health.database}` : ''}`
        : DATABASE_HEALTH_SERVICE_LABEL,
      status: health.isConnected ? 'ONLINE' : health.isConfigured ? 'UNREACHABLE' : 'NOT_CONFIGURED',
      latency: health.isConnected ? `${health.latencyMs}ms` : '—',
      uptime: '—',
      details: health.isConnected
        ? `${health.poolStatus}. ${health.userCount} active account(s), ${health.vendorCount} vendor(s), ${health.rfqCount} RFQ(s).`
        : health.errorMessage || 'Database connection failed.',
    };

    const idx = this.azureHealth.findIndex(
      (entry) => entry.service === DATABASE_HEALTH_SERVICE_LABEL || entry.service === row.service
    );
    if (idx === -1) {
      this.azureHealth.unshift(row);
    } else {
      this.azureHealth[idx] = row;
    }

    return health;
  }

  // ==========================================
  // 9. HISTORICAL PURCHASE DATA INGESTION & SETUP
  // ==========================================
  /**
   * Empanel suppliers from a buyer's historical purchase dump.
   *
   * Only what the dump actually contains is stored. Every missing field used to
   * be back-filled with an invention — a name of "Historical Supplier 3", an
   * address of "supplier.3@historical.com", a phone of "+91 98000 00000", a
   * category of "Engineering Spares - Mechanical", a location of "Industrial
   * Zone, India", a rating of 4.6 and a score of 88.0 — and the row was then
   * marked `evaluated: true`. The result was a vendor master full of suppliers
   * that could not be contacted, carrying scores nobody had assessed, which the
   * RFQ engine would then select against.
   *
   * A record without a company name and a contact email cannot identify a
   * supplier, so it is skipped and counted, and the caller is told how many were
   * rejected and why.
   */
  async processHistoricalPurchaseData(period, vendorRecords = [], requestingBuyerAccount = null) {
    let importedCount = 0;
    const skipped = [];
    // Every genuinely-new vendor pushed into `this.vendors` this run — awaited
    // against Postgres below before the response goes out, since `vendors.email`
    // is UNIQUE and this ingestion never checked for a collision outside the
    // requesting buyer's own scope. A colliding email used to insert cleanly
    // into memory while the real Postgres write silently failed in the
    // background, so the buyer saw "imported" for a supplier that was never
    // actually persisted.
    const createdThisRun = [];
    const attributedAccount = requestingBuyerAccount || this.activeBuyerAccount;
    const buyerId = attributedAccount ? attributedAccount.id : null;
    const buyerEmail = attributedAccount ? attributedAccount.corporateEmail : null;
    const buyerOrganizationName = attributedAccount ? attributedAccount.organizationName : 'Procucev Enterprise';

    // Step 5 of the buyer setup wizard previews "Template A" (PO-history
    // match) / "Template B" (no match) per vendor — this is the one place
    // that actually has to honor that, instead of always sending the
    // generic onboarding email regardless of what was previewed. Templates
    // are org-scoped and buyer-editable (vendor_dispatch_templates); a
    // lookup failure here must not block vendor ingestion, so it falls back
    // to the hardcoded default wording on any error.
    let dispatchTemplates = {};
    if (buyerEmail) {
      try {
        const identity = await identityQueries.findUserByEmail(buyerEmail);
        if (identity && identity.orgId) {
          dispatchTemplates = await buyerProfileQueries.getDispatchTemplates(identity.orgId);
        }
      } catch (err) {
        logger.error('Failed to load vendor dispatch templates', err, 'STORE_SERVICE');
      }
    }

    const isMappedRecord = (rec) => {
      if (rec.categoriesMappedByBuyer === true) return true;
      if (rec.categoriesMappedByBuyer === false) return false;
      const maj = (rec.majorCategory || '').trim();
      return Boolean(maj && !maj.toLowerCase().includes('uncategorized'));
    };

    /** Template A when the vendor has a buyer-mapped category, else Template B. */
    const buildMappingEmail = (rec, { to, recipientName, vendorCode, tempPassword, contactPhone }) => {
      const hasMapping = isMappedRecord(rec);
      if (hasMapping) {
        const override = dispatchTemplates.category_mapped || {};
        return {
          templateType: 'Template A',
          payload: mailerService.buildVendorCategoryMappingEmail({
            to,
            recipientName,
            buyerOrganizationName,
            vendorCode,
            majorCategory: rec.majorCategory || 'Engineering Spares - Mechanical',
            minorCategories: Array.isArray(rec.minorCategories) ? rec.minorCategories : [],
            customSubject: override.subject,
            customMessage: override.message,
            tempPassword,
            contactPhone,
          }),
        };
      }
      const override = dispatchTemplates.self_map_required || {};
      return {
        templateType: 'Template B',
        payload: mailerService.buildVendorSelfMappingEmail({
          to,
          recipientName,
          buyerOrganizationName,
          vendorCode,
          customSubject: override.subject,
          customMessage: override.message,
          tempPassword,
          contactPhone,
        }),
      };
    };

    let mappedCount = 0;
    let mappedEmailsSent = 0;
    let unmappedCount = 0;
    let unmappedEmailsSent = 0;
    const failedEmails = [];
    const vendorsToEmail = [];

    for (let idx = 0; idx < vendorRecords.length; idx++) {
      const rec = vendorRecords[idx];
      const name = (rec.companyName || rec.name || '').trim();
      const email = (rec.email || '').trim();

      if (!name || !email) {
        skipped.push({
          row: idx + 1,
          reason: !name && !email
            ? 'Missing both company name and contact email.'
            : !name
              ? 'Missing company name.'
              : 'Missing contact email.',
        });
        continue;
      }

      const isMapped = isMappedRecord(rec);
      if (isMapped) mappedCount++;
      else unmappedCount++;

      const minorCategories = Array.isArray(rec.minorCategories) ? rec.minorCategories : [];
      const majorCategory = (rec.majorCategory || '').trim() || null;

      // Check if vendor already exists in memory or in DB
      let existing = this.vendors.find(
        (v) => v.email && v.email.toLowerCase() === email.toLowerCase()
      );
      if (!existing && pool.hasStorage()) {
        try {
          // eslint-disable-next-line no-await-in-loop
          existing = await domainQueries.getVendorByEmailFromDB(email);
          if (existing && !this.vendors.some((v) => v.id === existing.id)) {
            this.vendors.push(existing);
          }
        } catch (e) {
          logger.error('Failed to lookup vendor by email from DB', e, 'STORE_SERVICE');
        }
      }

      if (existing) {
        const sBuyerId = buyerId ? String(buyerId).toLowerCase() : null;
        const sBuyerEmail = buyerEmail ? String(buyerEmail).toLowerCase() : null;
        const alreadyScopedToThisBuyer = Boolean(
          (sBuyerId && (
            (existing.buyerId && String(existing.buyerId).toLowerCase() === sBuyerId) ||
            (existing.buyerAccountId && String(existing.buyerAccountId).toLowerCase() === sBuyerId)
          )) ||
          (sBuyerEmail && existing.buyerEmail && String(existing.buyerEmail).toLowerCase() === sBuyerEmail)
        );

        existing.buyerId = buyerId || existing.buyerId || null;
        existing.buyerAccountId = buyerId || existing.buyerAccountId || null;
        existing.buyerEmail = buyerEmail || existing.buyerEmail || null;
        if (name) existing.name = name;
        if (rec.contactPerson) existing.contactPerson = (rec.contactPerson || '').trim();
        if (rec.phone) existing.phone = (rec.phone || '').trim();
        if (rec.location || rec.address) existing.location = (rec.location || rec.address || '').trim();
        if (majorCategory) existing.majorCategory = majorCategory;
        if (minorCategories.length > 0) {
          existing.minorCategories = minorCategories;
          existing.clientMappedCategories = minorCategories;
        }
        if (Number.isFinite(Number(rec.rating))) existing.rating = Number(rec.rating);
        if (Number.isFinite(Number(rec.score))) existing.score = Number(rec.score);
        existing.hasRecord = true;
        existing.isExistingInDatabase = true;

        if (pool.hasStorage()) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await domainQueries.upsertVendorInDB(existing);
          } catch (err) {
            logger.error('Failed to update existing vendor in DB', err, 'STORE_SERVICE');
          }
        }

        if (!alreadyScopedToThisBuyer) {
          importedCount++;
        }
        vendorsToEmail.push({ rec, vendor: existing, isNew: !alreadyScopedToThisBuyer, isMapped });
        continue;
      }

      const newVendor = {
        id: `v-hist-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        buyerId: buyerId || null,
        buyerAccountId: buyerId || null,
        buyerEmail: buyerEmail || null,
        name,
        email,
        contactPerson: (rec.contactPerson || '').trim() || null,
        phone: (rec.phone || '').trim() || null,
        majorCategory,
        minorCategories,
        location: (rec.location || rec.address || '').trim() || null,
        // Absent, not assumed. A supplier arriving from a spend extract has not
        // been rated or audited by anyone yet.
        rating: Number.isFinite(Number(rec.rating)) ? Number(rec.rating) : null,
        score: Number.isFinite(Number(rec.score)) ? Number(rec.score) : null,
        source: 'historical_purchase_dump',
        status: 'PENDING EVALUATION',
        evaluated: false,
        hasRecord: true,
        isExistingInDatabase: true,
        onboardingEmailStatus: 'pending',
        clientMappedCategories: minorCategories,
        vendorSelectedCategories: [],
        // Nothing to align against until the vendor confirms their own categories.
        isCategoryAligned: false,
      };
      this.vendors.push(newVendor);
      createdThisRun.push({ row: idx + 1, vendor: newVendor, isMapped });
      importedCount++;
      vendorsToEmail.push({ rec, vendor: newVendor, isNew: true, isMapped });
    }

    // Confirm each new vendor actually landed in Postgres before reporting
    // success for it — a row whose email collided with one from a different
    // buyer (or the marketplace directory) is rolled back here instead of
    // staying an in-memory-only phantom.
    for (const { row, vendor, isMapped } of createdThisRun) {
      try {
        await this.confirmVendorPersisted(vendor);
      } catch (err) {
        this.vendors = this.vendors.filter((v) => v.id !== vendor.id);
        importedCount--;
        if (isMapped) mappedCount--; else unmappedCount--;
        const toEmailIdx = vendorsToEmail.findIndex((item) => item.vendor.id === vendor.id);
        if (toEmailIdx !== -1) vendorsToEmail.splice(toEmailIdx, 1);
        skipped.push({
          row,
          reason: err && err.statusCode === 409
            ? `A vendor with the email ${vendor.email} already exists.`
            : 'Could not be saved — try again.',
        });
      }
    }

    // Process email dispatches for both mapped (Template A) and unmapped (Template B) vendors in a single action
    for (const { rec, vendor, isNew, isMapped } of vendorsToEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!vendor.email || !emailRegex.test(vendor.email)) {
        failedEmails.push({
          vendorId: vendor.id,
          vendorName: vendor.name,
          email: vendor.email || '',
          template: isMapped ? 'Template A' : 'Template B',
          reason: !vendor.email ? 'Vendor record has no registered email address.' : 'Invalid email address format.',
        });
        continue;
      }

      // Avoid duplicate emails on retried actions if already confirmed sent
      if (vendor.onboardingEmailStatus === 'sent') {
        if (isMapped) mappedEmailsSent++;
        else unmappedEmailsSent++;
        logger.info(`Skipping duplicate onboarding email to ${vendor.email} (already sent)`, { vendorId: vendor.id }, 'STORE_SERVICE');
        continue;
      }

      let tempPassword = this._generateTempPassword();
      try {
        const existingIdentity = await identityQueries.findUserByEmail(vendor.email).catch(() => null);
        if (existingIdentity) {
          logger.info(`Skipped onboarding identity provisioning for ${vendor.email}: an identity account already exists`, { vendorId: vendor.id }, 'STORE_SERVICE');
          if (isNew) {
            continue;
          }
        } else {
          const result = await identityQueries.insertVendorAccount({
            email: vendor.email,
            password: tempPassword,
            phone: vendor.phone || null,
            fullName: vendor.contactPerson || vendor.name,
            organizationName: vendor.name,
            createdBy: 'vendor-ingestion',
          });
          if (result && result.created) {
            logger.info(`Vendor identity account created for ${vendor.email}`, { vendorId: vendor.id }, 'STORE_SERVICE');
          }
        }
      } catch (idErr) {
        logger.error(`Failed to verify or provision identity for ${vendor.email}`, idErr, 'STORE_SERVICE');
      }

      const { templateType, payload } = buildMappingEmail(rec, {
        to: vendor.email,
        recipientName: vendor.contactPerson || vendor.name,
        vendorCode: vendor.id,
        tempPassword,
        contactPhone: String(rec.phone || vendor.phone || '').trim(),
      });

      try {
        const delivery = await mailerService.sendVendorIngestionEmail(payload, 'onboarding');
        if (delivery && delivery.sent) {
          this.updateVendor(vendor.id, { onboardingEmailStatus: 'sent', tempPassword });
          if (isMapped) mappedEmailsSent++;
          else unmappedEmailsSent++;
          logger.info(`Onboarding email (${templateType}) sent to ${vendor.email}`, { vendorId: vendor.id }, 'STORE_SERVICE');
        } else {
          failedEmails.push({
            vendorId: vendor.id,
            vendorName: vendor.name,
            email: vendor.email,
            template: templateType,
            reason: (delivery && delivery.reason) || 'Email service rejected delivery',
          });
          logger.warn(`Failed to send onboarding email to ${vendor.email}`, { reason: delivery?.reason }, 'STORE_SERVICE');
        }
      } catch (sendErr) {
        failedEmails.push({
          vendorId: vendor.id,
          vendorName: vendor.name,
          email: vendor.email,
          template: templateType,
          reason: sendErr.message || 'Error communicating with email service',
        });
        logger.error(`Error sending onboarding email to ${vendor.email}`, sendErr, 'STORE_SERVICE');
      }
    }

    const totalProcessed = mappedCount + unmappedCount;
    const overallStatus = failedEmails.length === 0 ? 'COMPLETED' : (mappedEmailsSent + unmappedEmailsSent > 0 ? 'COMPLETED_WITH_FAILURES' : 'FAILED');

    // Attributed to the requesting buyer's own account when the controller
    // resolved one from the session (same convention as createRFQ).
    this.addAuditLog({
      userEmail: attributedAccount ? attributedAccount.corporateEmail : SYSTEM_ACTOR_EMAIL,
      action: `Processed ${period.replace('_', ' ')} historical purchase dump: ${importedCount} supplier(s) empanelled (${mappedEmailsSent} Template A sent, ${unmappedEmailsSent} Template B sent, ${failedEmails.length} failed).`,
    });

    return {
      success: true,
      importedCount,
      totalProcessed,
      mappedCount,
      mappedEmailsSent,
      unmappedCount,
      unmappedEmailsSent,
      failedEmailCount: failedEmails.length,
      failedEmails,
      skippedCount: skipped.length,
      skipped,
      period,
      totalVendors: this.vendors.length,
      overallStatus,
    };
  }

  /**
   * Empanel a supplier whose category mapping the buyer has just approved.
   *
   * Deliberately separate from addVendor, which defaults `rating` to 4.5,
   * `score` to 85.0 and `status` to "PREFERRED ENTERPRISE SUPPLIER". Those
   * defaults are wrong for this path: a supplier arriving from a vendor-master
   * and PO ingestion has had its categories established from real purchasing
   * evidence, but nobody has evaluated it. Carrying an invented score would let
   * the RFQ engine rank it against suppliers that were actually assessed.
   *
   * So the only things stored are the things the ingestion established. Absent
   * stays absent: rating, score and evaluated are null/false until a real
   * evaluation produces them.
   */
  empanelIngestedVendor(vendorData, actorEmail = null) {
    const minorCategories = Array.isArray(vendorData.minorCategories) ? vendorData.minorCategories : [];
    const newVendor = {
      id: `v-ingest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: vendorData.name,
      email: vendorData.email,
      contactPerson: vendorData.contactPerson || null,
      phone: vendorData.phone || null,
      location: vendorData.location || null,
      gstin: vendorData.gstin || null,
      vendorCode: vendorData.vendorCode || null,
      majorCategory: vendorData.majorCategory || null,
      minorCategories,
      // The buyer mapped these from PO history; the vendor has not confirmed
      // them yet, so there is nothing to align against.
      clientMappedCategories: Array.isArray(vendorData.clientMappedCategories)
        ? vendorData.clientMappedCategories
        : minorCategories,
      vendorSelectedCategories: [],
      isCategoryAligned: false,
      rating: null,
      score: null,
      evaluated: false,
      hasRecord: true,
      isExistingInDatabase: true,
      status: 'REGISTERED / NOT EVALUATED',
      source: 'vendor_master_ingestion',
      onboardingEmailStatus: 'pending',
      profileCompletionStatus: 'pending',
      addedByBuyerCompany: vendorData.addedByBuyerCompany || null,
      subscriptionPlan: 'premium',
      rfqDownloadsUsed: 0,
    };

    this.vendors.unshift(newVendor);
    this._persistVendor(newVendor);
    this.addAuditLog({
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Empanelled ${newVendor.name} from vendor master ingestion in category ${newVendor.majorCategory || 'unassigned'
        }`,
    });

    return newVendor;
  }

  // ==========================================
  // 10. DUAL-STREAM CATEGORY RECONCILIATION
  // ==========================================
  updateVendorCategories(vendorId, { clientMappedCategories = [], vendorSelectedCategories = [] }) {
    // Scoped 'all': the controller has already authorized the caller (see
    // vendorController.updateCategories) by the time this runs, so re-scoping
    // by buyer here is redundant — and was actively wrong: an unscoped lookup
    // returns undefined for any vendor carrying a buyerId/buyerAccountId
    // (every buyer-uploaded vendor), silently returning null from this whole
    // function. The controller then responded 200 {success:true, data:null},
    // and the frontend's follow-up read of data.clientMappedCategories on
    // that null threw a TypeError right after reporting the save succeeded.
    const vendor = this.getVendorById(vendorId, 'all');
    if (!vendor) return null;

    // Check alignment
    const isCategoryAligned =
      clientMappedCategories.length === 0 ||
      clientMappedCategories.every((cat) => vendorSelectedCategories.includes(cat));

    const updated = this.updateVendor(vendor.id, {
      clientMappedCategories,
      vendorSelectedCategories: vendorSelectedCategories.slice(0, 10), // Max 10 categories
      isCategoryAligned,
    });

    this.addAuditLog({
      userEmail: vendor.email,
      action: `Reconciled categories for ${vendor.name}: ${vendorSelectedCategories.length} categories active (Aligned: ${isCategoryAligned})`,
    });

    return updated;
  }

  // ==========================================
  // 11. AI SUPPORT CHAT ASSISTANT & ESCALATION
  // ==========================================
  handleSupportChat(prompt, userRole = 'buyer') {
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cleanPrompt = (prompt || '').toLowerCase().trim();

    const dissatisfactionKeywords = [
      'not happy',
      'not satisfied',
      'not helpful',
      'bad',
      'human',
      'agent',
      'connect with agent',
      'support agent',
      'further support',
      'speak to person',
      'transfer',
      'unsatisfied',
      'disappointed',
      'no help',
    ];

    const isEscalation = dissatisfactionKeywords.some((kw) => cleanPrompt.includes(kw));

    if (isEscalation) {
      const ticketId = `TK-${Math.floor(100000 + Math.random() * 900000)}`;
      this.addAuditLog({
        userEmail: 'support@procucev.com',
        action: `Support Chat Escalation (#${ticketId}) pushed to human procurement specialist for ${userRole}. Prompt: "${prompt}"`,
      });

      return {
        reply: `I understand your requirement. I have escalated this ticket (#${ticketId}) to a Senior Sourcing Specialist. Our procurement desk will contact you via email shortly.`,
        isEscalated: true,
        ticketId,
        timestamp: timeNow,
      };
    }

    let reply = `Thank you for your message. You can manage autonomous RFQ chasing, quote matrices, and 360° vendor evaluations directly from the Command Center.`;

    if (cleanPrompt.includes('subscription') || cleanPrompt.includes('plan') || cleanPrompt.includes('quota')) {
      reply = `Procucev offers Free Starter (5 RFQs), Version 1 ($199/mo - Client Roster), Version 2 ($499/mo - Hybrid), and Version 3 ($999/mo - Autonomous AI). Vendors can choose between Premium (Free for client-uploaded), Connect ($149/qtr for 50 RFQs), and Select ($349/qtr with Catalogue).`;
    } else if (cleanPrompt.includes('mode 1') || cleanPrompt.includes('mode 2') || cleanPrompt.includes('mode 3') || cleanPrompt.includes('mode')) {
      reply = `Mode 1 circulates RFQs strictly to your private client roster. Mode 2 is a Hybrid pool that expands to verified Procucev network vendors if needed. Mode 3 executes full 360° 6-pillar supplier qualification audits.`;
    } else if (cleanPrompt.includes('download') || cleanPrompt.includes('quote') || cleanPrompt.includes('rfq')) {
      reply = `Vendors can view open opportunities in the Opportunity Feed and submit competitive quotes in 1-click. BOQ line items are automatically normalized in the Buyer Quote Matrix.`;
    }

    return {
      reply,
      isEscalated: false,
      timestamp: timeNow,
    };
  }

  // ==========================================
  // 12. VENDOR ITEM SKU CATALOGUE CRUD
  // ==========================================
  // Scoped per vendor. Called without a vendorId (the buyer-side catalogue
  // browse) it returns every product; the three unowned demo SKUs that used to
  // be visible only through that unfiltered path are gone.
  getVendorCatalogue(vendorId) {
    if (!vendorId) return this.vendorCatalogue;
    return this.vendorCatalogue.filter((p) => p.vendorId === vendorId);
  }

  getCatalogueProductById(id) {
    return this.vendorCatalogue.find((p) => p.id === id);
  }

  addProductToCatalogue(product, vendorId, userEmail) {
    const newProd = {
      ...product,
      id: product.id || `prod-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      vendorId,
      unitPrice: Number(product.unitPrice) || 0,
      leadTimeDays: Number(product.leadTimeDays) || 7,
      moq: Number(product.moq) || 1,
    };
    this.vendorCatalogue.unshift(newProd);
    this._persistCatalogueProduct(newProd);
    this.addAuditLog({
      userEmail: userEmail || 'unknown',
      action: `Added product ${newProd.sku} (${newProd.name}) to item SKU catalogue`,
    });
    return newProd;
  }

  updateCatalogueProduct(id, updates, userEmail) {
    const idx = this.vendorCatalogue.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const { vendorId: _ignoredVendorId, id: _ignoredId, ...safeUpdates } = updates;
    this.vendorCatalogue[idx] = { ...this.vendorCatalogue[idx], ...safeUpdates };
    this._persistCatalogueProduct(this.vendorCatalogue[idx]);
    this.addAuditLog({
      userEmail: userEmail || 'unknown',
      action: `Updated SKU ${this.vendorCatalogue[idx].sku} in catalogue`,
    });
    return this.vendorCatalogue[idx];
  }

  deleteCatalogueProduct(id, userEmail) {
    const idx = this.vendorCatalogue.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const removed = this.vendorCatalogue.splice(idx, 1)[0];
    this._removeCatalogueProduct(id);
    this.addAuditLog({
      userEmail: userEmail || 'unknown',
      action: `Removed product ${removed.sku} from SKU catalogue`,
    });
    return true;
  }

  // ==========================================
  // 13. BATCH CHASER DISPATCH & PO APPROVAL
  // ==========================================
  triggerBatchChaser(rfqId, channels = ['call', 'whatsapp', 'sms']) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    // Only the vendors actually invited to this RFQ. The fallback here used to be
    // `this.vendors.slice(0, 3)` — the first three vendors in the master roster —
    // so an RFQ with nobody assigned would chase three uninvolved suppliers and
    // log outreach against them.
    const vendors = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    if (vendors.length === 0) {
      return {
        success: false,
        count: 0,
        logs: [],
        error: 'No vendors are assigned to this RFQ, so there is nobody to chase. Assign vendors first.',
      };
    }

    const outreachLogs = [];

    vendors.forEach((vendor) => {
      const logs = simulateChaserOutreach(rfq, vendor);
      outreachLogs.push(...logs);

      // Real multi-channel outreach — fire-and-forget alongside simulation.
      // Both services no-op in test env or when credentials are unset.
      const vendorPhone = vendor.phone || vendor.mobile || vendor.mobileNumber;
      if (vendorPhone) {
        const bidUrl = whatsAppService.generateOneClickBidUrl(rfq.rfqNumber, vendor.email);

        if (channels.includes('whatsapp')) {
          this._background(
            whatsAppService.sendRFQInvitationWhatsApp({
              phone: vendorPhone,
              vendorName: vendor.name,
              contactPerson: vendor.contactPerson,
              rfqNumber: rfq.rfqNumber,
              rfqTitle: rfq.title,
              vendorEmail: vendor.email,
            }).then((result) => {
              logger.info(
                `[CHASER] WhatsApp to ${vendor.name} (${vendorPhone}): ${result.success ? `delivered (${result.messageId})` : `failed — ${result.error || 'unknown'}`}`,
                { vendorId: vendor.id, rfqNumber: rfq.rfqNumber, success: result.success },
                'STORE_SERVICE'
              );
            }),
            'Failed to dispatch chaser WhatsApp'
          );
        }

        if (channels.includes('sms')) {
          this._background(
            smsService.sendRFQChaserSms({
              mobile: vendorPhone,
              vendorName: vendor.name,
              rfqNumber: rfq.rfqNumber,
              rfqTitle: rfq.title,
              bidLink: bidUrl,
            }).then((result) => {
              logger.info(
                `[CHASER] SMS to ${vendor.name} (${vendorPhone}): ${result.success ? `sent (${result.messageId})` : `failed — ${result.error || 'unknown'}`}`,
                { vendorId: vendor.id, rfqNumber: rfq.rfqNumber, success: result.success },
                'STORE_SERVICE'
              );
            }),
            'Failed to dispatch chaser SMS'
          );
        }
      }
    });

    this.aiFeed.unshift(...outreachLogs);
    // This bulk path bypassed addAIFeedItem's 100-item cap entirely before —
    // trim here too so the in-memory list and the DB-side trim (which runs
    // per insert regardless of which path added the row) stay consistent.
    if (this.aiFeed.length > 100) this.aiFeed.splice(100);
    outreachLogs.forEach((log) => this._persistAIFeedItem(log));
    this.addAuditLog({
      userEmail: 'chaser.bot@procucev.com',
      action: `Executed batch multi-channel outreach (${channels.join(' + ')}) for ${rfq.rfqNumber} to ${vendors.length} vendors`,
      rfqNumber: rfq.rfqNumber,
    });

    return { success: true, count: outreachLogs.length, logs: outreachLogs };
  }

  approvePurchaseOrder(rfqNumber, vendorId, vendorName, totalAmount, approverNotes = '', approverEmail = null) {
    const rfq = this.rfqs.find((r) => r.rfqNumber === rfqNumber || r.id === rfqNumber);
    if (!rfq) return null;

    rfq.status = 'PO Generated';
    rfq.awardedVendorId = vendorId || null;
    rfq.awardedVendor = vendorName;
    rfq.awardedAmount = totalAmount;
    this._persistRFQ(rfq);

    const poNumber = `PO-2026-` + (rfqNumber || '').replace('RFQ-2026-', '');
    const issueDate = new Date().toISOString().substring(0, 10);
    const auditRecord = this.addAuditLog({
      userEmail: approverEmail || (this.activeBuyerAccount ? this.activeBuyerAccount.corporateEmail : SYSTEM_ACTOR_EMAIL),
      action: `Formally approved & sealed Pre-Purchase Order ${poNumber} awarded to ${vendorName} ($${Number(totalAmount).toLocaleString()}). Notes: ${approverNotes}`,
      rfqNumber,
    });

    // Notify the buyer of PO generation / award
    this.notifyBuyer(rfq.buyerAccountId || approverEmail, {
      kind: 'po_approved',
      title: `Pre-PO Approved — ${rfq.rfqNumber}`,
      message: `Pre-Purchase order ${poNumber} awarded to ${vendorName} (₹${Number(totalAmount).toLocaleString()}).`,
      meta: { poNumber, rfqNumber: rfq.rfqNumber, vendorId, vendorName, totalAmount },
    });

    // Notify the awarded vendor
    if (vendorId) {
      const vendorNotification = this._buildNotification({
        recipientType: 'vendor',
        recipientId: vendorId,
        kind: 'po_awarded',
        rfq,
        title: `Pre-Purchase Order Awarded — ${rfq.rfqNumber}`,
        message: `Congratulations! ${rfq.buyerAccountName || 'The buyer'} has approved and awarded pre-purchase order ${poNumber} to you.`,
        meta: { poNumber, rfqNumber: rfq.rfqNumber, totalAmount },
      });
      this.notifications.unshift(vendorNotification);
      this._persistNotification(vendorNotification);
    }

    return {
      success: true,
      poNumber,
      rfqNumber,
      vendorId: vendorId || null,
      vendorName,
      totalAmount,
      issueDate,
      // Real RFQ line items, not a hardcoded pump description — the PO
      // document should reflect what was actually procured.
      lineItems: (rfq.extractedEntities || []).map((ent) => ({
        description: ent.itemName,
        quantity: ent.quantity,
        unit: ent.unit,
      })),
      shaSignature: auditRecord.shaSignature,
    };
  }

  // ==========================================
  // 14. UNIFIED BOOTSTRAP DATA
  // ==========================================
  /**
   * Reference data the app needs to start up.
   * RFQs and AI Bot feed events are deliberately NOT here. This endpoint is anonymous,
   * and returning global arrays from it leaks one buyer's data onto another buyer's
   * dashboard. RFQs are fetched from GET /api/rfqs and follow-up alerts from
   * GET /api/ai-feed, which are both authenticated and org-scoped.
   *
   * `vendors` is capped: the real marketplace vendor directory reached 80k+
   * rows (a bulk Vendor Master import), and shipping all of them on every
   * single page load — anonymous or not — crashed the browser tab. Real
   * per-vendor lookups (GET /api/vendors, the paginated "All Vendors" invite
   * flow) are unaffected; only this anonymous startup payload is capped.
   * `sessionEmail`, when given, guarantees the caller's own vendor record is
   * present even if it falls outside the cap, since several screens resolve
   * "my own vendor" purely from this list (billing, opportunity feed).
   */
  async getBootstrapData(scopedBuyerId = null, sessionEmail = null) {
    const MAX_BOOTSTRAP_VENDORS = 500;
    let vendors;
    let vendorsTotal;

    // The common case (no buyer scoping — anonymous, vendor, CM, or admin
    // bootstrap) is answered straight from Postgres with LIMIT, the same way
    // the paginated vendors endpoint is: this used to call this.getVendors(),
    // which re-syncs (fetches + re-serializes) every row in the table on
    // every call. At 500 vendors that was unnoticeable; once the table
    // reached 80k+ (a bulk Vendor Master import), it meant every single page
    // load / login / refreshFromDB() call across the whole app re-fetched
    // the entire vendor table just to keep the first 500 — the same
    // performance disaster the CM's "Load more" pagination hit, just
    // triggered by something as ordinary as loading the app.
    if (!scopedBuyerId && pool.hasStorage()) {
      const page = await domainQueries.getVendorsPageFromDB({ limit: MAX_BOOTSTRAP_VENDORS, offset: 0, publicOnly: true });
      vendors = page.rows;
      vendorsTotal = page.total;
      if (sessionEmail) {
        const email = String(sessionEmail).toLowerCase();
        if (!vendors.some((v) => (v.email || '').toLowerCase() === email)) {
          const own = await domainQueries.getVendorByEmailFromDB(email);
          if (own) vendors = [own, ...vendors];
        }
      }
    } else if (scopedBuyerId && pool.hasStorage()) {
      // Own vendors first, unconditionally (a buyer's own vendor count is
      // realistically small, but still bounded via getVendorsByBuyerFromDB
      // rather than trusting that assumption) — the same "own vendors never
      // get pushed out of the window" rule the comment below used to
      // implement via a full in-memory sync. That in-memory sync
      // (this.getVendors(scopedBuyerId)) was a full unbounded re-fetch of
      // the ENTIRE vendors table on every single bootstrap call for every
      // buyer page load — confirmed live as the actual cause of D1's
      // free-tier daily row-read cap being exhausted (6.7M rows read in 24h
      // against a 20k-row table, via `wrangler d1 info`). Public vendors
      // only fill whatever room is left, fetched with the same bounded,
      // public-only page query the unscoped branch above already uses.
      const ownVendors = await domainQueries.getVendorsByBuyerFromDB(scopedBuyerId, MAX_BOOTSTRAP_VENDORS);
      const remaining = Math.max(0, MAX_BOOTSTRAP_VENDORS - ownVendors.length);
      const publicPage =
        remaining > 0
          ? await domainQueries.getVendorsPageFromDB({ limit: remaining, offset: 0, publicOnly: true })
          : { rows: [], total: 0 };
      vendors = [...ownVendors, ...publicPage.rows];
      vendorsTotal = ownVendors.length + publicPage.total;
      if (sessionEmail) {
        const email = String(sessionEmail).toLowerCase();
        if (!vendors.some((v) => (v.email || '').toLowerCase() === email)) {
          const own = await domainQueries.getVendorByEmailFromDB(email);
          if (own) vendors = [own, ...vendors];
        }
      }
    } else {
      // No DB configured: the in-memory-only fallback, a small enough set
      // that the full in-memory path is fine. Same own-first-then-cap
      // shape the DB-backed branches above apply, since there's no SQL
      // LIMIT to lean on here.
      const allVendors = await this.getVendors(scopedBuyerId);
      vendorsTotal = allVendors.length;
      const ownVendors = scopedBuyerId ? allVendors.filter((v) => v.buyerId === scopedBuyerId || v.buyerAccountId === scopedBuyerId) : [];
      const publicVendors = scopedBuyerId ? allVendors.filter((v) => !(v.buyerId === scopedBuyerId || v.buyerAccountId === scopedBuyerId)) : allVendors;
      vendors = [...ownVendors, ...publicVendors].slice(0, MAX_BOOTSTRAP_VENDORS);
      if (sessionEmail) {
        const email = String(sessionEmail).toLowerCase();
        if (!vendors.some((v) => (v.email || '').toLowerCase() === email)) {
          const own = allVendors.find((v) => (v.email || '').toLowerCase() === email);
          if (own) vendors = [own, ...vendors];
        }
      }
    }

    return {
      buyerAccounts: this.buyerAccounts,
      activeBuyerAccount: this.activeBuyerAccount,
      vendors,
      vendorsTotal,
      evaluations: this.evaluations,
      auditLogs: this.auditLogs,
      aiFeed: [],
      systemConfig: this.systemConfig,
      azureHealth: this.azureHealth,
      vendorCatalogue: this.vendorCatalogue,
    };
  }
}

// Global Singleton Instance for Node.js process
const storeService = new StoreService();

module.exports = storeService;
