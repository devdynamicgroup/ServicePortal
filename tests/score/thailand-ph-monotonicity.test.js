/**
 * Thailand gradePh() continuity/monotonicity regression lock.
 * Catches the outer-branch anchor bug found in acceptance review of
 * bf3342db: gradePh's below-min/above-max branches were anchored at 100
 * instead of L.ph.edgeGrade (70), producing a discontinuity where a worse
 * pH (crossing 6.5/8.5) scored HIGHER than a pH right at the boundary.
 * Fix: anchor both outer branches at edgeGrade. min/max/edgeGrade/slope(35)
 * unchanged — this test must fail if that discontinuity ever returns.
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
  'src/js/score/benchmark/thailand/score.js'
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
function grade(ph) {
  return sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', { ...IDEAL, ph }).params.ph;
}
function composite(ph) {
  return sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', { ...IDEAL, ph }).score;
}

console.log('\nLocked constants unchanged (protected — no recalibration authorized)');
{
  const L = sandbox.ThailandBenchmarkLimits;
  assert(L.ph.min === 6.5 && L.ph.max === 8.5, 'pH min/max unchanged 6.5/8.5');
  assert(L.ph.edgeGrade === 70, 'pH edgeGrade unchanged 70');
  assert(L.ph.preferredMin === 6.8 && L.ph.preferredMax === 7.8, 'pH preferred band unchanged 6.8-7.8');
}

console.log('\nThe exact bug this test exists to catch');
{
  assert(grade(6.50) === 70, 'grade(6.50) === 70');
  assert(grade(8.50) === 70, 'grade(8.50) === 70');
  assert(grade(6.49) <= grade(6.50), `grade(6.49)=${grade(6.49)} <= grade(6.50)=${grade(6.50)}`);
  assert(grade(8.51) <= grade(8.50), `grade(8.51)=${grade(8.51)} <= grade(8.50)=${grade(8.50)}`);
  assert(composite(8.50) >= composite(8.51), `composite(8.50)=${composite(8.50)} >= composite(8.51)=${composite(8.51)} (was 88 vs 99 — the original bug)`);
  assert(composite(6.50) >= composite(6.49), `composite(6.50)=${composite(6.50)} >= composite(6.49)=${composite(6.49)}`);
}

console.log('\nContinuity at both boundaries (no jump either direction)');
{
  const lowSide = [6.49, 6.50, 6.51].map(grade);
  const highSide = [8.49, 8.50, 8.51].map(grade);
  assert(Math.abs(lowSide[1] - lowSide[0]) < 1, `low-side continuity at 6.5 (${lowSide[0]}->${lowSide[1]})`);
  assert(Math.abs(lowSide[2] - lowSide[1]) < 1, `low-side continuity at 6.5+ (${lowSide[1]}->${lowSide[2]})`);
  assert(Math.abs(highSide[1] - highSide[0]) < 1, `high-side continuity at 8.5 (${highSide[0]}->${highSide[1]})`);
  assert(Math.abs(highSide[2] - highSide[1]) < 1, `high-side continuity at 8.5+ (${highSide[1]}->${highSide[2]})`);
}

console.log('\nFull-domain monotonicity sweep (grade and composite)');
{
  const points = [6.0, 6.1, 6.2, 6.3, 6.4, 6.49, 6.50, 6.51, 6.6, 6.8, 7.0, 7.4, 7.8, 8.0, 8.49, 8.50, 8.51, 8.6, 8.7, 8.8, 8.9, 9.0];
  const grades = points.map(grade);
  const composites = points.map(composite);

  // Low side (6.0 -> 6.8): moving toward preferred must never decrease grade/composite.
  const lowIdx = points.indexOf(6.8);
  for (let i = 1; i <= lowIdx; i++) {
    assert(grades[i] >= grades[i - 1] - 1e-9, `grade non-decreasing ${points[i - 1]}->${points[i]} (${grades[i - 1]}->${grades[i]})`);
    assert(composites[i] >= composites[i - 1], `composite non-decreasing ${points[i - 1]}->${points[i]} (${composites[i - 1]}->${composites[i]})`);
  }
  // High side (7.8 -> 9.0): moving away from preferred must never increase grade/composite.
  const highIdx = points.indexOf(7.8);
  for (let i = highIdx + 1; i < points.length; i++) {
    assert(grades[i] <= grades[i - 1] + 1e-9, `grade non-increasing ${points[i - 1]}->${points[i]} (${grades[i - 1]}->${grades[i]})`);
    assert(composites[i] <= composites[i - 1], `composite non-increasing ${points[i - 1]}->${points[i]} (${composites[i - 1]}->${composites[i]})`);
  }
  // Bounded
  for (const g of grades) assert(g >= 0 && g <= 100, `grade bounded [0,100] (got ${g})`);
}

console.log('\nSymmetry sanity (same distance from boundary, same-shape outer decline)');
{
  assert(Math.abs(grade(6.5) - grade(8.5)) < 1e-9, 'grade(6.5) === grade(8.5) (both = edgeGrade)');
  assert(Math.abs((grade(6.5) - grade(6.4)) - (grade(8.5) - grade(8.6))) < 1e-6,
    'outer decline slope symmetric on both sides (same authority=35)');
}

console.log('\nOnly pH changed — TDS/turbidity/chlorine/ORP grades at IDEAL untouched');
{
  const r = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', IDEAL);
  assert(r.params.tds === 100 && r.params.turbidity === 100 && r.params.chlorine === 100 && r.params.orp === 100,
    'non-pH params unaffected by the pH fix');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
