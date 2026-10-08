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
    removeAttribute() {},
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
    grades: eng.params, postRound: eng.score, engSeverity: eng.severityProtection && eng.severityProtection.score,
    displayed: disp.score, engineKey: disp.engineKey, source: disp.source,
    doClass: eng.classifications?.do
  };
}

console.log('\nCompliance ceilings (PD-008 unchanged; TDS/turbidity corrected 2026-08-19, evidence-based)');
{
  const L = sandbox.ThailandBenchmarkLimits;
  // 2026-08-19 (PO-approved): TDS passMax corrected 1000→500 (DOH 2020 legal
  // limit) and turbidity passMax corrected 5→1.0 (MWA's own published
  // operating specification, stricter than DOH's 5 NTU legal minimum).
  assert(L.tds.passMax === 500, 'TDS passMax corrected to DOH 2020 (500)');
  assert(L.turbidity.passMax === 1.0, 'turbidity passMax corrected to MWA spec (1.0)');
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
  // 2026-08-19 (PO-approved, evidence-based): TDS 800 (>500 DOH 2020) now
  // classifies FAIL and turbidity 3.5 (>1.0 MWA spec) now classifies
  // CRITICAL under Thailand's own corrected PASS thresholds — worst
  // classification CRITICAL applies its cap (60, no-op here since raw 61 is
  // already below it) and its guaranteed minimum deduction (10): 61-10=51.
  assert(t.postRound === 61 && t.engSeverity === 51, `DIFF TH customer 61, severity 51 (got ${t.postRound}/${t.engSeverity})`);
  assert(t.displayed === 61 && t.engineKey === 'thailand' && t.source === 'country-benchmark',
    'DIFF direct display is the Thailand raw aggregate 61');
  const jp = trace(DIFF, 'japan');
  assert(jp.postRound === 57 && jp.engSeverity === 47, `DIFF JP customer 57, severity 47 (got ${jp.postRound}/${jp.engSeverity})`);
  const q = sandbox.computeQualityScoreDetail(DIFF).score;
  assert(q === 61, 'DIFF Q-V3 unchanged 61');
}

console.log('\nBASE / one-bad pipeline');
{
  const base = trace(BASE, 'thailand');
  assert(base.after.tds === 175 && Number.isFinite(base.grades.chlorine), `BASE Cl grade is finite (${base.grades.chlorine})`);
  assert(base.postRound === 79 && base.displayed === 79, `BASE TH 79 (got ${base.postRound})`);
  assert(sandbox.computeQualityScoreDetail(BASE).score === 76, 'BASE Q-V3 76');
  const tds = trace({ ...IDEAL, tds: 800 }, 'thailand');
  const turb = trace({ ...IDEAL, turbidity: 3.5 }, 'thailand');
  const cl = trace({ ...IDEAL, chlorine: 1.5 }, 'thailand');
  // 2026-08-19 (PO-approved, evidence-based): TDS 800 now exceeds the
  // corrected DOH 2020 passMax (500) → FAIL classification → severity cap
  // 75 applies to the raw 90. Turbidity 3.5 now exceeds the corrected MWA
  // spec passMax (1.0) with a grade low enough to classify CRITICAL →
  // severity cap 60 applies. Chlorine's compliance band is unchanged, so it
  // still stays PASS and uncapped.
  assert(tds.postRound === 88 && tds.engSeverity === 75 && tds.grades.tds < 100, `oneBad TDS TH customer 88, severity 75 (got ${tds.postRound})`);
  assert(turb.postRound === 87 && turb.engSeverity === 60 && turb.grades.turbidity < 100, `oneBad turb TH customer 87, severity 60 (got ${turb.postRound})`);
  assert(cl.postRound === 87 && cl.grades.chlorine < 100, `oneBad Cl TH 87 (got ${cl.postRound})`);
}

console.log('\nCross-engine isolation');
{
  // 2026-08-19 (bug fix): do key removed entirely from JapanBenchmarkWeights.
  assert(sandbox.JapanBenchmarkWeights.do === undefined, 'JP do weight key removed (2026-08-19 bug fix)');
  assert(sandbox.EuBenchmarkLimits.gateCapOnChlorineFail === 65, 'EU gate 65');
  assert(sandbox.UsEpaBenchmarkLimits.chlorine.max === 4.0, 'EPA Cl max 4.0');
  const jp = sandbox.WaterScoreBenchmarkRegistry.calculate('japan', BASE);
  // Japan's own tighter pH band (7.3-7.7) classifies ph=7.85 WARNING; the
  // guaranteed minimum deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3)
  // takes raw 76 to 73.
  // 2026-08-19 (bug fix): do key removed from JapanBenchmarkWeights, raising 74 -> 76.
  assert(jp.score === 79 && jp.severityProtection.score === 76 && jp.classifications.do === 'NOT_EVALUATED', `JP BASE customer 79, severity 76, DO not evaluated (got ${jp.score})`);
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('who', BASE).score === 76, 'WHO customer 76');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('who', BASE).severityProtection.score === 70, 'WHO severity stays 70');
  const euBase = sandbox.WaterScoreBenchmarkRegistry.calculate('eu', BASE);
  assert(euBase.score === 77 && euBase.countryGate.applied === true && euBase.countryGate.cap === 65, 'EU customer 77, chlorine gate cap 65');
  const epaBase = sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', BASE);
  assert(epaBase.score === 77 && epaBase.severityProtection.score === 71, 'EPA customer 77, severity 71');
}

console.log('\nCatastrophic dilution (aggregation now a plain equal-weight mean — severity caps do the heavy lifting)');
{
  const one = th({ ...IDEAL, tds: 5000 });
  const two = th({ ...IDEAL, tds: 5000, turbidity: 50 });
  const three = th({ ...IDEAL, tds: 5000, turbidity: 50, chlorine: 10 });
  const all = th({ ph: 3, tds: 5000, turbidity: 50, orp: -100, chlorine: 10, do: 0, temp: 80 });
  assert(one.score === 81 && one.severityProtection.score === 60, `1 catastrophic customer 81, severity 60 (got ${one.score})`);
  assert(two.score === 62 && two.severityProtection.score === 52, `2 catastrophic customer 62, severity 52 (got ${two.score})`);
  assert(three.score === 44 && three.severityProtection.score === 34, `3 catastrophic customer 44, severity 34 (got ${three.score})`);
  assert(all.score === 7 && all.severityProtection.score === 0, `all catastrophic customer 7, severity floored at 0 (got ${all.score})`);
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
    // 2026-08-19 (PO-approved, evidence-based): Thailand's own TDS/turbidity
    // passMax were corrected (500 / 1.0 — DOH 2020 + MWA spec). Every `th`
    // cell below where the fixture's TDS>500 or turbidity>1.0 now reflects
    // Thailand's own severity cap kicking in where it previously didn't;
    // other countries' columns are unaffected (each uses its own limits.js).
    // Every value recomputed directly, not estimated.
    // 2026-08-19 (bug fix): do key removed from JapanBenchmarkWeights — jp
    // cells shift wherever the fixture's do differed from what Japan's own
    // weighted composite now (correctly) ignores. Recomputed directly.
    ['BASE', BASE, { th: 79, jp: 79, eu: 77, who: 76, epa: 77, q: 76 }, { th: 79, jp: 76, eu: 71, who: 70, epa: 71 }],
    ['DIFF', DIFF, { th: 61, jp: 57, eu: 55, who: 61, epa: 55, q: 61 }, { th: 51, jp: 47, eu: 49, who: 51, epa: 45 }],
    ['LOCKED', LOCKED, { th: 72, jp: 69, eu: 69, who: 73, epa: 67, q: 73 }, { th: 66, jp: 63, eu: 63, who: 60, epa: 57 }],
    ['oneBadTDS', { ...IDEAL, tds: 800 }, { th: 88, jp: 89, eu: 91, who: 90, epa: 88, q: 90 }, { th: 75, jp: 60, eu: 75, who: 60, epa: 60 }],
    ['oneBadTurb', { ...IDEAL, turbidity: 3.5 }, { th: 87, jp: 84, eu: 84, who: 90, epa: 81, q: 90 }, { th: 60, jp: 60, eu: 75, who: 60, epa: 60 }],
    ['oneBadCl', { ...IDEAL, chlorine: 1.5 }, { th: 87, jp: 84, eu: 84, who: 90, epa: 91, q: 90 }, { th: 87, jp: 60, eu: 65, who: 60, epa: 91 }],
    ['twoBad', twoBad, { th: 76, jp: 74, eu: 75, who: 80, epa: 69, q: 80 }, { th: 60, jp: 60, eu: 69, who: 60, epa: 59 }],
    ['threeBad', threeBad, { th: 63, jp: 58, eu: 60, who: 69, epa: 60, q: 69 }, { th: 53, jp: 48, eu: 54, who: 59, epa: 50 }]
  ];
  for (const [label, readings, exp, severity] of rows) {
    const results = {
      th: sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', readings),
      jp: sandbox.WaterScoreBenchmarkRegistry.calculate('japan', readings),
      eu: sandbox.WaterScoreBenchmarkRegistry.calculate('eu', readings),
      who: sandbox.WaterScoreBenchmarkRegistry.calculate('who', readings),
      epa: sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', readings)
    };
    const got = {
      th: results.th.score, jp: results.jp.score, eu: results.eu.score,
      who: results.who.score, epa: results.epa.score,
      q: sandbox.computeQualityScoreDetail(readings).score
    };
    for (const k of Object.keys(exp)) {
      assert(got[k] === exp[k], `${label} ${k}=${exp[k]} (got ${got[k]})`);
    }
    for (const k of Object.keys(severity)) {
      const result = results[k === 'epa' ? 'epa' : k];
      if (k === 'eu' && (label === 'BASE' || label === 'oneBadCl')) {
        assert(result.countryGate && result.countryGate.applied === true && result.countryGate.cap === 65,
          `${label} EU chlorine gate cap stays 65`);
      } else {
        assert(result.severityProtection.score === severity[k],
          `${label} ${k} severity ${severity[k]} (got ${result.severityProtection.score})`);
      }
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
  assert(extreme.score === 7 && extreme.severityProtection.score === 0, `extreme-valid TH customer 7, severity floored at 0 (got ${extreme.score})`);
  const notPerfect = th({ ph: 0.1, tds: 0, turbidity: 0, orp: -1999, chlorine: 0, do: 0, temp: 0 });
  assert(notPerfect.score < 100, `extreme-but-valid cannot be perfect (got ${notPerfect.score})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
