/**
 * PD-015 — Thailand ordinary-band calibration.
 * Run: node tests/score/pd015-thailand-calibration.test.js
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

const NEW_C_811 = Object.freeze({ ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25 });
const NEW_C_810 = Object.freeze({ ph: 7.81, tds: 138, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 });
const C_1328 = Object.freeze({ ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06 });
const FAUCET = Object.freeze({ ph: 7.2, tds: 80, turbidity: 0.2, orp: 189, do: 7, chlorine: 0, temp: 25 });
const SINK = Object.freeze({ ph: 7.3, tds: 95, turbidity: 0.25, orp: 195, do: 6.8, chlorine: 0, temp: 26 });

console.log('\nPD-015 limits locked');
{
  const L = sandbox.ThailandBenchmarkLimits;
  assert(L.tds.gradeExcellentMax === 80, 'TDS excellentMax 80');
  assert(L.tds.goodMax === 150 && L.tds.ordinaryMax === 300, 'TDS good/ordinary breakpoints');
  assert(L.tds.passEdgeGrade === 40, 'TDS passEdge 40');
  assert(L.tds.passMax === 1000, 'TDS passMax unchanged');
  assert(L.turbidity.gradeExcellentMax === 0.3, 'turb excellentMax 0.3');
  assert(L.turbidity.ordinaryMax === 1 && L.turbidity.ordinaryGrade === 70, 'turb ordinary 1 NTU → 70');
  assert(L.ph.preferredMin === 6.8 && L.ph.preferredMax === 7.8, 'pH preferred 6.8–7.8');
  assert(L.ph.edgeGrade === 70, 'pH edgeGrade 70');
  assert(L.chlorine.min === 0.2 && L.chlorine.max === 2.0, 'Cl compliance unchanged');
  assert(L.orp.min === 200 && L.orp.max === 600, 'ORP outer unchanged');
  // 2026-08-17, PO-approved: raised from 0.25 to 0.5 (part of the same
  // Thailand severity-completion work as the chlorine curve steepening below).
  assert(L.weakestLinkShare === 0.5, 'weakest-link share 0.5');
}

console.log('\nExisting Cases — natural ordering + no 97–99 ordinary cluster');
{
  const a = th(NEW_C_811).score;
  const b = th(NEW_C_810).score;
  const c = th(C_1328).score;
  const f = th(FAUCET).score;
  const s = th(SINK).score;
  console.log(`  scores faucet=${f} sink=${s} NewC811=${a} NewC810=${b} 13.28=${c}`);
  // Chlorine curve + weakest-link share 0.25->0.5 (2026-08-17, PO-approved):
  // 86->81, 88->85, 99->98, 55->37. Recomputed directly, not estimated.
  assert(a === 81, `New C 8/11 TH=81 (got ${a})`);
  assert(b === 85, `New C 8/10 TH=85 (got ${b})`);
  assert(c === 98, `13.28 TH=98 (got ${c})`);
  assert(f === 37, `faucet TH=37 (got ${f})`);
  assert(f < a && a < b && b < c, 'ordering faucet < 8/11 < 8/10 < 13.28');
  assert(!(a >= 97 && b >= 97 && c >= 97 && a <= 99 && b <= 99 && c <= 99 && a === 97 && b === 98),
    'ordinary trio no longer the pre-PD-015 97/98/99 cluster');
}

console.log('\nMonotonicity — worsening one parameter does not improve score');
{
  const base = { ph: 7.2, tds: 100, turbidity: 0.2, orp: 400, chlorine: 0.3, do: 7, temp: 25 };
  const baseScore = th(base).score;
  assert(th({ ...base, tds: 250 }).score <= baseScore, 'higher TDS not better');
  assert(th({ ...base, turbidity: 1.5 }).score <= baseScore, 'higher turb not better');
  assert(th({ ...base, chlorine: 1.2 }).score <= baseScore, 'higher Cl (above residual) not better');
  assert(th({ ...base, orp: 520 }).score <= baseScore, 'ORP above inner not better');
  assert(th({ ...base, ph: 8.2 }).score <= baseScore, 'pH toward edge not better');
  assert(th({ ...base, chlorine: 0 }).score < baseScore, 'Cl=0 materially worse');
}

console.log('\nDistribution fixtures — not collapsed into 97–99');
{
  const excellent = th({ ph: 7.2, tds: 60, turbidity: 0.1, orp: 400, chlorine: 0.3, do: 8, temp: 25 }).score;
  const good = th({ ph: 7.4, tds: 180, turbidity: 0.5, orp: 400, chlorine: 0.35, do: 7, temp: 26 }).score;
  const acceptable = th({ ph: 7.9, tds: 220, turbidity: 0.8, orp: 480, chlorine: 0.7, do: 6, temp: 27 }).score;
  const borderline = th({ ph: 8.3, tds: 450, turbidity: 2.5, orp: 550, chlorine: 1.4, do: 5, temp: 28 }).score;
  const poor = th({ ph: 9.0, tds: 900, turbidity: 4.5, orp: 150, chlorine: 0.05, do: 3, temp: 30 }).score;
  console.log(`  excellent=${excellent} good=${good} acceptable=${acceptable} borderline=${borderline} poor=${poor}`);
  assert(excellent >= 98, `excellent near top (got ${excellent})`);
  assert(good < excellent, 'good < excellent');
  assert(acceptable < good, 'acceptable < good');
  assert(borderline < acceptable, 'borderline < acceptable');
  assert(poor < borderline, 'poor < borderline');
  assert(poor < 70, `poor materially low (got ${poor})`);
  const ordinary = [good, acceptable];
  assert(!ordinary.every((s) => s >= 97 && s <= 99), 'good/acceptable not both trapped in 97–99');
}

console.log('\nOther engines unchanged on baseline New C readings');
{
  const r = NEW_C_811;
  // Japan pH/chlorine inner curves (2026-08-17, PO-approved): chlorine=0.7
  // and pH=7.85 are past their new ideal windows. Score Architecture V6
  // (2026-08-17, PO-approved): weakest-link aggregation pulls Japan to 86.
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('japan', r).score === 86, 'JP 86');
  // Score Architecture V6 (2026-08-17, PO-approved): WHO chlorine steepening
  // crosses New C 8/11's chlorine=0.7 from WARNING into FAIL, FAIL cap (75) applies.
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('who', r).score === 75, 'WHO 75 (FAIL cap)');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('eu', r).score === 65, 'EU unchanged 65');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', r).score === 85, 'EPA 85 (WARNING cap)');
  assert(sandbox.computeQualityScoreDetail(r).score === 76, 'Q-V3 unchanged 76');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
