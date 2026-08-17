/**
 * Displayed Score country-switch regression.
 * Covers resolveDisplayedScore / setScoreReferenceStandard — the path that
 * feeds #gauge-val — NOT japan/score.js in isolation.
 *
 * Run: node tests/score/displayed-score-country-switch.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

function stubEl() {
  return {
    hidden: false,
    style: { setProperty() {}, width: '', background: '', color: '', left: '' },
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    querySelector: () => stubEl(),
    textContent: '',
    innerHTML: '',
    replaceChildren() {},
    dataset: {},
    onchange: null
  };
}

const sandbox = {
  console,
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  document: {
    getElementById: () => stubEl(),
    querySelector: () => stubEl()
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
    scoreTapFilter: 'all',
    lastReadingsValidation: null
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
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

/** Calibration baseline — engines may share plateau numbers; engines must still differ. */
const BASELINE = Object.freeze({
  ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25
});
/** Differentiation fixture — Thailand pass-band vs Japan stricter ceilings. */
const DIFF = Object.freeze({
  ph: 7.2, tds: 800, turbidity: 3.5, orp: 350, do: 5.5, chlorine: 1.5, temp: 28
});

const ENGINE_KEYS = ['thailand', 'japan', 'eu', 'usEpa', 'who'];

function displayed(readings, standardKey) {
  return sandbox.resolveDisplayedScore({ readings, standardKey, publicView: false });
}

function jobFromReadings(readings) {
  return {
    id: 'local-display-score-1',
    notionId: 'notion-display-score-1',
    draft: {
      fields: {
        'm-ph': readings.ph,
        'm-tds': readings.tds,
        'm-turb': readings.turbidity,
        'm-orp': readings.orp,
        'm-do': readings.do,
        'm-free-cl': readings.chlorine,
        'm-temp': readings.temp
      }
    }
  };
}

function switchCountry(key) {
  sandbox.setScoreReferenceStandard(key);
  return sandbox.S.displayedScore;
}

console.log('\n1–5. Same Case + each country → displayed Score uses that engine');
{
  sandbox.S.publicScoreView = false;
  sandbox.S.activeJob = jobFromReadings(DIFF);
  for (const key of ENGINE_KEYS) {
    const viaHelper = displayed(DIFF, key);
    const viaRegistry = sandbox.WaterScoreBenchmarkRegistry.calculate(key, DIFF);
    assert(viaHelper.source === 'country-benchmark', `${key}: source is country-benchmark`);
    assert(viaHelper.engineKey === key, `${key}: displayed engineKey=${viaHelper.engineKey}`);
    assert(viaHelper.standardKey === key, `${key}: displayed standardKey=${viaHelper.standardKey}`);
    assert(viaHelper.score === viaRegistry.score, `${key}: displayed ${viaHelper.score} === engine ${viaRegistry.score}`);
    assert(viaHelper.showScore === true, `${key}: showScore true`);
  }
  const quality = sandbox.computeQualityScoreDetail(DIFF).score;
  assert(displayed(DIFF, 'thailand').score !== quality,
    `displayed TH ${displayed(DIFF, 'thailand').score} !== Quality V3 ${quality}`);
}

console.log('\n6–7. Thailand → Japan → Thailand via setScoreReferenceStandard');
{
  sandbox.S.publicScoreView = false;
  sandbox.S.activeJob = jobFromReadings(DIFF);
  sandbox.S.scoreStandardKey = 'thailand';

  const th = switchCountry('thailand');
  const thEngine = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', DIFF);
  assert(th.engineKey === 'thailand', 'TH switch engineKey=thailand');
  assert(th.score === thEngine.score, `TH displayed ${th.score} === Thailand engine`);
  assert(sandbox.S.currentScoreResult.standardKey === 'quality-v3', 'publish channel remains quality-v3 after TH');

  const jp = switchCountry('japan');
  const jpEngine = sandbox.WaterScoreBenchmarkRegistry.calculate('japan', DIFF);
  assert(jp.engineKey === 'japan', 'JP switch engineKey=japan');
  assert(jp.score === jpEngine.score, `JP displayed ${jp.score} === Japan engine`);
  assert(jp.score !== th.score, `DIFF: displayed JP ${jp.score} !== displayed TH ${th.score}`);
  assert(sandbox.S.comparisonScoreResult.engineKey === 'japan', 'comparisonScoreResult follows Japan');
  assert(sandbox.S.currentScoreResult.standardKey === 'quality-v3', 'Quality publish tag unchanged after JP');

  const back = switchCountry('thailand');
  assert(back.engineKey === 'thailand', 'switch back engineKey=thailand');
  assert(back.score === th.score, `switch back displayed ${back.score} restores Thailand`);

  const sequence = ['thailand', 'japan', 'eu', 'who', 'usEpa', 'thailand'];
  const hero = [];
  for (const key of sequence) {
    const out = switchCountry(key);
    const engine = sandbox.WaterScoreBenchmarkRegistry.calculate(key, DIFF);
    assert(out.engineKey === key, `sequence ${key}: engineKey=${out.engineKey}`);
    assert(out.score === engine.score, `sequence ${key}: Hero ${out.score} === engine ${engine.score}`);
    assert(sandbox.S.scoreVal === sandbox.computeQualityScoreDetail(DIFF).score,
      `sequence ${key}: S.scoreVal stays Quality V3`);
    hero.push({ key, score: out.score, engineKey: out.engineKey });
  }
  assert(hero[0].score === hero[5].score && hero[0].engineKey === 'thailand',
    'TH→…→TH restores Thailand Hero without stale cache');
  console.log('  country-switch Hero', hero);
}

console.log('\nBaseline displayed vs Quality V3 (76/99/100/95/65/99)');
{
  const q = sandbox.computeQualityScoreDetail(BASELINE);
  const th = displayed(BASELINE, 'thailand');
  const jp = displayed(BASELINE, 'japan');
  const who = displayed(BASELINE, 'who');
  const eu = displayed(BASELINE, 'eu');
  const epa = displayed(BASELINE, 'usEpa');
  console.log('  BEFORE/AFTER display path', {
    quality: q.score,
    displayed: { th: th.score, jp: jp.score, who: who.score, eu: eu.score, epa: epa.score },
    engines: {
      th: th.engineKey, jp: jp.engineKey, who: who.engineKey, eu: eu.engineKey, epa: epa.engineKey
    }
  });
  assert(q.score === 76, `Quality V3 baseline 76 (got ${q.score})`);
  // PD-014 D1 (2026-08-14): orp=515 now inner-declines on every engine
  // (was flat 100 pre-D1), so these move from their pre-D1 baseline.
  // Thailand chlorine curve + weakest-link share 0.25->0.5 (2026-08-17, PO-approved): 81 (was 86).
  assert(th.score === 81 && th.engineKey === 'thailand', 'baseline displayed TH=81 from thailand engine');
  // Japan pH/chlorine inner curves (2026-08-17, PO-approved): chlorine=0.7 and
  // pH=7.85 are past their new ideal windows, pulling Japan to 90 (was 98).
  assert(jp.score === 90 && jp.engineKey === 'japan', 'baseline displayed JP=90 from japan engine');
  // WARNING severity cap=85 (2026-08-14, PO-approved numeric) further caps
  // WHO/EPA's worst=WARNING composite (was 93/98 pre-cap).
  assert(who.score === 85 && who.engineKey === 'who', 'baseline displayed WHO=85 from who engine');
  assert(eu.score === 65 && eu.engineKey === 'eu', 'baseline displayed EU=65 from eu engine');
  assert(epa.score === 85 && epa.engineKey === 'usEpa', 'baseline displayed EPA=85 from usEpa engine');
  assert(th.score !== q.score, 'baseline Hero is not Quality V3 76');
  assert(jp.engineKey !== th.engineKey, 'TH vs JP call different engines even when scores are close');
}

console.log('\n8. Japan DO 5.3 / 0 / null / 20 — same displayed Japan score, NOT_EVALUATED');
{
  const scores = [];
  for (const doVal of [5.3, 0, null, 20]) {
    const readings = { ...BASELINE, do: doVal };
    const out = displayed(readings, 'japan');
    scores.push(out.score);
    assert(out.engineKey === 'japan', `DO=${doVal}: displayed engine is japan`);
    assert(out.classifications?.do === 'NOT_EVALUATED', `DO=${doVal}: classification.do=NOT_EVALUATED`);
    assert(out.showScore === true && Number.isFinite(out.score), `DO=${doVal}: displayed score finite (${out.score})`);
    assert(!Object.prototype.hasOwnProperty.call(out.comparison.paramScores || {}, 'do'),
      `DO=${doVal}: do absent from graded params`);
  }
  assert(scores.every(s => s === scores[0]), `Japan DO variants same displayed score ${scores.join(',')}`);
}

console.log('\n9. Missing Japan required parameter (pH) → displayed incomplete/null');
{
  const out = displayed({ ...BASELINE, ph: null }, 'japan');
  assert(out.engineKey === 'japan', 'missing pH still routes to japan engine');
  assert(out.score == null, `missing pH displayed score is null (got ${out.score})`);
  assert(out.showScore === false, 'missing pH does not show a number');
}

console.log('\n10. Quality V3 unchanged');
{
  const q = sandbox.computeQualityScoreDetail(BASELINE);
  assert(q.score === 76, 'Quality V3 still 76');
  assert(q.engineVersion === 'quality-v3.0' || sandbox.QUALITY_SCORE_ENGINE_VERSION === 'quality-v3.0',
    'Quality engine version unchanged');
  sandbox.S.activeJob = jobFromReadings(BASELINE);
  switchCountry('japan');
  assert(sandbox.S.currentScoreResult.computedScore === 76, 'publish computedScore stays Quality 76 after JP switch');
  assert(sandbox.S.scoreVal === 76, 'S.scoreVal (publish) stays Quality 76');
  // Japan pH/chlorine inner curves (2026-08-17, PO-approved) pull JP's raw
  // composite for BASELINE to 90 — still independent of Quality V3 (76).
  assert(sandbox.S.displayedScore.score === 90, 'displayed Japan score is 90, not Quality 76');
}

console.log('\nLive Hero must not fall back to Quality V3 when country score is incomplete');
{
  const out = displayed({ ...BASELINE, ph: null }, 'thailand');
  assert(out.score == null, 'incomplete country score is null');
  assert(out.showScore === false, 'incomplete country score is not shown');
  assert(!Number.isFinite(out.score), 'no numeric Quality V3 fallback on incomplete country path');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
