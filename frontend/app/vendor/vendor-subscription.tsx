'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { SubscriptionPaymentModal } from '@/app/components/Modals';
import { authClient } from '@/lib/authClient';
import { ShieldCheck, Check, Zap, Layers, AlertCircle, RefreshCw, Download, Package, ArrowRight } from 'lucide-react';

export default function VendorSubscriptionCenter() {
  const {
    vendorSubscription,
    updateVendorSubscription,
    vendorRfqDownloadsUsed,
    setVendorRfqDownloadsUsed,
    showToast,
    addAuditLog,
    vendorCatalogue,
    currentUserSession,
    refreshFromDB,
    createVendorPaymentLink,
    checkVendorPaymentLinkStatus,
    buyerVendors,
  } = useApp();

  // Zoho redirects the vendor back here to the same URL whether they actually
  // paid or cancelled on its hosted checkout page, so the outcome can't be
  // read off the URL itself — instead it carries the app's own payment-link
  // id (`linkId`), and the real outcome is looked up server-side via
  // checkVendorPaymentLinkStatus. Activation itself already happened
  // server-side (the webhook, or the reconciliation poller if that's
  // delayed) — this just reflects that real state and re-syncs the vendor's
  // subscriptionPlan. Mirrors subscription-center.tsx's identical handling.
  const handledPaymentReturnRef = useRef(false);
  useEffect(() => {
    if (handledPaymentReturnRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const linkId = params.get('linkId');
    if (!linkId) return;
    // Reads the session directly off authClient (same as checkVendorPaymentLinkStatus
    // itself) rather than the store's currentUserSession React state, which is only
    // populated from a valid stored token — the two can otherwise disagree transiently.
    const sessionEmail = authClient.getSessionUser()?.email?.toLowerCase();
    const myVendorReady = buyerVendors.some((v) => v.email?.toLowerCase() === sessionEmail);
    if (!myVendorReady) return; // wait for the vendor directory to load, retry once it does

    handledPaymentReturnRef.current = true;

    void (async () => {
      const status = await checkVendorPaymentLinkStatus(linkId);
      if (status === 'PAID') {
        showToast('Payment Received', 'Your subscription has been activated.', 'success');
        void refreshFromDB();
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
        void refreshFromDB();
      }

      // Drop the query param so a refresh doesn't re-show the toast.
      params.delete('linkId');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState(null, '', next);
    })();
  }, [buyerVendors, currentUserSession?.email, checkVendorPaymentLinkStatus, refreshFromDB, showToast]);

  const [pendingPayment, setPendingPayment] = useState<{ planId: 'connect' | 'select'; planName: string; price: string } | null>(null);
  const [isUpdatingPlan, setIsUpdatingPlan] = useState(false);

  const planLabel = (plan: 'premium' | 'connect' | 'select') =>
    plan === 'premium'
      ? 'Premium Model (Client Uploaded Vendor)'
      : plan === 'connect'
      ? 'Connect Model (50 RFQs / 3 Months)'
      : 'Select Model (Catalogue & 100 RFQs / 3 Months)';

  const handleSubscribe = async (plan: 'premium' | 'connect' | 'select') => {
    if (isUpdatingPlan) return;
    setIsUpdatingPlan(true);
    const saved = await updateVendorSubscription(plan);
    setIsUpdatingPlan(false);
    if (!saved) return;

    const planName = planLabel(plan);
    showToast(
      'Vendor Subscription Updated!',
      `Successfully switched to ${planName}.`,
      'success'
    );
    addAuditLog(
      `${currentUserSession?.orgName || 'Vendor'} updated vendor subscription to ${planName}`,
      undefined,
      currentUserSession?.email
    );
  };

  // Premium is free (granted on buyer roster upload) so it switches instantly;
  // Connect/Select advertise real $ prices, so they go through the dummy
  // payment gateway first rather than flipping the plan for free on click.
  const handlePlanButtonClick = (plan: 'premium' | 'connect' | 'select', price: string) => {
    if (plan === 'premium') {
      handleSubscribe(plan);
      return;
    }
    setPendingPayment({ planId: plan, planName: planLabel(plan), price });
  };

  const handleResetQuota = () => {
    setVendorRfqDownloadsUsed(0);
    showToast('Download Quota Reset', 'Quarterly download quota counter reset to 0.', 'info');
  };

  const getMaxQuota = () => {
    if (vendorSubscription === 'connect') return 50;
    if (vendorSubscription === 'select') return 100;
    return 0; // Premium model is for client-uploaded RFQs
  };

  const maxQuota = getMaxQuota();
  const remainingDownloads = maxQuota > 0 ? Math.max(0, maxQuota - vendorRfqDownloadsUsed) : 'Unlimited (Client Uploaded)';

  const plans = [
    {
      id: 'premium' as const,
      name: 'Premium Model',
      subtext: 'Client Uploaded Vendor',
      price: 'Free',
      billing: 'included with Buyer Roster upload',
      description: 'Automatically granted to vendors uploaded by buyers. Access all direct RFQ invitations issued by your clients.',
      badge: 'Client Uploaded',
      colorClass: 'border-slate-200 dark:border-gray-800',
      features: [
        'See all RFQs from buyers who uploaded your vendor profile (e.g. L&T, Reliance)',
        'Unlimited technical BOQ downloads for direct invitation RFQs',
        'Email-based quotation tracking and status updates',
        'Direct communication channel with inviting enterprise buyers',
        'Verified supplier badge & compliance tracking',
      ],
      limitations: [
        'Marketplace RFQs outside client roster require Connect or Select model upgrade',
      ],
    },
    {
      id: 'connect' as const,
      name: 'Connect Model',
      subtext: 'Marketplace Expansion',
      price: '₹2',
      billing: 'per 3 months (90 days)',
      description: 'Expand your market reach. Access & download open RFQs across the entire Procucev Network Marketplace.',
      badge: 'Popular for Growth',
      colorClass: 'border-indigo-300 dark:border-indigo-800 shadow-indigo-500/10',
      features: [
        'All Premium Client-Uploaded features included',
        'Download up to 50 RFQs within 3 months (90-day period)',
        '🎁 360° AI Self-Evaluation Fee: $0 FREE (Waived from $5)',
        'Access to full Open Network Marketplace RFQs',
        'Instant email dispatch of technical BOQ spreadsheets & specifications',
        'Automated category & location proximity matching alerts',
        'Quarterly download quota tracking and log',
      ],
      limitations: [
        'Catalogue creation restricted (upgrade to Select Model to publish products)',
      ],
    },
    {
      id: 'select' as const,
      name: 'Select Model',
      subtext: 'Item Catalogue & High Volume',
      price: '₹5',
      billing: 'per 3 months (90 days)',
      description: 'Complete tier for high-volume suppliers. Build your Item Catalogue and capture maximum marketplace demand.',
      badge: 'Full Suite',
      colorClass: 'border-purple-300 dark:border-purple-800 shadow-purple-500/10',
      features: [
        'All Premium & Connect Model features included',
        '🎁 360° AI Self-Evaluation Fee: $0 FREE (Waived from $5)',
        'Vendor Item Catalogue: Host up to 100 products (SKUs, MOQs & Specs)',
        'Download up to 100 RFQs within 3 months (90-day period)',
        'Bidirectional Cross-Highlighting (📦 Catalogue Match & 🔔 RFQs Available)',
        'Priority category positioning in Buyer Mode 2 & Mode 3 AI matching',
        'Bulk CSV/Excel Catalogue import and export tools',
      ],
      limitations: [],
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p className="max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-gray-400">
          Compare vendor access tiers, quotation quotas, and catalogue features.
        </p>
        <button
          onClick={handleResetQuota}
          className="btn btn-secondary btn-sm flex items-center gap-1 shrink-0 text-xs"
        >
          <RefreshCw size={12} /> Reset Quota Counter (Demo)
        </button>
      </div>

      {/* Active Subscription Status Banner */}
      <div className="p-4 rounded-2xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-xl shrink-0 ${
            vendorSubscription === 'select'
              ? 'bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-300'
              : vendorSubscription === 'connect'
              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300'
              : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300'
          }`}>
            <ShieldCheck size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 uppercase font-extrabold tracking-wider">Active Plan</span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${
                vendorSubscription === 'select'
                  ? 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300'
                  : vendorSubscription === 'connect'
                  ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-300'
                  : 'bg-slate-200 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border border-slate-300'
              }`}>
                {vendorSubscription === 'select' ? 'Select Model' : vendorSubscription === 'connect' ? 'Connect Model' : 'Premium Model (Client Uploaded)'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-gray-300 mt-1 font-medium">
              {vendorSubscription === 'premium' && 'You are an uploaded roster vendor. Access all RFQs directly dispatched by your enterprise buyers.'}
              {vendorSubscription === 'connect' && 'Marketplace access enabled: Download up to 50 open marketplace RFQs per 3-month period.'}
              {vendorSubscription === 'select' && 'Full tier active: Item Catalogue unlocked (100 products max) + Download up to 100 open marketplace RFQs per 3-month period.'}
            </p>
          </div>
        </div>

        {/* Quota Progress box */}
        {vendorSubscription !== 'premium' ? (
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 min-w-[220px] space-y-1.5">
            <div className="flex justify-between items-center text-[11px] font-extrabold">
              <span className="text-slate-500 dark:text-gray-400 flex items-center gap-1">
                <Download size={12} /> 3-Month Downloads:
              </span>
              <span className="text-indigo-650 dark:text-indigo-400 font-mono">
                {vendorRfqDownloadsUsed} / {maxQuota}
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-gray-800 h-2 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  vendorRfqDownloadsUsed >= maxQuota
                    ? 'bg-rose-500'
                    : vendorSubscription === 'select'
                    ? 'bg-purple-600'
                    : 'bg-indigo-600'
                }`}
                style={{ width: `${Math.min(100, (vendorRfqDownloadsUsed / maxQuota) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-400 block text-right font-medium">
              {remainingDownloads} downloads remaining
            </span>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 min-w-[220px] text-center">
            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 block">
              Direct Invites: Unlimited
            </span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block mt-0.5">
              Buyer Roster Ingestion Active
            </span>
          </div>
        )}
      </div>

      {/* Plan Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {plans.map((p) => {
          const isActive = vendorSubscription === p.id;

          return (
            <div
              key={p.id}
              className={`rounded-3xl border bg-white dark:bg-gray-900 flex flex-col justify-between overflow-hidden transition-all shadow-md relative ${
                isActive
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 scale-[1.01]'
                  : 'border-slate-200 dark:border-gray-800 hover:border-slate-400 dark:hover:border-gray-700'
              }`}
            >
              {/* Highlight Ribbon */}
              {isActive && (
                <div className="absolute top-0 right-0 bg-emerald-600 text-white font-mono text-[9px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-widest">
                  Active Plan
                </div>
              )}

              {/* Card Body */}
              <div className="p-6 space-y-5">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-450 dark:text-gray-500">
                    {p.subtext}
                  </span>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                    {p.name}
                  </h3>
                </div>

                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{p.price}</span>
                  <span className="text-[11px] text-slate-400 dark:text-gray-500 font-medium">{p.billing}</span>
                </div>

                <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed min-h-[48px]">
                  {p.description}
                </p>

                <hr className="border-slate-100 dark:border-gray-800/80" />

                {/* Features List */}
                <div className="space-y-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-450 dark:text-gray-500 block">
                    Included Capabilities:
                  </span>
                  <ul className="space-y-2">
                    {p.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-650 dark:text-gray-300">
                        <Check size={12} className="text-emerald-500 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>

                  {p.limitations.length > 0 && (
                    <div className="pt-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 block">
                        Tier Note:
                      </span>
                      <ul className="mt-1 space-y-1">
                        {p.limitations.map((lim, idx) => (
                          <li key={idx} className="text-[11px] text-slate-400 dark:text-gray-500 flex items-start gap-1.5">
                            <span className="text-amber-500">•</span>
                            <span>{lim}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer Button */}
              <div className="p-6 bg-slate-50 dark:bg-gray-950/40 border-t border-slate-150 dark:border-gray-800/60">
                <button
                  onClick={() => handlePlanButtonClick(p.id, p.price)}
                  disabled={isActive || isUpdatingPlan}
                  className={`btn w-full text-xs font-bold py-2.5 flex items-center justify-center gap-1.5 ${
                    isActive
                      ? 'btn-secondary border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 cursor-default opacity-85'
                      : p.id === 'select'
                      ? 'btn-primary bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 border-none text-white'
                      : p.id === 'connect'
                      ? 'btn-primary bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 border-none text-white'
                      : 'btn-secondary'
                  }`}
                >
                  {isActive ? <ShieldCheck size={13} /> : <Zap size={13} />}
                  {isActive ? 'Active Plan' : `Switch to ${p.name}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

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
