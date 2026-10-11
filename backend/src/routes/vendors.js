const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');

router.get('/', optionalAuthenticate, vendorController.getVendors);
router.post('/', authenticate, vendorController.createVendor);
router.post('/bulk-import', authenticate, vendorController.bulkImportVendors);
router.get('/rfq-credits', authenticate, vendorController.getVendorRfqCredits);
router.get('/bulk-import/:sessionId', authenticate, vendorController.getBulkImportSessionStatus);
router.get('/:id/rfq-credits', authenticate, vendorController.getVendorRfqCredits);
router.get('/:id', optionalAuthenticate, vendorController.getVendorById);
router.put('/:id', authenticate, vendorController.updateVendor);
router.delete('/:id', authenticate, vendorController.deleteVendor);
router.post('/:id/rating-revision', authenticate, vendorController.reviseRating);
router.put('/:id/categories', authenticate, vendorController.updateCategories);
router.put('/:id/subscription', authenticate, vendorController.updateSubscription);
router.post('/:id/payment-link', authenticate, vendorController.createSubscriptionPaymentLink);
router.get('/:id/payment-links', authenticate, vendorController.getPaymentLinks);
router.get('/:id/payment-links/:linkId/invoice', authenticate, vendorController.downloadInvoice);
router.get('/:id/onboarding-email', authenticate, vendorController.generateOnboardingEmailPreview);

module.exports = router;
