'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { RFQItem } from '@/lib/types';
import { formatCurrency } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { fetchAllRFQs } from '@/lib/rfqClient';
import { ClipboardList, Search, ChevronRight, RefreshCw, AlertTriangle, FileText, UserPlus } from 'lucide-react';
import InviteVendorsModal from './InviteVendorsModal';

interface AllRFQsConsoleProps {
  /** Open the comparative quote matrix for one RFQ. */
  onNavigateToMatrix?: (rfq: RFQItem) => void;
  /** Open the full read-only detail view for one RFQ. */
  onViewDetails?: (rfq: RFQItem) => void;
}

const S = UI_STRINGS.allRfqs;

/** Every real RFQ status → badge tone. Covers all five members of the union. */
const STATUS_TONE: Record<RFQItem['status'], string> = {
  Parsing: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'Quotes Pending': 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  'In Evaluation': 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  'AI Recommended': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  'PO Generated': 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
};

const ALL_STATUSES: RFQItem['status'][] = [
  'Parsing',
  'Quotes Pending',
  'In Evaluation',
  'AI Recommended',
  'PO Generated',
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
            <ClipboardList size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">{S.title}</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-250 dark:border-slate-800 text-slate-700 dark:text-gray-250"
        >
          <RefreshCw size={13} /> {S.retryAction}
        </button>
      </div>

      {!loading && !error && (
        <p className="text-xs font-bold text-slate-500 dark:text-gray-450" data-testid="all-rfqs-count">
          {formatString(S.countSummary, { count: rfqs.length, buyers: buyerNames.length })}
        </p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <Search size={15} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={S.searchLabel}
            placeholder={S.searchPlaceholder}
            className="input w-full py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-250"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label={S.statusFilterLabel}
          className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
        >
          <option value="all">{S.allStatuses}</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={buyerFilter}
          onChange={(e) => setBuyerFilter(e.target.value)}
          aria-label={S.buyerFilterLabel}
          className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
        >
          <option value="all">{S.allBuyers}</option>
          {buyerNames.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

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
        <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center">{S.noMatches}</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-850 rounded-xl">
          <table className="w-full text-sm">
            <caption className="sr-only">{S.subtitle}</caption>
            <thead>
              <tr className="bg-slate-50 dark:bg-gray-950 text-[10px] uppercase tracking-wider text-slate-500 dark:text-gray-450">
                <th className="text-left font-bold px-4 py-2.5">{S.colRfqNumber}</th>
                <th className="text-left font-bold px-4 py-2.5">{S.colTitle}</th>
                <th className="text-left font-bold px-4 py-2.5">{S.colBuyer}</th>
                <th className="text-left font-bold px-4 py-2.5">{S.colStatus}</th>
                <th className="text-right font-bold px-4 py-2.5">{S.colQuotes}</th>
                <th className="text-right font-bold px-4 py-2.5">{S.colBudget}</th>
                <th className="text-left font-bold px-4 py-2.5">{S.colCreated}</th>
                <th className="text-right font-bold px-4 py-2.5">{S.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
              {filtered.map((rfq) => (
                <tr key={rfq.id} className="hover:bg-slate-50 dark:hover:bg-gray-900/60">
                  <td className="px-4 py-3 font-mono font-bold text-slate-800 dark:text-gray-200">{rfq.rfqNumber}</td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-gray-200">{rfq.title}</div>
                    <div className="text-[11px] text-slate-500 dark:text-gray-450">{rfq.category || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-gray-300">
                    {rfq.buyerAccountName || <span className="italic text-slate-400">{S.buyerUnknown}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_TONE[rfq.status]}`}>
                      {rfq.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-gray-300">{rfq.quotesCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-gray-300">
                    {rfq.budget > 0 ? formatCurrency(rfq.budget) : <span className="text-slate-400">{S.budgetUnset}</span>}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-500 dark:text-gray-450">
                    {rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setInviteTargetRfq(rfq)}
                        aria-label={formatString(S.inviteVendorsAria, { rfqNumber: rfq.rfqNumber })}
                        className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-gray-300 hover:underline"
                      >
                        <UserPlus size={13} /> {S.inviteVendorsAction}
                      </button>
                      <button
                        type="button"
                        onClick={() => onViewDetails?.(rfq)}
                        aria-label={formatString(S.viewDetailsAria, { rfqNumber: rfq.rfqNumber })}
                        className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-gray-300 hover:underline"
                      >
                        <FileText size={13} /> {S.viewDetailsAction}
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateToMatrix?.(rfq)}
                        aria-label={formatString(S.viewMatrixAria, { rfqNumber: rfq.rfqNumber })}
                        className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
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
