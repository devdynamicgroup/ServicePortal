/**
 * Assessment measurement persistence — Case-owned.
 * Writes/reads Notion "Assessment Snapshot" only. No scoring / eligibility.
 */
const {
  getNotionClient,
  getDataSourceSchema,
  resetDataSourceCache,
  isNotionConfigured
} = require('./notion/client');
const { findPropertyKey } = require('./notion/props');
const { FIELD_ALIASES, notionPageToJob } = require('./notion/mapper');
const { updateClient, getClient } = require('./notion/clients');
const { withCaseLock, resolveJob, isTerminalCaseStatus } = require('./workflow-service');
const { withRetry } = require('./retry');
const AssessmentSnapshot = require('../src/js/assessment-snapshot');

const PROPERTY_NAME = 'Assessment Snapshot';

/**
 * Order-independent structural equality for two assessment-snapshot `taps`
 * arrays. Deliberately NOT a JSON.stringify comparison -- buildTapSnapshot()/
 * mergeTap() (src/js/assessment-snapshot.js) both build their readings
 * sub-objects by iterating fixed key-order arrays (METER_KEYS/CHLORINE_KEYS/
 * STANDARD_KEYS/TASK_KEYS) so property insertion order is deterministic in
 * practice, but relying on that as an implicit contract across two different
 * construction paths (a fresh build vs. a merge) is exactly the kind of
 * false-positive-change risk this must not reintroduce. Arrays stay
 * position-sensitive (tap order and meterImages order are meaningful data,
 * not incidental); plain objects are compared by key set + recursive value
 * equality, independent of property order.
 *
 * Pure, read-only, no side effects. Does not touch or reinterpret any
 * measurement value or scoring semantics -- only decides whether two
 * snapshots' CONTENT is identical.
 */
function snapshotContentEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!snapshotContentEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aIsObj = a !== null && typeof a === 'object';
  const bIsObj = b !== null && typeof b === 'object';
  if (aIsObj || bIsObj) {
    if (!aIsObj || !bIsObj) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!snapshotContentEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

async function ensureAssessmentSnapshotProperty() {
  if (!isNotionConfigured()) {
    const error = new Error('Notion is not configured');
    error.statusCode = 503;
    throw error;
  }

  const { dataSourceId, properties } = await getDataSourceSchema();
  const existing = findPropertyKey(properties, FIELD_ALIASES.assessmentSnapshot);
  if (existing) {
    return {
      ok: true,
      created: false,
      propertyKey: existing,
      type: properties[existing]?.type || null,
      dataSourceId
    };
  }

  const notion = getNotionClient();
  await withRetry(() => notion.dataSources.update({
    data_source_id: dataSourceId,
    properties: {
      [PROPERTY_NAME]: { rich_text: {} }
    }
  }));
  resetDataSourceCache();

  const fresh = await getDataSourceSchema();
  const key = findPropertyKey(fresh.properties, FIELD_ALIASES.assessmentSnapshot);
  if (!key) {
    const error = new Error('Failed to create Assessment Snapshot property');
    error.statusCode = 502;
    throw error;
  }

  return {
    ok: true,
    created: true,
    propertyKey: key,
    type: fresh.properties[key]?.type || 'rich_text',
    dataSourceId: fresh.dataSourceId
  };
}

function readExistingSnapshotFromJob(job) {
  const draft = job?.draft || {};
  if (draft.assessmentSnapshotRaw) {
    return AssessmentSnapshot.parseSnapshot(draft.assessmentSnapshotRaw);
  }
  if (
    Number.isFinite(Number(draft.assessmentRevision))
    && Array.isArray(draft.tapData)
    && AssessmentSnapshot.draftHasMeasurements(draft)
  ) {
    return AssessmentSnapshot.buildSnapshot({
      taps: draft.taps,
      tapData: draft.tapData,
      revision: draft.assessmentRevision,
      updatedAt: draft.assessmentUpdatedAt || new Date().toISOString()
    });
  }
  return null;
}

function normalizeIncomingSnapshot(body = {}) {
  if (body.snapshot && typeof body.snapshot === 'object') {
    return body.snapshot;
  }
  if (body.version != null && Array.isArray(body.taps)) {
    return body;
  }
  if (Array.isArray(body.tapData) || Array.isArray(body.taps)) {
    return AssessmentSnapshot.buildSnapshot({
      taps: body.taps,
      tapData: body.tapData,
      revision: body.revision,
      updatedAt: body.updatedAt
    });
  }
  return null;
}

/**
 * Persist assessment measurements for a Case.
 * Idempotent under withCaseLock; rejects stale revisions.
 */
async function submitCaseAssessment(caseId, body = {}) {
  const initial = await resolveJob(caseId);
  if (!initial?.notionId) {
    const error = new Error('Case not found');
    error.statusCode = 404;
    throw error;
  }

  const incoming = normalizeIncomingSnapshot(body);
  if (!AssessmentSnapshot.isValidSnapshot(incoming)) {
    const error = new Error('Invalid assessment snapshot');
    error.statusCode = 400;
    throw error;
  }

  await ensureAssessmentSnapshotProperty();

  return withCaseLock(initial.notionId, async () => {
    const job = await getClient(initial.notionId);
    // A cancelled/closed Case must not accept new measurements -- reuse the
    // same terminal-state guard closeCase()/startCase() already have
    // (weird-user QA, 2026-08-25: this function had no such guard).
    if (isTerminalCaseStatus(job)) {
      return {
        ok: true,
        skipped: true,
        reason: 'terminal_case',
        snapshot: readExistingSnapshotFromJob(job),
        case: job
      };
    }
    const existing = readExistingSnapshotFromJob(job);

    if (existing) {
      const existingRev = Number(existing.revision) || 0;
      const incomingRev = Number(incoming.revision) || 0;
      const existingTs = Date.parse(existing.updatedAt) || 0;
      const incomingTs = Date.parse(incoming.updatedAt) || 0;
      if (
        incomingRev < existingRev
        || (incomingRev === existingRev && incomingTs < existingTs)
      ) {
        return {
          ok: true,
          skipped: true,
          reason: 'stale_revision',
          snapshot: existing,
          case: job
        };
      }
    }

    const merged = AssessmentSnapshot.mergeSnapshots(existing, incoming);

    // Content-equality guard (2026-08-31 root-cause fix): saveActiveJobState()
    // -- and therefore scheduleAssessmentSync() -- fires on plain navigation
    // and step-completion, not just genuine measurement edits, and had no
    // way to tell those apart. A merge that produces the SAME taps content
    // as what's already stored is not a real change; incrementing revision/
    // assessmentUpdatedAt for it turned "revision" into a count of syncs,
    // not a count of edits. Skip the write (and the revision/timestamp
    // advance) entirely when nothing actually changed -- everything else
    // (terminal-case guard, stale-revision rejection, the merge itself) is
    // unchanged.
    //
    // 2026-09-01 root-cause fix (navigation-triggered revision inflation):
    // `existing` here is the RAW parsed snapshot -- readExistingSnapshotFromJob()
    // -> AssessmentSnapshot.parseSnapshot() only JSON.parses and validates
    // top-level shape, it never re-runs compactReadings()/asMeasurementNumber()
    // on the stored values. `merged`, by contrast, is always built through
    // mergeTap() -> mergeReadingMaps() -> compactReadings(), which normalizes
    // (e.g. coerces a numeric-looking string to a real number). So any stored
    // snapshot whose serialized shape doesn't already match current
    // normalization exactly (a legacy write, a manual Notion edit, any other
    // path that wrote before today's normalization existed) reads back
    // "different" from the freshly-normalized merge on the very next sync --
    // even one triggered by pure navigation/step-completion with zero
    // measurement edits -- inflating revision once, after which the newly
    // persisted (now-normalized) data compares equal from then on. Comparing
    // against `existing` re-run through the same normalization (merging it
    // with itself) closes this gap without weakening detection of a genuine
    // content edit, which still produces a real, normalized-vs-normalized
    // difference.
    const normalizedExisting = existing ? AssessmentSnapshot.mergeSnapshots(existing, existing) : null;

    if (existing && snapshotContentEqual(merged.taps, normalizedExisting.taps)) {
      return {
        ok: true,
        skipped: true,
        reason: 'no_change',
        snapshot: existing,
        case: job
      };
    }

    const serialized = AssessmentSnapshot.serializeSnapshot(merged);

    const updated = await updateClient(job.notionId, {
      assessmentSnapshot: serialized
    });

    return {
      ok: true,
      skipped: false,
      snapshot: merged,
      case: updated,
      bytes: serialized.length
    };
  });
}

module.exports = {
  PROPERTY_NAME,
  ensureAssessmentSnapshotProperty,
  submitCaseAssessment,
  readExistingSnapshotFromJob,
  normalizeIncomingSnapshot
};
