/**
 * Centralized Backend Data Types & JSDoc Contracts
 * Single source of truth for domain entity shapes, payload structures, and resolver interfaces.
 */

/**
 * @typedef {Object} RFQItemEntity
 * @property {string} id
 * @property {string} rfqNumber
 * @property {string} title
 * @property {string} category
 * @property {string} intakeSource
 * @property {string} creationDate
 * @property {string} targetDeliveryDate
 * @property {number} budget optional ceiling; 0 means the buyer stated none
 * @property {string} [deliveryLocation] where the goods must be delivered
 * @property {string} [deliveryPincode] postal code for the delivery location
 * @property {number} quotesCount
 * @property {string} status
 * @property {boolean} chasingActive
 * @property {Array<Object>} quotes
 * @property {Array<Object>} lineItems
 * @property {number} [procucevVendorCount]
 */

/**
 * @typedef {Object} VendorEntity
 * @property {string} id
 * @property {string} name
 * @property {string} corporateEmail
 * @property {string} gstin
 * @property {string} majorCategory
 * @property {number} compositeRating
 * @property {string} status
 */

/**
 * @typedef {Object} EncryptedPayloadEntity
 * @property {string} ciphertext
 * @property {string} iv
 * @property {string} authTag
 * @property {string} [salt]
 * @property {string} algorithm
 * @property {string} version
 * @property {string} [encoded]
 */

/**
 * @typedef {Object} CryptoHealthStatusEntity
 * @property {string} status
 * @property {string} algorithm
 * @property {number} keyLengthBits
 * @property {boolean} roundtripVerified
 * @property {boolean} tamperDetectionVerified
 * @property {string} timestamp
 */

const DOMAIN_TYPES = {
  RFQ_STATUSES: ['Ingested', 'Dispatched', 'In Evaluation', 'Quotes Pending', 'PO Awarded'],
  SOURCING_MODES: ['mode_0', 'mode_1', 'mode_2', 'mode_3'],
  SEVERITY_LEVELS: ['INFO', 'WARN', 'ERROR', 'CRITICAL'],
  AUDIT_CATEGORIES: ['SECURITY', 'DATA_MUTATION', 'SYSTEM', 'AUTHENTICATION', 'PERFORMANCE', 'CRYPTOGRAPHY'],
  CIPHER_ALGORITHMS: ['aes-256-gcm', 'aes-256-cbc'],
};

module.exports = {
  DOMAIN_TYPES,
};

