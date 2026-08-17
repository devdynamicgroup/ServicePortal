/**
 * Canonical V7 semantic / property tests.
 * Run: node tests/canonical-score/canonical-skeleton.test.js
 */
const fs = require('fs');
const path = require('path');
const {
  NOT_CALIBRATED,
  NOT_COMPUTABLE,
  MODEL_VERSION,
  simulateCanonicalScore,
  aggregateQuality,
  toFinalScore,
  getBenchmarkProfile,
  listBenchmarkProfiles,
  evaluateCompliance,
  evaluateRisk
} = require('../../services/canonical-score');

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

const COMPLETE = Object.freeze({
  ph: 7.2, tds: 80, chlorine: 0.3, turbidity: 0.1, orp: 400, do: 8, temp: 25
});

function sourceOf(rel) {
  return fs.readFileSync(path.join(__dirname, '../../', rel), 'utf8');
}

function testIsolation() {
  console.log('\nIsolation — canonical module has no Notion/Case/live-score imports');
  const files = [
    'services/canonical-score/constants.js',
    'services/canonical-score/profiles.js',
    'services/canonical-score/simulate.js',
    'services/canonical-score/index.js'
  ];
  const forbidden = [
    'notion/clients',
    'workflow-service',
    'case-flow',
    'score-publication',
    'computeQualityScore',
    'score/benchmark',
    'score/production'
  ];
  files.forEach((file) => {
    const src = sourceOf(file);
    forbidden.forEach((needle) => {
      ok(!src.includes(needle), `${file} does not import ${needle}`);
    });
  });
}

function testMissingData() {
  console.log('\nMissing data → NOT_COMPUTABLE');
  const incomplete = { ...COMPLETE };
  delete incomplete.ph;
  const result = simulateCanonicalScore(incomplete, 'thailand');
  ok(result.computability === NOT_COMPUTABLE, 'missing pH is NOT_COMPUTABLE');
  ok(result.qualityScore === NOT_COMPUTABLE, 'qualityScore is NOT_COMPUTABLE not 0/100');
  ok(result.finalScore === NOT_COMPUTABLE, 'finalScore is NOT_COMPUTABLE');
  ok(result.completeness.missing.includes('ph'), 'missing lists ph');
}

function testCalibrationBlocking() {
  console.log('\nCalibration blocking — α/F undefined → NOT_CALIBRATED');
  const agg = aggregateQuality();
  ok(agg.status === NOT_CALIBRATED, 'aggregateQuality status NOT_CALIBRATED');
  ok(agg.qualityScore === NOT_CALIBRATED, 'does not emit weighted mean');
  ok(agg.alpha === 'TBD' && agg.exactF === 'TBD', 'α / F remain TBD');
  const result = simulateCanonicalScore(COMPLETE, 'thailand');
  ok(result.computability === 'COMPUTABLE', 'complete readings are COMPUTABLE');
  ok(result.qualityScore === NOT_CALIBRATED, 'complete but uncalibrated qualityScore');
  ok(result.finalScore === NOT_CALIBRATED, 'complete but uncalibrated finalScore');
  ok(result.calibrationStatus === NOT_CALIBRATED, 'calibrationStatus NOT_CALIBRATED');
  ok(result.parameterQuality.ph.value === NOT_CALIBRATED, 'parameterQuality not filled from Q-V3');
}

function testNoHiddenCaps() {
  console.log('\nNo hidden caps — CRITICAL risk does not rewrite quality');
  ok(toFinalScore(94, 'CRITICAL') === 94, 'finalScore stays 94 when risk is CRITICAL');
  ok(toFinalScore(94, 'PASS') === 94, 'finalScore stays 94 when risk is PASS');
  ok(toFinalScore(NOT_CALIBRATED, 'CRITICAL') === NOT_CALIBRATED, 'NOT_CALIBRATED quality is unchanged by risk');
}

function testSemanticSeparation() {
  console.log('\nSemantic separation');
  const a = simulateCanonicalScore(COMPLETE, 'thailand');
  const riskA = evaluateRisk({ status: 'PASS' }, { riskRules: { status: 'CALIBRATED', fromCompliance: () => 'PASS' } });
  const riskB = evaluateRisk({ status: 'FAIL' }, { riskRules: { status: 'CALIBRATED', fromCompliance: () => 'CRITICAL' } });
  ok(riskA.value === 'PASS' && riskB.value === 'CRITICAL', 'risk evaluator can change independently');
  ok(toFinalScore(a.qualityScore, riskA.value) === toFinalScore(a.qualityScore, riskB.value),
    'riskSeverity change does not change finalScore');

  const complianceA = evaluateCompliance(COMPLETE, getBenchmarkProfile('thailand'));
  const fixtureProfile = {
    ...getBenchmarkProfile('thailand'),
    parameters: {
      ...getBenchmarkProfile('thailand').parameters,
      ph: {
        ...getBenchmarkProfile('thailand').parameters.ph,
        complianceLimits: { status: 'CALIBRATED', contains: (n) => n >= 6.5 && n <= 8.5 }
      }
    }
  };
  const complianceB = evaluateCompliance({ ...COMPLETE, ph: 3 }, fixtureProfile);
  ok(complianceA.status === NOT_CALIBRATED, 'production profile compliance is NOT_CALIBRATED');
  ok(complianceB.status === 'FAIL', 'test-injected limits can fail without becoming V7 production values');
  ok(toFinalScore(NOT_CALIBRATED, 'CRITICAL') === NOT_CALIBRATED,
    'compliance/risk cannot write finalScore; quality remains NOT_CALIBRATED');
}

function testCountryIndependence() {
  console.log('\nCountry independence — same aggregator, profile data only');
  const keys = listBenchmarkProfiles().map((p) => p.benchmarkKey);
  ok(keys.join(',') === 'thailand,japan,who,eu,usEpa', 'five BenchmarkProfiles exist');
  const th = simulateCanonicalScore(COMPLETE, 'thailand');
  const jp = simulateCanonicalScore(COMPLETE, 'japan');
  ok(th.aggregation.family === jp.aggregation.family, 'same HYBRID-FAMILY aggregator');
  ok(th.modelVersion === MODEL_VERSION && jp.modelVersion === MODEL_VERSION, 'same modelVersion');
  ok(jp.parameterQuality.do.value === 'NOT_APPLICABLE', 'Japan DO is profile applicability, not a private algorithm');
  ok(th.parameterQuality.do.status === NOT_CALIBRATED, 'Thailand DO stays scored-but-uncalibrated');
  ok(!COMPLETE.do || jp.completeness.required.includes('do') === false, 'Japan does not require DO');
}

function testDeterminism() {
  console.log('\nDeterminism');
  const a = JSON.stringify(simulateCanonicalScore(COMPLETE, 'who'));
  const b = JSON.stringify(simulateCanonicalScore(COMPLETE, 'who'));
  ok(a === b, 'same inputs → identical JSON');
}

function testJapanIncompleteStillComputableWithoutDo() {
  console.log('\nJapan completeness without DO');
  const noDo = { ph: 7.2, tds: 80, chlorine: 0.3, turbidity: 0.1, orp: 400 };
  const jp = simulateCanonicalScore(noDo, 'japan');
  const th = simulateCanonicalScore(noDo, 'thailand');
  ok(jp.computability === 'COMPUTABLE', 'Japan without DO is COMPUTABLE');
  ok(th.computability === NOT_COMPUTABLE, 'Thailand without DO is NOT_COMPUTABLE');
}

async function main() {
  testIsolation();
  testMissingData();
  testCalibrationBlocking();
  testNoHiddenCaps();
  testSemanticSeparation();
  testCountryIndependence();
  testDeterminism();
  testJapanIncompleteStillComputableWithoutDo();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main();
