/**
 * Enterprise Frontend Input Validation Schemas
 * Single source of truth for all form validations, user input limits, and payload verification.
 */

import { UI_STRINGS } from './uiStrings';

/**
 * Shortest password accepted when an account holder changes their own password.
 *
 * Drives both the `minLength` attribute on the field and the schema rule below,
 * and mirrors PASSWORD_MIN_LENGTH in backend/src/config/validationSchemas.js, so
 * the browser hint, the client check and the server boundary all agree.
 *
 * Defined here rather than in ./constants because that module imports from this
 * one; the reverse import would be circular. It is re-exported from ./constants
 * for callers that expect to find constants there.
 */
export const PASSWORD_MIN_LENGTH = 8;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
export const PHONE_PATTERN = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{7,15}$/;

/**
 * Indian mobile number accepted at sign-in and registration. The identity
 * database stores these normalised to +91XXXXXXXXXX, so the input must resolve
 * to exactly ten national digits beginning 6-9, optionally prefixed with
 * +91 / 0 / 91.
 */
export const INDIAN_MOBILE_PATTERN = /^(?:\+?91[-\s]?|0)?[6-9]\d{9}$/;

/**
 * Delivery pincode or zipcode.
 *
 * Deliberately broader than an Indian six-digit PIN: the same field carries
 * international zipcodes for export orders, which are alphanumeric and may
 * contain a space or hyphen (for example SW1A 1AA or 12345-6789). It must still
 * start with a letter or digit so a stray separator is rejected.
 */
export const PINCODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\s-]{2,9}$/;

export const DUMMY_PINCODES = new Set([
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
  '012345', '123456', '234567', '345678', '456789', '567890',
  '654321', '765432', '876543', '987654', '098765',
  '121212', '212121', '123123', '321321', '000001', '100000',
]);

/**
 * Checks if a string is a dummy, test, or sequential PIN code
 */
export function isDummyPincode(pincode: unknown): boolean {
  if (!pincode || typeof pincode !== 'string') return false;
  const clean = pincode.trim().replace(/\s+/g, '');
  if (!clean) return false;
  if (DUMMY_PINCODES.has(clean)) return true;
  if (/^(\d)\1{5,}$/.test(clean)) return true;
  return false;
}

/**
 * Statutory identifiers on the buyer organisation profile. Each mirrors the
 * corresponding regex in backend/src/config/validationSchemas.js, which is the
 * gate that actually protects the `organization` row; these exist so the buyer is
 * told about a malformed value while typing rather than after a round trip.
 */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
export const CIN_PATTERN = /^[LUu][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/i;
export const WEBSITE_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/**
 * Registered-office PIN code. Narrower than PINCODE_PATTERN above, which carries
 * international delivery zipcodes: a buyer's registered address is an Indian
 * statutory address, so it is exactly six digits and cannot begin with zero.
 */
export const INDIAN_PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

export interface FieldRule {
  required?: boolean;
  type?: 'string' | 'number' | 'array';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: string[];
  message?: string;
}

export type FormSchema = Record<string, FieldRule>;

export const FORM_SCHEMAS: Record<string, FormSchema> = {
  /**
   * Password sign-in. The backend re-checks the same three fields and resolves
   * the account by email + mobile together, so the mobile number is a hard
   * requirement here rather than an optional contact detail.
   */
  loginForm: {
    email: { required: true, pattern: EMAIL_PATTERN, message: UI_STRINGS.auth.emailInvalid },
    mobile: { required: true, pattern: INDIAN_MOBILE_PATTERN, message: UI_STRINGS.auth.mobileInvalid },
    password: { required: true, message: UI_STRINGS.auth.passwordRequired },
  },

  /**
   * Self-service password change. No email field: the account is resolved from
   * the session token server-side, so the form only ever collects the credential
   * proof and the replacement. `minLength` matches PASSWORD_MIN_LENGTH and the
   * backend's `changePassword` schema, so all three agree on the boundary.
   */
  changePasswordForm: {
    currentPassword: {
      required: true,
      message: UI_STRINGS.accountSecurity.currentPasswordRequired,
    },
    newPassword: {
      required: true,
      minLength: PASSWORD_MIN_LENGTH,
      message: UI_STRINGS.accountSecurity.weakPasswordMessage,
    },
  },

  rfqIngestion: {
    title: { required: true, minLength: 3, maxLength: 200, message: 'Title must be between 3 and 200 characters' },
    category: { required: true, message: 'Category selection is required' },
    // Optional: a document that prices nothing yields no figure, and a required
    // budget forced the buyer to invent a ceiling that vendors would then quote
    // against. Zero is accepted and rendered as "not set" rather than as ₹0.
    budget: { required: false, type: 'number', min: 0, message: 'Estimated budget cannot be negative' },
    targetDeliveryDate: { required: true, message: 'Target delivery date is required' },
    // Both delivery fields are mandatory. Vendors rate freight on the destination
    // and its pincode, so quotes raised without them are not comparable against
    // quotes that have them, and the buyer cannot resolve the difference later.
    deliveryLocation: {
      required: true,
      minLength: 3,
      maxLength: 200,
      message: UI_STRINGS.rfqExtraction.deliveryLocationSchemaMessage,
    },
    deliveryPincode: {
      required: true,
      pattern: PINCODE_PATTERN,
      message: UI_STRINGS.rfqExtraction.deliveryPincodeInvalidMessage,
    },
  },

  vendorQualification: {
    companyName: { required: true, minLength: 2, maxLength: 150, message: 'Company legal name is required' },
    corporateEmail: { required: true, pattern: EMAIL_PATTERN, message: 'Please provide a valid corporate email' },
    contactPhone: { required: false, pattern: PHONE_PATTERN, message: 'Please provide a valid phone number' },
    gstin: { required: false, pattern: GSTIN_PATTERN, message: 'GSTIN format must be valid (15 alphanumeric characters)' },
    category: { required: true, message: 'Primary industry category is required' },
  },

  quotationForm: {
    unitPrice: { required: true, type: 'number', min: 0.01, message: 'Unit price must be greater than zero' },
    totalPrice: { required: true, type: 'number', min: 0.01, message: 'Total price must be greater than zero' },
    leadTimeDays: { required: true, type: 'number', min: 1, message: 'Lead time must be at least 1 day' },
    paymentTerms: { required: true, minLength: 2, message: 'Payment terms are required' },
  },

  /**
   * Buyer organisation profile form.
   *
   * Only the legal entity name is required, matching the server: the endpoint
   * patches whatever is supplied and leaves the rest of the stored record alone,
   * so a buyer can fill the profile in over several visits. The optional fields
   * are still format-checked whenever they carry a value, which the old Angular
   * screen did for GSTIN alone.
   */
  buyerProfile: {
    companyName: { required: true, minLength: 2, maxLength: 255, message: UI_STRINGS.buyerProfile.companyNameRequired },
    panNumber: { required: false, pattern: PAN_PATTERN, message: UI_STRINGS.buyerProfile.panInvalid },
    gstNumber: { required: false, pattern: GSTIN_PATTERN, message: UI_STRINGS.buyerProfile.gstInvalid },
    cinNumber: { required: false, pattern: CIN_PATTERN, message: UI_STRINGS.buyerProfile.cinInvalid },
    website: { required: false, pattern: WEBSITE_PATTERN, message: UI_STRINGS.buyerProfile.websiteInvalid },
    pincode: { required: false, pattern: INDIAN_PINCODE_PATTERN, message: UI_STRINGS.buyerProfile.pincodeInvalid },
  },

  buyerAccount: {
    name: { required: true, minLength: 2, message: 'Full name is required' },
    email: { required: true, pattern: EMAIL_PATTERN, message: 'Valid corporate email required' },
    department: { required: true, message: 'Department is required' },
    approvalLimit: { required: false, type: 'number', min: 0, message: 'Approval limit cannot be negative' },
  },

  vendorRatingRevision: {
    revisedScore: { required: true, type: 'number', min: 0, max: 100, message: 'Score must be between 0 and 100' },
    revisionReason: { required: true, minLength: 5, maxLength: 500, message: 'Revision reason must be between 5 and 500 characters' },
  },

  cryptoEncryption: {
    plaintext: { required: true, minLength: 1, message: 'Plaintext data is required for encryption' },
    secretKey: { required: false, minLength: 8, message: 'Encryption key must be at least 8 characters' },
  },

  cryptoDecryption: {
    ciphertext: { required: true, minLength: 1, message: 'Ciphertext is required for decryption' },
    iv: { required: true, minLength: 12, message: 'Initialization vector is required' },
    authTag: { required: true, minLength: 16, message: 'Authentication tag is required' },
  },
};


/**
 * Universal Form Data Validator
 * Validates form state against centralized schemas and returns field-level error messages.
 */
export function validateFormData(schema: FormSchema, data: Record<string, any>): {
  isValid: boolean;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};

  if (!schema) {
    return { isValid: true, fieldErrors: {} };
  }

  for (const [field, rule] of Object.entries(schema)) {
    const value = data[field];

    // Required check
    if (rule.required && (value === undefined || value === null || value === '')) {
      fieldErrors[field] = rule.message || `${field} is required`;
      continue;
    }

    if (value !== undefined && value !== null && value !== '') {
      // Numeric check
      if (rule.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) {
          fieldErrors[field] = rule.message || `${field} must be a number`;
          continue;
        }
        if (rule.min !== undefined && num < rule.min) {
          fieldErrors[field] = rule.message || `${field} must be at least ${rule.min}`;
          continue;
        }
        if (rule.max !== undefined && num > rule.max) {
          fieldErrors[field] = rule.message || `${field} cannot exceed ${rule.max}`;
          continue;
        }
      } else if (rule.type === 'string' || typeof value === 'string') {
        const str = String(value).trim();
        if (rule.minLength && str.length < rule.minLength) {
          fieldErrors[field] = rule.message || `${field} must be at least ${rule.minLength} characters`;
          continue;
        }
        if (rule.maxLength && str.length > rule.maxLength) {
          fieldErrors[field] = rule.message || `${field} cannot exceed ${rule.maxLength} characters`;
          continue;
        }
        if (rule.pattern && !rule.pattern.test(str)) {
          fieldErrors[field] = rule.message || `${field} format is invalid`;
          continue;
        }
      }
    }
  }

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export interface PostOfficeDetail {
  Name: string;
  Description?: string | null;
  BranchType?: string;
  DeliveryStatus?: string;
  Circle?: string;
  District: string;
  Division?: string;
  Region?: string;
  State: string;
  Country?: string;
  Pincode?: string;
}

export interface PincodeValidationResult {
  isValid: boolean;
  message?: string;
  postOffices?: PostOfficeDetail[];
}

/**
 * Validates Indian PIN code format and performs live postal verification lookup via Postal PIN Code API
 */
export async function validatePincode(
  pincode: string,
  isIndianFormat: boolean = true
): Promise<PincodeValidationResult> {
  const pin = (pincode || '').trim();
  if (!pin) {
    return { isValid: false, message: 'PIN code is required' };
  }

  // International postal codes allowed if not 6-digit number or explicitly non-Indian
  if (!isIndianFormat || !/^\d+$/.test(pin)) {
    if (PINCODE_PATTERN.test(pin)) {
      return { isValid: true };
    }
    return { isValid: false, message: 'Invalid postal code format' };
  }

  // Format check for Indian 6-digit PIN code
  if (!INDIAN_PINCODE_PATTERN.test(pin)) {
    return {
      isValid: false,
      message: 'PIN Code must be 6 digits and cannot start with 0',
    };
  }

  // Dummy PIN code detection
  if (isDummyPincode(pin)) {
    return {
      isValid: false,
      message: 'Invalid test or sequential PIN code. Enter a valid postal code.',
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { isValid: true }; // Network fallback
    }

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0 && data[0].Status === 'Success') {
      return {
        isValid: true,
        postOffices: data[0].PostOffice || [],
      };
    } else if (!Array.isArray(data)) {
      return { isValid: true };
    } else {
      return {
        isValid: false,
        message: 'PIN Code is not found or invalid in postal records.',
      };
    }
  } catch (error) {
    return { isValid: true }; // Network fallback
  }
}

const CITY_PREFIX_MAP: Record<string, string> = {
  '4007': 'Navi Mumbai, Maharashtra',
  '400': 'Mumbai, Maharashtra',
  '411': 'Pune, Maharashtra',
  '440': 'Nagpur, Maharashtra',
  '110': 'New Delhi, Delhi',
  '560': 'Bengaluru, Karnataka',
  '600': 'Chennai, Tamil Nadu',
  '700': 'Kolkata, West Bengal',
  '500': 'Hyderabad, Telangana',
  '380': 'Ahmedabad, Gujarat',
  '390': 'Vadodara, Gujarat',
  '395': 'Surat, Gujarat',
  '302': 'Jaipur, Rajasthan',
  '226': 'Lucknow, Uttar Pradesh',
  '201': 'Noida, Uttar Pradesh',
  '122': 'Gurugram, Haryana',
  '160': 'Chandigarh, Punjab',
  '800': 'Patna, Bihar',
  '751': 'Bhubaneswar, Odisha',
  '781': 'Guwahati, Assam',
  '682': 'Kochi, Kerala',
  '695': 'Thiruvananthapuram, Kerala',
  '641': 'Coimbatore, Tamil Nadu',
  '530': 'Visakhapatnam, Andhra Pradesh',
  '452': 'Indore, Madhya Pradesh',
  '462': 'Bhopal, Madhya Pradesh',
};

const STATE_PREFIX_MAP: Record<string, string> = {
  '11': 'Delhi, Delhi',
  '12': 'Haryana',
  '13': 'Haryana',
  '14': 'Punjab',
  '15': 'Punjab',
  '16': 'Chandigarh',
  '17': 'Himachal Pradesh',
  '18': 'Jammu and Kashmir',
  '19': 'Jammu and Kashmir',
  '20': 'Uttar Pradesh',
  '21': 'Uttar Pradesh',
  '22': 'Uttar Pradesh',
  '23': 'Uttar Pradesh',
  '24': 'Uttar Pradesh',
  '25': 'Uttar Pradesh',
  '26': 'Uttar Pradesh',
  '27': 'Uttar Pradesh',
  '28': 'Uttar Pradesh',
  '30': 'Rajasthan',
  '31': 'Rajasthan',
  '32': 'Rajasthan',
  '33': 'Rajasthan',
  '34': 'Rajasthan',
  '36': 'Gujarat',
  '37': 'Gujarat',
  '38': 'Gujarat',
  '39': 'Gujarat',
  '40': 'Maharashtra',
  '41': 'Maharashtra',
  '42': 'Maharashtra',
  '43': 'Maharashtra',
  '44': 'Maharashtra',
  '45': 'Madhya Pradesh',
  '46': 'Madhya Pradesh',
  '47': 'Madhya Pradesh',
  '48': 'Madhya Pradesh',
  '49': 'Chhattisgarh',
  '50': 'Telangana',
  '51': 'Andhra Pradesh',
  '52': 'Andhra Pradesh',
  '53': 'Andhra Pradesh',
  '56': 'Karnataka',
  '57': 'Karnataka',
  '58': 'Karnataka',
  '59': 'Karnataka',
  '60': 'Tamil Nadu',
  '61': 'Tamil Nadu',
  '62': 'Tamil Nadu',
  '63': 'Tamil Nadu',
  '64': 'Tamil Nadu',
  '67': 'Kerala',
  '68': 'Kerala',
  '69': 'Kerala',
  '70': 'West Bengal',
  '71': 'West Bengal',
  '72': 'West Bengal',
  '73': 'West Bengal',
  '74': 'West Bengal',
  '75': 'Odisha',
  '76': 'Odisha',
  '77': 'Odisha',
  '78': 'Assam',
  '80': 'Bihar',
  '81': 'Bihar',
  '82': 'Bihar',
  '83': 'Bihar',
  '84': 'Bihar',
  '85': 'Bihar',
};

/**
 * Returns a fallback city and state for valid Indian PIN codes when postal network API is unreachable.
 */
export function getFallbackLocationForPincode(pincode: string): string {
  const pin = (pincode || '').trim();
  if (pin.length < 2) return '';
  if (pin.startsWith('4007')) return CITY_PREFIX_MAP['4007'];
  const prefix3 = pin.slice(0, 3);
  if (CITY_PREFIX_MAP[prefix3]) {
    return CITY_PREFIX_MAP[prefix3];
  }
  const prefix2 = pin.slice(0, 2);
  return STATE_PREFIX_MAP[prefix2] || '';
}

/**
 * Resolves a city and state location string from postal validation post offices or fallback mapping.
 */
export function resolveLocationFromPostalResult(
  pincode: string,
  offices?: PostOfficeDetail[]
): string {
  if (offices && offices.length > 0) {
    const po = offices[0];
    const city = po.District || po.Division || po.Circle || po.Name || '';
    const state = po.State || '';
    const formatted = [city, state].filter(Boolean).join(', ');
    if (formatted) return formatted;
  }
  return getFallbackLocationForPincode(pincode);
}

