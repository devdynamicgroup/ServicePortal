/**
 * An empty point must not keep Whole House validation context.
 * Run: node tests/score/empty-point-validation-context.test.js
 */
const assert = require('assert');
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
function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok   ', label);
  } catch (error) {
    failed += 1;
    console.error('  FAIL ', label, '\n        ', error.message);
  }
}

function openScreen() {
  const nodes = {};
  const node = (id) => {
    if (id && nodes[id]) return nodes[id];
    const el = {
      id, hidden: false, textContent: '', innerHTML: '', className: '', value: '', dataset: {},
      style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      setAttribute() {}, removeAttribute() {},
      querySelector() { return node(); },
      querySelectorAll() { return []; },
      replaceChildren() {}, appendChild() {}, addEventListener() {},
      children: [], childNodes: []
    };
    if (id) nodes[id] = el;
    return el;
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    document: { getElementById: (id) => node(id), querySelector: () => null, querySelectorAll: () => [] },
    S: {
      lang: 'en', scoreStandardKey: 'thailand', activeJob: null, scoreBaseReadings: null, scoreVal: null,
      currentScoreResult: null, comparisonScoreResult: null, displayedScore: null, scoreParamOpen: null,
      publicScoreView: false, taps: ['Kitchen', 'Empty'], scoreTapFilter: 'all', scorePointOrdinal: null,
      lastReadingsValidation: null, lastReadingsPresent: null, tapData: []
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  FILES.forEach((rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }));
  sandbox.nodes = nodes;
  return sandbox;
}

const KITCHEN = { ph: 7.4, tds: 60, chlorine: 0.4, turbidity: 0.2, orp: 450, do: 70, temp: 27 };

function job() {
  return {
    id: 'case',
    notionId: 'case',
    pkg: 'full',
    draft: {
      taps: ['Kitchen', 'Empty'],
      fields: {},
      scoreStandardKey: 'thailand',
      tapData: [
        { standardMeasurement: { ...KITCHEN } },
        { standardMeasurement: {} }
      ]
    },
    result: {}
  };
}

function doRow(page) {
  return page.rowsForScorePopulation().find((row) => row.p === 'DO');
}

console.log('\nEmpty point drops Whole House implausible context');
{
  const page = openScreen();
  const active = job();
  page.S.activeJob = active;
  page.S.taps = ['Kitchen', 'Empty'];
  page.renderWaterScore(active, { publicView: false });
  check('All shows the Whole House implausible DO value', () => {
    assert.equal(page.S.lastReadingsValidation.fields.do.state, 'IMPLAUSIBLE');
    assert.equal(page.S.lastReadingsPresent.do, 70);
    assert.equal(doRow(page).r, '70.0 mg/L');
    assert.ok(page.S.displayedScore.score != null);
  });
  page.setScorePointOrdinal(1);
  check('the empty point gauge is unavailable', () => {
    assert.equal(page.S.displayedScore.score, null);
    assert.notEqual(page.S.displayedScore.score, 0);
    assert.equal(page.S.scorePointNotice, 'point-unavailable');
    assert.equal(page.nodes['gauge-val'].textContent, '—');
  });
  check('the empty point does not display the Whole House DO value', () => {
    const row = doRow(page);
    assert.notEqual(row.r, '70.0 mg/L');
    assert.notEqual(row.st, 'implausible');
    assert.ok(!page.rowsForScorePopulation().some((item) => String(item.r).includes('70')));
    assert.ok(!page.rowsForScorePopulation().some((item) => String(item.r).includes('60')));
    assert.equal(page.S.lastReadingsValidation, null);
    assert.equal(page.S.lastReadingsPresent.do, undefined);
  });
  page.setScorePointOrdinal(null);
  check('All restores the Whole House DO value and validation', () => {
    assert.equal(page.S.scorePointOrdinal, null);
    assert.equal(page.S.lastReadingsValidation.fields.do.state, 'IMPLAUSIBLE');
    assert.equal(page.S.lastReadingsPresent.do, 70);
    assert.equal(doRow(page).r, '70.0 mg/L');
    assert.ok(page.S.displayedScore.score != null);
  });
}

console.log('\nA point keeps an implausible value that belongs to it');
{
  const page = openScreen();
  const active = job();
  page.S.activeJob = active;
  page.S.taps = ['Kitchen', 'Empty'];
  page.renderWaterScore(active, { publicView: false });
  page.setScorePointOrdinal(0);
  check('Kitchen still shows its own implausible DO', () => {
    const row = doRow(page);
    assert.equal(row.r, '70.0 mg/L');
    assert.equal(row.st, 'implausible');
    assert.equal(page.S.lastReadingsValidation.fields.do.state, 'IMPLAUSIBLE');
    assert.equal(page.S.lastReadingsPresent.do, 70);
    assert.ok(page.S.displayedScore.score != null);
  });
  page.setScorePointOrdinal(1);
  check('leaving Kitchen clears that implausible DO from the empty point', () => {
    assert.notEqual(doRow(page).r, '70.0 mg/L');
    assert.equal(page.S.lastReadingsPresent.do, undefined);
    assert.equal(page.S.displayedScore.score, null);
  });
  page.setScorePointOrdinal(0);
  check('returning to Kitchen shows its implausible DO again', () => {
    assert.equal(doRow(page).r, '70.0 mg/L');
    assert.equal(doRow(page).st, 'implausible');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
