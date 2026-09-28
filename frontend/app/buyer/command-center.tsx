'use client';

import React, { useState, useMemo } from 'react';
import { useApp } from '@/lib/store';
import { SOURCING_MODES } from '@/lib/constants';
import { RFQItem } from '@/lib/types';
import {
  RFQFollowUpDeepDiveModal,
  MultiChannelChaserModal,
  ActivePipelineModal,
  IntakeSourcesModal,
  SupplierQuotesModal,
} from '@/app/components/Modals';
import {
  TrendingUp,
  FileText,
  Clock,
  Plus,
  UploadCloud,
  Sparkles,
  Bot,
  Layers,
  ChevronRight,
  Search,
  MessageSquare,
  Phone,
  Smartphone,
  Mail,
  FileSpreadsheet,
} from 'lucide-react';

interface CommandCenterProps {
  onNavigateToWizard: () => void;
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onNavigateToSubscription?: () => void;
  onNavigateToDirectory?: () => void;
}

export default function CommandCenter({ onNavigateToWizard, onNavigateToMatrix, onNavigateToSubscription, onNavigateToDirectory }: CommandCenterProps) {
  const {
    rfqs: allRfqs,
    aiFeed,
    currentMode,
    setSelectedRFQForMatrix,
    showToast,
    selectedRFQForDeepDive,
    setSelectedRFQForDeepDive,
    deepDiveModalOpen,
    setDeepDiveModalOpen,
    openRFQDeepDive,
    remainingFreeRFQs,
    activeSubscription,
    activeBuyerAccount,
    setInitialSetupModalOpen,
    initialSetupCompleted,
  } = useApp();

  const [feedChannelFilter, setFeedChannelFilter] = useState<'all' | 'call' | 'whatsapp' | 'sms' | 'email' | 'system'>('all');
  const [quickChaserModalOpen, setQuickChaserModalOpen] = useState(false);
  const [quickChaserData, setQuickChaserData] = useState<{ rfqNumber: string; vendorName: string }>({
    rfqNumber: '',
    vendorName: '',
  });
  const [rfqSourceFilter, setRfqSourceFilter] = useState<'all' | 'email_gateway' | 'web_portal' | 'manual_entry'>('all');
  const [activePipelineModalOpen, setActivePipelineModalOpen] = useState(false);
  const [intakeSourcesModalOpen, setIntakeSourcesModalOpen] = useState(false);
  const [supplierQuotesModalOpen, setSupplierQuotesModalOpen] = useState(false);

  // GET /api/rfqs is itself scoped to the signed-in buyer's own account now
  // (server-side, via the same buyer_accounts record RFQs are stamped with —
  // see rfqController.js's resolveRfqReadScope), so allRfqs already contains
  // only this buyer's own RFQs. Re-filtering here by activeBuyerAccount.id
  // was comparing against the wrong identity system: activeBuyerAccount
  // resolves from the shared MySQL identity schema's organizationId, a
  // different id space than buyer_accounts' Neon-generated id that
  // r.buyerAccountId actually holds — the two never matched, silently
  // zeroing out a real, correctly-scoped list.
  const rfqs = allRfqs;

  const totalActiveRFQs = rfqs.length;
  const totalPendingQuotes = rfqs.reduce((acc, r) => acc + (r.quotesCount || (r.quotes ? r.quotes.length : 0)), 0);
  const inEvaluationCount = rfqs.filter((r) => r.status === 'In Evaluation').length;

  // Intake Source Counts
  const emailGatewayRFQs = rfqs.filter(r => r.source === 'email_gateway');
  const webPortalRFQs = rfqs.filter(r => r.source === 'web_portal' || !r.source);
  const manualRFQs = rfqs.filter(r => r.source === 'manual_entry');

  // Multi-channel totals calculation
  const totalCalls = rfqs.reduce((acc, r) => acc + (r.followUpData?.callStats.total || 0), 0);
  const connectedCalls = rfqs.reduce((acc, r) => acc + (r.followUpData?.callStats.connected || 0), 0);
  const totalWhatsApp = rfqs.reduce((acc, r) => acc + (r.followUpData?.whatsappStats.total || 0), 0);
  const readWhatsApp = rfqs.reduce((acc, r) => acc + (r.followUpData?.whatsappStats.read || 0), 0);
  const totalSMS = rfqs.reduce((acc, r) => acc + (r.followUpData?.smsStats.total || 0), 0);
  const totalFollowupsToday = totalCalls + totalWhatsApp + totalSMS;

  const getSourceBadge = (source?: string, autoCirculated?: boolean) => {
    if (source === 'email_gateway') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1 shrink-0">
          <Mail size={10} className="text-amber-600 dark:text-amber-400" />
          <span>Email Gateway (Autonomous)</span>
        </span>
      );
    }
    if (source === 'manual_entry') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 shrink-0">
          <FileSpreadsheet size={10} className="text-emerald-600 dark:text-emerald-400" />
          <span>Manual RFQ</span>
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 shrink-0">
        <UploadCloud size={10} className="text-indigo-600 dark:text-indigo-400" />
        <span>AI RFQ Create</span>
      </span>
    );
  };

  const filteredRFQs = rfqs.filter((rfq) => {
    if (rfqSourceFilter === 'all') return true;
    if (rfqSourceFilter === 'web_portal') return rfq.source === 'web_portal' || !rfq.source;
    if (rfqSourceFilter === 'manual_entry') return rfq.source === 'manual_entry';
    return rfq.source === rfqSourceFilter;
  });

  const getModeBadge = (modeId: string) => {
    const mode = SOURCING_MODES.find((m) => m.id === modeId);
    if (!mode) return null;
    return (
      <span
        className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide"
        style={{
          backgroundColor: `${mode.badgeColor}15`,
          color: mode.badgeColor,
          border: `1px solid ${mode.badgeColor}35`,
        }}
      >
        {mode.code}
      </span>
    );
  };

  const getStatusBadge = (status: RFQItem['status']) => {
    switch (status) {
      case 'AI Recommended':
        return <span className="badge badge-emerald">AI Recommended</span>;
      case 'In Evaluation':
        return <span className="badge badge-blue">In Evaluation</span>;
      case 'PO Generated':
        return <span className="badge badge-purple">PO Generated</span>;
      case 'Parsing':
        return <span className="badge badge-amber">OCR Parsing</span>;
      default:
        return <span className="badge badge-blue">{status}</span>;
    }
  };

  const buyerScopedFeed = useMemo(() => {
    const feed = aiFeed || [];
    return feed.filter((item) => {
      if (activeBuyerAccount?.id && item.buyerAccountId && item.buyerAccountId !== activeBuyerAccount.id) {
        return false;
      }
      return true;
    });
  }, [aiFeed, activeBuyerAccount]);

  const filteredFeed = buyerScopedFeed.filter((item) => {
    if (feedChannelFilter === 'all') return true;
    if (feedChannelFilter === 'call') return item.type === 'call' || item.channel === 'call';
    if (feedChannelFilter === 'whatsapp') return item.type === 'whatsapp' || item.channel === 'whatsapp';
    if (feedChannelFilter === 'sms') return item.type === 'sms' || item.channel === 'sms';
    if (feedChannelFilter === 'email') return item.type === 'email' || item.channel === 'email';
    if (feedChannelFilter === 'system') return item.type === 'scoring' || item.type === 'ingestion' || item.type === 'escalation' || item.type === 'approval';
    return true;
  });

  const channelFilterTabs = [
    { key: 'all' as const, label: `All (${buyerScopedFeed.length})`, activeClass: 'bg-slate-800 dark:bg-white text-white dark:text-slate-900' },
    { key: 'call' as const, label: 'Calls', icon: <Phone size={11} />, activeClass: 'bg-purple-600 text-white' },
    { key: 'whatsapp' as const, label: 'WA', icon: <MessageSquare size={11} />, activeClass: 'bg-emerald-600 text-white' },
    { key: 'sms' as const, label: 'SMS', icon: <Smartphone size={11} />, activeClass: 'bg-sky-600 text-white' },
    { key: 'email' as const, label: 'Email (24h)', icon: <Mail size={11} />, activeClass: 'bg-amber-600 text-white' },
    { key: 'system' as const, label: 'System', activeClass: 'bg-indigo-600 text-white' },
  ];

  return (
    <div className="space-y-5 animate-fade-in pb-10">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
            <span>Enterprise Sourcing Dashboard</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setInitialSetupModalOpen(true)}
            className={`btn btn-sm font-bold flex items-center gap-1.5 shadow-sm transition-all ${
              initialSetupCompleted
                ? 'btn-secondary text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30'
                : 'btn-secondary text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 bg-indigo-50/70 dark:bg-indigo-950/40 animate-pulse'
            }`}
            title="Upload 1-3 Year Purchase Orders to extract approved vendors, contact details & categorize into 1st/2nd sets"
          >
            <FileSpreadsheet size={13} className={initialSetupCompleted ? 'text-emerald-600' : 'text-indigo-600'} />
            <span>{initialSetupCompleted ? '✓ PO History Ingested' : '⚡ 1-3 Yr Purchase Setup'}</span>
          </button>

          <button onClick={onNavigateToWizard} className="btn btn-primary btn-sm font-bold shadow-md">
            <Plus size={14} /> AI RFQ Generator
          </button>
        </div>
      </div>

      {/* Subscription Quota Banner */}
      <div className="glass-panel p-4 rounded-2xl border border-indigo-200/40 dark:border-indigo-950/40 bg-gradient-to-r from-indigo-50/50 via-purple-50/40 to-amber-50/50 dark:from-indigo-950/20 dark:via-purple-950/20 dark:to-amber-950/20 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/10 dark:bg-indigo-400/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-2 flex-wrap">
              <span>Sourcing Plan: {activeSubscription === 'free_trial' ? 'Free Starter Account (All Versions Unlocked)' : activeSubscription === 'version_1' ? 'Version 1 (Client Roster Plan)' : activeSubscription === 'version_2' ? 'Version 2 (Hybrid Sourcing Plan)' : 'Version 3 (AI Autonomous Sourcing Plan)'}</span>
              {activeSubscription === 'free_trial' && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-300">
                    Total: 5
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300">
                    Used: {Math.max(0, 5 - remainingFreeRFQs)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300">
                    Remaining: {remainingFreeRFQs}
                  </span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">
              {activeSubscription === 'free_trial' 
                ? 'Your Free Account includes 5 Free RFQs in total, shared across Version 1 (Client Roster), Version 2 (Hybrid), and Version 3 (Autonomous AI).' 
                : 'Your premium sourcing plan is active. All dispatch features for this mode are fully unlocked.'}
            </p>
          </div>
        </div>
        {onNavigateToSubscription && (
          <button
            onClick={onNavigateToSubscription}
            className="btn btn-primary btn-xs flex items-center gap-1 shrink-0 font-bold"
          >
            Manage Subscription <ChevronRight size={10} />
          </button>
        )}
      </div>

      {/* ── KPI Cards (4 Column Grid with RFQ Intake Source Breakdown) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active RFQs */}
        <div
          onClick={() => setActivePipelineModalOpen(true)}
          className="rounded-2xl p-4 bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 relative overflow-hidden hover:border-indigo-400 dark:hover:border-indigo-500 cursor-pointer transition-all shadow-xs flex flex-col justify-between min-h-[124px] group"
          title="Click to view Active Pipeline details"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Active Pipeline</span>
            <div className="flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">
              <FileText size={16} />
              <ChevronRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mono">{totalActiveRFQs}</span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                {totalActiveRFQs > 0 ? '100% On Schedule' : 'No Active RFQs'}
              </span>
            </div>
          </div>
          <span className="text-[10px] text-slate-400">Total live requisitions across modes</span>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-cyan-500" />
        </div>

        {/* Requisitions by Intake Source */}
        <div
          onClick={() => setIntakeSourcesModalOpen(true)}
          className="rounded-2xl p-4 bg-white dark:bg-gray-900/80 border border-amber-200 dark:border-amber-900/50 relative overflow-hidden hover:border-amber-400 dark:hover:border-amber-500 cursor-pointer transition-all shadow-xs flex flex-col justify-between min-h-[124px] group"
          title="Click to view Intake Sources breakdown"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Intake Sources</span>
            <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
              <div className="p-1 rounded bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
                <Mail size={14} />
              </div>
              <ChevronRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
          <div className="space-y-1 my-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-600 dark:text-gray-400 flex items-center gap-1 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> 📧 Email Gateway:
              </span>
              <span className="font-bold text-amber-700 dark:text-amber-300 font-mono">
                {emailGatewayRFQs.length} ({totalActiveRFQs > 0 ? Math.round((emailGatewayRFQs.length / totalActiveRFQs) * 100) : 0}%)
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-600 dark:text-gray-400 flex items-center gap-1 font-medium">
                <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" /> 🌐 AI RFQ Create:
              </span>
              <span className="font-bold text-indigo-700 dark:text-indigo-300 font-mono">
                {webPortalRFQs.length} ({totalActiveRFQs > 0 ? Math.round((webPortalRFQs.length / totalActiveRFQs) * 100) : 0}%)
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-600 dark:text-gray-400 flex items-center gap-1 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> ✏️ Manual RFQ:
              </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-300 font-mono">
                {manualRFQs.length} ({totalActiveRFQs > 0 ? Math.round((manualRFQs.length / totalActiveRFQs) * 100) : 0}%)
              </span>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-indigo-500 to-emerald-500" />
        </div>

        {/* Pending Quotes */}
        <div
          onClick={() => setSupplierQuotesModalOpen(true)}
          className="rounded-2xl p-4 bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 relative overflow-hidden hover:border-sky-400 dark:hover:border-sky-500 cursor-pointer transition-all shadow-xs flex flex-col justify-between min-h-[124px] group"
          title="Click to view Supplier Quotes"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 group-hover:text-sky-600 dark:group-hover:text-cyan-400 transition-colors">Supplier Quotes</span>
            <div className="flex items-center gap-1 text-[10px] text-sky-600 dark:text-cyan-400 font-bold">
              <Clock size={16} />
              <ChevronRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mono">{totalPendingQuotes}</span>
              <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-bold bg-sky-50 dark:bg-cyan-950/60 px-1.5 py-0.5 rounded-full border border-sky-200 dark:border-cyan-800">
                {inEvaluationCount} in evaluation
              </span>
            </div>
          </div>
          <span className="text-[10px] text-slate-400">Total quotes received across active RFQs</span>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
        </div>

        {/* Follow Ups Today */}
        <div
          onClick={() => {
            if (rfqs.length > 0) {
              openRFQDeepDive(rfqs[0]);
            } else {
              showToast('No Active RFQs', 'Create or ingest an RFQ to view multi-channel follow-up telemetry.', 'info');
            }
          }}
          className="rounded-2xl p-4 bg-white dark:bg-gray-900/80 border border-emerald-200 dark:border-emerald-500/30 relative overflow-hidden hover:border-emerald-400 dark:hover:border-emerald-400 cursor-pointer transition-all shadow-xs flex flex-col justify-between min-h-[124px]"
          title="Click to open multi-channel deep dive"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Live Outreach</span>
              <span className="live-dot" style={{ width: 6, height: 6 }} />
            </div>
            <div className="flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
              <span>Deep Dive</span>
              <ChevronRight size={11} />
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mono">{totalFollowupsToday}</span>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                📞 {totalCalls}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                💬 {totalWhatsApp}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-50 dark:bg-cyan-950/60 text-sky-600 dark:text-cyan-300 border border-sky-200 dark:border-cyan-800">
                📱 {totalSMS}
              </span>
            </div>
          </div>
          <span className="text-[10px] text-slate-400">Automated multi-channel outreach</span>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-emerald-500 to-amber-500" />
        </div>
      </div>

      {/* ── Main Grid: Pipeline + Vendor Follow Up Status ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* ── Left: Pipeline Table (3 cols) ── */}
        <div className="lg:col-span-3 rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
          {/* Table Header & Intake Source Filter Tabs */}
          <div className="p-4 border-b border-slate-100 dark:border-gray-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-indigo-600 dark:text-indigo-400" />
                <h2 className="text-sm font-bold text-slate-800 dark:text-gray-200">Active Procurement Pipeline</h2>
              </div>
              <span className="text-[10px] font-mono text-slate-400 dark:text-gray-500">{filteredRFQs.length} shown</span>
            </div>

            {/* Source Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
              <button
                onClick={() => setRfqSourceFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 ${
                  rfqSourceFilter === 'all'
                    ? 'bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-xs'
                    : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-200'
                }`}
              >
                All Sources ({rfqs.length})
              </button>
              <button
                onClick={() => setRfqSourceFilter('email_gateway')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 flex items-center gap-1 ${
                  rfqSourceFilter === 'email_gateway'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40 hover:bg-amber-100'
                }`}
              >
                <Mail size={11} /> 📧 Email Gateway ({emailGatewayRFQs.length})
              </button>
              <button
                onClick={() => setRfqSourceFilter('web_portal')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 flex items-center gap-1 ${
                  rfqSourceFilter === 'web_portal'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/40 hover:bg-indigo-100'
                }`}
              >
                <UploadCloud size={11} /> 🌐 AI RFQ Create ({webPortalRFQs.length})
              </button>
              <button
                onClick={() => setRfqSourceFilter('manual_entry')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 flex items-center gap-1 ${
                  rfqSourceFilter === 'manual_entry'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40 hover:bg-emerald-100'
                }`}
              >
                <FileSpreadsheet size={11} /> ✏️ Manual RFQ ({manualRFQs.length})
              </button>
            </div>
          </div>

          {/* Pipeline Cards */}
          <div className="divide-y divide-slate-100 dark:divide-gray-800/60 overflow-y-auto max-h-[520px]">
            {filteredRFQs.length === 0 ? (
              <div className="p-10 text-center text-slate-400 dark:text-gray-500">
                <FileText size={32} className="mx-auto mb-2 opacity-40 text-indigo-500" />
                <p className="text-xs font-semibold text-slate-600 dark:text-gray-400">No active requisitions found</p>
                <p className="text-[11px] mt-1 text-slate-400">Click &quot;Create / Ingest RFQ&quot; or upload a BOQ to start your procurement pipeline.</p>
              </div>
            ) : (
              filteredRFQs.map((rfq) => (
                <div
                  key={rfq.id}
                  className="p-4 hover:bg-slate-50/80 dark:hover:bg-gray-800/30 transition-colors cursor-pointer group space-y-2"
                  onClick={() => openRFQDeepDive(rfq)}
                >
                  {/* Row 1: RFQ Number + Source Badge + Status + Actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900 dark:text-white mono group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                        {rfq.rfqNumber}
                      </span>
                      {getSourceBadge(rfq.source, rfq.autoCirculated)}
                      {getModeBadge(rfq.sourcingMode)}
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(rfq.status)}
                      {rfq.status === 'AI Recommended' ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRFQForMatrix(rfq);
                            onNavigateToMatrix(rfq);
                          }}
                          className="btn btn-emerald text-[10px] px-2 py-1"
                          style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px' }}
                        >
                          <Sparkles size={10} /> Matrix
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openRFQDeepDive(rfq);
                          }}
                          className="text-slate-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors p-1"
                        >
                          <ChevronRight size={15} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Title, Category & Origin Metadata */}
                  <div>
                    <p className="text-xs text-slate-800 dark:text-gray-200 font-bold leading-snug">{rfq.title}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">
                      <span>{rfq.category}</span>
                      <span>•</span>
                      {rfq.source === 'email_gateway' ? (
                        <span className="text-amber-600 dark:text-amber-400 font-mono">
                          Origin: {rfq.sourceEmail || activeBuyerAccount?.corporateEmail || 'Email Gateway'} (Auto-Circulated)
                        </span>
                      ) : rfq.source === 'email_upload' ? (
                        <span className="text-purple-600 dark:text-purple-400 font-mono">
                          File: {rfq.sourceFileName || 'Requisition_Email.eml'}
                        </span>
                      ) : (
                        <span className="text-indigo-600 dark:text-indigo-400 font-mono">
                          Intake: {rfq.sourceFileName || 'Web Portal Ingest'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Row 3: Channel stats + Quotes */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100/80 dark:border-gray-800/40">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {rfq.followUpData ? (
                        <>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-300 border border-purple-100 dark:border-purple-800">
                            📞 {rfq.followUpData.callStats.connected}/{rfq.followUpData.callStats.total}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800">
                            💬 {rfq.followUpData.whatsappStats.read}/{rfq.followUpData.whatsappStats.total}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-sky-50 dark:bg-cyan-950/50 text-sky-600 dark:text-cyan-300 border border-sky-100 dark:border-cyan-800">
                            📱 {rfq.followUpData.smsStats.delivered}
                          </span>
                          <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-medium ml-1">
                            {rfq.followUpData.respondedCount}/{rfq.followUpData.totalInvited} responded
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-slate-300 dark:text-gray-600 italic">Queued</span>
                      )}
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 dark:text-gray-300 mono bg-slate-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                      {rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0)} quotes
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right: Vendor Follow Up Status (2 cols) ── */}
        <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <span className="live-dot" style={{ width: 6, height: 6 }} />
              <h2 className="text-sm font-bold text-slate-800 dark:text-gray-200">
                Vendor Follow Up Status
              </h2>
            </div>
            <span className="text-[9px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/20 font-bold">
              Live
            </span>
          </div>

          {/* Channel Filters */}
          <div className="flex items-center gap-1 px-4 py-2.5 border-b border-slate-50 dark:border-gray-800/60 overflow-x-auto">
            {channelFilterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFeedChannelFilter(tab.key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all shrink-0 flex items-center gap-1 ${
                  feedChannelFilter === tab.key
                    ? tab.activeClass
                    : 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Feed Stream */}
          <div className="flex-1 overflow-y-auto max-h-[480px] px-3 py-2 space-y-2">
            {filteredFeed.length === 0 ? (
              <div className="p-8 text-center text-slate-400 dark:text-gray-500">
                <Bot size={28} className="mx-auto mb-2 opacity-40 text-indigo-500" />
                <p className="text-xs font-semibold text-slate-600 dark:text-gray-400">No outreach events yet</p>
                <p className="text-[10px] mt-1 text-slate-400">Live multi-channel telemetry (calls, WhatsApp, SMS) will stream here once an RFQ is dispatched.</p>
              </div>
            ) : (
              filteredFeed.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-lg bg-slate-50/80 dark:bg-gray-900/60 border border-slate-100 dark:border-gray-800 hover:border-slate-200 dark:hover:border-gray-700 transition-all group"
                >
                  {/* Title + Timestamp */}
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-[11px] font-bold leading-tight">
                      {item.type === 'call' || item.channel === 'call' ? (
                        <span className="text-purple-600 dark:text-purple-400 flex items-center gap-1">
                          <Phone size={11} /> {item.title}
                        </span>
                      ) : item.type === 'whatsapp' || item.channel === 'whatsapp' ? (
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <MessageSquare size={11} /> {item.title}
                        </span>
                      ) : item.type === 'sms' || item.channel === 'sms' ? (
                        <span className="text-sky-600 dark:text-cyan-400 flex items-center gap-1">
                          <Smartphone size={11} /> {item.title}
                        </span>
                      ) : item.type === 'email' || item.channel === 'email' ? (
                        <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <Mail size={11} /> {item.title}
                        </span>
                      ) : (
                        <span className="text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                          <Sparkles size={11} /> {item.title}
                        </span>
                      )}
                    </span>
                    <span className="mono text-[9px] text-slate-400 dark:text-gray-500 shrink-0">{item.timestamp}</span>
                  </div>

                  {/* Message */}
                  <p className="text-[11px] text-slate-600 dark:text-gray-400 leading-relaxed line-clamp-2">{item.message}</p>

                  {/* Call Duration */}
                  {item.channelDetails?.duration && (
                    <div className="mt-1.5 text-[9px] text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2 py-1 rounded inline-flex items-center gap-1">
                      ⏱️ <span className="font-bold mono">{item.channelDetails.duration}</span> · Transcript logged
                    </div>
                  )}

                  {/* Footer: Target + RFQ link */}
                  <div className="flex items-center justify-between mt-1.5 text-[9px] text-slate-400 dark:text-gray-500">
                    {item.recipient && (
                      <span>
                        Target: <span className="text-slate-600 dark:text-gray-300 font-medium">{item.recipient}</span>
                      </span>
                    )}
                    {item.rfqNumber && (
                      <button
                        onClick={() => {
                          const targetRfq = rfqs.find((r) => r.rfqNumber === item.rfqNumber);
                          if (targetRfq) openRFQDeepDive(targetRfq);
                        }}
                        className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline mono"
                      >
                        {item.rfqNumber} ↗
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-gray-800 text-[10px] text-slate-400 dark:text-gray-500 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <span className="live-dot" style={{ width: 5, height: 5 }} /> Voice, WhatsApp & SMS
            </span>
            <span className="text-indigo-500 dark:text-indigo-400 font-semibold">24/7 Active</span>
          </div>
        </div>
      </div>

      {/* RFQ Follow-Up Multi-Channel Deep Dive Modal */}
      <RFQFollowUpDeepDiveModal
        isOpen={deepDiveModalOpen}
        onClose={() => setDeepDiveModalOpen(false)}
        rfq={selectedRFQForDeepDive}
      />

      {/* Multi-Channel Quick Chaser Modal */}
      <MultiChannelChaserModal
        isOpen={quickChaserModalOpen}
        onClose={() => setQuickChaserModalOpen(false)}
        rfqNumber={quickChaserData.rfqNumber}
        vendorName={quickChaserData.vendorName}
      />

      {/* Active Pipeline Details Modal */}
      <ActivePipelineModal
        isOpen={activePipelineModalOpen}
        onClose={() => setActivePipelineModalOpen(false)}
        rfqs={rfqs}
        onOpenDeepDive={(rfq) => {
          setActivePipelineModalOpen(false);
          openRFQDeepDive(rfq);
        }}
        onNavigateToMatrix={(rfq) => {
          setActivePipelineModalOpen(false);
          setSelectedRFQForMatrix(rfq);
          onNavigateToMatrix(rfq);
        }}
      />

      {/* Intake Sources Breakdown Modal */}
      <IntakeSourcesModal
        isOpen={intakeSourcesModalOpen}
        onClose={() => setIntakeSourcesModalOpen(false)}
        rfqs={rfqs}
        onOpenDeepDive={(rfq) => {
          setIntakeSourcesModalOpen(false);
          openRFQDeepDive(rfq);
        }}
        onNavigateToMatrix={(rfq) => {
          setIntakeSourcesModalOpen(false);
          setSelectedRFQForMatrix(rfq);
          onNavigateToMatrix(rfq);
        }}
      />

      {/* Supplier Quotes Overview Modal */}
      <SupplierQuotesModal
        isOpen={supplierQuotesModalOpen}
        onClose={() => setSupplierQuotesModalOpen(false)}
        rfqs={rfqs}
        onNavigateToMatrix={(rfq) => {
          setSupplierQuotesModalOpen(false);
          setSelectedRFQForMatrix(rfq);
          onNavigateToMatrix(rfq);
        }}
        onOpenDeepDive={(rfq) => {
          setSupplierQuotesModalOpen(false);
          openRFQDeepDive(rfq);
        }}
      />
    </div>
  );
}
