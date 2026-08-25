/**
 * Regression suite for A3 (session-expiry UX) and A4 (loadJobsFromApi race)
 * from the weird-user-behavior QA pass (2026-08-25).
 *
 *   A3  Case-flow API calls (Complete, score-publish, assessment autosave,
 *       Start) showed a generic error toast on a 401 instead of calling the
 *       existing handleSessionExpired(). Fixed by adding a shared
 *       isSessionExpiredResponse() check at each call site -- no new
 *       authentication logic, reuses the existing handleSessionExpired().
 *
 *   A4  goScreen('s-dash') fires an un-awaited loadJobsFromApi() on every
 *       call; two overlapping calls (fast screen-switching) had no
 *       ordering guard, so an older response could overwrite JOBS after a
 *       newer response already applied. Fixed with a generation counter
 *       checked immediately before the JOBS mutation.
 *
 * Extracts the REAL functions out of the real source files via regex (same
 * technique already used in test-logout-data-cleanup.js for this same
 * file), rather than reimplementing them, and drives them with a
 * controllable fake fetch/DOM.
 *
 * Run: node scripts/test-weird-qa-a3-a4-fixes.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const ROOT = 'D:/Service Portal';

// ---------------------------------------------------------------------------
// A3 -- isSessionExpiredResponse() + handleSessionExpired() idempotency
// ---------------------------------------------------------------------------
async function runA3() {
  console.log('=== A3: session-expiry helpers (real source, extracted) ===');
  const authSrc = fs.readFileSync(path.join(ROOT, 'src/js/flows/auth.js'), 'utf8');

  const guardMatch = authSrc.match(/let _sessionExpiredHandled = false;/);
  const expiredMatch = authSrc.match(/function handleSessionExpired\(message\) \{[\s\S]*?\n\}/);
  const checkMatch = authSrc.match(/function isSessionExpiredResponse\(response, payload\) \{[\s\S]*?\n\}/);
  assert(!!guardMatch, '_sessionExpiredHandled guard variable found in auth.js (test in sync)');
  assert(!!expiredMatch, 'handleSessionExpired() found in auth.js (test in sync)');
  assert(!!checkMatch, 'isSessionExpiredResponse() found in auth.js (test in sync)');
  if (!guardMatch || !expiredMatch || !checkMatch) return;

  const calls = { clearAppSession: 0, goScreen: [], setLoginMessage: [] };
  const sandbox = {
    console,
    S: { user: { username: 'kittichai' } },
    clearAppSession: () => { calls.clearAppSession += 1; sandbox.S.user = null; },
    goScreen: (id) => calls.goScreen.push(id),
    setLoginMessage: (msg) => calls.setLoginMessage.push(msg)
  };
  vm.createContext(sandbox);
  vm.runInContext(guardMatch[0], sandbox, { filename: 'auth.js (_sessionExpiredHandled excerpt)' });
  vm.runInContext(expiredMatch[0], sandbox, { filename: 'auth.js (handleSessionExpired excerpt)' });
  vm.runInContext(checkMatch[0], sandbox, { filename: 'auth.js (isSessionExpiredResponse excerpt)' });

  // --- isSessionExpiredResponse() truth table ---
  const cases = [
    { response: { status: 401 }, payload: {}, expect: true, label: 'HTTP 401, no code' },
    { response: { status: 200 }, payload: { code: 'UNAUTHENTICATED' }, expect: true, label: 'HTTP 200 but code=UNAUTHENTICATED (defensive)' },
    { response: { status: 403 }, payload: { code: 'FORBIDDEN' }, expect: false, label: 'HTTP 403 FORBIDDEN is NOT treated as session-expiry' },
    { response: { status: 502 }, payload: { error: 'upstream down' }, expect: false, label: 'unrelated 502 failure' },
    { response: { status: 200 }, payload: { ok: true }, expect: false, label: 'success response' }
  ];
  for (const c of cases) {
    const got = sandbox.isSessionExpiredResponse(c.response, c.payload);
    assert(got === c.expect, `${c.label} => ${c.expect} (got ${got})`);
  }

  // --- handleSessionExpired() actually clears + redirects ---
  sandbox.S.user = { username: 'kittichai' };
  sandbox.handleSessionExpired('custom message');
  assert(calls.clearAppSession === 1, 'handleSessionExpired() calls clearAppSession() once');
  assert(calls.goScreen[0] === 's-login', 'handleSessionExpired() navigates to s-login');
  assert(calls.setLoginMessage[0] === 'custom message', 'handleSessionExpired() shows the given message');

  // --- idempotency: a second call in the SAME dead session must no-op,
  // even though a legitimate prior manual sign-out already made S.user
  // null by this point (the exact scenario the original S.user-based guard
  // got wrong -- test-logout-data-cleanup.js's session-expiry case caught
  // it, since that test's S.user is already null by the time it simulates
  // a session-expiry event, and that call must still run in full). ---
  sandbox.S.user = null;
  const before = { clearAppSession: calls.clearAppSession, goScreen: calls.goScreen.length, setLoginMessage: calls.setLoginMessage.length };
  sandbox.handleSessionExpired('second call, should be ignored');
  assert(calls.clearAppSession === before.clearAppSession, 'second handleSessionExpired() call (same dead session) does NOT call clearAppSession again');
  assert(calls.goScreen.length === before.goScreen, 'second call does NOT navigate again');
  assert(calls.setLoginMessage.length === before.setLoginMessage, 'second call does NOT overwrite the login message again (no message flicker from a burst of 401s)');

  // --- re-arm: after the guard resets (simulating updateLoggedInUser() on
  // the next successful login), a genuinely NEW session-expiry event must
  // be handled in full again, not permanently suppressed. ---
  // `let` bindings run via vm.runInContext are not reflected as properties
  // on the sandbox object (a Node vm quirk) -- reset it via vm-executed
  // code, the same way updateLoggedInUser() does it for real.
  vm.runInContext('_sessionExpiredHandled = false;', sandbox);
  const beforeRearm = { clearAppSession: calls.clearAppSession, goScreen: calls.goScreen.length };
  sandbox.handleSessionExpired('third call, after re-arm, should run again');
  assert(calls.clearAppSession === beforeRearm.clearAppSession + 1, 'after re-arm (fresh login), a new session-expiry event calls clearAppSession() again');
  assert(calls.goScreen.length === beforeRearm.goScreen + 1, 'after re-arm, a new session-expiry event navigates again');
}

// ---------------------------------------------------------------------------
// A4 -- loadJobsFromApi() generation guard against out-of-order responses
// ---------------------------------------------------------------------------
function buildA4Context({ fetchImpl }) {
  const JOBS = [];
  const sandbox = {
    console,
    JOBS,
    S: { activeJob: null },
    fetch: fetchImpl,
    isJobCancelled: () => false,
    collectLocalJobDrafts: () => ({}),
    collectLocalOnlyUnsyncedJobs: () => [],
    findPreservedDraft: () => null,
    persistJobs: () => {},
    setDataSource: () => {},
    restoreActiveCaseFromPersistence: () => {},
    // Merely declared (not undeclared) so `typeof X?.y` doesn't throw a
    // ReferenceError -- real browser globals, absent in this focused test.
    OperatorNotificationBridge: undefined,
    OperatorNotificationObserver: undefined
  };
  vm.createContext(sandbox);

  const jobStateSrc = fs.readFileSync(path.join(ROOT, 'src/js/job-state.js'), 'utf8');
  const fnMatch = jobStateSrc.match(/let _jobsLoadGen = 0;\r?\n\r?\nasync function loadJobsFromApi\(\) \{[\s\S]*?\n\}\r?\n\r?\nasync function loadJobsFromCsv/);
  if (!fnMatch) throw new Error('loadJobsFromApi() (with the _jobsLoadGen guard) not found in job-state.js -- test is out of sync with the real source');
  // Trim off the trailing "async function loadJobsFromCsv" anchor text, keep only loadJobsFromApi.
  const src = fnMatch[0].replace(/\r?\n\r?\nasync function loadJobsFromCsv$/, '');
  vm.runInContext(src, sandbox, { filename: 'job-state.js (loadJobsFromApi excerpt)' });
  vm.runInContext('this.loadJobsFromApi = loadJobsFromApi;', sandbox);
  return sandbox;
}

function makeJob(id, name) {
  return { id, name, status: 'scheduled' };
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function runA4() {
  console.log('\n=== A4: loadJobsFromApi() generation guard (real source, extracted) ===');

  // --- Baseline: a single call still works normally (no regression) ---
  {
    const sandbox = buildA4Context({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, jobs: [makeJob('a', 'Solo Call')] })
      })
    });
    const result = await sandbox.loadJobsFromApi();
    assert(result === true, `single call: returns true (got ${result})`);
    assert(sandbox.JOBS.length === 1 && sandbox.JOBS[0].id === 'a', `single call: JOBS populated correctly (got ${JSON.stringify(sandbox.JOBS)})`);
  }

  // --- The actual race: A starts first, B starts second, B resolves first, A resolves later ---
  // Expected: JOBS ends up as B's data, never overwritten back to A's.
  {
    const requestA = deferred();
    const requestB = deferred();
    let callIndex = 0;
    const sandbox = buildA4Context({
      fetchImpl: async () => {
        callIndex += 1;
        const isFirstCall = callIndex === 1;
        const gate = isFirstCall ? requestA.promise : requestB.promise;
        await gate;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            jobs: [makeJob(isFirstCall ? 'stale-A' : 'fresh-B', isFirstCall ? 'Request A (started first, resolves last)' : 'Request B (started second, resolves first)')]
          })
        };
      }
    });

    const callA = sandbox.loadJobsFromApi(); // starts first
    const callB = sandbox.loadJobsFromApi(); // starts second, bumps the generation past A's

    // B resolves first.
    requestB.resolve();
    const resultB = await callB;
    assert(resultB === true, 'request B (started second) completes successfully');
    assert(sandbox.JOBS[0]?.id === 'fresh-B', `after B resolves: JOBS is B's data (got ${JSON.stringify(sandbox.JOBS.map(j => j.id))})`);

    // A resolves after B -- this is the exact race condition. A's response
    // must be detected as stale and must NOT overwrite JOBS.
    requestA.resolve();
    const resultA = await callA;
    assert(resultA === false, `request A (started first, resolves last) is detected as superseded -- returns false (got ${resultA})`);
    assert(sandbox.JOBS[0]?.id === 'fresh-B', `after A resolves late: JOBS is STILL B's data, not overwritten by stale A (got ${JSON.stringify(sandbox.JOBS.map(j => j.id))})`);
    assert(sandbox.JOBS.length === 1, `JOBS was not corrupted/duplicated by the stale response (got length ${sandbox.JOBS.length})`);
  }

  // --- Reverse timing sanity check: if only ONE call is ever in flight, it must still commit normally ---
  {
    const sandbox = buildA4Context({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, jobs: [makeJob('only-one', 'Only Call')] })
      })
    });
    const result = await sandbox.loadJobsFromApi();
    assert(result === true && sandbox.JOBS[0]?.id === 'only-one', 'a lone call (no overlap) still commits normally -- guard does not block legitimate single loads');
  }
}

async function main() {
  await runA3();
  await runA4();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  console.error(e.stack);
  process.exit(1);
});
