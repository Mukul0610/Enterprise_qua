'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const whatsAppService = require('../src/services/whatsAppService');

async function testWhatsApp() {
  whatsAppService.clearWhatsAppThrottleCache();
  console.log('Testing WhatsApp notification to 9157154504...');
  const res = await whatsAppService.sendRFQInvitationWhatsApp({
    phone: '9157154504',
    vendorName: 'Navin Enterprise',
    rfqNumber: 'RFQ260910168889',
    rfqTitle: 'Enterprise Server & Cloud Infrastructure Procurement',
  });
  console.log('WhatsApp Result:', JSON.stringify(res, null, 2));
}

testWhatsApp();
