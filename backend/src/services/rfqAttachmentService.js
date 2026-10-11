/**
 * RFQ Document Attachment Storage
 *
 * Supporting documents a buyer attaches to an RFQ, held in Cloudflare R2 and
 * served back verbatim. Nothing here touches Gemini: attachments exist for the
 * manual flow, where the buyer keys the line items and the document is
 * evidence rather than something to be read.
 *
 * Content deliberately does not live on the RFQ record. A 10MB PDF is roughly
 * 13MB of base64, and /api/bootstrap returns every RFQ, so inlining attachments
 * would grow that response without bound. The RFQ carries only the metadata this
 * module returns, and the bytes are fetched on demand by id.
 *
 * Security posture:
 *   - identifiers are generated here, never taken from the client
 *   - an id is matched against ID_PATTERN before it is used as an object key
 *   - the MIME type must appear in an allow-list, so an executable or script
 *     cannot be stored by omission
 *   - the decoded size is checked against MAX_BYTES before anything is written
 *   - when R2 isn't configured, uploads fail closed (never fall back to disk)
 */

const crypto = require('crypto');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const { RFQ_ATTACHMENT_CONFIG } = require('../config/constants');
const { logger } = require('./loggerService');
const r2Client = require('./r2Client');

/** Machine-readable outcomes the controller maps onto responses. */
const ATTACHMENT_STATUS = {
  SAVED: 'SAVED',
  NO_CONTENT: 'NO_CONTENT',
  TOO_LARGE: 'TOO_LARGE',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  WRITE_FAILED: 'WRITE_FAILED',
};

/**
 * R2 object key for one stored attachment, or null when the id is not one we
 * issued.
 *
 * Returning null rather than a key is what stops a malformed/foreign id from
 * ever reaching a request: an id that fails the pattern never reaches R2.
 */
function resolveObjectKey(id, config = RFQ_ATTACHMENT_CONFIG) {
  if (typeof id !== 'string' || !config.ID_PATTERN.test(id)) return null;
  return `${config.STORAGE_DIR}/${id}`;
}

/** True when the buyer may attach a document of this type. */
function isAllowedType(mimeType) {
  return RFQ_ATTACHMENT_CONFIG.ALLOWED_MIME_TYPES.includes(mimeType);
}

/**
 * Decoded byte length of a base64 payload, without allocating the buffer.
 *
 * Checked before decoding so an oversized upload is refused rather than briefly
 * materialised in memory.
 */
function decodedByteLength(base64) {
  const clean = String(base64 || '').replace(/\s/g, '');
  if (clean === '') return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/**
 * Strip any directory component a browser may have supplied.
 *
 * The stored key never uses this — the generated id does — but the name is
 * echoed back to the UI and into the RFQ, so it is reduced to a leaf first.
 */
function safeFileName(fileName) {
  const trimmed = String(fileName || '').trim();
  const leaf = trimmed.split(/[/\\]/).pop();
  return !leaf || leaf === '.' || leaf === '..' ? 'attachment' : leaf;
}

/**
 * Persist one attachment.
 *
 * Never throws: every failure is reported as a status the caller can turn into a
 * response, so a rejected upload does not take down the request.
 *
 * @param {Object} input
 * @param {string} input.fileName
 * @param {string} input.mimeType
 * @param {string} input.content base64-encoded file body
 * @returns {Promise<{status: string, attachment: Object|null, error: string|null}>}
 */
async function saveAttachment({ fileName, mimeType, content } = {}, config = RFQ_ATTACHMENT_CONFIG, access = null) {
  const failure = (status, error = null) => ({ status, attachment: null, error });

  if (!content) return failure(ATTACHMENT_STATUS.NO_CONTENT);
  if (!config.ALLOWED_MIME_TYPES.includes(mimeType)) return failure(ATTACHMENT_STATUS.UNSUPPORTED_TYPE);

  const size = decodedByteLength(content);
  if (size === 0) return failure(ATTACHMENT_STATUS.NO_CONTENT);
  if (size > config.MAX_BYTES) return failure(ATTACHMENT_STATUS.TOO_LARGE);

  const binding = r2Client.getBinding();
  const client = binding ? null : r2Client.getClient();
  if (!binding && !client) {
    logger.error('Failed to store RFQ attachment: R2 is not configured', null, 'RFQ_ATTACHMENT');
    return failure(ATTACHMENT_STATUS.WRITE_FAILED, 'Object storage is not configured.');
  }

  const id = crypto.randomUUID();
  const meta = {
    id,
    fileName: safeFileName(fileName),
    mimeType,
    size,
    uploadedAt: new Date().toISOString(),
  };

  // S3/R2 metadata values travel as HTTP headers, so a non-ASCII original
  // filename (realistic here) is encoded going in and decoded on read. Keys
  // are written lowercase because S3/R2 normalises header names to lowercase
  // on the way back (loadAttachment reads them lowercase too).
  const customMetadata = {
    filename: encodeURIComponent(meta.fileName),
    size: String(size),
    uploadedat: meta.uploadedAt,
    ...(access ? { rfqid: encodeURIComponent(access.rfqId), vendorid: encodeURIComponent(access.vendorId) } : {}),
  };

  try {
    if (binding) {
      // Native R2 binding — see r2Client.js's getBinding() for why this is
      // preferred over the S3Client path below on Workers.
      await binding.put(resolveObjectKey(id, config), Buffer.from(content, 'base64'), {
        httpMetadata: { contentType: mimeType },
        customMetadata,
      });
    } else {
      await client.send(
        new PutObjectCommand({
          Bucket: r2Client.bucket(),
          Key: resolveObjectKey(id, config),
          Body: Buffer.from(content, 'base64'),
          ContentType: mimeType,
          Metadata: customMetadata,
        })
      );
    }
  } catch (err) {
    logger.error('Failed to store RFQ attachment', err, 'RFQ_ATTACHMENT');
    return failure(ATTACHMENT_STATUS.WRITE_FAILED, err.message);
  }

  logger.info(
    `Stored RFQ attachment ${meta.fileName} (${size} bytes)`,
    { id, mimeType, size },
    'RFQ_ATTACHMENT'
  );
  return { status: ATTACHMENT_STATUS.SAVED, attachment: meta, error: null };
}

/** Buffers a Node Readable (the SDK v3 response body shape) into a Buffer. */
async function bufferBody(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Read one attachment back.
 *
 * @returns {Promise<{meta: Object, content: Buffer}|null>} null when the id is
 *   unknown, malformed, R2 isn't configured, or the object is missing.
 */
async function loadAttachment(id, config = RFQ_ATTACHMENT_CONFIG) {
  const key = resolveObjectKey(id, config);
  if (!key) return null;

  const binding = r2Client.getBinding();
  const client = binding ? null : r2Client.getClient();
  if (!binding && !client) return null;

  try {
    if (binding) {
      const object = await binding.get(key);
      if (!object) return null;
      const content = Buffer.from(await object.arrayBuffer());
      // R2's own customMetadata is already a plain lowercase-keyed object —
      // no case-normalisation dance needed the way S3's header-based
      // metadata requires below.
      const metadata = object.customMetadata || {};
      const result = {
        meta: {
          id,
          fileName: metadata.filename ? decodeURIComponent(metadata.filename) : 'attachment',
          mimeType: object.httpMetadata && object.httpMetadata.contentType,
          size: Number(metadata.size) || content.length,
          uploadedAt: metadata.uploadedat || null,
        },
        content,
      };
      if (metadata.rfqid && metadata.vendorid) {
        result.access = {
          rfqId: decodeURIComponent(metadata.rfqid),
          vendorId: decodeURIComponent(metadata.vendorid),
        };
      }
      return result;
    }

    const response = await client.send(new GetObjectCommand({ Bucket: r2Client.bucket(), Key: key }));
    const content = await bufferBody(response.Body);
    // S3/R2 returns custom metadata keys lowercased regardless of how they
    // were set (HTTP header names are case-insensitive) — read them lowercase.
    const metadata = response.Metadata || {};
    const result = {
      meta: {
        id,
        fileName: metadata.filename ? decodeURIComponent(metadata.filename) : 'attachment',
        mimeType: response.ContentType,
        size: Number(metadata.size) || content.length,
        uploadedAt: metadata.uploadedat || null,
      },
      content,
    };
    if (metadata.rfqid && metadata.vendorid) {
      result.access = {
        rfqId: decodeURIComponent(metadata.rfqid),
        vendorId: decodeURIComponent(metadata.vendorid),
      };
    }
    return result;
  } catch (err) {
    logger.error(`Failed to read RFQ attachment ${id}`, err, 'RFQ_ATTACHMENT');
    return null;
  }
}

module.exports = {
  ATTACHMENT_STATUS,
  resolveObjectKey,
  isAllowedType,
  decodedByteLength,
  safeFileName,
  saveAttachment,
  loadAttachment,
};
