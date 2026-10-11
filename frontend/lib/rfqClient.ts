import { authClient } from './authClient';
import { UI_STRINGS, formatString } from './uiStrings';
import type {
  ExtractedEntity,
  RFQAttachment,
  RFQAttachmentResult,
  RFQCreatePayload,
  RFQDeleteResult,
  RFQExtractionRequest,
  RFQExtractionResult,
  RFQFetchResult,
  RFQIngestionResponse,
  RFQInviteVendorsResult,
  RFQItem,
  RFQListResult,
  RFQMutationResult,
  RFQUpdatePayload,
  RFQQuoteAttachment,
  RFQVendorCandidate,
  RFQVendorCandidatesResult,
  RFQVendorPageResult,
  VendorPageMeta,
} from './types';

export async function downloadQuoteAttachment(
  rfqIdOrNumber: string,
  attachment: RFQQuoteAttachment
): Promise<{ success: boolean; url?: string; error?: string }> {
  const token = authClient.getToken();
  try {
    const response = await fetch(
      `/api/rfqs/${encodeURIComponent(rfqIdOrNumber)}/quote-attachments/${encodeURIComponent(attachment.id)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { success: false, error: body.error || 'The bid document could not be downloaded.' };
    }
    return { success: true, url: URL.createObjectURL(await response.blob()) };
  } catch {
    return { success: false, error: UI_STRINGS.auth.networkUnreachable };
  }
}

/**
 * Transport for AI RFQ document extraction.
 *
 * The Gemini API key lives only on the server, so the browser never talks to
 * Gemini directly: it posts the document (flattened spreadsheet text, or base64
 * for a PDF/image) to the backend, which performs the extraction and classifies
 * the result. A document that cannot be read is a normal outcome rather than an
 * error, so every failure resolves with `success: false` plus a machine-readable
 * `reason` the wizard maps onto its manual-entry fallback.
 */
export async function extractLineItemsFromDocument(
  payload: RFQExtractionRequest
): Promise<RFQExtractionResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch('/api/rfqs/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // The API is unreachable. Fail closed so the buyer is never shown
    // fabricated line items.
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  // A 5xx is the API failing or absent, not the model misreading the document.
  // The endpoint reports every genuine extraction failure as a 422 with a reason,
  // so anything in the 500s is a transport problem and has to say so.
  if (res.status >= 500) {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  let body: Partial<RFQExtractionResult> & { data?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    return { success: false, reason: 'AI_FAILED', error: UI_STRINGS.rfqExtraction.unreadableResponse };
  }

  if (!res.ok || !body.success || !body.data) {
    return {
      success: false,
      reason: body.reason || 'AI_FAILED',
      error: body.error || UI_STRINGS.rfqExtraction.unreadableResponse,
    };
  }

  return {
    success: true,
    data: body.data as RFQExtractionResult['data'],
    classification: body.classification,
    extraction: body.extraction,
  };
}

/**
 * Re-classify line items against the shared major/minor taxonomy.
 *
 * The wizard used to do this in the browser with a three-keyword lookup, which
 * silently downgraded anything it did not recognise to a default minor category.
 * The server owns the full 280+ category taxonomy and the same precedence rules
 * the ingest pipeline applies, so classification is asked of it instead.
 *
 * Rows are sent as-is and their existing categories are deliberately omitted: an
 * explicit category takes precedence server-side, so leaving them in would make
 * re-classification a no-op.
 */
export async function classifyLineItems(items: ExtractedEntity[]): Promise<RFQIngestionResponse> {
  const token = authClient.getToken();

  const lineItems = items.map((item) => ({
    id: item.id,
    itemName: item.itemName,
    quantity: item.quantity,
    unit: item.unit,
    targetDate: item.targetDate,
    technicalSpecs: item.technicalSpecs,
  }));

  let res: Response;
  try {
    res = await fetch('/api/rfqs/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ lineItems }),
    });
  } catch {
    return { success: false, error: UI_STRINGS.auth.networkUnreachable };
  }

  if (res.status >= 500) {
    return { success: false, error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }) };
  }

  let body: Partial<RFQIngestionResponse> = {};
  try {
    body = await res.json();
  } catch {
    return { success: false, error: UI_STRINGS.rfqExtraction.classifyFailed };
  }

  if (!res.ok || !body.success || !body.data) {
    return { success: false, error: body.error || UI_STRINGS.rfqExtraction.classifyFailed };
  }

  return { success: true, data: body.data, classification: body.classification };
}

/** Where a stored attachment is served from, used directly as a link target. */
export function rfqAttachmentUrl(attachmentId: string): string {
  return `/api/rfqs/attachments/${encodeURIComponent(attachmentId)}`;
}

/**
 * Store a supporting document against an RFQ.
 *
 * Deliberately separate from `extractLineItemsFromDocument`: this is the manual
 * path, where the document is evidence to keep rather than something to read, so
 * no extraction is performed and no Gemini quota is spent.
 */
export async function uploadRFQAttachment(file: File): Promise<RFQAttachmentResult> {
  const token = authClient.getToken();

  let content: string;
  try {
    content = await readFileAsBase64(file);
  } catch {
    return { success: false, error: UI_STRINGS.rfqExtraction.attachUnreachable };
  }

  let res: Response;
  try {
    res = await fetch('/api/rfqs/attachments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // The browser leaves `type` empty for some uploads; the server allow-list
      // rejects an unrecognised value, which is the outcome we want.
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, content }),
    });
  } catch {
    return { success: false, error: UI_STRINGS.auth.networkUnreachable };
  }

  if (res.status >= 500) {
    return { success: false, error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }) };
  }

  let body: { success?: boolean; data?: RFQAttachment; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return { success: false, error: UI_STRINGS.rfqExtraction.attachUnreachable };
  }

  if (!res.ok || !body.success || !body.data) {
    return { success: false, error: body.error || UI_STRINGS.rfqExtraction.attachUnreachable };
  }

  return { success: true, data: body.data };
}

/** Read a file as the base64 body the upload endpoint accepts. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result || '');
      // Strip the "data:<mime>;base64," prefix the API does not expect.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

const rfqClient = { extractLineItemsFromDocument, classifyLineItems, uploadRFQAttachment, rfqAttachmentUrl };

export default rfqClient;

/**
 * Create an RFQ.
 *
 * The response is the authority on what was saved, so callers must adopt it
 * rather than keeping the object they submitted. The server owns the RFQ number
 * (allocated under the same scheme the Java p2pservices app uses), the row id,
 * the created timestamp and the generated summary — none of which the client can
 * know in advance. The previous fire-and-forget POST discarded all of it, leaving
 * the browser and the database holding different records for the same RFQ.
 */
export async function createRFQ(payload: RFQCreatePayload): Promise<RFQMutationResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch('/api/rfqs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: RFQItem; error?: string; fieldErrors?: Record<string, string> } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !body.data) {
    // Field errors are surfaced so the wizard can put each message against the
    // input that caused it rather than showing one generic failure.
    return {
      success: false,
      reason: res.status === 400 ? 'VALIDATION' : 'SERVER',
      error: body.error || UI_STRINGS.rfqDetails.loadFailed,
      fieldErrors: body.fieldErrors,
    };
  }

  return { success: true, rfq: body.data };
}

/**
 * Fetch one RFQ by its number or row id.
 *
 * Reads through the authenticated, organisation-scoped endpoint, so an RFQ
 * belonging to another buyer reports as not found rather than being returned.
 */
export async function fetchRFQById(identifier: string): Promise<RFQFetchResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch(`/api/rfqs/${encodeURIComponent(identifier)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: RFQItem; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (res.status === 404) {
    return { success: false, reason: 'NOT_FOUND', error: body.error || UI_STRINGS.rfqDetails.notFoundMessage };
  }
  if (!res.ok || !body.success || !body.data) {
    return { success: false, reason: 'SERVER', error: body.error || UI_STRINGS.rfqDetails.loadFailed };
  }

  return { success: true, rfq: body.data };
}

/**
 * List the signed-in buyer organisation's RFQs.
 *
 * Reads the authenticated, org-scoped endpoint. There is no way to ask for
 * anything wider: the previous global list is what leaked RFQs between buyers.
 */
export async function fetchRFQList(): Promise<RFQListResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch('/api/rfqs', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: RFQItem[]; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !Array.isArray(body.data)) {
    return { success: false, reason: 'SERVER', error: body.error || UI_STRINGS.rfqDetails.loadFailed };
  }

  return { success: true, rfqs: body.data };
}

/**
 * List every RFQ in the system, for the category manager's "All RFQs" console.
 *
 * Backed by `GET /api/rfqs/all`, which the server gates to the category_manager
 * and admin roles. A buyer or vendor token gets a 403 here — this is not a
 * wider view of the buyer-scoped `fetchRFQList`, it is a separate oversight
 * endpoint. The rows come back newest first.
 */
export async function fetchAllRFQs(): Promise<RFQListResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch('/api/rfqs/all', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: RFQItem[]; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !Array.isArray(body.data)) {
    return { success: false, reason: 'SERVER', error: body.error || UI_STRINGS.rfqDetails.loadFailed };
  }

  return { success: true, rfqs: body.data };
}

/**
 * The category-matched vendor pool a category manager can invite to an RFQ.
 *
 * Backed by `GET /api/rfqs/:id/vendor-candidates`, gated to category_manager/
 * admin. Being in this list grants no visibility by itself — only actually
 * inviting a vendor (inviteVendorsToRFQ) does.
 */
export async function fetchVendorCandidates(rfqId: string): Promise<RFQVendorCandidatesResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch(`/api/rfqs/${encodeURIComponent(rfqId)}/vendor-candidates`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: RFQVendorCandidate[]; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !Array.isArray(body.data)) {
    return { success: false, reason: 'SERVER', error: body.error || UI_STRINGS.rfqDetails.loadFailed };
  }

  return { success: true, candidates: body.data };
}

/**
 * Every vendor in the system, unfiltered by category.
 *
 * Backed by `GET /api/vendors?buyerId=all`. Used by InviteVendorsModal's
 * "All Vendors" mode, which lets a category manager invite someone the
 * category-matched candidate pool (fetchVendorCandidates) wouldn't surface —
 * inviteVendorsToRFQ never validates category match server-side, so any real
 * vendor id already invites successfully.
 */
export async function fetchAllVendors(
  options: { page?: number; pageSize?: number; search?: string; category?: string } = {}
): Promise<RFQVendorPageResult> {
  const token = authClient.getToken();
  const { page = 1, pageSize = 50, search = '', category = '' } = options;

  const params = new URLSearchParams({ buyerId: 'all', page: String(page), pageSize: String(pageSize) });
  if (search.trim()) params.set('search', search.trim());
  if (category.trim()) params.set('category', category.trim());

  let res: Response;
  try {
    res = await fetch(`/api/vendors?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: RFQVendorCandidate[]; error?: string; pagination?: VendorPageMeta } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !Array.isArray(body.data) || !body.pagination) {
    return { success: false, reason: 'SERVER', error: body.error || UI_STRINGS.rfqDetails.loadFailed };
  }

  // alreadyInvited isn't computed server-side for this endpoint (unlike
  // vendor-candidates) — the caller derives it from the RFQ's own
  // assignedVendors list.
  return {
    success: true,
    candidates: body.data.map((v) => ({ ...v, alreadyInvited: false })),
    pagination: body.pagination,
  };
}

/**
 * A category manager invites specific vendors to an RFQ.
 *
 * Backed by `POST /api/rfqs/:id/invite-vendors`, gated to category_manager/
 * admin. Newly-invited vendors get a real in-app notification, a real email,
 * and simulated multi-channel chaser outreach.
 */
export async function inviteVendorsToRFQ(rfqId: string, vendorIds: string[]): Promise<RFQInviteVendorsResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch(`/api/rfqs/${encodeURIComponent(rfqId)}/invite-vendors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ vendorIds }),
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: RFQItem; invitedCount?: number; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success || !body.data) {
    return {
      success: false,
      reason: res.status === 400 ? 'VALIDATION' : 'SERVER',
      error: body.error || UI_STRINGS.rfqDetails.loadFailed,
    };
  }

  return { success: true, rfq: body.data, invitedCount: body.invitedCount || 0 };
}

/**
 * Apply an edit to one RFQ.
 *
 * Partial by design: only the fields the caller supplies are sent, and the API
 * writes only those columns. The response is again the authority — it carries the
 * stored record including the new `updatedAt` — so the caller adopts it rather
 * than patching its own copy and hoping the two agree.
 *
 * An RFQ belonging to another organisation reports NOT_FOUND, the same as an id
 * that does not exist.
 */
export async function updateRFQ(
  identifier: string,
  changes: RFQUpdatePayload
): Promise<RFQMutationResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch(`/api/rfqs/${encodeURIComponent(identifier)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(changes),
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: RFQItem; error?: string; fieldErrors?: Record<string, string> } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (res.status === 404) {
    return { success: false, reason: 'NOT_FOUND', error: body.error || UI_STRINGS.rfqDetails.notFoundMessage };
  }
  if (!res.ok || !body.success || !body.data) {
    return {
      success: false,
      reason: res.status === 400 ? 'VALIDATION' : 'SERVER',
      error: body.error || UI_STRINGS.rfqEdit.saveFailed,
      fieldErrors: body.fieldErrors,
    };
  }

  return { success: true, rfq: body.data };
}

/**
 * Delete one RFQ.
 *
 * Returns the number that was removed so the caller can drop that row without
 * having to know whether it addressed the RFQ by number or by row id.
 */
export async function deleteRFQ(identifier: string): Promise<RFQDeleteResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch(`/api/rfqs/${encodeURIComponent(identifier)}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: { rfqNumber?: string }; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (res.status === 404) {
    return { success: false, reason: 'NOT_FOUND', error: body.error || UI_STRINGS.rfqDetails.notFoundMessage };
  }
  if (!res.ok || !body.success) {
    return { success: false, reason: 'SERVER', error: body.error || UI_STRINGS.rfqEdit.deleteFailed };
  }

  // Falls back to what the caller asked for: the row still has to be dropped even
  // if the response omitted the echo.
  return { success: true, rfqNumber: body.data?.rfqNumber || identifier };
}

/**
 * Submit a vendor clarification / inquiry on an RFQ.
 */
export async function submitRFQInquiry(
  rfqIdOrNumber: string,
  payload: { message: string; vendorName?: string; vendorEmail?: string | null }
): Promise<{ success: boolean; data?: any; rfq?: any; error?: string }> {
  const token = authClient.getToken();

  try {
    const res = await fetch(`/api/rfqs/${encodeURIComponent(rfqIdOrNumber)}/inquiries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    if (!res.ok || !body.success) {
      return { success: false, error: body.error || 'Failed to submit inquiry.' };
    }
    return { success: true, data: body.data, rfq: body.rfq };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error submitting inquiry.' };
  }
}

/**
 * Reply to a vendor inquiry (buyer-side).
 */
export async function replyToRFQInquiry(
  rfqIdOrNumber: string,
  inquiryId: string,
  payload: { reply: string; repliedBy?: string }
): Promise<{ success: boolean; data?: any; rfq?: any; error?: string }> {
  const token = authClient.getToken();

  try {
    const res = await fetch(`/api/rfqs/${encodeURIComponent(rfqIdOrNumber)}/inquiries/${encodeURIComponent(inquiryId)}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    if (!res.ok || !body.success) {
      return { success: false, error: body.error || 'Failed to submit reply.' };
    }
    return { success: true, data: body.data, rfq: body.rfq };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error submitting reply.' };
  }
}

export interface RequestVendorCategoryUpdatePayload {
  vendorId?: string;
  vendorEmail?: string;
  vendorName?: string;
  rfqCategory?: string;
  rfqTitle?: string;
  rfqNumber?: string;
}

/**
 * Dispatch an email to a vendor requesting them to update their category details.
 */
export async function requestVendorCategoryUpdateEmail(
  payload: RequestVendorCategoryUpdatePayload
): Promise<{ success: boolean; message?: string; error?: string }> {
  const token = authClient.getToken();

  try {
    const res = await fetch('/api/rfqs/request-vendor-category-update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    if (!res.ok || !body.success) {
      return { success: false, error: body.error || 'Failed to dispatch category update email.' };
    }
    return { success: true, message: body.message };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error requesting category update.' };
  }
}

export interface VendorCreditInfo {
  vendorId: string;
  freeCreditsAllocated: number;
  freeCreditsUsed: number;
  freeCreditsRemaining: number;
  isSubscribed: boolean;
  subscriptionPlan: string;
  unlockedRfqIds: string[];
}

/**
 * Fetch authoritative server-side RFQ download credit balance for the authenticated vendor.
 */
export async function fetchVendorRfqCredits(vendorId?: string): Promise<{
  success: boolean;
  data?: VendorCreditInfo;
  error?: string;
}> {
  const token = authClient.getToken();
  try {
    const url = vendorId && vendorId !== 'me' ? `/api/vendors/${encodeURIComponent(vendorId)}/rfq-credits` : '/api/vendors/rfq-credits';
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      return { success: false, error: body.error || 'Failed to fetch vendor RFQ credits.' };
    }
    return { success: true, data: body.data };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error fetching RFQ credits.' };
  }
}

/**
 * Atomically download & unlock an RFQ, consuming 1 credit if using free allowance.
 */
export async function downloadAndUnlockRFQ(rfqIdOrNumber: string): Promise<{
  success: boolean;
  data?: any;
  unlocked?: boolean;
  alreadyUnlocked?: boolean;
  freeCreditsRemaining?: number;
  exhausted?: boolean;
  error?: string;
}> {
  const token = authClient.getToken();
  try {
    const res = await fetch(`/api/rfqs/${encodeURIComponent(rfqIdOrNumber)}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      return {
        success: false,
        error: body.error || 'Failed to download RFQ.',
        exhausted: body.exhausted || false,
        freeCreditsRemaining: body.freeCreditsRemaining,
      };
    }
    return {
      success: true,
      data: body.data,
      unlocked: body.unlocked,
      alreadyUnlocked: body.alreadyUnlocked,
      freeCreditsRemaining: body.freeCreditsRemaining,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error downloading RFQ.' };
  }
}
