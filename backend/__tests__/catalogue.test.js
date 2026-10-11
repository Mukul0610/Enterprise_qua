const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const storeService = require('../src/services/storeService');
const { authHeader } = require('./testHelpers');

// A real seeded vendor's own session (v-001), distinct from the generic
// 'vendor' test user — used to prove ownership scoping actually rejects a
// vendor editing someone else's catalogue item.
function otherVendorAuthHeader() {
  const token = authService.generateSessionToken({
    id: 'usr-vendor-v001',
    email: 'rajesh@apexindustrial.in',
    name: 'Rajesh Nair',
    role: 'vendor',
    orgId: 'org-vendor-v001',
    orgName: 'Apex Industrial Dynamics Pvt Ltd',
  });
  return { Authorization: `Bearer ${token}` };
}

describe('Vendor Item SKU Catalogue API', () => {
  let createdProdId;

  // Catalogue items are now scoped to the caller's own vendor record
  // (resolveOwnVendorId in catalogueController), so one must exist first.
  beforeAll(async () => {
    await request(app).post('/api/vendors').set(authHeader('vendor')).send({
      name: 'Apex Industrial Dynamics Pvt Ltd',
      majorCategory: 'Valves & Actuators',
    });
  });

  test('POST /api/catalogue returns 403 for a role that cannot add to a catalogue', async () => {
    const res = await request(app).post('/api/catalogue').set(authHeader('buyer')).send({ name: 'X', sku: 'SKU-X', unitPrice: 10 });
    expect(res.statusCode).toBe(403);
  });

  test('POST /api/catalogue returns 400 when the vendor has no profile yet', async () => {
    const token = authService.generateSessionToken({ id: 'usr-no-profile', email: 'no-profile-vendor@test.com', name: 'No Profile', role: 'vendor' });
    const res = await request(app)
      .post('/api/catalogue')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: 'X', sku: 'SKU-X', unitPrice: 10 });
    expect(res.statusCode).toBe(400);
  });

  // Starts empty and stays empty until something is added. The three demo SKUs
  // that used to make this endpoint look populated on a fresh boot are gone.
  test('GET /api/catalogue returns an empty list before anything is added', async () => {
    const res = await request(app).get('/api/catalogue');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  test('POST /api/catalogue creates new SKU product', async () => {
    const prod = {
      name: 'Cast Iron Gate Valve DN200',
      sku: 'SKU-VALVE-200',
      category: 'Valves & Actuators',
      unitPrice: 8500,
      leadTimeDays: 14,
      moq: 2,
      specs: 'Class 150 flanged, resilient seated',
    };

    const res = await request(app).post('/api/catalogue').set(authHeader('vendor')).send(prod);
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sku).toBe('SKU-VALVE-200');
    createdProdId = res.body.data.id;
  });

  test('POST /api/catalogue rejects duplicate SKUs within the vendor catalogue', async () => {
    const res = await request(app)
      .post('/api/catalogue')
      .set(authHeader('vendor'))
      .send({
        name: 'Duplicate SKU',
        sku: 'sku-valve-200',
        category: 'Valves & Actuators',
        unitPrice: 100,
        leadTimeDays: 3,
        moq: 1,
      });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  test('POST /api/catalogue enforces the 100-product limit on the server', async () => {
    const catalogueSpy = jest.spyOn(storeService, 'getVendorCatalogue').mockReturnValue(
      Array.from({ length: 100 }, (_, index) => ({ sku: `SKU-${index}` }))
    );
    try {
      const res = await request(app)
        .post('/api/catalogue')
        .set(authHeader('vendor'))
        .send({
          name: 'Capacity overflow',
          sku: 'SKU-CAPACITY-OVERFLOW',
          category: 'Valves & Actuators',
          unitPrice: 100,
          leadTimeDays: 3,
          moq: 1,
        });
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/100 products/i);
    } finally {
      catalogueSpy.mockRestore();
    }
  });

  test('POST /api/catalogue requires authentication', async () => {
    const res = await request(app).post('/api/catalogue').send({ name: 'X', sku: 'SKU-X' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/catalogue returns 400 for missing name or sku', async () => {
    const res = await request(app).post('/api/catalogue').set(authHeader('vendor')).send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('PUT /api/catalogue/:id updates product', async () => {
    const res = await request(app)
      .put(`/api/catalogue/${createdProdId}`)
      .set(authHeader('vendor'))
      .send({ unitPrice: 8200 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.unitPrice).toBe(8200);
  });

  test('PUT /api/catalogue/:id returns 404 for invalid product', async () => {
    const res = await request(app).put('/api/catalogue/invalid-prod-id').set(authHeader('vendor')).send({});
    expect(res.statusCode).toBe(404);
  });

  test('PUT /api/catalogue/:id returns 403 for a vendor who does not own the item', async () => {
    const res = await request(app).put(`/api/catalogue/${createdProdId}`).set(otherVendorAuthHeader()).send({ unitPrice: 1 });
    expect(res.statusCode).toBe(403);
  });

  test('DELETE /api/catalogue/:id returns 403 for a vendor who does not own the item', async () => {
    const res = await request(app).delete(`/api/catalogue/${createdProdId}`).set(otherVendorAuthHeader());
    expect(res.statusCode).toBe(403);
  });

  test('DELETE /api/catalogue/:id removes product', async () => {
    const res = await request(app).delete(`/api/catalogue/${createdProdId}`).set(authHeader('vendor'));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const failRes = await request(app).delete('/api/catalogue/invalid-prod-id').set(authHeader('vendor'));
    expect(failRes.statusCode).toBe(404);
  });
});
