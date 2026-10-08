/**
 * Customer ledger rows use the frozen publication readings only when
 * applyPublicationToJob copied a complete snapshot. Staff and old ledgers stay live.
 *
 * Run: node tests/score/ledger-frozen-readings.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { computeCanonicalScore } = require('../../services/canonical-score');
const { applyPublicationToJob } = require('../../services/score-publication-snapshot');
const {
  createOrReusePublication,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies
} = require('../../services/score-publication-service');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');

const root = path.join(__dirname, '../..');
const FROZEN = Object.freeze({
  ph: 7.2, tds: 80, chlorine: 0.3, turbidity: 0.1, orp: 400, do: 8, temp: 25
});
const LIVE = Object.freeze({
  ph: 9.1, tds: 900, chlorine: 0.01, turbidity: 4.2, orp: 180, do: 2.1, temp: 33
});

function tap(readings) {
  return { standardMeasurement: readings ? { ...readings } : {} };
}

function caseJob(id, readings) {
  return {
    id,
    notionId: id,
    name: id,
    draft: {
      taps: ['Room 1'],
      fields: {},
      tapData: [tap(readings)],
      scoreBaseReadings: null
    },
    result: { waterScore: null, publicReportToken: '' }
  };
}

const nodes = {};
function makeNode(id) {
  const node = {
    id,
    hidden: true,
    textContent: '',
    innerHTML: '',
    className: '',
    dataset: {},
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute() {},
    removeAttribute() {},
    querySelector() { return makeNode('nested'); },
    querySelectorAll() { return []; },
    replaceChildren() {},
    appendChild() {},
    addEventListener() {},
    children: [],
    childNodes: [],
    firstChild: null,
    nextSibling: null,
    parentNode: null,
    insertBefore(child) {
      child.parentNode = this;
      this.firstChild = child;
    }
  };
  if (id) nodes[id] = node;
  return node;
}
['score-hero', 'score-hero-source', 'score-published-line', 'score-compliance-line', 'score-benchmark-line', 'score-room-status', 'score-current-assessment', 'score-status-bar', 'gauge-val', 'score-summary-band', 'score-summary-note', 'score-readings-rows', 'score-params-scope', 'score-indicator-count', 'score-content-panel'].forEach(makeNode);
nodes['score-status-bar'].parentNode = makeNode('summary-card');

const sandbox = {
  console,
  performance: { now: () => 0 },
  requestAnimationFrame(cb) {
    if (typeof cb === 'function') cb(2000);
    return 1;
  },
  document: {
    getElementById: (id) => nodes[id] || makeNode(id),
    querySelector: (sel) => (String(sel).includes('score-content-panel') ? nodes['score-content-panel'] : null),
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
    publicScoreView: false,
    taps: ['Room 1'],
    scoreTapFilter: 'all',
    lastReadingsValidation: null
  }
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
[
  'src/js/i18n.js',
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/validation/measurementValidator.js',
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
].forEach((rel) => {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
});

function rowText() {
  return nodes['score-readings-rows'].innerHTML;
}

function render(job, publicView) {
  sandbox.S.lang = 'en';
  sandbox.S.scoreStandardKey = 'thailand';
  sandbox.S.activeJob = job;
  sandbox.S.publicScoreView = publicView;
  sandbox.renderWaterScore(job, { publicView });
}

function assertFrozenRows(html, label) {
  assert(html.includes('>7.2<'), `${label} pH 7.2`);
  assert(html.includes('80 mg/L'), `${label} TDS 80`);
  assert(html.includes('0.3 mg/L'), `${label} chlorine 0.3`);
  assert(html.includes('0.1 NTU'), `${label} turbidity 0.1`);
  assert(html.includes('400 mV'), `${label} ORP 400`);
  assert(html.includes('8.0 mg/L'), `${label} DO 8`);
  assert(!html.includes('9.1'), `${label} omits live pH`);
  assert(!html.includes('900'), `${label} omits live TDS`);
  assert(!html.includes('4.2'), `${label} omits live turbidity`);
}

function assertLiveRows(html, label) {
  assert(html.includes('9.1'), `${label} live pH`);
  assert(html.includes('900 mg/L'), `${label} live TDS`);
  assert(html.includes('4.2 NTU'), `${label} live turbidity`);
  assert(html.includes('180 mV'), `${label} live ORP`);
  assert(!html.includes('>7.2<'), `${label} does not invent frozen pH`);
  assert(!html.includes('80 mg/L'), `${label} does not invent frozen TDS`);
}

async function main() {
  const store = createMemoryPublicationStore();
  setPublicationStore(store);
  setPublicationCaseAdapter({
    async getClient() { return null; },
    async updateClient() { return { id: 'updated', result: {} }; },
    async findClientByReportToken() { return null; }
  });

  const source = caseJob('case-ledger', FROZEN);
  const canonical = computeCanonicalScore(source);
  assert(canonical.score !== null, 'publish readings produce a canonical score');
  const created = await createOrReusePublication({
    job: source,
    caseId: source.id,
    payload: {
      score: canonical.score,
      intent: 'publish',
      idempotencyKey: 'ledger-frozen-1',
      modelVersion: 'quality-v3.0',
      resultSummary: `Water score ${Math.round(canonical.score)}/100`
    }
  });
  const snapshot = store._rows.find((row) => row.publicationId === created.publicationId).snapshot;
  assert.strictEqual(snapshot.scoreType, 'quality-v3');
  assert.strictEqual(snapshot.publishedScore, Math.round(canonical.score));
  assert.strictEqual(snapshot.readings.ph, 7.2);
  assert.strictEqual(snapshot.readings.tds, 80);

  const liveScore = computeCanonicalScore(caseJob('case-live', LIVE)).score;
  assert.notStrictEqual(Math.round(liveScore), snapshot.publishedScore, 'later live case scores differently');

  console.log('\n1. New ledger keeps frozen rows after live tapData changes');
  {
    const view = applyPublicationToJob(caseJob('case-ledger', LIVE), { snapshot });
    assert.strictEqual(view.result.publicationSource, 'ledger');
    assert.strictEqual(view.result.publicationReadingsSource, 'snapshot');
    assert.strictEqual(view.result.waterScore, snapshot.publishedScore);
    render(view, true);
    assert.strictEqual(sandbox.S.scoreVal, snapshot.publishedScore);
    assert.strictEqual(String(nodes['gauge-val'].textContent), String(snapshot.publishedScore));
    assert.strictEqual(sandbox.S.displayedScore.source, 'published');
    assertFrozenRows(rowText(), 'changed taps');
  }

  console.log('\n2. Old ledger without snapshot readings keeps the live fallback');
  {
    const stale = caseJob('case-old', LIVE);
    stale.draft.scoreBaseReadings = { ...FROZEN };
    stale.result.waterScore = 99;
    const view = applyPublicationToJob(stale, {
      snapshot: {
        publishedScore: snapshot.publishedScore,
        publicReportToken: 'rpt-old',
        publicationId: 'pub-old',
        scoreType: 'quality-v3'
      }
    });
    assert.strictEqual(view.result.publicationSource, 'ledger');
    assert.strictEqual(view.result.publicationReadingsSource, undefined);
    assert.strictEqual(view.draft.scoreBaseReadings.ph, 7.2);
    render(view, true);
    assert.strictEqual(sandbox.S.scoreVal, snapshot.publishedScore);
    assertLiveRows(rowText(), 'old ledger');

    const partial = applyPublicationToJob(caseJob('case-partial', LIVE), {
      snapshot: {
        publishedScore: snapshot.publishedScore,
        publicReportToken: 'rpt-partial',
        publicationId: 'pub-partial',
        readings: { ph: 7.2 }
      }
    });
    assert.strictEqual(partial.result.publicationReadingsSource, undefined);
    render(partial, true);
    assertLiveRows(rowText(), 'partial snapshot');
  }

  console.log('\n3. Staff view still uses live readings');
  {
    const view = applyPublicationToJob(caseJob('case-staff', LIVE), { snapshot });
    render(view, false);
    assert.strictEqual(sandbox.S.scoreVal, liveScore);
    assert.notStrictEqual(sandbox.S.scoreVal, snapshot.publishedScore);
    assertLiveRows(rowText(), 'staff');
  }

  console.log('\n4. Country Benchmark is not a publication score type');
  {
    assert.strictEqual(snapshot.scoreType, 'quality-v3');
    const labeled = caseJob('case-country-label', LIVE);
    labeled.result = {
      waterScore: snapshot.publishedScore,
      publicationSource: 'ledger',
      scoreType: 'country-benchmark',
      publicReportToken: 'rpt-country'
    };
    render(labeled, true);
    assert.strictEqual(sandbox.S.scoreVal, snapshot.publishedScore);
    assertLiveRows(rowText(), 'country label without snapshot readings');
  }

  console.log('\n5. Cleared live readings still show the frozen snapshot');
  {
    const cleared = caseJob('case-cleared', null);
    cleared.draft.tapData = [{}];
    const view = applyPublicationToJob(cleared, { snapshot });
    render(view, true);
    assertFrozenRows(rowText(), 'cleared taps');
    assert(!rowText().includes('score-metric-skel'), 'frozen rows are not pending skeletons');
  }

  console.log('\n6. Published score is not recalculated from later readings');
  {
    const view = applyPublicationToJob(caseJob('case-immutable', LIVE), { snapshot });
    render(view, true);
    assert.strictEqual(sandbox.S.scoreVal, snapshot.publishedScore);
    assert.notStrictEqual(sandbox.S.scoreVal, liveScore);
    assert.strictEqual(sandbox.S.displayedScore.source, 'published');
    assert.strictEqual(sandbox.S.displayedScore.comparison, null);
  }

  resetPublicationDependencies();
  console.log('\nledger frozen readings: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
