/**
 * Pre-assessment "เปิดแชท OP LINE" link: visible only for a persisted,
 * server-confirmed, validated Public LINE ID; never built from unsaved input;
 * reuses resolveLinePersonalUrl. Loads the REAL src/js/job-state.js in vm.
 *
 * Run: node scripts/test-op-line-preassess-link.js
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
    textContent: '', href: null,
    classList: {
      toggle(c, on) { const v = on === undefined ? !classes.has(c) : !!on; v ? classes.add(c) : classes.delete(c); },
      contains(c) { return classes.has(c); }
    },
    removeAttribute(n) { if (n === 'href') this.href = null; }
  };
}

function env() {
  const els = { 'line-verified-badge': makeEl(), 'line-op-link': makeEl() };
  const sb = {
    console,
    document: { getElementById: (id) => els[id] || null },
    window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    S: { taps: [], tapData: [], pkg: 'essential', activeJob: null },
    t: (k) => (k === 'preassess.opLineOpen' ? '↗ Open OP LINE chat' : k === 'preassess.lineVerifiedAs' ? 'Verified as' : k),
    showToast() {},
    AssessmentSnapshot: { preferDraft: () => null, draftHasMeasurements: () => false },
    normalizeInterruptedPhoto: (p) => p
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'job-state.js' });
  return { sb, els };
}

const SAVED = '0924061974fern';
const job = (saved, line = {}) => ({ line: { linked: false, displayName: '', userId: '', ...line }, draft: { lineIdServerValue: saved, fields: {} } });

check(() => {
  const { sb, els } = env();
  sb.updateLineVerifiedBadge(job(SAVED));
  assert.strictEqual(els['line-op-link'].classList.contains('hidden'), false, 'UI-1: visible for a saved valid ID');
  assert.strictEqual(els['line-op-link'].href, `https://line.me/ti/p/~${SAVED}`, 'UI-1: destination is the existing canonical URL');
}, 'UI-1: saved valid ID shows the link to the canonical destination');

check(() => {
  const { sb, els } = env();
  sb.updateLineVerifiedBadge(job(''));
  assert.strictEqual(els['line-op-link'].classList.contains('hidden'), true);
  assert.strictEqual(els['line-op-link'].href, null, 'no empty anchor or href');
}, 'UI-2: saved empty ID hides the link');

check(() => {
  const { sb, els } = env();
  sb.updateLineVerifiedBadge(job('has space!'));
  assert.strictEqual(els['line-op-link'].classList.contains('hidden'), true);
  assert.strictEqual(els['line-op-link'].href, null);
}, 'UI-3: saved invalid ID hides the link (validation not weakened)');

check(() => {
  // Unsaved input "anotherPerson123" lives only in draft.fields; the link must ignore it.
  const { sb, els } = env();
  const j = job(SAVED);
  j.draft.fields['ci-line'] = 'anotherPerson123';
  j.draft.lineIdDiffersFromServer = true;
  sb.updateLineVerifiedBadge(j);
  assert.strictEqual(els['line-op-link'].href, `https://line.me/ti/p/~${SAVED}`, 'UI-4: still the saved ID');
}, 'UI-4: an unsaved different input does not change the destination');

check(() => {
  const { sb, els } = env();
  const j = job(SAVED);
  j.draft.fields['ci-line'] = '';
  j.draft.lineIdDiffersFromServer = true;
  sb.updateLineVerifiedBadge(j);
  assert.strictEqual(els['line-op-link'].href, `https://line.me/ti/p/~${SAVED}`, 'UI-5: cleared unsaved input keeps the saved destination');
  assert.strictEqual(els['line-op-link'].classList.contains('hidden'), false);
}, 'UI-5: an unsaved clear does not hide or retarget the link');

check(() => {
  const { sb, els } = env();
  sb.updateLineVerifiedBadge(job('newValid1234'));
  assert.strictEqual(els['line-op-link'].href, 'https://line.me/ti/p/~newValid1234', 'UI-6: after a confirmed save the link follows the new saved ID');
}, 'UI-6: successful save updates the link to the confirmed ID');

check(() => {
  const { sb, els } = env();
  sb.updateLineVerifiedBadge(job(SAVED, { linked: true, displayName: 'Nattakamon fern', userId: 'U123' }));
  assert.strictEqual(els['line-verified-badge'].classList.contains('hidden'), false, 'UI-7: badge still shown when verified');
  assert.strictEqual(els['line-verified-badge'].textContent, '✓ Verified as Nattakamon fern', 'UI-7: badge text unchanged');
}, 'UI-7: verification badge is unchanged by the link');

check(() => {
  const srcBlock = src.slice(src.indexOf('function resolveLinePersonalUrl'), src.indexOf('function resolveLinePersonalUrl') + 400);
  assert.ok(srcBlock.includes('LINE_PUBLIC_ID_PATTERN.test(trimmed)'), 'UI-9: the existing validated resolver is the only destination source');
  const linkBlock = src.slice(src.indexOf("const opLink = document.getElementById('line-op-link')"), src.indexOf("const opLink = document.getElementById('line-op-link')") + 400);
  assert.ok(linkBlock.includes('resolveLinePersonalUrl(job?.draft?.lineIdServerValue)'), 'UI-9: link reuses the resolver with the saved value');
  assert.ok(!/opLink\.href\s*=\s*[^;]*fields/.test(src), 'UI-4: link never reads draft.fields');
}, 'UI-9/UI-4 static guard: one resolver, saved value only');

check(() => {
  const { sb, els } = env();
  sb.updateLineVerifiedBadge(job('javascript:alert(1)'));
  assert.strictEqual(els['line-op-link'].href, null, 'UI-10: javascript: value never becomes a link');
  sb.updateLineVerifiedBadge(job('http://evil.example'));
  assert.strictEqual(els['line-op-link'].href, null, 'UI-10: arbitrary URL never becomes a link');
}, 'UI-10: unsafe values never become an href');

check(() => {
  const i = src.indexOf('S.activeJob = refreshed;');
  assert.ok(i > 0 && src.slice(i, i + 200).includes('updateLineVerifiedBadge(refreshed)'), 'background refresh updates the open Case link');
}, 'Background refresh: the open Case link refreshes after the list merge');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
