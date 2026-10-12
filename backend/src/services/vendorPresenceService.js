const { logger } = require('./loggerService');
const { PRESENCE_ONLINE_THRESHOLD_MS } = require('../config/constants');

/**
 * In-memory vendor presence store.
 * Stores { identifier: string, lastActive: number, role?: string, vendorId?: string, status: 'online' | 'offline' }
 */
const presenceStore = new Map();

/**
 * Normalizes identifier string for consistent lookups.
 * @param {string} id
 * @returns {string}
 */
function normalizeIdentifier(id) {
  if (!id || typeof id !== 'string') return '';
  return id.trim().toLowerCase();
}

/**
 * Records or updates a vendor's heartbeat/activity.
 * @param {Object} options
 * @param {string} options.identifier - Vendor email, id, or username
 * @param {string} [options.role] - User role
 * @param {string} [options.vendorId] - Associated vendor ID
 * @param {'online'|'offline'} [options.status='online'] - Presence status
 * @param {number} [options.timestamp=Date.now()] - Activity timestamp
 * @returns {Object}
 */
function recordHeartbeat({ identifier, role = 'vendor', vendorId, status = 'online', timestamp = Date.now() }) {
  const norm = normalizeIdentifier(identifier);
  if (!norm) {
    logger.warn('recordHeartbeat called without valid identifier', { identifier }, 'VENDOR_PRESENCE');
    return { success: false, error: 'Identifier is required.' };
  }

  const entry = {
    identifier: norm,
    role,
    vendorId: vendorId || norm,
    status: status === 'offline' ? 'offline' : 'online',
    lastActive: Number(timestamp) || Date.now(),
  };

  presenceStore.set(norm, entry);
  logger.info(
    'Vendor presence heartbeat recorded',
    { identifier: norm, status: entry.status, lastActive: entry.lastActive },
    'VENDOR_PRESENCE'
  );

  return {
    success: true,
    identifier: norm,
    isOnline: entry.status === 'online',
    lastActive: new Date(entry.lastActive).toISOString(),
  };
}

/**
 * Checks if a specific vendor is online.
 * @param {string} identifier
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
function isVendorOnline(identifier, now = Date.now()) {
  const norm = normalizeIdentifier(identifier);
  if (!norm) return false;

  const entry = presenceStore.get(norm);
  if (!entry) return false;

  if (entry.status === 'offline') return false;

  const elapsed = now - entry.lastActive;
  return elapsed >= 0 && elapsed <= PRESENCE_ONLINE_THRESHOLD_MS;
}

/**
 * Gets presence state for given identifiers or all online vendors.
 * @param {string[]|string} [identifiers]
 * @param {number} [now=Date.now()]
 * @returns {Object}
 */
function getPresence(identifiers, now = Date.now()) {
  let targetList = [];

  if (Array.isArray(identifiers)) {
    targetList = identifiers;
  } else if (typeof identifiers === 'string' && identifiers.trim()) {
    targetList = identifiers.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const onlineVendors = [];
  const details = {};

  if (targetList.length > 0) {
    for (const rawId of targetList) {
      const norm = normalizeIdentifier(rawId);
      if (!norm) continue;

      const online = isVendorOnline(norm, now);
      if (online) {
        onlineVendors.push(norm);
      }

      const existing = presenceStore.get(norm);
      details[norm] = {
        isOnline: online,
        lastActive: existing ? new Date(existing.lastActive).toISOString() : undefined,
      };
    }
  } else {
    for (const [norm, entry] of presenceStore.entries()) {
      const online = isVendorOnline(norm, now);
      if (online) {
        onlineVendors.push(norm);
      }
      details[norm] = {
        isOnline: online,
        lastActive: new Date(entry.lastActive).toISOString(),
      };
    }
  }

  return {
    success: true,
    thresholdMinutes: Math.round(PRESENCE_ONLINE_THRESHOLD_MS / (60 * 1000)),
    onlineVendors,
    details,
  };
}

/**
 * Clears or marks a vendor as offline.
 * @param {string} identifier
 */
function clearPresence(identifier) {
  const norm = normalizeIdentifier(identifier);
  if (!norm) return false;
  return presenceStore.delete(norm);
}

/**
 * Clears all presence records (used in test tearDown).
 */
function resetAll() {
  presenceStore.clear();
}

/**
 * Sweeps expired offline entries older than 24 hours.
 * @param {number} [now=Date.now()]
 */
function sweepExpired(now = Date.now()) {
  const maxAge = 24 * 60 * 60 * 1000;
  for (const [norm, entry] of presenceStore.entries()) {
    if (now - entry.lastActive > maxAge) {
      presenceStore.delete(norm);
    }
  }
}

module.exports = {
  recordHeartbeat,
  isVendorOnline,
  getPresence,
  clearPresence,
  resetAll,
  sweepExpired,
};
