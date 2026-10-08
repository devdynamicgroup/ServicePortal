/**
 * Case → readings → Country engine → Hero isolation.
 *
 * Proves scoring inputs belong to the active Case and never silently reuse
 * another Case's S.tapData / meter DOM leftovers.
 *
 * Run: node tests/score/case-readings-isolation.test.js
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

const domVals = {};
function stubEl(id) {
  return {
    id,
    get value() { return domVals[id] || ''; },
    set value(v) { domVals[id] = v == null ? '' : String(v); },
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

const gauge = stubEl('gauge-val');
gauge.textContent = '—';

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  document: {
    getElementById: (id) => (id === 'gauge-val' ? gauge : stubEl(id)),
    querySelector: () => stubEl(),
    querySelectorAll: () => []
  },
  S: {
    lang: 'en',
    scoreStandardKey: 'thailand',
    activeJob: null,
    scoreBaseReadings: null,
    scoreVal: null,
    currentScoreResult: null,
    comparisonScoreResult: null,
    displayedScore: null,
    scoreParamOpen: null,
    publicScoreView: false,
    taps: ['Kitchen'],
    scoreTapFilter: 'all',
    lastReadingsValidation: null,
    tapData: []
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
  if (cond) {
    passed += 1;
    console.log(`  ok  ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

function fingerprint(readings) {
  const keys = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'];
  return keys.map((k) => `${k}=${readings?.[k] ?? ''}`).join('|');
}

function jobFromTapReadings(id, name, readings) {
  return {
    id,
    notionId: id,
    name,
    result: { waterScore: null },
    draft: {
      taps: ['Kitchen'],
      scoreVal: null,
      fields: {},
      tapData: [{
        tasks: { meter: true, chlorine: true },
        photos: {},
        meterReadings: {
          ph: readings.ph,
          tds: readings.tds,
          turbidity: readings.turbidity,
          orp: readings.orp,
          do: readings.do,
          temp: readings.temp
        },
        chlorineReadings: { freeChlorine: readings.chlorine },
        standardMeasurement: { ...readings }
      }]
    }
  };
}

function emptyJob(id, name) {
  return {
    id,
    notionId: id,
    name,
    result: { waterScore: null },
    draft: {
      taps: ['Kitchen'],
      scoreVal: null,
      fields: {},
      tapData: [{ tasks: {}, photos: {} }]
    }
  };
}

function setDomFromReadings(readings) {
  domVals['m-ph'] = String(readings.ph ?? '');
  domVals['m-tds'] = String(readings.tds ?? '');
  domVals['m-turb'] = String(readings.turbidity ?? '');
  domVals['m-orp'] = String(readings.orp ?? '');
  domVals['m-do'] = String(readings.do ?? '');
  domVals['m-free-cl'] = String(readings.chlorine ?? '');
  domVals['m-temp'] = String(readings.temp ?? '');
}

function clearDom() {
  Object.keys(domVals).forEach((k) => { domVals[k] = ''; });
}

/** Existing fixtures — materially different Case readings (repo / locked Cases). */
const FAUCET = Object.freeze({
  ph: 7.2, tds: 80, turbidity: 0.2, orp: 189, do: 7, chlorine: 0, temp: 25
});
const SINK = Object.freeze({
  ph: 7.3, tds: 95, turbidity: 0.25, orp: 195, do: 6.8, chlorine: 0, temp: 26
});
const CASE_1328 = Object.freeze({
  ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06
});

const caseA = jobFromTapReadings('case-faucet', 'faucet', FAUCET);
const caseB = jobFromTapReadings('case-sink', 'sink', SINK);
const caseC = jobFromTapReadings('case-1328', '13.28', CASE_1328);
const caseEmpty = emptyJob('case-empty', 'empty');

function openAndScore(job) {
  sandbox.S.activeJob = job;
  sandbox.S.tapData = JSON.parse(JSON.stringify(job.draft.tapData));
  sandbox.S.scoreStandardKey = 'thailand';
  sandbox.S.publicScoreView = false;
  sandbox.renderWaterScore(job, { publicView: false });
  return {
    activeJobId: sandbox.S.activeJob?.id,
    readings: { ...sandbox.S.scoreBaseReadings },
    fp: fingerprint(sandbox.S.scoreBaseReadings),
    comparisonReadings: { ...(sandbox.S.comparisonScoreResult?.readings || {}) },
    engineKey: sandbox.S.comparisonScoreResult?.engineKey,
    engineScore: sandbox.S.comparisonScoreResult?.score,
    displayedScore: sandbox.S.displayedScore?.score,
    displayedSource: sandbox.S.displayedScore?.source,
    showScore: sandbox.S.displayedScore?.showScore,
    hero: sandbox.S.displayedScore?.showScore ? sandbox.S.displayedScore.score : null
  };
}

console.log('\nTest A — Different Cases produce independent inputs');
{
  clearDom();
  const a = openAndScore(caseA);
  const b = openAndScore(caseB);
  const c = openAndScore(caseC);
  assert(a.fp !== b.fp, `A readings != B readings (${a.fp} vs ${b.fp})`);
  assert(b.fp !== c.fp, `B readings != C readings`);
  assert(a.fp !== c.fp, `A readings != C readings`);
  assert(a.activeJobId === 'case-faucet', 'A activeJob id');
  assert(b.activeJobId === 'case-sink', 'B activeJob id');
  assert(fingerprint(a.comparisonReadings) === a.fp, 'A engine input === A score input');
  assert(fingerprint(b.comparisonReadings) === b.fp, 'B engine input === B score input');
  assert(a.engineKey === 'thailand' && b.engineKey === 'thailand', 'Country engine thailand');
  assert(Number.isFinite(a.hero) && Number.isFinite(b.hero) && Number.isFinite(c.hero), 'Hero finite for A/B/C');
  console.log(`  LINEAGE A hero=${a.hero} fp=${a.fp}`);
  console.log(`  LINEAGE B hero=${b.hero} fp=${b.fp}`);
  console.log(`  LINEAGE C hero=${c.hero} fp=${c.fp}`);
}

console.log('\nTest B — Switching A → B does not reuse A readings');
{
  clearDom();
  setDomFromReadings(FAUCET); // leftover DOM from A must not contaminate B
  const a = openAndScore(caseA);
  // Simulate scoring B while S.tapData / DOM still look like A (pre-fix failure mode)
  sandbox.S.tapData = JSON.parse(JSON.stringify(caseA.draft.tapData));
  setDomFromReadings(FAUCET);
  sandbox.S.activeJob = caseB;
  sandbox.renderWaterScore(caseB, { publicView: false });
  const bFp = fingerprint(sandbox.S.scoreBaseReadings);
  const bEngineFp = fingerprint(sandbox.S.comparisonScoreResult?.readings);
  assert(bFp === fingerprint(SINK), `B score input is sink (${bFp})`);
  assert(bEngineFp === fingerprint(SINK), `B engine input is sink (${bEngineFp})`);
  assert(bFp !== a.fp, 'B readings != prior A readings');
  assert(sandbox.S.activeJob.id === 'case-sink', 'activeJob is B');
  assert(sandbox.S.displayedScore.source === 'country-benchmark', 'live Hero remains country-benchmark');
}

console.log('\nTest C — Switching B → A does not reuse B readings');
{
  clearDom();
  const b = openAndScore(caseB);
  sandbox.S.tapData = JSON.parse(JSON.stringify(caseB.draft.tapData));
  setDomFromReadings(SINK);
  sandbox.S.activeJob = caseA;
  sandbox.renderWaterScore(caseA, { publicView: false });
  const aFp = fingerprint(sandbox.S.scoreBaseReadings);
  assert(aFp === fingerprint(FAUCET), `A score input is faucet (${aFp})`);
  assert(aFp !== b.fp, 'A readings != prior B readings');
  assert(fingerprint(sandbox.S.comparisonScoreResult?.readings) === fingerprint(FAUCET),
    'A engine input is faucet');
}

console.log('\nTest D — Missing Case readings never fall back to previous Case');
{
  clearDom();
  const a = openAndScore(caseA);
  assert(Number.isFinite(a.hero), `A hero finite (${a.hero})`);

  // Stale session globals from A still present — empty Case must NOT inherit them.
  sandbox.S.tapData = JSON.parse(JSON.stringify(caseA.draft.tapData));
  setDomFromReadings(FAUCET);
  sandbox.S.activeJob = caseEmpty;
  sandbox.S.currentScoreResult = { score: a.hero, source: 'stale' };
  sandbox.S.comparisonScoreResult = { score: a.hero, readings: { ...FAUCET } };
  sandbox.S.displayedScore = { score: a.hero, source: 'country-benchmark', showScore: true };
  sandbox.renderWaterScore(caseEmpty, { publicView: false });

  const emptyFp = fingerprint(sandbox.S.scoreBaseReadings);
  assert(Object.keys(sandbox.S.scoreBaseReadings || {}).length === 0, `empty readings object (got ${emptyFp})`);
  assert(sandbox.S.displayedScore.showScore === false, 'empty Case showScore false');
  assert(sandbox.S.displayedScore.score == null, 'empty Case displayedScore null');
  assert(sandbox.S.displayedScore.score !== a.hero, 'empty Case does not show A hero');
  assert(sandbox.S.comparisonScoreResult?.score == null, 'empty Case comparison score null');
}

console.log('\nTest E — Country perturbation remains valid (Layer 4)');
{
  clearDom();
  openAndScore(caseC);
  const keys = ['thailand', 'japan', 'who', 'eu', 'usEpa'];
  for (const key of keys) {
    sandbox.setScoreReferenceStandard(key);
    const displayed = sandbox.S.displayedScore;
    const engine = sandbox.WaterScoreBenchmarkRegistry.calculate(key, CASE_1328);
    assert(displayed.source === 'country-benchmark', `${key}: source country-benchmark`);
    assert(displayed.engineKey === key, `${key}: engineKey`);
    assert(displayed.score === engine.score, `${key}: displayed ${displayed.score} === engine ${engine.score}`);
    assert(fingerprint(sandbox.S.comparisonScoreResult.readings) === fingerprint(CASE_1328),
      `${key}: engine still uses Case C readings`);
  }
  assert(sandbox.S.currentScoreResult.standardKey === 'quality-v3', 'Q-V3 remains publish channel');
}

console.log('\nTest F — activeJob.id owns score input (lineage assertion)');
{
  clearDom();
  for (const job of [caseA, caseB, caseC]) {
    const out = openAndScore(job);
    assert(out.activeJobId === job.id, `owner ${job.id}`);
    assert(fingerprint(out.comparisonReadings) === out.fp,
      `${job.name}: comparison.readings === scoreBaseReadings`);
    assert(out.displayedSource === 'country-benchmark', `${job.name}: displayed from country`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
