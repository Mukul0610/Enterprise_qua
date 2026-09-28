export type UserRole = 'buyer' | 'category_manager' | 'vendor' | 'admin';

export type SourcingMode = 'mode_1' | 'mode_2' | 'mode_3';

export type VendorSubscriptionPlan = 'premium' | 'connect' | 'select' | 'premium_network';

export interface SourcingModeDetail {
  id: SourcingMode;
  code: string;
  name: string;
  shortLabel: string;
  description: string;
  /**
   * One-line summary of the vendor reach a mode buys, plus which plan tiers it
   * includes. Shown alongside `description` on the mode cards: the description
   * explains how a mode routes an RFQ, this says what the buyer gets and makes
   * the cumulative nature of the tiers explicit.
   */
  featureSummary: string;
  badgeColor: string;
}

export interface ExtractedEntity {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  targetDate: string;
  technicalSpecs: string;
  confidence: number;
  category: string;
  /**
   * Required rather than optional: every producer sets both. Extraction gets them
   * from the taxonomy classifier, and a row keyed by hand starts with empty
   * strings that the Step 3 gate refuses to dispatch. Leaving them optional meant
   * the RFQ header category had to carry an unreachable fallback to satisfy the
   * type, which hid the fact that the gate already guarantees a value.
   */
  majorCategory: string;
  minorCategory: string;
}

export interface LineItemBid {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  leadTimeDays: number;
  uploadedDocument?: string;
  complianceDoc?: string;
  marketBandStatus: 'optimal' | 'warning' | 'high';
  paymentTerms: string;
}

export interface LineItemQuote {
  lineItemId?: string;
  itemName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  totalPrice: number;
  leadTimeDays?: number;
  warrantyYears?: number;
  remarks?: string;
}

export interface QuoteComparison {
  vendorId: string;
  vendorName: string;
  vendorCategory: 'Client List' | 'Procucev - AI Rec' | 'Procucev Network';
  unitPrice: number;
  totalPrice: number;
  leadTimeDays: number;
  aiMatchScore: number;
  isBestPrice?: boolean;
  isPreferred?: boolean;
  warrantyYears: number;
  complianceStatus: 'Fully Compliant' | 'Minor Exception' | 'Pending Review';
  paymentTerms: string;
  remarks: string;
  source?: 'email' | 'portal' | 'web_portal';
  submissionMethod?: 'email' | 'portal' | 'web_portal';
  taxes?: number;
  deliveryCharges?: number;
  deliveryDate?: string;
  lineItemQuotes?: LineItemQuote[];
  scoreBreakdown?: {
    price: { score: number; weighted: number; maxWeight: number };
    leadTime: { score: number; weighted: number; maxWeight: number };
    warranty: { score: number; weighted: number; maxWeight: number };
  };
}

export type FollowUpChannel = 'call' | 'whatsapp' | 'sms';

export interface VendorChannelCall {
  status: 'completed' | 'connected' | 'in_progress' | 'voicemail' | 'failed' | 'scheduled';
  lastAttempt: string;
  duration?: string;
  summary?: string;
  recordingUrl?: string;
  transcriptSnippet?: string;
}

export interface VendorChannelWhatsApp {
  status: 'read' | 'delivered' | 'replied' | 'pending' | 'failed';
  lastAttempt: string;
  messagePreview?: string;
  linkClicked?: boolean;
}

export interface VendorChannelSMS {
  status: 'delivered' | 'sent' | 'clicked' | 'failed' | 'pending';
  lastAttempt: string;
  deliveryReport?: string;
}

export interface VendorChannelEmail {
  status: 'sent' | 'delivered' | 'opened' | 'pending' | 'reminded_24h';
  lastAttempt: string;
  is24hReminderSent: boolean;
  subject?: string;
}

export interface VendorFollowUpRecord {
  vendorId: string;
  vendorName: string;
  phone: string;
  contactPerson: string;
  call: VendorChannelCall;
  whatsapp: VendorChannelWhatsApp;
  sms: VendorChannelSMS;
  email24h?: VendorChannelEmail;
  overallStatus: 'Responded' | 'Follow-up Active' | 'Awaiting Bid' | 'Escalated' | 'Pending';
  lastInteraction: string;
  attemptsCount: number;
  bidStatus: 'Submitted' | 'In Progress' | 'Pending' | 'Declined';
}

export interface RFQFollowUpBreakdown {
  rfqNumber: string;
  totalInvited: number;
  respondedCount: number;
  callStats: {
    total: number;
    connected: number;
    avgDuration: string;
  };
  whatsappStats: {
    total: number;
    delivered: number;
    read: number;
    replied: number;
  };
  smsStats: {
    total: number;
    delivered: number;
    clicked: number;
  };
  emailStats?: {
    total: number;
    sent24h: number;
    opened: number;
  };
  vendors: VendorFollowUpRecord[];
  nextScheduledChaser?: string;
  autoChasingEnabled: boolean;
}

export type RFQSource = 'email_gateway' | 'web_portal' | 'email_upload' | 'manual_entry';

// ==============================================================================
// MANUAL RFQ ENTRY
// ==============================================================================
// The buyer keys these fields directly, with no document and no AI extraction.
// Modelled separately from ExtractedEntity for one reason: an extracted row always
// arrives complete, because the server normalises the quantity and unit and
// classifies both categories before the wizard ever renders it. A manually keyed
// row starts genuinely blank and is filled in over time, so its in-progress
// fields have to be able to hold "not answered yet" without that being confused
// with a real answer.
//
// A quantity of `null` is the clearest case. ExtractedEntity types it `number`,
// which forced blank rows to carry 0 — indistinguishable from a buyer who really
// meant zero, and 0 is exactly the value that used to get dispatched to vendors
// unnoticed.

/** One line item on the manual entry form, before it is validated for dispatch. */
export interface ManualRFQLineItem {
  /** Client-side row key. The server never sees it. */
  id: string;
  itemName: string;
  technicalSpecs: string;
  /** `null` while unanswered, so a blank row is never mistaken for a real zero. */
  quantity: number | null;
  unit: string;
  targetDate: string;
  majorCategory: string;
  minorCategory: string;
}

/** The whole manual RFQ entry form. */
export interface ManualRFQForm {
  title: string;
  /** Header category, derived from the leading line item once one is classified. */
  majorCategory: string;
  /** `null` while unanswered. Optional for dispatch: a buyer need not publish a ceiling. */
  estimatedBudget: number | null;
  targetDeliveryDate: string;
  deliveryLocation: string;
  deliveryPincode: string;
  lineItems: ManualRFQLineItem[];
  /** Stored server-side and downloadable. Never sent for AI extraction. */
  attachments: RFQAttachment[];
  sourcingMode: SourcingMode;
}

/**
 * Why one line item cannot be dispatched yet, keyed by field.
 * An empty object means the row is ready.
 */
export type ManualRFQLineItemErrors = Partial<Record<keyof ManualRFQLineItem, string>>;

/** Whether the form can be dispatched, and everything blocking it if not. */
export interface ManualRFQValidation {
  isValid: boolean;
  /** Errors against the header fields, keyed by field name. */
  formErrors: Partial<Record<keyof ManualRFQForm, string>>;
  /** Errors against each line item, keyed by the row's client-side id. */
  lineItemErrors: Record<string, ManualRFQLineItemErrors>;
}

/**
 * The payload POST /api/rfqs accepts.
 *
 * Deliberately carries no rfqNumber: the server allocates it, following the same
 * scheme the Java p2pservices application uses. The wizard used to mint one with
 * Math.random(), which could collide and bore no relation to that scheme.
 */
/**
 * What a caller supplies when raising an RFQ.
 *
 * Everything the server owns is omitted, so a caller cannot supply it and then be
 * surprised that the saved record differs. `rfqNumber` in particular used to be
 * minted on the client with Math.random(); the server allocates it under the same
 * scheme the Java p2pservices application uses.
 */
export type NewRFQInput = Omit<
  RFQItem,
  | 'id'
  | 'rfqId'
  | 'rfqNumber'
  | 'createdAt'
  | 'updatedAt'
  | 'quotes'
  | 'quotesCount'
  | 'status'
  | 'chasingActive'
  | 'aiSummary'
  | 'raisedByEmail'
>;

/** Why an RFQ read or write did not succeed. */
export type RFQTransportFailure =
  | 'NETWORK'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'SERVER';

/** Outcome of creating an RFQ. On success the server's record is authoritative. */
export type RFQMutationResult =
  | { success: true; rfq: RFQItem }
  | {
      success: false;
      reason: RFQTransportFailure;
      error: string;
      /** Per-field messages from the API's schema validation, when it supplied any. */
      fieldErrors?: Record<string, string>;
    };

/** Outcome of reading one RFQ. */
export type RFQFetchResult =
  | { success: true; rfq: RFQItem }
  | { success: false; reason: RFQTransportFailure; error: string };

/** Outcome of listing this organisation's RFQs. An empty list is a success. */
export type RFQListResult =
  | { success: true; rfqs: RFQItem[] }
  | { success: false; reason: RFQTransportFailure; error: string };

/** Outcome of listing an RFQ's category-matched vendor invite candidates. */
export type RFQVendorCandidatesResult =
  | { success: true; candidates: RFQVendorCandidate[] }
  | { success: false; reason: RFQTransportFailure; error: string };

/** Page metadata returned alongside a paginated vendor listing. */
export interface VendorPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Outcome of fetching one page of the full (unfiltered-by-category) vendor directory. */
export type RFQVendorPageResult =
  | { success: true; candidates: RFQVendorCandidate[]; pagination: VendorPageMeta }
  | { success: false; reason: RFQTransportFailure; error: string };

/** Outcome of inviting vendors to an RFQ. */
export type RFQInviteVendorsResult =
  | { success: true; rfq: RFQItem; invitedCount: number }
  | { success: false; reason: RFQTransportFailure; error: string };

/**
 * The editable commercial and delivery terms of an RFQ, as the edit dialog holds
 * them. `budget` is null when no ceiling is stated, which is a different answer
 * from a ceiling of zero.
 */
export interface RFQEditFormState {
  title: string;
  category: string;
  status: RFQItem['status'];
  budget: number | null;
  targetDeliveryDate: string;
  deliveryLocation: string;
  deliveryPincode: string;
  lineItems: RFQEditLineItem[];
  attachments: RFQAttachment[];
}

/**
 * One line item as the edit dialog holds it.
 *
 * `quantity` is nullable so a blank field reads as unanswered rather than as a
 * quantity of nothing, which is the value that otherwise reaches vendors unnoticed.
 * `confidence` is carried through unchanged: it records how the row was produced,
 * and correcting a description does not make the model more or less sure of what
 * it originally read.
 */
export interface RFQEditLineItem {
  id: string;
  itemName: string;
  technicalSpecs: string;
  quantity: number | null;
  unit: string;
  targetDate: string;
  majorCategory: string;
  minorCategory: string;
  confidence: number;
}

/** Validation messages for the edit dialog, keyed by the field that failed. */
export type RFQEditFormErrors = Partial<Record<keyof RFQEditFormState, string>>;

/** Outcome of deleting one RFQ. Carries the number so the caller can drop the row. */
export type RFQDeleteResult =
  | { success: true; rfqNumber: string }
  | { success: false; reason: RFQTransportFailure; error: string };

/**
 * Outcome of creating a Zoho payment link for a vendor subscription upgrade.
 * On success the browser is redirected to `paymentUrl` — Zoho hosts the actual
 * payment page, this app never collects card details itself.
 */
export type PaymentLinkCreateResult =
  | { success: true; paymentUrl: string; paymentLinkId: string; status: string }
  | { success: false; reason: RFQTransportFailure; error: string };

export interface RFQCreatePayload {
  title: string;
  category: string;
  sourcingMode: SourcingMode;
  status: string;
  source: RFQSource;
  sourceFileName?: string;
  /**
   * Address the requisition arrived from, for an emailed RFQ.
   *
   * Read out of the message server-side rather than typed by the buyer, so the
   * recorded origin cannot be attributed to an address no mail was received from.
   * This was missing from the payload while the wizard was already collecting it,
   * which is why email provenance never reached the database.
   */
  sourceEmail?: string;
  /**
   * Target gateway mailbox (e.g. RFQ@procucev.com) for email notification dispatch.
   */
  targetGatewayEmail?: string;
  budget: number;
  targetDeliveryDate: string;
  deliveryLocation: string;
  deliveryPincode: string;
  extractedEntities: ExtractedEntity[];
  attachments: RFQAttachment[];
  assignedVendors?: Array<{
    id?: string;
    name: string;
    email?: string | null;
    contactPerson?: string | null;
    phone?: string | null;
  }>;
}

/**
 * Fields an edit may change, all optional.
 *
 * An edit is a partial update: correcting only the delivery pincode must not blank
 * whatever the form did not resend. `source`, `sourceFileName`, the RFQ number and
 * the buyer identity are absent because they record how the RFQ arrived and who
 * owns it — the API whitelists writable columns and would ignore them anyway.
 */
export type RFQUpdatePayload = Partial<
  Pick<
    RFQCreatePayload,
    | 'title'
    | 'category'
    | 'sourcingMode'
    | 'status'
    | 'budget'
    | 'targetDeliveryDate'
    | 'deliveryLocation'
    | 'deliveryPincode'
    | 'extractedEntities'
    | 'attachments'
  >
>;

/**
 * A supporting document attached to an RFQ.
 *
 * Metadata only. The bytes live on the server and are fetched by `id`, because a
 * 10MB PDF is roughly 13MB of base64 and the bootstrap payload carries every RFQ.
 */
export interface RFQAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  /** Decoded size in bytes. */
  size: number;
  uploadedAt: string;
}

/**
 * The narrative summary stored against an RFQ.
 *
 * `generatedBy` matters: when the model was unavailable the server stores a
 * summary computed from the line items instead, and the screen has to say so
 * rather than passing arithmetic off as analysis.
 */
export interface RFQAiSummary {
  headline: string;
  scope: string;
  riskNotes: string[];
  itemCount: number;
  totalQuantity: number;
  categories: string[];
  generatedBy: 'ai' | 'derived';
  /** Why the model was not used, when it was not. */
  fallbackReason: string | null;
  model: string | null;
  generatedAt: string;
}

export interface RFQItem {
  id: string;
  rfqNumber: string;
  title: string;
  category: string;
  sourcingMode: SourcingMode;
  status: 'Parsing' | 'In Evaluation' | 'AI Recommended' | 'PO Generated' | 'Quotes Pending';
  quotesCount: number;
  targetDeliveryDate: string;
  /**
   * Budget ceiling, optional. Zero means the buyer did not state one: a document
   * that prices nothing yields no figure, and forcing a number there would put a
   * fabricated ceiling in front of vendors.
   */
  budget: number;
  /** Where the goods must be delivered, used by vendors to price freight. */
  deliveryLocation?: string;
  /** Postal code for the delivery location. Indian PIN or an international zip. */
  deliveryPincode?: string;
  /** Supporting documents the buyer attached. Never sent for AI extraction. */
  attachments?: RFQAttachment[];
  /**
   * The summary generated when the RFQ was created. Absent on records raised
   * before summaries existed.
   */
  aiSummary?: RFQAiSummary | null;
  /** Login email of the buyer who raised it, for display only. */
  raisedByEmail?: string;
  /** Server-side RFQ id. Same value as `rfqNumber`. */
  rfqId?: string;
  createdAt: string;
  /**
   * When the record last changed. Equal to `createdAt` until the RFQ is edited,
   * which is how the details page decides whether to show an "edited" timestamp.
   */
  updatedAt?: string;
  extractedEntities: ExtractedEntity[];
  quotes: QuoteComparison[];
  chasingActive: boolean;
  chaserMethod?: 'WhatsApp' | 'Email' | 'SMS' | 'Call' | 'Multi-Channel';
  aiScore?: number;
  source?: RFQSource;
  sourceEmail?: string;
  sourceFileName?: string;
  autoCirculated?: boolean;
  followUpData?: RFQFollowUpBreakdown;
  awardedVendorId?: string;
  awardedVendor?: string;
  awardedAmount?: number;
  /** The buyer account this RFQ was created under (the app's single globally "active" buyer account at creation time, not a per-request identity). */
  buyerAccountId?: string | null;
  buyerAccountName?: string | null;
  /**
   * Vendors a category manager has explicitly invited to this RFQ. Category
   * match alone no longer grants a vendor visibility — only being on this
   * list (or being a vendor the buyer directly added) does. See
   * category-manager/all-rfqs.tsx's "Invite Vendors" action.
   */
  assignedVendors?: RFQAssignedVendor[];
}

/** One entry on RFQItem.assignedVendors — a vendor invited to this RFQ. */
export interface RFQAssignedVendor {
  id: string;
  name: string;
  email?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
}

/** A candidate vendor for RFQ invitation — a VendorEntry plus invite state. */
export interface RFQVendorCandidate extends VendorEntry {
  alreadyInvited: boolean;
}

export interface AIBotFeedItem {
  id: string;
  timestamp: string;
  timeAgo: string;
  type: 'call' | 'whatsapp' | 'sms' | 'email' | 'scoring' | 'ingestion' | 'escalation' | 'approval' | 'system' | 'invitation' | 'reminder';
  channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system' | 'invitation' | 'reminder';
  title: string;
  message: string;
  recipient?: string;
  rfqNumber?: string;
  buyerAccountId?: string;
  status: 'delivered' | 'read' | 'completed' | 'processing' | 'answered' | 'connected' | 'failed';
  channelDetails?: {
    duration?: string;
    transcriptSummary?: string;
    deliveryTimestamp?: string;
    actionOutcome?: string;
  };
}

/**
 * One in-app notification, as served by GET /api/notifications. The list is
 * always scoped server-side to the signed-in recipient: a vendor sees
 * `rfq_category_match` alerts for RFQs in their category, a buyer sees
 * `quote_received` alerts for quotes on their own RFQs.
 */
export interface AppNotification {
  id: string;
  recipientType: 'vendor' | 'buyer';
  recipientId: string;
  kind: 'rfq_category_match' | 'quote_received';
  rfqId: string | null;
  rfqNumber: string | null;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface VendorOpportunity {
  id: string;
  rfqNumber: string;
  title: string;
  buyer: string;
  deadline: string;
  daysRemaining: number;
  type: 'direct_invitation' | 'network_marketplace';
  estimatedValue?: string;
  deliveryLocation: string;
  status: 'pending_bid' | 'submitted' | 'under_review';
  lineItems: LineItemBid[];
  /** The RFQ's real category (RFQItem.category) — empty when the buyer never set one. */
  majorCategory: string;
  /** From the leading line item's real minorCategory — empty when none was classified. */
  minorCategory: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  rfqNumber?: string;
  shaSignature: string;
  status: 'VERIFIED' | 'TAMPER_CHECK_OK';
  ipAddress: string;
}

export interface AzureServiceHealth {
  service: string;
  status: 'ONLINE' | 'HEALTHY' | 'DEGRADED';
  latency: string;
  uptime: string;
  details: string;
}

export interface SystemConfig {
  ollamaModel: 'Llama 3 (8B Instruct)' | 'Llama 3.1 (70B Quantized)' | 'Mistral NeMo 12B';
  ollamaActive: boolean;
  ocrExtractionThreshold: number;
  whatsappAutoChaser: boolean;
  voiceCallAutoChaser?: boolean;
  smsAutoChaser?: boolean;
  escalationIntervalHours: number;
  azureDbBackupFrequency: 'Hourly' | 'Daily' | 'Continuous';
  rbacEnforced: boolean;
}

export interface VendorModuleScore {
  score: number;
  maxScore: number;
  weight: number;
  weightedScore: number;
  remarks?: string;
}

export interface VendorEvaluationDocument {
  id: string;
  name: string;
  type: string;
  uploadDate: string;
  verified: boolean;
  status: 'Verified' | 'Pending Review' | 'Missing';
}

export interface QuestionEvaluationItem {
  refId: string;
  pillarId: 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6';
  pillarName: string;
  criteria: string;
  attachmentName: string;
  attachmentVerified: boolean;
  score: number;
  weightedScore: number;
  remarks: string;
}

export interface VendorEvaluationRecord {
  id: string;
  vendorId: string;
  vendorName: string;
  contactPerson: string;
  email: string;
  phone: string;
  category: string;
  submissionDate: string;
  status: 'PREFERRED ENTERPRISE SUPPLIER' | 'CONDITIONAL / UNDER REVIEW' | 'DISQUALIFIED SUPPLIER';
  overallScore: number; // 0 - 100%
  moduleScores: {
    commercial: VendorModuleScore; // 25%
    technical: VendorModuleScore; // 15%
    quality: VendorModuleScore; // 20%
    delivery: VendorModuleScore; // 20%
    financial: VendorModuleScore; // 10%
    governance: VendorModuleScore; // 10%
  };
  documents: VendorEvaluationDocument[];
  questionBreakdown?: QuestionEvaluationItem[];
  capaRequired?: boolean;
  capaNotes?: string;
  systemAction: string;
  responses?: Record<string, string | number>;
}

export interface MajorMinorCategory {
  majorCategory: string;
  minorCategories: string[];
}

/** Legal constitutions a buyer organisation can be registered under. */
export type OrganizationType =
  | 'Private Limited'
  | 'Public Limited'
  | 'Partnership'
  | 'Sole Proprietorship'
  | 'LLP';

/**
 * One selected procurement category, flattened to a major/minor pair.
 *
 * This is the wire format `/api/buyer-profile/me` speaks in both directions, and
 * it is one row of `org_division_category` in the shared schema. The screen holds
 * the same selection as a nested map because that is what the category tree
 * renders from; the pairs are the transport shape.
 */
export interface BuyerProfileCategory {
  major: string;
  minor: string;
}

/**
 * The signed-in buyer's organisation profile, as returned by
 * GET /api/buyer-profile/me.
 *
 * `contactEmail` and `contactPhone` come from the account's own `user` row rather
 * than the organisation, so they identify the signed-in buyer and are not
 * editable through this endpoint.
 */
export interface BuyerProfile {
  organizationId: string;
  userId: string;
  companyName: string;
  brandName: string;
  organizationType: OrganizationType | string;
  panNumber: string;
  gstNumber: string;
  cinNumber: string;
  website: string;
  annualTurnover: string;
  street: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  contactName: string;
  contactDesignation: string;
  contactEmail: string;
  contactPhone: string;
  categories: BuyerProfileCategory[];
}

/**
 * Fields a buyer may patch via PUT /api/buyer-profile/me.
 *
 * Every key is optional because the endpoint applies null-skip semantics: an
 * omitted field keeps its stored value. `companyName` is required by the server
 * whenever a save is attempted, and `categories` replaces the whole selection.
 */
export interface BuyerProfileUpdatePayload {
  companyName: string;
  brandName?: string;
  organizationType?: OrganizationType | string;
  panNumber?: string;
  gstNumber?: string;
  cinNumber?: string;
  website?: string;
  annualTurnover?: string;
  street?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  contactName?: string;
  contactDesignation?: string;
  categories?: BuyerProfileCategory[];
}

/** Outcome of a buyer profile read. Never throws, so the screen can show why. */
export interface BuyerProfileResult {
  success: boolean;
  data?: BuyerProfile;
  error?: string;
  /** Per-field validation messages keyed by payload field name. */
  fieldErrors?: Record<string, string>;
  /** HTTP status, so the caller can distinguish auth from availability faults. */
  status?: number;
}

/** Outcome of a buyer profile save, carrying the re-read record on success. */
export interface BuyerProfileSaveResult extends BuyerProfileResult {
  message?: string;
  categoryCount?: number | null;
}

/** Outcome of a procurement category taxonomy read. */
export interface CategoryTaxonomyResult {
  success: boolean;
  data: MajorMinorCategory[];
  error?: string;
}

export interface OrganizationProfile {
  companyName: string;
  brandName: string;
  organizationType: 'Private Limited' | 'Public Limited' | 'Partnership' | 'Sole Proprietorship' | 'LLP';
  panNumber: string;
  gstNumber: string;
  cinNumber: string;
  msmeNumber?: string;
  website: string;
  annualTurnover: string;
  registeredAddress: {
    street: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  primaryContact: {
    name: string;
    designation: string;
    email: string;
    phone: string;
  };
  selectedMajorCategories: string[];
  selectedMinorCategories: Record<string, string[]>;
}

export interface VendorEntry {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  majorCategory: string;
  minorCategories: string[];
  location: string;
  rating: number;
  source:
    | 'buyer_manual'
    | 'buyer_excel'
    | 'buyer_uploaded'
    | 'vendor_master_ingestion'
    | 'historical_purchase_dump'
    | 'procucev_network'
    | 'manual'
    | 'excel'
    | 'self_onboarded'
    | 'category_manager_upload'
    | string;
  status?: 'PREFERRED ENTERPRISE SUPPLIER' | 'CONDITIONAL / UNDER REVIEW' | 'REGISTERED / NOT EVALUATED';
  score?: number | null;
  evaluated?: boolean;
  hasRecord?: boolean;
  matchReason?: string;
  proximity?: string;
  proximityMatch?: boolean;

  // Database Availability & Onboarding Credentials
  isExistingInDatabase?: boolean;
  onboardingEmailStatus?: 'sent' | 'pending' | 'delivered';
  onboardingEmailDispatchedAt?: string;
  tempPassword?: string;
  firstLoginCompleted?: boolean;
  reminderCadence?: 'every_3_days';
  nextReminderDate?: string;
  remindersSentCount?: number;
  addedByBuyerCompany?: string;
  addedByBuyerName?: string;
  profileCompletionStatus?: 'pending' | 'completed';

  // Dual-Stream Category Mapping & Reconciliation (Client-Mapped vs Vendor-Selected)
  clientMappedCategories?: string[]; // Categories assigned by buyer (from PO / vendor master upload)
  vendorSelectedCategories?: string[]; // Categories chosen by vendor from profile page (max 10)
  isCategoryAligned?: boolean; // True if vendor selected matches client mapped
  categoryMismatchDetails?: {
    clientOnly: string[];
    vendorOnly: string[];
    common: string[];
  };
  categoryMatchSource?: 'Aligned Buyer & Vendor Category Match' | 'Buyer Empanelled Category Match' | 'Vendor Profile Self-Declared Category Match';

  // Buyer Performance Ratings & Revisions
  latestRatingRevision?: VendorRatingRevisionRecord;
  ratingRevisionHistory?: VendorRatingRevisionRecord[];

  // Marketplace subscription & the download quota it grants — persisted
  // server-side and enforced there (see PUT /api/vendors/:id/subscription
  // and GET /api/rfqs/:id/email-preview's quota check), not just local state.
  subscriptionPlan?: VendorSubscriptionPlan;
  rfqDownloadsUsed?: number;
  freeQuotationCredits?: number;
  quotedRfqIds?: string[];

  // Statutory/location fields a category manager's bulk vendor upload
  // collects (mirrors the real p2pservices Vendor Master sheet — see
  // POST /api/vendors/bulk-import). Not part of the vendor's own
  // self-service profile edit; optional everywhere else.
  gstin?: string;
  gst?: string;
  pan?: string;
  msme?: string;
  annualTurnover?: string;
  brandName?: string;
  contactDesignation?: string;
  country?: string;
  website?: string;
  orgType?: string;
  factoryAddress?: string;
  city?: string;
  state?: string;
  pincode?: string;
  products?: string;
}

/** One row of a category manager's parsed vendor-upload Excel file, after
 * client-side field-format validation but before it's sent to the backend.
 * `vendor` carries only the fields the bulk-import endpoint accepts —
 * see VALIDATION_SCHEMAS.vendorBulkImportRow on the backend for the
 * matching server-side re-validation.
 */
export interface VendorUploadRow {
  rowNumber: number;
  vendor: {
    name: string;
    email: string;
    phone: string;
    contactPerson?: string;
    gstin?: string;
    city?: string;
    state?: string;
    pincode?: string;
    majorCategory?: string;
    products?: string;
  };
  isValid: boolean;
  errors: string[];
  /**
   * True when the row has no email at all. Not treated as invalid — the row
   * still uploads (email is nullable in Postgres, never fabricated) — but
   * surfaced distinctly so a buyer/CM reviewing a large import can see and
   * export exactly which rows need a manual follow-up.
   */
  missingEmail: boolean;
}

/** One row's outcome as reported back by POST /api/vendors/bulk-import. */
export interface VendorUploadRowResult {
  rowNumber: number;
  status: 'imported' | 'duplicate' | 'failed';
  email?: string;
  errors?: string[];
  reason?: string;
  missingEmail?: boolean;
}

/** Aggregate response from one bulk-import chunk request. */
export interface VendorUploadImportResponse {
  /** Ties every chunk of one upload run together — see bulkImportVendorRows. */
  sessionId?: string;
  total: number;
  imported: number;
  /** Successfully imported rows that carried no email. */
  missingEmail: number;
  duplicates: number;
  failed: number;
  results: VendorUploadRowResult[];
}

export interface VendorRatingRevisionRecord {
  id: string;
  vendorId: string;
  vendorName: string;
  buyerCompany: string;
  buyerName: string;
  buyerEmail: string;
  timestamp: string;
  qualityScore: number; // 0-100
  costScore: number; // 0-100
  deliveryScore: number; // 0-100
  buyerAverage: number; // (Q + C + D) / 3
  previousScore: number;
  newCompositeScore: number; // Math.round((previousScore + buyerAverage) / 2)
  previousRating: number;
  newRating: number; // newCompositeScore / 20
  remarks: string;
  emailDispatched: boolean;
  shaSignature: string;
}

export interface VendorRatingRevisionEmailPayload {
  vendorName: string;
  vendorEmail: string;
  vendorContactPerson: string;
  buyerCompany: string;
  buyerContactName: string;
  buyerContactEmail: string;
  dispatchedAt: string;
  qualityScore: number;
  costScore: number;
  deliveryScore: number;
  buyerAverage: number;
  previousScore: number;
  newCompositeScore: number;
  newRating: number;
  remarks: string;
  shaSignature: string;
}

export interface VendorMasterUploadRecord {
  id: string;
  vendorCode?: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  gstNumber: string;
  vendorRatingScore?: number; // 0 to 100 (Optional)
}

export interface PurchaseOrderLineItemRecord {
  id: string;
  poNumber: string;
  poDate: string;
  vendorIdentifier: string; // Matches vendor code, company name or email
  itemName: string;
  specs?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalSpend: number;
  department?: string;
}

export interface HistoricalPurchaseVendorRecord {
  id: string;
  vendorCode?: string;
  companyName: string;
  email: string;
  contactPerson?: string;
  phone: string;
  address: string;
  gstNumber: string;
  vendorRatingScore?: number; // 0 to 100 (Optional)
  hasPoHistory: boolean; // True if PO line items were found in PO dump
  categoriesMappedByBuyer: boolean; // True if buyer mapped 1st & 2nd set categories from POs
  itemsSupplied: string[]; // List of items purchased in the past
  pastPoSpend?: string;
  poCount?: number;
  firstSetMajorCategory: string; // 1st Set: Primary Major Category
  secondSetMinorCategories: string[]; // 2nd Set: Minor Categories
  secondSetSecondaryMajors?: string[]; // 2nd Set: Secondary Major Categories
  isExistingInDatabase?: boolean;
  tempPassword?: string;
}

// ==============================================================================
// VENDOR MASTER & PO DATA INGESTION (buyer module)
// ==============================================================================
// Contracts for /api/vendor-ingestion/*. Deliberately separate from the
// VendorMasterUploadRecord / PurchaseOrderLineItemRecord types above, which back
// the older client-side-only initial setup modal: those default every missing
// field to a plausible-looking value, whereas everything below is what the
// server actually stored and validated.

export type VendorIngestionHorizonType = 'LAST_1_YEAR' | 'LAST_2_YEARS' | 'LAST_3_YEARS' | 'CUSTOM';

export type VendorIngestionSessionStatus =
  | 'DRAFT'
  | 'VENDOR_MASTER_STORED'
  | 'PO_STORED'
  | 'JOINED'
  | 'AI_COMPLETED'
  | 'DISPATCHED';

export type VendorIngestionAiStatus = 'IDLE' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type VendorMappingStatus =
  | 'PENDING_REVIEW'
  | 'AI_MAPPED'
  | 'BUYER_APPROVED'
  | 'SELF_MAP_REQUIRED'
  | 'SELF_MAPPED'
  | 'REJECTED'
  | 'NEW_CATEGORY_SUGGESTION'
  | 'FAILED';

export type VendorMappingSource = 'AI' | 'BUYER' | 'SELF_MAPPED';

export type VendorAiProcessingStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/** High >= 90, Medium >= 70, anything lower (or unstated) needs buyer review. */
export type VendorConfidenceBand = 'HIGH' | 'MEDIUM' | 'NEEDS_REVIEW';

export type VendorDispatchTemplate = 'CATEGORY_MAPPED' | 'SELF_MAP_REQUIRED' | 'GENERAL_ONBOARDING';

export type VendorEmailStatus = 'PENDING' | 'QUEUED' | 'SENT' | 'FAILED' | 'DELIVERED' | 'BOUNCED';

export type VendorCategoryReviewAction = 'APPROVE' | 'EDIT' | 'REJECT';

/** One ingestion run. `currentStep` and `status` are the server's authority. */
export interface VendorIngestionSession {
  id: string;
  organizationId: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
  status: VendorIngestionSessionStatus;
  currentStep: number;
  horizonType: VendorIngestionHorizonType | null;
  horizonStart: string | null;
  horizonEnd: string | null;
  vendorMasterFileName: string | null;
  vendorMasterRowCount: number;
  poFileName: string | null;
  poRowCount: number;
  poInHorizonCount: number;
  poOutsideHorizonCount: number;
  matchedVendorCount: number;
  unmatchedVendorCount: number;
  aiStatus: VendorIngestionAiStatus;
  aiProcessedCount: number;
  aiTotalCount: number;
  aiFailedCount: number;
  aiStartedAt: string | null;
  aiCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A stored vendor-master row, as the server holds it. */
export interface VendorIngestionMasterRecord {
  id: string;
  sessionId: string;
  sourceRowNumber: number | null;
  vendorCode: string;
  companyName: string;
  normalizedName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  gstin: string;
  rating: number | null;
}

/** A row the server refused, with every reason it refused it. */
export interface VendorIngestionRejectedRow {
  rowNumber: number;
  errors: string[];
}

/** Result of one upload chunk. Invalid rows are reported, never dropped. */
export interface VendorMasterUploadResult {
  session: VendorIngestionSession;
  totalRows: number;
  validRows: number;
  storedRows: number;
  invalidRows: number;
  duplicateRows: number;
  totalStored: number;
  rejected: VendorIngestionRejectedRow[];
}

/** Result of one PO chunk, including the inside/outside-period split. */
export interface PoDumpUploadResult {
  session: VendorIngestionSession;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  insidePeriod: number;
  outsidePeriod: number;
  totalStored: number;
  rejected: VendorIngestionRejectedRow[];
}

/** How PO lines were attributed, by strategy. */
export interface VendorMatchCounts {
  byVendorCode: number;
  byGstin: number;
  byName: number;
  unmatched: number;
}

export interface VendorJoinMatchedVendor {
  vendorRecordId: string;
  vendorCode: string;
  companyName: string;
  poCount: number;
  poLineCount: number;
  totalSpend: number;
  purchasedItems: string[];
}

export interface VendorJoinSelfMapVendor {
  vendorRecordId: string;
  vendorCode: string;
  companyName: string;
  email: string;
  status: VendorMappingStatus;
}

/** PO spend for a vendor that is not in the vendor master at all. */
export interface UnmatchedPoVendor {
  vendorLabel: string;
  vendorCode: string;
  poLineCount: number;
  totalSpend: number;
}

export interface VendorPoJoinResult {
  session: VendorIngestionSession;
  totalVendors: number;
  matchedVendorCount: number;
  unmatchedVendorCount: number;
  matchCounts: VendorMatchCounts;
  unmatchedPoVendors: UnmatchedPoVendor[];
  matchedVendors: VendorJoinMatchedVendor[];
  selfMapVendors: VendorJoinSelfMapVendor[];
}

/** What the model proposed. Kept separate from the buyer's decision. */
export interface VendorAiSuggestion {
  majorCategory: string;
  minorCategories: string[];
  relevantProducts: string[];
  confidence: number | null;
  reason: string;
  model: string;
}

/**
 * One supplier's mapping row.
 *
 * `aiSuggestion` and `buyerMajorCategory`/`buyerMinorCategories` are both
 * present at once by design: approving or editing never overwrites the
 * recommendation, so the review trail stays readable. `finalMajorCategory` is the
 * one actually in force, computed by the server so the UI cannot pick differently.
 */
export interface VendorCategoryMapping {
  id: string;
  sessionId: string;
  vendorRecordId: string;
  vendorCode: string;
  companyName: string;
  email: string;
  vendorId: string | null;
  aiSuggestion: VendorAiSuggestion;
  buyerMajorCategory: string;
  buyerMinorCategories: string[];
  source: VendorMappingSource | null;
  status: VendorMappingStatus;
  processingStatus: VendorAiProcessingStatus;
  processingError: string;
  attemptCount: number;
  poCount: number;
  totalSpend: number;
  hasPoHistory: boolean;
  isNewCategorySuggestion: boolean;
  suggestedNewCategory: string;
  reviewedBy: string;
  reviewedAt: string | null;
  reviewAction: string | null;
  createdAt: string;
  updatedAt: string;
  confidenceBand: VendorConfidenceBand;
  finalMajorCategory: string;
  finalMinorCategories: string[];
}

export interface VendorMappingSummary {
  total: number;
  mapped: number;
  approved: number;
  pendingReview: number;
  selfMapRequired: number;
  selfMapped: number;
  rejected: number;
  newCategorySuggestions: number;
  failed: number;
  queued: number;
  processing: number;
  completed: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
}

export interface VendorMappingListResult {
  vendors: VendorCategoryMapping[];
  total: number;
  limit: number;
  offset: number;
  summary: VendorMappingSummary;
  confidenceBands: { HIGH_MIN: number; MEDIUM_MIN: number; REVIEW_THRESHOLD: number };
}

export interface VendorCategorizationOutcome {
  vendorRecordId: string;
  companyName: string;
  status: string;
  error: string | null;
}

/** One poll of the batched AI job. `done` is true once nothing is queued. */
export interface VendorCategorizationBatchResult {
  session: VendorIngestionSession;
  done: boolean;
  processedInBatch: number;
  outcomes: VendorCategorizationOutcome[];
  summary: VendorMappingSummary;
}

export interface VendorCategorySegment {
  majorCategory: string;
  vendorCount: number;
  totalSpend: number;
  companies: string[];
}

export interface VendorCategorySegmentation {
  categories: VendorCategorySegment[];
  selfMappingRequired: string[];
}

export interface VendorDispatchRecipient {
  vendorRecordId: string;
  mappingId: string;
  companyName: string;
  email: string;
  vendorCode: string;
  majorCategory: string;
  minorCategories: string[];
  status: VendorMappingStatus;
}

/** Preview separates who will be mailed from who is skipped as already sent. */
export interface VendorDispatchPreview {
  template: VendorDispatchTemplate;
  majorCategory: string;
  recipients: VendorDispatchRecipient[];
  sendable: VendorDispatchRecipient[];
  alreadySent: VendorDispatchRecipient[];
  warning: string | null;
}

export interface VendorEmailSummary {
  total: number;
  pending: number;
  queued: number;
  sent: number;
  failed: number;
  delivered: number;
  bounced: number;
}

export interface VendorDispatchRecord {
  id: string;
  sessionId: string;
  template: VendorDispatchTemplate;
  majorCategory: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  status: 'QUEUED' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  dispatchedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VendorEmailLogEntry {
  id: string;
  dispatchId: string | null;
  vendorRecordId: string | null;
  recipientEmail: string;
  recipientName: string;
  template: VendorDispatchTemplate;
  majorCategory: string;
  status: VendorEmailStatus;
  attemptCount: number;
  messageId: string;
  detail: string;
  sentAt: string | null;
  createdAt: string;
}

export interface VendorDispatchSendResult {
  session: VendorIngestionSession;
  sent: number;
  failed: number;
  skipped: number;
  perRecipient: Array<{ email: string; companyName: string; status: string; detail?: string | null }>;
  emailSummary: VendorEmailSummary;
}

export interface VendorDispatchRetryResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  emailSummary: VendorEmailSummary;
}

export interface VendorDispatchStatusResult {
  dispatches: VendorDispatchRecord[];
  logs: VendorEmailLogEntry[];
  summary: VendorEmailSummary;
}

/** Module audit entry. old/new value is what makes a change reviewable. */
export interface VendorIngestionAuditEntry {
  id: string;
  sequence: number;
  sessionId: string | null;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
}

/** One AI attempt, including failures. The prompt is never returned. */
export interface VendorAiClassificationLogEntry {
  id: string;
  vendorRecordId: string | null;
  vendorCode: string;
  model: string;
  status: string;
  attempt: number;
  promptChars: number;
  poCount: number;
  durationMs: number;
  error: string;
  createdAt: string;
}

export interface VendorIngestionCategoryMaster {
  categories: MajorMinorCategory[];
  total: number;
  isEmpty: boolean;
  reason: string | null;
}

/** Everything the wizard needs to rehydrate. `session` is null on first visit. */
export interface VendorIngestionResumeState {
  session: VendorIngestionSession | null;
  categoryMaster: MajorMinorCategory[];
  mappingSummary?: VendorMappingSummary;
  emailSummary?: VendorEmailSummary;
  poCounts?: { total: number; inHorizon: number; outsideHorizon: number };
  unlockedStep?: number;
}

/**
 * An approved mapping, read across every session.
 *
 * Consumed by the Vendor Summary screen so it can show the category a supplier is
 * genuinely empanelled under instead of guessing one from the company name.
 */
export interface ApprovedVendorMapping {
  vendorId: string | null;
  vendorRecordId: string;
  vendorCode: string;
  companyName: string;
  email: string;
  majorCategory: string;
  minorCategories: string[];
  source: VendorMappingSource | null;
  status: VendorMappingStatus;
  aiConfidence: number | null;
  confidenceBand: VendorConfidenceBand;
  aiReason: string;
  poCount: number;
  totalSpend: number;
  reviewedBy: string;
  reviewedAt: string | null;
}

// --- Client-side spreadsheet parsing -----------------------------------------

/** A parsed-and-validated Vendor Master row, before it is submitted. */
export interface ParsedVendorMasterRow {
  rowNumber: number;
  vendor: {
    vendorCode: string;
    companyName: string;
    contactPerson: string;
    email: string;
    phone: string;
    address: string;
    gstin: string;
    rating?: number;
  };
  isValid: boolean;
  errors: string[];
}

/** A parsed-and-validated PO line item, before it is submitted. */
export interface ParsedPoRow {
  rowNumber: number;
  line: {
    poNumber: string;
    poDate: string;
    vendorCode: string;
    vendorName: string;
    vendorGstin: string;
    itemDescription: string;
    specification: string;
    quantity: number;
    uom: string;
    spend: number;
    currency: string;
    department: string;
    materialCode: string;
    existingCategory: string;
    existingSubcategory: string;
  };
  isValid: boolean;
  errors: string[];
}

/** Outcome of reading a spreadsheet in the browser. Never throws. */
export interface ParseIngestionFileResult<TRow> {
  success: boolean;
  rows: TRow[];
  blankRowCount: number;
  missingColumns: string[];
  error?: string;
}

/** Progress of a chunked upload, reported after every chunk. */
export interface IngestionUploadProgress {
  chunksSent: number;
  totalChunks: number;
  rowsSubmitted: number;
  rowsStored: number;
  rowsRejected: number;
}

export interface VendorOnboardingEmailPayload {
  emailId: string;
  vendorId: string;
  vendorName: string;
  recipientEmail: string;
  contactPerson: string;
  buyerCompanyName: string;
  buyerContactName: string;
  buyerContactEmail: string;
  isExistingInDatabase: boolean;
  subject: string;
  username: string;
  tempPassword: string;
  authInstructions: string;
  profileUpdateInstructions: string;
  categoryUpdateInstructions: string;
  
  // Categorization status
  hasPoHistory: boolean;
  categoriesMappedByBuyer: boolean;
  unmappedSelfServiceMessage?: string;
  
  // Highlighted Assigned Categories by Buyer (1st Set Major & 2nd Set Minor Categories)
  assignedMajorCategory: string;
  assignedMinorCategories: string[];
  assignedSecondaryMajors?: string[];
  
  reminderScheduleNote: string;
  dispatchedAt: string;
  nextReminderDate: string;
  portalLoginUrl: string;
  shaSignature: string;
  reminderCount: number;
}

export interface VendorProfileReminderPayload {
  reminderId: string;
  vendorId: string;
  vendorName: string;
  recipientEmail: string;
  buyerCompanyName: string;
  buyerContactName: string;
  dayNumber: number; // 3, 6, 9, etc.
  subject: string;
  message: string;
  username: string;
  dispatchedAt: string;
  nextReminderDate: string;
  shaSignature: string;
}

export interface StandardRFQEmailPayload {
  emailId: string;
  rfqNumber: string;
  rfqTitle: string;
  sourcingMode: SourcingMode;
  sourcingModeName: string;
  sourcingModeCode: string;
  buyerCompany: string;
  buyerContactName: string;
  buyerContactEmail: string;
  buyerContactPhone: string;
  recipientVendorName: string;
  recipientContactPerson: string;
  recipientEmail: string;
  subject: string;
  matchedMajorCategory: string;
  matchedMinorCategories: string[];
  requisitionDate: string;
  submissionDeadline: string;
  targetDeliveryDate: string;
  deliveryLocation: string;
  paymentTerms: string;
  lineItems: Array<{
    itemNumber: number;
    itemName: string;
    technicalSpecs: string;
    quantity: number;
    unit: string;
    minorCategory: string;
    targetDate: string;
  }>;
  specialInstructions: string;
  complianceChecklist: string[];
  replyInstructions: string;
  replyToEmail: string;
  shaSignature: string;
  dispatchedAt: string;
}

export interface BuyerAccount {
  id: string;
  organizationName: string;
  brandName?: string;
  corporateEmail: string;
  contactPerson: string;
  contactDesignation?: string;
  mobileNumber: string;
  gstin: string;
  panNumber?: string;
  cinNumber?: string;
  industrySector: string;
  sourcingMode: SourcingMode;
  subscriptionPlan: 'free_trial' | 'version_1' | 'version_2' | 'version_3';
  remainingFreeRFQs: number;
  accountSource: 'public_system' | 'web_registration' | 'enterprise_sso';
  status: 'ACTIVE_VERIFIED' | 'PENDING_ALIGNMENT' | 'SYNCED_LEGACY';
  primaryPlantLocation: string;
  supportedMajorCategories: string[];
  supportedMinorCategories?: string[];
  totalRFQsCreated: number;
  totalSpend: string;
  syncTimestamp: string;
  createdDate: string;
  
  // Historical purchase data ingestion & initial setup tracking
  initialSetupCompleted?: boolean;
  historicalDataPeriod?: '1_year' | '2_years' | '3_years';
  historicalVendorsCount?: number;
}

export interface DBHealthStatus {
  connected: boolean;
  isConnected?: boolean;
  isConfigured?: boolean;
  providerLabel?: string;
  latencyMs?: number;
  poolStatus?: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  };
  tablesCount?: number;
  totalRecords?: {
    buyerAccounts?: number;
    vendors?: number;
    rfqs?: number;
    evaluations?: number;
    auditLogs?: number;
  };
  uptime?: string;
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt?: string;
  algorithm: string;
  version: string;
  encoded?: string;
}

export interface AESEncryptionOptions {
  secretKey?: string;
  salt?: string;
  additionalData?: string;
  encoding?: 'hex' | 'base64';
}

export interface DecryptionResult<T = string> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CryptoHealthStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  algorithm: string;
  keyLengthBits: number;
  roundtripVerified: boolean;
  tamperDetectionVerified: boolean;
  timestamp: string;
}

// Authentication & Session Types
export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  orgId: string;
  orgName: string;
  mobile?: string;
  authMethod?: 'PASSWORD' | 'EMAIL_OTP' | 'TEMP_PASSWORD' | 'INSTANT_DEMO';
}

// ═══════════════════════════════════════════════════════════════════════
// RFQ Ingestion & Portfolio Summary Types
// ═══════════════════════════════════════════════════════════════════════

/** Why an ingested line item landed in its category, surfaced in the review grid. */
export type RFQClassificationStatus = 'AI_EXTRACTED' | 'DOMAIN_KEYWORD_MATCHED' | 'DEFAULT';

/** Per-ingest breakdown returned by POST /api/rfqs/ingest. */
export interface RFQIngestionClassification {
  totalExtracted: number;
  accepted: number;
  duplicatesRemoved: number;
  needsReview: number;
  autoClassified: number;
}

/** Draft RFQ header + classified line items returned by POST /api/rfqs/ingest. */
export interface RFQIngestionDraft {
  title: string;
  category: string;
  targetDeliveryDate: string;
  /**
   * Overall value read off the document: a stated grand total, else the sum of
   * the priced line items. Null when the document carried no pricing at all, in
   * which case the buyer supplies the figure on the review step.
   */
  estimatedBudget: number | null;
  extractedEntities: ExtractedEntity[];
  source: RFQSource;
  sourceFileName?: string;
  sourceEmail?: string;
  deliveryLocation?: string;
  deliveryPincode?: string;
}

/** Why an AI extraction attempt did not yield line items. */
export type RFQExtractionReason =
  | 'NOT_CONFIGURED'
  | 'NO_CONTENT'
  | 'DOCUMENT_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'AI_FAILED'
  | 'NO_ITEMS_FOUND'
  | 'NETWORK';

/** Outcome recorded against one message the autonomous gateway considered. */
export type EmailGatewayOutcome =
  | 'INGESTED'
  | 'SENDER_NOT_ALLOWED'
  | 'NO_LINE_ITEMS'
  | 'UNREADABLE'
  | 'FAILED';

/** One row of the gateway's ingestion ledger. */
export interface EmailGatewayLogEntry {
  message_id: string;
  rfq_id: string | null;
  rfq_number: string | null;
  from_address: string | null;
  subject: string | null;
  status: EmailGatewayOutcome;
  detail: string | null;
  processed_at: string;
}

/**
 * State of the autonomous mailbox watcher.
 *
 * Carries no credentials — only the account being watched, which the buyer needs
 * in order to know where to send requisitions.
 */
/** Gateway connection state, as reported by the server. */
export type EmailGatewayConnectionState =
  | 'ACTIVE_LISTENING'
  | 'CONNECTION_ERROR'
  | 'SWITCHED_OFF'
  | 'NOT_CONFIGURED';

export interface EmailGatewayStatus {
  enabled: boolean;
  configured: boolean;
  watching: boolean;
  connectionState: EmailGatewayConnectionState;
  /** The Procucev intake address buyers send their requisition TO. */
  gatewayAddress: string | null;
  /** IMAP account the backend collects from. Operational detail, not a destination. */
  mailboxUser: string | null;
  /** Mail older than this is never considered, so an existing backlog is left alone. */
  watchingSince: string;
  mailbox: string;
  host: string | null;
  pollIntervalMs: number;
  /** Empty means any sender that maps to a registered buyer account. */
  allowedSenders: string[];
  allowedDomains: string[];
  lastPollAt: string | null;
  lastPollDurationMs: number | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  isPolling: boolean;
  counts: Partial<Record<EmailGatewayOutcome, number>>;
  recent: EmailGatewayLogEntry[];
  /** Status an ingested RFQ is parked in for review. */
  ingestedStatus: string;
}

/** Result of one mailbox check. */
export interface EmailGatewayPollResult {
  considered: number;
  ingested: number;
  pending: number;
}

export interface RFQEmailMetadata {
  messageId: string;
  subject: string;
  fromAddress: string;
  fromName: string;
  toAddress: string;
  sentAt: string | null;
  attachmentNames: string[];
}

/**
 * Document posted to POST /api/rfqs/extract. Spreadsheets are flattened to text
 * in the browser; PDFs and images travel as base64 with their MIME type.
 */
export interface RFQExtractionRequest {
  fileName: string;
  documentText?: string;
  inlineData?: string;
  mimeType?: string;
}

/** Which model produced the extraction, for display in the review step. */
export interface RFQExtractionMeta {
  model: string;
  deliveryDate?: string | null;
}

export interface RFQExtractionResult {
  success: boolean;
  data?: RFQIngestionDraft;
  classification?: RFQIngestionClassification;
  extraction?: RFQExtractionMeta;
  reason?: RFQExtractionReason;
  error?: string;
}

/** Outcome of storing one supporting document. */
export interface RFQAttachmentResult {
  success: boolean;
  data?: RFQAttachment;
  error?: string;
}

export interface RFQIngestionResponse {
  success: boolean;
  data?: RFQIngestionDraft;
  classification?: RFQIngestionClassification;
  error?: string;
}

/** Multi-channel follow-up roll-up across the whole RFQ portfolio. */
export interface RFQPortfolioFollowUps {
  vendorsInvited: number;
  vendorsResponded: number;
  calls: number;
  callsConnected: number;
  whatsapp: number;
  whatsappRead: number;
  sms: number;
}

/** Aggregated portfolio metrics backing the buyer RFQ Summary screen. */
export interface RFQPortfolioSummary {
  totalRFQs: number;
  activeRFQs: number;
  awaitingQuotes: number;
  totalQuotesReceived: number;
  totalBudget: number;
  averageQuotesPerRFQ: number;
  byStatus: Record<string, number>;
  bySourcingMode: Record<string, number>;
  bySource: Record<string, number>;
  followUps: RFQPortfolioFollowUps;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  token?: string;
  user?: UserSession;
  error?: string;
  demoCode?: string;
  expiresInSeconds?: number;
}

export interface LoginCredentials {
  email: string;
  /** Registered mobile number, verified alongside the password at sign-in. */
  mobile?: string;
  password?: string;
  code?: string;
  role?: UserRole;
}

export interface OtpRequestPayload {
  email: string;
  /** Registered mobile number the code is issued against. */
  mobile: string;
  roleHint?: UserRole;
}

export interface OtpVerifyPayload {
  email: string;
  code: string;
  /** Must match the mobile number the code was requested with. */
  mobile: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password?: string;
  mobile?: string;
  role?: UserRole;
  orgName?: string;
}


// ═══════════════════════════════════════════════════════════════════════
// Sidebar Dashboard Navigation Types (Role Workspace Shell)
// ═══════════════════════════════════════════════════════════════════════

export type SidebarIconKey =
  | 'Building2'
  | 'SlidersHorizontal'
  | 'Truck'
  | 'Cpu'
  | 'Layers'
  | 'Sparkles'
  | 'Kanban'
  | 'TrendingUp'
  | 'FileSpreadsheet'
  | 'FileCheck'
  | 'ShieldCheck'
  | 'Server'
  | 'Award'
  | 'ClipboardList'
  | 'Database'
  | 'Receipt';

export interface SidebarNavItem {
  /** Active screen key consumed by the screen switchboard */
  id: string;
  /** Full screen reference used for accessible names (e.g. "Screen 1.1") */
  screenTag?: string;
  /** Compact screen reference rendered as a sidebar badge (e.g. "1.1") */
  shortTag?: string;
  label: string;
  description: string;
  icon: SidebarIconKey;
  /** Section heading key the item is grouped under */
  group: string;
  /** Application URL this module is served at, e.g. "/buyer/command-center" */
  route: string;
}

export interface RoleWorkspaceMeta {
  accentText: string;
  accentActive: string;
  accentRing: string;
}

export interface RoleNavigationProps {
  /** Optional sign-out handler rendered in the rail footer. */
  onLogout?: () => void;
}
