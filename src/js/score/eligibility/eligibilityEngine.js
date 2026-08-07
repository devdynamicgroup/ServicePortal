/**
 * Eligibility Policy Engine — decides whether a report is allowed to
 * produce a score. Policies are registered by report type, never
 * hardcoded into this engine. Adding a new report type means registering
 * a new policy here; it must never require changing the Production Score
 * Engine or the Benchmark Engines.
 *
 * This engine does not compute a score and does not call the production
 * or benchmark engines. It only combines Evidence + Coverage into the
 * Eligibility Contract.
 */
(function initEligibilityPolicyRegistry(global) {
  global.EligibilityPolicyRegistry = global.EligibilityPolicyRegistry || {
    _policies: Object.create(null),
    defaultKey: 'production',

    register(policy) {
      if (!policy || !policy.key || !Array.isArray(policy.requiredMeasurements)) {
        throw new Error('Eligibility policy requires key and requiredMeasurements[]');
      }
      this._policies[policy.key] = {
        key: policy.key,
        label: policy.label || policy.key,
        requiredMeasurements: policy.requiredMeasurements.slice(),
        requiredTasks: Array.isArray(policy.requiredTasks) ? policy.requiredTasks.slice() : []
      };
      return this._policies[policy.key];
    },

    get(key) {
      return this._policies[key] || this._policies[this.defaultKey] || null;
    },

    has(key) {
      return Boolean(this._policies[key]);
    },

    list() {
      return Object.keys(this._policies).map(key => this._policies[key]);
    }
  };
  if (typeof window !== 'undefined') window.EligibilityPolicyRegistry = global.EligibilityPolicyRegistry;

  // Default policies. Illustrative for freeReport/quickCheck — the exact
  // requirement sets for those are a product decision; adjust by re-registering
  // rather than editing this engine. "production" matches the spec exactly.
  global.EligibilityPolicyRegistry.register({
    key: 'production',
    label: 'Production Report',
    requiredMeasurements: ['ph', 'tds', 'orp', 'do', 'chlorine', 'turbidity'],
    requiredTasks: ['tapphoto', 'meter', 'visual', 'chlorine']
  });
  global.EligibilityPolicyRegistry.register({
    key: 'freeReport',
    label: 'Free Water Check Report',
    requiredMeasurements: ['ph', 'tds', 'chlorine'],
    requiredTasks: ['tapphoto']
  });
  global.EligibilityPolicyRegistry.register({
    key: 'quickCheck',
    label: 'Quick Check',
    requiredMeasurements: ['ph', 'tds'],
    requiredTasks: []
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);

/**
 * Evaluate eligibility for one report and return the single Eligibility
 * Contract that all downstream consumers (UI, Portal, Publish,
 * Notifications, LINE, Public Report) must read instead of recomputing
 * completeness themselves.
 *
 * @param {object} params
 * @param {string} [params.reportType] - policy key; falls back to the registry default
 * @param {object} params.readings - flat readings, e.g. { ph, tds, chlorine, turbidity, orp, do, temp }
 * @param {object} [params.sourceMeta] - optional per-key provenance for EvidenceEngine
 * @param {Record<string, boolean>} [params.tasks] - inspection task completion map
 */
function evaluateEligibility({ reportType, readings = {}, sourceMeta = {}, tasks = {} } = {}) {
  const policy = window.EligibilityPolicyRegistry.get(reportType);
  const policyKey = policy ? policy.key : (reportType || 'production');

  const measurementKeys = Array.from(new Set([
    ...(policy ? policy.requiredMeasurements : []),
    'ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'
  ]));
  const evidence = window.EvidenceEngine.buildEvidenceMap(readings, sourceMeta, measurementKeys);

  const coverage = window.CoverageEngine.calculateCoverage({
    evidence,
    requiredMeasurements: policy ? policy.requiredMeasurements : [],
    tasks,
    requiredTasks: policy ? policy.requiredTasks : []
  });

  const eligible = coverage.missingMeasurements.length === 0
    && coverage.missingInspection.length === 0;

  let reason = null;
  if (!eligible) {
    const parts = [];
    if (coverage.missingInspection.length) parts.push('Inspection incomplete');
    if (coverage.missingMeasurements.length) parts.push('Missing measurements');
    reason = parts.join(' · ');
  }

  const qualityFlags = [];
  (policy ? policy.requiredMeasurements : []).forEach(key => {
    const e = evidence[key];
    if (!e) return;
    if (e.state === 'Estimated' || e.state === 'Imported') qualityFlags.push(`${e.state.toLowerCase()}:${key}`);
    if (e.confidence !== null && e.confidence < 70) qualityFlags.push(`low-confidence:${key}`);
  });

  return Object.freeze({
    reportType: policyKey,
    eligible,
    measurementCoverage: coverage.measurementCoverage,
    inspectionCoverage: coverage.inspectionCoverage,
    overallCoverage: coverage.overallCoverage,
    missingMeasurements: coverage.missingMeasurements,
    missingInspection: coverage.missingInspection,
    reason,
    qualityFlags,
    calculationMetadata: {
      evaluatedAt: new Date().toISOString(),
      policyKey,
      evidence
    }
  });
}

if (typeof window !== 'undefined') {
  window.EligibilityEngine = Object.freeze({
    evaluate: evaluateEligibility
  });
}
