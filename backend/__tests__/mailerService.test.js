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
      });
      expect(email1.to).toBe('vendor@test.com');
      expect(email1.subject).toContain('Tata Steel has mapped your supply categories');
      expect(email1.html).toContain('Rajesh');
      expect(email1.html).toContain('Ball Valves');

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
      });
      expect(email.to).toBe('vendor@test.com');
      expect(email.subject).toBe('Complete Your Category Mapping to Receive Enquiries');
      expect(email.html).toContain('Suresh');
      expect(email.html).toContain('L&T');

      const emailFallback = mailerService.buildVendorSelfMappingEmail({ to: 'v@test.com' });
      expect(emailFallback.html).toContain('Hello,');
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
      expect(mailerService.buyerPortalUrl()).toBe('http://localhost:3000/login');

      process.env.APP_PUBLIC_URL = 'https://app.procucev.com/';
      expect(mailerService.buyerPortalUrl()).toBe('https://app.procucev.com/login');
      delete process.env.APP_PUBLIC_URL;
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
  });
});


