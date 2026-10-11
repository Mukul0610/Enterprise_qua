import {
  FORM_SCHEMAS,
  validateFormData,
  validatePincode,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
  INDIAN_MOBILE_PATTERN,
  PINCODE_PATTERN,
  INDIAN_PINCODE_PATTERN,
  isDummyPincode,
  FormSchema,
} from '../../lib/validationSchemas';
import { UI_STRINGS } from '../../lib/uiStrings';

describe('Frontend validationSchemas Unit Tests', () => {
  describe('loginForm schema (email + mobile + password)', () => {
    const validLogin = {
      email: 'buyer@procucev.com',
      mobile: '9157154504',
      password: 'Pass@123',
    };

    test('accepts a complete, well-formed sign-in payload', () => {
      const res = validateFormData(FORM_SCHEMAS.loginForm, validLogin);
      expect(res.isValid).toBe(true);
      expect(res.fieldErrors).toEqual({});
    });

    test.each(['9157154504', '09157154504', '919157154504', '+919157154504', '+91 9157154504'])(
      'accepts the accepted Indian mobile form %s',
      (mobile) => {
        expect(INDIAN_MOBILE_PATTERN.test(mobile)).toBe(true);
        expect(validateFormData(FORM_SCHEMAS.loginForm, { ...validLogin, mobile }).isValid).toBe(true);
      }
    );

    test.each(['12345', '5157154504', '91571545040', '915715450', 'nine1five', ''])(
      'rejects the malformed mobile number %s',
      (mobile) => {
        const res = validateFormData(FORM_SCHEMAS.loginForm, { ...validLogin, mobile });
        expect(res.isValid).toBe(false);
        expect(res.fieldErrors.mobile).toBe(UI_STRINGS.auth.mobileInvalid);
      }
    );

    test('rejects a malformed email address', () => {
      const res = validateFormData(FORM_SCHEMAS.loginForm, { ...validLogin, email: 'not-an-email' });
      expect(res.isValid).toBe(false);
      expect(res.fieldErrors.email).toBe(UI_STRINGS.auth.emailInvalid);
    });

    test('rejects a missing password', () => {
      const res = validateFormData(FORM_SCHEMAS.loginForm, { ...validLogin, password: '' });
      expect(res.isValid).toBe(false);
      expect(res.fieldErrors.password).toBe(UI_STRINGS.auth.passwordRequired);
    });
  });

  test('validates rfqIngestion schema with valid data', () => {
    const validData = {
      title: 'Centrifugal Pump Equipment',
      category: 'Mechanical',
      budget: 15000,
      targetDeliveryDate: '2026-03-30',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
    };
    const res = validateFormData(FORM_SCHEMAS.rfqIngestion, validData);
    expect(res.isValid).toBe(true);
    expect(res.fieldErrors).toEqual({});
  });

  test('flags missing or invalid fields in rfqIngestion schema', () => {
    const invalidData = {
      title: 'A', // too short
      budget: -100, // below min
    };
    const res = validateFormData(FORM_SCHEMAS.rfqIngestion, invalidData);
    expect(res.isValid).toBe(false);
    expect(res.fieldErrors.title).toBeDefined();
    expect(res.fieldErrors.category).toBeDefined();
    expect(res.fieldErrors.budget).toBeDefined();
    expect(res.fieldErrors.targetDeliveryDate).toBeDefined();
  });

  test('validates vendorQualification schema regex checks', () => {
    const validData = {
      companyName: 'Apex Tools Ltd',
      corporateEmail: 'info@apex.com',
      contactPhone: '+1-555-0199',
      gstin: '29ABCDE1234F1Z5',
      category: 'Machinery',
    };
    const res = validateFormData(FORM_SCHEMAS.vendorQualification, validData);
    expect(res.isValid).toBe(true);

    const invalidData = {
      companyName: 'A', // too short
      corporateEmail: 'invalid-email',
      contactPhone: 'bad-phone',
      gstin: 'bad-gstin',
      category: '',
    };
    const resInvalid = validateFormData(FORM_SCHEMAS.vendorQualification, invalidData);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.fieldErrors.corporateEmail).toBeDefined();
    expect(resInvalid.fieldErrors.gstin).toBeDefined();
    expect(resInvalid.fieldErrors.contactPhone).toBeDefined();
  });

  test('validates quotationForm numeric constraints', () => {
    const validData = {
      unitPrice: 500,
      totalPrice: 5000,
      leadTimeDays: 7,
      paymentTerms: 'Net 30',
    };
    const res = validateFormData(FORM_SCHEMAS.quotationForm, validData);
    expect(res.isValid).toBe(true);

    const invalidData = {
      unitPrice: 'not-a-number',
      totalPrice: 0,
      leadTimeDays: 0,
      paymentTerms: '',
    };
    const resInvalid = validateFormData(FORM_SCHEMAS.quotationForm, invalidData);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.fieldErrors.unitPrice).toBeDefined();
    expect(resInvalid.fieldErrors.totalPrice).toBeDefined();
  });

  test('validates vendorRatingRevision schema boundaries', () => {
    const validData = {
      revisedScore: 92,
      revisionReason: 'Consistent performance and quality delivery',
    };
    const res = validateFormData(FORM_SCHEMAS.vendorRatingRevision, validData);
    expect(res.isValid).toBe(true);

    const invalidData = {
      revisedScore: 120, // exceeds max 100
      revisionReason: 'Bad', // too short
    };
    const resInvalid = validateFormData(FORM_SCHEMAS.vendorRatingRevision, invalidData);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.fieldErrors.revisedScore).toBeDefined();
    expect(resInvalid.fieldErrors.revisionReason).toBeDefined();
  });

  test('covers all fallback error messages and string maxLength rules', () => {
    const customSchema: FormSchema = {
      plainReq: { required: true },
      plainNum: { type: 'number', min: 10, max: 50 },
      plainStr: { type: 'string', minLength: 3, maxLength: 5, pattern: /^[A-Z]+$/ },
    };

    // Missing plainReq
    const res1 = validateFormData(customSchema, { plainNum: 'abc', plainStr: 'a' });
    expect(res1.isValid).toBe(false);
    expect(res1.fieldErrors.plainReq).toBe('plainReq is required');
    expect(res1.fieldErrors.plainNum).toBe('plainNum must be a number');
    expect(res1.fieldErrors.plainStr).toBe('plainStr must be at least 3 characters');

    // Number min/max fallbacks
    const res2 = validateFormData(customSchema, { plainReq: 'ok', plainNum: 5, plainStr: 'TOOLONG' });
    expect(res2.fieldErrors.plainNum).toBe('plainNum must be at least 10');
    expect(res2.fieldErrors.plainStr).toBe('plainStr cannot exceed 5 characters');

    // Number exceeding max and pattern mismatch fallback
    const res3 = validateFormData(customSchema, { plainReq: 'ok', plainNum: 100, plainStr: '123' });
    expect(res3.fieldErrors.plainNum).toBe('plainNum cannot exceed 50');
    expect(res3.fieldErrors.plainStr).toBe('plainStr format is invalid');

    // String rule with non-string value (e.g. number coerced)
    const res4 = validateFormData({ strField: { type: 'string', minLength: 2 } }, { strField: 123 });
    expect(res4.isValid).toBe(true);
    const res5 = validateFormData({ strField: { type: 'string', minLength: 5 } }, { strField: 123 });
    expect(res5.isValid).toBe(false);
  });

  test('handles null schema and empty inputs safely', () => {
    const res = validateFormData(null as any, { any: 'val' });
    expect(res.isValid).toBe(true);
  });

  test('validates buyerAccount schema', () => {
    const validData = {
      name: 'Jane Doe',
      email: 'jane@enterprise.com',
      department: 'Procurement',
      approvalLimit: 50000,
    };
    const res = validateFormData(FORM_SCHEMAS.buyerAccount, validData);
    expect(res.isValid).toBe(true);
  });

  test('validates cryptoEncryption and cryptoDecryption schemas', () => {
    const validEnc = { plaintext: 'Confidential ERP item' };
    const encRes = validateFormData(FORM_SCHEMAS.cryptoEncryption, validEnc);
    expect(encRes.isValid).toBe(true);

    const invalidEnc = { plaintext: '' };
    const encBad = validateFormData(FORM_SCHEMAS.cryptoEncryption, invalidEnc);
    expect(encBad.isValid).toBe(false);
    expect(encBad.fieldErrors.plaintext).toBeDefined();

    const validDec = {
      ciphertext: '0123456789abcdef',
      iv: '0123456789abcdef',
      authTag: '0123456789abcdef0123456789abcdef',
    };
    const decRes = validateFormData(FORM_SCHEMAS.cryptoDecryption, validDec);
    expect(decRes.isValid).toBe(true);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Delivery pincode / zipcode
//
// Deliberately broader than an Indian six-digit PIN: the same field carries
// international zipcodes for export orders.
// ══════════════════════════════════════════════════════════════════════════════
describe('PINCODE_PATTERN', () => {
  test.each([
    ['400701', 'Indian six-digit PIN'],
    ['110 001', 'PIN written with a space'],
    ['SW1A 1AA', 'UK postcode'],
    ['12345-6789', 'US ZIP+4'],
    ['751', 'short three-character code'],
  ])('accepts %s (%s)', (value) => {
    expect(PINCODE_PATTERN.test(value)).toBe(true);
  });

  test.each([
    ['', 'empty string'],
    ['40', 'shorter than three characters'],
    ['-400701', 'leading separator'],
    ['400!701', 'punctuation'],
    ['12345678901', 'longer than ten characters'],
  ])('rejects %s (%s)', (value) => {
    expect(PINCODE_PATTERN.test(value)).toBe(false);
  });
});

describe('INDIAN_PINCODE_PATTERN & isDummyPincode', () => {
  test('INDIAN_PINCODE_PATTERN validates Indian 6 digit pin', () => {
    expect(INDIAN_PINCODE_PATTERN.test('400701')).toBe(true);
    expect(INDIAN_PINCODE_PATTERN.test('012345')).toBe(false);
    expect(INDIAN_PINCODE_PATTERN.test('40070')).toBe(false);
    expect(INDIAN_PINCODE_PATTERN.test('4007011')).toBe(false);
  });

  test('isDummyPincode rejects dummy and sequential pin patterns', () => {
    expect(isDummyPincode('123456')).toBe(true);
    expect(isDummyPincode('654321')).toBe(true);
    expect(isDummyPincode('000000')).toBe(true);
    expect(isDummyPincode('111111')).toBe(true);
    expect(isDummyPincode('222222')).toBe(true);
    expect(isDummyPincode('999999')).toBe(true);
    expect(isDummyPincode('121212')).toBe(true);
    expect(isDummyPincode('7777777')).toBe(true);
    expect(isDummyPincode('400701')).toBe(false);
    expect(isDummyPincode('560001')).toBe(false);
    expect(isDummyPincode('')).toBe(false);
    expect(isDummyPincode('   ')).toBe(false);
    expect(isDummyPincode(null)).toBe(false);
    expect(isDummyPincode(undefined)).toBe(false);
    expect(isDummyPincode(123456)).toBe(false);
  });
});

describe('rfqIngestion schema', () => {
  // Optional so a document that prices nothing can still be saved.
  // The budget stays optional even though the destination is now mandatory.
  test('accepts a payload with no budget', () => {
    const { isValid } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
    });
    expect(isValid).toBe(true);
  });

  // Freight is rated on the destination, so a quote raised without one cannot be
  // compared against a quote that has one.
  test('requires a delivery location', () => {
    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      deliveryPincode: '400701',
    });
    expect(isValid).toBe(false);
    expect(fieldErrors.deliveryLocation).toBe(UI_STRINGS.rfqExtraction.deliveryLocationSchemaMessage);
  });

  test('requires a delivery pincode', () => {
    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    });
    expect(isValid).toBe(false);
    expect(fieldErrors.deliveryPincode).toBe(UI_STRINGS.rfqExtraction.deliveryPincodeInvalidMessage);
  });

  test('rejects a negative budget', () => {
    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      budget: -1,
    });
    expect(isValid).toBe(false);
    expect(fieldErrors.budget).toBeDefined();
  });

  test('rejects a malformed delivery pincode', () => {
    const { isValid, fieldErrors } = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Procurement of Bearing Housings',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-10-05',
      deliveryPincode: '!!',
    });
    expect(isValid).toBe(false);
    expect(fieldErrors.deliveryPincode).toBe(UI_STRINGS.rfqExtraction.deliveryPincodeInvalidMessage);
  });
});

describe('validatePincode async postal API validator', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('returns invalid for empty or non-string input', async () => {
    const res1 = await validatePincode('');
    expect(res1.isValid).toBe(false);
    expect(res1.message).toBe('PIN code is required');

    const res2 = await validatePincode('   ');
    expect(res2.isValid).toBe(false);
    expect(res2.message).toBe('PIN code is required');

    const res3 = await validatePincode(null as any);
    expect(res3.isValid).toBe(false);
    expect(res3.message).toBe('PIN code is required');
  });

  test('handles non-Indian postal codes', async () => {
    const validUk = await validatePincode('SW1A 1AA', false);
    expect(validUk.isValid).toBe(true);

    const invalidUk = await validatePincode('!', false);
    expect(invalidUk.isValid).toBe(false);
    expect(invalidUk.message).toBe('Invalid postal code format');
  });

  test('rejects invalid Indian PIN format', async () => {
    const startsWithZero = await validatePincode('012345');
    expect(startsWithZero.isValid).toBe(false);
    expect(startsWithZero.message).toContain('cannot start with 0');

    const shortPin = await validatePincode('40070');
    expect(shortPin.isValid).toBe(false);
    expect(shortPin.message).toContain('must be 6 digits');
  });

  test('rejects dummy and sequential PIN codes', async () => {
    const dummy = await validatePincode('123456');
    expect(dummy.isValid).toBe(false);
    expect(dummy.message).toContain('Invalid test or sequential PIN code');
  });

  test('resolves successfully when postal API returns Success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          Status: 'Success',
          PostOffice: [
            {
              Name: 'Koparkhairane',
              District: 'Thane',
              State: 'Maharashtra',
            },
          ],
        },
      ],
    } as any);

    const res = await validatePincode('400709');
    expect(res.isValid).toBe(true);
    expect(res.postOffices?.[0].Name).toBe('Koparkhairane');
  });

  test('resolves successfully with empty postOffices when PostOffice is missing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          Status: 'Success',
        },
      ],
    } as any);

    const res = await validatePincode('400709');
    expect(res.isValid).toBe(true);
    expect(res.postOffices).toEqual([]);
  });

  test('returns invalid when postal API returns Error / not found', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          Status: 'Error',
          Message: 'No records found',
        },
      ],
    } as any);

    const res = await validatePincode('400799');
    expect(res.isValid).toBe(false);
    expect(res.message).toBe('PIN Code is not found or invalid in postal records.');
  });

  test('falls back gracefully on non-ok HTTP status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as any);

    const res = await validatePincode('400701');
    expect(res.isValid).toBe(true);
  });

  test('falls back gracefully on network or JSON parse exception', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

    const res = await validatePincode('400701');
    expect(res.isValid).toBe(true);
  });

  test('handles empty, non-Indian, and dummy pincode validation branches', async () => {
    // Empty
    expect(await validatePincode('')).toEqual({ isValid: false, message: 'PIN code is required' });

    // Non-Indian valid
    expect(await validatePincode('SW1A 1AA', false)).toEqual({ isValid: true });

    // Non-Indian invalid
    expect(await validatePincode('??!!', false)).toEqual({ isValid: false, message: 'Invalid postal code format' });

    // Starts with 0
    expect(await validatePincode('012345')).toEqual({
      isValid: false,
      message: 'PIN Code must be 6 digits and cannot start with 0',
    });

    // Dummy PIN
    expect(await validatePincode('111111')).toEqual({
      isValid: false,
      message: 'Invalid test or sequential PIN code. Enter a valid postal code.',
    });
  });

  test('exercises timeout abort callback in validatePincode', async () => {
    jest.useFakeTimers();
    let abortCalled = false;
    global.fetch = jest.fn((url: any, init?: any) => {
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          abortCalled = true;
        });
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            json: async () => [{ Status: 'Success', PostOffice: [] }],
          } as any);
        }, 10000);
      });
    });

    const promise = validatePincode('400701');
    jest.advanceTimersByTime(6000);
    jest.advanceTimersByTime(5000);
    const res = await promise;
    expect(res.isValid).toBe(true);
    expect(abortCalled).toBe(true);
    jest.useRealTimers();
  });
});

