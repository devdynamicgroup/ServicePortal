/**
 * Thailand in-band severity grading — saturation repair.
 * Compliance passMax / Cl 0.2–2.0 unchanged; grade 100 uses existing inner plateaus.
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
  const W = sandbox.WaterScoreBenchmarkRegistry.get(country).weights;
  let num = 0; let den = 0;
  Object.keys(W).forEach((k) => {
    if (country === 'japan' && k === 'do') return;
    if (!Number.isFinite(eng.params?.[k])) return;
    num += eng.params[k] * W[k];
    den += W[k];
  });
  const disp = displayed(after, country);
  return {
    raw, mapped, after, validation: validation.status,
    grades: eng.params, weights: W, num, den,
    preRound: den > 0 ? num / den : null, postRound: eng.score,
    displayed: disp.score, engineKey: disp.engineKey, source: disp.source,
    doClass: eng.classifications?.do
  };
}

console.log('\nCompliance ceilings unchanged (PD-008 / TH-TDS / TH-TURB)');
{
  const L = sandbox.ThailandBenchmarkLimits;
  assert(L.tds.passMax === 1000, 'TDS passMax still 1000');
  assert(L.turbidity.passMax === 5, 'turbidity passMax still 5');
  assert(L.chlorine.min === 0.2 && L.chlorine.max === 2.0, 'Cl compliance band still 0.2–2.0');
  assert(L.tds.gradeExcellentMax === 80, 'TDS excellentMax 80 (PD-015)');
  assert(L.tds.goodMax === 150 && L.tds.ordinaryMax === 300, 'TDS piecewise ordinary band');
  assert(L.tds.passEdgeGrade === 40, 'TDS passEdge 40');
  assert(L.turbidity.gradeExcellentMax === 0.3, 'turbidity excellentMax 0.3 (PD-015)');
  assert(L.turbidity.ordinaryMax === 1 && L.turbidity.ordinaryGrade === 70, 'turb ordinary 1 NTU → 70');
  assert(L.weakestLinkShare === 0.25, 'weakest-link share 0.25');
  assert(L.chlorine.citedSurveillanceResidual.max === 0.5, 'Cl inner uses cited residual 0.5');
  assert(L.ph.min === 6.5 && L.ph.max === 8.5, 'pH compliance band unchanged');
  assert(L.ph.preferredMin === 6.8 && L.ph.preferredMax === 7.8, 'pH preferred 6.8–7.8 (PD-015)');
  assert(L.orp.min === 200 && L.orp.max === 600, 'ORP shared band unchanged');
}

console.log('\nDO remains NOT_EVALUATED');
{
  const r = th(BASE);
  assert(r.classifications.do === 'NOT_EVALUATED', 'DO NOT_EVALUATED');
  assert(r.params.do === undefined, 'DO not graded');
  assert(sandbox.ThailandBenchmarkWeights.do === undefined, 'DO not in weights');
}

console.log('\nTDS severity (others ideal)');
{
  const rows = [80, 100, 200, 300, 500, 800, 1000, 1500, 5000].map((v) => {
    const r = th({ ...IDEAL, tds: v });
    return { v, g: r.params.tds, s: r.score };
  });
  assert(rows[0].g === 100, 'TDS ≤80 grade 100 (PD-015 excellentMax)');
  assert(rows[3].g < 100, 'TDS 300 leaves excellent band under PD-015');
  assert(rows[5].g < rows[4].g && rows[4].g < 100, 'TDS 500→800 grade declines');
  assert(rows[5].s < 100 && rows[5].s < rows[0].s, 'TDS 800 final < 100');
  assert(rows[6].g === 40, 'TDS 1000 at passMax grade 40 (100-60)');
  assert(rows[8].g === 0 && rows[8].s === 60, 'TDS 5000 grade 0 → composite 60 (weakest-link)');
  let prev = rows[0].g;
  for (const row of rows.slice(1)) {
    assert(row.g <= prev + 1e-9, `TDS ${row.v} grade ${row.g} not reversed vs ${prev}`);
    prev = row.g;
  }
}

console.log('\nTurbidity severity (others ideal)');
{
  const rows = [0.05, 0.1, 0.2, 0.5, 1, 2, 3.5, 5, 10].map((v) => {
    const r = th({ ...IDEAL, turbidity: v });
    return { v, g: r.params.turbidity, s: r.score };
  });
  assert(rows[0].g === 100 && rows[2].g === 100, 'turb ≤0.3 grade 100 (PD-015)');
  assert(rows[4].g < 100, 'turb 1 leaves excellent band under PD-015');
  assert(Math.round(rows[6].g) === 58 && rows[6].s < 100, 'turb 3.5 grade ~58, score < 100');
  assert(rows[7].g === 50, 'turb 5 at passMax grade 50 (100-50)');
  let prev = rows[2].g;
  for (const row of rows.slice(3)) {
    assert(row.g <= prev + 1e-9, `turb ${row.v} not reversed`);
    prev = row.g;
  }
}

console.log('\nChlorine severity (others ideal)');
{
  const rows = [0, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5].map((v) => {
    const r = th({ ...IDEAL, chlorine: v });
    return { v, g: r.params.chlorine, s: r.score };
  });
  assert(rows[2].g === 100 && rows[4].g === 100, 'Cl 0.2–0.5 grade 100');
  assert(Math.round(rows[5].g) === 91 && rows[5].s === 96, 'Cl 0.7 inside compliance, grade ~91');
  assert(Math.round(rows[7].g) === 74 && rows[7].s === 90, 'Cl 1.5 grade ~74');
  assert(rows[8].g === 70, 'Cl 2.0 at max grade 70');
  assert(rows[5].g > rows[7].g && rows[7].g > rows[9].g, 'Cl high-side monotonically worse');
}

console.log('\nDIFF pipeline retrace (RAW === engine input)');
{
  const t = trace(DIFF, 'thailand');
  assert(t.after.tds === 800 && t.after.turbidity === 3.5 && t.after.chlorine === 1.5,
    'DIFF engine input equals raw');
  assert(t.grades.tds < 100 && t.grades.turbidity < 100 && t.grades.chlorine < 100,
    'DIFF TH TDS/turb/Cl grades leave 100');
  assert(t.grades.ph === 100 && t.grades.orp === 100, 'DIFF TH pH/ORP still 100');
  assert(t.postRound === 69, `DIFF TH score 69 (got ${t.postRound})`);
  assert(t.displayed === 69 && t.engineKey === 'thailand' && t.source === 'country-benchmark',
    'DIFF Hero = Thailand 69');
  const jp = trace(DIFF, 'japan');
  // Country severity protection (2026-08-14): DIFF's TDS/Cl are FAIL on
  // Japan, now capped at 75 (was 78 uncapped).
  assert(jp.postRound === 75 && jp.displayed === 75, 'DIFF JP capped 75 (TDS/Cl FAIL)');
  const q = sandbox.computeQualityScoreDetail(DIFF).score;
  assert(q === 61, 'DIFF Q-V3 unchanged 61');
}

console.log('\nBASE / one-bad pipeline');
{
  const base = trace(BASE, 'thailand');
  assert(base.after.tds === 175 && Math.round(base.grades.chlorine) === 91, 'BASE Cl 0.7 grades ~91 (not 100)');
  assert(base.postRound === 86 && base.displayed === 86, 'BASE TH 86');
  assert(sandbox.computeQualityScoreDetail(BASE).score === 76, 'BASE Q-V3 76');
  const tds = trace({ ...IDEAL, tds: 800 }, 'thailand');
  const turb = trace({ ...IDEAL, turbidity: 3.5 }, 'thailand');
  const cl = trace({ ...IDEAL, chlorine: 1.5 }, 'thailand');
  assert(tds.postRound === 79 && tds.grades.tds < 100, 'oneBad TDS TH 79');
  assert(turb.postRound === 83 && turb.grades.turbidity < 100, 'oneBad turb TH 83');
  assert(cl.postRound === 90 && cl.grades.chlorine < 100, 'oneBad Cl TH 90');
}

console.log('\nCross-engine isolation');
{
  assert(sandbox.JapanBenchmarkWeights.do === 0.12, 'JP do weight 0.12');
  assert(sandbox.EuBenchmarkLimits.gateCapOnChlorineFail === 65, 'EU gate 65');
  assert(sandbox.UsEpaBenchmarkLimits.chlorine.max === 4.0, 'EPA Cl max 4.0');
  const jp = sandbox.WaterScoreBenchmarkRegistry.calculate('japan', BASE);
  // PD-014 D1 (2026-08-14): orp=515 now inner-declines on every engine.
  assert(jp.score === 98 && jp.classifications.do === 'NOT_EVALUATED', 'JP BASE 98 / DO NE');
  // WARNING severity cap=85 (2026-08-14, PO-approved): BASE's worst classification
  // on WHO/EPA is WARNING (chlorine=0.7 WHO tier / do=5.3), now capped 85 (was 93/98).
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('who', BASE).score === 85, 'WHO 85 (WARNING cap)');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('eu', BASE).score === 65, 'EU 65');
  assert(sandbox.WaterScoreBenchmarkRegistry.calculate('usEpa', BASE).score === 85, 'EPA 85 (WARNING cap)');
}

console.log('\npH (unchanged flat in-band) / ORP (PD-014 D1, 2026-08-14 — inner severity)');
{
  const phRows = [6.0, 6.5, 7.0, 7.2, 7.5, 8.0, 8.5, 9, 10].map((v) => th({ ...IDEAL, ph: v }));
  assert(phRows[1].params.ph === 70 && phRows[6].params.ph === 70, 'pH 6.5/8.5 grade edgeGrade 70');
  assert(phRows[3].params.ph === 100, 'pH inside preferred still 100');
  assert(phRows[0].params.ph < 100 && phRows[7].params.ph < 100, 'pH outside band declines');
  const orpRows = [100, 200, 300, 350, 400, 500, 600, 700, 900].map((v) => th({ ...IDEAL, orp: v }));
  assert(orpRows[1].params.orp === 70 && orpRows[6].params.orp === 70, 'ORP 200/600 now grade 70 (D1 inner-ramp edges)');
  assert(orpRows[4].params.orp === 100, 'ORP 400 still grade 100 (inner plateau center)');
  assert(orpRows[0].params.orp < 100 && orpRows[7].params.orp < 100, 'ORP outside band declines');
}

console.log('\nCatastrophic dilution (aggregation unchanged — known limitation)');
{
  const one = th({ ...IDEAL, tds: 5000 });
  const two = th({ ...IDEAL, tds: 5000, turbidity: 50 });
  const three = th({ ...IDEAL, tds: 5000, turbidity: 50, chlorine: 10 });
  const all = th({ ph: 3, tds: 5000, turbidity: 50, orp: -100, chlorine: 10, do: 0, temp: 80 });
  assert(one.params.tds === 0 && one.score === 60, '1 catastrophic → 60 (weakest-link)');
  assert(two.score === 45, '2 catastrophic → 45');
  assert(three.score === 30, '3 catastrophic → 30');
  assert(all.score === 0, 'all catastrophic → 0');
}

console.log('\nCross-country matrix (JP/EU/WHO/EPA/Q-V3 frozen)');
{
  const LOCKED = { ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5, temp: 28 };
  const twoBad = { ...IDEAL, tds: 800, turbidity: 3.5 };
  const threeBad = { ...IDEAL, tds: 800, turbidity: 3.5, chlorine: 1.5 };
  const rows = [
    // PD-014 D1/D2 (2026-08-14): BASE/DIFF/threeBad move — BASE's orp=515
    // and DIFF/threeBad's chlorine=1.5 (EPA only) now decline instead of
    // flat 100. Rows using IDEAL orp=400 (inside the D1 plateau) are
    // unaffected; oneBadCl's chlorine=1.5 EPA drop is too small to move the
    // rounded composite off 99, confirmed by direct computation.
    //
    // Country severity protection (2026-08-14, JP/WHO/EPA only): any row
    // whose worst classification on that engine is FAIL/CRITICAL is capped
    // at 75/60, and (2026-08-14, PO-approved numeric) WARNING is capped at
    // 85. EU (its own PD-002 gate) and Thailand (PD-015) are out of scope
    // and unaffected — values below verified unchanged for both.
    // Recomputed directly against current code, not estimated.
    ['BASE', BASE, { th: 86, jp: 98, eu: 65, who: 85, epa: 85, q: 76 }],
    ['DIFF', DIFF, { th: 69, jp: 75, eu: 61, who: 75, epa: 75, q: 61 }],
    ['LOCKED', LOCKED, { th: 77, jp: 85, eu: 65, who: 85, epa: 75, q: 73 }],
    ['oneBadTDS', { ...IDEAL, tds: 800 }, { th: 79, jp: 75, eu: 93, who: 75, epa: 75, q: 90 }],
    ['oneBadTurb', { ...IDEAL, turbidity: 3.5 }, { th: 83, jp: 85, eu: 89, who: 85, epa: 75, q: 90 }],
    ['oneBadCl', { ...IDEAL, chlorine: 1.5 }, { th: 90, jp: 75, eu: 65, who: 75, epa: 99, q: 90 }],
    ['twoBad', twoBad, { th: 73, jp: 75, eu: 82, who: 75, epa: 75, q: 80 }],
    ['threeBad', threeBad, { th: 69, jp: 75, eu: 62, who: 75, epa: 75, q: 69 }]
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
  assert(extreme.score === 0, `extreme-valid TH 0 (got ${extreme.score})`);
  const notPerfect = th({ ph: 0.1, tds: 0, turbidity: 0, orp: -1999, chlorine: 0, do: 0, temp: 0 });
  assert(notPerfect.score < 100, `extreme-but-valid cannot be perfect (got ${notPerfect.score})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
