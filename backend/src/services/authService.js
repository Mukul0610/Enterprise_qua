const crypto = require('crypto');
const { logger } = require('./loggerService');
const storeService = require('./storeService');
const mailerService = require('./mailerService');
const { AUTH_MESSAGES, IDENTITY_OTP_CONFIG, PASSWORD_MIN_LENGTH } = require('../config/constants');
const pool = require('../db/pool');
const identityQueries = require('../db/identityQueries');
const authSessionQueries = require('../db/authSessionQueries');
const { getWaitUntil } = require('../db/d1Bridge');

let cachedEphemeralSecret = null;

/**
 * Resolve the session-signing key.
 *
 * There is no hardcoded fallback. This module used to ship a literal default
 * ('procucev-enterprise-auth-secret-key-2026') that dev and test ran on, which
 * meant the signing key for any deployment that forgot to set AUTH_SECRET was
 * sitting in the repository — anyone with the source could mint a valid session
 * token for any account and role.
 *
 * Production refuses to start without one. Everywhere else a random key is
 * generated per process: unset stays usable for local work, but the key is not
 * knowable from the source, and tokens simply stop verifying after a restart
 * rather than remaining forgeable forever.
 *
 * Note: Generating random bytes (crypto.randomBytes) or accessing unhandled I/O
 * in the global scope is disallowed by Cloudflare Workers runtime. This resolution
 * is therefore evaluated lazily on demand when signing/verifying tokens inside
 * request handlers, rather than at module load time.
 */
function resolveAuthSecret(env) {
  if (env && env !== process.env) {
    const configured = env.AUTH_SECRET || env.JWT_SECRET || '';
    if (configured) return configured;

    if (env.NODE_ENV === 'production') {
      throw new Error(
        'AUTH_SECRET (or JWT_SECRET) must be set in production. Refusing to start without a session-signing key.'
      );
    }

    const ephemeral = crypto.randomBytes(48).toString('hex');
    logger.warn(
      'AUTH_SECRET/JWT_SECRET is not set — generated a random key for this process only. Sessions will not survive a restart and will not be valid across workers. Set AUTH_SECRET in backend/.env.',
      {},
      'AUTH_SERVICE'
    );
    return ephemeral;
  }

  const cfEnv = typeof globalThis !== 'undefined' ? globalThis.__CF_ENV__ : undefined;
  const configured =
    process.env.AUTH_SECRET ||
    process.env.JWT_SECRET ||
    (cfEnv && (cfEnv.AUTH_SECRET || cfEnv.JWT_SECRET)) ||
    '';
  if (configured) return configured;

  const nodeEnv = (cfEnv && cfEnv.NODE_ENV) || process.env.NODE_ENV;
  if (nodeEnv === 'production') {
    throw new Error(
      'AUTH_SECRET (or JWT_SECRET) must be set in production. Refusing to start without a session-signing key.'
    );
  }

  if (!cachedEphemeralSecret) {
    cachedEphemeralSecret = crypto.randomBytes(48).toString('hex');
    logger.warn(
      'AUTH_SECRET/JWT_SECRET is not set — generated a random key for this process only. Sessions will not survive a restart and will not be valid across workers. Set AUTH_SECRET in backend/.env.',
      {},
      'AUTH_SERVICE'
    );
  }
  return cachedEphemeralSecret;
}

const SESSION_TTL_SECONDS = 24 * 60 * 60;

// OTP shape and lifetime: 6 digits, valid for 15 minutes.
const { OTP_LENGTH, OTP_EXPIRY_MS, OTP_KEY_SEPARATOR } = IDENTITY_OTP_CONFIG;

/**
 * Build the OTP storage key: `normalisedPhone + "_EMAIL_" + lowercased email`.
 *
 * Keying on the pair rather than the email alone means a code issued for one
 * registered mobile number cannot be replayed against a different one.
 */
function buildOtpKey(normalizedEmail, mobile) {
  return `${identityQueries.normalizePhone(mobile)}${OTP_KEY_SEPARATOR}${normalizedEmail}`;
}

/**
 * Generate a zero-padded numeric OTP of the configured length using a
 * cryptographically secure source rather than Math.random.
 */
function generateOtpCode() {
  const ceiling = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, ceiling)).padStart(OTP_LENGTH, '0');
}

/**
 * Generate a random per-user salt.
 */
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hash a password using HMAC-SHA256 + salt. Generates a random salt when none is
 * supplied.
 */
function hashPassword(password, salt) {
  const effectiveSalt = salt || generateSalt();
  const hash = crypto.createHmac('sha256', effectiveSalt).update(password).digest('hex');
  return { hash, salt: effectiveSalt };
}

/**
 * Verify a password against a stored hash + the salt that hash was created with.
 */
function verifyPassword(plainPassword, storedHash, storedSalt) {
  if (!plainPassword || !storedHash || !storedSalt) return false;
  const { hash: computedHash } = hashPassword(plainPassword, storedSalt);
  return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash));
}

/**
 * Load an account from the `user` table in PostgreSQL.
 *
 * This is the single source of truth for authentication: there is no in-memory
 * user registry, no seeded demo credentials, and no second database. If the
 * connection is unavailable, authentication fails closed with a descriptive error
 * rather than silently accepting anything.
 *
 * When a mobile number is supplied the lookup is narrowed to email + phone,
 * because there is no unique index on `user.username` — email alone can match
 * more than one row.
 */
async function loadIdentityUser(normalizedEmail, mobile) {
  if (!pool.hasStorage()) {
    throw new Error(AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED);
  }
  try {
    return mobile
      ? await identityQueries.findUserByEmailAndPhone(normalizedEmail, mobile)
      : await identityQueries.findUserByEmail(normalizedEmail);
  } catch (err) {
    logger.error('Account lookup failed', err, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.IDENTITY_DB_UNAVAILABLE);
  }
}

/**
 * Reject accounts that exist but are not permitted to sign in, with a message
 * that explains which gate failed and how to clear it.
 */
function assertUserCanSignIn(user, normalizedEmail, ipAddress) {
  if (!user.isActive) {
    logger.warn(`Sign-in blocked, inactive account: ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.ACCOUNT_INACTIVE);
  }
  // Self-registered accounts require administrator approval.
  if (user.isSelfClient && !user.isApproved) {
    logger.warn(`Sign-in blocked, pending approval: ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.ACCOUNT_PENDING_APPROVAL);
  }
  if (!user.role) {
    logger.warn(
      `Sign-in blocked, unmapped role "${user.rawRoleName}" for ${normalizedEmail}`,
      { ipAddress },
      'AUTH_SERVICE'
    );
    throw new Error(AUTH_MESSAGES.INVALID_CREDENTIALS);
  }
}

/**
 * Confirm the database is reachable at boot and clear out expired session state.
 *
 * Issued OTP codes and revoked tokens are persisted (see db/authSessionQueries),
 * so unlike the previous in-memory versions they survive a restart. The trade-off
 * is that they now need sweeping, which happens here.
 */
async function hydrateFromDB() {
  const health = await pool.checkDatabaseHealth();
  if (!health.isConnected) {
    logger.error(
      `Database unreachable at startup: ${health.errorMessage}. Sign-in will be rejected until it recovers.`,
      null,
      'AUTH_SERVICE'
    );
    return health;
  }

  try {
    const purged = await authSessionQueries.purgeExpiredAuthState();
    if (purged.otpsPurged > 0 || purged.revokedTokensPurged > 0) {
      logger.info('Swept expired auth session state', purged, 'AUTH_SERVICE');
    }
  } catch (err) {
    // A failed sweep is not a reason to refuse to boot: expired rows are inert,
    // they just accumulate.
    logger.warn('Could not sweep expired auth session state', { error: err.message }, 'AUTH_SERVICE');
  }

  return health;
}

/**
 * Generate a cryptographically signed session token (JWT structure).
 */
function generateSessionToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;

  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      orgName: user.orgName,
      iat: issuedAt,
      exp: expiresAt,
    })
  ).toString('base64url');

  const authSecret = resolveAuthSecret();
  const signature = crypto
    .createHmac('sha256', authSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Verify a token's structure, signature and expiry.
 *
 * Deliberately synchronous and deliberately does NOT check revocation — that
 * requires a database read. Call `assertSessionActive` for the complete check;
 * this exists for the callers that only need to decode claims they have already
 * had validated.
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: AUTH_MESSAGES.SESSION_TOKEN_MISSING };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: AUTH_MESSAGES.MALFORMED_TOKEN };
  }

  const [header, payload, signature] = parts;
  const authSecret = resolveAuthSecret();
  const expectedSignature = crypto
    .createHmac('sha256', authSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  // Compared as fixed-length digests, so a byte-by-byte early return cannot be
  // used to discover the expected signature.
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { valid: false, error: AUTH_MESSAGES.INVALID_TOKEN_SIGNATURE };
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);

    if (claims.exp && claims.exp < now) {
      return { valid: false, error: AUTH_MESSAGES.SESSION_EXPIRED };
    }

    return { valid: true, user: claims, signature };
  } catch {
    return { valid: false, error: AUTH_MESSAGES.TOKEN_DECODE_FAILED };
  }
}

/**
 * The full session check: structure, signature, expiry, and revocation.
 *
 * Revocation lives in PostgreSQL rather than a per-process Set, so a token
 * revoked by any worker is rejected by all of them. A failed revocation read
 * fails closed — treating an unreachable database as "not revoked" would turn a
 * database outage into a window where every logged-out token worked again.
 */
async function assertSessionActive(token) {
  const verification = verifySessionToken(token);
  if (!verification.valid) return verification;

  try {
    const revoked = await authSessionQueries.isTokenRevoked(verification.signature);
    if (revoked) {
      return { valid: false, error: AUTH_MESSAGES.SESSION_LOGGED_OUT };
    }
  } catch (err) {
    logger.error('Could not check whether the session token was revoked', err, 'AUTH_SERVICE');
    return { valid: false, error: AUTH_MESSAGES.SESSION_CHECK_UNAVAILABLE };
  }

  return { valid: true, user: verification.user };
}

/**
 * Revoke a session token so it no longer verifies, even before its natural
 * expiry (logout).
 */
async function revokeSessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [, payload, signature] = parts;

  let expiresAtSeconds = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.exp) expiresAtSeconds = claims.exp;
  } catch {
    // Keep the default expiry: an undecodable payload still gets revoked, it just
    // cannot tell us when the entry may be swept.
  }

  try {
    await authSessionQueries.revokeToken(signature, expiresAtSeconds * 1000);
  } catch (err) {
    logger.error('Failed to record session token revocation', err, 'AUTH_SERVICE');
    return false;
  }

  logger.info(`Session token revoked, expiring at ${expiresAtSeconds}`, {}, 'AUTH_SERVICE');
  return true;
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    orgName: user.orgName,
  };
}

/**
 * Authenticate with Email + registered Mobile + Password.
 *
 * Staged so the failure a visitor is shown names the thing that actually failed:
 *   1. the email + mobile pair must resolve to an account
 *   2. that account must be active and approved
 *   3. only then is the password compared
 *
 * Does not auto-create accounts.
 */
async function authenticateWithPassword(email, password, ipAddress, mobile) {
  if (!email || !password || !mobile) {
    throw new Error(AUTH_MESSAGES.EMAIL_MOBILE_PASSWORD_REQUIRED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const submittedMobile = String(mobile).trim();

  // Stage 1 — identity. Reported as a wrong pair rather than blamed on the
  // password, so a visitor who mistyped their mobile number is told exactly that
  // instead of doubting a password that was correct.
  const user = await loadIdentityUser(normalizedEmail, submittedMobile);
  if (!user) {
    logger.warn(
      `Sign-in blocked, no account for this email + mobile pair: ${normalizedEmail}`,
      { ipAddress },
      'AUTH_SERVICE'
    );
    throw new Error(AUTH_MESSAGES.INVALID_USERNAME_OR_MOBILE);
  }

  // Stage 2 — the active / approval gates, again ahead of the credential check.
  assertUserCanSignIn(user, normalizedEmail, ipAddress);

  // Stage 3 — the credential itself.
  if (!identityQueries.verifyStoredPassword(password, user.password)) {
    logger.warn(`Failed password authentication for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.INVALID_LOGIN_CREDENTIALS);
  }

  const token = generateSessionToken(user);
  logger.audit(`User logged in via Password: ${user.email} (${user.role})`, user.email, {
    role: user.role,
    ipAddress,
    mobileVerified: true,
  });
  storeService.addAuditLog({
    userEmail: user.email,
    action: `User authenticated via Email + Mobile + Password [Role: ${user.role}]`,
    ipAddress,
  });

  return {
    success: true,
    token,
    user: toPublicUser(user),
  };
}

/**
 * Change the password of the account the caller is signed in as.
 *
 * The session token proves who is asking, but not that they still know the
 * credential — a borrowed or forgotten-unlocked browser would otherwise be
 * enough to lock the real owner out. So the current password is re-verified
 * against a freshly loaded row on every attempt, and the account is located by
 * its primary key rather than by email, which is not unique in this schema.
 *
 * NOTE ON STORAGE: the new password is written in the same form as the existing
 * one, which is plaintext. That is not this endpoint's choice — sign-in compares
 * with identityQueries.verifyStoredPassword, a constant-time plaintext
 * comparison, because accounts carried over from the previous schema were stored
 * that way. Hashing here would lock every one of those accounts out at their next
 * sign-in. Introducing hashing needs a migration that makes login hash-aware
 * first; see the note in identityQueries.
 */
async function changePassword({ userUuid, email, currentPassword, newPassword, ipAddress }) {
  if (!currentPassword || !newPassword) {
    throw new Error(AUTH_MESSAGES.CHANGE_PASSWORD_FIELDS_REQUIRED);
  }
  if (String(newPassword).length < PASSWORD_MIN_LENGTH) {
    throw new Error(AUTH_MESSAGES.CHANGE_PASSWORD_TOO_SHORT);
  }
  if (currentPassword === newPassword) {
    throw new Error(AUTH_MESSAGES.CHANGE_PASSWORD_UNCHANGED);
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();

  // Read the row rather than trusting the token: the token carries no password,
  // and the account may have been deactivated since it was issued.
  const user = await loadIdentityUser(normalizedEmail);
  if (!user || (userUuid && user.id !== userUuid)) {
    logger.warn(
      `Password change blocked, account record not resolvable for ${normalizedEmail}`,
      { ipAddress },
      'AUTH_SERVICE'
    );
    throw new Error(AUTH_MESSAGES.CHANGE_PASSWORD_ACCOUNT_MISSING);
  }

  assertUserCanSignIn(user, normalizedEmail, ipAddress);

  if (!identityQueries.verifyStoredPassword(currentPassword, user.password)) {
    logger.warn(
      `Password change rejected, current password incorrect for ${normalizedEmail}`,
      { ipAddress },
      'AUTH_SERVICE'
    );
    throw new Error(AUTH_MESSAGES.CHANGE_PASSWORD_CURRENT_INCORRECT);
  }

  const written = await identityQueries.updateUserPasswordByUuid(user.id, newPassword, user.email);
  if (!written) {
    logger.error(
      'Password change matched no row, so the existing password still stands',
      new Error(AUTH_MESSAGES.CHANGE_PASSWORD_WRITE_FAILED),
      'AUTH_SERVICE'
    );
    throw new Error(AUTH_MESSAGES.CHANGE_PASSWORD_WRITE_FAILED);
  }

  logger.audit(`Password changed for ${user.email}`, user.email, { role: user.role, ipAddress });
  storeService.addAuditLog({
    userEmail: user.email,
    action: 'Account password changed by the account holder',
    ipAddress,
  });

  return { success: true, message: AUTH_MESSAGES.CHANGE_PASSWORD_SUCCESS };
}

/**
 * Generate and dispatch a 6-digit email OTP.
 *
 * The email + mobile pair is validated and the approval gates are applied first,
 * and only then is a code issued, stored and emailed. Only for an account that
 * already exists — use `register` to create one first.
 */
async function requestOtp(email, mobile, roleHint, ipAddress) {
  if (!email) {
    throw new Error(AUTH_MESSAGES.OTP_EMAIL_REQUIRED);
  }
  if (!mobile) {
    throw new Error(AUTH_MESSAGES.MOBILE_REQUIRED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const submittedMobile = String(mobile).trim();

  const user = await loadIdentityUser(normalizedEmail, submittedMobile);
  if (!user) {
    logger.warn(
      `OTP requested for an unrecognised email + mobile pair: ${normalizedEmail}`,
      { ipAddress },
      'AUTH_SERVICE'
    );
    throw new Error(AUTH_MESSAGES.INVALID_USERNAME_OR_MOBILE);
  }

  assertUserCanSignIn(user, normalizedEmail, ipAddress);

  const code = generateOtpCode();
  const expiresAt = Date.now() + OTP_EXPIRY_MS;

  try {
    await authSessionQueries.saveOtp(buildOtpKey(normalizedEmail, submittedMobile), code, expiresAt);
  } catch (err) {
    // Emailing a code that was never stored would guarantee the visitor's correct
    // entry is rejected, so the failure is reported instead.
    logger.error('Failed to store the issued OTP', err, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.OTP_STORAGE_FAILED);
  }

  // Fire-and-forget, but on Workers an unawaited promise can be cancelled the
  // instant the response is sent — same fix as storeService.js's _background
  // helper (see that file's comment for the full rationale). A no-op on
  // Node/Render, where the process just keeps running regardless.
  {
    const otpEmailSend = mailerService
      .sendOtpEmail(normalizedEmail, code, OTP_EXPIRY_MS / 1000)
      .catch((e) => logger.error('OTP email dispatch error', e, 'AUTH_SERVICE'));
    const waitUntil = getWaitUntil();
    if (waitUntil) waitUntil(otpEmailSend);
  }

  logger.info(`OTP generated for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
  storeService.addAuditLog({
    userEmail: normalizedEmail,
    action: `Instant ${OTP_LENGTH}-digit OTP dispatched to corporate email (${normalizedEmail})`,
    ipAddress,
  });

  return {
    success: true,
    message: `Verification OTP dispatched to ${normalizedEmail}`,
    email: normalizedEmail,
    // Only echoed back in tests or when SMTP isn't configured, so local/dev/test
    // runs without real email delivery can still complete the OTP flow; once
    // SMTP is live, the real code is never exposed in the API response.
    ...(process.env.NODE_ENV === 'test' || !mailerService.isConfigured() ? { demoCode: code } : {}),
    expiresInSeconds: OTP_EXPIRY_MS / 1000,
  };
}

/**
 * Verify a 6-digit email OTP and issue a session.
 *
 * No master or bypass codes — only the code actually issued via requestOtp, for
 * the same email + mobile pair, verifies. An expired entry is deleted on
 * inspection.
 */
async function verifyOtp(email, code, ipAddress, mobile) {
  if (!email || !code) {
    throw new Error(AUTH_MESSAGES.OTP_CODE_REQUIRED);
  }
  if (!mobile) {
    throw new Error(AUTH_MESSAGES.MOBILE_REQUIRED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const submittedMobile = String(mobile).trim();
  const otpKey = buildOtpKey(normalizedEmail, submittedMobile);

  const user = await loadIdentityUser(normalizedEmail, submittedMobile);
  const storedOtp = await authSessionQueries.findOtp(otpKey);

  if (storedOtp && Date.now() > storedOtp.expiresAt) {
    await authSessionQueries.deleteOtp(otpKey);
    logger.warn(`Expired OTP submitted for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.INVALID_OTP);
  }

  const isValidCode =
    !!user &&
    !!storedOtp &&
    storedOtp.code.length === String(code).length &&
    crypto.timingSafeEqual(Buffer.from(storedOtp.code), Buffer.from(String(code)));

  if (!isValidCode) {
    if (storedOtp) await authSessionQueries.incrementOtpAttempts(otpKey);
    logger.warn(`Invalid OTP submitted for ${normalizedEmail}`, { ipAddress }, 'AUTH_SERVICE');
    throw new Error(AUTH_MESSAGES.INVALID_OTP);
  }

  assertUserCanSignIn(user, normalizedEmail, ipAddress);

  // Single-use: consumed on successful verification.
  await authSessionQueries.deleteOtp(otpKey);

  const token = generateSessionToken(user);
  logger.audit(`User logged in via Instant OTP: ${user.email} (${user.role})`, user.email, { role: user.role, ipAddress });
  storeService.addAuditLog({
    userEmail: user.email,
    action: `User authenticated via Instant Email OTP [Role: ${user.role}]`,
    ipAddress,
  });

  return {
    success: true,
    token,
    user: toPublicUser(user),
  };
}

/**
 * Register a new user / enterprise entity. The only path that creates an account.
 */
async function registerUser(payload, ipAddress) {
  const { name, email, password, mobile, orgName, role } = payload;
  if (!email) throw new Error(AUTH_MESSAGES.REGISTRATION_EMAIL_REQUIRED);
  if (!password) throw new Error(AUTH_MESSAGES.EMAIL_PASSWORD_REQUIRED);
  if (!mobile) throw new Error(AUTH_MESSAGES.MOBILE_REQUIRED);

  if (!pool.hasStorage()) {
    throw new Error(AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const isVendor = role === 'vendor';
  const insertFn = isVendor ? identityQueries.insertVendorAccount : identityQueries.insertBuyerAccount;

  const result = await insertFn({
    email: normalizedEmail,
    password,
    phone: mobile,
    fullName: name,
    organizationName: orgName,
    companyName: orgName,
  });

  if (!result.created && !isVendor) {
    throw new Error(AUTH_MESSAGES.ACCOUNT_ALREADY_EXISTS);
  }

  const newUser = result.user;
  const token = generateSessionToken(newUser);
  logger.audit(`New enterprise account registered: ${newUser.email} (${newUser.role})`, newUser.email, { ipAddress });
  storeService.addAuditLog({
    userEmail: newUser.email,
    action: `New Enterprise User Registered [Role: ${newUser.role}, Org: ${newUser.orgName}]`,
    ipAddress,
  });

  return {
    success: true,
    message: AUTH_MESSAGES.REGISTRATION_SUCCESS,
    token,
    user: toPublicUser(newUser),
  };
}

/**
 * Get all registered users (for admin inspection).
 */
async function getAllUsers() {
  if (!pool.hasStorage()) {
    throw new Error(AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED);
  }
  const users = await identityQueries.listUsers();
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    orgId: u.orgId,
    orgName: u.orgName,
    mobile: u.mobile,
    status: u.status,
  }));
}

module.exports = {
  resolveAuthSecret,
  hashPassword,
  verifyPassword,
  loadIdentityUser,
  assertUserCanSignIn,
  buildOtpKey,
  generateSessionToken,
  verifySessionToken,
  assertSessionActive,
  revokeSessionToken,
  authenticateWithPassword,
  changePassword,
  requestOtp,
  verifyOtp,
  registerUser,
  getAllUsers,
  hydrateFromDB,
  SESSION_TTL_SECONDS,
};

Object.defineProperty(module.exports, 'AUTH_SECRET', {
  get() {
    return resolveAuthSecret();
  },
  enumerable: true,
  configurable: true,
});
