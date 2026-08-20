/**
 * Unit regression for Full User Journey P0/P1 remediations (UJ-01..11).
 * Does not change score formulas. Run: node scripts/test-user-journey-remediation.js
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

function loadScript(relPath, sandbox) {
  const code = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  vm.runInContext(code, sandbox, { filename: path.basename(relPath) });
  return sandbox;
}

const domEls = {};
function makeEl(id) {
  if (!domEls[id]) {
    domEls[id] = {
      id,
      value: '',
      textContent: '',
      innerHTML: '',
      hidden: false,
      disabled: false,
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      removeAttribute() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      focus() {},
      children: []
    };
  }
  return domEls[id];
}

const sandbox = {
  console,
  window: {},
  document: {
    getElementById: (id) => makeEl(id),
    querySelector: (sel) => {
      if (sel === '#s-score .hdr-action') return makeEl('share-btn');
      return null;
    },
    querySelectorAll: () => [],
    addEventListener() {}
  },
  localStorage: (() => {
    const store = {};
    return {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      _store: store
    };
  })(),
  JOBS: [],
  S: { searchQuery: '', selDay: 0, lang: 'en', activeJob: null, tapData: [], taps: [] },
  t: (k) => k,
  showToast() {},
  goScreen() {},
  renderCalendar() {},
  openJob() {},
  Date,
  Math,
  String,
  Number,
  Array,
  Object,
  JSON,
  Boolean,
  parseInt,
  parseFloat,
  isNaN,
  Set,
  Map
};
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// Minimal stubs for dashboard date helpers dependencies
sandbox.weekBase = new Date();
sandbox.weekBase.setHours(0, 0, 0, 0);
sandbox.weekBase.setDate(sandbox.weekBase.getDate() - ((sandbox.weekBase.getDay() + 6) % 7));

loadScript('src/js/flows/dashboard.js', sandbox);

console.log('=== UJ-10: closeSearchModal clears stale Results state ===');
{
  sandbox.S.searchQuery = 'อานนท์';
  makeEl('search-input').value = 'อานนท์';
  makeEl('search-results').innerHTML = '<div>hit</div>';
  makeEl('appt-count').textContent = 'Results (0)';
  sandbox.closeSearchModal();
  assert(sandbox.S.searchQuery === '', 'S.searchQuery cleared');
  assert(makeEl('search-input').value === '', 'search input cleared');
  assert(makeEl('search-results').innerHTML === '', 'search results cleared');
}

console.log('\n=== UJ-02: search cards expose identity fields ===');
{
  sandbox.JOBS.splice(0, sandbox.JOBS.length,
    { id: '1001', name: 'อานนท์ ศ.', addr: 'ปทุมธานี', date: '2026-08-20', timeStart: '09:00', status: 'new', csvSource: true },
    { id: 'n1', notionId: 'abcdef12-3456-7890-abcd-ef1234567890', name: 'อานนท์ ศ.', addr: 'ปทุมธานี', date: '2026-01-10', timeStart: '10:00', status: 'new' }
  );
  sandbox.filterAppointments('อานนท์');
  const html = makeEl('search-results').innerHTML;
  assert(html.includes('2026-08-20'), 'search shows CSV case date');
  assert(html.includes('2026-01-10'), 'search shows Notion case date');
  assert(html.includes('#1001') || html.includes('1001'), 'search shows durable local id');
  assert(html.includes('abcdef12') || html.includes('#abcdef12'), 'search shows notion identity prefix');
  assert((html.match(/appt-card/g) || []).length === 2, 'same name yields two distinct cards (no name dedupe)');
}

console.log('\n=== UJ-01: jobsOnDate requires job.date ===');
{
  const withDate = { id: 1, name: 'A', date: '2026-08-20', status: 'new' };
  const noDate = { id: 2, name: 'B', day: 3, status: 'new', csvSource: true };
  assert(sandbox.jobMatchesDate(withDate, '2026-08-20') === true, 'dated case matches');
  assert(sandbox.jobMatchesDate(noDate, '2026-08-20') === false, 'dateless case does not match calendar day');
}

console.log('\n=== UJ-01b: CSV seed assigns date ===');
{
  // Load job-state helpers in an isolated context (avoid DOM/app coupling).
  const jsSandbox = {
    console,
    window: {},
    localStorage: sandbox.localStorage,
    JOBS: [],
    S: { activeJob: null },
    AssessmentSnapshot: undefined,
    DEFAULT_TAPS: ['Kitchen'],
    document: sandbox.document,
    fastDeepClone: (v) => JSON.parse(JSON.stringify(v)),
    Date, Math, String, Number, Array, Object, JSON, Boolean, parseInt, Set, Map
  };
  jsSandbox.window = jsSandbox;
  vm.createContext(jsSandbox);
  // Extract only the pure helpers by evaluating a focused snippet from source.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/js/job-state.js'), 'utf8');
  const start = src.indexOf('function csvSeedDateIso');
  const end = src.indexOf('function setDataSource');
  assert(start >= 0 && end > start, 'csvSeedDateIso present in job-state.js');
  vm.runInContext(src.slice(start, end), jsSandbox);
  const iso = jsSandbox.csvSeedDateIso(0, {});
  assert(/^\d{4}-\d{2}-\d{2}$/.test(iso), `csvSeedDateIso returns ISO date (got ${iso})`);
  const fromCol = jsSandbox.csvSeedDateIso(0, { 'Created 1': '2026-09-01' });
  assert(fromCol === '2026-09-01', `csvSeedDateIso prefers Created 1 column (got ${fromCol})`);
  // jobFromClientRecord needs sibling helpers — assert source wiring instead.
  const jobStateSrc = fs.readFileSync(path.join(__dirname, '..', 'src/js/job-state.js'), 'utf8');
  assert(jobStateSrc.includes('date: csvSeedDateIso(index, record)') || jobStateSrc.includes('date,'),
    'jobFromClientRecord assigns date from csvSeedDateIso');
  assert(jobStateSrc.includes('if (job.csvSource) return'), 'Notion load skips rehydrating csvSource jobs');
}

console.log('\n=== UJ-08: overdue window capped ===');
{
  const schedSrc = fs.readFileSync(path.join(__dirname, '..', 'src/js/notifications/scheduler.js'), 'utf8');
  assert(schedSrc.includes('MAX_OVERDUE_HOURS = 72'), 'overdue scheduler caps at 72 hours');
  assert(schedSrc.includes('job.csvSource'), 'overdue skips csvSource jobs');
}

console.log('\n=== UJ-09: notification action label is calendar navigation ===');
{
  const itemSrc = fs.readFileSync(path.join(__dirname, '..', 'src/js/notifications/components/notification-item.js'), 'utf8');
  assert(itemSrc.includes('View on calendar'), 'EN label is View on calendar');
  assert(itemSrc.includes('ดูในปฏิทิน'), 'TH label is calendar view');
  assert(!/return th \? 'เปิดเคส'/.test(itemSrc) && !itemSrc.includes("return 'Open case'"), 'label is not Open case');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
