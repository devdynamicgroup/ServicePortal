/**
 * Phase B Wiring Regression Suite
 * Run: node tests/eligibility/phase-b-wiring.test.js
 *
 * Loads the full production stack (benchmark engines + eligibility layer +
 * flows/score.js + common.js) in one sandbox, exactly like
 * tests/benchmark/benchmark-isolation.test.js, and proves:
 *
 *  Case 1 — everything complete -> canCalculateScore + canPublishReport, score shown
 *  Case 2 — measurements complete, visual incomplete -> canCalculateScore true, publish false
 *  Case 3 — missing chlorine -> canCalculateScore false, chlorine listed as missing
 *  Case 4 — missing pH -> canCalculateScore false
 *  Case 5 — production score identical before/after integration (locked at 93)
 *  Case 6 — benchmark outputs identical when eligible (locked scores, byte-identical metadata)
 *  Plus: publish gate never reaches the network when canPublishReport is false; already-published
 *  jobs are never newly blocked (backward compatibility).
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
    fetch: () => { throw new Error('fetch must not be called when not eligible'); },
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

console.log('\nCase 1 — everything complete -> canCalculateScore + canPublishReport, score shown');
{
  const sandbox = makeSandbox();
  sandbox.S.tapData = [{
    tasks: { tapphoto: true, meter: true, visual: true, chlorine: true },
    photos: {},
    standardMeasurement: FULL_READINGS
  }];
  const job = { draft: { tapData: sandbox.S.tapData } };
  const result = sandbox.resolveReportEligibility(job);
  assert(result.canCalculateScore === true, 'canCalculateScore is true');
  assert(result.canPublishReport === true, 'canPublishReport is true');
  assert(result.eligible === true, 'eligible alias is true');
  assert(result.reason === null, 'reason is null');
  assert(result.measurementCoverage === 100 && result.inspectionCoverage === 100, 'both coverage dimensions 100%');
  assert(result.missingMeasurements.length === 0, 'no missing measurements with a full reading set');
  assert(sandbox.EligibilityContract.isValid(result), 'result conforms to the Eligibility Contract');
}

console.log('\nCase 2 — measurements complete, visual incomplete -> score calculable, publish blocked');
{
  const sandbox = makeSandbox();
  sandbox.S.tapData = [{
    tasks: { tapphoto: true, meter: true, visual: false, chlorine: true },
    photos: {},
    standardMeasurement: FULL_READINGS
  }];
  const job = { draft: { tapData: sandbox.S.tapData } };
  const result = sandbox.resolveReportEligibility(job);
  assert(result.canCalculateScore === true, 'canCalculateScore is true (score must be visible)');
  assert(result.canPublishReport === false, 'canPublishReport is false');
  assert(result.eligible === false, 'eligible alias follows canPublishReport');
  assert(result.measurementCoverage === 100, 'measurementCoverage still 100% (measurements are fine)');
  assert(result.inspectionCoverage === 75, 'inspectionCoverage is 75% (1 of 4 tasks incomplete)');
  assert(result.missingInspection.includes('visual'), 'visual listed as missing inspection');
  assert(result.missingMeasurements.length === 0, 'no measurements are missing');
  assert(result.reason === 'Inspection incomplete', 'reason correctly attributes the publish block to inspection only');
}

console.log('\nCase 3 — missing chlorine -> canCalculateScore false, chlorine listed as missing');
{
  const sandbox = makeSandbox();
  const readings = { ...FULL_READINGS };
  delete readings.chlorine;
  sandbox.S.tapData = [{
    tasks: { tapphoto: true, meter: true, visual: true, chlorine: true },
    photos: {},
    standardMeasurement: readings
  }];
  const job = { draft: { tapData: sandbox.S.tapData } };
  const result = sandbox.resolveReportEligibility(job);
  assert(result.canCalculateScore === false, 'canCalculateScore is false');
  assert(result.canPublishReport === false, 'canPublishReport is false');
  assert(result.missingMeasurements.includes('chlorine'), 'chlorine listed as a missing measurement');
  assert(result.reason.includes('Missing measurements'), 'reason mentions missing measurements');
}

console.log('\nCase 4 — missing pH -> canCalculateScore false');
{
  const sandbox = makeSandbox();
  const readings = { ...FULL_READINGS };
  delete readings.ph;
  sandbox.S.tapData = [{
    tasks: { tapphoto: true, meter: true, visual: true, chlorine: true },
    photos: {},
    standardMeasurement: readings
  }];
  const job = { draft: { tapData: sandbox.S.tapData } };
  const result = sandbox.resolveReportEligibility(job);
  assert(result.canCalculateScore === false, 'canCalculateScore is false');
  assert(result.missingMeasurements.includes('ph'), 'ph listed as a missing measurement');
}

console.log('\nCase 5 — production score identical before/after integration (locked)');
{
  const sandbox = makeSandbox();
  assert(sandbox.computeLegacyDwqiScore(FULL_READINGS) === 93,
    'computeLegacyDwqiScore still returns the exact same locked value (93) after Phase B wiring');
  assert(Number.isFinite(sandbox.computeScoreFromReadings(FULL_READINGS)),
    'Quality V2 still computes a finite score from full readings');
}

console.log('\nCase 6 — benchmark outputs byte-identical when eligible (locked)');
{
  const sandbox = makeSandbox();
  // Country severity protection (2026-08-14): LOCKED's turbidity=2.5 is FAIL
  // on US EPA, now capped at 75 (was 91 uncapped).
  const expected = { thailand: 77, who: 93, eu: 65, japan: 96, usEpa: 75 };
  for (const key of Object.keys(expected)) {
    const score = sandbox.WaterScoreBenchmarkRegistry.calculate(key, FULL_READINGS).score;
    assert(score === expected[key], `${key} score still locked at ${expected[key]} (got ${score}) after Phase B wiring`);
  }
}

console.log('\nPublish gate — never reaches the network when canPublishReport is false; legacy published path still works');
{
  const sandbox = makeSandbox();
  sandbox.S.tapData = [{
    tasks: { tapphoto: true, meter: true, visual: false, chlorine: true },
    photos: {},
    standardMeasurement: FULL_READINGS
  }];
  const job = { draft: { tapData: sandbox.S.tapData }, notionId: 'case-1', result: {} };

  let threw = null;
  return sandbox.publishScoreBeforeClose(job).then(
    () => { threw = null; },
    err => { threw = err; }
  ).then(() => {
    assert(threw && threw.code === 'NOT_ELIGIBLE', 'publishScoreBeforeClose throws NOT_ELIGIBLE before ever calling fetch');
    assert(threw && threw.eligibility && threw.eligibility.canPublishReport === false,
      'thrown error carries canPublishReport=false');
    assert(threw && threw.eligibility && threw.eligibility.canCalculateScore === true,
      'thrown error still reports canCalculateScore=true (score was calculable)');

    // Backward compatibility: an already-published job's score is a fixed
    // number regardless of current live coverage — must not be newly blocked.
    const publishedJob = {
      draft: { tapData: sandbox.S.tapData },
      notionId: 'case-2',
      result: { waterScore: 88 }
    };
    sandbox.fetch = async () => ({
      ok: true,
      json: async () => ({ ok: true, reportUrl: 'https://example.test/r/abc', reportToken: 'abc' })
    });
    sandbox.S.scoreVal = 88;
    return sandbox.publishScoreBeforeClose(publishedJob).then(score => {
      assert(score === 88, 'already-published job is never newly blocked by Eligibility (backward compatibility)');
    }, err => {
      assert(false, `already-published job unexpectedly threw: ${err && err.message}`);
    });
  }).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
}
