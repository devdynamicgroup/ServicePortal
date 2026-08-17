/**
 * Case-owned Country Score standard persistence.
 *
 * This preference is deliberately separate from Assessment Snapshot
 * measurements and Quality V3 publishing state.
 */
const {
  getNotionClient,
  getDataSourceSchema,
  resetDataSourceCache,
  isNotionConfigured
} = require('./notion/client');
const { findPropertyKey } = require('./notion/props');
const { FIELD_ALIASES } = require('./notion/mapper');
const { getClient, updateClient } = require('./notion/clients');
const { withCaseLock, resolveJob } = require('./workflow-service');
const { withRetry } = require('./retry');

const PROPERTY_NAME = 'Country Score Standard';
const SCORE_STANDARD_KEYS = Object.freeze(['thailand', 'japan', 'eu', 'who', 'usEpa']);

function normalizeScoreStandardKey(value) {
  const key = String(value || '').trim();
  return SCORE_STANDARD_KEYS.includes(key) ? key : null;
}

async function ensureCountryScoreStandardProperty() {
  if (!isNotionConfigured()) {
    const error = new Error('Notion is not configured');
    error.statusCode = 503;
    throw error;
  }

  const { dataSourceId, properties } = await getDataSourceSchema();
  const existing = findPropertyKey(properties, FIELD_ALIASES.countryScoreStandard);
  if (existing) {
    if (properties[existing]?.type !== 'select') {
      const error = new Error('Country Score Standard must be a Notion select property');
      error.statusCode = 409;
      throw error;
    }
    return { ok: true, created: false, propertyKey: existing, dataSourceId };
  }

  const notion = getNotionClient();
  await withRetry(() => notion.dataSources.update({
    data_source_id: dataSourceId,
    properties: {
      [PROPERTY_NAME]: {
        select: {
          options: SCORE_STANDARD_KEYS.map(name => ({ name }))
        }
      }
    }
  }));
  resetDataSourceCache();

  const fresh = await getDataSourceSchema();
  const key = findPropertyKey(fresh.properties, FIELD_ALIASES.countryScoreStandard);
  if (!key) {
    const error = new Error('Failed to create Country Score Standard property');
    error.statusCode = 502;
    throw error;
  }
  return { ok: true, created: true, propertyKey: key, dataSourceId: fresh.dataSourceId };
}

async function submitCaseScoreStandard(caseId, body = {}) {
  const scoreStandardKey = normalizeScoreStandardKey(body.scoreStandardKey);
  if (!scoreStandardKey) {
    const error = new Error('Unsupported Country Score standard');
    error.statusCode = 400;
    throw error;
  }

  const initial = await resolveJob(caseId);
  if (!initial?.notionId) {
    const error = new Error('Case not found');
    error.statusCode = 404;
    throw error;
  }

  await ensureCountryScoreStandardProperty();
  return withCaseLock(initial.notionId, async () => {
    const job = await getClient(initial.notionId);
    const updated = await updateClient(job.notionId, { countryScoreStandard: scoreStandardKey });
    return { ok: true, scoreStandardKey, case: updated };
  });
}

module.exports = {
  PROPERTY_NAME,
  SCORE_STANDARD_KEYS,
  normalizeScoreStandardKey,
  ensureCountryScoreStandardProperty,
  submitCaseScoreStandard
};
