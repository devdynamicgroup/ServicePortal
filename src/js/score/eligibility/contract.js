/**
 * Eligibility Contract — the single shape returned by EligibilityEngine.evaluate()
 * that every downstream consumer (UI, Portal, Publish, Notifications, LINE,
 * Public Report) must read instead of recomputing completeness itself.
 *
 * @typedef {object} EligibilityContract
 * @property {string} reportType
 * @property {boolean} eligible
 * @property {number} measurementCoverage - 0-100
 * @property {number} inspectionCoverage - 0-100
 * @property {number} overallCoverage - 0-100
 * @property {string[]} missingMeasurements
 * @property {string[]} missingInspection
 * @property {string|null} reason
 * @property {string[]} qualityFlags
 * @property {{evaluatedAt:string, policyKey:string, evidence:object}} calculationMetadata
 *
 * Design rules (do not violate when extending):
 *   Score !== Coverage. Coverage !== Eligibility. Eligibility !== Inspection Complete.
 *   These are independent concepts and must stay independently readable from
 *   this one contract, never re-derived by a consumer.
 */

const ELIGIBILITY_CONTRACT_KEYS = Object.freeze([
  'reportType',
  'eligible',
  'measurementCoverage',
  'inspectionCoverage',
  'overallCoverage',
  'missingMeasurements',
  'missingInspection',
  'reason',
  'qualityFlags',
  'calculationMetadata'
]);

/** Structural check only — does not re-derive or judge the values. */
function isValidEligibilityContract(contract) {
  if (!contract || typeof contract !== 'object') return false;
  if (typeof contract.reportType !== 'string') return false;
  if (typeof contract.eligible !== 'boolean') return false;
  if (!Number.isFinite(contract.measurementCoverage)) return false;
  if (!Number.isFinite(contract.inspectionCoverage)) return false;
  if (!Number.isFinite(contract.overallCoverage)) return false;
  if (!Array.isArray(contract.missingMeasurements)) return false;
  if (!Array.isArray(contract.missingInspection)) return false;
  if (contract.reason !== null && typeof contract.reason !== 'string') return false;
  if (!Array.isArray(contract.qualityFlags)) return false;
  if (!contract.calculationMetadata || typeof contract.calculationMetadata !== 'object') return false;
  return true;
}

if (typeof window !== 'undefined') {
  window.EligibilityContract = Object.freeze({
    KEYS: ELIGIBILITY_CONTRACT_KEYS,
    isValid: isValidEligibilityContract
  });
}
