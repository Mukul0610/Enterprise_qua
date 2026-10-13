/**
 * Centralized Input Validation Schemas for Enterprise Backend
 * Single source of truth for all API payload, query parameter, and entity boundaries.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
const PHONE_REGEX = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{7,15}$/;

// Delivery pincode or zipcode. Broader than an Indian six-digit PIN because the
// same field carries international zipcodes for export orders, which are
// alphanumeric and may contain a space or hyphen. Mirrors PINCODE_PATTERN in
// frontend/lib/validationSchemas.ts.
const PINCODE_REGEX = /^[A-Za-z0-9][A-Za-z0-9\s-]{2,9}$/;

const DUMMY_PINCODES = new Set([
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
  '012345', '123456', '234567', '345678', '456789', '567890',
  '654321', '765432', '876543', '987654', '098765',
  '121212', '212121', '123123', '321321', '000001', '100000',
]);

function isDummyPincode(pincode) {
  if (!pincode) return false;
  const clean = String(pincode).trim().replace(/\s+/g, '');
  if (!clean) return false;
  if (DUMMY_PINCODES.has(clean)) return true;
  if (/^(\d)\1{5,}$/.test(clean)) return true;
  return false;
}

// Indian mobile number accepted at sign-in and registration. Mirrors
// INDIAN_MOBILE_PATTERN in frontend/lib/validationSchemas.ts. The identity
// schema stores these normalised to +91XXXXXXXXXX, so the submitted value must
// resolve to exactly ten national digits beginning 6-9.
const INDIAN_MOBILE_REGEX = /^(?:\+?91[-\s]?|0)?[6-9]\d{9}$/;
const INDIAN_MOBILE_MESSAGE = 'Enter a valid 10-digit Indian mobile number, for example 9876543210.';

// Email OTPs are 6 numeric digits, matching the `otp_store.otp` column the Java
// p2pservices app writes. Kept here rather than derived from IDENTITY_OTP_CONFIG
// because config/constants.js requires this module, not the other way round.
const OTP_CODE_REGEX = /^\d{6}$/;
const OTP_CODE_MESSAGE = 'Enter the 6-digit verification code sent to your registered email address.';

// Shortest password accepted when an account holder changes their own password.
// Mirrors PASSWORD_MIN_LENGTH in frontend/lib/constants.ts, which also drives the
// `minLength` attribute on the field, so the browser hint and this boundary
// cannot disagree. Deliberately not applied to sign-in: existing accounts
// migrated from the previous schema may hold shorter passwords, and rejecting
// them at login would lock those users out instead of prompting a change.
const PASSWORD_MIN_LENGTH = 8;

// ------------------------------------------------------------------------------
// VENDOR MASTER & PO DATA INGESTION
// ------------------------------------------------------------------------------
// Calendar date in YYYY-MM-DD. Every date crossing this boundary — the selected
// time horizon and each PO date — is normalised to this one format by the
// client's spreadsheet reader before it is submitted, so the server never has to
// guess between DD/MM/YYYY and MM/DD/YYYY. Guessing is exactly how a PO ends up
// filtered into the wrong horizon and a supplier classified from the wrong spend.
const ISO_DATE_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const ISO_DATE_MESSAGE = 'Date must be a calendar date in YYYY-MM-DD format, for example 2024-04-01.';
const TIME_HORIZON_TYPES = ['LAST_1_YEAR', 'LAST_2_YEARS', 'LAST_3_YEARS', 'CUSTOM'];
const CATEGORY_REVIEW_ACTIONS = ['APPROVE', 'EDIT', 'REJECT'];
const DISPATCH_TEMPLATES = ['CATEGORY_MAPPED', 'SELF_MAP_REQUIRED', 'GENERAL_ONBOARDING'];

// ------------------------------------------------------------------------------
// STATUTORY IDENTIFIERS (buyer organisation profile)
// ------------------------------------------------------------------------------
// The Java p2pservices app validates none of these — PAN, CIN and website were
// free text and only GSTIN was checked, and then only in the Angular client. A
// malformed GSTIN therefore reached the `organization` table and broke downstream
// tax reporting. These are enforced here so an invalid identifier is rejected at
// the API boundary regardless of which client submitted it.

// Income-tax PAN: five letters, four digits, one letter.
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
const PAN_MESSAGE = 'PAN must be 10 characters in the format AAAAA9999A, for example AAACL1234F.';

// MCA Corporate Identity Number: listing status, 5-digit industry code, 2-letter
// state, 4-digit year, 3-letter ownership code, 6-digit registration number.
const CIN_REGEX = /^[LUu][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/i;
const CIN_MESSAGE =
  'CIN must be 21 characters in the format L99999AA9999AAA999999, for example L28920MH1946PLC004768.';

const GSTIN_MESSAGE =
  'GSTIN must be 15 characters in the format 99AAAAA9999A9Z9, for example 27AAACL1234F1Z5.';

// Corporate website. Deliberately requires an http(s) scheme so the value can be
// used directly as a link target without the caller having to guess a protocol.
const WEBSITE_REGEX = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const WEBSITE_MESSAGE = 'Website must be a full URL beginning http:// or https://, for example https://example.com.';

// Registered-office PIN code. Narrower than the delivery PINCODE_REGEX above:
// a buyer's registered address is an Indian statutory address, so it is exactly
// six digits and cannot begin with zero.
const INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const INDIAN_PINCODE_MESSAGE = 'PIN code must be 6 digits and cannot start with 0, for example 400001.';

// Legal constitutions offered by the buyer profile screen. Anything else is a
// client that has drifted from the shared taxonomy, so it is rejected rather
// than written to `organization.type`.
const ORGANIZATION_TYPES = [
  'Public Limited',
  'Private Limited',
  'LLP',
  'Partnership',
  'Sole Proprietorship',
];

const VALIDATION_SCHEMAS = {
  createRFQ: {
    title: { type: 'string', required: true, minLength: 3, maxLength: 200 },
    // A buyer may not know the exact taxonomy slot for every line item up
    // front (see ingestion-wizard.tsx / manualRfqModel.ts) — an RFQ dispatched
    // with no line item categorized ends up with no derivable top-level
    // category either, and that must not block dispatch. storeService.createRFQ
    // already handles a missing category (falls back to null / per-line-item
    // signals), so nothing downstream assumes this is always present.
    category: { type: 'string', required: false, minLength: 2 },
    // Optional. A document that prices nothing yields no budget, and requiring
    // one forced the buyer to invent a ceiling vendors would then quote against.
    budget: { type: 'number', required: false, min: 0 },
    // Required, unlike budget. Vendors rate freight on the destination and its
    // pincode, so a quote raised without them cannot be compared against one
    // that has them. Enforced here as well as in the wizard so an RFQ posted
    // straight to the API cannot skip the destination.
    deliveryLocation: {
      type: 'string',
      required: true,
      minLength: 3,
      maxLength: 200,
      message: 'Delivery location is required and must be 3 to 200 characters.',
    },
    deliveryPincode: {
      type: 'string',
      required: true,
      pattern: PINCODE_REGEX,
      message: 'Pincode is required and must be 3 to 10 letters, digits, spaces or hyphens.',
      custom: (val) => (isDummyPincode(val) ? 'Dummy or sequential PIN codes (e.g. 123456, 111111) are not allowed.' : null),
    },
    // Metadata for documents already stored by POST /api/rfqs/attachments.
    attachments: { type: 'array', required: false },
    targetDeliveryDate: { type: 'string', required: true },
    lineItems: { type: 'array', required: false },
    // Provenance. Bounded here because these reach the stored record and are
    // rendered on the RFQ details screen; they were previously unvalidated
    // because storeService dropped them before they could be persisted at all.
    source: { type: 'string', required: false, maxLength: 40 },
    sourceFileName: { type: 'string', required: false, maxLength: 260 },
    sourceEmail: {
      type: 'string',
      required: false,
      pattern: EMAIL_REGEX,
      message: 'Source email must be a valid email address.',
    },
  },

  // Edit of an existing RFQ (PUT /api/rfqs/:id).
  //
  // Every field is optional because an edit is a partial update: the buyer may be
  // correcting only the delivery pincode, and demanding the whole record back
  // would make a small correction able to blank whatever the form did not resend.
  // The format rules are identical to createRFQ, so a value that could not have
  // been created cannot be introduced by an edit either.
  //
  // Ownership fields are absent on purpose. rfqNumber, rfqId, buyer identity and
  // createdAt are not editable, and the query layer whitelists columns as well, so
  // sending them here changes nothing.
  updateRFQ: {
    title: { type: 'string', required: false, minLength: 3, maxLength: 200 },
    category: { type: 'string', required: false, minLength: 2 },
    status: { type: 'string', required: false, minLength: 2, maxLength: 40 },
    sourcingMode: { type: 'string', required: false, minLength: 2, maxLength: 20 },
    budget: { type: 'number', required: false, min: 0 },
    deliveryLocation: {
      type: 'string',
      required: false,
      minLength: 3,
      maxLength: 200,
      message: 'Delivery location must be 3 to 200 characters.',
    },
    deliveryPincode: {
      type: 'string',
      required: false,
      pattern: PINCODE_REGEX,
      message: 'Pincode must be 3 to 10 letters, digits, spaces or hyphens.',
      custom: (val) => (isDummyPincode(val) ? 'Dummy or sequential PIN codes (e.g. 123456, 111111) are not allowed.' : null),
    },
    targetDeliveryDate: { type: 'string', required: false },
    extractedEntities: { type: 'array', required: false },
    attachments: { type: 'array', required: false },
    assignedVendors: { type: 'array', required: false },
  },

  // Document handed to POST /api/rfqs/extract for Gemini line-item extraction.
  // Either documentText (client-flattened spreadsheet) or inlineData (PDF/image
  // base64) must be present; that either/or rule is enforced in the service,
  // which can report a precise reason the wizard shows to the buyer.
  extractRFQ: {
    fileName: { type: 'string', required: true, minLength: 1, maxLength: 260 },
    documentText: { type: 'string', required: false },
    inlineData: { type: 'string', required: false },
    // Preferred over inlineData for anything binary — a reference to a document
    // already uploaded raw via POST /api/rfqs/extract/stage, so the base64 body
    // never has to round-trip through this endpoint's JSON request at all.
    fileKey: { type: 'string', required: false, maxLength: 64 },
    mimeType: { type: 'string', required: false, maxLength: 120 },
  },

  // Raw extracted rows handed to POST /api/rfqs/ingest. The rows themselves are
  // A supporting document attached to an RFQ. The MIME allow-list and the size
  // ceiling are enforced by rfqAttachmentService, which owns those limits.
  uploadRFQAttachment: {
    fileName: { type: 'string', required: true, minLength: 1, maxLength: 260 },
    mimeType: { type: 'string', required: true, minLength: 3, maxLength: 150 },
    content: { type: 'string', required: true, minLength: 1, message: 'content must be base64 file data.' },
  },

  // deliberately loose because they come from arbitrary spreadsheets; each row is
  // normalised and validated per-field by rfqIngestionService instead.
  ingestRFQ: {
    lineItems: { type: 'array', required: true, message: 'lineItems must be an array of extracted rows.' },
    title: { type: 'string', required: false, maxLength: 200 },
    category: { type: 'string', required: false },
    // Overall value stated on the document. Optional because most BOQs price only
    // the individual lines, which the ingestion service sums instead.
    estimatedBudget: { type: 'number', required: false, min: 0 },
    source: {
      type: 'string',
      required: false,
      enum: ['email_gateway', 'web_portal', 'email_upload', 'manual_entry'],
    },
    sourceFileName: { type: 'string', required: false, maxLength: 260 },
    sourceEmail: { type: 'string', required: false, pattern: EMAIL_REGEX, message: 'Valid source email required' },
  },

  vendorRegistration: {
    name: { type: 'string', required: true, minLength: 2, maxLength: 150 },
    corporateEmail: { type: 'string', required: true, pattern: EMAIL_REGEX, message: 'Valid corporate email address required' },
    gstin: { type: 'string', required: false, pattern: GSTIN_REGEX, message: 'Valid 15-character GSTIN format required' },
    majorCategory: { type: 'string', required: true },
    contactPhone: { type: 'string', required: false, pattern: PHONE_REGEX, message: 'Valid phone number required' },
  },

  // One row of a category manager's bulk vendor Excel upload (POST
  // /api/vendors/bulk-import). Mirrors the real p2pservices Vendor Master
  // sheet columns (Company Name, Person Name, Email Id, Mobile No, GSTIN, Pin
  // Code, City, State, Cate-1..5, Products) rather than the richer single-add
  // vendor form — the reference app's own bulk path only ever required
  // company name, email and mobile, so that's what's required here too;
  // everything else is format-checked only when the row actually supplies it.
  // A row failing any check here (a missing name/phone, or a malformed
  // email/phone/GSTIN/pincode) is not rejected — vendorController.
  // bulkImportVendors still imports it, tagged `hasIssues`/`issues`. The
  // marketplace-directory scrape this feeds from routinely has incomplete
  // real rows, and rejecting or fabricating a value for one both hide real
  // data from the CM reviewing the import; this schema only decides what
  // counts as "worth flagging," not what counts as "allowed to import."
  vendorBulkImportRow: {
    vendorCode: { type: 'string', required: false, maxLength: 100 },
    name: { type: 'string', required: false, minLength: 2, maxLength: 200, message: 'Company name is required.' },
    email: { type: 'string', required: false, pattern: EMAIL_REGEX, message: 'A valid email address is required.' },
    phone: { type: 'string', required: false, pattern: INDIAN_MOBILE_REGEX, message: INDIAN_MOBILE_MESSAGE },
    gstin: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    pincode: { type: 'string', required: false, pattern: INDIAN_PINCODE_REGEX, message: INDIAN_PINCODE_MESSAGE },
    contactPerson: { type: 'string', required: false, maxLength: 150 },
    city: { type: 'string', required: false, maxLength: 100 },
    state: { type: 'string', required: false, maxLength: 100 },
    majorCategory: { type: 'string', required: false, maxLength: 150 },
    products: { type: 'string', required: false, maxLength: 500 },
  },

  submitQuote: {
    rfqId: { type: 'string', required: true },
    vendorId: { type: 'string', required: true },
    unitPrice: { type: 'number', required: true, min: 0.01 },
    totalPrice: { type: 'number', required: true, min: 0.01 },
    leadTimeDays: { type: 'number', required: true, min: 1 },
    warrantyYears: { type: 'number', required: false, min: 0 },
    complianceStatus: { type: 'string', required: false },
  },

  updateRatingRevision: {
    vendorId: { type: 'string', required: true },
    revisedScore: { type: 'number', required: true, min: 0, max: 100 },
    revisionReason: { type: 'string', required: true, minLength: 5, maxLength: 500 },
  },

  auditQuery: {
    page: { type: 'number', required: false, min: 1 },
    limit: { type: 'number', required: false, min: 1, max: 100 },
    severity: { type: 'string', required: false, enum: ['INFO', 'WARN', 'ERROR', 'CRITICAL'] },
    category: { type: 'string', required: false },
  },

  buyerAccount: {
    name: { type: 'string', required: true, minLength: 2 },
    email: { type: 'string', required: true, pattern: EMAIL_REGEX, message: 'Valid corporate email required' },
    role: { type: 'string', required: true },
    department: { type: 'string', required: false },
  },

  encryptPayload: {
    plaintext: { type: 'string', required: true, minLength: 1 },
    secretKey: { type: 'string', required: false, minLength: 8 },
    encoding: { type: 'string', required: false, enum: ['hex', 'base64'] },
  },

  decryptPayload: {
    ciphertext: { type: 'string', required: true, minLength: 1 },
    iv: { type: 'string', required: true, minLength: 12 },
    authTag: { type: 'string', required: true, minLength: 16 },
    salt: { type: 'string', required: false },
    secretKey: { type: 'string', required: false, minLength: 8 },
    encoding: { type: 'string', required: false, enum: ['hex', 'base64'] },
  },

  verifyCryptoIntegrity: {
    ciphertext: { type: 'string', required: true, minLength: 1 },
    iv: { type: 'string', required: true, minLength: 12 },
    authTag: { type: 'string', required: true, minLength: 16 },
  },

  // `mobile` is optional at the schema level because the same endpoint also
  // serves the OTP (`code`) path, which identifies the account by email alone.
  // Password sign-in requires it, and that is enforced in authService.
  login: {
    email: { type: 'string', required: true, message: 'Email is required.' },
    mobile: { type: 'string', required: false, pattern: INDIAN_MOBILE_REGEX, message: INDIAN_MOBILE_MESSAGE },
    password: { type: 'string', required: false },
    code: { type: 'string', required: false, pattern: OTP_CODE_REGEX, message: OTP_CODE_MESSAGE },
  },

  // The Java `/authenticate` OTP branch validates the email + phone pair before
  // issuing a code, so the mobile number is mandatory on both OTP endpoints.
  requestOtp: {
    email: { type: 'string', required: true, message: 'Email is required to request OTP.' },
    mobile: {
      type: 'string',
      required: true,
      pattern: INDIAN_MOBILE_REGEX,
      message: INDIAN_MOBILE_MESSAGE,
    },
    roleHint: { type: 'string', required: false },
    isRegistration: { type: 'boolean', required: false },
  },

  verifyOtp: {
    email: { type: 'string', required: true, message: 'Email and verification code are required.' },
    code: {
      type: 'string',
      required: true,
      pattern: OTP_CODE_REGEX,
      message: OTP_CODE_MESSAGE,
    },
    mobile: {
      type: 'string',
      required: true,
      pattern: INDIAN_MOBILE_REGEX,
      message: INDIAN_MOBILE_MESSAGE,
    },
  },

  // Self-service password change, POST /api/auth/change-password.
  //
  // The caller is identified by the session token, so no email is accepted in
  // the body: a request can only ever change the password of the account it is
  // authenticated as. `minLength` is the only strength rule enforced here, and
  // it matches PASSWORD_MIN_LENGTH on the frontend so the browser hint and the
  // server boundary agree.
  changePassword: {
    currentPassword: {
      type: 'string',
      required: true,
      message: 'Enter your current password to authorise the change.',
    },
    newPassword: {
      type: 'string',
      required: true,
      minLength: PASSWORD_MIN_LENGTH,
      message: 'Choose a new password of at least 8 characters.',
    },
  },

  register: {
    email: { type: 'string', required: true, message: 'Email is required for registration.' },
    name: { type: 'string', required: false },
    password: { type: 'string', required: false },
    mobile: { type: 'string', required: false, pattern: INDIAN_MOBILE_REGEX, message: INDIAN_MOBILE_MESSAGE },
    role: { type: 'string', required: false },
    orgName: { type: 'string', required: false },
    emailOtp: { type: 'string', required: false },
    mobileOtp: { type: 'string', required: false },
    code: { type: 'string', required: false },
  },

  // Buyer organisation profile submitted by PUT /api/buyer-profile/me.
  //
  // Ported from the fields ProcUserServiceImpl.updateBuyer patches onto the
  // `organization` row. That method applies null-skip semantics — an omitted key
  // leaves the stored value untouched — so almost everything here is optional and
  // only the legal entity name, which identifies the organisation, is required.
  //
  // `email` and `organizationPhonenumber` are deliberately absent: they are owned
  // by the `user` row established at sign-in and were read-only on the old screen
  // too, so the service ignores them rather than letting a profile save
  // reassign the account's login identity.
  buyerProfile: {
    companyName: { type: 'string', required: true, minLength: 2, maxLength: 255, message: 'Legal entity name is required.' },
    brandName: { type: 'string', required: false, maxLength: 255 },
    organizationType: {
      type: 'string',
      required: false,
      enum: ORGANIZATION_TYPES,
    },
    panNumber: { type: 'string', required: false, pattern: PAN_REGEX, message: PAN_MESSAGE },
    gstNumber: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    cinNumber: { type: 'string', required: false, pattern: CIN_REGEX, message: CIN_MESSAGE },
    website: { type: 'string', required: false, pattern: WEBSITE_REGEX, message: WEBSITE_MESSAGE },
    annualTurnover: { type: 'string', required: false, maxLength: 255 },
    street: { type: 'string', required: false, maxLength: 255 },
    city: { type: 'string', required: false, maxLength: 255 },
    state: { type: 'string', required: false, maxLength: 255 },
    pincode: { type: 'string', required: false, pattern: INDIAN_PINCODE_REGEX, message: INDIAN_PINCODE_MESSAGE },
    country: { type: 'string', required: false, maxLength: 255 },
    contactName: { type: 'string', required: false, maxLength: 255 },
    contactDesignation: { type: 'string', required: false, maxLength: 255 },
    // Flat [{ major, minor }] pairs, mirroring the org_division_category rows
    // they become. Cardinality limits are enforced in the service, which can
    // report which cap was exceeded.
    categories: { type: 'array', required: false },
  },

  // ----------------------------------------------------------------------------
  // VENDOR MASTER & PO DATA INGESTION (buyer module)
  // ----------------------------------------------------------------------------
  // The time horizon the buyer selects before uploading anything. It decides
  // which PO rows the AI categoriser is allowed to see, so it is validated at
  // the boundary rather than trusted: a bad range would silently change which
  // spend history a supplier is classified from.
  //
  // startDate/endDate are only required for CUSTOM — the service resolves the
  // concrete range for the three predefined options itself, so a client cannot
  // claim "last 1 year" while supplying a five-year window.
  vendorIngestionTimeHorizon: {
    horizonType: {
      type: 'string',
      required: true,
      enum: TIME_HORIZON_TYPES,
      message: 'Select a time horizon of Last 1 Year, Last 2 Years, Last 3 Years or a custom date range.',
    },
    startDate: { type: 'string', required: false, pattern: ISO_DATE_REGEX, message: ISO_DATE_MESSAGE },
    endDate: { type: 'string', required: false, pattern: ISO_DATE_REGEX, message: ISO_DATE_MESSAGE },
  },

  // One Vendor Master row. Vendor Code and Company Name are the identity of the
  // supplier and are both required — a row missing either cannot be matched to
  // PO history or emailed, and is reported as invalid rather than defaulted.
  // Email is required because every mapped supplier is eventually mailed.
  vendorMasterRow: {
    vendorCode: { type: 'string', required: true, minLength: 1, maxLength: 120, message: 'Vendor Code is required.' },
    companyName: { type: 'string', required: true, minLength: 2, maxLength: 512, message: 'Company Name is required.' },
    email: { type: 'string', required: true, pattern: EMAIL_REGEX, message: 'A valid Email is required.' },
    contactPerson: { type: 'string', required: false, maxLength: 255 },
    phone: { type: 'string', required: false, pattern: PHONE_REGEX, message: 'Phone is not a valid contact number.' },
    address: { type: 'string', required: false, maxLength: 1024 },
    gstin: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    // Optional 0-100 supplier score from the buyer's own ERP. Out-of-range
    // values are rejected, never clamped, so a mis-scaled column (a 0-5 rating
    // pasted into a 0-100 field) surfaces instead of being silently rewritten.
    rating: { type: 'number', required: false, min: 0, max: 100 },
  },

  // One historical PO line item. The description is the single most important
  // field in the whole module — it is the evidence the categoriser reads — so a
  // line with no description is invalid rather than merely unhelpful.
  poLineItemRow: {
    poNumber: { type: 'string', required: true, minLength: 1, maxLength: 120, message: 'PO Number is required.' },
    poDate: { type: 'string', required: true, pattern: ISO_DATE_REGEX, message: ISO_DATE_MESSAGE },
    itemDescription: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 4000,
      message: 'Line Item Description is required — it is the evidence the categoriser reads.',
    },
    quantity: { type: 'number', required: true, min: 0, message: 'Quantity is required.' },
    uom: { type: 'string', required: true, minLength: 1, maxLength: 64, message: 'UOM is required.' },
    spend: { type: 'number', required: true, min: 0, message: 'Spend / Amount is required.' },
    department: { type: 'string', required: true, minLength: 1, maxLength: 255, message: 'Department is required.' },
    // Either identifier is enough to join to the vendor master; the service
    // rejects a row that supplies neither, because it cannot be attributed.
    vendorCode: { type: 'string', required: false, maxLength: 120 },
    vendorName: { type: 'string', required: false, maxLength: 512 },
    vendorGstin: { type: 'string', required: false, pattern: GSTIN_REGEX, message: GSTIN_MESSAGE },
    specification: { type: 'string', required: false, maxLength: 4000 },
    materialCode: { type: 'string', required: false, maxLength: 120 },
    existingCategory: { type: 'string', required: false, maxLength: 255 },
    existingSubcategory: { type: 'string', required: false, maxLength: 255 },
    currency: { type: 'string', required: false, maxLength: 8 },
  },

  // A buyer's decision on one AI suggestion. The AI columns are never part of
  // this payload — approving or editing must not be able to rewrite what the
  // model proposed, which is the whole basis of the audit trail.
  vendorCategoryReview: {
    action: {
      type: 'string',
      required: true,
      enum: CATEGORY_REVIEW_ACTIONS,
      message: 'Review action must be APPROVE, EDIT or REJECT.',
    },
    majorCategory: { type: 'string', required: false, maxLength: 255 },
    minorCategories: { type: 'array', required: false },
  },

  // A dispatch request. Recipients are identified by their vendor-master record
  // id and re-resolved server-side — the email address is never taken from the
  // request, so a tampered payload cannot redirect a campaign to an outside
  // address.
  vendorIngestionDispatch: {
    template: {
      type: 'string',
      required: true,
      enum: DISPATCH_TEMPLATES,
      message: 'Select a CATEGORY_MAPPED, SELF_MAP_REQUIRED or GENERAL_ONBOARDING email template.',
    },
    majorCategory: { type: 'string', required: false, maxLength: 255 },
    vendorRecordIds: { type: 'array', required: false },
  },

  vendorHeartbeat: {
    identifier: { type: 'string', required: false, minLength: 1, maxLength: 255 },
    role: { type: 'string', required: false, minLength: 1, maxLength: 50 },
    status: { type: 'string', required: false, enum: ['online', 'offline'] },
  },

  vendorPresenceQuery: {
    identifiers: { type: 'string', required: false, maxLength: 2000 },
  },
};


/**
 * Universal Schema Validator
 * Validates a payload against a defined schema and returns structured field errors.
 */
function validatePayload(schema, data = {}) {
  const errors = {};
  const sanitized = {};

  if (!schema || typeof schema !== 'object') {
    return { isValid: true, errors: {}, sanitizedData: data };
  }

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    // Required check
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors[field] = rules.message || `${field} is required.`;
      continue;
    }

    if (value !== undefined && value !== null && value !== '') {
      // Type checks
      if (rules.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) {
          errors[field] = `${field} must be a valid number.`;
          continue;
        }
        if (rules.min !== undefined && num < rules.min) {
          errors[field] = `${field} must be at least ${rules.min}.`;
          continue;
        }
        if (rules.max !== undefined && num > rules.max) {
          errors[field] = `${field} must not exceed ${rules.max}.`;
          continue;
        }
        sanitized[field] = num;
      } else if (rules.type === 'string') {
        const str = String(value).trim();
        if (rules.minLength && str.length < rules.minLength) {
          errors[field] = `${field} must be at least ${rules.minLength} characters.`;
          continue;
        }
        if (rules.maxLength && str.length > rules.maxLength) {
          errors[field] = `${field} must not exceed ${rules.maxLength} characters.`;
          continue;
        }
        if (rules.pattern && !rules.pattern.test(str)) {
          errors[field] = rules.message || `${field} is in an invalid format.`;
          continue;
        }
        if (rules.custom && typeof rules.custom === 'function') {
          const customError = rules.custom(str);
          if (customError) {
            errors[field] = customError;
            continue;
          }
        }
        if (rules.enum && !rules.enum.includes(str)) {
          errors[field] = `${field} must be one of: ${rules.enum.join(', ')}.`;
          continue;
        }
        sanitized[field] = str;
      } else if (rules.type === 'array') {
        if (!Array.isArray(value)) {
          errors[field] = `${field} must be an array.`;
          continue;
        }
        sanitized[field] = value;
      } else {
        sanitized[field] = value;
      }

      if (rules.custom && typeof rules.custom === 'function' && rules.type !== 'string') {
        const customError = rules.custom(value);
        if (customError) {
          errors[field] = customError;
        }
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitizedData: { ...data, ...sanitized },
  };
}

module.exports = {
  EMAIL_REGEX,
  PINCODE_REGEX,
  DUMMY_PINCODES,
  isDummyPincode,
  GSTIN_REGEX,
  GSTIN_MESSAGE,
  PHONE_REGEX,
  INDIAN_MOBILE_REGEX,
  INDIAN_MOBILE_MESSAGE,
  OTP_CODE_REGEX,
  OTP_CODE_MESSAGE,
  PASSWORD_MIN_LENGTH,
  PAN_REGEX,
  PAN_MESSAGE,
  CIN_REGEX,
  CIN_MESSAGE,
  WEBSITE_REGEX,
  WEBSITE_MESSAGE,
  INDIAN_PINCODE_REGEX,
  INDIAN_PINCODE_MESSAGE,
  ORGANIZATION_TYPES,
  ISO_DATE_REGEX,
  ISO_DATE_MESSAGE,
  TIME_HORIZON_TYPES,
  CATEGORY_REVIEW_ACTIONS,
  DISPATCH_TEMPLATES,
  VALIDATION_SCHEMAS,
  validatePayload,
};
