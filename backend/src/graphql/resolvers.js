const storeService = require('../services/storeService');
const domainQueries = require('../db/domainQueries');
const { queryCache } = require('../db/queryCache');
const pool = require('../db/pool');
const { getOptimizationMetrics } = require('../db/optimizationMetrics');
const { logger } = require('../services/loggerService');
const { logErrorResolver } = require('../services/logErrorResolver');
const { performanceOptimizer } = require('../services/performanceOptimizer');
const cryptoService = require('../services/cryptoService');
const authService = require('../services/authService');
const { extractToken } = require('../middleware/auth');
const rfqSummaryService = require('../services/rfqSummaryService');
const { AUTH_MESSAGES } = require('../config/constants');

/**
 * Mutations go through the same rootValue-as-plain-functions path as queries,
 * bypassing the REST route middleware entirely — so auth has to be enforced
 * here instead. graphql-js calls these as fn(args, context, info); context
 * carries { req, res } from graphqlController.
 */
// Async because revocation is read from PostgreSQL now. Every caller awaits it,
// so a logged-out token is rejected here too — while that check lived in a
// per-process Set, GraphQL was a second route a revoked token could still pass
// after a restart or on a different worker.
async function requireAuth(context) {
  const token = extractToken(context && context.req);
  if (!token) {
    throw new Error(AUTH_MESSAGES.NO_SESSION_TOKEN);
  }
  const verification = await authService.assertSessionActive(token);
  if (!verification.valid) {
    throw new Error(verification.error || AUTH_MESSAGES.INVALID_SESSION_FALLBACK);
  }
  return verification.user;
}

async function requireAdmin(context) {
  const user = await requireAuth(context);
  if (user.role !== 'admin') {
    throw new Error('You do not have permission to perform this action.');
  }
  return user;
}

/**
 * Which RFQs a caller may see, mirroring rfqController's resolveRfqReadScope.
 *
 * The `rfqs`/`rfq` resolvers used to read `storeService.getRFQs()` — the
 * whole global array, with no session required at all. That made GraphQL a
 * second, wider route to the same leak the REST endpoints had (7c8990c),
 * and it would have quietly bypassed the scoping added there. Buyers are
 * scoped to their own buyerAccountId; category managers, admins and
 * vendors see the full list (see rfqController.js for why).
 */
async function requireRfqReadScope(context) {
  const user = await requireAuth(context);
  if (user.role === 'buyer') {
    const account = await storeService.getBuyerAccountByEmail(user.email);
    return { user, role: user.role, restricted: true, buyerAccountId: account ? account.id : null };
  }
  if (user.role === 'vendor') {
    // 'all': resolving the caller's own vendor identity by session email, not
    // a buyer-scoped list — the same fix as rfqController.resolveRfqReadScope
    // (REST); this GraphQL equivalent had the identical gap.
    const vendor = storeService.getVendorById(user.email, 'all');
    return { user, role: user.role, restricted: true, vendor: vendor || null };
  }
  return { user, role: user.role, restricted: false, buyerAccountId: null };
}

/** Whether one RFQ is in a resolved read scope. */
function rfqInScope(scope, rfq) {
  if (!scope.restricted) return true;
  if (scope.role === 'vendor') return storeService.vendorCoversRFQ(scope.vendor, rfq);
  return rfq.buyerAccountId === scope.buyerAccountId;
}

/**
 * GraphQL Root Resolvers
 */
const rootResolvers = {

  rfqs: async (args = {}, context) => {
    const scope = await requireRfqReadScope(context);
    const { category, sourcingMode, status, limit = 50, offset = 0 } = args;
    let result = storeService.getRFQs().filter((rfq) => rfqInScope(scope, rfq));
    if (category) {
      result = result.filter((r) => r.category && r.category.toLowerCase().includes(category.toLowerCase()));
    }
    if (sourcingMode) {
      result = result.filter((r) => r.sourcingMode === sourcingMode);
    }
    if (status) {
      result = result.filter((r) => r.status && r.status.toLowerCase() === status.toLowerCase());
    }
    return result.slice(offset, offset + limit);
  },

  rfq: async (args = {}, context) => {
    const scope = await requireRfqReadScope(context);
    const key = args.id || args.rfqNumber;
    if (!key) return null;
    const rfq = storeService.getRFQById(key);
    if (!rfq) return null;
    if (!rfqInScope(scope, rfq)) return null;
    return rfq;
  },

  vendors: async (args = {}, context = {}) => {
    const { majorCategory, source, search, limit = 50, offset = 0 } = args;
    const user = context && context.req ? context.req.user : null;
    let buyerId = null;
    if (user && user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
      buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    } else if (args.buyerId) {
      buyerId = args.buyerId;
    }
    let result;
    if (pool.hasStorage()) {
      // storeService.getVendors() re-syncs from the DB with a full unbounded
      // table read on every call (its own doc comment flags this) — wrong
      // here since this resolver already takes limit/offset/search/
      // majorCategory and only needs one page. getVendorsPageFromDB does the
      // same filtering in SQL, so a request only ever touches the rows it
      // returns.
      const page = await domainQueries.getVendorsPageFromDB({
        limit,
        offset,
        search: search || '',
        category: majorCategory || '',
        publicOnly: !buyerId,
        scopedBuyerId: buyerId || '',
      });
      result = page.rows;
    } else {
      // No DB configured: nothing to bound against, fall back to the
      // in-memory collection and filter/paginate in JS as before.
      result = await storeService.getVendors(buyerId);
      if (majorCategory) {
        result = result.filter((v) => v.majorCategory && v.majorCategory.toLowerCase().includes(majorCategory.toLowerCase()));
      }
      if (search) {
        const q = search.toLowerCase();
        result = result.filter((v) => (v.name && v.name.toLowerCase().includes(q)) || (v.email && v.email.toLowerCase().includes(q)));
      }
      result = result.slice(offset, offset + limit);
    }
    return source ? result.filter((v) => v.source === source) : result;
  },

  vendor: async (args = {}, context = {}) => {
    const user = context && context.req ? context.req.user : null;
    let buyerId = null;
    if (user && user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
      buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    } else if (args.buyerId) {
      buyerId = args.buyerId;
    }
    if (args.id) {
      return storeService.getVendorById(args.id, buyerId) || null;
    }
    if (args.email) {
      if (!pool.hasStorage()) {
        const vendors = await storeService.getVendors(buyerId);
        return vendors.find((v) => v.email && v.email.toLowerCase() === args.email.toLowerCase()) || null;
      }
      // Bounded single-row lookup instead of a full-table getVendors() fetch
      // just to find one row by email.
      const vendor = await domainQueries.getVendorByEmailFromDB(args.email);
      if (!vendor) return null;
      if (buyerId === 'all') return vendor;
      if (!vendor.buyerId && !vendor.buyerAccountId) return vendor;
      if (!buyerId) return null;
      const sId = String(buyerId).toLowerCase();
      const matches =
        (vendor.buyerId && String(vendor.buyerId).toLowerCase() === sId) ||
        (vendor.buyerAccountId && String(vendor.buyerAccountId).toLowerCase() === sId) ||
        (vendor.buyerEmail && String(vendor.buyerEmail).toLowerCase() === sId);
      return matches ? vendor : null;
    }
    return null;
  },

  buyerAccounts: (args = {}) => {
    const limit = args.limit || 20;
    return storeService.getBuyerAccounts().slice(0, limit);
  },

  activeBuyerAccount: () => {
    return storeService.getActiveBuyerAccount();
  },

  evaluations: (args = {}) => {
    let evals = storeService.getEvaluations();
    if (args.vendorName) {
      evals = evals.filter((e) => e.vendorName && e.vendorName.toLowerCase().includes(args.vendorName.toLowerCase()));
    }
    return evals;
  },

  auditLogs: (args = {}) => {
    const { limit = 50, search } = args;
    let logs = storeService.getAuditLogs();
    if (search) {
      const q = search.toLowerCase();
      logs = logs.filter((l) => (l.action && l.action.toLowerCase().includes(q)) || (l.userEmail && l.userEmail.toLowerCase().includes(q)));
    }
    return logs.slice(0, limit);
  },

  catalogue: (args = {}) => {
    const { category, search } = args;
    let items = storeService.getVendorCatalogue();
    if (category) {
      items = items.filter((i) => i.category && i.category.toLowerCase().includes(category.toLowerCase()));
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((i) => (i.name && i.name.toLowerCase().includes(q)) || (i.sku && i.sku.toLowerCase().includes(q)));
    }
    return items;
  },

  aiFeed: async (args = {}, context) => {
    const limit = args.limit || 20;
    const all = storeService.getAIFeed();
    if (context && context.req && context.req.user && context.req.user.role === 'buyer') {
      const account = await storeService.getBuyerAccountByEmail(context.req.user.email);
      const buyerAccountId = account ? account.id : null;
      if (!buyerAccountId) return [];
      const buyerRfqs = storeService.getRFQs().filter((r) => r.buyerAccountId === buyerAccountId);
      const buyerRfqNumbers = new Set(buyerRfqs.map((r) => r.rfqNumber).filter(Boolean));
      return all
        .filter((item) => item.buyerAccountId === buyerAccountId || (item.rfqNumber && buyerRfqNumbers.has(item.rfqNumber)))
        .slice(0, limit);
    }
    return all.slice(0, limit);
  },

  systemConfig: () => {
    return storeService.getSystemConfig();
  },

  dbHealth: async () => {
    return await pool.checkDatabaseHealth();
  },

  optimizationMetrics: () => {
    return getOptimizationMetrics();
  },

  diagnoseLogErrors: () => {
    return logErrorResolver.diagnoseErrors();
  },

  auditPerformance: () => {
    return performanceOptimizer.auditPerformance();
  },

  cryptoStatus: () => {
    return cryptoService.verifyCryptoHealth();
  },

  decryptData: ({ input }) => {
    if (input.token) {
      const plaintext = cryptoService.decrypt(input.token, {
        secretKey: input.secretKey,
        additionalData: input.additionalData,
      });
      return { plaintext };
    }
    const plaintext = cryptoService.decrypt(input, {
      secretKey: input.secretKey,
      additionalData: input.additionalData,
      encoding: input.encoding,
    });
    return { plaintext };
  },

  createRFQ: async ({ input }, context) => {
    const user = await requireAuth(context);
    logger.info('GraphQL Mutation: createRFQ', { title: input.title }, 'GRAPHQL_MUTATION');
    const lineItems = Array.isArray(input.extractedEntities) ? input.extractedEntities : input.lineItems || [];
    // A model or network failure here must not block RFQ creation —
    // buildRFQSummary already falls back to a deterministic summary rather
    // than throwing (mirrors rfqController.createRFQ).
    const aiSummary = await rfqSummaryService.buildRFQSummary(
      { ...input, extractedEntities: lineItems },
      { orgName: user.orgName || '' }
    );
    const requestingBuyerAccount = await storeService.getBuyerAccountByEmail(user.email);
    return storeService.createRFQ({ ...input, extractedEntities: lineItems, aiSummary }, requestingBuyerAccount);
  },

  updateRFQ: async ({ id, input }, context) => {
    const scope = await requireRfqReadScope(context);
    const existing = storeService.getRFQById(id);
    if (!existing || !rfqInScope(scope, existing)) {
      return null;
    }
    logger.info(`GraphQL Mutation: updateRFQ ${id}`, { id, input }, 'GRAPHQL_MUTATION');
    return storeService.updateRFQ(id, input);
  },

  createVendor: async ({ input }, context) => {
    const user = await requireAuth(context);
    logger.info('GraphQL Mutation: createVendor', { name: input.name }, 'GRAPHQL_MUTATION');
    const created = storeService.addVendor(input, user.email);
    await storeService.confirmVendorPersisted(created);
    return created;
  },

  updateVendor: async ({ id, input }, context) => {
    await requireAuth(context);
    logger.info(`GraphQL Mutation: updateVendor ${id}`, { id, input }, 'GRAPHQL_MUTATION');
    return storeService.updateVendor(id, input);
  },

  deleteVendor: async ({ id }, context) => {
    await requireAuth(context);
    logger.info(`GraphQL Mutation: deleteVendor ${id}`, { id }, 'GRAPHQL_MUTATION');
    return storeService.deleteVendor(id);
  },

  createBuyerAccount: async ({ input }, context) => {
    await requireAuth(context);
    logger.info('GraphQL Mutation: createBuyerAccount', { org: input.organizationName }, 'GRAPHQL_MUTATION');
    return storeService.addBuyerAccount(input);
  },

  clearQueryCache: async (args, context) => {
    await requireAuth(context);
    queryCache.clear();
    return true;
  },

  purgeLogs: async (args = {}, context) => {
    await requireAdmin(context);
    const maxAgeDays = args.maxAgeDays || 30;
    return logger.purgeExpiredLogs({ maxAgeDays });
  },

  autoResolveLogErrors: async (args = {}, context) => {
    await requireAdmin(context);
    if (args.action) {
      const res = await logErrorResolver.executeRemediation(args.action);
      return {
        diagnosedCount: 1,
        issues: [],
        remediationsApplied: [res],
      };
    }
    return await logErrorResolver.autoResolveAll();
  },

  optimizePerformance: async (args = {}, context) => {
    await requireAdmin(context);
    const level = args.level || 'standard';
    return performanceOptimizer.optimizePerformance(level);
  },

  encryptData: async ({ input }, context) => {
    await requireAuth(context);
    const res = cryptoService.encrypt(input.plaintext, {
      secretKey: input.secretKey,
      additionalData: input.additionalData,
      encoding: input.encoding,
    });
    return {
      ciphertext: res.ciphertext,
      iv: res.iv,
      authTag: res.authTag,
      salt: res.salt,
      algorithm: res.algorithm,
      version: res.version,
      encoded: res.encoded,
    };
  },
};

module.exports = rootResolvers;
