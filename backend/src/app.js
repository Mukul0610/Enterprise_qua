const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables (from working directory and backend directory)
dotenv.config();
try {
  // eslint-disable-next-line no-undef
  if (typeof __dirname !== 'undefined') {
    dotenv.config({ path: path.resolve(__dirname, '../.env') });
  }
} catch {
  // Ignored in Cloudflare Workers / ESM bundles where __dirname does not exist
}

const apiRoutes = require('./routes');
const graphqlRoutes = require('./routes/graphql');
const requestLogger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const storeService = require('./services/storeService');
const pool = require('./db/pool');
const { logger } = require('./services/loggerService');

const app = express();

// Cloudflare Workers' entry point (worker.mjs) only calls app.listen() — it
// skips server.js's bootstrapServer(), which is what normally hydrates
// storeService from the database before the first request on Node/Render.
// Workers also can't do that hydration eagerly at module load: I/O (a D1/pg
// call) is only permitted once a request is being handled, not at top-level
// script evaluation. So it happens here instead, lazily, once, on whichever
// request happens to arrive first — same effect as the boot-time call on
// Node, just deferred to inside a request context where it's actually
// allowed to run. A concurrent second request while the first hydration is
// still in flight reuses the same in-flight promise rather than issuing a
// second one.
// Guarded on pool.hasStorage(): with nothing configured (as in the Jest
// suite, where jest.setup.js blanks DATABASE_URL and there's no D1 binding)
// there's nothing to hydrate from, so this stays a no-op rather than calling
// into hydrateFromDB()'s own logging on every single request/test.
let hydrationPromise = null;
app.use((req, res, next) => {
  if (storeService.isHydratedFromDB || !pool.hasStorage()) return next();
  if (!hydrationPromise) {
    hydrationPromise = storeService
      .hydrateFromDB()
      .catch((err) => logger.error('Lazy on-request hydration failed', err, 'APP'))
      .finally(() => {
        hydrationPromise = null;
      });
  }
  hydrationPromise.then(() => next());
});

// Security & Parsing Middlewares
app.use(cors());
// `verify` captures the exact request bytes onto req.rawBody alongside the
// parsed body express.json() already produces — needed only by the Zoho
// webhook route, whose signature covers the raw wire bytes, not a
// re-serialization of the parsed object (which can reorder keys/whitespace and
// silently break verification).
app.use(
  express.json({
    limit: '50mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestLogger);

// API Health & Root Endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    version: '2.0.0',
    platform: 'Procucev Enterprise (QUA AI 2.0) Node.js Backend API',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'Procucev Enterprise Procurement Backend API',
    version: '2.0.0',
    status: 'ONLINE',
    endpoints: {
      health: '/health',
      apiBase: '/api',
      graphql: '/graphql',
      rfqs: '/api/rfqs',
      vendors: '/api/vendors',
      evaluations: '/api/evaluations',
      buyerAccounts: '/api/buyer-accounts',
      auditLogs: '/api/audit',
      systemConfig: '/api/system-config',
      catalogue: '/api/catalogue',
      supportChat: '/api/support-chat',
      logs: '/api/logs',
    },
  });
});

// Mount GraphQL root route
app.use('/graphql', graphqlRoutes);

// Mount Main API Routes
app.use('/api', apiRoutes);

// 404 Handler for Unknown Routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
  });
});

// Global Error Handler
app.use(errorHandler);

module.exports = app;
