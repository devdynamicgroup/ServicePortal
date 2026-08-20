/**
 * Regression suite for Notification -> Calendar navigation (no auto-open Case).
 *
 * Loads the REAL browser source files (notifications/types.js, navigation.js,
 * flows/dashboard.js, notifications/components/notification-center.js) via `vm`
 * with minimal DOM/state stubs, since they are plain (non-module) browser
 * scripts — and exercises the actual functions directly. No reimplementations.
 * Score engine files are not loaded and are not exercised here.
 *
 * Run: node scripts/test-notification-calendar-navigation.js
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

function makeJobs() {
  return [
    { id: 'job-1', notionId: 'case-1', name: 'Alice', date: '2026-08-20', status: 'active' },
    { id: 'job-2', notionId: 'case-2', name: 'Bob', date: '2026-08-20', status: 'active' },
    { id: 'job-3', notionId: 'case-3', name: 'Carol', date: '2026-08-21', status: 'active' },
    { id: 'job-4', notionId: 'case-4', name: 'Dave (cancelled)', date: '2026-08-20', status: 'cancelled' }
  ];
}

function makeManyJobsOnOneDay(count, date) {
  return Array.from({ length: count }, (_, i) => ({
    id: `job-${i + 1}`,
    notionId: `case-${i + 1}`,
    name: `Customer ${i + 1}`,
    date,
    status: 'active',
    timeStart: String(9 + i).padStart(2, '0') + ':00',
    timeEnd: String(10 + i).padStart(2, '0') + ':00'
  }));
}

// A minimal stand-in for #appt-list: parses out `data-job-id="..."` from the
// assigned innerHTML (renderJobs() builds cards in visibleJobs order via
// buildApptCard/join), so `.children[i]` lines up with visibleJobs[i] the
// same way it would in a real DOM. Records scrollIntoView calls for assertions.
function makeApptListStub() {
  const scrollCalls = [];
  let html = '';
  return {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      const ids = [...value.matchAll(/data-job-id="([^"]*)"/g)].map(m => m[1]);
      const classBlocks = [...value.matchAll(/<div class="([^"]*)" data-job-id="([^"]*)"/g)];
      this.children = ids.map((id, i) => ({
        dataset: { jobId: id },
        className: classBlocks[i] ? classBlocks[i][1] : '',
        scrollIntoView(opts) { scrollCalls.push({ id, opts }); }
      }));
    },
    children: [],
    __scrollCalls: scrollCalls
  };
}

function buildContext(jobs) {
  const apptList = makeApptListStub();
  const apptCount = { textContent: '' };
  const domStub = {
    getElementById: (id) => {
      if (id === 'appt-list') return apptList;
      if (id === 'appt-count') return apptCount;
      return null;
    },
    addEventListener: () => {},
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } })
  };
  const openJobCalls = [];
  const sandbox = {
    console,
    window: {},
    document: domStub,
    navigator: { userAgent: 'node' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    S: {
      screen: 's-dash', prev: null,
      selDay: 0, activeJob: null, searchQuery: '', lang: 'en'
    },
    JOBS: jobs || makeJobs(),
    t: (k) => k,
    openJob: (id) => { openJobCalls.push(id); },
    showToast: () => {}
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox._openJobCalls = openJobCalls;
  sandbox._apptList = apptList;
  vm.createContext(sandbox);

  ['src/js/notifications/types.js', 'src/js/navigation.js', 'src/js/flows/dashboard.js']
    .forEach(rel => {
      const code = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      vm.runInContext(code, sandbox, { filename: path.basename(rel) });
    });

  // notification-center.js reads global.OperatorNotificationTypes / OperatorNotificationService;
  // stub the service (markRead) since persistence isn't under test here.
  vm.runInContext(
    `global.OperatorNotificationService = { markRead: async () => {} };`,
    sandbox
  );
  const ncCode = fs.readFileSync(
    path.join(__dirname, '..', 'src/js/notifications/components/notification-center.js'),
    'utf8'
  );
  vm.runInContext(ncCode, sandbox, { filename: 'notification-center.js' });

  return sandbox;
}

async function main() {

console.log('=== resolveNavigationTarget: date resolution ===');
{
  const ctx = buildContext();
  const Actions = ctx.OperatorNotificationTypes.NOTIFICATION_ACTION;

  const withPayloadDate = { caseId: 'case-1', payload: { date: '2026-08-20' } };
  const t1 = ctx.resolveNavigationTarget(withPayloadDate);
  assert(t1.type === 'calendar' && t1.date === '2026-08-20', 'uses notification.payload.date when present');

  const withoutPayloadDate = { caseId: 'case-3', payload: {} };
  const t2 = ctx.resolveNavigationTarget(withoutPayloadDate);
  assert(t2.date === '2026-08-21', 'falls back to Case source-of-truth (job.date) when payload has no date');

  const missingCase = { caseId: 'case-does-not-exist', payload: {} };
  const t3 = ctx.resolveNavigationTarget(missingCase);
  assert(t3.date === null, 'no date guessed when Case cannot be found (no random/guessed date)');

  const noCaseId = { caseId: null, payload: {} };
  const t4 = ctx.resolveNavigationTarget(noCaseId);
  assert(t4.date === null, 'no date guessed when notification has no caseId at all');
}

console.log('=== Click New Case notification -> navigates Calendar, never opens Case ===');
{
  const ctx = buildContext();
  const Actions = ctx.OperatorNotificationTypes.NOTIFICATION_ACTION;
  const item = { id: 'n1', caseId: 'case-1', action: Actions.OPEN_CASE, payload: { date: '2026-08-20' } };

  ctx.__item = item;
  ctx.__action = Actions.OPEN_CASE;
  await vm.runInContext('global.handleNotificationAction(__item, __action)', ctx);

  assert(ctx._openJobCalls.length === 0, 'openJob is never called (no auto-open Case)');
  assert(ctx.selectedDateIso() === '2026-08-20', 'Calendar lands on the notification\'s date');
  assert(ctx.S.screen === 's-dash', 'screen switches to the dashboard/calendar screen');
  // goScreen('s-dash') re-renders once immediately and once more after its
  // (async) jobs refresh — every scroll call must target the same Case.
  assert(ctx._apptList.__scrollCalls.length >= 1 && ctx._apptList.__scrollCalls.every(c => c.id === 'job-1'),
    'the target Case card is scrolled into view (and only that card, on every render)');
  assert(ctx._apptList.children[0].className.includes('is-notif-target'),
    'the target Case card carries the highlight class');
}

console.log('=== resolveNavigationTarget also resolves the local job.id for scroll targeting ===');
{
  const ctx = buildContext();
  const target = ctx.resolveNavigationTarget({ caseId: 'case-2', payload: { date: '2026-08-20' } });
  assert(target.jobId === 'job-2', 'resolved target carries the Case\'s local job.id, not just the Notion caseId');

  const missing = ctx.resolveNavigationTarget({ caseId: 'case-deleted', payload: {} });
  assert(missing.jobId === null, 'no jobId resolved when the Case cannot be found (nothing to scroll to/highlight)');
}

console.log('=== Target Case is scrolled into view + highlighted at top / middle / bottom of a busy day ===');
{
  const DATE = '2026-08-20';
  const positions = [
    { label: 'top', jobId: 'job-1', index: 0 },
    { label: 'middle', jobId: 'job-8', index: 7 },
    { label: 'bottom', jobId: 'job-15', index: 14 }
  ];
  positions.forEach(({ label, jobId, index }) => {
    const ctx = buildContext(makeManyJobsOnOneDay(15, DATE));
    ctx.navigateToCalendarDate(DATE, jobId);

    assert(ctx._apptList.__scrollCalls.length >= 1 && ctx._apptList.__scrollCalls.every(c => c.id === jobId),
      `${label} (15 cases/day): every scrollIntoView call targets the notified Case`);
    assert(ctx._apptList.children.length === 15, `${label}: all 15 cases for the day are still rendered (no auto-pick)`);
    assert(ctx._apptList.children[index].className.includes('is-notif-target'),
      `${label}: the notified Case card is the one carrying the highlight class`);
    ctx._apptList.children.forEach((child, i) => {
      if (i !== index) assert(!child.className.includes('is-notif-target'), `${label}: no other card is highlighted (index ${i})`);
    });
    assert(ctx._openJobCalls.length === 0, `${label}: Case is still never auto-opened`);
  });
}

console.log('=== Manual date navigation clears a pending highlight ===');
{
  const ctx = buildContext(makeManyJobsOnOneDay(3, '2026-08-20'));
  ctx.navigateToCalendarDate('2026-08-20', 'job-2');
  assert(ctx._apptList.__scrollCalls.length >= 1, 'sanity: highlight/scroll applied right after navigation');

  ctx._apptList.__scrollCalls.length = 0; // reset the call log before the manual action
  ctx.shiftWeek(0); // user manually re-renders the week (e.g. via the week nav) without a notification
  assert(ctx._apptList.__scrollCalls.length === 0, 'no scroll-into-view fires once the user has manually navigated');
  assert(!ctx._apptList.children.some(c => c.className.includes('is-notif-target')),
    'highlight is cleared once the user manually navigates, not left lingering');
}

console.log('=== A day with multiple Cases shows all of them (no auto-pick) ===');
{
  const ctx = buildContext();
  const cases = ctx.jobsOnDate('2026-08-20');
  assert(cases.length === 2, 'both active cases on 2026-08-20 are returned (cancelled one excluded)');
  assert(cases.map(j => j.id).sort().join(',') === 'job-1,job-2', 'exact case set matches Calendar source-of-truth filter');
}

console.log('=== Case identity: notification.caseId matches the resolved Case ===');
{
  const ctx = buildContext();
  const target = ctx.resolveNavigationTarget({ caseId: 'case-3', payload: {} });
  assert(target.caseId === 'case-3', 'resolved target carries the same caseId as the notification (identity preserved)');
}

console.log('=== Case no longer exists: navigates to date, shows empty state, never opens wrong Case ===');
{
  const ctx = buildContext();
  const Actions = ctx.OperatorNotificationTypes.NOTIFICATION_ACTION;
  const item = { id: 'n2', caseId: 'case-deleted', action: Actions.OPEN_CASE, payload: { date: '2026-08-22' } };
  ctx.__item = item;
  ctx.__action = Actions.OPEN_CASE;
  await vm.runInContext('global.handleNotificationAction(__item, __action)', ctx);

  assert(ctx._openJobCalls.length === 0, 'no Case opened for a deleted/missing case id');
  assert(ctx.selectedDateIso() === '2026-08-22', 'still navigates to the notification date');
  assert(ctx.jobsOnDate('2026-08-22').length === 0, 'day renders empty (no matching case) rather than a wrong one');
}

console.log('=== Reload/re-render after navigation keeps the selected date ===');
{
  const ctx = buildContext();
  ctx.navigateToCalendarDate('2026-08-20');
  ctx.renderCalendar(); // simulate the extra re-render goScreen() does after loadJobsFromApi()
  assert(ctx.selectedDateIso() === '2026-08-20', 'date selection survives a subsequent Calendar re-render');
}

console.log('=== Multiple notifications on different days each land on their own date ===');
{
  const ctx = buildContext();
  ctx.navigateToCalendarDate('2026-08-20');
  assert(ctx.selectedDateIso() === '2026-08-20', 'first notification date applied');
  ctx.navigateToCalendarDate('2026-08-21');
  assert(ctx.selectedDateIso() === '2026-08-21', 'second notification date applied independently');
}

console.log('=== Timezone / date-boundary safety ===');
{
  const ctx = buildContext();
  // new Date('2026-08-20') (bare ISO parse) is UTC midnight, which is
  // 2026-08-19 evening in any negative-UTC-offset zone (e.g. US/Bangkok is +7,
  // so this specific case is safe, but the y/m/d-component parse below must
  // not depend on host TZ at all). Assert goToCalendarDate never shifts.
  const boundaryDates = ['2026-01-01', '2026-02-28', '2026-12-31', '2026-08-20'];
  boundaryDates.forEach(iso => {
    ctx.goToCalendarDate(iso);
    assert(ctx.selectedDateIso() === iso, `no day-shift for boundary date ${iso}`);
  });
}

console.log('=== Notification without any resolvable date: safe fallback, no crash, no guess ===');
{
  const ctx = buildContext();
  const before = ctx.selectedDateIso();
  ctx.navigateToCalendarDate(null);
  assert(ctx.selectedDateIso() === before, 'calendar stays on its current date rather than guessing one');
  assert(ctx.S.screen === 's-dash', 'still navigates to the calendar/case-list screen as a safe fallback');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
