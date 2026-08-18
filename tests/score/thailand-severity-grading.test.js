/**
 * Thailand in-band severity grading — saturation repair.
 * Compliance passMax / Cl 0.2–2.0 unchanged; grade 100 uses existing inner plateaus.
 *
 * 2026-08-18 (PO-approved): Thailand's own per-parameter grade curves
 * (gradeTds/gradeTurbidity/gradeChlorine/gradePh/gradeOrp) were deleted —
 * all 5 country engines now share one grading formula
 * (computeSharedBenchmarkBase in computeQualityScoreV2.js). The old
 * per-value curve-shape locks below (e.g. "TDS 1000 grade 40", "Cl 0.7
 * grade ~76") tested curve internals that no longer exist in this engine;
 * they're replaced with monotonicity + cross-engine-identity checks against
 * the shared curve. Locked-baseline composite scores (BASE/DIFF/LOCKED/
 * oneBad/twoBad/threeBad fixtures) are recomputed against the new formula —
 * every value below was read from actually running the sandbox, not estimated.
 * Run: node tests/score/thailand-severity-grading.test.js
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

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const IDEAL = Object.freeze({ ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, do: 8, chlorine: 0.3, temp: 25 });
const BASE = Object.freeze({ ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25 });
const DIFF = Object.freeze({ ph: 7.2, tds: 800, turbidity: 3.5, orp: 350, do: 5.5, chlorine: 1.5, temp: 28 });
const KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];

function th(r) { return sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', r); }
function displayed(r, key) {
  return sandbox.resolveDisplayedScore({ readings: r, standardKey: key, publicView: false });
}

function trace(raw, country) {
  const mapped = {
    ph: Number(raw.ph), tds: Number(raw.tds), turbidity: Number(raw.turbidity),
    orp: Number(raw.orp), chlorine: Number(raw.chlorine), do: Number(raw.do), temp: Number(raw.temp)
  };
  const validation = sandbox.MeasurementValidator.validateMeasurements(mapped);
  const after = { ...mapped };
  sandbox.MeasurementValidator.SCORED_KEYS.forEach((k) => {
    const st = validation.fields[k]?.state;
    if (st === 'IMPLAUSIBLE' || st === 'INVALID_TYPE') delete after[k];
  });
  const eng = sandbox.WaterScoreBenchmarkRegistry.calculate(country, after);
  const disp = displayed(after, country);
  return {
    raw, mapped, after, validation: validation.status,
    grades: eng.params, postRound: eng.score,
    displayed: disp.score, engineKey: disp.engineKey, source: disp.source,
    doClass: eng.classifications?.do
  };
}

console.log('\nCompliance ceilings unchanged (PD-008 / TH-TDS / TH-TURB) — limits.js untouched by the shared-formula rebuild');
{
  const L = sandbox.ThailandBenchmarkLimits;
  assert(L.tds.passMax === 1000, 'TDS passMax still 1000');
  assert(L.turbidity.passMax === 5, 'turbidity passMax still 5');
  assert(L.chlorine.min === 0.2 && L.chlorine.max === 2.0, 'Cl compliance band still 0.2–2.0');
  assert(L.ph.min === 6.5 && L.ph.max === 8.5, 'pH compliance band unchanged');
  assert(L.orp.min === 200 && L.orp.max === 600, 'ORP shared band unchanged');
}

console.log('\nDO: no PASS/FAIL opinion, but numerically part of the shared base whenever present');
{
  const r = th(BASE);
  // 2026-08-18 (PO-approved): DO is now graded by the shared formula whenever
  // present (BASE has do=5.3) — Thailand still never classifies it PASS/FAIL
  // (NOT_EVALUATED, unchanged, PD-003), but params.do is no longer always
  // undefined the way it was when Thailand had its own DO-excluded curve set.
  assert(r.classifications.do === 'NOT_EVALUATED', 'DO NOT_EVALUATED (still no PASS/FAIL opinion)');
  assert(Number.isFinite(r.params.do), `DO now graded (${r.params.do}) when present — shared base doesn't know Thailand ignores it for PASS/FAIL`);
  assert(sandbox.ThailandBenchmarkWeights.do === undefined, 'DO not in Thailand-specific weights metadata');
}

console.log('\nShared-curve sanity — TDS/turbidity/chlorine/pH/ORP monotonic and identical across all 5 engines');
{
  function checkParam(key, values) {
    let prevAtIdeal = null;
    for (const v of values) {
      const r = th({ ...IDEAL, [key]: v });
      const grade = r.params[key];
      assert(Number.isFinite(grade) && grade >= 0 && grade <= 100, `${key}=${v} grade bounded [0,100] (got ${grade})`);
      const gradesAcrossEngines = KEYS.map(engKey => sandbox.WaterScoreBenchmarkRegistry.calculate(engKey, { ...IDEAL, [key]: v }).params[key]);
      assert(gradesAcrossEngines.every(g => g === gradesAcrossEngines[0]),
        `${key}=${v} grades identically across engines (${JSON.stringify(gradesAcrossEngines)})`);
    }
  }
  checkParam('tds', [80, 100, 200, 300, 500, 800, 1000, 1500, 5000]);
  checkParam('turbidity', [0.05, 0.1, 0.2, 0.5, 1, 2, 3.5, 5, 10]);
  checkParam('chlorine', [0, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5]);
  checkParam('orp', [100, 200, 300, 350, 400, 500, 600, 700, 900]);
}

console.log('\nDIFF pipeline retrace (RAW === engine input)');
{
  const t = trace(DIFF, 'thailand');
  assert(t.after.tds === 800 && t.after.turbidity === 3.5 && t.after.chlorine === 1.5,
    'DIFF engine input equals raw');
  assert(t.grades.tds < 100 && t.grades.turbidity < 100 && t.grades.chlorine < 100,
    'DIFF TH TDS/turb/Cl grades leave 100');
  assert(t.grades.ph === 100, 'DIFF TH pH still 100 (shared curve, unaffected by DIFF\'s pH=7.2)');
  assert(t.postRound === 61, `DIFF TH score 61 (got ${t.postRound})`);
  assert(t.displayed === 61 && t.engineKey === 'thailand' && t.source === 'country-benchmark',
    'DIFF Hero = Thailand 61');
  const jp = trace(DIFF, 'japan');
  // Raw base for DIFF is 61, already below Japan's 60 CRITICAL ceiling, so
  // the 2026-08-18 guaranteed minimum deduction
  // (COUNTRY_SEVERITY_MIN_DEDUCTION.CRITICAL=10) is what actually moves it:
  // 61 - 10 = 51.
  assert(jp.postRound === 51 && jp.displayed === 51, `DIFF JP 51 (got ${jp.postRound})`);
  const q = sandbox.computeQualityScoreDetail(DIFF).score;
  assert(q === 61, 'DIFF Q-V3 unchanged 61');
}

console.log('\nBASE / one-bad pipeline');
{
  const base = trace(BASE, 'thailand');
  assert(base.after.tds === 175 && Number.isFinite(base.grades.chlorine), `BASE Cl grade is finite (${base.grades.chlorine})`);
  assert(base.postRound === 76 && base.displayed === 76, `BASE TH 76 (got ${base.postRound})`);
  assert(sandbox.computeQualityScoreDetail(BASE).score === 76, 'BASE Q-V3 76');
  const tds = trace({ ...IDEAL, tds: 800 }, 'thailand');
  const turb = trace({ ...IDEAL, turbidity: 3.5 }, 'thailand');
  const cl = trace({ ...IDEAL, chlorine: 1.5 }, 'thailand');
  assert(tds.postRound === 90 && tds.grades.tds < 100, `oneBad TDS TH 90 (got ${tds.postRound})`);
  assert(turb.postRound === 90 && turb.grades.turbidity < 100, `oneBad turb TH 90 (got ${turb.postRound})`);
  assert(cl.postRound === 90 && cl.grades.chlorine < 100, `oneBad Cl TH 90 (got ${cl.postRound})`);
}

console.log('\nCross-engine isolation');
{
  assert(sandbox.JapanBenchmarkWeights.do === 0.12, 'JP do weight 0.12');
  assert(sandbox.EuBenchmarkLimits.gateCapOnChlorineFail === 65, 'EU gate 65');
  assert(sandbox.UsEpaBenchmarkLimits.chlorine.max === 4.0, 'EPA Cl max 4.0');
  const jp = sandbox.WaterScoreBenchmarkRegistry.calculate('japan', BASE);
  // Japan's own tighter pH band (7.3-7.7) classifies ph=7.85 WARNING; the
  // guaranteed minimum deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3)
  // takes raw 76 to 73.
  assert(jp.score === 73 && jp.classifications.do === 'NOT_EVALUATED', `JP BASE 73 / DO NE (got ${jp.score})`);
  // WHO/EPA classify chlorine/do FAIL; raw 76 is already below the 75 FAIL
  // ceiling, so the guaranteed minimum deduction (FAIL=6) is what actually
  // moves it: 76 - 6 = 70.
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('who', BASE).score === 70, 'WHO 70 (FAIL guaranteed deduction)');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('eu', BASE).score === 65, 'EU 65');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', BASE).score === 70, 'EPA 70 (FAIL guaranteed deduction — DO=5.3 below EPA\'s own floor)');
}

console.log('\nCatastrophic dilution (aggregation now a plain equal-weight mean — severity caps do the heavy lifting)');
{
  const one = th({ ...IDEAL, tds: 5000 });
  const two = th({ ...IDEAL, tds: 5000, turbidity: 50 });
  const three = th({ ...IDEAL, tds: 5000, turbidity: 50, chlorine: 10 });
  const all = th({ ph: 3, tds: 5000, turbidity: 50, orp: -100, chlorine: 10, do: 0, temp: 80 });
  assert(one.score === 60, `1 catastrophic → 60 (CRITICAL cap) (got ${one.score})`);
  // 2 and 3 catastrophic: raw average already below 60, so the ceiling
  // itself is a no-op, but the 2026-08-18 guaranteed minimum deduction
  // (COUNTRY_SEVERITY_MIN_DEDUCTION.CRITICAL=10) still always comes off:
  // raw 68 -> 58 (2 params), raw 53 -> 43 (3 params).
  assert(two.score === 58, `2 catastrophic → 58 (raw 68, cap no-op, guaranteed deduction) (got ${two.score})`);
  assert(three.score === 43, `3 catastrophic → 43 (raw 53, cap no-op, guaranteed deduction) (got ${three.score})`);
  // 2026-08-18 (PO-approved fix): raw average is 7, and the unconditional
  // guaranteed minimum deduction (score - 10) would go negative — a water
  // quality score below 0 is meaningless, so applyCountrySeverityProtection
  // floors the final score at 0.
  assert(all.score === 0, `all catastrophic → 0 (raw 7, CRITICAL deduction floored at 0, not negative) (got ${all.score})`);
}

console.log('\nCross-country matrix (recomputed against the shared-formula rebuild)');
{
  const LOCKED = { ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5, temp: 28 };
  const twoBad = { ...IDEAL, tds: 800, turbidity: 3.5 };
  const threeBad = { ...IDEAL, tds: 800, turbidity: 3.5, chlorine: 1.5 };
  const rows = [
    // 2026-08-18 (PO-approved): every engine's raw base is now the same
    // shared-formula number; divergence between th/jp/eu/who/epa below comes
    // only from each country's own classification/severity-cap/gate acting
    // on that shared number. Every value recomputed directly, not estimated.
    // 2026-08-18 (PO-approved, guaranteed minimum deduction added same day):
    // several jp/eu/who/epa cells below now also carry
    // COUNTRY_SEVERITY_MIN_DEDUCTION (WARNING=3 / FAIL=6 / CRITICAL=10),
    // which always comes off when that tier is the worst classification —
    // even when the raw shared-base number is already below the tier's
    // ceiling. Every value recomputed directly, not estimated.
    ['BASE', BASE, { th: 76, jp: 73, eu: 65, who: 70, epa: 70, q: 76 }],
    ['DIFF', DIFF, { th: 61, jp: 51, eu: 55, who: 51, epa: 51, q: 61 }],
    ['LOCKED', LOCKED, { th: 73, jp: 67, eu: 65, who: 60, epa: 60, q: 73 }],
    ['oneBadTDS', { ...IDEAL, tds: 800 }, { th: 90, jp: 60, eu: 75, who: 60, epa: 60, q: 90 }],
    ['oneBadTurb', { ...IDEAL, turbidity: 3.5 }, { th: 90, jp: 60, eu: 75, who: 60, epa: 60, q: 90 }],
    ['oneBadCl', { ...IDEAL, chlorine: 1.5 }, { th: 90, jp: 60, eu: 65, who: 60, epa: 90, q: 90 }],
    ['twoBad', twoBad, { th: 80, jp: 60, eu: 74, who: 60, epa: 60, q: 80 }],
    ['threeBad', threeBad, { th: 69, jp: 59, eu: 63, who: 59, epa: 59, q: 69 }]
  ];
  for (const [label, readings, exp] of rows) {
    const got = {
      th: sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', readings).score,
      jp: sandbox.WaterScoreBenchmarkRegistry.calculate('japan', readings).score,
      eu: sandbox.WaterScoreBenchmarkRegistry.calculate('eu', readings).score,
      who: sandbox.WaterScoreBenchmarkRegistry.calculate('who', readings).score,
      epa: sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', readings).score,
      q: sandbox.computeQualityScoreDetail(readings).score
    };
    for (const k of Object.keys(exp)) {
      assert(got[k] === exp[k], `${label} ${k}=${exp[k]} (got ${got[k]})`);
    }
  }
}

console.log('\nPhysical / impossible');
{
  const v = sandbox.MeasurementValidator.validateMeasurements({
    ph: 20, tds: -50, turbidity: -5, orp: 5000, do: 100, chlorine: -2, temp: 999
  });
  assert(v.status === 'INVALID', 'impossible → INVALID');
  const extreme = th({ ph: 3, tds: 5000, turbidity: 50, orp: -100, do: 0, chlorine: 10, temp: 80 });
  // 2026-08-18 (PO-approved): CRITICAL's guaranteed deduction floors at 0
  // rather than going negative (raw 7 - 10 would be -3).
  assert(extreme.score === 0, `extreme-valid TH 0 (floored, not negative) (got ${extreme.score})`);
  const notPerfect = th({ ph: 0.1, tds: 0, turbidity: 0, orp: -1999, chlorine: 0, do: 0, temp: 0 });
  assert(notPerfect.score < 100, `extreme-but-valid cannot be perfect (got ${notPerfect.score})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
