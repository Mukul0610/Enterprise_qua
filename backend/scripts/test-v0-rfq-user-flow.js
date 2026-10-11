'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pool = require('../src/db/pool');
const identityQueries = require('../src/db/identityQueries');
const domainQueries = require('../src/db/domainQueries');
const storeService = require('../src/services/storeService');
const authService = require('../src/services/authService');
const smsService = require('../src/services/smsService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');

async function main() {
  console.log('====================================================');
  console.log(' V0 RFQ CREATION & LIVE SMS DISPATCH TO 9157154504');
  console.log('====================================================\n');

  // 1. Clear SMS throttle
  smsService.clearSmsThrottleCache();

  // 2. Hydrate database / store
  try {
    await storeService.hydrateFromDB();
    console.log(`[INIT] Store hydrated with ${storeService.vendors.length} vendors and ${storeService.rfqs.length} RFQs.`);
  } catch (err) {
    console.log(`[INIT] Store hydration note: ${err.message}`);
  }

  // 3. Ensure buyer account for manavyagnik7563@gmail.com
  const BUYER_EMAIL = 'manavyagnik7563@gmail.com';
  const BUYER_PHONE = '9000000001';
  const BUYER_NAME = 'Manav Yagnik';
  const BUYER_ORG = 'Manav Enterprise';

  let buyer = storeService.buyerAccounts.find(
    (b) => (b.corporateEmail || '').toLowerCase() === BUYER_EMAIL.toLowerCase()
  );

  if (!buyer) {
    console.log(`[BUYER] Creating buyer account for ${BUYER_EMAIL}...`);
    buyer = storeService.addBuyerAccount({
      organizationName: BUYER_ORG,
      corporateEmail: BUYER_EMAIL,
      contactPerson: BUYER_NAME,
      contactPhone: BUYER_PHONE,
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 10,
      sourcingMode: 'mode_0',
    });
  } else {
    console.log(`[BUYER] Found existing buyer account: ${buyer.organizationName} (${buyer.id})`);
  }

  // Also ensure identity row exists in Neon if DB connected
  try {
    let idUser = await identityQueries.findUserByEmail(BUYER_EMAIL);
    if (!idUser) {
      console.log(`[IDENTITY] Inserting buyer user in DB...`);
      idUser = await identityQueries.insertUser({
        email: BUYER_EMAIL,
        name: BUYER_NAME,
        password: 'Test@12345',
        role: 'buyer',
        rawRoleName: 'ClientInitiator',
        orgId: buyer.id,
        orgName: BUYER_ORG,
        mobile: `+91${BUYER_PHONE}`,
        status: 'ACTIVE',
        isActive: true,
        isApproved: true,
      });
    }
  } catch (err) {
    console.log(`[IDENTITY] Note: ${err.message}`);
  }

  // 4. Ensure Vendor 9157154504 exists with matched categories
  const VENDOR_PHONE = '9157154504';
  let vendor = storeService.vendors.find(
    (v) => v.phone === VENDOR_PHONE || v.mobile === VENDOR_PHONE || v.mobileNumber === VENDOR_PHONE
  );

  const TARGET_CATEGORY = 'IT';

  if (!vendor) {
    console.log(`[VENDOR] Registering vendor with phone ${VENDOR_PHONE}...`);
    vendor = storeService.addVendor({
      id: 'v-navin-9157154504',
      name: 'Navin Enterprise',
      contactPerson: 'Navin',
      email: 'navin.procucev@gmail.com',
      phone: VENDOR_PHONE,
      mobile: VENDOR_PHONE,
      majorCategory: TARGET_CATEGORY,
      minorCategories: ['Hardware', 'Software', 'Networking', 'Cloud Infrastructure'],
      source: 'self_registration',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      rating: 5.0,
      score: 95.0,
      evaluated: true,
      city: 'Ahmedabad',
      state: 'Gujarat',
      pincode: '380001',
    });
  } else {
    console.log(`[VENDOR] Found existing vendor: ${vendor.name} (${vendor.id}), ensuring majorCategory="${TARGET_CATEGORY}"`);
    vendor = storeService.updateVendor(vendor.id, {
      name: 'Navin Enterprise',
      majorCategory: TARGET_CATEGORY,
      minorCategories: ['Hardware', 'Software', 'Networking', 'Cloud Infrastructure'],
      phone: VENDOR_PHONE,
      mobile: VENDOR_PHONE,
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      source: 'platform_roster',
      addedByBuyerCompany: null,
      buyerAccountId: null,
      buyerId: null,
    });
  }

  console.log(`[DEBUG] vendor.isProcucevVendor: ${storeService.isProcucevVendor(vendor)}`);
  console.log(`[DEBUG] vendor.isBuyerUploaded: ${storeService.isBuyerUploaded(vendor)}`);
  console.log(`[DEBUG] vendorCoversCategory: ${storeService.vendorCoversCategory(vendor, TARGET_CATEGORY)}`);

  // 5. Create V0 RFQ matching category 'IT'
  console.log(`\n[RFQ] Creating V0 RFQ for category "${TARGET_CATEGORY}"...`);
  const rfqData = {
    title: 'Enterprise Server & Cloud Infrastructure Procurement',
    category: TARGET_CATEGORY,
    sourcingMode: 'mode_0',
    deliveryLocation: 'Ahmedabad, Gujarat',
    deliveryPincode: '380001',
    budget: 125000,
    targetDeliveryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    lineItems: [
      { description: 'Rack Mount Server Chassis 2U', quantity: 2, unit: 'units' },
      { description: 'Enterprise NVMe SSD 3.84TB', quantity: 8, unit: 'units' },
    ],
  };

  const createdRfq = storeService.createRFQ(rfqData, buyer);
  console.log(`[RFQ] Created RFQ: ${createdRfq.rfqNumber} (ID: ${createdRfq.id})`);
  console.log(`[RFQ] Sourcing Mode: ${createdRfq.sourcingMode}`);
  console.log(`[RFQ] Assigned Vendors Count: ${(createdRfq.assignedVendors || []).length}`);

  const isMatched = (createdRfq.assignedVendors || []).some(
    (v) => v.phone === VENDOR_PHONE || (v.id && v.id === vendor.id) || v.name === vendor.name
  );
  console.log(`[MATCHING] Is vendor ${VENDOR_PHONE} (${vendor.name}) matched to this RFQ? ${isMatched ? '✅ YES' : '❌ NO'}`);

  // 6. Send live SMS alert to vendor 9157154504
  console.log(`\n[SMS] Dispatching live RFQ Alert SMS to +91${VENDOR_PHONE}...`);
  console.log(`[SMS] Gateway URL: ${process.env.SMS_GATEWAY_URL}`);
  console.log(`[SMS] DLT Template ID: ${process.env.SMS_GATEWAY_RFQ_SMSGID || '1777179076323440961'}`);

  const smsResult = await smsService.sendRFQChaserSms({
    mobile: VENDOR_PHONE,
    vendorName: vendor.name,
    rfqNumber: createdRfq.rfqNumber,
    rfqTitle: createdRfq.title,
  });

  console.log('\n[SMS RESULT]:', JSON.stringify(smsResult, null, 2));

  if (smsResult.success) {
    console.log(`\n🎉 SUCCESS: Live RFQ alert SMS dispatched to vendor ${VENDOR_PHONE}!`);
  } else {
    console.log(`\n⚠️ DISPATCH FAILED: ${smsResult.error}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
