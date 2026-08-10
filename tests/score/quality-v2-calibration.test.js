/**
 * Quality Score V2 — calibration, ordering, monotonicity.
 * Run: node tests/score/quality-v2-calibration.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const files = [
  'src/js/score/util/clamp.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
  'src/js/score/util/benchmarkMetadata.js',
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

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const CASE_A = {
  ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06
};
const CASE_B = {
  ph: 7.9, tds: 155, turbidity: 0.6, orp: 507, do: 5.2, chlorine: 0.5, temp: 31.0
};

const NEAR_IDEAL = { ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, do: 7.6, chlorine: 0.3 };
const VERY_GOOD = { ph: 7.4, tds: 130, turbidity: 0.25, orp: 450, do: 7.0, chlorine: 0.35 };
const GOOD = { ph: 7.6, tds: 200, turbidity: 0.45, orp: 500, do: 6.6, chlorine: 0.42 };
const ACCEPTABLE = { ph: 7.9, tds: 280, turbidity: 0.85, orp: 560, do: 6.1, chlorine: 0.48 };
const BORDERLINE = { ph: 8.3, tds: 320, turbidity: 1.2, orp: 180, do: 5.5, chlorine: 0.55 };
const POOR = { ph: 9.0, tds: 700, turbidity: 4, orp: 100, do: 4.0, chlorine: 1.5 };
const CRITICAL = { ph: 5.0, tds: 1500, turbidity: 9, orp: 50, do: 2.0, chlorine: 3.0 };

function q(r) { return sandbox.computeScoreFromReadings(r); }
function legacy(r) { return sandbox.computeLegacyDwqiScore(r); }
function detail(r) { return sandbox.computeQualityScoreDetail(r); }
function bench(key, r) { return sandbox.WaterScoreBenchmarkRegistry.calculate(key, r).score; }

console.log('\nBEFORE (legacy DWQI) baselines');
{
  assert(legacy(CASE_A) === 100, `legacy Case A = 100 (got ${legacy(CASE_A)})`);
  assert(legacy(CASE_B) === 98, `legacy Case B = 98 (got ${legacy(CASE_B)})`);
  assert(bench('thailand', CASE_B) === 100, 'TH benchmark Case B still 100');
}

console.log('\nAFTER Quality V2 — Case A / Case B');
{
  const a = q(CASE_A);
  const b = q(CASE_B);
  console.log('  Case A quality =', a, detail(CASE_A).params, detail(CASE_A).compliance.status);
  console.log('  Case B quality =', b, detail(CASE_B).params, detail(CASE_B).compliance.status);
  assert(Number.isFinite(a) && a < 100, `Case A not auto-100 (got ${a})`);
  assert(Number.isFinite(b) && b < a, `Case B < Case A (${b} < ${a})`);
  assert(detail(CASE_A).compliance.status === 'PASS', 'Case A compliance PASS');
  assert(detail(CASE_B).compliance.status !== 'PASS', 'Case B compliance not perfect PASS (DO/marginal)');
  assert(bench('thailand', CASE_A) === 100, 'TH benchmark Case A unchanged 100');
  assert(bench('thailand', CASE_B) === 100, 'TH benchmark Case B unchanged 100');
}

console.log('\nSensitivity ordering');
{
  const scores = {
    nearIdeal: q(NEAR_IDEAL),
    veryGood: q(VERY_GOOD),
    good: q(GOOD),
    acceptable: q(ACCEPTABLE),
    borderline: q(BORDERLINE),
    poor: q(POOR),
    critical: q(CRITICAL)
  };
  console.log('  ladder', scores);
  assert(scores.nearIdeal === 100, `Near Ideal = 100 (got ${scores.nearIdeal})`);
  assert(scores.nearIdeal > scores.veryGood, 'Near Ideal > Very Good');
  assert(scores.veryGood > scores.good, 'Very Good > Good');
  assert(scores.good > scores.acceptable, 'Good > Acceptable');
  assert(scores.acceptable > scores.borderline, 'Acceptable > Borderline');
  assert(scores.borderline > scores.poor, 'Borderline > Poor');
  assert(scores.poor > scores.critical, 'Poor > Critical');
}

console.log('\nMonotonicity — turbidity lower is better');
{
  const base = { ...NEAR_IDEAL };
  const ladder = [0.05, 0.1, 0.2, 0.5, 1.0];
  let prev = Infinity;
  for (const turb of ladder) {
    const s = q({ ...base, turbidity: turb });
    assert(s <= prev, `turb ${turb} score ${s} <= previous ${prev}`);
    prev = s;
  }
}

console.log('\nMonotonicity — pH two-sided');
{
  const base = { ...NEAR_IDEAL, ph: 7.2 };
  const center = q(base);
  assert(q({ ...base, ph: 7.0 }) <= center, 'pH 7.0 <= ideal');
  assert(q({ ...base, ph: 7.4 }) <= center, 'pH 7.4 <= ideal');
  assert(q({ ...base, ph: 6.5 }) < q({ ...base, ph: 7.0 }), 'pH 6.5 < pH 7.0');
  assert(q({ ...base, ph: 8.5 }) < q({ ...base, ph: 7.8 }), 'pH 8.5 < pH 7.8');
}

console.log('\nMonotonicity — chlorine two-sided');
{
  const base = { ...NEAR_IDEAL, chlorine: 0.3 };
  const center = q(base);
  assert(q({ ...base, chlorine: 0.2 }) < center, 'Cl 0.2 < ideal 0.3');
  assert(q({ ...base, chlorine: 0.5 }) < center, 'Cl 0.5 < ideal 0.3');
  assert(q({ ...base, chlorine: 1.0 }) < q({ ...base, chlorine: 0.5 }), 'Cl 1.0 < Cl 0.5');
}

console.log('\nPASS ≠ 100');
{
  // All inside former Prod 100 plateaus but not near-ideal.
  const passNotIdeal = { ph: 8.4, tds: 290, turbidity: 0.95, orp: 220, do: 6.05, chlorine: 0.49 };
  const d = detail(passNotIdeal);
  assert(d.compliance.status === 'PASS' || d.compliance.status === 'WARNING',
    `compliance still pass-ish (got ${d.compliance.status})`);
  assert(d.score < 100, `Quality < 100 while inside old plateaus (got ${d.score})`);
}

console.log('\nMissing / incomplete');
{
  assert(q({ ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, do: 7.5 }) === null, 'missing chlorine → null');
  assert(legacy({ ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5 }) === 93,
    'legacy locked sample still 93');
}

console.log('\nNo double-count fields scored');
{
  const d = detail(NEAR_IDEAL);
  assert(d.notScored.includes('temp') && d.notScored.includes('ec'), 'temp/ec not scored');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Emit BEFORE/AFTER matrix for the implementation report
const matrix = {
  caseA: { legacy: legacy(CASE_A), quality: q(CASE_A), compliance: detail(CASE_A).compliance.status, th: bench('thailand', CASE_A), who: bench('who', CASE_A), eu: bench('eu', CASE_A), jp: bench('japan', CASE_A), epa: bench('usEpa', CASE_A) },
  caseB: { legacy: legacy(CASE_B), quality: q(CASE_B), compliance: detail(CASE_B).compliance.status, th: bench('thailand', CASE_B), who: bench('who', CASE_B), eu: bench('eu', CASE_B), jp: bench('japan', CASE_B), epa: bench('usEpa', CASE_B) },
  nearIdeal: { legacy: legacy(NEAR_IDEAL), quality: q(NEAR_IDEAL), compliance: detail(NEAR_IDEAL).compliance.status },
  veryGood: { legacy: legacy(VERY_GOOD), quality: q(VERY_GOOD) },
  good: { legacy: legacy(GOOD), quality: q(GOOD) },
  acceptable: { legacy: legacy(ACCEPTABLE), quality: q(ACCEPTABLE) },
  borderline: { legacy: legacy(BORDERLINE), quality: q(BORDERLINE) },
  poor: { legacy: legacy(POOR), quality: q(POOR) },
  critical: { legacy: legacy(CRITICAL), quality: q(CRITICAL) }
};
console.log('\nMATRIX_JSON ' + JSON.stringify(matrix));
process.exit(0);
