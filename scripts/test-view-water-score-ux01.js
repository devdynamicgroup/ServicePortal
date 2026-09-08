'use strict';

/**
 * Regression test for the UX-01 fix (2026-09-08 UX audit).
 *
 * Root cause: the Assessment screen's primary button was labeled
 * "View Water Score" / "ดูคะแนนน้ำ" but called completeAssessment(), which
 * ran the SAME production case-closing pipeline as the Job screen's real
 * "Complete" button (finalizeCaseCompletion: publish score → POST /close →
 * closeCase report + LINE send attempt). A staff member tapping "View Water
 * Score" was actually closing the Case and attempting to deliver the result
 * to the customer, with no warning.
 *
 * Fix: renamed to viewWaterScore(). It still validates the assessment is
 * score-ready (validateAssessmentForComplete, unchanged -- Quality V3/
 * scoring logic itself is NOT touched by this fix) and marks the assess/
 * score workflow steps done (so completeJob()'s missingJobSteps() gate still
 * sees them as satisfied), but no longer calls finalizeCaseCompletion() --
 * it navigates to the score screen instead. The Job screen's completeJob()
 * (common.js) remains the ONLY path that actually closes a Case.
 *
 * This loads the real app (index.html's real script list, via linkedom + vm,
 * same harness scripts/test-payment-screen.js already uses) rather than
 * testing extracted/copied source, so a future refactor that reintroduces
 * the bug would break this test. The score-readiness gate itself
 * (validateAssessmentForComplete) and the sync call (ensureCaseSyncedToNotion)
 * are stubbed to isolate what THIS fix changed -- what happens after
 * validation passes -- from the pre-existing, out-of-scope scoring/sync
 * logic those two already-existing functions own.
 *
 * Run: node scripts/test-view-water-score-ux01.js
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

const assessmentHtml = fs.readFileSync(path.join(root, 'src/pages/assessment.html'), 'utf8');
const scoreHtml = fs.readFileSync(path.join(root, 'src/pages/score.html'), 'utf8');
const { document, window } = parseHTML(
  `<!DOCTYPE html><html><body><div id="app">${assessmentHtml}${scoreHtml}</div></body></html>`
);
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function () { this.scrollTop = 0; };
}
window.scrollTo = () => {};

const goScreenCalls = [];
const finalizeCaseCompletionCalls = [];

const ctx = {
  console,
  document,
  window,
  localStorage: { getItem: () => 'en', setItem() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout,
  clearTimeout,
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

console.log('\n=== Static wiring: button, function existence ===');
{
  const btn = document.querySelector('#s-assess .foot .btn-primary');
  assert(!!btn, 'Assessment footer primary button exists');
  assert(btn?.getAttribute('onclick') === 'viewWaterScore()', `button onclick calls viewWaterScore() (got "${btn?.getAttribute('onclick')}")`);
  assert(btn?.getAttribute('data-i18n') === 'assess.viewScore', 'button label i18n key unchanged (still the "view score" label, not renamed to imply completion)');
  assert(typeof ctx.viewWaterScore === 'function', 'viewWaterScore() is defined globally');
  assert(typeof ctx.completeAssessment === 'undefined', 'the old completeAssessment() name no longer exists (fully renamed, no dangling duplicate)');
  assert(typeof ctx.completeJob === 'function', 'completeJob() (the real close entry point) still exists, untouched by this fix');
}

console.log('\n=== Behavioral: viewWaterScore() does not close the Case ===');
{
  // NOTE: plain `function`/`async function` top-level declarations attach to
  // the vm context's own global object (ctx itself), NOT to ctx.window --
  // only the handful of identifiers state.js explicitly bridges (e.g. `S`,
  // via `if (typeof window !== 'undefined') window.S = S`) are reachable via
  // ctx.window. Same root cause as the window.S/window.JOBS notifications
  // bug fixed earlier this session. So: functions are read/written on `ctx`
  // directly; only the S state object goes through `ctx.window.S`.

  // Isolate this fix's change from the pre-existing, out-of-scope
  // validation/sync/scoring logic by stubbing their entry points --
  // this test verifies what happens AFTER validation passes, not the
  // validation or scoring logic itself.
  ctx.validateAssessmentForComplete = () => ({ valid: true, score: 82, missingTasks: [], missingReadings: [], readiness: { ready: true } });
  ctx.ensureCaseSyncedToNotion = async () => ({ ok: true });
  ctx.commitManualCaseIfNeeded = () => {};
  ctx.saveActiveJobState = () => {};
  ctx.persistJobs = () => {};
  ctx.showToast = () => {};

  ctx.finalizeCaseCompletion = async (...args) => {
    finalizeCaseCompletionCalls.push(args);
    return { ok: true };
  };
  const originalGoScreen = ctx.goScreen;
  ctx.goScreen = function (id) {
    goScreenCalls.push(id);
    return originalGoScreen(id);
  };

  ctx.window.S.activeJob = {
    id: 'test-job-1',
    notionId: 'test-notion-1',
    pkg: 'essential',
    draft: { stepsDone: { preassess: true, assess: false, score: false } }
  };
  ctx.window.S.stepsDone = { preassess: true, assess: false, score: false, payment: false, feedback: false };

  ctx.viewWaterScore().then(() => {
    assert(finalizeCaseCompletionCalls.length === 0, `finalizeCaseCompletion() was never called (got ${finalizeCaseCompletionCalls.length} call(s)) -- the Case is not closed, no LINE send attempted`);
    assert(ctx.window.S.stepsDone.assess === true, 'S.stepsDone.assess is marked true (so completeJob()\'s missingJobSteps() gate still sees this step satisfied)');
    assert(ctx.window.S.stepsDone.score === true, 'S.stepsDone.score is marked true');
    assert(goScreenCalls.includes('s-score'), `navigates to the score screen (goScreen calls: ${JSON.stringify(goScreenCalls)})`);
    assert(ctx.window.S.scoreVal === 82, 'S.scoreVal is primed with the computed score for display');

    console.log('\n=== Regression: completeJob() still gates on assess/score steps, still the real close path ===');
    const completeJobSrc = fs.readFileSync(path.join(root, 'src/js/common.js'), 'utf8');
    assert(completeJobSrc.includes('missingJobSteps()') && /async function completeJob/.test(completeJobSrc), 'completeJob() still checks missingJobSteps() before finalizing (unchanged gate)');
    assert(/finalizeCaseCompletion\(job, \{\s*buttonSelector: '#s-job \.foot \.btn-primary'/.test(completeJobSrc), 'completeJob() still calls finalizeCaseCompletion() -- the only remaining path that closes a Case and sends LINE');

    console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  }).catch(error => {
    console.error('FAIL  viewWaterScore() threw:', error.stack);
    process.exit(1);
  });
}
