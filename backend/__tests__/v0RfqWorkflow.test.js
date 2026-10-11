const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const domainQueries = require('../src/db/domainQueries');

describe('V0 RFQ Complete Workflow — Procucev Network Vendors', () => {
  let inviteEmailSpy;
  let mismatchEmailSpy;

  // mode_0 createRFQ auto-invites every category-matched Procucev vendor into
  // assignedVendors/followUpData.vendors. An invited vendor is now treated as
  // already unlocked (invitation-based unlock), so for the tests that exercise
  // the download-first / free-credit-consuming path we detach the vendor from
  // the auto-generated invite list so it goes through the locked/credit path.
  const clearAutoInvites = (rfq) => {
    rfq.assignedVendors = [];
    if (rfq.followUpData) {
      rfq.followUpData.vendors = [];
      rfq.followUpData.totalInvited = 0;
    }
    return rfq;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    inviteEmailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    mismatchEmailSpy = jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Buyer RFQ Creation & Automatic Matching (Mode 0)', () => {
    test('auto-matches network vendors with matching category and location and dispatches invite email', () => {
      const vendorA = storeService.addVendor({
        name: 'Alpha Pipes Ltd',
        email: 'alpha@pipes.com',
        majorCategory: 'Pipes & Fittings',
        location: 'Mumbai',
        pincode: '400001',
      });
      const vendorB = storeService.addVendor({
        name: 'Beta Motors Ltd',
        email: 'beta@motors.com',
        majorCategory: 'Heavy Machinery',
        location: 'Mumbai',
      });

      const rfq = storeService.createRFQ({
        title: 'Industrial PVC Pipes Procurement',
        category: 'Pipes & Fittings',
        sourcingMode: 'mode_0',
        deliveryLocation: 'Mumbai',
      });

      const assignedIds = (rfq.assignedVendors || []).map((v) => v.id);
      expect(assignedIds).toContain(vendorA.id);
      expect(assignedIds).not.toContain(vendorB.id);

      // Verify invite sent to matched vendor
      expect(inviteEmailSpy).toHaveBeenCalledWith(
        'alpha@pipes.com',
        expect.objectContaining({
          recipientName: expect.any(String),
          rfq: expect.objectContaining({ title: 'Industrial PVC Pipes Procurement' }),
        })
      );

      // Verify category mismatch email is NOT sent
      expect(mismatchEmailSpy).not.toHaveBeenCalled();

      // Verify audit log for exclusion
      const exclusionAudit = storeService.auditLogs.find(
        (log) => log.action && log.action.includes('excluded from automatic RFQ matching due to category mismatch')
      );
      expect(exclusionAudit).toBeDefined();
    });

    test('excludes private buyer-uploaded vendors from automatic V0 matching', () => {
      const privateVendor = storeService.addVendor({
        name: 'Private Seller',
        email: 'private@seller.com',
        majorCategory: 'Steel Works',
        buyerId: 'buyer-org-123', // Direct buyer private roster
      });

      const rfq = storeService.createRFQ({
        title: 'Steel Rebar Procurement',
        category: 'Steel Works',
        sourcingMode: 'mode_0',
      });

      const assignedIds = (rfq.assignedVendors || []).map((v) => v.id);
      expect(assignedIds).not.toContain(privateVendor.id);
    });
  });

  describe('2. Category Manager Manual Assignment and Override', () => {
    test('allows Category Manager manual override for mismatched vendor, sends invite and logs manual override', async () => {
      const specialVendor = storeService.addVendor({
        name: 'Specialist Works',
        email: 'specialist@works.com',
        majorCategory: 'Electronics',
      });

      const rfq = storeService.createRFQ({
        title: 'Plumbing Works',
        category: 'Plumbing & Sanitation',
        sourcingMode: 'mode_0',
      });

      const result = await storeService.inviteVendorsToRFQ(rfq.id, [specialVendor.id], 'cm@procucev.com');
      expect(result.invitedCount).toBe(1);
      expect(result.overrideCount).toBe(1);

      // Mismatch email MUST NOT be sent
      expect(mismatchEmailSpy).not.toHaveBeenCalled();

      // Normal invite email MUST be sent
      expect(inviteEmailSpy).toHaveBeenCalledWith('specialist@works.com', expect.any(Object));

      // Audit log must record Category Manager manual override
      const overrideLog = storeService.auditLogs.find(
        (log) => log.action && log.action.includes('Category Manager manual override')
      );
      expect(overrideLog).toBeDefined();
    });
  });

  describe('3. Vendor 5 Free RFQ Download Credits & Exhaustion', () => {
    test('initializes with 5 free credits and tracks atomic deductions', async () => {
      const vendor = storeService.addVendor({
        name: 'Credit Test Vendor',
        email: 'credits@test.com',
        majorCategory: 'General Supplies',
      });

      // 1. Check initial credits
      const initialCredits = storeService.getVendorRfqCredits(vendor.id);
      expect(initialCredits.freeCreditsRemaining).toBe(5);
      expect(initialCredits.freeCreditsAllocated).toBe(5);
      expect(initialCredits.freeCreditsUsed).toBe(0);

      // Create 5 test RFQs
      const rfq1 = clearAutoInvites(storeService.createRFQ({ id: 'rfq-credit-1', title: 'RFQ 1', category: 'General Supplies', sourcingMode: 'mode_0' }));
      const rfq2 = clearAutoInvites(storeService.createRFQ({ id: 'rfq-credit-2', title: 'RFQ 2', category: 'General Supplies', sourcingMode: 'mode_0' }));
      const rfq3 = clearAutoInvites(storeService.createRFQ({ id: 'rfq-credit-3', title: 'RFQ 3', category: 'General Supplies', sourcingMode: 'mode_0' }));
      const rfq4 = clearAutoInvites(storeService.createRFQ({ id: 'rfq-credit-4', title: 'RFQ 4', category: 'General Supplies', sourcingMode: 'mode_0' }));
      const rfq5 = clearAutoInvites(storeService.createRFQ({ id: 'rfq-credit-5', title: 'RFQ 5', category: 'General Supplies', sourcingMode: 'mode_0' }));
      const rfq6 = clearAutoInvites(storeService.createRFQ({ id: 'rfq-credit-6', title: 'RFQ 6', category: 'General Supplies', sourcingMode: 'mode_0' }));

      // Unlock RFQ 1: balance goes 5 -> 4
      const res1 = await storeService.unlockRFQForVendor(vendor.id, rfq1.id);
      expect(res1.success).toBe(true);
      expect(res1.freeCreditsRemaining).toBe(4);
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq1.id)).toBe(true);

      // Idempotency: downloading RFQ 1 again does NOT consume another credit
      const res1Repeat = await storeService.unlockRFQForVendor(vendor.id, rfq1.id);
      expect(res1Repeat.success).toBe(true);
      expect(res1Repeat.alreadyUnlocked).toBe(true);
      expect(res1Repeat.freeCreditsRemaining).toBe(4);

      // Unlock remaining 4 RFQs
      await storeService.unlockRFQForVendor(vendor.id, rfq2.id);
      await storeService.unlockRFQForVendor(vendor.id, rfq3.id);
      await storeService.unlockRFQForVendor(vendor.id, rfq4.id);
      const res5 = await storeService.unlockRFQForVendor(vendor.id, rfq5.id);
      expect(res5.success).toBe(true);
      expect(res5.freeCreditsRemaining).toBe(0);

      // 6th RFQ download attempt MUST be rejected
      const res6 = await storeService.unlockRFQForVendor(vendor.id, rfq6.id);
      expect(res6.success).toBe(false);
      expect(res6.creditsExhausted).toBe(true);
      expect(res6.error).toContain('You have used all 5 free RFQ download credits');

      // Previously unlocked RFQs remain unlocked
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq1.id)).toBe(true);
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq5.id)).toBe(true);
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq6.id)).toBe(false);
    });
  });

  describe('4. Mandatory RFQ Download Before Bid Submission', () => {
    test('enforces download before allowing bid submission', async () => {
      const vendor = storeService.addVendor({
        name: 'Bidder Vendor',
        email: 'bidder@vendor.com',
        majorCategory: 'Pumps & Valves',
      });

      const rfq = clearAutoInvites(storeService.createRFQ({
        title: 'Centrifugal Pumps Enquiry',
        category: 'Pumps & Valves',
        sourcingMode: 'mode_0',
      }));

      // Before unlocking, check returns false
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq.id)).toBe(false);

      // Unlock the RFQ
      const unlockRes = await storeService.unlockRFQForVendor(vendor.id, rfq.id);
      expect(unlockRes.success).toBe(true);
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq.id)).toBe(true);

      // Add quote
      const quote = {
        vendorId: vendor.id,
        vendorName: vendor.name,
        unitPrice: 25000,
        totalPrice: 50000,
      };
      const updatedRfq = storeService.addQuoteToRFQ(rfq.id, quote);
      expect(updatedRfq).toBeDefined();
      expect(updatedRfq.quotes).toHaveLength(1);
      expect(updatedRfq.quotes[0].vendorId).toBe(vendor.id);
    });
  });

  describe('5. HTTP API Endpoints & Controller Validation', () => {
    const request = require('supertest');
    const app = require('../src/app');
    const { authHeader } = require('./testHelpers');

    test('POST /api/rfqs/:id/download unlocks RFQ and deducts credit', async () => {
      const vendor = storeService.addVendor({
        name: 'API Downloader Vendor',
        email: 'vendor@apexsupplies.com',
        majorCategory: 'Fasteners & Bearings',
      });

      const rfq = storeService.createRFQ({
        title: 'Precision Bearings RFQ',
        category: 'Fasteners & Bearings',
        sourcingMode: 'mode_0',
      });

      // 1. Download without authentication returns 401
      const unauthRes = await request(app).post(`/api/rfqs/${rfq.id}/download`).send({});
      expect(unauthRes.statusCode).toBe(401);

      // 2. Download with non-existent RFQ returns 404
      const notFoundRes = await request(app)
        .post('/api/rfqs/non-existent-rfq-id/download')
        .set(authHeader('vendor'))
        .send({});
      expect(notFoundRes.statusCode).toBe(404);

      // 3. Download valid RFQ returns 200 and specification
      const downloadRes = await request(app)
        .post(`/api/rfqs/${rfq.id}/download`)
        .set(authHeader('vendor'))
        .send({ vendorId: vendor.id });
      expect(downloadRes.statusCode).toBe(200);
      expect(downloadRes.body.success).toBe(true);
      expect(downloadRes.body.unlocked).toBe(true);
      expect(downloadRes.body.data.htmlBody).toBeDefined();

      // 4. Re-downloading already unlocked returns 200 with alreadyUnlocked: true
      const repeatRes = await request(app)
        .post(`/api/rfqs/${rfq.id}/download`)
        .set(authHeader('vendor'))
        .send({ vendorId: vendor.id });
      expect(repeatRes.statusCode).toBe(200);
      expect(repeatRes.body.alreadyUnlocked).toBe(true);
    });

    test('POST /api/rfqs/:id/quotes enforces unlock in mode_0 before accepting quote', async () => {
      const vendor = storeService.addVendor({
        name: 'API Quoter Vendor',
        email: 'vendor@apexsupplies.com',
        majorCategory: 'Hydraulic Systems',
      });

      const rfq = clearAutoInvites(storeService.createRFQ({
        title: 'Hydraulic Cylinders Procurement',
        category: 'Hydraulic Systems',
        sourcingMode: 'mode_0',
      }));

      // 1. Quoting before downloading returns 403 Forbidden
      const lockedQuoteRes = await request(app)
        .post(`/api/rfqs/${rfq.id}/quotes`)
        .set(authHeader('vendor'))
        .send({
          vendorId: vendor.id,
          vendorName: vendor.name,
          unitPrice: 35000,
        });
      expect(lockedQuoteRes.statusCode).toBe(403);
      expect(lockedQuoteRes.body.error).toContain('Please download the RFQ before submitting your bid.');

      // 2. Unlock RFQ
      await storeService.unlockRFQForVendor(vendor.id, rfq.id);

      // 3. Quoting after downloading returns 200 OK
      const unlockedQuoteRes = await request(app)
        .post(`/api/rfqs/${rfq.id}/quotes`)
        .set(authHeader('vendor'))
        .send({
          vendorId: vendor.id,
          vendorName: vendor.name,
          unitPrice: 35000,
        });
      expect(unlockedQuoteRes.statusCode).toBe(200);
      expect(unlockedQuoteRes.body.success).toBe(true);
    });

    test('GET /api/vendors/rfq-credits returns server-authoritative credit balance', async () => {
      const vendor = storeService.addVendor({
        name: 'Credits Endpoint Vendor',
        email: 'vendor@apexsupplies.com',
      });

      const res = await request(app)
        .get(`/api/vendors/${vendor.id}/rfq-credits`)
        .set(authHeader('vendor'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.freeCreditsAllocated).toBe(5);
      expect(res.body.data.freeCreditsRemaining).toBe(5);
    });

    test('POST /api/rfqs/:id/invite-vendors performs Category Manager assignment & override', async () => {
      const vendor = storeService.addVendor({
        name: 'CM Invited Vendor',
        email: 'cminvited@procucev.com',
        majorCategory: 'Electronics',
      });

      const rfq = storeService.createRFQ({
        title: 'Mechanical Tools RFQ',
        category: 'Mechanical Tools',
        sourcingMode: 'mode_0',
      });

      const inviteRes = await request(app)
        .post(`/api/rfqs/${rfq.id}/invite-vendors`)
        .set(authHeader('category_manager'))
        .send({ vendorIds: [vendor.id] });
      expect(inviteRes.statusCode).toBe(200);
      expect(inviteRes.body.success).toBe(true);
      expect(inviteRes.body.invitedCount).toBe(1);
    });
  });
});
