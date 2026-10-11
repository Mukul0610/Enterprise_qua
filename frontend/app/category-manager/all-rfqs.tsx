'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { RFQItem } from '@/lib/types';
import { formatCurrency } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { fetchAllRFQs } from '@/lib/rfqClient';
import { ClipboardList, Search, ChevronRight, RefreshCw, AlertTriangle, FileText, UserPlus, X } from 'lucide-react';
import InviteVendorsModal from './InviteVendorsModal';

interface AllRFQsConsoleProps {
  /** Open the comparative quote matrix for one RFQ. */
  onNavigateToMatrix?: (rfq: RFQItem) => void;
  /** Open the full read-only detail view for one RFQ. */
  onViewDetails?: (rfq: RFQItem) => void;
}

const S = UI_STRINGS.allRfqs;

/** Every real RFQ status → badge tone. Covers all members of the union. */
const STATUS_TONE: Record<RFQItem['status'], string> = {
  Parsing: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'Quotes Pending': 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  'Quotes Received': 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
  'In Evaluation': 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  'AI Recommended': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  'PO Generated': 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
  Closed: 'bg-slate-200 text-slate-800 dark:bg-gray-800 dark:text-slate-300',
  Expired: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
};

const ALL_STATUSES: RFQItem['status'][] = [
  'Parsing',
  'Quotes Pending',
  'Quotes Received',
  'In Evaluation',
  'AI Recommended',
  'PO Generated',
  'Closed',
  'Expired',
];

/**
 * Category-manager "All RFQs" console.
 *
 * Reads `GET /api/rfqs/all` — the full cross-buyer list, which the server
 * gates to the category_manager/admin roles. Deliberately does not use the
 * store's `rfqs`: that list is loaded through the buyer-scoped endpoint and a
 * category manager who also holds a buyer account would see only their own.
 */
export default function AllRFQsConsole({ onNavigateToMatrix, onViewDetails }: AllRFQsConsoleProps) {
  const [rfqs, setRfqs] = useState<RFQItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [buyerFilter, setBuyerFilter] = useState<string>('all');
  const [inviteTargetRfq, setInviteTargetRfq] = useState<RFQItem | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await fetchAllRFQs();
    if (result.success) {
      setRfqs(result.rfqs);
    } else {
      setError(result.error || S.loadFailed);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const buyerNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of rfqs) {
      if (r.buyerAccountName) names.add(r.buyerAccountName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rfqs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rfqs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (buyerFilter !== 'all' && (r.buyerAccountName || '') !== buyerFilter) return false;
      if (!q) return true;
      return (
        r.rfqNumber.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q) ||
        (r.buyerAccountName || '').toLowerCase().includes(q)
      );
    });
  }, [rfqs, search, statusFilter, buyerFilter]);
  const hasFilters = search.trim().length > 0 || statusFilter !== 'all' || buyerFilter !== 'all';

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setBuyerFilter('all');
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
            <ClipboardList size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">{S.title}</h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-gray-450">{S.subtitle}</p>
            {!loading && !error && (
              <p className="mt-1.5 text-xs font-bold text-slate-500 dark:text-gray-450" data-testid="all-rfqs-count">
                {formatString(S.countSummary, { count: rfqs.length, buyers: buyerNames.length })}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-ghost flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:cursor-wait disabled:opacity-60 dark:border-slate-800 dark:text-gray-250"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {S.retryAction}
        </button>
      </div>

      <section
        aria-label={S.filtersLabel}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-gray-950/50 sm:p-5"
      >
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(180px,220px)_minmax(180px,240px)_auto]">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <label htmlFor="all-rfqs-search" className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-gray-300">
              {S.searchLabel}
            </label>
            <div className="relative">
              <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="all-rfqs-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={S.searchLabel}
                placeholder={S.searchPlaceholder}
                className={`input has-leading-icon h-11 w-full rounded-xl border-slate-200 bg-slate-50 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white dark:border-slate-800 dark:bg-gray-950 dark:text-gray-200 dark:focus:bg-gray-900 ${search ? 'has-trailing-icon' : ''}`}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label={S.clearSearch}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800 dark:hover:text-gray-200"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <label htmlFor="all-rfqs-status" className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-gray-300">
              {S.statusFilterLabel}
            </label>
            <select
              id="all-rfqs-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label={S.statusFilterLabel}
              className="select h-11 w-full rounded-xl border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:bg-gray-950 dark:text-gray-200"
            >
              <option value="all">{S.allStatuses}</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="all-rfqs-buyer" className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-gray-300">
              {S.buyerFilterLabel}
            </label>
            <select
              id="all-rfqs-buyer"
              value={buyerFilter}
              onChange={(e) => setBuyerFilter(e.target.value)}
              aria-label={S.buyerFilterLabel}
              className="select h-11 w-full rounded-xl border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:bg-gray-950 dark:text-gray-200"
            >
              <option value="all">{S.allBuyers}</option>
              {buyerNames.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-800 dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-white"
            >
              <X size={14} />
              {S.clearFilters}
            </button>
          )}
        </div>
        {!loading && !error && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <p aria-live="polite" className="text-xs font-medium text-slate-500 dark:text-gray-400">
              {formatString(S.resultCount, { shown: filtered.length, total: rfqs.length })}
            </p>
            {hasFilters && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                {S.filtersApplied}
              </span>
            )}
          </div>
        )}
      </section>

      {loading && <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center">{S.loading}</p>}

      {!loading && error && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle size={28} className="text-rose-500" />
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="btn-primary text-xs font-bold px-4 py-1.5 rounded-lg bg-indigo-600 text-white"
          >
            {S.retryAction}
          </button>
        </div>
      )}

      {!loading && !error && rfqs.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center">{S.empty}</p>
      )}

      {!loading && !error && rfqs.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
          <Search size={24} aria-hidden="true" className="text-slate-400" />
          <p className="text-sm text-slate-500 dark:text-gray-450">{S.noMatches}</p>
          <button type="button" onClick={clearFilters} className="text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">
            {S.clearFilters}
          </button>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-850 dark:bg-gray-950/40">
          <table className="w-full min-w-[1240px] table-fixed text-sm">
            <caption className="sr-only">{S.subtitle}</caption>
            <colgroup>
              <col className="w-[155px]" />
              <col className="w-[230px]" />
              <col className="w-[165px]" />
              <col className="w-[145px]" />
              <col className="w-[80px]" />
              <col className="w-[130px]" />
              <col className="w-[105px]" />
              <col className="w-[300px]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-50 dark:bg-gray-950 text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-450">
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colRfqNumber}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colTitle}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colBuyer}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colStatus}</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">{S.colQuotes}</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">{S.colBudget}</th>
                <th scope="col" className="px-3 py-3 text-left font-bold">{S.colCreated}</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">{S.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
              {filtered.map((rfq) => (
                <tr key={rfq.id} className="align-middle transition-colors hover:bg-slate-50 dark:hover:bg-gray-900/60">
                  <td className="px-3 py-3 font-mono text-xs font-bold text-slate-800 dark:text-gray-200">{rfq.rfqNumber}</td>
                  <td className="px-3 py-3">
                    <div className="truncate font-bold text-slate-800 dark:text-gray-200" title={rfq.title}>{rfq.title}</div>
                    <div className="truncate text-[11px] text-slate-500 dark:text-gray-450" title={rfq.category || undefined}>{rfq.category || '—'}</div>
                  </td>
                  <td className="break-words px-3 py-3 text-slate-700 dark:text-gray-300">
                    {rfq.buyerAccountName || <span className="italic text-slate-400">{S.buyerUnknown}</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold ${STATUS_TONE[rfq.status]}`}>
                      {rfq.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700 dark:text-gray-300">{rfq.quotesCount}</td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-slate-700 dark:text-gray-300">
                    {rfq.budget > 0 ? formatCurrency(rfq.budget) : <span className="text-slate-400">{S.budgetUnset}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[11px] text-slate-500 dark:text-gray-450">
                    {rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-nowrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setInviteTargetRfq(rfq)}
                        aria-label={formatString(S.inviteVendorsAria, { rfqNumber: rfq.rfqNumber })}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold text-slate-600 hover:underline dark:text-gray-300"
                      >
                        <UserPlus size={13} /> {S.inviteVendorsAction}
                      </button>
                      <button
                        type="button"
                        onClick={() => onViewDetails?.(rfq)}
                        aria-label={formatString(S.viewDetailsAria, { rfqNumber: rfq.rfqNumber })}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold text-slate-600 hover:underline dark:text-gray-300"
                      >
                        <FileText size={13} /> {S.viewDetailsAction}
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateToMatrix?.(rfq)}
                        aria-label={formatString(S.viewMatrixAria, { rfqNumber: rfq.rfqNumber })}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {S.viewMatrixAction} <ChevronRight size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InviteVendorsModal
        isOpen={inviteTargetRfq !== null}
        rfq={inviteTargetRfq}
        onClose={() => setInviteTargetRfq(null)}
        onInvited={(updatedRfq) => {
          setRfqs((prev) => prev.map((r) => (r.id === updatedRfq.id ? updatedRfq : r)));
        }}
      />
    </div>
  );
}
