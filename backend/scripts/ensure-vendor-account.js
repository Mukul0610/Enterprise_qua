'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const identityQueries = require('../src/db/identityQueries');
const pool = require('../src/db/pool');

async function main() {
  const VENDOR_EMAIL = 'navin.procucev@gmail.com';
  const VENDOR_PHONE = '9157154504';
  const VENDOR_PASS = 'Test@12345';
  const VENDOR_NAME = 'Navin Enterprise';
  const VENDOR_ORG = 'Navin Enterprise';

  console.log(`Checking vendor user account for ${VENDOR_EMAIL}...`);
  try {
    let user = await identityQueries.findUserByEmail(VENDOR_EMAIL);
    if (!user) {
      console.log('Inserting vendor user account...');
      const created = await identityQueries.insertVendorAccount({
        email: VENDOR_EMAIL,
        password: VENDOR_PASS,
        phone: VENDOR_PHONE,
        fullName: VENDOR_NAME,
        organizationName: VENDOR_ORG,
        createdBy: 'test-setup',
      });
      console.log('Created vendor user result:', created);
    } else {
      console.log('Updating password for existing vendor user...');
      await identityQueries.updateUserPasswordByUuid(user.id, VENDOR_PASS, 'test-setup');
    }

    const verify = await identityQueries.findUserByEmail(VENDOR_EMAIL);
    console.log('Final verification:', {
      found: !!verify,
      email: verify?.email,
      mobile: verify?.mobile,
      role: verify?.role,
      passwordMatches: identityQueries.verifyStoredPassword(VENDOR_PASS, verify?.password),
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
