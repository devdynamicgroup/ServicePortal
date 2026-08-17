/**
 * Country Benchmark Hero ceiling — dedicated regression lock.
 * Covers required cases A-F from the P0 release checklist:
 *   A. Country raw composite 100 -> Hero 99
 *   B. Country raw composite below ceiling -> unchanged
 *   C. Q-V3 independence -> ceiling never mutates S.scoreVal / published Q-V3
 *   D. Country switching -> routes to the selected engine, never >99
 *   E. TH severity preservation -> DIFF still 87, not further reduced
 *   F. Existing near-ideal fixture -> raw 100 -> Hero 99
 * Run: node tests/score/country-hero-ceiling.test.js
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
  'src/js/score/benchmark/usEpa/score.js'
];

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}
sandbox.console = { log: () => {}, warn: () => {}, error: console.error };

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function bench(key, readings) {
  return sandbox.WaterScoreBenchmarkRegistry.calculate(key, readings);
}

const IDEAL = Object.freeze({ ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, do: 8, chlorine: 0.3, temp: 25 });
const BASE = Object.freeze({ ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25 });
const DIFF = Object.freeze({ ph: 7.2, tds: 800, turbidity: 3.5, orp: 350, do: 5.5, chlorine: 1.5, temp: 28 });
const KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];

console.log('\nCase A — country raw composite 100 -> Hero 99');
{
  for (const key of KEYS) {
    const r = bench(key, IDEAL);
    assert(r.score === 99, `${key} raw-100 fixture (IDEAL) capped to 99 (got ${r.score})`);
  }
}

console.log('\nCase B — country raw composite below ceiling stays unaffected BY THE CEILING');
{
  // PD-014 D1/D2 (2026-08-14) changed WHO/EPA's own grading, so these values
  // moved from their pre-PD-014 baseline (95/79) — that movement is the
  // intended severity fix, not a ceiling effect. WARNING severity cap=85
  // (2026-08-14, PO-approved numeric) then further caps BASE's worst=WARNING
  // composite (was 93 pre-cap). What this case still proves is that values
  // already below 99 pass through the (unrelated, unmodified) ceiling untouched.
  assert(bench('who', BASE).score === 85, 'WHO BASE 85 (WARNING cap; still < 99, ceiling no-op)');
  assert(bench('eu', BASE).score === 65, 'EU BASE 65 unaffected (chlorine gate dominates; ceiling no-op)');
  // Country severity protection (2026-08-14): DIFF's TDS=800 is FAIL on EPA,
  // now capped at 75 (was 78 uncapped under D2 alone).
  assert(bench('usEpa', DIFF).score === 75, 'EPA DIFF 75 (TDS FAIL, severity-capped)');
}

console.log('\nCase C — Q-V3 independence: ceiling never mutates S.scoreVal / published Q-V3');
{
  const quality = sandbox.computeQualityScoreDetail(BASE).score;
  assert(quality === 76, `Q-V3 BASE stays 76, unrounded by Country ceiling (got ${quality})`);
  const jp = bench('japan', BASE).score;
  assert(jp === 98 && jp !== quality, 'Country Hero (98, PD-014 D1) numerically independent of Q-V3 (76)');
  // Direct proof the ceiling function itself never touches non-country scores:
  // it is a pure function applied only inside finalizeBenchmarkMetadata(),
  // never called by computeQualityScoreV2.js / computeProductionScore.js.
  const qv2Src = fs.readFileSync(path.join(root, 'src/js/score/production/computeQualityScoreV2.js'), 'utf8');
  const prodSrc = fs.readFileSync(path.join(root, 'src/js/score/production/computeProductionScore.js'), 'utf8');
  assert(!qv2Src.includes('applyCountryBenchmarkHeroCeiling'), 'Quality V3 source never references the Country ceiling');
  assert(!prodSrc.includes('applyCountryBenchmarkHeroCeiling'), 'Production score source never references the Country ceiling');
}

console.log('\nCase D — country switching routes to the selected engine, never >99');
{
  for (const key of KEYS) {
    const r = bench(key, IDEAL);
    assert(r.engineKey === key || r.engine, `${key} identifies its own engine`);
    assert(r.score <= 99, `${key} Hero never exceeds 99 (got ${r.score})`);
  }
  // Registry.calculate() is what buildComparisonScoreResult()/resolveDisplayedScore()
  // delegate to in src/js/flows/score.js (see displayed-score-country-switch.test.js
  // for the full UI-routing path with S state) — routing itself is proven here directly.
  const th = bench('thailand', DIFF);
  const jp = bench('japan', DIFF);
  assert(th.engineKey === 'thailand' && jp.engineKey === 'japan' && th.score !== jp.score,
    'switching engines returns genuinely different, correctly-routed results');
}

console.log('\nCase E — TH severity preservation: DIFF stays well below the ceiling, not further reduced by it');
{
  const th = bench('thailand', DIFF);
  // Thailand chlorine curve + weakest-link share 0.25->0.5 (2026-08-17, PO-approved): 46 (was 69).
  assert(th.score === 46, `TH DIFF raw composite already below ceiling, unchanged at 46 (got ${th.score})`);
}

console.log('\nCase F — existing near-ideal fixture: raw 100 -> Hero 99');
{
  const CASE_1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06 };
  // Thailand weakest-link share 0.25->0.5 (2026-08-17, PO-approved) moves TH's
  // raw composite for this reading from 98.9 to 98.35 (rounds to 98) -- below
  // the 99 ceiling, so the ceiling itself is a no-op here (not a regression).
  for (const key of KEYS) {
    const r = bench(key, CASE_1328);
    const expected = key === 'thailand' ? 98 : 99;
    assert(r.score === expected, `${key} Case 1328 (pre-existing near-ideal fixture) = ${expected} (got ${r.score})`);
  }
}

console.log('\nCeiling boundary — never below 99, never negative, non-finite passthrough');
{
  assert(sandbox.applyCountryBenchmarkHeroCeiling(100) === 99, 'ceiling(100) === 99');
  assert(sandbox.applyCountryBenchmarkHeroCeiling(99) === 99, 'ceiling(99) === 99 (no-op at boundary)');
  assert(sandbox.applyCountryBenchmarkHeroCeiling(50) === 50, 'ceiling(50) === 50 (no-op below boundary)');
  assert(sandbox.applyCountryBenchmarkHeroCeiling(null) === null, 'ceiling(null) passthrough');
  assert(Number.isNaN(sandbox.applyCountryBenchmarkHeroCeiling(NaN)), 'ceiling(NaN) passthrough');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
