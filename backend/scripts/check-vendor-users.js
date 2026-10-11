'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../src/db/pool');

async function checkVendorCredentials() {
  try {
    const res = await pool.query(`
      SELECT id, email, name, role, raw_role_name, mobile, password, status, is_active, is_approved
      FROM users
      WHERE mobile LIKE '%9157154504%' OR email LIKE '%navin%' OR email LIKE '%procucev%'
    `);
    console.log('USERS FOUND:', JSON.stringify(res.rows, null, 2));

    const vendorsRes = await pool.query(`
      SELECT id, email, major_category, status, raw
      FROM vendors
      WHERE id LIKE '%9157154504%' OR email LIKE '%navin%' OR raw::text LIKE '%9157154504%'
    `);
    console.log('VENDORS FOUND:', JSON.stringify(vendorsRes.rows, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkVendorCredentials();
