/**
 * Regression suite for BUG-01: TODAY_JOBS / TOMORROW_REMINDER scheduler
 * dedup logic (src/js/notifications/scheduler.js).
 *
 * Real bug: the old design cached a once-per-day boolean marker
 * (`markers['today:2026-08-24'] = {skipped:true}`) the first time a sync
 * found zero eligible jobs, and NEVER re-checked for the rest of the day —
 * so a Case created later the same day for today/tomorrow silently never
 * got a reminder notification.
 *
 * Fix: dropped the boolean marker entirely. dedupeKey is now content-
 * addressed — `today:<date>:<sorted case-id list>` — so the EXISTING
 * dedupeKey lookup in service.js (createFromEvent) is the only dedup
 * mechanism: the same eligible set on a later sync reuses the existing
 * notification (no duplicate); a different set (Case added/removed/
 * rescheduled) gets a fresh dedupeKey and is correctly treated as new.
 *
 * Loads the REAL notifications/*.js files via vm with a working
 * localStorage stub (real persistence across calls, not a no-op), and
 * drives the actual OperatorNotificationScheduler + OperatorNotificationService.
 *
 * Run: node scripts/test-notification-scheduler-dedup.js
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

function makeLocalStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); }
  };
}

// FIXED_TODAY is the "today" every job/marker in this suite is anchored to,
// so the test doesn't flip behavior depending on what day it's actually run.
const FIXED_TODAY = new Date('2026-08-24T09:00:00');

function buildContext() {
  const sandbox = {
    console,
    window: {},
    localStorage: makeLocalStorage(),
    S: { lang: 'en' },
    Date: (function () {
      class FixedDate extends Date {
        constructor(...args) {
          if (args.length === 0) super(FIXED_TODAY.getTime());
          else super(...args);
        }
        static now() { return FIXED_TODAY.getTime(); }
      }
      return FixedDate;
    })()
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);

  const files = [
    'src/js/notifications/types.js',
    'src/js/notifications/events.js',
    'src/js/notifications/utils.js',
    'src/js/notifications/repository.js',
    'src/js/notifications/mapper.js',
    'src/js/notifications/store.js',
    'src/js/notifications/service.js',
    'src/js/notifications/dispatcher.js',
    'src/js/notifications/scheduler.js'
  ];
  for (const rel of files) {
    const code = fs.readFileSync(path.join('D:/Service Portal', rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  return sandbox;
}

function job(id, name, date, timeStart) {
  return { id, notionId: id, name, date, timeStart, status: 'new' };
}

async function todayNotifications(sandbox) {
  const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
  const all = await repo.list();
  return all.filter(n => n.type === 'TODAY_JOBS');
}

async function tomorrowNotifications(sandbox) {
  const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
  const all = await repo.list();
  return all.filter(n => n.type === 'TOMORROW_REMINDER');
}

async function main() {
  // --- Case 1: no jobs -> sync -> no notification ---
  {
    const sandbox = buildContext();
    await sandbox.OperatorNotificationScheduler.runTodayJobs([]);
    const items = await todayNotifications(sandbox);
    assert(items.length === 0, 'Case 1: no jobs -> sync -> no TODAY_JOBS notification created');
  }

  // --- Case 2: no jobs at first sync, then a job appears for today -> sync -> TODAY notification created ---
  {
    const sandbox = buildContext();
    await sandbox.OperatorNotificationScheduler.runTodayJobs([]); // 08:00 empty check
    const j = job('case-1', 'Alice', '2026-08-24', '10:00AM');
    await sandbox.OperatorNotificationScheduler.runTodayJobs([j]); // 11:00 real sync, job now exists
    const items = await todayNotifications(sandbox);
    assert(items.length === 1, `Case 2: job appearing after an earlier empty check still creates a TODAY_JOBS notification (got ${items.length})`);
  }

  // --- Case 3: repeated sync with the SAME job set -> no duplicate ---
  {
    const sandbox = buildContext();
    const j = job('case-1', 'Alice', '2026-08-24', '10:00AM');
    await sandbox.OperatorNotificationScheduler.runTodayJobs([j]);
    await sandbox.OperatorNotificationScheduler.runTodayJobs([j]);
    await sandbox.OperatorNotificationScheduler.runTodayJobs([j]);
    const items = await todayNotifications(sandbox);
    assert(items.length === 1, `Case 3: 3x sync with an unchanged job set creates exactly one notification, not 3 (got ${items.length})`);
  }

  // --- Case 4: job present from the very first sync -> works normally ---
  {
    const sandbox = buildContext();
    const j = job('case-1', 'Alice', '2026-08-24', '10:00AM');
    await sandbox.OperatorNotificationScheduler.runTodayJobs([j]);
    const items = await todayNotifications(sandbox);
    assert(items.length === 1, 'Case 4: job present from the first sync still produces a TODAY_JOBS notification');
  }

  // --- Case 5: TOMORROW_REMINDER works independently of TODAY_JOBS ---
  {
    const sandbox = buildContext();
    const jTomorrow = job('case-2', 'Bob', '2026-08-25', '09:00AM');
    await sandbox.OperatorNotificationScheduler.runTomorrowReminder([jTomorrow]);
    const tomorrowItems = await tomorrowNotifications(sandbox);
    const todayItems = await todayNotifications(sandbox);
    assert(tomorrowItems.length === 1, `Case 5: job for tomorrow produces a TOMORROW_REMINDER (got ${tomorrowItems.length})`);
    assert(todayItems.length === 0, 'Case 5: a tomorrow-only job must not also produce a TODAY_JOBS notification');
  }

  // --- Case 6: no job -> add job -> job removed (cancelled) -> add a NEW job later the same day ---
  {
    const sandbox = buildContext();
    await sandbox.OperatorNotificationScheduler.runTodayJobs([]); // nothing yet
    const j1 = job('case-1', 'Alice', '2026-08-24', '10:00AM');
    await sandbox.OperatorNotificationScheduler.runTodayJobs([j1]); // Alice added
    await sandbox.OperatorNotificationScheduler.runTodayJobs([]); // Alice cancelled/removed -> back to empty
    const j2 = job('case-2', 'Bob', '2026-08-24', '11:00AM');
    await sandbox.OperatorNotificationScheduler.runTodayJobs([j2]); // Bob added later
    const items = await todayNotifications(sandbox);
    assert(items.length === 2, `Case 6: distinct job sets over the day (Alice, then Bob) each produce their own notification (got ${items.length})`);
  }

  // --- Case 7: multiple jobs on the same day in one sync ---
  {
    const sandbox = buildContext();
    const jobs = [
      job('case-1', 'Alice', '2026-08-24', '09:00AM'),
      job('case-2', 'Bob', '2026-08-24', '10:00AM'),
      job('case-3', 'Carol', '2026-08-24', '11:00AM')
    ];
    await sandbox.OperatorNotificationScheduler.runTodayJobs(jobs);
    const items = await todayNotifications(sandbox);
    assert(items.length === 1, `Case 7: 3 jobs in one sync produce exactly 1 TODAY_JOBS notification (got ${items.length})`);
    assert(items[0]?.message?.includes('3'), `Case 7: notification reflects the correct count of 3 (message: "${items[0]?.message}")`);

    // Adding a 4th job later the same day must produce a NEW notification
    // (different set -> different dedupeKey), not silently nothing.
    const withFourth = [...jobs, job('case-4', 'Dave', '2026-08-24', '12:00PM')];
    await sandbox.OperatorNotificationScheduler.runTodayJobs(withFourth);
    const items2 = await todayNotifications(sandbox);
    assert(items2.length === 2, `Case 7b: a 4th job added later the same day produces a second, updated notification (got ${items2.length})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  process.exit(1);
});
