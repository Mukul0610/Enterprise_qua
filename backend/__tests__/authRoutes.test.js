const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const authController = require('../src/controllers/authController');
const authSessionQueries = require('../src/db/authSessionQueries');
const dbPool = require('../src/db/pool');
const identityQueries = require('../src/db/identityQueries');
const mailerService = require('../src/services/mailerService');
const {
  AUTH_MESSAGES,
  INDIAN_MOBILE_MESSAGE,
  OTP_CODE_MESSAGE,
  IDENTITY_OTP_CONFIG,
} = require('../src/config/constants');
const { authHeader } = require('./testHelpers');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

/** An active, approved buyer row as returned by identityQueries.findUserByEmail. */
function buyerRecord(overrides = {}) {
  return {
    id: '1b7083fa-78b1-4372-bf11-6eca62db9b7e',
    email: 'navinchaudhary.dev@gmail.com',
    name: 'Navin Chaudhary',
    role: 'buyer',
    rawRoleName: 'ClientInitiator',
    orgId: 'f84c8587-5c39-49f4-add2-c6ee62352008',
    orgName: 'Navin Chaudhary Enterprises',
    password: 'Pass@123',
    mobile: '+919157154504',
    status: 'ACTIVE',
    isActive: true,
    isApproved: true,
    isSelfClient: false,
    verificationStatus: 'EMAIL_VERIFIED',
    ...overrides,
  };
}

const EMAIL = 'navinchaudhary.dev@gmail.com';
const PASSWORD = 'Pass@123';
/** Mobile number as typed by the visitor on the sign-in form. */
const MOBILE = '9157154504';

describe('Authentication against the account records (/api/auth)', () => {
  let originalPool;

  beforeEach(() => {
    // The identity pool is only constructed when MYSQL_* is configured, which it
    // is not under test. A truthy stub puts the service in its "configured" path
    // while every read is driven by the identityQueries mocks below.
    originalPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
    jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue(undefined);
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  // ── Password hashing helpers (retained for legacy callers) ─────────────────
  describe('password helpers', () => {
    test('hashPassword generates a hash+salt pair, reusing a supplied salt', () => {
      const auto = authService.hashPassword('testpass');
      expect(auto.hash).toBeDefined();
      expect(auto.salt).toBeDefined();

      const withSalt = authService.hashPassword('testpass', 'custom-salt');
      expect(withSalt.salt).toBe('custom-salt');
      expect(authService.hashPassword('testpass', 'custom-salt').hash).toBe(withSalt.hash);
    });

    test('verifyPassword handles empty inputs safely and matches a valid pair', () => {
      const { hash, salt } = authService.hashPassword('password123');
      expect(authService.verifyPassword('', hash, salt)).toBe(false);
      expect(authService.verifyPassword('password123', '', salt)).toBe(false);
      expect(authService.verifyPassword('password123', hash, '')).toBe(false);
      expect(authService.verifyPassword(null, null, null)).toBe(false);
      expect(authService.verifyPassword('password123', hash, salt)).toBe(true);
    });
  });

  // ── Session tokens ────────────────────────────────────────────────────────
  describe('session tokens', () => {
    test('a generated token verifies and carries the account claims', () => {
      const token = authService.generateSessionToken(buyerRecord());
      const result = authService.verifySessionToken(token);

      expect(result.valid).toBe(true);
      expect(result.user.email).toBe(EMAIL);
      expect(result.user.role).toBe('buyer');
    });

    test.each([
      [null, AUTH_MESSAGES.SESSION_TOKEN_MISSING],
      ['', AUTH_MESSAGES.SESSION_TOKEN_MISSING],
      ['not-a-jwt', AUTH_MESSAGES.MALFORMED_TOKEN],
    ])('rejects malformed token %p', (token, expectedError) => {
      const result = authService.verifySessionToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe(expectedError);
    });

    test('rejects a token whose signature does not match', () => {
      const [header, payload] = authService.generateSessionToken(buyerRecord()).split('.');
      const result = authService.verifySessionToken(`${header}.${payload}.tampered`);

      expect(result.valid).toBe(false);
      expect(result.error).toBe(AUTH_MESSAGES.INVALID_TOKEN_SIGNATURE);
    });

    test('rejects an undecodable payload', () => {
      const token = authService.generateSessionToken(buyerRecord());
      const [header, , signature] = token.split('.');
      // Re-sign a deliberately invalid payload so the signature check passes first.
      const crypto = require('crypto');
      const badPayload = '!!!not-base64-json!!!';
      const sig = crypto
        .createHmac('sha256', process.env.AUTH_SECRET)
        .update(`${header}.${badPayload}`)
        .digest('base64url');
      const result = authService.verifySessionToken(`${header}.${badPayload}.${sig}`);

      expect(result.valid).toBe(false);
      expect(result.error).toBe(AUTH_MESSAGES.TOKEN_DECODE_FAILED);
      expect(signature).toBeDefined();
    });

    test('an expired token is reported as expired', () => {
      const crypto = require('crypto');
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'usr-1', email: EMAIL, role: 'buyer', exp: 1 })
      ).toString('base64url');
      const sig = crypto
        .createHmac('sha256', process.env.AUTH_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64url');

      const result = authService.verifySessionToken(`${header}.${payload}.${sig}`);
      expect(result.valid).toBe(false);
      expect(result.error).toBe(AUTH_MESSAGES.SESSION_EXPIRED);
    });

    test('a revoked token stops passing the full session check, and revoking junk is a no-op', async () => {
      const token = authService.generateSessionToken(buyerRecord({ id: 'usr-revoke-1' }));
      await expect(authService.assertSessionActive(token)).resolves.toMatchObject({ valid: true });

      await expect(authService.revokeSessionToken(token)).resolves.toBe(true);

      // The signature and expiry are still fine — only the revocation record makes
      // it invalid, which is why that check cannot live in verifySessionToken.
      expect(authService.verifySessionToken(token).valid).toBe(true);
      const after = await authService.assertSessionActive(token);
      expect(after.valid).toBe(false);
      expect(after.error).toBe(AUTH_MESSAGES.SESSION_LOGGED_OUT);

      await expect(authService.revokeSessionToken(null)).resolves.toBe(false);
      await expect(authService.revokeSessionToken('a.b')).resolves.toBe(false);
    });

    test('fails closed when the revocation record cannot be read', async () => {
      // Treating an unreachable database as "not revoked" would turn an outage into
      // a window where every logged-out token worked again.
      const authSessionQueries = require('../src/db/authSessionQueries');
      const token = authService.generateSessionToken(buyerRecord({ id: 'usr-revoke-2' }));
      jest
        .spyOn(authSessionQueries, 'isTokenRevoked')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await authService.assertSessionActive(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe(AUTH_MESSAGES.SESSION_CHECK_UNAVAILABLE);
    });

    test('revoking a token with an undecodable payload still succeeds', async () => {
      // An undecodable payload still gets revoked; it just cannot tell the sweep
      // when the entry may be dropped, so a default expiry is used.
      const crypto = require('crypto');
      const header = 'h';
      const payload = '!!!bad!!!';
      const sig = crypto
        .createHmac('sha256', process.env.AUTH_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64url');

      await expect(
        authService.revokeSessionToken(`${header}.${payload}.${sig}`)
      ).resolves.toBe(true);
    });

    test('reports a failed revocation rather than claiming the session ended', async () => {
      const authSessionQueries = require('../src/db/authSessionQueries');
      const token = authService.generateSessionToken(buyerRecord({ id: 'usr-revoke-3' }));
      jest.spyOn(authSessionQueries, 'revokeToken').mockRejectedValueOnce(new Error('write failed'));

      await expect(authService.revokeSessionToken(token)).resolves.toBe(false);
    });
  });

  // ── Identity lookups & sign-in gates ──────────────────────────────────────
  describe('loadIdentityUser', () => {
    test('returns the row the identity database provides', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      await expect(authService.loadIdentityUser(EMAIL)).resolves.toMatchObject({ email: EMAIL });
    });

    test('narrows the lookup to email + phone when a mobile number is supplied', async () => {
      const byEmail = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      const byEmailAndPhone = jest
        .spyOn(identityQueries, 'findUserByEmailAndPhone')
        .mockResolvedValue(buyerRecord());

      await expect(authService.loadIdentityUser(EMAIL, MOBILE)).resolves.toMatchObject({ email: EMAIL });

      expect(byEmailAndPhone).toHaveBeenCalledWith(EMAIL, MOBILE);
      expect(byEmail).not.toHaveBeenCalled();
    });

    test('fails closed when the email + phone lookup throws', async () => {
      jest
        .spyOn(identityQueries, 'findUserByEmailAndPhone')
        .mockRejectedValue(new Error('ETIMEDOUT'));
      await expect(authService.loadIdentityUser(EMAIL, MOBILE)).rejects.toThrow(
        AUTH_MESSAGES.IDENTITY_DB_UNAVAILABLE
      );
    });

    test('fails closed when the identity database is not configured', async () => {
      dbPool.pool = null;
      await expect(authService.loadIdentityUser(EMAIL)).rejects.toThrow(
        AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED
      );
    });

    test('fails closed when the lookup query throws', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValue(new Error('ETIMEDOUT'));
      await expect(authService.loadIdentityUser(EMAIL)).rejects.toThrow(
        AUTH_MESSAGES.IDENTITY_DB_UNAVAILABLE
      );
    });
  });

  describe('assertUserCanSignIn', () => {
    test('passes for an active, approved, mapped account', () => {
      expect(() => authService.assertUserCanSignIn(buyerRecord(), EMAIL, '::1')).not.toThrow();
    });

    test('blocks an inactive account', () => {
      expect(() =>
        authService.assertUserCanSignIn(buyerRecord({ isActive: false }), EMAIL, '::1')
      ).toThrow(AUTH_MESSAGES.ACCOUNT_INACTIVE);
    });

    test('blocks a self-registered account still awaiting approval', () => {
      expect(() =>
        authService.assertUserCanSignIn(
          buyerRecord({ isSelfClient: true, isApproved: false }),
          EMAIL,
          '::1'
        )
      ).toThrow(AUTH_MESSAGES.ACCOUNT_PENDING_APPROVAL);
    });

    test('blocks a role this workspace has no screens for', () => {
      expect(() =>
        authService.assertUserCanSignIn(buyerRecord({ role: null, rawRoleName: 'Registration' }), EMAIL, '::1')
      ).toThrow(AUTH_MESSAGES.INVALID_CREDENTIALS);
    });
  });

  // ── Password authentication ───────────────────────────────────────────────
  describe('authenticateWithPassword', () => {
    test('issues a session for correct credentials', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());

      const result = await authService.authenticateWithPassword(EMAIL, PASSWORD, '::1', MOBILE);

      expect(result.success).toBe(true);
      expect(result.user).toEqual({
        id: buyerRecord().id,
        email: EMAIL,
        name: 'Navin Chaudhary',
        role: 'buyer',
        orgId: buyerRecord().orgId,
        orgName: 'Navin Chaudhary Enterprises',
        mobile: '+919157154504',
        passwordChangeRequired: false,
      });
      expect(authService.verifySessionToken(result.token).valid).toBe(true);
    });

    test('marks a provisioned vendor session as requiring a password change', async () => {
      const vendor = buyerRecord({
        role: 'vendor',
        resetPasswordRequired: true,
      });
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(vendor);

      const result = await authService.authenticateWithPassword(EMAIL, PASSWORD, '::1', MOBILE);

      expect(result.user.passwordChangeRequired).toBe(true);
      expect(authService.verifySessionToken(result.token).user.passwordChangeRequired).toBe(true);
    });

    test('resolves the account by email + registered mobile, not email alone', async () => {
      const byEmail = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      const byEmailAndPhone = jest
        .spyOn(identityQueries, 'findUserByEmailAndPhone')
        .mockResolvedValue(buyerRecord());

      await authService.authenticateWithPassword(EMAIL, PASSWORD, '::1', MOBILE);

      expect(byEmailAndPhone).toHaveBeenCalledWith(EMAIL, MOBILE);
      expect(byEmail).not.toHaveBeenCalled();
    });

    test('rejects a wrong password', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      await expect(
        authService.authenticateWithPassword(EMAIL, 'WrongPass@1', '::1', MOBILE)
      ).rejects.toThrow(AUTH_MESSAGES.INVALID_LOGIN_CREDENTIALS);
    });

    // Stage 1 of the Java flow (validateUser) reports the pair as wrong rather
    // than blaming the password, so a mistyped mobile number is actionable.
    test('rejects an unknown email as an unmatched email + mobile pair', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(null);
      await expect(
        authService.authenticateWithPassword('ghost@nowhere.test', 'x', '::1', MOBILE)
      ).rejects.toThrow(AUTH_MESSAGES.INVALID_USERNAME_OR_MOBILE);
    });

    test('rejects a mobile number that does not belong to the account', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(null);
      await expect(
        authService.authenticateWithPassword(EMAIL, PASSWORD, '::1', '9000000000')
      ).rejects.toThrow(AUTH_MESSAGES.INVALID_USERNAME_OR_MOBILE);
    });

    // Stage 2 runs before the credential check, matching validateUserApproval.
    test('applies the approval gate before comparing the password', async () => {
      jest
        .spyOn(identityQueries, 'findUserByEmailAndPhone')
        .mockResolvedValue(buyerRecord({ isSelfClient: true, isApproved: false }));
      const verifySpy = jest.spyOn(identityQueries, 'verifyStoredPassword');

      await expect(
        authService.authenticateWithPassword(EMAIL, 'WrongPass@1', '::1', MOBILE)
      ).rejects.toThrow(AUTH_MESSAGES.ACCOUNT_PENDING_APPROVAL);

      expect(verifySpy).not.toHaveBeenCalled();
    });

    test('applies the active gate before comparing the password', async () => {
      jest
        .spyOn(identityQueries, 'findUserByEmailAndPhone')
        .mockResolvedValue(buyerRecord({ isActive: false }));
      const verifySpy = jest.spyOn(identityQueries, 'verifyStoredPassword');

      await expect(
        authService.authenticateWithPassword(EMAIL, PASSWORD, '::1', MOBILE)
      ).rejects.toThrow(AUTH_MESSAGES.ACCOUNT_INACTIVE);

      expect(verifySpy).not.toHaveBeenCalled();
    });

    test('requires an email, a mobile number and a password', async () => {
      await expect(authService.authenticateWithPassword('', PASSWORD, '::1', MOBILE)).rejects.toThrow(
        AUTH_MESSAGES.EMAIL_MOBILE_PASSWORD_REQUIRED
      );
      await expect(authService.authenticateWithPassword(EMAIL, '', '::1', MOBILE)).rejects.toThrow(
        AUTH_MESSAGES.EMAIL_MOBILE_PASSWORD_REQUIRED
      );
      await expect(authService.authenticateWithPassword(EMAIL, PASSWORD, '::1', '')).rejects.toThrow(
        AUTH_MESSAGES.EMAIL_MOBILE_PASSWORD_REQUIRED
      );
      await expect(authService.authenticateWithPassword(EMAIL, PASSWORD, '::1')).rejects.toThrow(
        AUTH_MESSAGES.EMAIL_MOBILE_PASSWORD_REQUIRED
      );
    });

    test('normalises the email and trims the mobile before looking them up', async () => {
      const findSpy = jest
        .spyOn(identityQueries, 'findUserByEmailAndPhone')
        .mockResolvedValue(buyerRecord());

      await authService.authenticateWithPassword(
        `  ${EMAIL.toUpperCase()} `,
        PASSWORD,
        '::1',
        `  ${MOBILE} `
      );

      expect(findSpy).toHaveBeenCalledWith(EMAIL, MOBILE);
    });
  });

  // ── OTP flow ──────────────────────────────────────────────────────────────
  // Mirrors the OTP branch of POST /authenticate in the Java p2pservices app:
  // the email + mobile pair is validated first, and the 6-digit code is stored
  // against that pair for 15 minutes.
  describe('OTP request and verification', () => {
    test('dispatches a code for a known account and verifies it', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());

      const requested = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      expect(requested.success).toBe(true);
      expect(requested.expiresInSeconds).toBe(IDENTITY_OTP_CONFIG.OTP_EXPIRY_MS / 1000);
      expect(requested.demoCode).toMatch(/^\d{6}$/);

      const verified = await authService.verifyOtp(EMAIL, requested.demoCode, '::1', MOBILE);
      expect(verified.success).toBe(true);
      expect(verified.user.email).toBe(EMAIL);
    });

    test('issues a 15-minute, 6-digit code as the shared otp_store column expects', () => {
      expect(IDENTITY_OTP_CONFIG.OTP_LENGTH).toBe(6);
      expect(IDENTITY_OTP_CONFIG.OTP_EXPIRY_MS).toBe(15 * 60 * 1000);
      expect(IDENTITY_OTP_CONFIG.OTP_KEY_SEPARATOR).toBe('_EMAIL_');
    });

    test('an OTP cannot be replayed once consumed', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      const { demoCode } = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      await authService.verifyOtp(EMAIL, demoCode, '::1', MOBILE);

      await expect(authService.verifyOtp(EMAIL, demoCode, '::1', MOBILE)).rejects.toThrow(
        AUTH_MESSAGES.INVALID_OTP
      );
    });

    // The store key is `<+91phone>_EMAIL_<email>`, so a code issued for one
    // registered mobile number must not verify against a different one.
    test('a code issued for one mobile number does not verify against another', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      const { demoCode } = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');

      await expect(authService.verifyOtp(EMAIL, demoCode, '::1', '9000000000')).rejects.toThrow(
        AUTH_MESSAGES.INVALID_OTP
      );
    });

    test('accepts any dialling form that normalises to the issued number', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      const { demoCode } = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');

      const verified = await authService.verifyOtp(EMAIL, demoCode, '::1', `+91 ${MOBILE}`);
      expect(verified.success).toBe(true);
    });

    test('deletes an expired code and rejects it', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      const { demoCode } = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');

      const expired = Date.now() + IDENTITY_OTP_CONFIG.OTP_EXPIRY_MS + 1000;
      jest.spyOn(Date, 'now').mockReturnValue(expired);

      await expect(authService.verifyOtp(EMAIL, demoCode, '::1', MOBILE)).rejects.toThrow(
        AUTH_MESSAGES.INVALID_OTP
      );

      // The entry is dropped on inspection, so a retry cannot resurrect it.
      Date.now.mockRestore();
      await expect(authService.verifyOtp(EMAIL, demoCode, '::1', MOBILE)).rejects.toThrow(
        AUTH_MESSAGES.INVALID_OTP
      );
    });

    test('rejects an OTP request for an unrecognised email + mobile pair', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(null);
      await expect(
        authService.requestOtp('ghost@nowhere.test', MOBILE, 'buyer', '::1')
      ).rejects.toThrow(AUTH_MESSAGES.INVALID_USERNAME_OR_MOBILE);
    });

    test('rejects an OTP request for an account that cannot sign in', async () => {
      jest
        .spyOn(identityQueries, 'findUserByEmailAndPhone')
        .mockResolvedValue(buyerRecord({ isActive: false }));
      await expect(authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1')).rejects.toThrow(
        AUTH_MESSAGES.ACCOUNT_INACTIVE
      );
    });

    test('requires an email and a mobile number to request a code', async () => {
      await expect(authService.requestOtp('', MOBILE, 'buyer')).rejects.toThrow(
        AUTH_MESSAGES.OTP_EMAIL_REQUIRED
      );
      await expect(authService.requestOtp(EMAIL, '', 'buyer')).rejects.toThrow(
        AUTH_MESSAGES.MOBILE_REQUIRED
      );
    });

    test('requires an email, a code and a mobile number to verify', async () => {
      await expect(authService.verifyOtp('', '123456', '::1', MOBILE)).rejects.toThrow(
        AUTH_MESSAGES.OTP_CODE_REQUIRED
      );
      await expect(authService.verifyOtp(EMAIL, '', '::1', MOBILE)).rejects.toThrow(
        AUTH_MESSAGES.OTP_CODE_REQUIRED
      );
      await expect(authService.verifyOtp(EMAIL, '123456', '::1', '')).rejects.toThrow(
        AUTH_MESSAGES.MOBILE_REQUIRED
      );
    });

    test('rejects an incorrect code', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');

      await expect(authService.verifyOtp(EMAIL, '000000', '::1', MOBILE)).rejects.toThrow(
        AUTH_MESSAGES.INVALID_OTP
      );
    });

    test('rejects a code when none was ever issued', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      await expect(
        authService.verifyOtp('never.issued@example.com', '123456', '::1', MOBILE)
      ).rejects.toThrow(AUTH_MESSAGES.INVALID_OTP);
    });

    test('omits demoCode once SMTP is configured', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      jest.spyOn(mailerService, 'isConfigured').mockReturnValue(true);
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
        expect(res.demoCode).toBeUndefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    test('an email dispatch failure does not fail the request', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('SMTP down'));

      const res = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');
      expect(res.success).toBe(true);
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  // ── Registration ──────────────────────────────────────────────────────────
  describe('registerUser', () => {
    const payload = {
      name: 'Navin Chaudhary',
      email: EMAIL,
      password: PASSWORD,
      mobile: '9157154504',
      orgName: 'Navin Chaudhary Enterprises',
    };

    test('creates the account in the identity database and returns a session', async () => {
      const insertSpy = jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
        created: true,
        user: {
          id: 'new-uuid',
          email: EMAIL,
          name: 'Navin Chaudhary',
          role: 'buyer',
          orgId: 'new-org',
          orgName: 'Navin Chaudhary Enterprises',
        },
      });

      const result = await authService.registerUser(payload, '::1');

      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ email: EMAIL, password: PASSWORD, phone: '9157154504' })
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe(AUTH_MESSAGES.REGISTRATION_SUCCESS);
      expect(authService.verifySessionToken(result.token).valid).toBe(true);
    });

    test('new vendor registration requires a password change in its first session', async () => {
      jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({
        created: true,
        user: {
          id: 'new-vendor-uuid',
          email: EMAIL,
          name: 'Navin Chaudhary',
          role: 'vendor',
          orgId: 'new-vendor-org',
          orgName: 'Navin Chaudhary Enterprises',
        },
      });

      const result = await authService.registerUser({ ...payload, role: 'vendor' }, '::1');
      const session = authService.verifySessionToken(result.token);

      expect(result.user.passwordChangeRequired).toBe(true);
      expect(session.user.passwordChangeRequired).toBe(true);
    });

    test('reports a duplicate account rather than signing the caller in', async () => {
      jest
        .spyOn(identityQueries, 'insertBuyerAccount')
        .mockResolvedValue({ created: false, reason: 'ALREADY_EXISTS', user: buyerRecord() });

      await expect(authService.registerUser(payload, '::1')).rejects.toThrow(
        AUTH_MESSAGES.ACCOUNT_ALREADY_EXISTS
      );
    });

    test('validates the mandatory fields', async () => {
      await expect(authService.registerUser({ ...payload, email: '' })).rejects.toThrow(
        AUTH_MESSAGES.REGISTRATION_EMAIL_REQUIRED
      );
      await expect(authService.registerUser({ ...payload, password: '' })).rejects.toThrow(
        AUTH_MESSAGES.EMAIL_PASSWORD_REQUIRED
      );
      await expect(authService.registerUser({ ...payload, mobile: '' })).rejects.toThrow(
        AUTH_MESSAGES.MOBILE_REQUIRED
      );
    });

    test('fails closed when the identity database is not configured', async () => {
      dbPool.pool = null;
      await expect(authService.registerUser(payload)).rejects.toThrow(
        AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED
      );
    });

    test('verifies dual OTPs with distinct email and mobile codes', async () => {
      const emailOtp = '804033';
      const mobileOtp = '459228';
      const emailKey = authService.buildOtpKey(EMAIL, `${MOBILE}_email`);
      const mobileKey = authService.buildOtpKey(EMAIL, `${MOBILE}_mobile`);
      await authSessionQueries.saveOtp(emailKey, emailOtp, Date.now() + 60000);
      await authSessionQueries.saveOtp(mobileKey, mobileOtp, Date.now() + 60000);

      jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
        created: true,
        user: { id: 'new-uuid', email: EMAIL, name: 'Navin Chaudhary', role: 'buyer' },
      });

      const res = await authService.registerUser(
        { ...payload, emailOtp, mobileOtp },
        '::1'
      );
      expect(res.success).toBe(true);

      // Verify OTPs were cleared
      expect(await authSessionQueries.findOtp(emailKey)).toBeNull();
      expect(await authSessionQueries.findOtp(mobileKey)).toBeNull();
    });

    test('rejects registration when mobile OTP is incorrect in dual OTP mode', async () => {
      const emailOtp = '804033';
      const mobileOtp = '459228';
      const emailKey = authService.buildOtpKey(EMAIL, `${MOBILE}_email`);
      const mobileKey = authService.buildOtpKey(EMAIL, `${MOBILE}_mobile`);
      await authSessionQueries.saveOtp(emailKey, emailOtp, Date.now() + 60000);
      await authSessionQueries.saveOtp(mobileKey, mobileOtp, Date.now() + 60000);

      await expect(
        authService.registerUser({ ...payload, emailOtp, mobileOtp: '999999' }, '::1')
      ).rejects.toThrow('Invalid Mobile SMS OTP entered. Please check the SMS sent to your phone.');
    });

    test('rejects registration when email OTP is incorrect in dual OTP mode', async () => {
      const emailOtp = '804033';
      const mobileOtp = '459228';
      const emailKey = authService.buildOtpKey(EMAIL, `${MOBILE}_email`);
      const mobileKey = authService.buildOtpKey(EMAIL, `${MOBILE}_mobile`);
      await authSessionQueries.saveOtp(emailKey, emailOtp, Date.now() + 60000);
      await authSessionQueries.saveOtp(mobileKey, mobileOtp, Date.now() + 60000);

      await expect(
        authService.registerUser({ ...payload, emailOtp: '111111', mobileOtp }, '::1')
      ).rejects.toThrow('Invalid Email OTP entered. Please check the code sent to your email.');
    });
  });

  // ── Admin user listing ────────────────────────────────────────────────────
  describe('getAllUsers', () => {
    test('maps the directory rows onto the public shape', async () => {
      jest.spyOn(identityQueries, 'listUsers').mockResolvedValue([buyerRecord()]);

      const users = await authService.getAllUsers();

      expect(users).toEqual([
        {
          id: buyerRecord().id,
          email: EMAIL,
          name: 'Navin Chaudhary',
          role: 'buyer',
          orgId: buyerRecord().orgId,
          orgName: 'Navin Chaudhary Enterprises',
          mobile: '+919157154504',
          status: 'ACTIVE',
        },
      ]);
    });

    test('fails closed when the identity database is not configured', async () => {
      dbPool.pool = null;
      await expect(authService.getAllUsers()).rejects.toThrow(
        AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED
      );
    });
  });

  // ── Boot-time health report ───────────────────────────────────────────────
  describe('hydrateFromDB', () => {
    test('returns the identity health report when reachable', async () => {
      jest
        .spyOn(dbPool, 'checkDatabaseHealth')
        .mockResolvedValue({ isConnected: true, userCount: 5 });

      await expect(authService.hydrateFromDB()).resolves.toMatchObject({ isConnected: true });
    });

    test('logs loudly but resolves when the identity database is unreachable', async () => {
      jest
        .spyOn(dbPool, 'checkDatabaseHealth')
        .mockResolvedValue({ isConnected: false, errorMessage: 'offline' });

      await expect(authService.hydrateFromDB()).resolves.toMatchObject({ isConnected: false });
    });
  });

  // ── HTTP surface ──────────────────────────────────────────────────────────
  describe('HTTP routes', () => {
    test('POST /api/auth/login signs in with an email, mobile and password', async () => {
      const findSpy = jest
        .spyOn(identityQueries, 'findUserByEmailAndPhone')
        .mockResolvedValue(buyerRecord());

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD, mobile: MOBILE });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.role).toBe('buyer');
      expect(res.body.token).toBeDefined();
      expect(findSpy).toHaveBeenCalledWith(EMAIL, MOBILE);
    });

    test('POST /api/auth/login returns 401 for a wrong password', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: 'nope', mobile: MOBILE });

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(AUTH_MESSAGES.INVALID_LOGIN_CREDENTIALS);
    });

    test('POST /api/auth/login returns 401 when the mobile number is missing', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(AUTH_MESSAGES.EMAIL_MOBILE_PASSWORD_REQUIRED);
    });

    test('POST /api/auth/login rejects a malformed mobile number at the boundary', async () => {
      const findSpy = jest.spyOn(identityQueries, 'findUserByEmailAndPhone');

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD, mobile: '12345' });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(INDIAN_MOBILE_MESSAGE);
      expect(findSpy).not.toHaveBeenCalled();
    });

    test('POST /api/auth/login accepts an OTP code branch', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      const { demoCode } = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: EMAIL, code: demoCode, mobile: MOBILE });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/login rejects a payload with neither password nor code', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: EMAIL });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(AUTH_MESSAGES.PASSWORD_OR_CODE_REQUIRED);
    });

    test('POST /api/auth/login validates the payload', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/auth/request-otp dispatches a code', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());

      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: EMAIL, mobile: MOBILE, roleHint: 'buyer' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/request-otp returns 400 for an unknown email + mobile pair', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(null);

      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: 'ghost@nowhere.test', mobile: MOBILE });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(AUTH_MESSAGES.INVALID_USERNAME_OR_MOBILE);
    });

    test('POST /api/auth/request-otp validates the payload', async () => {
      const res = await request(app).post('/api/auth/request-otp').send({});
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/auth/request-otp requires a mobile number', async () => {
      const res = await request(app).post('/api/auth/request-otp').send({ email: EMAIL });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(INDIAN_MOBILE_MESSAGE);
    });

    test('POST /api/auth/verify-otp verifies and rejects codes', async () => {
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(buyerRecord());
      const { demoCode } = await authService.requestOtp(EMAIL, MOBILE, 'buyer', '::1');

      const bad = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: EMAIL, code: '000000', mobile: MOBILE });
      expect(bad.statusCode).toBe(400);

      const good = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: EMAIL, code: demoCode, mobile: MOBILE });
      expect(good.statusCode).toBe(200);
      expect(good.body.success).toBe(true);
    });

    test('POST /api/auth/verify-otp validates the payload', async () => {
      const res = await request(app).post('/api/auth/verify-otp').send({ email: EMAIL });
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/auth/verify-otp rejects a code that is not 6 digits', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: EMAIL, code: '1234', mobile: MOBILE });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(OTP_CODE_MESSAGE);
    });

    test('POST /api/auth/register creates an account', async () => {
      jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
        created: true,
        user: {
          id: 'new-uuid',
          email: 'brand.new@example.com',
          name: 'Brand New',
          role: 'buyer',
          orgId: 'new-org',
          orgName: 'Brand New Ltd',
        },
      });

      const res = await request(app).post('/api/auth/register').send({
        name: 'Brand New',
        email: 'brand.new@example.com',
        password: 'Secret@123',
        mobile: '9876543210',
        role: 'buyer',
        orgName: 'Brand New Ltd',
      });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/register reports a duplicate with 400', async () => {
      jest
        .spyOn(identityQueries, 'insertBuyerAccount')
        .mockResolvedValue({ created: false, user: buyerRecord() });

      const res = await request(app).post('/api/auth/register').send({
        name: 'Navin Chaudhary',
        email: EMAIL,
        password: PASSWORD,
        mobile: '9157154504',
        role: 'buyer',
        orgName: 'Navin Chaudhary Enterprises',
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(AUTH_MESSAGES.ACCOUNT_ALREADY_EXISTS);
    });

    test('POST /api/auth/register validates the payload', async () => {
      const res = await request(app).post('/api/auth/register').send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/auth/session round-trips a bearer token', async () => {
      const noToken = await request(app).get('/api/auth/session');
      expect(noToken.statusCode).toBe(401);
      expect(noToken.body.error).toBe(AUTH_MESSAGES.NO_SESSION_TOKEN);

      const bad = await request(app).get('/api/auth/session').set('Authorization', 'Bearer nonsense');
      expect(bad.statusCode).toBe(401);

      const ok = await request(app).get('/api/auth/session').set(authHeader('buyer'));
      expect(ok.statusCode).toBe(200);
      expect(ok.body.user.role).toBe('buyer');
    });

    test('POST /api/auth/logout succeeds with and without a token', async () => {
      const withToken = await request(app)
        .post('/api/auth/logout')
        .set(authHeader('vendor'))
        .send({ email: 'vendor@apexsupplies.com' });
      expect(withToken.statusCode).toBe(200);
      expect(withToken.body.message).toBe(AUTH_MESSAGES.LOGOUT_SUCCESS);

      const withoutToken = await request(app).post('/api/auth/logout').send({});
      expect(withoutToken.statusCode).toBe(200);
    });

    test('GET /api/auth/users is admin-only and lists the directory', async () => {
      jest.spyOn(identityQueries, 'listUsers').mockResolvedValue([buyerRecord()]);

      const unauth = await request(app).get('/api/auth/users');
      expect(unauth.statusCode).toBe(401);

      const nonAdmin = await request(app).get('/api/auth/users').set(authHeader('buyer'));
      expect(nonAdmin.statusCode).toBe(403);

      const admin = await request(app).get('/api/auth/users').set(authHeader('admin'));
      expect(admin.statusCode).toBe(200);
      expect(admin.body.count).toBe(1);
    });
  });

  // ── Controller error branches ─────────────────────────────────────────────
  describe('controller error branches', () => {
    test('getClientIp falls back through req.ip, x-forwarded-for, then a default', () => {
      expect(authController.getClientIp({ ip: '10.0.0.1' })).toBe('10.0.0.1');
      expect(authController.getClientIp({ headers: { 'x-forwarded-for': '8.8.8.8' } })).toBe('8.8.8.8');
      expect(authController.getClientIp({})).toBe('127.0.0.1');
    });

    test('getSession forwards unexpected failures to next()', async () => {
      const next = jest.fn();
      const res = mockRes();
      // getSession resolves the session through assertSessionActive now, because
      // the revocation check is a database read.
      jest.spyOn(authService, 'assertSessionActive').mockRejectedValue(new Error('boom'));

      await authController.getSession(
        { headers: { authorization: 'Bearer x.y.z' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('logout forwards unexpected failures to next()', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'revokeSessionToken').mockImplementation(() => {
        throw new Error('boom');
      });

      await authController.logout(
        { body: { email: EMAIL }, headers: { authorization: 'Bearer x.y.z' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('listUsers forwards identity database failures to next()', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'getAllUsers').mockRejectedValue(new Error('db down'));

      await authController.listUsers({}, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('login surfaces an unavailable identity database as 401', async () => {
      jest
        .spyOn(identityQueries, 'findUserByEmailAndPhone')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD, mobile: MOBILE });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe(AUTH_MESSAGES.IDENTITY_DB_UNAVAILABLE);
    });
  });

  // ── Fallback branches when a body or an error message is absent ────────────
  describe('controller fallback branches', () => {
    const VALID = { email: EMAIL, password: PASSWORD };

    test('every handler tolerates a request with no body at all', async () => {
      for (const handler of ['login', 'requestOtp', 'verifyOtp', 'register']) {
        const res = mockRes();
        await authController[handler]({}, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
      }
    });

    test('login falls back to a generic error when the failure carries no message', async () => {
      jest.spyOn(authService, 'authenticateWithPassword').mockRejectedValue(new Error(''));
      const res = mockRes();

      await authController.login({ body: VALID }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.AUTH_FAILED_FALLBACK,
      });
    });

    test('requestOtp falls back to a generic error when the failure carries no message', async () => {
      jest.spyOn(authService, 'requestOtp').mockRejectedValue(new Error(''));
      const res = mockRes();

      await authController.requestOtp({ body: { email: EMAIL, mobile: MOBILE } }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.OTP_REQUEST_EMAIL_REQUIRED,
      });
    });

    test('verifyOtp falls back to a generic error when the failure carries no message', async () => {
      jest.spyOn(authService, 'verifyOtp').mockRejectedValue(new Error(''));
      const res = mockRes();

      await authController.verifyOtp(
        { body: { email: EMAIL, code: '123456', mobile: MOBILE } },
        res,
        jest.fn()
      );

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.INVALID_OTP_FALLBACK,
      });
    });

    test('register falls back to a generic error when the failure carries no message', async () => {
      jest.spyOn(authService, 'registerUser').mockRejectedValue(new Error(''));
      const res = mockRes();

      await authController.register(
        {
          body: {
            name: 'Someone',
            email: 'someone@example.com',
            password: 'Secret@123',
            mobile: '9876543210',
          },
        },
        res,
        jest.fn()
      );

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.AUTH_FAILED_FALLBACK,
      });
    });

    test('login reaches the OTP branch through the code field', async () => {
      jest.spyOn(authService, 'verifyOtp').mockResolvedValue({ success: true, token: 't', user: {} });
      const res = mockRes();

      await authController.login(
        { body: { email: EMAIL, code: '123456', mobile: MOBILE } },
        res,
        jest.fn()
      );

      expect(authService.verifyOtp).toHaveBeenCalledWith(EMAIL, '123456', '127.0.0.1', MOBILE);
    });

    test('getSession falls back to a generic message when verification gives no reason', async () => {
      jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({ valid: false });
      const res = mockRes();

      await authController.getSession({ headers: { authorization: 'Bearer a.b.c' } }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.INVALID_SESSION_FALLBACK,
      });
    });

    test('logout falls back to a placeholder identity when no email is supplied', async () => {
      const res = mockRes();
      await authController.logout({ body: {}, headers: {} }, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: AUTH_MESSAGES.LOGOUT_SUCCESS,
      });
    });

    test('logout tolerates a request with no body', async () => {
      const res = mockRes();
      await authController.logout({ headers: {} }, res, jest.fn());
      expect(res.json).toHaveBeenCalled();
    });
  });
});

// ==============================================================================
// SELF-SERVICE PASSWORD CHANGE (POST /api/auth/change-password)
// ==============================================================================
// The account is taken from the session token, never from the request body, so a
// caller cannot nominate somebody else's account. Being authenticated is not
// enough on its own either: the current password is re-verified against a freshly
// read row on every attempt, because a token proves who is asking but not that
// they still know the credential.
// ==============================================================================

describe('Changing your own password', () => {
  const UUID = 'usr-buyer-001';
  const CURRENT = 'Pass@123';
  const NEXT = 'Brand@New456';

  /** The signed-in buyer, matching testHelpers' buyer token claims. */
  function signedInBuyer(overrides = {}) {
    return buyerRecord({
      id: UUID,
      email: 'buyer@procucev.com',
      password: CURRENT,
      ...overrides,
    });
  }

  let originalPool;

  beforeEach(() => {
    originalPool = dbPool.pool;
    dbPool.pool = { query: jest.fn() };
    jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(signedInBuyer());
    jest.spyOn(identityQueries, 'updateUserPasswordByUuid').mockResolvedValue(true);
  });

  afterEach(() => {
    dbPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  // ── Service ───────────────────────────────────────────────────────────────
  describe('authService.changePassword', () => {
    const call = (overrides = {}) =>
      authService.changePassword({
        userUuid: UUID,
        email: 'buyer@procucev.com',
        currentPassword: CURRENT,
        newPassword: NEXT,
        ipAddress: '127.0.0.1',
        ...overrides,
      });

    test('writes the new password against the primary key and reports success', async () => {
      const result = await call();
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          message: AUTH_MESSAGES.CHANGE_PASSWORD_SUCCESS,
          token: expect.any(String),
          user: expect.objectContaining({ passwordChangeRequired: false }),
        })
      );
      expect(authService.verifySessionToken(result.token).user.passwordChangeRequired).toBe(false);
      expect(identityQueries.updateUserPasswordByUuid).toHaveBeenCalledWith(
        UUID,
        NEXT,
        'buyer@procucev.com'
      );
    });

    test.each([
      ['no current password', { currentPassword: '' }],
      ['no new password', { newPassword: '' }],
    ])('rejects %s', async (_label, overrides) => {
      await expect(call(overrides)).rejects.toThrow(
        AUTH_MESSAGES.CHANGE_PASSWORD_FIELDS_REQUIRED
      );
      expect(identityQueries.updateUserPasswordByUuid).not.toHaveBeenCalled();
    });

    test('rejects a new password below the minimum length', async () => {
      await expect(call({ newPassword: 'Short1' })).rejects.toThrow(
        AUTH_MESSAGES.CHANGE_PASSWORD_TOO_SHORT
      );
      expect(identityQueries.updateUserPasswordByUuid).not.toHaveBeenCalled();
    });

    test('rejects a new password identical to the current one', async () => {
      await expect(call({ newPassword: CURRENT })).rejects.toThrow(
        AUTH_MESSAGES.CHANGE_PASSWORD_UNCHANGED
      );
      expect(identityQueries.updateUserPasswordByUuid).not.toHaveBeenCalled();
    });

    test('rejects a wrong current password without writing', async () => {
      await expect(call({ currentPassword: 'NotMyPassword1' })).rejects.toThrow(
        AUTH_MESSAGES.CHANGE_PASSWORD_CURRENT_INCORRECT
      );
      expect(identityQueries.updateUserPasswordByUuid).not.toHaveBeenCalled();
    });

    test('refuses when the account row can no longer be read', async () => {
      identityQueries.findUserByEmail.mockResolvedValue(null);
      await expect(call()).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_ACCOUNT_MISSING);
    });

    // Guards against a token whose subject no longer matches the row resolved
    // from its email claim, which duplicate usernames make possible.
    test('refuses when the resolved row is not the token subject', async () => {
      identityQueries.findUserByEmail.mockResolvedValue(signedInBuyer({ id: 'someone-else' }));
      await expect(call()).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_ACCOUNT_MISSING);
      expect(identityQueries.updateUserPasswordByUuid).not.toHaveBeenCalled();
    });

    test('applies the same active-account gate as sign-in', async () => {
      identityQueries.findUserByEmail.mockResolvedValue(signedInBuyer({ isActive: false }));
      await expect(call()).rejects.toThrow(AUTH_MESSAGES.ACCOUNT_INACTIVE);
    });

    // The password on the server is unchanged, and the caller is told so rather
    // than shown a success they cannot rely on.
    test('reports a failed write instead of claiming success', async () => {
      identityQueries.updateUserPasswordByUuid.mockResolvedValue(false);
      await expect(call()).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_WRITE_FAILED);
    });

    test('fails closed when no database is configured', async () => {
      dbPool.pool = null;
      await expect(call()).rejects.toThrow(AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED);
    });
  });

  // ── Controller ────────────────────────────────────────────────────────────
  describe('authController.changePassword', () => {
    const reqFor = (body, user = { sub: UUID, email: 'buyer@procucev.com' }) => ({
      body,
      user,
      headers: {},
      ip: '127.0.0.1',
    });

    test('passes the session identity through and returns the service result', async () => {
      const res = mockRes();
      await authController.changePassword(
        reqFor({ currentPassword: CURRENT, newPassword: NEXT }),
        res,
        jest.fn()
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: AUTH_MESSAGES.CHANGE_PASSWORD_SUCCESS,
        token: expect.any(String),
        user: expect.objectContaining({ passwordChangeRequired: false }),
      });
    });

    test('rejects a payload missing the current password with 400', async () => {
      const res = mockRes();
      await authController.changePassword(reqFor({ newPassword: NEXT }), res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('current password'),
      });
    });

    test('rejects a new password below the minimum with 400', async () => {
      const res = mockRes();
      await authController.changePassword(
        reqFor({ currentPassword: CURRENT, newPassword: 'Short1' }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('tolerates a request with no body at all', async () => {
      const res = mockRes();
      await authController.changePassword({ user: {}, headers: {} }, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('reports a service failure as 400 with the service reason', async () => {
      identityQueries.findUserByEmail.mockResolvedValue(signedInBuyer());
      const res = mockRes();
      await authController.changePassword(
        reqFor({ currentPassword: 'WrongPassword1', newPassword: NEXT }),
        res,
        jest.fn()
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.CHANGE_PASSWORD_CURRENT_INCORRECT,
      });
    });
  });

  // ── Route ─────────────────────────────────────────────────────────────────
  describe('POST /api/auth/change-password', () => {
    test('requires a session token', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .send({ currentPassword: CURRENT, newPassword: NEXT });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(identityQueries.updateUserPasswordByUuid).not.toHaveBeenCalled();
    });

    test('changes the password for the authenticated account', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set(authHeader('buyer'))
        .send({ currentPassword: CURRENT, newPassword: NEXT });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({
        success: true,
        message: AUTH_MESSAGES.CHANGE_PASSWORD_SUCCESS,
        token: expect.any(String),
        user: expect.objectContaining({ passwordChangeRequired: false }),
      }));
    });

    test('rejects a wrong current password with 400', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set(authHeader('buyer'))
        .send({ currentPassword: 'WrongPassword1', newPassword: NEXT });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(AUTH_MESSAGES.CHANGE_PASSWORD_CURRENT_INCORRECT);
    });

    // No email is accepted from the body, so supplying one changes nothing about
    // which account is written.
    test('ignores an account named in the body', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set(authHeader('buyer'))
        .send({
          email: 'someone.else@procucev.com',
          currentPassword: CURRENT,
          newPassword: NEXT,
        });

      expect(res.status).toBe(200);
      expect(identityQueries.findUserByEmail).toHaveBeenCalledWith('buyer@procucev.com');
      expect(identityQueries.updateUserPasswordByUuid).toHaveBeenCalledWith(
        UUID,
        NEXT,
        'buyer@procucev.com'
      );
    });
  });
});
