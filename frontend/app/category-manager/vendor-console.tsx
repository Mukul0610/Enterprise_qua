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

  // Was a hardcoded list of 6 fake vendor profiles with invented ratings,
  // SLAs and awarded-spend figures. Every metric below is now derived from
  // the real vendor directory and the real quotes vendors have actually
  // submitted — nothing here is invented. Metrics reflect only the vendor
  // pages fetched so far, same limitation as the loaded-count display below.
  const compiledVendors = useMemo(() => {
    return fetchedVendors.map((vendor) => {
      // Quote submission (Phase 6) always resolves vendorId server-side from
      // the authenticated vendor, so matching by id alone is reliable here —
      // no need to also match by name.
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

      // approvePO always sets awardedVendor (name) alongside awardedAmount in
      // the same update — awardedVendorId is never actually populated by that
      // flow, so matching by name is the real path, not a rare fallback.
      const awardedSpend = rfqs
        .filter((r) => r.status === 'PO Generated' && r.awardedVendor === vendor.name)
        .reduce((sum, r) => sum + (r.awardedAmount as number), 0);

      const style = avatarStyleFor(vendor.name || '?');

      return {
        id: vendor.id,
        name: vendor.contactPerson || vendor.name || 'Unnamed Vendor',
        email: vendor.email,
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
      };
    });
  }, [fetchedVendors, rfqs]);

  // Search is server-side (see the fetch effect above) — only the company/
  // contact dropdowns still filter client-side, over whatever pages have
  // been loaded so far.
  const filteredByDropdownVendors = compiledVendors.filter((v) => {
    const matchCompany = selectedCompany === 'all' || v.company === selectedCompany;
    const matchContact = selectedContactFilterId === 'all' || v.id === selectedContactFilterId;
    return matchCompany && matchContact;
  });
  const pagedVendors = filteredByDropdownVendors;

  // Overall Analytics computations based on dropdown filter scope
  const totalAwardedSpend = filteredByDropdownVendors.reduce((sum, v) => sum + v.awardedSpend, 0);
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

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            Vendor Summary & Performance Analytics
          </h1>
        </div>
        <button
          onClick={() => setUploadModalOpen(true)}
          className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 shrink-0"
        >
          <Upload size={14} /> Bulk Upload Vendors
        </button>
      </div>

      <VendorUploadModal isOpen={uploadModalOpen} onClose={() => setUploadModalOpen(false)} />

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DYNAMIC VENDOR SELECTOR BAR */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/60 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-gray-300">
          <Building2 size={16} className="text-indigo-500" />
          <span>Active Context Selection:</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto text-xs">
          {/* Vendor Company Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Vendor Company</label>
            <select
              value={selectedCompany}
              onChange={(e) => {
                setSelectedCompany(e.target.value);
                setSelectedContactFilterId('all'); // Reset contact on company change
              }}
              className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
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
            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Contact Person</label>
            <select
              value={selectedContactFilterId}
              onChange={(e) => setSelectedContactFilterId(e.target.value)}
              className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
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

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR PERFORMANCE ANALYTICS PANEL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Pane: Aggructured performance stats */}
        <div className="lg:col-span-1 space-y-4">
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-850 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Awarded Spend Contracts</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{formatCurrency(totalAwardedSpend)}</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
              <IndianRupee size={20} />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-855 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Avg Quote Compliance</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">
                {avgComplianceRate === null ? '—' : `${avgComplianceRate}%`}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
              <Clock size={20} />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-860 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Average Lead Time</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">
                {avgSlaDays === '—' ? '—' : `${avgSlaDays} Days`}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
              <Layers size={20} />
            </div>
          </div>
        </div>

        {/* Right Pane: Company Wise Performance & Scorecard */}
        <div className="lg:col-span-2 glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm space-y-4">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-100 dark:border-gray-800 pb-2 flex items-center justify-between">
            <span>Vendor Company performance scorecard</span>
            <span className="text-[10px] text-slate-400 lowercase normal-case">Quote compliance & lead time, from real submitted quotes</span>
          </h3>

          <div className="space-y-3.5">
            {filteredByDropdownVendors.length === 0 && (
              <p className="text-[11px] text-slate-400 dark:text-gray-500 py-4 text-center">No vendors match the current selection.</p>
            )}
            {filteredByDropdownVendors.map((v) => {
              return (
                <div key={v.id} className="text-xs">
                  <div className="flex justify-between items-center text-slate-700 dark:text-gray-300 font-semibold mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-md ${v.logoBg} font-mono font-bold text-[9px] flex items-center justify-center`}>
                        {v.logoLetter}
                      </span>
                      <span>{v.company} ({v.name})</span>
                    </span>
                    <span className="mono font-bold text-slate-900 dark:text-white text-[11px]">
                      Compliance: {v.complianceRate === null ? '—' : `${v.complianceRate}%`} · Lead: {v.leadTimeDays === null ? '—' : `${v.leadTimeDays}d`} · Rating: ⭐ {v.rating}
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
      {/* VENDORS PERFORMANCE LIST */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200 uppercase tracking-wider flex items-center gap-2">
            <Users size={15} className="text-indigo-600 dark:text-indigo-400" />
            Vendor wise Performance & Bid Summary (showing {pagedVendors.length}
            {vendorsPagination ? ` of ${vendorsPagination.total.toLocaleString()}` : ''} Vendors)
          </h3>

          <div className="flex gap-2">
            {/* Search Box */}
            <div className="relative max-w-xs">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search size={13} />
              </span>
              <input
                type="text"
                placeholder="Search Vendor name or category..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input pl-8 py-1.5 text-xs w-full sm:w-64"
              />
            </div>
            {/* Category filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="input py-1.5 text-xs w-40"
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
          <p className="text-[11px] text-slate-400 dark:text-gray-500 py-8 text-center">No vendors match the current selection.</p>
        )}

        {/* Vendors Performance Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pagedVendors.map((v) => {
            // Reflect the resolved panel state so the toggle label always matches
            // what is actually on screen, including dropdown-driven expansion.
            const isSelected = activeVendorId === v.id;
            const missingEmail = !v.email;

            return (
              <div
                key={v.id}
                className={`glass-panel p-5 rounded-2xl border-2 transition-all flex flex-col justify-between space-y-4 ${
                  isSelected
                    ? 'border-emerald-650 dark:border-emerald-500 bg-emerald-50/10 dark:bg-emerald-950/10 shadow-md'
                    : missingEmail
                      ? 'border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20'
                      : 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20'
                }`}
              >
                {/* Upper Block: Profile */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full ${v.avatarColor} font-bold text-xs flex items-center justify-center shrink-0`}>
                      {v.name.split(' ').map((n) => n[0]).join('')}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                        <CompanyHoverTooltip
                          name={v.company}
                          type="vendor"
                          contact={{ contactPerson: v.name, email: v.email, location: v.location }}
                        />
                      </h4>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500">{v.name} · {v.email}</p>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 text-[9px] font-semibold border border-slate-200 dark:border-gray-700">
                          {v.category}
                        </span>
                      </div>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded text-[9px] font-extrabold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/30 flex items-center gap-0.5">
                    ⭐ {v.rating} Rating
                  </span>
                </div>

                {/* Mid Block: Metrics */}
                <div className="grid grid-cols-3 gap-2 py-3 border-t border-b border-slate-100 dark:border-gray-850 text-center text-xs">
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-500 font-bold uppercase">Total Bids</div>
                    <div className="font-black text-slate-800 dark:text-white mt-0.5 mono">{v.rfqsList.length}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-500 font-bold uppercase">Quote Compliance</div>
                    <div className="font-black text-slate-800 dark:text-white mt-0.5 mono">{v.complianceRate === null ? '—' : `${v.complianceRate}%`}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-550 font-bold uppercase">Awarded Spend</div>
                    <div className="font-black text-emerald-600 dark:text-emerald-400 mt-0.5 mono">{formatCurrency(v.awardedSpend)}</div>
                  </div>
                </div>

                {/* Lower Block: Actions */}
                <div className="flex justify-between items-center pt-1.5">
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
                    className="btn btn-secondary btn-xs font-bold flex items-center gap-1"
                  >
                    <span>{isSelected ? UI_STRINGS.actions.hideDetails : UI_STRINGS.actions.reviewVendorPerformance}</span>
                    <ChevronRight size={12} className={`transform transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {hasMoreVendorCards && (
          <button
            type="button"
            data-testid="load-more-vendor-cards"
            onClick={loadMoreVendors}
            disabled={vendorsLoadingMore}
            className="w-full py-2 rounded-lg border border-dashed border-slate-300 dark:border-gray-700 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50"
          >
            {vendorsLoadingMore ? 'Loading…' : `Load ${VENDOR_CARDS_PAGE_SIZE} more vendors`}
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DETAILED DRILL DOWN SECTION (EXPANDS ON SELECTION) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {selectedVendor && (
        <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md space-y-4 animate-slide-up">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                Sourcing Bid Roster for {selectedVendor.company} ({selectedVendor.name})
              </h3>
              <p className="text-[10px] text-slate-450 dark:text-gray-500">
                Performance Audit. Inspect line-item quote values submitted by this vendor for active RFQ items below.
              </p>
            </div>
            <span className="text-[11px] mono text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200/20">
              {selectedVendor.rfqsList.length} total bids submitted
            </span>
          </div>

          {selectedVendor.rfqsList.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400 dark:text-gray-500">
              No active bids or quotes found in category database for this vendor.
            </div>
          ) : (
            <div className="space-y-3">
              {selectedVendor.rfqsList.map((rfq) => {
                const isQuoteExpanded = expandedQuoteNumber === rfq.rfqNumber;

                // rfqsList is already scoped to RFQs where this vendor has a
                // real quote (same predicate used here), so this always
                // resolves — no fabricated fallback values.
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
      )}
    </div>
  );
}
