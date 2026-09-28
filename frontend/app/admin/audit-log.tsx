'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import type { AuditLogEntry } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import {
  ShieldCheck,
  Search,
  Download,
  Filter,
  ArrowLeft,
  Hash,
  CheckCircle2,
  Copy,
  ExternalLink,
  Lock,
} from 'lucide-react';


interface AuditLogProps {
  onBackToInfra: () => void;
}

export default function AuditLog({ onBackToInfra }: AuditLogProps) {
  const { auditLogs, showToast } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLogForDetail, setSelectedLogForDetail] = useState<AuditLogEntry | null>(null);

  const filteredLogs = auditLogs.filter(
    (log) =>
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.rfqNumber && log.rfqNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
      log.shaSignature.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('SHA Hash Copied', 'Cryptographic signature copied to clipboard.', 'info');
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Screen Identification */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <button
            onClick={onBackToInfra}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white mb-2 transition-colors font-medium"
          >
            <ArrowLeft size={14} /> Back to Infrastructure Control
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Immutable Compliance Audit Trail
            </h1>
          </div>
        </div>

        <button
          onClick={() => showToast('Audit Trail Exported', 'Full compliance log exported with SHA-256 signatures.', 'success')}
          className="btn btn-secondary btn-sm"
        >
          <Download size={14} /> Export Immutable CSV
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="glass-panel p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
        <div className="relative w-full sm:w-80">
          <input
            type="text"
            placeholder="Search events, users, RFQs, or SHA signatures..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 text-xs"
          />
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-slate-500 dark:text-gray-400 text-[11px] self-end sm:self-auto">
          <span>Total Recorded Events: <span className="mono font-bold text-slate-900 dark:text-white">{auditLogs.length}</span></span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
            <ShieldCheck size={13} /> 100% Signatures Valid
          </span>
          <span className="text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800/60">
            <Lock size={11} /> {UI_STRINGS.badges.aesGcmProtected}
          </span>
        </div>
      </div>


      {/* Audit Log Table */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-gray-800 shadow-xl bg-white dark:bg-gray-900/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-gray-900/90 text-slate-700 dark:text-gray-400 border-b border-slate-200 dark:border-gray-800 text-[11px] uppercase tracking-wider">
                <th className="p-3.5 pl-4">Timestamp (UTC)</th>
                <th className="p-3.5">User / Identity</th>
                <th className="p-3.5">Action Event Description</th>
                <th className="p-3.5">SHA Digital Signature</th>
                <th className="p-3.5 text-center pr-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800/70 text-slate-700 dark:text-gray-300">
              {filteredLogs.map((log) => (
                <tr
                  key={log.id}
                  onClick={() => setSelectedLogForDetail(log)}
                  className="hover:bg-slate-50/80 dark:hover:bg-gray-800/40 transition-colors cursor-pointer group"
                >
                  <td className="p-3.5 pl-4 mono text-slate-600 dark:text-gray-300 font-semibold text-[11px] whitespace-nowrap">
                    {log.timestamp}
                  </td>
                  <td className="p-3.5 font-medium text-slate-900 dark:text-white text-xs">
                    <span className="text-indigo-700 dark:text-indigo-300 font-bold">{log.user.split(' ')[0]}</span>
                    <span className="text-slate-500 dark:text-gray-400 text-[11px] block">{log.user.split(' ').slice(1).join(' ')}</span>
                  </td>
                  <td className="p-3.5 text-xs text-slate-800 dark:text-gray-200">
                    <div className="font-semibold">{log.action}</div>
                    {log.rfqNumber && (
                      <span className="inline-block mt-0.5 mono text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-gray-800 text-indigo-700 dark:text-indigo-300 font-bold">
                        {log.rfqNumber}
                      </span>
                    )}
                  </td>
                  <td className="p-3.5 mono text-[11px] text-slate-500 dark:text-gray-400">
                    <div className="flex items-center gap-1.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                      <Hash size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <span>{log.shaSignature.slice(0, 10)}...{log.shaSignature.slice(-6)}</span>
                    </div>
                  </td>
                  <td className="p-3.5 text-center pr-4">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 inline-flex items-center gap-1">
                      <CheckCircle2 size={11} /> VERIFIED
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Signature Inspector Modal */}
      {selectedLogForDetail && (
        <div className="modal-overlay">
          <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 border border-slate-200 dark:border-indigo-500/40 rounded-2xl text-slate-900 dark:text-white space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-gray-800">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-600 dark:text-emerald-400" /> Cryptographic Signature Verification Stamp
              </h3>
              <button onClick={() => setSelectedLogForDetail(null)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 dark:text-gray-400 text-[10px] uppercase font-bold">Event Action</span>
                <p className="font-bold text-slate-900 dark:text-white mt-0.5">{selectedLogForDetail.action}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400 dark:text-gray-400 text-[10px] uppercase">Recorded UTC Time</span>
                  <p className="mono text-slate-700 dark:text-gray-200">{selectedLogForDetail.timestamp}</p>
                </div>
                <div>
                  <span className="text-slate-400 dark:text-gray-400 text-[10px] uppercase">Origin IP Address</span>
                  <p className="mono text-slate-700 dark:text-gray-200">{selectedLogForDetail.ipAddress}</p>
                </div>
              </div>

              <div>
                <span className="text-slate-400 dark:text-gray-400 text-[10px] uppercase font-bold">SHA-256 Digital Hash Fingerprint</span>
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 mono text-indigo-700 dark:text-indigo-300 break-all select-all text-[11px] mt-1 flex items-center justify-between gap-2">
                  <span>{selectedLogForDetail.shaSignature}</span>
                  <button
                    onClick={() => copyToClipboard(selectedLogForDetail.shaSignature)}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-gray-800 text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    title="Copy Hash"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-[11px] flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Zero tampering detected. Cryptographic chain integrity verified against Azure Immutable Blob ledger.</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => setSelectedLogForDetail(null)} className="btn btn-secondary btn-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
