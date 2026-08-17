/**
 * Gate A / PD-V7-09 write-once publication contract.
 * Run: node tests/publish/immutable-publication.test.js
 *
 * Uses the in-memory ledger only; no Notion or score-calculation writes.
 */
const assert = require('assert');
const {
  createOrReusePublication,
  resolveReportByToken,
  reconcilePointer,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies
} = require('../../services/score-publication-service');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');

const store = createMemoryPublicationStore();
const cases = new Map();
const writes = [];
let failNextPointerWrite = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seed(id) {
  const job = {
    id,
    notionId: id,
    name: `Case ${id}`,
    draft: { scoreBaseReadings: { ph: 7.2, tds: 80, chlorine: 0.3, turbidity: 0.1, orp: 400, do: 8 } },
    result: {},
    drive: {}
  };
  cases.set(id, job);
  return job;
}

async function getClient(id) {
  const job = cases.get(id);
  return job ? clone(job) : null;
}

async function updateClient(id, payload) {
  if (failNextPointerWrite) {
    failNextPointerWrite = false;
    throw new Error('pointer write unavailable');
  }
  const current = cases.get(id);
  assert(current, `known Case ${id}`);
  writes.push({ id, payload: clone(payload) });
  current.result = {
    ...current.result,
    waterScore: payload.latestWaterScore ?? current.result.waterScore,
    complianceStatus: payload.complianceStatus ?? current.result.complianceStatus ?? null,
    summary: payload.resultSummary ?? current.result.summary ?? '',
    reportUrl: payload.reportUrl ?? current.result.reportUrl ?? '',
    publicReportToken: payload.publicReportToken ?? current.result.publicReportToken ?? ''
  };
  return clone(current);
}

async function findClientByReportToken(token) {
  for (const job of cases.values()) {
    if (job.result.publicReportToken === token) return { clientPageId: job.notionId };
  }
  return null;
}

async function publish(job, score, intent, idempotencyKey) {
  return createOrReusePublication({
    job,
    caseId: job.id,
    payload: {
      score,
      intent,
      idempotencyKey,
      modelVersion: 'quality-v3.0',
      resultSummary: `Water score ${score}/100`
    }
  });
}

async function main() {
  setPublicationStore(store);
  setPublicationCaseAdapter({ getClient, updateClient, findClientByReportToken });

  const job = seed('case-A');

  const publicationA = await publish(job, 90, 'publish', 'request-A');
  assert.equal(publicationA.score, 90);
  assert.ok(publicationA.publicationId);
  assert.ok(publicationA.reportToken);
  assert.equal(cases.get('case-A').result.waterScore, 90);

  const reused = await publish(cases.get('case-A'), 11, 'publish', 'request-A2');
  assert.equal(reused.score, 90);
  assert.equal(reused.reportToken, publicationA.reportToken);

  const publicationB = await publish(cases.get('case-A'), 80, 'republish', 'request-B');
  assert.equal(publicationB.score, 80);
  assert.notEqual(publicationA.publicationId, publicationB.publicationId);
  assert.notEqual(publicationA.reportToken, publicationB.reportToken);
  assert.equal(cases.get('case-A').result.waterScore, 80, 'Case field is the latest pointer');

  const oldReport = await resolveReportByToken(publicationA.reportToken);
  const newReport = await resolveReportByToken(publicationB.reportToken);
  assert.equal(oldReport.result.waterScore, 90, 'old token resolves frozen Publication A');
  assert.equal(newReport.result.waterScore, 80, 'new token resolves Publication B');
  assert.equal(oldReport.result.publicationId, publicationA.publicationId);
  assert.equal(newReport.result.publicationId, publicationB.publicationId);

  const replay = await publish(cases.get('case-A'), 1, 'republish', 'request-B');
  assert.equal(replay.publicationId, publicationB.publicationId, 'same idempotency key replays Publication B');
  assert.equal(replay.score, 80, 'retry cannot mutate the published score');
  assert.equal(store._rows.length, 2, 'retry created no extra publication');

  const other = await publish(seed('case-B'), 70, 'publish', 'request-C');
  assert.equal(other.score, 70);
  assert.notEqual(other.reportToken, publicationA.reportToken);
  assert.equal((await resolveReportByToken(publicationA.reportToken)).result.waterScore, 90);

  store._rows.push({ ...store._rows[0], pageId: 'dup', publicationId: 'pub-dup' });
  await assert.rejects(
    () => resolveReportByToken(publicationA.reportToken),
    (error) => error.code === 'TOKEN_DUPLICATE'
  );
  store._rows.pop();
  assert.equal(await resolveReportByToken('rpt-missing'), null);

  const pendingJob = seed('case-pending');
  failNextPointerWrite = true;
  const pending = await publish(pendingJob, 77, 'publish', 'request-pending');
  assert.equal(pending.pointerPending, true, 'ledger record survives a pointer failure');
  const pendingPublication = store._rows.find((row) => row.publicationId === pending.publicationId);
  const originalSnapshot = JSON.stringify(pendingPublication.snapshot);
  const repaired = await reconcilePointer(pending.publicationId);
  assert.equal(repaired.pointerSyncState, 'synced');
  assert.equal(JSON.stringify(pendingPublication.snapshot), originalSnapshot, 'reconciliation changes no immutable field');
  assert.equal(cases.get('case-pending').result.waterScore, 77);

  assert(writes.every(({ payload }) => !Object.prototype.hasOwnProperty.call(payload, 'publicationId')),
    'Case writes contain only compatibility pointer fields');

  console.log('immutable-publication: PASS');
}

main()
  .finally(() => resetPublicationDependencies())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
