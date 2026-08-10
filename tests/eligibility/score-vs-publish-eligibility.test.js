/**
 * Score Calculation vs Publish Eligibility — regression suite
 * Run: node tests/eligibility/score-vs-publish-eligibility.test.js
 *
 * Proves the product boundary:
 *   canCalculateScore  → Water Score visibility / calculation
 *   canPublishReport   → Complete / official publish
 *   eligible           → alias of canPublishReport (backward compat)
 *
 * Cases A–H from the eligibility boundary fix, including Case 13.28.
 * Does NOT load or mutate production/benchmark formulas beyond computing
 * locked scores for visibility assertions.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const files = [
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
  'src/js/score/eligibility/evidenceEngine.js',
  'src/js/score/eligibility/coverageEngine.js',
  'src/js/score/eligibility/contract.js',
  'src/js/score/eligibility/eligibilityEngine.js',
  'src/js/score/eligibility/presentation.js',
  'src/js/score/eligibility/reportEligibility.js',
  'src/js/flows/score.js',
  'src/js/common.js'
];

function makeSandbox() {
  const S = {
    lang: 'en', tapData: [], activeJob: null, publicScoreView: false,
    scoreVal: null, currentScoreResult: null, comparisonScoreResult: null, scoreStandardKey: null
  };
  const sandbox = {
    console,
    document: { getElementById: () => null, querySelector: () => null },
    S,
    t: k => k,
    fetch: () => { throw new Error('fetch must not be called when publish is blocked'); },
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => {}
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  }
  return sandbox;
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const FULL_READINGS = { ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5, temp: 28 };
const FULL_TASKS = { tapphoto: true, meter: true, visual: true, chlorine: true };

/** Case 13.28 — real meter values observed on Score UI (Free Chlorine only). */
const CASE_1328_READINGS = {
  ph: 7.79,
  tds: 92,
  turbidity: 0.12,
  orp: 434.1,
  do: 6.34,
  chlorine: 0.3,
  temp: 28.06,
  ec: 184,
  doPercent: 82
};

console.log('\nCase A — All numeric inputs complete, all inspection complete');
{
  const sandbox = makeSandbox();
  const c = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings: FULL_READINGS, tasks: FULL_TASKS
  });
  assert(c.canCalculateScore === true, 'canCalculateScore = true');
  assert(c.canPublishReport === true, 'canPublishReport = true');
  assert(c.eligible === true, 'eligible alias = true');
  assert(Number.isFinite(sandbox.computeScoreFromReadings(FULL_READINGS)), 'score is calculated');
  const presented = sandbox.EligibilityPresentation.format(c);
  assert(presented.scoreReady === true && presented.publishReady === true, 'presentation: score+publish ready');
  assert(presented.badgeText === 'Eligible', 'badge Eligible when publish-ready');
}

console.log('\nCase B — All numeric inputs complete, no photos / no inspection tasks');
{
  const sandbox = makeSandbox();
  const c = sandbox.EligibilityEngine.evaluate({
    reportType: 'production',
    readings: FULL_READINGS,
    tasks: { tapphoto: false, meter: false, visual: false, chlorine: false }
  });
  assert(c.canCalculateScore === true, 'canCalculateScore = true (photos do not block score)');
  assert(c.measurementCoverage === 100, 'measurementCoverage = 100');
  assert(c.inspectionCoverage === 0, 'inspectionCoverage = 0');
  assert(c.canPublishReport === false, 'canPublishReport = false under production inspection policy');
  assert(c.eligible === false, 'eligible alias follows canPublishReport');
  assert(Number.isFinite(sandbox.computeScoreFromReadings(FULL_READINGS)), 'score remains calculable');
  const presented = sandbox.EligibilityPresentation.format(c);
  assert(presented.scoreReady === true && presented.publishReady === false, 'presentation: score ready, publish not');
  assert(presented.badgeText === 'Score ready', 'badge Score ready when only inspection blocks publish');
}

console.log('\nCase C — Numeric complete; visual/odor/colour incomplete (odor/colour are not scoring gates)');
{
  const sandbox = makeSandbox();
  const c = sandbox.EligibilityEngine.evaluate({
    reportType: 'production',
    readings: FULL_READINGS,
    // odor/colour are not in the production requiredTasks list — only visual incomplete
    tasks: { tapphoto: true, meter: true, visual: false, chlorine: true }
  });
  assert(c.canCalculateScore === true, 'canCalculateScore = true');
  assert(c.inspectionCoverage < 100, 'inspectionCoverage < 100');
  assert(c.missingInspection.includes('visual'), 'visual listed in missingInspection');
  assert(!c.missingInspection.includes('odor'), 'odor is not a scoring/inspection gate on production policy');
  assert(!c.missingInspection.includes('colour') && !c.missingInspection.includes('color'),
    'colour is not a scoring/inspection gate on production policy');
  assert(Number.isFinite(sandbox.computeScoreFromReadings(FULL_READINGS)), 'score visible/calculable');
}

console.log('\nCase D — One numeric measurement missing (do)');
{
  const sandbox = makeSandbox();
  const readings = { ...FULL_READINGS };
  delete readings.do;
  const c = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings, tasks: FULL_TASKS
  });
  assert(c.canCalculateScore === false, 'canCalculateScore = false');
  assert(c.canPublishReport === false, 'canPublishReport = false');
  assert(c.missingMeasurements.includes('do'), 'missingMeasurements contains do');
  assert(c.eligibilityState === sandbox.EligibilityContract.STATE.READINGS_INCOMPLETE, 'READINGS_INCOMPLETE');
}

console.log('\nCase E — Free Chlorine only (no Total Chlorine field)');
{
  const sandbox = makeSandbox();
  const readings = {
    ph: 7.2, tds: 450, turbidity: 2.5, orp: 350, do: 6.5, chlorine: 0.4
    // intentionally no totalChlorine
  };
  const c = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings, tasks: FULL_TASKS
  });
  assert(c.canCalculateScore === true, 'canCalculateScore = true with Free Chlorine alone');
  assert(!c.missingMeasurements.includes('totalChlorine'), 'Total Chlorine is never required');
  assert(c.missingMeasurements.length === 0, 'no missing measurements');
}

console.log('\nCase F — Case 13.28 regression (numeric complete, inspection incomplete)');
{
  const sandbox = makeSandbox();
  sandbox.S.tapData = [{
    tasks: {},
    photos: {},
    standardMeasurement: {
      ph: CASE_1328_READINGS.ph,
      tds: CASE_1328_READINGS.tds,
      turbidity: CASE_1328_READINGS.turbidity,
      orp: CASE_1328_READINGS.orp,
      do: CASE_1328_READINGS.do,
      chlorine: CASE_1328_READINGS.chlorine,
      temp: CASE_1328_READINGS.temp
    }
  }];
  const job = { draft: { tapData: sandbox.S.tapData }, name: '13.28' };
  const c = sandbox.resolveReportEligibility(job);
  assert(c.measurementCoverage === 100, 'Case 13.28 measurementCoverage = 100');
  assert(c.canCalculateScore === true, 'Case 13.28 canCalculateScore = true');
  assert(c.canPublishReport === false, 'Case 13.28 canPublishReport = false (inspection incomplete)');
  assert(c.eligibilityState === sandbox.EligibilityContract.STATE.INSPECTION_INCOMPLETE,
    'Case 13.28 state = INSPECTION_INCOMPLETE');
  const score = sandbox.computeScoreFromReadings(CASE_1328_READINGS);
  assert(Number.isFinite(score), `Case 13.28 score is calculated (got ${score})`);
  assert(sandbox.EligibilityContract.isValid(c), 'Case 13.28 contract is valid');
}

console.log('\nCase G — Publish blocked when inspection incomplete even if score calculable');
{
  const sandbox = makeSandbox();
  sandbox.S.tapData = [{
    tasks: { tapphoto: true, meter: true, visual: false, chlorine: true },
    photos: {},
    standardMeasurement: FULL_READINGS
  }];
  const job = { draft: { tapData: sandbox.S.tapData }, notionId: 'g-1', result: {} };
  const c = sandbox.resolveReportEligibility(job);
  assert(c.canCalculateScore === true && c.canPublishReport === false,
    'canCalculateScore true / canPublishReport false');

  return sandbox.publishScoreBeforeClose(job).then(
    () => { assert(false, 'publish must throw when canPublishReport is false'); },
    err => {
      assert(err && err.code === 'NOT_ELIGIBLE', 'publishScoreBeforeClose throws NOT_ELIGIBLE');
      assert(err.eligibility.canPublishReport === false, 'error carries canPublishReport=false');
      assert(err.eligibility.canCalculateScore === true, 'error still reports canCalculateScore=true');
    }
  ).then(() => {
    console.log('\nCase H — Published legacy report remains unblocked');
    {
      const sandboxH = makeSandbox();
      const legacy = sandboxH.EligibilityContract.buildLegacy();
      assert(legacy.canCalculateScore === true && legacy.canPublishReport === true,
        'legacy bypass: both gates true');
      assert(legacy.eligibilityState === sandboxH.EligibilityContract.STATE.LEGACY_REPORT,
        'legacy state LEGACY_REPORT');

      const publishedJob = {
        draft: { tapData: [{ tasks: {}, photos: {}, standardMeasurement: {} }] },
        notionId: 'legacy-1',
        result: { waterScore: 88 }
      };
      sandboxH.fetch = async () => ({
        ok: true,
        json: async () => ({ ok: true, reportUrl: 'https://example.test/r/abc', reportToken: 'abc' })
      });
      sandboxH.S.scoreVal = 88;
      return sandboxH.publishScoreBeforeClose(publishedJob).then(score => {
        assert(score === 88, 'already-published job is never newly blocked');
      }, err => {
        assert(false, `legacy publish unexpectedly threw: ${err && err.message}`);
      });
    }
  }).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
}
