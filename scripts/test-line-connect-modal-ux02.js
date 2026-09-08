'use strict';

/**
 * Regression test for the UX-02 fix (2026-09-08 UX audit).
 *
 * Root cause: the LINE-connect modal (opened only when a result could NOT
 * be delivered via LINE -- see openLineConnectModal()'s own doc comment,
 * common.js:551-554: "this modal only ever appears when it was NOT [sent]")
 * showed a static green checkmark badge reading "Processed" /
 * "ดำเนินการสำเร็จ" unconditionally at the top, every single time it opened.
 * That claim was false 100% of the time this modal could ever be shown.
 *
 * Fix: the badge now reads "Not connected yet" / "ยังไม่ได้เชื่อม LINE"
 * (i18n key renamed line.connect.processed -> line.connect.notConnected),
 * styled with the app's existing --warning token and a clock icon instead
 * of --line-green and a checkmark. No conditional logic was needed: since
 * the modal's own invariant guarantees LINE was never actually connected
 * when it's shown, "not connected yet" is accurate in both of the modal's
 * sub-states (readyComplete / readyIncomplete), which are unchanged.
 *
 * Run: node scripts/test-line-connect-modal-ux02.js
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

console.log('\n=== 1. i18n source values (both languages) ===');
{
  const i18nSrc = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
  assert(!i18nSrc.includes("'line.connect.processed'"), 'old misleading key line.connect.processed no longer defined');
  assert(i18nSrc.includes("'line.connect.notConnected': 'Not connected yet'"), 'EN badge text is honest ("Not connected yet")');
  assert(i18nSrc.includes("'line.connect.notConnected': 'ยังไม่ได้เชื่อม LINE'"), 'TH badge text is honest ("ยังไม่ได้เชื่อม LINE")');
  assert(!/'line\.connect\.notConnected':\s*'[^']*(Processed|สำเร็จ)[^']*'/.test(i18nSrc), 'neither language variant of the new key contains a success/"processed" word');
}

console.log('\n=== 2. Modal markup wiring ===');
{
  const modalsHtml = fs.readFileSync(path.join(root, 'src/pages/partials/modals.html'), 'utf8');
  const badgeMatch = modalsHtml.match(/<div class="line-connect-sent"[^>]*data-i18n="([^"]+)"[^>]*>([^<]*)<\/div>/);
  assert(!!badgeMatch, 'line-connect-sent badge element found in modals.html');
  assert(badgeMatch?.[1] === 'line.connect.notConnected', `badge data-i18n points at the renamed key (got "${badgeMatch?.[1]}")`);
  assert(badgeMatch?.[2] === 'Not connected yet', `badge fallback text (pre-i18n-apply) matches the new wording (got "${badgeMatch?.[2]}")`);
}

console.log('\n=== 3. CSS: badge no longer uses the success/green treatment ===');
{
  const cssSrc = fs.readFileSync(path.join(root, 'src/css/styles.css'), 'utf8');
  const ruleMatch = cssSrc.match(/\.line-connect-sent\{[^}]*\}/);
  assert(!!ruleMatch, '.line-connect-sent CSS rule found');
  assert(!ruleMatch[0].includes('--line-green'), 'badge no longer colored with --line-green (success color)');
  assert(ruleMatch[0].includes('--warning'), 'badge now uses the existing --warning token (consistent with the app\'s own palette, not an invented color)');
  const iconMatch = cssSrc.match(/\.line-connect-sent::before\{[^}]*mask:url\("([^"]+)"\) center/);
  assert(!!iconMatch && !iconMatch[1].includes('polyline'), 'checkmark icon (SVG polyline) replaced -- no longer visually implying success');
}

console.log('\n=== 4. Full app load: openLineConnectModal() renders the honest badge, lead text still state-aware ===');
{
  const modalsHtml = fs.readFileSync(path.join(root, 'src/pages/partials/modals.html'), 'utf8');
  const { document, window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${modalsHtml}</div></body></html>`);
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

  // Real applyI18n() populates data-i18n text content -- run it once so the
  // badge's live textContent (not just its data-i18n attribute) is checked.
  if (typeof ctx.applyI18n === 'function') ctx.applyI18n('en');

  const badgeEl = document.querySelector('.line-connect-sent');
  assert(badgeEl?.textContent.trim() === 'Not connected yet', `rendered badge text is honest after applyI18n (got "${badgeEl?.textContent.trim()}")`);

  // Scenario: result ready to deliver, customer just hasn't connected LINE yet.
  ctx.openLineConnectModal({ url: 'https://example.com/liff/bind/fb-test', qr: 'data:image/png;base64,x', code: 'fb-test', complete: true });
  const leadComplete = document.getElementById('line-connect-lead')?.textContent;
  assert(leadComplete === ctx.t('line.connect.readyComplete'), 'complete:true still shows the "ready to deliver" lead text (unchanged regression)');
  assert(badgeEl?.textContent.trim() === 'Not connected yet', 'badge stays honest in the complete:true sub-state (never claims success)');

  // Scenario: inspection itself still incomplete, customer also not connected.
  ctx.openLineConnectModal({ url: 'https://example.com/liff/bind/fb-test2', qr: 'data:image/png;base64,y', code: 'fb-test2', complete: false });
  const leadIncomplete = document.getElementById('line-connect-lead')?.textContent;
  assert(leadIncomplete === ctx.t('line.connect.readyIncomplete'), 'complete:false still shows the "not complete yet" lead text (unchanged regression)');
  assert(badgeEl?.textContent.trim() === 'Not connected yet', 'badge stays honest in the complete:false sub-state too');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
