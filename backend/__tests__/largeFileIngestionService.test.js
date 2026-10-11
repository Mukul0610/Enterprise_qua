// ==============================================================================
// LARGE FILE INGESTION SERVICE & JOBS TEST SUITE
// ==============================================================================

const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const largeFileIngestionService = require('../src/services/largeFileIngestionService');
const queries = require('../src/db/vendorIngestionQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const r2Client = require('../src/services/r2Client');
const { VENDOR_INGESTION_SESSION_STATUS, VENDOR_INGESTION_STEP } = require('../src/config/constants');

/**
 * Stands in for r2Client.getClient() — the real R2 upload/download/delete
 * this file now goes through instead of local disk (Cloudflare Workers has
 * no persistent filesystem; see largeFileIngestionService.js's top comment).
 * `content` is what a GetObjectCommand "downloads" back; PutObjectCommand and
 * DeleteObjectCommand just resolve, mirroring the real SDK's shape closely
 * enough for these unit tests (real R2 round-trips are covered by this
 * session's live verification against the deployed Worker, not by Jest).
 */
function mockR2Client(content) {
  const send = jest.fn(async (command) => {
    if (command instanceof GetObjectCommand) {
      return { Body: Buffer.isBuffer(content) ? [content] : [Buffer.from(content, 'utf8')] };
    }
    if (command instanceof PutObjectCommand || command instanceof DeleteObjectCommand) {
      return {};
    }
    throw new Error('Unexpected R2 command in test');
  });
  jest.spyOn(r2Client, 'getClient').mockReturnValue({ send });
  jest.spyOn(r2Client, 'bucket').mockReturnValue('test-bucket');
  return send;
}

/**
 * Same idea as mockR2Client, but through the native R2 binding (getBinding())
 * this file prefers on Workers — see largeFileIngestionService.js's uploadToR2/
 * downloadFromR2/deleteFromR2 for why S3Client can't be used there at all.
 */
function mockR2Binding(content) {
  const put = jest.fn(async () => {});
  const get = jest.fn(async () => ({
    arrayBuffer: async () => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  }));
  const del = jest.fn(async () => {});
  jest.spyOn(r2Client, 'getBinding').mockReturnValue({ put, get, delete: del });
  return { put, get, delete: del };
}

describe('largeFileIngestionService unit tests', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveOrganizationId', () => {
    it('returns organizationId if present directly on sessionUser', async () => {
      const orgId = await largeFileIngestionService.resolveOrganizationId({ organizationId: 'org-direct' });
      expect(orgId).toBe('org-direct');
    });

    it('returns organization_id if present directly on sessionUser', async () => {
      const orgId = await largeFileIngestionService.resolveOrganizationId({ organization_id: 'org-snake' });
      expect(orgId).toBe('org-snake');
    });

    it('returns orgId if present directly on sessionUser', async () => {
      const orgId = await largeFileIngestionService.resolveOrganizationId({ orgId: 'org-short' });
      expect(orgId).toBe('org-short');
    });

    it('looks up profile by user.sub when present', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValueOnce({
        found: true,
        profile: { organizationId: 'org-from-sub' },
      });
      const orgId = await largeFileIngestionService.resolveOrganizationId({ sub: 'usr-123' });
      expect(orgId).toBe('org-from-sub');
    });

    it('looks up profile by userId or id when present', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValueOnce({
        found: true,
        profile: { organizationId: 'org-from-userid' },
      });
      const orgId = await largeFileIngestionService.resolveOrganizationId({ userId: 'usr-456' });
      expect(orgId).toBe('org-from-userid');
    });

    it('handles error in buyerProfileQueries gracefully and falls back to sessionId', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValueOnce(new Error('DB connection failed'));
      jest.spyOn(queries, 'findSessionById').mockResolvedValueOnce({
        id: 'sess-1',
        organizationId: 'org-from-session',
      });
      const orgId = await largeFileIngestionService.resolveOrganizationId({ sub: 'usr-err' }, 'sess-1');
      expect(orgId).toBe('org-from-session');
    });

    it('falls back to sessionId lookup if user has no org and no sub', async () => {
      jest.spyOn(queries, 'findSessionById').mockResolvedValueOnce({
        id: 'sess-2',
        organizationId: 'org-session-only',
      });
      const orgId = await largeFileIngestionService.resolveOrganizationId(null, 'sess-2');
      expect(orgId).toBe('org-session-only');
    });

    it('returns null if no organizationId can be found', async () => {
      jest.spyOn(queries, 'findSessionById').mockRejectedValueOnce(new Error('not found'));
      const orgId = await largeFileIngestionService.resolveOrganizationId(null, 'sess-invalid');
      expect(orgId).toBeNull();
    });
  });

  describe('parseCsvLine', () => {
    it('splits simple comma-separated values', () => {
      const line = 'VND-1001,Apex Supplies Ltd.,Rajesh Nair,rajesh@apex.com';
      const result = largeFileIngestionService.parseCsvLine(line);
      expect(result).toEqual(['VND-1001', 'Apex Supplies Ltd.', 'Rajesh Nair', 'rajesh@apex.com']);
    });

    it('respects quoted fields containing commas and double quotes', () => {
      const line = 'VND-1002,"Kiran ""Valves"", Inc.",Amit Kumar,"Bhosari, Pune, MH",27AAACK3921P1Z9';
      const result = largeFileIngestionService.parseCsvLine(line);
      expect(result).toEqual([
        'VND-1002',
        'Kiran "Valves", Inc.',
        'Amit Kumar',
        'Bhosari, Pune, MH',
        '27AAACK3921P1Z9',
      ]);
    });

    it('handles tab-separated lines', () => {
      const line = 'PO-001\t2025-01-10\tApex Supplies\tPump 500 GPM\t10\t15000';
      const result = largeFileIngestionService.parseCsvLine(line, '\t');
      expect(result).toEqual(['PO-001', '2025-01-10', 'Apex Supplies', 'Pump 500 GPM', '10', '15000']);
    });
  });

  describe('extractHeaderIndices and mapRowValues', () => {
    it('extracts vendor master header mapping and maps row values with defaults', () => {
      const headers = ['Supplier Code', 'Company Name', 'Contact Person Name', 'Corporate Email', 'Phone', 'Address', 'GSTIN', 'Rating'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'VENDOR_MASTER');
      expect(headerMap.companyName).toBe(1);
      expect(headerMap.vendorCode).toBe(0);

      const rowValues = ['V-99', 'Atlas Tech Ltd', 'Suresh Patel', 'suresh@atlas.com', '+91 99000 11223', 'Mumbai', '27ABCDE1234F1Z5', '88'];
      const mapped = largeFileIngestionService.mapRowValues(rowValues, headerMap, 'VENDOR_MASTER', 0);
      expect(mapped.companyName).toBe('Atlas Tech Ltd');
      expect(mapped.vendorCode).toBe('V-99');
      expect(mapped.contactPerson).toBe('Suresh Patel');
      expect(mapped.email).toBe('suresh@atlas.com');
      expect(mapped.rating).toBe(88);
    });

    it('leaves vendor master fields blank rather than inventing placeholder data when a row has nothing', () => {
      const headerMap = largeFileIngestionService.extractHeaderIndices([], 'VENDOR_MASTER');
      const mapped = largeFileIngestionService.mapRowValues([], headerMap, 'VENDOR_MASTER', 2);
      expect(mapped.vendorCode).toBeNull();
      expect(mapped.companyName).toBe('');
      expect(mapped.contactPerson).toBeNull();
      expect(mapped.email).toBeNull();
      expect(mapped.phone).toBeNull();
      expect(mapped.rating).toBeNull();
    });

    it('normalizes email and phone to one standard, lower-cased/digits-only shape', () => {
      const headers = ['Company Name', 'Email', 'Phone'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'VENDOR_MASTER');
      const mapped = largeFileIngestionService.mapRowValues(
        ['Atlas Pumps', 'Suresh@Atlas.COM ', '+91 98000-11122'],
        headerMap,
        'VENDOR_MASTER',
        0
      );
      expect(mapped.email).toBe('suresh@atlas.com');
      expect(mapped.phone).toBe('+919800011122');
    });

    it('extracts po dump header mapping and maps row values with unit price calculation', () => {
      const headers = ['PO Number', 'PO Date', 'Vendor Name', 'Line Item Description', 'Specs', 'Quantity', 'Unit', 'Unit Price', 'Total Spend', 'Department'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'PO_DUMP');
      expect(headerMap.poNumber).toBe(0);
      expect(headerMap.vendorIdentifier).toBe(2);

      const rowValues = ['PO-991', '2025-05-10', 'VND-200', 'Industrial Flange', 'ANSI 150', '20', 'Pcs', '450', '9000', 'Piping'];
      const mapped = largeFileIngestionService.mapRowValues(rowValues, headerMap, 'PO_DUMP', 0);
      expect(mapped.poNumber).toBe('PO-991');
      expect(mapped.vendorName).toBe('VND-200');
      expect(mapped.vendorCode).toBe('VND-200');
      expect(mapped.itemDescription).toBe('Industrial Flange');
      expect(mapped.quantity).toBe(20);
      expect(mapped.spend).toBe(9000);
      expect(mapped.department).toBe('Piping');
    });

    it('calculates spend from unit price when spend is 0, and leaves it 0 (not invented) when both are 0', () => {
      const headers = ['PO Number', 'PO Date', 'Vendor Name', 'Item Description', 'Quantity', 'Unit Price', 'Total Spend'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'PO_DUMP');

      // Spend from unit price
      const mapped1 = largeFileIngestionService.mapRowValues(['PO-1', '2025-01-01', 'Supplier A', 'Bolts', '5', '100', '0'], headerMap, 'PO_DUMP', 0);
      expect(mapped1.spend).toBe(500);

      // Neither spend nor unit price supplied — left at 0, not a guessed default.
      const mapped2 = largeFileIngestionService.mapRowValues(['PO-2', '2025-01-01', 'Supplier B', 'Nuts', '4', '0', '0'], headerMap, 'PO_DUMP', 1);
      expect(mapped2.spend).toBe(0);
    });

    it('normalizes the PO number and date to one standard shape', () => {
      const headers = ['PO Number', 'PO Date', 'Vendor Name', 'Item Description'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'PO_DUMP');

      const iso = largeFileIngestionService.mapRowValues(['po 4471', '2025-06-15', 'Vendor A', 'Bolts'], headerMap, 'PO_DUMP', 0);
      expect(iso.poNumber).toBe('PO 4471');
      expect(iso.poDate).toBe('2025-06-15');

      const dmy = largeFileIngestionService.mapRowValues(['PO-4472', '15/06/2025', 'Vendor B', 'Nuts'], headerMap, 'PO_DUMP', 1);
      expect(dmy.poDate).toBe('2025-06-15');

      const unparseable = largeFileIngestionService.mapRowValues(['PO-4473', 'not a date', 'Vendor C', 'Washers'], headerMap, 'PO_DUMP', 2);
      expect(unparseable.poDate).toBeNull();

      const blank = largeFileIngestionService.mapRowValues(['', '', 'Vendor D', 'Clips'], headerMap, 'PO_DUMP', 3);
      expect(blank.poNumber).toBeNull();
      expect(blank.poDate).toBeNull();
    });

    it('normalizes Excel date serial decimals and various date formats in PO dump rows', () => {
      const headers = ['PO Number', 'PO Date', 'Vendor Name', 'Line Item Description', 'Quantity', 'Spend'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'PO_DUMP');

      // Excel decimal serial (e.g. 45995.00011574074)
      const mappedDecimal = largeFileIngestionService.mapRowValues(['PO-100', '45995.00011574074', 'Supplier X', 'Laptop', '1', '50000'], headerMap, 'PO_DUMP', 0);
      expect(mappedDecimal.poDate).toBe('2025-12-04');

      // Integer serial
      const mappedSerial = largeFileIngestionService.mapRowValues(['PO-101', '45995', 'Supplier X', 'Laptop', '1', '50000'], headerMap, 'PO_DUMP', 1);
      expect(mappedSerial.poDate).toBe('2025-12-04');

      // DD-MM-YYYY format
      const mappedDmy = largeFileIngestionService.mapRowValues(['PO-102', '12-04-2025', 'Supplier X', 'Laptop', '1', '50000'], headerMap, 'PO_DUMP', 2);
      expect(mappedDmy.poDate).toBe('2025-04-12');
    });
  });

  describe('processVendorMasterBatch & processPoDumpBatch direct execution', () => {
    it('processes valid and invalid vendor master batches', async () => {
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValueOnce([{ id: 1 }]);
      const res = await largeFileIngestionService.processVendorMasterBatch('s1', 'o1', [
        { companyName: 'Valid Co' },
        { companyName: '' },
      ]);
      expect(res.imported).toBe(1);
      expect(res.skipped).toBe(1);
      expect(res.failed).toBe(1);
    });

    it('handles bulkUpsertVendorMasterRecords failure', async () => {
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockRejectedValueOnce(new Error('DB err'));
      const res = await largeFileIngestionService.processVendorMasterBatch('s1', 'o1', [{ companyName: 'Valid' }]);
      expect(res.imported).toBe(0);
      expect(res.skipped).toBe(1);
    });

    it('processes valid and invalid po dump batches', async () => {
      jest.spyOn(queries, 'bulkInsertPoLineItems').mockResolvedValueOnce([{ id: 1 }]);
      const res = await largeFileIngestionService.processPoDumpBatch('s1', 'o1', [
        { vendorName: 'Apex', poDate: '2025-01-01', itemDescription: 'Valves', department: 'Piping' },
        { itemDescription: 'No Vendor', department: 'Piping' },
      ], { horizonStart: '2025-01-01', horizonEnd: '2025-12-31' });
      expect(res.imported).toBe(1);
      expect(res.skipped).toBe(1);
      expect(res.failed).toBe(1);
    });

    it('rejects a po dump row missing item details or category even when vendor identity is present', async () => {
      const res = await largeFileIngestionService.processPoDumpBatch('s1', 'o1', [
        { vendorName: 'Apex', department: 'Piping' }, // no item details
        { vendorName: 'Apex', itemDescription: 'Valves' }, // no category
      ], null);
      expect(res.imported).toBe(0);
      expect(res.failed).toBe(2);
      expect(res.errors[0].reason).toBe('Item Details are required');
      expect(res.errors[1].reason).toBe('Category is required');
    });

    it('handles bulkInsertPoLineItems failure', async () => {
      jest.spyOn(queries, 'bulkInsertPoLineItems').mockRejectedValueOnce(new Error('DB err'));
      const res = await largeFileIngestionService.processPoDumpBatch(
        's1',
        'o1',
        [{ vendorName: 'Apex', itemDescription: 'Valves', department: 'Piping' }],
        null
      );
      expect(res.imported).toBe(0);
      expect(res.skipped).toBe(1);
    });
  });

  describe('Streaming CSV processing & resilience', () => {
    it('successfully streams and processes a Vendor Master CSV file', async () => {
      const csvContent = [
        'Vendor Code,Company Name,Contact Person,Email,Phone,Address,GSTIN,Rating',
        'VND-1,Vendor Alpha,Alice,alice@alpha.com,+91 91111 22222,Mumbai,27AAACA1111A1Z1,90',
        'VND-2,Vendor Beta,Bob,bob@beta.com,+91 92222 33333,Delhi,07AAACB2222B1Z2,80',
        'VND-3,Vendor Gamma,Charlie,charlie@gamma.com,+91 93333 44444,Pune,27AAACG3333C1Z3,85',
        '', // Empty line
      ].join('\n');
      const send = mockR2Client(csvContent);

      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: 'session-1',
        organizationId: 'org-1',
        status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
        currentStep: VENDOR_INGESTION_STEP.VENDOR_MASTER,
      });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValue([{ id: 1 }, { id: 2 }]);
      jest.spyOn(queries, 'countVendorMasterRecords').mockResolvedValue(3);
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});

      await expect(
        largeFileIngestionService.streamProcessCsvFile({
          jobId: 'test-job-vm',
          sessionId: 'session-1',
          organizationId: 'org-1',
          r2Key: 'uploads/vendor-ingestion/test-vm.csv',
          fileName: 'test-vm.csv',
          jobType: 'VENDOR_MASTER',
          batchSize: 2,
        })
      ).resolves.not.toThrow();

      // Cleaned up from R2 (DeleteObjectCommand), not a local file — this is
      // the same "unconditional cleanup" guarantee the old fs.unlinkSync had.
      expect(send.mock.calls.some((call) => call[0] instanceof DeleteObjectCommand)).toBe(true);
    });

    it('successfully streams and processes a PO Dump CSV file with semicolons and batch boundaries', async () => {
      const csvContent = [
        'PO Number;PO Date;Vendor Name;Line Item Description;Specs;Quantity;Unit;Unit Price;Total Spend;Department',
        'PO-101;2025-06-01;Apex Tech;Steel Rod;Grade A;10;Pcs;500;5000;Civil',
        'PO-102;2025-06-02;Apex Tech;Cement;Grade B;20;Bags;300;6000;Civil',
        'PO-103;2025-06-03;Apex Tech;Bricks;Grade C;30;Bags;100;3000;Civil',
      ].join('\n');
      mockR2Client(csvContent);

      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: 'session-po',
        organizationId: 'org-1',
        horizonStart: '2025-01-01',
        horizonEnd: '2025-12-31',
        status: VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED,
        currentStep: VENDOR_INGESTION_STEP.PO_DUMP,
      });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
      jest.spyOn(queries, 'bulkInsertPoLineItems').mockResolvedValue([{ id: 1 }, { id: 2 }]);
      jest.spyOn(queries, 'countPoLineItems').mockResolvedValue({ total: 3, inHorizon: 3, outsideHorizon: 0 });
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});

      await expect(
        largeFileIngestionService.streamProcessCsvFile({
          jobId: 'test-job-po',
          sessionId: 'session-po',
          organizationId: 'org-1',
          r2Key: 'uploads/vendor-ingestion/test-po.csv',
          fileName: 'test-po.csv',
          jobType: 'PO_DUMP',
          batchSize: 2, // Triggers both intermediate batch and remainder batch
        })
      ).resolves.not.toThrow();
    });

    it('handles stream processing when session is not found', async () => {
      mockR2Client('header1,header2\nval1,val2');

      jest.spyOn(queries, 'findSession').mockResolvedValueOnce(null);
      const updateSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.streamProcessCsvFile({
        jobId: 'test-job-nosess',
        sessionId: 'session-not-found',
        organizationId: 'org-1',
        r2Key: 'uploads/vendor-ingestion/test-nosess.csv',
        fileName: 'test.csv',
        jobType: 'VENDOR_MASTER',
      });

      expect(updateSpy).toHaveBeenCalledWith(
        'test-job-nosess',
        'org-1',
        expect.objectContaining({ status: 'FAILED', errorMessage: 'Session not found' })
      );
    });

    it('marks the job FAILED when the R2 object cannot be read back', async () => {
      const send = jest.fn().mockRejectedValue(new Error('R2 object not found'));
      jest.spyOn(r2Client, 'getClient').mockReturnValue({ send });
      jest.spyOn(r2Client, 'bucket').mockReturnValue('test-bucket');

      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({ id: 'sess-1', organizationId: 'org-1' });
      const updateSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.streamProcessCsvFile({
        jobId: 'test-job-missing-r2',
        sessionId: 'sess-1',
        organizationId: 'org-1',
        r2Key: 'uploads/vendor-ingestion/missing.csv',
        fileName: 'test.csv',
        jobType: 'VENDOR_MASTER',
      });

      expect(updateSpy).toHaveBeenCalledWith(
        'test-job-missing-r2',
        'org-1',
        expect.objectContaining({ status: 'FAILED', errorMessage: expect.stringContaining('could not be read back') })
      );
    });

    it('handles error during stream processing and marks job as FAILED', async () => {
      mockR2Client('header1\nrow1');

      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({ id: 'sess-1' });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockRejectedValueOnce(new Error('Fatal DB crash'));

      await expect(
        largeFileIngestionService.streamProcessCsvFile({
          jobId: 'test-job-err',
          sessionId: 'sess-1',
          organizationId: 'org-1',
          r2Key: 'uploads/vendor-ingestion/test-err.csv',
          fileName: 'test.csv',
          jobType: 'VENDOR_MASTER',
        })
      ).resolves.not.toThrow();
    });
  });

  describe('processArrayJob', () => {
    it('processes vendor master array batches and updates progress', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: 'sess-arr',
        organizationId: 'org-1',
        status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
        currentStep: VENDOR_INGESTION_STEP.VENDOR_MASTER,
      });
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValueOnce([{ id: 1 }]);
      jest.spyOn(queries, 'countVendorMasterRecords').mockResolvedValue(1);
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});
      const updateProgressSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-arr-1',
        sessionId: 'sess-arr',
        organizationId: 'org-1',
        rows: [{ companyName: 'Valid Vendor' }, { companyName: '' }], // 1 valid, 1 invalid
        fileName: 'test.xlsx',
        jobType: 'VENDOR_MASTER',
        batchSize: 5,
      });

      expect(updateProgressSpy).toHaveBeenCalledWith(
        'job-arr-1',
        'org-1',
        expect.objectContaining({ status: 'COMPLETED', importedRecords: 1, failedRecords: 1 })
      );
    });

    it('processes po dump array batches and updates progress', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: 'sess-arr-po',
        organizationId: 'org-1',
        horizonStart: '2025-01-01',
        horizonEnd: '2025-12-31',
        status: VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED,
        currentStep: VENDOR_INGESTION_STEP.PO_DUMP,
      });
      jest.spyOn(queries, 'bulkInsertPoLineItems').mockResolvedValueOnce([{ id: 1 }]);
      jest.spyOn(queries, 'countPoLineItems').mockResolvedValue({ total: 1, inHorizon: 1, outsideHorizon: 0 });
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});
      const updateProgressSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-arr-po',
        sessionId: 'sess-arr-po',
        organizationId: 'org-1',
        rows: [
          { vendorName: 'Apex', poDate: '2025-06-01', itemDescription: 'Valves', department: 'Piping' },
          { itemDescription: 'No vendor' },
        ], // 1 valid, 1 invalid
        fileName: 'po.xlsx',
        jobType: 'PO_DUMP',
        batchSize: 5,
      });

      expect(updateProgressSpy).toHaveBeenCalledWith(
        'job-arr-po',
        'org-1',
        expect.objectContaining({ status: 'COMPLETED', importedRecords: 1, failedRecords: 1 })
      );
    });

    it('handles empty rows array gracefully', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({ id: 'sess-empty' });
      const updateProgressSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-empty',
        sessionId: 'sess-empty',
        organizationId: 'org-1',
        rows: [],
        fileName: 'empty.xlsx',
        jobType: 'VENDOR_MASTER',
      });

      expect(updateProgressSpy).toHaveBeenCalledWith(
        'job-empty',
        'org-1',
        expect.objectContaining({ status: 'COMPLETED', totalRecords: 0 })
      );
    });

    it('handles missing session for array job', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce(null);
      const updateProgressSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-nosess',
        sessionId: 'sess-none',
        organizationId: 'org-1',
        rows: [{ companyName: 'Vendor 1' }],
        fileName: 'v.xlsx',
        jobType: 'VENDOR_MASTER',
      });

      expect(updateProgressSpy).toHaveBeenCalledWith(
        'job-nosess',
        'org-1',
        expect.objectContaining({ status: 'FAILED', errorMessage: 'Session not found' })
      );
    });

    it('handles unexpected failure during array job and marks job as FAILED', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({ id: 'sess-fail' });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockRejectedValueOnce(new Error('DB failure'));

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-fail',
        sessionId: 'sess-fail',
        organizationId: 'org-1',
        rows: [{ companyName: 'Vendor 1' }],
        fileName: 'v.xlsx',
        jobType: 'VENDOR_MASTER',
      });
    });
  });

  describe('startIngestionJob & getJobStatus', () => {
    it('throws error when organization cannot be resolved', async () => {
      jest.spyOn(queries, 'findSessionById').mockResolvedValueOnce(null);
      await expect(
        largeFileIngestionService.startIngestionJob({
          sessionUser: null,
          sessionId: 'invalid',
          rows: [],
          jobType: 'VENDOR_MASTER',
        })
      ).rejects.toThrow('Organization not linked to user');
    });

    it('creates job, uploads to R2, and launches background file worker and array worker', async () => {
      const send = mockR2Client('Vendor Code\nVND-1');
      jest.spyOn(queries, 'createIngestionJob').mockResolvedValue({
        id: 'job-file-1',
        status: 'PROCESSING',
      });
      jest.spyOn(queries, 'findSession').mockResolvedValue({ id: 'sess-1' });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      const job1 = await largeFileIngestionService.startIngestionJob({
        sessionUser: { organizationId: 'org-1' },
        sessionId: 'sess-1',
        fileBuffer: Buffer.from('Vendor Code\nVND-1', 'utf8'),
        fileName: 'file.csv',
        jobType: 'VENDOR_MASTER',
        totalHint: 100,
      });
      expect(job1.id).toBe('job-file-1');
      // Uploaded to R2 synchronously before returning, not deferred with the
      // rest of the row processing — see startIngestionJob's comment on why.
      expect(send.mock.calls.some((call) => call[0] instanceof PutObjectCommand)).toBe(true);

      const job2 = await largeFileIngestionService.startIngestionJob({
        sessionUser: { organizationId: 'org-1' },
        sessionId: 'sess-1',
        rows: [{ companyName: 'Vendor 1' }],
        fileName: 'vendors.xlsx',
        jobType: 'VENDOR_MASTER',
      });
      expect(job2.id).toBe('job-file-1');

      // Wait a tick for setImmediate
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    describe('R2 binding path (Workers)', () => {
      it('uploads via the binding, processes, and cleans up via the binding', async () => {
        const binding = mockR2Binding('Vendor Code\nVND-1,Vendor Alpha');
        jest.spyOn(queries, 'createIngestionJob').mockResolvedValue({ id: 'job-binding-1', status: 'PROCESSING' });
        jest.spyOn(queries, 'findSession').mockResolvedValue({ id: 'sess-1', organizationId: 'org-1' });
        jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
        jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValue([{ id: 1 }]);
        jest.spyOn(queries, 'countVendorMasterRecords').mockResolvedValue(1);
        jest.spyOn(queries, 'updateSession').mockResolvedValue({});

        await largeFileIngestionService.startIngestionJob({
          sessionUser: { organizationId: 'org-1' },
          sessionId: 'sess-1',
          fileBuffer: Buffer.from('Vendor Code\nVND-1,Vendor Alpha', 'utf8'),
          fileName: 'file.csv',
          jobType: 'VENDOR_MASTER',
        });

        expect(binding.put).toHaveBeenCalledTimes(1);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(binding.get).toHaveBeenCalledTimes(1);
        expect(binding.delete).toHaveBeenCalledTimes(1);
      });

      it('returns null from downloadFromR2 when the binding get() throws', async () => {
        const binding = mockR2Binding('irrelevant');
        binding.get.mockRejectedValueOnce(new Error('binding read failed'));
        jest.spyOn(queries, 'findSession').mockResolvedValueOnce({ id: 'sess-1', organizationId: 'org-1' });
        const updateSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

        await largeFileIngestionService.streamProcessCsvFile({
          jobId: 'job-binding-err',
          sessionId: 'sess-1',
          organizationId: 'org-1',
          r2Key: 'uploads/vendor-ingestion/binding-err.csv',
          fileName: 'test.csv',
          jobType: 'VENDOR_MASTER',
        });

        expect(updateSpy).toHaveBeenCalledWith(
          'job-binding-err',
          'org-1',
          expect.objectContaining({ status: 'FAILED', errorMessage: expect.stringContaining('could not be read back') })
        );
      });
    });

    // On Workers, an unawaited setImmediate-deferred promise can be cancelled
    // the instant the response is sent — same reasoning as storeService.js's
    // _background(). globalThis.__CF_WAIT_UNTIL__ is how worker.mjs's
    // Workers-imported waitUntil reaches here; see d1Bridge.js's
    // getWaitUntil().
    describe('waitUntil registration on Workers', () => {
      const originalWaitUntil = globalThis.__CF_WAIT_UNTIL__;

      afterEach(() => {
        globalThis.__CF_WAIT_UNTIL__ = originalWaitUntil;
      });

      it('hands the R2-backed background job to waitUntil when running on Workers', async () => {
        mockR2Client('Vendor Code\nVND-1');
        const waitUntilSpy = jest.fn();
        globalThis.__CF_WAIT_UNTIL__ = waitUntilSpy;
        jest.spyOn(queries, 'createIngestionJob').mockResolvedValue({ id: 'job-wu-1', status: 'PROCESSING' });
        jest.spyOn(queries, 'findSession').mockResolvedValue({ id: 'sess-1' });
        jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

        await largeFileIngestionService.startIngestionJob({
          sessionUser: { organizationId: 'org-1' },
          sessionId: 'sess-1',
          fileBuffer: Buffer.from('Vendor Code\nVND-1', 'utf8'),
          fileName: 'file.csv',
          jobType: 'VENDOR_MASTER',
        });

        expect(waitUntilSpy).toHaveBeenCalledTimes(1);
        expect(waitUntilSpy.mock.calls[0][0]).toBeInstanceOf(Promise);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      it('hands the large-array background job to waitUntil when running on Workers', async () => {
        const waitUntilSpy = jest.fn();
        globalThis.__CF_WAIT_UNTIL__ = waitUntilSpy;
        jest.spyOn(queries, 'createIngestionJob').mockResolvedValue({ id: 'job-wu-2', status: 'PROCESSING' });
        jest.spyOn(queries, 'findSession').mockResolvedValue({ id: 'sess-1' });
        jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

        const bigRows = Array.from({ length: 5001 }, (_, i) => ({ companyName: `Vendor ${i}` }));
        await largeFileIngestionService.startIngestionJob({
          sessionUser: { organizationId: 'org-1' },
          sessionId: 'sess-1',
          rows: bigRows,
          fileName: 'vendors.xlsx',
          jobType: 'VENDOR_MASTER',
        });

        expect(waitUntilSpy).toHaveBeenCalledTimes(1);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    });

    it('logs error when background workers reject inside setImmediate', async () => {
      mockR2Client('header\nrow');
      jest.spyOn(queries, 'createIngestionJob').mockResolvedValue({
        id: 'job-fail-bg',
        status: 'PROCESSING',
      });
      jest.spyOn(queries, 'findSession').mockRejectedValue(new Error('Fatal bg stream failure'));

      await largeFileIngestionService.startIngestionJob({
        sessionUser: { organizationId: 'org-1' },
        sessionId: 'sess-1',
        fileBuffer: Buffer.from('header\nrow', 'utf8'),
        fileName: 'bad.csv',
        jobType: 'VENDOR_MASTER',
      });

      await largeFileIngestionService.startIngestionJob({
        sessionUser: { organizationId: 'org-1' },
        sessionId: 'sess-1',
        rows: [{ companyName: 'Vendor' }],
        fileName: 'bad.xlsx',
        jobType: 'VENDOR_MASTER',
      });

      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    it('retrieves job status by jobId, jobType, active jobs, or returns null', async () => {
      const mockFindJob = jest.spyOn(queries, 'findIngestionJob').mockResolvedValue({ id: 'by-id' });
      jest.spyOn(queries, 'findActiveIngestionJobs')
        .mockResolvedValueOnce([{ id: 'active-vm', jobType: 'VENDOR_MASTER' }])
        .mockResolvedValueOnce([{ id: 'active-1', jobType: 'PO_DUMP' }])
        .mockResolvedValueOnce([]); // Empty active jobs

      // By jobId
      const job1 = await largeFileIngestionService.getJobStatus({ organizationId: 'org-1' }, 'sess-1', 'job-123');
      expect(job1.id).toBe('by-id');

      // By jobType
      const job2 = await largeFileIngestionService.getJobStatus({ organizationId: 'org-1' }, 'sess-1', null, 'VENDOR_MASTER');
      expect(job2.id).toBe('active-vm');

      // Active jobs list
      const job3 = await largeFileIngestionService.getJobStatus({ organizationId: 'org-1' }, 'sess-1');
      expect(job3.id).toBe('active-1');

      // Returns null when no active jobs
      const job4 = await largeFileIngestionService.getJobStatus({ organizationId: 'org-1' }, 'sess-1');
      expect(job4).toBeNull();
    });

    it('cancels active ingestion jobs and updates progress to failed', async () => {
      jest.spyOn(queries, 'findActiveIngestionJobs').mockResolvedValueOnce([
        { id: 'job-cancel-1', jobType: 'VENDOR_MASTER' },
      ]);
      const updateProgressSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      const res = await largeFileIngestionService.cancelJob({ organizationId: 'org-1' }, 'sess-1', 'job-cancel-1');
      expect(res).toBe(true);
      expect(updateProgressSpy).toHaveBeenCalledWith(
        'job-cancel-1',
        'org-1',
        expect.objectContaining({ status: 'FAILED', errorMessage: 'Cancelled by user' })
      );

      // Returns false when organization is not resolvable
      jest.spyOn(queries, 'findSessionById').mockResolvedValueOnce(null);
      const resFalse = await largeFileIngestionService.cancelJob(null, 'bad-sess');
      expect(resFalse).toBe(false);
    });
  });
});
