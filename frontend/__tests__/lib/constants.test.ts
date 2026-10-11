import {
  SOURCING_MODES,
  CURRENCY,
  formatCurrency,
  formatFileSize,
  MANUAL_LINE_ITEM_DEFAULTS,
  INITIAL_SYSTEM_CONFIG,
  INITIAL_AZURE_HEALTH,
  BUYER_SUBSCRIPTION_PLANS,
  VENDOR_SUBSCRIPTION_PLANS,
  AES_CONFIG,
  FORM_SCHEMAS,
  validateFormData,
  EMAIL_PATTERN,
  GSTIN_PATTERN,
  PHONE_PATTERN,
  DISPLAY_TIMEZONE,
  RFQ_STATUSES,
  formatIndianDate,
  formatIndianDateTime,
  BUYER_SUBSCRIPTION_TO_SOURCING_MODE,
  resolveBuyerSourcingMode,
  entitledSourcingModes,
  normalizePoDate,
} from '@/lib/constants';


describe('lib/constants', () => {
  it('should export valid SOURCING_MODES', () => {
    expect(Array.isArray(SOURCING_MODES)).toBe(true);
    expect(SOURCING_MODES.length).toBe(4);

    const mode0 = SOURCING_MODES.find(m => m.id === 'mode_0');
    expect(mode0).toBeDefined();
    expect(mode0?.code).toBe('Version 0');

    const mode1 = SOURCING_MODES.find(m => m.id === 'mode_1');
    expect(mode1).toBeDefined();
    expect(mode1?.code).toBe('Version 1');
    expect(mode1?.name).toContain('Client Roster');

    const mode2 = SOURCING_MODES.find(m => m.id === 'mode_2');
    expect(mode2).toBeDefined();
    expect(mode2?.code).toBe('Version 2');

    const mode3 = SOURCING_MODES.find(m => m.id === 'mode_3');
    expect(mode3).toBeDefined();
    expect(mode3?.code).toBe('Version 3');
  });

  it('should export valid subscription plans', () => {
    expect(Array.isArray(BUYER_SUBSCRIPTION_PLANS)).toBe(true);
    expect(BUYER_SUBSCRIPTION_PLANS.length).toBeGreaterThan(0);
    expect(Array.isArray(VENDOR_SUBSCRIPTION_PLANS)).toBe(true);
    expect(VENDOR_SUBSCRIPTION_PLANS.length).toBeGreaterThan(0);
  });

  it('should export valid INITIAL_SYSTEM_CONFIG', () => {
    expect(INITIAL_SYSTEM_CONFIG).toBeDefined();
    expect(INITIAL_SYSTEM_CONFIG.ollamaModel).toBe('Llama 3 (8B Instruct)');
    expect(INITIAL_SYSTEM_CONFIG.ollamaActive).toBe(true);
    expect(INITIAL_SYSTEM_CONFIG.ocrExtractionThreshold).toBe(85);
    expect(INITIAL_SYSTEM_CONFIG.escalationIntervalHours).toBe(24);
    expect(INITIAL_SYSTEM_CONFIG.azureDbBackupFrequency).toBe('Daily');
    expect(INITIAL_SYSTEM_CONFIG.rbacEnforced).toBe(true);
  });

  it('should export valid INITIAL_AZURE_HEALTH services', () => {
    expect(Array.isArray(INITIAL_AZURE_HEALTH)).toBe(true);
    expect(INITIAL_AZURE_HEALTH.length).toBeGreaterThanOrEqual(5);
    
    const services = INITIAL_AZURE_HEALTH.map(s => s.service);
    expect(services.some(s => s.includes('PostgreSQL'))).toBe(true);
    expect(services.some(s => s.includes('OpenAI'))).toBe(true);
    expect(services.some(s => s.includes('Cosmos DB'))).toBe(true);
    expect(services.some(s => s.includes('Communication Services'))).toBe(true);
    expect(services.some(s => s.includes('Key Vault'))).toBe(true);
  });

  it('should re-export validation schemas, regex patterns, and validation helpers', () => {
    expect(FORM_SCHEMAS).toBeDefined();
    expect(FORM_SCHEMAS.rfqIngestion).toBeDefined();
    expect(EMAIL_PATTERN).toBeDefined();
    expect(GSTIN_PATTERN).toBeDefined();
    expect(PHONE_PATTERN).toBeDefined();
    expect(typeof validateFormData).toBe('function');

    const result = validateFormData(FORM_SCHEMAS.rfqIngestion, {
      title: 'Valid RFQ Title',
      category: 'Mechanical',
      budget: 20000,
      targetDeliveryDate: '2026-03-30',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
    });
    expect(result.isValid).toBe(true);
  });

  it('should export valid AES_CONFIG constants', () => {
    expect(AES_CONFIG).toBeDefined();
    expect(AES_CONFIG.ALGORITHM).toBe('AES-GCM');
    expect(AES_CONFIG.KEY_LENGTH_BITS).toBe(256);
    expect(AES_CONFIG.IV_LENGTH_BYTES).toBe(12);
    expect(AES_CONFIG.TAG_LENGTH_BITS).toBe(128);
    expect(AES_CONFIG.PBKDF2_ITERATIONS).toBe(100000);
  });
});

describe('CURRENCY and formatCurrency', () => {
  it('pairs the rupee symbol with Indian grouping', () => {
    expect(CURRENCY.SYMBOL).toBe('₹');
    expect(CURRENCY.CODE).toBe('INR');
    expect(CURRENCY.LOCALE).toBe('en-IN');
  });

  it('groups amounts the Indian way, not in thousands', () => {
    // 1,45,000 rather than 145,000: the symbol and the grouping must agree.
    expect(formatCurrency(145000)).toBe('₹1,45,000');
    expect(formatCurrency(0)).toBe('₹0');
  });

  it('rounds to whole rupees because every figure shown is a total', () => {
    expect(formatCurrency(1500.4)).toBe('₹1,500');
    expect(formatCurrency(1500.6)).toBe('₹1,501');
  });

  // A record written before budget was persisted yields NaN here, and a crash on
  // a missing budget is exactly the defect this guard exists to prevent.
  it('renders a non-finite amount as zero instead of NaN', () => {
    expect(formatCurrency(NaN)).toBe('₹0');
    expect(formatCurrency(Infinity)).toBe('₹0');
    expect(formatCurrency(undefined as unknown as number)).toBe('₹0');
  });
});

describe('MANUAL_LINE_ITEM_DEFAULTS', () => {
  // Mirrors DELIVERY_DATE_OFFSET_DAYS in RFQ_INGESTION_CONFIG on the backend so a
  // keyed RFQ and an ingested one fall back to the same delivery date.
  it('matches the backend delivery-date offset', () => {
    expect(MANUAL_LINE_ITEM_DEFAULTS.TARGET_DATE_OFFSET_DAYS).toBe(5);
  });
});

describe('formatFileSize', () => {
  test.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [2048, '2.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
    // Capped at GB rather than rolling on to TB, which no attachment reaches.
    [1024 * 1024 * 1024 * 5, '5.0 GB'],
  ])('renders %i bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  // A record written before size was captured yields NaN, and "NaN B" in a
  // document list is worse than reporting nothing.
  test.each([NaN, Infinity, -1, undefined as unknown as number])('renders %p as zero bytes', (bytes) => {
    expect(formatFileSize(bytes)).toBe('0 B');
  });
});

// ==============================================================================
// INDIAN DATE AND TIME FORMATTING
// ==============================================================================
// RFQ timestamps are stored in UTC, which is right for storage and wrong for
// display: everyone reading them is in India, so a raised-at of
// "2026-09-04T09:25:21.000Z" reads five and a half hours earlier than the moment
// the buyer actually pressed save.
// ==============================================================================

describe('DISPLAY_TIMEZONE', () => {
  it('presents timestamps in India', () => {
    expect(DISPLAY_TIMEZONE).toBe('Asia/Kolkata');
  });
});

describe('formatIndianDateTime', () => {
  // 09:25 UTC is 14:55 IST, so the shift is what proves the timezone applied.
  it('shifts a UTC instant into IST and names the zone', () => {
    expect(formatIndianDateTime('2026-09-04T09:25:21.000Z')).toBe('04 Sept 2026, 02:55 pm IST');
  });

  // MySQL hands a DATETIME back with no zone designator. It stores UTC, so it has
  // to be read as UTC — parsed as local time it would shift by the viewer's offset.
  it('reads a bare MySQL DATETIME as UTC', () => {
    expect(formatIndianDateTime('2026-09-02 11:07:16')).toBe('02 Sept 2026, 04:37 pm IST');
  });

  it('accepts a MySQL DATETIME without seconds', () => {
    expect(formatIndianDateTime('2026-09-02 11:07')).toBe('02 Sept 2026, 04:37 pm IST');
  });

  it('crosses midnight forward when the UTC time is late enough', () => {
    // 20:00 UTC on the 4th is 01:30 IST on the 5th.
    expect(formatIndianDateTime('2026-09-04T20:00:00.000Z')).toBe('05 Sept 2026, 01:30 am IST');
  });

  it.each([[''], ['   '], [undefined]])('reports nothing for %p', (value) => {
    expect(formatIndianDateTime(value)).toBe('');
  });

  // A legacy record should still show whatever it holds rather than "Invalid Date".
  it('returns an unparseable value unchanged', () => {
    expect(formatIndianDateTime('not a date')).toBe('not a date');
  });
});

describe('formatIndianDate', () => {
  // A date-only value must not slip to the previous day for a viewer behind UTC.
  it('formats a plain date without shifting the day', () => {
    expect(formatIndianDate('2026-09-15')).toBe('15 Sept 2026');
  });

  it('formats the date part of a full instant', () => {
    expect(formatIndianDate('2026-09-02T11:07:16.000Z')).toBe('02 Sept 2026');
  });

  it.each([[''], ['  '], [undefined]])('reports nothing for %p', (value) => {
    expect(formatIndianDate(value)).toBe('');
  });

  it('returns an unparseable value unchanged', () => {
    expect(formatIndianDate('nope')).toBe('nope');
  });
});

describe('RFQ_STATUSES', () => {
  // The edit dialog builds its status dropdown from this list, so it has to match
  // the RFQItem['status'] union exactly or the dialog offers a status the type
  // does not allow.
  it('lists every RFQ state in pipeline order', () => {
    expect(RFQ_STATUSES).toEqual([
      'Parsing',
      'Quotes Pending',
      'In Evaluation',
      'AI Recommended',
      'PO Generated',
    ]);
  });
});

describe('resolveBuyerSourcingMode & BUYER_SUBSCRIPTION_TO_SOURCING_MODE', () => {
  it('maps subscription plan IDs to corresponding sourcing modes', () => {
    expect(BUYER_SUBSCRIPTION_TO_SOURCING_MODE.version_1).toBe('mode_1');
    expect(BUYER_SUBSCRIPTION_TO_SOURCING_MODE.version_2).toBe('mode_2');
    expect(BUYER_SUBSCRIPTION_TO_SOURCING_MODE.version_3).toBe('mode_3');
  });

  it('resolves version_1 plan to mode_1', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_1' })).toBe('mode_1');
    expect(resolveBuyerSourcingMode('version_1')).toBe('mode_1');
    expect(resolveBuyerSourcingMode('v1')).toBe('mode_1');
    expect(resolveBuyerSourcingMode('mode_1')).toBe('mode_1');
  });

  it('resolves version_2 plan to mode_2', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_2' })).toBe('mode_2');
    expect(resolveBuyerSourcingMode('version_2')).toBe('mode_2');
    expect(resolveBuyerSourcingMode('v2')).toBe('mode_2');
    expect(resolveBuyerSourcingMode('mode_2')).toBe('mode_2');
  });

  it('resolves version_3 plan to mode_3', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_3' })).toBe('mode_3');
    expect(resolveBuyerSourcingMode('version_3')).toBe('mode_3');
    expect(resolveBuyerSourcingMode('v3')).toBe('mode_3');
    expect(resolveBuyerSourcingMode('mode_3')).toBe('mode_3');
  });

  it('defaults to mode_2 for free_trial, unknown plan, empty object or null', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'free_trial' })).toBe('mode_2');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'starter_plan' })).toBe('mode_2');
    expect(resolveBuyerSourcingMode({})).toBe('mode_2');
    expect(resolveBuyerSourcingMode(null)).toBe('mode_2');
    expect(resolveBuyerSourcingMode(undefined)).toBe('mode_2');
  });
});

describe('entitledSourcingModes', () => {
  it('mirrors the backend SUBSCRIPTION_MODE_ENTITLEMENTS tiers exactly', () => {
    expect(entitledSourcingModes('free_trial')).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
    expect(entitledSourcingModes('version_1')).toEqual(['mode_0', 'mode_1']);
    expect(entitledSourcingModes('version_2')).toEqual(['mode_0', 'mode_1', 'mode_2']);
    expect(entitledSourcingModes('version_3')).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
  });

  it('falls back to the most restrictive tier for an unrecognised plan string, not to allowing everything', () => {
    expect(entitledSourcingModes('some_unknown_plan')).toEqual(['mode_0', 'mode_1']);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(entitledSourcingModes(' Version_2 ')).toEqual(['mode_0', 'mode_1', 'mode_2']);
  });

  it('defaults to the most restrictive tier when the plan is unresolved (null/undefined), not to allowing everything', () => {
    expect(entitledSourcingModes(null)).toEqual(['mode_0', 'mode_1']);
    expect(entitledSourcingModes(undefined)).toEqual(['mode_0', 'mode_1']);
  });
});

describe('normalizePoDate', () => {
  it('returns empty string for null, undefined, or empty values', () => {
    expect(normalizePoDate(null)).toBe('');
    expect(normalizePoDate(undefined)).toBe('');
    expect(normalizePoDate('')).toBe('');
    expect(normalizePoDate('   ')).toBe('');
  });

  it('handles Date instances correctly', () => {
    expect(normalizePoDate(new Date('2025-12-04T00:00:00Z'))).toBe('2025-12-04');
    expect(normalizePoDate(new Date('invalid'))).toBe('');
  });

  it('converts Excel date serial numbers and decimal strings to ISO dates', () => {
    expect(normalizePoDate(45995)).toBe('2025-12-04');
    expect(normalizePoDate(45995.00011574074)).toBe('2025-12-04');
    expect(normalizePoDate('45995.00011574074')).toBe('2025-12-04');
    expect(normalizePoDate('45995')).toBe('2025-12-04');
    expect(normalizePoDate(25569)).toBe('1970-01-01');
    expect(normalizePoDate(0)).toBe('');
  });

  it('preserves and normalizes ISO format dates', () => {
    expect(normalizePoDate('2025-12-04')).toBe('2025-12-04');
    expect(normalizePoDate('2025/12/04')).toBe('2025-12-04');
    expect(normalizePoDate('2025.12.04')).toBe('2025-12-04');
  });

  it('normalizes DD-MM-YYYY and DD/MM/YYYY dates', () => {
    expect(normalizePoDate('12-04-2025')).toBe('2025-04-12');
    expect(normalizePoDate('25-12-2025')).toBe('2025-12-25');
    expect(normalizePoDate('05/12/2025')).toBe('2025-12-05');
    expect(normalizePoDate('12/25/2025')).toBe('2025-12-25');
  });

  it('handles generic date strings via Date.parse', () => {
    expect(normalizePoDate('Dec 4, 2025')).toBe('2025-12-04');
  });

  it('falls back to raw string when not parseable', () => {
    expect(normalizePoDate('not-a-valid-date')).toBe('not-a-valid-date');
  });
});
