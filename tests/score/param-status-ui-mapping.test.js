/**
 * Parameter status UI mapping — Good / Fair / Attention (presentation only).
 *
 * Internal classification stays PASS / WARNING / FAIL / CRITICAL; the UI maps
 * PASS → Good, WARNING → Fair, FAIL → Fair, CRITICAL → Attention.
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
const improveListEl = stubEl();
const domEls = {
  'score-readings-rows': rowsEl,
  'score-improve-section': stubEl(),
  'score-improve-list': improveListEl,
  'score-improve-count': stubEl(),
  'score-improve-heading': stubEl(),
  'score-all-good': stubEl(),
  'score-all-good-text': stubEl()
};
const sandbox = {
  console: { log() {}, warn() {}, info() {}, error: console.error },
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  document: {
    getElementById: (id) => domEls[id] || stubEl(),
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
const EXPECTED_UI = { PASS: 'good', WARNING: 'fair', FAIL: 'fair', CRITICAL: 'attn' };

function context(standardKey, readings) {
  return { selectedStandard: standardKey, display: reg.get(standardKey).display, readings };
}
function rowFor(standardKey, readings, label) {
  return sandbox.buildMetricRowsForReadings(readings, context(standardKey, readings)).find(r => r.p === label);
}

console.log('\n1. Mapping table');
{
  const map = vm.runInContext('PARAM_CLASSIFICATION_UI_STATUS', sandbox);
  assert(JSON.stringify(map) === JSON.stringify(EXPECTED_UI), 'PASS→good, WARNING→fair, FAIL→fair, CRITICAL→attn');
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
  const failHtml = render({ ...IDEAL, chlorine: 0.1 });
  assert(/score-metric-row is-fair"[^]*?Chlorine/.test(failHtml), 'FAIL chlorine (outside the preferred band) renders Fair');
  assert(failHtml.includes('score.status.fair') && !/score-metric-row is-attn"[^]*?Chlorine/.test(failHtml), 'FAIL chlorine is not Attention');
  const attnHtml = render({ ...IDEAL, chlorine: 0.03 });
  assert(attnHtml.includes('is-attn') && attnHtml.includes('score.status.attn'), 'CRITICAL chlorine still renders Attention');
  assert(!/score-metric-row is-fair"[^]*?Chlorine/.test(attnHtml), 'CRITICAL chlorine is not relabeled Fair');
  for (const html of [fairHtml, goodHtml, attnHtml]) {
    assert(!/PASS|WARNING|FAIL|CRITICAL/.test(html), 'no internal classification word appears in the parameter rows');
  }
}

console.log('\n5. Labels and colour');
{
  const i18n = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/css/styles.css'), 'utf8');
  const scoreSrc = fs.readFileSync(path.join(root, 'src/js/flows/score.js'), 'utf8');
  assert(i18n.includes("'score.status.fair': 'Fair'"), 'English Fair label exists');
  assert((i18n.match(/'score\.status\.fair':/g) || []).length === 2, 'Fair label exists in both languages');
  assert(i18n.includes("'score.status.good': 'Good'") && i18n.includes("'score.status.attn': 'Attention'"), 'Good / Attention labels unchanged');
  assert(i18n.includes("'score.impact.chlorine': 'Chlorine is outside the preferred range'"), 'chlorine note does not assume the residual is high');
  assert(i18n.includes("'score.impact.chlorine': 'คลอรีนอยู่นอกช่วงที่แนะนำ'"), 'Thai chlorine note does not assume the residual is high');
  assert(css.includes('.score-metric-row.is-fair .score-metric-status{color:#ffb266}'), 'Fair row colour is #ffb266');
  assert(css.includes('.score-metric-facts dd.is-fair{color:#ffb266}'), 'Fair detail colour is #ffb266');
  assert(css.includes('.score-improve-row.is-fair .score-improve-value{color:#ffb266}'), 'improve-list Fair value is #ffb266');
  assert(css.includes('.score-improve-row.is-attn .score-improve-value{color:#f07b7b}'), 'improve-list Attention value is #f07b7b');
  assert(!css.includes('.score-report[data-tier=low] .score-improve-value'), 'gauge tier does not recolor improve values');
  assert(!css.includes('.status-dot.attn') && !css.includes('#d65c5c'), 'unused status-dot attention colour is gone');
  assert(!scoreSrc.includes('#c48a3a'), 'the unused gauge helper no longer defines a second Fair colour');
  const complianceNotes = i18n.split('\n').filter(line => line.includes("'score.msg.complianceWarningOverride'"));
  assert(complianceNotes.length === 2 && !complianceNotes.some(line => /PASS|WARNING|FAIL|CRITICAL/.test(line)), 'compliance note names no internal state');
  assert(complianceNotes[0].includes('compliance is Fair') && complianceNotes[1].includes('ควรเฝ้าระวัง'), 'compliance note reads Fair / ควรเฝ้าระวัง');
  assert(css.includes('.score-metric-row.is-good .score-metric-status{color:#6bd499}') && css.includes('.score-metric-row.is-attn .score-metric-status{color:#f07b7b}'), 'Good / Attention colours unchanged');
  assert(i18n.includes("'score.explain.fair': 'This parameter is outside the preferred range and may need monitoring.'"), 'English Fair explanation');
  assert(i18n.includes("'score.explain.attention': 'This parameter requires closer attention under the selected benchmark criteria.'"), 'English Attention explanation');
  assert(i18n.includes("'score.explain.fair': 'พารามิเตอร์นี้อยู่นอกช่วงที่แนะนำและอาจต้องติดตามเพิ่มเติม'"), 'Thai Fair explanation');
  assert(i18n.includes("'score.explain.attention': 'พารามิเตอร์นี้ควรได้รับการตรวจสอบเพิ่มเติมตามเกณฑ์ของประเทศที่เลือก'"), 'Thai Attention explanation');
  assert(!i18n.includes('score.band.fair'), 'unused band.fair copy is gone');
  assert(!scoreSrc.includes('function getScoreStyle'), 'unused getScoreStyle is gone');
}

console.log('\n6. Fair and Attention copy follow the UI status');
{
  assert(sandbox.paramMeaningText('Chlorine', 'fair') === 'score.explain.fair', 'Fair meaning uses the Fair key');
  assert(sandbox.paramMeaningText('Chlorine', 'attn') === 'score.explain.attention', 'Attention meaning uses the Attention key');
  assert(sandbox.paramMeaningText('Chlorine', 'fair') !== sandbox.paramMeaningText('Chlorine', 'attn'), 'Fair and Attention messages differ');
  assert(sandbox.paramMeaningText('Chlorine', 'good') === 'score.meaning.chlorine', 'Good keeps the parameter note');
  const show = (readings, open) => {
    sandbox.S.scoreMetricOpen = open;
    sandbox.renderScoreReadings(context('thailand', readings));
    return rowsEl.innerHTML;
  };
  const fairHtml = show({ ...IDEAL, chlorine: 0.1 }, 'chlorine');
  const attnHtml = show({ ...IDEAL, chlorine: 0.03 }, 'chlorine');
  assert(fairHtml.includes('score.explain.fair') && !fairHtml.includes('score.explain.attention'), 'FAIL chlorine explains Fair, not Attention');
  assert(attnHtml.includes('score.explain.attention') && !attnHtml.includes('score.explain.fair'), 'CRITICAL chlorine explains Attention, not Fair');
  const excluded = sandbox.buildMetricRowsForReadings({ ...IDEAL, do: 7 }, context('thailand', { ...IDEAL, do: 7 })).find(r => r.p === 'DO');
  assert(excluded && excluded.st === 'excluded', 'Thailand DO stays excluded');
  show({ ...IDEAL, do: 7 }, 'do');
  assert(rowsEl.innerHTML.includes('is-excluded') && rowsEl.innerHTML.includes('score.status.excluded'), 'excluded row stays neutral N/A');
  assert(!rowsEl.innerHTML.includes('is-fair') && !rowsEl.innerHTML.includes('is-attn'), 'excluded DO is not Fair or Attention');
}

console.log('\n7. Room to improve follows the parameter, not the gauge');
{
  function renderImprove(readings, gaugeScore) {
    sandbox.S.scorePointOrdinal = 0;
    sandbox.S.scorePointNotice = null;
    sandbox.S.displayedScore = {
      showScore: true,
      score: gaugeScore,
      source: 'country-benchmark',
      engineKey: 'thailand',
      standardKey: 'thailand'
    };
    sandbox.S.comparisonScoreResult = { readings, standardKey: 'thailand' };
    sandbox.renderScoreImprove(context('thailand', readings));
    return improveListEl.innerHTML;
  }
  const fairList = renderImprove({ ...IDEAL, chlorine: 0.1 }, 40);
  assert(fairList.includes('is-fair') && fairList.includes('score.status.fair'), 'FAIL chlorine is Fair in the improve list while the gauge is Needs attention');
  assert(!fairList.includes('is-attn'), 'a Fair improve row is not marked Attention');
  const attnList = renderImprove({ ...IDEAL, chlorine: 0.03 }, 80);
  assert(attnList.includes('is-attn') && attnList.includes('score.status.attn'), 'CRITICAL chlorine stays Attention while the gauge is Good');
  assert(!/score-improve-row is-fair/.test(attnList), 'CRITICAL improve row is not Fair');
}

console.log('\n8. Gauge tiers and postcard bands stay on their own rules');
{
  const colors = vm.runInContext('SCORE_BAR_COLORS', sandbox);
  assert(colors.high === '#284dcd' && colors.mid === '#6bd499' && colors.low === '#f07b7b', 'gauge colours unchanged');
  assert(sandbox.customerVerdict(81).tier === 'high' && sandbox.customerVerdict(80).tier === 'mid', 'Excellent starts at 81');
  assert(sandbox.customerVerdict(51).tier === 'mid' && sandbox.customerVerdict(50).tier === 'low', 'Good starts at 51; below that is Needs attention');
  assert(sandbox.customerVerdictForEngine(90, 'thailand').tier === 'high', 'Thailand Excellent starts at 90');
  assert(sandbox.customerVerdictForEngine(89, 'thailand').tier === 'mid', 'Thailand 89 stays Good');
  assert(sandbox.customerVerdictForEngine(81, 'japan').tier === 'high', 'other countries stay Excellent from 81');
  const card = fs.readFileSync(path.join(root, 'services/score-share-card.js'), 'utf8');
  assert(card.includes('if (wq >= 80)') && card.includes('if (wq >= 60)') && card.includes("label: 'Acceptable'") && card.includes("const GOOD_GREEN = '#71D29C'"), 'postcard bands and green are unchanged');
  const inBand = reg.calculate('thailand', { ...IDEAL, chlorine: 1.5 });
  assert(inBand.classifications.chlorine === 'PASS', 'in-band Thailand chlorine stays PASS');
  const eu = reg.calculate('eu', { ...IDEAL, chlorine: 0.09 });
  assert(eu.classifications.chlorine === 'CRITICAL', 'EU chlorine outside 0.1–0.5 stays CRITICAL');
  const euAgain = reg.calculate('eu', { ...IDEAL, chlorine: 0.09 });
  assert(eu.score === euAgain.score && eu.rawAggregate === euAgain.rawAggregate, 'EU score is unchanged by presentation');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
