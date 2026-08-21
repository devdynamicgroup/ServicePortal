/**
 * Cold reload / durable Case restoration — forensic coverage gap closure.
 * Loads the REAL src/js/job-state.js (unmodified) into two SEPARATE vm
 * sandboxes: one to persist Case A + Case B state (simulating the running
 * app before reload), and a second, fresh sandbox with empty in-memory
 * state but the SAME localStorage backing store (simulating a cold
 * reload/restart) to prove restoreActiveCaseFromPersistence() reconstructs
 * the correct Case without cross-Case leakage or state resurrection.
 * No production Notion record, no real Case, no live browser session.
 * Run: node tests/persistence/cold-reload-case-restoration.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function fakeEl() {
  return {
    value: '', checked: false, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    textContent: '', tagName: 'DIV', options: [],
    querySelectorAll: () => [], querySelector: () => null,
    removeAttribute() {}, setAttribute() {}
  };
}

/** A real, shared, in-memory localStorage — persists across sandbox rebuilds
 * within one process, exactly like real browser localStorage persists across
 * a page reload while JS heap state does not. This IS the mechanism under test. */
function makeSharedLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
}

function buildSandbox(sharedLocalStorage, jobsArray) {
  const domStub = { getElementById: () => fakeEl(), querySelectorAll: () => [], querySelector: () => null, createElement: () => fakeEl() };
  const sandbox = {
    console,
    window: {},
    document: domStub,
    navigator: { userAgent: 'node' },
    localStorage: sharedLocalStorage,
    S: { activeJob: null, tapData: [], taps: [] },
    t: (k) => k,
    JOBS: jobsArray,
    AssessmentSnapshot: { draftHasMeasurements: () => false },
    scheduleAssessmentSync: () => {},
    setDataSource: () => {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join('D:/Service Portal', 'src', 'js', 'job-state.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'job-state.js' });
  return sandbox;
}

function realisticJob(id, notionId, extra = {}) {
  return {
    id, notionId, status: 'new', date: '2026-09-01',
    draft: null,
    ...extra
  };
}

async function main() {
  const sharedLS = makeSharedLocalStorage();

  // ---- Phase 1: "before reload" -- build Case A and Case B with real,
  // distinguishable state, and persist everything a real running session would.
  const before = buildSandbox(sharedLS, []);
  const caseA = realisticJob('case-A', 'notion-A-111');
  const caseB = realisticJob('case-B', 'notion-B-222');
  before.JOBS.push(caseA, caseB);

  before.loadJobState(caseA);
  before.S.taps = ['Kitchen-A'];
  before.S.tapData = [{ tasks: { meter: true }, photos: {}, meterReadings: { ph: '7.1', tds: '410' } }];
  before.S.scoreBaseReadings = { ph: 7.1, tds: 410 };
  before.S.activeJob = caseA;
  before.saveActiveJobState();          // writes S.* back into caseA.draft
  before.persistActiveCaseRef(caseA);   // persists { id, notionId, date } to localStorage

  before.loadJobState(caseB);
  before.S.taps = ['Guest-B'];
  before.S.tapData = [{ tasks: {}, photos: {}, meterReadings: { ph: '6.2', tds: '900' } }];
  before.S.scoreBaseReadings = { ph: 6.2, tds: 900 };
  before.S.activeJob = caseB;
  before.saveActiveJobState();

  // Persist the full JOBS array the way persistJobs() does (JSON.stringify to 'wm-jobs').
  sharedLS.setItem('wm-jobs', JSON.stringify(before.JOBS));

  check(caseA.draft.taps[0] === 'Kitchen-A', 'sanity: Case A draft persisted its own taps before reload');
  check(caseB.draft.taps[0] === 'Guest-B', 'sanity: Case B draft persisted its own taps before reload');

  // ---- Phase 2: COLD RELOAD -- brand-new sandbox, brand-new S/JOBS (empty),
  // same localStorage backing store. This is the actual invariant under test:
  // the durable ref (wm-active-case-ref) currently points at Case A.
  const after = buildSandbox(sharedLS, []);
  const restoredFromStorage = after.loadJobsFromStorage();
  check(restoredFromStorage === true, 'loadJobsFromStorage reconstructs JOBS from durable localStorage after cold reload');
  check(after.JOBS.length === 2, 'both Cases survive the cold reload (got ' + after.JOBS.length + ')');

  const restored = after.restoreActiveCaseFromPersistence();
  check(restored != null, 'restoreActiveCaseFromPersistence returns a Case (not null) when a valid ref exists');
  check(restored.notionId === 'notion-A-111', 'restores the CORRECT Case (A, the one active before reload), not B (got ' + restored?.notionId + ')');
  check(after.S.activeJob === restored, 'S.activeJob is set to the restored Case object');
  check(after.S.taps[0] === 'Kitchen-A', 'restored taps belong to Case A, not Case B or defaults (got ' + JSON.stringify(after.S.taps) + ')');
  check(after.S.tapData[0].meterReadings.ph === '7.1', 'restored meterReadings.ph belongs to Case A (7.1), not B\'s 6.2 (got ' + after.S.tapData[0]?.meterReadings?.ph + ')');
  check(after.S.tapData[0].meterReadings.tds === '410', 'restored meterReadings.tds belongs to Case A (410), not B\'s 900');
  check(restored.notionId === caseA.notionId, 'notionId is the ORIGINAL durable identity, not regenerated (got ' + restored.notionId + ' vs original ' + caseA.notionId + ')');
  check(after.S.currentScoreResult === undefined || after.S.currentScoreResult === null, 'currentScoreResult must not resurrect a stale Hero value on cold reload (got ' + JSON.stringify(after.S.currentScoreResult) + ')');

  // Case B must be reachable (not lost) but NOT the one auto-selected.
  const caseBAfterReload = after.JOBS.find(j => j.notionId === 'notion-B-222');
  check(Boolean(caseBAfterReload), 'Case B still exists in reconstructed JOBS (not lost)');
  check(caseBAfterReload.draft.taps[0] === 'Guest-B', 'Case B\'s own persisted draft is intact and uncontaminated by Case A');

  // ---- Negative / partial-state tests ----

  // 1. Missing persisted draft -- restoreActiveCaseFromPersistence must not crash,
  //    and must not silently invent taps from another Case.
  {
    const lsNoDraft = makeSharedLocalStorage();
    const sb = buildSandbox(lsNoDraft, []);
    const bareJob = { id: 'bare-1', notionId: 'notion-bare-1', status: 'new', date: '2026-09-02' }; // no .draft at all
    sb.JOBS.push(bareJob);
    lsNoDraft.setItem('wm-jobs', JSON.stringify(sb.JOBS));
    sb.persistActiveCaseRef(bareJob);
    let threw = false;
    let result;
    try { result = sb.restoreActiveCaseFromPersistence(); } catch (e) { threw = true; }
    check(threw === false, 'missing draft: restoreActiveCaseFromPersistence must not throw');
    check(result != null && result.notionId === 'notion-bare-1', 'missing draft: still restores the correct Case identity');
    check(Array.isArray(sb.S.taps) && sb.S.taps.length === 0, 'missing draft: does not fabricate taps from nowhere (S.taps stays empty, untouched)');
  }

  // 2. Incomplete draft (draft exists but taps array is empty/absent).
  {
    const ls2 = makeSharedLocalStorage();
    const sb = buildSandbox(ls2, []);
    const incompleteJob = { id: 'incomplete-1', notionId: 'notion-incomplete-1', status: 'new', date: '2026-09-03', draft: { pkg: 'essential' } };
    sb.JOBS.push(incompleteJob);
    ls2.setItem('wm-jobs', JSON.stringify(sb.JOBS));
    sb.persistActiveCaseRef(incompleteJob);
    let threw = false;
    try { sb.restoreActiveCaseFromPersistence(); } catch (e) { threw = true; }
    check(threw === false, 'incomplete draft (no taps key): restoreActiveCaseFromPersistence must not throw');
  }

  // 3. Malformed persisted ref (garbage JSON in localStorage).
  {
    const ls3 = makeSharedLocalStorage();
    const sb = buildSandbox(ls3, []);
    ls3.setItem('wm-active-case-ref', '{not valid json');
    let threw = false;
    let result;
    try { result = sb.restoreActiveCaseFromPersistence(); } catch (e) { threw = true; }
    check(threw === false, 'malformed ref JSON: must not throw');
    check(result === null, 'malformed ref JSON: safely returns null (no Case falsely restored)');
  }

  // 4. Missing Case (ref points to a Case that no longer exists in JOBS).
  {
    const ls4 = makeSharedLocalStorage();
    const sb = buildSandbox(ls4, []);
    ls4.setItem('wm-active-case-ref', JSON.stringify({ id: 'ghost-case', notionId: 'notion-ghost', date: '2026-09-04' }));
    // JOBS intentionally left empty -- the referenced Case does not exist.
    let threw = false;
    let result;
    try { result = sb.restoreActiveCaseFromPersistence(); } catch (e) { threw = true; }
    check(threw === false, 'ref to nonexistent Case: must not throw');
    check(result === null, 'ref to nonexistent Case: safely returns null, no phantom Case restored');
  }

  // 5. No ref at all (first-ever load, nothing persisted yet).
  {
    const ls5 = makeSharedLocalStorage();
    const sb = buildSandbox(ls5, []);
    let threw = false;
    let result;
    try { result = sb.restoreActiveCaseFromPersistence(); } catch (e) { threw = true; }
    check(threw === false, 'no persisted ref at all: must not throw');
    check(result === null, 'no persisted ref at all: returns null (nothing to restore)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
