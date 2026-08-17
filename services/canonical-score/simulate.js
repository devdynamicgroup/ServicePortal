/**
 * Canonical Score Model V7 skeleton — pure simulation.
 * No Notion. No Case. No Q-V3. No country-engine math. No α/F substitution.
 */
const {
  MODEL_VERSION,
  NOT_CALIBRATED,
  NOT_COMPUTABLE,
  COMPUTABILITY,
  HYBRID_FAMILY,
  SCORED_PARAMETERS
} = require('./constants');
const { getBenchmarkProfile } = require('./profiles');

function toFinite(value) {
  if (value === null || value === undefined || value === '' || value === false) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function scoredKeys(profile) {
  return SCORED_PARAMETERS.filter((key) => profile.parameters?.[key]?.applicability !== 'NOT_APPLICABLE');
}

function evaluateCompleteness(readings, profile) {
  const required = profile.requiredParameters || scoredKeys(profile);
  const present = {};
  const missing = [];
  required.forEach((key) => {
    const n = toFinite(readings?.[key]);
    if (Number.isFinite(n)) present[key] = n;
    else missing.push(key);
  });
  const notApplicable = SCORED_PARAMETERS.filter(
    (key) => profile.parameters?.[key]?.applicability === 'NOT_APPLICABLE'
  );
  return {
    status: missing.length ? NOT_COMPUTABLE : COMPUTABILITY.COMPUTABLE,
    required,
    present,
    missing,
    notApplicable
  };
}

function evaluateParameterQuality(readings, profile) {
  const out = {};
  scoredKeys(profile).forEach((key) => {
    const n = toFinite(readings?.[key]);
    const curve = profile.parameters?.[key]?.qualityCurve;
    if (!Number.isFinite(n)) {
      out[key] = { status: NOT_COMPUTABLE, value: NOT_COMPUTABLE };
      return;
    }
    if (!curve || curve.status !== 'CALIBRATED' || typeof curve.evaluate !== 'function') {
      out[key] = { status: NOT_CALIBRATED, value: NOT_CALIBRATED, provenance: curve?.provenance || 'UNKNOWN' };
      return;
    }
    out[key] = { status: 'CALIBRATED', value: curve.evaluate(n) };
  });
  SCORED_PARAMETERS.filter((key) => profile.parameters?.[key]?.applicability === 'NOT_APPLICABLE')
    .forEach((key) => {
      out[key] = { status: 'NOT_APPLICABLE', value: 'NOT_APPLICABLE' };
    });
  return out;
}

function evaluateCompliance(readings, profile) {
  const checks = {};
  const failed = [];
  let calibratedCount = 0;
  scoredKeys(profile).forEach((key) => {
    const limits = profile.parameters?.[key]?.complianceLimits;
    const n = toFinite(readings?.[key]);
    if (!limits || limits.status !== 'CALIBRATED' || typeof limits.contains !== 'function') {
      checks[key] = { status: NOT_CALIBRATED };
      return;
    }
    calibratedCount += 1;
    if (!Number.isFinite(n)) {
      checks[key] = { status: NOT_COMPUTABLE, pass: false };
      failed.push(key);
      return;
    }
    const pass = Boolean(limits.contains(n));
    checks[key] = { status: 'CALIBRATED', pass };
    if (!pass) failed.push(key);
  });
  if (!calibratedCount) {
    return { status: NOT_CALIBRATED, checks, failedParameters: [] };
  }
  return {
    status: failed.length ? 'FAIL' : 'PASS',
    checks,
    failedParameters: failed
  };
}

function evaluateRisk(compliance, profile) {
  const rules = profile.riskRules;
  if (!rules || rules.status !== 'CALIBRATED') {
    return { status: NOT_CALIBRATED, value: NOT_CALIBRATED };
  }
  if (compliance?.status === NOT_CALIBRATED) {
    return { status: NOT_CALIBRATED, value: NOT_CALIBRATED };
  }
  if (typeof rules.fromCompliance === 'function') {
    return { status: 'CALIBRATED', value: rules.fromCompliance(compliance) };
  }
  return { status: NOT_CALIBRATED, value: NOT_CALIBRATED };
}

/**
 * Canonical hybrid aggregator. α / exact F remain TBD until Calibration Gate.
 * Never substitutes weighted-mean or weakest-link.
 */
function aggregateQuality() {
  return {
    status: NOT_CALIBRATED,
    qualityScore: NOT_CALIBRATED,
    family: HYBRID_FAMILY,
    alpha: 'TBD',
    exactF: 'TBD',
    reason: 'CALIBRATION_GATE'
  };
}

/**
 * PD-V7-01 / PD-V7-02: finalScore = qualityScore. Risk never writes the digit.
 */
function toFinalScore(qualityScore, _riskSeverity) {
  return qualityScore;
}

function simulateCanonicalScore(readings, benchmarkProfile) {
  const profile = typeof benchmarkProfile === 'string'
    ? getBenchmarkProfile(benchmarkProfile)
    : benchmarkProfile;
  if (!profile || !profile.benchmarkKey) {
    throw new Error('BenchmarkProfile is required');
  }
  const completeness = evaluateCompleteness(readings || {}, profile);
  const parameterQuality = evaluateParameterQuality(readings || {}, profile);
  const complianceStatus = evaluateCompliance(readings || {}, profile);
  const riskSeverity = evaluateRisk(complianceStatus, profile);
  const aggregation = aggregateQuality();

  if (completeness.status === NOT_COMPUTABLE) {
    return {
      modelVersion: MODEL_VERSION,
      benchmarkKey: profile.benchmarkKey,
      benchmarkVersion: profile.benchmarkVersion,
      completeness,
      parameterQuality,
      complianceStatus,
      riskSeverity,
      aggregation,
      qualityScore: NOT_COMPUTABLE,
      finalScore: NOT_COMPUTABLE,
      calibrationStatus: NOT_CALIBRATED,
      computability: NOT_COMPUTABLE
    };
  }

  const qualityScore = aggregation.qualityScore;
  const finalScore = toFinalScore(qualityScore, riskSeverity.value);
  return {
    modelVersion: MODEL_VERSION,
    benchmarkKey: profile.benchmarkKey,
    benchmarkVersion: profile.benchmarkVersion,
    completeness,
    parameterQuality,
    complianceStatus,
    riskSeverity,
    aggregation,
    qualityScore,
    finalScore,
    calibrationStatus: NOT_CALIBRATED,
    computability: completeness.status
  };
}

module.exports = {
  evaluateCompleteness,
  evaluateParameterQuality,
  evaluateCompliance,
  evaluateRisk,
  aggregateQuality,
  toFinalScore,
  simulateCanonicalScore
};
