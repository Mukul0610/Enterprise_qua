'use client';

import React, { useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQFollowUpDeepDiveModal } from '@/app/components/Modals';
import { SOURCING_MODES, formatCurrency, formatIndianDate } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQItem, RFQPortfolioSummary, RFQSource, SourcingMode } from '@/lib/types';
import {
  ClipboardList,
  Search,
  Mail,
  UploadCloud,
  Pencil,
  Layers,
  Users,
  Wallet,
  Clock,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  Eye,
  FileText,
  Trash2,
  Sparkles,
} from 'lucide-react';

const SCREEN = UI_STRINGS.screens.rfqSummary;
const RFQ = UI_STRINGS.rfqSummary;
const EDIT = UI_STRINGS.rfqEdit;

/** Page sizes offered by the portfolio table. */
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

/** Sentinel meaning "no filter applied" for the dropdown filters. */
const ALL = 'all';

export interface RFQSummaryProps {
  /** Open an RFQ in the comparative quote matrix. */
  onViewQuotes: (rfq: RFQItem) => void;
  /** Start a new RFQ in the ingestion wizard. */
  onCreateRFQ: () => void;
  /** Open the full submitted detail for one RFQ. */
  onViewDetails: (rfq: RFQItem) => void;
}

/**
 * Screen 1.3 — Buyer RFQ Portfolio Summary.
 *
 * The old Angular buyer console split this across a KPI strip and a paginated
 * "Active Procurement Pipeline" list. This screen keeps that shape but derives
 * every figure from the same `rfqs` collection the table renders, so the headline
 * numbers can never drift from the rows beneath them.
 */
export default function RFQSummary({ onViewQuotes, onCreateRFQ, onViewDetails }: RFQSummaryProps) {
  const {
    rfqs: allRfqs,
    showToast,
    setSelectedRFQForMatrix,
    openRFQDeepDive,
    // The deep-dive modal is driven by store state, so a screen that offers the
    // Follow-ups action has to render it too. Without this the button set the
    // state and nothing appeared.
    deepDiveModalOpen,
    setDeepDiveModalOpen,
    selectedRFQForDeepDive,
  } = useApp();

  // GET /api/rfqs is itself scoped to the signed-in buyer's own account now
  // (server-side — see command-center.tsx's matching note), so allRfqs is
  // already exactly this buyer's own list. No local re-filter needed.
  const rfqs = allRfqs;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [modeFilter, setModeFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  /**
   * Portfolio roll-up computed client-side from the hydrated RFQ list. It mirrors
   * the shape of GET /api/rfqs/summary field for field, so the screen stays
   * correct whether the figures come from the store or the API.
   */
  const summary: RFQPortfolioSummary = useMemo(() => {
    const countBy = (keyFor: (rfq: RFQItem) => string | undefined) =>
      rfqs.reduce<Record<string, number>>((acc, rfq) => {
        const key = keyFor(rfq);
        if (!key) return acc;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

    const sumChannel = (pick: (rfq: RFQItem) => number | undefined) =>
      rfqs.reduce((total, rfq) => total + (pick(rfq) || 0), 0);

    const totalQuotes = rfqs.reduce((total, rfq) => total + (rfq.quotesCount || 0), 0);

    return {
      totalRFQs: rfqs.length,
      activeRFQs: rfqs.filter((r) => r.chasingActive).length,
      awaitingQuotes: rfqs.filter((r) => (r.quotesCount || 0) === 0).length,
      totalQuotesReceived: totalQuotes,
      totalBudget: rfqs.reduce((total, rfq) => total + (rfq.budget || 0), 0),
      averageQuotesPerRFQ: rfqs.length === 0 ? 0 : Math.round((totalQuotes / rfqs.length) * 10) / 10,
      byStatus: countBy((r) => r.status),
      bySourcingMode: countBy((r) => r.sourcingMode),
      bySource: countBy((r) => r.source),
      followUps: {
        vendorsInvited: sumChannel((r) => r.followUpData?.totalInvited),
        vendorsResponded: sumChannel((r) => r.followUpData?.respondedCount),
        calls: sumChannel((r) => r.followUpData?.callStats?.total),
        callsConnected: sumChannel((r) => r.followUpData?.callStats?.connected),
        whatsapp: sumChannel((r) => r.followUpData?.whatsappStats?.total),
        whatsappRead: sumChannel((r) => r.followUpData?.whatsappStats?.read),
        sms: sumChannel((r) => r.followUpData?.smsStats?.total),
      },
    };
  }, [rfqs]);

  /** Distinct statuses actually present, so the filter never offers a dead option. */
  const availableStatuses = useMemo(() => Object.keys(summary.byStatus).sort(), [summary.byStatus]);

  /**
   * Intake source filter options are defined statically so the buyer always
   * sees every possible source — including AI RFQ Create — even when no RFQs
   * created through that channel exist yet. The order is canonical:
   * AI RFQ Create → Email Gateway → Manual Entry.
   */
  const intakeSourceOptions = RFQ.intakeSourceFilterOptions;

  const filteredRFQs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rfqs.filter((rfq) => {
      if (statusFilter !== ALL && rfq.status !== statusFilter) return false;
      if (modeFilter !== ALL && rfq.sourcingMode !== modeFilter) return false;
      // An RFQ raised before intake tracking existed is treated as web portal,
      // matching how the command center buckets legacy rows.
      if (sourceFilter !== ALL && (rfq.source || 'web_portal') !== sourceFilter) return false;
      if (!term) return true;
      // Persisted RFQs can arrive without every optional collection populated,
      // so each field is coerced before matching.
      return (
        (rfq.rfqNumber || '').toLowerCase().includes(term) ||
        (rfq.title || '').toLowerCase().includes(term) ||
        (rfq.category || '').toLowerCase().includes(term) ||
        (rfq.extractedEntities || []).some((e) => (e.itemName || '').toLowerCase().includes(term))
      );
    });
  }, [rfqs, search, statusFilter, modeFilter, sourceFilter]);

  // Clamp the page so removing rows via a filter can never leave a blank page.
  const totalPages = Math.max(1, Math.ceil(filteredRFQs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const visibleRFQs = filteredRFQs.slice(startIndex, startIndex + pageSize);

  const resetToFirstPage = () => setPage(1);

  const handleViewQuotes = (rfq: RFQItem) => {
    if ((rfq.quotesCount || 0) === 0) {
      showToast(RFQ.noQuotesYetTitle, formatString(RFQ.noQuotesYetMessage, { rfqNumber: rfq.rfqNumber }), 'info');
      return;
    }
    setSelectedRFQForMatrix(rfq);
    onViewQuotes(rfq);
  };

  const statusBadge = (status: RFQItem['status']) => {
    const toneByStatus: Record<string, string> = {
      'AI Recommended': 'badge-emerald',
      'In Evaluation': 'badge-blue',
      'PO Generated': 'badge-purple',
      'Quotes Received': 'badge-blue',
      Parsing: 'badge-amber',
      'Quotes Pending': 'badge-amber',
      Closed: 'badge-neutral',
      Expired: 'badge-rose',
    };
    return <span className={`badge ${toneByStatus[status] || 'badge-blue'}`}>{status}</span>;
  };

  const modeBadge = (modeId: SourcingMode) => {
    const mode = SOURCING_MODES.find((m) => m.id === modeId);
    if (!mode) return null;
    // badgeColor is a Tailwind class string, so it is applied as a class. Feeding
    // it to style={{ backgroundColor }} produced invalid CSS that the browser
    // dropped, leaving the mode badge unstyled.
    return (
      <span className={`px-2 py-0.5 rounded border text-[10px] font-bold tracking-wide ${mode.badgeColor}`}>
        {mode.code}
      </span>
    );
  };

  const sourceBadge = (source?: RFQSource) => {
    const meta: Record<string, { icon: React.ReactNode; label: string; tone: string }> = {
      email_gateway: {
        icon: <Mail size={10} />,
        label: RFQ.sourceEmailGateway,
        tone: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      },
      email_upload: {
        icon: <UploadCloud size={10} />,
        label: RFQ.sourceEmailUpload,
        tone: 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
      },
      manual_entry: {
        icon: <Pencil size={10} />,
        label: RFQ.sourceManualEntry,
        tone: 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800',
      },
      ai_extraction: {
        icon: <Sparkles size={10} />,
        label: RFQ.sourceAiExtraction || 'AI Extraction',
        tone: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      },
    };
    const resolved = meta[source || ''] || {
      icon: <UploadCloud size={10} />,
      label: RFQ.sourceWebPortal,
      tone: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    };
    return (
      <span
        className={`px-2 py-0.5 rounded-md text-[9px] font-bold border flex items-center gap-1 shrink-0 w-fit ${resolved.tone}`}
      >
        {resolved.icon}
        <span>{resolved.label}</span>
      </span>
    );
  };

  const kpiCards = [
    {
      key: 'total',
      label: RFQ.kpiTotalRFQs,
      value: String(summary.totalRFQs),
      hint: formatString(RFQ.kpiTotalRFQsHint, { activeCount: summary.activeRFQs }),
      icon: <ClipboardList size={16} />,
      tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-600/20',
    },
    {
      key: 'awaiting',
      label: RFQ.kpiAwaitingQuotes,
      value: String(summary.awaitingQuotes),
      hint: formatString(RFQ.kpiAwaitingQuotesHint, { quoteCount: summary.totalQuotesReceived }),
      icon: <Clock size={16} />,
      tone: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-600/20',
    },
    {
      key: 'budget',
      label: RFQ.kpiPortfolioValue,
      value: formatCurrency(summary.totalBudget),
      hint: formatString(RFQ.kpiPortfolioValueHint, { average: summary.averageQuotesPerRFQ }),
      icon: <Wallet size={16} />,
      tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-600/20',
    },
    {
      key: 'vendors',
      label: RFQ.kpiVendorsEngaged,
      value: String(summary.followUps.vendorsInvited),
      hint: formatString(RFQ.kpiVendorsEngagedHint, { responded: summary.followUps.vendorsResponded }),
      icon: <Users size={16} />,
      tone: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-600/20',
    },
  ];

  return (
    <div className="space-y-2.5 animate-fade-in pb-4">
      {/* ── Top Action Bar ── */}
      <div className="flex items-center justify-end">
        <button onClick={onCreateRFQ} className="btn btn-primary btn-sm font-bold flex items-center gap-1.5 shrink-0 shadow-sm">
          <Plus size={14} /> {RFQ.createRFQAction}
        </button>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {kpiCards.map((card) => (
          <div
            key={card.key}
            className="glass-panel p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">{card.label}</span>
              <div className={`p-1.5 rounded-lg ${card.tone}`}>{card.icon}</div>
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{card.value}</div>
          </div>
        ))}
      </div>

      {/* ── Sourcing mode distribution ── */}
      <div className="glass-panel p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-2">
        <h2 className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
          <Layers size={14} className="text-indigo-600 dark:text-indigo-400" />
          {RFQ.modeDistributionTitle}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5 text-xs">
          {SOURCING_MODES.map((mode) => {
            const count = summary.bySourcingMode[mode.id] || 0;
            const share = summary.totalRFQs === 0 ? 0 : Math.round((count / summary.totalRFQs) * 100);
            return (
              <div
                key={mode.id}
                className="p-2 sm:p-2.5 rounded-lg bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-1 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  {modeBadge(mode.id)}
                  <span className="mono font-bold text-slate-800 dark:text-white">{count}</span>
                </div>
                <div
                  className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden"
                  role="progressbar"
                  aria-label={`${mode.code}: ${share}%`}
                  aria-valuenow={share}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-full bg-indigo-600" style={{ width: `${share}%` }} />
                </div>
                <span className="text-[10px] text-slate-400">
                  {share}% of portfolio
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="glass-panel p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-2.5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-2.5">
          <div className="flex-1 space-y-1">
            <label htmlFor="rfq-search" className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">
              {RFQ.searchLabel}
            </label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                size={14}
              />
              <input
                id="rfq-search"
                type="search"
                placeholder={RFQ.searchPlaceholder}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetToFirstPage();
                }}
                className="has-leading-icon text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="rfq-status-filter" className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">
              {RFQ.statusFilterLabel}
            </label>
            <select
              id="rfq-status-filter"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                resetToFirstPage();
              }}
              className="text-xs font-semibold"
            >
              <option value={ALL}>{RFQ.allStatuses}</option>
              {availableStatuses.map((status) => (
                <option key={status} value={status}>
                  {status} ({summary.byStatus[status]})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="rfq-mode-filter" className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">
              {RFQ.modeFilterLabel}
            </label>
            <select
              id="rfq-mode-filter"
              value={modeFilter}
              onChange={(e) => {
                setModeFilter(e.target.value);
                resetToFirstPage();
              }}
              className="text-xs font-semibold"
            >
              <option value={ALL}>{RFQ.allModes}</option>
              {SOURCING_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.code} — {mode.shortLabel}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="rfq-source-filter" className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-450">
              {RFQ.sourceFilterLabel}
            </label>
            <select
              id="rfq-source-filter"
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                resetToFirstPage();
              }}
              className="text-xs font-semibold"
            >
              {/* All Sources is always first and resets the filter. */}
              <option value={ALL}>{RFQ.allSources}</option>
              {/* Static options: AI RFQ Create, Email Gateway, Manual Entry.
                  Always rendered so buyers can filter by source even before
                  any RFQs of that type exist in the portfolio. */}
              {intakeSourceOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 dark:text-gray-400">
          {formatString(RFQ.resultCount, { shown: filteredRFQs.length, total: summary.totalRFQs })}
        </div>
      </div>

      {/* ── Portfolio table ── */}
      {rfqs.length === 0 ? (
        <div className="glass-panel p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 text-center space-y-3">
          <ClipboardList size={30} className="mx-auto text-slate-300 dark:text-gray-700" />
          <h2 className="text-sm font-bold text-slate-800 dark:text-white">{RFQ.emptyPortfolioTitle}</h2>
          <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md mx-auto">{RFQ.emptyPortfolioMessage}</p>
          <button onClick={onCreateRFQ} className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5">
            <Plus size={14} /> {RFQ.createRFQAction}
          </button>
        </div>
      ) : (
        <div className="glass-panel rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 overflow-hidden">
          {/* Six columns instead of nine. RFQ number and title were two columns
              describing the same thing, as were items and quotes; folding each
              pair into one cell with a sub-line drops the minimum width from
              1040px to 760px, so the table stops scrolling sideways on a laptop
              and the title has room not to truncate. */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[760px]">
              <caption className="sr-only">{RFQ.tableCaption}</caption>
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-gray-950 text-slate-700 dark:text-gray-300 text-[10px] uppercase tracking-wider font-bold border-b border-slate-200 dark:border-gray-800">
                <tr>
                  <th scope="col" className="px-3 py-2">{RFQ.colRfqNumber}</th>
                  <th scope="col" className="px-3 py-2">{RFQ.colStatus}</th>
                  <th scope="col" className="px-3 py-2 text-center">{RFQ.colItems}</th>
                  <th scope="col" className="px-3 py-2 text-right">{RFQ.colBudget}</th>
                  <th scope="col" className="px-3 py-2">{RFQ.colDelivery}</th>
                  <th scope="col" className="px-3 py-2 text-right">{RFQ.colActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-gray-800 text-slate-800 dark:text-gray-200">
                {visibleRFQs.map((rfq) => (
                  <tr key={rfq.id} className="hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-colors">
                    {/* Number, title and category in one cell: they identify the
                        same record, and the title now has the width not to truncate. */}
                    <td className="px-3 py-2.5 align-top">
                      <span className="mono font-bold text-indigo-700 dark:text-indigo-300">{rfq.rfqNumber}</span>
                      <span className="block font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
                        {rfq.title}
                      </span>
                      <span className="flex items-center gap-1.5 flex-wrap mt-1">
                        {modeBadge(rfq.sourcingMode)}
                        {sourceBadge(rfq.source)}
                        <span className="text-[10px] text-slate-500 dark:text-gray-400">{rfq.category}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {statusBadge(rfq.status)}
                      {rfq.chasingActive && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-1">
                          {RFQ.chasingActive}
                        </span>
                      )}
                    </td>
                    {/* Line items and quotations received, stacked: both count what
                        is on the RFQ, and quotes are only meaningful against items. */}
                    <td className="px-3 py-2.5 align-top text-center whitespace-nowrap">
                      <span className="mono font-bold text-slate-900 dark:text-white tabular-nums">
                        {(rfq.extractedEntities || []).length}
                      </span>
                      <span className="block text-[10px] text-slate-500 dark:text-gray-400">
                        {formatString(RFQ.quotesReceivedLabel, { count: rfq.quotesCount || 0 })}
                      </span>
                    </td>
                    {/* A zero budget means none was stated, so it reads as unset
                        rather than as a real ceiling of nil. */}
                    <td className="px-3 py-2.5 align-top text-right mono font-semibold tabular-nums whitespace-nowrap">
                      {rfq.budget > 0 ? (
                        formatCurrency(rfq.budget)
                      ) : (
                        <span className="text-slate-400 dark:text-gray-500 font-normal">{RFQ.budgetUnset}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top mono tabular-nums whitespace-nowrap">
                      {formatIndianDate(rfq.targetDeliveryDate) || RFQ.deliveryDateUnset}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onViewDetails(rfq)}
                          className="btn btn-secondary btn-xs font-bold flex items-center gap-1"
                          aria-label={formatString(RFQ.viewDetailsAria, { rfqNumber: rfq.rfqNumber })}
                        >
                          <FileText size={11} /> {RFQ.detailsAction}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleViewQuotes(rfq)}
                          className="btn btn-primary btn-xs font-bold flex items-center gap-1"
                          aria-label={formatString(RFQ.viewQuotesAria, { rfqNumber: rfq.rfqNumber })}
                        >
                          {RFQ.quotesAction} <ArrowRight size={11} />
                        </button>
                        {/* Icon-only from here: three labelled buttons per row read
                            as a wall of text, and each carries its own aria-label. */}
                        <button
                          type="button"
                          onClick={() => openRFQDeepDive(rfq)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-slate-100 dark:hover:bg-gray-800"
                          aria-label={formatString(RFQ.viewFollowUpsAria, { rfqNumber: rfq.rfqNumber })}
                          title={RFQ.followUpsAction}
                        >
                          <Eye size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredRFQs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400 dark:text-gray-500">
                      {RFQ.noMatchesMessage}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          {filteredRFQs.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-gray-800 text-xs">
              <div className="flex items-center gap-2">
                <label htmlFor="rfq-page-size" className="text-slate-500 dark:text-gray-400">
                  {RFQ.rowsPerPageLabel}
                </label>
                <select
                  id="rfq-page-size"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    resetToFirstPage();
                  }}
                  className="text-xs font-semibold !py-1 !px-2 w-auto"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-slate-500 dark:text-gray-400 mono">
                  {formatString(RFQ.pageRange, {
                    from: startIndex + 1,
                    to: Math.min(startIndex + pageSize, filteredRFQs.length),
                    total: filteredRFQs.length,
                  })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="btn btn-secondary btn-xs disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label={RFQ.previousPageAria}
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <span className="mono font-bold text-slate-700 dark:text-gray-300 px-1">
                    {formatString(RFQ.pageIndicator, { current: currentPage, total: totalPages })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="btn btn-secondary btn-xs disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label={RFQ.nextPageAria}
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Multi-channel follow-up telemetry for the row the buyer picked. */}
      <RFQFollowUpDeepDiveModal
        isOpen={deepDiveModalOpen}
        onClose={() => setDeepDiveModalOpen(false)}
        rfq={selectedRFQForDeepDive}
      />
    </div>
  );
}
