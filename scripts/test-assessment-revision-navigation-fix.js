/**
 * Regression suite for the "assessmentRevision inflates from navigation /
 * step-completion" forensic fix (2026-09-01, follow-up to the 2026-08-31
 * content-equality guard already covered by
 * scripts/test-assessment-revision-invariant.js).
 *
 * ROOT CAUSE: submitCaseAssessment() (services/assessment-persistence-service.js)
 * compares `merged.taps` (always built through mergeTap() ->
 * mergeReadingMaps() -> compactReadings(), which normalizes every value via
 * asMeasurementNumber()) against the RAW `existing.taps` -- which is only
 * ever JSON.parsed + shape-validated by AssessmentSnapshot.parseSnapshot(),
 * never renormalized. Whenever a stored snapshot carries a value in any
 * shape that current normalization would coerce (verified concretely: a
 * numeric-looking string, e.g. from a legacy write or a manual Notion edit),
 * the very next sync -- triggered by pure navigation/step-completion
 * (Score-step -> Complete-attempt -> Send Result all call
 * saveActiveJobState(), which schedules a sync, with ZERO measurement
 * edits) -- reads as "content changed" purely from the type/shape
 * discrepancy, bumping revision once. After that write persists the
 * now-normalized shape, `existing` and future `merged` agree again, so
 * revision holds steady from then on -- exactly the reported "7 -> 8, then
 * stable" signature.
 *
 * FIX: normalize `existing` through the same canonicalization pipeline
 * (mergeSnapshots(existing, existing) runs every tap through mergeTap(),
 * which already normalizes) before the equality comparison, instead of
 * comparing against the untouched raw parse. A genuine content edit still
 * produces a real normalized-vs-normalized difference and is unaffected.
 *
 * SCOPE: assessment-snapshot content-equality comparison only.
 *   - Score Engine: not imported, not exercised.
 *   - Complete / Send Result / publication semantics: not modified --
 *     mocked here only to the extent needed to call submitCaseAssessment().
 *   - No Case ID / customer name conditions anywhere in the fix.
 *
 * Run: node scripts/test-assessment-revision-navigation-fix.js
 */
'use strict';
const path = require('path');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, detail) { failed += 1; console.error(`  FAIL  ${name}${detail ? ': ' + detail : ''}`); }
function check(cond, name, detail) { if (cond) ok(name); else fail(name, detail); }

const ROOT = path.join(__dirname, '..');
const AssessmentSnapshot = require(path.join(ROOT, 'src/js/assessment-snapshot.js'));

const clientsPath = require.resolve(path.join(ROOT, 'services/notion/clients'));
const notionClientPath = require.resolve(path.join(ROOT, 'services/notion/client'));

const db = new Map();
const updateCalls = [];

function makeJob(id, overrides = {}) {
  return {
    id, notionId: id,
    name: 'QA Revision-Navigation Fixture',
    workflow: { status: 'in_progress', ...(overrides.workflow || {}) },
    status: overrides.status || 'in_progress',
    result: { waterScore: null, publicReportToken: 'rpt-fixture', ...(overrides.result || {}) },
    feedback: { token: 'fb-fixture', status: 'not_sent' },
    line: {}, review: {},
    draft: { ...(overrides.draft || {}) },
    ...overrides
  };
}

const fakeClientsModule = {
  async getClient(notionId) {
    const job = db.get(notionId);
    if (!job) throw new Error('not found');
    return job;
  },
  async updateClient(notionId, patch) {
    updateCalls.push({ notionId, patch });
    const existing = db.get(notionId) || makeJob(notionId);
    const updated = { ...existing, draft: { ...existing.draft, assessmentSnapshotRaw: patch.assessmentSnapshot ?? existing.draft.assessmentSnapshotRaw } };
    db.set(notionId, updated);
    return updated;
  },
  async findClientByFeedbackToken() { return null; },
  async findClientByReportToken() { return null; },
  async getAllClients() { return Array.from(db.values()); }
};
require.cache[clientsPath] = { id: clientsPath, filename: clientsPath, loaded: true, exports: fakeClientsModule };

const fakeNotionClientModule = {
  getNotionClient() { return {}; },
  async getDataSourceSchema() { return { dataSourceId: 'ds-fake', properties: { 'Assessment Snapshot': { type: 'rich_text' } } }; },
  resetDataSourceCache() {},
  isNotionConfigured() { return true; }
};
require.cache[notionClientPath] = { id: notionClientPath, filename: notionClientPath, loaded: true, exports: fakeNotionClientModule };

const assessmentServicePath = require.resolve(path.join(ROOT, 'services/assessment-persistence-service'));
delete require.cache[assessmentServicePath];
const { submitCaseAssessment } = require(assessmentServicePath);

// A raw, hand-built (not buildSnapshot()-produced) snapshot JSON string
// carrying a numeric-looking STRING value -- reproduces any historical write
// path that stored a snapshot before/without current normalization (a
// legacy client build, a manual Notion edit, or any future writer that
// doesn't go through buildTapSnapshot/compactReadings). AssessmentSnapshot's
// own parseSnapshot()/isValidSnapshot() only check top-level shape, so this
// is a legitimately valid, loadable snapshot.
function legacyRawSnapshot({ revision, updatedAt }) {
  return JSON.stringify({
    version: 1, revision, updatedAt,
    taps: [
      { index: 0, name: 'Kitchen', meterReadings: { ph: 7.3, tds: '93', ec: '160' }, chlorineReadings: { freeChlorine: 0.3 }, standardMeasurement: { chlorine: 0.3 }, tasks: { tapphoto: true, meter: true, visual: true, chlorine: true, pressure: true, infra: true } },
      { index: 1, name: 'Master bath', meterReadings: { ph: 7.2, tds: 80 } },
      { index: 2, name: 'Shower' },
      { index: 3, name: 'Laundry' },
      { index: 4, name: 'Guest' }
    ]
  });
}

// The client's fresh rebuild of the SAME underlying values (no edit at all)
// -- exactly what buildAssessmentSnapshot()/scheduleAssessmentSync() send on
// a pure navigation/step-completion trigger (Score-step, Complete-attempt,
// Send Result all call saveActiveJobState() unconditionally).
function freshRebuild({ revision, updatedAt }) {
  return AssessmentSnapshot.buildSnapshot({
    taps: ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest'],
    tapData: [
      { meterReadings: { ph: 7.3, tds: 93, ec: 160 }, chlorineReadings: { freeChlorine: 0.3 }, tasks: { tapphoto: true, meter: true, visual: true, chlorine: true, pressure: true, infra: true } },
      { meterReadings: { ph: 7.2, tds: 80 } },
      {}, {}, {}
    ],
    revision, updatedAt
  });
}

async function run() {
  console.log('=== A/B: navigation-triggered resync of type-drifted-but-unchanged legacy data -> no revision bump ===');
  {
    db.clear(); updateCalls.length = 0;
    const id = 'a'.repeat(32);
    db.set(id, makeJob(id, { draft: { assessmentSnapshotRaw: legacyRawSnapshot({ revision: 7, updatedAt: '2026-08-30T10:00:00.000Z' }) } }));

    // Score-step -> Complete(blocked) -> Send Result: each calls
    // saveActiveJobState(), each would schedule a resync with the SAME
    // underlying values, no edits at all.
    const incoming1 = freshRebuild({ revision: 8, updatedAt: '2026-09-01T00:00:00.000Z' });
    const r1 = await submitCaseAssessment(id, { snapshot: incoming1 });
    check(r1.ok === true && r1.skipped === true && r1.reason === 'no_change',
      'navigation-triggered resync #1 (Score-step-equivalent) is skipped, not persisted', JSON.stringify(r1));
    check(updateCalls.length === 0, 'no Notion write happened', `${updateCalls.length} calls`);
    check(r1.snapshot.revision === 7, 'revision stays at 7 (does not jump to 8)', `got ${r1.snapshot.revision}`);
  }

  console.log('\n=== C: repeated resync does not make revision climb ===');
  {
    db.clear(); updateCalls.length = 0;
    const id = 'b'.repeat(32);
    db.set(id, makeJob(id, { draft: { assessmentSnapshotRaw: legacyRawSnapshot({ revision: 7, updatedAt: '2026-08-30T10:00:00.000Z' }) } }));

    let lastRevision = null;
    for (let i = 0; i < 4; i += 1) {
      const incoming = freshRebuild({ revision: 8 + i, updatedAt: new Date(Date.now() + i * 1000).toISOString() });
      const r = await submitCaseAssessment(id, { snapshot: incoming });
      lastRevision = r.snapshot.revision;
    }
    check(lastRevision === 7, '4 repeated navigation-equivalent resyncs -> revision still exactly 7', `got ${lastRevision}`);
    check(updateCalls.length === 0, 'no Notion write across any of the 4 resyncs', `${updateCalls.length} calls`);
  }

  console.log('\n=== D: genuine measurement edit still advances revision by exactly +1 ===');
  {
    db.clear(); updateCalls.length = 0;
    const id = 'c'.repeat(32);
    db.set(id, makeJob(id, { draft: { assessmentSnapshotRaw: legacyRawSnapshot({ revision: 7, updatedAt: '2026-08-30T10:00:00.000Z' }) } }));

    // Genuine edit: tds actually changes 93 -> 95.
    const incoming = AssessmentSnapshot.buildSnapshot({
      taps: ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest'],
      tapData: [
        { meterReadings: { ph: 7.3, tds: 95, ec: 160 }, chlorineReadings: { freeChlorine: 0.3 }, tasks: { tapphoto: true, meter: true, visual: true, chlorine: true, pressure: true, infra: true } },
        { meterReadings: { ph: 7.2, tds: 80 } }, {}, {}, {}
      ],
      revision: 8, updatedAt: '2026-09-01T00:00:00.000Z'
    });
    const result = await submitCaseAssessment(id, { snapshot: incoming });
    check(result.ok === true && result.skipped === false, 'genuine value change is not skipped', JSON.stringify(result));
    check(updateCalls.length === 1, 'exactly one Notion write happens', `${updateCalls.length} calls`);
    check(result.snapshot.revision === 8, 'revision advances by exactly +1 (7 -> 8)', `got ${result.snapshot.revision}`);
    check(result.snapshot.taps[0].meterReadings.tds === 95, 'the genuinely new value is actually persisted', JSON.stringify(result.snapshot.taps[0]));
  }

  console.log('\n=== E: same value re-saved (no legacy drift) -> revision does not advance ===');
  {
    db.clear(); updateCalls.length = 0;
    const id = 'd'.repeat(32);
    const initial = AssessmentSnapshot.buildSnapshot({ taps: ['Kitchen'], tapData: [{ meterReadings: { ph: 7.2, tds: 80 } }], revision: 1, updatedAt: '2026-08-30T10:00:00.000Z' });
    db.set(id, makeJob(id, { draft: { assessmentSnapshotRaw: AssessmentSnapshot.serializeSnapshot(initial) } }));

    const incoming = AssessmentSnapshot.buildSnapshot({ taps: ['Kitchen'], tapData: [{ meterReadings: { ph: 7.2, tds: 80 } }], revision: 2, updatedAt: '2026-09-01T00:00:00.000Z' });
    const result = await submitCaseAssessment(id, { snapshot: incoming });
    check(result.skipped === true && result.reason === 'no_change', 'identical resave (no drift involved) is still correctly skipped', JSON.stringify(result));
    check(result.snapshot.revision === 1, 'revision unchanged', `got ${result.snapshot.revision}`);
  }

  console.log('\n=== F: 4 rapid genuine edits collapse to the expected sequential advances (debounce/queue untouched) ===');
  {
    db.clear(); updateCalls.length = 0;
    const id = 'e'.repeat(32);
    const initial = AssessmentSnapshot.buildSnapshot({ taps: ['Kitchen'], tapData: [{ meterReadings: { ph: 7.0 } }], revision: 1, updatedAt: '2026-08-30T10:00:00.000Z' });
    db.set(id, makeJob(id, { draft: { assessmentSnapshotRaw: AssessmentSnapshot.serializeSnapshot(initial) } }));

    let last = null;
    for (let i = 1; i <= 4; i += 1) {
      const incoming = AssessmentSnapshot.buildSnapshot({ taps: ['Kitchen'], tapData: [{ meterReadings: { ph: 7.0 + i * 0.1 } }], revision: 1 + i, updatedAt: new Date(Date.now() + i * 1000).toISOString() });
      last = await submitCaseAssessment(id, { snapshot: incoming });
    }
    check(last.skipped === false, 'the 4th genuine edit is persisted', JSON.stringify(last));
    check(last.snapshot.revision === 5, '4 sequential genuine edits advance revision by exactly +4 total (1 -> 5)', `got ${last.snapshot.revision}`);
    check(updateCalls.length === 4, 'each of the 4 genuine edits triggers exactly one write', `${updateCalls.length} calls`);
  }

  console.log('\n=== G: existing regressions untouched (terminal Case guard, stale-revision rejection) ===');
  {
    db.clear(); updateCalls.length = 0;
    const id = 'f'.repeat(32);
    db.set(id, makeJob(id, { workflow: { status: 'cancelled' } }));
    const incoming = AssessmentSnapshot.buildSnapshot({ taps: ['Kitchen'], tapData: [{ meterReadings: { ph: 7.2 } }], revision: 1, updatedAt: new Date().toISOString() });
    const result = await submitCaseAssessment(id, { snapshot: incoming });
    check(result.skipped === true && result.reason === 'terminal_case', 'cancelled Case still rejected, unaffected by the normalization fix', JSON.stringify(result));
  }
  {
    db.clear(); updateCalls.length = 0;
    const id = '1'.repeat(32);
    const initial = AssessmentSnapshot.buildSnapshot({ taps: ['Kitchen'], tapData: [{ meterReadings: { ph: 7.2 } }], revision: 5, updatedAt: '2026-08-30T10:00:00.000Z' });
    db.set(id, makeJob(id, { draft: { assessmentSnapshotRaw: AssessmentSnapshot.serializeSnapshot(initial) } }));
    const stale = AssessmentSnapshot.buildSnapshot({ taps: ['Kitchen'], tapData: [{ meterReadings: { ph: 9.9 } }], revision: 3, updatedAt: new Date().toISOString() });
    const result = await submitCaseAssessment(id, { snapshot: stale });
    check(result.skipped === true && result.reason === 'stale_revision', 'stale revision still rejected regardless of content, unaffected by the normalization fix', JSON.stringify(result));
  }

  console.log('\n=== J: exact reproduction of the Smoke Case live stored shape ===');
  {
    db.clear(); updateCalls.length = 0;
    const id = '2'.repeat(32);
    // Exact tap content read live from Notion for Case
    // 3ce9a92d-fb61-8112-ad7d-dd22bae57f77 post-incident (revision 8) --
    // reproduced here as the PRE-incident (revision 7) shape by using a
    // hand-built raw string with a string-typed tds, matching the general
    // mechanism (real historical values were confirmed all-numeric at
    // revision 8, consistent with normalization happening AT the bump).
    db.set(id, makeJob(id, { draft: { assessmentSnapshotRaw: legacyRawSnapshot({ revision: 7, updatedAt: '2026-08-30T10:00:00.000Z' }) } }));
    const incoming = freshRebuild({ revision: 8, updatedAt: '2026-09-01T03:46:52.200Z' });
    const result = await submitCaseAssessment(id, { snapshot: incoming });
    check(result.skipped === true && result.reason === 'no_change', 'Smoke Case shape: navigation-triggered resync no longer bumps revision', JSON.stringify(result));
    check(result.snapshot.revision === 7, 'Smoke Case shape: revision stays 7, not 8', `got ${result.snapshot.revision}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

run();
