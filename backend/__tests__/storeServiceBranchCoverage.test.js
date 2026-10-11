const storeService = require('../src/services/storeService');

// Broad branch-coverage pass over storeService's in-memory domain methods and
// their edge branches (empty inputs, scoping, found/not-found, fallbacks).
// All DB-backed paths run in no-storage (in-memory) mode as the suite setup
// blanks DATABASE_URL, so nothing touches a live service.
describe('storeService branch coverage — buyer accounts, vendors, RFQs, notifications', () => {
  beforeEach(() => {
    storeService.reset();
    storeService.vendors = [];
    storeService.rfqs = [];
    storeService.notifications = [];
    storeService.paymentLinks = [];
    storeService.evaluations = [];
    storeService.catalogueProducts = [];
    storeService.auditLogs = [];
    storeService.aiFeed = [];
  });

  describe('buyer account free-RFQ accounting', () => {
    test('tryConsumeFreeRFQ handles unknown id, default allowance, decrement, and exhaustion', () => {
      expect(storeService.tryConsumeFreeRFQ('nope')).toEqual({ ok: false, remaining: 0 });

      const buyer = storeService.addBuyerAccount({ organizationName: 'FreeRFQ Co', corporateEmail: 'free@rfq.com' });
      // Default allowance (remainingFreeRFQs undefined => treated as 5).
      const first = storeService.tryConsumeFreeRFQ(buyer.id);
      expect(first.ok).toBe(true);
      expect(first.remaining).toBe(4);

      // Exhaust to zero then confirm it blocks.
      storeService.updateBuyerAccount(buyer.id, { remainingFreeRFQs: 0 });
      expect(storeService.tryConsumeFreeRFQ(buyer.id)).toEqual({ ok: false, remaining: 0 });
    });

    test('tryConsumeFreeRFQ keeps the active buyer account in sync', () => {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Active Co', corporateEmail: 'active@rfq.com', remainingFreeRFQs: 3 });
      storeService.alignActiveBuyerAccount(buyer.id);
      storeService.tryConsumeFreeRFQ(buyer.id);
      expect(storeService.getActiveBuyerAccount().remainingFreeRFQs).toBe(2);
    });

    test('refundFreeRFQ is a no-op for unknown id and caps the refund at 5', () => {
      expect(() => storeService.refundFreeRFQ('missing')).not.toThrow();

      const buyer = storeService.addBuyerAccount({ organizationName: 'Refund Co', corporateEmail: 'refund@rfq.com', remainingFreeRFQs: 5 });
      storeService.alignActiveBuyerAccount(buyer.id);
      storeService.refundFreeRFQ(buyer.id); // already at cap => stays 5
      expect(storeService.getBuyerAccounts().find((b) => b.id === buyer.id).remainingFreeRFQs).toBe(5);

      storeService.updateBuyerAccount(buyer.id, { remainingFreeRFQs: 1 });
      storeService.refundFreeRFQ(buyer.id);
      expect(storeService.getActiveBuyerAccount().remainingFreeRFQs).toBe(2);
    });

    test('alignActiveBuyerAccount returns null for unknown id', () => {
      expect(storeService.alignActiveBuyerAccount('unknown')).toBeNull();
    });
  });

  describe('vendor scoping and lookup', () => {
    test('getVendorById honours buyer scoping and the public/all fallbacks', () => {
      const networkVendor = storeService.addVendor({ name: 'Network V', email: 'net@v.com', majorCategory: 'Pumps' });
      const buyerVendor = storeService.addVendor({ name: 'Buyer V', email: 'buyer@v.com', majorCategory: 'Pumps', buyerId: 'buyer-1' });

      // Unknown id.
      expect(storeService.getVendorById('does-not-exist')).toBeUndefined();
      // Public network vendor visible with no scope.
      expect(storeService.getVendorById(networkVendor.id)).toBeDefined();
      // 'all' scope returns a buyer-owned vendor.
      expect(storeService.getVendorById(buyerVendor.id, 'all')).toBeDefined();
      // No scope hides a buyer-owned vendor.
      expect(storeService.getVendorById(buyerVendor.id)).toBeUndefined();
      // Matching scope reveals it; non-matching hides it.
      expect(storeService.getVendorById(buyerVendor.id, 'buyer-1')).toBeDefined();
      expect(storeService.getVendorById(buyerVendor.id, 'other-buyer')).toBeUndefined();
    });

    test('updateVendor and deleteVendor handle unknown ids', () => {
      expect(storeService.updateVendor('ghost', { name: 'X' })).toBeNull();
      expect(storeService.deleteVendor('ghost')).toBe(false);
    });

    test('addVendor derives source from buyer linkage', () => {
      const net = storeService.addVendor({ name: 'Net', email: 'n2@v.com' });
      expect(net.source).toBe('procucev_network');
      const buyerOwned = storeService.addVendor({ name: 'Owned', email: 'o2@v.com' }, null, 'buyer-9');
      expect(buyerOwned.source).toBe('buyer_manual');
      expect(buyerOwned.buyerId).toBe('buyer-9');
    });
  });

  describe('getVendors in-memory scoping (no DB storage configured)', () => {
    test('returns all with the "all" scope and filters by buyer linkage otherwise', async () => {
      storeService.addVendor({ name: 'Pub', email: 'pub@v.com' });
      storeService.addVendor({ name: 'Owned', email: 'owned@v.com' }, null, 'buyer-7');

      const all = await storeService.getVendors('all');
      expect(all.length).toBe(2);

      // No scope => only public vendors.
      const publicOnly = await storeService.getVendors();
      expect(publicOnly.every((v) => !v.buyerId && !v.buyerAccountId)).toBe(true);

      // Scoped to buyer-7 => public + that buyer's vendor.
      const scoped = await storeService.getVendors('buyer-7');
      expect(scoped.some((v) => v.name === 'Owned')).toBe(true);
    });
  });

  describe('payment links and subscription activation', () => {
    test('updatePaymentLinkRecord returns null for an unknown id', () => {
      expect(storeService.updatePaymentLinkRecord('missing', { status: 'paid' })).toBeNull();
    });

    test('activate*FromPayment returns null for unknown or already-activated links', () => {
      expect(storeService.activateVendorSubscriptionFromPayment('nope')).toBeNull();
      expect(storeService.activateBuyerSubscriptionFromPayment('nope')).toBeNull();

      const vendor = storeService.addVendor({ name: 'Sub Vendor', email: 'sub@v.com' });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-1',
        zohoPaymentLinkId: 'z-1',
        payerType: 'vendor',
        vendorId: vendor.id,
        plan: 'connect',
        amount: 999,
      });
      const activated = storeService.activateVendorSubscriptionFromPayment(link.id);
      expect(activated).not.toBeNull();
      // Second activation is a no-op (already activated).
      expect(storeService.activateVendorSubscriptionFromPayment(link.id)).toBeNull();
    });
  });

  describe('reviseVendorRating', () => {
    test('returns null for an unknown vendor and updates an existing one', () => {
      expect(storeService.reviseVendorRating('ghost', { newRating: 4 })).toBeNull();

      const vendor = storeService.addVendor({ name: 'Rated', email: 'rated@v.com' });
      const revised = storeService.reviseVendorRating(vendor.id, {
        newRating: 4.2,
        qualityScore: 80,
        costScore: 70,
        deliveryScore: 90,
        remarks: 'Solid',
        buyerCompany: 'Buyer Co',
      });
      expect(revised).not.toBeNull();
    });
  });

  describe('RFQ inquiries', () => {
    function makeRfq() {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Inq Buyer', corporateEmail: 'inq@buyer.com' });
      return storeService.createRFQ({ title: 'Inquiry RFQ', category: 'Pumps' }, buyer);
    }

    test('addInquiryToRFQ returns null for an unknown RFQ', () => {
      expect(storeService.addInquiryToRFQ('ghost', { message: 'hi' })).toBeNull();
    });

    // NOTE: addInquiryToRFQ / replyToRFQInquiry currently call this.addFeedItem,
    // which does not exist on StoreService (the real method is addAIFeedItem),
    // so both throw after building the inquiry thread. These tests pin the
    // CURRENT behaviour (the thread-building branches run, then the call throws)
    // until the underlying bug is addressed — see the flag raised to the parent.
    test('addInquiryToRFQ builds a new thread then throws on the missing addFeedItem helper', () => {
      const rfq = makeRfq();
      expect(() =>
        storeService.addInquiryToRFQ(rfq.id, {
          message: 'Is stainless steel acceptable?',
          vendorName: 'Vendor Q',
          vendorEmail: 'q@v.com',
          vendorId: 'vq-1',
        }),
      ).toThrow(/addFeedItem is not a function/);
      // The thread was recorded on the RFQ before the throw.
      const stored = storeService.getRFQById(rfq.id);
      expect(Array.isArray(stored.inquiries)).toBe(true);
      expect(stored.inquiries).toHaveLength(1);

      // A second message takes the existing-thread branch, then throws again.
      expect(() =>
        storeService.addInquiryToRFQ(rfq.id, {
          message: 'Following up on my earlier question.',
          vendorName: 'Vendor Q',
          vendorEmail: 'q@v.com',
          vendorId: 'vq-1',
        }),
      ).toThrow(/addFeedItem is not a function/);
    });

    test('replyToRFQInquiry returns null for unknown RFQ or inquiry, then throws on the missing helper', () => {
      expect(storeService.replyToRFQInquiry('ghost', 'inq-x', { reply: 'hi' })).toBeNull();

      const rfq = makeRfq();
      // Seed an inquiry directly on the RFQ (bypassing the throwing addInquiryToRFQ).
      const inq = {
        id: 'inq-seed-1',
        rfqNumber: rfq.rfqNumber,
        rfqId: rfq.id,
        vendorName: 'Vendor R',
        vendorEmail: 'r@v.com',
        message: 'Question?',
        createdAt: new Date().toISOString(),
        status: 'open',
      };
      storeService.updateRFQ(rfq.id, { inquiries: [inq] });

      expect(storeService.replyToRFQInquiry(rfq.id, 'wrong-id', { reply: 'x' })).toBeNull();
      // The reply branch builds the thread (including the legacy prevMsgs path), then throws.
      expect(() =>
        storeService.replyToRFQInquiry(rfq.id, inq.id, { reply: 'Yes, that is fine.', repliedBy: 'Buyer Officer' }),
      ).toThrow(/addFeedItem is not a function/);
    });
  });

  describe('notifications', () => {
    test('getNotificationsFor and unread count handle missing recipient and filter correctly', () => {
      expect(storeService.getNotificationsFor('buyer', null)).toEqual([]);

      const n = storeService._buildNotification({
        recipientType: 'buyer',
        recipientId: 'buyer-n1',
        kind: 'test',
        rfq: { id: 'r1', rfqNumber: 'RFQ-N1', title: 'T' },
        title: 'Title',
        message: 'Msg',
        meta: {},
      });
      storeService.notifications.unshift(n);

      expect(storeService.getNotificationsFor('buyer', 'buyer-n1')).toHaveLength(1);
      expect(storeService.getUnreadNotificationCountFor('buyer', 'buyer-n1')).toBe(1);
    });
  });

  describe('RFQ lifecycle helpers', () => {
    test('getRFQById / updateRFQ / deleteRFQ handle unknown ids', () => {
      expect(storeService.getRFQById('ghost')).toBeUndefined();
      expect(storeService.updateRFQ('ghost', { status: 'Closed' })).toBeNull();
      expect(storeService.deleteRFQ('ghost')).toBe(false);
    });

    test('deleteRFQ removes an existing RFQ', () => {
      const rfq = storeService.createRFQ({ title: 'Doomed', category: 'Pumps' });
      expect(storeService.deleteRFQ(rfq.id)).toBe(true);
      expect(storeService.getRFQById(rfq.id)).toBeUndefined();
    });
  });
});
