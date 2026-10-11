// ==============================================================================
// AUTH SESSION QUERIES (PostgreSQL / Cloudflare D1 / Dev Memory Fallback)
// ==============================================================================
// Issued OTP codes and revoked session tokens.
// ==============================================================================

const pool = require('./pool');

const memoryOtpStore = new Map();
const memoryRevokedTokens = new Set();

// ── OTP codes ────────────────────────────────────────────────────────────────

/**
 * Store (or replace) the OTP issued for an email + mobile pair.
 */
async function saveOtp(otpKey, code, expiresAt) {
  try {
    await pool.query(
      `insert into auth_otp_codes (otp_key, code, attempts, expires_at, created_at)
       values ($1, $2, 0, $3, CURRENT_TIMESTAMP)
       on conflict (otp_key) do update set
         code = excluded.code,
         attempts = 0,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`,
      [otpKey, code, new Date(expiresAt).toISOString()],
      { d1: true }
    );
  } catch (err) {
    memoryOtpStore.set(otpKey, {
      otpKey,
      code,
      attempts: 0,
      expiresAt: new Date(expiresAt).getTime(),
    });
  }
}

/**
 * Read the OTP stored against a key, or null when there is none.
 */
async function findOtp(otpKey) {
  try {
    const rows = await pool.rows(
      'select otp_key, code, attempts, expires_at from auth_otp_codes where otp_key = $1',
      [otpKey],
      { d1: true }
    );
    if (rows.length === 0) {
      if (memoryOtpStore.has(otpKey)) {
        return { ...memoryOtpStore.get(otpKey) };
      }
      return null;
    }
    const row = rows[0];
    return {
      otpKey: row.otp_key,
      code: row.code,
      attempts: Number(row.attempts || 0),
      expiresAt: new Date(row.expires_at).getTime(),
    };
  } catch (err) {
    const entry = memoryOtpStore.get(otpKey);
    return entry ? { ...entry } : null;
  }
}

/** Delete an OTP: on successful verification, or once found expired. */
async function deleteOtp(otpKey) {
  try {
    const result = await pool.query(
      'delete from auth_otp_codes where otp_key = $1',
      [otpKey],
      { d1: true }
    );
    memoryOtpStore.delete(otpKey);
    return (result.rowCount || 0) > 0;
  } catch (err) {
    return memoryOtpStore.delete(otpKey);
  }
}

/**
 * Record a failed attempt against a stored code.
 */
async function incrementOtpAttempts(otpKey) {
  try {
    const result = await pool.query(
      'update auth_otp_codes set attempts = attempts + 1 where otp_key = $1 returning attempts',
      [otpKey],
      { d1: true }
    );
    return result.rows[0] ? Number(result.rows[0].attempts) : 0;
  } catch (err) {
    const entry = memoryOtpStore.get(otpKey);
    if (!entry) return 0;
    entry.attempts = (entry.attempts || 0) + 1;
    return entry.attempts;
  }
}

// ── Revoked session tokens ──────────────────────────────────────────────────

/**
 * Mark a token's signature as revoked until the token would have expired anyway.
 */
async function revokeToken(signature, expiresAt) {
  try {
    await pool.query(
      `insert into auth_revoked_tokens (signature, expires_at, revoked_at)
       values ($1, $2, CURRENT_TIMESTAMP)
       on conflict (signature) do nothing`,
      [signature, new Date(expiresAt).toISOString()],
      { d1: true }
    );
  } catch (err) {
    memoryRevokedTokens.add(signature);
  }
}

/** Whether this token signature has been revoked. */
async function isTokenRevoked(signature) {
  if (memoryRevokedTokens.has(signature)) return true;
  const rows = await pool.rows(
    'select 1 from auth_revoked_tokens where signature = $1 limit 1',
    [signature],
    { d1: true }
  );
  return rows.length > 0;
}

/**
 * Drop expired OTPs and revoked-token records.
 */
async function purgeExpiredAuthState() {
  const otps = await pool.query('delete from auth_otp_codes where expires_at < now()');
  const tokens = await pool.query('delete from auth_revoked_tokens where expires_at < now()');
  return {
    otpsPurged: otps.rowCount || 0,
    revokedTokensPurged: tokens.rowCount || 0,
  };
}

module.exports = {
  saveOtp,
  findOtp,
  deleteOtp,
  incrementOtpAttempts,
  revokeToken,
  isTokenRevoked,
  purgeExpiredAuthState,
};
