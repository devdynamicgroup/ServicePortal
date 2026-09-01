/**
 * Regression suite for "Score Consistency Hardening" (2026-09-01, strengthened
 * 2026-09-01 round 2 -- post-deploy hardening pass).
 *
 * Round 2 replaces four tests that were behaviorally weaker than their names
 * claimed (found during a forensic re-audit of this exact file):
 *   - Test 5 previously just called createOrReusePublication() again --
 *     identical in mechanics to Test 1, never exercising closeCase()'s own
 *     caller wiring at all. Now mocks services/notion/clients and
 *     services/client-feedback via require.cache injection (so the REAL
 *     closeCase() function runs, with zero real Notion/network calls) and
 *     asserts closeCase() itself reaches createOrReusePublication() with the
 *     canonical score and marks the Case completed.
 *   - Test 7 previously only inspected the shape of computeCanonicalScore()'s
 *     return value. Now computes the REAL Thailand benchmark score (loaded
 *     the same way canonical-score.js loads the Quality V3 engine) for the
 *     same readings, confirms it differs from the Quality V3 canonical
 *     score, and proves createOrReusePublication() actively REJECTS it if
 *     submitted as payload.score -- a behavioral isolation proof, not a
 *     structural one.
 *   - Test 8 previously only recomputed a local canonical score and compared
 *     numbers -- it never re-read the actual persisted ledger record. Now
 *     re-fetches the original record directly from the store after a
 *     simulated reading edit and asserts its publishedScore field is
 *     unchanged.
 *   - Test 9 previously ran against a brand-new store with no prior
 *     publication in it, so it never exercised "republish after a real
 *     prior publish in the same session." Now chains a real first publish
 *     and a real republish in the same store, and asserts the original
 *     record (looked up by its own publicationId, not "latest") still
 *     holds the old score while a second, distinct record holds the new one.
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

  console.log('\n=== Test 5: Complete path -- the REAL closeCase() function, not the same choke point called again ===');
  {
    resetPublicationDependencies();
    const store = createMemoryPublicationStore();
    setPublicationStore(store);

    const path = require('path');
    const clientsPath = require.resolve('../services/notion/clients');
    const feedbackPath = require.resolve('../services/client-feedback');
    const workflowPath = require.resolve('../services/workflow-service');
    const originalClientsModule = require.cache[clientsPath];
    const originalFeedbackModule = require.cache[feedbackPath];

    const NOTION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    // ONE shared mutable record, standing in for the single real Notion page
    // both closeCase()'s own direct updateClient calls AND the publication
    // service's internal pointer-sync updateClient call would actually
    // write to in production. Using two disconnected mocks here would let
    // this test pass for the wrong reason (each mock silently "succeeding"
    // against its own fake record instead of the same one).
    let state = {
      id: 'case-t5-complete',
      notionId: NOTION_ID,
      name: 'Complete Test Customer',
      draft: { fields: GOOD_READINGS_FIELDS },
      result: { waterScore: null, publicReportToken: '', reportUrl: '' },
      workflow: { status: 'in_progress' },
      line: { userId: '' },
      feedback: { token: '', url: '', status: 'not_sent' },
      review: { url: '', status: 'not_requested' }
    };
    const updateClientCalls = [];
    function sharedUpdateClient(notionId, patch) {
      updateClientCalls.push({ notionId, patch });
      state = {
        ...state,
        ...patch,
        result: {
          ...state.result,
          waterScore: patch.latestWaterScore ?? state.result.waterScore,
          publicReportToken: patch.publicReportToken ?? state.result.publicReportToken,
          reportUrl: patch.reportUrl ?? state.result.reportUrl
        }
      };
      return JSON.parse(JSON.stringify(state));
    }

    // The publication service's own DI hook, pointed at the SAME shared state.
    setPublicationCaseAdapter({
      async getClient() { return JSON.parse(JSON.stringify(state)); },
      async updateClient(notionId, patch) { return sharedUpdateClient(notionId, patch); },
      async findClientByReportToken() { return null; }
    });

    require.cache[clientsPath] = {
      id: clientsPath, filename: clientsPath, loaded: true,
      exports: {
        async getClient() { return JSON.parse(JSON.stringify(state)); },
        async updateClient(notionId, patch) { return sharedUpdateClient(notionId, patch); },
        async findClientByFeedbackToken() { return null; },
        async findClientByReportToken() { return null; }
      }
    };
    require.cache[feedbackPath] = {
      id: feedbackPath, filename: feedbackPath, loaded: true,
      exports: {
        async upsertFeedbackRecord() { throw new Error('should never be called -- isClientFeedbackConfigured() is mocked false'); },
        async getFeedbackByToken() { return null; },
        isClientFeedbackConfigured() { return false; }
      }
    };
    delete require.cache[workflowPath];

    let closeResult;
    let threw = null;
    try {
      const workflowService = require('../services/workflow-service');
      closeResult = await workflowService.closeCase(NOTION_ID, { score: goodCanonical.score });
    } catch (e) {
      threw = e;
    } finally {
      delete require.cache[workflowPath];
      if (originalClientsModule) require.cache[clientsPath] = originalClientsModule; else delete require.cache[clientsPath];
      if (originalFeedbackModule) require.cache[feedbackPath] = originalFeedbackModule; else delete require.cache[feedbackPath];
    }

    assert(!threw, `the REAL closeCase() runs against fully-mocked Notion/feedback modules without throwing (${threw && threw.message})`);
    assert(closeResult && closeResult.ok === true, `closeCase() itself reports success (got ${JSON.stringify(closeResult)})`);
    const completedCall = updateClientCalls.find(c => c.patch && c.patch.caseWorkflowStatus === 'completed');
    assert(!!completedCall, 'closeCase() itself (not the publication service) called updateClient with caseWorkflowStatus: "completed" -- proves the distinct caller wiring actually ran, not just createOrReusePublication() again');
    assert(closeResult && closeResult.case && closeResult.case.result && closeResult.case.result.waterScore === goodCanonical.score, `the Case closeCase() returns carries the canonical score (${goodCanonical.score}), reached via createOrReusePublication() from inside closeCase() itself (got ${closeResult && closeResult.case && closeResult.case.result && closeResult.case.result.waterScore})`);
    assert(closeResult && closeResult.line && closeResult.line.status === 'skipped' && closeResult.line.reason === 'no_line_user_id', 'no LINE send was attempted (no lineUserId on this fixture) -- confirms zero real notification side effects occurred');
    resetPublicationDependencies();
  }

  console.log('\n=== Test 6: missing/invalid readings are still blocked (by existing eligibility, unchanged) ===');
  {
    const emptyJob = makeJob({});
    const canonical = computeCanonicalScore(emptyJob);
    assert(canonical.score === null, `canonical score is null (not 0, not a guess) when readings are incomplete (got ${canonical.score})`);
  }

  console.log('\n=== Test 7: a country-benchmark score cannot be substituted as the publication score ===');
  {
    const detail = goodCanonical.detail;
    assert(!!detail && !('countryStandard' in detail), 'computeCanonicalScore()\'s detail carries no country-benchmark field -- it is the pure Quality V3 calculation, never a country-gated substitute');

    // Behavioral proof, not just structural: compute the REAL Thailand
    // benchmark engine's score for the SAME readings (same vm-loading
    // technique canonical-score.js itself uses, same load order index.html
    // uses), then attempt to submit that benchmark score as payload.score --
    // it must be REJECTED exactly like any other stale/wrong value.
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const ROOT = path.join(__dirname, '..');
    const sandbox = { console, window: {}, document: { getElementById: () => null } };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    [
      'src/js/score/util/clamp.js',
      'src/js/score/util/benchmarkMetadata.js',
      'src/js/score/production/computeProductionScore.js',
      'src/js/score/production/computeQualityScoreV2.js',
      'src/js/score/benchmark/registry.js',
      'src/js/score/benchmark/thailand/limits.js',
      'src/js/score/benchmark/thailand/weights.js',
      'src/js/score/benchmark/thailand/score.js'
    ].forEach(rel => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel }));

    // OTHER_READINGS_FIELDS is used here, not GOOD_READINGS_FIELDS -- for the
    // "all excellent" fixture the Thailand and Quality V3 engines happen to
    // round to the same value (97 == 97), which would make this test
    // vacuously true. OTHER_READINGS_FIELDS's mid-range readings genuinely
    // diverge between the two engines (verified below), which is what makes
    // the isolation proof meaningful.
    const thailandReadings = {
      ph: OTHER_READINGS_FIELDS['m-ph'],
      tds: OTHER_READINGS_FIELDS['m-tds'],
      chlorine: OTHER_READINGS_FIELDS['m-free-cl'],
      turbidity: OTHER_READINGS_FIELDS['m-turb'],
      orp: OTHER_READINGS_FIELDS['m-orp'],
      do: OTHER_READINGS_FIELDS['m-do'],
      temp: OTHER_READINGS_FIELDS['m-temp']
    };
    const thailandResult = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', thailandReadings);
    const thailandScore = Math.round(thailandResult.score);
    assert(Number.isFinite(thailandScore), `Thailand benchmark score computed for the same readings (got ${thailandScore})`);
    assert(thailandScore !== otherCanonical.score, `Thailand benchmark score (${thailandScore}) genuinely DIFFERS from the Quality V3 canonical score (${otherCanonical.score}) for these readings -- required for this test to be meaningful`);

    resetPublicationDependencies();
    makeStoreAndAdapter();
    const job = makeJob(OTHER_READINGS_FIELDS, { publicReportToken: 'rpt-t7-benchmark' });
    const outcome = await expectRejection(
      createOrReusePublication({ job, payload: { score: thailandScore, intent: 'publish' }, caseId: 'case-1' }),
      'SCORE_MISMATCH'
    );
    assert(outcome.rejected === true, `submitting the Thailand BENCHMARK score (${thailandScore}) as payload.score is REJECTED, not silently accepted as if it were the Quality V3 publication score`);
    assert(outcome.code === 'SCORE_MISMATCH', `rejection carries code SCORE_MISMATCH (got ${outcome.code})`);
    resetPublicationDependencies();
  }

  console.log('\n=== Test 8: post-publish edit leaves the PERSISTED ledger record frozen (intentional divergence, must PASS) ===');
  {
    resetPublicationDependencies();
    const { store } = makeStoreAndAdapter();
    const job = makeJob(GOOD_READINGS_FIELDS, { publicReportToken: 'rpt-t8' });
    const X = goodCanonical.score;
    const first = await createOrReusePublication({ job, payload: { score: X, intent: 'publish' }, caseId: 'case-1' });
    assert(first.ok === true, 'initial publish succeeds');

    // Simulate a later reading edit and compute the new live canonical score.
    const editedJob = makeJob(OTHER_READINGS_FIELDS, { publicReportToken: 'rpt-t8' });
    const Y = computeCanonicalScore(editedJob).score;
    assert(Y !== X, `the LIVE canonical score has moved on since publish (X=${X} -> Y=${Y}) -- required for this test to be meaningful`);

    // The actual proof: re-fetch the PERSISTED record directly from the
    // store by its own publicationId (not a local recomputation) and
    // confirm its publishedScore field is still X, unaffected by the fact
    // that readings changed and the live canonical score is now Y.
    const persisted = await store.findByPublicationId(first.publicationId);
    assert(!!persisted, 'the original ledger record is still findable by its own publicationId');
    assert(persisted && persisted.publishedScore === X, `the PERSISTED record's publishedScore is still X (${X}), NOT Y (${Y}) -- re-read directly from the store, not recomputed locally (got ${persisted && persisted.publishedScore})`);
    resetPublicationDependencies();
  }

  console.log('\n=== Test 9: republish after a genuine reading change, chained off a REAL prior publish in the same store ===');
  {
    resetPublicationDependencies();
    const { store } = makeStoreAndAdapter();
    const X = goodCanonical.score;
    const job1 = makeJob(GOOD_READINGS_FIELDS, { publicReportToken: 'rpt-t9' });
    const first = await createOrReusePublication({ job: job1, payload: { score: X, intent: 'publish' }, caseId: 'case-1' });
    assert(first.ok === true, 'initial publish (X) succeeds, in the same store this republish will chain off of');

    // A genuine reading change on the SAME Case, carrying forward the
    // pointer state the first publish actually produced (as a real fetch of
    // the Case after publish would show).
    const job2 = makeJob(OTHER_READINGS_FIELDS, {
      publicReportToken: first.reportToken,
      waterScore: X
    });
    const Y = computeCanonicalScore(job2).score;
    assert(Y !== X, `readings changed -> new canonical score differs (X=${X} -> Y=${Y})`);

    const republished = await createOrReusePublication({ job: job2, payload: { score: Y, intent: 'republish' }, caseId: 'case-1' });
    assert(republished.ok === true && republished.score === Y, `republish with the new canonical score Y (${Y}) succeeds (got ${republished.score})`);
    assert(republished.publicationId !== first.publicationId, `republish creates a NEW, distinct publication record (first=${first.publicationId}, second=${republished.publicationId})`);

    // Immutability, proven directly: the ORIGINAL record, looked up by its
    // own publicationId, must still hold X -- the republish must not have
    // mutated it in place.
    const originalStillX = await store.findByPublicationId(first.publicationId);
    assert(originalStillX && originalStillX.publishedScore === X, `the ORIGINAL record (publicationId=${first.publicationId}) still holds X (${X}) after republish, untouched (got ${originalStillX && originalStillX.publishedScore})`);
    const newRecordHoldsY = await store.findByPublicationId(republished.publicationId);
    assert(newRecordHoldsY && newRecordHoldsY.publishedScore === Y, `the NEW record (publicationId=${republished.publicationId}) holds Y (${Y}) (got ${newRecordHoldsY && newRecordHoldsY.publishedScore})`);
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
