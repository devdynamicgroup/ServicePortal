/**
 * Canonical Quality V3 score computation — server-side.
 *
 * 2026-09-01 (score-consistency fix): reuses the REAL, unmodified browser
 * score-engine source files via Node's vm module -- the same technique this
 * repo's own regression suites already use (e.g.
 * scripts/test-report-eligibility-engaged-taps.js) -- instead of maintaining
 * a second, hand-copied formula that could drift from the client's. This is
 * the ONE canonical calculation; both the browser and the server run the
 * exact same source files.
 *
 * Loads (in the same order index.html loads them):
 *   src/js/score/util/clamp.js
 *   src/js/score/util/benchmarkMetadata.js
 *   src/js/score/production/computeProductionScore.js
 *   src/js/score/production/computeQualityScoreV2.js
 *   src/js/score/validation/measurementValidator.js
 *   src/js/flows/score.js (only its pure readings-resolution functions are
 *     used -- the rest of that file is DOM-heavy UI code that never
 *     executes here, because those are plain function declarations, not
 *     top-level statements)
 *
 * Pure, read-only: never mutates its input, never touches Notion/network.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE_FILES = [
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
  'src/js/score/validation/measurementValidator.js',
  'src/js/flows/score.js'
];

let cachedSandbox = null;

function buildSandbox() {
  const sandbox = {
    console,
    window: {},
    document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {} },
    S: { tapData: [], taps: [], activeTap: 0, pkg: 'essential', lang: 'en' }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  SOURCE_FILES.forEach(rel => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  });
  return sandbox;
}

function getSandbox() {
  if (!cachedSandbox) cachedSandbox = buildSandbox();
  return cachedSandbox;
}

/**
 * Canonical Quality V3 score for a Case's CURRENT persisted tapData --
 * independent of any client-submitted/cached value. `job` must have the
 * same shape services/notion/mapper.js produces (job.draft.tapData).
 *
 * Returns { score, readings, detail }. `score` is null when readings are
 * incomplete (matches computeQualityScoreDetail's own incomplete contract)
 * -- callers must treat null as "cannot validate" (skip), never as "score
 * is 0".
 */
function computeCanonicalScore(job) {
  const sandbox = getSandbox();
  // resolveScoreReadings() reads job.draft.tapData / job.draft.fields only
  // -- it never touches the sandbox's S.activeJob (left unset), so it can
  // never fall back to any live browser session state, only this job's own
  // persisted data.
  const readings = sandbox.resolveScoreReadings(job);
  const detail = sandbox.computeQualityScoreDetail(readings);
  return {
    score: Number.isFinite(detail?.score) ? detail.score : null,
    readings,
    detail
  };
}

module.exports = { computeCanonicalScore };
