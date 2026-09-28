'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { formatCurrency } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { RFQItem, QuoteComparison } from '@/lib/types';
import { PurchaseOrderModal, RFQFollowUpDeepDiveModal } from '@/app/components/Modals';
import {
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  TrendingDown,
  Clock,
  Layers,
  FileCheck,
  Award,
  ChevronDown,
  ArrowLeft,
  IndianRupee,
  AlertCircle,
  Search,
  Info,
} from 'lucide-react';

interface QuoteMatrixProps {
  onBackToDashboard?: () => void;
  /**
   * True only for the buyer's own quote-matrix route: restricts the RFQ
   * switcher and the fallback selection to the logged-in buyer's own
   * company. Category managers reuse this same component and need the full
   * cross-buyer list, so this defaults to false there.
   */
  scopeToOwnBuyerAccount?: boolean;
}

export default function QuoteMatrix({ onBackToDashboard, scopeToOwnBuyerAccount = false }: QuoteMatrixProps) {
  const { rfqs: allRfqs, selectedRFQForMatrix, setSelectedRFQForMatrix, showToast, openRFQDeepDive, deepDiveModalOpen, setDeepDiveModalOpen, selectedRFQForDeepDive } = useApp();

  // GET /api/rfqs is itself scoped server-side by the caller's role now — see
  // command-center.tsx's matching note — so allRfqs is already exactly right
  // either way: a buyer's own list on this route, or the full cross-buyer
  // list on the category manager's. `selectedRFQForMatrix` is app-wide store
  // state though, so a stale selection left over from a different role's
  // navigation is still deliberately checked against the current list below
  // rather than trusted outright.
  const rfqs = allRfqs;
  const selectionInScope = !scopeToOwnBuyerAccount || (!!selectedRFQForMatrix && rfqs.some((r) => r.id === selectedRFQForMatrix.id));

  const currentRFQ = (selectionInScope ? selectedRFQForMatrix : null) || (rfqs.length > 0 ? rfqs[0] : null);

  const [poModalOpen, setPoModalOpen] = useState(false);
  const [selectedVendorForPO, setSelectedVendorForPO] = useState<QuoteComparison | null>(null);

  if (!currentRFQ) {
    return (
      <div className="p-12 text-center glass-panel rounded-2xl space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
        <AlertCircle size={32} className="mx-auto text-amber-500" />
        <h3 className="text-base font-bold text-slate-900 dark:text-white">No RFQs Available</h3>
        <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md mx-auto">
          Please create or ingest an RFQ first to generate the comparative quote evaluation matrix.
        </p>
      </div>
    );
  }

  const quotes = currentRFQ.quotes || [];

  const handleSelectVendor = (quote: QuoteComparison) => {
    setSelectedVendorForPO(quote);
    setPoModalOpen(true);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Top Bar with Back Link and RFQ Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <button
            onClick={onBackToDashboard}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white mb-2 transition-colors font-medium"
          >
            <ArrowLeft size={14} /> Back to Command Center
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Comparative Quote Evaluation Matrix
            </h1>
          </div>
        </div>

        {/* RFQ Switcher Dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-gray-400 hidden sm:inline">Active RFQ:</span>
          <select
            value={currentRFQ.id}
            onChange={(e) => {
              const found = rfqs.find((r) => r.id === e.target.value);
              if (found) setSelectedRFQForMatrix(found);
            }}
            className="text-xs font-semibold mono bg-white dark:bg-gray-900 border border-slate-300 dark:border-gray-700 rounded-lg px-3 py-1.5 shadow-sm"
          >
            {rfqs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.rfqNumber} — {r.title.slice(0, 35)}... ({r.quotesCount} Quotes)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* RFQ Context Strip with Multi-Channel Follow-Up Badges */}
      <div className="p-4 rounded-xl glass-panel space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
              <Layers size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-slate-900 dark:text-white text-sm mono">{currentRFQ.rfqNumber}</span>
                <span className="badge badge-blue">{currentRFQ.category}</span>
                {currentRFQ.chasingActive && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 flex items-center gap-1">
                    <span className="live-dot" /> AI Chasing Active
                  </span>
                )}
              </div>
              <p className="text-slate-600 dark:text-gray-300 font-medium text-xs mt-0.5">{currentRFQ.title}</p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-slate-700 dark:text-gray-300 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 dark:text-gray-400 block uppercase">Target Delivery</span>
              <span className="font-bold text-slate-900 dark:text-white mono">{currentRFQ.targetDeliveryDate}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 dark:text-gray-400 block uppercase">Estimated Budget</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 mono">
                {formatCurrency(currentRFQ.budget)}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 dark:text-gray-400 block uppercase">Bids Evaluated</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-300 mono">{quotes.length} Suppliers</span>
            </div>
          </div>
        </div>

        {/* Multi-Channel Follow-Up Status Strip */}
        {currentRFQ.followUpData && (
          <div className="pt-2.5 border-t border-slate-100 dark:border-gray-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                AI FOLLOW-UP STATUS:
              </span>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                📞 Calls: {currentRFQ.followUpData.callStats.connected}/{currentRFQ.followUpData.callStats.total} Connected (Avg {currentRFQ.followUpData.callStats.avgDuration})
              </span>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                💬 WhatsApp: {currentRFQ.followUpData.whatsappStats.read}/{currentRFQ.followUpData.whatsappStats.total} Read ({currentRFQ.followUpData.whatsappStats.replied} Bids In)
              </span>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-50 dark:bg-cyan-950/60 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-800">
                📱 SMS: {currentRFQ.followUpData.smsStats.delivered}/{currentRFQ.followUpData.smsStats.total} Delivered
              </span>
            </div>

            <button
              onClick={() => openRFQDeepDive(currentRFQ)}
              className="btn btn-secondary btn-sm text-[11px] px-2.5 flex items-center gap-1.5"
            >
              <Search size={12} />
              <span>Deep Dive Telemetry ({currentRFQ.followUpData.respondedCount}/{currentRFQ.followUpData.totalInvited} Responded) ↗</span>
            </button>
          </div>
        )}
      </div>

      {/* Evaluation Matrix Comparison Table */}
      {quotes.length === 0 ? (
        <div className="p-12 text-center glass-panel rounded-2xl space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <AlertCircle size={32} className="mx-auto text-amber-500" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Quotes Pending for this RFQ</h3>
          <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md mx-auto">
            Suppliers have been invited and autonomous AI quote chasing is currently active. Switch to RFQ-2026-00421 to view the full comparative evaluation matrix.
          </p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-gray-800 shadow-xl bg-white dark:bg-gray-900/80">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-gray-900/90 text-slate-700 dark:text-gray-300 border-b border-slate-200 dark:border-gray-800">
                  <th className="p-4 w-60 text-[11px] uppercase font-bold text-slate-500 dark:text-gray-400">
                    Evaluation Parameter
                  </th>
                  {quotes.map((quote) => (
                    <th
                      key={quote.vendorId}
                      className={`p-4 min-w-[240px] text-left transition-all ${
                        quote.isPreferred
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-x-2 border-indigo-600 dark:border-indigo-500 text-slate-900 dark:text-white'
                          : 'text-slate-800 dark:text-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-sm text-slate-900 dark:text-white">{quote.vendorName}</span>
                        <div className="flex items-center gap-1.5">
                          <span
                            data-testid={`quote-source-${quote.vendorId}`}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                              quote.source === 'email'
                                ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/40'
                                : 'bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-500/40'
                            }`}
                          >
                            {quote.source === 'email' ? UI_STRINGS.badges.emailQuoteSource : UI_STRINGS.badges.portalQuoteSource}
                          </span>
                          {quote.isPreferred && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40 flex items-center gap-1">
                              <Sparkles size={11} /> AI Rec
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-1 flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-gray-800 text-[10px] text-slate-700 dark:text-gray-300 font-semibold">
                          {quote.vendorCategory}
                        </span>
                        {quote.isBestPrice && (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold text-[10px] border border-emerald-300 dark:border-emerald-800">
                            Best Price
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 dark:divide-gray-800/80 text-slate-700 dark:text-gray-300">
                {/* Unit Price */}
                <tr className="hover:bg-slate-50/80 dark:hover:bg-gray-800/20">
                  <td className="p-4 font-bold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                    <IndianRupee size={15} className="text-emerald-600 dark:text-emerald-400" /> Unit Price (₹)
                  </td>
                  {quotes.map((q) => (
                    <td
                      key={q.vendorId}
                      className={`p-4 ${q.isPreferred ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-x-2 border-indigo-600 dark:border-indigo-500' : ''}`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-black text-slate-900 dark:text-white mono">
                          {formatCurrency(q.unitPrice)}
                        </span>
                        {q.isBestPrice && (
                          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                            <TrendingDown size={12} /> Lowest
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-gray-500">Total: {formatCurrency(q.totalPrice)}</span>
                    </td>
                  ))}
                </tr>

                {/* Lead Time */}
                <tr className="hover:bg-slate-50/80 dark:hover:bg-gray-800/20">
                  <td className="p-4 font-bold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                    <Clock size={15} className="text-sky-600 dark:text-cyan-400" /> Lead Time (Days)
                  </td>
                  {quotes.map((q) => (
                    <td
                      key={q.vendorId}
                      className={`p-4 ${q.isPreferred ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-x-2 border-indigo-600 dark:border-indigo-500' : ''}`}
                    >
                      <span className="font-extrabold text-slate-900 dark:text-white text-sm mono">{q.leadTimeDays} Days</span>
                      <span className="text-[10px] text-slate-400 dark:text-gray-400 block mt-0.5">Direct site delivery</span>
                    </td>
                  ))}
                </tr>

                {/* AI Quality / Match Score */}
                <tr className="hover:bg-slate-50/80 dark:hover:bg-gray-800/20">
                  <td className="p-4 font-bold text-slate-800 dark:text-gray-200">
                    <div className="flex items-center gap-1.5">
                      <Award size={15} className="text-purple-600 dark:text-purple-400 shrink-0" />
                      <span>AI Quality / Match Score</span>
                      <div className="relative group cursor-pointer inline-flex items-center ml-1">
                        <Info size={14} className="text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors" />
                        <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-64 p-3 bg-slate-900 text-white text-[11px] rounded-lg shadow-xl border border-slate-700 pointer-events-none">
                          <p className="font-bold text-purple-300 mb-1">Parametric Match Scoring:</p>
                          <ul className="space-y-1 text-slate-300">
                            <li>• <strong className="text-white">Price (45%):</strong> Compares against lowest quote</li>
                            <li>• <strong className="text-white">Lead Time (30%):</strong> Faster delivery earns higher score</li>
                            <li>• <strong className="text-white">Warranty (25%):</strong> Extended coverage years</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </td>
                  {quotes.map((q) => {
                    const pricePts = q.scoreBreakdown ? q.scoreBreakdown.price.weighted : (q.isBestPrice ? 45 : 36);
                    const leadPts = q.scoreBreakdown ? q.scoreBreakdown.leadTime.weighted : Math.round(Math.max(0, 100 - q.leadTimeDays * 2) * 0.3);
                    const warPts = q.scoreBreakdown ? q.scoreBreakdown.warranty.weighted : Math.round(Math.min(100, 50 + q.warrantyYears * 10) * 0.25);
                    const displayScore = q.aiMatchScore;

                    return (
                      <td
                        key={q.vendorId}
                        className={`p-4 ${q.isPreferred ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-x-2 border-indigo-600 dark:border-indigo-500' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-base font-black mono ${
                              displayScore >= 90
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : displayScore >= 80
                                ? 'text-sky-600 dark:text-cyan-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {displayScore}%
                          </span>
                          {q.isPreferred && (
                            <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase">
                              (Preferred)
                            </span>
                          )}
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 mt-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              displayScore >= 90 ? 'bg-emerald-500' : 'bg-indigo-500'
                            }`}
                            style={{ width: `${displayScore}%` }}
                          />
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400 mt-1.5 font-mono">
                          <span title="Price Score (Max 45)">P: {pricePts}</span>
                          <span>•</span>
                          <span title="Lead Time Score (Max 30)">L: {leadPts}</span>
                          <span>•</span>
                          <span title="Warranty Score (Max 25)">W: {warPts}</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>

                {/* Technical Compliance */}
                <tr className="hover:bg-slate-50/80 dark:hover:bg-gray-800/20">
                  <td className="p-4 font-bold text-slate-800 dark:text-gray-200">Compliance & Warranty</td>
                  {quotes.map((q) => (
                    <td
                      key={q.vendorId}
                      className={`p-4 ${q.isPreferred ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-x-2 border-indigo-600 dark:border-indigo-500' : ''}`}
                    >
                      <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold text-xs">
                        <CheckCircle2 size={13} /> {q.complianceStatus}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">
                        Warranty: <span className="text-slate-900 dark:text-white font-medium">{q.warrantyYears} Years</span>
                      </div>
                    </td>
                  ))}
                </tr>

                {/* Commercial Terms */}
                <tr className="hover:bg-slate-50/80 dark:hover:bg-gray-800/20">
                  <td className="p-4 font-bold text-slate-800 dark:text-gray-200">Commercial Terms & Remarks</td>
                  {quotes.map((q) => (
                    <td
                      key={q.vendorId}
                      className={`p-4 text-xs text-slate-600 dark:text-gray-300 leading-relaxed ${
                        q.isPreferred ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-x-2 border-indigo-600 dark:border-indigo-500' : ''
                      }`}
                    >
                      <p className="font-semibold text-slate-900 dark:text-gray-200">{q.paymentTerms}</p>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">{q.remarks}</p>
                    </td>
                  ))}
                </tr>

                {/* Selection Action Band */}
                <tr className="bg-slate-100/70 dark:bg-gray-900/60">
                  <td className="p-4 font-bold text-slate-500 dark:text-gray-400 text-[11px] uppercase">
                    Selection Action
                  </td>
                  {quotes.map((quote) => (
                    <td
                      key={quote.vendorId}
                      className={`p-4 ${
                        quote.isPreferred
                          ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-x-2 border-indigo-600 dark:border-indigo-500'
                          : ''
                      }`}
                    >
                      {quote.isPreferred ? (
                        <button
                          onClick={() => handleSelectVendor(quote)}
                          className="btn btn-emerald btn-lg w-full font-bold shadow-md"
                        >
                          <ShieldCheck size={16} /> [ APPROVE & GENERATE PO ]
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSelectVendor(quote)}
                          className="btn btn-secondary btn-md w-full"
                        >
                          Select {quote.vendorName.split(' ')[0]}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PO Generator Modal */}
      {selectedVendorForPO && (
        <PurchaseOrderModal
          isOpen={poModalOpen}
          onClose={() => setPoModalOpen(false)}
          rfqNumber={currentRFQ.rfqNumber}
          vendorId={selectedVendorForPO.vendorId}
          vendorName={selectedVendorForPO.vendorName}
          totalAmount={selectedVendorForPO.totalPrice}
          unitPrice={selectedVendorForPO.unitPrice}
          leadTime={selectedVendorForPO.leadTimeDays}
          deliveryDate={currentRFQ.targetDeliveryDate}
          lineItems={(currentRFQ.extractedEntities || []).map((ent) => ({
            description: ent.itemName,
            quantity: ent.quantity,
            unit: ent.unit,
          }))}
        />
      )}

      {/* RFQ Multi-Channel Follow-Up Deep Dive Modal */}
      <RFQFollowUpDeepDiveModal
        isOpen={deepDiveModalOpen}
        onClose={() => setDeepDiveModalOpen(false)}
        rfq={selectedRFQForDeepDive || currentRFQ}
      />
    </div>
  );
}
