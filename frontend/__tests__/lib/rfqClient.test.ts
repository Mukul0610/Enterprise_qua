import {
  extractLineItemsFromDocument,
  stageDocumentForExtraction,
  classifyLineItems,
  downloadQuoteAttachment,
  uploadRFQAttachment,
  rfqAttachmentUrl,
  createRFQ,
  fetchRFQById,
  fetchRFQList,
  fetchAllRFQs,
  fetchVendorCandidates,
  fetchAllVendors,
  inviteVendorsToRFQ,
  updateRFQ,
  deleteRFQ,
  submitRFQInquiry,
  replyToRFQInquiry,
  requestVendorCategoryUpdateEmail,
} from '@/lib/rfqClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQCreatePayload, RFQItem } from '@/lib/types';

describe('rfqClient.extractLineItemsFromDocument', () => {
  const originalFetch = global.fetch;

  const draft = {
    title: 'Pump Requirement',
    category: 'Engineering Spares - Mechanical',
    targetDeliveryDate: '2026-09-15',
    estimatedBudget: null,
    extractedEntities: [],
    source: 'web_portal' as const,
  };

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the document to the extraction endpoint and returns the draft', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: draft,
        classification: { totalExtracted: 1, accepted: 1, duplicatesRemoved: 0, needsReview: 0, autoClassified: 1 },
        extraction: { model: 'gemini-3.6-flash' },
      }),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12' });

    expect(res.success).toBe(true);
    expect(res.data?.title).toBe('Pump Requirement');
    expect(res.extraction?.model).toBe('gemini-3.6-flash');

    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/rfqs/extract');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12' });
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: draft }),
    });

    await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-token');
  });

  test('omits the Authorization header when there is no session', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: draft }),
    });

    await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  // Fail closed: an unreachable API must never look like a successful extraction.
  test('reports a network failure rather than fabricating line items', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('NETWORK');
    expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
    expect(res.data).toBeUndefined();
  });

  test('passes the server reason and message straight through on a 422', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ success: false, reason: 'NOT_CONFIGURED', error: 'AI extraction is not configured.' }),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res).toEqual({ success: false, reason: 'NOT_CONFIGURED', error: 'AI extraction is not configured.' });
  });

  test('treats a non-JSON body as an unreadable response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('AI_FAILED');
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.unreadableResponse);
  });

  // 422 is what the endpoint returns when it rejects a document, and this covers
  // the case where it omits both `reason` and `error`. A 5xx would instead be a
  // transport failure, which is reported separately and asserted further down.
  test('falls back to a default message when the server sends none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ success: false }),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.reason).toBe('AI_FAILED');
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.unreadableResponse);
  });

  // A 200 with success:true but no draft is malformed and must not be trusted.
  test('rejects a success response that carries no draft', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.success).toBe(false);
  });
});

describe('rfqClient.stageDocumentForExtraction', () => {
  const originalFetch = global.fetch;
  const file = new File(['%PDF-1.4 body'], 'spec.pdf', { type: 'application/pdf' });

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the raw file body (not JSON) and returns the staged key', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { key: 'abc-123', size: 13 } }),
    });

    const res = await stageDocumentForExtraction(file, 'application/pdf');

    expect(res).toEqual({ success: true, key: 'abc-123' });
    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/rfqs/extract/stage?mimeType=application%2Fpdf');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/pdf');
    expect(init.body).toBe(file);
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { key: 'abc-123' } }),
    });

    await stageDocumentForExtraction(file, 'application/pdf');

    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-token');
  });

  test('reports tooLarge on a 413 without attempting to parse the body', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 413 });

    const res = await stageDocumentForExtraction(file, 'application/pdf');

    expect(res).toEqual({
      success: false,
      tooLarge: true,
      error: 'This document is too large to extract from.',
    });
  });

  test('reports a network failure rather than silently dropping the document', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await stageDocumentForExtraction(file, 'application/pdf');

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
  });

  test('treats a non-JSON response as unreadable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await stageDocumentForExtraction(file, 'application/pdf');

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.unreadableResponse);
  });

  test('reports failure when the server omits a key', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });

    const res = await stageDocumentForExtraction(file, 'application/pdf');

    expect(res.success).toBe(false);
  });

  test('surfaces the server error message on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ success: false, error: 'Object storage is not configured.' }),
    });

    const res = await stageDocumentForExtraction(file, 'application/pdf');

    expect(res).toEqual({ success: false, error: 'Object storage is not configured.' });
  });
});

describe('rfqClient.classifyLineItems', () => {
  const originalFetch = global.fetch;

  const row = {
    id: 'ent-1',
    itemName: 'Flanged Gate Valve 4 inch',
    quantity: 24,
    unit: 'Nos',
    targetDate: '2026-09-18',
    technicalSpecs: 'ASTM A216 WCB',
    confidence: 90,
    category: 'Pumps & Accessories',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategory: 'Pumps & Accessories',
  };

  const classified = {
    title: 'Valve Requirement',
    category: 'Engineering Spares - Mechanical',
    targetDeliveryDate: '2026-09-18',
    estimatedBudget: null,
    extractedEntities: [{ ...row, minorCategory: 'Hoses, Valves & Fittings' }],
    source: 'web_portal' as const,
  };

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the rows to the ingest endpoint and returns the classified draft', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: classified,
        classification: { totalExtracted: 1, accepted: 1, duplicatesRemoved: 0, needsReview: 0, autoClassified: 1 },
      }),
    });

    const res = await classifyLineItems([row]);

    expect(res.success).toBe(true);
    expect(res.data?.extractedEntities[0].minorCategory).toBe('Hoses, Valves & Fittings');
    expect(res.classification?.accepted).toBe(1);

    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/rfqs/ingest');
    expect(init.method).toBe('POST');
  });

  // An explicit category wins server-side, so sending the current one would make
  // re-classification a no-op.
  test('withholds the categories already on the rows', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: classified }),
    });

    await classifyLineItems([row]);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      lineItems: [
        {
          id: 'ent-1',
          itemName: 'Flanged Gate Valve 4 inch',
          quantity: 24,
          unit: 'Nos',
          targetDate: '2026-09-18',
          technicalSpecs: 'ASTM A216 WCB',
        },
      ],
    });
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: classified }),
    });

    await classifyLineItems([row]);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
  });

  test('reports the network as unreachable rather than throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await classifyLineItems([row]);

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
  });

  test('reports an unparseable reply as a classification failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await classifyLineItems([row]);

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.classifyFailed);
  });

  test('surfaces the server error on a rejected payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: 'lineItems must be an array of extracted rows.' }),
    });

    const res = await classifyLineItems([row]);

    expect(res.success).toBe(false);
    expect(res.error).toBe('lineItems must be an array of extracted rows.');
  });

  test('falls back to the generic message when the server sends none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false }),
    });

    const res = await classifyLineItems([row]);

    expect(res.error).toBe(UI_STRINGS.rfqExtraction.classifyFailed);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Transport failures must not be reported as model failures
//
// When the API is stopped, the Next dev proxy answers with an HTML 500. Reporting
// the generic "unexpected response" for that blamed the AI for an unreachable
// backend, which is what made a plain "backend not started" look like a bug in
// extraction.
// ══════════════════════════════════════════════════════════════════════════════
describe('rfqClient transport failure reporting', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('extractLineItemsFromDocument reports an unreachable API on a 5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      // A proxy error page is HTML, so parsing must never even be attempted.
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12' });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('NETWORK');
    expect(res.error).toBe(formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 }));
  });

  test('extractLineItemsFromDocument names the status it saw', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.error).toContain('502');
  });

  test('classifyLineItems reports an unreachable API on a 5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });

    const res = await classifyLineItems([
      {
        id: 'ent-1',
        itemName: 'Flanged Gate Valve',
        quantity: 2,
        unit: 'Nos',
        targetDate: '2026-09-18',
        technicalSpecs: '',
        confidence: 90,
        category: 'Pumps & Accessories',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Pumps & Accessories',
      },
    ]);

    expect(res.success).toBe(false);
    expect(res.error).toBe(formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 503 }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Supporting document attachments
//
// Deliberately separate from extraction: on the manual path the document is
// evidence to keep with the RFQ, so no Gemini quota is spent reading it.
// ══════════════════════════════════════════════════════════════════════════════
describe('rfqClient.uploadRFQAttachment', () => {
  const originalFetch = global.fetch;

  const stored = {
    id: 'a1b2c3d4-0000-4000-8000-abcdefabcdef',
    fileName: 'annexure.pdf',
    mimeType: 'application/pdf',
    size: 27,
    uploadedAt: '2026-09-02T11:07:16.000Z',
  };

  const pdf = () => new File(['%PDF-1.4 body'], 'annexure.pdf', { type: 'application/pdf' });

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the file to the attachment endpoint and returns its metadata', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: stored }),
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(true);
    expect(res.data).toEqual(stored);

    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/rfqs/attachments');
    expect(init.method).toBe('POST');

    const sent = JSON.parse(init.body);
    expect(sent.fileName).toBe('annexure.pdf');
    expect(sent.mimeType).toBe('application/pdf');
    // Base64 only, with the data-URL prefix removed.
    expect(sent.content).not.toContain('data:');
    expect(sent.content.length).toBeGreaterThan(0);
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: stored }),
    });

    await uploadRFQAttachment(pdf());

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
  });

  test('reports the network as unreachable rather than throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
  });

  test('reports an unreachable API on a 5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('html');
      },
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe(formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 502 }));
  });

  test('surfaces the refusal the server gave', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ success: false, reason: 'UNSUPPORTED_TYPE', error: 'That file type cannot be attached.' }),
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe('That file type cannot be attached.');
  });

  test('falls back to a generic message when the server sends none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ success: false }),
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.error).toBe(UI_STRINGS.rfqExtraction.attachUnreachable);
  });

  test('reports an unparseable reply', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.attachUnreachable);
  });

  // A file the browser cannot read must not be reported as a server fault.
  test('reports a file that cannot be read', async () => {
    global.fetch = jest.fn();
    jest.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.attachUnreachable);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('rfqAttachmentUrl', () => {
  test('addresses a stored document by id', () => {
    expect(rfqAttachmentUrl('a1b2c3d4-0000-4000-8000-abcdefabcdef')).toBe(
      '/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef'
    );
  });

  test('encodes an id so it cannot alter the path', () => {
    expect(rfqAttachmentUrl('../secret')).toBe('/api/rfqs/attachments/..%2Fsecret');
  });
});

// ==============================================================================
// PERSISTENCE CALLS
// ==============================================================================
// createRFQ / fetchRFQById / fetchRFQList are the only routes RFQ data travels
// on now, and all three are authenticated and organisation-scoped server-side.
// The cases below pin down what each one reports back, because the caller has to
// distinguish "the server said no" from "the server never answered": the wizard
// keeps the buyer's keyed rows in one case and not the other.
// ==============================================================================

describe('rfqClient RFQ persistence', () => {
  const originalFetch = global.fetch;

  const RFQ: RFQItem = {
    id: '41',
    rfqNumber: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 0,
    createdAt: '2026-09-04T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
  };

  const PAYLOAD: RFQCreatePayload = {
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    source: 'manual_entry',
    budget: 0,
    targetDeliveryDate: '2026-09-30',
    deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    deliveryPincode: '400701',
    extractedEntities: [],
    attachments: [],
  };

  /** A minimal Response double. `status` is always set: the client reads it. */
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
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );

  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  describe('createRFQ', () => {
    test('posts the payload and returns the record the server saved', async () => {
      global.fetch = reply(201, { success: true, data: RFQ });

      const res = await createRFQ(PAYLOAD);

      expect(res.success).toBe(true);
      // The server's record, not the object that went in: it owns the number.
      expect(res.success && res.rfq).toEqual(RFQ);
      expect(lastPath()).toBe('/api/rfqs');
      expect(lastInit().method).toBe('POST');
      expect(JSON.parse(lastInit().body)).toEqual(PAYLOAD);
    });

    test('attaches the session token when one is held', async () => {
      signIn();
      global.fetch = reply(201, { success: true, data: RFQ });

      await createRFQ(PAYLOAD);

      expect(lastInit().headers.Authorization).toBe('Bearer jwt-token');
      expect(lastInit().headers['Content-Type']).toBe('application/json');
    });

    test('sends no Authorization header when there is no session', async () => {
      global.fetch = reply(201, { success: true, data: RFQ });

      await createRFQ(PAYLOAD);

      expect(lastInit().headers.Authorization).toBeUndefined();
    });

    test('reports an unreachable API rather than claiming the RFQ was saved', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await createRFQ(PAYLOAD);

      expect(res).toEqual({
        success: false,
        reason: 'NETWORK',
        error: UI_STRINGS.auth.networkUnreachable,
      });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(502);

      const res = await createRFQ(PAYLOAD);

      expect(res.success).toBe(false);
      expect(res.success === false && res.reason).toBe('NETWORK');
      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 502 })
      );
    });

    test('reports an expired session on a 401', async () => {
      global.fetch = reply(401, { success: false, error: 'Token expired.' });

      const res = await createRFQ(PAYLOAD);

      expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Token expired.' });
    });

    test('falls back to the session message when a 403 explains nothing', async () => {
      global.fetch = reply(403, {});

      const res = await createRFQ(PAYLOAD);

      expect(res).toEqual({
        success: false,
        reason: 'UNAUTHORIZED',
        error: UI_STRINGS.auth.sessionExpired,
      });
    });

    // Surfaced per field so the dialog can mark the input that caused it.
    test('passes field errors through on a 400', async () => {
      global.fetch = reply(400, {
        success: false,
        error: 'The RFQ was rejected.',
        fieldErrors: { deliveryPincode: 'PIN Code must be 6 digits.' },
      });

      const res = await createRFQ(PAYLOAD);

      expect(res).toEqual({
        success: false,
        reason: 'VALIDATION',
        error: 'The RFQ was rejected.',
        fieldErrors: { deliveryPincode: 'PIN Code must be 6 digits.' },
      });
    });

    test('reports a server fault on a 500', async () => {
      global.fetch = reply(500, { success: false, error: 'Database unavailable.' });

      const res = await createRFQ(PAYLOAD);

      expect(res.success === false && res.reason).toBe('SERVER');
      expect(res.success === false && res.error).toBe('Database unavailable.');
    });

    test('falls back to a default message when the server sends none', async () => {
      global.fetch = reply(500, {});

      const res = await createRFQ(PAYLOAD);

      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.loadFailed);
    });

    // A 200 that carries no record is a failure: adopting nothing would leave the
    // dialog reporting success over an RFQ that was never written.
    test('rejects a 200 that carries no record', async () => {
      global.fetch = reply(200, { success: true });

      const res = await createRFQ(PAYLOAD);

      expect(res.success).toBe(false);
      expect(res.success === false && res.reason).toBe('SERVER');
    });

    test('rejects a 200 whose body denies success', async () => {
      global.fetch = reply(200, { success: false, data: RFQ, error: 'Not saved.' });

      const res = await createRFQ(PAYLOAD);

      expect(res.success === false && res.error).toBe('Not saved.');
    });
  });

  describe('fetchRFQById', () => {
    test('reads one RFQ through the scoped endpoint', async () => {
      global.fetch = reply(200, { success: true, data: RFQ });

      const res = await fetchRFQById('RFQ260409000512');

      expect(res.success && res.rfq).toEqual(RFQ);
      expect(lastPath()).toBe('/api/rfqs/RFQ260409000512');
    });

    // An identifier is part of the path, so it cannot be allowed to alter it.
    test('encodes the identifier into the path', async () => {
      global.fetch = reply(200, { success: true, data: RFQ });

      await fetchRFQById('../bootstrap');

      expect(lastPath()).toBe('/api/rfqs/..%2Fbootstrap');
    });

    test('attaches the session token when one is held', async () => {
      signIn();
      global.fetch = reply(200, { success: true, data: RFQ });

      await fetchRFQById('41');

      expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
    });

    test('sends no headers when there is no session', async () => {
      global.fetch = reply(200, { success: true, data: RFQ });

      await fetchRFQById('41');

      expect(lastInit().headers).toEqual({});
    });

    test('reports an unreachable API', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await fetchRFQById('41');

      expect(res).toEqual({
        success: false,
        reason: 'NETWORK',
        error: UI_STRINGS.auth.networkUnreachable,
      });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(503);

      const res = await fetchRFQById('41');

      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 503 })
      );
    });

    test('reports an expired session on a 403', async () => {
      global.fetch = reply(403, { error: 'No organisation on the session.' });

      const res = await fetchRFQById('41');

      expect(res).toEqual({
        success: false,
        reason: 'UNAUTHORIZED',
        error: 'No organisation on the session.',
      });
    });

    test('falls back to the session message on an unexplained 401', async () => {
      global.fetch = reply(401, {});

      const res = await fetchRFQById('41');

      expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
    });

    // Another organisation's RFQ reports as not found, which is what the backend
    // returns for it: the same answer as a number that never existed.
    test('reports a 404 as not found', async () => {
      global.fetch = reply(404, { success: false, error: 'No such RFQ.' });

      const res = await fetchRFQById('RFQ-OTHER-ORG');

      expect(res).toEqual({ success: false, reason: 'NOT_FOUND', error: 'No such RFQ.' });
    });

    test('falls back to the not-found message when the server sends none', async () => {
      global.fetch = reply(404, {});

      const res = await fetchRFQById('nope');

      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.notFoundMessage);
    });

    test('reports a server fault on a 500', async () => {
      global.fetch = reply(500, { error: 'Query failed.' });

      const res = await fetchRFQById('41');

      expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Query failed.' });
    });

    test('rejects a 200 that carries no record', async () => {
      global.fetch = reply(200, { success: true });

      const res = await fetchRFQById('41');

      expect(res.success === false && res.reason).toBe('SERVER');
      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.loadFailed);
    });
  });

  describe('fetchRFQList', () => {
    test('reads the organisation-scoped list', async () => {
      global.fetch = reply(200, { success: true, data: [RFQ] });

      const res = await fetchRFQList();

      expect(res.success && res.rfqs).toEqual([RFQ]);
      expect(lastPath()).toBe('/api/rfqs');
    });

    // An empty list is a valid answer: a buyer who has raised nothing has none.
    test('accepts an empty list', async () => {
      global.fetch = reply(200, { success: true, data: [] });

      const res = await fetchRFQList();

      expect(res).toEqual({ success: true, rfqs: [] });
    });

    test('attaches the session token when one is held', async () => {
      signIn();
      global.fetch = reply(200, { success: true, data: [] });

      await fetchRFQList();

      expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
    });

    test('sends no headers when there is no session', async () => {
      global.fetch = reply(200, { success: true, data: [] });

      await fetchRFQList();

      expect(lastInit().headers).toEqual({});
    });

    test('reports an unreachable API', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await fetchRFQList();

      expect(res).toEqual({
        success: false,
        reason: 'NETWORK',
        error: UI_STRINGS.auth.networkUnreachable,
      });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(500);

      const res = await fetchRFQList();

      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 })
      );
    });

    test('reports an expired session on a 401', async () => {
      global.fetch = reply(401, { error: 'Missing token.' });

      const res = await fetchRFQList();

      expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Missing token.' });
    });

    test('falls back to the session message on an unexplained 403', async () => {
      global.fetch = reply(403, {});

      const res = await fetchRFQList();

      expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
    });

    test('reports a server fault on a 500', async () => {
      global.fetch = reply(500, { error: 'Query failed.' });

      const res = await fetchRFQList();

      expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Query failed.' });
    });

    // Anything other than an array would be spread onto the dashboard as though
    // it were RFQs, so the shape is checked rather than trusted.
    test('rejects a body whose data is not an array', async () => {
      global.fetch = reply(200, { success: true, data: { rfqNumber: 'RFQ-1' } });

      const res = await fetchRFQList();

      expect(res.success === false && res.reason).toBe('SERVER');
      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.loadFailed);
    });

    test('rejects a 200 whose body denies success', async () => {
      global.fetch = reply(200, { success: false, data: [], error: 'Not available.' });

      const res = await fetchRFQList();

      expect(res.success === false && res.error).toBe('Not available.');
    });
  });

  describe('fetchAllRFQs', () => {
    test('reads the cross-buyer oversight list', async () => {
      global.fetch = reply(200, { success: true, data: [RFQ] });

      const res = await fetchAllRFQs();

      expect(res.success && res.rfqs).toEqual([RFQ]);
      expect(lastPath()).toBe('/api/rfqs/all');
    });

    test('attaches the session token when one is held', async () => {
      signIn();
      global.fetch = reply(200, { success: true, data: [] });

      await fetchAllRFQs();

      expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
    });

    test('sends no headers when there is no session', async () => {
      global.fetch = reply(200, { success: true, data: [] });

      await fetchAllRFQs();

      expect(lastInit().headers).toEqual({});
    });

    test('reports an unreachable API', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await fetchAllRFQs();

      expect(res).toEqual({ success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(500);

      const res = await fetchAllRFQs();

      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 })
      );
    });

    test('reports UNAUTHORIZED when a buyer or vendor token is rejected with 403', async () => {
      global.fetch = reply(403, { error: 'Forbidden.' });

      const res = await fetchAllRFQs();

      expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Forbidden.' });
    });

    test('falls back to the session message on an unexplained 401', async () => {
      global.fetch = reply(401, {});

      const res = await fetchAllRFQs();

      expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
    });

    test('reports a server fault on a 500', async () => {
      global.fetch = reply(500, { error: 'Query failed.' });

      const res = await fetchAllRFQs();

      expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Query failed.' });
    });

    test('rejects a body whose data is not an array', async () => {
      global.fetch = reply(200, { success: true, data: null });

      const res = await fetchAllRFQs();

      expect(res.success === false && res.reason).toBe('SERVER');
      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.loadFailed);
    });
  });

  describe('fetchVendorCandidates', () => {
    test('reads the category-matched candidate pool for an RFQ', async () => {
      global.fetch = reply(200, { success: true, data: [{ id: 'v-1', alreadyInvited: false }] });

      const res = await fetchVendorCandidates('rfq-1');

      expect(res).toEqual({ success: true, candidates: [{ id: 'v-1', alreadyInvited: false }] });
      expect(lastPath()).toBe('/api/rfqs/rfq-1/vendor-candidates');
    });

    test('attaches the session token when one is held', async () => {
      signIn();
      global.fetch = reply(200, { success: true, data: [] });

      await fetchVendorCandidates('rfq-1');

      expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
    });

    test('sends no headers when there is no session', async () => {
      global.fetch = reply(200, { success: true, data: [] });

      await fetchVendorCandidates('rfq-1');

      expect(lastInit().headers).toEqual({});
    });

    test('reports an unreachable API', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await fetchVendorCandidates('rfq-1');

      expect(res).toEqual({ success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(500);

      const res = await fetchVendorCandidates('rfq-1');

      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 })
      );
    });

    test('reports UNAUTHORIZED for a buyer/vendor token rejected with 403', async () => {
      global.fetch = reply(403, { error: 'Forbidden.' });

      const res = await fetchVendorCandidates('rfq-1');

      expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Forbidden.' });
    });

    test('falls back to the session message on an unexplained 401', async () => {
      global.fetch = reply(401, {});

      const res = await fetchVendorCandidates('rfq-1');

      expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
    });

    test('reports a server fault on a 500', async () => {
      global.fetch = reply(500, { error: 'Query failed.' });

      const res = await fetchVendorCandidates('rfq-1');

      expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Query failed.' });
    });

    test('rejects a body whose data is not an array', async () => {
      global.fetch = reply(200, { success: true, data: null });

      const res = await fetchVendorCandidates('rfq-1');

      expect(res.success === false && res.reason).toBe('SERVER');
      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.loadFailed);
    });

    test('reports a 404 for an unknown RFQ as a server fault', async () => {
      global.fetch = reply(404, { error: 'RFQ not found.' });

      const res = await fetchVendorCandidates('does-not-exist');

      expect(res).toEqual({ success: false, reason: 'SERVER', error: 'RFQ not found.' });
    });
  });

  describe('fetchAllVendors', () => {
    const pagination = { page: 1, pageSize: 50, total: 2, totalPages: 1 };

    test('reads one page of vendors and marks them all not-yet-invited', async () => {
      global.fetch = reply(200, { success: true, data: [{ id: 'v-1' }, { id: 'v-2' }], pagination });

      const res = await fetchAllVendors();

      expect(res).toEqual({
        success: true,
        candidates: [
          { id: 'v-1', alreadyInvited: false },
          { id: 'v-2', alreadyInvited: false },
        ],
        pagination,
      });
      expect(lastPath()).toBe('/api/vendors?buyerId=all&page=1&pageSize=50');
    });

    test('includes a non-empty search term in the query string', async () => {
      global.fetch = reply(200, { success: true, data: [], pagination: { ...pagination, total: 0 } });

      await fetchAllVendors({ page: 2, pageSize: 25, search: '  bolt  ' });

      expect(lastPath()).toBe('/api/vendors?buyerId=all&page=2&pageSize=25&search=bolt');
    });

    test('attaches the session token when one is held', async () => {
      signIn();
      global.fetch = reply(200, { success: true, data: [], pagination });

      await fetchAllVendors();

      expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
    });

    test('sends no headers when there is no session', async () => {
      global.fetch = reply(200, { success: true, data: [], pagination });

      await fetchAllVendors();

      expect(lastInit().headers).toEqual({});
    });

    test('reports an unreachable API', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await fetchAllVendors();

      expect(res).toEqual({ success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(500);

      const res = await fetchAllVendors();

      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 })
      );
    });

    test('reports UNAUTHORIZED for a buyer/vendor token rejected with 403', async () => {
      global.fetch = reply(403, { error: 'Forbidden.' });

      const res = await fetchAllVendors();

      expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Forbidden.' });
    });

    test('falls back to the session message on an unexplained 401', async () => {
      global.fetch = reply(401, {});

      const res = await fetchAllVendors();

      expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
    });

    test('reports a server fault on a 500', async () => {
      global.fetch = reply(500, { error: 'Query failed.' });

      const res = await fetchAllVendors();

      expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Query failed.' });
    });

    test('rejects a body whose data is not an array', async () => {
      global.fetch = reply(200, { success: true, data: null, pagination });

      const res = await fetchAllVendors();

      expect(res.success === false && res.reason).toBe('SERVER');
      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.loadFailed);
    });

    test('rejects a body missing pagination metadata', async () => {
      global.fetch = reply(200, { success: true, data: [{ id: 'v-1' }] });

      const res = await fetchAllVendors();

      expect(res.success === false && res.reason).toBe('SERVER');
    });
  });

  describe('inviteVendorsToRFQ', () => {
    test('posts the selected vendor ids and returns the updated RFQ', async () => {
      global.fetch = reply(200, { success: true, data: RFQ, invitedCount: 2 });

      const res = await inviteVendorsToRFQ('rfq-1', ['v-1', 'v-2']);

      expect(res).toEqual({ success: true, rfq: RFQ, invitedCount: 2 });
      expect(lastPath()).toBe('/api/rfqs/rfq-1/invite-vendors');
      const init = lastInit();
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ vendorIds: ['v-1', 'v-2'] });
    });

    test('defaults invitedCount to 0 when the server omits it', async () => {
      global.fetch = reply(200, { success: true, data: RFQ });

      const res = await inviteVendorsToRFQ('rfq-1', ['v-1']);

      expect(res.success && res.invitedCount).toBe(0);
    });

    test('attaches the session token and JSON content type', async () => {
      signIn();
      global.fetch = reply(200, { success: true, data: RFQ, invitedCount: 1 });

      await inviteVendorsToRFQ('rfq-1', ['v-1']);

      expect(lastInit().headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-token',
      });
    });

    test('sends no Authorization header when there is no session', async () => {
      global.fetch = reply(200, { success: true, data: RFQ, invitedCount: 1 });

      await inviteVendorsToRFQ('rfq-1', ['v-1']);

      expect(lastInit().headers).toEqual({ 'Content-Type': 'application/json' });
    });

    test('reports an unreachable API', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await inviteVendorsToRFQ('rfq-1', ['v-1']);

      expect(res).toEqual({ success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(500);

      const res = await inviteVendorsToRFQ('rfq-1', ['v-1']);

      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 })
      );
    });

    test('reports UNAUTHORIZED for a buyer/vendor token rejected with 403', async () => {
      global.fetch = reply(403, { error: 'Forbidden.' });

      const res = await inviteVendorsToRFQ('rfq-1', ['v-1']);

      expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Forbidden.' });
    });

    test('falls back to the session message on an unexplained 401', async () => {
      global.fetch = reply(401, {});

      const res = await inviteVendorsToRFQ('rfq-1', ['v-1']);

      expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
    });

    test('reports VALIDATION on a 400 (e.g. an empty vendorIds array)', async () => {
      global.fetch = reply(400, { error: 'vendorIds must be a non-empty array.' });

      const res = await inviteVendorsToRFQ('rfq-1', []);

      expect(res).toEqual({ success: false, reason: 'VALIDATION', error: 'vendorIds must be a non-empty array.' });
    });

    test('reports SERVER on a 404 for an unknown RFQ', async () => {
      global.fetch = reply(404, { error: 'RFQ not found.' });

      const res = await inviteVendorsToRFQ('does-not-exist', ['v-1']);

      expect(res).toEqual({ success: false, reason: 'SERVER', error: 'RFQ not found.' });
    });

    test('reports a server fault when the body carries no RFQ', async () => {
      global.fetch = reply(200, { success: true, data: null, invitedCount: 0 });

      const res = await inviteVendorsToRFQ('rfq-1', ['v-1']);

      expect(res.success === false && res.reason).toBe('SERVER');
    });
  });
});

// ==============================================================================
// EDIT AND DELETE
// ==============================================================================
// Both are partial by design and both are organisation-scoped server-side, so the
// case that matters most is NOT_FOUND: it is what another organisation's RFQ
// reports, indistinguishable from an id that never existed.
// ==============================================================================

describe('rfqClient.updateRFQ', () => {
  const originalFetch = global.fetch;

  const RFQ: RFQItem = {
    id: '41',
    rfqNumber: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 0,
    createdAt: '2026-09-04T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
  };

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

  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('PUTs only the fields it was given and adopts the stored record', async () => {
    global.fetch = reply(200, { success: true, data: { ...RFQ, title: 'Revised' } });

    const res = await updateRFQ('RFQ260409000512', { title: 'Revised' });

    expect(res.success).toBe(true);
    expect(res.success && res.rfq.title).toBe('Revised');
    expect(lastPath()).toBe('/api/rfqs/RFQ260409000512');
    expect(lastInit().method).toBe('PUT');
    expect(JSON.parse(lastInit().body)).toEqual({ title: 'Revised' });
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = reply(200, { success: true, data: RFQ });

    await updateRFQ('41', { status: 'In Evaluation' });

    expect(lastInit().headers.Authorization).toBe('Bearer jwt-token');
    expect(lastInit().headers['Content-Type']).toBe('application/json');
  });

  test('sends no Authorization header when there is no session', async () => {
    global.fetch = reply(200, { success: true, data: RFQ });

    await updateRFQ('41', { status: 'In Evaluation' });

    expect(lastInit().headers.Authorization).toBeUndefined();
  });

  // An identifier is part of the path, so it cannot be allowed to alter it.
  test('encodes the identifier into the path', async () => {
    global.fetch = reply(200, { success: true, data: RFQ });

    await updateRFQ('../bootstrap', { title: 'Revised' });

    expect(lastPath()).toBe('/api/rfqs/..%2Fbootstrap');
  });

  test('reports an unreachable API rather than claiming the edit was saved', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res).toEqual({
      success: false,
      reason: 'NETWORK',
      error: UI_STRINGS.auth.networkUnreachable,
    });
  });

  test('names the status when the reply cannot be read', async () => {
    global.fetch = unreadable(502);

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.error).toBe(
      formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 502 })
    );
  });

  test('reports an expired session on a 401', async () => {
    global.fetch = reply(401, { error: 'Token expired.' });

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Token expired.' });
  });

  test('falls back to the session message on an unexplained 403', async () => {
    global.fetch = reply(403, {});

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
  });

  // Another organisation's RFQ answers exactly as a nonexistent one does.
  test('reports a 404 as not found', async () => {
    global.fetch = reply(404, { error: 'No such RFQ.' });

    const res = await updateRFQ('RFQ-OTHER-ORG', { title: 'Rewritten' });

    expect(res).toEqual({ success: false, reason: 'NOT_FOUND', error: 'No such RFQ.' });
  });

  test('falls back to the not-found message when the server sends none', async () => {
    global.fetch = reply(404, {});

    const res = await updateRFQ('nope', { title: 'Revised' });

    expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.notFoundMessage);
  });

  test('passes field errors through on a 400', async () => {
    global.fetch = reply(400, {
      error: 'The edit was rejected.',
      fieldErrors: { deliveryPincode: 'PIN Code must be 6 digits.' },
    });

    const res = await updateRFQ('41', { deliveryPincode: '!!' });

    expect(res).toEqual({
      success: false,
      reason: 'VALIDATION',
      error: 'The edit was rejected.',
      fieldErrors: { deliveryPincode: 'PIN Code must be 6 digits.' },
    });
  });

  test('reports a server fault on a 500', async () => {
    global.fetch = reply(500, { error: 'Query failed.' });

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.reason).toBe('SERVER');
    expect(res.success === false && res.error).toBe('Query failed.');
  });

  test('falls back to a default message when the server sends none', async () => {
    global.fetch = reply(500, {});

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.error).toBe(UI_STRINGS.rfqEdit.saveFailed);
  });

  // A 200 with no record would leave the caller reporting success over an edit
  // that may not have been written.
  test('rejects a 200 that carries no record', async () => {
    global.fetch = reply(200, { success: true });

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.reason).toBe('SERVER');
  });

  test('rejects a 200 whose body denies success', async () => {
    global.fetch = reply(200, { success: false, data: RFQ, error: 'Not saved.' });

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.error).toBe('Not saved.');
  });

  test('sends line items and attachments when the edit changed them', async () => {
    global.fetch = reply(200, { success: true, data: RFQ });
    const items = [
      {
        id: 'e1',
        itemName: 'Gate valve',
        quantity: 9,
        unit: 'Nos',
        targetDate: '2026-10-01',
        technicalSpecs: '',
        confidence: 0,
        category: 'Hoses, Valves & Fittings',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Hoses, Valves & Fittings',
      },
    ];

    await updateRFQ('41', { extractedEntities: items, attachments: [] });

    expect(JSON.parse(lastInit().body)).toEqual({ extractedEntities: items, attachments: [] });
  });
});

describe('rfqClient.deleteRFQ', () => {
  const originalFetch = global.fetch;

  const reply = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('DELETEs the RFQ and returns the number that was removed', async () => {
    global.fetch = reply(200, { success: true, data: { rfqNumber: 'RFQ260409000512' } });

    const res = await deleteRFQ('41');

    expect(res).toEqual({ success: true, rfqNumber: 'RFQ260409000512' });
    expect(lastPath()).toBe('/api/rfqs/41');
    expect(lastInit().method).toBe('DELETE');
  });

  // The row still has to be dropped even if the response omitted the echo.
  test('falls back to the identifier it was asked to delete', async () => {
    global.fetch = reply(200, { success: true });

    const res = await deleteRFQ('RFQ260409000512');

    expect(res).toEqual({ success: true, rfqNumber: 'RFQ260409000512' });
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = reply(200, { success: true, data: { rfqNumber: 'R1' } });

    await deleteRFQ('R1');

    expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
  });

  test('sends no headers when there is no session', async () => {
    global.fetch = reply(200, { success: true, data: { rfqNumber: 'R1' } });

    await deleteRFQ('R1');

    expect(lastInit().headers).toEqual({});
  });

  test('encodes the identifier into the path', async () => {
    global.fetch = reply(200, { success: true, data: { rfqNumber: 'R1' } });

    await deleteRFQ('../bootstrap');

    expect(lastPath()).toBe('/api/rfqs/..%2Fbootstrap');
  });

  test('reports an unreachable API rather than dropping the row', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await deleteRFQ('41');

    expect(res).toEqual({
      success: false,
      reason: 'NETWORK',
      error: UI_STRINGS.auth.networkUnreachable,
    });
  });

  test('names the status when the reply cannot be read', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await deleteRFQ('41');

    expect(res.success === false && res.error).toBe(
      formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 503 })
    );
  });

  test('reports an expired session on a 401', async () => {
    global.fetch = reply(401, { error: 'Missing token.' });

    const res = await deleteRFQ('41');

    expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Missing token.' });
  });

  test('falls back to the session message on an unexplained 403', async () => {
    global.fetch = reply(403, {});

    const res = await deleteRFQ('41');

    expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
  });

  // The case that matters: deleting another organisation's RFQ must not appear
  // to have worked.
  test('reports a 404 as not found', async () => {
    global.fetch = reply(404, { error: 'No such RFQ.' });

    const res = await deleteRFQ('RFQ-OTHER-ORG');

    expect(res).toEqual({ success: false, reason: 'NOT_FOUND', error: 'No such RFQ.' });
  });

  test('falls back to the not-found message when the server sends none', async () => {
    global.fetch = reply(404, {});

    const res = await deleteRFQ('nope');

    expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.notFoundMessage);
  });

  test('reports a server fault on a 500', async () => {
    global.fetch = reply(500, { error: 'Delete failed.' });

    const res = await deleteRFQ('41');

    expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Delete failed.' });
  });

  test('falls back to a default message when the server sends none', async () => {
    global.fetch = reply(500, {});

    const res = await deleteRFQ('41');

    expect(res.success === false && res.error).toBe(UI_STRINGS.rfqEdit.deleteFailed);
  });

  test('rejects a 200 whose body denies success', async () => {
    global.fetch = reply(200, { success: false, error: 'Not deleted.' });

    const res = await deleteRFQ('41');

    expect(res.success === false && res.error).toBe('Not deleted.');
  });
});

describe('rfqClient.downloadQuoteAttachment', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('downloads an attachment from the encoded RFQ endpoint', async () => {
    const urlSpy = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:quote-file');
    const blob = new Blob(['quote document']);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob });

    await expect(downloadQuoteAttachment('RFQ/1', {
      id: 'attachment/1',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      size: 10,
      uploadedAt: '2026-10-10',
    })).resolves.toEqual({ success: true, url: 'blob:quote-file' });
    expect(global.fetch).toHaveBeenCalledWith('/api/rfqs/RFQ%2F1/quote-attachments/attachment%2F1', { headers: {} });
    expect(urlSpy).toHaveBeenCalledWith(blob);
  });

  test('returns a server message or a useful fallback when the download is rejected', async () => {
    const attachment = { id: 'a1', fileName: 'quote.pdf', mimeType: 'application/pdf', size: 10, uploadedAt: '' };
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Attachment expired' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => { throw new Error('not JSON'); } });

    await expect(downloadQuoteAttachment('1', attachment))
      .resolves.toEqual({ success: false, error: 'Attachment expired' });
    await expect(downloadQuoteAttachment('1', attachment))
      .resolves.toEqual({ success: false, error: 'The bid document could not be downloaded.' });
  });

  test('returns a network error when the attachment request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    await expect(downloadQuoteAttachment('1', {
      id: 'a1',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      size: 10,
      uploadedAt: '',
    })).resolves.toEqual({ success: false, error: UI_STRINGS.auth.networkUnreachable });
  });
});

describe('rfqClient inquiry APIs', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('submits an inquiry and returns the created data', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'inq-1' }, rfq: { id: 'rfq-1' } }),
    });

    await expect(submitRFQInquiry('RFQ/1', { message: 'Please clarify delivery', vendorName: 'Acme' }))
      .resolves.toEqual({ success: true, data: { id: 'inq-1' }, rfq: { id: 'rfq-1' } });
    expect(global.fetch).toHaveBeenCalledWith('/api/rfqs/RFQ%2F1/inquiries', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ message: 'Please clarify delivery', vendorName: 'Acme' }),
    }));
  });

  test('returns an API message or a default when inquiry submission fails', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Inquiry rejected' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) });

    await expect(submitRFQInquiry('1', { message: 'Question' }))
      .resolves.toEqual({ success: false, error: 'Inquiry rejected' });
    await expect(submitRFQInquiry('1', { message: 'Question' }))
      .resolves.toEqual({ success: false, error: 'Failed to submit inquiry.' });
  });

  test('returns a network error when inquiry submission throws a non-Error value', async () => {
    global.fetch = jest.fn().mockRejectedValue(null);

    await expect(submitRFQInquiry('1', { message: 'Question' }))
      .resolves.toEqual({ success: false, error: 'Network error submitting inquiry.' });
  });

  test('replies to an inquiry and returns updated records', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'inq-1' }, rfq: { id: 'rfq-1' } }),
    });

    await expect(replyToRFQInquiry('RFQ 1', 'inq/1', { reply: 'Delivery is 10 days', repliedBy: 'Buyer' }))
      .resolves.toEqual({ success: true, data: { id: 'inq-1' }, rfq: { id: 'rfq-1' } });
    expect(global.fetch).toHaveBeenCalledWith('/api/rfqs/RFQ%201/inquiries/inq%2F1/reply', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reply: 'Delivery is 10 days', repliedBy: 'Buyer' }),
    }));
  });

  test('returns API failures and network failures for inquiry replies', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'Reply rejected' }) });
    await expect(replyToRFQInquiry('1', '2', { reply: 'Reply' }))
      .resolves.toEqual({ success: false, error: 'Reply rejected' });

    global.fetch = jest.fn().mockRejectedValue(new Error('Offline'));
    await expect(replyToRFQInquiry('1', '2', { reply: 'Reply' }))
      .resolves.toEqual({ success: false, error: 'Offline' });
  });
});

describe('rfqClient.requestVendorCategoryUpdateEmail', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('successfully sends category update email with auth token', async () => {
    authClient.setSession(
      { id: 'usr-1', email: 'buyer@procucev.com', name: 'Buyer', role: 'buyer', orgId: 'o1', orgName: 'Org' },
      'sample-jwt-token'
    );

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Email sent successfully.' }),
    });

    const res = await requestVendorCategoryUpdateEmail({
      vendorId: 'v-123',
      vendorEmail: 'vendor@abc.com',
      vendorName: 'ABC Corp',
      rfqCategory: 'Mechanical',
      rfqTitle: 'Pumps Requisition',
    });

    expect(res).toEqual({ success: true, message: 'Email sent successfully.' });
    expect(global.fetch).toHaveBeenCalledWith('/api/rfqs/request-vendor-category-update', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer sample-jwt-token',
        'Content-Type': 'application/json',
      }),
    }));
  });

  test('handles server failure response cleanly', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: 'Target vendor email or valid vendorId is required.' }),
    });

    const res = await requestVendorCategoryUpdateEmail({});
    expect(res).toEqual({ success: false, error: 'Target vendor email or valid vendorId is required.' });
  });

  test('handles network throw gracefully', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

    const res = await requestVendorCategoryUpdateEmail({ vendorEmail: 'v@abc.com' });
    expect(res).toEqual({ success: false, error: 'Network offline' });
  });
});
