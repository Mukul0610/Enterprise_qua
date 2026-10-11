const {
  VALIDATION_SCHEMAS,
  validatePayload,
  EMAIL_REGEX,
  GSTIN_REGEX,
  PHONE_REGEX,
  INDIAN_MOBILE_REGEX,
  INDIAN_MOBILE_MESSAGE,
} = require('../src/config/validationSchemas');

describe('Backend Validation Schemas Unit Tests', () => {
  describe('login schema mobile number', () => {
    const base = { email: 'buyer@procucev.com', password: 'Pass@123' };

    test.each(['9157154504', '09157154504', '919157154504', '+919157154504', '+91 9157154504'])(
      'accepts %s',
      (mobile) => {
        expect(INDIAN_MOBILE_REGEX.test(mobile)).toBe(true);
        expect(validatePayload(VALIDATION_SCHEMAS.login, { ...base, mobile }).isValid).toBe(true);
      }
    );

    test.each(['12345', '5157154504', '91571545040', 'nine1five'])('rejects %s', (mobile) => {
      const res = validatePayload(VALIDATION_SCHEMAS.login, { ...base, mobile });
      expect(res.isValid).toBe(false);
      expect(res.errors.mobile).toBe(INDIAN_MOBILE_MESSAGE);
    });

    // The OTP branch of POST /api/auth/login identifies the account by email
    // alone, so an absent mobile number must not fail schema validation.
    test('treats an absent mobile number as valid so the OTP branch still works', () => {
      const res = validatePayload(VALIDATION_SCHEMAS.login, { email: base.email, code: '123456' });
      expect(res.isValid).toBe(true);
    });

    test('applies the same mobile pattern to the register schema', () => {
      const payload = { email: base.email, password: base.password, name: 'Buyer' };
      expect(validatePayload(VALIDATION_SCHEMAS.register, { ...payload, mobile: '9157154504' }).isValid).toBe(
        true
      );

      const bad = validatePayload(VALIDATION_SCHEMAS.register, { ...payload, mobile: '12345' });
      expect(bad.isValid).toBe(false);
      expect(bad.errors.mobile).toBe(INDIAN_MOBILE_MESSAGE);
    });
  });

  test('validates createRFQ schema with valid data', () => {
    const validRFQ = {
      title: 'High Pressure Water Pump',
      category: 'Mechanical',
      budget: 50000,
      targetDeliveryDate: '2026-04-15',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
      lineItems: [{ name: 'Pump', qty: 2 }],
    };
    const res = validatePayload(VALIDATION_SCHEMAS.createRFQ, validRFQ);
    expect(res.isValid).toBe(true);
    expect(res.errors).toEqual({});
  });

  test('flags missing required fields in createRFQ schema', () => {
    const invalidRFQ = {
      title: 'Hi', // too short
      category: '',
      budget: -10, // below min
    };
    const res = validatePayload(VALIDATION_SCHEMAS.createRFQ, invalidRFQ);
    expect(res.isValid).toBe(false);
    expect(res.errors.title).toBeDefined();
    expect(res.errors.budget).toBeDefined();
    expect(res.errors.targetDeliveryDate).toBeDefined();
  });

  // Major/Minor Category are optional per line item (manualRfqModel.ts) — an
  // RFQ with no categorized line item has no derivable top-level category
  // either, and that must not block dispatch.
  test('does not require category on createRFQ — an uncategorised RFQ can still dispatch', () => {
    const rfqWithNoCategory = {
      title: 'Uncategorised RFQ',
      deliveryLocation: 'Pune',
      deliveryPincode: '411001',
      lineItems: [{ name: 'Widget', qty: 5 }],
    };
    const res = validatePayload(VALIDATION_SCHEMAS.createRFQ, rfqWithNoCategory);
    expect(res.errors.category).toBeUndefined();
  });

  test('validates vendorRegistration schema including email and GSTIN format', () => {
    const validVendor = {
      name: 'Apex Industrial Supplies',
      corporateEmail: 'procurement@apexsupplies.com',
      gstin: '29ABCDE1234F1Z5',
      majorCategory: 'Engineering',
      contactPhone: '+91 9876543210',
    };
    const res = validatePayload(VALIDATION_SCHEMAS.vendorRegistration, validVendor);
    expect(res.isValid).toBe(true);
  });

  test('flags invalid email and invalid phone in vendorRegistration', () => {
    const invalidVendor = {
      name: 'Apex',
      corporateEmail: 'invalid-email',
      gstin: '123-bad-gstin',
      majorCategory: 'Engineering',
      contactPhone: 'bad-phone',
    };
    const res = validatePayload(VALIDATION_SCHEMAS.vendorRegistration, invalidVendor);
    expect(res.isValid).toBe(false);
    expect(res.errors.corporateEmail).toBeDefined();
    expect(res.errors.gstin).toBeDefined();
    expect(res.errors.contactPhone).toBeDefined();
  });

  test('validates submitQuote schema with numeric boundaries', () => {
    const quote = {
      rfqId: 'rfq-1',
      vendorId: 'v-1',
      unitPrice: 1500,
      totalPrice: 15000,
      leadTimeDays: 10,
      warrantyYears: 2,
    };
    const res = validatePayload(VALIDATION_SCHEMAS.submitQuote, quote);
    expect(res.isValid).toBe(true);
  });

  test('validates rating revision score boundaries (0 to 100)', () => {
    const validRevision = {
      vendorId: 'v-1',
      revisedScore: 85,
      revisionReason: 'Consistent on-time delivery across Q1 projects.',
    };
    const resValid = validatePayload(VALIDATION_SCHEMAS.updateRatingRevision, validRevision);
    expect(resValid.isValid).toBe(true);

    const invalidRevision = {
      vendorId: 'v-1',
      revisedScore: 150, // exceeds max
      revisionReason: 'Bad', // too short
    };
    const resInvalid = validatePayload(VALIDATION_SCHEMAS.updateRatingRevision, invalidRevision);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.errors.revisedScore).toBeDefined();
    expect(resInvalid.errors.revisionReason).toBeDefined();
  });

  test('validates audit query parameters with enum checking', () => {
    const validQuery = {
      page: 1,
      limit: 50,
      severity: 'ERROR',
    };
    const res = validatePayload(VALIDATION_SCHEMAS.auditQuery, validQuery);
    expect(res.isValid).toBe(true);

    const invalidQuery = {
      page: 'not-a-number',
      severity: 'SUPER_CRITICAL', // invalid enum
    };
    const resInvalid = validatePayload(VALIDATION_SCHEMAS.auditQuery, invalidQuery);
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.errors.page).toBeDefined();
    expect(resInvalid.errors.severity).toBeDefined();
  });

  test('handles empty or null schema gracefully', () => {
    const res = validatePayload(null, { any: 'data' });
    expect(res.isValid).toBe(true);
  });

  test('handles invalid array type rule', () => {
    const schema = { items: { type: 'array', required: true } };
    const res = validatePayload(schema, { items: 'not-an-array' });
    expect(res.isValid).toBe(false);
    expect(res.errors.items).toBeDefined();
  });

  test('validates crypto validation schemas', () => {
    const validEncrypt = { plaintext: 'Secret RFQ budget' };
    const encRes = validatePayload(VALIDATION_SCHEMAS.encryptPayload, validEncrypt);
    expect(encRes.isValid).toBe(true);

    const invalidEncrypt = { plaintext: '' };
    const encBadRes = validatePayload(VALIDATION_SCHEMAS.encryptPayload, invalidEncrypt);
    expect(encBadRes.isValid).toBe(false);

    const validDecrypt = {
      ciphertext: '0123456789abcdef',
      iv: '0123456789abcdef',
      authTag: '0123456789abcdef0123456789abcdef',
    };
    const decRes = validatePayload(VALIDATION_SCHEMAS.decryptPayload, validDecrypt);
    expect(decRes.isValid).toBe(true);

    const validIntegrity = {
      ciphertext: '0123456789abcdef',
      iv: '0123456789abcdef',
      authTag: '0123456789abcdef0123456789abcdef',
    };
    const intRes = validatePayload(VALIDATION_SCHEMAS.verifyCryptoIntegrity, validIntegrity);
    expect(intRes.isValid).toBe(true);
  });

  describe('normalizePoDate', () => {
    const { normalizePoDate } = require('../src/config/constants');

    it('returns empty string for empty inputs', () => {
      expect(normalizePoDate(null)).toBe('');
      expect(normalizePoDate(undefined)).toBe('');
      expect(normalizePoDate('')).toBe('');
      expect(normalizePoDate('   ')).toBe('');
    });

    it('handles Date instances', () => {
      expect(normalizePoDate(new Date('2025-12-04T00:00:00Z'))).toBe('2025-12-04');
      expect(normalizePoDate(new Date('invalid'))).toBe('');
    });

    it('converts Excel serial numbers and decimal strings to ISO dates', () => {
      expect(normalizePoDate(45995)).toBe('2025-12-04');
      expect(normalizePoDate(45995.00011574074)).toBe('2025-12-04');
      expect(normalizePoDate('45995.00011574074')).toBe('2025-12-04');
      expect(normalizePoDate('45995')).toBe('2025-12-04');
      expect(normalizePoDate(25569)).toBe('1970-01-01');
      expect(normalizePoDate(0)).toBe('');
    });

    it('handles ISO and slash date formats', () => {
      expect(normalizePoDate('2025-12-04')).toBe('2025-12-04');
      expect(normalizePoDate('2025/12/04')).toBe('2025-12-04');
      expect(normalizePoDate('2025.12.04')).toBe('2025-12-04');
    });

    it('handles DD-MM-YYYY and DD/MM/YYYY formats', () => {
      expect(normalizePoDate('12-04-2025')).toBe('2025-04-12');
      expect(normalizePoDate('25-12-2025')).toBe('2025-12-25');
      expect(normalizePoDate('05/12/2025')).toBe('2025-12-05');
      expect(normalizePoDate('12/25/2025')).toBe('2025-12-25');
    });

    it('handles generic date strings and non-parseable fallbacks', () => {
      expect(normalizePoDate('Dec 4, 2025')).toBe('2025-12-04');
      expect(normalizePoDate('invalid-date')).toBe('invalid-date');
    });
  });
});


