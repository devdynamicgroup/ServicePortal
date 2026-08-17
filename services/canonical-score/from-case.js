/**
 * Read-only mapping from an existing Case job to canonical simulation input.
 * Never writes. Never publishes. Never calls Q-V3 or country engines.
 */
const { SCORED_PARAMETERS } = require('./constants');

function readingsFromJob(job) {
  const source = job?.draft?.scoreBaseReadings
    || job?.result?.readings
    || {};
  const readings = {};
  SCORED_PARAMETERS.concat(['temp']).forEach((key) => {
    const n = Number(source[key]);
    if (Number.isFinite(n)) readings[key] = n;
  });
  return readings;
}

module.exports = { readingsFromJob };
