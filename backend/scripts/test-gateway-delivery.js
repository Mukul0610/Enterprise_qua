'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const TARGET_MOBILE = '9157154504';
const GATEWAY_URL = 'https://sms.sendmsg.in/datasend';

async function sendRawSms(label, user, pass, smsgid, text) {
  console.log(`\n--- Testing ${label} ---`);
  console.log(`User: ${user}, SMSGID: ${smsgid}`);
  console.log(`Text: ${text}`);

  const payload = {
    user,
    pass,
    smstosend: [
      {
        to: `91${TARGET_MOBILE}`,
        from: 'PROCUC',
        smstext: text,
        smsgid,
      },
    ],
  };

  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    console.log(`HTTP ${res.status} Response:`, body);
  } catch (err) {
    console.error(`Fetch error:`, err.message);
  }
}

async function runTests() {
  console.log(`Target phone: +91${TARGET_MOBILE}`);

  // Test 1: OTP Template (Known working transactional DLT)
  await sendRawSms(
    'OTP Template (Procucev_OTP / 1102294821)',
    'Procucev_OTP',
    'TzlzyMcFEZRF',
    '1102294821',
    'OTP for registering your access to Get My quoTe (GMT): 482910. Valid for 5 mins. Do not share. - Team Procucev.'
  );

  // Test 2: RFQ Template with SMSGID 1777179076323440961 (from .env)
  await sendRawSms(
    'RFQ Template (ProcucevWapp1 / 1777179076323440961)',
    'ProcucevWapp1',
    'ProcucevWapp@123',
    '1777179076323440961',
    'RFQ Alert RFQ260910168889: You are invited to bid for Enterprise Server & Cloud Infrastructure Procurement. Submit quote : https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/vendor/quotation-form?rfq=RFQ260910168889 - Team Procucev.'
  );

  // Test 3: RFQ Template with SMSGID 1777179100456823380 (from wrangler.jsonc)
  await sendRawSms(
    'RFQ Template (ProcucevWapp1 / 1777179100456823380 from wrangler)',
    'ProcucevWapp1',
    'ProcucevWapp@123',
    '1777179100456823380',
    'RFQ Alert RFQ260910168889: You are invited to bid for Enterprise Server & Cloud Infrastructure Procurement. Submit quote : https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/vendor/quotation-form?rfq=RFQ260910168889 - Team Procucev.'
  );

  // Test 4: RFQ Template with Procucev_OTP user account
  await sendRawSms(
    'RFQ Template via Procucev_OTP user',
    'Procucev_OTP',
    'TzlzyMcFEZRF',
    '1777179076323440961',
    'RFQ Alert RFQ260910168889: You are invited to bid for Enterprise Server & Cloud Infrastructure Procurement. Submit quote : https://procucev-enterprise-frontend.procucev-enterprise.workers.dev/vendor/quotation-form?rfq=RFQ260910168889 - Team Procucev.'
  );
}

runTests();
