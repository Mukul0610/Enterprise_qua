'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  UserRole,
  SourcingMode,
  RFQItem,
  NewRFQInput,
  AIBotFeedItem,
  VendorOpportunity,
  AuditLogEntry,
  AzureServiceHealth,
  SystemConfig,
  QuoteComparison,
  VendorEvaluationRecord,
  VendorSubscriptionPlan,
  VendorEntry,
  StandardRFQEmailPayload,
  VendorOnboardingEmailPayload,
  VendorProfileReminderPayload,
  HistoricalPurchaseVendorRecord,
  IngestionSummary,
  ExtractedEntity,
  BuyerAccount,
  VendorRatingRevisionRecord,
  VendorRatingRevisionEmailPayload,
  UserSession,
  RFQUpdatePayload,
  MajorMinorCategory,
  RFQFollowUpBreakdown,
  VendorFollowUpRecord,
} from './types';
import { authClient } from './authClient';
import { installApiFetchPatch } from './apiFetchPatch';

installApiFetchPatch();
import {
  createPaymentLink,
  createBuyerPaymentLink as createBuyerPaymentLinkRequest,
  getVendorPaymentLinkStatus,
  getBuyerPaymentLinkStatus,
} from './subscriptionPaymentClient';
import { fetchCategoryTaxonomy } from './buyerProfileClient';
import { setCategoryTaxonomy, clearCategoryTaxonomy } from './categoryTaxonomy';
import { UI_STRINGS, formatString } from './uiStrings';
import {
  createRFQ,
  fetchRFQList,
  updateRFQ as updateRFQRequest,
  deleteRFQ as deleteRFQRequest,
  fetchVendorRfqCredits,
  downloadAndUnlockRFQ,
} from './rfqClient';
import {
  SOURCING_MODES,
  INITIAL_SYSTEM_CONFIG,
  INITIAL_AZURE_HEALTH,
  formatCurrency,
} from './constants';

// Backend write endpoints now require a session token (Phase 4 authorization
// hardening) — every fetch() that mutates data needs this attached.
function authFetchHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Whole days between now and a target delivery date.
 *
 * The vendor-facing feed used to hardcode `daysRemaining: 7` on every RFQ,
 * which put a countdown in front of suppliers that had nothing to do with the
 * buyer's actual deadline. An unparseable or absent date yields 0 rather than
 * an invented figure.
 */
/**
 * Project a real RFQ onto the vendor-facing opportunity it becomes.
 *
 * Every field here is read off the RFQ record itself. Both call sites (initial
 * hydration and a freshly created RFQ) previously invented the buyer name, the
 * delivery location and the countdown, and hydration additionally substituted a
 * flat ₹1,50,000 whenever the buyer had stated no budget — putting a ceiling in
 * front of vendors that the buyer never set. An RFQ with no budget now simply
 * carries no estimated value, exactly as `RFQItem.budget` documents.
 */
function buildOpportunityFromRFQ(rfq: RFQItem): VendorOpportunity {
  return {
    id: `opp-${rfq.id}`,
    rfqNumber: rfq.rfqNumber,
    title: rfq.title,
    buyer: rfq.buyerAccountName || 'Buyer identity not disclosed',
    buyerAccountId: rfq.buyerAccountId,
    deadline: rfq.targetDeliveryDate || '',
    daysRemaining: daysUntilDate(rfq.targetDeliveryDate),
    type: rfq.sourcingMode === 'mode_3' ? 'network_marketplace' : 'direct_invitation',
    estimatedValue: rfq.budget > 0 ? formatCurrency(rfq.budget) : undefined,
    deliveryLocation: rfq.deliveryLocation || '',
    status: rfq.quotes && rfq.quotes.length > 0 ? 'under_review' : 'pending_bid',
    majorCategory: rfq.category || '',
    minorCategory: rfq.extractedEntities?.[0]?.minorCategory || '',
    lineItems: (rfq.extractedEntities || []).map((ent: ExtractedEntity, idx: number) => ({
      id: ent.id || `item-${idx}`,
      description: ent.itemName,
      quantity: ent.quantity,
      unit: ent.unit || undefined,
      // Price, lead time and payment terms are the vendor's own bid fields and
      // stay empty until they actually quote — seeding them with 14 days and
      // "Net 30" showed a commitment nobody had made.
      unitPrice: 0,
      leadTimeDays: 0,
      marketBandStatus: 'optimal',
      paymentTerms: '',
    })),
  };
}

interface AppContextType {
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  isLoggedIn: boolean;
  setIsLoggedIn: (loggedIn: boolean) => void;
  currentUserSession: UserSession | null;
  setCurrentUserSession: (session: UserSession | null) => void;
  currentMode: SourcingMode;
  setCurrentMode: (mode: SourcingMode) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  rfqs: RFQItem[];
  aiFeed: AIBotFeedItem[];
  vendorOpportunities: VendorOpportunity[];
  auditLogs: AuditLogEntry[];
  azureHealth: AzureServiceHealth[];
  systemConfig: SystemConfig;
  setSystemConfig: React.Dispatch<React.SetStateAction<SystemConfig>>;
  isLoadingDB: boolean;
  dbConnected: boolean;
  refreshFromDB: () => Promise<void>;
  refreshRFQs: () => Promise<void>;
  refreshAIFeed: () => Promise<void>;
  refreshActiveBuyerAccount: () => Promise<void>;

  // Procurement category master, read from the database. Empty until loaded —
  // there is no bundled copy to fall back to, so a screen shows "no categories
  // available" plus `categoryTaxonomyError` rather than a possibly-stale list.
  categoryTaxonomy: MajorMinorCategory[];
  categoryTaxonomyError: string | null;
  isLoadingCategoryTaxonomy: boolean;
  refreshCategoryTaxonomy: () => Promise<void>;

  // Integrated Buyer Accounts & Public System Database
  buyerAccounts: BuyerAccount[];
  activeBuyerAccount: BuyerAccount | null;
  /** Real Zoho payment-link creation for the caller's own buyer account. Returns the URL to redirect to, or null on failure (a toast is already shown). */
  createBuyerPaymentLink: (plan: string) => Promise<string | null>;
  /** Real status ('CREATED'|'PAID'|'CANCELED'|'EXPIRED') of one of the caller's own buyer payment links, or null if it can't be resolved. */
  checkBuyerPaymentLinkStatus: (linkId: string) => Promise<string | null>;
  addBuyerAccount: (account: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>) => BuyerAccount;
  updateBuyerAccount: (id: string, updates: Partial<BuyerAccount>) => void;
  deleteBuyerAccount: (id: string) => void;
  alignActiveBuyerAccount: (accountId: string) => void;
  importPublicBuyerDatabase: (accounts: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>[]) => number;

  // Initial Setup & Historical Purchase Data Ingestion (1, 2, or 3 Years)
  initialSetupModalOpen: boolean;
  setInitialSetupModalOpen: (open: boolean) => void;
  initialSetupCompleted: boolean;
  setInitialSetupCompleted: (completed: boolean) => void;
  historicalPurchaseDataPeriod: '1_year' | '2_years' | '3_years';
  setHistoricalPurchaseDataPeriod: (period: '1_year' | '2_years' | '3_years') => void;
  processHistoricalPurchaseData: (period: '1_year' | '2_years' | '3_years', vendors: HistoricalPurchaseVendorRecord[]) => Promise<number>;
  lastIngestionSummary: IngestionSummary | null;
  setLastIngestionSummary: (summary: IngestionSummary | null) => void;

  // Buyer Uploaded Vendors, Database Check & Automated Onboarding Emails
  buyerVendors: VendorEntry[];
  addBuyerVendor: (vendor: Omit<VendorEntry, 'id'>) => Promise<VendorEntry | null>;
  updateBuyerVendor: (vendorId: string, updates: Partial<VendorEntry>) => void;
  deleteBuyerVendor: (vendorId: string) => void;
  matchSuitableVendors: (entities: ExtractedEntity[], mode: SourcingMode, customList?: VendorEntry[]) => VendorEntry[];
  generateVendorOnboardingEmail: (vendor: VendorEntry, isExisting: boolean, tempPassword?: string) => VendorOnboardingEmailPayload;
  selectedOnboardingEmail: VendorOnboardingEmailPayload | null;
  setSelectedOnboardingEmail: (email: VendorOnboardingEmailPayload | null) => void;
  onboardingEmailModalOpen: boolean;
  setOnboardingEmailModalOpen: (open: boolean) => void;
  openOnboardingEmailModal: (vendor: VendorEntry) => void;
  triggerVendorReminder: (vendorId: string) => void;
  completeVendorProfile: (vendorEmail: string, updatedCategories?: string[]) => void;

  // Dual-Stream Category Reconciliation (Client-Mapped vs Vendor-Selected up to 10)
  clientMappedCategories: string[];
  setClientMappedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  vendorSelectedCategories: string[];
  setVendorSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  saveVendorProfileCategories: (email: string, clientCats: string[], vendorCats: string[]) => void;

  // Standard RFQ Email Engine
  generateStandardRFQEmail: (rfq: RFQItem, vendor: VendorEntry) => StandardRFQEmailPayload;
  selectedEmailForModal: StandardRFQEmailPayload | null;
  setSelectedEmailForModal: (email: StandardRFQEmailPayload | null) => void;
  emailModalOpen: boolean;
  setEmailModalOpen: (open: boolean) => void;
  openStandardEmailModal: (rfq: RFQItem, vendor?: VendorEntry) => void;

  // Buyer Vendor Rating Revision Engine
  reviseVendorRating: (vendorId: string, qualityScore: number, costScore: number, deliveryScore: number, remarks: string) => Promise<VendorRatingRevisionRecord | null>;
  selectedRatingRevisionEmail: VendorRatingRevisionEmailPayload | null;
  setSelectedRatingRevisionEmail: (email: VendorRatingRevisionEmailPayload | null) => void;
  ratingRevisionEmailModalOpen: boolean;
  setRatingRevisionEmailModalOpen: (open: boolean) => void;
  openRatingRevisionEmailModal: (revision: VendorRatingRevisionRecord) => void;

  // Actions
  /**
   * Persist an RFQ and adopt the server's record.
   *
   * Async because the API is the authority on the RFQ number, the row id, the
   * created timestamp and the generated summary. Rejects when the save fails, so
   * no RFQ appears on screen that the database does not hold.
   */
  addNewRFQ: (rfq: NewRFQInput, customMatchedVendors?: VendorEntry[]) => Promise<RFQItem>;
  /**
   * Take a server-created RFQ into local state exactly as returned.
   *
   * Used by flows that post to the API themselves. The server owns the RFQ
   * number, the row id, the created timestamp and the generated summary, so the
   * record is adopted rather than rebuilt — the old fire-and-forget POST threw
   * the response away and left the browser and the database disagreeing about
   * the same RFQ.
   */
  adoptCreatedRFQ: (rfq: RFQItem) => void;
  /**
   * Apply an edit to one RFQ and adopt the stored result.
   *
   * Resolves with the record the API saved, or throws with the reason. Local state
   * is only touched on success, so a rejected edit never leaves the dashboard
   * showing a change the database does not hold.
   */
  updateRFQ: (identifier: string, changes: RFQUpdatePayload) => Promise<RFQItem>;
  /**
   * Delete one RFQ and drop it from local state.
   *
   * Throws with the reason on failure, so the row stays on screen rather than
   * disappearing from a list the database still holds it in.
   */
  deleteRFQ: (identifier: string) => Promise<void>;
  triggerWhatsAppChaser: (rfqNumber: string, vendorName?: string) => void;
  triggerChannelChaser: (rfqNumber: string, channel: 'call' | 'whatsapp' | 'sms' | 'email', vendorName?: string, customNote?: string, suppressToast?: boolean) => void;
  triggerBatchChannelChaser: (rfqNumber: string, channels: ('call' | 'whatsapp' | 'sms')[], suppressToast?: boolean) => void;
  submitVendorBid: (rfqNumber: string, unitPrice: number, leadTimeDays: number, remarks: string) => void;
  approvePO: (
    rfqNumber: string,
    vendorId: string | null,
    vendorName: string,
    amount: number,
    approverNotes?: string
  ) => Promise<{ success: boolean; poNumber?: string; issueDate?: string; shaSignature?: string; lineItems?: { description: string; quantity: number; unit: string }[]; error?: string }>;
  addAuditLog: (action: string, rfqNumber?: string, user?: string) => void;
  addFeedItem: (title: string, message: string, type: AIBotFeedItem['type'], rfqNumber?: string, recipient?: string, channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system', channelDetails?: AIBotFeedItem['channelDetails']) => void;
  selectedRFQForMatrix: RFQItem | null;
  setSelectedRFQForMatrix: (rfq: RFQItem | null) => void;
  /** Opportunity carried from the vendor feed into the quotation form route. */
  selectedVendorOpportunity: VendorOpportunity | null;
  setSelectedVendorOpportunity: (opp: VendorOpportunity | null) => void;
  /** Evaluation carried from the vendor directory into the summary route. */
  activeEvaluationRecord: VendorEvaluationRecord | null;
  setActiveEvaluationRecord: (record: VendorEvaluationRecord | null) => void;
  selectedRFQForDeepDive: RFQItem | null;
  setSelectedRFQForDeepDive: (rfq: RFQItem | null) => void;
  deepDiveModalOpen: boolean;
  setDeepDiveModalOpen: (open: boolean) => void;
  openRFQDeepDive: (rfq: RFQItem) => void;
  vendorEvaluations: VendorEvaluationRecord[];
  addVendorEvaluation: (record: VendorEvaluationRecord) => Promise<boolean>;
  selectedVendorEvaluation: VendorEvaluationRecord | null;
  setSelectedVendorEvaluation: (evalRecord: VendorEvaluationRecord | null) => void;
  evaluationModalOpen: boolean;
  setEvaluationModalOpen: (open: boolean) => void;
  openVendorEvaluationSummary: (evalRecord: VendorEvaluationRecord) => void;

  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;

  // Toast notifications
  toastMessage: { title: string; description: string; type: 'success' | 'info' | 'warning' } | null;
  showToast: (title: string, description: string, type?: 'success' | 'info' | 'warning') => void;
  dismissToast: () => void;

  // Sourcing Free Tier RFQ Limits (Max 5 for Version 1 Free Trial)
  remainingFreeRFQs: number;
  setRemainingFreeRFQs: React.Dispatch<React.SetStateAction<number>>;
  activeSubscription: 'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none';
  setActiveSubscription: React.Dispatch<React.SetStateAction<'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none'>>;
  vendorSubscription: VendorSubscriptionPlan;
  setVendorSubscription: React.Dispatch<React.SetStateAction<VendorSubscriptionPlan>>;
  updateVendorSubscription: (plan: 'premium' | 'connect' | 'select') => Promise<boolean>;
  /** Real Zoho payment-link creation for the caller's own vendor profile. Returns the URL to redirect to, or null on failure (a toast is already shown). */
  createVendorPaymentLink: (plan: string) => Promise<string | null>;
  /** Real status ('CREATED'|'PAID'|'CANCELED'|'EXPIRED') of one of the caller's own vendor payment links, or null if it can't be resolved. */
  checkVendorPaymentLinkStatus: (linkId: string) => Promise<string | null>;
  vendorRfqDownloadsUsed: number;
  setVendorRfqDownloadsUsed: React.Dispatch<React.SetStateAction<number>>;
  vendorCatalogue: any[];
  setVendorCatalogue: React.Dispatch<React.SetStateAction<any[]>>;

  // Vendor Free RFQ Download Credits (5 Free Starter Allowance)
  vendorFreeCreditsRemaining: number;
  vendorFreeCreditsAllocated: number;
  vendorFreeCreditsUsed: number;
  vendorUnlockedRfqIds: string[];
  refreshVendorCredits: () => Promise<void>;
  unlockRFQForVendor: (rfqIdOrNumber: string) => Promise<{ success: boolean; error?: string; exhausted?: boolean; alreadyUnlocked?: boolean }>;

  // Vendor 360° AI Self-Evaluation & Infra Fee ($5 or $0 with Connect/Select)
  vendorSelfEvaluationCompleted: boolean;
  setVendorSelfEvaluationCompleted: (completed: boolean) => void;
  vendorSelfEvaluationScore: number;
  setVendorSelfEvaluationScore: (score: number) => void;
  isVendorEvaluationFeeWaived: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Helper to generate realistic SHA-256 format strings

/** Whole days from today until a target date, or 0 when there is no date. */
function daysUntilDate(target?: string): number {
  if (!target) return 0;
  const parsed = Date.parse(target);
  if (Number.isNaN(parsed)) return 0;
  const MS_PER_DAY = 86400000;
  const todayUtc = Date.parse(new Date().toISOString().slice(0, 10));
  return Math.round((Date.parse(target.slice(0, 10)) - todayUtc) / MS_PER_DAY);
}

function generateShaHash(): string {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return hash;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Session bootstrap. The only source of truth is the token + session that
  // authClient persisted after a verified sign-in, so a page refresh on a deep
  // route keeps the user signed in and nobody is ever signed in by default.
  const restoredSession = authClient.getSessionUser();
  const hasValidToken = !!authClient.getToken();

  const [currentUserSession, setCurrentUserSession] = useState<UserSession | null>(
    hasValidToken ? restoredSession : null
  );
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(hasValidToken && !!restoredSession);
  const [currentRole, setCurrentRole] = useState<UserRole>(
    hasValidToken && restoredSession ? restoredSession.role : 'buyer'
  );
  const [currentMode, setCurrentMode] = useState<SourcingMode>('mode_2');
  const [activeTab, setActiveTab] = useState<string>('command_center');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Subscription State
  const [remainingFreeRFQs, setRemainingFreeRFQs] = useState<number>(5);
  const [activeSubscription, setActiveSubscription] = useState<'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none'>('free_trial');
  const [vendorSubscription, setVendorSubscription] = useState<VendorSubscriptionPlan>('premium');
  // Was a fabricated "already used 3" starting point — real usage is hydrated
  // from the vendor's actual record in refreshFromDB once it loads.
  const [vendorRfqDownloadsUsed, setVendorRfqDownloadsUsed] = useState<number>(0);

  // Was pure local state (setVendorSubscription called directly) — reset on
  // every page refresh and never persisted anywhere. Now calls the real
  // PUT /api/vendors/:id/subscription and only updates local state once the
  // backend confirms it, mirroring the vendor rating-revision fix.
  const updateVendorSubscription = async (plan: 'premium' | 'connect' | 'select'): Promise<boolean> => {
    const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
    const myVendor = buyerVendors.find((v) => v.email?.toLowerCase() === sessionEmail);
    if (!myVendor) {
      showToast('Subscription Update Failed', 'Could not find your vendor profile.', 'warning');
      return false;
    }

    let res: Response;
    try {
      res = await fetch(`/api/vendors/${encodeURIComponent(myVendor.id)}/subscription`, {
        method: 'PUT',
        headers: authFetchHeaders(),
        body: JSON.stringify({ plan }),
      });
    } catch (e) {
      console.error('Failed to update vendor subscription:', e);
      showToast('Subscription Update Failed', 'Could not reach the server. Please try again.', 'warning');
      return false;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      showToast(
        'Subscription Update Failed',
        data?.error || 'Could not update your subscription. Please try again.',
        'warning'
      );
      return false;
    }

    setVendorSubscription(plan);
    setVendorRfqDownloadsUsed(data.data.rfqDownloadsUsed || 0);
    setBuyerVendors((prev) => prev.map((v) => (v.id === myVendor.id ? { ...v, ...data.data } : v)));
    return true;
  };

  const createVendorPaymentLink = async (plan: string): Promise<string | null> => {
    const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
    const myVendor = buyerVendors.find((v) => v.email?.toLowerCase() === sessionEmail);
    if (!myVendor) {
      showToast('Payment Failed', 'Could not find your vendor profile.', 'warning');
      return null;
    }

    const result = await createPaymentLink(myVendor.id, plan);
    if (!result.success) {
      showToast('Payment Failed', result.error, 'warning');
      return null;
    }
    return result.paymentUrl;
  };

  const createBuyerPaymentLink = async (plan: string): Promise<string | null> => {
    if (!activeBuyerAccount?.id) {
      showToast('Payment Failed', 'Could not find your buyer account.', 'warning');
      return null;
    }

    const result = await createBuyerPaymentLinkRequest(activeBuyerAccount.id, plan);
    if (!result.success) {
      showToast('Payment Failed', result.error, 'warning');
      return null;
    }
    return result.paymentUrl;
  };

  const checkVendorPaymentLinkStatus = async (linkId: string): Promise<string | null> => {
    const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
    const myVendor = buyerVendors.find((v) => v.email?.toLowerCase() === sessionEmail);
    if (!myVendor) return null;
    return getVendorPaymentLinkStatus(myVendor.id, linkId);
  };

  const checkBuyerPaymentLinkStatus = async (linkId: string): Promise<string | null> => {
    if (!activeBuyerAccount?.id) return null;
    return getBuyerPaymentLinkStatus(activeBuyerAccount.id, linkId);
  };

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') {
        localStorage.setItem('procucev_theme', next);
      }
      return next;
    });
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('procucev_theme') as 'light' | 'dark' | null;
      if (saved && (saved === 'light' || saved === 'dark')) {
        setTheme(saved);
      } else {
        setTheme('light');
        localStorage.setItem('procucev_theme', 'light');
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (theme === 'light') {
        root.classList.add('light');
        root.classList.remove('dark');
      } else {
        root.classList.add('dark');
        root.classList.remove('light');
      }
    }
  }, [theme]);

  // PostgreSQL Real Database Hydration & Telemetry State
  const [isLoadingDB, setIsLoadingDB] = useState<boolean>(true);
  const [dbConnected, setDbConnected] = useState<boolean>(false);

  const [rfqs, setRfqs] = useState<RFQItem[]>([]);
  const [aiFeed, setAiFeed] = useState<AIBotFeedItem[]>([]);
  const [vendorOpportunities, setVendorOpportunities] = useState<VendorOpportunity[]>([]);
  const [buyerVendors, setBuyerVendors] = useState<VendorEntry[]>([]);
  const [buyerAccounts, setBuyerAccounts] = useState<BuyerAccount[]>([]);
  const [activeBuyerAccount, setActiveBuyerAccount] = useState<BuyerAccount | null>(null);
  const [selectedEmailForModal, setSelectedEmailForModal] = useState<StandardRFQEmailPayload | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState<boolean>(false);

  // Vendor 360° AI Self-Evaluation & Infra Fee State
  const [vendorSelfEvaluationCompleted, setVendorSelfEvaluationCompleted] = useState<boolean>(false);
  const [vendorSelfEvaluationScore, setVendorSelfEvaluationScore] = useState<number>(94.5);

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [azureHealth, setAzureHealth] = useState<AzureServiceHealth[]>(INITIAL_AZURE_HEALTH);
  // Starts empty on purpose. The bundled categories.json this replaced meant a
  // screen could always render a full category tree, including when the master had
  // changed underneath it or the API was down.
  const [categoryTaxonomy, setCategoryTaxonomyState] = useState<MajorMinorCategory[]>([]);
  const [categoryTaxonomyError, setCategoryTaxonomyError] = useState<string | null>(null);
  const [isLoadingCategoryTaxonomy, setIsLoadingCategoryTaxonomy] = useState<boolean>(false);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(INITIAL_SYSTEM_CONFIG);
  const [selectedRFQForMatrix, setSelectedRFQForMatrix] = useState<RFQItem | null>(null);
  const [selectedVendorOpportunity, setSelectedVendorOpportunity] = useState<VendorOpportunity | null>(null);
  const [activeEvaluationRecord, setActiveEvaluationRecord] = useState<VendorEvaluationRecord | null>(null);
  const [selectedRFQForDeepDive, setSelectedRFQForDeepDive] = useState<RFQItem | null>(null);
  const [deepDiveModalOpen, setDeepDiveModalOpen] = useState<boolean>(false);

  const [vendorEvaluations, setVendorEvaluations] = useState<VendorEvaluationRecord[]>([]);
  const [selectedVendorEvaluation, setSelectedVendorEvaluation] = useState<VendorEvaluationRecord | null>(null);
  const [evaluationModalOpen, setEvaluationModalOpen] = useState<boolean>(false);

  // Vendor Free RFQ Download Credits (5 Free Starter Allowance)
  const [vendorFreeCreditsRemaining, setVendorFreeCreditsRemaining] = useState<number>(5);
  const [vendorFreeCreditsAllocated, setVendorFreeCreditsAllocated] = useState<number>(5);
  const [vendorFreeCreditsUsed, setVendorFreeCreditsUsed] = useState<number>(0);
  const [vendorUnlockedRfqIds, setVendorUnlockedRfqIds] = useState<string[]>([]);

  const refreshVendorCredits = async () => {
    if (!authClient.getToken()) return;
    try {
      const res = await fetchVendorRfqCredits();
      if (res.success && res.data) {
        setVendorFreeCreditsRemaining(res.data.freeCreditsRemaining ?? 5);
        setVendorFreeCreditsAllocated(res.data.freeCreditsAllocated ?? 5);
        setVendorFreeCreditsUsed(res.data.freeCreditsUsed ?? 0);
        setVendorUnlockedRfqIds(res.data.unlockedRfqIds || []);
      }
    } catch (err) {
      console.error('Failed to refresh vendor RFQ credits:', err);
    }
  };

  const unlockRFQForVendor = async (rfqIdOrNumber: string) => {
    const res = await downloadAndUnlockRFQ(rfqIdOrNumber);
    if (res.success) {
      if (res.freeCreditsRemaining !== undefined) {
        setVendorFreeCreditsRemaining(res.freeCreditsRemaining);
        setVendorFreeCreditsUsed(Math.max(0, 5 - res.freeCreditsRemaining));
      }
      setVendorUnlockedRfqIds((prev) => {
        const norm = String(rfqIdOrNumber);
        return prev.includes(norm) ? prev : [...prev, norm];
      });
      return { success: true, alreadyUnlocked: res.alreadyUnlocked };
    }
    return {
      success: false,
      error: res.error,
      exhausted: res.exhausted,
      alreadyUnlocked: false,
    };
  };

  /**
   * Load this buyer organisation's RFQs from the authenticated API.
   *
   * RFQs are no longer in the bootstrap payload. That endpoint is anonymous, and
   * shipping the global RFQ array from it is what put one buyer's RFQs on another
   * buyer's dashboard. `GET /api/rfqs` is authenticated and scoped to the caller's
   * organisation, so it returns only what this buyer raised.
   *
   * Signed out, this clears the list rather than leaving a previous session's RFQs
   * on screen.
   */
  const refreshRFQs = async () => {
    if (!authClient.getToken()) {
      setRfqs([]);
      setVendorOpportunities([]);
      return;
    }

    const result = await fetchRFQList();
    if (!result.success) {
      // Reported rather than silently swallowed, but the list is left alone: a
      // transient failure should not blank a dashboard the buyer is reading.
      console.error('Failed to load RFQs:', result.error);
      return;
    }

    setRfqs(result.rfqs);
    setSelectedRFQForMatrix((prev) => prev || result.rfqs[0] || null);
    setSelectedRFQForDeepDive((prev) => prev || result.rfqs[0] || null);
    setVendorOpportunities(result.rfqs.map(buildOpportunityFromRFQ));
  };

  // Hydrate reference data. RFQs come from refreshRFQs, not from here.
  const refreshFromDB = async () => {
    setIsLoadingDB(true);
    try {
      const res = await fetch('/api/bootstrap', { headers: authFetchHeaders() });
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        // Assigned unconditionally. Each of these used to be guarded by
        // `&& length > 0`, so an empty collection left whatever was already in
        // state on screen — and because the backend seeded fabricated vendors and
        // evaluations, "empty" was the normal response for a database that simply
        // had no records yet. An empty list now renders as an empty list.
        setBuyerAccounts(d.buyerAccounts || []);
        setBuyerVendors(d.vendors || []);

        // Subscription plan and download quota used to live only as local
        // useState (defaulted to 'premium' / 3, reset on every refresh, never
        // actually persisted). Sync them from the real vendor record.
        const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
        if (sessionEmail && Array.isArray(d.vendors)) {
          const myVendor = d.vendors.find((v: VendorEntry) => v.email?.toLowerCase() === sessionEmail);
          if (myVendor) {
            setVendorSubscription(myVendor.subscriptionPlan || 'premium');
            setVendorRfqDownloadsUsed(myVendor.rfqDownloadsUsed || 0);
          }
        }

        setVendorEvaluations(d.evaluations || []);
        setSelectedVendorEvaluation((prev) => prev || (d.evaluations || [])[0] || null);
        setAuditLogs(d.auditLogs || []);
        if (d.systemConfig) {
          setSystemConfig(d.systemConfig);
        }
        // Infrastructure rows are measured server-side (the database row comes
        // from a live connection probe), so they replace the placeholder here.
        if (Array.isArray(d.azureHealth) && d.azureHealth.length > 0) {
          setAzureHealth(d.azureHealth);
        }
        setDbConnected(true);
        await refreshRFQs();
        await refreshVendorCredits();
      }
    } catch (err) {
      console.error('Failed to load reference data:', err);
      setDbConnected(false);
    } finally {
      setIsLoadingDB(false);
    }
  };

  /**
   * Resolve the signed-in buyer's own organisation from the identity schema.
   *
   * Replaces matching the session email against a seeded directory. The shared
   * schema has no unique index on the login email, so that match was never
   * reliable, and the seeded fallback attributed whichever company came first to
   * the current session.
   */
  const refreshActiveBuyerAccount = async () => {
    if (!authClient.getToken()) {
      setActiveBuyerAccount(null);
      return;
    }
    try {
      const res = await fetch('/api/buyer-accounts/active', { headers: authFetchHeaders() });
      const json = await res.json();
      // No fallback on failure: showing another organisation's account is the bug
      // this replaced.
      setActiveBuyerAccount(json.success && json.data ? json.data : null);
    } catch {
      setActiveBuyerAccount(null);
    }
  };

  /**
   * Load the procurement category master from the database.
   *
   * The endpoint is session-gated, so this runs on sign-in rather than at mount.
   * Signed out the registry is cleared: leaving the previous session's copy in a
   * module-level registry would let a signed-out screen keep offering it.
   *
   * On failure the list is emptied and the reason kept. Every consumer of this
   * taxonomy either writes the selection back as `org_division_category` rows or
   * uses it to route an RFQ to a vendor pool, so offering a category that is not
   * in the master produces a scope matching no vendor at all — worse than showing
   * nothing and saying why.
   */
  const refreshCategoryTaxonomy = async () => {
    if (!authClient.getToken()) {
      clearCategoryTaxonomy();
      setCategoryTaxonomyState([]);
      setCategoryTaxonomyError(null);
      return;
    }

    setIsLoadingCategoryTaxonomy(true);
    try {
      const result = await fetchCategoryTaxonomy();
      if (!result.success) {
        clearCategoryTaxonomy();
        setCategoryTaxonomyState([]);
        setCategoryTaxonomyError(result.error || UI_STRINGS.buyerProfile.taxonomyUnavailable);
        return;
      }
      // The registry is kept in step with React state so the non-React validation
      // helpers (manualRfqModel) see the same master the pickers render from.
      setCategoryTaxonomy(result.data);
      setCategoryTaxonomyState(result.data);
      setCategoryTaxonomyError(null);
    } finally {
      setIsLoadingCategoryTaxonomy(false);
    }
  };

  /**
   * Load the AI bot follow-up feed scoped to the signed-in buyer.
   *
   * Vendor follow-up events and telemetry are scoped server-side by the caller's
   * buyer organisation so follow-ups dispatched by one buyer are never visible
   * on another buyer's command center / follow-up status bell.
   */
  const refreshAIFeed = async () => {
    if (!authClient.getToken()) {
      setAiFeed([]);
      return;
    }
    try {
      const activeBuyerId = activeBuyerAccount?.id;
      const queryParam = activeBuyerId ? `?buyerAccountId=${encodeURIComponent(activeBuyerId)}` : '';
      const res = await fetch(`/api/ai-feed${queryParam}`, { headers: authFetchHeaders() });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setAiFeed(json.data);
      } else {
        setAiFeed([]);
      }
    } catch (err) {
      console.error('Failed to load AI feed:', err);
    }
  };

  useEffect(() => {
    refreshFromDB();
  }, []);

  // Re-run whenever the session changes, so signing in loads that buyer's RFQs
  // and follow-up feeds, and signing out clears them rather than leaving the previous buyer's on screen.
  useEffect(() => {
    void refreshRFQs();
    void refreshActiveBuyerAccount();
    void refreshCategoryTaxonomy();
    void refreshAIFeed();
    void refreshVendorCredits();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on identity,
    // not on the callbacks, which are recreated every render.
  }, [isLoggedIn, currentUserSession?.id, activeBuyerAccount?.id]);

  // activeSubscription/remainingFreeRFQs used to be pure local state, defaulted
  // to free_trial/5 and never read back from anywhere real — a page refresh or
  // a real Zoho-purchased upgrade was invisible here. GET /api/buyer-accounts/active
  // now actually carries both fields (buyerAccountResolver merges them in from
  // the real buyer_accounts record), so this mirrors the same sync
  // refreshFromDB already does for vendorSubscription/vendorRfqDownloadsUsed.
  useEffect(() => {
    if (!activeBuyerAccount) return;
    if (activeBuyerAccount.subscriptionPlan) {
      setActiveSubscription(activeBuyerAccount.subscriptionPlan);
    }
    if (activeBuyerAccount.remainingFreeRFQs !== undefined) {
      setRemainingFreeRFQs(activeBuyerAccount.remainingFreeRFQs);
    }
  }, [activeBuyerAccount]);

  // Integrated Buyer Accounts Management & Public Database Sync
  const addBuyerAccount = (account: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>): BuyerAccount => {
    const newAcc: BuyerAccount = {
      ...account,
      id: `buyer-acc-${Date.now().toString().slice(-4)}`,
      totalRFQsCreated: 0,
      totalSpend: '₹0',
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      createdDate: new Date().toISOString().substring(0, 10),
    };
    setBuyerAccounts((prev) => [newAcc, ...prev]);

    // Persist to PostgreSQL
    fetch('/api/buyer-accounts', {
      method: 'POST',
      headers: authFetchHeaders(),
      body: JSON.stringify(newAcc),
    }).catch((e) => console.error('Failed to save buyer account to DB:', e));

    addAuditLog(`Created buyer account for ${newAcc.organizationName} (${newAcc.corporateEmail}) with source ${newAcc.accountSource}`);
    showToast('Buyer Account Created', `${newAcc.organizationName} registered and added to buyer master database.`, 'success');
    return newAcc;
  };

  const updateBuyerAccount = (id: string, updates: Partial<BuyerAccount>) => {
    // Was POSTing the merged record to /api/buyer-accounts — the CREATE
    // endpoint, not an update route — and applying the local state change
    // unconditionally regardless of what (if anything) the server did with
    // it. createBuyerAccount has no subscriptionPlan restriction at all
    // (that gate only exists on PUT /api/buyer-accounts/:id's
    // sanitizeBuyerAccountUpdates), so any edit through this path — e.g. the
    // Buyer Directory's edit form — could set subscriptionPlan to a paid
    // tier directly, no Zoho payment involved, and it would actually
    // persist. Fixed to call the real, gated update route, and to only
    // reflect the change locally once the server has actually accepted it.
    fetch(`/api/buyer-accounts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: authFetchHeaders(),
      body: JSON.stringify(updates),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          showToast(
            'Update Failed',
            json?.error || 'Could not save buyer account changes. Please try again.',
            'warning'
          );
          return;
        }
        const updatedAcc: BuyerAccount = json.data;
        setBuyerAccounts((prev) => prev.map((acc) => (acc.id === id ? updatedAcc : acc)));
        if (activeBuyerAccount?.id === id) {
          setActiveBuyerAccount(updatedAcc);
        }
        addAuditLog(`Updated account specifications for buyer ID ${id}`);
        showToast('Account Updated', 'Buyer account details successfully saved.', 'info');
      })
      .catch(() => {
        showToast('Update Failed', 'Could not reach the server. Please try again.', 'warning');
      });
  };

  const deleteBuyerAccount = (id: string) => {
    setBuyerAccounts((prev) => prev.filter((acc) => acc.id !== id));
    addAuditLog(`Deleted buyer account record ID ${id}`);
    showToast('Account Removed', 'Buyer account removed from database.', 'info');
  };

  const alignActiveBuyerAccount = (accountId: string) => {
    const acc = buyerAccounts.find((a) => a.id === accountId);
    if (!acc) return;
    setActiveBuyerAccount(acc);
    setCurrentMode(acc.sourcingMode);
    setActiveSubscription(acc.subscriptionPlan);
    setRemainingFreeRFQs(acc.remainingFreeRFQs);
    addAuditLog(`Switched active buyer session context to ${acc.organizationName} (${acc.corporateEmail})`);
    showToast('Session Aligned', `Active session aligned to: ${acc.organizationName} (${acc.corporateEmail})`, 'success');
  };

  const importPublicBuyerDatabase = (accounts: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>[]): number => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    const dateStr = new Date().toISOString().substring(0, 10);
    const created: BuyerAccount[] = accounts.map((a, i) => ({
      ...a,
      id: `buyer-acc-sync-${Date.now()}-${i}`,
      totalRFQsCreated: a.totalRFQsCreated || 0,
      totalSpend: a.totalSpend || '₹0',
      syncTimestamp: timestamp,
      createdDate: dateStr,
    }));
    setBuyerAccounts((prev) => [...created, ...prev]);

    // Persist batch to DB
    created.forEach((acc) => {
      fetch('/api/buyer-accounts', {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify(acc),
      }).catch((e) => console.error('Failed to sync buyer account to DB:', e));
    });

    addAuditLog(`Synced and imported ${created.length} legacy buyer accounts from Public System Database.`);
    showToast('Database Synced', `${created.length} existing buyer accounts aligned from public system.`, 'success');
    return created.length;
  };

  const [vendorCatalogue, setVendorCatalogue] = useState<any[]>([]);

  const openRFQDeepDive = (rfq: RFQItem) => {
    setSelectedRFQForDeepDive(rfq);
    setDeepDiveModalOpen(true);
  };

  const openVendorEvaluationSummary = (evalRecord: VendorEvaluationRecord) => {
    setSelectedVendorEvaluation(evalRecord);
    setEvaluationModalOpen(true);
  };

  // Was fire-and-forget (optimistic local update, response never checked) —
  // now awaits the real response and only updates local state on confirmed
  // success, so a caller can gate its own success UI on the actual outcome.
  const addVendorEvaluation = async (record: VendorEvaluationRecord): Promise<boolean> => {
    try {
      const res = await fetch('/api/evaluations', {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify(record),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        console.error('Failed to save evaluation to DB:', data?.error || res.statusText);
        return false;
      }
      setVendorEvaluations((prev) => [record, ...prev.filter((r) => r.id !== record.id)]);
      return true;
    } catch (e) {
      console.error('Failed to save evaluation to DB:', e);
      return false;
    }
  };

  // Helper to check if vendor exists in platform central database
  const checkVendorInPlatformDatabase = (v: { email?: string; phone?: string; name?: string }): boolean => {
    const emailKey = (v.email || '').trim().toLowerCase();
    const phoneKey = (v.phone || '').trim();
    const nameKey = (v.name || '').trim().toLowerCase();

    return buyerVendors.some(
      (m) =>
        (m.email && m.email.toLowerCase() === emailKey) ||
        (phoneKey && m.phone && m.phone.replace(/\D/g, '').includes(phoneKey.replace(/\D/g, ''))) ||
        (m.name && m.name.toLowerCase() === nameKey)
    );
  };

  // Helper to generate a realistic first-time temporary password
  const generateTempPassword = (name?: string): string => {
    const clean = (name || 'Vendor').replace(/[^a-zA-Z]/g, '').slice(0, 5) || 'Vendor';
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${clean}@Procucev${rand}#`;
  };

  // Vendor Onboarding Email Generator Engine
  // Vendor Onboarding Email Generator Engine with Highlighted Assigned Categories & Unmapped Fallback
  const generateVendorOnboardingEmail = (
    vendor: VendorEntry,
    isExisting: boolean,
    tempPassword?: string
  ): VendorOnboardingEmailPayload => {
    const buyerCompany = activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited';
    const buyerContact = activeBuyerAccount?.contactPerson || 'Rajesh Sharma (CPO)';
    const buyerEmail = activeBuyerAccount?.corporateEmail || 'client@procucev.com';
    const passwordToUse = tempPassword || vendor.tempPassword || generateTempPassword(vendor.name);
    const emailId = `EML-ONBOARD-${Date.now().toString().slice(-6)}-${vendor.id}`;
    const nextDate = vendor.nextReminderDate || new Date(Date.now() + 3 * 86400000).toISOString().substring(0, 10) + ' (Day 3)';

    const hasMappedCategories = Boolean(
      vendor.majorCategory &&
      vendor.majorCategory !== 'Uncategorized (No Past POs)' &&
      vendor.majorCategory !== '(None Assigned by Buyer)' &&
      vendor.minorCategories &&
      vendor.minorCategories.length > 0
    );

    const assignedMajor = hasMappedCategories ? vendor.majorCategory! : '(None Assigned by Buyer)';
    const assignedMinors = hasMappedCategories ? vendor.minorCategories! : [];

    let subject = '';
    let authInstructions = '';
    let profileUpdateInstructions = '';
    let categoryUpdateInstructions = '';
    let unmappedSelfServiceMessage = '';

    if (!hasMappedCategories) {
      subject = `[Action Required] Set Up Categories: ${buyerCompany} added you to their Preferred Vendor Network`;
      authInstructions = `You have been added by ${buyerContact} from ${buyerCompany} into their private preferred vendor network from their vendor master records. Because no past pre-purchase orders were found in their historical dump, the buyer did not map any product categories for your company. Please log in with your Email ID as User Name and the First-Time Temporary Password provided below. For all subsequent logins, authentication is performed via a 4-digit OTP sent directly to your registered email inbox.`;
      profileUpdateInstructions = `Please log in to complete your enterprise compliance profile (factory specs, GSTIN/PAN, plant location, capacity).`;
      categoryUpdateInstructions = `ATTENTION: The buyer didn't map any categories for you because no historical PO items were found in their purchase dump. Please log in and map your categories yourself across our 13 Major Categories and 280+ Minor Category taxonomy in order to receive enquiries and RFQ opportunities.`;
      unmappedSelfServiceMessage = `The buyer didn't map any categories for you, so please map yourself in order to receive enquiries.`;
    } else if (isExisting) {
      subject = `[Network Association] ${buyerCompany} has added you to their Preferred Vendor Network on Procucev`;
      authInstructions = `A buyer from ${buyerCompany} has associated your verified enterprise profile into their private preferred supplier network. You can sign in using your existing credentials, or use the temporary first-time password (${passwordToUse}), or sign in directly with your registered Email ID and Instant Email OTP.`;
      profileUpdateInstructions = `Please log in to review the buyer association and verify that your plant locations, operational capabilities, and statutory certifications are up to date.`;
      categoryUpdateInstructions = `The buyer (${buyerCompany}) analyzed their past purchase records and mapped your company to the following taxonomy:\n• 1st Set (Primary Major Category): ${assignedMajor}\n• 2nd Set (Minor Categories & Product Lines): ${assignedMinors.join(', ')}\nPlease log in to review, confirm, or expand your category specializations across our 280+ standard minor categories.`;
    } else {
      subject = `[Action Required] Welcome to Procucev: ${buyerCompany} has added you to their Preferred Vendor Network`;
      authInstructions = `You have been added by ${buyerContact} from ${buyerCompany} into their private preferred vendor network based on their past pre-purchase orders. Please log in with your Email ID as User Name and the First-Time Temporary Password provided below. For all subsequent logins, authentication is performed via a 4-digit OTP sent directly to your registered email inbox.`;
      profileUpdateInstructions = `Please log in and complete your enterprise profile, including plant location, turnover, machinery, and statutory tax credentials (GSTIN / PAN).`;
      categoryUpdateInstructions = `The buyer (${buyerCompany}) analyzed their purchase history and assigned your company to:\n• 1st Set (Primary Major Category): ${assignedMajor}\n• 2nd Set (Minor Categories & Product Lines): ${assignedMinors.join(', ')}\nPlease confirm these categories upon login so you receive incoming RFQ invitations matching your product lines.`;
    }

    return {
      emailId,
      vendorId: vendor.id,
      vendorName: vendor.name,
      recipientEmail: vendor.email,
      contactPerson: vendor.contactPerson,
      buyerCompanyName: buyerCompany,
      buyerContactName: buyerContact,
      buyerContactEmail: buyerEmail,
      isExistingInDatabase: isExisting,
      hasPoHistory: hasMappedCategories,
      categoriesMappedByBuyer: hasMappedCategories,
      unmappedSelfServiceMessage,
      subject,
      username: vendor.email,
      tempPassword: passwordToUse,
      authInstructions,
      profileUpdateInstructions,
      categoryUpdateInstructions,
      assignedMajorCategory: assignedMajor,
      assignedMinorCategories: assignedMinors,
      assignedSecondaryMajors: hasMappedCategories ? ['Engineering Spares - Electrical', 'Civil Works'] : [],
      reminderScheduleNote: `Automated recurring reminders are scheduled on every 3rd day until your profile completion and category taxonomy updates are confirmed.`,
      dispatchedAt: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      nextReminderDate: nextDate,
      portalLoginUrl: 'http://localhost:3000',
      shaSignature: generateShaHash(),
      reminderCount: vendor.remindersSentCount || 0,
    };
  };

  const [selectedOnboardingEmail, setSelectedOnboardingEmail] = useState<VendorOnboardingEmailPayload | null>(null);
  const [onboardingEmailModalOpen, setOnboardingEmailModalOpen] = useState<boolean>(false);

  // Initial Setup State & Purchase Data Ingestion
  const [initialSetupModalOpen, setInitialSetupModalOpen] = useState<boolean>(false);
  const [initialSetupCompleted, setInitialSetupCompleted] = useState<boolean>(false);
  const [historicalPurchaseDataPeriod, setHistoricalPurchaseDataPeriod] = useState<'1_year' | '2_years' | '3_years'>('1_year');
  const [lastIngestionSummary, setLastIngestionSummary] = useState<IngestionSummary | null>(null);

  const processHistoricalPurchaseData = async (
    period: '1_year' | '2_years' | '3_years',
    vendors: HistoricalPurchaseVendorRecord[]
  ): Promise<number> => {
    // Used to build the full VendorEntry list purely client-side and never
    // call the backend at all — every "imported" vendor vanished on refresh
    // and the "onboarding credentials dispatched" claim was never true. A
    // real endpoint for exactly this already exists (POST
    // /api/buyer-accounts/historical-data -> storeService's own
    // processHistoricalPurchaseData, which dedupes by email/name and
    // persists real vendor records) — use it and refresh from the DB
    // afterwards instead of reconstructing vendor records by hand.
    const mappedCount = vendors.filter((v) => v.categoriesMappedByBuyer).length;
    const unmappedCount = vendors.length - mappedCount;
    const periodLabel =
      period === '1_year' ? 'Last 1 Year (12 Months)' : period === '2_years' ? 'Last 2 Years (24 Months)' : 'Last 3 Years (36 Months)';

    let res: Response;
    try {
      res = await fetch('/api/buyer-accounts/historical-data', {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify({
          period,
          vendorRecords: vendors.map((v) => ({
            companyName: v.companyName,
            contactPerson: v.contactPerson,
            email: v.email,
            phone: v.phone,
            location: v.address,
            // Sent explicitly rather than left for the backend to infer from
            // majorCategory's sentinel string below — storeService branches
            // the onboarding email (Template A vs B) on this flag directly.
            categoriesMappedByBuyer: Boolean(v.categoriesMappedByBuyer),
            majorCategory: v.categoriesMappedByBuyer
              ? v.firstSetMajorCategory || 'Engineering Spares - Mechanical'
              : 'Uncategorized (No Past POs)',
            minorCategories: v.categoriesMappedByBuyer && v.secondSetMinorCategories?.length ? v.secondSetMinorCategories : [],
            rating: v.vendorRatingScore ? Number((v.vendorRatingScore / 20).toFixed(1)) : undefined,
            score: v.vendorRatingScore,
          })),
        }),
      });
    } catch (e) {
      console.error('Failed to ingest historical purchase data:', e);
      showToast('Import Failed', 'Could not reach the server. Please try again.', 'warning');
      return 0;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      showToast(
        'Import Failed',
        data?.error || 'Could not process the historical purchase data. Please try again.',
        'warning'
      );
      return 0;
    }

    const summary: IngestionSummary = {
      importedCount: data.importedCount ?? 0,
      totalProcessed: data.totalProcessed ?? vendors.length,
      mappedCount: data.mappedCount ?? mappedCount,
      mappedEmailsSent: data.mappedEmailsSent ?? (data.mappedCount ?? mappedCount),
      unmappedCount: data.unmappedCount ?? unmappedCount,
      unmappedEmailsSent: data.unmappedEmailsSent ?? (data.unmappedCount ?? unmappedCount),
      failedEmailCount: data.failedEmailCount ?? (Array.isArray(data.failedEmails) ? data.failedEmails.length : 0),
      failedEmails: Array.isArray(data.failedEmails) ? data.failedEmails : [],
      skippedCount: data.skippedCount ?? 0,
      skipped: Array.isArray(data.skipped) ? data.skipped : [],
      period: data.period ?? period,
      totalVendors: data.totalVendors ?? vendors.length,
      overallStatus: data.overallStatus ?? (data.failedEmailCount > 0 ? 'COMPLETED_WITH_FAILURES' : 'COMPLETED'),
    };
    setLastIngestionSummary(summary);

    await refreshFromDB();
    setInitialSetupCompleted(true);
    // Note: Modal remains open so InitialSetupModal can display the Completion Summary to the user

    addFeedItem(
      `Historical Purchase & Vendor Master Ingestion Complete: ${data.importedCount} Vendors`,
      `Processed separate Vendor Master & ${periodLabel} PO dumps. ${summary.mappedEmailsSent}/${summary.mappedCount} Template A sent. ${summary.unmappedEmailsSent}/${summary.unmappedCount} Template B sent. ${summary.failedEmailCount} failed.`,
      'invitation',
      undefined,
      `${data.importedCount} Ingested Vendors`,
      'email'
    );

    addAuditLog(
      `Ingested separate Vendor Master & ${periodLabel} PO files (${vendors.length} submitted, ${data.importedCount} new: ${summary.mappedEmailsSent} Template A sent, ${summary.unmappedEmailsSent} Template B sent, ${summary.failedEmailCount} failed).`
    );

    showToast(
      summary.failedEmailCount > 0 ? 'Setup Completed with Warnings' : 'Initial Setup Completed',
      `Processed ${periodLabel} PO dump & Vendor Master. Dispatched ${summary.mappedEmailsSent} Template A and ${summary.unmappedEmailsSent} Template B emails (${summary.failedEmailCount} failed).`,
      summary.failedEmailCount > 0 ? 'warning' : 'success'
    );

    return data.importedCount;
  };

  const openOnboardingEmailModal = (vendor: VendorEntry) => {
    const isExisting = vendor.isExistingInDatabase ?? checkVendorInPlatformDatabase(vendor);
    const payload = generateVendorOnboardingEmail(vendor, isExisting, vendor.tempPassword);
    setSelectedOnboardingEmail(payload);
    setOnboardingEmailModalOpen(true);
  };

  const triggerVendorReminder = (vendorId: string) => {
    const targetVendor = buyerVendors.find((v) => v.id === vendorId);
    if (!targetVendor) return;

    const nextCount = (targetVendor.remindersSentCount || 0) + 1;
    const dayNumber = nextCount * 3;
    const nextDate = new Date(Date.now() + 3 * 86400000).toISOString().substring(0, 10) + ` (Day ${dayNumber + 3})`;

    setBuyerVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? {
              ...v,
              remindersSentCount: nextCount,
              nextReminderDate: nextDate,
            }
          : v
      )
    );

    addFeedItem(
      `Every-3rd-Day Reminder Dispatched: ${targetVendor.name}`,
      `Automated Day-${dayNumber} profile & category update reminder email dispatched to ${targetVendor.email} on behalf of ${targetVendor.addedByBuyerCompany || 'Larsen & Toubro Limited'}.`,
      'reminder',
      undefined,
      targetVendor.name,
      'email'
    );

    addAuditLog(
      `Dispatched automated Day-${dayNumber} profile & category reminder email to ${targetVendor.name} (${targetVendor.email})`,
      undefined,
      targetVendor.email
    );

    showToast(
      'Day-3 Reminder Sent',
      `Sent Day ${dayNumber} profile & category reminder to ${targetVendor.email}. Next reminder: Day ${dayNumber + 3}.`,
      'info'
    );
  };

  const [clientMappedCategories, setClientMappedCategories] = useState<string[]>([]);
  const [vendorSelectedCategories, setVendorSelectedCategories] = useState<string[]>([]);

  const saveVendorProfileCategories = (email: string, clientCats: string[], vendorCats: string[]) => {
    // Limit to max 10 categories
    const limitedVendorCats = vendorCats.slice(0, 10);
    setClientMappedCategories(clientCats);
    setVendorSelectedCategories(limitedVendorCats);

    const clientLower = clientCats.map((c) => c.toLowerCase().trim());
    const vendorLower = limitedVendorCats.map((c) => c.toLowerCase().trim());

    const isAligned =
      clientLower.length > 0 &&
      vendorLower.length > 0 &&
      clientLower.every((c) => vendorLower.includes(c)) &&
      vendorLower.every((v) => clientLower.includes(v));

    const common = limitedVendorCats.filter((v) => clientLower.includes(v.toLowerCase().trim()));
    const clientOnly = clientCats.filter((c) => !vendorLower.includes(c.toLowerCase().trim()));
    const vendorOnly = limitedVendorCats.filter((v) => !clientLower.includes(v.toLowerCase().trim()));

    // Update in buyerVendors list
    setBuyerVendors((prev) =>
      prev.map((v) => {
        if (v.email.toLowerCase() === email.toLowerCase() || v.name.toLowerCase().includes('apex')) {
          return {
            ...v,
            clientMappedCategories: clientCats,
            vendorSelectedCategories: limitedVendorCats,
            minorCategories: Array.from(new Set([...clientCats, ...limitedVendorCats])),
            isCategoryAligned: isAligned,
            categoryMismatchDetails: {
              common,
              clientOnly,
              vendorOnly,
            },
            profileCompletionStatus: 'completed',
            firstLoginCompleted: true,
          };
        }
        return v;
      })
    );

    addFeedItem(
      `Vendor Category Reconciliation Saved: ${email}`,
      `Client Mapped: [${clientCats.join(', ')}] | Vendor Selected (Max 10): [${limitedVendorCats.join(', ')}]. ${isAligned ? 'Status: 100% Aligned.' : `Status: Dual-Stream Stored (${common.length} matching, ${vendorOnly.length} vendor-extended). RFQs will be dispatched across both sets.`}`,
      'system',
      undefined,
      email,
      'system'
    );

    addAuditLog(
      `Vendor Category Taxonomy Updated for ${email}: Client Mapped (${clientCats.length}) vs Vendor Selected (${limitedVendorCats.length}). Alignment Status: ${isAligned ? 'ALIGNED' : 'DISCREPANCY PRESERVED (Both Streams Saved)'}`,
      undefined,
      email
    );

    showToast(
      isAligned ? 'Categories Aligned & Saved' : 'Dual Categories Saved & Reconciled',
      isAligned
        ? `Both client mapped and vendor profile categories match (${common.length} categories).`
        : `Stored both Client Mapped (${clientCats.length}) and Vendor Profile (${limitedVendorCats.length}) categories. RFQs will be routed across both sets!`,
      'success'
    );
  };

  const completeVendorProfile = (vendorEmail: string, updatedCategories?: string[]) => {
    if (updatedCategories && updatedCategories.length > 0) {
      saveVendorProfileCategories(vendorEmail, clientMappedCategories, updatedCategories);
      return;
    }

    setBuyerVendors((prev) =>
      prev.map((v) =>
        v.email.toLowerCase() === vendorEmail.toLowerCase()
          ? {
              ...v,
              profileCompletionStatus: 'completed',
              firstLoginCompleted: true,
              minorCategories: updatedCategories || v.minorCategories,
            }
          : v
      )
    );

    addFeedItem(
      `Vendor Profile & Taxonomy Updated: ${vendorEmail}`,
      `Supplier updated minor category specializations and compliance credentials. Automated 3-day reminder schedule terminated.`,
      'system',
      undefined,
      vendorEmail,
      'system'
    );

    addAuditLog(`Vendor ${vendorEmail} completed category taxonomy & compliance profile update.`);
    showToast('Profile Updated', `Supplier profile & minor categories verified. 3-day reminders deactivated.`, 'success');
  };

  const [selectedRatingRevisionEmail, setSelectedRatingRevisionEmail] = useState<VendorRatingRevisionEmailPayload | null>(null);
  const [ratingRevisionEmailModalOpen, setRatingRevisionEmailModalOpen] = useState<boolean>(false);

  const openRatingRevisionEmailModal = (revision: VendorRatingRevisionRecord) => {
    setSelectedRatingRevisionEmail({
      vendorName: revision.vendorName,
      vendorEmail: revision.buyerEmail ? 'rajesh@apexsupplies.in' : 'vendor@apex.com',
      vendorContactPerson: 'Rajesh Nair',
      buyerCompany: revision.buyerCompany,
      buyerContactName: revision.buyerName,
      buyerContactEmail: revision.buyerEmail,
      dispatchedAt: revision.timestamp,
      qualityScore: revision.qualityScore,
      costScore: revision.costScore,
      deliveryScore: revision.deliveryScore,
      buyerAverage: revision.buyerAverage,
      previousScore: revision.previousScore,
      newCompositeScore: revision.newCompositeScore,
      newRating: revision.newRating,
      remarks: revision.remarks,
      shaSignature: revision.shaSignature,
    });
    setRatingRevisionEmailModalOpen(true);
  };

  const reviseVendorRating = async (
    vendorId: string,
    qualityScore: number,
    costScore: number,
    deliveryScore: number,
    remarks: string
  ): Promise<VendorRatingRevisionRecord | null> => {
    const buyerCompany = activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited';
    const buyerName = activeBuyerAccount?.contactPerson || 'Rajesh Sharma (CPO)';
    const buyerEmail = activeBuyerAccount?.corporateEmail || 'buyer@procucev.com';
    const targetVendor = buyerVendors.find((v) => v.id === vendorId) || buyerVendors[0];
    const trimmedRemarks = remarks.trim() || 'Quarterly operational performance review & ratings alignment.';

    // Persist rating revision to the backend and use ITS canonical result —
    // this used to PATCH '/api/vendors' with a client-computed payload; that
    // route/method doesn't exist (routes/vendors.js has no PATCH handler at
    // all), so it silently 404'd on every revision and nothing ever reached
    // the backend, while the UI unconditionally showed a client-recomputed
    // score as if it had saved. Worse, that client formula
    // (Math.round((previousScore + buyerAverage) / 2)) never matched the
    // server's real weighting (storeService.reviseVendorRating /
    // calculateRevisedRating: previousScore*0.6 + buyerAverage*0.4), so even
    // a successful save would have shown the wrong number. The real endpoint
    // is POST '/api/vendors/:id/rating-revision' — await it and use its
    // response as the source of truth for what actually got saved.
    let res: Response;
    try {
      res = await fetch(`/api/vendors/${encodeURIComponent(targetVendor?.id || vendorId)}/rating-revision`, {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify({
          qualityScore,
          costScore,
          deliveryScore,
          remarks: trimmedRemarks,
          buyerCompany,
          buyerName,
          buyerEmail,
        }),
      });
    } catch (e) {
      console.error('Failed to save rating revision to DB:', e);
      showToast('Rating Revision Failed', 'Could not reach the server. Please try again.', 'warning');
      return null;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      showToast(
        'Rating Revision Failed',
        data?.error || 'Could not save your rating revision. Please try again.',
        'warning'
      );
      return null;
    }

    const revisionRecord: VendorRatingRevisionRecord = data.data.revisionRecord;
    const updatedVendorFromServer = data.data.updatedVendor;

    // Update in buyerVendors list (accessible across all buyer accounts & directories)
    setBuyerVendors((prev) =>
      prev.map((v) => {
        if (v.id === vendorId || v.name === targetVendor?.name) {
          return { ...v, ...updatedVendorFromServer };
        }
        return v;
      })
    );

    // Update in vendorEvaluations list as well
    setVendorEvaluations((prev) =>
      prev.map((e) => {
        if (e.vendorId === vendorId || e.vendorName === targetVendor?.name) {
          const modScores = e.moduleScores || {
            commercial: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            technical: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            quality: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            delivery: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            financial: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
            governance: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          };
          return {
            ...e,
            overallScore: revisionRecord.newCompositeScore,
            moduleScores: {
              ...modScores,
              quality: { ...modScores.quality, score: Number((qualityScore / 20).toFixed(1)), remarks: `Buyer Score: ${qualityScore}/100` },
              commercial: { ...modScores.commercial, score: Number((costScore / 20).toFixed(1)), remarks: `Buyer Score: ${costScore}/100` },
              delivery: { ...modScores.delivery, score: Number((deliveryScore / 20).toFixed(1)), remarks: `Buyer Score: ${deliveryScore}/100` },
            },
          };
        }
        return e;
      })
    );

    // AI Bot Feed item
    addFeedItem(
      `Vendor Rating Revised: ${targetVendor?.name}`,
      `Buyer ${buyerName} (${buyerCompany}) revised performance rating. Quality: ${qualityScore}/100, Cost: ${costScore}/100, Delivery: ${deliveryScore}/100 (Buyer Avg: ${revisionRecord.buyerAverage}%). New Platform Aggregate Rating: ${revisionRecord.newRating} / 5.0 (${revisionRecord.newCompositeScore}%). Remarks: "${revisionRecord.remarks}". Notification email dispatched to ${targetVendor?.email}.`,
      'system',
      undefined,
      targetVendor?.name,
      'email'
    );

    // Immutable Audit Log
    addAuditLog(
      `Buyer Rating Revision for ${targetVendor?.name}: Q=${qualityScore}, C=${costScore}, D=${deliveryScore} (Buyer Avg: ${revisionRecord.buyerAverage}%). Previous: ${revisionRecord.previousScore}% (${revisionRecord.previousRating}★) -> New Composite: ${revisionRecord.newCompositeScore}% (${revisionRecord.newRating}★). Remarks: "${revisionRecord.remarks}". Dispatched notification email to ${targetVendor?.email}.`,
      undefined,
      buyerEmail
    );

    // Set email payload and open preview modal
    setSelectedRatingRevisionEmail({
      vendorName: targetVendor?.name || 'Apex Supplies Ltd.',
      vendorEmail: targetVendor?.email || 'rajesh@apexsupplies.in',
      vendorContactPerson: targetVendor?.contactPerson || 'Rajesh Nair',
      buyerCompany,
      buyerContactName: buyerName,
      buyerContactEmail: buyerEmail,
      dispatchedAt: revisionRecord.timestamp,
      qualityScore,
      costScore,
      deliveryScore,
      buyerAverage: revisionRecord.buyerAverage,
      previousScore: revisionRecord.previousScore,
      newCompositeScore: revisionRecord.newCompositeScore,
      newRating: revisionRecord.newRating,
      remarks: revisionRecord.remarks,
      shaSignature: revisionRecord.shaSignature,
    });
    setRatingRevisionEmailModalOpen(true);

    showToast(
      'Vendor Rating Revised & Email Dispatched',
      `Updated ${targetVendor?.name} rating to ${revisionRecord.newRating}★ (${revisionRecord.newCompositeScore}%). Performance notification email dispatched.`,
      'success'
    );

    return revisionRecord;
  };

  // Buyer Vendor Management — a buyer adding one vendor they deal with
  // directly. Persists through the real POST /api/vendors endpoint (buyer
  // role, server-scoped to the buyer's own account); state is only updated
  // once the backend confirms the write, and nothing here claims an email
  // was sent, since this endpoint never sends one (unlike the category
  // manager's bulk-import path, which does dispatch a real onboarding email).
  const addBuyerVendor = async (vendor: Omit<VendorEntry, 'id'>): Promise<VendorEntry | null> => {
    let res: Response;
    try {
      res = await fetch('/api/vendors', {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify(vendor),
      });
    } catch {
      showToast(
        'Could Not Add Vendor',
        'The vendor could not be saved — check your connection and try again.',
        'warning'
      );
      return null;
    }

    let body: { success?: boolean; data?: VendorEntry; error?: string } = {};
    try {
      body = await res.json();
    } catch {
      // body stays {}; handled by the !body.success check below
    }

    if (!res.ok || !body.success || !body.data) {
      showToast(
        'Could Not Add Vendor',
        body.error || 'The vendor could not be saved. No changes were made — try again.',
        'warning'
      );
      return null;
    }

    const newV = body.data;
    setBuyerVendors((prev) => [newV, ...prev]);

    addFeedItem(
      `Vendor Added: ${newV.name}`,
      `${newV.name} was added to your vendor directory.`,
      'invitation',
      undefined,
      newV.name
    );
    addAuditLog(`Added vendor ${newV.name} (${newV.email})`);
    showToast('Vendor Added', `${newV.name} has been added to your vendor directory.`, 'success');

    return newV;
  };

  const updateBuyerVendor = (vendorId: string, updates: Partial<VendorEntry>) => {
    setBuyerVendors((prev) =>
      prev.map((v) => (v.id === vendorId ? { ...v, ...updates } : v))
    );

    // Asynchronously persist updates to backend database
    fetch(`/api/vendors/${encodeURIComponent(vendorId)}`, {
      method: 'PUT',
      headers: { ...authFetchHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).catch((err) => {
      console.error('Failed to sync vendor update to backend:', err);
    });

    addAuditLog(`Updated vendor profile record for ID ${vendorId}.`);
    showToast('Vendor Profile Updated', 'Vendor information saved successfully.', 'success');
  };

  const deleteBuyerVendor = (vendorId: string) => {
    setBuyerVendors((prev) => prev.filter((v) => v.id !== vendorId));

    // Asynchronously delete from backend database
    fetch(`/api/vendors/${encodeURIComponent(vendorId)}`, {
      method: 'DELETE',
      headers: authFetchHeaders(),
    }).catch((err) => {
      console.error('Failed to sync vendor deletion to backend:', err);
    });

    addAuditLog(`Removed vendor record ID ${vendorId} from buyer vendor master.`);
    showToast('Vendor Removed', 'Vendor deleted from directory.', 'info');
  };

  // Dynamic Matching Logic based on Minor & Major Categories
  const matchSuitableVendors = (
    entities: ExtractedEntity[],
    mode: SourcingMode,
    customList?: VendorEntry[]
  ): VendorEntry[] => {
    const vendorPool = customList && customList.length > 0 ? customList : buyerVendors;
    const targetMinorCategories = entities.map(e => (e.minorCategory || '').toLowerCase().trim()).filter(Boolean);
    const targetMajorCategories = entities.map(e => (e.majorCategory || e.category || '').toLowerCase().trim()).filter(Boolean);

    const isCategoryMatch = (v: VendorEntry) => {
      const vMajor = (v.majorCategory || '').toLowerCase();
      
      // Dual-Stream resolution
      const clientMapped = (v.clientMappedCategories && v.clientMappedCategories.length > 0 
        ? v.clientMappedCategories 
        : (v.email.includes('apex') ? clientMappedCategories : v.minorCategories || [])).map(m => m.toLowerCase().trim());
        
      const vendorSelected = (v.vendorSelectedCategories && v.vendorSelectedCategories.length > 0 
        ? v.vendorSelectedCategories 
        : (v.email.includes('apex') ? vendorSelectedCategories : [])).map(m => m.toLowerCase().trim());
      
      const allMinors = Array.from(new Set([...clientMapped, ...vendorSelected]));

      const isClientMappedMatch = targetMinorCategories.some(tMin => 
        clientMapped.some(vMin => vMin.includes(tMin) || tMin.includes(vMin))
      );

      const isVendorSelectedMatch = targetMinorCategories.some(tMin => 
        vendorSelected.some(vMin => vMin.includes(tMin) || tMin.includes(vMin))
      );

      const hasMinorMatch = isClientMappedMatch || isVendorSelectedMatch || targetMinorCategories.some(tMin => 
        allMinors.some(vMin => vMin.includes(tMin) || tMin.includes(vMin))
      );

      if (hasMinorMatch) {
        if (isClientMappedMatch && isVendorSelectedMatch) {
          v.categoryMatchSource = 'Aligned Buyer & Vendor Category Match';
        } else if (isClientMappedMatch) {
          v.categoryMatchSource = 'Buyer Empanelled Category Match';
        } else {
          v.categoryMatchSource = 'Vendor Profile Self-Declared Category Match';
        }
        return true;
      }

      const hasMajorMatch = targetMajorCategories.some(tMaj => 
        vMajor.includes(tMaj) || tMaj.includes(vMajor)
      );
      if (hasMajorMatch) return true;

      return entities.some(e => {
        const itemLower = (e.itemName + ' ' + (e.technicalSpecs || '')).toLowerCase();
        return allMinors.some(m => itemLower.includes(m)) || (vMajor && itemLower.includes(vMajor));
      });
    };

    if (mode === 'mode_1') {
      const matched = vendorPool.filter(v => 
        (v.source === 'buyer_manual' || v.source === 'buyer_excel' || v.source === 'manual' || v.source === 'excel') &&
        isCategoryMatch(v)
      );
      return (matched.length > 0 ? matched : vendorPool.slice(0, 3)).map(v => {
        const loc = v.location || '';
        return {
          ...v,
          matchReason: 'Buyer Approved Roster (Minor Category Match)',
          proximity: loc.includes('MH') || loc.includes('Mumbai') || loc.includes('Pune') ? 'Local Hub (<250km)' : 'Regional Hub (<600km)',
          proximityMatch: true,
        };
      });
    } else if (mode === 'mode_2') {
      const matchedBuyer = vendorPool.filter(v => isCategoryMatch(v)).map(v => {
        const loc = v.location || '';
        return {
          ...v,
          matchReason: 'Buyer Roster (Minor Category Match)',
          proximity: loc.includes('MH') || loc.includes('Mumbai') || loc.includes('Pune') ? 'Local Hub (<250km)' : 'Regional Hub (<600km)',
          proximityMatch: true,
        };
      });

      const networkVendors: VendorEntry[] = [
        { id: 'v-net-1', name: 'Global Pipe Solutions', contactPerson: 'John Doe', email: 'john@globalpipes.com', phone: '+1 415 555 2671', majorCategory: 'Engineering Spares - Mechanical', minorCategories: ['Pipes & Pipe Fittings', 'Hoses, Valves & Fittings'], location: 'Houston, TX', rating: 4.5, source: 'procucev_network' as const, matchReason: 'Procucev Base Network (Minor Category Match)', proximity: 'International / US Hub', proximityMatch: false },
        { id: 'v-net-2', name: 'Titanium Castings Corp', contactPerson: 'Sarah Jenkins', email: 'sarah@titaniumcast.com', phone: '+44 20 7946 0958', majorCategory: 'Engineering Spares - Mechanical', minorCategories: ['Machinery Parts', 'Customised Parts'], location: 'Sheffield, UK', rating: 4.7, source: 'procucev_network' as const, matchReason: 'Procucev Base Network (Minor Category Match)', proximity: 'International / UK Hub', proximityMatch: false },
      ].filter(v => isCategoryMatch(v));

      const combined = [...matchedBuyer, ...networkVendors];
      const rawList = combined.length > 0 ? combined : vendorPool.slice(0, 4);
      const seen = new Set<string>();
      const deduplicated = rawList.filter((v) => {
        const key = (v.email || v.name).toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // 1st Priority Rule: Evaluated vendors are given first priority automatically irrespective of rating
      return deduplicated.sort((a, b) => {
        const aEval = Boolean(a.rating || a.name.includes('Apex'));
        const bEval = Boolean(b.rating || b.name.includes('Apex'));
        if (aEval && !bEval) return -1;
        if (!aEval && bEval) return 1;
        return 0;
      });
    } else {
      const matched = vendorPool.filter(v => 
        (v.source === 'buyer_manual' || v.source === 'buyer_excel' || v.source === 'manual' || v.source === 'excel') &&
        isCategoryMatch(v)
      );
      const rawList = (matched.length > 0 ? matched : vendorPool.slice(0, 3)).map(v => {
        const loc = v.location || '';
        return {
          ...v,
          matchReason: 'Buyer Approved Roster (360° Qualification & RFQ)',
          proximity: loc.includes('MH') || loc.includes('Mumbai') || loc.includes('Pune') ? 'Local Hub (<250km)' : 'Regional Hub (<600km)',
          proximityMatch: true,
        };
      });
      const seen = new Set<string>();
      const deduplicated = rawList.filter((v) => {
        const key = (v.email || v.name).toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // 1st Priority Rule: Evaluated vendors are given first priority automatically irrespective of rating
      return deduplicated.sort((a, b) => {
        const aEval = Boolean(a.rating || a.name.includes('Apex'));
        const bEval = Boolean(b.rating || b.name.includes('Apex'));
        if (aEval && !bEval) return -1;
        if (!aEval && bEval) return 1;
        return 0;
      });
    }
  };

  // Standard RFQ Email Generator Engine
  const generateStandardRFQEmail = (rfq: RFQItem, vendor: VendorEntry): StandardRFQEmailPayload => {
    const modeDetail = SOURCING_MODES.find(m => m.id === rfq.sourcingMode) || SOURCING_MODES[0];
    const emailId = `EML-${rfq.rfqNumber}-${vendor.id || Date.now()}`;
    const shaSignature = generateShaHash();
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' IST';
    const major = vendor.majorCategory || rfq.extractedEntities[0]?.majorCategory || rfq.category || 'Industrial Procurement';
    const minors = vendor.minorCategories && vendor.minorCategories.length > 0 
      ? vendor.minorCategories 
      : rfq.extractedEntities.map(e => e.minorCategory || e.category).filter(Boolean);

    let specialInstructions = '';
    if (rfq.sourcingMode === 'mode_1') {
      specialInstructions = 'Strict Single-Roster Submission: As an approved enterprise partner in our private roster, please submit your competitive line-item quotation directly against the enclosed BOQ. Pre-negotiated corporate rates & frame agreements apply.';
    } else if (rfq.sourcingMode === 'mode_2') {
      specialInstructions = 'Hybrid Competitive Sourcing: Your quotation will be benchmarked side-by-side on unit prices, verified lead time, and warranty terms. Pre-negotiated payment terms (Net 30/60) apply.';
    } else {
      specialInstructions = 'Mode 3 360-Degree Vendor Qualification Protocol: This RFQ is dispatched under high-governance double-blind compliance evaluation (M1 Commercial, M2 Technical, M3 Quality & Warranty, M4 Delivery, M5 Financial, M6 Governance/ESG). Please complete the linked qualification survey alongside your quotation.';
    }

    return {
      emailId,
      rfqNumber: rfq.rfqNumber,
      rfqTitle: rfq.title,
      sourcingMode: rfq.sourcingMode,
      sourcingModeName: modeDetail.name,
      sourcingModeCode: modeDetail.code,
      buyerCompany: 'Larsen & Toubro Limited (Heavy Engineering)',
      buyerContactName: 'Rajesh Sharma (CPO)',
      buyerContactEmail: 'buyer@procucev.com',
      buyerContactPhone: '+91 98201 44820',
      recipientVendorName: vendor.name,
      recipientContactPerson: vendor.contactPerson,
      recipientEmail: vendor?.email || 'navinchaudhary.dev@gmail.com',
      subject: `[RFQ Invitation] ${rfq.rfqNumber}: ${rfq.title} | Larsen & Toubro Sourcing (${modeDetail.code})`,
      matchedMajorCategory: major,
      matchedMinorCategories: minors,
      requisitionDate: rfq.createdAt || new Date().toISOString().slice(0, 10),
      submissionDeadline: rfq.targetDeliveryDate,
      targetDeliveryDate: rfq.targetDeliveryDate,
      deliveryLocation: 'Enterprise Logistics Hub (Navi Mumbai CIF Site)',
      paymentTerms: 'Net 30 / 60 Days from Inspection & Acceptance',
      lineItems: rfq.extractedEntities.map((e, idx) => ({
        itemNumber: idx + 1,
        itemName: e.itemName,
        technicalSpecs: e.technicalSpecs,
        quantity: e.quantity,
        unit: e.unit,
        minorCategory: e.minorCategory || 'General Industrial Item',
        targetDate: e.targetDate,
      })),
      specialInstructions,
      complianceChecklist: [
        'Mandatory GST Tax Invoice with HSN / SAC breakdown',
        'Manufacturer Test Certificate (MTC) / Certificate of Analysis (COA)',
        'Minimum 24 to 36 Months Comprehensive Warranty Undertaking',
        'Guaranteed Delivery SLA commitment with transit insurance included',
        rfq.sourcingMode === 'mode_3' ? 'Mandatory ISO 9001:2015 & Statutory KYC documents upload' : 'Roster Compliance verification',
      ],
      replyInstructions: 'Please reply directly to this RFQ email with your quotation attachment (PDF/Excel). DO NOT alter or change the subject line to ensure automated AI parsing into the comparative matrix.',
      replyToEmail: activeBuyerAccount?.corporateEmail || 'navinchaudhary.dev@gmail.com',
      shaSignature,
      dispatchedAt: timeNow,
    };
  };

  const openStandardEmailModal = (rfq: RFQItem, vendor?: VendorEntry) => {
    const targetVendor = vendor || buyerVendors.find(v => v.name === rfq.followUpData?.vendors[0]?.vendorName) || buyerVendors[0];
    const emailPayload = generateStandardRFQEmail(rfq, targetVendor);
    setSelectedEmailForModal(emailPayload);
    setEmailModalOpen(true);
  };
  
  const [toastMessage, setToastMessage] = useState<{ title: string; description: string; type: 'success' | 'info' | 'warning' } | null>(null);

  const showToast = (title: string, description: string, type: 'success' | 'info' | 'warning' = 'info') => {
    setToastMessage({ title, description, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.title === title ? null : prev));
    }, 4500);
  };

  const dismissToast = () => {
    setToastMessage(null);
  };

  const addAuditLog = (action: string, rfqNumber?: string, user?: string) => {
    const defaultUser =
      currentRole === 'buyer'
        ? 'client@procucev.com (Enterprise Buyer)'
        : currentRole === 'category_manager'
        ? 'catmanager@procucev.com (Category Manager)'
        : currentRole === 'vendor'
        ? 'vendor@apex.com (Apex Supplies Ltd.)'
        : 'admin@procucev.com (System Admin)';

    const newLog: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      user: user || defaultUser,
      action,
      rfqNumber,
      shaSignature: generateShaHash(),
      status: 'VERIFIED',
      ipAddress: '104.42.189.44',
    };
    setAuditLogs((prev) => [newLog, ...prev]);

    fetch('/api/audit', {
      method: 'POST',
      headers: authFetchHeaders(),
      body: JSON.stringify(newLog),
    }).catch((e) => console.error('Failed to save audit log to DB:', e));
  };

  const addFeedItem = (
    title: string,
    message: string,
    type: AIBotFeedItem['type'],
    rfqNumber?: string,
    recipient?: string,
    channel?: 'call' | 'whatsapp' | 'sms' | 'email' | 'system',
    channelDetails?: AIBotFeedItem['channelDetails']
  ) => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newFeed: AIBotFeedItem = {
      id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: timeStr,
      timeAgo: 'Just now',
      type,
      channel: channel || (type === 'call' || type === 'whatsapp' || type === 'sms' || type === 'email' ? type : undefined),
      title,
      message,
      recipient,
      rfqNumber,
      buyerAccountId: activeBuyerAccount?.id,
      status: 'completed',
      channelDetails,
    };
    setAiFeed((prev) => [newFeed, ...prev]);

    fetch('/api/ai-feed', {
      method: 'POST',
      headers: authFetchHeaders(),
      body: JSON.stringify(newFeed),
    }).catch((e) => console.error('Failed to save AI feed item to DB:', e));
  };

  const triggerChannelChaser = (
    rfqNumber: string,
    channel: 'call' | 'whatsapp' | 'sms' | 'email',
    vendorName = 'Vendor',
    customNote?: string,
    suppressToast = false
  ) => {
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let title = '';
    let message = '';
    let toastTitle = '';
    let toastDesc = '';

    if (channel === 'call') {
      title = `AI Voice Bot Call Dispatched`;
      message = `Autonomous AI Voice Agent placed telephonic outreach to ${vendorName} for ${rfqNumber}. Line connected; confirmed quote turnaround SLA.`;
      toastTitle = `AI Voice Call Initiated!`;
      toastDesc = `Outbound phone call connected to ${vendorName} for ${rfqNumber}.`;
    } else if (channel === 'whatsapp') {
      title = `WhatsApp Interactive Chaser Dispatched`;
      message = `Automated WhatsApp quotation prompt with 1-click bid link delivered to ${vendorName} for ${rfqNumber}.`;
      toastTitle = `WhatsApp Chaser Sent!`;
      toastDesc = `Vendor accessed the interactive 1-click bid link.`;
    } else if (channel === 'sms') {
      title = `Priority SMS Notice Dispatched`;
      message = `DLT-verified priority SMS alert sent to ${vendorName} for ${rfqNumber}.`;
      toastTitle = `SMS Alert Dispatched!`;
      toastDesc = `Priority SMS notice delivered to ${vendorName}.`;
    } else {
      title = `24h Escalation Email Sent`;
      message = `Standard RFQ reminder email with BOQ re-attached delivered to ${vendorName}.`;
      toastTitle = `24h Email Reminder Sent!`;
      toastDesc = `Escalation notice with BOQ specs delivered to ${vendorName}.`;
    }

    if (customNote) {
      message += ` (Note: "${customNote}")`;
    }

    addFeedItem(title, message, channel, rfqNumber, vendorName, channel, {
      duration: channel === 'call' ? '1m 30s' : undefined,
      transcriptSummary: channel === 'call' ? `Vendor confirmed RFQ receipt and will submit bid before deadline.` : undefined,
      actionOutcome: channel === 'whatsapp' ? 'Link delivered' : channel === 'sms' ? 'Carrier delivered' : channel === 'email' ? 'BOQ Specs re-attached · Immediate bid requested' : 'Voice connected',
    });

    addAuditLog(
      `Triggered ${channel.toUpperCase()} automated follow-up for ${rfqNumber} to ${vendorName}`,
      rfqNumber
    );

    setRfqs((prev) =>
      prev.map((r) => {
        if (r.rfqNumber === rfqNumber && r.followUpData) {
          const baseFollowUp: RFQFollowUpBreakdown = {
            ...r.followUpData,
            callStats: {
              total: r.followUpData.callStats?.total ?? 0,
              connected: r.followUpData.callStats?.connected ?? 0,
              avgDuration: r.followUpData.callStats?.avgDuration ?? '1m 30s',
            },
            whatsappStats: {
              total: r.followUpData.whatsappStats?.total ?? 0,
              delivered: r.followUpData.whatsappStats?.delivered ?? 0,
              read: r.followUpData.whatsappStats?.read ?? 0,
              replied: r.followUpData.whatsappStats?.replied ?? 0,
            },
            smsStats: {
              total: r.followUpData.smsStats?.total ?? 0,
              delivered: r.followUpData.smsStats?.delivered ?? 0,
              clicked: r.followUpData.smsStats?.clicked ?? 0,
            },
            emailStats: {
              total: r.followUpData.emailStats?.total ?? 5,
              sent24h: r.followUpData.emailStats?.sent24h ?? 0,
              opened: r.followUpData.emailStats?.opened ?? 1,
            },
            vendors: Array.isArray(r.followUpData.vendors) && r.followUpData.vendors.length > 0
              ? r.followUpData.vendors
              : [
                  {
                    vendorId: 'v-1',
                    vendorName: vendorName || 'Vendor Pool',
                    phone: '+91 98765 43210',
                    contactPerson: 'Sales Coordinator',
                    call: {
                      status: 'scheduled',
                      lastAttempt: timeNow,
                      duration: '0m',
                    },
                    whatsapp: {
                      status: 'delivered',
                      lastAttempt: timeNow,
                      messagePreview: 'RFQ Invitation dispatched.',
                      linkClicked: false,
                    },
                    sms: {
                      status: 'sent',
                      lastAttempt: timeNow,
                    },
                    overallStatus: 'Pending',
                    lastInteraction: timeNow,
                    attemptsCount: 0,
                    bidStatus: 'Pending',
                  },
                ],
          };

          const targetName = String(vendorName || '').trim().toLowerCase();

          const updatedVendors = baseFollowUp.vendors.map((v) => {
            const vName = String(v?.vendorName || (v as any)?.name || (v as any)?.companyName || 'Supplier').trim().toLowerCase();
            const isMatch =
              targetName === 'all pending suppliers' ||
              !targetName ||
              (vName && targetName && (vName.includes(targetName) || targetName.includes(vName)));

            if (isMatch) {
              return {
                ...v,
                vendorName: v?.vendorName || (v as any)?.name || (v as any)?.companyName || 'Supplier',
                attemptsCount: (v.attemptsCount || 0) + 1,
                lastInteraction: timeNow,
                overallStatus: 'Follow-up Active' as const,
                call: channel === 'call' ? {
                  ...(v.call || {}),
                  status: 'completed' as const,
                  lastAttempt: timeNow,
                  duration: '1m 30s',
                  summary: 'AI Voice Call connected with sales coordinator. Acknowledged RFQ requirements.',
                } : v.call,
                whatsapp: channel === 'whatsapp' ? {
                  ...(v.whatsapp || {}),
                  status: 'read' as const,
                  lastAttempt: timeNow,
                  messagePreview: 'Urgent RFQ follow-up link delivered.',
                  linkClicked: true,
                } : v.whatsapp,
                sms: channel === 'sms' ? {
                  ...(v.sms || {}),
                  status: 'delivered' as const,
                  lastAttempt: timeNow,
                } : v.sms,
                email24h: channel === 'email' ? {
                  ...(v.email24h || {}),
                  status: 'reminded_24h' as const,
                  lastAttempt: timeNow,
                  is24hReminderSent: true,
                  subject: `URGENT REMINDER: Quotation Request for ${rfqNumber}`,
                } : v.email24h,
              };
            }
            return v;
          });

          const callTotal = channel === 'call' ? baseFollowUp.callStats.total + 1 : baseFollowUp.callStats.total;
          const callConnected = channel === 'call' ? baseFollowUp.callStats.connected + 1 : baseFollowUp.callStats.connected;
          const waTotal = channel === 'whatsapp' ? baseFollowUp.whatsappStats.total + 1 : baseFollowUp.whatsappStats.total;
          const waDelivered = channel === 'whatsapp' ? baseFollowUp.whatsappStats.delivered + 1 : baseFollowUp.whatsappStats.delivered;
          const waRead = channel === 'whatsapp' ? baseFollowUp.whatsappStats.read + 1 : baseFollowUp.whatsappStats.read;
          const smsTotal = channel === 'sms' ? baseFollowUp.smsStats.total + 1 : baseFollowUp.smsStats.total;
          const smsDelivered = channel === 'sms' ? baseFollowUp.smsStats.delivered + 1 : baseFollowUp.smsStats.delivered;
          const emailSent24h = channel === 'email' ? (baseFollowUp.emailStats?.sent24h || 0) + 1 : (baseFollowUp.emailStats?.sent24h || 0);

          const updatedRfq: RFQItem = {
            ...r,
            chasingActive: true,
            followUpData: {
              ...baseFollowUp,
              callStats: { ...baseFollowUp.callStats, total: callTotal, connected: callConnected },
              whatsappStats: { ...baseFollowUp.whatsappStats, total: waTotal, delivered: waDelivered, read: waRead },
              smsStats: { ...baseFollowUp.smsStats, total: smsTotal, delivered: smsDelivered },
              emailStats: { total: baseFollowUp.emailStats?.total || 5, sent24h: emailSent24h, opened: (baseFollowUp.emailStats?.opened || 1) },
              vendors: updatedVendors,
            },
          };

          setSelectedRFQForDeepDive((cur) => (cur && cur.rfqNumber === rfqNumber ? updatedRfq : cur));
          return updatedRfq;
        }
        return r;
      })
    );

    if (!suppressToast) {
      showToast(toastTitle, toastDesc, 'success');
    }
  };

  const triggerBatchChannelChaser = (
    rfqNumber: string,
    channels: ('call' | 'whatsapp' | 'sms')[],
    suppressToast = false
  ) => {
    channels.forEach((ch) => {
      triggerChannelChaser(rfqNumber, ch, 'All Pending Suppliers', undefined, true);
    });
    if (!suppressToast) {
      showToast(
        'Multi-Channel Batch Broadcast Active!',
        `AI chasing dispatched across ${channels.map((c) => c.toUpperCase()).join(' + ')} for ${rfqNumber}.`,
        'success'
      );
    }
  };

  const triggerWhatsAppChaser = (rfqNumber: string, vendorName = 'Vendor') => {
    triggerChannelChaser(rfqNumber, 'whatsapp', vendorName);
  };

  const submitVendorBid = (
    rfqNumber: string,
    unitPrice: number,
    leadTimeDays: number,
    remarks: string
  ) => {
    const newQuote: QuoteComparison = {
      vendorId: `v-${Date.now()}`,
      vendorName: 'Apex Supplies Ltd. (Verified)',
      vendorCategory: 'Procucev - AI Rec',
      unitPrice,
      totalPrice: unitPrice * 12,
      leadTimeDays,
      aiMatchScore: 95,
      isBestPrice: true,
      isPreferred: true,
      warrantyYears: 3,
      complianceStatus: 'Fully Compliant',
      paymentTerms: 'Net 30 Days',
      remarks,
      source: 'portal',
      submissionMethod: 'web_portal',
    };

    setRfqs((prev) =>
      prev.map((r) => {
        if (r.rfqNumber === rfqNumber) {
          const updatedQuotes = [...r.quotes.map(q => ({ ...q, isBestPrice: false, isPreferred: false })), newQuote];
          return {
            ...r,
            quotesCount: updatedQuotes.length,
            status: 'AI Recommended',
            quotes: updatedQuotes,
            aiScore: 95,
          };
        }
        return r;
      })
    );

    setVendorOpportunities((prev) =>
      prev.map((o) => (o.rfqNumber === rfqNumber ? { ...o, status: 'submitted' } : o))
    );

    addFeedItem(
      `Bid Submitted by Apex Supplies Ltd.`,
      `Apex Supplies submitted line-item quotation (${formatCurrency(unitPrice)}/unit, ${leadTimeDays}d lead time). AI Score: 95%.`,
      'scoring',
      rfqNumber,
      'Apex Supplies Ltd.'
    );

    addAuditLog(
      `Apex Supplies Ltd. submitted verified quotation for ${rfqNumber} (${formatCurrency(unitPrice)})`,
      rfqNumber,
      'vendor@apex.com'
    );

    showToast(
      'Quotation Submitted Successfully!',
      `Your bid for ${rfqNumber} has been validated and injected into the Buyer Comparative Matrix.`,
      'success'
    );
  };

  // Was entirely local-state — the real, already-working POST /:id/approve-po
  // endpoint was never called at all (BUGS.md #37), and the PO document shown
  // to the user (Modals.tsx) fabricated its own line items, vendor id, issue
  // date, and even a hardcoded "SHA-256" string that never changed no matter
  // what was actually approved (#36). Now calls the real endpoint and returns
  // its real response so the modal can render the real document instead.
  const approvePO = async (
    rfqNumber: string,
    vendorId: string | null,
    vendorName: string,
    amount: number,
    approverNotes?: string
  ): Promise<{ success: boolean; poNumber?: string; issueDate?: string; shaSignature?: string; lineItems?: { description: string; quantity: number; unit: string }[]; error?: string }> => {
    try {
      const res = await fetch(`/api/rfqs/${encodeURIComponent(rfqNumber)}/approve-po`, {
        method: 'POST',
        headers: authFetchHeaders(),
        body: JSON.stringify({ vendorId, vendorName, totalAmount: amount, approverNotes }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast('PO Approval Failed', data.error || 'Could not approve the pre-purchase order.', 'warning');
        return { success: false, error: data.error };
      }

      setRfqs((prev) =>
        prev.map((r) =>
          r.rfqNumber === rfqNumber
            ? { ...r, status: 'PO Generated' as const, awardedVendor: vendorName, awardedAmount: amount }
            : r
        )
      );

      addFeedItem(
        `Pre-Purchase Order Generated: ${rfqNumber}`,
        `Approved Pre-PO ${data.poNumber} generated for ${vendorName} totaling ${formatCurrency(amount)}. Dispatched to ERP & Vendor Portal.`,
        'approval',
        rfqNumber
      );

      addAuditLog(
        `Approved Pre-Purchase Order (PO) Generation & Dispatched Contract for ${rfqNumber} to ${vendorName} (${formatCurrency(amount)})`,
        rfqNumber
      );

      showToast(
        'Pre-Purchase Order Issued!',
        `Official Pre-Purchase Order ${data.poNumber} generated and signed with a real SHA-256 digital stamp for ${vendorName}.`,
        'success'
      );

      return { success: true, poNumber: data.poNumber, issueDate: data.issueDate, shaSignature: data.shaSignature, lineItems: data.lineItems };
    } catch (err: any) {
      showToast('PO Approval Failed', err?.message || 'Network error while approving the pre-purchase order.', 'warning');
      return { success: false, error: err?.message };
    }
  };

  /**
   * Adopt a server-created RFQ, replacing any existing entry with the same RFQ
   * number so a refresh cannot leave two copies of one record.
   */
  const adoptCreatedRFQ = (rfq: RFQItem) => {
    setRfqs((prev) => [rfq, ...prev.filter((r) => r.rfqNumber !== rfq.rfqNumber)]);
    addAuditLog(`Created ${rfq.rfqNumber} (${rfq.title})`, rfq.rfqNumber);
    void refreshAIFeed();
  };

  /**
   * Persist an edit, then adopt what the API stored.
   *
   * The response is the authority: it carries the new `updatedAt` and any value the
   * server normalised. Patching the local copy from the request instead would let
   * the two drift, which is the failure the RFQ create path already had.
   */
  const updateRFQ = async (identifier: string, changes: RFQUpdatePayload): Promise<RFQItem> => {
    const result = await updateRFQRequest(identifier, changes);

    if (!result.success) {
      showToast(UI_STRINGS.rfqEdit.saveFailedTitle, result.error, 'warning');
      // Thrown rather than swallowed so the dialog stays open on the buyer's edits.
      throw new Error(result.error);
    }

    const saved: RFQItem = {
      ...result.rfq,
      assignedVendors:
        changes.assignedVendors &&
        Array.isArray(changes.assignedVendors) &&
        changes.assignedVendors.length >= (result.rfq.assignedVendors?.length || 0)
          ? (changes.assignedVendors as any)
          : result.rfq.assignedVendors || (changes.assignedVendors as any) || [],
    };
    setRfqs((prev) => prev.map((r) => (r.rfqNumber === saved.rfqNumber ? saved : r)));
    setVendorOpportunities((prev) =>
      prev.map((opp) => (opp.rfqNumber === saved.rfqNumber ? buildOpportunityFromRFQ(saved) : opp))
    );
    // Kept in step so a screen already holding this RFQ does not show the old terms.
    setSelectedRFQForMatrix((prev) => (prev?.rfqNumber === saved.rfqNumber ? saved : prev));
    setSelectedRFQForDeepDive((prev) => (prev?.rfqNumber === saved.rfqNumber ? saved : prev));

    addAuditLog(
      `Edited ${saved.rfqNumber}: ${Object.keys(changes).join(', ')}`,
      saved.rfqNumber
    );
    showToast(
      UI_STRINGS.rfqEdit.savedTitle,
      formatString(UI_STRINGS.rfqEdit.savedMessage, { rfqNumber: saved.rfqNumber }),
      'success'
    );
    return saved;
  };

  /**
   * Delete an RFQ, then drop it from every list holding it.
   *
   * Removed only after the API confirms, so a failed delete leaves the row on
   * screen instead of hiding a record the database still has.
   */
  const deleteRFQ = async (identifier: string): Promise<void> => {
    const result = await deleteRFQRequest(identifier);

    if (!result.success) {
      showToast(UI_STRINGS.rfqEdit.deleteFailedTitle, result.error, 'warning');
      throw new Error(result.error);
    }

    const { rfqNumber } = result;
    setRfqs((prev) => prev.filter((r) => r.rfqNumber !== rfqNumber));
    setVendorOpportunities((prev) => prev.filter((opp) => opp.rfqNumber !== rfqNumber));
    // A selection pointing at a deleted RFQ would render a stale record, so it is
    // cleared rather than left dangling.
    setSelectedRFQForMatrix((prev) => (prev?.rfqNumber === rfqNumber ? null : prev));
    setSelectedRFQForDeepDive((prev) => (prev?.rfqNumber === rfqNumber ? null : prev));

    addAuditLog(`Deleted ${rfqNumber}`, rfqNumber);
    showToast(
      UI_STRINGS.rfqEdit.deletedTitle,
      formatString(UI_STRINGS.rfqEdit.deletedMessage, { rfqNumber }),
      'success'
    );
  };

  const addNewRFQ = async (
    rfqData: NewRFQInput,
    customMatchedVendors?: VendorEntry[]
  ): Promise<RFQItem> => {
    // Subscription Limits Validation
    if (activeSubscription === 'none') {
      showToast('Subscription Upgrade Required', 'Your organization domain has already claimed its free trial. You must subscribe to a sourcing mode to dispatch RFQs.', 'warning');
      throw new Error('Subscription required');
    }

    if (activeSubscription === 'free_trial') {
      if (rfqData.sourcingMode === 'mode_0') {
        showToast('V0 RFQ Dispatched', 'Created RFQ via V0 (Procucev Network Vendors). 0 free RFQ credits used.', 'success');
      } else {
        if (remainingFreeRFQs <= 0) {
          showToast('Free RFQ Quota Exhausted', 'You have hit your limit on V1, V2, and V3, but you can create multiple RFQs with V0 (Procucev Network Vendors). Upgrade your plan to continue creating RFQs with V1, V2, or V3.', 'warning');
          throw new Error('Free account quota exhausted');
        }
        setRemainingFreeRFQs(prev => {
          const next = Math.max(0, prev - 1);
          const modeName = rfqData.sourcingMode === 'mode_1' ? 'Version 1 (Client Roster)' : rfqData.sourcingMode === 'mode_2' ? 'Version 2 (Hybrid Network)' : 'Version 3 (Autonomous AI)';
          showToast('Free RFQ Dispatched', `Used 1 Free RFQ via ${modeName}. You have ${next} free RFQs remaining across all versions.`, 'success');
          return next;
        });
      }
    } else {
      if (rfqData.sourcingMode === 'mode_2' && activeSubscription === 'version_1') {
        showToast('Upgrade Required', 'Version 2 (Mode 2) Sourcing requires a Version 2 (Hybrid Network) Plan subscription.', 'warning');
        throw new Error('Subscription required');
      }
      if (rfqData.sourcingMode === 'mode_3' && activeSubscription !== 'version_3') {
        showToast('Upgrade Required', 'Version 3 (Mode 3) Sourcing requires a Version 3 (Autonomous AI) Plan subscription.', 'warning');
        throw new Error('Subscription required');
      }
    }

    // An explicitly empty list means "attach no vendors" and must be honoured:
    // only an omitted argument falls back to automatic matching. Treating [] as
    // "no preference" would fire RFQ emails and chaser sequences at suppliers the
    // buyer never selected.
    const rawMatchedVendors = customMatchedVendors
      ? customMatchedVendors
      : matchSuitableVendors(rfqData.extractedEntities, rfqData.sourcingMode);

    const seenKeys = new Set<string>();
    const matchedVendors: VendorEntry[] = [];
    for (const v of rawMatchedVendors) {
      const key = (v.email || v.name || v.id).toLowerCase().trim();
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        matchedVendors.push(v);
      }
    }

    // The RFQ is persisted first and the server's record is what goes into state.
    //
    // This used to be the other way round: a locally built RFQ was pushed into
    // `rfqs` immediately and the POST was fired without being awaited, its response
    // discarded. Two things broke as a result. The client kept a `rfqNumber` it had
    // minted itself with Math.random(), while the server allocated a different one
    // under the Java scheme — so opening the details page fetched a number that did
    // not exist and rendered neither line items nor the summary. And a failed save
    // still left the RFQ on screen as though it had been dispatched.
    const saved = await createRFQ({
      title: rfqData.title,
      category: rfqData.category,
      sourcingMode: rfqData.sourcingMode,
      status: 'Quotes Pending',
      source: rfqData.source || ((rfqData as any).aiSummary || rfqData.sourceFileName ? 'ai_extraction' : 'manual_entry'),
      sourceFileName: rfqData.sourceFileName,
      // Origin of an emailed requisition. Previously omitted here, so the sender
      // the wizard had already parsed was dropped before it ever reached the API.
      sourceEmail: rfqData.sourceEmail,
      budget: Number(rfqData.budget) || 0,
      targetDeliveryDate:
        rfqData.targetDeliveryDate ||
        (rfqData as any).target_delivery_date ||
        (rfqData as any).deadline ||
        rfqData.extractedEntities?.[0]?.targetDate ||
        '',
      deliveryLocation: rfqData.deliveryLocation || '',
      deliveryPincode: rfqData.deliveryPincode || '',
      extractedEntities: rfqData.extractedEntities,
      attachments: rfqData.attachments || [],
    });

    if (!saved.success) {
      // Thrown rather than swallowed: the caller shows the reason, and no phantom
      // RFQ is added to a list the database knows nothing about.
      throw new Error(saved.error);
    }

    const newRFQ: RFQItem = {
      ...saved.rfq,
      // Local-only presentation state the API does not model. Everything the
      // server owns — id, rfqNumber, createdAt, extractedEntities, aiSummary — is
      // taken from its response above and never overwritten here.
      autoCirculated: rfqData.autoCirculated ?? (rfqData.source === 'email_gateway'),
      aiScore: rfqData.aiScore,
      // No outreach telemetry. Nothing dispatches chasers yet, so a followUpData
      // block here could only report zeros against a schedule that no job runs —
      // and those zeros were being read as real by the portfolio KPIs.
      chasingActive: false,
      quotes: [],
    };

    // Replaces any entry with the same number so a concurrent refresh cannot leave
    // two copies of one RFQ.
    setRfqs((prev) => [newRFQ, ...prev.filter((r) => r.rfqNumber !== newRFQ.rfqNumber)]);

    // Derived from the saved RFQ by the same mapper the list uses, so the vendor
    // portal shows the real buyer, delivery location and value rather than the
    // hardcoded "Larsen & Toubro" and "Enterprise Logistics Hub" placeholders that
    // used to be attached to every new RFQ.
    setVendorOpportunities((prev) => [buildOpportunityFromRFQ(newRFQ), ...prev]);

    // Dispatch Standard RFQ Email Package to each suitable vendor
    matchedVendors.forEach((v) => {
      const emailPayload = generateStandardRFQEmail(newRFQ, v);
      addFeedItem(
        `Standard RFQ Email Dispatched: ${v.name}`,
        `Standard procurement RFQ email package sent to ${v.contactPerson} (${v.email}) for ${newRFQ.rfqNumber}. Categorized under ${emailPayload.matchedMajorCategory} > [${emailPayload.matchedMinorCategories.join(', ')}].`,
        'email',
        newRFQ.rfqNumber,
        v.name,
        'email'
      );
    });

    addFeedItem(
      `RFQ Dispatched: ${newRFQ.rfqNumber}`,
      `Dispatched to ${matchedVendors.length} suitable vendors matching Minor Categories under ${SOURCING_MODES.find(m => m.id === newRFQ.sourcingMode)?.shortLabel}.`,
      'email',
      newRFQ.rfqNumber
    );

    addAuditLog(
      `Created and dispatched Standard RFQ Email for ${newRFQ.rfqNumber} to ${matchedVendors.length} suitable vendors (${matchedVendors.map(v => v.name).join(', ')})`,
      newRFQ.rfqNumber
    );

    showToast(
      'Standard RFQ Email Dispatched!',
      `${newRFQ.rfqNumber} dispatched to ${matchedVendors.length} suitable vendors.`,
      'success'
    );

    return newRFQ;
  };

  // Sync role tab defaults
  useEffect(() => {
    if (currentRole === 'buyer') {
      setActiveTab('command_center');
    } else if (currentRole === 'category_manager') {
      setActiveTab('kanban_board');
    } else if (currentRole === 'vendor') {
      setActiveTab('vendor_feed');
    } else if (currentRole === 'admin') {
      setActiveTab('infra_control');
    }
  }, [currentRole]);

  return (
    <AppContext.Provider
      value={{
        currentRole,
        setCurrentRole,
        isLoggedIn,
        setIsLoggedIn,
        currentUserSession,
        setCurrentUserSession,
        currentMode,
        setCurrentMode,
        activeTab,
        setActiveTab,
        rfqs,
        aiFeed,
        vendorOpportunities,
        auditLogs,
        azureHealth,
        systemConfig,
        setSystemConfig,
        isLoadingDB,
        dbConnected,
        refreshFromDB,
        refreshRFQs,
        refreshAIFeed,
        categoryTaxonomy,
        categoryTaxonomyError,
        isLoadingCategoryTaxonomy,
        refreshCategoryTaxonomy,
        addNewRFQ,
        adoptCreatedRFQ,
        updateRFQ,
        deleteRFQ,
        triggerWhatsAppChaser,
        triggerChannelChaser,
        triggerBatchChannelChaser,
        submitVendorBid,
        approvePO,
        addAuditLog,
        addFeedItem,
        selectedRFQForMatrix,
        selectedVendorOpportunity,
        setSelectedVendorOpportunity,
        activeEvaluationRecord,
        setActiveEvaluationRecord,
        setSelectedRFQForMatrix,
        selectedRFQForDeepDive,
        setSelectedRFQForDeepDive,
        deepDiveModalOpen,
        setDeepDiveModalOpen,
        openRFQDeepDive,
        vendorEvaluations,
        addVendorEvaluation,
        selectedVendorEvaluation,
        setSelectedVendorEvaluation,
        evaluationModalOpen,
        setEvaluationModalOpen,
        openVendorEvaluationSummary,
        theme,
        setTheme,
        toggleTheme,
        toastMessage,
        showToast,
        dismissToast,
        remainingFreeRFQs,
        setRemainingFreeRFQs,
        activeSubscription,
        setActiveSubscription,
        vendorSubscription,
        setVendorSubscription,
        updateVendorSubscription,
        createVendorPaymentLink,
        checkVendorPaymentLinkStatus,
        vendorFreeCreditsRemaining,
        vendorFreeCreditsAllocated,
        vendorFreeCreditsUsed,
        vendorUnlockedRfqIds,
        refreshVendorCredits,
        unlockRFQForVendor,
        vendorRfqDownloadsUsed,
        setVendorRfqDownloadsUsed,
        vendorCatalogue,
        setVendorCatalogue,
        buyerAccounts,
        activeBuyerAccount,
        refreshActiveBuyerAccount,
        createBuyerPaymentLink,
        checkBuyerPaymentLinkStatus,
        addBuyerAccount,
        updateBuyerAccount,
        deleteBuyerAccount,
        alignActiveBuyerAccount,
        importPublicBuyerDatabase,
        initialSetupModalOpen,
        setInitialSetupModalOpen,
        initialSetupCompleted,
        setInitialSetupCompleted,
        historicalPurchaseDataPeriod,
        setHistoricalPurchaseDataPeriod,
        processHistoricalPurchaseData,
        lastIngestionSummary,
        setLastIngestionSummary,
        buyerVendors,
        addBuyerVendor,
        updateBuyerVendor,
        deleteBuyerVendor,
        matchSuitableVendors,
        generateVendorOnboardingEmail,
        selectedOnboardingEmail,
        setSelectedOnboardingEmail,
        onboardingEmailModalOpen,
        setOnboardingEmailModalOpen,
        openOnboardingEmailModal,
        triggerVendorReminder,
        completeVendorProfile,
        clientMappedCategories,
        setClientMappedCategories,
        vendorSelectedCategories,
        setVendorSelectedCategories,
        saveVendorProfileCategories,
        generateStandardRFQEmail,
        selectedEmailForModal,
        setSelectedEmailForModal,
        emailModalOpen,
        setEmailModalOpen,
        openStandardEmailModal,
        vendorSelfEvaluationCompleted,
        setVendorSelfEvaluationCompleted,
        vendorSelfEvaluationScore,
        setVendorSelfEvaluationScore,
        isVendorEvaluationFeeWaived: vendorSubscription === 'connect' || vendorSubscription === 'select',
        reviseVendorRating,
        selectedRatingRevisionEmail,
        setSelectedRatingRevisionEmail,
        ratingRevisionEmailModalOpen,
        setRatingRevisionEmailModalOpen,
        openRatingRevisionEmailModal,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
