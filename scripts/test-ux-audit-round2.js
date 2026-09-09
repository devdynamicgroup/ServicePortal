'use strict';

/**
 * Regression test for the 2026-09-09 UX forensic audit round (UX-04, UX-05,
 * UX-06, UX-09). UX-03/11, UX-07, UX-08, UX-10, UX-12, UX-14 were audited
 * and classified INTENTIONAL DESIGN / NO ISSUE / CLOSED with no code change
 * (see the audit report for evidence) -- not covered here since nothing
 * changed for them.
 *
 * Run: node scripts/test-ux-audit-round2.js
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

console.log('\n=== UX-04: Job Complete busy label no longer assumes "Sending" ===');
{
  const src = fs.readFileSync(path.join(root, 'src/js/common.js'), 'utf8');
  const sendingCount = (src.match(/'กำลังส่งผล…' : 'Sending…'/g) || []).length;
  assert(sendingCount === 1, `"Sending…" now appears exactly once in the whole file -- only at sendResultToLineNow() (a genuinely send-only action); the two case-closing busy-label sites no longer use it (found ${sendingCount} occurrences)`);
  const completingCount = (src.match(/'กำลังปิดเคส…' : 'Completing…'/g) || []).length;
  assert(completingCount === 2, `both busy-label sites (finalizeCaseCompletion()'s default + completeJob()'s override) now say "Completing…"/"กำลังปิดเคส…" (found ${completingCount} occurrences)`);
  const sendResultSrc = src.slice(src.indexOf('async function sendResultToLineNow'), src.indexOf('async function sendResultToLineNow') + 800);
  assert(sendResultSrc.includes("'กำลังส่งผล…' : 'Sending…'"), 'sendResultToLineNow() (a genuinely send-only action, untouched) still correctly says "Sending…"');
}

console.log('\n=== UX-05: Chat icon aria-label matches its real action ===');
{
  const jobHtml = fs.readFileSync(path.join(root, 'src/pages/job.html'), 'utf8');
  assert(!/aria-label="Chat"/.test(jobHtml), 'header icon no longer claims to be "Chat" (it never opens a chat -- resends LINE result or opens the connect QR)');
  assert(/aria-label="Send result via LINE" onclick="chatActiveJobClient\(\)"/.test(jobHtml), 'aria-label now describes the actual action');
}

console.log('\n=== UX-06: "Scanned" button no longer claims unverified state ===');
{
  const modalsHtml = fs.readFileSync(path.join(root, 'src/pages/partials/modals.html'), 'utf8');
  const i18nSrc = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
  assert(!modalsHtml.includes('line.connectPrompt.scanned'), 'modals.html no longer references the old scanned key');
  assert(!i18nSrc.includes("'line.connectPrompt.scanned'"), 'i18n.js no longer defines line.connectPrompt.scanned');
  assert(modalsHtml.includes('data-i18n="line.connectPrompt.close"'), 'the button now uses the honest line.connectPrompt.close key');
  assert(i18nSrc.includes("'line.connectPrompt.close': 'Close'") && i18nSrc.includes("'line.connectPrompt.close': 'ปิด'"), 'EN+TH values are a neutral dismissal, not a claim of verified binding');
  // Both buttons in this modal call the exact same closeLineConnectPromptModal() --
  // confirms "Close" is the only honest description; neither button can ever
  // differ in effect, so neither should claim to know more than "dismissed".
  const promptBlockMatch = modalsHtml.match(/line-connect-prompt-overlay[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert(!!promptBlockMatch, 'auto-connect prompt modal block found');
  const closeCalls = (promptBlockMatch[0].match(/onclick="closeLineConnectPromptModal\(\)"/g) || []).length;
  assert(closeCalls >= 2, `both "Later" and the renamed button call the same close function, confirming they were never functionally distinct (got ${closeCalls} call sites)`);
}

console.log('\n=== UX-09: Save Draft no longer clobbers a sync-failure toast with a false "saved" success message ===');
{
  const goScreenCalls = [];
  const toastCalls = [];

  const jobHtml = fs.readFileSync(path.join(root, 'src/pages/job.html'), 'utf8');
  const { document, window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${jobHtml}</div></body></html>`);
  window.scrollTo = () => {};

  function loadScriptListFromIndexHtml() {
    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const match = indexHtml.match(/const scripts = (\[[\s\S]*?\]);/);
    const list = JSON.parse(match[1].replace(/'/g, '"'));
    return list.filter(file => file !== 'src/js/page-loader.js' && file !== 'src/js/app.js');
  }

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
  for (const file of scripts) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }

  ctx.showToast = (msg) => toastCalls.push(msg);
  ctx.commitManualCaseIfNeeded = () => {};
  ctx.saveActiveJobState = () => {};
  ctx.persistJobs = () => {};
  ctx.renderCalendar = () => {};
  const originalGoScreen = ctx.goScreen;
  ctx.goScreen = (id) => { goScreenCalls.push(id); return originalGoScreen(id); };

  console.log('\n  --- scenario: manual unsynced job, Notion sync fails ---');
  ctx.ensureCaseSyncedToNotion = async () => ({ ok: false });
  ctx.window.S.activeJob = { id: 'job-1', manual: true, notionId: '' };
  ctx.saveDraft().then(() => {
    assert(toastCalls.length === 1, `exactly one toast shown on sync failure, not clobbered by a second (got ${toastCalls.length}: ${JSON.stringify(toastCalls)})`);
    assert(/sync ล้มเหลว|sync failed|ไม่สำเร็จ/i.test(toastCalls[0] || ''), `the one toast shown is the failure message, not "Draft saved" (got "${toastCalls[0]}")`);
    assert(!/^Draft saved$/i.test(toastCalls[0] || ''), 'failure message is not overwritten by the plain success text');

    console.log('\n  --- scenario: normal save, sync succeeds ---');
    toastCalls.length = 0;
    ctx.ensureCaseSyncedToNotion = async () => ({ ok: true });
    ctx.window.S.activeJob = { id: 'job-2', manual: false, notionId: 'notion-2' };
    return ctx.saveDraft();
  }).then(() => {
    assert(toastCalls.length === 1, `exactly one toast on a normal successful save (got ${toastCalls.length})`);
    assert(/บันทึกร่างแล้ว|Draft saved/.test(toastCalls[0] || ''), `success toast text present (got "${toastCalls[0]}")`);

    console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  }).catch(error => {
    console.error('FAIL  saveDraft() threw:', error.stack);
    process.exit(1);
  });
}
