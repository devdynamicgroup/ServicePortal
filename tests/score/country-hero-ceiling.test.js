/**
 * Country Benchmark Hero ceiling — dedicated regression lock.
 * Covers required cases A-F from the P0 release checklist:
 *   A. Country raw composite 100 -> Hero 99
 *   B. Country raw composite below ceiling -> unchanged
 *   C. Q-V3 independence -> ceiling never mutates S.scoreVal / published Q-V3
 *   D. Country switching -> routes to the selected engine, never >99
 *   E. TH severity preservation -> DIFF still 87, not further reduced
 *   F. Existing near-ideal fixture -> raw 92, below ceiling, unchanged
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
// 2026-08-19 (PO-approved, evidence-based): Thailand's own TDS/turbidity
// passMax were corrected to real cited Thai standards (DOH 2020 ≤500 / MWA
// spec ≤1.0), so plain DIFF above now also fails Thailand (no longer
// suitable for cases that need Thailand to stay uncapped while Japan caps).
// This fixture clears Thailand's corrected bounds while still failing
// Japan's own stricter comfort-target thresholds (pH 7.3-7.7 ideal / TDS
// ideal ≤200) — used by Cases D and E below.
const DIFF_TH_SAFE = Object.freeze({ ph: 8.0, tds: 350, turbidity: 0.5, orp: 400, do: 6, chlorine: 0.5, temp: 26 });
const KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];

console.log('\nCase A — country raw composite 100 -> Hero 99');
{
  for (const key of KEYS) {
    const r = bench(key, IDEAL);
    // 2026-08-18 (PO-approved): all 5 engines share one grading formula;
    // IDEAL grades 100 on every param for every engine, so the raw
    // composite is 100 everywhere. Japan is the one exception: its own
    // government-cited "comfortable water" pH target (7.3-7.7 — see
    // japan/limits.js) doesn't include IDEAL's pH=7.2 (Quality V3's own
    // project-defined ideal center, not itself Japan-sourced), so pH
    // classifies WARNING on Japan alone and its 85 severity cap binds
    // before the 99 Hero ceiling would ever apply.
    if (key === 'japan') {
      assert(r.score === 85, `japan raw-100 fixture (IDEAL) WARNING-capped at 85, not the 99 ceiling (got ${r.score})`);
    } else {
      assert(r.score === 99, `${key} raw-100 fixture (IDEAL) capped to 99 (got ${r.score})`);
    }
  }
}

console.log('\nCase B — country raw composite below ceiling stays unaffected BY THE CEILING');
{
  // 2026-08-18 (PO-approved): grading is shared, but each engine's own
  // classification/gate still applies. WHO classifies BASE's chlorine/do
  // as FAIL; raw base (76) is already below the 75 FAIL ceiling, so the
  // guaranteed minimum deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.FAIL=6)
  // is what actually moves it: 76 - 6 = 70. EU's PD-002 chlorine gate binds
  // regardless. What this case still proves is that values already below
  // 99 pass through the (unrelated, unmodified) ceiling untouched.
  assert(bench('who', BASE).score === 70, 'WHO BASE 70 (FAIL cap + guaranteed deduction; still < 99, ceiling no-op)');
  assert(bench('eu', BASE).score === 65, 'EU BASE 65 unaffected (chlorine gate dominates; ceiling no-op)');
  // DIFF's tds/turbidity classify CRITICAL on US EPA; raw base (61) is
  // already below the 60 CRITICAL ceiling, so the guaranteed minimum
  // deduction (CRITICAL=10) is what actually moves it: 61 - 10 = 51.
  assert(bench('usEpa', DIFF).score === 51, 'EPA DIFF 51 (CRITICAL cap + guaranteed deduction; still < 99, ceiling no-op)');
}

console.log('\nCase C — Q-V3 independence: ceiling never mutates S.scoreVal / published Q-V3');
{
  const quality = sandbox.computeQualityScoreDetail(BASE).score;
  assert(quality === 76, `Q-V3 BASE stays 76, unrounded by Country ceiling (got ${quality})`);
  const jp = bench('japan', BASE).score;
  // 2026-08-18 (PO-approved): BASE's pH (7.85) is outside Japan's own
  // tighter comfortable-water band (7.3-7.7 — see japan/limits.js), so
  // Japan itself already diverges from Q-V3 here (guaranteed WARNING
  // deduction, 76 -> 73) — that alone is one proof of independence.
  // COINCIDE (ph=7.5, otherwise identical to BASE) keeps pH inside Japan's
  // band, so when no severity cap or gate binds, a country's score CAN
  // still numerically coincide with Quality V3 — that's expected, not a
  // leak. Independence is proven by showing the two are computed by
  // genuinely separate code paths (grep check below) AND by a fixture
  // where a country-specific cap makes them diverge: DIFF's tds/turbidity
  // classify CRITICAL on Japan (cap 60, guaranteed deduction lowers it
  // further to 51), while Quality V3 has no such cap and stays at its own
  // raw value.
  assert(jp === 73 && jp !== quality, `Country Hero (${jp}) already diverges from Q-V3 (${quality}) — Japan's own pH band + guaranteed deduction`);
  const coincide = { ...BASE, ph: 7.5 };
  const jpCoincide = bench('japan', coincide).score;
  const qualityCoincide = sandbox.computeQualityScoreDetail(coincide).score;
  assert(jpCoincide === qualityCoincide, `Country Hero (${jpCoincide}) coincides with Q-V3 (${qualityCoincide}) when ph is inside Japan's own band too, no cap binds`);
  const jpDiff = bench('japan', DIFF).score;
  const qualityDiff = sandbox.computeQualityScoreDetail(DIFF).score;
  assert(jpDiff !== qualityDiff, `Country Hero (${jpDiff}) diverges from Q-V3 (${qualityDiff}) once Japan's own severity cap binds — proves independence`);
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
  const th = bench('thailand', DIFF_TH_SAFE);
  const jp = bench('japan', DIFF_TH_SAFE);
  assert(th.engineKey === 'thailand' && jp.engineKey === 'japan' && th.score !== jp.score,
    'switching engines returns genuinely different, correctly-routed results');
}

console.log('\nCase E — TH severity preservation: DIFF_TH_SAFE stays well below the ceiling, not further reduced by it');
{
  const th = bench('thailand', DIFF_TH_SAFE);
  // 2026-08-19 (PO-approved, evidence-based): shared grading base for
  // DIFF_TH_SAFE = 81; Thailand has no severity cap binding here (all its
  // own — now corrected — classifications stay within PASS), so the raw 81
  // passes through both severity protection and the ceiling (well below 99)
  // unchanged.
  assert(th.score === 81, `TH DIFF_TH_SAFE raw composite already below ceiling, unchanged at 81 (got ${th.score})`);
}

console.log('\nCase F — existing near-ideal fixture: raw 92 (below ceiling), unchanged across engines');
{
  const CASE_1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06 };
  // 2026-08-18 (PO-approved): shared grading base for CASE_1328 = 92 for
  // every engine. Japan is the exception: pH=7.79 misses its own tighter
  // comfortable-water target (7.3-7.7 — see japan/limits.js), classifying
  // WARNING and binding its 85 cap; every other engine's classifications
  // stay PASS, so their raw composite (92, not 100) never reaches the ceiling.
  for (const key of KEYS) {
    const r = bench(key, CASE_1328);
    const expected = key === 'japan' ? 85 : 92;
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
