'use strict';

/**
 * Regression test for the UX-07 fix (2026-09-11): the Job screen's "ส่งผล"
 * card only ever distinguished LINE linked/unlinked -- it never showed
 * whether THIS result had actually been delivered, sent, or failed. That
 * information (job.notification.status) was already persisted and already
 * read by the Operator Notification Center (notifications/bridge.js,
 * notifications/observer.js) -- this just surfaces the same field
 * persistently on the Job card instead of only via a 2s toast.
 *
 * Covers all 4 real states: unlinked, linked+never-sent, linked+sent,
 * linked+failed. Loads the real app (linkedom + vm, same harness used by
 * scripts/test-view-water-score-ux01.js) and exercises the real
 * updateJobHeader() function -- not extracted/copied source.
 *
 * Run: node scripts/test-job-result-status-ux07.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseHTML } = require('linkedom');

const root = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function loadScriptListFromIndexHtml() {
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const match = indexHtml.match(/const scripts = (\[[\s\S]*?\]);/);
  if (!match) throw new Error('Could not find the scripts array in index.html -- test out of sync with source');
  const list = JSON.parse(match[1].replace(/'/g, '"'));
  return list.filter(file => file !== 'src/js/page-loader.js' && file !== 'src/js/app.js');
}

const jobHtml = fs.readFileSync(path.join(root, 'src/pages/job.html'), 'utf8');
const { document, window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${jobHtml}</div></body></html>`);
window.scrollTo = () => {};

const ctx = {
  console, document, window,
  localStorage: { getItem: () => 'en', setItem() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout, clearTimeout,
  performance: { now: () => Date.now() },
  requestAnimationFrame: fn => setTimeout(() => fn(Date.now()), 0),
  fetch: async () => ({ ok: true, json: async () => ({ ok: true }) })
};
window.localStorage = ctx.localStorage;
window.location = { pathname: '/', protocol: 'http:' };
vm.createContext(ctx);

const scripts = loadScriptListFromIndexHtml();
let loadError = null;
for (const file of scripts) {
  try {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  } catch (error) {
    loadError = { file, error };
    break;
  }
}
if (loadError) {
  console.error('LOAD_FAIL', loadError.file, loadError.error.stack);
  process.exit(1);
}

function readCard() {
  return {
    sub: document.getElementById('line-send-sub')?.textContent,
    label: document.getElementById('line-send-btn-label')?.textContent
  };
}

console.log('\n=== UX-07: Job result-send card reflects the real 4 states ===');

ctx.updateJobHeader({ name: 'Test', timeStart: '09:00', timeEnd: '10:00', line: { linked: false }, notification: {} });
{
  const { sub, label } = readCard();
  assert(sub === 'Customer hasn’t connected LINE yet', `unlinked: subtitle is the existing unlinked copy (got "${sub}")`);
  assert(label === 'Scan to Connect', `unlinked: CTA is "Scan to Connect" (got "${label}")`);
}

ctx.updateJobHeader({ name: 'Test', timeStart: '09:00', timeEnd: '10:00', line: { linked: true }, notification: { status: 'not_sent' } });
{
  const { sub, label } = readCard();
  assert(sub === 'Connected — ready to send the result', `linked + not_sent: shows "ready", not a resend-toned message (got "${sub}")`);
  assert(label === 'Send', `linked: CTA is "Send" (got "${label}")`);
}

ctx.updateJobHeader({ name: 'Test', timeStart: '09:00', timeEnd: '10:00', line: { linked: true }, notification: { status: 'sent' } });
{
  const { sub } = readCard();
  assert(sub === 'Result sent to customer', `linked + sent: persistent "sent" status shown (got "${sub}"), not just a toast that disappears`);
}

ctx.updateJobHeader({ name: 'Test', timeStart: '09:00', timeEnd: '10:00', line: { linked: true }, notification: { status: 'failed' } });
{
  const { sub } = readCard();
  assert(sub === 'Send failed — tap to try again', `linked + failed: actionable failure message shown (got "${sub}")`);
}

// Unlinked always wins the messaging regardless of any stale notification.status left over.
ctx.updateJobHeader({ name: 'Test', timeStart: '09:00', timeEnd: '10:00', line: { linked: false }, notification: { status: 'sent' } });
{
  const { sub } = readCard();
  assert(sub === 'Customer hasn’t connected LINE yet', `unlinked always shows unlinked copy even if a stale notification.status="sent" exists from a prior linked customer (got "${sub}")`);
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
