/**
 * Regression coverage for the contact-field freshness fix (2026-08-31 root
 * cause: services/notion/mapper.js rebuilds draft.fields LIVE from Notion
 * on every request, so remote never goes stale on its own -- the bug was
 * that AssessmentSnapshot.preferDraft's tie-break defaulted to "local wins"
 * whenever neither side had measurements yet, which is true for every
 * not-yet-assessed Case, so a stale/empty local draft cached from an
 * earlier incomplete load could shadow Notion's fully-populated contact
 * data indefinitely).
 *
 * The fix adds two client-only markers to src/js/job-state.js:
 *   - contactFieldsDirtyAt: stamped ONLY when a ci-* field's value genuinely
 *     changes from what it held right after the last hydration
 *     (markContactFieldDirtyIfChanged) -- never from navigation, render, or
 *     hydration itself.
 *   - contactSyncedAt: stamped only on a confirmed successful write
 *     (syncJobProfileToNotion).
 * preferContactFields() then decides local-vs-remote fields purely on
 * whether a genuine edit is still unsynced -- never on field count.
 *
 * This file loads the REAL src/js/job-state.js via Node's vm module (same
 * technique as scripts/qa-create-case-line-same-user.js uses for browser-only
 * flow files) with a minimal DOM/global shim -- not a reimplementation, the
 * actual function text is executed. Only preferContactFields and
 * markContactFieldDirtyIfChanged (both pure or near-pure, no network/Notion
 * I/O) are exercised; nothing touches real Notion or creates a Case.
 *
 * Run: node scripts/test-contact-field-freshness.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
function check(fn, name) { try { fn(); ok(name); } catch (e) { fail(name, e); } }

const AssessmentSnapshot = require('../src/js/assessment-snapshot.js');

// ---- minimal DOM shim: only getElementById + a settable-value element ----
function makeFakeElement(initialValue = '') {
  return {
    _value: initialValue,
    get value() { return this._value; },
    set value(v) { this._value = v; },
    type: 'text',
    tagName: 'INPUT',
    addEventListener() {},
    closest() { return null; }
  };
}

function buildSandbox() {
  const elements = {};
  const fakeDocument = {
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const sandbox = {
    console,
    document: fakeDocument,
    window: {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    S: { activeJob: null, taps: [], tapData: [], pkg: 'essential' },
    AssessmentSnapshot,
    // job-state.js references these across functions this file never calls;
    // stubs only, never exercised by the functions under test.
    t: (k) => k,
    showToast: () => {},
    normalizeInterruptedPhoto: (p) => p,
    fastDeepCloneUnused: undefined,
    __elements: elements
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/js/job-state.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'job-state.js' });
  return sandbox;
}

function draft(overrides = {}) {
  return { fields: {}, ...overrides };
}

(async () => {
  console.log('=== preferContactFields: pure freshness decision ===');
  const sb1 = buildSandbox();

  check(() => {
    const local = draft({ fields: {} }); // Test A: new Case, no genuine edit ever
    const remote = draft({ fields: { 'ci-fname': 'Water', 'ci-addr': 'Bangkok, 10110' } });
    const result = sb1.preferContactFields(local, remote);
    assert.deepStrictEqual(result, remote.fields, 'no local edit signal at all -> remote (always-live Notion state) wins');
  }, 'Test A: new Case, local has no genuine edit -> remote wins');

  check(() => {
    const local = draft({
      fields: { 'ci-addr': '123 Real St' },
      contactFieldsDirtyAt: '2026-08-31T10:00:00.000Z' // edited, never synced
    });
    const remote = draft({ fields: { 'ci-addr': 'Bangkok, 10110' } });
    const result = sb1.preferContactFields(local, remote);
    assert.deepStrictEqual(result, local.fields, 'genuine unsynced edit -> local wins');
  }, 'Test B: genuine local edit, never synced -> local wins');

  check(() => {
    const local = draft({
      fields: { 'ci-addr': '123 Real St' },
      contactFieldsDirtyAt: '2026-08-31T10:00:00.000Z',
      contactSyncedAt: '2026-08-31T10:05:00.000Z' // synced AFTER the edit
    });
    const remote = draft({ fields: { 'ci-addr': '123 Real St' } });
    const result = sb1.preferContactFields(local, remote);
    assert.deepStrictEqual(result, remote.fields, 'edit already confirmed synced -> remote wins (reflects the same data anyway)');
  }, 'Test C: local edit already synced -> remote wins');

  check(() => {
    // Test D / Test E-of-the-original-bug-report: EQUAL completeness (5/5
    // fields both sides), remote is the fresher one, local has no genuine
    // edit recorded -- this is the exact original bug scenario.
    const fiveFields = { 'ci-fname': 'A', 'ci-lname': 'B', 'ci-phone': '0800000000', 'ci-email': 'a@b.com', 'ci-addr': 'Old Address' };
    const local = draft({ fields: fiveFields }); // stale cache, fully "complete" but never genuinely edited
    const remote = draft({ fields: { ...fiveFields, 'ci-addr': 'New Correct Address' } }); // Notion's current, equally complete, but different
    const result = sb1.preferContactFields(local, remote);
    assert.deepStrictEqual(result, remote.fields, 'equal completeness must NOT decide this -- remote (fresher, no unsynced local edit) wins');
  }, 'Test D: equal completeness, no genuine local edit -> remote wins (the original bug, now closed)');

  check(() => {
    // Old cache from before this fix shipped: no contactFieldsDirtyAt key exists at all.
    const local = draft({ fields: { 'ci-fname': 'Old', 'ci-addr': 'Old Address' } });
    const remote = draft({ fields: { 'ci-fname': 'New', 'ci-addr': 'New Address' } });
    const result = sb1.preferContactFields(local, remote);
    assert.deepStrictEqual(result, remote.fields, 'missing timestamp must never be treated as "edited now" -- remote wins');
  }, 'Test J: old cache with no contactFieldsDirtyAt at all -> remote wins, never treated as fresh');

  console.log('\n=== markContactFieldDirtyIfChanged: genuine-edit detection ===');

  check(() => {
    // Calls the REAL loadJobState() end-to-end (not a simulation of its
    // baseline lines) -- a mutation-testing gap found during Phase 14:
    // an earlier version of this test set contactFieldsBaseline directly
    // and never invoked loadJobState() at all, so a mutation planted inside
    // loadJobState() itself (stamping contactFieldsDirtyAt during hydration)
    // went undetected. Every ci-*/m-*/fb-* id loadJobState touches via
    // writeField/readField needs a fake element pre-registered.
    const sb = buildSandbox();
    sb.__elements['ci-addr'] = makeFakeElement();
    sb.__elements['ci-fname'] = makeFakeElement();
    const job = { id: 'case-1', draft: draft({ fields: { 'ci-addr': 'Bangkok, 10110', 'ci-fname': 'Water' } }) };
    sb.S.activeJob = job;
    sb.loadJobState(job);
    assert.strictEqual(sb.__elements['ci-addr'].value, 'Bangkok, 10110', 'sanity check: loadJobState actually ran and hydrated the DOM');
    assert.strictEqual(job.draft.contactFieldsDirtyAt, undefined, 'loadJobState (hydration) must never itself stamp a dirty timestamp, no matter what it touches internally');
  }, 'Test F: hydration (baseline capture) never stamps contactFieldsDirtyAt');

  check(() => {
    const sb = buildSandbox();
    sb.S.activeJob = { id: 'case-1', draft: draft() };
    // Simulate loadJobState's hydration baseline capture directly (the real
    // function touches many unrelated DOM pieces this shim doesn't provide;
    // this exercises the exact same baseline-reset lines in isolation).
    sb.contactFieldsBaseline = { 'ci-addr': 'Bangkok, 10110' };
    // Genuine edit: value differs from the hydration baseline.
    sb.markContactFieldDirtyIfChanged('ci-addr', '123 New St, Bangkok');
    assert.ok(sb.S.activeJob.draft.contactFieldsDirtyAt, 'a value that differs from the hydration baseline must stamp contactFieldsDirtyAt');
  }, 'Test G: an actual edit (value differs from hydration baseline) stamps contactFieldsDirtyAt');

  check(() => {
    const sb = buildSandbox();
    sb.S.activeJob = { id: 'case-1', draft: draft() };
    sb.contactFieldsBaseline = { 'ci-addr': 'Bangkok, 10110' };
    // Re-saving the SAME value the field was hydrated with (e.g. navigation
    // re-triggering a save without any real edit).
    sb.markContactFieldDirtyIfChanged('ci-addr', 'Bangkok, 10110');
    assert.strictEqual(sb.S.activeJob.draft.contactFieldsDirtyAt, undefined, 'identical value (old === new) must NOT stamp a dirty timestamp');
  }, 'Test H / Test E: same-value re-assignment (navigation without edit) does not stamp contactFieldsDirtyAt');

  check(() => {
    const sb = buildSandbox();
    sb.S.activeJob = { id: 'case-1', draft: draft() };
    sb.contactFieldsBaseline = { 'ci-addr': 'Bangkok, 10110' };
    // A non-contact field id (measurement) must be ignored entirely by this function.
    sb.markContactFieldDirtyIfChanged('m-ph', '7.2');
    assert.strictEqual(sb.S.activeJob.draft.contactFieldsDirtyAt, undefined, 'a measurement field id must never trigger contactFieldsDirtyAt (Test K: measurement isolation)');
  }, 'Test K: a measurement field id (m-ph) never stamps contactFieldsDirtyAt');

  console.log('\n=== Reload / merge preserves markers (Test I) ===');
  check(() => {
    const sb = buildSandbox();
    const localJob = {
      id: 'case-1',
      status: 'in_progress',
      draft: draft({ fields: { 'ci-addr': 'Edited Address' }, contactFieldsDirtyAt: '2026-08-31T10:00:00.000Z' })
    };
    const apiCase = { id: 'case-1', draft: draft({ fields: { 'ci-addr': 'Old Notion Address' } }), workflow: {} };
    sb.mergeApiCaseIntoJob(localJob, apiCase);
    assert.strictEqual(localJob.draft.contactFieldsDirtyAt, '2026-08-31T10:00:00.000Z', 'contactFieldsDirtyAt must survive a merge/reload, not be silently dropped');
    assert.strictEqual(localJob.draft.fields['ci-addr'], 'Edited Address', 'the still-unsynced local edit must win through the full mergeApiCaseIntoJob path, not just the pure preferContactFields function');
  }, 'Test I: reload/merge preserves contactFieldsDirtyAt and keeps the unsynced edit');

  console.log('\n=== Measurement freshness untouched by this fix (Test K, other direction) ===');
  check(() => {
    const sb = buildSandbox();
    const localJob = {
      id: 'case-1',
      status: 'scheduled',
      draft: draft({
        tapData: [{ tasks: {}, photos: {}, meterReadings: { ph: 7.2 } }],
        assessmentUpdatedAt: '2026-08-31T09:00:00.000Z',
        assessmentRevision: 2
      })
    };
    const apiCase = {
      id: 'case-1',
      draft: draft({ tapData: [{ tasks: {}, photos: {} }], assessmentUpdatedAt: '2026-08-31T08:00:00.000Z', assessmentRevision: 1 }),
      workflow: {}
    };
    sb.mergeApiCaseIntoJob(localJob, apiCase);
    assert.strictEqual(localJob.draft.tapData[0].meterReadings.ph, 7.2, 'measurement freshness logic (AssessmentSnapshot.preferDraft) is untouched by the contact-fields fix -- newer local measurement still wins on its own terms');
  }, 'Test K (reverse): changing/preferring contact fields never disturbs measurement freshness decisions');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
