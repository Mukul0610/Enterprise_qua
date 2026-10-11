'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { fetchRFQById } from '@/lib/rfqClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import RFQDetails from '@/app/buyer/rfq-details';
import type { RFQItem } from '@/lib/types';

const DETAILS = UI_STRINGS.rfqDetails;

/** Query parameter carrying the RFQ number to display. */
const RFQ_PARAM = 'rfq';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; rfq: RFQItem }
  | { status: 'error'; message: string; canRetry: boolean };

/** Shared frame for the non-loaded states, so they read consistently. */
function StatusPanel({
  icon,
  title,
  message,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl mx-auto py-16 px-4 text-center space-y-3">
      <div className="flex justify-center text-slate-400 dark:text-gray-500">{icon}</div>
      <h1 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h1>
      <p className="text-sm text-slate-500 dark:text-gray-400">{message}</p>
      {action}
    </div>
  );
}

/**
 * Loads the RFQ from the API rather than from store state.
 *
 * Two reasons it is fetched rather than looked up locally. The record is only
 * complete server-side — the allocated RFQ number, the stored line items, the
 * attachments and the generated summary all live in the database — and the store
 * is populated by a bootstrap call that no longer carries RFQs at all. Looking it
 * up in `rfqs` therefore reported "not found" for RFQs that exist.
 *
 * Reading the number from the query string also keeps the page addressable, so it
 * survives a reload and can be linked to.
 */
function BuyerRFQDetailsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rfqNumber = searchParams.get(RFQ_PARAM);

  const [state, setState] = useState<LoadState>({ status: 'idle' });

  const load = useCallback(async (identifier: string) => {
    setState({ status: 'loading' });
    const result = await fetchRFQById(identifier);

    if (result.success) {
      setState({ status: 'loaded', rfq: result.rfq });
      return;
    }
    setState({
      status: 'error',
      message: result.error,
      // A missing RFQ will not appear on a retry; a transport failure might.
      canRetry: result.reason !== 'NOT_FOUND',
    });
  }, []);

  useEffect(() => {
    if (!rfqNumber) {
      setState({ status: 'idle' });
      return;
    }
    void load(rfqNumber);
  }, [rfqNumber, load]);

  const onBack = () => router.push('/buyer/dashboard');

  if (!rfqNumber) {
    return (
      <StatusPanel
        icon={<AlertCircle size={28} />}
        title={DETAILS.missingReferenceTitle}
        message={DETAILS.missingReferenceMessage}
        action={
          <button onClick={onBack} className="btn btn-secondary btn-sm font-bold">
            {DETAILS.backAction}
          </button>
        }
      />
    );
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <StatusPanel
        icon={<Loader2 size={28} className="animate-spin" />}
        title={DETAILS.loadingTitle}
        message={DETAILS.loadingMessage}
      />
    );
  }

  if (state.status === 'error') {
    return (
      <StatusPanel
        icon={<AlertCircle size={28} className="text-rose-500" />}
        title={state.canRetry ? DETAILS.loadFailedTitle : DETAILS.notFoundTitle}
        message={state.message}
        action={
          <div className="flex items-center justify-center gap-2">
            {state.canRetry && (
              <button
                onClick={() => void load(rfqNumber)}
                className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5"
              >
                <RefreshCw size={13} /> {DETAILS.retryAction}
              </button>
            )}
            <button onClick={onBack} className="btn btn-secondary btn-sm font-bold">
              {DETAILS.backAction}
            </button>
          </div>
        }
      />
    );
  }

  const { rfq } = state;

  return (
    <RFQDetails
      rfq={rfq}
      onBack={onBack}
      onUpdate={(updatedRfq) => setState({ status: 'loaded', rfq: updatedRfq })}
    />
  );
}

export default function BuyerRFQDetailsPage() {
  // useSearchParams suspends during prerender, so the boundary is required for
  // `next build` to statically render this route.
  return (
    <Suspense fallback={null}>
      <BuyerRFQDetailsView />
    </Suspense>
  );
}
