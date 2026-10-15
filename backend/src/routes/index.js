const express = require('express');
const router = express.Router();

const rfqRoutes = require('./rfqs');
const vendorRoutes = require('./vendors');
const buyerAccountRoutes = require('./buyerAccounts');
const buyerProfileRoutes = require('./buyerProfile');
const evaluationRoutes = require('./evaluations');
const auditRoutes = require('./audit');
const aiFeedRoutes = require('./aiFeed');
const notificationRoutes = require('./notifications');
const systemConfigRoutes = require('./systemConfig');
const dbRoutes = require('./db');
const bootstrapRoutes = require('./bootstrap');
const supportChatRoutes = require('./supportChat');
const catalogueRoutes = require('./catalogue');
const logsRoutes = require('./logs');
const graphqlRoutes = require('./graphql');
const cryptoRoutes = require('./crypto');
const authRoutes = require('./auth');
const zohoRoutes = require('./zoho');
const vendorIngestionRoutes = require('./vendorIngestion');
const pincodeRoutes = require('./pincode');
const enterpriseInquiriesRoutes = require('./enterpriseInquiries');

// Mount sub-routers
router.use('/auth', authRoutes);
router.use('/bootstrap', bootstrapRoutes);
router.use('/rfqs', rfqRoutes);
router.use('/vendors', vendorRoutes);
router.use('/vendor-ingestion', vendorIngestionRoutes);
router.use('/buyer-accounts', buyerAccountRoutes);
router.use('/buyer-profile', buyerProfileRoutes);
router.use('/evaluations', evaluationRoutes);
router.use('/audit', auditRoutes);
router.use('/ai-feed', aiFeedRoutes);
router.use('/notifications', notificationRoutes);
router.use('/system-config', systemConfigRoutes);
router.use('/db', dbRoutes);
router.use('/support-chat', supportChatRoutes);
router.use('/catalogue', catalogueRoutes);
router.use('/logs', logsRoutes);
router.use('/graphql', graphqlRoutes);
router.use('/crypto', cryptoRoutes);
router.use('/zoho', zohoRoutes);
router.use('/pincode', pincodeRoutes);
router.use('/enterprise-inquiries', enterpriseInquiriesRoutes);

module.exports = router;

