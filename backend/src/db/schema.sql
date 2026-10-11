-- ==============================================================================
-- APPLICATION SCHEMA (Neon PostgreSQL) — the single datastore
-- ==============================================================================
-- Neon holds everything: the identity/authentication tables the login module
-- reads, the organisation + procurement-category tables the buyer and category
-- manager modules read and write, and the domain records (vendors, RFQs,
-- evaluations, catalogue, buyer accounts, AI feed, audit logs).
--
-- There is no second database. The MySQL identity pool this backend used to
-- carry alongside Postgres has been removed: authentication now resolves against
-- the `user` table below, and nothing falls back to in-memory seed data when a
-- table is empty — an empty table means no records, which is reported as such.
--
-- Domain tables keep each row's full object verbatim in `raw` (JSONB), which is
-- what storeService.js reads back with zero field-mapping. Identity tables are
-- fully typed instead, because they are queried by column (email lookups, role
-- joins, category filters) rather than loaded wholesale.
-- ==============================================================================

-- ==============================================================================
-- IDENTITY & ACCESS
-- ==============================================================================
-- Application-assigned `uuid` primary keys throughout (no sequences): the rows
-- were migrated from the previously-shared Procucev schema, which assigned them
-- in application code, and existing ids must survive so issued session tokens
-- and every `org_uuid` / `role_uuid` reference stay valid.
--
-- Booleans are real BOOLEANs. The MySQL original used `bit(1)`, which read back
-- as a Buffer and needed a conversion helper on every single row; that helper is
-- gone along with the driver.

CREATE TABLE IF NOT EXISTS role (
  uuid VARCHAR(64) PRIMARY KEY,
  role_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Role lookups are by name (resolveMasterUuid), never by uuid.
CREATE INDEX IF NOT EXISTS idx_role_role_name ON role (role_name);

CREATE TABLE IF NOT EXISTS org_types (
  uuid VARCHAR(64) PRIMARY KEY,
  type_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_types_type_name ON org_types (type_name);

CREATE TABLE IF NOT EXISTS master_status (
  uuid VARCHAR(64) PRIMARY KEY,
  status VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_status_status ON master_status (status);

-- The buyer organisation. Four fields exist twice — `brand_name`/`refference`,
-- `cin`/`crn`, `annual_turnover`/`others`, `contact_designation`/`sub_category`
-- — because the migrated rows populated whichever column the writing client
-- used. Reads prefer the dedicated column and fall back to the legacy alias;
-- writes set both, so no historical row becomes unreadable.
CREATE TABLE IF NOT EXISTS organization (
  uuid VARCHAR(64) PRIMARY KEY,
  organization_name VARCHAR(512) NOT NULL,
  brand_name VARCHAR(512),
  refference VARCHAR(512),
  type VARCHAR(255),
  pan VARCHAR(64),
  gstin VARCHAR(64),
  cin VARCHAR(64),
  crn VARCHAR(64),
  website VARCHAR(512),
  annual_turnover VARCHAR(255),
  others VARCHAR(255),
  address1 VARCHAR(1024),
  city VARCHAR(255),
  state VARCHAR(255),
  zip_code VARCHAR(32),
  country VARCHAR(255) DEFAULT 'India',
  contact_person VARCHAR(255),
  contact_designation VARCHAR(255),
  sub_category VARCHAR(255),
  email VARCHAR(255),
  organization_phonenumber VARCHAR(32),
  org_type_uuid VARCHAR(64),
  client_status_uuid VARCHAR(64),
  self_client BOOLEAN DEFAULT false,
  source_type VARCHAR(16),
  company_id VARCHAR(64),
  gmt_name VARCHAR(255),
  bfs_name VARCHAR(255),
  is_india BOOLEAN DEFAULT true,
  upgrade_days INTEGER DEFAULT 0,
  rfq_credits INTEGER DEFAULT 0,
  rfq_used_count INTEGER DEFAULT 0,
  quote_submitted INTEGER DEFAULT 0,
  created_by VARCHAR(255),
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by VARCHAR(255),
  last_modified_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registration reuses an existing organisation by (name, type).
CREATE INDEX IF NOT EXISTS idx_organization_name_type ON organization (organization_name, org_type_uuid);

-- The login account. `username` holds the login email; `email` is a separate,
-- non-authoritative contact column.
--
-- Deliberately NOT unique on `username`: the migrated data contains repeated
-- login emails across different organisations, so a unique index would have
-- rejected real rows. Every read therefore resolves a single row explicitly
-- (`order by is_active desc, created_ts desc limit 1`) and registration guards
-- for duplicates in application code.
CREATE TABLE IF NOT EXISTS "user" (
  uuid VARCHAR(64) PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  password VARCHAR(255),
  full_name VARCHAR(255),
  first_name VARCHAR(255),
  phone VARCHAR(32),
  org_uuid VARCHAR(64),
  role_uuid VARCHAR(64),
  client_status_uuid VARCHAR(64),
  unique_id VARCHAR(64),
  is_active BOOLEAN NOT NULL DEFAULT true,
  self_client BOOLEAN NOT NULL DEFAULT false,
  is_approved BOOLEAN NOT NULL DEFAULT true,
  reset_password BOOLEAN NOT NULL DEFAULT false,
  is_web_app BOOLEAN NOT NULL DEFAULT true,
  is_whats_app BOOLEAN NOT NULL DEFAULT false,
  is_bot BOOLEAN NOT NULL DEFAULT false,
  source_type VARCHAR(16),
  verification_status VARCHAR(64),
  created_by VARCHAR(255),
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by VARCHAR(255),
  last_modified_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sign-in resolves by lower(username), optionally narrowed by phone, so the
-- index is expression-based to match the predicate exactly.
CREATE INDEX IF NOT EXISTS idx_user_username_lower ON "user" (lower(username));
CREATE INDEX IF NOT EXISTS idx_user_phone ON "user" (phone);
CREATE INDEX IF NOT EXISTS idx_user_org_uuid ON "user" (org_uuid);
CREATE INDEX IF NOT EXISTS idx_user_role_uuid ON "user" (role_uuid);

-- ==============================================================================
-- PROCUREMENT CATEGORY TAXONOMY
-- ==============================================================================
-- `category_division` is the major ("division") / minor ("category") master that
-- every category picker in the app renders. It replaces the two bundled
-- categories.json fixtures the frontend and the ingestion service each used to
-- import: those were duplicate copies of this table with no mechanism to keep
-- them in step, so a taxonomy change landed in one and not the other.
--
-- Division display order is taken from the data (earliest `created_ts` within
-- each division), which is the order the master was originally loaded and the
-- order buyers have always seen — not alphabetical.
CREATE TABLE IF NOT EXISTS category_division (
  uuid VARCHAR(64) PRIMARY KEY,
  division VARCHAR(255),
  category VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_category_division_division ON category_division (division);
CREATE INDEX IF NOT EXISTS idx_category_division_created_ts ON category_division (created_ts);

-- One row per minor category a buyer organisation has selected. Carries both
-- `organization_id` and a denormalised `user_id`: the read path scopes by user
-- (attributing the most recent edit) and falls back to organisation scope for
-- rows written before `user_id` was populated. Writes replace the selection
-- organisation-wide, because a procurement scope belongs to the organisation and
-- the RFQ fan-out reads it organisation-scoped.
CREATE TABLE IF NOT EXISTS org_division_category (
  uuid VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64),
  user_id VARCHAR(64),
  division VARCHAR(255),
  category VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_division_category_org ON org_division_category (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_division_category_user ON org_division_category (user_id);

-- One row per organisation per vendor-onboarding email template
-- ('category_mapped' = Template A / 'self_map_required' = Template B, see
-- mailerService.buildVendorCategoryMappingEmail / buildVendorSelfMappingEmail).
-- A buyer edits the subject/message once here; every future vendor-master
-- upload reuses it. No row for a (organization_id, template_type) pair means
-- the hardcoded default wording is used, so this is purely additive — nothing
-- breaks for a buyer who never opens the settings page.
CREATE TABLE IF NOT EXISTS vendor_dispatch_templates (
  uuid VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64) NOT NULL,
  template_type VARCHAR(32) NOT NULL,
  subject VARCHAR(512),
  message TEXT,
  updated_by VARCHAR(255),
  created_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, template_type)
);

CREATE INDEX IF NOT EXISTS idx_vendor_dispatch_templates_org ON vendor_dispatch_templates (organization_id);

-- ==============================================================================
-- SESSION STATE
-- ==============================================================================
-- Issued OTP codes and revoked session tokens used to live in a module-level Map
-- and Set. That made them per-process: a restart silently invalidated every
-- pending OTP, and with more than one worker a code issued by one process could
-- not be verified by another, while a token revoked on one worker stayed valid on
-- the rest — logout did not actually log the session out. Both now live here.

CREATE TABLE IF NOT EXISTS auth_otp_codes (
  -- `<normalisedPhone>_EMAIL_<lowercased email>`: keying on the pair means a code
  -- issued for one registered mobile cannot be replayed against another.
  otp_key VARCHAR(320) PRIMARY KEY,
  code VARCHAR(16) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the expiry sweep.
CREATE INDEX IF NOT EXISTS idx_auth_otp_codes_expires_at ON auth_otp_codes (expires_at);

CREATE TABLE IF NOT EXISTS auth_revoked_tokens (
  -- The token's signature segment, not the whole token: it is unique per token
  -- and is what verification already compares, so storing the payload too would
  -- persist the session's claims for no benefit.
  signature VARCHAR(255) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A revoked entry can be dropped once the token would have expired anyway.
CREATE INDEX IF NOT EXISTS idx_auth_revoked_tokens_expires_at ON auth_revoked_tokens (expires_at);

-- ==============================================================================
-- DOMAIN RECORDS
-- ==============================================================================
-- JSONB-first: a handful of typed columns exist alongside `raw` only where a
-- lookup or uniqueness constraint is actually needed; every other field lives in
-- `raw` alone.

CREATE TABLE IF NOT EXISTS vendors (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  major_category VARCHAR(255),
  status VARCHAR(100),
  source VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_email ON vendors (email);
CREATE INDEX IF NOT EXISTS idx_vendors_major_category ON vendors (major_category);
-- Default listing/pagination sort (getVendorsPageFromDB's ORDER BY created_at
-- DESC LIMIT/OFFSET) — without this, every "Load more" page at 600k+ rows
-- requires a full sort of the whole table.
CREATE INDEX IF NOT EXISTS idx_vendors_created_at ON vendors (created_at DESC);

-- getVendorsPageFromDB's vendor search matches `ILIKE '%term%'` — a leading
-- wildcard, which a plain btree index (idx_vendors_email/major_category
-- above) cannot accelerate at all, forcing a sequential scan of the whole
-- table on every keystroke once the directory reaches 600k+ rows (the real
-- vendor-master-import scale). pg_trgm's trigram GIN indexes are what make a
-- substring ILIKE use an index instead.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_vendors_email_trgm ON vendors USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_vendors_major_category_trgm ON vendors USING gin (major_category gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_vendors_name_trgm ON vendors USING gin ((raw->>'name') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_vendors_minor_categories_trgm ON vendors USING gin (((raw->'minorCategories')::text) gin_trgm_ops);

-- getVendorsPageFromDB's scopedBuyerId clause (public-or-mine) matches on
-- these two fields inside `raw` — without an expression index, that OR
-- forces a full-table JSONB scan on every buyer's own paginated vendor list.
CREATE INDEX IF NOT EXISTS idx_vendors_raw_buyer_id ON vendors ((raw->>'buyerId'));
CREATE INDEX IF NOT EXISTS idx_vendors_raw_buyer_account_id ON vendors ((raw->>'buyerAccountId'));

CREATE TABLE IF NOT EXISTS rfqs (
  id VARCHAR(64) PRIMARY KEY,
  rfq_number VARCHAR(100) UNIQUE,
  category VARCHAR(255),
  status VARCHAR(50),
  sourcing_mode VARCHAR(50),
  budget NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rfqs_rfq_number ON rfqs (rfq_number);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs (status);
CREATE INDEX IF NOT EXISTS idx_rfqs_sourcing_mode ON rfqs (sourcing_mode);

CREATE TABLE IF NOT EXISTS evaluations (
  id VARCHAR(64) PRIMARY KEY,
  vendor_id VARCHAR(64),
  status VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evaluations_vendor_id ON evaluations (vendor_id);

CREATE TABLE IF NOT EXISTS vendor_catalogue (
  id VARCHAR(64) PRIMARY KEY,
  -- Nullable only because historical rows may predate vendor attribution. Every
  -- product added through addProductToCatalogue supplies one; the three demo
  -- products that used to be hardcoded in storeService's constructor and
  -- deliberately never persisted here are gone.
  vendor_id VARCHAR(64),
  sku VARCHAR(100),
  category VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_catalogue_vendor_id ON vendor_catalogue (vendor_id);

CREATE TABLE IF NOT EXISTS buyer_accounts (
  id VARCHAR(64) PRIMARY KEY,
  corporate_email VARCHAR(255) UNIQUE,
  status VARCHAR(100),
  -- activeBuyerAccount is a pointer into this same table, not a separate
  -- record — exactly one row should carry is_active=true at a time.
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buyer_accounts_corporate_email ON buyer_accounts (corporate_email);

CREATE TABLE IF NOT EXISTS ai_feed (
  id VARCHAR(64) PRIMARY KEY,
  -- Ordering must be exact insertion order — addAIFeedItem's 100-item cap and
  -- any future reads depend on it. created_at alone risks same-instant ties;
  -- a monotonic sequence guarantees correct ordering regardless.
  sequence BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_feed_sequence ON ai_feed (sequence);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  -- This is a SHA-256 hash chain (auditService.js) — each entry's previousHash
  -- must equal the immediately-prior entry's own hash. Reconstructing exact
  -- insertion order on hydration is load-bearing for tamper-chain verification,
  -- not just cosmetic like it is for vendors/rfqs, hence the same monotonic
  -- sequence approach as ai_feed rather than relying on created_at ordering.
  sequence BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_sequence ON audit_logs (sequence);

-- In-app notifications. One row per (recipient, event): a vendor is notified
-- when an RFQ is raised in a category they cover; the RFQ's owning buyer is
-- notified when a vendor submits a quote against it. `recipient_type` +
-- `recipient_id` is what the authenticated GET /api/notifications scopes by —
-- recipient_id is a vendors.id for a vendor recipient and a buyer_accounts.id
-- for a buyer recipient (the Neon buyer-account id, NOT the identity-schema
-- organisation id). `sequence` gives a stable newest-first order the same way
-- ai_feed/audit_logs do; created_at alone risks same-instant ties on the fan-out
-- insert that raises one notification per matched vendor.
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  recipient_type VARCHAR(16) NOT NULL,
  recipient_id VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  rfq_id VARCHAR(64),
  is_read BOOLEAN NOT NULL DEFAULT false,
  sequence BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sequence ON notifications (sequence);

-- ==============================================================================
-- EMAIL INGESTION GATEWAY LOG
-- ==============================================================================
-- One row per inbound message the autonomous gateway has considered, keyed by the
-- message's own RFC822 Message-ID.
--
-- This exists to make ingestion idempotent. The poller reads a mailbox on an
-- interval, and marking a message seen over IMAP is not a reliable guard on its
-- own: the mark can fail after the RFQ has been created, another client can clear
-- it, and a re-delivered or manually re-flagged message would then be ingested a
-- second time. Duplicate RFQs reach vendors, so the check has to be ours and it
-- has to be indexed — rfqs.raw is JSONB and cannot serve as a dedupe key.
--
-- Rejected and failed messages are recorded too, not just successes. Without that
-- a refused sender is retried on every poll for as long as the message sits in the
-- mailbox, and there is no way to answer "why was that requisition never raised".
CREATE TABLE IF NOT EXISTS email_ingestion_log (
  -- The full Message-ID including angle brackets, as it appears on the wire.
  message_id VARCHAR(512) PRIMARY KEY,
  -- Populated only when the message produced an RFQ.
  rfq_id VARCHAR(64),
  rfq_number VARCHAR(100),
  from_address VARCHAR(320),
  subject TEXT,
  -- INGESTED | SENDER_NOT_ALLOWED | NO_LINE_ITEMS | UNREADABLE | FAILED
  status VARCHAR(40) NOT NULL,
  -- Human-readable reason, shown in the gateway panel so a skipped requisition
  -- can be explained without reading the server log.
  detail TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_ingestion_log_processed_at ON email_ingestion_log (processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_ingestion_log_status ON email_ingestion_log (status);

-- Real Zoho Payments integration for vendor subscription upgrades, ported from
-- the reference p2pservices Java app's zoho_oauth_token/payment_links tables.

-- Single-row cache of the current OAuth access token (refreshed from the one
-- long-lived refresh token in ZOHO_CONFIG, not stored here). Typed rather than
-- JSONB — this is infrastructure state, not a domain record.
CREATE TABLE IF NOT EXISTS zoho_oauth_token (
  id VARCHAR(32) PRIMARY KEY DEFAULT 'default',
  access_token TEXT,
  expiry_time TIMESTAMPTZ,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- vendor_id/buyer_account_id are both nullable: a link is one or the other,
-- never both, distinguished by payer_type. Kept as two columns rather than one
-- polymorphic "payer_id" so each still gets its own indexed, typed lookup.
CREATE TABLE IF NOT EXISTS payment_links (
  id VARCHAR(64) PRIMARY KEY,
  zoho_payment_link_id VARCHAR(128) UNIQUE,
  vendor_id VARCHAR(64),
  buyer_account_id VARCHAR(64),
  payer_type VARCHAR(10) NOT NULL DEFAULT 'vendor',
  status VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_links_vendor_id ON payment_links (vendor_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_buyer_account_id ON payment_links (buyer_account_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links (status);
-- NOTE: `payment_links` shipped earlier today as vendor-only (vendor_id NOT
-- NULL, no payer_type/buyer_account_id). schema.sql only ever CREATEs — it is
-- applied automatically against the live DB, so it must never ALTER or DROP.
-- The already-created table on every environment that ran the earlier version
-- was brought up to this shape with a one-off manual ALTER (same convention as
-- backend/scripts/transfer-neon.js — a real structural change applied by hand,
-- once, outside the automatic migrate flow). A brand new environment gets this
-- shape for free from the CREATE TABLE above; nothing further is needed there.

-- ============================================================================
-- VENDOR MASTER & PO DATA INGESTION (Buyer module)
-- ============================================================================
-- A buyer uploads their Vendor Master and their historical PO purchase dump as
-- two separate files, the PO history is joined onto the vendor master, and the
-- joined purchasing profile — not the company name — is what the AI categoriser
-- reads. Everything below is scoped by organization_id and every read filters
-- on it: one buyer must never see another buyer's vendor master or spend.
--
-- These are typed tables rather than the `raw JSONB` domain style used by
-- vendors/rfqs, because every column here is something the module filters,
-- aggregates or joins on (horizon dates, vendor code, GSTIN, spend, status).
-- A `raw` column is still carried for the untouched source row, so an operator
-- can always see exactly what the spreadsheet said.
--
-- Reminder (same rule as the rest of this file): only CREATE ... IF NOT EXISTS.
-- Never ALTER, never DROP — this runs automatically against the live database.

-- One ingestion run. Holds the selected time horizon and the per-step progress
-- so a buyer who navigates away resumes exactly where they left off rather than
-- restarting from the file pickers.
CREATE TABLE IF NOT EXISTS vendor_ingestion_sessions (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64) NOT NULL,
  created_by_user_id VARCHAR(64),
  created_by_email VARCHAR(320),
  -- DRAFT | VENDOR_MASTER_STORED | PO_STORED | JOINED | AI_COMPLETED | DISPATCHED
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  -- Furthest step the buyer has legitimately reached (1..5). Forward jumps are
  -- refused server-side, so this is the authority, not the client's useState.
  current_step SMALLINT NOT NULL DEFAULT 1,
  -- LAST_1_YEAR | LAST_2_YEARS | LAST_3_YEARS | CUSTOM. The concrete range is
  -- always resolved and stored, even for the predefined options, so a session
  -- re-read months later still reports the window the PO filter actually used.
  horizon_type VARCHAR(16),
  horizon_start DATE,
  horizon_end DATE,
  vendor_master_file_name VARCHAR(512),
  vendor_master_row_count INTEGER NOT NULL DEFAULT 0,
  po_file_name VARCHAR(512),
  po_row_count INTEGER NOT NULL DEFAULT 0,
  po_in_horizon_count INTEGER NOT NULL DEFAULT 0,
  po_outside_horizon_count INTEGER NOT NULL DEFAULT 0,
  matched_vendor_count INTEGER NOT NULL DEFAULT 0,
  unmatched_vendor_count INTEGER NOT NULL DEFAULT 0,
  -- IDLE | QUEUED | PROCESSING | COMPLETED | FAILED — persisted so a large AI
  -- job survives the browser closing and the UI can reattach to its progress.
  ai_status VARCHAR(20) NOT NULL DEFAULT 'IDLE',
  ai_processed_count INTEGER NOT NULL DEFAULT 0,
  ai_total_count INTEGER NOT NULL DEFAULT 0,
  ai_failed_count INTEGER NOT NULL DEFAULT 0,
  ai_started_at TIMESTAMPTZ,
  ai_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB
);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_sessions_org ON vendor_ingestion_sessions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_sessions_status ON vendor_ingestion_sessions (status);

-- Persistent background ingestion jobs for Vendor Master and PO Dump
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  job_type VARCHAR(32) NOT NULL, -- 'VENDOR_MASTER' | 'PO_DUMP'
  file_name VARCHAR(512),
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  total_records INTEGER NOT NULL DEFAULT 0,
  processed_records INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0,
  skipped_records INTEGER NOT NULL DEFAULT 0,
  failed_records INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  error_details JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_session ON ingestion_jobs (session_id, job_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_org ON ingestion_jobs (organization_id, status);

-- File 1: the buyer's vendor master. normalized_name is the pre-computed
-- fallback match key (lowercased, legal suffixes and punctuation stripped) so
-- the name-based join is an indexed equality test rather than a per-row scan.
CREATE TABLE IF NOT EXISTS vendor_master_records (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  source_row_number INTEGER,
  vendor_code VARCHAR(120),
  company_name VARCHAR(512) NOT NULL,
  normalized_name VARCHAR(512),
  contact_person VARCHAR(255),
  email VARCHAR(320),
  phone VARCHAR(64),
  address VARCHAR(1024),
  gstin VARCHAR(64),
  -- 0..100, optional in the sheet and therefore nullable here. Never defaulted:
  -- an unrated supplier must not arrive carrying a score nobody assessed.
  rating NUMERIC(5, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB,
  -- Re-confirming the same file replaces rather than duplicates its rows.
  CONSTRAINT uq_vendor_master_session_code UNIQUE (session_id, vendor_code)
);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_session ON vendor_master_records (session_id);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_org ON vendor_master_records (organization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_code ON vendor_master_records (organization_id, vendor_code);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_gstin ON vendor_master_records (organization_id, gstin);
CREATE INDEX IF NOT EXISTS idx_vendor_master_records_norm_name ON vendor_master_records (organization_id, normalized_name);

-- File 2: historical PO line items. in_horizon is stamped at confirm time from
-- the session's resolved window, so every later read (the AI aggregation, the
-- spend rollups, the match summary) filters on one indexed boolean instead of
-- re-deriving the date maths and risking two code paths disagreeing.
CREATE TABLE IF NOT EXISTS po_line_items (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  source_row_number INTEGER,
  po_number VARCHAR(120),
  po_date DATE,
  vendor_code VARCHAR(120),
  vendor_name VARCHAR(512),
  normalized_vendor_name VARCHAR(512),
  vendor_gstin VARCHAR(64),
  item_description TEXT,
  specification TEXT,
  quantity NUMERIC(18, 3),
  uom VARCHAR(64),
  spend NUMERIC(18, 2),
  currency VARCHAR(8),
  department VARCHAR(255),
  material_code VARCHAR(120),
  existing_category VARCHAR(255),
  existing_subcategory VARCHAR(255),
  in_horizon BOOLEAN NOT NULL DEFAULT true,
  -- Filled by the join step. VENDOR_CODE | GSTIN | NORMALIZED_NAME | UNMATCHED.
  matched_vendor_record_id VARCHAR(64),
  match_strategy VARCHAR(24),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB
);
CREATE INDEX IF NOT EXISTS idx_po_line_items_session ON po_line_items (session_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_org ON po_line_items (organization_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_horizon ON po_line_items (session_id, in_horizon);
CREATE INDEX IF NOT EXISTS idx_po_line_items_matched ON po_line_items (session_id, matched_vendor_record_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_vendor_code ON po_line_items (organization_id, vendor_code);

-- The AI suggestion and the buyer's decision are deliberately separate columns.
-- Approving or editing never overwrites what the model proposed, so the trail
-- always shows what was suggested, what was saved, and who changed it.
CREATE TABLE IF NOT EXISTS vendor_category_mappings (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  vendor_record_id VARCHAR(64) NOT NULL,
  vendor_code VARCHAR(120),
  company_name VARCHAR(512),
  email VARCHAR(320),
  -- Set once the supplier is empanelled into `vendors`, so the buyer dashboard
  -- can join a mapping onto the live vendor row it produced.
  vendor_id VARCHAR(64),
  ai_major_category VARCHAR(255),
  ai_minor_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_relevant_products JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_confidence NUMERIC(5, 2),
  ai_reason TEXT,
  ai_model VARCHAR(120),
  buyer_major_category VARCHAR(255),
  buyer_minor_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- AI | BUYER | SELF_MAPPED
  source VARCHAR(16),
  -- PENDING_REVIEW | AI_MAPPED | BUYER_APPROVED | SELF_MAP_REQUIRED |
  -- SELF_MAPPED | REJECTED | NEW_CATEGORY_SUGGESTION | FAILED
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW',
  -- QUEUED | PROCESSING | COMPLETED | FAILED — per-vendor AI job state, so a
  -- partial failure can be retried for exactly the vendors that failed.
  processing_status VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  processing_error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  po_count INTEGER NOT NULL DEFAULT 0,
  total_spend NUMERIC(18, 2) NOT NULL DEFAULT 0,
  has_po_history BOOLEAN NOT NULL DEFAULT false,
  -- True when the model could not place the supplier inside the buyer's own
  -- category master. Requires buyer review; never auto-creates a category.
  is_new_category_suggestion BOOLEAN NOT NULL DEFAULT false,
  suggested_new_category VARCHAR(255),
  reviewed_by VARCHAR(320),
  reviewed_at TIMESTAMPTZ,
  -- APPROVED | EDITED | REJECTED | RE_RAN_AI
  review_action VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB,
  CONSTRAINT uq_vendor_category_mapping UNIQUE (session_id, vendor_record_id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_session ON vendor_category_mappings (session_id);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_org ON vendor_category_mappings (organization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_status ON vendor_category_mappings (session_id, status);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_processing ON vendor_category_mappings (session_id, processing_status);
CREATE INDEX IF NOT EXISTS idx_vendor_category_mappings_major ON vendor_category_mappings (organization_id, buyer_major_category);

-- One "send this template to these vendors" campaign.
CREATE TABLE IF NOT EXISTS vendor_category_dispatches (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  -- CATEGORY_MAPPED | SELF_MAP_REQUIRED | GENERAL_ONBOARDING
  template VARCHAR(40) NOT NULL,
  major_category VARCHAR(255),
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  -- QUEUED | COMPLETED | PARTIAL | FAILED
  status VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
  dispatched_by VARCHAR(320),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB
);
CREATE INDEX IF NOT EXISTS idx_vendor_category_dispatches_session ON vendor_category_dispatches (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_category_dispatches_org ON vendor_category_dispatches (organization_id);

-- Per-recipient send ledger. idempotency_key is the whole duplicate-send
-- defence: it is UNIQUE, so a double-clicked Dispatch, a retried request or a
-- re-run campaign cannot mail the same vendor the same template twice. A retry
-- updates the existing row rather than inserting a second one, which is also
-- why a successful send can never be re-sent by "retry failed".
CREATE TABLE IF NOT EXISTS vendor_email_dispatch_log (
  id VARCHAR(64) PRIMARY KEY,
  dispatch_id VARCHAR(64),
  session_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  vendor_record_id VARCHAR(64),
  recipient_email VARCHAR(320) NOT NULL,
  recipient_name VARCHAR(512),
  template VARCHAR(40) NOT NULL,
  major_category VARCHAR(255),
  idempotency_key VARCHAR(512) NOT NULL UNIQUE,
  -- PENDING | QUEUED | SENT | FAILED | DELIVERED | BOUNCED
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  message_id VARCHAR(512),
  detail TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_email_dispatch_log_session ON vendor_email_dispatch_log (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_email_dispatch_log_dispatch ON vendor_email_dispatch_log (dispatch_id);
CREATE INDEX IF NOT EXISTS idx_vendor_email_dispatch_log_status ON vendor_email_dispatch_log (session_id, status);
CREATE INDEX IF NOT EXISTS idx_vendor_email_dispatch_log_org ON vendor_email_dispatch_log (organization_id);

-- Module audit trail. Separate from `audit_logs` (which is a hash-chained
-- action log keyed on an actor and an RFQ number) because every entry here
-- needs entity_type/entity_id plus the before/after values of a category
-- change, which that shape cannot carry. Both are written: this one for the
-- module's own reviewable history, `audit_logs` for the tamper-evident chain.
CREATE TABLE IF NOT EXISTS vendor_ingestion_audit (
  id VARCHAR(64) PRIMARY KEY,
  sequence BIGSERIAL,
  session_id VARCHAR(64),
  organization_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64),
  user_email VARCHAR(320),
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(48),
  entity_id VARCHAR(64),
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_audit_session ON vendor_ingestion_audit (session_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_audit_org ON vendor_ingestion_audit (organization_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_ingestion_audit_action ON vendor_ingestion_audit (action);

-- Every AI classification attempt, including the failures. The prompt itself is
-- deliberately NOT stored — only its length — because it embeds the buyer's
-- category master and spend detail, and this table is read by support tooling.
CREATE TABLE IF NOT EXISTS ai_classification_logs (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  vendor_record_id VARCHAR(64),
  vendor_code VARCHAR(120),
  model VARCHAR(120),
  -- SUCCESS | INVALID_RESPONSE | AI_FAILED | NOT_CONFIGURED | NO_CONTENT
  status VARCHAR(24) NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  prompt_chars INTEGER,
  po_count INTEGER,
  duration_ms INTEGER,
  error TEXT,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_session ON ai_classification_logs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_vendor ON ai_classification_logs (vendor_record_id);
CREATE INDEX IF NOT EXISTS idx_ai_classification_logs_status ON ai_classification_logs (status);

-- ============================================================================
-- CM BULK VENDOR IMPORT (Category Manager module)
-- ============================================================================
-- A single "upload the whole marketplace directory" run, potentially hundreds
-- of thousands of rows sent up in many chunked HTTP requests from the
-- browser. Without a persisted running total, a dropped tab/connection partway
-- through has no way to report (or resume from) where it actually got to —
-- every chunk response only knew about itself. One row per run; every chunk
-- request increments its counters instead of the frontend guessing a total
-- from its own request count.
CREATE TABLE IF NOT EXISTS bulk_vendor_import_sessions (
  id VARCHAR(64) PRIMARY KEY,
  created_by_email VARCHAR(320),
  -- IN_PROGRESS | COMPLETED
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
  total_rows_declared INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  missing_email_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bulk_vendor_import_sessions_status ON bulk_vendor_import_sessions (status);

-- ============================================================================
-- VENDOR RFQ UNLOCKS & CREDIT TRANSACTIONS (V0 Free Starter & Entitlements)
-- ============================================================================
CREATE TABLE IF NOT EXISTS rfq_unlocks (
  id VARCHAR(64) PRIMARY KEY,
  vendor_id VARCHAR(64) NOT NULL,
  rfq_id VARCHAR(64) NOT NULL,
  credit_charged INTEGER NOT NULL DEFAULT 1,
  source VARCHAR(50) DEFAULT 'free_credit',
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_rfq_unlocks_vendor_rfq UNIQUE (vendor_id, rfq_id)
);
CREATE INDEX IF NOT EXISTS idx_rfq_unlocks_vendor ON rfq_unlocks (vendor_id);
CREATE INDEX IF NOT EXISTS idx_rfq_unlocks_rfq ON rfq_unlocks (rfq_id);

CREATE TABLE IF NOT EXISTS vendor_credit_transactions (
  id VARCHAR(64) PRIMARY KEY,
  vendor_id VARCHAR(64) NOT NULL,
  rfq_id VARCHAR(64),
  transaction_type VARCHAR(50) NOT NULL, -- 'INITIAL_ALLOCATION' | 'RFQ_UNLOCK' | 'SUBSCRIPTION_UPGRADE'
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  idempotency_key VARCHAR(512) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_credit_transactions_vendor ON vendor_credit_transactions (vendor_id, created_at DESC);

