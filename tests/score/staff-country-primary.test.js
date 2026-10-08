/**
 * Staff Score screen: the primary number is the selected country engine's
 * benchmark score (it changes with the country). There is no secondary score line.
 * The customer report shows the published score only, with no secondary line.
 *
 * Loads the real i18n, engine files, and src/js/flows/score.js into one vm
 * sandbox and drives the real render entry points.
 *
 * Run: node tests/score/staff-country-primary.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const ENGINE_KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];
const FILES = [
  'src/js/i18n.js',
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/validation/measurementValidator.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
  'src/js/score/benchmark/registry.js',
  ...ENGINE_KEYS.flatMap((key) => ['limits', 'weights', 'score'].map((file) => `src/js/score/benchmark/${key}/${file}.js`)),
  'src/js/flows/score.js'
];

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function openScreen(lang = 'en') {
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const nodes = {};
  const node = (id) => {
    if (id && nodes[id]) return nodes[id];
    const el = {
      id, hidden: true, textContent: '', innerHTML: '', className: '', dataset: {},
      style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      setAttribute() {}, removeAttribute() {}, querySelector() { return node(); }, querySelectorAll() { return []; },
      replaceChildren() {}, appendChild() {}, addEventListener() {}, children: [], childNodes: []
    };
    if (id) nodes[id] = el;
    return el;
  };
  const sandbox = {
    console: quiet,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    document: { getElementById: (id) => node(id), querySelector: () => null, querySelectorAll: () => [] },
    S: {
      lang, scoreStandardKey: 'thailand', activeJob: null, scoreBaseReadings: null, scoreVal: null,
      currentScoreResult: null, comparisonScoreResult: null, displayedScore: null, scoreParamOpen: null,
      publicScoreView: false, taps: ['Tap 1'], scoreTapFilter: 'all', lastReadingsValidation: null
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  FILES.forEach((rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }));
  return sandbox;
}

const makeCase = (readings, standardKey, result = {}) => ({
  id: 'case',
  notionId: 'case',
  draft: { taps: ['Tap 1'], fields: {}, scoreStandardKey: standardKey, tapData: [{ standardMeasurement: { ...readings } }] },
  result
});

function staffScreen(readings, standardKey, { lang, result } = {}) {
  const page = openScreen(lang);
  const job = makeCase(readings, standardKey, result);
  page.S.activeJob = job;
  page.renderWaterScore(job, { publicView: false });
  return page;
}

// Known input: readings where the five engines disagree (Japan strictest).
const READINGS = { ph: 7.6, tds: 102, chlorine: 0.02, turbidity: 0.7, orp: 174, do: 5.7, temp: 27.3 };
const EXPECTED = { quality: 64, thailand: 54, japan: 51, who: 54, eu: 54, usEpa: 57 };

const reference = openScreen();
const engineScore = (key) => reference.WaterScoreBenchmarkRegistry.calculate(key, READINGS).score;

console.log('\nFixture: the engines themselves produce these numbers');
assert(reference.computeQualityScoreDetail(READINGS).score === EXPECTED.quality, `Quality V3 is ${EXPECTED.quality}`);
ENGINE_KEYS.forEach((key) => assert(engineScore(key) === EXPECTED[key], `${key} engine scores ${EXPECTED[key]} (got ${engineScore(key)})`));
assert(ENGINE_KEYS.every((key) => EXPECTED.japan <= EXPECTED[key]) && EXPECTED.japan < EXPECTED.usEpa, 'Japan is the lowest benchmark for this water');

console.log('\n1. Staff primary is the selected country engine; nothing is published yet, so there is no line');
ENGINE_KEYS.forEach((key) => {
  const page = staffScreen(READINGS, key);
  assert(page.S.displayedScore.source === 'country-benchmark' && page.S.displayedScore.engineKey === key, `${key}: primary comes from the ${key} engine`);
  assert(page.S.displayedScore.score === engineScore(key), `${key}: primary is ${engineScore(key)}`);
  assert(page.S.scoreVal === EXPECTED.quality && page.S.currentScoreResult.score === EXPECTED.quality, `${key}: Quality V3 is still computed internally (${EXPECTED.quality})`);
  assert(page.resolvePublishScoreRequest(page.S.activeJob).score === engineScore(key), `${key}: what would be published is the primary number ${engineScore(key)}`);
});

console.log('\n2. Switching Japan -> US -> Thailand changes the primary and what would be published');
{
  const page = staffScreen(READINGS, 'japan');
  const primaries = [];
  ['japan', 'usEpa', 'thailand'].forEach((key) => {
    page.setScoreReferenceStandard(key);
    primaries.push(page.S.displayedScore.score);
    assert(page.S.displayedScore.score === EXPECTED[key], `after selecting ${key}: primary is ${EXPECTED[key]}`);
    const request = page.resolvePublishScoreRequest(page.S.activeJob);
    assert(request.scoreType === 'country-benchmark' && request.standardKey === key && request.score === EXPECTED[key], `after selecting ${key}: the publish request is ${request.standardKey} ${request.score}`);
    assert(page.S.scoreVal === EXPECTED.quality, `after selecting ${key}: S.scoreVal keeps its meaning (Quality V3 ${EXPECTED.quality})`);
  });
  assert(new Set(primaries).size === 3, `the primary changed on every switch (${primaries.join(', ')})`);
}

console.log('\n4. Customer report is unaffected');
{
  const page = openScreen();
  const report = makeCase(READINGS, 'japan', { waterScore: 64, complianceStatus: 'FAIL', publicReportToken: 'rpt' });
  page.S.publicScoreView = true;
  page.S.activeJob = report;
  page.renderWaterScore(report, { publicView: true });
  assert(page.S.displayedScore.source === 'published' && page.S.displayedScore.score === 64, 'customer primary is the published score');
}

console.log('\n5. No customer score yet -> no line; the country primary still shows');
{
  const noDo = { ...READINGS };
  delete noDo.do;
  const page = staffScreen(noDo, 'japan');
  assert(page.S.currentScoreResult.score === null, 'Quality V3 is unavailable without DO');
  assert(Number.isFinite(page.S.displayedScore.score), `Japan benchmark is still the primary (${page.S.displayedScore.score})`);
}

console.log('\nLabel and markup');
{
  const i18n = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
  assert(!i18n.includes('score.customerScore.row') && !i18n.includes('score.benchmark.row'), 'no secondary-line label remains');
  const html = fs.readFileSync(path.join(root, 'src/pages/score.html'), 'utf8');
  assert(!html.includes('score-customer-line'), 'the staff customer-score line element is gone');
  assert(!html.includes('score-benchmark-line'), 'the earlier benchmark line element is gone');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
