const googleapis = require('googleapis');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const emailIngestionService = require('../src/services/emailIngestionService');
const mailerService = require('../src/services/mailerService');
const storeService = require('../src/services/storeService');
const dbPool = require('../src/db/pool');
const { EMAIL_GATEWAY_MESSAGES } = require('../src/config/constants');
const fixtures = require('./fixtures/sampleRequisitionEmail');

// ==============================================================================
// EMAIL GATEWAY RELIABILITY
// ==============================================================================
// Pins the fixes for what was found live on the dev gateway (Oct 2026):
//   - the "Buyer Registration Required" notice ping-ponged with an
//     auto-forwarding rfq@procucev.com mailbox (~2,000 notices a day);
//   - newsletters were answered on every one-minute poll because rejected
//     messages were never marked read and the dedupe key did not match the key
//     the outcome was recorded under;
//   - together these exhausted the Gmail sending quota OTP mail depends on.
// ==============================================================================

const { INGESTION_OUTCOME } = emailGatewayQueries;
const { AUTO_REPLY_KIND } = emailGatewayService;

function message(overrides = {}) {
  return { fromAddress: 'stranger@outside.org', subject: 'Requirement for pumps', automatedReason: null, ...overrides };
}

beforeEach(() => {
  emailGatewayService.resetAutoReplyMemory();
});

afterEach(() => {
  delete process.env.PLATFORM_EMAIL_DOMAINS;
  delete process.env.GMAIL_SENDER_EMAIL;
  jest.restoreAllMocks();
});

describe('automated sender and own-notice detection', () => {
  test.each([
    ['noreply@github.com', true],
    ['no-reply@accounts.example.com', true],
    ['do_not_reply@bank.com', true],
    ['notifications@github.com', true],
    ['newsletter+weekly@vendor.com', true],
    ['bounces+123@mail.example.com', true],
    ['team@news.fly.io', true],
    ['hello@messages.mongodb.com', true],
    ['hi@updates.miro.com', true],
    ['security@accounts.google.com', true],
    ['someone@googlemail.com', true],
    ['project.procurement@lt-heavy.com', false],
    ['rohit@mail.tatasteel.com', false],
    ['info@supplier.in', false],
    ['', false],
  ])('%s → automated: %s', (address, expected) => {
    expect(emailGatewayService.isSystemOrAutomatedSender(address)).toBe(expected);
  });

  test('recognises our own notices coming back, through any Re:/Fwd: chain', () => {
    expect(emailGatewayService.isOwnNoticeSubject('Enterprise QUA - Buyer Registration Required')).toBe(true);
    expect(emailGatewayService.isOwnNoticeSubject('Re: Fwd: RE: Enterprise QUA - Buyer Registration Required')).toBe(true);
    expect(emailGatewayService.isOwnNoticeSubject('AW: Action Required – Quotation Could Not Be Processed for RFQ 1')).toBe(true);
    expect(emailGatewayService.isOwnNoticeSubject('Re: Quotation for RFQ261310967003')).toBe(false);
    expect(emailGatewayService.isOwnNoticeSubject(undefined)).toBe(false);
  });

  test('extracts the Message-ID header, including a folded one, and only from the header block', () => {
    expect(emailGatewayService.extractHeaderMessageId(Buffer.from('From: a@b.com\r\nMessage-ID: <abc@b.com>\r\n\r\nbody'))).toBe('<abc@b.com>');
    expect(emailGatewayService.extractHeaderMessageId('From: a@b.com\nMessage-Id:\n <folded@b.com>\n\nbody')).toBe('<folded@b.com>');
    expect(emailGatewayService.extractHeaderMessageId('From: a@b.com\n\nMessage-ID: <in-body@b.com>')).toBe('');
    expect(emailGatewayService.extractHeaderMessageId('Message-ID: <no-body@b.com>')).toBe('<no-body@b.com>');
    expect(emailGatewayService.extractHeaderMessageId(undefined)).toBe('');
  });
});

describe('shouldSendAutoReply', () => {
  beforeEach(() => {
    jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
  });

  test('never replies to a message with no sender, an automated sender, the platform itself, or automated headers', async () => {
    process.env.GMAIL_SENDER_EMAIL = 'system@procucev.com';
    const kind = AUTO_REPLY_KIND.UNAUTHORIZED_SENDER;
    expect((await emailGatewayService.shouldSendAutoReply(message({ fromAddress: '' }), kind)).reason).toBe('no sender address');
    expect((await emailGatewayService.shouldSendAutoReply(message({ fromAddress: 'noreply@x.com' }), kind)).reason).toBe('automated sender address');
    expect((await emailGatewayService.shouldSendAutoReply(message({ fromAddress: 'system@procucev.com' }), kind)).reason).toBe('platform sender');
    expect((await emailGatewayService.shouldSendAutoReply(message({ automatedReason: 'mailing list' }), kind)).reason).toBe(
      'automated message (mailing list)'
    );
    expect(emailGatewayQueries.countRecentOutcomes).not.toHaveBeenCalled();
  });

  test('blocks the registration-notice loop: own notice subjects and the platform domain', async () => {
    const kind = AUTO_REPLY_KIND.UNAUTHORIZED_SENDER;
    const loop = await emailGatewayService.shouldSendAutoReply(
      message({ fromAddress: 'someone@partner.com', subject: 'Re: Enterprise QUA - Buyer Registration Required' }),
      kind
    );
    expect(loop).toEqual({ allowed: false, reason: 'reply to our own notice' });
    const platform = await emailGatewayService.shouldSendAutoReply(message({ fromAddress: 'rfq@procucev.com' }), kind);
    expect(platform).toEqual({ allowed: false, reason: 'platform domain' });

    process.env.PLATFORM_EMAIL_DOMAINS = 'acme.com, , other.org';
    expect((await emailGatewayService.shouldSendAutoReply(message({ fromAddress: 'x@other.org' }), kind)).reason).toBe('platform domain');
    expect((await emailGatewayService.shouldSendAutoReply(message({ fromAddress: 'x@procucev.com' }), kind)).allowed).toBe(true);
  });

  test('an unregistered sender gets one notice per day, held in memory and in the ledger', async () => {
    const kind = AUTO_REPLY_KIND.UNAUTHORIZED_SENDER;
    expect(await emailGatewayService.shouldSendAutoReply(message(), kind)).toEqual({ allowed: true });
    expect(emailGatewayQueries.countRecentOutcomes).toHaveBeenCalledWith(
      expect.objectContaining({ fromAddress: 'stranger@outside.org', statuses: [INGESTION_OUTCOME.SENDER_NOT_ALLOWED], rfqNumber: null })
    );
    expect((await emailGatewayService.shouldSendAutoReply(message(), kind)).reason).toBe('notice limit reached for this sender');

    emailGatewayService.resetAutoReplyMemory();
    emailGatewayQueries.countRecentOutcomes.mockResolvedValue(1);
    expect((await emailGatewayService.shouldSendAutoReply(message(), kind)).reason).toBe('notice limit reached for this sender');
  });

  test('a vendor notice is allowed a few times per RFQ per hour, separately for each RFQ', async () => {
    const kind = AUTO_REPLY_KIND.QUOTE_FAILURE;
    const vendor = message({ fromAddress: 'sales@vendor.in', subject: 'Re: Action Required – Quotation Could Not Be Processed for RFQ1' });
    for (let i = 0; i < 3; i += 1) {
      expect((await emailGatewayService.shouldSendAutoReply(vendor, kind, { rfqNumber: 'RFQ1' })).allowed).toBe(true);
    }
    expect((await emailGatewayService.shouldSendAutoReply(vendor, kind, { rfqNumber: 'RFQ1' })).allowed).toBe(false);
    expect((await emailGatewayService.shouldSendAutoReply(vendor, kind, { rfqNumber: 'RFQ2' })).allowed).toBe(true);
    expect(emailGatewayQueries.countRecentOutcomes).toHaveBeenLastCalledWith(expect.objectContaining({ rfqNumber: 'RFQ2' }));
  });

  test('acknowledgements of real work have no cap; a ledger error skips capped notices', async () => {
    expect(await emailGatewayService.shouldSendAutoReply(message(), AUTO_REPLY_KIND.QUOTE_ACK)).toEqual({ allowed: true });
    emailGatewayQueries.countRecentOutcomes.mockRejectedValue(new Error('D1 down'));
    expect(await emailGatewayService.shouldSendAutoReply(message(), AUTO_REPLY_KIND.CREDITS_EXHAUSTED, { rfqNumber: 'R' })).toEqual({
      allowed: false,
      reason: 'cooldown unavailable',
    });
  });

  test('the in-memory history is bounded', async () => {
    for (let i = 0; i <= 5000; i += 1) {
      await emailGatewayService.shouldSendAutoReply(message({ fromAddress: `buyer${i}@outside.org` }), AUTO_REPLY_KIND.UNAUTHORIZED_SENDER);
    }
    // Cleared when it passed 5000 entries, so the very first sender is allowed again.
    expect((await emailGatewayService.shouldSendAutoReply(message({ fromAddress: 'buyer0@outside.org' }), AUTO_REPLY_KIND.UNAUTHORIZED_SENDER)).allowed).toBe(true);
  });
});

describe('sendAutoReply', () => {
  test('does not call the mailer when suppressed, swallows a send failure, and reports success', async () => {
    const send = jest.fn().mockResolvedValue({ sent: true });
    jest.spyOn(emailGatewayService, 'shouldSendAutoReply').mockResolvedValueOnce({ allowed: false, reason: 'automated sender address' });
    expect(await emailGatewayService.sendAutoReply(message(), AUTO_REPLY_KIND.UNAUTHORIZED_SENDER, send)).toBe(false);
    expect(send).not.toHaveBeenCalled();

    emailGatewayService.shouldSendAutoReply.mockResolvedValue({ allowed: true });
    send.mockRejectedValueOnce(new Error('all providers failed'));
    expect(await emailGatewayService.sendAutoReply(message(), AUTO_REPLY_KIND.UNAUTHORIZED_SENDER, send)).toBe(false);
    expect(await emailGatewayService.sendAutoReply(message(), AUTO_REPLY_KIND.UNAUTHORIZED_SENDER, send, { failureLog: 'x' })).toBe(true);
    expect(await emailGatewayService.sendAutoReply(undefined, AUTO_REPLY_KIND.RFQ_ACK, send)).toBe(true);
  });
});

describe('processMessage never answers automated mail', () => {
  test('an unregistered newsletter (List-Unsubscribe) is rejected without a registration notice', async () => {
    jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
    const notice = jest.spyOn(mailerService, 'sendUnauthorizedBuyerNotificationEmail').mockResolvedValue({ sent: true });
    const raw = fixtures.PLAIN_REQUISITION_EML.split('project.procurement@lt-heavy.com')
      .join('digest@newsletter-co.com')
      .replace(/^Subject:/m, 'List-Unsubscribe: <mailto:unsub@newsletter-co.com>\r\nSubject:');
    const result = await emailGatewayService.processMessage(Buffer.from(raw, 'utf8'), emailGatewayService.resolveConfig({ EMAIL_GATEWAY_USER: 'intake@procucev.com' }));
    expect(result.status).toBe(INGESTION_OUTCOME.SENDER_NOT_ALLOWED);
    expect(result.message.automatedReason).toBe('mailing list');
    expect(notice).not.toHaveBeenCalled();
  });
});

describe('pollViaGmailApi reliability', () => {
  function gmailApi(pages, raw = fixtures.PLAIN_REQUISITION_EML) {
    const list = jest.fn();
    pages.forEach((page) => list.mockResolvedValueOnce({ data: page }));
    const get = jest.fn().mockResolvedValue({ data: { raw: Buffer.from(raw, 'utf8').toString('base64url') } });
    const modify = jest.fn().mockResolvedValue({});
    return { users: { messages: { list, get, modify } } };
  }

  beforeEach(() => {
    jest.spyOn(mailerService, 'getGmailOAuthClient').mockReturnValue({});
    jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
    jest.spyOn(emailGatewayQueries, 'countFailedAttempts').mockResolvedValue(0);
  });

  afterEach(() => {
    emailGatewayService.runtime.isPolling = false;
    emailGatewayService.runtime.lastError = null;
  });

  test('marks a rejected message (unregistered sender) read so it is never reprocessed', async () => {
    const api = gmailApi([{ messages: [{ id: 'n1' }] }]);
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue(api);
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
      status: INGESTION_OUTCOME.SENDER_NOT_ALLOWED,
      detail: 'not a buyer',
      message: { messageId: '<news@x.com>', fromAddress: 'news@x.com', subject: 'Weekly' },
    });

    const result = await emailGatewayService.pollViaGmailApi();
    expect(result.outcomes[0].status).toBe(INGESTION_OUTCOME.SENDER_NOT_ALLOWED);
    expect(result.ingested).toBe(0);
    expect(api.users.messages.modify).toHaveBeenCalledWith({ userId: 'me', id: 'n1', requestBody: { removeLabelIds: ['UNREAD'] } });
  });

  test('a message already recorded under its Message-ID header is skipped and marked read', async () => {
    const api = gmailApi([{ messages: [{ id: 'dup1' }] }]);
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue(api);
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockImplementation(async (key) => !key.startsWith('gmail-'));
    const process = jest.spyOn(emailGatewayService, 'processMessage');

    const result = await emailGatewayService.pollViaGmailApi();
    expect(result.outcomes[0]).toEqual(expect.objectContaining({ status: EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED }));
    expect(result.outcomes[0].messageId).toMatch(/^</);
    expect(process).not.toHaveBeenCalled();
    expect(api.users.messages.modify).toHaveBeenCalled();
  });

  test('an unreachable ledger pauses the poll and leaves mail unread instead of dropping it', async () => {
    const api = gmailApi([{ messages: [{ id: 'a' }, { id: 'b' }] }]);
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue(api);
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockRejectedValue(new Error('D1 unavailable'));

    const result = await emailGatewayService.pollViaGmailApi();
    expect(result.outcomes).toEqual([expect.objectContaining({ uid: 'a', status: emailGatewayService.EMAIL_GATEWAY_LEDGER_UNAVAILABLE })]);
    expect(api.users.messages.modify).not.toHaveBeenCalled();
    expect(emailGatewayService.runtime.lastError).toContain('ledger unavailable');
  });

  test('a failure is retried on later polls and only written off after the last attempt', async () => {
    const api = gmailApi([{ messages: [{ id: 'f1' }] }]);
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue(api);
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    jest.spyOn(emailGatewayService, 'processMessage').mockRejectedValue(new Error('Gemini line-item extraction timed out'));
    emailGatewayQueries.countFailedAttempts.mockResolvedValue(emailGatewayService.EMAIL_GATEWAY_MAX_ATTEMPTS - 1);
    emailGatewayQueries.recordProcessed.mockRejectedValueOnce(new Error('write failed'));

    const result = await emailGatewayService.pollViaGmailApi();
    expect(result.outcomes[0]).toEqual(expect.objectContaining({ status: INGESTION_OUTCOME.FAILED, willRetry: false }));
    expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'gmail-f1', status: INGESTION_OUTCOME.FAILED })
    );
    expect(api.users.messages.modify).toHaveBeenCalled();
  });

  test('a message Gmail returns without a body is recorded and marked read', async () => {
    const api = gmailApi([{ messages: [{ id: 'empty' }] }]);
    api.users.messages.get.mockResolvedValue({ data: {} });
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue(api);
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);

    const result = await emailGatewayService.pollViaGmailApi();
    expect(result.outcomes[0].status).toBe(INGESTION_OUTCOME.UNREADABLE);
    expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'gmail-empty', status: INGESTION_OUTCOME.UNREADABLE })
    );
    expect(api.users.messages.modify).toHaveBeenCalled();
  });

  test('already-processed mail does not use up the batch: the poll pages on to new mail', async () => {
    const api = gmailApi([
      { messages: [{ id: 'old1' }, { id: 'old2' }], nextPageToken: 'p2', resultSizeEstimate: 4 },
      { messages: [{ id: 'old2' }, { id: 'new1' }] },
    ]);
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue(api);
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockImplementation(async (key) => key.startsWith('gmail-old'));
    jest.spyOn(emailGatewayService, 'processMessage').mockResolvedValue({
      status: INGESTION_OUTCOME.INGESTED,
      detail: 'ok',
      message: { messageId: '<new1@x.com>', fromAddress: 'b@x.com', subject: 'RFQ' },
      rfq: { id: 'r1', rfqNumber: 'RFQ1' },
    });

    const result = await emailGatewayService.pollViaGmailApi(emailGatewayService.resolveConfig({ EMAIL_GATEWAY_MAX_PER_POLL: '1' }));
    expect(api.users.messages.list).toHaveBeenCalledTimes(2);
    expect(api.users.messages.list).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'p2' }));
    expect(result.outcomes.map((o) => o.uid)).toEqual(['old1', 'old2', 'new1']);
    expect(result.ingested).toBe(1);
    expect(result.considered).toBe(3);
  });
});

describe('ledger helpers', () => {
  test('countRecentOutcomes filters by sender, window, statuses and optionally the RFQ', async () => {
    const rows = jest.spyOn(dbPool, 'rows').mockResolvedValue([{ total: 2 }]);
    const since = new Date('2026-10-13T11:00:00.000Z');
    await expect(
      emailGatewayQueries.countRecentOutcomes({ fromAddress: ' Vendor@X.com ', statuses: ['A', 'B'], rfqNumber: 'RFQ1', since })
    ).resolves.toBe(2);
    const [sql, params] = rows.mock.calls[0];
    expect(sql).toContain('status in ($3, $4)');
    expect(sql).toContain('rfq_number = $5');
    expect(params).toEqual(['vendor@x.com', '2026-10-13 11:00:00', 'A', 'B', 'RFQ1']);

    rows.mockResolvedValueOnce([]);
    await expect(emailGatewayQueries.countRecentOutcomes({ fromAddress: 'a@b.com', statuses: ['A'], since })).resolves.toBe(0);
    expect(rows.mock.calls[1][0]).not.toContain('rfq_number');

    await expect(emailGatewayQueries.countRecentOutcomes({ fromAddress: '', statuses: ['A'], since })).resolves.toBe(0);
    await expect(emailGatewayQueries.countRecentOutcomes({ fromAddress: 'a@b.com', since })).resolves.toBe(0);
  });

  test('countFailedAttempts counts attempt rows and reads as zero on a ledger error', async () => {
    const rows = jest.spyOn(dbPool, 'rows').mockResolvedValueOnce([{ total: 2 }]).mockResolvedValueOnce([]);
    await expect(emailGatewayQueries.countFailedAttempts('gmail-1')).resolves.toBe(2);
    expect(rows.mock.calls[0][1]).toEqual(['gmail-1#attempt-%']);
    await expect(emailGatewayQueries.countFailedAttempts('gmail-2')).resolves.toBe(0);
    rows.mockRejectedValueOnce(new Error('down'));
    await expect(emailGatewayQueries.countFailedAttempts('gmail-3')).resolves.toBe(0);
    await expect(emailGatewayQueries.countFailedAttempts('')).resolves.toBe(0);
  });

  test('hasProcessed in strict mode throws on a ledger error instead of guessing', async () => {
    jest.spyOn(dbPool, 'rows').mockRejectedValue(new Error('down'));
    await expect(emailGatewayQueries.hasProcessed('<strict@x.com>', { strict: true })).rejects.toThrow('down');
    await expect(emailGatewayQueries.hasProcessed('<lenient@x.com>')).resolves.toBe(true);
  });

  test('toLedgerTimestamp matches the CURRENT_TIMESTAMP text form', () => {
    expect(emailGatewayQueries.toLedgerTimestamp('2026-10-13T11:35:13.456Z')).toBe('2026-10-13 11:35:13');
  });
});

describe('automated-message detection in parsing', () => {
  const headers = (entries) => new Map(Object.entries(entries));

  test.each([
    [{ 'auto-submitted': 'auto-replied' }, 'auto-submitted: auto-replied'],
    [{ 'auto-submitted': 'no' }, null],
    [{ precedence: 'bulk' }, 'precedence: bulk'],
    [{ precedence: 'first-class' }, null],
    [{ list: { unsubscribe: { mail: 'u@x.com' }, id: { id: 'news.x.com' } } }, 'mailing list'],
    [{ 'list-id': { text: 'news.example.com' } }, 'mailing list'],
    [{ 'list-unsubscribe': ['<mailto:u@x.com>'] }, 'mailing list'],
    [{ 'x-auto-response-suppress': 'OOF, AutoReply' }, 'x-auto-response-suppress: oof, autoreply'],
    [{ 'x-auto-response-suppress': 'DR' }, null],
    [{ 'x-autoreply': 'yes' }, 'auto-responder'],
    [{ 'x-autorespond': 1 }, 'auto-responder'],
    [{ 'list-id': { value: 'v' } }, 'mailing list'],
    [{ 'list-id': { other: 'x' } }, 'mailing list'],
    [{ 'auto-submitted': null }, null],
    [{}, null],
  ])('%j → %s', (entries, expected) => {
    expect(emailIngestionService.detectAutomatedMessage(headers(entries))).toBe(expected);
  });

  test('no header map at all is treated as person-sent', () => {
    expect(emailIngestionService.detectAutomatedMessage(undefined)).toBeNull();
  });

  test('parsed messages carry threading headers and the automation reason', async () => {
    const raw = [
      'From: Vendor <sales@vendor.in>',
      'To: quotes@procucev.com',
      'Subject: Re: RFQ',
      'Message-ID: <reply-1@vendor.in>',
      'In-Reply-To: <invite-1@procucev.com>',
      'References: <root@procucev.com> <invite-1@procucev.com>',
      'Auto-Submitted: auto-replied',
      '',
      'Out of office',
    ].join('\r\n');
    const parsed = await emailIngestionService.parseEmailMessage(Buffer.from(raw, 'utf8'));
    expect(parsed.inReplyTo).toBe('<invite-1@procucev.com>');
    expect(parsed.references).toBe('<root@procucev.com> <invite-1@procucev.com>');
    expect(parsed.automatedReason).toBe('auto-submitted: auto-replied');

    const single = await emailIngestionService.parseEmailMessage(
      Buffer.from('From: a@b.com\r\nReferences: <only@b.com>\r\nSubject: x\r\n\r\nbody', 'utf8')
    );
    expect(single.references).toBe('<only@b.com>');
    expect(single.inReplyTo).toBe('');
  });
});

describe('gateway status', () => {
  test('reports outbound mail delivery health alongside the inbox status', async () => {
    jest.spyOn(mailerService, 'getDeliveryHealth').mockReturnValue({ runtime: 'node', gmailIdentities: [] });
    const status = await emailGatewayService.getStatus();
    expect(status.mailDelivery).toEqual({ runtime: 'node', gmailIdentities: [] });
  });
});
