'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { StandardRFQEmailPayload } from '@/lib/types';
import {
  X,
  Mail,
  Building2,
  CheckCircle2,
  Copy,
  Printer,
  ShieldCheck,
  Hash,
  ExternalLink,
  Layers,
  Calendar,
  Clock,
  User,
  FileSpreadsheet,
  CheckSquare,
  Sparkles,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';

export default function StandardRFQEmailModal() {
  const { selectedEmailForModal, emailModalOpen, setEmailModalOpen, showToast } = useApp();
  const [copied, setCopied] = useState(false);

  if (!emailModalOpen || !selectedEmailForModal) return null;

  const email = selectedEmailForModal;
  const portalOnly = email.lineItems.length > 10;

  const handleCopy = () => {
    const rawEmailText = `
SUBJECT: ${email.subject}
FROM: ${email.buyerCompany} <${email.buyerContactEmail}> via Procucev Engine
TO: ${email.recipientContactPerson} <${email.recipientEmail}> (${email.recipientVendorName})
DATE: ${email.dispatchedAt}

DEAR ${email.recipientContactPerson.toUpperCase()} (${email.recipientVendorName}),

You are invited by ${email.buyerCompany} to submit a formal quotation for the procurement of items categorized under:
Major Category: ${email.matchedMajorCategory}
Minor Categories: ${email.matchedMinorCategories.join(', ')}

REQUISITION DETAILS:
- RFQ Number: ${email.rfqNumber}
- Project Title: ${email.rfqTitle}
- Sourcing Protocol: ${email.sourcingModeCode} - ${email.sourcingModeName}
- Target Delivery Date: ${email.targetDeliveryDate}
- Delivery Hub: ${email.deliveryLocation}
- Commercial Terms: ${email.paymentTerms}

BILL OF QUANTITIES (BOQ):
${email.lineItems.map(item => `${item.itemNumber}. ${item.itemName} | Specs: ${item.technicalSpecs} | Minor Category: ${item.minorCategory} | Qty: ${item.quantity} ${item.unit} | Target: ${item.targetDate}`).join('\n')}

SPECIAL INSTRUCTIONS:
${email.specialInstructions}

MANDATORY QUOTATION SUBMISSION INSTRUCTIONS:
${portalOnly
    ? `- This RFQ has ${email.lineItems.length} line items. Email bids are not accepted for RFQs with more than 10 items.
- Submit through the Procucev Vendor Portal: download the RFQ Excel file, enter a unit price for each item, then upload the completed workbook and supporting documents.`
    : `- Submit your quotation by replying to this invitation with your itemized commercial quote, unit rates, and supporting documents, or use the Procucev Vendor Portal.
- DO NOT MODIFY OR CHANGE THE EMAIL SUBJECT LINE ("${email.subject}"). The exact subject line is required for automated AI parsing and ingestion into the comparative evaluation matrix.`}

SHA-256 DIGITAL AUDIT SEAL: ${email.shaSignature}
`;
    navigator.clipboard.writeText(rawEmailText.trim());
    setCopied(true);
    showToast('Copied to Clipboard', 'Standard RFQ email content copied.', 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-overlay !z-[1100]">
      <div className="modal-content max-w-3xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-gray-800 shrink-0 no-print">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
              <Mail size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Standard RFQ Procurement Email
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1">
                  <CheckCircle2 size={11} /> Dispatched to Vendor
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400">
                Official standardized RFQ communication transmitted to suitable categorized suppliers.
              </p>
            </div>
          </div>
          <button
            onClick={() => setEmailModalOpen(false)}
            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Email Body Canvas */}
        <div id="printable-rfq-email-content" className="overflow-y-auto my-4 space-y-4 pr-1 text-xs leading-relaxed">
          {/* Email Headers Meta Box */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950/80 border border-slate-200 dark:border-gray-800 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 dark:border-gray-800 pb-2.5">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Subject:</span>
                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  {email.subject}
                </h4>
              </div>
              <span className="px-2 py-1 rounded-md text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40 shrink-0">
                {email.sourcingModeCode}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
              <div>
                <span className="text-slate-400 font-semibold block text-[10px] uppercase">From:</span>
                <span className="font-bold text-slate-800 dark:text-gray-200">{email.buyerCompany}</span>
                <span className="text-slate-500 dark:text-gray-400 block font-mono text-[10px]">{email.buyerContactEmail}</span>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block text-[10px] uppercase">To (Matched Supplier):</span>
                <span className="font-bold text-slate-800 dark:text-gray-200">{email.recipientContactPerson} ({email.recipientVendorName})</span>
                <span className="text-indigo-600 dark:text-indigo-400 block font-mono text-[10px] font-semibold">{email.recipientEmail}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/80 dark:border-gray-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-gray-300">
                <Layers size={13} className="text-indigo-600 dark:text-indigo-400" />
                <span>Matched Taxonomy:</span>
                <span className="font-bold text-slate-900 dark:text-white">{email.matchedMajorCategory}</span>
                <span className="text-slate-400">›</span>
                <span className="px-1.5 py-0.5 rounded bg-white dark:bg-gray-900 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 border border-slate-200 dark:border-gray-800">
                  {email.matchedMinorCategories.join(', ')}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <Clock size={12} /> Dispatched: <strong className="text-slate-700 dark:text-gray-300">{email.dispatchedAt}</strong>
              </div>
            </div>
          </div>

          {/* Formal Email Letter Content */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xs space-y-4">
            {/* Salutation */}
            <div>
              <p className="font-bold text-slate-900 dark:text-white">
                Dear {email.recipientContactPerson} / Team {email.recipientVendorName},
              </p>
              <p className="text-slate-600 dark:text-gray-300 mt-2">
                We are pleased to invite you to participate in an official Request for Quotation (RFQ) issued by{' '}
                <strong>{email.buyerCompany}</strong>. Based on your certified supply capabilities under{' '}
                <strong className="text-indigo-600 dark:text-indigo-400">{email.matchedMajorCategory} ({email.matchedMinorCategories.join(', ')})</strong>, your organization has been selected to provide competitive pricing and delivery commitments.
              </p>
            </div>

            {/* Requisition Meta Table */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-[11px]">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Requisition ID</span>
                <div className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{email.rfqNumber}</div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Submission Due</span>
                <div className="font-bold text-rose-600 dark:text-rose-400">{email.submissionDeadline}</div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Delivery Hub</span>
                <div className="font-semibold text-slate-800 dark:text-gray-200">Navi Mumbai CIF</div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Payment Terms</span>
                <div className="font-semibold text-slate-800 dark:text-gray-200">{email.paymentTerms}</div>
              </div>
            </div>

            {/* Categorized Line-Item Table */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 flex items-center gap-1">
                  <FileSpreadsheet size={13} className="text-indigo-600 dark:text-indigo-400" /> Bill of Quantities (BOQ) Line Items
                </span>
                <span className="text-[10px] text-slate-400 mono">{email.lineItems.length} Line Items Extracted</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-gray-950 text-slate-600 dark:text-gray-400 text-[10px] uppercase tracking-wider font-bold">
                    <tr>
                      <th className="p-2.5 text-center w-10">#</th>
                      <th className="p-2.5">Item Description &amp; Specifications</th>
                      <th className="p-2.5">Minor Category</th>
                      <th className="p-2.5 text-center w-16">Qty</th>
                      <th className="p-2.5 text-center w-16">Unit</th>
                      <th className="p-2.5 w-24">Target Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-gray-800 text-slate-800 dark:text-gray-200">
                    {email.lineItems.map((item) => (
                      <tr key={item.itemNumber} className="hover:bg-slate-50 dark:hover:bg-gray-800/30">
                        <td className="p-2.5 text-center font-bold font-mono text-slate-500">{item.itemNumber}</td>
                        <td className="p-2.5">
                          <div className="font-bold text-slate-900 dark:text-white">{item.itemName}</div>
                          <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">{item.technicalSpecs}</div>
                        </td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40 inline-block">
                            {item.minorCategory}
                          </span>
                        </td>
                        <td className="p-2.5 text-center font-mono font-bold text-indigo-600 dark:text-indigo-400">{item.quantity}</td>
                        <td className="p-2.5 text-center text-slate-500">{item.unit}</td>
                        <td className="p-2.5 font-medium text-slate-700 dark:text-gray-300">{item.targetDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sourcing Mode Directives Box */}
            <div className="p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/50 dark:border-indigo-900/40 text-[11px] leading-relaxed space-y-1.5">
              <div className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-indigo-600 dark:text-indigo-400" />
                <span>Operating Directives ({email.sourcingModeName}):</span>
              </div>
              <p className="text-slate-700 dark:text-gray-300">{email.specialInstructions}</p>
            </div>

            {/* Mandatory Compliance Checklist */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-2 text-[11px]">
              <div className="font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                <CheckSquare size={14} className="text-emerald-600 dark:text-emerald-400" />
                <span>Mandatory Documentation &amp; Quotation Submission Criteria:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-slate-600 dark:text-gray-400">
                {email.complianceChecklist.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold shrink-0">✓</span>
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Submission directives vary with the RFQ line-item count. */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white border border-indigo-500/40 shadow-lg space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-amber-400 font-extrabold text-xs">
                  {portalOnly ? <FileSpreadsheet size={16} /> : <Mail size={16} />}
                  <span>{portalOnly ? 'MANDATORY: SUBMIT QUOTATION THROUGH THE PORTAL' : 'SUBMIT QUOTATION BY EMAIL REPLY OR PORTAL'}</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40 uppercase">
                  {portalOnly ? 'Portal Submission Only' : 'Email or Portal'}
                </span>
              </div>
              <p className="text-[11px] text-slate-200 leading-relaxed">
                {portalOnly
                  ? <>This RFQ has <strong>{email.lineItems.length} line items</strong>. Email bids are not accepted. Open the Procucev Vendor Portal to download the RFQ Excel file, enter your prices, then upload the completed workbook and supporting documents.</>
                  : <>Submit your official quotation and commercial line-item prices by replying to this invitation with supporting documents, or use the Procucev Vendor Portal. Keep the subject line unchanged for automated processing.</>}
              </p>
              {!portalOnly && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-200 text-[11px] space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-300">
                    <AlertCircle size={14} className="shrink-0 text-amber-400" />
                    <span>EMAIL SUBMISSION REQUIREMENT:</span>
                  </div>
                  <p className="text-slate-300 text-[10.5px] leading-normal">
                    <strong>DO NOT MODIFY OR CHANGE THE SUBJECT LINE</strong> when replying. The exact subject line (<code className="font-mono text-white bg-black/50 px-1 py-0.5 rounded font-bold">{email.subject}</code>) is required for automated processing.
                  </p>
                </div>
              )}
            </div>

            {/* Sign-off & SHA-256 Stamp */}
            <div className="pt-3 border-t border-slate-200 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[10px] text-slate-500">
              <div>
                <span className="font-bold text-slate-800 dark:text-gray-200">{email.buyerContactName}</span> · {email.buyerCompany}
                <div className="text-slate-400">Procucev Autonomous Sourcing Orchestration Engine</div>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[9px] text-slate-400 dark:text-gray-400 bg-slate-50 dark:bg-gray-950 px-2 py-1 rounded border border-slate-200 dark:border-gray-800">
                <Hash size={11} className="text-indigo-600 dark:text-indigo-400" />
                <span>SHA-256: {email.shaSignature.slice(0, 24)}...</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800 shrink-0 no-print">
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="btn btn-secondary btn-sm flex items-center gap-1"
            >
              <Copy size={13} /> {copied ? 'Copied!' : 'Copy Email Text'}
            </button>
            <button
              onClick={handlePrint}
              className="btn btn-secondary btn-sm flex items-center gap-1"
            >
              <Printer size={13} /> Print
            </button>
          </div>

          <button
            onClick={() => setEmailModalOpen(false)}
            className="btn btn-primary btn-sm"
          >
            Done / Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}
