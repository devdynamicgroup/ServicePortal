/**
 * Staff Score screen shows two separate values:
 *   primary   -> the selected country engine's benchmark score (changes with the country)
 *   secondary -> the Water Score the customer sees (Quality V3 / published; never changes with the country)
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
  sandbox.line = () => node('score-customer-line');
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

console.log('\n1. Staff primary is the selected country engine; the customer line stays on Quality V3');
ENGINE_KEYS.forEach((key) => {
  const page = staffScreen(READINGS, key);
  assert(page.S.displayedScore.source === 'country-benchmark' && page.S.displayedScore.engineKey === key, `${key}: primary comes from the ${key} engine`);
  assert(page.S.displayedScore.score === engineScore(key), `${key}: primary is ${engineScore(key)}`);
  assert(page.line().hidden === false && page.line().textContent === `Customer Water Score: ${EXPECTED.quality}`, `${key}: line reads "${page.line().textContent}"`);
  assert(page.S.scoreVal === EXPECTED.quality, `${key}: the score sent on publish/share is still Quality V3 ${EXPECTED.quality}`);
});

console.log('\n2. Switching Japan -> US -> Thailand changes the primary, never the customer score');
{
  const page = staffScreen(READINGS, 'japan');
  const primaries = [];
  ['japan', 'usEpa', 'thailand'].forEach((key) => {
    page.setScoreReferenceStandard(key);
    primaries.push(page.S.displayedScore.score);
    assert(page.S.displayedScore.score === EXPECTED[key], `after selecting ${key}: primary is ${EXPECTED[key]}`);
    assert(page.line().textContent === `Customer Water Score: ${EXPECTED.quality}`, `after selecting ${key}: customer line still ${EXPECTED.quality}`);
    assert(page.S.scoreVal === EXPECTED.quality && page.S.currentScoreResult.score === EXPECTED.quality, `after selecting ${key}: publish score still ${EXPECTED.quality}`);
  });
  assert(new Set(primaries).size === 3, `the primary changed on every switch (${primaries.join(', ')})`);
}

console.log('\n3. Once published, the line shows what the customer actually has');
{
  const page = staffScreen(READINGS, 'japan', { result: { waterScore: 91, publicReportToken: 'rpt' } });
  assert(page.S.currentScoreResult.score === EXPECTED.quality, `live Quality V3 is ${EXPECTED.quality}`);
  assert(page.line().textContent === 'Customer Water Score: 91', `line shows the published 91, not the live ${EXPECTED.quality} ("${page.line().textContent}")`);
  page.setScoreReferenceStandard('usEpa');
  assert(page.line().textContent === 'Customer Water Score: 91', 'switching country does not change the published number');
  const zero = staffScreen(READINGS, 'japan', { result: { waterScore: 0, publicReportToken: 'rpt' } });
  assert(zero.line().textContent === 'Customer Water Score: 0', 'a published score of 0 is shown as 0');
  const unpublished = staffScreen(READINGS, 'japan', { result: { waterScore: null, publicReportToken: 'rpt' } });
  assert(unpublished.line().textContent === `Customer Water Score: ${EXPECTED.quality}`, 'a null pointer is not read as a published 0');
}

console.log('\n4. Customer report is unaffected');
{
  const page = openScreen();
  const report = makeCase(READINGS, 'japan', { waterScore: 64, complianceStatus: 'FAIL', publicReportToken: 'rpt' });
  page.S.publicScoreView = true;
  page.S.activeJob = report;
  page.renderWaterScore(report, { publicView: true });
  assert(page.S.displayedScore.source === 'published' && page.S.displayedScore.score === 64, 'customer primary is the published score');
  assert(page.line().hidden === true && page.line().textContent === '', 'no secondary line on the customer report');
}

console.log('\n5. No customer score yet -> no line; the country primary still shows');
{
  const noDo = { ...READINGS };
  delete noDo.do;
  const page = staffScreen(noDo, 'japan');
  assert(page.S.currentScoreResult.score === null, 'Quality V3 is unavailable without DO');
  assert(Number.isFinite(page.S.displayedScore.score), `Japan benchmark is still the primary (${page.S.displayedScore.score})`);
  assert(page.line().hidden === true && page.line().textContent === '', 'customer line stays hidden');
}

console.log('\nLabel and markup');
{
  const th = staffScreen(READINGS, 'japan', { lang: 'th' });
  assert(th.line().textContent === `Water Score ที่ลูกค้าเห็น: ${EXPECTED.quality}`, `Thai line reads "${th.line().textContent}"`);
  const i18n = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
  assert((i18n.match(/'score\.customerScore\.row':/g) || []).length === 2, 'label template exists once per language');
  const html = fs.readFileSync(path.join(root, 'src/pages/score.html'), 'utf8');
  assert((html.match(/id="score-customer-line"/g) || []).length === 1 && /id="score-customer-line" hidden/.test(html), 'one line element, hidden until rendered');
  assert(!html.includes('score-benchmark-line'), 'the earlier benchmark line element is gone');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
