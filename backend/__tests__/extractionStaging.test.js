const request = require('supertest');

// Same minimal fake-R2 harness rfqAttachments.test.js uses, so this exercises
// extractionStagingService.js's real put/get/delete logic without a real bucket.
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
class FakeDeleteObjectCommand {
  constructor(input) {
    this.input = input;
  }
}

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
  DeleteObjectCommand: FakeDeleteObjectCommand,
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(async (command) => {
      if (nextSendError) {
        const err = nextSendError;
        nextSendError = null;
        throw err;
      }
      if (command instanceof FakePutObjectCommand) {
        fakeR2Store.set(command.input.Key, { body: command.input.Body, ContentType: command.input.ContentType });
        return {};
      }
      if (command instanceof FakeGetObjectCommand) {
        const stored = fakeR2Store.get(command.input.Key);
        if (!stored) {
          const err = new Error('The specified key does not exist.');
          err.name = 'NoSuchKey';
          throw err;
        }
        return { Body: makeReadable(stored.body), ContentType: stored.ContentType };
      }
      if (command instanceof FakeDeleteObjectCommand) {
        fakeR2Store.delete(command.input.Key);
        return {};
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
const staging = require('../src/services/extractionStagingService');
const authService = require('../src/services/authService');
const { GEMINI_CONFIG } = require('../src/config/constants');

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

/** Shape a Gemini generateContent success payload around a JSON string. */
function geminiReply(jsonText) {
  return {
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: jsonText }] } }] }),
  };
}

afterAll(() => {
  fakeR2Store.clear();
});

describe('extractionStagingService', () => {
  afterEach(() => {
    fakeR2Store.clear();
  });

  test('stages a buffer and reads it back unchanged', async () => {
    const buffer = Buffer.from('%PDF-1.4 content');
    const { status, key } = await staging.stage(buffer, 'application/pdf');
    expect(status).toBe('SAVED');

    const loaded = await staging.load(key);
    expect(loaded.equals(buffer)).toBe(true);
  });

  test('refuses a buffer over the configured cap', async () => {
    const original = GEMINI_CONFIG.MAX_DOCUMENT_BYTES;
    GEMINI_CONFIG.MAX_DOCUMENT_BYTES = 4;
    const { status, key } = await staging.stage(Buffer.from('too big'), 'application/pdf');
    expect(status).toBe('TOO_LARGE');
    expect(key).toBeNull();
    GEMINI_CONFIG.MAX_DOCUMENT_BYTES = original;
  });

  test('refuses an empty buffer', async () => {
    const { status } = await staging.stage(Buffer.alloc(0), 'application/pdf');
    expect(status).toBe('NO_CONTENT');
  });

  test('load() rejects a malformed id without ever reaching R2', async () => {
    expect(await staging.load('../../etc/passwd')).toBeNull();
  });

  test('load() returns null for an id that was never staged', async () => {
    expect(await staging.load('a1b2c3d4-0000-4000-8000-abcdefabcdef')).toBeNull();
  });

  test('remove() deletes the staged object; a second load() then misses', async () => {
    const { key } = await staging.stage(Buffer.from('x'), 'application/pdf');
    await staging.remove(key);
    expect(await staging.load(key)).toBeNull();
  });

  test('remove() on an unknown id is a silent no-op', async () => {
    await expect(staging.remove('not-a-real-id')).resolves.toBeUndefined();
  });

  test('fails closed when R2 is not configured', async () => {
    let result;
    let loaded;
    let removed;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../src/services/r2Client', () => ({
        getBinding: () => null,
        getClient: () => undefined,
        bucket: () => undefined,
      }));
      const unconfiguredStaging = require('../src/services/extractionStagingService');
      result = await unconfiguredStaging.stage(Buffer.from('x'), 'application/pdf');
      loaded = await unconfiguredStaging.load('a1b2c3d4-0000-4000-8000-abcdefabcdef');
      removed = await unconfiguredStaging.remove('a1b2c3d4-0000-4000-8000-abcdefabcdef');
    });
    expect(result.status).toBe('WRITE_FAILED');
    expect(loaded).toBeNull();
    expect(removed).toBeUndefined();
  });

  test('reports WRITE_FAILED when the underlying put rejects', async () => {
    nextSendError = new Error('network blip');
    const result = await staging.stage(Buffer.from('x'), 'application/pdf');
    expect(result.status).toBe('WRITE_FAILED');
    expect(result.error).toBe('network blip');
  });

  test('load() swallows a read failure other than NoSuchKey and returns null', async () => {
    const { key } = await staging.stage(Buffer.from('x'), 'application/pdf');
    nextSendError = new Error('transient read error');
    expect(await staging.load(key)).toBeNull();
  });

  test('remove() swallows a delete failure', async () => {
    const { key } = await staging.stage(Buffer.from('x'), 'application/pdf');
    nextSendError = new Error('transient delete error');
    await expect(staging.remove(key)).resolves.toBeUndefined();
  });

  test('uses the native R2 binding over the S3 client when one is present (Workers)', async () => {
    const bindingStore = new Map();
    const fakeBinding = {
      put: jest.fn(async (key, buffer) => bindingStore.set(key, buffer)),
      get: jest.fn(async (key) => {
        const buffer = bindingStore.get(key);
        if (!buffer) return null;
        return { arrayBuffer: async () => buffer };
      }),
      delete: jest.fn(async (key) => bindingStore.delete(key)),
    };

    let result;
    let loaded;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../src/services/r2Client', () => ({
        getBinding: () => fakeBinding,
        getClient: () => undefined,
        bucket: () => undefined,
      }));
      const boundStaging = require('../src/services/extractionStagingService');
      result = await boundStaging.stage(Buffer.from('via binding'), 'application/pdf');
      loaded = await boundStaging.load(result.key);
      await boundStaging.remove(result.key);
    });

    expect(result.status).toBe('SAVED');
    expect(loaded.toString()).toBe('via binding');
    expect(fakeBinding.put).toHaveBeenCalledTimes(1);
    expect(fakeBinding.delete).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/rfqs/extract/stage', () => {
  afterEach(() => {
    fakeR2Store.clear();
  });

  test('requires authentication', async () => {
    const res = await request(app).post('/api/rfqs/extract/stage').send(Buffer.from('x'));
    expect(res.statusCode).toBe(401);
  });

  test('stores the raw body and returns a key', async () => {
    const res = await request(app)
      .post('/api/rfqs/extract/stage?mimeType=application%2Fpdf')
      .set(authHeader('buyer'))
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF-1.4 annexure'));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.key).toMatch(/^[a-f0-9-]{36}$/);
    expect(res.body.data.size).toBe(Buffer.byteLength('%PDF-1.4 annexure'));
  });

  test('rejects a body over the configured size limit with 413', async () => {
    const original = GEMINI_CONFIG.MAX_DOCUMENT_BYTES;
    GEMINI_CONFIG.MAX_DOCUMENT_BYTES = 10;
    // express.raw's own limit check fires before the controller ever runs, so
    // this proves oversized uploads are rejected without buffering the body
    // this app's memory-exhaustion bug was ultimately about.
    const res = await request(app)
      .post('/api/rfqs/extract/stage')
      .set(authHeader('buyer'))
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('this payload is longer than ten bytes'));
    expect(res.statusCode).toBe(413);
    GEMINI_CONFIG.MAX_DOCUMENT_BYTES = original;
  });
});

describe('POST /api/rfqs/extract with fileKey', () => {
  const originalKey = GEMINI_CONFIG.API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    GEMINI_CONFIG.API_KEY = originalKey;
    global.fetch = originalFetch;
    fakeR2Store.clear();
  });

  test('extracts from a staged document and cleans the staged object up afterward', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(
      geminiReply(
        JSON.stringify({
          documentTitle: 'Staged BOQ',
          items: [{ itemDescription: 'Centrifugal Water Pump', quantity: 5, unit: 'Units' }],
        })
      )
    );

    const { key } = await staging.stage(Buffer.from('%PDF-1.4 fake pdf body'), 'application/pdf');

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'boq.pdf', fileKey: key, mimeType: 'application/pdf' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.extractedEntities).toHaveLength(1);

    // The staged object is a one-shot — it should not survive a successful
    // extraction call.
    expect(await staging.load(key)).toBeNull();
  });

  test('reports NO_CONTENT when the referenced key does not exist (expired/wrong)', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'boq.pdf', fileKey: 'a1b2c3d4-0000-4000-8000-abcdefabcdef', mimeType: 'application/pdf' });

    expect(res.statusCode).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('cleans up the staged object even when extraction fails', async () => {
    GEMINI_CONFIG.API_KEY = '';
    const { key } = await staging.stage(Buffer.from('%PDF-1.4 fake pdf body'), 'application/pdf');

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'boq.pdf', fileKey: key, mimeType: 'application/pdf' });

    expect(res.statusCode).toBe(422);
    expect(await staging.load(key)).toBeNull();
  });
});
