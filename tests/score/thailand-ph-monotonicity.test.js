/**
 * pH grading monotonicity/continuity regression lock.
 *
 * 2026-08-18 (PO-approved): Thailand's own gradePh() — the exact function
 * this file originally locked down after the bf3342db outer-branch anchor
 * bug (a worse pH scoring HIGHER than one right at the boundary) — was
 * deleted. All 5 country engines (Thailand/Japan/WHO/EU/US EPA) now share
 * one grading formula, computeSharedBenchmarkBase() in
 * src/js/score/production/computeQualityScoreV2.js, which reuses that
 * module's own gradePh() (center 7.2, symmetric distance-based decline —
 * see PD-011 A). This file now locks down monotonicity/continuity/bounds on
 * THAT shared curve instead, plus the new cross-engine invariant the
 * rebuild depends on: every engine must grade the same pH value identically,
 * since there is only one curve left to have a bug in.
 * Run: node tests/score/thailand-ph-monotonicity.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const files = [
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
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
sandbox.globalThis = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
sandbox.console = { log: () => {}, warn: () => {}, error: console.error };

let passed = 0; let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const IDEAL = { ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, chlorine: 0.3 };
const KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];

function grade(ph, key = 'thailand') {
  return sandbox.WaterScoreBenchmarkRegistry.calculate(key, { ...IDEAL, ph }).params.ph;
}

console.log('\nCross-engine invariant — one shared pH curve, every engine agrees');
{
  const points = [5.0, 6.0, 6.5, 7.0, 7.2, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0];
  for (const ph of points) {
    const grades = KEYS.map(key => grade(ph, key));
    const allEqual = grades.every(g => g === grades[0]);
    assert(allEqual, `pH=${ph} grades identically across engines (${JSON.stringify(Object.fromEntries(KEYS.map((k, i) => [k, grades[i]])))})`);
  }
}

console.log('\nBoundedness');
{
  for (const ph of [0, 3, 5, 6.5, 7.2, 8.5, 10, 14]) {
    const g = grade(ph);
    assert(g >= 0 && g <= 100, `grade(${ph}) bounded [0,100] (got ${g})`);
  }
}

console.log('\nMonotonicity around the center (7.2) — no direction ever improves score by moving away');
{
  const lowSide = [5.0, 5.5, 6.0, 6.5, 6.8, 7.0, 7.05, 7.2];
  for (let i = 1; i < lowSide.length; i++) {
    const a = grade(lowSide[i - 1]);
    const b = grade(lowSide[i]);
    assert(b >= a - 1e-9, `grade non-decreasing toward center ${lowSide[i - 1]}->${lowSide[i]} (${a}->${b})`);
  }
  const highSide = [7.2, 7.35, 7.4, 7.6, 8.0, 8.5, 9.0, 9.5, 10.0];
  for (let i = 1; i < highSide.length; i++) {
    const a = grade(highSide[i - 1]);
    const b = grade(highSide[i]);
    assert(b <= a + 1e-9, `grade non-increasing away from center ${highSide[i - 1]}->${highSide[i]} (${a}->${b})`);
  }
}

console.log('\nSymmetry around the center (7.2 ± same distance grades identically)');
{
  for (const d of [0.1, 0.3, 0.5, 0.8, 1.2, 1.8, 2.5]) {
    const below = grade(7.2 - d);
    const above = grade(7.2 + d);
    assert(Math.abs(below - above) < 1e-6, `grade(7.2-${d})=${below} === grade(7.2+${d})=${above}`);
  }
}

console.log('\nOnly pH varies — TDS/turbidity/chlorine/ORP grades at IDEAL untouched');
{
  const r = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', IDEAL);
  assert(r.params.tds === 100 && r.params.turbidity === 100 && r.params.chlorine === 100 && r.params.orp === 100,
    'non-pH params unaffected by pH sweeps');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
