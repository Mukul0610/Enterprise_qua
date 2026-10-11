'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { rfqAttachmentUrl, submitRFQInquiry } from '@/lib/rfqClient';
import { downloadVendorQuotationExcel } from '@/lib/bidComparisonExport';
import type { RFQQuoteAttachment, VendorOpportunity } from '@/lib/types';
import * as XLSX from 'xlsx';
import {
  ArrowLeft,
  Mail,
  Building,
  Building2,
  FileText,
  Info,
  Phone,
  User,
  ShieldCheck,
  CheckCircle2,
  Lock,
  X,
  Copy,
  IndianRupee,
  Send,
  Download,
  Upload,
  AlertCircle,
  MessageSquare,
  HelpCircle,
  Search,
  Paperclip,
} from 'lucide-react';

interface QuotationFormProps {
  opportunity?: VendorOpportunity;
  onBack: () => void;
  onSubmitSuccess?: () => void;
}

interface BuyerContactInfo {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  source: 'buyer_uploaded' | 'quote_submitted';
}

const BUYER_CONTACTS_MAP: Record<string, Omit<BuyerContactInfo, 'source'>> = {
  'RFQ-2026-00421': {
    companyName: 'Larsen & Toubro Ltd. (L&T)',
    contactPerson: 'Rajesh Sharma (Lead Procurement)',
    email: 'client@procucev.com',
    phone: '+91 98201 44520',
  },
  'RFQ-2026-00420': {
    companyName: 'Reliance Industries Ltd. (RIL)',
    contactPerson: 'Sunil Mehta (Senior Sourcing Manager)',
    email: 's.mehta@ril.com',
    phone: '+91 98112 33490',
  },
  'RFQ-2026-00415': {
    companyName: 'Tata Steel Procurement',
    contactPerson: 'Anand Verma (Procurement Lead)',
    email: 'a.verma@tatasteel.com',
    phone: '+91 98450 11200',
  },
  'RFQ-2026-00418': {
    companyName: 'Larsen & Toubro Ltd. (L&T)',
    contactPerson: 'Rajesh Sharma (Lead Procurement)',
    email: 'client@procucev.com',
    phone: '+91 98201 44520',
  },
};

export default function QuotationForm({ opportunity, onBack, onSubmitSuccess }: QuotationFormProps) {
  const router = useRouter();
  const {
    rfqs,
    vendorOpportunities,
    buyerVendors,
    showToast,
    addAuditLog,
    vendorSubscription,
    currentUserSession,
    refreshFromDB,
    adoptCreatedRFQ,
    vendorFreeCreditsRemaining,
    vendorUnlockedRfqIds,
    refreshVendorCredits,
    unlockRFQForVendor,
  } = useApp();
  const [selectedBuyerModal, setSelectedBuyerModal] = useState<(BuyerContactInfo & { rfqNumber: string }) | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [opportunitySearch, setOpportunitySearch] = useState('');
  const [opportunityStatusFilter, setOpportunityStatusFilter] = useState<'all' | 'open' | 'submitted' | 'closed'>('all');

  // This vendor's own backend record id — needed to tell "my submitted quote"
  // apart from any other vendor's quote on the same RFQ, and to submit/download
  // as the real authenticated identity rather than a hardcoded fake vendor.
  const [myVendorId, setMyVendorId] = useState<string | null>(null);
  const [myVendorName, setMyVendorName] = useState<string>('');
  const [myAddedByBuyerCompany, setMyAddedByBuyerCompany] = useState<string | null>(null);
  const [myBuyerId, setMyBuyerId] = useState<string | null>(null);
  const [freeCreditsRemaining, setFreeCreditsRemaining] = useState<number | null>(null);
  const myVendorRecord = buyerVendors?.find(
    (v) => v.email?.toLowerCase() === currentUserSession?.email?.toLowerCase()
  );
  const effectiveFreeCredits = (vendorSubscription as string) === 'standard'
    ? 0
    : (freeCreditsRemaining ?? myVendorRecord?.freeQuotationCredits ?? vendorFreeCreditsRemaining ?? 5);
  // isOwnBuyerRfq depends on myAddedByBuyerCompany, which only exists once
  // this fetch resolves — the deep-link auto-open effect below waits on this
  // flag so it doesn't judge a real direct-buyer RFQ as locked just because
  // the vendor record hadn't loaded yet.
  const [myVendorRecordLoaded, setMyVendorRecordLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadMyVendorRecord() {
      const email = currentUserSession?.email;
      if (!email) {
        setMyVendorRecordLoaded(true);
        return;
      }
      // Session arrived after an earlier no-session pass already flipped this
      // true — reset it so the flag's true->false->true transition still
      // fires the deep-link effect once the real fetch below resolves.
      setMyVendorRecordLoaded(false);
      try {
        // Unauthenticated (no Authorization header) requests to this endpoint
        // only ever resolve vendors with no buyerId/buyerAccountId at all —
        // any buyer-uploaded vendor (this.vendors entries with a buyerId set)
        // requires a resolved scope to be returned. Omitting the token here
        // meant myVendorId never resolved for a buyer-uploaded vendor, so
        // "my submitted quotes" (filtered by q.vendorId === myVendorId)
        // always came back empty for them — a real quote existed server-side
        // under the real vendor id, but the dashboard showed "0 Sent".
        const res = await fetch(`/api/vendors/${encodeURIComponent(email)}`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success && data.data) {
          setMyVendorId(data.data.id);
          setMyVendorName(data.data.name);
          setMyAddedByBuyerCompany(data.data.addedByBuyerCompany || null);
          setMyBuyerId(data.data.buyerId || data.data.buyerAccountId || null);
          if (data.data.freeQuotationCredits !== undefined) {
            setFreeCreditsRemaining(Number(data.data.freeQuotationCredits));
          }
        }
      } catch {
        // Leave myVendorId null — bidding/download actions will surface a
        // clear error rather than silently attributing them to nobody.
      } finally {
        if (!cancelled) setMyVendorRecordLoaded(true);
      }
    }
    loadMyVendorRecord();
    return () => {
      cancelled = true;
    };
  }, [currentUserSession?.email]);

  const authHeaders = (): Record<string, string> => {
    const token = authClient.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // Helper to map RFQs to Parent Companies
  const getParentCompany = (buyerName: string) => buyerName;

  // This vendor's real submitted quotes, read back from the actual RFQ
  // records (rfq.quotes[]) instead of a hardcoded 2-row placeholder list.
  const submittedQuotes = rfqs
    .filter((rfq) =>
      (rfq.quotes || []).some(
        (q: any) =>
          (myVendorId && q.vendorId === myVendorId) ||
          (currentUserSession?.email && q.vendorEmail && q.vendorEmail.toLowerCase() === currentUserSession.email.toLowerCase()) ||
          (myVendorName && q.vendorName && q.vendorName.toLowerCase().trim() === myVendorName.toLowerCase().trim())
      )
    )
    .map((rfq) => {
      const myQuote: any = (rfq.quotes || []).find(
        (q: any) =>
          (myVendorId && q.vendorId === myVendorId) ||
          (currentUserSession?.email && q.vendorEmail && q.vendorEmail.toLowerCase() === currentUserSession.email.toLowerCase()) ||
          (myVendorName && q.vendorName && q.vendorName.toLowerCase().trim() === myVendorName.toLowerCase().trim())
      );
      return {
        rfqNumber: rfq.rfqNumber,
        title: rfq.title,
        submittedDate: myQuote?.submittedAt ? new Date(myQuote.submittedAt).toLocaleString() : '-',
        status: rfq.status === 'PO Generated' ? 'PO Generated' : 'Quote Submitted',
        submissionMethod: 'Portal Submission',
        totalPrice: Number(myQuote?.totalPrice) || 0,
      };
    });

  // Was a hardcoded list of 4 specific RFQ numbers standing in for "this
  // Direct-vs-marketplace reflects the real relationship:
  // When a buyer uploads or adds a vendor, the vendor is buyer-mapped and has unlimited quotations for that buyer's RFQs.
  const isOwnBuyerRfq = (rfqNumber: string) => {
    const rfq = vendorOpportunities.find((o) => o.rfqNumber === rfqNumber);
    if (!rfq) return false;
    if (myAddedByBuyerCompany && rfq.buyer === myAddedByBuyerCompany) return true;
    if (myBuyerId && (rfq as any).buyerAccountId === myBuyerId) return true;
    if (myVendorRecord) {
      if (myVendorRecord.addedByBuyerCompany && rfq.buyer === myVendorRecord.addedByBuyerCompany) return true;
      if (myVendorRecord.buyerId && (rfq as any).buyerAccountId === myVendorRecord.buyerId) return true;
      if (myVendorRecord.buyerAccountId && (rfq as any).buyerAccountId === myVendorRecord.buyerAccountId) return true;
    }
    return false;
  };

  // Compile RFQ Bidding summaries
  const totalReceivedCount = vendorOpportunities.length;
  const totalSubmittedCount = submittedQuotes.length;
  const filteredOpportunities = useMemo(() => {
    const query = opportunitySearch.trim().toLocaleLowerCase();
    return vendorOpportunities.filter((opp) => {
      const quote = submittedQuotes.some((item) => item.rfqNumber === opp.rfqNumber);
      const isClosed = opp.status === 'Closed' || opp.status === 'Expired';
      if (opportunityStatusFilter === 'submitted' && !quote && opp.status !== 'submitted' && opp.status !== 'under_review') return false;
      if (opportunityStatusFilter === 'closed' && !isClosed) return false;
      if (opportunityStatusFilter === 'open' && (isClosed || quote || opp.status === 'submitted')) return false;
      if (!query) return true;
      const rfqRecord = rfqs.find((rfq) => rfq.rfqNumber === opp.rfqNumber);
      const itemNames = (rfqRecord?.extractedEntities || []).map((item) => item.itemName);
      return [
        opp.rfqNumber,
        opp.title,
        opp.buyer,
        opp.status,
        opp.majorCategory,
        rfqRecord?.category || '',
        opp.deliveryLocation,
        rfqRecord?.deliveryLocation || '',
        ...itemNames,
      ]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [vendorOpportunities, submittedQuotes, rfqs, opportunitySearch, opportunityStatusFilter]);

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    showToast('Copied to Clipboard', `${label} copied: ${text}`, 'info');
    setTimeout(() => setCopiedField(null), 2000);
  };

  // ─── Real quote/bid submission ─────────────────────────────────────────
  const [biddingOn, setBiddingOn] = useState<VendorOpportunity | null>(null);
  const [bidUnitPrice, setBidUnitPrice] = useState('');
  // One unit price per RFQ line item, keyed by line item id — only rendered
  // (and only required) when the RFQ has more than one line item. For the
  // common single-item case the form stays exactly as it was: just
  // bidUnitPrice above.
  const [bidLineItemPrices, setBidLineItemPrices] = useState<Record<string, string>>({});
  const [bidLeadTimeDays, setBidLeadTimeDays] = useState('');
  const [bidWarrantyYears, setBidWarrantyYears] = useState('');
  const [bidPaymentTerms, setBidPaymentTerms] = useState('45 Days Net');
  const [bidRemarks, setBidRemarks] = useState('');
  const [bidDocuments, setBidDocuments] = useState<File[]>([]);
  const [uploadedBidDocuments, setUploadedBidDocuments] = useState<RFQQuoteAttachment[]>([]);
  const [isSubmittingQuote, setIsSubmittingQuote] = useState(false);
  const [submitModalError, setSubmitModalError] = useState<string | null>(null);
  const [submitModalSuccess, setSubmitModalSuccess] = useState<{
    rfqNumber: string;
    totalPrice: number;
    unitPrice: number;
    leadTimeDays: number;
    buyerRevealed?: BuyerContactInfo | null;
  } | null>(null);

  // ─── Inquiry / Clarification modal ──────────────────────────────────────
  const [inquiryModal, setInquiryModal] = useState<VendorOpportunity | null>(null);
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [isInquiring, setIsInquiring] = useState(false);
  const [inquirySuccess, setInquirySuccess] = useState(false);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const handleUploadPricedExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !biddingOn) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows: any[] = XLSX.utils.sheet_to_json(worksheet);

        const newPrices: Record<string, string> = { ...bidLineItemPrices };
        let matchedCount = 0;

        jsonRows.forEach((row) => {
          const rawItem = String(row['Item'] || row['Item Name'] || row['Description'] || row['Item Description'] || '').trim().toLowerCase();
          const rawRate = row['Rate (INR)'] ?? row['Rate'] ?? row['Unit Price (INR)'] ?? row['Unit Price'] ?? row['Price'];
          const rateVal = Number(rawRate);

          if (rawItem && Number.isFinite(rateVal) && rateVal > 0) {
            const matched = (biddingOn.lineItems || []).find(
              (li) => (li.description || '').trim().toLowerCase() === rawItem || (li.id && String(row['Item ID'] || '').trim() === li.id)
            );
            if (matched) {
              newPrices[matched.id] = String(rateVal);
              matchedCount++;
            }
          }
        });

        setBidLineItemPrices(newPrices);
        showToast('Excel Imported', `Successfully imported pricing for ${matchedCount} item(s).`, 'success');
      } catch (err: any) {
        showToast('Import Failed', err?.message || 'Could not parse the uploaded Excel file.', 'warning');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const openBidForm = (opp: VendorOpportunity) => {
    setBiddingOn(opp);
    setBidUnitPrice('');
    setBidLineItemPrices({});
    setBidLeadTimeDays('');
    setBidWarrantyYears('');
    setBidPaymentTerms('45 Days Net');
    setBidRemarks('');
    setBidDocuments([]);
    setUploadedBidDocuments([]);
    setSubmitModalError(null);
    setSubmitModalSuccess(null);
  };

  const openInquiryModal = (opp: VendorOpportunity) => {
    setInquiryModal(opp);
    setInquiryMessage('');
    setInquirySuccess(false);
  };

  const handleSendInquiry = async () => {
    if (!inquiryModal || !inquiryMessage.trim()) return;
    setIsInquiring(true);
    try {
      const vendorName = myVendorName || currentUserSession?.name || 'Vendor Partner';
      const vendorEmail = currentUserSession?.email || null;

      const res = await submitRFQInquiry(inquiryModal.id || inquiryModal.rfqNumber, {
        message: inquiryMessage.trim(),
        vendorName,
        vendorEmail,
      });

      addAuditLog(
        `Inquiry / Clarification submitted by ${vendorName} on ${inquiryModal.rfqNumber}: "${inquiryMessage.trim().slice(0, 100)}..."`,
        inquiryModal.rfqNumber,
        vendorEmail || undefined
      );

      if (res.success && res.rfq) {
        adoptCreatedRFQ(res.rfq);
      }

      setInquiryMessage('');
      await refreshFromDB();
      showToast('Clarification Sent', 'Your query has been dispatched to the procurement officer.', 'success');
    } catch (err: any) {
      showToast('Inquiry Failed', err?.message || 'Could not dispatch clarification.', 'warning');
    } finally {
      setIsInquiring(false);
    }
  };

  // Landing here via "Submit Quote Now" (opportunity-feed's reminder banner)
  // passes the specific RFQ as `opportunity` — previously that prop was
  // received but never used, so the navigation just dropped the vendor on
  // the same undifferentiated table regardless of which RFQ they clicked.
  // Auto-open the bid form for it once, if it's actually biddable.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!opportunity || autoOpenedRef.current) return;
    // isOwnBuyerRfq needs myAddedByBuyerCompany, which only exists once the
    // vendor-record fetch resolves — deciding "locked" before that would
    // wrongly treat a real direct-buyer RFQ as marketplace-locked.
    if (!myVendorRecordLoaded) return;
    // vendorOpportunities is hydrated by its own independent fetch
    // (refreshRFQs, in store.tsx) that races the vendor-record fetch above —
    // isOwnBuyerRfq looks the RFQ up in that list, so deciding before it has
    // loaded would wrongly treat a real direct-buyer RFQ as locked forever
    // (autoOpenedRef below only ever fires once). The deep-linked RFQ is
    // always one that's actually in the feed, so waiting for the list to be
    // non-empty is a reliable "has loaded" signal here.
    if (vendorOpportunities.length === 0) return;
    autoOpenedRef.current = true;
    const alreadyQuoted = submittedQuotes.some((q) => q.rfqNumber === opportunity.rfqNumber);
    const locked = !isOwnBuyerRfq(opportunity.rfqNumber) && vendorSubscription !== 'connect' && vendorSubscription !== 'select' && effectiveFreeCredits <= 0;
    if (!alreadyQuoted && !locked) {
      openBidForm(opportunity);
    }
    // Intentionally not reacting to subsequent submittedQuotes/vendorSubscription
    // changes (which would otherwise re-open the modal right after a successful
    // submit) — autoOpenedRef ensures this only ever runs once, on the first
    // render after both the vendor record and the RFQ list have loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myVendorRecordLoaded, vendorOpportunities.length]);

  const handleSubmitQuote = async () => {
    if (!biddingOn) return;
    setSubmitModalError(null);

    const rfqLineItems = biddingOn.lineItems || [];
    const isMultiItem = rfqLineItems.length > 1;

    // Multi-item RFQs price every line item individually; the single-item
    // case keeps today's one blanket-price field unchanged.
    let unitPrice: number;
    let totalPrice: number;
    let lineItemQuotes: Array<{
      lineItemId?: string;
      itemName: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }> | undefined;

    if (isMultiItem) {
      const missing = rfqLineItems.some((li) => {
        const v = Number(bidLineItemPrices[li.id]);
        return !v || v <= 0;
      });
      if (missing) {
        setSubmitModalError('Please enter a valid unit price (greater than 0) for every line item.');
        showToast('Validation Error', 'Enter a unit price for every line item.', 'warning');
        return;
      }
      lineItemQuotes = rfqLineItems.map((li) => {
        const price = Number(bidLineItemPrices[li.id]);
        return {
          lineItemId: li.id,
          itemName: li.description,
          quantity: li.quantity,
          unitPrice: price,
          totalPrice: price * li.quantity,
        };
      });
      totalPrice = lineItemQuotes.reduce((sum, li) => sum + li.totalPrice, 0);
      const totalQty = rfqLineItems.reduce((sum, li) => sum + (li.quantity || 0), 0);
      unitPrice = totalQty > 0 ? totalPrice / totalQty : totalPrice;
      if (!Number.isFinite(unitPrice) || !Number.isFinite(totalPrice)) {
        setSubmitModalError('The entered line-item rates produce an invalid quotation total.');
        showToast('Validation Error', 'Check the line-item quantities and rates.', 'warning');
        return;
      }
    } else {
      unitPrice = Number(bidUnitPrice);
      if (!unitPrice || unitPrice <= 0) {
        setSubmitModalError('Please enter a valid unit price greater than 0.');
        showToast('Validation Error', 'Enter a valid unit price.', 'warning');
        return;
      }
      const quantity = rfqLineItems[0]?.quantity || 1;
      totalPrice = unitPrice * quantity;
      if (!Number.isFinite(totalPrice)) {
        setSubmitModalError('The entered rate produces an invalid quotation total.');
        showToast('Validation Error', 'Check the rate and quantity.', 'warning');
        return;
      }
    }

    setIsSubmittingQuote(true);
    try {
      const attachments = [...uploadedBidDocuments];
      const missingMimeType = bidDocuments.find((file) => !file.type);
      if (missingMimeType) throw new Error(`${missingMimeType.name} has an unsupported file type.`);
      for (const file of bidDocuments.slice(attachments.length)) {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            const encoded = result.split(',')[1];
            if (!encoded) reject(new Error(`Could not read ${file.name}.`));
            else resolve(encoded);
          };
          reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
          reader.readAsDataURL(file);
        });
        const uploadResponse = await fetch(
          `/api/rfqs/${encodeURIComponent(biddingOn.rfqNumber)}/quote-attachments`,
          {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ fileName: file.name, mimeType: file.type, content }),
          }
        );
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok || !uploadData.success || !uploadData.data) {
          throw new Error(uploadData.error || `Could not upload ${file.name}.`);
        }
        attachments.push(uploadData.data as RFQQuoteAttachment);
        setUploadedBidDocuments([...attachments]);
      }

      const res = await fetch(`/api/rfqs/${encodeURIComponent(biddingOn.rfqNumber)}/quotes`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          unitPrice,
          totalPrice,
          ...(lineItemQuotes ? { lineItemQuotes } : {}),
          leadTimeDays: Number(bidLeadTimeDays) || 0,
          warrantyYears: Number(bidWarrantyYears) || 0,
          paymentTerms: bidPaymentTerms,
          remarks: bidRemarks,
          ...(attachments.length ? { attachments } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const errorMsg = data.error || (data.upgradeRequired ? 'Your 5 free quotation credits have been used. Please upgrade your subscription plan to continue submitting quotations.' : 'Failed to submit quotation.');
        setSubmitModalError(errorMsg);
        if (data.upgradeRequired || res.status === 403) {
          showToast('Quotation Credits Exhausted', errorMsg, 'warning');
        } else {
          showToast('Submission Failed', errorMsg, 'warning');
        }
        return;
      }

      addAuditLog(
        `${myVendorName || currentUserSession?.name || 'Vendor'} submitted a quotation for ${biddingOn.rfqNumber} (Unit Price: ${unitPrice})`,
        biddingOn.rfqNumber,
        currentUserSession?.email
      );
      showToast('Quote Submitted', `Your quotation for ${biddingOn.rfqNumber} was submitted successfully.`, 'success');
      
      const isDirect = isOwnBuyerRfq(biddingOn.rfqNumber);
      const targetRfqNum = biddingOn.rfqNumber;
      const baseBuyer = BUYER_CONTACTS_MAP[biddingOn.rfqNumber] || {
        companyName: biddingOn.buyer,
        contactPerson: isDirect ? 'Rajesh Sharma (Lead Procurement)' : 'Strategic Procurement Lead',
        email: isDirect ? 'client@procucev.com' : `procurement@${(biddingOn.buyer || 'buyer').toLowerCase().replace(/[^a-z]/g, '')}.com`,
        phone: '+91 98201 44520',
      };
      const buyerDetails: BuyerContactInfo = {
        ...baseBuyer,
        source: isDirect ? 'buyer_uploaded' : 'quote_submitted',
      };
      setBiddingOn(null);
      setBidDocuments([]);
      setUploadedBidDocuments([]);
      setSelectedBuyerModal({ ...buyerDetails, rfqNumber: targetRfqNum });
      await refreshFromDB();
      if (onSubmitSuccess) onSubmitSuccess();
    } catch (err: any) {
      const msg = err?.message || 'Could not submit the quote. Please check your network and try again.';
      setSubmitModalError(msg);
      showToast('Submission Failed', msg, 'warning');
    } finally {
      setIsSubmittingQuote(false);
    }
  };

  // ─── Real RFQ document download ────────────────────────────────────────
  /** Saves a blob to disk via a throwaway object URL and anchor click. */
  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const isRfqUnlocked = (rfqNumber: string) => {
    if (isOwnBuyerRfq(rfqNumber)) return true;
    const norm = String(rfqNumber).toLowerCase();
    return vendorUnlockedRfqIds.some((id) => String(id).toLowerCase() === norm);
  };

  const handleDownloadRfq = async (opp: VendorOpportunity) => {
    try {
      const res = await fetch(`/api/rfqs/${encodeURIComponent(opp.rfqNumber)}/email-preview`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.exhausted || res.status === 403) {
          showToast('Free Credits Exhausted', data.error || 'You have used all 5 free RFQ download credits. You cannot download another RFQ using your free allowance.', 'warning');
          return;
        }
        throw new Error(data.error || 'Could not generate the RFQ specification.');
      }

      // The RFQ text info (BOQ, deadline, budget etc.) as a real file
      const htmlBody: string = data.data?.htmlBody || '';
      triggerBlobDownload(new Blob([htmlBody], { type: 'text/html' }), `${opp.rfqNumber}-specification.html`);

      // Supporting documents the buyer attached
      try {
        const rfqRes = await fetch(`/api/rfqs/${encodeURIComponent(opp.rfqNumber)}`, { headers: authHeaders() });
        const rfqData = await rfqRes.json();
        const attachments = rfqRes.ok && rfqData.success ? rfqData.data?.attachments || [] : [];
        for (const file of attachments) {
          const fileRes = await fetch(rfqAttachmentUrl(file.id), { headers: authHeaders() });
          if (!fileRes.ok) continue;
          const blob = await fileRes.blob();
          triggerBlobDownload(blob, file.fileName || `${opp.rfqNumber}-attachment`);
        }
      } catch {
        // Ignored
      }

      await refreshVendorCredits();
      await refreshFromDB();

      addAuditLog(
        `${myVendorName || currentUserSession?.name || 'Vendor'} downloaded RFQ specification for ${opp.rfqNumber}`,
        opp.rfqNumber,
        currentUserSession?.email
      );
      showToast('RFQ Downloaded', `RFQ specification for ${opp.rfqNumber} has been downloaded and unlocked.`, 'success');
    } catch (err: any) {
      showToast('Download Failed', err?.message || 'Could not download the RFQ specification.', 'warning');
    }
  };

  return (
    <div className="vendor-quotation-page mx-auto w-full min-w-0 max-w-[1600px] space-y-6 pb-10">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-slate-600 transition hover:bg-white/80 hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white"
      >
        <ArrowLeft size={15} /> Back to Dashboard
      </button>
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* VENDOR SOURCING SUMMARY CARDS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-3 text-xs font-medium sm:grid-cols-2 xl:grid-cols-3 sm:gap-4">
        <div className="flex min-h-[112px] items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-gray-900/80 sm:p-5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-gray-400">RFQs Received (Active Enquiries)</div>
            <span className="mt-2 block font-mono text-2xl font-black text-slate-900 dark:text-white">{totalReceivedCount} <span className="text-base font-semibold">Active</span></span>
          </div>
          <div className="rounded-xl bg-blue-50 p-3 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            <Building size={19} />
          </div>
        </div>

        <div className="flex min-h-[112px] items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-gray-900/80 sm:p-5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-gray-400">Quotations Submitted</div>
            <span className="mt-2 block font-mono text-2xl font-black text-emerald-700 dark:text-emerald-400">{totalSubmittedCount} <span className="text-base font-semibold">Sent</span></span>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
            <Mail size={19} />
          </div>
        </div>

        <div className="flex min-h-[112px] items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-gray-900/80 sm:col-span-2 sm:p-5 xl:col-span-1">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-gray-400">Quotation Credits</div>
            <span className="mt-2 block font-mono text-2xl font-black text-orange-700 dark:text-orange-400">
              {vendorSubscription === 'connect' || vendorSubscription === 'select'
                ? 'Active Plan'
                : `${effectiveFreeCredits} Free Left`}
            </span>
          </div>
          <div className="rounded-xl bg-orange-50 p-3 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
            <ShieldCheck size={19} />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* CONSOLIDATED ACTIVE RFQS RECEIVED TABLE (ENQUIRIES & STATUS) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-gray-900/80">
        <div className="space-y-4 border-b border-slate-100 p-4 dark:border-slate-800 sm:p-5">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-gray-100 sm:text-base">
                <span className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-950/60 dark:text-cyan-300"><FileText size={16} /></span>
                Active sourcing enquiries
              </h2>
              <p className="mt-1 pl-10 text-xs text-slate-500 dark:text-gray-400">Track deadlines, submitted bids, and buyer responses.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-gray-400">
              <Info size={13} className="shrink-0 text-blue-600 dark:text-blue-400" /> Buyer information becomes available for eligible enquiries
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <label className="relative block min-w-0">
              <span className="sr-only">Search enquiries</span>
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={opportunitySearch}
                onChange={(event) => setOpportunitySearch(event.target.value)}
                placeholder="Search RFQ number, title, or buyer..."
                className="has-leading-icon h-11 w-full rounded-xl border-slate-200 bg-slate-50 pr-3 text-sm focus:border-blue-400 focus:bg-white dark:border-slate-700 dark:bg-gray-950 dark:focus:bg-gray-900"
              />
            </label>
            <label className="block min-w-0">
              <span className="sr-only">Filter enquiries by status</span>
              <select
                value={opportunityStatusFilter}
                onChange={(event) => setOpportunityStatusFilter(event.target.value as typeof opportunityStatusFilter)}
                className="h-11 w-full rounded-xl border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-gray-950 dark:text-gray-200"
              >
                <option value="all">All enquiries</option>
                <option value="open">Awaiting your quote</option>
                <option value="submitted">Quote submitted</option>
                <option value="closed">Closed enquiries</option>
              </select>
            </label>
          </div>
          <p aria-live="polite" className="text-xs font-medium text-slate-500 dark:text-gray-400">
            Showing <span className="font-bold text-slate-700 dark:text-gray-200">{filteredOpportunities.length}</span> of {totalReceivedCount} enquiries
          </p>
        </div>

        {filteredOpportunities.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <div className="rounded-full bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-gray-400"><Search size={20} /></div>
            <p className="text-sm font-bold text-slate-700 dark:text-gray-200">
              {vendorOpportunities.length === 0 ? 'No enquiries yet' : 'No matching enquiries'}
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-500 dark:text-gray-400">
              {vendorOpportunities.length === 0
                ? 'New sourcing requests from buyers will appear here.'
                : 'Try another search term or choose a different status filter.'}
            </p>
            {vendorOpportunities.length > 0 && (opportunitySearch || opportunityStatusFilter !== 'all') && (
              <button
                type="button"
                onClick={() => { setOpportunitySearch(''); setOpportunityStatusFilter('all'); }}
                className="mt-1 text-xs font-bold text-blue-700 hover:underline dark:text-cyan-300"
              >
                Clear search and filters
              </button>
            )}
          </div>
        ) : (
        <div className="vendor-quotation-table-wrap">
          <table className="vendor-quotation-table w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-gray-800 text-slate-400 uppercase tracking-wider text-[9px] font-bold">
                <th className="py-3">RFQ Number</th>
                <th className="py-3">RFQ Details</th>
                <th className="py-3">Buyer Company</th>
                <th className="py-3 text-center">Deadline</th>
                <th className="py-3 text-center">RFQ Documents</th>
                <th className="py-3">Your Bid</th>
                <th className="py-3">Clarifications</th>
                <th className="py-3 text-right">Sourcing Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150/40 dark:divide-gray-850 text-[11px]">
              {filteredOpportunities.map((opp) => {
                const quote = submittedQuotes.find((q) => q.rfqNumber === opp.rfqNumber);
                const rfqRecord = rfqs.find((rfq) => rfq.rfqNumber === opp.rfqNumber);
                const allItemDetails = rfqRecord?.extractedEntities?.length
                  ? rfqRecord.extractedEntities
                  : opp.lineItems.map((item) => ({
                    id: item.id,
                    itemName: item.description,
                    quantity: item.quantity,
                    unit: '',
                  }));
                const itemDetails = allItemDetails.slice(0, 2);
                const additionalItemCount = Math.max(0, allItemDetails.length - itemDetails.length);
                const ownInquiries = (rfqRecord?.inquiries || []).filter((inquiry) =>
                  (!!myVendorId && inquiry.vendorId === myVendorId) ||
                  (!!currentUserSession?.email && inquiry.vendorEmail?.toLowerCase() === currentUserSession.email.toLowerCase()) ||
                  (!!myVendorName && inquiry.vendorName?.toLowerCase().trim() === myVendorName.toLowerCase().trim())
                );
                const latestInquiry = ownInquiries.reduce<(typeof ownInquiries)[number] | null>(
                  (latest, inquiry) => !latest || new Date(inquiry.createdAt).getTime() > new Date(latest.createdAt).getTime() ? inquiry : latest,
                  null
                );
                const parentCompany = getParentCompany(opp.buyer);
                const isDirectBuyer = isOwnBuyerRfq(opp.rfqNumber);
                const freeCredits = effectiveFreeCredits;
                const isLocked = !isDirectBuyer && vendorSubscription !== 'connect' && vendorSubscription !== 'select' && freeCredits <= 0;
                
                // Condition: If buyer uploaded this vendor (isOwnBuyerRfq), show even before quote is submitted.
                // Otherwise, show only after quote is submitted and updated in the system (quote !== undefined || opp.status === 'submitted').
                const isUploadedByBuyer = isOwnBuyerRfq(opp.rfqNumber);
                const isQuoteSubmitted = !!quote || opp.status === 'submitted';
                const canViewBuyerDetails = isUploadedByBuyer || isQuoteSubmitted;

                const baseBuyerData = BUYER_CONTACTS_MAP[opp.rfqNumber] || {
                  companyName: parentCompany,
                  contactPerson: isUploadedByBuyer ? 'Rajesh Sharma (Lead Procurement)' : 'Strategic Procurement Lead',
                  email: isUploadedByBuyer ? 'client@procucev.com' : `procurement@${parentCompany.toLowerCase().replace(/[^a-z]/g, '')}.com`,
                  phone: '+91 98201 44520',
                };

                const buyerInfo: BuyerContactInfo = {
                  ...baseBuyerData,
                  source: isUploadedByBuyer ? 'buyer_uploaded' : 'quote_submitted',
                };

                return (
                  <tr key={opp.rfqNumber} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-gray-850/40">
                    {/* RFQ Number */}
                    <td data-label="RFQ Number" className="py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {opp.rfqNumber}
                    </td>
                    
                    {/* Title */}
                    <td data-label="RFQ Details" className="py-3">
                      <div className="font-semibold text-slate-800 dark:text-gray-200">{opp.title}</div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-500 dark:text-gray-400">
                        {(opp.majorCategory || rfqRecord?.category) && (
                          <span>{opp.majorCategory || rfqRecord?.category}</span>
                        )}
                        {(opp.deliveryLocation || rfqRecord?.deliveryLocation) && (
                          <span>· {opp.deliveryLocation || rfqRecord?.deliveryLocation}</span>
                        )}
                      </div>
                      {itemDetails.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-[10px] text-slate-600 dark:text-gray-300">
                          {itemDetails.map((item) => (
                            <li key={item.id}>
                              {item.itemName}
                              {item.quantity > 0 && ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`}
                            </li>
                          ))}
                          {additionalItemCount > 0 && <li>+{additionalItemCount} more item{additionalItemCount === 1 ? '' : 's'}</li>}
                        </ul>
                      )}
                    </td>
                    
                    {/* Buyer Company & Details Icon */}
                    <td data-label="Buyer Company" className="py-3">
                      {canViewBuyerDetails ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-800 dark:text-gray-200">
                            {buyerInfo.companyName}
                          </span>
                          <button
                            onClick={() => setSelectedBuyerModal({ ...buyerInfo, rfqNumber: opp.rfqNumber })}
                            className="p-1 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/80 transition-all border border-indigo-200/50 dark:border-indigo-800/50 inline-flex items-center gap-0.5"
                            title={
                              isUploadedByBuyer 
                                ? 'Buyer Details (Client Uploaded Vendor)' 
                                : 'Buyer Details Unlocked (Quote Submitted)'
                            }
                          >
                            <Info size={12} className="text-indigo-600 dark:text-indigo-400" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500">
                          <span className="italic text-[10px]">Procucev Network Sourced</span>
                          <span
                            className="p-1 rounded-md bg-slate-100 dark:bg-gray-800 text-slate-400 cursor-help inline-flex items-center"
                            title="Buyer details will be revealed after quote is submitted and updated in the system."
                          >
                            <Lock size={11} />
                          </span>
                        </div>
                      )}
                    </td>
                    
                    {/* Deadline */}
                    <td data-label="Deadline" className="py-3 text-center font-medium mono text-amber-700 dark:text-amber-300">{opp.deadline || '—'}</td>
                    
                    {/* Download RFQ */}
                    <td data-label="RFQ Documents" className="py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => router.push(`/vendor/rfq-details?rfq=${encodeURIComponent(opp.rfqNumber)}`)}
                          className="btn btn-secondary btn-xs min-h-9 py-1 px-2.5 flex items-center justify-center gap-1 text-[10px] font-bold border border-slate-200"
                          title="View RFQ Details"
                        >
                          <FileText size={12} className="text-blue-700 dark:text-blue-300" />
                          <span>View Details</span>
                        </button>
                        <button
                          onClick={() => {
                            if (isLocked) {
                              showToast('Premium Locked', 'Please upgrade your subscription to download specifications for this external buyer.', 'warning');
                            } else {
                              handleDownloadRfq(opp);
                            }
                          }}
                          className="btn btn-secondary btn-xs min-h-9 py-1 px-2.5 flex items-center justify-center gap-1 text-[10px] font-bold border border-slate-200"
                          title="Download RFQ Specification"
                        >
                          <Download size={12} className="text-blue-700 dark:text-blue-300" />
                          <span>Download RFQ</span>
                        </button>
                      </div>
                    </td>

                    {/* This vendor's submitted quote only */}
                    <td data-label="Your Bid" className="py-3">
                      {quote ? (
                        <div>
                          <span className="font-bold text-slate-800 dark:text-gray-200">
                            {quote.totalPrice > 0 ? `₹${quote.totalPrice.toLocaleString('en-IN')}` : 'Quote submitted'}
                          </span>
                          <span className="mt-1 block text-[10px] text-slate-500 dark:text-gray-400">
                            {quote.submissionMethod} · {quote.submittedDate}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">No bid submitted</span>
                      )}
                    </td>

                    {/* This vendor's own clarification history */}
                    <td data-label="Clarifications" className="py-3">
                      <div className="flex flex-col items-start gap-1.5">
                        {ownInquiries.length > 0 ? (
                          <span className="text-[10px] font-semibold text-slate-700 dark:text-gray-200">
                            {ownInquiries.length} sent · {latestInquiry?.status === 'answered' ? 'Buyer replied' : 'Awaiting reply'}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">None sent</span>
                        )}
                        {latestInquiry?.reply && (
                          <span className="max-w-[220px] truncate text-[10px] text-slate-500 dark:text-gray-400" title={latestInquiry.reply}>
                            Latest reply: {latestInquiry.reply}
                          </span>
                        )}
                        {!isLocked && opp.status !== 'Closed' && opp.status !== 'Expired' && (
                          <button
                            onClick={() => openInquiryModal(opp)}
                            className="btn btn-secondary btn-xs min-h-8 py-1 px-2.5 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-gray-300"
                            title="Ask a question or raise a clarification with the buyer"
                          >
                            <MessageSquare size={10} />
                            <span>Clarify</span>
                          </button>
                        )}
                      </div>
                    </td>
                    
                    {/* Sourcing Status */}
                    <td data-label="Sourcing Status" className="py-3 text-right">
                      {quote ? (
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wide border inline-block ${
                          quote.status === 'PO Generated' 
                            ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200' 
                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-250'
                        }`}>
                          {quote.status}
                        </span>
                      ) : (opp.status === 'Closed' || opp.status === 'Expired') ? (
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-500 border border-slate-200 dark:border-gray-700">
                          🔒 RFQ Closed
                        </span>
                      ) : isLocked ? (
                        <span className="text-amber-500 font-bold text-[10px]">🔒 Premium Locked</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              if (!isRfqUnlocked(opp.rfqNumber) && !isOwnBuyerRfq(opp.rfqNumber)) {
                                handleDownloadRfq(opp);
                              }
                              openBidForm(opp);
                            }}
                            className="btn btn-emerald btn-xs min-h-9 py-1 px-2.5 inline-flex items-center gap-1 text-[10px] font-bold"
                          >
                            <Send size={10} /> Submit Quote
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* INQUIRY / CLARIFICATION MODAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {inquiryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs text-slate-800 dark:text-gray-200 animate-scale-up">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400">
                  <MessageSquare size={18} />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Raise Issue / Clarification</h3>
                  <span className="text-[10px] text-slate-400 mono">{inquiryModal.rfqNumber}</span>
                </div>
              </div>
              <button
                onClick={() => setInquiryModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              {(() => {
                const rfqRecord = rfqs.find((r) => r.rfqNumber === inquiryModal.rfqNumber || r.id === inquiryModal.id);
                const rawInquiries = rfqRecord?.inquiries || [];
                const myInquiries = rawInquiries.filter(
                  (inq: any) =>
                    !inq.vendorEmail ||
                    !currentUserSession?.email ||
                    inq.vendorEmail.toLowerCase() === currentUserSession?.email.toLowerCase() ||
                    inq.vendorName === (myVendorName || currentUserSession?.name)
                );

                const messages = (myInquiries.length > 0 ? myInquiries : rawInquiries).flatMap((inq: any) => {
                  if (Array.isArray(inq.messages) && inq.messages.length > 0) {
                    return inq.messages;
                  }
                  return [
                    ...(inq.message
                      ? [
                          {
                            id: `msg-${inq.id}-vendor`,
                            senderRole: 'vendor' as const,
                            senderName: inq.vendorName || 'You',
                            message: inq.message,
                            timestamp: inq.createdAt || new Date().toISOString(),
                          },
                        ]
                      : []),
                    ...(inq.reply
                      ? [
                          {
                            id: `msg-${inq.id}-buyer`,
                            senderRole: 'buyer' as const,
                            senderName: inq.repliedBy || 'Buyer Procurement Team',
                            message: inq.reply,
                            timestamp: inq.repliedAt || inq.createdAt || new Date().toISOString(),
                          },
                        ]
                      : []),
                  ];
                }).sort((a: any, b: any) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

                return (
                  <div className="space-y-3">
                    <div className="space-y-2.5 max-h-64 overflow-y-auto p-3 rounded-xl bg-slate-50 dark:bg-gray-950/60 border border-slate-200 dark:border-gray-800">
                      {messages.length === 0 ? (
                        <div className="text-center py-4 space-y-1 text-slate-400">
                          <MessageSquare size={20} className="mx-auto opacity-50 text-blue-500" />
                          <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">No questions asked yet</p>
                          <p className="text-[10px]">Submit your first clarification below to start the direct thread with the buyer.</p>
                        </div>
                      ) : (
                        messages.map((msg: any, idx: number) => {
                          const isVendorMsg = msg.senderRole === 'vendor';
                          return (
                            <div
                              key={msg.id || idx}
                              className={`flex flex-col ${isVendorMsg ? 'items-end' : 'items-start'} space-y-1`}
                            >
                              <div className="flex items-center gap-1 text-[9px] text-slate-400 px-1">
                                <span className="font-bold text-slate-600 dark:text-gray-300">
                                  {isVendorMsg ? `${msg.senderName} (You)` : `${msg.senderName} (Buyer)`}
                                </span>
                                <span>•</span>
                                <span className="mono">
                                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently'}
                                </span>
                              </div>
                              <div
                                className={`p-2.5 rounded-xl text-xs leading-relaxed max-w-[85%] whitespace-pre-wrap break-words shadow-xs ${
                                  isVendorMsg
                                    ? 'bg-blue-600 text-white rounded-tr-xs'
                                    : 'bg-white dark:bg-gray-850 border border-slate-200 dark:border-gray-700 text-slate-900 dark:text-white rounded-tl-xs'
                                }`}
                              >
                                {msg.message}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Ask Question / Technical Clarification
                      </label>
                      <textarea
                        rows={2}
                        value={inquiryMessage}
                        onChange={(e) => setInquiryMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendInquiry();
                          }
                        }}
                        disabled={isInquiring}
                        placeholder="Type your question regarding specs, drawings, delivery, or terms... (Enter to send)"
                        className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-gray-700 text-xs bg-white dark:bg-gray-950 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
                <button onClick={() => setInquiryModal(null)} className="btn btn-ghost btn-sm">
                  Close
                </button>
                <button
                  onClick={handleSendInquiry}
                  disabled={isInquiring || !inquiryMessage.trim()}
                  className="btn btn-primary btn-sm px-4 font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Send size={12} />
                  <span>{isInquiring ? 'Sending...' : 'Send Clarification'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BUYER CONTACT DETAILS MODAL (POPUP) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {selectedBuyerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs text-slate-800 dark:text-gray-200 animate-scale-up">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
                    Buyer Contact Details
                  </h3>
                  <span className="text-[10px] text-slate-400 mono">{selectedBuyerModal.rfqNumber}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedBuyerModal(null)}
                title="Close Buyer Details Modal"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>

            {/* Access Badge */}
            <div>
              {selectedBuyerModal.source === 'buyer_uploaded' ? (
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-[11px] font-semibold">
                    Direct Client Roster: This buyer explicitly invited and uploaded your vendor profile.
                  </span>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/40 text-indigo-800 dark:text-indigo-300 flex items-center gap-2">
                  <ShieldCheck size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="text-[11px] font-semibold">
                    Verified Reveal: Unlocked following official quotation submission and system ingestion.
                  </span>
                </div>
              )}
            </div>

            {/* Contact Details Card */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-gray-850/60 border border-slate-200 dark:border-gray-800 space-y-3">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Buyer Enterprise</span>
                <div className="font-extrabold text-slate-900 dark:text-white text-xs mt-0.5 flex items-center justify-between">
                  <span>{selectedBuyerModal.companyName}</span>
                  <button
                    onClick={() => handleCopyText(selectedBuyerModal.companyName, 'Company Name')}
                    className="text-slate-400 hover:text-indigo-600 text-[10px] flex items-center gap-1 font-normal"
                    title="Copy Company Name"
                  >
                    <Copy size={11} /> {copiedField === 'Company Name' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Contact Person</span>
                <div className="font-bold text-slate-800 dark:text-gray-200 text-xs mt-0.5 flex items-center gap-1.5">
                  <User size={12} className="text-slate-400" />
                  <span>{selectedBuyerModal.contactPerson}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200/60 dark:border-gray-800">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Official Email</span>
                  <a
                    href={`mailto:${selectedBuyerModal.email}`}
                    className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 text-[11px] mt-0.5 truncate"
                  >
                    <Mail size={11} className="shrink-0" />
                    <span>{selectedBuyerModal.email}</span>
                  </a>
                </div>

                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Direct Mobile / Phone</span>
                  <a
                    href={`tel:${selectedBuyerModal.phone}`}
                    className="font-mono text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 text-[11px] mt-0.5"
                  >
                    <Phone size={11} className="shrink-0" />
                    <span>{selectedBuyerModal.phone}</span>
                  </a>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  setSelectedBuyerModal(null);
                  if (onSubmitSuccess) onSubmitSuccess();
                }}
                className="btn btn-primary btn-sm px-4 text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BID / QUOTE SUBMISSION MODAL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {biddingOn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-4 sm:p-6 max-w-6xl max-h-[92vh] overflow-y-auto w-full shadow-2xl space-y-4 text-xs text-slate-800 dark:text-gray-200 animate-scale-up">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400">
                  <Send size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Submit Quotation</h3>
                  <span className="text-[10px] text-slate-400 mono">{biddingOn.rfqNumber} — {biddingOn.title}</span>
                </div>
              </div>
              <button
                onClick={() => !isSubmittingQuote && setBiddingOn(null)}
                title="Close"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>

            {/* Closed RFQ Check */}
            {(biddingOn.status === 'Closed' || biddingOn.status === 'Expired') && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <div>
                  <strong className="block text-xs font-bold">RFQ Bidding Concluded</strong>
                  <span className="text-[11px]">This RFQ has been closed or expired by the buyer. Quotations can no longer be submitted.</span>
                </div>
              </div>
            )}

                {/* Error Banner */}
                {submitModalError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
                      <span className="text-[11px] font-medium leading-relaxed">{submitModalError}</span>
                    </div>
                    {(submitModalError.toLowerCase().includes('credit') || submitModalError.toLowerCase().includes('upgrade')) && (
                      <div className="pt-1">
                        <a
                          href="/vendor/vendor-subscription"
                          className="btn btn-primary btn-xs font-bold inline-flex items-center gap-1 text-[10px]"
                        >
                          Upgrade Plan to Continue Quoting
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {(biddingOn.lineItems?.length || 0) > 1 ? (
                    <div>
                      {(biddingOn.lineItems?.length || 0) > 10 && (
                        <div className="mb-2 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-blue-800 dark:text-blue-300 text-[11px] flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-semibold flex items-center gap-1.5">
                            <Info size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                            Complex RFQ ({biddingOn.lineItems.length} items): For faster submission, download the Excel sheet, enter your rates, and upload it back.
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Line Item Pricing ({biddingOn.lineItems.length} items) *
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            ref={excelInputRef}
                            onChange={handleUploadPricedExcel}
                            accept=".xlsx,.xls,.csv"
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={() => excelInputRef.current?.click()}
                            className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 px-2 py-1 rounded border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 transition-colors"
                            title="Upload filled Excel sheet with item rates"
                          >
                            <Upload size={11} /> Upload Priced Excel
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              downloadVendorQuotationExcel(biddingOn.rfqNumber, biddingOn.lineItems || [], bidLineItemPrices)
                            }
                            className="text-[10px] font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 px-2 py-1 rounded border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 transition-colors"
                            title="Download pre-filled RFQ Excel sheet"
                          >
                            <Download size={11} /> Export as Excel (Download RFQ)
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800">
                        <table className="w-full min-w-[960px] text-left text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-gray-950/60 text-slate-500 dark:text-gray-400 border-b border-slate-200 dark:border-gray-800">
                              <th className="px-2.5 py-2 text-[10px] uppercase font-bold">Item</th>
                              <th className="px-2.5 py-2 text-[10px] uppercase font-bold text-right">Qty</th>
                              <th className="px-2.5 py-2 text-[10px] uppercase font-bold">UOM</th>
                              <th className="px-2.5 py-2 text-[10px] uppercase font-bold min-w-[10rem]">Rate (₹)</th>
                              <th className="px-2.5 py-2 text-[10px] uppercase font-bold text-right min-w-[10rem]">Amount (₹)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                            {(biddingOn.lineItems || []).map((li) => {
                              const rate = Number(bidLineItemPrices[li.id]) || 0;
                              const amount = rate * li.quantity;
                              return (
                                <tr key={li.id}>
                                  <td className="px-2.5 py-1.5 text-slate-700 dark:text-gray-300 max-w-[220px] truncate" title={li.description}>
                                    {li.description}
                                  </td>
                                  <td className="px-2.5 py-1.5 text-right mono text-slate-600 dark:text-gray-300">{li.quantity}</td>
                                  <td className="px-2.5 py-1.5 text-slate-500 dark:text-gray-400">{li.unit || '—'}</td>
                                  <td className="px-2.5 py-1.5">
                                    <input
                                      type="number"
                                      min={0}
                                      aria-label={`Rate for ${li.description}`}
                                      value={bidLineItemPrices[li.id] || ''}
                                      onChange={(e) =>
                                        setBidLineItemPrices((prev) => ({ ...prev, [li.id]: e.target.value }))
                                      }
                                      disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                                      placeholder="0"
                                      className="w-36 px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 text-[12px] font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                                    />
                                  </td>
                                  <td className="px-2.5 py-1.5 text-right mono font-bold text-slate-900 dark:text-white">
                                    {amount > 0 ? amount.toLocaleString('en-IN') : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950/60">
                              <td colSpan={4} className="px-2.5 py-2 text-right font-bold text-slate-700 dark:text-gray-300">
                                Total
                              </td>
                              <td className="px-2.5 py-2 text-right mono font-black text-slate-900 dark:text-white">
                                {(biddingOn.lineItems || [])
                                  .reduce((sum, li) => sum + (Number(bidLineItemPrices[li.id]) || 0) * li.quantity, 0)
                                  .toLocaleString('en-IN')}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Unit Price (₹) *</label>
                      <div className="relative">
                        <IndianRupee size={12} className="absolute left-3 top-2.5 text-slate-400" />
                        <input
                          type="number"
                          min={0}
                          value={bidUnitPrice}
                          onChange={(e) => setBidUnitPrice(e.target.value)}
                          disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                          placeholder="e.g. 25000"
                          className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-bold bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Lead Time (Days)</label>
                      <input
                        type="number"
                        min={0}
                        value={bidLeadTimeDays}
                        onChange={(e) => setBidLeadTimeDays(e.target.value)}
                        disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                        placeholder="e.g. 14"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Warranty (Years)</label>
                      <input
                        type="number"
                        min={0}
                        value={bidWarrantyYears}
                        onChange={(e) => setBidWarrantyYears(e.target.value)}
                        disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                        placeholder="e.g. 1"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-mono font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Payment Terms</label>
                    <input
                      type="text"
                      value={bidPaymentTerms}
                      onChange={(e) => setBidPaymentTerms(e.target.value)}
                      disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                      placeholder="e.g. 45 Days Net, 100% Against Dispatch"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Remarks</label>
                    <textarea
                      value={bidRemarks}
                      onChange={(e) => setBidRemarks(e.target.value)}
                      disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                      rows={2}
                      placeholder="Special notes, inclusions, exclusions, or freight details..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 text-xs font-medium bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Bid Documents (up to 5 files, 10 MB each)
                    </label>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.xls,.xlsx,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg"
                      disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                      onChange={(event) => {
                        const files = Array.from(event.target.files || []);
                        if (files.length > 5) {
                          showToast('Too Many Documents', 'Attach no more than five documents.', 'warning');
                          event.target.value = '';
                          return;
                        }
                        const oversized = files.find((file) => file.size > 10 * 1024 * 1024);
                        if (oversized) {
                          showToast('Document Too Large', `${oversized.name} exceeds the 10 MB limit.`, 'warning');
                          event.target.value = '';
                          return;
                        }
                        setBidDocuments(files);
                        setUploadedBidDocuments([]);
                      }}
                      className="block w-full rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 px-3 py-2 text-xs"
                    />
                    {bidDocuments.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {bidDocuments.map((file, index) => (
                          <li key={`${file.name}-${file.lastModified}`} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-slate-600 dark:text-gray-300">
                              <Paperclip size={12} className="shrink-0" /> {file.name}
                              <span className="text-slate-400">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
                            </span>
                            <button
                              type="button"
                              disabled={isSubmittingQuote}
                              onClick={() => {
                                setBidDocuments((previous) => previous.filter((_, fileIndex) => fileIndex !== index));
                                setUploadedBidDocuments([]);
                              }}
                              className="text-rose-600 hover:underline"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-gray-800">
                  <button onClick={() => setBiddingOn(null)} disabled={isSubmittingQuote} className="btn btn-ghost btn-sm">
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitQuote}
                    disabled={isSubmittingQuote || biddingOn.status === 'Closed' || biddingOn.status === 'Expired'}
                    className="btn btn-primary btn-sm px-4 text-xs font-bold disabled:opacity-50"
                  >
                    <Send size={13} /> {isSubmittingQuote ? 'Submitting...' : 'Submit Quotation'}
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
    );
  }
