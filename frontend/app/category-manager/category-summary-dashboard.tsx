'use client';

import React, { useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  Layers,
  Search,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';

type TimeframeOption = '7d' | '30d' | '90d' | '180d' | '1y';

const TIMEFRAME_DAYS: Record<TimeframeOption, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '1y': 365 };
const TIMEFRAME_LABELS: Record<TimeframeOption, string> = {
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days (Quarterly)',
  '180d': 'Last 180 Days (Half Yearly)',
  '1y': 'Last 1 Year (Annual)',
};

interface CategoryMetric {
  majorCategory: string;
  minorCount: number;
  rfqsCount: Record<TimeframeOption, number>;
  quotesReceived: Record<TimeframeOption, number>;
  activeBuyers: string[];
  availableVendorsCount: number;
  featuredVendors: string[];
  growthPercentage: Record<TimeframeOption, number | null>;
  demandStatus: 'High Demand' | 'Optimal' | 'Growing' | 'Emerging' | 'No Activity';
}

export function parseTimestamp(value: string): number {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// RFQs created in the real-time window [now - offsetDays - days, now - offsetDays),
// optionally scoped to one major category.
export function rfqsInWindow(rfqs: RFQItem[], days: number, offsetDays: number, majorCategory?: string): RFQItem[] {
  const now = Date.now();
  const end = now - offsetDays * 86400000;
  const start = end - days * 86400000;
  return rfqs.filter((r) => {
    if (majorCategory && r.category !== majorCategory) return false;
    const t = parseTimestamp(r.createdAt);
    return t >= start && t < end;
  });
}

// Compares the current window against the equal-length window immediately
// before it. Returns null when there's no prior-period baseline to compare
// against (a 0-to-N jump isn't a meaningful percentage) rather than
// fabricating a number.
export function growthPercentFor(rfqs: RFQItem[], days: number, majorCategory?: string): number | null {
  const current = rfqsInWindow(rfqs, days, 0, majorCategory).length;
  const prior = rfqsInWindow(rfqs, days, days, majorCategory).length;
  if (prior === 0) return current > 0 ? null : 0;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

export function demandStatusFor(rfqsIn30d: number): CategoryMetric['demandStatus'] {
  if (rfqsIn30d === 0) return 'No Activity';
  if (rfqsIn30d >= 10) return 'High Demand';
  if (rfqsIn30d >= 5) return 'Optimal';
  if (rfqsIn30d >= 2) return 'Growing';
  return 'Emerging';
}

export function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="inline-flex items-center gap-0.5 text-xs font-black text-indigo-600 dark:text-indigo-400 mono">New</span>;
  }
  if (value === 0) {
    return <span className="inline-flex items-center gap-0.5 text-xs font-black text-slate-400 dark:text-gray-500 mono">Flat</span>;
  }
  const isUp = value > 0;
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-black mono ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      <Icon size={13} /> {isUp ? '+' : ''}{value}%
    </span>
  );
}

export default function CategorySummaryDashboard() {
  // `categoryTaxonomy` is the category master read from the database. It replaces
  // a bundled categories.json copy, so this dashboard now counts categories that
  // actually exist in `category_division` rather than whatever the shipped file
  // happened to contain.
  const {
    rfqs,
    buyerVendors,
    buyerAccounts,
    addAuditLog,
    showToast,
    categoryTaxonomy,
    categoryTaxonomyError,
  } = useApp();

  const taxonomy = useMemo(() => categoryTaxonomy || [], [categoryTaxonomy]);

  const [timeframe, setTimeframe] = useState<TimeframeOption>('30d');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMajor, setExpandedMajor] = useState<Record<string, boolean>>({});

  // Was a hardcoded table of 13 categories with entirely invented RFQ counts,
  // "download" counts nothing in this app tracks, growth percentages, and
  // active-buyer/featured-vendor lists using real company names that had
  // nothing to do with the RFQs actually raised in this system. Every metric
  // below is now derived from real rfqs/buyerVendors/buyerAccounts data
  // already loaded via useApp(). "RFQs Downloaded" has no honest
  // replacement — nothing in this app tracks RFQ downloads — so it's
  // replaced with real "Quotes Received" instead.
  const categoryMetrics: CategoryMetric[] = useMemo(() => {
    return taxonomy.map((cat) => {
      const majorCategory = cat.majorCategory;
      const rfqsCount = {} as Record<TimeframeOption, number>;
      const quotesReceived = {} as Record<TimeframeOption, number>;
      const growthPercentage = {} as Record<TimeframeOption, number | null>;

      (Object.keys(TIMEFRAME_DAYS) as TimeframeOption[]).forEach((tf) => {
        const inWindow = rfqsInWindow(rfqs, TIMEFRAME_DAYS[tf], 0, majorCategory);
        rfqsCount[tf] = inWindow.length;
        quotesReceived[tf] = inWindow.reduce((sum, r) => sum + (r.quotesCount || 0), 0);
        growthPercentage[tf] = growthPercentFor(rfqs, TIMEFRAME_DAYS[tf], majorCategory);
      });

      const activeBuyers = Array.from(
        new Set(
          rfqs
            .filter((r) => r.category === majorCategory && r.buyerAccountName)
            .map((r) => r.buyerAccountName as string)
        )
      );

      const vendorsInCategory = buyerVendors.filter((v) => v.majorCategory === majorCategory);
      const featuredVendors = [...vendorsInCategory]
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, 4)
        .map((v) => v.name);

      return {
        majorCategory,
        minorCount: cat.minorCategories.length,
        rfqsCount,
        quotesReceived,
        activeBuyers,
        availableVendorsCount: vendorsInCategory.length,
        featuredVendors,
        growthPercentage,
        demandStatus: demandStatusFor(rfqsCount['30d']),
      };
    });
  }, [rfqs, buyerVendors, taxonomy]);

  // Real per-minor-category RFQ counts for the expanded drawer — how many
  // RFQs under this major category touched each minor category, derived
  // from each RFQ's own extracted line items rather than a fabricated
  // per-row number.
  const minorCategoryCountsFor = (majorCategory: string): Record<string, number> => {
    const counts: Record<string, number> = {};
    rfqs
      .filter((r) => r.category === majorCategory)
      .forEach((r) => {
        const seenMinors = new Set(r.extractedEntities.map((e) => e.minorCategory).filter(Boolean));
        seenMinors.forEach((m) => {
          counts[m] = (counts[m] || 0) + 1;
        });
      });
    return counts;
  };

  // Calculate totals for chosen timeframe
  const totalRfqsInTimeframe = categoryMetrics.reduce((sum, c) => sum + c.rfqsCount[timeframe], 0);
  const totalQuotesReceivedInTimeframe = categoryMetrics.reduce((sum, c) => sum + c.quotesReceived[timeframe], 0);
  const totalAvailableVendors = categoryMetrics.reduce((sum, c) => sum + c.availableVendorsCount, 0);
  const overallGrowth = growthPercentFor(rfqs, TIMEFRAME_DAYS[timeframe]);

  const buyersWithAnyRfq = buyerAccounts.filter((a) => rfqs.some((r) => r.buyerAccountId === a.id)).length;
  const activeBuyerPercent = buyerAccounts.length > 0 ? Math.round((buyersWithAnyRfq / buyerAccounts.length) * 100) : 0;

  const avgVendorRating =
    buyerVendors.length > 0
      ? (buyerVendors.reduce((sum, v) => sum + (v.rating || 0), 0) / buyerVendors.length).toFixed(1)
      : '—';

  const totalMinorCategories = taxonomy.reduce((sum, c) => sum + c.minorCategories.length, 0);

  // Filter Categories
  const filteredMetrics = categoryMetrics.filter((c) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesMajor = c.majorCategory.toLowerCase().includes(term);
    const catDetail = taxonomy.find((cd) => cd.majorCategory === c.majorCategory);
    const matchesMinor = catDetail?.minorCategories.some((m) => m.toLowerCase().includes(term));
    const matchesBuyer = c.activeBuyers.some((b) => b.toLowerCase().includes(term));
    const matchesVendor = c.featuredVendors.some((v) => v.toLowerCase().includes(term));
    return matchesMajor || matchesMinor || matchesBuyer || matchesVendor;
  });

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Timeframe Selector Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="text-indigo-600 dark:text-indigo-400" /> Category Governance &amp; Demand-Supply Analytics
          </h1>
        </div>

        {/* Timeframe Filter Bar */}
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-gray-900 p-1.5 rounded-2xl border border-slate-200 dark:border-gray-800 shadow-xs">
          {(['7d', '30d', '90d', '180d', '1y'] as TimeframeOption[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all ${
                timeframe === tf
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-800'
              }`}
            >
              {tf === '7d' ? '7 Days' : tf === '30d' ? '30 Days' : tf === '90d' ? '90 Days' : tf === '180d' ? '180 Days' : '1 Year'}
            </button>
          ))}
        </div>
      </div>

      {/* Top Analytics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Active Categories</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-slate-900 dark:text-white mono">{taxonomy.length} Major</span>
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">{totalMinorCategories} Minor</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">RFQs Raised ({timeframe.toUpperCase()})</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-slate-900 dark:text-white mono">{totalRfqsInTimeframe} RFQs</span>
            <GrowthBadge value={overallGrowth} />
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Quotes Received</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-sky-600 dark:text-cyan-400 mono">{totalQuotesReceivedInTimeframe} Quotes</span>
            <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-bold">
              {totalRfqsInTimeframe > 0 ? (totalQuotesReceivedInTimeframe / totalRfqsInTimeframe).toFixed(1) : '0.0'} / RFQ
            </span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Active Buyers</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-purple-600 dark:text-purple-400 mono">{buyerAccounts.length} Buyers</span>
            <span className="text-[10px] text-purple-600 dark:text-purple-300 font-bold">{activeBuyerPercent}% Active</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between col-span-2 sm:col-span-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Available Vendors</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 mono">{totalAvailableVendors} Suppliers</span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">★ {avgVendorRating} Avg</span>
          </div>
        </div>
      </div>

      {/* Category Demand vs Supply Density Table Container */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-4">
        {/* Table Header & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <BarChart3 className="text-indigo-600 dark:text-indigo-400" size={18} /> Category Demand-Supply &amp; Trend Breakdown
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Showing trends for <strong className="text-indigo-600 dark:text-indigo-300">{TIMEFRAME_LABELS[timeframe]}</strong> across all active buyer organizations and available vendor capacity.
            </p>
          </div>

          {/* Search Filter */}
          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search category, buyer, or vendor..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Detailed Breakdown Matrix Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                <th className="p-3">Category Name &amp; Scope</th>
                <th className="p-3 text-center">RFQs Raised ({timeframe.toUpperCase()})</th>
                <th className="p-3 text-center">Quotes Received</th>
                <th className="p-3 text-center">Trend &amp; Growth</th>
                <th className="p-3">Active Enterprise Buyers</th>
                <th className="p-3 text-center">Available Vendors</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800/80">
              {filteredMetrics.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 dark:text-gray-500">
                    {taxonomy.length === 0
                      ? categoryTaxonomyError || UI_STRINGS.buyerProfile.taxonomyEmpty
                      : 'No categories match this search.'}
                  </td>
                </tr>
              )}
              {filteredMetrics.map((item) => {
                const catDetail = taxonomy.find((cd) => cd.majorCategory === item.majorCategory);
                const isExpanded = expandedMajor[item.majorCategory] || false;
                const rfqsInTf = item.rfqsCount[timeframe];
                const quotesInTf = item.quotesReceived[timeframe];
                const growthInTf = item.growthPercentage[timeframe];
                const minorCounts = isExpanded ? minorCategoryCountsFor(item.majorCategory) : {};

                return (
                  <React.Fragment key={item.majorCategory}>
                    <tr className="hover:bg-slate-50/80 dark:hover:bg-gray-900/60 transition-colors">
                      {/* Major Category */}
                      <td className="p-3 font-semibold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.majorCategory} minor categories`}
                            onClick={() =>
                              setExpandedMajor((prev) => ({ ...prev, [item.majorCategory]: !prev[item.majorCategory] }))
                            }
                            className="p-1 rounded text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300"
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white text-xs">
                              {item.majorCategory}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono">
                                {item.minorCount} Minor Categories
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold ${
                                  item.demandStatus === 'High Demand'
                                    ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                                    : item.demandStatus === 'Optimal'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                    : item.demandStatus === 'No Activity'
                                    ? 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-700'
                                    : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                                }`}
                              >
                                {item.demandStatus}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* RFQs Raised */}
                      <td className="p-3 text-center font-extrabold text-slate-900 dark:text-white mono text-sm">
                        {rfqsInTf} RFQs
                      </td>

                      {/* Quotes Received */}
                      <td className="p-3 text-center">
                        <span className="font-extrabold text-sky-600 dark:text-cyan-400 mono text-sm">
                          {quotesInTf} Quotes
                        </span>
                        <span className="block text-[10px] text-slate-400 dark:text-gray-500 font-mono">
                          {(quotesInTf / (rfqsInTf || 1)).toFixed(1)} / RFQ
                        </span>
                      </td>

                      {/* Trend & Growth */}
                      <td className="p-3 text-center">
                        <GrowthBadge value={growthInTf} />
                        <span className="block text-[9px] text-slate-400 dark:text-gray-500">
                          vs previous {timeframe}
                        </span>
                      </td>

                      {/* Active Buyers */}
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {item.activeBuyers.length === 0 && (
                            <span className="text-[10px] text-slate-400 dark:text-gray-500 italic">No buyer activity yet</span>
                          )}
                          {item.activeBuyers.map((b, bIdx) => (
                            <span
                              key={bIdx}
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700"
                            >
                              <CompanyHoverTooltip name={b} type="buyer" />
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Available Vendors */}
                      <td className="p-3 text-center">
                        <span className="font-extrabold text-emerald-600 dark:text-emerald-400 mono text-sm">
                          {item.availableVendorsCount} Vendors
                        </span>
                        <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
                          {item.featuredVendors.slice(0, 2).map((v, vIdx) => (
                            <CompanyHoverTooltip key={vIdx} name={v} type="vendor" className="text-[10px] text-slate-500 dark:text-gray-400" />
                          ))}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="p-3 text-right">
                        <button
                          onClick={() => {
                            addAuditLog(`Category Manager inspected deep analytics for ${item.majorCategory}`);
                            showToast('Category Telemetry', `Inspecting scope analytics for ${item.majorCategory}`, 'info');
                          }}
                          className="btn btn-secondary btn-sm text-[10px] font-semibold"
                        >
                          Details
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Minor Categories Drawer */}
                    {isExpanded && catDetail && (
                      <tr className="bg-indigo-50/20 dark:bg-indigo-950/20 border-b border-indigo-100 dark:border-indigo-900/30">
                        <td colSpan={7} className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                              Minor Categories in {item.majorCategory} ({catDetail.minorCategories.length})
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-gray-400">
                              RFQ counts reflect all-time activity, not the selected timeframe
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
                            {catDetail.minorCategories.map((minor, mIdx) => (
                              <div
                                key={mIdx}
                                className="p-1.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-[10px] font-medium text-slate-700 dark:text-gray-300 flex items-center justify-between"
                              >
                                <span className="truncate" title={minor}>{minor}</span>
                                <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 mono">
                                  {minorCounts[minor] || 0} RFQs
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
