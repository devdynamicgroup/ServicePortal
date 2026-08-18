/**
 * Country Score standard (scoreStandardKey) persistence per Case (2026-08-14).
 *
 * Root cause fixed: S.scoreStandardKey was pure in-memory session state,
 * hardcoded to default 'thailand' (src/js/state.js), never persisted or
 * restored per Case. Every fresh session/reload/reopen therefore fell back
 * to Thailand regardless of what benchmark the Case had previously been
 * viewed under — even though Thailand was explicitly out of scope for every
 * severity-protection fix in this project (PD-015 frozen).
 *
 * Fix: draft.scoreStandardKey is now saved/restored using the exact same
 * durable per-Case draft object already used for scoreTapFilter (job-state.js
 * saveActiveJobState()/loadJobState()) — no new persistence mechanism, no
 * Notion schema change, no Case-specific logic.
 *
 * Run: node tests/score/country-standard-persistence.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const files = [
  'src/js/assessment-snapshot.js',
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
  'src/js/score/benchmark/registry.js',
  'src/js/score/benchmark/thailand/limits.js',
  'src/js/score/benchmark/thailand/weights.js',
  'src/js/score/benchmark/thailand/score.js',
  'src/js/score/benchmark/who/limits.js',
  'src/js/score/benchmark/who/weights.js',
  'src/js/score/benchmark/who/score.js',
  'src/js/score/benchmark/eu/limits.js',
  'src/js/score/benchmark/eu/weights.js',
  'src/js/score/benchmark/eu/score.js',
  'src/js/score/benchmark/japan/limits.js',
  'src/js/score/benchmark/japan/weights.js',
  'src/js/score/benchmark/japan/score.js',
  'src/js/score/benchmark/usEpa/limits.js',
  'src/js/score/benchmark/usEpa/weights.js',
  'src/js/score/benchmark/usEpa/score.js',
  'src/js/flows/score.js',
  'src/js/job-state.js',
  'src/js/app.js'
];

function stubEl() {
  const handler = {
    get(target, prop) {
      if (prop === 'style') return new Proxy({}, { get: () => () => {} });
      if (prop === 'dataset' || prop === 'classList') return new Proxy({}, handler);
      if (prop === 'hidden' || prop === 'checked') return false;
      if (prop === 'textContent' || prop === 'innerHTML' || prop === 'value' || prop === 'src') return '';
      if (prop === 'querySelector' || prop === 'closest') return () => stubEl();
      if (prop === 'querySelectorAll') return () => [];
      if (prop === 'contains') return () => false;
      if (prop === 'getAttribute') return () => null;
      if (prop in target) return target[prop];
      return function () { return stubEl(); };
    },
    set() { return true; }
  };
  return new Proxy({}, handler);
}

function makeSandbox() {
  const storage = new Map();
  const S = {
    lang: 'en', scoreStandardKey: 'thailand', activeJob: null, scoreBaseReadings: null,
    scoreVal: null, currentScoreResult: null, comparisonScoreResult: null, displayedScore: null,
    scoreParamOpen: null, publicScoreView: false, taps: ['Kitchen'], scoreTapFilter: 'all',
    lastReadingsValidation: null, pkg: 'essential', stepsDone: {}, payMethod: 'cash', rating: 3,
    paymentSlipPhoto: null, paymentSlipSource: null, activeTap: 0, tapData: []
  };
  const sandbox = {
    console,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    clearTimeout: () => {},
    setTimeout: () => 0,
    document: {
      readyState: 'loading',
      addEventListener: () => {},
      getElementById: () => stubEl(),
      querySelector: () => stubEl(),
      querySelectorAll: () => []
    },
    S,
    t: (k) => k,
    JOBS: [],
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    OperatorNotificationBridge: null,
    OperatorNotificationObserver: null,
    goScreen: () => {},
    showToast: () => {}
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of files) vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  return sandbox;
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function makeJob(id, notionId, readings) {
  return {
    id, notionId, status: 'in_progress',
    draft: {
      pkg: 'essential', stepsDone: {}, payMethod: 'cash', rating: 3, scoreVal: null,
      scoreTapFilter: 'all', scoreBaseReadings: null, paymentSlipPhoto: null, paymentSlipSource: null,
      taps: ['Kitchen'], activeTap: 0,
      tapData: [{ tasks: {}, photos: {}, standardMeasurement: readings }],
      owner: 'yes', msMembers: [], msConcerns: [], fields: {}
      // scoreStandardKey intentionally absent — simulates a real existing
      // Case saved before this fix shipped.
    }
  };
}

const newc811 = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 };
const newc810 = { ph: 7.81, tds: 14.672, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 };

console.log('\nA. Pre-existing Case (no saved scoreStandardKey) opens with the same default as before');
{
  const job = makeJob('real-newc811', '3b99a92d-fb61-81f2-a65a-c34db7f6179d', newc811);
  const sb = makeSandbox();
  sb.S.activeJob = job;
  sb.loadJobState(job);
  assert(sb.S.scoreStandardKey === 'thailand', 'defaults to thailand when the Case never saved a standard before');
}

console.log('\nB. Select EU, save, reload (new S, same job object), reopen, navigate to Score — EU restored, Hero stays 65');
{
  const job = makeJob('real-newc811', '3b99a92d-fb61-81f2-a65a-c34db7f6179d', newc811);
  let sb = makeSandbox();
  sb.S.activeJob = job;
  sb.loadJobState(job);
  sb.setScoreReferenceStandard('eu');
  assert(sb.S.displayedScore.engineKey === 'eu' && sb.S.displayedScore.score === 65, 'EU selected, Hero=65');
  sb.saveActiveJobState();
  assert(job.draft.scoreStandardKey === 'eu', 'draft.scoreStandardKey persisted as eu on the job object');

  sb = makeSandbox(); // simulates a fresh page/session
  sb.S.activeJob = job;
  sb.loadJobState(job);
  assert(sb.S.scoreStandardKey === 'eu', 'EU restored automatically on reopen, no manual re-click needed');
  sb.goScreen('s-score');
  assert(sb.S.scoreStandardKey === 'eu', 'Score navigation does not overwrite restored EU');
  assert(sb.S.displayedScore.engineKey === 'eu' && sb.S.displayedScore.score === 65, 'Hero recomputes to EU=65 immediately after reload and Score navigation');
}

console.log('\nC. Switch to Thailand, save, reload, reopen — Thailand restored; switch back to EU — 65 again');
{
  const job = makeJob('real-newc811', '3b99a92d-fb61-81f2-a65a-c34db7f6179d', newc811);
  let sb = makeSandbox();
  sb.S.activeJob = job;
  sb.loadJobState(job);
  sb.setScoreReferenceStandard('thailand');
  sb.saveActiveJobState();
  assert(job.draft.scoreStandardKey === 'thailand', 'draft.scoreStandardKey persisted as thailand');

  sb = makeSandbox();
  sb.S.activeJob = job;
  sb.loadJobState(job);
  assert(sb.S.scoreStandardKey === 'thailand', 'thailand restored after reload');

  sb.setScoreReferenceStandard('eu');
  assert(sb.S.displayedScore.score === 65, 'switching back to EU is still 65');
}

console.log('\nD. Case identity and readings are never altered by this fix');
{
  const job = makeJob('real-newc811', '3b99a92d-fb61-81f2-a65a-c34db7f6179d', newc811);
  const sb = makeSandbox();
  sb.S.activeJob = job;
  sb.loadJobState(job);
  sb.setScoreReferenceStandard('eu');
  sb.saveActiveJobState();
  assert(job.id === 'real-newc811' && job.notionId === '3b99a92d-fb61-81f2-a65a-c34db7f6179d', 'no duplicate Case, same identity');
  assert(JSON.stringify(job.draft.tapData[0].standardMeasurement) === JSON.stringify(newc811), 'readings unchanged');
}

console.log('\nE. Second, independent real Case proves Japan persists through Score navigation');
{
  const job2 = makeJob('real-newc810', '3b89a92d-fb61-8105-8c80-ff4477932434', newc810);
  let sb = makeSandbox();
  sb.S.activeJob = job2;
  sb.loadJobState(job2);
  assert(sb.S.scoreStandardKey === 'thailand', 'Case 2 also defaults to thailand (same generic default, no hardcoding)');
  sb.setScoreReferenceStandard('japan');
  // 2026-08-18 (PO-approved): shared grading base for newc810 = 82; Japan
  // has no severity cap binding here.
  assert(sb.S.displayedScore.engineKey === 'japan' && sb.S.displayedScore.score === 79, 'Case 2 selects Japan, Hero=79');
  sb.saveActiveJobState();

  sb = makeSandbox();
  sb.S.activeJob = job2;
  sb.loadJobState(job2);
  assert(sb.S.scoreStandardKey === 'japan', 'Case 2 Japan selection restored after reload — proves generality, not a New-C-8/11-specific fix');
  sb.goScreen('s-score');
  assert(sb.S.scoreStandardKey === 'japan', 'Score navigation does not overwrite restored Japan');
  assert(sb.S.displayedScore.engineKey === 'japan' && sb.S.displayedScore.score === 79, 'Japan Hero remains selected after Score navigation');
}

console.log('\nF. Case A/B selection remains isolated through Score navigation');
{
  const caseA = makeJob('case-a', 'notion-a', newc811);
  const caseB = makeJob('case-b', 'notion-b', newc810);
  const sb = makeSandbox();

  sb.S.activeJob = caseA;
  sb.loadJobState(caseA);
  sb.setScoreReferenceStandard('eu');
  sb.saveActiveJobState();

  sb.S.activeJob = caseB;
  sb.loadJobState(caseB);
  sb.setScoreReferenceStandard('japan');
  sb.saveActiveJobState();
  sb.goScreen('s-score');
  assert(sb.S.scoreStandardKey === 'japan', 'Case B keeps Japan after Score navigation');

  sb.S.activeJob = caseA;
  sb.loadJobState(caseA);
  sb.goScreen('s-score');
  assert(sb.S.scoreStandardKey === 'eu', 'Case A restores EU instead of inheriting Case B Japan');
  assert(sb.S.displayedScore.engineKey === 'eu' && sb.S.displayedScore.score === 65, 'Case A Hero remains EU=65 after Case switch');
}

console.log('\nG. New Cases default exactly like existing ones (defaultJobDraft carries the same default)');
{
  const sb = makeSandbox();
  const draft = sb.defaultJobDraft({});
  assert(draft.scoreStandardKey === 'thailand', 'brand-new Case draft defaults scoreStandardKey to thailand');
}

(async () => {
  console.log('\nH. API refresh preserves local selection only for legacy API drafts without a stored value');
  const local = makeJob('real-newc811', '3b99a92d-fb61-81f2-a65a-c34db7f6179d', newc811);
  local.draft.scoreStandardKey = 'eu';
  local.draft.assessmentUpdatedAt = '2026-08-14T10:00:00.000Z';

  const remote = JSON.parse(JSON.stringify(local));
  delete remote.draft.scoreStandardKey;
  remote.draft.assessmentUpdatedAt = '2026-08-14T11:00:00.000Z';

  const sb = makeSandbox();
  sb.localStorage.setItem('wm-jobs', JSON.stringify([local]));
  sb.fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true, jobs: [remote] })
  });
  await sb.loadJobsFromApi();
  const refreshed = sb.JOBS.find(job => job.notionId === local.notionId);
  assert(refreshed?.draft?.scoreStandardKey === 'eu', 'API refresh keeps local EU when the legacy API draft has no country selection');
  sb.S.activeJob = refreshed;
  sb.loadJobState(refreshed);
  sb.goScreen('s-score');
  assert(sb.S.displayedScore?.engineKey === 'eu' && sb.S.displayedScore.score === 65, 'fresh API-loaded Case reaches Score with EU Hero=65');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
