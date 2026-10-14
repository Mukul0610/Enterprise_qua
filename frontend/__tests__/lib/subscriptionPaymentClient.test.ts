import { createPaymentLink, createBuyerPaymentLink, getVendorPaymentLinkStatus, getBuyerPaymentLinkStatus } from '@/lib/subscriptionPaymentClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

describe('subscriptionPaymentClient.createPaymentLink', () => {
  const originalFetch = global.fetch;

  const reply = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

  const unreadable = (status: number) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        throw new Error('not json');
      },
    });

  const signIn = () =>
    authClient.setSession({ id: 'u1', email: 'v@x.com', name: 'V', role: 'vendor', orgId: 'o1', orgName: 'O' }, 'jwt-token');

  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the plan and returns the redirect URL', async () => {
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/x', paymentLinkId: 'pl-1', status: 'CREATED' } });

    const res = await createPaymentLink('v-1', 'connect');

    expect(res).toEqual({ success: true, paymentUrl: 'https://payments.zoho.in/x', paymentLinkId: 'pl-1', status: 'CREATED' });
    expect(lastPath()).toBe('/api/vendors/v-1/payment-link');
    expect(lastInit().method).toBe('POST');
    expect(JSON.parse(lastInit().body)).toEqual({ plan: 'connect' });
  });

  test('defaults paymentLinkId/status to empty strings when the server omits them', async () => {
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/x' } });

    const res = await createPaymentLink('v-1', 'connect');

    expect(res.success && res.paymentLinkId).toBe('');
    expect(res.success && res.status).toBe('');
  });

  test('attaches the session token when one is held', async () => {
    signIn();
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/x' } });

    await createPaymentLink('v-1', 'select');

    expect(lastInit().headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer jwt-token' });
  });

  test('sends no Authorization header when there is no session', async () => {
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/x' } });

    await createPaymentLink('v-1', 'select');

    expect(lastInit().headers).toEqual({ 'Content-Type': 'application/json' });
  });

  test('reports an unreachable API', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await createPaymentLink('v-1', 'connect');

    expect(res).toEqual({ success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable });
  });

  test('names the status when the reply cannot be read', async () => {
    global.fetch = unreadable(500);

    const res = await createPaymentLink('v-1', 'connect');

    expect(res.success === false && res.error).toBe(formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 }));
  });

  test('reports UNAUTHORIZED on a 403', async () => {
    global.fetch = reply(403, { error: 'Forbidden.' });

    const res = await createPaymentLink('v-1', 'connect');

    expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Forbidden.' });
  });

  test('falls back to the session message on an unexplained 401', async () => {
    global.fetch = reply(401, {});

    const res = await createPaymentLink('v-1', 'connect');

    expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
  });

  test('reports VALIDATION on a 400 (e.g. an unpayable plan)', async () => {
    global.fetch = reply(400, { error: 'plan must be one of: connect, select.' });

    const res = await createPaymentLink('v-1', 'premium');

    expect(res).toEqual({ success: false, reason: 'VALIDATION', error: 'plan must be one of: connect, select.' });
  });

  test('reports SERVER on a 404 for an unknown vendor', async () => {
    global.fetch = reply(404, { error: 'Vendor not found.' });

    const res = await createPaymentLink('does-not-exist', 'connect');

    expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Vendor not found.' });
  });

  test('reports SERVER when the body carries no paymentUrl', async () => {
    global.fetch = reply(200, { success: true, data: {} });

    const res = await createPaymentLink('v-1', 'connect');

    expect(res.success === false && res.reason).toBe('SERVER');
  });
});

describe('subscriptionPaymentClient.createBuyerPaymentLink', () => {
  const originalFetch = global.fetch;

  const reply = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

  const unreadable = (status: number) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        throw new Error('not json');
      },
    });

  const signIn = () =>
    authClient.setSession({ id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' }, 'jwt-token');

  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the plan to the buyer-accounts endpoint and returns the redirect URL', async () => {
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/buyer', paymentLinkId: 'pl-b1', status: 'CREATED' } });

    const res = await createBuyerPaymentLink('buyer-1', 'version_2');

    expect(res).toEqual({ success: true, paymentUrl: 'https://payments.zoho.in/buyer', paymentLinkId: 'pl-b1', status: 'CREATED' });
    expect(lastPath()).toBe('/api/buyer-accounts/buyer-1/subscription-payment');
    expect(JSON.parse(lastInit().body)).toEqual({ plan: 'version_2', billingDuration: '12_months' });
  });

  test('passes custom billingDuration (e.g. 6_months) in request body', async () => {
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/buyer-6m', paymentLinkId: 'pl-b-6m', status: 'CREATED' } });

    const res = await createBuyerPaymentLink('buyer-1', 'version_2', '6_months');

    expect(res.success).toBe(true);
    expect(JSON.parse(lastInit().body)).toEqual({ plan: 'version_2', billingDuration: '6_months' });
  });

  test('attaches the session token when one is held', async () => {
    signIn();
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/buyer' } });

    await createBuyerPaymentLink('buyer-1', 'version_1');

    expect(lastInit().headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer jwt-token' });
  });

  test('sends no Authorization header when there is no session', async () => {
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/buyer' } });

    await createBuyerPaymentLink('buyer-1', 'version_1');

    expect(lastInit().headers).toEqual({ 'Content-Type': 'application/json' });
  });

  test('reports an unreachable API', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await createBuyerPaymentLink('buyer-1', 'version_1');

    expect(res).toEqual({ success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable });
  });

  test('names the status when the reply cannot be read', async () => {
    global.fetch = unreadable(500);

    const res = await createBuyerPaymentLink('buyer-1', 'version_1');

    expect(res.success === false && res.error).toBe(formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 }));
  });

  test('reports UNAUTHORIZED on a 403', async () => {
    global.fetch = reply(403, { error: 'Forbidden.' });

    const res = await createBuyerPaymentLink('buyer-1', 'version_1');

    expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Forbidden.' });
  });

  test('falls back to the session message on an unexplained 401', async () => {
    global.fetch = reply(401, {});

    const res = await createBuyerPaymentLink('buyer-1', 'version_1');

    expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
  });

  test('reports VALIDATION on a 400 (e.g. free_trial)', async () => {
    global.fetch = reply(400, { error: 'plan must be one of: version_1, version_2, version_3.' });

    const res = await createBuyerPaymentLink('buyer-1', 'free_trial');

    expect(res).toEqual({ success: false, reason: 'VALIDATION', error: 'plan must be one of: version_1, version_2, version_3.' });
  });

  test('reports SERVER on a 404 for an unknown buyer account', async () => {
    global.fetch = reply(404, { error: 'Buyer account not found.' });

    const res = await createBuyerPaymentLink('does-not-exist', 'version_1');

    expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Buyer account not found.' });
  });

  test('reports a server fault when the body carries no paymentUrl', async () => {
    global.fetch = reply(200, { success: true, data: {} });

    const res = await createBuyerPaymentLink('buyer-1', 'version_1');

    expect(res.success === false && res.reason).toBe('SERVER');
  });
});

describe('subscriptionPaymentClient.getVendorPaymentLinkStatus / getBuyerPaymentLinkStatus', () => {
  const originalFetch = global.fetch;
  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('getVendorPaymentLinkStatus returns the matching link\'s status', async () => {
    authClient.setSession({ id: 'u1', email: 'v@x.com', name: 'V', role: 'vendor', orgId: 'o1', orgName: 'O' }, 'jwt-token');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'pl-1', status: 'PAID' }, { id: 'pl-2', status: 'CREATED' }] }),
    });

    const status = await getVendorPaymentLinkStatus('v-1', 'pl-1');

    expect(status).toBe('PAID');
    expect(lastPath()).toBe('/api/vendors/v-1/payment-links');
    expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
  });

  test('getVendorPaymentLinkStatus sends no Authorization header when there is no session', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) });

    await getVendorPaymentLinkStatus('v-1', 'pl-1');

    expect(lastInit().headers).toEqual({});
  });

  test('getVendorPaymentLinkStatus returns null when the link id is not in the list', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [{ id: 'pl-other', status: 'PAID' }] }) });

    expect(await getVendorPaymentLinkStatus('v-1', 'pl-1')).toBeNull();
  });

  test('getVendorPaymentLinkStatus returns null on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false }) });

    expect(await getVendorPaymentLinkStatus('v-1', 'pl-1')).toBeNull();
  });

  test('getVendorPaymentLinkStatus returns null when data is not an array', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: null }) });

    expect(await getVendorPaymentLinkStatus('v-1', 'pl-1')).toBeNull();
  });

  test('getVendorPaymentLinkStatus returns null when the response body cannot be parsed', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } });

    expect(await getVendorPaymentLinkStatus('v-1', 'pl-1')).toBeNull();
  });

  test('getVendorPaymentLinkStatus returns null when the network call throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    expect(await getVendorPaymentLinkStatus('v-1', 'pl-1')).toBeNull();
  });

  test('getBuyerPaymentLinkStatus returns the matching link\'s status', async () => {
    authClient.setSession({ id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' }, 'jwt-token');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'pl-b1', status: 'CANCELED' }] }),
    });

    const status = await getBuyerPaymentLinkStatus('buyer-1', 'pl-b1');

    expect(status).toBe('CANCELED');
    expect(lastPath()).toBe('/api/buyer-accounts/buyer-1/payment-links');
    expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
  });

  test('getBuyerPaymentLinkStatus returns null when the network call throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    expect(await getBuyerPaymentLinkStatus('buyer-1', 'pl-b1')).toBeNull();
  });

  test('getBuyerPaymentLinkStatus returns null on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false }) });

    expect(await getBuyerPaymentLinkStatus('buyer-1', 'pl-b1')).toBeNull();
  });

  test('getBuyerPaymentLinkStatus returns null when data is not an array', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: null }) });

    expect(await getBuyerPaymentLinkStatus('buyer-1', 'pl-b1')).toBeNull();
  });

  test('getBuyerPaymentLinkStatus returns null when the link id is not in the list', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [{ id: 'pl-other', status: 'PAID' }] }) });

    expect(await getBuyerPaymentLinkStatus('buyer-1', 'pl-b1')).toBeNull();
  });

  test('getBuyerPaymentLinkStatus returns null when the response body cannot be parsed', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } });

    expect(await getBuyerPaymentLinkStatus('buyer-1', 'pl-b1')).toBeNull();
  });
});
