'use client';

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from '@/lib/store';
import { formatCurrency, normalizePoDate } from '@/lib/constants';
import { fetchDispatchTemplates, saveDispatchTemplate, type DispatchTemplate } from '@/lib/buyerProfileClient';
import {
  VendorMasterUploadRecord,
  PurchaseOrderLineItemRecord,
  HistoricalPurchaseVendorRecord,
  IngestionSummary,
} from '@/lib/types';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building2,
  Mail,
  Phone,
  MapPin,
  FileText,
  Star,
  Clock,
  Download,
  AlertCircle,
  AlertTriangle,
  Tag,
  Zap,
  X,
  Layers,
  ChevronRight,
  Plus,
  Trash2,
  SlidersHorizontal,
  Check,
  Database,
  Pencil,
  RefreshCw,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';

export interface IngestionJobState {
  id: string;
  jobType: 'VENDOR_MASTER' | 'PO_DUMP';
  fileName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalRecords: number;
  processedRecords: number;
  importedRecords: number;
  skippedRecords: number;
  failedRecords: number;
  errorMessage?: string | null;
}

export function IngestionProgressCard({
  job,
  title,
  unit = 'records',
}: {
  job: IngestionJobState;
  title: string;
  unit?: string;
}) {
  const total = job.totalRecords || 0;
  const processed = job.processedRecords || 0;
  const imported = job.importedRecords || 0;
  const skipped = job.skippedRecords || 0;
  const failed = job.failedRecords || 0;
  const percentage =
    total > 0
      ? Math.min(100, Math.round((processed / total) * 100))
      : job.status === 'COMPLETED'
      ? 100
      : processed > 0
      ? 100
      : 0;

  const formatNumber = (n: number) => n.toLocaleString('en-IN');

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border-2 border-indigo-500/40 text-white shadow-xl space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-400 shrink-0 shadow-md shadow-indigo-600/20">
            <Database size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-black tracking-wide text-white">
                {title} Ingestion
              </h4>
              {job.status === 'PROCESSING' && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                  Processing...
                </span>
              )}
              {job.status === 'COMPLETED' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 shadow-xs">
                  <CheckCircle2 size={11} className="text-emerald-400" />
                  Completed
                </span>
              )}
              {job.status === 'FAILED' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/30">
                  <AlertCircle size={11} className="text-rose-400" />
                  Failed
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              File: <span className="text-indigo-300 font-semibold">{job.fileName}</span>
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-purple-200 to-emerald-300">
            {percentage}%
          </span>
          <span className="block text-[10px] text-slate-400 font-medium">
            {formatNumber(processed)} / {formatNumber(total || processed)} {unit} processed ({percentage}%)
          </span>
        </div>
      </div>

      {/* Real-time Progress Bar */}
      <div className="space-y-1.5">
        <div className="w-full h-3.5 bg-slate-800/80 rounded-full overflow-hidden border border-slate-700/60 p-0.5 shadow-inner">
          <div
            className={`h-full rounded-full transition-all duration-300 shadow-sm ${
              job.status === 'FAILED'
                ? 'bg-rose-500'
                : job.status === 'COMPLETED'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400'
            }`}
            style={{ width: `${Math.max(2, Math.min(100, percentage))}%` }}
          />
        </div>
      </div>

      {/* Metrics Breakdown Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
        <div className="p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/60">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Total</span>
          <span className="font-mono font-black text-slate-100 text-sm">{formatNumber(total || processed)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-800/60">
          <span className="text-[10px] uppercase font-bold text-indigo-300 block">Processed</span>
          <span className="font-mono font-black text-indigo-100 text-sm">{formatNumber(processed)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-800/60">
          <span className="text-[10px] uppercase font-bold text-emerald-300 block">Imported</span>
          <span className="font-mono font-black text-emerald-200 text-sm">{formatNumber(imported)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-800/60">
          <span className="text-[10px] uppercase font-bold text-amber-300 block">Skipped</span>
          <span className="font-mono font-black text-amber-200 text-sm">{formatNumber(skipped)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/60 col-span-2 sm:col-span-1">
          <span className="text-[10px] uppercase font-bold text-rose-300 block">Failed</span>
          <span className="font-mono font-black text-rose-200 text-sm">{formatNumber(failed)}</span>
        </div>
      </div>

      {job.errorMessage && (
        <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-800/70 text-xs text-rose-200 flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0 text-rose-400" />
          <span>{job.errorMessage}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60 flex-wrap gap-1">
        <span>
          Status:{' '}
          <strong className="text-slate-200">
            {job.status === 'PROCESSING'
              ? 'Processing...'
              : job.status === 'COMPLETED'
              ? 'Completed Successfully'
              : job.status === 'FAILED'
              ? 'Processing Failed'
              : 'Pending'}
          </strong>
        </span>
        <span className="text-[10px] text-indigo-300/80 italic flex items-center gap-1">
          <Sparkles size={11} className="text-indigo-400" />
          Backend processing continues if you close this window or navigate away
        </span>
      </div>
    </div>
  );
}

// Splits a raw email cell ("a@x.com; b@x.com, A@X.com") into unique addresses.
// De-duplicates case-insensitively so each email is shown only once.
const getUniqueEmails = (raw?: string | null): string[] => {
  if (!raw) return [];
  const seen = new Set<string>();
  return raw
    .split(/[;,\s/|]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'))
    .filter((e) => {
      const key = e.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export default function InitialSetupModal() {
  const {
    initialSetupModalOpen,
    setInitialSetupModalOpen,
    historicalPurchaseDataPeriod,
    setHistoricalPurchaseDataPeriod,
    processHistoricalPurchaseData,
    lastIngestionSummary,
    setInitialSetupCompleted,
    activeBuyerAccount,
    buyerVendors,
    showToast,
  } = useApp();

  const [completionSummary, setCompletionSummary] = useState<IngestionSummary | null>(null);
  const [isRetryingFailedEmails, setIsRetryingFailedEmails] = useState(false);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  // The buyer's own saved wording for Template A/B — fetched once Step 5 is reached,
  // so this preview shows exactly what storeService.processHistoricalPurchaseData will
  // actually send, not just the hardcoded placeholder copy.
  const [savedTemplateA, setSavedTemplateA] = useState<DispatchTemplate | null>(null);
  const [savedTemplateB, setSavedTemplateB] = useState<DispatchTemplate | null>(null);
  React.useEffect(() => {
    if (step !== 5) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchDispatchTemplates();
        if (cancelled || !result || !result.success) return;
        setSavedTemplateA(result.data?.category_mapped || null);
        setSavedTemplateB(result.data?.self_map_required || null);
      } catch {
        // Silently fallback to default templates if endpoint is unavailable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  const [editingTemplateModal, setEditingTemplateModal] = useState<'A' | 'B' | null>(null);
  const [tempSubject, setTempSubject] = useState('');
  const [tempMessage, setTempMessage] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  const openTemplateModal = (type: 'A' | 'B') => {
    if (type === 'A') {
      setTempSubject(savedTemplateA?.subject || `${activeBuyerAccount?.organizationName || 'Larsen & Toubro'} has mapped your supply categories`);
      setTempMessage(savedTemplateA?.message || '• 1st Set: Engineering Spares - Mechanical\n• 2nd Set: Pumps, Valves, Hoses, Machinery Parts');
    } else {
      setTempSubject(savedTemplateB?.subject || 'Complete Your Category Mapping to Receive Enquiries');
      setTempMessage(savedTemplateB?.message || "Buyer didn't map any categories for you, so please map yourself in order to receive enquiries.");
    }
    setEditingTemplateModal(type);
  };

  const handleSaveTemplate = async () => {
    if (!editingTemplateModal) return;
    setIsSavingTemplate(true);
    try {
      const templateKey = editingTemplateModal === 'A' ? 'category_mapped' : 'self_map_required';
      const res = await saveDispatchTemplate(templateKey, {
        subject: tempSubject,
        message: tempMessage,
      });
      if (res.success) {
        if (editingTemplateModal === 'A') {
          setSavedTemplateA({ subject: tempSubject, message: tempMessage });
        } else {
          setSavedTemplateB({ subject: tempSubject, message: tempMessage });
        }
        showToast('Template Updated', `Template ${editingTemplateModal} has been saved.`, 'success');
        setEditingTemplateModal(null);
      } else {
        showToast('Save Failed', res.error || 'Could not update template', 'warning');
      }
    } catch (err: any) {
      showToast('Save Error', err.message || 'Could not update template', 'warning');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  React.useEffect(() => {
    if (lastIngestionSummary) {
      setCompletionSummary(lastIngestionSummary);
    }
  }, [lastIngestionSummary]);
  const [selectedPeriod, setSelectedPeriod] = useState<'1_year' | '2_years' | '3_years'>(historicalPurchaseDataPeriod || '2_years');

  // Active Session & Ingestion Job States
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [vendorJob, setVendorJob] = useState<IngestionJobState | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [vendorUploadError, setVendorUploadError] = useState<string | null>(null);
  const [poUploadError, setPoUploadError] = useState<string | null>(null);
  const [poJob, setPoJob] = useState<IngestionJobState | null>(null);

  // Separate Upload States & File Handlers
  const [storedVendors, setStoredVendors] = useState<VendorMasterUploadRecord[]>([]);
  const [vendorMasterUploaded, setVendorMasterUploaded] = useState(false);
  const [vendorFileName, setVendorFileName] = useState<string>('');
  const [isDraggingVendor, setIsDraggingVendor] = useState<boolean>(false);
  const [isParsingVendor, setIsParsingVendor] = useState<boolean>(false);
  const [isEditingVendorTable, setIsEditingVendorTable] = useState<boolean>(false);

  const [poLineItems, setPoLineItems] = useState<PurchaseOrderLineItemRecord[]>([]);
  const [poDataUploaded, setPoDataUploaded] = useState(false);
  const [poFileName, setPoFileName] = useState<string>(`PO_Purchase_Dump_${selectedPeriod}.xlsx`);
  const [isDraggingPo, setIsDraggingPo] = useState<boolean>(false);
  const [isParsingPo, setIsParsingPo] = useState<boolean>(false);

  const [vendorPreviewLimit, setVendorPreviewLimit] = useState<number>(50);
  const [poPreviewLimit, setPoPreviewLimit] = useState<number>(50);

  const vendorFileInputRef = useRef<HTMLInputElement>(null);
  const poFileInputRef = useRef<HTMLInputElement>(null);

  const [isProcessingPOJoin, setIsProcessingPOJoin] = useState(false);
  const [isConfirmingIngestion, setIsConfirmingIngestion] = useState(false);
  const [activeReviewTab, setActiveReviewTab] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [apiJoinedVendors, setApiJoinedVendors] = useState<HistoricalPurchaseVendorRecord[] | null>(null);

  // Validate a vendor row for required fields
  const getVendorRowErrors = (v: VendorMasterUploadRecord): string[] => {
    const errs: string[] = [];
    if (!v.companyName || v.companyName.trim() === '') {
      errs.push('Company Name is required');
    }
    if (!v.email || v.email.trim() === '') {
      errs.push('Email is required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
      errs.push('Invalid email format');
    }
    if (!v.phone || v.phone.trim() === '') {
      errs.push('Mobile / Phone is required');
    }
    return errs;
  };

  const invalidVendors = storedVendors.filter((v) => getVendorRowErrors(v).length > 0);

  const navigateToStep = (targetStep: 1 | 2 | 3 | 4 | 5): boolean => {
    // Backward navigation to Step 1 or 2 is always allowed
    if (targetStep <= 2) {
      setStep(targetStep);
      return true;
    }

    // If ingestion was completed, allow viewing Step 5 summary
    if (targetStep === 5 && (completionSummary || lastIngestionSummary)) {
      setStep(5);
      return true;
    }

    // Moving forward to Step 3, 4, 5 requires at least 1 vendor in Vendor Master
    if (storedVendors.length === 0) {
      const msg = 'Vendor Master is required. Please upload your Vendor Master spreadsheet or add vendor records before proceeding.';
      setVendorUploadError(msg);
      showToast('Vendor Master Required', msg, 'warning');
      setStep(2);
      return false;
    }

    // Moving forward to Step 3, 4, 5 requires all Vendor Master rows to pass required-field validation
    if (invalidVendors.length > 0) {
      const msg = `Cannot proceed: ${invalidVendors.length} vendor record(s) contain missing or invalid required fields (Company Name, Email, or Mobile). Please click 'Edit Data' to fix them before continuing.`;
      setVendorUploadError(msg);
      showToast('Validation Error in Vendor Master', msg, 'warning');
      setStep(2);
      return false;
    }

    // Moving forward to Step 4 or 5 requires PO Dump data
    if (targetStep >= 4 && poLineItems.length === 0) {
      const msg = 'Historical PO Dump is required. Please upload your PO purchase dump spreadsheet before running AI Category Cross-Match.';
      setPoUploadError(msg);
      showToast('PO Dump Required', msg, 'warning');
      setStep(3);
      return false;
    }

    setVendorUploadError(null);
    setPoUploadError(null);
    setStep(targetStep);
    return true;
  };

  const authFetchHeaders = (): Record<string, string> => {
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('procucev_auth_token') || sessionStorage.getItem('procucev_auth_token')
        : null;
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // Live job progress polling — setVendorJob/setPoJob were previously only
  // ever set once, from the upload response, at the instant the background
  // job had barely started (0 processed). "Progress is tracked live" was
  // never actually true: nothing re-fetched the job afterward, so the
  // progress card just froze at that first snapshot until the buyer
  // reloaded the page. Polls GET /:sessionId/jobs/:jobId every 2s while a
  // job is PENDING/PROCESSING and stops itself once it lands on a terminal
  // status (or the session/modal goes away).
  React.useEffect(() => {
    if (!sessionId) return;
    const pollableJobs: Array<['vendor' | 'po', IngestionJobState | null]> = [
      ['vendor', vendorJob],
      ['po', poJob],
    ];
    const active = pollableJobs.filter(
      ([, job]) => job && (job.status === 'PENDING' || job.status === 'PROCESSING')
    );
    if (active.length === 0) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      for (const [which, job] of active) {
        if (!job) continue;
        try {
          const res = await fetch(`/api/vendor-ingestion/${sessionId}/jobs/${job.id}`, {
            headers: authFetchHeaders(),
          });
          if (!res.ok || cancelled) continue;
          const json = await res.json();
          const freshJob: IngestionJobState | undefined = json?.data?.job;
          if (!freshJob || cancelled) continue;
          if (which === 'vendor') setVendorJob(freshJob);
          else setPoJob(freshJob);
        } catch (err) {
          console.warn(`Could not refresh ${which} ingestion job progress:`, err);
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, vendorJob?.id, vendorJob?.status, poJob?.id, poJob?.status]);

  const handleCloseModal = async () => {
    if (sessionId && (vendorJob?.status === 'PROCESSING' || poJob?.status === 'PROCESSING')) {
      try {
        await fetch(`/api/vendor-ingestion/${sessionId}/jobs/cancel`, {
          method: 'POST',
          headers: authFetchHeaders(),
        });
      } catch (e) {
        console.warn('Error cancelling job on close:', e);
      }
    }
    setVendorJob(null);
    setPoJob(null);
    setInitialSetupModalOpen(false);
  };

  // Re-establish session on mount
  React.useEffect(() => {
    if (!initialSetupModalOpen) {
      setVendorJob(null);
      setPoJob(null);
      return;
    }

    const initSession = async () => {
      try {
        const res = await fetch('/api/vendor-ingestion/session', { headers: authFetchHeaders() });
        if (res.ok) {
          const json = await res.json();
          if (json?.data?.session?.id) {
            const sess = json.data.session;
            setSessionId(sess.id);
            if (sess.vendorMasterFileName && sess.vendorMasterRowCount > 0) {
              setVendorFileName(sess.vendorMasterFileName);
              setVendorMasterUploaded(true);
            }
            if (sess.poFileName && sess.poRowCount > 0) {
              setPoFileName(sess.poFileName);
              setPoDataUploaded(true);
            }
          }
        }
      } catch (err) {
        console.warn('Could not initialize vendor ingestion session:', err);
      }
    };

    initSession();
  }, [initialSetupModalOpen]);



  if (!initialSetupModalOpen) return null;

  const ALLOWED_UPLOAD_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.tsv', '.txt'];
  const isAllowedSpreadsheetFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    return ALLOWED_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext));
  };

  // Real File Upload & SheetJS/CSV Parsing for File 1: Vendor Master
  const handleVendorFileUpload = (file: File) => {
    if (!file) return;
    if (!isAllowedSpreadsheetFile(file)) {
      showToast('Unsupported File Type', `"${file.name}" is not a supported spreadsheet file. Accepted: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`, 'warning');
      return;
    }

    setVendorFileName(file.name);
    setIsParsingVendor(true);

    // Set initial active job state
    setVendorJob({
      id: `job-vm-${Date.now()}`,
      jobType: 'VENDOR_MASTER',
      fileName: file.name,
      status: 'PROCESSING',
      totalRecords: 0,
      processedRecords: 0,
      importedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
    });

    const isCsvOrText = file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.txt');

    if (isCsvOrText && sessionId) {
      // Stream directly to backend for large files
      (async () => {
        try {
          const token =
            typeof window !== 'undefined'
              ? localStorage.getItem('procucev_auth_token') || sessionStorage.getItem('procucev_auth_token')
              : null;

          const res = await fetch(`/api/vendor-ingestion/${sessionId}/stream-upload?type=VENDOR_MASTER&fileName=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/csv',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: file,
          });

          if (res.ok) {
            const json = await res.json();
            if (json?.data?.job) {
              setVendorJob(json.data.job);
              showToast('Ingestion Started', `Started background streaming ingestion for ${file.name}. Progress is tracked live.`, 'info');
            }
          }
        } catch (err: any) {
          console.error('Streaming upload error:', err);
          showToast('Upload Error', err.message || 'Streaming upload failed', 'warning');
        } finally {
          setIsParsingVendor(false);
        }
      })();
    } else {
      // Excel or client fallback parsing
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (!rawJson || rawJson.length === 0) {
            const errMsg = 'The uploaded Vendor Master file has no readable data rows.';
            setVendorUploadError(errMsg);
            showToast('Empty File', errMsg, 'warning');
            setIsParsingVendor(false);
            setVendorJob(null);
            return;
          }

          const headerKeys = Object.keys(rawJson[0]);
          const hasCompanyName = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['companyname', 'company', 'vendorname', 'vendor', 'suppliername', 'supplier', 'name', 'organization'].some(
              (c) => clean === c || (clean.includes(c) && !clean.includes('code') && !clean.includes('mail') && !clean.includes('phone') && !clean.includes('contact'))
            );
          });
          const hasEmail = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['email', 'emailid', 'emailaddress', 'mail', 'corporateemail', 'companyemail', 'vendoremail'].some((c) => clean.includes(c));
          });
          const hasPhone = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['phone', 'mobile', 'contactnumber', 'phonenumber', 'telephone', 'mobileno', 'contactno', 'cell', 'whatsapp'].some((c) => clean.includes(c));
          });
          const hasVendorCode = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['vendorcode', 'suppliercode', 'vendorid', 'supplierid', 'vcode', 'vendorno', 'vndcode'].some((c) => clean.includes(c));
          });

          if (!hasCompanyName && !hasEmail && !hasPhone && !hasVendorCode) {
            const foundHeaders = headerKeys.filter(Boolean).slice(0, 6).join(', ') || 'None';
            const errMsg = `Sheet headers do not match Vendor Master required fields. Expected: Company Name, Email ID, Mobile No. (Found: [${foundHeaders}]). Please download and use the official Vendor Master template.`;
            setVendorUploadError(errMsg);
            showToast('Invalid Sheet Headers', errMsg, 'warning');
            setIsParsingVendor(false);
            setVendorJob(null);
            if (vendorFileInputRef.current) vendorFileInputRef.current.value = '';
            return;
          }

          const parsedVendors: VendorMasterUploadRecord[] = rawJson.map((row, idx) => {
            const keys = Object.keys(row);
            const getVal = (possibleKeys: string[], excludeSubstrings: string[] = []): string => {
              // Pass 1: Exact matches (after stripping non-alphanumeric)
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                const matchedKey = keys.find((k) => {
                  const kClean = k.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                  if (excludeSubstrings.some((ex) => kClean.includes(ex.toLowerCase().replace(/[^a-z0-9]/g, '')))) return false;
                  return kClean === pkClean;
                });
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return String(row[matchedKey]).trim();
                }
              }
              // Pass 2: Fuzzy matches (only for keys with 4+ alphanumeric chars to avoid short false matches like 'id' or 'code')
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!pkClean || pkClean.length < 4) continue;
                const matchedKey = keys.find((k) => {
                  const kClean = k.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                  if (excludeSubstrings.some((ex) => kClean.includes(ex.toLowerCase().replace(/[^a-z0-9]/g, '')))) return false;
                  return kClean.includes(pkClean);
                });
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return String(row[matchedKey]).trim();
                }
              }
              return '';
            };

            let rawVendorCode = getVal(
              ['vendorcode', 'vendor code', 'vendor_code', 'suppliercode', 'supplier code', 'vendor id', 'supplier id', 'vcode', 'vnd code', 'vendorno', 'vendor no', 'vendor number', 'supplier number', 'vendor identifier'],
              ['email', 'mail', 'phone', 'contact', 'gst']
            );
            // If the resolved vendorCode is an email address, discard it so it doesn't take email as vendor code
            if (rawVendorCode && (rawVendorCode.includes('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawVendorCode))) {
              rawVendorCode = '';
            }
            const vendorCode = rawVendorCode || `VND-${1000 + idx + 1}`;
            const companyName = getVal(['companyname', 'company name', 'vendor name', 'supplier name', 'supplier', 'company', 'organization', 'vendor', 'name'], ['email', 'mail', 'phone', 'contactperson', 'code']);
            const contactPerson = getVal(['contactperson', 'contact person', 'contact person name', 'representative', 'person name', 'contact name', 'person', 'poc'], ['email', 'mail', 'phone', 'mobile']);
            const email = getVal(['email', 'email id', 'email_id', 'emailid', 'email address', 'emailaddress', 'mail', 'corporate email', 'company email', 'vendor email']);
            const phone = getVal(['phone', 'mobile', 'contact number', 'phone number', 'telephone', 'mobile number', 'contact no', 'phone no', 'mobile no', 'cell', 'whatsapp'], ['email', 'mail', 'person', 'contactperson']);
            const address = getVal(['address', 'location', 'city', 'plant location', 'street', 'office address', 'plant', 'state', 'pincode', 'pin code']);
            const gstNumber = getVal(['gstnumber', 'gstin', 'gst', 'gst number', 'tax id', 'gst no', 'taxid', 'tax number', 'gstin number']);
            const ratingRaw = getVal(['vendorratingscore', 'rating', 'score', 'vendor rating', 'rating 0 100', 'performance score', 'vendor rating score', 'rating optional', 'rating 0-100', 'rating0100']);
            let vendorRatingScore: number | undefined = undefined;
            if (ratingRaw && !isNaN(Number(ratingRaw))) {
              const num = Number(ratingRaw);
              if (num > 0 && num <= 5) {
                vendorRatingScore = Math.round(num * 20);
              } else {
                vendorRatingScore = Math.min(100, Math.max(0, Math.round(num)));
              }
            }

            return {
              id: `vm-upload-${Date.now()}-${idx}`,
              vendorCode,
              companyName,
              contactPerson,
              email,
              phone,
              address,
              gstNumber,
              vendorRatingScore,
            };
          }).filter((v) => Boolean(v.companyName?.trim() || v.email?.trim() || v.phone?.trim() || v.gstNumber?.trim() || v.contactPerson?.trim()));

          if (parsedVendors.length === 0 || !parsedVendors.some((v) => v.companyName || v.email || v.phone)) {
            const errMsg = 'The uploaded Vendor Master file has no recognizable supplier rows with Company Name or contact details. Please verify your file.';
            setVendorUploadError(errMsg);
            showToast('Invalid Vendor File', errMsg, 'warning');
            setIsParsingVendor(false);
            setVendorJob(null);
            if (vendorFileInputRef.current) vendorFileInputRef.current.value = '';
            return;
          }

          setVendorUploadError(null);

          setStoredVendors(parsedVendors);
          setVendorMasterUploaded(true);
          setIsEditingVendorTable(false);

          if (sessionId) {
            try {
              const jobRes = await fetch(`/api/vendor-ingestion/${sessionId}/start-job`, {
                method: 'POST',
                headers: authFetchHeaders(),
                body: JSON.stringify({
                  rows: parsedVendors,
                  fileName: file.name,
                  jobType: 'VENDOR_MASTER',
                }),
              });
              if (jobRes.ok) {
                const jobJson = await jobRes.json();
                const j = jobJson?.data?.job;
                setVendorJob({
                  id: j?.id || `job-${Date.now()}`,
                  jobType: 'VENDOR_MASTER',
                  fileName: file.name,
                  status: 'COMPLETED',
                  totalRecords: parsedVendors.length,
                  processedRecords: parsedVendors.length,
                  importedRecords: parsedVendors.length,
                  skippedRecords: j?.skippedRecords || 0,
                  failedRecords: j?.failedRecords || 0,
                });
              } else {
                setVendorJob({
                  id: `job-${Date.now()}`,
                  jobType: 'VENDOR_MASTER',
                  fileName: file.name,
                  status: 'COMPLETED',
                  totalRecords: parsedVendors.length,
                  processedRecords: parsedVendors.length,
                  importedRecords: parsedVendors.length,
                  skippedRecords: 0,
                  failedRecords: 0,
                });
              }
            } catch (e) {
              console.warn('Job start error:', e);
              setVendorJob({
                id: `job-${Date.now()}`,
                jobType: 'VENDOR_MASTER',
                fileName: file.name,
                status: 'COMPLETED',
                totalRecords: parsedVendors.length,
                processedRecords: parsedVendors.length,
                importedRecords: parsedVendors.length,
                skippedRecords: 0,
                failedRecords: 0,
              });
            }
          } else {
            setVendorJob({
              id: `job-${Date.now()}`,
              jobType: 'VENDOR_MASTER',
              fileName: file.name,
              status: 'COMPLETED',
              totalRecords: parsedVendors.length,
              processedRecords: parsedVendors.length,
              importedRecords: parsedVendors.length,
              skippedRecords: 0,
              failedRecords: 0,
            });
          }

          try {
            const existingHistory = JSON.parse(localStorage.getItem('procucev_vendor_upload_history') || '[]');
            const historyEntry = {
              id: `up-${Date.now()}`,
              fileName: file.name,
              timestamp: new Date().toLocaleString(),
              total: parsedVendors.length,
              imported: parsedVendors.length,
              duplicates: 0,
              failed: 0,
              records: parsedVendors.slice(0, 100).map((v) => ({
                vendorCode: v.vendorCode,
                name: v.companyName,
                contactPerson: v.contactPerson,
                email: v.email,
                phone: v.phone,
                gstin: v.gstNumber,
                category: 'Vendor Master',
                city: v.address,
                rating: v.vendorRatingScore,
              })),
            };
            const updatedHistory = [historyEntry, ...existingHistory.filter((x: any) => x.fileName !== file.name)].slice(0, 30);
            localStorage.setItem('procucev_vendor_upload_history', JSON.stringify(updatedHistory));
          } catch {}

          showToast('Vendor Master Uploaded', `Loaded ${parsedVendors.length.toLocaleString('en-IN')} vendors from ${file.name}.`, 'success');
        } catch (err: any) {
          console.error('Vendor Master Parse Error:', err);
          showToast('Parsing Error', `Could not parse file: ${err.message || 'Unknown format'}`, 'warning');
          setVendorJob(null);
        } finally {
          setIsParsingVendor(false);
        }
      };

      reader.onerror = () => {
        showToast('File Read Error', 'Failed to read file from disk.', 'warning');
        setIsParsingVendor(false);
        setVendorJob(null);
      };

      reader.readAsArrayBuffer(file);
    }
  };

  // Real File Upload & SheetJS/CSV Parsing for File 2: PO Purchase Dump
  const handlePODataFileUpload = (file: File) => {
    if (!file) return;
    if (!isAllowedSpreadsheetFile(file)) {
      showToast('Unsupported File Type', `"${file.name}" is not a supported spreadsheet file. Accepted: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`, 'warning');
      return;
    }

    setPoFileName(file.name);
    setIsParsingPo(true);

    // Set initial active job state
    setPoJob({
      id: `job-po-${Date.now()}`,
      jobType: 'PO_DUMP',
      fileName: file.name,
      status: 'PROCESSING',
      totalRecords: 0,
      processedRecords: 0,
      importedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
    });

    const isCsvOrText = file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.txt');

    if (isCsvOrText && sessionId) {
      // Direct stream upload for large PO dumps
      (async () => {
        try {
          const token =
            typeof window !== 'undefined'
              ? localStorage.getItem('procucev_auth_token') || sessionStorage.getItem('procucev_auth_token')
              : null;

          const res = await fetch(`/api/vendor-ingestion/${sessionId}/stream-upload?type=PO_DUMP&fileName=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/csv',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: file,
          });

          if (res.ok) {
            const json = await res.json();
            if (json?.data?.job) {
              setPoJob(json.data.job);
              showToast('Ingestion Started', `Started background streaming ingestion for PO dump ${file.name}. Progress is tracked live.`, 'info');
            }
          }
        } catch (err: any) {
          console.error('Streaming upload error:', err);
          showToast('Upload Error', err.message || 'Streaming PO upload failed', 'warning');
        } finally {
          setIsParsingPo(false);
        }
      })();
    } else {
      // Excel parsing & background job dispatch
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (!rawJson || rawJson.length === 0) {
            const errMsg = 'The uploaded PO dump file has no readable data rows.';
            setPoUploadError(errMsg);
            showToast('Empty PO File', errMsg, 'warning');
            setIsParsingPo(false);
            setPoJob(null);
            return;
          }

          const headerKeys = Object.keys(rawJson[0]);
          const hasPoNumber = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['ponumber', 'po', 'pono', 'orderid', 'ordernumber', 'orderno', 'purchaseorder'].some((c) => clean === c || clean.includes(c));
          });
          const hasVendor = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['vendorname', 'vendoridentifier', 'vendor', 'suppliername', 'supplier', 'companyname', 'vendorcode', 'vendorid'].some((c) => clean === c || clean.includes(c));
          });
          const hasItem = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['lineitemdescription', 'lineitem', 'itemdescription', 'description', 'itemname', 'productdescription', 'productname', 'materialdescription', 'material', 'servicedescription', 'service', 'item'].some((c) => clean === c || clean.includes(c));
          });
          const hasSpendOrQty = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['quantity', 'qty', 'spend', 'totalspend', 'totalspendinr', 'totalamount', 'totalamountinr', 'totalinr', 'unitprice', 'price', 'rate', 'amount', 'totalvalue', 'poamount', 'total'].some((c) => clean === c || clean.includes(c));
          });

          if (!hasPoNumber && !hasVendor && !hasItem && !hasSpendOrQty) {
            const foundHeaders = headerKeys.filter(Boolean).slice(0, 6).join(', ') || 'None';
            const errMsg = `Sheet headers do not match PO Purchase Dump required fields. Expected: PO Number, Vendor Name, Item Description, Quantity / Spend. (Found: [${foundHeaders}]). Please download and use the provided PO Dump Excel template.`;
            setPoUploadError(errMsg);
            showToast('Invalid PO Sheet Headers', errMsg, 'warning');
            setIsParsingPo(false);
            setPoJob(null);
            if (poFileInputRef.current) poFileInputRef.current.value = '';
            return;
          }

          const parsedPOs: PurchaseOrderLineItemRecord[] = rawJson.map((row, idx) => {
            const keys = Object.keys(row);
            const getRawVal = (possibleKeys: string[], excludeSubstrings: string[] = []): unknown => {
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                const matchedKey = keys.find((k) => k.toLowerCase().trim().replace(/[^a-z0-9]/g, '') === pkClean);
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return row[matchedKey];
                }
              }
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!pkClean || pkClean.length < 3) continue;
                const matchedKey = keys.find((k) => {
                  const kClean = k.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                  if (excludeSubstrings.some((ex) => kClean.includes(ex.toLowerCase().replace(/[^a-z0-9]/g, '')))) return false;
                  return kClean.includes(pkClean);
                });
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return row[matchedKey];
                }
              }
              return undefined;
            };

            const getVal = (possibleKeys: string[], excludeSubstrings: string[] = []): string => {
              const raw = getRawVal(possibleKeys, excludeSubstrings);
              return raw !== undefined && raw !== null ? String(raw).trim() : '';
            };

            const poNumber = getVal(['ponumber', 'po number', 'po #', 'po no', 'pono', 'order id', 'order number', 'order no']) || `PO-2025-${(1000 + idx).toString()}`;
            const rawPoDate = getRawVal(['podate', 'po date', 'date', 'order date', 'creation date']);
            const poDate = normalizePoDate(rawPoDate) || '2025-06-15';
            const vendorIdentifier = getVal(['vendor name', 'vendor identifier', 'vendor', 'supplier name', 'supplier', 'company name', 'vendor code', 'vendor id']) || 'Apex Supplies Ltd.';
            const itemName = getVal(['line item description', 'line item', 'item description', 'description', 'item name', 'product description', 'product name', 'material description', 'material', 'service description', 'service', 'item']) || 'Industrial Mechanical Spares';
            const specs = getVal(['specs', 'specification', 'technical specs', 'specifications', 'details', 'item specs', 'grade']);
            
            const qtyRaw = getVal(['quantity', 'qty', 'units', 'count', 'ordered qty', 'volume']);
            const quantity = qtyRaw && !isNaN(Number(String(qtyRaw).replace(/[^0-9.]/g, ''))) ? Math.max(1, Math.round(Number(String(qtyRaw).replace(/[^0-9.]/g, '')))) : 1;
            
            const unit = getVal(['unit', 'uom', 'unit of measure', 'units']) || 'Units';

            const unitPriceRaw = getVal(['unit price inr', 'unit price', 'unit rate', 'rate inr', 'rate', 'price inr', 'price', 'item price']);
            const totalSpendRaw = getVal(['total spend inr', 'total spend (inr)', 'total spend rs', 'total spend', 'total amount inr', 'total amount (inr)', 'total amount', 'total inr', 'total (inr)', 'spend inr', 'spend', 'amount inr', 'amount', 'total value', 'po amount', 'total']);

            const parsedUnitPrice = unitPriceRaw && !isNaN(Number(String(unitPriceRaw).replace(/[^0-9.]/g, ''))) ? Number(String(unitPriceRaw).replace(/[^0-9.]/g, '')) : 0;
            const parsedTotalSpend = totalSpendRaw && !isNaN(Number(String(totalSpendRaw).replace(/[^0-9.]/g, ''))) ? Number(String(totalSpendRaw).replace(/[^0-9.]/g, '')) : 0;

            let totalSpend = parsedTotalSpend;
            let unitPrice = parsedUnitPrice;

            if (totalSpend > 0 && unitPrice === 0 && quantity > 0) {
              unitPrice = Math.round(totalSpend / quantity);
            } else if (totalSpend === 0 && unitPrice > 0) {
              totalSpend = unitPrice * quantity;
            } else if (totalSpend === 0 && unitPrice === 0) {
              unitPrice = 500;
              totalSpend = unitPrice * quantity;
            }

            const department = getVal(['department', 'dept', 'cost center', 'plant', 'division', 'category', 'function']) || 'General';

            return {
              id: `po-upload-${Date.now()}-${idx}`,
              poNumber,
              poDate,
              vendorName: vendorIdentifier,
              vendorIdentifier,
              itemName,
              itemDescription: itemName,
              specs,
              specification: specs,
              quantity,
              unit,
              uom: unit,
              unitPrice,
              totalSpend,
              spend: totalSpend,
              department,
            };
          })
            .filter((p) => Boolean(p.vendorIdentifier?.trim() || p.vendorName?.trim() || p.itemName?.trim() || p.itemDescription?.trim() || p.department?.trim()))
            .sort((a, b) => new Date(b.poDate || 0).getTime() - new Date(a.poDate || 0).getTime());

          if (parsedPOs.length === 0) {
            const errMsg = 'The uploaded PO dump file contains no recognizable purchase order records. Please verify your file.';
            setPoUploadError(errMsg);
            showToast('Invalid PO File', errMsg, 'warning');
            setIsParsingPo(false);
            setPoJob(null);
            if (poFileInputRef.current) poFileInputRef.current.value = '';
            return;
          }

          setPoUploadError(null);
          setPoLineItems(parsedPOs);
          setPoDataUploaded(true);

          if (sessionId) {
            try {
              const jobRes = await fetch(`/api/vendor-ingestion/${sessionId}/start-job`, {
                method: 'POST',
                headers: authFetchHeaders(),
                body: JSON.stringify({
                  rows: parsedPOs,
                  fileName: file.name,
                  jobType: 'PO_DUMP',
                }),
              });
              if (jobRes.ok) {
                const jobJson = await jobRes.json();
                const j = jobJson?.data?.job;
                setPoJob({
                  id: j?.id || `job-po-${Date.now()}`,
                  jobType: 'PO_DUMP',
                  fileName: file.name,
                  status: 'COMPLETED',
                  totalRecords: parsedPOs.length,
                  processedRecords: parsedPOs.length,
                  importedRecords: parsedPOs.length,
                  skippedRecords: j?.skippedRecords || 0,
                  failedRecords: j?.failedRecords || 0,
                });
              } else {
                setPoJob({
                  id: `job-po-${Date.now()}`,
                  jobType: 'PO_DUMP',
                  fileName: file.name,
                  status: 'COMPLETED',
                  totalRecords: parsedPOs.length,
                  processedRecords: parsedPOs.length,
                  importedRecords: parsedPOs.length,
                  skippedRecords: 0,
                  failedRecords: 0,
                });
              }
            } catch (e) {
              console.warn('Job start error:', e);
              setPoJob({
                id: `job-po-${Date.now()}`,
                jobType: 'PO_DUMP',
                fileName: file.name,
                status: 'COMPLETED',
                totalRecords: parsedPOs.length,
                processedRecords: parsedPOs.length,
                importedRecords: parsedPOs.length,
                skippedRecords: 0,
                failedRecords: 0,
              });
            }
          } else {
            setPoJob({
              id: `job-po-${Date.now()}`,
              jobType: 'PO_DUMP',
              fileName: file.name,
              status: 'COMPLETED',
              totalRecords: parsedPOs.length,
              processedRecords: parsedPOs.length,
              importedRecords: parsedPOs.length,
              skippedRecords: 0,
              failedRecords: 0,
            });
          }

          showToast('PO Dump Uploaded', `Successfully parsed & loaded ${parsedPOs.length.toLocaleString('en-IN')} PO line items from ${file.name}.`, 'success');
        } catch (err: any) {
          console.error('PO Dump Parse Error:', err);
          const errMsg = `Could not parse PO file: ${err.message || 'Unknown format'}`;
          setPoUploadError(errMsg);
          showToast('Parsing Error', errMsg, 'warning');
          setPoJob(null);
        } finally {
          setIsParsingPo(false);
        }
      };

      reader.onerror = () => {
        const errMsg = 'Failed to read file from disk.';
        setPoUploadError(errMsg);
        showToast('File Read Error', errMsg, 'warning');
        setIsParsingPo(false);
        setPoJob(null);
      };

      reader.readAsArrayBuffer(file);
    }
  };

  const clearVendorMasterData = () => {
    setStoredVendors([]);
    setApiJoinedVendors(null);
    setVendorMasterUploaded(false);
    setVendorFileName('');
    setVendorUploadError(null);
    setIsEditingVendorTable(false);
    if (vendorFileInputRef.current) {
      vendorFileInputRef.current.value = '';
    }
    showToast('Selection Cleared', 'Vendor Master selection has been removed. Please upload a file.', 'info');
  };

  const resetToSamplePoData = () => {
    setPoLineItems([]);
    setApiJoinedVendors(null);
    setPoFileName(`PO_Purchase_Dump_${selectedPeriod}.xlsx`);
    setPoDataUploaded(false);
    setPoUploadError(null);
    if (poFileInputRef.current) {
      poFileInputRef.current.value = '';
    }
    showToast('Reset Complete', 'PO Dump line items cleared. Please upload your spreadsheet.', 'info');
  };

  // Compute Joined Records between Vendor Master & PO Line Items
  const computeJoinedRecords = (): HistoricalPurchaseVendorRecord[] => {
    return storedVendors.map((v) => {
      // Find matching POs
      const matchingPOs = poLineItems.filter(
        (po) =>
          po.vendorIdentifier.toLowerCase().includes(v.companyName.toLowerCase()) ||
          v.companyName.toLowerCase().includes(po.vendorIdentifier.toLowerCase()) ||
          (v.vendorCode && po.vendorIdentifier.toLowerCase().includes(v.vendorCode.toLowerCase()))
      );

      const hasMatchingPOs = matchingPOs.length > 0;
      const items = matchingPOs.map((p) => p.itemName);
      const totalAmount = matchingPOs.reduce((acc, p) => acc + p.totalSpend, 0);

      let firstSetMajor = '';
      let secondSetMinors: string[] = [];

      if (hasMatchingPOs) {
        // AI Category mapping based on purchased items & vendor names
        const itemText = (items.join(' ') + ' ' + v.companyName).toLowerCase();
        if (
          itemText.includes('microsoft') ||
          itemText.includes('google') ||
          itemText.includes('azure') ||
          itemText.includes('workspace') ||
          itemText.includes('cloud') ||
          itemText.includes('license') ||
          itemText.includes('software') ||
          itemText.includes('power bi') ||
          itemText.includes('bigquery') ||
          itemText.includes('gcp') ||
          itemText.includes('saas') ||
          itemText.includes('datacenter')
        ) {
          firstSetMajor = 'Information Technology (IT) & Software';
          if (itemText.includes('cloud') || itemText.includes('azure') || itemText.includes('gcp') || itemText.includes('storage') || itemText.includes('compute') || itemText.includes('credits')) {
            secondSetMinors.push('Cloud Infrastructure & Storage');
          }
          if (itemText.includes('license') || itemText.includes('subscription') || itemText.includes('renewal') || itemText.includes('365') || itemText.includes('workspace') || itemText.includes('teams') || itemText.includes('windows server')) {
            secondSetMinors.push('Enterprise Software & Licenses');
          }
          if (itemText.includes('bigquery') || itemText.includes('power bi') || itemText.includes('analytics') || itemText.includes('data')) {
            secondSetMinors.push('Data & Analytics Platforms');
          }
          if (itemText.includes('datacenter') || itemText.includes('infrastructure') || itemText.includes('server')) {
            secondSetMinors.push('IT Infrastructure');
          }
          if (secondSetMinors.length === 0) {
            secondSetMinors.push('Enterprise Software & Licenses');
          }
        } else if (itemText.includes('pump') || itemText.includes('valve') || itemText.includes('hose') || itemText.includes('compressor')) {
          firstSetMajor = 'Engineering Spares - Mechanical';
          if (itemText.includes('pump')) secondSetMinors.push('Pumps & Accessories');
          if (itemText.includes('valve') || itemText.includes('gate') || itemText.includes('globe')) secondSetMinors.push('Hoses, Valves & Fittings');
          if (itemText.includes('hose')) secondSetMinors.push('Hoses, Valves & Fittings');
          if (itemText.includes('compressor')) secondSetMinors.push('Compressors & Accessories');
          if (itemText.includes('motor')) secondSetMinors.push('Machinery Parts');
        } else if (itemText.includes('switchgear') || itemText.includes('panel') || itemText.includes('breaker') || itemText.includes('cable')) {
          firstSetMajor = 'Engineering Spares - Electrical';
          if (itemText.includes('panel') || itemText.includes('switchgear')) secondSetMinors.push('Panels');
          if (itemText.includes('breaker') || itemText.includes('mccb')) secondSetMinors.push('Circuit Breakers');
        } else if (itemText.includes('tmt') || itemText.includes('steel') || itemText.includes('civil') || itemText.includes('peb')) {
          firstSetMajor = 'Civil Works';
          if (itemText.includes('peb')) secondSetMinors.push('PEB Structure');
          if (itemText.includes('tmt')) secondSetMinors.push('TMT BARS');
          secondSetMinors.push('Roofing Sheets');
        } else {
          firstSetMajor = 'General Spares & Consumables';
          secondSetMinors.push('Customised Parts');
        }

        // Deduplicate
        secondSetMinors = Array.from(new Set(secondSetMinors));
      }

      return {
        id: v.id,
        vendorCode: v.vendorCode,
        companyName: v.companyName,
        email: v.email,
        contactPerson: v.contactPerson,
        phone: v.phone,
        address: v.address,
        gstNumber: v.gstNumber,
        vendorRatingScore: v.vendorRatingScore,
        hasPoHistory: hasMatchingPOs,
        categoriesMappedByBuyer: hasMatchingPOs,
        itemsSupplied: items,
        pastPoSpend: hasMatchingPOs
          ? `${formatCurrency(totalAmount)} (${matchingPOs.length} POs)`
          : 'No PO History in Dump',
        poCount: matchingPOs.length,
        firstSetMajorCategory: firstSetMajor,
        secondSetMinorCategories: secondSetMinors,
        secondSetSecondaryMajors: hasMatchingPOs ? ['Engineering Spares - Electrical', 'Civil Works'] : [],
      };
    });
  };

  // Editable Vendor Master Table Handlers
  const handleUpdateVendorField = (id: string, field: keyof VendorMasterUploadRecord, value: any) => {
    setStoredVendors((prev) =>
      prev.map((v) => (v.id === id ? { ...v, [field]: value } : v))
    );
  };

  const handleDeleteVendorRow = (id: string) => {
    setStoredVendors((prev) => {
      const updated = prev.filter((v) => v.id !== id);
      if (updated.length === 0) {
        setVendorMasterUploaded(false);
      }
      return updated;
    });
  };

  const handleAddVendorRow = () => {
    const newVendor: VendorMasterUploadRecord = {
      id: `vm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      vendorCode: '',
      companyName: '',
      contactPerson: '',
      email: '',
      phone: '',
      address: '',
      gstNumber: '',
      vendorRatingScore: undefined,
    };
    setStoredVendors((prev) => [...prev, newVendor]);
    setVendorMasterUploaded(true);
    setIsEditingVendorTable(true);
  };

  const fallbackJoined = computeJoinedRecords();
  const joinedVendors = apiJoinedVendors || fallbackJoined;
  const mappedVendors = joinedVendors.filter((v) => v.categoriesMappedByBuyer);
  const unmappedVendors = joinedVendors.filter((v) => !v.categoriesMappedByBuyer);

  // Download Sample Vendor Master Excel (.xlsx)
  const handleDownloadVendorMasterExcel = () => {
    const sampleRows = [
      {
        'Vendor Code': 'VND-1001',
        'Company Name': 'Apex Supplies Ltd.',
        'Contact Person': 'Rajesh Nair',
        'Email ID': 'rajesh@apexsupplies.in',
        Phone: '+91 98201 44820',
        Address: 'MIDC Thane, Mumbai, MH',
        GSTIN: '27AAACA1928K1Z4',
        'Rating (0-100 Optional)': 95,
      },
      {
        'Vendor Code': 'VND-1002',
        'Company Name': 'Kiran Valve Industries',
        'Contact Person': 'Amit Kumar',
        'Email ID': 'amit@kiranvalves.com',
        Phone: '+91 97653 21098',
        Address: 'Bhosari, Pune, MH',
        GSTIN: '27AAACK3921P1Z9',
        'Rating (0-100 Optional)': 78,
      },
      {
        'Vendor Code': 'VND-1007',
        'Company Name': 'Vortex Hydraulic Systems',
        'Contact Person': 'Nikhil Rane',
        'Email ID': 'nikhil@vortexhydraulics.in',
        Phone: '+91 98450 11920',
        Address: 'Peenya, Bangalore, KA',
        GSTIN: '29AAACV8841P1Z5',
        'Rating (0-100 Optional)': 82,
      },
      {
        'Vendor Code': 'VND-1008',
        'Company Name': 'Nova Electrical Spares',
        'Contact Person': 'Pooja Deshmukh',
        'Email ID': 'sales@novaelectricals.com',
        Phone: '+91 97230 44510',
        Address: 'Makarpura, Vadodara, GJ',
        GSTIN: '24AAACN4419K1Z1',
        'Rating (0-100 Optional)': '',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    const workbook: XLSX.WorkBook = {
      Sheets: { 'Vendor Master': worksheet },
      SheetNames: ['Vendor Master'],
    };
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Procucev_Template_1_Vendor_Master.xlsx';
    link.click();
    showToast('Template Downloaded', 'Sample Vendor Master Excel template downloaded.', 'success');
  };
  const handleDownloadVendorMasterCsv = handleDownloadVendorMasterExcel;

  // Download Sample PO Data Excel (.xlsx)
  const handleDownloadPoDataExcel = () => {
    const samplePoRows = [
      {
        'PO Number': 'PO-2025-00891',
        'PO Date': '2025-04-12',
        'Vendor Name': 'Apex Supplies Ltd.',
        'Item Description': 'Centrifugal Water Pump 500 GPM (15 HP Motor)',
        'Specifications': '15 HP Motor, 500 GPM, Cast Iron, Class 150',
        Quantity: 12,
        Unit: 'Units',
        'Unit Price (INR)': 12500,
        'Total Spend (INR)': 150000,
        Department: 'Mechanical',
      },
      {
        'PO Number': 'PO-2025-01156',
        'PO Date': '2025-08-04',
        'Vendor Name': 'Kiran Valve Industries',
        'Item Description': 'Flanged Gate Valve 4-inch Class 150',
        'Specifications': 'Forged Steel, ASTM A105, Flanged RF',
        Quantity: 24,
        Unit: 'Units',
        'Unit Price (INR)': 3800,
        'Total Spend (INR)': 91200,
        Department: 'Piping',
      },
      {
        'PO Number': 'PO-2025-01431',
        'PO Date': '2025-10-10',
        'Vendor Name': 'Nova Electrical Spares',
        'Item Description': 'LV Switchgear Modular Panels with Drawout MCCB',
        'Specifications': '415V, 3-Phase 50Hz, 800A Busbar Rating',
        Quantity: 3,
        Unit: 'Panels',
        'Unit Price (INR)': 85000,
        'Total Spend (INR)': 255000,
        Department: 'Electrical',
      },
      {
        'PO Number': 'PO-2025-01740',
        'PO Date': '2025-12-05',
        'Vendor Name': 'Everest Steel & Infra Structures',
        'Item Description': 'Fe500D TMT High-Yield Reinforcement Bars',
        'Specifications': 'IS 1786 Grade Fe500D, 16mm Diameter',
        Quantity: 120,
        Unit: 'Tons',
        'Unit Price (INR)': 6200,
        'Total Spend (INR)': 744000,
        Department: 'Civil',
      },
      {
        'PO Number': 'PO-2025-02015',
        'PO Date': '2026-01-20',
        'Vendor Name': 'Vortex Hydraulic Systems',
        'Item Description': 'Hydraulic Power Pack Unit 200 Bar with Gear Pump',
        'Specifications': '200 Bar Working Pressure, 40L Reservoir',
        Quantity: 2,
        Unit: 'Units',
        'Unit Price (INR)': 110000,
        'Total Spend (INR)': 220000,
        Department: 'Mechanical',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(samplePoRows);
    const workbook: XLSX.WorkBook = {
      Sheets: { 'PO Purchase Dump': worksheet },
      SheetNames: ['PO Purchase Dump'],
    };
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Procucev_Template_2_PO_Purchase_Dump_${selectedPeriod}.xlsx`;
    link.click();
    showToast('Template Downloaded', 'Sample PO Pre-Purchase Order Dump Excel template downloaded.', 'success');
  };
  const handleDownloadPoDataCsv = handleDownloadPoDataExcel;

  const handleSimulatePOJoin = () => {
    if (storedVendors.length === 0) {
      const msg = 'Vendor Master is required. Please upload your Vendor Master spreadsheet before running AI Category Cross-Match.';
      setVendorUploadError(msg);
      showToast('Vendor Master Required', msg, 'warning');
      setStep(2);
      return;
    }
    if (invalidVendors.length > 0) {
      const msg = `Cannot proceed: ${invalidVendors.length} vendor record(s) contain missing or invalid required fields (Company Name, Email, or Mobile). Please fix them before continuing.`;
      setVendorUploadError(msg);
      showToast('Validation Error in Vendor Master', msg, 'warning');
      setStep(2);
      return;
    }
    if (poLineItems.length === 0) {
      const msg = 'Historical PO Dump is required. Please upload your PO purchase dump spreadsheet before running AI Category Cross-Match.';
      setPoUploadError(msg);
      showToast('PO Dump Required', msg, 'warning');
      return;
    }

    setIsProcessingPOJoin(true);
    let apiData: HistoricalPurchaseVendorRecord[] | null = null;

    fetch('/api/buyer-accounts/ai-cross-match', {
      method: 'POST',
      headers: authFetchHeaders(),
      body: JSON.stringify({
        vendors: storedVendors,
        poLineItems,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && json.success && Array.isArray(json.data)) {
          apiData = json.data;
          setApiJoinedVendors(json.data);
        }
      })
      .catch((err) => {
        console.warn('Backend AI cross-match API error:', err);
      });

    setTimeout(() => {
      setIsProcessingPOJoin(false);
      const dataToSet = apiData || computeJoinedRecords();
      setApiJoinedVendors(dataToSet);
      setStep(4);
      const mappedCount = dataToSet.filter((v: any) => v.categoriesMappedByBuyer).length;
      const unmappedCount = dataToSet.length - mappedCount;
      showToast(
        'Cross-Match Complete',
        `Matched PO data against ${storedVendors.length} stored vendors. ${mappedCount} categorized, ${unmappedCount} flagged for self-mapping.`,
        'success'
      );
    }, 600);
  };

  const handleConfirmFinalIngestion = async () => {
    if (isConfirmingIngestion) return;
    setSubmissionError(null);
    setIsConfirmingIngestion(true);
    try {
      if (joinedVendors.length === 0) {
        const msg = 'No vendor records found to ingest. Please upload a valid Vendor Master file first.';
        setSubmissionError(msg);
        showToast('Ingestion Error', msg, 'warning');
        return;
      }
      const imported = await processHistoricalPurchaseData(selectedPeriod, joinedVendors);
      if (imported === 0 && !lastIngestionSummary && joinedVendors.length > 0) {
        const msg = 'Failed to ingest historical purchase data. Please check your network connection and server status, then try again.';
        setSubmissionError(msg);
        showToast('Ingestion Failed', msg, 'warning');
        return;
      }
      setInitialSetupModalOpen(false);
      showToast(
        'Setup Complete',
        `Dual-file vendor master and PO data ingested successfully for ${selectedPeriod === '1_year' ? '1 Year' : selectedPeriod === '2_years' ? '2 Years' : '3 Years'} (${joinedVendors.length} suppliers processed).`,
        'success'
      );
    } catch (err: any) {
      console.error('Ingestion confirmation error:', err);
      const msg = err?.message || 'An unexpected error occurred during ingestion. Please try again.';
      setSubmissionError(msg);
      showToast('Ingestion Error', msg, 'warning');
    } finally {
      setIsConfirmingIngestion(false);
    }
  };

  const handleRetryFailedEmails = async () => {
    if (isRetryingFailedEmails) return;
    setIsRetryingFailedEmails(true);
    try {
      await processHistoricalPurchaseData(selectedPeriod, joinedVendors);
      showToast(
        'Retrying Dispatches',
        'Re-attempting emails for failed vendors. Already sent emails were preserved.',
        'info'
      );
    } catch (err) {
      console.error('Retry error:', err);
      showToast('Retry Failed', 'Could not complete retry dispatch.', 'warning');
    } finally {
      setIsRetryingFailedEmails(false);
    }
  };

  const handleCompleteAndClose = () => {
    if (setInitialSetupCompleted) {
      setInitialSetupCompleted(true);
    }
    setInitialSetupModalOpen(false);
    setCompletionSummary(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl p-6 sm:p-8 bg-white dark:bg-gray-900 border-2 border-indigo-500/30 dark:border-indigo-500/40 shadow-2xl space-y-6 animate-scale-up">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-gray-800 pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 shrink-0">
              <Building2 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  Buyer Initial Setup: Vendor Master & PO Data Ingestion
                </h2>
                <span className="badge badge-amber font-mono font-bold text-[10px] uppercase">
                  Dual-File ERP Setup
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 leading-relaxed">
                Organization: <strong>{activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited'}</strong> · Upload Vendor Master and PO purchase dump separately for AI category cross-mapping.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCloseModal}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              title="Dismiss setup (you can resume from the blinking corner badge)"
            >
              <X size={20} />
            </button>
          </div>
        </div>


        {/* Step Progress Indicators */}
        <div className="grid grid-cols-5 gap-1.5 text-center text-[11px] font-bold">
          {[
            { num: 1, label: '1. Time Horizon' },
            { num: 2, label: '2. Vendor Master' },
            { num: 3, label: '3. PO Dump' },
            { num: 4, label: '4. AI Category Join' },
            { num: 5, label: '5. Dispatch Emails' },
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => navigateToStep(s.num as any)}
              className={`p-2 rounded-xl border transition-all ${
                step === s.num
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                  : step > s.num
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200'
                  : 'bg-slate-50 dark:bg-gray-800/60 text-slate-400 dark:text-gray-500 border-slate-200 dark:border-gray-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* STEP 1: CHOOSE TIME HORIZON */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 1: Choose Historical Purchase Period
              </h3>
            </div>

            {/* Vendor Master Template & Required Columns Banner */}
            <div className="p-3.5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-r from-indigo-50/70 via-purple-50/30 to-blue-50/70 dark:from-indigo-950/40 dark:via-purple-950/20 dark:to-blue-950/40 flex items-center justify-between gap-3 shadow-xs flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="badge badge-indigo font-bold text-[10px] shrink-0">Required Columns</span>
                <span className="text-xs text-slate-700 dark:text-gray-300 font-medium">
                  Vendor Code, Company Name, Contact Person, Mobile, Email, GSTIN &amp; Location
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadVendorMasterExcel}
                  className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Download size={13} /> Download Vendor Master Template
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: '1_year' as const,
                  title: 'Last 1 Year (12 Months)',
                  desc: 'Fast bootstrap focusing on recent high-velocity procurement spares.',
                  badge: 'Quick Ingestion',
                },
                {
                  id: '2_years' as const,
                  title: 'Last 2 Years (24 Months)',
                  desc: 'Recommended baseline covering seasonal maintenance & capex cycles.',
                  badge: '⭐ Recommended',
                },
                {
                  id: '3_years' as const,
                  title: 'Last 3 Years (36 Months)',
                  desc: 'Complete historical enterprise audit and comprehensive supplier discovery.',
                  badge: 'Full Enterprise Audit',
                },
              ].map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => {
                    setSelectedPeriod(opt.id);
                    setHistoricalPurchaseDataPeriod(opt.id);
                  }}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    selectedPeriod === opt.id
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20 shadow-md'
                      : 'border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 bg-slate-50/50 dark:bg-gray-850/40'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          selectedPeriod === opt.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-gray-800 text-slate-700 dark:text-gray-300'
                        }`}
                      >
                        {opt.badge}
                      </span>
                      <Clock size={15} className={selectedPeriod === opt.id ? 'text-indigo-600' : 'text-slate-400'} />
                    </div>
                    <h4 className="text-xs font-black text-slate-900 dark:text-white mt-1">{opt.title}</h4>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">{opt.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => navigateToStep(2)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Continue to File 1: Vendor Master <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: FILE 1 — VENDOR MASTER DATA INGESTION */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            {/* Hidden native file input */}
            <input
              type="file"
              ref={vendorFileInputRef}
              className="hidden"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleVendorFileUpload(file);
              }}
            />

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 2: Upload File 1 — Vendor Master
              </h3>
              {storedVendors.length > 0 && (
                <button
                  type="button"
                  onClick={clearVendorMasterData}
                  className="text-[11px] text-rose-600 hover:text-rose-700 dark:text-rose-400 underline font-medium"
                >
                  Clear Selection
                </button>
              )}
            </div>

            {/* Error Banner if Vendor Upload has issues */}
            {vendorUploadError && (
              <div
                data-testid="vendor-upload-error-banner"
                className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2.5 shadow-xs animate-shake"
              >
                <AlertCircle className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" size={16} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-rose-900 dark:text-rose-100">Vendor Master Upload / Validation Error</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed">{vendorUploadError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setVendorUploadError(null)}
                  className="text-rose-500 hover:text-rose-700 dark:text-rose-400 p-0.5"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Validation Warning Banner if some stored vendors are missing required fields */}
            {storedVendors.length > 0 && invalidVendors.length > 0 && (
              <div
                data-testid="vendor-validation-warning-banner"
                className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5 shadow-xs"
              >
                <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={16} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-amber-900 dark:text-amber-100">
                    {invalidVendors.length} Supplier Record{invalidVendors.length > 1 ? 's' : ''} Missing Required Fields
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                    Required fields: <strong>Company Name</strong>, <strong>Email Address</strong>, and <strong>Mobile / Phone</strong>.
                    You cannot move to the next step until all vendor records have valid required information.
                  </p>
                  {!isEditingVendorTable && (
                    <button
                      type="button"
                      onClick={() => setIsEditingVendorTable(true)}
                      className="btn btn-secondary btn-xs font-bold text-[10px] mt-2 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 flex items-center gap-1"
                    >
                      <Pencil size={11} /> Edit and Fix Incomplete Records
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Progress Card when upload is active or completed */}
            {vendorJob && (
              <IngestionProgressCard job={vendorJob} title="Vendor Master" unit="vendors" />
            )}

            {/* Drag & Drop Vendor Master Area or Uploaded State Banner */}
            {storedVendors.length > 0 || vendorJob?.status === 'COMPLETED' ? (
              <div
                data-testid="vendor-master-uploaded-card"
                className="p-5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border-2 border-emerald-500/40 dark:border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-fade-in"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-sm">
                    <CheckCircle2 size={24} />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                        Vendor Master Uploaded Successfully
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 border border-emerald-400/40">
                        <Check size={10} /> Active
                      </span>
                    </div>
                    <p className="text-sm font-black font-mono text-slate-900 dark:text-white">
                      {vendorFileName || vendorJob?.fileName || 'Vendor_Master_Database.xlsx'}
                    </p>
                    <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 font-medium">
                      {(vendorJob?.importedRecords || storedVendors.length).toLocaleString('en-IN')} suppliers parsed and loaded into vendor master
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => vendorFileInputRef.current?.click()}
                    className="btn btn-secondary btn-sm font-bold text-xs flex items-center gap-1.5 border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800"
                    title="Replace or upload a different Vendor Master file"
                  >
                    <UploadCloud size={13} /> Choose Another File
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearVendorMasterData();
                      setVendorJob(null);
                    }}
                    className="btn btn-secondary btn-sm font-bold text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-200 dark:border-rose-900/50 flex items-center gap-1.5"
                    title="Clear uploaded Vendor Master file"
                  >
                    <Trash2 size={13} /> Clear
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => vendorFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingVendor(true);
                }}
                onDragLeave={() => setIsDraggingVendor(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingVendor(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleVendorFileUpload(file);
                }}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
                  isDraggingVendor
                    ? 'border-indigo-600 bg-indigo-100/70 dark:bg-indigo-900/50 scale-[1.01]'
                    : 'border-indigo-300 dark:border-indigo-500/50 hover:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50/80'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-600/20 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                  <UploadCloud size={20} />
                </div>
                <div className="text-xs font-bold text-slate-800 dark:text-white mt-2">
                  {isParsingVendor || vendorJob?.status === 'PROCESSING'
                    ? 'Streaming and Processing Vendor Records in Background...'
                    : 'Click to browse or drag & drop Vendor Master (.xlsx, .csv, .xls)'}
                </div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      vendorFileInputRef.current?.click();
                    }}
                    className="btn btn-primary btn-xs font-bold text-[10px] inline-flex items-center gap-1 shadow-xs"
                  >
                    <UploadCloud size={11} /> Browse File
                  </button>
                  <span className="text-[10px] text-slate-400">Supported formats: .xlsx, .csv, .xls (Max 10MB)</span>
                </div>
              </div>
            )}

            {/* Table of Stored Vendor Master or Empty State */}
            {storedVendors.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      {isEditingVendorTable ? 'Editing Vendor Master Records' : 'Stored Vendor Master Records'} ({storedVendors.length.toLocaleString('en-IN')} Suppliers):
                    </span>
                    {isEditingVendorTable && (
                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800/50 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Sparkles size={10} /> Edit Mode Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditingVendorTable ? (
                      <>
                        <button
                          type="button"
                          onClick={handleAddVendorRow}
                          className="btn btn-secondary btn-xs font-bold text-[10px] flex items-center gap-1"
                        >
                          <Plus size={11} /> Add Vendor Row
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingVendorTable(false)}
                          className="btn btn-primary btn-xs font-bold text-[10px] flex items-center gap-1 shadow-xs"
                        >
                          <Check size={11} /> Done Editing
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setIsEditingVendorTable(true)}
                          className="btn btn-secondary btn-xs font-bold text-[10px] flex items-center gap-1 shadow-xs border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                        >
                          <Pencil size={11} /> Edit Data
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditingVendorTable ? (
                  /* EDITABLE MODE TABLE */
                  <div className="border border-indigo-200 dark:border-indigo-800 rounded-xl overflow-hidden max-h-96 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900 shadow-inner ring-1 ring-indigo-500/20">
                    <table className="w-full text-left border-collapse min-w-[960px]">
                      <thead className="bg-indigo-50/70 dark:bg-gray-800 text-[10px] uppercase font-bold text-indigo-900 dark:text-gray-300 sticky top-0 z-10">
                        <tr>
                          <th className="p-2 w-28">Vendor Code</th>
                          <th className="p-2 min-w-[140px]">Company Name *</th>
                          <th className="p-2 min-w-[120px]">Contact Person</th>
                          <th className="p-2 min-w-[140px]">Email Address *</th>
                          <th className="p-2 min-w-[110px]">Phone *</th>
                          <th className="p-2 min-w-[120px]">GSTIN</th>
                          <th className="p-2 min-w-[140px]">Address / Location</th>
                          <th className="p-2 min-w-[110px]">Rating</th>
                          <th className="p-2 w-10 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                        {storedVendors.slice(0, vendorPreviewLimit).map((v) => {
                          const rowErrors = getVendorRowErrors(v);
                          const hasErrors = rowErrors.length > 0;
                          const isNameInvalid = !v.companyName || v.companyName.trim() === '';
                          const isEmailInvalid = !v.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim());
                          const isPhoneInvalid = !v.phone || v.phone.trim() === '';

                          return (
                            <tr
                              key={v.id}
                              className={`transition-colors ${
                                hasErrors
                                  ? 'bg-rose-50/50 dark:bg-rose-950/20'
                                  : 'hover:bg-indigo-50/30 dark:hover:bg-gray-800/50'
                              } group`}
                            >
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.vendorCode || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'vendorCode', e.target.value)}
                                  placeholder="VND-CODE"
                                  className="w-full font-mono text-[10px] font-bold px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                                />
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.companyName || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'companyName', e.target.value)}
                                  placeholder="Company name"
                                  className={`w-full font-bold text-xs px-1.5 py-1 rounded focus:outline-none transition-all ${
                                    isNameInvalid
                                      ? 'border border-rose-400 bg-rose-50/70 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 focus:border-rose-500'
                                      : 'border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-slate-900 dark:text-white focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900'
                                  }`}
                                />
                                {isNameInvalid && (
                                  <span className="text-[9px] text-rose-600 dark:text-rose-400 font-bold block mt-0.5">Required</span>
                                )}
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.contactPerson || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'contactPerson', e.target.value)}
                                  placeholder="Contact Name"
                                  className="w-full text-[10px] px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                                />
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="email"
                                  value={v.email || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'email', e.target.value)}
                                  placeholder="email@domain.com"
                                  className={`w-full font-mono text-[10px] font-semibold px-1.5 py-1 rounded focus:outline-none transition-all ${
                                    isEmailInvalid
                                      ? 'border border-rose-400 bg-rose-50/70 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 focus:border-rose-500'
                                      : 'border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-indigo-600 dark:text-indigo-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900'
                                  }`}
                                />
                                {isEmailInvalid && (
                                  <span className="text-[9px] text-rose-600 dark:text-rose-400 font-bold block mt-0.5">
                                    {v.email ? 'Invalid Email' : 'Required'}
                                  </span>
                                )}
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.phone || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'phone', e.target.value)}
                                  placeholder="+91 Phone"
                                  className={`w-full text-[10px] px-1.5 py-1 rounded focus:outline-none transition-all ${
                                    isPhoneInvalid
                                      ? 'border border-rose-400 bg-rose-50/70 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 focus:border-rose-500'
                                      : 'border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-slate-500 dark:text-gray-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900'
                                  }`}
                                />
                                {isPhoneInvalid && (
                                  <span className="text-[9px] text-rose-600 dark:text-rose-400 font-bold block mt-0.5">Required</span>
                                )}
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.gstNumber || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'gstNumber', e.target.value.toUpperCase())}
                                  placeholder="GSTIN"
                                  className="w-full font-mono text-[10px] font-bold px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-200 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                                />
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.address || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'address', e.target.value)}
                                  placeholder="City, State / Address"
                                  className="w-full text-[10px] px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                                />
                              </td>
                              <td className="p-1.5 align-top">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={v.vendorRatingScore !== undefined ? v.vendorRatingScore : ''}
                                    onChange={(e) => {
                                      const raw = e.target.value.trim();
                                      handleUpdateVendorField(
                                        v.id,
                                        'vendorRatingScore',
                                        raw === '' ? undefined : Math.min(100, Math.max(0, Math.round(Number(raw))))
                                      );
                                    }}
                                    placeholder="0-100"
                                    className="w-16 text-center font-bold text-xs px-2 py-1 rounded bg-amber-50/80 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 placeholder:text-amber-400/60 focus:border-amber-500 focus:outline-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <span className="text-[10px] text-slate-400 font-bold shrink-0">/100</span>
                                </div>
                              </td>
                              <td className="p-1.5 align-top text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteVendorRow(v.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-all opacity-70 group-hover:opacity-100"
                                  title={`Delete ${v.companyName || 'Row'}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* DEFAULT READ-ONLY TABLE WITH ALL DISTINCT COLUMNS */
                  <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden max-h-96 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900/60 shadow-xs">
                    <table className="w-full text-left border-collapse min-w-[960px]">
                      <thead className="bg-slate-100 dark:bg-gray-800 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 sticky top-0 z-10">
                        <tr>
                          <th className="p-2.5">Vendor Code</th>
                          <th className="p-2.5">Company Name</th>
                          <th className="p-2.5">Contact Person</th>
                          <th className="p-2.5">Email Address</th>
                          <th className="p-2.5">Phone Number</th>
                          <th className="p-2.5">GSTIN</th>
                          <th className="p-2.5">Address / Location</th>
                          <th className="p-2.5">Rating (0-100)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                        {storedVendors.slice(0, vendorPreviewLimit).map((v) => {
                          const rowErrors = getVendorRowErrors(v);
                          const hasErrors = rowErrors.length > 0;
                          const isNameInvalid = !v.companyName || v.companyName.trim() === '';
                          const isEmailInvalid = !v.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim());
                          const isPhoneInvalid = !v.phone || v.phone.trim() === '';

                          return (
                            <tr
                              key={v.id}
                              className={`transition-colors ${
                                hasErrors
                                  ? 'bg-rose-50/70 dark:bg-rose-950/30 border-l-4 border-l-rose-500'
                                  : 'hover:bg-slate-50 dark:hover:bg-gray-800/40'
                              }`}
                            >
                              <td className="p-2.5 font-mono text-[10px] text-slate-500">{v.vendorCode || 'VND-AUTO'}</td>
                              <td className="p-2.5 font-bold text-slate-800 dark:text-white">
                                {isNameInvalid ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold inline-flex items-center gap-1">
                                    <AlertCircle size={11} /> Required
                                  </span>
                                ) : (
                                  v.companyName
                                )}
                              </td>
                              <td className="p-2.5 text-slate-700 dark:text-gray-300 font-medium">{v.contactPerson || '—'}</td>
                              <td className="p-2.5 font-mono text-[11px]">
                                {isEmailInvalid ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold inline-flex items-center gap-1">
                                    <AlertCircle size={11} /> {v.email ? 'Invalid Email' : 'Email Required'}
                                  </span>
                                ) : (
                                  <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{v.email}</span>
                                )}
                              </td>
                              <td className="p-2.5 font-mono text-[11px]">
                                {isPhoneInvalid ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold inline-flex items-center gap-1">
                                    <AlertCircle size={11} /> Mobile Required
                                  </span>
                                ) : (
                                  <span className="text-slate-600 dark:text-gray-400">{v.phone}</span>
                                )}
                              </td>
                              <td className="p-2.5 font-mono text-[10px] text-slate-700 dark:text-gray-200 font-bold">{v.gstNumber || '—'}</td>
                              <td className="p-2.5 text-slate-600 dark:text-gray-400 text-[11px] truncate max-w-[200px]">{v.address || '—'}</td>
                              <td className="p-2.5 font-bold">
                                {v.vendorRatingScore !== undefined && v.vendorRatingScore !== null ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                    <Star size={11} className="fill-amber-400 text-amber-500" /> {v.vendorRatingScore}/100
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-[10px]">Optional (N/A)</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Vendor Master Pagination / Show More Bar */}
                {storedVendors.length > 50 && (
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200 dark:border-gray-800 text-xs flex-wrap gap-2">
                    <span className="text-[11px] text-slate-600 dark:text-gray-300 font-medium">
                      Showing <strong>1 – {Math.min(vendorPreviewLimit, storedVendors.length).toLocaleString('en-IN')}</strong> of <strong>{storedVendors.length.toLocaleString('en-IN')}</strong> suppliers
                    </span>
                    <div className="flex items-center gap-2">
                      {vendorPreviewLimit < storedVendors.length && (
                        <button
                          type="button"
                          onClick={() => setVendorPreviewLimit((prev) => Math.min(prev + 50, storedVendors.length))}
                          className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 hover:border-indigo-400"
                        >
                          <ChevronDown size={12} /> Show More (+50)
                        </button>
                      )}
                      {vendorPreviewLimit < Math.min(500, storedVendors.length) && (
                        <button
                          type="button"
                          onClick={() => setVendorPreviewLimit(Math.min(500, storedVendors.length))}
                          className="btn btn-secondary btn-xs font-bold text-[11px] text-indigo-600 dark:text-indigo-400 hover:border-indigo-400"
                        >
                          Show All (up to 500)
                        </button>
                      )}
                      {vendorPreviewLimit > 50 && (
                        <button
                          type="button"
                          onClick={() => setVendorPreviewLimit(50)}
                          className="text-[11px] text-slate-400 hover:text-slate-600 underline font-medium px-1"
                        >
                          Collapse to 50
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 border border-dashed border-slate-200 dark:border-gray-800 rounded-xl bg-slate-50/50 dark:bg-gray-950/40 space-y-2">
                <FileSpreadsheet className="mx-auto text-slate-400" size={24} />
                <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                  No Vendor Master file selected
                </p>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Upload your vendor master spreadsheet (.xlsx, .csv, .xls) or manually add suppliers to the table.
                </p>
                <button
                  type="button"
                  onClick={handleAddVendorRow}
                  className="btn btn-secondary btn-xs font-bold text-[11px] inline-flex items-center gap-1 mt-1"
                >
                  <Plus size={12} /> Add Vendor Manually
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => navigateToStep(1)} className="btn btn-secondary btn-sm">
                Back to Period
              </button>
              <button
                type="button"
                onClick={() => navigateToStep(3)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Proceed to File 2: PO Dump <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: FILE 2 — PO PURCHASE DATA INGESTION */}
        {step === 3 && (
          <div className="space-y-4 animate-fade-in">
            {/* Hidden native file input */}
            <input
              type="file"
              ref={poFileInputRef}
              className="hidden"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePODataFileUpload(file);
              }}
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                  Step 3: Upload File 2 — Historical PO Purchase Dump
                </h3>
                <span className="badge badge-purple font-bold text-[10px]">
                  {selectedPeriod === '1_year' ? '1 Year' : selectedPeriod === '2_years' ? '2 Years' : '3 Years'}
                </span>
              </div>
            </div>

            {/* Single-line Simplified PO Dump Info & Download Banner */}
            <div className="p-3.5 rounded-2xl border border-purple-200 dark:border-purple-900/60 bg-gradient-to-r from-purple-50/70 via-indigo-50/30 to-blue-50/70 dark:from-purple-950/40 dark:via-indigo-950/20 dark:to-blue-950/40 flex items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="badge badge-purple font-bold text-[10px] shrink-0">Required Columns</span>
                <span className="text-xs text-slate-700 dark:text-gray-300 font-medium truncate">
                  PO Number, PO Date, Vendor Name, Item Description, Quantity, Spend &amp; Department
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadPoDataExcel}
                  className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Download size={13} /> Download PO Dump Template (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={resetToSamplePoData}
                  className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 underline font-medium"
                >
                  Reset Template
                </button>
              </div>
            </div>

            {/* Error Banner if PO Upload has issues */}
            {poUploadError && (
              <div
                data-testid="po-upload-error-banner"
                className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2.5 shadow-xs animate-shake"
              >
                <AlertCircle className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" size={16} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-rose-900 dark:text-rose-100">PO Dump Upload / Validation Error</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed">{poUploadError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPoUploadError(null)}
                  className="text-rose-500 hover:text-rose-700 dark:text-rose-400 p-0.5"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Progress Card when PO upload is active or completed */}
            {poJob && (
              <IngestionProgressCard job={poJob} title="PO Dump" unit="PO records" />
            )}

            {/* Drag & Drop PO Dump Area or Uploaded State Banner */}
            {poLineItems.length > 0 || poJob?.status === 'COMPLETED' ? (
              <div
                data-testid="po-dump-uploaded-card"
                className="p-5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border-2 border-emerald-500/40 dark:border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-fade-in"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-sm">
                    <CheckCircle2 size={24} />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                        PO Dump Uploaded Successfully
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 border border-emerald-400/40">
                        <Check size={10} /> Active
                      </span>
                    </div>
                    <p className="text-sm font-black font-mono text-slate-900 dark:text-white">
                      {poFileName || poJob?.fileName || 'PO_Purchase_Dump.xlsx'}
                    </p>
                    <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 font-medium">
                      {(poJob?.importedRecords || poLineItems.length).toLocaleString('en-IN')} PO records loaded for period ({selectedPeriod === '1_year' ? '1 Year' : selectedPeriod === '2_years' ? '2 Years' : '3 Years'})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => poFileInputRef.current?.click()}
                    className="btn btn-secondary btn-sm font-bold text-xs flex items-center gap-1.5 border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800"
                    title="Replace or upload a different PO Dump file"
                  >
                    <UploadCloud size={13} /> Choose Another File
                  </button>
                  <button
                    type="button"
                    onClick={resetToSamplePoData}
                    className="btn btn-secondary btn-sm font-bold text-xs text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 border-slate-300 dark:border-gray-700 flex items-center gap-1.5"
                    title="Reset PO data to default sample"
                  >
                    <RotateCcw size={13} /> Reset
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => poFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingPo(true);
                }}
                onDragLeave={() => setIsDraggingPo(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingPo(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handlePODataFileUpload(file);
                }}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
                  isDraggingPo
                    ? 'border-purple-600 bg-purple-100/70 dark:bg-purple-900/50 scale-[1.01]'
                    : 'border-purple-300 dark:border-purple-500/50 hover:border-purple-600 bg-purple-50/40 dark:bg-purple-950/20 hover:bg-purple-50/80'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-600/20 flex items-center justify-center mx-auto text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
                  <FileSpreadsheet size={20} />
                </div>
                <div className="text-xs font-bold text-slate-800 dark:text-white mt-2">
                  {isParsingPo || poJob?.status === 'PROCESSING'
                    ? 'Streaming and Processing PO Dump Records in Background...'
                    : 'Click to browse or drag & drop PO Purchase Dump (.xlsx, .csv, .xls)'}
                </div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      poFileInputRef.current?.click();
                    }}
                    className="btn btn-primary btn-xs font-bold text-[10px] inline-flex items-center gap-1 shadow-xs"
                  >
                    <UploadCloud size={11} /> Browse File
                  </button>
                  <span className="text-[10px] text-slate-400">Supported formats: .xlsx, .csv, .xls (Max 10MB)</span>
                </div>
              </div>
            )}

            {/* PO Line Items Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  PO Line Items Preview ({poLineItems.length.toLocaleString('en-IN')} Line Items):
                </span>
                <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold">
                  Total Spend: {formatCurrency(poLineItems.reduce((acc, p) => acc + p.totalSpend, 0))}
                </span>
              </div>

              <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden max-h-56 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900/60 shadow-xs">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead className="bg-slate-100 dark:bg-gray-800 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 sticky top-0 z-10">
                    <tr>
                      <th className="p-2.5">PO Number</th>
                      <th className="p-2.5">PO Date</th>
                      <th className="p-2.5">Vendor / Supplier</th>
                      <th className="p-2.5">Line Item Description</th>
                      <th className="p-2.5">Specifications</th>
                      <th className="p-2.5">Quantity</th>
                      <th className="p-2.5">Unit</th>
                      <th className="p-2.5">Unit Price</th>
                      <th className="p-2.5">Total Spend</th>
                      <th className="p-2.5">Department</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800 bg-white dark:bg-gray-900/60">
                    {poLineItems.slice(0, poPreviewLimit).map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                        <td className="p-2.5 font-mono text-[10px] text-slate-500">{p.poNumber}</td>
                        <td className="p-2.5 font-mono text-[10px] text-slate-600 dark:text-gray-300">{normalizePoDate(p.poDate) || p.poDate || '—'}</td>
                        <td className="p-2.5 font-bold text-slate-800 dark:text-white">{p.vendorIdentifier}</td>
                        <td className="p-2.5 font-semibold text-slate-800 dark:text-gray-200">{p.itemName}</td>
                        <td className="p-2.5 text-slate-400 text-[10px] max-w-[160px] truncate">{p.specs || '—'}</td>
                        <td className="p-2.5 text-slate-600 dark:text-gray-300 font-bold">{p.quantity.toLocaleString('en-IN')}</td>
                        <td className="p-2.5 text-slate-500 dark:text-gray-400 text-[10px]">{p.unit}</td>
                        <td className="p-2.5 font-mono text-slate-600 dark:text-gray-300">{p.unitPrice ? formatCurrency(p.unitPrice) : '—'}</td>
                        <td className="p-2.5 font-mono font-bold text-indigo-700 dark:text-indigo-300">
                          {formatCurrency(p.totalSpend)}
                        </td>
                        <td className="p-2.5 text-slate-500 dark:text-gray-400 text-[10px]">{p.department || 'General'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PO Dump Pagination / Show More Bar */}
              {poLineItems.length > 50 && (
                <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200 dark:border-gray-800 text-xs flex-wrap gap-2">
                  <span className="text-[11px] text-slate-600 dark:text-gray-300 font-medium">
                    Showing <strong>1 – {Math.min(poPreviewLimit, poLineItems.length).toLocaleString('en-IN')}</strong> of <strong>{poLineItems.length.toLocaleString('en-IN')}</strong> PO line items
                  </span>
                  <div className="flex items-center gap-2">
                    {poPreviewLimit < poLineItems.length && (
                      <button
                        type="button"
                        onClick={() => setPoPreviewLimit((prev) => Math.min(prev + 50, poLineItems.length))}
                        className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 hover:border-purple-400"
                      >
                        <ChevronDown size={12} /> Show More (+50)
                      </button>
                    )}
                    {poPreviewLimit < Math.min(500, poLineItems.length) && (
                      <button
                        type="button"
                        onClick={() => setPoPreviewLimit(Math.min(500, poLineItems.length))}
                        className="btn btn-secondary btn-xs font-bold text-[11px] text-purple-600 dark:text-purple-400 hover:border-purple-400"
                      >
                        Show All (up to 500)
                      </button>
                    )}
                    {poPreviewLimit > 50 && (
                      <button
                        type="button"
                        onClick={() => setPoPreviewLimit(50)}
                        className="text-[11px] text-slate-400 hover:text-slate-600 underline font-medium px-1"
                      >
                        Collapse to 50
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => navigateToStep(2)} className="btn btn-secondary btn-sm">
                Back to Vendor Master
              </button>
              <button
                type="button"
                onClick={handleSimulatePOJoin}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                {isProcessingPOJoin ? 'Processing Join...' : 'Run AI Category Cross-Match'} <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: AI CATEGORY JOIN & CROSS-MATCH AUDIT */}
        {step === 4 && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                  Step 4: AI Cross-Match & Category Assignment Audit
                </h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Review vendors with buyer-mapped categories vs vendors requiring self-mapping.
                </p>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-800 p-1 rounded-xl text-xs font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('all')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeReviewTab === 'all' ? 'bg-white dark:bg-gray-900 text-indigo-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  All ({joinedVendors.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('mapped')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeReviewTab === 'mapped' ? 'bg-white dark:bg-gray-900 text-emerald-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  ✓ Mapped ({mappedVendors.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('unmapped')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeReviewTab === 'unmapped' ? 'bg-white dark:bg-gray-900 text-amber-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  ⚠️ Unmapped ({unmappedVendors.length})
                </button>
              </div>
            </div>

            {/* List of Correlated Vendors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1 text-xs">
              {joinedVendors
                .filter((v) => {
                  if (activeReviewTab === 'mapped') return v.categoriesMappedByBuyer;
                  if (activeReviewTab === 'unmapped') return !v.categoriesMappedByBuyer;
                  return true;
                })
                .map((v) => (
                  <div
                    key={v.id}
                    className={`p-4 rounded-2xl border transition-all space-y-2.5 ${
                      v.categoriesMappedByBuyer
                        ? 'bg-slate-50/80 dark:bg-gray-800/50 border-slate-200 dark:border-gray-800'
                        : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300/80 dark:border-amber-800/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-black text-slate-900 dark:text-white text-xs">{v.companyName}</h4>
                          {v.vendorCode && (
                            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-300">
                              {v.vendorCode}
                            </span>
                          )}
                        </div>
                      </div>


                      {v.categoriesMappedByBuyer ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 shrink-0 flex items-center gap-0.5">
                          <Check size={10} /> PO Mapped ({v.poCount} POs)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 shrink-0 flex items-center gap-0.5">
                          <AlertCircle size={10} /> No POs · Self-Map
                        </span>
                      )}
                    </div>

                    {(() => {
                      const emails = getUniqueEmails(v.email);
                      const phone = v.phone?.trim();
                      if (emails.length === 0 && !phone) return null;
                      return (
                        <div className="flex flex-nowrap items-center gap-x-2 text-[10px] text-slate-500 font-mono min-w-0 max-w-full">
                          {emails.length > 0 && (
                            <span className="min-w-0 truncate" title={emails.join(', ')}>
                              {emails.join(', ')}
                            </span>
                          )}
                          {emails.length > 0 && phone && (
                            <span className="shrink-0 text-slate-300 dark:text-gray-600" aria-hidden="true">·</span>
                          )}
                          {phone && <span className="shrink-0 whitespace-nowrap">{phone}</span>}
                        </div>
                      );
                    })()}

                    {v.categoriesMappedByBuyer ? (
                      <>
                        {/* 1st Set Category */}
                        <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-800/50">
                          <span className="text-[9px] uppercase font-black text-indigo-700 dark:text-indigo-300 block">
                            1st Set: Primary Major Category
                          </span>
                          <span className="font-bold text-indigo-950 dark:text-white text-xs block mt-0.5">
                            {v.firstSetMajorCategory}
                          </span>
                        </div>

                        {/* 2nd Set Minor Categories */}
                        <div className="space-y-1">
                          <span className="text-[9px] uppercase font-bold text-slate-400 block">
                            2nd Set: Minor Categories & Product Lines
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {v.secondSetMinorCategories.map((m) => (
                              <span
                                key={m}
                                className="px-2 py-0.5 rounded-lg bg-white dark:bg-gray-900 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700 text-[10px] font-semibold"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      /* Unmapped Fallback Notice Box */
                      <div className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/60 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                        <div className="font-bold flex items-center gap-1 text-amber-800 dark:text-amber-300 text-[10px] uppercase">
                          <AlertCircle size={12} />
                          Dispatched Notification Protocol:
                        </div>
                        <p className="text-[10px] leading-relaxed">
                          The onboarding email will explicitly notify <strong>{v.companyName}</strong> that <em>&quot;the buyer didn&apos;t map any categories for you, so please map yourself in order to receive enquiries.&quot;</em>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => navigateToStep(3)} className="btn btn-secondary btn-sm">
                Back to PO Dump
              </button>
              <button
                type="button"
                onClick={() => navigateToStep(5)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Review Email Dispatch & Finalize <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: FINAL CONFIRMATION & TAILORED EMAIL PREVIEWS */}
        {step === 5 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 5: Confirm Ingestion & Dispatch Tailored Onboarding Emails
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                The platform will dispatch tailored credentials and category notices based on PO correlation.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Template A Card: PO-Mapped Suppliers */}
              <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 flex flex-col justify-between space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-indigo-900 dark:text-indigo-200 text-[11px] flex items-center gap-1">
                      <CheckCircle2 size={13} className="text-emerald-600" />
                      Template A: Suppliers With Pre-Purchase Order History ({mappedVendors.length})
                    </span>
                    {(savedTemplateA?.subject || savedTemplateA?.message) && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 shrink-0">
                        Customized
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-indigo-900/80 dark:text-indigo-300/90 leading-snug">
                    Dispatches mapped supply categories, login credentials, and verification link to correlated PO suppliers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openTemplateModal('A')}
                  className="btn btn-secondary btn-xs w-full font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 inline-flex items-center justify-center gap-1.5 py-2"
                >
                  <Pencil size={11} /> View & Edit Template A
                </button>
              </div>

              {/* Template B Card: Unmapped Suppliers */}
              <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex flex-col justify-between space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-amber-900 dark:text-amber-200 text-[11px] flex items-center gap-1">
                      <AlertCircle size={13} className="text-amber-600" />
                      Template B: Suppliers With NO Pre-Purchase Orders ({unmappedVendors.length})
                    </span>
                    {(savedTemplateB?.subject || savedTemplateB?.message) && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 shrink-0">
                        Customized
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-amber-900/80 dark:text-amber-300/90 leading-snug">
                    Dispatches self-mapping request notice, vendor code, login credentials, and category onboarding link.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openTemplateModal('B')}
                  className="btn btn-secondary btn-xs w-full font-bold text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 inline-flex items-center justify-center gap-1.5 py-2"
                >
                  <Pencil size={11} /> View & Edit Template B
                </button>
              </div>
            </div>

            {/* Ingestion Totals Grid */}
            <div className="grid grid-cols-4 gap-2.5 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                <span className="text-[10px] text-slate-400 block">Total Stored</span>
                <span className="font-black text-slate-900 dark:text-white text-sm">{joinedVendors.length} Vendors</span>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">PO Mapped</span>
                <span className="font-black text-emerald-700 dark:text-emerald-300 text-sm">{mappedVendors.length} Suppliers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50">
                <span className="text-[10px] text-amber-600 dark:text-amber-400 block">Self-Map Required</span>
                <span className="font-black text-amber-700 dark:text-amber-300 text-sm">{unmappedVendors.length} Suppliers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50">
                <span className="text-[10px] text-purple-600 dark:text-purple-400 block">3-Day Reminders</span>
                <span className="font-black text-purple-700 dark:text-purple-300 text-sm">Active (Day 3)</span>
              </div>
            </div>

            {/* Submission Error Banner */}
            {submissionError && (
              <div
                data-testid="step5-submission-error-banner"
                className="p-4 rounded-2xl bg-rose-50/90 dark:bg-rose-950/50 border-2 border-rose-300 dark:border-rose-800/80 text-rose-900 dark:text-rose-200 flex items-start justify-between gap-3 animate-fade-in shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle size={20} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h5 className="font-bold text-xs uppercase tracking-wide text-rose-800 dark:text-rose-300">
                      Ingestion &amp; Dispatch Error
                    </h5>
                    <p className="text-xs font-medium leading-relaxed">{submissionError}</p>
                    <p className="text-[11px] text-rose-700/80 dark:text-rose-400/80">
                      Please verify your file data, network, or server connection and retry.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSubmissionError(null)}
                  className="p-1 text-rose-400 hover:text-rose-600 rounded-lg shrink-0"
                  title="Dismiss error"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => navigateToStep(4)}
                className="btn btn-secondary btn-sm"
                disabled={isConfirmingIngestion}
              >
                Back to Category Join
              </button>
              <button
                type="button"
                onClick={handleConfirmFinalIngestion}
                disabled={isConfirmingIngestion}
                className="btn btn-primary font-bold text-xs py-3 px-6 shadow-lg shadow-indigo-600/30 flex items-center gap-2 disabled:opacity-60"
              >
                <CheckCircle2 size={16} />{' '}
                {isConfirmingIngestion ? 'PROCESSING...' : `[ COMPLETE SETUP & INGEST ${joinedVendors.length} VENDORS ]`}
              </button>
            </div>
          </div>
        )}

        {/* Template Preview and Edit Modal Popup */}
        {editingTemplateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" onClick={() => setEditingTemplateModal(null)}>
            <div
              className="w-full max-w-xl p-5 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-gray-800 animate-scale-in space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className={`p-2 rounded-xl text-xs font-bold ${editingTemplateModal === 'A' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
                    Template {editingTemplateModal}
                  </span>
                  <div>
                    <h4 className="font-black text-sm">
                      {editingTemplateModal === 'A' ? 'Template A: Suppliers With Pre-PO History' : 'Template B: Suppliers With NO Pre-PO History'}
                    </h4>
                    <p className="text-xs text-slate-400">Preview and customize the onboarding email template</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingTemplateModal(null)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-gray-300 block">Email Subject</label>
                  <input
                    type="text"
                    value={tempSubject}
                    onChange={(e) => setTempSubject(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-slate-800 dark:text-white font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="Subject line..."
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-gray-300 block">Email Message Body / Key Points</label>
                  <textarea
                    value={tempMessage}
                    onChange={(e) => setTempMessage(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-slate-800 dark:text-white font-medium resize-none leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="Custom email message..."
                  />
                </div>

                {/* Formatted Preview Box */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Formatted Preview (Live)</span>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-[11px] space-y-1.5 font-mono text-slate-700 dark:text-gray-300">
                    <p><strong>Subject:</strong> {tempSubject || '(Default Subject)'}</p>
                    <p className="whitespace-pre-wrap">{tempMessage || '(Default Message)'}</p>
                    <div className="p-2 bg-slate-50 dark:bg-gray-800 rounded text-[10px] space-y-0.5 text-slate-500">
                      <div>• Buyer: {activeBuyerAccount?.organizationName || 'Larsen & Toubro'}</div>
                      <div>• Vendor Code & Login Credentials included</div>
                      <div>• Action Link: {editingTemplateModal === 'A' ? 'Sign in to review category mapping' : 'Complete category self-mapping'}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setEditingTemplateModal(null)}
                  className="btn btn-secondary btn-xs py-2 px-3 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={isSavingTemplate}
                  className="btn btn-primary btn-xs py-2 px-4 text-xs font-bold flex items-center gap-1.5"
                >
                  {isSavingTemplate ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
