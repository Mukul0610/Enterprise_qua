const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const vendorPresenceService = require('../src/services/vendorPresenceService');

function vendorAuthHeader(email = 'testvendor@example.com') {
  const token = authService.generateSessionToken({
    id: 'usr-vendor-123',
    email,
    name: 'Test Vendor',
    role: 'vendor',
    orgId: 'org-vendor-123',
    orgName: 'Test Vendor Corp',
  });
  return { Authorization: `Bearer ${token}` };
}

describe('Vendor Presence & Heartbeat API Routes', () => {
  beforeEach(() => {
    vendorPresenceService.resetAll();
  });

  afterEach(() => {
    vendorPresenceService.resetAll();
  });

  describe('POST /api/vendors/heartbeat', () => {
    it('records heartbeat with authenticated user email if identifier is omitted', async () => {
      const res = await request(app)
        .post('/api/vendors/heartbeat')
        .set(vendorAuthHeader('auto@vendor.com'))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.identifier).toBe('auto@vendor.com');
      expect(res.body.isOnline).toBe(true);
    });

    it('records explicit identifier and status', async () => {
      const res = await request(app)
        .post('/api/vendors/heartbeat')
        .send({ identifier: 'manual@vendor.com', status: 'offline' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.identifier).toBe('manual@vendor.com');
      expect(res.body.isOnline).toBe(false);
    });

    it('rejects invalid heartbeat payload', async () => {
      const res = await request(app)
        .post('/api/vendors/heartbeat')
        .send({ status: 'invalid-status' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects heartbeat when no identifier and unauthenticated', async () => {
      const res = await request(app)
        .post('/api/vendors/heartbeat')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Identifier is required');
    });
  });

  describe('GET /api/vendors/presence', () => {
    it('returns empty list when no vendors are online', async () => {
      const res = await request(app).get('/api/vendors/presence');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.onlineVendors).toEqual([]);
    });

    it('returns online vendors and details', async () => {
      vendorPresenceService.recordHeartbeat({ identifier: 'v1@vendor.com' });
      vendorPresenceService.recordHeartbeat({ identifier: 'v2@vendor.com', status: 'offline' });

      const res = await request(app).get('/api/vendors/presence');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.onlineVendors).toContain('v1@vendor.com');
      expect(res.body.onlineVendors).not.toContain('v2@vendor.com');
      expect(res.body.details['v1@vendor.com'].isOnline).toBe(true);
    });

    it('filters presence by requested identifiers query parameter', async () => {
      vendorPresenceService.recordHeartbeat({ identifier: 'v1@vendor.com' });

      const res = await request(app)
        .get('/api/vendors/presence?identifiers=v1@vendor.com,unknown@vendor.com');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.onlineVendors).toEqual(['v1@vendor.com']);
      expect(res.body.details['v1@vendor.com'].isOnline).toBe(true);
      expect(res.body.details['unknown@vendor.com'].isOnline).toBe(false);
    });
  });
});
