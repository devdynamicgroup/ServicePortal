/**
 * Gate A — idempotent retry vs explicit republish.
 * Run: node tests/publish/publication-idempotency.test.js
 */
const {
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies,
  createOrReusePublication
} = require('../../services/score-publication-service');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function createMemoryCaseAdapter(job) {
  const cases = new Map([[job.notionId, JSON.parse(JSON.stringify(job))]]);
  return {
    getClient: async (id) => (cases.has(id) ? JSON.parse(JSON.stringify(cases.get(id))) : null),
    updateClient: async (id, payload) => {
      const current = cases.get(id);
      current.result = current.result || {};
      if (payload.latestWaterScore != null) current.result.waterScore = payload.latestWaterScore;
      if (payload.publicReportToken) current.result.publicReportToken = payload.publicReportToken;
      if (payload.reportUrl) current.result.reportUrl = payload.reportUrl;
      if (payload.resultSummary) current.result.summary = payload.resultSummary;
      cases.set(id, current);
      return JSON.parse(JSON.stringify(current));
    },
    findClientByReportToken: async () => null
  };
}

async function main() {
  const store = createMemoryPublicationStore();
  const job = { id: 'c1', notionId: 'n1', draft: {}, result: {} };
  setPublicationStore(store);
  setPublicationCaseAdapter(createMemoryCaseAdapter(job));

  console.log('\nSame idempotency key replays one publication');
  const a = await createOrReusePublication({
    job,
    payload: { score: 91, intent: 'publish', idempotencyKey: 'same-op' },
    caseId: 'c1'
  });
  const b = await createOrReusePublication({
    job: { ...job, result: { waterScore: a.score, publicReportToken: a.reportToken } },
    payload: { score: 12, intent: 'publish', idempotencyKey: 'same-op' },
    caseId: 'c1'
  });
  assert(a.publicationId === b.publicationId, 'retry replays the same publicationId');
  assert(b.score === 91 && b.reused === true, 'retry does not write a new score');
  assert(store._rows.length === 1, 'ledger contains exactly one row');

  console.log('\nDouble submit without new intent');
  const c = await createOrReusePublication({
    job: { id: 'c1', notionId: 'n1', result: { waterScore: 91, publicReportToken: a.reportToken } },
    payload: { score: 50, intent: 'publish', idempotencyKey: 'other-op' },
    caseId: 'c1'
  });
  assert(c.score === 91 && c.reused === true, 'second publish intent still returns publication #1');
  assert(store._rows.length === 1, 'no extra row from double submit');

  console.log('\nExplicit republish uses a new key');
  const d = await createOrReusePublication({
    job: { id: 'c1', notionId: 'n1', result: { waterScore: 91, publicReportToken: a.reportToken } },
    payload: { score: 77, intent: 'republish', idempotencyKey: 'republish-op' },
    caseId: 'c1'
  });
  assert(d.score === 77 && d.publicationId !== a.publicationId, 'republish creates publication #2');
  assert(store._rows.length === 2, 'ledger has two immutable rows');

  resetPublicationDependencies();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
