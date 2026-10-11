'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/lib/store';
import { formatCurrency, formatIndianDate } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { RFQItem, QuoteComparison } from '@/lib/types';
import { PurchaseOrderModal, RFQFollowUpDeepDiveModal } from '@/app/components/Modals';
import { downloadBidComparisonExcel, downloadFullQuotesExcel, downloadSingleVendorQuoteExcel } from '@/lib/bidComparisonExport';
import QuoteAttachmentLink from '@/app/components/QuoteAttachmentLink';
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
  Lock,
  Mail,
  Download,
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
  const { currentRole, rfqs: allRfqs, selectedRFQForMatrix, setSelectedRFQForMatrix, showToast, openRFQDeepDive, deepDiveModalOpen, setDeepDiveModalOpen, selectedRFQForDeepDive } = useApp();
  const searchParams = useSearchParams();
  const rfqParam = searchParams?.get('rfq');

  const rfqs = allRfqs;

  useEffect(() => {
    if (rfqParam && rfqs.length > 0) {
      const match = rfqs.find((r) => r.rfqNumber === rfqParam || r.id === rfqParam);
      if (match && match.id !== selectedRFQForMatrix?.id) {
        setSelectedRFQForMatrix(match);
      }
    }
  }, [rfqParam, rfqs, selectedRFQForMatrix?.id, setSelectedRFQForMatrix]);

  const paramMatch = rfqParam ? rfqs.find((r) => r.rfqNumber === rfqParam || r.id === rfqParam) : null;
  const selectionInScope = !scopeToOwnBuyerAccount || (!!selectedRFQForMatrix && rfqs.some((r) => r.id === selectedRFQForMatrix.id));

  const currentRFQ = paramMatch || (selectionInScope ? selectedRFQForMatrix : null) || (rfqs.length > 0 ? rfqs[0] : null);

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
    <div className="space-y-2.5 animate-fade-in pb-4">
      {/* Top Bar with Back Link and RFQ Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <button
            onClick={onBackToDashboard}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors font-medium"
          >
            <ArrowLeft size={14} /> Back to Command Center
          </button>
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
            className="text-xs font-semibold mono bg-white dark:bg-gray-900 border border-slate-300 dark:border-gray-700 rounded-lg px-2.5 py-1.5 shadow-sm"
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
      <div className="p-3 sm:p-3.5 rounded-xl glass-panel space-y-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
              <Layers size={18} />
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

          <div className="flex items-center gap-4 text-slate-700 dark:text-gray-300 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 dark:text-gray-400 block uppercase">Target Delivery</span>
              <span className="font-bold text-slate-900 dark:text-white mono">
                {formatIndianDate(
                  currentRFQ.targetDeliveryDate ||
                    (currentRFQ as any).target_delivery_date ||
                    (currentRFQ as any).deadline
                ) || currentRFQ.targetDeliveryDate || UI_STRINGS.rfqDetails.unsetValue}
              </span>
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
          <div className="pt-2 border-t border-slate-100 dark:border-gray-800/80 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                AI FOLLOW-UP STATUS:
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                📞 Calls: {currentRFQ.followUpData.callStats.connected}/{currentRFQ.followUpData.callStats.total} Connected (Avg {currentRFQ.followUpData.callStats.avgDuration})
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                💬 WhatsApp: {currentRFQ.followUpData.whatsappStats.read}/{currentRFQ.followUpData.whatsappStats.total} Read ({currentRFQ.followUpData.whatsappStats.replied} Bids In)
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 dark:bg-cyan-950/60 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-800">
                📱 SMS: {currentRFQ.followUpData.smsStats.delivered}/{currentRFQ.followUpData.smsStats.total} Delivered
              </span>
            </div>

            <button
              onClick={() => openRFQDeepDive(currentRFQ)}
              className="btn btn-secondary btn-sm text-[11px] px-2.5 flex items-center gap-1.5"
            >
              <Search size={12} />
              <span>Vendor Follow-Up Details ({currentRFQ.followUpData.respondedCount}/{currentRFQ.followUpData.totalInvited} Responded) ↗</span>
            </button>
          </div>
        )}
      </div>

      {/* Evaluation Matrix Comparison Table */}
      {currentRole === 'buyer' && (currentRFQ?.sourcingMode === 'mode_0' || (currentRFQ?.sourcingMode as any) === 'v0' || (currentRFQ?.sourcingMode as any) === 'version_0') ? (
        <div className="p-8 text-center glass-panel rounded-xl space-y-3 border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/40 dark:bg-indigo-950/20 shadow-sm">
          <div className="w-12 h-12 mx-auto rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-inner">
            <Mail size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Direct Email Quotes (Version 0 Free Starter)</h3>
            <p className="text-xs text-slate-600 dark:text-gray-300 max-w-lg mx-auto">
              Quotations for V0 RFQs are sent directly to your registered corporate email upon submission. Comparative portal matrices and vendor details are not displayed in the portal for V0.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-white dark:bg-gray-800 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/60 shadow-sm">
            <Mail size={13} />
            <span>Check your inbox for vendor quotations on {currentRFQ.rfqNumber}</span>
          </div>
        </div>
      ) : currentRole === 'buyer' && currentRFQ?.quotesHidden ? (
        <div className="p-8 text-center glass-panel rounded-xl space-y-3 border border-amber-300 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-950/20 shadow-md">
          <div className="w-12 h-12 mx-auto rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-inner">
            <Lock size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Quotes Sealed — 48-Hour Bidding Period Active</h3>
            <p className="text-xs text-slate-600 dark:text-gray-300 max-w-lg mx-auto">
              {currentRFQ.quotesHiddenReason || 'Received quotations remain hidden from the buyer for 48 hours after release to preserve bidding integrity.'}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-white dark:bg-gray-800 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700/60 shadow-sm">
            <Clock size={13} />
            <span>Unseals on: {currentRFQ.quotesHiddenUntil ? new Date(currentRFQ.quotesHiddenUntil).toLocaleString() : 'After 48 hours'} (or upon RFQ closure)</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 max-w-md mx-auto">
            📱 An SMS comparison acknowledgment and final evaluation email will automatically be sent to your phone and inbox upon RFQ closure.
          </p>
        </div>
      ) : quotes.length === 0 ? (
        <div className="p-8 text-center glass-panel rounded-xl space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <AlertCircle size={30} className="mx-auto text-amber-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Quotes Pending for this RFQ</h3>
          <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md mx-auto">
            Suppliers have been invited and autonomous AI quote chasing is currently active. Switch to RFQ-2026-00421 to view the full comparative evaluation matrix.
          </p>
        </div>
      ) : (
        <div className="glass-panel rounded-xl overflow-hidden border border-slate-200 dark:border-gray-800 shadow-xl bg-white dark:bg-gray-900/80">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-gray-900/90 text-slate-700 dark:text-gray-300 border-b border-slate-200 dark:border-gray-800">
                  <th className="px-3.5 py-3 w-60 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400">
                    Evaluation Parameter
                  </th>
                  {quotes.map((quote) => (
                    <th
                      key={quote.vendorId}
                      className={`px-3.5 py-3 min-w-[240px] text-left transition-all ${
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

                {/* Bid Documents */}
                <tr className="hover:bg-slate-50/80 dark:hover:bg-gray-800/20">
                  <td className="p-4 font-bold text-slate-800 dark:text-gray-200">Bid Documents</td>
                  {quotes.map((quote) => (
                    <td
                      key={quote.vendorId}
                      className={`p-4 ${quote.isPreferred ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-x-2 border-indigo-600 dark:border-indigo-500' : ''}`}
                    >
                      <div className="space-y-1">
                        {(quote.attachments || []).length === 0 ? (
                          <span className="text-[11px] text-slate-400">No documents attached</span>
                        ) : (
                          (quote.attachments || []).map((attachment) => (
                            <QuoteAttachmentLink key={attachment.id} rfqId={currentRFQ.id} attachment={attachment} />
                          ))
                        )}
                      </div>
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
                          <ShieldCheck size={16} /> [ APPROVE & GENERATE PRE-PURCHASE ORDER ]
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

      {/* Line-Item-Wise Bid Comparison (DPS Template) */}
      {quotes.length > 0 && !currentRFQ?.quotesHidden && (currentRFQ.extractedEntities || []).length > 0 && (
        <div className="glass-panel rounded-xl overflow-hidden border border-slate-200 dark:border-gray-800 shadow-xl bg-white dark:bg-gray-900/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-900/50">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Layers size={15} className="text-indigo-600 dark:text-indigo-400" />
                Line-Item-Wise Bid Comparison
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                Detailed Price Schedule (DPS) breakdown — Unit rate, line total, taxes & delivery terms side-by-side.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => downloadFullQuotesExcel(currentRFQ, quotes)}
                className="btn btn-primary btn-sm text-[11px] px-2.5 flex items-center gap-1.5 shadow-sm"
                title="Download full multi-tab Excel with quotes overview, line item matrix, and granular items"
              >
                <Download size={12} /> Download Full Quotes (Excel)
              </button>
              <button
                onClick={() => downloadBidComparisonExcel(currentRFQ, quotes)}
                className="btn btn-secondary btn-sm text-[11px] px-2.5 flex items-center gap-1.5 shadow-sm"
                title="Download item-by-vendor comparison matrix"
              >
                <Download size={12} /> Download Excel
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/80 dark:bg-gray-900/90 text-slate-700 dark:text-gray-300 border-b border-slate-200 dark:border-gray-800">
                  <th className="px-3.5 py-3 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 min-w-[200px]">
                    Item Description & Specs
                  </th>
                  <th className="px-3 py-3 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 min-w-[80px] text-center">
                    RFQ Qty
                  </th>
                  {quotes.map((quote) => (
                    <th
                      key={quote.vendorId}
                      className={`px-3.5 py-3 text-[10px] uppercase font-bold text-slate-700 dark:text-gray-300 min-w-[220px] ${
                        quote.isPreferred ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-x border-indigo-300 dark:border-indigo-800' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-extrabold text-slate-900 dark:text-white truncate">{quote.vendorName}</span>
                        {quote.isBestPrice && (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[9px] font-bold border border-emerald-300 dark:border-emerald-800">
                            Overall L1
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] font-normal text-slate-400 dark:text-gray-500 normal-case mt-0.5">
                        DPS Breakdown (Rate | Total | Tax | Terms)
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-gray-800/80">
                {(currentRFQ.extractedEntities || []).map((item, itemIdx) => {
                  const prices = quotes.map((quote) => {
                    const items = quote.lineItemQuotes || [];
                    const matched =
                      items.find((li) => li.lineItemId === item.id) ||
                      items.find((li) => (li.itemName || '').trim().toLowerCase() === (item.itemName || '').trim().toLowerCase());
                    return { quote, matched };
                  });
                  const realPrices = prices
                    .filter((p) => p.matched && typeof p.matched.unitPrice === 'number')
                    .map((p) => p.matched!.unitPrice)
                    .filter((p) => p > 0);
                  const lowestPrice = realPrices.length > 0 ? Math.min(...realPrices) : null;

                  return (
                    <tr key={item.id || itemIdx} className="hover:bg-slate-50/60 dark:hover:bg-gray-800/30">
                      <td className="px-3.5 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white text-xs">{item.itemName}</div>
                        {item.technicalSpecs && item.technicalSpecs !== item.itemName && (
                          <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5 line-clamp-1">{item.technicalSpecs}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center mono font-medium text-slate-700 dark:text-gray-300">
                        {item.quantity} {item.unit || 'Nos'}
                      </td>
                      {prices.map(({ quote, matched }) => {
                        const isL1 = matched && lowestPrice !== null && matched.unitPrice === lowestPrice;
                        const lineTotal = matched ? matched.totalPrice || matched.unitPrice * (item.quantity || 1) : null;
                        const taxRate = (quote as any).taxRate || (quote.taxes ? 18 : 18);
                        const estTax = lineTotal ? Math.round((lineTotal * taxRate) / 100) : null;
                        const leadTime = matched?.leadTimeDays ?? quote.leadTimeDays;

                        return (
                          <td
                            key={quote.vendorId}
                            className={`px-3.5 py-3 ${
                              quote.isPreferred ? 'bg-indigo-50/30 dark:bg-indigo-950/20 border-x border-indigo-200 dark:border-indigo-800/50' : ''
                            }`}
                          >
                            {matched ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-1">
                                  <span
                                    className={`mono font-bold text-xs ${
                                      isL1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'
                                    }`}
                                  >
                                    {formatCurrency(matched.unitPrice)}
                                  </span>
                                  {isL1 && (
                                    <span className="px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[9px] font-bold border border-emerald-300 dark:border-emerald-800 flex items-center gap-0.5">
                                      <TrendingDown size={9} /> L1 Lowest
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                                  <span>Total:</span>
                                  <span className="mono font-semibold text-slate-700 dark:text-gray-300">
                                    {formatCurrency(lineTotal || 0)}
                                  </span>
                                </div>
                                <div className="text-[9px] text-slate-400 dark:text-gray-500 flex items-center justify-between border-t border-slate-100 dark:border-gray-800/60 pt-0.5">
                                  <span>GST ({taxRate}%):</span>
                                  <span className="mono">+{formatCurrency(estTax || 0)}</span>
                                </div>
                                <div className="text-[9px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                                  <span>Delivery:</span>
                                  <span className="font-medium text-slate-700 dark:text-gray-300">{leadTime} Days</span>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex items-baseline gap-1">
                                  <span className="text-slate-400 dark:text-gray-500 mono text-xs">
                                    {formatCurrency(quote.unitPrice)}
                                  </span>
                                  <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">(not itemized)</span>
                                </div>
                                <div className="text-[10px] text-slate-400 dark:text-gray-500 flex items-center justify-between">
                                  <span>Blended Total:</span>
                                  <span className="mono">{formatCurrency(quote.totalPrice)}</span>
                                </div>
                                <div className="text-[9px] text-slate-400 dark:text-gray-500 flex items-center justify-between">
                                  <span>Delivery:</span>
                                  <span>{quote.leadTimeDays} Days</span>
                                </div>
                                <div className="text-[9px] text-slate-400 italic">
                                  — (No separate item breakdown)
                                </div>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
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
