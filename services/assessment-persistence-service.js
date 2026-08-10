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
const { withCaseLock, resolveJob } = require('./workflow-service');
const { withRetry } = require('./retry');
const AssessmentSnapshot = require('../src/js/assessment-snapshot');

const PROPERTY_NAME = 'Assessment Snapshot';

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
