import { getVendorPresence, sendVendorHeartbeat } from '@/lib/vendorPresenceClient';
import { authClient } from '@/lib/authClient';

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    audit: jest.fn(),
    log: jest.fn(),
  },
}));

describe('vendorPresenceClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('mock-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getVendorPresence', () => {
    it('fetches presence with query parameters and auth header', async () => {
      const mockResponse = {
        success: true,
        thresholdMinutes: 10,
        onlineVendors: ['v1@vendor.com'],
        details: {
          'v1@vendor.com': { isOnline: true },
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const res = await getVendorPresence(['v1@vendor.com', 'v2@vendor.com']);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/vendors/presence?identifiers=v1%40vendor.com%2Cv2%40vendor.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
          }),
        })
      );
      expect(res).toEqual(mockResponse);
    });

    it('fetches all online vendors when no identifiers array is provided', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, onlineVendors: [] }),
      } as Response);

      jest.spyOn(authClient, 'getToken').mockReturnValue(null);

      const res = await getVendorPresence();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.not.stringContaining('?identifiers='),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        })
      );
      expect(res.success).toBe(true);
    });

    it('gracefully handles HTTP error and returns default offline response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const res = await getVendorPresence(['v1@vendor.com']);
      expect(res.success).toBe(false);
      expect(res.onlineVendors).toEqual([]);
      expect(res.details).toEqual({});
    });

    it('gracefully handles network exception and returns default response', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const res = await getVendorPresence(['v1@vendor.com']);
      expect(res.success).toBe(false);
      expect(res.onlineVendors).toEqual([]);
      expect(res.details).toEqual({});
    });
  });

  describe('sendVendorHeartbeat', () => {
    it('posts heartbeat payload with authorization header', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, identifier: 'v1@vendor.com', isOnline: true }),
      } as Response);

      const res = await sendVendorHeartbeat({ identifier: 'v1@vendor.com', status: 'online' });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/vendors/heartbeat'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ identifier: 'v1@vendor.com', status: 'online' }),
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
          }),
        })
      );
      expect(res.success).toBe(true);
    });

    it('handles empty data argument without auth token', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const res = await sendVendorHeartbeat();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/vendors/heartbeat'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        })
      );
      expect(res.success).toBe(true);
    });

    it('returns success: false on HTTP error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
      } as Response);

      const res = await sendVendorHeartbeat({ identifier: 'bad' });
      expect(res.success).toBe(false);
    });

    it('returns success: false on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network fail'));

      const res = await sendVendorHeartbeat({ identifier: 'bad' });
      expect(res.success).toBe(false);
    });
  });
});
