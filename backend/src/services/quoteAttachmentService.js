const { RFQ_ATTACHMENT_CONFIG } = require('../config/constants');
const rfqAttachmentService = require('./rfqAttachmentService');

const QUOTE_ATTACHMENT_CONFIG = {
  ...RFQ_ATTACHMENT_CONFIG,
  STORAGE_DIR: `${RFQ_ATTACHMENT_CONFIG.STORAGE_DIR}-quotes`,
};

function saveQuoteAttachment(input, { rfqId, vendorId }) {
  if (!rfqId || !vendorId) {
    throw new Error('RFQ and vendor identities are required to store bid documents.');
  }
  return rfqAttachmentService.saveAttachment(input, QUOTE_ATTACHMENT_CONFIG, { rfqId, vendorId });
}

function loadQuoteAttachment(attachmentId) {
  return rfqAttachmentService.loadAttachment(attachmentId, QUOTE_ATTACHMENT_CONFIG);
}

module.exports = {
  saveQuoteAttachment,
  loadQuoteAttachment,
};
