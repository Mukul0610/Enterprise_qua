'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { SubscriptionPaymentModal } from '@/app/components/Modals';
import { authClient } from '@/lib/authClient';
import { Sparkles, ShieldCheck, Check, Zap, Layers, AlertCircle, RefreshCw } from 'lucide-react';

const PLAN_LABEL: Record<string, string> = {
  version_1: 'Version 1: Client Roster Plan',
  version_2: 'Version 2: Hybrid Sourcing Plan',
  version_3: 'Version 3: Autonomous AI Sourcing Plan',
};

// Must match the actual GST-inclusive amount Zoho charges
// (computeZohoBuyerPlanAmount in backend/src/config/constants.js), so this
// confirmation modal never promises a different amount than what's billed.
const PLAN_PRICE: Record<string, string> = {
  version_1: '₹14,999',
  version_2: '₹19,999',
  version_3: '₹24,999',
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

  const [pendingPayment, setPendingPayment] = useState<{ planId: 'version_1' | 'version_2' | 'version_3' } | null>(null);

  // Zoho redirects the buyer back here to the same URL whether they actually
  // paid or cancelled on its hosted checkout page, so the outcome can't be
  // read off the URL itself — instead it carries the app's own payment-link
  // id (`linkId`), and the real outcome is looked up server-side via
  // checkBuyerPaymentLinkStatus. Activation itself already happened
  // server-side (the webhook, or the reconciliation poller if that's
  // delayed) — this just reflects that real state and re-syncs the buyer's
  // subscriptionPlan. Mirrors vendor-subscription.tsx's identical handling.
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

  const handleResetTrial = async () => {
    if (!activeBuyerAccount?.id) {
      showToast('Reset Failed', 'Could not find your buyer account.', 'warning');
      return;
    }
    try {
      const token = authClient.getToken();
      const res = await fetch(`/api/buyer-accounts/${encodeURIComponent(activeBuyerAccount.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 5 }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        showToast('Reset Failed', json?.error || 'Could not reset your account. Please try again.', 'warning');
        return;
      }
    } catch {
      showToast('Reset Failed', 'Could not reach the server. Please try again.', 'warning');
      return;
    }
    void refreshActiveBuyerAccount();
    showToast(
      'Free Account Restored',
      'Free starter account reset: 5 Free RFQs available across Version 1, Version 2, and Version 3.',
      'info'
    );
  };

  const plans = [
    {
      id: 'version_1' as const,
      name: 'Version 1 Plan',
      subtext: 'Features of Version 1 Only',
      originalPrice: '₹50,000',
      price: '₹14,999',
      billing: 'per year',
      description: 'Streamline procurement across your private pre-approved vendor roster (Mode 1 only) with working-hour multi-channel follow-ups.',
      colorClass: 'from-indigo-650 to-indigo-750 text-indigo-600 border-indigo-200 dark:border-indigo-900',
      shadowClass: 'shadow-indigo-500/10',
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
      originalPrice: '₹60,000',
      price: '₹19,999',
      billing: 'per year',
      description: 'Cumulative plan giving you full access to BOTH Version 1 and Version 2 (Mode 1 & Mode 2) with hybrid platform network discovery.',
      colorClass: 'from-sky-600 to-blue-600 text-sky-600 border-sky-200 dark:border-sky-900',
      shadowClass: 'shadow-sky-500/10',
      badge: '⭐ Cumulative (V1 + V2)',
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
      originalPrice: '₹75,000',
      price: '₹24,999',
      billing: 'per year',
      description: 'Ultimate all-inclusive tier giving you full access to Version 1, Version 2, AND Version 3 (Mode 1, Mode 2 & Mode 3) with autonomous AI governance.',
      colorClass: 'from-purple-600 to-indigo-650 text-purple-600 border-purple-200 dark:border-purple-900',
      shadowClass: 'shadow-purple-500/10',
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
    <div className="space-y-2.5 animate-fade-in pb-4">
      {/* Top Action Bar */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleResetTrial}
          className="btn btn-secondary btn-sm flex items-center gap-1 shrink-0"
        >
          <RefreshCw size={12} /> Reset to Free Account (5 Free RFQs)
        </button>
      </div>

      {/* Trial Quota Info Alert */}
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
          <ShieldCheck className="text-emerald-500 shrink-0 mt-0.5" size={15} />
          <div className="space-y-0.5">
            <span className="font-extrabold block">✅ Active Premium Plan: {activeSubscription === 'version_1' ? 'Version 1' : activeSubscription === 'version_2' ? 'Version 2' : 'Version 3'}</span>
            <p className="text-[11px]">
              Thank you for subscribing! Your platform Sourcing Mode is now active. All dispatches, follow-up chasers, and evaluation matrices associated with this plan are unlocked.
            </p>
          </div>
        </div>
      )}

      {/* Plan Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {plans.map((p) => {
          const isActive = activeSubscription === p.id;
          const buttonLabel = isActive
            ? 'Active Subscription'
            : `Subscribe to ${p.name.split(' ')[0]} ${p.name.split(' ')[1]}`;

          return (
            <div
              key={p.id}
              className={`rounded-xl border bg-white dark:bg-gray-900 flex flex-col justify-between overflow-hidden transition-all shadow-sm relative ${
                isActive
                  ? 'border-brand-500 ring-2 ring-brand-500/20 scale-[1.01]'
                  : 'border-slate-200 dark:border-gray-800 hover:border-slate-400 dark:hover:border-gray-700'
              }`}
            >
              {/* Highlight Ribbon */}
              {isActive && (
                <div className="absolute top-0 right-0 bg-brand-500 text-white font-mono text-[9px] font-bold px-2.5 py-0.5 rounded-bl-lg uppercase tracking-widest">
                  Active
                </div>
              )}

              {/* Card Body */}
              <div className="p-3.5 sm:p-4 space-y-3">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-450 dark:text-gray-500">
                    {p.subtext}
                  </span>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">{p.name}</h3>
                </div>

                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-slate-400 dark:text-gray-500 line-through">
                    {p.originalPrice}
                  </span>
                  <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">{p.price}</span>
                  <span className="text-[10px] text-slate-400 dark:text-gray-500 font-medium">{p.billing}</span>
                </div>

                <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed min-h-[40px]">
                  {p.description}
                </p>

                <hr className="border-slate-100 dark:border-gray-800/80" />

                {/* Features List */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-450 dark:text-gray-500 block">
                    Core Benefits & Features:
                  </span>
                  <ul className="space-y-1.5">
                    {p.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-1.5 text-xs text-slate-650 dark:text-gray-300">
                        <Check size={12} className="text-emerald-500 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Card Footer Button */}
              <div className="p-3 sm:p-3.5 bg-slate-50 dark:bg-gray-950/40 border-t border-slate-150 dark:border-gray-800/60">
                <button
                  onClick={() => setPendingPayment({ planId: p.id })}
                  disabled={isActive}
                  className={`btn w-full text-xs font-bold py-1.5 flex items-center justify-center gap-1.5 ${
                    isActive
                      ? 'btn-secondary border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 cursor-default opacity-85'
                      : 'btn-primary'
                  }`}
                >
                  {isActive ? <ShieldCheck size={13} /> : <Zap size={13} />}
                  {buttonLabel}
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
        price={pendingPayment ? PLAN_PRICE[pendingPayment.planId] : ''}
        createPaymentLink={createBuyerPaymentLink}
      />
    </div>
  );
}
