'use client';

import React from 'react';
import { useApp } from '@/lib/store';
import { rfqsInWindow, growthPercentFor, GrowthBadge } from './category-summary-dashboard';
import {
  TrendingUp,
  Clock,
  MessageSquare,
  ShieldCheck,
  PieChart,
  BarChart3,
  ArrowUpRight,
  ArrowLeft,
  Sparkles,
  Zap,
  FileText,
  Download,
  Layers,
  Phone,
  Smartphone,
  Mail,
  CheckCircle2,
  Users,
} from 'lucide-react';

const QUARTER_DAYS = 90;

interface SpendDashboardProps {
  onBackToKanban: () => void;
  onNavigateToAllRfqs?: () => void;
  onNavigateToVendorConsole?: () => void;
  onNavigateToKanban?: () => void;
}

export default function SpendDashboard({
  onBackToKanban,
  onNavigateToAllRfqs,
  onNavigateToVendorConsole,
  onNavigateToKanban,
}: SpendDashboardProps) {
  const { rfqs, auditLogs } = useApp();

  // Real quarter-scoped RFQ count and quarter-over-quarter growth, reusing
  // the same real-data helpers category-summary-dashboard.tsx already
  // established — this card previously showed a hardcoded 48.
  const totalRfqsRaised = rfqsInWindow(rfqs, QUARTER_DAYS, 0).length;
  const rfqGrowth = growthPercentFor(rfqs, QUARTER_DAYS);
  const avgRfqsPerDay = (totalRfqsRaised / QUARTER_DAYS).toFixed(1);

  // Real download count, from the audit-log entries the vendor download
  // actions already write (quotation-form.tsx / opportunity-feed.tsx) —
  // previously a hardcoded 312.
  const totalRfqsDownloaded = auditLogs.filter((l) => /downloaded RFQ specification/.test(l.action)).length;
  const avgDownloadsPerDay = (totalRfqsDownloaded / QUARTER_DAYS).toFixed(1);
  const avgDownloadsPerRfq = totalRfqsRaised > 0 ? (totalRfqsDownloaded / totalRfqsRaised).toFixed(1) : '0.0';

  // Real average vendors invited per RFQ (assignedVendors is the only real
  // "vendors associated with this RFQ" set) — previously a hardcoded 6.5.
  const avgVendorsPerRfq =
    rfqs.length > 0
      ? (rfqs.reduce((sum, r) => sum + (r.assignedVendors?.length || 0), 0) / rfqs.length).toFixed(1)
      : '0.0';

  // Real vendor response rate, mirroring kanban-board.tsx's existing
  // vendorsInvited/vendorsResponded computation from followUpData —
  // previously a hardcoded "92.4%" claiming an unbacked "within 24h" window.
  const vendorsInvited = rfqs.reduce((sum, r) => sum + (r.followUpData?.totalInvited || 0), 0);
  const vendorsResponded = rfqs.reduce((sum, r) => sum + (r.followUpData?.respondedCount || 0), 0);
  const vendorResponseRate = vendorsInvited > 0 ? ((vendorsResponded / vendorsInvited) * 100).toFixed(1) : '0.0';

  const modePerformance = [
    {
      id: 'mode-1',
      modeCode: 'MODE 1',
      title: 'Private Client Roster',
      description: 'Exclusive buyer-uploaded vendor pool. Vendors enjoy unlimited RFQ views & downloads.',
      badgeColor: '#4f46e5', // indigo
      rfqsRaised: 22,
      rfqsDownloaded: 148,
      downloadRatio: '6.7 downloads / RFQ',
      followUpEfficiency: 94.6,
      avgTurnaround: '3.6 Days',
      primaryChaser: 'Voice Bot Call (88%) + WA (96%)',
      conversionRate: 94.6,
    },
    {
      id: 'mode-2',
      modeCode: 'MODE 2',
      title: 'Hybrid Base Network',
      description: 'Hybrid sourcing combining client roster with pre-vetted marketplace suppliers.',
      badgeColor: '#0284c7', // sky
      rfqsRaised: 16,
      rfqsDownloaded: 104,
      downloadRatio: '6.5 downloads / RFQ',
      followUpEfficiency: 91.2,
      avgTurnaround: '4.4 Days',
      primaryChaser: 'WhatsApp (94%) + 24h Email (82%)',
      conversionRate: 91.2,
    },
    {
      id: 'mode-3',
      modeCode: 'MODE 3',
      title: '360° AI Evaluated Roster',
      description: 'Open network marketplace with autonomous OCR extraction & multi-tier scoring.',
      badgeColor: '#9333ea', // purple
      rfqsRaised: 10,
      rfqsDownloaded: 60,
      downloadRatio: '6.0 downloads / RFQ',
      followUpEfficiency: 88.5,
      avgTurnaround: '4.8 Days',
      primaryChaser: 'SMS (84%) + 24h Email Reminder (89%)',
      conversionRate: 88.5,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Back button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <button
            onClick={onBackToKanban}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white mb-2 transition-colors font-medium"
          >
            <ArrowLeft size={14} /> Back to Operational Monitoring Kanban
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Mode Performance & RFQ Analytics Dashboard
            </h1>
          </div>
        </div>
      </div>

      {/* Top KPI Metric Cards (Non-Spend) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* RFQs Received */}
        <button
          type="button"
          onClick={onNavigateToAllRfqs}
          disabled={!onNavigateToAllRfqs}
          className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col justify-between min-h-[115px] text-left transition-colors enabled:hover:border-indigo-300 dark:enabled:hover:border-indigo-700 enabled:cursor-pointer disabled:cursor-default"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-xs font-bold uppercase">
            <span>RFQs Received (Raised)</span>
            <FileText size={16} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-3xl font-extrabold text-slate-900 dark:text-white mono">{totalRfqsRaised}</p>
            <span className="text-[11px] text-indigo-700 dark:text-indigo-300 font-extrabold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
              Avg {avgRfqsPerDay} / day
            </span>
          </div>
          <div className="mt-1 text-[11px] font-semibold">
            <GrowthBadge value={rfqGrowth} /> <span className="text-slate-500 dark:text-gray-400">vs previous quarter</span>
          </div>
        </button>

        {/* RFQs Downloaded */}
        <button
          type="button"
          onClick={onNavigateToAllRfqs}
          disabled={!onNavigateToAllRfqs}
          className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col justify-between min-h-[115px] text-left transition-colors enabled:hover:border-sky-300 dark:enabled:hover:border-sky-700 enabled:cursor-pointer disabled:cursor-default"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-xs font-bold uppercase">
            <span>RFQs Downloaded</span>
            <Download size={16} className="text-sky-600 dark:text-cyan-400" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-3xl font-extrabold text-slate-900 dark:text-white mono">{totalRfqsDownloaded}</p>
            <span className="text-[11px] text-sky-700 dark:text-cyan-300 font-extrabold bg-sky-50 dark:bg-cyan-950/60 px-2 py-0.5 rounded-md border border-sky-200 dark:border-sky-800">
              Avg {avgDownloadsPerDay} / day
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-gray-400 font-semibold">
            Avg {avgDownloadsPerRfq} downloads per RFQ
          </div>
        </button>

        {/* Avg Vendors Invited Per RFQ */}
        <button
          type="button"
          onClick={onNavigateToVendorConsole}
          disabled={!onNavigateToVendorConsole}
          className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col justify-between min-h-[115px] text-left transition-colors enabled:hover:border-purple-300 dark:enabled:hover:border-purple-700 enabled:cursor-pointer disabled:cursor-default"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-xs font-bold uppercase">
            <span>Avg Vendors / RFQ</span>
            <Users size={16} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-3xl font-extrabold text-slate-900 dark:text-white mono">{avgVendorsPerRfq}</p>
            <span className="text-[11px] text-purple-700 dark:text-purple-300 font-extrabold bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800">
              Vendors / RFQ
            </span>
          </div>
          <div className="mt-1 text-[11px] text-purple-600 dark:text-purple-400 font-semibold">
            Average vendors invited per RFQ
          </div>
        </button>

        {/* Vendor Response Rate */}
        <button
          type="button"
          onClick={onNavigateToKanban}
          disabled={!onNavigateToKanban}
          className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col justify-between min-h-[115px] text-left transition-colors enabled:hover:border-amber-300 dark:enabled:hover:border-amber-700 enabled:cursor-pointer disabled:cursor-default"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-gray-400 text-xs font-bold uppercase">
            <span>Vendor Response Rate</span>
            <Zap size={16} className="text-amber-500 dark:text-amber-400" />
          </div>
          <p className="text-3xl font-extrabold text-amber-600 dark:text-amber-400 mono mt-2">{vendorResponseRate}%</p>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-gray-400">
            Vendors who responded to outreach
          </div>
        </button>
      </div>

      {/* ── Mode-by-Mode RFQ & Follow-Up Performance Matrix ── */}
      <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Sourcing Mode Efficiency & RFQ Performance Comparison
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-gray-400 font-semibold">Mode 1 vs Mode 2 vs Mode 3</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modePerformance.map((mode) => (
            <div
              key={mode.id}
              className="p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/70 dark:bg-gray-950/60 hover:border-indigo-300 dark:hover:border-indigo-700/50 transition-all space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span
                    className="px-2.5 py-1 rounded text-xs font-bold tracking-wider"
                    style={{
                      backgroundColor: `${mode.badgeColor}15`,
                      color: mode.badgeColor,
                      border: `1px solid ${mode.badgeColor}35`,
                    }}
                  >
                    {mode.modeCode}
                  </span>
                  <span className="text-[11px] font-bold text-slate-500 dark:text-gray-400">
                    SLA: <strong className="text-slate-900 dark:text-white">{mode.avgTurnaround}</strong>
                  </span>
                </div>
                <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">{mode.title}</h4>
                <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                  {mode.description}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-gray-800 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-gray-400 font-medium">RFQs Raised</span>
                  <span className="font-extrabold text-slate-900 dark:text-white mono">{mode.rfqsRaised} RFQs</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-gray-400 font-medium">RFQs Downloaded</span>
                  <span className="font-extrabold text-sky-700 dark:text-cyan-300 mono">{mode.rfqsDownloaded} RFQs</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-gray-400 font-medium font-mono text-[11px]">Download Ratio</span>
                  <span className="font-semibold text-slate-700 dark:text-gray-300 text-[11px]">{mode.downloadRatio}</span>
                </div>

                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-slate-700 dark:text-gray-300">Follow-Up Efficiency (&lt;24h)</span>
                    <span className="font-black text-emerald-600 dark:text-emerald-400 mono">{mode.followUpEfficiency}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all"
                      style={{ width: `${mode.followUpEfficiency}%` }}
                    />
                  </div>
                </div>

                <div className="text-[10px] text-slate-500 dark:text-gray-400 pt-1 flex items-center justify-between">
                  <span>Chaser Channel:</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-300 truncate max-w-[170px]">{mode.primaryChaser}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Multi-Channel Follow-Up Efficacy & Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sourcing Engine RFQ Download Share */}
        <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <PieChart size={16} className="text-indigo-600 dark:text-indigo-400" /> Sourcing Engine RFQ Download Share
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-gray-400">Total 312 Downloads</span>
          </div>

          <div className="space-y-3.5 text-xs">
            <div>
              <div className="flex justify-between text-slate-700 dark:text-gray-300 font-semibold mb-1">
                <span className="flex items-center gap-1.5 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block" /> Mode 1 (Private Client Roster)
                </span>
                <span className="mono text-slate-900 dark:text-white font-bold">148 Downloads (47.4%)</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                <div className="bg-indigo-600 h-full rounded-full" style={{ width: '47.4%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-slate-700 dark:text-gray-300 font-semibold mb-1">
                <span className="flex items-center gap-1.5 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" /> Mode 2 (Hybrid Base Network)
                </span>
                <span className="mono text-slate-900 dark:text-white font-bold">104 Downloads (33.3%)</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                <div className="bg-sky-500 h-full rounded-full" style={{ width: '33.3%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-slate-700 dark:text-gray-300 font-semibold mb-1">
                <span className="flex items-center gap-1.5 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block" /> Mode 3 (360° AI Evaluated Roster)
                </span>
                <span className="mono text-slate-900 dark:text-white font-bold">60 Downloads (19.3%)</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                <div className="bg-purple-600 h-full rounded-full" style={{ width: '19.3%' }} />
              </div>
            </div>
          </div>
        </div>

        {/* AI Multi-Channel Chaser Conversion Efficacy */}
        <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BarChart3 size={16} className="text-emerald-600 dark:text-emerald-400" /> Multi-Channel Follow-Up Conversion Rate
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-gray-400">Response &lt;24h</span>
          </div>

          <div className="space-y-3 text-xs">
            {/* Channel 1: WhatsApp */}
            <div className="p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-500/30">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <MessageSquare size={13} /> 💬 WhatsApp Business Bot
                </span>
                <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400 mono">92.4%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden my-1">
                <div className="bg-emerald-600 h-full rounded-full" style={{ width: '92.4%' }} />
              </div>
            </div>

            {/* Channel 2: AI Voice Bot */}
            <div className="p-2.5 rounded-xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-500/30">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
                  <Phone size={13} /> 📞 AI Autonomous Voice Agent Calls
                </span>
                <span className="text-sm font-extrabold text-purple-700 dark:text-purple-400 mono">88.6%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden my-1">
                <div className="bg-purple-600 h-full rounded-full" style={{ width: '88.6%' }} />
              </div>
            </div>

            {/* Channel 3: 24h Email Reminder */}
            <div className="p-2.5 rounded-xl bg-amber-50/60 dark:bg-amber-955/20 border border-amber-200 dark:border-amber-500/30">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <Mail size={13} /> ✉️ 24-Hour Email Reminder Escalation
                </span>
                <span className="text-sm font-extrabold text-amber-700 dark:text-amber-400 mono">86.2%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden my-1">
                <div className="bg-amber-500 h-full rounded-full" style={{ width: '86.2%' }} />
              </div>
            </div>

            {/* Channel 4: SMS Direct */}
            <div className="p-2.5 rounded-xl bg-sky-50/60 dark:bg-cyan-950/20 border border-sky-200 dark:border-cyan-500/30">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-sky-800 dark:text-cyan-300 flex items-center gap-1.5">
                  <Smartphone size={13} /> 📱 Automated SMS Direct Alerts
                </span>
                <span className="text-sm font-extrabold text-sky-700 dark:text-cyan-400 mono">78.0%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden my-1">
                <div className="bg-sky-500 h-full rounded-full" style={{ width: '78%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
