/**
 * Regression suite for BUG-02: signing out on a shared device must not
 * leave the previous user's Cases / notification history visible to the
 * next person who signs in.
 *
 * Real bug: clearAppSession() (src/js/flows/auth.js) only ever removed
 * 'wm-session'. The app is a single-page app that never reloads on
 * sign-out, so JOBS (in memory), the notification store (in memory), and
 * their localStorage snapshots ('wm-jobs', 'wm-operator-notifications-v1',
 * seen-case ids) all survived a sign-out untouched -- the next person to
 * sign in on the same device would see User A's Cases and notification
 * history (customer names, appointment details) until a fresh sync
 * happened to overwrite it, if ever.
 *
 * Fix: clearAppSession() now calls resetUserScopedState(), a small
 * orchestrator that asks each owning module to clear its own state:
 * JOBS + wm-jobs/wm-jobs-source (job-state.js), the notification store +
 * wm-operator-notifications-v1 + seen-case ids (notifications/repository.js,
 * store.js), and the observer's bootstrap flag (notifications/observer.js).
 * Deliberately does NOT touch wm-lang or wm-csv-seed-version (device-level,
 * not user-private).
 *
 * Loads the REAL auth.js + job-state.js (jobs part only, via a minimal
 * stand-in JOBS array matching its real `const JOBS = []` shape) +
 * notifications/*.js via vm, and drives the actual resetUserScopedState()
 * function -- not a reimplementation.
 *
 * Run: node scripts/test-logout-data-cleanup.js
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

function makeLocalStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    __dump: () => Object.fromEntries(data)
  };
}

function buildContext(localStorage) {
  const JOBS = [];
  const sandbox = {
    console,
    window: {},
    document: { querySelector: () => null }, // updateLoggedInUser touches DOM; not exercised here
    localStorage,
    JOBS,
    S: { lang: 'en', user: null }
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);

  // Real job-state.js is large and pulls in Notion/Drive-sync code this
  // test doesn't need; the two functions under test (resetJobsCacheForLogout,
  // and JOBS itself) are self-contained, so pull just that function's real
  // source out of the file rather than executing the whole module (which
  // would require stubbing far more than this bug touches).
  const jobStateSrc = fs.readFileSync(path.join('D:/Service Portal', 'src/js/job-state.js'), 'utf8');
  const fnMatch = jobStateSrc.match(/function resetJobsCacheForLogout\(\)[\s\S]*?\n}/);
  if (!fnMatch) throw new Error('resetJobsCacheForLogout() not found in job-state.js -- test is out of sync with the real source');
  vm.runInContext(fnMatch[0], sandbox, { filename: 'job-state.js (resetJobsCacheForLogout excerpt)' });
  vm.runInContext('window.resetJobsCacheForLogout = resetJobsCacheForLogout;', sandbox);

  const notifFiles = [
    'src/js/notifications/types.js',
    'src/js/notifications/events.js',
    'src/js/notifications/utils.js',
    'src/js/notifications/repository.js',
    'src/js/notifications/mapper.js',
    'src/js/notifications/store.js',
    'src/js/notifications/service.js',
    'src/js/notifications/dispatcher.js',
    'src/js/notifications/scheduler.js',
    'src/js/notifications/observer.js'
  ];
  for (const rel of notifFiles) {
    const code = fs.readFileSync(path.join('D:/Service Portal', rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }

  const authSrc = fs.readFileSync(path.join('D:/Service Portal', 'src/js/flows/auth.js'), 'utf8');
  vm.runInContext(authSrc, sandbox, { filename: 'auth.js' });

  return sandbox;
}

async function main() {
  // --- Setup: "User A" has Cases, a notification, and seen-case state ---
  const localStorage = makeLocalStorage();
  const sandboxA = buildContext(localStorage);

  sandboxA.JOBS.push({ id: 'job-1', notionId: 'case-1', name: 'Alice Customer', date: '2026-08-24' });
  await sandboxA.OperatorNotificationDispatcher.emit(
    sandboxA.OperatorNotificationEvents.NOTIFICATION_EVENTS.CASE_CREATED,
    { caseId: 'case-1', customerName: 'Alice Customer', dedupeKey: 'new_case:case-1', payload: {} }
  );
  await sandboxA.OperatorNotificationObserver.detectNewCases([{ id: 'job-1', notionId: 'case-1', date: '2026-08-24' }]);

  const beforeLogoutStore = sandboxA.OperatorNotificationStore.getState();
  assert(beforeLogoutStore.items.length >= 1, 'setup: User A has at least one notification before logout');
  assert(sandboxA.JOBS.length === 1, 'setup: User A has a Case in memory before logout');

  // --- User A signs out ---
  sandboxA.resetUserScopedState();

  assert(sandboxA.JOBS.length === 0, 'Case 3: JOBS is emptied in memory immediately on logout (no page reload happens)');
  assert(sandboxA.OperatorNotificationStore.getState().items.length === 0, 'Case 2: notification store is emptied in memory immediately on logout');
  assert(localStorage.getItem('wm-jobs') === null, 'wm-jobs removed from localStorage on logout');
  assert(localStorage.getItem('wm-operator-notifications-v1') === null, 'wm-operator-notifications-v1 removed from localStorage on logout');
  assert(localStorage.getItem('wm-operator-notif-seen-cases-v1') === null, 'seen-case ids removed from localStorage on logout');

  // --- "Refresh" after logout: a fresh page load reading only localStorage
  // (a new repository instance, the way LocalStorageNotificationRepository's
  // constructor really hydrates from localStorage on every page load) must
  // not resurrect User A's data. ---
  const repoAfterRefresh = new sandboxA.OperatorNotificationRepository.LocalStorageNotificationRepository();
  const itemsAfterRefresh = await repoAfterRefresh.list();
  assert(itemsAfterRefresh.length === 0, 'Case 7: a fresh repository instance (simulating page refresh) sees no leftover notifications after logout');

  // --- User B logs in on the same device/localStorage and gets their own
  // Case. Mirrors the REAL call order (job-state.js): JOBS is populated
  // from the server BEFORE syncFromJobs/detectNewCases ever runs -- so B's
  // first sync always sees their own existing Case(s) already in the list,
  // never an empty array. That first sync quietly seeds `seen` (the same
  // "don't flood on first sync" behavior a brand new install gets) without
  // emitting a notification for a Case B already had; only a Case created
  // AFTER that point should notify. ---
  sandboxA.JOBS.push({ id: 'job-9', notionId: 'case-9', name: 'Bob Customer', date: '2026-08-24' });
  const firstSyncForB = await sandboxA.OperatorNotificationObserver.detectNewCases(
    [{ id: 'job-9', notionId: 'case-9', name: 'Bob Customer', date: '2026-08-24' }]
  );
  assert(firstSyncForB.filter(Boolean).length === 0, 'Case 4: User B\'s first post-login sync quietly seeds their existing Case rather than notifying about it (matches first-install behavior)');

  sandboxA.JOBS.push({ id: 'job-10', notionId: 'case-10', name: 'Bob Second Customer', date: '2026-08-24' });
  const createdForB = await sandboxA.OperatorNotificationObserver.detectNewCases([
    { id: 'job-9', notionId: 'case-9', name: 'Bob Customer', date: '2026-08-24' },
    { id: 'job-10', notionId: 'case-10', name: 'Bob Second Customer', date: '2026-08-24' }
  ]);

  assert(sandboxA.JOBS.every(j => j.name !== 'Alice Customer'), 'Case 1/3: User B never sees User A\'s Case in memory');
  const storeAfterB = sandboxA.OperatorNotificationStore.getState();
  assert(!storeAfterB.items.some(n => n.customerName === 'Alice Customer'), 'Case 2: User B never sees a notification naming User A\'s customer');
  assert(createdForB.filter(Boolean).length === 1, 'Case 4: a genuinely new Case for User B (after their first quiet sync) is detected and notified exactly once, not swallowed by A\'s stale seen-ids');

  // --- Device-level, non-user data must survive logout ---
  localStorage.setItem('wm-csv-seed-version', 'clients-30-v1');
  localStorage.setItem('wm-lang', 'th');
  sandboxA.resetUserScopedState();
  assert(localStorage.getItem('wm-csv-seed-version') === 'clients-30-v1', 'device-level wm-csv-seed-version survives logout (not user-private)');
  assert(localStorage.getItem('wm-lang') === 'th', 'device-level wm-lang preference survives logout (not user-private)');

  // --- Case 6: logout then log back in as the SAME user (A) -- behavior
  // correct. Same real call order as User B above: A's first post-login
  // sync sees case-1 already in the (server-loaded) job list and quietly
  // seeds it; a Case created afterward still notifies normally, proving
  // sign-in isn't permanently suppressed for a returning user. ---
  sandboxA.JOBS.push({ id: 'job-1', notionId: 'case-1', name: 'Alice Customer', date: '2026-08-24' });
  const firstSyncForA = await sandboxA.OperatorNotificationObserver.detectNewCases(
    [{ id: 'job-1', notionId: 'case-1', name: 'Alice Customer', date: '2026-08-24' }]
  );
  assert(firstSyncForA.filter(Boolean).length === 0, 'Case 6: A\'s first sync after signing back in quietly seeds their already-known Case (not flooded)');

  sandboxA.JOBS.push({ id: 'job-2', notionId: 'case-2', name: 'Alice New Customer', date: '2026-08-24' });
  const reDetected = await sandboxA.OperatorNotificationObserver.detectNewCases([
    { id: 'job-1', notionId: 'case-1', name: 'Alice Customer', date: '2026-08-24' },
    { id: 'job-2', notionId: 'case-2', name: 'Alice New Customer', date: '2026-08-24' }
  ]);
  assert(reDetected.filter(Boolean).length === 1, 'Case 6: a new Case for A after signing back in is still detected and notified correctly, not permanently suppressed');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  process.exit(1);
});
