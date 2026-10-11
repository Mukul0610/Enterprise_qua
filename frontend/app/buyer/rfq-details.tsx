'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import {
  SOURCING_MODES,
  formatCurrency,
  formatFileSize,
  formatIndianDate,
  formatIndianDateTime,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { rfqAttachmentUrl, updateRFQ, replyToRFQInquiry, submitRFQInquiry } from '@/lib/rfqClient';
import QuoteAttachmentLink from '@/app/components/QuoteAttachmentLink';
import { isBuyerUploaded, isProcucevVendor } from './vendor-summary';
import { downloadFullQuotesExcel, downloadSingleVendorQuoteExcel } from '@/lib/bidComparisonExport';
import type { ExtractedEntity, QuoteComparison, RFQAttachment, RFQInquiry, RFQItem, RFQSource } from '@/lib/types';
import {
  ArrowLeft,
  ClipboardList,
  MapPin,
  Wallet,
  CalendarDays,
  Layers,
  FileText,
  Mail,
  Globe,
  Pencil,
  Search,
  Download,
  Paperclip,
  Trash2,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Inbox,
  ArrowUp,
  ArrowDown,
  X,
  Sparkles,
  Users,
  UserPlus,
  Lock,
  CheckCircle2,
  Check,
  Square,
  CheckSquare,
  Building2,
  MessageSquare,
  Reply,
  Send,
  User,
  Phone,
  Clock,
  CheckCheck,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Package,
} from 'lucide-react';

const DETAILS = UI_STRINGS.rfqDetails;
const EDIT = UI_STRINGS.rfqEdit;

/** Sentinel meaning "no minor-category filter applied". */
const ALL_MINORS = 'all';

/** Confidence at or above this is reported as high rather than needing review. */
const HIGH_CONFIDENCE = 90;

/** Human label for each intake channel an RFQ can arrive through. */
const SOURCE_LABELS: Record<RFQSource, string> = {
  web_portal: DETAILS.sourceWebPortal,
  email_gateway: DETAILS.sourceEmailGateway,
  email_upload: DETAILS.sourceEmailUpload,
  manual_entry: DETAILS.sourceManualEntry,
  ai_extraction: DETAILS.sourceAiExtraction || 'AI Extraction',
};

/** Line-item columns the buyer can order the table by. */
type SortKey = 'item' | 'category' | 'quantity' | 'targetDate';
type SortDirection = 'asc' | 'desc';

export interface VendorChatChannel {
  key: string;
  vendorId?: string;
  vendorName: string;
  vendorEmail?: string | null;
  inquiryId?: string;
  inquiry?: RFQInquiry;
  messages: Array<{
    id: string;
    senderRole: 'vendor' | 'buyer';
    senderName: string;
    senderEmail?: string | null;
    message: string;
    timestamp: string;
  }>;
  status: 'open' | 'answered' | 'no_messages';
  lastMessage?: {
    message: string;
    timestamp: string;
    senderRole: 'vendor' | 'buyer';
  };
  contactPerson?: string | null;
  phone?: string | null;
  isProcucev?: boolean;
}

export interface RFQDetailsProps {
  /** The RFQ to render, or null when the number in the URL matches nothing. */
  rfq: RFQItem | null;
  onBack: () => void;
  /**
   * Open the edit dialog. Optional so the screen can be rendered read-only, and
   * the button is left out entirely rather than shown disabled when it is absent.
   */
  onEdit?: () => void;
  /** Open the delete confirmation. Optional for the same reason. */
  onDelete?: () => void;
  /** Callback when RFQ is modified inline (e.g. suppliers assigned or status changed). */
  onUpdate?: (updatedRfq: RFQItem) => void;
  /** Whether the current view is for a vendor (hides buyer-only supplier roster and invite affordances). */
  isVendorView?: boolean;
}

/** Blank optional values read as explicitly unset rather than as empty cells. */
function orUnset(value: string | undefined): string {
  return value && value.trim() !== '' ? value : DETAILS.unsetValue;
}

/**
 * Whole days between today and a target date, or null when no date is set.
 *
 * Compared at date granularity so a delivery later today counts as due today
 * rather than as already overdue by a fraction of a day.
 */
export function daysUntil(targetDate: string, today = new Date()): number | null {
  if (!targetDate || Number.isNaN(Date.parse(targetDate))) return null;

  const target = new Date(targetDate);
  const startOfTarget = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((startOfTarget - startOfToday) / 86400000);
}

/** How the remaining time to delivery reads, and whether it is a warning. */
function deliveryCountdown(days: number | null): { label: string; overdue: boolean } | null {
  if (days === null) return null;
  if (days === 0) return { label: DETAILS.dueToday, overdue: false };
  if (days < 0) return { label: formatString(DETAILS.overdueBy, { days: Math.abs(days) }), overdue: true };
  return { label: formatString(DETAILS.daysRemaining, { days }), overdue: false };
}

/**
 * Line items as CSV.
 *
 * Every field is quoted and embedded quotes are doubled, so a specification
 * containing a comma or a quote cannot break the column alignment.
 */
export function lineItemsToCsv(items: ExtractedEntity[]): string {
  const headers = [
    DETAILS.colItem,
    DETAILS.colSpecs,
    DETAILS.colMajor,
    DETAILS.colMinor,
    DETAILS.colQty,
    DETAILS.colUnit,
    DETAILS.colTargetDate,
    DETAILS.colConfidence,
  ];
  // Every ExtractedEntity field this exports is a required, non-nullable string or
  // number, so no nullish fallback is needed. Doubling embedded quotes is the RFC
  // 4180 escape, which keeps commas and newlines inside a field intact.
  const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

  return [
    headers.map(cell).join(','),
    ...items.map((item) =>
      [
        item.itemName,
        item.technicalSpecs,
        item.majorCategory,
        item.minorCategory,
        item.quantity,
        item.unit,
        item.targetDate,
        item.confidence,
      ]
        .map(cell)
        .join(',')
    ),
  ].join('\n');
}

/** One label/value pair inside an overview card. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className="text-right font-semibold text-slate-900 dark:text-white min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Overview card with a tinted header strip, a body, and a footer summary line. */
function Card({
  title,
  icon,
  meta,
  footer,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  meta?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex flex-col">
      <header className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-t-xl bg-slate-50 dark:bg-gray-950/60 border-b border-slate-200 dark:border-gray-800">
        <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
          {icon}
          {title}
        </h2>
        {meta && <span className="shrink-0 truncate max-w-[40%]">{meta}</span>}
      </header>
      <div className="p-3 space-y-2 text-xs flex-1">{children}</div>
      {footer && (
        <footer className="px-3.5 py-2 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-gray-400">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Full-width section with a heading, a count pill and optional toolbar. */
function Panel({
  title,
  count,
  subtitle,
  toolbar,
  footer,
  children,
}: {
  title: string;
  /** Omitted by panels that are not a list of anything, such as the summary. */
  count?: number;
  subtitle?: string;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm overflow-hidden">
      <header className="px-3.5 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">{title}</h2>
          {count !== undefined && (
            <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[11px] mono font-bold">
              {count}
            </span>
          )}
          {subtitle && <span className="text-[11px] text-slate-400 dark:text-gray-500">{subtitle}</span>}
        </div>
        {toolbar}
      </header>
      {children}
      {footer && (
        <footer className="px-3.5 py-2 bg-slate-50 dark:bg-gray-950/60 border-t border-slate-200 dark:border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-gray-400 text-center sm:text-left">
          {footer}
        </footer>
      )}
    </section>
  );
}

/**
 * A column header that orders the table by its column.
 *
 * `aria-sort` carries the current state for assistive technology, while the
 * button's own label names what pressing it will do next — announcing "sort
 * descending" on a column already sorted ascending, rather than restating what
 * the header visually shows.
 */
function SortableHeader({
  column,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = 'left',
}: {
  column: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const isActive = activeKey === sortKey;
  const nextDirection: SortDirection = isActive && direction === 'asc' ? 'desc' : 'asc';
  return (
    <th
      scope="col"
      aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-2.5 font-bold ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={formatString(
          nextDirection === 'asc' ? DETAILS.sortAscAria : DETAILS.sortDescAria,
          { column }
        )}
        className={`inline-flex items-center gap-1 uppercase tracking-wider font-bold transition-colors hover:text-indigo-700 dark:hover:text-indigo-300 ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${isActive ? 'text-indigo-700 dark:text-indigo-300' : ''}`}
      >
        {column}
        {isActive &&
          (direction === 'asc' ? (
            <ArrowUp size={11} className="shrink-0" />
          ) : (
            <ArrowDown size={11} className="shrink-0" />
          ))}
      </button>
    </th>
  );
}

/** Small "label: value" pair used inside mobile item/quote cards. */
function CardField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-slate-500 dark:text-gray-400">{label}</span>
      <span className="text-right font-semibold text-slate-900 dark:text-white min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Confidence pill shared by the desktop table cell and the mobile card. */
function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence <= 0) {
    // A keyed row carries no AI confidence, so it says so instead of claiming a
    // score that was never computed.
    return <span className="text-[10px] text-slate-400 dark:text-gray-500">{DETAILS.manualConfidence}</span>;
  }
  const highConfidence = confidence >= HIGH_CONFIDENCE;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
        highConfidence
          ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${highConfidence ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {formatString(highConfidence ? DETAILS.confidenceHigh : DETAILS.confidenceReview, { confidence })}
    </span>
  );
}

/**
 * Screen 1.4 — Buyer RFQ Details.
 *
 * Everything submitted for one RFQ: how it arrived, its commercial and delivery
 * terms, outreach telemetry, every line item with its classification, the
 * supporting documents, and any quotations received.
 *
 * The RFQ is resolved by the caller from the number in the URL rather than held
 * in store state, so the page survives a reload and can be linked to directly.
 *
 * Below the `md` breakpoint, the line-item and quote tables give way to a
 * stacked card list — a fixed-column table forces a horizontal scroll on a
 * phone-width viewport, which hides columns off-screen rather than reflowing
 * them, so a card per row is used instead of `overflow-x-auto` there.
 */
export default function RFQDetails({ rfq, onBack, onEdit, onDelete, onUpdate, isVendorView }: RFQDetailsProps) {
  let router: any = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter();
  } catch {
    router = null;
  }
  const { currentRole, showToast, refreshFromDB, buyerVendors, currentUserSession } = useApp();
  const isVendor = Boolean(isVendorView || currentUserSession?.role === 'vendor');
  const [localRfq, setLocalRfq] = useState<RFQItem | null>(rfq);
  const [isClosing, setIsClosing] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [minorFilter, setMinorFilter] = useState<string>(ALL_MINORS);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  useEffect(() => {
    if (rfq) {
      setLocalRfq((prev) => {
        if (!prev) return rfq;
        const prevAssigned = Array.isArray(prev.assignedVendors) ? prev.assignedVendors : [];
        const incomingAssigned = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
        if (prevAssigned.length > incomingAssigned.length) {
          return { ...rfq, assignedVendors: prevAssigned };
        }
        return rfq;
      });
    }
  }, [rfq]);

  const activeRfq = localRfq || rfq;
  const isV0 =
    activeRfq?.sourcingMode === 'mode_0' ||
    (activeRfq?.sourcingMode as any) === 'v0' ||
    (activeRfq?.sourcingMode as any) === 'version_0';

  const handleCloseRFQ = async () => {
    if (!activeRfq || isClosing) return;
    setIsClosing(true);
    try {
      const result = await updateRFQ(activeRfq.id, { status: 'Closed' });
      if (result.success) {
        setLocalRfq(result.rfq);
        showToast('RFQ Closed', `RFQ ${activeRfq.rfqNumber} has been officially closed.`, 'success');
        await refreshFromDB();
      } else {
        throw new Error(result.error || 'Failed to close RFQ.');
      }
    } catch (err: any) {
      showToast('Action Failed', err?.message || 'Failed to close RFQ.', 'warning');
    } finally {
      setIsClosing(false);
    }
  };

  const [selectedVendorKey, setSelectedVendorKey] = useState<string | null>(null);
  const [chatSearchText, setChatSearchText] = useState('');
  const [chatFilter, setChatFilter] = useState<'all' | 'pending' | 'answered'>('all');
  const [chatInputText, setChatInputText] = useState('');
  const [isSendingChatMessage, setIsSendingChatMessage] = useState(false);
  const chatBottomRef = React.useRef<HTMLDivElement>(null);

  const [replyModalInquiry, setReplyModalInquiry] = useState<RFQInquiry | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [expandedQuoteIds, setExpandedQuoteIds] = useState<Set<string>>(new Set());

  const toggleQuoteExpand = (vendorId: string) => {
    setExpandedQuoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(vendorId)) {
        next.delete(vendorId);
      } else {
        next.add(vendorId);
      }
      return next;
    });
  };

  const checkIsProcucevVendor = useCallback(
    (
      vendorId?: string | null,
      vendorName?: string | null,
      vendorEmail?: string | null,
      extra?: any
    ): boolean => {
      // 1. Direct explicit category checks on provided object
      const category = extra?.vendorCategory || extra?.category;
      if (category === 'Procucev Network' || category === 'Procucev - AI Rec') return true;
      if (category === 'Client List') return false;

      // 2. Check activeRfq.quotes for explicit vendorCategory
      if (activeRfq && Array.isArray(activeRfq.quotes)) {
        const matchedQuote = activeRfq.quotes.find((q: any) =>
          (vendorId && q.vendorId && String(q.vendorId).toLowerCase() === String(vendorId).toLowerCase()) ||
          (vendorName && q.vendorName && String(q.vendorName).toLowerCase().trim() === String(vendorName).toLowerCase().trim())
        );
        if (matchedQuote) {
          if (matchedQuote.vendorCategory === 'Procucev Network' || matchedQuote.vendorCategory === 'Procucev - AI Rec') {
            return true;
          }
          if (matchedQuote.vendorCategory === 'Client List') {
            return false;
          }
        }
      }

      // 3. Check activeRfq.assignedVendors
      if (activeRfq && Array.isArray(activeRfq.assignedVendors)) {
        const matchedAssigned = activeRfq.assignedVendors.find((v: any) => {
          if (typeof v === 'string') {
            return (vendorId && v === vendorId) || (vendorName && v === vendorName);
          }
          return (
            (vendorId && v.id && String(v.id).toLowerCase() === String(vendorId).toLowerCase()) ||
            (vendorEmail && v.email && String(v.email).toLowerCase() === String(vendorEmail).toLowerCase()) ||
            (vendorName && v.name && String(v.name).toLowerCase().trim() === String(vendorName).toLowerCase().trim())
          );
        });
        if (matchedAssigned && typeof matchedAssigned === 'object') {
          const vCat = (matchedAssigned as any).vendorCategory;
          if (vCat === 'Procucev Network' || vCat === 'Procucev - AI Rec') {
            return true;
          }
          if (vCat === 'Client List') {
            return false;
          }
          if (isBuyerUploaded(matchedAssigned)) {
            return false;
          }
        }
      }

      // 4. Check buyerVendors list from useApp()
      if (Array.isArray(buyerVendors)) {
        const matchedBuyer = buyerVendors.find((bv: any) =>
          (vendorId && bv.id && String(bv.id).toLowerCase() === String(vendorId).toLowerCase()) ||
          (vendorEmail && bv.email && String(bv.email).toLowerCase() === String(vendorEmail).toLowerCase()) ||
          (vendorName && bv.name && String(bv.name).toLowerCase().trim() === String(vendorName).toLowerCase().trim())
        );
        if (matchedBuyer) {
          if (isBuyerUploaded(matchedBuyer)) return false;
          return isProcucevVendor(matchedBuyer);
        }
      }

      // 5. Check if the provided object or ID qualifies as buyer uploaded
      if (extra && isBuyerUploaded(extra)) return false;
      if (vendorId && isBuyerUploaded({ id: vendorId })) return false;

      // 6. If extra explicitly has Procucev sources
      const src = String(extra?.source || '').toLowerCase().trim();
      if (src === 'procucev_network' || src === 'category_manager_upload' || src === 'self_onboarded' || src === 'excel') {
        return true;
      }

      return false;
    },
    [activeRfq, buyerVendors]
  );

  const vendorChannels = useMemo<VendorChatChannel[]>(() => {
    if (!activeRfq) return [];

    // ─── If Vendor View: Strictly ONLY show this vendor's direct conversation with the buyer ───
    if (isVendor) {
      const vName = currentUserSession?.name || 'Vendor Partner';
      const vEmail = currentUserSession?.email || null;
      const vId = currentUserSession?.id || null;

      const inquiries = Array.isArray(activeRfq.inquiries) ? activeRfq.inquiries : [];
      const matchedInqs = inquiries.filter(
        (inq) =>
          (vEmail && inq.vendorEmail && inq.vendorEmail.toLowerCase() === vEmail.toLowerCase()) ||
          (vId && inq.vendorId && inq.vendorId === vId) ||
          (inq.vendorName && inq.vendorName.toLowerCase() === vName.toLowerCase())
      );

      const msgs: Array<{
        id: string;
        senderRole: 'vendor' | 'buyer';
        senderName: string;
        senderEmail?: string | null;
        message: string;
        timestamp: string;
      }> = [];

      (matchedInqs.length > 0 ? matchedInqs : inquiries).forEach((inq) => {
        if (Array.isArray(inq.messages) && inq.messages.length > 0) {
          msgs.push(...inq.messages);
        } else {
          if (inq.message) {
            msgs.push({
              id: `msg-${inq.id}-v`,
              senderRole: 'vendor',
              senderName: inq.vendorName || vName,
              senderEmail: inq.vendorEmail,
              message: inq.message,
              timestamp: inq.createdAt || new Date().toISOString(),
            });
          }
          if (inq.reply) {
            msgs.push({
              id: `msg-${inq.id}-b`,
              senderRole: 'buyer',
              senderName: inq.repliedBy || 'Buyer Procurement Team',
              message: inq.reply,
              timestamp: inq.repliedAt || inq.createdAt || new Date().toISOString(),
            });
          }
        }
      });

      msgs.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

      const latestInq = matchedInqs.length > 0 ? matchedInqs[matchedInqs.length - 1] : inquiries[0];
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
      const isProc = checkIsProcucevVendor(vId || latestInq?.vendorId, vName, vEmail, latestInq || currentUserSession);

      return [
        {
          key: 'vendor-direct-channel',
          vendorId: vId || latestInq?.vendorId,
          vendorName: vName,
          vendorEmail: vEmail,
          inquiryId: latestInq?.id,
          inquiry: latestInq,
          messages: msgs,
          status: latestInq?.status || (latestInq?.reply ? 'answered' : (latestInq ? 'open' : 'no_messages')),
          lastMessage: lastMsg
            ? { message: lastMsg.message, timestamp: lastMsg.timestamp, senderRole: lastMsg.senderRole }
            : undefined,
          isProcucev: isProc,
        },
      ];
    }

    // ─── Buyer View: If RFQ is V0, strictly hide all vendor inquiry channels for buyer ───
    if (isV0) return [];

    // ─── Buyer View: Aggregate all vendor channels (V1, V2, V3) ───
    const map = new Map<string, VendorChatChannel>();

    // 1. Inquiries
    const inquiries = Array.isArray(activeRfq.inquiries) ? activeRfq.inquiries : [];
    inquiries.forEach((inq) => {
      const isProc = checkIsProcucevVendor(inq.vendorId, inq.vendorName, inq.vendorEmail, inq);
      // Procucev/internal vendors are shown in the buyer's chat list by name
      // only — their email/phone/other contact details are never exposed.
      // See the `isProc` stripping applied below.

      const key = inq.vendorId || inq.vendorEmail || inq.vendorName || inq.id;
      const msgs = Array.isArray(inq.messages) && inq.messages.length > 0
        ? inq.messages
        : [
            ...(inq.message
              ? [
                  {
                    id: `msg-${inq.id}-vendor`,
                    senderRole: 'vendor' as const,
                    senderName: inq.vendorName,
                    senderEmail: inq.vendorEmail,
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
                    senderName: inq.repliedBy || 'Procurement Team',
                    message: inq.reply,
                    timestamp: inq.repliedAt || inq.createdAt || new Date().toISOString(),
                  },
                ]
              : []),
          ];

      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;

      map.set(key, {
        key,
        vendorId: inq.vendorId,
        vendorName: inq.vendorName || 'Vendor',
        vendorEmail: isProc ? undefined : inq.vendorEmail,
        inquiryId: inq.id,
        inquiry: inq,
        messages: msgs,
        status: inq.status || (inq.reply ? 'answered' : 'open'),
        lastMessage: lastMsg
          ? { message: lastMsg.message, timestamp: lastMsg.timestamp, senderRole: lastMsg.senderRole }
          : undefined,
        isProcucev: isProc,
      });
    });

    // 2. Assigned Vendors
    const assigned = Array.isArray(activeRfq.assignedVendors) ? activeRfq.assignedVendors : [];
    assigned.forEach((v: any) => {
      const vId = typeof v === 'string' ? v : v.id || v.email || v.name;
      const vName = typeof v === 'string' ? v : v.name || 'Assigned Vendor';
      const vEmail = typeof v === 'string' ? null : v.email;
      const vContact = typeof v === 'string' ? null : v.contactPerson;
      const vPhone = typeof v === 'string' ? null : v.phone;

      const isProc = checkIsProcucevVendor(
        typeof v === 'string' ? v : v.id,
        vName,
        vEmail,
        typeof v === 'object' ? v : undefined
      );

      // Procucev/internal vendors are shown by name only — never their
      // email, contact person or phone.
      const key = vId || vEmail || vName;
      const existing = Array.from(map.values()).find(
        (c) => (vEmail && c.vendorEmail === vEmail) || c.vendorName === vName || (vId && c.vendorId === vId)
      );

      if (!existing) {
        map.set(key, {
          key,
          vendorId: typeof v === 'string' ? v : v.id,
          vendorName: vName,
          vendorEmail: isProc ? undefined : vEmail,
          messages: [],
          status: 'no_messages',
          contactPerson: isProc ? undefined : vContact,
          phone: isProc ? undefined : vPhone,
          isProcucev: isProc,
        });
      } else {
        if (!existing.contactPerson && vContact && !isProc) existing.contactPerson = vContact;
        if (!existing.phone && vPhone && !isProc) existing.phone = vPhone;
        if (existing.isProcucev === undefined) existing.isProcucev = isProc;
      }
    });

    // 3. Quoted Vendors
    const quotes = Array.isArray(activeRfq.quotes) ? activeRfq.quotes : [];
    quotes.forEach((q: any) => {
      const isProc = checkIsProcucevVendor(q.vendorId, q.vendorName, q.vendorEmail, q);
      // Procucev/internal vendors are shown by name only.
      const vId = q.vendorId || q.vendorName;
      const key = vId || q.vendorName;
      const existing = Array.from(map.values()).find(
        (c) => c.vendorName === q.vendorName || (q.vendorId && c.vendorId === q.vendorId)
      );

      if (!existing) {
        map.set(key, {
          key,
          vendorId: q.vendorId,
          vendorName: q.vendorName || 'Quoting Vendor',
          messages: [],
          status: 'no_messages',
          isProcucev: isProc,
        });
      } else if (existing.isProcucev === undefined) {
        existing.isProcucev = isProc;
      }
    });

    return Array.from(map.values())
      .sort((a, b) => {
        if (a.status === 'open' && b.status !== 'open') return -1;
        if (b.status === 'open' && a.status !== 'open') return 1;
        if (a.messages.length > 0 && b.messages.length === 0) return -1;
        if (b.messages.length > 0 && a.messages.length === 0) return 1;
        return 0;
      });
  }, [activeRfq, isVendor, isV0, currentUserSession, checkIsProcucevVendor]);

  // Set default selected vendor
  useEffect(() => {
    if (!selectedVendorKey && vendorChannels.length > 0) {
      setSelectedVendorKey(vendorChannels[0].key);
    } else if (
      selectedVendorKey &&
      !vendorChannels.some((c) => c.key === selectedVendorKey) &&
      vendorChannels.length > 0
    ) {
      setSelectedVendorKey(vendorChannels[0].key);
    }
  }, [vendorChannels, selectedVendorKey]);

  const activeChannel = useMemo(() => {
    return vendorChannels.find((c) => c.key === selectedVendorKey) || vendorChannels[0] || null;
  }, [vendorChannels, selectedVendorKey]);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedVendorKey, activeChannel?.messages?.length]);

  const filteredChannels = useMemo(() => {
    let list = vendorChannels;
    if (chatFilter === 'pending') {
      list = list.filter((c) => c.status === 'open');
    } else if (chatFilter === 'answered') {
      list = list.filter((c) => c.status === 'answered');
    }
    const q = chatSearchText.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.vendorName.toLowerCase().includes(q) ||
        (c.vendorEmail && c.vendorEmail.toLowerCase().includes(q)) ||
        (c.contactPerson && c.contactPerson.toLowerCase().includes(q))
    );
  }, [vendorChannels, chatFilter, chatSearchText]);

  const handleSendChatMessage = async (customMessage?: string) => {
    const textToSend = (customMessage || chatInputText).trim();
    if (!textToSend || !activeRfq || isSendingChatMessage) return;

    setIsSendingChatMessage(true);
    try {
      if (isVendor) {
        // Vendor submitting question / clarification to Buyer
        const vendorName = currentUserSession?.name || 'Vendor Partner';
        const vendorEmail = currentUserSession?.email || null;

        const res = await submitRFQInquiry(activeRfq.id || activeRfq.rfqNumber, {
          message: textToSend,
          vendorName,
          vendorEmail,
        });

        if (res.success && res.rfq) {
          setLocalRfq(res.rfq);
          if (onUpdate) onUpdate(res.rfq);
        } else {
          const newMsg = {
            id: `msg-${Date.now()}`,
            senderRole: 'vendor' as const,
            senderName: vendorName,
            senderEmail: vendorEmail,
            message: textToSend,
            timestamp: new Date().toISOString(),
          };
          const existingInqs = Array.isArray(activeRfq.inquiries) ? activeRfq.inquiries : [];
          const updatedInqs = [...existingInqs];
          if (activeChannel?.inquiryId) {
            const idx = updatedInqs.findIndex((i) => i.id === activeChannel.inquiryId);
            if (idx !== -1) {
              updatedInqs[idx] = {
                ...updatedInqs[idx],
                message: textToSend,
                status: 'open',
                messages: [...(updatedInqs[idx].messages || []), newMsg],
              };
            }
          } else {
            updatedInqs.push({
              id: `inq-${Date.now()}`,
              rfqNumber: activeRfq.rfqNumber,
              rfqId: activeRfq.id,
              vendorName,
              vendorEmail,
              message: textToSend,
              createdAt: new Date().toISOString(),
              status: 'open',
              messages: [newMsg],
            });
          }
          const updatedRfq = { ...activeRfq, inquiries: updatedInqs };
          setLocalRfq(updatedRfq);
          if (onUpdate) onUpdate(updatedRfq);
        }

        setChatInputText('');
        await refreshFromDB();
        showToast('Clarification Sent', 'Your query has been dispatched to the procurement officer.', 'success');
      } else {
        // Buyer replying to Vendor
        const senderName = currentUserSession?.name || 'Procurement Team';
        const senderEmail = currentUserSession?.email || 'buyer@enterprise.internal';

        if (!activeChannel) return;

        if (activeChannel.inquiryId) {
          const res = await replyToRFQInquiry(activeRfq.id || activeRfq.rfqNumber, activeChannel.inquiryId, {
            reply: textToSend,
            repliedBy: senderName,
          });
          if (res.success && res.rfq) {
            setLocalRfq(res.rfq);
            if (onUpdate) onUpdate(res.rfq);
          } else {
            const updatedInquiries = (activeRfq.inquiries || []).map((inq) => {
              if (inq.id === activeChannel.inquiryId) {
                const prevMsgs = Array.isArray(inq.messages) && inq.messages.length > 0
                  ? inq.messages
                  : [
                      {
                        id: `msg-${inq.id}-orig`,
                        senderRole: 'vendor' as const,
                        senderName: inq.vendorName,
                        senderEmail: inq.vendorEmail,
                        message: inq.message,
                        timestamp: inq.createdAt || new Date().toISOString(),
                      },
                    ];
                const newMsg = {
                  id: `msg-${Date.now()}`,
                  senderRole: 'buyer' as const,
                  senderName,
                  senderEmail,
                  message: textToSend,
                  timestamp: new Date().toISOString(),
                };
                return {
                  ...inq,
                  reply: textToSend,
                  repliedAt: new Date().toISOString(),
                  repliedBy: senderName,
                  status: 'answered' as const,
                  messages: [...prevMsgs, newMsg],
                };
              }
              return inq;
            });
            const updatedRfq = { ...activeRfq, inquiries: updatedInquiries };
            setLocalRfq(updatedRfq);
            if (onUpdate) onUpdate(updatedRfq);
          }
        } else {
          const newInquiryId = `inq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const timestamp = new Date().toISOString();
          const newMsg = {
            id: `msg-${Date.now()}`,
            senderRole: 'buyer' as const,
            senderName,
            senderEmail,
            message: textToSend,
            timestamp,
          };
          const newInquiry: RFQInquiry = {
            id: newInquiryId,
            rfqNumber: activeRfq.rfqNumber,
            rfqId: activeRfq.id,
            vendorId: activeChannel.vendorId,
            vendorName: activeChannel.vendorName,
            vendorEmail: activeChannel.vendorEmail,
            message: textToSend,
            createdAt: timestamp,
            reply: textToSend,
            repliedAt: timestamp,
            repliedBy: senderName,
            status: 'answered',
            messages: [newMsg],
          };
          const updatedInquiries = [...(activeRfq.inquiries || []), newInquiry];
          const updatedRfq = { ...activeRfq, inquiries: updatedInquiries };
          const res = await updateRFQ(activeRfq.id, { inquiries: updatedInquiries });
          if (res.success && res.rfq) {
            setLocalRfq(res.rfq);
            if (onUpdate) onUpdate(res.rfq);
          } else {
            setLocalRfq(updatedRfq);
            if (onUpdate) onUpdate(updatedRfq);
          }
        }

        setChatInputText('');
        await refreshFromDB();
        showToast('Clarification Sent', `Clarification dispatched to ${activeChannel.vendorName}.`, 'success');
      }
    } catch (err: any) {
      showToast('Dispatch Failed', err?.message || 'Could not send message.', 'warning');
    } finally {
      setIsSendingChatMessage(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyModalInquiry || !replyMessage.trim() || !activeRfq) return;
    setIsSubmittingReply(true);
    try {
      const res = await replyToRFQInquiry(activeRfq.id || activeRfq.rfqNumber, replyModalInquiry.id, {
        reply: replyMessage.trim(),
        repliedBy: currentUserSession?.name || 'Procurement Officer',
      });
      if (res.success && res.rfq) {
        setLocalRfq(res.rfq);
        if (onUpdate) onUpdate(res.rfq);
      } else {
        const updatedInquiries = (activeRfq.inquiries || []).map((inq) =>
          inq.id === replyModalInquiry.id
            ? {
                ...inq,
                reply: replyMessage.trim(),
                repliedAt: new Date().toISOString(),
                status: 'answered' as const,
                repliedBy: currentUserSession?.name || 'Procurement Officer',
              }
            : inq
        );
        const updatedRfq = { ...activeRfq, inquiries: updatedInquiries };
        setLocalRfq(updatedRfq);
        if (onUpdate) onUpdate(updatedRfq);
      }
      await refreshFromDB();
      setReplyModalInquiry(null);
      setReplyMessage('');
      showToast('Clarification Answered', `Response sent to ${replyModalInquiry.vendorName}.`, 'success');
    } catch (err: any) {
      showToast('Reply Failed', err?.message || 'Failed to dispatch reply.', 'warning');
    } finally {
      setIsSubmittingReply(false);
    }
  };

  // GET /api/rfqs/attachments/:id requires authentication, and this app's
  // session token lives only in localStorage (never a cookie) — a plain
  // `<a href>` navigation carries no Authorization header, so it always 401s
  // regardless of whether the user is logged in. Fetching it manually with
  // the header and opening the resulting blob preserves the original inline
  // PDF/image preview behavior while actually authenticating the request.
  const handleViewAttachment = async (file: RFQAttachment) => {
    try {
      const token = authClient.getToken();
      const res = await fetch(rfqAttachmentUrl(file.id), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error('Could not load the attachment.');
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      // The opened tab has its own reference to the blob; safe to release
      // this one once the browser has had a chance to load it.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    } catch (err: any) {
      showToast('Could Not Open Attachment', err?.message || 'Could not load the attachment.', 'warning');
    }
  };

  // Memoised because the `|| []` fallback would otherwise hand every dependent
  // memo a fresh array on each render, recomputing the filter and the CSV needlessly.
  const lineItems = useMemo(() => rfq?.extractedEntities || [], [rfq?.extractedEntities]);

  /** Minor categories actually present, so the filter never offers an empty option. */
  const minorCategories = useMemo(
    () => Array.from(new Set(lineItems.map((i) => i.minorCategory).filter(Boolean))).sort(),
    [lineItems]
  );

  const filteredItems = useMemo(() => {
    const term = itemSearch.trim().toLowerCase();
    return lineItems.filter((item) => {
      const matchesMinor = minorFilter === ALL_MINORS || item.minorCategory === minorFilter;
      const matchesTerm =
        term === '' ||
        `${item.itemName} ${item.technicalSpecs} ${item.majorCategory} ${item.minorCategory} ${item.unit}`
          .toLowerCase()
          .includes(term);
      return matchesMinor && matchesTerm;
    });
  }, [lineItems, itemSearch, minorFilter]);

  /**
   * Sorted view of the filtered rows.
   *
   * Unsorted by default, because a BOQ's own order carries meaning the buyer put
   * there. Comparisons are stable: `sort` on a copy, and equal keys keep their
   * document order so re-sorting on one column never scrambles the rest.
   */
  const visibleItems = useMemo(() => {
    if (!sortKey) return filteredItems;
    const direction = sortDirection === 'asc' ? 1 : -1;
    const compare = (a: ExtractedEntity, b: ExtractedEntity): number => {
      if (sortKey === 'quantity') return (a.quantity - b.quantity) * direction;
      if (sortKey === 'targetDate') {
        // Rows with no date sort last in either direction, so an unanswered field
        // never displaces a real deadline from the top of the list.
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return a.targetDate.localeCompare(b.targetDate) * direction;
      }
      const left = sortKey === 'item' ? a.itemName : `${a.majorCategory} ${a.minorCategory}`;
      const right = sortKey === 'item' ? b.itemName : `${b.majorCategory} ${b.minorCategory}`;
      return left.localeCompare(right) * direction;
    };
    return [...filteredItems].sort(compare);
  }, [filteredItems, sortKey, sortDirection]);

  /** Click a column: sort ascending, then flip, on the same column. */
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  /** Sort control for the mobile card list, where there is no column to click. */
  const sortSelectValue = sortKey ? `${sortKey}:${sortDirection}` : '';
  const onSortSelectChange = (value: string) => {
    if (!value) {
      setSortKey(null);
      return;
    }
    const [key, direction] = value.split(':') as [SortKey, SortDirection];
    setSortKey(key);
    setSortDirection(direction);
  };

  const filtersApplied = itemSearch.trim() !== '' || minorFilter !== ALL_MINORS;
  const clearFilters = () => {
    setItemSearch('');
    setMinorFilter(ALL_MINORS);
  };

  /**
   * A data URL rather than a generated blob and a synthetic click: the anchor is
   * declarative, so React owns the DOM and the export needs no direct DOM calls.
   */
  const csvHref = useMemo(
    () => `data:text/csv;charset=utf-8,${encodeURIComponent(lineItemsToCsv(lineItems))}`,
    [lineItems]
  );

  if (!activeRfq) {
    return (
      <div className="max-w-3xl mx-auto p-8 sm:p-12 text-center rounded-2xl space-y-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
        <AlertCircle size={32} className="mx-auto text-amber-500" />
        <h2 className="text-base font-bold text-slate-900 dark:text-white">{DETAILS.notFoundTitle}</h2>
        <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md mx-auto">{DETAILS.notFoundMessage}</p>
        <button onClick={onBack} className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5">
          <ArrowLeft size={13} /> {DETAILS.backAction}
        </button>
      </div>
    );
  }

  const mode = SOURCING_MODES.find((m) => m.id === activeRfq.sourcingMode);
  const attachments = activeRfq.attachments || [];
  const quotes = activeRfq.quotes || [];
  const resolvedTargetDeliveryDate =
    activeRfq.targetDeliveryDate ||
    (activeRfq as any).target_delivery_date ||
    (activeRfq as any).deadline ||
    (activeRfq as any).deliveryDate ||
    lineItems.find((i) => i.targetDate)?.targetDate ||
    '';
  const countdown = deliveryCountdown(daysUntil(resolvedTargetDeliveryDate));
  const autoClassified = lineItems.filter((i) => i.confidence >= HIGH_CONFIDENCE).length;
  const classifiedPercent = lineItems.length === 0 ? 0 : Math.round((autoClassified / lineItems.length) * 100);
  const totalQuantity = filteredItems.reduce((sum, item) => sum + item.quantity, 0);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'Closed':
        return 'bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border-slate-300 dark:border-gray-700';
      case 'Expired':
        return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
      case 'PO Generated':
        return 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case 'In Evaluation':
      case 'Quotes Received':
        return 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'AI Recommended':
        return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      default:
        return 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/40';
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-2.5 px-1 sm:px-2 lg:px-0 animate-fade-in pb-4">
      {/* Provenance strip */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100 transition-colors"
        >
          <ArrowLeft size={14} /> {DETAILS.backAction}
        </button>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-gray-400">
          <span className="mono">{formatString(DETAILS.raisedOnStrip, { timestamp: formatIndianDateTime(activeRfq.createdAt) })}</span>
          {activeRfq.updatedAt && activeRfq.updatedAt !== activeRfq.createdAt && (
            <span className="mono">
              {formatString(DETAILS.updatedOnStrip, { timestamp: formatIndianDateTime(activeRfq.updatedAt) })}
            </span>
          )}
        </div>
      </div>

      {/* Header bar */}
      <header className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm p-3.5 sm:p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase tracking-wider">
            {DETAILS.documentTypeBadge}
          </span>
          {mode && (
            <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${mode.badgeColor}`}>
              {mode.code}
            </span>
          )}
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadgeClass(activeRfq.status)}`}>
            {activeRfq.status}
          </span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 min-w-0">
            <h1 className="text-lg sm:text-xl lg:text-2xl font-black text-slate-900 dark:text-white mono tracking-tight break-all">
              {activeRfq.rfqNumber}
            </h1>
            <span className="text-xs text-slate-600 dark:text-gray-300 font-medium">{activeRfq.title}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {activeRfq.status !== 'Closed' && (
              <button
                onClick={handleCloseRFQ}
                disabled={isClosing}
                className="btn btn-xs font-bold inline-flex items-center gap-1.5 border border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 disabled:opacity-50"
                title="Close RFQ and conclude bidding"
              >
                <Lock size={12} /> {isClosing ? 'Closing...' : 'Close RFQ'}
              </button>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                aria-label={formatString(EDIT.editAria, { rfqNumber: activeRfq.rfqNumber })}
                className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1.5"
              >
                <Pencil size={12} /> {EDIT.editAction}
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                aria-label={formatString(EDIT.deleteAria, { rfqNumber: activeRfq.rfqNumber })}
                className="btn btn-xs font-bold inline-flex items-center gap-1.5 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                <Trash2 size={12} /> {EDIT.deleteAction}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card
          title={DETAILS.submittedHeading}
          icon={<ClipboardList size={15} className="text-indigo-600 dark:text-indigo-400" />}
          meta={<span className="text-[10px] mono text-slate-400 dark:text-gray-500">{activeRfq.id}</span>}
        >
          <Row label={DETAILS.sourceLabel}>
            <span className="inline-flex items-center gap-1.5">
              {activeRfq.source === 'email_gateway' || activeRfq.source === 'email_upload' ? (
                <Mail size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              ) : activeRfq.source === 'manual_entry' ? (
                <Pencil size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : activeRfq.source === 'ai_extraction' || (!activeRfq.source && activeRfq.aiSummary) ? (
                <Sparkles size={12} className="text-purple-600 dark:text-purple-400 shrink-0" />
              ) : (
                <Globe size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              )}
              {activeRfq.source
                ? (SOURCE_LABELS[activeRfq.source] || activeRfq.source)
                : activeRfq.aiSummary
                  ? (DETAILS.sourceAiExtraction || 'AI Extraction')
                  : DETAILS.unsetValue}
            </span>
          </Row>
          <Row label={DETAILS.createdLabel}>
            <span className="mono">{formatIndianDateTime(activeRfq.createdAt)}</span>
          </Row>
        </Card>

        <Card
          title={DETAILS.commercialHeading}
          icon={<Wallet size={15} className="text-emerald-600 dark:text-emerald-400" />}
          footer={
            <>
              <span>{DETAILS.statusLabel}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusBadgeClass(activeRfq.status)}`}>
                {activeRfq.status}
              </span>
            </>
          }
        >
          <Row label={DETAILS.categoryLabel}>
            <span className="inline-flex items-center gap-1.5">
              <Layers size={12} className="text-slate-400 shrink-0" />
              {activeRfq.category}
            </span>
          </Row>
          <Row label={DETAILS.budgetLabel}>
            {activeRfq.budget > 0 ? (
              <span className="mono">{formatCurrency(activeRfq.budget)}</span>
            ) : (
              <span className="text-slate-400 dark:text-gray-500 font-normal">{DETAILS.unsetValue}</span>
            )}
          </Row>
          <Row label={DETAILS.targetDateLabel}>
            <span>
              <span className="inline-flex items-center gap-1.5 mono">
                <CalendarDays size={12} className="text-slate-400 shrink-0" />
                {orUnset(formatIndianDate(resolvedTargetDeliveryDate))}
              </span>
              {countdown && (
                <span
                  className={`block text-[10px] font-semibold mt-0.5 ${
                    countdown.overdue ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {countdown.label}
                </span>
              )}
            </span>
          </Row>
          <Row label={DETAILS.deliveryLocationLabel}>
            <span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={12} className="text-rose-500 shrink-0" />
                {orUnset(activeRfq.deliveryLocation)}
              </span>
              {activeRfq.deliveryPincode && (
                <span className="block text-[10px] mono text-slate-400 dark:text-gray-500 mt-0.5">
                  {formatString(DETAILS.deliveryPincodeLabel, { pincode: activeRfq.deliveryPincode })}
                </span>
              )}
            </span>
          </Row>
        </Card>
      </div>

      {/* Line items */}
      <Panel
        title={DETAILS.lineItemsHeading}
        count={lineItems.length}
        subtitle={DETAILS.lineItemsSubtitle}
        toolbar={
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
            <div className="flex flex-col xs:flex-row sm:flex-row gap-2">
              <div className="relative flex items-center flex-1 sm:flex-none">
                <Search size={13} className="absolute left-2.5 text-slate-400 pointer-events-none" />
                <input
                  type="search"
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder={DETAILS.lineItemSearchPlaceholder}
                  aria-label={DETAILS.lineItemSearchAria}
                  className="text-xs w-full sm:w-48 lg:w-56 !py-1.5 !pl-8 !pr-2.5 rounded-lg border border-slate-200 dark:border-gray-800"
                />
              </div>
              <select
                value={minorFilter}
                onChange={(e) => setMinorFilter(e.target.value)}
                aria-label={DETAILS.minorFilterAria}
                className="text-xs font-semibold rounded-lg border border-slate-200 dark:border-gray-800 !py-1.5 !px-2.5 w-full sm:w-auto sm:max-w-[13rem]"
              >
                <option value={ALL_MINORS}>{DETAILS.allMinorCategories}</option>
                {minorCategories.map((minor) => (
                  <option key={minor} value={minor}>
                    {minor}
                  </option>
                ))}
              </select>
              {/* Sort control only renders on the mobile card list, where there are
                  no column headers to click. It mirrors the same sortKey/direction
                  state the desktop table's SortableHeader buttons drive. */}
              <select
                value={sortSelectValue}
                onChange={(e) => onSortSelectChange(e.target.value)}
                aria-label={DETAILS.colItem}
                className="md:hidden text-xs font-semibold rounded-lg border border-slate-200 dark:border-gray-800 !py-1.5 !px-2.5 w-full"
              >
                <option value="">Default order</option>
                <option value="item:asc">{DETAILS.colItem} A–Z</option>
                <option value="item:desc">{DETAILS.colItem} Z–A</option>
                <option value="category:asc">{DETAILS.colCategory} A–Z</option>
                <option value="quantity:desc">{DETAILS.colQty} ↓</option>
                <option value="quantity:asc">{DETAILS.colQty} ↑</option>
                <option value="targetDate:asc">{DETAILS.colTargetDate} ↑</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              {filtersApplied && (
                <button
                  onClick={clearFilters}
                  className="btn btn-ghost btn-xs font-bold inline-flex items-center gap-1 text-slate-500 dark:text-gray-400"
                >
                  <X size={12} /> {DETAILS.clearFiltersAction}
                </button>
              )}
              <a
                href={csvHref}
                download={`${activeRfq.rfqNumber}-line-items.csv`}
                aria-label={formatString(DETAILS.exportCsvAria, { rfqNumber: activeRfq.rfqNumber })}
                className="btn btn-secondary btn-xs font-bold flex items-center gap-1.5 flex-1 sm:flex-none justify-center"
              >
                <Download size={12} /> {DETAILS.exportCsvAction}
              </a>
            </div>
          </div>
        }
        footer={
          lineItems.length > 0 ? (
            <>
              <span>
                {formatString(DETAILS.displayingCount, { shown: filteredItems.length, total: lineItems.length })}
              </span>
              <span className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
                <span className="inline-flex items-center gap-1">
                  {DETAILS.totalQuantityLabel}
                  <span className="mono font-bold text-slate-900 dark:text-white tabular-nums">
                    {totalQuantity}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck size={12} />
                  {formatString(DETAILS.parsedSuccessfully, { percent: classifiedPercent })}
                </span>
              </span>
            </>
          ) : undefined
        }
      >
        {lineItems.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-slate-500 dark:text-gray-400">{DETAILS.noLineItems}</p>
        ) : (
          <>
            {/* Desktop / tablet: full table, no horizontal scroll needed once it
                fits four columns instead of eight (spec sits under the item it
                describes, unit under the quantity it counts). */}
            <div className="hidden md:block border-t border-slate-200 dark:border-gray-800">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[640px]">
                  <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-gray-950/95 text-slate-600 dark:text-gray-400 text-[10px] uppercase tracking-wider font-bold">
                    <tr>
                      <th scope="col" className="w-10 px-2.5 py-2 text-right font-bold">
                        {DETAILS.colIndex}
                      </th>
                      <SortableHeader
                        column={DETAILS.colItem}
                        sortKey="item"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={toggleSort}
                      />
                      <SortableHeader
                        column={DETAILS.colCategory}
                        sortKey="category"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={toggleSort}
                      />
                      <SortableHeader
                        column={DETAILS.colQty}
                        sortKey="quantity"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={toggleSort}
                        align="right"
                      />
                      <SortableHeader
                        column={DETAILS.colTargetDate}
                        sortKey="targetDate"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={toggleSort}
                      />
                      <th scope="col" className="px-3 py-2 text-center font-bold">
                        {DETAILS.colConfidence}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item, index) => (
                      <tr
                        key={item.id || `item-${index}`}
                        className="align-top border-t border-slate-100 dark:border-gray-800/70 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-colors"
                      >
                        <td className="px-2.5 py-2 text-right mono text-[10px] text-slate-400 dark:text-gray-600 tabular-nums">
                          {index + 1}
                        </td>
                        <td className="px-3 py-2 max-w-md">
                          <span className="block font-semibold text-slate-900 dark:text-white leading-snug">
                            {item.itemName}
                          </span>
                          {item.technicalSpecs?.trim() && (
                            <span className="block mt-0.5 text-[11px] text-slate-500 dark:text-gray-400 leading-snug">
                              <span className="text-slate-400 dark:text-gray-600">{DETAILS.specsInlineLabel}: </span>
                              {item.technicalSpecs}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold whitespace-nowrap">
                            {item.minorCategory}
                          </span>
                          <span className="block mt-1 text-[10px] text-slate-500 dark:text-gray-500 leading-snug">
                            {item.majorCategory}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className="mono font-bold text-slate-900 dark:text-white tabular-nums">
                            {item.quantity}
                          </span>
                          <span className="block text-[10px] text-slate-500 dark:text-gray-400">{item.unit}</span>
                        </td>
                        <td className="px-3 py-2 mono whitespace-nowrap tabular-nums">{orUnset(formatIndianDate(item.targetDate))}</td>
                        <td className="px-3 py-2 text-center">
                          <ConfidenceBadge confidence={item.confidence} />
                        </td>
                      </tr>
                    ))}

                    {visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center space-y-2">
                          <span className="block text-slate-400 dark:text-gray-500">{DETAILS.noLineItemMatches}</span>
                          <button
                            onClick={clearFilters}
                            className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1"
                          >
                            <X size={12} /> {DETAILS.clearFiltersAction}
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile: one card per row instead of a table forced into horizontal
                scroll, which would hide columns off-screen rather than reflow them. */}
            <div className="md:hidden border-t border-slate-200 dark:border-gray-800 divide-y divide-slate-100 dark:divide-gray-800/70">
              {visibleItems.length === 0 ? (
                <div className="px-4 py-10 text-center space-y-2">
                  <span className="block text-slate-400 dark:text-gray-500 text-xs">{DETAILS.noLineItemMatches}</span>
                  <button
                    onClick={clearFilters}
                    className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1"
                  >
                    <X size={12} /> {DETAILS.clearFiltersAction}
                  </button>
                </div>
              ) : (
                visibleItems.map((item, index) => (
                  <div key={item.id || `item-mob-${index}`} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] mono text-slate-400 dark:text-gray-600 tabular-nums shrink-0 pt-0.5">
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="block font-semibold text-slate-900 dark:text-white leading-snug text-xs">
                          {item.itemName}
                        </span>
                        {item.technicalSpecs?.trim() && (
                          <span className="block mt-0.5 text-[11px] text-slate-500 dark:text-gray-400 leading-snug">
                            <span className="text-slate-400 dark:text-gray-600">{DETAILS.specsInlineLabel}: </span>
                            {item.technicalSpecs}
                          </span>
                        )}
                      </div>
                      <ConfidenceBadge confidence={item.confidence} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold whitespace-nowrap">
                        {item.minorCategory}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-gray-500">{item.majorCategory}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 border-t border-slate-100 dark:border-gray-800/70">
                      <CardField label={DETAILS.colQty}>
                        {item.quantity} <span className="font-normal text-slate-400">{item.unit}</span>
                      </CardField>
                      <CardField label={DETAILS.colTargetDate}>
                        <span className="mono">{orUnset(formatIndianDate(item.targetDate))}</span>
                      </CardField>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </Panel>

      {/* Supporting documents */}
      <Panel
        title={DETAILS.attachmentsHeading}
        count={attachments.length}
        toolbar={<Paperclip size={14} className="text-slate-400" />}
      >
        <div className="px-4 pb-4">
          {attachments.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-gray-400">{DETAILS.noAttachments}</p>
          ) : (
            <ul className="space-y-2">
              {attachments.map((file) => (
                <li
                  key={file.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-950/40"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <FileText size={15} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {file.fileName}
                      </span>
                      <span className="block text-[10px] text-slate-400 dark:text-gray-500 mono">
                        {formatFileSize(file.size)}
                        {file.uploadedAt
                          ? ` · ${formatString(DETAILS.attachmentUploadedOn, {
                              date: formatIndianDate(file.uploadedAt),
                            })}`
                          : ''}
                      </span>
                    </span>
                  </span>
                  {/* Fetched with the session's Authorization header and opened as a
                      blob URL — a plain <a href> can't carry that header, and this
                      endpoint requires it. The browser still previews a PDF or image
                      inline from the blob exactly as it would from a direct URL. */}
                  <button
                    type="button"
                    onClick={() => handleViewAttachment(file)}
                    aria-label={formatString(DETAILS.attachmentViewAria, { fileName: file.fileName })}
                    className="btn btn-secondary btn-xs font-bold flex items-center justify-center gap-1 shrink-0 self-start sm:self-auto"
                  >
                    <ExternalLink size={11} /> {DETAILS.attachmentViewAction}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {/* Assigned & Invited Suppliers (Buyer & Category Manager only — strictly hidden for Vendors and V0 RFQs) */}
      {!isVendor && !isV0 && (() => {
        const rawAssigned = (activeRfq?.assignedVendors && activeRfq.assignedVendors.length > 0)
          ? activeRfq.assignedVendors
          : (activeRfq?.followUpData?.vendors && activeRfq.followUpData.vendors.length > 0)
          ? activeRfq.followUpData.vendors
          : [];

        const normalizedAssigned = rawAssigned.map((v: any, idx: number) => {
          if (typeof v === 'string') {
            const found = (buyerVendors || []).find((bv) => bv.id === v || bv.name === v || bv.email === v);
            return {
              id: v || `vendor-${idx}`,
              name: found?.name || v,
              contactPerson: found?.contactPerson || null,
              email: found?.email || null,
              phone: found?.phone || null,
            };
          }
          const found = (buyerVendors || []).find(
            (bv) => (v.id && bv.id === v.id) || (v.email && bv.email === v.email) || (v.name && bv.name === v.name)
          );
          return {
            id: v.id || `vendor-${idx}`,
            name: v.name || found?.name || v.contactPerson || v.email || 'Enterprise Supplier',
            contactPerson: v.contactPerson || found?.contactPerson || null,
            email: v.email || found?.email || null,
            phone: v.phone || found?.phone || null,
          };
        });

        // For V1, V2, V3: Strictly filter out Procucev Network vendors so buyer only sees private/invited suppliers
        const visibleAssigned = normalizedAssigned.filter(
          (v: any) => !checkIsProcucevVendor(v.id, v.name, v.email, v)
        );

        return (
          <Panel
            title="Assigned & Invited Suppliers"
            count={visibleAssigned.length}
            toolbar={
              <button
                onClick={() => setInviteModalOpen(true)}
                className="btn btn-primary btn-xs font-bold inline-flex items-center gap-1.5"
              >
                <UserPlus size={12} /> Invite Suppliers
              </button>
            }
          >
            <div className="px-4 pb-4">
              {visibleAssigned.length === 0 ? (
                <div className="p-4 text-center rounded-xl bg-slate-50 dark:bg-gray-950/40 border border-slate-200 dark:border-gray-800 space-y-1">
                  <Users size={20} className="mx-auto text-slate-400 opacity-60" />
                  <p className="text-xs font-bold text-slate-700 dark:text-gray-300">No Suppliers Assigned Yet</p>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    Click &quot;Invite Suppliers&quot; to select and dispatch invitations to approved category suppliers.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {visibleAssigned.map((v: any) => (
                    <div
                      key={v.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-950/40 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{v.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          Invited
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-gray-400 space-y-0.5">
                        {v.contactPerson && <p className="truncate">Contact: {v.contactPerson}</p>}
                        {v.email && <p className="mono truncate">{v.email}</p>}
                        {v.phone && <p className="mono">{v.phone}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        );
      })()}

      {/* Vendor quotations */}
      <Panel
        title={DETAILS.quotesHeading}
        count={quotes.length}
        toolbar={
          quotes.length > 0 && activeRfq && (!isV0 || currentRole !== 'buyer') ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => downloadFullQuotesExcel(activeRfq, quotes)}
                className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                title="Download complete vendor quotations breakdown in Excel"
              >
                <Download size={12} /> Download Quotes (Excel)
              </button>
              <button
                onClick={() => router.push(`/buyer/quote-matrix?rfq=${encodeURIComponent(activeRfq.rfqNumber)}`)}
                className="btn btn-primary btn-xs font-bold inline-flex items-center gap-1.5"
              >
                <Sparkles size={12} /> Compare Quotations in Matrix ↗
              </button>
            </div>
          ) : undefined
        }
      >
        {isV0 && currentRole === 'buyer' && !isVendor ? (
          <div className="px-4 pb-10 pt-4 flex flex-col items-center text-center max-w-xl mx-auto space-y-3">
            <span className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-inner">
              <Mail size={26} />
            </span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Quotes Delivered Directly to Email</h3>
            <p className="text-xs text-slate-600 dark:text-gray-300 max-w-md">
              In the V0 flow, when a matched vendor submits a quote, you will receive the complete quotation details directly in your registered email. Quotes are not displayed in the portal for comparison.
            </p>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-800 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-900/40 px-3.5 py-1.5 rounded-full border border-blue-200 dark:border-blue-800 shadow-sm">
              <CheckCircle2 size={13} />
              When vendor submits quote, you will receive quote details in your email
            </span>
          </div>
        ) : currentRole === 'buyer' && !isVendor && activeRfq?.quotesHidden ? (
          <div className="px-4 pb-10 pt-4 flex flex-col items-center text-center max-w-xl mx-auto space-y-3">
            <span className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-inner">
              <Lock size={26} />
            </span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Quotes Sealed (48-Hour Bidding Period)</h3>
            <p className="text-xs text-slate-600 dark:text-gray-300 max-w-md">
              {activeRfq.quotesHiddenReason || 'Received quotations remain hidden from the buyer for 48 hours after release to preserve bidding integrity.'}
            </p>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-900/40 px-3 py-1 rounded-full border border-amber-200 dark:border-amber-800 shadow-sm">
              <Clock size={12} />
              Unseals: {activeRfq.quotesHiddenUntil ? new Date(activeRfq.quotesHiddenUntil).toLocaleString() : 'After 48 hours'} (or when closed)
            </span>
          </div>
        ) : quotes.length === 0 ? (
          <div className="px-4 pb-10 pt-4 flex flex-col items-center text-center max-w-xl mx-auto space-y-3">
            <span className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center">
              <Inbox size={26} className="text-indigo-600 dark:text-indigo-400" />
            </span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{DETAILS.noQuotes}</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400">{DETAILS.noQuotesMessage}</p>
          </div>
        ) : (
          <>
            {/* Desktop / tablet: comparison table. */}
            <div className="hidden md:block overflow-x-auto border-t border-slate-200 dark:border-gray-800">
              <table className="w-full text-left text-xs min-w-[760px]">
                <thead className="bg-slate-50 dark:bg-gray-950/60 text-slate-600 dark:text-gray-400 text-[10px] uppercase tracking-wider font-bold">
                  <tr>
                    <th className="px-4 py-2.5">{DETAILS.colVendor}</th>
                    <th className="px-4 py-2.5 text-right">{DETAILS.colUnitPrice}</th>
                    <th className="px-4 py-2.5 text-right">{DETAILS.colTotalPrice}</th>
                    <th className="px-4 py-2.5">{DETAILS.colLeadTime}</th>
                    <th className="px-4 py-2.5">{DETAILS.colCompliance}</th>
                    <th className="px-4 py-2.5 text-center">{DETAILS.colMatchScore}</th>
                    <th className="px-4 py-2.5">Bid Documents & Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote: QuoteComparison, index: number) => {
                    const pricePts = quote.scoreBreakdown?.price?.weighted ?? Math.round((quote.isBestPrice ? 100 : 80) * 0.45);
                    const leadPts = quote.scoreBreakdown?.leadTime?.weighted ?? Math.round(Math.max(0, Math.min(100, 100 - (quote.leadTimeDays || 14) * 2)) * 0.3);
                    const warPts = quote.scoreBreakdown?.warranty?.weighted ?? Math.round(Math.min(100, Math.max(0, 50 + (quote.warrantyYears || 1) * 10)) * 0.25);
                    const displayScore = quote.aiMatchScore ?? (pricePts + leadPts + warPts);
                    const hasLineItems = Array.isArray(quote.lineItemQuotes) && quote.lineItemQuotes.length > 0;
                    const isExpanded = expandedQuoteIds.has(quote.vendorId);

                    return (
                      <React.Fragment key={quote.vendorId}>
                        <tr
                          className={`border-t border-slate-100 dark:border-gray-800/70 ${
                            index % 2 === 1 ? 'bg-slate-50/50 dark:bg-gray-950/30' : ''
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                              <span>{quote.vendorName}</span>
                              {hasLineItems && (
                                <button
                                  type="button"
                                  onClick={() => toggleQuoteExpand(quote.vendorId)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors"
                                  title="Toggle itemized line items"
                                >
                                  <span>{quote.lineItemQuotes!.length} items</span>
                                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                </button>
                              )}
                            </div>
                            {quote.vendorCategory && (
                              <div className="text-[10px] text-slate-400 dark:text-gray-500">{quote.vendorCategory}</div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right mono">{formatCurrency(quote.unitPrice)}</td>
                          <td className="px-4 py-2.5 text-right mono font-bold">{formatCurrency(quote.totalPrice)}</td>
                          <td className="px-4 py-2.5">{formatString(DETAILS.leadTimeDays, { days: quote.leadTimeDays })}</td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-gray-400">{quote.complianceStatus}</td>
                          <td className="px-4 py-2.5 text-center mono font-bold text-emerald-700 dark:text-emerald-400">
                            {displayScore}%
                          </td>
                          <td className="px-4 py-2.5 min-w-56">
                            <div className="space-y-1.5">
                              <div className="text-[10px] text-slate-500 dark:text-gray-400">
                                {quote.paymentTerms || 'Payment terms not specified'}
                                {quote.submittedAt ? ` · Submitted ${formatIndianDateTime(quote.submittedAt)}` : ''}
                              </div>
                              {quote.remarks && <p className="text-[10px] text-slate-600 dark:text-gray-300 break-words">{quote.remarks}</p>}
                              {(quote.attachments || []).map((attachment) => (
                                <QuoteAttachmentLink
                                  key={attachment.id}
                                  rfqId={activeRfq?.id || activeRfq?.rfqNumber || ''}
                                  attachment={attachment}
                                />
                              ))}
                              <div className="pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => downloadSingleVendorQuoteExcel(activeRfq!, quote)}
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                                  title="Download this vendor quote as Excel"
                                >
                                  <Download size={11} />
                                  <span>Download Quote (Excel)</span>
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {hasLineItems && isExpanded && (
                          <tr className="bg-slate-50/80 dark:bg-gray-950/60 border-t border-slate-100 dark:border-gray-800">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 shadow-inner">
                                <div className="text-[11px] font-bold text-slate-700 dark:text-gray-300 mb-2 flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5 text-blue-500" />
                                    <span>Line Item Breakdown ({quote.lineItemQuotes!.length} items)</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => downloadSingleVendorQuoteExcel(activeRfq!, quote)}
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    <Download size={11} /> Export Items Excel
                                  </button>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-[11px] text-left">
                                    <thead className="text-[10px] uppercase text-slate-400 dark:text-gray-500 border-b border-slate-100 dark:border-gray-800 font-semibold">
                                      <tr>
                                        <th className="py-1.5 px-2.5">Item Name</th>
                                        <th className="py-1.5 px-2.5 text-right">Quantity</th>
                                        <th className="py-1.5 px-2.5 text-right">Unit Price</th>
                                        <th className="py-1.5 px-2.5 text-right">Total Price</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-gray-800/60">
                                      {quote.lineItemQuotes!.map((li, liIdx) => (
                                        <tr key={li.lineItemId || liIdx} className="hover:bg-slate-50/50 dark:hover:bg-gray-800/30">
                                          <td className="py-1.5 px-2.5 font-medium text-slate-800 dark:text-gray-200">{li.itemName}</td>
                                          <td className="py-1.5 px-2.5 text-right text-slate-600 dark:text-gray-400 mono">
                                            {li.quantity.toLocaleString('en-IN')} {li.unit || ''}
                                          </td>
                                          <td className="py-1.5 px-2.5 text-right text-slate-800 dark:text-gray-200 mono font-medium">
                                            {formatCurrency(li.unitPrice)}
                                          </td>
                                          <td className="py-1.5 px-2.5 text-right text-slate-900 dark:text-white mono font-bold">
                                            {formatCurrency(li.totalPrice)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: one card per vendor. */}
            <div className="md:hidden border-t border-slate-200 dark:border-gray-800 divide-y divide-slate-100 dark:divide-gray-800/70">
              {quotes.map((quote: QuoteComparison) => {
                const pricePts = quote.scoreBreakdown?.price?.weighted ?? Math.round((quote.isBestPrice ? 100 : 80) * 0.45);
                const leadPts = quote.scoreBreakdown?.leadTime?.weighted ?? Math.round(Math.max(0, Math.min(100, 100 - (quote.leadTimeDays || 14) * 2)) * 0.3);
                const warPts = quote.scoreBreakdown?.warranty?.weighted ?? Math.round(Math.min(100, Math.max(0, 50 + (quote.warrantyYears || 1) * 10)) * 0.25);
                const displayScore = quote.aiMatchScore ?? (pricePts + leadPts + warPts);
                const hasLineItems = Array.isArray(quote.lineItemQuotes) && quote.lineItemQuotes.length > 0;
                const isExpanded = expandedQuoteIds.has(quote.vendorId);

                return (
                  <div key={quote.vendorId} className="p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">{quote.vendorName}</span>
                      <span className="mono font-bold text-emerald-700 dark:text-emerald-400 text-xs shrink-0">
                        {displayScore}% {DETAILS.colMatchScore}
                      </span>
                    </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <CardField label={DETAILS.colUnitPrice}>
                      <span className="mono">{formatCurrency(quote.unitPrice)}</span>
                    </CardField>
                    <CardField label={DETAILS.colTotalPrice}>
                      <span className="mono">{formatCurrency(quote.totalPrice)}</span>
                    </CardField>
                    <CardField label={DETAILS.colLeadTime}>
                      {formatString(DETAILS.leadTimeDays, { days: quote.leadTimeDays })}
                    </CardField>
                    <CardField label={DETAILS.colCompliance}>{quote.complianceStatus}</CardField>
                    <div className="col-span-2 rounded-lg bg-slate-50 dark:bg-gray-950/50 p-2.5 space-y-1.5">
                      <p className="text-[10px] text-slate-600 dark:text-gray-300">
                        {quote.paymentTerms || 'Payment terms not specified'}
                        {quote.submittedAt ? ` · Submitted ${formatIndianDateTime(quote.submittedAt)}` : ''}
                      </p>
                      {quote.remarks && <p className="text-[10px] text-slate-500 dark:text-gray-400">{quote.remarks}</p>}
                      {(quote.attachments || []).map((attachment) => (
                        <QuoteAttachmentLink
                          key={attachment.id}
                          rfqId={activeRfq?.id || activeRfq?.rfqNumber || ''}
                          attachment={attachment}
                        />
                      ))}
                      <div className="pt-1 border-t border-slate-200 dark:border-gray-800">
                        <button
                          type="button"
                          onClick={() => downloadSingleVendorQuoteExcel(activeRfq!, quote)}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <Download size={11} /> Download Vendor Quote (Excel)
                        </button>
                      </div>
                    </div>
                    {hasLineItems && (
                      <div className="col-span-2 pt-1">
                        <button
                          type="button"
                          onClick={() => toggleQuoteExpand(quote.vendorId)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-gray-800 text-[11px] font-medium text-slate-700 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700 transition-colors"
                        >
                          <span className="flex items-center gap-1.5">
                            <Package className="w-3.5 h-3.5 text-blue-500" />
                            <span>Line Item Breakdown ({quote.lineItemQuotes!.length} items)</span>
                          </span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-1.5 border-t border-slate-200 dark:border-gray-800 pt-2">
                            {quote.lineItemQuotes!.map((li, liIdx) => (
                              <div key={li.lineItemId || liIdx} className="p-2 rounded bg-slate-50 dark:bg-gray-950/40 text-[10px] flex items-center justify-between gap-2">
                                <div className="truncate">
                                  <div className="font-semibold text-slate-800 dark:text-gray-200 truncate">{li.itemName}</div>
                                  <div className="text-slate-500 dark:text-gray-400 mono">
                                    {li.quantity.toLocaleString('en-IN')} {li.unit || ''} × {formatCurrency(li.unitPrice)}
                                  </div>
                                </div>
                                <div className="font-bold text-slate-900 dark:text-white mono shrink-0">
                                  {formatCurrency(li.totalPrice)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>

      {/* Vendor Inquiries & Clarifications Chat Desk */}
      {(!isVendor ? !isV0 : true) && (
        <Panel
          title={isVendor ? 'Direct Clarification & Inquiry with Buyer' : 'Vendor Inquiries & Clarifications'}
        count={isVendor ? undefined : vendorChannels.length}
        subtitle={
          isVendor
            ? 'Official Real-Time Technical & Commercial Query Thread'
            : vendorChannels.some((c) => c.status === 'open')
            ? `${vendorChannels.filter((c) => c.status === 'open').length} pending clarification(s)`
            : 'Live Clarification Thread'
        }
        toolbar={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Chat Active
            </span>
          </div>
        }
      >
        {isVendor ? (
          /* ═══ VENDOR VIEW: DEDICATED FULL-WIDTH DIRECT CHAT (NO LEFT SIDEBAR, NO QUICK REPLY) ═══ */
          <div className="w-full h-[540px] flex flex-col bg-white dark:bg-gray-900 border-t border-slate-200 dark:border-gray-800 overflow-hidden">
            {/* Header: Buyer Info */}
            <div className="p-3.5 border-b border-slate-200 dark:border-gray-800 bg-slate-50/70 dark:bg-gray-950/40 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  <Building2 size={15} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Buyer: {activeRfq.buyerAccountName || 'Lead Procurement Manager'}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      Direct Line Active
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-2 truncate">
                    {(activeRfq.raisedByEmail || activeRfq.sourceEmail) && (
                      <span className="mono truncate">{activeRfq.raisedByEmail || activeRfq.sourceEmail}</span>
                    )}
                    <span>•</span>
                    <span className="mono font-semibold text-slate-500 dark:text-gray-400">RFQ #{activeRfq.rfqNumber}</span>
                  </div>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                <span className="badge badge-neutral text-[9px] mono font-bold">
                  {activeRfq.rfqNumber}
                </span>
              </div>
            </div>

            {/* Message Stream */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-slate-50/30 dark:bg-gray-950/20">
              {(!activeChannel || activeChannel.messages.length === 0) ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2.5 text-slate-400">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <MessageSquare size={24} />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-gray-200">
                    Direct Clarification Thread with Buyer
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md">
                    Have questions regarding technical drawings, delivery milestones, payment terms, or compliance specs? Send your inquiries below for official clarification from the buyer.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-center my-1">
                    <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-200/70 dark:bg-gray-800 text-slate-500 dark:text-gray-400 mono">
                      Official RFQ Clarification Log
                    </span>
                  </div>

                  {activeChannel.messages.map((msg, mIdx) => {
                    const isMyMessage = msg.senderRole === 'vendor';

                    return (
                      <div
                        key={msg.id || mIdx}
                        className={`flex flex-col ${isMyMessage ? 'items-end' : 'items-start'} space-y-1`}
                      >
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 px-1">
                          <span className="font-bold text-slate-600 dark:text-gray-300 inline-flex items-center gap-1">
                            {isMyMessage ? `${msg.senderName || 'You'} (Supplier)` : `${msg.senderName || activeRfq.buyerAccountName || 'Buyer Procurement Team'} (Buyer)`}
                            {isMyMessage && activeChannel?.isProcucev && (
                              <span className="px-1.5 py-0.2 rounded-full text-[8px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 inline-flex items-center gap-0.5 shadow-xs">
                                <ShieldCheck size={9} className="text-emerald-600 dark:text-emerald-400" />
                                Procucev Vendor
                              </span>
                            )}
                          </span>
                          <span>•</span>
                          <span className="mono">
                            {msg.timestamp ? formatIndianDateTime(msg.timestamp) : 'Recently'}
                          </span>
                        </div>

                        <div
                          className={`p-3 rounded-2xl text-xs leading-relaxed max-w-[85%] sm:max-w-[70%] shadow-xs whitespace-pre-wrap break-words ${
                            isMyMessage
                              ? 'bg-indigo-600 text-white rounded-tr-xs'
                              : 'bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 text-slate-900 dark:text-white rounded-tl-xs'
                          }`}
                        >
                          {msg.message}
                        </div>

                        {isMyMessage && (
                          <div className="flex items-center gap-1 text-[9px] text-indigo-500 dark:text-indigo-400 pr-1">
                            <CheckCheck size={11} />
                            <span>Dispatched & Logged</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={chatBottomRef} />
                </>
              )}
            </div>

            {/* Vendor Composer (No Quick Reply bar) */}
            <div className="p-3 border-t border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-end gap-2 shrink-0">
              <div className="flex-1 relative">
                <textarea
                  rows={2}
                  value={chatInputText}
                  onChange={(e) => setChatInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChatMessage();
                    }
                  }}
                  disabled={isSendingChatMessage}
                  placeholder="Type your clarification or question to the buyer... (Enter to send, Shift+Enter for new line)"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-gray-700 text-xs bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="button"
                onClick={() => handleSendChatMessage()}
                disabled={isSendingChatMessage || !chatInputText.trim()}
                className="btn btn-primary btn-md px-4 font-bold inline-flex items-center gap-1.5 shrink-0 self-stretch disabled:opacity-50"
              >
                <Send size={14} />
                <span>{isSendingChatMessage ? 'Sending...' : 'Send Inquiry'}</span>
              </button>
            </div>
          </div>
        ) : vendorChannels.length === 0 ? (
          /* ═══ BUYER VIEW: EMPTY STATE ═══ */
          <div className="p-8 text-center bg-slate-50 dark:bg-gray-950/40 border-t border-slate-200 dark:border-gray-800 space-y-2">
            <MessageSquare size={32} className="mx-auto text-slate-400 opacity-60" />
            <p className="text-xs font-bold text-slate-700 dark:text-gray-300">No Vendors or Clarifications Active</p>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 max-w-sm mx-auto">
              Assign or invite suppliers to this RFQ to enable instant 2-way real-time technical & commercial clarifications.
            </p>
            <button
              type="button"
              onClick={() => setInviteModalOpen(true)}
              className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1 mt-2"
            >
              <UserPlus size={12} />
              <span>Invite Suppliers</span>
            </button>
          </div>
        ) : (
          /* ═══ BUYER VIEW: 2-COLUMN SPLIT DESK (LEFT VENDOR LIST, RIGHT CHAT WORKSPACE) ═══ */
          <div className="flex flex-col md:flex-row h-[560px] border-t border-slate-200 dark:border-gray-800 overflow-hidden">
            {/* Left Roster Column */}
            <div className="w-full md:w-80 lg:w-88 border-r border-slate-200 dark:border-gray-800 bg-slate-50/70 dark:bg-gray-950/40 flex flex-col shrink-0">
              {/* Search & Filter */}
              <div className="p-3 border-b border-slate-200 dark:border-gray-800 space-y-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="search"
                    value={chatSearchText}
                    onChange={(e) => setChatSearchText(e.target.value)}
                    placeholder="Search vendor..."
                    className="w-full text-xs pl-7 pr-2 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setChatFilter('all')}
                    className={`px-2 py-0.5 rounded-md font-bold transition-colors ${
                      chatFilter === 'all'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-gray-200 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800'
                    }`}
                  >
                    All ({vendorChannels.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatFilter('pending')}
                    className={`px-2 py-0.5 rounded-md font-bold transition-colors ${
                      chatFilter === 'pending'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-gray-200 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800'
                    }`}
                  >
                    Pending ({vendorChannels.filter((c) => c.status === 'open').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatFilter('answered')}
                    className={`px-2 py-0.5 rounded-md font-bold transition-colors ${
                      chatFilter === 'answered'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-gray-200 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800'
                    }`}
                  >
                    Answered ({vendorChannels.filter((c) => c.status === 'answered').length})
                  </button>
                </div>
              </div>

              {/* Vendor Channel Items List */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-gray-855">
                {filteredChannels.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-xs">
                    No vendors found matching filter.
                  </div>
                ) : (
                  filteredChannels.map((channel) => {
                    const isSelected = activeChannel?.key === channel.key;
                    const hasUnanswered = channel.status === 'open';

                    return (
                      <div
                        key={channel.key}
                        onClick={() => setSelectedVendorKey(channel.key)}
                        className={`p-3 cursor-pointer transition-all flex items-start gap-2.5 ${
                          isSelected
                            ? 'bg-white dark:bg-gray-900 border-l-4 border-l-indigo-600 dark:border-l-indigo-400 shadow-xs'
                            : 'hover:bg-slate-100/60 dark:hover:bg-gray-900/50'
                        }`}
                      >
                        <div className="relative shrink-0 mt-0.5">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                              isSelected
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-200 dark:bg-gray-800 text-slate-700 dark:text-gray-300'
                            }`}
                          >
                            {(channel.vendorName || 'V').charAt(0).toUpperCase()}
                          </div>
                          {hasUnanswered && (
                            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-500 rounded-full ring-2 ring-white dark:ring-gray-900 animate-pulse" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`text-xs font-bold truncate block ${
                                  isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-white'
                                }`}
                              >
                                {channel.vendorName}
                              </span>
                              {channel.isProcucev && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 inline-flex items-center gap-0.5 shadow-xs">
                                  <ShieldCheck size={10} className="text-emerald-600 dark:text-emerald-400" />
                                  Procucev Vendor
                                </span>
                              )}
                            </div>
                            {channel.lastMessage && (
                              <span className="text-[9px] text-slate-400 mono shrink-0">
                                {new Date(channel.lastMessage.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
                          </div>

                          <p className="text-[11px] text-slate-500 dark:text-gray-400 truncate line-clamp-1">
                            {channel.lastMessage
                              ? `${channel.lastMessage.senderRole === 'buyer' ? 'You: ' : ''}${channel.lastMessage.message}`
                              : 'No messages yet in this thread'}
                          </p>

                          <div className="flex items-center gap-1.5 pt-0.5">
                            {channel.status === 'open' ? (
                              <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                Pending Reply
                              </span>
                            ) : channel.status === 'answered' ? (
                              <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                Answered
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded text-[8px] font-medium bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400">
                                Ready
                              </span>
                            )}
                            {channel.messages.length > 0 && (
                              <span className="text-[9px] text-slate-400 mono">
                                {channel.messages.length} msg{channel.messages.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Chat Column for Buyer */}
            <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-900 min-w-0">
              {activeChannel ? (
                <>
                  {/* Active Header */}
                  <div className="p-3.5 border-b border-slate-200 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-950/40 flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold text-xs shrink-0">
                        {(activeChannel.vendorName || 'V').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {activeChannel.vendorName}
                          </h3>
                          {activeChannel.isProcucev && (
                            <span className="shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 inline-flex items-center gap-1 shadow-xs">
                              <ShieldCheck size={10} className="text-emerald-600 dark:text-emerald-400" />
                              Procucev Vendor
                            </span>
                          )}
                          {activeChannel.status === 'open' ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              Requires Response
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              All Answered
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-2 truncate">
                          {activeChannel.contactPerson && (
                            <span className="flex items-center gap-1">
                              <User size={10} /> {activeChannel.contactPerson}
                            </span>
                          )}
                          {activeChannel.vendorEmail && (
                            <span className="mono truncate">{activeChannel.vendorEmail}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <span className="badge badge-neutral text-[9px] mono font-bold">
                        {activeRfq.rfqNumber}
                      </span>
                    </div>
                  </div>

                  {/* Messages Feed */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30 dark:bg-gray-950/20">
                    {activeChannel.messages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 text-slate-400">
                        <MessageSquare size={28} className="opacity-40 text-indigo-500" />
                        <h4 className="text-xs font-bold text-slate-700 dark:text-gray-300">
                          Direct Thread with {activeChannel.vendorName}
                        </h4>
                        <p className="text-[11px] max-w-sm">
                          Send specification notes, delivery instructions, or preliminary technical clarifications directly to this vendor.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-center my-1">
                          <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-200/70 dark:bg-gray-800 text-slate-500 dark:text-gray-400 mono">
                            Official RFQ Clarification Log
                          </span>
                        </div>

                        {activeChannel.messages.map((msg, mIdx) => {
                          const isBuyer = msg.senderRole === 'buyer';

                          return (
                            <div
                              key={msg.id || mIdx}
                              className={`flex flex-col ${isBuyer ? 'items-end' : 'items-start'} space-y-1`}
                            >
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 px-1">
                                <span className="font-bold text-slate-600 dark:text-gray-300 inline-flex items-center gap-1">
                                  {isBuyer ? `${msg.senderName} (You)` : `${msg.senderName} (Supplier)`}
                                  {!isBuyer && activeChannel?.isProcucev && (
                                    <span className="px-1.5 py-0.2 rounded-full text-[8px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 inline-flex items-center gap-0.5 shadow-xs">
                                      <ShieldCheck size={9} className="text-emerald-600 dark:text-emerald-400" />
                                      Procucev Vendor
                                    </span>
                                  )}
                                </span>
                                <span>•</span>
                                <span className="mono">
                                  {msg.timestamp ? formatIndianDateTime(msg.timestamp) : 'Recently'}
                                </span>
                              </div>

                              <div
                                className={`p-3 rounded-2xl text-xs leading-relaxed max-w-[85%] sm:max-w-[75%] shadow-xs whitespace-pre-wrap break-words ${
                                  isBuyer
                                    ? 'bg-indigo-600 text-white rounded-tr-xs'
                                    : 'bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 text-slate-900 dark:text-white rounded-tl-xs'
                                }`}
                              >
                                {msg.message}
                              </div>

                              {isBuyer && (
                                <div className="flex items-center gap-1 text-[9px] text-indigo-500 dark:text-indigo-400 pr-1">
                                  <CheckCheck size={11} />
                                  <span>Logged & Verified</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <div ref={chatBottomRef} />
                      </>
                    )}
                  </div>

                  {/* Buyer Composer */}
                  <div className="p-3 border-t border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-end gap-2 shrink-0">
                    <div className="flex-1 relative">
                      <textarea
                        rows={2}
                        value={chatInputText}
                        onChange={(e) => setChatInputText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendChatMessage();
                          }
                        }}
                        disabled={isSendingChatMessage}
                        placeholder={`Type clarification response to ${activeChannel.vendorName}... (Enter to send, Shift+Enter for new line)`}
                        className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-gray-700 text-xs bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSendChatMessage()}
                      disabled={isSendingChatMessage || !chatInputText.trim()}
                      className="btn btn-primary btn-md px-4 font-bold inline-flex items-center gap-1.5 shrink-0 self-stretch disabled:opacity-50"
                    >
                      <Send size={14} />
                      <span>{isSendingChatMessage ? 'Sending...' : 'Send'}</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center p-6 text-center text-slate-400">
                  Select a vendor from the left to view the clarification thread.
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>
      )}

      {/* Buyer Reply Modal */}
      {replyModalInquiry && (
        <div className="modal-overlay !z-[1200] fixed inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-lg p-6 bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-gray-800 space-y-4 animate-scale-up">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400">
                  <Reply size={18} />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">Answer Vendor Clarification</h3>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                    <span>
                      Replying to <span className="font-bold text-slate-700 dark:text-gray-300">{replyModalInquiry.vendorName}</span>
                    </span>
                    {checkIsProcucevVendor(replyModalInquiry.vendorId, replyModalInquiry.vendorName, replyModalInquiry.vendorEmail, replyModalInquiry) && (
                      <span className="px-1.5 py-0.2 rounded-full text-[8px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 inline-flex items-center gap-0.5 shadow-xs">
                        <ShieldCheck size={9} className="text-emerald-600 dark:text-emerald-400" />
                        Procucev Vendor
                      </span>
                    )}
                    <span>on <span className="font-mono">{activeRfq.rfqNumber}</span></span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyModalInquiry(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200/70 dark:border-gray-700/60 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Vendor Question:
              </span>
              <p className="text-slate-800 dark:text-gray-200 italic">&ldquo;{replyModalInquiry.message}&rdquo;</p>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Your Official Clarification / Answer *
              </label>
              <textarea
                rows={4}
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                placeholder="Provide specific technical, delivery, or commercial clarification..."
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-gray-700 text-xs bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setReplyModalInquiry(null)}
                disabled={isSubmittingReply}
                className="btn btn-ghost btn-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendReply}
                disabled={isSubmittingReply || !replyMessage.trim()}
                className="btn btn-primary btn-sm px-4 font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send size={12} />
                <span>{isSubmittingReply ? 'Sending Response...' : 'Send Clarification'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Buyer Private Vendor Invite Modal */}
      {!isVendor && inviteModalOpen && (
        <BuyerInviteSuppliersModal
          isOpen={inviteModalOpen}
          onClose={() => setInviteModalOpen(false)}
          rfq={activeRfq}
          onInvited={(updatedRfq) => {
            setLocalRfq(updatedRfq);
            if (onUpdate) onUpdate(updatedRfq);
            setInviteModalOpen(false);
            showToast('Suppliers Added', `Invited suppliers have been assigned to RFQ ${updatedRfq.rfqNumber}.`, 'success');
          }}
        />
      )}
    </div>
  );
}

interface BuyerInviteSuppliersModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfq: RFQItem;
  onInvited: (updatedRfq: RFQItem) => void;
}

function BuyerInviteSuppliersModal({ isOpen, onClose, rfq, onInvited }: BuyerInviteSuppliersModalProps) {
  const { buyerVendors, showToast, refreshFromDB } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Strictly buyer-uploaded private roster vendors — NO Procucev network marketplace vendors
  const allMyPrivateVendors = (buyerVendors || []).filter((v) => isBuyerUploaded(v));

  const rawExistingAssigned = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
  const alreadyAssignedIds = new Set(
    rawExistingAssigned.map((v: any) => (typeof v === 'string' ? v : v.id || v.email || v.name))
  );

  const term = searchQuery.trim().toLowerCase();
  const filteredVendors = allMyPrivateVendors.filter((v) => {
    if (!term) return true;
    return (
      (v.name || '').toLowerCase().includes(term) ||
      (v.email || '').toLowerCase().includes(term) ||
      (v.majorCategory || '').toLowerCase().includes(term) ||
      (v.contactPerson || '').toLowerCase().includes(term)
    );
  });

  const unassignedFiltered = filteredVendors.filter((v) => !alreadyAssignedIds.has(v.id));
  const isAllSelected = unassignedFiltered.length > 0 && unassignedFiltered.every((v) => selectedVendorIds.includes(v.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedVendorIds((prev) => prev.filter((id) => !unassignedFiltered.some((v) => v.id === id)));
    } else {
      const newIds = Array.from(new Set([...selectedVendorIds, ...unassignedFiltered.map((v) => v.id)]));
      setSelectedVendorIds(newIds);
    }
  };

  const toggleVendor = (vendorId: string) => {
    if (alreadyAssignedIds.has(vendorId)) return;
    setSelectedVendorIds((prev) =>
      prev.includes(vendorId) ? prev.filter((id) => id !== vendorId) : [...prev, vendorId]
    );
  };

  const handleSave = async () => {
    if (selectedVendorIds.length === 0) {
      setSaveError('Please select at least one supplier to assign.');
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const newVendorsToAdd = allMyPrivateVendors
        .filter((v) => selectedVendorIds.includes(v.id) && !alreadyAssignedIds.has(v.id))
        .map((v) => ({
          id: v.id,
          name: v.name || 'Enterprise Vendor',
          email: v.email || null,
          contactPerson: v.contactPerson || null,
          phone: v.phone || null,
        }));

      const normalizedCurrent = rawExistingAssigned.map((v: any) => {
        if (typeof v === 'string') {
          const found = allMyPrivateVendors.find((bv) => bv.id === v || bv.name === v || bv.email === v);
          return {
            id: v,
            name: found?.name || v,
            email: found?.email || null,
            contactPerson: found?.contactPerson || null,
            phone: found?.phone || null,
          };
        }
        return v;
      });

      const merged = [...normalizedCurrent, ...newVendorsToAdd];
      const result = await updateRFQ(rfq.id, { assignedVendors: merged });
      if (result.success) {
        const finalRfq: RFQItem = {
          ...result.rfq,
          assignedVendors:
            Array.isArray(result.rfq.assignedVendors) && result.rfq.assignedVendors.length >= merged.length
              ? result.rfq.assignedVendors
              : merged,
        };
        onInvited(finalRfq);
        await refreshFromDB();
      } else {
        throw new Error(result.error || 'Failed to assign suppliers to RFQ.');
      }
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to update RFQ suppliers.');
      showToast('Assignment Failed', err?.message || 'Failed to update RFQ suppliers.', 'warning');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-4 text-xs text-slate-800 dark:text-gray-200 animate-scale-up max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400">
              <Building2 size={20} />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <span>Invite Approved Suppliers</span>
                <span className="badge badge-blue text-[9px] font-bold">
                  {allMyPrivateVendors.length} Private Suppliers
                </span>
              </h3>
              <p className="text-[10px] text-slate-500 dark:text-gray-400">
                Select suppliers from your private approved roster to invite for <span className="font-mono font-bold text-slate-700 dark:text-gray-300">{rfq.rfqNumber}</span>.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {saveError && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle size={14} className="shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        {allMyPrivateVendors.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-slate-50 dark:bg-gray-950/40 border border-slate-200 dark:border-gray-800 space-y-2 my-auto">
            <Users size={28} className="mx-auto text-slate-400 opacity-60" />
            <h4 className="text-xs font-bold text-slate-700 dark:text-gray-300">No Private Suppliers Available</h4>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 max-w-sm mx-auto">
              You haven&apos;t uploaded any approved private suppliers yet. Add suppliers in the Vendor Directory or PO History ingestion to invite them.
            </p>
          </div>
        ) : (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col min-h-0">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2.5 top-2 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by supplier name, email, or category..."
                  className="w-full text-xs pl-7 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {unassignedFiltered.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="btn btn-secondary btn-xs text-[10px] font-bold inline-flex items-center gap-1"
                  >
                    {isAllSelected ? <Square size={11} /> : <CheckSquare size={11} />}
                    <span>{isAllSelected ? 'Deselect All' : 'Select All'}</span>
                  </button>
                )}
                <span className="text-[10px] text-slate-500 font-semibold mono">
                  {selectedVendorIds.length} selected
                </span>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[160px]">
              {filteredVendors.map((vendor, idx) => {
                const isAssigned = alreadyAssignedIds.has(vendor.id);
                const isSelected = selectedVendorIds.includes(vendor.id);

                return (
                  <div
                    key={vendor.id || idx}
                    onClick={() => toggleVendor(vendor.id)}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                      isAssigned
                        ? 'bg-slate-50/50 dark:bg-gray-950/20 border-slate-200/60 dark:border-gray-800/60 opacity-60 cursor-not-allowed'
                        : isSelected
                        ? 'bg-blue-50/40 dark:bg-blue-950/30 border-blue-400 dark:border-blue-600 ring-1 ring-blue-400/40 cursor-pointer'
                        : 'bg-white dark:bg-gray-900 border-slate-200 dark:border-gray-800 hover:bg-slate-50 dark:hover:bg-gray-850 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border text-[10px] ${
                          isAssigned
                            ? 'bg-slate-200 dark:bg-gray-700 border-slate-300 dark:border-gray-600 text-slate-500'
                            : isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                        }`}
                      >
                        {(isAssigned || isSelected) && <Check size={11} />}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {idx + 1}. {vendor.name}
                          </span>
                          {vendor.majorCategory && (
                            <span className="px-1.5 py-0.2 rounded text-[8px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300">
                              {vendor.majorCategory}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-gray-400 flex items-center gap-2 truncate">
                          {vendor.contactPerson && <span>{vendor.contactPerson}</span>}
                          {vendor.email && <span className="mono">{vendor.email}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isAssigned ? (
                        <span className="px-2 py-0.5 rounded text-[8px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border border-slate-200 dark:border-gray-700">
                          Already Assigned
                        </span>
                      ) : (
                        <span className="badge badge-emerald text-[8px] font-bold">
                          Private Approved
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-gray-800 shrink-0">
          <button onClick={onClose} disabled={isSaving} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || selectedVendorIds.length === 0}
            className="btn btn-primary btn-sm px-4 font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <UserPlus size={13} />
            <span>{isSaving ? 'Assigning...' : `Assign ${selectedVendorIds.length > 0 ? `${selectedVendorIds.length} ` : ''}Suppliers`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}