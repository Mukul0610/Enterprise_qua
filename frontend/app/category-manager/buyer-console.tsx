'use client';

import React, { useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem } from '@/lib/types';
import { SOURCING_MODES, formatCurrency } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  Building2,
  Users,
  Search,
  ChevronRight,
  Clock,
  IndianRupee,
  Layers,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';

interface BuyerConsoleProps {
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onNavigateToEvaluation: () => void;
}

// Deterministic decorative avatar color, not a claim about the buyer — picked
// from the org name so the same account always renders the same color
// without needing a color stored anywhere.
const AVATAR_PALETTE = [
  { bg: 'bg-indigo-600 text-white', avatar: 'bg-indigo-100 text-indigo-800' },
  { bg: 'bg-orange-500 text-white', avatar: 'bg-orange-100 text-orange-800' },
  { bg: 'bg-purple-500 text-white', avatar: 'bg-purple-100 text-purple-800' },
  { bg: 'bg-cyan-500 text-white', avatar: 'bg-cyan-100 text-cyan-800' },
  { bg: 'bg-emerald-600 text-white', avatar: 'bg-emerald-100 text-emerald-800' },
  { bg: 'bg-rose-600 text-white', avatar: 'bg-rose-100 text-rose-800' },
];
function avatarStyleFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export default function BuyerConsole({ onNavigateToMatrix, onNavigateToEvaluation }: BuyerConsoleProps) {
  const { rfqs, buyerAccounts } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null);
  const [expandedRfqNumber, setExpandedRfqNumber] = useState<string | null>(null);
  // Tracks an explicit user collapse ("Hide Details") so dropdown-driven
  // expansion cannot silently re-open a panel the user just dismissed.
  const [drillDownDismissed, setDrillDownDismissed] = useState(false);

  // Dropdown context filter states
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedBuyerFilterId, setSelectedBuyerFilterId] = useState<string>('all');

  // Was a hardcoded list of 4 fake buyer profiles, matched to RFQs via
  // hand-picked RFQ-number lists (with a "default assign anything unmatched
  // to Rajesh Nair" catch-all). RFQs now carry a real buyerAccountId, stamped
  // server-side when the RFQ is created, so every metric below is derived
  // from the real buyer directory and the real RFQs each account created.
  const compiledBuyers = useMemo(() => {
    return buyerAccounts.map((account) => {
      const rfqsList = rfqs.filter((r) =>
        (r.buyerAccountId && r.buyerAccountId === account.id) ||
        (r.raisedByEmail && account.corporateEmail && r.raisedByEmail.toLowerCase() === account.corporateEmail.toLowerCase()) ||
        (r.buyerAccountName && account.organizationName && r.buyerAccountName.toLowerCase() === account.organizationName.toLowerCase())
      );
      const totalSpend = rfqsList.reduce((sum, r) => sum + (r.budget || 0), 0);
      const activeCount = rfqsList.filter((r) => r.status !== 'PO Generated').length;
      const totalQuotes = rfqsList.reduce((sum, r) => sum + (r.quotesCount || 0), 0);
      const avgQuotesPerRfq = rfqsList.length > 0 ? Math.round((totalQuotes / rfqsList.length) * 10) / 10 : null;

      const displayName = account.contactPerson || 'Unnamed Contact';
      const displayCompany = account.organizationName || 'Unnamed Organization';
      const style = avatarStyleFor(displayCompany);

      return {
        id: account.id,
        name: displayName,
        email: account.corporateEmail,
        company: displayCompany,
        logoLetter: displayCompany.charAt(0).toUpperCase(),
        logoBg: style.bg,
        avatarColor: style.avatar,
        preferredMode: account.sourcingMode,
        avgQuotesPerRfq,
        rfqsList,
        totalSpend,
        activeCount,
      };
    });
  }, [buyerAccounts, rfqs]);

  // Filter buyers based on dropdown context selection
  const filteredByDropdownBuyers = compiledBuyers.filter((b) => {
    const matchCompany = selectedCompany === 'all' || b.company === selectedCompany;
    const matchBuyer = selectedBuyerFilterId === 'all' || b.id === selectedBuyerFilterId;
    return matchCompany && matchBuyer;
  });

  // Filter buyers based on search term (name, company)
  const filteredBuyers = filteredByDropdownBuyers.filter(
    (b) =>
      b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.company.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Overall Analytics computations based on dropdown filter scope
  const grandTotalSpend = filteredByDropdownBuyers.reduce((sum, b) => sum + b.totalSpend, 0);
  const totalRfqCount = filteredByDropdownBuyers.reduce((sum, b) => sum + b.rfqsList.length, 0);

  const buyersWithQuotes = filteredByDropdownBuyers.filter(
    (b): b is typeof b & { avgQuotesPerRfq: number } => b.avgQuotesPerRfq !== null
  );
  const avgQuotesAcrossBuyers =
    buyersWithQuotes.length > 0
      ? (buyersWithQuotes.reduce((sum, b) => sum + b.avgQuotesPerRfq, 0) / buyersWithQuotes.length).toFixed(1)
      : '—';

  // Dynamic context drill down precedence:
  //  1. An explicit "Hide Details" collapse always wins and keeps the panel closed,
  //     even if the dropdown selection changes afterwards. Clicking a card's
  //     expand action clears the dismissal.
  //  2. Otherwise a specific dropdown selection drives the expansion.
  //  3. Otherwise fall back to the manually expanded card.
  const dropdownDrivenBuyerId = selectedBuyerFilterId !== 'all' ? selectedBuyerFilterId : null;
  const activeBuyerId = drillDownDismissed ? null : dropdownDrivenBuyerId ?? selectedBuyerId;
  const selectedBuyer = compiledBuyers.find((b) => b.id === activeBuyerId);

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            Buyer Wise Command Console & Analytics
          </h1>
        </div>
      </div>

      {/* Dynamic Sourcing Selector Bar */}
      <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/60 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-gray-300">
          <Building2 size={16} className="text-indigo-500" />
          <span>Active Context Selection:</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto text-xs">
          {/* Company Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Company</label>
            <select
              value={selectedCompany}
              onChange={(e) => {
                setSelectedCompany(e.target.value);
                setSelectedBuyerFilterId('all'); // Reset buyer on company change
              }}
              className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
            >
              <option value="all">🌐 All Companies</option>
              {Array.from(new Set(compiledBuyers.map((b) => b.company))).map((company) => (
                <option key={company} value={company}>
                  🏢 {company}
                </option>
              ))}
            </select>
          </div>

          {/* Dependent Buyer Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase font-bold text-slate-450 dark:text-gray-500">Buyer</label>
            <select
              value={selectedBuyerFilterId}
              onChange={(e) => setSelectedBuyerFilterId(e.target.value)}
              className="select py-1.5 px-3 text-xs bg-slate-50 dark:bg-gray-950 border border-slate-250 rounded-lg text-slate-800 dark:text-gray-250 font-bold"
              disabled={selectedCompany === 'all'}
            >
              {selectedCompany === 'all' ? (
                <option value="all">👥 Select Company First</option>
              ) : (
                <>
                  <option value="all">👥 All Buyers in Company</option>
                  {compiledBuyers.filter((b) => b.company === selectedCompany).map((b) => (
                    <option key={b.id} value={b.id}>
                      👤 {b.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BUYER WISE & BUYER COMPANY WISE ANALYTICS SECTION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Analytics Left Pane: Key Aggregated SLA & Volume Metrics */}
        <div className="lg:col-span-1 space-y-4">
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">Total Active Spend Sourced</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{formatCurrency(grandTotalSpend)}</p>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-650 dark:text-indigo-400 shrink-0">
              <IndianRupee size={20} />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Total Sourcing Volume</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{totalRfqCount} RFQs Live</p>
            </div>
            <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
              <Layers size={20} />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-500 dark:text-gray-450 uppercase tracking-wider">Avg Quotes Per RFQ</div>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">{avgQuotesAcrossBuyers}</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
              <Clock size={20} />
            </div>
          </div>
        </div>

        {/* Analytics Right Pane: Company Wise Spend & Volume Breakdowns */}
        <div className="lg:col-span-2 glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm space-y-4">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-100 dark:border-gray-800 pb-2 flex items-center justify-between">
            <span>Buyer Company Wise Spend & RFQ Volume Distribution</span>
            <span className="text-[10px] text-slate-400 lowercase normal-case">Live Category Distribution</span>
          </h3>

          <div className="space-y-3.5">
            {compiledBuyers.length === 0 && (
              <p className="text-[11px] text-slate-400 dark:text-gray-500 py-4 text-center">No buyer accounts found.</p>
            )}
            {compiledBuyers.map((b) => {
              const spendPercentage = grandTotalSpend > 0 ? ((b.totalSpend / grandTotalSpend) * 100).toFixed(0) : '0';
              return (
                <div key={b.id} className="text-xs">
                  <div className="flex justify-between items-center text-slate-700 dark:text-gray-300 font-semibold mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-md ${b.logoBg} font-mono font-bold text-[9px] flex items-center justify-center`}>
                        {b.logoLetter}
                      </span>
                      <span>{b.company}</span>
                    </span>
                    <span className="mono font-bold text-slate-900 dark:text-white text-[11px]">
                      {formatCurrency(b.totalSpend)} ({spendPercentage}% · {b.rfqsList.length} RFQs)
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-grow bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div className="bg-indigo-650 h-full rounded-full" style={{ width: `${spendPercentage}%` }} />
                    </div>
                    <span className="text-[9px] mono text-slate-400 dark:text-gray-500 shrink-0">
                      Avg quotes: {b.avgQuotesPerRfq === null ? '—' : b.avgQuotesPerRfq}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BUYER WISE RFQ CONSOLE GRID */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-xs font-bold text-slate-800 dark:text-gray-200 uppercase tracking-wider flex items-center gap-2">
            <Users size={15} className="text-indigo-600 dark:text-indigo-400" />
            Buyer wise Status & Sourcing Summaries ({filteredBuyers.length} Buyers)
          </h3>

          {/* Search Box */}
          <div className="relative max-w-xs">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Search size={13} />
            </span>
            <input
              type="text"
              placeholder="Search Buyer name or company..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-8 py-1.5 text-xs w-full sm:w-64"
            />
          </div>
        </div>

        {/* Buyers List Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredBuyers.map((b) => {
            // Reflect the resolved panel state so the toggle label always matches
            // what is actually on screen, including dropdown-driven expansion.
            const isSelected = activeBuyerId === b.id;
            const preferredModeObj = SOURCING_MODES.find((m) => m.id === b.preferredMode);

            return (
              <div
                key={b.id}
                className={`glass-panel p-5 rounded-2xl border-2 transition-all flex flex-col justify-between space-y-4 ${
                  isSelected
                    ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 shadow-md'
                    : 'border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 bg-white dark:bg-gray-900/80 shadow-sm'
                }`}
              >
                {/* Upper Block: Buyer Profile & Company */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full ${b.avatarColor} font-bold text-xs flex items-center justify-center`}>
                      {b.name.split(' ').map((n) => n[0]).join('')}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs">{b.name}</h4>
                      <p className="text-[10px] text-slate-400 dark:text-gray-500">{b.email}</p>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className={`w-4 h-4 rounded ${b.logoBg} font-mono font-bold text-[8px] flex items-center justify-center shrink-0`}>
                          {b.logoLetter}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-700 dark:text-gray-300">
                          <CompanyHoverTooltip
                            name={b.company}
                            type="buyer"
                            contact={{ contactPerson: b.name, email: b.email }}
                          />
                        </span>
                      </div>
                    </div>
                  </div>

                  {preferredModeObj && (
                    <span
                      className="px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wider shrink-0"
                      style={{
                        backgroundColor: `${preferredModeObj.badgeColor}15`,
                        color: preferredModeObj.badgeColor,
                        border: `1px solid ${preferredModeObj.badgeColor}35`,
                      }}
                    >
                      {preferredModeObj.code} Sourcing
                    </span>
                  )}
                </div>

                {/* Mid Block: Metrics */}
                <div className="grid grid-cols-3 gap-2 py-3 border-t border-b border-slate-100 dark:border-gray-800 text-center text-xs">
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-550 font-bold uppercase">Total RFQs</div>
                    <div className="font-black text-slate-800 dark:text-white mt-0.5 mono">{b.rfqsList.length}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-550 font-bold uppercase">Active RFQs</div>
                    <div className="font-black text-slate-800 dark:text-white mt-0.5 mono">{b.activeCount}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-450 dark:text-gray-550 font-bold uppercase">Sourced Spend</div>
                    <div className="font-black text-indigo-600 dark:text-indigo-400 mt-0.5 mono">{formatCurrency(b.totalSpend)}</div>
                  </div>
                </div>

                {/* Action Block */}
                <div className="flex justify-between items-center pt-1.5">
                  <span className="text-[9px] text-slate-400 flex items-center gap-1 font-mono">
                    <Clock size={10} /> Avg quotes per RFQ: {b.avgQuotesPerRfq === null ? 'No RFQs yet' : b.avgQuotesPerRfq}
                  </span>

                  <button
                    onClick={() => {
                      if (isSelected) {
                        setSelectedBuyerId(null);
                        setDrillDownDismissed(true);
                      } else {
                        setSelectedBuyerId(b.id);
                        setDrillDownDismissed(false);
                        setExpandedRfqNumber(null);
                        setTimeout(() => {
                          const el = document.getElementById('buyer-drilldown-section');
                          if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }
                        }, 50);
                      }
                    }}
                    className="btn btn-secondary btn-xs font-bold flex items-center gap-1"
                  >
                    <span>{isSelected ? UI_STRINGS.actions.hideDetails : UI_STRINGS.actions.reviewRfqDetails}</span>
                    <ChevronRight size={12} className={`transform transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DETAILED DRILL DOWN SECTION (EXPANDS ON SELECTION) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {selectedBuyer && (
        <div id="buyer-drilldown-section" className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md space-y-4 animate-slide-up scroll-mt-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 size={16} className="text-indigo-650 dark:text-indigo-400" />
                Sourcing Details for {selectedBuyer.company} ({selectedBuyer.name})
              </h3>
              <p className="text-[10px] text-slate-450 dark:text-gray-500">
                Live drill-down. Double-click or expand specific RFQ rows below to inspect item specifications and quotes list.
              </p>
            </div>
            <span className="text-[11px] mono text-slate-500 font-bold bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded border border-indigo-200/20">
              {selectedBuyer.rfqsList.length} total dispatches
            </span>
          </div>

          {selectedBuyer.rfqsList.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-500 dark:text-gray-400 space-y-2 bg-slate-50/50 dark:bg-gray-950/40 rounded-xl p-6 border border-slate-200/60 dark:border-gray-800">
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto font-bold text-xs">
                {selectedBuyer.logoLetter}
              </div>
              <p className="font-semibold text-slate-700 dark:text-slate-200">No active RFQ records found for this buyer profile ({selectedBuyer.name}).</p>
              <p className="text-[11px] text-slate-400 max-w-md mx-auto">
                Buyer account is active ({selectedBuyer.company}). Any RFQs created and dispatched by this buyer will appear here with live quotes and evaluation analytics.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedBuyer.rfqsList.map((rfq) => {
                const isRfqExpanded = expandedRfqNumber === rfq.rfqNumber;
                const rfqModeObj = SOURCING_MODES.find(m => m.id === rfq.sourcingMode);
                // Some real RFQ rows predate extractedEntities being reliably
                // set — unguarded .length/.map here threw on render.
                const lineItems = rfq.extractedEntities || [];

                return (
                  <div
                    key={rfq.rfqNumber}
                    className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-gray-950/40"
                  >
                    {/* RFQ Row Title Header */}
                    <div
                      onClick={() => setExpandedRfqNumber(isRfqExpanded ? null : rfq.rfqNumber)}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-gray-900/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-md ${selectedBuyer.logoBg} font-mono font-bold text-[9px] flex items-center justify-center shrink-0`}>
                          {selectedBuyer.logoLetter}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white text-xs">{rfq.title}</span>
                            <span className="text-[10px] font-mono font-bold text-slate-505 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.25 rounded border border-slate-200 dark:border-gray-700">
                              {rfq.rfqNumber}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-slate-450 dark:text-gray-500 mt-1">
                            <span>Sourced Spend: <strong>{formatCurrency(rfq.budget)}</strong></span>
                            <span>Line Items: <strong>{lineItems.length}</strong></span>
                            <span>Quotes Recd: <strong>{rfq.quotesCount}</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        {rfqModeObj && (
                          <span
                            className="px-2 py-0.5 rounded text-[8px] font-bold"
                            style={{
                              backgroundColor: `${rfqModeObj.badgeColor}15`,
                              color: rfqModeObj.badgeColor,
                              border: `1px solid ${rfqModeObj.badgeColor}35`,
                            }}
                          >
                            {rfqModeObj.code} Sourcing
                          </span>
                        )}

                        <span className={`badge text-[9px] ${
                          rfq.status === 'Parsing' ? 'badge-amber' :
                          rfq.status === 'In Evaluation' ? 'badge-blue' : 'badge-emerald'
                        }`}>
                          {rfq.status}
                        </span>

                        <ChevronDown size={14} className="text-slate-450 transition-transform" style={{ transform: isRfqExpanded ? 'rotate(180deg)' : 'none' }} />
                      </div>
                    </div>

                    {/* RFQ Expanded Body Section */}
                    {isRfqExpanded && (
                      <div className="p-4 border-t border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 space-y-4 animate-fade-in text-xs">

                        {/* 1. Line Item Table */}
                        <div className="space-y-1.5">
                          <h4 className="text-[10px] font-extrabold uppercase text-slate-450 dark:text-gray-500 tracking-wider">
                            BOQ Specifications & Item Roster ({lineItems.length} items)
                          </h4>
                          <div className="border border-slate-200 dark:border-gray-800 rounded-lg overflow-hidden">
                            <table className="w-full text-[11px] text-left">
                              <thead>
                                <tr className="bg-slate-50 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800 text-slate-505 dark:text-gray-405 font-bold">
                                  <th className="p-2.5">Item Name / Description</th>
                                  <th className="p-2.5">Category</th>
                                  <th className="p-2.5 text-center">Quantity</th>
                                  <th className="p-2.5">Technical Specifications Spec</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lineItems.map((ent) => (
                                  <tr key={ent.id} className="border-b border-slate-100 dark:border-gray-850 text-slate-800 dark:text-gray-300">
                                    <td className="p-2.5 font-semibold text-slate-900 dark:text-white">{ent.itemName}</td>
                                    <td className="p-2.5">{ent.category}</td>
                                    <td className="p-2.5 text-center font-mono font-bold text-slate-900 dark:text-white">{ent.quantity} {ent.unit}</td>
                                    <td className="p-2.5 text-slate-500 dark:text-gray-400">{ent.technicalSpecs}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* 2. Dispatch / Quotes Evaluation Status Card */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-[11px] leading-relaxed text-slate-500 dark:text-gray-400">
                          <div>
                            💡 <strong>Category Control Action</strong>: RFQ was created on <span className="text-slate-800 dark:text-white font-semibold">{rfq.createdAt}</span> via Mode: <strong>{rfqModeObj?.name}</strong>.
                            {rfq.sourcingMode === 'mode_3' ? (
                              <span className="block mt-1 text-indigo-650 dark:text-indigo-400 font-semibold">
                                🔒 Version 3 Rule: 10 Recommended Procucev Vendors invited anonymously. Double-blind verification active.
                              </span>
                            ) : (
                              <span className="block mt-1">
                                Standard bidding is open. Chasing follow-up efficacy stands at {rfq.aiScore}%.
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {rfq.quotesCount > 0 && (
                              <button
                                onClick={() => onNavigateToMatrix(rfq)}
                                className="btn btn-primary btn-xs font-bold flex items-center gap-1"
                              >
                                <span>Go to Quote Matrix</span>
                                <ArrowRight size={10} />
                              </button>
                            )}
                            {rfq.sourcingMode === 'mode_3' && (
                              <button
                                onClick={onNavigateToEvaluation}
                                className="btn btn-secondary btn-xs font-bold"
                              >
                                Review Survey Evaluation
                              </button>
                            )}
                          </div>
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
