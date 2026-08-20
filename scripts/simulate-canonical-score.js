#!/usr/bin/env node
'use strict';

/**
 * Read-only Canonical V7 simulation.
 * Does not publish, write Cases, or invoke Q-V3 / country engines.
 *
 * Usage:
 *   node scripts/simulate-canonical-score.js
 *   node scripts/simulate-canonical-score.js --profile=japan
 *   node scripts/simulate-canonical-score.js --readings={"ph":7.2,...}
 *   node scripts/simulate-canonical-score.js --case-id=<existing Notion page id>
 */
require('../config/env');

const {
  simulateCanonicalScore,
  listBenchmarkProfiles,
  getBenchmarkProfile
} = require('../services/canonical-score');
const { readingsFromJob } = require('../services/canonical-score/from-case');

const DEMO_READINGS = Object.freeze({
  ph: 7.2, tds: 80, chlorine: 0.3, turbidity: 0.1, orp: 400, do: 8, temp: 25
});

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

function rowFromResult(label, result) {
  const pq = result.parameterQuality || {};
  const qualities = Object.keys(pq).map((key) => `${key}=${pq[key].value}`).join(', ');
  return {
    case: label,
    benchmark: result.benchmarkKey,
    completeness: result.computability.complete ? 'COMPUTABLE' : result.status,
    parameterQualities: qualities,
    compliance: result.complianceStatus?.status,
    risk: result.riskSeverity?.value || result.riskSeverity?.status,
    qualityScore: result.qualityScore,
    finalScore: result.finalScore,
    calibrationStatus: result.calibrationStatus
  };
}

async function readingsForRun() {
  const caseId = arg('case-id') || arg('caseId');
  const raw = arg('readings');
  if (raw) return { label: 'cli-readings', readings: JSON.parse(raw) };
  if (caseId) {
    const { getClient } = require('../services/notion/clients');
    const job = await getClient(caseId);
    if (!job) {
      throw new Error(`Existing Case not found: ${caseId}`);
    }
    return {
      label: job.id || caseId,
      readings: readingsFromJob(job),
      caseName: job.name
    };
  }
  return { label: 'fixture-complete', readings: DEMO_READINGS };
}

async function main() {
  const profileKey = arg('profile') || 'all';
  const input = await readingsForRun();
  const profiles = profileKey === 'all'
    ? listBenchmarkProfiles()
    : [getBenchmarkProfile(profileKey)];
  const rows = profiles.map((profile) => rowFromResult(
    input.caseName || input.label,
    simulateCanonicalScore(input.readings, profile)
  ));
  console.log(JSON.stringify({
    ok: true,
    write: false,
    publish: false,
    hero: 'UNCHANGED',
    alpha: 'TBD',
    exactF: 'TBD',
    readingsKeys: Object.keys(input.readings),
    rows
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
