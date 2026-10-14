jest.mock('../src/services/zohoPaymentService');

const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const identityQueries = require('../src/db/identityQueries');
const { authHeader, TEST_USERS } = require('./testHelpers');

describe('POST /api/buyer-accounts/:id/subscription-payment', () => {
  let buyerAccount;

  beforeEach(() => {
    jest.clearAllMocks();
    buyerAccount = storeService.addBuyerAccount({
      organizationName: 'Payment Link Test Buyer Co',
      corporateEmail: TEST_USERS.buyer.email,
      mobileNumber: '9876543210',
    });
    // Fallback used when a resolved/auto-created buyer account has no mobileNumber of its own.
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ mobile: '9123456780' });
  });

  test('requires a session', async () => {
    const res = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).send({ plan: 'version_1' });
    expect(res.statusCode).toBe(401);
  });

  test('a vendor or category manager cannot create a buyer payment link', async () => {
    const res1 = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('vendor')).send({ plan: 'version_1' });
    expect(res1.statusCode).toBe(403);
    const res2 = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('category_manager')).send({ plan: 'version_1' });
    expect(res2.statusCode).toBe(403);
  });

  test('an admin may create a payment link for any buyer account', async () => {
    zohoPaymentService.createPaymentLink.mockResolvedValue({
      zohoPaymentLinkId: 'zoho-admin-buyer-1',
      paymentUrl: 'https://payments.zoho.in/admin-buyer',
      status: 'CREATED',
      rawResponse: {},
    });
    const res = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('admin')).send({ plan: 'version_1' });
    expect(res.statusCode).toBe(200);
  });

  test('ignores an unknown :id and still resolves via the caller\'s own session email', async () => {
    zohoPaymentService.createPaymentLink.mockResolvedValue({
      zohoPaymentLinkId: 'zoho-ignored-id',
      paymentUrl: 'https://payments.zoho.in/ignored-id',
      status: 'CREATED',
      rawResponse: {},
    });
    const res = await request(app).post('/api/buyer-accounts/does-not-exist/subscription-payment').set(authHeader('buyer')).send({ plan: 'version_1' });
    expect(res.statusCode).toBe(200);
  });

  test('404s when the caller has no session email to resolve a buyer account from', async () => {
    const token = require('../src/services/authService').generateSessionToken({
      id: 'usr-no-email-buyer-404',
      email: '',
      name: 'No Email',
      role: 'admin',
      orgId: 'o',
      orgName: 'O',
    });
    const res = await request(app)
      .post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ plan: 'version_1' });
    expect(res.statusCode).toBe(404);
  });

  test('rejects free_trial — it is free and never reaches Zoho', async () => {
    const res = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('buyer')).send({ plan: 'free_trial' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/plan must be one of/i);
  });

  test('rejects an unrecognized plan', async () => {
    const res = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('buyer')).send({ plan: 'ultimate' });
    expect(res.statusCode).toBe(400);
  });

  // The "no email on file" 400 branch is unreachable through the real endpoint:
  // lookup is by the caller's own session email
  // (storeService.getBuyerAccountByEmail), which only ever matches a record
  // whose corporateEmail equals that same truthy email — so a matched
  // `existing` record can never have a falsy corporateEmail in practice.
  // Kept as defense in depth (e.g. a legacy record whose email field was
  // corrupted after the match); exercised directly via a spy since there's no
  // way to reach it through real request flow.
  test('400s when a resolved buyer account has no email on file (defense in depth)', async () => {
    const spy = jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'corrupted-buyer', corporateEmail: '' });
    const res = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('buyer')).send({ plan: 'version_1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/no email on file/i);
    spy.mockRestore();
  });

  test('400s when neither the domain record nor the identity record has a mobile number', async () => {
    const spy = jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'no-mobile-buyer', corporateEmail: TEST_USERS.buyer.email, mobileNumber: '' });
    identityQueries.findUserByEmail.mockResolvedValueOnce({ mobile: '' });
    const res = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('buyer')).send({ plan: 'version_1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/no mobile number on file/i);
    spy.mockRestore();
  });

  test('creates a real payment link, persists it with payerType buyer, and returns the redirect URL', async () => {
    zohoPaymentService.createPaymentLink.mockResolvedValue({
      zohoPaymentLinkId: 'zoho-buyer-happy-1',
      paymentUrl: 'https://payments.zoho.in/buyer-happy',
      status: 'CREATED',
      rawResponse: { payment_links: {} },
    });

    const res = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('buyer')).send({ plan: 'version_2' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { paymentUrl: 'https://payments.zoho.in/buyer-happy', paymentLinkId: expect.any(String), status: 'CREATED' },
    });
    expect(zohoPaymentService.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'version_2', email: buyerAccount.corporateEmail, phone: buyerAccount.mobileNumber, amountInr: 106185.84 })
    );
    const link = await storeService.getPaymentLinkByZohoId('zoho-buyer-happy-1');
    expect(link).toMatchObject({ buyerAccountId: buyerAccount.id, payerType: 'buyer', planId: 'version_2', billingDuration: '12_months', amount: 106185.84 });
  });

  test('creates a payment link for 6_months billing duration with ₹500 higher price', async () => {
    zohoPaymentService.createPaymentLink.mockResolvedValue({
      zohoPaymentLinkId: 'zoho-buyer-6m-1',
      paymentUrl: 'https://payments.zoho.in/buyer-6m',
      status: 'CREATED',
      rawResponse: { payment_links: {} },
    });

    const res = await request(app)
      .post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`)
      .set(authHeader('buyer'))
      .send({ plan: 'version_2', billingDuration: '6_months' });

    expect(res.statusCode).toBe(200);
    expect(zohoPaymentService.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'version_2', amountInr: 56632.92, planLabel: expect.stringContaining('(6 Months)') })
    );
    const link = await storeService.getPaymentLinkByZohoId('zoho-buyer-6m-1');
    expect(link).toMatchObject({ buyerAccountId: buyerAccount.id, payerType: 'buyer', planId: 'version_2', billingDuration: '6_months', amount: 56632.92 });

    // Activating this payment updates the buyer's subscriptionPlan and billingDuration
    storeService.activateBuyerSubscriptionFromPayment(link.id);
    const updatedBuyer = storeService.buyerAccounts.find((b) => b.id === buyerAccount.id);
    expect(updatedBuyer.subscriptionPlan).toBe('version_2');
    expect(updatedBuyer.billingDuration).toBe('6_months');
  });

  test('defaults status to CREATED when Zoho omits it', async () => {
    zohoPaymentService.createPaymentLink.mockResolvedValue({
      zohoPaymentLinkId: 'zoho-buyer-no-status',
      paymentUrl: 'https://payments.zoho.in/buyer-no-status',
      rawResponse: {},
    });

    const res = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('buyer')).send({ plan: 'version_1' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('CREATED');
  });

  test('returns 502 when Zoho payment-link creation throws', async () => {
    zohoPaymentService.createPaymentLink.mockRejectedValue(new Error('Zoho OAuth token refresh failed (401): invalid_client'));

    const res = await request(app).post(`/api/buyer-accounts/${buyerAccount.id}/subscription-payment`).set(authHeader('buyer')).send({ plan: 'version_3' });

    expect(res.statusCode).toBe(502);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/buyer-accounts/:id/payment-links and invoice download', () => {
  let buyerAccount;

  beforeEach(() => {
    jest.clearAllMocks();
    buyerAccount = storeService.addBuyerAccount({
      organizationName: 'Billing History Test Buyer Co',
      corporateEmail: TEST_USERS.buyer.email,
      mobileNumber: '9876543210',
    });
  });

  test('requires a session', async () => {
    const res = await request(app).get(`/api/buyer-accounts/${buyerAccount.id}/payment-links`);
    expect(res.statusCode).toBe(401);
  });

  test('a vendor cannot list buyer billing history', async () => {
    const res = await request(app).get(`/api/buyer-accounts/${buyerAccount.id}/payment-links`).set(authHeader('vendor'));
    expect(res.statusCode).toBe(403);
  });

  test('lists only the caller\'s own payment links, newest first', async () => {
    storeService.createPaymentLinkRecord({
      id: 'pl-buyer-hist-1',
      zohoPaymentLinkId: 'zoho-buyer-hist-1',
      buyerAccountId: buyerAccount.id,
      payerType: 'buyer',
      planId: 'version_1',
      amount: 2.36,
      paymentUrl: 'https://payments.zoho.in/1',
      status: 'active',
    });
    storeService.createPaymentLinkRecord({
      id: 'pl-buyer-hist-2',
      zohoPaymentLinkId: 'zoho-buyer-hist-2',
      buyerAccountId: buyerAccount.id,
      payerType: 'buyer',
      planId: 'version_3',
      amount: 9.44,
      paymentUrl: 'https://payments.zoho.in/2',
      status: 'paid',
    });
    // A different buyer's link must never appear here.
    const otherBuyer = storeService.addBuyerAccount({ organizationName: 'Other Buyer Co', corporateEmail: 'other-billing-buyer@example.com' });
    storeService.createPaymentLinkRecord({
      id: 'pl-buyer-hist-other',
      zohoPaymentLinkId: 'zoho-buyer-hist-other',
      buyerAccountId: otherBuyer.id,
      payerType: 'buyer',
      planId: 'version_2',
      amount: 5.9,
      paymentUrl: 'https://payments.zoho.in/3',
      status: 'active',
    });

    const res = await request(app).get(`/api/buyer-accounts/${buyerAccount.id}/payment-links`).set(authHeader('buyer'));

    expect(res.statusCode).toBe(200);
    expect(res.body.data.map((l) => l.id)).toEqual(['pl-buyer-hist-2', 'pl-buyer-hist-1']);
  });

  test('downloads a real PDF receipt for one of this buyer\'s own payments', async () => {
    const link = storeService.createPaymentLinkRecord({
      id: 'pl-buyer-invoice-1',
      zohoPaymentLinkId: 'zoho-buyer-invoice-1',
      buyerAccountId: buyerAccount.id,
      payerType: 'buyer',
      planId: 'version_2',
      amount: 5.9,
      paymentUrl: 'https://payments.zoho.in/1',
      status: 'paid',
    });

    const res = await request(app)
      .get(`/api/buyer-accounts/${buyerAccount.id}/payment-links/${link.id}/invoice`)
      .set(authHeader('buyer'));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`receipt-${link.id}.pdf`);
    expect(res.body.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  test('404s for a payment link that belongs to a different buyer account', async () => {
    const otherBuyer = storeService.addBuyerAccount({ organizationName: 'Other Buyer Co 2', corporateEmail: 'other-billing-buyer-2@example.com' });
    const otherLink = storeService.createPaymentLinkRecord({
      id: 'pl-buyer-not-mine',
      zohoPaymentLinkId: 'zoho-buyer-not-mine',
      buyerAccountId: otherBuyer.id,
      payerType: 'buyer',
      planId: 'version_1',
      amount: 2.36,
      paymentUrl: 'https://payments.zoho.in/1',
      status: 'paid',
    });

    const res = await request(app)
      .get(`/api/buyer-accounts/${buyerAccount.id}/payment-links/${otherLink.id}/invoice`)
      .set(authHeader('buyer'));

    expect(res.statusCode).toBe(404);
  });

  test('404s for an unknown payment link id', async () => {
    const res = await request(app)
      .get(`/api/buyer-accounts/${buyerAccount.id}/payment-links/does-not-exist/invoice`)
      .set(authHeader('buyer'));
    expect(res.statusCode).toBe(404);
  });
});
