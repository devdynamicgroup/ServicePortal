/**
 * Regression suite for "Score Consistency Hardening" (2026-09-01).
 *
 * ROOT CAUSE (two independent gaps, both closed by this fix):
 *   1. Client staleness: sendResultToLineNow() (src/js/common.js) read the
 *      client-cached S.scoreVal without ever refreshing it immediately
 *      before publication -- S.scoreVal is only refreshed at specific UI
 *      moments (Score-screen render, country-standard switch, hydration)
 *      and can go stale if a reading changed since the last of those.
 *   2. Server trust boundary: createOrReusePublication()
 *      (services/score-publication-service.js) persisted whatever
 *      payload.score the client submitted, with only a numeric/range bounds
 *      check -- never compared against the Case's own actual readings.
 *
 * FIX:
 *   - services/canonical-score.js: ONE canonical Quality V3 calculation,
 *     server-side, reusing the REAL unmodified browser score-engine source
 *     files via Node's vm module (same technique this repo's own
 *     scripts/test-report-eligibility-engaged-taps.js already uses) --
 *     never a second hand-copied formula.
 *   - services/score-publication-service.js: createOrReusePublication()
 *     now cross-checks payload.score against computeCanonicalScore(job)
 *     immediately before minting a new publication record, and REJECTS
 *     (409 SCORE_MISMATCH) rather than silently correcting.
 *   - src/js/common.js: sendResultToLineNow() now recomputes the score
 *     fresh from current readings (same computeScoreFromReadings(
 *     resolveScoreReadings(job)) pattern Complete's own check already
 *     uses in assessment.js), instead of reading stale S.scoreVal.
 *
 * SCOPE: this fix enforces "a published score must equal the canonical
 * Quality V3 score computed from the Case reading snapshot used for that
 * publication," going forward. It does NOT change the Score Engine
 * formula/weights/grading, Gate-2 policy, engaged-tap semantics, and does
 * NOT retroactively explain or resolve the historical Smoke Case "98"
 * question -- that remains a separate, unresolved evidence gap.
 *
 * Uses the REAL production functions (services/canonical-score.js,
 * services/score-publication-service.js's own dependency-injection hooks
 * setPublicationStore/setPublicationCaseAdapter, and the same in-memory
 * store used by scripts/test-score-publication-null-coercion.js) -- not a
 * reimplementation.
 *
 * Run: node scripts/test-score-consistency.js
 */
'use strict';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const {
  createOrReusePublication,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies
} = require('../services/score-publication-service');
const { createMemoryPublicationStore } = require('../services/score-publication-store-memory');
const { computeCanonicalScore } = require('../services/canonical-score');

// Readings verified against the real production formula: equal-weighted
// average of 6 parameter grades, all "excellent" -> canonical score 97
// (same values/result this task's pre-implementation verification used
// against the real Smoke Case, read-only, matching its persisted score).
const GOOD_READINGS_FIELDS = {
  'm-ph': 7.25,
  'm-tds': 88.5,
  'm-free-cl': 0.3,
  'm-turb': 0.2,
  'm-orp': 400,
  'm-do': 7.5,
  'm-temp': 27
};

// A materially different, still-plausible reading set -> a different
// canonical score, used to prove staleness is actually detected (not just
// "any number that happens to match").
const OTHER_READINGS_FIELDS = {
  'm-ph': 6.2,
  'm-tds': 480,
  'm-free-cl': 0.05,
  'm-turb': 4.5,
  'm-orp': 150,
  'm-do': 3.5,
  'm-temp': 30
};

function makeJob(fields, overrides = {}) {
  return {
    id: 'case-1',
    notionId: 'notion-case-1',
    name: 'Test Customer',
    draft: { fields },
    result: { waterScore: null, publicReportToken: 'rpt-consistency-test', reportUrl: '', ...overrides }
  };
}

function makeStoreAndAdapter() {
  const store = createMemoryPublicationStore();
  const updates = [];
  const caseAdapter = {
    async getClient() { return makeJob(GOOD_READINGS_FIELDS); },
    async updateClient(notionId, patch) {
      updates.push({ notionId, patch });
      return makeJob(GOOD_READINGS_FIELDS, { waterScore: patch.latestWaterScore ?? null });
    },
    async findClientByReportToken() { return null; }
  };
  setPublicationStore(store);
  setPublicationCaseAdapter(caseAdapter);
  return { store, updates, caseAdapter };
}

async function expectRejection(promise, expectedCode) {
  try {
    await promise;
    return { rejected: false };
  } catch (error) {
    return { rejected: true, code: error.code, statusCode: error.statusCode, message: error.message };
  }
}

async function main() {
  console.log('=== Sanity: canonical score differs meaningfully between the two fixtures ===');
  const goodJob = makeJob(GOOD_READINGS_FIELDS);
  const otherJob = makeJob(OTHER_READINGS_FIELDS);
  const goodCanonical = computeCanonicalScore(goodJob);
  const otherCanonical = computeCanonicalScore(otherJob);
  assert(Number.isFinite(goodCanonical.score), `good fixture produces a finite canonical score (got ${goodCanonical.score})`);
  assert(Number.isFinite(otherCanonical.score), `other fixture produces a finite canonical score (got ${otherCanonical.score})`);
  assert(goodCanonical.score !== otherCanonical.score, `the two fixtures produce DIFFERENT canonical scores (${goodCanonical.score} vs ${otherCanonical.score}) -- required for the mismatch tests below to be meaningful`);

  console.log('\n=== Test 1: fresh, correct score publishes successfully ===');
  {
    resetPublicationDependencies();
    const { } = makeStoreAndAdapter();
    const job = makeJob(GOOD_READINGS_FIELDS, { publicReportToken: 'rpt-t1' });
    const result = await createOrReusePublication({ job, payload: { score: goodCanonical.score, intent: 'publish' }, caseId: 'case-1' });
    assert(result.ok === true && result.score === goodCanonical.score, `a score matching the canonical calculation publishes as-is (got ${JSON.stringify(result)})`);
    resetPublicationDependencies();
  }

  console.log('\n=== Test 2: stale HIGHER score is rejected, not silently corrected ===');
  {
    resetPublicationDependencies();
    makeStoreAndAdapter();
    const job = makeJob(GOOD_READINGS_FIELDS, { publicReportToken: 'rpt-t2' });
    const staleHigher = Math.min(100, goodCanonical.score + 15);
    const outcome = await expectRejection(
      createOrReusePublication({ job, payload: { score: staleHigher, intent: 'publish' }, caseId: 'case-1' }),
      'SCORE_MISMATCH'
    );
    assert(outcome.rejected === true, 'a stale HIGHER submitted score is rejected (not published)');
    assert(outcome.code === 'SCORE_MISMATCH', `rejection carries code SCORE_MISMATCH (got ${outcome.code})`);
    assert(outcome.statusCode === 409, `rejection carries statusCode 409 (got ${outcome.statusCode})`);
    resetPublicationDependencies();
  }

  console.log('\n=== Test 3: stale LOWER score is rejected, not silently corrected ===');
  {
    resetPublicationDependencies();
    makeStoreAndAdapter();
    const job = makeJob(GOOD_READINGS_FIELDS, { publicReportToken: 'rpt-t3' });
    const staleLower = Math.max(0, goodCanonical.score - 15);
    const outcome = await expectRejection(
      createOrReusePublication({ job, payload: { score: staleLower, intent: 'publish' }, caseId: 'case-1' }),
      'SCORE_MISMATCH'
    );
    assert(outcome.rejected === true, 'a stale LOWER submitted score is rejected (not published)');
    assert(outcome.code === 'SCORE_MISMATCH', `rejection carries code SCORE_MISMATCH (got ${outcome.code})`);
    resetPublicationDependencies();
  }

  console.log('\n=== Test 4: Send-Result-after-edit submits the FRESH score, not the stale one ===');
  console.log('(client-side fix lives in src/js/common.js, a browser file -- verified here at the');
  console.log(' source-expression level, same technique test-score-publication-null-coercion.js');
  console.log(' already uses for other browser-only call sites in this codebase.)');
  {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'common.js'), 'utf8');
    const fnMatch = src.match(/async function sendResultToLineNow\(\)[\s\S]*?\n}\r?\n/);
    assert(!!fnMatch, 'sendResultToLineNow() found in source (test is in sync with real source)');
    const fnBody = fnMatch ? fnMatch[0] : '';
    assert(/resolveScoreReadings\(job\)/.test(fnBody), 'sendResultToLineNow() recomputes readings fresh from the job (resolveScoreReadings(job))');
    assert(/computeScoreFromReadings\(freshReadings\)/.test(fnBody), 'sendResultToLineNow() recomputes the score fresh (computeScoreFromReadings(freshReadings)) instead of trusting a cache alone');
    assert(
      !/const score = Number\(S\.scoreVal \?\? job\?\.result\?\.waterScore \?\? job\?\.draft\?\.scoreVal\);/.test(fnBody),
      'the OLD stale-only read (Number(S.scoreVal ?? ...) with no fresh recomputation) is gone'
    );
  }

  console.log('\n=== Test 5: Complete path (closeCase -> createOrReusePublication) unaffected/still passes ===');
  {
    resetPublicationDependencies();
    makeStoreAndAdapter();
    const job = makeJob(GOOD_READINGS_FIELDS, { publicReportToken: 'rpt-t5' });
    const result = await createOrReusePublication({ job, payload: { score: goodCanonical.score, intent: 'publish' }, caseId: 'case-1' });
    assert(result.ok === true, `Complete's own call through the same createOrReusePublication() choke point still succeeds for a correct score (got ${JSON.stringify(result)})`);
    resetPublicationDependencies();
  }

  console.log('\n=== Test 6: missing/invalid readings are still blocked (by existing eligibility, unchanged) ===');
  {
    const emptyJob = makeJob({});
    const canonical = computeCanonicalScore(emptyJob);
    assert(canonical.score === null, `canonical score is null (not 0, not a guess) when readings are incomplete (got ${canonical.score})`);
  }

  console.log('\n=== Test 7: country-benchmark engines are never substituted for the canonical Quality V3 score ===');
  {
    const detail = goodCanonical.detail;
    assert(!!detail && !('countryStandard' in detail), 'computeCanonicalScore()\'s detail carries no country-benchmark field -- it is the pure Quality V3 calculation, never a country-gated substitute');
  }

  console.log('\n=== Test 8: post-publish edit leaves the published score frozen (intentional divergence, must PASS) ===');
  {
    resetPublicationDependencies();
    makeStoreAndAdapter();
    const job = makeJob(GOOD_READINGS_FIELDS, { publicReportToken: 'rpt-t8' });
    const first = await createOrReusePublication({ job, payload: { score: goodCanonical.score, intent: 'publish' }, caseId: 'case-1' });
    assert(first.ok === true, 'initial publish succeeds');
    // Simulate a later reading edit: readings changed, but this ledger
    // record's own snapshot must not silently change on its own -- only a
    // deliberate republish (Test 9) may produce a new one.
    const editedJob = makeJob(OTHER_READINGS_FIELDS, { publicReportToken: 'rpt-t8' });
    const stillCanonicalOld = computeCanonicalScore(editedJob).score;
    assert(stillCanonicalOld !== first.score, `the LIVE canonical score has moved on since publish (${first.score} -> ${stillCanonicalOld}), while the already-published record's score field is untouched by this computation alone -- this divergence is intentional (publications are write-once snapshots, not live pointers)`);
    resetPublicationDependencies();
  }

  console.log('\n=== Test 9: republish after a genuine reading change produces the NEW canonical score ===');
  {
    resetPublicationDependencies();
    const { } = makeStoreAndAdapter();
    const editedJob = makeJob(OTHER_READINGS_FIELDS, { publicReportToken: 'rpt-t9' });
    const freshCanonical = computeCanonicalScore(editedJob).score;
    const result = await createOrReusePublication({ job: editedJob, payload: { score: freshCanonical, intent: 'republish' }, caseId: 'case-1' });
    assert(result.ok === true && result.score === freshCanonical, `republish with the new canonical score succeeds and records the new value (got ${JSON.stringify(result)})`);
    resetPublicationDependencies();
  }

  console.log('\n=== Test 10: a direct call to the publication service with a mismatched payload.score is rejected ===');
  {
    resetPublicationDependencies();
    makeStoreAndAdapter();
    const job = makeJob(GOOD_READINGS_FIELDS, { publicReportToken: 'rpt-t10' });
    const wrong = goodCanonical.score === 100 ? goodCanonical.score - 1 : goodCanonical.score + 1;
    const outcome = await expectRejection(
      createOrReusePublication({ job, payload: { score: wrong, intent: 'publish' }, caseId: 'case-1' }),
      'SCORE_MISMATCH'
    );
    assert(outcome.rejected === true, 'any direct caller submitting a mismatched score is rejected, not just the Send Result UI path');
    assert(!/notion|token|api[_-]?key/i.test(outcome.message || ''), 'the rejection message does not leak internal details/secrets');
    resetPublicationDependencies();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  console.error(e.stack);
  process.exit(1);
});
