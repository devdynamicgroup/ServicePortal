/**
 * PublicationStore contract aliases over the in-memory adapter.
 * Run: node tests/publish/publication-store-contract.test.js
 */
const assert = require('assert');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');
const { withPublicationStoreContract } = require('../../services/publication-store');
const { buildSnapshot } = require('../../services/score-publication-snapshot');

async function main() {
  const store = withPublicationStoreContract(createMemoryPublicationStore());
  const snapshot = buildSnapshot({
    publicationId: 'pub-a',
    clientPageId: 'case-page',
    caseId: 'case-1',
    publishedScore: 90,
    scoreType: 'quality-v3',
    modelVersion: 'quality-v3.0',
    publishedAt: '2026-08-17T00:00:00.000Z',
    publicReportToken: 'rpt-a',
    scorePayload: { engine: 'quality-v3.0', note: 'optional payload' }
  });
  await store.createPublication({
    ...snapshot,
    snapshot,
    idempotencyKey: 'k-a',
    pointerSyncState: 'synced'
  });

  const byId = await store.getPublication('pub-a');
  const byToken = await store.getPublicationByToken('rpt-a');
  const listed = await store.listPublications({ clientPageId: 'case-page' });
  assert.equal(byId.publicationId, 'pub-a');
  assert.equal(byToken.publishedScore, 90);
  assert.equal(listed.length, 1);
  assert.equal(byId.snapshot.scorePayload.engine, 'quality-v3.0');
  assert.equal(byId.snapshot.publishedScore, 90);

  const second = buildSnapshot({
    publicationId: 'pub-b',
    clientPageId: 'case-page',
    caseId: 'case-1',
    publishedScore: 80,
    publicReportToken: 'rpt-b',
    publishedAt: '2026-08-17T01:00:00.000Z'
  });
  await store.createPublication({ ...second, snapshot: second, idempotencyKey: 'k-b' });
  const stillA = await store.getPublicationByToken('rpt-a');
  const listed2 = await store.listPublications({ clientPageId: 'case-page' });
  assert.equal(stillA.publishedScore, 90, 'old token remains frozen');
  assert.equal(listed2.length, 2, 'republish appends');
  console.log('publication-store-contract: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
