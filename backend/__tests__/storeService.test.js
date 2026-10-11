const storeService = require('../src/services/storeService');
const domainPool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const mailerService = require('../src/services/mailerService');
const identityQueries = require('../src/db/identityQueries');

describe('Store Service & Business Operations', () => {
  test('initializes with no records at all', async () => {
    // Nothing is seeded. Every collection is filled from PostgreSQL by
    // hydrateFromDB, and an empty one means there are no rows — it is not a cue
    // to substitute fabricated vendors, evaluations or catalogue products, which
    // is what the constructor used to do.
    expect(await storeService.getVendors()).toEqual([]);
    expect(storeService.getEvaluations()).toEqual([]);
    expect(storeService.getVendorCatalogue()).toEqual([]);
    // Buyer accounts are not seeded either: the signed-in buyer's account is
    // resolved from their own account record, so no fabricated company is
    // attributed to anyone.
    expect(storeService.getBuyerAccounts()).toEqual([]);
    expect(storeService.getActiveBuyerAccount()).toBeNull();
    expect(storeService.getRFQs()).toEqual([]);
    expect(storeService.getAuditLogs()).toEqual([]);
    expect(await storeService.getBootstrapData()).not.toHaveProperty('rfqs');
    // System config and the infrastructure list are static defaults, not records.
    expect(storeService.getAzureHealth().length).toBeGreaterThan(0);
    expect(storeService.getSystemConfig()).toBeTruthy();
  });

  describe('Buyer Accounts Management', () => {
    let testAccId;

    test('addBuyerAccount & alignActiveBuyerAccount', () => {
      const acc = storeService.addBuyerAccount({
        organizationName: 'BHEL Power Equipment',
        corporateEmail: 'procure@bhel.in',
        contactPerson: 'S. K. Roy',
      });

      expect(acc.id).toBeDefined();
      testAccId = acc.id;
      expect(storeService.getBuyerAccounts()[0].organizationName).toBe('BHEL Power Equipment');

      const aligned = storeService.alignActiveBuyerAccount(acc.id);
      expect(aligned.id).toBe(acc.id);
      expect(storeService.getActiveBuyerAccount().id).toBe(acc.id);

      const invalidAlign = storeService.alignActiveBuyerAccount('nonexistent');
      expect(invalidAlign).toBeNull();
    });

    test('updateBuyerAccount updates existing or returns null on missing', () => {
      const updated = storeService.updateBuyerAccount(testAccId, { contactPerson: 'Arun Roy' });
      expect(updated.contactPerson).toBe('Arun Roy');

      const failUpdate = storeService.updateBuyerAccount('nonexistent', {});
      expect(failUpdate).toBeNull();
    });

    test('deleteBuyerAccount removes account and resets active if current', () => {
      const res = storeService.deleteBuyerAccount(testAccId);
      expect(res).toBe(true);

      const failDelete = storeService.deleteBuyerAccount('nonexistent');
      expect(failDelete).toBe(false);
    });
  });

  describe('Vendors Management', () => {
    let testVendorId;

    test('addVendor & getVendorById', () => {
      const v = storeService.addVendor({
        name: 'Schneider Electric Industrial',
        contactPerson: 'Deepak',
        email: 'deepak@schneider.com',
        majorCategory: 'Engineering Spares - Electrical',
      });

      expect(v.id).toBeDefined();
      testVendorId = v.id;
      expect(storeService.getVendorById(v.id).name).toBe('Schneider Electric Industrial');
    });

    test('updateVendor updates fields or returns null', () => {
      const updated = storeService.updateVendor(testVendorId, { phone: '+91 99999 88888' });
      expect(updated.phone).toBe('+91 99999 88888');

      const nullUpdate = storeService.updateVendor('nonexistent', {});
      expect(nullUpdate).toBeNull();
    });

    test('reviseVendorRating updates scores and history', () => {
      const res = storeService.reviseVendorRating(testVendorId, {
        qualityScore: 92,
        costScore: 90,
        deliveryScore: 94,
        remarks: 'Consistent high delivery quality',
      });

      expect(res).toBeDefined();
      expect(res.updatedVendor.latestRatingRevision).toBeDefined();

      const nullRevise = storeService.reviseVendorRating('nonexistent', { qualityScore: 90, costScore: 90, deliveryScore: 90 });
      expect(nullRevise).toBeNull();
    });

    // addVendor no longer auto-fires onboarding provisioning itself (see
    // provisionVendorOnboarding's comment) — its only caller, createVendor's
    // controller, now awaits provisionVendorOnboarding explicitly after
    // addVendor returns. These tests call it the same way.
    test('addVendor starts onboardingEmailStatus pending; provisionVendorOnboarding sends a real invite', async () => {
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({});
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      try {
        const v = storeService.addVendor(
          { name: 'Invited By Buyer Co', contactPerson: 'Priya', email: 'invited-by-buyer@example.com', majorCategory: 'Fasteners' },
          'buyer@example.com'
        );

        // Starts pending — addVendor itself never provisions anymore.
        expect(v.onboardingEmailStatus).toBe('pending');

        await storeService.provisionVendorOnboarding(v, 'buyer@example.com');

        expect(identitySpy).toHaveBeenCalledWith(expect.objectContaining({
          email: 'invited-by-buyer@example.com',
          fullName: 'Priya',
          organizationName: 'Invited By Buyer Co',
          createdBy: 'buyer@example.com',
        }));
        expect(sendSpy).toHaveBeenCalled();
        expect(storeService.getVendorById(v.id).onboardingEmailStatus).toBe('sent');
      } finally {
        identitySpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    // Found live: identityQueries.insertVendorAccount resets password+phone
    // on an *existing* identity account (correct for the CLI provisioning
    // script it also serves, wrong here) — provisioning for an email that
    // already has a real login would silently clobber that login's real
    // password with a random one the vendor was never told. Confirmed
    // reproducing exactly this against a real deployed account.
    test('provisionVendorOnboarding never touches identity when an account already exists for the email', async () => {
      const findSpy = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'existing-user-uuid' });
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({});
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      try {
        const v = storeService.addVendor({ name: 'Already Has Login Co', email: 'already-has-login@example.com', majorCategory: 'Fasteners' });
        await storeService.provisionVendorOnboarding(v);

        expect(findSpy).toHaveBeenCalledWith('already-has-login@example.com');
        expect(identitySpy).not.toHaveBeenCalled();
        expect(sendSpy).not.toHaveBeenCalled();
        // Left exactly as addVendor's own default set it — never touched
        // again by the (skipped) onboarding path.
        expect(storeService.getVendorById(v.id).onboardingEmailStatus).toBe('pending');
      } finally {
        findSpy.mockRestore();
        identitySpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    test('provisionVendorOnboarding marks the invite failed (not silently pending) when the onboarding email fails to send', async () => {
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({});
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: false, reason: 'SMTP down' });

      try {
        const v = storeService.addVendor({ name: 'Failed Send Co', email: 'failed-send@example.com', majorCategory: 'Fasteners' });
        await storeService.provisionVendorOnboarding(v);

        expect(storeService.getVendorById(v.id).onboardingEmailStatus).toBe('failed');
      } finally {
        identitySpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    test('provisionVendorOnboarding never sends the onboarding email if the identity account could not be created after retrying (no broken credentials mailed out)', async () => {
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockRejectedValue(new Error('ETIMEDOUT'));
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      try {
        const v = storeService.addVendor({ name: 'Identity Down Co', email: 'identity-down@example.com', majorCategory: 'Fasteners' });
        await storeService.provisionVendorOnboarding(v);

        expect(identitySpy).toHaveBeenCalledTimes(2); // one retry
        expect(sendSpy).not.toHaveBeenCalled();
        expect(storeService.getVendorById(v.id).onboardingEmailStatus).toBe('failed');
      } finally {
        identitySpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    test('addVendor with no email never attempts an onboarding invite', async () => {
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({});
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      try {
        const v = storeService.addVendor({ name: 'No Email Co', majorCategory: 'Fasteners' });
        await new Promise((resolve) => setImmediate(resolve));

        expect(v.onboardingEmailStatus).toBe('sent');
        expect(identitySpy).not.toHaveBeenCalled();
        expect(sendSpy).not.toHaveBeenCalled();
      } finally {
        identitySpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    test('deleteVendor removes vendor', () => {
      const res = storeService.deleteVendor(testVendorId);
      expect(res).toBe(true);

      const failDelete = storeService.deleteVendor('nonexistent');
      expect(failDelete).toBe(false);
    });
  });

  describe('confirmVendorPersisted (surfaces a Postgres write failure that addVendor itself does not)', () => {
    test('no-ops when no DB pool is configured', async () => {
      const vendor = storeService.addVendor({ name: 'No Pool Vendor', email: 'no-pool-confirm@example.com', majorCategory: 'Fasteners' });
      await expect(storeService.confirmVendorPersisted(vendor)).resolves.toEqual({ persisted: null });
    });

    test('rolls back the in-memory vendor and throws a 409 on a real duplicate-email conflict', async () => {
      const vendor = storeService.addVendor({ name: 'Conflict Vendor', email: 'conflict-confirm@example.com', majorCategory: 'Fasteners' });
      const originalPool = domainPool.pool;
      domainPool.pool = { query: jest.fn() };
      const conflictErr = new Error('duplicate key value violates unique constraint "vendors_email_key"');
      conflictErr.code = '23505';
      const spy = jest.spyOn(domainQueries, 'upsertVendorInDB').mockRejectedValue(conflictErr);

      try {
        await expect(storeService.confirmVendorPersisted(vendor)).rejects.toMatchObject({ statusCode: 409 });
        expect(storeService.getVendorById(vendor.id, 'all')).toBeUndefined();
      } finally {
        domainPool.pool = originalPool;
        spy.mockRestore();
      }
    });

    test('leaves the in-memory vendor in place and throws a 500 on an unrelated DB failure', async () => {
      const vendor = storeService.addVendor({ name: 'DB Down Vendor', email: 'db-down-confirm@example.com', majorCategory: 'Fasteners' });
      const originalPool = domainPool.pool;
      domainPool.pool = { query: jest.fn() };
      const spy = jest.spyOn(domainQueries, 'upsertVendorInDB').mockRejectedValue(new Error('ECONNREFUSED'));

      try {
        await expect(storeService.confirmVendorPersisted(vendor)).rejects.toMatchObject({ statusCode: 500 });
        expect(storeService.getVendorById(vendor.id, 'all')).toBeDefined();
      } finally {
        domainPool.pool = originalPool;
        spy.mockRestore();
      }
    });

    test('resolves persisted:true when the write actually succeeds', async () => {
      const vendor = storeService.addVendor({ name: 'Real Write Vendor', email: 'real-write-confirm@example.com', majorCategory: 'Fasteners' });
      const originalPool = domainPool.pool;
      domainPool.pool = { query: jest.fn() };
      const spy = jest.spyOn(domainQueries, 'upsertVendorInDB').mockResolvedValue(vendor);

      try {
        await expect(storeService.confirmVendorPersisted(vendor)).resolves.toEqual({ persisted: true });
      } finally {
        domainPool.pool = originalPool;
        spy.mockRestore();
      }
    });
  });

  describe('Bulk Vendor Import', () => {
    function row(overrides = {}) {
      return {
        rowNumber: 1,
        name: 'Hydrocare Fluid Power Systems',
        contactPerson: 'Hydrocare',
        email: 'hydrocare@example.com',
        phone: '9243047807',
        majorCategory: 'Hoses, Valves & Fittings',
        city: 'Bengaluru',
        state: 'Karnataka',
        gstin: '29AAAPL5929R1ZX',
        pincode: '560047',
        products: 'Hydraulic Pumps, Valves',
        ...overrides,
      };
    }

    // Neon is the single source of truth for vendors — bulkAddVendors now
    // refuses to run at all without a configured DB pool (throws a 500
    // rather than silently keeping the import in memory only), so every
    // test below simulates a real, connected pool and a successful insert.
    let originalPool;
    beforeEach(() => {
      originalPool = domainPool.pool;
      domainPool.pool = { query: jest.fn() }; // truthy sentinel: "a pool is configured"
      jest.spyOn(domainQueries, 'bulkInsertVendorsInDB').mockImplementation(async (vendors) =>
        vendors.map((v) => v.email)
      );
      // getVendors() re-syncs from Neon whenever a pool is configured; mocked
      // to resolve empty so it's a no-op against the in-memory store these
      // tests are actually exercising.
      jest.spyOn(domainQueries, 'getVendorsFromDB').mockResolvedValue([]);
    });
    afterEach(() => {
      domainPool.pool = originalPool;
      jest.restoreAllMocks();
    });

    test('throws a 500 error instead of importing in memory when no DB pool is configured', async () => {
      domainPool.pool = null;
      await expect(storeService.bulkAddVendors([row({ rowNumber: 1, email: 'no-db@example.com' })])).rejects.toMatchObject({
        statusCode: 500,
      });
      expect((await storeService.getVendors()).some((v) => v.email === 'no-db@example.com')).toBe(false);
    });

    test('imports valid, distinct rows and reflects them in getVendors', async () => {
      const before = (await storeService.getVendors()).length;
      const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([
        row({ rowNumber: 1, email: 'bulk-a@example.com' }),
        row({ rowNumber: 2, email: 'bulk-b@example.com', name: '3S Industries' }),
      ]);

      expect(importedCount).toBe(2);
      expect(duplicateCount).toBe(0);
      expect(results.every((r) => r.status === 'imported')).toBe(true);
      expect((await storeService.getVendors()).length).toBe(before + 2);
      expect((await storeService.getVendors()).some((v) => v.email === 'bulk-a@example.com')).toBe(true);
    });

    test('flags a row whose email already exists in the store as a duplicate, without re-importing it', async () => {
      const existing = storeService.addVendor({ name: 'Existing Co', email: 'already-here@example.com', majorCategory: 'Mechanical' });

      const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([
        row({ rowNumber: 5, email: existing.email }),
      ]);

      expect(importedCount).toBe(0);
      expect(duplicateCount).toBe(1);
      expect(results[0]).toMatchObject({ rowNumber: 5, status: 'duplicate' });
      // Not a second vendor row for the same email.
      expect((await storeService.getVendors()).filter((v) => v.email === existing.email)).toHaveLength(1);
    });

    test('flags the second occurrence of the same email within one upload as a duplicate, keeping only the first', async () => {
      const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([
        row({ rowNumber: 1, email: 'repeat@example.com', name: 'First Occurrence' }),
        row({ rowNumber: 2, email: 'repeat@example.com', name: 'Second Occurrence' }),
      ]);

      expect(importedCount).toBe(1);
      expect(duplicateCount).toBe(1);
      expect(results.find((r) => r.rowNumber === 1).status).toBe('imported');
      expect(results.find((r) => r.rowNumber === 2)).toMatchObject({ status: 'duplicate', reason: expect.stringContaining('within the uploaded file') });
    });

    test('an empty batch imports nothing without touching the store', async () => {
      const before = (await storeService.getVendors()).length;
      const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([]);
      expect(results).toEqual([]);
      expect(importedCount).toBe(0);
      expect(duplicateCount).toBe(0);
      expect((await storeService.getVendors()).length).toBe(before);
    });

    test('when a DB pool is configured, a row the bulk INSERT silently skipped (a race-condition duplicate) is reported as duplicate, not imported', async () => {
      const originalPool = domainPool.pool;
      const spy = jest.spyOn(domainQueries, 'bulkInsertVendorsInDB').mockResolvedValue([]);
      domainPool.pool = { query: jest.fn() }; // truthy sentinel: "a pool is configured"

      try {
        const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([
          row({ rowNumber: 9, email: 'raced-out@example.com' }),
        ]);

        expect(importedCount).toBe(0);
        expect(duplicateCount).toBe(1);
        expect(results[0]).toMatchObject({ rowNumber: 9, status: 'duplicate', email: 'raced-out@example.com' });
        expect((await storeService.getVendors()).some((v) => v.email === 'raced-out@example.com')).toBe(false);
      } finally {
        domainPool.pool = originalPool;
        spy.mockRestore();
      }
    });

    test('imports rows with no email at all, tagging them missingEmail and never counting them as duplicates of each other', async () => {
      const { results, importedCount, duplicateCount, missingEmailCount } = await storeService.bulkAddVendors([
        row({ rowNumber: 1, email: undefined, name: 'No Email Co One' }),
        row({ rowNumber: 2, email: undefined, name: 'No Email Co Two' }),
      ]);

      expect(importedCount).toBe(2);
      expect(duplicateCount).toBe(0);
      expect(missingEmailCount).toBe(2);
      expect(results.every((r) => r.status === 'imported' && r.missingEmail === true)).toBe(true);

      const imported = await storeService.getVendors();
      expect(imported.find((v) => v.name === 'No Email Co One').email).toBeNull();
      expect(imported.find((v) => v.name === 'No Email Co Two').email).toBeNull();
    });

    // Same real bug as addVendor's — bulkAddVendors shares insertVendorAccount's
    // password-reset-on-existing-account behavior via its own onboarding call.
    test('bulk-imported row never touches identity when an account already exists for the email', async () => {
      const findSpy = jest
        .spyOn(identityQueries, 'findExistingUsernames')
        .mockResolvedValue(new Set(['bulk-already-has-login@example.com']));
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({});
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      try {
        await storeService.bulkAddVendors([row({ rowNumber: 1, email: 'bulk-already-has-login@example.com' })]);
        await new Promise((resolve) => setImmediate(resolve));

        expect(findSpy).toHaveBeenCalledWith(['bulk-already-has-login@example.com']);
        expect(identitySpy).not.toHaveBeenCalled();
        expect(sendSpy).not.toHaveBeenCalled();
      } finally {
        findSpy.mockRestore();
        identitySpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    test('imported vendors carry the source-tracking and default fields a bulk-Excel import implies', async () => {
      await storeService.bulkAddVendors([row({ rowNumber: 1, email: 'tagged@example.com' })]);
      const created = (await storeService.getVendors()).find((v) => v.email === 'tagged@example.com');
      expect(created).toMatchObject({
        source: 'excel',
        status: 'REGISTERED / NOT EVALUATED',
        evaluated: false,
        gstin: '29AAAPL5929R1ZX',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560047',
      });
    });
  });

  describe('RFQ Lifecycle', () => {
    let rfqId;

    test('createRFQ dispatches chaser logs', () => {
      const prevFeedCount = storeService.getAIFeed().length;
      const rfq = storeService.createRFQ({
        title: 'Structural Steel Beams',
        category: 'Raw Material',
        assignedVendors: [
          { name: 'Steel Corp', contactPerson: 'Arun', phone: '+91 99999 11111' },
        ],
      });

      expect(rfq.rfqNumber).toBeDefined();
      rfqId = rfq.id;
      expect(storeService.getAIFeed().length).toBeGreaterThan(prevFeedCount);
      expect(storeService.getRFQById(rfq.id)).toBeDefined();
      expect(storeService.getRFQById('invalid-id')).toBeUndefined();
    });

    test('createRFQ attributes the RFQ to the requesting buyer account, not the global active one', () => {
      const requestingBuyerAccount = storeService.addBuyerAccount({
        organizationName: 'Attribution Test Co',
        corporateEmail: 'attribution-test@example.com',
      });

      const rfq = storeService.createRFQ(
        { title: 'Attribution Test RFQ', category: 'Raw Material' },
        requestingBuyerAccount
      );

      expect(rfq.buyerAccountId).toBe(requestingBuyerAccount.id);
      expect(rfq.buyerAccountName).toBe('Attribution Test Co');
      expect(rfq.buyerAccountId).not.toBe(
        storeService.getActiveBuyerAccount() && storeService.getActiveBuyerAccount().id
      );
    });

    test('createRFQ falls back to the global active buyer account when no requesting account is given', () => {
      const rfq = storeService.createRFQ({ title: 'No Requester RFQ', category: 'Raw Material' });
      const active = storeService.getActiveBuyerAccount();
      expect(rfq.buyerAccountId).toBe(active ? active.id : null);
    });

    test('createRFQ preserves real extractedEntities instead of silently dropping them into the legacy lineItems shape', () => {
      const entities = [{ id: 'e1', itemName: 'Steel Beam', quantity: 5, unit: 'Units', confidence: 90 }];
      const rfq = storeService.createRFQ({
        title: 'Line Item Preservation RFQ',
        category: 'Raw Material',
        extractedEntities: entities,
      });
      expect(rfq.extractedEntities).toEqual(entities);
    });

    // ── Attachments and provenance ────────────────────────────────────────────
    // These four fields were absent from the object createRFQ builds, so they were
    // silently dropped on every save: the stored RFQ came back with a null
    // `source` and a null `sourceFileName`, which left the details screen unable
    // to say where a record came from, and made the ingestion wizard's documented
    // fallback for the uploaded document impossible.
    test('createRFQ persists the attachment metadata it is given', () => {
      const attachment = {
        id: 'att-1',
        fileName: 'boq-pumps.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 2048,
        uploadedAt: '2026-09-05T06:00:00.000Z',
      };

      const rfq = storeService.createRFQ({
        title: 'Attachment RFQ',
        category: 'Raw Material',
        attachments: [attachment],
      });

      expect(rfq.attachments).toEqual([attachment]);
    });

    test('createRFQ defaults attachments to an empty list when none are supplied', () => {
      const rfq = storeService.createRFQ({ title: 'No Attachment RFQ', category: 'Raw Material' });
      expect(rfq.attachments).toEqual([]);
    });

    test('createRFQ ignores a non-array attachments value rather than storing it', () => {
      const rfq = storeService.createRFQ({
        title: 'Bad Attachment RFQ',
        category: 'Raw Material',
        attachments: 'not-an-array',
      });
      expect(rfq.attachments).toEqual([]);
    });

    test('createRFQ retains the document provenance fields', () => {
      const rfq = storeService.createRFQ({
        title: 'Provenance RFQ',
        category: 'Raw Material',
        source: 'web_portal',
        sourceFileName: 'boq-pumps.xlsx',
        sourceEmail: 'project.procurement@example.com',
      });

      expect(rfq.source).toBe('web_portal');
      expect(rfq.sourceFileName).toBe('boq-pumps.xlsx');
      expect(rfq.sourceEmail).toBe('project.procurement@example.com');
    });

    test('createRFQ reports absent provenance as null rather than undefined', () => {
      // Persisted as JSONB, where an undefined key vanishes entirely and an
      // explicit null round-trips — so the details screen can distinguish
      // "not recorded" from "field does not exist on this record".
      const rfq = storeService.createRFQ({ title: 'Bare RFQ', category: 'Raw Material' });

      expect(rfq.source).toBeNull();
      expect(rfq.sourceFileName).toBeNull();
      expect(rfq.sourceEmail).toBeNull();
    });

    test('createRFQ stamps raisedByEmail from the requesting buyer account', () => {
      const account = { id: 'buyer-acc-raised', organizationName: 'Raised Co', corporateEmail: 'raiser@co.com' };
      const rfq = storeService.createRFQ({ title: 'Raised RFQ', category: 'Raw Material' }, account);

      expect(rfq.raisedByEmail).toBe('raiser@co.com');
    });

    test('createRFQ defaults an unset status to a real, valid RFQ status', () => {
      const rfq = storeService.createRFQ({ title: 'Default Status RFQ', category: 'Raw Material' });
      expect(rfq.status).toBe('Quotes Pending');
    });

    test('getBuyerAccountByEmail resolves case-insensitively, and returns null when unmatched or unset', async () => {
      const acc = storeService.addBuyerAccount({
        organizationName: 'Lookup Test Co',
        corporateEmail: 'Lookup-Test@Example.com',
      });
      expect(await storeService.getBuyerAccountByEmail('lookup-test@example.com')).toEqual(acc);
      expect(await storeService.getBuyerAccountByEmail('nobody@example.com')).toBeNull();
      expect(await storeService.getBuyerAccountByEmail(undefined)).toBeNull();
    });

    test('processHistoricalPurchaseData attributes its audit log to the requesting buyer account, not the global active one', async () => {
      const requestingBuyerAccount = storeService.addBuyerAccount({
        organizationName: 'Historical Ingest Test Co',
        corporateEmail: 'historical-ingest@example.com',
      });

      await storeService.processHistoricalPurchaseData(
        '1_year',
        [{ companyName: 'Some Vendor', email: 'vendor@some.co' }],
        requestingBuyerAccount
      );

      const lastLog = storeService.getAuditLogs()[0];
      expect(lastLog.userEmail).toBe('historical-ingest@example.com');
    });

    // Same real bug as addVendor's/bulkAddVendors' — this path had its own,
    // slightly different copy of the vulnerable code (it already checked
    // insertVendorAccount's `result.created` afterward and logged a warning,
    // but the password reset had already happened by then; that check was
    // too late to prevent it).
    test('a historical vendor row never touches identity when an account already exists for the email', async () => {
      const findSpy = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'existing-user-uuid' });
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: true });
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      try {
        await storeService.processHistoricalPurchaseData(
          '1_year',
          [{ companyName: 'Historical Already-Login Co', email: 'historical-already-login@example.com' }]
        );
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        expect(findSpy).toHaveBeenCalledWith('historical-already-login@example.com');
        expect(identitySpy).not.toHaveBeenCalled();
        expect(sendSpy).not.toHaveBeenCalled();
      } finally {
        findSpy.mockRestore();
        identitySpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    test('processHistoricalPurchaseData rolls back a row whose Postgres write collides with an existing email (409) and reports it as skipped', async () => {
      const requestingBuyerAccount = storeService.addBuyerAccount({
        organizationName: 'Rollback Ingest Test Co',
        corporateEmail: 'rollback-ingest@example.com',
      });
      const originalPool = domainPool.pool;
      domainPool.pool = { query: jest.fn() };
      const conflictErr = new Error('duplicate key value violates unique constraint "vendors_email_key"');
      conflictErr.code = '23505';
      const spy = jest.spyOn(domainQueries, 'upsertVendorInDB').mockRejectedValue(conflictErr);

      try {
        const res = await storeService.processHistoricalPurchaseData(
          '1_year',
          [{ companyName: 'Colliding Hist Co', email: 'colliding-hist@example.com' }],
          requestingBuyerAccount
        );
        expect(res.importedCount).toBe(0);
        expect(res.skippedCount).toBe(1);
        expect(res.skipped[0].reason).toBe('A vendor with the email colliding-hist@example.com already exists.');
        expect(storeService.vendors.some((v) => v.email === 'colliding-hist@example.com')).toBe(false);
      } finally {
        domainPool.pool = originalPool;
        spy.mockRestore();
      }
    });

    test('processHistoricalPurchaseData rolls back a row on an unrelated DB failure (500) and reports it as skipped', async () => {
      const requestingBuyerAccount = storeService.addBuyerAccount({
        organizationName: 'DB Down Ingest Test Co',
        corporateEmail: 'db-down-ingest@example.com',
      });
      const originalPool = domainPool.pool;
      domainPool.pool = { query: jest.fn() };
      const spy = jest.spyOn(domainQueries, 'upsertVendorInDB').mockRejectedValue(new Error('ECONNREFUSED'));

      try {
        const res = await storeService.processHistoricalPurchaseData(
          '1_year',
          [{ companyName: 'DB Down Hist Co', email: 'db-down-hist@example.com' }],
          requestingBuyerAccount
        );
        expect(res.importedCount).toBe(0);
        expect(res.skippedCount).toBe(1);
        expect(res.skipped[0].reason).toBe('Could not be saved — try again.');
        expect(storeService.vendors.some((v) => v.email === 'db-down-hist@example.com')).toBe(false);
      } finally {
        domainPool.pool = originalPool;
        spy.mockRestore();
      }
    });

    test('processHistoricalPurchaseData sends an onboarding reminder for a row that already exists within the same buyer scope', async () => {
      const requestingBuyerAccount = storeService.addBuyerAccount({
        organizationName: 'Repeat Ingest Test Co',
        corporateEmail: 'repeat-ingest@example.com',
      });
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      try {
        const first = await storeService.processHistoricalPurchaseData(
          '1_year',
          [{ companyName: 'Repeat Vendor Co', email: 'repeat-vendor@example.com' }],
          requestingBuyerAccount
        );
        expect(first.importedCount).toBe(1);

        const second = await storeService.processHistoricalPurchaseData(
          '1_year',
          [{ companyName: 'Repeat Vendor Co', email: 'repeat-vendor@example.com' }],
          requestingBuyerAccount
        );
        expect(second.importedCount).toBe(0);
        expect(second.skippedCount).toBe(0);
        await new Promise((resolve) => setImmediate(resolve));
        expect(sendSpy).toHaveBeenCalled();
      } finally {
        sendSpy.mockRestore();
      }
    });

    // Step 5 of the buyer setup wizard previews "Template A" (PO-history
    // match) / "Template B" (no match) per vendor — these pin that the real
    // send actually honors what was previewed, instead of always sending the
    // generic onboarding email regardless of categoriesMappedByBuyer.
    test('processHistoricalPurchaseData sends Template A to a vendor the buyer mapped from PO history', async () => {
      const findSpy = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: true });
      const categoryMappedSpy = jest
        .spyOn(mailerService, 'buildVendorCategoryMappingEmail')
        .mockReturnValue({ to: 'mapped-hist@example.com', subject: 'Template A', html: '<p>A</p>' });
      const selfMapSpy = jest.spyOn(mailerService, 'buildVendorSelfMappingEmail');
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      try {
        await storeService.processHistoricalPurchaseData('1_year', [
          {
            companyName: 'Mapped Hist Co',
            email: 'mapped-hist@example.com',
            phone: '+91 98765 43210',
            categoriesMappedByBuyer: true,
            majorCategory: 'Industrial Valves',
            minorCategories: ['Ball Valves'],
          },
        ]);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        expect(categoryMappedSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            majorCategory: 'Industrial Valves',
            minorCategories: ['Ball Valves'],
            contactPhone: '+91 98765 43210',
          })
        );
        expect(selfMapSpy).not.toHaveBeenCalled();
      } finally {
        findSpy.mockRestore();
        identitySpy.mockRestore();
        categoryMappedSpy.mockRestore();
        selfMapSpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    test('processHistoricalPurchaseData sends Template B to a vendor with no PO history match', async () => {
      const findSpy = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: true });
      const categoryMappedSpy = jest.spyOn(mailerService, 'buildVendorCategoryMappingEmail');
      const selfMapSpy = jest
        .spyOn(mailerService, 'buildVendorSelfMappingEmail')
        .mockReturnValue({ to: 'unmapped-hist@example.com', subject: 'Template B', html: '<p>B</p>' });
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      try {
        await storeService.processHistoricalPurchaseData('1_year', [
          {
            companyName: 'Unmapped Hist Co',
            email: 'unmapped-hist@example.com',
            phone: '+91 98765 43210',
            categoriesMappedByBuyer: false,
          },
        ]);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        expect(selfMapSpy).toHaveBeenCalledWith(expect.objectContaining({ contactPhone: '+91 98765 43210' }));
        expect(categoryMappedSpy).not.toHaveBeenCalled();
      } finally {
        findSpy.mockRestore();
        identitySpy.mockRestore();
        categoryMappedSpy.mockRestore();
        selfMapSpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    test('processHistoricalPurchaseData dispatches both Template A and B in a single action and tracks failures and deduplication on retry', async () => {
      const findSpy = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const identitySpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: true });
      const categoryMappedSpy = jest
        .spyOn(mailerService, 'buildVendorCategoryMappingEmail')
        .mockImplementation(({ to }) => ({ to, subject: 'Template A', html: '<p>A</p>' }));
      const selfMapSpy = jest
        .spyOn(mailerService, 'buildVendorSelfMappingEmail')
        .mockImplementation(({ to }) => ({ to, subject: 'Template B', html: '<p>B</p>' }));
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockImplementation(async (payload) => {
        if (payload.to === 'failing-vendor@example.com') {
          return { sent: false, reason: 'Mailbox full' };
        }
        return { sent: true };
      });

      try {
        const result = await storeService.processHistoricalPurchaseData('2_years', [
          {
            companyName: 'Mapped Supplier Co',
            email: 'mapped-both@example.com',
            categoriesMappedByBuyer: true,
            majorCategory: 'Mechanical',
            minorCategories: ['Valves'],
          },
          {
            companyName: 'Unmapped Supplier Co',
            email: 'unmapped-both@example.com',
            categoriesMappedByBuyer: false,
          },
          {
            companyName: 'Failing Email Supplier Co',
            email: 'failing-vendor@example.com',
            categoriesMappedByBuyer: false,
          },
          {
            companyName: 'Invalid Email Supplier Co',
            email: 'invalid-email-address',
            categoriesMappedByBuyer: true,
          },
        ]);

        expect(result.success).toBe(true);
        expect(result.totalProcessed).toBe(4);
        expect(result.mappedCount).toBe(2);
        expect(result.unmappedCount).toBe(2);
        expect(result.mappedEmailsSent).toBe(1);
        expect(result.unmappedEmailsSent).toBe(1);
        expect(result.failedEmailCount).toBe(2);
        expect(result.overallStatus).toBe('COMPLETED_WITH_FAILURES');
        expect(categoryMappedSpy).toHaveBeenCalled();
        expect(selfMapSpy).toHaveBeenCalled();

        // Safe retry: previously sent vendors must not be emailed again
        const retryResult = await storeService.processHistoricalPurchaseData('2_years', [
          {
            companyName: 'Mapped Supplier Co',
            email: 'mapped-both@example.com',
            categoriesMappedByBuyer: true,
            majorCategory: 'Mechanical',
            minorCategories: ['Valves'],
          },
        ]);
        expect(retryResult.mappedEmailsSent).toBe(1);
      } finally {
        findSpy.mockRestore();
        identitySpy.mockRestore();
        categoryMappedSpy.mockRestore();
        selfMapSpy.mockRestore();
        sendSpy.mockRestore();
      }
    });

    test('updateRFQ & addQuoteToRFQ', () => {
      const updated = storeService.updateRFQ(rfqId, { targetSavings: '20%' });
      expect(updated.targetSavings).toBe('20%');

      const nullUpdate = storeService.updateRFQ('invalid-id', {});
      expect(nullUpdate).toBeNull();

      const quoteRes = storeService.addQuoteToRFQ(rfqId, {
        vendorName: 'Steel Corp',
        unitPrice: 2500,
        totalPrice: 25000,
      });
      expect(quoteRes.quotes.length).toBeGreaterThan(0);

      const failQuote = storeService.addQuoteToRFQ('invalid-id', {});
      expect(failQuote).toBeNull();
    });
  });

  describe('Notifications', () => {
    test('createRFQ raises no notification for a category-only match — an invite is required first', async () => {
      const covering = storeService.addVendor({
        name: 'Pumps R Us',
        email: 'pumps@example.com',
        majorCategory: 'Pumps & Accessories',
        minorCategories: [],
      });
      const minorMatch = storeService.addVendor({
        name: 'Minor Match Co',
        email: 'minor@example.com',
        majorCategory: 'Something Else',
        minorCategories: ['pumps & accessories'], // casing deliberately different
      });

      const rfq = storeService.createRFQ({ title: 'Centrifugal Pumps', category: 'Pumps & Accessories', sourcingMode: 'mode_3' });
      expect(storeService.getNotificationsFor('vendor', covering.id)).toHaveLength(0);
      expect(storeService.getNotificationsFor('vendor', minorMatch.id)).toHaveLength(0);

      // Both are real candidates, and inviting either fires exactly one
      // 'rfq_category_match' notification for that vendor.
      const candidates = storeService.candidateVendorsForRFQ(rfq).map((c) => c.id);
      expect(candidates).toEqual(expect.arrayContaining([covering.id, minorMatch.id]));

      await storeService.inviteVendorsToRFQ(rfq.id, [covering.id], 'cm@ex.com');
      const forCovering = storeService.getNotificationsFor('vendor', covering.id);
      expect(forCovering).toHaveLength(1);
      expect(forCovering[0]).toMatchObject({ recipientType: 'vendor', kind: 'rfq_category_match', rfqNumber: rfq.rfqNumber, read: false });
      expect(storeService.getNotificationsFor('vendor', minorMatch.id)).toHaveLength(0);
      expect(storeService.getUnreadNotificationCountFor('vendor', covering.id)).toBe(1);
    });

    test('createRFQ raises nothing when the RFQ has no category', () => {
      const vendor = storeService.addVendor({
        name: 'No Category Vendor',
        email: 'nocat@example.com',
        majorCategory: 'Raw Material',
        minorCategories: [],
      });
      storeService.createRFQ({ title: 'Uncategorised', category: null });
      expect(storeService.getNotificationsFor('vendor', vendor.id)).toHaveLength(0);
    });

    test('addQuoteToRFQ notifies the RFQ owning buyer, resolved from buyerAccountId', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Quote Notify Co',
        corporateEmail: 'quote-notify@example.com',
      });
      const rfq = storeService.createRFQ({ title: 'Steel', category: 'Raw Material' }, buyer);

      storeService.addQuoteToRFQ(rfq.id, { vendorId: 'v-x', vendorName: 'Bidder Co', unitPrice: 100, totalPrice: 1000 });

      const forBuyer = storeService
        .getNotificationsFor('buyer', buyer.id)
        .filter((n) => n.kind === 'quote_received');
      expect(forBuyer).toHaveLength(1);
      expect(forBuyer[0]).toMatchObject({
        rfqNumber: rfq.rfqNumber,
        meta: { vendorName: 'Bidder Co', totalPrice: 1000 },
      });
    });

    test('addQuoteToRFQ notifies nothing for an RFQ with no owning buyer', () => {
      const before = storeService.notifications.length;
      // createRFQ with no requesting account and no active account resolves
      // buyerAccountId to null.
      const rfq = storeService.createRFQ({ title: 'Ownerless', category: 'Raw Material' });
      if (rfq.buyerAccountId) return; // environment has an active account; skip
      storeService.addQuoteToRFQ(rfq.id, { vendorId: 'v-y', vendorName: 'X', unitPrice: 1 });
      const quoteNotifs = storeService.notifications
        .slice(0, storeService.notifications.length - before)
        .filter((n) => n.kind === 'quote_received');
      expect(quoteNotifs).toHaveLength(0);
    });

    test('markNotificationRead only flips the caller’s own notification', async () => {
      const vendor = storeService.addVendor({
        name: 'Read Test Vendor',
        email: 'readtest@example.com',
        majorCategory: 'Valves',
        minorCategories: [],
      });
      const rfq = storeService.createRFQ({ title: 'Valves RFQ', category: 'Valves' });
      await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');
      const [notification] = storeService.getNotificationsFor('vendor', vendor.id);

      // Wrong recipient id → treated as not found, nothing changes.
      expect(storeService.markNotificationRead(notification.id, 'vendor', 'someone-else')).toBeNull();
      expect(storeService.getNotificationsFor('vendor', vendor.id)[0].read).toBe(false);

      const updated = storeService.markNotificationRead(notification.id, 'vendor', vendor.id);
      expect(updated.read).toBe(true);
      // Idempotent: a second call is a no-op that still returns the row.
      expect(storeService.markNotificationRead(notification.id, 'vendor', vendor.id).read).toBe(true);
    });

    test('markAllNotificationsRead clears every unread notification for one recipient', async () => {
      const vendor = storeService.addVendor({
        name: 'Bulk Read Vendor',
        email: 'bulkread@example.com',
        majorCategory: 'Compressors & Accessories',
        minorCategories: [],
      });
      const rfqA = storeService.createRFQ({ id: 'rfq-bulk-read-a', title: 'Compressor A', category: 'Compressors & Accessories' });
      const rfqB = storeService.createRFQ({ id: 'rfq-bulk-read-b', title: 'Compressor B', category: 'Compressors & Accessories' });
      await storeService.inviteVendorsToRFQ(rfqA.id, [vendor.id], 'cm@ex.com');
      await storeService.inviteVendorsToRFQ(rfqB.id, [vendor.id], 'cm@ex.com');

      expect(storeService.getUnreadNotificationCountFor('vendor', vendor.id)).toBe(2);
      expect(storeService.markAllNotificationsRead('vendor', vendor.id)).toBe(2);
      expect(storeService.getUnreadNotificationCountFor('vendor', vendor.id)).toBe(0);
      // Nothing left to change on a second sweep.
      expect(storeService.markAllNotificationsRead('vendor', vendor.id)).toBe(0);
    });

    test('getNotificationsFor returns an empty list when no recipient id is given', () => {
      expect(storeService.getNotificationsFor('vendor', null)).toEqual([]);
    });

    test('vendorCoversCategory handles a null category, a whitespace category and a vendor with no category arrays', () => {
      const bareVendor = storeService.addVendor({ name: 'Bare Vendor', email: 'bare@example.com', majorCategory: 'Bearings' });
      expect(storeService.vendorCoversCategory(bareVendor, null)).toBe(false);
      expect(storeService.vendorCoversCategory(bareVendor, '   ')).toBe(false);
      expect(storeService.vendorCoversCategory(bareVendor, 'Bearings')).toBe(true);
      // A whitespace-only category on a real RFQ matches nobody.
      storeService.createRFQ({ title: 'Whitespace Category RFQ', category: '   ' });
      expect(storeService.getNotificationsFor('vendor', bareVendor.id)).toHaveLength(0);
    });

    test('addQuoteToRFQ still notifies the buyer for a quote with no vendorId', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'No VendorId Co',
        corporateEmail: 'no-vendorid@example.com',
      });
      const rfq = storeService.createRFQ({ title: 'No VendorId RFQ', category: 'Raw Material' }, buyer);
      storeService.addQuoteToRFQ(rfq.id, { unitPrice: 9, totalPrice: 9 });
      const forBuyer = storeService
        .getNotificationsFor('buyer', buyer.id)
        .filter((n) => n.kind === 'quote_received' && n.rfqNumber === rfq.rfqNumber);
      expect(forBuyer).toHaveLength(1);
    });
  });

  describe('Vendor RFQ visibility (vendorCoversRFQ / candidateVendorsForRFQ / getRFQsForVendor)', () => {
    test('category match alone no longer grants vendorCoversRFQ — only produces a candidate pool', () => {
      const v = storeService.addVendor({ name: 'Signal Vendor', email: 'signal@ex.com', majorCategory: 'Pumps & Accessories' });

      // Not invited, not added by the buyer — category alone is not enough.
      expect(storeService.vendorCoversRFQ(v, { category: 'pumps & accessories' })).toBe(false);
      expect(
        storeService.vendorCoversRFQ(v, {
          category: null,
          extractedEntities: [{ minorCategory: 'Pumps & Accessories' }],
        })
      ).toBe(false);
    });

    test('candidateVendorsForRFQ lists every category-matched vendor, flagging who is already invited', async () => {
      const matched = storeService.addVendor({ name: 'Candidate Vendor', email: 'candidate@ex.com', majorCategory: 'Candidate-Cat' });
      storeService.addVendor({ name: 'Unmatched Vendor', email: 'unmatched@ex.com', majorCategory: 'Some-Other-Cat' });
      const rfq = storeService.createRFQ({ title: 'Candidate pool RFQ', category: 'Candidate-Cat', sourcingMode: 'mode_3' });

      const candidates = storeService.candidateVendorsForRFQ(rfq);
      expect(candidates.map((c) => c.id)).toContain(matched.id);
      expect(candidates.map((c) => c.id)).not.toContain('unmatched');
      expect(candidates.find((c) => c.id === matched.id).alreadyInvited).toBe(false);

      await storeService.inviteVendorsToRFQ(rfq.id, [matched.id], 'cm@ex.com');
      const afterInvite = storeService.candidateVendorsForRFQ(storeService.getRFQById(rfq.id));
      expect(afterInvite.find((c) => c.id === matched.id).alreadyInvited).toBe(true);
    });

    test('a vendor the buyer added sees that buyer’s RFQ only when their own category also covers it', () => {
      const v = storeService.addVendor({
        name: 'Rostered Vendor',
        email: 'rostered@ex.com',
        majorCategory: 'Bearings',
        addedByBuyerCompany: 'Acme Buyer Co',
      });
      // Same buyer, but the RFQ's category has nothing to do with this
      // vendor's own category — a private-roster relationship grants
      // eligibility, it never bypasses relevance (BUGS: Version 1 RFQs were
      // reaching every vendor the buyer had ever uploaded, not just the
      // ones actually relevant to the RFQ).
      expect(storeService.vendorCoversRFQ(v, { category: 'Cables', buyerAccountName: 'Acme Buyer Co' })).toBe(false);
      expect(storeService.vendorCoversRFQ(v, { category: 'Bearings', buyerAccountName: 'Acme Buyer Co' })).toBe(true);
      expect(storeService.vendorCoversRFQ(v, { category: 'Bearings', buyerAccountName: 'Other Co' })).toBe(false);
    });

    test('an explicitly invited vendor (assignedVendors) sees the RFQ regardless of category', () => {
      const v = storeService.addVendor({ name: 'Invited Vendor', email: 'invited@ex.com', majorCategory: 'Bearings' });
      expect(
        storeService.vendorCoversRFQ(v, { category: 'Cables', assignedVendors: [{ email: 'INVITED@ex.com' }] })
      ).toBe(true);
      expect(storeService.vendorCoversRFQ(v, { category: 'Cables', assignedVendors: [{ id: v.id }] })).toBe(true);
    });

    test('a vendor with no category profile at all matches nothing (not even as a candidate)', () => {
      const v = storeService.addVendor({ name: 'No Cat Vendor', email: 'nocat2@ex.com' });
      v.majorCategory = '';
      expect(storeService.vendorCoversRFQ(v, { category: 'Anything' })).toBe(false);
      expect(storeService.candidateVendorsForRFQ({ category: 'Anything' }).map((c) => c.id)).not.toContain(v.id);
    });

    test('getRFQsForVendor only returns invited/added RFQs — category match alone is not enough; an unknown vendor gets []', async () => {
      const v = storeService.addVendor({ name: 'Scope Vendor', email: 'scope@ex.com', majorCategory: 'Valves-Scope-Test' });
      // Explicit distinct ids: createRFQ's default id is `rfq-${Date.now()}`,
      // so two calls in the same millisecond can otherwise collide.
      const notInvited = storeService.createRFQ({ id: 'rfq-scope-test-1', title: 'Valves enquiry, not invited', category: 'Valves-Scope-Test', sourcingMode: 'mode_3' });
      storeService.createRFQ({ id: 'rfq-scope-test-2', title: 'Cables enquiry', category: 'Cables-Scope-Test', sourcingMode: 'mode_3' });

      let visible = storeService.getRFQsForVendor('scope@ex.com');
      expect(visible.map((r) => r.rfqNumber)).not.toContain(notInvited.rfqNumber);

      await storeService.inviteVendorsToRFQ(notInvited.id, [v.id], 'cm@ex.com');
      visible = storeService.getRFQsForVendor('scope@ex.com');
      expect(visible.map((r) => r.rfqNumber)).toContain(notInvited.rfqNumber);
      expect(visible.every((r) => storeService.vendorCoversRFQ(v, r))).toBe(true);
      expect(visible.some((r) => r.title === 'Cables enquiry')).toBe(false);

      expect(storeService.getRFQsForVendor('ghost@nowhere.test')).toEqual([]);
    });

    // Regression coverage for a real production bug: createRFQ's network-wide
    // category-matched auto-invite used to run for BOTH mode_1 and mode_2,
    // even though mode_1 is explicitly advertised to buyers as "🔒 Private
    // Roster Only" / "strictly dispatched to your private, pre-approved
    // supplier network" (ingestion-wizard.tsx) — a vendor never added to a
    // buyer's own roster was silently assigned a mode_1 RFQ anyway. Only
    // mode_2 ("Hybrid Sourcing Pool: Private Roster + AI Routing") is meant
    // to reach out beyond the buyer's own roster.
    test('createRFQ auto-invites category-matched network vendors for mode_2 but never for mode_1', () => {
      const networkVendor = storeService.addVendor({
        name: 'Network Only Vendor',
        email: 'network-only@ex.com',
        majorCategory: 'Mode-Scope-Cat',
      });

      const mode1RFQ = storeService.createRFQ({
        id: 'rfq-mode1-scope-test',
        title: 'Mode 1 enquiry',
        category: 'Mode-Scope-Cat',
        sourcingMode: 'mode_1',
      });
      const mode2RFQ = storeService.createRFQ({
        id: 'rfq-mode2-scope-test',
        title: 'Mode 2 enquiry',
        category: 'Mode-Scope-Cat',
        sourcingMode: 'mode_2',
      });

      expect((mode1RFQ.assignedVendors || []).map((v) => v.id)).not.toContain(networkVendor.id);
      expect((mode2RFQ.assignedVendors || []).map((v) => v.id)).toContain(networkVendor.id);
    });

    test('createRFQ auto-invites category and sub-category matched vendors for an email-sourced RFQ in any sourcing mode', () => {
      const subCatVendor = storeService.addVendor({
        name: 'Email Sub-Category Vendor',
        email: 'email-subcat@ex.com',
        majorCategory: 'Email-Scope-Major',
        minorCategories: ['Email-Scope-Minor'],
      });
      const emailRFQ = storeService.createRFQ({
        id: 'rfq-email-autoinvite-test',
        title: 'Emailed sub-category enquiry',
        category: 'Email-Scope-Major',
        sourcingMode: 'mode_1',
        source: 'email_gateway',
        status: 'Parsing',
        extractedEntities: [{ majorCategory: 'Email-Scope-Major', minorCategory: 'Email-Scope-Minor' }],
      });

      expect((emailRFQ.assignedVendors || []).map((v) => v.id)).toContain(subCatVendor.id);
    });

    test('emailRFQToMatchedVendors still emails vendors on a Parsing RFQ, but not on a Draft one', () => {
      const vendor = storeService.addVendor({
        name: 'Parsing Email Vendor',
        email: 'parsing-email@ex.com',
        majorCategory: 'Parsing-Email-Cat',
      });
      const base = { category: 'Parsing-Email-Cat', extractedEntities: [], rfqNumber: 'RFQ-P', title: 'T', assignedVendors: [{ id: vendor.id, email: vendor.email }] };

      expect(storeService.emailRFQToMatchedVendors({ ...base, status: 'Parsing' })).toBeGreaterThan(0);
      expect(storeService.emailRFQToMatchedVendors({ ...base, status: 'Draft' })).toBe(0);
    });

    test('notifyVendorsOfNewRFQ only fires for a rostered vendor whose own category also matches the RFQ', () => {
      const rostered = storeService.addVendor({
        name: 'Notify Rostered',
        email: 'notifyrostered@ex.com',
        majorCategory: 'Bearings',
        addedByBuyerCompany: 'Notify Roster Buyer',
      });
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Notify Roster Buyer',
        corporateEmail: 'notify-roster@ex.com',
      });
      storeService.createRFQ({ title: 'Off-category but rostered', category: 'Totally-Different-Cat' }, buyer);
      expect(storeService.getNotificationsFor('vendor', rostered.id)).toHaveLength(0);

      storeService.createRFQ({ title: 'On-category and rostered', category: 'Bearings' }, buyer);
      expect(storeService.getNotificationsFor('vendor', rostered.id)).toHaveLength(1);
    });

    test('mode_0 (Version 0) RFQ assigns and is visible ONLY to Procucev platform vendors, excluding private buyer-uploaded vendors', () => {
      const procucevVendor = storeService.addVendor({
        name: 'Procucev Network Vendor',
        email: 'procucev-net@ex.com',
        majorCategory: 'Industrial Fasteners',
        source: 'procucev_network',
      });

      const privateVendor = storeService.addVendor({
        name: 'Private Buyer Vendor',
        email: 'private-vendor@ex.com',
        majorCategory: 'Industrial Fasteners',
        addedByBuyerCompany: 'V0 Test Buyer Org',
        source: 'buyer_uploaded',
      });

      const buyer = storeService.addBuyerAccount({
        organizationName: 'V0 Test Buyer Org',
        corporateEmail: 'v0-test-buyer@ex.com',
        subscriptionPlan: 'free_trial',
      });

      const rfq = storeService.createRFQ({
        title: 'V0 Fasteners Requisition',
        category: 'Industrial Fasteners',
        sourcingMode: 'mode_0',
      }, buyer);

      // Verify vendorCoversRFQ for mode_0
      expect(storeService.vendorCoversRFQ(procucevVendor, rfq)).toBe(true);
      expect(storeService.vendorCoversRFQ(privateVendor, rfq)).toBe(false);

      // Verify assignedVendors contains only Procucev vendors
      const assignedIds = (rfq.assignedVendors || []).map((v) => v.id);
      expect(assignedIds).toContain(procucevVendor.id);
      expect(assignedIds).not.toContain(privateVendor.id);
    });
  });

  describe('inviteVendorsToRFQ (category manager invite flow)', () => {
    let inviteEmailSpy;

    beforeEach(() => {
      storeService.reset();
      storeService.aiFeed = [];
      inviteEmailSpy = jest
        .spyOn(mailerService, 'sendRfqInviteEmail')
        .mockResolvedValue({ sent: false, reason: 'test environment' });
      // getVendors() re-syncs from Neon whenever a pool is configured; guard
      // against any pool.pool state leaked from another test in this file.
      jest.spyOn(domainQueries, 'getVendorsFromDB').mockResolvedValue([]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('returns null for an unknown RFQ', async () => {
      expect(await storeService.inviteVendorsToRFQ('does-not-exist', ['v-1'], 'cm@ex.com')).toBeNull();
    });

    test('skips unknown vendor ids and returns invitedCount 0 when nothing new was added', async () => {
      const rfq = storeService.createRFQ({ title: 'Invite Skip RFQ', category: 'Invite-Skip-Cat' , sourcingMode: 'mode_3' });
      const result = await storeService.inviteVendorsToRFQ(rfq.id, ['ghost-vendor-id'], 'cm@ex.com');
      expect(result).toMatchObject({ updatedRFQ: expect.objectContaining({ id: rfq.id }), invitedCount: 0 });
    });

    // this.vendors is a capped in-memory subset (real vendor tables run to
    // 600k+ rows) — a vendor an id came from (e.g. the CM's D1-backed "All
    // Vendors" search) can be entirely absent from it. Confirmed live: this
    // exact gap made a real invite silently no-op (invitedCount: 0) for a
    // vendor the search had just returned.
    test('falls back to D1 when the vendor id is not in the in-memory cache, and caches it', async () => {
      const domainQueries = require('../src/db/domainQueries');
      const dbVendor = { id: 'db-only-vendor', name: 'DB Only Vendor', email: 'dbonly@ex.com', majorCategory: 'Invite-Skip-Cat' };
      const spy = jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(dbVendor);

      const rfq = storeService.createRFQ({ title: 'Invite DB Fallback RFQ', category: 'Invite-Skip-Cat', sourcingMode: 'mode_3' });
      const result = await storeService.inviteVendorsToRFQ(rfq.id, ['db-only-vendor'], 'cm@ex.com');

      expect(spy).toHaveBeenCalledWith('db-only-vendor');
      expect(result.invitedCount).toBe(1);
      expect(result.updatedRFQ.assignedVendors).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'db-only-vendor', name: 'DB Only Vendor' })])
      );
      // Cached for next time — getVendorById (in-memory only) now finds it
      // without another D1 round trip.
      expect(storeService.getVendorById('db-only-vendor', 'all')).toEqual(dbVendor);
    });

    test('does not invite when the vendor id is unknown to both the cache and D1', async () => {
      const domainQueries = require('../src/db/domainQueries');
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);

      const rfq = storeService.createRFQ({ title: 'Invite Nowhere RFQ', category: 'Invite-Skip-Cat', sourcingMode: 'mode_3' });
      const result = await storeService.inviteVendorsToRFQ(rfq.id, ['truly-unknown'], 'cm@ex.com');

      expect(result.invitedCount).toBe(0);
    });

    test('invites a vendor: grants access, fires the fake chaser feed, a real notification, a real email, and an audit entry', async () => {
      const vendor = storeService.addVendor({ name: 'Invite Flow Vendor', email: 'inviteflow@ex.com', majorCategory: 'Invite-Flow-Cat' });
      const rfq = storeService.createRFQ({ title: 'Invite Flow RFQ', category: 'Invite-Flow-Cat' , sourcingMode: 'mode_3' });
      const feedBefore = storeService.getAIFeed().length;
      const auditBefore = storeService.getAuditLogs().length;

      const result = await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');

      expect(result.invitedCount).toBe(1);
      expect(storeService.vendorCoversRFQ(vendor, result.updatedRFQ)).toBe(true);
      expect(storeService.getAIFeed().length).toBeGreaterThan(feedBefore); // fake chaser feed
      expect(storeService.getAuditLogs().length).toBeGreaterThan(auditBefore);
      expect(storeService.getAuditLogs()[0].action).toContain('Invited 1 vendor(s)');
      const notifs = storeService.getNotificationsFor('vendor', vendor.id);
      expect(notifs).toHaveLength(1);
      expect(inviteEmailSpy).toHaveBeenCalledWith('inviteflow@ex.com', expect.objectContaining({ rfq: expect.objectContaining({ id: rfq.id }) }));
    });

    test('re-inviting an already-invited vendor is a no-op (dedup, no duplicate side effects)', async () => {
      const vendor = storeService.addVendor({ name: 'Dedup Vendor', email: 'dedup@ex.com', majorCategory: 'Dedup-Cat' });
      const rfq = storeService.createRFQ({ title: 'Dedup RFQ', category: 'Dedup-Cat' , sourcingMode: 'mode_3' });

      await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');
      const notifsAfterFirst = storeService.getNotificationsFor('vendor', vendor.id).length;

      const second = await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');
      expect(second.invitedCount).toBe(0);
      expect(storeService.getNotificationsFor('vendor', vendor.id)).toHaveLength(notifsAfterFirst);
    });

    test('skips the email step for an invited vendor with no email address', async () => {
      const vendor = storeService.addVendor({ name: 'No Email Vendor', email: '', majorCategory: 'No-Email-Cat' });
      const rfq = storeService.createRFQ({ title: 'No Email RFQ', category: 'No-Email-Cat' , sourcingMode: 'mode_3' });

      const result = await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');

      expect(result.invitedCount).toBe(1);
      expect(inviteEmailSpy).not.toHaveBeenCalled();
    });

    test('vendorIds that is not an array is treated as empty — invitedCount 0', async () => {
      const rfq = storeService.createRFQ({ title: 'Non-Array Invite RFQ', category: 'Non-Array-Cat' , sourcingMode: 'mode_3' });
      const result = await storeService.inviteVendorsToRFQ(rfq.id, null, 'cm@ex.com');
      expect(result).toEqual({ updatedRFQ: rfq, invitedCount: 0 });
    });

    test('defaults the audit actor when no actorEmail is given', async () => {
      const vendor = storeService.addVendor({ name: 'No Actor Vendor', email: 'noactor@ex.com', majorCategory: 'No-Actor-Cat' });
      const rfq = storeService.createRFQ({ title: 'No Actor RFQ', category: 'No-Actor-Cat' , sourcingMode: 'mode_3' });

      await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id]);

      expect(storeService.getAuditLogs()[0].action).toContain('Invited 1 vendor(s)');
    });

    test('tolerates an RFQ record with no assignedVendors array (legacy data predating the field)', async () => {
      const vendor = storeService.addVendor({ name: 'Legacy Data Vendor', email: 'legacy@ex.com', majorCategory: 'Legacy-Cat' });
      const rfq = storeService.createRFQ({ title: 'Legacy RFQ', category: 'Legacy-Cat' , sourcingMode: 'mode_3' });
      delete storeService.getRFQById(rfq.id).assignedVendors;

      const result = await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');

      expect(result.invitedCount).toBe(1);
    });

    test('the invite notification title falls back to a category signal, then to a generic label', async () => {
      const vendorA = storeService.addVendor({ name: 'Signal Vendor', email: 'signal@ex.com', majorCategory: 'No-Header-Cat' });
      const rfqWithSignal = storeService.createRFQ({
        title: 'No Header RFQ',
        extractedEntities: [{ category: 'No-Header-Cat' }],
        sourcingMode: 'mode_3',
      });
      await storeService.inviteVendorsToRFQ(rfqWithSignal.id, [vendorA.id], 'cm@ex.com');
      const [notifA] = storeService.getNotificationsFor('vendor', vendorA.id);
      expect(notifA.title).toBe('New RFQ in No-Header-Cat');

      const vendorB = storeService.addVendor({ name: 'No Signal Vendor', email: 'nosignal@ex.com', majorCategory: 'Anything' });
      const rfqNoSignal = storeService.createRFQ({ title: 'No Signal RFQ' , sourcingMode: 'mode_3' });
      await storeService.inviteVendorsToRFQ(rfqNoSignal.id, [vendorB.id], 'cm@ex.com');
      const [notifB] = storeService.getNotificationsFor('vendor', vendorB.id);
      expect(notifB.title).toBe('New RFQ in your categories');
    });

    test('logs (does not throw) when the invite email send rejects', async () => {
      inviteEmailSpy.mockRejectedValueOnce(new Error('smtp down'));
      const vendor = storeService.addVendor({ name: 'Invite Fail Vendor', email: 'invitefail@ex.com', majorCategory: 'Invite-Fail-Cat' });
      const rfq = storeService.createRFQ({ title: 'Invite Fail RFQ', category: 'Invite-Fail-Cat' , sourcingMode: 'mode_3' });

      const result = await storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');

      expect(result.invitedCount).toBe(1);
      await new Promise((r) => setImmediate(r)); // let the rejected promise settle
    });

    test('allows Category Manager manual override for mismatched vendor and sends invite without mismatch email', async () => {
      const mismatchEmailSpy = jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue({ sent: true });
      const matchedVendor = storeService.addVendor({ name: 'Matching Vendor', email: 'match@ex.com', majorCategory: 'Mechanical' });
      const mismatchedVendor = storeService.addVendor({ name: 'Mismatched Vendor', email: 'mismatch@ex.com', majorCategory: 'Civil Works' });

      const rfq = storeService.createRFQ({ title: 'Mechanical RFQ', category: 'Mechanical', sourcingMode: 'mode_3' });
      const result = await storeService.inviteVendorsToRFQ(rfq.id, [matchedVendor.id, mismatchedVendor.id], 'cm@ex.com');

      expect(result.invitedCount).toBe(2);
      expect(result.overrideCount).toBe(1);
      expect(result.updatedRFQ.assignedVendors.map((v) => v.id)).toContain(matchedVendor.id);
      expect(result.updatedRFQ.assignedVendors.map((v) => v.id)).toContain(mismatchedVendor.id);
      expect(mismatchEmailSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateAndShortlistVendors', () => {
    test('filters out vendors with category mismatch without sending mismatch emails and records audit log', () => {
      const mismatchEmailSpy = jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue({ sent: true });
      const rfq = storeService.createRFQ({ title: 'Electrical Requisition', category: 'Electrical Equipment' });

      const vendorList = [
        { id: 'v-elec', name: 'Elec Vendor', email: 'elec@ex.com', majorCategory: 'Electrical Equipment' },
        { id: 'v-mech', name: 'Mech Vendor', email: 'mech@ex.com', majorCategory: 'Mechanical & Automation' },
      ];

      const res = storeService.validateAndShortlistVendors(rfq, vendorList, 'buyer@company.com');
      expect(res.shortlisted.map((v) => v.id)).toEqual(['v-elec']);
      expect(res.excluded.map((v) => v.id)).toEqual(['v-mech']);
      expect(mismatchEmailSpy).not.toHaveBeenCalled();
    });
  });

  describe('getVendorByIdWithDBFallback', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('returns the in-memory vendor without touching D1 when it is already cached', async () => {
      const domainQueries = require('../src/db/domainQueries');
      const spy = jest.spyOn(domainQueries, 'getVendorByIdFromDB');
      const vendor = storeService.addVendor({ name: 'Cached Vendor', email: 'cached@ex.com', majorCategory: 'Cache-Cat' });

      const result = await storeService.getVendorByIdWithDBFallback(vendor.id, 'all');

      expect(result).toMatchObject({ id: vendor.id, name: 'Cached Vendor' });
      expect(spy).not.toHaveBeenCalled();
    });

    // this.vendors is a capped, bootstrap-time subset — a real, persisted
    // vendor whose row simply wasn't in that subset previously 404'd on
    // GET /api/vendors/:id (a vendor loading their own profile), which made
    // the frontend treat it as a first-time profile and then hit a real
    // UNIQUE-email conflict on save. Confirmed live against the deployed D1
    // database for a genuinely existing vendor account.
    test('falls back to D1 by id when the vendor is not in the in-memory cache, and caches it', async () => {
      const domainQueries = require('../src/db/domainQueries');
      const dbVendor = { id: 'db-only-profile-vendor', name: 'DB Only Profile Vendor', email: 'dbonlyprofile@ex.com' };
      const idSpy = jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(dbVendor);
      const emailSpy = jest.spyOn(domainQueries, 'getVendorByEmailFromDB');

      const result = await storeService.getVendorByIdWithDBFallback('db-only-profile-vendor', 'all');

      expect(idSpy).toHaveBeenCalledWith('db-only-profile-vendor');
      expect(emailSpy).not.toHaveBeenCalled();
      expect(result).toMatchObject(dbVendor);
      // Cached for next time — a plain in-memory getVendorById now finds it.
      expect(storeService.getVendorById('db-only-profile-vendor', 'all')).toEqual(dbVendor);
    });

    test('falls back to D1 by email when the id lookup misses (a vendor loading their own profile by email)', async () => {
      const domainQueries = require('../src/db/domainQueries');
      const dbVendor = { id: 'real-vendor-id', name: 'Email Lookup Vendor', email: 'emaillookup@ex.com' };
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
      const emailSpy = jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(dbVendor);

      const result = await storeService.getVendorByIdWithDBFallback('emaillookup@ex.com', 'all');

      expect(emailSpy).toHaveBeenCalledWith('emaillookup@ex.com');
      expect(result).toMatchObject(dbVendor);
    });

    test('returns undefined when the vendor is unknown to both the cache and D1', async () => {
      const domainQueries = require('../src/db/domainQueries');
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(null);

      const result = await storeService.getVendorByIdWithDBFallback('truly-unknown-vendor', 'all');

      expect(result).toBeUndefined();
    });

    test('respects scopedBuyerId ownership on the D1-fallback result, same as the in-memory path', async () => {
      const domainQueries = require('../src/db/domainQueries');
      const dbVendor = {
        id: 'scoped-db-vendor',
        name: 'Scoped DB Vendor',
        email: 'scopeddb@ex.com',
        buyerAccountId: 'buyer-acc-owner',
      };
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(dbVendor);

      const unscoped = await storeService.getVendorByIdWithDBFallback('scoped-db-vendor', 'buyer-acc-someone-else');
      expect(unscoped).toBeUndefined();
    });
  });

  describe('Transactional email (RFQ fan-out + quote-received)', () => {
    let inviteSpy;
    let quoteSpy;

    beforeEach(() => {
      inviteSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: false, reason: 'test environment' });
      quoteSpy = jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue({ sent: false, reason: 'test environment' });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('_vendorTierRank orders the plans and treats anything unknown as lowest', () => {
      expect(storeService._vendorTierRank('select')).toBe(3);
      expect(storeService._vendorTierRank('connect')).toBe(2);
      expect(storeService._vendorTierRank('premium')).toBe(1);
      expect(storeService._vendorTierRank('premium_network')).toBe(1);
      expect(storeService._vendorTierRank(undefined)).toBe(0);
      expect(storeService._vendorTierRank('free_trial')).toBe(0);
    });

    test('selectVendorsForRFQEmail ranks by tier, then a pincode match, then rating, and caps at the limit', () => {
      const cat = 'Email-Rank-Cat';
      const mk = (over) =>
        storeService.addVendor({ minorCategories: [], majorCategory: cat, ...over });

      const lowTierPincode = mk({ name: 'Low tier, pincode match', email: 'a@ex.com', subscriptionPlan: 'premium', pincode: '400001', rating: 5 });
      const highTierNoPincode = mk({ name: 'High tier, no pincode', email: 'b@ex.com', subscriptionPlan: 'select', pincode: '999999', rating: 1 });
      const midTierPincode = mk({ name: 'Mid tier, pincode match', email: 'c@ex.com', subscriptionPlan: 'connect', pincode: '400001', rating: 2 });
      mk({ name: 'No email vendor', email: '', subscriptionPlan: 'select', pincode: '400001' });

      // selectVendorsForRFQEmail is downstream of vendorCoversRFQ, which now
      // requires an invite — assignedVendors here stands in for "already
      // invited", isolating this test to the ranking logic itself.
      const rfq = {
        category: cat,
        deliveryPincode: '400001',
        extractedEntities: [],
        assignedVendors: [lowTierPincode, highTierNoPincode, midTierPincode].map((v) => ({ id: v.id })),
      };
      const ranked = storeService.selectVendorsForRFQEmail(rfq, 2);

      expect(ranked).toHaveLength(2);
      expect(ranked[0].id).toBe(highTierNoPincode.id); // tier beats pincode
      expect(ranked[1].id).toBe(midTierPincode.id); // connect+pincode beats premium+pincode
      void lowTierPincode;
    });

    test('createRFQ emails the top matched vendors — an addedByBuyerCompany vendor, no invite needed', () => {
      const cat = 'Email-Create-Cat';
      // addedByBuyerCompany grants immediate coverage without a CM invite, so
      // this is the one case createRFQ's own auto-email call still reaches.
      storeService.addVendor({
        name: 'Emailed Vendor',
        email: 'emailed@ex.com',
        majorCategory: cat,
        minorCategories: [],
        addedByBuyerCompany: 'Email Create Buyer',
      });
      const buyer = storeService.addBuyerAccount({ organizationName: 'Email Create Buyer', corporateEmail: 'ecb@ex.com' });

      storeService.createRFQ({ title: 'Emailed RFQ', category: cat }, buyer);

      expect(inviteSpy).toHaveBeenCalledWith(
        'emailed@ex.com',
        expect.objectContaining({ rfq: expect.objectContaining({ title: 'Emailed RFQ' }) })
      );
    });

    test('emailRFQToMatchedVendors logs (does not throw) when a send rejects', async () => {
      inviteSpy.mockRejectedValueOnce(new Error('smtp down'));
      const cat = 'Email-Fail-Cat';
      const vendor = storeService.addVendor({ name: 'Failing Send Vendor', email: 'fail@ex.com', majorCategory: cat, minorCategories: [] });

      const count = storeService.emailRFQToMatchedVendors({
        category: cat,
        extractedEntities: [],
        rfqNumber: 'RFQ-X',
        title: 'T',
        assignedVendors: [{ id: vendor.id }],
      });
      expect(count).toBe(1);
      await new Promise((r) => setImmediate(r)); // let the rejected promise settle
    });

    test('addQuoteToRFQ emails the owning buyer immediately for email flow RFQ', () => {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Quote Email Buyer', corporateEmail: 'qeb@ex.com' });
      const rfq = storeService.createRFQ({ title: 'Quote Email RFQ', category: 'Raw Material', source: 'email' }, buyer);

      storeService.addQuoteToRFQ(rfq.id, { vendorId: 'v-1', vendorName: 'Bidder', unitPrice: 10, totalPrice: 100 });

      expect(quoteSpy).toHaveBeenCalledWith(
        'qeb@ex.com',
        expect.objectContaining({ quote: expect.objectContaining({ vendorName: 'Bidder' }), recipientName: 'Quote Email Buyer' })
      );
    });

    test('addQuoteToRFQ stops buyer quote email for 48 hours on portal RFQ and schedules delayed dispatch', () => {
      jest.useFakeTimers();
      try {
        const buyer = storeService.addBuyerAccount({ organizationName: 'Portal Buyer', corporateEmail: 'portalbuyer@ex.com' });
        const rfq = storeService.createRFQ({ title: 'Portal RFQ 48h Hold', category: 'Raw Material', source: 'web_portal' }, buyer);

        quoteSpy.mockClear();
        const res = storeService.addQuoteToRFQ(rfq.id, { vendorId: 'v-2', vendorName: 'Portal Bidder', unitPrice: 20, totalPrice: 200 });
        expect(res).not.toBeNull();

        // During 48-hour window, immediate email is stopped
        expect(quoteSpy).not.toHaveBeenCalled();

        // Advance timers by 48 hours
        jest.advanceTimersByTime(48 * 60 * 60 * 1000);

        // After 48 hours, buyer receives quote email
        expect(quoteSpy).toHaveBeenCalledWith(
          'portalbuyer@ex.com',
          expect.objectContaining({ quote: expect.objectContaining({ vendorName: 'Portal Bidder' }), recipientName: 'Portal Buyer' })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    test('emailQuoteToBuyer no-ops without an owning buyer, an unknown buyer, or a buyer with no email', () => {
      expect(storeService.emailQuoteToBuyer({ buyerAccountId: null }, {})).toBe(false);
      expect(storeService.emailQuoteToBuyer({ buyerAccountId: 'does-not-exist' }, {})).toBe(false);

      const emailless = storeService.addBuyerAccount({ organizationName: 'Emailless Buyer' });
      emailless.corporateEmail = '';
      expect(storeService.emailQuoteToBuyer({ buyerAccountId: emailless.id }, {})).toBe(false);
      expect(quoteSpy).not.toHaveBeenCalled();
    });

    test('emailQuoteToBuyer logs (does not throw) when the send rejects', async () => {
      quoteSpy.mockRejectedValueOnce(new Error('smtp down'));
      const buyer = storeService.addBuyerAccount({ organizationName: 'Reject Email Buyer', corporateEmail: 'reb@ex.com' });
      expect(storeService.emailQuoteToBuyer({ buyerAccountId: buyer.id, rfqNumber: 'RFQ-Y', title: 'T', source: 'email' }, { unitPrice: 1 })).toBe(true);
      await new Promise((r) => setImmediate(r));
    });

    test('notifyBuyerOfFinalComparison suppresses final comparison email for portal RFQ within 48h', () => {
      const finalEmailSpy = jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValue({ sent: true });
      const buyer = storeService.addBuyerAccount({ organizationName: 'Portal Buyer 2', corporateEmail: 'pb2@ex.com' });
      const rfq = storeService.createRFQ({ title: 'Portal RFQ 48h Compare', category: 'Raw Material', source: 'portal' }, buyer);

      const result = storeService.notifyBuyerOfFinalComparison(rfq);
      expect(result).toBeNull();
      expect(finalEmailSpy).not.toHaveBeenCalled();
      finalEmailSpy.mockRestore();
    });
  });

  describe('Zoho payment links (createPaymentLinkRecord / activateVendorSubscriptionFromPayment)', () => {
    test('createPaymentLinkRecord persists a new CREATED-status link', async () => {
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-test-1',
        zohoPaymentLinkId: 'zoho-test-1',
        vendorId: 'v-x',
        planId: 'connect',
        amount: 14160,
        paymentUrl: 'https://payments.zoho.in/x',
        status: 'CREATED',
        rawResponse: { some: 'thing' },
      });

      expect(link).toMatchObject({ id: 'pl-test-1', zohoPaymentLinkId: 'zoho-test-1', status: 'CREATED', activated: false });
      await expect(storeService.getPaymentLinkByZohoId('zoho-test-1')).resolves.toMatchObject({ id: 'pl-test-1' });
    });

    test('getPaymentLinkByZohoId falls back to Neon when the in-memory cache misses', async () => {
      const dbLink = { id: 'pl-from-db-1', zohoPaymentLinkId: 'zoho-from-db-1', status: 'CREATED', activated: false };
      const poolModule = require('../src/db/pool');
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = poolModule.pool;
      poolModule.pool = {};
      const spy = jest.spyOn(domainQueries, 'getPaymentLinkByZohoIdFromDB').mockResolvedValueOnce(dbLink);
      try {
        const found = await storeService.getPaymentLinkByZohoId('zoho-from-db-1');
        expect(found).toEqual(dbLink);
        expect(spy).toHaveBeenCalledWith('zoho-from-db-1');
        // Hydrated into memory: a second lookup must not hit the DB again.
        const foundAgain = await storeService.getPaymentLinkByZohoId('zoho-from-db-1');
        expect(foundAgain).toEqual(dbLink);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
        poolModule.pool = originalPool;
      }
    });

    test('getPaymentLinkByZohoId returns null when unconfigured and nothing in memory', async () => {
      const poolModule = require('../src/db/pool');
      const originalPool = poolModule.pool;
      poolModule.pool = null;
      try {
        await expect(storeService.getPaymentLinkByZohoId('zoho-does-not-exist')).resolves.toBeNull();
      } finally {
        poolModule.pool = originalPool;
      }
    });

    test('getPaymentLinkByZohoId returns null when Neon is configured but has no matching row', async () => {
      const poolModule = require('../src/db/pool');
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = poolModule.pool;
      poolModule.pool = {};
      const spy = jest.spyOn(domainQueries, 'getPaymentLinkByZohoIdFromDB').mockResolvedValueOnce(null);
      try {
        await expect(storeService.getPaymentLinkByZohoId('zoho-truly-unknown')).resolves.toBeNull();
      } finally {
        spy.mockRestore();
        poolModule.pool = originalPool;
      }
    });

    test('getPaymentLinksByStatusIn re-syncs from Neon first when configured', async () => {
      const poolModule = require('../src/db/pool');
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = poolModule.pool;
      poolModule.pool = {};
      const dbOnlyLink = { id: 'pl-db-only-1', zohoPaymentLinkId: 'zoho-db-only-1', status: 'CREATED' };
      const spy = jest.spyOn(domainQueries, 'getPaymentLinksFromDB').mockResolvedValueOnce([dbOnlyLink]);
      try {
        const pending = await storeService.getPaymentLinksByStatusIn(['CREATED', 'pending']);
        expect(pending.some((l) => l.id === 'pl-db-only-1')).toBe(true);
      } finally {
        spy.mockRestore();
        poolModule.pool = originalPool;
      }
    });

    test('getPaymentLinksByStatusIn filters by the given statuses', async () => {
      storeService.createPaymentLinkRecord({ id: 'pl-status-a', zohoPaymentLinkId: 'zoho-status-a', vendorId: 'v-x', planId: 'connect', amount: 1, paymentUrl: '', status: 'CREATED' });
      storeService.createPaymentLinkRecord({ id: 'pl-status-b', zohoPaymentLinkId: 'zoho-status-b', vendorId: 'v-x', planId: 'connect', amount: 1, paymentUrl: '', status: 'PAID' });

      const pending = await storeService.getPaymentLinksByStatusIn(['CREATED', 'pending']);
      expect(pending.some((l) => l.id === 'pl-status-a')).toBe(true);
      expect(pending.some((l) => l.id === 'pl-status-b')).toBe(false);
    });

    test('getPaymentLinksForVendor returns only that vendor\'s links, newest first, and re-syncs from Neon when configured', async () => {
      storeService.createPaymentLinkRecord({ id: 'pl-vendor-hist-a', zohoPaymentLinkId: 'z-a', vendorId: 'v-hist', payerType: 'vendor', planId: 'connect', amount: 1, paymentUrl: '', status: 'active' });
      storeService.createPaymentLinkRecord({ id: 'pl-vendor-hist-b', zohoPaymentLinkId: 'z-b', vendorId: 'v-other', payerType: 'vendor', planId: 'connect', amount: 1, paymentUrl: '', status: 'active' });

      const poolModule = require('../src/db/pool');
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = poolModule.pool;
      poolModule.pool = {};
      const dbOnlyLink = { id: 'pl-vendor-hist-db', zohoPaymentLinkId: 'z-db', vendorId: 'v-hist', payerType: 'vendor', status: 'paid' };
      const spy = jest.spyOn(domainQueries, 'getPaymentLinksFromDB').mockResolvedValueOnce([dbOnlyLink]);
      try {
        const links = await storeService.getPaymentLinksForVendor('v-hist');
        expect(links.map((l) => l.id)).toEqual(expect.arrayContaining(['pl-vendor-hist-a', 'pl-vendor-hist-db']));
        expect(links.some((l) => l.id === 'pl-vendor-hist-b')).toBe(false);
      } finally {
        spy.mockRestore();
        poolModule.pool = originalPool;
      }
    });

    test('getPaymentLinksForBuyer returns only that buyer\'s links, newest first, and re-syncs from Neon when configured', async () => {
      storeService.createPaymentLinkRecord({ id: 'pl-buyer-hist-a', zohoPaymentLinkId: 'zb-a', buyerAccountId: 'b-hist', payerType: 'buyer', planId: 'version_1', amount: 1, paymentUrl: '', status: 'active' });
      storeService.createPaymentLinkRecord({ id: 'pl-buyer-hist-b', zohoPaymentLinkId: 'zb-b', buyerAccountId: 'b-other', payerType: 'buyer', planId: 'version_1', amount: 1, paymentUrl: '', status: 'active' });

      const poolModule = require('../src/db/pool');
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = poolModule.pool;
      poolModule.pool = {};
      const dbOnlyLink = { id: 'pl-buyer-hist-db', zohoPaymentLinkId: 'zb-db', buyerAccountId: 'b-hist', payerType: 'buyer', status: 'paid' };
      const spy = jest.spyOn(domainQueries, 'getPaymentLinksFromDB').mockResolvedValueOnce([dbOnlyLink]);
      try {
        const links = await storeService.getPaymentLinksForBuyer('b-hist');
        expect(links.map((l) => l.id)).toEqual(expect.arrayContaining(['pl-buyer-hist-a', 'pl-buyer-hist-db']));
        expect(links.some((l) => l.id === 'pl-buyer-hist-b')).toBe(false);
      } finally {
        spy.mockRestore();
        poolModule.pool = originalPool;
      }
    });

    test('getPaymentLinkById finds an in-memory link, falls back to Neon on a miss, and returns null when unconfigured/not found', async () => {
      storeService.createPaymentLinkRecord({ id: 'pl-byid-mem', zohoPaymentLinkId: 'z-byid-mem', vendorId: 'v-x', planId: 'connect', amount: 1, paymentUrl: '', status: 'active' });
      await expect(storeService.getPaymentLinkById('pl-byid-mem')).resolves.toMatchObject({ id: 'pl-byid-mem' });

      const poolModule = require('../src/db/pool');
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = poolModule.pool;

      poolModule.pool = null;
      await expect(storeService.getPaymentLinkById('pl-byid-unconfigured')).resolves.toBeNull();

      poolModule.pool = {};
      const dbOnlyLink = { id: 'pl-byid-db', zohoPaymentLinkId: 'z-byid-db', status: 'paid' };
      let spy = jest.spyOn(domainQueries, 'getPaymentLinksFromDB').mockResolvedValueOnce([dbOnlyLink]);
      await expect(storeService.getPaymentLinkById('pl-byid-db')).resolves.toEqual(dbOnlyLink);
      spy.mockRestore();

      spy = jest.spyOn(domainQueries, 'getPaymentLinksFromDB').mockResolvedValueOnce([]);
      await expect(storeService.getPaymentLinkById('pl-byid-not-anywhere')).resolves.toBeNull();
      spy.mockRestore();

      poolModule.pool = originalPool;
    });

    test('updatePaymentLinkRecord merges updates and returns null for an unknown id', () => {
      storeService.createPaymentLinkRecord({ id: 'pl-update-1', zohoPaymentLinkId: 'zoho-update-1', vendorId: 'v-x', planId: 'connect', amount: 1, paymentUrl: '', status: 'CREATED' });

      const updated = storeService.updatePaymentLinkRecord('pl-update-1', { status: 'PAID' });
      expect(updated.status).toBe('PAID');
      expect(storeService.updatePaymentLinkRecord('pl-does-not-exist', { status: 'PAID' })).toBeNull();
    });

    test('activateVendorSubscriptionFromPayment grants the plan, resets quota, marks the link activated, and audits it', () => {
      const vendor = storeService.addVendor({ name: 'Payment Flow Vendor', email: 'paymentflow@ex.com', majorCategory: 'Payment-Cat' });
      storeService.updateVendor(vendor.id, { rfqDownloadsUsed: 7 });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-activate-1',
        zohoPaymentLinkId: 'zoho-activate-1',
        vendorId: vendor.id,
        planId: 'select',
        amount: 33040,
        paymentUrl: '',
        status: 'PAID',
      });
      const auditBefore = storeService.getAuditLogs().length;

      const result = storeService.activateVendorSubscriptionFromPayment(link.id);

      expect(result.activated).toBe(true);
      expect(storeService.getVendorById(vendor.id)).toMatchObject({ subscriptionPlan: 'select', rfqDownloadsUsed: 0 });
      expect(storeService.getAuditLogs().length).toBeGreaterThan(auditBefore);
      expect(storeService.getAuditLogs()[0].action).toContain('select');
    });

    test('activateVendorSubscriptionFromPayment is idempotent — a second call is a no-op', () => {
      const vendor = storeService.addVendor({ name: 'Idempotent Vendor', email: 'idempotent@ex.com', majorCategory: 'Payment-Cat' });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-activate-2',
        zohoPaymentLinkId: 'zoho-activate-2',
        vendorId: vendor.id,
        planId: 'connect',
        amount: 14160,
        paymentUrl: '',
        status: 'PAID',
      });

      storeService.activateVendorSubscriptionFromPayment(link.id);
      const auditAfterFirst = storeService.getAuditLogs().length;

      expect(storeService.activateVendorSubscriptionFromPayment(link.id)).toBeNull();
      expect(storeService.getAuditLogs().length).toBe(auditAfterFirst);
    });

    test('activateVendorSubscriptionFromPayment returns null for an unknown payment link id', () => {
      expect(storeService.activateVendorSubscriptionFromPayment('pl-does-not-exist')).toBeNull();
    });

    test('activateVendorSubscriptionFromPayment returns null when the linked vendor no longer exists', () => {
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-activate-3',
        zohoPaymentLinkId: 'zoho-activate-3',
        vendorId: 'v-does-not-exist',
        planId: 'connect',
        amount: 14160,
        paymentUrl: '',
        status: 'PAID',
      });

      expect(storeService.activateVendorSubscriptionFromPayment(link.id)).toBeNull();
    });

    test('activateBuyerSubscriptionFromPayment grants a paid plan, marks the link activated, and audits it', async () => {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Payment Flow Buyer Co', corporateEmail: 'paymentflowbuyer@ex.com' });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-buyer-activate-1',
        zohoPaymentLinkId: 'zoho-buyer-activate-1',
        buyerAccountId: buyer.id,
        payerType: 'buyer',
        planId: 'version_2',
        amount: 47200,
        paymentUrl: '',
        status: 'PAID',
      });
      const auditBefore = storeService.getAuditLogs().length;

      const result = storeService.activateBuyerSubscriptionFromPayment(link.id);

      expect(result.activated).toBe(true);
      expect(await storeService.getBuyerAccountByEmail('paymentflowbuyer@ex.com')).toMatchObject({ subscriptionPlan: 'version_2' });
      expect(storeService.getAuditLogs().length).toBeGreaterThan(auditBefore);
      expect(storeService.getAuditLogs()[0].action).toContain('version_2');
    });

    test('activateBuyerSubscriptionFromPayment resets remainingFreeRFQs to 5 only when the plan is free_trial', async () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Trial Reset Buyer Co',
        corporateEmail: 'trialresetbuyer@ex.com',
        remainingFreeRFQs: 0,
      });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-buyer-activate-2',
        zohoPaymentLinkId: 'zoho-buyer-activate-2',
        buyerAccountId: buyer.id,
        payerType: 'buyer',
        planId: 'free_trial',
        amount: 0,
        paymentUrl: '',
        status: 'PAID',
      });

      storeService.activateBuyerSubscriptionFromPayment(link.id);

      expect(await storeService.getBuyerAccountByEmail('trialresetbuyer@ex.com')).toMatchObject({
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 5,
      });
    });

    test('activateBuyerSubscriptionFromPayment is idempotent — a second call is a no-op', () => {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Idempotent Buyer Co', corporateEmail: 'idempotentbuyer@ex.com' });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-buyer-activate-3',
        zohoPaymentLinkId: 'zoho-buyer-activate-3',
        buyerAccountId: buyer.id,
        payerType: 'buyer',
        planId: 'version_1',
        amount: 18880,
        paymentUrl: '',
        status: 'PAID',
      });

      storeService.activateBuyerSubscriptionFromPayment(link.id);
      const auditAfterFirst = storeService.getAuditLogs().length;

      expect(storeService.activateBuyerSubscriptionFromPayment(link.id)).toBeNull();
      expect(storeService.getAuditLogs().length).toBe(auditAfterFirst);
    });

    test('activateBuyerSubscriptionFromPayment returns null for an unknown payment link id', () => {
      expect(storeService.activateBuyerSubscriptionFromPayment('pl-does-not-exist')).toBeNull();
    });

    test('activateBuyerSubscriptionFromPayment returns null when the linked buyer account no longer exists', () => {
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-buyer-activate-4',
        zohoPaymentLinkId: 'zoho-buyer-activate-4',
        buyerAccountId: 'buyer-does-not-exist',
        payerType: 'buyer',
        planId: 'version_1',
        amount: 18880,
        paymentUrl: '',
        status: 'PAID',
      });

      expect(storeService.activateBuyerSubscriptionFromPayment(link.id)).toBeNull();
    });
  });

  describe('Evaluations & Config', () => {
    test('createEvaluation adds 360 audit record', () => {
      const ev = storeService.createEvaluation({
        vendorName: 'Tata Steel Tubes',
        moduleScores: { quality: { score: 95 } },
      });

      expect(ev.id).toBeDefined();
      expect(storeService.getEvaluations()[0].vendorName).toBe('Tata Steel Tubes');
    });

    test('updateSystemConfig updates and returns config', () => {
      const updated = storeService.updateSystemConfig({ escalationIntervalHours: 48 });
      expect(updated.escalationIntervalHours).toBe(48);
      expect(storeService.getSystemConfig().escalationIntervalHours).toBe(48);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Demo data gating
//
// The demo RFQs land in the same store a buyer's real RFQs do, and the portfolio
// summary derives every KPI from that store, so leaving them on reported
// fabricated spend and vendor engagement next to genuine work.
// ══════════════════════════════════════════════════════════════════════════════
describe('demo RFQ seeding', () => {
  const originalFlag = process.env.SEED_DEMO_RFQS;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.SEED_DEMO_RFQS;
    else process.env.SEED_DEMO_RFQS = originalFlag;
    process.env.NODE_ENV = originalEnv;
    jest.resetModules();
  });

  // The flag and the seed data are gone for good, not merely switched off. A
  // toggle would have left the fabricated RFQs one environment variable away
  // from reappearing in the same collection as a buyer's real work.
  test('the demo RFQ seed toggle no longer exists', () => {
    expect(storeService.shouldSeedDemoRFQs).toBeUndefined();
  });

  // The seed module is deleted outright, not emptied. While it existed, any of
  // its arrays could be repopulated and would land straight back in the same
  // collections a buyer's real records occupy.
  test('the seed module no longer exists', () => {
    expect(() => require('../src/db/seed')).toThrow(/Cannot find module/);
  });

  test.each([['true'], ['false'], [undefined]])(
    'a store built with SEED_DEMO_RFQS=%s starts completely empty',
    (flag) => {
      if (flag === undefined) delete process.env.SEED_DEMO_RFQS;
      else process.env.SEED_DEMO_RFQS = flag;
      jest.resetModules();

      // Re-required so the constructor runs again under this environment. The flag
      // is inert now — there is no seed data left for it to switch on.
      const freshStore = require('../src/services/storeService');

      expect(freshStore.rfqs).toEqual([]);
      expect(freshStore.aiFeed).toEqual([]);
      expect(freshStore.auditLogs).toEqual([]);
      expect(freshStore.vendors).toEqual([]);
      expect(freshStore.evaluations).toEqual([]);
      expect(freshStore.vendorCatalogue).toEqual([]);
      expect(freshStore.buyerAccounts).toEqual([]);
      expect(freshStore.activeBuyerAccount).toBeNull();
    }
  );

  // RFQs are no longer in the bootstrap payload at all. That endpoint is
  // anonymous, and shipping the global RFQ array from it is what put one
  // buyer's RFQs on another buyer's dashboard.
  test('the bootstrap payload carries no RFQs', async () => {
    expect(await storeService.getBootstrapData()).not.toHaveProperty('rfqs');
  });

  describe('getBootstrapData vendor cap', () => {
    test('caps the vendor list and reports the true total separately, but always includes the caller\'s own vendor record even when it falls outside the cap', async () => {
      // Fill past the cap with vendors that sort after (created later than,
      // per created_at DESC ordering) the "own" vendor added first.
      const own = storeService.addVendor({ name: 'My Own Vendor Co', email: 'own-vendor@example.com', majorCategory: 'Fasteners' });
      for (let i = 0; i < 505; i++) {
        storeService.addVendor({ name: `Filler Vendor ${i}`, email: `filler-${i}@example.com`, majorCategory: 'Cables' });
      }

      const withoutSession = await storeService.getBootstrapData();
      expect(withoutSession.vendors.length).toBe(500);
      expect(withoutSession.vendorsTotal).toBeGreaterThanOrEqual(506);
      // The own vendor, created before all the fillers, is pushed outside the
      // most-recent-500 window and is NOT force-included without a session.
      expect(withoutSession.vendors.some((v) => v.email === own.email)).toBe(false);

      const withSession = await storeService.getBootstrapData(null, own.email);
      expect(withSession.vendors.some((v) => v.email === own.email)).toBe(true);
      // Still capped overall — the own record is prepended, not added on top
      // of an already-full 500.
      expect(withSession.vendors.length).toBeLessThanOrEqual(501);
    });

    test('does not duplicate the own vendor when it already falls within the cap', async () => {
      const own = storeService.addVendor({ name: 'Recent Own Vendor', email: 'recent-own@example.com', majorCategory: 'Fasteners' });
      const withSession = await storeService.getBootstrapData(null, own.email);
      expect(withSession.vendors.filter((v) => v.email === own.email)).toHaveLength(1);
    });

    test('a session email with no matching vendor record changes nothing', async () => {
      const withoutMatch = await storeService.getBootstrapData(null, 'nobody-like-this@example.com');
      expect(withoutMatch.vendors.every((v) => v.email !== 'nobody-like-this@example.com')).toBe(true);
    });

    describe('with a configured DB pool (the fast SQL path, not the in-memory resync)', () => {
      let originalPool;
      beforeEach(() => {
        originalPool = domainPool.pool;
        domainPool.pool = { query: jest.fn() };
      });
      afterEach(() => {
        domainPool.pool = originalPool;
        jest.restoreAllMocks();
      });

      test('unscoped bootstrap answers from getVendorsPageFromDB(publicOnly), not the full in-memory resync', async () => {
        const pageSpy = jest
          .spyOn(domainQueries, 'getVendorsPageFromDB')
          .mockResolvedValue({ rows: [{ id: 'v-sql', name: 'SQL Vendor', email: 'sql-vendor@example.com' }], total: 87109 });
        const getVendorsSpy = jest.spyOn(storeService, 'getVendors');

        const result = await storeService.getBootstrapData();

        expect(pageSpy).toHaveBeenCalledWith({ limit: 500, offset: 0, publicOnly: true });
        expect(getVendorsSpy).not.toHaveBeenCalled();
        expect(result.vendors).toEqual([{ id: 'v-sql', name: 'SQL Vendor', email: 'sql-vendor@example.com' }]);
        expect(result.vendorsTotal).toBe(87109);
      });

      test('fetches the own vendor by email via a single-row lookup when not already in the fast-path page', async () => {
        jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [{ id: 'v-1', email: 'other@example.com' }], total: 2 });
        const ownLookupSpy = jest
          .spyOn(domainQueries, 'getVendorByEmailFromDB')
          .mockResolvedValue({ id: 'v-own', email: 'me@example.com' });

        const result = await storeService.getBootstrapData(null, 'me@example.com');

        expect(ownLookupSpy).toHaveBeenCalledWith('me@example.com');
        expect(result.vendors[0]).toEqual({ id: 'v-own', email: 'me@example.com' });
      });

      test('does not do the single-row lookup when the own vendor is already in the fast-path page', async () => {
        jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [{ id: 'v-own', email: 'me@example.com' }], total: 1 });
        const ownLookupSpy = jest.spyOn(domainQueries, 'getVendorByEmailFromDB');

        await storeService.getBootstrapData(null, 'me@example.com');

        expect(ownLookupSpy).not.toHaveBeenCalled();
      });

      test('scoped (buyer-specific) bootstrap uses bounded DB queries, never a full-table re-sync', async () => {
        // Regression coverage for the real incident this fixed: the old
        // in-memory path (storeService.getVendors) re-fetched the ENTIRE
        // vendors table on every single scoped bootstrap call, which
        // exhausted D1's free-tier daily row-read cap in production
        // (confirmed live via `wrangler d1 info`: 6.7M rows read/24h against
        // a 20k-row table).
        const ownVendor = { id: 'v-own', email: 'scoped-buyer-vendor@example.com', buyerId: 'buyer-123' };
        const ownSpy = jest.spyOn(domainQueries, 'getVendorsByBuyerFromDB').mockResolvedValue([ownVendor]);
        const pageSpy = jest
          .spyOn(domainQueries, 'getVendorsPageFromDB')
          .mockResolvedValue({ rows: [{ id: 'v-public' }], total: 1 });
        const fullTableSpy = jest.spyOn(domainQueries, 'getVendorsFromDB');

        const result = await storeService.getBootstrapData('buyer-123');

        expect(ownSpy).toHaveBeenCalledWith('buyer-123', expect.any(Number));
        expect(pageSpy).toHaveBeenCalledWith(expect.objectContaining({ publicOnly: true }));
        expect(fullTableSpy).not.toHaveBeenCalled();
        expect(result.vendors.some((v) => v.id === 'v-own')).toBe(true);
        expect(result.vendors.some((v) => v.id === 'v-public')).toBe(true);
      });
    });
  });

  describe('RFQ Database Synchronization', () => {
    test('syncRFQsFromDB returns in-memory RFQs when pool is not configured', async () => {
      const origPool = domainPool.pool;
      domainPool.pool = null;
      try {
        const result = await storeService.syncRFQsFromDB();
        expect(Array.isArray(result)).toBe(true);
      } finally {
        domainPool.pool = origPool;
      }
    });

    test('syncRFQsFromDB merges records from DB and sorts them', async () => {
      const origPool = domainPool.pool;
      const origGetRFQsFromDB = domainQueries.getRFQsFromDB;
      domainPool.pool = { query: jest.fn() };
      domainQueries.getRFQsFromDB = jest.fn().mockResolvedValue([
        { id: 'rfq-db-1', rfqNumber: 'RFQ2601', title: 'DB RFQ 1', createdAt: '2026-09-16 10:00:00 UTC' },
        { id: 'rfq-db-2', rfqNumber: 'RFQ2602', title: 'DB RFQ 2', createdAt: '2026-09-16 12:00:00 UTC' },
      ]);

      try {
        const result = await storeService.syncRFQsFromDB();
        expect(result.some((r) => r.id === 'rfq-db-1')).toBe(true);
        expect(result.some((r) => r.id === 'rfq-db-2')).toBe(true);
        expect(storeService.getRFQById('rfq-db-1')?.title).toBe('DB RFQ 1');
      } finally {
        domainPool.pool = origPool;
        domainQueries.getRFQsFromDB = origGetRFQsFromDB;
      }
    });

    test('syncRFQsFromDB handles database fetch errors gracefully', async () => {
      const origPool = domainPool.pool;
      const origGetRFQsFromDB = domainQueries.getRFQsFromDB;
      domainPool.pool = { query: jest.fn() };
      domainQueries.getRFQsFromDB = jest.fn().mockRejectedValue(new Error('Connection lost'));

      try {
        const result = await storeService.syncRFQsFromDB();
        expect(Array.isArray(result)).toBe(true);
      } finally {
        domainPool.pool = origPool;
        domainQueries.getRFQsFromDB = origGetRFQsFromDB;
      }
    });

    test('getRFQByIdAsync finds existing in-memory RFQ without querying DB', async () => {
      const origPool = domainPool.pool;
      domainPool.pool = null;
      storeService.rfqs.push({ id: 'rfq-mem-1', rfqNumber: 'RFQMEM01', title: 'Memory RFQ' });
      try {
        const found = await storeService.getRFQByIdAsync('rfq-mem-1');
        expect(found?.title).toBe('Memory RFQ');
      } finally {
        domainPool.pool = origPool;
      }
    });

    test('getRFQByIdAsync syncs from DB when not found in memory', async () => {
      const origPool = domainPool.pool;
      const origGetRFQsFromDB = domainQueries.getRFQsFromDB;
      domainPool.pool = { query: jest.fn() };
      domainQueries.getRFQsFromDB = jest.fn().mockResolvedValue([
        { id: 'rfq-db-remote', rfqNumber: 'RFQREMOTE', title: 'Remote RFQ', createdAt: '2026-09-16 11:00:00 UTC' },
      ]);

      try {
        const found = await storeService.getRFQByIdAsync('rfq-db-remote');
        expect(found?.title).toBe('Remote RFQ');
        const notFound = await storeService.getRFQByIdAsync('rfq-absolutely-nowhere');
        expect(notFound).toBeUndefined();
      } finally {
        domainPool.pool = origPool;
        domainQueries.getRFQsFromDB = origGetRFQsFromDB;
      }
    });

    test('addQuoteToRFQ adds quote, updates vendor telemetry, and evaluates scores', () => {
      const testRfq = {
        id: 'rfq-quote-test-1',
        rfqNumber: 'RFQ-QT-001',
        title: 'Industrial Valves',
        budget: 100000,
        quotes: [],
        followUpData: {
          totalInvited: 2,
          respondedCount: 0,
          vendors: [
            { vendorId: 'v-101', vendorName: 'Vendor One', bidStatus: 'Pending', overallStatus: 'Chasing' },
            { vendorId: 'v-102', vendorName: 'Vendor Two', bidStatus: 'Pending', overallStatus: 'Chasing' },
          ],
        },
      };

      storeService.rfqs.push(testRfq);

      const nullResult = storeService.addQuoteToRFQ('non-existent-rfq', { vendorId: 'v-101' });
      expect(nullResult).toBeNull();

      // First quote submission
      const quote1 = {
        vendorId: 'v-101',
        vendorName: 'Vendor One',
        vendorCategory: 'Client List',
        unitPrice: 5000,
        totalPrice: 50000,
        leadTimeDays: 14,
        warrantyYears: 2,
        paymentTerms: 'Net 30 Days',
        remarks: 'First bid',
        source: 'portal',
        submissionMethod: 'web_portal',
      };

      const updatedRfq1 = storeService.addQuoteToRFQ(testRfq.id, quote1);
      expect(updatedRfq1).toBeDefined();
      expect(updatedRfq1.quotes.length).toBe(1);
      expect(updatedRfq1.quotesCount).toBe(1);
      expect(updatedRfq1.status).toBe('In Evaluation');
      expect(updatedRfq1.quotes[0].source).toBe('portal');
      expect(updatedRfq1.quotes[0].isBestPrice).toBe(true);
      expect(updatedRfq1.followUpData.respondedCount).toBe(1);
      expect(updatedRfq1.followUpData.vendors[0].bidStatus).toBe('Submitted');
      expect(updatedRfq1.followUpData.vendors[0].overallStatus).toBe('Responded');

      // Second quote from different vendor (Email)
      const quote2 = {
        vendorId: 'v-102',
        vendorName: 'Vendor Two',
        vendorCategory: 'Procucev Network',
        unitPrice: 4000,
        totalPrice: 40000,
        leadTimeDays: 10,
        warrantyYears: 3,
        paymentTerms: 'Net 15 Days',
        remarks: 'Email quote',
        source: 'email',
        submissionMethod: 'email',
      };

      const updatedRfq2 = storeService.addQuoteToRFQ(testRfq.id, quote2);
      expect(updatedRfq2.quotes.length).toBe(2);
      expect(updatedRfq2.quotesCount).toBe(2);
      expect(updatedRfq2.quotes.find((q) => q.vendorId === 'v-102').source).toBe('email');
      expect(updatedRfq2.quotes.find((q) => q.vendorId === 'v-102').isBestPrice).toBe(true);
      expect(updatedRfq2.quotes.find((q) => q.vendorId === 'v-101').isBestPrice).toBe(false);

      // Third quote from vendor 1 revising their quote via email
      const quote1Revision = {
        vendorId: 'v-101',
        vendorName: 'Vendor One',
        vendorCategory: 'Client List',
        unitPrice: 3500,
        totalPrice: 35000,
        leadTimeDays: 7,
        warrantyYears: 3,
        paymentTerms: 'Net 30 Days',
        remarks: 'Revised offer via email',
        source: 'email',
        submissionMethod: 'email',
      };

      const updatedRfq3 = storeService.addQuoteToRFQ(testRfq.id, quote1Revision);
      // Must NOT create duplicate quote for v-101
      expect(updatedRfq3.quotes.length).toBe(2);
      expect(updatedRfq3.quotesCount).toBe(2);
      const v1Updated = updatedRfq3.quotes.find((q) => q.vendorId === 'v-101');
      expect(v1Updated.unitPrice).toBe(3500);
      expect(v1Updated.source).toBe('email');
      expect(v1Updated.isBestPrice).toBe(true);
    });

    test('resolveBuyerEmailForRFQ resolves corporateEmail, falls back to raisedByEmail, or returns null', () => {
      expect(storeService.resolveBuyerEmailForRFQ(null)).toBeNull();

      storeService.buyerAccounts = [
        { id: 'buyer-acc-1', corporateEmail: 'buyer1@corp.com' },
        { id: 'buyer-acc-2' }, // no corporate email
      ];

      // 1. Found with corporateEmail
      expect(storeService.resolveBuyerEmailForRFQ({ buyerAccountId: 'buyer-acc-1', raisedByEmail: 'fallback@mail.com' }))
        .toBe('buyer1@corp.com');

      // 2. Found without corporateEmail, falls back to raisedByEmail
      expect(storeService.resolveBuyerEmailForRFQ({ buyerAccountId: 'buyer-acc-2', raisedByEmail: 'fallback@mail.com' }))
        .toBe('fallback@mail.com');

      // 3. buyerAccountId not in buyerAccounts, falls back to raisedByEmail
      expect(storeService.resolveBuyerEmailForRFQ({ buyerAccountId: 'buyer-acc-unknown', raisedByEmail: 'fallback@mail.com' }))
        .toBe('fallback@mail.com');

      // 4. No buyerAccountId, falls back to raisedByEmail
      expect(storeService.resolveBuyerEmailForRFQ({ raisedByEmail: 'fallback@mail.com' }))
        .toBe('fallback@mail.com');

      // 5. No emails anywhere
      expect(storeService.resolveBuyerEmailForRFQ({}))
        .toBeNull();
    });
  });
});

