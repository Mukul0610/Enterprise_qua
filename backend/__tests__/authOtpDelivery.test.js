const authService = require('../src/services/authService');
const authSessionQueries = require('../src/db/authSessionQueries');
const dbPool = require('../src/db/pool');
const identityQueries = require('../src/db/identityQueries');
const mailerService = require('../src/services/mailerService');
const smsService = require('../src/services/smsService');
const storeService = require('../src/services/storeService');
const { AUTH_MESSAGES } = require('../src/config/constants');

// ==============================================================================
// OTP DELIVERY CONFIRMATION
// ==============================================================================
// requestOtp used to fire the email and SMS and immediately report "sent". When
// every outbound mailbox was rate-limited or revoked, visitors were told a code
// was on its way that never arrived. These tests pin the new contract: delivery
// is awaited and a failure is reported, per channel, to the caller.
// ==============================================================================

const EMAIL = 'otp.user@example.com';
const MOBILE = '9876543210';
const { OTP_DELIVERY_STATUS } = authService;

function activeBuyer() {
  return {
    id: 'user-otp-1',
    email: EMAIL,
    name: 'OTP User',
    role: 'buyer',
    rawRoleName: 'ClientInitiator',
    orgId: 'org-1',
    orgName: 'Org',
    password: 'Pass@123',
    mobile: `+91${MOBILE}`,
    status: 'ACTIVE',
    isActive: true,
    isApproved: true,
    isSelfClient: false,
    resetPasswordRequired: false,
  };
}

describe('authService OTP delivery confirmation', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
    jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(activeBuyer());
    jest.spyOn(authSessionQueries, 'saveOtp').mockResolvedValue(true);
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
    delete globalThis.__CF_WAIT_UNTIL__;
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    delete globalThis.__CF_WAIT_UNTIL__;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('dispatchOtpCodes', () => {
    const args = { email: EMAIL, emailCode: '111111', mobile: MOBILE, mobileCode: '222222', isRegistration: false };

    test('reports both channels sent when the mailer and SMS gateway accept', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true, messageId: 'm1' });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      await expect(authService.dispatchOtpCodes(args)).resolves.toEqual({
        email: OTP_DELIVERY_STATUS.SENT,
        sms: OTP_DELIVERY_STATUS.SENT,
      });
    });

    test('treats an unconfigured mailer as not attempted, not failed', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: false, reason: 'SMTP not configured' });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const delivery = await authService.dispatchOtpCodes(args);
      expect(delivery.email).toBe(OTP_DELIVERY_STATUS.NOT_ATTEMPTED);
    });

    test('reports a thrown mail error and an unsuccessful or thrown SMS as failed', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('User-rate limit exceeded'));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: false, error: 'gateway down' });
      expect(await authService.dispatchOtpCodes(args)).toEqual({
        email: OTP_DELIVERY_STATUS.FAILED,
        sms: OTP_DELIVERY_STATUS.FAILED,
      });

      smsService.sendOtpSms.mockRejectedValue(new Error('socket hang up'));
      mailerService.sendOtpEmail.mockResolvedValue(undefined);
      expect(await authService.dispatchOtpCodes(args)).toEqual({
        email: OTP_DELIVERY_STATUS.NOT_ATTEMPTED,
        sms: OTP_DELIVERY_STATUS.FAILED,
      });

      smsService.sendOtpSms.mockResolvedValue(undefined);
      expect((await authService.dispatchOtpCodes(args)).sms).toBe(OTP_DELIVERY_STATUS.FAILED);
    });

    test('hands both sends to waitUntil on Workers so they survive the response', async () => {
      const waitUntil = jest.fn();
      globalThis.__CF_WAIT_UNTIL__ = waitUntil;
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      await authService.dispatchOtpCodes(args);
      expect(waitUntil).toHaveBeenCalledTimes(2);
    });

    test('reports a send still running at the wait bound as pending', async () => {
      jest.useFakeTimers();
      jest.spyOn(mailerService, 'sendOtpEmail').mockReturnValue(new Promise(() => {}));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const pending = authService.dispatchOtpCodes(args);
      await jest.advanceTimersByTimeAsync(20 * 1000 + 1);
      await expect(pending).resolves.toEqual({ email: OTP_DELIVERY_STATUS.PENDING, sms: OTP_DELIVERY_STATUS.SENT });
    });
  });

  describe('requestOtp (sign-in)', () => {
    test('succeeds and says so when both channels deliver', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      expect(res.success).toBe(true);
      expect(res.delivery).toEqual({ email: 'sent', sms: 'sent' });
      expect(res.message).toBe(`Verification OTP dispatched to ${EMAIL} and mobile`);
    });

    test('still succeeds on SMS alone when the email fails, and tells the visitor where the code went', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('invalid_grant'));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      expect(res.success).toBe(true);
      expect(res.message).toContain('sent to your mobile');
      expect(res.message).toContain('email could not be delivered');
    });

    test('still succeeds on email alone when the SMS fails', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: false, error: 'DLT rejected' });
      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      expect(res.message).toBe(`Verification OTP sent to ${EMAIL}. The SMS could not be delivered right now.`);
    });

    test('fails with a clear message when neither channel delivers', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('User-rate limit exceeded'));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: false });
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1')).rejects.toThrow(AUTH_MESSAGES.OTP_DELIVERY_FAILED);
    });
  });

  describe('requestOtp storage and lookup failures', () => {
    test('a failed account lookup does not block a registration OTP', async () => {
      identityQueries.findUserByEmailAndPhone.mockRejectedValue(new Error('D1 hiccup'));
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1', true)).resolves.toEqual(
        expect.objectContaining({ success: true })
      );
    });

    test('a code that could not be stored is never sent', async () => {
      authSessionQueries.saveOtp.mockRejectedValue(new Error('write failed'));
      const send = jest.spyOn(mailerService, 'sendOtpEmail');
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1')).rejects.toThrow(AUTH_MESSAGES.OTP_STORAGE_FAILED);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('requestOtp (registration)', () => {
    test('requires the email to go out, since registration verifies the email code', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('invalid_grant'));
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1', true)).rejects.toThrow(
        AUTH_MESSAGES.OTP_EMAIL_DELIVERY_FAILED
      );
    });

    test('requires the SMS to go out, since registration verifies the mobile code', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: false });
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1', true)).rejects.toThrow(
        AUTH_MESSAGES.OTP_SMS_DELIVERY_FAILED
      );
    });

    test('succeeds when both registration codes are delivered', async () => {
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendOtpSms').mockResolvedValue({ success: true });
      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1', true);
      expect(res.success).toBe(true);
      expect(res.message).toContain('Email OTP sent to');
    });
  });
});

describe('authService registration OTP verification and startup', () => {
  let originalPool;
  const payload = { name: 'New User', email: EMAIL, password: 'Pass@1234', mobile: MOBILE, orgName: 'Org' };
  const future = () => Date.now() + 60 * 1000;
  const past = () => Date.now() - 1000;

  function storedCodes({ email, mobile, single } = {}) {
    jest.spyOn(authSessionQueries, 'findOtp').mockImplementation(async (key) => {
      if (/^\+\d+_email/.test(key)) return email || null;
      if (/^\+\d+_mobile/.test(key)) return mobile || null;
      return single || null;
    });
  }

  beforeEach(() => {
    originalPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
    jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue(true);
    jest.spyOn(authSessionQueries, 'incrementOtpAttempts').mockResolvedValue(true);
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
    jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
      created: true,
      user: { id: 'u1', email: EMAIL, name: 'New User', role: 'buyer', orgId: 'o1', orgName: 'Org' },
    });
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('both registration codes are required and checked independently', async () => {
    storedCodes({ email: { code: '111111', expiresAt: future() }, mobile: { code: '222222', expiresAt: future() } });
    await expect(authService.registerUser(payload, '::1')).rejects.toThrow('Please enter the 6-digit Email OTP');
    await expect(authService.registerUser({ ...payload, emailOtp: '999999' }, '::1')).rejects.toThrow('Invalid Email OTP');
    expect(authSessionQueries.incrementOtpAttempts).toHaveBeenCalledWith(expect.stringMatching(/^\+\d+_email/));
    await expect(authService.registerUser({ ...payload, emailOtp: '111111' }, '::1')).rejects.toThrow(
      'Please enter the 6-digit Mobile SMS OTP'
    );
    await expect(authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '12345' }, '::1')).rejects.toThrow(
      'Invalid Mobile SMS OTP'
    );
    const ok = await authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '222222' }, '::1');
    expect(ok.success).toBe(true);
    expect(authSessionQueries.deleteOtp).toHaveBeenCalledTimes(3);
  });

  test('expired registration codes are deleted and rejected', async () => {
    storedCodes({ email: { code: '111111', expiresAt: past() }, mobile: { code: '222222', expiresAt: future() } });
    await expect(authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '222222' }, '::1')).rejects.toThrow(
      'Email OTP has expired'
    );
    storedCodes({ mobile: { code: '222222', expiresAt: past() } });
    await expect(authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '222222' }, '::1')).rejects.toThrow(
      'Mobile SMS OTP has expired'
    );
    storedCodes({ email: { code: '111111', expiresAt: future() } });
    await expect(authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp: '222222' }, '::1')).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
  });

  test('the single-code fallback rejects expired and wrong codes and accepts the right one', async () => {
    storedCodes({ single: { code: '333333', expiresAt: past() } });
    await expect(authService.registerUser({ ...payload, code: '333333' }, '::1')).rejects.toThrow(AUTH_MESSAGES.INVALID_OTP);
    storedCodes({ single: { code: '333333', expiresAt: future() } });
    await expect(authService.registerUser({ ...payload, code: '000000' }, '::1')).rejects.toThrow(AUTH_MESSAGES.INVALID_OTP);
    await expect(authService.registerUser({ ...payload, emailOtp: '333333' }, '::1')).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
  });

  test('resolveAuthSecret uses the configured key, refuses to run keyless in production, and otherwise generates one', () => {
    expect(authService.resolveAuthSecret({ AUTH_SECRET: 'configured' })).toBe('configured');
    expect(authService.resolveAuthSecret({ JWT_SECRET: 'jwt' })).toBe('jwt');
    expect(() => authService.resolveAuthSecret({ NODE_ENV: 'production' })).toThrow('AUTH_SECRET (or JWT_SECRET) must be set');
    expect(authService.resolveAuthSecret({})).toMatch(/^[0-9a-f]{96}$/);
  });

  test('hydrateFromDB sweeps expired state and survives a failed sweep', async () => {
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockResolvedValue({ isConnected: true });
    const purge = jest.spyOn(authSessionQueries, 'purgeExpiredAuthState').mockResolvedValue({ otpsPurged: 2, revokedTokensPurged: 0 });
    await authService.hydrateFromDB();
    expect(purge).toHaveBeenCalled();
    purge.mockResolvedValue({ otpsPurged: 0, revokedTokensPurged: 0 });
    await authService.hydrateFromDB();
    purge.mockRejectedValue(new Error('sweep failed'));
    await expect(authService.hydrateFromDB()).resolves.not.toThrow();
  });
});
