const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

async function getBootstrap(req, res, next) {
  try {
    logger.info('Fetching application bootstrap data payload', {}, 'BOOTSTRAP_CONTROLLER');
    const user = req.user;
    let buyerId = null;
    if (user && user.role === 'buyer') {
      const buyerAccount = await storeService.ensureBuyerAccountForUser(user);
      buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    } else if (req.query && req.query.buyerId) {
      buyerId = req.query.buyerId;
    }
    if (req.query && req.query.refresh === 'true') {
      await storeService.hydrateFromDB();
    }
    const data = await storeService.getBootstrapData(buyerId, user && user.email);
    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory',
      data,
    });
  } catch (err) {
    logger.error('Error fetching bootstrap data', err, 'BOOTSTRAP_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getBootstrap,
};
