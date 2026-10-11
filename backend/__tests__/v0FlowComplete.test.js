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

  test('Step 4, 5, 6, 7: Final invited vendor quote auto-closes the RFQ, emails the buyer an acknowledgement, hides quotes from portal, bypasses 48h restriction', async () => {
    jest.useFakeTimers();
    // When every invited vendor has quoted, the RFQ auto-closes and the buyer
    // receives the auto-closure acknowledgement email (not the per-quote
    // "Quotes Received" email). The 5-minute comparison email/SMS fire later.
    const autoClosureSpy = jest
      .spyOn(mailerService, 'sendRfqAutoClosureAcknowledgementEmail')
      .mockResolvedValue({ sent: true });
    const comparisonEmailSpy = jest
      .spyOn(mailerService, 'sendRfqFinalComparisonEmail')
      .mockResolvedValue({ sent: true });
    jest.spyOn(smsService, 'sendBuyerComparisonSms').mockResolvedValue({ success: true });

    const rfq = storeService.createRFQ({
      title: 'Centrifugal Pumps Sourcing',
      category: 'Pumps & Motors',
      sourcingMode: 'mode_0',
      deliveryPincode: '380001',
      source: 'web_portal',
      createdAt: new Date().toISOString(), // Brand new RFQ (within 48h)
    }, buyerAccount);

    // The single matched vendor is the only invited vendor on this RFQ.
    expect(rfq.assignedVendors.some((v) => v.id === matchedVendor.id)).toBe(true);

    // Step 4: Vendor submits quote — this is 100% of invited vendors.
    const quotePayload = {
      vendorId: matchedVendor.id,
      vendorName: matchedVendor.name,
      vendorEmail: matchedVendor.email,
      totalPrice: 120000,
      leadTimeDays: 14,
      items: [{ description: 'High Pressure Pump', unitPrice: 40000, quantity: 3, totalPrice: 120000 }],
    };

    const updatedRfq = storeService.addQuoteToRFQ(rfq.id, quotePayload);

    // Step 4 Verification: buyer receives the immediate auto-closure acknowledgement email.
    expect(autoClosureSpy).toHaveBeenCalledWith(
      BUYER_EMAIL,
      expect.objectContaining({
        rfq: expect.objectContaining({ rfqNumber: rfq.rfqNumber }),
        quotesCount: 1,
      })
    );

    // Step 5: 100% invited participation auto-closes the RFQ.
    expect(updatedRfq.status).toBe('Closed');
    expect(updatedRfq.autoClosedReason).toBe('All invited vendors submitted quotes');

    // The scheduled 5-minute comparison dispatch fires after the delay (the
    // closure also sends an immediate comparison email via notifyOfRFQClosure,
    // so advancing the timer adds one more dispatch).
    const callsBeforeAdvance = comparisonEmailSpy.mock.calls.length;
    jest.advanceTimersByTime(5 * 60 * 1000 + 100);
    expect(comparisonEmailSpy.mock.calls.length).toBeGreaterThan(callsBeforeAdvance);
    expect(comparisonEmailSpy).toHaveBeenCalledWith(
      BUYER_EMAIL,
      expect.objectContaining({ rfq: expect.objectContaining({ rfqNumber: rfq.rfqNumber }) })
    );

    jest.useRealTimers();

    // Step 6 & 7: Buyer portal view verification via API
    const buyerViewRes = await request(app)
      .get(`/api/rfqs/${rfq.id}`)
      .set(buyerAuthHeader);

    expect(buyerViewRes.status).toBe(200);
    expect(buyerViewRes.body.data.status).toBe('Closed');
    // Step 6: Quotes not displayed in portal for comparison & vendor details not visible
    expect(buyerViewRes.body.data.quotes).toEqual([]);
    expect(buyerViewRes.body.data.assignedVendors).toEqual([]);
    // Step 7: 48-hour sealed restriction does not apply to V0
    expect(buyerViewRes.body.data.quotesHidden).toBe(false);
  });
});
