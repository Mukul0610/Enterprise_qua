const authService = require('../services/authService');
const { logger } = require('../services/loggerService');
const { VALIDATION_SCHEMAS, validatePayload, AUTH_MESSAGES } = require('../config/constants');
const { extractToken } = require('../middleware/auth');

function getClientIp(req) {
  return req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1';
}

async function login(req, res, next) {
  try {
    const { email, password, code, mobile } = req.body || {};
    const ipAddress = getClientIp(req);

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.login, { email, password, code, mobile });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }

    if (code) {
      const result = await authService.verifyOtp(email, code, ipAddress, mobile);
      return res.json(result);
    }

    if (password) {
      const result = await authService.authenticateWithPassword(email, password, ipAddress, mobile);
      return res.json(result);
    }

    return res.status(400).json({ success: false, error: AUTH_MESSAGES.PASSWORD_OR_CODE_REQUIRED });
  } catch (err) {
    logger.warn(
      'Login failure in authController',
      { error: err.message, email: req.body?.email, hasPassword: Boolean(req.body?.password), hasCode: Boolean(req.body?.code) },
      'AUTH_CONTROLLER'
    );
    return res.status(401).json({ success: false, error: err.message || AUTH_MESSAGES.AUTH_FAILED_FALLBACK });
  }
}

async function requestOtp(req, res, next) {
  try {
    const { email, mobile, roleHint, isRegistration } = req.body || {};
    const ipAddress = getClientIp(req);

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.requestOtp, { email, mobile, roleHint, isRegistration });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }

    const result = await authService.requestOtp(email, mobile, roleHint, ipAddress, isRegistration);
    res.json(result);
  } catch (err) {
    logger.warn('OTP request failed in authController', { error: err.message, email: req.body?.email }, 'AUTH_CONTROLLER');
    return res.status(400).json({ success: false, error: err.message || AUTH_MESSAGES.OTP_REQUEST_EMAIL_REQUIRED });
  }
}

async function verifyOtp(req, res, next) {
  try {
    const { email, code, mobile } = req.body || {};
    const ipAddress = getClientIp(req);

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.verifyOtp, { email, code, mobile });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }

    const result = await authService.verifyOtp(email, code, ipAddress, mobile);
    res.json(result);
  } catch (err) {
    logger.warn('OTP verification failed in authController', { error: err.message, email: req.body?.email }, 'AUTH_CONTROLLER');
    return res.status(400).json({ success: false, error: err.message || AUTH_MESSAGES.INVALID_OTP_FALLBACK });
  }
}

async function register(req, res, next) {
  try {
    const { name, email, password, mobile, role, orgName, emailOtp, mobileOtp, code } = req.body || {};
    const ipAddress = getClientIp(req);

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.register, { name, email, password, mobile, role, orgName, emailOtp, mobileOtp, code });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }

    const result = await authService.registerUser({ name, email, password, mobile, role, orgName, emailOtp, mobileOtp, code }, ipAddress);
    res.status(201).json(result);
  } catch (err) {
    logger.warn(
      'Registration failed in authController',
      { error: err.message, email: req.body?.email },
      'AUTH_CONTROLLER'
    );
    return res.status(400).json({ success: false, error: err.message || AUTH_MESSAGES.AUTH_FAILED_FALLBACK });
  }
}

async function getSession(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
    }

    const verification = await authService.assertSessionActive(token);
    if (!verification.valid) {
      return res.status(401).json({ success: false, error: verification.error || AUTH_MESSAGES.INVALID_SESSION_FALLBACK });
    }

    res.json({
      success: true,
      user: verification.user,
    });
  } catch (err) {
    logger.error('Error fetching session', err, 'AUTH_CONTROLLER');
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const userEmail = (req.body && req.body.email) || 'authenticated-user';
    const ipAddress = getClientIp(req);
    const token = extractToken(req);
    if (token) {
      // Awaited: the revocation is a database write now, and answering "logged
      // out" before it lands would let the very next request through.
      const revoked = await authService.revokeSessionToken(token);
      if (!revoked) {
        logger.warn(
          'Logout could not record the token revocation, so the session may remain valid until it expires',
          { userEmail, ipAddress },
          'AUTH_CONTROLLER'
        );
        return res.status(503).json({ success: false, error: AUTH_MESSAGES.LOGOUT_REVOCATION_FAILED });
      }
    }
    logger.audit(`User logged out: ${userEmail}`, userEmail, { ipAddress });
    return res.json({ success: true, message: AUTH_MESSAGES.LOGOUT_SUCCESS });
  } catch (err) {
    logger.error('Error logging out', err, 'AUTH_CONTROLLER');
    return next(err);
  }
}

/**
 * Change the signed-in account's own password.
 *
 * Runs behind `authenticate`, so the target account comes from the verified
 * session claims and never from the request body — a caller cannot nominate
 * somebody else's account to change.
 */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const ipAddress = getClientIp(req);

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.changePassword, {
      currentPassword,
      newPassword,
    });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }

    const result = await authService.changePassword({
      userUuid: req.user?.sub,
      email: req.user?.email,
      currentPassword,
      newPassword,
      ipAddress,
    });
    return res.json(result);
  } catch (err) {
    logger.warn(
      'Password change failed in authController',
      { error: err.message, email: req.user?.email },
      'AUTH_CONTROLLER'
    );
    return res.status(400).json({
      success: false,
      error: err.message || AUTH_MESSAGES.CHANGE_PASSWORD_WRITE_FAILED,
    });
  }
}

async function listUsers(req, res, next) {
  try {
    const users = await authService.getAllUsers();
    res.json({ success: true, count: users.length, data: users });
  } catch (err) {
    logger.error('Error listing users', err, 'AUTH_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getClientIp,
  extractToken,
  login,
  requestOtp,
  verifyOtp,
  register,
  getSession,
  logout,
  changePassword,
  listUsers,
};
