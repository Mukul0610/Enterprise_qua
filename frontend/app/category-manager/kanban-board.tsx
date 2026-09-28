'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { RFQItem } from '@/lib/types';
import { MultiChannelChaserModal, VendorSurveyModal, RFQFollowUpDeepDiveModal } from '@/app/components/Modals';
import {
  MessageSquare,
  Share2,
  AlertTriangle,
  FileCheck,
  ChevronRight,
  Sliders,
  TrendingUp,
  Search,
  Sparkles,
  Zap,
  X,
  FileText,
} from 'lucide-react';
import { SOURCING_MODES, formatIndianDateTime } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { RFQEditModal } from '@/app/buyer/RFQEditModal';

const KANBAN = UI_STRINGS.categoryManagerKanban;

interface KanbanBoardProps {
  onNavigateToMatrix?: (rfq: RFQItem) => void;
  onNavigateToSpend?: () => void;
  onNavigateToAllRfqs?: () => void;
  onNavigateToVendorConsole?: () => void;
}

/** Status → badge tone for the "AI Evaluation & Scored" column. */
const SCORED_STATUS_TONE: Record<string, string> = {
  'In Evaluation': 'badge-blue',
  'AI Recommended': 'badge-emerald',
  'PO Generated': 'badge-purple',
};

export default function KanbanBoard({
  onNavigateToMatrix,
  onNavigateToSpend,
  onNavigateToAllRfqs,
  onNavigateToVendorConsole,
}: KanbanBoardProps) {
  const {
    rfqs,
    triggerChannelChaser,
    triggerBatchChannelChaser,
    addAuditLog,
    showToast,
    setSelectedRFQForMatrix,
    updateRFQ,
    openRFQDeepDive,
    deepDiveModalOpen,
    setDeepDiveModalOpen,
    selectedRFQForDeepDive,
  } = useApp();

  // The RFQ the category manager is reviewing. Reuses the existing edit dialog
  // rather than introducing a second category-management surface.
  const [rfqUnderReview, setRfqUnderReview] = useState<RFQItem | null>(null);
  const [chaserModalOpen, setChaserModalOpen] = useState(false);
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [selectedRfqForChaser, setSelectedRfqForChaser] = useState<string>('');
  const [targetVendor, setTargetVendor] = useState<string>('Vendor Pool');
  const [chaserInitialChannel, setChaserInitialChannel] = useState<'call' | 'whatsapp' | 'sms'>('whatsapp');

  // Group into 3 specification Kanban columns, driven by the real, live RFQ
  // pipeline — no static demo cards. A column stays empty (with its own
  // empty-state message below) rather than padding its count or back-filling
  // it with placeholder cards when no real RFQ is at that stage.
  const col1_parsing = rfqs.filter((r) => r.status === 'Parsing');
  const col2_pending = rfqs.filter((r) => r.status === 'Quotes Pending');
  const col3_scored = rfqs.filter((r) => r.status === 'In Evaluation' || r.status === 'AI Recommended' || r.status === 'PO Generated');

  const modeBadge = (modeId: RFQItem['sourcingMode']) => {
    const mode = SOURCING_MODES.find((m) => m.id === modeId);
    if (!mode) return null;
    return <span className={`px-2 py-0.5 rounded border text-[10px] font-bold tracking-wide ${mode.badgeColor}`}>{mode.code}</span>;
  };

  const avgConfidence = (rfq: RFQItem): number | null => {
    // Some real RFQ rows predate extractedEntities being reliably set —
    // reading it unguarded here threw and crashed the whole board whenever
    // one such RFQ reached the scored column.
    const entities = rfq.extractedEntities || [];
    if (entities.length === 0) return null;
    const total = entities.reduce((sum, e) => sum + e.confidence, 0);
    return Math.round((total / entities.length) * 10) / 10;
  };

  const handleOpenChaser = (rfq: RFQItem, channel: 'call' | 'whatsapp' | 'sms' | 'email') => {
    const primaryVendorName = rfq.followUpData?.vendors?.[0]?.vendorName || 'Vendor Pool';
    setSelectedRfqForChaser(rfq.rfqNumber);
    setTargetVendor(primaryVendorName);
    setChaserInitialChannel(channel === 'email' ? 'whatsapp' : channel);
    if (channel === 'email') {
      triggerChannelChaser(rfq.rfqNumber, 'email', primaryVendorName);
    } else {
      setChaserModalOpen(true);
    }
  };

  const handleEscalateToBuyer = (rfqNumber: string) => {
    addAuditLog(`Category Manager escalated ${rfqNumber} to Enterprise Buyer review queue`, rfqNumber);
    showToast('Escalated to Buyer', `${rfqNumber} flagged for buyer intervention with priority notice.`, 'warning');
  };

  const handleApproveReport = (rfq: RFQItem) => {
    addAuditLog(`Approved Mode 3 AI Capability & Pricing Evaluation Report for ${rfq.rfqNumber}`, rfq.rfqNumber);
    showToast('AI Report Approved', `Autonomous scoring and vendor selection report validated for ${rfq.rfqNumber}.`, 'success');
  };

  const handleShareReport = (rfq: RFQItem) => {
    addAuditLog(`Shared AI Evaluation Report with client@procucev.com for ${rfq.rfqNumber}`, rfq.rfqNumber);
    showToast('Report Shared with Client', `Executive summary dispatched to client@procucev.com.`, 'info');
  };

  const handleViewMatrix = (rfq: RFQItem) => {
    setSelectedRFQForMatrix(rfq);
    if (onNavigateToMatrix) onNavigateToMatrix(rfq);
  };

  const handleBatchFollowUp = () => {
    if (col2_pending.length === 0) {
      showToast('No RFQs Awaiting Quotes', 'There are no RFQs in Quotes Pending to batch-chase.', 'info');
      return;
    }
    col2_pending.forEach((rfq) => triggerBatchChannelChaser(rfq.rfqNumber, ['call', 'whatsapp', 'sms'], true));
    addAuditLog(
      `Executed Global Override: Multi-Channel Batch Follow-up (Call + WhatsApp + SMS) to ${col2_pending.length} pending RFQ(s)`
    );
    showToast(
      'Multi-Channel Batch Broadcast Active!',
      `AI chasing dispatched across Call, WhatsApp, and SMS for ${col2_pending.length} pending RFQ(s).`,
      'success'
    );
  };

  // ── Real portfolio metrics for the top strip, all derived from the live
  // `rfqs` collection so the headline numbers can never drift from the
  // pipeline beneath them.
  const totalRFQs = rfqs.length;
  const activeChasing = rfqs.filter((r) => r.chasingActive).length;
  const quotesReceived = rfqs.reduce((sum, r) => sum + (r.quotesCount || 0), 0);
  const avgQuotesPerRFQ = totalRFQs === 0 ? 0 : Math.round((quotesReceived / totalRFQs) * 10) / 10;
  const awaitingQuotes = rfqs.filter((r) => (r.quotesCount || 0) === 0).length;
  const chaserVendorsInvited = rfqs.reduce((sum, r) => sum + (r.followUpData?.totalInvited || 0), 0);
  const chaserVendorsResponded = rfqs.reduce((sum, r) => sum + (r.followUpData?.respondedCount || 0), 0);
  const responseRate = chaserVendorsInvited > 0 ? Math.round((chaserVendorsResponded / chaserVendorsInvited) * 100) : null;
  // The real count of vendors a category manager has actually invited onto
  // each RFQ (assignedVendors) — not the simulated AI chaser's outreach
  // count above, which is a different, deliberately-unaudited feature.
  const rfqsWithInvites = rfqs.filter((r) => (r.assignedVendors?.length || 0) > 0).length;
  const totalVendorsInvited = rfqs.reduce((sum, r) => sum + (r.assignedVendors?.length || 0), 0);

  const [summaryFilterModal, setSummaryFilterModal] = useState<'pipeline' | 'quotes' | 'awaiting' | null>(null);

  const summaryCards = [
    {
      key: 'pipeline',
      label: 'RFQs In Pipeline',
      value: `${totalRFQs} Total`,
      hint: `${activeChasing} Actively Chasing`,
      tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800',
      onClick: () => setSummaryFilterModal('pipeline'),
    },
    {
      key: 'quotes',
      label: 'Quotes Received',
      value: `${quotesReceived} Total`,
      hint: `Avg ${avgQuotesPerRFQ} / RFQ`,
      tone: 'text-sky-600 dark:text-cyan-400 bg-sky-50 dark:bg-cyan-950/60 border-sky-200 dark:border-sky-800',
      onClick: () => setSummaryFilterModal('quotes'),
    },
    {
      key: 'response',
      label: 'Vendor Response Rate',
      value: responseRate === null ? '—' : `${responseRate}%`,
      hint: responseRate === null ? 'No follow-ups sent yet' : '<24h Response',
      tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800',
      onClick: onNavigateToVendorConsole,
    },
    {
      key: 'vendors',
      label: 'Total Invites',
      value: `${totalVendorsInvited} Vendors`,
      hint: `${rfqsWithInvites} RFQs With Invites`,
      tone: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800',
      onClick: onNavigateToVendorConsole,
    },
    {
      key: 'awaiting',
      onClick: () => setSummaryFilterModal('awaiting'),
      label: 'Awaiting Quotes',
      value: `${awaitingQuotes} Active`,
      hint: `${quotesReceived} Received So Far`,
      tone: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Top Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            Operational Monitoring Kanban & Chasing Control
          </h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onNavigateToSpend} className="btn btn-secondary btn-sm shadow-xs border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300">
            <TrendingUp size={14} /> Mode & Performance Analytics <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* Category Manager Top Executive Analytics Summary Strip — every figure derives from the live rfqs collection */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {summaryCards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={card.onClick}
            disabled={!card.onClick}
            className="glass-panel p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs flex flex-col justify-between text-left transition-colors enabled:hover:border-indigo-300 dark:enabled:hover:border-indigo-700 enabled:cursor-pointer disabled:cursor-default"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">{card.label}</span>
            <div className="flex items-baseline justify-between mt-1 gap-2">
              <span className="text-xl font-black text-slate-900 dark:text-white mono">{card.value}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${card.tone}`}>{card.hint}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Global Overrides Toolbar */}
      <div className="p-3.5 rounded-xl glass-panel flex flex-wrap items-center justify-between gap-3 text-xs border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800 dark:text-gray-300 uppercase tracking-wider text-[11px]">GLOBAL OVERRIDES:</span>
          <span className="text-slate-300 dark:text-gray-500 hidden sm:inline">|</span>
          <span className="text-[11px] text-slate-500 dark:text-gray-400 hidden sm:inline">Managerial bypass & multi-vendor actions</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSurveyModalOpen(true)}
            className="btn btn-secondary btn-sm border-purple-300 dark:border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 font-semibold"
          >
            <Sliders size={13} /> Conduct Mode 3 Vendor Survey
          </button>
          <button
            onClick={() => {
              addAuditLog('Category Manager manually adjusted AI Quality Match Threshold to 80%');
              showToast('AI Threshold Updated', 'AI Quality Score threshold lowered from 85% to 80%.', 'info');
            }}
            className="btn btn-secondary btn-sm font-semibold"
          >
            ⚙️ Override AI Score
          </button>
          <button
            onClick={handleBatchFollowUp}
            className="btn btn-emerald btn-sm font-semibold shadow-xs"
          >
            <Zap size={13} /> Batch Multi-Channel Chaser ({col2_pending.length})
          </button>
        </div>
      </div>

      {/* 3-Column Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Column 1: Ingested / Parsing */}
        <div className="glass-panel p-4 rounded-2xl flex flex-col space-y-3 border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-gray-900/60">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200">
                Ingested / Parsing ({col1_parsing.length})
              </h2>
            </div>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono font-bold">OCR Stage</span>
          </div>

          <div className="space-y-3 flex-1">
            {col1_parsing.length === 0 && (
              <div className="text-center py-8 text-slate-400 dark:text-gray-600 text-[11px]">
                No RFQs currently at the OCR/parsing stage.
              </div>
            )}
            {col1_parsing.map((rfq) => {
              const confidence = avgConfidence(rfq);
              const items = rfq.extractedEntities || [];
              // Rows the extractor could not place. This is what the category
              // manager is being asked to resolve, so it is stated on the card
              // rather than only discoverable after opening the RFQ.
              const needsCategoryReview = items.filter(
                (item) => !item.majorCategory || !item.minorCategory
              ).length;
              const majors = Array.from(
                new Set(items.map((item) => item.majorCategory).filter(Boolean))
              );
              const minors = Array.from(
                new Set(items.map((item) => item.minorCategory).filter(Boolean))
              );
              return (
                <div
                  key={rfq.id}
                  data-testid={`parsing-card-${rfq.rfqNumber}`}
                  className="p-3.5 rounded-xl bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 transition-all text-xs space-y-2 shadow-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 dark:text-white mono">{rfq.rfqNumber}</span>
                    {modeBadge(rfq.sourcingMode)}
                  </div>
                  <p className="text-slate-700 dark:text-gray-300 text-[11px] truncate" title={rfq.title}>
                    {rfq.title}
                  </p>

                  {/* Where it came from. An autonomously ingested RFQ has had no
                      human involvement yet, which changes how it should be read. */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                        rfq.source === 'email_gateway'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                          : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300'
                      }`}
                    >
                      {KANBAN.sourceLabels[rfq.source || 'web_portal'] || rfq.source}
                    </span>
                    {needsCategoryReview > 0 && (
                      <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                        {formatString(KANBAN.needsCategoryReview, { count: needsCategoryReview })}
                      </span>
                    )}
                  </div>

                  <div className="p-2 rounded bg-slate-50 dark:bg-gray-950 text-[10px] text-slate-600 dark:text-gray-400 space-y-1 border border-slate-100 dark:border-transparent">
                    <div className="flex justify-between gap-2">
                      <span>{KANBAN.buyerLabel}:</span>
                      <span className="text-slate-900 dark:text-gray-200 font-medium truncate">
                        {rfq.buyerAccountName || rfq.sourceEmail || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>{KANBAN.majorCategoryLabel}:</span>
                      <span className="text-slate-900 dark:text-gray-200 font-medium truncate">
                        {majors.length > 0 ? majors.join(', ') : rfq.category || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>{KANBAN.minorCategoryLabel}:</span>
                      <span className="text-slate-900 dark:text-gray-200 font-medium truncate">
                        {minors.length > 0 ? minors.join(', ') : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>{KANBAN.itemsLabel}:</span>
                      <span className="text-slate-900 dark:text-gray-200 font-medium">{items.length}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>{KANBAN.receivedLabel}:</span>
                      <span className="text-slate-900 dark:text-gray-200 font-medium">
                        {rfq.createdAt ? formatIndianDateTime(rfq.createdAt) : '—'}
                      </span>
                    </div>
                    {confidence !== null && (
                      <div className="flex justify-between">
                        <span>{KANBAN.confidenceLabel}:</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">{confidence}%</span>
                      </div>
                    )}
                  </div>

                  {/* Review reuses the existing RFQ edit dialog, which already
                      edits per-row major/minor category. Releasing to vendors is
                      deliberately not offered yet — it is the next phase. */}
                  <button
                    type="button"
                    onClick={() => setRfqUnderReview(rfq)}
                    className="btn btn-secondary btn-xs w-full font-bold flex items-center justify-center gap-1.5"
                  >
                    <Sparkles size={12} /> {KANBAN.reviewAction}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Quotes Pending / AI Follow-up */}
        <div className="glass-panel p-4 rounded-2xl flex flex-col space-y-3 border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-gray-900/60 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-sky-500" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200">
                Quotes Pending / AI Follow-up ({col2_pending.length})
              </h2>
            </div>
            <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-mono font-bold">Multi-Channel Active</span>
          </div>

          <div className="space-y-3 flex-1">
            {col2_pending.length === 0 && (
              <div className="text-center py-8 text-slate-400 dark:text-gray-600 text-[11px]">
                No RFQs currently awaiting vendor quotes.
              </div>
            )}
            {col2_pending.map((rfq) => (
              <div
                key={rfq.id}
                className="p-3.5 rounded-xl bg-white dark:bg-gray-900/90 border border-indigo-200 dark:border-indigo-500/30 hover:border-indigo-400 dark:hover:border-indigo-500/60 transition-all text-xs space-y-3 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white mono">{rfq.rfqNumber}</span>
                  {rfq.chasingActive ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 flex items-center gap-1">
                      <span className="live-dot" /> Multi-Channel: Active
                    </span>
                  ) : (
                    <span className="badge badge-amber text-[10px]">Chasing Paused</span>
                  )}
                </div>
                <p className="text-slate-700 dark:text-gray-300 text-[11px] truncate">{rfq.title}</p>

                {rfq.followUpData && (
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-gray-950 border border-slate-100 dark:border-gray-800/80 space-y-1.5 text-[10px]">
                    <div className="flex justify-between items-center text-purple-700 dark:text-purple-300 font-semibold">
                      <span>📞 Voice Calls:</span>
                      <span className="mono">{rfq.followUpData.callStats.connected}/{rfq.followUpData.callStats.total} Connected</span>
                    </div>
                    <div className="flex justify-between items-center text-emerald-700 dark:text-emerald-300 font-semibold">
                      <span>💬 WhatsApp Bot:</span>
                      <span className="mono">{rfq.followUpData.whatsappStats.read}/{rfq.followUpData.whatsappStats.total} Read</span>
                    </div>
                    <div className="flex justify-between items-center text-sky-700 dark:text-cyan-300 font-semibold">
                      <span>📱 SMS Direct:</span>
                      <span className="mono">{rfq.followUpData.smsStats.delivered}/{rfq.followUpData.smsStats.total} Delivered</span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-1 pt-1 flex-wrap">
                  <button
                    onClick={() => handleOpenChaser(rfq, 'call')}
                    className="px-2 py-1 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 font-semibold text-[10px] flex items-center gap-1"
                  >
                    <span>📞</span> Call
                  </button>
                  <button
                    onClick={() => handleOpenChaser(rfq, 'whatsapp')}
                    className="px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 font-semibold text-[10px] flex items-center gap-1"
                  >
                    <MessageSquare size={10} /> WA
                  </button>
                  <button
                    onClick={() => handleOpenChaser(rfq, 'sms')}
                    className="px-2 py-1 rounded bg-sky-50 dark:bg-cyan-950/60 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-800 hover:bg-sky-100 font-semibold text-[10px] flex items-center gap-1"
                  >
                    <span>📱</span> SMS
                  </button>
                  <button
                    onClick={() => handleOpenChaser(rfq, 'email')}
                    className="px-2 py-1 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 font-semibold text-[10px] flex items-center gap-1"
                  >
                    <span>✉️</span> 24h Email
                  </button>
                  <button
                    onClick={() => openRFQDeepDive(rfq)}
                    className="btn btn-secondary btn-sm text-[10px] px-2 ml-auto"
                  >
                    <Search size={10} /> Deep Dive
                  </button>
                </div>

                <button
                  onClick={() => handleEscalateToBuyer(rfq.rfqNumber)}
                  className="btn btn-secondary btn-sm w-full text-rose-600 dark:text-rose-300 hover:text-rose-700 border-rose-300 dark:border-rose-500/30 font-semibold"
                >
                  <AlertTriangle size={12} /> Escalate to Buyer
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: AI Evaluation & Scored */}
        <div className="glass-panel p-4 rounded-2xl flex flex-col space-y-3 border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-gray-900/60">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200">
                AI Evaluation & Scored ({col3_scored.length})
              </h2>
            </div>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-bold">Ready for PO</span>
          </div>

          <div className="space-y-3 flex-1">
            {col3_scored.length === 0 && (
              <div className="text-center py-8 text-slate-400 dark:text-gray-600 text-[11px]">
                No RFQs currently in evaluation or scored.
              </div>
            )}
            {col3_scored.map((rfq) => {
              const hasQuotes = rfq.quotesCount > 0;
              return (
                <div
                  key={rfq.id}
                  className={`p-3.5 rounded-xl bg-white dark:bg-gray-900/90 border transition-all text-xs space-y-3 shadow-xs ${
                    hasQuotes
                      ? 'border-emerald-200 dark:border-emerald-500/40 hover:border-emerald-400 dark:hover:border-emerald-500/70'
                      : 'border-slate-200 dark:border-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white mono">{rfq.rfqNumber}</span>
                    <span className={`badge ${SCORED_STATUS_TONE[rfq.status]} text-[10px]`}>{rfq.status}</span>
                  </div>
                  <p className="text-slate-700 dark:text-gray-300 text-[11px] truncate">
                    {rfq.title}
                    {typeof rfq.aiScore === 'number' && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold"> • {rfq.aiScore}% AI Match</span>
                    )}
                  </p>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400">
                    {rfq.quotesCount} quote{rfq.quotesCount === 1 ? '' : 's'} evaluated
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => handleApproveReport(rfq)}
                      className="btn btn-secondary btn-sm text-[11px] font-semibold"
                    >
                      <FileCheck size={12} /> Approve Report
                    </button>
                    <button
                      onClick={() => handleShareReport(rfq)}
                      className="btn btn-primary btn-sm text-[11px] font-semibold"
                    >
                      <Share2 size={12} /> Share Report
                    </button>
                  </div>

                  {hasQuotes && (
                    <button
                      onClick={() => handleViewMatrix(rfq)}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-950/70 transition-all group"
                    >
                      <span>View Comparative Quote Matrix</span>
                      <ChevronRight size={13} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Multi-Channel Chaser Modal */}
      {/* Category review for an ingested RFQ. Same dialog the buyer uses, so the
          line items and their major/minor categories are edited in one place. It
          saves through PUT /api/rfqs/:id and does not change the RFQ's status, so
          reviewing does not release anything to vendors. */}
      <RFQEditModal
        rfq={rfqUnderReview}
        onClose={() => setRfqUnderReview(null)}
        onSave={updateRFQ}
      />

      <MultiChannelChaserModal
        isOpen={chaserModalOpen}
        onClose={() => setChaserModalOpen(false)}
        rfqNumber={selectedRfqForChaser}
        vendorName={targetVendor}
        initialChannel={chaserInitialChannel}
      />

      {/* Mode 3 Survey Modal */}
      <VendorSurveyModal
        isOpen={surveyModalOpen}
        onClose={() => setSurveyModalOpen(false)}
      />

      {/* RFQ Multi-Channel Follow-Up Deep Dive Modal */}
      <RFQFollowUpDeepDiveModal
        isOpen={deepDiveModalOpen}
        onClose={() => setDeepDiveModalOpen(false)}
        rfq={selectedRFQForDeepDive}
      />

      {/* In-Page Summary Category Filter Modal */}
      {summaryFilterModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                  <FileText size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {summaryFilterModal === 'pipeline' && 'RFQs In Pipeline'}
                    {summaryFilterModal === 'quotes' && 'Quotes Received'}
                    {summaryFilterModal === 'awaiting' && 'Awaiting Quotes'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Live Operational Overview &amp; Tracking
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSummaryFilterModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
              {(() => {
                const filteredList =
                  summaryFilterModal === 'pipeline'
                    ? rfqs
                    : summaryFilterModal === 'quotes'
                    ? rfqs.filter((r) => (r.quotesCount || 0) > 0)
                    : rfqs.filter((r) => (r.quotesCount || 0) === 0);

                if (filteredList.length === 0) {
                  return (
                    <div className="text-center py-12 text-slate-400 dark:text-gray-500 space-y-2">
                      <p className="text-sm font-medium">No RFQs found matching this criteria.</p>
                      <p className="text-xs">Try selecting a different category or adjusting the search filter.</p>
                    </div>
                  );
                }

                return (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="px-4 py-2.5">RFQ Number</th>
                          <th className="px-4 py-2.5">Title &amp; Category</th>
                          <th className="px-4 py-2.5">Delivery PIN</th>
                          <th className="px-4 py-2.5 text-center">Quotes</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {filteredList.map((rfq) => (
                          <tr key={rfq.id || rfq.rfqNumber} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                            <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {rfq.rfqNumber}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-800 dark:text-gray-200">{rfq.title}</div>
                              <div className="text-[10px] text-slate-400">{rfq.category || 'General'} • {rfq.sourcingMode?.toUpperCase()}</div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-gray-300">
                              {rfq.deliveryPincode ? `PIN: ${rfq.deliveryPincode}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-center whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                (rfq.quotesCount || 0) > 0
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                              }`}>
                                {rfq.quotesCount || 0} Quote{(rfq.quotesCount || 0) === 1 ? '' : 's'}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="badge badge-indigo text-[10px] font-semibold">{rfq.status}</span>
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <button
                                onClick={() => {
                                  setSummaryFilterModal(null);
                                  if (onNavigateToMatrix && (rfq.quotesCount || 0) > 0) {
                                    onNavigateToMatrix(rfq);
                                  } else {
                                    setRfqUnderReview(rfq);
                                  }
                                }}
                                className="btn btn-primary btn-xs py-1 px-2.5 text-[10px] font-bold inline-flex items-center gap-1"
                              >
                                <span>{(rfq.quotesCount || 0) > 0 ? 'Matrix' : 'Review'}</span>
                                <ChevronRight size={10} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end">
              <button
                onClick={() => setSummaryFilterModal(null)}
                className="btn btn-secondary text-xs px-4 py-1.5 font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
