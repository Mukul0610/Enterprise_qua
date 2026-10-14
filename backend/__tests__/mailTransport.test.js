const mailTransport = require('../src/services/mailTransport');

const { DELIVERY_ERROR_KIND } = mailTransport;

function decode(raw) {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const PROVIDER_ENV = [
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL',
  'BREVO_API_KEY',
  'BREVO_FROM_EMAIL',
  'MAILCHANNELS_API_KEY',
  'MAILCHANNELS_FROM_EMAIL',
];

describe('mailTransport', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    PROVIDER_ENV.forEach((key) => delete process.env[key]);
    delete globalThis.__CF_ENV__;
    global.fetch = originalFetch;
    mailTransport.resetCooldowns();
    jest.useRealTimers();
  });

  describe('environment helpers', () => {
    test('getEnv reads process.env first, then the Worker env, ignoring empty strings', () => {
      process.env.RESEND_API_KEY = '';
      globalThis.__CF_ENV__ = { RESEND_API_KEY: 'from-worker', OTHER: '' };
      expect(mailTransport.getEnv('RESEND_API_KEY')).toBe('from-worker');
      expect(mailTransport.getEnv('OTHER')).toBeUndefined();
      process.env.RESEND_API_KEY = 'from-process';
      expect(mailTransport.getEnv('RESEND_API_KEY')).toBe('from-process');
      expect(mailTransport.isWorkersRuntime()).toBe(true);
      delete globalThis.__CF_ENV__;
      expect(mailTransport.isWorkersRuntime()).toBe(false);
    });

    test('address list helpers normalise strings, lists and display names', () => {
      expect(mailTransport.splitList(' a@x.com, b@x.com;\nc@x.com ')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
      expect(mailTransport.splitList(undefined)).toEqual([]);
      expect(mailTransport.toAddressList(['a@x.com, b@x.com', 'c@x.com'])).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
      expect(mailTransport.toAddressList(null)).toEqual([]);
      expect(mailTransport.bareAddress('"Procucev" <hello@procucev.com>')).toBe('hello@procucev.com');
      expect(mailTransport.bareAddress('plain@procucev.com')).toBe('plain@procucev.com');
    });

    test('htmlToText keeps line structure and decodes common entities', () => {
      const text = mailTransport.htmlToText('<style>p{}</style><p>Hello&nbsp;<b>A&amp;B</b></p><br/>1 &lt; 2 &gt; 0');
      expect(text).toContain('Hello A&B');
      expect(text).toContain('1 < 2 > 0');
      expect(mailTransport.htmlToText(undefined)).toBe('');
    });
  });

  describe('buildRawMimeMessage', () => {
    test('carries Cc, Bcc, Reply-To, threading and custom headers with text + HTML alternatives', () => {
      const raw = decode(
        mailTransport.buildRawMimeMessage({
          from: '"Procucev Enterprise" <sender@procucev.com>',
          to: 'vendor@example.com',
          cc: 'buyer@example.com, support@procucev.com',
          bcc: ['audit@procucev.com'],
          subject: 'Quotation Received – RFQ 1',
          html: '<p>Your code is <b>4321</b></p>',
          replyTo: 'gateway@procucev.com',
          inReplyTo: '<orig@example.com>',
          references: '<orig@example.com>',
          headers: { 'Auto-Submitted': 'auto-replied' },
        })
      );
      expect(raw).toContain('To: vendor@example.com');
      expect(raw).toContain('Cc: buyer@example.com, support@procucev.com');
      expect(raw).toContain('Bcc: audit@procucev.com');
      expect(raw).toContain('Reply-To: gateway@procucev.com');
      expect(raw).toContain('In-Reply-To: <orig@example.com>');
      expect(raw).toContain('References: <orig@example.com>');
      expect(raw).toContain('Auto-Submitted: auto-replied');
      expect(raw).toContain('multipart/alternative');
      expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
      expect(raw).toContain('Your code is 4321');
      expect(raw).toContain('<b>4321</b>');
      // Gmail assigns the Message-ID; a self-made one reads as forged.
      expect(raw).not.toContain('Message-ID:');
    });

    test('sends a plain-text body when there is no HTML, and tolerates a bare from address', () => {
      const raw = decode(mailTransport.buildRawMimeMessage({ from: 'nodomain', to: 'a@b.com', text: 'plain body' }));
      expect(raw).not.toContain('multipart/alternative');
      expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
      expect(raw).toContain('plain body');
      expect(raw).not.toContain('Cc:');
    });
  });

  describe('classifyDeliveryError / parseRetryAfterMs', () => {
    test('recognises Gmail rate limits, revoked grants, transient and permanent failures', () => {
      expect(mailTransport.classifyDeliveryError(new Error('User-rate limit exceeded.  Retry after 2026-10-13T11:48:37.516Z (Mail sending)'))).toBe(
        DELIVERY_ERROR_KIND.RATE_LIMITED
      );
      expect(mailTransport.classifyDeliveryError({ status: 429, message: 'slow down' })).toBe(DELIVERY_ERROR_KIND.RATE_LIMITED);
      expect(mailTransport.classifyDeliveryError(new Error('invalid_grant'))).toBe(DELIVERY_ERROR_KIND.AUTH_REVOKED);
      expect(
        mailTransport.classifyDeliveryError({ message: 'Request failed', response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } })
      ).toBe(DELIVERY_ERROR_KIND.AUTH_REVOKED);
      expect(mailTransport.classifyDeliveryError({ message: 'MailChannels responded 401', status: 401 })).toBe(DELIVERY_ERROR_KIND.AUTH_REVOKED);
      expect(mailTransport.classifyDeliveryError({ message: 'bad gateway', response: { status: 502 } })).toBe(DELIVERY_ERROR_KIND.TRANSIENT);
      expect(mailTransport.classifyDeliveryError(new Error('socket hang up'))).toBe(DELIVERY_ERROR_KIND.TRANSIENT);
      expect(mailTransport.classifyDeliveryError({ message: 'Invalid To header', code: 'EENVELOPE' })).toBe(DELIVERY_ERROR_KIND.PERMANENT);
      expect(mailTransport.classifyDeliveryError(null)).toBe(DELIVERY_ERROR_KIND.PERMANENT);
      expect(mailTransport.errorText(null)).toBe('');
      expect(mailTransport.errorText({ message: 'a', response: { data: { error: { message: 'nested' } } } })).toBe('a nested');
    });

    test('reads the retry time from Gmail text or a Retry-After header', () => {
      const now = Date.parse('2026-10-13T11:33:37.000Z');
      expect(mailTransport.parseRetryAfterMs(new Error('Retry after 2026-10-13T11:48:37.000Z (Mail sending)'), now)).toBe(15 * 60 * 1000);
      expect(mailTransport.parseRetryAfterMs(new Error('Retry after 2026-10-13T11:00:00.000Z'), now)).toBeNull();
      expect(mailTransport.parseRetryAfterMs({ message: 'x', response: { headers: { get: () => '120' } } }, now)).toBe(120000);
      expect(mailTransport.parseRetryAfterMs({ message: 'x', response: { headers: { 'retry-after': '30' } } }, now)).toBe(30000);
      expect(mailTransport.parseRetryAfterMs({ message: 'x', response: { headers: { 'retry-after': 'soon' } } }, now)).toBeNull();
      expect(mailTransport.parseRetryAfterMs(new Error('nothing'), now)).toBeNull();
    });
  });

  describe('provider cooldowns', () => {
    test('a rate-limited provider cools down until Gmail says it may retry, then recovers', () => {
      const now = Date.now();
      const retryAt = new Date(now + 10 * 60 * 1000).toISOString();
      const kind = mailTransport.noteProviderFailure('gmail:buyer:abc', new Error(`User-rate limit exceeded. Retry after ${retryAt}`), now);
      expect(kind).toBe(DELIVERY_ERROR_KIND.RATE_LIMITED);
      expect(mailTransport.isCoolingDown('gmail:buyer:abc', now + 60 * 1000)).toBe(true);
      expect(mailTransport.getCooldown('gmail:buyer:abc').reason).toContain('rate limited');
      expect(Object.keys(mailTransport.listCooldowns(now))).toEqual(['gmail:buyer:abc']);
      expect(mailTransport.isCoolingDown('gmail:buyer:abc', now + 11 * 60 * 1000)).toBe(false);
      expect(mailTransport.getCooldown('gmail:buyer:abc')).toBeNull();
    });

    test('a rate limit without a retry time uses the default window; revoked credentials use the auth window', () => {
      const now = Date.now();
      mailTransport.noteProviderFailure('a', { status: 429, message: 'Too Many Requests' }, now);
      expect(mailTransport.getCooldown('a').until).toBe(now + mailTransport.MAIL_TRANSPORT_CONFIG.DEFAULT_RATE_LIMIT_COOLDOWN_MS);
      mailTransport.noteProviderFailure('b', new Error('invalid_grant'), now);
      expect(mailTransport.getCooldown('b').until).toBe(now + mailTransport.MAIL_TRANSPORT_CONFIG.AUTH_REVOKED_COOLDOWN_MS);
      expect(mailTransport.noteProviderFailure('c', new Error('socket hang up'), now)).toBe(DELIVERY_ERROR_KIND.TRANSIENT);
      expect(mailTransport.getCooldown('c')).toBeNull();
      mailTransport.clearCooldown('a');
      expect(mailTransport.getCooldown('a')).toBeNull();
      expect(mailTransport.listCooldowns(now + mailTransport.MAIL_TRANSPORT_CONFIG.MAX_COOLDOWN_MS + 1)).toEqual({});
    });

    test('startCooldown clamps to at least a second and at most a day', () => {
      const now = Date.now();
      expect(mailTransport.startCooldown('x', 0, 'r', now).until).toBe(now + 1000);
      expect(mailTransport.startCooldown('y', 10 * 24 * 60 * 60 * 1000, 'r', now).until).toBe(
        now + mailTransport.MAIL_TRANSPORT_CONFIG.MAX_COOLDOWN_MS
      );
    });
  });

  describe('fetchWithTimeout', () => {
    test('aborts a request that runs past the bound', async () => {
      global.fetch = jest.fn((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
      await expect(mailTransport.fetchWithTimeout('https://x.test', { method: 'POST' }, 5)).rejects.toThrow('aborted');
    });

    test('works without AbortController', async () => {
      const original = global.AbortController;
      global.AbortController = undefined;
      global.fetch = jest.fn().mockResolvedValue('ok');
      await expect(mailTransport.fetchWithTimeout('https://x.test', {})).resolves.toBe('ok');
      expect(global.fetch.mock.calls[0][1].signal).toBeUndefined();
      global.AbortController = original;
    });
  });

  describe('HTTP providers', () => {
    const provider = (key) => mailTransport.HTTP_PROVIDERS.find((entry) => entry.key === key);
    const fullMessage = {
      to: 'vendor@example.com',
      cc: 'buyer@example.com',
      bcc: 'audit@procucev.com',
      replyTo: 'gateway@procucev.com',
      subject: 'Subject',
      html: '<p>Hi</p>',
      text: 'Hi',
      headers: { 'Auto-Submitted': 'auto-replied' },
    };

    test('only providers with an API key are configured, each with its own from address', () => {
      expect(mailTransport.configuredHttpProviders()).toEqual([]);
      process.env.SENDGRID_API_KEY = 'sg';
      process.env.SENDGRID_FROM_EMAIL = 'mail@procucev.com';
      process.env.MAILCHANNELS_API_KEY = 'mc';
      expect(mailTransport.configuredHttpProviders().map((entry) => entry.key)).toEqual(['sendgrid', 'mailchannels']);
      expect(provider('sendgrid').fromAddress()).toBe('mail@procucev.com');
      expect(provider('resend').fromAddress()).toBeUndefined();
      expect(provider('brevo').fromAddress()).toBeUndefined();
      expect(provider('mailchannels').fromAddress()).toBeUndefined();
    });

    test('Resend sends cc/bcc/reply-to/headers and reports its message id; errors carry the API message', async () => {
      process.env.RESEND_API_KEY = 'rk';
      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(200, { id: 'resend-1' }));
      await expect(provider('resend').send(fullMessage, 'Procucev <a@procucev.com>')).resolves.toEqual({ messageId: 'resend-1' });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body).toMatchObject({ to: 'vendor@example.com', cc: ['buyer@example.com'], bcc: ['audit@procucev.com'], reply_to: 'gateway@procucev.com', text: 'Hi' });
      expect(body.headers).toEqual({ 'Auto-Submitted': 'auto-replied' });

      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(429, { message: 'Too many requests' }));
      await expect(provider('resend').send({ to: 'a@b.com', subject: 's', html: 'h' }, 'a@procucev.com')).rejects.toMatchObject({
        message: 'Too many requests',
        status: 429,
      });

      const unparsable = jsonResponse(500, {});
      unparsable.json = jest.fn().mockRejectedValue(new Error('not json'));
      global.fetch = jest.fn().mockResolvedValueOnce(unparsable);
      await expect(provider('resend').send({ to: 'a@b.com', subject: 's', html: 'h' }, 'a@procucev.com')).rejects.toMatchObject({ status: 500 });
    });

    test('SendGrid maps recipients into a personalization and surfaces failures', async () => {
      process.env.SENDGRID_API_KEY = 'sg';
      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(202, '', { 'x-message-id': 'sg-1' }));
      await expect(provider('sendgrid').send(fullMessage, '"Procucev Enterprise" <a@procucev.com>')).resolves.toEqual({ messageId: 'sg-1' });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.personalizations[0]).toEqual({
        to: [{ email: 'vendor@example.com' }],
        cc: [{ email: 'buyer@example.com' }],
        bcc: [{ email: 'audit@procucev.com' }],
      });
      expect(body.from).toEqual({ email: 'a@procucev.com', name: 'Procucev Enterprise' });
      expect(body.reply_to).toEqual({ email: 'gateway@procucev.com' });

      global.fetch = jest.fn().mockResolvedValueOnce({ ...jsonResponse(202, ''), headers: undefined });
      await expect(provider('sendgrid').send({ to: 'a@b.com', subject: 's', html: '<p>h</p>' }, 'a@procucev.com')).resolves.toEqual({
        messageId: undefined,
      });
      const plainBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(plainBody.content[0]).toEqual({ type: 'text/plain', value: 'h' });

      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(401, 'unauthorized'));
      await expect(provider('sendgrid').send({ to: 'a@b.com', subject: 's', text: 't' }, 'a@procucev.com')).rejects.toMatchObject({ status: 401 });
    });

    test('Brevo sends sender/to/cc/bcc and reports its message id', async () => {
      process.env.BREVO_API_KEY = 'bk';
      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(201, { messageId: 'brevo-1' }));
      await expect(provider('brevo').send(fullMessage, 'a@procucev.com')).resolves.toEqual({ messageId: 'brevo-1' });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body).toMatchObject({
        sender: { email: 'a@procucev.com', name: 'Procucev Enterprise' },
        to: [{ email: 'vendor@example.com' }],
        cc: [{ email: 'buyer@example.com' }],
        bcc: [{ email: 'audit@procucev.com' }],
        replyTo: { email: 'gateway@procucev.com' },
      });

      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(400, { message: 'bad sender' }));
      await expect(provider('brevo').send({ to: 'a@b.com', subject: 's' }, 'a@procucev.com')).rejects.toMatchObject({ status: 400 });

      const unparsable = jsonResponse(500, {});
      unparsable.json = jest.fn().mockRejectedValue(new Error('not json'));
      global.fetch = jest.fn().mockResolvedValueOnce(unparsable);
      await expect(provider('brevo').send({ to: 'a@b.com', subject: 's', html: 'h' }, 'a@procucev.com')).rejects.toMatchObject({ status: 500 });
    });

    test('MailChannels authenticates with its API key and accepts 202', async () => {
      process.env.MAILCHANNELS_API_KEY = 'mk';
      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(202, ''));
      await expect(provider('mailchannels').send(fullMessage, 'a@procucev.com')).resolves.toEqual({ messageId: undefined });
      expect(global.fetch.mock.calls[0][1].headers['X-Api-Key']).toBe('mk');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.personalizations[0].cc).toEqual([{ email: 'buyer@example.com' }]);

      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(200, ''));
      await expect(provider('mailchannels').send({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }, 'a@procucev.com')).resolves.toEqual({
        messageId: undefined,
      });

      const failing = jsonResponse(401, '');
      failing.text = jest.fn().mockRejectedValue(new Error('no body'));
      global.fetch = jest.fn().mockResolvedValueOnce(failing);
      await expect(provider('mailchannels').send({ to: 'a@b.com', subject: 's' }, 'a@procucev.com')).rejects.toMatchObject({ status: 401 });
    });
  });
});
