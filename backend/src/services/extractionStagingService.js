/**
 * Transient R2 staging for documents awaiting Gemini extraction.
 *
 * POST /api/rfqs/extract used to carry the whole document inline as base64 in
 * the JSON body. On a 14MB upload that is ~19MB of base64 sitting in the
 * request body, then again in the parsed body object, then again in whatever
 * copy the caller passes around before handing it to Gemini — several
 * overlapping multi-megabyte strings alive at once, comfortably enough to
 * exceed a Cloudflare Worker's ~128MB memory ceiling (exceededMemory, 503).
 *
 * The buyer's browser now uploads the raw file bytes here first (no base64,
 * no JSON envelope) and gets back a `key`; POST /api/rfqs/extract then
 * downloads that one buffer, base64-encodes it exactly once right before the
 * Gemini call, and the staged object is deleted once extraction finishes.
 * Same R2 bucket and the same binding/S3Client fallback rfqAttachmentService
 * and largeFileIngestionService already use.
 */

const crypto = require('crypto');
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { GEMINI_CONFIG } = require('../config/constants');
const { logger } = require('./loggerService');
const r2Client = require('./r2Client');

const STORAGE_DIR = 'extract-staging';
const LOG_CATEGORY = 'EXTRACTION_STAGING';

function resolveObjectKey(id) {
  // Generated here, never taken from the client — same posture as
  // rfqAttachmentService.resolveObjectKey.
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return null;
  return `${STORAGE_DIR}/${id}`;
}

/** Same buffering pattern rfqAttachmentService.js / largeFileIngestionService.js already use against this SDK. */
async function bufferBody(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Store one raw upload ahead of extraction.
 *
 * @returns {Promise<{status: string, key: string|null, size: number, error: string|null}>}
 */
async function stage(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { status: 'NO_CONTENT', key: null, size: 0, error: null };
  }
  if (buffer.length > GEMINI_CONFIG.MAX_DOCUMENT_BYTES) {
    return { status: 'TOO_LARGE', key: null, size: buffer.length, error: null };
  }

  const binding = r2Client.getBinding();
  const client = binding ? null : r2Client.getClient();
  if (!binding && !client) {
    logger.error('Failed to stage extraction document: R2 is not configured', null, LOG_CATEGORY);
    return { status: 'WRITE_FAILED', key: null, size: buffer.length, error: 'Object storage is not configured.' };
  }

  const id = crypto.randomUUID();
  const key = `${STORAGE_DIR}/${id}`;

  try {
    if (binding) {
      await binding.put(key, buffer, { httpMetadata: { contentType: mimeType || 'application/octet-stream' } });
    } else {
      await client.send(
        new PutObjectCommand({
          Bucket: r2Client.bucket(),
          Key: key,
          Body: buffer,
          ContentType: mimeType || 'application/octet-stream',
        })
      );
    }
  } catch (err) {
    // Never log buffer/base64 content — only size and the failure reason.
    logger.error('Failed to stage extraction document', err, LOG_CATEGORY);
    return { status: 'WRITE_FAILED', key: null, size: buffer.length, error: err.message };
  }

  logger.info(`Staged extraction document (${buffer.length} bytes)`, { size: buffer.length }, LOG_CATEGORY);
  return { status: 'SAVED', key: id, size: buffer.length, error: null };
}

/** Read a staged document back as a single Buffer, or null if it's gone/invalid. */
async function load(id) {
  const key = resolveObjectKey(id);
  if (!key) return null;

  const binding = r2Client.getBinding();
  const client = binding ? null : r2Client.getClient();
  if (!binding && !client) return null;

  try {
    if (binding) {
      const object = await binding.get(key);
      if (!object) return null;
      return Buffer.from(await object.arrayBuffer());
    }
    const response = await client.send(new GetObjectCommand({ Bucket: r2Client.bucket(), Key: key }));
    return await bufferBody(response.Body);
  } catch (err) {
    logger.warn('Failed to read staged extraction document', { error: err.message }, LOG_CATEGORY);
    return null;
  }
}

/** Best-effort cleanup — a staged object outliving one failed delete is not a correctness problem. */
async function remove(id) {
  const key = resolveObjectKey(id);
  if (!key) return;

  const binding = r2Client.getBinding();
  const client = binding ? null : r2Client.getClient();
  if (!binding && !client) return;

  try {
    if (binding) {
      await binding.delete(key);
    } else {
      await client.send(new DeleteObjectCommand({ Bucket: r2Client.bucket(), Key: key }));
    }
  } catch (err) {
    logger.warn('Failed to clean up staged extraction document', { error: err.message }, LOG_CATEGORY);
  }
}

module.exports = { stage, load, remove, resolveObjectKey };
