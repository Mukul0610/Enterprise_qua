'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { fetchAllVendors } from '@/lib/rfqClient';
import { fetchBuyerProfile } from '@/lib/buyerProfileClient';
import { VendorEvaluationRecord, VendorEntry, VendorPageMeta } from '@/lib/types';
import VendorUploadModal from '@/app/category-manager/VendorUploadModal';
import {
  Search,
  Building2,
  FileCheck,
  ChevronRight,
  ShieldCheck,
  Mail,
  MapPin,
  Plus,
  CheckCircle2,
  Lock,
  Star,
  Send,
  X,
  AlertCircle,
  UploadCloud,
  Sparkles,
  Users,
  Eye,
  Pencil,
  Trash2,
  Phone,
  Globe,
  FileText,
  Layers,
  Award,
  DollarSign,
  Tag,
  Check,
} from 'lucide-react';

interface VendorSummaryProps {
  onViewEvaluation: (record: VendorEvaluationRecord) => void;
  onNavigateToWizard?: () => void;
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

// Classification helper: Procucev Vendors (Category Manager uploads & Direct Self-Registration)
export const isProcucevVendor = (v: any): boolean => {
  return !isBuyerUploaded(v);
};

export default function VendorSummary({ onViewEvaluation, onNavigateToWizard }: VendorSummaryProps) {
  const {
    vendorEvaluations,
    currentMode,
    rfqs,
    showToast,
    buyerVendors,
    addBuyerVendor,
    updateBuyerVendor,
    deleteBuyerVendor,
    categoryTaxonomy,
    reviseVendorRating,
    openRatingRevisionEmailModal,
    activeBuyerAccount,
  } = useApp();

  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Buyer's own registered pincode, fetched once — used to rank vendors with
  // a matching pincode first, same relevance-then-pincode rule the backend
  // already applies to mode_2 RFQ dispatch (createRFQ) and RFQ invite emails
  // (selectVendorsForRFQEmail): pincode re-sorts an already-relevant list, it
  // never filters anyone out.
  const [buyerPincode, setBuyerPincode] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchBuyerProfile().then((result) => {
      if (cancelled) return;
      if (result.success && result.data?.pincode) {
        setBuyerPincode(String(result.data.pincode).trim() || null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pincode-first sort: vendors whose pincode matches the buyer's own are
  // moved to the front, preserving whatever relative order (rating, etc.)
  // each group already had — mirrors the backend's pincode-match-then-rating
  // ranking rather than introducing a separate ordering rule client-side.
  const sortByPincodeMatch = (list: any[]) => {
    if (!buyerPincode) return list;
    const matches: any[] = [];
    const nonMatches: any[] = [];
    for (const v of list) {
      if (v.pincode && String(v.pincode).trim() === buyerPincode) {
        matches.push(v);
      } else {
        nonMatches.push(v);
      }
    }
    return [...matches, ...nonMatches];
  };

  // CRUD Modals State
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [bulkUploadModalOpen, setBulkUploadModalOpen] = useState(false);
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedVendorForCrud, setSelectedVendorForCrud] = useState<any | null>(null);

  // Rating Revision State
  const [selectedVendorForRevision, setSelectedVendorForRevision] = useState<any | null>(null);
  const [qualityScore, setQualityScore] = useState<number | string>(85);
  const [costScore, setCostScore] = useState<number | string>(85);
  const [deliveryScore, setDeliveryScore] = useState<number | string>(85);
  const [remarks, setRemarks] = useState('');
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);

  // CRUD Form State
  const [formName, setFormName] = useState('');
  const [formBrandName, setFormBrandName] = useState('');
  const [formMajorCategory, setFormMajorCategory] = useState('');
  const [formMinorCategories, setFormMinorCategories] = useState<string[]>([]);
  const [formMinorInput, setFormMinorInput] = useState('');
  const [formContactPerson, setFormContactPerson] = useState('');
  const [formContactDesignation, setFormContactDesignation] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formState, setFormState] = useState('');
  const [formCountry, setFormCountry] = useState('India');
  const [formPincode, setFormPincode] = useState('');
  const [formGst, setFormGst] = useState('');
  const [formPan, setFormPan] = useState('');
  const [formMsme, setFormMsme] = useState('');
  const [formAnnualTurnover, setFormAnnualTurnover] = useState('');
  const [formRating, setFormRating] = useState<number>(4.5);
  const [formStatus, setFormStatus] = useState<VendorEntry['status']>('PREFERRED ENTERPRISE SUPPLIER');

  // Available Major Categories from Taxonomy or Default List
  const availableMajorCategories = Array.from(
    new Set([
      ...(categoryTaxonomy && categoryTaxonomy.length > 0
        ? categoryTaxonomy.map((c) => c.majorCategory)
        : [
            'Mechanical',
            'Electrical',
            'Civil',
            'Instrumentation & Automation',
            'Chemicals & Petrochemicals',
            'Piping & Fittings',
            'Safety & PPE',
            'Raw Materials',
            'General Industrial',
          ]),
      'Mechanical',
      'Electrical',
      'Civil',
      'Instrumentation & Automation',
    ])
  ).filter(Boolean);

  // Open Add Vendor Modal — reuses the same form field state as Edit, reset
  // to blanks/defaults since there is no existing vendor to populate from.
  const handleOpenAddModal = () => {
    setFormName('');
    setFormBrandName('');
    setFormMajorCategory(availableMajorCategories[0] || 'Mechanical');
    setFormMinorCategories([]);
    setFormMinorInput('');
    setFormContactPerson('');
    setFormContactDesignation('Authorized Representative');
    setFormEmail('');
    setFormPhone('');
    setFormLocation('');
    setFormCity('');
    setFormState('');
    setFormCountry('India');
    setFormPincode('');
    setFormGst('');
    setFormPan('');
    setFormMsme('');
    setFormAnnualTurnover('');
    setFormRating(4.5);
    setFormStatus('REGISTERED / NOT EVALUATED');
    setAddModalOpen(true);
  };

  // Form Submission: Add Vendor — persists through the real POST /api/vendors
  // endpoint (see addBuyerVendor in store.tsx); only closes the modal and
  // clears the form once the backend actually confirms the write.
  const handleAddVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formMajorCategory || !formEmail.trim() || !formContactPerson.trim() || !formPhone.trim()) {
      showToast('Validation Error', 'Please complete all required fields.', 'warning');
      return;
    }

    setIsSubmittingAdd(true);
    const created = await addBuyerVendor({
      name: formName.trim(),
      brandName: formBrandName.trim() || formName.trim(),
      majorCategory: formMajorCategory,
      minorCategories: formMinorCategories.length > 0 ? formMinorCategories : [formMajorCategory],
      contactPerson: formContactPerson.trim(),
      contactDesignation: formContactDesignation.trim(),
      email: formEmail.trim().toLowerCase(),
      phone: formPhone.trim(),
      location: formLocation.trim() || `${formCity}, ${formState}`,
      city: formCity.trim(),
      state: formState.trim(),
      country: formCountry.trim() || 'India',
      pincode: formPincode.trim(),
      gst: formGst.trim().toUpperCase(),
      gstin: formGst.trim().toUpperCase(),
      pan: formPan.trim().toUpperCase(),
      msme: formMsme.trim(),
      annualTurnover: formAnnualTurnover.trim(),
      rating: Number(formRating) || 4.5,
      score: Math.round((Number(formRating) || 4.5) * 20),
      status: formStatus,
      source: 'buyer_manual',
    });
    setIsSubmittingAdd(false);

    // On failure, addBuyerVendor already showed the error toast — keep the
    // modal open with the form intact so nothing the buyer typed is lost.
    if (created) {
      setAddModalOpen(false);
    }
  };

  // Open Edit Vendor Modal
  const handleOpenEditModal = (vendor: any) => {
    setSelectedVendorForCrud(vendor);
    setFormName(vendor.name || '');
    setFormBrandName(vendor.brandName || vendor.name || '');
    setFormMajorCategory(vendor.majorCategory || availableMajorCategories[0] || 'Mechanical');
    setFormMinorCategories(vendor.minorCategories ? [...vendor.minorCategories] : []);
    setFormMinorInput('');
    setFormContactPerson(vendor.contactPerson || '');
    setFormContactDesignation(vendor.contactDesignation || 'Authorized Representative');
    setFormEmail(vendor.email || '');
    setFormPhone(vendor.phone || '');
    setFormLocation(vendor.location || `${vendor.city || ''}, ${vendor.state || ''}`);
    setFormCity(vendor.city || '');
    setFormState(vendor.state || '');
    setFormCountry(vendor.country || 'India');
    setFormPincode(vendor.pincode || '');
    setFormGst(vendor.gst || vendor.gstin || '');
    setFormPan(vendor.pan || '');
    setFormMsme(vendor.msme || '');
    setFormAnnualTurnover(vendor.annualTurnover || '₹10 - ₹50 Cr');
    setFormRating(vendor.rating || 4.5);
    setFormStatus(vendor.status || 'PREFERRED ENTERPRISE SUPPLIER');
    setEditModalOpen(true);
  };

  // Open View Profile Modal
  const handleOpenViewModal = (vendor: any) => {
    setSelectedVendorForCrud(vendor);
    setViewModalOpen(true);
  };

  // Open Delete Vendor Modal
  const handleOpenDeleteModal = (vendor: any) => {
    setSelectedVendorForCrud(vendor);
    setDeleteModalOpen(true);
  };

  // Add Minor Category Tag
  const handleAddMinorCategoryTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !formMinorCategories.includes(trimmed)) {
      setFormMinorCategories([...formMinorCategories, trimmed]);
    }
    setFormMinorInput('');
  };

  // Remove Minor Category Tag
  const handleRemoveMinorCategoryTag = (tagToRemove: string) => {
    setFormMinorCategories(formMinorCategories.filter((t) => t !== tagToRemove));
  };

  // Form Submission: Edit Vendor
  const handleEditVendorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForCrud) return;
    if (!formName.trim() || !formMajorCategory || !formEmail.trim() || !formContactPerson.trim() || !formPhone.trim()) {
      showToast('Validation Error', 'Please complete all required fields.', 'warning');
      return;
    }

    const updates: Partial<VendorEntry> = {
      name: formName.trim(),
      brandName: formBrandName.trim() || formName.trim(),
      majorCategory: formMajorCategory,
      minorCategories: formMinorCategories.length > 0 ? formMinorCategories : [formMajorCategory],
      contactPerson: formContactPerson.trim(),
      contactDesignation: formContactDesignation.trim(),
      email: formEmail.trim().toLowerCase(),
      phone: formPhone.trim(),
      location: formLocation.trim() || `${formCity}, ${formState}`,
      city: formCity.trim(),
      state: formState.trim(),
      country: formCountry.trim() || 'India',
      pincode: formPincode.trim(),
      gst: formGst.trim().toUpperCase(),
      gstin: formGst.trim().toUpperCase(),
      pan: formPan.trim().toUpperCase(),
      msme: formMsme.trim(),
      annualTurnover: formAnnualTurnover.trim(),
      rating: Number(formRating) || 4.5,
      score: Math.round((Number(formRating) || 4.5) * 20),
      status: formStatus,
    };

    updateBuyerVendor(selectedVendorForCrud.id, updates);
    setEditModalOpen(false);
    setSelectedVendorForCrud(null);
  };

  // Confirm Delete Vendor
  const handleDeleteVendorConfirm = () => {
    if (!selectedVendorForCrud) return;
    deleteBuyerVendor(selectedVendorForCrud.id);
    setDeleteModalOpen(false);
    setSelectedVendorForCrud(null);
  };

  // Helper for granular source badges / origin notes
  const getVendorOriginDetails = (v: any) => {
    const s = String(v.source || '').toLowerCase().trim();
    if (s === 'historical_purchase_dump' || s.includes('purchase_dump')) {
      return {
        origin: 'PO Spend Data Ingestion',
        badgeClass: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      };
    }
    if (s === 'vendor_master_ingestion' || s.includes('ingestion') || s === 'buyer_uploaded') {
      return {
        origin: 'Vendor Master Ingestion',
        badgeClass: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      };
    }
    if (s === 'buyer_excel') {
      return {
        origin: 'Buyer Excel Ingest',
        badgeClass: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      };
    }
    if (s === 'buyer_manual' || s.includes('buyer')) {
      return {
        origin: 'Buyer Manual Empanelment',
        badgeClass: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      };
    }
    if (s === 'excel' || s === 'category_manager_upload') {
      return {
        origin: 'Category Manager Catalogue',
        badgeClass: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      };
    }
    if (s === 'self_onboarded' || s === 'vendor_registration' || s === 'self_registered') {
      return {
        origin: 'Direct Self-Onboarded',
        badgeClass: 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800',
      };
    }
    if (s === 'procucev_network' || !isBuyerUploaded(v)) {
      return {
        origin: (v as any).overlap ? 'Overlap (Buyer + Procucev)' : 'Procucev Network Partner',
        badgeClass: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      };
    }
    return {
      origin: 'Registered Supplier',
      badgeClass: 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-gray-700',
    };
  };

  // Check if vendor has been used by the buyer in any RFQ or was uploaded by the buyer
  const getVendorRfqEngagement = (vendor: any) => {
    const vName = (vendor.name || '').toLowerCase().trim();
    const vId = (vendor.id || '').toLowerCase().trim();

    // Check all buyer RFQs where this vendor is invited or has bids
    const matchingRfqs = rfqs.filter((r) => {
      const inQuotes = (r.quotes || []).some(
        (q) =>
          (q.vendorName && q.vendorName.toLowerCase().trim() === vName) ||
          (q.vendorId && q.vendorId.toLowerCase().trim() === vId)
      );
      const inFollowUps = (r.followUpData?.vendors || []).some(
        (f) =>
          (f.vendorName && f.vendorName.toLowerCase().trim() === vName) ||
          (f.vendorId && f.vendorId.toLowerCase().trim() === vId)
      );
      return inQuotes || inFollowUps;
    });

    const isUploaded = isBuyerUploaded(vendor);
    const isUsedInRFQ = matchingRfqs.length > 0;
    const isEngaged = isUploaded || isUsedInRFQ;

    let qualificationReason = '';
    if (isUploaded && isUsedInRFQ) {
      qualificationReason = `Buyer Empanelled & Active in ${matchingRfqs.length} RFQ(s)`;
    } else if (isUploaded) {
      qualificationReason = 'Buyer Empanelled Supplier';
    } else if (isUsedInRFQ) {
      qualificationReason = `Used in ${matchingRfqs[0]?.rfqNumber || 'RFQ'}`;
    }

    return {
      isEngaged,
      isUploaded,
      isUsedInRFQ,
      matchingRfqs,
      recentRfqNumber: matchingRfqs[0]?.rfqNumber || null,
      qualificationReason,
    };
  };

  // Open Revision Modal
  const openRevisionModal = (vendor: any) => {
    const engagement = getVendorRfqEngagement(vendor);
    if (!engagement.isEngaged) {
      showToast(
        'Rating Revision Restricted',
        `You cannot revise the performance rating for "${vendor.name}" because this supplier has not participated in any RFQs with your organization.`,
        'warning'
      );
      return;
    }

    setSelectedVendorForRevision(vendor);
    const currentScore = vendor.score || (vendor.rating ? Math.round(vendor.rating * 20) : 88);
    const baseScore = vendor.latestRatingRevision
      ? vendor.latestRatingRevision.qualityScore
      : Math.min(100, Math.max(70, currentScore));

    setQualityScore(vendor.latestRatingRevision?.qualityScore || baseScore);
    setCostScore(vendor.latestRatingRevision?.costScore || Math.max(65, baseScore - 5));
    setDeliveryScore(vendor.latestRatingRevision?.deliveryScore || Math.min(100, baseScore + 3));

    const contextNote = engagement.isUsedInRFQ
      ? `Performance evaluated on procurement cycle (${engagement.recentRfqNumber}): Excellent technical adherence, competitive cost structure, and verified on-time delivery compliance.`
      : `Operational evaluation for buyer empanelled vendor (${vendor.name}): Verified commercial terms, factory audit compliance, and SLA terms.`;

    setRemarks(vendor.latestRatingRevision?.remarks || contextNote);
  };

  const handleSaveRatingRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForRevision || isSubmittingRevision) return;

    if (!remarks.trim()) {
      showToast('Remarks Required', 'Please provide performance remarks explaining the rating change.', 'warning');
      return;
    }

    setIsSubmittingRevision(true);
    const saved = await reviseVendorRating(
      selectedVendorForRevision.id,
      Number(qualityScore),
      Number(costScore),
      Number(deliveryScore),
      remarks
    );
    setIsSubmittingRevision(false);

    if (!saved) return;

    setSelectedVendorForRevision(null);
  };

  // Merge evaluations in store onto a vendor list, shared by both tabs.
  const allEvaluations = [...vendorEvaluations];
  const mergeWithEvaluations = (list: VendorEntry[]) =>
    list.map((bv) => {
      const storeEval = allEvaluations.find((e) => e.vendorName === bv.name || e.vendorId === bv.id);
      if (storeEval) {
        return {
          ...bv,
          status: storeEval.status,
          score: storeEval.overallScore,
          evaluated: true,
          hasRecord: true,
          storeRecord: storeEval,
        };
      }
      return { ...bv };
    });

  const mergedVendors = mergeWithEvaluations(buyerVendors);
  const buyerUploadedVendorsList = mergedVendors.filter(isBuyerUploaded);

  // Filter categories dynamically
  const categories = [
    'ALL',
    ...Array.from(new Set(buyerUploadedVendorsList.map((v) => v.majorCategory || 'General Industrial'))),
  ];

  // Helper filter function
  const filterVendorItem = (v: any) => {
    const q = (searchQuery || '').toLowerCase().trim();
    const vName = (v.name || '').toLowerCase();
    const vContact = (v.contactPerson || '').toLowerCase();
    const vEmail = (v.email || '').toLowerCase();
    const vId = (v.id || '').toLowerCase();
    const rawCategory = v.majorCategory || '';
    const vCategory = rawCategory.toLowerCase();
    const vMinors = (v.minorCategories || []).join(' ').toLowerCase();
    const vLocation = (v.location || v.city || v.state || '').toLowerCase();
    const vGstin = (v.gstin || '').toLowerCase();

    const matchesSearch =
      !q ||
      vName.includes(q) ||
      vContact.includes(q) ||
      vEmail.includes(q) ||
      vId.includes(q) ||
      vCategory.includes(q) ||
      vMinors.includes(q) ||
      vLocation.includes(q) ||
      vGstin.includes(q);

    const matchesCategory = selectedCategory === 'ALL' || rawCategory.toLowerCase() === selectedCategory.toLowerCase();
    const matchesStatus =
      selectedStatus === 'ALL' ||
      (selectedStatus === 'EVALUATED' && v.evaluated) ||
      (selectedStatus === 'NOT_EVALUATED' && !v.evaluated) ||
      (selectedStatus === 'PREFERRED' && v.status === 'PREFERRED ENTERPRISE SUPPLIER') ||
      (selectedStatus === 'CONDITIONAL' && v.status === 'CONDITIONAL / UNDER REVIEW');

    return matchesSearch && matchesCategory && matchesStatus;
  };

  const buyerFilteredVendors = sortByPincodeMatch(buyerUploadedVendorsList.filter(filterVendorItem));

  // Multi-Selection Controls
  const handleToggleSelectVendor = (id: string) => {
    setSelectedVendorIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (selectedVendorIds.length === buyerFilteredVendors.length && buyerFilteredVendors.length > 0) {
      setSelectedVendorIds([]);
    } else {
      setSelectedVendorIds(buyerFilteredVendors.map((v) => v.id).filter(Boolean));
    }
  };

  const handleClearSelection = () => {
    setSelectedVendorIds([]);
  };

  const getStatusStyle = (status: string) => {
    if (status === 'PREFERRED ENTERPRISE SUPPLIER') {
      return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    }
    if (status === 'CONDITIONAL / UNDER REVIEW') {
      return 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    }
    return 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-gray-700';
  };

  // Vendor Card Renderer
  const renderVendorCard = (vendor: any) => {
    const isUploaded = isBuyerUploaded(vendor);
    const originDetails = getVendorOriginDetails(vendor);

    // Check if this vendor has submitted a quote in any RFQ
    const vendorNameLower = (vendor.name || '').toLowerCase();
    const hasSubmittedQuote = rfqs.some((r) =>
      (r.quotes || []).some((q) => {
        const qNameLower = (q.vendorName || '').toLowerCase();
        return (
          (qNameLower && qNameLower.includes(vendorNameLower)) ||
          (vendorNameLower && vendorNameLower.includes(qNameLower))
        );
      })
    );

    // Version Rules
    let showEvaluation = false;
    let showTrigger = false;
    let isLockedForProcucevV2 = false;

    if (currentMode === 'mode_1') {
      showEvaluation = !!(vendor.evaluated && isUploaded);
      showTrigger = false;
    } else if (currentMode === 'mode_2') {
      const hasOverlap = (vendor as any).overlap === true;
      if (vendor.source === 'procucev_network' || hasOverlap) {
        if (hasSubmittedQuote) {
          showEvaluation = !!vendor.evaluated;
          showTrigger = !vendor.evaluated;
        } else {
          isLockedForProcucevV2 = true;
          showEvaluation = false;
          showTrigger = false;
        }
      } else {
        showEvaluation = false;
        showTrigger = false;
      }
    } else {
      // Version 3: AI Sourcing Engine
      showEvaluation = !!vendor.evaluated;
      showTrigger = !vendor.evaluated;
    }

    const engagement = getVendorRfqEngagement(vendor);
    const isSelected = selectedVendorIds.includes(vendor.id);

    return (
      <div
        key={vendor.id}
        className={
          'glass-panel p-5 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ' +
          (isSelected
            ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 ring-1 ring-indigo-500/30'
            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm hover:border-indigo-500/40 dark:hover:border-indigo-400/40')
        }
      >
        <div className="flex items-start md:items-center gap-3.5 flex-1">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => handleToggleSelectVendor(vendor.id)}
            data-testid={`select-vendor-${vendor.id}`}
            aria-label={`Select ${vendor.name}`}
            className="h-4 w-4 rounded border-slate-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer mt-1 md:mt-0 shrink-0"
          />

          {/* Left: Vendor Brand & Info */}
          <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 border border-indigo-200/40">
              {vendor.id}
            </span>
            <span className="text-xs text-slate-500 font-semibold">{vendor.majorCategory}</span>
            <span className="text-slate-400">•</span>

            {/* Primary Source Badge */}
            {isUploaded ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 flex items-center gap-1 shadow-xs">
                <UploadCloud size={11} className="text-indigo-600 dark:text-indigo-400" />
                Uploaded by Buyer
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1 shadow-xs">
                <ShieldCheck size={11} className="text-emerald-600 dark:text-emerald-400" />
                Procucev Vendor
              </span>
            )}

            {/* Secondary Origin Tag */}
            <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${originDetails.badgeClass}`}>
              {originDetails.origin}
            </span>

            {/* RFQ Engagement & Upload Status Badge */}
            {engagement.isEngaged ? (
              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50 flex items-center gap-1">
                <CheckCircle2 size={10} /> {engagement.qualificationReason}
              </span>
            ) : (
              <span
                className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-400 border border-slate-200 dark:border-gray-700 flex items-center gap-1"
                title="Vendor neither uploaded nor used in any RFQs by your organization"
              >
                <Lock size={10} /> No RFQs / Not Uploaded
              </span>
            )}

            {isLockedForProcucevV2 && (
              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 flex items-center gap-1">
                <Lock size={10} /> Quote Submission Pending
              </span>
            )}
          </div>

          <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-1.5">
            {vendor.name}
            {showEvaluation && vendor.score && vendor.score >= 80 && (
              <ShieldCheck className="text-emerald-500" size={16} />
            )}
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-500 dark:text-gray-400">
            <span className="truncate">👤 Contact: {vendor.contactPerson}</span>
            <span className="truncate">✉️ {vendor.email}</span>
            <span className="truncate">📞 {vendor.phone}</span>
            <span className="flex items-center gap-1">
              <MapPin size={12} /> {vendor.location || `${vendor.city || ''}, ${vendor.state || ''}`}
            </span>
          </div>

          {vendor.minorCategories && vendor.minorCategories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-[10px] text-slate-400 font-semibold">Minors:</span>
              {vendor.minorCategories.map((m: string) => (
                <span
                  key={m}
                  className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40"
                >
                  {m}
                </span>
              ))}
            </div>
          )}

          {/* Performance Rating Revision Badge / History Line */}
          {vendor.latestRatingRevision && (
            <div className="mt-2 p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-300">
                  <Star size={12} className="fill-amber-500 text-amber-500" />
                  <span>
                    Buyer Rating Revision: {vendor.latestRatingRevision.newRating} ★ (
                    {vendor.latestRatingRevision.newCompositeScore}%)
                  </span>
                  <span className="text-[10px] font-normal text-slate-500">
                    by {vendor.latestRatingRevision.buyerCompany} ({vendor.latestRatingRevision.timestamp.split(' ')[0]})
                  </span>
                </div>
                <p className="text-slate-600 dark:text-gray-300 italic text-[10.5px]">
                  &ldquo;{vendor.latestRatingRevision.remarks}&rdquo; (Quality:{' '}
                  {vendor.latestRatingRevision.qualityScore}, Cost: {vendor.latestRatingRevision.costScore}, Delivery:{' '}
                  {vendor.latestRatingRevision.deliveryScore})
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  vendor.latestRatingRevision && openRatingRevisionEmailModal(vendor.latestRatingRevision)
                }
                className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 shrink-0"
              >
                <Mail size={11} /> View Dispatched Email Notice
              </button>
            </div>
          )}
          </div>
        </div>

        {/* Right: Score Gauge & View Actions */}
        <div className="flex items-center gap-4 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 dark:border-gray-800">
          <div className="text-right">
            {showEvaluation && vendor.score ? (
              <>
                <div className="text-[10px] uppercase font-bold text-slate-400">Mode 3 AI Score</div>
                <div className="text-xl font-mono font-black text-indigo-600 dark:text-indigo-400">
                  {vendor.score}%
                </div>
                <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center justify-end gap-0.5">
                  <Star size={10} className="fill-amber-500 text-amber-500" />{' '}
                  {vendor.rating || (vendor.score / 20).toFixed(1)} / 5.0
                </div>
              </>
            ) : (
              <>
                <div className="text-[10px] uppercase font-bold text-slate-400">Mode 3 AI Score</div>
                <div className="text-xs font-semibold text-slate-400 italic">
                  {currentMode === 'mode_1' && !isUploaded
                    ? 'Hidden (V1 Restriction)'
                    : isLockedForProcucevV2
                    ? 'Locked (Awaiting Quote)'
                    : currentMode === 'mode_2' && isUploaded && !(vendor as any).overlap
                    ? 'Locked (Buyer Roster Only)'
                    : 'Not Evaluated'}
                </div>
                {vendor.rating && (
                  <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center justify-end gap-0.5">
                    <Star size={10} className="fill-amber-500 text-amber-500" /> {vendor.rating} / 5.0
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                currentMode === 'mode_1' && !isUploaded
                  ? 'bg-slate-100 dark:bg-gray-800 text-slate-500 border-slate-200'
                  : getStatusStyle(vendor.status || '')
              }`}
            >
              {currentMode === 'mode_1' && !isUploaded
                ? 'UNAVAILABLE IN V1'
                : isLockedForProcucevV2
                ? 'LOCKED (PENDING BID)'
                : currentMode === 'mode_2' && isUploaded && !(vendor as any).overlap
                ? 'BUYER ROSTER (NO EVAL)'
                : vendor.status}
            </span>

            {/* Action Buttons Toolbar (CRUD + Evaluation + Revision) */}
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {/* View Profile Modal Button */}
              <button
                type="button"
                onClick={() => handleOpenViewModal(vendor)}
                className="btn btn-secondary btn-xs font-semibold flex items-center gap-1 shadow-xs"
                title="View complete supplier profile, commercial details, and contact scorecard"
              >
                <Eye size={11} className="text-indigo-600 dark:text-indigo-400" /> View Profile
              </button>

              {/* Edit Vendor Button - Only for buyer-uploaded vendors */}
              {isUploaded && (
                <button
                  type="button"
                  onClick={() => handleOpenEditModal(vendor)}
                  className="btn btn-secondary btn-xs font-semibold flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 shadow-xs"
                  title="Edit vendor company information, categories, and contact details"
                >
                  <Pencil size={11} /> Edit
                </button>
              )}

              {/* Delete Vendor Button - Only for buyer-uploaded vendors */}
              {isUploaded && (
                <button
                  type="button"
                  onClick={() => handleOpenDeleteModal(vendor)}
                  className="btn btn-ghost btn-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1"
                  title="Delete vendor from directory and database"
                >
                  <Trash2 size={11} /> Delete
                </button>
              )}

              {/* Revise Rating Button */}
              {engagement.isEngaged ? (
                <button
                  type="button"
                  onClick={() => openRevisionModal(vendor)}
                  className="btn btn-amber btn-xs font-bold flex items-center gap-1 shadow-xs"
                  title={`Revise supplier rating (${engagement.qualificationReason})`}
                >
                  <Star size={11} className="fill-current" /> Revise Rating
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    showToast(
                      'Rating Revision Locked',
                      `You cannot revise the rating for "${vendor.name}" because this supplier has neither been used in any of your RFQs nor uploaded by your organization.`,
                      'warning'
                    )
                  }
                  className="btn btn-secondary btn-xs flex items-center gap-1 opacity-50 cursor-not-allowed text-slate-400 border-dashed"
                  title="Rating revision locked: Buyers can only revise performance ratings for suppliers who have been uploaded or engaged in at least one RFQ."
                >
                  <Lock size={10} /> Rating Locked
                </button>
              )}

              {showEvaluation ? (
                <button
                  onClick={() => {
                    const evalRec =
                      (vendor as any).storeRecord ||
                      vendorEvaluations.find((e) => e.vendorId === vendor.id) || {
                        id: `eval-${vendor.id}`,
                        vendorId: vendor.id,
                        vendorName: vendor.name,
                        contactPerson: vendor.contactPerson,
                        email: vendor.email,
                        phone: vendor.phone,
                        category: vendor.majorCategory,
                        submissionDate: '2026-08-18 14:30 UTC',
                        status: vendor.status as any,
                        overallScore: vendor.score || 88,
                        systemAction: 'Active Roster Direct RFQ dispatch confirmed.',
                        moduleScores: {
                          commercial: {
                            score: 4.8,
                            maxScore: 5,
                            weight: 25,
                            weightedScore: 24.0,
                            remarks: 'Payment terms Net 60 fixed rate contract approved.',
                          },
                          technical: {
                            score: 4.5,
                            maxScore: 5,
                            weight: 15,
                            weightedScore: 13.5,
                            remarks: 'Technical parameter compliance datasheet verified.',
                          },
                          quality: {
                            score: 4.6,
                            maxScore: 5,
                            weight: 20,
                            weightedScore: 18.4,
                            remarks: 'ISO 9001:2015 certificate verified.',
                          },
                          delivery: {
                            score: 4.4,
                            maxScore: 5,
                            weight: 20,
                            weightedScore: 17.6,
                            remarks: 'Verified average OTIF 92.4%.',
                          },
                          financial: {
                            score: 4.0,
                            maxScore: 5,
                            weight: 10,
                            weightedScore: 8.0,
                            remarks: 'Credit score A+; clean audit history.',
                          },
                          governance: {
                            score: 4.7,
                            maxScore: 5,
                            weight: 10,
                            weightedScore: 9.4,
                            remarks: 'Statutory GSTIN/PAN and ESG guidelines verified.',
                          },
                        },
                        documents: [],
                      };
                    onViewEvaluation(evalRec);
                  }}
                  className="btn btn-secondary btn-xs flex items-center gap-1"
                >
                  <FileCheck size={11} /> View 360° Evaluation <ChevronRight size={11} />
                </button>
              ) : showTrigger ? (
                <button
                  onClick={() =>
                    showToast(
                      'Triggering AI Evaluation Request',
                      `Verification request email dispatched to ${vendor.email}. Sourcing Bot initiated.`,
                      'info'
                    )
                  }
                  className="btn btn-primary btn-xs flex items-center gap-1"
                >
                  <Plus size={11} /> Trigger Evaluation
                </button>
              ) : isLockedForProcucevV2 ? (
                <button
                  disabled
                  className="btn btn-secondary btn-xs flex items-center gap-1 opacity-50 cursor-not-allowed"
                  title="Quote submission is required from this Procucev network partner before evaluation can be triggered."
                >
                  <Lock size={10} /> Evaluation Locked (Pending Quote)
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Building2 className="text-indigo-600 dark:text-indigo-400" size={24} />
            Vendor Directory &amp; Management
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            data-testid="open-add-vendor-modal"
            onClick={handleOpenAddModal}
            className="btn btn-primary btn-sm flex items-center gap-1.5 shadow-sm"
          >
            <Plus size={14} /> Add Vendor
          </button>
          {/* Upload Vendor Wizard Button */}
          {onNavigateToWizard && (
            <button
              type="button"
              onClick={onNavigateToWizard}
              className="btn btn-secondary btn-sm flex items-center gap-1.5 shadow-sm"
            >
              <UploadCloud size={14} /> Upload Vendor
            </button>
          )}
        </div>
      </div>

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Total Empanelled</div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
            {buyerFilteredVendors.length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">OCR &amp; 360° Evaluated</div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {buyerFilteredVendors.filter((v) => v.evaluated).length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Preferred Status</div>
          <div className="text-2xl font-black text-indigo-700 dark:text-indigo-300 mt-1">
            {buyerFilteredVendors.filter(
              (v) => v.status === 'PREFERRED ENTERPRISE SUPPLIER'
            ).length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Selected Suppliers</div>
          <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
            {selectedVendorIds.length}
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search vendors by name, contact, category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="has-leading-icon text-xs"
          />
        </div>

        {/* Category Selector */}
        <div className="w-full md:w-56">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="select-field text-xs"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'ALL' ? 'All Categories' : c}
              </option>
            ))}
          </select>
        </div>

        {/* Status Selector */}
        <div className="w-full md:w-52">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="select-field text-xs"
          >
            <option value="ALL">All Statuses</option>
            <option value="EVALUATED">Evaluated Only</option>
            <option value="NOT_EVALUATED">Pending Evaluation</option>
            <option value="PREFERRED">Preferred Status</option>
            <option value="CONDITIONAL">Conditional / Review</option>
          </select>
        </div>
      </div>

      {/* Multi-Selection Controls Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-slate-50 dark:bg-gray-900/60 p-3 rounded-xl border border-slate-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              data-testid="select-all-vendors-checkbox"
              checked={buyerFilteredVendors.length > 0 && selectedVendorIds.length === buyerFilteredVendors.length}
              onChange={handleToggleSelectAll}
              className="h-4 w-4 rounded border-slate-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span>Select All ({buyerFilteredVendors.length} suppliers)</span>
          </label>
          {selectedVendorIds.length > 0 && (
            <span className="badge badge-purple text-[10px] font-bold">
              {selectedVendorIds.length} Selected
            </span>
          )}
        </div>
        {selectedVendorIds.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearSelection}
              className="btn btn-ghost btn-xs text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Clear Selection
            </button>
            <button
              type="button"
              onClick={() => showToast('Export Complete', `Exported ${selectedVendorIds.length} selected supplier records.`, 'success')}
              className="btn btn-secondary btn-xs font-semibold"
            >
              Export Selected ({selectedVendorIds.length})
            </button>
          </div>
        )}
      </div>

      {/* Vendors Display List */}
      <div className="space-y-3">
        {buyerFilteredVendors.map(renderVendorCard)}
        {buyerFilteredVendors.length === 0 && (
          <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-gray-800 rounded-2xl bg-slate-50/50 dark:bg-gray-950/40 space-y-3">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 rounded-full w-fit mx-auto text-indigo-600 dark:text-indigo-400">
              <Building2 size={24} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                No vendors match the selected filters.
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Empanel suppliers manually or batch ingest your vendor master catalog.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleOpenAddModal}
                className="btn btn-primary btn-xs font-semibold flex items-center gap-1"
              >
                <Plus size={12} /> Add Vendor
              </button>
              {onNavigateToWizard && (
                <button
                  type="button"
                  onClick={onNavigateToWizard}
                  className="btn btn-secondary btn-xs font-semibold flex items-center gap-1"
                >
                  <UploadCloud size={12} /> Ingest Master / POs
                </button>
              )}
            </div>
          </div>
        )}
      </div>



      {/* ========================================================================= */}
      {/* ADD VENDOR MODAL */}
      {/* ========================================================================= */}
      {addModalOpen && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-800 animate-fade-in max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                  <Plus size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Add Vendor</h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Add a vendor you deal with directly — added to your vendor directory only.
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="close-add-vendor-modal"
                onClick={() => setAddModalOpen(false)}
                disabled={isSubmittingAdd}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddVendorSubmit} className="overflow-y-auto my-3 space-y-3 pr-1 text-xs">
              <div>
                <label htmlFor="add-vendor-name" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  Company Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="add-vendor-name"
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-vendor-contact" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    Contact Person Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="add-vendor-contact"
                    type="text"
                    required
                    value={formContactPerson}
                    onChange={(e) => setFormContactPerson(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                </div>
                <div>
                  <label htmlFor="add-vendor-phone" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    Phone <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="add-vendor-phone"
                    type="tel"
                    required
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="add-vendor-email" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  Email <span className="text-rose-500">*</span>
                </label>
                <input
                  id="add-vendor-email"
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>

              <div>
                <label htmlFor="add-vendor-major-category" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                  Major Category <span className="text-rose-500">*</span>
                </label>
                <select
                  id="add-vendor-major-category"
                  required
                  value={formMajorCategory}
                  onChange={(e) => setFormMajorCategory(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                >
                  {availableMajorCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">Minor Categories</label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {formMinorCategories.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold"
                    >
                      {tag}
                      <button type="button" onClick={() => handleRemoveMinorCategoryTag(tag)}>
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={formMinorInput}
                  onChange={(e) => setFormMinorInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddMinorCategoryTag(formMinorInput);
                    }
                  }}
                  placeholder="Type a minor category and press Enter"
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="add-vendor-city" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">City</label>
                  <input
                    id="add-vendor-city"
                    type="text"
                    value={formCity}
                    onChange={(e) => setFormCity(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                </div>
                <div>
                  <label htmlFor="add-vendor-state" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">State</label>
                  <input
                    id="add-vendor-state"
                    type="text"
                    value={formState}
                    onChange={(e) => setFormState(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                </div>
                <div>
                  <label htmlFor="add-vendor-pincode" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">Pincode</label>
                  <input
                    id="add-vendor-pincode"
                    type="text"
                    value={formPincode}
                    onChange={(e) => setFormPincode(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="add-vendor-gstin" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">GSTIN</label>
                <input
                  id="add-vendor-gstin"
                  type="text"
                  value={formGst}
                  onChange={(e) => setFormGst(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  disabled={isSubmittingAdd}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdd}
                  data-testid="submit-add-vendor"
                  className="btn btn-primary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmittingAdd ? 'Adding…' : 'Add Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BULK UPLOAD VENDORS MODAL — same real POST /api/vendors/bulk-import path */}
      {/* the category manager uses, scoped server-side to this buyer's own      */}
      {/* private roster (buyerId/addedByBuyerCompany, source 'buyer_excel')     */}
      {/* rather than the shared Procucev network.                              */}
      {/* ========================================================================= */}
      <VendorUploadModal isOpen={bulkUploadModalOpen} onClose={() => setBulkUploadModalOpen(false)} />

      {/* ========================================================================= */}
      {/* EDIT VENDOR MODAL */}
      {/* ========================================================================= */}
      {editModalOpen && selectedVendorForCrud && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-2xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-800 animate-fade-in max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                  <Pencil size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    Edit Vendor Profile
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-normal">
                      {selectedVendorForCrud.id}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Update supplier corporate details, categories, contact information, and compliance records.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditModalOpen(false);
                  setSelectedVendorForCrud(null);
                }}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body Form */}
            <form onSubmit={handleEditVendorSubmit} className="overflow-y-auto my-3 space-y-4 pr-1 text-xs">
              {/* Section 1: Basic Company & Brand Details */}
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <Building2 size={13} className="text-indigo-600" /> 1. Company &amp; Taxonomy Information
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Company Legal Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Brand / Trade Name
                    </label>
                    <input
                      type="text"
                      value={formBrandName}
                      onChange={(e) => setFormBrandName(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Major Category <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={formMajorCategory}
                      onChange={(e) => setFormMajorCategory(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    >
                      {availableMajorCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Rating (1.0 - 5.0)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1.0"
                        max="5.0"
                        step="0.1"
                        value={formRating}
                        onChange={(e) => setFormRating(Number(e.target.value))}
                        className="w-24 text-xs p-2 font-mono font-bold rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                      />
                      <span className="text-amber-500 font-bold flex items-center gap-1">
                        <Star size={13} className="fill-amber-500" /> {formRating} / 5.0
                      </span>
                    </div>
                  </div>
                </div>

                {/* Minor Categories Chips Input */}
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                    Minor Categories &amp; Line Items
                  </label>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Type category and press Add Tag..."
                      value={formMinorInput}
                      onChange={(e) => setFormMinorInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddMinorCategoryTag(formMinorInput);
                        }
                      }}
                      className="flex-1 text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddMinorCategoryTag(formMinorInput)}
                      className="btn btn-secondary btn-xs font-semibold px-3 py-2"
                    >
                      Add Tag
                    </button>
                  </div>
                  {formMinorCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {formMinorCategories.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => handleRemoveMinorCategoryTag(tag)}
                            className="hover:text-rose-500 ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2: Contact & Location */}
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <Mail size={13} className="text-indigo-600" /> 2. Contact &amp; Facility Location
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Contact Person Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formContactPerson}
                      onChange={(e) => setFormContactPerson(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Designation
                    </label>
                    <input
                      type="text"
                      value={formContactDesignation}
                      onChange={(e) => setFormContactDesignation(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Official Email Address <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Phone / Mobile Number <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Factory / Office Address &amp; Location
                    </label>
                    <input
                      type="text"
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">City</label>
                    <input
                      type="text"
                      value={formCity}
                      onChange={(e) => setFormCity(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">State</label>
                    <input
                      type="text"
                      value={formState}
                      onChange={(e) => setFormState(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">Pincode</label>
                    <input
                      type="text"
                      value={formPincode}
                      onChange={(e) => setFormPincode(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">Country</label>
                    <input
                      type="text"
                      value={formCountry}
                      onChange={(e) => setFormCountry(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Statutory & Commercial Identifiers */}
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <FileText size={13} className="text-indigo-600" /> 3. Statutory &amp; Commercial Identifiers
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      GSTIN Number
                    </label>
                    <input
                      type="text"
                      value={formGst}
                      onChange={(e) => setFormGst(e.target.value)}
                      className="w-full text-xs p-2 font-mono uppercase rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      PAN Card Number
                    </label>
                    <input
                      type="text"
                      value={formPan}
                      onChange={(e) => setFormPan(e.target.value)}
                      className="w-full text-xs p-2 font-mono uppercase rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      MSME / UDYAM Reg. Number
                    </label>
                    <input
                      type="text"
                      value={formMsme}
                      onChange={(e) => setFormMsme(e.target.value)}
                      className="w-full text-xs p-2 font-mono rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
                      Annual Turnover
                    </label>
                    <input
                      type="text"
                      value={formAnnualTurnover}
                      onChange={(e) => setFormAnnualTurnover(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => {
                    setEditModalOpen(false);
                    setSelectedVendorForCrud(null);
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm font-bold flex items-center gap-1.5 shadow-md"
                >
                  <Check size={14} /> Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW VENDOR DETAILS / PROFILE MODAL */}
      {/* ========================================================================= */}
      {viewModalOpen && selectedVendorForCrud && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-2xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-indigo-200 dark:border-indigo-800 animate-fade-in max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                  <Building2 size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    {selectedVendorForCrud.name}
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-normal">
                      {selectedVendorForCrud.id}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Comprehensive supplier registration, compliance, and taxonomy profile.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setViewModalOpen(false);
                  setSelectedVendorForCrud(null);
                }}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto my-3 space-y-4 pr-1 text-xs">
              {/* Score & Key Highlights Bar */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50/50 dark:from-indigo-950/40 dark:to-purple-950/30 border border-indigo-200/60 dark:border-indigo-800/50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Rating</span>
                  <div className="font-extrabold text-amber-600 text-sm mt-0.5 flex items-center justify-center gap-1">
                    <Star size={13} className="fill-amber-500 text-amber-500" />
                    {selectedVendorForCrud.rating || 4.5} / 5.0
                  </div>
                </div>

                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Mode 3 AI Score</span>
                  <div className="font-extrabold font-mono text-indigo-600 text-sm mt-0.5">
                    {selectedVendorForCrud.score || 88}%
                  </div>
                </div>

                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Status</span>
                  <div className="font-bold text-[10.5px] text-emerald-600 dark:text-emerald-400 mt-0.5 truncate">
                    {selectedVendorForCrud.status || 'PREFERRED'}
                  </div>
                </div>

                <div className="p-2 bg-white dark:bg-gray-900 rounded-lg border border-slate-200 dark:border-gray-800">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Roster Origin</span>
                  <div className="font-bold text-[10.5px] text-slate-700 dark:text-gray-300 mt-0.5 truncate">
                    {isBuyerUploaded(selectedVendorForCrud) ? 'Buyer Uploaded' : 'Procucev Network'}
                  </div>
                </div>
              </div>

              {/* Taxonomy Details */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <Layers size={13} className="text-indigo-600" /> Procurement Taxonomy &amp; Products
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700 dark:text-gray-300">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Major Category:</span>
                    <strong className="text-slate-900 dark:text-white">
                      {selectedVendorForCrud.majorCategory || 'General Industrial'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Minor Line Items:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedVendorForCrud.minorCategories && selectedVendorForCrud.minorCategories.length > 0 ? (
                        selectedVendorForCrud.minorCategories.map((m: string) => (
                          <span
                            key={m}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50"
                          >
                            {m}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400 italic">No specific minors tagged</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact & Facility Address */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <MapPin size={13} className="text-indigo-600" /> Contact &amp; Facility Information
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700 dark:text-gray-300">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Primary Contact Person:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {selectedVendorForCrud.contactPerson || 'N/A'}
                    </span>
                    {selectedVendorForCrud.contactDesignation && (
                      <span className="block text-[10px] text-slate-500">
                        ({selectedVendorForCrud.contactDesignation})
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Official Email:</span>
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">
                      {selectedVendorForCrud.email}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Phone / Mobile:</span>
                    <span>{selectedVendorForCrud.phone || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold">Location / Address:</span>
                    <span>
                      {selectedVendorForCrud.location ||
                        `${selectedVendorForCrud.city || ''}, ${selectedVendorForCrud.state || ''} ${
                          selectedVendorForCrud.country || 'India'
                        }`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Statutory & Financial Compliance */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block flex items-center gap-1.5">
                  <FileCheck size={13} className="text-indigo-600" /> Statutory &amp; Financial Registration
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-700 dark:text-gray-300 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-400 font-sans block text-[10px] font-semibold">GSTIN:</span>
                    <strong>{selectedVendorForCrud.gst || selectedVendorForCrud.gstin || '27AAACD1234F1Z5'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans block text-[10px] font-semibold">PAN:</span>
                    <strong>{selectedVendorForCrud.pan || 'AAACD1234F'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans block text-[10px] font-semibold">MSME / UDYAM:</span>
                    <span>{selectedVendorForCrud.msme || 'UDYAM-MH-0123'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans block text-[10px] font-semibold">Turnover:</span>
                    <span className="font-sans font-semibold">
                      {selectedVendorForCrud.annualTurnover || '₹25 Cr - ₹50 Cr'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Latest Rating Revision History if any */}
              {selectedVendorForCrud.latestRatingRevision && (
                <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 space-y-1.5">
                  <div className="flex items-center justify-between text-amber-900 dark:text-amber-300 font-bold">
                    <span className="flex items-center gap-1.5">
                      <Star size={13} className="fill-amber-500 text-amber-500" /> Latest Rating Revision
                    </span>
                    <span className="text-[10px] font-normal text-slate-500">
                      {selectedVendorForCrud.latestRatingRevision.timestamp}
                    </span>
                  </div>
                  <p className="italic text-slate-700 dark:text-gray-300">
                    &ldquo;{selectedVendorForCrud.latestRatingRevision.remarks}&rdquo;
                  </p>
                  <div className="flex items-center gap-3 text-[10px] text-slate-600 dark:text-gray-400 pt-1">
                    <span>Quality: {selectedVendorForCrud.latestRatingRevision.qualityScore}</span>
                    <span>Cost: {selectedVendorForCrud.latestRatingRevision.costScore}</span>
                    <span>Delivery: {selectedVendorForCrud.latestRatingRevision.deliveryScore}</span>
                    <span className="font-bold text-amber-700 dark:text-amber-400">
                      → Rating: {selectedVendorForCrud.latestRatingRevision.newRating} ★
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setViewModalOpen(false);
                  handleOpenEditModal(selectedVendorForCrud);
                }}
                className="btn btn-secondary btn-sm font-semibold flex items-center gap-1.5"
              >
                <Pencil size={13} /> Edit Profile
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewModalOpen(false);
                  setSelectedVendorForCrud(null);
                }}
                className="btn btn-primary btn-sm font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE VENDOR CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {deleteModalOpen && selectedVendorForCrud && (
        <div className="modal-overlay !z-[1100]">
          <div className="modal-content max-w-md p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-rose-200 dark:border-rose-900/60 animate-fade-in flex flex-col">
            <div className="flex items-start gap-3 pb-3 border-b border-slate-200 dark:border-gray-800">
              <div className="p-3 rounded-full bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 shrink-0">
                <Trash2 size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete Vendor Record</h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                  Are you sure you want to delete <strong>{selectedVendorForCrud.name}</strong> from your vendor directory?
                </p>
              </div>
            </div>

            <div className="my-4 p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-[11px] text-rose-800 dark:text-rose-300">
              <p>
                This action will permanently delete supplier ID <strong>{selectedVendorForCrud.id}</strong> (
                {selectedVendorForCrud.email}) from your private buyer master list and synchronised database records.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalOpen(false);
                  setSelectedVendorForCrud(null);
                }}
                className="btn btn-ghost btn-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteVendorConfirm}
                className="btn btn-rose btn-sm font-bold flex items-center gap-1.5 shadow-md bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl"
              >
                <Trash2 size={13} /> Delete Vendor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BUYER VENDOR RATING REVISION MODAL */}
      {/* ========================================================================= */}
      {selectedVendorForRevision &&
        (() => {
          const vendor = selectedVendorForRevision;
          const previousScore = vendor.score || (vendor.rating ? Math.round(vendor.rating * 20) : 88);
          const previousRating = vendor.rating || Number((previousScore / 20).toFixed(1));
          const buyerAverage = Math.round((Number(qualityScore) + Number(costScore) + Number(deliveryScore)) / 3);
          const newCompositeScore = Math.round((previousScore + buyerAverage) / 2);
          const newRating = Number((newCompositeScore / 20).toFixed(1));
          const buyerCompany = activeBuyerAccount?.organizationName || 'Larsen & Toubro Limited';

          return (
            <div className="modal-overlay !z-[1100]">
              <div className="modal-content max-w-xl p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-amber-300 dark:border-amber-500/40 animate-fade-in max-h-[92vh] flex flex-col">
                {/* Modal Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-600/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
                      <Star size={22} className="fill-amber-500 text-amber-500" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        Revise Supplier Performance Rating
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-gray-400">
                        Submit operational ratings &amp; feedback for <strong>{vendor.name}</strong>.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedVendorForRevision(null)}
                    className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Modal Body Form */}
                <form onSubmit={handleSaveRatingRevision} className="overflow-y-auto my-3 space-y-4 pr-1 text-xs">
                  {/* Vendor & Buyer Context Bar */}
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Supplier</span>
                      <strong className="text-slate-800 dark:text-gray-200">{vendor.name}</strong>
                      <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">{vendor.email}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Reviewing Buyer</span>
                      <strong className="text-slate-800 dark:text-gray-200">{buyerCompany}</strong>
                      <div className="text-[10px] text-slate-500 font-mono">
                        Current: {previousRating} ★ ({previousScore}%)
                      </div>
                    </div>
                  </div>

                  {/* Performance Criteria Inputs (Quality, Cost, Delivery against 100) */}
                  <div className="space-y-3.5 p-4 rounded-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-gray-300 block">
                      1. Enter Performance Scores (0 to 100 Scale)
                    </span>

                    {/* Quality Score */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 dark:text-gray-200">
                          Quality Compliance &amp; Specs adherence:
                        </span>
                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded border border-indigo-200">
                          {qualityScore} / 100
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={qualityScore}
                          onChange={(e) => setQualityScore(Number(e.target.value))}
                          className="w-full accent-indigo-600"
                        />
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={qualityScore}
                          onChange={(e) => setQualityScore(Math.min(100, Math.max(0, Number(e.target.value))))}
                          className="w-16 text-center font-mono font-bold text-xs py-1 px-2 rounded-lg border border-slate-200 dark:border-gray-800"
                        />
                      </div>
                    </div>

                    {/* Cost Score */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 dark:text-gray-200">
                          Cost Competitiveness &amp; Pricing Fairness:
                        </span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200">
                          {costScore} / 100
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={costScore}
                          onChange={(e) => setCostScore(Number(e.target.value))}
                          className="w-full accent-emerald-600"
                        />
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={costScore}
                          onChange={(e) => setCostScore(Math.min(100, Math.max(0, Number(e.target.value))))}
                          className="w-16 text-center font-mono font-bold text-xs py-1 px-2 rounded-lg border border-slate-200 dark:border-gray-800"
                        />
                      </div>
                    </div>

                    {/* Delivery Score */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 dark:text-gray-200">
                          Delivery Timeliness &amp; OTIF Lead Time:
                        </span>
                        <span className="font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded border border-amber-200">
                          {deliveryScore} / 100
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={deliveryScore}
                          onChange={(e) => setDeliveryScore(Number(e.target.value))}
                          className="w-full accent-amber-600"
                        />
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={deliveryScore}
                          onChange={(e) => setDeliveryScore(Math.min(100, Math.max(0, Number(e.target.value))))}
                          className="w-16 text-center font-mono font-bold text-xs py-1 px-2 rounded-lg border border-slate-200 dark:border-gray-800"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Two-Tier Average Formula Preview Box */}
                  <div className="p-3.5 rounded-xl bg-gradient-to-r from-slate-50 to-indigo-50/50 dark:from-gray-950 dark:to-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 space-y-2 text-[11px]">
                    <div className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center justify-between">
                      <span>2. Rating Calculation Preview:</span>
                      <span className="font-mono text-[10px]">Avg(Q,C,D) → Avg(Prev, BuyerAvg)</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                        <span className="text-[9.5px] text-slate-400 block uppercase">Buyer Input Avg</span>
                        <div className="font-bold font-mono text-indigo-600 text-xs mt-0.5">{buyerAverage}%</div>
                        <span className="text-[9px] text-slate-400">
                          ({qualityScore}+{costScore}+{deliveryScore})/3
                        </span>
                      </div>
                      <div className="p-2 rounded bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800">
                        <span className="text-[9.5px] text-slate-400 block uppercase">Actual Previous</span>
                        <div className="font-bold font-mono text-slate-700 dark:text-gray-300 text-xs mt-0.5">
                          {previousScore}%
                        </div>
                        <span className="text-[9px] text-slate-400">{previousRating} ★</span>
                      </div>
                      <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800">
                        <span className="text-[9.5px] text-emerald-700 dark:text-emerald-300 font-bold block uppercase">
                          New Composite
                        </span>
                        <div className="font-extrabold font-mono text-emerald-700 dark:text-emerald-300 text-sm mt-0.5">
                          {newRating} ★
                        </div>
                        <span className="text-[9px] text-emerald-600 font-bold">{newCompositeScore}% Score</span>
                      </div>
                    </div>
                  </div>

                  {/* Remarks & Accolades Textarea */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-800 dark:text-gray-200 flex items-center justify-between">
                      <span>
                        3. Remarks / Accolades / Performance Notes <span className="text-rose-500">*</span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">Shared directly with vendor</span>
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Describe specific delivery delays, quality rejection rates, pricing negotiations, or exceptional accolades for this vendor..."
                      className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950"
                    />
                  </div>

                  {/* Mandatory Transparency Notice to Buyer */}
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-800/80 text-[10.5px] text-amber-900 dark:text-amber-200 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                      <AlertCircle size={13} className="shrink-0 text-amber-600" />
                      <span>MANDATORY BUYER TRANSPARENCY NOTICE:</span>
                    </div>
                    <p className="leading-relaxed text-slate-700 dark:text-gray-300">
                      These revised ratings (Quality: {qualityScore}, Cost: {costScore}, Delivery: {deliveryScore}) and
                      your remarks will be <strong>officially emailed to {vendor.email}</strong>. Once submitted, the new
                      aggregate rating ({newRating} ★) will update the platform master directory and will be{' '}
                      <strong>visible to all other enterprise buyers</strong>.
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-gray-800">
                    <button
                      type="button"
                      onClick={() => setSelectedVendorForRevision(null)}
                      className="btn btn-ghost btn-sm"
                      disabled={isSubmittingRevision}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-amber btn-sm font-bold flex items-center gap-1.5 shadow-md"
                      disabled={isSubmittingRevision}
                    >
                      <Send size={13} /> {isSubmittingRevision ? 'Submitting...' : 'Submit Revision & Dispatch Email'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
