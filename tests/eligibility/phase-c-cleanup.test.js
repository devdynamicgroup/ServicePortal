/**
 * Phase C Architecture Cleanup Suite
 * Run: node tests/eligibility/phase-c-cleanup.test.js
 *
 * Verifies:
 *  - eligibilityState (machine) is present and correct on every contract shape
 *  - reason (human) is derived from state via Presentation, not authored as logic
 *  - calculationMetadata.eligibilityVersion is present (traceability)
 *  - the "already published" bypass produces a traceable LEGACY_REPORT contract
 *    instead of silently skipping evaluation
 *  - Coverage values on the contract are exactly what CoverageEngine computed —
 *    nothing recalculates them
 *  - INVALID_MEASUREMENTS is distinguished from simply-missing data
 *  - zero drift in production/benchmark scores with the Phase C changes loaded
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
  'src/js/score/eligibility/presentation.js',
  'src/js/score/eligibility/reportEligibility.js'
];

function makeSandbox() {
  const S = { lang: 'en', tapData: [], activeJob: null };
  const sandbox = { console, S, t: k => k };
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

console.log('\neligibilityState is present and correct across all outcomes');
{
  const sandbox = makeSandbox();
  const STATE = sandbox.EligibilityContract.STATE;

  const eligible = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings: FULL_READINGS,
    tasks: { tapphoto: true, meter: true, visual: true, chlorine: true }
  });
  assert(eligible.eligibilityState === STATE.ELIGIBLE, 'ELIGIBLE state when fully covered');
  assert(eligible.reason === null, 'reason is null when eligible');

  const inspectionOnly = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings: FULL_READINGS,
    tasks: { tapphoto: true, meter: true, visual: false, chlorine: true }
  });
  assert(inspectionOnly.eligibilityState === STATE.INSPECTION_INCOMPLETE, 'INSPECTION_INCOMPLETE when only tasks are missing');

  const readingsOnly = (() => {
    const r = { ...FULL_READINGS };
    delete r.chlorine;
    return sandbox.EligibilityEngine.evaluate({
      reportType: 'production', readings: r,
      tasks: { tapphoto: true, meter: true, visual: true, chlorine: true }
    });
  })();
  assert(readingsOnly.eligibilityState === STATE.READINGS_INCOMPLETE, 'READINGS_INCOMPLETE when only measurements are missing');

  const both = (() => {
    const r = { ...FULL_READINGS };
    delete r.chlorine;
    return sandbox.EligibilityEngine.evaluate({
      reportType: 'production', readings: r,
      tasks: { tapphoto: true, meter: true, visual: false, chlorine: true }
    });
  })();
  assert(both.eligibilityState === STATE.READINGS_AND_INSPECTION_INCOMPLETE, 'combined state when both dimensions are incomplete');

  const invalid = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings: { ...FULL_READINGS, ph: 'not-a-number' },
    tasks: { tapphoto: true, meter: true, visual: true, chlorine: true }
  });
  assert(invalid.eligibilityState === STATE.INVALID_MEASUREMENTS, 'INVALID_MEASUREMENTS distinguished from plain-missing data');
  assert(invalid.missingMeasurements.includes('ph'), 'invalid ph still surfaces in missingMeasurements for the UI list');
}

console.log('\nReason text is derived FROM state, not authored independently (logic/presentation separation)');
{
  const sandbox = makeSandbox();
  const result = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings: FULL_READINGS,
    tasks: { tapphoto: true, meter: true, visual: false, chlorine: true }
  });
  const presented = sandbox.EligibilityPresentation.reasonFromState(result.eligibilityState);
  assert(result.reason === presented, 'contract.reason equals EligibilityPresentation.reasonFromState(contract.eligibilityState)');
}

console.log('\ncalculationMetadata.eligibilityVersion is present (traceability)');
{
  const sandbox = makeSandbox();
  const result = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings: FULL_READINGS,
    tasks: { tapphoto: true, meter: true, visual: true, chlorine: true }
  });
  assert(typeof result.calculationMetadata.eligibilityVersion === 'string' && result.calculationMetadata.eligibilityVersion.length > 0,
    'every contract carries a non-empty eligibilityVersion');
  assert(result.calculationMetadata.eligibilityVersion === sandbox.EligibilityContract.VERSION,
    'version matches the architecture-level EligibilityContract.VERSION constant');
}

console.log('\nAlready-published bypass produces a traceable LEGACY_REPORT contract, not a silent skip');
{
  const sandbox = makeSandbox();
  const legacy = sandbox.EligibilityContract.buildLegacy();
  assert(legacy.canCalculateScore === true && legacy.canPublishReport === true && legacy.eligible === true,
    'legacy bypass contract opens both gates (matches pre-Phase-C bypass behaviour)');
  assert(legacy.eligibilityState === sandbox.EligibilityContract.STATE.LEGACY_REPORT, 'legacy bypass is tagged LEGACY_REPORT');
  assert(legacy.calculationMetadata.eligibilityVersion === 'legacy-bypass', 'legacy bypass is tagged with a distinct version string, never confused with a fresh v1 evaluation');
  assert(sandbox.EligibilityContract.isValid(legacy), 'legacy contract still conforms to the same Eligibility Contract shape');
}

console.log('\nCoverage values on the contract are exactly what CoverageEngine computed — nothing recalculates them');
{
  const sandbox = makeSandbox();
  const evidence = sandbox.EvidenceEngine.buildEvidenceMap(FULL_READINGS);
  const directCoverage = sandbox.CoverageEngine.calculateCoverage({
    evidence,
    requiredMeasurements: ['ph', 'tds', 'orp', 'do', 'chlorine', 'turbidity'],
    tasks: { tapphoto: true, meter: true, visual: false, chlorine: true },
    requiredTasks: ['tapphoto', 'meter', 'visual', 'chlorine']
  });
  const viaEngine = sandbox.EligibilityEngine.evaluate({
    reportType: 'production', readings: FULL_READINGS,
    tasks: { tapphoto: true, meter: true, visual: false, chlorine: true }
  });
  assert(viaEngine.measurementCoverage === directCoverage.measurementCoverage, 'measurementCoverage passed through unchanged');
  assert(viaEngine.inspectionCoverage === directCoverage.inspectionCoverage, 'inspectionCoverage passed through unchanged');
  assert(viaEngine.overallCoverage === directCoverage.overallCoverage, 'overallCoverage passed through unchanged');
}

console.log('\nZero drift: production + benchmark scores unchanged with Phase C loaded');
{
  const sandbox = makeSandbox();
  assert(sandbox.computeLegacyDwqiScore(FULL_READINGS) === 93, 'legacy DWQI still locked at 93');
  assert(Number.isFinite(sandbox.computeScoreFromReadings(FULL_READINGS)), 'Quality V2 computes finite score');
  const expected = { thailand: 89, who: 93, eu: 65, japan: 96, usEpa: 91 };
  for (const key of Object.keys(expected)) {
    assert(sandbox.WaterScoreBenchmarkRegistry.calculate(key, FULL_READINGS).score === expected[key],
      `${key} score still locked at ${expected[key]}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
