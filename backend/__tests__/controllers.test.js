const aiFeedController = require('../src/controllers/aiFeedController');
const auditController = require('../src/controllers/auditController');
const bootstrapController = require('../src/controllers/bootstrapController');
const buyerAccountController = require('../src/controllers/buyerAccountController');
const catalogueController = require('../src/controllers/catalogueController');
const configController = require('../src/controllers/configController');
const dbController = require('../src/controllers/dbController');
const evaluationController = require('../src/controllers/evaluationController');
const rfqController = require('../src/controllers/rfqController');
const supportChatController = require('../src/controllers/supportChatController');
const vendorController = require('../src/controllers/vendorController');
const storeService = require('../src/services/storeService');
const domainPool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// The RFQ handlers read ownership from verified session claims, so a bare request
// object is now rejected before it reaches any store. `sub` rather than `id` is
// deliberate: that is the claim generateSessionToken actually writes.
const TEST_ORG_ID = 'org-buyer-01';
function buyerReq(overrides = {}) {
  return {
    user: { sub: 'usr-buyer-001', orgId: TEST_ORG_ID, email: 'buyer@procucev.com', role: 'buyer' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
}

describe('Controllers Error & Edge-Case Coverage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('aiFeedController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await aiFeedController.getAIFeed({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await aiFeedController.createFeedItem({ body: { title: 'Test Feed', message: 'Test Message' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await aiFeedController.createFeedItem({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    jest.spyOn(storeService, 'getAIFeed').mockImplementationOnce(() => {
      throw new Error('AI Feed Error');
    });
    await aiFeedController.getAIFeed({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('auditController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await auditController.getAuditLogs({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await auditController.createAuditLog({ body: { action: 'TEST_ACTION', userEmail: 'test@user.com' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await auditController.createAuditLog({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await auditController.verifyIntegrity({}, res, next);
    expect(res.json).toHaveBeenCalled();

    jest.spyOn(storeService, 'getAuditLogs').mockImplementationOnce(() => {
      throw new Error('Audit Error');
    });
    await auditController.getAuditLogs({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('bootstrapController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await bootstrapController.getBootstrap({}, res, next);
    expect(res.json).toHaveBeenCalled();

    jest.spyOn(storeService, 'getBootstrapData').mockImplementationOnce(() => {
      throw new Error('Bootstrap Error');
    });
    await bootstrapController.getBootstrap({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('buyerAccountController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    const buyerUser = { role: 'buyer', email: 'buyer@procucev.com' };

    await buyerAccountController.getBuyerAccounts({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.getActiveAccount({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.setActiveAccount({ body: { id: 'buyer-1' }, user: buyerUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.createBuyerAccount(
      { body: { organizationName: 'New Org', corporateEmail: 'test@org.com' }, user: buyerUser },
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(201);

    await buyerAccountController.createBuyerAccount({ body: {}, user: buyerUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await buyerAccountController.updateBuyerAccount(
      { params: { id: 'buyer-1' }, body: { organizationName: 'Updated' }, user: buyerUser },
      res,
      next
    );
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.updateBuyerAccount({ params: { id: 'non-existent' }, body: {}, user: buyerUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'getBuyerAccounts').mockImplementationOnce(() => {
      throw new Error('Buyer Accounts Error');
    });
    await buyerAccountController.getBuyerAccounts({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('buyerAccountController rejects non-buyer roles on every mutating endpoint', async () => {
    // Buyer accounts had zero role-gating: a vendor or category manager could
    // create, edit, delete or re-point the globally active buyer account, and
    // trigger the buyer-only historical-purchase vendor ingestion.
    const next = jest.fn();
    const adminUser = { role: 'admin', email: 'admin@procucev.com' };

    for (const role of ['vendor', 'category_manager']) {
      const user = { role, email: `${role}@procucev.com` };

      const createRes = mockRes();
      await buyerAccountController.createBuyerAccount(
        { body: { organizationName: 'Rogue Org', corporateEmail: 'rogue@org.com' }, user },
        createRes,
        next
      );
      expect(createRes.status).toHaveBeenCalledWith(403);

      const updateRes = mockRes();
      await buyerAccountController.updateBuyerAccount({ params: { id: 'buyer-1' }, body: { totalSpend: '₹0' }, user }, updateRes, next);
      expect(updateRes.status).toHaveBeenCalledWith(403);

      const deleteRes = mockRes();
      await buyerAccountController.deleteBuyerAccount({ params: { id: 'buyer-1' }, user }, deleteRes, next);
      expect(deleteRes.status).toHaveBeenCalledWith(403);

      const activateRes = mockRes();
      await buyerAccountController.setActiveAccount({ params: { id: 'buyer-1' }, user }, activateRes, next);
      expect(activateRes.status).toHaveBeenCalledWith(403);

      const ingestRes = mockRes();
      await buyerAccountController.ingestHistoricalData({ body: { period: '2_years', vendorRecords: [] }, user }, ingestRes, next);
      expect(ingestRes.status).toHaveBeenCalledWith(403);
    }

    // An unauthenticated direct call is a 401, not a 403 — mirrors
    // vendorController.assertVendorOwnership's own missing-session branch.
    const noSessionRes = mockRes();
    await buyerAccountController.createBuyerAccount({ body: { organizationName: 'X', corporateEmail: 'x@o.com' } }, noSessionRes, next);
    expect(noSessionRes.status).toHaveBeenCalledWith(401);

    // An admin acting on a buyer's behalf still gets through.
    const adminRes = mockRes();
    await buyerAccountController.ingestHistoricalData({ body: { period: '2_years', vendorRecords: [] }, user: adminUser }, adminRes, next);
    expect(adminRes.json).toHaveBeenCalled();
    expect(adminRes.status).not.toHaveBeenCalledWith(403);
  });

  test('catalogueController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    const adminUser = { role: 'admin', email: 'admin@procucev.com' };

    await catalogueController.getProducts({ query: {} }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.addProduct(
      { body: { name: 'Item', sku: 'SKU-1', unitPrice: 100, vendorId: 'v-001' }, user: adminUser },
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(201);

    await catalogueController.addProduct({ body: {}, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // 'prod-1' is a real seeded catalogue item with no owning vendorId; an
    // admin bypasses the ownership check that would otherwise 403 it.
    await catalogueController.updateProduct({ params: { id: 'prod-1' }, body: { name: 'Updated' }, user: adminUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.updateProduct({ params: { id: 'invalid-prod' }, body: {}, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await catalogueController.deleteProduct({ params: { id: 'prod-1' }, user: adminUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.deleteProduct({ params: { id: 'invalid-prod' }, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('configController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await configController.getSystemConfig({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await configController.updateSystemConfig({ body: { activeMode: 'mode_3' } }, res, next);
    expect(res.json).toHaveBeenCalled();
  });

  test('dbController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    // initDBSchema / syncDBData were removed with PostgreSQL. The controller now
    // reports identity-database health and the query efficiency report.
    await dbController.getDBStatus({}, res, next);
    expect(res.json).toHaveBeenCalled();
    await dbController.getDBMetrics({}, res, next);
    expect(res.json).toHaveBeenCalled();
  });
  // One connection, one status. This used to report two datastores side by side
  // and a `domainStore.mode` of 'persisted' vs 'in_memory_seed'; there is no
  // second datastore and no seed, so it reports what is loaded instead.
  test('dbController reports what is loaded once the store has hydrated', async () => {
    const next = jest.fn();
    const res = mockRes();
    const original = storeService.isHydratedFromDB;
    storeService.isHydratedFromDB = true;
    try {
      await dbController.getDBStatus({}, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          loadedRecords: expect.objectContaining({ isLoadedFromDatabase: true }),
        })
      );
      const payload = res.json.mock.calls[res.json.mock.calls.length - 1][0];
      expect(payload).not.toHaveProperty('domainStore');
      expect(payload).not.toHaveProperty('domainDatabase');
    } finally {
      storeService.isHydratedFromDB = original;
    }
  });

  test('evaluationController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    const vendorUser = { role: 'vendor', email: 'rajesh@apexindustrial.in', name: 'Rajesh Nair' };
    const documents = [{ name: 'evidence.pdf' }];

    await evaluationController.getEvaluations({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await evaluationController.createEvaluation({ body: { vendorName: 'Apex', documents }, user: vendorUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    // A non-vendor role is rejected before ever reaching the evidence check.
    await evaluationController.createEvaluation({ body: {}, user: { role: 'buyer', email: 'buyer@x.com' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);

    // A vendor with incomplete evidence is rejected.
    await evaluationController.createEvaluation({ body: { documents: [{ name: '' }] }, user: vendorUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // A body-less request must fall back to {} rather than throwing on property access.
    await evaluationController.createEvaluation({ user: vendorUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // A vendor with no profile record yet falls back to their session identity.
    const noProfileRes = mockRes();
    await evaluationController.createEvaluation(
      { body: { documents }, user: { role: 'vendor', email: 'no-profile-vendor@test.com', name: 'No Profile', orgName: 'No Profile Org' } },
      noProfileRes,
      next
    );
    expect(noProfileRes.status).toHaveBeenCalledWith(201);
    expect(noProfileRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ vendorName: 'No Profile Org', email: 'no-profile-vendor@test.com' }) })
    );
  });

  test('rfqController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    const buyerUser = { role: 'buyer', email: 'buyer@procucev.com' };
    const vendorUser = { role: 'vendor', email: 'rajesh@apexindustrial.in' };

    const seededRfq = storeService.createRFQ({
      title: 'Seeded RFQ',
      category: 'Mechanical',
      targetDeliveryDate: '2026-10-01',
    });

    await rfqController.getRFQs(buyerReq(), res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.getRFQById(buyerReq({ params: { id: seededRfq.id } }), res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.getRFQById(buyerReq({ params: { id: 'non-existent' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    // getRFQs/getRFQById delegate auth entirely to the route's `authenticate`
    // middleware (see routes/rfqs.js) rather than self-enforcing it inline —
    // called directly with no session at all, they're unrestricted at the
    // controller level, same as any non-buyer role (see resolveRfqReadScope).
    const anonRes = mockRes();
    await rfqController.getRFQs({}, anonRes, next);
    expect(anonRes.json).toHaveBeenCalled();

    await rfqController.createRFQ(
      buyerReq({
        body: {
          title: 'New RFQ',
          category: 'Mechanical',
          budget: 50000,
          targetDeliveryDate: '2026-10-01',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
        },
      }),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(201);

    await rfqController.createRFQ(buyerReq({ body: {} }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // A payload that clears the title check but violates another rule must still
    // be rejected, which the old bare `if (!body.title)` gate let through.
    await rfqController.createRFQ(buyerReq({ body: { title: 'Only a title' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // Line items arrive as `extractedEntities` from the wizard, but the API also
    // accepts `lineItems`, and an RFQ with neither must still save.
    const validBody = {
      title: 'Line item shapes',
      category: 'Mechanical',
      budget: 1,
      targetDeliveryDate: '2026-10-01',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
    };

    const withLineItems = mockRes();
    await rfqController.createRFQ(
      buyerReq({ body: { ...validBody, lineItems: [{ itemName: 'Pump', quantity: 1 }] } }),
      withLineItems,
      next
    );
    expect(withLineItems.status).toHaveBeenCalledWith(201);
    expect(withLineItems.json.mock.calls[0][0].data.extractedEntities).toHaveLength(1);

    const withNoItems = mockRes();
    await rfqController.createRFQ(buyerReq({ body: validBody }), withNoItems, next);
    expect(withNoItems.status).toHaveBeenCalledWith(201);
    expect(withNoItems.json.mock.calls[0][0].data.extractedEntities).toEqual([]);

    // An explicit status wins over the default, and a session with no orgName
    // still produces a summary.
    const withStatus = mockRes();
    await rfqController.createRFQ(
      {
        user: { sub: 'usr-buyer-001', orgId: TEST_ORG_ID, email: 'buyer@procucev.com', role: 'buyer' },
        body: { ...validBody, status: 'In Evaluation' },
      },
      withStatus,
      next
    );
    expect(withStatus.status).toHaveBeenCalledWith(201);
    expect(withStatus.json.mock.calls[0][0].data.status).toBe('In Evaluation');

    // The RFQ must be attributed to the authenticated requester's own buyer
    // account (resolved server-side from req.user.email), not a client-
    // supplied or globally-shared value.
    const buyerAccountRes = mockRes();
    await buyerAccountController.createBuyerAccount(
      {
        body: { organizationName: 'Tata Motors Commercial Vehicles Ltd.', corporateEmail: 'sourcing.commercial@tatamotors.com' },
        user: { role: 'buyer', email: 'sourcing.commercial@tatamotors.com' },
      },
      buyerAccountRes,
      next
    );
    const attributedRes = mockRes();
    await rfqController.createRFQ(
      {
        body: {
          title: 'Attributed RFQ',
          category: 'Raw Material',
          targetDeliveryDate: '2026-10-01',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
        },
        user: { role: 'buyer', email: 'sourcing.commercial@tatamotors.com' },
      },
      attributedRes,
      next
    );
    expect(attributedRes.status).toHaveBeenCalledWith(201);
    const attributedRFQ = attributedRes.json.mock.calls[0][0].data;
    expect(attributedRFQ.buyerAccountName).toBe('Tata Motors Commercial Vehicles Ltd.');

    await rfqController.updateRFQ({ params: { id: attributedRFQ.id }, body: { title: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.addQuote({ params: { id: 'rfq-001' }, body: { unitPrice: 100 }, user: vendorUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.addQuote({ params: { id: 'rfq-001' }, body: {}, user: vendorUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await rfqController.generateEmailPreview({ params: { id: 'rfq-001' }, query: {} }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.triggerBatchChaser({ params: { id: 'rfq-001' }, body: { channels: ['call'] } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.approvePO({ params: { id: 'rfq-001' }, body: { vendorName: 'Apex', totalAmount: 50000 }, user: buyerUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.approvePO({ params: { id: 'rfq-001' }, body: {}, user: buyerUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // addQuote: role-block and missing-profile branches.
    const quoteForbiddenRes = mockRes();
    await rfqController.addQuote({ params: { id: 'rfq-001' }, body: { unitPrice: 100 }, user: buyerUser }, quoteForbiddenRes, next);
    expect(quoteForbiddenRes.status).toHaveBeenCalledWith(403);

    const quoteNoProfileRes = mockRes();
    await rfqController.addQuote(
      { params: { id: 'rfq-001' }, body: { unitPrice: 100 }, user: { role: 'vendor', email: 'no-profile-vendor@test.com' } },
      quoteNoProfileRes,
      next
    );
    expect(quoteNoProfileRes.status).toHaveBeenCalledWith(400);

    // approvePO: role-block and RFQ-not-found branches.
    const poForbiddenRes = mockRes();
    await rfqController.approvePO(
      { params: { id: 'rfq-001' }, body: { vendorName: 'Apex', totalAmount: 1000 }, user: vendorUser },
      poForbiddenRes,
      next
    );
    expect(poForbiddenRes.status).toHaveBeenCalledWith(403);

    const poNotFoundRes = mockRes();
    await rfqController.approvePO(
      { params: { id: 'non-existent' }, body: { vendorName: 'Apex', totalAmount: 1000 }, user: buyerUser },
      poNotFoundRes,
      next
    );
    expect(poNotFoundRes.status).toHaveBeenCalledWith(404);
  });

  test('supportChatController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await supportChatController.sendMessage({ body: { prompt: 'How does Mode 1 work?' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await supportChatController.sendMessage({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('vendorController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    const adminUser = { role: 'admin', email: 'admin@procucev.com' };
    const buyerUser = { role: 'buyer', email: 'buyer@procucev.com' };

    await vendorController.getVendors({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.getVendorById({ params: { id: 'vendor-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.getVendorById({ params: { id: 'non-existent' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await vendorController.createVendor({ body: { name: 'New Vendor', majorCategory: 'Mechanical' }, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await vendorController.createVendor({ body: {}, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await vendorController.updateVendor({ params: { id: 'vendor-1' }, body: { name: 'Updated' }, user: adminUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    // Rating a vendor is buyer-side; a non-vendor role is required to reach
    // field validation / the store call at all.
    await vendorController.reviseRating(
      { params: { id: 'vendor-1' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 }, user: buyerUser },
      res,
      next
    );
    expect(res.json).toHaveBeenCalled();

    await vendorController.reviseRating({ params: { id: 'vendor-1' }, body: {}, user: buyerUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await vendorController.generateOnboardingEmailPreview({ params: { id: 'vendor-1' }, user: buyerUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.updateCategories(
      { params: { id: 'vendor-1' }, body: { vendorSelectedCategories: ['Pumps'] }, user: adminUser },
      res,
      next
    );
    expect(res.json).toHaveBeenCalled();

    await vendorController.deleteVendor({ params: { id: 'vendor-1' }, user: adminUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.deleteVendor({ params: { id: 'non-existent' }, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    // assertVendorOwnership branches. The vendor is created here rather than
    // referenced as the seeded 'v-001': nothing is seeded any more, so the id is
    // whatever the store allocates, and the record needs the owning email for the
    // ownership check to have something to compare against. Only reachable via a
    // direct controller call, since the real routes always attach req.user through
    // the authenticate middleware first.
    const ownedRes = mockRes();
    await vendorController.createVendor(
      {
        body: {
          name: 'Apex Industrial Dynamics Pvt Ltd',
          email: 'rajesh@apexindustrial.in',
          majorCategory: 'Engineering Spares - Mechanical',
        },
        user: adminUser,
      },
      ownedRes,
      next
    );
    const ownedVendorId = ownedRes.json.mock.calls[0][0].data.id;

    const unauthedRes = mockRes();
    await vendorController.updateVendor({ params: { id: ownedVendorId }, body: {} }, unauthedRes, next);
    expect(unauthedRes.status).toHaveBeenCalledWith(401);

    const forbiddenRes = mockRes();
    await vendorController.updateVendor({ params: { id: ownedVendorId }, body: {}, user: buyerUser }, forbiddenRes, next);
    expect(forbiddenRes.status).toHaveBeenCalledWith(403);

    // reviseRating: a vendor may not rate any vendor, including itself.
    const vendorOwnUser = { role: 'vendor', email: 'rajesh@apexindustrial.in' };
    const ratingBlockedRes = mockRes();
    await vendorController.reviseRating(
      { params: { id: ownedVendorId }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 }, user: vendorOwnUser },
      ratingBlockedRes,
      next
    );
    expect(ratingBlockedRes.status).toHaveBeenCalledWith(403);

    // reviseRating: an out-of-range score is rejected, not silently clamped.
    const badScoreRes = mockRes();
    await vendorController.reviseRating(
      { params: { id: ownedVendorId }, body: { qualityScore: 150, costScore: 90, deliveryScore: 90 }, user: buyerUser },
      badScoreRes,
      next
    );
    expect(badScoreRes.status).toHaveBeenCalledWith(400);

    // generateOnboardingEmailPreview: a vendor may not view onboarding credentials.
    const emailBlockedRes = mockRes();
    await vendorController.generateOnboardingEmailPreview({ params: { id: ownedVendorId }, user: vendorOwnUser }, emailBlockedRes, next);
    expect(emailBlockedRes.status).toHaveBeenCalledWith(403);
  });

  // Regression coverage for two bugs found together: a buyer could never save
  // category taxonomy for a vendor they themselves uploaded (assertVendorOwnership
  // was given a plain email string instead of the vendor object, so its buyer-
  // ownership branch could never match), and updateVendorCategories's internal
  // unscoped getVendorById lookup returned undefined for any buyer-scoped vendor,
  // silently reporting {success:true, data:null} even when ownership passed.
  test('updateCategories: a buyer can save category taxonomy for a vendor they uploaded', async () => {
    const next = jest.fn();
    const buyerEmail = 'buyer-owns-vendor@procucev.com';
    const buyerAccount = { id: 'buyer-acc-cat-test', organizationName: 'Cat Test Buyers Ltd' };
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(buyerAccount);

    const created = storeService.addVendor(
      { name: 'Buyer Uploaded Vendor Co', email: 'buyer-uploaded-vendor@example.com', majorCategory: 'Electricals' },
      buyerEmail,
      buyerAccount.id
    );
    expect(created.buyerId).toBe(buyerAccount.id);

    const res = mockRes();
    await vendorController.updateCategories(
      {
        params: { id: created.id },
        body: { clientMappedCategories: [], vendorSelectedCategories: ['Switchgear'] },
        user: { role: 'buyer', email: buyerEmail },
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ vendorSelectedCategories: ['Switchgear'] }),
      })
    );

    storeService.getBuyerAccountByEmail.mockRestore();
  });

  test('updateCategories: a vendor can save its own taxonomy even when linked to a buyer account', async () => {
    const next = jest.fn();
    const vendorEmail = 'buyer-linked-vendor@example.com';
    const created = storeService.addVendor(
      { name: 'Buyer Linked Vendor Co', email: vendorEmail, majorCategory: 'Electricals' },
      null,
      'buyer-acc-cat-test-2'
    );
    expect(created.buyerId).toBe('buyer-acc-cat-test-2');

    const res = mockRes();
    await vendorController.updateCategories(
      {
        params: { id: created.id },
        body: { clientMappedCategories: [], vendorSelectedCategories: ['Cables'] },
        user: { role: 'vendor', email: vendorEmail },
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
    // The bug returned {success:true, data:null} instead of a 404/403 — assert
    // data is the real updated record, not null, so a stale mock can't hide it.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ id: created.id, vendorSelectedCategories: ['Cables'] }),
      })
    );
  });

  test('vendorController.bulkImportVendors: role gating, payload shape, and mixed valid/invalid rows', async () => {
    const next = jest.fn();
    const categoryManagerUser = { role: 'category_manager', email: 'cm@procucev.com' };
    const adminUser = { role: 'admin', email: 'admin@procucev.com' };
    const buyerUser = { role: 'buyer', email: 'buyer@procucev.com' };
    const vendorUser = { role: 'vendor', email: 'rajesh@apexindustrial.in' };

    const validRow = (overrides = {}) => ({
      rowNumber: 1,
      name: 'Bulk Import Test Co',
      email: 'bulk-import-test@example.com',
      phone: '9876543210',
      ...overrides,
    });

    // Unauthenticated is a 401, not a 403.
    const unauthedRes = mockRes();
    await vendorController.bulkImportVendors({ body: { vendors: [validRow()] } }, unauthedRes, next);
    expect(unauthedRes.status).toHaveBeenCalledWith(401);

    // Buyer and vendor roles are not category managers.
    for (const user of [buyerUser, vendorUser]) {
      const res = mockRes();
      await vendorController.bulkImportVendors({ body: { vendors: [validRow()] }, user }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    }

    // Missing / empty vendors array.
    const emptyRes = mockRes();
    await vendorController.bulkImportVendors({ body: {}, user: categoryManagerUser }, emptyRes, next);
    expect(emptyRes.status).toHaveBeenCalledWith(400);

    const emptyArrayRes = mockRes();
    await vendorController.bulkImportVendors({ body: { vendors: [] }, user: categoryManagerUser }, emptyArrayRes, next);
    expect(emptyArrayRes.status).toHaveBeenCalledWith(400);

    // Over the per-request row cap.
    const tooManyRes = mockRes();
    const tooMany = Array.from({ length: 2001 }, (_, i) => validRow({ rowNumber: i + 1, email: `row${i}@example.com` }));
    await vendorController.bulkImportVendors({ body: { vendors: tooMany }, user: categoryManagerUser }, tooManyRes, next);
    expect(tooManyRes.status).toHaveBeenCalledWith(400);

    // A mix of one valid row and one row missing required fields — server-side
    // re-validation must catch the bad row even though nothing client-side
    // filtered it out first. bulkAddVendors now requires a real DB pool (see
    // the "no in-memory-only vendor import" fix), so one is simulated here.
    const originalPool = domainPool.pool;
    domainPool.pool = { query: jest.fn() };
    const insertSpy = jest.spyOn(domainQueries, 'bulkInsertVendorsInDB').mockImplementation(async (vendors) =>
      vendors.map((v) => v.email)
    );
    // Session tracking is a real Postgres round trip too — mocked directly
    // rather than through the fake pool object, same reasoning as insertSpy.
    const createSessionSpy = jest.spyOn(domainQueries, 'createBulkImportSessionInDB').mockResolvedValue({ id: 'bulk-import-test-session' });
    const incrementSessionSpy = jest.spyOn(domainQueries, 'incrementBulkImportSessionInDB').mockResolvedValue({ id: 'bulk-import-test-session' });

    const mixedRes = mockRes();
    await vendorController.bulkImportVendors(
      {
        body: {
          vendors: [
            validRow({ rowNumber: 1, email: 'mixed-good@example.com' }),
            { rowNumber: 2, name: '', email: 'not-an-email', phone: '123' },
          ],
        },
        user: categoryManagerUser,
      },
      mixedRes,
      next
    );
    expect(mixedRes.json).toHaveBeenCalled();
    const mixedPayload = mixedRes.json.mock.calls[0][0];
    // A row that fails validation is no longer rejected — it still imports,
    // tagged hasIssues/issues, since the real marketplace scrape this feeds
    // from routinely has incomplete rows (see vendorBulkImportRow's comment).
    expect(mixedPayload.data.imported).toBe(2);
    expect(mixedPayload.data.failed).toBe(0);
    expect(mixedPayload.data.issues).toBe(1);
    const row2 = mixedPayload.data.results.find((r) => r.rowNumber === 2);
    expect(row2.status).toBe('imported');
    expect(row2.hasIssues).toBe(true);
    expect(row2.issues.length).toBeGreaterThan(0);

    // Admin may also bulk-import, same as category_manager.
    const adminRes = mockRes();
    await vendorController.bulkImportVendors(
      { body: { vendors: [validRow({ rowNumber: 1, email: 'admin-import@example.com' })] }, user: adminUser },
      adminRes,
      next
    );
    expect(adminRes.json).toHaveBeenCalled();
    expect(adminRes.json.mock.calls[0][0].data.imported).toBe(1);

    domainPool.pool = originalPool;
    insertSpy.mockRestore();
    createSessionSpy.mockRestore();
    incrementSessionSpy.mockRestore();
  });

  test('vendorController.bulkImportVendors: no DB pool configured surfaces as a 500 via next(err), not a silent in-memory import', async () => {
    const next = jest.fn();
    const categoryManagerUser = { role: 'category_manager', email: 'cm@procucev.com' };
    const originalPool = domainPool.pool;
    domainPool.pool = null;

    const before = (await storeService.getVendors()).length;
    const res = mockRes();
    await vendorController.bulkImportVendors(
      {
        body: { vendors: [{ rowNumber: 1, name: 'No DB Co', email: 'no-db-pool@example.com', phone: '9876543210' }] },
        user: categoryManagerUser,
      },
      res,
      next
    );

    domainPool.pool = originalPool;

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 500 });
    expect((await storeService.getVendors()).some((v) => v.email === 'no-db-pool@example.com')).toBe(false);
    expect((await storeService.getVendors()).length).toBe(before);
  });

  test('vendorController.bulkImportVendors: creates a session on the first chunk, resumes it on a later chunk, and reports missing-email rows separately', async () => {
    const next = jest.fn();
    const categoryManagerUser = { role: 'category_manager', email: 'cm@procucev.com' };
    const originalPool = domainPool.pool;
    domainPool.pool = { query: jest.fn() };
    const insertSpy = jest.spyOn(domainQueries, 'bulkInsertVendorsInDB').mockImplementation(async (vendors) =>
      vendors.map((v) => v.email)
    );
    const createSessionSpy = jest.spyOn(domainQueries, 'createBulkImportSessionInDB').mockImplementation(
      async (id) => ({ id, status: 'IN_PROGRESS' })
    );
    const incrementSessionSpy = jest.spyOn(domainQueries, 'incrementBulkImportSessionInDB').mockResolvedValue({ status: 'IN_PROGRESS' });

    try {
      // First chunk: no sessionId supplied — one gets created.
      const firstRes = mockRes();
      await vendorController.bulkImportVendors(
        {
          body: {
            totalRowsDeclared: 2,
            vendors: [{ rowNumber: 1, name: 'Session Chunk One Co', email: undefined, phone: '9876543210' }],
          },
          user: categoryManagerUser,
        },
        firstRes,
        next
      );

      expect(createSessionSpy).toHaveBeenCalledTimes(1);
      const firstPayload = firstRes.json.mock.calls[0][0];
      expect(firstPayload.data.sessionId).toBeDefined();
      expect(firstPayload.data.missingEmail).toBe(1);
      expect(incrementSessionSpy).toHaveBeenCalledWith(
        firstPayload.data.sessionId,
        expect.objectContaining({ processed: 1, imported: 1, missingEmail: 1, duplicate: 0, invalid: 0 })
      );

      // Second chunk: reuses the returned sessionId — no new session created.
      const getSessionSpy = jest.spyOn(domainQueries, 'getBulkImportSessionFromDB').mockResolvedValue({
        id: firstPayload.data.sessionId,
        status: 'IN_PROGRESS',
      });
      const secondRes = mockRes();
      await vendorController.bulkImportVendors(
        {
          body: {
            sessionId: firstPayload.data.sessionId,
            vendors: [{ rowNumber: 2, name: 'Session Chunk Two Co', email: 'chunk-two@example.com', phone: '9876543211' }],
          },
          user: categoryManagerUser,
        },
        secondRes,
        next
      );

      expect(createSessionSpy).toHaveBeenCalledTimes(1);
      const secondPayload = secondRes.json.mock.calls[0][0];
      expect(secondPayload.data.sessionId).toBe(firstPayload.data.sessionId);
      expect(secondPayload.data.missingEmail).toBe(0);
      getSessionSpy.mockRestore();
    } finally {
      domainPool.pool = originalPool;
      insertSpy.mockRestore();
      createSessionSpy.mockRestore();
      incrementSessionSpy.mockRestore();
    }
  });

  test('vendorController.getBulkImportSessionStatus: role gating, not-found, and success', async () => {
    const next = jest.fn();
    const categoryManagerUser = { role: 'category_manager', email: 'cm@procucev.com' };
    const vendorUser = { role: 'vendor', email: 'vendor@procucev.com' };

    const unauthedRes = mockRes();
    await vendorController.getBulkImportSessionStatus({ params: { sessionId: 's-1' } }, unauthedRes, next);
    expect(unauthedRes.status).toHaveBeenCalledWith(401);

    // A buyer may now also bulk-import their own vendor roster, so only a
    // vendor role (never a bulk-import actor) is rejected here.
    const forbiddenRes = mockRes();
    await vendorController.getBulkImportSessionStatus({ params: { sessionId: 's-1' }, user: vendorUser }, forbiddenRes, next);
    expect(forbiddenRes.status).toHaveBeenCalledWith(403);

    const notFoundSpy = jest.spyOn(domainQueries, 'getBulkImportSessionFromDB').mockResolvedValueOnce(null);
    const notFoundRes = mockRes();
    await vendorController.getBulkImportSessionStatus({ params: { sessionId: 's-missing' }, user: categoryManagerUser }, notFoundRes, next);
    expect(notFoundRes.status).toHaveBeenCalledWith(404);

    const sessionRow = { id: 's-1', status: 'IN_PROGRESS', processed_count: 10 };
    const foundSpy = jest.spyOn(domainQueries, 'getBulkImportSessionFromDB').mockResolvedValueOnce(sessionRow);
    const foundRes = mockRes();
    await vendorController.getBulkImportSessionStatus({ params: { sessionId: 's-1' }, user: categoryManagerUser }, foundRes, next);
    expect(foundRes.json).toHaveBeenCalledWith({ success: true, data: sessionRow });

    notFoundSpy.mockRestore();
    foundSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RFQ controller: remaining scope and fallback branches
// ══════════════════════════════════════════════════════════════════════════════
describe('rfqController scope and fallback branches', () => {
  function scopedReq(overrides = {}) {
    return {
      user: { email: 'buyer@procucev.com', role: 'buyer' },
      params: {},
      query: {},
      body: {},
      ...overrides,
    };
  }

  let seededRfq;

  beforeEach(async () => {
    // A real buyer account for scopedReq's email, so getRFQSummary's
    // resolveRfqReadScope filtering has something real to scope against.
    const accountRes = mockRes();
    await buyerAccountController.createBuyerAccount(
      { body: { organizationName: 'Scope Test Org', corporateEmail: 'buyer@procucev.com' }, user: { role: 'buyer' } },
      accountRes,
      jest.fn()
    );
    seededRfq = storeService.createRFQ(
      { title: 'Branch coverage RFQ', category: 'Mechanical' },
      accountRes.json.mock.calls[0][0].data
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getRFQSummary rolls up only this buyer\'s RFQs', async () => {
    const res = mockRes();
    await rfqController.getRFQSummary(scopedReq(), res, jest.fn());

    const summary = res.json.mock.calls[0][0].data;
    expect(summary.totalRFQs).toBe(1);
    // Another buyer's RFQ must not appear in these totals.
    storeService.createRFQ({ title: 'Someone else\'s RFQ', budget: 999 }, { id: 'other-buyer-acc', organizationName: 'Someone Else Ltd.' });

    const res2 = mockRes();
    await rfqController.getRFQSummary(scopedReq(), res2, jest.fn());
    expect(res2.json.mock.calls[0][0].data.totalRFQs).toBe(1);
  });

  // The wizard sends extractedEntities; this pins that branch of the ternary.
  test('createRFQ stores extractedEntities when the wizard supplies them', async () => {
    const res = mockRes();
    await rfqController.createRFQ(
      scopedReq({
        body: {
          title: 'Extracted entities path',
          category: 'Mechanical',
          budget: 10,
          targetDeliveryDate: '2026-10-01',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
          extractedEntities: [
            { itemName: 'Pump', quantity: 2, unit: 'Nos', minorCategory: 'Pumps' },
            { itemName: 'Valve', quantity: 1, unit: 'Nos', minorCategory: 'Valves' },
          ],
        },
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const created = res.json.mock.calls[0][0].data;
    expect(created.extractedEntities).toHaveLength(2);
    // A summary is always attached, derived when Gemini is unavailable.
    expect(created.aiSummary.itemCount).toBe(2);
    expect(created.aiSummary.generatedBy).toBe('derived');
  });

  // Both handlers tolerate a request that arrived with no body at all.
  test.each([['createRFQ'], ['ingestRFQ']])('%s tolerates a missing body', async (handler) => {
    const res = mockRes();
    await rfqController[handler](scopedReq({ body: undefined }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('generateEmailPreview resolves a named vendor', async () => {
    const res = mockRes();
    const storeSvc = require('../src/services/storeService');
    const vendor = (await storeSvc.getVendors())[0];

    await rfqController.generateEmailPreview(
      scopedReq({ params: { id: seededRfq.id }, query: { vendorId: vendor.id } }),
      res,
      jest.fn()
    );

    expect(res.json).toHaveBeenCalled();
  });

  // An attachment rejection this controller has no specific message for still has
  // to say something useful rather than returning an empty error.
  test('uploadRFQAttachment falls back to a generic storage message', async () => {
    const attachmentService = require('../src/services/rfqAttachmentService');
    jest.spyOn(attachmentService, 'saveAttachment').mockReturnValue({ status: 'SOME_NEW_STATUS' });

    const res = mockRes();
    await rfqController.uploadRFQAttachment(
      scopedReq({
        body: { fileName: 'annexure.pdf', mimeType: 'application/pdf', contentBase64: 'AAAA' },
      }),
      res,
      jest.fn()
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error.length).toBeGreaterThan(0);
  });
});
