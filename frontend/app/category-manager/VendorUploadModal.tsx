'use client';

// ==============================================================================
// CATEGORY MANAGER — BULK VENDOR UPLOAD MODAL
// ==============================================================================
// Download Vendor Master Template -> Upload .xlsx -> row-by-row client-side
// validate -> paginated preview -> import only the valid rows in bounded
// chunks -> real per-row success/duplicate/failure summary.
//
// Modeled on the real p2pservices Vendor Master upload (verified from the old
// Java backend's Apache POI row reader and a real sample export) for the
// column set and the "company name + email + mobile required, everything
// else optional" rule, but the preview/validation/progress UX itself has no
// old-system equivalent to copy — that app parses the whole file server-side
// with no client-side preview at all — so it's designed fresh here to match
// this app's own conventions (see ManualRFQModal.tsx for the modal shell).
// ==============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, XCircle, History, Clock } from 'lucide-react';
import { useApp } from '@/lib/store';
import {
  bulkImportVendorRows,
  downloadVendorUploadTemplate,
  isAllowedVendorUploadFile,
  MAX_VENDOR_UPLOAD_FILE_BYTES,
  parseVendorUploadFile,
} from '@/lib/vendorUploadClient';
import type { VendorUploadImportResponse, VendorUploadRow } from '@/lib/types';

interface VendorUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
}

type Step = 'select' | 'preview' | 'importing' | 'result';

interface UploadHistoryEntry {
  id: string;
  fileName: string;
  timestamp: string;
  total: number;
  imported: number;
  duplicates: number;
  failed: number;
  onboardingFailed?: number;
  records?: Array<{
    vendorCode?: string;
    name: string;
    contactPerson?: string;
    email: string;
    phone?: string;
    gstin?: string;
    category?: string;
    city?: string;
    rating?: number;
  }>;
}

const PREVIEW_PAGE_SIZE = 50;
const HISTORY_STORAGE_KEY = 'procucev_vendor_upload_history';

export default function VendorUploadModal({ isOpen, onClose, onImportComplete }: VendorUploadModalProps) {
  const { showToast, refreshFromDB } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('select');
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<UploadHistoryEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<VendorUploadRow[]>([]);
  const [blankRowCount, setBlankRowCount] = useState(0);
  const [previewPage, setPreviewPage] = useState(0);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'invalid'>('all');
  const [importProgress, setImportProgress] = useState<VendorUploadImportResponse | null>(null);
  const [importResult, setImportResult] = useState<VendorUploadImportResponse | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        setHistoryList(JSON.parse(raw));
      }
    } catch {
      setHistoryList([]);
    }
  }, [isOpen]);

  const validRows = useMemo(() => rows.filter((r) => r.isValid), [rows]);
  const invalidRows = useMemo(() => rows.filter((r) => !r.isValid), [rows]);
  const missingEmailRows = useMemo(() => validRows.filter((r) => r.missingEmail), [validRows]);

  const filteredRows = useMemo(() => {
    if (previewFilter === 'valid') return validRows;
    if (previewFilter === 'invalid') return invalidRows;
    return rows;
  }, [rows, validRows, invalidRows, previewFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PREVIEW_PAGE_SIZE));
  const pageRows = filteredRows.slice(previewPage * PREVIEW_PAGE_SIZE, (previewPage + 1) * PREVIEW_PAGE_SIZE);

  function resetState() {
    setStep('select');
    setShowHistory(false);
    setFileName('');
    setRows([]);
    setBlankRowCount(0);
    setPreviewPage(0);
    setPreviewFilter('all');
    setImportProgress(null);
    setImportResult(null);
  }

  function handleClose() {
    if (step === 'importing') return;
    resetState();
    onClose();
  }

  async function handleFile(file: File) {
    if (!isAllowedVendorUploadFile(file)) {
      showToast('Unsupported File Type', 'Only .xlsx files are accepted.', 'warning');
      return;
    }
    if (file.size > MAX_VENDOR_UPLOAD_FILE_BYTES) {
      showToast(
        'File Too Large',
        `"${file.name}" is larger than ${Math.round(MAX_VENDOR_UPLOAD_FILE_BYTES / (1024 * 1024))}MB — split it into smaller files.`,
        'warning'
      );
      return;
    }
    setIsParsing(true);
    const result = await parseVendorUploadFile(file);
    setIsParsing(false);
    if (!result.success) {
      showToast('Could Not Read File', result.error, 'warning');
      return;
    }
    if (result.data.rows.length === 0) {
      showToast('No Vendor Rows Found', 'Every row in the file was blank.', 'warning');
      return;
    }
    setFileName(file.name);
    setRows(result.data.rows);
    setBlankRowCount(result.data.blankRowCount);
    setPreviewPage(0);
    setPreviewFilter('all');
    setStep('preview');
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setStep('importing');
    setImportProgress({ total: 0, imported: 0, missingEmail: 0, duplicates: 0, failed: 0, onboardingFailed: 0, results: [] });
    const result = await bulkImportVendorRows(rows, (soFar) => setImportProgress(soFar));
    setImportResult(result);
    setStep('result');

    // Save into History
    const historyEntry: UploadHistoryEntry = {
      id: `up-${Date.now()}`,
      fileName: fileName || 'vendors.xlsx',
      timestamp: new Date().toLocaleString(),
      total: rows.length,
      imported: result.imported,
      duplicates: result.duplicates,
      failed: result.failed,
      onboardingFailed: result.onboardingFailed,
      records: rows.slice(0, 100).map((r) => ({
        vendorCode: r.vendor.vendorCode,
        name: r.vendor.name,
        contactPerson: r.vendor.contactPerson,
        email: r.vendor.email,
        phone: r.vendor.phone,
        gstin: r.vendor.gstin,
        category: r.vendor.majorCategory,
        city: r.vendor.city,
      })),
    };
    try {
      const nextHistory = [historyEntry, ...historyList].slice(0, 30);
      setHistoryList(nextHistory);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
    } catch {}

    if (result.imported > 0) {
      await refreshFromDB();
      onImportComplete?.();
    }
  }

  function downloadFailedRowsReport() {
    if (!importResult) return;
    const lines = ['Row Number,Vendor Code,Email,Status,Reason'];
    importResult.results
      .filter((r) => r.status !== 'imported')
      .forEach((r) => {
        const reason = (r.errors || [r.reason || '']).join('; ').replace(/,/g, ';');
        const originalRow = rows.find((row) => row.rowNumber === r.rowNumber);
        lines.push(`${r.rowNumber},${originalRow?.vendor.vendorCode || ''},${r.email || ''},${r.status},${reason}`);
      });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vendor_upload_errors.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-upload-modal-title"
      data-testid="vendor-upload-modal"
    >
      <div className="w-full max-w-4xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-800 my-auto">
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
              <Upload size={18} />
            </div>
            <div>
              <h2 id="vendor-upload-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                Bulk Upload Vendors
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                Upload vendors via standard Excel spreadsheet (.xlsx) with unique Vendor Codes.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className={`btn btn-xs font-semibold flex items-center gap-1.5 ${showHistory ? 'btn-primary' : 'btn-secondary'}`}
              title="View Upload History"
            >
              <History size={13} /> {showHistory ? 'Hide History' : 'Upload History'}
            </button>
            <button
              onClick={handleClose}
              disabled={step === 'importing'}
              aria-label="Close"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="px-5 py-4 space-y-4 text-xs">
          {/* History Panel */}
          {showHistory && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/70 dark:bg-gray-950/40 space-y-2">
              <div className="flex items-center justify-between font-bold text-slate-800 dark:text-gray-200">
                <span className="flex items-center gap-1.5"><Clock size={14} /> Previous Vendor Upload History</span>
                <span className="text-[10px] text-slate-400 font-normal">{historyList.length} recorded</span>
              </div>
              {historyList.length === 0 ? (
                <p className="text-slate-400 italic text-[11px]">No previous uploads recorded on this browser.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {historyList.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 flex items-center justify-between text-[11px]"
                    >
                      <div>
                        <span className="font-bold text-slate-800 dark:text-gray-200">{item.fileName}</span>
                        <div className="text-[10px] text-slate-400">{item.timestamp}</div>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold">
                          {item.imported} Imported
                        </span>
                        {item.duplicates > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                            {item.duplicates} Duplicates
                          </span>
                        )}
                        {item.failed > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                            {item.failed} Failed
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'select' && (
            <div className="space-y-4">
              {/* Single-line Simplified Vendor Bulk Upload Info & Download Banner */}
              <div className="p-3.5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-r from-indigo-50/70 via-purple-50/30 to-blue-50/70 dark:from-indigo-950/40 dark:via-purple-950/20 dark:to-blue-950/40 flex items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="badge badge-indigo font-bold text-[10px] shrink-0">Required Columns</span>
                  <span className="text-xs text-slate-700 dark:text-gray-300 font-medium truncate">
                    Vendor Code, Company Name, Contact Person, Mobile, Email &amp; Category
                  </span>
                </div>
                <button
                  type="button"
                  onClick={downloadVendorUploadTemplate}
                  className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5 shrink-0 shadow-xs"
                >
                  <Download size={13} /> Download Vendor Master Template
                </button>
              </div>

              <div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="vendor-upload-dropzone"
                  className={`p-8 rounded-xl border-2 border-dashed text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                      : 'border-slate-300 dark:border-gray-700 hover:border-indigo-400'
                  }`}
                >
                  {isParsing ? (
                    <div className="flex flex-col items-center gap-2 text-slate-500 dark:text-gray-400">
                      <Loader2 size={22} className="animate-spin text-indigo-600" />
                      <span>Parsing vendor spreadsheet…</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-500 dark:text-gray-400">
                      <Upload size={22} />
                      <span className="font-semibold text-slate-700 dark:text-gray-300">
                        Click to browse or drag &amp; drop your Vendor Master .xlsx file
                      </span>
                      <span className="text-[10px] text-slate-400">Supported formats: .xlsx (Max 10MB)</span>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    onChange={handleFileInputChange}
                    className="hidden"
                    data-testid="vendor-upload-file-input"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-gray-400">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={14} className="text-indigo-600 dark:text-indigo-400" />
                  <span className="font-bold text-slate-800 dark:text-gray-200">{fileName}</span>
                  {blankRowCount > 0 && <span>({blankRowCount} blank row(s) skipped)</span>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStep('select');
                    setRows([]);
                    setFileName('');
                    setTimeout(() => fileInputRef.current?.click(), 50);
                  }}
                  className="btn btn-secondary btn-xs font-semibold flex items-center gap-1"
                >
                  <Upload size={11} /> Choose Another File
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div className="p-2.5 rounded-lg border border-slate-200 dark:border-gray-800 text-center">
                  <div className="text-lg font-black text-slate-900 dark:text-white">{rows.length}</div>
                  <div className="text-[10px] uppercase text-slate-450 dark:text-gray-500">Total Rows</div>
                </div>
                <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 text-center">
                  <div className="text-lg font-black text-emerald-700 dark:text-emerald-300">{validRows.length}</div>
                  <div className="text-[10px] uppercase text-slate-450 dark:text-gray-500">Valid</div>
                </div>
                <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 text-center">
                  <div className="text-lg font-black text-amber-700 dark:text-amber-300">{missingEmailRows.length}</div>
                  <div className="text-[10px] uppercase text-slate-450 dark:text-gray-500">Missing Email</div>
                </div>
                <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 text-center">
                  <div className="text-lg font-black text-rose-700 dark:text-rose-300">{invalidRows.length}</div>
                  <div className="text-[10px] uppercase text-slate-450 dark:text-gray-500">Issues (still imported)</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {(['all', 'valid', 'invalid'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setPreviewFilter(f);
                      setPreviewPage(0);
                    }}
                    className={`btn btn-xs font-bold capitalize ${previewFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <div className="border border-slate-200 dark:border-gray-800 rounded-lg overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-[11px] text-left">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-gray-900">
                    <tr className="border-b border-slate-200 dark:border-gray-800 text-slate-500 dark:text-gray-400 font-bold">
                      <th className="p-2">Row</th>
                      <th className="p-2">Vendor Code</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Company Name</th>
                      <th className="p-2">Email</th>
                      <th className="p-2">Phone</th>
                      <th className="p-2">GSTIN</th>
                      <th className="p-2">City</th>
                      <th className="p-2">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <tr
                        key={r.rowNumber}
                        className={`border-b border-slate-100 dark:border-gray-850 ${
                          r.missingEmail ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''
                        }`}
                      >
                        <td className="p-2 font-mono">{r.rowNumber}</td>
                        <td className="p-2 font-mono font-semibold">{r.vendor.vendorCode || '—'}</td>
                        <td className="p-2">
                          {!r.isValid ? (
                            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-bold">
                              <AlertTriangle size={12} /> Issue — imported anyway
                            </span>
                          ) : r.missingEmail ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold">
                              <AlertTriangle size={12} /> No Email
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                              <CheckCircle2 size={12} /> Ready
                            </span>
                          )}
                        </td>
                        <td className="p-2 font-semibold">{r.vendor.name || '—'}</td>
                        <td className="p-2">{r.vendor.email || <span className="text-amber-600 dark:text-amber-400 font-bold">No Email</span>}</td>
                        <td className="p-2">{r.vendor.phone || '—'}</td>
                        <td className="p-2">{r.vendor.gstin || '—'}</td>
                        <td className="p-2">{r.vendor.city || '—'}</td>
                        <td className="p-2 text-rose-600 dark:text-rose-400">{r.errors.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pageCount > 1 && (
                <div className="flex items-center justify-between text-[11px]">
                  <button
                    disabled={previewPage === 0}
                    onClick={() => setPreviewPage((p) => p - 1)}
                    className="btn btn-secondary btn-xs disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span>
                    Page {previewPage + 1} of {pageCount}
                  </span>
                  <button
                    disabled={previewPage >= pageCount - 1}
                    onClick={() => setPreviewPage((p) => p + 1)}
                    className="btn btn-secondary btn-xs disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => {
                    setStep('select');
                    setRows([]);
                    setFileName('');
                    setTimeout(() => fileInputRef.current?.click(), 50);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  Choose Another File
                </button>
                <button
                  onClick={handleImport}
                  disabled={rows.length === 0}
                  className="btn btn-primary btn-sm font-bold disabled:opacity-40"
                >
                  Import {rows.length} Vendor{rows.length === 1 ? '' : 's'}
                  {invalidRows.length > 0 && ` (${invalidRows.length} with issues)`}
                </button>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="py-10 flex flex-col items-center gap-3 text-slate-600 dark:text-gray-300">
              <Loader2 size={28} className="animate-spin text-indigo-500" />
              <p className="font-bold">Importing vendors…</p>
              {importProgress && (
                <p className="text-[11px] text-slate-450 dark:text-gray-500">
                  {importProgress.total} of {rows.length} processed — {importProgress.imported} imported (
                  {importProgress.missingEmail} missing email), {importProgress.duplicates} duplicate,{' '}
                  {importProgress.failed} failed, {importProgress.onboardingFailed || 0} credential email(s) failed
                </p>
              )}
            </div>
          )}

          {step === 'result' && importResult && (() => {
            // Status is derived from the real import outcome so the headline can
            // never claim success when nothing was imported (e.g. every record
            // was a duplicate). "Completed" means every row imported; "Partially
            // Completed" means some imported and some did not; "No Vendors
            // Imported" / "Upload Failed" means zero rows imported.
            const outcome =
              importResult.imported === 0
                ? importResult.duplicates > 0 && importResult.failed === 0
                  ? 'none_duplicates'
                  : 'failed'
                : importResult.imported < rows.length
                ? 'partial'
                : 'completed';
            const outcomeTitle =
              outcome === 'completed'
                ? 'Upload Completed'
                : outcome === 'partial'
                ? 'Upload Partially Completed'
                : outcome === 'none_duplicates'
                ? 'No Vendors Imported'
                : 'Upload Failed';
            return (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-950/40 text-center space-y-1">
                {outcome === 'completed' ? (
                  <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
                ) : outcome === 'partial' ? (
                  <AlertTriangle size={28} className="mx-auto text-amber-500" />
                ) : (
                  <XCircle size={28} className="mx-auto text-rose-500" />
                )}
                <h3 className="text-sm font-black text-slate-900 dark:text-white">{outcomeTitle}</h3>
                {outcome === 'none_duplicates' && (
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    All {rows.length} record(s) already exist as vendors — nothing new was imported.
                  </p>
                )}
                <p className="text-[11px] text-slate-500 dark:text-gray-400">
                  Total: {rows.length} · Imported: {importResult.imported} · Failed: {importResult.failed} · Duplicates:{' '}
                  {importResult.duplicates}
                </p>
                {importResult.missingEmail > 0 && (
                  <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                    {importResult.missingEmail} imported vendor(s) had no email — highlighted above, review when convenient.
                  </p>
                )}
                {(importResult.onboardingFailed || 0) > 0 && (
                  <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                    {importResult.onboardingFailed} vendor account(s) were imported, but login setup or credential email delivery failed. Contact support to resend the invitations.
                  </p>
                )}
              </div>

              {(importResult.failed > 0 || importResult.duplicates > 0) && (
                <button
                  onClick={downloadFailedRowsReport}
                  className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5"
                >
                  <Download size={13} /> Download Error Report
                </button>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
                <button onClick={resetState} className="btn btn-secondary btn-sm">
                  Upload Another File
                </button>
                <button onClick={handleClose} className="btn btn-primary btn-sm font-bold">
                  Done
                </button>
              </div>
            </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
