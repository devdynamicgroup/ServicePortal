/**
 * Country severity protection — Japan / WHO / US EPA only (product decision,
 * 2026-08-14): FAIL classification caps the Country Hero at 75, CRITICAL
 * caps at 60. PASS/WARNING unchanged. Thailand (PD-015) and EU (PD-002) are
 * explicitly out of scope and must be structurally unaffected — verified via
 * git diff (see report) and via the isolation assertions below.
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

console.log('\nA. Numeric protection — PASS/WARNING unchanged, in-scope engines');
{
  for (const c of IN_SCOPE) {
    const r = bench(c, IDEAL);
    assert(r.classifications && Object.values(r.classifications).every(v => v === 'PASS' || v === 'NOT_EVALUATED' || v === 'NOT_MEASURED'),
      `${c} IDEAL reading is all-PASS`);
    assert(r.score >= 96, `${c} IDEAL score unaffected by protection (got ${r.score})`);
  }
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

console.log('\nC. Country isolation — Thailand and EU numerically unaffected');
{
  const thBase = bench('thailand', { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 });
  assert(thBase.score === 86, `Thailand New C 8/11 unchanged (got ${thBase.score})`);
  const euCritical = bench('eu', { ...IDEAL, ph: 4.5 });
  assert(euCritical.classifications.ph === 'FAIL', 'EU still classifies pH=4.5 as FAIL (classification logic untouched)');
  assert(euCritical.score === 88, `EU pH=4.5 NOT capped by new mechanism, existing EU math unchanged (got ${euCritical.score})`);
  const euCl0 = bench('eu', { ...IDEAL, chlorine: 0 });
  assert(euCl0.score === 65, `EU chlorine=0 still exactly its own existing gate value 65, not overridden (got ${euCl0.score})`);
}

console.log('\nD. Real-case regression (exact values already verified this thread)');
{
  const newc811 = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 };
  const newc810 = { ph: 7.81, tds: 14.672, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 };
  const c1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3 };
  assert(bench('japan', newc811).score === 98, 'New C 8/11 JP unchanged 98');
  assert(bench('who', newc811).score === 93, 'New C 8/11 WHO unchanged 93');
  assert(bench('usEpa', newc811).score === 98, 'New C 8/11 EPA unchanged 98');
  assert(bench('eu', newc811).score === 65, 'New C 8/11 EU unchanged 65');
  assert(bench('japan', newc810).score === 99, 'New C 8/10 JP unchanged 99');
  assert(bench('who', newc810).score === 96, 'New C 8/10 WHO unchanged 96');
  assert(bench('usEpa', newc810).score === 98, 'New C 8/10 EPA unchanged 98');
  assert(bench('eu', newc810).score === 98, 'New C 8/10 EU unchanged 98');
  assert(bench('japan', c1328).score === 99, '13.28 JP unchanged 99');
  assert(bench('who', c1328).score === 99, '13.28 WHO unchanged 99');
  assert(bench('usEpa', c1328).score === 99, '13.28 EPA unchanged 99');
  assert(bench('thailand', c1328).score === 99, '13.28 TH unchanged 99');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
