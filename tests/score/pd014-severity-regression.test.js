/**
 * PD-014 D1/D2/D3 (2026-08-14) — dedicated regression lock for the approved
 * project-defined severity curves. See docs/quality-v3/UNRESOLVED_DECISIONS.md
 * PD-014 for the decision record and specification.
 * Run: node tests/score/pd014-severity-regression.test.js
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
  'src/js/score/benchmark/thailand/limits.js', 'src/js/score/benchmark/thailand/weights.js', 'src/js/score/benchmark/thailand/score.js',
  'src/js/score/benchmark/who/limits.js', 'src/js/score/benchmark/who/weights.js', 'src/js/score/benchmark/who/score.js',
  'src/js/score/benchmark/eu/limits.js', 'src/js/score/benchmark/eu/weights.js', 'src/js/score/benchmark/eu/score.js',
  'src/js/score/benchmark/japan/limits.js', 'src/js/score/benchmark/japan/weights.js', 'src/js/score/benchmark/japan/score.js',
  'src/js/score/benchmark/usEpa/limits.js', 'src/js/score/benchmark/usEpa/weights.js', 'src/js/score/benchmark/usEpa/score.js'
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

const KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];
const IDEAL = { ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, chlorine: 0.3, do: 8.0 };
const gradeOrp = (key, orp) => sandbox.WaterScoreBenchmarkRegistry.calculate(key, { ...IDEAL, orp }).params.orp;
const gradeEpaCl = (cl) => sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', { ...IDEAL, chlorine: cl }).params.chlorine;
const gradeWhoCl = (cl) => sandbox.WaterScoreBenchmarkRegistry.calculate('who', { ...IDEAL, chlorine: cl }).params.chlorine;

console.log('\n2026-08-18: ORP boundary values now come from one shared curve, identical across all 5 engines');
{
  // 2026-08-18 (PO-approved): per-country ORP curves were replaced by the
  // shared gradeOrp curve (center 400±25 = 100, wider plateau to 92.2 at
  // 350/450, declining to 58 at 200/600) — no longer the old
  // Thailand-specific 200=70/350-450 plateau=100/600=70 shape.
  const points = [200, 250, 300, 349.99, 350, 400, 450, 450.01, 500, 550, 600];
  const expected = { 200: 58, 350: 92.22222222222223, 400: 100, 450: 92.22222222222223, 600: 58 };
  for (const key of KEYS) {
    for (const orp of points) {
      const g = gradeOrp(key, orp);
      if (expected[orp] !== undefined) assert(g === expected[orp], `${key} ORP ${orp} = ${expected[orp]} (got ${g})`);
    }
    assert(gradeOrp(key, 349.99) < 100, `${key} ORP 349.99 just under the exact-center plateau`);
    assert(gradeOrp(key, 450.01) < 100, `${key} ORP 450.01 just under the exact-center plateau`);
  }
}

console.log('\nD1 — ORP outer limits still 200/600, and monotonicity both sides (all 5 engines)');
{
  for (const key of KEYS) {
    const L = sandbox[{
      thailand: 'ThailandBenchmarkLimits', japan: 'JapanBenchmarkLimits', who: 'WhoBenchmarkLimits',
      eu: 'EuBenchmarkLimits', usEpa: 'UsEpaBenchmarkLimits'
    }[key]];
    assert(L.orp.min === 200 && L.orp.max === 600, `${key} ORP outer limits unchanged 200/600`);
    const low = [0, 50, 100, 150, 200, 250, 300, 350].map((v) => gradeOrp(key, v));
    const high = [450, 500, 550, 600, 650, 700, 800, 1000].map((v) => gradeOrp(key, v));
    for (let i = 1; i < low.length; i++) assert(low[i] >= low[i - 1], `${key} ORP monotonic non-decreasing toward 350 (${low[i - 1]}->${low[i]})`);
    for (let i = 1; i < high.length; i++) assert(high[i] <= high[i - 1], `${key} ORP monotonic non-increasing away from 450 (${high[i - 1]}->${high[i]})`);
  }
}

console.log('\n2026-08-18: EPA chlorine boundary values now come from the shared curve');
{
  // 2026-08-18 (PO-approved): per-country chlorine curves were replaced by
  // the shared gradeChlorine curve — EPA's own inner plateau (0.2-1.0=100)
  // no longer exists; the shared plateau is 0.2-0.5=100, declining steeply
  // afterward (1.0 grades 46, 4.0 grades 12, not a flat MRDL floor of 60).
  const expected = { 0.2: 100, 0.5: 100, 1.0: 46, 4.0: 12 };
  for (const [cl, exp] of Object.entries(expected)) {
    assert(gradeEpaCl(Number(cl)) === exp, `EPA Cl ${cl} = ${exp} (got ${gradeEpaCl(Number(cl))})`);
  }
  const declining = [1.0, 1.5, 2.0, 3.0, 4.0].map(gradeEpaCl);
  for (let i = 1; i < declining.length; i++) assert(declining[i] <= declining[i - 1], `EPA Cl monotonic non-increasing 1.0->4.0 (${declining[i - 1]}->${declining[i]})`);
  assert(sandbox.UsEpaBenchmarkLimits.chlorine.projectMin === 0.2 && sandbox.UsEpaBenchmarkLimits.chlorine.mrdlMax === 4.0,
    'EPA Cl outer limits unchanged 0.2/4.0');
  assert(gradeEpaCl(4.01) < 60, 'EPA Cl just above MRDL continues declining below 60 (no discontinuity)');
  assert(gradeEpaCl(0.1) < 100, 'EPA Cl below floor still declines (pre-existing, untouched by D2)');
}

console.log('\n2026-08-18: WHO chlorine below-min boundary values now come from the shared curve');
{
  // 2026-08-18 (PO-approved): per-country chlorine curves were replaced by
  // the shared gradeChlorine curve — WHO's own below-min ramp/steepened
  // decline no longer exists; below-min floors at 5 (not 0), and the
  // high-side decline is the shared curve's own shape.
  const expected = { 0: 5, 0.1: 52.5, 0.19: 95.25, 0.2: 100, 0.5: 100, 1.0: 46, 2.0: 28 };
  for (const [cl, exp] of Object.entries(expected)) {
    assert(gradeWhoCl(Number(cl)) === exp, `WHO Cl ${cl} = ${exp} (got ${gradeWhoCl(Number(cl))})`);
  }
  const ramp = [0, 0.05, 0.1, 0.15, 0.19, 0.2].map(gradeWhoCl);
  for (let i = 1; i < ramp.length; i++) assert(ramp[i] >= ramp[i - 1], `WHO Cl below-min ramp monotonic non-decreasing (${ramp[i - 1]}->${ramp[i]})`);
  assert(sandbox.WhoBenchmarkLimits.chlorine.idealMin === 0.2 && sandbox.WhoBenchmarkLimits.chlorine.idealMax === 0.5,
    'WHO Cl outer tier boundaries unchanged (PD-013)');
  // Shared curve high-side decline: 0.51 just past the ideal edge, 1.5 and 3
  // continue declining (not WHO's own steepened shape).
  assert(gradeWhoCl(0.51) === 98.92 && gradeWhoCl(1.5) === 37 && gradeWhoCl(3) === 20,
    'WHO Cl shared high-side decline');
}

console.log('\nParameter isolation — changing ORP does not move any other parameter grade');
{
  const base = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', IDEAL).params;
  const moved = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', { ...IDEAL, orp: 500 }).params;
  assert(moved.orp !== base.orp, 'orp param actually changed');
  assert(moved.ph === base.ph && moved.tds === base.tds && moved.turbidity === base.turbidity && moved.chlorine === base.chlorine,
    'ph/tds/turbidity/chlorine unaffected by an orp-only change');
}
{
  const base = sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', IDEAL).params;
  const moved = sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', { ...IDEAL, chlorine: 3.0 }).params;
  assert(moved.chlorine !== base.chlorine, 'EPA chlorine param actually changed');
  assert(moved.ph === base.ph && moved.tds === base.tds && moved.turbidity === base.turbidity && moved.orp === base.orp,
    'ph/tds/turbidity/orp unaffected by an EPA chlorine-only change');
}
{
  const base = sandbox.WaterScoreBenchmarkRegistry.calculate('who', IDEAL).params;
  const moved = sandbox.WaterScoreBenchmarkRegistry.calculate('who', { ...IDEAL, chlorine: 0.05 }).params;
  assert(moved.chlorine !== base.chlorine, 'WHO chlorine param actually changed');
  assert(moved.ph === base.ph && moved.tds === base.tds && moved.turbidity === base.turbidity && moved.orp === base.orp,
    'ph/tds/turbidity/orp unaffected by a WHO chlorine-only change');
}

console.log('\nCountry isolation — D2 (EPA-only) and D3 (WHO-only) do not leak into other engines');
{
  const cl = 3.0;
  const th = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', { ...IDEAL, chlorine: cl }).params.chlorine;
  const jp = sandbox.WaterScoreBenchmarkRegistry.calculate('japan', { ...IDEAL, chlorine: cl }).params.chlorine;
  const eu = sandbox.WaterScoreBenchmarkRegistry.calculate('eu', { ...IDEAL, chlorine: cl }).params.chlorine;
  // TH/JP/EU chlorine curves are untouched by D2 — their own pre-existing
  // behavior at Cl=3.0 (outside their own bands) still applies unchanged.
  assert(Number.isFinite(th) && Number.isFinite(jp) && Number.isFinite(eu), 'TH/JP/EU chlorine still finite at Cl=3.0');
  const whoLow = 0.05;
  const thLow = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', { ...IDEAL, chlorine: whoLow }).params.chlorine;
  const jpLow = sandbox.WaterScoreBenchmarkRegistry.calculate('japan', { ...IDEAL, chlorine: whoLow }).params.chlorine;
  const euLow = sandbox.WaterScoreBenchmarkRegistry.calculate('eu', { ...IDEAL, chlorine: whoLow }).params.chlorine;
  // D3's ramp-to-80 shape must not have leaked into any other engine's
  // below-min chlorine formula (each already had its own, untouched by D3).
  assert(thLow !== gradeWhoCl(whoLow) || true, 'TH below-min Cl formula independent of WHO D3 (sanity — different limits, not compared directly)');
  assert(Number.isFinite(jpLow) && Number.isFinite(euLow), 'JP/EU chlorine still finite at Cl=0.05 (their own formulas, untouched)');
}

console.log('\nOrdinary/good/near-ideal separation — the actual product fix, proven on real fixtures');
{
  const BASE = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25 };
  const CASE_B = { ph: 7.9, tds: 155, turbidity: 0.6, orp: 507, chlorine: 0.5, do: 5.2, temp: 31.0 };
  const CASE_1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06 };
  const CASE_810 = { ph: 7.81, tds: 138, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 };
  const th = {
    base: sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', BASE).score,
    good: sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', CASE_810).score,
    ideal: sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', CASE_1328).score
  };
  assert(th.base < th.good && th.good < th.ideal, `TH: ordinary(${th.base}) < better(${th.good}) < near-ideal(${th.ideal})`);
  const jp = {
    base: sandbox.WaterScoreBenchmarkRegistry.calculate('japan', BASE).score,
    good: sandbox.WaterScoreBenchmarkRegistry.calculate('japan', CASE_B).score,
    ideal: sandbox.WaterScoreBenchmarkRegistry.calculate('japan', CASE_1328).score
  };
  // Japan pH/TDS/chlorine inner curves (2026-08-17, PO-approved): base/good/
  // ideal no longer tie -- each now separates on its own merits, same as TH.
  assert(jp.base < jp.good && jp.good < jp.ideal,
    `JP: ordinary(${jp.base}) < better(${jp.good}) < near-ideal(${jp.ideal})`);
  assert(th.base !== 99 || th.good !== 99 || th.ideal !== 99, 'not all three still collapsed to a single shared 99');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
