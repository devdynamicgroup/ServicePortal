/**
 * Country Benchmark semantic contract — PD-005 / PD-001 presentation + frozen math.
 * Run: node tests/score/country-benchmark-semantics.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const engineFiles = [
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

const sandbox = {
  console,
  document: { getElementById: () => null },
  S: { lang: 'en', publicScoreView: false, scoreStandardKey: 'thailand', comparisonScoreResult: null },
  t: (k) => k
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of engineFiles) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}
vm.runInContext(fs.readFileSync(path.join(root, 'src/js/flows/score.js'), 'utf8'), sandbox, {
  filename: 'src/js/flows/score.js'
});

const decisionDoc = fs.readFileSync(path.join(root, 'docs/quality-v3/UNRESOLVED_DECISIONS.md'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
const scoreFlowSrc = fs.readFileSync(path.join(root, 'src/js/flows/score.js'), 'utf8');

const BASELINE = Object.freeze({
  readings: { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25 },
  quality: 76,
  thailand: 100,
  japan: 100,
  who: 95,
  eu: 65,
  usEpa: 99
});

const KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function bench(key, readings) {
  return sandbox.WaterScoreBenchmarkRegistry.calculate(key, readings);
}

console.log('\nGovernance — PD-005 / PD-001 DECIDED A; PD-002/003/004 OPEN pending PO');
{
  assert(/PD-005[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-005 Status DECIDED');
  assert(/PD-001[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-001 Status DECIDED');
  assert(decisionDoc.includes('FORBID MAGNITUDE RANKING'), 'PD-005 Decision A recorded');
  assert(decisionDoc.includes('PASS-BAND') || decisionDoc.includes('pass-band'), 'PD-001 Decision A recorded');
  assert(decisionDoc.includes('User instruction / Product Owner instruction'), 'Approver is instruction record (not invented person name)');

  for (const id of ['002', '003', '004']) {
    const block = decisionDoc.match(new RegExp(`## PD-${id}:[\\s\\S]*?(?=\\n## |$)`));
    assert(block, `PD-${id} record exists`);
    const text = block[0];
    assert(/\*\*Status:\*\* OPEN/.test(text), `PD-${id} Status OPEN`);
    assert(/\*\*Decision:\*\* —/.test(text), `PD-${id} Decision unset`);
    assert(/\*\*Recommendation:\*\* A/.test(text), `PD-${id} Recommendation A`);
    assert(/\*\*PO Approval:\*\* PENDING/.test(text), `PD-${id} PO Approval PENDING`);
    assert(!/\*\*Status:\*\* DECIDED/.test(text), `PD-${id} must not be DECIDED`);
  }
}

console.log('\nBaseline replay — scoring math frozen');
{
  const r = BASELINE.readings;
  const q = sandbox.computeScoreFromReadings(r);
  assert(q === BASELINE.quality, `Quality V3 = ${BASELINE.quality} (got ${q})`);
  assert(bench('thailand', r).score === BASELINE.thailand, `Thailand = ${BASELINE.thailand}`);
  assert(bench('japan', r).score === BASELINE.japan, `Japan = ${BASELINE.japan}`);
  assert(bench('who', r).score === BASELINE.who, `WHO = ${BASELINE.who}`);
  assert(bench('eu', r).score === BASELINE.eu, `EU = ${BASELINE.eu}`);
  assert(bench('usEpa', r).score === BASELINE.usEpa, `US EPA = ${BASELINE.usEpa}`);
}

console.log('\nPD-005 — no ranking semantics / equal scores valid');
{
  assert(i18nSrc.includes('not a country ranking'), 'disclaimer forbids country ranking');
  assert(i18nSrc.includes('higher score = better country') || i18nSrc.includes('คะแนนสูงกว่า = ประเทศดีกว่า'),
    'disclaimer forbids higher=better-country');
  assert(!/best country|worst country|country ranking|leaderboard/i.test(scoreFlowSrc.replace(/PD-005[\s\S]*?ranking/g, '')),
    'score flow does not introduce best/worst country ranking');
  const th = bench('thailand', BASELINE.readings).score;
  const jp = bench('japan', BASELINE.readings).score;
  assert(th === jp && th === 100, 'equal TH/JP scores remain valid');
  assert(!scoreFlowSrc.includes('strictest cleanliness expectations'),
    'dropdown order comment no longer implies quality ranking');
}

console.log('\nPD-001 — comparison presentation is pass-band, not Excellent');
{
  assert(typeof sandbox.comparisonPresentationVerdict === 'function', 'comparisonPresentationVerdict exists');
  const present100 = sandbox.comparisonPresentationVerdict(100);
  const present95 = sandbox.comparisonPresentationVerdict(95);
  const present65 = sandbox.comparisonPresentationVerdict(65);
  assert(present100.label === 'score.benchmark.verdict.passBand', `100 → passBand (got ${present100.label})`);
  assert(present95.label === 'score.benchmark.verdict.passBand', `95 → passBand (got ${present95.label})`);
  assert(present65.label === 'score.benchmark.verdict.withinLimits', `65 → withinLimits (got ${present65.label})`);
  assert(!String(present100.label).toLowerCase().includes('excellent'), 'comparison presentation is not Excellent');

  const qualityVerdict = sandbox.customerVerdict(92);
  assert(qualityVerdict.label === 'score.verdict.excellent', 'Quality path still uses Excellent for high scores');

  const compare = sandbox.buildComparisonScoreResult(BASELINE.readings, 'thailand');
  assert(compare.score === 100, 'comparison numeric score unchanged');
  assert(compare.verdict === 'score.benchmark.verdict.passBand', `comparison result.verdict is pass-band (got ${compare.verdict})`);
  assert(compare.engineVerdict === 'Excellent', `engineVerdict preserved as Excellent (got ${compare.engineVerdict})`);

  assert(i18nSrc.includes("'score.benchmark.verdict.passBand'"), 'passBand i18n key exists');
  assert(i18nSrc.includes('Within pass band'), 'EN pass-band wording present');
}

console.log('\nModel integrity — engines untouched numerically');
{
  assert(sandbox.EuBenchmarkLimits.gateCapOnChlorineFail === 65, 'EU gate still 65');
  assert(sandbox.ThailandBenchmarkWeights.do === undefined, 'TH DO still excluded');
  for (const key of KEYS) {
    const name = {
      thailand: 'ThailandBenchmarkLimits',
      japan: 'JapanBenchmarkLimits',
      who: 'WhoBenchmarkLimits',
      eu: 'EuBenchmarkLimits',
      usEpa: 'UsEpaBenchmarkLimits'
    }[key];
    const L = sandbox[name];
    assert(L.orp.min === 200 && L.orp.max === 600, `${key} ORP unchanged`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
