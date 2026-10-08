/**
 * Staff Score screen shows two separate values:
 *   primary   -> Quality V3 (never changes with the selected country)
 *   secondary -> the selected country engine's own benchmark score
 * The customer report never shows the benchmark line.
 *
 * Loads the real i18n, engine files, and src/js/flows/score.js into one vm
 * sandbox and drives the real render entry points.
 *
 * Run: node tests/score/staff-benchmark-line.test.js
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
  sandbox.line = () => node('score-benchmark-line');
  return sandbox;
}

const makeCase = (readings, standardKey, result = {}) => ({
  id: 'case',
  notionId: 'case',
  draft: { taps: ['Tap 1'], fields: {}, scoreStandardKey: standardKey, tapData: [{ standardMeasurement: { ...readings } }] },
  result
});

function staffScreen(readings, standardKey, lang) {
  const page = openScreen(lang);
  const job = makeCase(readings, standardKey);
  page.S.activeJob = job;
  page.renderWaterScore(job, { publicView: false });
  return page;
}

// Known input: readings where the five engines disagree (Japan strictest).
const READINGS = { ph: 7.6, tds: 102, chlorine: 0.02, turbidity: 0.7, orp: 174, do: 5.7, temp: 27.3 };
const EXPECTED = { quality: 64, thailand: 54, japan: 51, who: 54, eu: 54, usEpa: 57 };
const SHORT_EN = { thailand: 'Thai', japan: 'Japan', who: 'WHO', eu: 'EU', usEpa: 'US' };

const reference = openScreen();
const engineScore = (key) => reference.WaterScoreBenchmarkRegistry.calculate(key, READINGS).score;

console.log('\nFixture: the engines themselves produce these numbers');
assert(reference.computeQualityScoreDetail(READINGS).score === EXPECTED.quality, `Quality V3 is ${EXPECTED.quality}`);
ENGINE_KEYS.forEach((key) => assert(engineScore(key) === EXPECTED[key], `${key} engine scores ${EXPECTED[key]} (got ${engineScore(key)})`));
assert(ENGINE_KEYS.every((key) => EXPECTED.japan <= EXPECTED[key]) && EXPECTED.japan < EXPECTED.usEpa, 'Japan is the lowest benchmark for this water');

console.log('\n1 + 2. Primary Quality V3 is stable; the benchmark line follows the selected engine');
ENGINE_KEYS.forEach((key) => {
  const page = staffScreen(READINGS, key);
  assert(page.S.displayedScore.score === EXPECTED.quality && page.S.displayedScore.source === 'quality-v3', `${key}: primary is Quality V3 ${EXPECTED.quality}`);
  assert(page.line().hidden === false, `${key}: benchmark line is visible on the staff screen`);
  assert(page.line().textContent === `${SHORT_EN[key]} Benchmark: ${engineScore(key)}`, `${key}: line reads "${page.line().textContent}"`);
  assert(page.S.displayedScore.comparison.engineKey === key, `${key}: the number comes from the ${key} engine`);
});

console.log('\n3. Switching Japan -> US -> Thailand never overwrites the primary');
{
  const page = staffScreen(READINGS, 'japan');
  const seen = [];
  ['japan', 'usEpa', 'thailand'].forEach((key) => {
    page.setScoreReferenceStandard(key);
    seen.push(page.line().textContent);
    assert(page.S.displayedScore.score === EXPECTED.quality, `after selecting ${key}: primary still ${EXPECTED.quality}`);
    assert(page.S.scoreVal === EXPECTED.quality, `after selecting ${key}: score used for publish/share still ${EXPECTED.quality}`);
    assert(page.line().textContent === `${SHORT_EN[key]} Benchmark: ${EXPECTED[key]}`, `after selecting ${key}: line reads "${page.line().textContent}"`);
  });
  assert(new Set(seen).size === 3, `the line changed on every switch (${seen.join(' | ')})`);
}

console.log('\n4. Customer report is unaffected');
{
  const page = openScreen();
  const report = makeCase(READINGS, 'japan', { waterScore: 64, complianceStatus: 'FAIL', publicReportToken: 'rpt' });
  page.S.publicScoreView = true;
  page.S.activeJob = report;
  page.renderWaterScore(report, { publicView: true });
  assert(page.S.displayedScore.source === 'published' && page.S.displayedScore.score === 64, 'customer primary is the published score');
  assert(page.line().hidden === true && page.line().textContent === '', 'no benchmark line on first load');
  ENGINE_KEYS.forEach((key) => {
    page.setScoreReferenceStandard(key);
    assert(page.line().hidden === true && page.line().textContent === '', `no benchmark line after the customer selects ${key}`);
  });
  assert(page.S.displayedScore.score === 64 && page.S.displayedScore.source === 'published', 'published score unchanged after switching');
}

console.log('\nLabel comes from the existing standard names, in both languages');
{
  const th = staffScreen(READINGS, 'japan', 'th');
  assert(th.line().textContent === `มาตรฐานญี่ปุ่น: ${EXPECTED.japan}`, `Thai line reads "${th.line().textContent}"`);
  const i18n = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
  assert((i18n.match(/'score\.benchmark\.row':/g) || []).length === 2, 'label template exists once per language');
  const html = fs.readFileSync(path.join(root, 'src/pages/score.html'), 'utf8');
  assert((html.match(/id="score-benchmark-line"/g) || []).length === 1 && /id="score-benchmark-line" hidden/.test(html), 'one benchmark line element, hidden until rendered');
}

console.log('\nNo benchmark score -> no line');
{
  const noPh = { ...READINGS };
  delete noPh.ph;
  const page = staffScreen(noPh, 'japan');
  assert(page.S.displayedScore.comparison.score === null, 'the engine has no score without pH');
  assert(page.line().hidden === true && page.line().textContent === '', 'line stays hidden');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
