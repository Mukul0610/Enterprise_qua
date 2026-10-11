const express = require('express');
const router = express.Router();
const rfqController = require('../controllers/rfqController');
const { authenticate, requireRole } = require('../middleware/auth');

// Every RFQ read is authenticated and scoped to the caller's buyer organisation.
// These three used to be anonymous and returned the entire global RFQ list,
// which is how one buyer's RFQs reached another buyer's dashboard.
router.get('/', authenticate, rfqController.getRFQs);
// Registered before '/:id' so 'summary' is not swallowed as an RFQ identifier.
router.get('/summary', authenticate, rfqController.getRFQSummary);
// Category-manager "All RFQs" console: the full cross-buyer list. Gated to the
// oversight roles — a buyer or vendor hitting this gets 403, not a scoped list.
router.get('/all', authenticate, requireRole('category_manager', 'admin'), rfqController.getAllRFQs);
router.post('/', authenticate, rfqController.createRFQ);
router.post('/ingest', authenticate, rfqController.ingestRFQ);
// Also handles an uploaded .eml/.msg (an emailed requisition, saved and
// uploaded by the buyer): extractRFQFromDocument detects the file type and
// routes it through emailIngestionService's real MIME parsing before the same
// Gemini extraction and classification every other document goes through.
router.post('/extract', authenticate, rfqController.extractRFQFromDocument);
// Autonomous mailbox gateway. Registered before '/:id' so neither path segment is
// read as an RFQ identifier. Status is diagnostic; the manual check exists so a
// buyer can pull the mailbox now instead of waiting for the next interval.
router.get('/email-gateway/status', authenticate, rfqController.getEmailGatewayStatus);
router.post('/email-gateway/poll', authenticate, rfqController.pollEmailGateway);
// Buyer-triggered request to email a vendor to update their category
router.post('/request-vendor-category-update', authenticate, rfqController.requestVendorCategoryUpdate);
// Registered before '/:id' so 'attachments' is not read as an RFQ identifier.
// Both require a session: an attachment is commercial-in-confidence, so the
// download must never be anonymous.
router.post('/attachments', authenticate, rfqController.uploadRFQAttachment);
router.get('/attachments/:attachmentId', authenticate, rfqController.downloadRFQAttachment);
router.post('/:id/quote-attachments', authenticate, rfqController.uploadQuoteAttachment);
router.get('/:id/quote-attachments/:attachmentId', authenticate, rfqController.downloadQuoteAttachment);
router.get('/:id', authenticate, rfqController.getRFQById);
router.put('/:id', authenticate, rfqController.updateRFQ);
router.delete('/:id', authenticate, rfqController.deleteRFQ);
router.post('/:id/quotes', authenticate, rfqController.addQuote);
router.post('/:id/inquiries', authenticate, rfqController.addInquiry);
router.post('/:id/inquiries/:inquiryId/reply', authenticate, rfqController.replyInquiry);
router.post('/:id/batch-chaser', authenticate, rfqController.triggerBatchChaser);
router.post('/:id/approve-po', authenticate, rfqController.approvePO);
// Download / unlock an RFQ with free credit deduction check
router.post('/:id/download', authenticate, rfqController.downloadRFQ);
// The preview embeds the RFQ's commercial detail, so it cannot be anonymous.
router.get('/:id/email-preview', authenticate, rfqController.generateEmailPreview);
// Category-manager vendor-invite flow: the category-matched candidate pool, and
// inviting specific vendors from it. Gated the same way '/all' is — only an
// invite grants a vendor visibility (see storeService.vendorCoversRFQ).
router.get(
  '/:id/vendor-candidates',
  authenticate,
  requireRole('category_manager', 'admin'),
  rfqController.getVendorCandidates
);
router.post(
  '/:id/invite-vendors',
  authenticate,
  requireRole('category_manager', 'admin'),
  rfqController.inviteVendors
);
router.post('/:id/validate-vendor-categories', authenticate, rfqController.validateVendorCategories);

module.exports = router;
