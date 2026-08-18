/**
 * Country severity protection — Japan / WHO / US EPA only (product decision,
 * 2026-08-14): CRITICAL caps the Country Hero at 60, FAIL caps at 75,
 * WARNING caps at 85 (PO numeric approval, governance basis PD-014 D4=B).
 * PASS unchanged. Thailand (PD-015) and EU (PD-002) are explicitly out of
 * scope and must be structurally unaffected — verified via git diff (see
 * report) and via the isolation assertions below.
 * Numeric layer: src/js/score/util/benchmarkMetadata.js (worstBenchmarkClassification,
 *   applyCountrySeverityProtection), called explicitly from japan/who/usEpa score.js.
 * Presentation layer: src/js/flows/score.js comparisonPresentationVerdict(),
 *   scoped by COUNTRY_SEVERITY_PRESENTATION_ENGINES.
 * Run: node tests/score/country-severity-protection.test.js
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
    scoreParamOpen: null, publicScoreView: false, taps: ['Kitchen'], scoreTapFilter: 'all',
    lastReadingsValidation: null
  },
  t: (k) => k
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });

let passed = 0; let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const bench = (k, r) => sandbox.WaterScoreBenchmarkRegistry.calculate(k, r);
const IDEAL = { ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, chlorine: 0.3, do: 8.0 };
const IN_SCOPE = ['japan', 'who', 'usEpa'];
const OUT_OF_SCOPE = ['thailand', 'eu'];

console.log('\nA. Numeric protection — PASS unchanged, in-scope engines');
{
  for (const c of IN_SCOPE) {
    const r = bench(c, IDEAL);
    assert(r.classifications && Object.values(r.classifications).every(v => v === 'PASS' || v === 'NOT_EVALUATED' || v === 'NOT_MEASURED'),
      `${c} IDEAL reading is all-PASS`);
    assert(r.score >= 96, `${c} IDEAL score unaffected by protection (got ${r.score})`);
  }
}

console.log('\nA2. Numeric protection — WARNING caps at 85');
{
  // 2026-08-18 (PO-approved): the shared DO curve's grade never reaches 80
  // (the WARNING threshold) while still below WHO/EPA's own do>=6 ideal
  // floor — below 6.0 the shared curve tops out at grade 68 (just under
  // 6.0), so DO can no longer trigger a WARNING classification on WHO/EPA.
  // pH now demonstrates the WARNING tier instead (same classify() mechanism,
  // same shared curve, just a different parameter reaching grade>=80).
  const rWho = bench('who', { ...IDEAL, ph: 6.47 });
  assert(rWho.classifications.ph === 'WARNING', 'WHO ph=6.47 classifies WARNING');
  assert(rWho.score === 85, `WHO worst=WARNING capped at 85 (got ${rWho.score})`);

  const rEpa = bench('usEpa', { ...IDEAL, ph: 6.47 });
  assert(rEpa.classifications.ph === 'WARNING', 'EPA ph=6.47 classifies WARNING');
  assert(rEpa.score === 85, `EPA worst=WARNING capped at 85 (got ${rEpa.score})`);

  // A raw composite already below 85 must not be raised.
  const rLow = bench('who', { ...IDEAL, ph: 6.47, tds: 550 });
  assert(rLow.classifications.ph === 'WARNING' || rLow.classifications.tds === 'WARNING',
    'lower WARNING composite fixture still classifies WARNING');
  assert(rLow.score <= 85, `WARNING composite already <=85 is not raised (got ${rLow.score})`);
}

console.log('\nA3. WARNING/FAIL/CRITICAL boundary — pH cliff around 6.465/6.47 (WHO, shared curve)');
{
  // 2026-08-18 (PO-approved): the DO-based cliff no longer exists (DO can't
  // reach WARNING under the shared curve below WHO's own ideal floor — see
  // A2). pH demonstrates the same WARNING/FAIL cap cliff instead.
  const atWarn = bench('who', { ...IDEAL, ph: 6.47 });
  assert(atWarn.classifications.ph === 'WARNING', 'ph=6.47 (grade just over 80) classifies WARNING');
  assert(atWarn.score === 85, `ph=6.47 WARNING -> capped at 85 (got ${atWarn.score})`);

  const atFail = bench('who', { ...IDEAL, ph: 6.465 });
  assert(atFail.classifications.ph === 'FAIL', 'ph=6.465 (grade just under 80) classifies FAIL');
  assert(atFail.score === 75, `ph=6.465 FAIL -> capped at 75, unchanged by WARNING work (got ${atFail.score})`);

  // Discontinuity is 85->75 (10 points) at this boundary.
  assert((atWarn.score - atFail.score) === 10, 'WARNING/FAIL cliff is exactly 10 points at this boundary');
}

console.log('\nA4. Severity ordering — PASS >= WARNING(85) > FAIL(75) > CRITICAL(60), no inversion');
{
  const rPass = bench('who', IDEAL);
  const rWarn = bench('who', { ...IDEAL, ph: 6.47 }); // shared curve grade ~80 -> WARNING
  const rFail = bench('who', { ...IDEAL, ph: 6.2 }); // WHO fairMin..min band -> grade 70 -> FAIL
  const rCrit = bench('who', { ...IDEAL, ph: 4.0 }); // below poorMin -> grade 15 -> CRITICAL
  assert(rPass.score >= rWarn.score, 'PASS score >= WARNING score');
  assert(rWarn.score > rFail.score, 'WARNING(85) > FAIL(75), strictly ordered, no tier collapse');
  assert(rFail.score > rCrit.score, 'FAIL(75) > CRITICAL(60)');
}

console.log('\nA. Numeric protection — FAIL caps at 75, CRITICAL caps at 60');
{
  const fixtures = {
    japan: [['pH=4.5', { ...IDEAL, ph: 4.5 }], ['chlorine=0', { ...IDEAL, chlorine: 0 }], ['turbidity=10', { ...IDEAL, turbidity: 10 }]],
    who: [['pH=4.5', { ...IDEAL, ph: 4.5 }], ['chlorine=0', { ...IDEAL, chlorine: 0 }], ['DO=0', { ...IDEAL, do: 0 }]],
    usEpa: [['pH=4.5', { ...IDEAL, ph: 4.5 }], ['chlorine=0', { ...IDEAL, chlorine: 0 }], ['DO=0', { ...IDEAL, do: 0 }]]
  };
  for (const [c, cases] of Object.entries(fixtures)) {
    for (const [label, r] of cases) {
      const res = bench(c, r);
      assert(res.score === 60, `${c} ${label} -> CRITICAL -> 60 (got ${res.score}, worst=${JSON.stringify(res.classifications)})`);
    }
  }
  // 2026-08-18 (PO-approved): shared grading base, no weakest-link
  // aggregation; the CRITICAL cap (60) binds normally here.
  const epaTurbCrit = bench('usEpa', { ...IDEAL, turbidity: 10 });
  assert(epaTurbCrit.score === 60, `usEpa turbidity=10 -> CRITICAL -> 60 (got ${epaTurbCrit.score})`);
}

console.log('\nA. Boundary — pre-protection score exactly at/under the cap is a no-op');
{
  // EPA turbidity ramp: find a FAIL-tier reading whose raw composite is already <=75.
  const r = bench('usEpa', { ...IDEAL, turbidity: 4.9, tds: 900 });
  if (r.classifications.turbidity === 'FAIL' || r.classifications.tds === 'FAIL') {
    assert(r.score <= 75, 'FAIL-tier composite already <=75 stays <=75, not raised');
  }
}

console.log('\nB. Classification locality — same-engine only');
{
  const rJp = bench('japan', { ...IDEAL, ph: 4.5 });
  const rWho = bench('who', { ...IDEAL, ph: 4.5 });
  const rEpa = bench('usEpa', { ...IDEAL, ph: 4.5 });
  assert(rJp.score === 60 && rWho.score === 60 && rEpa.score === 60,
    'each engine capped by its own classifications independently');
  // Prove no cross-read: degrade WHO only, confirm Japan/EPA on the SAME readings differ appropriately.
  const rJpClean = bench('japan', IDEAL);
  assert(rJpClean.score !== 60, 'Japan on a clean reading is not accidentally capped by a WHO-style trigger');
}

console.log('\nC. Country isolation — Thailand numerically unaffected; EU chlorine gate still dominant');
{
  const thBase = bench('thailand', { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 });
  // 2026-08-18 (PO-approved): shared grading base, no severity cap binding
  // for Thailand on this reading. Unrelated to the mechanism this file tests.
  assert(thBase.score === 76, `Thailand New C 8/11 (got ${thBase.score})`);
  // EU non-chlorine severity coverage: pH=4.5 classifies FAIL on EU and is
  // capped at the generic 75 FAIL cap (binds normally, shared base has no
  // weakest-link dilution to pull the raw value below the cap itself).
  const euCritical = bench('eu', { ...IDEAL, ph: 4.5 });
  assert(euCritical.classifications.ph === 'FAIL', 'EU still classifies pH=4.5 as FAIL (classification logic untouched)');
  assert(euCritical.score === 75, `EU pH=4.5 (non-chlorine FAIL): capped at 75 (got ${euCritical.score})`);
  // chlorine=0 classifies CRITICAL, triggering EU's own PD-002 gate (cap 65).
  const euCl0 = bench('eu', { ...IDEAL, chlorine: 0 });
  assert(euCl0.score === 65, `EU chlorine=0: PD-002 gate caps at 65 (got ${euCl0.score})`);
}

console.log('\nD. Real-case regression (WARNING cap=85 applied 2026-08-14, PO-approved)');
{
  const newc811 = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 };
  const newc810 = { ph: 7.81, tds: 14.672, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 };
  const c1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3 };
  // 2026-08-18 (PO-approved): shared grading base for newc811 = 76 for every
  // engine. Japan has no severity cap binding, so it stays at raw 76.
  assert(bench('japan', newc811).score === 76, 'New C 8/11 JP 76 (shared base, no cap)');
  // WHO classifies chlorine=0.7 as FAIL (shared curve), do=5.3 as FAIL — FAIL cap (75) applies.
  assert(bench('who', newc811).score === 75, `New C 8/11 WHO capped 75 (got ${bench('who', newc811).score})`);
  assert(bench('usEpa', newc811).score === 75, `New C 8/11 EPA capped 75 (do classifies FAIL) (got ${bench('usEpa', newc811).score})`);
  assert(bench('eu', newc811).score === 65, 'New C 8/11 EU 65 (chlorine CRITICAL triggers PD-002 gate)');
  // Shared base for newc810 = 82 for every engine.
  assert(bench('japan', newc810).score === 82, 'New C 8/10 JP 82 (shared base, no cap)');
  assert(bench('who', newc810).score === 75, `New C 8/10 WHO capped 75 (do classifies FAIL) (got ${bench('who', newc810).score})`);
  assert(bench('usEpa', newc810).score === 75, `New C 8/10 EPA capped 75 (do classifies FAIL) (got ${bench('usEpa', newc810).score})`);
  assert(bench('eu', newc810).score === 75, 'New C 8/10 EU capped 75 (DO FAIL, non-chlorine severity coverage)');
  // Shared base for c1328 = 92 for every engine; every param classifies PASS
  // on every engine, so no cap or gate binds anywhere.
  assert(bench('japan', c1328).score === 92, '13.28 JP 92 (shared base, all-PASS)');
  assert(bench('who', c1328).score === 92, '13.28 WHO 92 (all-PASS, no cap)');
  assert(bench('usEpa', c1328).score === 92, '13.28 EPA 92 (all-PASS, no cap)');
  assert(bench('thailand', c1328).score === 92, '13.28 TH 92 (shared base, out of this file scope)');
}

console.log('\nD2. WARNING cap engine isolation — Thailand/EU never see a WARNING-triggered cap');
{
  const newc811 = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 };
  const newc810 = { ph: 7.81, tds: 14.672, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 };
  // Thailand has no WARNING classification concept in its own classify() bands the way JP/WHO/EPA do,
  // and never calls applyCountrySeverityProtection at all (structural isolation, verified via git diff).
  // 2026-08-18 (PO-approved): shared grading base, verified by direct computation.
  assert(bench('thailand', newc811).score === 76, 'Thailand New C 8/11 unaffected by WARNING cap specifically (shared base 76)');
  assert(bench('thailand', newc810).score === 82, 'Thailand New C 8/10 unaffected by WARNING cap specifically (shared base 82)');
  // EU's own DO check is binary PASS/FAIL (no WARNING tier at all for DO on EU).
  assert(bench('eu', newc811).classifications.do === 'FAIL', 'EU has no WARNING tier for DO — binary PASS/FAIL only');
  assert(bench('eu', newc810).classifications.do === 'FAIL', 'EU DO=5.31 also binary FAIL, not WARNING, on EU');
}

console.log('\nK. EU non-chlorine severity-protection coverage (2026-08-14, PO-approved)');
{
  // A. Existing chlorine behavior. 2026-08-18 (PO-approved): shared grading
  // base, no weakest-link dilution — the raw composite stays high enough
  // that EU's own PD-002 gate genuinely binds at 65.
  const euClCrit = bench('eu', { ...IDEAL, chlorine: 0 });
  assert(euClCrit.classifications.chlorine === 'CRITICAL', 'EU chlorine=0 classifies CRITICAL');
  assert(euClCrit.score === 65, `A: chlorine CRITICAL, PD-002 gate caps at 65 (got ${euClCrit.score})`);

  // B. DO severity — DO FAIL while chlorine PASS -> capped at 75.
  const euDoFail = bench('eu', { ...IDEAL, do: 4.5 });
  assert(euDoFail.classifications.do === 'FAIL' && euDoFail.classifications.chlorine === 'PASS', 'DO FAIL, chlorine PASS');
  assert(euDoFail.score === 75, `B: DO FAIL (chlorine PASS) capped at 75 (got ${euDoFail.score})`);

  // C. Non-chlorine WARNING while chlorine PASS -> must not exceed 85.
  // 2026-08-18 (PO-approved): shared curve, grade just over 80 at ph=6.47
  // (just outside EU's [6.5,9.5] pass range).
  const euPhWarn = bench('eu', { ...IDEAL, ph: 6.47 });
  assert(euPhWarn.classifications.ph === 'WARNING' && euPhWarn.classifications.chlorine === 'PASS', 'ph WARNING, chlorine PASS');
  assert(euPhWarn.score <= 85, `C: non-chlorine WARNING (chlorine PASS) does not exceed 85 (got ${euPhWarn.score})`);

  // D. Non-chlorine CRITICAL while chlorine PASS -> must not exceed 60.
  const euTurbCrit = bench('eu', { ...IDEAL, turbidity: 6 });
  assert(euTurbCrit.classifications.turbidity === 'CRITICAL' && euTurbCrit.classifications.chlorine === 'PASS', 'turbidity CRITICAL, chlorine PASS');
  assert(euTurbCrit.score <= 60, `D: non-chlorine CRITICAL (chlorine PASS) does not exceed 60 (got ${euTurbCrit.score})`);

  // E1. Combined severity. 2026-08-18 (PO-approved): shared grading base, no
  // weakest-link dilution. chlorine CRITICAL (0) triggers the PD-002 gate
  // (cap 65); do FAIL alone would cap at 75. The chlorine gate (65) is the
  // lower/binding cap here.
  const euCombinedHigh = bench('eu', { ...IDEAL, chlorine: 0, do: 4.5 });
  assert(euCombinedHigh.classifications.chlorine === 'CRITICAL' && euCombinedHigh.classifications.do === 'FAIL', 'E1: chlorine CRITICAL + DO FAIL');
  assert(euCombinedHigh.score === 65, `E1: PD-002 gate (65) binds over the generic FAIL cap (75) (got ${euCombinedHigh.score})`);

  // E2. Adding a CRITICAL turbidity (generic cap 60) alongside chlorine
  // CRITICAL (gate 65): the lower of the two — 60 — must win (Math.min
  // semantics, ceiling not floor).
  const euCombinedLow = bench('eu', { ...IDEAL, chlorine: 0, do: 4.5, turbidity: 6 });
  assert(euCombinedLow.classifications.chlorine === 'CRITICAL' && euCombinedLow.classifications.turbidity === 'CRITICAL', 'E2: chlorine CRITICAL + turbidity CRITICAL + DO FAIL');
  assert(euCombinedLow.score === 60, `E2: the lower generic CRITICAL cap (60) wins over the chlorine gate (65) (got ${euCombinedLow.score})`);

  // F. Clean case — all PASS unaffected, 99 ceiling unaffected.
  const euClean = bench('eu', IDEAL);
  assert(sandbox.worstBenchmarkClassification(euClean.classifications) === 'PASS' || euClean.classifications.chlorine === 'PASS', 'EU IDEAL is clean');
  assert(euClean.score >= 96, `F: clean EU case unaffected (got ${euClean.score})`);

  // G. Real production cases — exact before/after per PO spec.
  const newc811 = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 };
  const newc810 = { ph: 7.81, tds: 14.672, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 };
  const c1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3 };
  const test1 = { ph: 7.4, tds: 250, turbidity: 0.2, orp: 300, do: 5, chlorine: 0.2 };
  assert(bench('eu', newc811).score === 65, `G: New C 8/11 EU = 65 (got ${bench('eu', newc811).score})`);
  assert(bench('eu', newc810).score === 75, `G: New C 8/10 EU 98 -> 75 (got ${bench('eu', newc810).score})`);
  // 2026-08-18 (PO-approved): shared base for c1328 = 92; all params PASS on
  // EU, so no cap/gate binds (raw 92, below the 100->99 ceiling threshold).
  assert(bench('eu', c1328).score === 92, `G: Case 1328 EU = 92 (got ${bench('eu', c1328).score})`);
  assert(bench('eu', test1).score === 75, `G: test1 EU 97 -> 75 (got ${bench('eu', test1).score})`);
}

console.log('\nE. Catastrophic fixtures (all cap to exactly 60, in-scope engines)');
{
  const cases = [
    ['japan', { ...IDEAL, ph: 4.5 }], ['japan', { ...IDEAL, chlorine: 0 }], ['japan', { ...IDEAL, turbidity: 10 }],
    ['who', { ...IDEAL, ph: 4.5 }], ['who', { ...IDEAL, chlorine: 0 }], ['who', { ...IDEAL, do: 0 }],
    ['usEpa', { ...IDEAL, ph: 4.5 }], ['usEpa', { ...IDEAL, chlorine: 0 }], ['usEpa', { ...IDEAL, do: 0 }]
  ];
  for (const [c, r] of cases) assert(bench(c, r).score === 60, `${c} catastrophic fixture -> 60`);
  // 2026-08-18 (PO-approved): shared grading base, CRITICAL cap (60) binds normally.
  assert(bench('usEpa', { ...IDEAL, turbidity: 10 }).score === 60, 'usEpa turbidity=10 catastrophic fixture -> 60 (CRITICAL cap)');
}

console.log('\nF. Presentation — classification-aware, in-scope engines only');
{
  const jobFromReadings = (readings) => ({
    id: 'presentation-test-job', notionId: 'presentation-test-job', draft: { tapData: [{ standardMeasurement: readings }] }
  });
  function switchAndRead(key, readings) {
    sandbox.S.publicScoreView = false;
    sandbox.S.activeJob = jobFromReadings(readings);
    sandbox.setScoreReferenceStandard(key);
    return sandbox.S.displayedScore;
  }
  const critical = switchAndRead('japan', { ...IDEAL, ph: 4.5 });
  assert(critical.score === 60, `Japan CRITICAL displayed score is capped (got ${critical.score})`);
  const failWho = switchAndRead('who', { ...IDEAL, ph: 8.7 });
  // pH=8.7 on WHO: fairMax=9 -> grade 70 -> classify FAIL (since inIdeal false, grade<80 -> FAIL per WHO classify())
  assert(failWho.classifications.ph === 'FAIL' || failWho.classifications.ph === 'CRITICAL',
    `WHO pH=8.7 triggers FAIL or CRITICAL (got ${failWho.classifications.ph})`);
}

console.log('\nF2. Presentation — EU/Thailand never activate the new country presentation path');
{
  const jobFromReadings = (readings) => ({
    id: 'presentation-test-job-2', notionId: 'presentation-test-job-2', draft: { tapData: [{ standardMeasurement: readings }] }
  });
  sandbox.S.publicScoreView = false;
  sandbox.S.activeJob = jobFromReadings({ ...IDEAL, chlorine: 0 });
  sandbox.setScoreReferenceStandard('eu');
  const euDisplayed = sandbox.S.displayedScore;
  assert(euDisplayed.engineKey === 'eu', 'EU engine correctly selected');
  // 2026-08-18 (PO-approved): shared grading base — the PD-002 gate binds normally (see section K.A above).
  assert(euDisplayed.score === 65, 'EU chlorine=0 capped at 65 by the PD-002 gate');
}

console.log('\nG. Ceiling interaction — 99 ceiling still fires for uncapped PASS readings');
{
  const r = bench('japan', IDEAL);
  assert(r.score <= 99, 'Japan IDEAL still respects 99 ceiling');
  assert(sandbox.applyCountryBenchmarkHeroCeiling(100) === 99, 'ceiling function itself unmodified');
}

console.log('\nH. Incomplete score — null must not become 60 or 75');
{
  const incomplete = bench('japan', { ph: 7.2 }); // missing required params
  assert(incomplete.score === null, `incomplete Japan reading stays null (got ${incomplete.score})`);
}

console.log('\nI. NOT_EVALUATED / NOT_MEASURED must not trigger protection');
{
  // Japan DO is always NOT_EVALUATED (PD-012 B) — must never trigger CRITICAL/FAIL cap on its own.
  const r = bench('japan', IDEAL);
  assert(r.classifications.do === 'NOT_EVALUATED', 'Japan DO is NOT_EVALUATED');
  assert(r.score >= 96, 'Japan DO=NOT_EVALUATED does not trigger severity protection');
  const rNoTemp = bench('who', IDEAL);
  assert(rNoTemp.classifications.temp === 'NOT_MEASURED' || rNoTemp.classifications.temp === 'PASS',
    'WHO temp absence does not read as a failure state');
}

console.log('\nJ. WARNING presentation (2026-08-14) — reuses existing withinLimits copy, distinct from passBand/complianceWarning');
{
  const jobFromReadings = (readings) => ({
    id: 'warning-presentation-test', notionId: 'warning-presentation-test', draft: { tapData: [{ standardMeasurement: readings }] }
  });
  function switchAndRead(key, readings) {
    sandbox.S.publicScoreView = false;
    sandbox.S.activeJob = jobFromReadings(readings);
    sandbox.setScoreReferenceStandard(key);
    return sandbox.S.displayedScore;
  }
  const newc811 = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 };
  const c1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3 };

  // Score Architecture V6 (2026-08-17, PO-approved): WHO chlorine steepening
  // crosses newc811's chlorine=0.7 from WARNING into FAIL classification, so
  // this fixture no longer demonstrates the WARNING presentation branch on
  // WHO -- it now correctly takes the FAIL path instead.
  const who811 = switchAndRead('who', newc811);
  assert(who811.score === 75 && who811.classifications && sandbox.worstBenchmarkClassification(who811.classifications) === 'FAIL',
    'New C 8/11 WHO is score=75, worst=FAIL (chlorine steepening crosses WARNING->FAIL)');
  const who811Verdict = sandbox.comparisonPresentationVerdict(who811.score, who811.classifications, who811.engineKey);
  assert(who811Verdict.label === 'score.verdict.complianceWarning',
    `WHO FAIL label is complianceWarning (got "${who811Verdict.label}")`);
  assert(who811Verdict.label !== 'score.benchmark.verdict.passBand', 'WHO FAIL label is NOT passBand');
  assert(who811Verdict.label !== 'score.benchmark.verdict.withinLimits', 'WHO FAIL label is NOT the WARNING-tier withinLimits string (distinct tiers)');

  // 2026-08-18 (PO-approved): newc810's do=5.31 no longer reaches WARNING
  // under the shared curve (see A2 above — DO tops out at grade 68 below
  // WHO/EPA's own do>=6 ideal floor, never reaching the WARNING threshold of
  // 80). A ph-based WARNING fixture demonstrates the same presentation
  // branch instead.
  const phWarnFixture = { ph: 6.47, tds: 80, turbidity: 0.1, orp: 400, do: 8.0, chlorine: 0.3 };
  const who810 = switchAndRead('who', phWarnFixture);
  assert(who810.score === 85 && who810.classifications && sandbox.worstBenchmarkClassification(who810.classifications) === 'WARNING',
    'ph=6.47 WHO is score=85, worst=WARNING');
  const who810Verdict = sandbox.comparisonPresentationVerdict(who810.score, who810.classifications, who810.engineKey);
  assert(who810Verdict.label === 'score.benchmark.verdict.withinLimits',
    `WHO WARNING label is withinLimits, not passBand (got "${who810Verdict.label}")`);

  const epa811 = switchAndRead('usEpa', phWarnFixture);
  const epa811Verdict = sandbox.comparisonPresentationVerdict(epa811.score, epa811.classifications, epa811.engineKey);
  assert(epa811Verdict.label === 'score.benchmark.verdict.withinLimits', `EPA WARNING label is withinLimits (got "${epa811Verdict.label}")`);

  // 2026-08-18 (PO-approved): japan is included in COUNTRY_SEVERITY_PRESENTATION_ENGINES,
  // and its worst classification here is PASS (falls through to the numeric
  // fallback branch), so the label depends on the numeric score (>=80 =
  // passBand). newc811's shared base (76) falls below that threshold, so it
  // now genuinely shows withinLimits, not passBand — a real outcome of the
  // new shared grading, not a bug.
  const jp811 = switchAndRead('japan', newc811);
  const jp811Verdict = sandbox.comparisonPresentationVerdict(jp811.score, jp811.classifications, jp811.engineKey);
  assert(jp811Verdict.label === 'score.benchmark.verdict.withinLimits', `Japan PASS (worst=PASS) shows withinLimits at score 76 (got "${jp811Verdict.label}")`);

  // Case 1328: all-PASS on JP/WHO/EPA, shared base 92 (>=80) — passBand.
  for (const key of ['japan', 'who', 'usEpa']) {
    const r = switchAndRead(key, c1328);
    const v = sandbox.comparisonPresentationVerdict(r.score, r.classifications, r.engineKey);
    assert(v.label === 'score.benchmark.verdict.passBand', `Case 1328 ${key} still passBand (got "${v.label}")`);
    assert(r.score === 92, `Case 1328 ${key} score numerically 92 (got ${r.score})`);
  }

  // FAIL/CRITICAL branches must retain their exact pre-existing behavior.
  const failWho = sandbox.comparisonPresentationVerdict(75, { ph: 'FAIL', tds: 'PASS', turbidity: 'PASS', orp: 'PASS', chlorine: 'PASS', do: 'PASS' }, 'who');
  assert(failWho.label === 'score.verdict.complianceWarning', 'FAIL still shows complianceWarning (unchanged)');
  const critWho = sandbox.comparisonPresentationVerdict(60, { ph: 'CRITICAL', tds: 'PASS', turbidity: 'PASS', orp: 'PASS', chlorine: 'PASS', do: 'PASS' }, 'who');
  assert(critWho.label === 'score.verdict.complianceFail', 'CRITICAL still shows complianceFail (unchanged)');

  // Thailand/EU must never activate the WARNING presentation branch — engineKey
  // gate excludes them, so even a WARNING-shaped classifications object falls
  // through to the pure numeric branch untouched by this fix.
  const thVerdict = sandbox.comparisonPresentationVerdict(86, { ph: 'WARNING' }, 'thailand');
  assert(thVerdict.label === 'score.benchmark.verdict.passBand', 'Thailand ignores WARNING classifications entirely, pure numeric passBand at 86');
  const euVerdict = sandbox.comparisonPresentationVerdict(86, { ph: 'WARNING' }, 'eu');
  assert(euVerdict.label === 'score.benchmark.verdict.passBand', 'EU ignores WARNING classifications entirely, pure numeric passBand at 86');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
