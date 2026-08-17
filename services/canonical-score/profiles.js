/**
 * Canonical V7 BenchmarkProfile data contracts.
 * Country = profile only. No private aggregators. No ported live curves/weights.
 */
const { MODEL_VERSION, NOT_CALIBRATED, SCORED_PARAMETERS, PROFILE_KEYS } = require('./constants');

function uncalibratedParameter(applicability = 'SCORED') {
  return {
    applicability,
    ideal: { status: NOT_CALIBRATED, value: null, provenance: 'UNKNOWN' },
    qualityCurve: { status: NOT_CALIBRATED, family: null, coefficients: null, provenance: 'UNKNOWN' },
    complianceLimits: { status: NOT_CALIBRATED, band: null, provenance: 'UNKNOWN' },
    weight: { status: NOT_CALIBRATED, value: null, provenance: 'UNKNOWN' }
  };
}

function buildUncalibratedProfile(benchmarkKey, extras = {}) {
  const parameters = {};
  SCORED_PARAMETERS.forEach((key) => {
    parameters[key] = uncalibratedParameter(
      extras.notApplicable && extras.notApplicable.includes(key) ? 'NOT_APPLICABLE' : 'SCORED'
    );
  });
  const requiredParameters = SCORED_PARAMETERS.filter((key) => parameters[key].applicability === 'SCORED');
  return Object.freeze({
    benchmarkKey,
    modelVersion: MODEL_VERSION,
    benchmarkVersion: `${benchmarkKey}-v7-uncalibrated`,
    parameters: Object.freeze(parameters),
    requiredParameters: Object.freeze(requiredParameters),
    aggregation: Object.freeze({
      family: 'HYBRID-FAMILY',
      alpha: 'TBD',
      exactF: 'TBD',
      status: NOT_CALIBRATED,
      provenance: 'PRODUCT_DECISION — PD-V7-03 architecture only'
    }),
    notes: extras.notes || 'V7 skeleton profile. Quality curves, weights, and α/F are NOT_CALIBRATED.'
  });
}

const PROFILES = Object.freeze({
  thailand: buildUncalibratedProfile('thailand'),
  japan: buildUncalibratedProfile('japan', {
    notApplicable: ['do'],
    notes: 'PD-012 KEEP: Japan DO is NOT_APPLICABLE (not scored). Not a quality 100. Curves/α still NOT_CALIBRATED.'
  }),
  who: buildUncalibratedProfile('who'),
  eu: buildUncalibratedProfile('eu'),
  usEpa: buildUncalibratedProfile('usEpa')
});

function getBenchmarkProfile(benchmarkKey) {
  const key = String(benchmarkKey || '').trim();
  if (!PROFILES[key]) {
    const error = new Error(`Unknown BenchmarkProfile: ${benchmarkKey}`);
    error.code = 'UNKNOWN_PROFILE';
    throw error;
  }
  return PROFILES[key];
}

function listBenchmarkProfiles() {
  return PROFILE_KEYS.map((key) => PROFILES[key]);
}

module.exports = {
  PROFILES,
  getBenchmarkProfile,
  listBenchmarkProfiles,
  buildUncalibratedProfile,
  uncalibratedParameter
};
