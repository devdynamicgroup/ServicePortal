/**
 * Thailand ordinary-band severity + weakest-link aggregation.
 * Run: node tests/score/thailand-ordinary-band-calibration.test.js
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

const sandbox = { console, Math, Number, JSON, Object, Array, String, Boolean, parseFloat, isFinite, Infinity, NaN, undefined, Date };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
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

function th(r) {
  return sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', r);
}

const TEST1 = Object.freeze({ ph: 7.4, tds: 250, turbidity: 0.2, orp: 300, do: 5, chlorine: 0.2, temp: 28 });
const NEW_C_811 = Object.freeze({ ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25 });
const NEW_C_810 = Object.freeze({ ph: 7.81, tds: 138, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 });
const C_1328 = Object.freeze({ ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06 });
const FAUCET = Object.freeze({ ph: 7.2, tds: 80, turbidity: 0.2, orp: 189, do: 7, chlorine: 0, temp: 25 });
const SINK = Object.freeze({ ph: 7.3, tds: 95, turbidity: 0.25, orp: 195, do: 6.8, chlorine: 0, temp: 26 });
const IDEAL = Object.freeze({ ph: 7.2, tds: 60, turbidity: 0.1, orp: 400, chlorine: 0.3, do: 8, temp: 25 });

console.log('\nWeakest-link + piecewise constants');
{
  const L = sandbox.ThailandBenchmarkLimits;
  // 2026-08-17, PO-approved: raised from 0.25 to 0.5.
  assert(L.weakestLinkShare === 0.5, 'weakestLinkShare 0.5');
  assert(L.ph.preferredMin === 6.8 && L.ph.preferredMax === 7.8, 'pH preferred kept');
  // 2026-08-19 (PO-approved, evidence-based): passMax corrected 1000→500
  // to match the real DOH 2020 legal limit.
  assert(L.tds.gradeExcellentMax === 80 && L.tds.passMax === 500, 'TDS excellent kept / passMax corrected to DOH 2020 (500)');
  assert(L.orp.excellentMin === 350 && L.orp.excellentMax === 450, 'ORP inner kept');
  assert(L.chlorine.min === 0.2 && L.chlorine.max === 2.0, 'Cl compliance kept');
}

console.log('\nReal-case ordering');
{
  const t1 = th(TEST1).score;
  const a = th(NEW_C_811).score;
  const b = th(NEW_C_810).score;
  const c = th(C_1328).score;
  const fRes = th(FAUCET);
  const sRes = th(SINK);
  const f = fRes.score;
  const s = sRes.score;
  console.log(`  test1=${t1} 811=${a} 810=${b} 13.28=${c} faucet=${f} sink=${s}`);
  assert(c === 95, 'near-ideal TH weighted 95 (shared base)');
  assert(fRes.severityProtection.score === 60, `faucet Cl=0 severity stays 60 (got ${fRes.severityProtection.score})`);
  assert(sRes.severityProtection.score === 59, `sink Cl=0 severity is the guaranteed deduction 59 (got ${sRes.severityProtection.score})`);
  assert(f < a && a <= b && b < c, 'faucet < 8/11 ≤ 8/10 < 13.28');
  assert(t1 < 90, 'test1 ordinary not trapped in 90+');
  assert(a < 90, 'New C 8/11 ordinary not trapped in 90+');
}

console.log('\nOne miss cannot hide behind four perfect grades');
{
  const ideal = th(IDEAL).score;
  const tdsMiss = th({ ...IDEAL, tds: 250 }).score;
  assert(ideal >= 98, `ideal high (got ${ideal})`);
  // 2026-08-18 (PO-approved): shared grading base (Quality V3's TDS curve)
  // grades TDS 250 less harshly than Thailand's own former curve did — 96,
  // still clearly below ideal, but not as low as the old ≤90 threshold.
  assert(tdsMiss <= 96, `TDS 250 on otherwise ideal is not still Excellent (got ${tdsMiss})`);
  assert(tdsMiss < ideal, 'TDS miss lowers score');
}

console.log('\nMonotonicity');
{
  const base = { ph: 7.2, tds: 100, turbidity: 0.2, orp: 400, chlorine: 0.3, do: 7, temp: 25 };
  const b = th(base).score;
  assert(th({ ...base, tds: 250 }).score <= b, 'higher TDS not better');
  assert(th({ ...base, turbidity: 1.5 }).score <= b, 'higher turb not better');
  assert(th({ ...base, chlorine: 1.2 }).score <= b, 'higher Cl not better');
  assert(th({ ...base, orp: 520 }).score <= b, 'ORP above inner not better');
  assert(th({ ...base, ph: 8.2 }).score <= b, 'pH toward edge not better');
  assert(th({ ...base, chlorine: 0 }).score < b, 'Cl=0 worse');
  assert(th({ ...base, tds: 60 }).score >= b, 'lower TDS in excellent not worse');
}

console.log('\nOther engines + Q-V3 unchanged on New C 8/11');
{
  const r = NEW_C_811;
  // 2026-08-18 (PO-approved): shared grading base — Japan's raw base equals
  // Quality V3's (76), but Japan's own tighter pH band (7.3-7.7) classifies
  // ph=7.85 WARNING; the guaranteed minimum deduction
  // (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3) takes it to 73.
  // 2026-08-19 (bug fix): do key removed from JapanBenchmarkWeights, raising 74 -> 76.
  const jp = sandbox.WaterScoreBenchmarkRegistry.calculate('japan', r);
  const who = sandbox.WaterScoreBenchmarkRegistry.calculate('who', r);
  const eu = sandbox.WaterScoreBenchmarkRegistry.calculate('eu', r);
  const epa = sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', r);
  assert(jp.score === 79 && jp.severityProtection.score === 76, 'JP customer 79, severity 76');
  assert(who.score === 76 && who.severityProtection.score === 70, 'WHO customer 76, severity 70');
  assert(eu.score === 77 && eu.countryGate.applied === true && eu.countryGate.cap === 65, 'EU customer 77, chlorine gate cap 65');
  assert(epa.score === 77 && epa.severityProtection.score === 71, 'EPA customer 77, severity 71');
  // WHO classifies chlorine/do FAIL; raw 76 is already below the 75 FAIL
  // ceiling, so the guaranteed minimum deduction (FAIL=6) is what actually
  // moves it: 76 - 6 = 70.
  assert(sandbox.computeQualityScoreDetail(r).score === 76, 'Q-V3 76');
}

console.log('\nHero ceiling');
{
  assert(sandbox.applyCountryBenchmarkHeroCeiling(100) === 99, 'ceiling 100→99');
  // 2026-08-18 (PO-approved): shared grading base — 92, well below the
  // ceiling, so the ceiling is a no-op for this fixture.
  assert(th(C_1328).score === 95, '13.28 no longer needs the ceiling (95 < 99)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
