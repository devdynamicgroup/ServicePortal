/**
 * Quality V3 evidence-registry tooling.
 *
 * Pure data-governance utility. Deliberately has ZERO dependency on any
 * scoring engine (computeQualityScoreV2.js, computeProductionScore.js, or
 * any country benchmark engine) — it classifies and validates evidence
 * records, it never computes or influences a score. See
 * docs/quality-v3/CALIBRATION_WORKFLOW.md for the rules this module
 * enforces.
 */
const fs = require('fs');

const SOURCE_TYPES = Object.freeze(['REAL', 'SYNTHETIC']);
const PARTITIONS = Object.freeze(['CALIBRATION', 'VALIDATION', 'HOLDOUT', 'REGRESSION_ONLY', 'UNASSIGNED']);

/**
 * A record's source_type must be explicit. There is no default — a record
 * missing it is rejected outright rather than silently treated as REAL or
 * SYNTHETIC, so a synthetic fixture can never accidentally count as field
 * evidence (and vice versa).
 */
function assertValidRecordShape(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('evidence record must be an object');
  }
  if (!record.sample_id || typeof record.sample_id !== 'string') {
    throw new Error('evidence record missing a string sample_id');
  }
  if (!SOURCE_TYPES.includes(record.source_type)) {
    throw new Error(
      `evidence record ${record.sample_id}: source_type must be explicitly REAL or SYNTHETIC (got ${JSON.stringify(record.source_type)}) — it is never defaulted`
    );
  }
  if (record.partition !== undefined && !PARTITIONS.includes(record.partition)) {
    throw new Error(`evidence record ${record.sample_id}: unknown partition ${JSON.stringify(record.partition)}`);
  }
}

/**
 * Enforces the partition rule from CALIBRATION_WORKFLOW.md §2:
 *   - a sample already used for calibration or validation can never also
 *     be marked holdout (holdout must never have been inspected before);
 *   - a sample used for calibration cannot simultaneously be claimed as
 *     independent validation evidence.
 * Throws on violation rather than silently normalizing — this framework
 * exists to make these mistakes loud, not to quietly fix them.
 */
function assertPartitionIntegrity(record) {
  assertValidRecordShape(record);
  const calibration = Boolean(record.used_for_calibration);
  const validation = Boolean(record.used_for_validation);
  const holdout = Boolean(record.used_for_holdout);

  if (holdout && (calibration || validation)) {
    throw new Error(
      `evidence record ${record.sample_id}: a sample already used for calibration/validation can never be (re)classified as holdout`
    );
  }
  if (calibration && validation) {
    throw new Error(
      `evidence record ${record.sample_id}: a sample used for calibration cannot simultaneously be counted as independent validation evidence`
    );
  }
  return { calibration, validation, holdout };
}

function isImmutableHoldout(record) {
  return Boolean(record.used_for_holdout);
}

/**
 * Returns a copy of the registry with every holdout record deep-frozen, so
 * downstream tooling cannot mutate a holdout record in place.
 */
function freezeRegistry(records) {
  return records.map(record => (isImmutableHoldout(record) ? Object.freeze({ ...record }) : record));
}

/**
 * Simulates a calibration tool attempting to use a record. Throws if the
 * record is holdout — holdout data must never be inspected during
 * calibration, let alone used to shape a parameter.
 */
function attemptCalibrationUse(record) {
  assertPartitionIntegrity(record);
  if (isImmutableHoldout(record)) {
    throw new Error(
      `evidence record ${record.sample_id} is HOLDOUT and is immutable/read-only from calibration tooling — it must never be inspected or used during calibration`
    );
  }
  return { ...record, used_for_calibration: true };
}

/**
 * Computes the evidence inventory exactly as MODEL_PROVENANCE.md reports
 * it: real vs synthetic counts, and — among REAL samples only — how many
 * are calibration / validation / holdout / outcome-labelled. Regression
 * fixtures (SYNTHETIC, partition REGRESSION_ONLY) never contribute to the
 * calibration/validation/holdout/outcome-labelled counts, by construction
 * (those flags should be false and outcome_label null on such records —
 * this function does not special-case them, it just never counts SYNTHETIC
 * rows as REAL).
 */
function computeEvidenceInventory(records) {
  records.forEach(assertPartitionIntegrity);
  const real = records.filter(r => r.source_type === 'REAL');
  const synthetic = records.filter(r => r.source_type === 'SYNTHETIC');
  return Object.freeze({
    real: real.length,
    synthetic: synthetic.length,
    calibration: real.filter(r => r.used_for_calibration).length,
    validation: real.filter(r => r.used_for_validation).length,
    holdout: real.filter(r => r.used_for_holdout).length,
    outcomeLabelled: real.filter(r => r.outcome_label !== null && r.outcome_label !== undefined).length
  });
}

function loadRegistry(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw.samples)) {
    throw new Error('evidence registry must have a top-level "samples" array');
  }
  raw.samples.forEach(assertValidRecordShape);
  return raw;
}

// ---------------------------------------------------------------------------
// Novelty guard — Evidence Acquisition Protocol
// (see docs/quality-v3/EVIDENCE_ACQUISITION_PROTOCOL.md)
//
// Every synthetic/regression profile that has EVER been used while the
// author could see Quality V3's behavior (i.e. every fixture in
// tests/score/*.test.js, tests/eligibility/*.test.js, and
// tests/benchmark/*.test.js) is fingerprinted here. A newly submitted
// "real" sample is rejected if it matches one of these fingerprints,
// because a measurement profile that is identical to a value someone
// already typed in while iterating on the model cannot be honestly
// described as independently observed field evidence.
//
// This list is intentionally static/hand-maintained (not derived by
// requiring the test files at runtime) — the whole point is to freeze what
// counts as "already seen by the model author" at the moment this protocol
// was introduced, independent of the frozen scoring engine.
// ---------------------------------------------------------------------------

const KNOWN_SYNTHETIC_FINGERPRINTS = Object.freeze([
  // tests/score/quality-v2-calibration.test.js
  { ph: 7.9, tds: 155, turbidity: 0.6, orp: 507, do: 5.2, chlorine: 0.5 }, // CASE_B
  { ph: 7.2, tds: 70, turbidity: 0.06, orp: 400, do: 8.2, chlorine: 0.3 }, // NEAR_IDEAL
  { ph: 7.4, tds: 130, turbidity: 0.22, orp: 460, do: 7.3, chlorine: 0.36 }, // VERY_GOOD
  { ph: 7.6, tds: 190, turbidity: 0.45, orp: 510, do: 6.6, chlorine: 0.42 }, // GOOD
  { ph: 7.9, tds: 260, turbidity: 0.85, orp: 560, do: 6.1, chlorine: 0.48 }, // ACCEPTABLE
  { ph: 8.3, tds: 340, turbidity: 1.3, orp: 180, do: 5.4, chlorine: 0.6 }, // BORDERLINE
  { ph: 9.0, tds: 700, turbidity: 4, orp: 100, do: 4.0, chlorine: 1.5 }, // POOR
  { ph: 5.0, tds: 1500, turbidity: 9, orp: 50, do: 2.0, chlorine: 3.0 }, // CRITICAL
  { ph: 7.2, tds: 800, turbidity: 3.5, orp: 350, do: 5.5, chlorine: 1.5 }, // DIFF
  { ph: 8.4, tds: 290, turbidity: 0.95, orp: 220, do: 6.05, chlorine: 0.49 }, // passNotIdeal
  // Reused across tests/score/case-1328-calibration-baseline.test.js,
  // tests/eligibility/{phase-b-wiring,phase-c-cleanup,phase-d-hardening,score-vs-publish-eligibility}.test.js,
  // tests/benchmark/benchmark-isolation.test.js — "LOCKED" / "FULL_READINGS" / "SAMPLE"
  { ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5 }
]);

const NOVELTY_KEYS = Object.freeze(['ph', 'tds', 'turbidity', 'orp', 'chlorine', 'do']);

/**
 * Rounds to 3 decimals per field, matching the existing rounding convention
 * in src/js/score/util/benchmarkMetadata.js's normalizeBenchmarkReadingValue
 * — reused here only as a fingerprinting convention, NOT imported (this
 * module has zero dependency on any src/js/score code).
 */
function fingerprint(measurements) {
  return NOVELTY_KEYS.map(key => {
    const n = Number(measurements?.[key]);
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
  }).join('|');
}

/**
 * Throws if `measurements` is fingerprint-identical to any known synthetic
 * fixture, or to any REAL sample already present in the registry (catches
 * accidental resubmission of an existing sample under a new sample_id).
 * A candidate that only partially overlaps a known fixture (some but not
 * all six fields match) is NOT rejected — partial coincidence across six
 * independent readings is expected of real water and is not evidence of
 * reuse.
 */
function assertNovelSample(measurements, existingRegistrySamples = []) {
  const candidateFp = fingerprint(measurements);
  if (KNOWN_SYNTHETIC_FINGERPRINTS.some(fx => fingerprint(fx) === candidateFp)) {
    throw new Error(
      'candidate sample is fingerprint-identical to a known synthetic/regression fixture already used while iterating on Quality V3 — it cannot be submitted as independent real-world evidence'
    );
  }
  const duplicateReal = existingRegistrySamples.find(
    r => r.source_type === 'REAL' && r.measurements && fingerprint(r.measurements) === candidateFp
  );
  if (duplicateReal) {
    throw new Error(
      `candidate sample matches existing registry record ${duplicateReal.sample_id} — resubmitting the same real sample under a new sample_id does not create new evidence`
    );
  }
  return true;
}

/**
 * Full intake validation for a candidate evidence record. Does NOT write
 * anything to the registry file — appending a reviewed, deliberately
 * partitioned record is a separate, human/product decision (see
 * docs/quality-v3/EVIDENCE_ACQUISITION_PROTOCOL.md). This only tells you
 * whether a candidate is safe to bring forward for that review.
 */
function validateIntakeCandidate(candidate, existingRegistrySamples = []) {
  assertValidRecordShape(candidate);
  if (existingRegistrySamples.some(r => r.sample_id === candidate.sample_id)) {
    throw new Error(`sample_id ${candidate.sample_id} already exists in the registry — sample_ids must be unique`);
  }
  if (candidate.source_type === 'REAL') {
    if (!candidate.measurements || typeof candidate.measurements !== 'object') {
      throw new Error(`evidence record ${candidate.sample_id}: REAL samples must include a measurements object`);
    }
    assertNovelSample(candidate.measurements, existingRegistrySamples);
  }
  assertPartitionIntegrity(candidate);
  if (candidate.partition && candidate.partition !== 'UNASSIGNED' && candidate.source_type === 'REAL'
      && !candidate.used_for_calibration && !candidate.used_for_validation && !candidate.used_for_holdout) {
    throw new Error(
      `evidence record ${candidate.sample_id}: partition "${candidate.partition}" claimed without any used_for_* flag set — partition assignment must be an explicit, deliberate decision, not a label alone`
    );
  }
  return { ok: true, sample_id: candidate.sample_id };
}

module.exports = {
  SOURCE_TYPES,
  PARTITIONS,
  KNOWN_SYNTHETIC_FINGERPRINTS,
  assertValidRecordShape,
  assertPartitionIntegrity,
  isImmutableHoldout,
  freezeRegistry,
  attemptCalibrationUse,
  computeEvidenceInventory,
  loadRegistry,
  fingerprint,
  assertNovelSample,
  validateIntakeCandidate
};
