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
  assert(L.weakestLinkShare === 0.25, 'weakestLinkShare 0.25');
  assert(L.ph.preferredMin === 6.8 && L.ph.preferredMax === 7.8, 'pH preferred kept');
  assert(L.tds.gradeExcellentMax === 80 && L.tds.passMax === 1000, 'TDS excellent/passMax kept');
  assert(L.orp.excellentMin === 350 && L.orp.excellentMax === 450, 'ORP inner kept');
  assert(L.chlorine.min === 0.2 && L.chlorine.max === 2.0, 'Cl compliance kept');
}

console.log('\nReal-case ordering');
{
  const t1 = th(TEST1).score;
  const a = th(NEW_C_811).score;
  const b = th(NEW_C_810).score;
  const c = th(C_1328).score;
  const f = th(FAUCET).score;
  const s = th(SINK).score;
  console.log(`  test1=${t1} 811=${a} 810=${b} 13.28=${c} faucet=${f} sink=${s}`);
  assert(c === 99, 'near-ideal still 99');
  assert(f < 70 && s < 70, 'degraded Cl=0 materially low');
  assert(f < a && a <= b && b < c, 'faucet < 8/11 ≤ 8/10 < 13.28');
  assert(t1 < 90, 'test1 ordinary not trapped in 90+');
  assert(a < 90, 'New C 8/11 ordinary not trapped in 90+');
}

console.log('\nOne miss cannot hide behind four perfect grades');
{
  const ideal = th(IDEAL).score;
  const tdsMiss = th({ ...IDEAL, tds: 250 }).score;
  assert(ideal >= 98, `ideal high (got ${ideal})`);
  assert(tdsMiss <= 90, `TDS 250 on otherwise ideal is not still Excellent (got ${tdsMiss})`);
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
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('japan', r).score === 98, 'JP 98');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('who', r).score === 93, 'WHO 93');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('eu', r).score === 65, 'EU 65');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', r).score === 98, 'EPA 98');
  assert(sandbox.computeQualityScoreDetail(r).score === 76, 'Q-V3 76');
}

console.log('\nHero ceiling');
{
  assert(sandbox.applyCountryBenchmarkHeroCeiling(100) === 99, 'ceiling 100→99');
  assert(th(C_1328).score === 99, '13.28 uses ceiling');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
