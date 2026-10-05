#!/usr/bin/env node
'use strict';

/**
 * Regression for the "edit saves, then reverts a moment later" report
 * (2026-10-05): goScreen('s-dash') awaits syncJobProfileToNotion() (stamps
 * contactSyncedAt the instant the write POST returns 200), then immediately
 * awaits loadJobsFromApi() (a fresh GET). If Notion's read path hasn't
 * caught up to the write yet, that GET can still return the pre-edit
 * fields -- and since syncedAt already >= dirtyAt at that point,
 * preferContactFields() used to hand that stale remote copy back as
 * authoritative, undoing the edit it had just confirmed.
 *
 * Fix: preferContactFields() now keeps local for a short grace window
 * after contactSyncedAt, even though syncedAt >= dirtyAt, so a refresh
 * racing the write-propagation delay can't undo it. Run: node
 * scripts/test-contact-sync-grace-window.js
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

assert.ok(src.includes('const CONTACT_SYNC_GRACE_MS = 8000;'), 'grace window constant is present in job-state.js (test in sync with the fix)');

console.log('=== preferContactFields: just-synced edit survives an immediate stale re-read ===');

check(() => {
  const local = draft({
    fields: { 'ci-line': 'newlineid' },
    contactFieldsDirtyAt: new Date(Date.now() - 2000).toISOString(), // edited 2s ago
    contactSyncedAt: new Date().toISOString() // write just confirmed, right now
  });
  // Simulates the GET that fires immediately after the write, before Notion's
  // read path has caught up -- it still reflects the pre-edit value.
  const remote = draft({ fields: { 'ci-line': 'oldlineid' } });
  const result = sb.preferContactFields(local, remote);
  assert.deepStrictEqual(result, local.fields, 'within the grace window, local (just-written) value is kept over a stale immediate re-read');
}, 'Test 1: GET fired moments after a successful write still keeps the local edit');

check(() => {
  const local = draft({
    fields: { 'ci-line': 'newlineid' },
    contactFieldsDirtyAt: new Date(Date.now() - 20000).toISOString(),
    contactSyncedAt: new Date(Date.now() - 15000).toISOString() // synced 15s ago -- outside the 8s grace window
  });
  const remote = draft({ fields: { 'ci-line': 'newlineid' } }); // Notion has caught up by now
  const result = sb.preferContactFields(local, remote);
  assert.deepStrictEqual(result, remote.fields, 'once the grace window has elapsed, remote is trusted again (no permanent local lock-in)');
}, 'Test 2: outside the grace window, remote wins again (original Test C behavior preserved)');

check(() => {
  const local = draft({
    fields: { 'ci-addr': '123 Real St' },
    contactFieldsDirtyAt: new Date().toISOString() // edited now, never synced
  });
  const remote = draft({ fields: { 'ci-addr': 'Old Address' } });
  const result = sb.preferContactFields(local, remote);
  assert.deepStrictEqual(result, local.fields, 'an unsynced edit still wins outright, independent of the grace window');
}, 'Test 3: unsynced edit unaffected by the grace-window change');

check(() => {
  const local = draft({ fields: { 'ci-addr': 'Stale cached value' } }); // no contactFieldsDirtyAt at all
  const remote = draft({ fields: { 'ci-addr': 'Live Notion value' } });
  const result = sb.preferContactFields(local, remote);
  assert.deepStrictEqual(result, remote.fields, 'no genuine edit on record -> remote still wins regardless of the grace window');
}, 'Test 4: no dirty signal at all -> remote still wins (grace window never applies)');

console.log(`\n${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}`);
