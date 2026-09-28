import type {
  SourcingModeDetail,
  SystemConfig,
  AzureServiceHealth,
  SidebarNavItem,
  RoleWorkspaceMeta,
  UserRole,
  OrganizationType,
  SourcingMode,
} from './types';
import { UI_STRINGS } from './uiStrings';

export const SOURCING_MODES: SourcingModeDetail[] = [
  {
    id: 'mode_1',
    code: 'Version 1',
    name: 'Version 1: Client Roster Sourcing Plan',
    shortLabel: 'Version 1',
    description:
      'Private empanelled vendor network. RFQs are strictly circulated only to your pre-verified approved vendor list.',
    featureSummary: 'Private buyer roster only (Features of Version 1)',
    badgeColor: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10',
  },
  {
    id: 'mode_2',
    code: 'Version 2',
    name: 'Version 2: Hybrid Sourcing Plan',
    shortLabel: 'Version 2',
    description:
      'Circulate to your private empanelled list first. If quotes or responses are insufficient, AI expands to Procucev Base Network.',
    featureSummary: 'Buyer roster + Procucev Hybrid pool (Features of Version 1 & 2)',
    badgeColor: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10',
  },
  {
    id: 'mode_3',
    code: 'Version 3',
    name: 'Version 3: AI Autonomous Sourcing Plan',
    shortLabel: 'Version 3',
    description:
      'Autonomous Procucev Network Sourcing with double-blind supplier identity shielding, continuous AI evaluation, and best-fit routing.',
    featureSummary: 'Autonomous AI + 360° Qualification (Features of Version 1, 2 & 3)',
    badgeColor: 'border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10',
  },
];

/**
 * Mapping between buyer subscription plans and their corresponding RFQ sourcing / version mode.
 * - version_1: mode_1 (Version 1: Client Roster Sourcing Plan)
 * - version_2: mode_2 (Version 2: Hybrid Sourcing Plan)
 * - version_3: mode_3 (Version 3: AI Autonomous Sourcing Plan)
 */
export const BUYER_SUBSCRIPTION_TO_SOURCING_MODE: Record<string, SourcingMode> = {
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
 * Defaults to Version 2 ('mode_2').
 *
 * @param buyerAccountOrPlan - Buyer account object or subscription plan string
 * @returns Sourcing mode ('mode_1' | 'mode_2' | 'mode_3')
 */
export function resolveBuyerSourcingMode(
  buyerAccountOrPlan?: { subscriptionPlan?: string } | string | null
): SourcingMode {
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

  return 'mode_2';
}

/**
 * Mirrors backend/src/controllers/rfqController.js's SUBSCRIPTION_MODE_ENTITLEMENTS
 * exactly: each paid tier adds one mode on top of the last. The backend already
 * enforces this on POST /api/rfqs (a request for an un-entitled mode 403s), so
 * this is UI-side only — it stops a buyer from picking a mode they cannot use
 * and then hitting a rejection after filling out the whole form, rather than
 * being the source of truth for access control.
 */
export const SUBSCRIPTION_MODE_ENTITLEMENTS: Record<string, SourcingMode[]> = {
  free_trial: ['mode_1', 'mode_2', 'mode_3'],
  version_1: ['mode_1'],
  version_2: ['mode_1', 'mode_2'],
  version_3: ['mode_1', 'mode_2', 'mode_3'],
};

/**
 * Sourcing modes a buyer's subscription plan actually entitles them to use.
 *
 * A missing/unresolved plan (no activeBuyerAccount loaded yet, or a buyer
 * with no domain buyer_accounts row at all — a real gap seen in practice)
 * defaults to the most restrictive tier, not to "show everything." This used
 * to fail open on the reasoning that "a real buyer account always carries an
 * explicit subscriptionPlan" — but that assumption doesn't hold: an
 * authenticated buyer session can genuinely have no resolvable plan (a
 * missing/not-yet-created buyer_accounts record), and failing open there is
 * exactly the free-upgrade bypass this gate exists to prevent. The backend
 * still re-checks entitlement server-side regardless (POST /api/rfqs 403s
 * for an un-entitled mode), so this stays a UI convenience layer either way —
 * it just now fails closed instead of open.
 */
export function entitledSourcingModes(subscriptionPlan?: string | null): SourcingMode[] {
  // Neither branch routes through 'free_trial': free_trial itself now grants
  // all three modes (a later, deliberate change), so falling back to it for
  // either a missing OR an unrecognised plan string would reopen the exact
  // free-upgrade bypass this fail-closed default exists to prevent.
  if (!subscriptionPlan) return SUBSCRIPTION_MODE_ENTITLEMENTS.version_1;
  const plan = subscriptionPlan.trim().toLowerCase();
  return SUBSCRIPTION_MODE_ENTITLEMENTS[plan] || SUBSCRIPTION_MODE_ENTITLEMENTS.version_1;
}

export const BUYER_SUBSCRIPTION_PLANS = [
  {
    id: 'buyer_starter',
    name: 'Starter Enterprise',
    rfqLimit: 50,
    pricePerMonth: 4999,
    features: ['Up to 50 active RFQs', 'Standard AI Chaser', 'Single Buyer Console'],
  },
  {
    id: 'buyer_growth',
    name: 'Growth Enterprise',
    rfqLimit: 250,
    pricePerMonth: 14999,
    features: ['Up to 250 active RFQs', 'Multi-channel Voice & WhatsApp', 'Category Governance'],
  },
  {
    id: 'buyer_custom',
    name: 'Unlimited Enterprise',
    rfqLimit: 99999,
    pricePerMonth: 49999,
    features: ['Unlimited RFQs', 'Dedicated Azure HSM Instance', 'Custom ERP Integrations'],
  },
];

export const VENDOR_SUBSCRIPTION_PLANS = [
  {
    id: 'vendor_standard',
    name: 'Verified Supplier',
    pricePerMonth: 1999,
    bidLimit: 30,
    features: ['30 Quote Submissions / Month', 'Direct Telemetry Feedback'],
  },
  {
    id: 'vendor_premium',
    name: 'Preferred Partner',
    pricePerMonth: 5999,
    bidLimit: 99999,
    features: ['Unlimited Quote Submissions', 'Top-tier AI Matching Priority', 'Dedicated Account Manager'],
  },
];

export const INITIAL_SYSTEM_CONFIG: SystemConfig = {
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

export const INITIAL_AZURE_HEALTH: AzureServiceHealth[] = [
  {
    service: 'Azure PostgreSQL Flexible Server (Neon Pooler)',
    status: 'ONLINE',
    latency: '18ms',
    uptime: '99.99%',
    details: 'Read/Write Active, SSL Require, Automated HA Clustering',
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

export const AES_CONFIG = {
  ALGORITHM: 'AES-GCM',
  KEY_LENGTH_BITS: 256,
  IV_LENGTH_BYTES: 12,
  TAG_LENGTH_BITS: 128,
  SALT_LENGTH_BYTES: 16,
  PBKDF2_ITERATIONS: 100000,
  VERSION: 'v1',
  SERIALIZATION_PREFIX: 'enc:v1:aes-256-gcm:',
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Sidebar Dashboard Navigation Configuration
 * ═══════════════════════════════════════════════════════════════════════
 * Declarative per-role module registry driving the collapsible workspace
 * sidebar. Icons are referenced by key so this module stays pure data and
 * free of React/JSX imports; labels resolve from the centralized
 * `UI_STRINGS` dictionary to remain i18n-ready.
 */
const NAV_ITEMS = UI_STRINGS.navigation.items;
const NAV_GROUPS = UI_STRINGS.navigation.groups;

export const ROLE_WORKSPACE_META: Record<UserRole, RoleWorkspaceMeta> = {
  buyer: {
    accentText: 'text-indigo-600 dark:text-indigo-400',
    accentActive: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30',
    accentRing: 'group-hover:border-indigo-400 dark:group-hover:border-indigo-600',
  },
  category_manager: {
    accentText: 'text-sky-600 dark:text-sky-400',
    accentActive: 'bg-sky-600 text-white shadow-sm shadow-sky-600/30',
    accentRing: 'group-hover:border-sky-400 dark:group-hover:border-sky-600',
  },
  vendor: {
    accentText: 'text-emerald-600 dark:text-emerald-400',
    accentActive: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30',
    accentRing: 'group-hover:border-emerald-400 dark:group-hover:border-emerald-600',
  },
  admin: {
    accentText: 'text-purple-600 dark:text-purple-400',
    accentActive: 'bg-purple-600 text-white shadow-sm shadow-purple-600/30',
    accentRing: 'group-hover:border-purple-400 dark:group-hover:border-purple-600',
  },
};

export const ROLE_SIDEBAR_NAV: Record<UserRole, SidebarNavItem[]> = {
  buyer: [
    {
      id: 'command_center',
      screenTag: 'Screen 1.1',
      label: NAV_ITEMS.commandCenter.label,
      description: NAV_ITEMS.commandCenter.description,
      icon: 'Layers',
      group: NAV_GROUPS.buyerSourcing,
      route: '/buyer/dashboard',
    },
    {
      id: 'ingestion_wizard',
      screenTag: 'Screen 1.2',
      label: NAV_ITEMS.ingestionWizard.label,
      description: NAV_ITEMS.ingestionWizard.description,
      icon: 'FileSpreadsheet',
      group: NAV_GROUPS.buyerSourcing,
      route: '/buyer/ingestion-wizard',
    },
    {
      id: 'rfq_summary',
      screenTag: 'Screen 1.3',
      label: NAV_ITEMS.rfqSummary.label,
      description: NAV_ITEMS.rfqSummary.description,
      icon: 'ClipboardList',
      group: NAV_GROUPS.buyerSourcing,
      route: '/buyer/rfq-summary',
    },
    {
      id: 'vendor_evaluation_summary',
      screenTag: 'Screen 1.4',
      label: NAV_ITEMS.buyerEvaluationSummary.label,
      description: NAV_ITEMS.buyerEvaluationSummary.description,
      icon: 'FileCheck',
      group: NAV_GROUPS.buyerEvaluation,
      route: '/buyer/vendor-evaluation-summary',
    },
    {
      id: 'vendor_summary',
      screenTag: 'Screen 1.5',
      label: NAV_ITEMS.vendorDirectory.label,
      description: NAV_ITEMS.vendorDirectory.description,
      icon: 'Building2',
      group: NAV_GROUPS.buyerEvaluation,
      route: '/buyer/vendor-summary',
    },
    {
      id: 'subscription_center',
      screenTag: 'Screen 1.6',
      label: NAV_ITEMS.sourcingSubscriptions.label,
      description: NAV_ITEMS.sourcingSubscriptions.description,
      icon: 'Sparkles',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/subscription-center',
    },
    {
      id: 'buyer_profile',
      screenTag: 'Screen 1.8',
      label: NAV_ITEMS.buyerProfile.label,
      description: NAV_ITEMS.buyerProfile.description,
      icon: 'Building2',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/profile',
    },
    {
      id: 'buyer_billing_history',
      screenTag: 'Screen 1.9',
      label: NAV_ITEMS.billingHistory.label,
      description: NAV_ITEMS.billingHistory.description,
      icon: 'Receipt',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/billing-history',
    },
    // Temporarily hidden: Buyer DB Sync
    /*
    {
      id: 'buyer_directory',
      screenTag: 'Screen 1.8',
      label: NAV_ITEMS.buyerDbSync.label,
      description: NAV_ITEMS.buyerDbSync.description,
      icon: 'Database',
      group: NAV_GROUPS.buyerAccount,
      route: '/buyer/buyer-directory',
    },
    */
  ],
  category_manager: [
    {
      id: 'kanban_board',
      screenTag: 'Screen 2.1',
      shortTag: '2.1',
      label: NAV_ITEMS.operationalKanban.label,
      description: NAV_ITEMS.operationalKanban.description,
      icon: 'Kanban',
      group: NAV_GROUPS.categoryOperations,
      route: '/category-manager/kanban-board',
    },
    {
      id: 'spend_dashboard',
      screenTag: 'Screen 2.2',
      shortTag: '2.2',
      label: NAV_ITEMS.spendAnalytics.label,
      description: NAV_ITEMS.spendAnalytics.description,
      icon: 'TrendingUp',
      group: NAV_GROUPS.categoryOperations,
      route: '/category-manager/spend-dashboard',
    },
    {
      id: 'buyer_console',
      screenTag: 'Screen 2.3',
      shortTag: '2.3',
      label: NAV_ITEMS.buyerRfqConsole.label,
      description: NAV_ITEMS.buyerRfqConsole.description,
      icon: 'Building2',
      group: NAV_GROUPS.categoryConsoles,
      route: '/category-manager/buyer-console',
    },
    {
      id: 'vendor_evaluation_summary',
      screenTag: 'Screen 2.4',
      shortTag: '2.4',
      label: NAV_ITEMS.modeEvaluations.label,
      description: NAV_ITEMS.modeEvaluations.description,
      icon: 'FileCheck',
      group: NAV_GROUPS.categoryConsoles,
      route: '/category-manager/vendor-evaluation-summary',
    },
    {
      id: 'vendor_console',
      screenTag: 'Screen 2.5',
      shortTag: '2.5',
      label: NAV_ITEMS.vendorPerformance.label,
      description: NAV_ITEMS.vendorPerformance.description,
      icon: 'Truck',
      group: NAV_GROUPS.categoryConsoles,
      route: '/category-manager/vendor-console',
    },
    {
      id: 'category_summary',
      screenTag: 'Screen 2.6',
      shortTag: '2.6',
      label: NAV_ITEMS.categoryTrends.label,
      description: NAV_ITEMS.categoryTrends.description,
      icon: 'Layers',
      group: NAV_GROUPS.categoryGovernance,
      route: '/category-manager/category-summary',
    },
    {
      id: 'all_rfqs',
      screenTag: 'Screen 2.7',
      shortTag: '2.7',
      label: NAV_ITEMS.allRfqsConsole.label,
      description: NAV_ITEMS.allRfqsConsole.description,
      icon: 'ClipboardList',
      group: NAV_GROUPS.categoryGovernance,
      route: '/category-manager/all-rfqs',
    },
  ],
  vendor: [
    {
      id: 'vendor_feed',
      screenTag: 'Screen 3.1',
      shortTag: '3.1',
      label: NAV_ITEMS.opportunityFeed.label,
      description: NAV_ITEMS.opportunityFeed.description,
      icon: 'Truck',
      group: NAV_GROUPS.vendorOpportunities,
      route: '/vendor/opportunity-feed',
    },
    {
      id: 'quotation_form',
      screenTag: 'Screen 3.2',
      shortTag: '3.2',
      label: NAV_ITEMS.bidQuotes.label,
      description: NAV_ITEMS.bidQuotes.description,
      icon: 'FileCheck',
      group: NAV_GROUPS.vendorOpportunities,
      route: '/vendor/quotation-form',
    },
    {
      id: 'qualification_form',
      screenTag: 'Screen 3.3',
      shortTag: '3.3',
      label: NAV_ITEMS.selfEvaluation.label,
      description: NAV_ITEMS.selfEvaluation.description,
      icon: 'Award',
      group: NAV_GROUPS.vendorQualification,
      route: '/vendor/qualification-form',
    },
    {
      id: 'item_catalogue',
      screenTag: 'Screen 3.4',
      shortTag: '3.4',
      label: NAV_ITEMS.itemCatalogue.label,
      description: NAV_ITEMS.itemCatalogue.description,
      icon: 'Layers',
      group: NAV_GROUPS.vendorQualification,
      route: '/vendor/item-catalogue',
    },
    {
      id: 'vendor_subscription',
      screenTag: 'Screen 3.5',
      shortTag: '3.5',
      label: NAV_ITEMS.subscriptionPlans.label,
      description: NAV_ITEMS.subscriptionPlans.description,
      icon: 'Sparkles',
      group: NAV_GROUPS.vendorAccount,
      route: '/vendor/vendor-subscription',
    },
    {
      id: 'vendor_billing_history',
      screenTag: 'Screen 3.7',
      shortTag: '3.7',
      label: NAV_ITEMS.billingHistory.label,
      description: NAV_ITEMS.billingHistory.description,
      icon: 'Receipt',
      group: NAV_GROUPS.vendorAccount,
      route: '/vendor/billing-history',
    },
    {
      id: 'vendor_profile',
      screenTag: 'Screen 3.6',
      shortTag: '3.6',
      label: NAV_ITEMS.supplierProfile.label,
      description: NAV_ITEMS.supplierProfile.description,
      icon: 'Truck',
      group: NAV_GROUPS.vendorAccount,
      route: '/vendor/vendor-profile',
    },
  ],
  admin: [
    {
      id: 'infra_control',
      screenTag: 'Screen 4.1',
      shortTag: '4.1',
      label: NAV_ITEMS.azureInfrastructure.label,
      description: NAV_ITEMS.azureInfrastructure.description,
      icon: 'Server',
      group: NAV_GROUPS.adminPlatform,
      route: '/admin/infra-control',
    },
    {
      id: 'audit_log',
      screenTag: 'Screen 4.2',
      shortTag: '4.2',
      label: NAV_ITEMS.immutableAuditLog.label,
      description: NAV_ITEMS.immutableAuditLog.description,
      icon: 'ShieldCheck',
      group: NAV_GROUPS.adminPlatform,
      route: '/admin/audit-log',
    },
  ],
};

/**
 * Flush edge-to-edge sidebar geometry. The rail is pinned directly beneath the
 * 64px sticky application header with zero top, left, or bottom gutters.
 */
export const SIDEBAR_LAYOUT = {
  WIDTH_CLASS: 'lg:w-[262px]',
  STICKY_OFFSET_CLASS: 'lg:top-16',
  HEIGHT_CLASS: 'lg:h-[calc(100vh-4rem)]',
};

/** Route the sign-in flow redirects to, chosen by the role on the user record. */
export const ROLE_LANDING_ROUTE: Record<UserRole, string> = {
  buyer: '/buyer/dashboard',
  category_manager: '/category-manager/kanban-board',
  vendor: '/vendor/opportunity-feed',
  admin: '/admin/infra-control',
};

/** Path of the sign-in screen. */
export const LOGIN_ROUTE = '/login';

/**
 * Email OTP shape, mirroring IDENTITY_OTP_CONFIG on the backend. Both trace back
 * to the shared `otp_store` table the Java p2pservices app writes, whose `otp`
 * column is six characters with a 15-minute expiry.
 */
export const OTP_CODE_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 15;

// PASSWORD_MIN_LENGTH is defined in ./validationSchemas and re-exported at the
// bottom of this file. It lives there because the change-password schema needs it
// to build its `minLength` rule, and importing it back from here would close a
// cycle: this module already imports from that one.

/**
 * Buyer organisation profile endpoints.
 *
 * These are the Next.js rewrite paths, which next.config.mjs forwards to the
 * Express backend, so the browser only ever calls same-origin URLs.
 */
export const BUYER_PROFILE_ENDPOINTS = {
  /** The signed-in buyer's own profile: GET to read, PUT to patch. */
  ME: '/api/buyer-profile/me',
  /** Shared major/minor procurement taxonomy the category tree renders. */
  CATEGORIES: '/api/buyer-profile/categories',
};

/**
 * Cardinality caps on a buyer's procurement scope, mirroring
 * BUYER_PROFILE_CONFIG on the backend, which in turn preserves the limits the
 * old Angular screen enforced for a ClientInitiator.
 *
 * Enforced in the browser so the buyer is stopped at the click that would exceed
 * the cap rather than at submit, and re-enforced server-side because a client
 * cannot be trusted to hold the line.
 */
export const BUYER_PROFILE_LIMITS = {
  MAX_MAJOR_CATEGORIES: 5,
  MAX_MINOR_CATEGORIES: 10,
};

/**
 * Global constraints for RFQ supporting document attachments and AI extraction.
 */
export const RFQ_DOCUMENT_LIMITS = {
  MAX_FILE_SIZE_BYTES: 15 * 1024 * 1024,
  MAX_FILE_SIZE_MB: 15,
  MAX_DOCUMENTS_PER_RFQ: 10,
  SUPPORTED_EXTENSIONS: '.xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.eml,.msg',
  SUPPORTED_FORMATS_LABEL:
    'Upload BOQ files (.xlsx, .xls, .csv, .pdf, .docx, .txt) or Forwarded Requisition Emails (.eml, .msg)',
} as const;

/** Legal constitutions offered by the buyer profile form. */
export const ORGANIZATION_TYPE_OPTIONS: OrganizationType[] = [
  'Public Limited',
  'Private Limited',
  'LLP',
  'Partnership',
  'Sole Proprietorship',
];

/**
 * Fallback used when an RFQ reaches dispatch without a target delivery date.
 *
 * A row the buyer adds by hand starts entirely blank — no quantity, unit,
 * category or date — because pre-filled values read as answers the buyer never
 * gave. This offset only backfills the RFQ header when no line item carries a
 * date, and mirrors DELIVERY_DATE_OFFSET_DAYS in RFQ_INGESTION_CONFIG on the
 * backend so a keyed RFQ and an ingested one land on the same default.
 */
export const MANUAL_LINE_ITEM_DEFAULTS = {
  TARGET_DATE_OFFSET_DAYS: 5,
} as const;

/**
 * Single currency the platform trades in. Amounts are grouped the Indian way
 * (1,45,000 rather than 145,000), so the symbol and the locale have to travel
 * together: pairing a rupee symbol with en-US grouping, or the reverse, is the
 * inconsistency this constant exists to prevent.
 */
export const CURRENCY = {
  SYMBOL: '₹',
  CODE: 'INR',
  LOCALE: 'en-IN',
} as const;

/**
 * Every state an RFQ can be in, in pipeline order.
 *
 * Listed here rather than inline in the edit dialog so the status dropdown and
 * the `RFQItem['status']` union cannot drift apart.
 */
export const RFQ_STATUSES = [
  'Parsing',
  'Quotes Pending',
  'In Evaluation',
  'AI Recommended',
  'PO Generated',
] as const;

/**
 * Format an amount for display, e.g. 145000 -> "₹1,45,000".
 *
 * Fractional paise are dropped because every amount the platform shows is a
 * budget, quote or purchase-order total quoted in whole rupees.
 */
export function formatCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${CURRENCY.SYMBOL}${Math.round(safe).toLocaleString(CURRENCY.LOCALE)}`;
}

/**
 * The timezone every RFQ timestamp is presented in.
 *
 * Records are stored in UTC, which is right for storage and wrong for display:
 * buyers, vendors and the procurement desk are all in India, and a raised-at of
 * "2026-09-04T09:25:21.000Z" reads as five and a half hours earlier than the
 * moment the buyer actually pressed save.
 */
export const DISPLAY_TIMEZONE = 'Asia/Kolkata';

/**
 * An RFQ timestamp as an Indian date and time, e.g. "04 Sep 2026, 02:55 pm IST".
 *
 * Accepts what the API actually returns: an ISO-8601 instant, or the
 * "YYYY-MM-DD HH:mm:ss" form MySQL hands back for a DATETIME column. The latter
 * carries no zone, so it is read as UTC — that is what the column stores.
 *
 * An unparseable or absent value is returned unchanged rather than rendered as
 * "Invalid Date", so a legacy record still shows whatever it holds.
 */
export function formatIndianDateTime(value?: string): string {
  if (!value || value.trim() === '') return '';

  // A bare MySQL DATETIME has no zone designator, so one is added before parsing;
  // without it the browser would read it in the viewer's local zone instead.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value.trim())
    ? `${value.trim().replace(' ', 'T')}Z`
    : value;

  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return value;

  const formatted = new Intl.DateTimeFormat(CURRENCY.LOCALE, {
    timeZone: DISPLAY_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(parsed));

  // The zone is named explicitly: the same RFQ is read by vendors elsewhere, and
  // a bare time with no zone is ambiguous on a procurement deadline.
  return `${formatted} IST`;
}

/**
 * An RFQ date with no time, e.g. "30 Sep 2026".
 *
 * Used for target delivery dates, which are stored as a plain date. Parsed as UTC
 * so a date-only value cannot slip to the previous day for a viewer behind UTC.
 */
export function formatIndianDate(value?: string): string {
  if (!value || value.trim() === '') return '';

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const parsed = Date.parse(dateOnly ? `${value.trim()}T00:00:00Z` : value);
  if (Number.isNaN(parsed)) return value;

  return new Intl.DateTimeFormat(CURRENCY.LOCALE, {
    timeZone: DISPLAY_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(parsed));
}

/**
 * Human-readable file size, e.g. 1536 -> "1.5 KB".
 *
 * Uses 1024-based units because that is what the browser and the server both
 * report, and keeps one decimal from KB upwards so a 1.4MB and a 1.9MB document
 * are distinguishable in a list.
 */
export function formatFileSize(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1024) return `${safe} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = safe / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** URL prefix that scopes each role's workspace, used to guard route access. */
export const ROLE_ROUTE_PREFIX: Record<UserRole, string> = {
  buyer: '/buyer',
  category_manager: '/category-manager',
  vendor: '/vendor',
  admin: '/admin',
};

export {
  FORM_SCHEMAS,
  validateFormData,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
  PINCODE_PATTERN,
  PASSWORD_MIN_LENGTH,
} from './validationSchemas';

