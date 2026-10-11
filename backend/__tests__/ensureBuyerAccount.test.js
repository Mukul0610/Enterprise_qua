// A buyer inserted straight into the identity `user` table (bulk import) can
// sign in but has no buyer_accounts row. Their RFQs used to be saved with no
// buyerAccountId, so GET /api/rfqs always came back empty for them.
const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const storeService = require('../src/services/storeService');

const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function headerFor(user) {
  return { Authorization: `Bearer ${authService.generateSessionToken(user)}` };
}

describe('storeService.ensureBuyerAccountForUser', () => {
  test('returns null for a missing user, a non-buyer, or a buyer without an email', async () => {
    expect(await storeService.ensureBuyerAccountForUser(null)).toBeNull();
    expect(await storeService.ensureBuyerAccountForUser({ role: 'admin', email: 'a@ex.com', sub: 'x' })).toBeNull();
    expect(await storeService.ensureBuyerAccountForUser({ role: 'buyer', sub: 'x' })).toBeNull();
  });

  test('returns null when the buyer has no id to key the account on', async () => {
    expect(await storeService.ensureBuyerAccountForUser({ role: 'buyer', email: 'no-id@ex.com' })).toBeNull();
  });

  test('returns the existing account without creating another', async () => {
    const existing = storeService.addBuyerAccount({ organizationName: 'Has Account', corporateEmail: 'has-account@ex.com' });
    const spy = jest.spyOn(storeService, 'addBuyerAccount');
    const got = await storeService.ensureBuyerAccountForUser({ role: 'buyer', email: 'HAS-ACCOUNT@ex.com', sub: 'u-has' });
    expect(got.id).toBe(existing.id);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('creates a free_trial account keyed on the user uuid, then reuses it', async () => {
    const user = { role: 'buyer', email: 'Imported@Ex.com', sub: 'u-imported-1', name: 'Imp', orgName: 'Imp Org', orgId: 'org-1' };
    const created = await storeService.ensureBuyerAccountForUser(user);
    expect(created).toMatchObject({
      id: 'u-imported-1',
      corporateEmail: 'imported@ex.com',
      organizationName: 'Imp Org',
      contactPerson: 'Imp',
      organizationId: 'org-1',
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 5,
    });
    const again = await storeService.ensureBuyerAccountForUser(user);
    expect(again.id).toBe('u-imported-1');
    expect(storeService.getBuyerAccounts().filter((a) => a.id === 'u-imported-1')).toHaveLength(1);
  });

  test('falls back to email/blank names and user.id when optional claims are absent', async () => {
    const created = await storeService.ensureBuyerAccountForUser({ role: 'buyer', email: 'bare@ex.com', id: 'u-bare' });
    expect(created).toMatchObject({ id: 'u-bare', organizationName: 'bare@ex.com', contactPerson: '', organizationId: null });
  });

  test('reuses an in-memory account with the same id when the email lookup misses (persist still in flight)', async () => {
    const cached = { id: 'u-inflight', corporateEmail: 'other@ex.com' };
    storeService.buyerAccounts.unshift(cached);
    const spy = jest.spyOn(storeService, 'addBuyerAccount');
    const got = await storeService.ensureBuyerAccountForUser({ role: 'buyer', email: 'inflight@ex.com', sub: 'u-inflight' });
    expect(got).toBe(cached);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('an imported buyer (no buyer_accounts row) can see the RFQ they create', () => {
  const user = { id: 'u-imported-rfq', email: 'imported-rfq@ex.com', name: 'Imported', role: 'buyer', orgId: 'o', orgName: 'Imported Org' };

  test('POST then GET /api/rfqs returns the new RFQ', async () => {
    expect(await storeService.getBuyerAccountByEmail(user.email)).toBeNull();

    const created = await request(app).post('/api/rfqs').set(headerFor(user)).send({
      title: 'Imported Buyer RFQ',
      category: 'Engineering Spares - Mechanical',
      budget: 5000,
      targetDeliveryDate: A_FUTURE_DATE,
      deadline: A_FUTURE_DATE,
      sourcingMode: 'mode_0',
      deliveryLocation: 'Plant A',
      deliveryPincode: '400001',
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.buyerAccountId).toBe('u-imported-rfq');

    const list = await request(app).get('/api/rfqs').set(headerFor(user));
    expect(list.statusCode).toBe(200);
    expect(list.body.data.map((r) => r.id)).toContain(created.body.data.id);
  });

  test('GET /api/bootstrap also provisions the account', async () => {
    const other = { ...user, id: 'u-imported-boot', email: 'imported-boot@ex.com' };
    const res = await request(app).get('/api/bootstrap').set(headerFor(other));
    expect(res.statusCode).toBe(200);
    expect((await storeService.getBuyerAccountByEmail(other.email)).id).toBe('u-imported-boot');
  });
});
