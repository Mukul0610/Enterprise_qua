// ==============================================================================
// OUTBOUND DELIVERY ROUTING
// ==============================================================================
// Reproduces the live failure that motivated the routing chain: the buyer Gmail
// mailbox hit its sending limit ("User-rate limit exceeded"), the only
// fallbacks were SMTP (cannot run on Workers) and keyless MailChannels (401),
// so every OTP email failed. These tests pin that a send now walks every usable
// mailbox/provider, skips ones known to be cooling down, and fails loudly only
// when nothing can deliver.
// ==============================================================================

const ROUTING_ENV = [
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'GMAIL_SENDER_EMAIL',
  'OTP_GMAIL_REFRESH_TOKEN',
  'OTP_GMAIL_SENDER_EMAIL',
  'VENDOR_GMAIL_REFRESH_TOKEN',
  'VENDOR_GMAIL_SENDER_EMAIL',
  'VENDOR_EMAIL_GATEWAY_ADDRESS',
  'QUOTE_ALERT_GMAIL_REFRESH_TOKEN',
  'QUOTE_ALERT_GMAIL_SENDER_EMAIL',
  'GMAIL_POOL_REFRESH_TOKENS',
  'GMAIL_POOL_SENDER_EMAILS',
  'RESEND_API_KEY',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'VENDOR_SMTP_USER',
  'VENDOR_SMTP_PASSWORD',
];

/**
 * Load a fresh mailer whose Gmail API double decides each send by the refresh
 * token it was authorised with: `behaviour[token]` is a function returning a
 * result or throwing.
 */
function loadMailer(env, behaviour = {}, { smtpSend } = {}) {
  let mailer;
  const sends = [];
  jest.isolateModules(() => {
    ROUTING_ENV.forEach((key) => delete process.env[key]);
    Object.assign(process.env, { NODE_ENV: 'development', GMAIL_CLIENT_ID: 'cid', GMAIL_CLIENT_SECRET: 'secret', ...env });
    jest.doMock('googleapis', () => ({
      google: {
        auth: {
          OAuth2: jest.fn().mockImplementation(() => {
            const client = {};
            client.setCredentials = jest.fn((creds) => {
              client.token = creds.refresh_token;
            });
            return client;
          }),
        },
        gmail: jest.fn(({ auth }) => ({
          users: {
            messages: {
              send: jest.fn(async ({ requestBody }) => {
                const decoded = Buffer.from(requestBody.raw, 'base64url').toString('utf8');
                sends.push({ token: auth.token, raw: decoded });
                const handler = behaviour[auth.token];
                if (handler) return handler();
                return { data: { id: `id-${auth.token}` } };
              }),
            },
          },
        })),
      },
    }));
    if (smtpSend) {
      jest.doMock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: smtpSend })) }));
    }
    mailer = require('../src/services/mailerService');
  });
  return { mailer, sends };
}

function rateLimited() {
  throw new Error(`User-rate limit exceeded.  Retry after ${new Date(Date.now() + 15 * 60 * 1000).toISOString()} (Mail sending)`);
}

describe('mailerService delivery routing', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    ROUTING_ENV.forEach((key) => delete process.env[key]);
    delete globalThis.__CF_ENV__;
    global.fetch = originalFetch;
    process.env.NODE_ENV = 'test';
    jest.dontMock('googleapis');
    jest.dontMock('nodemailer');
  });

  test('a rate-limited buyer mailbox falls through to a pooled mailbox and is skipped on later sends', async () => {
    const { mailer, sends } = loadMailer(
      { GMAIL_REFRESH_TOKEN: 'buyer', GMAIL_POOL_REFRESH_TOKENS: 'pool-a, pool-b', GMAIL_POOL_SENDER_EMAILS: 'a@procucev.com' },
      { buyer: rateLimited }
    );

    const first = await mailer.sendRfqAcknowledgementEmail({ to: 'buyer@example.com', rfqNumber: 'RFQ1', rfqTitle: 'T' });
    expect(first).toEqual({ sent: true, messageId: 'id-pool-a' });
    expect(sends.map((s) => s.token)).toEqual(['buyer', 'pool-a']);
    expect(sends[1].raw).toContain('From: "Procucev Enterprise" <a@procucev.com>');

    // The buyer mailbox is now cooling down: the next send goes straight to the pool.
    await mailer.sendRfqAcknowledgementEmail({ to: 'buyer@example.com', rfqNumber: 'RFQ2', rfqTitle: 'T' });
    expect(sends.map((s) => s.token)).toEqual(['buyer', 'pool-a', 'pool-a']);

    const health = mailer.getDeliveryHealth();
    expect(health.runtime).toBe('node');
    expect(health.gmailIdentities.map((i) => i.id)).toEqual(['buyer', 'pool1', 'pool2']);
    expect(health.gmailIdentities[0].cooldown.reason).toContain('rate limited');
    expect(health.gmailIdentities[1].cooldown).toBeNull();
    expect(JSON.stringify(health)).not.toContain('pool-a');
  });

  test('OTP mail prefers the dedicated OTP mailbox and may borrow any other mailbox before failing', async () => {
    const { mailer, sends } = loadMailer(
      {
        OTP_GMAIL_REFRESH_TOKEN: 'otp',
        OTP_GMAIL_SENDER_EMAIL: 'otp@procucev.com',
        GMAIL_REFRESH_TOKEN: 'buyer',
        VENDOR_GMAIL_REFRESH_TOKEN: 'vendor',
        QUOTE_ALERT_GMAIL_REFRESH_TOKEN: 'quote',
      },
      { otp: rateLimited, buyer: () => { throw new Error('invalid_grant'); } }
    );

    const res = await mailer.sendOtpEmail('user@example.com', '123456', 600);
    expect(res).toEqual({ sent: true, messageId: 'id-vendor' });
    expect(sends.map((s) => s.token)).toEqual(['otp', 'buyer', 'vendor']);
    expect(sends[0].raw).toContain('From: "Procucev Enterprise" <otp@procucev.com>');
    // Spam-safe: a security code with no remote images, links or forged Message-ID.
    expect(sends[0].raw).toContain('123456');
    expect(sends[0].raw).not.toMatch(/<img|href=|workers\.dev|Message-ID:/i);
  });

  test('ordinary buyer mail never borrows the vendor mailbox', async () => {
    const { mailer, sends } = loadMailer(
      { GMAIL_REFRESH_TOKEN: 'buyer', VENDOR_GMAIL_REFRESH_TOKEN: 'vendor' },
      { buyer: rateLimited }
    );
    await expect(mailer.sendRfqAcknowledgementEmail({ to: 'b@example.com', rfqNumber: 'R', rfqTitle: 'T' })).rejects.toThrow(
      'User-rate limit exceeded'
    );
    expect(sends.map((s) => s.token)).toEqual(['buyer']);
  });

  test('buyer mail borrows the quote-alert mailbox when the buyer mailbox is throttled, replying to the buyer mailbox', async () => {
    const { mailer, sends } = loadMailer(
      {
        GMAIL_REFRESH_TOKEN: 'buyer',
        GMAIL_SENDER_EMAIL: 'buyer@procucev.com',
        VENDOR_GMAIL_REFRESH_TOKEN: 'vendor',
        QUOTE_ALERT_GMAIL_REFRESH_TOKEN: 'quote',
        QUOTE_ALERT_GMAIL_SENDER_EMAIL: 'alerts@procucev.com',
      },
      { buyer: rateLimited }
    );
    const res = await mailer.sendRfqAcknowledgementEmail({ to: 'b@example.com', rfqNumber: 'R', rfqTitle: 'T' });
    expect(res).toEqual({ sent: true, messageId: 'id-quote' });
    expect(sends.map((s) => s.token)).toEqual(['buyer', 'quote']);
    expect(sends[1].raw).toContain('From: "Procucev Enterprise" <alerts@procucev.com>');
    // The acknowledgement's own Reply-To (the RFQ intake address) is kept.
    expect(sends[1].raw).toMatch(/Reply-To: RFQ@procucev\.com/i);
  });

  test('a borrowed send with no reply-to of its own replies to the buyer mailbox', async () => {
    const withSender = loadMailer(
      { GMAIL_REFRESH_TOKEN: 'buyer', GMAIL_SENDER_EMAIL: 'buyer@procucev.com', QUOTE_ALERT_GMAIL_REFRESH_TOKEN: 'quote' },
      { buyer: rateLimited }
    );
    await withSender.mailer.sendRfqNotCreatedEmail({ to: 'b@example.com', reason: 'NO_LINE_ITEMS' });
    expect(withSender.sends.map((s) => s.token)).toEqual(['buyer', 'quote']);
    expect(withSender.sends[1].raw).toMatch(/Reply-To: buyer@procucev\.com/i);

    const withoutSender = loadMailer({ GMAIL_REFRESH_TOKEN: 'buyer', QUOTE_ALERT_GMAIL_REFRESH_TOKEN: 'quote' }, { buyer: rateLimited });
    await withoutSender.mailer.sendRfqNotCreatedEmail({ to: 'b@example.com', reason: 'NO_LINE_ITEMS' });
    expect(withoutSender.sends[1].raw).toMatch(/Reply-To: .*manav\.procucev@gmail\.com/i);
  });

  test('vendor mail sent from a borrowed mailbox keeps CC and replies to the vendor gateway', async () => {
    const { mailer, sends } = loadMailer(
      { GMAIL_REFRESH_TOKEN: 'buyer', VENDOR_GMAIL_REFRESH_TOKEN: 'vendor', VENDOR_EMAIL_GATEWAY_ADDRESS: 'quotes@procucev.com' },
      { vendor: rateLimited }
    );
    const res = await mailer.sendQuoteFailureEmail('vendor@example.com', {
      rfqNumber: 'RFQ9',
      vendorName: 'V',
      reason: 'Missing price',
      cc: 'buyer@example.com, support@procucev.com',
    });
    expect(res).toEqual({ sent: true, messageId: 'id-buyer' });
    const raw = sends[1].raw;
    expect(raw).toContain('Cc: buyer@example.com, support@procucev.com');
    expect(raw).toContain('Reply-To: quotes@procucev.com');
    expect(raw).toContain('Auto-Submitted: auto-replied');
    expect(raw).toContain('X-Auto-Response-Suppress: All');
  });

  test('a vendor message without its own Reply-To is pointed at the vendor gateway', async () => {
    const { mailer, sends } = loadMailer({ VENDOR_GMAIL_REFRESH_TOKEN: 'vendor', VENDOR_EMAIL_GATEWAY_ADDRESS: 'quotes@procucev.com' });
    await mailer.deliverVendor({ to: 'v@example.com', subject: 'Hello', html: '<p>x</p>' }, 'test vendor mail');
    expect(sends[0].raw).toContain('Reply-To: quotes@procucev.com');
  });

  test('quote-received alerts use the quote-alert mailbox, falling back to the buyer mailbox', async () => {
    const { mailer, sends } = loadMailer(
      { GMAIL_REFRESH_TOKEN: 'buyer', QUOTE_ALERT_GMAIL_REFRESH_TOKEN: 'quote', QUOTE_ALERT_GMAIL_SENDER_EMAIL: 'alerts@procucev.com' },
      { quote: rateLimited }
    );
    const res = await mailer.sendQuoteReceivedEmail('buyer@example.com', { rfq: { rfqNumber: 'RFQ1' }, quote: { vendorName: 'V' } });
    expect(res).toEqual({ sent: true, messageId: 'id-buyer' });
    expect(sends.map((s) => s.token)).toEqual(['quote', 'buyer']);
    expect(mailer.isQuoteAlertGmailApiConfigured()).toBe(true);
  });

  test('a transient network failure is retried once on the same provider', async () => {
    let calls = 0;
    const { mailer, sends } = loadMailer(
      { GMAIL_REFRESH_TOKEN: 'buyer' },
      {
        buyer: () => {
          calls += 1;
          if (calls === 1) throw new Error('socket hang up');
          return { data: { id: 'retried' } };
        },
      }
    );
    await expect(mailer.sendRfqAcknowledgementEmail({ to: 'b@example.com', rfqNumber: 'R', rfqTitle: 'T' })).resolves.toEqual({
      sent: true,
      messageId: 'retried',
    });
    expect(sends).toHaveLength(2);
  });

  test('falls back to an HTTP provider when every Gmail identity fails', async () => {
    const { mailer } = loadMailer({ GMAIL_REFRESH_TOKEN: 'buyer', RESEND_API_KEY: 'rk' }, { buyer: rateLimited });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'resend-ok' }) });
    await expect(mailer.sendOtpEmail('u@example.com', '111111', 600)).resolves.toEqual({ sent: true, messageId: 'resend-ok' });
    expect(mailer.isConfigured()).toBe(true);
  });

  test('on Workers, raw SMTP is never attempted and an all-failed send throws with every attempt listed', async () => {
    const smtpSend = jest.fn();
    const { mailer } = loadMailer(
      { GMAIL_REFRESH_TOKEN: 'buyer', SMTP_USER: 's@procucev.com', SMTP_PASSWORD: 'pw', VENDOR_SMTP_USER: 'v@procucev.com', VENDOR_SMTP_PASSWORD: 'pw' },
      { buyer: () => { throw new Error('invalid_grant'); } },
      { smtpSend }
    );
    globalThis.__CF_ENV__ = {};
    const error = await mailer.sendOtpEmail('u@example.com', '111111', 600).catch((err) => err);
    expect(error.message).toBe('invalid_grant');
    expect(error.deliveryAttempts).toEqual([expect.objectContaining({ provider: 'Gmail API (buyer)', kind: 'AUTH_REVOKED' })]);
    expect(smtpSend).not.toHaveBeenCalled();
    expect(mailer.getDeliveryHealth().smtp.usable).toBe(false);

    // Every provider is now cooling down: reported as such instead of re-trying a dead grant.
    const cooling = await mailer.sendOtpEmail('u@example.com', '111111', 600).catch((err) => err);
    expect(cooling.code).toBe('MAIL_PROVIDERS_COOLING_DOWN');
    expect(cooling.deliveryAttempts[0].skipped).toContain('cooling down until');

    // Vendor channel on Workers also skips vendor SMTP.
    await expect(mailer.deliverVendor({ to: 'v@example.com', subject: 's', html: 'h' }, 'vendor mail')).rejects.toMatchObject({
      code: 'MAIL_PROVIDERS_COOLING_DOWN',
    });
    expect(smtpSend).not.toHaveBeenCalled();
  });

  test('off Workers, vendor SMTP runs before borrowing the buyer mailbox and SMTP is the last resort', async () => {
    const smtpSend = jest.fn().mockResolvedValue({ messageId: 'smtp-1' });
    const { mailer, sends } = loadMailer(
      { VENDOR_GMAIL_REFRESH_TOKEN: 'vendor', GMAIL_REFRESH_TOKEN: 'buyer', VENDOR_SMTP_USER: 'v@procucev.com', VENDOR_SMTP_PASSWORD: 'pw' },
      { vendor: rateLimited },
      { smtpSend }
    );
    await expect(mailer.deliverVendor({ to: 'v@example.com', subject: 's', html: 'h' }, 'vendor mail')).resolves.toEqual({
      sent: true,
      messageId: 'smtp-1',
    });
    expect(sends.map((s) => s.token)).toEqual(['vendor']);
  });

  test('reports not configured when there is no provider at all', async () => {
    const { mailer } = loadMailer({ GMAIL_CLIENT_ID: '', GMAIL_CLIENT_SECRET: '' });
    expect(mailer.isConfigured()).toBe(false);
    expect(mailer.getGmailOAuthClient()).toBeUndefined();
    expect(mailer.getVendorGmailOAuthClient()).toBeUndefined();
    await expect(mailer.deliver({ to: 'a@b.com', subject: 's', html: 'h' }, 'x')).resolves.toEqual({
      sent: false,
      reason: 'SMTP not configured',
    });
  });

  test('OAuth clients are cached per identity and rebuilt when the refresh token changes', () => {
    const { mailer } = loadMailer({ GMAIL_REFRESH_TOKEN: 'buyer-1', VENDOR_GMAIL_REFRESH_TOKEN: 'vendor-1' });
    const first = mailer.getGmailOAuthClient();
    expect(mailer.getGmailOAuthClient()).toBe(first);
    expect(mailer.getVendorGmailOAuthClient().token).toBe('vendor-1');
    process.env.GMAIL_REFRESH_TOKEN = 'buyer-2';
    const rotated = mailer.getGmailOAuthClient();
    expect(rotated).not.toBe(first);
    expect(rotated.token).toBe('buyer-2');
  });
});
