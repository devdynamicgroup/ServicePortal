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

console.log('\n=== updateJobHeader: OP LINE card rendering ===');

check(() => {
  sb.updateJobHeader(jobWith({ linked: true, displayName: 'Nattakamon fern', userId: 'U123', publicId: 'nattakamon123' }));
  assert.strictEqual(els['op-line-card'].classList.contains('hidden'), false, 'card visible');
  assert.strictEqual(els['op-line-card'].dataset.destination, 'https://line.me/ti/p/~nattakamon123', 'destination uses publicId');
  assert.strictEqual(els['op-line-arrow'].classList.contains('hidden'), false, 'arrow shown when destination exists');
}, 'Test 4: verified + Public ID -> destination uses publicId, verified identity does not replace it');

check(() => {
  sb.updateJobHeader(jobWith({ linked: true, displayName: 'Nattakamon fern', userId: 'U123', publicId: '' }));
  assert.strictEqual(els['op-line-card'].dataset.destination, '', 'no URL fabricated from the verified name or userId');
  assert.strictEqual(els['op-line-arrow'].classList.contains('hidden'), true, 'no arrow without a destination');
  assert.strictEqual(els['op-line-name'].textContent, 'Nattakamon fern', 'verified name still labelled (identity display preserved)');
}, 'Test 5: verified + no Public ID -> no URL fabricated; label shows verified name only');

check(() => {
  sb.updateJobHeader(jobWith({ linked: false, displayName: '', userId: '', publicId: 'nattakamon123' }));
  assert.strictEqual(els['op-line-card'].dataset.destination, 'https://line.me/ti/p/~nattakamon123', 'destination works without a verified link');
  assert.strictEqual(els['op-line-name'].textContent, 'nattakamon123', 'label is the public id itself, never a verified claim');
}, 'Test 6: unverified + Public ID -> destination works, no verified claim made');

console.log('\n=== CRITICAL: URL generation never consumes lineUserId or displayName ===');

check(() => {
  sb.updateJobHeader(jobWith({ linked: true, displayName: 'https://attacker.example', userId: 'attacker.example', publicId: '' }));
  assert.strictEqual(els['op-line-card'].dataset.destination, '', 'userId / displayName that look like hosts never become a destination');
  sb.updateJobHeader(jobWith({ linked: true, displayName: 'Valid.Name', userId: 'Ufedcba9876543210', publicId: '' }));
  assert.strictEqual(els['op-line-card'].dataset.destination, '', 'a well-formed userId is still never turned into a line.me URL');
}, 'Test 7: lineUserId and displayName are never used to build a destination, even when they look valid');

check(() => {
  const srcUrl = src.slice(src.indexOf('function updateJobHeader'), src.indexOf('function openJobMapsLink'));
  assert.ok(!/resolveLinePersonalUrl\(\s*job\?\.line\?\.userId/.test(srcUrl), 'no call passes userId');
  assert.ok(!/resolveLinePersonalUrl\([^)]*displayName/.test(srcUrl), 'no call passes displayName');
  assert.ok(/resolveLinePersonalUrl\(publicId\)/.test(srcUrl), 'the only call passes the publicId variable');
}, 'Test 7b: static guard -- the only resolveLinePersonalUrl call in updateJobHeader is fed publicId');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
