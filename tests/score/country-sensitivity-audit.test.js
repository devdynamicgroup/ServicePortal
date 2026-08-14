/**
 * Country Compliance Index — full sensitivity / plateau forensic lock.
 *
 * Purpose:
 * - Prove TH TDS/turbidity/chlorine in-band severity remains active (7a3f35a).
 * - Classify remaining flat-100 bands under PD-004 / PD-006 / PD-008 (no invent).
 * - Lock RAW→engine numeric preservation, Hero isolation, JP PD-012 B, aggregation.
 *
 * Run: node tests/score/country-sensitivity-audit.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const files = [
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/validation/measurementValidator.js',
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
  'src/js/flows/score.js'
];

function stubEl() {
  return {
    hidden: false,
    style: { setProperty() {}, width: '', background: '', color: '', left: '' },
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    querySelector: () => stubEl(),
    textContent: '',
    innerHTML: '',
    replaceChildren() {},
    dataset: {},
    onchange: null
  };
}

const sandbox = {
  console,
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  document: { getElementById: () => stubEl(), querySelector: () => stubEl() },
  S: {
    lang: 'en', scoreStandardKey: 'thailand', activeJob: null, scoreBaseReadings: null,
    scoreVal: null, currentScoreResult: null, comparisonScoreResult: null, displayedScore: null,
    scoreParamOpen: null, publicScoreView: false, taps: ['Kitchen'], scoreTapFilter: 'all'
  },
  t: (k) => k
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

const decisionDoc = fs.readFileSync(path.join(root, 'docs/quality-v3/UNRESOLVED_DECISIONS.md'), 'utf8');
const registry = JSON.parse(
  fs.readFileSync(path.join(root, 'docs/quality-v3/evidence-registry/constants.json'), 'utf8')
);

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const IDEAL = Object.freeze({ ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, do: 8, chlorine: 0.3, temp: 25 });
const BASE = Object.freeze({ ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25 });
const DIFF = Object.freeze({ ph: 7.2, tds: 800, turbidity: 3.5, orp: 350, do: 5.5, chlorine: 1.5, temp: 28 });
const LOCKED = Object.freeze({ ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5, temp: 28 });
const KEYS = ['thailand', 'japan', 'eu', 'who', 'usEpa'];

function bench(key, r) {
  return sandbox.WaterScoreBenchmarkRegistry.calculate(key, r);
}
function grade(key, param, value) {
  return bench(key, { ...IDEAL, [param]: value }).params?.[param];
}
function displayed(r, key) {
  return sandbox.resolveDisplayedScore({ readings: r, standardKey: key, publicView: false });
}
function byId(id) {
  return registry.constants.find((c) => c.id === id);
}

console.log('\nGovernance locks that forbid inventing pH/ORP/EPA-Cl severity curves');
{
  assert(/PD-004[\s\S]*?\*\*Decision:\*\* A/.test(decisionDoc), 'PD-004 Decision A present');
  assert(decisionDoc.includes('KEEP AS SHARED OPERATIONAL / PROJECT BAND'), 'PD-004 keeps ORP 200–600');
  assert(/PD-006[\s\S]*?\*\*Decision:\*\* A/.test(decisionDoc), 'PD-006 Decision A present');
  assert(decisionDoc.includes('COMPLIANCE INDEX'), 'PD-006 Compliance Index');
  assert(byId('SHARED-ORP-BAND')?.lock_state === 'LOCKED_LABEL' || byId('SHARED-ORP-BAND')?.lock_state === 'LOCKED_KEEP'
    || byId('SHARED-ORP-BAND')?.model_change_authorized === false,
    'SHARED-ORP-BAND not model-change authorized');
  assert(byId('EPA-CHLORINE-BAND')?.model_change_authorized === false, 'EPA-CHLORINE-BAND not authorized');
  assert(byId('TH-PH-BAND')?.lock_state === 'RESEARCH_BLOCKED', 'TH-PH-BAND RESEARCH_BLOCKED');
  assert(sandbox.ThailandBenchmarkLimits.orp.min === 200 && sandbox.ThailandBenchmarkLimits.orp.max === 600,
    'TH ORP ceiling unchanged 200–600');
  assert(sandbox.JapanBenchmarkLimits.orp.min === 200 && sandbox.UsEpaBenchmarkLimits.orp.max === 600,
    'shared ORP band present on JP/EPA');
}

console.log('\nMatrix — which params are scored');
{
  const th = bench('thailand', IDEAL);
  const jp = bench('japan', IDEAL);
  const eu = bench('eu', IDEAL);
  assert(th.params.do === undefined && th.classifications.do === 'NOT_EVALUATED', 'TH DO not scored');
  assert(jp.params.do === undefined && jp.classifications.do === 'NOT_EVALUATED', 'JP DO not scored (PD-012 B)');
  assert(Number.isFinite(eu.params.do) && Number.isFinite(bench('who', IDEAL).params.do)
    && Number.isFinite(bench('usEpa', IDEAL).params.do),
    'EU/WHO/EPA DO are scored');
  assert(sandbox.JapanBenchmarkWeights.do === 0.12, 'JP do weight metadata 0.12 retained');
  const W = sandbox.JapanBenchmarkWeights;
  const den = W.ph + W.tds + W.chlorine + W.turbidity + W.orp;
  assert(Math.abs(den - 0.88) < 1e-9, `JP scored den 0.88 (got ${den})`);
}

console.log('\nFIXED — Thailand TDS / turbidity / chlorine in-band severity (PD-015)');
{
  assert(grade('thailand', 'tds', 80) === 100, 'TH TDS ≤80 = 100 (PD-015)');
  assert(grade('thailand', 'tds', 300) < 100, 'TH TDS 300 leaves excellent under PD-015');
  assert(grade('thailand', 'tds', 800) < 100 && grade('thailand', 'tds', 800) > grade('thailand', 'tds', 1000),
    'TH TDS 800 < 100 and better than 1000');
  assert(grade('thailand', 'turbidity', 0.3) === 100, 'TH turb ≤0.3 = 100 (PD-015)');
  assert(grade('thailand', 'turbidity', 1) < 100, 'TH turb 1 leaves excellent under PD-015');
  assert(grade('thailand', 'turbidity', 3.5) < 100, 'TH turb 3.5 < 100');
  assert(grade('thailand', 'chlorine', 0.3) === 100, 'TH Cl 0.3 = 100');
  assert(grade('thailand', 'chlorine', 1.5) < 100 && grade('thailand', 'chlorine', 1.5) > grade('thailand', 'chlorine', 2.0),
    'TH Cl 1.5 severity inside 0.2–2.0');
  assert(sandbox.ThailandBenchmarkLimits.tds.passMax === 1000, 'TH TDS passMax ceiling unchanged');
  assert(sandbox.ThailandBenchmarkLimits.turbidity.passMax === 5, 'TH turb passMax ceiling unchanged');
  assert(sandbox.ThailandBenchmarkLimits.chlorine.min === 0.2
    && sandbox.ThailandBenchmarkLimits.chlorine.max === 2.0,
    'TH Cl compliance band ceiling unchanged');
  assert(bench('thailand', DIFF).score === 69, `DIFF TH 69 after ordinary-band severity (got ${bench('thailand', DIFF).score})`);
}

console.log('\nNOT FIXED (governance) — pH flat-in-band for non-TH engines; TH uses PD-015 preferred');
{
  for (const key of KEYS) {
    const L = sandbox.WaterScoreBenchmarkRegistry.get(key).limits.ph;
    const mid = (L.min + L.max) / 2;
    const nearLow = L.min + 0.1;
    const nearHigh = L.max - 0.1;
    if (key === 'thailand') {
      assert(grade(key, 'ph', 7.2) === 100, 'thailand pH preferred center = 100');
      assert(grade(key, 'ph', L.min) === 70, 'thailand pH at pass edge = 70');
      assert(grade(key, 'ph', L.max) === 70, 'thailand pH at pass edge high = 70');
    } else {
      assert(grade(key, 'ph', mid) === 100, `${key} pH mid-band = 100 (compliance flat)`);
      assert(grade(key, 'ph', nearLow) === 100, `${key} pH near-low = 100`);
      assert(grade(key, 'ph', nearHigh) === 100, `${key} pH near-high = 100`);
    }
    assert(grade(key, 'ph', L.min - 0.5) < 100, `${key} pH below band declines`);
    assert(grade(key, 'ph', L.max + 0.5) < 100, `${key} pH above band declines`);
  }
}

console.log('\nFIXED (PD-014 D1, 2026-08-14) — ORP inner severity within locked 200-600');
{
  for (const key of KEYS) {
    assert(grade(key, 'orp', 200) === 70, `${key} ORP 200 = 70 (outer edge of inner ramp)`);
    assert(grade(key, 'orp', 350) === 100, `${key} ORP 350 = 100 (inner plateau starts)`);
    assert(grade(key, 'orp', 400) === 100, `${key} ORP 400 = 100 (inner plateau center)`);
    assert(grade(key, 'orp', 450) === 100, `${key} ORP 450 = 100 (inner plateau ends)`);
    assert(grade(key, 'orp', 600) === 70, `${key} ORP 600 = 70 (outer edge of inner ramp)`);
    assert(grade(key, 'orp', 100) < 70, `${key} ORP 100 < 70 (below outer limit, unchanged formula)`);
    assert(grade(key, 'orp', 700) < 70, `${key} ORP 700 < 70 (above outer limit, unchanged formula)`);
  }
}

console.log('\nFIXED (PD-014 D2, 2026-08-14) — EPA Cl inner severity within locked 0.2-4.0');
{
  for (const cl of [0.2, 0.5, 1.0]) {
    assert(grade('usEpa', 'chlorine', cl) === 100, `EPA Cl ${cl} = 100 (inner plateau)`);
  }
  for (const cl of [1.5, 2.0, 3.0]) {
    assert(grade('usEpa', 'chlorine', cl) < 100 && grade('usEpa', 'chlorine', cl) > 60,
      `EPA Cl ${cl} declines between plateau and MRDL floor`);
  }
  assert(grade('usEpa', 'chlorine', 4.0) === 60, 'EPA Cl 4.0 = 60 (MRDL, project-defined floor)');
  assert(grade('usEpa', 'chlorine', 0.1) < 100, 'EPA Cl 0.1 < 100');
  assert(grade('usEpa', 'chlorine', 4.01) < 60, 'EPA Cl > MRDL declines below the 4.0 floor');
}

console.log('\nAcceptable narrow residual / ideal plateaus (not the TH overfit defect)');
{
  assert(grade('japan', 'chlorine', 0.1) === 100 && grade('japan', 'chlorine', 1.0) === 100,
    'JP Cl 0.1–1.0 residual band');
  assert(grade('japan', 'chlorine', 1.5) < 100, 'JP Cl 1.5 declines');
  assert(grade('eu', 'chlorine', 0.1) === 100 && grade('eu', 'chlorine', 0.5) === 100,
    'EU Cl 0.1–0.5 project residual');
  assert(bench('eu', { ...IDEAL, chlorine: 0.7 }).score <= 65, 'EU Cl fail gated ≤65');
  assert(grade('who', 'chlorine', 0.3) === 100 && grade('who', 'chlorine', 0.7) === 80,
    'WHO Cl ideal 0.2–0.5 then tiered');
  assert(grade('japan', 'turbidity', 2) === 100 && grade('japan', 'turbidity', 3.5) < 100,
    'JP turb ≤2 then declines');
}

console.log('\nMonotonicity — higher-is-worse params (TH TDS/turb; JP TDS)');
{
  const thTds = [300, 500, 800, 1000, 1500].map((v) => grade('thailand', 'tds', v));
  for (let i = 1; i < thTds.length; i += 1) {
    assert(thTds[i] <= thTds[i - 1] + 1e-9, `TH TDS mono ${thTds[i - 1]} → ${thTds[i]}`);
  }
  const thTurb = [1, 2, 3.5, 5, 10].map((v) => grade('thailand', 'turbidity', v));
  for (let i = 1; i < thTurb.length; i += 1) {
    assert(thTurb[i] <= thTurb[i - 1] + 1e-9, `TH turb mono ${thTurb[i - 1]} → ${thTurb[i]}`);
  }
  const jpTds = [300, 400, 500, 800].map((v) => grade('japan', 'tds', v));
  for (let i = 1; i < jpTds.length; i += 1) {
    assert(jpTds[i] <= jpTds[i - 1] + 1e-9, `JP TDS mono ${jpTds[i - 1]} → ${jpTds[i]}`);
  }
}

console.log('\nAggregation dilution — documented limitation (no redesign)');
{
  const one = bench('thailand', { ...IDEAL, tds: 5000 });
  assert(one.params.tds === 0 && one.score === 60, 'TH 1 catastrophic → 60 (weakest-link)');
  assert(bench('thailand', { ...IDEAL, tds: 5000, turbidity: 50 }).score === 45, 'TH 2 catastrophic → 45');
  assert(bench('thailand', { ...IDEAL, tds: 5000, turbidity: 50, chlorine: 10 }).score === 30,
    'TH 3 catastrophic → 30');
  assert(bench('usEpa', { ...IDEAL, tds: 5000 }).score === 80, 'EPA 1 catastrophic → 80');
}

console.log('\nRAW vs engine input + Hero path (DIFF)');
{
  const raw = { ...DIFF };
  const v = sandbox.MeasurementValidator.validateMeasurements(raw);
  assert(v.status === 'VALID', 'DIFF VALID');
  for (const k of ['ph', 'tds', 'turbidity', 'orp', 'chlorine', 'do']) {
    assert(v.measurements[k] === raw[k], `RAW ${k}=${raw[k]} preserved`);
  }
  assert(v.measurements.temp === raw.temp, 'temp passthrough');
  const th = bench('thailand', v.measurements);
  const disp = displayed(v.measurements, 'thailand');
  const cmp = sandbox.buildComparisonScoreResult(v.measurements, 'thailand');
  assert(th.score === 69 && cmp.score === 69 && disp.score === 69,
    'engine === comparison === displayed = 69');
  assert(disp.engineKey === 'thailand' && disp.source === 'country-benchmark', 'Hero country-benchmark');
  const q = sandbox.computeQualityScoreDetail(v.measurements).score;
  assert(q === 61 && q !== disp.score, `Q-V3 ${q} isolated from Hero ${disp.score}`);
}

console.log('\nCountry switch TH→JP→EU→WHO→EPA→TH (no stale cache)');
{
  function jobFromReadings(readings) {
    return {
      id: 'local-sensitivity-1',
      notionId: 'notion-sensitivity-1',
      draft: {
        fields: {
          'm-ph': readings.ph,
          'm-tds': readings.tds,
          'm-turb': readings.turbidity,
          'm-orp': readings.orp,
          'm-do': readings.do,
          'm-free-cl': readings.chlorine,
          'm-temp': readings.temp
        }
      }
    };
  }
  const seq = ['thailand', 'japan', 'eu', 'who', 'usEpa', 'thailand'];
  const hero = [];
  sandbox.S.publicScoreView = false;
  sandbox.S.activeJob = jobFromReadings(DIFF);
  for (const key of seq) {
    sandbox.setScoreReferenceStandard(key);
    const out = sandbox.S.displayedScore;
    const eng = bench(key, DIFF);
    assert(out.engineKey === key, `switch ${key} engineKey`);
    assert(out.score === eng.score, `switch ${key} Hero ${out.score} === engine ${eng.score}`);
    assert(sandbox.S.scoreVal === 61, `switch ${key} S.scoreVal stays Q-V3 61`);
    assert(sandbox.S.currentScoreResult?.standardKey === 'quality-v3',
      `switch ${key} publish channel stays quality-v3`);
    hero.push(out.score);
  }
  assert(hero[0] === hero[5], `first TH ${hero[0]} === last TH ${hero[5]}`);
  console.log('  hero sequence', hero);
}

console.log('\nMissing-data country semantics');
{
  assert(bench('thailand', { ...IDEAL, ph: null }).score == null, 'TH missing pH incomplete');
  // Raw composite is 100 (all other params ideal); Hero ceiling caps at 99.
  assert(bench('japan', { ...IDEAL, do: null }).score === 99
    && bench('japan', { ...IDEAL, do: null }).classifications.do === 'NOT_EVALUATED',
    'JP missing DO still scores / NOT_EVALUATED');
  assert(bench('eu', { ...IDEAL, do: null }).score == null, 'EU missing DO incomplete');
  assert(bench('who', { ...IDEAL, do: null }).score == null, 'WHO missing DO incomplete');
  assert(bench('usEpa', { ...IDEAL, do: null }).score == null, 'EPA missing DO incomplete');
}

console.log('\nInvalid / extreme');
{
  const bad = sandbox.MeasurementValidator.validateMeasurements({
    ph: 20, tds: -50, turbidity: -5, orp: 5000, do: 100, chlorine: -2, temp: 999
  });
  assert(bad.status === 'INVALID', 'impossible → INVALID');
  assert(bench('thailand', { ph: 3, tds: 5000, turbidity: 50, orp: -100, chlorine: 10, do: 0, temp: 80 }).score === 0,
    'extreme-valid TH → 0');
}

function jobFrom(r) {
  return {
    id: 'local-forensic-1',
    notionId: 'notion-forensic-1',
    draft: {
      fields: {
        'm-ph': r.ph, 'm-tds': r.tds, 'm-turb': r.turbidity,
        'm-orp': r.orp, 'm-do': r.do, 'm-free-cl': r.chlorine, 'm-temp': r.temp
      }
    }
  };
}

function pipeline(raw, country) {
  const mapped = sandbox.readingsFromFieldMap(jobFrom(raw).draft.fields);
  const merged = sandbox.mergeReadingLayers({}, mapped, {});
  const validation = sandbox.MeasurementValidator.validateMeasurements(merged);
  const resolved = sandbox.resolveScoreReadings(jobFrom(raw));
  const eng = bench(country, resolved);
  const disp = displayed(resolved, country);
  const q = sandbox.computeQualityScoreDetail(resolved);
  return { mapped, merged, validation, resolved, eng, disp, q };
}

function rawUnchanged(raw, pipe) {
  return ['ph', 'tds', 'turbidity', 'orp', 'chlorine', 'do', 'temp'].every((k) =>
    pipe.mapped[k] === raw[k] && pipe.merged[k] === raw[k] && pipe.resolved[k] === raw[k]);
}

console.log('\nRAW immutability — named forensic fixtures');
{
  const named = {
    DIFF,
    IDEAL,
    ORP_LOW: { ...IDEAL, orp: 200 },
    ORP_MID: { ...IDEAL, orp: 400 },
    ORP_HIGH: { ...IDEAL, orp: 600 },
    EPA_CL_LOW: { ...IDEAL, chlorine: 0.2 },
    EPA_CL_MID: { ...IDEAL, chlorine: 0.5 },
    EPA_CL_HIGH: { ...IDEAL, chlorine: 3.9 },
    WHO_CL_BELOW: { ...IDEAL, chlorine: 0 },
    WHO_CL_LOW: { ...IDEAL, chlorine: 0.1 },
    WHO_CL_HIGH: { ...IDEAL, chlorine: 1.0 }
  };
  for (const [label, raw] of Object.entries(named)) {
    const p = pipeline(raw, 'thailand');
    assert(p.validation.status === 'VALID', `${label} validator VALID`);
    assert(rawUnchanged(raw, p), `${label} RAW===mapped===merged===resolved`);
  }
}

console.log('\nDIFF live path TH — RAW→grade→round→Hero (no Q-V3 overwrite)');
{
  const p = pipeline(DIFF, 'thailand');
  assert(p.eng.params.tds < 100 && p.eng.params.turbidity < 100 && p.eng.params.chlorine < 100,
    'DIFF TH TDS/turb/Cl grades leave 100');
  assert(p.eng.score === 69 && p.disp.score === 69 && p.disp.engineKey === 'thailand',
    `DIFF Hero ${p.disp.score} === engine 69`);
  assert(p.q.score === 61, `DIFF Q-V3 isolated 61 (got ${p.q.score})`);
}

console.log('\nORP 200 vs 400 vs 600 country grades (PD-014 D1, 2026-08-14 — inner curve authorized)');
{
  for (const key of KEYS) {
    const g200 = grade(key, 'orp', 200);
    const g400 = grade(key, 'orp', 400);
    const g600 = grade(key, 'orp', 600);
    assert(g200 === 70 && g400 === 100 && g600 === 70,
      `${key} ORP 200=70/400=100/600=70 (inner severity, no longer flat)`);
    assert(grade(key, 'orp', 150) < g200 && grade(key, 'orp', 650) < g600,
      `${key} ORP outside 200–600 declines further than the inner-ramp edges`);
  }
  assert(sandbox.computeQualityScoreDetail({ ...IDEAL, orp: 200 }).score
    !== sandbox.computeQualityScoreDetail({ ...IDEAL, orp: 400 }).score,
    'Q-V3 ORP 200 !== 400 (severity also lives on Quality channel, independently)');
}

console.log('\nEPA Cl 0.3 vs 3.9 (PD-014 D2, 2026-08-14 — inner curve authorized, no longer identical)');
{
  const lo = bench('usEpa', { ...IDEAL, chlorine: 0.3 });
  const hi = bench('usEpa', { ...IDEAL, chlorine: 3.9 });
  assert(lo.params.chlorine === 100 && hi.params.chlorine < 100 && hi.params.chlorine > 60,
    'EPA Cl 0.3 grades 100 (inner plateau), 3.9 grades below 100 (inner decline)');
  assert(lo.score !== hi.score, 'EPA Hero 0.3 !== 3.9 (real separation, not both flattened by the ceiling)');
  assert(sandbox.UsEpaBenchmarkLimits.chlorine.projectMin === 0.2
    && sandbox.UsEpaBenchmarkLimits.chlorine.mrdlMax === 4.0,
    'EPA Cl ceilings unchanged 0.2 / 4.0');
  assert(sandbox.computeQualityScoreDetail({ ...IDEAL, chlorine: 0.3 }).score
    !== sandbox.computeQualityScoreDetail({ ...IDEAL, chlorine: 3.9 }).score,
    'Q-V3 distinguishes Cl 0.3 vs 3.9');
}

console.log('\nWHO Cl 0 vs 1.0 (PD-014 D3, 2026-08-14 — below-min ramp authorized)');
{
  const zero = bench('who', { ...IDEAL, chlorine: 0 });
  const one = bench('who', { ...IDEAL, chlorine: 1.0 });
  assert(zero.params.chlorine === 0 && one.params.chlorine === 80,
    'WHO Cl 0 grades 0 (below-min ramp), Cl 1.0 still grades 80 (fair bucket, unchanged)');
  const neg = pipeline({ ...IDEAL, chlorine: -1 }, 'who');
  assert(neg.resolved.chlorine === undefined || neg.eng.score == null,
    'WHO Cl=-1 does not reach a finite score (validator strips implausible)');
}

console.log('\nTH Cl 0.51 — grade drops, Math.round still rounds raw composite to 100, Hero ceiling caps at 99');
{
  const r = bench('thailand', { ...IDEAL, chlorine: 0.51 });
  assert(r.params.chlorine < 100 && r.params.chlorine >= 99, `TH Cl 0.51 grade ${r.params.chlorine} < 100`);
  assert(r.score === 99, 'TH Cl 0.51 composite rounds to 100 pre-ceiling, Hero shows 99 (Math.round unchanged, ceiling applied)');
}

console.log('\nCross-country BASE/DIFF/LOCKED (PD-014 D1/D2 change BASE/DIFF-EPA only, 2026-08-14)');
{
  // BASE orp=515 is now inside the D1 outer-decline ramp on every engine
  // (>450) — no longer flat 100, so JP/WHO/EPA BASE genuinely move down.
  assert(bench('japan', BASE).score === 98, 'JP BASE 98 (was 99 pre-D1; orp=515 now inner-declines)');
  assert(bench('who', BASE).score === 93, 'WHO BASE 93 (was 95 pre-D1; orp=515 now inner-declines)');
  assert(bench('eu', BASE).score === 65, 'EU BASE 65 (unchanged — chlorine gate already dominates composite)');
  assert(bench('usEpa', BASE).score === 98, 'EPA BASE 98 (was 99 pre-D1; orp=515 now inner-declines)');
  assert(sandbox.computeQualityScoreDetail(BASE).score === 76, 'Q-V3 BASE 76 (unaffected by Country changes)');
  // DIFF orp=350 sits exactly on the D1 inner-plateau edge (still grade 100)
  // so only EPA DIFF moves, and only because D2 now grades its chlorine=1.5
  // below 100 (was flat 100 across the whole 0.2-4.0 window pre-D2).
  assert(bench('japan', DIFF).score === 78, 'JP DIFF 78 (unaffected — D1 no-op at orp=350, D2 is EPA-only)');
  assert(bench('eu', DIFF).score === 61, 'EU DIFF 61 (unaffected — D1 no-op at orp=350, D2/D3 out of scope for EU)');
  assert(bench('who', DIFF).score === 81, 'WHO DIFF 81 (unaffected — D1 no-op at orp=350, D3 only affects Cl<0.2)');
  assert(bench('usEpa', DIFF).score === 78, 'EPA DIFF 78 (was 79; D2 grades Cl=1.5 below 100 for the first time)');
  assert(bench('japan', LOCKED).score === 96, 'JP LOCKED 96 (unaffected — orp=350 is the D1 plateau edge)');
  assert(bench('thailand', LOCKED).score === 77, 'TH LOCKED 77 after ordinary-band severity (orp=350 still excellent)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
