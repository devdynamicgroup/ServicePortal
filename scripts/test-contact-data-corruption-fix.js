/**
 * Regression suite for the Contact Data Corruption fix (2026-09-01), found
 * during the SMOKE-TEST-DELETE-ME E2E run (Case 3ce9a92dfb618112ad7ddd22bae57f77):
 * after Assessment/Score/Send-Result/navigation and a full page reload, the
 * real Notion "Address" property degraded from a full street address to
 * "Bangkok, 10110", and "Full Name" degraded from "SMOKE-TEST-DELETE-ME
 * SMOKETEST" to "SMOKE-TEST-DELETE-ME S." -- confirmed server-side via direct
 * Notion API read, not a client-cache-only artifact.
 *
 * Two independent, code-verified mechanisms, fixed here:
 *   Fix 1 (src/js/job-state.js, collectLocalJobDrafts()): localStorage
 *     ingestion could unconditionally overwrite a live JOBS entry with no
 *     recency check at all, letting a stale snapshot (carrying its own
 *     outdated contactFieldsDirtyAt/contactSyncedAt) silently replace fresher
 *     live state before preferContactFields() ever saw it.
 *   Fix 2 (services/case-creation-service.js, mapPreassessmentPayload()):
 *     address was unconditionally reconstructed from ci-addr + ci-city +
 *     ci-postal on every save; city/postal are hydration hardcoded defaults
 *     (never real Notion data), so a momentarily-empty ci-addr degraded a
 *     real saved address down to just "Bangkok, 10110".
 *
 * SCOPE: contact-data persistence only.
 *   - Score Engine: NOT imported, NOT touched.
 *   - services/case-creation-service.js: real module, required directly
 *     (mapPreassessmentPayload is a pure function, no Notion I/O).
 *   - src/js/job-state.js: real script, loaded via Node's vm module (same
 *     technique as scripts/test-contact-field-freshness.js) -- collectLocalJobDrafts()
 *     is exercised directly, not reimplemented.
 *
 * Run: node scripts/test-contact-data-corruption-fix.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg, detail) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }
}

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Fix 2 tests: mapPreassessmentPayload (real module, pure function)
// ---------------------------------------------------------------------------
const { mapPreassessmentPayload } = require(path.join(ROOT, 'services/case-creation-service.js'));

console.log('=== C: full address + default city/postal -> full address preserved on repeat save ===');
{
  const FULL_ADDR = 'SMOKE-TEST-DELETE-ME 99 Sukhumvit Rd, Khlong Toei, Bangkok 10110';
  const payload = mapPreassessmentPayload({
    fields: { 'ci-fname': 'SMOKE-TEST-DELETE-ME', 'ci-addr': FULL_ADDR, 'ci-city': 'Bangkok', 'ci-postal': '' }
  });
  assert(payload.address.startsWith(FULL_ADDR), 'address still contains the full original street address, not just city/postal', payload.address);
  assert(!/^Bangkok, ?10110$/.test(payload.address), 'address is not reduced to the bare "Bangkok, 10110" placeholder', payload.address);
}
// Repeat the same save a second time (simulating a resync) -- must remain stable, not further truncated.
{
  const FULL_ADDR = 'SMOKE-TEST-DELETE-ME 99 Sukhumvit Rd, Khlong Toei, Bangkok 10110';
  const first = mapPreassessmentPayload({ fields: { 'ci-fname': 'X', 'ci-addr': FULL_ADDR, 'ci-city': 'Bangkok', 'ci-postal': '' } });
  const second = mapPreassessmentPayload({ fields: { 'ci-fname': 'X', 'ci-addr': FULL_ADDR, 'ci-city': 'Bangkok', 'ci-postal': '' } });
  assert(first.address === second.address, 'repeat save with identical input produces an identical (idempotent) address', { first: first.address, second: second.address });
}

console.log('\n=== D (core corruption reproduction): addr momentarily empty -> address key omitted, existing Notion value never downgraded ===');
{
  // This is the EXACT corrupted-moment shape observed live: ci-addr empty,
  // city/postal are the hydration-hardcoded defaults.
  const payload = mapPreassessmentPayload({
    fields: { 'ci-fname': 'SMOKE-TEST-DELETE-ME', 'ci-lname': 'SMOKETEST', 'ci-addr': '', 'ci-city': 'Bangkok', 'ci-postal': '10110' }
  });
  assert(!('address' in payload), 'address key is omitted entirely when addr is empty (pickCustomerInput will not touch the existing Notion property)', payload);
}
{
  // Sanity: confirm pickCustomerInput really does drop it end-to-end (not
  // just "falsy" but literally absent from the object sent to Notion).
  const payload = mapPreassessmentPayload({ fields: { 'ci-fname': 'X', 'ci-addr': '' } });
  assert(Object.prototype.hasOwnProperty.call(payload, 'address') === false, 'address is genuinely absent as an own property, not present-but-empty', payload);
}

console.log('\n=== E: Full Name is never reduced to a partial/truncated name ===');
{
  const payload = mapPreassessmentPayload({ fields: { 'ci-fname': 'SMOKE-TEST-DELETE-ME', 'ci-lname': 'SMOKETEST' } });
  assert(payload.fullName === 'SMOKE-TEST-DELETE-ME SMOKETEST', 'full name combines fname+lname completely, no truncation', payload.fullName);
}
{
  // The exact corrupted value found live must never be produced from a
  // payload that actually supplies the real last name.
  const payload = mapPreassessmentPayload({ fields: { 'ci-fname': 'SMOKE-TEST-DELETE-ME', 'ci-lname': 'SMOKETEST' } });
  assert(payload.fullName !== 'SMOKE-TEST-DELETE-ME S.', 'fullName is not the corrupted "S." abbreviation when the real last name is supplied', payload.fullName);
}

console.log('\n=== F: phone/email unaffected by the address fix ===');
{
  const payload = mapPreassessmentPayload({
    fields: { 'ci-fname': 'X', 'ci-phone': '+66812345678', 'ci-email': 'x@example.com', 'ci-addr': '' }
  });
  assert(payload.phone === '+66812345678', 'phone passes through unchanged even when address is omitted', payload.phone);
  assert(payload.email === 'x@example.com', 'email passes through unchanged even when address is omitted', payload.email);
}

console.log('\n=== H: exact SMOKE-TEST-DELETE-ME pattern reproduced through the real (fixed) function ===');
{
  // The precise corrupted state confirmed live in Notion for Case
  // 3ce9a92dfb618112ad7ddd22bae57f77: local draft.fields had ci-addr already
  // collapsed to '' by the time this hypothetical resync would have fired.
  const corruptedFields = {
    'ci-fname': 'SMOKE-TEST-DELETE-ME', 'ci-lname': 'S.', 'ci-phone': '+66812345678',
    'ci-line': 'smoketest-line-id', 'ci-email': 'smoketest-delete-me@water-motion.co',
    'ci-city': 'Bangkok', 'ci-postal': '', 'ci-addr': '', 'ci-proptype': 'Single House',
    'ci-propage': 'Not sure', 'ci-filter': 'None', 'ci-source': 'Google Search', 'ci-consent': false
  };
  const payload = mapPreassessmentPayload({ fields: corruptedFields });
  assert(!('address' in payload), 'with the exact corrupted field snapshot, address is omitted rather than sent as "Bangkok, 10110"', payload);
  assert(payload.phone === '+66812345678' && payload.email === 'smoketest-delete-me@water-motion.co', 'other real fields still pass through correctly even in this exact scenario', payload);
}

// ---------------------------------------------------------------------------
// Fix 1 tests: collectLocalJobDrafts (real script via vm)
// ---------------------------------------------------------------------------
function buildJobStateSandbox({ jobs, localStorageJobs } = {}) {
  const storage = {};
  if (localStorageJobs !== undefined) storage['wm-jobs'] = JSON.stringify(localStorageJobs);
  const sandbox = {
    console,
    JOBS: jobs || [],
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = v; },
      removeItem: (k) => { delete storage[k]; }
    },
    document: { getElementById: () => null },
    window: {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(ROOT, 'src/js/job-state.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'job-state.js' });
  return sandbox;
}

console.log('\n=== A: live JOBS newer than localStorage -> localStorage must NOT overwrite ===');
{
  const sb = buildJobStateSandbox({
    jobs: [{ id: 'case1', notionId: 'n1', draft: { localEditedAt: '2026-09-01T10:00:00.000Z', fields: { 'ci-addr': 'FULL LIVE ADDRESS' } } }],
    localStorageJobs: [{ id: 'case1', notionId: 'n1', draft: { localEditedAt: '2026-09-01T09:00:00.000Z', fields: { 'ci-addr': 'STALE CACHED ADDRESS' } } }]
  });
  const drafts = sb.collectLocalJobDrafts();
  const draft = drafts.get('case1');
  assert(!!draft, 'a draft was found for case1', drafts);
  assert(draft.fields['ci-addr'] === 'FULL LIVE ADDRESS', 'newer live JOBS state wins over older localStorage snapshot', draft?.fields);
}

console.log('\n=== B: localStorage newer than live JOBS -> localStorage used normally ===');
{
  const sb = buildJobStateSandbox({
    jobs: [{ id: 'case1', notionId: 'n1', draft: { localEditedAt: '2026-09-01T09:00:00.000Z', fields: { 'ci-addr': 'OLDER LIVE ADDRESS' } } }],
    localStorageJobs: [{ id: 'case1', notionId: 'n1', draft: { localEditedAt: '2026-09-01T10:00:00.000Z', fields: { 'ci-addr': 'NEWER CACHED ADDRESS' } } }]
  });
  const drafts = sb.collectLocalJobDrafts();
  const draft = drafts.get('case1');
  assert(draft.fields['ci-addr'] === 'NEWER CACHED ADDRESS', 'genuinely newer localStorage snapshot is used normally (not blocked)', draft?.fields);
}

console.log('\n=== Tie / equal timestamps -> live JOBS kept (no unnecessary swap) ===');
{
  const sb = buildJobStateSandbox({
    jobs: [{ id: 'case1', notionId: 'n1', draft: { localEditedAt: '2026-09-01T10:00:00.000Z', fields: { 'ci-addr': 'LIVE' } } }],
    localStorageJobs: [{ id: 'case1', notionId: 'n1', draft: { localEditedAt: '2026-09-01T10:00:00.000Z', fields: { 'ci-addr': 'CACHED' } } }]
  });
  const draft = sb.collectLocalJobDrafts().get('case1');
  assert(draft.fields['ci-addr'] === 'LIVE', 'equal timestamps keep the live JOBS entry, not the localStorage one', draft?.fields);
}

console.log('\n=== Missing localEditedAt on both sides -> no crash, live JOBS kept (legacy-draft safe default) ===');
{
  const sb = buildJobStateSandbox({
    jobs: [{ id: 'case1', notionId: 'n1', draft: { fields: { 'ci-addr': 'LIVE, NO TIMESTAMP' } } }],
    localStorageJobs: [{ id: 'case1', notionId: 'n1', draft: { fields: { 'ci-addr': 'CACHED, NO TIMESTAMP' } } }]
  });
  const draft = sb.collectLocalJobDrafts().get('case1');
  assert(draft.fields['ci-addr'] === 'LIVE, NO TIMESTAMP', 'when neither side has localEditedAt, live JOBS is kept (safe default, no regression for legacy drafts)', draft?.fields);
}

console.log('\n=== H (client-side): the exact Smoke Case shape -- stale localStorage must not resurrect old data over fresher live state ===');
{
  const sb = buildJobStateSandbox({
    jobs: [{
      id: '3ce9a92dfb618112ad7ddd22bae57f77', notionId: '3ce9a92d-fb61-8112-ad7d-dd22bae57f77',
      draft: { localEditedAt: '2026-09-01T03:52:00.000Z', fields: { 'ci-fname': 'SMOKE-TEST-DELETE-ME', 'ci-lname': 'SMOKETEST', 'ci-addr': 'SMOKE-TEST-DELETE-ME 99 Sukhumvit Rd, Khlong Toei, Bangkok 10110' } }
    }],
    localStorageJobs: [{
      id: '3ce9a92dfb618112ad7ddd22bae57f77', notionId: '3ce9a92d-fb61-8112-ad7d-dd22bae57f77',
      draft: { localEditedAt: '2026-09-01T03:30:00.000Z', fields: { 'ci-fname': 'SMOKE-TEST-DELETE-ME', 'ci-lname': '', 'ci-addr': '' } }
    }]
  });
  const draft = sb.collectLocalJobDrafts().get('3ce9a92dfb618112ad7ddd22bae57f77');
  assert(draft.fields['ci-addr'].includes('Sukhumvit'), 'the fresher, complete live draft wins over an older, empty-address localStorage snapshot for this exact Case', draft?.fields);
  assert(draft.fields['ci-lname'] === 'SMOKETEST', 'last name likewise not reverted to empty by the stale snapshot', draft?.fields);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
