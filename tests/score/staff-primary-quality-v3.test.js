/**
 * The primary Water Score is Quality V3 on both screens:
 *   staff    -> Quality V3 of the current assessment
 *   customer -> the published Quality V3 snapshot
 * The selected country benchmark is comparison data only.
 *
 * Loads the real engine files and src/js/flows/score.js into one vm sandbox and
 * drives the real render entry points; publication goes through the real
 * publication service with the in-memory ledger. No Notion.
 *
 * Run: node tests/score/staff-primary-quality-v3.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  createOrReusePublication,
  resolveReportByToken,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies
} = require('../../services/score-publication-service');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');
const { computeCanonicalScore } = require('../../services/canonical-score');

const root = path.join(__dirname, '../..');
const ENGINE_KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];
const FILES = [
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

/** A fresh page: the unmodified score.js with a minimal DOM. */
function openScreen() {
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const node = () => ({
    hidden: true, textContent: '', innerHTML: '', className: '', dataset: {},
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, removeAttribute() {}, querySelector() { return node(); }, querySelectorAll() { return []; },
    replaceChildren() {}, appendChild() {}, addEventListener() {}, children: [], childNodes: []
  });
  const sandbox = {
    console: quiet,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    document: { getElementById: () => node(), querySelector: () => null, querySelectorAll: () => [] },
    t: (key) => key,
    S: {
      lang: 'en', scoreStandardKey: 'thailand', activeJob: null, scoreBaseReadings: null, scoreVal: null,
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

function staffScreen(job, standardKey = 'thailand') {
  const page = openScreen();
  const staffJob = JSON.parse(JSON.stringify(job));
  staffJob.draft.scoreStandardKey = standardKey;
  page.S.activeJob = staffJob;
  page.renderWaterScore(staffJob, { publicView: false });
  return page;
}

function customerScreen(report) {
  const page = openScreen();
  page.S.publicScoreView = true;
  page.S.activeJob = report;
  page.renderWaterScore(report, { publicView: true });
  return page;
}

const makeCase = (id, readings) => ({
  id,
  notionId: id,
  pkg: 'full',
  draft: { taps: ['Tap 1'], fields: {}, tapData: [{ standardMeasurement: { ...readings } }] },
  result: {}
});

// Clean on every Quality curve, but pH 7.2 is outside Japan's 7.3-7.7 comfort
// band, so the country engines disagree with each other and with Quality.
const CLEAN = { ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, do: 8, chlorine: 0.35 };
const MIXED = { ph: 7.9, tds: 260, turbidity: 0.6, orp: 520, do: 6.4, chlorine: 0.8 };

async function main() {
  const reference = openScreen();
  const qualityOf = (readings) => reference.computeQualityScoreDetail(readings).score;
  const countryOf = (readings, key) => reference.WaterScoreBenchmarkRegistry.calculate(key, readings).score;

  console.log('\n1. Staff primary uses Quality V3');
  for (const [name, readings] of [['clean', CLEAN], ['mixed', MIXED]]) {
    const page = staffScreen(makeCase(name, readings));
    const quality = qualityOf(readings);
    assert(page.S.displayedScore.score === quality, `${name}: staff primary ${page.S.displayedScore.score} === Quality V3 ${quality}`);
    assert(page.S.displayedScore.source === 'quality-v3' && page.S.displayedScore.engineKey === 'quality-v3', `${name}: primary source is quality-v3`);
    assert(page.S.displayedScore.score === page.S.currentScoreResult.score, `${name}: primary is the already-computed currentScoreResult.score`);
  }
  {
    const page = staffScreen(makeCase('clean-th', CLEAN), 'thailand');
    assert(countryOf(CLEAN, 'thailand') === 99 && page.S.displayedScore.score === 100,
      `the old source (Thailand benchmark ${countryOf(CLEAN, 'thailand')}) is no longer the primary (${page.S.displayedScore.score})`);
  }

  console.log('\n2. Changing country does not change the staff primary');
  {
    const page = staffScreen(makeCase('switch', MIXED));
    const quality = qualityOf(MIXED);
    const primaries = [];
    const benchmarks = [];
    ENGINE_KEYS.forEach((key) => {
      page.setScoreReferenceStandard(key);
      primaries.push(page.S.displayedScore.score);
      benchmarks.push(page.S.displayedScore.comparison.score);
      assert(page.S.displayedScore.comparison.engineKey === key, `${key}: comparison follows the selected country`);
      assert(page.S.displayedScore.comparison.score === countryOf(MIXED, key), `${key}: comparison is that engine's own score (${countryOf(MIXED, key)})`);
    });
    assert(primaries.every((score) => score === quality), `primary stays ${quality} across all countries (${primaries.join(',')})`);
    assert(new Set(benchmarks).size > 1, `the comparison does change with the country (${benchmarks.join(',')})`);
    assert(page.S.scoreVal === quality, 'the score submitted for publish/share is still Quality V3');
  }

  console.log('\n4. Incomplete Quality V3 does not fall back to the country benchmark');
  for (const key of ENGINE_KEYS) {
    const noDo = { ...CLEAN };
    delete noDo.do;
    const page = staffScreen(makeCase(`nodo-${key}`, noDo), key);
    const country = page.S.displayedScore.comparison.score;
    assert(qualityOf(noDo) === null, `${key}: Quality V3 is unavailable without DO`);
    assert(Number.isFinite(country), `${key}: the country benchmark is still computed without DO (${country})`);
    assert(page.S.displayedScore.score === null && page.S.displayedScore.showScore === false,
      `${key}: staff primary stays unavailable instead of showing ${country}`);
  }
  {
    const page = openScreen();
    const zero = page.resolveDisplayedScore({ publicView: false, publishedScore: 0, readings: CLEAN, standardKey: 'thailand' });
    const missing = page.resolveDisplayedScore({ publicView: false, publishedScore: null, readings: CLEAN, standardKey: 'thailand' });
    assert(zero.score === 0 && zero.showScore === true, 'a real Quality score of 0 is shown as 0');
    assert(missing.score === null && missing.showScore === false, 'a missing Quality score is not coerced to 0');
  }

  console.log('\n5. Country benchmark remains available as comparison data');
  {
    const page = staffScreen(makeCase('comparison', CLEAN), 'japan');
    const comparison = page.S.displayedScore.comparison;
    assert(comparison && comparison.engineKey === 'japan' && comparison.score === countryOf(CLEAN, 'japan'), `comparison carries the Japan benchmark (${comparison && comparison.score})`);
    assert(comparison.classifications && comparison.classifications.ph === 'WARNING', 'comparison keeps the engine classifications');
    assert(page.S.comparisonScoreResult.score === comparison.score, 'S.comparisonScoreResult is the same benchmark result');
  }

  console.log('\n3 + 6. Customer primary is the published score, and equals the staff primary for an unchanged assessment');
  const store = createMemoryPublicationStore();
  const cases = new Map();
  setPublicationStore(store);
  setPublicationCaseAdapter({
    getClient: async (id) => JSON.parse(JSON.stringify(cases.get(id))),
    updateClient: async (id, payload) => {
      const current = cases.get(id);
      current.result = { ...current.result, waterScore: payload.latestWaterScore, publicReportToken: payload.publicReportToken, reportUrl: payload.reportUrl };
      return JSON.parse(JSON.stringify(current));
    },
    findClientByReportToken: async () => null
  });
  for (const [name, readings] of [['clean', CLEAN], ['mixed', MIXED]]) {
    const job = makeCase(`pub-${name}`, readings);
    cases.set(job.id, job);
    const staff = staffScreen(job, 'japan');
    const published = await createOrReusePublication({
      job: JSON.parse(JSON.stringify(job)),
      caseId: job.id,
      payload: { score: staff.S.scoreVal, intent: 'publish', idempotencyKey: `pub-${name}` }
    });
    const customer = customerScreen(await resolveReportByToken(published.reportToken));
    assert(published.score === computeCanonicalScore(job).score, `${name}: the server accepted the staff score as canonical (${published.score})`);
    assert(customer.S.displayedScore.source === 'published' && customer.S.displayedScore.score === published.score, `${name}: customer primary is the published score (${customer.S.displayedScore.score})`);
    assert(staff.S.displayedScore.score === customer.S.displayedScore.score, `${name}: staff primary ${staff.S.displayedScore.score} === customer primary ${customer.S.displayedScore.score}`);
    assert(staff.S.displayedScore.comparison.score !== staff.S.displayedScore.score || name === 'never',
      `${name}: the Japan benchmark (${staff.S.displayedScore.comparison.score}) differs and would have been the old staff number`);
  }

  console.log('\nAfter the Case is edited: staff is live, the old publication stays frozen');
  {
    const job = cases.get('pub-clean');
    const token = job.result.publicReportToken;
    job.draft.tapData[0].standardMeasurement.chlorine = 0.03;
    const staff = staffScreen(job);
    const customer = customerScreen(await resolveReportByToken(token));
    assert(staff.S.displayedScore.score === qualityOf({ ...CLEAN, chlorine: 0.03 }), `staff shows the new live Quality V3 (${staff.S.displayedScore.score})`);
    assert(customer.S.displayedScore.score === 100, `customer still shows the frozen published score (${customer.S.displayedScore.score})`);
    assert(customer.resolveScoreReadings(customer.S.activeJob).chlorine === 0.35, 'customer still reads the frozen chlorine 0.35');
    customer.setScoreReferenceStandard('japan');
    assert(customer.S.displayedScore.score === 100 && customer.S.displayedScore.source === 'published', 'customer switching country keeps the published score');
  }

  console.log('\nCustomer path of resolveDisplayedScore is unchanged');
  {
    const page = openScreen();
    const published = page.resolveDisplayedScore({ publicView: true, publishedScore: 72, readings: MIXED, standardKey: 'japan' });
    assert(published.score === 72 && published.source === 'published' && published.comparison === null, 'published score, no comparison attached');
    const nonNumeric = page.resolveDisplayedScore({ publicView: true, publishedScore: NaN, readings: MIXED, standardKey: 'japan' });
    assert(nonNumeric.source === 'country-benchmark' && nonNumeric.score === countryOf(MIXED, 'japan'), 'pre-existing public fallback for a non-numeric published score is preserved as-is');
  }

  resetPublicationDependencies();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
