'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';
import { authClient } from '@/lib/authClient';
import { rfqAttachmentUrl } from '@/lib/rfqClient';
import { SubscriptionPaymentModal } from '@/app/components/Modals';
import { VendorOpportunity } from '@/lib/types';
import {
  Truck,
  ShieldCheck,
  Star,
  Clock,
  AlertTriangle,
  Send,
  Building,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Zap,
  Mail,
  Search,
  Sparkles,
  Package,
  ArrowRight,
} from 'lucide-react';

interface OpportunityFeedProps {
  onNavigateToBidForm: (opp: VendorOpportunity) => void;
  onNavigateToEvaluation?: () => void;
  onNavigateToSubscription?: () => void;
}

export default function OpportunityFeed({
  onNavigateToBidForm,
  onNavigateToEvaluation,
  onNavigateToSubscription,
}: OpportunityFeedProps) {
  const router = useRouter();
  const {
    vendorOpportunities,
    showToast,
    addAuditLog,
    vendorSubscription,
    updateVendorSubscription,
    vendorRfqDownloadsUsed,
    vendorCatalogue,
    vendorSelfEvaluationCompleted,
    vendorSelfEvaluationScore,
    isVendorEvaluationFeeWaived,
    buyerVendors,
    currentUserSession,
    refreshFromDB,
    createVendorPaymentLink,
  } = useApp();
  const vendorLabel = currentUserSession?.orgName || currentUserSession?.name || 'Vendor';

  const [showUpgradeModal, setShowUpgradeModal] = React.useState(false);
  const openUpgradeModal = () => setShowUpgradeModal(true);
  const closeUpgradeModal = () => setShowUpgradeModal(false);

  // This vendor's own real registered category — used to flag a genuine
  // category match against an RFQ's real category (opp.majorCategory/
  // minorCategory), replacing a badge that used to fire off two hardcoded
  // strings ('Pumps & Valves' / 'Mechanical & Fluid Equipment') regardless
  // of what the vendor or the RFQ were actually categorised as.
  const [myMajorCategory, setMyMajorCategory] = React.useState<string>('');
  const [myMinorCategories, setMyMinorCategories] = React.useState<string[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    const email = currentUserSession?.email;
    if (!email) return;
    fetch(`/api/vendors/${encodeURIComponent(email)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.success || !data.data) return;
        setMyMajorCategory(data.data.majorCategory || '');
        setMyMinorCategories(Array.isArray(data.data.minorCategories) ? data.data.minorCategories : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentUserSession?.email]);
  const isRealCategoryMatch = (opp: VendorOpportunity) => {
    if (!myMajorCategory) return false;
    const normalize = (s: string) => s.trim().toLowerCase();
    if (opp.majorCategory && normalize(opp.majorCategory) === normalize(myMajorCategory)) return true;
    return !!opp.minorCategory && myMinorCategories.some((m) => normalize(m) === normalize(opp.minorCategory));
  };

  // 1. Direct Invitations Filter States
  const [selectedBuyerDirect, setSelectedBuyerDirect] = React.useState('all');
  const [selectedMajorCategoryDirect, setSelectedMajorCategoryDirect] = React.useState('all');
  const [selectedMinorCategoryDirect, setSelectedMinorCategoryDirect] = React.useState('all');
  const [rfqSearchTermDirect, setRfqSearchTermDirect] = React.useState('');
  const [filterCatalogueMatchesDirect, setFilterCatalogueMatchesDirect] = React.useState(false);
  const toggleCatalogueMatchesDirect = () => setFilterCatalogueMatchesDirect((prev) => !prev);
  const handleBuyerChangeDirect = (e: React.ChangeEvent<HTMLSelectElement>) => setSelectedBuyerDirect(e.target.value);
  const handleMajorCategoryDirect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMajorCategoryDirect(e.target.value);
    setSelectedMinorCategoryDirect('all');
  };
  const handleMinorCategoryDirect = (e: React.ChangeEvent<HTMLSelectElement>) => setSelectedMinorCategoryDirect(e.target.value);
  const handleSearchDirect = (e: React.ChangeEvent<HTMLInputElement>) => setRfqSearchTermDirect(e.target.value);

  const renderBuyerOption = (buyer: string) => (
    <option key={buyer} value={buyer}>
      🏢 {buyer}
    </option>
  );

  // The RFQs this vendor has not quoted on yet, which is what the reminder banner
  // is about. `pending_bid` is set by the store when an RFQ carries no quotes.
  const pendingBidOpportunities = vendorOpportunities.filter((opp) => opp.status === 'pending_bid');
  const pendingBidCount = pendingBidOpportunities.length;
  const pendingBidOpportunity = pendingBidOpportunities[0];

  const handleDirectReminderBid = () => {
    onNavigateToBidForm(pendingBidOpportunity);
  };

  // 2. Open Network Marketplace Filter States (Buyers list removed as they are not applicable here)
  const [selectedMajorCategoryNet, setSelectedMajorCategoryNet] = React.useState('all');
  const [selectedMinorCategoryNet, setSelectedMinorCategoryNet] = React.useState('all');
  const [rfqSearchTermNet, setRfqSearchTermNet] = React.useState('');
  const [filterCatalogueMatchesNet, setFilterCatalogueMatchesNet] = React.useState(false);
  const toggleCatalogueMatchesNet = () => setFilterCatalogueMatchesNet((prev) => !prev);
  const handleMajorCategoryNet = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMajorCategoryNet(e.target.value);
    setSelectedMinorCategoryNet('all');
  };
  const handleMinorCategoryNet = (e: React.ChangeEvent<HTMLSelectElement>) => setSelectedMinorCategoryNet(e.target.value);
  const handleSearchNet = (e: React.ChangeEvent<HTMLInputElement>) => setRfqSearchTermNet(e.target.value);

  // Helper to map RFQs to Major and Minor Sourcing categories dynamically
  const getOpportunityCategories = (opp: VendorOpportunity) => {
    const title = opp.title.toLowerCase();
    if (title.includes('pump') || title.includes('valve')) {
      return { major: 'Mechanical & Fluid Equipment', minor: 'Pumps & Valves' };
    }
    if (title.includes('hvac') || title.includes('control')) {
      return { major: 'Building & Infrastructure', minor: 'Building Automation & HVAC' };
    }
    return { major: 'Mechanical & Fluid Equipment', minor: 'Structural Steel & Beams' };
  };

  // Was a hardcoded list of 4 specific RFQ numbers standing in for "this
  // vendor's own buyer roster" — direct-vs-marketplace now reflects the real
  // relationship: this vendor's real addedByBuyerCompany against the RFQ's
  // real buyerAccountName (the same real fields the backend's own quota
  // enforcement in GET /api/rfqs/:id/email-preview checks).
  const myVendorRecord = buyerVendors.find((v) => v.email?.toLowerCase() === currentUserSession?.email?.toLowerCase());
  const isOwnBuyerRfq = (opp: VendorOpportunity) => {
    return !!myVendorRecord?.addedByBuyerCompany && myVendorRecord.addedByBuyerCompany === opp.buyer;
  };

  const handleDownloadRfq = async (opp: VendorOpportunity) => {
    const isDirect = isOwnBuyerRfq(opp);

    // Instant client-side feedback for the obviously-blocked cases — the
    // backend is the real authority below and enforces this regardless.
    if (vendorSubscription === 'premium' && !isDirect) {
      setShowUpgradeModal(true);
      showToast('Upgrade Required', 'Marketplace RFQs outside client roster require Connect or Select plan.', 'info');
      return;
    }

    if (vendorSubscription === 'connect' && vendorRfqDownloadsUsed >= 50 && !isDirect) {
      setShowUpgradeModal(true);
      showToast('Quarterly Quota Reached', '50 RFQ download limit reached.', 'warning');
      return;
    }

    if (vendorSubscription === 'select' && vendorRfqDownloadsUsed >= 100 && !isDirect) {
      setShowUpgradeModal(true);
      showToast('Quarterly Quota Reached', '100 RFQ download limit reached.', 'warning');
      return;
    }

    // Was a no-op fake toast with no backend call at all, and the fetch it
    // did make had no Authorization header at all (this route requires
    // authentication — it would 401 for real). Now calls the real,
    // authenticated email-preview endpoint, which enforces the vendor's
    // download quota server-side too — the checks above are just UX, not
    // the actual gate. Refreshes from the DB afterward so the quota shown
    // reflects what the server actually counted, not a local guess.
    const authHeaders = {
      'Content-Type': 'application/json',
      ...(authClient.getToken() ? { Authorization: `Bearer ${authClient.getToken()}` } : {}),
    };
    try {
      const res = await fetch(`/api/rfqs/${encodeURIComponent(opp.rfqNumber)}/email-preview`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not generate the RFQ specification.');
      }

      // The RFQ text info as a real downloaded file, not just a toast
      // claiming an email was sent — a vendor without inbox access to that
      // address previously had no way to actually see it.
      const htmlBody: string = data.data?.htmlBody || '';
      const specUrl = URL.createObjectURL(new Blob([htmlBody], { type: 'text/html' }));
      const specLink = document.createElement('a');
      specLink.href = specUrl;
      specLink.download = `${opp.rfqNumber}-specification.html`;
      document.body.appendChild(specLink);
      specLink.click();
      specLink.remove();
      URL.revokeObjectURL(specUrl);

      // Supporting documents the buyer attached, scoped server-side the
      // same way as the vendor RFQ details page (canAccessRfq /
      // vendorCoversRFQ), so this only returns attachments this vendor can
      // already see.
      try {
        const rfqRes = await fetch(`/api/rfqs/${encodeURIComponent(opp.rfqNumber)}`, { headers: authHeaders });
        const rfqData = await rfqRes.json();
        const attachments = rfqRes.ok && rfqData.success ? rfqData.data?.attachments || [] : [];
        for (const file of attachments) {
          const fileRes = await fetch(rfqAttachmentUrl(file.id), { headers: authHeaders });
          if (!fileRes.ok) continue;
          const blob = await fileRes.blob();
          const fileUrl = URL.createObjectURL(blob);
          const fileLink = document.createElement('a');
          fileLink.href = fileUrl;
          fileLink.download = file.fileName || `${opp.rfqNumber}-attachment`;
          document.body.appendChild(fileLink);
          fileLink.click();
          fileLink.remove();
          URL.revokeObjectURL(fileUrl);
        }
      } catch {
        // The specification itself already downloaded; a failure fetching
        // attachments is surfaced by their absence, not a blocking error.
      }

      if (!isDirect) {
        await refreshFromDB();
      }
      showToast('RFQ Downloaded', `Downloaded RFQ specification for ${opp.rfqNumber}.`, 'success');
      addAuditLog(`${vendorLabel} downloaded RFQ specifications for ${opp.rfqNumber}`, opp.rfqNumber, currentUserSession?.email);
    } catch (err: any) {
      showToast('Download Failed', err?.message || 'Could not download the RFQ specification.', 'warning');
    }
  };

  const handleSubscriptionFeeClick = () => {
    if (onNavigateToSubscription) {
      onNavigateToSubscription();
    } else {
      openUpgradeModal();
    }
  };

  // Buyers offered by the direct-invitation filter. Derived from the feed itself,
  // not from the buyer-account directory: an RFQ records the buyer who raised it,
  // and matching that against a directory of organisation names never matched, so
  // picking any company silently emptied the list.
  const directInvitationBuyers = Array.from(
    new Set(
      vendorOpportunities
        .filter((opp) => opp.type === 'direct_invitation' && opp.buyer)
        .map((opp) => opp.buyer)
    )
  );

  // FILTER DIRECT INVITATIONS
  const eligibleDirectOpportunities = vendorOpportunities.filter((opp) => {
    if (opp.type !== 'direct_invitation') return false;
    const cats = getOpportunityCategories(opp);

    // Filter by the buyer who raised the RFQ (Direct)
    if (selectedBuyerDirect !== 'all' && opp.buyer !== selectedBuyerDirect) return false;

    // Filter by categories (Direct)
    const matchMajor = selectedMajorCategoryDirect === 'all' || cats.major === selectedMajorCategoryDirect;
    const matchMinor = selectedMinorCategoryDirect === 'all' || cats.minor === selectedMinorCategoryDirect;
    if (!matchMajor || !matchMinor) return false;

    // Search query matching (Direct)
    if (rfqSearchTermDirect.trim()) {
      const term = rfqSearchTermDirect.toLowerCase();
      const inTitle = opp.title.toLowerCase().includes(term);
      const inRfq = opp.rfqNumber.toLowerCase().includes(term);
      const inLoc = opp.deliveryLocation.toLowerCase().includes(term);
      const inCat = cats.major.toLowerCase().includes(term) || cats.minor.toLowerCase().includes(term);
      let inItems = false;
      if (opp.lineItems) {
        for (let i = 0; i < opp.lineItems.length; i++) {
          if (opp.lineItems[i].description.toLowerCase().includes(term)) {
            inItems = true;
            break;
          }
        }
      }
      if (!inTitle && !inRfq && !inLoc && !inCat && !inItems) return false;
    }

    // Filter by Catalogue Product Matches if summary button clicked
    if (filterCatalogueMatchesDirect && (vendorCatalogue || []).length === 0) {
      return false;
    }

    return true;
  });

  // FILTER NETWORK OPPORTUNITIES (OPEN MARKETPLACE)
  const eligibleNetworkOpportunities = vendorOpportunities.filter((opp) => {
    if (opp.type !== 'network_marketplace') return false;
    const cats = getOpportunityCategories(opp);

    // Filter by categories (Net)
    const matchMajor = selectedMajorCategoryNet === 'all' || cats.major === selectedMajorCategoryNet;
    const matchMinor = selectedMinorCategoryNet === 'all' || cats.minor === selectedMinorCategoryNet;
    if (!matchMinor || !matchMajor) return false;

    // Search query matching (Net)
    if (rfqSearchTermNet.trim()) {
      const term = rfqSearchTermNet.toLowerCase();
      const inTitle = opp.title.toLowerCase().includes(term);
      const inRfq = opp.rfqNumber.toLowerCase().includes(term);
      const inLoc = opp.deliveryLocation.toLowerCase().includes(term);
      const inCat = cats.major.toLowerCase().includes(term) || cats.minor.toLowerCase().includes(term);
      let inItems = false;
      if (opp.lineItems) {
        for (let i = 0; i < opp.lineItems.length; i++) {
          if (opp.lineItems[i].description.toLowerCase().includes(term)) {
            inItems = true;
            break;
          }
        }
      }
      if (!inTitle && !inRfq && !inLoc && !inCat && !inItems) return false;
    }

    // Filter by Catalogue Product Matches if summary button clicked
    if (filterCatalogueMatchesNet && (vendorCatalogue || []).length === 0) {
      return false;
    }

    return true;
  });

  // Total summary counts of RFQs matching vendor's item catalogue
  const directCatalogueMatchesCount = (vendorCatalogue || []).length > 0 ? eligibleDirectOpportunities.length : 0;
  const netCatalogueMatchesCount = (vendorCatalogue || []).length > 0 ? eligibleNetworkOpportunities.length : 0;

  const directInvites = eligibleDirectOpportunities;
  const networkOpps = eligibleNetworkOpportunities;

  const handleUpgradePlan = async (plan: 'premium' | 'connect' | 'select') => {
    const saved = await updateVendorSubscription(plan);
    if (!saved) return;
    setShowUpgradeModal(false);
    showToast(`${plan.toUpperCase()} Plan Activated!`, `Updated vendor subscription to ${plan}.`, 'success');
    addAuditLog(`${vendorLabel} upgraded to ${plan} plan`, undefined, currentUserSession?.email);
  };

  // Connect/Select advertise real $ prices, so — same as vendor-subscription.tsx
  // — they go through the dummy payment gateway rather than flipping the plan
  // for free on click. This modal previously bypassed that gate entirely.
  const [pendingPayment, setPendingPayment] = React.useState<{ planId: 'connect' | 'select'; planName: string; price: string } | null>(null);

  const handleUpgradeClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const plan = e.currentTarget.getAttribute('data-plan') || 'premium';
    if (plan === 'premium') {
      handleUpgradePlan(plan);
      return;
    }
    const planName = plan === 'connect' ? 'Connect Model (50 RFQs / 3 Months)' : 'Select Model (Catalogue & 100 RFQs / 3 Months)';
    const price = plan === 'connect' ? '₹2' : '₹5';
    setPendingPayment({ planId: plan as 'connect' | 'select', planName, price });
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Title & Screen Identification */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Vendor Workspace & Opportunity Feed
            </h1>
            <span className="badge badge-amber font-mono font-bold text-[10px]">⭐ Premium Vendor</span>
          </div>
        </div>
      </div>

      {/* ── TOP OF FIRST SCREEN BANNER: SELF-EVALUATION CALLOUT ── */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900 text-white shadow-xl border-2 border-indigo-400/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-400/20 text-amber-300 flex items-center justify-center font-black shrink-0 text-xl shadow-inner border border-amber-400/30">
            ⭐
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold text-sm sm:text-base text-white">
                Complete 360° AI Self-Evaluation: Get First-Priority RFQs & Multi-Buyer Showcase
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-slate-950 uppercase tracking-wide">
                1st Priority Dispatch
              </span>
            </div>
            <p className="text-xs text-indigo-200/90 mt-1 leading-relaxed">
              Your verified rating will be displayed to new enterprise buyers while submitting RFQs. If sufficient subscribed vendors are not available for a requirement, <strong>evaluated vendors get 1st priority dispatch automatically across all RFQs irrespective of rating!</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onNavigateToEvaluation}
            className="btn btn-amber btn-sm font-black text-xs shadow-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <Sparkles size={13} /> {vendorSelfEvaluationCompleted ? `View AI Rating (${vendorSelfEvaluationScore}%)` : `Start Self-Evaluation (${isVendorEvaluationFeeWaived ? '$0 Free' : '$5'})`}
          </button>
        </div>
      </div>

      {/* Vendor Profile Header Card */}
      <div className="glass-panel p-5 rounded-2xl flex flex-wrap items-center justify-between gap-4 border border-emerald-200 dark:border-emerald-500/30 bg-white dark:bg-gray-900/80 shadow-md">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md">
            <Truck size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Apex Supplies Ltd.</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500 text-white shadow-sm flex items-center gap-1">
                ⭐ Premium Vendor (Client Uploaded)
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/40 flex items-center gap-1">
                <ShieldCheck size={13} /> Verified Supplier
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/40 flex items-center gap-1">
                <Star size={12} className="fill-amber-400 text-amber-400" /> 4.8 / 5.0 Rating
              </span>
              <button
                type="button"
                onClick={onNavigateToSubscription}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 border transition-all hover:scale-105 ${
                  vendorSubscription === 'select'
                    ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/40'
                    : vendorSubscription === 'connect'
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/40'
                    : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 border-slate-200'
                }`}
              >
                {vendorSubscription === 'select' ? '👑 Select Partner' : vendorSubscription === 'connect' ? '🔗 Connect Partner' : '📋 Free Tier'}
              </button>
              {onNavigateToEvaluation && (
                <button
                  type="button"
                  onClick={onNavigateToEvaluation}
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/40 hover:bg-indigo-100"
                >
                  <Sparkles size={11} /> 360° Audit
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
              Vendor ID: <span className="mono text-indigo-600 dark:text-indigo-300 font-semibold">VN-APEX-4920</span> • Primary Category: Heavy Industrial Fluid Dynamics & Valves • Empanelled by <strong>Larsen & Toubro Ltd.</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-center">
            <span className="text-[10px] text-slate-500 dark:text-gray-450 block uppercase">Active Bids</span>
            <span className="text-base font-bold text-slate-900 dark:text-white mono">3 Live</span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-905 border border-slate-200 dark:border-gray-800 text-center">
            <span className="text-[10px] text-slate-500 dark:text-gray-450 block uppercase">Awarded POs</span>
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 mono">14 Contracts</span>
          </div>
        </div>
      </div>

      {/* Automated System Urgent Reminder Banner. Rendered only when there is an
          opportunity to act on, and it names that opportunity: the banner used to
          quote a fixed RFQ number while its button opened whichever RFQ happened
          to be first, which was `undefined` once the feed came from the API. */}
      {pendingBidOpportunity && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-955/45 border border-amber-300 dark:border-amber-500/50 flex items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200 shadow-sm">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <span className="font-bold text-slate-900 dark:text-white">AUTOMATED SYSTEM REMINDER:</span>{' '}
              <span>{pendingBidCount} quotation{pendingBidCount === 1 ? '' : 's'} awaiting your response, starting with <span className="mono font-bold text-slate-900 dark:text-white">{pendingBidOpportunity.rfqNumber}</span>.</span>
            </div>
          </div>
          <button
            onClick={handleDirectReminderBid}
            className="btn btn-amber btn-sm font-bold shrink-0"
          >
            Submit Quote Now
          </button>
        </div>
      )}

      {/* Sourcing Sections: Direct Invitations vs Open Network */}
      <div className="space-y-8">
        {/* ========================================================================= */}
        {/* SECTION 1: DIRECT INVITATIONS (CLIENT EXCLUSIVE POOL) */}
        {/* ========================================================================= */}
        <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                DIRECT INVITATIONS (CLIENT EXCLUSIVE POOL)
              </h3>
            </div>
            <span className="badge badge-blue">{directInvites.length} Targeted RFQs</span>
          </div>

          {/* Independent Filter Area: Direct Invitations */}
          <div className="bg-slate-50/50 dark:bg-gray-950/20 p-4 rounded-xl border border-slate-200/60 dark:border-gray-850 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-bold text-slate-700 dark:text-gray-300">
              <div className="flex items-center gap-1.5">
                <Building size={14} className="text-indigo-500" />
                <span>Direct Exclusive Sourcing Filters:</span>
              </div>

              {/* Bidirectional Cross-Highlight Summary Filter Button */}
              <button
                type="button"
                onClick={toggleCatalogueMatchesDirect}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border shadow-sm cursor-pointer ${
                  filterCatalogueMatchesDirect
                    ? 'bg-violet-600 text-white border-violet-500 ring-2 ring-violet-400/30'
                    : 'bg-violet-50/80 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40 hover:bg-violet-100'
                }`}
                title="Click to filter only RFQs matching items in your vendor catalogue"
              >
                <Package size={13} />
                <span>📦 Summary: {directCatalogueMatchesCount} Catalogue Match{directCatalogueMatchesCount !== 1 ? 'es' : ''}</span>
                {filterCatalogueMatchesDirect ? (
                  <span className="text-[9px] bg-white/25 text-white px-1.5 py-0.25 rounded font-black uppercase">Filtered (Click to show all)</span>
                ) : (
                  <span className="text-[9px] bg-violet-200/60 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200 px-1.5 py-0.25 rounded font-bold">Filter RFQs</span>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
              {/* Raising Buyer Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">
                  {UI_STRINGS.vendorFeed.buyerFilterLabel}
                </span>
                <select
                  value={selectedBuyerDirect}
                  onChange={handleBuyerChangeDirect}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                >
                  <option value="all">{UI_STRINGS.vendorFeed.buyerFilterAll}</option>
                  {directInvitationBuyers.map(renderBuyerOption)}
                </select>
              </div>

              {/* Major Category Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Major Category</span>
                <select
                  value={selectedMajorCategoryDirect}
                  onChange={handleMajorCategoryDirect}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                >
                  <option value="all">🌐 All Major Categories</option>
                  <option value="Mechanical & Fluid Equipment">⚙️ Mechanical & Fluid</option>
                  <option value="Building & Infrastructure">🏢 Building & Infra</option>
                </select>
              </div>

              {/* Minor Category Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Minor Category</span>
                <select
                  value={selectedMinorCategoryDirect}
                  onChange={handleMinorCategoryDirect}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                  disabled={selectedMajorCategoryDirect === 'all'}
                >
                  {selectedMajorCategoryDirect === 'all' ? (
                    <option value="all">Select Major First</option>
                  ) : selectedMajorCategoryDirect === 'Mechanical & Fluid Equipment' ? (
                    <>
                      <option value="all">All Mechanical & Fluid</option>
                      <option value="Pumps & Valves">⚙️ Pumps & Valves</option>
                      <option value="Structural Steel & Beams">🏗️ Structural Steel</option>
                    </>
                  ) : (
                    <>
                      <option value="all">All Building & Infra</option>
                      <option value="Building Automation & HVAC">❄️ HVAC Control</option>
                    </>
                  )}
                </select>
              </div>

              {/* Sourcing Intelligence Search Bar */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-405">Search Specs</span>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-slate-400">
                    <Search size={12} />
                  </span>
                  <input
                    type="text"
                    placeholder="Specs, location, keywords..."
                    value={rfqSearchTermDirect}
                    onChange={handleSearchDirect}
                    className="input pl-7 py-1 text-[11px] w-full bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          {directInvites.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              No matching targeted RFQ invitations found for this selection.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {directInvites.map((opp) => {
                // Kept consistent with the network-opportunities section below
                // (was two contradictory definitions) — 'connect'/'select' are
                // the real marketplace-unlock tiers, not the unreachable
                // 'premium_network'.
                const isLocked = !isOwnBuyerRfq(opp) && vendorSubscription !== 'connect' && vendorSubscription !== 'select';
                const categories = getOpportunityCategories(opp);
                const isCategoryMatch = isRealCategoryMatch(opp);
                const catalogueMatches = vendorCatalogue || [];
                const hasCatalogueMatch = catalogueMatches.length > 0;

                return (
                  <div
                    key={opp.id}
                    className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                      isLocked
                        ? 'bg-slate-100/50 dark:bg-gray-950/20 border-slate-200 dark:border-gray-900 opacity-90'
                        : isCategoryMatch
                        ? 'bg-emerald-50/10 dark:bg-emerald-950/10 border-emerald-300 dark:border-emerald-700/50 hover:border-emerald-500 shadow-sm shadow-emerald-500/5'
                        : 'bg-slate-50 dark:bg-gray-900/90 border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1 flex-wrap gap-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-slate-900 dark:text-white mono text-sm">{opp.rfqNumber}</span>
                          {isCategoryMatch && (
                            <span className="px-1.5 py-0.25 rounded text-[8px] font-black bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 flex items-center gap-0.5 animate-pulse shrink-0">
                              ⚡ Primary Category Match
                            </span>
                          )}
                          {hasCatalogueMatch && (
                            <span
                              className="px-1.5 py-0.25 rounded text-[8px] font-black bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/40 flex items-center gap-0.5 shrink-0"
                              title="Matching products in catalogue"
                            >
                              <Package size={9} /> {catalogueMatches.length} Catalogue Match{catalogueMatches.length > 1 ? 'es' : ''}
                            </span>
                          )}
                        </div>
                        
                        {isLocked ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-250/20 flex items-center gap-0.5">
                            🔒 Premium Locked
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30">
                            Client Exclusive
                          </span>
                        )}
                      </div>
                      
                      <h4 className="text-xs font-bold text-slate-800 dark:text-gray-100">{opp.title}</h4>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">{opp.buyer}</p>
                      
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[9px] bg-slate-100 dark:bg-gray-850 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded border border-slate-200/50 dark:border-gray-800">
                          {categories.major}
                        </span>
                        <span className="text-[9px] bg-slate-100 dark:bg-gray-850 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded border border-slate-200/50 dark:border-gray-800">
                          {categories.minor}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] p-2.5 rounded-lg bg-white dark:bg-gray-955 border border-slate-200 dark:border-gray-800/85 font-bold">
                      <div>
                        <span className="text-slate-400 dark:text-gray-500 block text-[10px]">Deadline</span>
                        <span className="font-bold text-amber-600 dark:text-amber-300 mono flex items-center gap-1">
                          <Clock size={11} /> {opp.deadline}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 dark:text-gray-500 block text-[10px]">Est. Value</span>
                        {opp.estimatedValue ? (
                          <span className="font-bold text-slate-900 dark:text-white mono">{opp.estimatedValue}</span>
                        ) : (
                          <span className="text-[10px] italic text-slate-400 dark:text-gray-500">Not Disclosed</span>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 dark:text-gray-400">
                        Location: <span className="text-slate-800 dark:text-gray-300 font-medium">{opp.deliveryLocation.split('/')[0]}</span>
                      </span>
                      
                      <div className="flex gap-2">
                        {/* View full RFQ details, same data the buyer/CM see */}
                        <button
                          onClick={() => router.push(`/vendor/rfq-details?rfq=${encodeURIComponent(opp.rfqNumber)}`)}
                          className="btn btn-secondary btn-xs p-1.5 flex items-center justify-center gap-1 border border-slate-200 text-slate-700 dark:text-gray-355 hover:border-slate-300"
                          title="View RFQ Details"
                        >
                          <ExternalLink size={12} className="text-indigo-650 dark:text-indigo-400" />
                          <span>View Details</span>
                        </button>
                        {/* Download RFQ on Email */}
                        <button
                          onClick={() => handleDownloadRfq(opp)}
                          className="btn btn-secondary btn-xs p-1.5 flex items-center justify-center gap-1 border border-slate-200 text-slate-700 dark:text-gray-355 hover:border-slate-300"
                          title="Download RFQ Technical BOQ Spreadsheet on Email"
                        >
                          <Mail size={12} className="text-indigo-650 dark:text-indigo-400" />
                          <span>Download RFQ</span>
                        </button>

                        {isLocked && (
                          <button
                            onClick={openUpgradeModal}
                            className="btn btn-amber btn-xs font-bold flex items-center gap-1 py-1.5 px-3 text-[11px]"
                          >
                            <span>🔒 Upgrade</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* MID-SCREEN HIGHLIGHT: 360° AI SELF-EVALUATION & MULTI-BUYER SHOWCASE */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="p-6 sm:p-7 rounded-3xl bg-gradient-to-br from-indigo-50/95 via-purple-50/80 to-amber-50/90 dark:from-indigo-950/70 dark:via-purple-950/50 dark:to-amber-950/50 border-2 border-indigo-300 dark:border-indigo-600/70 shadow-2xl space-y-6 relative overflow-hidden animate-fade-in">
          {/* Ambient Glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
            <div className="space-y-2.5 max-w-2xl">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-3 py-1 rounded-full text-xs font-black bg-indigo-600 text-white uppercase tracking-wider shadow-sm flex items-center gap-1.5">
                  <Star size={13} className="fill-amber-300 text-amber-300" />
                  ⭐ Premium Vendor Showcase & Priority Network
                </span>
                {vendorSelfEvaluationCompleted ? (
                  <span className="px-3 py-1 rounded-full text-xs font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 flex items-center gap-1">
                    <CheckCircle2 size={13} /> Self-Evaluation Certified (Score: {vendorSelfEvaluationScore}%)
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-black bg-amber-400 text-slate-950 uppercase tracking-wide">
                    1st Priority RFQ Status
                  </span>
                )}
              </div>

              <h3 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white leading-tight">
                Complete 360° AI Self-Evaluation: Get First Priority in RFQs & Showcase Rating to New Buyers
              </h3>

              <p className="text-xs sm:text-sm text-slate-600 dark:text-gray-300 leading-relaxed">
                When a buyer uploads your details, you are automatically recognized as a <strong>Premium Vendor</strong> for their private RFQs. Complete your 360° AI Self-Evaluation to unlock automatic first-priority matching and display your quality credentials across all enterprise buyers!
              </p>
            </div>

            {/* Right Pricing Box */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-gray-900 border-2 border-indigo-200 dark:border-indigo-800 shadow-md space-y-2 shrink-0 md:w-64 text-center">
              <span className="text-[10px] uppercase font-black text-indigo-600 dark:text-indigo-400 block tracking-wider">
                Infra & AI Compute Fee
              </span>
              <div className="flex items-baseline justify-center gap-1">
                {isVendorEvaluationFeeWaived ? (
                  <>
                    <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">$0</span>
                    <span className="text-xs font-black text-emerald-700 dark:text-emerald-300 uppercase">FREE (Waived)</span>
                  </>
                ) : (
                  <>
                    <span className="text-3xl font-black text-slate-900 dark:text-white">$5</span>
                    <span className="text-xs text-slate-400 line-through">$25</span>
                    <span className="text-[10px] text-slate-500 font-medium">/ audit</span>
                  </>
                )}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-gray-400 leading-relaxed font-medium">
                {isVendorEvaluationFeeWaived
                  ? `100% Free with your active ${vendorSubscription === 'connect' ? 'Connect' : 'Select'} subscription.`
                  : 'Nominal fee towards cloud infrastructure & AI verification. Cost is $0 with Connect or Select!'}
              </p>
            </div>
          </div>

          {/* 4 Core Benefit Pillars Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 relative z-10 text-xs">
            <div className="p-3.5 rounded-2xl bg-white/90 dark:bg-gray-900/90 border border-indigo-200/80 dark:border-indigo-800/80 shadow-xs space-y-1.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                ⭐
              </div>
              <h4 className="font-black text-slate-900 dark:text-white text-xs">Showcase Rating to New Buyers</h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                Your verified 360° AI rating is displayed directly on buyers&apos; RFQ selection screens while creating new RFQs to prompt direct invitations.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/90 dark:bg-gray-900/90 border border-emerald-200/80 dark:border-emerald-800/80 shadow-xs space-y-1.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                🚀
              </div>
              <h4 className="font-black text-slate-900 dark:text-white text-xs">Automatic 1st Priority Dispatch</h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                If sufficient subscribed vendors are not available for a requirement selected by a buyer, evaluated vendors receive <strong>1st priority dispatch</strong> automatically.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/90 dark:bg-gray-900/90 border border-purple-200/80 dark:border-purple-800/80 shadow-xs space-y-1.5">
              <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
                🛡️
              </div>
              <h4 className="font-black text-slate-900 dark:text-white text-xs">Priority Irrespective of Score</h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                Evaluated vendors are given first priority in all RFQs by the system automatically <strong>irrespective of evaluation rating</strong> compared to non-evaluated suppliers.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/90 dark:bg-gray-900/90 border border-amber-200/80 dark:border-amber-800/80 shadow-xs space-y-1.5">
              <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                🌐
              </div>
              <h4 className="font-black text-slate-900 dark:text-white text-xs">Multi-Buyer Expansion</h4>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">
                Empanelled beyond your primary client (L&amp;T) to receive RFQs from Tata Steel, Reliance Industries, Adani Group, and global buyers.
              </p>
            </div>
          </div>

          {/* Bottom Actions Bar */}
          <div className="pt-4 border-t border-indigo-200/60 dark:border-indigo-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-gray-300 font-medium">
              <Sparkles size={14} className="text-amber-500" />
              <span>Nominal $5 infra fee is completely waived ($0) with Connect or Select subscriptions.</span>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {!isVendorEvaluationFeeWaived && (
                <button
                  type="button"
                  onClick={handleSubscriptionFeeClick}
                  className="btn btn-secondary btn-sm text-xs font-bold"
                >
                  View Connect / Select ($0 Fee)
                </button>
              )}
              <button
                type="button"
                onClick={onNavigateToEvaluation}
                className="btn btn-primary font-bold text-xs py-2.5 px-6 shadow-lg shadow-indigo-600/30 flex items-center gap-2"
              >
                <Sparkles size={14} />
                {vendorSelfEvaluationCompleted ? 'Retake 360° AI Self-Evaluation' : `Start 360° AI Self-Evaluation (${isVendorEvaluationFeeWaived ? '$0 Free' : '$5'})`}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 2: PROCUCEV NETWORK OPPORTUNITIES (OPEN MARKETPLACE) */}
        {/* ========================================================================= */}
        <div className="glass-panel p-5 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Building size={18} className="text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                PROCUCEV NETWORK OPPORTUNITIES (OPEN MARKETPLACE)
              </h3>
            </div>
            <span className="badge badge-emerald">Open Discovery</span>
          </div>

          {/* Independent Filter Area: Network Opportunities / Marketplace (Buyer filter removed as not applicable) */}
          <div className="bg-slate-50/50 dark:bg-gray-950/20 p-4 rounded-xl border border-slate-200/60 dark:border-gray-850 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-bold text-slate-700 dark:text-gray-300">
              <div className="flex items-center gap-1.5">
                <Building size={14} className="text-emerald-500" />
                <span>Open Sourcing Network & Marketplace Filters:</span>
              </div>

              {/* Bidirectional Cross-Highlight Summary Filter Button */}
              <button
                type="button"
                onClick={toggleCatalogueMatchesNet}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border shadow-sm cursor-pointer ${
                  filterCatalogueMatchesNet
                    ? 'bg-violet-600 text-white border-violet-500 ring-2 ring-violet-400/30'
                    : 'bg-violet-50/80 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40 hover:bg-violet-100'
                }`}
                title="Click to filter only marketplace RFQs matching items in your vendor catalogue"
              >
                <Package size={13} />
                <span>📦 Summary: {netCatalogueMatchesCount} Catalogue Match{netCatalogueMatchesCount !== 1 ? 'es' : ''}</span>
                {filterCatalogueMatchesNet ? (
                  <span className="text-[9px] bg-white/25 text-white px-1.5 py-0.25 rounded font-black uppercase">Filtered (Click to show all)</span>
                ) : (
                  <span className="text-[9px] bg-violet-200/60 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200 px-1.5 py-0.25 rounded font-bold">Filter RFQs</span>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
              {/* Major Category Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Major Category</span>
                <select
                  value={selectedMajorCategoryNet}
                  onChange={handleMajorCategoryNet}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                >
                  <option value="all">🌐 All Major Categories</option>
                  <option value="Mechanical & Fluid Equipment">⚙️ Mechanical & Fluid</option>
                  <option value="Building & Infrastructure">🏢 Building & Infra</option>
                </select>
              </div>

              {/* Minor Category Dropdown */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-400">Minor Category</span>
                <select
                  value={selectedMinorCategoryNet}
                  onChange={handleMinorCategoryNet}
                  className="select py-1 px-2.5 bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-gray-200"
                  disabled={selectedMajorCategoryNet === 'all'}
                >
                  {selectedMajorCategoryNet === 'all' ? (
                    <option value="all">Select Major First</option>
                  ) : selectedMajorCategoryNet === 'Mechanical & Fluid Equipment' ? (
                    <>
                      <option value="all">All Mechanical & Fluid</option>
                      <option value="Pumps & Valves">⚙️ Pumps & Valves</option>
                      <option value="Structural Steel & Beams">🏗️ Structural Steel</option>
                    </>
                  ) : (
                    <>
                      <option value="all">All Building & Infra</option>
                      <option value="Building Automation & HVAC">❄️ HVAC Control</option>
                    </>
                  )}
                </select>
              </div>

              {/* Sourcing Intelligence Search Bar */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-bold text-slate-405">Search Specs</span>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-slate-400">
                    <Search size={12} />
                  </span>
                  <input
                    type="text"
                    placeholder="Specs, location, keywords..."
                    value={rfqSearchTermNet}
                    onChange={handleSearchNet}
                    className="input pl-7 py-1 text-[11px] w-full bg-white dark:bg-gray-900 border border-slate-200 rounded-lg font-bold text-slate-850 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {networkOpps.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No matching open network opportunities found for this selection.
              </div>
            ) : (
              networkOpps.map((opp) => {
                const isLocked = !isOwnBuyerRfq(opp) && vendorSubscription !== 'connect' && vendorSubscription !== 'select';
                const categories = getOpportunityCategories(opp);
                const isCategoryMatch = isRealCategoryMatch(opp);
                const catalogueMatches = vendorCatalogue || [];
                const hasCatalogueMatch = catalogueMatches.length > 0;

                return (
                  <div
                    key={opp.id}
                    className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs transition-all ${
                      isLocked
                        ? 'bg-slate-100/50 dark:bg-gray-950/20 border-slate-200 dark:border-gray-900'
                        : isCategoryMatch
                        ? 'bg-emerald-50/10 dark:bg-emerald-950/10 border-emerald-300 dark:border-emerald-700/50 hover:border-emerald-500 shadow-sm shadow-emerald-500/5'
                        : 'bg-slate-50 dark:bg-gray-900/80 border-slate-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-white mono">{opp.rfqNumber}</span>
                        {isCategoryMatch && (
                          <span className="px-1.5 py-0.25 rounded text-[8px] font-black bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 flex items-center gap-0.5 animate-pulse shrink-0">
                            ⚡ Primary Category Match
                          </span>
                        )}
                        {hasCatalogueMatch && (
                          <span
                            className="px-1.5 py-0.25 rounded text-[8px] font-black bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/40 flex items-center gap-0.5 shrink-0"
                            title="Matching products in catalogue"
                          >
                            <Package size={9} /> {catalogueMatches.length} Catalogue Match{catalogueMatches.length > 1 ? 'es' : ''}
                          </span>
                        )}
                        {isLocked ? (
                          <span className="px-1.5 py-0.25 rounded text-[8px] font-extrabold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-250/20 flex items-center gap-0.5">
                            🔒 Premium Locked
                          </span>
                        ) : (
                          <span className="badge badge-purple text-[10px]">Open Network</span>
                        )}
                      </div>
                      
                      <h4 className="font-semibold text-slate-800 dark:text-gray-200 text-xs">{opp.title}</h4>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                        Delivery: <span className="text-slate-700 dark:text-gray-300">{opp.deliveryLocation}</span>{opp.estimatedValue && (<> • Value: <span className="mono text-emerald-600 dark:text-emerald-400 font-bold">{opp.estimatedValue}</span></>)}
                      </p>

                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[9px] bg-slate-100 dark:bg-gray-850 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded border border-slate-200/50 dark:border-gray-850">
                          {categories.major}
                        </span>
                        <span className="text-[9px] bg-slate-100 dark:bg-gray-855 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded border border-slate-200/50 dark:border-gray-855">
                          {categories.minor}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto font-bold text-slate-900 dark:text-white">
                      <div className="text-right text-[11px] text-slate-500 dark:text-gray-450 hidden sm:block">
                        <span>Deadline: {opp.deadline}</span>
                      </div>

                      <div className="flex gap-2">
                        {/* View full RFQ details, same data the buyer/CM see */}
                        <button
                          onClick={() => router.push(`/vendor/rfq-details?rfq=${encodeURIComponent(opp.rfqNumber)}`)}
                          className="btn btn-secondary btn-xs p-1.5 flex items-center justify-center gap-1 border border-slate-200 text-slate-700 dark:text-gray-355 hover:border-slate-300"
                          title="View RFQ Details"
                        >
                          <ExternalLink size={12} className="text-indigo-650 dark:text-indigo-400" />
                          <span>View Details</span>
                        </button>
                        {/* Download RFQ on Email */}
                        <button
                          onClick={() => handleDownloadRfq(opp)}
                          className="btn btn-secondary btn-xs p-1.5 flex items-center justify-center gap-1 border border-slate-200 text-slate-700 dark:text-gray-355 hover:border-slate-300"
                          title="Download RFQ Technical BOQ Spreadsheet on Email"
                        >
                          <Mail size={12} className="text-indigo-650 dark:text-indigo-400" />
                          <span>Download RFQ</span>
                        </button>

                        {isLocked && (
                          <button
                            onClick={openUpgradeModal}
                            className="btn btn-amber btn-xs font-bold flex items-center gap-1 py-1.5 px-3 text-[11px]"
                          >
                            <span>🔒 Upgrade</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* VENDOR PREMIUM SUBSCRIPTION UPGRADE MODAL */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 text-xs text-slate-800 dark:text-gray-250 animate-scale-up">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Zap size={18} className="text-orange-500 animate-pulse" />
                  Upgrade to Premium Sourcing Plan
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  Ingest specifications, download buyer BOQ spreadsheets, and submit quotes.
                </p>
              </div>
              <button
                onClick={closeUpgradeModal}
                className="text-slate-450 hover:text-slate-600 dark:hover:text-white font-extrabold text-sm border-none bg-transparent cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Current Context Alert */}
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-955/40 text-amber-800 dark:text-amber-300 border border-amber-250/20 leading-relaxed">
              ⚠️ <strong>Roster Account Limit</strong>: Your vendor profile was uploaded by <strong>Larsen & Toubro Ltd. (L&T)</strong>. Bidding or downloading technical specs for other buyers is restricted.
            </div>

            {/* Plan Options */}
            <div className="space-y-3">
              {/* Option 1: Premium */}
              <div className={`p-3 rounded-2xl border-2 flex justify-between items-center ${
                vendorSubscription === 'premium' ? 'border-emerald-500 bg-emerald-50/10' : 'border-slate-200 dark:border-gray-800'
              }`}>
                <div>
                  <h4 className="font-extrabold text-slate-900 dark:text-white text-xs">Premium Model (Client Uploaded)</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Free with Buyer Upload. Unlimited direct buyer RFQs.</p>
                </div>
                {vendorSubscription === 'premium' ? (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 rounded">Active</span>
                ) : (
                  <button
                    data-plan="premium"
                    onClick={handleUpgradeClick}
                    className="btn btn-secondary text-[10px] font-bold py-1 px-2.5"
                  >
                    Select
                  </button>
                )}
              </div>

              {/* Option 2: Connect */}
              <div className={`p-3 rounded-2xl border-2 flex justify-between items-center relative ${
                vendorSubscription === 'connect' ? 'border-indigo-500 bg-indigo-50/10' : 'border-indigo-200 dark:border-indigo-900/60'
              }`}>
                <div>
                  <h4 className="font-extrabold text-slate-900 dark:text-white text-xs flex items-center gap-1">
                    Connect Model (₹2 / 3 mo)
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Download up to 50 RFQs in 3 months from Marketplace.</p>
                </div>
                {vendorSubscription === 'connect' ? (
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 dark:bg-indigo-950 px-2 py-0.5 rounded">Active</span>
                ) : (
                  <button
                    data-plan="connect"
                    onClick={handleUpgradeClick}
                    className="btn btn-primary text-[10px] font-bold py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700"
                  >
                    Upgrade
                  </button>
                )}
              </div>

              {/* Option 3: Select */}
              <div className={`p-3 rounded-2xl border-2 flex justify-between items-center relative ${
                vendorSubscription === 'select' ? 'border-purple-500 bg-purple-50/10' : 'border-purple-200 dark:border-purple-900/60'
              }`}>
                <div>
                  <h4 className="font-extrabold text-slate-900 dark:text-white text-xs flex items-center gap-1">
                    Select Model (₹5 / 3 mo)
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Item Catalogue (100 products) + 100 RFQs / 3 months.</p>
                </div>
                {vendorSubscription === 'select' ? (
                  <span className="text-[10px] font-bold text-purple-600 bg-purple-100 dark:bg-purple-950 px-2 py-0.5 rounded">Active</span>
                ) : (
                  <button
                    data-plan="select"
                    onClick={handleUpgradeClick}
                    className="btn btn-primary text-[10px] font-bold py-1 px-2.5 bg-purple-600 hover:bg-purple-700"
                  >
                    Upgrade
                  </button>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
              <button
                onClick={closeUpgradeModal}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <SubscriptionPaymentModal
        isOpen={!!pendingPayment}
        onClose={() => setPendingPayment(null)}
        planId={pendingPayment?.planId || 'connect'}
        planName={pendingPayment?.planName || ''}
        price={pendingPayment?.price || ''}
        createPaymentLink={createVendorPaymentLink}
      />
    </div>
  );
}
