/**
 * Gate A — pointer-update failure and recovery.
 * Run: node tests/publish/publication-recovery.test.js
 */
const {
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies,
  createOrReusePublication,
  reconcilePointer,
  resolveReportByToken
} = require('../../services/score-publication-service');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

async function main() {
  const store = createMemoryPublicationStore();
  const job = { id: 'c1', notionId: 'n1', draft: {}, result: {} };
  let failPointer = true;
  const cases = {
    getClient: async () => JSON.parse(JSON.stringify(job)),
    updateClient: async (id, payload) => {
      if (failPointer) {
        const error = new Error('pointer write failed');
        error.code = 'POINTER_WRITE_FAILED';
        throw error;
      }
      if (payload.latestWaterScore != null) job.result.waterScore = payload.latestWaterScore;
      if (payload.publicReportToken) job.result.publicReportToken = payload.publicReportToken;
      if (payload.reportUrl) job.result.reportUrl = payload.reportUrl;
      job.id = 'c1';
      job.notionId = id;
      return JSON.parse(JSON.stringify(job));
    },
    findClientByReportToken: async () => null
  };

  setPublicationStore(store);
  setPublicationCaseAdapter(cases);

  console.log('\nPartial failure: ledger created, pointer pending');
  const created = await createOrReusePublication({
    job,
    payload: { score: 64, intent: 'publish', idempotencyKey: 'recover-1' },
    caseId: 'c1'
  });
  assert(created.pointerPending === true, 'returns pointer_pending when Case pointer update fails');
  assert(store._rows.length === 1, 'publication row still exists');
  assert(created.score === 64, 'published score is preserved on the ledger');
  const token = created.reportToken;
  const fromLedger = await resolveReportByToken(token);
  assert(fromLedger.result.waterScore === 64, 'public token resolves from snapshot even if pointer failed');

  console.log('\nRetry same key recovers pointer and does not duplicate');
  failPointer = false;
  const replay = await createOrReusePublication({
    job,
    payload: { score: 1, intent: 'publish', idempotencyKey: 'recover-1' },
    caseId: 'c1'
  });
  assert(replay.publicationId === created.publicationId, 'recovery replays the same publication');
  assert(store._rows.length === 1, 'recovery does not create a second publication');
  assert(job.result.waterScore === 64, 'pointer now matches publication 64');

  console.log('\nReconcile helper');
  job.result.waterScore = null;
  job.result.publicReportToken = null;
  const reconciled = await reconcilePointer(created.publicationId);
  assert(reconciled.pointerSyncState === 'synced', 'reconcile marks pointer synced');
  assert(job.result.waterScore === 64, 'reconcile restores latest pointer');

  console.log('\nClose must not clobber from stale payload — covered by reuse');
  const closeLike = await createOrReusePublication({
    job,
    payload: { score: 9, intent: 'publish', idempotencyKey: 'close-stale' },
    caseId: 'c1'
  });
  assert(closeLike.score === 64, 'stale close/publish payload cannot overwrite published score');

  resetPublicationDependencies();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
