/**
 * OP LINE publicId reconciliation with a persisted server baseline.
 * Loads the REAL src/js/job-state.js in vm. Covers hydration, edit, clear,
 * revert, reload (draft round-trip), server change after revert, phone-only
 * edit, sync success/failure, legacy drafts, Case isolation, and verified
 * LINE identity isolation.
 *
 * Run: node scripts/test-op-line-publicid-shadow.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/js/job-state.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(fn, name) {
  try { fn(); passed += 1; console.log(`  ok    ${name}`); }
  catch (e) { failed += 1; console.error(`  FAIL  ${name}: ${e.message}`); }
}

function makeEnv() {
  const sb = {
    console,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    window: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    S: { taps: [], tapData: [], pkg: 'essential', activeJob: null },
    t: (k) => k,
    showToast() {},
    AssessmentSnapshot: { preferDraft: () => null, draftHasMeasurements: () => false },
    normalizeInterruptedPhoto: (p) => p
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'job-state.js' });
  return sb;
}

const OLD = '0924061974fern';
const NEW = '0960297415fern';
const SERVER_NEW = '0811111111fern';

// A persisted draft as the app would store it after a successful hydration.
function hydratedDraft(sb, serverLine, extraFields = {}) {
  const draft = { fields: { 'ci-line': serverLine, ...extraFields } };
  sb.applyLineIdServerState(draft, undefined, serverLine);
  return draft;
}

// Operator types into ci-line: mirrors the real input path.
function typeLine(sb, job, value) {
  sb.S.activeJob = job;
  sb.contactFieldsBaseline['ci-line'] = job.draft.fields['ci-line'];
  job.draft.fields['ci-line'] = value;
  sb.markContactFieldDirtyIfChanged('ci-line', value);
}

// Persist/reload round trip: JSON, as localStorage would.
function reload(draft) { return JSON.parse(JSON.stringify(draft)); }

function publicIdAfterLoad(sb, draft, serverLine) {
  // loadJobsFromApi/mergeApiCaseIntoJob path: re-reconcile against server.
  const next = reload(draft);
  sb.applyLineIdServerState(next, draft, serverLine);
  return { publicId: sb.preferLinePublicId(next, null, { publicId: serverLine }), draft: next };
}

const sb = makeEnv();

console.log('=== hydration and reload ===');
check(() => {
  const d = hydratedDraft(sb, OLD);
  assert.strictEqual(d.lineIdServerValue, OLD);
  assert.strictEqual(d.lineIdDiffersFromServer, false);
  const { publicId } = publicIdAfterLoad(sb, d, OLD);
  assert.strictEqual(publicId, OLD);
}, 'Test 1: untouched server ID survives reload');

check(() => {
  const job = { id: 'a', draft: hydratedDraft(sb, OLD) };
  typeLine(sb, job, NEW);
  assert.strictEqual(job.draft.lineIdServerValue, OLD, 'typing never overwrites the server baseline');
  const { publicId, draft } = publicIdAfterLoad(sb, job.draft, OLD);
  assert.strictEqual(publicId, NEW, 'local NEW survives reload');
  assert.strictEqual(draft.lineIdDiffersFromServer, true);
}, 'Test 2: unsaved local NEW survives reload');

check(() => {
  const job = { id: 'a', draft: hydratedDraft(sb, OLD) };
  typeLine(sb, job, '');
  assert.strictEqual(job.draft.lineIdDiffersFromServer, true, 'clear is a real difference');
  const { publicId } = publicIdAfterLoad(sb, job.draft, OLD);
  assert.strictEqual(publicId, '', 'intentional clear survives reload; OLD does not reappear');
}, 'Test 3: intentional clear survives reload');

check(() => {
  const job = { id: 'a', draft: hydratedDraft(sb, OLD) };
  typeLine(sb, job, NEW);
  typeLine(sb, job, OLD);
  assert.strictEqual(job.draft.lineIdDiffersFromServer, false, 'revert clears the override');
  const { publicId } = publicIdAfterLoad(sb, job.draft, OLD);
  assert.strictEqual(publicId, OLD);
}, 'Test 4: edit then revert clears the override');

check(() => {
  const job = { id: 'a', draft: hydratedDraft(sb, OLD) };
  typeLine(sb, job, NEW);
  typeLine(sb, job, OLD);
  const { publicId } = publicIdAfterLoad(sb, job.draft, SERVER_NEW);
  assert.strictEqual(publicId, SERVER_NEW, 'server change after a revert wins; old edit does not shadow it');
}, 'Test 5: server change after revert wins (the historical-shadow regression)');

check(() => {
  const job = { id: 'a', draft: hydratedDraft(sb, OLD, { 'ci-phone': '0800000000' }) };
  job.draft.fields['ci-line'] = '';
  sb.S.activeJob = job;
  sb.markContactFieldDirtyIfChanged('ci-phone', '0811111111');
  assert.strictEqual(job.draft.lineIdDiffersFromServer, false, 'phone edit does not flag ci-line');
  const { publicId } = publicIdAfterLoad(sb, job.draft, OLD);
  assert.strictEqual(publicId, OLD);
}, 'Test 6: phone-only edit does not shadow the LINE ID');

check(() => {
  const job = { id: 'a', draft: hydratedDraft(sb, OLD) };
  sb.S.activeJob = job;
  sb.markContactFieldDirtyIfChanged('ci-addr', 'New street');
  assert.strictEqual(job.draft.lineIdDiffersFromServer, false, 'address edit does not flag ci-line');
}, 'Test 7: address-only edit does not flag the LINE ID');

console.log('\n=== sync lifecycle ===');
check(() => {
  const job = { id: 'a', draft: hydratedDraft(sb, OLD) };
  typeLine(sb, job, NEW);
  // Successful authoritative response carries NEW.
  sb.applyLineIdServerState(job.draft, job.draft, NEW);
  assert.strictEqual(job.draft.lineIdDiffersFromServer, false, 'successful sync clears the override');
  assert.strictEqual(job.draft.lineIdServerValue, NEW, 'baseline follows the confirmed server value');
  const { publicId } = publicIdAfterLoad(sb, job.draft, NEW);
  assert.strictEqual(publicId, NEW);
}, 'Test 8: successful sync updates the baseline and clears the override');

check(() => {
  const job = { id: 'a', draft: hydratedDraft(sb, OLD) };
  typeLine(sb, job, NEW);
  // Failed sync: no authoritative response, so no reconciliation runs.
  const { publicId } = publicIdAfterLoad(sb, job.draft, OLD);
  assert.strictEqual(publicId, NEW, 'failed sync keeps the override across reload');
}, 'Test 9: failed sync keeps the override');

console.log('\n=== compatibility and isolation ===');
check(() => {
  const legacy = { fields: { 'ci-line': '' } }; // draft saved before this change
  const { publicId } = publicIdAfterLoad(sb, legacy, OLD);
  assert.strictEqual(publicId, OLD, 'legacy draft with empty ci-line resolves to the server ID');
}, 'Test 10: old localStorage draft (no new fields) loads safely to the server ID');

check(() => {
  const a = { id: 'A', draft: hydratedDraft(sb, OLD) };
  typeLine(sb, a, '');
  const b = { id: 'B', draft: hydratedDraft(sb, 'OTHERID1234') };
  assert.strictEqual(publicIdAfterLoad(sb, a.draft, OLD).publicId, '', 'Case A keeps its own clear');
  assert.strictEqual(publicIdAfterLoad(sb, b.draft, 'OTHERID1234').publicId, 'OTHERID1234', 'Case B is unaffected');
}, 'Test 11: Case A override cannot leak into Case B');

check(() => {
  const job = { id: 'a', draft: hydratedDraft(sb, OLD), line: { linked: true, displayName: 'Nattakamon fern', userId: 'U123' } };
  typeLine(sb, job, NEW);
  assert.strictEqual(job.line.displayName, 'Nattakamon fern');
  assert.strictEqual(job.line.userId, 'U123');
  assert.strictEqual(job.line.linked, true);
}, 'Test 12: verified LINE identity fields are untouched by the publicId path');

console.log('\n=== server freshness (lastEditedTime) ===');
const T1 = '2026-10-05T17:00:00.000Z';
const T2 = '2026-10-05T18:00:00.000Z';
const T3 = '2026-10-05T19:00:00.000Z';
check(() => {
  const d = {}; sb.applyLineIdServerState(d, undefined, OLD, T1);
  assert.strictEqual(d.lineIdServerEditedTime, T1, 'first hydration stores the server freshness');
  assert.strictEqual(d.lineIdServerValue, OLD);
  assert.strictEqual(d.lineIdDiffersFromServer, false);
}, 'Freshness 1: first hydration establishes baseline and freshness');

check(() => {
  const job = { draft: hydratedDraft(sb, OLD) };
  job.draft.lineIdServerEditedTime = T1;
  typeLine(sb, job, NEW);
  assert.strictEqual(job.draft.lineIdServerValue, OLD, 'typing does not change the server baseline');
  assert.strictEqual(job.draft.lineIdServerEditedTime, T1, 'typing does not change server freshness');
}, 'Freshness 2: unsynced edit leaves baseline and freshness untouched');

check(() => {
  // Successful sync OLD@T1 -> NEW@T2, then a stale GET returns OLD@T1.
  const d = { fields: { 'ci-line': NEW }, lineIdServerValue: NEW, lineIdServerEditedTime: T2, lineIdDiffersFromServer: false };
  const stale = JSON.parse(JSON.stringify(d));
  sb.applyLineIdServerState(stale, d, OLD, T1);
  assert.strictEqual(stale.lineIdServerValue, NEW, 'stale OLD@T1 cannot roll the baseline back');
  assert.strictEqual(stale.lineIdServerEditedTime, T2, 'stale read cannot roll freshness back');
  assert.strictEqual(sb.preferLinePublicId(stale, null, { publicId: OLD }), NEW, 'publicId stays NEW');
}, 'Freshness 3 (stale read): OLD@T1 after NEW@T2 keeps NEW');

check(() => {
  // NEW@T2, then an independent legitimate change SERVER_NEW@T3.
  const d = { fields: { 'ci-line': NEW }, lineIdServerValue: NEW, lineIdServerEditedTime: T2, lineIdDiffersFromServer: false };
  const next = JSON.parse(JSON.stringify(d));
  sb.applyLineIdServerState(next, d, SERVER_NEW, T3);
  assert.strictEqual(next.lineIdServerValue, SERVER_NEW, 'a newer server change is accepted');
  assert.strictEqual(next.lineIdServerEditedTime, T3);
  assert.strictEqual(sb.preferLinePublicId(next, null, { publicId: SERVER_NEW }), SERVER_NEW);
}, 'Freshness 4 (legitimate later change): SERVER_NEW@T3 wins after NEW@T2');

check(() => {
  // Equal freshness is accepted (>=), so a re-read of the same version is idempotent.
  const d = { fields: { 'ci-line': NEW }, lineIdServerValue: NEW, lineIdServerEditedTime: T2, lineIdDiffersFromServer: false };
  const same = JSON.parse(JSON.stringify(d));
  sb.applyLineIdServerState(same, d, NEW, T2);
  assert.strictEqual(same.lineIdServerValue, NEW);
}, 'Freshness 5: equal freshness is accepted and idempotent');

check(() => {
  // Failed sync: no authoritative response, so the baseline and freshness do not advance.
  const job = { draft: { fields: { 'ci-line': OLD }, lineIdServerValue: OLD, lineIdServerEditedTime: T1, lineIdDiffersFromServer: false } };
  typeLine(sb, job, NEW);
  assert.strictEqual(job.draft.lineIdServerEditedTime, T1, 'failed sync leaves freshness at T1');
  const after = publicIdAfterLoad(sb, job.draft, OLD);
  assert.strictEqual(after.publicId, NEW, 'failed sync keeps the local override');
}, 'Freshness 6: failed sync keeps baseline, freshness and override');

check(() => {
  // Legacy draft (no freshness fields) with a response that has no freshness either.
  const legacy = { fields: { 'ci-line': '' } };
  const d = {}; sb.applyLineIdServerState(d, legacy, OLD, undefined);
  assert.strictEqual(d.lineIdServerValue, OLD, 'legacy draft adopts the server value');
  assert.strictEqual(d.lineIdDiffersFromServer, false, 'missing state is never a user clear');
}, 'Freshness 7: legacy draft without freshness loads to the server value');

check(() => {
  // Malformed freshness is treated as unknown, never as newer.
  const d = { fields: { 'ci-line': NEW }, lineIdServerValue: NEW, lineIdServerEditedTime: T2, lineIdDiffersFromServer: false };
  const bad = JSON.parse(JSON.stringify(d));
  sb.applyLineIdServerState(bad, d, OLD, 'not-a-date');
  assert.strictEqual(bad.lineIdServerValue, NEW, 'an unparseable freshness value cannot overwrite a confirmed baseline');
}, 'Freshness 8: malformed freshness is not treated as newer');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
