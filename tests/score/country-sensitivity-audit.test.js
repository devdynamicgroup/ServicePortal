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

console.log('\nMatrix — which params are classified (all 5 now grade DO numerically when present)');
{
  const th = bench('thailand', IDEAL);
  const jp = bench('japan', IDEAL);
  const eu = bench('eu', IDEAL);
  // 2026-08-18 (PO-approved): DO is now part of the shared grading base for
  // every engine when present — TH/JP's own identity is that they never
  // classify it PASS/FAIL (NOT_EVALUATED), not that they omit it numerically.
  assert(Number.isFinite(th.params.do) && th.classifications.do === 'NOT_EVALUATED', 'TH DO numerically graded, never classified');
  assert(Number.isFinite(jp.params.do) && jp.classifications.do === 'NOT_EVALUATED', 'JP DO numerically graded, never classified (PD-012 B)');
  assert(Number.isFinite(eu.params.do) && Number.isFinite(bench('who', IDEAL).params.do)
    && Number.isFinite(bench('usEpa', IDEAL).params.do),
    'EU/WHO/EPA DO are scored and classified');
  assert(sandbox.JapanBenchmarkWeights.do === 0.12, 'JP do weight metadata 0.12 retained (vestigial — no longer drives scoring)');
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
  // 2026-08-18 (PO-approved): per-country curves were replaced by one
  // shared formula — the shared curve's own ideal ceiling is turb<=0.1
  // (not Thailand's old <=0.3), so 0.3 now genuinely declines below 100.
  assert(grade('thailand', 'turbidity', 0.1) === 100, 'TH turb ≤0.1 = 100 (shared curve ideal)');
  assert(grade('thailand', 'turbidity', 0.3) < 100, 'TH turb 0.3 now declines under the shared curve');
  assert(grade('thailand', 'turbidity', 1) < 100, 'TH turb 1 leaves excellent under PD-015');
  assert(grade('thailand', 'turbidity', 3.5) < 100, 'TH turb 3.5 < 100');
  assert(grade('thailand', 'chlorine', 0.3) === 100, 'TH Cl 0.3 = 100');
  assert(grade('thailand', 'chlorine', 1.5) < 100 && grade('thailand', 'chlorine', 1.5) > grade('thailand', 'chlorine', 2.0),
    'TH Cl 1.5 severity inside 0.2–2.0');
  // 2026-08-19 (PO-approved, evidence-based): passMax corrected to real
  // cited Thai standards — TDS 1000→500 (DOH 2020), turbidity 5→1.0 (MWA spec).
  assert(sandbox.ThailandBenchmarkLimits.tds.passMax === 500, 'TH TDS passMax corrected to DOH 2020 (500)');
  assert(sandbox.ThailandBenchmarkLimits.turbidity.passMax === 1.0, 'TH turb passMax corrected to MWA spec (1.0)');
  assert(sandbox.ThailandBenchmarkLimits.chlorine.min === 0.2
    && sandbox.ThailandBenchmarkLimits.chlorine.max === 2.0,
    'TH Cl compliance band ceiling unchanged');
  // 2026-08-19 (PO-approved, evidence-based): DIFF's TDS=800/turbidity=3.5
  // now exceed Thailand's own corrected bounds too (FAIL/CRITICAL), so its
  // own severity cap now binds here as well: raw 61 - CRITICAL guaranteed
  // deduction (10) = 51.
  assert(bench('thailand', DIFF).score === 51, `DIFF TH 51 (CRITICAL cap + guaranteed deduction) (got ${bench('thailand', DIFF).score})`);
}

console.log('\n2026-08-18: per-country pH curves (TH edge=70, JP cited-target, WHO 8.0 ceiling, flat-compliance EU/EPA) were replaced by one shared formula (computeSharedBenchmarkBase) — this section now asserts the new invariant: identical pH grading across all 5 engines, plus the still-true generic decline-outside-preferred-band behavior.');
{
  for (const key of KEYS) {
    const L = sandbox.WaterScoreBenchmarkRegistry.get(key).limits.ph;
    // Every engine now grades pH via the exact same shared curve (center 7.2).
    for (const v of [6.0, 6.5, 7.2, 7.5, 8.0, 8.5, 9.0]) {
      assert(grade(key, 'ph', v) === grade('thailand', 'ph', v),
        `${key} pH grade(${v}) matches shared curve (thailand as reference)`);
    }
    assert(grade(key, 'ph', 7.2) === 100, `${key} pH preferred center = 100 (shared curve)`);
    assert(grade(key, 'ph', L.min - 0.5) < 100, `${key} pH below band declines`);
    assert(grade(key, 'ph', L.max + 0.5) < 100, `${key} pH above band declines`);
  }
}

console.log('\nORP severity within locked 200-600 (shared curve, identical across all 5 engines)');
{
  for (const key of KEYS) {
    // 2026-08-18 (PO-approved): shared gradeOrp curve, center 400±25.
    assert(grade(key, 'orp', 400) === 100, `${key} ORP 400 = 100 (shared curve center)`);
    assert(grade(key, 'orp', 375) === 100 && grade(key, 'orp', 425) === 100, `${key} ORP 375/425 = 100 (shared plateau ±25)`);
    assert(grade(key, 'orp', 200) < 100, `${key} ORP 200 < 100 (shared curve declines)`);
    assert(grade(key, 'orp', 600) < 100, `${key} ORP 600 < 100 (shared curve declines)`);
    assert(grade(key, 'orp', 100) < grade(key, 'orp', 200), `${key} ORP 100 worse than 200 (monotonic outer decline)`);
    assert(grade(key, 'orp', 700) < grade(key, 'orp', 600), `${key} ORP 700 worse than 600 (monotonic outer decline)`);
  }
}

console.log('\n2026-08-18: EPA chlorine severity within locked 0.2-4.0 now uses the shared chlorine curve');
{
  // 2026-08-18 (PO-approved): the shared curve's own plateau is 0.2-0.5
  // (not EPA's old 0.2-1.0), then declines monotonically toward a floor.
  for (const cl of [0.2, 0.3, 0.5]) {
    assert(grade('usEpa', 'chlorine', cl) === 100, `EPA Cl ${cl} = 100 (shared plateau)`);
  }
  for (const cl of [1.0, 1.5, 2.0, 3.0, 4.0]) {
    assert(grade('usEpa', 'chlorine', cl) < 100, `EPA Cl ${cl} declines below the shared plateau`);
  }
  assert(grade('usEpa', 'chlorine', 0.1) < 100, 'EPA Cl 0.1 < 100');
  assert(grade('usEpa', 'chlorine', 4.01) < grade('usEpa', 'chlorine', 4.0), 'EPA Cl > MRDL declines further below 4.0');
}

console.log('\n2026-08-18: chlorine/turbidity ideal plateaus now come from the one shared curve, identical across engines');
{
  // 2026-08-18 (PO-approved): per-country chlorine curves (Japan's own
  // 0.2-0.5 ideal + legal-edge plateau, EU's own 0.1-0.5 band, WHO's own
  // steepened decline) were replaced by the shared curve — its own ideal
  // plateau is 0.2-0.5 mg/L flat 100, declining monotonically outside it.
  assert(grade('japan', 'chlorine', 0.3) === 100, 'JP Cl 0.3 (shared plateau) = 100');
  assert(grade('japan', 'chlorine', 0.1) < 100 && grade('japan', 'chlorine', 1.0) < 100,
    'JP Cl outside the shared 0.2-0.5 plateau (0.1/1.0) declines');
  assert(grade('japan', 'chlorine', 1.5) < grade('japan', 'chlorine', 1.0), 'JP Cl 1.5 declines further than 1.0');
  assert(grade('eu', 'chlorine', 0.1) < 100 && grade('eu', 'chlorine', 0.5) === 100,
    'EU Cl 0.1 now declines under the shared curve (its own compliance band starts at 0.1, but the shared ideal plateau starts at 0.2); 0.5 stays 100');
  assert(bench('eu', { ...IDEAL, chlorine: 0.7 }).score <= 65, 'EU Cl fail gated ≤65');
  assert(grade('who', 'chlorine', 0.3) === 100 && grade('who', 'chlorine', 0.7) < 100,
    'WHO Cl ideal 0.2-0.5 (shared plateau) then declines');
  // Japan turbidity: shared curve's own ideal ceiling is <=0.1 NTU; every
  // value tested above that now declines monotonically (no flat compliance
  // zone survives from Japan's old curve).
  assert(grade('japan', 'turbidity', 1) > grade('japan', 'turbidity', 2)
    && grade('japan', 'turbidity', 2) > grade('japan', 'turbidity', 3.5),
    'JP turb declines monotonically past the shared ideal ceiling (1 > 2 > 3.5)');
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
  // 2026-08-18 (PO-approved): shared gradeTds floor is 5 (not 0) at extreme
  // values. Thailand's classification-based CRITICAL cap (60) is a ceiling,
  // not a floor: it binds when the raw shared-base average is above it (1
  // catastrophic param). For 2 and 3 catastrophic params the raw average is
  // already below 60, so the cap itself is a no-op — but the guaranteed
  // minimum deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.CRITICAL=10) still
  // always comes off when CRITICAL is the worst classification: raw
  // 68 -> 58 (2 params), raw 53 -> 43 (3 params).
  const one = bench('thailand', { ...IDEAL, tds: 5000 });
  assert(one.params.tds === 5 && one.score === 60, 'TH 1 catastrophic → 60 (CRITICAL cap)');
  assert(bench('thailand', { ...IDEAL, tds: 5000, turbidity: 50 }).score === 58, 'TH 2 catastrophic → 58 (raw 68, cap no-op, guaranteed deduction 68-10)');
  assert(bench('thailand', { ...IDEAL, tds: 5000, turbidity: 50, chlorine: 10 }).score === 43,
    'TH 3 catastrophic → 43 (raw 53, cap no-op, guaranteed deduction 53-10)');
  // Country severity protection: TDS=5000 is CRITICAL on EPA, capped at 60.
  assert(bench('usEpa', { ...IDEAL, tds: 5000 }).score === 60, 'EPA 1 catastrophic → 60 (CRITICAL cap)');
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
  // 2026-08-19 (PO-approved, evidence-based): DIFF's TDS=800/turbidity=3.5
  // now exceed Thailand's own corrected bounds (DOH 2020 TDS≤500 / MWA
  // turbidity≤1.0) too — CRITICAL classification + guaranteed deduction
  // takes shared raw base 61 down to 51 for Thailand's own Hero path.
  assert(th.score === 51 && cmp.score === 51 && disp.score === 51,
    'engine === comparison === displayed = 51');
  assert(disp.engineKey === 'thailand' && disp.source === 'country-benchmark', 'Hero country-benchmark');
  const q = sandbox.computeQualityScoreDetail(v.measurements).score;
  // Quality V3 (61) now diverges from Thailand's Hero score (51) — Quality
  // V3 has no country-specific severity cap, so this is a clean isolation
  // proof: the two are computed via genuinely separate functions/paths.
  assert(q === 61 && q !== disp.score, `Q-V3 ${q} diverges from Hero ${disp.score} (Thailand's own severity cap now binds)`);
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
  assert(bench('thailand', { ...IDEAL, ph: null }).score == null, 'TH missing pH incomplete (ph is still required)');
  // 2026-08-18 (PO-approved): DO is now optional for every engine (only
  // ph/tds/turbidity/orp are required) — missing DO no longer makes ANY
  // engine incomplete, not just Japan/Thailand. It's simply excluded from
  // the shared grading average, and classification stays NOT_EVALUATED
  // (Thailand/Japan) or NOT_MEASURED (WHO/EU/US EPA, which do classify DO
  // when present).
  // Japan's own pH target (7.3-7.7) doesn't include IDEAL's pH=7.2, so it
  // classifies WARNING (85 cap) regardless of DO — same reasoning as
  // country-hero-ceiling.test.js's IDEAL fixture.
  assert(bench('japan', { ...IDEAL, do: null }).score === 85
    && bench('japan', { ...IDEAL, do: null }).classifications.do === 'NOT_EVALUATED',
    'JP missing DO still scores (WARNING-capped at 85 by its own pH target) / NOT_EVALUATED');
  assert(bench('eu', { ...IDEAL, do: null }).score === 99
    && bench('eu', { ...IDEAL, do: null }).classifications.do === 'NOT_MEASURED',
    'EU missing DO still scores / NOT_MEASURED');
  assert(bench('who', { ...IDEAL, do: null }).score === 99, 'WHO missing DO still scores');
  assert(bench('usEpa', { ...IDEAL, do: null }).score === 99, 'EPA missing DO still scores');
}

console.log('\nInvalid / extreme');
{
  const bad = sandbox.MeasurementValidator.validateMeasurements({
    ph: 20, tds: -50, turbidity: -5, orp: 5000, do: 100, chlorine: -2, temp: 999
  });
  assert(bad.status === 'INVALID', 'impossible → INVALID');
  // 2026-08-18 (PO-approved): raw base still floors above 0 (each shared
  // curve has its own numeric floor, e.g. ph floor 8, tds floor 5) — but this
  // fixture's worst classification is CRITICAL, and the guaranteed minimum
  // deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.CRITICAL=10) is unconditional,
  // so applyCountrySeverityProtection floors the final score at 0 rather
  // than letting it go negative.
  assert(bench('thailand', { ph: 3, tds: 5000, turbidity: 50, orp: -100, chlorine: 10, do: 0, temp: 80 }).score === 0,
    'extreme-valid TH → 0 (CRITICAL guaranteed deduction floored at 0, not negative)');
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
  // 2026-08-19 (PO-approved, evidence-based): Thailand's own CRITICAL cap
  // now binds DIFF too (raw 61 - guaranteed deduction 10 = 51).
  assert(p.eng.score === 51 && p.disp.score === 51 && p.disp.engineKey === 'thailand',
    `DIFF Hero ${p.disp.score} === engine 51`);
  assert(p.q.score === 61, `DIFF Q-V3 isolated 61 (got ${p.q.score})`);
}

console.log('\nORP 200 vs 400 vs 600 country grades (shared curve, identical across engines)');
{
  for (const key of KEYS) {
    const g200 = grade(key, 'orp', 200);
    const g400 = grade(key, 'orp', 400);
    const g600 = grade(key, 'orp', 600);
    // 2026-08-18 (PO-approved): shared gradeOrp curve — center 400±25 = 100,
    // declining outward; at the outer edge of the 200-600 operational band
    // (d=200 from center) it grades 58.
    assert(g200 === 58 && g400 === 100 && g600 === 58,
      `${key} ORP 200=58/400=100/600=58 (shared curve severity)`);
    assert(grade(key, 'orp', 150) < g200 && grade(key, 'orp', 650) < g600,
      `${key} ORP outside 200–600 declines further than the inner-ramp edges`);
  }
  assert(sandbox.computeQualityScoreDetail({ ...IDEAL, orp: 200 }).score
    !== sandbox.computeQualityScoreDetail({ ...IDEAL, orp: 400 }).score,
    'Q-V3 ORP 200 !== 400 (severity also lives on Quality channel, independently)');
}

console.log('\nEPA Cl 0.3 vs 3.9 (shared chlorine curve, no longer identical)');
{
  const lo = bench('usEpa', { ...IDEAL, chlorine: 0.3 });
  const hi = bench('usEpa', { ...IDEAL, chlorine: 3.9 });
  // 2026-08-18 (PO-approved): shared curve's plateau is 0.2-0.5 (0.3 grades
  // 100); 3.9 is well past it and declines steeply (grades 12.8, not a
  // gentle EPA-only inner decline).
  assert(lo.params.chlorine === 100 && hi.params.chlorine < 100,
    'EPA Cl 0.3 grades 100 (shared plateau), 3.9 grades well below 100 (shared decline)');
  assert(lo.score !== hi.score, 'EPA Hero 0.3 !== 3.9 (real separation, not both flattened by the ceiling)');
  assert(sandbox.UsEpaBenchmarkLimits.chlorine.projectMin === 0.2
    && sandbox.UsEpaBenchmarkLimits.chlorine.mrdlMax === 4.0,
    'EPA Cl ceilings unchanged 0.2 / 4.0');
  assert(sandbox.computeQualityScoreDetail({ ...IDEAL, chlorine: 0.3 }).score
    !== sandbox.computeQualityScoreDetail({ ...IDEAL, chlorine: 3.9 }).score,
    'Q-V3 distinguishes Cl 0.3 vs 3.9');
}

console.log('\nWHO Cl 0 vs 1.0 (shared below-min ramp / high-side decline)');
{
  const zero = bench('who', { ...IDEAL, chlorine: 0 });
  const one = bench('who', { ...IDEAL, chlorine: 1.0 });
  // 2026-08-18 (PO-approved): shared curve's below-min ramp floors at 5
  // (not 0) for cl=0; the high-side decline grades cl=1.0 at 46.
  assert(zero.params.chlorine === 5 && one.params.chlorine === 46,
    'WHO Cl 0 grades 5 (shared below-min ramp floor), Cl 1.0 grades 46 (shared high-side decline)');
  const neg = pipeline({ ...IDEAL, chlorine: -1 }, 'who');
  assert(neg.resolved.chlorine === undefined || neg.eng.score == null,
    'WHO Cl=-1 does not reach a finite score (validator strips implausible)');
}

console.log('\nTH Cl 0.51 — grade drops just past the ideal band, composite still rounds to 99');
{
  const r = bench('thailand', { ...IDEAL, chlorine: 0.51 });
  // Chlorine curve steepened (2026-08-17, PO-approved): grade at 0.51 is now
  // 98.8 (was ~99.56) -- still just under 100, but the curve is materially
  // steeper immediately past the 0.5 ideal-band edge.
  assert(r.params.chlorine < 100 && r.params.chlorine >= 98, `TH Cl 0.51 grade ${r.params.chlorine} < 100`);
  assert(r.score === 99, 'TH Cl 0.51 composite still rounds to 99 (weakest-link share 0.5 pulls it just under the ceiling directly)');
}

console.log('\nCross-country BASE/DIFF/LOCKED (2026-08-18, PO-approved — shared grading base)');
{
  // 2026-08-18 (PO-approved): all 5 engines share one grading formula; raw
  // base for BASE = 76 for every engine. Thailand has no severity cap
  // binding here, so it stays at raw 76. Japan's own tighter pH band
  // (7.3-7.7) classifies ph=7.85 WARNING; the guaranteed minimum deduction
  // (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3) takes it to 73 even though
  // the 85 ceiling doesn't bind. WHO/US EPA both classify chlorine/do FAIL;
  // the guaranteed minimum deduction (FAIL=6) takes raw 76 down to 70 even
  // though the 75 ceiling doesn't bind either. EU's PD-002 chlorine gate is
  // unaffected.
  assert(bench('japan', BASE).score === 73, 'JP BASE 73 (shared base, WARNING guaranteed deduction)');
  assert(bench('who', BASE).score === 70, 'WHO BASE 70 (FAIL guaranteed deduction; do/chlorine classify FAIL)');
  assert(bench('eu', BASE).score === 65, 'EU BASE 65 (unchanged — chlorine gate dominates composite)');
  assert(bench('usEpa', BASE).score === 70, 'EPA BASE 70 (FAIL guaranteed deduction; do classifies FAIL)');
  assert(sandbox.computeQualityScoreDetail(BASE).score === 76, 'Q-V3 BASE 76 (unaffected by Country changes)');
  // Shared base for DIFF = 61. Japan/WHO/US EPA all classify tds/turbidity
  // as CRITICAL; raw 61 is already below the 60 CRITICAL ceiling, so the
  // guaranteed minimum deduction (CRITICAL=10) is what actually moves it:
  // 61 - 10 = 51. EU's own classification set (tds/turbidity FAIL, chlorine
  // CRITICAL, do FAIL) does trigger its PD-002 gate (chlorine outside EU's
  // own band, gate cap 65), but its generic (non-chlorine) severity worst
  // is FAIL, and 61 - 6 = 55 is now lower than the 65 gate cap, so the
  // generic guaranteed deduction — not the gate — ends up dominant: 55.
  assert(bench('japan', DIFF).score === 51, 'JP DIFF 51 (tds/turbidity CRITICAL cap + guaranteed deduction)');
  assert(bench('eu', DIFF).score === 55, 'EU DIFF 55 (non-chlorine FAIL guaranteed deduction now lower than the 65 chlorine gate)');
  assert(bench('who', DIFF).score === 51, 'WHO DIFF 51 (tds/turbidity CRITICAL cap + guaranteed deduction)');
  assert(bench('usEpa', DIFF).score === 51, 'EPA DIFF 51 (tds/turbidity CRITICAL cap + guaranteed deduction)');
  // Shared base for LOCKED = 73. Japan's own tighter thresholds classify
  // tds/turbidity FAIL; raw 73 is already below the 75 FAIL ceiling, so the
  // guaranteed minimum deduction (FAIL=6) takes it to 67.
  assert(bench('japan', LOCKED).score === 67, 'JP LOCKED 67 (shared base, FAIL guaranteed deduction)');
  // 2026-08-19 (PO-approved, evidence-based): Thailand's own turbidity
  // passMax corrected 5→1.0 (MWA spec) — LOCKED's turbidity=2.5 now also
  // classifies FAIL for Thailand, same guaranteed deduction: 73 - 6 = 67.
  assert(bench('thailand', LOCKED).score === 67, 'TH LOCKED 67 (turbidity FAIL cap + guaranteed deduction)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
