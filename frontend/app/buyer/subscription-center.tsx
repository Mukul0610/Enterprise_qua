'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { SubscriptionPaymentModal } from '@/app/components/Modals';
import { Sparkles, ShieldCheck, Check, Zap, Calendar, CheckCircle2 } from 'lucide-react';

export type BillingDuration = '6_months' | '12_months';

export const PLAN_LABEL: Record<string, string> = {
  version_1: 'Version 1: Client Roster Plan',
  version_2: 'Version 2: Hybrid Sourcing Plan',
  version_3: 'Version 3: Autonomous AI Sourcing Plan',
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
      price: '₹4,999',
      amount: 4999,
      label: 'per month',
      baseDurationLabel: '₹59,988 (₹4,999 × 12 months)',
      gstAmount: '₹10,797.84',
      totalPriceWithGst: '₹70,785.84',
      totalAmountWithGst: 70785.84,
    },
    version_2: {
      price: '₹7,499',
      amount: 7499,
      label: 'per month',
      baseDurationLabel: '₹89,988 (₹7,499 × 12 months)',
      gstAmount: '₹16,197.84',
      totalPriceWithGst: '₹1,06,185.84',
      totalAmountWithGst: 106185.84,
    },
    version_3: {
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
      price: '₹5,499',
      amount: 5499,
      label: 'per month',
      baseDurationLabel: '₹32,994 (₹5,499 × 6 months)',
      gstAmount: '₹5,938.92',
      totalPriceWithGst: '₹38,932.92',
      totalAmountWithGst: 38932.92,
    },
    version_2: {
      price: '₹7,999',
      amount: 7999,
      label: 'per month',
      baseDurationLabel: '₹47,994 (₹7,999 × 6 months)',
      gstAmount: '₹8,638.92',
      totalPriceWithGst: '₹56,632.92',
      totalAmountWithGst: 56632.92,
    },
    version_3: {
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
    refreshActiveBuyerAccount,
    createBuyerPaymentLink,
    checkBuyerPaymentLinkStatus,
  } = useApp();

  const [billingDuration, setBillingDuration] = useState<BillingDuration>('12_months');
  const [pendingPayment, setPendingPayment] = useState<{ planId: 'version_1' | 'version_2' | 'version_3' } | null>(null);

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
      name: 'Version 1 Plan',
      subtext: 'Features of Version 1 Only',
      description: 'Streamline procurement across your private pre-approved vendor roster (Mode 1 only) with working-hour multi-channel follow-ups.',
      badge: 'Version 1 Only',
      features: [
        '✓ Features of Version 1 ONLY (Mode 1: Private Preferred Vendor Network)',
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
      name: 'Version 2 Plan',
      subtext: 'Features of Version 1 & 2 Included',
      description: 'Cumulative plan giving you full access to BOTH Version 1 and Version 2 (Mode 1 & Mode 2) with hybrid platform network discovery.',
      badge: '⭐ Cumulative (V1 + V2)',
      isRecommended: true,
      features: [
        '✓ CUMULATIVE: Full access to BOTH Version 1 AND Version 2 features',
        'Version 1: Private approved roster sourcing & automated working-hour chasers',
        'Version 2: AI Hybrid Sourcing with Procucev verified network matching',
        'Intelligent RFQ Minor Category matching (280+ taxonomy) & proximity filter',
        'Automatic classification of Buyer Upload vs. Network Pool',
        'Post-bid vendor evaluation surveys to verify quality metrics',
        '🛡️ Zero Repetition: Cross-roster deduplication prevents duplicate emails',
      ],
    },
    {
      id: 'version_3' as const,
      name: 'Version 3 Plan',
      subtext: 'Features of Version 1, 2 & 3 Included',
      description: 'Ultimate all-inclusive tier giving you full access to Version 1, Version 2, AND Version 3 (Mode 1, Mode 2 & Mode 3) with autonomous AI governance.',
      badge: '🏆 All 3 Versions Unlocked',
      features: [
        '✓ ALL-INCLUSIVE: Full access to Version 1, Version 2, AND Version 3 features',
        'Version 1: Private buyer roster sourcing & automated working-hour chasers',
        'Version 2: AI Hybrid Verified Supplier matching & post-bid evaluations',
        'Version 3: Autonomous Category Desk & AI Discovery (Select Max 5 out of 10)',
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
            Every new buyer account receives <strong>5 Free RFQs</strong> for paid modes (<strong>Version 1, Version 2, or Version 3</strong>). RFQs created through <strong>Version 0 (V0: Free Starter)</strong> consume <strong>0 credits</strong> and are always free & unlimited to verified Procucev network suppliers. Once your 5 free credits are exhausted, V0 remains available, while V1/V2/V3 require an active plan subscription.
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
              ✅ Active Premium Plan: {activeSubscription === 'version_1' ? 'Version 1' : activeSubscription === 'version_2' ? 'Version 2' : 'Version 3'}
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
              className={`rounded-2xl border bg-white dark:bg-gray-900 flex flex-col justify-between overflow-hidden transition-all shadow-sm relative ${
                isActive
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 scale-[1.01]'
                  : isRec
                  ? 'border-indigo-300 dark:border-indigo-700/80 hover:border-indigo-500 shadow-indigo-500/5'
                  : 'border-slate-200 dark:border-gray-800 hover:border-slate-400 dark:hover:border-gray-700'
              }`}
            >
              {/* Highlight Badges */}
              {isActive ? (
                <div className="absolute top-0 right-0 bg-emerald-600 text-white font-mono text-[9px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-widest">
                  Active
                </div>
              ) : isRec ? (
                <div className="absolute top-0 right-0 bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-mono text-[9px] font-bold px-2.5 py-0.5 rounded-bl-lg uppercase tracking-wider">
                  Recommended Tier
                </div>
              ) : null}

              {/* Card Body */}
              <div className="p-4 sm:p-5 space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-450 dark:text-gray-500">
                      {p.subtext}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{p.name}</h3>
                </div>

                {/* Price Display */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-800/60 border border-slate-100 dark:border-gray-800 flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
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

                <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed min-h-[48px]">
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
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-650 dark:text-gray-300">
                        <Check size={13} className="text-emerald-500 shrink-0 mt-0.5" />
                        <span className="leading-tight">{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Card Footer Button */}
              <div className="p-4 bg-slate-50 dark:bg-gray-950/40 border-t border-slate-150 dark:border-gray-800/60">
                <button
                  type="button"
                  data-testid={`subscribe-btn-${p.id}`}
                  onClick={() => setPendingPayment({ planId: p.id })}
                  disabled={isActive}
                  className={`btn w-full text-xs font-bold py-2 flex items-center justify-center gap-1.5 ${
                    isActive
                      ? 'btn-secondary border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 cursor-default opacity-85'
                      : isRec
                      ? 'btn-primary bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-sm'
                      : 'btn-primary'
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
