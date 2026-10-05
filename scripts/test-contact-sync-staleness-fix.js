#!/usr/bin/env node
'use strict';

/**
 * Regression for two related reports (2026-10-05):
 *
 * 1. "Edit saves, then reverts a moment later." goScreen('s-dash') awaits
 *    syncJobProfileToNotion() (stamps contactSyncedAt the instant the write
 *    POST returns 200), then immediately awaits loadJobsFromApi() -- a GET
 *    backed by Notion's dataSources.query (a list/filter read, not a direct
 *    page retrieve), whose index can lag a just-completed page write. Since
 *    syncedAt already >= dirtyAt by the time that GET lands,
 *    preferContactFields() used to hand the stale remote copy back as
 *    authoritative. An earlier fix tried a fixed 8s grace window; still not
 *    long enough -- reloading (F5) after waiting past it reproduced the
 *    revert again. preferContactFields() now trusts remote only once it
 *    actually matches what was written, never on elapsed time alone.
 *
 * 2. "Field shows the new value, but the OP LINE link still doesn't
 *    appear/still points at the old id." job.line.publicId
 *    (services/notion/mapper.js) is a second, independent read of the same
 *    raw "LINE ID" property that feeds draft.fields['ci-line'], but it was
 *    never routed through any freshness check at all -- every refresh blindly
 *    overwrote it from whatever (possibly lagging) response came back, even
 *    after fix #1 protected draft.fields. preferLinePublicId() closes the
 *    same gap for this second read, reusing ci-line's own
 *    contactFieldsDirtyAt/contactSyncedAt signal.
 *
 * Run: node scripts/test-contact-sync-grace-window.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/js/job-state.js'), 'utf8');

let passed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) {
  console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
}
function check(fn, name) {
  try { fn(); ok(name); } catch (e) { fail(name, e); }
}

function buildSandbox() {
  const fakeDocument = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const sandbox = {
    console,
    document: fakeDocument,
    window: {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    S: { activeJob: null, taps: [], tapData: [], pkg: 'essential' },
    AssessmentSnapshot: require(path.join(root, 'src/js/assessment-snapshot.js')),
    t: (k) => k,
    showToast: () => {},
    normalizeInterruptedPhoto: (p) => p
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'job-state.js' });
  return sandbox;
}

function draft(overrides = {}) {
  return { fields: {}, ...overrides };
}

const sb = buildSandbox();

assert.ok(!src.includes('CONTACT_SYNC_GRACE_MS'), 'the old fixed-timeout approach has been fully replaced (test in sync with the fix)');

console.log('=== preferContactFields: trust remote only once it actually matches the write ===');

check(() => {
  const local = draft({
    fields: { 'ci-line': 'newlineid' },
    contactFieldsDirtyAt: new Date(Date.now() - 2000).toISOString(),
    contactSyncedAt: new Date().toISOString() // write just confirmed
  });
  // GET fires moments later, before Notion's list-query index has caught up.
  const remote = draft({ fields: { 'ci-line': 'oldlineid' } });
  const result = sb.preferContactFields(local, remote);
  assert.deepStrictEqual(result, local.fields, 'a just-synced edit survives an immediate stale re-read, however soon it arrives');
}, 'Test 1: GET fired moments after a successful write still keeps the local edit');

check(() => {
  const local = draft({
    fields: { 'ci-line': 'newlineid' },
    contactFieldsDirtyAt: new Date(Date.now() - 120000).toISOString(),
    contactSyncedAt: new Date(Date.now() - 90000).toISOString() // synced 90s ago -- would have missed any fixed grace window
  });
  const remote = draft({ fields: { 'ci-line': 'oldlineid' } }); // still hasn't caught up, even after a long wait
  const result = sb.preferContactFields(local, remote);
  assert.deepStrictEqual(result, local.fields, 'local is kept no matter how long remote stays stale -- no timeout to outlast');
}, 'Test 2: an unusually slow Notion read no longer wins just because enough time passed');

check(() => {
  const local = draft({
    fields: { 'ci-line': 'newlineid' },
    contactFieldsDirtyAt: new Date(Date.now() - 5000).toISOString(),
    contactSyncedAt: new Date(Date.now() - 4000).toISOString()
  });
  const remote = draft({ fields: { 'ci-line': 'newlineid' } }); // Notion has actually caught up now
  const result = sb.preferContactFields(local, remote);
  assert.deepStrictEqual(result, remote.fields, 'once remote genuinely reflects the write, remote is trusted again (no permanent local lock-in)');
}, 'Test 3: remote wins again as soon as it actually matches (original Test C behavior preserved)');

check(() => {
  const local = draft({
    fields: { 'ci-addr': '123 Real St' },
    contactFieldsDirtyAt: new Date().toISOString() // edited now, never synced
  });
  const remote = draft({ fields: { 'ci-addr': 'Old Address' } });
  const result = sb.preferContactFields(local, remote);
  assert.deepStrictEqual(result, local.fields, 'an unsynced edit still wins outright');
}, 'Test 4: unsynced edit unaffected by the match-based check');

check(() => {
  const local = draft({ fields: { 'ci-addr': 'Stale cached value' } }); // no contactFieldsDirtyAt at all
  const remote = draft({ fields: { 'ci-addr': 'Live Notion value' } });
  const result = sb.preferContactFields(local, remote);
  assert.deepStrictEqual(result, remote.fields, 'no genuine edit on record -> remote still wins');
}, 'Test 5: no dirty signal at all -> remote still wins');

console.log('\n=== preferLinePublicId: OP LINE destination gets the same protection as draft.fields ===');

check(() => {
  // Baseline model: a successful authoritative sync makes NEW the server baseline.
  const T1 = '2026-10-05T17:00:00.000Z';
  const T2 = '2026-10-05T18:00:00.000Z';
  const job = { draft: { fields: { 'ci-line': 'oldlineid' }, lineIdServerValue: 'oldlineid', lineIdServerEditedTime: T1, lineIdDiffersFromServer: false } };
  sb.contactFieldsBaseline['ci-line'] = 'oldlineid';
  sb.S.activeJob = job;
  job.draft.fields['ci-line'] = 'newlineid';
  sb.markContactFieldDirtyIfChanged('ci-line', 'newlineid');
  assert.strictEqual(job.draft.lineIdServerValue, 'oldlineid', 'typing leaves the server baseline at OLD');
  assert.strictEqual(job.draft.lineIdDiffersFromServer, true, 'typing NEW flags a real difference');
  sb.applyLineIdServerState(job.draft, job.draft, 'newlineid', T2);
  assert.strictEqual(job.draft.lineIdServerValue, 'newlineid', 'successful sync: NEW becomes the server baseline');
  assert.strictEqual(job.draft.fields['ci-line'], 'newlineid');
  assert.strictEqual(job.draft.lineIdDiffersFromServer, false, 'successful sync clears the override');
  assert.strictEqual(sb.preferLinePublicId(job.draft, null, { publicId: 'newlineid' }), 'newlineid', 'publicId === NEW after sync');
  const staleRead = JSON.parse(JSON.stringify(job.draft));
  sb.applyLineIdServerState(staleRead, job.draft, 'oldlineid', T1);
  assert.strictEqual(sb.preferLinePublicId(staleRead, null, { publicId: 'oldlineid' }), 'newlineid', 'stale OLD response must NOT resurrect OLD over the authoritative NEW');
}, 'Test 6: successful sync makes NEW the baseline; a stale re-read does not resurrect OLD');

check(() => {
  const draftState = {
    contactFieldsDirtyAt: new Date(Date.now() - 5000).toISOString(),
    contactSyncedAt: new Date(Date.now() - 4000).toISOString()
  };
  const localLine = { publicId: 'newlineid' };
  const remoteLine = { publicId: 'newlineid' }; // caught up
  const result = sb.preferLinePublicId(draftState, localLine, remoteLine);
  assert.strictEqual(result, 'newlineid', 'once remote matches, remote (now identical) is returned');
}, 'Test 7: remote wins once it actually matches');

check(() => {
  const localLine = { publicId: 'stale-cached-id' };
  const remoteLine = { publicId: 'live-notion-id' };
  const result = sb.preferLinePublicId(undefined, localLine, remoteLine); // no draft at all -> no dirty signal
  assert.strictEqual(result, 'live-notion-id', 'no genuine edit recorded for this Case -> remote still wins');
}, 'Test 8: no dirty signal at all -> remote still wins for publicId too');

check(() => {
  // Field-level override, independent of the global dirty timestamp.
  const job = { draft: { fields: { 'ci-line': 'oldlineid' }, lineIdServerValue: 'oldlineid', lineIdDiffersFromServer: false } };
  sb.contactFieldsBaseline['ci-line'] = 'oldlineid';
  sb.S.activeJob = job;
  job.draft.fields['ci-line'] = 'newlineid';
  sb.markContactFieldDirtyIfChanged('ci-line', 'newlineid');
  assert.strictEqual(job.draft.lineIdServerValue, 'oldlineid');
  assert.strictEqual(job.draft.fields['ci-line'], 'newlineid');
  assert.strictEqual(job.draft.lineIdDiffersFromServer, true);
  const staleServer = JSON.parse(JSON.stringify(job.draft));
  sb.applyLineIdServerState(staleServer, job.draft, 'oldlineid');
  assert.strictEqual(sb.preferLinePublicId(staleServer, null, { publicId: 'oldlineid' }), 'newlineid', 'stale server re-read OLD: unsynced field-level override keeps NEW');
}, 'Test 9: unsynced LINE edit wins via the field-level baseline flag, not the global dirty timestamp');

console.log(`\n${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}`);
