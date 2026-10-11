const mailerService = require('../src/services/mailerService');

describe('mailerService', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.VENDOR_SMTP_USER;
    delete process.env.VENDOR_SMTP_PASSWORD;
  });

  test('sendOtpEmail no-ops during test environment (NODE_ENV=test)', async () => {
    const res = await mailerService.sendOtpEmail('someone@example.com', '1234', 600);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('test environment');
  });


  test('sendOtpEmail no-ops when SMTP is not configured', async () => {
    let freshMailerService;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendOtpEmail('someone@example.com', '1234', 600);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('SMTP not configured');

    process.env.NODE_ENV = 'test';
  });

  test('sendOtpEmail sends via the configured transporter, caching it across calls, with correct minute pluralization', async () => {
    let freshMailerService;
    let capturedMail;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASSWORD = 'app-password';
      jest.doMock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          sendMail: jest.fn((mail) => {
            capturedMail = mail;
            return Promise.resolve({ messageId: 'mock-message-id' });
          }),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendOtpEmail('someone@example.com', '9999', 10);
    expect(res.sent).toBe(true);
    expect(res.messageId).toBe('mock-message-id');
    expect(capturedMail.to).toBe('someone@example.com');
    expect(capturedMail.html).toContain('9999');
    expect(capturedMail.html).toContain('1 minute.');

    // Second call reuses the cached transporter (getTransporter's early-return branch)
    await freshMailerService.sendOtpEmail('someone@example.com', '1111', 120);
    expect(capturedMail.html).toContain('2 minutes.');

    // With no expiry argument at all the window defaults to 10 minutes.
    await freshMailerService.sendOtpEmail('someone@example.com', '2222');
    expect(capturedMail.html).toContain('10 minutes.');

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  test('sendOtpEmail propagates a real send failure to the caller', async () => {
    let freshMailerService;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASSWORD = 'app-password';
      jest.doMock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          sendMail: jest.fn().mockRejectedValue(new Error('SMTP connection refused')),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    await expect(freshMailerService.sendOtpEmail('someone@example.com', '1234', 600)).rejects.toThrow(
      'SMTP connection refused'
    );

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  describe('Gmail API delivery (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN)', () => {
    afterEach(() => {
      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
      delete process.env.GMAIL_REFRESH_TOKEN;
      delete process.env.GMAIL_SENDER_EMAIL;
      process.env.NODE_ENV = 'test';
    });

    test('sendOtpEmail sends via the Gmail API when configured, taking priority over SMTP/Resend', async () => {
      let freshMailerService;
      let capturedRequestBody;
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.GMAIL_CLIENT_ID = 'test-client-id';
        process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
        process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
        process.env.GMAIL_SENDER_EMAIL = 'sender@example.com';
        // Also set SMTP/Resend to prove Gmail API wins the priority order.
        process.env.SMTP_USER = 'should-not-be-used@example.com';
        process.env.SMTP_PASSWORD = 'app-password';
        jest.doMock('googleapis', () => ({
          google: {
            auth: {
              OAuth2: jest.fn().mockImplementation(() => ({
                setCredentials: jest.fn(),
              })),
            },
            gmail: jest.fn(() => ({
              users: {
                messages: {
                  send: jest.fn(({ requestBody }) => {
                    capturedRequestBody = requestBody;
                    return Promise.resolve({ data: { id: 'gmail-msg-id' } });
                  }),
                },
              },
            })),
          },
        }));
        freshMailerService = require('../src/services/mailerService');
      });

      const res = await freshMailerService.sendOtpEmail('someone@example.com', '4321', 60);
      expect(res.sent).toBe(true);
      expect(res.messageId).toBe('gmail-msg-id');

      const decoded = Buffer.from(capturedRequestBody.raw, 'base64url').toString('utf8');
      expect(decoded).toContain('To: someone@example.com');
      expect(decoded).toContain('From: "Procucev Enterprise" <sender@example.com>');
      expect(decoded).toContain('4321');

      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
    });

    test('propagates a Gmail API send failure to the caller', async () => {
      let freshMailerService;
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.GMAIL_CLIENT_ID = 'test-client-id';
        process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
        process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
        jest.doMock('googleapis', () => ({
          google: {
            auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
            gmail: jest.fn(() => ({
              users: { messages: { send: jest.fn().mockRejectedValue(new Error('Gmail API quota exceeded')) } },
            })),
          },
        }));
        freshMailerService = require('../src/services/mailerService');
      });

      await expect(freshMailerService.sendOtpEmail('someone@example.com', '1234', 600)).rejects.toThrow(
        'Gmail API quota exceeded'
      );
    });

    test('isConfigured reports true when only the Gmail API is configured', () => {
      let freshMailerService;
      jest.isolateModules(() => {
        process.env.GMAIL_CLIENT_ID = 'test-client-id';
        process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
        process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
        freshMailerService = require('../src/services/mailerService');
      });
      expect(freshMailerService.isGmailApiConfigured()).toBe(true);
      expect(freshMailerService.isConfigured()).toBe(true);
    });

    // Regression coverage for the real bug this fixed: no VENDOR_SMTP_*/
    // VENDOR_EMAIL_GATEWAY_* mailbox has ever been configured, so every
    // vendor onboarding/invite/quote email was silently no-op'ing even
    // before the Gmail API existed — deliverVendor must fall back to it
    // rather than continuing to drop the email.
    test('deliverVendor falls back to the Gmail API when no vendor mailbox is configured', async () => {
      let freshMailerService;
      let capturedRequestBody;
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        delete process.env.VENDOR_SMTP_USER;
        delete process.env.VENDOR_SMTP_PASSWORD;
        process.env.GMAIL_CLIENT_ID = 'test-client-id';
        process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
        process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
        jest.doMock('googleapis', () => ({
          google: {
            auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
            gmail: jest.fn(() => ({
              users: {
                messages: {
                  send: jest.fn(({ requestBody }) => {
                    capturedRequestBody = requestBody;
                    return Promise.resolve({ data: { id: 'gmail-vendor-msg-id' } });
                  }),
                },
              },
            })),
          },
        }));
        freshMailerService = require('../src/services/mailerService');
      });

      const res = await freshMailerService.sendRfqInviteEmail('vendor@example.com', {
        rfq: { rfqNumber: 'RFQ-1', title: 'T' },
        recipientName: 'Vendor',
      });

      expect(res).toEqual({ sent: true, messageId: 'gmail-vendor-msg-id' });
      const decoded = Buffer.from(capturedRequestBody.raw, 'base64url').toString('utf8');
      expect(decoded).toContain('To: vendor@example.com');

      process.env.NODE_ENV = 'test';
    });
  });

  describe('buildRfqInviteEmail', () => {
    const RFQ = {
      rfqNumber: 'RFQ-2026-00500',
      title: 'Centrifugal Pumps',
      category: 'Pumps & Accessories',
      buyerAccountName: 'Acme Buyer Co',
      targetDeliveryDate: '2026-12-01',
      deliveryLocation: 'Navi Mumbai Plant',
      extractedEntities: [{ itemName: 'Pump 500 GPM', quantity: 2, unit: 'Units' }],
    };

    test('renders only real fields and names the RFQ in the subject', () => {
      const msg = mailerService.buildRfqInviteEmail('v@x.com', { rfq: RFQ, recipientName: 'Priya' });
      expect(msg.to).toBe('v@x.com');
      expect(msg.subject).toBe('New RFQ RFQ-2026-00500 in Pumps & Accessories');
      expect(msg.html).toContain('Dear <strong>Priya</strong>');
      expect(msg.html).toContain('Acme Buyer Co');
      expect(msg.html).toContain('Centrifugal Pumps');
      expect(msg.html).toContain('Pump 500 GPM');
      expect(msg.html).toContain('Navi Mumbai Plant');
    });

    test('labels follow-up mail as an RFQ reminder', () => {
      const msg = mailerService.buildRfqInviteEmail('v@x.com', { rfq: RFQ, isReminder: true });
      expect(msg.subject).toBe('Reminder: RFQ RFQ-2026-00500 in Pumps & Accessories');
      expect(msg.html).toContain('RFQ Reminder');
      expect(msg.html).toContain('This is a reminder to submit your quotation');
    });

    test('omits rows and the greeting name when the data is not there — never invents them', () => {
      const bare = {
        rfqNumber: 'RFQ-2026-00777',
        title: 'Untitled enquiry',
        // A line item with nothing filled in still renders without inventing values.
        extractedEntities: [{}],
      };
      const msg = mailerService.buildRfqInviteEmail('v@x.com', { rfq: bare, recipientName: '' });
      expect(msg.html).toContain('1. Line item');
      expect(msg.subject).toBe('New RFQ RFQ-2026-00777');
      expect(msg.html).toContain('Hello,');
      expect(msg.html).not.toContain('Category');
      expect(msg.html).not.toContain('Target delivery');
      // No fabricated fallback address / date / category anywhere.
      expect(msg.html).not.toContain('partner@enterprise.com');
      expect(msg.html).not.toContain('2026-09-15');
    });
  });

  describe('buildQuoteReceivedEmail', () => {
    const RFQ = { rfqNumber: 'RFQ-2026-00500', title: 'Centrifugal Pumps' };

    test('summarises the quote with only the fields the vendor supplied', () => {
      const msg = mailerService.buildQuoteReceivedEmail('buyer@x.com', {
        rfq: RFQ,
        quote: { vendorName: 'Pumps R Us', unitPrice: 5200, totalPrice: 10400, leadTimeDays: 15, paymentTerms: 'Net 30' },
        recipientName: 'Acme Buyer Co',
      });
      expect(msg.subject).toBe('New quote on RFQ-2026-00500 from Pumps R Us');
      expect(msg.html).toContain('Pumps R Us');
      expect(msg.html).toContain('5200');
      expect(msg.html).toContain('Net 30');
      expect(msg.html).not.toContain('Warranty');
    });

    test('falls back to neutral wording and omits every unset figure', () => {
      const msg = mailerService.buildQuoteReceivedEmail('buyer@x.com', {
        rfq: RFQ,
        quote: {},
        recipientName: '',
      });
      expect(msg.subject).toBe('New quote on RFQ-2026-00500');
      expect(msg.html).toContain('A vendor has');
      expect(msg.html).toContain('Hello,');
      expect(msg.html).not.toContain('Unit price');
      expect(msg.html).not.toContain('Lead time');
    });
  });

  describe('sendRfqInviteEmail / sendQuoteReceivedEmail', () => {
    const ctxRfq = { rfq: { rfqNumber: 'RFQ-1', title: 'T' }, recipientName: 'R' };
    const ctxQuote = { rfq: { rfqNumber: 'RFQ-1', title: 'T' }, quote: { unitPrice: 1 }, recipientName: 'R' };

    test('both no-op under the test environment', async () => {
      expect(await mailerService.sendRfqInviteEmail('v@x.com', ctxRfq)).toEqual({
        sent: false,
        reason: 'test environment',
      });
      expect(await mailerService.sendQuoteReceivedEmail('b@x.com', ctxQuote)).toEqual({
        sent: false,
        reason: 'test environment',
      });
    });

    test('no-op when SMTP is unconfigured, and send + propagate failure when configured', async () => {
      let fresh;
      let captured = [];
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASSWORD;
        delete process.env.VENDOR_SMTP_USER;
        delete process.env.VENDOR_SMTP_PASSWORD;
        fresh = require('../src/services/mailerService');
      });
      expect(await fresh.sendRfqInviteEmail('v@x.com', ctxRfq)).toMatchObject({ sent: false, reason: 'SMTP not configured' });

      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.SMTP_USER = 'test@example.com';
        process.env.SMTP_PASSWORD = 'pw';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn(() => ({
            sendMail: jest.fn((m) => {
              captured.push(m);
              return Promise.resolve({ messageId: 'id-1' });
            }),
          })),
        }));
        fresh = require('../src/services/mailerService');
      });
      expect(await fresh.sendQuoteReceivedEmail('b@x.com', ctxQuote)).toEqual({ sent: true, messageId: 'id-1' });
      expect(captured[0].to).toBe('b@x.com');

      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.VENDOR_SMTP_USER = 'vendor-test@example.com';
        process.env.VENDOR_SMTP_PASSWORD = 'pw';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn(() => ({ sendMail: jest.fn().mockRejectedValue(new Error('smtp down')) })),
        }));
        fresh = require('../src/services/mailerService');
      });
      try {
        await expect(fresh.sendRfqInviteEmail('v@x.com', ctxRfq)).rejects.toThrow('smtp down');
      } finally {
        delete process.env.VENDOR_SMTP_USER;
        delete process.env.VENDOR_SMTP_PASSWORD;
        process.env.NODE_ENV = 'test';
      }
    });
  });

  describe('buildQuoteAcknowledgementEmail / sendQuoteAcknowledgementEmail', () => {
    test('builds full acknowledgement email with all quote fields and cc', () => {
      const msg = mailerService.buildQuoteAcknowledgementEmail('vendor@example.com', {
        rfqNumber: 'RFQ-2026-00100',
        rfqTitle: 'Pumps Procurement',
        vendorName: 'Apex Supplies',
        quote: {
          unitPrice: 5000,
          totalPrice: 10000,
          leadTimeDays: 14,
          warrantyYears: 2,
          paymentTerms: 'Net 30',
          remarks: 'Valid for 30 days',
        },
        cc: 'buyer@example.com, support@procucev.com',
      });

      expect(msg.to).toBe('vendor@example.com');
      expect(msg.cc).toBe('buyer@example.com, support@procucev.com');
      expect(msg.subject).toBe('Quotation Received – RFQ RFQ-2026-00100');
      expect(msg.html).toContain('Dear <strong>Apex Supplies</strong>');
      expect(msg.html).toContain('₹5000');
      expect(msg.html).toContain('₹10000');
      expect(msg.html).toContain('14 days');
      expect(msg.html).toContain('2 year(s)');
      expect(msg.html).toContain('Net 30');
      expect(msg.html).toContain('Valid for 30 days');
    });

    test('builds bare acknowledgement email and supports object parameter signature', async () => {
      const msg = mailerService.buildQuoteAcknowledgementEmail({
        to: 'vendor@example.com',
        rfqNumber: 'RFQ-2026-00100',
      });
      expect(msg.html).toContain('Hello,');
      expect(msg.cc).toBeUndefined();

      const res = await mailerService.sendQuoteAcknowledgementEmail('vendor@example.com', {
        rfqNumber: 'RFQ-2026-00100',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });
  });

  describe('buildQuoteFailureEmail / sendQuoteFailureEmail', () => {
    test('builds full failure email with reason, missing fields, and cc', () => {
      const msg = mailerService.buildQuoteFailureEmail('vendor@example.com', {
        rfqNumber: 'RFQ-2026-00100',
        rfqTitle: 'Pumps Procurement',
        vendorName: 'Apex Supplies',
        reason: 'Unit price must be > 0',
        missingFields: ['Unit Price (₹)'],
        cc: 'buyer@example.com',
      });

      expect(msg.to).toBe('vendor@example.com');
      expect(msg.cc).toBe('buyer@example.com');
      expect(msg.subject).toBe('Action Required – Quotation Could Not Be Processed for RFQ RFQ-2026-00100');
      expect(msg.html).toContain('Unit price must be > 0');
      expect(msg.html).toContain('Unit Price (₹)*');
    });

    test('builds bare failure email and supports object parameter signature', async () => {
      const msg = mailerService.buildQuoteFailureEmail({
        to: 'vendor@example.com',
        rfqNumber: 'RFQ-2026-00100',
      });
      expect(msg.html).toContain('Hello,');
      expect(msg.html).toContain('Incomplete quotation details');

      const res = await mailerService.sendQuoteFailureEmail({
        to: 'vendor@example.com',
        rfqNumber: 'RFQ-2026-00100',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });
  });

  describe('buildRfqFinalComparisonEmail / sendRfqFinalComparisonEmail', () => {
    test('builds final comparison email with quotes matrix and recipient', async () => {
      const email = mailerService.buildRfqFinalComparisonEmail('buyer@example.com', {
        rfq: { rfqNumber: 'RFQ260409000900', title: 'Industrial Valves', category: 'Valves' },
        quotes: [
          { vendorName: 'Vendor A', unitPrice: 5000, leadTimeDays: 10, warrantyYears: 2, aiMatchScore: 92, complianceStatus: 'Compliant' },
          { vendorName: 'Vendor B', unitPrice: 4500, leadTimeDays: 12, warrantyYears: 1, aiMatchScore: 88, complianceStatus: 'Compliant' },
        ],
        recipientName: 'Acme Buyer',
      });

      expect(email.to).toBe('buyer@example.com');
      expect(email.subject).toContain('RFQ260409000900');
      expect(email.html).toContain('Acme Buyer');
      expect(email.html).toContain('Vendor B');
      expect(email.html).toContain('Lowest Bid (L1)');
      expect(email.html).toContain('₹4,500');

      const res = await mailerService.sendRfqFinalComparisonEmail('buyer@example.com', {
        rfq: { rfqNumber: 'RFQ260409000900' },
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('builds final comparison email with no quotes received fallback', () => {
      const email = mailerService.buildRfqFinalComparisonEmail('buyer@example.com', {
        rfq: { rfqNumber: 'RFQ260409000900', title: 'Industrial Valves' },
        quotes: [],
      });
      expect(email.html).toContain('No vendor quotations were submitted');
    });
  });

  describe('buildRfqAutoClosureAcknowledgementEmail / sendRfqAutoClosureAcknowledgementEmail', () => {
    test('builds the auto-closure acknowledgement email with RFQ details and recipient', async () => {
      const email = mailerService.buildRfqAutoClosureAcknowledgementEmail('buyer@example.com', {
        rfq: {
          rfqNumber: 'RFQ260409000901',
          title: 'Industrial Pumps',
          category: 'Pumps',
          deliveryLocation: 'Mumbai',
        },
        quotesCount: 3,
        recipientName: 'Acme Buyer',
      });

      expect(email.from).toBeDefined();
      expect(email.to).toBe('buyer@example.com');
      expect(email.subject).toContain('RFQ260409000901');
      expect(email.subject).toContain('Automatically Closed');
      expect(email.html).toContain('Acme Buyer');
      expect(email.html).toContain('Industrial Pumps');
      expect(email.html).toContain('3 vendor(s)');
      // Button links to the RFQ status in the buyer portal.
      expect(email.html).toContain('/buyer/rfq-details?rfq=RFQ260409000901');

      const res = await mailerService.sendRfqAutoClosureAcknowledgementEmail('buyer@example.com', {
        rfq: { rfqNumber: 'RFQ260409000901' },
        quotesCount: 3,
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('falls back to generic greeting and default RFQ fields when optional context is absent', () => {
      const email = mailerService.buildRfqAutoClosureAcknowledgementEmail('buyer@example.com', {});
      expect(email.subject).toContain('RFQ');
      expect(email.html).toContain('Hello,');
      // Default placeholders for missing category / delivery location.
      expect(email.html).toContain('0 vendor(s)');
    });
  });

  describe('buildComplexRfqPortalRedirectEmail / sendComplexRfqPortalRedirectEmail', () => {
    test('builds the portal redirect email with the item count and vendor portal link', async () => {
      const email = mailerService.buildComplexRfqPortalRedirectEmail('vendor@example.com', {
        rfq: { rfqNumber: 'RFQ260409000902', title: 'Multi-Item Overhaul' },
        vendorName: 'Apex Supplies',
        itemCount: 11,
      });

      expect(email.from).toBeDefined();
      expect(email.to).toBe('vendor@example.com');
      expect(email.subject).toContain('RFQ260409000902');
      expect(email.subject).toContain('11 Items');
      expect(email.html).toContain('Apex Supplies');
      expect(email.html).toContain('11 Line Items');
      // Button links to the vendor quotation form for this opportunity.
      expect(email.html).toContain('/vendor/quotation-form?opportunity=RFQ260409000902');

      const res = await mailerService.sendComplexRfqPortalRedirectEmail('vendor@example.com', {
        rfq: { rfqNumber: 'RFQ260409000902' },
        vendorName: 'Apex Supplies',
        itemCount: 11,
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('falls back to generic greeting and default fields when optional context is absent', () => {
      const email = mailerService.buildComplexRfqPortalRedirectEmail('vendor@example.com', {});
      expect(email.subject).toContain('RFQ');
      expect(email.subject).toContain('0 Items');
      expect(email.html).toContain('Hello,');
    });
  });

  describe('buildVendorIssueAcknowledgementEmail / sendVendorIssueAcknowledgementEmail', () => {
    test('builds vendor issue acknowledgment email with buyer in CC and issue details', async () => {
      const email = mailerService.buildVendorIssueAcknowledgementEmail('vendor@example.com', {
        rfqNumber: 'RFQ260409000900',
        rfqTitle: 'Pumps Procurement',
        vendorName: 'Apex Supplies',
        issueMessage: 'Drawing missing for Item 2',
        cc: 'buyer@example.com',
      });

      expect(email.to).toBe('vendor@example.com');
      expect(email.cc).toBe('buyer@example.com');
      expect(email.subject).toContain('RFQ #RFQ260409000900');
      expect(email.html).toContain('Quotation Creation Failed');
      expect(email.html).toContain('Drawing missing for Item 2');

      const res = await mailerService.sendVendorIssueAcknowledgementEmail('vendor@example.com', {
        rfqNumber: 'RFQ260409000900',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });
  });

  describe('buildRfqInviteEmail expanded features', () => {
    test('renders technical specifications, budget, and multiple items note', () => {
      const rfqWithSpecs = {
        rfqNumber: 'RFQ-2026-00999',
        title: 'Industrial Valves',
        category: 'Valves',
        budget: 500000,
        extractedEntities: [
          { itemName: 'Gate Valve', quantity: 10, unit: 'pcs', technicalSpecs: 'DN100 PN16' },
          { itemName: 'Check Valve', quantity: 5, unit: 'pcs', specifications: 'DN50 PN16' },
        ],
      };
      const msg = mailerService.buildRfqInviteEmail('vendor@example.com', { rfq: rfqWithSpecs });
      expect(msg.html).toContain('DN100 PN16');
      expect(msg.html).toContain('DN50 PN16');
      expect(msg.html).toContain('₹5,00,000');
      expect(msg.html).toContain('How to Submit Your Quotation');
      expect(msg.html).toContain('For multi-item RFQs, please quote unit price per item');
      expect(msg.html).toContain('Open in Vendor Web Portal');
      expect(msg.html).toContain('Email Reply Format (Copy, Fill & Send)');
      expect(msg.replyTo).toBeTruthy();
    });

    test('supports fallback to items and single-item quotation reply format', () => {
      const rfqSingle = {
        rfqNumber: 'RFQ-2026-00101',
        title: 'Heavy Machinery Part',
        category: 'Machinery',
        items: [{ itemName: 'CNC Milling Bit', quantity: 1, unit: 'unit' }],
      };
      const msg = mailerService.buildRfqInviteEmail('vendor@example.com', { rfq: rfqSingle });
      expect(msg.html).toContain('CNC Milling Bit');
      expect(msg.html).toContain('Item: CNC Milling Bit');
      expect(msg.html).toContain('Unit Price: ₹[Enter Unit Price]');
    });

    test('supports empty items and defaults to gateway reply format', () => {
      const rfqEmpty = {
        rfqNumber: 'RFQ-2026-00102',
        title: 'General Enquiry',
      };
      const msg = mailerService.buildRfqInviteEmail('vendor@example.com', { rfq: rfqEmpty });
      expect(msg.html).toContain('Unit Price: ₹[Enter Unit Price]');
      expect(msg.html).toContain('Total Price: ₹[Enter Total Price]');
    });

    test('emailGatewayAddress returns default when unset or custom when set', () => {
      const original = process.env.EMAIL_GATEWAY_ADDRESS;
      delete process.env.EMAIL_GATEWAY_ADDRESS;
      delete process.env.EMAIL_GATEWAY_USER;
      expect(mailerService.emailGatewayAddress()).toBe('rfqprocucev@gmail.com');

      process.env.EMAIL_GATEWAY_ADDRESS = 'custom@procucev.com';
      expect(mailerService.emailGatewayAddress()).toBe('custom@procucev.com');

      if (original !== undefined) process.env.EMAIL_GATEWAY_ADDRESS = original;
      else delete process.env.EMAIL_GATEWAY_ADDRESS;
    });
  });


  test('isConfigured reflects whether both SMTP_USER and SMTP_PASSWORD are set', () => {
    const originalUser = process.env.SMTP_USER;
    const originalPass = process.env.SMTP_PASSWORD;

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    expect(mailerService.isConfigured()).toBe(false);

    process.env.SMTP_USER = 'test@example.com';
    delete process.env.SMTP_PASSWORD;
    expect(mailerService.isConfigured()).toBe(false);

    process.env.SMTP_USER = 'test@example.com';
    process.env.SMTP_PASSWORD = 'app-password';
    expect(mailerService.isConfigured()).toBe(true);

    if (originalUser === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = originalUser;
    if (originalPass === undefined) delete process.env.SMTP_PASSWORD;
    else process.env.SMTP_PASSWORD = originalPass;
  });

  test('sendRequisitionNotificationEmail no-ops during test environment (NODE_ENV=test)', async () => {
    const res = await mailerService.sendRequisitionNotificationEmail({
      to: 'target@example.com',
      rfqNumber: 'RFQ-2026-TEST',
      title: 'Industrial Motor',
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('test environment');
  });

  test('sendRequisitionNotificationEmail no-ops when SMTP is not configured', async () => {
    let freshMailerService;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendRequisitionNotificationEmail(
      'target@example.com',
      { rfqNumber: 'RFQ-2026-TEST' },
      'buyer@example.com'
    );
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('SMTP not configured');

    process.env.NODE_ENV = 'test';
  });

  test('sendRequisitionNotificationEmail sends email with line items, specs, and attachments', async () => {
    let freshMailerService;
    let capturedMail;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASSWORD = 'app-password';
      jest.doMock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          sendMail: jest.fn((mail) => {
            capturedMail = mail;
            return Promise.resolve({ messageId: 'req-msg-123' });
          }),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendRequisitionNotificationEmail(
      'navinchaudhary.dev@gmail.com',
      {
        rfqNumber: 'RFQ-2026-101',
        title: 'Stainless Steel Flanges',
        category: 'Piping',
        targetDeliveryDate: '2026-10-15',
        budget: 150000,
        description: 'Urgent line replacement items',
        extractedEntities: [
          { itemName: 'SS 316 Flange 4-inch', quantity: 20, unit: 'pcs', technicalSpecs: 'Class 150 ANSI' },
          { itemName: 'Gasket Ring', quantity: 40 },
        ],
      },
      'buyer@procucev.com'
    );

    expect(res.sent).toBe(true);
    expect(res.messageId).toBe('req-msg-123');
    expect(capturedMail.to).toBe('navinchaudhary.dev@gmail.com');
    expect(capturedMail.replyTo).toBe('buyer@procucev.com');
    expect(capturedMail.subject).toContain('RFQ-2026-101');
    expect(capturedMail.html).toContain('SS 316 Flange 4-inch');
    expect(capturedMail.html).toContain('Class 150 ANSI');

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  test('sendRequisitionNotificationEmail handles empty items and fallback values safely', async () => {
    let freshMailerService;
    let capturedMail;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASSWORD = 'app-password';
      jest.doMock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          sendMail: jest.fn((mail) => {
            capturedMail = mail;
            return Promise.resolve({ messageId: 'req-msg-456' });
          }),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendRequisitionNotificationEmail(
      '',
      null,
      ''
    );

    expect(res.sent).toBe(true);
    expect(capturedMail.to).toBe('navinchaudhary.dev@gmail.com');
    expect(capturedMail.html).toContain('No specific line items itemized');

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  test('sendRequisitionNotificationEmail handles send failure and returns error', async () => {
    let freshMailerService;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASSWORD = 'app-password';
      jest.doMock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          sendMail: jest.fn().mockRejectedValue(new Error('Gateway timeout')),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendRequisitionNotificationEmail('test@example.com', { rfqNumber: 'RFQ-ERR' }, 'buyer@test.com');
    expect(res.sent).toBe(false);
    expect(res.error).toBe('Gateway timeout');

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  test('buildRequisitionEmail exercises items array and alternate property names', () => {
    const email1 = mailerService.buildRequisitionEmail('target@test.com', {
      sourceEmail: 'fallback-buyer@test.com',
      items: [
        { name: 'Pipe Fitting', uom: 'meters', specs: 'Grade A' },
        { itemName: 'Pressure Gauge', quantity: 5, unit: 'pcs', description: '0-10 bar' },
      ],
    });
    expect(email1.replyTo).toBe('fallback-buyer@test.com');
    expect(email1.html).toContain('Pipe Fitting');
    expect(email1.html).toContain('Pressure Gauge');
    expect(email1.html).toContain('Grade A');
    expect(email1.html).toContain('0-10 bar');
  });

  describe('Vendor Category & Onboarding Emails', () => {
    test('categoryList formats items or returns empty string', () => {
      expect(mailerService.categoryList([])).toBe('');
      expect(mailerService.categoryList(['', '   ', null])).toBe('');
      const html = mailerService.categoryList(['Valves', 'Pumps']);
      expect(html).toContain('Valves');
      expect(html).toContain('Pumps');
    });

    test('buildVendorCategoryMappingEmail renders correctly with and without minors', () => {
      const email1 = mailerService.buildVendorCategoryMappingEmail({
        to: 'vendor@test.com',
        recipientName: 'Rajesh',
        buyerOrganizationName: 'Tata Steel',
        vendorCode: 'V-1001',
        majorCategory: 'Industrial Valves',
        minorCategories: ['Ball Valves', 'Gate Valves'],
        contactPhone: '+91 98765 43210',
      });
      expect(email1.to).toBe('vendor@test.com');
      expect(email1.subject).toContain('Tata Steel has mapped your supply categories');
      expect(email1.html).toContain('Rajesh');
      expect(email1.html).toContain('Ball Valves');
      expect(email1.html).toContain('Mobile Number');
      expect(email1.html).toContain('+91 98765 43210');

      const email2 = mailerService.buildVendorCategoryMappingEmail({
        to: 'vendor2@test.com',
      });
      expect(email2.subject).toContain('A buyer on Procucev');
      expect(email2.html).toContain('Hello,');
    });

    test('buildVendorSelfMappingEmail renders correctly', () => {
      const email = mailerService.buildVendorSelfMappingEmail({
        to: 'vendor@test.com',
        recipientName: 'Suresh',
        buyerOrganizationName: 'L&T',
        vendorCode: 'V-2002',
        contactPhone: '+91 98765 43210',
      });
      expect(email.to).toBe('vendor@test.com');
      expect(email.subject).toBe('Complete Your Category Mapping to Receive Enquiries');
      expect(email.html).toContain('Suresh');
      expect(email.html).toContain('L&T');
      expect(email.html).toContain('Mobile Number');
      expect(email.html).toContain('+91 98765 43210');

      const emailFallback = mailerService.buildVendorSelfMappingEmail({ to: 'v@test.com' });
      expect(emailFallback.html).toContain('Hello,');
    });

    test('escapes the vendor phone number rendered in onboarding templates', () => {
      const email = mailerService.buildVendorSelfMappingEmail({
        to: 'vendor@test.com',
        contactPhone: '<script>alert(1)</script>',
      });
      expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(email.html).not.toContain('<script>alert(1)</script>');
    });

    test('buildVendorCategoryMappingEmail uses a buyer-saved custom subject/message when provided', () => {
      const email = mailerService.buildVendorCategoryMappingEmail({
        to: 'vendor@test.com',
        buyerOrganizationName: 'Tata Steel',
        majorCategory: 'Industrial Valves',
        customSubject: 'Welcome aboard, {{vendor}}',
        customMessage: 'We are thrilled to have you as a mapped supplier.',
      });
      expect(email.subject).toBe('Welcome aboard, {{vendor}}');
      expect(email.html).toContain('We are thrilled to have you as a mapped supplier.');
      expect(email.html).not.toContain('has mapped your supply categories from your pre-purchase order history');
    });

    test('buildVendorSelfMappingEmail uses a buyer-saved custom subject/message when provided', () => {
      const email = mailerService.buildVendorSelfMappingEmail({
        to: 'vendor@test.com',
        buyerOrganizationName: 'L&T',
        customSubject: 'Please set up your categories',
        customMessage: 'We added you to our vendor list — please map your categories.',
      });
      expect(email.subject).toBe('Please set up your categories');
      expect(email.html).toContain('We added you to our vendor list — please map your categories.');
      expect(email.html).not.toContain('No historical pre-purchase order data was available');
    });

    test('buildVendorOnboardingEmail renders credentials and contact info', () => {
      const email = mailerService.buildVendorOnboardingEmail({
        to: 'onboard@test.com',
        recipientName: 'Amit',
        buyerOrganizationName: 'Reliance',
        vendorCode: 'V-3003',
        tempPassword: 'SecretPassword123',
        contactPhone: '+919876543210',
      });
      expect(email.to).toBe('onboard@test.com');
      expect(email.subject).toContain('Welcome to Procucev');
      expect(email.html).toContain('SecretPassword123');
      expect(email.html).toContain('Mobile Number');
      expect(email.html).toContain('+919876543210');

      const emailFallback = mailerService.buildVendorOnboardingEmail({
        to: 'onboard2@test.com',
      });
      expect(emailFallback.html).toContain('Set during first login');
    });

    test('buildRatingRevisionEmail renders rating update summary', () => {
      const email = mailerService.buildRatingRevisionEmail({
        to: 'rating@test.com',
        recipientName: 'Vikram',
        vendorName: 'Apex Tools',
        buyerCompany: 'Mahindra',
        buyerName: 'Buyer Lead',
        previousRating: 3.5,
        newRating: 4.5,
        previousScore: 70.0,
        newScore: 90.0,
        remarks: 'Great on-time delivery record',
        qualityScore: 95,
        costScore: 85,
        deliveryScore: 90,
      });
      expect(email.to).toBe('rating@test.com');
      expect(email.subject).toContain('Mahindra');
      expect(email.html).toContain('4.5 / 5.0');
      expect(email.html).toContain('Great on-time delivery record');
    });

    test('sendVendorIngestionEmail and isConfigured work properly', async () => {
      const res = await mailerService.sendVendorIngestionEmail({ to: 'x@test.com' }, 'mapping');
      expect(res.sent).toBe(false);

      expect(typeof mailerService.isConfigured()).toBe('boolean');
    });

    test('getTransporter handles custom SMTP_PORT, SMTP_SECURE, non-gmail host, and SMTP_SERVICE', () => {
      let createdConfig;
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.SMTP_USER = 'test@example.com';
        process.env.SMTP_PASSWORD = 'pw';
        process.env.SMTP_PORT = '2525';
        process.env.SMTP_SECURE = 'false';
        process.env.SMTP_HOST = 'smtp.custom.com';
        process.env.SMTP_SERVICE = 'gmail';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn((cfg) => {
            createdConfig = cfg;
            return { sendMail: jest.fn() };
          }),
        }));
        const fresh = require('../src/services/mailerService');
        fresh.getTransporter();
      });
      expect(createdConfig.port).toBe(2525);
      expect(createdConfig.secure).toBe(false);

      // Branch: SMTP_SECURE without SMTP_PORT
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.SMTP_USER = 'test@example.com';
        process.env.SMTP_PASSWORD = 'pw';
        delete process.env.SMTP_PORT;
        process.env.SMTP_SECURE = 'true';
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_SERVICE;
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn((cfg) => {
            createdConfig = cfg;
            return { sendMail: jest.fn() };
          }),
        }));
        const fresh = require('../src/services/mailerService');
        fresh.getTransporter();
      });
      expect(createdConfig.port).toBe(465);
      expect(createdConfig.secure).toBe(true);

      // Branch: Non-gmail host without SMTP_PORT/SMTP_SECURE
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.SMTP_USER = 'test@example.com';
        process.env.SMTP_PASSWORD = 'pw';
        delete process.env.SMTP_PORT;
        delete process.env.SMTP_SECURE;
        process.env.SMTP_HOST = 'mail.otherdomain.com';
        delete process.env.SMTP_SERVICE;
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn((cfg) => {
            createdConfig = cfg;
            return { sendMail: jest.fn() };
          }),
        }));
        const fresh = require('../src/services/mailerService');
        fresh.getTransporter();
      });
      expect(createdConfig.port).toBe(587);
      expect(createdConfig.secure).toBe(false);

      // Cleanup
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_SECURE;
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_SERVICE;
      process.env.NODE_ENV = 'test';
    });

    test('fromAddress and vendorSignInUrl handle custom format and fallback envs', () => {
      process.env.SMTP_FROM = '"Custom Sender" <custom@procucev.com>';
      expect(mailerService.fromAddress()).toBe('"Custom Sender" <custom@procucev.com>');

      delete process.env.APP_PUBLIC_URL;
      process.env.FRONTEND_URL = 'https://frontend.vercel.app/';
      expect(mailerService.vendorSignInUrl()).toBe('https://frontend.vercel.app/login');

      delete process.env.SMTP_FROM;
      delete process.env.FRONTEND_URL;
    });

    test('buyerPortalUrl returns configured or fallback login URL', () => {
      delete process.env.APP_PUBLIC_URL;
      delete process.env.FRONTEND_URL;
      delete process.env.PUBLIC_FRONTEND_URL;
      expect(mailerService.buyerPortalUrl()).toBe('http://localhost:3000/login');

      process.env.PUBLIC_FRONTEND_URL = 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';
      expect(mailerService.buyerPortalUrl()).toBe('https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/login');
      delete process.env.PUBLIC_FRONTEND_URL;

      process.env.APP_PUBLIC_URL = 'https://app.procucev.com/';
      expect(mailerService.buyerPortalUrl()).toBe('https://app.procucev.com/login');
      delete process.env.APP_PUBLIC_URL;
    });

    test('getPublicFrontendUrl and getLogoUrl resolve dynamic URLs and production logo asset', () => {
      delete process.env.APP_PUBLIC_URL;
      delete process.env.FRONTEND_URL;
      delete process.env.PUBLIC_FRONTEND_URL;

      expect(mailerService.getPublicFrontendUrl()).toBe('http://localhost:3000');
      // Localhost environment falls back to public workers.dev asset for external email clients
      expect(mailerService.getLogoUrl()).toBe('https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/procucev-logo.png');

      process.env.PUBLIC_FRONTEND_URL = 'https://enterprise.procucev.com/';
      expect(mailerService.getPublicFrontendUrl()).toBe('https://enterprise.procucev.com');
      expect(mailerService.getLogoUrl()).toBe('https://enterprise.procucev.com/procucev-logo.png');
      delete process.env.PUBLIC_FRONTEND_URL;

      // Cloudflare worker global context
      globalThis.__CF_ENV__ = { PUBLIC_FRONTEND_URL: 'https://cf-worker-frontend.dev' };
      expect(mailerService.getPublicFrontendUrl()).toBe('https://cf-worker-frontend.dev');
      delete globalThis.__CF_ENV__;
    });

    test('email templates render real procucev-logo image asset', () => {
      const otpMsg = mailerService.sendOtpEmail('user@test.com', '123456');
      const reqEmail = mailerService.buildRequisitionEmail('buyer@test.com', { rfqNumber: 'RFQ-LOGO-TEST', title: 'Logo Test' });
      expect(reqEmail.html).toContain('procucev-logo.png');
      expect(reqEmail.html).toContain('alt="Procucev Enterprise"');
    });

    test('buildUnauthorizedBuyerEmail builds expected email template', () => {
      const email = mailerService.buildUnauthorizedBuyerEmail('unknown@external.com', {
        gatewayAddress: 'RFQ@procucev.com',
      });
      expect(email.to).toBe('unknown@external.com');
      expect(email.subject).toBe('Enterprise QUA - Buyer Registration Required');
      expect(email.html).toContain('unknown@external.com');
      expect(email.html).toContain('not registered as an authorized buyer in Enterprise QUA');
      expect(email.html).toContain('Enterprise QUA Buyer Portal');
      expect(email.html).toContain('RFQ@procucev.com');
      expect(email.html).toContain('Your RFQ has not been created');
    });

    test('sendUnauthorizedBuyerNotificationEmail validates recipient and dispatches in test mode', async () => {
      const emptyRes = await mailerService.sendUnauthorizedBuyerNotificationEmail('');
      expect(emptyRes.sent).toBe(false);
      expect(emptyRes.reason).toBe('missing recipient email');

      const res = await mailerService.sendUnauthorizedBuyerNotificationEmail('unreg@buyer.com');
      expect(res.sent).toBe(false);
      expect(res.reason).toBe('test environment');
    });

    test('buildRfqAcknowledgementEmail formats email with exact buyer template and numbers', () => {
      const email = mailerService.buildRfqAcknowledgementEmail({
        to: 'veerababu.v@procucev.com',
        buyerName: 'Veerababu',
        rfqNumber: 'RFQ260909223278',
        rfqTitle: '100 MT Structural Steel Beams',
      });

      expect(email.to).toBe('veerababu.v@procucev.com');
      expect(email.subject).toContain('RFQ260909223278');
      expect(email.text).toContain('Hi Veerababu,');
      expect(email.text).toContain('Great news! Your requirement has been converted into RFQ #RFQ260909223278 and sent to verified suppliers on Procucev right now.');
      expect(email.text).toContain('📩 Quotes typically start coming in within 24–48 hours.');
      expect(email.text).toContain('Need it faster or have a follow-up requirement?');
      expect(email.text).toContain('📞 Call: +91-7996170801');
      expect(email.text).toContain('✉️ Email: RFQ@procucev.com / support@procucev.com');
      expect(email.text).toContain("Just drop us your requirement anytime — we'll take it from there!");
      expect(email.text).toContain('Team Procucev');

      expect(email.html).toContain('Hi <strong>Veerababu</strong>,');
      expect(email.html).toContain('#RFQ260909223278');
      expect(email.html).toContain('100 MT Structural Steel Beams');
      expect(email.html).toContain('+91-7996170801');
      expect(email.html).toContain('RFQ@procucev.com');
      expect(email.html).toContain('support@procucev.com');
      expect(email.html).toContain('Team Procucev');
    });

    test('buildRfqAcknowledgementEmail handles default fallbacks when fields are omitted', () => {
      const email = mailerService.buildRfqAcknowledgementEmail({
        to: 'buyer@example.com',
      });

      expect(email.to).toBe('buyer@example.com');
      expect(email.text).toContain('Hi Valued Buyer,');
      expect(email.text).toContain('#RFQ');
      expect(email.html).not.toContain('Requisition:');
    });

    test('sendRfqAcknowledgementEmail delivers in test environment and dev with mocked transport', async () => {
      const testRes = await mailerService.sendRfqAcknowledgementEmail({
        to: 'buyer@example.com',
        buyerName: 'Buyer',
        rfqNumber: 'RFQ123',
      });
      expect(testRes.sent).toBe(false);
      expect(testRes.reason).toBe('test environment');

      let devMailer;
      let sentMail;
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.SMTP_USER = 'test@example.com';
        process.env.SMTP_PASSWORD = 'password';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn(() => ({
            sendMail: jest.fn((mail) => {
              sentMail = mail;
              return Promise.resolve({ messageId: 'ack-msg-id-123' });
            }),
          })),
        }));
        devMailer = require('../src/services/mailerService');
      });

      const devRes = await devMailer.sendRfqAcknowledgementEmail({
        to: 'buyer@example.com',
        buyerName: 'Veerababu',
        rfqNumber: 'RFQ260909223278',
      });
      expect(devRes.sent).toBe(true);
      expect(devRes.messageId).toBe('ack-msg-id-123');
      expect(sentMail.to).toBe('buyer@example.com');
      expect(sentMail.text).toContain('Hi Veerababu,');
    });
  });

  describe('Resend HTTPS-API delivery (used instead of SMTP whenever RESEND_API_KEY is set — SMTP is blocked outbound on Render)', () => {
    afterEach(() => {
      global.fetch.mockRestore?.();
    });

    test('sends via Resend instead of SMTP when RESEND_API_KEY is set, and never touches SMTP_USER/SMTP_PASSWORD', async () => {
      let freshMailerService;
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.RESEND_API_KEY = 'resend-test-key';
        process.env.RESEND_FROM_EMAIL = 'invites@procucev.com';
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASSWORD;
        freshMailerService = require('../src/services/mailerService');
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'resend-msg-id' }),
      });

      const res = await freshMailerService.sendOtpEmail('vendor@example.com', '4321', 600);

      expect(res.sent).toBe(true);
      expect(res.messageId).toBe('resend-msg-id');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer resend-test-key' }),
        })
      );
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.from).toBe('invites@procucev.com');
      expect(body.to).toBe('vendor@example.com');

      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_FROM_EMAIL;
      process.env.NODE_ENV = 'test';
    });

    test('propagates a Resend API error to the caller instead of silently swallowing it', async () => {
      let freshMailerService;
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.RESEND_API_KEY = 'resend-test-key';
        freshMailerService = require('../src/services/mailerService');
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: 'Invalid from address' }),
      });

      await expect(freshMailerService.sendOtpEmail('vendor@example.com', '4321', 600)).rejects.toThrow(
        'Invalid from address'
      );

      delete process.env.RESEND_API_KEY;
      process.env.NODE_ENV = 'test';
    });
  });

  describe('Vendor Transporter & Gateway Address', () => {
    test('vendorFromAddress and vendorGatewayAddress support custom and fallback envs', () => {
      expect(mailerService.vendorFromAddress()).toContain('srinu20252026@gmail.com');
      expect(mailerService.vendorGatewayAddress()).toBe('srinu20252026@gmail.com');

      const origFrom = process.env.VENDOR_SMTP_FROM;
      const origAddr = process.env.VENDOR_EMAIL_GATEWAY_ADDRESS;
      try {
        process.env.VENDOR_SMTP_FROM = '"Custom Vendor Gateway" <custom@vendor.com>';
        process.env.VENDOR_EMAIL_GATEWAY_ADDRESS = 'custom-gateway@vendor.com';

        expect(mailerService.vendorFromAddress()).toBe('"Custom Vendor Gateway" <custom@vendor.com>');
        expect(mailerService.vendorGatewayAddress()).toBe('custom-gateway@vendor.com');
      } finally {
        if (origFrom !== undefined) process.env.VENDOR_SMTP_FROM = origFrom;
        else delete process.env.VENDOR_SMTP_FROM;
        if (origAddr !== undefined) process.env.VENDOR_EMAIL_GATEWAY_ADDRESS = origAddr;
        else delete process.env.VENDOR_EMAIL_GATEWAY_ADDRESS;
      }
    });

    test('isVendorConfigured checks vendor SMTP credentials', () => {
      const origUser = process.env.VENDOR_SMTP_USER;
      const origPass = process.env.VENDOR_SMTP_PASSWORD;
      const origSmtpUser = process.env.SMTP_USER;
      const origSmtpPass = process.env.SMTP_PASSWORD;

      try {
        delete process.env.VENDOR_SMTP_USER;
        delete process.env.VENDOR_SMTP_PASSWORD;
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASSWORD;
        expect(mailerService.isVendorConfigured()).toBe(false);

        process.env.VENDOR_SMTP_USER = 'srinu20252026@gmail.com';
        process.env.VENDOR_SMTP_PASSWORD = 'app-password';
        expect(mailerService.isVendorConfigured()).toBe(true);
      } finally {
        if (origUser !== undefined) process.env.VENDOR_SMTP_USER = origUser;
        else delete process.env.VENDOR_SMTP_USER;
        if (origPass !== undefined) process.env.VENDOR_SMTP_PASSWORD = origPass;
        else delete process.env.VENDOR_SMTP_PASSWORD;
        if (origSmtpUser !== undefined) process.env.SMTP_USER = origSmtpUser;
        else delete process.env.SMTP_USER;
        if (origSmtpPass !== undefined) process.env.SMTP_PASSWORD = origSmtpPass;
        else delete process.env.SMTP_PASSWORD;
      }
    });

    test('getVendorTransporter handles custom VENDOR_SMTP_PORT, VENDOR_SMTP_SECURE, and host configs', () => {
      let fresh;
      jest.isolateModules(() => {
        process.env.VENDOR_SMTP_USER = 'srinu20252026@gmail.com';
        process.env.VENDOR_SMTP_PASSWORD = 'password';
        process.env.VENDOR_SMTP_HOST = 'mail.custom.com';
        process.env.VENDOR_SMTP_PORT = '2525';
        process.env.VENDOR_SMTP_SECURE = 'false';
        process.env.VENDOR_SMTP_SERVICE = 'custom';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn((cfg) => ({ cfg, sendMail: jest.fn() })),
        }));
        fresh = require('../src/services/mailerService');
      });

      const trans1 = fresh.getVendorTransporter();
      expect(trans1).toBeDefined();
      expect(trans1.cfg.port).toBe(2525);
      expect(trans1.cfg.secure).toBe(false);
      // Caching check:
      expect(fresh.getVendorTransporter()).toBe(trans1);

      // Branch: VENDOR_SMTP_SECURE set without port
      jest.isolateModules(() => {
        process.env.VENDOR_SMTP_USER = 'srinu20252026@gmail.com';
        process.env.VENDOR_SMTP_PASSWORD = 'password';
        delete process.env.VENDOR_SMTP_PORT;
        process.env.VENDOR_SMTP_SECURE = 'true';
        delete process.env.VENDOR_SMTP_SERVICE;
        process.env.VENDOR_SMTP_HOST = 'smtp.office365.com';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn((cfg) => ({ cfg })),
        }));
        fresh = require('../src/services/mailerService');
      });
      const trans2 = fresh.getVendorTransporter();
      expect(trans2.cfg.port).toBe(465);

      // Branch: Non-gmail without port or secure
      jest.isolateModules(() => {
        process.env.VENDOR_SMTP_USER = 'srinu20252026@gmail.com';
        process.env.VENDOR_SMTP_PASSWORD = 'password';
        delete process.env.VENDOR_SMTP_PORT;
        delete process.env.VENDOR_SMTP_SECURE;
        process.env.VENDOR_SMTP_HOST = 'smtp.sendgrid.net';
        delete process.env.VENDOR_SMTP_SERVICE;
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn((cfg) => ({ cfg })),
        }));
        fresh = require('../src/services/mailerService');
      });
      const trans3 = fresh.getVendorTransporter();
      expect(trans3.cfg.port).toBe(587);
      expect(trans3.cfg.secure).toBe(false);
    });

    test('deliverVendor delivers email in dev mode with mock transporter', async () => {
      let fresh;
      let deliveredMsg;
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.VENDOR_SMTP_USER = 'srinu20252026@gmail.com';
        process.env.VENDOR_SMTP_PASSWORD = 'password';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn(() => ({
            sendMail: jest.fn((msg) => {
              deliveredMsg = msg;
              return Promise.resolve({ messageId: 'vendor-msg-123' });
            }),
          })),
        }));
        fresh = require('../src/services/mailerService');
      });

      const res = await fresh.deliverVendor({ to: 'vendor@abc.com', subject: 'RFQ Invite' }, 'Vendor Invite');
      expect(res.sent).toBe(true);
      expect(res.messageId).toBe('vendor-msg-123');
      expect(deliveredMsg.to).toBe('vendor@abc.com');

      // Failure case
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.VENDOR_SMTP_USER = 'srinu20252026@gmail.com';
        process.env.VENDOR_SMTP_PASSWORD = 'password';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn(() => ({
            sendMail: jest.fn().mockRejectedValue(new Error('Vendor SMTP down')),
          })),
        }));
        fresh = require('../src/services/mailerService');
      });
      await expect(fresh.deliverVendor({ to: 'vendor@abc.com' }, 'Vendor Invite')).rejects.toThrow('Vendor SMTP down');
    });

    // Regression coverage for a real production incident: once VENDOR_SMTP_*
    // secrets were configured, every vendor onboarding/invite email silently
    // stopped arriving. Root cause confirmed live via wrangler tail: raw SMTP
    // (nodemailer) cannot run on Cloudflare Workers at all — its TLS layer
    // doesn't implement `rejectUnauthorized`, so activeTransporter.sendMail()
    // always throws "The options.rejectUnauthorized option is not
    // implemented" the moment a real vendor transporter gets configured.
    // Before this fix, that error propagated straight to the caller with no
    // fallback — the Gmail API fallback above only ever ran when no vendor
    // transporter existed at all, never when one existed but failed to send.
    test('deliverVendor falls back to the Gmail API when a configured vendor SMTP transporter fails to send (e.g. Workers TLS incompatibility)', async () => {
      let fresh;
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.VENDOR_SMTP_USER = 'srinu20252026@gmail.com';
        process.env.VENDOR_SMTP_PASSWORD = 'password';
        process.env.GMAIL_CLIENT_ID = 'client-id';
        process.env.GMAIL_CLIENT_SECRET = 'client-secret';
        process.env.GMAIL_REFRESH_TOKEN = 'refresh-token';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn(() => ({
            sendMail: jest.fn().mockRejectedValue(new Error('The options.rejectUnauthorized option is not implemented')),
          })),
        }));
        jest.doMock('googleapis', () => ({
          google: {
            auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn() })) },
            gmail: jest.fn(() => ({
              users: {
                messages: {
                  send: jest.fn().mockResolvedValue({ data: { id: 'gmail-fallback-msg-1' } }),
                },
              },
            })),
          },
        }));
        fresh = require('../src/services/mailerService');
      });

      const res = await fresh.deliverVendor({ to: 'vendor@abc.com', subject: 'RFQ Invite' }, 'Vendor Invite');

      expect(res.sent).toBe(true);
      expect(res.messageId).toBe('gmail-fallback-msg-1');

      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
      delete process.env.GMAIL_REFRESH_TOKEN;
    });

    // A dedicated vendor mailbox Gmail identity — same OAuth2 "app"
    // (GMAIL_CLIENT_ID/SECRET) as the buyer's, but its own refresh token and
    // sender address, so vendor mail no longer has to appear to come from
    // the buyer's account and never touches SMTP (which can't work on
    // Workers at all) in the first place.
    describe('vendor Gmail API (dedicated vendor mailbox)', () => {
      afterEach(() => {
        delete process.env.GMAIL_CLIENT_ID;
        delete process.env.GMAIL_CLIENT_SECRET;
        delete process.env.VENDOR_GMAIL_REFRESH_TOKEN;
        delete process.env.VENDOR_GMAIL_SENDER_EMAIL;
        delete process.env.VENDOR_SMTP_USER;
        delete process.env.VENDOR_SMTP_PASSWORD;
      });

      test('isVendorGmailApiConfigured is true only when client id/secret and the vendor refresh token are all set', () => {
        let fresh;
        jest.isolateModules(() => {
          fresh = require('../src/services/mailerService');
        });
        expect(fresh.isVendorGmailApiConfigured()).toBe(false);

        jest.isolateModules(() => {
          process.env.GMAIL_CLIENT_ID = 'client-id';
          process.env.GMAIL_CLIENT_SECRET = 'client-secret';
          fresh = require('../src/services/mailerService');
        });
        expect(fresh.isVendorGmailApiConfigured()).toBe(false);

        jest.isolateModules(() => {
          process.env.GMAIL_CLIENT_ID = 'client-id';
          process.env.GMAIL_CLIENT_SECRET = 'client-secret';
          process.env.VENDOR_GMAIL_REFRESH_TOKEN = 'vendor-refresh-token';
          fresh = require('../src/services/mailerService');
        });
        expect(fresh.isVendorGmailApiConfigured()).toBe(true);
      });

      test('deliverVendor prefers the dedicated vendor Gmail mailbox over VENDOR_SMTP_*, and sends from VENDOR_GMAIL_SENDER_EMAIL', async () => {
        let fresh;
        let sendArgs;
        let createTransport;
        jest.isolateModules(() => {
          process.env.NODE_ENV = 'development';
          process.env.GMAIL_CLIENT_ID = 'client-id';
          process.env.GMAIL_CLIENT_SECRET = 'client-secret';
          process.env.VENDOR_GMAIL_REFRESH_TOKEN = 'vendor-refresh-token';
          process.env.VENDOR_GMAIL_SENDER_EMAIL = 'srinu20252026@gmail.com';
          // Present but must never be touched — vendor Gmail API takes
          // priority, so this transporter should never even be built.
          process.env.VENDOR_SMTP_USER = 'srinu20252026@gmail.com';
          process.env.VENDOR_SMTP_PASSWORD = 'password';
          createTransport = jest.fn();
          jest.doMock('nodemailer', () => ({ createTransport }));
          jest.doMock('googleapis', () => ({
            google: {
              auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn() })) },
              gmail: jest.fn(() => ({
                users: {
                  messages: {
                    send: jest.fn((args) => {
                      sendArgs = args;
                      return Promise.resolve({ data: { id: 'vendor-gmail-msg-1' } });
                    }),
                  },
                },
              })),
            },
          }));
          fresh = require('../src/services/mailerService');
        });

        const res = await fresh.deliverVendor({ to: 'vendor@abc.com', subject: 'RFQ Invite', html: '<p>hi</p>' }, 'Vendor Invite');

        expect(res.sent).toBe(true);
        expect(res.messageId).toBe('vendor-gmail-msg-1');
        const decodedRaw = Buffer.from(sendArgs.requestBody.raw, 'base64url').toString('utf8');
        expect(decodedRaw).toContain('srinu20252026@gmail.com');
        expect(createTransport).not.toHaveBeenCalled();
      });
    });

    // A THIRD, separate Gmail identity dedicated to the "vendor quote
    // received" buyer-facing alert, kept apart from both the buyer inbound-
    // polling mailbox (GMAIL_REFRESH_TOKEN) and the vendor-outbound mailbox
    // (VENDOR_GMAIL_REFRESH_TOKEN) so this notification's send volume never
    // shares a quota bucket with either.
    describe('quote-alert Gmail API (dedicated "vendor quote received" mailbox)', () => {
      afterEach(() => {
        delete process.env.GMAIL_CLIENT_ID;
        delete process.env.GMAIL_CLIENT_SECRET;
        delete process.env.QUOTE_ALERT_GMAIL_REFRESH_TOKEN;
        delete process.env.QUOTE_ALERT_GMAIL_SENDER_EMAIL;
      });

      test('isQuoteAlertGmailApiConfigured is true only when client id/secret and the quote-alert refresh token are all set', () => {
        let fresh;
        jest.isolateModules(() => {
          fresh = require('../src/services/mailerService');
        });
        expect(fresh.isQuoteAlertGmailApiConfigured()).toBe(false);

        jest.isolateModules(() => {
          process.env.GMAIL_CLIENT_ID = 'client-id';
          process.env.GMAIL_CLIENT_SECRET = 'client-secret';
          fresh = require('../src/services/mailerService');
        });
        expect(fresh.isQuoteAlertGmailApiConfigured()).toBe(false);

        jest.isolateModules(() => {
          process.env.GMAIL_CLIENT_ID = 'client-id';
          process.env.GMAIL_CLIENT_SECRET = 'client-secret';
          process.env.QUOTE_ALERT_GMAIL_REFRESH_TOKEN = 'quote-alert-refresh-token';
          fresh = require('../src/services/mailerService');
        });
        expect(fresh.isQuoteAlertGmailApiConfigured()).toBe(true);
      });

      test('sendQuoteReceivedEmail prefers the dedicated quote-alert mailbox and sends from QUOTE_ALERT_GMAIL_SENDER_EMAIL', async () => {
        let fresh;
        let sendArgs;
        jest.isolateModules(() => {
          process.env.NODE_ENV = 'development';
          process.env.GMAIL_CLIENT_ID = 'client-id';
          process.env.GMAIL_CLIENT_SECRET = 'client-secret';
          process.env.QUOTE_ALERT_GMAIL_REFRESH_TOKEN = 'quote-alert-refresh-token';
          process.env.QUOTE_ALERT_GMAIL_SENDER_EMAIL = 'manav.procucev@gmail.com';
          jest.doMock('googleapis', () => ({
            google: {
              auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn() })) },
              gmail: jest.fn(() => ({
                users: {
                  messages: {
                    send: jest.fn((args) => {
                      sendArgs = args;
                      return Promise.resolve({ data: { id: 'quote-alert-msg-1' } });
                    }),
                  },
                },
              })),
            },
          }));
          fresh = require('../src/services/mailerService');
        });

        const res = await fresh.sendQuoteReceivedEmail('buyer@x.com', {
          rfq: { rfqNumber: 'RFQ-2026-001', title: 'Pumps' },
          quote: { vendorName: 'Acme Pumps', unitPrice: 100, totalPrice: 1000 },
          recipientName: 'Buyer One',
        });

        expect(res.sent).toBe(true);
        expect(res.messageId).toBe('quote-alert-msg-1');
        const decodedRaw = Buffer.from(sendArgs.requestBody.raw, 'base64url').toString('utf8');
        expect(decodedRaw).toContain('manav.procucev@gmail.com');
      });

      test('sendQuoteReceivedEmail falls back to the buyer Gmail API when the quote-alert mailbox is not configured', async () => {
        let fresh;
        let sendArgs;
        jest.isolateModules(() => {
          process.env.NODE_ENV = 'development';
          process.env.GMAIL_CLIENT_ID = 'client-id';
          process.env.GMAIL_CLIENT_SECRET = 'client-secret';
          process.env.GMAIL_REFRESH_TOKEN = 'buyer-refresh-token';
          jest.doMock('googleapis', () => ({
            google: {
              auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn() })) },
              gmail: jest.fn(() => ({
                users: {
                  messages: {
                    send: jest.fn((args) => {
                      sendArgs = args;
                      return Promise.resolve({ data: { id: 'buyer-fallback-msg-1' } });
                    }),
                  },
                },
              })),
            },
          }));
          fresh = require('../src/services/mailerService');
        });

        const res = await fresh.sendQuoteReceivedEmail('buyer@x.com', {
          rfq: { rfqNumber: 'RFQ-2026-002', title: 'Valves' },
          quote: { vendorName: 'Beta Valves' },
        });

        expect(res.sent).toBe(true);
        expect(res.messageId).toBe('buyer-fallback-msg-1');
        expect(sendArgs).toBeDefined();
        delete process.env.GMAIL_REFRESH_TOKEN;
      });
    });
  });

  describe('Vendor Category Mismatch Email', () => {
    test('buildVendorCategoryMismatchEmail builds a structured notice with category details and link', () => {
      const email = mailerService.buildVendorCategoryMismatchEmail('vendor@example.com', {
        rfqNumber: 'RFQ-999',
        rfqTitle: 'Heavy Machinery Steel Plates',
        rfqCategory: 'Raw Material',
        vendorName: 'Apex Industrial',
        vendorCurrentCategory: 'IT Hardware',
        buyerAccountName: 'Tata Steel Procurement',
        buyerEmail: 'buyer@tatasteel.com',
      });

      expect(email.to).toBe('vendor@example.com');
      expect(email.cc).toBe('buyer@tatasteel.com');
      expect(email.subject).toContain('Action Required: Category Mismatch for RFQ #RFQ-999');
      expect(email.html).toContain('Apex Industrial');
      expect(email.html).toContain('Heavy Machinery Steel Plates');
      expect(email.html).toContain('Raw Material');
      expect(email.html).toContain('IT Hardware');
      expect(email.html).toContain('your company has not been included in the RFQ vendor shortlist');
      expect(email.html).toContain('vendor-profile');
    });

    test('sendVendorCategoryMismatchEmail delivers in test environment', async () => {
      const res = await mailerService.sendVendorCategoryMismatchEmail('vendor@example.com', {
        rfqNumber: 'RFQ-888',
        rfqTitle: 'Bearings',
        rfqCategory: 'Mechanical',
        vendorName: 'Delta Bearings',
      });

      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Builder branch coverage: exercise both the populated and the minimal/empty
  // context sides of the conditional template fragments.
  // ──────────────────────────────────────────────────────────────────────────
  describe('email builder conditional-branch coverage', () => {
    test('buildRfqInviteEmail covers reminder + credit-status banners and the empty-item fallback', () => {
      const reminder = mailerService.buildRfqInviteEmail('vendor@x.com', {
        rfq: { rfqNumber: 'RFQ-INV-1', title: 'Pumps', extractedEntities: [] },
        recipientName: 'Vendor One',
        buyerEmail: 'buyer@x.com',
        cc: 'cc@x.com',
        freeCreditsRemaining: 3,
        isSubscribed: false,
        isReminder: true,
      });
      expect(reminder.to).toBe('vendor@x.com');

      const subscribed = mailerService.buildRfqInviteEmail('vendor@x.com', {
        rfq: { rfqNumber: 'RFQ-INV-2', items: [{ name: 'Item', quantity: 1 }] },
        isSubscribed: true,
        freeCreditsRemaining: 0,
      });
      expect(subscribed.subject).toBeDefined();

      const viaLineItems = mailerService.buildRfqInviteEmail('vendor@x.com', {
        rfq: { rfqNumber: 'RFQ-INV-3', lineItems: [{ name: 'LI', quantity: 2 }] },
      });
      expect(viaLineItems.html).toBeDefined();

      // Multi-item + buyerAccountName => the items.length > 1 sample-format and
      // the named-buyer greeting branches.
      const multiItem = mailerService.buildRfqInviteEmail('vendor@x.com', {
        rfq: {
          rfqNumber: 'RFQ-INV-4',
          buyerAccountName: 'Named Buyer Co',
          extractedEntities: [
            { itemName: 'Pump', quantity: 2, unit: 'Nos' },
            { name: 'Valve', quantity: 5 },
          ],
        },
        isReminder: false,
      });
      expect(multiItem.html).toContain('Named Buyer Co');

      const bare = mailerService.buildRfqInviteEmail('vendor@x.com', { rfq: {} });
      expect(bare.html).toBeDefined();
    });

    test('buildQuoteFailureEmail covers the missingFields fallback and generic greeting', () => {
      const withMissing = mailerService.buildQuoteFailureEmail('vendor@x.com', {
        rfqNumber: 'RFQ-QF-1',
        missingFields: ['Unit Price (₹)', 'Lead Time'],
      });
      expect(withMissing.html).toContain('Unit Price (₹)');

      const bare = mailerService.buildQuoteFailureEmail('vendor@x.com', { rfqNumber: 'RFQ-QF-2' });
      expect(bare.html).toContain('Hello,');
    });

    test('buildVendorCreditsExhaustedEmail covers no-items, no-budget and no-delivery-location fallbacks', () => {
      const bare = mailerService.buildVendorCreditsExhaustedEmail('vendor@x.com', {
        rfq: { rfqNumber: 'RFQ-CE-1' },
        vendorName: '',
      });
      expect(bare.subject).toContain('RFQ-CE-1');
      expect(bare.html).toContain('Hello,');

      const withBudgetAndItems = mailerService.buildVendorCreditsExhaustedEmail('vendor@x.com', {
        rfq: {
          rfqNumber: 'RFQ-CE-2',
          budget: 500000,
          deliveryLocation: 'Pune',
          extractedEntities: [{ itemName: 'Pump', quantity: 2, unit: 'Nos', technicalSpecs: 'ISO' }],
        },
        vendorName: 'Credit Vendor',
      });
      expect(withBudgetAndItems.html).toContain('Pune');
    });

    test('buildVendorCategoryMismatchEmail covers absent and present buyerAccountName / vendorName', () => {
      const bare = mailerService.buildVendorCategoryMismatchEmail('vendor@x.com', { rfqNumber: 'RFQ-CM-1' });
      expect(bare.html).toContain('Hello,');

      const full = mailerService.buildVendorCategoryMismatchEmail('vendor@x.com', {
        rfq: { rfqNumber: 'RFQ-CM-2', title: 'Valves', category: 'Valves' },
        vendorName: 'Mismatch Vendor',
        vendorCurrentCategory: 'Pumps',
        buyerAccountName: 'Buyer Co',
      });
      expect(full.html).toContain('Mismatch Vendor');
    });

    test('buildVendorIssueAcknowledgementEmail covers the no-cc / generic-greeting fallbacks', () => {
      const bare = mailerService.buildVendorIssueAcknowledgementEmail('vendor@x.com', { rfqNumber: 'RFQ-ISS-1' });
      expect(bare.cc).toBeUndefined();
      expect(bare.html).toContain('Hello,');
    });

    test('buildRfqAutoClosureAcknowledgementEmail covers populated category / delivery-location rows', () => {
      const full = mailerService.buildRfqAutoClosureAcknowledgementEmail('buyer@x.com', {
        rfq: { rfqNumber: 'RFQ-AC-1', title: 'Pumps', category: 'Pumps', deliveryLocation: 'Mumbai' },
        quotesCount: 2,
        recipientName: 'Buyer One',
      });
      expect(full.html).toContain('Mumbai');
      expect(full.html).toContain('Pumps');
    });

    test('buildQuoteReceivedEmail covers the 48h-sealed path and both greeting/vendor variants', () => {
      // Sealed: brand-new, non-v0, non-email RFQ within the 48h window.
      const sealed = mailerService.buildQuoteReceivedEmail('buyer@x.com', {
        rfq: { rfqNumber: 'RFQ-QR-1', title: 'Pumps', createdAt: new Date().toISOString() },
        quote: { vendorName: 'Vendor A', unitPrice: 1000 },
        recipientName: 'Buyer One',
      });
      expect(sealed.subject).toContain('Sealed for 48h');
      expect(sealed.html).toContain('Vendor A');

      // Sealed with no vendorName / recipientName => generic greeting branches.
      const sealedBare = mailerService.buildQuoteReceivedEmail('buyer@x.com', {
        rfq: { rfqNumber: 'RFQ-QR-2', createdAt: new Date().toISOString() },
        quote: {},
      });
      expect(sealedBare.html).toContain('A vendor has');
    });

    test('buildQuoteReceivedEmail unsealed path covers present and null quote fields', () => {
      // Unsealed because the RFQ is closed; full quote fields present.
      const closedFull = mailerService.buildQuoteReceivedEmail('buyer@x.com', {
        rfq: { rfqNumber: 'RFQ-QR-3', title: 'Valves', status: 'Closed' },
        quote: { vendorName: 'Vendor B', unitPrice: 500, totalPrice: 1000, leadTimeDays: 7, paymentTerms: 'Net 30', warrantyYears: 2 },
        recipientName: 'Buyer Two',
      });
      expect(closedFull.subject).not.toContain('Sealed');
      expect(closedFull.html).toContain('Vendor B');

      // Unsealed via email source; null numeric fields exercise the '-' branches.
      const emailSrc = mailerService.buildQuoteReceivedEmail('buyer@x.com', {
        rfq: { rfqNumber: 'RFQ-QR-4', source: 'email_gateway' },
        quote: {},
      });
      expect(emailSrc.html).toContain('A vendor has');
    });

    test('buildVendorCreditsExhaustedEmail covers item spec/location variants per row', () => {
      const withSpecs = mailerService.buildVendorCreditsExhaustedEmail('vendor@x.com', {
        rfq: {
          rfqNumber: 'RFQ-CE-3',
          deliveryLocation: 'Chennai',
          extractedEntities: [
            { name: 'Item NoSpec', quantity: 1 },
            { itemName: 'Item WithSpec', specifications: 'Grade B', quantity: 3, uom: 'Sets', location: 'Hosur' },
          ],
        },
        vendorName: 'Spec Vendor',
      });
      expect(withSpecs.html).toContain('Grade B');
      expect(withSpecs.html).toContain('Hosur');
    });

    test('builders invoked in single-object form exercise their default-arg branches', () => {
      // normalizeToAndContext-based builders accept a single {to, ...} object;
      // calling them that way (maybeContext undefined) hits the default-arg path.
      expect(mailerService.buildQuoteFailureEmail({ to: 'v@x.com', rfqNumber: 'RFQ-SOF-1' }).to).toBe('v@x.com');
      expect(mailerService.buildVendorCreditsExhaustedEmail({ to: 'v@x.com', rfq: { rfqNumber: 'RFQ-SOF-2' } }).to).toBe('v@x.com');
      expect(mailerService.buildVendorIssueAcknowledgementEmail({ to: 'v@x.com', rfqNumber: 'RFQ-SOF-3' }).to).toBe('v@x.com');
      expect(mailerService.buildVendorCategoryMismatchEmail({ to: 'v@x.com', rfqNumber: 'RFQ-SOF-4' }).to).toBe('v@x.com');
      expect(mailerService.buildComplexRfqPortalRedirectEmail({ to: 'v@x.com', rfq: { rfqNumber: 'RFQ-SOF-5' }, itemCount: 12 }).to).toBe('v@x.com');
      expect(mailerService.buildRfqAutoClosureAcknowledgementEmail({ to: 'b@x.com', rfq: { rfqNumber: 'RFQ-SOF-6' } }).to).toBe('b@x.com');
      expect(mailerService.buildRfqFinalComparisonEmail({ to: 'b@x.com', rfq: { rfqNumber: 'RFQ-SOF-7' } }).to).toBe('b@x.com');
    });

    test('buildRatingRevisionEmail covers the generic greeting when recipientName is absent', () => {
      const bare = mailerService.buildRatingRevisionEmail({
        to: 'vendor@x.com',
        vendorName: 'Rated Vendor',
        buyerCompany: 'Buyer Co',
        previousRating: 3,
        newRating: 4,
        previousScore: 60,
        newScore: 80,
      });
      expect(bare.html).toContain('Hello,');
      const named = mailerService.buildRatingRevisionEmail({
        to: 'vendor@x.com',
        recipientName: 'Vendor Lead',
        vendorName: 'Rated Vendor',
        buyerCompany: 'Buyer Co',
        previousRating: 3,
        newRating: 4,
        previousScore: 60,
        newScore: 80,
      });
      expect(named.html).toContain('Vendor Lead');
    });

    test('buildRfqFinalComparisonEmail covers present and missing quote fields across rows', () => {
      const email = mailerService.buildRfqFinalComparisonEmail('buyer@x.com', {
        rfq: { rfqNumber: 'RFQ-FC-9', title: 'Pumps' },
        quotes: [
          { vendorName: 'V1', unitPrice: 100, leadTimeDays: 5, warrantyYears: 1, aiMatchScore: 90, complianceStatus: 'Compliant' },
          { vendorName: 'V2' }, // all optional fields missing => '-' branches
        ],
        recipientName: 'Buyer FC',
      });
      expect(email.html).toContain('V1');
      expect(email.html).toContain('V2');
    });

    test('sendOtpEmail with no expiry argument uses the default 10-minute window on the main module', async () => {
      const res = await mailerService.sendOtpEmail('nodefault@example.com', '1234');
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('sendOtpEmail builds the registration subject variant on the main module (deliver no-ops in test env)', async () => {
      // sendOtpEmail evaluates buildOtpEmail(...) as the argument to deliver()
      // before deliver's test-env short-circuit, so the registration branch is
      // exercised on the live module instance even though nothing is sent.
      const res = await mailerService.sendOtpEmail('newuser@example.com', '4321', 60, { isRegistration: true });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });
  });
});
