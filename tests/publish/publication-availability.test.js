/**
 * Publication availability invariant: a publication is created only when the
 * Case has a complete canonical six-parameter reading set.
 * Run: node tests/publish/publication-availability.test.js
 *
 * In-memory ledger and Case adapter only; no Notion.
 */
const {
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies,
  createOrReusePublication
} = require('../../services/score-publication-service');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');
const { computeCanonicalScore } = require('../../services/canonical-score');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const COMPLETE = { ph: 7.2, tds: 80, chlorine: 0.35, turbidity: 0.1, orp: 400, do: 8 };
const SIX = Object.keys(COMPLETE);

function makeCase(id, readings, result = {}) {
  return {
    id,
    notionId: id,
    draft: { taps: ['Tap 1'], fields: {}, tapData: [{ standardMeasurement: { ...readings } }] },
    result: { ...result }
  };
}

function setup() {
  const store = createMemoryPublicationStore();
  const pointerWrites = [];
  setPublicationStore(store);
  setPublicationCaseAdapter({
    getClient: async () => null,
    updateClient: async (id, payload) => {
      pointerWrites.push({ id, payload });
      return { id, notionId: id, result: {} };
    },
    findClientByReportToken: async () => null
  });
  return { store, pointerWrites };
}

async function attempt(job, payload) {
  try {
    return { result: await createOrReusePublication({ job, payload, caseId: job.id }) };
  } catch (error) {
    return { error };
  }
}

async function main() {
  console.log('\nA. Incomplete canonical readings are rejected before anything is created');
  for (const missing of SIX) {
    const { store, pointerWrites } = setup();
    const readings = { ...COMPLETE };
    delete readings[missing];
    const job = makeCase(`a-${missing}`, readings);
    const { result, error } = await attempt(job, { score: 100, intent: 'publish', idempotencyKey: `a-${missing}` });
    assert(!result && error?.statusCode === 409 && error?.code === 'SCORE_UNAVAILABLE', `missing ${missing} -> 409 SCORE_UNAVAILABLE`);
    assert(store._rows.length === 0, `missing ${missing}: no publication record`);
    assert(pointerWrites.length === 0, `missing ${missing}: no token or pointer written to the Case`);
  }
  {
    const { store, pointerWrites } = setup();
    const job = { id: 'a-empty', notionId: 'a-empty', draft: {}, result: {} };
    const { error } = await attempt(job, { score: 91, intent: 'publish', idempotencyKey: 'a-empty' });
    assert(error?.statusCode === 409 && error?.code === 'SCORE_UNAVAILABLE', 'Case with no readings at all -> 409 SCORE_UNAVAILABLE');
    assert(store._rows.length === 0 && pointerWrites.length === 0, 'Case with no readings: nothing created');
  }

  console.log('\nB. Complete canonical readings with a matching score publish');
  {
    const { store, pointerWrites } = setup();
    const job = makeCase('b', COMPLETE);
    const canonical = computeCanonicalScore(job);
    const { result, error } = await attempt(job, { score: canonical.score, intent: 'publish', idempotencyKey: 'b' });
    assert(!error && result?.ok === true, 'publication succeeds');
    assert(result?.score === canonical.score, `published score is the canonical score (${canonical.score})`);
    assert(store._rows.length === 1, 'exactly one publication record');
    assert(store._rows[0]?.snapshot?.scoreType === 'quality-v3', 'scoreType is quality-v3');
    assert(Boolean(result?.reportToken) && pointerWrites.length === 1 && pointerWrites[0].payload.publicReportToken === result.reportToken,
      'token minted and Case pointer written once');

    const wrong = await attempt(makeCase('b-wrong', COMPLETE), { score: canonical.score - 5, intent: 'publish', idempotencyKey: 'b-wrong' });
    assert(wrong.error?.statusCode === 409 && wrong.error?.code === 'SCORE_MISMATCH', 'a wrong score on a complete Case is still SCORE_MISMATCH, not SCORE_UNAVAILABLE');
  }

  console.log('\nC. Idempotency and reuse are unchanged by the invariant');
  {
    const { store, pointerWrites } = setup();
    const job = makeCase('c', COMPLETE);
    const score = computeCanonicalScore(job).score;
    const first = (await attempt(job, { score, intent: 'publish', idempotencyKey: 'c-1' })).result;
    const published = { ...job, result: { waterScore: first.score, publicReportToken: first.reportToken } };

    const replay = (await attempt(published, { score: 12, intent: 'publish', idempotencyKey: 'c-1' })).result;
    assert(replay?.publicationId === first.publicationId && replay.reused === true && replay.score === score, 'same key replays the same publication');

    const incompleteNow = makeCase('c', { ...COMPLETE, do: undefined }, published.result);
    delete incompleteNow.draft.tapData[0].standardMeasurement.do;
    const reuse = (await attempt(incompleteNow, { score: 50, intent: 'publish', idempotencyKey: 'c-2' })).result;
    assert(reuse?.publicationId === first.publicationId && reuse.reused === true, 'publish intent still returns the existing publication when the Case later becomes incomplete');
    assert(store._rows.length === 1, 'reuse created no record');

    const writesBefore = pointerWrites.length;
    const blocked = await attempt(incompleteNow, { score: 50, intent: 'republish', idempotencyKey: 'c-3' });
    assert(blocked.error?.statusCode === 409 && blocked.error?.code === 'SCORE_UNAVAILABLE', 'republish of an incomplete Case -> 409 SCORE_UNAVAILABLE');
    assert(store._rows.length === 1, 'rejected republish created no record');
    assert(pointerWrites.length === writesBefore, 'rejected republish wrote no token or pointer');
    assert(store._rows[0].publicReportToken === first.reportToken && store._rows[0].publishedScore === score, 'existing publication is untouched');
  }

  resetPublicationDependencies();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
