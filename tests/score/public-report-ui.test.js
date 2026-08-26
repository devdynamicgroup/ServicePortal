/**
 * Public /r/{token} Full Water Score UI — render path + publication alignment.
 * VM sandbox (no browser). Proves published score display, readings, null/0 edges.
 *
 * Run: node tests/score/public-report-ui.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { applyPublicationToJob, buildSnapshot } = require('../../services/score-publication-snapshot');

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

const domStore = {};
const gauge = {
  id: 'gauge-val',
  textContent: '—',
  hidden: false,
  style: { setProperty() {} },
  classList: { toggle() {}, add() {}, remove() {} }
};
const readingsList = { innerHTML: '', classList: { remove() {} }, children: [] };

function stubEl(id) {
  if (id === 'gauge-val') return gauge;
  if (id === 'score-readings-rows') return readingsList;
  return {
    id,
    hidden: false,
    textContent: '',
    innerHTML: '',
    style: { setProperty() {}, width: '', background: '', color: '', left: '' },
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => stubEl(),
    dataset: {},
    onchange: null,
    replaceChildren() {}
  };
}

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  document: {
    getElementById: stubEl,
    querySelector: (sel) => {
      if (sel === '#score-hero .score-summary-card') return stubEl('score-summary-card');
      return stubEl();
    },
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
    scoreTapFilter: 'Kitchen',
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
function ok(msg) {
  passed += 1;
  console.log(`  PASS  ${msg}`);
}
function fail(msg, err) {
  failed += 1;
  console.error(`  FAIL  ${msg}`);
  console.error(err && err.stack ? err.stack : err);
}

const READINGS = Object.freeze({
  ph: 7.2,
  tds: 80,
  chlorine: 0.3,
  turbidity: 0.2,
  orp: 400,
  do: 7.5,
  temp: 25
});

function paidJob(waterScore, id = 'paid-case') {
  return {
    id,
    notionId: id,
    name: 'Paid Customer',
    campaignOffer: '',
    result: {
      waterScore,
      publicReportToken: `tok-${id}`,
      complianceStatus: waterScore === 0 ? 'FAIL' : 'PASS'
    },
    draft: {
      taps: ['Kitchen'],
      fields: {},
      tapData: [{
        tasks: { meter: true, chlorine: true },
        photos: {},
        meterReadings: { ...READINGS },
        chlorineReadings: { freeChlorine: READINGS.chlorine },
        standardMeasurement: { ...READINGS }
      }]
    }
  };
}

function renderPublic(job) {
  gauge.textContent = '—';
  gauge.hidden = false;
  readingsList.innerHTML = '';
  sandbox.S.activeJob = job;
  sandbox.S.publicScoreView = true;
  sandbox.S.tapData = JSON.parse(JSON.stringify(job.draft.tapData || []));
  const score = sandbox.renderWaterScore(job, { publicView: true });
  return {
    score,
    productionScore: sandbox.S.scoreVal,
    displayed: sandbox.S.displayedScore,
    source: sandbox.S.currentScoreResult?.source,
    computedScore: sandbox.S.currentScoreResult?.computedScore,
    gaugeText: gauge.textContent,
    gaugeHidden: gauge.hidden,
    readingsHtml: readingsList.innerHTML,
    baseReadings: { ...sandbox.S.scoreBaseReadings }
  };
}

console.log('\n=== Public report UI — published score display ===\n');

try {
  const out = renderPublic(paidJob(75));
  assert.strictEqual(out.productionScore, 75);
  assert.strictEqual(out.displayed.score, 75);
  assert.strictEqual(out.displayed.source, 'published');
  assert.strictEqual(out.source, 'published');
  assert.notStrictEqual(out.computedScore, out.productionScore, 'computed may differ; hero uses published');
  ok('Paid score 75: displayed from published, not recomputed hero');
} catch (e) {
  fail('Paid score 75', e);
}

try {
  const out = renderPublic(paidJob(0));
  assert.strictEqual(out.productionScore, 0);
  assert.strictEqual(out.displayed.score, 0);
  assert.strictEqual(out.displayed.showScore, true);
  ok('Paid score 0: renders as real 0, not missing');
} catch (e) {
  fail('Paid score 0', e);
}

try {
  const out = renderPublic(paidJob(null));
  assert.strictEqual(out.productionScore, null);
  assert.strictEqual(out.displayed.showScore, false);
  assert.strictEqual(out.displayed.score, null);
  assert.strictEqual(gauge.textContent, '—', 'null score shows dash, not 0');
  ok('Paid null: missing-state, not coerced to 0');
} catch (e) {
  fail('Paid null score', e);
}

try {
  const job = paidJob(null, 'case-computed-fallback');
  const out = renderPublic(job);
  assert.ok(Number.isFinite(out.computedScore), 'readings would compute a finite score');
  assert.notStrictEqual(out.computedScore, null);
  assert.strictEqual(out.productionScore, null, 'public hero must not use computedScore');
  assert.strictEqual(out.displayed.score, null);
  assert.strictEqual(out.displayed.showScore, false);
  assert.notStrictEqual(out.displayed.score, out.computedScore, 'must not show computed score on public path');
  assert.strictEqual(gauge.textContent, '—');
  ok(`Paid missing published: computed=${out.computedScore} but UI shows — (no recompute)`);
} catch (e) {
  fail('Paid missing published vs computed fallback', e);
}

console.log('\n=== Public report UI — readings integrity ===\n');

try {
  const out = renderPublic(paidJob(75));
  const keys = ['pH', 'TDS', 'Chlorine', 'Turbidity', 'ORP', 'DO'];
  for (const key of keys) {
    assert.ok(out.readingsHtml.includes(key), `readings row includes ${key}`);
  }
  assert.strictEqual(out.baseReadings.ph, READINGS.ph);
  assert.strictEqual(out.baseReadings.tds, READINGS.tds);
  assert.strictEqual(out.baseReadings.chlorine, READINGS.chlorine);
  ok('Paid readings: all 6 params rendered from Case tapData');
} catch (e) {
  fail('Paid readings integrity', e);
}

console.log('\n=== Publication → public report alignment ===\n');

try {
  const caseJob = paidJob(55, 'case-pub');
  caseJob.result.waterScore = 40; // stale Case pointer
  const snapshot = buildSnapshot({
    publishedScore: 75,
    publicReportToken: 'tok-pub-75',
    publicationId: 'pub-1',
    clientPageId: caseJob.notionId,
    caseId: caseJob.id,
    readings: READINGS,
    complianceStatus: 'PASS'
  });
  const merged = applyPublicationToJob(caseJob, { snapshot });
  assert.strictEqual(merged.result.waterScore, 75, 'publication overlays Case score');
  assert.strictEqual(merged.draft.scoreBaseReadings.ph, READINGS.ph);

  const out = renderPublic(merged);
  assert.strictEqual(out.productionScore, 75);
  assert.strictEqual(out.displayed.score, 75);
  assert.strictEqual(out.displayed.source, 'published');
  ok('Publication 75 overrides stale Case 40 in public UI');
} catch (e) {
  fail('Publication alignment', e);
}

console.log('\n=== Cross-case isolation ===\n');

try {
  const jobA = paidJob(75, 'case-a');
  const jobB = paidJob(55, 'case-b');
  jobB.draft.tapData[0].meterReadings.ph = 6.1;
  jobB.draft.tapData[0].standardMeasurement.ph = 6.1;
  renderPublic(jobA);
  const fpA = JSON.stringify(sandbox.S.scoreBaseReadings);
  const outB = renderPublic(jobB);
  assert.notStrictEqual(outB.baseReadings.ph, READINGS.ph);
  assert.notStrictEqual(JSON.stringify(outB.baseReadings), fpA);
  assert.strictEqual(outB.productionScore, 55);
  ok('Case B render does not reuse Case A readings/score');
} catch (e) {
  fail('Cross-case isolation', e);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
