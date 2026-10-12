'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem, RFQVendorCandidate, VendorPageMeta } from '@/lib/types';
import { fetchAllVendors } from '@/lib/rfqClient';
import { fetchCategoryTaxonomy } from '@/lib/buyerProfileClient';
import { formatCurrency } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  Building2,
  Users,
  Search,
  ChevronRight,
  Clock,
  IndianRupee,
  Layers,
  ChevronDown,
  Upload,
  Mail,
  Phone,
  ShieldCheck,
  UserCheck,
  Zap,
  Globe,
  Sparkles,
  CheckCircle2,
  Tag,
  ArrowUpRight,
  X,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';
import VendorUploadModal from './VendorUploadModal';

interface VendorConsoleProps {
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onNavigateToEvaluation?: () => void;
}

// Deterministic decorative avatar color, not a claim about the vendor —
// picked from the company name so the same vendor always renders the same
// color without needing a color stored anywhere.
const AVATAR_PALETTE = [
  { bg: 'bg-emerald-600 text-white', avatar: 'bg-emerald-100 text-emerald-800' },
  { bg: 'bg-indigo-600 text-white', avatar: 'bg-indigo-100 text-indigo-800' },
  { bg: 'bg-purple-600 text-white', avatar: 'bg-purple-100 text-purple-800' },
  { bg: 'bg-cyan-600 text-white', avatar: 'bg-cyan-100 text-cyan-800' },
  { bg: 'bg-orange-600 text-white', avatar: 'bg-orange-100 text-orange-800' },
  { bg: 'bg-rose-600 text-white', avatar: 'bg-rose-100 text-rose-800' },
];

function avatarStyleFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function getInitials(name: string): string {
  if (!name || !name.trim()) return '?';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

export type VendorSectionId = 'cm_procucev' | 'self_onboard_buyer';

export interface VendorSourceClassification {
  section: VendorSectionId;
  subType: 'cm_upload' | 'procucev_network' | 'self_onboarded' | 'buyer_added';
  label: string;
  shortLabel: string;
  badgeClass: string;
  icon: 'shield' | 'upload' | 'zap' | 'building';
  description: string;
}

/**
 * Classifies a vendor into Section 1 (Category Manager uploaded / Procucev Network)
 * or Section 2 (Self-onboarded / Buyer added private vendors).
 */
export function classifyVendorSource(v: {
  source?: string;
  id?: string;
  addedByBuyerCompany?: string;
  buyerId?: string;
  buyerAccountId?: string;
}): VendorSourceClassification {
  if (!v) {
    return {
      section: 'cm_procucev',
      subType: 'procucev_network',
      label: 'Procucev Network',
      shortLabel: 'Procucev Network',
      badgeClass: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/60',
      icon: 'shield',
      description: 'Verified Procucev platform supplier network',
    };
  }

  const s = String(v.source || '').toLowerCase().trim();
  const id = String(v.id || '').toLowerCase().trim();

  const isSelfOnboarded =
    s === 'self_onboarded' ||
    s === 'self_registration' ||
    s.includes('self_onboard') ||
    s.includes('self_reg');

  if (isSelfOnboarded) {
    return {
      section: 'self_onboard_buyer',
      subType: 'self_onboarded',
      label: 'Self-Onboarded',
      shortLabel: 'Self-Onboarded',
      badgeClass: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/60',
      icon: 'zap',
      description: 'Direct self-registration through vendor onboarding portal',
    };
  }

  const isBuyerAdded =
    s === 'buyer_uploaded' ||
    s === 'vendor_master_ingestion' ||
    s === 'historical_purchase_dump' ||
    s === 'buyer_manual' ||
    s === 'buyer_excel' ||
    s === 'buyer' ||
    s.includes('buyer') ||
    s.includes('ingestion') ||
    s.includes('purchase_dump') ||
    Boolean(v.addedByBuyerCompany) ||
    Boolean(v.buyerId) ||
    Boolean(v.buyerAccountId) ||
    id.startsWith('v-hist-') ||
    id.startsWith('v-navin-') ||
    id.startsWith('vm-') ||
    id.startsWith('v-ingest-') ||
    id.startsWith('v-buyer-');

  if (isBuyerAdded) {
    const buyerCompany = v.addedByBuyerCompany;
    return {
      section: 'self_onboard_buyer',
      subType: 'buyer_added',
      label: buyerCompany ? `Buyer Added (${buyerCompany})` : 'Buyer Added',
      shortLabel: buyerCompany ? `Buyer: ${buyerCompany}` : 'Buyer Added',
      badgeClass: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/60',
      icon: 'building',
      description: buyerCompany ? `Supplied by buyer organization: ${buyerCompany}` : 'Imported via enterprise buyer PO / ERP upload',
    };
  }

  const isCmUpload = s === 'category_manager_upload' || s.includes('category_manager') || s.includes('cm_upload');
  if (isCmUpload) {
    return {
      section: 'cm_procucev',
      subType: 'cm_upload',
      label: 'CM Uploaded',
      shortLabel: 'CM Uploaded',
      badgeClass: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200/60 dark:border-indigo-800/60',
      icon: 'upload',
      description: 'Category Manager catalog bulk upload',
    };
  }

  return {
    section: 'cm_procucev',
    subType: 'procucev_network',
    label: 'Procucev Network',
    shortLabel: 'Procucev Network',
    badgeClass: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/60',
    icon: 'shield',
    description: 'Verified Procucev platform supplier network',
  };
}

export const isProcucevNetworkVendor = (v: any): boolean => {
  return classifyVendorSource(v).section === 'cm_procucev';
};

export const isBuyerOrSelfOnboardedVendor = (v: any): boolean => {
  return classifyVendorSource(v).section === 'self_onboard_buyer';
};

// Fetched a page at a time straight from the real vendor directory (which
// reached 80k+ rows via a bulk Vendor Master import) — the bootstrap payload
// this screen used to read from is capped at 500, so it silently hid the
// vast majority of real vendors. Same pagination pattern as the Invite
// Vendors modal (see InviteVendorsModal.tsx), including the same
// "aggregate metrics only cover loaded pages" caveat.
const VENDOR_CARDS_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

export default function VendorConsole({ onNavigateToMatrix, onNavigateToEvaluation }: VendorConsoleProps) {
  const { rfqs } = useApp();
  const [fetchedVendors, setFetchedVendors] = useState<RFQVendorCandidate[]>([]);
  const [vendorsPagination, setVendorsPagination] = useState<VendorPageMeta | null>(null);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [vendorsLoadingMore, setVendorsLoadingMore] = useState(false);
  const [vendorsError, setVendorsError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [expandedQuoteNumber, setExpandedQuoteNumber] = useState<string | null>(null);
  // Tracks an explicit user collapse ("Hide Details") so dropdown-driven
  // expansion cannot silently re-open a panel the user just dismissed.
  const [drillDownDismissed, setDrillDownDismissed] = useState(false);

  // Dropdown filter states
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedContactFilterId, setSelectedContactFilterId] = useState<string>('all');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Active section tab filter ('all' shows both sections in distinct containers)
  const [activeSectionFilter, setActiveSectionFilter] = useState<'all' | 'cm_procucev' | 'self_onboard_buyer'>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    void fetchCategoryTaxonomy().then((result) => {
      if (result.success) {
        setCategoryOptions(result.data.map((c) => c.majorCategory));
      }
    });
  }, []);

  const lastFetchedKeyRef = useRef<string | null>(null);
  // Guards against a slower, earlier request (e.g. the initial unfiltered
  // load) resolving AFTER a newer, filtered one and overwriting it with
  // stale data — only the most recently *issued* request's response is ever
  // applied.
  const fetchSeqRef = useRef(0);
  useEffect(() => {
    const key = `${debouncedSearch}|${categoryFilter}`;
    if (fetchedVendors.length > 0 && lastFetchedKeyRef.current === key) return;
    lastFetchedKeyRef.current = key;
    const seq = ++fetchSeqRef.current;
    setVendorsLoading(true);
    setVendorsError(null);
    void fetchAllVendors({ page: 1, pageSize: VENDOR_CARDS_PAGE_SIZE, search: debouncedSearch, category: categoryFilter }).then((result) => {
      if (seq !== fetchSeqRef.current) return;
      if (result.success) {
        setFetchedVendors(result.candidates);
        setVendorsPagination(result.pagination);
      } else {
        setVendorsError(result.error);
      }
      setVendorsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, categoryFilter]);

  const loadMoreVendors = () => {
    if (!vendorsPagination || vendorsLoadingMore) return;
    const nextPage = vendorsPagination.page + 1;
    if (nextPage > vendorsPagination.totalPages) return;
    const seq = ++fetchSeqRef.current;
    setVendorsLoadingMore(true);
    void fetchAllVendors({ page: nextPage, pageSize: VENDOR_CARDS_PAGE_SIZE, search: debouncedSearch, category: categoryFilter }).then((result) => {
      if (seq !== fetchSeqRef.current) return;
      if (result.success) {
        setFetchedVendors((prev) => [...prev, ...result.candidates]);
        setVendorsPagination(result.pagination);
      } else {
        setVendorsError(result.error);
      }
      setVendorsLoadingMore(false);
    });
  };

  const hasMoreVendorCards = !!vendorsPagination && vendorsPagination.page < vendorsPagination.totalPages;

  // Compile vendor cards with real metrics from real quotes
  const compiledVendors = useMemo(() => {
    return fetchedVendors.map((vendor) => {
      const rfqsList = rfqs.filter((r) => (r.quotes || []).some((q) => q.vendorId === vendor.id));

      const myQuotes = rfqsList
        .map((r) => (r.quotes || []).find((q) => q.vendorId === vendor.id))
        .filter((q): q is NonNullable<typeof q> => !!q);

      const avgLeadTimeDays =
        myQuotes.length > 0
          ? Math.round((myQuotes.reduce((sum, q) => sum + q.leadTimeDays, 0) / myQuotes.length) * 10) / 10
          : null;

      const compliantCount = myQuotes.filter((q) => q.complianceStatus === 'Fully Compliant').length;
      const complianceRate = myQuotes.length > 0 ? Math.round((compliantCount / myQuotes.length) * 100) : null;

      const awardedSpend = rfqs
        .filter((r) => r.status === 'PO Generated' && r.awardedVendor === vendor.name)
        .reduce((sum, r) => sum + (r.awardedAmount as number), 0);

      const style = avatarStyleFor(vendor.name || '?');
      const classification = classifyVendorSource(vendor);

      return {
        id: vendor.id,
        name: vendor.contactPerson || vendor.name || 'Unnamed Vendor',
        contactPerson: vendor.contactPerson || vendor.name || 'Unnamed Vendor',
        email: vendor.email || '',
        phone: vendor.phone || '',
        company: vendor.name || 'Unnamed Vendor',
        logoLetter: (vendor.name || '?').charAt(0).toUpperCase(),
        logoBg: style.bg,
        avatarColor: style.avatar,
        category: vendor.majorCategory,
        location: vendor.location,
        rating: vendor.rating,
        leadTimeDays: avgLeadTimeDays,
        complianceRate,
        awardedSpend,
        rfqsList,
        activeBidsCount: rfqsList.filter((r) => r.status !== 'PO Generated').length,
        source: vendor.source,
        addedByBuyerCompany: vendor.addedByBuyerCompany,
        addedByBuyerName: vendor.addedByBuyerName,
        buyerId: vendor.buyerId,
        buyerAccountId: vendor.buyerAccountId,
        classification,
      };
    });
  }, [fetchedVendors, rfqs]);

  // Dropdown filtering (Company & Contact)
  const filteredByDropdownVendors = compiledVendors.filter((v) => {
    const matchCompany = selectedCompany === 'all' || v.company === selectedCompany;
    const matchContact = selectedContactFilterId === 'all' || v.id === selectedContactFilterId;
    return matchCompany && matchContact;
  });
  const pagedVendors = filteredByDropdownVendors;

  // Separate vendors into the two distinct functional sections
  const cmProcucevVendors = useMemo(() => {
    return filteredByDropdownVendors.filter((v) => v.classification.section === 'cm_procucev');
  }, [filteredByDropdownVendors]);

  const selfBuyerVendors = useMemo(() => {
    return filteredByDropdownVendors.filter((v) => v.classification.section === 'self_onboard_buyer');
  }, [filteredByDropdownVendors]);

  // Overall Analytics computations based on dropdown filter scope
  const totalAwardedSpend = filteredByDropdownVendors.reduce((sum, v) => sum + v.awardedSpend, 0);
  const cmProcucevSpend = cmProcucevVendors.reduce((sum, v) => sum + v.awardedSpend, 0);
  const selfBuyerSpend = selfBuyerVendors.reduce((sum, v) => sum + v.awardedSpend, 0);

  const vendorsWithLeadTime = filteredByDropdownVendors.filter(
    (v): v is typeof v & { leadTimeDays: number } => v.leadTimeDays !== null
  );
  const avgSlaDays =
    vendorsWithLeadTime.length > 0
      ? (vendorsWithLeadTime.reduce((sum, v) => sum + v.leadTimeDays, 0) / vendorsWithLeadTime.length).toFixed(1)
      : '—';
  const vendorsWithCompliance = filteredByDropdownVendors.filter(
    (v): v is typeof v & { complianceRate: number } => v.complianceRate !== null
  );
  const avgComplianceRate =
    vendorsWithCompliance.length > 0
      ? Math.round(vendorsWithCompliance.reduce((sum, v) => sum + v.complianceRate, 0) / vendorsWithCompliance.length)
      : null;

  // Dynamic context drill down precedence:
  //  1. An explicit "Hide Details" collapse always wins and keeps the panel closed,
  //     even if the dropdown selection changes afterwards. Clicking a card's
  //     expand action clears the dismissal.
  //  2. Otherwise a specific dropdown selection drives the expansion.
  //  3. Otherwise fall back to the manually expanded card.
  const dropdownDrivenVendorId = selectedContactFilterId !== 'all' ? selectedContactFilterId : null;
  const activeVendorId = drillDownDismissed ? null : dropdownDrivenVendorId ?? selectedVendorId;
  const selectedVendor = compiledVendors.find((v) => v.id === activeVendorId);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeVendorId) {
        setSelectedVendorId(null);
        setDrillDownDismissed(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVendorId]);

  const selectedCompanyVendors = useMemo(() => {
    return selectedCompany !== 'all'
      ? compiledVendors.filter((v) => v.company === selectedCompany)
      : [];
  }, [compiledVendors, selectedCompany]);

  // Render individual vendor card with rich section-aware metadata
  const renderVendorCard = (v: (typeof compiledVendors)[0]) => {
    const isSelected = activeVendorId === v.id;
    const missingEmail = !v.email;
    const isProcucevSection = v.classification.section === 'cm_procucev';

    return (
      <div
        key={v.id}
        data-testid={`vendor-card-${v.id}`}
        className={`glass-panel p-5 rounded-2xl border-2 transition-all flex flex-col justify-between space-y-4 relative overflow-hidden group ${
          isSelected
            ? 'border-emerald-650 dark:border-emerald-500 bg-emerald-50/10 dark:bg-emerald-950/10 shadow-md ring-2 ring-emerald-500/20'
            : missingEmail
              ? 'border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20'
              : 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20'
        }`}
      >
        {/* Subtle decorative top accent bar indicating section origin */}
        <div
          className={`absolute top-0 left-0 right-0 h-1 ${
            isProcucevSection
              ? 'bg-gradient-to-r from-emerald-500 to-indigo-500'
              : 'bg-gradient-to-r from-sky-500 to-amber-500'
          }`}
        />

        {/* Upper Block: Profile & Badges */}
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`w-11 h-11 rounded-xl ${v.avatarColor} font-bold text-xs flex items-center justify-center shrink-0 overflow-hidden select-none shadow-sm ring-1 ring-slate-200 dark:ring-gray-800`}>
              {getInitials(v.company || v.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                {/* Source Badge */}
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold border ${v.classification.badgeClass}`}>
                  {v.classification.icon === 'shield' && <ShieldCheck size={10} />}
                  {v.classification.icon === 'upload' && <Upload size={10} />}
                  {v.classification.icon === 'zap' && <Zap size={10} />}
                  {v.classification.icon === 'building' && <Building2 size={10} />}
                  <span>{v.classification.label}</span>
                </span>

                {/* Rating badge */}
                <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/40 flex items-center gap-0.5 shrink-0 ml-auto sm:ml-0">
                  ⭐ {v.rating}
                </span>
              </div>

              <h4 className="font-black text-slate-900 dark:text-white text-xs sm:text-sm line-clamp-1" title={v.company}>
                <CompanyHoverTooltip
                  name={v.company}
                  type="vendor"
                  contact={{ contactPerson: v.name, email: v.email, location: v.location }}
                />
              </h4>

              <div className="text-[10px] text-slate-500 dark:text-gray-400 space-y-0.5 mt-1 font-medium">
                {v.name && v.name !== v.company && (
                  <div className="flex items-center gap-1 font-semibold text-slate-700 dark:text-gray-300 truncate">
                    <span>👤 {v.name}</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-500 dark:text-gray-400">
                  <span className="flex items-center gap-0.5 truncate max-w-[200px]" title={v.email || undefined}>
                    <Mail size={10} className="text-indigo-500 shrink-0" /> {v.email || 'No Email'}
                  </span>
                  {v.phone ? (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        <Phone size={10} className="text-indigo-500 shrink-0" /> {v.phone}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 text-[9px] font-semibold border border-slate-200 dark:border-gray-700">
                  {v.category}
                </span>
                {v.location && (
                  <span className="text-[9px] text-slate-400 dark:text-gray-500 flex items-center gap-0.5">
                    📍 {v.location}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Section Context Note */}
        <div className="p-2 rounded-lg bg-slate-50 dark:bg-gray-950/70 border border-slate-200/70 dark:border-gray-800/80 text-[10px] flex items-center justify-between text-slate-600 dark:text-gray-300">
          <span className="flex items-center gap-1.5 truncate">
            {isProcucevSection ? (
              <>
                <ShieldCheck size={11} className="text-emerald-500 shrink-0" />
                <span className="truncate"><strong>Section 1</strong>: {v.classification.description}</span>
              </>
            ) : (
              <>
                <UserCheck size={11} className="text-sky-500 shrink-0" />
                <span className="truncate"><strong>Section 2</strong>: {v.classification.description}</span>
              </>
            )}
          </span>
          {v.addedByBuyerCompany && (
            <span className="badge badge-sky text-[8px] font-bold shrink-0 ml-1">
              Org: {v.addedByBuyerCompany}
            </span>
          )}
        </div>

        {/* Mid Block: Metrics */}
        <div className="grid grid-cols-3 gap-2 py-2.5 border-t border-b border-slate-100 dark:border-gray-800 text-center text-xs">
          <div>
            <div className="text-[9px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-wider">Total Bids</div>
            <div className="font-black text-slate-800 dark:text-white mt-0.5 mono text-xs">{v.rfqsList.length}</div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-wider">Compliance</div>
            <div className="font-black text-slate-800 dark:text-white mt-0.5 mono text-xs">
              {v.complianceRate === null ? '—' : `${v.complianceRate}%`}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-wider">Awarded Spend</div>
            <div className="font-black text-emerald-600 dark:text-emerald-400 mt-0.5 mono text-xs">
              {formatCurrency(v.awardedSpend)}
            </div>
          </div>
        </div>

        {/* Lower Block: Actions */}
        <div className="flex justify-between items-center pt-1">
          <span className="text-[9px] text-slate-400 flex items-center gap-1 font-mono">
            <Clock size={10} /> Avg lead time: {v.leadTimeDays === null ? 'No quotes yet' : `${v.leadTimeDays} days`}
          </span>

          <button
            onClick={() => {
              if (isSelected) {
                setSelectedVendorId(null);
                setDrillDownDismissed(true);
              } else {
                setSelectedVendorId(v.id);
                setDrillDownDismissed(false);
                setExpandedQuoteNumber(null);
              }
            }}
            className="btn btn-secondary btn-xs font-bold flex items-center gap-1 hover:border-indigo-400"
          >
            <span>{isSelected ? UI_STRINGS.actions.hideDetails : UI_STRINGS.actions.reviewVendorPerformance}</span>
            <ChevronRight size={12} className={`transform transition-transform ${isSelected ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TITLE HEADER & ACTION BAR */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Vendor Summary & Performance Analytics
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60">
              <Sparkles size={11} /> Dual-Stream Directory
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Unified console segmented into Category Manager uploaded Procucev vendors and Self-Onboarded / Buyer-Added private vendors.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setUploadModalOpen(true)}
            className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Upload size={14} /> Bulk Upload Vendors
          </button>
        </div>
      </div>

      <VendorUploadModal isOpen={uploadModalOpen} onClose={() => setUploadModalOpen(false)} />

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DYNAMIC VENDOR CONTEXT SELECTOR & SECTION TABS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/70 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-gray-300 shrink-0">
            <Building2 size={16} className="text-indigo-500" />
            <span>Active Context Selection:</span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto text-xs">
            {/* Vendor Company Dropdown */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500 shrink-0">Vendor Company</label>
              <select
                value={selectedCompany}
                onChange={(e) => {
                  setSelectedCompany(e.target.value);
                  setSelectedContactFilterId('all'); // Reset contact on company change
                }}
                className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold w-full sm:w-auto"
              >
                <option value="all">🌐 All Vendor Companies</option>
                {Array.from(new Set(compiledVendors.map((v) => v.company))).map((company) => (
                  <option key={company} value={company}>
                    🏢 {company}
                  </option>
                ))}
              </select>
            </div>

            {/* Dependent Contact Dropdown */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500 shrink-0">Contact Person</label>
              <select
                value={selectedContactFilterId}
                onChange={(e) => setSelectedContactFilterId(e.target.value)}
                className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold w-full sm:w-auto"
                disabled={selectedCompany === 'all'}
              >
                {selectedCompany === 'all' ? (
                  <option value="all">👥 Select Company First</option>
                ) : (
                  <>
                    <option value="all">👥 All Contacts in Company</option>
                    {compiledVendors.filter((v) => v.company === selectedCompany).map((v) => (
                      <option key={v.id} value={v.id}>
                        👤 {v.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
          </div>
        </div>

        {/* Section View Pills / Segmented Switcher */}
        <div className="pt-2 border-t border-slate-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-wider mr-1">
              Directory Stream:
            </span>

            <button
              type="button"
              onClick={() => setActiveSectionFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeSectionFilter === 'all'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700'
              }`}
            >
              <Globe size={13} />
              <span>All Suppliers</span>
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 dark:bg-black/20 font-mono">
                {filteredByDropdownVendors.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSectionFilter('cm_procucev')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeSectionFilter === 'cm_procucev'
                  ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/20'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
              }`}
            >
              <ShieldCheck size={13} />
              <span>1. CM Uploaded & Procucev</span>
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-200/50 dark:bg-emerald-800/50 font-mono">
                {cmProcucevVendors.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSectionFilter('self_onboard_buyer')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeSectionFilter === 'self_onboard_buyer'
                  ? 'bg-sky-600 text-white shadow-sm ring-2 ring-sky-500/20'
                  : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/40 hover:bg-sky-100 dark:hover:bg-sky-900/40'
              }`}
            >
              <UserCheck size={13} />
              <span>2. Self-Onboard & Buyer Added</span>
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-sky-200/50 dark:bg-sky-800/50 font-mono">
                {selfBuyerVendors.length}
              </span>
            </button>
          </div>

          <div className="text-[11px] text-slate-400 dark:text-gray-500 font-medium">
            {activeSectionFilter === 'all'
              ? 'Showing dual 2-section stacked view below'
              : activeSectionFilter === 'cm_procucev'
                ? 'Filtered to Section 1 (Procucev Network & CM Uploads)'
                : 'Filtered to Section 2 (Self-Onboarded & Buyer Added)'}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR PERFORMANCE ANALYTICS PANEL & SCORECARD (HIDDEN) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="hidden" aria-hidden="true">
        {/* Left Pane: Aggregated performance stats */}
        <div className="lg:col-span-1 space-y-3.5">
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                  Total Awarded Spend
                </div>
                <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5 mono">
                  {formatCurrency(totalAwardedSpend)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                <IndianRupee size={22} />
              </div>
            </div>

            {/* Dual section spend breakdown */}
            <div className="pt-2 border-t border-slate-100 dark:border-gray-800 grid grid-cols-2 gap-2 text-[10px]">
              <div className="p-1.5 rounded bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40">
                <span className="text-emerald-700 dark:text-emerald-300 font-semibold block">🛡️ Procucev/CM</span>
                <span className="font-bold mono text-slate-800 dark:text-gray-200">{formatCurrency(cmProcucevSpend)}</span>
              </div>
              <div className="p-1.5 rounded bg-sky-50/60 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40">
                <span className="text-sky-700 dark:text-sky-300 font-semibold block">👥 Buyer/Self</span>
                <span className="font-bold mono text-slate-800 dark:text-gray-200">{formatCurrency(selfBuyerSpend)}</span>
              </div>
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                Avg Quote Compliance
              </div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5 mono">
                {avgComplianceRate === null ? '—' : `${avgComplianceRate}%`}
              </p>
              <div className="text-[10px] text-slate-400 dark:text-gray-500 mt-1">
                Across submitted quotation line-items
              </div>
            </div>
            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
              <Clock size={22} />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                Average Lead Time
              </div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5 mono">
                {avgSlaDays === '—' ? '—' : `${avgSlaDays} Days`}
              </p>
              <div className="text-[10px] text-slate-400 dark:text-gray-500 mt-1">
                Fulfillment SLA benchmark
              </div>
            </div>
            <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
              <Layers size={22} />
            </div>
          </div>
        </div>

        {/* Right Pane: Company Wise Performance & Scorecard */}
        <div className="lg:col-span-2 glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm space-y-4">
          <div className="border-b border-slate-100 dark:border-gray-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-500" />
                <span>Vendor Company Performance Scorecard</span>
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">
                Quote compliance & lead time, calculated from real submitted quotes
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-semibold">
                Showing {filteredByDropdownVendors.length} profiled suppliers
              </span>
            </div>
          </div>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {filteredByDropdownVendors.length === 0 && (
              <p className="text-[11px] text-slate-400 dark:text-gray-500 py-6 text-center">
                No vendors match the current selection.
              </p>
            )}
            {filteredByDropdownVendors.map((v) => {
              const isCmProc = v.classification.section === 'cm_procucev';

              return (
                <div
                  key={v.id}
                  data-testid="scorecard-vendor-item"
                  className="text-xs p-3 rounded-xl bg-slate-50/80 dark:bg-gray-950/60 border border-slate-200/70 dark:border-gray-800 space-y-2 hover:border-slate-300 dark:hover:border-gray-700 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-slate-700 dark:text-gray-300 font-semibold">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className={`w-5 h-5 rounded-md ${v.logoBg} font-mono font-bold text-[9px] flex items-center justify-center shrink-0`}>
                        {v.logoLetter}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white">{v.company}</span>
                      <span className="text-slate-500 font-normal">({v.name})</span>

                      {/* Source tag on scorecard */}
                      <span className={`text-[8px] font-bold px-1.5 py-0.2 rounded-full border ${
                        isCmProc
                          ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200'
                          : 'bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border-sky-200'
                      }`}>
                        {v.classification.shortLabel}
                      </span>
                    </span>

                    <span className="mono font-bold text-slate-900 dark:text-white text-[11px]">
                      Compliance: {v.complianceRate === null ? '—' : `${v.complianceRate}%`} · Lead: {v.leadTimeDays === null ? '—' : `${v.leadTimeDays}d`} · Rating: ⭐ {v.rating}
                    </span>
                  </div>

                  {/* Vendor Contact Details */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-gray-300 bg-white dark:bg-gray-900 px-3 py-1.5 rounded-lg border border-slate-200/60 dark:border-gray-800 font-medium">
                    <span className="flex items-center gap-1">
                      <Users size={12} className="text-indigo-500 shrink-0" />
                      <span className="text-slate-400 dark:text-gray-500 uppercase text-[9px] font-bold">Vendor Name:</span>
                      <strong className="text-slate-800 dark:text-gray-200">{v.name}</strong>
                    </span>
                    <span className="text-slate-300 dark:text-gray-700">•</span>
                    <span className="flex items-center gap-1">
                      <Mail size={12} className="text-indigo-500 shrink-0" />
                      <span className="text-slate-400 dark:text-gray-500 uppercase text-[9px] font-bold">Email:</span>
                      {v.email ? (
                        <a href={`mailto:${v.email}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                          {v.email}
                        </a>
                      ) : (
                        <span className="text-slate-400 dark:text-gray-500 italic">N/A</span>
                      )}
                    </span>
                    <span className="text-slate-300 dark:text-gray-700">•</span>
                    <span className="flex items-center gap-1">
                      <Phone size={12} className="text-indigo-500 shrink-0" />
                      <span className="text-slate-400 dark:text-gray-500 uppercase text-[9px] font-bold">Phone:</span>
                      {v.phone ? (
                        <a href={`tel:${v.phone}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                          {v.phone}
                        </a>
                      ) : (
                        <span className="text-slate-400 dark:text-gray-500 italic">N/A</span>
                      )}
                    </span>
                  </div>

                  <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${v.complianceRate ?? 0}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDORS PERFORMANCE LIST — 2 DEDICATED SECTIONS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-6">
        {/* Search, Filter & Controls Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800">
          <div className="space-y-0.5">
            <h3 className="text-xs font-black text-slate-800 dark:text-gray-200 uppercase tracking-wider flex items-center gap-2">
              <Users size={15} className="text-indigo-600 dark:text-indigo-400" />
              <span>Vendor Wise Performance & Bid Summary</span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-gray-400">
              Showing {pagedVendors.length}
              {vendorsPagination ? ` of ${vendorsPagination.total.toLocaleString()}` : ''} total suppliers
              ({cmProcucevVendors.length} Procucev/CM · {selfBuyerVendors.length} Self/Buyer)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Box */}
            <div className="relative w-full sm:w-64">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search size={13} />
              </span>
              <input
                type="text"
                placeholder="Search Vendor name or category..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input pl-8 py-1.5 text-xs w-full"
              />
            </div>

            {/* Category filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="select py-1.5 px-3 text-xs w-full sm:w-44 bg-white dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-medium"
            >
              <option value="">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {vendorsLoading && (
          <p className="text-[11px] text-slate-400 dark:text-gray-500 py-8 text-center">Loading vendors…</p>
        )}

        {!vendorsLoading && vendorsError && (
          <p className="text-[11px] text-rose-500 py-8 text-center">{vendorsError}</p>
        )}

        {!vendorsLoading && !vendorsError && pagedVendors.length === 0 && (
          <div className="text-center py-12 glass-panel rounded-2xl border border-dashed border-slate-300 dark:border-gray-800 space-y-2">
            <Users size={32} className="mx-auto text-slate-400" />
            <h4 className="font-bold text-sm text-slate-800 dark:text-gray-200">No Vendors Found</h4>
            <p className="text-xs text-slate-500 dark:text-gray-400 max-w-sm mx-auto">
              No vendors match the current search or category filter criteria. Try clearing filters or use bulk upload.
            </p>
          </div>
        )}

        {!vendorsLoading && !vendorsError && pagedVendors.length > 0 && (
          <div className="space-y-8">
            {/* ═════════════════════════════════════════════════════════ */}
            {/* SECTION 1: CATEGORY MANAGER UPLOADED & PROCUCEV VENDORS */}
            {/* ═════════════════════════════════════════════════════════ */}
            {(activeSectionFilter === 'all' || activeSectionFilter === 'cm_procucev') && (
              <section className="space-y-4">
                {/* Section 1 Header Banner */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 dark:border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
                      <ShieldCheck size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white tracking-tight">
                          Category Manager Uploaded & Procucev Vendors
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300/50">
                          {cmProcucevVendors.length} Suppliers
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-gray-400 mt-0.5">
                        Pre-verified Procucev supplier network and bulk catalog master imports curated by Category Managers.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setUploadModalOpen(true)}
                    className="btn btn-secondary btn-xs font-bold text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 self-start sm:self-auto shrink-0"
                  >
                    <Upload size={12} className="mr-1" /> Add / Upload CM Vendors
                  </button>
                </div>

                {cmProcucevVendors.length === 0 ? (
                  <div className="p-6 text-center rounded-xl bg-slate-50/60 dark:bg-gray-950/30 border border-slate-200/60 dark:border-gray-800 text-xs text-slate-400 dark:text-gray-500">
                    No Category Manager uploaded or Procucev network vendors match current filter criteria.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {cmProcucevVendors.map(renderVendorCard)}
                  </div>
                )}
              </section>
            )}

            {/* ═════════════════════════════════════════════════════════ */}
            {/* SECTION 2: SELF-ONBOARDED & BUYER ADDED VENDORS */}
            {/* ═════════════════════════════════════════════════════════ */}
            {(activeSectionFilter === 'all' || activeSectionFilter === 'self_onboard_buyer') && (
              <section className="space-y-4">
                {/* Section 2 Header Banner */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-sky-500/10 via-amber-500/5 to-transparent border border-sky-500/20 dark:border-sky-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center shadow-sm shrink-0">
                      <UserCheck size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white tracking-tight">
                          Self-Onboarded & Buyer Added Own Vendors
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border border-sky-300/50">
                          {selfBuyerVendors.length} Suppliers
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-gray-400 mt-0.5">
                        Suppliers who self-registered via vendor portal onboarding, and private supplier accounts imported by enterprise buyers.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-start sm:self-auto shrink-0">
                    <span className="px-2 py-1 rounded text-[10px] font-semibold bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-gray-800">
                      🔒 Private / Buyer-Bound Access
                    </span>
                  </div>
                </div>

                {selfBuyerVendors.length === 0 ? (
                  <div className="p-6 text-center rounded-xl bg-slate-50/60 dark:bg-gray-950/30 border border-slate-200/60 dark:border-gray-800 text-xs text-slate-400 dark:text-gray-500">
                    No Self-onboarded or Buyer-added vendors match current filter criteria.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selfBuyerVendors.map(renderVendorCard)}
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {/* Load More Pagination Button */}
        {hasMoreVendorCards && (
          <button
            type="button"
            data-testid="load-more-vendor-cards"
            onClick={loadMoreVendors}
            disabled={vendorsLoadingMore}
            className="w-full py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-gray-700 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50 transition-colors shadow-sm"
          >
            {vendorsLoadingMore ? 'Loading more suppliers…' : `Load ${VENDOR_CARDS_PAGE_SIZE} more vendors`}
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* PERFORMANCE AUDIT & BID ROSTER MODAL (OPENS ON SELECTION) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {selectedVendor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vendor-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedVendorId(null);
              setDrillDownDismissed(true);
            }
          }}
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fade-in"
        >
          <div className="relative w-full max-w-4xl bg-white dark:bg-gray-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col animate-scale-in">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-gray-800 flex items-start justify-between gap-3 bg-gradient-to-r from-slate-50 via-white to-slate-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <span className={`w-10 h-10 rounded-xl ${selectedVendor.logoBg} font-mono font-bold text-sm flex items-center justify-center shrink-0 shadow-sm mt-0.5`}>
                  {selectedVendor.logoLetter}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border ${selectedVendor.classification.badgeClass}`}>
                      {selectedVendor.classification.label}
                    </span>
                    <span className="text-[10px] mono text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200/30">
                      {selectedVendor.rfqsList.length} total bids submitted
                    </span>
                  </div>
                  <h3 id="vendor-modal-title" className="text-sm sm:text-base font-black text-slate-900 dark:text-white flex items-center gap-2 truncate">
                    <Building2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Sourcing Bid Roster for {selectedVendor.company} ({selectedVendor.name})</span>
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">
                    Performance Telemetry & Line-Item Quotations Audit. Inspect submitted line-item bids and compliance.
                  </p>
                </div>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => {
                  setSelectedVendorId(null);
                  setDrillDownDismissed(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors shrink-0"
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 flex-1">
              {/* Telemetry Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200/80 dark:border-gray-800 text-xs">
                <div>
                  <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Overall Rating</div>
                  <div className="font-black text-slate-900 dark:text-white text-xs mt-0.5">⭐ {selectedVendor.rating}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Awarded Spend</div>
                  <div className="font-black text-emerald-600 dark:text-emerald-400 text-xs mt-0.5 mono">{formatCurrency(selectedVendor.awardedSpend)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Quote Compliance</div>
                  <div className="font-black text-slate-900 dark:text-white text-xs mt-0.5 mono">{selectedVendor.complianceRate === null ? '—' : `${selectedVendor.complianceRate}%`}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Avg Lead Time</div>
                  <div className="font-black text-slate-900 dark:text-white text-xs mt-0.5 mono">{selectedVendor.leadTimeDays === null ? 'No quotes yet' : `${selectedVendor.leadTimeDays} days`}</div>
                </div>
              </div>

              {/* Vendor Profile Contact Details */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-50/70 dark:bg-gray-950/70 border border-slate-200 dark:border-gray-800 text-xs">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate">Contact: <strong className="text-slate-900 dark:text-white">{selectedVendor.name}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate">Email: <strong className="text-slate-900 dark:text-white">{selectedVendor.email || 'N/A'}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate">Phone: <strong className="text-slate-900 dark:text-white">{selectedVendor.phone || 'N/A'}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <Tag size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate">Stream: <strong className="text-slate-900 dark:text-white">{selectedVendor.classification.section === 'cm_procucev' ? 'Section 1 (Procucev/CM)' : 'Section 2 (Buyer/Self)'}</strong></span>
                </div>
              </div>

              {/* Sourcing Bids List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-gray-200 uppercase tracking-wider">
                    Submitted Quotations & RFQ Bids
                  </h4>
                  <span className="text-[10px] text-slate-400">Click row to expand line-item pricing</span>
                </div>

                {selectedVendor.rfqsList.length === 0 ? (
                  <div className="text-center py-10 text-xs text-slate-400 dark:text-gray-500 rounded-xl border border-dashed border-slate-200 dark:border-gray-800">
                    No active bids or quotes found in category database for this vendor.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedVendor.rfqsList.map((rfq) => {
                      const isQuoteExpanded = expandedQuoteNumber === rfq.rfqNumber;
                      const matchingQuote = rfq.quotes.find((q) => q.vendorId === selectedVendor.id)!;

                      return (
                        <div
                          key={rfq.rfqNumber}
                          className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-gray-950/40"
                        >
                          {/* Header Row */}
                          <div
                            onClick={() => setExpandedQuoteNumber(isQuoteExpanded ? null : rfq.rfqNumber)}
                            className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-gray-900/50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className={`w-6 h-6 rounded-md ${selectedVendor.logoBg} font-mono font-bold text-[9px] flex items-center justify-center shrink-0`}>
                                {selectedVendor.logoLetter}
                              </span>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900 dark:text-white text-xs">{rfq.title}</span>
                                  <span className="text-[10px] font-mono font-bold text-slate-550 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.25 rounded border border-slate-200 dark:border-gray-700">
                                    {rfq.rfqNumber}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-[10px] text-slate-450 dark:text-gray-500 mt-1">
                                  <span>Sourced Spend: <strong>{formatCurrency(rfq.budget)}</strong></span>
                                  <span>Line Items: <strong>{rfq.extractedEntities.length}</strong></span>
                                  <span>Total Quote Value: <strong className="text-emerald-600">{formatCurrency(matchingQuote.totalPrice)}</strong></span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-auto">
                              <span className="px-2 py-0.5 rounded text-[8px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-750 dark:text-indigo-300 border border-indigo-200/30">
                                Lead: {matchingQuote.leadTimeDays} days
                              </span>
                              <span className={`badge text-[9px] ${
                                matchingQuote.complianceStatus.includes('Fully') ? 'badge-emerald' : 'badge-amber'
                              }`}>
                                {matchingQuote.complianceStatus}
                              </span>
                              <ChevronDown size={14} className="text-slate-455 transition-transform" style={{ transform: isQuoteExpanded ? 'rotate(180deg)' : 'none' }} />
                            </div>
                          </div>

                          {/* Expanded Block */}
                          {isQuoteExpanded && (
                            <div className="p-4 border-t border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 space-y-4 animate-fade-in text-xs">
                              {/* Quote summary card details */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-250/60 dark:border-gray-850 space-y-2">
                                  <h4 className="text-[10px] font-bold uppercase text-slate-450 dark:text-gray-500 tracking-wider">Quotation Parameters</h4>
                                  <div className="space-y-1.5 text-[11px]">
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Unit Sourced Price:</span>
                                      <span className="font-bold text-slate-900 dark:text-white">${matchingQuote.unitPrice?.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Total Bidded Price:</span>
                                      <span className="font-bold text-emerald-600 dark:text-emerald-450 font-mono">{formatCurrency(matchingQuote.totalPrice)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Payment Terms:</span>
                                      <span className="font-bold text-slate-800 dark:text-white">{matchingQuote.paymentTerms}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-250/60 dark:border-gray-850 space-y-2">
                                  <h4 className="text-[10px] font-bold uppercase text-slate-450 dark:text-gray-500 tracking-wider">Remarks & Compliance Audit</h4>
                                  <p className="text-slate-650 dark:text-gray-300 text-[11px] leading-relaxed">
                                    {matchingQuote.remarks}
                                  </p>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/30 text-[11px] text-indigo-750 dark:text-indigo-300">
                                <span>
                                  🚀 <strong>Category Manager Action</strong>: You can check the overall ranking of this quote in the central Quote Matrix.
                                </span>
                                <button
                                  onClick={() => onNavigateToMatrix && onNavigateToMatrix(rfq)}
                                  className="btn btn-primary btn-xs font-bold"
                                >
                                  Go to Central Quote Matrix
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-gray-800 bg-slate-50/80 dark:bg-gray-950/80 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedVendorId(null);
                  setDrillDownDismissed(true);
                }}
                className="btn btn-secondary btn-sm font-bold"
              >
                Close Modal
              </button>

              <span className="text-[11px] text-slate-400">
                Press <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-gray-800 text-[10px] font-mono">ESC</kbd> to close modal
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
