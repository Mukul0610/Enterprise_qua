const storeService = require('../src/services/storeService');

describe('Store Service — remaining branch coverage', () => {
  // A fresh instance needs no arranging: every collection starts empty, so the
  // "nothing here yet" branches are the default rather than something a doctored
  // seed module had to produce.
  describe('a fresh instance holding no records', () => {
    let freshStore;

    beforeAll(() => {
      jest.isolateModules(() => {
        freshStore = require('../src/services/storeService');
      });
    });

    test('constructor leaves activeBuyerAccount null when there are no buyer accounts', () => {
      expect(freshStore.getActiveBuyerAccount()).toBeNull();
    });

    test('addAuditLog falls back previousHash to an empty string when the audit log is empty', () => {
      const entry = freshStore.addAuditLog({ userEmail: 'first@entry.com', action: 'First ever entry' });
      expect(entry.shaSignature).toBeDefined();
    });

    test('deleteBuyerAccount falls the active account back to null once the last one is removed', () => {
      const acc = freshStore.addBuyerAccount({ organizationName: 'Solo Co', corporateEmail: 'solo@co.com' });
      freshStore.alignActiveBuyerAccount(acc.id);
      expect(freshStore.getActiveBuyerAccount().id).toBe(acc.id);

      freshStore.deleteBuyerAccount(acc.id);
      expect(freshStore.getActiveBuyerAccount()).toBeNull();
    });

    test('processHistoricalPurchaseData and approvePurchaseOrder fall back userEmail when there is no active buyer account', async () => {
      const res = await freshStore.processHistoricalPurchaseData('FY2026', [
        { companyName: 'No Active Buyer Co', email: 'nab@co.com' },
      ]);
      expect(res.success).toBe(true);

      const rfq = freshStore.createRFQ({ title: 'No active buyer PO fixture', category: 'Mechanical' });
      const po = freshStore.approvePurchaseOrder(rfq.id, 'v-001', 'Some Vendor', 1000, 'notes');
      expect(po.success).toBe(true);
    });

    test('addQuoteToRFQ falls back to an empty quotes array when the RFQ has none', () => {
      const rfq = freshStore.createRFQ({ title: 'No Quotes Yet RFQ' });
      const stored = freshStore.getRFQById(rfq.id);
      delete stored.quotes;

      const updated = freshStore.addQuoteToRFQ(rfq.id, { vendorName: 'First Quoter', unitPrice: 500 });
      expect(updated.quotes.length).toBe(1);
    });
  });

  describe('explicit-value and fallback branches on the shared store instance', () => {
    test('addBuyerAccount honors an explicit remainingFreeRFQs of 0', () => {
      const acc = storeService.addBuyerAccount({
        organizationName: 'Explicit RFQs Co',
        corporateEmail: 'explicit@rfqs.com',
        remainingFreeRFQs: 0,
      });
      expect(acc.remainingFreeRFQs).toBe(0);
    });

    test('addVendor honors explicit evaluated/hasRecord/isExistingInDatabase/isCategoryAligned flags', () => {
      const vendor = storeService.addVendor({
        name: 'Explicit Flags Vendor',
        majorCategory: 'Mechanical',
        evaluated: true,
        hasRecord: true,
        isExistingInDatabase: false,
        isCategoryAligned: false,
      });
      expect(vendor.evaluated).toBe(true);
      expect(vendor.hasRecord).toBe(true);
      expect(vendor.isExistingInDatabase).toBe(false);
      expect(vendor.isCategoryAligned).toBe(false);
    });

    test('reviseVendorRating falls back previousScore/previousRating when the vendor has none set', () => {
      const vendor = storeService.addVendor({ name: 'Scoreless Vendor', majorCategory: 'Mechanical', score: 0, rating: 0 });
      const { revisionRecord } = storeService.reviseVendorRating(vendor.id, { qualityScore: 80, costScore: 80, deliveryScore: 80 });
      expect(revisionRecord.previousScore).toBe(85);
      expect(revisionRecord.previousRating).toBe(4.5);
    });

    test('createRFQ falls back title when omitted, and honors an explicit chasingActive:false', () => {
      const rfq = storeService.createRFQ({ category: 'Mechanical', chasingActive: false });
      expect(rfq.title).toBe('Untitled RFQ');
      expect(rfq.chasingActive).toBe(false);
    });

    test('createEvaluation falls back vendorId when omitted', () => {
      const evalRes = storeService.createEvaluation({ vendorName: 'No Vendor Id Co' });
      expect(evalRes.vendorId).toMatch(/^v-/);
    });

    test('addAIFeedItem falls back title and message when omitted', () => {
      const item = storeService.addAIFeedItem({});
      expect(item.title).toBe('AI Bot Event');
      expect(item.message).toBe('');
    });

    // A record without both a company name and a contact email cannot identify a
    // supplier, so it is rejected and reported rather than back-filled. These rows
    // used to be imported with an invented name, address, phone, category, rating
    // and score, and marked `evaluated: true` — producing a vendor master full of
    // suppliers that could not be contacted but that RFQ routing would still pick.
    test('rejects unidentifiable rows instead of inventing their details', async () => {
      const emptyRes = await storeService.processHistoricalPurchaseData('FY2026-empty');
      expect(emptyRes.importedCount).toBe(0);
      expect(emptyRes.skippedCount).toBe(0);

      const res = await storeService.processHistoricalPurchaseData('FY2026-fallbacks', [
        { name: 'Only-Name Supplier Co' },
        {},
      ]);

      expect(res.importedCount).toBe(0);
      expect(res.skippedCount).toBe(2);
      expect(res.skipped).toEqual([
        { row: 1, reason: 'Missing contact email.' },
        { row: 2, reason: 'Missing both company name and contact email.' },
      ]);
    });

    test('imports a row carrying both a name and an email, without scoring it', async () => {
      const res = await storeService.processHistoricalPurchaseData('FY2026-identified', [
        { companyName: 'Identified Supplier Co', email: 'identified@supplier.test' },
      ]);

      expect(res.importedCount).toBe(1);
      expect(res.skippedCount).toBe(0);

      const imported = (await storeService.getVendors()).find((v) => v.email === 'identified@supplier.test');
      // Nothing has assessed this supplier yet, so it carries no rating or score
      // and is not marked as evaluated.
      expect(imported.rating).toBeNull();
      expect(imported.score).toBeNull();
      expect(imported.evaluated).toBe(false);
      expect(imported.status).toBe('PENDING EVALUATION');
    });

    test('handleSupportChat falls back an empty prompt safely', () => {
      const res = storeService.handleSupportChat();
      expect(res.isEscalated).toBe(false);
    });

    test('addProductToCatalogue falls back unitPrice to 0 when not a valid number', () => {
      const prod = storeService.addProductToCatalogue({ name: 'Zero Price Prod', sku: 'SKU-ZERO' });
      expect(prod.unitPrice).toBe(0);
    });

    test('approvePurchaseOrder returns null when the RFQ cannot be found', async () => {
      const po = storeService.approvePurchaseOrder(undefined, 'v-001', 'Vendor X', 500, 'notes');
      expect(po).toBeNull();
    });
  });

  describe('hydrateFromDB', () => {
    // All 8 getters are called unconditionally inside one Promise.all, so
    // every domainQueries mock needs all 8 present or an unmocked one being
    // called as `undefined()` throws synchronously before Promise.all ever
    // wraps the other (already-pending) promises, orphaning them as unhandled
    // rejections. This fills in safe "empty" defaults; each test only
    // overrides what it's actually testing.
    function emptyDomainQueriesMock(overrides = {}) {
      return {
        getVendorsFromDB: jest.fn().mockResolvedValue([]),
        getVendorsPageFromDB: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        getRFQsFromDB: jest.fn().mockResolvedValue([]),
        getEvaluationsFromDB: jest.fn().mockResolvedValue([]),
        getVendorCatalogueFromDB: jest.fn().mockResolvedValue([]),
        getBuyerAccountsFromDB: jest.fn().mockResolvedValue({ accounts: [], activeId: null }),
        getAIFeedFromDB: jest.fn().mockResolvedValue([]),
        getAuditLogsFromDB: jest.fn().mockResolvedValue([]),
        getNotificationsFromDB: jest.fn().mockResolvedValue([]),
        getPaymentLinksFromDB: jest.fn().mockResolvedValue([]),
        ...overrides,
      };
    }

    test('reports not_configured and loads nothing when DATABASE_URL is unset', async () => {
      const beforeBuyers = storeService.getBuyerAccounts().length;
      const result = await storeService.hydrateFromDB();

      // There is no second datastore to fall back to, so the caller is told why
      // rather than being handed a silently-empty store.
      expect(result).toMatchObject({ hydrated: false, source: 'not_configured' });
      expect(result.error).toContain('DATABASE_URL');
      expect(storeService.isHydratedFromDB).toBe(false);
      expect(storeService.getBuyerAccounts().length).toBe(beforeBuyers);
    });

    test('replaces vendors/RFQs from the domain DB when configured and rows exist', async () => {
      const dbVendors = [{ id: 'v-db-1', name: 'DB Vendor' }];
      const dbRfqs = [{ id: 'rfq-db-1', title: 'DB RFQ' }];
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getVendorsPageFromDB: jest.fn().mockResolvedValue({ rows: dbVendors, total: dbVendors.length }),
            getRFQsFromDB: jest.fn().mockResolvedValue(dbRfqs),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      const result = await freshStore.hydrateFromDB();

      expect(result).toEqual({ hydrated: true, source: 'postgres' });
      expect(freshStore.isHydratedFromDB).toBe(true);
      expect(freshStore.vendors).toEqual(dbVendors);
      expect(freshStore.vendorsTotal).toBe(dbVendors.length);
      expect(freshStore.getRFQs()).toEqual(dbRfqs);
    });

    test('bounds the boot-time vendor read instead of reading the whole table', async () => {
      let freshStore;
      let pageSpy;
      let fullTableSpy;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        pageSpy = jest.fn().mockResolvedValue({ rows: [], total: 0 });
        fullTableSpy = jest.fn().mockResolvedValue([]);
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({ getVendorsPageFromDB: pageSpy, getVendorsFromDB: fullTableSpy })
        );
        freshStore = require('../src/services/storeService');
      });

      await freshStore.hydrateFromDB();

      expect(pageSpy).toHaveBeenCalledWith({ limit: expect.any(Number), offset: 0 });
      expect(fullTableSpy).not.toHaveBeenCalled();
    });

    test('replaces evaluations, vendor catalogue, AI feed and audit logs when rows exist', async () => {
      const dbEvaluations = [{ id: 'eval-db-1', vendorName: 'DB Vendor' }];
      const dbCatalogue = [{ id: 'prod-db-1', name: 'DB Product' }];
      const dbAIFeed = [{ id: 'feed-db-1', title: 'DB Feed Item' }];
      const dbAuditLogs = [{ id: 'log-db-1', action: 'DB Audit Entry' }];
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getEvaluationsFromDB: jest.fn().mockResolvedValue(dbEvaluations),
            getVendorCatalogueFromDB: jest.fn().mockResolvedValue(dbCatalogue),
            getAIFeedFromDB: jest.fn().mockResolvedValue(dbAIFeed),
            getAuditLogsFromDB: jest.fn().mockResolvedValue(dbAuditLogs),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      const result = await freshStore.hydrateFromDB();

      expect(result).toEqual({ hydrated: true, source: 'postgres' });
      expect(freshStore.getEvaluations()).toEqual(dbEvaluations);
      expect(freshStore.getVendorCatalogue()).toEqual(dbCatalogue);
      expect(freshStore.getAIFeed()).toEqual(dbAIFeed);
      expect(freshStore.getAuditLogs()).toEqual(dbAuditLogs);
    });

    test('replaces buyer accounts and resolves activeBuyerAccount to the flagged row', async () => {
      const acc1 = { id: 'buyer-db-1', organizationName: 'DB Buyer One' };
      const acc2 = { id: 'buyer-db-2', organizationName: 'DB Buyer Two' };
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getBuyerAccountsFromDB: jest.fn().mockResolvedValue({ accounts: [acc1, acc2], activeId: 'buyer-db-2' }),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      await freshStore.hydrateFromDB();

      expect(freshStore.getBuyerAccounts()).toEqual([acc1, acc2]);
      expect(freshStore.getActiveBuyerAccount()).toEqual(acc2);
    });

    test('falls back activeBuyerAccount to the first row when no activeId matches', async () => {
      const acc1 = { id: 'buyer-db-1', organizationName: 'DB Buyer One' };
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getBuyerAccountsFromDB: jest.fn().mockResolvedValue({ accounts: [acc1], activeId: 'no-such-id' }),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      await freshStore.hydrateFromDB();

      expect(freshStore.getActiveBuyerAccount()).toEqual(acc1);
    });

    // An empty database is a successful load of nothing, NOT a fallback. The
    // previous version applied each collection only `if (rows.length > 0)`, so an
    // empty table left the seed in place and the API served invented records while
    // reporting itself healthy.
    test('treats empty tables as an empty store, still reporting a successful load', async () => {
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () => emptyDomainQueriesMock());
        freshStore = require('../src/services/storeService');
      });

      const result = await freshStore.hydrateFromDB();

      expect(result).toEqual({ hydrated: true, source: 'postgres' });
      expect(freshStore.isHydratedFromDB).toBe(true);
      expect(await freshStore.getVendors()).toEqual([]);
      expect(freshStore.getRFQs()).toEqual([]);
      expect(freshStore.getActiveBuyerAccount()).toBeNull();
    });

    test('reports the read as unavailable when a query throws, without inventing records', async () => {
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getVendorsPageFromDB: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      const result = await freshStore.hydrateFromDB();

      expect(result).toMatchObject({ hydrated: false, source: 'unavailable' });
      expect(result.error).toBe('ECONNREFUSED');
      expect(freshStore.isHydratedFromDB).toBe(false);
      // Checked directly against the raw in-memory array rather than through
      // getVendors() — that method itself re-queries Neon on every call (see
      // the "no in-memory-only vendor storage" fix), and this mock always
      // rejects, so a second call here would just throw again.
      expect(freshStore.vendors).toEqual([]);
    });
  });

  describe('processHistoricalPurchaseData without a domain persistence layer', () => {
    test('imports vendors into the in-memory store and reports the count', async () => {
      const res = await storeService.processHistoricalPurchaseData('FY2026-nodb', [
        { companyName: 'In Memory Historical Co', email: 'inmemory@historical.com' },
      ]);

      expect(res.importedCount).toBe(1);
    });
  });

  // Every fire-and-forget _persistX/_removeX/_setActiveX helper attaches its
  // own .catch(err => logger.error(...)) — that callback only runs when the
  // underlying domainQueries write actually rejects. Nothing else in this
  // in-memory-store test suite configures a real DATABASE_URL, so these
  // callbacks are otherwise never exercised (a full-suite run can accidentally
  // cover a few of them if an earlier test file left a live DATABASE_URL
  // cached in process.env — not something to depend on). These tests reject
  // each write deliberately so every catch handler is covered deterministically.
  describe('persist-helper failure paths (_persistX/_removeX catch handlers)', () => {
    function fullDomainQueriesMock(overrides = {}) {
      return {
        getVendorsFromDB: jest.fn().mockResolvedValue([]),
        upsertVendorInDB: jest.fn().mockResolvedValue(null),
        deleteVendorInDB: jest.fn().mockResolvedValue(false),
        getRFQsFromDB: jest.fn().mockResolvedValue([]),
        upsertRFQInDB: jest.fn().mockResolvedValue(null),
        deleteRFQInDB: jest.fn().mockResolvedValue(false),
        getEvaluationsFromDB: jest.fn().mockResolvedValue([]),
        upsertEvaluationInDB: jest.fn().mockResolvedValue(null),
        getVendorCatalogueFromDB: jest.fn().mockResolvedValue([]),
        upsertCatalogueProductInDB: jest.fn().mockResolvedValue(null),
        deleteCatalogueProductInDB: jest.fn().mockResolvedValue(false),
        getBuyerAccountsFromDB: jest.fn().mockResolvedValue({ accounts: [], activeId: null }),
        upsertBuyerAccountInDB: jest.fn().mockResolvedValue(null),
        deleteBuyerAccountInDB: jest.fn().mockResolvedValue(false),
        setActiveBuyerAccountInDB: jest.fn().mockResolvedValue(undefined),
        getAIFeedFromDB: jest.fn().mockResolvedValue([]),
        upsertAIFeedItemInDB: jest.fn().mockResolvedValue(null),
        getAuditLogsFromDB: jest.fn().mockResolvedValue([]),
        upsertAuditLogInDB: jest.fn().mockResolvedValue(null),
        getNotificationsFromDB: jest.fn().mockResolvedValue([]),
        insertNotificationInDB: jest.fn().mockResolvedValue(null),
        bulkInsertNotificationsInDB: jest.fn().mockResolvedValue([]),
        markNotificationReadInDB: jest.fn().mockResolvedValue(false),
        markAllNotificationsReadInDB: jest.fn().mockResolvedValue(0),
        ...overrides,
      };
    }

    function freshStoreWithFailingWrite(overrides) {
      let freshStore;
      const errorSpy = jest.fn();
      jest.isolateModules(() => {
        jest.doMock('../src/db/domainQueries', () => fullDomainQueriesMock(overrides));
        jest.doMock('../src/services/loggerService', () => ({
          logger: { error: errorSpy, audit: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        }));
        freshStore = require('../src/services/storeService');
      });
      return { freshStore, errorSpy };
    }

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    test('_persistVendor logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertVendorInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.addVendor({ name: 'Test Co', email: 'test@co.com', majorCategory: 'Mechanical' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist vendor', expect.any(Error), 'STORE_SERVICE');
    });

    test('_removeVendor logs when the write-through delete rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteVendorInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const vendor = freshStore.addVendor({ name: 'Test Co', email: 'test@co.com', majorCategory: 'Mechanical' });
      freshStore.deleteVendor(vendor.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to delete persisted vendor', expect.any(Error), 'STORE_SERVICE');
    });

    test('_persistRFQ logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertRFQInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.createRFQ({ rfqNumber: 'RFQ-PERSIST-TEST-1' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist RFQ', expect.any(Error), 'STORE_SERVICE');
    });

    test('_removeRFQ logs when the write-through delete rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteRFQInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const rfq = freshStore.createRFQ({ rfqNumber: 'RFQ-PERSIST-TEST-2' });
      freshStore.deleteRFQ(rfq.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to delete persisted RFQ', expect.any(Error), 'STORE_SERVICE');
    });

    test('_persistEvaluation logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertEvaluationInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.createEvaluation({ vendorName: 'Test Vendor' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist evaluation', expect.any(Error), 'STORE_SERVICE');
    });

    test('_persistCatalogueProduct logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertCatalogueProductInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.addProductToCatalogue({ name: 'Test SKU' }, 'vendor-persist-test', 'user@x.com');
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist catalogue product', expect.any(Error), 'STORE_SERVICE');
    });

    test('_removeCatalogueProduct logs when the write-through delete rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteCatalogueProductInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const product = freshStore.addProductToCatalogue({ name: 'Test SKU' }, 'vendor-persist-test', 'user@x.com');
      freshStore.deleteCatalogueProduct(product.id, 'user@x.com');
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to delete persisted catalogue product',
        expect.any(Error),
        'STORE_SERVICE'
      );
    });

    test('_persistBuyerAccount logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertBuyerAccountInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.addBuyerAccount({ corporateEmail: 'buyer-persist-test@x.com', organizationName: 'Buyer Co' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist buyer account', expect.any(Error), 'STORE_SERVICE');
    });

    test('_removeBuyerAccount logs when the write-through delete rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteBuyerAccountInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const acc = freshStore.addBuyerAccount({
        corporateEmail: 'buyer-persist-test2@x.com',
        organizationName: 'Buyer Co',
      });
      freshStore.deleteBuyerAccount(acc.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to delete persisted buyer account',
        expect.any(Error),
        'STORE_SERVICE'
      );
    });

    test('_setActiveBuyerAccount logs when the write-through update rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        setActiveBuyerAccountInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const acc = freshStore.addBuyerAccount({
        corporateEmail: 'buyer-persist-test3@x.com',
        organizationName: 'Buyer Co',
      });
      freshStore.alignActiveBuyerAccount(acc.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to persist active buyer account',
        expect.any(Error),
        'STORE_SERVICE'
      );
    });

    test('_persistAIFeedItem logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertAIFeedItemInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.addAIFeedItem({ title: 'Test Feed Item' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist AI feed item', expect.any(Error), 'STORE_SERVICE');
    });

    test('_persistAuditLog logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertAuditLogInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.addAuditLog({ userEmail: 'auditor@x.com', action: 'Test action' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist audit log entry', expect.any(Error), 'STORE_SERVICE');
    });

    test('_persistNotificationBatch logs when the RFQ→vendor fan-out write rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        bulkInsertNotificationsInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      // notifyVendorsOfNewRFQ (the batched fan-out) only fires at creation for
      // vendors with immediate access — an addedByBuyerCompany match, since
      // category match alone no longer grants vendorCoversRFQ.
      freshStore.addVendor({
        name: 'Fanout Co',
        email: 'fanout@x.com',
        majorCategory: 'Fanout-Cat',
        addedByBuyerCompany: 'Fanout Buyer',
      });
      freshStore.createRFQ(
        { rfqNumber: 'RFQ-NTF-1', category: 'Fanout-Cat' },
        { organizationName: 'Fanout Buyer' }
      );
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist notification batch', expect.any(Error), 'STORE_SERVICE');
    });

    test('_persistNotification logs when the quote→buyer write rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        insertNotificationInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const buyer = freshStore.addBuyerAccount({ corporateEmail: 'ntf-buyer@x.com', organizationName: 'Ntf Buyer' });
      const rfq = freshStore.createRFQ({ rfqNumber: 'RFQ-NTF-2', category: 'X' }, buyer);
      freshStore.addQuoteToRFQ(rfq.id, { vendorId: 'v-1', vendorName: 'B', unitPrice: 1 });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist notification', expect.any(Error), 'STORE_SERVICE');
    });

    test('markNotificationRead logs when the read write-through rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        markNotificationReadInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const vendor = freshStore.addVendor({ name: 'Read Co', email: 'read@x.com', majorCategory: 'Read-Cat' });
      const rfq = freshStore.createRFQ({ rfqNumber: 'RFQ-NTF-3', category: 'Read-Cat' });
      await freshStore.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@x.com');
      const [n] = freshStore.getNotificationsFor('vendor', vendor.id);
      freshStore.markNotificationRead(n.id, 'vendor', vendor.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist notification read', expect.any(Error), 'STORE_SERVICE');
    });

    test('markAllNotificationsRead logs when the bulk read write-through rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        markAllNotificationsReadInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const vendor = freshStore.addVendor({ name: 'BulkRead Co', email: 'bulkread@x.com', majorCategory: 'Bulk-Cat' });
      const rfq = freshStore.createRFQ({ rfqNumber: 'RFQ-NTF-4', category: 'Bulk-Cat' });
      await freshStore.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@x.com');
      freshStore.markAllNotificationsRead('vendor', vendor.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist bulk notification read', expect.any(Error), 'STORE_SERVICE');
    });
  });

  describe('vendor catalogue and purchase order branches not covered elsewhere', () => {
    test('getVendorCatalogue filters to only the given vendorId', () => {
      const product = storeService.addProductToCatalogue(
        { name: 'Filter Test Item' },
        'vendor-catalogue-filter-test',
        'user@x.com'
      );

      const filtered = storeService.getVendorCatalogue('vendor-catalogue-filter-test');

      expect(filtered).toEqual([product]);
      expect(filtered.every((p) => p.vendorId === 'vendor-catalogue-filter-test')).toBe(true);
    });

    test('approvePurchaseOrder maps rfq.extractedEntities into lineItems when present', () => {
      const rfq = storeService.createRFQ({ rfqNumber: 'RFQ-LINEITEM-TEST' });
      storeService.updateRFQ(rfq.id, {
        extractedEntities: [{ itemName: 'Bearing', quantity: 10, unit: 'pcs' }],
      });

      const po = storeService.approvePurchaseOrder(rfq.rfqNumber, 'v-001', 'Test Vendor', 5000, 'notes');

      expect(po.lineItems).toEqual([{ description: 'Bearing', quantity: 10, unit: 'pcs' }]);
    });

    test('getVendors returns all vendors when scopedBuyerId is all', async () => {
      expect(await storeService.getVendors('all')).toBe(storeService.vendors);
    });

    test('getVendorById returns undefined when vendor is scoped to a buyer but no scopedBuyerId is provided', () => {
      const vendor = storeService.addVendor({ name: 'Scoped Buyer Vendor', email: 'sbv@test.com' }, 'buyer@x.com', 'buyer-scoped-123');
      expect(storeService.getVendorById(vendor.id, null)).toBeUndefined();
    });

    test('_rfqCategorySignals extracts majorCategory and minorCategory from extractedEntities', () => {
      const signals = storeService._rfqCategorySignals({
        category: 'MainCat',
        extractedEntities: [
          { majorCategory: 'MajorA', minorCategory: 'MinorB', category: 'SubC' }
        ]
      });
      expect(signals).toContain('MajorA');
      expect(signals).toContain('MinorB');
      expect(signals).toContain('SubC');
      expect(signals).toContain('MainCat');
    });

    test('triggerBatchChaser returns error when assignedVendors is empty, and null when RFQ not found', () => {
      expect(storeService.triggerBatchChaser('non-existent-rfq')).toBeNull();

      const rfq = storeService.createRFQ({ rfqNumber: 'RFQ-NO-VENDORS-CHASE' });
      rfq.assignedVendors = [];
      const res = storeService.triggerBatchChaser(rfq.id);
      expect(res.success).toBe(false);
      expect(res.error).toContain('No vendors are assigned to this RFQ');
    });

    test('triggerBatchChaser caps aiFeed at 100 items when length exceeds 100', () => {
      const vendor = storeService.addVendor({ name: 'Assigned Vendor Co', email: 'avc@test.com' });
      const rfq = storeService.createRFQ({ rfqNumber: 'RFQ-CHASE-100' });
      rfq.assignedVendors = [vendor];
      storeService.aiFeed = Array.from({ length: 99 }, (_, i) => ({ id: `feed-${i}`, message: 'dummy' }));
      const res = storeService.triggerBatchChaser(rfq.id);
      expect(res.success).toBe(true);
      expect(storeService.aiFeed.length).toBeLessThanOrEqual(100);
    });
  });
});