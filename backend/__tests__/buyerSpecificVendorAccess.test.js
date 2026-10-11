const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const mailerService = require('../src/services/mailerService');
const geminiService = require('../src/services/geminiService');
const authService = require('../src/services/authService');
const { VENDOR_FREE_CREDITS_LIMIT } = require('../src/config/constants');

const { INGESTION_OUTCOME } = emailGatewayQueries;

function vendorAuthHeader(vendor) {
  const token = authService.generateSessionToken({
    id: vendor.id,
    email: vendor.email,
    role: 'vendor',
    name: vendor.name,
  });
  return { Authorization: `Bearer ${token}` };
}

describe('Buyer-Specific Vendor Access & Unlimited Quotation Rules', () => {
  const buyerAAccount = {
    id: 'buyer-account-a',
    organizationName: 'Alpha Construction Ltd',
    corporateEmail: 'buyer.alpha@alphaconstr.com',
  };

  const buyerBAccount = {
    id: 'buyer-account-b',
    organizationName: 'Beta Manufacturing Corp',
    corporateEmail: 'buyer.beta@betamanuf.com',
  };

  const vendorXEmail = 'vendor.x@apexsupplies.com';
  let vendorX;
  let rfqA1;
  let rfqA2;
  let rfqB1;
  let rfqB2;

  const vendorGatewayConfig = {
    enabled: true,
    user: 'quotes@enterprisequa.com',
    address: 'quotes@enterprisequa.com',
    isVendorMailbox: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Register buyer accounts in storeService
    storeService.buyerAccounts = [buyerAAccount, buyerBAccount];

    // Vendor X uploaded by Buyer A
    vendorX = {
      id: 'v-test-vendor-x',
      name: 'Vendor X Solutions',
      email: vendorXEmail,
      contactPerson: 'Vendor X Lead',
      phone: '+91 98765 00001',
      majorCategory: 'Industrial Machinery',
      buyerId: buyerAAccount.id,
      buyerAccountId: buyerAAccount.id,
      addedByBuyerCompany: buyerAAccount.organizationName,
      buyerEmail: buyerAAccount.corporateEmail,
      subscriptionPlan: 'premium',
      isSubscribed: false,
      subscriptionStatus: 'inactive',
      freeQuotationCredits: VENDOR_FREE_CREDITS_LIMIT, // 5
      quotedRfqIds: [],
    };
    storeService.vendors = [vendorX];

    // RFQ A1 & A2 created by Buyer A
    rfqA1 = {
      id: 'rfq-a1',
      rfqNumber: 'RFQ-ALPHA-001',
      title: 'Centrifugal Pump Package',
      category: 'Industrial Machinery',
      status: 'Quotes Pending',
      targetDeliveryDate: '2026-11-01',
      deliveryLocation: 'Mumbai',
      budget: 350000,
      buyerAccountId: buyerAAccount.id,
      buyerAccountName: buyerAAccount.organizationName,
      buyerEmail: buyerAAccount.corporateEmail,
      assignedVendors: [],
      quotes: [],
      extractedEntities: [
        { itemName: 'Centrifugal Pump 15HP', quantity: 2, unit: 'Nos', technicalSpecs: 'High Pressure' },
      ],
    };

    rfqA2 = {
      id: 'rfq-a2',
      rfqNumber: 'RFQ-ALPHA-002',
      title: 'Valve and Pipeline Assembly',
      category: 'Industrial Machinery',
      status: 'Quotes Pending',
      targetDeliveryDate: '2026-11-15',
      deliveryLocation: 'Pune',
      budget: 200000,
      buyerAccountId: buyerAAccount.id,
      buyerAccountName: buyerAAccount.organizationName,
      buyerEmail: buyerAAccount.corporateEmail,
      assignedVendors: [],
      quotes: [],
      extractedEntities: [
        { itemName: 'Gate Valves 4 inch', quantity: 10, unit: 'Nos', technicalSpecs: 'Forged Steel' },
      ],
    };

    // RFQ B1 & B2 created by Buyer B
    rfqB1 = {
      id: 'rfq-b1',
      rfqNumber: 'RFQ-BETA-001',
      title: 'Heavy Hydraulic Press',
      category: 'Industrial Machinery',
      status: 'Quotes Pending',
      targetDeliveryDate: '2026-11-20',
      deliveryLocation: 'Ahmedabad',
      budget: 800000,
      buyerAccountId: buyerBAccount.id,
      buyerAccountName: buyerBAccount.organizationName,
      buyerEmail: buyerBAccount.corporateEmail,
      assignedVendors: [],
      quotes: [],
      extractedEntities: [
        { itemName: 'Hydraulic Cylinder 50T', quantity: 1, unit: 'Nos', technicalSpecs: 'Heavy Duty' },
      ],
    };

    rfqB2 = {
      id: 'rfq-b2',
      rfqNumber: 'RFQ-BETA-002',
      title: 'Conveyor Roller System',
      category: 'Industrial Machinery',
      status: 'Quotes Pending',
      targetDeliveryDate: '2026-12-01',
      deliveryLocation: 'Vadodara',
      budget: 450000,
      buyerAccountId: buyerBAccount.id,
      buyerAccountName: buyerBAccount.organizationName,
      buyerEmail: buyerBAccount.corporateEmail,
      assignedVendors: [],
      quotes: [],
      extractedEntities: [
        { itemName: 'Steel Rollers', quantity: 50, unit: 'Nos', technicalSpecs: 'Precision Bearing' },
      ],
    };

    storeService.rfqs = [rfqA1, rfqA2, rfqB1, rfqB2];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('storeService.isVendorMappedToRfqBuyer Mapping Resolution', () => {
    test('returns true when vendor.buyerId matches rfq.buyerAccountId', () => {
      expect(storeService.isVendorMappedToRfqBuyer(vendorX, rfqA1)).toBe(true);
      expect(storeService.isVendorMappedToRfqBuyer(vendorX, rfqA2)).toBe(true);
    });

    test('returns true when vendor.addedByBuyerCompany matches rfq.buyerAccountName', () => {
      const v = { addedByBuyerCompany: 'Alpha Construction Ltd' };
      expect(storeService.isVendorMappedToRfqBuyer(v, rfqA1)).toBe(true);
    });

    test('returns true when vendor.buyerEmail matches rfq.buyerEmail or rfq.raisedByEmail', () => {
      const v = { buyerEmail: 'buyer.alpha@alphaconstr.com' };
      expect(storeService.isVendorMappedToRfqBuyer(v, rfqA1)).toBe(true);

      const rfqWithRaisedBy = { ...rfqA1, buyerEmail: null, raisedByEmail: 'buyer.alpha@alphaconstr.com' };
      expect(storeService.isVendorMappedToRfqBuyer(v, rfqWithRaisedBy)).toBe(true);
    });

    test('returns true when vendor.mappedBuyerIds contains rfq.buyerAccountId', () => {
      const v = { mappedBuyerIds: ['some-other-buyer', buyerAAccount.id] };
      expect(storeService.isVendorMappedToRfqBuyer(v, rfqA1)).toBe(true);
    });

    test('returns true via buyerAccount directory fallback lookup', () => {
      const v = { addedByBuyerCompany: 'Alpha Construction Ltd' };
      const rfq = { buyerAccountId: buyerAAccount.id };
      expect(storeService.isVendorMappedToRfqBuyer(v, rfq)).toBe(true);
    });

    test('returns false when vendor belongs to Buyer A and RFQ belongs to Buyer B', () => {
      expect(storeService.isVendorMappedToRfqBuyer(vendorX, rfqB1)).toBe(false);
      expect(storeService.isVendorMappedToRfqBuyer(vendorX, rfqB2)).toBe(false);
    });

    test('returns false when vendor or rfq is null or undefined', () => {
      expect(storeService.isVendorMappedToRfqBuyer(null, rfqA1)).toBe(false);
      expect(storeService.isVendorMappedToRfqBuyer(vendorX, null)).toBe(false);
      expect(storeService.isVendorMappedToRfqBuyer(null, null)).toBe(false);
    });
  });

  describe('storeService.checkVendorQuotationEligibility Rules', () => {
    test('buyer-mapped vendor is eligible with 0 free credits and no subscription for mapped buyer RFQs', () => {
      vendorX.freeQuotationCredits = 0;
      vendorX.subscriptionPlan = 'premium';
      vendorX.isSubscribed = false;

      const eligibility = storeService.checkVendorQuotationEligibility(vendorX, rfqA1);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.isBuyerMapped).toBe(true);
      expect(eligibility.freeCreditsRemaining).toBe(0);
    });

    test('buyer-mapped vendor is eligible with positive free credits for mapped buyer RFQs', () => {
      vendorX.freeQuotationCredits = 5;
      const eligibility = storeService.checkVendorQuotationEligibility(vendorX, rfqA1);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.isBuyerMapped).toBe(true);
      expect(eligibility.freeCreditsRemaining).toBe(5);
    });

    test('vendor is NOT eligible for other buyer RFQ when credits are 0 and no subscription', () => {
      vendorX.freeQuotationCredits = 0;
      vendorX.subscriptionPlan = 'premium';
      vendorX.isSubscribed = false;

      const eligibility = storeService.checkVendorQuotationEligibility(vendorX, rfqB1);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.isBuyerMapped).toBe(false);
      expect(eligibility.freeCreditsRemaining).toBe(0);
    });

    test('vendor is eligible for other buyer RFQ when vendor has remaining free credits', () => {
      vendorX.freeQuotationCredits = 3;
      const eligibility = storeService.checkVendorQuotationEligibility(vendorX, rfqB1);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.isBuyerMapped).toBe(false);
      expect(eligibility.freeCreditsRemaining).toBe(3);
    });

    test('vendor is eligible for other buyer RFQ with 0 credits if vendor has an active subscription', () => {
      vendorX.freeQuotationCredits = 0;
      vendorX.subscriptionPlan = 'connect';
      const eligibility = storeService.checkVendorQuotationEligibility(vendorX, rfqB1);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.isBuyerMapped).toBe(false);
      expect(eligibility.isSubscribed).toBe(true);
    });
  });

  describe('storeService.consumeVendorQuotationCredit Credit Deductions', () => {
    test('submitting quote for buyer-mapped RFQ does NOT consume vendor free credits', () => {
      vendorX.freeQuotationCredits = 5;
      storeService.consumeVendorQuotationCredit(vendorX.id, rfqA1.id);

      const vAfterA1 = storeService.getVendorById(vendorX.id, 'all');
      expect(vAfterA1.freeQuotationCredits).toBe(5);
      expect(vAfterA1.quotedRfqIds).toContain(rfqA1.id);

      // Quoting another RFQ from the same mapped buyer also preserves credits
      storeService.consumeVendorQuotationCredit(vendorX.id, rfqA2.id);
      const vAfterA2 = storeService.getVendorById(vendorX.id, 'all');
      expect(vAfterA2.freeQuotationCredits).toBe(5);
      expect(vAfterA2.quotedRfqIds).toContain(rfqA2.id);
    });

    test('submitting quote for non-mapped RFQ DOES consume 1 credit', () => {
      vendorX.freeQuotationCredits = 5;
      storeService.consumeVendorQuotationCredit(vendorX.id, rfqB1.id);

      const vAfterB1 = storeService.getVendorById(vendorX.id, 'all');
      expect(vAfterB1.freeQuotationCredits).toBe(4);
      expect(vAfterB1.quotedRfqIds).toContain(rfqB1.id);
    });

    test('resubmitting quote for the same non-mapped RFQ does not deduct an extra credit', () => {
      vendorX.freeQuotationCredits = 5;
      storeService.consumeVendorQuotationCredit(vendorX.id, rfqB1.id);
      const v1 = storeService.getVendorById(vendorX.id, 'all');
      expect(v1.freeQuotationCredits).toBe(4);

      storeService.consumeVendorQuotationCredit(vendorX.id, rfqB1.id);
      const v2 = storeService.getVendorById(vendorX.id, 'all');
      expect(v2.freeQuotationCredits).toBe(4);
    });

    test('buyer-mapped quote submission works even when credits are 0 and leaves credits at 0', () => {
      vendorX.freeQuotationCredits = 0;
      storeService.consumeVendorQuotationCredit(vendorX.id, rfqA1.id);

      const vAfter = storeService.getVendorById(vendorX.id, 'all');
      expect(vAfter.freeQuotationCredits).toBe(0);
      expect(vAfter.quotedRfqIds).toContain(rfqA1.id);
    });
  });

  describe('storeService.vendorCoversRFQ Visibility Permissions', () => {
    test('buyer-mapped vendor can view mapped buyer RFQs matching their category', () => {
      expect(storeService.vendorCoversRFQ(vendorX, rfqA1)).toBe(true);
      expect(storeService.vendorCoversRFQ(vendorX, rfqA2)).toBe(true);
    });

    test('vendor cannot view other buyer RFQ unless explicitly invited', () => {
      // Not invited on rfqB1
      expect(storeService.vendorCoversRFQ(vendorX, rfqB1)).toBe(false);

      // Invite vendor onto rfqB1
      rfqB1.assignedVendors = [{ id: vendorX.id, name: vendorX.name, email: vendorX.email }];
      expect(storeService.vendorCoversRFQ(vendorX, rfqB1)).toBe(true);
    });
  });

  describe('POST /api/rfqs/:id/quotes API Endpoint Permissions', () => {
    test('buyer-mapped vendor can submit unlimited quotes to mapped buyer RFQs with 0 credits and no subscription', async () => {
      vendorX.freeQuotationCredits = 0;
      vendorX.subscriptionPlan = 'premium';
      vendorX.isSubscribed = false;

      const resA1 = await request(app)
        .post(`/api/rfqs/${rfqA1.id}/quotes`)
        .set(vendorAuthHeader(vendorX))
        .send({
          unitPrice: 125000,
          leadTimeDays: 14,
          paymentTerms: '30 Days Net',
          remarks: 'Unlimited quote from mapped vendor',
        });

      expect(resA1.status).toBe(200);
      expect(resA1.body.success).toBe(true);
      expect(resA1.body.data.quotes).toHaveLength(1);
      const vAfterA1 = storeService.getVendorById(vendorX.id, 'all');
      expect(vAfterA1.freeQuotationCredits).toBe(0);

      // Submit second quote to rfqA2
      const resA2 = await request(app)
        .post(`/api/rfqs/${rfqA2.id}/quotes`)
        .set(vendorAuthHeader(vendorX))
        .send({
          unitPrice: 190000,
          leadTimeDays: 20,
          paymentTerms: '45 Days Net',
          remarks: 'Second unlimited quote from mapped vendor',
        });

      expect(resA2.status).toBe(200);
      expect(resA2.body.success).toBe(true);
      const vAfterA2 = storeService.getVendorById(vendorX.id, 'all');
      expect(vAfterA2.freeQuotationCredits).toBe(0);
    });

    test('vendor cannot quote other buyer RFQ when not invited (returns 404 out of scope)', async () => {
      const res = await request(app)
        .post(`/api/rfqs/${rfqB1.id}/quotes`)
        .set(vendorAuthHeader(vendorX))
        .send({
          unitPrice: 750000,
          leadTimeDays: 30,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
    });

    test('being invited onto another buyer RFQ grants invitation-based unlimited quoting (no free credit consumed)', async () => {
      // An explicit invitation (membership in assignedVendors) now marks the
      // vendor as mapped to that RFQ, so quoting it is treated the same as a
      // buyer-mapped vendor: unlimited and free of credit consumption. The
      // vendor's 5 free credits are therefore preserved.
      rfqB1.assignedVendors = [{ id: vendorX.id, name: vendorX.name, email: vendorX.email }];
      vendorX.freeQuotationCredits = 5;
      vendorX.unlockedRfqIds = [rfqB1.id];

      const res = await request(app)
        .post(`/api/rfqs/${rfqB1.id}/quotes`)
        .set(vendorAuthHeader(vendorX))
        .send({
          unitPrice: 780000,
          leadTimeDays: 25,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const vAfter = storeService.getVendorById(vendorX.id, 'all');
      expect(vAfter.freeQuotationCredits).toBe(5);
    });

    test('invited vendor with 0 credits and no subscription can still quote the inviting RFQ (invitation-based unlock)', async () => {
      // Because invitation grants unlimited quoting on that RFQ, a 0-credit
      // unsubscribed vendor is NOT blocked when quoting an RFQ they were
      // explicitly invited onto.
      rfqB1.assignedVendors = [{ id: vendorX.id, name: vendorX.name, email: vendorX.email }];
      vendorX.freeQuotationCredits = 0;
      vendorX.subscriptionPlan = 'premium';
      vendorX.isSubscribed = false;
      vendorX.unlockedRfqIds = [rfqB1.id];

      const res = await request(app)
        .post(`/api/rfqs/${rfqB1.id}/quotes`)
        .set(vendorAuthHeader(vendorX))
        .send({
          unitPrice: 780000,
          leadTimeDays: 25,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const vAfter = storeService.getVendorById(vendorX.id, 'all');
      expect(vAfter.freeQuotationCredits).toBe(0);

      // The same vendor also quotes their own mapped buyer's RFQ freely.
      const resMapped = await request(app)
        .post(`/api/rfqs/${rfqA1.id}/quotes`)
        .set(vendorAuthHeader(vendorX))
        .send({
          unitPrice: 110000,
          leadTimeDays: 10,
        });

      expect(resMapped.status).toBe(200);
      expect(resMapped.body.success).toBe(true);
    });
  });

  describe('Email Gateway Quotation Ingestion Workflow', () => {
    test('buyer-mapped vendor quoting via email succeeds with 0 credits without deduction', async () => {
      vendorX.freeQuotationCredits = 0;
      vendorX.subscriptionPlan = 'premium';
      vendorX.isSubscribed = false;

      jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue(true);
      jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue(true);
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValue({
        unitPrice: 135000,
        totalPrice: 270000,
        leadTimeDays: 14,
        paymentTerms: '30 Days Net',
      });

      const quoteEml = `From: ${vendorX.email}
To: quotes@enterprisequa.com
Subject: Re: Request for Quotation ${rfqA1.rfqNumber}
Message-ID: <quote-a1@apexsupplies.com>
Date: Tue, 22 Sep 2026 10:00:00 +0530
Content-Type: text/plain

Unit Price: INR 135,000
Lead Time: 14 days
Payment Terms: 30 Days Net
`;

      const result = await emailGatewayService.processMessage(Buffer.from(quoteEml, 'utf8'), vendorGatewayConfig);

      expect(result.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      const updatedRfqA1 = storeService.getRFQById(rfqA1.id);
      expect(updatedRfqA1.quotes).toHaveLength(1);
      expect(updatedRfqA1.quotes[0].unitPrice).toBe(135000);
      const vAfter = storeService.getVendorById(vendorX.id, 'all');
      expect(vAfter.freeQuotationCredits).toBe(0);
      expect(mailerService.sendQuoteAcknowledgementEmail).toHaveBeenCalled();
    });

    test('vendor quoting a NON-invited other buyer RFQ via email with 0 credits triggers credits exhausted notification', async () => {
      // The vendor is NOT invited onto rfqB1 (assignedVendors stays empty), so
      // it is neither buyer-mapped nor invitation-unlocked. With 0 free credits
      // and no subscription the email quotation is rejected as exhausted. (An
      // invited vendor would instead quote unlimited — see the portal tests.)
      rfqB1.assignedVendors = [];
      vendorX.freeQuotationCredits = 0;
      vendorX.subscriptionPlan = 'premium';
      vendorX.isSubscribed = false;

      jest.spyOn(mailerService, 'sendVendorCreditsExhaustedEmail').mockResolvedValue(true);

      const quoteB1Eml = `From: ${vendorX.email}
To: quotes@enterprisequa.com
Subject: Re: Request for Quotation ${rfqB1.rfqNumber}
Message-ID: <quote-b1@apexsupplies.com>
Date: Tue, 22 Sep 2026 11:00:00 +0530
Content-Type: text/plain

Unit Price: INR 790,000
Lead Time: 25 days
`;

      const result = await emailGatewayService.processMessage(Buffer.from(quoteB1Eml, 'utf8'), vendorGatewayConfig);

      expect(result.status).toBe(INGESTION_OUTCOME.CREDITS_EXHAUSTED);
      const updatedRfqB1 = storeService.getRFQById(rfqB1.id);
      expect(updatedRfqB1.quotes).toHaveLength(0);
      expect(mailerService.sendVendorCreditsExhaustedEmail).toHaveBeenCalledWith(
        vendorX.email,
        expect.objectContaining({
          rfqNumber: rfqB1.rfqNumber,
          vendorName: vendorX.name,
        })
      );
    });
  });
});
