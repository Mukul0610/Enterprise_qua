'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { fetchRFQById } from '@/lib/rfqClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import RFQDetails from '@/app/buyer/rfq-details';
import { RFQDeleteDialog, RFQEditModal } from '@/app/buyer/RFQEditModal';
import { useApp } from '@/lib/store';
import type { RFQItem } from '@/lib/types';

const DETAILS = UI_STRINGS.rfqDetails;

/** Query parameter carrying the RFQ number to display. */
const RFQ_PARAM = 'rfq';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; rfq: RFQItem }
  | { status: 'error'; message: string; canRetry: boolean };

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
 * Category-manager view of one RFQ, reached from the All RFQs console.
 *
 * Renders the same detail component the buyer sees, with the same edit and
 * delete affordances — `PUT`/`DELETE /api/rfqs/:id` have no buyer-only role
 * gate (`canAccessRfq` treats category_manager/admin as unrestricted), so a
 * category manager overseeing sourcing across every buyer can correct an
 * RFQ's details the same way its own buyer could. The RFQ is fetched by
 * number through `GET /api/rfqs/:id`, which returns the full cross-buyer
 * record for the category_manager role (it is only buyer callers that
 * endpoint scopes).
 *
 * Addressable by RFQ number so the page survives a reload and can be linked to.
 */
function CategoryManagerRFQDetailsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rfqNumber = searchParams.get(RFQ_PARAM);

  const { updateRFQ, deleteRFQ } = useApp();
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const onBack = () => router.push('/category-manager/all-rfqs');

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

  /**
   * Adopt the saved record into this page's own state.
   *
   * The page fetched the RFQ itself rather than reading it from the store, so
   * the store update alone would leave this screen showing the pre-edit
   * terms until a reload.
   */
  const handleSave = async (identifier: string, changes: Parameters<typeof updateRFQ>[1]) => {
    const saved = await updateRFQ(identifier, changes);
    setState({ status: 'loaded', rfq: saved });
    return saved;
  };

  // Back to the console afterwards: staying here would leave the CM looking
  // at a record that no longer exists.
  const handleDelete = async (identifier: string) => {
    await deleteRFQ(identifier);
    onBack();
  };

  return (
    <>
      <RFQDetails
        rfq={rfq}
        onBack={onBack}
        onEdit={() => setIsEditing(true)}
        onDelete={() => setIsDeleting(true)}
        onUpdate={(updatedRfq) => setState({ status: 'loaded', rfq: updatedRfq })}
      />
      <RFQEditModal rfq={isEditing ? rfq : null} onClose={() => setIsEditing(false)} onSave={handleSave} />
      <RFQDeleteDialog
        rfq={isDeleting ? rfq : null}
        onClose={() => setIsDeleting(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}

export default function CategoryManagerRFQDetailsPage() {
  // useSearchParams suspends during prerender, so the boundary is required for
  // `next build` to statically render this route.
  return (
    <Suspense fallback={null}>
      <CategoryManagerRFQDetailsView />
    </Suspense>
  );
}
