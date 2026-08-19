/**
 * Case 13.28 + locked-score baseline after Quality V2.
 * Legacy DWQI remains frozen; active computeScoreFromReadings = Quality V2.
 * Run: node tests/score/case-1328-calibration-baseline.test.js
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
  'src/js/score/eligibility/presentation.js'
];

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const LOCKED = { ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5, temp: 28 };
const CASE_1328 = {
  ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06
};

console.log('\nLocked sample (legacy DWQI freeze)');
{
  assert(sandbox.computeLegacyDwqiScore(LOCKED) === 93, 'Legacy DWQI locked = 93');
  // 2026-08-18 (PO-approved): all 5 engines now share one grading formula
  // (computeSharedBenchmarkBase); raw base for LOCKED = 73 for every engine.
  // WHO/US EPA both classify turbidity=2.5 as CRITICAL, capping at 60.
  // EU's PD-002 chlorine gate (chlorine classifies CRITICAL) caps at 65.
  // Japan's own (tighter) thresholds classify tds/turbidity FAIL, and the
  // guaranteed minimum deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.FAIL=6)
  // always comes off when FAIL is the worst classification, even though
  // raw 73 is below the 75 FAIL ceiling: 73 - 6 = 67.
  // 2026-08-19 (PO-approved, evidence-based): Thailand's own turbidity
  // passMax corrected 5→1.0 (MWA operating spec) — turbidity=2.5 now also
  // classifies FAIL for Thailand, and the same guaranteed minimum deduction
  // (FAIL=6) comes off here too: 73 - 6 = 67.
  // 2026-08-19 (bug fix): japan/weights.js no longer carries a `do` key —
  // DO was silently pulling LOCKED's do=6.5 grade into Japan's composite
  // despite Japan classifying DO as NOT_EVALUATED (PD-012 B). Excluding it
  // raises Japan's raw base, shifting its FAIL-guaranteed-deduction result
  // from 64 to 63.
  const expected = { thailand: 66, who: 60, eu: 63, japan: 63, usEpa: 57 };
  for (const [key, score] of Object.entries(expected)) {
    assert(sandbox.WaterScoreBenchmarkRegistry.calculate(key, LOCKED).score === score,
      `${key} locked = ${score}`);
  }
}

console.log('\nCase 13.28 — Quality V2 + benchmarks');
{
  assert(sandbox.computeLegacyDwqiScore(CASE_1328) === 100, 'Legacy DWQI Case 13.28 = 100');
  const quality = sandbox.computeScoreFromReadings(CASE_1328);
  assert(Number.isFinite(quality) && quality < 100, `Quality V3 Case 13.28 < 100 (got ${quality})`);
  assert(quality <= 94, `Quality V3 Case 13.28 not overfit (got ${quality})`);
  assert(quality < 96, `Quality V3 below prior V2 Case A band (got ${quality})`);
  assert(sandbox.QUALITY_SCORE_ENGINE_VERSION === 'quality-v3.0', 'engine version quality-v3.0');
  // 2026-08-18 (PO-approved): all 5 engines share one grading formula; raw
  // base for CASE_1328 = 92 for every engine. Japan's PASS threshold now
  // uses its own government-cited "comfortable water" target band (see
  // japan/limits.js) instead of the wider legal band — CASE_1328's
  // pH=7.79 misses Japan's tighter 7.3-7.7 target (still fine on every
  // other engine's wider band), classifying WARNING and capping at 85.
  const expected = { thailand: 95, who: 92, eu: 94, japan: 85, usEpa: 94 };
  for (const [key, score] of Object.entries(expected)) {
    const result = sandbox.WaterScoreBenchmarkRegistry.calculate(key, CASE_1328);
    assert(result.score === score, `${key} Case 13.28 = ${score}`);
  }
  assert(!('totalChlorine' in CASE_1328), 'Total Chlorine not invented in fixture');
}

console.log('\nEligibility separation still holds for Case 13.28');
{
  const elig = sandbox.EligibilityEngine.evaluate({
    reportType: 'production',
    readings: CASE_1328,
    tasks: {}
  });
  assert(elig.canCalculateScore === true, 'canCalculateScore = true');
  assert(elig.canPublishReport === false, 'canPublishReport = false');
  assert(elig.eligible === false, 'eligible aliases publish gate');
}

console.log('\nBoundary still reduces Quality V2 score');
{
  const base = sandbox.computeScoreFromReadings(CASE_1328);
  assert(sandbox.computeScoreFromReadings({ ...CASE_1328, ph: 9.5 }) < base, 'pH out of band reduces Quality');
  assert(sandbox.computeScoreFromReadings({ ...CASE_1328, chlorine: 0.8 }) < base, 'Cl 0.8 reduces Quality');
  const thCl = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', { ...CASE_1328, chlorine: 0.8 });
  // 2026-08-18 (PO-approved): shared chlorine curve grades 0.8 at 67.6 (past
  // the 0.2-0.5 plateau), pulling the shared base average from 92 to 87.
  assert(thCl.score === 89, `Thai Cl 0.8 severity-graded to 89 (got ${thCl.score}), still inside 0.2–2.0`);
  assert(thCl.statuses.chlorine === 'good', 'Thai Cl 0.8 remains compliance-pass');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
