/**
 * Regression suite for the Complete-gate/score-readiness bug found via the
 * forensic investigation on 2026-08-25.
 *
 * Real bug: SCORE_READY_KEYS (src/js/flows/score.js) required 7 fields
 * ('ph','tds','chlorine','turbidity','orp','do','temp') before Complete
 * would be enabled, but the actual Water Score formula
 * (computeQualityScoreDetail, src/js/score/production/computeQualityScoreV2.js)
 * only ever consumes 6 of them -- it explicitly lists 'temp' in its own
 * `notScored` array. A Case with all 6 scored parameters valid but a
 * missing temperature reading (a real, common OCR failure mode this
 * session already found and partially fixed) could compute a real, finite
 * Water Score, yet Complete stayed blocked because the readiness gate
 * still counted temp as required. This mixed up two different concepts:
 * "every field the form displays" vs "every field the score formula needs".
 *
 * Fix: removed 'temp' from SCORE_READY_KEYS. Nothing else changed --
 * scoring formula, mapper, merge, LINE flow, and every other required
 * field are untouched.
 *
 * Loads the REAL assessment.js, computeQualityScoreV2.js, and score.js via
 * vm (same load order as index.html) and drives the actual
 * getScoreDataReadiness()/computeScoreFromReadings() functions directly --
 * no reimplementation.
 *
 * Run: node scripts/test-score-readiness-temp-fix.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function buildContext() {
  const domStub = {
    getElementById: () => null,
    addEventListener: () => {},
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } })
  };
  const sandbox = {
    console,
    window: {},
    document: domStub,
    navigator: { userAgent: 'node' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    S: { activeJob: null, tapData: [], taps: [] },
    t: (k) => k
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const files = [
    'src/js/flows/assessment.js',
    'src/js/score/production/computeQualityScoreV2.js',
    'src/js/flows/score.js'
  ];
  const noisy = console.warn;
  console.warn = () => {}; // mute [TEMP TRACE]/[OCR FLOW] debug logging
  for (const rel of files) {
    const code = fs.readFileSync(path.join('D:/Service Portal', rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: path.basename(rel) });
  }
  console.warn = noisy;
  return sandbox;
}

function jobWithFields(fields) {
  return { id: 'case-1', notionId: 'case-1', draft: { fields } };
}

const FULL_SIX = { 'm-ph': '7.2', 'm-tds': '150', 'm-turb': '0.5', 'm-orp': '200', 'm-free-cl': '1.0', 'm-do': '7.0' };

async function main() {
  // --- Case: all 6 scored fields present, temp MISSING -> Complete must be enabled ---
  {
    const sb = buildContext();
    const job = jobWithFields({ ...FULL_SIX }); // no m-temp
    const readiness = sb.getScoreDataReadiness(job);
    assert(readiness.ready === true, `all 6 scored fields present, temp missing -> readiness.ready is true (got ${readiness.ready}, missing=${JSON.stringify(readiness.missing)})`);
    const readings = sb.resolveScoreReadingsPresent(job);
    const score = sb.computeScoreFromReadings(readings);
    assert(Number.isFinite(score), `a real, finite Water Score is still computed without temp (got ${score})`);
  }

  // --- Case: all 6 scored fields present, temp ALSO present -> still enabled, unaffected ---
  {
    const sb = buildContext();
    const job = jobWithFields({ ...FULL_SIX, 'm-temp': '28.0' });
    const readiness = sb.getScoreDataReadiness(job);
    assert(readiness.ready === true, 'all 6 scored fields present, temp also present -> still ready (unaffected by the fix)');
  }

  // --- Case: genuinely missing one of the 6 SCORED fields -> Complete must stay blocked ---
  for (const missingKey of ['m-ph', 'm-tds', 'm-turb', 'm-orp', 'm-free-cl', 'm-do']) {
    const sb = buildContext();
    const fields = { ...FULL_SIX };
    delete fields[missingKey];
    const job = jobWithFields(fields);
    const readiness = sb.getScoreDataReadiness(job);
    assert(readiness.ready === false, `missing ${missingKey} (a real scored field) -> readiness.ready is still false (got ${readiness.ready})`);
  }

  // --- Case: 0 values in scored fields are NOT treated as missing ---
  {
    const sb = buildContext();
    const job = jobWithFields({ 'm-ph': '7.2', 'm-tds': '150', 'm-turb': '0', 'm-orp': '0', 'm-free-cl': '0', 'm-do': '7.0' });
    const readiness = sb.getScoreDataReadiness(job);
    assert(readiness.ready === true, `0 values in turbidity/orp/chlorine are valid readings, not missing (got ready=${readiness.ready}, missing=${JSON.stringify(readiness.missing)})`);
  }

  // --- Sanity: 'temp' is confirmed absent from the scoring formula's own required set ---
  {
    const sb = buildContext();
    const detail = sb.computeQualityScoreDetail({ ph: 7.2, tds: 150, turbidity: 0.5, orp: 200, chlorine: 1.0, do: 7.0 });
    assert(detail.incomplete === false && Number.isFinite(detail.score), 'computeQualityScoreDetail computes a real score from exactly the 6 fields, with no temp key passed at all');
    assert(Array.isArray(detail.notScored) && detail.notScored.includes('temp'), "computeQualityScoreDetail's own notScored list still includes 'temp' -- confirms the formula never needed it, unchanged by this fix");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  process.exit(1);
});
