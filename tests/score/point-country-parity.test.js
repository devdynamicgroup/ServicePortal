/**
 * Staff and Full Assessment use one point/country gauge path.
 * Run: node tests/score/point-country-parity.test.js
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
      id, hidden: true, textContent: '', innerHTML: '', className: '', value: '', dataset: {},
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
      publicScoreView: false, taps: ['Kitchen', 'Bath'], scoreTapFilter: 'all', scorePointOrdinal: null,
      lastReadingsValidation: null, tapData: []
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  FILES.forEach((rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }));
  sandbox.nodes = nodes;
  return sandbox;
}

const KITCHEN = { ph: 7.4, tds: 60, chlorine: 0.4, turbidity: 0.2, orp: 450, do: 8, temp: 27 };
const BATH = { ph: 6.4, tds: 220, chlorine: 0.1, turbidity: 1.4, orp: 180, do: 4, temp: 29 };
const PARTIAL = { ph: 7.1, tds: 90, turbidity: 0.4, orp: 380 };

function jobWith(taps, extra = {}) {
  return {
    id: 'case',
    notionId: 'case',
    pkg: 'full',
    draft: {
      taps: taps.map((tap) => tap.name),
      fields: extra.fields || {},
      scoreStandardKey: 'thailand',
      tapData: taps.map((tap) => ({
        photos: { tapphoto: tap.photo || '' },
        standardMeasurement: tap.readings ? { ...tap.readings } : {}
      }))
    },
    result: extra.result || {}
  };
}

function scoreOf(page, readings, standardKey) {
  const raw = page.getCountryBenchmarkScore(readings, standardKey).score;
  return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

console.log('\nStaff gauge follows the selected point and country');
{
  const page = openScreen();
  const job = jobWith([
    { name: 'Kitchen', readings: KITCHEN },
    { name: 'Bath', readings: BATH }
  ]);
  page.S.activeJob = job;
  page.S.taps = ['Kitchen', 'Bath'];
  page.renderWaterScore(job, { publicView: false });
  const whole = scoreOf(page, page.resolveScoreReadings(job), 'thailand');
  const kitchen = scoreOf(page, KITCHEN, 'thailand');
  const bath = scoreOf(page, BATH, 'thailand');
  check('All is the Whole House country score', () => {
    assert.equal(page.S.displayedScore.score, whole);
    assert.notEqual(whole, kitchen);
  });
  page.setScorePointOrdinal(0);
  check('ordinal 0 scores only Kitchen', () => {
    assert.equal(page.S.scorePointOrdinal, 0);
    assert.equal(page.S.displayedScore.score, kitchen);
    assert.notEqual(page.S.displayedScore.score, whole);
  });
  page.setScorePointOrdinal(1);
  check('ordinal 1 scores only Bath', () => {
    assert.equal(page.S.displayedScore.score, bath);
    assert.notEqual(page.S.displayedScore.score, kitchen);
  });
  const publishedBefore = page.resolvePublishScoreRequest(job);
  page.setScoreReferenceStandard('japan');
  const japanBath = scoreOf(page, BATH, 'japan');
  check('country switch keeps the point', () => {
    assert.equal(page.S.scorePointOrdinal, 1);
    assert.equal(page.S.scoreStandardKey, 'japan');
    assert.equal(page.S.displayedScore.score, japanBath);
    assert.equal(page.S.displayedScore.standardKey, 'japan');
  });
  check('publish stays the Whole House score for the selected country', () => {
    const request = page.resolvePublishScoreRequest(job);
    assert.equal(request.scoreType, 'country-benchmark');
    assert.equal(request.standardKey, 'japan');
    assert.equal(request.score, scoreOf(page, page.resolveScoreReadings(job), 'japan'));
    assert.notEqual(request.score, japanBath);
    assert.equal(publishedBefore.scoreType, 'country-benchmark');
  });
  page.setScorePointOrdinal(null);
  check('All restores the Whole House score', () => {
    assert.equal(page.S.scorePointOrdinal, null);
    assert.equal(page.S.displayedScore.score, scoreOf(page, page.resolveScoreReadings(job), 'japan'));
  });
  const select = page.nodes['score-room-select-top'];
  page.setScorePointOrdinal(0);
  check('the location control selects by ordinal', () => {
    assert.ok(select.innerHTML.includes('value="0"'));
    assert.ok(select.innerHTML.includes('value="1"'));
    assert.equal(select.value, '0');
  });
}

console.log('\nDuplicate labels stay distinct');
{
  const page = openScreen();
  const job = jobWith([
    { name: 'Kitchen', readings: KITCHEN },
    { name: 'Kitchen', readings: BATH }
  ]);
  page.S.activeJob = job;
  page.S.taps = ['Kitchen', 'Kitchen'];
  page.renderWaterScore(job, { publicView: false });
  page.setScorePointOrdinal(0);
  const first = page.S.displayedScore.score;
  page.setScorePointOrdinal(1);
  check('ordinal 0 and ordinal 1 differ when the labels match', () => {
    assert.notEqual(first, page.S.displayedScore.score);
    assert.equal(page.S.displayedScore.score, scoreOf(page, BATH, 'thailand'));
  });
}

console.log('\nEmpty and incomplete points');
{
  const page = openScreen();
  const job = jobWith([
    { name: 'Kitchen', readings: KITCHEN },
    { name: 'Empty', readings: null },
    { name: 'Partial', readings: { ph: 7.2 } }
  ], { fields: { 'm-ph': '8.2', 'm-tds': '50', 'm-free-cl': '0.4', 'm-turb': '0.2', 'm-orp': '400', 'm-do': '8' } });
  page.S.activeJob = job;
  page.S.taps = ['Kitchen', 'Empty', 'Partial'];
  page.renderWaterScore(job, { publicView: false });
  const whole = page.S.displayedScore.score;
  page.setScorePointOrdinal(1);
  check('an empty point is unavailable and is not 0 or Whole House', () => {
    assert.equal(page.S.displayedScore.score, null);
    assert.notEqual(page.S.displayedScore.score, 0);
    assert.notEqual(page.S.displayedScore.score, whole);
    assert.equal(page.S.scorePointNotice, 'point-unavailable');
    assert.equal(page.nodes['score-summary-note'].textContent, page.t('score.point.unavailable'));
  });
  page.setScorePointOrdinal(2);
  check('a point missing required readings stays unavailable', () => {
    assert.equal(page.S.displayedScore.score, null);
    assert.equal(page.S.scorePointNotice, 'point-unavailable');
    assert.equal(page.S.comparisonScoreResult.readings.tds, undefined);
  });
  page.setScorePointOrdinal(null);
  check('returning to All still uses Whole House, including field readings', () => {
    assert.equal(page.S.displayedScore.score, whole);
    assert.ok(page.S.displayedScore.score != null);
  });
}

console.log('\nIncomplete point keeps its own usable readings');
{
  const page = openScreen();
  const job = jobWith([
    { name: 'Kitchen', readings: KITCHEN },
    { name: 'Partial', readings: PARTIAL }
  ]);
  page.S.activeJob = job;
  page.S.taps = ['Kitchen', 'Partial'];
  page.renderWaterScore(job, { publicView: false });
  page.setScorePointOrdinal(1);
  const own = scoreOf(page, PARTIAL, 'thailand');
  check('the partial point scores from its own readings', () => {
    assert.equal(own != null, true);
    assert.equal(page.S.displayedScore.score, own);
    assert.notEqual(page.S.displayedScore.score, scoreOf(page, KITCHEN, 'thailand'));
    assert.equal(page.S.comparisonScoreResult.readings.chlorine, undefined);
    assert.equal(page.S.comparisonScoreResult.readings.tds, 90);
  });
}

console.log('\nStaff and Full Assessment parity');
{
  const staff = openScreen();
  const staffJob = jobWith([
    { name: 'Kitchen', readings: KITCHEN },
    { name: 'Bath', readings: BATH }
  ]);
  staff.S.activeJob = staffJob;
  staff.S.taps = ['Kitchen', 'Bath'];
  staff.renderWaterScore(staffJob, { publicView: false });
  staff.setScoreReferenceStandard('eu');
  staff.setScorePointOrdinal(1);
  const staffScore = staff.S.displayedScore.score;

  const customer = openScreen();
  const report = jobWith([
    { name: 'Renamed later', readings: KITCHEN },
    { name: 'Also renamed', readings: { ph: 9, tds: 900, chlorine: 3, turbidity: 8, orp: 50, do: 1 } }
  ], {
    result: {
      waterScore: 70,
      scoreType: 'country-benchmark',
      standardKey: 'thailand',
      publicationSource: 'ledger',
      pointReadings: [
        { ordinal: 0, label: 'Kitchen', readings: { ...KITCHEN } },
        { ordinal: 1, label: 'Bath', readings: { ...BATH } }
      ]
    }
  });
  customer.S.publicScoreView = true;
  customer.S.activeJob = report;
  customer.S.taps = report.draft.taps;
  customer.renderWaterScore(report, { publicView: true });
  customer.setScoreReferenceStandard('eu');
  customer.setScorePointOrdinal(1);
  check('the same point, country, and readings produce the same score', () => {
    assert.equal(customer.S.displayedScore.score, staffScore);
    assert.equal(customer.S.displayedScore.score, scoreOf(customer, BATH, 'eu'));
    assert.notEqual(customer.S.displayedScore.score, scoreOf(customer, report.draft.tapData[1].standardMeasurement, 'eu'));
  });
  check('point browsing does not change the stored Whole House score', () => {
    assert.equal(report.result.waterScore, 70);
  });
  customer.setScorePointOrdinal(null);
  customer.setScoreReferenceStandard('thailand');
  check('All on the published standard restores the stored Whole House score', () => {
    assert.equal(customer.S.displayedScore.source, 'published');
    assert.equal(customer.S.displayedScore.score, 70);
  });
  const before = JSON.stringify(report.draft.tapData);
  customer.setScorePointOrdinal(1);
  check('the customer page does not edit point measurements', () => {
    assert.equal(JSON.stringify(report.draft.tapData), before);
  });
}

console.log('\nOld publications have no point history');
{
  const page = openScreen();
  const report = jobWith([
    { name: 'Kitchen', readings: KITCHEN },
    { name: 'Bath', readings: BATH }
  ], {
    result: {
      waterScore: 81,
      scoreType: 'country-benchmark',
      standardKey: 'thailand',
      publicationSource: 'ledger'
    }
  });
  page.S.publicScoreView = true;
  page.S.activeJob = report;
  page.S.taps = ['Kitchen', 'Bath'];
  page.renderWaterScore(report, { publicView: true });
  page.setScorePointOrdinal(0);
  check('a named point on an old publication is unavailable', () => {
    assert.equal(page.S.displayedScore.score, null);
    assert.equal(page.S.displayedScore.source, 'point-history-unavailable');
    assert.equal(page.S.scorePointNotice, 'history-unavailable');
    assert.equal(page.nodes['score-summary-note'].textContent, page.t('score.pointHistory.unavailable'));
    assert.notEqual(page.S.displayedScore.score, 81);
  });
  page.setScorePointOrdinal(null);
  check('All on that publication still shows the stored score', () => {
    assert.equal(page.S.displayedScore.score, 81);
    assert.equal(page.S.displayedScore.source, 'published');
  });
}

console.log('\nCustomer page stays read-only');
{
  const scoreHtml = fs.readFileSync(path.join(root, 'src/pages/score.html'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'api/case-flow-routes.js'), 'utf8');
  const stripped = scoreHtml
    .replace(/<button class="hdr-back"[\s\S]*?<\/button>/, '')
    .replace(/<div class="foot">[\s\S]*?<\/div>\s*<\/div>\s*$/, '<div class="foot hidden"></div>\n</div>\n');
  check('public markup removes the staff back control and Complete/Upgrade actions', () => {
    assert.ok(!stripped.includes('hdr-back'));
    assert.ok(!stripped.includes('completeScore()'));
    assert.ok(!stripped.includes('showPkgSheet()'));
  });
  check('Essential packages stay on the poster and Full Assessment stays on the score page', () => {
    assert.ok(routes.includes("return String(job?.pkg || 'essential').trim() !== 'full'"));
    assert.ok(routes.includes("return isFreeInspectionJob(job) ? 'card' : 'score'"));
  });
  const publicReport = fs.readFileSync(path.join(root, 'src/js/public-report.js'), 'utf8');
  check('the public report does not expose assessment editing', () => {
    assert.ok(publicReport.includes('S.publicScoreView = true'));
    assert.ok(!publicReport.includes('addTap('));
    assert.ok(!publicReport.includes('completeScore('));
    assert.ok(!publicReport.includes('liveUpdateTapName'));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
