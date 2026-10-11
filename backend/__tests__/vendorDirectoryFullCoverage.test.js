const bootstrapController = require('../src/controllers/bootstrapController');
const buyerAccountController = require('../src/controllers/buyerAccountController');
const vendorController = require('../src/controllers/vendorController');
const identityQueries = require('../src/db/identityQueries');
const rootResolvers = require('../src/graphql/resolvers');
const storeService = require('../src/services/storeService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const pool = require('../src/db/pool');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Vendor Directory, Buyer Isolation & Full Unit Coverage Suite', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('bootstrapController.js', () => {
    test('getBootstrap with buyer user role finding account', async () => {
      const req = {
        user: { role: 'buyer', email: 'buyer@enterprise.com', sub: 'u-123' },
        query: { refresh: 'true' },
      };
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'ba-99' });
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue(true);
      jest.spyOn(storeService, 'getBootstrapData').mockReturnValue({ rfqs: [], vendors: [] });

      await bootstrapController.getBootstrap(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('getBootstrap with buyer user role falling back to sub/email', async () => {
      const req = {
        user: { role: 'buyer', email: 'nobuyer@enterprise.com', sub: 'u-sub-456' },
      };
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(null);
      await bootstrapController.getBootstrap(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('getBootstrap with query buyerId', async () => {
      const req = {
        user: null,
        query: { buyerId: 'ba-query-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await bootstrapController.getBootstrap(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('getBootstrap error handling', async () => {
      const req = {};
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getBootstrapData').mockImplementation(() => {
        throw new Error('Bootstrap crash');
      });

      await bootstrapController.getBootstrap(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('buyerAccountController.js', () => {
    test('role gating: unauthenticated, forbidden, and allowed roles', () => {
      const res1 = mockRes();
      const next1 = jest.fn();
      buyerAccountController.createBuyerAccount({ user: null }, res1, next1);
      expect(res1.status).toHaveBeenCalledWith(401);

      const res2 = mockRes();
      buyerAccountController.createBuyerAccount({ user: { role: 'vendor' } }, res2, next1);
      expect(res2.status).toHaveBeenCalledWith(403);

      const res3 = mockRes();
      buyerAccountController.createBuyerAccount(
        { user: { role: 'admin' }, body: { organizationName: 'Admin Org', corporateEmail: 'admin@org.com' } },
        res3,
        next1
      );
      expect(res3.status).toHaveBeenCalledWith(201);
    });

    test('getBuyerAccounts and getActiveAccount', async () => {
      const res = mockRes();
      const next = jest.fn();
      buyerAccountController.getBuyerAccounts({}, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // getBuyerAccounts error
      jest.spyOn(storeService, 'getBuyerAccounts').mockImplementation(() => {
        throw new Error('fail');
      });
      buyerAccountController.getBuyerAccounts({}, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('getActiveAccount resolver outcomes and error', async () => {
      const buyerAccountResolver = require('../src/services/buyerAccountResolver');
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(buyerAccountResolver, 'resolveActiveBuyerAccount').mockResolvedValueOnce({
        ok: true,
        account: { id: 'ba-1', orgName: 'Test Org' },
      });
      await buyerAccountController.getActiveAccount({ user: { email: 'test@buyer.com' } }, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(buyerAccountResolver, 'resolveActiveBuyerAccount').mockResolvedValueOnce({
        ok: false,
        status: 404,
        error: 'Not found',
      });
      await buyerAccountController.getActiveAccount({ user: { email: 'test@buyer.com' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(404);

      jest.spyOn(buyerAccountResolver, 'resolveActiveBuyerAccount').mockRejectedValueOnce(new Error('crash'));
      await buyerAccountController.getActiveAccount({ user: { email: 'test@buyer.com' } }, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('createBuyerAccount missing fields, success, and error', () => {
      const res = mockRes();
      const next = jest.fn();

      buyerAccountController.createBuyerAccount(
        { user: { role: 'buyer' }, body: { organizationName: '' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      buyerAccountController.createBuyerAccount(
        { user: { role: 'admin' }, body: { organizationName: 'Acme Corp', corporateEmail: 'acme@test.com' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(201);

      jest.spyOn(storeService, 'addBuyerAccount').mockImplementation(() => {
        throw new Error('store fail');
      });
      buyerAccountController.createBuyerAccount(
        { user: { role: 'admin' }, body: { organizationName: 'Acme', corporateEmail: 'a@a.com' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('updateBuyerAccount not found, success, and error', () => {
      const res = mockRes();
      const next = jest.fn();

      buyerAccountController.updateBuyerAccount(
        { user: { role: 'buyer' }, params: { id: 'non-existent' }, body: { organizationName: 'New' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      const accounts = storeService.getBuyerAccounts();
      if (accounts.length > 0) {
        buyerAccountController.updateBuyerAccount(
          { user: { role: 'buyer' }, params: { id: accounts[0].id }, body: { organizationName: 'Updated Name' } },
          res,
          next
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      }

      jest.spyOn(storeService, 'updateBuyerAccount').mockImplementation(() => {
        throw new Error('err');
      });
      buyerAccountController.updateBuyerAccount(
        { user: { role: 'buyer' }, params: { id: 'ba-1' }, body: {} },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('deleteBuyerAccount not found, success, and error', () => {
      const res = mockRes();
      const next = jest.fn();

      buyerAccountController.deleteBuyerAccount(
        { user: { role: 'buyer' }, params: { id: 'non-existent' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      const created = storeService.addBuyerAccount({ organizationName: 'To Del', corporateEmail: 'todel@test.com' });
      buyerAccountController.deleteBuyerAccount(
        { user: { role: 'buyer' }, params: { id: created.id } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(storeService, 'deleteBuyerAccount').mockImplementation(() => {
        throw new Error('err');
      });
      buyerAccountController.deleteBuyerAccount(
        { user: { role: 'buyer' }, params: { id: 'ba-1' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('setActiveAccount not found, success, and error', () => {
      const res = mockRes();
      const next = jest.fn();

      buyerAccountController.setActiveAccount(
        { user: { role: 'buyer' }, params: { id: 'non-existent' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      const accounts = storeService.getBuyerAccounts();
      if (accounts.length > 0) {
        buyerAccountController.setActiveAccount(
          { user: { role: 'buyer' }, params: { id: accounts[0].id } },
          res,
          next
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      }

      jest.spyOn(storeService, 'alignActiveBuyerAccount').mockImplementation(() => {
        throw new Error('err');
      });
      buyerAccountController.setActiveAccount(
        { user: { role: 'buyer' }, params: { id: 'ba-1' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('createSubscriptionPaymentLink validation and success flows', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ mobile: '9123456780' });

      // Account not found and user has no email
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: '' }, params: { id: 'none' }, body: { plan: 'version_1' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      // Account without corporateEmail
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce({ id: 'ba-no-email', corporateEmail: '' });
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'test@b.com' }, params: { id: 'ba-no-email' }, body: { plan: 'version_1' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      // Invalid plan
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce({ id: 'ba-1', corporateEmail: 'b@b.com' });
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'ba-1' }, body: { plan: 'invalid_plan' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      // User without prior account record created on the fly with orgName
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce(null);
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({ mobile: '9123456780' });
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValueOnce({
        zohoPaymentLinkId: 'zpl-new',
        paymentUrl: 'https://payments.zoho.in/pay/new',
        status: 'CREATED',
        rawResponse: {},
      });
      await buyerAccountController.createSubscriptionPaymentLink(
        {
          user: { role: 'buyer', email: 'neworgbuyer@test.com', orgName: 'New Org Ltd' },
          params: { id: 'ba-new' },
          body: { plan: 'version_2' },
        },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Successful payment link creation for version_3
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce({
        id: 'ba-1',
        corporateEmail: 'b@b.com',
        mobileNumber: '9876543210',
      });
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValueOnce({
        zohoPaymentLinkId: 'zpl-123',
        paymentUrl: 'https://payments.zoho.in/pay/123',
        status: 'CREATED',
        rawResponse: {},
      });
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'ba-1' }, body: { plan: 'version_3' } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Exception handling
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockRejectedValueOnce(new Error('Zoho down'));
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'ba-1' }, body: { plan: 'version_1' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(502);

      // No mobileNumber on the domain record and no phone in the identity record either
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce({ id: 'ba-2', corporateEmail: 'nomobile@b.com' });
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({ mobile: '' });
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'nomobile@b.com' }, params: { id: 'ba-2' }, body: { plan: 'version_1' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('ingestHistoricalData validation, processing, and error', async () => {
      const res = mockRes();
      const next = jest.fn();

      await buyerAccountController.ingestHistoricalData(
        { user: { role: 'buyer', email: 'b@b.com' }, body: { period: '' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      await buyerAccountController.ingestHistoricalData(
        {
          user: { role: 'buyer', email: 'b@b.com' },
          body: {
            period: 'FY2025-Q1',
            vendorRecords: [{ name: 'Test Supp', email: 's@s.com', majorCategory: 'Mechanical' }],
          },
        },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(storeService, 'processHistoricalPurchaseData').mockImplementation(() => {
        throw new Error('err');
      });
      await buyerAccountController.ingestHistoricalData(
        { user: { role: 'buyer', email: 'b@b.com' }, body: { period: 'FY2025-Q1' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('aiCrossMatch all category keywords and conditions for 100% branch coverage', () => {
      const res = mockRes();
      const next = jest.fn();

      const vendors = [
        { id: 'v-it-all', vendorCode: 'V-IT-ALL', companyName: 'Google Microsoft Azure Partner', email: 'itall@test.com' },
        { id: 'v-it-subs', vendorCode: 'V-IT-SUBS', companyName: '365 Subscription Renewal Provider', email: 'subs@test.com' },
        { id: 'v-it-data', vendorCode: 'V-IT-DATA', companyName: 'BigQuery Data Analytics Ltd', email: 'data@test.com' },
        { id: 'v-it-infra', vendorCode: 'V-IT-INFRA', companyName: 'Datacenter Server Infrastructure', email: 'infra@test.com' },
        { id: 'v-it-plain-saas', vendorCode: 'V-IT-SAAS', companyName: 'Plain SaaS Provider', email: 'saas@test.com' },
        { id: 'v-mech-valves', vendorCode: 'V-MECH-V', companyName: 'Globe Gate Valves & Fittings', email: 'valves@test.com' },
        { id: 'v-mech-pumps', vendorCode: 'V-MECH-P', companyName: 'Slurry Pumps & Compressors', email: 'pumps@test.com' },
        { id: 'v-mech-motors', vendorCode: 'V-MECH-M', companyName: 'Electric Motor & Hose Spares', email: 'motors@test.com' },
        { id: 'v-elec-panels', vendorCode: 'V-ELEC-P', companyName: 'Switchgear Panels & Cables', email: 'elec1@test.com' },
        { id: 'v-elec-mccb', vendorCode: 'V-ELEC-M', companyName: 'MCCB Breakers Ltd', email: 'elec2@test.com' },
        { id: 'v-civil-peb', vendorCode: 'V-CIVIL-P', companyName: 'PEB Structure & Civil Construction', email: 'civil1@test.com' },
        { id: 'v-civil-tmt', vendorCode: 'V-CIVIL-T', companyName: 'TMT Steel Bars & Roofing', email: 'civil2@test.com' },
        { id: 'v-gen-fallback', vendorCode: 'V-GEN-F', companyName: 'Custom Fasteners and Consumables', email: 'gen@test.com' },
        { id: 'v-unmatched', vendorCode: 'V-UNMATCHED', companyName: 'Zero PO Vendor', email: 'none@test.com' },
      ];

      const poLineItems = [
        { vendorIdentifier: 'Google Microsoft', itemName: 'gcp compute credits & cloud storage', totalSpend: 25000000 },
        { vendorIdentifier: 'V-IT-SUBS', itemName: '365 workspace teams windows server renewal subscription license', totalSpend: 500000 },
        { vendorIdentifier: 'BigQuery Data', itemName: 'bigquery power bi analytics data platform', totalSpend: 300000 },
        { vendorIdentifier: 'Datacenter Server', itemName: 'datacenter server infrastructure', totalSpend: 400000 },
        { vendorIdentifier: 'Plain SaaS', itemName: 'saas software', totalSpend: 150000 }, // triggers secondSetMinors.length === 0 -> Enterprise Software & Licenses
        { vendorIdentifier: 'V-MECH-V', itemName: 'globe valve gate valve', totalSpend: 200000 },
        { vendorIdentifier: 'Slurry Pumps', itemName: 'pump compressor', totalSpend: 180000 },
        { vendorIdentifier: 'V-MECH-M', itemName: 'hose motor', totalSpend: 95000 },
        { vendorIdentifier: 'Switchgear Panels', itemName: 'switchgear panel cable', totalSpend: 45000 },
        { vendorIdentifier: 'V-ELEC-M', itemName: 'breaker mccb', totalSpend: 30000 },
        { vendorIdentifier: 'PEB Structure', itemName: 'peb civil', totalSpend: 80000 },
        { vendorIdentifier: 'V-CIVIL-T', itemName: 'tmt steel', totalSpend: 75000 },
        { vendorIdentifier: 'Custom Fasteners', itemName: 'bolts and tools', totalSpend: 1200 },
      ];

      buyerAccountController.aiCrossMatch(
        { user: { role: 'buyer' }, body: { vendors, poLineItems } },
        res,
        next
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          totalMatched: 13,
          totalUnmatched: 1,
        })
      );
    });

    test('createBuyerAccount missing email vs missing organizationName', () => {
      const res1 = mockRes();
      const next1 = jest.fn();
      buyerAccountController.createBuyerAccount(
        { user: { role: 'buyer' }, body: { organizationName: 'Name Only' } },
        res1,
        next1
      );
      expect(res1.status).toHaveBeenCalledWith(400);

      const res2 = mockRes();
      buyerAccountController.createBuyerAccount(
        { user: { role: 'buyer' }, body: { corporateEmail: 'email@only.com' } },
        res2,
        next1
      );
      expect(res2.status).toHaveBeenCalledWith(400);
    });
  });

  describe('vendorController.js', () => {
    test('assertVendorOwnership and update/delete branches', async () => {
      const res = mockRes();
      const next = jest.fn();

      const existingVendor = {
        id: 'v-test-ownership-1',
        email: 'vendor-owner@test.com',
        buyerId: 'ba-buyer-1',
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(existingVendor);

      // No user on existing vendor
      await vendorController.updateVendor({ user: null, params: { id: existingVendor.id }, body: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);

      // Vendor role editing own profile
      const resVendorSelf = mockRes();
      await vendorController.updateVendor(
        {
          user: { role: 'vendor', email: 'vendor-owner@test.com' },
          params: { id: existingVendor.id },
          body: { name: 'Self Name', rating: 5.0 },
        },
        resVendorSelf,
        next
      );
      expect(resVendorSelf.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Admin role is always allowed
      const resAdmin = mockRes();
      await vendorController.updateVendor(
        { user: { role: 'admin' }, params: { id: existingVendor.id }, body: { name: 'Admin Updated' } },
        resAdmin,
        next
      );
      expect(resAdmin.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Buyer owning vendor via v-hist prefix
      const resBuyer = mockRes();
      const histVendor = { id: 'v-hist-123', email: 'hist@test.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(histVendor);
      await vendorController.updateVendor(
        { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: histVendor.id }, body: { name: 'Hist Updated' } },
        resBuyer,
        next
      );
      expect(resBuyer.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Buyer owning vendor via v-buyer-, v-navin-, v-1788, vm- prefixes
      for (const testId of ['v-buyer-1', 'v-navin-1', 'v-1788-1', 'vm-1']) {
        const resB = mockRes();
        const vPrefix = { id: testId, email: `${testId}@test.com` };
        jest.spyOn(storeService, 'getVendorById').mockReturnValue(vPrefix);
        await vendorController.updateVendor(
          { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: testId }, body: { name: 'Prefix Update' } },
          resB,
          next
        );
        expect(resB.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      }

      // Buyer owning vendor via buyerAccountId or buyerEmail matching
      const resBuyerAccountMatch = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-match-ba',
        buyerAccountId: 'ba-buyer-1',
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'ba-buyer-1' });
      await vendorController.updateVendor(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v-match-ba' }, body: { name: 'Matched' } },
        resBuyerAccountMatch,
        next
      );
      expect(resBuyerAccountMatch.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      const resBuyerEmailMatch = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-match-email',
        buyerEmail: 'b@b.com',
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'b@b.com' });
      await vendorController.updateVendor(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v-match-email' }, body: { name: 'Matched Email' } },
        resBuyerEmailMatch,
        next
      );
      expect(resBuyerEmailMatch.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Buyer not owning vendor
      const resBuyerForbidden = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-other',
        buyerId: 'ba-other-org',
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'ba-buyer-1' });
      await vendorController.updateVendor(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v-other' }, body: { name: 'Other' } },
        resBuyerForbidden,
        next
      );
      expect(resBuyerForbidden.status).toHaveBeenCalledWith(403);

      // Deleting non-existent vendor with buyer pattern (idempotent delete)
      for (const delId of ['v-hist-999', 'v-buyer-999', 'v-navin-999', 'v-1788-999', 'vm-999', 'v-ingest-999', 'v-bulk-999']) {
        const resDelIdempotent = mockRes();
        jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
        await vendorController.deleteVendor(
          { user: { role: 'buyer', email: 'b@b.com' }, params: { id: delId } },
          resDelIdempotent,
          next
        );
        expect(resDelIdempotent.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      }

      // Deleting non-existent vendor with non-buyer pattern -> 404
      const resDel404 = mockRes();
      await vendorController.deleteVendor(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'some-random-id' } },
        resDel404,
        next
      );
      expect(resDel404.status).toHaveBeenCalledWith(404);

      // Deleting existing vendor successfully
      const resDelOk = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(existingVendor);
      await vendorController.deleteVendor(
        { user: { role: 'admin' }, params: { id: existingVendor.id } },
        resDelOk,
        next
      );
      expect(resDelOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('reviseRating validation and success flows', async () => {
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getVendorById').mockReturnValue({ id: 'v1', name: 'Vendor 1' });

      // Vendor role cannot rate
      await vendorController.reviseRating(
        { user: { role: 'vendor' }, params: { id: 'v1' }, body: {} },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(403);

      // Missing scores
      const resMissing = mockRes();
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v1' }, body: { qualityScore: 90, costScore: 90 } },
        resMissing,
        next
      );
      expect(resMissing.status).toHaveBeenCalledWith(400);

      // Out of range score (> 100)
      const resRange = mockRes();
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v1' }, body: { qualityScore: 150, costScore: 90, deliveryScore: 90 } },
        resRange,
        next
      );
      expect(resRange.status).toHaveBeenCalledWith(400);

      // Vendor not found in storeService
      const res404 = mockRes();
      jest.spyOn(storeService, 'reviseVendorRating').mockReturnValueOnce(null);
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: 'v1' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 } },
        res404,
        next
      );
      expect(res404.status).toHaveBeenCalledWith(404);

      // Success
      const resOk = mockRes();
      jest.spyOn(storeService, 'reviseVendorRating').mockReturnValueOnce({ id: 'v-revised', rating: 4.8 });
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: 'v1' }, body: { qualityScore: 95, costScore: 90, deliveryScore: 92 } },
        resOk,
        next
      );
      expect(resOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Exception handling
      jest.spyOn(storeService, 'reviseVendorRating').mockImplementation(() => {
        throw new Error('crash');
      });
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: 'v1' }, body: { qualityScore: 95, costScore: 90, deliveryScore: 92 } },
        resOk,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('updateCategories and generateOnboardingEmailPreview validation and success flows', async () => {
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v1',
        email: 'vendor@test.com',
        buyerId: 'buyer-1',
        tempPassword: 'temporary-pass',
      });

      // Non-owner updating categories -> 403
      await vendorController.updateCategories(
        { user: { role: 'vendor', email: 'other@vendor.com' }, params: { id: 'v1' }, body: {} },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(403);

      // Owner (admin) updating categories
      const resAdmin = mockRes();
      jest.spyOn(storeService, 'updateVendorCategories').mockReturnValueOnce({ id: 'v1', clientMappedCategories: ['Valves'] });
      await vendorController.updateCategories(
        { user: { role: 'admin' }, params: { id: 'v1' }, body: { clientMappedCategories: ['Valves'] } },
        resAdmin,
        next
      );
      expect(resAdmin.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // generateOnboardingEmailPreview: vendor role forbidden (403)
      const resEmailVendor = mockRes();
      await vendorController.generateOnboardingEmailPreview(
        { user: { role: 'vendor' }, params: { id: 'v1' } },
        resEmailVendor,
        next
      );
      expect(resEmailVendor.status).toHaveBeenCalledWith(403);

      // generateOnboardingEmailPreview: buyer success
      const resEmailBuyer = mockRes();
      await vendorController.generateOnboardingEmailPreview(
        { user: { role: 'buyer', sub: 'buyer-1' }, params: { id: 'v1' } },
        resEmailBuyer,
        next
      );
      expect(resEmailBuyer.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('assertBulkImportRole branches', async () => {
      const res1 = mockRes();
      const next1 = jest.fn();
      vendorController.bulkImportVendors({ user: null }, res1, next1);
      expect(res1.status).toHaveBeenCalledWith(401);

      const res2 = mockRes();
      vendorController.bulkImportVendors({ user: { role: 'vendor' } }, res2, next1);
      expect(res2.status).toHaveBeenCalledWith(403);

      // A buyer role passes the gate but is 403'd separately if their session
      // has no linked buyer organisation to attribute the upload to.
      const res3 = mockRes();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      await vendorController.bulkImportVendors({ user: { role: 'buyer', email: 'nolink@b.com' } }, res3, next1);
      expect(res3.status).toHaveBeenCalledWith(403);

      const res4 = mockRes();
      vendorController.bulkImportVendors(
        { user: { role: 'category_manager' }, body: { vendors: [] } },
        res4,
        next1
      );
      expect(res4.status).not.toHaveBeenCalledWith(403);
    });

    test('getVendors and getVendorById with buyer scoping and error branches', async () => {
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getVendors({ user: { role: 'buyer', email: 'b@b.com' }, query: {} }, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      await vendorController.getVendorById(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'non-existent' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      jest.spyOn(storeService, 'getVendors').mockImplementation(() => {
        throw new Error('fail');
      });
      await vendorController.getVendors({ query: {} }, res, next);
      expect(next).toHaveBeenCalled();

      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('fail');
      });
      await vendorController.getVendorById({ params: { id: 'v1' } }, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('getVendors: explicit buyerId query param, search filtering, and pagination clamping', async () => {
      const next = jest.fn();

      storeService.addVendor({ name: 'Paginated Acme Co', email: 'paginated-acme@example.com', majorCategory: 'Fasteners' });
      storeService.addVendor({ name: 'Paginated Zenith Co', email: 'paginated-zenith@example.com', majorCategory: 'Cables' });

      // Non-buyer role reading an explicit ?buyerId= query param.
      const res1 = mockRes();
      await vendorController.getVendors({ user: { role: 'admin' }, query: { buyerId: 'some-buyer-id' } }, res1, next);
      expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Search narrows to matching rows only.
      const res2 = mockRes();
      await vendorController.getVendors({ query: { search: 'paginated-zenith' } }, res2, next);
      const searchPayload = res2.json.mock.calls[0][0];
      expect(searchPayload.data.some((v) => v.email === 'paginated-zenith@example.com')).toBe(true);
      expect(searchPayload.data.some((v) => v.email === 'paginated-acme@example.com')).toBe(false);

      // page=1 with an out-of-range/invalid pageSize clamps to the default,
      // and requesting more than MAX_VENDOR_PAGE_SIZE clamps to the cap.
      const res3 = mockRes();
      await vendorController.getVendors({ query: { page: '1', pageSize: 'not-a-number' } }, res3, next);
      const p1 = res3.json.mock.calls[0][0].pagination;
      expect(p1).toMatchObject({ page: 1, pageSize: 50 });

      const res4 = mockRes();
      await vendorController.getVendors({ query: { page: '0', pageSize: '999999' } }, res4, next);
      const p2 = res4.json.mock.calls[0][0].pagination;
      expect(p2).toMatchObject({ page: 1, pageSize: 200 });

      // A page beyond the last page returns an empty slice, not an error.
      const res5 = mockRes();
      await vendorController.getVendors({ query: { page: '999999', pageSize: '10' } }, res5, next);
      expect(res5.json.mock.calls[0][0].data).toEqual([]);
    });

    test('getVendors: buyerId=all with a configured pool answers straight from Postgres (bypassing the in-memory resync)', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-sql-1', name: 'SQL Path Vendor', email: 'sql-path@example.com' }],
        total: 12345,
      });
      const getVendorsSpy = jest.spyOn(storeService, 'getVendors');

      try {
        const res = mockRes();
        await vendorController.getVendors(
          { query: { buyerId: 'all', page: '3', pageSize: '25', search: 'sql' } },
          res,
          next
        );

        expect(pageSpy).toHaveBeenCalledWith({ limit: 25, offset: 50, search: 'sql', category: '', scopedBuyerId: '' });
        // The expensive full-table resync path must not run at all for this case.
        expect(getVendorsSpy).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({
          success: true,
          source: 'persisted',
          data: [{ id: 'v-sql-1', name: 'SQL Path Vendor', email: 'sql-path@example.com' }],
          pagination: { page: 3, pageSize: 25, total: 12345, totalPages: Math.ceil(12345 / 25) },
        });
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
        getVendorsSpy.mockRestore();
      }
    });

    test('getVendors: buyerId=all falls back to the in-memory path when no DB pool is configured', async () => {
      const next = jest.fn();
      const originalPool = pool.pool;
      pool.pool = null;

      try {
        const res = mockRes();
        await vendorController.getVendors({ query: { buyerId: 'all', page: '1', pageSize: '10' } }, res, next);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      } finally {
        pool.pool = originalPool;
      }
    });

    test('getVendors: a buyer-scoped paginated request also answers straight from Postgres, scoped to public-or-mine', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-scoped-1', name: 'Scoped Vendor' }],
        total: 42,
      });
      const getVendorsSpy = jest.spyOn(storeService, 'getVendors');
      const buyerAccountSpy = jest
        .spyOn(storeService, 'getBuyerAccountByEmail')
        .mockResolvedValue({ id: 'ba-scoped-1' });

      try {
        const res = mockRes();
        await vendorController.getVendors(
          { user: { role: 'buyer', email: 'scoped-buyer@example.com' }, query: { page: '1', pageSize: '10' } },
          res,
          next
        );

        expect(pageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 10, offset: 0, scopedBuyerId: expect.any(String) })
        );
        const call = pageSpy.mock.calls[0][0];
        expect(call.scopedBuyerId).not.toBe('');
        // Buyer-scoped pagination must not trigger the whole-table resync either —
        // the real fix for 600k-row scale, not just the 'all' listing.
        expect(getVendorsSpy).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, source: 'persisted', data: [{ id: 'v-scoped-1', name: 'Scoped Vendor' }] })
        );
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
        getVendorsSpy.mockRestore();
        buyerAccountSpy.mockRestore();
      }
    });

    test('getVendors: a category query param is passed through to the SQL fast path', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });

      try {
        const res = mockRes();
        await vendorController.getVendors(
          { query: { buyerId: 'all', page: '1', pageSize: '10', category: 'Fasteners' } },
          res,
          next
        );

        expect(pageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'Fasteners' })
        );
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
      }
    });

    test('getVendors: the in-memory fallback also applies the category filter when no pool is configured', async () => {
      const next = jest.fn();
      const originalPool = pool.pool;
      pool.pool = null;
      const getVendorsSpy = jest.spyOn(storeService, 'getVendors').mockResolvedValue([
        { id: 'v-1', name: 'A', majorCategory: 'Fasteners' },
        { id: 'v-2', name: 'B', majorCategory: 'Electrical' },
      ]);

      try {
        const res = mockRes();
        await vendorController.getVendors({ query: { category: 'Fasteners' } }, res, next);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, data: [{ id: 'v-1', name: 'A', majorCategory: 'Fasteners' }] })
        );
      } finally {
        pool.pool = originalPool;
        getVendorsSpy.mockRestore();
      }
    });

    test('createVendor role handling and validation', async () => {
      const res = mockRes();
      const next = jest.fn();

      // Buyer forbidden to create vendor directly via this endpoint
      await vendorController.createVendor({ user: { role: 'buyer' }, body: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);

      // Missing name
      await vendorController.createVendor(
        { user: { role: 'admin' }, body: { majorCategory: 'Mechanical' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      // Admin role with query buyerId
      await vendorController.createVendor(
        { user: { role: 'admin' }, query: { buyerId: 'ba-1' }, body: { name: 'Admin Vendor', majorCategory: 'Civil' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(201);

      // Success
      await vendorController.createVendor(
        { user: { role: 'vendor', email: 'v@v.com' }, body: { name: 'Vendor 1', majorCategory: 'Mechanical' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(201);

      // A duplicate-email add is rejected before addVendor is ever called —
      // not after. addVendor fires real side effects (an identity-account
      // write with a fresh temp password, a real onboarding email); a
      // duplicate that only got caught afterward, by confirmVendorPersisted's
      // DB check, used to let that fire anyway and silently overwrite the
      // existing account's real password/phone even though the vendor record
      // itself was rejected.
      const addVendorSpy = jest.spyOn(storeService, 'addVendor');
      await vendorController.createVendor(
        { user: { role: 'vendor', email: 'v@v.com' }, body: { name: 'Vendor 1 Again', majorCategory: 'Mechanical' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(409);
      expect(addVendorSpy).not.toHaveBeenCalled();
      addVendorSpy.mockRestore();

      // Exception handling. A distinct email from the "Success" case above —
      // createVendor now checks for an existing vendor email before addVendor
      // is ever called, so reusing v@v.com here would short-circuit to a 409
      // and never reach the mocked throw this test is exercising.
      jest.spyOn(storeService, 'addVendor').mockImplementation(() => {
        throw new Error('err');
      });
      await vendorController.createVendor(
        { user: { role: 'vendor', email: 'v2@v.com' }, body: { name: 'Vendor 2', majorCategory: 'Mechanical' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('createVendor: buyer with a linked account can add a vendor, scoped and whitelisted server-side', async () => {
      const buyerAccount = storeService.addBuyerAccount({
        organizationName: 'Real Buyer Co',
        corporateEmail: 'real-buyer@example.com',
      });

      const res = mockRes();
      const next = jest.fn();
      await vendorController.createVendor(
        {
          user: { role: 'buyer', email: 'real-buyer@example.com' },
          body: {
            name: 'Direct Deal Vendor',
            email: 'direct-deal@vendor.test',
            phone: '9876543210',
            majorCategory: 'Fasteners',
            // Attempted spoofing of ownership/identity fields — must be
            // ignored, not trusted from the request body.
            buyerId: 'someone-elses-buyer-id',
            addedByBuyerCompany: 'A Totally Different Company',
            subscriptionPlan: 'select',
          },
        },
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerId).toBe(buyerAccount.id);
      expect(created.addedByBuyerCompany).toBe('Real Buyer Co');
      expect(created.subscriptionPlan).not.toBe('select');
    });

    test('createVendor: buyer omitting a vendor email is rejected', async () => {
      storeService.addBuyerAccount({
        organizationName: 'Email Required Co',
        corporateEmail: 'email-required-buyer@example.com',
      });

      const res = mockRes();
      const next = jest.fn();
      await vendorController.createVendor(
        {
          user: { role: 'buyer', email: 'email-required-buyer@example.com' },
          body: { name: 'No Email Vendor', majorCategory: 'Cables' },
        },
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('identityQueries.js insertVendorAccount and branches', () => {
    test('insertVendorAccount validation and error handling', async () => {
      // Missing pool
      const originalPool = pool.pool;
      pool.pool = null;
      await expect(identityQueries.insertVendorAccount({ email: 'v@v.com', password: 'pass' })).rejects.toThrow();

      // Restore mock pool
      pool.pool = {
        query: jest.fn().mockImplementation((sql) => {
          if (sql.includes('from "user" where email')) {
            return Promise.resolve({ rows: [{ id: 'existing-v' }] });
          }
          return Promise.resolve({ rows: [{ uuid: 'uuid-role-1' }] });
        }),
      };

      // Missing email/password
      await expect(identityQueries.insertVendorAccount({ email: '', password: '' })).rejects.toThrow();

      // User already exists
      const resExists = await identityQueries.insertVendorAccount({
        email: 'exists@vendor.com',
        password: 'Password123',
      });
      expect(resExists.created).toBe(false);
      expect(resExists.reason).toBe('ALREADY_EXISTS');

      // Resolve master UUIDs fail
      pool.pool.query = jest.fn().mockResolvedValue({ rows: [] });
      await expect(
        identityQueries.insertVendorAccount({ email: 'new@v.com', password: 'Password123' })
      ).rejects.toThrow(/Role/);

      pool.pool = originalPool;
    });

    test('insertVendorAccount with transaction success (new org and reused org)', async () => {
      const originalPool = pool.pool;
      pool.pool = {
        query: jest.fn().mockImplementation((sql) => {
          if (sql.includes('from "user"') || sql.includes('where lower(u.email)')) {
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [{ uuid: 'uuid-master-1' }] });
        }),
      };

      // Test with transaction executing client queries
      jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => {
        const client = {
          query: jest.fn().mockImplementation((sql) => {
            if (sql.includes('select uuid from organization')) {
              return Promise.resolve({ rows: [] });
            }
            return Promise.resolve({ rows: [{ uuid: 'org-created' }] });
          }),
        };
        return await callback(client);
      });

      const res = await identityQueries.insertVendorAccount({
        email: 'fresh@vendor.com',
        password: 'Password123',
        fullName: 'Vendor Lead',
        organizationName: 'Fresh Vendor Inc',
      });
      expect(res.created).toBe(true);
      expect(res.user.role).toBe('vendor');

      pool.pool = originalPool;
    });
  });

  describe('graphql/resolvers.js Vendor & BuyerAccount mutations & Query Branches', () => {
    const mockContext = {
      req: {
        headers: { authorization: 'Bearer token-123' },
      },
    };

    beforeEach(() => {
      const authService = require('../src/services/authService');
      jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
        valid: true,
        user: { role: 'admin', email: 'admin@procucev.com' },
      });
    });

    test('createVendor, updateVendor, deleteVendor, and createBuyerAccount mutations', async () => {
      const newV = await rootResolvers.createVendor(
        { input: { name: 'GraphQL Vendor', majorCategory: 'Civil', email: 'gv@test.com' } },
        mockContext
      );
      expect(newV).toHaveProperty('name', 'GraphQL Vendor');

      const updatedV = await rootResolvers.updateVendor(
        { id: newV.id, input: { brandName: 'GraphQL Brand' } },
        mockContext
      );
      expect(updatedV).toHaveProperty('brandName', 'GraphQL Brand');

      const deleted = await rootResolvers.deleteVendor({ id: newV.id }, mockContext);
      expect(deleted).toBe(true);

      const ba = await rootResolvers.createBuyerAccount(
        { input: { organizationName: 'GQL Buyer Org', corporateEmail: 'gqlbuyer@test.com' } },
        mockContext
      );
      expect(ba).toHaveProperty('organizationName', 'GQL Buyer Org');
    });

    test('rfqs and rfq query filters and scoping', async () => {
      const allRfqs = await rootResolvers.rfqs(
        { category: 'Mechanical', sourcingMode: 'mode_1', status: 'OPEN', limit: 10, offset: 0 },
        mockContext
      );
      expect(Array.isArray(allRfqs)).toBe(true);

      const singleRfq = await rootResolvers.rfq({ rfqNumber: 'RFQ-NON-EXISTENT' }, mockContext);
      expect(singleRfq).toBeNull();

      const nullKeyRfq = await rootResolvers.rfq({}, mockContext);
      expect(nullKeyRfq).toBeNull();

      // updateRFQ with non-existent id returns null
      const updatedNull = await rootResolvers.updateRFQ({ id: 'non-existent', input: {} }, mockContext);
      expect(updatedNull).toBeNull();
    });

    test('createRFQ with lineItems fallback and decryptData variations', async () => {
      const createdRfq = await rootResolvers.createRFQ(
        { input: { title: 'Test RFQ GQL', lineItems: [{ name: 'Item 1' }] } },
        mockContext
      );
      expect(createdRfq).toHaveProperty('title', 'Test RFQ GQL');

      const cryptoService = require('../src/services/cryptoService');
      const encrypted = cryptoService.encrypt('test plaintext');

      // decryptData plain object vs token string (encrypted.encoded)
      const decryptedPlain = rootResolvers.decryptData({ input: encrypted });
      expect(decryptedPlain).toHaveProperty('plaintext', 'test plaintext');

      const decryptedToken = rootResolvers.decryptData({ input: { token: encrypted.encoded } });
      expect(decryptedToken).toHaveProperty('plaintext', 'test plaintext');
    });

    test('vendors, vendor, buyerAccounts, buyerAccount resolvers', async () => {
      // vendors with filters
      const vList = await rootResolvers.vendors(
        { majorCategory: 'Mechanical', source: 'buyer_manual', search: 'Apex', limit: 10, offset: 0 },
        mockContext
      );
      expect(Array.isArray(vList)).toBe(true);

      const vListBuyer = await rootResolvers.vendors(
        {},
        { req: { user: { role: 'buyer', email: 'b@b.com' } } }
      );
      expect(Array.isArray(vListBuyer)).toBe(true);

      const vListBuyerIdArg = await rootResolvers.vendors({ buyerId: 'ba-1' }, {});
      expect(Array.isArray(vListBuyerIdArg)).toBe(true);

      // vendor resolver by id and by buyerId
      const singleV = await rootResolvers.vendor({ id: 'non-existent' }, mockContext);
      expect(singleV).toBeNull();

      const singleVBuyer = await rootResolvers.vendor(
        { id: 'v1' },
        { req: { user: { role: 'buyer', email: 'b@b.com' } } }
      );
      expect(singleVBuyer).toBeDefined();

      const singleVBuyerArg = await rootResolvers.vendor({ id: 'v1', buyerId: 'ba-1' }, {});
      expect(singleVBuyerArg).toBeDefined();

      // buyerAccounts and buyerAccount resolvers
      if (rootResolvers.buyerAccounts) {
        const baList = rootResolvers.buyerAccounts({}, mockContext);
        expect(Array.isArray(baList)).toBe(true);
      }
      if (rootResolvers.buyerAccount) {
        const singleBa = rootResolvers.buyerAccount({ id: 'ba-1' }, mockContext);
        expect(singleBa).toBeDefined();
      }
    });

    test('clearQueryCache, purgeLogs, optimizePerformance and autoResolveLogErrors', async () => {
      const cleared = await rootResolvers.clearQueryCache({}, mockContext);
      expect(cleared).toBe(true);

      const autoRes = await rootResolvers.autoResolveLogErrors({ action: 'CLEAR_STALE_SESSIONS' }, mockContext);
      expect(autoRes.diagnosedCount).toBe(1);

      const autoResAll = await rootResolvers.autoResolveLogErrors({}, mockContext);
      expect(autoResAll).toBeDefined();

      const purged = await rootResolvers.purgeLogs({}, mockContext);
      expect(purged).toBeDefined();

      const optimized = await rootResolvers.optimizePerformance({}, mockContext);
      expect(optimized).toBeDefined();
    });
  });

  describe('storeService.js remaining branch coverage', () => {
    test('notifyBuyer with ID and corporateEmail', () => {
      expect(storeService.notifyBuyer(null)).toBeNull();

      const created = storeService.addBuyerAccount({
        organizationName: 'Notify Org',
        corporateEmail: 'notifyorg@test.com',
      });
      const notif1 = storeService.notifyBuyer(created.id, {
        title: 'T1',
        message: 'M1',
        meta: { rfq: { id: 'rfq-1', rfqNumber: 'RFQ-001' } },
      });
      expect(notif1.recipientId).toBe(created.id);

      const notif2 = storeService.notifyBuyer('notifyorg@test.com', {
        title: 'T2',
        message: 'M2',
        meta: { rfq: { id: 'rfq-1', rfqNumber: 'RFQ-001' } },
      });
      expect(notif2.recipientId).toBe(created.id);
    });

    test('refreshInfrastructureHealth connected and disconnected paths', async () => {
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConfigured: true,
        isConnected: true,
        providerLabel: 'Neon PostgreSQL',
        database: 'procucev',
        latencyMs: 45,
        poolStatus: 'healthy',
        userCount: 10,
        vendorCount: 20,
        rfqCount: 5,
      });

      const resConnected = await storeService.refreshInfrastructureHealth();
      expect(resConnected.isConnected).toBe(true);

      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConfigured: false,
        isConnected: false,
        errorMessage: 'Connection refused',
      });

      const resDisconnected = await storeService.refreshInfrastructureHealth();
      expect(resDisconnected.isConnected).toBe(false);
    });

    test('empanelIngestedVendor minimal and full attributes', () => {
      const ingestedVendor = storeService.empanelIngestedVendor(
        {
          name: 'Ingested Supplier Ltd',
          email: 'ingested@test.com',
          majorCategory: 'Mechanical',
          minorCategories: ['Valves', 'Pumps'],
        },
        'buyer@test.com'
      );
      expect(ingestedVendor.name).toBe('Ingested Supplier Ltd');
      expect(ingestedVendor.source).toBe('vendor_master_ingestion');
    });
  });
});
