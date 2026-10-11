'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/lib/store';
import QuotationForm from '@/app/vendor/quotation-form';
import { VendorOpportunity } from '@/lib/types';

function VendorQuotationFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetRfqParam = searchParams.get('rfq') || searchParams.get('id');
  const { selectedVendorOpportunity, vendorOpportunities, rfqs } = useApp();
  const backToFeed = () => router.push('/vendor/opportunity-feed');
  const backToBidQuotes = () => router.push('/vendor/quotation-form');

  // Match targeted RFQ by query parameter if present
  let opportunity: VendorOpportunity | undefined = undefined;
  if (targetRfqParam) {
    opportunity = vendorOpportunities.find(
      (opp) => opp.rfqNumber === targetRfqParam || opp.id === targetRfqParam
    );

    if (!opportunity) {
      const matchedRfq = rfqs.find(
        (r) => r.rfqNumber === targetRfqParam || r.id === targetRfqParam
      );
      if (matchedRfq) {
        opportunity = {
          id: `opp-${matchedRfq.id}`,
          rfqNumber: matchedRfq.rfqNumber,
          title: matchedRfq.title,
          buyer: matchedRfq.buyerAccountName || 'Buyer enterprise',
          deadline: matchedRfq.targetDeliveryDate || '',
          daysRemaining: 14,
          type: matchedRfq.sourcingMode === 'mode_3' ? 'network_marketplace' : 'direct_invitation',
          estimatedValue: matchedRfq.budget > 0 ? `₹${matchedRfq.budget.toLocaleString('en-IN')}` : undefined,
          deliveryLocation: matchedRfq.deliveryLocation || '',
          status: matchedRfq.status === 'Closed' || matchedRfq.status === 'Expired'
            ? matchedRfq.status
            : (matchedRfq.quotes && matchedRfq.quotes.length > 0 ? 'under_review' : 'pending_bid'),
          majorCategory: matchedRfq.category || '',
          minorCategory: matchedRfq.extractedEntities?.[0]?.minorCategory || '',
          lineItems: (matchedRfq.extractedEntities || []).map((ent: any, idx: number) => ({
            id: ent.id || `item-${idx}`,
            description: ent.itemName,
            quantity: ent.quantity,
            unitPrice: 0,
            leadTimeDays: 0,
            marketBandStatus: 'optimal',
            paymentTerms: '',
          })),
        };
      }
    }
  }

  // Fallback to selectedVendorOpportunity or first available opportunity
  if (!opportunity) {
    opportunity = selectedVendorOpportunity || vendorOpportunities[0];
  }

  if (!opportunity) {
    return (
      <div className="p-6 text-xs text-slate-500 dark:text-gray-400">
        No open opportunity is available to quote on right now.
      </div>
    );
  }

  return <QuotationForm opportunity={opportunity} onBack={backToFeed} onSubmitSuccess={backToBidQuotes} />;
}

export default function VendorQuotationFormPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-xs text-slate-500 dark:text-gray-400">
          Loading quotation form...
        </div>
      }
    >
      <VendorQuotationFormContent />
    </Suspense>
  );
}
