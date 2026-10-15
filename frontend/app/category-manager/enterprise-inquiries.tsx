'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import { formatIndianDateTime } from '@/lib/constants';
import {
  Building2,
  Mail,
  Phone,
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  MessageCircle,
  FileText,
  UserCheck,
  ChevronRight,
  X,
  ExternalLink,
  Shield,
  Briefcase,
} from 'lucide-react';

export type EnterpriseInquiryStatus = 'NEW' | 'CONTACTED' | 'IN_DISCUSSION' | 'CONTRACT_SIGNED' | 'CLOSED';

export interface EnterpriseInquiry {
  id: string;
  companyName: string;
  email: string;
  mobile: string;
  buyerAccountId?: string | null;
  notes?: string;
  status: EnterpriseInquiryStatus;
  contactedBy?: string;
  contactedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

const STATUS_LABELS: Record<EnterpriseInquiryStatus, { label: string; badge: string; dot: string }> = {
  NEW: {
    label: 'New — Action Required',
    badge: 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700/80',
    dot: 'bg-amber-500 animate-pulse',
  },
  CONTACTED: {
    label: 'Contacted',
    badge: 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700/80',
    dot: 'bg-indigo-500',
  },
  IN_DISCUSSION: {
    label: 'In Discussion',
    badge: 'bg-sky-100 dark:bg-sky-950/80 text-sky-800 dark:text-sky-200 border-sky-300 dark:border-sky-700/80',
    dot: 'bg-sky-500',
  },
  CONTRACT_SIGNED: {
    label: 'Contract Signed',
    badge: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700/80',
    dot: 'bg-emerald-500',
  },
  CLOSED: {
    label: 'Closed / Inactive',
    badge: 'bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border-slate-200 dark:border-gray-700',
    dot: 'bg-slate-400',
  },
};

const DEFAULT_SEED_INQUIRIES: EnterpriseInquiry[] = [
  {
    id: 'ent-inq-1792066342226-1vkew',
    companyName: 'Procucev  Navin Buyer',
    email: 'navin.procucev@gmail.com',
    mobile: '+919157154504',
    buyerAccountId: '4fdcc92c-8421-4ab5-8258-0134375a3c86',
    notes: '',
    status: 'NEW',
    createdAt: '2026-10-15T12:12:22.226Z',
    updatedAt: '2026-10-15T12:12:22.226Z',
  },
];

export default function EnterpriseInquiriesConsole() {
  const { showToast, currentUserSession } = useApp();

  const [inquiries, setInquiries] = useState<EnterpriseInquiry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | EnterpriseInquiryStatus>('ALL');
  const [selectedInquiry, setSelectedInquiry] = useState<EnterpriseInquiry | null>(null);
  const [editingNotes, setEditingNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const fetchInquiries = async () => {
    setLoading(true);
    let serverInquiries: EnterpriseInquiry[] = [];
    try {
      const res = await fetch('/api/enterprise-inquiries');
      const json = await res.json();
      if (json && json.success && Array.isArray(json.data)) {
        serverInquiries = json.data;
      }
    } catch {
      // Graceful offline fallback
    }

    let localInquiries: EnterpriseInquiry[] = [];
    try {
      const stored = localStorage.getItem('procucev_enterprise_inquiries');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) localInquiries = parsed;
      }
    } catch (_) {}

    const map = new Map<string, EnterpriseInquiry>();
    if (serverInquiries.length > 0) {
      for (const item of serverInquiries) {
        if (item && item.id) map.set(item.id, item);
      }
      // Also include any locally created inquiries not yet synced to server
      for (const item of localInquiries) {
        if (item && item.id && !map.has(item.id)) map.set(item.id, item);
      }
    } else {
      // Cold start / offline fallback: load default seed and locally submitted inquiries
      for (const item of DEFAULT_SEED_INQUIRIES) {
        if (item && item.id) map.set(item.id, item);
      }
      for (const item of localInquiries) {
        if (item && item.id) map.set(item.id, item);
      }
    }

    const merged = Array.from(map.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    setInquiries(merged);
    try {
      localStorage.setItem('procucev_enterprise_inquiries', JSON.stringify(merged));
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => {
    void fetchInquiries();
  }, []);

  // Update status or notes on an inquiry
  const handleUpdateInquiry = async (
    id: string,
    updates: { status?: EnterpriseInquiryStatus; notes?: string }
  ) => {
    setSavingNotes(true);
    let updatedRecord: EnterpriseInquiry | null = null;
    try {
      const res = await fetch(`/api/enterprise-inquiries/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...updates,
          contactedBy: currentUserSession?.name || 'Category Manager',
        }),
      });
      const json = await res.json().catch(() => null);
      if (json && json.success && json.data) {
        updatedRecord = json.data;
      }
    } catch {
      // Offline fallback
    }

    setInquiries((prev) => {
      const nextList = prev.map((item) => {
        if (item.id === id) {
          const merged: EnterpriseInquiry = updatedRecord
            ? { ...item, ...updatedRecord }
            : {
                ...item,
                ...updates,
                updatedAt: new Date().toISOString(),
                ...(updates.status && updates.status !== 'NEW'
                  ? {
                      contactedBy: currentUserSession?.name || 'Category Manager',
                      contactedAt: new Date().toISOString(),
                    }
                  : {}),
              };
          if (selectedInquiry?.id === id) {
            setSelectedInquiry(merged);
          }
          return merged;
        }
        return item;
      });
      try {
        localStorage.setItem('procucev_enterprise_inquiries', JSON.stringify(nextList));
      } catch (_) {}
      return nextList;
    });

    showToast('Lead Updated', 'Enterprise inquiry details saved.', 'success');
    setSavingNotes(false);
  };

  // Metrics
  const totalCount = inquiries.length;
  const newCount = inquiries.filter((i) => i.status === 'NEW').length;
  const inDiscussionCount = inquiries.filter((i) => i.status === 'IN_DISCUSSION' || i.status === 'CONTACTED').length;
  const signedCount = inquiries.filter((i) => i.status === 'CONTRACT_SIGNED').length;

  // Filtered
  const filteredInquiries = useMemo(() => {
    return inquiries.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesComp = item.companyName.toLowerCase().includes(q);
        const matchesEmail = item.email.toLowerCase().includes(q);
        const matchesMobile = item.mobile.toLowerCase().includes(q);
        const matchesNotes = (item.notes || '').toLowerCase().includes(q);
        if (!matchesComp && !matchesEmail && !matchesMobile && !matchesNotes) {
          return false;
        }
      }
      return true;
    });
  }, [inquiries, statusFilter, searchQuery]);

  // Clean phone number for tel/wa links
  const sanitizePhone = (phone: string) => phone.replace(/[^\d+]/g, '');

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-gray-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
              <Building2 size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Enterprise Contracts Inquiries
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  Screen 2.8
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400">
                Incoming leads for bulk volume contracts, custom ERP integrations, and custom buyer SLAs.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void fetchInquiries()}
          disabled={loading}
          className="btn btn-secondary text-xs px-3.5 py-2 self-start sm:self-auto flex items-center gap-2 rounded-xl"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? 'Refreshing...' : 'Refresh Leads'}</span>
        </button>
      </div>

      {/* ── KPI Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/70 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              Total Inquiries
            </span>
            <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
              <Briefcase size={16} />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
              {totalCount}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-gray-400 font-semibold">
              submissions
            </span>
          </div>
        </div>

        <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-amber-300 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/20 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              New / Pending
            </span>
            <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300">
              <AlertCircle size={16} />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-amber-900 dark:text-amber-100">
              {newCount}
            </span>
            <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">
              need outreach
            </span>
          </div>
        </div>

        <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-sky-300 dark:border-sky-800/60 bg-sky-50/40 dark:bg-sky-950/20 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-sky-800 dark:text-sky-300 uppercase tracking-wider">
              In Discussion
            </span>
            <div className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300">
              <UserCheck size={16} />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-sky-900 dark:text-sky-100">
              {inDiscussionCount}
            </span>
            <span className="text-[10px] text-sky-700 dark:text-sky-300 font-semibold">
              in talks
            </span>
          </div>
        </div>

        <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
              Contracts Signed
            </span>
            <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-emerald-900 dark:text-emerald-100">
              {signedCount}
            </span>
            <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold">
              converted
            </span>
          </div>
        </div>
      </div>

      {/* ── Filters & Search Bar ── */}
      <div className="glass-panel p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-gray-800/90 border border-slate-200/80 dark:border-gray-700/80 shadow-inner self-start sm:self-auto overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                statusFilter === 'ALL'
                  ? 'bg-white dark:bg-gray-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <span>All Leads</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-200 dark:bg-gray-700">
                {totalCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('NEW')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                statusFilter === 'NEW'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>New</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                statusFilter === 'NEW' ? 'bg-amber-600 text-white' : 'bg-amber-100 dark:bg-amber-900/60'
              }`}>
                {newCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('IN_DISCUSSION')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                statusFilter === 'IN_DISCUSSION'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-sky-700 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200'
              }`}
            >
              <span>In Discussion</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('CONTRACT_SIGNED')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                statusFilter === 'CONTRACT_SIGNED'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-200'
              }`}
            >
              <span>Signed</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                statusFilter === 'CONTRACT_SIGNED' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 dark:bg-emerald-900/60'
              }`}>
                {signedCount}
              </span>
            </button>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by company name, email, or phone..."
              className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-gray-200"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Leads List / Table ── */}
      <div className="glass-panel rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-xs overflow-hidden">
        {filteredInquiries.length === 0 ? (
          <div className="text-center py-16 px-4 space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-400 mx-auto flex items-center justify-center">
              <Building2 size={24} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-gray-200">
              No Enterprise Contract Inquiries Found
            </h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 max-w-sm mx-auto leading-relaxed">
              {searchQuery
                ? `No enterprise inquiries match "${searchQuery}". Try clearing your search.`
                : 'When buyers click "Contact Us" on the Enterprise Contracts banner in the Subscription Center, their contact submissions will appear right here.'}
            </p>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="btn btn-secondary text-xs px-4 py-1.5 rounded-lg"
              >
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-gray-800">
            {filteredInquiries.map((inq) => {
              const statusCfg = STATUS_LABELS[inq.status] || STATUS_LABELS.NEW;
              return (
                <div
                  key={inq.id}
                  className="p-4 sm:p-5 transition-all hover:bg-slate-50/80 dark:hover:bg-gray-800/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  {/* Left Column: Company & Contact Information */}
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Status Badge */}
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border flex items-center gap-1.5 ${statusCfg.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                        {statusCfg.label}
                      </span>

                      {/* Submission Timestamp */}
                      <span className="text-[11px] text-slate-400 dark:text-gray-500 flex items-center gap-1">
                        <Clock size={11} />
                        {inq.createdAt ? formatIndianDateTime(inq.createdAt) : 'Recent'}
                      </span>
                    </div>

                    {/* Company Name */}
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60 shrink-0">
                        <Building2 size={16} />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                          {inq.companyName}
                        </h3>
                      </div>
                    </div>

                    {/* Contact Details Grid */}
                    <div className="flex flex-wrap items-center gap-3 sm:gap-5 text-xs text-slate-600 dark:text-gray-300">
                      {/* Email */}
                      <a
                        href={`mailto:${inq.email}?subject=Enterprise%20Contract%20Inquiry%20-%20Procucev`}
                        className="flex items-center gap-1.5 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        <Mail size={13} className="text-slate-400 shrink-0" />
                        <span className="font-semibold">{inq.email}</span>
                      </a>

                      {/* Phone */}
                      <a
                        href={`tel:${sanitizePhone(inq.mobile)}`}
                        className="flex items-center gap-1.5 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        <Phone size={13} className="text-slate-400 shrink-0" />
                        <span className="font-mono font-semibold">{inq.mobile}</span>
                      </a>

                      {/* WhatsApp Direct */}
                      <a
                        href={`https://wa.me/${sanitizePhone(inq.mobile)}?text=Hi%20${encodeURIComponent(inq.companyName)}%2C%20thank%20you%20for%20your%20interest%20in%20Procucev%20Enterprise%20Contracts.`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
                      >
                        <MessageCircle size={13} />
                        <span>WhatsApp Chat</span>
                      </a>
                    </div>

                    {/* Notes preview if any */}
                    {inq.notes && (
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-gray-800/60 border border-slate-200/80 dark:border-gray-700/60 text-xs text-slate-700 dark:text-gray-300">
                        <span className="font-bold text-slate-900 dark:text-white">Internal Notes: </span>
                        <span>{inq.notes}</span>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Actions */}
                  <div className="flex sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-end gap-2 shrink-0">
                    {/* Status quick select */}
                    <select
                      value={inq.status}
                      onChange={(e) =>
                        handleUpdateInquiry(inq.id, {
                          status: e.target.value as EnterpriseInquiryStatus,
                        })
                      }
                      className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                    >
                      <option value="NEW">New Lead</option>
                      <option value="CONTACTED">Contacted</option>
                      <option value="IN_DISCUSSION">In Discussion</option>
                      <option value="CONTRACT_SIGNED">Contract Signed</option>
                      <option value="CLOSED">Closed</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedInquiry(inq);
                        setEditingNotes(inq.notes || '');
                      }}
                      className="btn btn-secondary text-xs px-3.5 py-2 rounded-xl flex items-center justify-center gap-1.5"
                    >
                      <FileText size={13} />
                      <span>Manage & Notes</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* LEAD DETAILS & NOTES MODAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {selectedInquiry && (
        <div className="modal-overlay">
          <div className="modal-content max-w-lg p-5 sm:p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-gray-800 animate-fade-in relative space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-200 dark:border-gray-800 gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                  <Building2 size={18} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    {selectedInquiry.companyName}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Enterprise Contracts Inquiry Details
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedInquiry(null)}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Contact Buttons */}
            <div className="grid grid-cols-3 gap-2">
              <a
                href={`tel:${sanitizePhone(selectedInquiry.mobile)}`}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-center flex flex-col items-center gap-1 transition-all"
              >
                <Phone size={16} className="text-indigo-600 dark:text-indigo-400" />
                <span className="text-[11px] font-bold">Call Now</span>
              </a>

              <a
                href={`https://wa.me/${sanitizePhone(selectedInquiry.mobile)}?text=Hi%20${encodeURIComponent(selectedInquiry.companyName)}%2C%20thank%20you%20for%20your%20interest%20in%20Procucev%20Enterprise%20Contracts.`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-center flex flex-col items-center gap-1 transition-all"
              >
                <MessageCircle size={16} className="text-emerald-600 dark:text-emerald-400" />
                <span className="text-[11px] font-bold">WhatsApp</span>
              </a>

              <a
                href={`mailto:${selectedInquiry.email}?subject=Procucev%20Enterprise%20Contracts%20-%20Discussion`}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/60 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-center flex flex-col items-center gap-1 transition-all"
              >
                <Mail size={16} className="text-sky-600 dark:text-sky-400" />
                <span className="text-[11px] font-bold">Send Email</span>
              </a>
            </div>

            {/* Information Grid */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200/80 dark:border-gray-700/60 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-gray-400 font-bold">Email ID:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{selectedInquiry.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-gray-400 font-bold">Mobile Number:</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white">{selectedInquiry.mobile}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-gray-400 font-bold">Received At:</span>
                <span className="text-slate-700 dark:text-gray-300">
                  {selectedInquiry.createdAt ? formatIndianDateTime(selectedInquiry.createdAt) : 'Recent'}
                </span>
              </div>
              {selectedInquiry.contactedBy && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-gray-400 font-bold">Last Handled By:</span>
                  <span className="text-slate-700 dark:text-gray-300">{selectedInquiry.contactedBy}</span>
                </div>
              )}
            </div>

            {/* Status Selector */}
            <div className="space-y-1.5">
              <label htmlFor="modal-status-select" className="block text-xs font-bold text-slate-700 dark:text-gray-300">
                Lead Status:
              </label>
              <select
                id="modal-status-select"
                value={selectedInquiry.status}
                onChange={(e) =>
                  handleUpdateInquiry(selectedInquiry.id, {
                    status: e.target.value as EnterpriseInquiryStatus,
                  })
                }
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
              >
                <option value="NEW">New Lead (Needs Action)</option>
                <option value="CONTACTED">Contacted</option>
                <option value="IN_DISCUSSION">In Discussion / Proposal Shared</option>
                <option value="CONTRACT_SIGNED">Contract Signed (Closed Won)</option>
                <option value="CLOSED">Closed / Inactive</option>
              </select>
            </div>

            {/* Follow-up Notes */}
            <div className="space-y-1.5">
              <label htmlFor="modal-notes-textarea" className="block text-xs font-bold text-slate-700 dark:text-gray-300">
                Category Manager Notes:
              </label>
              <textarea
                id="modal-notes-textarea"
                rows={3}
                value={editingNotes}
                onChange={(e) => setEditingNotes(e.target.value)}
                placeholder="Add conversation notes, agreed SLA discount terms, or follow-up schedule..."
                className="w-full p-3 text-xs rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Modal Actions */}
            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setSelectedInquiry(null)}
                className="btn btn-secondary text-xs px-4 py-2 rounded-xl"
              >
                Close
              </button>
              <button
                type="button"
                disabled={savingNotes}
                onClick={() =>
                  handleUpdateInquiry(selectedInquiry.id, {
                    notes: editingNotes.trim(),
                  })
                }
                className="btn btn-primary text-xs px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-sm"
              >
                {savingNotes ? 'Saving...' : 'Save Notes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
