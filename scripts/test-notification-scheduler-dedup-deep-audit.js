/**
 * Deep audit / mutation-style regression suite for BUG-01's dedupeKey
 * fingerprint (src/js/notifications/scheduler.js caseSetFingerprint()),
 * written during a Release Gate review of commit c339179d.
 *
 * Covers scenarios beyond the original BUG-01 test matrix
 * (test-notification-scheduler-dedup.js): array-order independence,
 * add-then-remove-then-readd cycles, case-id changes, cross-category
 * rescheduling (tomorrow -> today), and — the one real gap this audit
 * found — a duplicate case-id appearing twice within a single sync's job
 * list. That duplicate used to produce a DIFFERENT fingerprint than a
 * clean single-entry list for the same Case set (because it wasn't
 * deduped before sorting/joining), which would have created a spurious
 * extra notification. Fixed by deduping ids via a Set before sorting.
 *
 * Run: node scripts/test-notification-scheduler-dedup-deep-audit.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeLocalStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); }
  };
}

const FIXED_TODAY = new Date('2026-08-24T09:00:00');

function buildContext() {
  const sandbox = {
    console, window: {}, localStorage: makeLocalStorage(), S: { lang: 'en' },
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
    'src/js/notifications/types.js', 'src/js/notifications/events.js', 'src/js/notifications/utils.js',
    'src/js/notifications/repository.js', 'src/js/notifications/mapper.js', 'src/js/notifications/store.js',
    'src/js/notifications/service.js', 'src/js/notifications/dispatcher.js', 'src/js/notifications/scheduler.js'
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

async function todayNotifs(sandbox) {
  const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
  return (await repo.list()).filter(n => n.type === 'TODAY_JOBS');
}

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log('  ok  ' + msg); }
  else { fail++; console.error('  FAIL  ' + msg); }
}

async function main() {
  // 1. Order independence: [A,B] vs [B,A] must produce the SAME dedupeKey (no dup notification)
  {
    const sb = buildContext();
    const A = job('case-A', 'Alice', '2026-08-24', '09:00AM');
    const B = job('case-B', 'Bob', '2026-08-24', '10:00AM');
    await sb.OperatorNotificationScheduler.runTodayJobs([A, B]);
    await sb.OperatorNotificationScheduler.runTodayJobs([B, A]); // same set, different array order
    const items = await todayNotifs(sb);
    check(items.length === 1, `[A,B] then [B,A] (same set, different order) => exactly 1 notification (got ${items.length})`);
  }

  // 2. [A] -> [A,B] -> [A]  (B added then removed) -- 3 distinct states => up to 3 notifications, no crash, correct final state readable
  {
    const sb = buildContext();
    const A = job('case-A', 'Alice', '2026-08-24', '09:00AM');
    const B = job('case-B', 'Bob', '2026-08-24', '10:00AM');
    await sb.OperatorNotificationScheduler.runTodayJobs([A]);
    await sb.OperatorNotificationScheduler.runTodayJobs([A, B]);
    await sb.OperatorNotificationScheduler.runTodayJobs([A]); // B removed again -- back to original set
    const items = await todayNotifs(sb);
    // [A] state occurs twice (first and third calls) -- same dedupeKey both times => should NOT create a 2nd notification for it.
    check(items.length === 2, `[A] -> [A,B] -> [A]: only 2 distinct sets ever existed (A-only, A+B), so exactly 2 notifications, not 3 (got ${items.length})`);
  }

  // 3. Case ID changes (e.g. re-created with a new notionId) while name/date/time stay the same -- must be treated as a DIFFERENT case
  {
    const sb = buildContext();
    await sb.OperatorNotificationScheduler.runTodayJobs([job('case-OLD', 'Alice', '2026-08-24', '09:00AM')]);
    await sb.OperatorNotificationScheduler.runTodayJobs([job('case-NEW', 'Alice', '2026-08-24', '09:00AM')]);
    const items = await todayNotifs(sb);
    check(items.length === 2, `same-looking Case but a different id => treated as a new set, 2 notifications (got ${items.length})`);
  }

  // 4. Duplicate case ID appearing twice in the SAME sync's job list (upstream data bug) -- must not crash, must not silently vanish
  {
    const sb = buildContext();
    const A = job('case-A', 'Alice', '2026-08-24', '09:00AM');
    let threw = false;
    try {
      await sb.OperatorNotificationScheduler.runTodayJobs([A, A]); // duplicate entry
    } catch (e) { threw = true; console.error('  THREW:', e); }
    check(!threw, 'a duplicate case-id appearing twice in one job list does not throw');
    const items = await todayNotifs(sb);
    check(items.length === 1, `duplicate-in-list still produces exactly 1 notification (got ${items.length})`);
    // Now check: does the duplicate change the fingerprint vs a clean single-entry list for the SAME case?
    const sb2 = buildContext();
    await sb2.OperatorNotificationScheduler.runTodayJobs([A]);
    const items2 = await todayNotifs(sb2);
    const dedupeA = items[0]?.dedupeKey;
    const dedupeAClean = items2[0]?.dedupeKey;
    check(dedupeA === dedupeAClean, `FIXED: duplicate-in-list entry now produces the SAME dedupeKey ("${dedupeA}") as the clean single-entry case ("${dedupeAClean}")`);
  }

  // 5. Case date moves from tomorrow -> today (crosses categories) -- must correctly stop counting as TOMORROW and start counting as TODAY
  {
    const sb = buildContext();
    const j = job('case-A', 'Alice', '2026-08-25', '09:00AM'); // tomorrow
    await sb.OperatorNotificationScheduler.runTomorrowReminder([j]);
    j.date = '2026-08-24'; // rescheduled to today
    await sb.OperatorNotificationScheduler.runTodayJobs([j]);
    const repo = new sb.OperatorNotificationRepository.LocalStorageNotificationRepository();
    const all = await repo.list();
    const tomorrowCount = all.filter(n => n.type === 'TOMORROW_REMINDER').length;
    const todayCount = all.filter(n => n.type === 'TODAY_JOBS').length;
    check(tomorrowCount === 1, `case rescheduled tomorrow->today: original TOMORROW_REMINDER notification still exists as history (got ${tomorrowCount})`);
    check(todayCount === 1, `case rescheduled tomorrow->today: a fresh TODAY_JOBS notification is created (got ${todayCount})`);
  }

  // 6. Sync repeated 20x with an unchanged set -- must never exceed 1 notification
  {
    const sb = buildContext();
    const j = job('case-A', 'Alice', '2026-08-24', '09:00AM');
    for (let i = 0; i < 20; i++) await sb.OperatorNotificationScheduler.runTodayJobs([j]);
    const items = await todayNotifs(sb);
    check(items.length === 1, `20x identical syncs => still exactly 1 notification (got ${items.length})`);
  }

  // 7. Many cases (50) on the same day in one sync -- fingerprint must still be stable & correct across repeats
  {
    const sb = buildContext();
    const jobs = Array.from({ length: 50 }, (_, i) => job(`case-${i}`, `Customer ${i}`, '2026-08-24', `0${(i % 9) + 1}:00AM`));
    await sb.OperatorNotificationScheduler.runTodayJobs(jobs);
    await sb.OperatorNotificationScheduler.runTodayJobs(jobs.slice().reverse()); // same 50, reversed order
    const items = await todayNotifs(sb);
    check(items.length === 1, `50 cases, then the same 50 reversed => still exactly 1 notification (got ${items.length})`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
