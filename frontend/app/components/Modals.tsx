'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/store';
import { RFQItem, VendorEvaluationRecord, QuoteComparison, VendorFollowUpRecord } from '@/lib/types';
import { SOURCING_MODES } from '@/lib/constants';
import {
  X,
  FileCheck,
  Send,
  MessageSquare,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Download,
  Printer,
  Copy,
  KeyRound,
  Lock,
  UserCheck,
  Sliders,
  Hash,
  CreditCard,
  FileText,
  Clock,
  Mail,
  UploadCloud,
  FileSpreadsheet,
  Phone,
  Smartphone,
  ChevronRight,
  Search,
  Layers,
  TrendingUp,
  Tag,
  Building2,
  Calendar,
  ExternalLink,
  Filter,
  Check,
  Info,
  Eye,
} from 'lucide-react';

interface POLineItem {
  description: string;
  quantity: number;
  unit: string;
}

interface POModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqNumber: string;
  vendorId: string | null;
  vendorName: string;
  totalAmount: number;
  unitPrice: number;
  leadTime: number;
  deliveryDate: string;
  lineItems: POLineItem[];
}

export function PurchaseOrderModal({
  isOpen,
  onClose,
  rfqNumber,
  vendorId,
  vendorName,
  totalAmount,
  unitPrice,
  leadTime,
  deliveryDate,
  lineItems,
}: POModalProps) {
  const { approvePO } = useApp();
  const [poSigned, setPoSigned] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approverNotes, setApproverNotes] = useState('Approved based on AI Evaluation Matrix >94% match score & lowest compliant price.');
  // Populated from the real backend response once approval succeeds — shown
  // instead of the fake, hardcoded-constant "SHA-256 seal" this used to
  // display unconditionally (the same string regardless of what was
  // actually approved).
  const [approvedPo, setApprovedPo] = useState<{ poNumber: string; issueDate: string; shaSignature: string } | null>(null);

  if (!isOpen) return null;

  // Deterministic preview before approval — this formula matches the
  // backend's exactly, so it's accurate to show ahead of time; the real
  // hash and issue date, unlike the PO number, can't be known until the
  // backend actually seals them.
  const previewPoNumber = `PO-2026-` + rfqNumber.replace('RFQ-2026-', '');
  const poNumber = approvedPo?.poNumber || previewPoNumber;
  const issueDate = approvedPo?.issueDate || null;

  const handleApprove = async () => {
    setApproving(true);
    const result = await approvePO(rfqNumber, vendorId, vendorName, totalAmount, approverNotes);
    setApproving(false);
    if (result.success) {
      setPoSigned(true);
      setApprovedPo({
        poNumber: result.poNumber || previewPoNumber,
        issueDate: result.issueDate || new Date().toISOString().substring(0, 10),
        shaSignature: result.shaSignature || '',
      });
      setTimeout(() => {
        onClose();
      }, 1800);
    }
    // On failure, approvePO already surfaced a toast — stay open so the
    // buyer can retry rather than silently closing on a failed approval.
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-2xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
              <FileCheck size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Pre-Purchase Order Generation & Dispatch</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">Formal Enterprise Contract Dispatch to ERP & Vendor Master</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        {/* PO Document Preview Canvas */}
        <div className="my-5 p-5 rounded-xl bg-slate-50 dark:bg-gray-950/80 border border-slate-200 dark:border-gray-800 text-xs space-y-4">
          <div className="flex justify-between items-start border-b border-slate-200 dark:border-gray-800 pb-3">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400 font-bold">PROCUCEV ENTERPRISE BUYER</span>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">PRE-PURCHASE ORDER: {poNumber}</h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Linked RFQ: <span className="mono text-indigo-600 dark:text-indigo-300 font-bold">{rfqNumber}</span></p>
            </div>
            <div className="text-right">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40 inline-flex items-center gap-1">
                <ShieldCheck size={12} /> AI Verified & Compliant
              </span>
              <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1">Issue Date: {issueDate || 'Sealed upon approval'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 py-2 border-b border-slate-200 dark:border-gray-800/80">
            <div>
              <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold">Contract Awarded To:</p>
              <p className="font-bold text-slate-900 dark:text-white text-xs mt-0.5">{vendorName}</p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Vendor ID: <span className="mono font-semibold">{vendorId || '—'}</span></p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Payment Terms: Net 30 Days (Pre-negotiated)</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold">Delivery & Logistics:</p>
              <p className="font-semibold text-slate-800 dark:text-gray-200 mt-0.5">Navi Mumbai Industrial Hub / CIF Site</p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Lead Time Commitment: <span className="text-emerald-600 dark:text-emerald-400 font-bold">{leadTime} Days</span></p>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">Target Delivery: {deliveryDate}</p>
            </div>
          </div>

          {/* Line Items — the actual RFQ line items, not a hardcoded pump description */}
          <div>
            <p className="text-[10px] text-slate-400 dark:text-gray-400 uppercase font-semibold mb-1.5">Line-Item Summary</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-slate-200 dark:border-gray-800 rounded-lg overflow-hidden">
                <thead className="bg-slate-100 dark:bg-gray-900/90 text-slate-600 dark:text-gray-400 text-[10px]">
                  <tr>
                    <th className="p-2">Item Description</th>
                    <th className="p-2 text-center">Qty</th>
                    <th className="p-2 text-center">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-gray-800 text-slate-700 dark:text-gray-300">
                  {lineItems.length > 0 ? (
                    lineItems.map((li, idx) => (
                      <tr key={idx}>
                        <td className="p-2">{li.description}</td>
                        <td className="p-2 text-center">{li.quantity}</td>
                        <td className="p-2 text-center">{li.unit}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="p-2 text-slate-400 italic" colSpan={3}>No structured line items on this RFQ.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 mt-2 text-[11px]">
              <span className="text-slate-500 dark:text-gray-400">Quoted Unit Price: <span className="font-bold text-slate-900 dark:text-white mono">₹{unitPrice.toLocaleString()}</span></span>
              <span className="text-slate-500 dark:text-gray-400">Quoted Total: <span className="font-bold text-slate-900 dark:text-white mono">₹{totalAmount.toLocaleString()}</span></span>
            </div>
          </div>

          {/* Cryptographic Audit Seal — only real once the backend has actually
              sealed this PO; previously a hardcoded constant shown even before
              approval, identical no matter what was approved. */}
          <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 flex items-start gap-2 text-[10px] text-slate-500 dark:text-gray-400 shadow-sm">
            <Hash size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-slate-800 dark:text-gray-300 font-semibold">Cryptographic Audit Seal (SHA-256):</span>
              {approvedPo?.shaSignature ? (
                <p className="mono text-indigo-700 dark:text-indigo-300 break-all select-all font-semibold">{approvedPo.shaSignature}</p>
              ) : (
                <p className="italic text-slate-400">Generated by the audit ledger once this Pre-Purchase Order is approved.</p>
              )}
            </div>
          </div>
        </div>

        {/* Approver Notes */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">Executive Approver Sign-off Note:</label>
          <input
            type="text"
            value={approverNotes}
            onChange={(e) => setApproverNotes(e.target.value)}
            className="w-full text-xs"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              title="Use your browser's print dialog to save as PDF"
              className="btn btn-secondary btn-sm"
            >
              <Download size={13} /> Export PDF
            </button>
            <button
              onClick={() => window.print()}
              className="btn btn-secondary btn-sm"
            >
              <Printer size={13} /> Print
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button
              onClick={handleApprove}
              disabled={poSigned || approving}
              className="btn btn-primary"
            >
              {poSigned ? (
                <>
                  <CheckCircle2 size={15} /> Dispatched to Vendor & ERP!
                </>
              ) : approving ? (
                <>Approving...</>
              ) : (
                <>
                  <ShieldCheck size={15} /> APPROVE & GENERATE PRE-PURCHASE ORDER
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MultiChannelChaserModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqNumber: string;
  vendorName: string;
  vendorPhone?: string;
  initialChannel?: 'call' | 'whatsapp' | 'sms';
}

export function MultiChannelChaserModal({
  isOpen,
  onClose,
  rfqNumber,
  vendorName,
  vendorPhone,
  initialChannel = 'whatsapp',
}: MultiChannelChaserModalProps) {
  const { triggerChannelChaser } = useApp();
  const [selectedChannel, setSelectedChannel] = useState<'call' | 'whatsapp' | 'sms'>(initialChannel);
  const [phone, setPhone] = useState(vendorPhone || '');
  const [template, setTemplate] = useState('urgent_reminder');
  const [customMsg, setCustomMsg] = useState(
    `Hello ${vendorName}, this is Procucev Enterprise QUA AI. We require your line-item quotation for ${rfqNumber} within 24 hours to include in the comparative matrix. Click here to submit instantly: https://portal.procucev.com/bid/${rfqNumber}`
  );
  const [callScript, setCallScript] = useState(
    `"Hello, this is Procucev Autonomous Voice Bot calling on behalf of the Enterprise Buyer regarding ${rfqNumber}. We noticed your quote submission is pending. Can you confirm if you will submit by 4:00 PM today?"`
  );

  useEffect(() => {
    setSelectedChannel(initialChannel);
  }, [initialChannel]);

  // Sync phone and message content whenever the modal re-opens for a different vendor
  useEffect(() => {
    if (isOpen) {
      setPhone(vendorPhone || '');
      setCustomMsg(
        `Hello ${vendorName}, this is Procucev Enterprise QUA AI. We require your line-item quotation for ${rfqNumber} within 24 hours to include in the comparative matrix. Click here to submit instantly: https://portal.procucev.com/bid/${rfqNumber}`
      );
      setCallScript(
        `"Hello, this is Procucev Autonomous Voice Bot calling on behalf of the Enterprise Buyer regarding ${rfqNumber}. We noticed your quote submission is pending. Can you confirm if you will submit by 4:00 PM today?"`
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, vendorName, vendorPhone, rfqNumber]);

  if (!isOpen) return null;

  const handleSend = () => {
    triggerChannelChaser(rfqNumber, selectedChannel, vendorName, selectedChannel === 'call' ? callScript : customMsg);
    onClose();
  };

  return (
    <div className="modal-overlay !z-[1050]" onClick={onClose}>
      <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-lg border ${
                selectedChannel === 'call'
                  ? 'bg-purple-50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-500/30'
                  : selectedChannel === 'whatsapp'
                  ? 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
                  : 'bg-sky-50 dark:bg-cyan-500/20 text-sky-600 dark:text-cyan-400 border-sky-200 dark:border-cyan-500/30'
              }`}
            >
              {selectedChannel === 'call' ? (
                <span className="text-base">📞</span>
              ) : selectedChannel === 'whatsapp' ? (
                <MessageSquare size={18} />
              ) : (
                <span className="text-base">📱</span>
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Dispatch AI Follow-Up ({selectedChannel.toUpperCase()})
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">
                Multi-Channel Autonomous Supplier Outreach Engine
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Channel Switcher Tabs */}
        <div className="grid grid-cols-3 gap-2 my-4 p-1 bg-slate-100 dark:bg-gray-800/80 rounded-xl">
          <button
            type="button"
            onClick={() => setSelectedChannel('call')}
            className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              selectedChannel === 'call'
                ? 'bg-white dark:bg-gray-900 text-purple-700 dark:text-purple-300 shadow-sm border border-slate-200 dark:border-gray-700'
                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200'
            }`}
          >
            <span>📞</span> AI Voice Call
          </button>
          <button
            type="button"
            onClick={() => setSelectedChannel('whatsapp')}
            className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              selectedChannel === 'whatsapp'
                ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-sm border border-slate-200 dark:border-gray-700'
                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200'
            }`}
          >
            <MessageSquare size={13} /> WhatsApp Bot
          </button>
          <button
            type="button"
            onClick={() => setSelectedChannel('sms')}
            className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              selectedChannel === 'sms'
                ? 'bg-white dark:bg-gray-900 text-sky-700 dark:text-cyan-300 shadow-sm border border-slate-200 dark:border-gray-700'
                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200'
            }`}
          >
            <span>📱</span> SMS Direct
          </button>
        </div>

        <div className="space-y-3.5 my-3 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
              Target Vendor & Phone Number
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={vendorName} readOnly className="opacity-80 font-medium" />
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          {selectedChannel === 'call' ? (
            <div>
              <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
                AI Voice Bot Conversation Script & Objective
              </label>
              <textarea
                rows={3}
                value={callScript}
                onChange={(e) => setCallScript(e.target.value)}
                className="w-full text-xs font-sans leading-relaxed"
              />
              <div className="p-2.5 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40 text-purple-900 dark:text-purple-200 mt-2 text-[11px] flex items-center gap-2">
                <span className="live-dot" />
                <span>AI will call supplier, detect intent, confirm lead time, and log audio transcript.</span>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
                  Chasing Template
                </label>
                <select
                  value={template}
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    if (e.target.value === 'urgent_reminder') {
                      setCustomMsg(
                        `Hello ${vendorName}, this is Procucev Enterprise QUA AI. We require your line-item quotation for ${rfqNumber} within 24 hours. Click to submit: https://portal.procucev.com/bid/${rfqNumber}`
                      );
                    } else {
                      setCustomMsg(
                        `Action Required: Procucev Buyer has prioritized ${rfqNumber}. Please upload your technical compliance sheet and unit prices immediately.`
                      );
                    }
                  }}
                >
                  <option value="urgent_reminder">Urgent RFQ Deadline Reminder (24h Window)</option>
                  <option value="technical_request">Technical Compliance & Specification Clarification</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-gray-300 font-semibold mb-1">
                  Message Payload Preview ({selectedChannel === 'whatsapp' ? 'WhatsApp Payload' : 'SMS DLT Template'})
                </label>
                <div
                  className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    selectedChannel === 'whatsapp'
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-200'
                      : 'bg-sky-50 dark:bg-cyan-950/30 border-sky-200 dark:border-cyan-800/40 text-sky-900 dark:text-cyan-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase mb-1">
                    <span className="live-dot" /> PROCUCEV {selectedChannel.toUpperCase()} DISPATCH
                  </div>
                  <p>{customMsg}</p>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button
            onClick={handleSend}
            className={`btn ${
              selectedChannel === 'call'
                ? 'btn-primary'
                : selectedChannel === 'whatsapp'
                ? 'btn-emerald'
                : 'btn-secondary text-sky-700 dark:text-cyan-300 border-sky-300 dark:border-cyan-500/40'
            }`}
          >
            {selectedChannel === 'call' ? (
              <>📞 Initiate AI Voice Call</>
            ) : selectedChannel === 'whatsapp' ? (
              <>
                <Send size={13} /> Send WhatsApp Chaser
              </>
            ) : (
              <>📱 Broadcast SMS Alert</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Backward compatibility export
export const WhatsAppChaserModal = MultiChannelChaserModal;

/* RFQ-WISE MULTI-CHANNEL FOLLOW-UP DEEP DIVE MODAL */
interface RFQFollowUpDeepDiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfq: RFQItem | null;
}

export function RFQFollowUpDeepDiveModal({ isOpen, onClose, rfq }: RFQFollowUpDeepDiveModalProps) {
  const { triggerChannelChaser, triggerBatchChannelChaser, showToast } = useApp();
  const [activeChannelTab, setActiveChannelTab] = useState<'all' | 'call' | 'whatsapp' | 'sms'>('all');
  const [activeVendorModal, setActiveVendorModal] = useState<{
    vendorName: string;
    phone: string;
    channel: 'call' | 'whatsapp' | 'sms';
  } | null>(null);

  if (!isOpen || !rfq) return null;

  const followUp = rfq.followUpData;
  const totalInvitedVendors = followUp?.totalInvited ?? (followUp?.vendors?.length || rfq.assignedVendors?.length || 0);

  // Normalize vendor telemetry records
  const rawVendors: VendorFollowUpRecord[] = (followUp?.vendors && followUp.vendors.length > 0)
    ? followUp.vendors
    : (rfq.assignedVendors || []).map((av, idx) => ({
        vendorId: av.id || `v-${idx + 1}`,
        vendorName: av.name,
        contactPerson: av.contactPerson || 'Authorized Representative',
        phone: av.phone || 'N/A',
        overallStatus: 'Pending' as const,
        lastInteraction: 'Outreach queued',
        attemptsCount: 0,
        bidStatus: 'Pending' as const,
        call: { status: 'scheduled' as const, lastAttempt: 'Not yet dispatched' },
        whatsapp: { status: 'pending' as const, lastAttempt: 'Not yet dispatched' },
        sms: { status: 'pending' as const, lastAttempt: 'Not yet dispatched' },
        email24h: { status: 'pending' as const, lastAttempt: '', is24hReminderSent: false },
      }));

  const vendors: VendorFollowUpRecord[] = rawVendors.map((v) => ({
    ...v,
    call: v.call || { status: 'scheduled' as const, lastAttempt: 'Not yet dispatched' },
    whatsapp: v.whatsapp || { status: 'pending' as const, lastAttempt: 'Not yet dispatched' },
    sms: v.sms || { status: 'pending' as const, lastAttempt: 'Not yet dispatched' },
  }));

  const filteredVendors = vendors.filter((v) => {
    if (activeChannelTab === 'all') return true;
    if (activeChannelTab === 'call') return v.call.status !== 'failed';
    if (activeChannelTab === 'whatsapp') return v.whatsapp.status !== 'failed';
    if (activeChannelTab === 'sms') return v.sms.status !== 'failed';
    return true;
  });

  const getCallBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="badge badge-emerald text-[11px] px-2 py-0.5">📞 Connected</span>;
      case 'connected':
        return <span className="badge badge-blue text-[11px] px-2 py-0.5">📞 In Call</span>;
      case 'voicemail':
        return <span className="badge badge-amber text-[11px] px-2 py-0.5">📞 Voicemail Left</span>;
      case 'scheduled':
        return <span className="badge badge-purple text-[11px] px-2 py-0.5">📞 Callback Queued</span>;
      case 'not_dispatched':
        return <span className="badge badge-gray text-[11px] px-2 py-0.5">⏳ Queued</span>;
      default:
        return <span className="badge badge-blue text-[11px] px-2 py-0.5">📞 {status}</span>;
    }
  };

  const getWhatsAppBadge = (status: string) => {
    switch (status) {
      case 'replied':
        return <span className="badge badge-emerald text-[11px] px-2 py-0.5">💬 Replied / Bid In</span>;
      case 'read':
        return <span className="badge badge-blue text-[11px] px-2 py-0.5">💬 Read (Link Clicked)</span>;
      case 'delivered':
        return <span className="badge badge-amber text-[11px] px-2 py-0.5">💬 Delivered</span>;
      case 'pending':
        return <span className="badge badge-purple text-[11px] px-2 py-0.5">💬 Queued</span>;
      case 'not_dispatched':
        return <span className="badge badge-gray text-[11px] px-2 py-0.5">⏳ Queued</span>;
      default:
        return <span className="badge badge-blue text-[11px] px-2 py-0.5">💬 {status}</span>;
    }
  };

  const getSMSBadge = (status: string) => {
    switch (status) {
      case 'clicked':
        return <span className="badge badge-emerald text-[11px] px-2 py-0.5">📱 Link Clicked</span>;
      case 'delivered':
        return <span className="badge badge-blue text-[11px] px-2 py-0.5">📱 Delivered (DLT)</span>;
      case 'sent':
        return <span className="badge badge-amber text-[11px] px-2 py-0.5">📱 Sent</span>;
      case 'not_dispatched':
        return <span className="badge badge-gray text-[11px] px-2 py-0.5">⏳ Queued</span>;
      default:
        return <span className="badge badge-purple text-[11px] px-2 py-0.5">📱 {status}</span>;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-6xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 shadow-xs">
              <Phone size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-md font-extrabold text-xs mono bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                  {rfq.rfqNumber}
                </span>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  Vendor Follow-Up Details
                </h2>
                <span className="badge badge-purple text-xs font-bold px-2.5 py-0.5">Multi-Channel</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                {rfq.title} • <span className="font-semibold text-slate-700 dark:text-gray-300">Target Delivery: {rfq.targetDeliveryDate || 'Standard'}</span> • <span className="text-indigo-600 dark:text-indigo-400 font-bold">{vendors.length} Vendors Empanelled</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={22} />
          </button>
        </div>

        {/* 4-Channel Live Metric Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 my-4 shrink-0">
          {/* Channel 1: Call (Voice Bot) */}
          <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-purple-800 dark:text-purple-300 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <span>📞</span> VOICE CALLS
              </span>
              {followUp?.callStats?.avgDuration ? (
                <span className="mono text-[10px] bg-purple-100 dark:bg-purple-900/60 px-2 py-0.5 rounded font-black">
                  Avg {followUp.callStats.avgDuration}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-purple-950 dark:text-purple-100 mono">
                {followUp?.callStats?.connected ?? 0} / {followUp?.callStats?.total ?? 0}
              </span>
              <span className="text-xs text-purple-700 dark:text-purple-300 font-semibold">Connected</span>
            </div>
            <p className="text-[11px] text-purple-600 dark:text-purple-400 mt-0.5">
              Autonomous intent & transcription
            </p>
          </div>

          {/* Channel 2: WhatsApp */}
          <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <MessageSquare size={13} /> WHATSAPP BOT
              </span>
              <span className="mono text-[10px] bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded font-black">
                {followUp?.whatsappStats?.read ?? 0} Read
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-emerald-950 dark:text-emerald-100 mono">
                {followUp?.whatsappStats?.replied ?? 0} / {followUp?.whatsappStats?.total ?? 0}
              </span>
              <span className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">Bids Submitted</span>
            </div>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
              1-click bid submission & receipts
            </p>
          </div>

          {/* Channel 3: SMS Direct */}
          <div className="p-3.5 rounded-xl bg-sky-50/70 dark:bg-cyan-950/30 border border-sky-200 dark:border-cyan-800/40 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-sky-800 dark:text-cyan-300 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <span>📱</span> SMS ALERTS
              </span>
              <span className="mono text-[10px] bg-sky-100 dark:bg-cyan-900/60 px-2 py-0.5 rounded font-black">
                DLT Verified
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-sky-950 dark:text-cyan-100 mono">
                {followUp?.smsStats?.delivered ?? 0} / {followUp?.smsStats?.total ?? 0}
              </span>
              <span className="text-xs text-sky-700 dark:text-cyan-300 font-semibold">Delivered</span>
            </div>
            <p className="text-[11px] text-sky-600 dark:text-cyan-400 mt-0.5">
              Carrier priority sales alerts
            </p>
          </div>

          {/* Channel 4: 24h Email Reminder Escalation */}
          <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-955/30 border border-amber-200 dark:border-amber-800/40 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Mail size={13} /> 24H EMAIL ESCALATION
              </span>
              <span className="mono text-[10px] bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded font-black">
                Next-Day
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-amber-950 dark:text-amber-100 mono">
                {followUp?.emailStats?.sent24h ?? 0} / {totalInvitedVendors}
              </span>
              <span className="text-xs text-amber-700 dark:text-amber-300 font-semibold">Escalations Sent</span>
            </div>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              Automated BOQ re-attachment
            </p>
          </div>
        </div>

        {/* Channel Filter & Batch Action Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-gray-800 text-xs shrink-0">
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-gray-800/90 p-1 rounded-xl w-full sm:w-auto overflow-x-auto">
            <button
              onClick={() => setActiveChannelTab('all')}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all shrink-0 ${
                activeChannelTab === 'all'
                  ? 'bg-white dark:bg-gray-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All Channels ({vendors.length})
            </button>
            <button
              onClick={() => setActiveChannelTab('call')}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 ${
                activeChannelTab === 'call'
                  ? 'bg-white dark:bg-gray-900 text-purple-700 dark:text-purple-300 shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>📞</span> Calls ({followUp?.callStats?.total ?? 0})
            </button>
            <button
              onClick={() => setActiveChannelTab('whatsapp')}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 ${
                activeChannelTab === 'whatsapp'
                  ? 'bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <MessageSquare size={13} /> WhatsApp ({followUp?.whatsappStats?.total ?? 0})
            </button>
            <button
              onClick={() => setActiveChannelTab('sms')}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 ${
                activeChannelTab === 'sms'
                  ? 'bg-white dark:bg-gray-900 text-sky-700 dark:text-cyan-300 shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>📱</span> SMS ({followUp?.smsStats?.total ?? 0})
            </button>
          </div>
        </div>

        {/* Vendor Follow-Up Details List */}
        <div className="flex-1 overflow-y-auto my-3 space-y-3 pr-1 min-h-[260px]">
          {filteredVendors.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-gray-500 text-xs">
              <Phone size={32} className="mx-auto mb-2 opacity-40 text-indigo-500" />
              <p className="font-bold text-slate-700 dark:text-gray-300 text-sm">No vendors found for this channel filter.</p>
              <p className="text-xs text-slate-400 mt-1">Select &apos;All Channels&apos; or broadcast follow-ups across your roster.</p>
            </div>
          ) : (
            filteredVendors.map((vendor) => (
              <div
                key={vendor.vendorId}
                className="p-4 rounded-xl bg-slate-50/80 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-all text-xs space-y-3 shadow-2xs"
              >
                {/* Vendor Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-gray-800">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                        <Building2 size={15} className="text-slate-400" /> {vendor.vendorName}
                      </span>
                      {vendor.phone && vendor.phone !== 'N/A' && (
                        <span className="text-slate-500 dark:text-gray-400 text-xs mono">({vendor.phone})</span>
                      )}
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          vendor.overallStatus === 'Responded' || vendor.bidStatus === 'Submitted'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                        }`}
                      >
                        {vendor.overallStatus}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">
                      Contact: <span className="text-slate-700 dark:text-gray-300 font-semibold">{vendor.contactPerson || 'Authorized Representative'}</span> • Last Interaction: <span className="font-medium text-slate-700 dark:text-gray-300">{vendor.lastInteraction || 'Pending outreach'}</span> {vendor.attemptsCount > 0 && `(Attempt #${vendor.attemptsCount})`}
                    </p>
                  </div>

                  {/* Channel Action Buttons */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <button
                      onClick={() =>
                        setActiveVendorModal({ vendorName: vendor.vendorName, phone: vendor.phone || '', channel: 'call' })
                      }
                      className="px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700/50 hover:bg-purple-100 dark:hover:bg-purple-900/70 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <span>📞</span> Call
                    </button>
                    <button
                      onClick={() =>
                        setActiveVendorModal({ vendorName: vendor.vendorName, phone: vendor.phone || '', channel: 'whatsapp' })
                      }
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <MessageSquare size={13} /> WhatsApp
                    </button>
                    <button
                      onClick={() =>
                        setActiveVendorModal({ vendorName: vendor.vendorName, phone: vendor.phone || '', channel: 'sms' })
                      }
                      className="px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-cyan-900/40 text-sky-700 dark:text-cyan-300 border border-sky-200 dark:border-cyan-700/50 hover:bg-sky-100 dark:hover:bg-cyan-900/70 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <span>📱</span> SMS
                    </button>
                  </div>
                </div>

                {/* 4-Channel Status Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Call Details */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <span>📞</span> AI Voice Bot
                      </span>
                      {getCallBadge(vendor.call.status)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400 flex justify-between">
                      <span>Status: {vendor.call.lastAttempt}</span>
                      {vendor.call.duration && <span className="mono font-semibold">{vendor.call.duration}</span>}
                    </div>
                    {vendor.call.summary && (
                      <p className="text-[11px] text-slate-700 dark:text-gray-300 leading-snug">
                        {vendor.call.summary}
                      </p>
                    )}
                    {vendor.call.transcriptSnippet && (
                      <div className="p-2 rounded bg-slate-50 dark:bg-gray-950 border border-slate-100 dark:border-gray-800/80 text-[10px] text-indigo-700 dark:text-indigo-300 italic">
                        &ldquo;{vendor.call.transcriptSnippet}&rdquo;
                      </div>
                    )}
                  </div>

                  {/* WhatsApp Details */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <MessageSquare size={12} className="text-emerald-500" /> WhatsApp Chaser
                      </span>
                      {getWhatsAppBadge(vendor.whatsapp.status)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400">
                      Dispatched: {vendor.whatsapp.lastAttempt}
                    </div>
                    {vendor.whatsapp.messagePreview && (
                      <p className="text-[11px] text-slate-700 dark:text-gray-300 leading-snug">
                        {vendor.whatsapp.messagePreview}
                      </p>
                    )}
                    {vendor.whatsapp.linkClicked !== undefined && (
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 size={11} /> {vendor.whatsapp.linkClicked ? 'Bid Sheet Link Clicked' : 'Delivered, Link Pending Click'}
                      </div>
                    )}
                  </div>

                  {/* SMS Details */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <span>📱</span> SMS Direct Alert
                      </span>
                      {getSMSBadge(vendor.sms.status)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400">
                      Status Date: {vendor.sms.lastAttempt}
                    </div>
                    {vendor.sms.deliveryReport ? (
                      <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-mono block">
                        Gateway: {vendor.sms.deliveryReport}
                      </span>
                    ) : (
                      <p className="text-[11px] text-slate-600 dark:text-gray-400 leading-snug">
                        Direct SMS notification route.
                      </p>
                    )}
                  </div>

                  {/* 24h Email Reminder Details */}
                  <div className="p-3 rounded-lg bg-white dark:bg-gray-900/90 border border-slate-200 dark:border-gray-800 space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1 text-[11px]">
                        <Mail size={12} className="text-amber-500" /> 24h Email Escalation
                      </span>
                      {vendor.email24h?.is24hReminderSent ? (
                        <span className="badge badge-amber text-[11px] px-2 py-0.5">✉️ Dispatched</span>
                      ) : vendor.bidStatus === 'Submitted' || vendor.overallStatus === 'Responded' ? (
                        <span className="badge badge-emerald text-[11px] px-2 py-0.5">✅ Bid Submitted</span>
                      ) : (
                        <span className="badge badge-purple text-[11px] px-2 py-0.5">⏳ Pending 24h</span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-gray-400">
                      {vendor.email24h?.lastAttempt ? `Sent: ${vendor.email24h.lastAttempt}` : 'Follow-up escalation queue'}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-gray-400 leading-snug">
                      {vendor.email24h?.is24hReminderSent
                        ? 'BOQ specs re-attached via email. Urgent bid submission requested.'
                        : 'Dispatches if vendor fails to respond to initial follow-up.'}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-3.5 mt-1 border-t border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 shrink-0">
          <div className="flex items-center gap-2">
            <span className="live-dot" />
            <span>Next Automated Follow-Up Wave: <strong className="text-slate-800 dark:text-gray-200">{followUp?.nextScheduledChaser || 'Today 03:00 PM'}</strong></span>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm font-bold px-4">
            Close Vendor Follow-Up Details
          </button>
        </div>
      </div>

      {/* Individual Vendor Multi-Channel Modal */}
      {activeVendorModal && (
        <MultiChannelChaserModal
          isOpen={!!activeVendorModal}
          onClose={() => setActiveVendorModal(null)}
          rfqNumber={rfq.rfqNumber}
          vendorName={activeVendorModal.vendorName}
          vendorPhone={activeVendorModal.phone}
          initialChannel={activeVendorModal.channel}
        />
      )}
    </div>
  );
}


interface SurveyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VendorSurveyModal({ isOpen, onClose }: SurveyModalProps) {
  const { showToast, addAuditLog } = useApp();
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleTriggerSurvey = () => {
    setSubmitting(true);
    setTimeout(() => {
      addAuditLog('Executed Global Override: Triggered Mode 3 Vendor Capability Survey to 24 pool suppliers');
      showToast('Mode 3 Survey Dispatched', 'AI evaluation survey sent to 24 suppliers. Scores will update autonomously upon response.', 'success');
      setSubmitting(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-purple-500/40">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/30">
              <Sliders size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Mode 3 AI Vendor Survey</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">Deep Capability Assessment & Scoring for High-Match Suppliers</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 my-4 text-xs">
          <p className="text-slate-600 dark:text-gray-300">
            This operational override dispatches an autonomous capability audit questionnaire to all prospective suppliers in the Procucev Network scoring &gt;80% match.
          </p>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-gray-400">Target Supplier Pool:</span>
              <span className="font-semibold text-slate-900 dark:text-white">24 High-Match Vendors</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-gray-400">Audit Criteria:</span>
              <span className="font-semibold text-purple-700 dark:text-purple-300">ISO 9001, ANSI, Delivery SLA, ESG</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-gray-400">Auto-Scoring Model:</span>
              <span className="font-semibold text-indigo-700 dark:text-indigo-300">Llama 3 (8B Instruct) Multi-Factor</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button onClick={handleTriggerSurvey} disabled={submitting} className="btn btn-primary">
            <Sparkles size={14} /> {submitting ? 'Dispatching...' : 'Execute Mode 3 Survey'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SubscriptionPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  planName: string;
  price: string;
  /** Creates a real Zoho payment link for `planId` and resolves its redirect URL, or null on failure (a toast is already shown by the caller). */
  createPaymentLink: (planId: string) => Promise<string | null>;
}

/**
 * Real Zoho Payments checkout, shared by both the vendor and buyer
 * subscription screens (each passes its own `createPaymentLink` — vendor's
 * `createVendorPaymentLink` or buyer's `createBuyerPaymentLink` from
 * `useApp()`). This app never collects card details itself — on confirm it
 * asks the backend to create a Zoho payment link, then redirects the browser
 * to Zoho's own hosted payment page. The subscription is granted server-side
 * once Zoho's webhook (or the reconciliation poller) confirms the payment,
 * not by this modal.
 */
export function SubscriptionPaymentModal({ isOpen, onClose, planId, planName, price, createPaymentLink }: SubscriptionPaymentModalProps) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePay = async () => {
    setProcessing(true);
    setError(null);
    const paymentUrl = await createPaymentLink(planId);
    if (!paymentUrl) {
      setProcessing(false);
      setError('Could not start checkout. Please try again.');
      return;
    }
    window.location.href = paymentUrl;
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-md p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
              <CreditCard size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Secure Payment</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">You&apos;ll complete payment on Zoho&apos;s secure checkout page</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={processing}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 my-4 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-slate-500 dark:text-gray-400">Plan</span>
            <span className="font-bold text-slate-900 dark:text-white">{planName}</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-slate-500 dark:text-gray-400">Amount Due</span>
            <span className="font-black text-lg text-indigo-600 dark:text-indigo-400">{price}</span>
          </div>
          {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
          <button onClick={onClose} disabled={processing} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button onClick={() => void handlePay()} disabled={processing} className="btn btn-primary">
            <CreditCard size={14} /> {processing ? 'Redirecting to secure payment…' : `Pay ${price}`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RbacModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RbacModal({ isOpen, onClose }: RbacModalProps) {
  const { showToast } = useApp();

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-purple-500/40">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
              <UserCheck size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Azure Active Directory & RBAC Matrix</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">Role-Based Access Control Policies & Service Principals</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>

        <div className="my-4 space-y-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
            <div className="grid grid-cols-3 gap-2 font-semibold text-slate-500 dark:text-gray-400 border-b border-slate-200 dark:border-gray-800 pb-2 mb-2">
              <span>Role Principle</span>
              <span>Permissions</span>
              <span>SSO MFA Policy</span>
            </div>
            <div className="space-y-2 text-slate-700 dark:text-gray-300">
              <div className="grid grid-cols-3 gap-2 items-center">
                <span className="font-bold text-indigo-700 dark:text-indigo-300">Enterprise Buyer</span>
                <span>Create RFQ, Approve PO</span>
                <span className="text-emerald-600 dark:text-emerald-400">Conditional Access</span>
              </div>
              <div className="grid grid-cols-3 gap-2 items-center">
                <span className="font-bold text-sky-700 dark:text-cyan-300">Category Manager</span>
                <span>Chaser Triggers, Overrides</span>
                <span className="text-emerald-600 dark:text-emerald-400">FIDO2 / Authenticator</span>
              </div>
              <div className="grid grid-cols-3 gap-2 items-center">
                <span className="font-bold text-emerald-700 dark:text-emerald-300">Vendor / Supplier</span>
                <span>Bid Submission, File Upload</span>
                <span className="text-emerald-600 dark:text-emerald-400">SMS OTP + Email Link</span>
              </div>
              <div className="grid grid-cols-3 gap-2 items-center">
                <span className="font-bold text-purple-700 dark:text-purple-300">Platform Auditor</span>
                <span>Read-Only Cryptographic Log</span>
                <span className="text-emerald-600 dark:text-emerald-400">Hardware Key Required</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            Close
          </button>
          <button
            onClick={() => {
              showToast('RBAC Policies Synchronized', 'Updated Azure Entra ID access matrix across all tenants.', 'success');
              onClose();
            }}
            className="btn btn-primary"
          >
            <ShieldCheck size={14} /> Sync Azure AD Roles
          </button>
        </div>
      </div>
    </div>
  );
}

interface EvaluationSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  record?: any;
}

export function VendorEvaluationSummaryModal({ isOpen, onClose, record }: EvaluationSummaryModalProps) {
  const { selectedVendorEvaluation } = useApp();
  if (!isOpen) return null;
  const evalRecord = record || selectedVendorEvaluation;

  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-5xl p-6 max-h-[92vh] overflow-y-auto relative animate-scale-up">
        <div className="flex justify-end mb-2">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        {evalRecord ? (
          <div className="space-y-4">
            {/* Inline import pattern or standalone summary render */}
            <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                  Mode 3 Vendor Evaluation Summary Report
                </span>
                <h3 className="text-xl font-bold mt-0.5">{evalRecord.vendorName}</h3>
                <p className="text-xs text-indigo-200/80 mt-0.5">{evalRecord.category} • Submitted: {evalRecord.submissionDate}</p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-black mono text-emerald-400">{evalRecord.overallScore}%</div>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 inline-block mt-1">
                  {evalRecord.status}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 text-xs text-emerald-900 dark:text-emerald-200">
              ⚡ <strong>Automated System Execution Action:</strong> {evalRecord.systemAction}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Commercial Terms (25%)</div>
                  <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mono mt-0.5">{evalRecord.moduleScores?.commercial?.weightedScore || 24} / 25 pts</div>
                </div>
                <div className="p-2 rounded bg-indigo-50/70 dark:bg-indigo-950/40 text-[10px] text-indigo-900 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.commercial?.remarks || 'Net 30 terms; 12-month fixed pricing with 5% volume tier discount.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Technical Specs (15%)</div>
                  <div className="text-lg font-bold text-sky-600 dark:text-cyan-400 mono mt-0.5">{evalRecord.moduleScores?.technical?.weightedScore || 13.5} / 15 pts</div>
                </div>
                <div className="p-2 rounded bg-sky-50/70 dark:bg-cyan-950/40 text-[10px] text-sky-900 dark:text-cyan-200 border border-sky-100 dark:border-cyan-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.technical?.remarks || '100% spec match; robotic CNC lines & accredited R&D lab.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Quality & Warranty (20%)</div>
                  <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mono mt-0.5">{evalRecord.moduleScores?.quality?.weightedScore || 18.4} / 20 pts</div>
                </div>
                <div className="p-2 rounded bg-emerald-50/70 dark:bg-emerald-950/40 text-[10px] text-emerald-900 dark:text-emerald-200 border border-emerald-100 dark:border-emerald-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.quality?.remarks || 'ISO 9001:2015 verified; 350 PPM defect rate with 24m warranty & RFID.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Delivery OTIF (20%)</div>
                  <div className="text-lg font-bold text-purple-600 dark:text-purple-400 mono mt-0.5">{evalRecord.moduleScores?.delivery?.weightedScore || 17.6} / 20 pts</div>
                </div>
                <div className="p-2 rounded bg-purple-50/70 dark:bg-purple-950/40 text-[10px] text-purple-900 dark:text-purple-200 border border-purple-100 dark:border-purple-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.delivery?.remarks || '96.4% OTIF delivery history; 10-day lead time & active BCP.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Financial Rating (10%)</div>
                  <div className="text-lg font-bold text-amber-600 dark:text-amber-400 mono mt-0.5">{evalRecord.moduleScores?.financial?.weightedScore || 8} / 10 pts</div>
                </div>
                <div className="p-2 rounded bg-amber-50/70 dark:bg-amber-950/40 text-[10px] text-amber-900 dark:text-amber-200 border border-amber-100 dark:border-amber-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.financial?.remarks || 'Turnover 4.2x scope; CRISIL A+ rating with 1.6 current liquidity.'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-1.5 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Governance & ESG (10%)</div>
                  <div className="text-lg font-bold text-rose-600 dark:text-rose-400 mono mt-0.5">{evalRecord.moduleScores?.governance?.weightedScore || 9.4} / 10 pts</div>
                </div>
                <div className="p-2 rounded bg-rose-50/70 dark:bg-rose-950/40 text-[10px] text-rose-900 dark:text-rose-200 border border-rose-100 dark:border-rose-800">
                  <strong>Remarks:</strong> {evalRecord.moduleScores?.governance?.remarks || '100% KYC verified; ISO 14001 & 45001 ESG certs with ISO 27001 GDPR.'}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 space-y-2 text-xs">
              <div className="font-bold text-slate-800 dark:text-gray-200">Verified Statutory PDFs & Certifications</div>
              <div className="space-y-1.5">
                {(evalRecord.documents || []).map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between p-2 rounded bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-[11px]">
                    <span className="font-semibold text-slate-700 dark:text-gray-200">{doc.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">✓ {doc.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-gray-800">
              <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
              <button onClick={onClose} className="btn btn-primary btn-sm"><Download size={13} /> Download Report (PDF)</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════
   1. ACTIVE PIPELINE MODAL
════════════════════════════════════════════════════════════════════════════════ */
interface ActivePipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqs: RFQItem[];
  onOpenDeepDive: (rfq: RFQItem) => void;
  onNavigateToMatrix: (rfq: RFQItem) => void;
}

export function ActivePipelineModal({
  isOpen,
  onClose,
  rfqs,
  onOpenDeepDive,
  onNavigateToMatrix,
}: ActivePipelineModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_evaluation' | 'ai_recommended' | 'quotes_received'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'email_gateway' | 'web_portal' | 'manual_entry'>('all');

  const totalActiveRFQs = rfqs.length;
  const inEvaluationCount = rfqs.filter((r) => r.status === 'In Evaluation').length;
  const aiRecommendedCount = rfqs.filter((r) => r.status === 'AI Recommended').length;
  const quotesPendingCount = rfqs.filter((r) => r.status === 'Quotes Pending' || r.status === 'Parsing').length;
  const totalQuotes = rfqs.reduce((acc, r) => acc + (r.quotesCount || (r.quotes ? r.quotes.length : 0)), 0);

  const filteredRfqs = rfqs.filter((rfq) => {
    if (statusFilter === 'in_evaluation' && rfq.status !== 'In Evaluation') return false;
    if (statusFilter === 'ai_recommended' && rfq.status !== 'AI Recommended') return false;
    if (statusFilter === 'quotes_received') {
      const qCount = rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0);
      if (rfq.status !== 'Quotes Received' && qCount === 0) return false;
    }

    if (sourceFilter === 'email_gateway' && rfq.source !== 'email_gateway' && rfq.source !== 'email_upload') return false;
    if (sourceFilter === 'web_portal' && rfq.source !== 'web_portal' && rfq.source !== 'ai_extraction' && rfq.source && rfq.source !== 'manual_entry') return false;
    if (sourceFilter === 'manual_entry' && rfq.source !== 'manual_entry') return false;

    if (!searchTerm) return true;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;

    const matchesLineItems = (rfq.extractedEntities || []).some(
      (item) => ((item.itemName || '') + ' ' + (item.technicalSpecs || '') + ' ' + (item.category || '')).toLowerCase().includes(term)
    );
    const matchesVendors = (rfq.assignedVendors || []).some(
      (v) => ((v.name || '') + ' ' + (v.contactPerson || '') + ' ' + (v.email || '')).toLowerCase().includes(term)
    );

    return (
      (rfq.rfqNumber || '').toLowerCase().includes(term) ||
      (rfq.title || '').toLowerCase().includes(term) ||
      (rfq.category || '').toLowerCase().includes(term) ||
      (rfq.status && rfq.status.toLowerCase().includes(term)) ||
      (rfq.source && rfq.source.toLowerCase().includes(term)) ||
      (rfq.sourcingMode && rfq.sourcingMode.toLowerCase().includes(term)) ||
      (rfq.targetDeliveryDate && rfq.targetDeliveryDate.toLowerCase().includes(term)) ||
      matchesLineItems ||
      matchesVendors
    );
  });

  if (!isOpen) return null;

  const getSourceBadge = (source?: string) => {
    if (source === 'email_gateway' || source === 'email_upload') {
      return (
        <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0">
          <span>via Email Upload</span>
        </span>
      );
    }
    if (source === 'manual_entry') {
      return (
        <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
          <span>Manual RFQ Form</span>
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
        <span>AI RFQ Ingestion</span>
      </span>
    );
  };

  const getModeBadge = (modeId: string) => {
    const mode = SOURCING_MODES.find((m) => m.id === modeId);
    if (!mode) return null;
    return (
      <span
        className="px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide"
        style={{
          backgroundColor: `${mode.badgeColor}15`,
          color: mode.badgeColor,
          border: `1px solid ${mode.badgeColor}35`,
        }}
      >
        {mode.code} ({mode.shortLabel})
      </span>
    );
  };

  const getStatusBadge = (status: RFQItem['status']) => {
    switch (status) {
      case 'AI Recommended':
        return <span className="badge badge-emerald text-xs px-2.5 py-1">AI Recommended</span>;
      case 'In Evaluation':
        return <span className="badge badge-blue text-xs px-2.5 py-1">In Evaluation</span>;
      case 'Quotes Received':
        return <span className="badge badge-blue text-xs px-2.5 py-1">Quotes Received</span>;
      case 'PO Generated':
        return <span className="badge badge-purple text-xs px-2.5 py-1">PO Generated</span>;
      case 'Parsing':
        return <span className="badge badge-amber text-xs px-2.5 py-1">OCR Parsing</span>;
      default:
        return <span className="badge badge-blue text-xs px-2.5 py-1">{status}</span>;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-6xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 shadow-xs">
              <Layers size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Active Procurement Pipeline</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                  {totalActiveRFQs} Total Requisitions
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                Comprehensive tracking of live RFQs, multi-channel response telemetry, and quote evaluation states.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={22} />
          </button>
        </div>

        {/* Metrics Banner (Interactive Filter Cards) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 my-4 shrink-0">
          <div
            onClick={() => setStatusFilter('all')}
            className={`p-3.5 rounded-xl border shadow-xs cursor-pointer transition-all ${
              statusFilter === 'all'
                ? 'bg-slate-100 dark:bg-gray-800 border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-500/20'
                : 'bg-slate-50 dark:bg-gray-800/60 border-slate-200 dark:border-gray-700 hover:border-slate-400'
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">Total Active Requisitions</div>
            <div className="text-2xl font-black text-slate-900 dark:text-white mono mt-1">{totalActiveRFQs}</div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">100% On Schedule</div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'in_evaluation' ? 'all' : 'in_evaluation')}
            className={`p-3.5 rounded-xl border shadow-xs cursor-pointer transition-all ${
              statusFilter === 'in_evaluation'
                ? 'bg-blue-100 dark:bg-blue-950/80 border-blue-500 ring-2 ring-blue-500/20'
                : 'bg-blue-50/60 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/40 hover:border-blue-400'
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">In Evaluation</div>
            <div className="text-2xl font-black text-blue-900 dark:text-blue-200 mono mt-1">{inEvaluationCount}</div>
            <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold mt-0.5">Parametric Scoring Active</div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'ai_recommended' ? 'all' : 'ai_recommended')}
            className={`p-3.5 rounded-xl border shadow-xs cursor-pointer transition-all ${
              statusFilter === 'ai_recommended'
                ? 'bg-emerald-100 dark:bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500/20'
                : 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40 hover:border-emerald-400'
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">AI Recommended</div>
            <div className="text-2xl font-black text-emerald-900 dark:text-emerald-200 mono mt-1">{aiRecommendedCount}</div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">Ready for PO Approval</div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'quotes_received' ? 'all' : 'quotes_received')}
            className={`p-3.5 rounded-xl border shadow-xs cursor-pointer transition-all ${
              statusFilter === 'quotes_received'
                ? 'bg-purple-100 dark:bg-purple-950/80 border-purple-500 ring-2 ring-purple-500/20'
                : 'bg-purple-50/60 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800/40 hover:border-purple-400'
            }`}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">Total Quotes Received</div>
            <div className="text-2xl font-black text-purple-900 dark:text-purple-200 mono mt-1">{totalQuotes}</div>
            <div className="text-xs text-purple-600 dark:text-purple-400 font-semibold mt-0.5">Across All Modes</div>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="space-y-2 mb-3 pb-3 border-b border-slate-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1 w-full">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by RFQ number, title, category, or status..."
                className="has-leading-icon w-full pl-10 pr-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {(statusFilter !== 'all' || sourceFilter !== 'all' || searchTerm) && (
              <button
                onClick={() => {
                  setStatusFilter('all');
                  setSourceFilter('all');
                  setSearchTerm('');
                }}
                className="btn btn-ghost btn-sm text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
              >
                Reset Filters
              </button>
            )}
          </div>

          {/* Quick Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] pt-1">
            <span className="text-slate-400 dark:text-gray-500 text-[10px] uppercase font-bold mr-1">Source:</span>
            <button
              onClick={() => setSourceFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                sourceFilter === 'all'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSourceFilter('email_gateway')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                sourceFilter === 'email_gateway'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40'
              }`}
            >
              via Email Upload
            </button>
            <button
              onClick={() => setSourceFilter('web_portal')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                sourceFilter === 'web_portal'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/40'
              }`}
            >
              AI RFQ Ingestion
            </button>
            <button
              onClick={() => setSourceFilter('manual_entry')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                sourceFilter === 'manual_entry'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40'
              }`}
            >
              Manual RFQ
            </button>
          </div>
        </div>

        {/* Requisitions List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[300px]">
          {filteredRfqs.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-gray-500">
              <FileText size={36} className="mx-auto mb-2 opacity-40 text-indigo-500" />
              <p className="text-sm font-bold text-slate-700 dark:text-gray-300">No matching requisitions found</p>
              <p className="text-xs mt-1 text-slate-400">Try adjusting your search query or status/source filters.</p>
            </div>
          ) : (
            filteredRfqs.map((rfq) => (
              <div
                key={rfq.id}
                className="p-4 rounded-xl bg-slate-50/80 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black mono text-indigo-600 dark:text-indigo-400">{rfq.rfqNumber}</span>
                    {getSourceBadge(rfq.source)}
                    {getModeBadge(rfq.sourcingMode)}
                    {getStatusBadge(rfq.status)}
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-gray-700 text-slate-800 dark:text-gray-200 mono">
                      {rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0)} quotes received
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">{rfq.title}</h3>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600 dark:text-gray-300">
                    <div>
                      Category: <strong className="text-slate-800 dark:text-gray-100">{rfq.category}</strong>
                    </div>
                    <div>
                      Target Delivery: <strong className="text-slate-800 dark:text-gray-100">{rfq.targetDeliveryDate || 'Standard'}</strong>
                    </div>
                    <div>
                      Estimated Budget: <strong className="text-slate-800 dark:text-gray-100">{rfq.budget > 0 ? `₹${rfq.budget.toLocaleString()}` : 'Unspecified'}</strong>
                    </div>
                  </div>

                  {rfq.followUpData && (
                    <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-600 dark:text-gray-300 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 font-semibold border border-purple-200 dark:border-purple-800">
                        📞 {rfq.followUpData.callStats.connected}/{rfq.followUpData.callStats.total} Calls
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800">
                        💬 {rfq.followUpData.whatsappStats.read}/{rfq.followUpData.whatsappStats.total} WA Read
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-sky-50 dark:bg-cyan-950/50 text-sky-700 dark:text-cyan-300 font-semibold border border-sky-200 dark:border-cyan-800">
                        📱 {rfq.followUpData.smsStats.delivered} SMS
                      </span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-bold ml-1">
                        {rfq.followUpData.respondedCount}/{rfq.followUpData.totalInvited} vendors responded
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0">
                  <Link
                    href={`/buyer/rfq-details?rfq=${encodeURIComponent(rfq.rfqNumber)}`}
                    onClick={onClose}
                    className="btn btn-secondary btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                    title="View RFQ Details"
                  >
                    <Eye size={13} /> View RFQ
                  </Link>

                  {((rfq.quotesCount && rfq.quotesCount > 0) || (rfq.quotes && rfq.quotes.length > 0) || rfq.status === 'AI Recommended' || rfq.status === 'In Evaluation') && (
                    <button
                      onClick={() => {
                        onClose();
                        onNavigateToMatrix(rfq);
                      }}
                      className="btn btn-emerald btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                      title="View Quotes"
                    >
                      <Sparkles size={13} /> View Quotes
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 shrink-0">
          <span>Showing {filteredRfqs.length} of {totalActiveRFQs} requisitions</span>
          <button onClick={onClose} className="btn btn-secondary btn-sm font-bold px-4">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════
   2. INTAKE SOURCES MODAL
════════════════════════════════════════════════════════════════════════════════ */
interface IntakeSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqs: RFQItem[];
  onOpenDeepDive: (rfq: RFQItem) => void;
  onNavigateToMatrix?: (rfq: RFQItem) => void;
}

export function IntakeSourcesModal({
  isOpen,
  onClose,
  rfqs,
  onOpenDeepDive,
  onNavigateToMatrix,
}: IntakeSourcesModalProps) {
  const [selectedSourceTab, setSelectedSourceTab] = useState<'all' | 'email_gateway' | 'web_portal' | 'manual_entry'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const totalActiveRFQs = rfqs.length;
  const emailGatewayRFQs = rfqs.filter((r) => r.source === 'email_gateway' || r.source === 'email_upload');
  const webPortalRFQs = rfqs.filter((r) => r.source === 'web_portal' || r.source === 'ai_extraction' || (!r.source && r.source !== 'manual_entry'));
  const manualRFQs = rfqs.filter((r) => r.source === 'manual_entry');

  const filteredRfqs = rfqs.filter((rfq) => {
    if (!rfq) return false;
    const matchesTab =
      selectedSourceTab === 'all'
        ? true
        : selectedSourceTab === 'web_portal'
        ? rfq.source === 'web_portal' || rfq.source === 'ai_extraction' || (!rfq.source && rfq.source !== 'manual_entry')
        : selectedSourceTab === 'email_gateway'
        ? rfq.source === 'email_gateway' || rfq.source === 'email_upload'
        : rfq.source === selectedSourceTab;

    if (!matchesTab) return false;
    if (!searchTerm || !searchTerm.trim()) return true;
    const term = searchTerm.trim().toLowerCase();

    return (
      String(rfq.rfqNumber || '').toLowerCase().includes(term) ||
      String(rfq.title || '').toLowerCase().includes(term) ||
      String(rfq.category || '').toLowerCase().includes(term) ||
      String(rfq.status || '').toLowerCase().includes(term) ||
      String(rfq.sourceEmail || '').toLowerCase().includes(term) ||
      String(rfq.sourceFileName || '').toLowerCase().includes(term)
    );
  });

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-6xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-amber-200 dark:border-amber-900/50 animate-fade-in max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shadow-xs">
              <Mail size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Requisitions by Intake Source</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  3 Ingestion Channels
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                Channel-by-channel origin verification across Autonomous via Email Upload, Web Portal AI OCR, and Manual Entry.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={22} />
          </button>
        </div>

        {/* 3 Source Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 my-4 shrink-0">
          {/* via Email Upload */}
          <div
            onClick={() => setSelectedSourceTab('email_gateway')}
            className={`p-4 rounded-xl border transition-all cursor-pointer shadow-xs ${
              selectedSourceTab === 'email_gateway'
                ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-400 dark:border-amber-500 ring-2 ring-amber-400/20'
                : 'bg-white dark:bg-gray-800/60 border-amber-200 dark:border-amber-900/40 hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-amber-700 dark:text-amber-400">
              <span>via Email Upload</span>
              <span className="mono text-xs font-black">
                {totalActiveRFQs > 0 ? Math.round((emailGatewayRFQs.length / totalActiveRFQs) * 100) : 0}%
              </span>
            </div>
            <div className="text-2xl font-black text-amber-900 dark:text-amber-200 mono mt-2">
              {emailGatewayRFQs.length} <span className="text-xs font-normal text-slate-500">RFQs</span>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 font-medium">
              ⚡ Autonomous Ingestion · Auto-circulated
            </p>
          </div>

          {/* AI RFQ Create */}
          <div
            onClick={() => setSelectedSourceTab('web_portal')}
            className={`p-4 rounded-xl border transition-all cursor-pointer shadow-xs ${
              selectedSourceTab === 'web_portal'
                ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-400/20'
                : 'bg-white dark:bg-gray-800/60 border-indigo-200 dark:border-indigo-900/40 hover:border-indigo-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-indigo-700 dark:text-indigo-400">
              <span>AI RFQ Create</span>
              <span className="mono text-xs font-black">
                {totalActiveRFQs > 0 ? Math.round((webPortalRFQs.length / totalActiveRFQs) * 100) : 0}%
              </span>
            </div>
            <div className="text-2xl font-black text-indigo-900 dark:text-indigo-200 mono mt-2">
              {webPortalRFQs.length} <span className="text-xs font-normal text-slate-500">RFQs</span>
            </div>
            <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-1 font-medium">
              📄 Web Portal BOQ PDF/Excel Ingest
            </p>
          </div>

          {/* Manual RFQ */}
          <div
            onClick={() => setSelectedSourceTab('manual_entry')}
            className={`p-4 rounded-xl border transition-all cursor-pointer shadow-xs ${
              selectedSourceTab === 'manual_entry'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-400 dark:border-emerald-500 ring-2 ring-emerald-400/20'
                : 'bg-white dark:bg-gray-800/60 border-emerald-200 dark:border-emerald-900/40 hover:border-emerald-300'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-400">
              <span>Manual RFQ</span>
              <span className="mono text-xs font-black">
                {totalActiveRFQs > 0 ? Math.round((manualRFQs.length / totalActiveRFQs) * 100) : 0}%
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-900 dark:text-emerald-200 mono mt-2">
              {manualRFQs.length} <span className="text-xs font-normal text-slate-500">RFQs</span>
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1 font-medium">
              ✍️ Parametric Line-Item Entry Form
            </p>
          </div>
        </div>

        {/* Tab & Search Strip */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 mb-3 pb-3 border-b border-slate-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
            <button
              onClick={() => setSelectedSourceTab('all')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                selectedSourceTab === 'all'
                  ? 'bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-xs'
                  : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-slate-200'
              }`}
            >
              All Channels ({rfqs.length})
            </button>
            <button
              onClick={() => setSelectedSourceTab('email_gateway')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                selectedSourceTab === 'email_gateway'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40'
              }`}
            >
              via Email Upload ({emailGatewayRFQs.length})
            </button>
            <button
              onClick={() => setSelectedSourceTab('web_portal')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                selectedSourceTab === 'web_portal'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/40'
              }`}
            >
              AI RFQ Create ({webPortalRFQs.length})
            </button>
            <button
              onClick={() => setSelectedSourceTab('manual_entry')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                selectedSourceTab === 'manual_entry'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40'
              }`}
            >
              Manual RFQ ({manualRFQs.length})
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter by origin or title..."
              className="has-leading-icon w-full pl-10 pr-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* Source Items List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[300px]">
          {filteredRfqs.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-gray-500">
              <Mail size={36} className="mx-auto mb-2 opacity-40 text-amber-500" />
              <p className="text-sm font-bold text-slate-700 dark:text-gray-300">No requisitions from this intake source</p>
              <p className="text-xs mt-1 text-slate-400">Send an RFQ email to your corporate gateway or use AI RFQ generator to ingest.</p>
            </div>
          ) : (
            filteredRfqs.map((rfq) => (
              <div
                key={rfq.id}
                className="p-4 rounded-xl bg-slate-50/80 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 hover:border-amber-400 dark:hover:border-amber-600 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black mono text-indigo-600 dark:text-indigo-400">{rfq.rfqNumber}</span>
                    {(rfq.source === 'email_gateway' || rfq.source === 'email_upload') && (
                      <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1.5">
                        Origin: {rfq.sourceEmail || rfq.sourceFileName || 'Autonomous Corporate via Email Upload'}
                      </span>
                    )}
                    {rfq.source === 'manual_entry' && (
                      <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1.5">
                        Direct Keyed Requisition
                      </span>
                    )}
                    {(rfq.source === 'web_portal' || rfq.source === 'ai_extraction' || (!rfq.source && rfq.source !== 'manual_entry')) && (
                      <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800 flex items-center gap-1.5">
                        Document: {rfq.sourceFileName || 'Uploaded BOQ Document'}
                      </span>
                    )}
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-gray-700 text-slate-800 dark:text-gray-200">
                      {rfq.status}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">{rfq.title}</h3>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600 dark:text-gray-300">
                    <div>
                      Category: <strong className="text-slate-800 dark:text-gray-100">{rfq.category}</strong>
                    </div>
                    <div>
                      Extracted Items: <strong className="text-slate-800 dark:text-gray-100">{rfq.extractedEntities?.length || 1} items</strong>
                    </div>
                    <div>
                      Quotes Received: <strong className="text-slate-800 dark:text-gray-100">{rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0)}</strong>
                    </div>
                  </div>
                </div>

                <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0">
                  <Link
                    href={`/buyer/rfq-details?rfq=${encodeURIComponent(rfq.rfqNumber)}`}
                    onClick={onClose}
                    className="btn btn-secondary btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                    title="View RFQ Details"
                  >
                    <Eye size={13} /> View RFQ
                  </Link>

                  {((rfq.quotesCount && rfq.quotesCount > 0) || (rfq.quotes && rfq.quotes.length > 0) || rfq.status === 'AI Recommended' || rfq.status === 'In Evaluation') && (
                    <button
                      onClick={() => {
                        onClose();
                        if (onNavigateToMatrix) {
                          onNavigateToMatrix(rfq);
                        } else {
                          onOpenDeepDive(rfq);
                        }
                      }}
                      className="btn btn-emerald btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                      title="View Quotes"
                    >
                      <Sparkles size={13} /> View Quotes
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Informational Box */}
        <div className="mt-3.5 p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5 shrink-0">
          <Info size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            <strong>Autonomous Routing Pipeline:</strong> Inbound RFQ emails are instantly parsed via LLM OCR to extract BOQs and match empanelled vendor rosters before initiating multi-channel chasers.
          </span>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3.5 mt-2 border-t border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 shrink-0">
          <span>Showing {filteredRfqs.length} requisitions in selected channel</span>
          <button onClick={onClose} className="btn btn-secondary btn-sm font-bold px-4">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════════
   3. SUPPLIER QUOTES MODAL
════════════════════════════════════════════════════════════════════════════════ */
interface SupplierQuotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqs: RFQItem[];
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onOpenDeepDive: (rfq: RFQItem) => void;
}

export function SupplierQuotesModal({
  isOpen,
  onClose,
  rfqs,
  onNavigateToMatrix,
  onOpenDeepDive,
}: SupplierQuotesModalProps) {
  const [searchTerm, setSearchTerm] = useState('');

  // Flatten quotes across active RFQs
  const allQuotesWithRfq = useMemo(() => {
    const list: Array<{ quote: QuoteComparison; rfq: RFQItem }> = [];
    rfqs.forEach((rfq) => {
      if (rfq.quotes && rfq.quotes.length > 0) {
        rfq.quotes.forEach((quote) => {
          list.push({ quote, rfq });
        });
      }
    });
    return list;
  }, [rfqs]);

  if (!isOpen) return null;

  const totalQuotesCount = allQuotesWithRfq.length;
  const inEvaluationRfqs = rfqs.filter((r) => r.status === 'In Evaluation' || r.status === 'AI Recommended');
  const bestScore = allQuotesWithRfq.length > 0 ? Math.max(...allQuotesWithRfq.map((q) => q.quote.aiMatchScore || 0)) : 0;
  const compliantQuotesCount = allQuotesWithRfq.filter((q) => q.quote.complianceStatus === 'Fully Compliant').length;

  const filteredQuotes = allQuotesWithRfq.filter(({ quote, rfq }) => {
    if (!quote || !rfq) return false;
    if (!searchTerm || !searchTerm.trim()) return true;
    const term = searchTerm.trim().toLowerCase();
    return (
      String(quote.vendorName || '').toLowerCase().includes(term) ||
      String(quote.vendorCategory || '').toLowerCase().includes(term) ||
      String(rfq.rfqNumber || '').toLowerCase().includes(term) ||
      String(rfq.title || '').toLowerCase().includes(term) ||
      String(rfq.category || '').toLowerCase().includes(term) ||
      String(quote.complianceStatus || '').toLowerCase().includes(term)
    );
  });

  const sortedQuotes = [...filteredQuotes].sort((a, b) => {
    return (b.quote.aiMatchScore || 0) - (a.quote.aiMatchScore || 0);
  });

  const getComplianceBadge = (status: QuoteComparison['complianceStatus']) => {
    switch (status) {
      case 'Fully Compliant':
        return <span className="badge badge-emerald text-xs px-2.5 py-1">✓ Fully Compliant</span>;
      case 'Minor Exception':
        return <span className="badge badge-amber text-xs px-2.5 py-1">⚠ Minor Exception</span>;
      default:
        return <span className="badge badge-blue text-xs px-2.5 py-1">⏳ {status || 'Pending Review'}</span>;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-6xl p-6 sm:p-7 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-sky-200 dark:border-cyan-900/50 animate-fade-in max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-sky-50 dark:bg-cyan-950/60 text-sky-600 dark:text-cyan-400 border border-sky-200 dark:border-cyan-800 shadow-xs">
              <Clock size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Supplier Quotes & Evaluation Matrix</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-100 dark:bg-cyan-950 text-sky-800 dark:text-cyan-300 border border-sky-300 dark:border-cyan-800">
                  {totalQuotesCount} Received Bids
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                Consolidated parametric view of supplier price quotations, lead times, compliance ratings, and AI match scores.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={22} />
          </button>
        </div>

        {/* Top KPI Metrics Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 my-4 shrink-0">
          <div className="p-3.5 rounded-xl bg-sky-50/60 dark:bg-cyan-950/30 border border-sky-200 dark:border-cyan-800/40 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-700 dark:text-cyan-400">Total Bids Ingested</div>
            <div className="text-2xl font-black text-sky-900 dark:text-cyan-100 mono mt-1">{totalQuotesCount}</div>
            <div className="text-xs text-sky-600 dark:text-cyan-400 font-semibold mt-0.5">Across all active RFQs</div>
          </div>

          <div className="p-3.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">In Evaluation</div>
            <div className="text-2xl font-black text-blue-900 dark:text-blue-200 mono mt-1">{inEvaluationRfqs.length}</div>
            <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold mt-0.5">RFQs under review</div>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Top Match Score</div>
            <div className="text-2xl font-black text-emerald-900 dark:text-emerald-200 mono mt-1">
              {bestScore > 0 ? `${bestScore}%` : 'N/A'}
            </div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">Highest AI parametric match</div>
          </div>

          <div className="p-3.5 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">Fully Compliant Bids</div>
            <div className="text-2xl font-black text-purple-900 dark:text-purple-200 mono mt-1">{compliantQuotesCount}</div>
            <div className="text-xs text-purple-600 dark:text-purple-400 font-semibold mt-0.5">Technical specs verified</div>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="flex items-center gap-2.5 mb-3 pb-3 border-b border-slate-100 dark:border-gray-800 shrink-0">
          <div className="relative flex-1 w-full">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by vendor name, item title, or RFQ..."
              className="has-leading-icon w-full pl-10 pr-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </div>

        {/* Quotes List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[300px]">
          {sortedQuotes.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-gray-500">
              <Clock size={36} className="mx-auto mb-2 opacity-40 text-sky-500" />
              <p className="text-sm font-bold text-slate-700 dark:text-gray-300">No supplier quotes found</p>
              <p className="text-xs mt-1 text-slate-400">
                {rfqs.length > 0
                  ? 'Suppliers have been invited and autonomous follow-ups are chasing bids.'
                  : 'Create or ingest an RFQ to start receiving supplier quotes.'}
              </p>
              {rfqs.length > 0 && (
                <button
                  onClick={() => {
                    onClose();
                    onNavigateToMatrix(rfqs[0]);
                  }}
                  className="btn btn-secondary btn-sm font-bold mt-3 inline-flex items-center gap-1.5"
                >
                  <Sparkles size={13} /> View Quotes
                </button>
              )}
            </div>
          ) : (
            sortedQuotes.map(({ quote, rfq }, idx) => (
              <div
                key={`${rfq.id}-${quote.vendorId}-${idx}`}
                className="p-4 rounded-xl bg-slate-50/80 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-800 hover:border-sky-400 dark:hover:border-sky-600 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black mono text-indigo-600 dark:text-indigo-400">{rfq.rfqNumber}</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Building2 size={14} className="text-slate-400" /> {quote.vendorName}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-600">
                      {quote.vendorCategory || 'Client List'}
                    </span>
                    {quote.isBestPrice && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300">
                        ⚡ Lowest Quoted Price
                      </span>
                    )}
                    {getComplianceBadge(quote.complianceStatus)}
                  </div>

                  <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">{rfq.title}</p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-xs">
                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Quoted Price</span>
                      <span className="text-sm font-black text-slate-900 dark:text-white mono">
                        ₹{(quote.totalPrice || quote.unitPrice || 0).toLocaleString()}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Lead Time</span>
                      <span className="text-sm font-bold text-slate-800 dark:text-gray-200 mono">
                        {quote.leadTimeDays ? `${quote.leadTimeDays} Days` : 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">AI Match Score</span>
                      <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 mono">
                        {quote.aiMatchScore !== undefined ? `${quote.aiMatchScore}%` : 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-100 dark:border-gray-800 shadow-2xs">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Warranty & Terms</span>
                      <span className="text-xs text-slate-700 dark:text-gray-300 font-semibold truncate block">
                        {quote.warrantyYears ? `${quote.warrantyYears} yr` : 'N/A'}{quote.paymentTerms ? ` • ${quote.paymentTerms}` : ''}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0">
                  <Link
                    href={`/buyer/rfq-details?rfq=${encodeURIComponent(rfq.rfqNumber)}`}
                    onClick={onClose}
                    className="btn btn-secondary btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                    title="View RFQ Details"
                  >
                    <Eye size={13} /> View RFQ
                  </Link>

                  <button
                    onClick={() => {
                      onClose();
                      onNavigateToMatrix(rfq);
                    }}
                    className="btn btn-primary btn-sm font-bold flex items-center gap-1.5 w-full justify-center shadow-xs"
                    title="View Quotes"
                  >
                    <Sparkles size={13} /> View Quotes
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-200 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 shrink-0">
          <span>Showing {sortedQuotes.length} quotes across active pipeline</span>
          <button onClick={onClose} className="btn btn-secondary btn-sm font-bold px-4">Close</button>
        </div>
      </div>
    </div>
  );
}

