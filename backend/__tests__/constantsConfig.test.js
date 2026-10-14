// Covers the env-driven parts of config/constants.js: the ZOHO_CONFIG proxy
// (read on every access so Worker secrets copied into process.env per request
// are seen), sandbox/live credential selection, chaser delay overrides, and the
// out-of-range paths of normalizePoDate.

const ZOHO_ENV = [
  'ZOHO_MODE',
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
  'ZOHO_OAUTH_TOKEN_URL',
  'ZOHO_PAYMENTS_ACCOUNT_ID',
  'ZOHO_WEBHOOK_SIGNING_KEY',
  'ZOHO_PAYMENTS_RETURN_URL_BASE',
  'ZOHO_LIVE_CLIENT_ID',
  'ZOHO_LIVE_CLIENT_SECRET',
  'ZOHO_LIVE_REFRESH_TOKEN',
  'ZOHO_LIVE_OAUTH_TOKEN_URL',
  'ZOHO_LIVE_PAYMENTS_BASE_URL',
  'ZOHO_LIVE_PAYMENTS_ACCOUNT_ID',
  'ZOHO_LIVE_WEBHOOK_SIGNING_KEY',
  'ZOHO_LIVE_RETURN_URL_BASE',
  'ZOHO_SANDBOX_CLIENT_ID',
  'ZOHO_SANDBOX_CLIENT_SECRET',
  'ZOHO_SANDBOX_REFRESH_TOKEN',
  'ZOHO_SANDBOX_OAUTH_TOKEN_URL',
  'ZOHO_SANDBOX_PAYMENTS_BASE_URL',
  'ZOHO_SANDBOX_PAYMENTS_ACCOUNT_ID',
  'ZOHO_SANDBOX_WEBHOOK_SIGNING_KEY',
  'ZOHO_SANDBOX_RETURN_URL_BASE',
  'ZOHO_RECONCILIATION_ENABLED',
  'ZOHO_RECONCILIATION_INTERVAL_MS',
];
const CHASER_ENV = ['CHASER_SMS_DELAY_MS', 'CHASER_CALL_DELAY_MS', 'CHASER_WHATSAPP_DELAY_MS', 'CHASER_EMAIL_DELAY_MS'];

const saved = {};
beforeEach(() => {
  for (const key of [...ZOHO_ENV, ...CHASER_ENV]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of [...ZOHO_ENV, ...CHASER_ENV]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function loadConstants() {
  let constants;
  jest.isolateModules(() => {
    constants = require('../src/config/constants');
  });
  return constants;
}

describe('ZOHO_CONFIG', () => {
  test('defaults to live mode with built-in URLs when nothing is set', () => {
    const { ZOHO_CONFIG } = loadConstants();
    expect(ZOHO_CONFIG.MODE).toBe('live');
    expect(ZOHO_CONFIG.CLIENT_ID).toBe('');
    expect(ZOHO_CONFIG.CLIENT_SECRET).toBe('');
    expect(ZOHO_CONFIG.REFRESH_TOKEN).toBe('');
    expect(ZOHO_CONFIG.OAUTH_TOKEN_URL).toBe('https://accounts.zoho.in/oauth/v2/token');
    expect(ZOHO_CONFIG.PAYMENTS_BASE_URL).toBe('https://payments.zoho.in/api/v1');
    expect(ZOHO_CONFIG.ACCOUNT_ID).toBe('');
    expect(ZOHO_CONFIG.WEBHOOK_SIGNING_KEY).toBe('');
    expect(ZOHO_CONFIG.RETURN_URL_BASE).toBe('http://localhost:3000');
    expect(ZOHO_CONFIG.RECONCILIATION_ENABLED).toBe(false);
    expect(ZOHO_CONFIG.RECONCILIATION_INTERVAL_MS).toBe(10 * 60 * 1000);
  });

  test('live mode prefers ZOHO_LIVE_* over the shared ZOHO_* names', () => {
    Object.assign(process.env, {
      ZOHO_CLIENT_ID: 'shared-id',
      ZOHO_LIVE_CLIENT_ID: 'live-id',
      ZOHO_LIVE_CLIENT_SECRET: 'live-secret',
      ZOHO_LIVE_REFRESH_TOKEN: 'live-refresh',
      ZOHO_LIVE_OAUTH_TOKEN_URL: 'https://live/token',
      ZOHO_LIVE_PAYMENTS_BASE_URL: 'https://live/api',
      ZOHO_LIVE_PAYMENTS_ACCOUNT_ID: 'live-acct',
      ZOHO_LIVE_WEBHOOK_SIGNING_KEY: 'live-key',
      ZOHO_LIVE_RETURN_URL_BASE: 'https://live.app',
      ZOHO_RECONCILIATION_ENABLED: 'TRUE',
      ZOHO_RECONCILIATION_INTERVAL_MS: '5000',
    });
    const { ZOHO_CONFIG } = loadConstants();
    expect(ZOHO_CONFIG).toMatchObject({
      MODE: 'live',
      CLIENT_ID: 'live-id',
      CLIENT_SECRET: 'live-secret',
      REFRESH_TOKEN: 'live-refresh',
      OAUTH_TOKEN_URL: 'https://live/token',
      PAYMENTS_BASE_URL: 'https://live/api',
      ACCOUNT_ID: 'live-acct',
      WEBHOOK_SIGNING_KEY: 'live-key',
      RETURN_URL_BASE: 'https://live.app',
      RECONCILIATION_ENABLED: true,
      RECONCILIATION_INTERVAL_MS: 5000,
    });
  });

  test('live mode falls back to the shared ZOHO_* names', () => {
    Object.assign(process.env, {
      ZOHO_CLIENT_ID: 'shared-id',
      ZOHO_CLIENT_SECRET: 'shared-secret',
      ZOHO_REFRESH_TOKEN: 'shared-refresh',
      ZOHO_OAUTH_TOKEN_URL: 'https://shared/token',
      ZOHO_PAYMENTS_ACCOUNT_ID: 'shared-acct',
      ZOHO_WEBHOOK_SIGNING_KEY: 'shared-key',
      ZOHO_PAYMENTS_RETURN_URL_BASE: 'https://shared.app',
    });
    const { ZOHO_CONFIG } = loadConstants();
    expect(ZOHO_CONFIG).toMatchObject({
      CLIENT_ID: 'shared-id',
      CLIENT_SECRET: 'shared-secret',
      REFRESH_TOKEN: 'shared-refresh',
      OAUTH_TOKEN_URL: 'https://shared/token',
      ACCOUNT_ID: 'shared-acct',
      WEBHOOK_SIGNING_KEY: 'shared-key',
      RETURN_URL_BASE: 'https://shared.app',
    });
  });

  test('sandbox mode uses the sandbox host and ZOHO_SANDBOX_* credentials', () => {
    Object.assign(process.env, {
      ZOHO_MODE: 'Sandbox',
      ZOHO_SANDBOX_CLIENT_ID: 'sb-id',
      ZOHO_SANDBOX_CLIENT_SECRET: 'sb-secret',
      ZOHO_SANDBOX_REFRESH_TOKEN: 'sb-refresh',
      ZOHO_SANDBOX_OAUTH_TOKEN_URL: 'https://sb/token',
      ZOHO_SANDBOX_PAYMENTS_BASE_URL: 'https://sb/api',
      ZOHO_SANDBOX_PAYMENTS_ACCOUNT_ID: 'sb-acct',
      ZOHO_SANDBOX_WEBHOOK_SIGNING_KEY: 'sb-key',
      ZOHO_SANDBOX_RETURN_URL_BASE: 'https://sb.app',
    });
    const { ZOHO_CONFIG } = loadConstants();
    expect(ZOHO_CONFIG).toMatchObject({
      MODE: 'sandbox',
      CLIENT_ID: 'sb-id',
      CLIENT_SECRET: 'sb-secret',
      REFRESH_TOKEN: 'sb-refresh',
      OAUTH_TOKEN_URL: 'https://sb/token',
      PAYMENTS_BASE_URL: 'https://sb/api',
      ACCOUNT_ID: 'sb-acct',
      WEBHOOK_SIGNING_KEY: 'sb-key',
      RETURN_URL_BASE: 'https://sb.app',
    });
  });

  test('sandbox mode falls back to shared names and built-in defaults', () => {
    Object.assign(process.env, {
      ZOHO_MODE: 'sandbox',
      ZOHO_CLIENT_ID: 'shared-id',
      ZOHO_CLIENT_SECRET: 'shared-secret',
      ZOHO_PAYMENTS_ACCOUNT_ID: 'shared-acct',
      ZOHO_PAYMENTS_RETURN_URL_BASE: 'https://shared.app',
    });
    let { ZOHO_CONFIG } = loadConstants();
    expect(ZOHO_CONFIG).toMatchObject({
      CLIENT_ID: 'shared-id',
      CLIENT_SECRET: 'shared-secret',
      REFRESH_TOKEN: '',
      OAUTH_TOKEN_URL: 'https://accounts.zoho.in/oauth/v2/token',
      PAYMENTS_BASE_URL: 'https://paymentssandbox.zoho.in/api/v1',
      ACCOUNT_ID: 'shared-acct',
      WEBHOOK_SIGNING_KEY: '',
      RETURN_URL_BASE: 'https://shared.app',
    });

    for (const key of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_PAYMENTS_ACCOUNT_ID', 'ZOHO_PAYMENTS_RETURN_URL_BASE']) {
      delete process.env[key];
    }
    ({ ZOHO_CONFIG } = loadConstants());
    expect(ZOHO_CONFIG).toMatchObject({ CLIENT_ID: '', CLIENT_SECRET: '', ACCOUNT_ID: '', RETURN_URL_BASE: 'http://localhost:3000' });
  });

  test('reads the environment on every access, not once at load', () => {
    const { ZOHO_CONFIG } = loadConstants();
    expect(ZOHO_CONFIG.CLIENT_ID).toBe('');
    process.env.ZOHO_LIVE_CLIENT_ID = 'set-later';
    expect(ZOHO_CONFIG.CLIENT_ID).toBe('set-later');
  });

  test('assigned values override the environment until deleted', () => {
    process.env.ZOHO_LIVE_CLIENT_ID = 'from-env';
    const { ZOHO_CONFIG } = loadConstants();

    ZOHO_CONFIG.CLIENT_ID = 'override';
    ZOHO_CONFIG.EXTRA_FLAG = 'only-override';
    expect(ZOHO_CONFIG.CLIENT_ID).toBe('override');
    expect('CLIENT_ID' in ZOHO_CONFIG).toBe(true);
    expect('EXTRA_FLAG' in ZOHO_CONFIG).toBe(true);
    expect('NOT_A_KEY' in ZOHO_CONFIG).toBe(false);

    const keys = Object.keys(ZOHO_CONFIG);
    expect(keys).toEqual(expect.arrayContaining(['MODE', 'CLIENT_ID', 'GST_RATE', 'EXTRA_FLAG']));
    expect(keys.filter((k) => k === 'CLIENT_ID')).toHaveLength(1);

    expect(Object.getOwnPropertyDescriptor(ZOHO_CONFIG, 'CLIENT_ID')).toEqual({
      enumerable: true,
      configurable: true,
      writable: true,
      value: 'override',
    });
    expect(Object.getOwnPropertyDescriptor(ZOHO_CONFIG, 'GST_RATE').value).toBe(0.18);
    expect(Object.getOwnPropertyDescriptor(ZOHO_CONFIG, 'NOT_A_KEY')).toBeUndefined();
    expect({ ...ZOHO_CONFIG }).toMatchObject({ CLIENT_ID: 'override', EXTRA_FLAG: 'only-override' });

    delete ZOHO_CONFIG.CLIENT_ID;
    delete ZOHO_CONFIG.EXTRA_FLAG;
    expect(ZOHO_CONFIG.CLIENT_ID).toBe('from-env');
    expect('EXTRA_FLAG' in ZOHO_CONFIG).toBe(false);
  });

  test('plan amounts add GST and return null for unpayable plans', () => {
    const { computeZohoPlanAmount, computeZohoBuyerPlanAmount } = loadConstants();
    expect(computeZohoPlanAmount('connect')).toBe(7498.99);
    expect(computeZohoBuyerPlanAmount('version_1')).toBe(70785.84);
    expect(computeZohoBuyerPlanAmount('version_1', '12_months')).toBe(70785.84);
    expect(computeZohoBuyerPlanAmount('version_1', '6_months')).toBe(38932.92);
    expect(computeZohoBuyerPlanAmount('version_2', '12_months')).toBe(106185.84);
    expect(computeZohoBuyerPlanAmount('version_2', '6_months')).toBe(56632.92);
    expect(computeZohoBuyerPlanAmount('version_3', '12_months')).toBe(141585.84);
    expect(computeZohoBuyerPlanAmount('version_3', '6_months')).toBe(74332.92);
    expect(computeZohoBuyerPlanAmount('free_trial')).toBeNull();
  });
});

describe('CHASER_DELAYS', () => {
  test('uses the defaults when nothing is set', () => {
    const { CHASER_DELAYS } = loadConstants();
    expect(CHASER_DELAYS).toMatchObject({
      SMS_MS: 5 * 60 * 1000,
      CALL_MS: 6 * 60 * 60 * 1000,
      WHATSAPP_MS: 12 * 60 * 60 * 1000,
      EMAIL_MS: 24 * 60 * 60 * 1000,
    });
  });

  test('accepts valid overrides, including zero', () => {
    Object.assign(process.env, {
      CHASER_SMS_DELAY_MS: '1000',
      CHASER_CALL_DELAY_MS: '0',
      CHASER_WHATSAPP_DELAY_MS: '3000',
      CHASER_EMAIL_DELAY_MS: '4000',
    });
    const { CHASER_DELAYS } = loadConstants();
    expect(CHASER_DELAYS).toMatchObject({ SMS_MS: 1000, CALL_MS: 0, WHATSAPP_MS: 3000, EMAIL_MS: 4000 });
  });

  test('ignores empty, negative and non-numeric overrides', () => {
    Object.assign(process.env, {
      CHASER_SMS_DELAY_MS: '',
      CHASER_CALL_DELAY_MS: '-5',
      CHASER_WHATSAPP_DELAY_MS: 'soon',
    });
    const { CHASER_DELAYS } = loadConstants();
    expect(CHASER_DELAYS).toMatchObject({
      SMS_MS: 5 * 60 * 1000,
      CALL_MS: 6 * 60 * 60 * 1000,
      WHATSAPP_MS: 12 * 60 * 60 * 1000,
    });
  });
});

describe('normalizePoDate edge cases', () => {
  const { normalizePoDate } = require('../src/config/constants');

  test('returns empty for blank and zero values', () => {
    for (const value of [null, undefined, '', 0, '0', '   ']) {
      expect(normalizePoDate(value)).toBe('');
    }
  });

  test('handles Date instances, including invalid ones', () => {
    expect(normalizePoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(normalizePoDate(new Date('not a date'))).toBe('');
  });

  test('converts Excel serials and rejects out-of-range numbers', () => {
    expect(normalizePoDate(45995)).toBe('2025-12-04');
    expect(normalizePoDate('45995.00011574074')).toBe('2025-12-04');
    expect(normalizePoDate(200000)).toBe('');
    expect(normalizePoDate(-3)).toBe('');
    expect(normalizePoDate('200000')).toBe('');
  });

  test('parses the supported string formats', () => {
    expect(normalizePoDate('2026-03-09')).toBe('2026-03-09');
    expect(normalizePoDate('2026/3/9')).toBe('2026-03-09');
    expect(normalizePoDate('25-12-2026')).toBe('2026-12-25');
    expect(normalizePoDate('12/25/2026')).toBe('2026-12-25');
    expect(normalizePoDate('05/06/2026')).toBe('2026-06-05');
    expect(normalizePoDate('March 9, 2026')).toBe('2026-03-09');
    expect(normalizePoDate('next tuesday')).toBe('next tuesday');
  });
});

describe('resolveBuyerSourcingMode', () => {
  const { resolveBuyerSourcingMode } = require('../src/config/constants');

  test('maps plan names from a string or a buyer account', () => {
    expect(resolveBuyerSourcingMode(' Version_3 ')).toBe('mode_3');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'v1' })).toBe('mode_1');
    expect(resolveBuyerSourcingMode('mode_0')).toBe('mode_0');
  });

  test('falls back to the ingested mode for unknown or missing plans', () => {
    for (const value of ['free_trial', null, undefined, {}, { subscriptionPlan: 7 }, 42]) {
      expect(resolveBuyerSourcingMode(value)).toBe('mode_2');
    }
  });

  test('prioritizes active subscription over remaining free RFQ credits', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_1', remainingFreeRFQs: 0 })).toBe('mode_1');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_2', remainingFreeRFQs: 0 })).toBe('mode_2');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'version_3', remainingFreeRFQs: 0 })).toBe('mode_3');
  });

  test('for buyers without a subscription, assigns mode_2 for free credits and switches to mode_0 when exhausted', () => {
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 5 })).toBe('mode_2');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 1 })).toBe('mode_2');
    expect(resolveBuyerSourcingMode({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 })).toBe('mode_0');
    expect(resolveBuyerSourcingMode({ remainingFreeRFQs: 0 })).toBe('mode_0');
  });
});

describe('formatMessage', () => {
  const { formatMessage } = require('../src/config/constants');

  test('fills placeholders and leaves unknown ones in place', () => {
    expect(formatMessage('Hi {name}, RFQ {rfq} {missing} {nil}', { name: 'Asha', rfq: 12, nil: null })).toBe(
      'Hi Asha, RFQ 12 {missing} {nil}'
    );
  });

  test('handles an empty template or no values', () => {
    expect(formatMessage('', { a: 1 })).toBe('');
    expect(formatMessage(null)).toBe('');
    expect(formatMessage('Plain {x}')).toBe('Plain {x}');
  });
});
