/**
 * OP LINE clickable destination: built only from the validated Public LINE
 * ID (job.line.publicId). Verified identity (lineUserId / displayName /
 * linked) must never become a destination. Loads the REAL src/js/job-state.js
 * via Node's vm module with a minimal DOM shim; no network, no Notion, no LINE.
 *
 * Run: node scripts/test-op-line-destination.js
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

function makeEl() {
  const classes = new Set();
  return {
    textContent: '',
    dataset: {},
    classList: {
      toggle(cls, force) { const on = force === undefined ? !classes.has(cls) : !!force; on ? classes.add(cls) : classes.delete(cls); },
      contains(cls) { return classes.has(cls); }
    }
  };
}

function buildSandbox() {
  const els = {};
  ['op-line-card', 'op-line-name', 'op-line-arrow', 'job-client-name', 'job-time-range', 'job-pkg-tag',
   'job-change-pkg-btn', 'job-maps-btn'].forEach(id => { els[id] = makeEl(); });
  const sandbox = {
    console,
    document: {
      getElementById: (id) => els[id] || null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    window: {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    S: { activeJob: null, taps: [], tapData: [], pkg: 'essential' },
    t: (k) => k,
    showToast: () => {},
    normalizeInterruptedPhoto: (p) => p,
    AssessmentSnapshot: { preferDraft: () => null, draftHasMeasurements: () => false }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'job-state.js' });
  return { sb: sandbox, els };
}

function jobWith(line) {
  return {
    id: 'job-1', name: 'Test C.', timeStart: '9:00', timeEnd: '10:00', status: 'new',
    line,
    draft: { fields: {}, pkg: 'essential' }
  };
}

const { sb, els } = buildSandbox();

console.log('=== resolveLinePersonalUrl: validated canonical destination ===');

check(() => {
  assert.strictEqual(sb.resolveLinePersonalUrl('nattakamon.fern'), 'https://line.me/ti/p/~nattakamon.fern');
}, 'Test 1: valid Public LINE ID -> canonical https://line.me/ti/p/~<id>');

check(() => {
  assert.strictEqual(sb.resolveLinePersonalUrl(''), null);
  assert.strictEqual(sb.resolveLinePersonalUrl('   '), null);
}, 'Test 2: empty / whitespace Public LINE ID -> no destination');

check(() => {
  const invalid = [
    'ab', // too short
    'x'.repeat(31), // too long
    'has space', // disallowed char
    'javascript:alert(1)',
    'data:text/html,hi',
    'http://attacker.example',
    'https://attacker.example',
    'a/b', 'a?b', 'a#b', '<a>', '"quote"'
  ];
  invalid.forEach(v => assert.strictEqual(sb.resolveLinePersonalUrl(v), null, `must reject ${JSON.stringify(v)}`));
}, 'Test 3: invalid / hostile values rejected -- never a URL, never an arbitrary scheme or host');

console.log('\n=== Current Job card retired: OP LINE action lives only on Pre-assessment ===');
check(() => {
  const jobHtml = fs.readFileSync(path.join(ROOT, 'src/pages/job.html'), 'utf8');
  const jobState = fs.readFileSync(path.join(ROOT, 'src/js/job-state.js'), 'utf8');
  assert.ok(!jobHtml.includes('op-line-card'), 'Current Job no longer renders the OP LINE card');
  assert.ok(!jobState.includes('handleOpLineAction'), 'no Current Job click handler remains');
  assert.ok(jobState.includes('function resolveLinePersonalUrl'), 'the shared resolver is kept for the Pre-assessment link');
}, 'Retired: Current Job card and its click handler are removed; the resolver is kept');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
