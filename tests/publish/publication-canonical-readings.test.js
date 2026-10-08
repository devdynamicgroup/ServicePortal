/**
 * New publications store the canonical readings that produced publishedScore.
 * Existing ledger rows are not rewritten.
 *
 * Run: node tests/publish/publication-canonical-readings.test.js
 */
const assert = require('assert');
const { computeCanonicalScore } = require('../../services/canonical-score');
const { buildSnapshot } = require('../../services/score-publication-snapshot');
const {
  createOrReusePublication,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies
} = require('../../services/score-publication-service');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');

const READINGS_A = Object.freeze({
  ph: 7.24, tds: 105, chlorine: 0.82, turbidity: 0.56, orp: 591.6, do: 4.97, temp: 0
});
const READINGS_B = Object.freeze({
  ph: 7.2, tds: 80, chlorine: 0.3, turbidity: 0.1, orp: 400, do: 8, temp: 25
});
const FIELD_READINGS = Object.freeze({
  'm-ph': 7.4,
  'm-tds': 120,
  'm-free-cl': 0.4,
  'm-turb': 0.2,
  'm-orp': 420,
  'm-do': 6.5,
  'm-temp': 26
});

function jobFrom({ id, tapData, fields, scoreBaseReadings, result }) {
  return {
    id,
    notionId: id,
    name: id,
    draft: {
      fields: fields || {},
      tapData: tapData || [],
      scoreBaseReadings: scoreBaseReadings === undefined ? null : scoreBaseReadings
    },
    result: result || { waterScore: null, publicReportToken: '' }
  };
}

function tap(readings) {
  return { standardMeasurement: { ...readings } };
}

async function publish(job, score, idempotencyKey, intent = 'publish') {
  return createOrReusePublication({
    job,
    caseId: job.id,
    payload: {
      score,
      intent,
      idempotencyKey,
      modelVersion: 'quality-v3.0',
      resultSummary: `Water score ${Math.round(score)}/100`
    }
  });
}

function storedSnapshot(store, publicationId) {
  const row = store._rows.find((item) => item.publicationId === publicationId);
  assert(row, `ledger row ${publicationId}`);
  return row.snapshot;
}

const READING_KEYS = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'];

function assertSameReadings(actual, expected, label) {
  assert(actual && expected, `${label} readings exist`);
  assert.deepStrictEqual(Object.keys(actual), Object.keys(expected), `${label} keys`);
  for (const key of READING_KEYS) {
    assert.strictEqual(actual[key], expected[key], `${label} ${key}`);
  }
}

async function main() {
  const store = createMemoryPublicationStore();
  setPublicationStore(store);
  setPublicationCaseAdapter({
    async getClient() { return null; },
    async updateClient(_id, patch) {
      return { id: 'updated', result: { waterScore: patch.latestWaterScore, publicReportToken: patch.publicReportToken } };
    },
    async findClientByReportToken() { return null; }
  });

  console.log('\nA. tapData readings, scoreBaseReadings null');
  {
    const job = jobFrom({
      id: 'case-a',
      tapData: [tap(READINGS_A)],
      scoreBaseReadings: null
    });
    const canonical = computeCanonicalScore(job);
    const created = await publish(job, canonical.score, 'capture-a');
    const snapshot = storedSnapshot(store, created.publicationId);
    assert.strictEqual(snapshot.publishedScore, Math.round(canonical.score));
    assertSameReadings(snapshot.readings, canonical.readings, 'A');
  }

  console.log('\nB. stale scoreBaseReadings must not be stored');
  {
    const job = jobFrom({
      id: 'case-b',
      tapData: [tap(READINGS_A)],
      scoreBaseReadings: READINGS_B
    });
    const canonical = computeCanonicalScore(job);
    assert.notStrictEqual(canonical.readings.ph, READINGS_B.ph);
    const created = await publish(job, canonical.score, 'capture-b');
    const snapshot = storedSnapshot(store, created.publicationId);
    assert.strictEqual(snapshot.publishedScore, Math.round(canonical.score));
    assertSameReadings(snapshot.readings, canonical.readings, 'B');
    assert.notStrictEqual(snapshot.readings.ph, READINGS_B.ph);
    assert.notStrictEqual(snapshot.readings.tds, READINGS_B.tds);
    assert.deepStrictEqual(canonical.readings.ph, READINGS_A.ph);
    assert.deepStrictEqual(canonical.readings.tds, READINGS_A.tds);
  }

  console.log('\nC. fields-only case');
  {
    const job = jobFrom({
      id: 'case-c',
      fields: FIELD_READINGS,
      tapData: [{ tasks: {}, photos: {} }],
      scoreBaseReadings: READINGS_B
    });
    const canonical = computeCanonicalScore(job);
    assert.strictEqual(canonical.readings.ph, 7.4);
    assert.strictEqual(canonical.readings.tds, 120);
    assert.notStrictEqual(canonical.readings.ph, READINGS_B.ph);
    const created = await publish(job, canonical.score, 'capture-c');
    const snapshot = storedSnapshot(store, created.publicationId);
    assertSameReadings(snapshot.readings, canonical.readings, 'C');
    assert.strictEqual(snapshot.publishedScore, Math.round(canonical.score));
  }

  console.log('\nD. every new publication matches its own canonical result');
  {
    for (const id of ['case-a', 'case-b', 'case-c']) {
      const row = store._rows.find((item) => item.caseId === id);
      const source = id === 'case-c'
        ? jobFrom({ id, fields: FIELD_READINGS, tapData: [{ tasks: {}, photos: {} }], scoreBaseReadings: READINGS_B })
        : jobFrom({ id, tapData: [tap(READINGS_A)], scoreBaseReadings: id === 'case-b' ? READINGS_B : null });
      const canonical = computeCanonicalScore(source);
      assertSameReadings(row.snapshot.readings, canonical.readings, id);
      assert.strictEqual(row.snapshot.publishedScore, Math.round(canonical.score), `${id} score`);
    }
  }

  console.log('\nE. an existing publication is reused and its snapshot is not rewritten');
  {
    const staleSnapshot = buildSnapshot({
      publicationId: 'pub-existing',
      clientPageId: 'case-existing',
      caseId: 'case-existing',
      publishedScore: 51,
      scoreType: 'quality-v3',
      publicReportToken: 'rpt-existing',
      readings: READINGS_B
    });
    await store.create({
      ...staleSnapshot,
      snapshot: staleSnapshot,
      idempotencyKey: 'existing-key',
      pointerSyncState: 'synced'
    });
    const before = JSON.stringify(store._rows.find((row) => row.publicationId === 'pub-existing').snapshot);
    const live = jobFrom({
      id: 'case-existing',
      tapData: [tap(READINGS_A)],
      scoreBaseReadings: null,
      result: { waterScore: 51, publicReportToken: 'rpt-existing' }
    });
    const canonical = computeCanonicalScore(live);
    const reused = await publish(live, canonical.score, 'capture-e-reuse', 'publish');
    assert.strictEqual(reused.reused, true);
    assert.strictEqual(reused.publicationId, 'pub-existing');
    assert.strictEqual(reused.score, 51);
    const after = JSON.stringify(store._rows.find((row) => row.publicationId === 'pub-existing').snapshot);
    assert.strictEqual(after, before);
    assertSameReadings(JSON.parse(after).readings, READINGS_B, 'existing');

    const republished = await publish(live, canonical.score, 'capture-e-republish', 'republish');
    assert.notStrictEqual(republished.publicationId, 'pub-existing');
    const oldRow = store._rows.find((row) => row.publicationId === 'pub-existing');
    const newRow = store._rows.find((row) => row.publicationId === republished.publicationId);
    assert.strictEqual(JSON.stringify(oldRow.snapshot), before);
    assertSameReadings(newRow.snapshot.readings, canonical.readings, 'republish');
    assert.strictEqual(newRow.snapshot.publishedScore, Math.round(canonical.score));
  }

  console.log('publication-canonical-readings: PASS');
}

main()
  .finally(() => resetPublicationDependencies())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
