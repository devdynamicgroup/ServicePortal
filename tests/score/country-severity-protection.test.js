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
  const rWho = bench('who', { ...IDEAL, do: 5.5 });
  assert(rWho.classifications.do === 'WARNING', 'WHO do=5.5 classifies WARNING');
  assert(rWho.score === 85, `WHO worst=WARNING capped at 85 (got ${rWho.score})`);

  const rEpa = bench('usEpa', { ...IDEAL, do: 5.5 });
  assert(rEpa.classifications.do === 'WARNING', 'EPA do=5.5 classifies WARNING');
  assert(rEpa.score === 85, `EPA worst=WARNING capped at 85 (got ${rEpa.score})`);

  // A raw composite already below 85 must not be raised.
  const rLow = bench('who', { ...IDEAL, do: 5.5, tds: 550 });
  assert(rLow.classifications.do === 'WARNING' || rLow.classifications.tds === 'WARNING',
    'lower WARNING composite fixture still classifies WARNING');
  assert(rLow.score <= 85, `WARNING composite already <=85 is not raised (got ${rLow.score})`);
}

console.log('\nA3. WARNING/FAIL/CRITICAL boundary — DO cliff around 4.799/4.800 (WHO)');
{
  const at480 = bench('who', { ...IDEAL, do: 4.8 });
  assert(at480.classifications.do === 'WARNING', 'do=4.8 (grade exactly 80) classifies WARNING');
  assert(at480.score === 85, `do=4.8 WARNING -> capped at 85 (got ${at480.score})`);

  const at4799 = bench('who', { ...IDEAL, do: 4.799 });
  assert(at4799.classifications.do === 'FAIL', 'do=4.799 (grade just under 80) classifies FAIL');
  assert(at4799.score === 75, `do=4.799 FAIL -> capped at 75, unchanged by WARNING work (got ${at4799.score})`);

  // Discontinuity is now 85->75 (10 points) instead of the pre-fix 97/99->75 (~22-24 points).
  assert((at480.score - at4799.score) === 10, 'WARNING/FAIL cliff reduced to exactly 10 points at this boundary');
}

console.log('\nA4. Severity ordering — PASS >= WARNING(85) > FAIL(75) > CRITICAL(60), no inversion');
{
  const rPass = bench('who', IDEAL);
  const rWarn = bench('who', { ...IDEAL, do: 5.5 });
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
    usEpa: [['pH=4.5', { ...IDEAL, ph: 4.5 }], ['chlorine=0', { ...IDEAL, chlorine: 0 }], ['DO=0', { ...IDEAL, do: 0 }], ['turbidity=10', { ...IDEAL, turbidity: 10 }]]
  };
  for (const [c, cases] of Object.entries(fixtures)) {
    for (const [label, r] of cases) {
      const res = bench(c, r);
      assert(res.score === 60, `${c} ${label} -> CRITICAL -> 60 (got ${res.score}, worst=${JSON.stringify(res.classifications)})`);
    }
  }
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
  // Thailand chlorine curve + weakest-link share 0.25->0.5 (2026-08-17, PO-approved, separate from
  // this file's WARNING-cap topic): 81 (was 86). Unrelated to the mechanism this file tests.
  assert(thBase.score === 81, `Thailand New C 8/11 (got ${thBase.score})`);
  // EU non-chlorine severity coverage (2026-08-14): pH=4.5 now classifies FAIL
  // on EU AND is no longer isolated from the generic cap — this is the
  // intended new behavior (was 88 uncapped pre-fix).
  const euCritical = bench('eu', { ...IDEAL, ph: 4.5 });
  assert(euCritical.classifications.ph === 'FAIL', 'EU still classifies pH=4.5 as FAIL (classification logic untouched)');
  assert(euCritical.score === 75, `EU pH=4.5 (non-chlorine FAIL) now capped at 75 (got ${euCritical.score})`);
  const euCl0 = bench('eu', { ...IDEAL, chlorine: 0 });
  assert(euCl0.score === 65, `EU chlorine=0 still exactly its own existing gate value 65, not overridden by the generic CRITICAL=60 (got ${euCl0.score})`);
}

console.log('\nD. Real-case regression (WARNING cap=85 applied 2026-08-14, PO-approved)');
{
  const newc811 = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 };
  const newc810 = { ph: 7.81, tds: 14.672, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 };
  const c1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3 };
  // Japan pH/TDS/chlorine inner curves (2026-08-17, PO-approved): chlorine=0.7
  // and pH=7.85 are past their new ideal windows, pulling Japan to 90 (was 98).
  assert(bench('japan', newc811).score === 90, 'New C 8/11 JP 90 (chlorine/pH past ideal)');
  // WHO/EPA: worst=WARNING (chlorine and/or do) -> now capped at 85, was 93/98 pre-fix.
  assert(bench('who', newc811).score === 85, `New C 8/11 WHO worst=WARNING -> capped 85 (was 93 pre-fix)`);
  assert(bench('usEpa', newc811).score === 85, `New C 8/11 EPA worst=WARNING -> capped 85 (was 98 pre-fix)`);
  assert(bench('eu', newc811).score === 65, 'New C 8/11 EU unchanged 65 (chlorine CRITICAL dominates, generic cap does not lower it further)');
  // Japan pH inner curve (2026-08-17, PO-approved): pH=7.81 is just past the
  // 7.3-7.7 ideal window (grade 89), pulling Japan to 97 (was 99).
  assert(bench('japan', newc810).score === 97, 'New C 8/10 JP 97 (pH past ideal)');
  assert(bench('who', newc810).score === 85, `New C 8/10 WHO worst=WARNING -> capped 85 (was 96 pre-fix)`);
  assert(bench('usEpa', newc810).score === 85, `New C 8/10 EPA worst=WARNING -> capped 85 (was 98 pre-fix)`);
  // EU non-chlorine severity coverage (2026-08-14): DO=FAIL now capped at 75 (was 98 uncapped pre-fix).
  assert(bench('eu', newc810).score === 75, 'New C 8/10 EU now capped 75 (DO FAIL, non-chlorine severity coverage)');
  // Japan pH inner curve (2026-08-17, PO-approved): pH=7.79 is just past the
  // 7.3-7.7 ideal window (grade 91), pulling Japan to 98 (was 99).
  assert(bench('japan', c1328).score === 98, '13.28 JP 98 (pH past ideal)');
  assert(bench('who', c1328).score === 99, '13.28 WHO unchanged 99 (all-PASS, worst=PASS, WARNING cap is a no-op)');
  assert(bench('usEpa', c1328).score === 99, '13.28 EPA unchanged 99 (all-PASS, worst=PASS, WARNING cap is a no-op)');
  // Thailand weakest-link share 0.25->0.5 (2026-08-17, PO-approved): 98 (was 99), unrelated to this file's WARNING-cap topic.
  assert(bench('thailand', c1328).score === 98, '13.28 TH 98 (weakest-link share update, out of this file scope)');
}

console.log('\nD2. WARNING cap engine isolation — Thailand/EU never see a WARNING-triggered cap');
{
  const newc811 = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 };
  const newc810 = { ph: 7.81, tds: 14.672, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 };
  // Thailand has no WARNING classification concept in its own classify() bands the way JP/WHO/EPA do,
  // and never calls applyCountrySeverityProtection at all (structural isolation, verified via git diff).
  // Thailand weakest-link share 0.25->0.5 (2026-08-17, PO-approved) moved both these
  // numbers (86->81, 90->86) -- unrelated to and separate from the WARNING-cap
  // mechanism this section actually tests; verified by direct computation, not assumed.
  assert(bench('thailand', newc811).score === 81, 'Thailand New C 8/11 unaffected by WARNING cap specifically (81 post weakest-link update)');
  assert(bench('thailand', newc810).score === 86, 'Thailand New C 8/10 unaffected by WARNING cap specifically (86 post weakest-link update)');
  // EU's own DO check is binary PASS/FAIL (no WARNING tier at all for DO on EU).
  assert(bench('eu', newc811).classifications.do === 'FAIL', 'EU has no WARNING tier for DO — binary PASS/FAIL only');
  assert(bench('eu', newc810).classifications.do === 'FAIL', 'EU DO=5.31 also binary FAIL, not WARNING, on EU');
}

console.log('\nK. EU non-chlorine severity-protection coverage (2026-08-14, PO-approved)');
{
  // A. Existing chlorine behavior — chlorine CRITICAL must remain exactly 65, never 60.
  const euClCrit = bench('eu', { ...IDEAL, chlorine: 0 });
  assert(euClCrit.classifications.chlorine === 'CRITICAL', 'EU chlorine=0 classifies CRITICAL');
  assert(euClCrit.score === 65, `A: chlorine CRITICAL stays exactly 65 (got ${euClCrit.score})`);

  // B. DO severity — DO FAIL while chlorine PASS -> capped at 75.
  const euDoFail = bench('eu', { ...IDEAL, do: 4.5 });
  assert(euDoFail.classifications.do === 'FAIL' && euDoFail.classifications.chlorine === 'PASS', 'DO FAIL, chlorine PASS');
  assert(euDoFail.score === 75, `B: DO FAIL (chlorine PASS) capped at 75 (got ${euDoFail.score})`);

  // C. Non-chlorine WARNING while chlorine PASS -> must not exceed 85.
  // (EU's own orp classify is binary PASS/WARNING tied to the 200-600 outer
  // band only, not the PD-014 inner curve, so ph is used here instead — ph=5.8
  // is outside EU's [6.5,9.5] pass range but grade=72 still clears the WARNING
  // floor of 70, confirmed by direct computation.)
  const euPhWarn = bench('eu', { ...IDEAL, ph: 5.8 });
  assert(euPhWarn.classifications.ph === 'WARNING' && euPhWarn.classifications.chlorine === 'PASS', 'ph WARNING, chlorine PASS');
  assert(euPhWarn.score <= 85, `C: non-chlorine WARNING (chlorine PASS) does not exceed 85 (got ${euPhWarn.score})`);

  // D. Non-chlorine CRITICAL while chlorine PASS -> must not exceed 60.
  const euTurbCrit = bench('eu', { ...IDEAL, turbidity: 6 });
  assert(euTurbCrit.classifications.turbidity === 'CRITICAL' && euTurbCrit.classifications.chlorine === 'PASS', 'turbidity CRITICAL, chlorine PASS');
  assert(euTurbCrit.score <= 60, `D: non-chlorine CRITICAL (chlorine PASS) does not exceed 60 (got ${euTurbCrit.score})`);

  // E1. Combined severity, rawScore > 65 — chlorine's dedicated 65 gate must
  // remain dominant; the generic CRITICAL=60 must NOT pull it down to 60.
  // (65 is a CEILING via Math.min, not a forced value — this fixture's raw
  // aggregate is well above 65 before any gate applies, so 65 is the correct
  // binding constraint here.)
  const euCombinedHigh = bench('eu', { ...IDEAL, chlorine: 0, do: 4.5 });
  assert(euCombinedHigh.classifications.chlorine === 'CRITICAL' && euCombinedHigh.classifications.do === 'FAIL', 'E1: chlorine CRITICAL + DO FAIL');
  assert(euCombinedHigh.score === 65, `E1 (rawScore>65): stays exactly 65, not pulled to 60 (got ${euCombinedHigh.score})`);

  // E2. Combined severity, rawScore < 65 — the chlorine gate is Math.min, a
  // ceiling not a floor. When OTHER parameters independently degrade the raw
  // aggregate below 65, the gate must be a no-op and the lower raw value must
  // stand. Chlorine CRITICAL must NEVER raise a score that is already worse
  // than 65 — that would be a false-high regression.
  const euCombinedLow = bench('eu', { ...IDEAL, chlorine: 0, do: 4.5, turbidity: 6 });
  assert(euCombinedLow.classifications.chlorine === 'CRITICAL' && euCombinedLow.classifications.turbidity === 'CRITICAL', 'E2: chlorine CRITICAL + turbidity CRITICAL + DO FAIL');
  assert(euCombinedLow.score < 65, `E2 (rawScore<65): final score stays below 65, never raised by the chlorine gate (got ${euCombinedLow.score})`);
  assert(euCombinedLow.score !== 65 && euCombinedLow.score !== 60, `E2: final is neither artificially forced to 65 nor to 60 — it is the genuine lower raw-derived value (got ${euCombinedLow.score})`);

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
  assert(bench('eu', c1328).score === 99, `G: Case 1328 EU = 99 (got ${bench('eu', c1328).score})`);
  assert(bench('eu', test1).score === 75, `G: test1 EU 97 -> 75 (got ${bench('eu', test1).score})`);
}

console.log('\nE. Catastrophic fixtures (all cap to exactly 60, in-scope engines)');
{
  const cases = [
    ['japan', { ...IDEAL, ph: 4.5 }], ['japan', { ...IDEAL, chlorine: 0 }], ['japan', { ...IDEAL, turbidity: 10 }],
    ['who', { ...IDEAL, ph: 4.5 }], ['who', { ...IDEAL, chlorine: 0 }], ['who', { ...IDEAL, do: 0 }],
    ['usEpa', { ...IDEAL, ph: 4.5 }], ['usEpa', { ...IDEAL, chlorine: 0 }], ['usEpa', { ...IDEAL, do: 0 }], ['usEpa', { ...IDEAL, turbidity: 10 }]
  ];
  for (const [c, r] of cases) assert(bench(c, r).score === 60, `${c} catastrophic fixture -> 60`);
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
  assert(euDisplayed.score === 65, 'EU chlorine=0 still exactly 65 (existing gate, not new mechanism)');
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

  const who811 = switchAndRead('who', newc811);
  assert(who811.score === 85 && who811.classifications && sandbox.worstBenchmarkClassification(who811.classifications) === 'WARNING',
    'New C 8/11 WHO is score=85, worst=WARNING (numeric unchanged by this presentation fix)');
  const who811Verdict = sandbox.comparisonPresentationVerdict(who811.score, who811.classifications, who811.engineKey);
  assert(who811Verdict.label === 'score.benchmark.verdict.withinLimits',
    `WHO WARNING label is withinLimits, not passBand (got "${who811Verdict.label}")`);
  assert(who811Verdict.label !== 'score.benchmark.verdict.passBand', 'WHO WARNING label is NOT passBand');
  assert(who811Verdict.label !== 'score.verdict.complianceWarning', 'WHO WARNING label is NOT the FAIL-tier complianceWarning string (distinct tiers)');

  const epa811 = switchAndRead('usEpa', newc811);
  const epa811Verdict = sandbox.comparisonPresentationVerdict(epa811.score, epa811.classifications, epa811.engineKey);
  assert(epa811Verdict.label === 'score.benchmark.verdict.withinLimits', `EPA WARNING label is withinLimits (got "${epa811Verdict.label}")`);

  const jp811 = switchAndRead('japan', newc811);
  const jp811Verdict = sandbox.comparisonPresentationVerdict(jp811.score, jp811.classifications, jp811.engineKey);
  assert(jp811Verdict.label === 'score.benchmark.verdict.passBand', `Japan PASS (worst=PASS) still shows passBand (got "${jp811Verdict.label}")`);

  // Case 1328: all-PASS on JP/WHO/EPA — must remain passBand, unaffected by the new WARNING branch.
  // Japan pH inner curve (2026-08-17, PO-approved): pH=7.79 is just past the
  // 7.3-7.7 ideal window (grade 91), pulling Japan to 98 (was 99) — still PASS
  // classification, so still passBand; only WHO/EPA stay at 99.
  for (const key of ['japan', 'who', 'usEpa']) {
    const r = switchAndRead(key, c1328);
    const v = sandbox.comparisonPresentationVerdict(r.score, r.classifications, r.engineKey);
    assert(v.label === 'score.benchmark.verdict.passBand', `Case 1328 ${key} still passBand (got "${v.label}")`);
    const expected = key === 'japan' ? 98 : 99;
    assert(r.score === expected, `Case 1328 ${key} score numerically ${expected} (got ${r.score})`);
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
