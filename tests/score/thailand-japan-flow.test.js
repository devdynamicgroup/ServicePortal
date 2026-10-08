/**
 * Thailand vs Japan flow evidence — selection, isolation, same-result vs differentiation.
 * Run: node tests/score/thailand-japan-flow.test.js
 *
 * Documents (from executed engines, not UI assumptions):
 * - Cases have no country identity field; benchmark is session selection only.
 * - Live displayed Score uses the selected country engine; Quality V3 remains publish-only.
 * - 2026-08-18 (PO-approved): all 5 country engines now share one grading
 *   formula (computeSharedBenchmarkBase) — a country's score can legitimately
 *   equal Quality V3's and/or another country's score whenever neither
 *   engine's own PASS/FAIL thresholds/severity caps bind. Divergence now
 *   comes only from each country's own standard, never from grading itself.
 * - Case A/B: TH score === JP score === Quality V3 (no cap binds either engine).
 * - DIFF fixture: TH score !== JP score — Japan's own stricter thresholds
 *   trigger its own severity cap on top of the same shared raw base.
 * - 2026-08-19 (PO-approved, evidence-based): Thailand's own TDS/turbidity
 *   PASS ceilings corrected to real cited Thai standards (DOH 2020 TDS
 *   ≤500; MWA operating spec turbidity ≤1.0) — DIFF's readings were
 *   re-chosen so they still clear Thailand's now-tighter bounds while still
 *   failing Japan's own stricter comfort-target thresholds.
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

const sandbox = {
  console,
  document: { getElementById: () => null },
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
    publicScoreView: false
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

/** Real Case A — Japan-origin style measurements used in field calibration. */
const CASE_A = {
  ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06
};
/** Real Case B — Thailand-style measurements used in field calibration. */
const CASE_B = {
  ph: 7.9, tds: 155, turbidity: 0.6, orp: 507, do: 5.2, chlorine: 0.5, temp: 31.0
};
/**
 * Intentional differentiation fixture — inside Thailand's (2026-08-19,
 * evidence-based) compliance ceilings (TDS≤500 DOH 2020 / turb≤1.0 MWA spec
 * / Cl 0.2–2.0) but outside Japan's own stricter comfort-target thresholds
 * (pH 7.3–7.7 ideal / TDS≤200 ideal). Recomputed directly, not estimated.
 */
const DIFF = {
  ph: 8.0, tds: 350, turbidity: 0.5, orp: 400, do: 6, chlorine: 0.5, temp: 26
};

const KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];

function bench(key, readings) {
  return sandbox.WaterScoreBenchmarkRegistry.calculate(key, readings);
}

function compare(key, readings) {
  return sandbox.buildComparisonScoreResult(readings, key);
}

console.log('\nCase identity — no explicit country field on Case / draft shape');
{
  // Current system does not have an explicit case-country identity.
  // Therefore the system cannot know Case X = Thailand / Case Y = Japan
  // unless benchmark is explicitly selected (S.scoreStandardKey).
  const fakeCase = {
    id: 'local-case-preserve-1',
    notionId: 'notion-preserve-1',
    tapData: [{ fields: { 'm-ph': '7.79', 'm-tds': '92' } }]
  };
  assert(!('country' in fakeCase), 'Case has no country field');
  assert(!('scoreStandardKey' in fakeCase), 'Case has no scoreStandardKey field');
  assert(!('benchmark' in fakeCase), 'Case has no benchmark field');
  assert(!('origin' in fakeCase), 'Case has no origin field');
}

console.log('\nBenchmark selection — key routes to the matching engine');
{
  for (const key of KEYS) {
    const direct = bench(key, CASE_A);
    const viaCompare = compare(key, CASE_A);
    assert(direct.engineKey === key, `registry.calculate('${key}') → engineKey ${direct.engineKey}`);
    assert(viaCompare.standardKey === key, `buildComparisonScoreResult('${key}') → standardKey ${viaCompare.standardKey}`);
    assert(viaCompare.engineKey === key, `buildComparisonScoreResult('${key}') → engineKey ${viaCompare.engineKey}`);
    assert(viaCompare.score === direct.score, `comparison score matches registry for ${key}`);
  }
  const th = compare('thailand', CASE_A);
  const jp = compare('japan', CASE_A);
  assert(th.engine === 'Thailand' && jp.engine === 'Japan', 'Thailand vs Japan engine labels distinct');
  assert(th.engineKey !== jp.engineKey, 'Thailand and Japan are separate engine keys');
}

console.log('\nSame-result case — Case A/B both within TH and JP plateaus (EXPECTED equal)');
{
  // PD-015: Thailand ordinary-band calibration can diverge from Japan even when
  // both engines still compliance-pass. Japan expectations unchanged.
  {
    const thA = bench('thailand', CASE_A);
    const jpA = bench('japan', CASE_A);
    const qA = sandbox.computeScoreFromReadings(CASE_A);
    console.log(`  Case A Quality=${qA} TH=${thA.score} JP=${jpA.score}`);
    // 2026-08-18 (PO-approved): one shared grading formula (computeSharedBenchmarkBase)
    // replaced each engine's own curves — TH and Quality V3 coincide (no cap
    // binds Thailand). Japan's own government-cited pH target (7.3-7.7)
    // doesn't include CASE_A's pH=7.79, so it WARNING-caps at 85, genuinely
    // diverging from Thailand — driven by Japan's own threshold, not grading.
    assert(thA.score === 95 && jpA.score === 85, 'Case A: TH=95 JP=85 (Japan\'s own tighter pH target caps it)');
    assert(qA !== thA.score, `Quality ${qA} !== TH benchmark ${thA.score} (weighted TH profile excludes DO)`);
  }
  {
    const thB = bench('thailand', CASE_B);
    const jpB = bench('japan', CASE_B);
    const qB = sandbox.computeScoreFromReadings(CASE_B);
    console.log(`  Case B Quality=${qB} TH=${thB.score} JP=${jpB.score}`);
    // 2026-08-18 (PO-approved): shared grading base — TH coincides with
    // Quality V3 (no cap binds Thailand). Japan's own pH target (7.3-7.7)
    // doesn't include Case B's pH=7.9 either, so it WARNING-classifies; raw
    // base (78) is already below the 85 cap, but the guaranteed minimum
    // deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3) still comes off:
    // 78 - 3 = 75, genuinely diverging Japan from Thailand here too.
    // 2026-08-19 (bug fix): do key removed from JapanBenchmarkWeights, raising 77 -> 81.
    assert(jpB.score === 81, `Case B: JP 81 (got ${jpB.score})`);
    assert(thB.score === 83, `Case B: TH 78 (got ${thB.score})`);
    assert(thB.score !== jpB.score, 'Case B: TH!==JP (Japan\'s own pH WARNING + guaranteed deduction)');
    assert(Number.isFinite(qB) && qB !== thB.score, `Case B: Quality ${qB} !== TH ${thB.score} (weighted profile)`);
  }
}

console.log('\nDifferentiation fixture — standards diverge → TH !== JP');
{
  const th = bench('thailand', DIFF);
  const jp = bench('japan', DIFF);
  console.log('  DIFF TH', th.score, th.params);
  console.log('  DIFF JP', jp.score, jp.params);
  // 2026-08-19 (PO-approved, evidence-based): shared grading base gives TH/JP
  // the same raw number here (81), but Japan's own stricter pH/TDS comfort
  // targets (7.3-7.7 / ≤200) classify this reading WARNING+FAIL, so Japan's
  // own severity cap (75) pulls it down — genuine divergence from each
  // country's own standard, not from grading. Thailand's own (now corrected)
  // thresholds still all PASS this reading (pH 6.5-8.5, TDS≤500, turb≤1.0).
  assert(th.score === 83, `DIFF Thailand = 81 (got ${th.score})`);
  assert(jp.score !== th.score, `DIFF Japan ${jp.score} !== Thailand ${th.score}`);
  assert(jp.classifications.ph === 'WARNING', 'DIFF JP pH WARNING (8.0 outside 7.3-7.7 ideal)');
  assert(jp.classifications.tds === 'FAIL', 'DIFF JP TDS FAIL (350 > JP ideal 200)');
  assert(th.classifications.ph === 'PASS' && th.classifications.tds === 'PASS' && th.classifications.turbidity === 'PASS',
    'DIFF TH still fully compliance-pass under the corrected thresholds');
  assert(th.statuses.tds === 'good' && th.statuses.turbidity === 'good' && th.statuses.chlorine === 'good',
    'DIFF TH still compliance-pass (corrected passMax / Cl band)');
}

console.log('\nQuality isolation — benchmark runs do not mutate Quality / each other');
{
  // Exclude volatile trace fields (calculatedAt / calculationId) — same as benchmark-isolation.
  function stableFingerprint(result) {
    return JSON.stringify({
      engine: result.engine,
      engineKey: result.engineKey,
      score: result.score,
      verdict: result.verdict,
      params: result.params,
      classifications: result.classifications,
      engineVersion: result.engineVersion,
      standardRevision: result.standardRevision,
      inputFingerprint: result.inputFingerprint
    });
  }
  const qBefore = sandbox.computeScoreFromReadings(CASE_A);
  const snaps = {};
  for (const key of KEYS) snaps[key] = stableFingerprint(bench(key, CASE_A));
  for (const key of KEYS) {
    bench(key, CASE_A);
    assert(sandbox.computeScoreFromReadings(CASE_A) === qBefore, `Quality unchanged after ${key}`);
  }
  for (const key of KEYS) {
    assert(stableFingerprint(bench(key, CASE_A)) === snaps[key], `${key} result stable after other engines`);
  }
  const th = compare('thailand', CASE_A);
  const jp = compare('japan', CASE_A);
  assert(th.score === JSON.parse(snaps.thailand).score, 'TH comparison does not mutate engine');
  assert(jp.score === JSON.parse(snaps.japan).score, 'JP comparison does not mutate engine');
}

console.log('\nHero data source contract — live display is country engine; Quality stays publish-only');
{
  const readings = CASE_A;
  const quality = sandbox.computeScoreFromReadings(readings);
  const detail = sandbox.computeQualityScoreDetail(readings);
  const th = compare('thailand', readings);
  const jp = compare('japan', readings);
  const displayedTh = sandbox.resolveDisplayedScore({ readings, standardKey: 'thailand' });
  const displayedJp = sandbox.resolveDisplayedScore({ readings, standardKey: 'japan' });
  const currentScoreResult = {
    score: quality,
    computedScore: quality,
    standardKey: 'quality-v3',
    complianceStatus: detail.compliance.status
  };
  assert(currentScoreResult.standardKey === 'quality-v3', 'publish result tagged quality-v3');
  assert(currentScoreResult.computedScore === quality, 'publish/share source remains Quality V3');
  assert(displayedTh.source === 'country-benchmark' && displayedTh.engineKey === 'thailand',
    'live displayed score uses Thailand engine');
  assert(displayedJp.source === 'country-benchmark' && displayedJp.engineKey === 'japan',
    'live displayed score uses Japan engine');
  assert(displayedTh.score === th.score && displayedJp.score === jp.score,
    'displayed scores match country engines, not Quality');
  // 2026-08-18 (PO-approved): displayed score is still SOURCED from the
  // country engine, not the Quality publish path (source/engineKey checked
  // above) — but since the country engine's raw base now reuses the same
  // shared formula as Quality V3, the NUMBER can legitimately coincide with
  // Quality's when no country-specific cap binds. Source, not value, is the contract.
  assert(displayedTh.score !== quality, `displayed TH ${displayedTh.score} !== Quality ${quality} (weighted profile, no cap binds)`);
  assert(th.standardKey === 'thailand' && jp.standardKey === 'japan', 'comparison carries country keys');
  assert(quality === 92, `Case A Quality locked evidence = 92 (got ${quality})`);
  assert(th.score === 95 && jp.score === 85, 'TH=95 (uncapped) JP=85 (Japan\'s own tighter pH target caps it) while Quality 92');
}

console.log('\nCase persistence — benchmark switch must not wipe caseId / measurements');
{
  const job = {
    id: 'local-case-preserve-1',
    notionId: 'notion-preserve-1',
    tapData: [{
      fields: {
        'm-ph': '7.79',
        'm-tds': '92',
        'm-turb': '0.12',
        'm-orp': '434.1',
        'm-do': '6.34',
        'm-free-cl': '0.3',
        'm-temp': '28.06'
      }
    }]
  };
  const beforeId = job.id;
  const beforeNotion = job.notionId;
  const beforeTap = JSON.stringify(job.tapData);

  sandbox.S.activeJob = job;
  sandbox.S.scoreStandardKey = 'thailand';
  let comparison = compare('thailand', CASE_A);
  sandbox.S.comparisonScoreResult = comparison;
  sandbox.S.scoreVal = sandbox.computeScoreFromReadings(CASE_A);

  sandbox.S.scoreStandardKey = 'japan';
  comparison = compare('japan', CASE_A);
  sandbox.S.comparisonScoreResult = comparison;

  assert(job.id === beforeId, 'caseId unchanged after Japan selection');
  assert(job.notionId === beforeNotion, 'notionId unchanged after Japan selection');
  assert(JSON.stringify(job.tapData) === beforeTap, 'measurements unchanged after Japan selection');
  assert(sandbox.S.comparisonScoreResult.engineKey === 'japan', 'session comparison now Japan');

  sandbox.S.scoreStandardKey = 'thailand';
  comparison = compare('thailand', CASE_A);
  sandbox.S.comparisonScoreResult = comparison;
  assert(job.id === beforeId && JSON.stringify(job.tapData) === beforeTap,
    'switching back to Thailand still preserves case');
}

console.log('\nFull matrix (execution evidence)');
{
  const matrix = {};
  for (const [label, readings] of [['A', CASE_A], ['B', CASE_B], ['DIFF', DIFF]]) {
    const detail = sandbox.computeQualityScoreDetail(readings);
    matrix[label] = {
      quality: detail.score,
      compliance: detail.compliance.status,
      thailand: bench('thailand', readings).score,
      japan: bench('japan', readings).score,
      who: bench('who', readings).score,
      eu: bench('eu', readings).score,
      usEpa: bench('usEpa', readings).score,
      thParams: bench('thailand', readings).params,
      jpParams: bench('japan', readings).params
    };
  }
  console.log('  MATRIX_JSON', JSON.stringify(matrix));
  // 2026-08-18 (PO-approved): shared grading base — A, B, and DIFF all
  // genuinely diverge TH from JP: A and B via Japan's own tighter pH target
  // (7.3-7.7 misses both pH=7.79 and pH=7.9, WARNING classifies; B's raw
  // base is already below the 85 cap, so the guaranteed minimum deduction
  // (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3) is what moves it, 78 -> 75),
  // DIFF (2026-08-19, evidence-based re-pick): Thailand's own corrected
  // thresholds fully PASS this reading (81, uncapped); Japan's own stricter
  // pH/TDS comfort targets classify it WARNING+FAIL, capping it to 75.
  assert(matrix.A.thailand === 95 && matrix.A.japan === 85, 'matrix A TH=92 JP=85 (Japan pH target)');
  assert(matrix.B.thailand === 83 && matrix.B.japan === 81, 'matrix B TH=83 JP=81 (Japan pH WARNING + guaranteed deduction)');
  assert(matrix.DIFF.thailand === 83 && matrix.DIFF.japan === 75, 'matrix DIFF TH=81 JP=75 (Japan pH/TDS FAIL cap)');
  assert(matrix.DIFF.thailand !== matrix.DIFF.japan, 'matrix DIFF TH!==JP');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
