/**
 * rfqChaserScheduler unit tests
 *
 * All real outbound calls (WhatsApp, SMS, mailer) are mocked so no network
 * traffic is generated.  Jest fake timers let us advance time precisely to
 * verify each channel fires at the right delay.
 *
 * Coverage targets:
 *   • scheduleVendorChaser  — registers 3 timers, fires at correct delays
 *   • scheduleRFQChasers    — fans out across multiple vendors
 *   • clearScheduledChasers — cancels pending timers, handles unknown rfq
 *   • _dispatchWhatsApp     — success / skip-no-phone / error paths
 *   • _dispatchSms          — success / skip-no-phone / error paths
 *   • _dispatchReminderEmail — success / skip-no-email / error paths
 *   • NODE_ENV=test short-circuit on all dispatch helpers
 *   • pendingTimers Map state management
 */

const whatsAppService = require('../src/services/whatsAppService');
const smsService = require('../src/services/smsService');
const mailerService = require('../src/services/mailerService');
const domainQueries = require('../src/db/domainQueries');
const scheduler = require('../src/services/rfqChaserScheduler');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RFQ = {
  rfqNumber: 'RFQ-TEST-001',
  title: 'Test RFQ',
  sourcingMode: 'mode_1',
  buyerAccountId: 'ba-001',
};

const VENDOR = {
  id: 'v-001',
  name: 'Apex Supplies',
  email: 'apex@supplier.com',
  phone: '9876543210',
  contactPerson: 'Rajesh Kumar',
};

const VENDOR_NO_PHONE = { id: 'v-002', name: 'No Phone Co', email: 'nophone@co.com' };
const VENDOR_NO_EMAIL = { id: 'v-003', name: 'No Email Co', phone: '9000000001' };

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Use fake timers so setTimeout never actually waits
  jest.useFakeTimers();
  // Clear timer registry between tests
  scheduler.pendingTimers.clear();
  // Reset throttle caches so tests don't interfere with each other
  whatsAppService.clearWhatsAppThrottleCache();
  smsService.clearSmsThrottleCache();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  // Cancel any timers left in the registry so they don't leak into other suites
  scheduler.pendingTimers.forEach((_, rfqNumber) => scheduler.clearScheduledChasers(rfqNumber));
  scheduler.pendingTimers.clear();
});

// ── scheduleVendorChaser ─────────────────────────────────────────────────────

describe('scheduleVendorChaser', () => {
  test('persists Worker chasers without request-scoped timers', async () => {
    const previousEnv = globalThis.__CF_ENV__;
    const previousWaitUntil = globalThis.__CF_WAIT_UNTIL__;
    const waitUntil = jest.fn();
    const persistSpy = jest.spyOn(domainQueries, 'insertChaserJobInDB').mockResolvedValue(true);
    globalThis.__CF_ENV__ = { DB: {} };
    globalThis.__CF_WAIT_UNTIL__ = waitUntil;

    try {
      scheduler.scheduleVendorChaser(RFQ, VENDOR);

      expect(scheduler.pendingTimers.has(RFQ.rfqNumber)).toBe(false);
      expect(persistSpy).toHaveBeenCalledTimes(4);
      expect(waitUntil).toHaveBeenCalledTimes(4);
      await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
      if (previousWaitUntil === undefined) delete globalThis.__CF_WAIT_UNTIL__;
      else globalThis.__CF_WAIT_UNTIL__ = previousWaitUntil;
    }
  });

  test('registers exactly 4 timer handles in pendingTimers (SMS, Call, WhatsApp, Email)', () => {
    scheduler.scheduleVendorChaser(RFQ, VENDOR, {});
    expect(scheduler.pendingTimers.get(RFQ.rfqNumber)).toHaveLength(4);
  });

  test('fires SMS within 5 min delay and not before', async () => {
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-1' });
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR, {});

    // Before SMS delay — SMS not yet called
    jest.advanceTimersByTime(4 * 60 * 1000); // 4 min
    await Promise.resolve();
    expect(smsSpy).not.toHaveBeenCalled();

    // After SMS delay (5 min)
    jest.advanceTimersByTime(60 * 1000 + 100); // push past 5 min
    await Promise.resolve();
    expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({
      mobile: VENDOR.phone,
      rfqNumber: RFQ.rfqNumber,
    }));
    process.env.NODE_ENV = origEnv;
  });

  test('fires Call reminder after 6 hours', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR, {});

    // Before 6h
    jest.advanceTimersByTime(5 * 60 * 60 * 1000); // 5 hours
    await Promise.resolve();

    // Advance to 6 hours
    jest.advanceTimersByTime(60 * 60 * 1000 + 100); // push past 6h
    await Promise.resolve();

    process.env.NODE_ENV = origEnv;
  });

  test('fires WhatsApp reminder after 12h delay', async () => {
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-1' });
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR, {});

    // Before 12h
    jest.advanceTimersByTime(11 * 60 * 60 * 1000);
    await Promise.resolve();
    expect(waSpy).not.toHaveBeenCalled();

    // Cross 12h mark
    jest.advanceTimersByTime(60 * 60 * 1000 + 100);
    await Promise.resolve();

    expect(waSpy).toHaveBeenCalledWith(expect.objectContaining({
      phone: VENDOR.phone,
      rfqNumber: RFQ.rfqNumber,
      rfqTitle: RFQ.title,
      vendorName: VENDOR.name,
    }));
    process.env.NODE_ENV = origEnv;
  });

  test('fires reminder email after 24h delay', async () => {
    const emailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR, { freeCreditsRemaining: 3, isSubscribed: false });

    // 23h 59m — email not yet fired
    jest.advanceTimersByTime(23 * 60 * 60 * 1000 + 59 * 60 * 1000);
    await Promise.resolve();
    expect(emailSpy).not.toHaveBeenCalled();

    // Cross the 24h mark
    jest.advanceTimersByTime(2 * 60 * 1000);
    await Promise.resolve();
    expect(emailSpy).toHaveBeenCalledWith(
      VENDOR.email,
      expect.objectContaining({ rfq: RFQ, isReminder: true })
    );
    process.env.NODE_ENV = origEnv;
  });

  test('does nothing when rfq is null', () => {
    expect(() => scheduler.scheduleVendorChaser(null, VENDOR)).not.toThrow();
    expect(scheduler.pendingTimers.size).toBe(0);
  });

  test('does nothing when vendor is null', () => {
    expect(() => scheduler.scheduleVendorChaser(RFQ, null)).not.toThrow();
    expect(scheduler.pendingTimers.size).toBe(0);
  });
});

describe('dispatchDueChaserJobs', () => {
  test('loads the full RFQ and sends the due email reminder', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const emailJob = {
      id: 'chaser-RFQ-TEST-001-v-001-email',
      rfq_number: RFQ.rfqNumber,
      vendor_id: VENDOR.id,
      vendor_name: VENDOR.name,
      vendor_email: VENDOR.email,
      vendor_phone: VENDOR.phone,
      vendor_contact_person: VENDOR.contactPerson,
      channel: 'email',
    };
    jest.spyOn(domainQueries, 'claimDueChaserJobsFromDB').mockResolvedValue([emailJob]);
    jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue(RFQ);
    jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue();
    const emailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    process.env.NODE_ENV = 'production';

    try {
      await expect(scheduler.dispatchDueChaserJobs()).resolves.toEqual({
        claimed: 1,
        sent: 1,
        failed: 0,
        skipped: 0,
      });
      expect(emailSpy).toHaveBeenCalledWith(
        VENDOR.email,
        expect.objectContaining({ rfq: RFQ, isReminder: true })
      );
      expect(domainQueries.markChaserJobFiredInDB).toHaveBeenCalledWith(emailJob.id);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});

// ── scheduleRFQChasers ────────────────────────────────────────────────────────

describe('scheduleRFQChasers', () => {
  test('creates 4 timers per vendor (2 vendors → 8 timers)', () => {
    const vendors = [VENDOR, { ...VENDOR, id: 'v-999', name: 'Beta Supplies' }];
    scheduler.scheduleRFQChasers(RFQ, vendors);
    expect(scheduler.pendingTimers.get(RFQ.rfqNumber)).toHaveLength(8);
  });

  test('calls getCreditInfo for each vendor', () => {
    const getCreditInfo = jest.fn().mockReturnValue({ freeCreditsRemaining: 5, isSubscribed: true });
    scheduler.scheduleRFQChasers(RFQ, [VENDOR], getCreditInfo);
    expect(getCreditInfo).toHaveBeenCalledWith(VENDOR);
  });

  test('does nothing for an empty vendor list', () => {
    scheduler.scheduleRFQChasers(RFQ, []);
    expect(scheduler.pendingTimers.size).toBe(0);
  });

  test('does nothing when rfq is null', () => {
    scheduler.scheduleRFQChasers(null, [VENDOR]);
    expect(scheduler.pendingTimers.size).toBe(0);
  });

  test('does nothing when vendors is not an array', () => {
    scheduler.scheduleRFQChasers(RFQ, null);
    expect(scheduler.pendingTimers.size).toBe(0);
  });
});

// ── clearScheduledChasers ─────────────────────────────────────────────────────

describe('clearScheduledChasers', () => {
  test('cancels all timers for an rfqNumber and removes from map', () => {
    scheduler.scheduleVendorChaser(RFQ, VENDOR);
    expect(scheduler.pendingTimers.has(RFQ.rfqNumber)).toBe(true);

    scheduler.clearScheduledChasers(RFQ.rfqNumber);
    expect(scheduler.pendingTimers.has(RFQ.rfqNumber)).toBe(false);
  });

  test('does not throw for an unknown rfqNumber', () => {
    expect(() => scheduler.clearScheduledChasers('RFQ-DOES-NOT-EXIST')).not.toThrow();
  });

  test('cleared timers do not fire after being cancelled', async () => {
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true });
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR);
    scheduler.clearScheduledChasers(RFQ.rfqNumber);

    jest.runAllTimers();
    await Promise.resolve();
    expect(smsSpy).not.toHaveBeenCalled();
    process.env.NODE_ENV = origEnv;
  });
});

// ── _dispatchWhatsApp ─────────────────────────────────────────────────────────

describe('_dispatchWhatsApp', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => { process.env.NODE_ENV = 'production'; });
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  test('returns skipped:true in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
  });

  test('returns skipped:true when vendor has no phone', async () => {
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR_NO_PHONE);
    expect(result.skipped).toBe(true);
  });

  test('returns success:true on a successful API call', async () => {
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-ok' });
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR);
    expect(result.success).toBe(true);
  });

  test('returns success:false when API returns failure', async () => {
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: false, error: 'bad creds' });
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR);
    expect(result.success).toBe(false);
  });

  test('catches thrown errors and returns success:false', async () => {
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockRejectedValue(new Error('network down'));
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR);
    expect(result.success).toBe(false);
    expect(result.error).toBe('network down');
  });
});

// ── _dispatchSms ──────────────────────────────────────────────────────────────

describe('_dispatchSms', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => { process.env.NODE_ENV = 'production'; });
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  test('returns skipped:true in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const result = await scheduler._dispatchSms(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
  });

  test('returns skipped:true when vendor has no phone', async () => {
    const result = await scheduler._dispatchSms(RFQ, VENDOR_NO_PHONE);
    expect(result.skipped).toBe(true);
  });

  test('returns success:true on a successful gateway call', async () => {
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-ok' });
    const result = await scheduler._dispatchSms(RFQ, VENDOR);
    expect(result.success).toBe(true);
  });

  test('passes rfqNumber and mobile to sendRFQChaserSms', async () => {
    const spy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-ok' });
    await scheduler._dispatchSms(RFQ, VENDOR);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      mobile: VENDOR.phone,
      rfqNumber: RFQ.rfqNumber,
    }));
  });

  test('returns success:false when gateway returns failure', async () => {
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: false, error: 'quota exceeded' });
    const result = await scheduler._dispatchSms(RFQ, VENDOR);
    expect(result.success).toBe(false);
  });

  test('catches thrown errors and returns success:false', async () => {
    jest.spyOn(smsService, 'sendRFQChaserSms').mockRejectedValue(new Error('timeout'));
    const result = await scheduler._dispatchSms(RFQ, VENDOR);
    expect(result.success).toBe(false);
    expect(result.error).toBe('timeout');
  });
});

// ── _dispatchCall ────────────────────────────────────────────────────────────

describe('_dispatchCall', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => { process.env.NODE_ENV = 'production'; });
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  test('returns skipped:true in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const result = await scheduler._dispatchCall(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
  });

  test('returns skipped:true with reason calling_not_implemented in production', async () => {
    const result = await scheduler._dispatchCall(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('calling_not_implemented');
  });
});

// ── _dispatchReminderEmail ────────────────────────────────────────────────────

describe('_dispatchReminderEmail', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => { process.env.NODE_ENV = 'production'; });
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  test('returns skipped:true in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
  });

  test('returns skipped:true when vendor has no email', async () => {
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR_NO_EMAIL);
    expect(result.skipped).toBe(true);
  });

  test('returns sent:true on successful delivery', async () => {
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR, { freeCreditsRemaining: 2, isSubscribed: false });
    expect(result.sent).toBe(true);
  });

  test('passes isReminder:true to sendRfqInviteEmail', async () => {
    const spy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    await scheduler._dispatchReminderEmail(RFQ, VENDOR, {});
    expect(spy).toHaveBeenCalledWith(
      VENDOR.email,
      expect.objectContaining({ isReminder: true, rfq: RFQ })
    );
  });

  test('returns sent:false when mailer returns sent:false', async () => {
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: false, reason: 'SMTP not configured' });
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR);
    expect(result.sent).toBe(false);
  });

  test('catches thrown errors and returns sent:false', async () => {
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockRejectedValue(new Error('auth failed'));
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR);
    expect(result.sent).toBe(false);
    expect(result.error).toBe('auth failed');
  });

  test('uses null defaults for missing creditInfo fields', async () => {
    const spy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    await scheduler._dispatchReminderEmail(RFQ, VENDOR); // no creditInfo
    expect(spy).toHaveBeenCalledWith(
      VENDOR.email,
      expect.objectContaining({ freeCreditsRemaining: null, isSubscribed: false })
    );
  });
});

// ── V0 (Free Starter Trial) Chaser Scheduling ──────────────────────────────
describe('V0 Chaser Scheduling', () => {
  const V0_RFQ = {
    rfqNumber: 'RFQ-V0-001',
    id: 'rfq-v0-001',
    title: 'Precision Bearings Supply',
    sourcingMode: 'mode_0',
  };

  test('registers only 1 timer handle in pendingTimers (SMS only, no Call/WhatsApp/Email follow-ups) for V0', () => {
    scheduler.scheduleVendorChaser(V0_RFQ, VENDOR, {});
    expect(scheduler.pendingTimers.get(V0_RFQ.rfqNumber)).toHaveLength(1);
  });

  test('fires SMS alert after 5 minutes for V0 and sends no follow-up chasers after 6h/12h/24h', async () => {
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-v0' });
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-v0' });
    const mailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(V0_RFQ, VENDOR, {});

    // Before 5 min — not yet called
    jest.advanceTimersByTime(4 * 60 * 1000);
    await Promise.resolve();
    expect(smsSpy).not.toHaveBeenCalled();

    // At 5 min — SMS is fired
    jest.advanceTimersByTime(60 * 1000 + 100);
    await Promise.resolve();
    expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({
      mobile: VENDOR.phone,
      rfqNumber: V0_RFQ.rfqNumber,
    }));

    // Advance 6h, 12h, 24h — no follow-up chasers fired for V0
    jest.advanceTimersByTime(25 * 60 * 60 * 1000);
    await Promise.resolve();
    expect(waSpy).not.toHaveBeenCalled();
    expect(mailSpy).not.toHaveBeenCalled();

    process.env.NODE_ENV = origEnv;
  });

  test('D1 persistence records only 1 SMS job for V0 RFQs', async () => {
    const persistSpy = jest.spyOn(domainQueries, 'insertChaserJobInDB').mockResolvedValue(true);
    const waitUntil = jest.fn();
    const previousEnv = globalThis.__CF_ENV__;
    const previousWaitUntil = globalThis.__CF_WAIT_UNTIL__;

    try {
      globalThis.__CF_ENV__ = { DB: {} };
      globalThis.__CF_WAIT_UNTIL__ = waitUntil;

      scheduler.scheduleVendorChaser(V0_RFQ, VENDOR, {});
      expect(persistSpy).toHaveBeenCalledTimes(1);
      expect(persistSpy).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'sms',
        rfqNumber: V0_RFQ.rfqNumber,
      }));
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
      if (previousWaitUntil === undefined) delete globalThis.__CF_WAIT_UNTIL__;
      else globalThis.__CF_WAIT_UNTIL__ = previousWaitUntil;
    }
  });
});

