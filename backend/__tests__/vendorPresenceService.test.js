const vendorPresenceService = require('../src/services/vendorPresenceService');
const { PRESENCE_ONLINE_THRESHOLD_MS } = require('../src/config/constants');

describe('vendorPresenceService', () => {
  beforeEach(() => {
    vendorPresenceService.resetAll();
  });

  afterEach(() => {
    vendorPresenceService.resetAll();
  });

  describe('recordHeartbeat', () => {
    it('returns error if identifier is missing or invalid', () => {
      const res1 = vendorPresenceService.recordHeartbeat({ identifier: '' });
      expect(res1.success).toBe(false);
      expect(res1.error).toContain('Identifier is required');

      const res2 = vendorPresenceService.recordHeartbeat({ identifier: null });
      expect(res2.success).toBe(false);
    });

    it('records valid heartbeat with default online status', () => {
      const now = Date.now();
      const res = vendorPresenceService.recordHeartbeat({
        identifier: 'Vendor@Example.Com ',
        role: 'vendor',
        timestamp: now,
      });

      expect(res.success).toBe(true);
      expect(res.identifier).toBe('vendor@example.com');
      expect(res.isOnline).toBe(true);
      expect(new Date(res.lastActive).getTime()).toBe(now);
      expect(vendorPresenceService.isVendorOnline('vendor@example.com', now)).toBe(true);
    });

    it('records explicit offline status', () => {
      const now = Date.now();
      const res = vendorPresenceService.recordHeartbeat({
        identifier: 'vendor2@example.com',
        status: 'offline',
        timestamp: now,
      });

      expect(res.success).toBe(true);
      expect(res.isOnline).toBe(false);
      expect(vendorPresenceService.isVendorOnline('vendor2@example.com', now)).toBe(false);
    });
  });

  describe('isVendorOnline', () => {
    it('returns false for unknown or invalid identifier', () => {
      expect(vendorPresenceService.isVendorOnline('')).toBe(false);
      expect(vendorPresenceService.isVendorOnline(null)).toBe(false);
      expect(vendorPresenceService.isVendorOnline('nonexistent@vendor.com')).toBe(false);
    });

    it('returns true if within threshold and false once threshold exceeded', () => {
      const baseTime = 1000000000;
      vendorPresenceService.recordHeartbeat({
        identifier: 'active@vendor.com',
        timestamp: baseTime,
      });

      // Exactly at baseTime
      expect(vendorPresenceService.isVendorOnline('active@vendor.com', baseTime)).toBe(true);

      // Within 10 minutes (e.g. 5 minutes later)
      expect(vendorPresenceService.isVendorOnline('active@vendor.com', baseTime + 5 * 60 * 1000)).toBe(true);

      // At boundary of 10 minutes
      expect(
        vendorPresenceService.isVendorOnline('active@vendor.com', baseTime + PRESENCE_ONLINE_THRESHOLD_MS)
      ).toBe(true);

      // Past 10 minutes (10 minutes + 1 ms)
      expect(
        vendorPresenceService.isVendorOnline('active@vendor.com', baseTime + PRESENCE_ONLINE_THRESHOLD_MS + 1)
      ).toBe(false);
    });
  });

  describe('getPresence', () => {
    it('returns all online vendors when no target identifiers are supplied', () => {
      const now = 2000000000;
      vendorPresenceService.recordHeartbeat({
        identifier: 'v1@vendor.com',
        timestamp: now,
      });
      vendorPresenceService.recordHeartbeat({
        identifier: 'v2@vendor.com',
        timestamp: now - PRESENCE_ONLINE_THRESHOLD_MS - 5000, // expired
      });
      vendorPresenceService.recordHeartbeat({
        identifier: 'v3@vendor.com',
        status: 'offline',
        timestamp: now,
      });

      const res = vendorPresenceService.getPresence(undefined, now);
      expect(res.success).toBe(true);
      expect(res.onlineVendors).toEqual(['v1@vendor.com']);
      expect(res.details['v1@vendor.com'].isOnline).toBe(true);
      expect(res.details['v2@vendor.com'].isOnline).toBe(false);
      expect(res.details['v3@vendor.com'].isOnline).toBe(false);
    });

    it('returns status for specific identifiers requested via array or comma-separated string', () => {
      const now = 2000000000;
      vendorPresenceService.recordHeartbeat({
        identifier: 'v1@vendor.com',
        timestamp: now,
      });

      // Using array
      const resArr = vendorPresenceService.getPresence(['v1@vendor.com', 'missing@vendor.com'], now);
      expect(resArr.onlineVendors).toContain('v1@vendor.com');
      expect(resArr.details['v1@vendor.com'].isOnline).toBe(true);
      expect(resArr.details['missing@vendor.com'].isOnline).toBe(false);

      // Using comma string
      const resStr = vendorPresenceService.getPresence('v1@vendor.com, missing@vendor.com', now);
      expect(resStr.onlineVendors).toContain('v1@vendor.com');
      expect(resStr.details['missing@vendor.com'].isOnline).toBe(false);
    });
  });

  describe('clearPresence & sweepExpired', () => {
    it('removes entry when clearPresence is called', () => {
      vendorPresenceService.recordHeartbeat({ identifier: 'v1@vendor.com' });
      expect(vendorPresenceService.isVendorOnline('v1@vendor.com')).toBe(true);

      vendorPresenceService.clearPresence('v1@vendor.com');
      expect(vendorPresenceService.isVendorOnline('v1@vendor.com')).toBe(false);
      expect(vendorPresenceService.clearPresence('')).toBe(false);
    });

    it('sweeps entries older than 24 hours', () => {
      const now = 5000000000;
      const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;
      const oneHourAgo = now - 1 * 60 * 60 * 1000;

      vendorPresenceService.recordHeartbeat({
        identifier: 'stale@vendor.com',
        timestamp: twentyFiveHoursAgo,
      });
      vendorPresenceService.recordHeartbeat({
        identifier: 'fresh@vendor.com',
        timestamp: oneHourAgo,
      });

      vendorPresenceService.sweepExpired(now);

      const check = vendorPresenceService.getPresence(undefined, now);
      expect(check.details['stale@vendor.com']).toBeUndefined();
      expect(check.details['fresh@vendor.com']).toBeDefined();
    });
  });
});
