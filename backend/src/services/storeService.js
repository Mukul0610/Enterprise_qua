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
const { getWaitUntil } = require('../db/d1Bridge');
const { createAuditEntry, verifyAuditTrail } = require('./auditService');
const { evaluateQuotes, calculate360Evaluation, calculateRevisedRating } = require('./evaluationService');
const { simulateChaserOutreach } = require('./aiChaserService');
// Called through the namespace so tests can stub the senders without rewiring
// storeService; every send is fire-and-forget and no-ops under test / when SMTP
// is unconfigured.
const mailerService = require('./mailerService');
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
      if (err && err.code === '23505') {
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
      source: vendorData.source || 'buyer_manual',
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
    const results = [];
    const toInsert = [];

    rows.forEach((row, idx) => {
      const email = (row.email || '').toLowerCase();
      // A row with no email can never collide on the vendors.email UNIQUE
      // constraint (Postgres never treats two NULLs as equal), so it is
      // never a duplicate — the checks below only apply to rows that
      // actually carry an email.
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
        // Date.now() alone collides constantly at chunk sizes in the
        // hundreds/thousands — many rows in the same forEach pass land in the
        // same millisecond, and a 4-char random suffix alone has a real
        // chance of repeating across a 1000-row batch (birthday paradox: at
        // n=1000 rows against ~1.68M possible suffixes, roughly a 1-in-4
        // chance per chunk). A collision hit vendors_pkey and failed the
        // WHOLE batched INSERT for every row in that chunk, not just the
        // colliding one. `idx` (this row's position in the batch) is unique
        // within a single call by construction, so it's included directly
        // rather than relying on chance.
        id: `v-bulk-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
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
    const target = this.vendors.find((v) => v.id === id);
    const beforeLen = this.vendors.length;
    this.vendors = this.vendors.filter((v) => v.id !== id);
    if (this.vendors.length < beforeLen) {
      this._removeVendor(id);
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
   * Check whether a vendor is eligible to submit a quotation for an RFQ.
   *
   * Initial allowance: Each vendor starts with 5 free quotation credits.
   * Once free credits are exhausted, an active paid subscription ('connect' or 'select')
   * is strictly required.
   */
  checkVendorQuotationEligibility(vendor) {
    if (!vendor) {
      return {
        eligible: false,
        reason: 'Vendor record not found',
        freeCreditsRemaining: 0,
        isSubscribed: false,
        subscriptionPlan: 'none',
      };
    }

    const freeCredits = vendor.freeQuotationCredits !== undefined
      ? Number(vendor.freeQuotationCredits)
      : VENDOR_FREE_CREDITS_LIMIT;

    const isSubscribed = Boolean(
      vendor.subscriptionPlan === 'connect' ||
      vendor.subscriptionPlan === 'select' ||
      vendor.isSubscribed === true ||
      vendor.subscriptionStatus === 'active'
    );

    const eligible = freeCredits > 0 || isSubscribed;

    return {
      eligible,
      freeCreditsRemaining: Math.max(0, freeCredits),
      isSubscribed,
      subscriptionPlan: vendor.subscriptionPlan || 'premium',
    };
  }

  /**
   * Deduct 1 quotation credit from a vendor after quotation submission on a new RFQ.
   * Resubmitting/updating a quote for the same RFQ does not consume an extra credit.
   * Subscribed vendors do not consume free credits below 0.
   */
  consumeVendorQuotationCredit(vendorId, rfqId) {
    const vendor = this.getVendorById(vendorId, 'all');
    if (!vendor) return null;

    const eligibility = this.checkVendorQuotationEligibility(vendor);
    const quotedRfqIds = Array.isArray(vendor.quotedRfqIds) ? [...vendor.quotedRfqIds] : [];
    const normalizedRfqId = rfqId ? String(rfqId).trim() : null;
    const alreadyQuoted = normalizedRfqId && quotedRfqIds.includes(normalizedRfqId);

    if (!alreadyQuoted && normalizedRfqId) {
      quotedRfqIds.push(normalizedRfqId);
    }

    let newCredits = eligibility.freeCreditsRemaining;
    if (!alreadyQuoted && !eligibility.isSubscribed) {
      newCredits = Math.max(0, eligibility.freeCreditsRemaining - 1);
    }

    vendor.freeQuotationCredits = newCredits;
    vendor.quotedRfqIds = quotedRfqIds;

    const updated = this.updateVendor(vendor.id, {
      freeQuotationCredits: newCredits,
      quotedRfqIds,
    });

    logger.info(
      `Quotation credit updated for vendor ${vendor.name || vendor.id}: remaining ${newCredits} (RFQ ${rfqId || 'N/A'}, subscribed: ${eligibility.isSubscribed})`,
      { vendorId: vendor.id, freeQuotationCredits: newCredits, isSubscribed: eligibility.isSubscribed },
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
  getRFQs() {
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
      // buyer had not set — and one that was already in the past.
      deadline: rfqData.deadline || rfqData.targetDeliveryDate || null,
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
        vendors: Array.isArray(rfqData.assignedVendors) ? rfqData.assignedVendors : [],
      },
    };

    // Category-based vendor invite for Version 1 (mode_1) and Version 2
    // (mode_2): every vendor whose major/minor category matches this RFQ is
    // merged into assignedVendors, in addition to whatever the client
    // already supplied (e.g. the buyer's own private roster). Reuses
    // candidateVendorsForRFQ (same category-match rule the CM's invite
    // picker uses) — this bypasses the invite-only requirement deliberately
    // for these two modes only.
    if (newRFQ.sourcingMode === 'mode_1' || newRFQ.sourcingMode === 'mode_2') {
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

      if (newRFQ.sourcingMode === 'mode_2' && newRFQ.deliveryPincode) {
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

    // In-app alert to every vendor whose category covers this RFQ, and an email
    // to the top matched vendors (same category, ranked by pincode + tier).
    this.notifyVendorsOfNewRFQ(newRFQ);
    this.emailRFQToMatchedVendors(newRFQ);

    return newRFQ;
  }

  updateRFQ(id, updates) {
    const idx = this.rfqs.findIndex((r) => r.id === id || r.rfqNumber === id);
    if (idx === -1) return null;

    let quotes = updates.quotes ? evaluateQuotes(updates.quotes) : this.rfqs[idx].quotes;

    const updated = {
      ...this.rfqs[idx],
      ...updates,
      quotes,
      quotesCount: quotes.length,
    };
    this.rfqs[idx] = updated;
    this._persistRFQ(updated);

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

    // 'Quotes Received' isn't a real RFQItem status (the type only allows
    // 'Parsing' | 'In Evaluation' | 'AI Recommended' | 'PO Generated' |
    // 'Quotes Pending') — writing it here left every quoted RFQ in a status
    // no screen recognises, so nothing ever showed the RFQ as under
    // evaluation once a vendor bid. 'In Evaluation' is the real state a
    // quote actually puts an RFQ into.
    rfq.quotes = quotes;
    rfq.quotesCount = quotes.length;

    const updated = this.updateRFQ(rfq.id, {
      quotes,
      quotesCount: quotes.length,
      status: rfq.status === 'PO Generated' ? 'PO Generated' : 'In Evaluation',
      followUpData,
    });

    // Tell the RFQ's owning buyer a quote has landed — in-app and by email.
    this.notifyBuyerOfQuote(rfq, quote);
    this.emailQuoteToBuyer(rfq, quote);

    return updated;
  }

  deleteRFQ(id) {
    const beforeLen = this.rfqs.length;
    this.rfqs = this.rfqs.filter((r) => r.id !== id && r.rfqNumber !== id);
    const removed = this.rfqs.length < beforeLen;
    if (removed) this._removeRFQ(id);
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

    // Same-buyer-company match alone used to grant a private-roster vendor
    // blanket access to every RFQ that buyer ever creates, regardless of
    // whether the vendor's own category has anything to do with the RFQ —
    // a Version 1 (Mode 1) RFQ for one category was reaching every vendor
    // the buyer had ever uploaded, not just the ones actually relevant to
    // it. Now also requires the vendor's own category to cover the RFQ,
    // same rule candidateVendorsForRFQ/vendorCoversCategory already apply
    // to the network-wide invite pool — a private roster relationship
    // grants eligibility, it never bypasses relevance.
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
   * same simulated multi-channel chaser outreach `createRFQ` fires for an
   * RFQ's initial assignedVendors, a real in-app notification, and a real
   * RFQ-invite email. Unknown vendor ids are silently skipped rather than
   * failing the whole batch.
   */
  async inviteVendorsToRFQ(rfqId, vendorIds, actorEmail) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    const existing = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    const newlyInvited = [];
    for (const id of Array.isArray(vendorIds) ? vendorIds : []) {
      let vendor = this.getVendorById(id);
      if (!vendor) {
        // this.vendors is a capped in-memory subset (see getVendorsPageFromDB's
        // own comment on why — 600k+ real vendors can't all live in memory),
        // but the CM's "All Vendors" picker searches D1 directly and can
        // surface an id that was never in that subset. Falls back to D1
        // before giving up, and caches the result so a repeat invite (or any
        // other in-memory lookup) finds it without another round trip.
        vendor = await domainQueries.getVendorByIdFromDB(id);
        if (vendor && !this.vendors.some((v) => v.id === vendor.id)) {
          this.vendors.push(vendor);
        }
      }
      if (!vendor) continue;
      if (this._isInvitedVendor(vendor, rfq)) continue;
      newlyInvited.push(vendor);
    }
    if (newlyInvited.length === 0) return { updatedRFQ: rfq, invitedCount: 0 };

    const entries = newlyInvited.map((v) => ({
      id: v.id,
      name: v.name,
      email: v.email || null,
      contactPerson: v.contactPerson || null,
      phone: v.phone || null,
    }));
    const updatedRFQ = this.updateRFQ(rfq.id, { assignedVendors: [...existing, ...entries] });

    this.addAuditLog({
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Invited ${newlyInvited.length} vendor(s) to ${rfq.rfqNumber}`,
      rfqNumber: rfq.rfqNumber,
    });

    for (const vendor of newlyInvited) {
      // Simulated multi-channel chaser outreach — same mechanism createRFQ
      // already fires for anyone on assignedVendors.
      const chaserLogs = simulateChaserOutreach(updatedRFQ, vendor);
      chaserLogs.forEach((log) => this.addAIFeedItem(log));

      // Real in-app notification, same shape notifyVendorsOfNewRFQ builds.
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

      // Real invite email, if the vendor has an address.
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

    return { updatedRFQ, invitedCount: newlyInvited.length };
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
    const notification = this._buildNotification({
      recipientType: 'buyer',
      recipientId: rfq.buyerAccountId,
      kind: 'quote_received',
      rfq,
      title: `New quote on ${rfq.rfqNumber}`,
      message: `${quote.vendorName || 'A vendor'} submitted a quote on ${rfq.rfqNumber} — ${rfq.title}.`,
      meta: {
        vendorId: quote.vendorId || null,
        vendorName: quote.vendorName || null,
        totalPrice: quote.totalPrice ?? null,
        unitPrice: quote.unitPrice ?? null,
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
    if (!rfq || rfq.status === 'Parsing' || rfq.status === 'Draft') {
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

  /** Email a submitted quote to the RFQ's owning buyer. Fired from addQuoteToRFQ. */
  emailQuoteToBuyer(rfq, quote) {
    if (!rfq.buyerAccountId) return false;
    const buyer = this.buyerAccounts.find((a) => a.id === rfq.buyerAccountId);
    if (!buyer || !buyer.corporateEmail) return false;
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

    vendorRecords.forEach((rec, idx) => {
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
        return;
      }

      // Check duplicates only within this buyer's scope (not global platform)
      // Require both email AND name to match for a duplicate
      const existing = this.vendors.find(
        (v) => v.buyerId === buyerId &&
          v.email && v.email.toLowerCase() === email.toLowerCase() &&
          v.name && v.name.toLowerCase() === name.toLowerCase()
      );
      if (existing) {
        if (existing.email && existing.onboardingEmailStatus !== 'sent') {
          const tempPassword = existing.tempPassword || this._generateTempPassword();
          const emailPayload = mailerService.buildVendorOnboardingEmail({
            to: existing.email,
            recipientName: existing.contactPerson || existing.name,
            buyerOrganizationName: attributedAccount ? attributedAccount.organizationName : 'Procucev Enterprise',
            vendorCode: existing.id,
            tempPassword: tempPassword,
            contactPhone: existing.phone,
          });
          mailerService.sendVendorIngestionEmail(emailPayload, 'onboarding')
            .then((delivery) => {
              if (delivery.sent) {
                this.updateVendor(existing.id, { onboardingEmailStatus: 'sent', tempPassword });
                logger.info(`Onboarding email sent for existing vendor ${existing.email}`, { vendorId: existing.id }, 'STORE_SERVICE');
              }
            })
            .catch((err) => {
              logger.error(`Error sending onboarding email to ${existing.email}`, err, 'STORE_SERVICE');
            });
        }
        return;
      }

      const minorCategories = Array.isArray(rec.minorCategories) ? rec.minorCategories : [];
      const newVendor = {
        id: `v-hist-${Date.now()}-${idx}`,
        buyerId: buyerId || null,
        buyerAccountId: buyerId || null,
        buyerEmail: buyerEmail || null,
        name,
        email,
        contactPerson: (rec.contactPerson || '').trim() || null,
        phone: (rec.phone || '').trim() || null,
        majorCategory: (rec.majorCategory || '').trim() || null,
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
      this._persistVendor(newVendor);
      createdThisRun.push({ row: idx + 1, vendor: newVendor });
      importedCount++;

      // Create identity database account for the vendor so they can log in —
      // but only if one doesn't already exist. insertVendorAccount resets
      // password+phone on an *existing* identity account (correct for the
      // CLI provisioning script it also serves; wrong here, where the row is
      // just a historical-purchase-dump entry that may well already have a
      // real login). Confirmed live: this exact class of call silently
      // clobbered a real vendor's password with a random one they were never
      // told, via bulkAddVendors' sibling path — see that fix's comment.
      // Checked up front (not just logged after the fact once
      // insertVendorAccount's own `result.created === false` came back,
      // which is what this used to do) so the reset never happens at all.
      if (newVendor.email) {
        // The whole sequence below is handed to waitUntil (via _background),
        // via a real async IIFE with genuine awaits — the previous version
        // used nested .then()/.catch() chains where the inner
        // insertVendorAccount/sendVendorIngestionEmail calls were never
        // returned from their enclosing .then() callback, so even wrapping
        // the outer promise wouldn't have covered them: the outer chain
        // resolved as soon as its synchronous body finished, not once the
        // inner unawaited calls actually completed. Confirmed live (same
        // root cause as addVendor's own onboarding call, see that comment):
        // a buyer-added vendor's identity account and onboarding email
        // silently never happened.
        this._background(
          (async () => {
            const existingIdentity = await identityQueries.findUserByEmail(newVendor.email).catch((err) => {
              logger.error(`Failed to check existing identity for ${newVendor.email}`, err, 'STORE_SERVICE');
              return null;
            });
            if (existingIdentity) {
              logger.info(
                `Skipped onboarding identity provisioning for ${newVendor.email}: an identity account already exists`,
                { vendorId: newVendor.id },
                'STORE_SERVICE'
              );
              return;
            }

            const tempPassword = this._generateTempPassword();

            try {
              const result = await identityQueries.insertVendorAccount({
                email: newVendor.email,
                password: tempPassword,
                phone: newVendor.phone || null,
                fullName: newVendor.contactPerson || newVendor.name,
                organizationName: newVendor.name,
                createdBy: 'vendor-ingestion',
              });
              if (result.created) {
                logger.info(`Vendor identity account created for ${newVendor.email}`, { vendorId: newVendor.id }, 'STORE_SERVICE');
              }
            } catch (err) {
              logger.error(`Failed to create vendor identity account for ${newVendor.email}`, err, 'STORE_SERVICE');
              return;
            }

            const emailPayload = mailerService.buildVendorOnboardingEmail({
              to: newVendor.email,
              recipientName: newVendor.contactPerson || newVendor.name,
              buyerOrganizationName: attributedAccount ? attributedAccount.organizationName : 'Procucev Enterprise',
              vendorCode: newVendor.id,
              tempPassword: tempPassword,
              contactPhone: newVendor.phone,
            });

            try {
              const delivery = await mailerService.sendVendorIngestionEmail(emailPayload, 'onboarding');
              if (delivery.sent) {
                this.updateVendor(newVendor.id, { onboardingEmailStatus: 'sent', tempPassword });
                logger.info(`Onboarding email sent to ${newVendor.email}`, { vendorId: newVendor.id }, 'STORE_SERVICE');
              } else {
                logger.warn(`Failed to send onboarding email to ${newVendor.email}`, { reason: delivery.reason }, 'STORE_SERVICE');
              }
            } catch (err) {
              logger.error(`Error sending onboarding email to ${newVendor.email}`, err, 'STORE_SERVICE');
            }
          })(),
          `Onboarding provisioning failed for ${newVendor.email}`
        );
      }
    });

    // Confirm each new vendor actually landed in Postgres before reporting
    // success for it — a row whose email collided with one from a different
    // buyer (or the marketplace directory) is rolled back here instead of
    // staying an in-memory-only phantom.
    for (const { row, vendor } of createdThisRun) {
      try {
        await this.confirmVendorPersisted(vendor);
      } catch (err) {
        this.vendors = this.vendors.filter((v) => v.id !== vendor.id);
        importedCount--;
        skipped.push({
          row,
          reason: err && err.statusCode === 409
            ? `A vendor with the email ${vendor.email} already exists.`
            : 'Could not be saved — try again.',
        });
      }
    }

    // Attributed to the requesting buyer's own account when the controller
    // resolved one from the session (same convention as createRFQ).
    this.addAuditLog({
      userEmail: attributedAccount ? attributedAccount.corporateEmail : SYSTEM_ACTOR_EMAIL,
      action: `Processed ${period.replace('_', ' ')} historical purchase dump: ${importedCount} supplier(s) empanelled, ${skipped.length} row(s) rejected as unidentifiable.`,
    });

    return {
      success: true,
      importedCount,
      skippedCount: skipped.length,
      skipped,
      period,
      totalVendors: this.vendors.length,
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
    const vendor = this.getVendorById(vendorId);
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
      action: `Formally approved & sealed Purchase Order ${poNumber} awarded to ${vendorName} ($${Number(totalAmount).toLocaleString()}). Notes: ${approverNotes}`,
      rfqNumber,
    });

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
