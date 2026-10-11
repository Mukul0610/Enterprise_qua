const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const smsService = require('../src/services/smsService');

// Covers the auto-closure / invitation-based-unlock behaviour added to
// storeService: addQuoteToRFQ auto-closes an RFQ once 100% of invited vendors
// have quoted, cancelDelayedQuoteTimers clears pending delayed-quote timers,
// and isVendorMappedToRfqBuyer / isRfqUnlockedForVendor treat an invited vendor
// (assignedVendors or followUpData.vendors) as mapped/unlocked.
describe('storeService auto-closure, delayed-timer cancellation and invitation-based unlock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeService.reset();
    storeService.vendors = [];
    storeService.rfqs = [];
    storeService.notifications = [];
    smsService.clearSmsThrottleCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function seedBuyerAndRfq({ withPhone = true } = {}) {
    const buyer = storeService.addBuyerAccount({
      organizationName: 'Closure Buyer Corp',
      corporateEmail: 'closure.buyer@corp.com',
      // The 5-minute comparison SMS resolves the buyer's `phone` field.
      phone: withPhone ? '9876500011' : undefined,
    });
    const vendorA = { id: 'cv-a', name: 'Vendor A', email: 'vendor.a@suppliers.com' };
    const vendorB = { id: 'cv-b', name: 'Vendor B', email: 'vendor.b@suppliers.com' };
    const rfq = storeService.createRFQ(
      {
        title: 'Dual Vendor Pump RFQ',
        category: 'Pumps',
        assignedVendors: [vendorA, vendorB],
      },
      buyer,
    );
    return { buyer, vendorA, vendorB, rfq };
  }

  test('does not auto-close until every invited vendor has submitted a quote', () => {
    const { vendorA, rfq } = seedBuyerAndRfq();
    jest.spyOn(mailerService, 'sendRfqAutoClosureAcknowledgementEmail').mockResolvedValue({ sent: true });

    const afterFirst = storeService.addQuoteToRFQ(rfq.id, {
      vendorId: vendorA.id,
      vendorName: vendorA.name,
      vendorEmail: vendorA.email,
      unitPrice: 1000,
      totalPrice: 2000,
    });

    expect(afterFirst.status).not.toBe('Closed');
    expect(afterFirst.autoClosedReason).toBeUndefined();
    expect(mailerService.sendRfqAutoClosureAcknowledgementEmail).not.toHaveBeenCalled();
  });

  test('auto-closes, notifies the buyer, and schedules the 5-minute comparison email + SMS', () => {
    jest.useFakeTimers();
    const { buyer, vendorA, vendorB, rfq } = seedBuyerAndRfq({ withPhone: true });

    const ackSpy = jest.spyOn(mailerService, 'sendRfqAutoClosureAcknowledgementEmail').mockResolvedValue({ sent: true });
    const comparisonEmailSpy = jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValue({ sent: true });
    const smsSpy = jest.spyOn(smsService, 'sendBuyerComparisonSms').mockResolvedValue({ success: true });

    storeService.addQuoteToRFQ(rfq.id, {
      vendorId: vendorA.id,
      vendorName: vendorA.name,
      vendorEmail: vendorA.email,
      unitPrice: 1000,
      totalPrice: 2000,
    });

    const closed = storeService.addQuoteToRFQ(rfq.id, {
      vendorId: vendorB.id,
      vendorName: vendorB.name,
      vendorEmail: vendorB.email,
      unitPrice: 900,
      totalPrice: 1800,
    });

    expect(closed.status).toBe('Closed');
    expect(closed.autoClosedReason).toBe('All invited vendors submitted quotes');
    expect(closed.closedAt).toBeDefined();

    // In-app notification was unshifted for the buyer.
    const notif = storeService.notifications.find((n) => n.kind === 'rfq_auto_closed');
    expect(notif).toBeDefined();
    expect(notif.recipientId).toBe(buyer.id);

    // Immediate acknowledgement email to the buyer.
    expect(ackSpy).toHaveBeenCalledWith(
      buyer.corporateEmail,
      expect.objectContaining({ rfq: expect.objectContaining({ rfqNumber: rfq.rfqNumber }), quotesCount: 2 }),
    );

    // The 5-minute comparison dispatch fires after the delay (email + SMS).
    const emailCallsBefore = comparisonEmailSpy.mock.calls.length;
    jest.advanceTimersByTime(5 * 60 * 1000 + 100);
    expect(comparisonEmailSpy.mock.calls.length).toBeGreaterThan(emailCallsBefore);
    expect(smsSpy).toHaveBeenCalledWith('9876500011', expect.objectContaining({ rfqNumber: rfq.rfqNumber, quotesCount: 2 }));
  });

  test('skips the comparison SMS when the buyer has no phone number', () => {
    jest.useFakeTimers();
    const { vendorA, vendorB, rfq } = seedBuyerAndRfq({ withPhone: false });

    jest.spyOn(mailerService, 'sendRfqAutoClosureAcknowledgementEmail').mockResolvedValue({ sent: true });
    jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValue({ sent: true });
    const smsSpy = jest.spyOn(smsService, 'sendBuyerComparisonSms').mockResolvedValue({ success: true });

    storeService.addQuoteToRFQ(rfq.id, { vendorId: vendorA.id, vendorName: vendorA.name, vendorEmail: vendorA.email, unitPrice: 1, totalPrice: 1 });
    storeService.addQuoteToRFQ(rfq.id, { vendorId: vendorB.id, vendorName: vendorB.name, vendorEmail: vendorB.email, unitPrice: 1, totalPrice: 1 });

    jest.advanceTimersByTime(5 * 60 * 1000 + 100);
    expect(smsSpy).not.toHaveBeenCalled();
  });

  test('cancelDelayedQuoteTimers clears and removes any pending timers for an RFQ', () => {
    const cleared = jest.fn();
    jest.spyOn(global, 'clearTimeout').mockImplementation((h) => cleared(h));

    storeService._delayedQuoteTimers = new Map();
    const handleA = setTimeout(() => {}, 100000);
    const handleB = setTimeout(() => {}, 100000);
    if (handleA.unref) handleA.unref();
    if (handleB.unref) handleB.unref();
    storeService._delayedQuoteTimers.set('rfq-timers', [handleA, handleB]);

    storeService.cancelDelayedQuoteTimers('rfq-timers');

    expect(cleared).toHaveBeenCalledTimes(2);
    expect(storeService._delayedQuoteTimers.has('rfq-timers')).toBe(false);

    // No-ops: missing id, or no timer map / unknown id.
    expect(() => storeService.cancelDelayedQuoteTimers(null)).not.toThrow();
    expect(() => storeService.cancelDelayedQuoteTimers('unknown-rfq')).not.toThrow();

    delete storeService._delayedQuoteTimers;
  });

  describe('invitation-based unlock in isVendorMappedToRfqBuyer / isRfqUnlockedForVendor', () => {
    function invitationRfq(assigned, followUpVendors) {
      return {
        id: 'rfq-invite',
        rfqNumber: 'RFQ-INVITE-1',
        buyerAccountId: 'other-buyer',
        buyerAccountName: 'Other Buyer Co',
        assignedVendors: assigned || [],
        followUpData: followUpVendors ? { vendors: followUpVendors } : undefined,
      };
    }

    test('matches an assigned vendor by id', () => {
      const vendor = { id: 'ven-1', name: 'Ven One', email: 'one@v.com' };
      const rfq = invitationRfq([{ id: 'ven-1' }]);
      expect(storeService.isVendorMappedToRfqBuyer(vendor, rfq)).toBe(true);
    });

    test('matches an assigned vendor by email', () => {
      const vendor = { id: 'ven-2', name: 'Ven Two', email: 'two@v.com' };
      const rfq = invitationRfq([{ email: 'TWO@v.com' }]);
      expect(storeService.isVendorMappedToRfqBuyer(vendor, rfq)).toBe(true);
    });

    test('matches an assigned vendor by name', () => {
      const vendor = { id: 'ven-3', name: 'Ven Three', email: 'three@v.com' };
      const rfq = invitationRfq([{ name: 'ven three' }]);
      expect(storeService.isVendorMappedToRfqBuyer(vendor, rfq)).toBe(true);
    });

    test('matches a followUpData vendor by vendorId, email or vendorName', () => {
      const byId = { id: 'ven-4', name: 'Ven Four', email: 'four@v.com' };
      expect(storeService.isVendorMappedToRfqBuyer(byId, invitationRfq([], [{ vendorId: 'ven-4' }]))).toBe(true);

      const byEmail = { id: 'ven-5', name: 'Ven Five', email: 'five@v.com' };
      expect(storeService.isVendorMappedToRfqBuyer(byEmail, invitationRfq([], [{ email: 'FIVE@v.com' }]))).toBe(true);

      const byName = { id: 'ven-6', name: 'Ven Six', email: 'six@v.com' };
      expect(storeService.isVendorMappedToRfqBuyer(byName, invitationRfq([], [{ vendorName: 'ven six' }]))).toBe(true);
    });

    test('returns false when the vendor is neither assigned nor invited', () => {
      const vendor = { id: 'ven-x', name: 'Ven X', email: 'x@v.com' };
      const rfq = invitationRfq([{ id: 'someone-else' }], [{ vendorId: 'another' }]);
      expect(storeService.isVendorMappedToRfqBuyer(vendor, rfq)).toBe(false);
    });

    test('isRfqUnlockedForVendor returns true for an invited vendor without an explicit download', () => {
      const vendor = storeService.addVendor({ id: 'ven-inv', name: 'Invited Vendor', email: 'invited@v.com', majorCategory: 'Pumps' });
      const rfq = storeService.createRFQ({
        title: 'Invite Unlock RFQ',
        category: 'Pumps',
        buyerAccountId: 'other-buyer',
        assignedVendors: [{ id: vendor.id, name: vendor.name, email: vendor.email }],
      });
      // Not mode_0 category auto-invite; the explicit invitation grants unlock.
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq.id)).toBe(true);
    });
  });
});
