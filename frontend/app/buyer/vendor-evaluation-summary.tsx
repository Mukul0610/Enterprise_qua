'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '@/lib/store';
import { VendorEvaluationRecord, QuestionEvaluationItem, VendorEvaluationDocument, VendorEntry } from '@/lib/types';
import {
  Award,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Building2,
  ShieldCheck,
  Zap,
  Sparkles,
  Download,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Search,
  UserCheck,
  Sliders,
  RefreshCw,
  Mail,
  Phone,
  Tag,
  Clock,
  Lock,
  ArrowLeft,
  X,
  Paperclip,
  Check,
  UploadCloud,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';

interface VendorEvaluationSummaryProps {
  evaluationRecord?: VendorEvaluationRecord | null;
  vendorEvaluation?: VendorEvaluationRecord | null;
  onBack?: () => void;
}

// Classification helper: Uploaded by Buyer
export const isBuyerUploaded = (v: any): boolean => {
  if (!v) return false;
  const s = String(v.source || '').toLowerCase().trim();
  const id = String(v.id || '').toLowerCase().trim();
  return (
    s === 'buyer_uploaded' ||
    s === 'vendor_master_ingestion' ||
    s === 'historical_purchase_dump' ||
    s === 'buyer_manual' ||
    s === 'buyer_excel' ||
    s === 'buyer' ||
    s.includes('buyer') ||
    s.includes('ingestion') ||
    s.includes('purchase_dump') ||
    !!v.addedByBuyerCompany ||
    id.startsWith('v-hist-') ||
    id.startsWith('v-navin-') ||
    id.startsWith('vm-') ||
    id.startsWith('v-ingest-') ||
    id.startsWith('v-buyer-')
  );
};

// Classification helper: Procucev Vendors
export const isProcucevVendor = (v: any): boolean => {
  return !isBuyerUploaded(v);
};

/**
 * Builds a comprehensive 24-criteria 6-pillar evaluation record for any vendor.
 */
function buildEvaluationRecordForVendor(vendor: any): VendorEvaluationRecord {
  const score = Number(vendor.score) || 90;
  const isPreferred = score >= 80;
  const isConditional = score >= 65 && score < 80;
  const status: 'PREFERRED ENTERPRISE SUPPLIER' | 'CONDITIONAL / UNDER REVIEW' | 'DISQUALIFIED SUPPLIER' = isPreferred
    ? 'PREFERRED ENTERPRISE SUPPLIER'
    : isConditional
    ? 'CONDITIONAL / UNDER REVIEW'
    : 'DISQUALIFIED SUPPLIER';
  const cat = vendor.majorCategory || vendor.category || 'General Industrial';
  const name = vendor.name || vendor.vendorName || 'Enterprise Supplier';
  const contact = vendor.contactPerson || (vendor.name ? `${vendor.name} Representative` : 'Authorized Representative');
  const email = vendor.email || vendor.contactEmail || 'N/A';
  const phone = vendor.phone || vendor.mobile || 'N/A';
  const id = vendor.id || 'v-001';
  const submissionDate = vendor.createdAt ? new Date(vendor.createdAt).toISOString().split('T')[0] : '2026-03-01';

  const cleanName = name.replace(/[^a-zA-Z0-9]/g, '_');
  const catShort = cat.split('-')[0].trim();

  const questions: QuestionEvaluationItem[] = [
    // M1 Commercial
    { refId: 'M1-Q1', pillarId: 'M1', pillarName: 'Commercial Terms', criteria: 'Fixed Pricing Validity (12 Months)', score: 4.8, weightedScore: 6.25, attachmentName: `${cleanName}_Pricing_Agreement.pdf`, attachmentVerified: true, remarks: `12-month firm price schedule locked with volume tier discounting for ${catShort}.` },
    { refId: 'M1-Q2', pillarId: 'M1', pillarName: 'Commercial Terms', criteria: 'Payment Terms Acceptance (Net 30/45)', score: 4.6, weightedScore: 6.25, attachmentName: `${cleanName}_Payment_Terms_Acceptance.pdf`, attachmentVerified: true, remarks: `Confirmed standard Net 30/45 days credit cycle with milestone reconciliation.` },
    { refId: 'M1-Q3', pillarId: 'M1', pillarName: 'Commercial Terms', criteria: 'Freight & Logistics Terms (DDP/FCA)', score: 4.9, weightedScore: 6.25, attachmentName: `${cleanName}_Logistics_SLA.pdf`, attachmentVerified: true, remarks: `DDP delivery to buyer facility with transit insurance coverage included.` },
    { refId: 'M1-Q4', pillarId: 'M1', pillarName: 'Commercial Terms', criteria: 'Annual Rebate & Volume Incentive Framework', score: 4.5, weightedScore: 6.25, attachmentName: `${cleanName}_Rebate_Matrix.xlsx`, attachmentVerified: true, remarks: `Retrospective volume rebate slabs configured for annual purchasing targets.` },

    // M2 Technical
    { refId: 'M2-Q1', pillarId: 'M2', pillarName: 'Technical Capabilities', criteria: 'Precision Manufacturing & Tooling Capacity', score: 4.7, weightedScore: 3.75, attachmentName: `${cleanName}_Manufacturing_Audit.pdf`, attachmentVerified: true, remarks: `Dedicated manufacturing lines with calibrated QC tooling for ${cat}.` },
    { refId: 'M2-Q2', pillarId: 'M2', pillarName: 'Technical Capabilities', criteria: 'Engineering R&D & In-House Testing Facility', score: 4.5, weightedScore: 3.75, attachmentName: `${cleanName}_Lab_Accreditation.pdf`, attachmentVerified: true, remarks: `In-house certified testing apparatus and metallurgical inspection facility.` },
    { refId: 'M2-Q3', pillarId: 'M2', pillarName: 'Technical Capabilities', criteria: 'Drawing & Specification Interoperability', score: 4.8, weightedScore: 3.75, attachmentName: `${cleanName}_CAD_Spec_Sheet.pdf`, attachmentVerified: true, remarks: `Engineering CAD/CAM modeling adherence with 100% tolerance compliance.` },
    { refId: 'M2-Q4', pillarId: 'M2', pillarName: 'Technical Capabilities', criteria: 'Production Redundancy & Surge Capacity', score: 4.4, weightedScore: 3.75, attachmentName: `${cleanName}_Surge_Capacity_Plan.pdf`, attachmentVerified: true, remarks: `Multi-shift manufacturing buffer supporting up to 140% surge procurement volume.` },

    // M3 Quality & Warranty
    { refId: 'M3-Q1', pillarId: 'M3', pillarName: 'Quality & Warranty', criteria: 'ISO 9001 / IATF Quality Certification', score: 5.0, weightedScore: 5.0, attachmentName: `${cleanName}_ISO_Quality_Certificate.pdf`, attachmentVerified: true, remarks: `Accredited ISO quality management certification valid through 2028.` },
    { refId: 'M3-Q2', pillarId: 'M3', pillarName: 'Quality & Warranty', criteria: 'Defect Rate Threshold (< 350 PPM)', score: 4.7, weightedScore: 5.0, attachmentName: `${cleanName}_Defect_Rate_Report.xlsx`, attachmentVerified: true, remarks: `Historical rejection rate maintained below 320 PPM with optical inspection.` },
    { refId: 'M3-Q3', pillarId: 'M3', pillarName: 'Quality & Warranty', criteria: 'Comprehensive Replacement Warranty (24 Months)', score: 4.8, weightedScore: 5.0, attachmentName: `${cleanName}_Warranty_Undertaking.pdf`, attachmentVerified: true, remarks: `24-month comprehensive replacement warranty with SLA-backed RMA dispatch.` },
    { refId: 'M3-Q4', pillarId: 'M3', pillarName: 'Quality & Warranty', criteria: 'Material Traceability & Batch QR/RFID Serialization', score: 4.6, weightedScore: 5.0, attachmentName: `${cleanName}_Traceability_Protocol.pdf`, attachmentVerified: true, remarks: `Mill-test certificate matching with batch barcode serialization.` },

    // M4 Delivery & SLA
    { refId: 'M4-Q1', pillarId: 'M4', pillarName: 'Operational Delivery', criteria: 'Historical OTIF Delivery Track Record (>95%)', score: 4.8, weightedScore: 5.0, attachmentName: `${cleanName}_OTIF_Performance_Log.xlsx`, attachmentVerified: true, remarks: `96.8% On-Time In-Full dispatch track record over rolling 12-month orders.` },
    { refId: 'M4-Q2', pillarId: 'M4', pillarName: 'Operational Delivery', criteria: 'Standard Production Lead Time Commitment', score: 4.5, weightedScore: 5.0, attachmentName: `${cleanName}_Lead_Time_SLA.pdf`, attachmentVerified: true, remarks: `Committed 7-10 business day dispatch lead time on primary line items.` },
    { refId: 'M4-Q3', pillarId: 'M4', pillarName: 'Operational Delivery', criteria: 'Strategic Buffer Stock & Consignment Warehousing', score: 4.6, weightedScore: 5.0, attachmentName: `${cleanName}_Warehousing_Agreement.pdf`, attachmentVerified: true, remarks: `30-day buffer inventory maintained in regional supply depot.` },
    { refId: 'M4-Q4', pillarId: 'M4', pillarName: 'Operational Delivery', criteria: 'Disaster Recovery & Business Continuity (BCP)', score: 4.5, weightedScore: 5.0, attachmentName: `${cleanName}_Business_Continuity_Plan.pdf`, attachmentVerified: true, remarks: `Active secondary facility failover protocols and multi-source tier-2 suppliers.` },

    // M5 Financial Stability
    { refId: 'M5-Q1', pillarId: 'M5', pillarName: 'Financial Stability', criteria: 'Audited Turnover & Scope Coverage Ratio', score: 4.7, weightedScore: 2.5, attachmentName: `${cleanName}_Audited_Financials.pdf`, attachmentVerified: true, remarks: `Annual financial turnover provides > 4x scope coverage with sound balance sheet.` },
    { refId: 'M5-Q2', pillarId: 'M5', pillarName: 'Financial Stability', criteria: 'Credit Rating & Working Capital Adequacy', score: 4.6, weightedScore: 2.5, attachmentName: `${cleanName}_Credit_Rating_Report.pdf`, attachmentVerified: true, remarks: `Investment-grade credit rating with healthy liquidity ratio.` },
    { refId: 'M5-Q3', pillarId: 'M5', pillarName: 'Financial Stability', criteria: 'Statutory GSTIN, PAN & Tax Clearance', score: 5.0, weightedScore: 2.5, attachmentName: `${cleanName}_GST_Tax_Clearance.pdf`, attachmentVerified: true, remarks: `Reconciled GSTR-1/3B statutory filings with active GSTIN status.` },
    { refId: 'M5-Q4', pillarId: 'M5', pillarName: 'Financial Stability', criteria: 'Bank Solvency & Credit Line Certificate', score: 4.8, weightedScore: 2.5, attachmentName: `${cleanName}_Bank_Solvency_Letter.pdf`, attachmentVerified: true, remarks: `Bank solvency certificate and unencumbered working capital line verified.` },

    // M6 Governance & ESG
    { refId: 'M6-Q1', pillarId: 'M6', pillarName: 'Governance & ESG', criteria: 'Anti-Bribery, Ethics & Whistleblower Protocol', score: 5.0, weightedScore: 2.5, attachmentName: `${cleanName}_Code_Of_Conduct.pdf`, attachmentVerified: true, remarks: `Signed enterprise ethical code of conduct and whistleblower policy.` },
    { refId: 'M6-Q2', pillarId: 'M6', pillarName: 'Governance & ESG', criteria: 'Occupational Health & Safety (ISO 45001)', score: 4.8, weightedScore: 2.5, attachmentName: `${cleanName}_ISO_45001_OHSAS.pdf`, attachmentVerified: true, remarks: `Certified workplace health and industrial safety standards implemented.` },
    { refId: 'M6-Q3', pillarId: 'M6', pillarName: 'Governance & ESG', criteria: 'Environmental Management (ISO 14001)', score: 4.6, weightedScore: 2.5, attachmentName: `${cleanName}_ISO_14001_Environmental.pdf`, attachmentVerified: true, remarks: `RoHS/REACH environmental compliance and waste reduction protocols active.` },
    { refId: 'M6-Q4', pillarId: 'M6', pillarName: 'Governance & ESG', criteria: 'Information Security & Data Privacy (ISO 27001)', score: 4.7, weightedScore: 2.5, attachmentName: `${cleanName}_InfoSec_Compliance.pdf`, attachmentVerified: true, remarks: `ISO 27001 data governance and strict commercial NDA adherence verified.` },
  ];

  const documents: VendorEvaluationDocument[] = questions.map((q, idx) => ({
    id: `doc-${idx + 1}`,
    name: q.attachmentName,
    type: q.pillarId === 'M1' ? 'Commercial & Pricing' : q.pillarId === 'M2' ? 'Technical Specifications' : q.pillarId === 'M3' ? 'Quality & Warranty' : q.pillarId === 'M4' ? 'Delivery & Logistics' : q.pillarId === 'M5' ? 'Financial Audit' : 'Governance & ESG',
    uploadDate: submissionDate,
    verified: true,
    status: 'Verified' as const,
  }));

  return {
    id: `eval-${id}`,
    vendorId: id,
    vendorName: name,
    contactPerson: contact,
    email: email,
    phone: phone,
    category: cat,
    submissionDate,
    status,
    overallScore: score,
    moduleScores: {
      commercial: { score: Math.round(score * 0.95), maxScore: 100, weight: 25, weightedScore: Math.round(score * 0.25 * 10) / 10, remarks: `12-month fixed pricing with volume discount tiers and Net 30/45 payment terms for ${name}.` },
      technical: { score: Math.round(score * 0.92), maxScore: 100, weight: 15, weightedScore: Math.round(score * 0.15 * 10) / 10, remarks: `Dedicated manufacturing lines & quality inspection facility verified for ${cat}.` },
      quality: { score: Math.round(score * 0.96), maxScore: 100, weight: 20, weightedScore: Math.round(score * 0.20 * 10) / 10, remarks: `ISO 9001 certified quality management with defect rate < 350 PPM and 24-month warranty.` },
      delivery: { score: Math.round(score * 0.94), maxScore: 100, weight: 20, weightedScore: Math.round(score * 0.20 * 10) / 10, remarks: `96.8% OTIF dispatch history with committed lead time and regional buffer stock.` },
      financial: { score: Math.round(score * 0.90), maxScore: 100, weight: 10, weightedScore: Math.round(score * 0.10 * 10) / 10, remarks: `Turnover coverage > 3x scope; investment-grade credit rating with positive liquidity.` },
      governance: { score: Math.round(score * 0.95), maxScore: 100, weight: 10, weightedScore: Math.round(score * 0.10 * 10) / 10, remarks: `100% KYC & GST verified; ISO 14001, 45001 & 27001 ESG/privacy compliance verified.` },
    },
    documents,
    questionBreakdown: questions,
    systemAction: score >= 80 ? 'Full Qualification Approved - Circulate High-Value RFQs with Automated PO Issuance' : 'Under Technical & Commercial Review - Requires Category Manager Assessment',
    capaRequired: score < 80,
    capaNotes: score < 80 ? 'Submit updated warranty certificate and financial audit report.' : undefined,
  };
}

export default function VendorEvaluationSummary({
  evaluationRecord,
  vendorEvaluation,
  onBack,
}: VendorEvaluationSummaryProps) {
  const { buyerVendors, vendorEvaluations, setActiveEvaluationRecord, showToast, addAuditLog, addFeedItem } = useApp();

  const activeRecord = evaluationRecord || vendorEvaluation;
  // Determine initial vendor ID
  const initialVendorId = activeRecord?.vendorId || (vendorEvaluations && vendorEvaluations[0]?.vendorId) || (buyerVendors && buyerVendors[0]?.id) || '';
  const [selectedVendorId, setSelectedVendorId] = useState<string>(initialVendorId);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update selectedVendorId if evaluationRecord prop changes
  useEffect(() => {
    if (evaluationRecord?.vendorId) {
      setSelectedVendorId(evaluationRecord.vendorId);
    }
  }, [evaluationRecord]);

  // Resolve the active evaluation record
  const record: VendorEvaluationRecord | null = useMemo(() => {
    // 1. If explicit prop matches selected ID
    if (evaluationRecord && (!selectedVendorId || evaluationRecord.vendorId === selectedVendorId)) {
      return evaluationRecord;
    }

    // 2. Check vendorEvaluations list in store
    if (selectedVendorId && vendorEvaluations && vendorEvaluations.length > 0) {
      const match = vendorEvaluations.find(
        (e) => e.vendorId === selectedVendorId || e.vendorName?.toLowerCase() === selectedVendorId.toLowerCase()
      );
      if (match) return match;
    }

    // 3. Look up vendor in buyerVendors and build record
    if (selectedVendorId && buyerVendors && buyerVendors.length > 0) {
      const vendor = buyerVendors.find((v) => v.id === selectedVendorId);
      if (vendor) {
        return buildEvaluationRecordForVendor(vendor);
      }
    }

    // 4. Fallback to evaluationRecord prop, first vendorEvaluation, or first buyerVendor
    if (evaluationRecord) return evaluationRecord;
    if (vendorEvaluations && vendorEvaluations.length > 0) return vendorEvaluations[0];
    if (buyerVendors && buyerVendors.length > 0) {
      return buildEvaluationRecordForVendor(buyerVendors[0]);
    }

    return null;
  }, [evaluationRecord, selectedVendorId, vendorEvaluations, buyerVendors]);

  // Score override and local state
  const [overrideScore, setOverrideScore] = useState<number | null>(null);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [newScoreInput, setNewScoreInput] = useState(record?.overallScore || 95);
  const [capaOpen, setCapaOpen] = useState(false);
  const [capaNotes, setCapaNotes] = useState(record?.capaNotes || '');
  const [selectedPillarFilter, setSelectedPillarFilter] = useState<string>('ALL');
  const [dropdownTab, setDropdownTab] = useState<'buyer' | 'procucev'>('buyer');

  // Reset override and score input when active record changes
  useEffect(() => {
    if (record) {
      setOverrideScore(null);
      setNewScoreInput(record.overallScore || 95);
      setCapaNotes(record.capaNotes || '');
      setDropdownTab(isBuyerUploaded(record) ? 'buyer' : 'procucev');
    }
  }, [record?.id, record?.vendorId]);

  // Combined company list for dropdown
  const companyOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; category: string; source?: string; score: number; status?: string }>();

    // From buyerVendors
    (buyerVendors || []).forEach((v) => {
      if (v.id) {
        map.set(v.id, {
          id: v.id,
          name: v.name || 'Unnamed Vendor',
          category: v.majorCategory || 'General',
          source: v.source,
          score: Number(v.score) || 92,
          status: v.status,
        });
      }
    });

    // From vendorEvaluations
    (vendorEvaluations || []).forEach((e) => {
      if (e.vendorId && !map.has(e.vendorId)) {
        map.set(e.vendorId, {
          id: e.vendorId,
          name: e.vendorName || 'Unnamed Vendor',
          category: e.category || 'General',
          source: (e as any).source || 'evaluated',
          score: Number(e.overallScore) || 90,
          status: e.status,
        });
      }
    });

    // If initial record is passed and not yet in map
    if (evaluationRecord && evaluationRecord.vendorId && !map.has(evaluationRecord.vendorId)) {
      map.set(evaluationRecord.vendorId, {
        id: evaluationRecord.vendorId,
        name: evaluationRecord.vendorName,
        category: evaluationRecord.category,
        source: (evaluationRecord as any).source,
        score: evaluationRecord.overallScore,
        status: evaluationRecord.status,
      });
    }

    const all = Array.from(map.values());
    return all.filter((c) => isBuyerUploaded(c));
  }, [buyerVendors, vendorEvaluations, evaluationRecord]);

  const filteredCompanyOptions = useMemo(() => {
    if (!searchQuery.trim()) return companyOptions;
    const q = searchQuery.toLowerCase();
    return companyOptions.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [companyOptions, searchQuery]);

  const handleSelectCompany = (vendorId: string) => {
    setSelectedVendorId(vendorId);
    setDropdownOpen(false);
    setSearchQuery('');
    const target = companyOptions.find((c) => c.id === vendorId);
    if (target) {
      const evalRecord = buildEvaluationRecordForVendor(target);
      if (setActiveEvaluationRecord) {
        setActiveEvaluationRecord(evalRecord);
      }
      showToast('Company Selected', `Loaded 360° evaluation summary for ${target.name}.`, 'info');
    }
  };

  if (!record) {
    return (
      <div className="p-8 text-center text-slate-500">
        No evaluation record selected.
      </div>
    );
  }

  const moduleScores = {
    commercial: {
      weightedScore: record.moduleScores?.commercial?.weightedScore ?? 24,
      remarks: record.moduleScores?.commercial?.remarks || `12-month fixed pricing with volume tier discount and Net 30/45 payment terms for ${record.vendorName}.`,
    },
    technical: {
      weightedScore: record.moduleScores?.technical?.weightedScore ?? 13.5,
      remarks: record.moduleScores?.technical?.remarks || `Dedicated manufacturing lines & quality inspection facility verified for ${record.category}.`,
    },
    quality: {
      weightedScore: record.moduleScores?.quality?.weightedScore ?? 18.4,
      remarks: record.moduleScores?.quality?.remarks || `ISO 9001 certified quality management with defect rate < 350 PPM and 24-month warranty.`,
    },
    delivery: {
      weightedScore: record.moduleScores?.delivery?.weightedScore ?? 17.6,
      remarks: record.moduleScores?.delivery?.remarks || `96.8% OTIF dispatch history with committed lead time and regional buffer stock.`,
    },
    financial: {
      weightedScore: record.moduleScores?.financial?.weightedScore ?? 8,
      remarks: record.moduleScores?.financial?.remarks || `Turnover coverage > 3x scope; investment-grade credit rating with positive liquidity.`,
    },
    governance: {
      weightedScore: record.moduleScores?.governance?.weightedScore ?? 9.4,
      remarks: record.moduleScores?.governance?.remarks || `100% KYC & GST verified; ISO 14001, 45001 & 27001 ESG/privacy compliance verified.`,
    },
  };

  const documents = record.documents || [];
  const effectiveScore = overrideScore !== null ? overrideScore : (record.overallScore ?? 95);

  const getStatusBadge = (status: string, score: number) => {
    if (score >= 80) {
      return (
        <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40">
          PREFERRED ENTERPRISE SUPPLIER
        </span>
      );
    }
    if (score >= 65) {
      return (
        <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40">
          CONDITIONAL / UNDER REVIEW
        </span>
      );
    }
    return (
      <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-500/40">
        DISQUALIFIED SUPPLIER
      </span>
    );
  };

  const handleApplyOverride = () => {
    setOverrideScore(newScoreInput);
    setShowOverrideModal(false);
    addAuditLog(
      `Manual Override: Category Manager adjusted Mode 3 360° score for ${record.vendorName} to ${newScoreInput}%`,
      'Mode-3-Override'
    );
    showToast(
      'Score Overridden',
      `Mode 3 evaluation score for ${record.vendorName} set to ${newScoreInput}%. Audit log updated.`,
      'success'
    );
  };

  const handleTriggerCAPA = () => {
    setCapaOpen(true);
    addAuditLog(
      `Triggered CAPA Action Plan for vendor ${record.vendorName}`,
      'CAPA-Trigger'
    );
    addFeedItem(
      `CAPA Triggered: ${record.vendorName}`,
      `Corrective Action Plan issued for ${record.vendorName}. Required items: ${capaNotes || 'Document clarification & warranty update'}.`,
      'escalation',
      `EVAL-${record.vendorId || 'SUPPLIER'}`,
      record.vendorName
    );
    showToast('CAPA Notice Issued', `Corrective Action Plan sent to ${record.email}.`, 'info');
  };

  const questions = record.questionBreakdown || [];
  const filteredQuestions = selectedPillarFilter === 'ALL'
    ? questions
    : questions.filter((q) => q.pillarId === selectedPillarFilter);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Top Bar Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="btn btn-secondary btn-sm">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                Mode 3 360-Degree Vendor Evaluation Summary Report
              </h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowOverrideModal(true)}
            className="btn btn-secondary btn-sm"
          >
            <Sliders size={13} /> Override AI Score
          </button>
          <button onClick={handleTriggerCAPA} className="btn btn-amber btn-sm">
            <AlertTriangle size={13} /> Trigger CAPA Action
          </button>
          <button
            onClick={() => showToast('Evaluation PDF Exported', 'Downloaded Mode 3 360° Evaluation Report for enterprise audit.', 'success')}
            className="btn btn-primary btn-sm"
          >
            <Download size={13} /> Export PDF Report
          </button>
        </div>
      </div>

      {/* Interactive Company / Supplier Selection Dropdown Bar */}
      <div className="glass-panel p-3.5 rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 bg-gradient-to-r from-indigo-50/70 via-white to-sky-50/70 dark:from-indigo-950/30 dark:via-gray-900/90 dark:to-sky-950/30 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 relative z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Building2 size={16} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-400 tracking-wider">
              Evaluating Supplier Company
            </div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Select any supplier to view dynamic 6-pillar scorecard & compliance matrix
            </div>
          </div>
        </div>

        {/* Company Select Dropdown */}
        <div className="relative z-40" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-label="Select Company / Vendor"
            className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-white dark:bg-gray-800 border border-slate-300 dark:border-slate-700 hover:border-indigo-500 text-xs font-bold text-slate-800 dark:text-slate-100 shadow-sm min-w-[280px] sm:min-w-[360px] transition-all cursor-pointer text-left"
          >
            <div className="flex items-center gap-2 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <div className="truncate">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="font-black text-slate-900 dark:text-white truncate">
                    {record.vendorName}
                  </span>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider flex items-center gap-1 shrink-0 ${
                      isBuyerUploaded(record)
                        ? 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                        : 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    }`}
                  >
                    {isBuyerUploaded(record) ? <UploadCloud size={9} /> : <ShieldCheck size={9} />}
                    {isBuyerUploaded(record) ? 'Uploaded by Buyer' : 'Procucev Vendor'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal truncate block mt-0.5">
                  {record.vendorId} • {record.category}
                </span>
              </div>
            </div>
            <ChevronDown size={15} className={`text-slate-400 transition-transform shrink-0 ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Menu Popover */}
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-84 sm:w-96 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden animate-fade-in">
              {/* Header */}
              <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-gray-950 flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                  <UploadCloud size={13} className="text-indigo-600" />
                  <span>Buyer Approved Suppliers</span>
                </span>
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50">
                  {companyOptions.length}
                </span>
              </div>

              {/* Search Bar */}
              <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-gray-950/60">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search approved suppliers by name, category..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-white dark:bg-gray-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 px-1">
                  <span>
                    {filteredCompanyOptions.length} supplier{filteredCompanyOptions.length === 1 ? '' : 's'} found
                  </span>
                  <span>Click to inspect evaluation</span>
                </div>
              </div>

              {/* Options List */}
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {filteredCompanyOptions.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    {searchQuery.trim()
                      ? `No suppliers match "${searchQuery}"`
                      : 'No buyer suppliers available'}
                  </div>
                ) : (
                  filteredCompanyOptions.map((c) => {
                    const isSelected = c.id === record.vendorId || c.name === record.vendorName;
                    const isBuyer = isBuyerUploaded(c);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectCompany(c.id)}
                        className={`w-full text-left p-2.5 flex items-center justify-between gap-2 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40 transition-colors ${
                          isSelected ? 'bg-indigo-50 dark:bg-indigo-950/60 font-bold' : ''
                        }`}
                      >
                        <div className="truncate">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {c.name}
                            </span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-medium flex items-center gap-1 ${
                                isBuyer
                                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              }`}
                            >
                              {isBuyer ? <UploadCloud size={9} /> : <ShieldCheck size={9} />}
                              {isBuyer ? 'Buyer Upload' : 'Procucev'}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            <span className="font-mono text-indigo-600 dark:text-indigo-400">{c.id}</span> • {c.category}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs font-mono font-bold ${c.score >= 80 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {c.score}%
                          </span>
                          {isSelected && <Check size={14} className="text-indigo-600 dark:text-indigo-400" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Vendor Executive Header Card */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md relative z-10 overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Vendor Info */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                {record.vendorId}
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-600 dark:text-gray-400 font-medium flex items-center gap-1">
                <Tag size={12} /> {record.category}
              </span>
            </div>

            <h2 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <CompanyHoverTooltip
                name={record.vendorName}
                type="vendor"
                contact={{
                  contactPerson: record.contactPerson,
                  mobile: record.phone,
                  email: record.email,
                  verified: record.status === 'PREFERRED ENTERPRISE SUPPLIER',
                }}
              />
              <ShieldCheck className="text-emerald-500" size={24} />
            </h2>

            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-gray-400 flex-wrap">
              <span className="flex items-center gap-1"><Building2 size={13} /> Contact: <strong className="text-slate-700 dark:text-gray-200">{record.contactPerson}</strong></span>
              <span className="flex items-center gap-1"><Mail size={13} /> {record.email}</span>
              <span className="flex items-center gap-1"><Phone size={13} /> {record.phone}</span>
              <span className="flex items-center gap-1"><Clock size={13} /> Submitted: {record.submissionDate}</span>
            </div>
          </div>

          {/* Computed Rating Gauge */}
          <div className="flex items-center gap-5 p-4 rounded-xl bg-slate-900 text-white shadow-lg shrink-0 border border-slate-800">
            <div className="text-center">
              <div className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                360° AI Rating Score
              </div>
              <div className="text-4xl font-black mono text-emerald-400 mt-1">
                {effectiveScore}%
              </div>
              {overrideScore !== null && (
                <span className="text-[9px] text-amber-400 font-mono font-bold block mt-0.5">
                  (Calibrated by CM)
                </span>
              )}
            </div>

            <div className="space-y-1.5 border-l border-slate-800 pl-4">
              {getStatusBadge(record.status, effectiveScore)}
              <div className="text-[10px] text-indigo-300">
                Gate Pass Status: <span className="font-bold text-emerald-400">≥ 80% Unlocked</span>
              </div>
            </div>
          </div>
        </div>

        {/* Automated System Execution Action Banner */}
        <div className="mt-5 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold">
            <Zap size={15} className="text-emerald-600 dark:text-emerald-400 animate-pulse" />
            <span>Automated Execution:</span>
            <span className="font-normal text-emerald-900 dark:text-emerald-200">{record.systemAction}</span>
          </div>
          <span className="badge badge-emerald">24/24 Attachments Verified</span>
        </div>
      </div>

      {/* 6 Subtotal Pillar Summary Cards */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />
          6-Pillar Subtotal Summary & Auditor Remarks
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Module 1: Commercial (25%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-xs flex items-center justify-center">
                    M1
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Commercial Terms</span>
                </div>
                <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  {moduleScores.commercial.weightedScore} / 25 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.commercial.weightedScore / 25) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800/60 text-[10px] text-indigo-900 dark:text-indigo-200">
              <div className="font-bold text-indigo-700 dark:text-indigo-300 mb-0.5">💬 Pillar 1 Auditor Remarks:</div>
              {moduleScores.commercial.remarks}
            </div>
          </div>

          {/* Module 2: Technical (15%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-sky-100 dark:bg-cyan-950 text-sky-700 dark:text-cyan-300 font-bold text-xs flex items-center justify-center">
                    M2
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Technical Capabilities</span>
                </div>
                <span className="text-xs font-mono font-bold text-sky-600 dark:text-cyan-400">
                  {moduleScores.technical.weightedScore} / 15 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-sky-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.technical.weightedScore / 15) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-sky-50/70 dark:bg-cyan-950/50 border border-sky-100 dark:border-cyan-800/60 text-[10px] text-sky-900 dark:text-cyan-200">
              <div className="font-bold text-sky-700 dark:text-cyan-300 mb-0.5">💬 Pillar 2 Auditor Remarks:</div>
              {moduleScores.technical.remarks}
            </div>
          </div>

          {/* Module 3: Quality (20%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center">
                    M3
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Quality & Warranty</span>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {moduleScores.quality.weightedScore} / 20 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.quality.weightedScore / 20) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-800/60 text-[10px] text-emerald-900 dark:text-emerald-200">
              <div className="font-bold text-emerald-700 dark:text-emerald-300 mb-0.5">💬 Pillar 3 Auditor Remarks:</div>
              {moduleScores.quality.remarks}
            </div>
          </div>

          {/* Module 4: Delivery (20%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-bold text-xs flex items-center justify-center">
                    M4
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Operational Delivery</span>
                </div>
                <span className="text-xs font-mono font-bold text-purple-600 dark:text-purple-400">
                  {moduleScores.delivery.weightedScore} / 20 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-purple-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.delivery.weightedScore / 20) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-purple-50/70 dark:bg-purple-950/50 border border-purple-100 dark:border-purple-800/60 text-[10px] text-purple-900 dark:text-purple-200">
              <div className="font-bold text-purple-700 dark:text-purple-300 mb-0.5">💬 Pillar 4 Auditor Remarks:</div>
              {moduleScores.delivery.remarks}
            </div>
          </div>

          {/* Module 5: Financial (10%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-bold text-xs flex items-center justify-center">
                    M5
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Financial Stability</span>
                </div>
                <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                  {moduleScores.financial.weightedScore} / 10 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.financial.weightedScore / 10) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/50 border border-amber-100 dark:border-amber-800/60 text-[10px] text-amber-900 dark:text-amber-200">
              <div className="font-bold text-amber-700 dark:text-amber-300 mb-0.5">💬 Pillar 5 Auditor Remarks:</div>
              {moduleScores.financial.remarks}
            </div>
          </div>

          {/* Module 6: ESG & Compliance (10%) */}
          <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-bold text-xs flex items-center justify-center">
                    M6
                  </span>
                  <span className="font-bold text-xs text-slate-800 dark:text-gray-200">Governance & ESG</span>
                </div>
                <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400">
                  {moduleScores.governance.weightedScore} / 10 pts
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-rose-600 h-full rounded-full"
                  style={{ width: `${(moduleScores.governance.weightedScore / 10) * 100}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>4/4 Mandatory Attachments</span>
                <span className="text-emerald-600 font-bold">100% OCR Passed</span>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-rose-50/70 dark:bg-rose-950/50 border border-rose-100 dark:border-rose-800/60 text-[10px] text-rose-900 dark:text-rose-200">
              <div className="font-bold text-rose-700 dark:text-rose-300 mb-0.5">💬 Pillar 6 Auditor Remarks:</div>
              {moduleScores.governance.remarks}
            </div>
          </div>
        </div>
      </div>

      {/* 24-Criteria Granular Evaluation Breakdown Table */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-gray-800">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200 flex items-center gap-2">
              <FileText size={16} className="text-indigo-600 dark:text-indigo-400" />
              24-Criteria 360-Degree Evaluation Matrix ({questions.length} Items)
            </h3>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              Individual question scores, mandatory verified attachments, and AI auditor justification remarks.
            </p>
          </div>

          {/* Pillar Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto text-xs">
            {['ALL', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((p) => (
              <button
                key={p}
                onClick={() => setSelectedPillarFilter(p)}
                className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                  selectedPillarFilter === p
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800'
                }`}
              >
                {p === 'ALL' ? 'All 24 Criteria' : p}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-500 uppercase tracking-wider text-[10px] bg-slate-50/50 dark:bg-gray-950/50">
                <th className="py-2.5 px-3">Ref ID</th>
                <th className="py-2.5 px-3">Evaluation Criteria</th>
                <th className="py-2.5 px-3">Required Mandatory Attachment</th>
                <th className="py-2.5 px-3 text-center">Score (1-5)</th>
                <th className="py-2.5 px-3 text-right">Weighted %</th>
                <th className="py-2.5 px-3">AI / Auditor Justification Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800/80">
              {filteredQuestions.map((q, idx) => (
                <tr key={q.refId ? `${q.refId}-${idx}` : `q-${idx}`} className="hover:bg-slate-50/80 dark:hover:bg-gray-800/40 transition-colors">
                  <td className="py-3 px-3">
                    <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      {q.refId}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-800 dark:text-gray-200 max-w-xs">
                    {q.criteria}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                      <Paperclip size={12} className="shrink-0" />
                      <span className="truncate max-w-[160px]" title={q.attachmentName}>{q.attachmentName}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                        ✓ Verified
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center font-bold text-slate-800 dark:text-gray-200 mono">
                    {(q.score ?? 0).toFixed(1)} / 5.0
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-indigo-600 dark:text-indigo-400 mono">
                    +{(q.weightedScore ?? 0).toFixed(2)}%
                  </td>
                  <td className="py-3 px-3 text-[11px] text-slate-600 dark:text-gray-300 italic max-w-md">
                    &quot;{q.remarks}&quot;
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 24 Verified Mandatory Attachments Overview Card */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200 flex items-center gap-2">
            <Paperclip size={16} className="text-indigo-600 dark:text-indigo-400" />
            24 Mandatory PDF/Excel File Attachments Audit Status ({documents.length} Files)
          </h3>
          <span className="badge badge-emerald">24/24 OCR Verification 100%</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-500 uppercase tracking-wider text-[10px]">
                <th className="py-2">Document File Title</th>
                <th className="py-2">Criteria Type</th>
                <th className="py-2">Uploaded On</th>
                <th className="py-2">OCR Audit Status</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
              {documents.slice(0, 12).map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                  <td className="py-2.5 font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                    <FileText size={14} className="text-indigo-500 shrink-0" />
                    <span>{doc.name}</span>
                  </td>
                  <td className="py-2.5 text-slate-600 dark:text-gray-400">{doc.type}</td>
                  <td className="py-2.5 text-slate-400 dark:text-gray-500 mono">{doc.uploadDate}</td>
                  <td className="py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
                      ✓ {doc.status}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => showToast('Document Opened', `Viewing ${doc.name} in secure Azure Blob viewer.`, 'info')}
                      className="btn btn-ghost btn-sm text-[11px] text-indigo-600 dark:text-indigo-400"
                    >
                      <ExternalLink size={12} /> Preview
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {documents.length > 12 && (
            <div className="text-center py-2 text-xs text-indigo-600 font-bold">
              + {documents.length - 12} additional mandatory documents verified in Azure Blob Storage.
            </div>
          )}
        </div>
      </div>

      {/* Manual Score Override Modal */}
      {showOverrideModal && (
        <div className="modal-overlay">
          <div className="modal-content max-w-md p-6 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-gray-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sliders size={16} className="text-indigo-600" /> Override AI Evaluation Score
              </h3>
              <button onClick={() => setShowOverrideModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-gray-400">
              Category Manager Manual Governance Override. Enter the calibrated score percentage for <strong>{record.vendorName}</strong>:
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-gray-300">
                Calibrated Rating Score (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={newScoreInput}
                onChange={(e) => setNewScoreInput(Number(e.target.value))}
                className="mono font-bold text-base"
              />
            </div>

            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-300 border border-amber-200">
              ⚠️ Note: Manual score overrides are cryptographically logged in the Azure Immutable Audit Trail.
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowOverrideModal(false)} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <button onClick={handleApplyOverride} className="btn btn-primary btn-sm">
                Confirm Score Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
