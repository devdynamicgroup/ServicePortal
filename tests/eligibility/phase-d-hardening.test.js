/**
 * Phase D Hardening Suite — final lock-in of the "Not Measured != PASS" fix
 * and the 8 required cases from the Phase D task.
 * Run: node tests/eligibility/phase-d-hardening.test.js
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
  'src/js/score/eligibility/evidenceEngine.js',
  'src/js/score/eligibility/coverageEngine.js',
  'src/js/score/eligibility/contract.js',
  'src/js/score/eligibility/eligibilityEngine.js',
  'src/js/score/eligibility/presentation.js'
];

function makeSandbox() {
  const sandbox = { console, S: { lang: 'en' }, t: k => k };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  }
  return sandbox;
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const FULL_READINGS = { ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5, temp: 28 };
const FULL_TASKS = { tapphoto: true, meter: true, visual: true, chlorine: true };
const COUNTRY_KEYS = ['thailand', 'who', 'eu', 'japan', 'usEpa'];
const LOCKED_SCORES = { thailand: 95, who: 93, eu: 65, japan: 96, usEpa: 91 };

console.log('\nCase 1 — Complete assessment: canCalculateScore + canPublishReport, coverage 100, score calculated');
{
  const sandbox = makeSandbox();
  const contract = sandbox.EligibilityEngine.evaluate({ reportType: 'production', readings: FULL_READINGS, tasks: FULL_TASKS });
  assert(contract.canCalculateScore === true && contract.canPublishReport === true, 'both gates true');
  assert(contract.eligible === true, 'eligible alias is true');
  assert(contract.measurementCoverage === 100 && contract.inspectionCoverage === 100 && contract.overallCoverage === 100, 'all coverage dimensions 100%');
  assert(sandbox.computeLegacyDwqiScore(FULL_READINGS) === 93, 'legacy DWQI still computes (93) — formula frozen');
  assert(Number.isFinite(sandbox.computeScoreFromReadings(FULL_READINGS)), 'Quality V2 computes from these readings');
}

console.log('\nCase 2 — Missing chlorine: canCalculateScore false, listed, contract carries no score field at all');
{
  const sandbox = makeSandbox();
  const readings = { ...FULL_READINGS };
  delete readings.chlorine;
  const contract = sandbox.EligibilityEngine.evaluate({ reportType: 'production', readings, tasks: FULL_TASKS });
  assert(contract.canCalculateScore === false, 'canCalculateScore is false');
  assert(contract.eligible === false, 'eligible alias is false');
  assert(contract.missingMeasurements.includes('chlorine'), 'chlorine listed as missing');
  assert(!('score' in contract), 'Eligibility Contract never embeds a score field — Score and Eligibility stay fully separate concepts, never merged into one object');
}

console.log('\nCase 3 — Missing visual inspection: score calculable, publish blocked');
{
  const sandbox = makeSandbox();
  const contract = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings: FULL_READINGS, tasks: { ...FULL_TASKS, visual: false }
  });
  assert(contract.measurementCoverage === 100, 'measurementCoverage is 100 (all 6 numeric values present)');
  assert(contract.inspectionCoverage < 100, 'inspectionCoverage is below 100');
  assert(contract.canCalculateScore === true, 'canCalculateScore is true — Water Score must be visible');
  assert(contract.canPublishReport === false, 'canPublishReport is false despite a perfect measurement set');
  assert(contract.eligible === false, 'eligible alias follows canPublishReport');
  assert(contract.reason === 'Inspection incomplete', 'reason correctly says inspection incomplete, not missing measurements');
  assert(sandbox.computeLegacyDwqiScore(FULL_READINGS) === 93, 'legacy DWQI fully computable from these readings...');
  assert(Number.isFinite(sandbox.computeScoreFromReadings(FULL_READINGS)), 'Quality V2 fully computable from these readings...');
  assert(contract.canPublishReport === false, '...yet official publish/complete remains blocked');
}

console.log('\nCase 4 — Bad measured value (present, out of range): eligible, score < 100');
{
  const sandbox = makeSandbox();
  const badReadings = { ...FULL_READINGS, ph: 9.5 }; // present, but outside every engine's ideal pH band
  const contract = sandbox.EligibilityEngine.evaluate({ reportType: 'production', readings: badReadings, tasks: FULL_TASKS });
  assert(contract.eligible === true, 'eligible is true — a bad-but-measured value is still evidence, not missing evidence');
  assert(contract.missingMeasurements.length === 0, 'no measurement is considered missing just because its value is bad');
  const score = sandbox.computeScoreFromReadings(badReadings);
  assert(Number.isFinite(score) && score < 93, `score correctly drops from the bad pH (got ${score}) — Eligibility did not artificially lower it, the formula did`);
}

console.log('\nCase F — Real measured values retain their existing classification (PASS not broken)');
{
  const sandbox = makeSandbox();
  // Each engine has its own temp.max (EU is stricter at 25 vs 30 elsewhere) —
  // use a value comfortably within every engine's own limit so this proves
  // "present + in-range still PASSes", not an accidental threshold trip.
  const inRangeReadings = { ...FULL_READINGS, temp: 20 };
  const thaiResult = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', inRangeReadings);
  assert(thaiResult.classifications.do === 'NOT_EVALUATED', `Thailand: present do is NOT_EVALUATED (excluded by PD-003), never PASS (got '${thaiResult.classifications.do}')`);
  assert(thaiResult.classifications.temp === 'NOT_EVALUATED', `Thailand: present temp is NOT_EVALUATED (excluded), never PASS (got '${thaiResult.classifications.temp}')`);
  for (const key of COUNTRY_KEYS.filter((k) => k !== 'thailand')) {
    const result = sandbox.WaterScoreBenchmarkRegistry.calculate(key, inRangeReadings);
    assert(result.classifications.temp === 'PASS', `${key}: a present, in-range temp (20) still classifies PASS (got '${result.classifications.temp}')`);
  }
  // Also confirm the pre-existing EU-specific stricter threshold (25°C) is
  // untouched by this fix — a present-but-out-of-range temp must still WARN,
  // never NOT_MEASURED (NOT_MEASURED is exclusively for absent data).
  const euOutOfRange = sandbox.WaterScoreBenchmarkRegistry.calculate('eu', { ...FULL_READINGS, temp: 28 });
  assert(euOutOfRange.classifications.temp === 'WARNING', `EU: a present but out-of-range temp (28 > 25 max) still WARNs, unaffected by this fix (got '${euOutOfRange.classifications.temp}')`);
}

console.log('\nCase H — Temp independence: Production Score identical with/without Temp');
{
  const sandbox = makeSandbox();
  const readingsNoTemp = { ...FULL_READINGS };
  delete readingsNoTemp.temp;
  const withTempScore = sandbox.computeScoreFromReadings(FULL_READINGS);
  const withoutTempScore = sandbox.computeScoreFromReadings(readingsNoTemp);
  const legacyWith = sandbox.computeLegacyDwqiScore(FULL_READINGS);
  const legacyWithout = sandbox.computeLegacyDwqiScore(readingsNoTemp);
  assert(legacyWith === 93 && legacyWithout === 93,
    `Legacy DWQI identical with (${legacyWith}) and without (${legacyWithout}) Temp present`);
  assert(withTempScore === withoutTempScore && Number.isFinite(withTempScore),
    `Quality V2 identical with (${withTempScore}) and without (${withoutTempScore}) Temp present`);
}

console.log('\nCase 5 — Missing Temp: never silently becomes PASS (the confirmed bug, now fixed)');
{
  const sandbox = makeSandbox();
  const readingsNoTemp = { ...FULL_READINGS };
  delete readingsNoTemp.temp;

  for (const key of COUNTRY_KEYS) {
    const withTemp = sandbox.WaterScoreBenchmarkRegistry.calculate(key, FULL_READINGS);
    const withoutTemp = sandbox.WaterScoreBenchmarkRegistry.calculate(key, readingsNoTemp);
    assert(withoutTemp.classifications.temp !== 'PASS', `${key}: missing temp is never classified PASS (got '${withoutTemp.classifications.temp}')`);
    if (key === 'thailand') {
      assert(withoutTemp.classifications.temp === 'NOT_EVALUATED', 'Thailand: temp is NOT_EVALUATED (excluded), whether measured or missing');
    } else {
      assert(withoutTemp.classifications.temp === 'NOT_MEASURED', `${key}: missing temp is explicitly NOT_MEASURED`);
    }
    assert(withoutTemp.score === withTemp.score, `${key}: score is identical with/without temp (temp carries zero weight) — got ${withoutTemp.score} vs ${withTemp.score}`);
  }
  // Thailand DO: excluded by PD-003 — NEVER PASS; always NOT_EVALUATED
  const thaiWithDo = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', FULL_READINGS);
  const readingsNoDo = { ...FULL_READINGS };
  delete readingsNoDo.do;
  const thaiNoDo = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', readingsNoDo);
  assert(thaiWithDo.classifications.do === 'NOT_EVALUATED', 'Thailand: measured do is NOT_EVALUATED, never PASS');
  assert(thaiNoDo.classifications.do === 'NOT_EVALUATED', 'Thailand: missing do is NOT_EVALUATED (excluded), not PASS');
  assert(thaiNoDo.score === thaiWithDo.score, 'Thailand: score unaffected by do presence (Thailand does not score do)');
  assert(!(thaiWithDo.passedParameters || []).includes('do'), 'Thailand: do must not appear in passedParameters');
}

console.log('\nCase 6 — Explicit zero is Measured, never confused with missing');
{
  const sandbox = makeSandbox();
  const zeroChlorine = sandbox.EvidenceEngine.describeMeasurementEvidence(0);
  assert(zeroChlorine.state === 'Measured', 'explicit 0 is Measured');
  assert(zeroChlorine.value === 0, 'value is preserved as the number 0, not coerced to null');

  const missing = sandbox.EvidenceEngine.describeMeasurementEvidence(undefined);
  const emptyString = sandbox.EvidenceEngine.describeMeasurementEvidence('');
  const nullValue = sandbox.EvidenceEngine.describeMeasurementEvidence(null);
  assert(missing.state === 'Missing' && missing.value === null, 'undefined -> Missing, value null (never coerced to 0)');
  assert(emptyString.state === 'Missing' && emptyString.value === null, "'' -> Missing, value null (never coerced to 0)");
  assert(nullValue.state === 'Missing' && nullValue.value === null, 'null -> Missing, value null (never coerced to 0)');

  // Eligibility must not count an explicit 0 as missing.
  const contract = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings: { ...FULL_READINGS, chlorine: 0 }, tasks: FULL_TASKS
  });
  assert(!contract.missingMeasurements.includes('chlorine'), 'chlorine=0 is not listed as a missing measurement');
}

console.log('\nCase 7 — Published legacy report: not newly blocked, legacy status traceable');
{
  const sandbox = makeSandbox();
  const legacy = sandbox.EligibilityContract.buildLegacy();
  assert(legacy.canCalculateScore === true && legacy.canPublishReport === true && legacy.eligible === true,
    'legacy bypass opens both gates (never newly blocked)');
  assert(legacy.eligibilityState === sandbox.EligibilityContract.STATE.LEGACY_REPORT, 'legacy status is explicitly traceable via eligibilityState');
  assert(legacy.calculationMetadata.eligibilityVersion === 'legacy-bypass', 'legacy status is explicitly traceable via a distinct eligibilityVersion');
}

console.log('\nCase 8 — Country benchmark isolation: all locked scores unchanged after Phase D');
{
  const sandbox = makeSandbox();
  for (const key of COUNTRY_KEYS) {
    const score = sandbox.WaterScoreBenchmarkRegistry.calculate(key, FULL_READINGS).score;
    assert(score === LOCKED_SCORES[key], `${key} still locked at ${LOCKED_SCORES[key]} (got ${score})`);
  }
  assert(sandbox.computeLegacyDwqiScore(FULL_READINGS) === 93, 'Legacy DWQI still locked at 93');
  assert(Number.isFinite(sandbox.computeScoreFromReadings(FULL_READINGS)), 'Quality V2 still computable');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
