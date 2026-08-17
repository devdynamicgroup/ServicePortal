/**
 * Thailand vs Japan flow evidence — selection, isolation, same-result vs differentiation.
 * Run: node tests/score/thailand-japan-flow.test.js
 *
 * Documents (from executed engines, not UI assumptions):
 * - Cases have no country identity field; benchmark is session selection only.
 * - Live displayed Score uses the selected country engine; Quality V3 remains publish-only.
 * - Case A/B: TH score === JP score is expected (both within national plateaus).
 * - DIFF fixture: TH score !== JP score when standards diverge.
 *   TH is no longer a flat 100 across the full compliance band.
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
 * Intentional differentiation fixture — inside Thailand compliance ceilings
 * (TDS≤1000 / turb≤5 / Cl 0.2–2.0) but outside Japan stricter limits,
 * and outside Thailand inner 100-plateaus (TDS 300 / turb 1 / Cl 0.2–0.5).
 */
const DIFF = {
  ph: 7.2, tds: 800, turbidity: 3.5, orp: 350, do: 5.5, chlorine: 1.5, temp: 28
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
    // Thailand weakest-link share 0.25->0.5 (2026-08-17, PO-approved): TH's raw
    // composite is now 98.35 (rounds to 98, below ceiling). Japan pH inner
    // curve (2026-08-17, PO-approved): CASE_A's pH=7.79 is just past the
    // 7.3-7.7 ideal window (grade 91), also pulling Japan to 98 -- coincide again.
    assert(thA.score === 98 && jpA.score === 98, 'Case A: TH=98, JP=98 (coincide again, not a ranking)');
    assert(Number.isFinite(qA) && qA < thA.score, `Case A: Quality ${qA} is not overwritten by TH ${thA.score}`);
  }
  {
    const thB = bench('thailand', CASE_B);
    const jpB = bench('japan', CASE_B);
    const qB = sandbox.computeScoreFromReadings(CASE_B);
    console.log(`  Case B Quality=${qB} TH=${thB.score} JP=${jpB.score}`);
    // Japan pH inner curve (2026-08-17, PO-approved): CASE_B's pH=7.9 is past
    // the 7.3-7.7 ideal window (grade 80), pulling Japan to 95 (was 98).
    assert(jpB.score === 95, `Case B: JP 95 (got ${jpB.score})`);
    // Chlorine curve + weakest-link share 0.25->0.5 (2026-08-17, PO-approved): 83 (was 86).
    assert(thB.score === 83, `Case B: TH=83 after ordinary-band severity (got ${thB.score})`);
    assert(thB.score !== jpB.score, 'Case B: TH may diverge from JP after PD-015');
    assert(Number.isFinite(qB) && qB < thB.score, `Case B: Quality ${qB} is not overwritten by TH ${thB.score}`);
  }
}

console.log('\nDifferentiation fixture — standards diverge → TH !== JP');
{
  const th = bench('thailand', DIFF);
  const jp = bench('japan', DIFF);
  console.log('  DIFF TH', th.score, th.params);
  console.log('  DIFF JP', jp.score, jp.params);
  // Chlorine curve + weakest-link share 0.25->0.5 (2026-08-17, PO-approved): 46 (was 69).
  assert(th.score === 46, `DIFF Thailand = 46 after ordinary-band severity (got ${th.score})`);
  assert(jp.score !== th.score, `DIFF Japan ${jp.score} !== Thailand ${th.score}`);
  assert(jp.params.tds < 100, 'DIFF JP TDS below 100 (TDS 800 > JP 500)');
  assert(jp.params.turbidity < 100, 'DIFF JP turbidity below 100 (3.5 > JP 2)');
  assert(jp.params.chlorine < 100, 'DIFF JP chlorine below 100 (1.5 > JP 1)');
  assert(th.params.tds < 100 && th.params.turbidity < 100 && th.params.chlorine < 100,
    'DIFF TH TDS/turb/Cl leave the inner 100-plateau while remaining inside passMax');
  assert(th.statuses.tds === 'good' && th.statuses.turbidity === 'good' && th.statuses.chlorine === 'good',
    'DIFF TH still compliance-pass (passMax / Cl band unchanged)');
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
  assert(displayedTh.score !== quality, `displayed TH ${displayedTh.score} !== Quality ${quality}`);
  assert(th.standardKey === 'thailand' && jp.standardKey === 'japan', 'comparison carries country keys');
  assert(quality === 92, `Case A Quality locked evidence = 92 (got ${quality})`);
  // Thailand's weakest-link share update (2026-08-17, PO-approved) rounds its
  // raw composite to 98 for this reading. Japan pH inner curve (2026-08-17,
  // PO-approved): pH=7.79 is just past the ideal window, also rounding to 98
  // (both below the ceiling).
  assert(th.score === 98 && jp.score === 98, 'TH=98, JP=98 (both below ceiling) while Quality 92');
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
  // Thailand weakest-link share 0.25->0.5 (2026-08-17, PO-approved): TH moves
  // for A/B/DIFF. Japan pH/TDS/chlorine inner curves (2026-08-17, PO-approved):
  // JP also moves for A/B/DIFF (each has pH/tds/chlorine past its new ideal
  // window) — A coincides with TH again by coincidence.
  assert(matrix.A.thailand === 98 && matrix.A.japan === 98, 'matrix A TH=98, JP=98');
  assert(matrix.B.thailand === 83 && matrix.B.japan === 95, 'matrix B TH=83 JP=95');
  // Japan turbidity inner curve (2026-08-17, PO-approved): DIFF's
  // turbidity=3.5 now grades 40 (flat zone 2-6 NTU), CRITICAL (was
  // FAIL/grade~78), severity-capped at 60 (was 75). Thailand's own chlorine
  // curve + weakest-link update (2026-08-17) separately moves its DIFF score to 46.
  assert(matrix.DIFF.thailand === 46 && matrix.DIFF.japan === 54, 'matrix DIFF TH=46 JP=54');
  assert(matrix.DIFF.thailand !== matrix.DIFF.japan, 'matrix DIFF TH!==JP');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
