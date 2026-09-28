const rootResolvers = require('../src/graphql/resolvers');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const domainPool = require('../src/db/pool');
const { getTestToken, TEST_USERS } = require('./testHelpers');

function contextFor(role) {
  return { req: { headers: { authorization: `Bearer ${getTestToken(role)}` } } };
}

// Every session-gated resolver is async: revocation is read from the database, so
// requireAuth/requireAdmin/requireRfqReadScope all await. A rejected promise is
// NOT a synchronous throw — asserting one with `expect(() => ...).toThrow()`
// leaves the rejection unhandled, which crashes the Jest worker outright rather
// than failing the test. Every such assertion below therefore uses
// `.rejects.toThrow()`.
//
// The unauthenticated read resolvers (vendors, vendor, buyerAccounts,
// activeBuyerAccount, evaluations, auditLogs, catalogue, aiFeed, systemConfig)
// are deliberately still synchronous and are called directly.
describe('GraphQL Resolvers Direct Unit Tests', () => {
  let seededRfq;

  beforeEach(() => {
    // A real buyer account for TEST_USERS.buyer.email, so requireRfqReadScope's
    // filtering (getBuyerAccountByEmail) has something real to scope against.
    const account = storeService.addBuyerAccount({
      organizationName: 'Resolver Fixture Org',
      corporateEmail: TEST_USERS.buyer.email,
    });
    seededRfq = storeService.createRFQ(
      {
        title: 'Resolver Fixture RFQ',
        category: 'Engineering Spares - Mechanical',
        sourcingMode: 'mode_1',
        status: 'Quotes Pending',
        budget: 1000,
      },
      account
    );
  });

  // RFQ resolvers require a session, so an anonymous call is rejected before it
  // ever reads the store.
  test('rfqs resolver refuses an anonymous call', async () => {
    await expect(rootResolvers.rfqs({}, undefined)).rejects.toThrow();
    await expect(rootResolvers.rfqs({}, {})).rejects.toThrow();
  });

  test('rfqs resolver filters by category, sourcingMode, and status', async () => {
    const context = contextFor('buyer');

    const all = await rootResolvers.rfqs({}, context);
    expect(all.length).toBeGreaterThan(0);

    const filtered = await rootResolvers.rfqs(
      { category: 'Spares', sourcingMode: 'mode_1', status: 'Quotes Pending', limit: 5, offset: 0 },
      context
    );
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered).toHaveLength(1);

    // A filter that matches nothing returns empty rather than falling back to all.
    const none = await rootResolvers.rfqs({ category: 'Nothing Matches This' }, context);
    expect(none).toEqual([]);
  });

  test('rfq resolver searches by id and rfqNumber or returns null', async () => {
    const context = contextFor('buyer');

    expect(await rootResolvers.rfq({ id: seededRfq.id }, context)).toEqual(seededRfq);
    expect(await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, context)).toEqual(seededRfq);
    expect(await rootResolvers.rfq({ id: 'non-existent-id' }, context)).toBeNull();
    expect(await rootResolvers.rfq({}, context)).toBeNull();
  });

  // Category managers/admins are deliberately unrestricted (they need the full
  // cross-buyer list — see resolvers.js's requireRfqReadScope), so the buyer-only
  // scoping case needs a second real buyer identity.
  test('rfq resolvers scope a buyer to their own account', async () => {
    storeService.addBuyerAccount({
      organizationName: 'Other Buyer Org',
      corporateEmail: TEST_USERS.category_manager.email,
    });
    const otherBuyerCtx = contextFor('category_manager');
    // A buyer with no account of its own exercises the "no match" branch.
    const unlinkedBuyerToken = require('../src/services/authService').generateSessionToken({
      id: 'usr-unlinked-buyer',
      email: 'unlinked-buyer@procucev.com',
      name: 'Unlinked Buyer',
      role: 'buyer',
    });
    const unlinkedBuyerCtx = { req: { headers: { authorization: `Bearer ${unlinkedBuyerToken}` } } };

    expect(await rootResolvers.rfqs({}, unlinkedBuyerCtx)).toEqual([]);
    expect(await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, unlinkedBuyerCtx)).toBeNull();
    // category_manager is unrestricted, so it does see the fixture RFQ.
    expect(await rootResolvers.rfqs({}, otherBuyerCtx)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: seededRfq.id })])
    );
  });

  test('rfq resolvers scope a vendor to RFQs they were invited to — category match alone is not enough', async () => {
    // A vendor covering the fixture RFQ's category doesn't see it until a
    // category manager invites them onto it.
    const coveringVendor = storeService.addVendor({
      name: 'Covering Resolver Vendor',
      email: TEST_USERS.vendor.email,
      majorCategory: 'Engineering Spares - Mechanical',
    });
    const coveringCtx = contextFor('vendor');
    expect(await rootResolvers.rfqs({}, coveringCtx)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: seededRfq.id })])
    );
    expect(await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, coveringCtx)).toBeNull();

    await storeService.inviteVendorsToRFQ(seededRfq.id, [coveringVendor.id], TEST_USERS.category_manager.email);
    expect(await rootResolvers.rfqs({}, coveringCtx)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: seededRfq.id })])
    );
    expect((await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, coveringCtx))?.id).toEqual(seededRfq.id);

    const orphanVendorToken = require('../src/services/authService').generateSessionToken({
      id: 'usr-orphan-resolver-vendor',
      email: 'orphan-resolver-vendor@nowhere.test',
      name: 'Orphan',
      role: 'vendor',
    });
    const orphanCtx = { req: { headers: { authorization: `Bearer ${orphanVendorToken}` } } };
    expect(await rootResolvers.rfqs({}, orphanCtx)).toEqual([]);
    expect(await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, orphanCtx)).toBeNull();
  });

  test('vendors resolver filters by majorCategory, source, search and pagination', async () => {
    // Registered here because nothing is seeded: the roster is empty until a
    // vendor is actually created.
    storeService.addVendor({
      name: 'Resolver Filter Vendor',
      email: 'filter@resolver-vendor.test',
      majorCategory: 'Engineering Spares - Mechanical',
      source: 'buyer_manual',
    });

    const all = await rootResolvers.vendors();
    expect(all.length).toBeGreaterThan(0);

    const byCat = await rootResolvers.vendors({ majorCategory: 'Mechanical' });
    expect(byCat.length).toBeGreaterThan(0);

    const bySource = await rootResolvers.vendors({ source: 'buyer_manual' });
    expect(bySource.length).toBeGreaterThan(0);

    const bySearchName = await rootResolvers.vendors({ search: 'Resolver Filter' });
    expect(bySearchName.length).toBeGreaterThan(0);

    const bySearchEmail = await rootResolvers.vendors({ search: '@' });
    expect(bySearchEmail.length).toBeGreaterThan(0);

    // A search that matches nothing returns empty rather than the whole roster.
    expect(await rootResolvers.vendors({ search: 'no-such-vendor-anywhere' })).toEqual([]);
  });

  test('vendor resolver looks up by id and email or returns null', async () => {
    const created = storeService.addVendor({
      name: 'Resolver Lookup Vendor',
      email: 'lookup@resolver-vendor.test',
      majorCategory: 'Engineering Spares - Electrical',
    });

    expect(await rootResolvers.vendor({ id: created.id })).toEqual(created);
    expect(await rootResolvers.vendor({ email: created.email })).toEqual(created);
    expect(await rootResolvers.vendor({ id: 'non-existent-vendor' })).toBeNull();
    expect(await rootResolvers.vendor({ email: 'unknown@email.com' })).toBeNull();
    expect(await rootResolvers.vendor({})).toBeNull();
  });

  // When a DB pool IS configured, both resolvers route through the bounded
  // getVendorsPageFromDB/getVendorByEmailFromDB helpers instead of a full
  // in-memory scan — this is the fix for the D1 row-read exhaustion incident
  // (see storeService.hydrateFromDB's own comment). Mocked here since the
  // rest of this suite deliberately runs with no DB configured.
  describe('vendors/vendor resolvers with a DB pool configured', () => {
    let originalPool;
    beforeEach(() => {
      originalPool = domainPool.pool;
      domainPool.pool = { query: jest.fn() };
    });
    afterEach(() => {
      domainPool.pool = originalPool;
      jest.restoreAllMocks();
    });

    test('vendors resolver pages through domainQueries.getVendorsPageFromDB', async () => {
      const dbVendor = { id: 'v-db-1', email: 'db-vendor@example.com', source: 'excel' };
      const pageSpy = jest
        .spyOn(domainQueries, 'getVendorsPageFromDB')
        .mockResolvedValue({ rows: [dbVendor], total: 1 });

      const result = await rootResolvers.vendors({ majorCategory: 'IT', search: 'db', limit: 10, offset: 0 });

      expect(pageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 0, search: 'db', category: 'IT' })
      );
      expect(result).toEqual([dbVendor]);

      // The `source` filter is applied client-side after the DB page load.
      const filteredOut = await rootResolvers.vendors({ source: 'buyer_manual' });
      expect(filteredOut).toEqual([]);
    });

    test('vendor resolver by email uses the bounded single-row DB lookup', async () => {
      const emailSpy = jest.spyOn(domainQueries, 'getVendorByEmailFromDB');

      // Public vendor (no buyerId/buyerAccountId) is visible to anyone.
      emailSpy.mockResolvedValueOnce({ id: 'v-db-3', email: 'public@example.com' });
      expect(await rootResolvers.vendor({ email: 'public@example.com' })).toEqual({
        id: 'v-db-3',
        email: 'public@example.com',
      });

      // A buyer-scoped vendor is only returned to a matching buyerId.
      emailSpy.mockResolvedValueOnce({ id: 'v-db-2', email: 'scoped@example.com', buyerId: 'buyer-9' });
      const unlinkedBuyerToken = require('../src/services/authService').generateSessionToken({
        id: 'usr-unscoped',
        email: 'unscoped-buyer@procucev.com',
        name: 'Unscoped Buyer',
        role: 'buyer',
      });
      const unscopedCtx = { req: { headers: { authorization: `Bearer ${unlinkedBuyerToken}` } } };
      expect(await rootResolvers.vendor({ email: 'scoped@example.com' }, unscopedCtx)).toBeNull();

      emailSpy.mockResolvedValueOnce(null);
      expect(await rootResolvers.vendor({ email: 'not-found@example.com' })).toBeNull();
    });
  });

  // The seeded companies are gone, so these start empty. An account created at
  // runtime is what they report now.
  test('buyerAccounts and activeBuyerAccount resolvers read the runtime store', () => {
    const beforeCount = rootResolvers.buyerAccounts().length;
    const created = storeService.addBuyerAccount({
      organizationName: 'Runtime Buyer Co',
      corporateEmail: 'runtime@buyer.test',
    });
    storeService.alignActiveBuyerAccount(created.id);

    expect(rootResolvers.buyerAccounts().length).toBe(beforeCount + 1);
    expect(rootResolvers.buyerAccounts({ limit: 1 })).toHaveLength(1);
    expect(rootResolvers.activeBuyerAccount().id).toBe(created.id);

    storeService.deleteBuyerAccount(created.id);
  });

  test('evaluations resolver filters by vendorName or returns all', () => {
    // The single fabricated 360° audit that used to be seeded is gone, so a real
    // evaluation is recorded before the filters are asserted.
    storeService.createEvaluation({
      vendorName: 'Resolver Evaluation Vendor',
      category: 'Engineering Spares - Mechanical',
    });

    const all = rootResolvers.evaluations();
    expect(all.length).toBeGreaterThan(0);

    const filtered = rootResolvers.evaluations({ vendorName: 'Resolver Evaluation' });
    expect(filtered.length).toBeGreaterThan(0);

    expect(rootResolvers.evaluations({ vendorName: 'no-such-vendor' })).toEqual([]);
  });

  test('auditLogs resolver filters by search action or userEmail', () => {
    // The audit trail starts empty now that the seeded narrative is gone, so a
    // real entry is recorded before asserting the filters.
    storeService.addAuditLog({
      userEmail: 'buyer@procucev.com',
      action: 'Registered a resolver audit fixture',
    });

    const all = rootResolvers.auditLogs();
    expect(all.length).toBeGreaterThan(0);

    const searchAction = rootResolvers.auditLogs({ search: 'Registered' });
    expect(searchAction.length).toBeGreaterThan(0);

    const searchEmail = rootResolvers.auditLogs({ search: '@' });
    expect(searchEmail.length).toBeGreaterThan(0);
  });

  test('catalogue resolver filters by category and search (name/sku)', () => {
    // The three unowned demo SKUs are gone, so the catalogue is empty until a
    // vendor publishes something.
    storeService.addProductToCatalogue(
      {
        name: 'Resolver Impeller',
        sku: 'SKU-RESOLVER-1',
        category: 'Valves & Actuators',
        unitPrice: 100,
      },
      'v-resolver-1',
      'vendor@resolver.test'
    );

    const all = rootResolvers.catalogue();
    expect(all.length).toBeGreaterThan(0);

    const byCat = rootResolvers.catalogue({ category: 'Valves' });
    expect(byCat.length).toBeGreaterThan(0);

    const bySearchName = rootResolvers.catalogue({ search: 'Impeller' });
    expect(bySearchName.length).toBeGreaterThan(0);

    const bySearchSku = rootResolvers.catalogue({ search: 'SKU' });
    expect(bySearchSku.length).toBeGreaterThan(0);
  });

  test('aiFeed, systemConfig, dbHealth, optimizationMetrics, diagnoseLogErrors, auditPerformance resolvers execute', async () => {
    const feed = await rootResolvers.aiFeed({ limit: 5 });
    expect(feed.length).toBeLessThanOrEqual(5);

    const config = rootResolvers.systemConfig();
    expect(config).toBeDefined();

    const health = await rootResolvers.dbHealth();
    expect(health).toBeDefined();
    // One connection, so one health answer covering accounts and domain records.
    expect(health).toHaveProperty('userCount');
    expect(health).toHaveProperty('vendorCount');
    expect(health).toHaveProperty('rfqCount');

    const metrics = rootResolvers.optimizationMetrics();
    expect(metrics).toBeDefined();
    expect(metrics.cache).toBeDefined();

    const diag = rootResolvers.diagnoseLogErrors();
    expect(Array.isArray(diag)).toBe(true);

    const perf = rootResolvers.auditPerformance();
    expect(perf.healthScore).toBeGreaterThanOrEqual(0);
  });

  test('mutations execute properly for an authenticated user', async () => {
    const buyerCtx = contextFor('buyer');
    const adminCtx = contextFor('admin');

    const createdRFQ = await rootResolvers.createRFQ(
      { input: { title: 'Direct Resolver RFQ', category: 'Raw Materials' } },
      buyerCtx
    );
    expect(createdRFQ.title).toBe('Direct Resolver RFQ');
    // The id comes from the server, never the client. Attributed to the requesting
    // buyer's own account (the beforeEach fixture, matched by session email),
    // resolved server-side rather than taken from the payload.
    expect(createdRFQ.rfqNumber).toMatch(/^RFQ\d{12}$/);
    expect(createdRFQ.buyerAccountId).toBe(seededRfq.buyerAccountId);

    const updatedRFQ = await rootResolvers.updateRFQ(
      { id: createdRFQ.id, input: { status: 'awarded' } },
      buyerCtx
    );
    expect(updatedRFQ.status).toBe('awarded');

    const createdVendor = await rootResolvers.createVendor(
      { input: { name: 'Direct Resolver Vendor', email: 'resolver@vendor.com', majorCategory: 'Electrical' } },
      buyerCtx
    );
    expect(createdVendor.name).toBe('Direct Resolver Vendor');

    const updatedVendor = await rootResolvers.updateVendor(
      { id: createdVendor.id, input: { rating: 4.9 } },
      buyerCtx
    );
    expect(updatedVendor.rating).toBe(4.9);

    const deleted = await rootResolvers.deleteVendor({ id: createdVendor.id }, buyerCtx);
    expect(deleted).toBe(true);

    const createdBuyer = await rootResolvers.createBuyerAccount(
      { input: { organizationName: 'Resolver Org', corporateEmail: 'resolver@org.com', contactPerson: 'Buyer' } },
      buyerCtx
    );
    expect(createdBuyer.organizationName).toBe('Resolver Org');

    await expect(rootResolvers.clearQueryCache(undefined, buyerCtx)).resolves.toBe(true);

    // purgeLogs/autoResolveLogErrors/optimizePerformance are admin-only.
    const purgeDefault = await rootResolvers.purgeLogs(undefined, adminCtx);
    expect(purgeDefault.success).toBe(true);

    const purgeCustom = await rootResolvers.purgeLogs({ maxAgeDays: 10 }, adminCtx);
    expect(purgeCustom.success).toBe(true);

    const autoResolveDefault = await rootResolvers.autoResolveLogErrors(undefined, adminCtx);
    expect(autoResolveDefault).toBeDefined();

    const autoResolveAction = await rootResolvers.autoResolveLogErrors(
      { action: 'OPTIMIZE_QUERY_CACHE' },
      adminCtx
    );
    expect(autoResolveAction.remediationsApplied[0].actionType).toBe('OPTIMIZE_QUERY_CACHE');

    const optDefault = await rootResolvers.optimizePerformance(undefined, adminCtx);
    expect(optDefault.status).toBe('OPTIMIZED');

    const optLevel = await rootResolvers.optimizePerformance({ level: 'deep' }, adminCtx);
    expect(optLevel.level).toBe('deep');
  });

  test('mutations reject a missing/invalid token, and admin-only mutations reject a non-admin role', async () => {
    await expect(
      rootResolvers.createRFQ({ input: { title: 'X' } }, { req: { headers: {} } })
    ).rejects.toThrow();
    await expect(
      rootResolvers.createRFQ(
        { input: { title: 'X' } },
        { req: { headers: { authorization: 'Bearer not-a-real-token' } } }
      )
    ).rejects.toThrow();
    await expect(rootResolvers.purgeLogs({}, contextFor('buyer'))).rejects.toThrow(
      'You do not have permission to perform this action.'
    );
  });
});
