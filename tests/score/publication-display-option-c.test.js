/**
 * Option C — published score stays frozen; current assessment stays live.
 * Does not change publication creation, tokens, or scoring math.
 *
 * Run: node tests/score/publication-display-option-c.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const files = [
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
];

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
nodes['score-content-panel'].insertBefore = function insertBefore(child) {
  child.parentNode = this;
  this.firstChild = child;
};

const sandbox = {
  console,
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
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
    scoreParamOpen: null,
    publicScoreView: false,
    taps: ['Room 1'],
    scoreTapFilter: 'all',
    lastReadingsValidation: null
  }
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
    console.log('  ok   ', msg);
  } else {
    failed += 1;
    console.error('  FAIL ', msg);
  }
}

const liveTap = {
  standardMeasurement: { ph: 7.2, tds: 80, chlorine: 1.0, turbidity: 0.1, orp: 400, do: 8 }
};
function job(result) {
  return {
    id: 'opt-c',
    notionId: 'opt-c',
    draft: { tapData: [liveTap], fields: {}, taps: ['Room 1'], scoreStandardKey: 'thailand' },
    result: result || {}
  };
}

const live = sandbox.computeQualityScoreDetail(sandbox.readingsFromTapData([liveTap]));
assert(live.score !== 100, `fixture live score is not 100 (got ${live.score})`);
assert(live.compliance && live.compliance.status !== 'PASS', `fixture live compliance is not PASS (got ${live.compliance && live.compliance.status})`);

console.log('\n1-2. Customer published 100 vs live case');
{
  sandbox.S.lang = 'en';
  sandbox.S.publicScoreView = true;
  const published = job({ waterScore: 100, complianceStatus: 'PASS', publicReportToken: 'rpt-old' });
  sandbox.S.activeJob = published;
  sandbox.renderWaterScore(published, { publicView: true });
  assert(sandbox.S.scoreVal === 100, `customer gauge stays 100 (got ${sandbox.S.scoreVal})`);
  assert(sandbox.S.displayedScore.score === 100, 'displayed score is the publication');
  assert(sandbox.S.displayedScore.source === 'published', 'source is published');
  assert(nodes['score-hero-source'].textContent === 'Published Water Score', 'published label, not Water Quality Score');
  assert(nodes['score-hero-source'].textContent !== 'Water Quality Score', 'quality label is not used for the publication');
  assert(nodes['score-compliance-line'].dataset.status === 'PASS', 'frozen compliance PASS');
  assert(nodes['score-compliance-line'].hidden === false, 'compliance visible');
  assert(nodes['score-current-assessment'].hidden === false, 'current assessment label visible');
  assert(nodes['score-current-assessment'].textContent.includes('not the source of the published score'), 'separator says readings are not the publication source');
  assert(sandbox.S.comparisonScoreResult.score !== 100, `country benchmark follows the live case (got ${sandbox.S.comparisonScoreResult.score})`);
  assert(nodes['score-published-line'].hidden === true, 'customer page does not show a second score');
  assert(!String(nodes['score-hero-source'].textContent).includes(String(live.score)), 'live score is not printed as the gauge label');

  sandbox.setScoreReferenceStandard('japan');
  assert(sandbox.S.scoreVal === 100, 'country switch keeps the published gauge');
  assert(sandbox.S.currentScoreResult.complianceStatus === 'PASS', 'country switch does not replace frozen compliance');
}

console.log('\n3. Old publication without compliance');
{
  const published = job({ waterScore: 100, complianceStatus: null, publicReportToken: 'rpt-nocomp' });
  sandbox.S.activeJob = published;
  sandbox.S.publicScoreView = true;
  sandbox.renderWaterScore(published, { publicView: true });
  assert(sandbox.S.scoreVal === 100, 'old link still shows the published score');
  assert(sandbox.S.currentScoreResult.complianceStatus == null, 'missing compliance stays null');
  assert(nodes['score-compliance-line'].hidden === true, 'compliance line stays blank');
  assert(nodes['score-compliance-line'].textContent === '', 'live compliance is not substituted');
  assert(nodes['score-compliance-line'].dataset.status !== live.compliance.status, 'live compliance status is not applied');
}

console.log('\n4. Staff mismatch');
{
  sandbox.S.lang = 'en';
  sandbox.S.publicScoreView = false;
  const changed = job({ waterScore: 100, complianceStatus: 'PASS', publicReportToken: 'rpt-old' });
  sandbox.S.activeJob = changed;
  sandbox.renderWaterScore(changed, { publicView: false });
  assert(sandbox.S.scoreVal === live.score, `staff gauge is the live score ${live.score} (got ${sandbox.S.scoreVal})`);
  assert(nodes['score-hero-source'].textContent !== 'Published Water Score', 'staff hero is not the published customer label');
  assert(nodes['score-published-line'].hidden === false, 'published line appears when scores differ');
  assert(nodes['score-published-line'].textContent === 'Published Water Score: 100', 'published line shows 100');
  assert(nodes['score-current-assessment'].hidden === true, 'staff page does not show the customer separator');

  changed.result.waterScore = live.score;
  sandbox.renderWaterScore(changed, { publicView: false });
  assert(nodes['score-published-line'].hidden === true, 'matching scores hide the published line');

  delete changed.result.waterScore;
  sandbox.renderWaterScore(changed, { publicView: false });
  assert(nodes['score-published-line'].hidden === true, 'no published score hides the published line');
}

console.log('\nTH label');
{
  sandbox.S.lang = 'th';
  sandbox.S.publicScoreView = true;
  const published = job({ waterScore: 100, complianceStatus: 'PASS' });
  sandbox.S.activeJob = published;
  sandbox.renderWaterScore(published, { publicView: true });
  assert(nodes['score-hero-source'].textContent === 'คะแนน Water Score ที่เผยแพร่', 'Thai published label');
  assert(nodes['score-current-assessment'].textContent.includes('ไม่ใช่ที่มาของคะแนนที่เผยแพร่'), 'Thai current-assessment label');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
