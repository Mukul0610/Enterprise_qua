const express = require('express');
const router = express.Router();
const storeService = require('../services/storeService');
const { authenticate, requireRole } = require('../middleware/auth');
const { logger } = require('../services/loggerService');

/**
  * POST /api/enterprise-inquiries
  * Submit a buyer enterprise contract inquiry (Company Name, Email, Mobile).
  */
router.post('/', (req, res, next) => {
  try {
    const { companyName, email, mobile, notes, buyerAccountId } = req.body;

    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return res.status(400).json({ success: false, error: 'Company Name is required.' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Corporate Email ID is required.' });
    }
    if (!mobile || typeof mobile !== 'string' || !mobile.trim()) {
      return res.status(400).json({ success: false, error: 'Mobile Number is required.' });
    }

    const inquiry = storeService.addEnterpriseInquiry({
      companyName,
      email,
      mobile,
      notes,
      buyerAccountId,
    });

    logger.info(
      'New Enterprise Contract inquiry received',
      { id: inquiry.id, companyName: inquiry.companyName, email: inquiry.email },
      'ENTERPRISE_INQUIRIES'
    );

    return res.status(201).json({
      success: true,
      message: 'Enterprise contract inquiry submitted successfully.',
      data: inquiry,
    });
  } catch (err) {
    logger.error('Error submitting enterprise inquiry', err, 'ENTERPRISE_INQUIRIES');
    next(err);
  }
});

/**
  * GET /api/enterprise-inquiries
  * List all enterprise contract inquiries (for Category Manager and Admin oversight).
  */
router.get('/', (req, res, next) => {
  try {
    const inquiries = storeService.getEnterpriseInquiries();
    return res.json({
      success: true,
      data: inquiries,
      total: inquiries.length,
    });
  } catch (err) {
    logger.error('Error fetching enterprise inquiries', err, 'ENTERPRISE_INQUIRIES');
    next(err);
  }
});

/**
  * PATCH /api/enterprise-inquiries/:id
  * Update status or notes on an enterprise contract inquiry.
  */
router.patch('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes, contactedBy } = req.body;

    const updated = storeService.updateEnterpriseInquiry(id, {
      ...(status ? { status } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(contactedBy ? { contactedBy, contactedAt: new Date().toISOString() } : {}),
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Enterprise inquiry not found.' });
    }

    return res.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    logger.error(`Error updating enterprise inquiry ${req.params.id}`, err, 'ENTERPRISE_INQUIRIES');
    next(err);
  }
});

module.exports = router;
