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
const dbPool = require('../src/db/pool');
const optimizationMetrics = require('../src/db/optimizationMetrics');
const buyerAccountResolver = require('../src/services/buyerAccountResolver');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// RFQ handlers resolve ownership from verified session claims, so a request with
// no `user` is rejected before reaching the code path under test.
const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
function buyerReq(overrides = {}) {
  return {
    user: { sub: 'usr-buyer-001', orgId: 'org-buyer-01', email: 'buyer@procucev.com', role: 'buyer' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
}

describe('Controllers Comprehensive Catch Blocks & Missing Branches', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('AI Feed Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'addAIFeedItem').mockImplementationOnce(() => {
      throw new Error('Add feed fail');
    });
    await aiFeedController.createFeedItem({ body: { title: 'T', message: 'M' } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Audit Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'addAuditLog').mockImplementationOnce(() => {
      throw new Error('Audit add fail');
    });
    await auditController.createAuditLog({ body: { action: 'Test' } }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'verifyAuditIntegrity').mockImplementationOnce(() => {
      throw new Error('Audit verify fail');
    });
    await auditController.verifyIntegrity({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Bootstrap Controller Postgres source branch', async () => {
    const res = mockRes();
    const next = jest.fn();
    storeService.isHydratedFromDB = true;
    await bootstrapController.getBootstrap({}, res, next);
    expect(res.json).toHaveBeenCalled();
    storeService.isHydratedFromDB = false;
  });

  test('getAllRFQs reports the persisted source and tolerates a missing createdAt', async () => {
    const res = mockRes();
    const next = jest.fn();
    jest.spyOn(storeService, 'getRFQs').mockReturnValue([{ id: 'x' }, { id: 'y', createdAt: '2026-05-01T00:00:00Z' }]);
    storeService.isHydratedFromDB = true;
    await rfqController.getAllRFQs({}, res, next);
    storeService.isHydratedFromDB = false;
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, source: 'persisted' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('Buyer Account Controller Error & 404 Branches', async () => {
    const next = jest.fn();
    const res = mockRes();
    // Every mutating endpoint is now buyer/admin-gated, so these branch probes
    // have to carry a buyer session to reach the code under test.
    const buyerUser = { role: 'buyer', email: 'buyer@procucev.com' };

    // The active account now comes from the identity schema rather than the
    // in-memory store, so the failure being injected is a resolver throw.
    jest
      .spyOn(buyerAccountResolver, 'resolveActiveBuyerAccount')
      .mockRejectedValueOnce(new Error('Active Acc Error'));
    await buyerAccountController.getActiveAccount({ user: { sub: 'usr-1' } }, res, next);
    expect(next).toHaveBeenCalled();

    // A resolution failure is answered with its own status rather than thrown.
    const unresolvedRes = mockRes();
    jest
      .spyOn(buyerAccountResolver, 'resolveActiveBuyerAccount')
      .mockResolvedValueOnce({ ok: false, status: 409, error: 'not linked' });
    await buyerAccountController.getActiveAccount({ user: { sub: 'usr-1' } }, unresolvedRes, next);
    expect(unresolvedRes.status).toHaveBeenCalledWith(409);

    // The happy path returns the resolved account and says where it came from.
    const okRes = mockRes();
    jest
      .spyOn(buyerAccountResolver, 'resolveActiveBuyerAccount')
      .mockResolvedValueOnce({ ok: true, account: { id: 'org-1', organizationName: 'Real Co' } });
    await buyerAccountController.getActiveAccount({ user: { sub: 'usr-1' } }, okRes, next);
    expect(okRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, source: 'identity_database' })
    );

    jest.spyOn(storeService, 'addBuyerAccount').mockImplementationOnce(() => {
      throw new Error('Create Acc Error');
    });
    await buyerAccountController.createBuyerAccount({ body: { organizationName: 'Org', corporateEmail: 'e@o.com' }, user: buyerUser }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'updateBuyerAccount').mockImplementationOnce(() => {
      throw new Error('Update Acc Error');
    });
    await buyerAccountController.updateBuyerAccount({ params: { id: 'b-1' }, body: {}, user: buyerUser }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'deleteBuyerAccount').mockImplementationOnce(() => {
      throw new Error('Delete Acc Error');
    });
    await buyerAccountController.deleteBuyerAccount({ params: { id: 'b-1' }, user: buyerUser }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundDelete = mockRes();
    jest.spyOn(storeService, 'deleteBuyerAccount').mockReturnValueOnce(false);
    await buyerAccountController.deleteBuyerAccount({ params: { id: 'b-99' }, user: buyerUser }, notFoundDelete, next);
    expect(notFoundDelete.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'alignActiveBuyerAccount').mockImplementationOnce(() => {
      throw new Error('Set Active Error');
    });
    await buyerAccountController.setActiveAccount({ params: { id: 'b-1' }, user: buyerUser }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundRes = mockRes();
    jest.spyOn(storeService, 'alignActiveBuyerAccount').mockReturnValueOnce(null);
    await buyerAccountController.setActiveAccount({ params: { id: 'b-99' }, user: buyerUser }, notFoundRes, next);
    expect(notFoundRes.status).toHaveBeenCalledWith(404);

    const noPeriodRes = mockRes();
    await buyerAccountController.ingestHistoricalData({ body: {}, user: buyerUser }, noPeriodRes, next);
    expect(noPeriodRes.status).toHaveBeenCalledWith(400);

    const histRes = mockRes();
    await buyerAccountController.ingestHistoricalData({ body: { period: 'FY26', vendorRecords: [] }, user: buyerUser }, histRes, next);
    expect(histRes.json).toHaveBeenCalled();

    jest.spyOn(storeService, 'processHistoricalPurchaseData').mockImplementationOnce(() => {
      throw new Error('Hist error');
    });
    await buyerAccountController.ingestHistoricalData({ body: { period: 'FY26', vendorRecords: [] }, user: buyerUser }, histRes, next);
    expect(next).toHaveBeenCalled();
  });

  test('Catalogue Controller Error & 404 Branches', async () => {
    const next = jest.fn();
    const res = mockRes();
    const adminUser = { role: 'admin', email: 'admin@procucev.com' };

    jest.spyOn(storeService, 'getVendorCatalogue').mockImplementationOnce(() => {
      throw new Error('Cat error');
    });
    await catalogueController.getProducts({ query: {} }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'addProductToCatalogue').mockImplementationOnce(() => {
      throw new Error('Add prod error');
    });
    await catalogueController.addProduct(
      { body: { name: 'Item', sku: 'SKU', unitPrice: 10, vendorId: 'v-001' }, user: adminUser },
      res,
      next
    );
    expect(next).toHaveBeenCalled();

    // 'prod-1' is a real seeded item (no owning vendorId); admin bypasses
    // ownership so the mocked store call below is actually reached.
    jest.spyOn(storeService, 'updateCatalogueProduct').mockImplementationOnce(() => {
      throw new Error('Update prod error');
    });
    await catalogueController.updateProduct({ params: { id: 'prod-1' }, body: {}, user: adminUser }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'deleteCatalogueProduct').mockImplementationOnce(() => {
      throw new Error('Delete prod error');
    });
    await catalogueController.deleteProduct({ params: { id: 'prod-1' }, user: adminUser }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Config Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'getSystemConfig').mockImplementationOnce(() => {
      throw new Error('Cfg error');
    });
    await configController.getSystemConfig({}, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'updateSystemConfig').mockImplementationOnce(() => {
      throw new Error('Update cfg error');
    });
    await configController.updateSystemConfig({ body: {} }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('DB Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();
    // The controller now depends on the MySQL identity connection rather than the
    // removed PostgreSQL pool and seed routines.
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockImplementationOnce(() => {
      throw new Error('Health error');
    });
    await dbController.getDBStatus({}, res, next);
    expect(next).toHaveBeenCalled();

    next.mockClear();
    jest.spyOn(optimizationMetrics, 'getOptimizationMetrics').mockImplementationOnce(() => {
      throw new Error('Metrics error');
    });
    await dbController.getDBMetrics({}, res, next);
    expect(next).toHaveBeenCalled();
  });
  test('Evaluation Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'getEvaluations').mockImplementationOnce(() => {
      throw new Error('Eval error');
    });
    await evaluationController.getEvaluations({}, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'createEvaluation').mockImplementationOnce(() => {
      throw new Error('Create eval error');
    });
    await evaluationController.createEvaluation({ body: { vendorName: 'Apex' } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('RFQ Controller Error & 404 Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'getRFQs').mockImplementationOnce(() => {
      throw new Error('RFQ error');
    });
    await rfqController.getRFQs(buyerReq(), res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'getRFQById').mockImplementationOnce(() => {
      throw new Error('RFQ by ID error');
    });
    await rfqController.getRFQById(buyerReq({ params: { id: 'RFQ260409000900' } }), res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'createRFQ').mockImplementationOnce(() => {
      throw new Error('Create RFQ error');
    });
    // The payload must satisfy VALIDATION_SCHEMAS.createRFQ, otherwise the
    // handler returns 400 and never reaches the store call under test.
    await rfqController.createRFQ(
      buyerReq({
        body: {
          title: 'RFQ Title',
          category: 'Mechanical',
          budget: 1000,
          targetDeliveryDate: A_FUTURE_DATE,
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
        },
      }),
      res,
      next
    );
    expect(next).toHaveBeenCalled();

    // Test createRFQ with email_gateway source and explicit targetGatewayEmail
    const emailRes = mockRes();
    await rfqController.createRFQ(
      buyerReq({
        user: { email: 'buyer@procucev.com', orgName: 'L&T' },
        body: {
          title: 'Gate Valves Requisition',
          category: 'Piping',
          budget: 25000,
          targetDeliveryDate: '2028-10-15',
          deliveryLocation: 'Navi Mumbai',
          deliveryPincode: '400701',
          source: 'email_gateway',
          targetGatewayEmail: 'navinchaudhary.dev@gmail.com',
          sourceEmail: 'requisition@buyer.com',
          extractedEntities: [{ itemName: 'Valve', quantity: 2, technicalSpecs: 'DN50' }],
        },
      }),
      emailRes,
      next
    );
    expect(emailRes.status).toHaveBeenCalledWith(201);

    // Test createRFQ with targetGatewayEmail fallback to default recipient
    const emailRes2 = mockRes();
    await rfqController.createRFQ(
      {
        body: {
          title: 'Gasket Requisition',
          category: 'Piping',
          budget: 5000,
          targetDeliveryDate: '2028-10-15',
          deliveryLocation: 'Navi Mumbai',
          deliveryPincode: '400701',
          source: 'email_gateway',
          lineItems: [{ itemName: 'Gasket', quantity: 10 }],
        },
      },
      emailRes2,
      next
    );
    expect(emailRes2.status).toHaveBeenCalledWith(201);

    // ── Ingestion & summary error branches ──
    const rfqSummaryService = require('../src/services/rfqSummaryService');
    jest.spyOn(rfqSummaryService, 'buildPortfolioSummary').mockImplementationOnce(() => {
      throw new Error('Summary error');
    });
    await rfqController.getRFQSummary(buyerReq(), res, next);
    expect(next).toHaveBeenCalled();

    const ingestionService = require('../src/services/rfqIngestionService');
    jest.spyOn(ingestionService, 'buildRFQDraft').mockImplementationOnce(() => {
      throw new Error('Ingestion error');
    });
    await rfqController.ingestRFQ({ body: { lineItems: [{ itemName: 'Pump' }] } }, res, next);
    expect(next).toHaveBeenCalled();

    // A body-less request must fall back to {} rather than throwing on property
    // access — validation then rejects it for missing required fields.
    const noBodyRes = mockRes();
    await rfqController.createRFQ(buyerReq({ body: undefined }), noBodyRes, next);
    expect(noBodyRes.status).toHaveBeenCalledWith(400);

    const noBodyIngest = mockRes();
    await rfqController.ingestRFQ({}, noBodyIngest, next);
    expect(noBodyIngest.status).toHaveBeenCalledWith(400);

    // updateRFQ/deleteRFQ delegate auth entirely to the route's `authenticate`
    // middleware rather than self-enforcing it — called directly with no
    // session, canAccessRfq is unrestricted, so an id that matches nothing is
    // simply a 404, same as any other role.
    const notFoundUpdate = mockRes();
    await rfqController.updateRFQ({ params: { id: 'rfq-99' }, body: {} }, notFoundUpdate, next);
    expect(notFoundUpdate.status).toHaveBeenCalledWith(404);

    const existingRfq = storeService.createRFQ({ title: 'Error-branch fixture RFQ', category: 'Mechanical' });
    jest.spyOn(storeService, 'updateRFQ').mockImplementationOnce(() => {
      throw new Error('Update RFQ error');
    });
    await rfqController.updateRFQ({ params: { id: existingRfq.id }, body: {} }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundDelete = mockRes();
    await rfqController.deleteRFQ({ params: { id: 'rfq-99' } }, notFoundDelete, next);
    expect(notFoundDelete.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'deleteRFQ').mockImplementationOnce(() => {
      throw new Error('Delete RFQ error');
    });
    await rfqController.deleteRFQ({ params: { id: existingRfq.id } }, res, next);
    expect(next).toHaveBeenCalled();

    // A quote's vendor identity is resolved server-side from the caller's own
    // vendor record, so that record has to exist for the request to reach the
    // mocked store calls below. It is created here because nothing is seeded.
    const vendorUser = { role: 'vendor', email: 'rajesh@apexindustrial.in' };
    storeService.addVendor({
      name: 'Apex Industrial Dynamics Pvt Ltd',
      email: 'rajesh@apexindustrial.in',
      majorCategory: 'Engineering Spares - Mechanical',
    });

    const notFoundQuote = mockRes();
    jest.spyOn(storeService, 'addQuoteToRFQ').mockReturnValueOnce(null);
    await rfqController.addQuote(
      { params: { id: 'rfq-99' }, body: { vendorName: 'Apex', unitPrice: 100 }, user: vendorUser },
      notFoundQuote,
      next
    );
    expect(notFoundQuote.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'addQuoteToRFQ').mockImplementationOnce(() => {
      throw new Error('Quote error');
    });
    await rfqController.addQuote(
      { params: { id: 'rfq-1' }, body: { vendorName: 'Apex', unitPrice: 100 }, user: vendorUser },
      res,
      next
    );
    expect(next).toHaveBeenCalled();

    // generateEmailPreview delegates auth to route middleware the same way.
    const notFoundEmail = mockRes();
    await rfqController.generateEmailPreview(
      buyerReq({ params: { id: 'rfq-99' }, query: {} }),
      notFoundEmail,
      next
    );
    expect(notFoundEmail.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'getRFQById').mockImplementationOnce(() => {
      throw new Error('Email preview error');
    });
    await rfqController.generateEmailPreview(buyerReq({ params: { id: existingRfq.id }, query: {} }), res, next);
    expect(next).toHaveBeenCalled();

    const notFoundChaser = mockRes();
    jest.spyOn(storeService, 'triggerBatchChaser').mockReturnValueOnce(null);
    await rfqController.triggerBatchChaser({ params: { id: 'rfq-99' }, body: {} }, notFoundChaser, next);
    expect(notFoundChaser.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'triggerBatchChaser').mockImplementationOnce(() => {
      throw new Error('Chaser error');
    });
    await rfqController.triggerBatchChaser({ params: { id: 'rfq-1' }, body: {} }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'approvePurchaseOrder').mockImplementationOnce(() => {
      throw new Error('PO error');
    });
    await rfqController.approvePO({ params: { id: 'rfq-1' }, body: { vendorName: 'Apex', totalAmount: 100 } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Support Chat Error Branch', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'handleSupportChat').mockImplementationOnce(() => {
      throw new Error('Chat error');
    });
    await supportChatController.sendMessage({ body: { prompt: 'Hi' } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Vendor Controller Error & 404 Branches', async () => {
    const next = jest.fn();
    const res = mockRes();
    const adminUser = { role: 'admin', email: 'admin@procucev.com' };
    const buyerUser = { role: 'buyer', email: 'buyer@procucev.com' };

    jest.spyOn(storeService, 'getVendors').mockImplementationOnce(() => {
      throw new Error('Vendors error');
    });
    await vendorController.getVendors({}, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'getVendorById').mockImplementationOnce(() => {
      throw new Error('Vendor by id error');
    });
    await vendorController.getVendorById({ params: { id: 'v-1' } }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'addVendor').mockImplementationOnce(() => {
      throw new Error('Add vendor error');
    });
    await vendorController.createVendor({ body: { name: 'V', majorCategory: 'Cat' }, user: adminUser }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundUpdate = mockRes();
    jest.spyOn(storeService, 'updateVendor').mockReturnValueOnce(null);
    await vendorController.updateVendor({ params: { id: 'v-99' }, body: {} }, notFoundUpdate, next);
    expect(notFoundUpdate.status).toHaveBeenCalledWith(404);

    // 'v-1' never matches a real seeded vendor, so it always hit the 404
    // pre-check and never reached the mocked store call below; 'v-001' with
    // an admin caller (bypasses ownership) actually gets there.
    jest.spyOn(storeService, 'updateVendor').mockImplementationOnce(() => {
      throw new Error('Update vendor error');
    });
    await vendorController.updateVendor({ params: { id: 'v-001' }, body: {}, user: adminUser }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundDelete = mockRes();
    jest.spyOn(storeService, 'deleteVendor').mockReturnValueOnce(false);
    await vendorController.deleteVendor({ params: { id: 'v-99' } }, notFoundDelete, next);
    expect(notFoundDelete.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'deleteVendor').mockImplementationOnce(() => {
      throw new Error('Delete vendor error');
    });
    await vendorController.deleteVendor({ params: { id: 'v-002' }, user: adminUser }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundRating = mockRes();
    jest.spyOn(storeService, 'reviseVendorRating').mockReturnValueOnce(null);
    await vendorController.reviseRating(
      { params: { id: 'v-99' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 }, user: buyerUser },
      notFoundRating,
      next
    );
    expect(notFoundRating.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'reviseVendorRating').mockImplementationOnce(() => {
      throw new Error('Rating error');
    });
    await vendorController.reviseRating(
      { params: { id: 'v-1' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 }, user: buyerUser },
      res,
      next
    );
    expect(next).toHaveBeenCalled();

    const notFoundEmail = mockRes();
    jest.spyOn(storeService, 'getVendorById').mockReturnValueOnce(null);
    await vendorController.generateOnboardingEmailPreview({ params: { id: 'v-99' }, user: buyerUser }, notFoundEmail, next);
    expect(notFoundEmail.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'getVendorById').mockImplementationOnce(() => {
      throw new Error('Email preview error');
    });
    await vendorController.generateOnboardingEmailPreview({ params: { id: 'v-1' }, user: buyerUser }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundCat = mockRes();
    jest.spyOn(storeService, 'updateVendorCategories').mockReturnValueOnce(null);
    await vendorController.updateCategories({ params: { id: 'v-99' }, body: {} }, notFoundCat, next);
    expect(notFoundCat.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'updateVendorCategories').mockImplementationOnce(() => {
      throw new Error('Update cat error');
    });
    await vendorController.updateCategories({ params: { id: 'v-001' }, body: {}, user: adminUser }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Vendor Subscription Update Error, 404 & Validation Branches', async () => {
    const next = jest.fn();
    const res = mockRes();
    const adminUser = { role: 'admin', email: 'admin@procucev.com' };

    const notFoundSub = mockRes();
    jest.spyOn(storeService, 'getVendorById').mockReturnValueOnce(null);
    await vendorController.updateSubscription(
      { params: { id: 'v-99' }, body: { plan: 'connect' }, user: adminUser },
      notFoundSub,
      next
    );
    expect(notFoundSub.status).toHaveBeenCalledWith(404);

    // Plan validation runs after the vendor lookup, so this needs a vendor that
    // actually exists — 'v-001' was a seeded id and now resolves to nothing.
    const subscriptionVendor = storeService.addVendor({
      name: 'Subscription Branch Vendor',
      email: 'subscription@branch-vendor.test',
      majorCategory: 'Engineering Spares - Mechanical',
    });
    const invalidPlan = mockRes();
    await vendorController.updateSubscription(
      { params: { id: subscriptionVendor.id }, body: { plan: 'not-a-real-plan' }, user: adminUser },
      invalidPlan,
      next
    );
    expect(invalidPlan.status).toHaveBeenCalledWith(400);

    // Reaching the catch block requires the vendor lookup to succeed first, so
    // this names the vendor created above rather than the old seeded 'v-001'.
    jest.spyOn(storeService, 'updateVendor').mockImplementationOnce(() => {
      throw new Error('Update subscription error');
    });
    await vendorController.updateSubscription(
      { params: { id: subscriptionVendor.id }, body: { plan: 'premium' }, user: adminUser },
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});
