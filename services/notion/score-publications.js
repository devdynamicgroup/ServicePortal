/**
 * Score Publication Ledger — Notion satellite DB (Feedback-shaped).
 * Append-only pages. Immutable result fields are never updated.
 */
const { getNotionClient } = require('./client');
const { getNotionConfig } = require('../../config/env');
const { findPropertyKey, getPropertyValue } = require('./props');
const { withRetry } = require('../retry');
const {
  buildSnapshot,
  parseSnapshot,
  serializeSnapshot,
  chunkRichText,
  joinRichTextSegments
} = require('../score-publication-snapshot');

const FIELD_ALIASES = {
  publicationId: ['Publication ID', 'Name', 'Title', 'publicationId'],
  clientPageId: ['Client Page ID', 'Client Notion ID', 'clientPageId'],
  caseId: ['Case ID', 'Case', 'caseId'],
  publishedScore: ['Published Score', 'publishedScore'],
  scoreType: ['Score Type', 'scoreType'],
  modelVersion: ['Model Version', 'modelVersion'],
  benchmarkVersion: ['Benchmark Version', 'benchmarkVersion'],
  publishedAt: ['Published At', 'publishedAt'],
  publicReportToken: ['Public Report Token', 'publicReportToken'],
  publicationSnapshot: ['Publication Snapshot', 'publicationSnapshot'],
  idempotencyKey: ['Idempotency Key', 'idempotencyKey'],
  pointerSyncState: ['Pointer Sync State', 'pointerSyncState']
};

const SCHEMA = [
  { key: 'publicationId', name: 'Publication ID', schema: { title: {} }, required: true },
  { key: 'clientPageId', name: 'Client Page ID', schema: { rich_text: {} }, required: true },
  { key: 'caseId', name: 'Case ID', schema: { rich_text: {} }, required: false },
  { key: 'publishedScore', name: 'Published Score', schema: { number: { format: 'number' } }, required: true },
  {
    key: 'scoreType',
    name: 'Score Type',
    schema: { select: { options: [{ name: 'quality-v3' }, { name: 'legacy-publication' }] } },
    required: true
  },
  { key: 'modelVersion', name: 'Model Version', schema: { rich_text: {} }, required: false },
  { key: 'benchmarkVersion', name: 'Benchmark Version', schema: { rich_text: {} }, required: false },
  { key: 'publishedAt', name: 'Published At', schema: { date: {} }, required: true },
  { key: 'publicReportToken', name: 'Public Report Token', schema: { rich_text: {} }, required: true },
  { key: 'publicationSnapshot', name: 'Publication Snapshot', schema: { rich_text: {} }, required: true },
  { key: 'idempotencyKey', name: 'Idempotency Key', schema: { rich_text: {} }, required: true },
  {
    key: 'pointerSyncState',
    name: 'Pointer Sync State',
    schema: { select: { options: [{ name: 'synced' }, { name: 'pointer_pending' }] } },
    required: true
  }
];

function getScorePublicationsDatabaseId() {
  return process.env.NOTION_SCORE_PUBLICATIONS_DATABASE_ID
    || process.env.NOTION_PUBLICATION_LEDGER_DATABASE_ID
    || '';
}

function isScorePublicationsConfigured() {
  const { apiKey } = getNotionConfig();
  return Boolean(apiKey && getScorePublicationsDatabaseId());
}

async function getScorePublicationsSchema() {
  if (!isScorePublicationsConfigured()) {
    const error = new Error('NOTION_SCORE_PUBLICATIONS_DATABASE_ID is required');
    error.statusCode = 503;
    throw error;
  }
  const notion = getNotionClient();
  const databaseId = getScorePublicationsDatabaseId();
  const override = process.env.NOTION_SCORE_PUBLICATIONS_DATA_SOURCE_ID
    || process.env.NOTION_PUBLICATION_LEDGER_DATA_SOURCE_ID;
  if (override) {
    const detail = await withRetry(() => notion.dataSources.retrieve({ data_source_id: override }));
    return { databaseId, dataSourceId: override, properties: detail.properties || {} };
  }
  const database = await withRetry(() => notion.databases.retrieve({ database_id: databaseId }));
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error('Score Publications database has no data sources');
  const detail = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }));
  return { databaseId, dataSourceId, properties: detail.properties || {} };
}

async function ensureScorePublicationsSchema() {
  const notion = getNotionClient();
  const { databaseId, dataSourceId, properties } = await getScorePublicationsSchema();
  const missing = SCHEMA.filter((item) => !findPropertyKey(properties, FIELD_ALIASES[item.key] || [item.name]));
  if (missing.length) {
    await withRetry(() => notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: missing.reduce((acc, item) => {
        acc[item.name] = item.schema;
        return acc;
      }, {})
    }));
  }
  const fresh = missing.length
    ? await withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }))
    : { properties };
  return {
    databaseId,
    dataSourceId,
    created: missing.map((item) => item.name),
    properties: fresh.properties || properties
  };
}

function text(value) {
  return [{ text: { content: String(value || '').slice(0, 2000) } }];
}

function setProp(output, schema, aliases, value) {
  if (value === undefined || value === null || value === '') return;
  const key = findPropertyKey(schema, aliases);
  if (!key) return;
  const type = schema[key]?.type;
  if (type === 'title') output[key] = { title: text(value) };
  if (type === 'rich_text') output[key] = { rich_text: text(value) };
  if (type === 'number') {
    const number = Number(value);
    if (Number.isFinite(number)) output[key] = { number };
  }
  if (type === 'date') output[key] = { date: { start: String(value) } };
  if (type === 'select') output[key] = { select: { name: String(value) } };
}

function pageToRecord(page) {
  const properties = page.properties || {};
  const snapshotRaw = joinRichTextSegments(
    properties[findPropertyKey(properties, FIELD_ALIASES.publicationSnapshot) || '']?.rich_text || []
  );
  const snapshot = parseSnapshot(snapshotRaw)
    || parseSnapshot(getPropertyValue(properties, FIELD_ALIASES.publicationSnapshot));
  return {
    pageId: page.id,
    publicationId: getPropertyValue(properties, FIELD_ALIASES.publicationId),
    clientPageId: getPropertyValue(properties, FIELD_ALIASES.clientPageId),
    caseId: getPropertyValue(properties, FIELD_ALIASES.caseId) || null,
    publishedScore: getPropertyValue(properties, FIELD_ALIASES.publishedScore, null),
    scoreType: getPropertyValue(properties, FIELD_ALIASES.scoreType) || null,
    modelVersion: getPropertyValue(properties, FIELD_ALIASES.modelVersion) || 'UNKNOWN',
    benchmarkVersion: getPropertyValue(properties, FIELD_ALIASES.benchmarkVersion) || 'UNKNOWN',
    publishedAt: getPropertyValue(properties, FIELD_ALIASES.publishedAt, null),
    publicReportToken: getPropertyValue(properties, FIELD_ALIASES.publicReportToken),
    idempotencyKey: getPropertyValue(properties, FIELD_ALIASES.idempotencyKey),
    pointerSyncState: getPropertyValue(properties, FIELD_ALIASES.pointerSyncState) || null,
    snapshot: snapshot || null
  };
}

async function queryEquals(schema, dataSourceId, aliasKey, value, pageSize = 2) {
  const notion = getNotionClient();
  const key = findPropertyKey(schema, FIELD_ALIASES[aliasKey]);
  if (!key || value == null || value === '') return [];
  const type = schema[key]?.type;
  let filter = null;
  if (type === 'title') filter = { property: key, title: { equals: String(value) } };
  else if (type === 'rich_text') filter = { property: key, rich_text: { equals: String(value) } };
  if (!filter) return [];
  const result = await withRetry(() => notion.dataSources.query({
    data_source_id: dataSourceId,
    filter,
    page_size: pageSize
  }));
  return result.results || [];
}

function createNotionPublicationStore() {
  return {
    kind: 'notion',
    isConfigured: isScorePublicationsConfigured,
    async ensureSchema() {
      return ensureScorePublicationsSchema();
    },
    async create(record) {
      const notion = getNotionClient();
      const { dataSourceId, properties: schema } = await ensureScorePublicationsSchema();
      const snapshot = record.snapshot || buildSnapshot(record);
      const properties = {};
      setProp(properties, schema, FIELD_ALIASES.publicationId, record.publicationId);
      setProp(properties, schema, FIELD_ALIASES.clientPageId, record.clientPageId);
      setProp(properties, schema, FIELD_ALIASES.caseId, record.caseId);
      setProp(properties, schema, FIELD_ALIASES.publishedScore, record.publishedScore);
      setProp(properties, schema, FIELD_ALIASES.scoreType, record.scoreType);
      setProp(properties, schema, FIELD_ALIASES.modelVersion, record.modelVersion);
      setProp(properties, schema, FIELD_ALIASES.benchmarkVersion, record.benchmarkVersion);
      setProp(properties, schema, FIELD_ALIASES.publishedAt, record.publishedAt);
      setProp(properties, schema, FIELD_ALIASES.publicReportToken, record.publicReportToken);
      setProp(properties, schema, FIELD_ALIASES.idempotencyKey, record.idempotencyKey);
      setProp(properties, schema, FIELD_ALIASES.pointerSyncState, record.pointerSyncState || 'pointer_pending');
      const snapshotKey = findPropertyKey(schema, FIELD_ALIASES.publicationSnapshot);
      if (snapshotKey && schema[snapshotKey]?.type === 'rich_text') {
        properties[snapshotKey] = { rich_text: chunkRichText(serializeSnapshot(snapshot)) };
      }
      const page = await withRetry(() => notion.pages.create({
        parent: { type: 'data_source_id', data_source_id: dataSourceId },
        properties
      }));
      return pageToRecord(page);
    },
    async findByToken(token) {
      if (!isScorePublicationsConfigured()) return { records: [], duplicate: false };
      const { dataSourceId, properties: schema } = await ensureScorePublicationsSchema();
      const pages = await queryEquals(schema, dataSourceId, 'publicReportToken', token, 2);
      const records = pages.map(pageToRecord);
      return { records, duplicate: records.length > 1 };
    },
    async findByIdempotencyKey(idempotencyKey) {
      if (!isScorePublicationsConfigured() || !idempotencyKey) return null;
      const { dataSourceId, properties: schema } = await ensureScorePublicationsSchema();
      const pages = await queryEquals(schema, dataSourceId, 'idempotencyKey', idempotencyKey, 1);
      return pages[0] ? pageToRecord(pages[0]) : null;
    },
    async findByPublicationId(publicationId) {
      if (!isScorePublicationsConfigured() || !publicationId) return null;
      const { dataSourceId, properties: schema } = await ensureScorePublicationsSchema();
      const pages = await queryEquals(schema, dataSourceId, 'publicationId', publicationId, 1);
      return pages[0] ? pageToRecord(pages[0]) : null;
    },
    async findLatestByClientPageId(clientPageId) {
      const records = await this.listByClientPageId(clientPageId);
      if (!records.length) return null;
      return records[records.length - 1];
    },
    async listByClientPageId(clientPageId) {
      if (!isScorePublicationsConfigured() || !clientPageId) return [];
      const { dataSourceId, properties: schema } = await ensureScorePublicationsSchema();
      const pages = await queryEquals(schema, dataSourceId, 'clientPageId', clientPageId, 100);
      const records = pages.map(pageToRecord);
      records.sort((a, b) => String(a.publishedAt || '').localeCompare(String(b.publishedAt || '')));
      return records;
    },
    async listByCaseId(caseId) {
      if (!isScorePublicationsConfigured() || !caseId) return [];
      const { dataSourceId, properties: schema } = await ensureScorePublicationsSchema();
      const pages = await queryEquals(schema, dataSourceId, 'caseId', caseId, 100);
      const records = pages.map(pageToRecord);
      records.sort((a, b) => String(a.publishedAt || '').localeCompare(String(b.publishedAt || '')));
      return records;
    },
    async updatePointerSyncState(publicationId, pointerSyncState) {
      const existing = await this.findByPublicationId(publicationId);
      if (!existing?.pageId) return null;
      const notion = getNotionClient();
      const { properties: schema } = await ensureScorePublicationsSchema();
      const properties = {};
      setProp(properties, schema, FIELD_ALIASES.pointerSyncState, pointerSyncState);
      const page = await withRetry(() => notion.pages.update({
        page_id: existing.pageId,
        properties
      }));
      return pageToRecord(page);
    }
  };
}

module.exports = {
  FIELD_ALIASES,
  SCHEMA,
  getScorePublicationsDatabaseId,
  isScorePublicationsConfigured,
  ensureScorePublicationsSchema,
  createNotionPublicationStore
};
