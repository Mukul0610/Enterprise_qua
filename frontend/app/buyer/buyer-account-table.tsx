'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { BuyerAccount, SourcingMode } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import { SOURCING_MODES, formatCurrency } from '@/lib/constants';
import {
  Building2,
  Users,
  Mail,
  Phone,
  Search,
  Plus,
  Download,
  UploadCloud,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  Globe,
  SlidersHorizontal,
  Edit3,
  Trash2,
  X,
  Save,
  Layers,
  MapPin,
  FileCheck,
  RefreshCw,
  Zap,
  Check,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Database,
  Link2,
} from 'lucide-react';

export default function BuyerAccountTable() {
  const {
    buyerAccounts,
    activeBuyerAccount,
    addBuyerAccount,
    updateBuyerAccount,
    deleteBuyerAccount,
    alignActiveBuyerAccount,
    importPublicBuyerDatabase,
    showToast,
    // The category master, read from the database. Empty until it loads, and
    // empty for good if the read failed — there is no bundled copy to fall back
    // to, because a major category selected here becomes this buyer's procurement
    // scope and is used to route RFQs.and
    categoryTaxonomy,
    categoryTaxonomyError,
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'public_system' | 'web_registration' | 'enterprise_sso'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE_VERIFIED' | 'SYNCED_LEGACY' | 'PENDING_ALIGNMENT'>('ALL');

  // Modal States
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [selectedBuyerForEdit, setSelectedBuyerForEdit] = useState<BuyerAccount | null>(null);
  const [isSyncingPublicDb, setIsSyncingPublicDb] = useState(false);

  // Form State for Add / Edit
  const [orgName, setOrgName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [corpEmail, setCorpEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactDesig, setContactDesig] = useState('Procurement Lead');
  const [phone, setPhone] = useState('+91 ');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [cin, setCin] = useState('');
  const [industry, setIndustry] = useState('Heavy Engineering & Manufacturing');
  const [plantLocation, setPlantLocation] = useState('Navi Mumbai Hub, MH');
  const [sourcingMode, setSourcingMode] = useState<SourcingMode>('mode_2');
  const [plan, setPlan] = useState<'free_trial' | 'version_1' | 'version_2' | 'version_3'>('version_2');
  const [freeRfqs, setFreeRfqs] = useState(5);
  const [accountSource, setAccountSource] = useState<'public_system' | 'web_registration' | 'enterprise_sso'>('public_system');
  const [selectedMajors, setSelectedMajors] = useState<string[]>([
    'Engineering Spares - Mechanical',
    'Engineering Spares - Electrical',
    'Civil Works',
  ]);

  const resetForm = () => {
    setOrgName('');
    setBrandName('');
    setCorpEmail('');
    setContactName('');
    setContactDesig('Procurement Lead');
    setPhone('+91 ');
    setGstin('');
    setPan('');
    setCin('');
    setIndustry('Heavy Engineering & Manufacturing');
    setPlantLocation('Navi Mumbai Hub, MH');
    setSourcingMode('mode_2');
    setPlan('version_2');
    setFreeRfqs(5);
    setAccountSource('public_system');
    setSelectedMajors([
      'Engineering Spares - Mechanical',
      'Engineering Spares - Electrical',
      'Civil Works',
    ]);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setAddModalOpen(true);
  };

  const handleOpenEditModal = (buyer: BuyerAccount) => {
    setSelectedBuyerForEdit(buyer);
    setOrgName(buyer.organizationName);
    setBrandName(buyer.brandName || '');
    setCorpEmail(buyer.corporateEmail);
    setContactName(buyer.contactPerson);
    setContactDesig(buyer.contactDesignation || 'Procurement Lead');
    setPhone(buyer.mobileNumber);
    setGstin(buyer.gstin);
    setPan(buyer.panNumber || '');
    setCin(buyer.cinNumber || '');
    setIndustry(buyer.industrySector);
    setPlantLocation(buyer.primaryPlantLocation);
    setSourcingMode(buyer.sourcingMode);
    setPlan(buyer.subscriptionPlan);
    setFreeRfqs(buyer.remainingFreeRFQs);
    setAccountSource(buyer.accountSource);
    setSelectedMajors(buyer.supportedMajorCategories || []);
    setEditModalOpen(true);
  };

  const toggleMajorCategory = (catName: string) => {
    if (selectedMajors.includes(catName)) {
      setSelectedMajors(selectedMajors.filter((c) => c !== catName));
    } else {
      setSelectedMajors([...selectedMajors, catName]);
    }
  };

  const handleAddBuyerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || !corpEmail.trim() || !contactName.trim() || !gstin.trim()) {
      showToast('Validation Error', 'Organization Name, Email, Contact Person, and GSTIN are required.', 'warning');
      return;
    }

    addBuyerAccount({
      organizationName: orgName.trim(),
      brandName: brandName.trim() || orgName.trim(),
      corporateEmail: corpEmail.trim().toLowerCase(),
      contactPerson: contactName.trim(),
      contactDesignation: contactDesig.trim(),
      mobileNumber: phone.trim(),
      gstin: gstin.trim().toUpperCase(),
      panNumber: pan.trim().toUpperCase() || gstin.trim().substring(2, 12).toUpperCase(),
      cinNumber: cin.trim().toUpperCase(),
      industrySector: industry,
      sourcingMode,
      subscriptionPlan: plan,
      remainingFreeRFQs: freeRfqs,
      accountSource,
      status: accountSource === 'public_system' ? 'SYNCED_LEGACY' : 'ACTIVE_VERIFIED',
      primaryPlantLocation: plantLocation.trim(),
      supportedMajorCategories: selectedMajors.length > 0 ? selectedMajors : ['Engineering Spares - Mechanical'],
      supportedMinorCategories: ['Pumps & Accessories', 'Hoses, Valves & Fittings', 'Panels'],
      totalRFQsCreated: 0,
      totalSpend: formatCurrency(0),
    });

    setAddModalOpen(false);
    resetForm();
  };

  const handleEditBuyerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBuyerForEdit) return;

    updateBuyerAccount(selectedBuyerForEdit.id, {
      organizationName: orgName.trim(),
      brandName: brandName.trim(),
      corporateEmail: corpEmail.trim().toLowerCase(),
      contactPerson: contactName.trim(),
      contactDesignation: contactDesig.trim(),
      mobileNumber: phone.trim(),
      gstin: gstin.trim().toUpperCase(),
      panNumber: pan.trim().toUpperCase(),
      cinNumber: cin.trim().toUpperCase(),
      industrySector: industry,
      sourcingMode,
      subscriptionPlan: plan,
      remainingFreeRFQs: freeRfqs,
      primaryPlantLocation: plantLocation.trim(),
      supportedMajorCategories: selectedMajors,
    });

    setEditModalOpen(false);
    setSelectedBuyerForEdit(null);
  };

  const handleBatchSyncPublicDB = () => {
    setIsSyncingPublicDb(true);
    setTimeout(() => {
      const legacyBatch: Omit<BuyerAccount, 'id' | 'syncTimestamp' | 'createdDate'>[] = [
        {
          organizationName: 'Adani Power & Infra Ltd',
          brandName: 'Adani Thermal & Renewable Energy SCM',
          corporateEmail: 'infra.purchase@adani.com',
          contactPerson: 'Sanjay Rawat',
          contactDesignation: 'Head Central Procurement',
          mobileNumber: '+91 98790 33441',
          gstin: '24AAACA3412P1Z3',
          panNumber: 'AAACA3412P',
          cinNumber: 'L40100GJ1996PLC030533',
          industrySector: 'Power Generation & Renewable Energy',
          sourcingMode: 'mode_3',
          subscriptionPlan: 'version_3',
          remainingFreeRFQs: 0,
          accountSource: 'public_system',
          status: 'SYNCED_LEGACY',
          primaryPlantLocation: 'Mundra Mega Power Facility, GJ',
          supportedMajorCategories: ['Engineering Spares - Electrical', 'CAPEX - Equipment & Machinery', 'Civil Works'],
          supportedMinorCategories: ['Transformers', 'Panels', 'Turbines', 'PEB Structure'],
          totalRFQsCreated: 31,
          totalSpend: '₹4.12 Cr',
        },
        {
          organizationName: 'BHEL Heavy Electricals',
          brandName: 'Bharat Heavy Electricals Plant Sourcing',
          corporateEmail: 'procurement@bhel.in',
          contactPerson: 'Alok Sengupta',
          contactDesignation: 'Executive Director (Commercial)',
          mobileNumber: '+91 94120 77890',
          gstin: '05AAACB1209K1Z5',
          panNumber: 'AAACB1209K',
          cinNumber: 'L74899DL1964GOI004281',
          industrySector: 'Heavy Electricals & Power Turbines',
          sourcingMode: 'mode_2',
          subscriptionPlan: 'version_2',
          remainingFreeRFQs: 4,
          accountSource: 'public_system',
          status: 'SYNCED_LEGACY',
          primaryPlantLocation: 'Haridwar Manufacturing Unit, UK',
          supportedMajorCategories: ['Engineering Spares - Electrical', 'Engineering Spares - Mechanical', 'Raw Materials'],
          supportedMinorCategories: ['Panels', 'Motors', 'Circuit Breakers', 'Die Casting'],
          totalRFQsCreated: 18,
          totalSpend: '₹2.80 Cr',
        },
        {
          organizationName: 'Vedanta Resources & SCM',
          brandName: 'Sterlite Copper & Aluminium Division',
          corporateEmail: 'sourcing.metals@vedanta.co.in',
          contactPerson: 'Kavita Chawla',
          contactDesignation: 'VP Supply Chain & Logistics',
          mobileNumber: '+91 98205 11998',
          gstin: '24AAACV1298H1Z8',
          panNumber: 'AAACV1298H',
          cinNumber: 'L13209GA1965PLC000044',
          industrySector: 'Mining & Metallurgy Extraction',
          sourcingMode: 'mode_1',
          subscriptionPlan: 'version_1',
          remainingFreeRFQs: 5,
          accountSource: 'public_system',
          status: 'SYNCED_LEGACY',
          primaryPlantLocation: 'Jharsuguda Smelter Complex, OD',
          supportedMajorCategories: ['Engineering Spares - Mechanical', 'Raw Materials', 'Lubricants, Greases & Oils'],
          supportedMinorCategories: ['Bearings & Accessories', 'Compressors & Accessories', 'Hydraulic Oils'],
          totalRFQsCreated: 8,
          totalSpend: '₹94 L',
        },
      ];

      importPublicBuyerDatabase(legacyBatch);
      setIsSyncingPublicDb(false);
      setSyncModalOpen(false);
    }, 1400);
  };

  const handleExportCSV = () => {
    const headers = 'ID,Organization Name,Brand Name,Email,Contact Person,Phone,GSTIN,PAN,Industry,Sourcing Mode,Plan,Source,Status,Location\n';
    const rows = buyerAccounts
      .map(
        (b) =>
          `"${b.id}","${b.organizationName}","${b.brandName || ''}","${b.corporateEmail}","${b.contactPerson}","${b.mobileNumber}","${b.gstin}","${b.panNumber || ''}","${b.industrySector}","${b.sourcingMode}","${b.subscriptionPlan}","${b.accountSource}","${b.status}","${b.primaryPlantLocation}"`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Public_Buyer_Database_Master_${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Export Complete', 'Buyer master directory exported to CSV.', 'info');
  };

  // Filtered Accounts
  const filteredAccounts = buyerAccounts.filter((b) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      searchTerm === '' ||
      b.organizationName.toLowerCase().includes(q) ||
      (b.brandName || '').toLowerCase().includes(q) ||
      b.contactPerson.toLowerCase().includes(q) ||
      b.corporateEmail.toLowerCase().includes(q) ||
      b.gstin.toLowerCase().includes(q) ||
      b.industrySector.toLowerCase().includes(q) ||
      b.primaryPlantLocation.toLowerCase().includes(q);

    const matchesSource = sourceFilter === 'ALL' || b.accountSource === sourceFilter;
    const matchesStatus = statusFilter === 'ALL' || b.status === statusFilter;

    return matchesSearch && matchesSource && matchesStatus;
  });

  const getSourceBadge = (source: BuyerAccount['accountSource']) => {
    switch (source) {
      case 'public_system':
        return (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1 shrink-0">
            <Database size={10} className="text-amber-600 dark:text-amber-400" />
            <span>Public System (Legacy)</span>
          </span>
        );
      case 'web_registration':
        return (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 shrink-0">
            <Globe size={10} className="text-indigo-600 dark:text-indigo-400" />
            <span>Web Registration</span>
          </span>
        );
      case 'enterprise_sso':
        return (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex items-center gap-1 shrink-0">
            <ShieldCheck size={10} className="text-purple-600 dark:text-purple-400" />
            <span>Enterprise SSO</span>
          </span>
        );
    }
  };

  const getStatusBadge = (status: BuyerAccount['status']) => {
    switch (status) {
      case 'ACTIVE_VERIFIED':
        return <span className="badge badge-emerald">Active & Verified</span>;
      case 'SYNCED_LEGACY':
        return <span className="badge badge-amber">Synced from Public DB</span>;
      case 'PENDING_ALIGNMENT':
        return <span className="badge badge-blue">Pending Alignment</span>;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Integrated Buyer Directory & Public System Database
            </h1>
            <span className="badge badge-purple">Screen 1.7</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Backend master table for adding existing buyer account details, aligning legacy enterprise profiles, and managing sourcing access.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleOpenAddModal} className="btn btn-primary btn-sm font-bold shadow-sm flex items-center gap-1.5">
            <Plus size={14} /> Add Existing Public Buyer
          </button>
          <button onClick={() => setSyncModalOpen(true)} className="btn btn-secondary btn-sm flex items-center gap-1.5 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60">
            <RefreshCw size={13} /> Sync Public DB
          </button>
          <button onClick={handleExportCSV} className="btn btn-secondary btn-sm flex items-center gap-1">
            <Download size={13} /> Export Master
          </button>
        </div>
      </div>

      {/* ── Gateway Health & Sync Banner ── */}
      <div className="glass-panel p-4 rounded-2xl border border-amber-200/50 dark:border-amber-900/40 bg-gradient-to-r from-amber-50/60 via-orange-50/40 to-indigo-50/40 dark:from-amber-950/20 dark:via-orange-950/10 dark:to-indigo-950/20 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Database size={20} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-2">
              <span>Public System Central Database Gateway: Connected</span>
              <span className="live-dot" style={{ width: 6, height: 6 }} />
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                100% In Sync
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
              Buyers can register directly or align existing enterprise profiles from the central public database. Opening backend integration enables seamless 1-click requisitioning across all modes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right hidden sm:block">
            <div className="text-[10px] uppercase font-bold text-slate-400">Current Session Buyer</div>
            <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mono">
              {activeBuyerAccount?.organizationName || 'Larsen & Toubro'}
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI Cards: Master Database Breakdown ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Integrated Buyers */}
        <div className="rounded-2xl p-4 bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between min-h-[110px] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Integrated Buyers</span>
            <Building2 size={16} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-black text-slate-900 dark:text-white mono">{buyerAccounts.length}</span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded">
              {buyerAccounts.filter((b) => b.status === 'ACTIVE_VERIFIED').length} Verified
            </span>
          </div>
          <span className="text-[10px] text-slate-400">Master enterprise client directory</span>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-cyan-500" />
        </div>

        {/* Aligned from Public System */}
        <div className="rounded-2xl p-4 bg-white dark:bg-gray-900/80 border border-amber-200 dark:border-amber-900/50 shadow-xs flex flex-col justify-between min-h-[110px] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Public System Synced</span>
            <Database size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-black text-amber-700 dark:text-amber-300 mono">
              {buyerAccounts.filter((b) => b.accountSource === 'public_system').length}
            </span>
            <span className="text-[10px] text-amber-700 dark:text-amber-300 font-bold bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded">
              {Math.round((buyerAccounts.filter((b) => b.accountSource === 'public_system').length / (buyerAccounts.length || 1)) * 100)}% Legacy
            </span>
          </div>
          <span className="text-[10px] text-slate-400">Aligned from central public database</span>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
        </div>

        {/* Web Registrations */}
        <div className="rounded-2xl p-4 bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between min-h-[110px] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Web Signups / SSO</span>
            <Globe size={16} className="text-sky-600 dark:text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-black text-slate-900 dark:text-white mono">
              {buyerAccounts.filter((b) => b.accountSource !== 'public_system').length}
            </span>
            <span className="text-[10px] text-sky-600 dark:text-cyan-400 font-bold bg-sky-50 dark:bg-cyan-950/60 px-1.5 py-0.5 rounded">
              Portal Onboarded
            </span>
          </div>
          <span className="text-[10px] text-slate-400">New self-registered enterprise buyers</span>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
        </div>

        {/* Active Sourcing Modes */}
        <div className="rounded-2xl p-4 bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between min-h-[110px] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sourcing Mode Split</span>
            <Layers size={16} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
              V1: {buyerAccounts.filter((b) => b.sourcingMode === 'mode_1').length}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-50 dark:bg-cyan-950 text-sky-700 dark:text-cyan-300">
              V2: {buyerAccounts.filter((b) => b.sourcingMode === 'mode_2').length}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
              V3: {buyerAccounts.filter((b) => b.sourcingMode === 'mode_3').length}
            </span>
          </div>
          <span className="text-[10px] text-slate-400">Mode 1 Roster / Mode 2 Hybrid / Mode 3 AI</span>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-indigo-500" />
        </div>
      </div>

      {/* ── Table Controls & Search Filter Toolbar ── */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
            <input
              type="text"
              placeholder="Search by Company Name, Contact Person, Corporate Email, GSTIN, Industry..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="has-leading-icon text-xs w-full"
            />
            {searchTerm && (
              <button aria-label="Clear Search" onClick={() => setSearchTerm('')} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter Group: Source */}
          <div className="flex items-center gap-1 text-xs bg-slate-100 dark:bg-gray-800 p-1 rounded-xl shrink-0 overflow-x-auto">
            <button
              onClick={() => setSourceFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${sourceFilter === 'ALL'
                ? 'bg-white dark:bg-gray-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-gray-400'
                }`}
            >
              All Sources ({buyerAccounts.length})
            </button>
            <button
              onClick={() => setSourceFilter('public_system')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 ${sourceFilter === 'public_system'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-amber-700 dark:text-amber-400'
                }`}
            >
              <Database size={11} /> Public DB ({buyerAccounts.filter((b) => b.accountSource === 'public_system').length})
            </button>
            <button
              onClick={() => setSourceFilter('web_registration')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 ${sourceFilter === 'web_registration'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-gray-400'
                }`}
            >
              <Globe size={11} /> Web ({buyerAccounts.filter((b) => b.accountSource === 'web_registration').length})
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Data Table ── */}
      <div className="rounded-2xl bg-white dark:bg-gray-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[1050px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-gray-800/60 border-b border-slate-200 dark:border-gray-800 text-slate-500 dark:text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3.5 px-4">Organization &amp; Source</th>
                <th className="py-3.5 px-4">Corporate Contact</th>
                <th className="py-3.5 px-4">Tax Identity (GST / PAN)</th>
                <th className="py-3.5 px-4">Sourcing Plan &amp; Mode</th>
                <th className="py-3.5 px-4">Plant Hub &amp; Categories</th>
                <th className="py-3.5 px-4">Sync Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800/60">
              {filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Building2 size={32} className="mx-auto text-slate-300 dark:text-gray-600 mb-2" />
                    <p className="font-bold text-sm">No buyer accounts matching your query.</p>
                    <p className="text-xs mt-1">Try resetting the search filter or click &quot;Add Existing Public Buyer&quot;.</p>
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((buyer) => {
                  const isActiveSession = activeBuyerAccount?.id === buyer.id;
                  const modeObj = SOURCING_MODES.find((m) => m.id === buyer.sourcingMode);

                  return (
                    <tr
                      key={buyer.id}
                      className={`hover:bg-slate-50/80 dark:hover:bg-gray-800/30 transition-colors ${isActiveSession ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''
                        }`}
                    >
                      {/* Col 1: Organization */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white text-xs">{buyer.organizationName}</span>
                            {isActiveSession && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-600 text-white">
                                Active Session
                              </span>
                            )}
                          </div>
                          {buyer.brandName && (
                            <div className="text-[11px] text-slate-500 dark:text-gray-400">{buyer.brandName}</div>
                          )}
                          <div className="flex items-center gap-1.5 pt-0.5">
                            {getSourceBadge(buyer.accountSource)}
                            <span className="text-[9px] mono text-slate-400">{buyer.id}</span>
                          </div>
                        </div>
                      </td>

                      {/* Col 2: Corporate Contact */}
                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-800 dark:text-gray-200">{buyer.contactPerson}</div>
                          {buyer.contactDesignation && (
                            <div className="text-[10px] text-slate-400">{buyer.contactDesignation}</div>
                          )}
                          <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">{buyer.corporateEmail}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{buyer.mobileNumber}</div>
                        </div>
                      </td>

                      {/* Col 3: Tax Identity */}
                      <td className="py-3 px-4">
                        <div className="space-y-1 text-[11px]">
                          <div>
                            <span className="text-[10px] text-slate-400 font-semibold block">GSTIN</span>
                            <span className="mono font-bold text-slate-700 dark:text-gray-300">{buyer.gstin}</span>
                          </div>
                          {buyer.panNumber && (
                            <div>
                              <span className="text-[10px] text-slate-400 font-semibold block">PAN</span>
                              <span className="mono text-slate-600 dark:text-gray-400">{buyer.panNumber}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Col 4: Sourcing Mode & Plan */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide inline-block"
                            style={{
                              backgroundColor: `${modeObj?.badgeColor}15`,
                              color: modeObj?.badgeColor,
                              border: `1px solid ${modeObj?.badgeColor}35`,
                            }}
                          >
                            {modeObj?.code}: {modeObj?.shortLabel}
                          </span>
                          <div className="text-[10px] text-slate-500 dark:text-gray-400 capitalize">
                            Plan: <strong className="text-slate-700 dark:text-gray-300">{buyer.subscriptionPlan.replace('_', ' ')}</strong>
                          </div>
                          {buyer.subscriptionPlan === 'free_trial' && (
                            <div className="text-[9px] text-amber-700 dark:text-amber-300 font-semibold">
                              {buyer.remainingFreeRFQs} of 5 free RFQs (V1/V2/V3)
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Col 5: Plant Hub & Categories */}
                      <td className="py-3 px-4">
                        <div className="space-y-1 max-w-[200px]">
                          <div className="flex items-center gap-1 text-[11px] text-slate-700 dark:text-gray-300 font-medium">
                            <MapPin size={11} className="text-slate-400 shrink-0" />
                            <span className="truncate" title={buyer.primaryPlantLocation}>
                              {buyer.primaryPlantLocation}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Industry: <strong className="text-slate-600 dark:text-gray-300">{buyer.industrySector}</strong>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap pt-0.5">
                            {(buyer.supportedMajorCategories || []).slice(0, 2).map((cat, idx) => (
                              <span key={idx} className="px-1.5 py-0.2 rounded text-[9px] bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300">
                                {cat.replace('Engineering Spares - ', '')}
                              </span>
                            ))}
                            {(buyer.supportedMajorCategories || []).length > 2 && (
                              <span className="text-[9px] text-slate-400 font-bold">
                                +{(buyer.supportedMajorCategories || []).length - 2}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Col 6: Sync Status & Spend */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          {getStatusBadge(buyer.status)}
                          <div className="text-[9px] text-slate-400 mono">Synced: {buyer.syncTimestamp}</div>
                          <div className="text-[10px] text-slate-600 dark:text-gray-400">
                            {buyer.totalRFQsCreated} RFQs • <strong className="text-emerald-600 dark:text-emerald-400">{buyer.totalSpend}</strong>
                          </div>
                        </div>
                      </td>

                      {/* Col 7: Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isActiveSession ? (
                            <button
                              onClick={() => alignActiveBuyerAccount(buyer.id)}
                              className="btn btn-secondary btn-xs font-bold text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-50 flex items-center gap-1"
                              title="Align current workspace session to this buyer account"
                            >
                              <Link2 size={11} /> Align Session
                            </button>
                          ) : (
                            <span className="px-2 py-1 rounded text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                              <Check size={11} /> Aligned
                            </span>
                          )}

                          <button
                            onClick={() => handleOpenEditModal(buyer)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                            title="Edit Account Specifications"
                          >
                            <Edit3 size={13} />
                          </button>

                          <button
                            onClick={() => deleteBuyerAccount(buyer.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                            title="Delete Record"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: ADD EXISTING PUBLIC BUYER ACCOUNT */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {addModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Building2 size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Add / Align Existing Public Buyer Account
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Input existing public system organization credentials and assign sourcing scope.
                  </p>
                </div>
              </div>
              <button aria-label="Close Add Modal" onClick={() => setAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <form noValidate onSubmit={handleAddBuyerSubmit} className="space-y-4 text-xs">
              {/* Row 1: Org Name & Brand */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Organization / Company Legal Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Larsen & Toubro Limited"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="w-full text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Brand / Division Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. L&T Heavy Engineering Division"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>
              </div>

              {/* Row 2: Corporate Email & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Corporate Email ID *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="procurement@company.com"
                    value={corpEmail}
                    onChange={(e) => setCorpEmail(e.target.value)}
                    className="w-full text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Mobile Number (WhatsApp Enabled) *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98201 44820"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full text-xs font-mono"
                  />
                </div>
              </div>

              {/* Row 3: Contact Person & Designation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Contact Person Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rajesh Sharma"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Designation / Title
                  </label>
                  <input
                    type="text"
                    placeholder="Chief Procurement Officer (CPO)"
                    value={contactDesig}
                    onChange={(e) => setContactDesig(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>
              </div>

              {/* Row 4: Statutory GSTIN, PAN, CIN */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    GSTIN Tax Number *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="27AAACL1234F1Z5"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    className="w-full text-xs font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    PAN Number
                  </label>
                  <input
                    type="text"
                    placeholder="AAACL1234F"
                    value={pan}
                    onChange={(e) => setPan(e.target.value)}
                    className="w-full text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Industry Sector
                  </label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full text-xs"
                  >
                    <option value="Heavy Engineering & Manufacturing">Heavy Engineering</option>
                    <option value="EPC & Infrastructure Projects">EPC & Infrastructure</option>
                    <option value="Steel & Metallurgy Manufacturing">Steel & Metallurgy</option>
                    <option value="Automotive & Precision Forging">Automotive & Forging</option>
                    <option value="Power Distribution & Transmission">Power & Energy</option>
                    <option value="Chemical & Petrochemicals">Chemical & Process</option>
                  </select>
                </div>
              </div>

              {/* Row 5: Sourcing Mode, Plan & Account Source */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-gray-800/40 border border-slate-200 dark:border-gray-800">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Sourcing Mode
                  </label>
                  <select
                    value={sourcingMode}
                    onChange={(e) => setSourcingMode(e.target.value as SourcingMode)}
                    className="w-full text-xs"
                  >
                    <option value="mode_1">Mode 1: Client Roster Only</option>
                    <option value="mode_2">Mode 2: Hybrid Sourcing</option>
                    <option value="mode_3">Mode 3: AI Autonomous Sourcing</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Subscription Tier
                  </label>
                  <select
                    value={plan}
                    onChange={(e) => setPlan(e.target.value as any)}
                    className="w-full text-xs"
                  >
                    <option value="free_trial">Free Trial (5 RFQs)</option>
                    <option value="version_1">Version 1 (Mode 1)</option>
                    <option value="version_2">Version 2 (Mode 2)</option>
                    <option value="version_3">Version 3 (Mode 3)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Account Source
                  </label>
                  <select
                    value={accountSource}
                    onChange={(e) => setAccountSource(e.target.value as any)}
                    className="w-full text-xs"
                  >
                    <option value="public_system">Public System Integration</option>
                    <option value="web_registration">Web Direct Signup</option>
                    <option value="enterprise_sso">Enterprise SSO Gateway</option>
                  </select>
                </div>
              </div>

              {/* Major Category Scope Selector */}
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5">
                  Supported Procurement Major Categories:
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto p-2 bg-slate-50 dark:bg-gray-800/40 rounded-xl border border-slate-200 dark:border-gray-800">
                  {categoryTaxonomy.length === 0 && (
                    <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      {categoryTaxonomyError || UI_STRINGS.buyerProfile.taxonomyEmpty}
                    </p>
                  )}
                  {categoryTaxonomy.map((cat) => {
                    const isSelected = selectedMajors.includes(cat.majorCategory);
                    return (
                      <button
                        type="button"
                        key={cat.majorCategory}
                        onClick={() => toggleMajorCategory(cat.majorCategory)}
                        className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all flex items-center gap-1 ${isSelected
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300'
                          }`}
                      >
                        {isSelected && <Check size={10} />}
                        <span>{cat.majorCategory}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary font-bold text-xs flex items-center gap-1.5">
                  <Save size={14} /> Add Buyer to Database
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: SYNC PUBLIC DATABASE BATCH */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {syncModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-500/40 rounded-3xl p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <RefreshCw size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Sync Public System Buyer Database
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Import existing public system buyer accounts directly into this workspace.
                  </p>
                </div>
              </div>
              <button aria-label="Close Sync Modal" onClick={() => setSyncModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-900 dark:text-amber-200 space-y-2">
              <div className="font-bold flex items-center gap-1.5">
                <Database size={14} className="text-amber-600" />
                Live Central Gateway Integration:
              </div>
              <p className="text-[11px] text-slate-600 dark:text-gray-300 leading-relaxed">
                Click below to simulate syncing 3 verified public system buyer accounts (Adani Power, BHEL Electricals, Vedanta Resources) with verified GSTIN, categories, and pre-configured sourcing access.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSyncModalOpen(false)}
                className="btn btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBatchSyncPublicDB}
                disabled={isSyncingPublicDb}
                className="btn btn-primary font-black text-xs flex items-center gap-1.5 bg-gradient-to-r from-amber-600 to-orange-600 text-white"
              >
                {isSyncingPublicDb ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" /> Syncing Central DB...
                  </>
                ) : (
                  <>
                    <Zap size={14} /> Sync 3 Public System Buyers Now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: EDIT BUYER ACCOUNT SPECIFICATIONS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {editModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Edit3 size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Edit Buyer Account Specifications
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Update organization specifications, sourcing tier, and category mapping.
                  </p>
                </div>
              </div>
              <button
                aria-label="Close Edit Modal"
                onClick={() => {
                  setEditModalOpen(false);
                  setSelectedBuyerForEdit(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditBuyerSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Organization Legal Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="w-full text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Brand / Division Name
                  </label>
                  <input
                    type="text"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Corporate Email ID *
                  </label>
                  <input
                    type="email"
                    required
                    value={corpEmail}
                    onChange={(e) => setCorpEmail(e.target.value)}
                    className="w-full text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Mobile Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => {
                    setEditModalOpen(false);
                    setSelectedBuyerForEdit(null);
                  }}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary font-bold text-xs flex items-center gap-1.5">
                  <Save size={14} /> Update Specifications
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
