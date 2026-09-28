// ==============================================================================
// PROCUCEV ENTERPRISE (QUA AI 2.0) - CONSTANTS, TAXONOMIES & SYSTEM DEFAULTS
// ==============================================================================

const SOURCING_MODES = [
  {
    id: 'mode_1',
    code: 'Version 1',
    name: 'Version 1: Client Roster Sourcing Plan',
    shortLabel: 'Version 1',
    description:
      'Private empanelled vendor network. RFQs are strictly circulated only to your pre-verified approved vendor list.',
    badgeColor: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10',
  },
  {
    id: 'mode_2',
    code: 'Version 2',
    name: 'Version 2: Hybrid Sourcing Plan',
    shortLabel: 'Version 2',
    description:
      'Circulate to your private empanelled list first. If quotes or responses are insufficient, AI expands to Procucev Base Network.',
    badgeColor: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10',
  },
  {
    id: 'mode_3',
    code: 'Version 3',
    name: 'Version 3: AI Autonomous Sourcing Plan',
    shortLabel: 'Version 3',
    description:
      'Autonomous Procucev Network Sourcing with double-blind supplier identity shielding, continuous AI evaluation, and best-fit routing.',
    badgeColor: 'border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10',
  },
];

const BUYER_SUBSCRIPTION_PLANS = [
  {
    id: 'free_trial',
    name: 'Free Trial Starter',
    price: '$0',
    billing: '5 Free RFQs included',
    description: 'Explore all 3 sourcing modes (Mode 1, Mode 2 & Mode 3) with full multi-channel AI chasing.',
    features: [
      '5 Free RFQ dispatches across any operational mode',
      'Autonomous Voice, WhatsApp & SMS multi-channel follow-ups',
      'Interactive Quote Matrix & 1-click PO generation',
      'SHA-256 cryptographic audit transaction seals',
    ],
  },
  {
    id: 'version_1',
    name: 'Version 1 Plan: Client Roster Only',
    price: '$199',
    billing: 'per user / month',
    description: 'Streamline procurement across your private pre-approved vendor roster with automated working-hour follow-ups.',
    features: [
      'Mode 1: Private Preferred Vendor Network Sourcing',
      'Direct sourcing from uploaded Excel/Manual buyer rosters',
      'Working-hour multi-channel follow-ups (SMS 5m, Call +6h, WA +12h)',
      'Strict single-dispatch guarantee per vendor (zero repetition)',
    ],
  },
  {
    id: 'version_2',
    name: 'Version 2 Plan: Hybrid Sourcing',
    price: '$499',
    billing: 'per user / month',
    description: 'Cumulative plan giving full access to BOTH Mode 1 and Mode 2 with hybrid platform network discovery.',
    features: [
      'CUMULATIVE: Full access to Mode 1 AND Mode 2 features',
      'AI Hybrid Sourcing with Procucev verified network matching',
      'Intelligent RFQ Minor Category matching (280+ taxonomy) & proximity filter',
      'Automatic classification of Buyer Upload vs. Network Pool',
    ],
  },
  {
    id: 'version_3',
    name: 'Version 3 Plan: Autonomous AI Enterprise',
    price: '$999',
    billing: 'per user / month',
    description: 'Ultimate all-inclusive tier giving full access to Mode 1, Mode 2, AND Mode 3 with autonomous AI governance.',
    features: [
      'ALL-INCLUSIVE: Full access to Mode 1, Mode 2, AND Mode 3 features',
      'Pre-bid 360° 6-pillar vendor qualification audits',
      'Double-blind supplier identity shielding for unbiased quote benchmarking',
      'Automated SAP S/4HANA & Oracle Cloud ERP synchronization adapters',
    ],
  },
];

const VENDOR_SUBSCRIPTION_PLANS = [
  {
    id: 'premium',
    name: 'Premium Model (Client Uploaded)',
    price: 'Free',
    billing: 'included with Buyer Roster upload',
    description: 'Automatically granted to vendors uploaded by buyers. Access all direct RFQ invitations issued by your clients.',
    features: [
      'See all RFQs from buyers who uploaded your vendor profile',
      'Unlimited technical BOQ downloads for direct invitation RFQs',
      'Email-based quotation tracking and status updates',
      'Direct communication channel with inviting enterprise buyers',
    ],
  },
  {
    id: 'connect',
    name: 'Connect Model (Marketplace Expansion)',
    price: '$149',
    billing: 'per 3 months (90 days)',
    description: 'Expand your market reach. Access & download open RFQs across the entire Procucev Network Marketplace.',
    features: [
      'All Premium Client-Uploaded features included',
      'Download up to 50 RFQs within 3 months (90-day period)',
      '🎁 360° AI Self-Evaluation Fee: $0 FREE (Waived from $5)',
      'Access to full Open Network Marketplace RFQs',
      'Instant email dispatch of technical BOQ spreadsheets & specifications',
    ],
  },
  {
    id: 'select',
    name: 'Select Model (Catalogue & High Volume)',
    price: '$349',
    billing: 'per 3 months (90 days)',
    description: 'Complete tier for high-volume suppliers. Build your Item Catalogue and capture maximum marketplace demand.',
    features: [
      'Download up to 100 RFQs within 3 months',
      'Published Item SKU Catalogue with direct buyer visibility',
      '🎁 360° AI Self-Evaluation Fee: $0 FREE (Waived from $5)',
      'Priority AI routing in Mode 2 & Mode 3 matching algorithms',
    ],
  },
];

const INITIAL_SYSTEM_CONFIG = {
  ollamaModel: 'Llama 3 (8B Instruct)',
  ollamaActive: true,
  ocrExtractionThreshold: 85,
  whatsappAutoChaser: true,
  voiceCallAutoChaser: true,
  smsAutoChaser: true,
  escalationIntervalHours: 24,
  azureDbBackupFrequency: 'Daily',
  rbacEnforced: true,
};

// Actor recorded on an audit entry when no signed-in user could be resolved for
// the action. Previously each call site invented its own plausible-looking human
// mailbox ('buyer@enterprise.com', 'procurement@enterprise.com',
// 'auditor@procucev.ai'), which made an unattributed system action read as a
// deliberate act by a named person.
const SYSTEM_ACTOR_EMAIL = 'system@procucev.ai';
// Time budget defaults for a newly raised RFQ. Real values, just not per-RFQ
// choices — kept here rather than inline so the chaser cadence and the UI agree.
const RFQ_DEFAULTS = {
  ALLOCATED_TIME: '24 hrs',
  ELAPSED_TIME: '0 hrs',
};
// Infrastructure rows the admin screen renders. The database row is replaced at
// runtime with the live result of pool.checkDatabaseHealth() (see
// storeService.refreshInfrastructureHealth), so the entry below is only the
// placeholder shown before the first probe completes.
//
// The previous first entry described 'Azure Database for MySQL (Shared Identity
// Schema)' as ONLINE with an 18ms latency and 99.99% uptime. That database is no
// longer part of this application at all.
const DATABASE_HEALTH_SERVICE_LABEL = 'PostgreSQL Database (Neon)';
const INITIAL_AZURE_HEALTH = [
  {
    service: DATABASE_HEALTH_SERVICE_LABEL,
    status: 'CHECKING',
    latency: '—',
    uptime: '—',
    details: 'Awaiting the first connection health probe.',
  },
  {
    service: 'Azure OpenAI (Doc Intelligence OCR)',
    status: 'HEALTHY',
    latency: '42ms',
    uptime: '99.95%',
    details: 'Deployment: gpt-4o-procure-v2, TPS: 140/sec',
  },
  {
    service: 'Azure Cosmos DB (Chasing State Engine)',
    status: 'ONLINE',
    latency: '12ms',
    uptime: '99.999%',
    details: 'Multi-Region Replication, Automatic Partitioning',
  },
  {
    service: 'Azure Communication Services (WhatsApp / Voice Gateway)',
    status: 'ONLINE',
    latency: '65ms',
    uptime: '99.9%',
    details: 'Enterprise WhatsApp Business API & AI Voice SIP Trunking Active',
  },
  {
    service: 'Azure Key Vault & HSM Security (kv-procucev-prod)',
    status: 'HEALTHY',
    latency: '8ms',
    uptime: '100%',
    details: 'FIPS 140-2 Level 3 Hardware Security Module Active',
  },
];

const QUALIFICATION_PILLARS = [
  { id: 'M1', name: 'Commercial Terms', weight: 25, color: '#3b82f6' },
  { id: 'M2', name: 'Technical Capabilities', weight: 15, color: '#06b6d4' },
  { id: 'M3', name: 'Quality & Warranty', weight: 20, color: '#10b981' },
  { id: 'M4', name: 'Operational Delivery', weight: 20, color: '#8b5cf6' },
  { id: 'M5', name: 'Financial Stability', weight: 10, color: '#f59e0b' },
  { id: 'M6', name: 'Governance & ESG', weight: 10, color: '#f43f5e' },
];

const AES_CONFIG = {
  ALGORITHM: 'aes-256-gcm',
  FALLBACK_ALGORITHM: 'aes-256-cbc',
  KEY_LENGTH_BYTES: 32,
  IV_LENGTH_BYTES: 12,
  AUTH_TAG_LENGTH_BYTES: 16,
  SALT_LENGTH_BYTES: 16,
  PBKDF2_ITERATIONS: 100000,
  PBKDF2_DIGEST: 'sha256',
  VERSION: 'v1',
  DEFAULT_ENCODING: 'hex',
  SERIALIZATION_PREFIX: 'enc:v1:aes-256-gcm:',
};

const AUTH_MESSAGES = {
  EMAIL_REQUIRED: 'Email is required.',
  EMAIL_PASSWORD_REQUIRED: 'Email and password are required.',
  EMAIL_MOBILE_PASSWORD_REQUIRED:
    'Email, registered mobile number and password are all required to sign in.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  // Password sign-in resolves the account by email + mobile together, so the
  // failure message names all three fields without revealing which one missed.
  INVALID_LOGIN_CREDENTIALS: 'Invalid password for this account. Check your password and try again.',
  // Java equivalent: "Invalid phone number and username" from POST /authenticate.
  INVALID_USERNAME_OR_MOBILE:
    'No active account matches this email address and mobile number together. Check both values, or register if you do not have an account yet.',
  MOBILE_REQUIRED: 'A 10-digit Indian mobile number is required.',
  PASSWORD_OR_CODE_REQUIRED: 'Password or OTP code is required.',
  AUTH_FAILED_FALLBACK: 'Authentication failed',
  OTP_EMAIL_REQUIRED: 'Email is required to dispatch OTP.',
  OTP_REQUEST_EMAIL_REQUIRED: 'Email is required to request OTP.',
  ACCOUNT_NOT_FOUND: 'No account found for this email. Please register first.',
  OTP_CODE_REQUIRED: 'Email and verification code are required.',
  INVALID_OTP: 'Invalid or expired OTP code.',
  INVALID_OTP_FALLBACK: 'Invalid OTP code.',
  REGISTRATION_EMAIL_REQUIRED: 'Email is required for registration.',
  ACCOUNT_EXISTS_LOGIN: 'Account already exists. Logged in successfully.',
  REGISTRATION_SUCCESS: 'Registration successful.',
  NO_SESSION_TOKEN: 'No active session token provided.',
  INVALID_SESSION_FALLBACK: 'Invalid session',
  SESSION_TOKEN_MISSING: 'Token missing or invalid',
  MALFORMED_TOKEN: 'Malformed token structure',
  INVALID_TOKEN_SIGNATURE: 'Invalid token signature',
  SESSION_LOGGED_OUT: 'Session has been logged out.',
  SESSION_EXPIRED: 'Session token has expired',
  TOKEN_DECODE_FAILED: 'Failed to decode token payload',
  LOGOUT_SUCCESS: 'Logged out successfully.',
  // Self-service password change. The current password is re-verified against
  // the stored row on every attempt, because the session token proves who the
  // caller is but not that they still know the credential.
  CHANGE_PASSWORD_FIELDS_REQUIRED:
    'Both your current password and the new password are required to change it.',
  CHANGE_PASSWORD_CURRENT_INCORRECT:
    'Your current password is not correct, so the password was not changed. Re-enter it and try again.',
  CHANGE_PASSWORD_TOO_SHORT: 'Choose a new password of at least 8 characters.',
  CHANGE_PASSWORD_UNCHANGED:
    'The new password is the same as your current one. Choose a different password.',
  CHANGE_PASSWORD_ACCOUNT_MISSING:
    'Your account record could not be read, so the password was not changed. Sign in again and retry.',
  CHANGE_PASSWORD_WRITE_FAILED:
    'The new password could not be saved, so your existing password is still in effect. Try again in a moment.',
  CHANGE_PASSWORD_SUCCESS: 'Your password has been changed. Use it the next time you sign in.',
  LOGOUT_REVOCATION_FAILED:
    'Your session could not be ended because the database is unreachable. Try again; if it persists, close the browser to discard the session locally.',
  IDENTITY_DB_UNAVAILABLE:
    'The database is unreachable, so credentials cannot be verified right now. Confirm the DATABASE_URL in backend/.env is correct and that this host is allowed to reach the PostgreSQL instance, then retry.',
  IDENTITY_DB_NOT_CONFIGURED:
    'No database is configured. Set DATABASE_URL in backend/.env so logins can be verified against real account records.',
  // Revocation is checked against the database, so an unreachable database means
  // the session cannot be confirmed as still valid. It fails closed and says so,
  // rather than reporting the credentials as invalid.
  SESSION_CHECK_UNAVAILABLE:
    'Your session could not be confirmed because the database is unreachable. Try again in a moment; if it persists, sign in again.',
  OTP_STORAGE_FAILED:
    'The verification code could not be saved, so it has not been sent. Try requesting a new code in a moment.',
  ACCOUNT_INACTIVE:
    'This account is marked inactive. Ask an administrator to re-activate it before signing in.',
  ACCOUNT_PENDING_APPROVAL:
    'This self-registered account is still awaiting administrator approval, so sign-in is blocked. You will be able to log in once it is approved.',
  ACCOUNT_ALREADY_EXISTS:
    'An account already exists for this email address and mobile number. Use the Sign In tab instead of creating a new account.',
};

// ==============================================================================
// IDENTITY DATABASE (shared Procucev MySQL) - role + master-data mapping
// ==============================================================================

// Maps a `role.role_name` value in the shared MySQL schema onto the four
// application roles the Next.js workspace understands. Unmapped roles are
// rejected at login rather than silently downgraded to `buyer`.
const IDENTITY_ROLE_MAP = {
  clientinitiator: 'buyer',
  'clientinitiator1.1': 'buyer',
  client: 'buyer',
  prapprover: 'buyer',
  prapprover2: 'buyer',
  'prapprover1.1': 'buyer',
  vendor: 'vendor',
  vendorpartner: 'vendor',
  partialvendor: 'vendor',
  registration: 'vendor',
  categorymanager: 'category_manager',
  categorymanager2: 'category_manager',
  categorymanagerbasic: 'category_manager',
  categorymanagerbasic2: 'category_manager',
  vendormanager: 'admin',
  vendormanager2: 'admin',
  vendormanager3: 'admin',
  vendorexecutive: 'admin',
  vendorexecutive2: 'admin',
  superuser: 'admin',
  procucev: 'admin',
};

// Master-data row identifiers that already exist in the shared schema. These are
// looked up by name at runtime; the ids are documented fallbacks only.
const IDENTITY_MASTER_DATA = {
  BUYER_ROLE_NAME: 'ClientInitiator',
  BUYER_ORG_TYPE: 'CLIENT',
  BUYER_STATUS: 'CLIENT_NEW',
  VENDOR_ROLE_NAME: 'Vendor',
  VENDOR_ORG_TYPE: 'VENDOR',
  VENDOR_STATUS: 'VENDOR_NEW',
  CATEGORY_MANAGER_ROLE_NAME: 'CategoryManager',
  CATEGORY_MANAGER_ORG_TYPE: 'INTERNAL',
  CATEGORY_MANAGER_STATUS: 'STAFF_ACTIVE',
  ADMIN_ROLE_NAME: 'SuperUser',
  ADMIN_ORG_TYPE: 'INTERNAL',
  ADMIN_STATUS: 'STAFF_ACTIVE',
  DEFAULT_GMT_PLAN: 'GMT Basic',
  DEFAULT_BFS_PLAN: 'BFS PRO',
  SOURCE_TYPE_WEB: 'W',
  VERIFICATION_VERIFIED: 'EMAIL_VERIFIED',
  VERIFICATION_PENDING: 'PENDING_EMAIL_VERIFICATION',
};

// Indian phone numbers are stored normalised as +91XXXXXXXXXX in the shared
// schema, and the Java login path compares them byte-for-byte.
const IDENTITY_PHONE_CONFIG = {
  DEFAULT_COUNTRY_CODE: '+91',
  NATIONAL_NUMBER_LENGTH: 10,
  // Bare dialling digits, used to detect an already-prefixed 91XXXXXXXXXX value.
  COUNTRY_DIALLING_DIGITS: '91',
};

// ==============================================================================
// RFQ SUMMARY
// ==============================================================================
// Bounds on the generated per-RFQ summary. The item cap keeps a 300-line BOQ
// from producing a prompt large enough to blow the model's context or the
// request timeout; the head of the list is representative enough to summarise.
const RFQ_SUMMARY_CONFIG = {
  MAX_PROMPT_ITEMS: 40,
  MAX_HEADLINE_CHARS: 140,
  MAX_RISK_NOTES: 5,
};

// ==============================================================================
// ACTIVE BUYER ACCOUNT
// ==============================================================================
// The signed-in buyer's account comes from the shared identity schema. There is
// no seeded fallback: a fabricated account is how the dashboard used to attribute
// one buyer's work to another company entirely.
const BUYER_ACCOUNT_RESOLUTION = {
  SOURCE_IDENTITY_DB: 'identity_database',
  STATUS_ACTIVE: 'ACTIVE_VERIFIED',
  MESSAGES: {
    NO_SESSION: 'Sign in to load your organisation profile.',
    IDENTITY_UNAVAILABLE:
      'The account directory is unavailable, so your organisation profile cannot be loaded. Try again shortly.',
    LOOKUP_FAILED:
      'Your organisation profile could not be read. Try again, and if it persists contact your administrator.',
    USER_NOT_FOUND:
      'No account was found for this session. Sign in again, and if it persists contact your administrator.',
    ORG_NOT_LINKED:
      'Your account is not linked to a buyer organisation yet. Ask your administrator to link it, then sign in again.',
  },
};

// ==============================================================================
// RFQ LINE-ITEM CATEGORY CLASSIFICATION
// ==============================================================================
// Resolves a major ("division") and minor ("category") for every ingested line
// item in strict precedence: an explicit non-generic category wins, then a
// domain keyword match, then unclassified. Confidence and status are recorded so
// the buyer can see why an item landed where it did.
//
// Every major/minor pair below must exist in the `category_division` table,
// otherwise the review grid cannot render the value in its dropdowns.
//
// DEFAULT_MAJOR_CATEGORY / DEFAULT_MINOR_CATEGORY are deliberately gone. They
// held 'General Procurement' / 'General Industrial Goods', neither of which is a
// row in that table — so the "documented default" was a pair no dropdown could
// display and no vendor was mapped to. An unmatched item is now left blank and
// flagged for review instead.
const RFQ_CATEGORY_CLASSIFICATION = {
  // How long the ingestion service caches its taxonomy index. The master changes
  // rarely and an ingest reads it once per request, so a shared cache keeps the
  // flow from re-reading a few hundred rows on every upload.
  TAXONOMY_CACHE_TTL_MS: 10 * 60 * 1000,

  CONFIDENCE: {
    EXPLICIT: 0.95,
    KEYWORD: 0.9,
    DEFAULT: 0.5,
  },

  STATUS: {
    EXPLICIT: 'AI_EXTRACTED',
    KEYWORD: 'DOMAIN_KEYWORD_MATCHED',
    DEFAULT: 'DEFAULT',
  },

  // Values that look like a category but carry no routing information, so they
  // must not short-circuit keyword matching.
  GENERIC_CATEGORY_TOKENS: [
    'multiple',
    'various',
    'mixed',
    'general',
    'not specified',
    'unspecified',
    'unknown',
    'other',
    'others',
    'misc',
    'miscellaneous',
    'n/a',
    'na',
    'none',
    'tbd',
  ],

  // Longest keyword is evaluated first so "circuit breaker" beats "breaker".
  DOMAIN_KEYWORD_MAP: {
    'centrifugal pump': { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    'circuit breaker': { major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
    'structural steel': { major: 'Civil Works', minor: 'PEB Structure' },
    'roofing sheet': { major: 'Civil Works', minor: 'Roofing Sheets' },
    'gate valve': { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    switchgear: { major: 'Engineering Spares - Electrical', minor: 'Electrical-Lv Switch Gears' },
    transformer: { major: 'Engineering Spares - Electrical', minor: 'Transformers' },
    compressor: { major: 'Engineering Spares - Mechanical', minor: 'Compressors & Accessories' },
    gearbox: { major: 'Engineering Spares - Mechanical', minor: 'Gearboxes & Spares' },
    bearing: { major: 'Engineering Spares - Mechanical', minor: 'Bearings & Accessories' },
    fastener: { major: 'Engineering Spares - Mechanical', minor: 'Fasteners' },
    lubricant: { major: 'Raw Material', minor: 'Lubricants' },
    impeller: { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    rebar: { major: 'Civil Works', minor: 'TMT BARS' },
    mccb: { major: 'Engineering Spares - Electrical', minor: 'Circuit Breakers' },
    laptop: { major: 'IT', minor: 'Laptop' },
    software: { major: 'IT', minor: 'Software' },
    freight: { major: 'Logistics', minor: 'Road transport' },
    pump: { major: 'Engineering Spares - Mechanical', minor: 'Pumps & Accessories' },
    valve: { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    hose: { major: 'Engineering Spares - Mechanical', minor: 'Hoses, Valves & Fittings' },
    pipe: { major: 'Engineering Spares - Mechanical', minor: 'Pipes & Pipe Fittings' },
    panel: { major: 'Engineering Spares - Electrical', minor: 'Panels' },
    cable: { major: 'Engineering Spares - Electrical', minor: 'Cables' },
    sensor: { major: 'Engineering Spares - Electrical', minor: 'Sensors' },
    motor: { major: 'Engineering Spares - Electrical', minor: 'Motors' },
    peb: { major: 'Civil Works', minor: 'PEB Structure' },
    tmt: { major: 'Civil Works', minor: 'TMT BARS' },
    steel: { major: 'Raw Material', minor: 'Steels' },
    tool: { major: 'Engineering Spares - Mechanical', minor: 'Tools & Tackles' },
    // Personal protective equipment. The model tends to label these with an
    // umbrella term ('PPE', 'Hand Protection') that is not a taxonomy minor, so
    // the item text is what routes them.
    'fire extinguisher': { major: 'Occuptional Health and Safety', minor: 'Fire Extinguishers' },
    'safety jacket': { major: 'Occuptional Health and Safety', minor: 'Safety jackets' },
    'safety shoe': { major: 'Occuptional Health and Safety', minor: 'Safety Shoes' },
    'storage rack': { major: 'New Category-Product', minor: 'Storage Racks' },
    helmet: { major: 'Occuptional Health and Safety', minor: 'Hemlets' },
    harness: { major: 'Occuptional Health and Safety', minor: 'Harness' },
    glove: { major: 'Occuptional Health and Safety', minor: 'Gloves' },
    filter: { major: 'Engineering Spares - Mechanical', minor: 'Filters' },
  },
};

// ==============================================================================
// GEMINI AI DOCUMENT EXTRACTION
// ==============================================================================
// Mirrors app.gemini.* in the Java p2pservices app, which is the service that
// currently extracts RFQ line items in production. The API key is read from the
// environment only and never leaves the server.
const GEMINI_CONFIG = {
  API_KEY: process.env.GEMINI_API_KEY || '',
  BASE_URL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models',
  // Pinned to a specific GA model so extraction quality is reproducible.
  PRIMARY_MODEL: process.env.GEMINI_PRIMARY_MODEL || 'gemini-3-flash-preview',
  // Tried in order when the primary model errors or is unavailable.
  //
  // Ordered fastest-first, which is a deliberate departure from
  // app.gemini.backup-models in the Java service.
  //
  // That service extracts from inbound email in the background, so it can spend
  // as long as it likes on progressively stronger models. This endpoint answers a
  // synchronous browser upload behind a proxy that cuts the request off at 30s,
  // so once the primary has used most of the budget the only useful fallback is
  // one that can finish in the seconds that remain. Measured on the same
  // document: gemini-3.6-flash 12.5s, gemini-3.5-flash-lite 1.8s, identical line
  // items from both.
  //
  // The chain still ends on a floating alias. Google retires pinned models: when
  // gemini-2.0-flash was withdrawn every entry in the old chain 404'd at once and
  // extraction failed outright instead of degrading.
  FALLBACK_MODELS: (
    process.env.GEMINI_FALLBACK_MODELS ||
    'gemini-3.1-flash-lite,gemini-flash-latest,gemini-flash-lite-latest,gemini-3.6-flash,gemini-3.7-flash'
  )
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
  // The primary model measured 12.5s on a small PDF and timed out at 15s on a
  // real one, so it needs more than the Java service's 15s read timeout to have a
  // fair chance before the chain moves on.
  REQUEST_TIMEOUT_MS: Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 24000),
  // Ceiling for the whole model chain, not one attempt.
  //
  // Extraction is answered inside a browser request, so the walk has to finish
  // while something is still listening. Next's dev proxy cuts a rewrite off at a
  // hardcoded 30s and browsers apply a similar cap, so at 45s a second slow
  // attempt ran past it and the request was killed mid-flight — which surfaced to
  // the buyer as a bare 500 instead of the manual-entry fallback this endpoint
  // exists to return.
  //
  // 28s leaves 2s of headroom under that ceiling and still funds a fast fallback:
  // if the 24s primary times out, the remaining 4s comfortably covers a lite
  // model measured at 1.8s.
  TOTAL_BUDGET_MS: Number(process.env.GEMINI_TOTAL_BUDGET_MS || 28000),
  // Below this much remaining budget a further attempt cannot finish, so the
  // chain stops rather than starting a request it will have to abandon.
  MIN_ATTEMPT_MS: Number(process.env.GEMINI_MIN_ATTEMPT_MS || 3000),
  // Documents larger than this are rejected before a request is billed.
  MAX_DOCUMENT_BYTES: Number(process.env.GEMINI_MAX_DOCUMENT_BYTES || 15 * 1024 * 1024),
  MAX_DOCUMENT_TEXT_CHARS: Number(process.env.GEMINI_MAX_DOCUMENT_TEXT_CHARS || 120000),
  // Deterministic output: extraction must not paraphrase or invent values.
  TEMPERATURE: 0,
};

// ==============================================================================
// RFQ DOCUMENT ATTACHMENTS
// ==============================================================================
// Supporting documents a buyer attaches to an RFQ. These are stored and served
// back verbatim and are never sent to Gemini: the manual flow exists precisely
// because the buyer is keying the line items themselves.
//
// Content lives in Cloudflare R2 rather than on the RFQ record. A 15MB PDF is
// ~20MB of base64, and the bootstrap payload returns every RFQ, so inlining
// attachments would make that response grow without bound.
const RFQ_ATTACHMENT_CONFIG = {
  // Object key prefix within the R2 bucket (was the local disk directory
  // before the R2 migration — same env var, reinterpreted).
  STORAGE_DIR: process.env.RFQ_ATTACHMENT_DIR || 'uploads/rfq-attachments',
  MAX_BYTES: Number(process.env.RFQ_ATTACHMENT_MAX_BYTES || 15 * 1024 * 1024),
  MAX_PER_RFQ: Number(process.env.RFQ_ATTACHMENT_MAX_PER_RFQ || 10),
  // Allow-list rather than a block-list: anything not named here is refused, so a
  // new executable or script type cannot be introduced by omission.
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp',
    // Email files. The ingestion wizard's own file picker offers `.eml` / `.msg`
    // (its accept list has always included them), so a buyer could stage one,
    // have it read for extraction, and then have the store of that same document
    // refused by this list. Both are inert message containers, served back with
    // their own content type, so nothing here is executable.
    'message/rfc822',
    'application/vnd.ms-outlook',
  ],
  // Identifiers are generated server-side and must match this before ever being
  // joined onto a path, which is what keeps `../` out of the storage directory.
  ID_PATTERN: /^[a-f0-9-]{8,64}$/,
};

// ==============================================================================
// EMAIL-TO-RFQ INGESTION
// ==============================================================================
// Shapes how an emailed requisition is turned into extractor input. See
// services/emailIngestionService.js — in particular why workbook attachments are
// deliberately not parsed server-side.
const EMAIL_INGESTION_CONFIG = {
  // RFC822 containers this pipeline reads.
  EML_PATTERN: /\.eml$/i,
  // Outlook's Compound File Binary format, which is not RFC822 and is refused
  // with an instruction to re-export rather than failing silently.
  MSG_PATTERN: /\.msg$/i,
  MAX_BYTES: Number(process.env.EMAIL_INGESTION_MAX_BYTES || 15 * 1024 * 1024),
  MAX_ATTACHMENTS: Number(process.env.EMAIL_INGESTION_MAX_ATTACHMENTS || 10),
  // Cap on how much of a decoded text attachment is appended, so one oversized
  // CSV cannot crowd the body out of the extractor's context window.
  MAX_TEXT_ATTACHMENT_CHARS: Number(process.env.EMAIL_INGESTION_MAX_TEXT_CHARS || 40000),
  // Decoded inline and appended to the document text.
  TEXT_ATTACHMENT_MIME_TYPES: ['text/plain', 'text/csv', 'text/tab-separated-values'],
  // Passed to Gemini as base64. Kept as a subset of GEMINI_INLINE_MIME_TYPES so a
  // type can never be forwarded that the extractor would then refuse.
  INLINE_ATTACHMENT_MIME_TYPES: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  // A line matching any of these starts the quoted thread beneath a forwarded
  // requisition; everything from there down is dropped before extraction.
  QUOTE_MARKERS: [
    /^\s*-{2,}\s*original message\s*-{2,}\s*$/i,
    /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/i,
    /^\s*_{5,}\s*$/,
    /^\s*on .+ wrote:\s*$/i,
    /^\s*from:\s.+\ssent:\s/i,
    /^\s*>{1,}\s?/,
  ],
};

// ==============================================================================
// ZOHO PAYMENTS
// ==============================================================================
// Ported from the reference p2pservices Java app's ZohoOAuthService/ZohoApiClient/
// PaymentLinkService/ZohoWebhookController. Real secrets (CLIENT_SECRET,
// REFRESH_TOKEN) live only in backend/.env, never hardcoded — same rule as
// DATABASE_URL and EMAIL_GATEWAY_*.
//
// Live and sandbox are separately-authorized Zoho OAuth grants (different scope
// prefix, ZohoPay.* vs ZohoPaySandbox.*, and a different API host), so each needs
// its own full credential set rather than one set with a URL swap. ZOHO_MODE
// picks which block is active; the backend must be restarted to change it.
const ZOHO_MODE = (process.env.ZOHO_MODE || 'live').toLowerCase() === 'sandbox' ? 'sandbox' : 'live';

const ZOHO_LIVE_CONFIG = {
  CLIENT_ID: process.env.ZOHO_LIVE_CLIENT_ID || process.env.ZOHO_CLIENT_ID || '',
  CLIENT_SECRET: process.env.ZOHO_LIVE_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET || '',
  REFRESH_TOKEN: process.env.ZOHO_LIVE_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN || '',
  OAUTH_TOKEN_URL: process.env.ZOHO_LIVE_OAUTH_TOKEN_URL || process.env.ZOHO_OAUTH_TOKEN_URL || 'https://accounts.zoho.in/oauth/v2/token',
  PAYMENTS_BASE_URL: process.env.ZOHO_LIVE_PAYMENTS_BASE_URL || 'https://payments.zoho.in/api/v1',
  ACCOUNT_ID: process.env.ZOHO_LIVE_PAYMENTS_ACCOUNT_ID || process.env.ZOHO_PAYMENTS_ACCOUNT_ID || '',
  WEBHOOK_SIGNING_KEY: process.env.ZOHO_LIVE_WEBHOOK_SIGNING_KEY || process.env.ZOHO_WEBHOOK_SIGNING_KEY || '',
  RETURN_URL_BASE: process.env.ZOHO_LIVE_RETURN_URL_BASE || process.env.ZOHO_PAYMENTS_RETURN_URL_BASE || 'http://localhost:3000',
};

const ZOHO_SANDBOX_CONFIG = {
  CLIENT_ID: process.env.ZOHO_SANDBOX_CLIENT_ID || process.env.ZOHO_CLIENT_ID || '',
  CLIENT_SECRET: process.env.ZOHO_SANDBOX_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET || '',
  REFRESH_TOKEN: process.env.ZOHO_SANDBOX_REFRESH_TOKEN || '',
  OAUTH_TOKEN_URL: process.env.ZOHO_SANDBOX_OAUTH_TOKEN_URL || 'https://accounts.zoho.in/oauth/v2/token',
  PAYMENTS_BASE_URL: process.env.ZOHO_SANDBOX_PAYMENTS_BASE_URL || 'https://paymentssandbox.zoho.in/api/v1',
  ACCOUNT_ID: process.env.ZOHO_SANDBOX_PAYMENTS_ACCOUNT_ID || process.env.ZOHO_PAYMENTS_ACCOUNT_ID || '',
  WEBHOOK_SIGNING_KEY: process.env.ZOHO_SANDBOX_WEBHOOK_SIGNING_KEY || '',
  RETURN_URL_BASE: process.env.ZOHO_SANDBOX_RETURN_URL_BASE || process.env.ZOHO_PAYMENTS_RETURN_URL_BASE || 'http://localhost:3000',
};

const ZOHO_ACTIVE_CREDENTIALS = ZOHO_MODE === 'sandbox' ? ZOHO_SANDBOX_CONFIG : ZOHO_LIVE_CONFIG;

const ZOHO_CONFIG = {
  MODE: ZOHO_MODE,
  ...ZOHO_ACTIVE_CREDENTIALS,
  RECONCILIATION_ENABLED: String(process.env.ZOHO_RECONCILIATION_ENABLED || '').toLowerCase() === 'true',
  // 10 minutes, matching the reference app's `0 */10 * * * *` cron.
  RECONCILIATION_INTERVAL_MS: Number(process.env.ZOHO_RECONCILIATION_INTERVAL_MS || 10 * 60 * 1000),
  // Refresh the cached access token this many ms before it actually expires, so
  // a request never races a token that's about to go stale mid-flight.
  TOKEN_REFRESH_BUFFER_MS: 60 * 1000,
  GST_RATE: 0.18,
};

// The app's three vendor subscription plans (VENDOR_SUBSCRIPTION_PLANS above)
// only carry a display price ('$149' etc.) — no numeric, currency-specific
// amount a payment request can actually charge. 'premium' is free/auto-granted
// and never reaches this table. INR chosen to match Zoho's `currency=INR`
// paymentlinks contract the reference app uses.
const ZOHO_SUBSCRIPTION_PRICING = {
  connect: 2,
  select: 5,
};

/** GST-inclusive amount Zoho actually charges for a plan, 2dp, or null if the plan isn't payable. */
function computeZohoPlanAmount(planId) {
  const base = ZOHO_SUBSCRIPTION_PRICING[planId];
  if (!Number.isFinite(base)) return null;
  return Math.round(base * (1 + ZOHO_CONFIG.GST_RATE) * 100) / 100;
}

// Same gap on the buyer side: BUYER_SUBSCRIPTION_PLANS above only carries a
// display price ('$199' etc.). 'free_trial' is free/instant and never reaches
// this table — only the three paid tiers are real Zoho charges.
const ZOHO_BUYER_SUBSCRIPTION_PRICING = {
  version_1: 2,
  version_2: 5,
  version_3: 8,
};

/** GST-inclusive amount Zoho actually charges for a buyer plan, 2dp, or null if the plan isn't payable. */
function computeZohoBuyerPlanAmount(planId) {
  const base = ZOHO_BUYER_SUBSCRIPTION_PRICING[planId];
  if (!Number.isFinite(base)) return null;
  return Math.round(base * (1 + ZOHO_CONFIG.GST_RATE) * 100) / 100;
}

// ==============================================================================
// AUTONOMOUS EMAIL INGESTION GATEWAY
// ==============================================================================
// The mailbox poller. See services/emailGatewayService.js for why an ingested RFQ
// is held for review rather than circulated.
const EMAIL_GATEWAY_CONFIG = {
  DEFAULT_POLL_MS: 60000,
  // Floor on the interval regardless of configuration. Each poll opens an IMAP
  // connection and may call Gemini per message, so a misconfigured 1s interval
  // would burn provider quota and risk the mail host throttling the account.
  MIN_POLL_MS: 30000,
  // Cap per pass so a backlog cannot spend unbounded time and quota in one run.
  DEFAULT_MAX_PER_POLL: 10,
  // Inbound requisitions are held for a category manager to check. The kanban
  // already renders this column and nothing else writes to it.
  INGESTED_STATUS: 'Parsing',
  // Default sourcing mode for email-ingested RFQs: Version 2 (Hybrid Sourcing).
  INGESTED_SOURCING_MODE: 'mode_2',
  // Emails have no file name; this stands in wherever one is recorded.
  SYNTHETIC_FILE_NAME: 'inbound-email.eml',
  DEFAULT_GATEWAY_ADDRESS: 'rfq@procucev.com',
  MAX_LINE_ITEMS_PER_RFQ: 49,
};

const VENDOR_EMAIL_GATEWAY_CONFIG = {
  DEFAULT_POLL_MS: 60000,
  MIN_POLL_MS: 30000,
  DEFAULT_MAX_PER_POLL: 10,
  DEFAULT_GATEWAY_ADDRESS: 'srinu20252026@gmail.com',
  DEFAULT_FROM_NAME: 'Procucev Enterprise',
};

/**
 * Mapping between buyer subscription plans and their corresponding RFQ sourcing / version mode.
 * - version_1: mode_1 (Version 1: Client Roster Sourcing Plan)
 * - version_2: mode_2 (Version 2: Hybrid Sourcing Plan)
 * - version_3: mode_3 (Version 3: AI Autonomous Sourcing Plan)
 */
const BUYER_SUBSCRIPTION_TO_SOURCING_MODE = {
  version_1: 'mode_1',
  version_2: 'mode_2',
  version_3: 'mode_3',
  v1: 'mode_1',
  v2: 'mode_2',
  v3: 'mode_3',
  mode_1: 'mode_1',
  mode_2: 'mode_2',
  mode_3: 'mode_3',
};

/**
 * Resolves the RFQ version / sourcing mode based upon the subscription of the buyer.
 * Defaults to Version 2 ('mode_2') as specified in EMAIL_GATEWAY_CONFIG.INGESTED_SOURCING_MODE.
 *
 * @param {Object|string|null|undefined} buyerAccountOrPlan - Buyer account object or subscription plan string
 * @returns {string} Sourcing mode ('mode_1' | 'mode_2' | 'mode_3')
 */
function resolveBuyerSourcingMode(buyerAccountOrPlan) {
  const plan =
    typeof buyerAccountOrPlan === 'object' && buyerAccountOrPlan !== null
      ? buyerAccountOrPlan.subscriptionPlan
      : buyerAccountOrPlan;

  if (typeof plan === 'string') {
    const normalized = plan.trim().toLowerCase();
    if (BUYER_SUBSCRIPTION_TO_SOURCING_MODE[normalized]) {
      return BUYER_SUBSCRIPTION_TO_SOURCING_MODE[normalized];
    }
  }

  return EMAIL_GATEWAY_CONFIG.INGESTED_SOURCING_MODE || 'mode_2';
}

/** Connection state reported to the gateway panel. */
const EMAIL_GATEWAY_STATE = {
  ACTIVE_LISTENING: 'ACTIVE_LISTENING',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  SWITCHED_OFF: 'SWITCHED_OFF',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
};

/**
 * Ports that belong to sending mail, not reading it.
 *
 * Pointing the gateway at 587 (SMTP submission) with implicit TLS on is what
 * produced `SSL routines::wrong version number`: 587 opens in plaintext and
 * upgrades via STARTTLS, so a TLS ClientHello gets a plaintext SMTP greeting
 * back. Detected explicitly rather than left to fail at the socket.
 */
const EMAIL_GATEWAY_SMTP_PORTS = [25, 465, 587, 2525];

/** Buyer-facing detail recorded against each considered message. */
const EMAIL_GATEWAY_MESSAGES = {
  // Configuration faults, named precisely because the underlying socket error is
  // unreadable to anyone who has not seen it before.
  SMTP_HOST_CONFIGURED:
    'EMAIL_GATEWAY_HOST is set to {host}, which is a mail sending server. The gateway reads a mailbox, so it needs an IMAP host — use imap.gmail.com for Gmail or outlook.office365.com for Microsoft 365.',
  SMTP_PORT_CONFIGURED:
    'EMAIL_GATEWAY_PORT is {port}, which is a mail sending port. IMAP uses 993 with EMAIL_GATEWAY_SECURE=true, or 143 with EMAIL_GATEWAY_SECURE=false.',
  TLS_VERSION_MISMATCH:
    'The mail server answered without TLS, so the connection was refused. This is almost always the wrong host or port: IMAP is 993 with EMAIL_GATEWAY_SECURE=true, or 143 with EMAIL_GATEWAY_SECURE=false. Check EMAIL_GATEWAY_HOST is an IMAP host and not an SMTP one.',
  AUTH_REJECTED:
    'The mail server rejected the credentials. For Gmail, IMAP must be enabled in Settings > Forwarding and POP/IMAP, and EMAIL_GATEWAY_PASSWORD must be an App Password rather than the account password.',
  HOST_UNRESOLVED:
    'EMAIL_GATEWAY_HOST could not be resolved. Check the hostname for a typo and that this machine has DNS and outbound network access.',
  HOST_UNREACHABLE:
    'The mail server did not accept a connection on that port. Check EMAIL_GATEWAY_PORT and that outbound IMAP is not blocked by a firewall.',
  CERTIFICATE_REJECTED:
    'The mail server presented a certificate that could not be verified. Confirm EMAIL_GATEWAY_HOST matches the certificate, and do not disable TLS to work around it.',
  CONNECTION_FAILED_FALLBACK:
    'The mailbox could not be reached. Check EMAIL_GATEWAY_HOST, EMAIL_GATEWAY_PORT and the credentials, then try again.',
  NOT_CONFIGURED:
    'The email gateway is not configured. Set EMAIL_GATEWAY_HOST, EMAIL_GATEWAY_USER and EMAIL_GATEWAY_PASSWORD in backend/.env to connect a mailbox.',
  DISABLED: 'The email gateway is switched off. Set EMAIL_GATEWAY_ENABLED=true to start watching the mailbox.',
  ALREADY_STARTED: 'The email gateway is already watching the mailbox.',
  POLL_ALREADY_RUNNING: 'A mailbox check is already in progress.',
  ALREADY_PROCESSED: 'ALREADY_PROCESSED',
  SENDER_MISSING: 'The message carried no sender address, so it could not be attributed to a buyer account.',
  SENDER_NOT_LISTED:
    'The sender {address} is not on EMAIL_GATEWAY_ALLOWED_SENDERS, so the requisition was not raised.',
  DOMAIN_NOT_LISTED:
    'The domain {domain} is not on EMAIL_GATEWAY_ALLOWED_DOMAINS, so the requisition was not raised.',
  // The baseline rule: without an owning account an RFQ has no buyerAccountId and
  // would not appear on any dashboard, so this is a functional bar as well as a
  // security one.
  SENDER_NO_ACCOUNT:
    'No buyer account is registered against {address}. Add it as a buyer account before requisitions from that address can be raised.',
  PREPARE_REFUSED: 'The message could not be read for extraction ({status}).',
  EXTRACTION_FAILED: 'AI extraction produced no line items ({status}).',
  NO_ITEMS_ACCEPTED: 'No usable procurement line items were found in the message.',
  LINE_ITEMS_EXCEED_LIMIT: 'Maximum {max} line items per RFQ exceeded (received {count}).',
  INGESTED_DETAIL: 'Raised with {count} line item(s), {needsReview} needing category review.',
  QUOTE_INGESTED_DETAIL: 'Vendor quotation for RFQ {rfqNumber} successfully ingested from email ({vendorName}).',
  QUOTE_VALIDATION_FAILED_DETAIL: 'Vendor quotation for RFQ {rfqNumber} from {vendorName} failed validation: {reason}.',
  QUOTE_ACK_SUBJECT: 'Quotation Received – RFQ {rfqNumber}',
  QUOTE_FAILURE_SUBJECT: 'Action Required – Quotation Could Not Be Processed for RFQ {rfqNumber}',
  INVALID_RFQ_REFERENCED: 'The referenced RFQ {rfqNumber} was not found in the system.',
  VENDOR_NOT_FOUND_FOR_QUOTE: 'No vendor profile found for sender {address}.',
  VENDOR_GATEWAY_REQUIRES_RFQ: 'Vendor email gateway only processes quotation replies for existing RFQs.',
  CREDITS_EXHAUSTED_DETAIL: 'Quotation email from {vendorName} for RFQ {rfqNumber} acknowledged: 5 free quotation credits exhausted. Subscription upgrade email sent.',
  CREDITS_EXHAUSTED_SUBJECT: 'Action Required – Upgrade Plan to Submit Quotation for RFQ {rfqNumber}',
};

/** Default free RFQ quotation credits granted to each vendor */
const VENDOR_FREE_CREDITS_LIMIT = 5;

/** Notification email content for vendor credit exhaustion */
const VENDOR_CREDITS_EXHAUSTED_NOTIFICATION = {
  SUBJECT: 'Action Required – 5 Free Quotation Credits Exhausted for RFQ #{rfqNumber}',
  HEADLINE: 'PROCUCEV ENTERPRISE',
  SUBLINE: 'Free Quotation Credits Exhausted',
  EXHAUSTION_MESSAGE: 'Your 5 free RFQ quotation credits have been fully utilized.',
  UPGRADE_BUTTON_LABEL: 'Click Here to Go to Portal and Upgrade Plan',
  REASSURANCE: 'Your quotation has not been submitted yet. To continue submitting quotations and have your bids evaluated by buyers, please upgrade your subscription plan on the vendor portal.',
};

/** Notification email content for unauthorized email senders. */
const UNAUTHORIZED_BUYER_NOTIFICATION = {
  SUBJECT: 'Enterprise QUA - Buyer Registration Required',
  HEADLINE: 'PROCUCEV ENTERPRISE',
  SUBLINE: 'Buyer Registration Required',
  DEFAULT_GATEWAY_EMAIL: 'RFQ@procucev.com',
};

/** RFQ creation acknowledgement notification sent to the buyer. */
const RFQ_ACKNOWLEDGEMENT_NOTIFICATION = {
  SUBJECT: 'Great news! Your requirement has been converted into RFQ #{rfqNumber}',
  HEADLINE: 'PROCUCEV ENTERPRISE',
  SUBLINE: 'RFQ Creation Acknowledgement',
  SUPPORT_PHONE: '+91-7996170801',
  SUPPORT_EMAIL: 'RFQ@procucev.com / support@procucev.com',
  DEFAULT_GATEWAY_EMAIL: 'RFQ@procucev.com',
  TEAM_SIGNATURE: 'Team Procucev',
  QUOTES_TIMELINE: 'Quotes typically start coming in within 24–48 hours.',
  NEED_IT_FASTER: 'Need it faster or have a follow-up requirement?',
  CLOSING: "Just drop us your requirement anytime — we'll take it from there!",
};

/** Outcome of preparing an email for extraction. */
const EMAIL_INGESTION_STATUS = {
  READY: 'READY',
  NOT_AN_EMAIL: 'NOT_AN_EMAIL',
  OUTLOOK_MSG_UNSUPPORTED: 'OUTLOOK_MSG_UNSUPPORTED',
  NO_CONTENT: 'NO_CONTENT',
  TOO_LARGE: 'TOO_LARGE',
  UNREADABLE: 'UNREADABLE',
};

/**
 * Buyer-facing explanation for each email ingestion refusal.
 *
 * Every one names the specific recovery step, per the descriptive-error standard:
 * re-export the message, send the workbook through the BOQ tab, or key the items.
 */
const EMAIL_INGESTION_MESSAGES = {
  NOT_AN_EMAIL:
    'That file is not an email message. Upload a .eml file exported from your mail client, or use the BOQ Spreadsheet / Drawing tab for documents.',
  OUTLOOK_MSG_UNSUPPORTED:
    'Outlook .msg files cannot be read. In Outlook, open the message and use File > Save As to save it as a .eml file, then upload that instead.',
  NO_CONTENT:
    'This email has no readable body and no PDF, image or CSV attachment to extract from. If the requisition is in a spreadsheet, upload it through the BOQ Spreadsheet / Drawing tab.',
  TOO_LARGE: `That email is larger than the ${Math.floor(
    Number(process.env.EMAIL_INGESTION_MAX_BYTES || 15 * 1024 * 1024) / (1024 * 1024)
  )}MB limit. Forward just the requisition without the earlier thread, or upload the attachment on its own.`,
  UNREADABLE:
    'This email could not be parsed. Re-export it from your mail client as a .eml file, or add the line items manually.',
  // Appended when the message did yield line items but also carried an
  // attachment this pipeline cannot read.
  SPREADSHEET_ATTACHMENT_SKIPPED:
    'The attachment {fileNames} was not read. Spreadsheet attachments are not extracted from email — upload it through the BOQ Spreadsheet / Drawing tab to include its line items.',
};

// Buyer-facing explanation for each extraction outcome. Every one of these ends
// by pointing at manual line-item entry, because that is the recovery path.
const EXTRACTION_REASON_MESSAGES = {
  NOT_CONFIGURED:
    'AI extraction is not configured on this environment (GEMINI_API_KEY is unset). Add the line items manually to continue.',
  NO_CONTENT:
    'No readable content was found in this file. Add the line items manually to continue.',
  DOCUMENT_TOO_LARGE:
    'This document is too large for AI extraction. Upload a smaller file or add the line items manually.',
  UNSUPPORTED_TYPE:
    'This file type cannot be read by AI extraction. Upload a spreadsheet, PDF or image, or add the line items manually.',
  AI_FAILED:
    'AI extraction could not read this document. Add the line items manually to continue.',
  NO_ITEMS_FOUND:
    'No procurement line items could be identified in this document. Add the line items manually to continue.',
  // Shared with emailIngestionService's EMAIL_INGESTION_STATUS — a buyer
  // uploading a raw .eml goes through the same status set as the IMAP gateway.
  NOT_AN_EMAIL:
    'That file could not be read as an email. Upload the original .eml file, or add the line items manually.',
  OUTLOOK_MSG_UNSUPPORTED:
    'Outlook .msg files are not supported yet — save the email as .eml and upload that instead, or add the line items manually.',
  UNREADABLE:
    'This email could not be read. Add the line items manually to continue.',
  TOO_LARGE:
    'This email is too large for AI extraction. Add the line items manually to continue.',
};

// MIME types Gemini can read natively as inline data. Spreadsheets are flattened
// to text by the browser first, because Gemini cannot parse xlsx binaries.
const GEMINI_INLINE_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'text/plain',
  'text/csv',
];

// Normalisation defaults applied to every ingested RFQ line item. These mirror
// AutomaticRfqServiceImpl.raiseRfq and RFQBuilderService in the Java app, which
// are the values buyers' existing RFQs were created with.
const RFQ_INGESTION_CONFIG = {
  DEFAULT_UNIT: 'Nos',
  DEFAULT_QUANTITY: 1,
  DELIVERY_DATE_OFFSET_DAYS: 5,
  MAX_TITLE_LENGTH: 100,
  MAX_LINE_ITEMS_PER_RFQ: 49,
  TITLE_SUFFIX_SINGLE: ' Procurement',
  TITLE_SUFFIX_MULTIPLE: ' & Allied Items Procurement',
};

// Email OTP shape shared with the Java p2pservices app. That service stores
// codes in `otp_store` under the key `<normalisedPhone>_EMAIL_<email>` with a
// 6-character column and a 15-minute expiry, so these values are not free
// parameters: changing them desynchronises the two applications.
const IDENTITY_OTP_CONFIG = {
  OTP_LENGTH: 6,
  OTP_EXPIRY_MS: 15 * 60 * 1000,
  OTP_KEY_SEPARATOR: '_EMAIL_',
};

// ==============================================================================
// BUYER ORGANISATION PROFILE
// ==============================================================================
// Behaviour ported from ProcUserServiceImpl.updateBuyer and
// GMTServiceImpl.getOrgByUserId in the Java p2pservices app, which own the
// `organization` and `org_division_category` rows this feature reads and writes.
const BUYER_PROFILE_CONFIG = {
  // Cardinality caps the old Angular screen enforced for a ClientInitiator: at
  // most 5 divisions, at most 10 minor categories in total. They exist because
  // the RFQ distribution engine fans out per selected category, so an unbounded
  // selection would broadcast every RFQ to the entire vendor base.
  MAX_MAJOR_CATEGORIES: 5,
  MAX_MINOR_CATEGORIES: 10,

  // The rupee sign is rewritten before storage, exactly as updateBuyer does.
  // `organization.annual_turnover` is latin1 in the shared schema, so a literal ₹
  // is written back as mojibake; the Java service sidesteps that by substituting
  // an ASCII currency code, and both applications must agree on the stored form.
  CURRENCY_SYMBOL: '₹',
  CURRENCY_REPLACEMENT: 'INR ',

  // Default constitution applied when the stored row has none, matching the
  // buyer form's initial `orgType` value.
  DEFAULT_ORGANIZATION_TYPE: 'Public Limited',
  DEFAULT_COUNTRY: 'India',
};

const BUYER_PROFILE_MESSAGES = {
  NOT_A_BUYER: 'Only a buyer account can view or manage a buyer organization profile.',
  SESSION_MISSING_USER:
    'Your session does not identify a user account, so the organization profile could not be resolved. Please sign in again.',
  USER_NOT_FOUND:
    'Your user account could not be found in the Procucev identity database. Please sign in again or contact support.',
  ORGANIZATION_NOT_LINKED:
    'Your user account is not linked to an organization yet, so there is no buyer profile to manage. Contact your Procucev administrator to have your account attached to an organization.',
  ORGANIZATION_NOT_FOUND: 'The organization linked to your account no longer exists in the identity database.',
  PROFILE_LOAD_FAILED:
    'The buyer organization profile could not be read from the identity database. The record was not changed. Please retry in a moment.',
  PROFILE_SAVE_FAILED:
    'The buyer organization profile could not be saved to the identity database. No changes were applied. Please retry in a moment.',
  TAXONOMY_LOAD_FAILED:
    'The procurement category taxonomy could not be read from the identity database. Please retry in a moment.',
  PROFILE_SAVED: 'Buyer organization profile updated successfully.',
  CATEGORIES_INVALID:
    'Each procurement category must supply both a major category and a minor category.',
  TOO_MANY_MAJOR_CATEGORIES:
    'You can select at most {max} major procurement categories. Clear one before adding another.',
  TOO_MANY_MINOR_CATEGORIES:
    'You can select at most {max} minor procurement categories in total. Clear one before adding another.',
};

/**
 * Substitute {placeholder} tokens in a message template.
 *
 * Keeps parameterised copy in this module rather than assembling strings at the
 * call site, so every user-facing message stays translatable in one place.
 * An unknown placeholder is left verbatim, which makes the omission visible in
 * the message instead of rendering "undefined".
 */
function formatMessage(template, values) {
  if (!template) return '';
  if (!values) return template;
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    values[key] === undefined || values[key] === null ? match : String(values[key])
  );
}

const {
  EMAIL_REGEX,
  GSTIN_REGEX,
  GSTIN_MESSAGE,
  PHONE_REGEX,
  INDIAN_MOBILE_REGEX,
  INDIAN_MOBILE_MESSAGE,
  OTP_CODE_REGEX,
  OTP_CODE_MESSAGE,
  PINCODE_REGEX,
  PINCODE_MESSAGE,
  PAN_REGEX,
  PAN_MESSAGE,
  CIN_REGEX,
  CIN_MESSAGE,
  WEBSITE_REGEX,
  WEBSITE_MESSAGE,
  INDIAN_PINCODE_REGEX,
  INDIAN_PINCODE_MESSAGE,
  ORGANIZATION_TYPES,
  PASSWORD_MIN_LENGTH,
  ISO_DATE_REGEX,
  ISO_DATE_MESSAGE,
  TIME_HORIZON_TYPES,
  CATEGORY_REVIEW_ACTIONS,
  DISPATCH_TEMPLATES,
  VALIDATION_SCHEMAS,
  validatePayload,
} = require('./validationSchemas');

// ==============================================================================
// VENDOR MASTER & PO DATA INGESTION (buyer module)
// ==============================================================================
// A buyer uploads their Vendor Master, then their historical PO purchase dump,
// and the PO purchasing history — not the company name — is what a supplier is
// categorised from. These are the string enums, caps and user-facing messages
// that flow drives. Nothing below is declared inline at a use site.

/** Lifecycle of one ingestion run. Ordered: each value implies the previous. */
const VENDOR_INGESTION_SESSION_STATUS = {
  DRAFT: 'DRAFT',
  VENDOR_MASTER_STORED: 'VENDOR_MASTER_STORED',
  PO_STORED: 'PO_STORED',
  JOINED: 'JOINED',
  AI_COMPLETED: 'AI_COMPLETED',
  DISPATCHED: 'DISPATCHED',
};

/** Step number each status unlocks, so a forward jump can be refused. */
const VENDOR_INGESTION_STEP = {
  TIME_HORIZON: 1,
  VENDOR_MASTER: 2,
  PO_DUMP: 3,
  AI_CATEGORY_JOIN: 4,
  DISPATCH: 5,
};

/** Time horizon options. CUSTOM is the only one that reads the client's dates. */
const VENDOR_INGESTION_HORIZON = {
  LAST_1_YEAR: 'LAST_1_YEAR',
  LAST_2_YEARS: 'LAST_2_YEARS',
  LAST_3_YEARS: 'LAST_3_YEARS',
  CUSTOM: 'CUSTOM',
};

/** Months back from today for each predefined horizon. */
const VENDOR_INGESTION_HORIZON_MONTHS = {
  LAST_1_YEAR: 12,
  LAST_2_YEARS: 24,
  LAST_3_YEARS: 36,
};

/**
 * Category mapping status.
 *
 * SELF_MAP_REQUIRED is load-bearing: a supplier in the vendor master with no PO
 * history inside the selected horizon has no purchasing evidence, so it is never
 * sent to the categoriser and never carries an AI category. It is asked to map
 * itself instead.
 */
const VENDOR_MAPPING_STATUS = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  AI_MAPPED: 'AI_MAPPED',
  BUYER_APPROVED: 'BUYER_APPROVED',
  SELF_MAP_REQUIRED: 'SELF_MAP_REQUIRED',
  SELF_MAPPED: 'SELF_MAPPED',
  REJECTED: 'REJECTED',
  NEW_CATEGORY_SUGGESTION: 'NEW_CATEGORY_SUGGESTION',
  FAILED: 'FAILED',
};

/** Who decided the stored category. */
const VENDOR_MAPPING_SOURCE = {
  AI: 'AI',
  BUYER: 'BUYER',
  SELF_MAPPED: 'SELF_MAPPED',
};

/** Per-vendor AI job state, persisted so a partial failure is retryable. */
const VENDOR_AI_PROCESSING_STATUS = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

/** Session-level AI job state. IDLE means categorisation has not been run. */
const VENDOR_INGESTION_AI_STATUS = {
  IDLE: 'IDLE',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

/** How a PO line was attributed to a vendor-master row. */
const VENDOR_MATCH_STRATEGY = {
  VENDOR_CODE: 'VENDOR_CODE',
  GSTIN: 'GSTIN',
  NORMALIZED_NAME: 'NORMALIZED_NAME',
  UNMATCHED: 'UNMATCHED',
};

const VENDOR_DISPATCH_TEMPLATE = {
  CATEGORY_MAPPED: 'CATEGORY_MAPPED',
  SELF_MAP_REQUIRED: 'SELF_MAP_REQUIRED',
  GENERAL_ONBOARDING: 'GENERAL_ONBOARDING',
};

/**
 * Per-recipient email state.
 *
 * DELIVERED and BOUNCED are declared but only ever set by a provider callback.
 * Nodemailer over SMTP reports acceptance, not delivery, so this module stops at
 * SENT rather than claiming a delivery it cannot observe.
 */
const VENDOR_EMAIL_STATUS = {
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  FAILED: 'FAILED',
  DELIVERED: 'DELIVERED',
  BOUNCED: 'BOUNCED',
};

const VENDOR_DISPATCH_STATUS = {
  QUEUED: 'QUEUED',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
};

/** Audit actions. Every state change in the module writes exactly one of these. */
const VENDOR_INGESTION_AUDIT_ACTION = {
  SESSION_CREATED: 'SESSION_CREATED',
  TIME_HORIZON_SELECTED: 'TIME_HORIZON_SELECTED',
  VENDOR_MASTER_UPLOADED: 'VENDOR_MASTER_UPLOADED',
  VENDOR_MASTER_VALIDATED: 'VENDOR_MASTER_VALIDATED',
  PO_DUMP_UPLOADED: 'PO_DUMP_UPLOADED',
  PO_DATA_VALIDATED: 'PO_DATA_VALIDATED',
  VENDOR_MATCHING_COMPLETED: 'VENDOR_MATCHING_COMPLETED',
  AI_CATEGORIZATION_STARTED: 'AI_CATEGORIZATION_STARTED',
  AI_CATEGORIZATION_COMPLETED: 'AI_CATEGORIZATION_COMPLETED',
  AI_RECOMMENDATION: 'AI_RECOMMENDATION',
  AI_RE_RUN: 'AI_RE_RUN',
  BUYER_APPROVAL: 'BUYER_APPROVAL',
  BUYER_EDIT: 'BUYER_EDIT',
  BUYER_REJECTION: 'BUYER_REJECTION',
  SELF_MAP_EMAIL_SENT: 'SELF_MAP_EMAIL_SENT',
  CATEGORY_EMAIL_SENT: 'CATEGORY_EMAIL_SENT',
  EMAIL_FAILED: 'EMAIL_FAILED',
  EMAIL_RETRIED: 'EMAIL_RETRIED',
  EMAIL_SKIPPED_DUPLICATE: 'EMAIL_SKIPPED_DUPLICATE',
};

/**
 * Confidence bands.
 *
 * Anything below REVIEW_THRESHOLD is held at PENDING_REVIEW regardless of what
 * the model returned — a low-confidence guess must not reach a live vendor
 * category without a person agreeing to it.
 */
const VENDOR_CONFIDENCE_BANDS = {
  HIGH_MIN: 90,
  MEDIUM_MIN: 70,
  REVIEW_THRESHOLD: 70,
};

/** Operational caps. All enforced server-side, not just in the browser. */
const VENDOR_INGESTION_CONFIG = {
  // One upload request carries at most this many rows; the client chunks a
  // larger file. Matches MAX_BULK_IMPORT_ROWS_PER_REQUEST in vendorController so
  // both spreadsheet upload paths behave identically.
  MAX_ROWS_PER_REQUEST: 1000,
  MAX_VENDOR_MASTER_ROWS: 20000,
  MAX_PO_ROWS: 200000,
  // R2 object key prefix for a large CSV upload awaiting background
  // processing (see largeFileIngestionService.js). Was a local temp-file
  // directory before the Cloudflare Workers migration — Workers has no
  // persistent local disk, so the raw upload now lives in R2 (the same
  // store RFQ attachments already use) between the streaming upload request
  // and the background ingestion job reading it back.
  UPLOAD_STORAGE_DIR: process.env.VENDOR_INGESTION_UPLOAD_DIR || 'uploads/vendor-ingestion',
  // 200,000 PO rows at a generous ~250 bytes/row is ~50MB; this leaves
  // headroom above that without risking an unbounded buffer.
  MAX_UPLOAD_BYTES: Number(process.env.VENDOR_INGESTION_MAX_UPLOAD_BYTES || 75 * 1024 * 1024),
  // Vendors classified per AI batch. The job is chunked so a large run reports
  // progress and can be resumed, rather than holding one long request open.
  AI_BATCH_SIZE: 8,
  // A model reply that is not valid JSON of the expected shape is retried this
  // many times in total before the vendor is marked FAILED. Retrying is safe:
  // classification writes no category until a reply validates.
  AI_MAX_ATTEMPTS: 2,
  // PO lines summarised into one vendor's purchasing profile. Enough to
  // characterise what a supplier sells without sending an entire spend history,
  // which is what makes this one call per vendor rather than one per PO row.
  AI_MAX_PO_LINES_PER_VENDOR: 60,
  AI_MAX_DESCRIPTION_CHARS: 240,
  MAX_MINOR_CATEGORIES_PER_VENDOR: 10,
  // Recipients per dispatch request, so one campaign cannot hold the event loop
  // on a few thousand sequential SMTP sends.
  MAX_RECIPIENTS_PER_DISPATCH: 500,
  // Legal-entity suffixes stripped before a vendor name is used as a fallback
  // match key, so "Apex Supplies Ltd." and "Apex Supplies Limited" collapse to
  // the same key. Vendor Code remains the preferred identifier; this is the last
  // resort, only reached when neither a code nor a GSTIN matched.
  NAME_NORMALIZATION_SUFFIXES: [
    'private limited',
    'pvt limited',
    'pvt ltd',
    'private ltd',
    'limited',
    'ltd',
    'llp',
    'inc',
    'incorporated',
    'corporation',
    'corp',
    'company',
    'co',
    'industries',
    'enterprises',
    'enterprise',
  ],
};

/** User-facing messages. `{param}` placeholders are filled by formatMessage. */
const VENDOR_INGESTION_MESSAGES = {
  NOT_A_BUYER: 'Only a buyer can ingest vendor master and purchase order data.',
  SESSION_MISSING_USER: 'Your session does not identify a user. Please sign in again.',
  ORGANIZATION_NOT_LINKED: 'Your account is not linked to an organisation, so vendor data cannot be scoped to it.',
  SESSION_NOT_FOUND: 'That ingestion session does not exist for your organisation.',
  SESSION_REQUIRED: 'Start an ingestion session before uploading a file.',
  HORIZON_REQUIRED: 'Select a time horizon before uploading the purchase order dump.',
  HORIZON_CUSTOM_DATES_REQUIRED: 'A custom time horizon needs both a start date and an end date.',
  HORIZON_START_AFTER_END: 'The time horizon start date must fall on or before its end date.',
  HORIZON_END_IN_FUTURE: 'The time horizon end date cannot be in the future.',
  VENDOR_MASTER_REQUIRED_FIRST: 'Upload and confirm your Vendor Master before uploading the PO dump.',
  VENDOR_MASTER_EMPTY: 'No valid vendor rows were supplied, so nothing was stored.',
  PO_DUMP_EMPTY: 'No valid purchase order rows were supplied, so nothing was stored.',
  PO_DUMP_REQUIRED_FIRST: 'Upload and confirm your PO dump before running the category match.',
  JOIN_REQUIRED_FIRST: 'Run the vendor and PO match before starting AI categorisation.',
  TOO_MANY_ROWS: 'A single upload request may carry at most {max} rows. Large files are sent in chunks.',
  VENDOR_MASTER_LIMIT: 'A Vendor Master may hold at most {max} suppliers.',
  PO_LIMIT: 'A PO dump may hold at most {max} line items.',
  MAPPING_NOT_FOUND: 'That vendor is not part of this ingestion session.',
  MAPPING_NO_PO_HISTORY:
    'This supplier has no purchase order history inside the selected period, so it cannot be categorised automatically. It is flagged for self-mapping.',
  CATEGORY_MASTER_EMPTY:
    'Your category master is empty, so there is nothing for the categoriser to choose from. Add categories to your organisation profile first.',
  MAJOR_CATEGORY_UNKNOWN: '"{category}" is not a major category in your organisation\'s category master.',
  MINOR_CATEGORY_UNKNOWN: '"{minor}" is not a sub-category of "{major}" in your category master.',
  TOO_MANY_MINOR_CATEGORIES: 'A supplier may carry at most {max} minor categories.',
  EDIT_REQUIRES_CATEGORY: 'Editing a mapping requires a primary major category.',
  AI_NOT_CONFIGURED: 'AI categorisation is not configured on this server, so no suggestions could be generated.',
  AI_ALREADY_RUNNING: 'AI categorisation is already running for this session.',
  AI_INVALID_RESPONSE: 'The categoriser did not return a usable result for this supplier.',
  DISPATCH_NO_RECIPIENTS: 'No eligible recipients were found for that template and category.',
  DISPATCH_TOO_MANY: 'A single dispatch may address at most {max} recipients.',
  DISPATCH_NOT_APPROVED:
    'Only suppliers whose categories you have approved can be sent the category notification. Approve them first.',
  DISPATCH_ALREADY_SENT:
    '{count} of the selected suppliers have already received this email and will be skipped. Use Retry Failed to re-attempt only the failures.',
  DISPATCH_NOTHING_TO_RETRY: 'There are no failed emails to retry for this session.',
  SESSION_LOAD_FAILED: 'Could not load your ingestion session. Please try again.',
  SESSION_SAVE_FAILED: 'Could not save your ingestion progress. Please try again.',
};

module.exports = {
  VENDOR_INGESTION_SESSION_STATUS,
  VENDOR_INGESTION_STEP,
  VENDOR_INGESTION_HORIZON,
  VENDOR_INGESTION_HORIZON_MONTHS,
  VENDOR_MAPPING_STATUS,
  VENDOR_MAPPING_SOURCE,
  VENDOR_AI_PROCESSING_STATUS,
  VENDOR_INGESTION_AI_STATUS,
  VENDOR_MATCH_STRATEGY,
  VENDOR_DISPATCH_TEMPLATE,
  VENDOR_EMAIL_STATUS,
  VENDOR_DISPATCH_STATUS,
  VENDOR_INGESTION_AUDIT_ACTION,
  VENDOR_CONFIDENCE_BANDS,
  VENDOR_INGESTION_CONFIG,
  VENDOR_INGESTION_MESSAGES,
  ISO_DATE_REGEX,
  ISO_DATE_MESSAGE,
  TIME_HORIZON_TYPES,
  CATEGORY_REVIEW_ACTIONS,
  DISPATCH_TEMPLATES,
  RFQ_SUMMARY_CONFIG,
  BUYER_ACCOUNT_RESOLUTION,
  SOURCING_MODES,
  BUYER_SUBSCRIPTION_PLANS,
  VENDOR_SUBSCRIPTION_PLANS,
  INITIAL_SYSTEM_CONFIG,
  INITIAL_AZURE_HEALTH,
  DATABASE_HEALTH_SERVICE_LABEL,
  SYSTEM_ACTOR_EMAIL,
  RFQ_DEFAULTS,
  QUALIFICATION_PILLARS,
  AES_CONFIG,
  AUTH_MESSAGES,
  IDENTITY_ROLE_MAP,
  IDENTITY_MASTER_DATA,
  IDENTITY_PHONE_CONFIG,
  IDENTITY_OTP_CONFIG,
  BUYER_PROFILE_CONFIG,
  BUYER_PROFILE_MESSAGES,
  formatMessage,
  RFQ_CATEGORY_CLASSIFICATION,
  RFQ_INGESTION_CONFIG,
  RFQ_ATTACHMENT_CONFIG,
  GEMINI_CONFIG,
  GEMINI_INLINE_MIME_TYPES,
  EXTRACTION_REASON_MESSAGES,
  EMAIL_INGESTION_CONFIG,
  EMAIL_INGESTION_STATUS,
  EMAIL_INGESTION_MESSAGES,
  EMAIL_GATEWAY_CONFIG,
  VENDOR_EMAIL_GATEWAY_CONFIG,
  EMAIL_GATEWAY_MESSAGES,
  EMAIL_GATEWAY_STATE,
  EMAIL_GATEWAY_SMTP_PORTS,
  UNAUTHORIZED_BUYER_NOTIFICATION,
  RFQ_ACKNOWLEDGEMENT_NOTIFICATION,
  VENDOR_FREE_CREDITS_LIMIT,
  VENDOR_CREDITS_EXHAUSTED_NOTIFICATION,
  ZOHO_CONFIG,
  ZOHO_SUBSCRIPTION_PRICING,
  computeZohoPlanAmount,
  ZOHO_BUYER_SUBSCRIPTION_PRICING,
  computeZohoBuyerPlanAmount,
  EMAIL_REGEX,
  GSTIN_REGEX,
  GSTIN_MESSAGE,
  PHONE_REGEX,
  INDIAN_MOBILE_REGEX,
  INDIAN_MOBILE_MESSAGE,
  OTP_CODE_REGEX,
  OTP_CODE_MESSAGE,
  PINCODE_REGEX,
  PINCODE_MESSAGE,
  PAN_REGEX,
  PAN_MESSAGE,
  CIN_REGEX,
  CIN_MESSAGE,
  WEBSITE_REGEX,
  WEBSITE_MESSAGE,
  INDIAN_PINCODE_REGEX,
  INDIAN_PINCODE_MESSAGE,
  ORGANIZATION_TYPES,
  PASSWORD_MIN_LENGTH,
  VALIDATION_SCHEMAS,
  validatePayload,
  BUYER_SUBSCRIPTION_TO_SOURCING_MODE,
  resolveBuyerSourcingMode,
};


