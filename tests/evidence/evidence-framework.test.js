/**
 * Quality V3 evidence-framework tests.
 * Proves the evidence-registry tooling enforces the calibration /
 * validation / holdout partition rule and never touches, imports, or
 * invokes any scoring engine. Does not modify existing scoring tests.
 * Run: node tests/evidence/evidence-framework.test.js
 */
const fs = require('fs');
const path = require('path');
const {
  assertPartitionIntegrity,
  isImmutableHoldout,
  freezeRegistry,
  attemptCalibrationUse,
  computeEvidenceInventory,
  loadRegistry
} = require(path.join(__dirname, '../../scripts/quality-v3/evidenceRegistry.js'));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}
function assertThrows(fn, msg) {
  try {
    fn();
    failed += 1;
    console.error(`  FAIL  ${msg} (did not throw)`);
  } catch (e) {
    passed += 1;
    console.log(`  ok  ${msg}`);
  }
}

const REGISTRY_PATH = path.join(__dirname, '../../docs/quality-v3/evidence-registry.json');
const registry = loadRegistry(REGISTRY_PATH);

// ---- 1. Case 1328 is classified as calibration/reference ----
{
  const case1328 = registry.samples.find(r => r.sample_id === 'CASE-1328');
  assert(Boolean(case1328), 'Case 1328 record exists in the evidence registry');
  assert(case1328.source_type === 'REAL', 'Case 1328 is classified REAL (it is a real field measurement)');
  assert(case1328.used_for_calibration === true, 'Case 1328 is marked used_for_calibration');
  assert(case1328.used_for_validation === false, 'Case 1328 is NOT marked used_for_validation');
  assert(case1328.used_for_holdout === false, 'Case 1328 is NOT marked used_for_holdout');
  assert(case1328.partition === 'CALIBRATION', 'Case 1328 partition is CALIBRATION, not VALIDATION or HOLDOUT');
  assert(case1328.outcome_label === null, 'Case 1328 has no outcome label (none was fabricated)');
}

// ---- 2. A calibration sample cannot simultaneously be marked holdout ----
assertThrows(
  () => assertPartitionIntegrity({ sample_id: 'BAD-1', source_type: 'REAL', used_for_calibration: true, used_for_holdout: true }),
  'a record marked both used_for_calibration and used_for_holdout is rejected'
);
assertThrows(
  () => assertPartitionIntegrity({ sample_id: 'BAD-2', source_type: 'REAL', used_for_calibration: true, used_for_validation: true }),
  'a record marked both used_for_calibration and used_for_validation is rejected'
);
{
  const ok = assertPartitionIntegrity({ sample_id: 'OK-1', source_type: 'REAL', used_for_validation: true, used_for_holdout: false });
  assert(ok.validation === true && ok.holdout === false, 'a validation-only record passes integrity checks');
}

// ---- 3. A holdout record is immutable/read-only from calibration tooling ----
{
  const holdoutRecord = { sample_id: 'HOLDOUT-1', source_type: 'REAL', used_for_calibration: false, used_for_validation: false, used_for_holdout: true };
  assert(isImmutableHoldout(holdoutRecord) === true, 'a used_for_holdout record is recognized as immutable');

  const [frozen] = freezeRegistry([holdoutRecord]);
  assert(Object.isFrozen(frozen), 'freezeRegistry() actually freezes the holdout record object');
  try { frozen.used_for_calibration = true; } catch (e) { /* strict-mode throw is also acceptable */ }
  assert(frozen.used_for_calibration === false, 'mutating a frozen holdout record has no effect (Object.freeze rejects the write)');

  assertThrows(
    () => attemptCalibrationUse(holdoutRecord),
    'calibration tooling attempting to use a holdout record is blocked'
  );

  const calibrationRecord = { sample_id: 'CAL-1', source_type: 'REAL', used_for_calibration: false, used_for_validation: false, used_for_holdout: false };
  const used = attemptCalibrationUse(calibrationRecord);
  assert(used.used_for_calibration === true, 'calibration tooling can use a non-holdout record normally');
}

// ---- 4. Missing outcomes remain unknown (never fabricated) ----
{
  const registryRaw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const allSamples = registryRaw.samples;
  allSamples.forEach(record => {
    assert(
      record.outcome_label === null,
      `${record.sample_id}: outcome_label stays null (no fabricated ground truth exists in this registry)`
    );
  });
}

// ---- 5. Synthetic fixtures cannot be classified as REAL accidentally ----
assertThrows(
  () => assertPartitionIntegrity({ sample_id: 'NO-SOURCE-TYPE' }),
  'a record with no source_type at all is rejected, not defaulted to REAL'
);
assertThrows(
  () => assertPartitionIntegrity({ sample_id: 'BAD-SOURCE-TYPE', source_type: 'MOCK' }),
  'a record with an unrecognized source_type is rejected'
);
{
  const synthetic = registry.samples.find(r => r.sample_id === 'SYNTHETIC-CASE-B');
  assert(synthetic.source_type === 'SYNTHETIC', 'the hand-authored Case B fixture is classified SYNTHETIC');
  assert(synthetic.partition === 'REGRESSION_ONLY', 'the hand-authored Case B fixture is partitioned REGRESSION_ONLY, not CALIBRATION');
}

// ---- 6. Regression fixtures are not counted as validation evidence ----
{
  const inventory = computeEvidenceInventory(registry.samples);
  assert(inventory.real === 1, 'only 1 REAL sample counted (Case 1328) — synthetic regression fixtures excluded');
  assert(inventory.synthetic === 2, '2 SYNTHETIC/regression-only records tracked, separately, never merged into real counts');
  assert(inventory.validation === 0, 'synthetic ladder/CaseB fixtures contribute 0 to the validation count');
  assert(inventory.holdout === 0, 'synthetic fixtures contribute 0 to the holdout count');
}

// ---- 7. Model provenance correctly reports the current evidence state ----
{
  const inventory = computeEvidenceInventory(registry.samples);
  assert(inventory.real === 1, 'inventory: 1 real sample');
  assert(inventory.calibration === 1, 'inventory: 1 calibration sample');
  assert(inventory.validation === 0, 'inventory: 0 validation samples');
  assert(inventory.holdout === 0, 'inventory: 0 holdout samples');
  assert(inventory.outcomeLabelled === 0, 'inventory: 0 outcome-labelled samples');
}

// ---- 8. No scoring function is invoked with modified calibration parameters by the evidence tooling ----
// Check actual invocation/import (require calls and bare function-call
// syntax), not incidental prose mentions of file/function names in
// comments — the module's doc header legitimately names the frozen files
// it deliberately does NOT depend on.
{
  const toolingSource = fs.readFileSync(path.join(__dirname, '../../scripts/quality-v3/evidenceRegistry.js'), 'utf8');
  const forbiddenCallPatterns = [
    /require\([^)]*computeQualityScoreV2/i,
    /require\([^)]*computeProductionScore/i,
    /require\([^)]*benchmark/i,
    /\bcomputeQualityScoreDetail\s*\(/,
    /\bcomputeScoreFromReadings\s*\(/,
    /\bcomputeLegacyDwqiScore\s*\(/,
    /\bgradePh\s*\(/,
    /\bgradeTds\s*\(/,
    /\bgradeTurbidity\s*\(/,
    /\bgradeOrp\s*\(/,
    /\bgradeChlorine\s*\(/,
    /\bgradeDo\s*\(/,
    /WaterScoreBenchmarkRegistry\s*\./
  ];
  const violations = forbiddenCallPatterns.filter(re => re.test(toolingSource));
  assert(
    violations.length === 0,
    `evidence-registry tooling never imports or invokes any scoring engine or grade function (${violations.length} violating pattern(s) found)`
  );
  assert(
    !require.cache[require.resolve('../../src/js/score/production/computeQualityScoreV2.js')],
    'requiring the evidence tooling never pulls the Quality V3 scoring module into the process'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
