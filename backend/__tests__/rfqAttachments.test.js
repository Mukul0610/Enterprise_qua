const request = require('supertest');

// Fake, fully in-memory Cloudflare R2 (S3-compatible) client so this suite can
// exercise rfqAttachmentService.js's real read/write logic without a real
// bucket. Mirrors just enough of the AWS SDK v3 shape (Command classes
// carrying their params on `.input`, `client.send(command)`) for that
// service's actual code to run unmodified against it.
const fakeR2Store = new Map();
let nextSendError = null;

class FakePutObjectCommand {
  constructor(input) {
    this.input = input;
  }
}
class FakeGetObjectCommand {
  constructor(input) {
    this.input = input;
  }
}

/** Minimal async-iterable so `for await (const chunk of body)` works. */
function makeReadable(buffer) {
  return {
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        next() {
          if (done) return Promise.resolve({ done: true, value: undefined });
          done = true;
          return Promise.resolve({ done: false, value: buffer });
        },
      };
    },
  };
}

jest.doMock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: FakePutObjectCommand,
  GetObjectCommand: FakeGetObjectCommand,
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(async (command) => {
      if (nextSendError) {
        const err = nextSendError;
        nextSendError = null;
        throw err;
      }
      if (command instanceof FakePutObjectCommand) {
        fakeR2Store.set(command.input.Key, {
          body: command.input.Body,
          ContentType: command.input.ContentType,
          Metadata: command.input.Metadata,
        });
        return {};
      }
      if (command instanceof FakeGetObjectCommand) {
        const stored = fakeR2Store.get(command.input.Key);
        if (!stored) {
          const err = new Error('The specified key does not exist.');
          err.name = 'NoSuchKey';
          throw err;
        }
        return { Body: makeReadable(stored.body), ContentType: stored.ContentType, Metadata: stored.Metadata };
      }
      throw new Error('Unsupported command in fake R2 client');
    }),
  })),
}));

process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET = 'test-bucket';

const { app } = require('../src/server');
const { RFQ_ATTACHMENT_CONFIG } = require('../src/config/constants');
const attachments = require('../src/services/rfqAttachmentService');
const quoteAttachments = require('../src/services/quoteAttachmentService');
const authService = require('../src/services/authService');
const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const { ATTACHMENT_STATUS } = attachments;

function authHeader(role = 'buyer') {
  const token = authService.generateSessionToken({
    id: 'u1',
    email: `${role}@enterprise.com`,
    role,
    orgId: 'o1',
    orgName: 'L&T',
  });
  return { Authorization: `Bearer ${token}` };
}

const pdfBody = () => Buffer.from('%PDF-1.4 line item annexure').toString('base64');

afterAll(() => {
  fakeR2Store.clear();
});

describe('RFQ attachment storage service', () => {
  describe('resolveObjectKey', () => {
    // An id is only ever generated server-side; refusing anything else is what
    // keeps a malformed/foreign id out of R2 entirely.
    test.each([
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      'a/b',
      'short',
      '',
      'NOT-HEX-@@',
    ])('refuses to build a key for %p', (id) => {
      expect(attachments.resolveObjectKey(id)).toBeNull();
    });

    test.each([null, undefined, 42, {}])('refuses a non-string id %p', (id) => {
      expect(attachments.resolveObjectKey(id)).toBeNull();
    });

    test('builds a key inside the configured storage prefix', () => {
      const key = attachments.resolveObjectKey('a1b2c3d4-0000-4000-8000-abcdefabcdef');
      expect(key).toBe(`${RFQ_ATTACHMENT_CONFIG.STORAGE_DIR}/a1b2c3d4-0000-4000-8000-abcdefabcdef`);
    });
  });

  describe('safeFileName', () => {
    // The stored key uses the generated id, but the name is echoed into the RFQ,
    // so it is reduced to a leaf first.
    test.each([
      ['../../evil/report.pdf', 'report.pdf'],
      ['C:\\Users\\navin\\boq.xlsx', 'boq.xlsx'],
      ['plain.pdf', 'plain.pdf'],
    ])('reduces %p to %p', (input, expected) => {
      expect(attachments.safeFileName(input)).toBe(expected);
    });

    test.each(['', '   ', '.', '..', null, undefined])('falls back for %p', (input) => {
      expect(attachments.safeFileName(input)).toBe('attachment');
    });
  });

  describe('decodedByteLength', () => {
    test.each([
      ['', 0],
      ['QQ==', 1],
      ['QUE=', 2],
      ['QUFB', 3],
    ])('reads %p as %i bytes', (input, expected) => {
      expect(attachments.decodedByteLength(input)).toBe(expected);
    });

    test('ignores whitespace a data URL may carry', () => {
      expect(attachments.decodedByteLength('QU\nFB')).toBe(3);
    });

    test.each([null, undefined])('treats %p as empty', (input) => {
      expect(attachments.decodedByteLength(input)).toBe(0);
    });
  });

  describe('isAllowedType', () => {
    test('accepts the document types a buyer attaches', () => {
      expect(attachments.isAllowedType('application/pdf')).toBe(true);
      expect(attachments.isAllowedType('image/png')).toBe(true);
    });

    // An allow-list rather than a block-list, so an executable cannot slip in by
    // simply not having been thought of.
    test.each(['application/x-msdownload', 'application/x-sh', 'text/html', '', undefined])(
      'refuses %p',
      (mimeType) => {
        expect(attachments.isAllowedType(mimeType)).toBe(false);
      }
    );
  });

  describe('saveAttachment and loadAttachment', () => {
    test('stores a document and reads it back byte for byte', async () => {
      const saved = await attachments.saveAttachment({
        fileName: 'annexure.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      });

      expect(saved.status).toBe(ATTACHMENT_STATUS.SAVED);
      expect(saved.attachment.fileName).toBe('annexure.pdf');
      expect(saved.attachment.size).toBeGreaterThan(0);
      expect(saved.attachment.uploadedAt).toBeDefined();

      const loaded = await attachments.loadAttachment(saved.attachment.id);
      expect(loaded.content.toString()).toBe('%PDF-1.4 line item annexure');
      expect(loaded.meta.mimeType).toBe('application/pdf');
      expect(loaded.meta.fileName).toBe('annexure.pdf');
    });

    // Non-ASCII filenames are realistic here and R2 metadata travels as HTTP
    // headers, so the round-trip must survive URL-encoding transparently.
    test('round-trips a non-ASCII filename', async () => {
      const saved = await attachments.saveAttachment({
        fileName: 'ऑर्डर विवरण.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      });

      const loaded = await attachments.loadAttachment(saved.attachment.id);
      expect(loaded.meta.fileName).toBe('ऑर्डर विवरण.pdf');
    });

    test('strips a directory component from the supplied name', async () => {
      const saved = await attachments.saveAttachment({
        fileName: '../../evil/report.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      });
      expect(saved.attachment.fileName).toBe('report.pdf');
    });

    test.each([
      [{ content: '' }, ATTACHMENT_STATUS.NO_CONTENT],
      [{ content: undefined }, ATTACHMENT_STATUS.NO_CONTENT],
    ])('refuses an empty body %p', async (overrides, expected) => {
      const result = await attachments.saveAttachment({
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        ...overrides,
      });
      expect(result.status).toBe(expected);
      expect(result.attachment).toBeNull();
    });

    test('refuses a body that decodes to nothing', async () => {
      const result = await attachments.saveAttachment({
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        content: '   ',
      });
      expect(result.status).toBe(ATTACHMENT_STATUS.NO_CONTENT);
    });

    test('refuses a type outside the allow-list', async () => {
      const result = await attachments.saveAttachment({
        fileName: 'payload.exe',
        mimeType: 'application/x-msdownload',
        content: pdfBody(),
      });
      expect(result.status).toBe(ATTACHMENT_STATUS.UNSUPPORTED_TYPE);
    });

    // Checked before decoding, so an oversized upload is never materialised.
    test('refuses a document over the size ceiling', async () => {
      const oversize = 'A'.repeat(RFQ_ATTACHMENT_CONFIG.MAX_BYTES * 2);
      const result = await attachments.saveAttachment({
        fileName: 'huge.pdf',
        mimeType: 'application/pdf',
        content: oversize,
      });
      expect(result.status).toBe(ATTACHMENT_STATUS.TOO_LARGE);
    });

    test('defaults to an empty payload when called with no arguments', async () => {
      expect((await attachments.saveAttachment()).status).toBe(ATTACHMENT_STATUS.NO_CONTENT);
    });

    test('reports a write failure rather than throwing', async () => {
      nextSendError = new Error('ENOSPC: no space left on device');
      const result = await attachments.saveAttachment({
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      });
      expect(result.status).toBe(ATTACHMENT_STATUS.WRITE_FAILED);
      expect(result.error).toContain('ENOSPC');
    });

    test('fails closed (WRITE_FAILED) when R2 is not configured', async () => {
      const savedEnv = {
        R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
      };
      let freshAttachments;
      jest.isolateModules(() => {
        delete process.env.R2_ACCOUNT_ID;
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_SECRET_ACCESS_KEY;
        freshAttachments = require('../src/services/rfqAttachmentService');
      });

      try {
        // getClient() is lazy — it only reads process.env on its first real
        // call, which happens here, so the env vars must stay deleted through
        // these calls rather than being restored right after isolateModules.
        const result = await freshAttachments.saveAttachment({
          fileName: 'a.pdf',
          mimeType: 'application/pdf',
          content: pdfBody(),
        });
        expect(result.status).toBe(ATTACHMENT_STATUS.WRITE_FAILED);

        const loaded = await freshAttachments.loadAttachment('a1b2c3d4-0000-4000-8000-abcdefabcdef');
        expect(loaded).toBeNull();
      } finally {
        Object.assign(process.env, savedEnv);
      }
    });

    test.each(['a1b2c3d4-0000-4000-8000-ffffffffffff', '../../etc/passwd'])(
      'returns null for the unknown or unsafe id %p',
      async (id) => {
        expect(await attachments.loadAttachment(id)).toBeNull();
      }
    );

    test('returns null rather than throwing when the R2 read fails', async () => {
      const saved = await attachments.saveAttachment({
        fileName: 'flaky.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      });
      nextSendError = new Error('ETIMEDOUT');

      expect(await attachments.loadAttachment(saved.attachment.id)).toBeNull();
    });

    // Defensive fallbacks for an object whose metadata is missing entirely —
    // shouldn't happen via saveAttachment, but the read side must not throw.
    test('falls back sensible defaults when the stored object has no metadata', async () => {
      const id = 'a1b2c3d4-1111-4000-8000-abcdefabcdef';
      fakeR2Store.set(attachments.resolveObjectKey(id), {
        body: Buffer.from('raw bytes, no metadata'),
        ContentType: 'application/pdf',
        Metadata: undefined,
      });

      const loaded = await attachments.loadAttachment(id);

      expect(loaded.meta.fileName).toBe('attachment');
      expect(loaded.meta.size).toBe(Buffer.byteLength('raw bytes, no metadata'));
      expect(loaded.meta.uploadedAt).toBeNull();
    });

    // The SDK's response body can yield Uint8Array chunks rather than Buffers;
    // bufferBody must normalise either shape.
    test('buffers a non-Buffer chunk from the response body', async () => {
      const id = 'a1b2c3d4-2222-4000-8000-abcdefabcdef';
      fakeR2Store.set(attachments.resolveObjectKey(id), {
        body: new Uint8Array(Buffer.from('uint8 bytes')),
        ContentType: 'application/pdf',
        Metadata: { filename: encodeURIComponent('u8.pdf'), size: '11', uploadedat: '2026-01-01T00:00:00.000Z' },
      });

      const loaded = await attachments.loadAttachment(id);

      expect(loaded.content.toString()).toBe('uint8 bytes');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('vendor quote attachment storage', () => {
  test('keeps bid documents in a separate prefix and binds them to their RFQ and vendor', async () => {
    const saved = await quoteAttachments.saveQuoteAttachment(
      {
        fileName: 'bid.pdf',
        mimeType: 'application/pdf',
        content: pdfBody(),
      },
      { rfqId: 'rfq-123', vendorId: 'vendor-456' }
    );

    expect(saved.status).toBe(ATTACHMENT_STATUS.SAVED);
    expect(fakeR2Store.has(`${RFQ_ATTACHMENT_CONFIG.STORAGE_DIR}-quotes/${saved.attachment.id}`)).toBe(true);
    const loaded = await quoteAttachments.loadQuoteAttachment(saved.attachment.id);
    expect(loaded.access).toEqual({ rfqId: 'rfq-123', vendorId: 'vendor-456' });
    expect(loaded.content.toString()).toBe('%PDF-1.4 line item annexure');
    expect(saved.attachment).not.toHaveProperty('vendorId');
  });
});

describe('RFQ attachment HTTP routes', () => {
  describe('POST /api/rfqs/attachments', () => {
    test('stores a document and returns its metadata', async () => {
      const res = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({ fileName: 'annexure.pdf', mimeType: 'application/pdf', content: pdfBody() });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fileName).toBe('annexure.pdf');
      expect(res.body.data.id).toBeDefined();
    });

    // An attachment is commercial-in-confidence, so neither route may be anonymous.
    test('requires a session', async () => {
      const res = await request(app)
        .post('/api/rfqs/attachments')
        .send({ fileName: 'a.pdf', mimeType: 'application/pdf', content: pdfBody() });

      expect(res.statusCode).toBe(401);
    });

    test('returns 400 when the payload is incomplete', async () => {
      const res = await request(app).post('/api/rfqs/attachments').set(authHeader('buyer')).send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.fileName).toBeDefined();
    });

    test('returns 422 with a reason for a type outside the allow-list', async () => {
      const res = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({ fileName: 'payload.exe', mimeType: 'application/x-msdownload', content: pdfBody() });

      expect(res.statusCode).toBe(422);
      expect(res.body.reason).toBe(ATTACHMENT_STATUS.UNSUPPORTED_TYPE);
      expect(res.body.error).toMatch(/cannot be attached/i);
    });

    test('returns 422 for a document over the size ceiling', async () => {
      const res = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({
          fileName: 'huge.pdf',
          mimeType: 'application/pdf',
          content: 'A'.repeat(Math.ceil((RFQ_ATTACHMENT_CONFIG.MAX_BYTES * 4) / 3) + 1024),
        });

      expect(res.statusCode).toBe(422);
      expect(res.body.reason).toBe(ATTACHMENT_STATUS.TOO_LARGE);
      expect(res.body.error).toMatch(/limit/i);
    }, 40000);

    // A storage fault is ours, not the buyer's, so it is a 500 rather than a 422.
    test('returns 500 when storage fails', async () => {
      const spy = jest.spyOn(attachments, 'saveAttachment').mockResolvedValue({
        status: ATTACHMENT_STATUS.WRITE_FAILED,
        attachment: null,
        error: 'disk full',
      });
      try {
        const res = await request(app)
          .post('/api/rfqs/attachments')
          .set(authHeader('buyer'))
          .send({ fileName: 'a.pdf', mimeType: 'application/pdf', content: pdfBody() });

        expect(res.statusCode).toBe(500);
        expect(res.body.reason).toBe(ATTACHMENT_STATUS.WRITE_FAILED);
      } finally {
        spy.mockRestore();
      }
    });

    test('surfaces an unexpected fault through the error handler', async () => {
      const spy = jest.spyOn(attachments, 'saveAttachment').mockRejectedValue(new Error('boom'));
      try {
        const res = await request(app)
          .post('/api/rfqs/attachments')
          .set(authHeader('buyer'))
          .send({ fileName: 'a.pdf', mimeType: 'application/pdf', content: pdfBody() });

        expect(res.statusCode).toBe(500);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('GET /api/rfqs/attachments/:attachmentId', () => {
    test('serves the stored bytes with the stored name and type', async () => {
      const upload = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({ fileName: 'annexure.pdf', mimeType: 'application/pdf', content: pdfBody() });

      const res = await request(app)
        .get(`/api/rfqs/attachments/${upload.body.data.id}`)
        .set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      // Inline so a PDF or image previews rather than forcing a download.
      expect(res.headers['content-disposition']).toBe('inline; filename="annexure.pdf"');
      expect(res.body.toString()).toBe('%PDF-1.4 line item annexure');
    });

    test('requires a session', async () => {
      const res = await request(app).get('/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef');
      expect(res.statusCode).toBe(401);
    });

    test('returns 404 for an unknown document', async () => {
      const res = await request(app)
        .get('/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-ffffffffffff')
        .set(authHeader('buyer'));

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/no longer available/i);
    });

    // The route must not be usable to read arbitrary objects by a crafted id.
    test('returns 404 rather than an object for a traversal-shaped id', async () => {
      const res = await request(app)
        .get('/api/rfqs/attachments/..%2F..%2Fpackage.json')
        .set(authHeader('buyer'));

      expect(res.statusCode).toBe(404);
    });

    test('surfaces an unexpected fault through the error handler', async () => {
      const spy = jest.spyOn(attachments, 'loadAttachment').mockRejectedValue(new Error('boom'));
      try {
        const res = await request(app)
          .get('/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef')
          .set(authHeader('buyer'));

        expect(res.statusCode).toBe(500);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('POST /api/rfqs with attachments', () => {
    test('persists attachment metadata against the RFQ', async () => {
      const upload = await request(app)
        .post('/api/rfqs/attachments')
        .set(authHeader('buyer'))
        .send({ fileName: 'annexure.pdf', mimeType: 'application/pdf', content: pdfBody() });

      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Manually Keyed Spares Requirement',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
          attachments: [upload.body.data],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.attachments).toHaveLength(1);
      expect(res.body.data.attachments[0].fileName).toBe('annexure.pdf');
    });

    test('defaults to no attachments when none are supplied', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Requirement With No Documents',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: A_FUTURE_DATE,
          sourcingMode: 'mode_1',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.attachments).toEqual([]);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// The native R2 binding path (r2Client.js's getBinding()) — preferred over the
// S3Client path above when running on Workers, where `new S3Client(...)`
// itself throws (confirmed live against the deployed Worker; see
// r2Client.js's getBinding() comment for the full story). Every test above
// exercises the S3Client fallback since globalThis.__CF_ENV__ is unset by
// default in this suite; these set it to prove the binding branch works too.
describe('RFQ attachment storage service (Workers R2 binding path)', () => {
  const originalCfEnv = globalThis.__CF_ENV__;
  const bindingStore = new Map();

  function fakeBinding() {
    return {
      put: jest.fn(async (key, body, opts) => {
        bindingStore.set(key, { body, httpMetadata: opts.httpMetadata, customMetadata: opts.customMetadata });
      }),
      get: jest.fn(async (key) => {
        const stored = bindingStore.get(key);
        if (!stored) return null;
        return {
          httpMetadata: stored.httpMetadata,
          customMetadata: stored.customMetadata,
          arrayBuffer: async () => stored.body.buffer.slice(stored.body.byteOffset, stored.body.byteOffset + stored.body.byteLength),
        };
      }),
    };
  }

  afterEach(() => {
    globalThis.__CF_ENV__ = originalCfEnv;
    bindingStore.clear();
  });

  test('saveAttachment writes through the binding when one is present', async () => {
    globalThis.__CF_ENV__ = { R2_BUCKET: fakeBinding() };

    const result = await attachments.saveAttachment({
      fileName: 'binding-test.pdf',
      mimeType: 'application/pdf',
      content: pdfBody(),
    });

    expect(result.status).toBe(ATTACHMENT_STATUS.SAVED);
    expect(bindingStore.size).toBe(1);
  });

  test('loadAttachment reads back through the binding when one is present', async () => {
    globalThis.__CF_ENV__ = { R2_BUCKET: fakeBinding() };

    const saved = await attachments.saveAttachment({
      fileName: 'binding-roundtrip.pdf',
      mimeType: 'application/pdf',
      content: pdfBody(),
    });

    const loaded = await attachments.loadAttachment(saved.attachment.id);

    expect(loaded).not.toBeNull();
    expect(loaded.meta.fileName).toBe('binding-roundtrip.pdf');
    expect(loaded.meta.mimeType).toBe('application/pdf');
    expect(loaded.content.toString()).toBe(Buffer.from(pdfBody(), 'base64').toString());
  });

  test('loadAttachment returns null through the binding when the object is missing', async () => {
    globalThis.__CF_ENV__ = { R2_BUCKET: fakeBinding() };
    const loaded = await attachments.loadAttachment('a'.repeat(32));
    expect(loaded).toBeNull();
  });

  test('saveAttachment fails closed when neither a binding nor S3 credentials are configured', async () => {
    globalThis.__CF_ENV__ = {};
    const originalAccountId = process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCOUNT_ID;

    let freshAttachments;
    jest.isolateModules(() => {
      freshAttachments = require('../src/services/rfqAttachmentService');
    });
    const result = await freshAttachments.saveAttachment({
      fileName: 'nobinding.pdf',
      mimeType: 'application/pdf',
      content: pdfBody(),
    });

    expect(result.status).toBe(ATTACHMENT_STATUS.WRITE_FAILED);
    process.env.R2_ACCOUNT_ID = originalAccountId;
  });
});
