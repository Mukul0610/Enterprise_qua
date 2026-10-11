const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const storeService = require('../src/services/storeService');
const { authHeader, TEST_USERS } = require('./testHelpers');

function customAuthHeader(user) {
  return { Authorization: `Bearer ${authService.generateSessionToken(user)}` };
}

// A hardcoded literal here ('2026-09-30') is a time bomb: RFQ creation
// rejects any targetDeliveryDate/deadline earlier than today, so a fixed
// past-looking date starts failing the instant the real calendar date
// passes it — confirmed live, every createOwnRFQ-based test in this file
// started failing the moment the sandbox's clock rolled into 2026-10-01.
// Computed once per test run instead, always valid.
const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('API Route Endpoints', () => {
  // 1. Bootstrap
  describe('GET /api/bootstrap', () => {
    test('returns unified platform dataset', async () => {
      const res = await request(app).get('/api/bootstrap');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('buyerAccounts');
      expect(res.body.data).toHaveProperty('vendors');
      // RFQs are deliberately absent. This route is anonymous, so shipping the
      // global RFQ array from it is what leaked RFQs across buyer dashboards.
      // They come from the authenticated, org-scoped GET /api/rfqs instead.
      expect(res.body.data).not.toHaveProperty('rfqs');
      expect(res.body.data).toHaveProperty('evaluations');
      expect(res.body.data).toHaveProperty('auditLogs');
      expect(res.body.data).toHaveProperty('aiFeed');
      expect(res.body.data).toHaveProperty('systemConfig');
    });
  });

  // 2. Buyer Accounts
  describe('Buyer Accounts API (/api/buyer-accounts)', () => {
    let testAccountId;

    // Starts empty. The four fabricated companies that used to be here are gone;
    // the signed-in buyer's own account comes from the identity schema via
    // GET /api/buyer-accounts/active, and this list only holds accounts created
    // at runtime.
    test('GET /api/buyer-accounts returns an array', async () => {
      const res = await request(app).get('/api/buyer-accounts');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('POST /api/buyer-accounts creates new buyer account', async () => {
      const newAcc = {
        organizationName: 'Adani Heavy Engineering Ltd.',
        corporateEmail: 'procurement@adani.com',
        contactPerson: 'Karan Adani',
        mobileNumber: '+91 98000 12345',
        industrySector: 'Infrastructure & Port Logistics',
        sourcingMode: 'mode_2',
      };
      const res = await request(app).post('/api/buyer-accounts').set(authHeader('buyer')).send(newAcc);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organizationName).toBe(newAcc.organizationName);
      testAccountId = res.body.data.id;
    });

    test('POST /api/buyer-accounts requires authentication', async () => {
      const res = await request(app).post('/api/buyer-accounts').send({ organizationName: 'Unauthenticated Co' });
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/buyer-accounts returns 400 when missing required fields', async () => {
      const res = await request(app).post('/api/buyer-accounts').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('PUT /api/buyer-accounts/:id updates existing account', async () => {
      const res = await request(app)
        .put(`/api/buyer-accounts/${testAccountId}`)
        .set(authHeader('buyer'))
        .send({ totalSpend: '$500,000' });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalSpend).toBe('$500,000');
    });

    test('PUT /api/buyer-accounts/:id returns 404 for nonexistent account', async () => {
      const res = await request(app).put('/api/buyer-accounts/nonexistent-id').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(404);
    });

    test('PUT /api/buyer-accounts/:id rejects granting a paid subscriptionPlan directly (must go through Zoho payment)', async () => {
      const res = await request(app)
        .put(`/api/buyer-accounts/${testAccountId}`)
        .set(authHeader('buyer'))
        .send({ subscriptionPlan: 'version_3' });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/completed zoho payment/i);
      expect(storeService.getBuyerAccounts().find((a) => a.id === testAccountId).subscriptionPlan).not.toBe('version_3');
    });

    test('PUT /api/buyer-accounts/:id still allows resetting subscriptionPlan to free_trial', async () => {
      const res = await request(app)
        .put(`/api/buyer-accounts/${testAccountId}`)
        .set(authHeader('buyer'))
        .send({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 5 });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.subscriptionPlan).toBe('free_trial');
    });

    test('POST /api/buyer-accounts/:id/activate switches active account', async () => {
      const res = await request(app).post(`/api/buyer-accounts/${testAccountId}/activate`).set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('DELETE /api/buyer-accounts/:id deletes account', async () => {
      const res = await request(app).delete(`/api/buyer-accounts/${testAccountId}`).set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('DELETE /api/buyer-accounts/:id returns 404 for nonexistent id', async () => {
      const res = await request(app).delete('/api/buyer-accounts/nonexistent-id').set(authHeader('buyer'));
      expect(res.statusCode).toBe(404);
    });

    // Buyer accounts are buyer-side org records. Every mutating endpoint used
    // to accept any authenticated role, so a vendor or category manager could
    // create, edit, delete or re-point the globally active buyer account, and
    // run the buyer-only historical-purchase vendor ingestion.
    describe.each(['vendor', 'category_manager'])('returns 403 for the %s role', (role) => {
      test('POST /api/buyer-accounts', async () => {
        const res = await request(app)
          .post('/api/buyer-accounts')
          .set(authHeader(role))
          .send({ organizationName: 'Rogue Org', corporateEmail: 'rogue@org.com' });
        expect(res.statusCode).toBe(403);
        expect(res.body.success).toBe(false);
      });

      test('PUT /api/buyer-accounts/:id', async () => {
        const res = await request(app).put('/api/buyer-accounts/buyer-acc-001').set(authHeader(role)).send({ totalSpend: '₹0' });
        expect(res.statusCode).toBe(403);
      });

      test('DELETE /api/buyer-accounts/:id', async () => {
        const res = await request(app).delete('/api/buyer-accounts/buyer-acc-001').set(authHeader(role));
        expect(res.statusCode).toBe(403);
      });

      test('POST /api/buyer-accounts/:id/activate', async () => {
        const res = await request(app).post('/api/buyer-accounts/buyer-acc-001/activate').set(authHeader(role));
        expect(res.statusCode).toBe(403);
      });

      test('POST /api/buyer-accounts/historical-data', async () => {
        const res = await request(app)
          .post('/api/buyer-accounts/historical-data')
          .set(authHeader(role))
          .send({ period: '2_years', vendorRecords: [] });
        expect(res.statusCode).toBe(403);
      });
    });

    test('POST /api/buyer-accounts/historical-data is allowed for an admin', async () => {
      const res = await request(app)
        .post('/api/buyer-accounts/historical-data')
        .set(authHeader('admin'))
        .send({ period: '2_years', vendorRecords: [] });
      expect(res.statusCode).toBe(200);
    });

    // The two read-only endpoints stay open to any role: the identical
    // buyerAccounts payload is already served by the unauthenticated
    // GET /api/bootstrap, which is what the frontend actually reads.
    test('GET /api/buyer-accounts stays readable by a non-buyer role', async () => {
      const res = await request(app).get('/api/buyer-accounts').set(authHeader('vendor'));
      expect(res.statusCode).toBe(200);
    });
  });

  // 3. Vendors
  describe('Vendors API (/api/vendors)', () => {
    let testVendorId;

    test('GET /api/vendors returns list of vendors', async () => {
      const res = await request(app).get('/api/vendors');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('POST /api/vendors creates new vendor', async () => {
      // Only the vendor themselves (self-registration) or an admin may create
      // a vendor profile now — a buyer creating a vendor was never a real
      // product flow, see vendorController.createVendor.
      const newVendor = {
        name: 'Siemens Energy Spares Pvt Ltd',
        contactPerson: 'Rohan Sharma',
        phone: '+91 98333 44555',
        majorCategory: 'Engineering Spares - Electrical',
        minorCategories: ['Turbines', 'Transformers'],
      };
      const res = await request(app).post('/api/vendors').set(authHeader('vendor')).send(newVendor);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe(newVendor.name);
      // Found live: falling back to storeService's default ('buyer_manual')
      // here made the frontend's isBuyerUploaded() classifier sort a real
      // vendor self-registration into the "Uploaded by Buyer" tab instead of
      // "Procucev Vendors", where it's documented to live and where a buyer
      // would actually search for it.
      expect(res.body.data.source).toBe('self_registration');
      testVendorId = res.body.data.id;
    });

    test('POST /api/vendors requires authentication', async () => {
      const res = await request(app).post('/api/vendors').send({ name: 'Unauthenticated Vendor', majorCategory: 'X' });
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/vendors returns 403 for a role that cannot create a vendor profile', async () => {
      const res = await request(app).post('/api/vendors').set(authHeader('category_manager')).send({ name: 'X', majorCategory: 'Y' });
      expect(res.statusCode).toBe(403);
    });

    test('POST /api/vendors returns 403 for a buyer with no linked buyer account', async () => {
      // TEST_USERS.buyer has no addBuyerAccount row in this suite's fixtures.
      const res = await request(app)
        .post('/api/vendors')
        .set(authHeader('buyer'))
        .send({ name: 'Unlinked Buyer Vendor', email: 'unlinked@vendor.test', majorCategory: 'Fasteners' });
      expect(res.statusCode).toBe(403);
    });

    test('POST /api/vendors: a buyer with a linked account can add a vendor directly, scoped and whitelisted server-side', async () => {
      const buyerAccount = storeService.addBuyerAccount({
        organizationName: 'API Test Buyer Co',
        corporateEmail: TEST_USERS.buyer.email,
      });

      const res = await request(app)
        .post('/api/vendors')
        .set(authHeader('buyer'))
        .send({
          name: 'Direct API Vendor',
          email: 'direct-api-vendor@test.com',
          phone: '9876543210',
          majorCategory: 'Fasteners',
          buyerId: 'someone-elses-id',
          addedByBuyerCompany: 'Spoofed Company',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.buyerId).toBe(buyerAccount.id);
      expect(res.body.data.addedByBuyerCompany).toBe('API Test Buyer Co');
      expect(res.body.data).not.toHaveProperty('tempPassword');

      const detailRes = await request(app)
        .get(`/api/vendors/${res.body.data.id}`)
        .set(authHeader('buyer'));
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.body.data).not.toHaveProperty('tempPassword');
    });

    test('POST /api/vendors: a buyer omitting a vendor email is rejected', async () => {
      storeService.addBuyerAccount({
        organizationName: 'Email Required API Co',
        corporateEmail: 'email-required-api-buyer@test.com',
      });
      const token = authService.generateSessionToken({
        id: 'usr-buyer-002',
        email: 'email-required-api-buyer@test.com',
        role: 'buyer',
      });
      const res = await request(app)
        .post('/api/vendors')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'No Email Vendor', majorCategory: 'Cables' });
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/vendors returns 400 when missing name or majorCategory', async () => {
      const res = await request(app).post('/api/vendors').set(authHeader('vendor')).send({ email: 'test@vendor.com' });
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/vendors/:id returns vendor details', async () => {
      const res = await request(app).get(`/api/vendors/${testVendorId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(testVendorId);
    });

    test('GET /api/vendors/:id returns 404 when not found', async () => {
      const res = await request(app).get('/api/vendors/invalid-vendor');
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/vendors/:id/rating-revision revises score & rating', async () => {
      const res = await request(app).post(`/api/vendors/${testVendorId}/rating-revision`).set(authHeader('buyer')).send({
        qualityScore: 95,
        costScore: 90,
        deliveryScore: 92,
        remarks: 'Excellent delivery compliance',
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.revisionRecord).toHaveProperty('newCompositeScore');
    });

    test('POST /api/vendors/:id/rating-revision returns 400 if scores missing', async () => {
      const res = await request(app).post(`/api/vendors/${testVendorId}/rating-revision`).set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/vendors/:id/onboarding-email returns email preview payload', async () => {
      // Carries the vendor's real tempPassword, so it's now restricted to the
      // buyer-side roles that actually onboard vendors (or an admin).
      const nonOwnerRes = await request(app)
        .get(`/api/vendors/${testVendorId}/onboarding-email`)
        .set(authHeader('buyer'));
      expect(nonOwnerRes.statusCode).toBe(403);

      const res = await request(app).get(`/api/vendors/${testVendorId}/onboarding-email`).set(authHeader('admin'));
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
      expect(res.body.data).toHaveProperty('to');
    });

    test('PUT /api/vendors/:id updates the profile as the owning vendor, ignoring smuggled fields', async () => {
      // Reuses testVendorId (already created above, under this same vendor
      // session's email) rather than creating a second one for the same
      // vendor identity — createVendor now rejects a duplicate email before
      // ever calling addVendor.
      const res = await request(app)
        .put(`/api/vendors/${testVendorId}`)
        .set(authHeader('vendor'))
        .send({ contactPerson: 'Updated Contact', rating: 999, status: 'HACKED' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.contactPerson).toBe('Updated Contact');
      // rating/status aren't in VENDOR_SELF_EDIT_FIELDS, so a vendor's own PUT
      // can't smuggle them through.
      expect(res.body.data.rating).not.toBe(999);
      expect(res.body.data.status).not.toBe('HACKED');
    });

    test('PUT /api/vendors/:id returns 403 for a caller who is neither the owning vendor nor an admin', async () => {
      const res = await request(app).put(`/api/vendors/${testVendorId}`).set(authHeader('buyer')).send({ name: 'X' });
      expect(res.statusCode).toBe(403);
    });

    test('DELETE /api/vendors/:id removes vendor', async () => {
      // Only the owning vendor (or an admin) may delete the profile; it was
      // created above under the 'vendor' test user's own session email.
      const res = await request(app).delete(`/api/vendors/${testVendorId}`).set(authHeader('vendor'));
      expect(res.statusCode).toBe(200);
    });
  });

  // 4. RFQs
  describe('RFQs API (/api/rfqs)', () => {
    let testRfqId;

    // A real buyer account for TEST_USERS.buyer.email, registered before any
    // RFQ in this block is created, so every RFQ here consistently resolves
    // to the same real buyerAccountId (getBuyerAccountByEmail) rather than
    // some created before the account existed and some after.
    beforeAll(async () => {
      const acc = await request(app).post('/api/buyer-accounts').set(authHeader('buyer')).send({
        organizationName: 'Test Buyer Org',
        corporateEmail: TEST_USERS.buyer.email,
      });
      // A fresh account defaults to the free_trial plan (mode_1 only, 5 RFQs)
      // — granted the top tier directly here so this whole describe block's
      // many mode_2 RFQs and repeated creations aren't gated by the new
      // server-side subscription entitlement check. That check has its own
      // dedicated tests elsewhere.
      storeService.updateBuyerAccount(acc.body.data.id, { subscriptionPlan: 'version_3' });
    });

    test('GET /api/rfqs returns this buyer organisation\'s RFQs', async () => {
      const res = await request(app).get('/api/rfqs').set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('GET /api/rfqs requires a session', async () => {
      const res = await request(app).get('/api/rfqs');
      expect(res.statusCode).toBe(401);
    });

    // Found live 2026-09-18: getVendorById(req.user.email) — with no scope
    // arg — refuses to resolve any vendor that has a buyerId set (i.e. every
    // buyer-uploaded vendor), so resolveRfqReadScope silently treated the
    // vendor as unresolvable and every RFQ came back invisible to them, even
    // one their own addedByBuyerCompany matched exactly.
    test('a buyer-uploaded vendor (not self-registered) can see and quote the RFQ their addedByBuyerCompany matches', async () => {
      const addedVendor = await request(app).post('/api/vendors').set(authHeader('buyer')).send({
        name: 'Ankit Buyer-Uploaded Co',
        email: 'ankit.buyer-uploaded@example.com',
        contactPerson: 'Ankit',
        majorCategory: 'Mechanical',
      });
      expect(addedVendor.statusCode).toBe(201);
      expect(addedVendor.body.data.addedByBuyerCompany).toBe('Test Buyer Org');

      const rfqRes = await request(app).post('/api/rfqs').set(authHeader('buyer')).send({
        title: 'Buyer-uploaded vendor visibility RFQ',
        category: 'Mechanical',
        deliveryLocation: 'Pune',
        deliveryPincode: '411001',
        targetDeliveryDate: '2026-12-01',
        sourcingMode: 'mode_1',
      });
      expect(rfqRes.statusCode).toBe(201);
      expect(rfqRes.body.data.buyerAccountName).toBe('Test Buyer Org');

      const customVendorHeader = {
        Authorization: `Bearer ${authService.generateSessionToken({
          id: 'usr-ankit-buyer-uploaded',
          email: 'ankit.buyer-uploaded@example.com',
          name: 'Ankit',
          role: 'vendor',
          orgId: 'org-ankit',
          orgName: 'Ankit Buyer-Uploaded Co',
        })}`,
      };

      const listRes = await request(app).get('/api/rfqs').set(customVendorHeader);
      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.data.some((r) => r.id === rfqRes.body.data.id)).toBe(true);

      const quoteRes = await request(app)
        .post(`/api/rfqs/${rfqRes.body.data.id}/quotes`)
        .set(customVendorHeader)
        .send({ unitPrice: 500, totalPrice: 2500 });
      expect(quoteRes.statusCode).toBe(200);
    });

    describe('buyer subscription entitlement (server-side re-validation)', () => {
      const rfqPayload = (overrides = {}) => ({
        title: 'Entitlement Test RFQ',
        category: 'Engineering Spares - Mechanical',
        budget: 100000,
        targetDeliveryDate: A_FUTURE_DATE,
        deadline: A_FUTURE_DATE,
        sourcingMode: 'mode_1',
        deliveryLocation: 'Plant A',
        deliveryPincode: '400001',
        ...overrides,
      });

      function customAuthHeaderFor(email) {
        return { Authorization: `Bearer ${authService.generateSessionToken({ id: `usr-${email}`, email, name: 'N', role: 'buyer', orgId: 'o', orgName: 'O' })}` };
      }

      test('a free_trial buyer can raise a mode_1 RFQ and it decrements remainingFreeRFQs', async () => {
        const email = 'entitlement-trial@ex.com';
        const acc = await request(app).post('/api/buyer-accounts').set(customAuthHeaderFor(email)).send({
          organizationName: 'Entitlement Trial Buyer',
          corporateEmail: email,
        });
        expect(await storeService.getBuyerAccountByEmail(email)).toMatchObject({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 5 });

        const res = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload());

        expect(res.statusCode).toBe(201);
        expect((await storeService.getBuyerAccountByEmail(email)).remainingFreeRFQs).toBe(4);
        void acc;
      });

      test('a free_trial buyer is rejected with 403 once remainingFreeRFQs is exhausted', async () => {
        const email = 'entitlement-exhausted@ex.com';
        await request(app).post('/api/buyer-accounts').set(customAuthHeaderFor(email)).send({
          organizationName: 'Entitlement Exhausted Buyer',
          corporateEmail: email,
        });
        storeService.updateBuyerAccount((await storeService.getBuyerAccountByEmail(email)).id, { remainingFreeRFQs: 0 });

        const res = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload());

        expect(res.statusCode).toBe(403);
        expect(res.body.error).toMatch(/free trial/i);
      });

      test('Enterprise QUA V0 flow: mode_0 does not consume credits, V1/V2/V3 consume 1 credit, and V0 remains available after credits reach 0', async () => {
        const email = 'v0-flow-buyer@ex.com';
        await request(app).post('/api/buyer-accounts').set(customAuthHeaderFor(email)).send({
          organizationName: 'V0 Flow Buyer Org',
          corporateEmail: email,
        });

        // 1. Initial balance: 5 credits
        let acc = await storeService.getBuyerAccountByEmail(email);
        expect(acc.remainingFreeRFQs).toBe(5);

        // 2. Create RFQ from V0 -> 5 credits remaining (0 deducted)
        const v0Rfq1 = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_0' }));
        expect(v0Rfq1.statusCode).toBe(201);
        acc = await storeService.getBuyerAccountByEmail(email);
        expect(acc.remainingFreeRFQs).toBe(5);

        // 3. Create RFQ from V1 -> 4 credits remaining
        const v1Rfq = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_1' }));
        expect(v1Rfq.statusCode).toBe(201);
        acc = await storeService.getBuyerAccountByEmail(email);
        expect(acc.remainingFreeRFQs).toBe(4);

        // 4. Create RFQ from V2 -> 3 credits remaining
        const v2Rfq = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_2' }));
        expect(v2Rfq.statusCode).toBe(201);
        acc = await storeService.getBuyerAccountByEmail(email);
        expect(acc.remainingFreeRFQs).toBe(3);

        // 5. Create RFQ from V3 -> 2 credits remaining
        const v3Rfq = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_3' }));
        expect(v3Rfq.statusCode).toBe(201);
        acc = await storeService.getBuyerAccountByEmail(email);
        expect(acc.remainingFreeRFQs).toBe(2);

        // Consume remaining 2 credits
        await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_1' }));
        await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_2' }));
        acc = await storeService.getBuyerAccountByEmail(email);
        expect(acc.remainingFreeRFQs).toBe(0);

        // V1/V2/V3 are now blocked with 403
        const blockedV1 = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_1' }));
        expect(blockedV1.statusCode).toBe(403);

        const blockedV2 = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_2' }));
        expect(blockedV2.statusCode).toBe(403);

        const blockedV3 = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_3' }));
        expect(blockedV3.statusCode).toBe(403);

        // V0 remains available even when credits are 0
        const v0RfqWhenExhausted = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_0' }));
        expect(v0RfqWhenExhausted.statusCode).toBe(201);
        acc = await storeService.getBuyerAccountByEmail(email);
        expect(acc.remainingFreeRFQs).toBe(0);
      });

      test('a free_trial buyer can raise mode_1, mode_2, or mode_3 RFQs sharing the 5 free RFQs', async () => {
        const email = 'entitlement-multi-version@ex.com';
        await request(app).post('/api/buyer-accounts').set(customAuthHeaderFor(email)).send({
          organizationName: 'Entitlement Multi Mode Buyer',
          corporateEmail: email,
        });

        const rfq1 = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_1' }));
        expect(rfq1.statusCode).toBe(201);
        expect((await storeService.getBuyerAccountByEmail(email)).remainingFreeRFQs).toBe(4);

        const rfq2 = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_2' }));
        expect(rfq2.statusCode).toBe(201);
        expect((await storeService.getBuyerAccountByEmail(email)).remainingFreeRFQs).toBe(3);

        const rfq3 = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_3' }));
        expect(rfq3.statusCode).toBe(201);
        expect((await storeService.getBuyerAccountByEmail(email)).remainingFreeRFQs).toBe(2);
      });

      test('a version_1 buyer is rejected with 403 for mode_2/mode_3', async () => {
        const email = 'entitlement-mode-gate@ex.com';
        const acc = await request(app).post('/api/buyer-accounts').set(customAuthHeaderFor(email)).send({
          organizationName: 'Entitlement Mode Gate Buyer',
          corporateEmail: email,
        });
        storeService.updateBuyerAccount(acc.body.data.id, { subscriptionPlan: 'version_1' });

        const res = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_2' }));

        expect(res.statusCode).toBe(403);
        expect(res.body.error).toMatch(/does not include mode_2/i);
      });

      test('rejects RFQ creation if targetDeliveryDate is in the past', async () => {
        const email = 'past-date-buyer@ex.com';
        await request(app).post('/api/buyer-accounts').set(customAuthHeaderFor(email)).send({
          organizationName: 'Past Date Buyer',
          corporateEmail: email,
        });

        const res = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ targetDeliveryDate: '2020-01-01' }));
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('Target date cannot be earlier than today.');
      });

      test('rejects RFQ creation if line item targetDate is in the past', async () => {
        const email = 'past-item-buyer@ex.com';
        await request(app).post('/api/buyer-accounts').set(customAuthHeaderFor(email)).send({
          organizationName: 'Past Item Buyer',
          corporateEmail: email,
        });

        const res = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({
          targetDeliveryDate: new Date().toISOString().slice(0, 10),
          extractedEntities: [{ itemName: 'Item 1', quantity: 1, unit: 'Nos', targetDate: '2020-01-01' }],
        }));
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('Target date cannot be earlier than today.');
      });

      test('a version_2 buyer may raise mode_1/mode_2 but not mode_3', async () => {
        const email = 'entitlement-version2@ex.com';
        const acc = await request(app).post('/api/buyer-accounts').set(customAuthHeaderFor(email)).send({
          organizationName: 'Entitlement Version2 Buyer',
          corporateEmail: email,
        });
        storeService.updateBuyerAccount(acc.body.data.id, { subscriptionPlan: 'version_2' });

        const mode2Res = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_2' }));
        expect(mode2Res.statusCode).toBe(201);

        const mode3Res = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_3' }));
        expect(mode3Res.statusCode).toBe(403);

        // A paid plan has no numeric quota to decrement.
        expect((await storeService.getBuyerAccountByEmail(email)).remainingFreeRFQs).toBe(5);
      });

      test('a version_3 buyer may raise mode_3', async () => {
        const email = 'entitlement-version3@ex.com';
        const acc = await request(app).post('/api/buyer-accounts').set(customAuthHeaderFor(email)).send({
          organizationName: 'Entitlement Version3 Buyer',
          corporateEmail: email,
        });
        storeService.updateBuyerAccount(acc.body.data.id, { subscriptionPlan: 'version_3' });

        const res = await request(app).post('/api/rfqs').set(customAuthHeaderFor(email)).send(rfqPayload({ sourcingMode: 'mode_3' }));
        expect(res.statusCode).toBe(201);
      });

      test('the entitlement check is skipped entirely when the caller has no resolved buyer account', async () => {
        const res = await request(app).post('/api/rfqs').set(authHeader('admin')).send(rfqPayload({ sourcingMode: 'mode_3' }));
        expect(res.statusCode).toBe(201);
      });
    });

    test('POST /api/rfqs creates new RFQ and returns 201', async () => {
      const rfq = {
        title: 'Procurement of High Temperature Valves',
        category: 'Engineering Spares - Mechanical',
        budget: 145000,
        targetDeliveryDate: A_FUTURE_DATE,
        deadline: A_FUTURE_DATE,
        sourcingMode: 'mode_2',
        deliveryLocation: 'Navi Mumbai Plant, Gate 3',
        deliveryPincode: '400701',
      };
      const res = await request(app).post('/api/rfqs').set(authHeader('buyer')).send(rfq);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.title).toBe(rfq.title);
      expect(res.body.data.rfqNumber).toBeDefined();
      testRfqId = res.body.data.id;
    });

    // Vendors price freight against these, so they have to round-trip rather than
    // being dropped the way budget silently was.
    test('POST /api/rfqs persists the delivery location and pincode', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          budget: 90000,
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.deliveryLocation).toBe('Navi Mumbai Plant, Gate 3');
      expect(res.body.data.deliveryPincode).toBe('400701');
      expect(res.body.data.budget).toBe(90000);
    });

    // The attachment metadata and the document provenance have to survive the
    // round trip, because the RFQ details screen reads both. All four provenance
    // fields were previously dropped by storeService.createRFQ, so a stored RFQ
    // came back with a null source and a null sourceFileName — and the ingestion
    // wizard's documented fallback for the uploaded document could never work.
    test('POST /api/rfqs round-trips attachment metadata and document provenance', async () => {
      const attachment = {
        id: 'a1b2c3d4-0000-4000-8000-abcdefabcdef',
        fileName: 'BOQ-pumps.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 4096,
        uploadedAt: '2026-09-05T06:00:00.000Z',
      };

      const created = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Attached Pumps',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
          attachments: [attachment],
          source: 'web_portal',
          sourceFileName: 'BOQ-pumps.xlsx',
        });

      expect(created.statusCode).toBe(201);
      expect(created.body.data.attachments).toEqual([attachment]);
      expect(created.body.data.source).toBe('web_portal');
      expect(created.body.data.sourceFileName).toBe('BOQ-pumps.xlsx');

      // Read back through the endpoint the details page actually calls, so the
      // assertion covers the shape that screen receives rather than only the
      // create response.
      const fetched = await request(app)
        .get(`/api/rfqs/${created.body.data.rfqNumber}`)
        .set(authHeader('buyer'));

      expect(fetched.statusCode).toBe(200);
      expect(fetched.body.data.attachments).toEqual([attachment]);
      expect(fetched.body.data.sourceFileName).toBe('BOQ-pumps.xlsx');
    });

    // The budget stays optional even though the destination is now mandatory: a
    // document that prices nothing yields no figure, and requiring one only made
    // buyers invent a ceiling vendors would quote against.
    test('POST /api/rfqs accepts an RFQ with no budget', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Unpriced Spares',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryLocation: 'Pune Facility, Dock 2',
          deliveryPincode: '411057',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.budget).toBe(0);
      expect(res.body.data.deliveryLocation).toBe('Pune Facility, Dock 2');
    });

    // Freight is rated on the destination, so an RFQ without one produces quotes
    // that cannot be compared against quotes that have one.
    test('POST /api/rfqs rejects a missing delivery location', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryPincode: '400701',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryLocation).toMatch(/delivery location is required/i);
    });

    test('POST /api/rfqs rejects a delivery location shorter than three characters', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryLocation: 'X',
          deliveryPincode: '400701',
        });

      // The schema `message` only covers the required case; the shared validator
      // generates its own text for a minLength breach, as it does for `title`.
      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryLocation).toMatch(/at least 3 characters/i);
    });

    test('POST /api/rfqs rejects a missing pincode', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryPincode).toMatch(/pincode is required/i);
    });

    test('POST /api/rfqs rejects a malformed pincode', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '!!',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryPincode).toMatch(/pincode/i);
    });

    test('POST /api/rfqs accepts an international zipcode', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Export Order for Valves',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryLocation: 'Tilbury Docks, Berth 4',
          deliveryPincode: 'SW1A 1AA',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.deliveryPincode).toBe('SW1A 1AA');
    });

    test('POST /api/rfqs requires authentication', async () => {
      const res = await request(app).post('/api/rfqs').send({ title: 'Unauthenticated RFQ' });
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/rfqs returns 400 when title missing', async () => {
      const res = await request(app).post('/api/rfqs').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/rfqs/:id returns RFQ', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}`).set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(testRfqId);
    });

    test('GET /api/rfqs/:id requires a session', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}`);
      expect(res.statusCode).toBe(401);
    });

    // A buyer's own account is resolved server-side (getBuyerAccountByEmail),
    // never trusted from the client, so a second buyer with no matching
    // account gets the same 404 as an id that does not exist — that's what
    // stops the endpoint being used to probe other buyers' RFQs. Category
    // managers/admins/vendors are deliberately NOT scoped this way (see
    // rfqController.resolveRfqReadScope) — CM's own quote-matrix route needs
    // the full cross-buyer list, and the vendor marketplace feed is
    // deliberately cross-buyer.
    test('GET /api/rfqs/:id hides an RFQ belonging to another buyer', async () => {
      const otherBuyerHeader = customAuthHeader({
        id: 'usr-other-buyer',
        email: 'other-buyer@procucev.com',
        name: 'Other Buyer',
        role: 'buyer',
      });
      const res = await request(app).get(`/api/rfqs/${testRfqId}`).set(otherBuyerHeader);
      expect(res.statusCode).toBe(404);
    });

    test('PUT /api/rfqs/:id updates RFQ successfully', async () => {
      const res = await request(app).put(`/api/rfqs/${testRfqId}`).set(authHeader('buyer')).send({ status: 'In Evaluation' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe('In Evaluation');
    });

    test('POST /api/rfqs/:id/quotes returns 403 for a non-vendor role', async () => {
      const res = await request(app).post(`/api/rfqs/${testRfqId}/quotes`).set(authHeader('buyer')).send({ unitPrice: 100 });
      expect(res.statusCode).toBe(403);
    });

    test('POST /api/rfqs/:id/quotes returns 400 when the vendor has no profile yet', async () => {
      const res = await request(app)
        .post(`/api/rfqs/${testRfqId}/quotes`)
        .set(customAuthHeader({ id: 'usr-no-profile', email: 'no-profile-vendor@test.com', name: 'No Profile', role: 'vendor' }))
        .send({ unitPrice: 100 });
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/rfqs/:id/quotes adds quote and recalculates matrix', async () => {
      // A quote's vendor identity is resolved server-side from the caller's
      // own vendor record now, so one must exist before a vendor can bid.
      const vendorRes = await request(app).post('/api/vendors').set(authHeader('vendor')).send({
        name: 'Apex Industrial Dynamics Pvt Ltd',
        majorCategory: 'Engineering Spares - Mechanical',
      });
      // Category match alone no longer grants access — a CM must invite this
      // vendor before they can quote this RFQ.
      await request(app)
        .post(`/api/rfqs/${testRfqId}/invite-vendors`)
        .set(authHeader('category_manager'))
        .send({ vendorIds: [vendorRes.body.data.id] });
      const quote = {
        unitPrice: 5200,
        totalPrice: 52000,
        leadTimeDays: 10,
        remarks: 'Compliant OEM specification',
      };
      const res = await request(app)
        .post(`/api/rfqs/${testRfqId}/quotes`)
        .set(authHeader('vendor'))
        .send(quote);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.quotes.length).toBeGreaterThan(0);
    });

    test('GET /api/rfqs/:id/email-preview requires a session', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}/email-preview`);
      expect(res.statusCode).toBe(401);
    });

    test('GET /api/rfqs/:id/email-preview generates standard RFQ email', async () => {
      // This RFQ isn't a direct-roster invite for this vendor, so downloading
      // it is a marketplace download gated by subscription — grant a plan
      // with quota first. Paid plans can only be granted server-side after a
      // real Zoho payment (PUT /api/vendors/:id/subscription now only allows
      // 'premium' — see that endpoint's own test coverage), so tests that just
      // need the entitlement set it directly, same as the buyer tests do via
      // storeService.updateBuyerAccount.
      storeService.updateVendor('vendor@apexsupplies.com', { subscriptionPlan: 'connect' });
      // Category match alone no longer grants access — this vendor was already
      // invited to testRfqId in the quotes test above, so this just re-confirms
      // that access before exercising the download-quota path.
      const res = await request(app).get(`/api/rfqs/${testRfqId}/email-preview`).set(authHeader('vendor'));
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
    });

    test('GET /api/rfqs/:id/email-preview succeeds for a free-tier vendor downloading a marketplace RFQ (quota enforcement temporarily disabled for every tier), and still tracks usage', async () => {
      const header = customAuthHeader({
        id: 'usr-free-tier-vendor',
        email: 'free-tier@vendor.com',
        name: 'Free Tier Vendor',
        role: 'vendor',
      });
      const freeVendorRes = await request(app).post('/api/vendors').set(header).send({
        name: 'Free Tier Supplier Co',
        majorCategory: 'Engineering Spares - Mechanical',
      });
      // Invite this vendor so access is granted at all — the endpoint under
      // test is the download itself, not the (separately-tested) invite gate.
      await request(app)
        .post(`/api/rfqs/${testRfqId}/invite-vendors`)
        .set(authHeader('category_manager'))
        .send({ vendorIds: [freeVendorRes.body.data.id] });
      // Left on the default 'premium' (free, client-uploaded-only) plan —
      // this RFQ was never raised by a buyer who added this vendor, so it's
      // a marketplace download. Quota enforcement is disabled for every tier
      // right now, so this still succeeds and increments rfqDownloadsUsed.
      const res = await request(app).get(`/api/rfqs/${testRfqId}/email-preview`).set(header);
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
      const vendorAfter = await request(app)
        .get(`/api/vendors/${encodeURIComponent(freeVendorRes.body.data.id)}`)
        .set(header);
      expect(vendorAfter.body.data.rfqDownloadsUsed).toBe(1);
    });

    test('GET /api/rfqs/:id/email-preview keeps succeeding for a vendor whose usage counter is already past the old quota', async () => {
      const header = customAuthHeader({
        id: 'usr-exhausted-vendor',
        email: 'exhausted@vendor.com',
        name: 'Exhausted Quota Vendor',
        role: 'vendor',
      });
      const created = await request(app).post('/api/vendors').set(header).send({
        name: 'Exhausted Quota Supplier Co',
        majorCategory: 'Engineering Spares - Mechanical',
      });
      storeService.updateVendor(created.body.data.id, { subscriptionPlan: 'connect', rfqDownloadsUsed: 50 });
      await request(app)
        .post(`/api/rfqs/${testRfqId}/invite-vendors`)
        .set(authHeader('category_manager'))
        .send({ vendorIds: [created.body.data.id] });

      const res = await request(app).get(`/api/rfqs/${testRfqId}/email-preview`).set(header);
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
    });
  });

  // 5. Evaluations & Audit
  describe('Evaluations & Audit API', () => {
    test('GET /api/evaluations and POST /api/evaluations', async () => {
      const getRes = await request(app).get('/api/evaluations').set(authHeader('category_manager'));
      expect(getRes.statusCode).toBe(200);

      // A qualification evaluation is a vendor's own self-assessment — identity
      // is resolved server-side from the caller's session, not the body.
      const postRes = await request(app).post('/api/evaluations').set(authHeader('vendor')).send({
        moduleScores: { commercial: { score: 95 } },
        documents: [{ name: 'evidence.pdf' }],
      });
      expect(postRes.statusCode).toBe(201);
      expect(postRes.body.data.email).toBe('vendor@apexsupplies.com');
    });

    test('POST /api/evaluations returns 403 for a non-vendor role', async () => {
      const res = await request(app).post('/api/evaluations').set(authHeader('buyer')).send({
        vendorName: 'X',
        documents: [{ name: 'evidence.pdf' }],
      });
      expect(res.statusCode).toBe(403);
    });

    test('POST /api/evaluations requires authentication', async () => {
      const res = await request(app).post('/api/evaluations').send({ vendorName: 'Unauthenticated Corp' });
      expect(res.statusCode).toBe(401);
    });

    test('GET /api/audit and verify integrity require authentication', async () => {
      const unauth = await request(app).get('/api/audit');
      expect(unauth.statusCode).toBe(401);

      const getRes = await request(app).get('/api/audit').set(authHeader('admin'));
      expect(getRes.statusCode).toBe(200);

      const verifyRes = await request(app).get('/api/audit/verify').set(authHeader('admin'));
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.body.report.valid).toBe(true);
    });

    test('POST /api/audit creates new log entry', async () => {
      const res = await request(app).post('/api/audit').set(authHeader('buyer')).send({
        userEmail: 'auditor@enterprise.com',
        action: 'Manual compliance check performed',
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data).toHaveProperty('shaSignature');
    });
  });

  // 6. System Config & DB Status
  describe('System Config & DB API', () => {
    test('GET & POST /api/system-config are admin-only', async () => {
      const unauthGet = await request(app).get('/api/system-config');
      expect(unauthGet.statusCode).toBe(401);

      const nonAdminGet = await request(app).get('/api/system-config').set(authHeader('buyer'));
      expect(nonAdminGet.statusCode).toBe(403);

      const getRes = await request(app).get('/api/system-config').set(authHeader('admin'));
      expect(getRes.statusCode).toBe(200);

      const postRes = await request(app).post('/api/system-config').set(authHeader('admin')).send({
        ocrExtractionThreshold: 90,
      });
      expect(postRes.statusCode).toBe(200);
      expect(postRes.body.data.ocrExtractionThreshold).toBe(90);
    });

    test('GET /api/db/status returns health status', async () => {
      const res = await request(app).get('/api/db/status');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('provider');
    });

    test('GET & POST /api/ai-feed', async () => {
      const getRes = await request(app).get('/api/ai-feed');
      expect(getRes.statusCode).toBe(200);

      const postRes = await request(app).post('/api/ai-feed').set(authHeader('buyer')).send({
        title: 'SMS Alert Sent',
        message: 'Notification pushed to supplier.',
      });
      expect(postRes.statusCode).toBe(201);
      expect(postRes.body.data).toHaveProperty('buyerAccountId');

      const failRes = await request(app).post('/api/ai-feed').set(authHeader('buyer')).send({});
      expect(failRes.statusCode).toBe(400);

      // Scoped query by buyerAccountId
      const scopedRes = await request(app).get(`/api/ai-feed?buyerAccountId=${postRes.body.data.buyerAccountId}`);
      expect(scopedRes.statusCode).toBe(200);
      expect(scopedRes.body.data.some((item) => item.id === postRes.body.data.id)).toBe(true);

      // Other buyer query does not see this buyer's feed item
      const otherBuyerRes = await request(app).get('/api/ai-feed?buyerAccountId=other-nonexistent-buyer');
      expect(otherBuyerRes.statusCode).toBe(200);
      expect(otherBuyerRes.body.data.some((item) => item.id === postRes.body.data.id)).toBe(false);
    });

    test('GET /api/db/metrics is admin-only', async () => {
      const unauth = await request(app).get('/api/db/metrics');
      expect(unauth.statusCode).toBe(401);

      const nonAdmin = await request(app).get('/api/db/metrics').set(authHeader('buyer'));
      expect(nonAdmin.statusCode).toBe(403);
    });

    test('GET /api/db/metrics returns the cache and audit efficiency report', async () => {
      const res = await request(app).get('/api/db/metrics').set(authHeader('admin'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('cache');
      expect(res.body).toHaveProperty('auditing');
    });

    // One connection, one status. This used to report two datastores side by side
    // plus a `domainStore.mode` saying whether the app was serving persisted rows
    // or in-memory seed data; neither distinction exists now.
    test('GET /api/db/status reports the single database connection and what is loaded', async () => {
      const res = await request(app).get('/api/db/status');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('poolStatus');
      expect(res.body).not.toHaveProperty('domainDatabase');
      expect(res.body).not.toHaveProperty('domainStore');
      expect(res.body.loadedRecords).toEqual(
        expect.objectContaining({
          isLoadedFromDatabase: expect.any(Boolean),
          buyerAccounts: expect.any(Number),
          vendors: expect.any(Number),
          rfqs: expect.any(Number),
        })
      );
    });

    // Resolved from the shared identity schema for the caller's own session. It
    // has no seeded fallback on purpose: returning a fabricated account is how the
    // dashboard used to attribute one buyer's work to another company. Under test
    // no identity database is configured, so it reports that rather than inventing
    // an account.
    test('GET /api/buyer-accounts/active requires a session', async () => {
      const res = await request(app).get('/api/buyer-accounts/active');
      expect(res.statusCode).toBe(401);
    });

    // The pool is stubbed explicitly rather than relying on whether this machine
    // happens to have a DATABASE_URL, so the result is the same in CI as it is
    // locally.
    test('GET /api/buyer-accounts/active reports an unavailable directory rather than inventing an account', async () => {
      const pool = require('../src/db/pool');
      const originalPool = pool.pool;
      pool.pool = null;
      try {
        const res = await request(app).get('/api/buyer-accounts/active').set(authHeader('buyer'));
        expect(res.statusCode).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/unavailable/i);
        // Crucially, no account is invented to fill the gap.
        expect(res.body.data).toBeUndefined();
      } finally {
        pool.pool = originalPool;
      }
    });

    test('GET /api/buyer-accounts/active returns the caller\'s own organisation', async () => {
      const pool = require('../src/db/pool');
      const buyerProfileQueries = require('../src/db/buyerProfileQueries');
      const originalPool = pool.pool;
      pool.pool = { stub: true, query: jest.fn().mockResolvedValue({ rows: [] }) };
      const spy = jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
        profile: {
          organizationId: 'org-real-01',
          userId: 'usr-buyer-001',
          companyName: 'Real Buyer Pvt Ltd',
          contactEmail: 'buyer@procucev.com',
          contactName: 'A Buyer',
          contactPhone: '+919876543210',
          gstNumber: '27AAACT2727Q1ZW',
          panNumber: 'AAACT2727Q',
          city: 'Navi Mumbai',
          state: 'Maharashtra',
          categories: [],
        },
      });

      try {
        const res = await request(app).get('/api/buyer-accounts/active').set(authHeader('buyer'));
        expect(res.statusCode).toBe(200);
        expect(res.body.source).toBe('identity_database');
        expect(res.body.data.organizationName).toBe('Real Buyer Pvt Ltd');
        expect(res.body.data.id).toBe('org-real-01');
        // Spend and RFQ counts are counted, never invented the way the seed did.
        expect(res.body.data.totalSpend).toBe(0);
        expect(res.body.data.totalRFQsCreated).toBe(0);
      } finally {
        spy.mockRestore();
        pool.pool = originalPool;
      }
    });

    test('POST /api/buyer-accounts/invalid-id/activate returns 404', async () => {
      const res = await request(app).post('/api/buyer-accounts/invalid-id/activate').set(authHeader('buyer'));
      expect(res.statusCode).toBe(404);
    });

    test('PUT /api/rfqs/:id returns 404 for an id that does not exist', async () => {
      const res = await request(app).put('/api/rfqs/nonexistent-rfq').set(authHeader('buyer')).send({ status: 'Closed' });
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/rfqs/:id/quotes error handling for missing fields and invalid id', async () => {
      // The 'vendor' session's own profile was deleted by the earlier
      // "DELETE /api/vendors/:id removes vendor" test in this file, and
      // addQuote 400s before ever checking the RFQ id if the caller has no
      // vendor profile at all — so this recreates one to exercise the actual
      // missing-field/invalid-id branches being tested here.
      await request(app).post('/api/vendors').set(authHeader('vendor')).send({
        name: 'Apex Supplies Ltd',
        majorCategory: 'Engineering Spares - Mechanical',
      });

      const failRes = await request(app).post('/api/rfqs/rfq-001/quotes').set(authHeader('vendor')).send({});
      expect(failRes.statusCode).toBe(400);

      const notFoundRes = await request(app).post('/api/rfqs/nonexistent-rfq/quotes').set(authHeader('vendor')).send({
        vendorName: 'Apex',
        unitPrice: 100,
      });
      expect(notFoundRes.statusCode).toBe(404);
    });

    test('GET /api/rfqs/:id/email-preview returns 404 for invalid id', async () => {
      const res = await request(app).get('/api/rfqs/nonexistent-rfq/email-preview').set(authHeader('vendor'));
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/evaluations returns 400 when evidence is missing', async () => {
      const res = await request(app).post('/api/evaluations').set(authHeader('vendor')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/audit returns 400 when missing action', async () => {
      const res = await request(app).post('/api/audit').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/vendors/:id/onboarding-email and rating revision 404 on invalid vendor', async () => {
      const emailRes = await request(app).get('/api/vendors/invalid-id/onboarding-email').set(authHeader('buyer'));
      expect(emailRes.statusCode).toBe(404);

      const ratingRes = await request(app).post('/api/vendors/invalid-id/rating-revision').set(authHeader('buyer')).send({
        qualityScore: 90,
        costScore: 90,
        deliveryScore: 90,
      });
      expect(ratingRes.statusCode).toBe(404);

      const delRes = await request(app).delete('/api/vendors/invalid-id').set(authHeader('buyer'));
      expect(delRes.statusCode).toBe(404);
    });
  });
});

// ==============================================================================
// RFQ EDIT AND DELETE
// ==============================================================================
// Both mutations are organisation-scoped in the same way as the reads. The cases
// that matter are the cross-organisation ones: an edit or delete aimed at another
// buyer's RFQ must report the same 404 as an id that does not exist, and must
// leave that RFQ untouched. Anything weaker would let one buyer rewrite or destroy
// another buyer's procurement record.
// ==============================================================================
describe('RFQ edit and delete (/api/rfqs/:id)', () => {
  // A real buyer account for TEST_USERS.buyer.email, so createRFQ/updateRFQ/
  // deleteRFQ's ownership scoping (canAccessRfq, resolved via
  // getBuyerAccountByEmail) has something real to scope against — created
  // once since storeService.addBuyerAccount doesn't dedupe by email.
  let ownAccountId;

  beforeAll(async () => {
    const res = await request(app).post('/api/buyer-accounts').set(authHeader('buyer')).send({
      organizationName: 'Test Buyer Org',
      corporateEmail: TEST_USERS.buyer.email,
    });
    ownAccountId = res.body.data.id;
    // Same reasoning as the earlier block: grant the top tier so this block's
    // repeated mode_2 RFQ creations aren't gated by the new entitlement check.
    storeService.updateBuyerAccount(ownAccountId, { subscriptionPlan: 'version_3' });
  });

  /** One RFQ owned by the real test buyer account, created via the real API. */
  async function createOwnRFQ(overrides = {}) {
    const res = await request(app)
      .post('/api/rfqs')
      .set(authHeader('buyer'))
      .send({
        title: 'Mechanical Spares Procurement',
        category: 'Engineering Spares - Mechanical',
        sourcingMode: 'mode_2',
        budget: 348000,
        targetDeliveryDate: A_FUTURE_DATE,
        deliveryLocation: 'Navi Mumbai Plant, Gate 3',
        deliveryPincode: '400701',
        ...overrides,
      });
    return res.body.data;
  }

  /** One RFQ owned by a different buyer account, created directly in-memory. */
  function createOtherBuyersRFQ(overrides = {}) {
    return storeService.createRFQ(
      {
        title: 'Mechanical Spares Procurement',
        category: 'Engineering Spares - Mechanical',
        sourcingMode: 'mode_2',
        budget: 348000,
        targetDeliveryDate: A_FUTURE_DATE,
        deliveryLocation: 'Navi Mumbai Plant, Gate 3',
        deliveryPincode: '400701',
        extractedEntities: [{ id: 'e1', itemName: 'Pump', quantity: 4 }],
        ...overrides,
      },
      { id: 'other-buyer-acc', organizationName: 'Someone Else Ltd.' }
    );
  }

  describe('PUT /api/rfqs/:id', () => {
    test('applies the edit and returns the stored record', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app)
        .put(`/api/rfqs/${rfq.id}`)
        .set(authHeader('buyer'))
        .send({ title: 'Revised Mechanical Spares', status: 'In Evaluation' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Revised Mechanical Spares');
      expect(res.body.data.status).toBe('In Evaluation');
      // Untouched fields survive a partial edit.
      expect(res.body.data.deliveryPincode).toBe('400701');
    });

    test('accepts the RFQ number as well as the row id', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app)
        .put(`/api/rfqs/${rfq.rfqNumber}`)
        .set(authHeader('buyer'))
        .send({ title: 'Addressed by RFQ number' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.title).toBe('Addressed by RFQ number');
    });

    test('requires a session', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app).put(`/api/rfqs/${rfq.id}`).send({ title: 'Revised' });

      expect(res.statusCode).toBe(401);
    });

    // A buyer's own account is resolved server-side, never trusted from the
    // client, so this is a miss rather than a refusal — the response cannot
    // be used to discover what other buyers hold.
    test('reports 404 for another buyer\'s RFQ and leaves it unchanged', async () => {
      const rfq = createOtherBuyersRFQ();

      const res = await request(app)
        .put(`/api/rfqs/${rfq.id}`)
        .set(authHeader('buyer'))
        .send({ title: 'Rewritten by another buyer' });

      expect(res.statusCode).toBe(404);
      expect(storeService.getRFQById(rfq.id).title).toBe('Mechanical Spares Procurement');
    });

    test('rejects a malformed pincode with a field error', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app)
        .put(`/api/rfqs/${rfq.id}`)
        .set(authHeader('buyer'))
        .send({ deliveryPincode: '!!' });

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryPincode).toBeTruthy();
      expect(storeService.getRFQById(rfq.id).deliveryPincode).toBe('400701');
    });

    test('rejects a negative budget', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app).put(`/api/rfqs/${rfq.id}`).set(authHeader('buyer')).send({ budget: -1 });

      expect(res.statusCode).toBe(400);
    });

    test('rejects a title shorter than the creation rule allows', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app).put(`/api/rfqs/${rfq.id}`).set(authHeader('buyer')).send({ title: 'ab' });

      expect(res.statusCode).toBe(400);
    });

    // Ownership/identity is established at creation and must stay that way —
    // only RFQ_UPDATABLE_FIELDS are ever written by a plain edit.
    test('ignores an attempt to reassign the RFQ to another buyer', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app)
        .put(`/api/rfqs/${rfq.id}`)
        .set(authHeader('buyer'))
        .send({ buyerAccountId: 'other-buyer-acc', id: 'hijacked-id', rfqNumber: 'RFQ-HIJACKED' });

      expect(res.statusCode).toBe(200);
      const stored = storeService.getRFQById(rfq.id);
      expect(stored.buyerAccountId).toBe(ownAccountId);
      expect(stored.id).toBe(rfq.id);
      expect(stored.rfqNumber).toBe(rfq.rfqNumber);
    });

    test('replaces the line items when the edit supplies them', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app)
        .put(`/api/rfqs/${rfq.id}`)
        .set(authHeader('buyer'))
        .send({ extractedEntities: [{ id: 'e9', itemName: 'Gate valve', quantity: 9 }] });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.extractedEntities).toHaveLength(1);
      expect(res.body.data.extractedEntities[0].itemName).toBe('Gate valve');
    });

    test('accepts an edit that changes nothing', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app).put(`/api/rfqs/${rfq.id}`).set(authHeader('buyer')).send({});

      expect(res.statusCode).toBe(200);
      expect(res.body.data.title).toBe('Mechanical Spares Procurement');
    });
  });

  describe('DELETE /api/rfqs/:id', () => {
    test('deletes the RFQ and echoes the number removed', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app).delete(`/api/rfqs/${rfq.id}`).set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rfqNumber).toBe(rfq.rfqNumber);
      expect(storeService.getRFQById(rfq.id)).toBeUndefined();
    });

    test('accepts the RFQ number as well as the row id', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app).delete(`/api/rfqs/${rfq.rfqNumber}`).set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(storeService.getRFQById(rfq.id)).toBeUndefined();
    });

    test('requires a session', async () => {
      const rfq = await createOwnRFQ();

      const res = await request(app).delete(`/api/rfqs/${rfq.id}`);

      expect(res.statusCode).toBe(401);
      expect(storeService.getRFQById(rfq.id)).toBeDefined();
    });

    test('reports 404 for an id that does not exist', async () => {
      const res = await request(app).delete('/api/rfqs/nonexistent-rfq').set(authHeader('buyer'));

      expect(res.statusCode).toBe(404);
    });

    // The case that matters: one buyer must not be able to destroy another's record.
    test('reports 404 for another buyer\'s RFQ and leaves it in place', async () => {
      const rfq = createOtherBuyersRFQ();

      const res = await request(app).delete(`/api/rfqs/${rfq.id}`).set(authHeader('buyer'));

      expect(res.statusCode).toBe(404);
      expect(storeService.getRFQById(rfq.id)).toBeDefined();
    });

    test('deletes only the RFQ named, leaving the buyer\'s others alone', async () => {
      const first = await createOwnRFQ();
      const second = await createOwnRFQ({ title: 'Second RFQ' });

      const res = await request(app).delete(`/api/rfqs/${first.id}`).set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(storeService.getRFQById(first.id)).toBeUndefined();
      expect(storeService.getRFQById(second.id)).toBeDefined();
    });
  });
});
