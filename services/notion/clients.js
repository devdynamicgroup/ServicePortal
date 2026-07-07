const { getNotionConfig } = require('../../config/env');
const { getNotionClient, isNotionConfigured } = require('./client');
const { findPropertyKey } = require('./props');
const { FIELD_ALIASES, notionPageToJob } = require('./mapper');

let resolvedDataSourceId = null;

function isNotFoundError(error) {
  return error?.code === 'object_not_found' || error?.status === 404;
}

async function resolveDataSourceId(collectionId) {
  const notion = getNotionClient();
  if (!notion) throw new Error('Notion client is not configured');
  if (!notion.dataSources?.retrieve) return collectionId;
  if (resolvedDataSourceId) return resolvedDataSourceId;

  try {
    await notion.dataSources.retrieve({ data_source_id: collectionId });
    resolvedDataSourceId = collectionId;
    return resolvedDataSourceId;
  } catch (error) {
    if (!isNotFoundError(error) || !notion.databases?.retrieve) throw error;
  }

  const database = await notion.databases.retrieve({ database_id: collectionId });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new Error(`No data source found for Notion database ${collectionId}`);
  }
  resolvedDataSourceId = dataSourceId;
  return resolvedDataSourceId;
}

async function queryAllPages(databaseId) {
  const notion = getNotionClient();
  if (!notion) throw new Error('Notion client is not configured');

  const pages = [];
  let startCursor;

  do {
    const response = notion.dataSources?.query
      ? await notion.dataSources.query({
          data_source_id: await resolveDataSourceId(databaseId),
          start_cursor: startCursor,
          page_size: 100,
          result_type: 'page'
        })
      : await notion.databases.query({
          database_id: databaseId,
          start_cursor: startCursor,
          page_size: 100
        });
    pages.push(...(response.results || []));
    startCursor = response.has_more ? response.next_cursor : undefined;
  } while (startCursor);

  return pages;
}

async function retrieveCollectionSchema(collectionId) {
  const notion = getNotionClient();
  if (!notion) throw new Error('Notion client is not configured');

  if (notion.dataSources?.retrieve) {
    return notion.dataSources.retrieve({ data_source_id: await resolveDataSourceId(collectionId) });
  }

  return notion.databases.retrieve({ database_id: collectionId });
}

async function buildCollectionParent(collectionId) {
  const notion = getNotionClient();
  if (notion?.dataSources?.query) {
    return { data_source_id: await resolveDataSourceId(collectionId) };
  }

  return { database_id: collectionId };
}

async function getAllClients() {
  if (!isNotionConfigured()) {
    throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be configured');
  }

  const { databaseId } = getNotionConfig();
  const pages = await queryAllPages(databaseId);
  return pages
    .filter(page => page.object === 'page' && !page.archived)
    .map((page, index) => notionPageToJob(page, index));
}

async function getClient(pageId) {
  if (!isNotionConfigured()) {
    throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be configured');
  }

  const notion = getNotionClient();
  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!page || page.archived) return null;
  return notionPageToJob(page, 0);
}

function buildNotionProperties(payload, schemaProperties = {}) {
  const properties = {};
  const setText = (aliases, value) => {
    if (value === undefined || value === null || value === '') return;
    const key = findPropertyKey(schemaProperties, aliases);
    if (!key) return;
    const type = schemaProperties[key]?.type;
    const text = String(value);
    if (type === 'title') properties[key] = { title: [{ text: { content: text } }] };
    else if (type === 'rich_text') properties[key] = { rich_text: [{ text: { content: text } }] };
    else if (type === 'phone_number') properties[key] = { phone_number: text };
    else if (type === 'email') properties[key] = { email: text };
    else if (type === 'url') properties[key] = { url: text };
  };
  const setSelect = (aliases, value) => {
    if (!value) return;
    const key = findPropertyKey(schemaProperties, aliases);
    if (!key || schemaProperties[key]?.type !== 'select') return;
    properties[key] = { select: { name: String(value) } };
  };
  const setCheckbox = (aliases, value) => {
    const key = findPropertyKey(schemaProperties, aliases);
    if (!key || schemaProperties[key]?.type !== 'checkbox') return;
    properties[key] = { checkbox: Boolean(value) };
  };

  setText(FIELD_ALIASES.fullName, payload.fullName);
  setText(FIELD_ALIASES.address, payload.address);
  setText(FIELD_ALIASES.phone, payload.phone);
  setText(FIELD_ALIASES.email, payload.email);
  setText(FIELD_ALIASES.lineId, payload.lineId);
  setText(FIELD_ALIASES.waterConcerns, payload.waterConcerns);
  setSelect(FIELD_ALIASES.packageHistory, payload.packageHistory);
  setSelect(FIELD_ALIASES.propertyType, payload.propertyType);
  setSelect(FIELD_ALIASES.source, payload.source);
  setSelect(FIELD_ALIASES.currentFilter, payload.currentFilter);
  setSelect(FIELD_ALIASES.stage, payload.stage);
  setSelect(FIELD_ALIASES.status, payload.status);
  setCheckbox(FIELD_ALIASES.consentSigned, payload.consentSigned);

  return properties;
}

async function createClient(payload = {}) {
  if (!isNotionConfigured()) {
    throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be configured');
  }

  const notion = getNotionClient();
  const { databaseId } = getNotionConfig();
  const database = await retrieveCollectionSchema(databaseId);
  const properties = buildNotionProperties(payload, database.properties || {});

  const page = await notion.pages.create({
    parent: await buildCollectionParent(databaseId),
    properties
  });

  return notionPageToJob(page, 0);
}

async function updateClient(pageId, payload = {}) {
  if (!isNotionConfigured()) {
    throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be configured');
  }

  const notion = getNotionClient();
  const { databaseId } = getNotionConfig();
  const database = await retrieveCollectionSchema(databaseId);
  const properties = buildNotionProperties(payload, database.properties || {});

  const page = await notion.pages.update({
    page_id: pageId,
    properties
  });

  return notionPageToJob(page, 0);
}

function getIntegrationStatus() {
  const { apiKey, databaseId } = getNotionConfig();
  return {
    configured: Boolean(apiKey && databaseId),
    hasApiKey: Boolean(apiKey),
    hasDatabaseId: Boolean(databaseId)
  };
}

module.exports = {
  getAllClients,
  getClient,
  createClient,
  updateClient,
  getIntegrationStatus
};
