/**
 * Quality V3 / Compliance / Benchmark channel-separation proof.
 * Runs the validated-readings pipeline (MeasurementValidator → frozen
 * scoring engines) to prove the channels stay genuinely separate — not
 * silently merged — WITHOUT modifying any scoring engine.
 * Run: node tests/score/quality-compliance-separation.test.js
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
  'src/js/score/validation/measurementValidator.js'
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

// Real sample — read only, never modified/retuned.
const CASE_1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06 };

function validated(raw) {
  const result = sandbox.MeasurementValidator.validateMeasurements(raw);
  return result.measurements;
}

// ---- Quality V3 is independent of selected country benchmark (M12) ----
{
  const readings = validated(CASE_1328);
  const quality = sandbox.computeScoreFromReadings(readings);
  const th = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', readings);
  const jp = sandbox.WaterScoreBenchmarkRegistry.calculate('japan', readings);
  const who = sandbox.WaterScoreBenchmarkRegistry.calculate('who', readings);
  const eu = sandbox.WaterScoreBenchmarkRegistry.calculate('eu', readings);
  const epa = sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', readings);

  assert(quality < 100, 'Case 1328 Quality V3 score stays below 100 through the validated pipeline');
  // Raw composite is 100 on every engine for this reading; Country Hero
  // ceiling caps the displayed score at 99 (100 is reserved for Quality V3).
  // Thailand weakest-link share 0.25->0.5 (2026-08-17, PO-approved) moves its
  // raw composite for this reading to 98.35 (rounds to 98, below the ceiling,
  // so the ceiling is a no-op there); the other four engines are unaffected.
  assert(th.score === 98 && jp.score === 99 && who.score === 99 && eu.score === 99 && epa.score === 99,
    'Case 1328 scores 98 (Thailand) / 99 (Hero ceiling on all others), independent of Quality V3');
  assert(quality !== th.score, 'Quality V3 numerically differs from the (selected) country benchmark score');

  // Selecting a different benchmark must never change the Quality number.
  [th, jp, who, eu, epa].forEach((benchmarkResult, i) => {
    const stillQuality = sandbox.computeScoreFromReadings(readings);
    assert(stillQuality === quality, `Quality V3 unchanged after computing benchmark #${i + 1}`);
  });
}

// ---- Compliance can FAIL while Quality stays in the high-80s (single catastrophic parameter) ----
{
  const catastrophicCases = [
    { ...CASE_1328, ph: 12 },
    { ...CASE_1328, tds: 2000 },
    { ...CASE_1328, turbidity: 25 },
    { ...CASE_1328, orp: 900 },
    { ...CASE_1328, chlorine: 5 },
    { ...CASE_1328, do: 0.5 }
  ];

  for (const raw of catastrophicCases) {
    const readings = validated(raw);
    const detail = sandbox.computeQualityScoreDetail(readings);
    assert(detail.incomplete === false, 'catastrophic single-parameter case still has all 6 fields present');
    assert(detail.score >= 70, `catastrophic single-parameter case (score=${detail.score}) lands well above a "clearly bad" number — proving the channels do not silently merge into one`);
    assert(
      ['WARNING', 'FAIL'].includes(detail.compliance.status),
      `compliance channel independently flags the problem (status=${detail.compliance.status}) even while Quality stays high`
    );
  }
}

// ---- Quality V3 formula itself is untouched: Case 1328 bound stays exactly as before this change ----
{
  const readings = validated(CASE_1328);
  const quality = sandbox.computeScoreFromReadings(readings);
  assert(quality <= 94, 'Case 1328 Quality V3 score still <= 94 (pre-existing bound, engine untouched)');
  assert(quality < 96, 'Case 1328 Quality V3 score still < 96 (pre-existing bound, engine untouched)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
