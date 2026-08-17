/**
 * Canonical Score Model V7 — constants only.
 * No curves, no α, no F, no Notion, no Case.
 */
const MODEL_VERSION = 'canonical-v1';
const CALIBRATION_STATUS = Object.freeze({
  NOT_CALIBRATED: 'NOT_CALIBRATED',
  CALIBRATED: 'CALIBRATED'
});
const COMPUTABILITY = Object.freeze({
  COMPUTABLE: 'COMPUTABLE',
  NOT_COMPUTABLE: 'NOT_COMPUTABLE'
});
const NOT_CALIBRATED = CALIBRATION_STATUS.NOT_CALIBRATED;
const NOT_COMPUTABLE = COMPUTABILITY.NOT_COMPUTABLE;
const HYBRID_FAMILY = 'HYBRID-FAMILY';
const SCORED_PARAMETERS = Object.freeze(['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do']);
const PROFILE_KEYS = Object.freeze(['thailand', 'japan', 'who', 'eu', 'usEpa']);
const RISK_LEVELS = Object.freeze(['PASS', 'WARNING', 'FAIL', 'CRITICAL']);
const COMPLIANCE_LEVELS = Object.freeze(['PASS', 'WARNING', 'FAIL']);

module.exports = {
  MODEL_VERSION,
  CALIBRATION_STATUS,
  COMPUTABILITY,
  NOT_CALIBRATED,
  NOT_COMPUTABLE,
  HYBRID_FAMILY,
  SCORED_PARAMETERS,
  PROFILE_KEYS,
  RISK_LEVELS,
  COMPLIANCE_LEVELS
};
