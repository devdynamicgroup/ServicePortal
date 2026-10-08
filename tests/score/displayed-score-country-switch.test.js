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
    removeAttribute() {},
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
/**
 * 2026-08-19 (PO-approved, evidence-based): Thailand's own TDS/turbidity
 * passMax were corrected to real cited Thai standards (DOH 2020 ≤500 / MWA
 * spec ≤1.0), so plain DIFF above now also fails Thailand and no longer
 * differentiates it from Japan. This fixture clears Thailand's corrected
 * bounds while still failing Japan's own stricter comfort-target thresholds
 * (pH ideal 7.3-7.7 / TDS ideal ≤200).
 */
const DIFF_TH_SAFE = Object.freeze({
  ph: 8.0, tds: 350, turbidity: 0.5, orp: 400, do: 6, chlorine: 0.5, temp: 26
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
  // 2026-08-19 (PO-approved, evidence-based): Thailand's own TDS/turbidity
  // passMax were corrected to real cited Thai standards (DOH 2020 ≤500 /
  // MWA spec ≤1.0) — DIFF's TDS=800/turbidity=3.5 now exceed Thailand's own
  // bounds too, so its own severity cap now binds and Thailand's displayed
  // score (51) diverges from Quality V3 (61, no country cap). Independence
  // is proven structurally: they're computed via genuinely separate
  // functions (resolveDisplayedScore/registry.calculate vs
  // computeQualityScoreDetail), verified in country-hero-ceiling.test.js.
  assert(displayed(DIFF, 'thailand').score !== quality,
    `displayed TH ${displayed(DIFF, 'thailand').score} diverges from Quality V3 ${quality} (Thailand's own severity cap now binds)`);
}

console.log('\n6–7. Thailand → Japan → Thailand via setScoreReferenceStandard');
{
  sandbox.S.publicScoreView = false;
  sandbox.S.activeJob = jobFromReadings(DIFF_TH_SAFE);
  sandbox.S.scoreStandardKey = 'thailand';

  const th = switchCountry('thailand');
  const thEngine = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', DIFF_TH_SAFE);
  assert(th.engineKey === 'thailand', 'TH switch engineKey=thailand');
  assert(th.score === thEngine.score, `TH displayed ${th.score} === Thailand engine`);
  assert(sandbox.S.currentScoreResult.standardKey === 'quality-v3', 'publish channel remains quality-v3 after TH');

  const jp = switchCountry('japan');
  const jpEngine = sandbox.WaterScoreBenchmarkRegistry.calculate('japan', DIFF_TH_SAFE);
  assert(jp.engineKey === 'japan', 'JP switch engineKey=japan');
  assert(jp.score === jpEngine.score, `JP displayed ${jp.score} === Japan engine`);
  assert(jp.score !== th.score, `DIFF_TH_SAFE: displayed JP ${jp.score} !== displayed TH ${th.score}`);
  assert(sandbox.S.comparisonScoreResult.engineKey === 'japan', 'comparisonScoreResult follows Japan');
  assert(sandbox.S.currentScoreResult.standardKey === 'quality-v3', 'Quality publish tag unchanged after JP');

  const back = switchCountry('thailand');
  assert(back.engineKey === 'thailand', 'switch back engineKey=thailand');
  assert(back.score === th.score, `switch back displayed ${back.score} restores Thailand`);

  const sequence = ['thailand', 'japan', 'eu', 'who', 'usEpa', 'thailand'];
  const hero = [];
  for (const key of sequence) {
    const out = switchCountry(key);
    const engine = sandbox.WaterScoreBenchmarkRegistry.calculate(key, DIFF_TH_SAFE);
    assert(out.engineKey === key, `sequence ${key}: engineKey=${out.engineKey}`);
    assert(out.score === engine.score, `sequence ${key}: Hero ${out.score} === engine ${engine.score}`);
    assert(sandbox.S.scoreVal === sandbox.computeQualityScoreDetail(DIFF_TH_SAFE).score,
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
  // 2026-08-18 (PO-approved): shared grading base for BASELINE = 76 for
  // every engine. Thailand has no severity cap binding here, so it stays at
  // raw 76 (coincidentally equal to Quality V3 — see below). Japan's own
  // tighter pH band (7.3-7.7) classifies ph=7.85 WARNING; the guaranteed
  // minimum deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3) takes it
  // to 73. WHO/US EPA both classify chlorine/do FAIL; the guaranteed
  // minimum deduction (FAIL=6) takes raw 76 down to 70. EU's PD-002
  // chlorine gate is unaffected, still 65.
  assert(th.score === 79 && th.engineKey === 'thailand', 'baseline displayed TH=79 from thailand engine');
  // 2026-08-19 (bug fix): do key removed from JapanBenchmarkWeights, raising 74 -> 76.
  assert(jp.score === 76 && jp.engineKey === 'japan', 'baseline displayed JP=76 from japan engine');
  assert(who.score === 70 && who.engineKey === 'who', 'baseline displayed WHO=70 from who engine');
  assert(eu.score === 65 && eu.engineKey === 'eu', 'baseline displayed EU=65 from eu engine');
  assert(epa.score === 71 && epa.engineKey === 'usEpa', 'baseline displayed EPA=71 from usEpa engine');
  // Thailand's Hero coincides numerically with Quality V3 here (both 76,
  // same shared base, no cap binds) — expected under the new architecture,
  // not a leak (independence is structural, proven elsewhere).
  assert(th.score !== q.score, 'baseline Hero TH=79 differs from Quality V3 76 (weighted profile)');
  assert(jp.engineKey !== th.engineKey, 'TH vs JP call different engines even when scores are close');
}

console.log('\n8. Japan DO 5.3 / 0 / null / 20 — DO numerically graded when present, NOT_EVALUATED classification always');
{
  // 2026-08-18 (PO-approved): DO is now part of the shared grading base for
  // every engine, including Japan, when present — only Japan's own
  // PASS/FAIL classification of DO stays opinion-free (NOT_EVALUATED). The
  // numeric displayed score DOES now shift with DO's value; it's only
  // absent from graded params when DO itself is absent (null).
  const scores = [];
  for (const doVal of [5.3, 0, null, 20]) {
    const readings = { ...BASELINE, do: doVal };
    const out = displayed(readings, 'japan');
    scores.push(out.score);
    assert(out.engineKey === 'japan', `DO=${doVal}: displayed engine is japan`);
    assert(out.classifications?.do === 'NOT_EVALUATED', `DO=${doVal}: classification.do=NOT_EVALUATED`);
    assert(out.showScore === true && Number.isFinite(out.score), `DO=${doVal}: displayed score finite (${out.score})`);
    const hasDoParam = Object.prototype.hasOwnProperty.call(out.comparison.paramScores || {}, 'do');
    if (doVal === null) {
      assert(!hasDoParam, `DO=${doVal}: do absent from graded params (DO itself absent)`);
    } else {
      assert(hasDoParam, `DO=${doVal}: do present in graded params (shared base grades it when present)`);
    }
  }
  // 2026-08-19 (bug fix): do key removed from JapanBenchmarkWeights — DO no
  // longer enters Japan's composite at all, so every DO variant now produces
  // the identical displayed score.
  assert(new Set(scores).size === 1, `Japan DO variants all produce the identical displayed score ${scores.join(',')} (DO excluded from Japan's composite)`);
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
  // 2026-08-18 (PO-approved): shared base for BASELINE = 76, but Japan's
  // own tighter pH band (7.3-7.7) classifies ph=7.85 WARNING; the
  // guaranteed minimum deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3)
  // takes it to 73 — diverging from Quality V3 here; independence between
  // the two is structural, not numeric.
  assert(sandbox.S.displayedScore.score === 76, 'displayed Japan score is 76 (Japan\'s own pH WARNING + guaranteed deduction)');
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
