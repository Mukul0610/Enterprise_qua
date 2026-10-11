const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

// Resolves the caller's own vendor record id (for ownership checks below).
// Returns null for a non-vendor role or a vendor with no profile record yet.
function resolveOwnVendorId(req) {
  if (!req.user || req.user.role !== 'vendor') return null;
  // 'all': resolving the caller's own vendor identity by session email, not
  // filtering a buyer-scoped list — omitting this silently returns nothing
  // for any buyer-uploaded vendor (one with a buyerId set).
  const vendor = storeService.getVendorById(req.user.email, 'all');
  return vendor ? vendor.id : null;
}

function getProducts(req, res, next) {
  try {
    const { vendorId } = req.query;
    logger.info('Fetching vendor items catalogue', { query: req.query }, 'CATALOGUE_CONTROLLER');
    const products = storeService.getVendorCatalogue(vendorId);
    res.json({ success: true, data: products });
  } catch (err) {
    logger.error('Error fetching catalogue items', err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

function addProduct(req, res, next) {
  try {
    const { name, sku, unitPrice, category, leadTimeDays, moq, specs } = req.body;
    if (!name || !sku || !unitPrice) {
      logger.warn('Failed to add product: Missing name, sku, or unitPrice', { body: req.body }, 'CATALOGUE_CONTROLLER');
      return res.status(400).json({ success: false, error: 'name, sku, and unitPrice are required.' });
    }
    if (req.user.role !== 'vendor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only a vendor can add to their own catalogue.' });
    }
    const vendorId = req.user.role === 'admin' ? req.body.vendorId : resolveOwnVendorId(req);
    if (!vendorId) {
      return res.status(400).json({ success: false, error: 'Create your vendor profile before adding catalogue items.' });
    }
    const vendorProducts = storeService.getVendorCatalogue(vendorId);
    if (vendorProducts.length >= 100) {
      return res.status(409).json({ success: false, error: 'Catalogue capacity is limited to 100 products per vendor.' });
    }
    if (vendorProducts.some((product) => String(product.sku || '').trim().toLowerCase() === String(sku).trim().toLowerCase())) {
      return res.status(409).json({ success: false, error: `SKU "${sku}" already exists in this catalogue.` });
    }
    if (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) <= 0 ||
        (leadTimeDays !== undefined && (!Number.isInteger(Number(leadTimeDays)) || Number(leadTimeDays) <= 0)) ||
        (moq !== undefined && (!Number.isInteger(Number(moq)) || Number(moq) <= 0))) {
      return res.status(400).json({ success: false, error: 'unitPrice must be positive; provided leadTimeDays and moq values must be positive whole numbers.' });
    }
    logger.info(`Adding item to catalogue: ${name} (${sku})`, { name, sku, unitPrice, category, vendorId }, 'CATALOGUE_CONTROLLER');
    const created = storeService.addProductToCatalogue({ name, sku, unitPrice, category, leadTimeDays, moq, specs }, vendorId, req.user.email);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error adding product to catalogue', err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    const existing = storeService.getCatalogueProductById(id);
    if (!existing) {
      logger.warn(`Product not found for update: ${id}`, { id }, 'CATALOGUE_CONTROLLER');
      return res.status(404).json({ success: false, error: `Product with ID ${id} not found.` });
    }
    if (req.user.role !== 'admin') {
      const ownVendorId = resolveOwnVendorId(req);
      if (!ownVendorId || existing.vendorId !== ownVendorId) {
        return res.status(403).json({ success: false, error: 'You do not have permission to modify this catalogue item.' });
      }
    }
    logger.info(`Updating catalogue product ${id}`, { id, updates: req.body }, 'CATALOGUE_CONTROLLER');
    const updated = storeService.updateCatalogueProduct(id, req.body, req.user.email);
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating product ${req.params.id}`, err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;
    const existing = storeService.getCatalogueProductById(id);
    if (!existing) {
      logger.warn(`Product not found for deletion: ${id}`, { id }, 'CATALOGUE_CONTROLLER');
      return res.status(404).json({ success: false, error: `Product with ID ${id} not found.` });
    }
    if (req.user.role !== 'admin') {
      const ownVendorId = resolveOwnVendorId(req);
      if (!ownVendorId || existing.vendorId !== ownVendorId) {
        return res.status(403).json({ success: false, error: 'You do not have permission to delete this catalogue item.' });
      }
    }
    logger.info(`Deleting catalogue product ${id}`, { id }, 'CATALOGUE_CONTROLLER');
    storeService.deleteCatalogueProduct(id, req.user.email);
    res.json({ success: true, message: 'Product deleted.' });
  } catch (err) {
    logger.error(`Error deleting product ${req.params.id}`, err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
};
