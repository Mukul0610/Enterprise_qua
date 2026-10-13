const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

describe('Domain queries (vendors + RFQs, Neon PostgreSQL)', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = pool.pool;
  });

  afterEach(() => {
    pool.pool = originalPool;
    jest.restoreAllMocks();
  });

  describe('not configured', () => {
    beforeEach(() => {
      pool.pool = null;
    });

    test('getVendorsFromDB returns an empty array', async () => {
      await expect(domainQueries.getVendorsFromDB()).resolves.toEqual([]);
    });

    test('upsertVendorInDB returns null', async () => {
      await expect(domainQueries.upsertVendorInDB({ id: 'v-1' })).resolves.toBeNull();
    });

    test('deleteVendorInDB returns false', async () => {
      await expect(domainQueries.deleteVendorInDB('v-1')).resolves.toBe(false);
    });

    test('bulkInsertVendorsInDB returns an empty array', async () => {
      await expect(domainQueries.bulkInsertVendorsInDB([{ id: 'v-1', email: 'a@x.com' }])).resolves.toEqual([]);
    });

    test('createBulkImportSessionInDB / getBulkImportSessionFromDB / incrementBulkImportSessionInDB all return null', async () => {
      await expect(domainQueries.createBulkImportSessionInDB('s-1', 'cm@x.com', 100)).resolves.toBeNull();
      await expect(domainQueries.getBulkImportSessionFromDB('s-1')).resolves.toBeNull();
      await expect(domainQueries.incrementBulkImportSessionInDB('s-1', { processed: 1 })).resolves.toBeNull();
    });

    test('getRFQsFromDB returns an empty array', async () => {
      await expect(domainQueries.getRFQsFromDB()).resolves.toEqual([]);
    });

    test('upsertRFQInDB returns null', async () => {
      await expect(domainQueries.upsertRFQInDB({ id: 'rfq-1' })).resolves.toBeNull();
    });

    test('deleteRFQInDB returns false', async () => {
      await expect(domainQueries.deleteRFQInDB('rfq-1')).resolves.toBe(false);
    });

    test('getEvaluationsFromDB returns an empty array', async () => {
      await expect(domainQueries.getEvaluationsFromDB()).resolves.toEqual([]);
    });

    test('upsertEvaluationInDB returns null', async () => {
      await expect(domainQueries.upsertEvaluationInDB({ id: 'eval-1' })).resolves.toBeNull();
    });

    test('getVendorCatalogueFromDB returns an empty array', async () => {
      await expect(domainQueries.getVendorCatalogueFromDB()).resolves.toEqual([]);
    });

    test('upsertCatalogueProductInDB returns null', async () => {
      await expect(domainQueries.upsertCatalogueProductInDB({ id: 'prod-1' })).resolves.toBeNull();
    });

    test('deleteCatalogueProductInDB returns false', async () => {
      await expect(domainQueries.deleteCatalogueProductInDB('prod-1')).resolves.toBe(false);
    });

    test('getBuyerAccountsFromDB returns an empty accounts list and null activeId', async () => {
      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [], activeId: null });
    });

    test('upsertBuyerAccountInDB returns null', async () => {
      await expect(domainQueries.upsertBuyerAccountInDB({ id: 'buyer-1' })).resolves.toBeNull();
    });

    test('deleteBuyerAccountInDB returns false', async () => {
      await expect(domainQueries.deleteBuyerAccountInDB('buyer-1')).resolves.toBe(false);
    });

    test('setActiveBuyerAccountInDB resolves without querying', async () => {
      await expect(domainQueries.setActiveBuyerAccountInDB('buyer-1')).resolves.toBeUndefined();
    });

    test('getAIFeedFromDB returns an empty array', async () => {
      await expect(domainQueries.getAIFeedFromDB()).resolves.toEqual([]);
    });

    test('upsertAIFeedItemInDB returns null', async () => {
      await expect(domainQueries.upsertAIFeedItemInDB({ id: 'feed-1' })).resolves.toBeNull();
    });

    test('getAuditLogsFromDB returns an empty array', async () => {
      await expect(domainQueries.getAuditLogsFromDB()).resolves.toEqual([]);
    });

    test('upsertAuditLogInDB returns null', async () => {
      await expect(domainQueries.upsertAuditLogInDB({ id: 'log-1' })).resolves.toBeNull();
    });

    test('notification helpers no-op', async () => {
      await expect(domainQueries.getNotificationsFromDB()).resolves.toEqual([]);
      await expect(domainQueries.insertNotificationInDB({ id: 'ntf-1' })).resolves.toBeNull();
      await expect(domainQueries.bulkInsertNotificationsInDB([{ id: 'ntf-1' }])).resolves.toEqual([]);
      await expect(domainQueries.markNotificationReadInDB('ntf-1')).resolves.toBe(false);
      await expect(domainQueries.markAllNotificationsReadInDB('vendor', 'v-1')).resolves.toBe(0);
    });
  });

  describe('vendors', () => {
    test('getVendorsFromDB maps rows to their raw objects, newest first', async () => {
      const vendor = { id: 'v-1', name: 'Apex' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      await expect(domainQueries.getVendorsFromDB()).resolves.toEqual([vendor]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    describe('getVendorsPageFromDB', () => {
      test('no-ops when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.getVendorsPageFromDB({ limit: 50, offset: 0 })).resolves.toEqual({ rows: [], total: 0 });
      });

      test('runs a plain LIMIT/OFFSET query with no WHERE clause when there is no search or publicOnly', async () => {
        const vendor = { id: 'v-1', name: 'Apex' };
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 1 }] })
          .mockResolvedValueOnce({ rows: [{ raw: vendor }] });
        pool.pool = { query };

        const result = await domainQueries.getVendorsPageFromDB({ limit: 50, offset: 100 });

        expect(result).toEqual({ rows: [vendor], total: 1 });
        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).not.toContain('WHERE');
        expect(countParams).toEqual([]);
        const [dataSql, dataParams] = query.mock.calls[1];
        expect(dataSql).toContain('ORDER BY created_at DESC LIMIT $1 OFFSET $2');
        expect(dataParams).toEqual([50, 100]);
      });

      test('adds a search WHERE clause across name/email/category/minorCategories', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'fastener' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toContain('WHERE');
        expect(countSql).toContain('major_category ILIKE $1');
        expect(countParams).toEqual(['%fastener%']);
      });

      test('adds the publicOnly filter (no buyerId/buyerAccountId inside raw)', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 500, offset: 0, publicOnly: true });

        const [countSql] = query.mock.calls[0];
        expect(countSql).toContain("(raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL");
      });

      test('combines search and publicOnly with AND', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'cables', publicOnly: true });

        const [countSql] = query.mock.calls[0];
        expect(countSql).toMatch(/WHERE[\s\S]* AND [\s\S]*buyerId/);
      });

      test('adds the scopedBuyerId filter (public vendors OR this buyer\'s own)', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 3 }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-1' } }] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, scopedBuyerId: 'ba-42' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toContain("(raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL");
        expect(countSql).toContain("lower(raw->>'buyerId') = lower($1)");
        expect(countSql).toContain("lower(raw->>'buyerAccountId') = lower($1)");
        expect(countSql).toContain("lower(raw->>'buyerEmail') = lower($1)");
        expect(countParams).toEqual(['ba-42']);

        const [dataSql, dataParams] = query.mock.calls[1];
        expect(dataSql).toContain('ORDER BY created_at DESC LIMIT $2 OFFSET $3');
        expect(dataParams).toEqual(['ba-42', 10, 0]);
      });

      test('combines search and scopedBuyerId with AND, using separate placeholders', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'pump', scopedBuyerId: 'ba-7' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toMatch(/WHERE[\s\S]* AND [\s\S]*buyerId/);
        expect(countParams).toEqual(['%pump%', 'ba-7']);
      });

      test('does not add a scopedBuyerId filter when it is empty/falsy', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, scopedBuyerId: '' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).not.toContain('WHERE');
        expect(countParams).toEqual([]);
      });

      test('adds an exact-match category filter', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 5 }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-1' } }] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, category: 'Fasteners' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toContain('major_category = $1');
        expect(countParams).toEqual(['Fasteners']);

        const [dataSql, dataParams] = query.mock.calls[1];
        expect(dataSql).toContain('ORDER BY created_at DESC LIMIT $2 OFFSET $3');
        expect(dataParams).toEqual(['Fasteners', 10, 0]);
      });

      test('combines search and category with AND, using separate placeholders', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'steel', category: 'Fasteners' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toMatch(/WHERE[\s\S]* AND [\s\S]*major_category = \$2/);
        expect(countParams).toEqual(['%steel%', 'Fasteners']);
      });

      test('defaults total to 0 when the count query returns no row', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await expect(domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0 })).resolves.toEqual({ rows: [], total: 0 });
      });
    });

    describe('countPublicVendorsMatchingCategories', () => {
      test('no-ops to 0 when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.countPublicVendorsMatchingCategories(['Steels'])).resolves.toBe(0);
      });

      test('returns 0 for an empty / all-blank signal list without querying', async () => {
        pool.pool = { query: jest.fn() };
        await expect(domainQueries.countPublicVendorsMatchingCategories([])).resolves.toBe(0);
        await expect(domainQueries.countPublicVendorsMatchingCategories(['', '  '])).resolves.toBe(0);
        expect(pool.pool.query).not.toHaveBeenCalled();
      });

      test('counts matches across major and minor category pools, public vendors only', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ total: 20 }] });
        pool.pool = { query };

        const total = await domainQueries.countPublicVendorsMatchingCategories([
          'Raw Material',
          'Steels',
          'Engineering Spares - Mechanical',
          'Pipes & Pipe Fittings',
        ]);

        expect(total).toBe(20);
        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('COUNT(*)');
        expect(sql).toContain('major_category');
        expect(sql).toContain("raw->'minorCategories'");
        // Public-only clause present.
        expect(sql).toContain("(raw->>'buyerId') IS NULL");
        // De-duplicated, lower-cased, wildcard-wrapped params — one per distinct signal.
        expect(params).toEqual([
          '%raw material%',
          '%steels%',
          '%engineering spares - mechanical%',
          '%pipes & pipe fittings%',
        ]);
      });

      test('de-duplicates signals that differ only by case/whitespace', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ total: 3 }] });
        pool.pool = { query };

        await domainQueries.countPublicVendorsMatchingCategories(['Steels', ' steels ', 'STEELS']);

        const [, params] = query.mock.calls[0];
        expect(params).toEqual(['%steels%']);
      });

      test('defaults to 0 when the count query returns no row', async () => {
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(domainQueries.countPublicVendorsMatchingCategories(['Steels'])).resolves.toBe(0);
      });
    });

    describe('getPublicVendorsMatchingCategories', () => {
      test('no-ops to [] when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.getPublicVendorsMatchingCategories(['Steels'], 10)).resolves.toEqual([]);
      });

      test('returns [] for an empty / all-blank signal list without querying', async () => {
        pool.pool = { query: jest.fn() };
        await expect(domainQueries.getPublicVendorsMatchingCategories([], 10)).resolves.toEqual([]);
        await expect(domainQueries.getPublicVendorsMatchingCategories(['', '  '], 10)).resolves.toEqual([]);
        expect(pool.pool.query).not.toHaveBeenCalled();
      });

      test('returns parsed matching vendor rows and binds the limit last', async () => {
        const vendor = { id: 'pv-1', name: 'Mamta Electrics', source: 'procucev_network' };
        const query = jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] });
        pool.pool = { query };

        const rows = await domainQueries.getPublicVendorsMatchingCategories(['Lighting'], 25);

        expect(rows).toEqual([vendor]);
        const [sql, params] = query.mock.calls[0];
        // Public-only filter and a LIMIT bound as the final parameter.
        expect(sql).toMatch(/LIMIT/i);
        expect(params[params.length - 1]).toBe(25);
        expect(params).toContain('%lighting%');
      });

      test('returns [] when the query yields no rows', async () => {
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(domainQueries.getPublicVendorsMatchingCategories(['Steels'], 10)).resolves.toEqual([]);
      });
    });

    describe('getVendorByEmailFromDB', () => {
      test('no-ops when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.getVendorByEmailFromDB('a@b.com')).resolves.toBeNull();
      });

      test('no-ops when no email is given', async () => {
        pool.pool = { query: jest.fn() };
        await expect(domainQueries.getVendorByEmailFromDB('')).resolves.toBeNull();
        expect(pool.pool.query).not.toHaveBeenCalled();
      });

      test('returns the matching row', async () => {
        const vendor = { id: 'v-1', email: 'a@b.com' };
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };
        await expect(domainQueries.getVendorByEmailFromDB('a@b.com')).resolves.toEqual(vendor);
      });

      test('returns null when nothing matches', async () => {
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(domainQueries.getVendorByEmailFromDB('nobody@x.com')).resolves.toBeNull();
      });
    });

    describe('getVendorByIdFromDB', () => {
      test('no-ops when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.getVendorByIdFromDB('v-1')).resolves.toBeNull();
      });

      test('no-ops when no id is given', async () => {
        pool.pool = { query: jest.fn() };
        await expect(domainQueries.getVendorByIdFromDB('')).resolves.toBeNull();
        expect(pool.pool.query).not.toHaveBeenCalled();
      });

      test('returns the matching row', async () => {
        const vendor = { id: 'v-1', email: 'a@b.com' };
        const spy = jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] });
        pool.pool = { query: spy };
        await expect(domainQueries.getVendorByIdFromDB('v-1')).resolves.toEqual(vendor);
        expect(spy).toHaveBeenCalledWith('SELECT raw FROM vendors WHERE id = $1 LIMIT 1', ['v-1']);
        // pool.query's 3rd arg ({d1:true}) is consumed by pool.js's own
        // wrapper, not forwarded to the underlying pg driver mock — matches
        // the existing assertion convention for every other test in this
        // file (see deleteCatalogueProductInDB's test / this session's fix
        // for that exact 2-vs-3-arg mismatch).
      });

      test('returns null when nothing matches', async () => {
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(domainQueries.getVendorByIdFromDB('missing')).resolves.toBeNull();
      });
    });

    test('upsertVendorInDB serializes the vendor and returns the stored raw row', async () => {
      const vendor = {
        id: 'v-1',
        email: 'v@x.com',
        majorCategory: 'Mechanical',
        status: 'ACTIVE',
        source: 'buyer_manual',
        name: 'Apex',
      };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      const result = await domainQueries.upsertVendorInDB(vendor);

      expect(result).toEqual(vendor);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vendors');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['v-1', 'v@x.com', 'Mechanical', 'ACTIVE', 'buyer_manual', JSON.stringify(vendor)]);
    });

    test('upsertVendorInDB falls back missing nullable fields to null', async () => {
      const vendor = { id: 'v-2', name: 'Bare Vendor' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      await domainQueries.upsertVendorInDB(vendor);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['v-2', null, null, null, null, JSON.stringify(vendor)]);
    });

    test('upsertVendorInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertVendorInDB({ id: 'v-3' })).resolves.toBeNull();
    });

    test('deleteVendorInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteVendorInDB('v-1')).resolves.toBe(true);
      expect(pool.pool.query).toHaveBeenCalledWith('DELETE FROM vendors WHERE id = $1', ['v-1']);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteVendorInDB('v-x')).resolves.toBe(false);
    });

    test('bulkInsertVendorsInDB returns [] without querying when the batch is empty', async () => {
      pool.pool = { query: jest.fn() };
      await expect(domainQueries.bulkInsertVendorsInDB([])).resolves.toEqual([]);
      expect(pool.pool.query).not.toHaveBeenCalled();
    });

    test('bulkInsertVendorsInDB builds one multi-row INSERT with ON CONFLICT (email) DO NOTHING and returns the emails that landed', async () => {
      const v1 = { id: 'v-1', email: 'a@x.com', majorCategory: 'Mechanical', status: 'REGISTERED / NOT EVALUATED', source: 'excel' };
      const v2 = { id: 'v-2', email: 'b@x.com', name: 'Bare' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ email: 'a@x.com' }] }) };

      const result = await domainQueries.bulkInsertVendorsInDB([v1, v2]);

      expect(result).toEqual(['a@x.com']);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vendors');
      expect(sql).toContain('ON CONFLICT (email) DO NOTHING');
      expect(sql).toContain('($1, $2, $3, $4, $5, $6, now())');
      expect(sql).toContain('($7, $8, $9, $10, $11, $12, now())');
      expect(params).toEqual([
        'v-1', 'a@x.com', 'Mechanical', 'REGISTERED / NOT EVALUATED', 'excel', JSON.stringify(v1),
        'v-2', 'b@x.com', null, null, null, JSON.stringify(v2),
      ]);
    });

    test('createBulkImportSessionInDB inserts a new session row and returns it', async () => {
      const sessionRow = { id: 's-1', status: 'IN_PROGRESS', total_rows_declared: 500 };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [sessionRow] }) };

      const result = await domainQueries.createBulkImportSessionInDB('s-1', 'cm@x.com', 500);

      expect(result).toEqual(sessionRow);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO bulk_vendor_import_sessions');
      expect(params).toEqual(['s-1', 'cm@x.com', 500]);
    });

    test('createBulkImportSessionInDB defaults totalRowsDeclared to 0 when omitted', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{}] }) };
      await domainQueries.createBulkImportSessionInDB('s-1', 'cm@x.com', undefined);
      expect(pool.pool.query.mock.calls[0][1]).toEqual(['s-1', 'cm@x.com', 0]);
    });

    test('getBulkImportSessionFromDB returns null when no row matches', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getBulkImportSessionFromDB('missing')).resolves.toBeNull();
    });

    test('getBulkImportSessionFromDB returns the matching row', async () => {
      const sessionRow = { id: 's-1', status: 'IN_PROGRESS' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [sessionRow] }) };
      await expect(domainQueries.getBulkImportSessionFromDB('s-1')).resolves.toEqual(sessionRow);
      expect(pool.pool.query.mock.calls[0][1]).toEqual(['s-1']);
    });

    test('incrementBulkImportSessionInDB adds every delta field, defaulting missing ones to 0', async () => {
      const updated = { id: 's-1', status: 'IN_PROGRESS', processed_count: 10 };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [updated] }) };

      const result = await domainQueries.incrementBulkImportSessionInDB('s-1', { processed: 10, imported: 8 });

      expect(result).toEqual(updated);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE bulk_vendor_import_sessions');
      expect(params).toEqual(['s-1', 10, 8, 0, 0, 0]);
    });

    test('incrementBulkImportSessionInDB returns null when the session id does not exist', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.incrementBulkImportSessionInDB('missing', {})).resolves.toBeNull();
    });
  });

  describe('rfqs', () => {
    test('getRFQsFromDB maps rows to their raw objects, newest first', async () => {
      const rfq = { id: 'rfq-1', title: 'Test RFQ' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await expect(domainQueries.getRFQsFromDB()).resolves.toEqual([rfq]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('upsertRFQInDB serializes the RFQ and returns the stored raw row', async () => {
      const rfq = {
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-0001',
        category: 'Mechanical',
        status: 'open',
        sourcingMode: 'mode_1',
        budget: 1000,
      };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      const result = await domainQueries.upsertRFQInDB(rfq);

      expect(result).toEqual(rfq);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO rfqs');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['rfq-1', 'RFQ-2026-0001', 'Mechanical', 'open', 'mode_1', 1000, JSON.stringify(rfq)]);
    });

    test('upsertRFQInDB falls back a non-numeric budget to null', async () => {
      const rfq = { id: 'rfq-2', budget: 'not-a-number' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await domainQueries.upsertRFQInDB(rfq);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params[5]).toBeNull();
    });

    test('upsertRFQInDB falls back missing nullable fields to null', async () => {
      const rfq = { id: 'rfq-3' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await domainQueries.upsertRFQInDB(rfq);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['rfq-3', null, null, null, null, null, JSON.stringify(rfq)]);
    });

    test('deleteRFQInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteRFQInDB('rfq-1')).resolves.toBe(true);
      expect(pool.pool.query).toHaveBeenCalledWith('DELETE FROM rfqs WHERE id = $1', ['rfq-1']);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteRFQInDB('rfq-x')).resolves.toBe(false);
    });
  });

  describe('evaluations', () => {
    test('getEvaluationsFromDB maps rows to their raw objects, newest first', async () => {
      const evaluation = { id: 'eval-1', vendorName: 'Apex' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: evaluation }] }) };

      await expect(domainQueries.getEvaluationsFromDB()).resolves.toEqual([evaluation]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('upsertEvaluationInDB serializes the evaluation and returns the stored raw row', async () => {
      const evaluation = { id: 'eval-1', vendorId: 'v-001', status: 'PREFERRED ENTERPRISE SUPPLIER' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: evaluation }] }) };

      const result = await domainQueries.upsertEvaluationInDB(evaluation);

      expect(result).toEqual(evaluation);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO evaluations');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['eval-1', 'v-001', 'PREFERRED ENTERPRISE SUPPLIER', JSON.stringify(evaluation)]);
    });

    test('upsertEvaluationInDB falls back missing nullable fields to null', async () => {
      const evaluation = { id: 'eval-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: evaluation }] }) };

      await domainQueries.upsertEvaluationInDB(evaluation);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['eval-2', null, null, JSON.stringify(evaluation)]);
    });

    test('upsertEvaluationInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertEvaluationInDB({ id: 'eval-3' })).resolves.toBeNull();
    });

    // evaluations has been ported to D1 (see d1Bridge.js), which has no JSON
    // column type — raw comes back as a TEXT string there.
    test('getEvaluationsFromDB parses a string raw column (D1)', async () => {
      const evaluation = { id: 'eval-1', vendorId: 'v-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(evaluation) }] }) };

      await expect(domainQueries.getEvaluationsFromDB()).resolves.toEqual([evaluation]);
    });

    test('upsertEvaluationInDB parses a string raw column (D1)', async () => {
      const evaluation = { id: 'eval-1', vendorId: 'v-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(evaluation) }] }) };

      await expect(domainQueries.upsertEvaluationInDB(evaluation)).resolves.toEqual(evaluation);
    });
  });

  describe('vendor catalogue', () => {
    test('getVendorCatalogueFromDB maps rows to their raw objects, newest first', async () => {
      const product = { id: 'prod-1', name: 'Impeller' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      await expect(domainQueries.getVendorCatalogueFromDB()).resolves.toEqual([product]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('upsertCatalogueProductInDB serializes the product and returns the stored raw row', async () => {
      const product = { id: 'prod-1', vendorId: 'v-001', sku: 'SKU-1', category: 'Pumps' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      const result = await domainQueries.upsertCatalogueProductInDB(product);

      expect(result).toEqual(product);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vendor_catalogue');
      expect(params).toEqual(['prod-1', 'v-001', 'SKU-1', 'Pumps', JSON.stringify(product)]);
    });

    test('upsertCatalogueProductInDB falls back missing nullable fields to null', async () => {
      const product = { id: 'prod-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      await domainQueries.upsertCatalogueProductInDB(product);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['prod-2', null, null, null, JSON.stringify(product)]);
    });

    test('deleteCatalogueProductInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteCatalogueProductInDB('prod-1')).resolves.toBe(true);
      expect(pool.pool.query).toHaveBeenCalledWith('DELETE FROM vendor_catalogue WHERE id = $1', ['prod-1']);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteCatalogueProductInDB('prod-x')).resolves.toBe(false);
    });

    // vendor_catalogue has been ported to D1 (see d1Bridge.js), which has no
    // JSON column type — raw comes back as a TEXT string there.
    test('getVendorCatalogueFromDB parses a string raw column (D1)', async () => {
      const product = { id: 'prod-1', sku: 'SKU-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(product) }] }) };

      await expect(domainQueries.getVendorCatalogueFromDB()).resolves.toEqual([product]);
    });

    test('upsertCatalogueProductInDB parses a string raw column (D1)', async () => {
      const product = { id: 'prod-1', sku: 'SKU-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(product) }] }) };

      await expect(domainQueries.upsertCatalogueProductInDB(product)).resolves.toEqual(product);
    });
  });

  describe('buyer accounts', () => {
    test('getBuyerAccountsFromDB returns accounts and the active row id', async () => {
      const acc1 = { id: 'buyer-1', organizationName: 'L&T' };
      const acc2 = { id: 'buyer-2', organizationName: 'Siemens' };
      pool.pool = {
        query: jest.fn().mockResolvedValue({
          rows: [
            { id: 'buyer-1', is_active: false, raw: acc1 },
            { id: 'buyer-2', is_active: true, raw: acc2 },
          ],
        }),
      };

      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [acc1, acc2], activeId: 'buyer-2' });
    });

    test('getBuyerAccountsFromDB returns a null activeId when no row is flagged active', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'buyer-1', is_active: false, raw: { id: 'buyer-1' } }] }) };
      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [{ id: 'buyer-1' }], activeId: null });
    });

    // buyer_accounts has been ported to D1 (see d1Bridge.js), which has no
    // JSON column type — raw comes back as a TEXT string there.
    test('getBuyerAccountsFromDB parses a string raw column (D1)', async () => {
      const acc = { id: 'buyer-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'buyer-1', is_active: true, raw: JSON.stringify(acc) }] }) };
      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [acc], activeId: 'buyer-1' });
    });

    test('getBuyerAccountByEmailFromDB returns the matching account', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: account }] }) };

      await expect(domainQueries.getBuyerAccountByEmailFromDB('buyer@lt.com')).resolves.toEqual(account);
      expect(pool.pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE lower(corporate_email) = lower($1)'),
        ['buyer@lt.com']
      );
    });

    test('getBuyerAccountByEmailFromDB parses a string raw column (D1)', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(account) }] }) };

      await expect(domainQueries.getBuyerAccountByEmailFromDB('buyer@lt.com')).resolves.toEqual(account);
    });

    test('getBuyerAccountByEmailFromDB returns null when nothing matched', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getBuyerAccountByEmailFromDB('nobody@x.com')).resolves.toBeNull();
    });

    test('getBuyerAccountByEmailFromDB returns null when not configured or no email given', async () => {
      pool.pool = { query: jest.fn() };
      await expect(domainQueries.getBuyerAccountByEmailFromDB('')).resolves.toBeNull();
      pool.pool = null;
      await expect(domainQueries.getBuyerAccountByEmailFromDB('x@y.com')).resolves.toBeNull();
    });

    test('upsertBuyerAccountInDB serializes the account and returns the stored raw row', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com', status: 'ACTIVE_VERIFIED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: account }] }) };

      const result = await domainQueries.upsertBuyerAccountInDB(account);

      expect(result).toEqual(account);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO buyer_accounts');
      expect(sql).not.toContain('is_active');
      expect(params).toEqual(['buyer-1', 'buyer@lt.com', 'ACTIVE_VERIFIED', JSON.stringify(account)]);
    });

    test('upsertBuyerAccountInDB falls back missing nullable fields to null', async () => {
      const account = { id: 'buyer-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: account }] }) };

      await domainQueries.upsertBuyerAccountInDB(account);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['buyer-2', null, null, JSON.stringify(account)]);
    });

    test('deleteBuyerAccountInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteBuyerAccountInDB('buyer-1')).resolves.toBe(true);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteBuyerAccountInDB('buyer-x')).resolves.toBe(false);
    });

    test('setActiveBuyerAccountInDB flags exactly the given id active', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({}) };
      await domainQueries.setActiveBuyerAccountInDB('buyer-2');
      expect(pool.pool.query).toHaveBeenCalledWith('UPDATE buyer_accounts SET is_active = (id = $1)', ['buyer-2']);
    });

    test('upsertBuyerAccountInDB parses a string raw column (D1)', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(account) }] }) };

      await expect(domainQueries.upsertBuyerAccountInDB(account)).resolves.toEqual(account);
    });
  });

  describe('AI feed', () => {
    test('getAIFeedFromDB maps rows to their raw objects, in sequence order', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: item }] }) };

      await expect(domainQueries.getAIFeedFromDB()).resolves.toEqual([item]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sequence DESC'), []);
    });

    test('upsertAIFeedItemInDB inserts the item and trims the table to the newest 100 rows', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      const queryMock = jest.fn().mockResolvedValue({ rows: [{ raw: item }] });
      pool.pool = { query: queryMock };

      const result = await domainQueries.upsertAIFeedItemInDB(item);

      expect(result).toEqual(item);
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(queryMock.mock.calls[0][0]).toContain('INSERT INTO ai_feed');
      expect(queryMock.mock.calls[0][1]).toEqual(['feed-1', JSON.stringify(item)]);
      expect(queryMock.mock.calls[1][0]).toContain('DELETE FROM ai_feed');
      expect(queryMock.mock.calls[1][0]).toContain('LIMIT 100');
    });

    test('upsertAIFeedItemInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertAIFeedItemInDB({ id: 'feed-2' })).resolves.toBeNull();
    });

    // ai_feed has been ported to D1 (see d1Bridge.js), which has no JSON
    // column type — raw comes back as a TEXT string there.
    test('getAIFeedFromDB parses a string raw column (D1)', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(item) }] }) };

      await expect(domainQueries.getAIFeedFromDB()).resolves.toEqual([item]);
    });

    test('upsertAIFeedItemInDB parses a string raw column (D1)', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(item) }] }) };

      await expect(domainQueries.upsertAIFeedItemInDB(item)).resolves.toEqual(item);
    });
  });

  describe('audit logs', () => {
    test('getAuditLogsFromDB maps rows to their raw objects, in sequence order', async () => {
      const entry = { id: 'log-1', action: 'Created vendor' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: entry }] }) };

      await expect(domainQueries.getAuditLogsFromDB()).resolves.toEqual([entry]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sequence DESC'), []);
    });

    test('upsertAuditLogInDB serializes the entry and returns the stored raw row', async () => {
      const entry = { id: 'log-1', action: 'Created vendor', shaSignature: 'abc123' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: entry }] }) };

      const result = await domainQueries.upsertAuditLogInDB(entry);

      expect(result).toEqual(entry);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toEqual(['log-1', JSON.stringify(entry)]);
    });

    test('upsertAuditLogInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertAuditLogInDB({ id: 'log-2' })).resolves.toBeNull();
    });

    // audit_logs has been ported to D1 (see d1Bridge.js), which has no JSON
    // column type — raw comes back as a TEXT string there.
    test('getAuditLogsFromDB parses a string raw column (D1)', async () => {
      const entry = { id: 'log-1', action: 'LOGIN' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(entry) }] }) };

      await expect(domainQueries.getAuditLogsFromDB()).resolves.toEqual([entry]);
    });

    test('upsertAuditLogInDB parses a string raw column (D1)', async () => {
      const entry = { id: 'log-1', action: 'LOGIN' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(entry) }] }) };

      await expect(domainQueries.upsertAuditLogInDB(entry)).resolves.toEqual(entry);
    });
  });

  describe('notifications', () => {
    const NTF = {
      id: 'ntf-1',
      recipientType: 'vendor',
      recipientId: 'v-1',
      kind: 'rfq_category_match',
      rfqId: 'rfq-1',
      read: false,
      title: 'New RFQ',
    };

    test('getNotificationsFromDB maps rows to raw objects in sequence order', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: NTF }] }) };

      await expect(domainQueries.getNotificationsFromDB()).resolves.toEqual([NTF]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sequence DESC'), []);
    });

    test('insertNotificationInDB serializes the row and passes the typed columns', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: NTF }] }) };

      const result = await domainQueries.insertNotificationInDB(NTF);

      expect(result).toEqual(NTF);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO notifications');
      expect(params).toEqual(['ntf-1', 'vendor', 'v-1', 'rfq_category_match', 'rfq-1', false, JSON.stringify(NTF)]);
    });

    test('insertNotificationInDB tolerates a missing rfqId and returns null on no row', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };

      const result = await domainQueries.insertNotificationInDB({
        id: 'ntf-2',
        recipientType: 'buyer',
        recipientId: 'b-1',
        kind: 'quote_received',
      });

      expect(result).toBeNull();
      expect(pool.pool.query.mock.calls[0][1][4]).toBeNull();
    });

    test('bulkInsertNotificationsInDB writes one multi-row INSERT and returns the ids that landed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'ntf-1' }, { id: 'ntf-2' }] }) };

      const result = await domainQueries.bulkInsertNotificationsInDB([
        { ...NTF, id: 'ntf-1' },
        { ...NTF, id: 'ntf-2', rfqId: null },
      ]);

      expect(result).toEqual(['ntf-1', 'ntf-2']);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO notifications');
      expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
      expect(params).toHaveLength(14);
    });

    test('bulkInsertNotificationsInDB no-ops on an empty list', async () => {
      pool.pool = { query: jest.fn() };
      await expect(domainQueries.bulkInsertNotificationsInDB([])).resolves.toEqual([]);
      expect(pool.pool.query).not.toHaveBeenCalled();
    });

    test('markNotificationReadInDB flips the column and the raw flag', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };

      await expect(domainQueries.markNotificationReadInDB('ntf-1')).resolves.toBe(true);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE notifications');
      expect(sql).toContain("jsonb_set(raw, '{read}', 'true'::jsonb)");
      expect(params).toEqual(['ntf-1']);
    });

    test('markNotificationReadInDB returns false when no row matched', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.markNotificationReadInDB('ntf-x')).resolves.toBe(false);
    });

    test('markAllNotificationsReadInDB returns the number of rows changed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 3 }) };

      await expect(domainQueries.markAllNotificationsReadInDB('vendor', 'v-1')).resolves.toBe(3);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('recipient_type = $1 AND recipient_id = $2 AND is_read = false');
      expect(params).toEqual(['vendor', 'v-1']);
    });
  });

  describe('Zoho OAuth token (single-row cache)', () => {
    test('not configured: getZohoOAuthTokenFromDB returns null', async () => {
      pool.pool = null;
      await expect(domainQueries.getZohoOAuthTokenFromDB()).resolves.toBeNull();
    });

    test('not configured: upsertZohoOAuthTokenInDB returns null', async () => {
      pool.pool = null;
      await expect(domainQueries.upsertZohoOAuthTokenInDB({ accessToken: 'x', expiryTime: 'y' })).resolves.toBeNull();
    });

    test('getZohoOAuthTokenFromDB reads the single default row', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ access_token: 'tok', expiry_time: '2026-01-01T00:00:00Z' }] }) };

      await expect(domainQueries.getZohoOAuthTokenFromDB()).resolves.toEqual({
        access_token: 'tok',
        expiry_time: '2026-01-01T00:00:00Z',
      });
      const [sql] = pool.pool.query.mock.calls[0];
      expect(sql).toContain("id = 'default'");
    });

    test('getZohoOAuthTokenFromDB returns null when no row exists yet', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getZohoOAuthTokenFromDB()).resolves.toBeNull();
    });

    test('upsertZohoOAuthTokenInDB upserts the single row and falls back nullable fields to null', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ access_token: 'tok', expiry_time: null }] }) };

      const result = await domainQueries.upsertZohoOAuthTokenInDB({ accessToken: 'tok' });

      expect(result).toEqual({ access_token: 'tok', expiry_time: null });
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO zoho_oauth_token');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['tok', null]);
    });
  });

  describe('Zoho payment links', () => {
    test('not configured: getPaymentLinksFromDB returns an empty array', async () => {
      pool.pool = null;
      await expect(domainQueries.getPaymentLinksFromDB()).resolves.toEqual([]);
    });

    test('not configured: getPaymentLinkByZohoIdFromDB returns null', async () => {
      pool.pool = null;
      await expect(domainQueries.getPaymentLinkByZohoIdFromDB('zoho-1')).resolves.toBeNull();
    });

    test('not configured: upsertPaymentLinkInDB returns null', async () => {
      pool.pool = null;
      await expect(domainQueries.upsertPaymentLinkInDB({ id: 'pl-1' })).resolves.toBeNull();
    });

    test('getPaymentLinksFromDB maps rows to their raw objects, newest first', async () => {
      const link = { id: 'pl-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await expect(domainQueries.getPaymentLinksFromDB()).resolves.toEqual([link]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('getPaymentLinkByZohoIdFromDB looks up by the Zoho id and returns its raw object', async () => {
      const link = { id: 'pl-1', zohoPaymentLinkId: 'zoho-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await expect(domainQueries.getPaymentLinkByZohoIdFromDB('zoho-1')).resolves.toEqual(link);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE zoho_payment_link_id = $1'), ['zoho-1']);
    });

    test('getPaymentLinkByZohoIdFromDB returns null when nothing matched', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getPaymentLinkByZohoIdFromDB('zoho-x')).resolves.toBeNull();
    });

    // payment_links has been ported to D1 (see d1Bridge.js), which has no
    // JSON column type — `raw` comes back as a TEXT string there, not an
    // already-parsed object the way pg's jsonb driver returns it.
    test('getPaymentLinksFromDB parses a string raw column (D1)', async () => {
      const link = { id: 'pl-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(link) }] }) };

      await expect(domainQueries.getPaymentLinksFromDB()).resolves.toEqual([link]);
    });

    test('getPaymentLinkByZohoIdFromDB parses a string raw column (D1)', async () => {
      const link = { id: 'pl-1', zohoPaymentLinkId: 'zoho-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(link) }] }) };

      await expect(domainQueries.getPaymentLinkByZohoIdFromDB('zoho-1')).resolves.toEqual(link);
    });

    test('upsertPaymentLinkInDB parses a string raw column (D1)', async () => {
      const link = { id: 'pl-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(link) }] }) };

      await expect(domainQueries.upsertPaymentLinkInDB(link)).resolves.toEqual(link);
    });

    test('upsertPaymentLinkInDB serializes the link and returns the stored raw row', async () => {
      const link = { id: 'pl-1', zohoPaymentLinkId: 'zoho-1', vendorId: 'v-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      const result = await domainQueries.upsertPaymentLinkInDB(link);

      expect(result).toEqual(link);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO payment_links');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['pl-1', 'zoho-1', 'v-1', null, 'vendor', 'CREATED', JSON.stringify(link)]);
    });

    test('upsertPaymentLinkInDB serializes a buyer link with payerType/buyerAccountId', async () => {
      const link = { id: 'pl-buyer-1', zohoPaymentLinkId: 'zoho-b1', buyerAccountId: 'buyer-1', payerType: 'buyer', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await domainQueries.upsertPaymentLinkInDB(link);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['pl-buyer-1', 'zoho-b1', null, 'buyer-1', 'buyer', 'CREATED', JSON.stringify(link)]);
    });

    test('upsertPaymentLinkInDB falls back missing nullable fields to null and payerType to vendor', async () => {
      const link = { id: 'pl-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await domainQueries.upsertPaymentLinkInDB(link);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['pl-2', null, null, null, 'vendor', null, JSON.stringify(link)]);
    });

    test('upsertPaymentLinkInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertPaymentLinkInDB({ id: 'pl-3' })).resolves.toBeNull();
    });
  });
});
