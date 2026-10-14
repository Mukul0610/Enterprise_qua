// Email → RFQ flow: the cases that used to fail silently.
//
//   - a temporary Gemini failure is retried, and the buyer is told once the
//     retries run out, instead of the requirement being dropped after one try;
//   - a buyer whose email did not become an RFQ is told why;
//   - a free trial with no credits left is refused by email exactly as the
//     portal refuses it;
//   - documents attached to the email are stored on the RFQ;
//   - an email retried after some of its RFQs were created does not raise them twice.

const googleapis = require('googleapis');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const geminiService = require('../src/services/geminiService');
const rfqIngestionService = require('../src/services/rfqIngestionService');
const rfqAttachmentService = require('../src/services/rfqAttachmentService');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const dbPool = require('../src/db/pool');
const { logger } = require('../src/services/loggerService');
const {
  EMAIL_GATEWAY_CONFIG,
  EMAIL_GATEWAY_MESSAGES,
  RFQ_NOT_CREATED_NOTIFICATION,
} = require('../src/config/constants');
const fixtures = require('./fixtures/sampleRequisitionEmail');
const taxonomyFixture = require('./fixtures/categoryTaxonomy');

const { INGESTION_OUTCOME } = emailGatewayQueries;
const SENDER = 'project.procurement@lt-heavy.com';
const MESSAGE_ID = '<REQ-2026-0914.project.procurement@lt-heavy.com>';

function buyerAccount(overrides = {}) {
  return {
    id: 'buyer-acc-101',
    organizationName: 'L&T Heavy Engineering',
    corporateEmail: SENDER,
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560001',
    ...overrides,
  };
}

const raw = () => Buffer.from(fixtures.PLAIN_REQUISITION_EML, 'utf8');
const config = () => emailGatewayService.resolveConfig({ EMAIL_GATEWAY_ENABLED: 'true', EMAIL_GATEWAY_USER: 'intake@procucev.com' });

function mockExtraction(overrides = {}) {
  return jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
    status: geminiService.EXTRACTION_STATUS.SUCCESS,
    model: 'gemini-test',
    documentTitle: 'Centrifugal Pumps',
    lineItems: [{ itemName: 'Centrifugal Pump 150 m3/hr', quantity: 4, unit: 'Nos' }],
    ...overrides,
  });
}

function twoGroups() {
  const item = (name) => ({ itemName: name, quantity: 2, unit: 'Nos' });
  return [
    { items: [item('Centrifugal Pump 150 m3/hr')], deliveryLocation: 'Pune', deliveryCity: 'Pune', targetDate: '2026-11-01' },
    { items: [item('Centrifugal Pump 200 m3/hr')], deliveryLocation: 'Chennai', deliveryCity: 'Chennai', targetDate: '2026-11-05' },
  ];
}

let notice;
let ack;

beforeEach(() => {
  emailGatewayService.resetAutoReplyMemory();
  rfqIngestionService.primeTaxonomyIndex(taxonomyFixture.CATEGORY_TAXONOMY_FIXTURE);
  jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
  jest.spyOn(emailGatewayQueries, 'findProcessed').mockResolvedValue(null);
  jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
  jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount());
  jest.spyOn(storeService, 'consumeRFQCreditIfApplicable').mockReturnValue({ consumed: true, remaining: 4 });
  notice = jest.spyOn(mailerService, 'sendRfqNotCreatedEmail').mockResolvedValue({ sent: true });
  ack = jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue({ sent: true });
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  rfqIngestionService.resetTaxonomyIndex();
  emailGatewayService.runtime.isPolling = false;
  emailGatewayService.runtime.lastError = null;
});

describe('temporary extraction failures are retried, not dropped', () => {
  test.each(['AI_FAILED', 'QUOTA_EXCEEDED', 'NOT_CONFIGURED'])('%s throws a retryable error and creates nothing', async (status) => {
    mockExtraction({ status, lineItems: [] });
    const create = jest.spyOn(storeService, 'createRFQ');

    const err = await emailGatewayService.processMessage(raw(), config()).catch((e) => e);

    expect(err).toBeInstanceOf(emailGatewayService.RetryableIngestionError);
    expect(err.message).toBe(EMAIL_GATEWAY_MESSAGES.EXTRACTION_RETRYABLE.replace('{status}', status));
    expect(err.fromAddress).toBe(SENDER);
    expect(typeof err.onGiveUp).toBe('function');
    expect(create).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  });

  test('a Gemini call that throws or times out is retryable too', async () => {
    jest.spyOn(geminiService, 'extractLineItems').mockRejectedValue(new Error('Gemini line-item extraction timed out'));
    await expect(emailGatewayService.processMessage(raw(), config())).rejects.toMatchObject({
      name: 'RetryableIngestionError',
      message: 'Gemini line-item extraction timed out',
    });
  });

  test('the give-up hook tells the buyer the RFQ was not created', async () => {
    mockExtraction({ status: 'AI_FAILED', lineItems: [] });
    const err = await emailGatewayService.processMessage(raw(), config()).catch((e) => e);
    await err.onGiveUp();
    expect(notice).toHaveBeenCalledWith(
      expect.objectContaining({ to: SENDER, reason: 'PROCESSING_FAILED', buyerName: 'L&T Heavy Engineering' })
    );
  });

  test('RetryableIngestionError tolerates missing context', () => {
    const err = new emailGatewayService.RetryableIngestionError('x');
    expect(err).toMatchObject({ fromAddress: null, subject: null, onGiveUp: null });
  });
});

describe('poller: retries, then notifies on the last attempt', () => {
  function gmailApi() {
    const list = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'g1' }] } });
    const get = jest.fn().mockResolvedValue({ data: { raw: raw().toString('base64url') } });
    const modify = jest.fn().mockResolvedValue({});
    return { users: { messages: { list, get, modify } } };
  }

  beforeEach(() => {
    jest.spyOn(mailerService, 'getGmailOAuthClient').mockReturnValue({});
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    mockExtraction({ status: 'QUOTA_EXCEEDED', lineItems: [] });
  });

  test('an early attempt leaves the mail unread and sends nothing', async () => {
    const api = gmailApi();
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue(api);
    jest.spyOn(emailGatewayQueries, 'countFailedAttempts').mockResolvedValue(0);

    const result = await emailGatewayService.pollViaGmailApi(config());

    expect(result.outcomes[0]).toEqual(expect.objectContaining({ status: INGESTION_OUTCOME.FAILED, willRetry: true }));
    expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'gmail-g1#attempt-1', status: INGESTION_OUTCOME.FAILED, fromAddress: SENDER })
    );
    expect(api.users.messages.modify).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  });

  test('the last attempt marks the mail read and tells the buyer', async () => {
    const api = gmailApi();
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue(api);
    jest
      .spyOn(emailGatewayQueries, 'countFailedAttempts')
      .mockResolvedValue(emailGatewayService.EMAIL_GATEWAY_MAX_ATTEMPTS - 1);

    const result = await emailGatewayService.pollViaGmailApi(config());

    expect(result.outcomes[0]).toEqual(expect.objectContaining({ status: INGESTION_OUTCOME.FAILED, willRetry: false }));
    expect(api.users.messages.modify).toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ reason: 'PROCESSING_FAILED' }));
  });

  test('a give-up notice that throws does not break the poll', async () => {
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue(gmailApi());
    jest
      .spyOn(emailGatewayQueries, 'countFailedAttempts')
      .mockResolvedValue(emailGatewayService.EMAIL_GATEWAY_MAX_ATTEMPTS - 1);
    const failing = new emailGatewayService.RetryableIngestionError('boom', {
      message: { fromAddress: SENDER, subject: 'x' },
      onGiveUp: () => {
        throw new Error('mailer exploded');
      },
    });
    jest.spyOn(emailGatewayService, 'processMessage').mockRejectedValue(failing);

    const result = await emailGatewayService.pollViaGmailApi(config());

    expect(result.outcomes[0].status).toBe(INGESTION_OUTCOME.FAILED);
    expect(logger.error).toHaveBeenCalledWith('Failed to send give-up notice to buyer', expect.any(Error), 'EMAIL_GATEWAY');
  });
});

describe('the buyer is told when no RFQ was created', () => {
  test('nothing found in the email', async () => {
    mockExtraction({ status: geminiService.EXTRACTION_STATUS.NO_ITEMS_FOUND, lineItems: [] });
    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ to: SENDER, reason: 'NO_LINE_ITEMS' }));
  });

  test('no usable groups after normalising', async () => {
    mockExtraction();
    jest.spyOn(emailGatewayService, 'processLineItemsAndGroups').mockReturnValue([]);
    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.detail).toBe(EMAIL_GATEWAY_MESSAGES.NO_ITEMS_ACCEPTED);
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ reason: 'NO_LINE_ITEMS' }));
  });

  test('every row discarded by classification', async () => {
    mockExtraction({ lineItems: [{ quantity: 4, unit: 'Nos' }] });
    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ reason: 'NO_LINE_ITEMS' }));
  });

  test('too many line items, with the count and the limit', async () => {
    const max = EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ;
    mockExtraction({
      lineItems: Array.from({ length: max + 1 }, (_, i) => ({ itemName: `Gate valve DN${50 + i}`, quantity: 1, unit: 'Nos' })),
    });
    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.LINE_ITEMS_EXCEED_LIMIT);
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ reason: 'TOO_MANY_LINE_ITEMS', count: max + 1, max }));
  });

  test('a reply to our own acknowledgement is not answered with a notice', async () => {
    mockExtraction({ status: geminiService.EXTRACTION_STATUS.NO_ITEMS_FOUND, lineItems: [] });
    const reply = fixtures.PLAIN_REQUISITION_EML.replace(
      /^Subject: .*$/m,
      'Subject: Re: Great news! Your requirement has been converted into RFQ #RFQ-2026-0001'
    );
    const result = await emailGatewayService.processMessage(Buffer.from(reply, 'utf8'), config());
    expect(result.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
    expect(notice).not.toHaveBeenCalled();
  });

  test('the notice is rate-limited per sender through the ledger', async () => {
    mockExtraction({ status: geminiService.EXTRACTION_STATUS.NO_ITEMS_FOUND, lineItems: [] });
    emailGatewayQueries.countRecentOutcomes.mockResolvedValue(3);
    await emailGatewayService.processMessage(raw(), config());
    expect(notice).not.toHaveBeenCalled();
    expect(emailGatewayQueries.countRecentOutcomes).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: [INGESTION_OUTCOME.NO_LINE_ITEMS, INGESTION_OUTCOME.LINE_ITEMS_EXCEED_LIMIT, INGESTION_OUTCOME.RFQ_CREDITS_EXHAUSTED],
      })
    );
  });

  test('a notice that fails to send does not change the outcome', async () => {
    mockExtraction({ status: geminiService.EXTRACTION_STATUS.NO_ITEMS_FOUND, lineItems: [] });
    notice.mockRejectedValue(new Error('all providers down'));
    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
  });

  test('our own notice subject is recognised as ours', () => {
    expect(emailGatewayService.isOwnNoticeSubject(`Fwd: ${RFQ_NOT_CREATED_NOTIFICATION.SUBJECT}`)).toBe(true);
  });
});

describe('free trial credits are enforced the same way as on the portal', () => {
  test('a free trial with no credits left switches to V0 and is ingested as a V0 RFQ', async () => {
    storeService.getBuyerAccountByEmail.mockReturnValue(buyerAccount({ remainingFreeRFQs: 0 }));
    mockExtraction();
    const create = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-v0', rfqNumber: 'RFQ-V0-1' });

    const result = await emailGatewayService.processMessage(raw(), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ sourcingMode: 'mode_0' }),
      expect.anything()
    );
  });

  test('an email needing more RFQs than the credits left is refused as a whole', async () => {
    storeService.getBuyerAccountByEmail.mockReturnValue(buyerAccount({ remainingFreeRFQs: 1 }));
    mockExtraction();
    jest.spyOn(emailGatewayService, 'processLineItemsAndGroups').mockReturnValue(twoGroups());
    const create = jest.spyOn(storeService, 'createRFQ');

    const result = await emailGatewayService.processMessage(raw(), config());

    expect(result.status).toBe(INGESTION_OUTCOME.RFQ_CREDITS_EXHAUSTED);
    expect(create).not.toHaveBeenCalled();
  });

  test('a paid plan is never limited by free credits', async () => {
    storeService.getBuyerAccountByEmail.mockReturnValue(buyerAccount({ subscriptionPlan: 'version_2', remainingFreeRFQs: 0 }));
    mockExtraction();
    jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-paid', rfqNumber: 'RFQ-PAID-1' });

    const result = await emailGatewayService.processMessage(raw(), config());
    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
  });

  test('checkRfqCredits: V0, paid, missing account and default credits', () => {
    const { checkRfqCredits } = emailGatewayService;
    expect(checkRfqCredits(null, 'mode_2', 1)).toEqual({ ok: true, applies: false });
    expect(checkRfqCredits({}, 'mode_2', 1)).toEqual({ ok: true, applies: false });
    expect(checkRfqCredits({ id: 'b', remainingFreeRFQs: 0 }, 'mode_0', 3)).toEqual({ ok: true, applies: false });
    expect(checkRfqCredits({ id: 'b', remainingFreeRFQs: 0 }, 'v0', 1).ok).toBe(true);
    expect(checkRfqCredits({ id: 'b', remainingFreeRFQs: 0 }, 'version_0', 1).ok).toBe(true);
    expect(checkRfqCredits({ id: 'b', subscriptionPlan: 'version_1', remainingFreeRFQs: 0 }, 'mode_1', 1).ok).toBe(true);
    expect(checkRfqCredits({ id: 'b', subscriptionPlan: 'version_3' }, 'mode_3', 9).ok).toBe(true);
    expect(checkRfqCredits({ id: 'b' }, 'mode_2', 5)).toEqual({ ok: true, applies: true, remaining: 5, needed: 5 });
    expect(checkRfqCredits({ id: 'b' }, 'mode_2', 6).ok).toBe(false);
  });
});

describe('documents attached to the email are stored on the RFQ', () => {
  const withAttachments = () => Buffer.from(fixtures.multipartWithAttachments(), 'utf8');

  test('each stored file is attached to the RFQ', async () => {
    mockExtraction();
    const save = jest.spyOn(rfqAttachmentService, 'saveAttachment').mockImplementation(async ({ fileName, mimeType }) => ({
      status: rfqAttachmentService.ATTACHMENT_STATUS.SAVED,
      attachment: { id: `att-${fileName}`, fileName, mimeType },
    }));
    const create = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-a', rfqNumber: 'RFQ-A' });

    await emailGatewayService.processMessage(withAttachments(), config());

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'requisition.pdf', mimeType: 'application/pdf', content: expect.any(String) })
    );
    expect(create.mock.calls[0][0].attachments.map((a) => a.fileName)).toEqual(
      expect.arrayContaining(['requisition.pdf', 'boq.xlsx'])
    );
  });

  test('a file that cannot be stored is left off and the RFQ is still raised', async () => {
    mockExtraction();
    jest
      .spyOn(rfqAttachmentService, 'saveAttachment')
      .mockResolvedValueOnce({ status: rfqAttachmentService.ATTACHMENT_STATUS.TOO_LARGE, attachment: null })
      .mockRejectedValueOnce(new Error('R2 down'));
    const create = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-b', rfqNumber: 'RFQ-B' });

    const result = await emailGatewayService.processMessage(withAttachments(), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(create.mock.calls[0][0].attachments).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not stored on the RFQ'), expect.any(Object), 'EMAIL_GATEWAY');
  });

  test('empty parts are skipped; buffers are base64-encoded and strings passed as-is', async () => {
    const save = jest
      .spyOn(rfqAttachmentService, 'saveAttachment')
      .mockResolvedValue({ status: rfqAttachmentService.ATTACHMENT_STATUS.SAVED, attachment: { id: 'x' } });
    const saved = await emailGatewayService.storeEmailAttachments({
      attachments: [
        { fileName: 'req.pdf', contentType: 'application/pdf', role: 'inline', content: Buffer.from('pdf') },
        { fileName: 'empty.pdf', contentType: 'application/pdf', role: 'manual', content: null },
        null,
        { fileName: 'spec.txt', contentType: 'text/plain', role: 'text', content: 'c3BlYw==' },
      ],
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith({ fileName: 'req.pdf', mimeType: 'application/pdf', content: Buffer.from('pdf').toString('base64') });
    expect(save).toHaveBeenCalledWith({ fileName: 'spec.txt', mimeType: 'text/plain', content: 'c3BlYw==' });
    expect(saved).toEqual([{ id: 'x' }, { id: 'x' }]);
    await expect(emailGatewayService.storeEmailAttachments(null)).resolves.toEqual([]);
  });

  test('attachments are uploaded once and shared by every RFQ the email raises', async () => {
    mockExtraction();
    jest.spyOn(emailGatewayService, 'processLineItemsAndGroups').mockReturnValue(twoGroups());
    const save = jest
      .spyOn(rfqAttachmentService, 'saveAttachment')
      .mockResolvedValue({ status: rfqAttachmentService.ATTACHMENT_STATUS.SAVED, attachment: { id: 'shared' } });
    let n = 0;
    const create = jest.spyOn(storeService, 'createRFQ').mockImplementation(() => {
      n += 1;
      return { id: `rfq-${n}`, rfqNumber: `RFQ-${n}` };
    });

    await emailGatewayService.processMessage(Buffer.from(fixtures.multipartWithAttachments({ includeWorkbook: false }), 'utf8'), config());

    expect(save).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].attachments).toEqual([{ id: 'shared' }]);
  });
});

describe('a retried email does not raise the same RFQ twice', () => {
  test('each created RFQ is recorded against the email', async () => {
    mockExtraction();
    jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-1', rfqNumber: 'RFQ-2026-0001' });

    await emailGatewayService.processMessage(raw(), config());

    expect(emailGatewayQueries.findProcessed).toHaveBeenCalledWith(`${MESSAGE_ID}#rfq-0`);
    expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: `${MESSAGE_ID}#rfq-0`,
        status: INGESTION_OUTCOME.RFQ_GROUP_CREATED,
        rfqId: 'rfq-1',
        rfqNumber: 'RFQ-2026-0001',
        fromAddress: SENDER,
      })
    );
  });

  test('an RFQ already raised on an earlier attempt is reused, not recreated, charged or re-acknowledged', async () => {
    mockExtraction();
    jest.spyOn(emailGatewayService, 'processLineItemsAndGroups').mockReturnValue(twoGroups());
    emailGatewayQueries.findProcessed.mockImplementation(async (key) =>
      key.endsWith('#rfq-0') ? { message_id: key, rfq_id: 'rfq-old', rfq_number: 'RFQ-OLD-1' } : null
    );
    const create = jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-new', rfqNumber: 'RFQ-NEW-2' });

    const result = await emailGatewayService.processMessage(raw(), config());

    expect(create).toHaveBeenCalledTimes(1);
    expect(storeService.consumeRFQCreditIfApplicable).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ rfqNumber: 'RFQ-NEW-2' }));
    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(result.rfqs.map((r) => r.rfqNumber)).toEqual(['RFQ-OLD-1', 'RFQ-NEW-2']);
  });

  test('without a Message-ID there is nothing to key on, so no lookup is made', async () => {
    mockExtraction();
    jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-x', rfqNumber: 'RFQ-X' });
    const noId = fixtures.PLAIN_REQUISITION_EML.replace(/^Message-ID: .*\r\n/m, '');

    const result = await emailGatewayService.processMessage(Buffer.from(noId, 'utf8'), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(emailGatewayQueries.findProcessed).not.toHaveBeenCalled();
  });
});

describe('emailGatewayQueries.findProcessed', () => {
  beforeEach(() => emailGatewayQueries.findProcessed.mockRestore());

  test('returns null without a key or without any store', async () => {
    await expect(emailGatewayQueries.findProcessed('')).resolves.toBeNull();
    jest.spyOn(dbPool, 'hasStorage').mockReturnValue(false);
    await expect(emailGatewayQueries.findProcessed('<a@b>#rfq-0')).resolves.toBeNull();
  });

  test('returns the recorded row, or null when there is none', async () => {
    jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    const rows = jest.spyOn(dbPool, 'rows').mockResolvedValueOnce([{ rfq_id: 'r1', rfq_number: 'N1' }]).mockResolvedValueOnce([]);
    await expect(emailGatewayQueries.findProcessed('<a@b>#rfq-0')).resolves.toEqual({ rfq_id: 'r1', rfq_number: 'N1' });
    await expect(emailGatewayQueries.findProcessed('<a@b>#rfq-1')).resolves.toBeNull();
    expect(rows).toHaveBeenCalledWith(expect.stringContaining('email_ingestion_log'), ['<a@b>#rfq-0'], { d1: true });
  });

  test('a ledger error is thrown, never guessed as "not there"', async () => {
    jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(dbPool, 'rows').mockRejectedValue(new Error('D1 unavailable'));
    await expect(emailGatewayQueries.findProcessed('<a@b>#rfq-0')).rejects.toThrow('D1 unavailable');
  });
});

describe('mailerService RFQ-not-created notice', () => {
  beforeEach(() => notice.mockRestore());

  test('builds a notice for each reason, escaping what the buyer wrote', () => {
    const tooMany = mailerService.buildRfqNotCreatedEmail({
      to: SENDER,
      buyerName: 'Asha <Ops>',
      reason: 'TOO_MANY_LINE_ITEMS',
      originalSubject: 'Pumps & <valves>',
      count: 60,
      max: 49,
    });
    expect(tooMany.subject).toBe(RFQ_NOT_CREATED_NOTIFICATION.SUBJECT);
    expect(tooMany.html).toContain('60 line items');
    expect(tooMany.html).toContain('at most 49');
    expect(tooMany.html).toContain('Asha &lt;Ops&gt;');
    expect(tooMany.html).toContain('Pumps &amp; &lt;valves&gt;');
    expect(tooMany.text).toContain('"Pumps & <valves>"');

    for (const reason of ['NO_LINE_ITEMS', 'CREDITS_EXHAUSTED', 'PROCESSING_FAILED']) {
      const built = mailerService.buildRfqNotCreatedEmail({ to: SENDER, reason });
      expect(built.text).toContain(RFQ_NOT_CREATED_NOTIFICATION.REASONS[reason]);
      expect(built.text).toContain('Hi Valued Buyer');
    }
  });

  test('an unknown reason falls back to the processing-failed wording', () => {
    const built = mailerService.buildRfqNotCreatedEmail({ to: SENDER, reason: 'SOMETHING_ELSE' });
    expect(built.text).toContain(RFQ_NOT_CREATED_NOTIFICATION.REASONS.PROCESSING_FAILED);
  });

  test('is sent as an auto-reply, and refuses a missing recipient', async () => {
    await expect(mailerService.sendRfqNotCreatedEmail({})).resolves.toEqual({ sent: false, reason: 'missing recipient email' });
    await expect(mailerService.sendRfqNotCreatedEmail()).resolves.toEqual({ sent: false, reason: 'missing recipient email' });
  });
});

describe('a poll stops starting new messages once its time budget is spent', () => {
  test('the second message is left unread for the next poll', async () => {
    jest.spyOn(mailerService, 'getGmailOAuthClient').mockReturnValue({});
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    const list = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'slow1' }, { id: 'slow2' }] } });
    const get = jest.fn().mockResolvedValue({ data: { raw: raw().toString('base64url') } });
    const modify = jest.fn().mockResolvedValue({});
    jest.spyOn(googleapis.google, 'gmail').mockReturnValue({ users: { messages: { list, get, modify } } });

    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(emailGatewayService, 'processMessage').mockImplementation(async () => {
      now += emailGatewayService.POLL_WORK_BUDGET_MS + 1;
      return { status: INGESTION_OUTCOME.NO_LINE_ITEMS, detail: 'x', message: { messageId: '<slow1@x>' } };
    });

    const result = await emailGatewayService.pollViaGmailApi(config());

    expect(emailGatewayService.processMessage).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.outcomes.map((o) => o.uid)).toEqual(['slow1']);
  });
});

describe('vendor unlock and credit queries have a SQLite spelling for D1', () => {
  const domainQueries = require('../src/db/domainQueries');

  beforeEach(() => jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true));

  test('unlockRFQInDB', async () => {
    const query = jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [{ id: 'u1' }] });
    await expect(domainQueries.unlockRFQInDB({ id: 'u1', vendorId: 'v1', rfqId: 'r1' })).resolves.toEqual({ id: 'u1' });
    const options = query.mock.calls[0][2];
    expect(options.d1).toBe(true);
    expect(options.d1Text).toContain('CURRENT_TIMESTAMP');
    expect(options.d1Text).not.toContain('now()');
  });

  test('recordCreditTransactionInDB', async () => {
    const query = jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [] });
    await expect(
      domainQueries.recordCreditTransactionInDB({ id: 't1', vendorId: 'v1', transactionType: 'DEBIT', amount: 1, balanceAfter: 4 })
    ).resolves.toBeUndefined();
    const options = query.mock.calls[0][2];
    expect(options.d1Text).toContain('CURRENT_TIMESTAMP');
    expect(options.d1Text).not.toContain('now()');
    expect(query.mock.calls[0][1]).toEqual(['t1', 'v1', null, 'DEBIT', 1, 4, null]);
  });
});

describe('acknowledgements that could not be sent are retried later', () => {
  const cooling = () => Object.assign(new Error('Every mail provider is cooling down'), { code: 'MAIL_PROVIDERS_COOLING_DOWN' });

  test('a failed acknowledgement is queued against the RFQ', async () => {
    mockExtraction();
    jest.spyOn(storeService, 'createRFQ').mockReturnValue({ id: 'rfq-q', rfqNumber: 'RFQ-Q', title: 'Pumps' });
    ack.mockRejectedValue(cooling());

    const result = await emailGatewayService.processMessage(raw(), config());

    expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: `${MESSAGE_ID}#rfq-0#ack`,
        status: INGESTION_OUTCOME.ACK_PENDING,
        fromAddress: SENDER,
        rfqNumber: 'RFQ-Q',
        subject: 'Pumps',
        detail: JSON.stringify({ buyerName: 'L&T Heavy Engineering', rfqTitle: 'Pumps' }),
      })
    );
  });

  test('without a Message-ID it is keyed on the RFQ id; with no key nothing is queued', async () => {
    await emailGatewayService.queueAcknowledgement('rfq-77', { to: SENDER, rfqNumber: 'N', rfqTitle: 'T', buyerName: 'B' });
    expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'rfq-77#ack' }));
    emailGatewayQueries.recordProcessed.mockClear();
    await emailGatewayService.queueAcknowledgement(null, { to: SENDER });
    expect(emailGatewayQueries.recordProcessed).not.toHaveBeenCalled();
  });

  describe('retryPendingAcknowledgements', () => {
    const NOW = Date.parse('2026-10-14T17:00:00Z');
    const row = (overrides = {}) => ({
      message_id: '<m@x>#rfq-0#ack',
      rfq_number: 'RFQ-1',
      from_address: SENDER,
      subject: 'Pumps',
      detail: JSON.stringify({ buyerName: 'Asha', rfqTitle: 'Pumps' }),
      processed_at: '2026-10-14 16:50:00',
      ...overrides,
    });

    test('sends a pending acknowledgement and marks it sent', async () => {
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValue([row()]);
      const outcome = await emailGatewayService.retryPendingAcknowledgements({ now: NOW });
      expect(ack).toHaveBeenCalledWith({ to: SENDER, buyerName: 'Asha', rfqNumber: 'RFQ-1', rfqTitle: 'Pumps' });
      expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: '<m@x>#rfq-0#ack', status: INGESTION_OUTCOME.ACK_SENT })
      );
      expect(outcome).toEqual({ sent: 1, abandoned: 0, stillPending: 0 });
    });

    test('drops one older than 48 hours, or with no recipient or readable time', async () => {
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValue([
        row({ processed_at: '2026-10-12 10:00:00' }),
        row({ from_address: null }),
        row({ processed_at: 'not a date' }),
      ]);
      const outcome = await emailGatewayService.retryPendingAcknowledgements({ now: NOW });
      expect(ack).not.toHaveBeenCalled();
      expect(outcome.abandoned).toBe(3);
      expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ status: INGESTION_OUTCOME.ACK_ABANDONED })
      );
    });

    test('stops when every provider is cooling down, carries on past other failures', async () => {
      jest
        .spyOn(emailGatewayQueries, 'listByStatus')
        .mockResolvedValue([row(), row({ message_id: 'b#ack' }), row({ message_id: 'c#ack' })]);
      ack.mockRejectedValueOnce(new Error('one provider hiccup')).mockRejectedValueOnce(cooling());
      const outcome = await emailGatewayService.retryPendingAcknowledgements({ now: NOW });
      expect(ack).toHaveBeenCalledTimes(2);
      expect(outcome).toEqual({ sent: 0, abandoned: 0, stillPending: 2 });
      expect(emailGatewayQueries.recordProcessed).not.toHaveBeenCalled();
    });

    test('tolerates unreadable saved details and Date / ISO timestamps', async () => {
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValue([
        row({ detail: '{not json', processed_at: new Date(NOW - 60000) }),
        row({ detail: null, processed_at: '2026-10-14T16:59:00Z' }),
      ]);
      const outcome = await emailGatewayService.retryPendingAcknowledgements({ now: NOW });
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ rfqTitle: 'Pumps', buyerName: undefined }));
      expect(outcome.sent).toBe(2);
    });

    test('nothing pending', async () => {
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValue([]);
      await expect(emailGatewayService.retryPendingAcknowledgements()).resolves.toEqual({ sent: 0, abandoned: 0, stillPending: 0 });
    });
  });

  describe('the buyer poll retries pending acknowledgements', () => {
    beforeEach(() => {
      jest.spyOn(mailerService, 'getGmailOAuthClient').mockReturnValue({});
      const list = jest.fn().mockResolvedValue({ data: { messages: [] } });
      jest.spyOn(googleapis.google, 'gmail').mockReturnValue({ users: { messages: { list, get: jest.fn(), modify: jest.fn() } } });
    });

    test('on the buyer inbox', async () => {
      const retry = jest
        .spyOn(emailGatewayService, 'retryPendingAcknowledgements')
        .mockResolvedValue({ sent: 1, abandoned: 0, stillPending: 0 });
      const result = await emailGatewayService.pollViaGmailApi(config());
      expect(retry).toHaveBeenCalledTimes(1);
      expect(result.acknowledgements).toEqual({ sent: 1, abandoned: 0, stillPending: 0 });
    });

    test('not on the vendor inbox', async () => {
      const retry = jest.spyOn(emailGatewayService, 'retryPendingAcknowledgements');
      await emailGatewayService.pollViaGmailApi({ ...config(), isVendorMailbox: true });
      expect(retry).not.toHaveBeenCalled();
    });

    test('a retry failure never breaks the poll', async () => {
      jest.spyOn(emailGatewayService, 'retryPendingAcknowledgements').mockRejectedValue(new Error('boom'));
      const result = await emailGatewayService.pollViaGmailApi(config());
      expect(result.skipped).toBe(false);
      expect(result.acknowledgements).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Retrying pending RFQ acknowledgements failed', expect.any(Error), 'EMAIL_GATEWAY');
    });
  });
});

describe('emailGatewayQueries.listByStatus', () => {
  test('rows oldest first and capped; empty without a status, a store, or on error', async () => {
    await expect(emailGatewayQueries.listByStatus('')).resolves.toEqual([]);
    jest.spyOn(dbPool, 'hasStorage').mockReturnValue(false);
    await expect(emailGatewayQueries.listByStatus('ACK_PENDING')).resolves.toEqual([]);

    dbPool.hasStorage.mockReturnValue(true);
    const rows = jest.spyOn(dbPool, 'rows').mockResolvedValueOnce([{ message_id: 'a' }]).mockRejectedValueOnce(new Error('down'));
    await expect(emailGatewayQueries.listByStatus('ACK_PENDING', 500)).resolves.toEqual([{ message_id: 'a' }]);
    expect(rows).toHaveBeenCalledWith(expect.stringContaining('order by processed_at asc'), ['ACK_PENDING', 50], { d1: true });
    await expect(emailGatewayQueries.listByStatus('ACK_PENDING', 0)).resolves.toEqual([]);
  });
});
