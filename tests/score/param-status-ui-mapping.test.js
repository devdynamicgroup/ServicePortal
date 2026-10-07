/**
 * Parameter status UI mapping — Good / Fair / Attention (presentation only).
 *
 * Internal classification stays PASS / WARNING / FAIL / CRITICAL; the UI maps
 * PASS → Good, WARNING → Fair, FAIL → Attention, CRITICAL → Attention.
 * Loads the REAL engines and src/js/flows/score.js — no reimplementation.
 *
 * Run: node tests/score/param-status-ui-mapping.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const ENGINES = ['thailand', 'who', 'eu', 'japan', 'usEpa'];
const files = [
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/validation/measurementValidator.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
  'src/js/score/benchmark/registry.js',
  ...ENGINES.flatMap(k => ['limits', 'weights', 'score'].map(f => `src/js/score/benchmark/${k}/${f}.js`)),
  'src/js/flows/score.js'
];

function stubEl() {
  return {
    hidden: false,
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => stubEl(),
    textContent: '',
    innerHTML: '',
    replaceChildren() {},
    dataset: {}
  };
}

const rowsEl = stubEl();
const sandbox = {
  console: { log() {}, warn() {}, info() {}, error: console.error },
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  document: {
    getElementById: (id) => (id === 'score-readings-rows' ? rowsEl : stubEl()),
    querySelector: () => stubEl(),
    querySelectorAll: () => [],
    addEventListener() {}
  },
  navigator: { userAgent: 'node' },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  S: { lang: 'en', activeJob: null, taps: ['Tap 1'], tapData: [], scoreTapFilter: 'Tap 1', scoreStandardKey: 'thailand' },
  t: (k) => k
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const rel of files) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: path.basename(rel) });
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const reg = sandbox.WaterScoreBenchmarkRegistry;
const IDEAL = { ph: 7.5, tds: 110, chlorine: 0.4, turbidity: 0.2, orp: 400, do: 7, temp: 25 };
const INTERNAL = ['PASS', 'WARNING', 'FAIL', 'CRITICAL'];
const EXPECTED_UI = { PASS: 'good', WARNING: 'fair', FAIL: 'attn', CRITICAL: 'attn' };

function context(standardKey, readings) {
  return { selectedStandard: standardKey, display: reg.get(standardKey).display, readings };
}
function rowFor(standardKey, readings, label) {
  return sandbox.buildMetricRowsForReadings(readings, context(standardKey, readings)).find(r => r.p === label);
}

console.log('\n1. Mapping table');
{
  const map = vm.runInContext('PARAM_CLASSIFICATION_UI_STATUS', sandbox);
  assert(JSON.stringify(map) === JSON.stringify(EXPECTED_UI), 'PASS→good, WARNING→fair, FAIL→attn, CRITICAL→attn');
  assert(sandbox.paramStatusFromClassification('attn', 'WARNING') === 'fair', 'WARNING presents as Fair');
  assert(sandbox.paramStatusFromClassification('pending', 'WARNING') === 'pending', 'pending rows are never re-mapped');
  assert(sandbox.paramStatusFromClassification('attn', 'NOT_MEASURED') === 'attn', 'unclassified rows keep their existing status');
  assert(sandbox.paramStatusFromClassification('good', undefined) === 'good', 'missing classification keeps existing status');
  assert(sandbox.paramStatusUiKey('fair') === 'fair', 'paramStatusUiKey passes Fair through');
  assert(sandbox.paramStatusUiKey('good') === 'good' && sandbox.paramStatusUiKey('attn') === 'attn', 'Good / Attention keys unchanged');
}

console.log('\n2. Thailand chlorine — internal classification unchanged, UI maps to three states');
{
  const cases = [[0.4, 'PASS'], [0.16, 'WARNING'], [0.1, 'FAIL'], [0.03, 'CRITICAL']];
  for (const [cl, internal] of cases) {
    const readings = { ...IDEAL, chlorine: cl };
    const before = reg.calculate('thailand', readings);
    const row = rowFor('thailand', readings, 'Chlorine');
    const after = reg.calculate('thailand', readings);
    assert(before.classifications.chlorine === internal, `Cl ${cl} internal classification is ${internal}`);
    assert(after.classifications.chlorine === internal, `Cl ${cl} internal classification still ${internal} after rows are built`);
    assert(sandbox.paramStatusUiKey(row.st) === EXPECTED_UI[internal], `Cl ${cl} UI = ${EXPECTED_UI[internal]} (got ${row.st})`);
    assert(before.score === after.score && before.rawAggregate === after.rawAggregate, `Cl ${cl} benchmark score identical (${after.score})`);
  }
}

console.log('\n3. Every engine × parameter sweep — UI status always follows the internal classification');
{
  const RANGES = { ph: [4, 10, 0.05], tds: [0, 1500, 5], chlorine: [0, 5, 0.01], turbidity: [0, 12, 0.05], orp: [0, 900, 5], do: [0, 12, 0.1], temp: [0, 45, 0.5] };
  const LABELS = { ph: 'pH', tds: 'TDS', chlorine: 'Chlorine', turbidity: 'Turbidity', orp: 'ORP', do: 'DO', temp: 'Temp' };
  for (const engine of ENGINES) {
    let mismatches = 0;
    let engineLeak = 0;
    const seen = new Set();
    for (const [param, [from, to, step]] of Object.entries(RANGES)) {
      for (let v = from; v <= to + 1e-9; v += step) {
        const readings = { ...IDEAL, [param]: Number(v.toFixed(3)) };
        const out = reg.calculate(engine, readings);
        const internal = out.classifications[param];
        if (!['good', 'attn', 'pending'].includes(out.statuses[param])) engineLeak += 1;
        if (!INTERNAL.includes(internal)) continue;
        const ui = sandbox.paramStatusUiKey(rowFor(engine, readings, LABELS[param]).st);
        seen.add(ui);
        if (ui !== EXPECTED_UI[internal]) mismatches += 1;
      }
    }
    assert(mismatches === 0, `${engine}: UI status matches the mapping for every swept value`);
    assert(engineLeak === 0, `${engine}: engine statuses stay good/attn/pending (no "fair" upstream)`);
    assert([...seen].every(s => ['good', 'fair', 'attn'].includes(s)), `${engine}: only Good / Fair / Attention reach the UI`);
  }
}

console.log('\n4. Rendered rows');
{
  const render = (readings) => {
    sandbox.S.scoreMetricOpen = 'chlorine';
    sandbox.renderScoreReadings(context('thailand', readings));
    return rowsEl.innerHTML;
  };
  const fairHtml = render({ ...IDEAL, chlorine: 0.16 });
  assert(/score-metric-row is-fair"[^]*?Chlorine/.test(fairHtml), 'WARNING chlorine row renders with is-fair');
  assert(fairHtml.includes('score.status.fair'), 'Fair row uses the score.status.fair label');
  assert(fairHtml.includes('<dd class="is-fair">score.status.fair</dd>'), 'expanded detail shows Fair');
  const goodHtml = render(IDEAL);
  assert(goodHtml.includes('is-good') && goodHtml.includes('score.status.good') && !goodHtml.includes('is-fair'), 'all-PASS readings still render Good only');
  const attnHtml = render({ ...IDEAL, chlorine: 0.03 });
  assert(attnHtml.includes('is-attn') && attnHtml.includes('score.status.attn') && !attnHtml.includes('is-fair'), 'CRITICAL chlorine still renders Attention');
  for (const html of [fairHtml, goodHtml, attnHtml]) {
    assert(!/PASS|WARNING|FAIL|CRITICAL/.test(html), 'no internal classification word appears in the parameter rows');
  }
}

console.log('\n5. Labels and colour');
{
  const i18n = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/css/styles.css'), 'utf8');
  assert(i18n.includes("'score.status.fair': 'Fair'"), 'English Fair label exists');
  assert((i18n.match(/'score\.status\.fair':/g) || []).length === 2, 'Fair label exists in both languages');
  assert(i18n.includes("'score.status.good': 'Good'") && i18n.includes("'score.status.attn': 'Attention'"), 'Good / Attention labels unchanged');
  assert(css.includes('.score-metric-row.is-fair .score-metric-status{color:#ffb266}'), 'Fair row colour is #ffb266');
  assert(css.includes('.score-metric-facts dd.is-fair{color:#ffb266}'), 'Fair detail colour is #ffb266');
  assert((css.match(/#ffb266/gi) || []).length === 2, '#ffb266 is used for Fair only');
  const complianceNotes = i18n.split('\n').filter(line => line.includes("'score.msg.complianceWarningOverride'"));
  assert(complianceNotes.length === 2 && !complianceNotes.some(line => /PASS|WARNING|FAIL|CRITICAL/.test(line)), 'compliance note names no internal state');
  assert(complianceNotes[0].includes('compliance is Fair') && complianceNotes[1].includes('ควรเฝ้าระวัง'), 'compliance note reads Fair / ควรเฝ้าระวัง');
  assert(css.includes('.score-metric-row.is-good .score-metric-status{color:#6bd499}') && css.includes('.score-metric-row.is-attn .score-metric-status{color:#f07b7b}'), 'Good / Attention colours unchanged');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
