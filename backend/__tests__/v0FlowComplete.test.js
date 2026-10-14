const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const authService = require('../src/services/authService');
const smsService = require('../src/services/smsService');
const mailerService = require('../src/services/mailerService');
const whatsAppService = require('../src/services/whatsAppService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');

describe('V0 Flow E2E - 7-Step Actual Flow Verification', () => {
  const BUYER_EMAIL = 'v0buyer@enterprise.com';
  const VENDOR_PHONE = '9157154504';
  const VENDOR_EMAIL = 'vendor9157154504@procucev.com';
  let buyerAccount;
  let matchedVendor;
  let buyerAuthHeader;

  beforeEach(() => {
    storeService.reset();
    smsService.clearSmsThrottleCache();
    whatsAppService.clearWhatsAppThrottleCache();

    // 1. Create a buyer account with 0 free credits and free trial plan
    buyerAccount = storeService.addBuyerAccount({
      organizationName: 'Acme Test Corp',
      corporateEmail: BUYER_EMAIL,
      contactPhone: '+919876543210',
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 0, // 0 credits remaining
    });

    const token = authService.generateSessionToken({
      id: buyerAccount.id,
      email: BUYER_EMAIL,
      name: 'Acme Test Corp',
      role: 'buyer',
      orgId: buyerAccount.id,
      orgName: 'Acme Test Corp',
    });
    buyerAuthHeader = { Authorization: `Bearer ${token}` };

    // 2. Create Procucev platform vendor with phone 9157154504 and majorCategory 'Pumps & Motors'
    matchedVendor = storeService.addVendor({
      id: 'v-procucev-9157154504',
      name: 'Navin Enterprise',
      email: VENDOR_EMAIL,
      phone: VENDOR_PHONE,
      mobile: VENDOR_PHONE,
      majorCategory: 'Pumps & Motors',
      minorCategories: ['Industrial Pumps', 'Submersible Pumps'],
      source: 'platform_roster',
      status: 'VERIFIED SUPPLIER',
      rating: 4.8,
      pincode: '380001',
    });
  });

  afterEach(() => {
    rfqChaserScheduler.clearScheduledChasers('all');
    jest.restoreAllMocks();
  });

  test('Step 1: RFQ Creation works without subscription and with 0 credit deduction', async () => {
    const rfqPayload = {
      title: 'Industrial Water Pumps Requisition',
      category: 'Pumps & Motors',
      sourcingMode: 'mode_0', // V0
      deliveryLocation: 'Ahmedabad, Gujarat',
      deliveryPincode: '380001',
      targetDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      budget: 150000,
      lineItems: [{ description: 'High Pressure Pump', quantity: 3, unit: 'units' }],
    };

    const res = await request(app)
      .post('/api/rfqs')
      .set(buyerAuthHeader)
      .send(rfqPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sourcingMode).toBe('mode_0');

    // Verify 0 credit was deducted
    const updatedBuyer = storeService.buyerAccounts.find((b) => b.id === buyerAccount.id);
    expect(updatedBuyer.remainingFreeRFQs).toBe(0);
  });

  test('Step 2 & 3: Vendor Matching to Procucev vendors & 5-minute SMS alert with NO follow-ups', async () => {
    jest.useFakeTimers();
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-v0-test' });
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true });

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const rfq = storeService.createRFQ({
      title: 'Centrifugal Pumps Sourcing',
      category: 'Pumps & Motors',
      sourcingMode: 'mode_0',
      deliveryPincode: '380001',
    }, buyerAccount);

    // Step 2: Matched vendor 9157154504 is assigned
    expect(rfq.assignedVendors.some((v) => v.phone === VENDOR_PHONE || v.id === matchedVendor.id)).toBe(true);

    // Step 3: Only 1 timer is scheduled in scheduler (5 min SMS)
    expect(rfqChaserScheduler.pendingTimers.get(rfq.rfqNumber)).toHaveLength(1);

    // Before 5 minutes: SMS not fired yet
    jest.advanceTimersByTime(4 * 60 * 1000);
    expect(smsSpy).not.toHaveBeenCalled();

    // At 5 minutes: SMS is dispatched using existing template
    jest.advanceTimersByTime(60 * 1000 + 100);
    expect(smsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mobile: VENDOR_PHONE,
        rfqNumber: rfq.rfqNumber,
      })
    );

    // After 6h, 12h, 24h: No follow-up reminders
    jest.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(waSpy).not.toHaveBeenCalled();

    process.env.NODE_ENV = origEnv;
    jest.useRealTimers();
  });

  test('Step 4, 5, 6, 7: Vendor quote updates V0 status to Quotes Received, does NOT auto-close to Closed, emails buyer quote', async () => {
    const quoteEmailSpy = jest
      .spyOn(mailerService, 'sendQuoteReceivedEmail')
      .mockResolvedValue({ sent: true });

    const rfq = storeService.createRFQ({
      title: 'Centrifugal Pumps Sourcing',
      category: 'Pumps & Motors',
      sourcingMode: 'mode_0',
      deliveryPincode: '380001',
      source: 'web_portal',
      createdAt: new Date().toISOString(),
    }, buyerAccount);

    // The single matched vendor is the only invited vendor on this RFQ.
    expect(rfq.assignedVendors.some((v) => v.id === matchedVendor.id)).toBe(true);

    // Step 4: Vendor submits quote
    const quotePayload = {
      vendorId: matchedVendor.id,
      vendorName: matchedVendor.name,
      vendorEmail: matchedVendor.email,
      totalPrice: 120000,
      leadTimeDays: 14,
      items: [{ description: 'High Pressure Pump', unitPrice: 40000, quantity: 3, totalPrice: 120000 }],
    };

    const updatedRfq = storeService.addQuoteToRFQ(rfq.id, quotePayload);

    // Step 5: For V0, status changes to "Quotes Received" and does NOT automatically change to "Closed"
    expect(updatedRfq.status).toBe('Quotes Received');
    expect(updatedRfq.status).not.toBe('Closed');
    expect(updatedRfq.autoClosedReason).toBeUndefined();

    // Verify buyer receives quote email immediately with RFQ and quote payload
    expect(quoteEmailSpy).toHaveBeenCalledTimes(1);
    expect(quoteEmailSpy).toHaveBeenCalledWith(
      buyerAccount.corporateEmail,
      expect.objectContaining({
        rfq: expect.objectContaining({ id: rfq.id, rfqNumber: rfq.rfqNumber }),
        quote: expect.objectContaining({ totalPrice: 120000, vendorId: matchedVendor.id }),
      })
    );
    quoteEmailSpy.mockRestore();

    // Step 6 & 7: Buyer portal view verification via API
    const buyerViewRes = await request(app)
      .get(`/api/rfqs/${rfq.id}`)
      .set(buyerAuthHeader);

    expect(buyerViewRes.status).toBe(200);
    expect(buyerViewRes.body.data.status).toBe('Quotes Received');
    // Quotes not displayed in portal for comparison & vendor details not visible for V0
    expect(buyerViewRes.body.data.quotes).toEqual([]);
    expect(buyerViewRes.body.data.assignedVendors).toEqual([]);
  });

  test('V0 RFQ without category: is NOT automatically assigned to vendors and routes to Category Manager', async () => {
    const uncategorizedRfq = storeService.createRFQ({
      title: 'General Industrial Hardware',
      sourcingMode: 'mode_0',
      deliveryLocation: 'Ahmedabad, Gujarat',
      deliveryPincode: '380001',
      lineItems: [{ description: 'Steel fasteners', quantity: 100, unit: 'kg' }],
    }, buyerAccount);

    // Category was not selected by buyer
    expect(uncategorizedRfq.category).toBeNull();
    // Must NOT be automatically assigned to all Procucev vendors
    expect(uncategorizedRfq.assignedVendors).toEqual([]);
    expect(uncategorizedRfq.procucevVendorCount).toBe(0);
    expect(uncategorizedRfq.needsCategoryManagerAssignment).toBe(true);

    const augmented = await storeService.augmentV0AssignmentsFromDB(uncategorizedRfq);
    expect(augmented.assignedVendors).toEqual([]);
    expect(augmented.procucevVendorCount).toBe(0);

    // Category Manager notification was generated
    const cmNotif = storeService.notifications.find(
      (n) => n.recipientType === 'category_manager' && n.meta?.rfqId === uncategorizedRfq.id
    );
    expect(cmNotif).toBeDefined();
    expect(cmNotif.title).toContain('Pending Vendor Assignment');

    // Matched vendor does not cover this RFQ before manual CM assignment
    expect(storeService.vendorCoversRFQ(matchedVendor, uncategorizedRfq)).toBe(false);

    // Category Manager manually assigns the vendor
    await storeService.inviteVendorsToRFQ(uncategorizedRfq.id, [matchedVendor.id], 'cm@procucev.com');

    // Vendor can now see and cover the RFQ
    const refreshedRfq = storeService.getRFQById(uncategorizedRfq.id);
    expect(refreshedRfq.assignedVendors.some((v) => v.id === matchedVendor.id)).toBe(true);
    expect(storeService.vendorCoversRFQ(matchedVendor, refreshedRfq)).toBe(true);
    expect(refreshedRfq.needsCategoryManagerAssignment).toBe(false);
    expect(refreshedRfq.procucevVendorCount).toBe(refreshedRfq.assignedVendors.length);
  });
});
