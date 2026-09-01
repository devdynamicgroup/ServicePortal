/**
 * Regression suite for the Address Corruption Compounding fix (2026-09-01,
 * follow-up to the Contact Data Corruption fix in
 * scripts/test-contact-data-corruption-fix.js).
 *
 * Root cause: mapPreassessmentPayload() (services/case-creation-service.js)
 * only guarded against `addr` being EMPTY (the earlier fix). It had no guard
 * against `addr` already being a fully-composed address (or a legacy
 * city/postal-only placeholder left behind by the original bug) -- since
 * `ci-city`/`ci-postal` reset to hydration defaults on every load
 * (services/notion/mapper.js:358-359, never round-tripped from Notion),
 * blindly re-joining [addr, city, postal] on every resync keeps appending
 * another copy of the city, compounding worse with each save:
 *   "99 Sukhumvit Rd, ..., Bangkok 10110" -> "..., Bangkok 10110, Bangkok"
 *   "Bangkok, 10110" (legacy placeholder)  -> "Bangkok, 10110, Bangkok"
 *
 * Fix: addressHasLocationSuffix(addr, city) detects, narrowly and
 * deterministically (parameterized by the actual `city` value -- never a
 * hardcoded city name or Case ID), whether `addr` already ends with the
 * exact city/postal tail that would otherwise be (re-)appended, in either
 * the space-attached shape a fresh full address has ("...City 12345") or the
 * comma-separated shape a bare placeholder has ("City, 12345"). When true,
 * addr is returned completely unchanged -- never touched, truncated, or
 * rewritten.
 *
 * SCOPE: address-composition idempotency only.
 *   - No Case ID / customer name checks anywhere in the fix (verified by
 *     reading the diff -- addressHasLocationSuffix takes only addr/city).
 *   - Score Engine, Complete, LINE flow, ci-maps flow, UI: not touched.
 *   - services/case-creation-service.js: real module, required directly.
 *
 * Run: node scripts/test-address-compounding-fix.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { mapPreassessmentPayload, addressHasLocationSuffix } = require(path.join(ROOT, 'services/case-creation-service.js'));

let passed = 0;
let failed = 0;
function assert(cond, msg, detail) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }
}

function addr(fields) {
  return mapPreassessmentPayload({ fields }).address;
}

console.log('=== A: Empty addr -> still no placeholder generated (prior fix, must remain intact) ===');
{
  const payload = mapPreassessmentPayload({ fields: { 'ci-fname': 'X', 'ci-addr': '', 'ci-city': 'Bangkok', 'ci-postal': '10110' } });
  assert(!('address' in payload), 'empty addr -> address key omitted entirely, never "Bangkok, 10110"', payload);
}

console.log('\n=== B: Legacy city/postal-only placeholder -> stays exactly as-is, not extended ===');
{
  const result = addr({ 'ci-addr': 'Bangkok, 10110', 'ci-city': 'Bangkok', 'ci-postal': '' });
  assert(result === 'Bangkok, 10110', 'legacy placeholder "Bangkok, 10110" is returned unchanged, not "Bangkok, 10110, Bangkok"', result);
}

console.log('\n=== C: Repeated resync does not make address grow ===');
{
  let current = 'SMOKE-TEST-DELETE-ME 99 Sukhumvit Rd, Khlong Toei, Bangkok 10110';
  const lengths = [current.length];
  for (let i = 0; i < 5; i += 1) {
    current = addr({ 'ci-addr': current, 'ci-city': 'Bangkok', 'ci-postal': '' });
    lengths.push(current.length);
  }
  assert(lengths.every(len => len === lengths[0]), 'address length is stable across 5 repeated resyncs (no growth)', lengths);
  assert(current === 'SMOKE-TEST-DELETE-ME 99 Sukhumvit Rd, Khlong Toei, Bangkok 10110', 'address content identical after 5 resyncs', current);
}
{
  // Same idempotency check starting from the legacy placeholder shape.
  let current = 'Bangkok, 10110';
  for (let i = 0; i < 5; i += 1) {
    current = addr({ 'ci-addr': current, 'ci-city': 'Bangkok', 'ci-postal': '' });
  }
  assert(current === 'Bangkok, 10110', 'legacy placeholder does not grow across 5 repeated resyncs either', current);
}

console.log('\n=== D: Genuine (already-complete) street address is never touched ===');
{
  const FULL = 'SMOKE-TEST-DELETE-ME 99 Sukhumvit Rd, Khlong Toei, Bangkok 10110';
  const result = addr({ 'ci-addr': FULL, 'ci-city': 'Bangkok', 'ci-postal': '' });
  assert(result === FULL, 'already-complete address with space-attached city+postal tail is returned byte-identical', result);
}

console.log('\n=== E: Plain street address + distinct city/postal -> combines once, as originally intended ===');
{
  const result = addr({ 'ci-addr': '123 Test Street', 'ci-city': 'Nonthaburi', 'ci-postal': '11000' });
  assert(result === '123 Test Street, Nonthaburi, 11000', 'a fresh street-only addr still combines normally with city/postal on first composition', result);
}

console.log('\n=== F: Different city (non-Bangkok) -- guard generalizes, not hardcoded to "Bangkok" ===');
{
  const FULL = '50 Moo 1, Nonthaburi 11000';
  const result = addr({ 'ci-addr': FULL, 'ci-city': 'Nonthaburi', 'ci-postal': '' });
  assert(result === FULL, 'already-complete Nonthaburi address is left untouched too (guard is parameterized by city, not hardcoded)', result);
}
{
  const result = addr({ 'ci-addr': 'Nonthaburi, 11000', 'ci-city': 'Nonthaburi', 'ci-postal': '' });
  assert(result === 'Nonthaburi, 11000', 'legacy-style placeholder for a different city is likewise not extended', result);
}

console.log('\n=== G: Missing postal -- guard still works with city alone ===');
{
  const FULL = 'SMOKE-TEST-DELETE-ME 99 Sukhumvit Rd, Bangkok';
  const result = addr({ 'ci-addr': FULL, 'ci-city': 'Bangkok', 'ci-postal': '' });
  assert(result === FULL, 'address already ending in bare city name (no postal) is left untouched', result);
}

console.log('\n=== H: Missing city -- falls through to normal (pre-existing) join behavior, no crash ===');
{
  const result = addr({ 'ci-addr': '123 Test Street', 'ci-city': '', 'ci-postal': '11000' });
  assert(result === '123 Test Street, 11000', 'with no city, addr still combines normally with postal alone (unchanged pre-existing behavior)', result);
}
{
  let threw = null;
  try { addressHasLocationSuffix('123 Test Street', ''); } catch (e) { threw = e; }
  assert(!threw, 'addressHasLocationSuffix does not throw when city is empty', threw && threw.message);
}

console.log('\n=== I: Existing customer fields unaffected by this fix ===');
{
  const payload = mapPreassessmentPayload({
    fields: {
      'ci-fname': 'John', 'ci-lname': 'Doe', 'ci-phone': '0812345678',
      'ci-email': 'john@example.com', 'ci-addr': 'Bangkok, 10110', 'ci-city': 'Bangkok', 'ci-postal': ''
    }
  });
  assert(payload.fullName === 'John Doe', 'fullName unaffected', payload.fullName);
  assert(payload.phone === '0812345678', 'phone unaffected', payload.phone);
  assert(payload.email === 'john@example.com', 'email unaffected', payload.email);
}

console.log('\n=== J: Exact reproduction from the Smoke Case (current live Notion values) ===');
{
  const corruptedFields = {
    'ci-fname': 'SMOKE-TEST-DELETE-ME', 'ci-lname': 'S.', 'ci-phone': '+66812345678',
    'ci-line': 'smoketest-line-id', 'ci-email': 'smoketest-delete-me@water-motion.co',
    'ci-city': 'Bangkok', 'ci-postal': '', 'ci-addr': 'Bangkok, 10110', 'ci-proptype': 'Single House',
    'ci-propage': 'Not sure', 'ci-filter': 'None', 'ci-source': 'Google Search', 'ci-consent': false
  };
  const payload = mapPreassessmentPayload({ fields: corruptedFields });
  assert(payload.address === 'Bangkok, 10110', 'exact Smoke Case fields -> address stays "Bangkok, 10110", not "Bangkok, 10110, Bangkok"', payload.address);
  assert(payload.phone === '+66812345678' && payload.email === 'smoketest-delete-me@water-motion.co', 'other fields still pass through correctly', payload);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
