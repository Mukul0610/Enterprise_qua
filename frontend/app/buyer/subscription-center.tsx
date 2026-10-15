'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { SubscriptionPaymentModal } from '@/app/components/Modals';
import { Sparkles, ShieldCheck, Check, Zap, Calendar, CheckCircle2, Building2, X, Shield, Crown, Gem } from 'lucide-react';

export type BillingDuration = '6_months' | '12_months';

export const PLAN_LABEL: Record<string, string> = {
  version_1: 'Silver Plan',
  version_2: 'Gold Plan',
  version_3: 'Diamond Plan',
};

// Must match the actual GST-inclusive amount Zoho charges
// (computeZohoBuyerPlanAmount in backend/src/config/constants.js), so the
// checkout modal and cards never promise a different amount than what's billed.
// 12-month: ₹4,999/mo (₹59,988 for 12m) + 18% GST = ₹70,785.84.
// 6-month: ₹5,499/mo (₹32,994 for 6m) + 18% GST = ₹38,932.92.
export const BUYER_PRICING: Record<
  BillingDuration,
  Record<
    'version_1' | 'version_2' | 'version_3',
    {
      originalPrice: string;
      price: string;
      amount: number;
      label: string;
      baseDurationLabel: string;
      gstAmount: string;
      totalPriceWithGst: string;
      totalAmountWithGst: number;
    }
  >
> = {
  '12_months': {
    version_1: {
      originalPrice: '₹50,000',
      price: '₹4,999',
      amount: 4999,
      label: 'per month',
      baseDurationLabel: '₹59,988 (₹4,999 × 12 months)',
      gstAmount: '₹10,797.84',
      totalPriceWithGst: '₹70,785.84',
      totalAmountWithGst: 70785.84,
    },
    version_2: {
      originalPrice: '₹75,000',
      price: '₹7,499',
      amount: 7499,
      label: 'per month',
      baseDurationLabel: '₹89,988 (₹7,499 × 12 months)',
      gstAmount: '₹16,197.84',
      totalPriceWithGst: '₹1,06,185.84',
      totalAmountWithGst: 106185.84,
    },
    version_3: {
      originalPrice: '₹1,00,000',
      price: '₹9,999',
      amount: 9999,
      label: 'per month',
      baseDurationLabel: '₹1,19,988 (₹9,999 × 12 months)',
      gstAmount: '₹21,597.84',
      totalPriceWithGst: '₹1,41,585.84',
      totalAmountWithGst: 141585.84,
    },
  },
  '6_months': {
    version_1: {
      originalPrice: '₹50,000',
      price: '₹5,499',
      amount: 5499,
      label: 'per month',
      baseDurationLabel: '₹32,994 (₹5,499 × 6 months)',
      gstAmount: '₹5,938.92',
      totalPriceWithGst: '₹38,932.92',
      totalAmountWithGst: 38932.92,
    },
    version_2: {
      originalPrice: '₹75,000',
      price: '₹7,999',
      amount: 7999,
      label: 'per month',
      baseDurationLabel: '₹47,994 (₹7,999 × 6 months)',
      gstAmount: '₹8,638.92',
      totalPriceWithGst: '₹56,632.92',
      totalAmountWithGst: 56632.92,
    },
    version_3: {
      originalPrice: '₹1,00,000',
      price: '₹10,499',
      amount: 10499,
      label: 'per month',
      baseDurationLabel: '₹62,994 (₹10,499 × 6 months)',
      gstAmount: '₹11,338.92',
      totalPriceWithGst: '₹74,332.92',
      totalAmountWithGst: 74332.92,
    },
  },
};

export default function SubscriptionCenter() {
  const {
    activeSubscription,
    remainingFreeRFQs,
    showToast,
    activeBuyerAccount,
    currentUserSession,
    refreshActiveBuyerAccount,
    createBuyerPaymentLink,
    checkBuyerPaymentLinkStatus,
  } = useApp();

  const [billingDuration, setBillingDuration] = useState<BillingDuration>('12_months');
  const [pendingPayment, setPendingPayment] = useState<{ planId: 'version_1' | 'version_2' | 'version_3' } | null>(null);

  const [isEnterpriseModalOpen, setIsEnterpriseModalOpen] = useState(false);
  const [enterpriseSubmitted, setEnterpriseSubmitted] = useState(false);
  const [enterpriseForm, setEnterpriseForm] = useState({
    companyName: '',
    email: '',
    mobile: '',
  });

  const getAutofillDetails = useCallback(() => {
    const company =
      activeBuyerAccount?.organizationName ||
      activeBuyerAccount?.brandName ||
      currentUserSession?.orgName ||
      '';
    const email =
      activeBuyerAccount?.corporateEmail ||
      currentUserSession?.email ||
      '';
    const mobile =
      (activeBuyerAccount as any)?.mobileNumber ||
      (activeBuyerAccount as any)?.mobile ||
      (activeBuyerAccount as any)?.phone ||
      currentUserSession?.mobile ||
      '';
    return { company, email, mobile };
  }, [activeBuyerAccount, currentUserSession]);

  useEffect(() => {
    const { company, email, mobile } = getAutofillDetails();
    setEnterpriseForm((prev) => ({
      companyName: prev.companyName || company,
      email: prev.email || email,
      mobile: prev.mobile || mobile,
    }));
  }, [getAutofillDetails]);

  const [submittingEnterprise, setSubmittingEnterprise] = useState(false);

  const handleEnterpriseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enterpriseForm.companyName.trim() || !enterpriseForm.email.trim() || !enterpriseForm.mobile.trim()) {
      showToast('Missing Details', 'Please provide Company Name, Email ID, and Mobile Number.', 'warning');
      return;
    }
    setSubmittingEnterprise(true);
    const clientRecord = {
      id: `ent-inq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      companyName: enterpriseForm.companyName.trim(),
      email: enterpriseForm.email.trim(),
      mobile: enterpriseForm.mobile.trim(),
      buyerAccountId: activeBuyerAccount?.id || null,
      notes: '',
      status: 'NEW' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const res = await fetch('/api/enterprise-inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: enterpriseForm.companyName.trim(),
          email: enterpriseForm.email.trim(),
          mobile: enterpriseForm.mobile.trim(),
          buyerAccountId: activeBuyerAccount?.id || null,
        }),
      });
      const json = await res.json().catch(() => null);
      const recordToStore = json?.data || clientRecord;
      try {
        const stored = JSON.parse(localStorage.getItem('procucev_enterprise_inquiries') || '[]');
        const updated = Array.isArray(stored)
          ? [recordToStore, ...stored.filter((i: any) => i.id !== recordToStore.id)]
          : [recordToStore];
        localStorage.setItem('procucev_enterprise_inquiries', JSON.stringify(updated));
      } catch (_) {}
    } catch {
      // Local fallback
      try {
        const stored = JSON.parse(localStorage.getItem('procucev_enterprise_inquiries') || '[]');
        const updated = Array.isArray(stored) ? [clientRecord, ...stored] : [clientRecord];
        localStorage.setItem('procucev_enterprise_inquiries', JSON.stringify(updated));
      } catch (_) {}
    } finally {
      setSubmittingEnterprise(false);
      setEnterpriseSubmitted(true);
      showToast('Enquiry Submitted', 'Our Enterprise Contracts team will reach out to you within 24 hours.', 'success');
    }
  };

  // Zoho redirects the buyer back here to the same URL whether they actually
  // paid or cancelled on its hosted checkout page, so the outcome can't be
  // read off the URL itself — instead it carries the app's own payment-link
  // id (`linkId`), and the real outcome is looked up server-side via
  // checkBuyerPaymentLinkStatus. Activation itself already happened
  // server-side (the webhook, or the reconciliation poller if that's
  // delayed) — this just reflects that real state and re-syncs the buyer's
  // subscriptionPlan.
  const handledPaymentReturnRef = useRef(false);
  useEffect(() => {
    if (handledPaymentReturnRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const linkId = params.get('linkId');
    if (!linkId) return;
    if (!activeBuyerAccount?.id) return; // wait for it to load, retry once it does

    handledPaymentReturnRef.current = true;

    void (async () => {
      const status = await checkBuyerPaymentLinkStatus(linkId);
      if (status === 'PAID') {
        showToast('Payment Received', 'Your subscription has been activated.', 'success');
        void refreshActiveBuyerAccount();
      } else if (status === 'CANCELED') {
        showToast('Payment Cancelled', 'No changes were made to your subscription.', 'info');
      } else if (status === 'EXPIRED') {
        showToast('Payment Link Expired', 'That payment link expired before it was completed. Please try again.', 'warning');
      } else {
        showToast(
          'Payment Processing',
          'We are still confirming your payment — this can take a few moments to reflect here.',
          'info'
        );
        void refreshActiveBuyerAccount();
      }

      params.delete('linkId');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState(null, '', next);
    })();
  }, [activeBuyerAccount?.id, checkBuyerPaymentLinkStatus, refreshActiveBuyerAccount, showToast]);

  const plans = [
    {
      id: 'version_1' as const,
      name: 'Silver Plan',
      subtext: 'Features of Silver (Mode 1)',
      originalPrice: '₹50,000',
      description: 'Streamline procurement across your private pre-approved vendor roster (Mode 1 only) with working-hour multi-channel follow-ups.',
      badge: 'Silver Tier',
      cardStyle: {
        border: 'border-slate-300 dark:border-slate-700/80 hover:border-slate-400 shadow-md shadow-slate-500/5 hover:shadow-slate-500/15 ring-1 ring-slate-200/60 dark:ring-slate-800',
        gradient: 'bg-gradient-to-b from-slate-100/90 via-white to-slate-50/60 dark:from-slate-900/90 dark:via-gray-900 dark:to-gray-900',
        topStrip: 'bg-gradient-to-r from-slate-400 via-slate-200 to-slate-500 dark:from-slate-600 dark:via-slate-300 dark:to-slate-600',
        badge: 'bg-gradient-to-r from-slate-600 via-slate-500 to-slate-700 text-white',
        priceBox: 'bg-gradient-to-br from-slate-100/90 via-slate-50 to-slate-200/60 dark:from-slate-800/60 dark:via-slate-900/70 dark:to-slate-800/40 border-slate-300/80 dark:border-slate-700',
        priceText: 'text-slate-900 dark:text-slate-100',
        strikethroughText: 'text-slate-400 dark:text-slate-500',
        icon: 'Shield' as const,
        iconBg: 'bg-gradient-to-br from-slate-200 via-slate-100 to-slate-300 dark:from-slate-700 dark:to-slate-800 border-slate-300/80 dark:border-slate-600 text-slate-700 dark:text-slate-200',
        iconColor: 'text-slate-700 dark:text-slate-300',
        checkColor: 'text-slate-600 dark:text-slate-400',
        button: 'bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900 hover:from-slate-900 hover:to-black text-white shadow-md shadow-slate-900/20 dark:from-slate-200 dark:via-slate-100 dark:to-slate-300 dark:text-slate-950 dark:hover:from-white dark:hover:to-slate-200',
      },
      features: [
        '✓ Features of Silver (Mode 1: Private Preferred Vendor Network)',
        'Direct sourcing from uploaded Excel/Manual buyer rosters',
        'Working-hour multi-channel follow-ups (SMS 5m, Call +6h, WA +12h)',
        'Skips Sundays and operates strictly 8 AM - 7 PM IST Mon-Sat',
        'OCR Quote extraction parsed directly from incoming vendor emails',
        'Automatic halt of chasing sequence upon quote ingestion',
        '🛡️ Zero Repetition: Strict single-dispatch guarantee per vendor',
      ],
    },
    {
      id: 'version_2' as const,
      name: 'Gold Plan',
      subtext: 'Features of Silver & Mode 2 Included',
      originalPrice: '₹75,000',
      description: 'Cumulative plan giving you full access to BOTH Silver and Gold (Mode 1 & Mode 2) with hybrid platform network discovery.',
      badge: '⭐ Most Popular (Gold Tier)',
      isRecommended: true,
      cardStyle: {
        border: 'border-amber-400 dark:border-amber-500 shadow-xl shadow-amber-500/20 ring-2 ring-amber-400/50 hover:border-amber-300 hover:shadow-amber-500/30',
        gradient: 'bg-gradient-to-b from-amber-500/[0.08] via-yellow-500/[0.03] to-white dark:from-amber-950/40 dark:via-yellow-950/20 dark:to-gray-900',
        topStrip: 'bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-600',
        badge: 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-slate-950 font-black tracking-wide',
        priceBox: 'bg-gradient-to-br from-amber-100/90 via-yellow-50 to-amber-100/60 dark:from-amber-950/60 dark:via-yellow-950/40 dark:to-amber-950/30 border-amber-300 dark:border-amber-700/80',
        priceText: 'text-amber-950 dark:text-yellow-100',
        strikethroughText: 'text-amber-700/70 dark:text-amber-400/60',
        icon: 'Crown' as const,
        iconBg: 'bg-gradient-to-br from-amber-200 via-yellow-300 to-amber-400 dark:from-amber-600 dark:to-yellow-700 border-amber-300 dark:border-amber-500 text-amber-950 dark:text-yellow-100',
        iconColor: 'text-amber-600 dark:text-yellow-400',
        checkColor: 'text-amber-600 dark:text-amber-400',
        button: 'bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:via-yellow-300 hover:to-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/30',
      },
      features: [
        '✓ CUMULATIVE: Full access to BOTH Silver AND Gold features',
        'Silver Tier: Private approved roster sourcing & automated working-hour chasers',
        'Gold Tier: AI Hybrid Sourcing with Procucev verified network matching',
        'Intelligent RFQ Minor Category matching (280+ taxonomy) & proximity filter',
        'Automatic classification of Buyer Upload vs. Network Pool',
        'Post-bid vendor evaluation surveys to verify quality metrics',
        '🛡️ Zero Repetition: Cross-roster deduplication prevents duplicate emails',
      ],
    },
    {
      id: 'version_3' as const,
      name: 'Diamond Plan',
      subtext: 'Features of Silver, Gold & Diamond Included',
      originalPrice: '₹1,00,000',
      description: 'Ultimate all-inclusive tier giving you full access to Silver, Gold, AND Diamond (Mode 1, Mode 2 & Mode 3) with autonomous AI governance.',
      badge: '🏆 Diamond Tier Unlocked',
      cardStyle: {
        border: 'border-cyan-400 dark:border-cyan-500 shadow-xl shadow-cyan-500/15 ring-2 ring-cyan-400/40 hover:border-cyan-300 hover:shadow-cyan-500/25',
        gradient: 'bg-gradient-to-b from-cyan-500/[0.09] via-sky-500/[0.03] to-white dark:from-cyan-950/45 dark:via-sky-950/25 dark:to-gray-900',
        topStrip: 'bg-gradient-to-r from-cyan-400 via-sky-200 to-blue-600',
        badge: 'bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 text-white font-black tracking-wide',
        priceBox: 'bg-gradient-to-br from-cyan-100/80 via-sky-50 to-blue-100/50 dark:from-cyan-950/60 dark:via-sky-950/40 dark:to-blue-950/30 border-cyan-300 dark:border-cyan-700/80',
        priceText: 'text-cyan-950 dark:text-cyan-100',
        strikethroughText: 'text-cyan-700/70 dark:text-cyan-400/60',
        icon: 'Gem' as const,
        iconBg: 'bg-gradient-to-br from-cyan-200 via-sky-200 to-blue-300 dark:from-cyan-700 dark:to-blue-800 border-cyan-300 dark:border-cyan-500 text-cyan-950 dark:text-white',
        iconColor: 'text-cyan-600 dark:text-cyan-400',
        checkColor: 'text-cyan-600 dark:text-cyan-400',
        button: 'bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 hover:from-cyan-400 hover:via-sky-400 hover:to-blue-500 text-white font-black shadow-lg shadow-cyan-500/30',
      },
      features: [
        '✓ ALL-INCLUSIVE: Full access to Silver, Gold, AND Diamond features',
        'Silver Tier: Private buyer roster sourcing & automated working-hour chasers',
        'Gold Tier: AI Hybrid Verified Supplier matching & post-bid evaluations',
        'Diamond Tier: Autonomous Category Desk & AI Discovery (Select Max 5 out of 10)',
        'Pre-bid 360° Vendor Audits & "Evaluate & Send RFQ" for unrated suppliers',
        'Interactive Comparative Quote Evaluation Matrices & PO generation',
        '🛡️ Zero Repetition: Unified single-email dispatch per unique supplier',
      ],
    },
  ];

  return (
    <div className="space-y-4 animate-fade-in pb-6">

      {/* Free Starter Account Quota Alert */}
      {activeSubscription === 'free_trial' ? (
        <div className="p-3.5 sm:p-4 rounded-xl bg-gradient-to-r from-amber-50/80 via-orange-50/60 to-indigo-50/80 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-indigo-950/30 border border-amber-300 dark:border-amber-700/60 text-xs text-amber-900 dark:text-amber-200 space-y-2 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 font-black text-xs sm:text-sm">
              <Sparkles className="text-amber-600 dark:text-amber-400 shrink-0" size={16} />
              <span>🎁 Free Starter Account — 5 Free RFQs Included</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-mono font-bold bg-amber-200/60 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 border border-amber-300">
                Used: {Math.max(0, 5 - remainingFreeRFQs)} / 5
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-mono font-bold bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-100 border border-emerald-300">
                Remaining: {remainingFreeRFQs} / 5
              </span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-slate-700 dark:text-gray-300">
            Every new buyer account receives <strong>5 Free RFQs</strong> for paid modes (<strong>Silver, Gold, or Diamond</strong>). RFQs created through <strong>Version 0 (V0: Free Starter)</strong> consume <strong>0 credits</strong> and are always free & unlimited to verified Procucev network suppliers. Once your 5 free credits are exhausted, V0 remains available, while Silver/Gold/Diamond require an active plan subscription.
          </p>
          <div className="w-full bg-amber-200/50 dark:bg-gray-800 rounded-full h-2 overflow-hidden mt-0.5">
            <div
              className="bg-gradient-to-r from-amber-500 to-emerald-500 h-full transition-all duration-300"
              style={{ width: `${(remainingFreeRFQs / 5) * 100}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="p-3 sm:p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2.5 shadow-sm">
          <ShieldCheck className="text-emerald-500 shrink-0 mt-0.5" size={16} />
          <div className="space-y-0.5">
            <span className="font-extrabold block text-sm">
              ✅ Active Premium Plan: {activeSubscription === 'version_1' ? 'Silver Plan' : activeSubscription === 'version_2' ? 'Gold Plan' : 'Diamond Plan'}
            </span>
            <p className="text-xs text-emerald-700/90 dark:text-emerald-300/90">
              Thank you for subscribing! Your platform Sourcing Mode is now active. All dispatches, follow-up chasers, and evaluation matrices associated with this plan are unlocked.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BILLING DURATION SELECTOR TOGGLE */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white tracking-tight">
              Select Billing Duration
            </h2>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
            Choose between 6 Months or 12 Months. Plan pricing updates dynamically.
          </p>
        </div>

        <div
          role="group"
          aria-label="Billing duration selector"
          className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-gray-800/90 border border-slate-200/80 dark:border-gray-700/80 shadow-inner self-start sm:self-auto"
        >
          <button
            type="button"
            onClick={() => setBillingDuration('6_months')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              billingDuration === '6_months'
                ? 'bg-white dark:bg-gray-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            6 Months
          </button>
          <button
            type="button"
            onClick={() => setBillingDuration('12_months')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              billingDuration === '12_months'
                ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            <span>12 Months</span>
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70">
              Recommended
            </span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* PLAN GRID CARDS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p) => {
          const isActive = activeSubscription === p.id;
          const priceInfo = BUYER_PRICING[billingDuration][p.id];
          const isRec = p.isRecommended;

          return (
            <div
              key={p.id}
              className={`rounded-2xl border flex flex-col justify-between overflow-hidden transition-all relative ${p.cardStyle.gradient} ${
                isActive
                  ? 'border-emerald-500 ring-2 ring-emerald-500/30 scale-[1.01] shadow-lg shadow-emerald-500/10'
                  : p.cardStyle.border
              }`}
            >
              {/* Top Accent Strip */}
              <div className={`h-1.5 w-full ${p.cardStyle.topStrip}`} />

              {/* Highlight Badges */}
              {isActive ? (
                <div className="absolute top-0 right-0 bg-emerald-600 text-white font-mono text-[9px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-widest shadow-sm">
                  Active
                </div>
              ) : isRec ? (
                <div className={`absolute top-0 right-0 ${p.cardStyle.badge} text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-wider shadow-sm`}>
                  Recommended Tier
                </div>
              ) : null}

              {/* Card Body */}
              <div className="p-4 sm:p-5 space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center border shadow-sm shrink-0 ${p.cardStyle.iconBg}`}>
                      {p.cardStyle.icon === 'Shield' && <Shield size={22} />}
                      {p.cardStyle.icon === 'Crown' && <Crown size={22} />}
                      {p.cardStyle.icon === 'Gem' && <Gem size={22} />}
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
                        {p.name}
                      </h3>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                        {p.subtext}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Price Display */}
                <div className={`p-3.5 rounded-xl border flex items-baseline justify-between gap-2 shadow-xs ${p.cardStyle.priceBox}`}>
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    {(priceInfo.originalPrice || p.originalPrice) && (
                      <span className={`text-sm font-semibold line-through ${p.cardStyle.strikethroughText}`}>
                        {priceInfo.originalPrice || p.originalPrice}
                      </span>
                    )}
                    <span className={`text-2xl sm:text-3xl font-black ${p.cardStyle.priceText}`}>
                      {priceInfo.price}
                    </span>
                    <span className="text-xs font-bold text-slate-500 dark:text-gray-400">
                      {priceInfo.label}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-gray-400 shrink-0">
                    + 18% GST
                  </span>
                </div>

                <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed min-h-[48px]">
                  {p.description}
                </p>

                <hr className="border-slate-100 dark:border-gray-800/80" />

                {/* Features List */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-450 dark:text-gray-500 block">
                    Core Benefits & Features:
                  </span>
                  <ul className="space-y-2">
                    {p.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-700 dark:text-gray-300">
                        <Check size={13} className={`${p.cardStyle.checkColor} shrink-0 mt-0.5`} />
                        <span className="leading-tight">{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Card Footer Button */}
              <div className="p-4 bg-slate-50/80 dark:bg-gray-950/40 border-t border-slate-150 dark:border-gray-800/60 mt-auto">
                <button
                  type="button"
                  data-testid={`subscribe-btn-${p.id}`}
                  onClick={() => setPendingPayment({ planId: p.id })}
                  disabled={isActive}
                  className={`btn w-full text-xs font-bold py-2.5 flex items-center justify-center gap-1.5 rounded-xl transition-all ${
                    isActive
                      ? 'btn-secondary border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 cursor-default opacity-85'
                      : `${p.cardStyle.button} shadow-md`
                  }`}
                >
                  {isActive ? <ShieldCheck size={14} /> : <Zap size={14} />}
                  <span>{isActive ? 'Active Subscription' : 'Subscribe Now'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ENTERPRISE CONTRACTS BANNER */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-md border border-indigo-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-indigo-500/30 text-indigo-300 border border-indigo-500/40">
              Enterprise Contracts
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
            Enterprise Contracts — For Customizations and Bulk Contracts — Contact us.
          </h3>
          <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
            Need tailored procurement workflows, custom ERP integrations, volume-based pricing discounts, or dedicated SLA agreements? Get in touch with our contracts team.
          </p>
        </div>

        <button
          type="button"
          data-testid="enterprise-contact-btn"
          onClick={() => {
            setEnterpriseSubmitted(false);
            const { company, email, mobile } = getAutofillDetails();
            setEnterpriseForm((prev) => ({
              companyName: prev.companyName || company,
              email: prev.email || email,
              mobile: prev.mobile || mobile,
            }));
            setIsEnterpriseModalOpen(true);
          }}
          className="btn bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs px-5 py-2.5 rounded-xl shadow transition-all shrink-0 flex items-center justify-center gap-2"
        >
          <Building2 size={15} className="text-indigo-600" />
          <span>Contact Us</span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ENTERPRISE CONTACT POPUP MODAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {isEnterpriseModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content max-w-md p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-indigo-500/40 animate-fade-in relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
                  <Building2 size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Enterprise Contracts
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    For Customizations and Bulk Contracts
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEnterpriseModalOpen(false)}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {enterpriseSubmitted ? (
              <div className="py-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
                  <CheckCircle2 size={28} />
                </div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Enquiry Received!
                </h4>
                <p className="text-xs text-slate-500 dark:text-gray-400 max-w-xs mx-auto">
                  Thank you. Our Enterprise Contracts team will reach out to <strong>{enterpriseForm.companyName}</strong> at <strong>{enterpriseForm.email}</strong> shortly.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setIsEnterpriseModalOpen(false)}
                    className="btn btn-primary text-xs px-6 py-2 rounded-xl"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEnterpriseSubmit} className="space-y-4 my-4">
                <p className="text-xs text-slate-600 dark:text-gray-400">
                  Please share your details and our team will get in touch with customized enterprise contract terms.
                </p>

                <div className="space-y-1.5">
                  <label
                    htmlFor="enterprise-company-name"
                    className="block text-xs font-bold text-slate-700 dark:text-gray-300"
                  >
                    Company Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="enterprise-company-name"
                    type="text"
                    required
                    value={enterpriseForm.companyName}
                    onChange={(e) =>
                      setEnterpriseForm((prev) => ({ ...prev, companyName: e.target.value }))
                    }
                    placeholder="e.g. Acme Corporation Pvt Ltd"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="enterprise-email-id"
                    className="block text-xs font-bold text-slate-700 dark:text-gray-300"
                  >
                    Email ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="enterprise-email-id"
                    type="email"
                    required
                    value={enterpriseForm.email}
                    onChange={(e) =>
                      setEnterpriseForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                    placeholder="e.g. procurement@company.com"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="enterprise-mobile-number"
                    className="block text-xs font-bold text-slate-700 dark:text-gray-300"
                  >
                    Mobile Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="enterprise-mobile-number"
                    type="tel"
                    required
                    value={enterpriseForm.mobile}
                    onChange={(e) =>
                      setEnterpriseForm((prev) => ({ ...prev, mobile: e.target.value }))
                    }
                    placeholder="e.g. +91 98765 43210"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setIsEnterpriseModalOpen(false)}
                    className="btn btn-secondary text-xs px-4 py-2 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary text-xs px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1.5 shadow-sm"
                  >
                    <span>Submit Enquiry</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <SubscriptionPaymentModal
        isOpen={!!pendingPayment}
        onClose={() => setPendingPayment(null)}
        planId={pendingPayment?.planId || 'version_1'}
        planName={pendingPayment ? PLAN_LABEL[pendingPayment.planId] : ''}
        price={pendingPayment ? BUYER_PRICING[billingDuration][pendingPayment.planId].totalPriceWithGst : ''}
        billingDurationLabel={billingDuration === '12_months' ? '12 Months (Recommended)' : '6 Months'}
        breakdown={
          pendingPayment
            ? {
                basePrice: BUYER_PRICING[billingDuration][pendingPayment.planId].baseDurationLabel,
                gstAmount: BUYER_PRICING[billingDuration][pendingPayment.planId].gstAmount,
              }
            : undefined
        }
        createPaymentLink={(planId) => createBuyerPaymentLink(planId, billingDuration)}
      />
    </div>
  );
}
