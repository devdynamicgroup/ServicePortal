'use strict';

/**
 * Regression suite for the "pkg doesn't persist" fix (2026-09-08).
 *
 * Root cause, forensically traced request -> route -> service -> mapper ->
 * Notion property -> read-back:
 *   POST /api/cases/:id/preassessment sends package: 'full'/'essential'
 *   -> mapPreassessmentPayload() carries it through as packageHistory
 *   -> buildNotionProperties()'s setSelect() helper only wrote a Notion
 *      { select: {...} } shape, but the live "Package History" property is
 *      actually type multi_select -- so the type check silently dropped the
 *      whole property from the write payload. The API call still returned
 *      200 (every other property still wrote fine), so nothing looked wrong
 *      at the HTTP layer.
 *
 * Two independent defects, both fixed:
 *  1. setSelect() (services/notion/clients.js) only understood `select`,
 *     not `multi_select`. Generalized to write the correct envelope for
 *     either actual schema type, for ANY field using it -- not a
 *     packageHistory-specific branch.
 *  2. Even with (1) fixed, the app's raw internal tokens ('full'/
 *     'essential') are not real Notion option names ("Full Assessment"/
 *     "Essential") -- writing them as-is would have created a stray new
 *     multi_select option instead of landing on the real one. Added
 *     packageOptionName() (services/notion/mapper.js) as the inverse of the
 *     existing read-side mapPackage(), applied once centrally in
 *     pickCustomerInput() (services/case-creation-service.js) so both
 *     producers of packageHistory (the staff-app preassessment sync AND the
 *     manual-case skipMap create path) get it for free.
 *
 * Run: node scripts/test-package-history-write.js
 *
 * Pure/safe unit coverage only (no network, no Notion) -- this is what
 * generic regression commands should run. The live production round-trip
 * that used to be "test 8" in this file was split out on 2026-09-09
 * (test-script isolation safety pass, after re-running it accidentally
 * created production Cases) to scripts/manual-prod/verify-package-history-live.js,
 * which is NOT safe to run generically and creates a real Case every time.
 */

const { buildNotionProperties } = require('../services/notion/clients');
const { mapPackage, packageOptionName } = require('../services/notion/mapper');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

console.log('\n=== 1. Existing `select` fields still write exactly as before ===');
{
  const schema = { 'Source': { type: 'select' }, 'Current Filter': { type: 'select' } };
  const props = buildNotionProperties({ source: 'LINE', currentFilter: 'None' }, schema);
  assert(props['Source']?.select?.name === 'LINE', 'a real `select` property still writes { select: { name } }');
  assert(props['Current Filter']?.select?.name === 'None', 'a second real `select` property is unaffected by the multi_select branch');
}

console.log('\n=== 2. `multi_select` Package History now writes successfully ===');
{
  const schema = { 'Package History': { type: 'multi_select' } };
  const props = buildNotionProperties({ packageHistory: 'Full Assessment' }, schema);
  assert(Array.isArray(props['Package History']?.multi_select), 'multi_select property gets the { multi_select: [...] } envelope');
  assert(props['Package History']?.multi_select?.[0]?.name === 'Full Assessment', 'the option name round-trips unchanged into the array');
}

console.log('\n=== 3. "full"/"essential" normalize to the real Notion option names ===');
{
  assert(packageOptionName('full') === 'Full Assessment', `internal 'full' -> 'Full Assessment' (got "${packageOptionName('full')}")`);
  assert(packageOptionName('essential') === 'Essential', `internal 'essential' -> 'Essential' (got "${packageOptionName('essential')}")`);
  assert(packageOptionName('FULL') === 'Full Assessment', 'normalization is case-insensitive on the input token');
  assert(packageOptionName('Premium') === 'Premium', 'an already-real option name (not one of the two internal tokens) passes through unchanged');
  assert(packageOptionName('') === '', 'empty input stays empty (no accidental default)');
}

console.log('\n=== 4. Read-back: mapPackage() correctly reads a multi_select value back ===');
{
  assert(mapPackage('Full Assessment') === 'full', 'reading "Full Assessment" back resolves to internal token \'full\'');
  assert(mapPackage('Essential') === 'essential', 'reading "Essential" back resolves to internal token \'essential\'');
  assert(mapPackage('Premium') === 'full', 'reading "Premium" back also resolves to \'full\' (existing substring-match behavior, unchanged)');
}

console.log('\n=== 5. Other Case fields are unaffected (no regression on a mixed update) ===');
{
  const schema = {
    'Package History': { type: 'multi_select' },
    'Source': { type: 'select' },
    'Phone': { type: 'phone_number' },
    'Notes': { type: 'rich_text' }
  };
  const props = buildNotionProperties({
    packageHistory: 'Full Assessment',
    source: 'LINE',
    phone: '0812345678'
  }, schema);
  assert(props['Package History']?.multi_select?.[0]?.name === 'Full Assessment', 'packageHistory writes correctly alongside other fields');
  assert(props['Source']?.select?.name === 'LINE', 'select field in the same update is unaffected');
  assert(props['Phone']?.phone_number === '0812345678', 'a non-select field (setText path) in the same update is unaffected');
}

console.log('\n=== 6. Schema mismatch still fails safe (no garbage property sent) ===');
{
  // A field aliased to setSelect but whose real Notion type is neither
  // select nor multi_select (e.g. rich_text) must still be silently
  // skipped, never sent in some invalid shape.
  const schema = { 'Package History': { type: 'rich_text' } };
  const props = buildNotionProperties({ packageHistory: 'Full Assessment' }, schema);
  assert(Object.keys(props).length === 0, 'a select-aliased field backed by an unsupported real type sends nothing, not a malformed write');
}

console.log('\n=== 7. Missing property in schema is a no-op, not a throw ===');
{
  const props = buildNotionProperties({ packageHistory: 'Full Assessment' }, {});
  assert(Object.keys(props).length === 0, 'an empty schema (property not found) produces no properties and does not throw');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
