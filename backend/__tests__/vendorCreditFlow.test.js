const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const mailerService = require('../src/services/mailerService');
const geminiService = require('../src/services/geminiService');
const { VENDOR_FREE_CREDITS_LIMIT } = require('../src/config/constants');
const { authHeader, TEST_USERS } = require('./testHelpers');

const { INGESTION_OUTCOME } = emailGatewayQueries;

describe('Vendor Free-Credit and Subscription Validation Flow', () => {
  const vendorEmail = 'vendor.apex@supplies.com';
  let testVendor;
  let testRfqs = [];

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset vendors array and create a test vendor
    storeService.vendors = [];
    testVendor = {
      id: 'v-test-apex',
      name: 'Apex Industrial Supplies',
      email: vendorEmail,
      contactPerson: 'Apex Contact',
      phone: '+91 98765 43210',
      majorCategory: 'Industrial Machinery',
      subscriptionPlan: 'premium',
      freeQuotationCredits: VENDOR_FREE_CREDITS_LIMIT, // 5
      quotedRfqIds: [],
    };
    storeService.vendors.push(testVendor);

    // Create 7 distinct test RFQs
    testRfqs = [];
    storeService.rfqs = [];
    for (let i = 1; i <= 7; i += 1) {
      const rfq = {
        id: `rfq-test-${i}`,
        rfqNumber: `RFQ-2026-0000${i}`,
        title: `Industrial Equipment Requirement ${i}`,
        category: 'Industrial Machinery',
        // mode_0 lets a category-matched network vendor reach the RFQ without
        // being on the invite list, so the portal quote path is authorized yet
        // still runs through the free-credit / subscription checks (an invited
        // vendor would instead be treated as buyer-mapped with unlimited quotes).
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        targetDeliveryDate: '2026-10-15',
        deliveryLocation: 'Mumbai',
        budget: 500000,
        // These scenarios exercise the network free-credit / subscription path
        // (not the buyer-invited unlimited path). An invited vendor is now
        // treated as buyer-mapped (unlimited, no credit consumed), so the RFQ
        // deliberately does NOT list testVendor as an invited/assigned vendor.
        // The email gateway still resolves testVendor by email from the vendor
        // registry, so quotation ingestion continues to work.
        assignedVendors: [],
        quotes: [],
        extractedEntities: [
          { itemName: `Equipment Component ${i}`, quantity: 2, unit: 'Nos', technicalSpecs: 'ISO 9001 Grade' },
        ],
      };
      testRfqs.push(rfq);
      storeService.rfqs.push(rfq);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Eligibility and Credit Consumption Unit Rules', () => {
    test('new vendor defaults to 5 free quotation credits and is eligible', () => {
      const eligibility = storeService.checkVendorQuotationEligibility(testVendor);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.freeCreditsRemaining).toBe(5);
      expect(eligibility.isSubscribed).toBe(false);
      expect(eligibility.subscriptionPlan).toBe('premium');
    });

    test('vendor eligibility fails when credits are 0 and no active subscription', () => {
      testVendor.freeQuotationCredits = 0;
      const eligibility = storeService.checkVendorQuotationEligibility(testVendor);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.freeCreditsRemaining).toBe(0);
      expect(eligibility.isSubscribed).toBe(false);
    });

    test('vendor is eligible with 0 credits if active subscription plan (connect or select) is active', () => {
      testVendor.freeQuotationCredits = 0;
      testVendor.subscriptionPlan = 'connect';
      const eligibility = storeService.checkVendorQuotationEligibility(testVendor);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.isSubscribed).toBe(true);

      testVendor.subscriptionPlan = 'select';
      expect(storeService.checkVendorQuotationEligibility(testVendor).eligible).toBe(true);

      testVendor.subscriptionPlan = 'premium';
      testVendor.isSubscribed = true;
      expect(storeService.checkVendorQuotationEligibility(testVendor).eligible).toBe(true);

      testVendor.isSubscribed = false;
      testVendor.subscriptionStatus = 'active';
      expect(storeService.checkVendorQuotationEligibility(testVendor).eligible).toBe(true);
    });

    test('checkVendorQuotationEligibility returns safe fallback for missing vendor', () => {
      const eligibility = storeService.checkVendorQuotationEligibility(null);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.freeCreditsRemaining).toBe(0);
    });

    test('consumeVendorQuotationCredit safely handles unknown vendor', () => {
      const res = storeService.consumeVendorQuotationCredit('unknown-v', 'rfq-1');
      expect(res).toBeNull();
    });

    test('resubmitting a quote for the same RFQ does not deduct an extra credit', () => {
      storeService.consumeVendorQuotationCredit(testVendor.id, 'rfq-test-1');
      expect(testVendor.freeQuotationCredits).toBe(4);
      expect(testVendor.quotedRfqIds).toContain('rfq-test-1');

      // Resubmission to rfq-test-1
      storeService.consumeVendorQuotationCredit(testVendor.id, 'rfq-test-1');
      expect(testVendor.freeQuotationCredits).toBe(4);
      expect(testVendor.quotedRfqIds).toHaveLength(1);
    });
  });

  describe('End-to-End Email Quotation Flow: First 5 Free -> 6th Exhausted -> Upgrade -> Post-Upgrade Quote', () => {
    const vendorGatewayConfig = {
      enabled: true,
      user: 'srinu20252026@gmail.com',
      address: 'srinu20252026@gmail.com',
      isVendorMailbox: true,
    };

    test('Step 1: First 5 RFQs can be quoted normally using free credits, bid created each time, credits decrease to 0', async () => {
      jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue(true);
      jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue(true);

      for (let i = 1; i <= 5; i += 1) {
        const rfq = testRfqs[i - 1];
        const quoteEml = `From: ${vendorEmail}
To: srinu20252026@gmail.com
Subject: Re: Quotation for ${rfq.rfqNumber}
Message-ID: <quote-${i}@apexsupplies.com>
Date: Tue, 22 Sep 2026 10:00:00 +0530
Content-Type: text/plain

Unit Price: INR 25,000
Lead Time: 7 days
Warranty: 1 year
Payment Terms: Net 30
Remarks: Standard delivery included
`;
        jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValueOnce({
          unitPrice: 25000,
          totalPrice: 50000,
          leadTimeDays: 7,
          warrantyYears: 1,
          paymentTerms: 'Net 30',
          remarks: 'Standard delivery included',
        });

        const result = await emailGatewayService.processMessage(Buffer.from(quoteEml, 'utf8'), vendorGatewayConfig);

        expect(result.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
        const updatedRfq = storeService.getRFQById(rfq.id);
        expect(updatedRfq.quotes).toHaveLength(1);
        expect(updatedRfq.quotes[0].vendorName).toBe(testVendor.name);
        expect(updatedRfq.quotes[0].unitPrice).toBe(25000);
        const updatedVendor = storeService.getVendorById(testVendor.id);
        expect(updatedVendor.freeQuotationCredits).toBe(5 - i);
      }

      // Verify all 5 credits used
      const finalVendor = storeService.getVendorById(testVendor.id);
      expect(finalVendor.freeQuotationCredits).toBe(0);
      expect(finalVendor.quotedRfqIds).toHaveLength(5);
    });

    test('Step 2 & 3: 6th RFQ quotation email without subscription is rejected with CREDITS_EXHAUSTED, dispatches upgrade notice, and creates NO bid', async () => {
      // Exhaust credits
      testVendor.freeQuotationCredits = 0;
      testVendor.quotedRfqIds = ['rfq-test-1', 'rfq-test-2', 'rfq-test-3', 'rfq-test-4', 'rfq-test-5'];

      const exhaustedEmailSpy = jest.spyOn(mailerService, 'sendVendorCreditsExhaustedEmail').mockResolvedValue(true);
      const addQuoteSpy = jest.spyOn(storeService, 'addQuoteToRFQ');

      const rfq6 = testRfqs[5]; // 6th RFQ
      const quote6Eml = `From: ${vendorEmail}
To: srinu20252026@gmail.com
Subject: Re: Quotation for ${rfq6.rfqNumber}
Message-ID: <quote-6-attempt@apexsupplies.com>
Date: Tue, 22 Sep 2026 11:00:00 +0530
Content-Type: text/plain

Unit Price: INR 30,000
Lead Time: 10 days
`;

      const result = await emailGatewayService.processMessage(Buffer.from(quote6Eml, 'utf8'), vendorGatewayConfig);

      expect(result.status).toBe(INGESTION_OUTCOME.CREDITS_EXHAUSTED);
      expect(result.detail).toContain(rfq6.rfqNumber);
      expect(result.detail).toContain(testVendor.name);

      // Verify exhaustion email sent with RFQ context and mandatory quotation requirements
      expect(exhaustedEmailSpy).toHaveBeenCalledTimes(1);
      expect(exhaustedEmailSpy).toHaveBeenCalledWith(
        vendorEmail,
        expect.objectContaining({
          rfqNumber: rfq6.rfqNumber,
          rfqTitle: rfq6.title,
          vendorName: testVendor.name,
          rfq: rfq6,
        })
      );

      // Verify NO bid was created on RFQ 6
      expect(addQuoteSpy).not.toHaveBeenCalled();
      expect(rfq6.quotes).toHaveLength(0);

      // Replying again to the email without subscribing: acknowledged with exhaustion email, NO BID created
      const replyAgainEml = `From: ${vendorEmail}
To: srinu20252026@gmail.com
Subject: Re: Action Required – 5 Free Quotation Credits Exhausted for RFQ #${rfq6.rfqNumber}
Message-ID: <reply-again-without-upgrade@apexsupplies.com>
Date: Tue, 22 Sep 2026 11:15:00 +0530
Content-Type: text/plain

Please accept my quotation at INR 28,000.
`;
      const resultAgain = await emailGatewayService.processMessage(Buffer.from(replyAgainEml, 'utf8'), vendorGatewayConfig);
      expect(resultAgain.status).toBe(INGESTION_OUTCOME.CREDITS_EXHAUSTED);
      expect(addQuoteSpy).not.toHaveBeenCalled();
      expect(rfq6.quotes).toHaveLength(0);
      expect(exhaustedEmailSpy).toHaveBeenCalledTimes(2);
    });

    test('Step 4 & 5: Vendor upgrades subscription -> subsequent quotation succeeds and bid is created', async () => {
      // Setup vendor with exhausted free credits
      testVendor.freeQuotationCredits = 0;
      testVendor.quotedRfqIds = ['rfq-test-1', 'rfq-test-2', 'rfq-test-3', 'rfq-test-4', 'rfq-test-5'];

      // Vendor upgrades to 'connect' subscription plan
      testVendor.subscriptionPlan = 'connect';
      testVendor.isSubscribed = true;

      const ackSpy = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue(true);
      const buyerReceivedSpy = jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue(true);

      const rfq6 = testRfqs[5];
      const subscribedQuoteEml = `From: ${vendorEmail}
To: srinu20252026@gmail.com
Subject: Re: Quotation for ${rfq6.rfqNumber}
Message-ID: <quote-post-upgrade-success@apexsupplies.com>
Date: Tue, 22 Sep 2026 12:00:00 +0530
Content-Type: text/plain

Unit Price: INR 27,500
Lead Time: 5 days
Warranty: 2 years
Payment Terms: Net 30
Remarks: Post-upgrade quotation
`;
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValueOnce({
        unitPrice: 27500,
        totalPrice: 55000,
        leadTimeDays: 5,
        warrantyYears: 2,
        paymentTerms: 'Net 30',
        remarks: 'Post-upgrade quotation',
      });

      const result = await emailGatewayService.processMessage(Buffer.from(subscribedQuoteEml, 'utf8'), vendorGatewayConfig);

      expect(result.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      const updatedRfq6 = storeService.getRFQById(rfq6.id);
      expect(updatedRfq6.quotes).toHaveLength(1);
      expect(updatedRfq6.quotes[0].unitPrice).toBe(27500);
      expect(updatedRfq6.quotes[0].vendorName).toBe(testVendor.name);
      expect(ackSpy).toHaveBeenCalled();
    });
  });

  describe('Portal Quotation API Consistency (POST /api/rfqs/:id/quotes)', () => {
    test('portal quotation returns 403 Forbidden with upgradeRequired when 5 free credits are exhausted', async () => {
      testVendor.freeQuotationCredits = 0;
      testVendor.subscriptionPlan = 'premium';
      testVendor.isSubscribed = false;
      // mode_0 requires the RFQ to be downloaded/unlocked before quoting; mark
      // it unlocked up-front so the request reaches the free-credit gate rather
      // than the download gate.
      testVendor.unlockedRfqIds = [testRfqs[0].id, testRfqs[0].rfqNumber];

      // Mock auth user as the vendor
      const vendorUser = {
        id: testVendor.id,
        email: testVendor.email,
        name: testVendor.name,
        role: 'vendor',
      };
      const token = require('../src/services/authService').generateSessionToken(vendorUser);

      const res = await request(app)
        .post(`/api/rfqs/${testRfqs[0].id}/quotes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          unitPrice: 45000,
          leadTimeDays: 7,
          warrantyYears: 1,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.upgradeRequired).toBe(true);
      expect(res.body.freeCreditsRemaining).toBe(0);
      expect(res.body.error).toContain('Your 5 free quotation credits have been used');
      expect(testRfqs[0].quotes).toHaveLength(0);
    });

    test('portal quotation succeeds when credits remain and decrements credit', async () => {
      testVendor.freeQuotationCredits = 5;
      testVendor.subscriptionPlan = 'premium';
      testVendor.isSubscribed = false;
      // Already downloaded (unlocked) without charging a credit here, so the
      // single free credit is consumed by the quotation itself (5 -> 4).
      testVendor.unlockedRfqIds = [testRfqs[0].id, testRfqs[0].rfqNumber];

      const vendorUser = {
        id: testVendor.id,
        email: testVendor.email,
        name: testVendor.name,
        role: 'vendor',
      };
      const token = require('../src/services/authService').generateSessionToken(vendorUser);

      const res = await request(app)
        .post(`/api/rfqs/${testRfqs[0].id}/quotes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          unitPrice: 45000,
          leadTimeDays: 7,
          warrantyYears: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const updatedRfq = storeService.getRFQById(testRfqs[0].id);
      expect(updatedRfq.quotes).toHaveLength(1);
      const updatedVendor = storeService.getVendorById(testVendor.id);
      expect(updatedVendor.freeQuotationCredits).toBe(4);
    });

    test('portal quotation succeeds when credits are 0 but vendor is subscribed', async () => {
      testVendor.freeQuotationCredits = 0;
      testVendor.subscriptionPlan = 'connect';
      testVendor.isSubscribed = true;
      // Subscribed vendors still must have downloaded the mode_0 RFQ first.
      testVendor.unlockedRfqIds = [testRfqs[0].id, testRfqs[0].rfqNumber];

      const vendorUser = {
        id: testVendor.id,
        email: testVendor.email,
        name: testVendor.name,
        role: 'vendor',
      };
      const token = require('../src/services/authService').generateSessionToken(vendorUser);

      const res = await request(app)
        .post(`/api/rfqs/${testRfqs[0].id}/quotes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          unitPrice: 48000,
          leadTimeDays: 5,
          warrantyYears: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const updatedRfq = storeService.getRFQById(testRfqs[0].id);
      expect(updatedRfq.quotes).toHaveLength(1);
    });
  });

  describe('Mailer Service: buildVendorCreditsExhaustedEmail and sendVendorCreditsExhaustedEmail', () => {
    test('buildVendorCreditsExhaustedEmail contains RFQ details, mandatory fields, and upgrade button', () => {
      const email = mailerService.buildVendorCreditsExhaustedEmail(vendorEmail, {
        rfq: testRfqs[0],
        rfqNumber: testRfqs[0].rfqNumber,
        rfqTitle: testRfqs[0].title,
        vendorName: testVendor.name,
      });

      expect(email.to).toBe(vendorEmail);
      expect(email.subject).toContain('Free Quotation Credits Exhausted');
      expect(email.html).toContain(testRfqs[0].rfqNumber);
      expect(email.html).toContain('Unit Price (₹)*');
      expect(email.html).toContain('Click Here to Go to Portal and Upgrade Plan');
      expect(email.html).toContain(mailerService.vendorUpgradeUrl());
    });

    test('sendVendorCreditsExhaustedEmail delivers cleanly via deliverVendor', async () => {
      const result = await mailerService.sendVendorCreditsExhaustedEmail(vendorEmail, {
        rfq: testRfqs[0],
        vendorName: testVendor.name,
      });
      expect(result).toBeDefined();
      expect(result.reason).toBe('test environment');
      expect(result.sent).toBe(false);
    });

    test('buildVendorCreditsExhaustedEmail covers all edge cases and parameter formats', () => {
      // Single object parameter style with custom upgradeUrl and cc
      const email1 = mailerService.buildVendorCreditsExhaustedEmail({
        to: vendorEmail,
        rfq: {
          rfqNumber: 'RFQ-ALT-1',
          title: 'Alternative RFQ',
          category: 'Spares',
          deadline: '2026-11-01',
          deliveryLocation: 'Delhi',
          items: [
            { name: 'Spare Item 1', specifications: 'Grade A', quantity: 5, uom: 'Sets', location: 'Noida' },
          ],
        },
        upgradeUrl: 'https://procucev.com/upgrade',
        cc: 'audit@procucev.ai',
      });
      expect(email1.cc).toBe('audit@procucev.ai');
      expect(email1.html).toContain('Grade A');
      expect(email1.html).toContain('https://procucev.com/upgrade');
      expect(email1.html).toContain('Noida');

      // lineItems with specs and no budget or vendorName
      const email2 = mailerService.buildVendorCreditsExhaustedEmail(vendorEmail, {
        rfq: {
          lineItems: [
            { description: 'Component Spec', specs: 'Precision 0.01mm', unit: 'Pcs' },
          ],
        },
      });
      expect(email2.html).toContain('Hello,');
      expect(email2.html).toContain('Precision 0.01mm');

      // Empty items
      const email3 = mailerService.buildVendorCreditsExhaustedEmail(vendorEmail, {
        rfq: { items: [] },
      });
      expect(email3.html).toBeDefined();
    });

    test('buildRfqInviteEmail covers vendor credit status banners', () => {
      // 1. Subscribed supplier
      const subscribedInvite = mailerService.buildRfqInviteEmail(vendorEmail, {
        rfq: testRfqs[0],
        isSubscribed: true,
      });
      expect(subscribedInvite.html).toContain('Subscribed Supplier');

      // 2. Free credits remaining > 0
      const creditsLeftInvite = mailerService.buildRfqInviteEmail(vendorEmail, {
        rfq: testRfqs[0],
        freeCreditsRemaining: 3,
        isSubscribed: false,
      });
      expect(creditsLeftInvite.html).toContain('Available Free Quotation Credits:</strong> 3 / 5');

      // 3. Free credits remaining = 0
      const exhaustedInvite = mailerService.buildRfqInviteEmail(vendorEmail, {
        rfq: testRfqs[0],
        freeCreditsRemaining: 0,
        isSubscribed: false,
      });
      expect(exhaustedInvite.html).toContain('(Plan upgrade required to submit quote)');
    });
  });

  describe('Gateway Polling Flags on CREDITS_EXHAUSTED', () => {
    test('pollVendorOnce marks seen on CREDITS_EXHAUSTED without incrementing ingested count', async () => {
      const flagged = [];
      const fakeClient = {
        connect: jest.fn().mockResolvedValue(true),
        getMailboxLock: jest.fn().mockResolvedValue({ release: jest.fn() }),
        search: jest.fn().mockResolvedValue([999]),
        fetchOne: jest.fn().mockResolvedValue({
          source: Buffer.from('From: vendor@ex.com\n\nMsg', 'utf8'),
          envelope: { messageId: '<credits-exhausted-seen-uid@ex.com>' },
        }),
        messageFlagsAdd: jest.fn(async (uid, flags) => {
          flagged.push([uid, flags]);
          return true;
        }),
        logout: jest.fn().mockResolvedValue(true),
      };

      emailGatewayService.ImapFlow = jest.fn(() => fakeClient);
      jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
      jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
      jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
        status: INGESTION_OUTCOME.CREDITS_EXHAUSTED,
        detail: 'Credits exhausted',
        message: { messageId: '<credits-exhausted-seen-uid@ex.com>', fromAddress: 'vendor@ex.com', subject: 'Quote' },
        rfq: testRfqs[0],
      });

      const config = emailGatewayService.resolveVendorConfig({
        VENDOR_EMAIL_GATEWAY_ENABLED: 'true',
        VENDOR_EMAIL_GATEWAY_HOST: 'imap.gmail.com',
        VENDOR_EMAIL_GATEWAY_USER: 'test@gmail.com',
        VENDOR_EMAIL_GATEWAY_PASSWORD: 'pass',
      });

      const res = await emailGatewayService.pollVendorOnce(config);
      expect(res.skipped).toBe(false);
      expect(res.ingested).toBe(0);
      expect(fakeClient.messageFlagsAdd).toHaveBeenCalledWith('999', ['\\Seen']);
    });

    test('pollVendorOnce records UNREADABLE when fetched message has no source', async () => {
      const fakeClient = {
        connect: jest.fn().mockResolvedValue(true),
        getMailboxLock: jest.fn().mockResolvedValue({ release: jest.fn() }),
        search: jest.fn().mockResolvedValue([888]),
        fetchOne: jest.fn().mockResolvedValue({ source: null }),
        messageFlagsAdd: jest.fn().mockResolvedValue(true),
        logout: jest.fn().mockResolvedValue(true),
      };

      emailGatewayService.ImapFlow = jest.fn(() => fakeClient);
      const config = emailGatewayService.resolveVendorConfig({
        VENDOR_EMAIL_GATEWAY_ENABLED: 'true',
        VENDOR_EMAIL_GATEWAY_HOST: 'imap.gmail.com',
        VENDOR_EMAIL_GATEWAY_USER: 'test@gmail.com',
        VENDOR_EMAIL_GATEWAY_PASSWORD: 'pass',
      });

      const res = await emailGatewayService.pollVendorOnce(config);
      expect(res.outcomes[0].status).toBe(INGESTION_OUTCOME.UNREADABLE);
    });

    test('pollOnce marks seen on CREDITS_EXHAUSTED without incrementing ingested count', async () => {
      const fakeClient = {
        connect: jest.fn().mockResolvedValue(true),
        getMailboxLock: jest.fn().mockResolvedValue({ release: jest.fn() }),
        search: jest.fn().mockResolvedValue([777]),
        fetchOne: jest.fn().mockResolvedValue({
          source: Buffer.from('From: vendor@ex.com\n\nMsg', 'utf8'),
          envelope: { messageId: '<buyer-seen-poll-uid@ex.com>' },
        }),
        messageFlagsAdd: jest.fn().mockResolvedValue(true),
        logout: jest.fn().mockResolvedValue(true),
      };

      emailGatewayService.ImapFlow = jest.fn(() => fakeClient);
      jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
      jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
      jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
        status: INGESTION_OUTCOME.CREDITS_EXHAUSTED,
        detail: 'Credits exhausted',
        message: { messageId: '<buyer-seen-poll-uid@ex.com>', fromAddress: 'vendor@ex.com', subject: 'Quote' },
        rfq: testRfqs[0],
      });

      const config = emailGatewayService.resolveConfig({
        EMAIL_GATEWAY_ENABLED: 'true',
        EMAIL_GATEWAY_HOST: 'imap.gmail.com',
        EMAIL_GATEWAY_USER: 'test@gmail.com',
        EMAIL_GATEWAY_PASSWORD: 'pass',
      });

      const res = await emailGatewayService.pollOnce(config);
      expect(res.skipped).toBe(false);
      expect(res.ingested).toBe(0);
      expect(fakeClient.messageFlagsAdd).toHaveBeenCalledWith('777', ['\\Seen']);
    });
  });
});

