/**
 * Eligibility Contract — the single shape returned by EligibilityEngine.evaluate()
 * that every downstream consumer (UI, Portal, Publish, Notifications, LINE,
 * Public Report) must read instead of recomputing completeness itself.
 *
 * @typedef {object} EligibilityContract
 * @property {string} reportType
 * @property {boolean} canCalculateScore - numeric Production inputs present+valid
 * @property {boolean} canPublishReport - measurements + required inspection complete
 * @property {boolean} eligible - alias of canPublishReport (official-report gate;
 *   kept for backward-compatible callers; Score UI must use canCalculateScore)
 * @property {string} eligibilityState - machine-readable, see ELIGIBILITY_STATE. Logic
 *   (anything a program branches on) must read this, never `reason`.
 * @property {number} measurementCoverage - 0-100, owned exclusively by CoverageEngine
 * @property {number} inspectionCoverage - 0-100, owned exclusively by CoverageEngine
 * @property {number} overallCoverage - 0-100, owned exclusively by CoverageEngine
 * @property {string[]} missingMeasurements
 * @property {string[]} missingInspection
 * @property {string|null} reason - human-readable, presentation-only. Derived FROM
 *   eligibilityState by the Presentation formatter; never authored as logic.
 * @property {string[]} qualityFlags
 * @property {{evaluatedAt:string, policyKey:string, eligibilityVersion:string, evidence:object}} calculationMetadata
 *
 * Design rules (do not violate when extending):
 *   Score !== Coverage. Coverage !== Eligibility. Eligibility !== Inspection Complete.
 *   canCalculateScore !== canPublishReport.
 *   State (machine) !== Reason (human). These are independent concepts and must
 *   stay independently readable from this one contract, never re-derived by a consumer.
 */

/** Bump when the eligibility decision logic itself changes shape/semantics —
 *  stamped onto every contract via calculationMetadata.eligibilityVersion so a
 *  published report can always be traced back to the architecture that produced it. */
const ELIGIBILITY_ARCHITECTURE_VERSION = 'v1.1';

/** Machine-readable outcome. Consumers must branch on this, never on `reason` text. */
const ELIGIBILITY_STATE = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  READINGS_INCOMPLETE: 'READINGS_INCOMPLETE',
  INSPECTION_INCOMPLETE: 'INSPECTION_INCOMPLETE',
  READINGS_AND_INSPECTION_INCOMPLETE: 'READINGS_AND_INSPECTION_INCOMPLETE',
  INVALID_MEASUREMENTS: 'INVALID_MEASUREMENTS',
  /** Bypassed a fresh eligibility evaluation because the report was already
   *  published (predates this architecture, or is simply being re-saved). */
  LEGACY_REPORT: 'LEGACY_REPORT'
});

const ELIGIBILITY_CONTRACT_KEYS = Object.freeze([
  'reportType',
  'canCalculateScore',
  'canPublishReport',
  'eligible',
  'eligibilityState',
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
  if (typeof contract.canCalculateScore !== 'boolean') return false;
  if (typeof contract.canPublishReport !== 'boolean') return false;
  if (typeof contract.eligible !== 'boolean') return false;
  if (!Object.values(ELIGIBILITY_STATE).includes(contract.eligibilityState)) return false;
  if (!Number.isFinite(contract.measurementCoverage)) return false;
  if (!Number.isFinite(contract.inspectionCoverage)) return false;
  if (!Number.isFinite(contract.overallCoverage)) return false;
  if (!Array.isArray(contract.missingMeasurements)) return false;
  if (!Array.isArray(contract.missingInspection)) return false;
  if (contract.reason !== null && typeof contract.reason !== 'string') return false;
  if (!Array.isArray(contract.qualityFlags)) return false;
  if (!contract.calculationMetadata || typeof contract.calculationMetadata !== 'object') return false;
  if (typeof contract.calculationMetadata.eligibilityVersion !== 'string') return false;
  return true;
}

/**
 * A contract-shaped stand-in for the "already published, skip re-evaluation"
 * bypass used by score.js / common.js. Exists so that bypass path is traceable
 * (eligibilityState: LEGACY_REPORT, calculationMetadata.eligibilityVersion:
 * 'legacy-bypass') instead of silently skipping the contract entirely.
 * Does not change any behaviour — the bypass already always resulted in
 * eligible === true; this just makes that decision inspectable.
 */
function buildLegacyEligibilityContract(reportType = 'production') {
  return Object.freeze({
    reportType,
    canCalculateScore: true,
    canPublishReport: true,
    eligible: true,
    eligibilityState: ELIGIBILITY_STATE.LEGACY_REPORT,
    measurementCoverage: 100,
    inspectionCoverage: 100,
    overallCoverage: 100,
    missingMeasurements: [],
    missingInspection: [],
    reason: null,
    qualityFlags: [],
    calculationMetadata: {
      evaluatedAt: new Date().toISOString(),
      policyKey: 'legacy',
      eligibilityVersion: 'legacy-bypass',
      evidence: {}
    }
  });
}

if (typeof window !== 'undefined') {
  window.EligibilityContract = Object.freeze({
    KEYS: ELIGIBILITY_CONTRACT_KEYS,
    STATE: ELIGIBILITY_STATE,
    VERSION: ELIGIBILITY_ARCHITECTURE_VERSION,
    isValid: isValidEligibilityContract,
    buildLegacy: buildLegacyEligibilityContract
  });
}
