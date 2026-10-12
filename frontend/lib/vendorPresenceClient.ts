import type { VendorPresenceResponse } from './types';
import { authClient } from './authClient';
import { logger } from './logger';

/**
 * Fetches the real-time online/offline presence for given vendors, or all active vendors.
 */
export async function getVendorPresence(identifiers?: string[]): Promise<VendorPresenceResponse> {
  try {
    const token = authClient.getToken();
    const query =
      Array.isArray(identifiers) && identifiers.length > 0
        ? `?identifiers=${encodeURIComponent(identifiers.join(','))}`
        : '';

    const res = await fetch(`/api/vendors/presence${query}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data: VendorPresenceResponse = await res.json();
    return data;
  } catch (err: unknown) {
    logger.warn('Failed to fetch vendor presence, defaulting to offline list', { error: err });
    return {
      success: false,
      onlineVendors: [],
      details: {},
    };
  }
}

/**
 * Sends a vendor presence heartbeat to the server.
 */
export async function sendVendorHeartbeat(data?: {
  identifier?: string;
  status?: 'online' | 'offline';
}): Promise<{ success: boolean; identifier?: string; isOnline?: boolean }> {
  try {
    const token = authClient.getToken();

    const res = await fetch('/api/vendors/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data || {}),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    return json;
  } catch (err: unknown) {
    logger.warn('Failed to send vendor heartbeat', { error: err });
    return { success: false };
  }
}
