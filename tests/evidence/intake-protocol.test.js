/**
 * Evidence Acquisition Protocol — novelty guard tests.
 * Proves a candidate "real" sample that matches a known synthetic/
 * regression fixture (or an existing registry sample) is rejected, and
 * that partition assignment cannot be claimed without an explicit
 * used_for_* flag. Does not modify existing scoring tests or the frozen
 * scoring engines.
 * Run: node tests/evidence/intake-protocol.test.js
 */
const fs = require('fs');
const path = require('path');
const {
  KNOWN_SYNTHETIC_FINGERPRINTS,
  fingerprint,
  assertNovelSample,
  validateIntakeCandidate,
  loadRegistry
} = require(path.join(__dirname, '../../scripts/quality-v3/evidenceRegistry.js'));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}
function assertThrows(fn, msg) {
  try { fn(); failed += 1; console.error(`  FAIL  ${msg} (did not throw)`); }
  catch (e) { passed += 1; console.log(`  ok  ${msg}`); }
}

const REGISTRY_PATH = path.join(__dirname, '../../docs/quality-v3/evidence-registry.json');
const registry = loadRegistry(REGISTRY_PATH);

// ---- A candidate matching a known synthetic fixture is rejected ----
{
  // This is CASE_B from tests/score/quality-v2-calibration.test.js, verbatim.
  const reusedFixture = { ph: 7.9, tds: 155, turbidity: 0.6, orp: 507, chlorine: 0.5, do: 5.2 };
  assertThrows(
    () => assertNovelSample(reusedFixture, registry.samples),
    'a candidate identical to the known CASE_B synthetic fixture is rejected as non-novel'
  );
}
{
  // NEAR_IDEAL ladder profile, verbatim.
  const reusedLadder = { ph: 7.2, tds: 70, turbidity: 0.06, orp: 400, chlorine: 0.3, do: 8.2 };
  assertThrows(
    () => assertNovelSample(reusedLadder, registry.samples),
    'a candidate identical to the known NEAR_IDEAL ladder fixture is rejected as non-novel'
  );
}
{
  // LOCKED / FULL_READINGS / SAMPLE, verbatim.
  const reusedLocked = { ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5 };
  assertThrows(
    () => assertNovelSample(reusedLocked, registry.samples),
    'a candidate identical to the shared LOCKED/FULL_READINGS/SAMPLE fixture is rejected as non-novel'
  );
}

// ---- Resubmitting Case 1328's exact values under a new sample_id is caught ----
{
  const resubmittedCase1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, chlorine: 0.3, do: 6.34 };
  assertThrows(
    () => assertNovelSample(resubmittedCase1328, registry.samples),
    'resubmitting Case 1328\'s exact readings under a different sample_id is caught as a duplicate, not new evidence'
  );
}

// ---- A genuinely novel real sample passes the novelty check ----
{
  const genuinelyNovel = { ph: 6.8, tds: 210, turbidity: 1.1, orp: 375, chlorine: 0.22, do: 5.9 };
  let threw = false;
  try { assertNovelSample(genuinelyNovel, registry.samples); } catch (e) { threw = true; }
  assert(!threw, 'a genuinely novel measurement profile (not matching any known fixture) passes the novelty check');
}

// ---- Partial overlap across six fields is NOT treated as reuse ----
{
  // Same pH/TDS as CASE_B, but every other field genuinely different —
  // must not be rejected, since partial coincidence across independent
  // real readings is expected, not evidence of reuse.
  const partialOverlap = { ph: 7.9, tds: 155, turbidity: 0.15, orp: 280, chlorine: 0.05, do: 7.9 };
  let threw = false;
  try { assertNovelSample(partialOverlap, registry.samples); } catch (e) { threw = true; }
  assert(!threw, 'a candidate that only partially overlaps a known fixture (2 of 6 fields) is not rejected');
}

// ---- Full intake validation: shape + novelty + duplicate-id + partition-claim checks ----
{
  const validCandidate = {
    sample_id: 'TEST-INTAKE-001',
    source_type: 'REAL',
    measurements: { ph: 6.9, tds: 300, turbidity: 2.0, orp: 250, chlorine: 0.6, do: 4.5 },
    outcome_label: null,
    used_for_calibration: false,
    used_for_validation: false,
    used_for_holdout: false,
    partition: 'UNASSIGNED'
  };
  const result = validateIntakeCandidate(validCandidate, registry.samples);
  assert(result.ok === true, 'a well-formed, novel, unassigned candidate passes full intake validation');
}
{
  const duplicateId = { sample_id: 'CASE-1328', source_type: 'REAL', measurements: { ph: 7.0, tds: 100, turbidity: 1, orp: 300, chlorine: 0.4, do: 6 } };
  assertThrows(
    () => validateIntakeCandidate(duplicateId, registry.samples),
    'a candidate reusing an existing sample_id (CASE-1328) is rejected'
  );
}
{
  const claimsPartitionWithoutFlag = {
    sample_id: 'TEST-INTAKE-002',
    source_type: 'REAL',
    measurements: { ph: 6.5, tds: 400, turbidity: 3, orp: 500, chlorine: 1.0, do: 3.5 },
    partition: 'CALIBRATION',
    used_for_calibration: false,
    used_for_validation: false,
    used_for_holdout: false
  };
  assertThrows(
    () => validateIntakeCandidate(claimsPartitionWithoutFlag, registry.samples),
    'a candidate claiming partition=CALIBRATION without setting used_for_calibration is rejected — labels alone are not a decision'
  );
}
{
  // A SYNTHETIC candidate skips the novelty check (it is not claiming to be
  // field evidence) but still gets shape/id/partition validation.
  const syntheticCandidate = {
    sample_id: 'TEST-SYNTHETIC-001',
    source_type: 'SYNTHETIC',
    measurements: { ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5 }, // same as LOCKED — fine, it's honestly labeled SYNTHETIC
    used_for_calibration: false,
    used_for_validation: false,
    used_for_holdout: false,
    partition: 'REGRESSION_ONLY'
  };
  const result = validateIntakeCandidate(syntheticCandidate, registry.samples);
  assert(result.ok === true, 'a SYNTHETIC candidate honestly labeled as such is not subject to the novelty check (it never claimed to be new field evidence)');
}

// ---- Every known-fixture entry actually has a distinct fingerprint from Case 1328 ----
{
  const case1328Fp = fingerprint({ ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, chlorine: 0.3, do: 6.34 });
  const collision = KNOWN_SYNTHETIC_FINGERPRINTS.find(fx => fingerprint(fx) === case1328Fp);
  assert(!collision, 'Case 1328\'s real readings do not accidentally collide with any known synthetic fixture fingerprint');
}

// ---- Zero dependency on any scoring engine ----
{
  const toolingSource = fs.readFileSync(path.join(__dirname, '../../scripts/quality-v3/evidenceRegistry.js'), 'utf8');
  const forbiddenCallPatterns = [
    /require\([^)]*computeQualityScoreV2/i,
    /require\([^)]*computeProductionScore/i,
    /require\([^)]*benchmark/i,
    /\bcomputeQualityScoreDetail\s*\(/,
    /\bcomputeScoreFromReadings\s*\(/,
    /WaterScoreBenchmarkRegistry\s*\./
  ];
  const violations = forbiddenCallPatterns.filter(re => re.test(toolingSource));
  assert(violations.length === 0, 'evidence-registry tooling (including the novelty guard) still has zero dependency on any scoring engine');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
