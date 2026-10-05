/**
 * Regression for "opened a synced Case (notionId present) and every
 * Pre-assessment field showed blank, even right after a fresh server
 * confirmed the data was fully saved" (2026-10-06). Root cause for why
 * draft.fields went empty in memory was not pinned down during the live
 * session; this is a self-healing guard, not a targeted fix: openJob()
 * detects a synced Case whose draft.fields look implausibly empty (no
 * name AND no phone AND no email) and re-fetches once from /api/clients
 * to recover, rather than leaving the operator stuck on a blank form.
 *
 * Pure-function tests only (draftFieldsLookImplausiblyEmpty,
 * recoverJobDraftFromServer) via Node's vm module, same technique as
 * other scripts/test-*.js files in this suite -- no live Notion access,
 * no Case created/modified.
 *
 * Run: node scripts/test-open-job-empty-draft-recovery.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const fullSrc = fs.readFileSync(path.join(ROOT, 'src/js/flows/job.js'), 'utf8');
// job.js has module-level dependencies (STEP_ICONS, etc.) unrelated to the
// two pure/near-pure functions under test -- extract just those, same
// convention as this suite's other whole-file-load-fails cases.
const fnMatch = fullSrc.match(/\/\/ Reported 2026-10-06[\s\S]*?\nfunction openJob\(/);
if (!fnMatch) throw new Error('could not locate the guard functions in src/js/flows/job.js -- test out of sync with the fix');
const src = fnMatch[0].replace(/\nfunction openJob\($/, '');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
function check(fn, name) { try { fn(); ok(name); } catch (e) { fail(name, e); } }
async function checkAsync(fn, name) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }

function buildSandbox(fetchImpl) {
  const sandbox = {
    console,
    fetch: fetchImpl,
    S: { lang: 'en', activeJob: null },
    JOBS: [],
    showToast: () => {},
    saveActiveJobState: () => {},
    loadJobState: () => {},
    updateJobHeader: () => {},
    updateJobEditability: () => {},
    renderJobSteps: () => {},
    updateAssessScreen: () => {},
    renderCalendar: () => {},
    goScreen: () => {},
    persistJobs: () => {},
    persistActiveCaseRef: () => {},
    pushCaseOpenToNotion: () => Promise.resolve({ ok: false }),
    maybeAutoPromptLineConnect: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'job.js' });
  return sandbox;
}

console.log('=== draftFieldsLookImplausiblyEmpty ===');
{
  const sb = buildSandbox(() => Promise.reject(new Error('not used')));
  check(() => {
    const job = { notionId: 'abc', draft: { fields: {} } };
    assert.strictEqual(sb.draftFieldsLookImplausiblyEmpty(job), true);
  }, 'Test 1: synced Case with completely empty fields -> flagged implausible');

  check(() => {
    const job = { notionId: 'abc', draft: { fields: { 'ci-fname': 'John' } } };
    assert.strictEqual(sb.draftFieldsLookImplausiblyEmpty(job), false);
  }, 'Test 2: synced Case with at least a name -> not flagged');

  check(() => {
    const job = { draft: { fields: {} } }; // never synced -- no notionId
    assert.strictEqual(sb.draftFieldsLookImplausiblyEmpty(job), false);
  }, 'Test 3: a brand-new, never-synced Case with no notionId is legitimately blank -- never flagged');

  check(() => {
    const job = { notionId: 'abc', draft: { fields: { 'ci-postal': '', 'ci-proptype': 'Townhome' } } };
    assert.strictEqual(sb.draftFieldsLookImplausiblyEmpty(job), true);
  }, 'Test 4: only identity fields (name/phone/email) decide this -- other populated fields do not save it from being flagged');
}

console.log('\n=== recoverJobDraftFromServer ===');

(async () => {
  await checkAsync(async () => {
    const serverJobs = [{ notionId: 'abc', draft: { fields: { 'ci-fname': 'testOPline', 'ci-phone': '0960297415' } } }];
    const sb = buildSandbox(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, jobs: serverJobs }) }));
    const job = { notionId: 'abc', draft: { fields: {} } };
    const recovered = await sb.recoverJobDraftFromServer(job);
    assert.strictEqual(recovered, true, 'reports recovery succeeded');
    assert.strictEqual(job.draft.fields['ci-fname'], 'testOPline', 'draft.fields repopulated from the server');
    assert.strictEqual(job.draft.fields['ci-phone'], '0960297415');
  }, 'Test 5: server has the data -> recovers and repopulates draft.fields');

  await checkAsync(async () => {
    const serverJobs = [{ notionId: 'abc', draft: { fields: {} } }]; // server agrees it's empty
    const sb = buildSandbox(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, jobs: serverJobs }) }));
    const job = { notionId: 'abc', draft: { fields: {} } };
    const recovered = await sb.recoverJobDraftFromServer(job);
    assert.strictEqual(recovered, false, 'does not falsely claim recovery when the server itself has no data -- a genuinely blank Case stays blank, not papered over');
  }, 'Test 6: server also has empty fields -> no false recovery (this was never a client bug for this Case)');

  await checkAsync(async () => {
    const sb = buildSandbox(() => Promise.reject(new Error('network down')));
    const job = { notionId: 'abc', draft: { fields: {} } };
    const recovered = await sb.recoverJobDraftFromServer(job);
    assert.strictEqual(recovered, false, 'a network failure during recovery never throws -- just reports no recovery');
  }, 'Test 7: fetch failure is handled gracefully, never crashes openJob()');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
