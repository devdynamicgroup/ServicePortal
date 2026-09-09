'use strict';

/**
 * Regression suite for the Customer Domain repository's schema-aware
 * setSelect() fix (2026-09-09 M8.1 safety-hardening pass).
 *
 * Same defect class as the Case repository's packageHistory bug
 * (services/notion/clients.js, fixed 2026-09-08): setSelect() hardcoded
 * `type === 'select'`, so a Customers DB property configured as
 * multi_select (e.g. "Status") would have every write silently dropped --
 * no error, the property just never appears in the accepted Notion
 * payload. Fixed the same way: write the correct envelope for whichever
 * real schema type the property actually is.
 *
 * Pure/in-memory only -- buildCustomerProperties() takes a plain schema
 * object and payload, no Notion I/O. Does NOT require NOTION_CUSTOMERS_DATABASE_ID
 * or any real Customer to exist.
 *
 * Run: node scripts/test-customer-domain-schema-write.js
 */

const { buildCustomerProperties } = require('../services/customer-domain/repository');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

console.log('\n=== 1. select property ===');
{
  const schema = { 'Status': { type: 'select' } };
  const props = buildCustomerProperties({ status: 'active' }, schema);
  assert(props['Status']?.select?.name === 'active', 'a real select property writes { select: { name } }');
}

console.log('\n=== 2. multi_select property ===');
{
  const schema = { 'Status': { type: 'multi_select' } };
  const props = buildCustomerProperties({ status: 'active' }, schema);
  assert(Array.isArray(props['Status']?.multi_select), 'a multi_select property gets the { multi_select: [...] } envelope');
  assert(props['Status']?.multi_select?.[0]?.name === 'active', 'the option name round-trips unchanged into the array');
}

console.log('\n=== 3. wrong property type (schema mismatch fails safe) ===');
{
  const schema = { 'Status': { type: 'rich_text' } };
  const props = buildCustomerProperties({ status: 'active' }, schema);
  assert(Object.keys(props).length === 0, 'a select-aliased field backed by an unsupported real type sends nothing, not a malformed write');
}

console.log('\n=== 4. empty value ===');
{
  const schema = { 'Status': { type: 'select' } };
  const propsEmpty = buildCustomerProperties({ status: '' }, schema);
  assert(Object.keys(propsEmpty).length === 0, 'empty string value produces no property (existing empty-value behavior preserved)');
  const propsUndefined = buildCustomerProperties({}, schema);
  assert(Object.keys(propsUndefined).length === 0, 'missing/undefined value produces no property');
}

console.log('\n=== 5. schema property missing entirely ===');
{
  const props = buildCustomerProperties({ status: 'active' }, {});
  assert(Object.keys(props).length === 0, 'property not found in schema at all -- no-op, does not throw');
}

console.log('\n=== 6. Other Customer fields unaffected (no regression on a mixed write) ===');
{
  const schema = {
    'Status': { type: 'multi_select' },
    'Full Name': { type: 'title' },
    'Phone': { type: 'phone_number' },
    'LINE Linked': { type: 'checkbox' }
  };
  const props = buildCustomerProperties({
    status: 'active',
    displayName: 'Test Customer',
    phone: '0812345678',
    lineLinked: true
  }, schema);
  assert(props['Status']?.multi_select?.[0]?.name === 'active', 'status writes correctly alongside other fields');
  assert(props['Full Name']?.title?.[0]?.text?.content === 'Test Customer', 'title field (setText path) unaffected');
  assert(props['Phone']?.phone_number === '0812345678', 'phone field (setText path) unaffected');
  assert(props['LINE Linked']?.checkbox === true, 'checkbox field (setCheckbox path) unaffected');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
