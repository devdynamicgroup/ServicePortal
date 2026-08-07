/**
 * Coverage Engine — measures completeness. Coverage is NOT a score and never
 * decides one; it only reports how much of the required measurement set and
 * inspection task set are actually present.
 *
 * Pure utility. Does not call the production/benchmark engines.
 */

function percentComplete(presentCount, requiredCount) {
  if (!requiredCount) return 100;
  return Math.round((presentCount / requiredCount) * 1000) / 10;
}

/**
 * @param {object} params
 * @param {Record<string, {state:string}>} params.evidence - output of EvidenceEngine.buildEvidenceMap
 * @param {string[]} params.requiredMeasurements - measurement keys required by the active policy
 * @param {Record<string, boolean>} params.tasks - inspection task completion map, e.g. { tapphoto:true, visual:true }
 * @param {string[]} params.requiredTasks - task keys required by the active policy
 */
function calculateCoverage({
  evidence = {},
  requiredMeasurements = [],
  tasks = {},
  requiredTasks = []
} = {}) {
  const missingMeasurements = requiredMeasurements.filter(key => {
    const e = evidence[key];
    return !e || e.state !== 'Measured' && e.state !== 'Estimated' && e.state !== 'Imported';
  });
  const missingInspection = requiredTasks.filter(key => !tasks[key]);

  const measurementCoverage = percentComplete(
    requiredMeasurements.length - missingMeasurements.length,
    requiredMeasurements.length
  );
  const inspectionCoverage = percentComplete(
    requiredTasks.length - missingInspection.length,
    requiredTasks.length
  );

  // Overall coverage weights both dimensions equally. When a policy requires
  // only one dimension (e.g. no tasks required), overall collapses to it.
  const dimensions = [];
  if (requiredMeasurements.length) dimensions.push(measurementCoverage);
  if (requiredTasks.length) dimensions.push(inspectionCoverage);
  const overallCoverage = dimensions.length
    ? Math.round((dimensions.reduce((a, b) => a + b, 0) / dimensions.length) * 10) / 10
    : 100;

  return Object.freeze({
    measurementCoverage,
    inspectionCoverage,
    overallCoverage,
    missingMeasurements,
    missingInspection
  });
}

if (typeof window !== 'undefined') {
  window.CoverageEngine = Object.freeze({
    calculateCoverage
  });
}
