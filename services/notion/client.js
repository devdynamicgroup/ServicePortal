const { Client } = require('@notionhq/client');
const { getNotionConfig } = require('../../config/env');

let notionClient = null;
let cachedDataSourceId = null;

function getNotionClient() {
  const { apiKey } = getNotionConfig();
  if (!apiKey) return null;
  if (!notionClient) {
    notionClient = new Client({ auth: apiKey });
  }
  return notionClient;
}

function isNotionConfigured() {
  const { apiKey, databaseId } = getNotionConfig();
  return Boolean(apiKey && databaseId);
}

/**
 * Notion API 2025-09-03 (SDK v5) moved properties/queries onto data sources.
 * A database can hold multiple data sources, so we resolve the one that holds
 * the client records (the data source with the richest schema) and cache it.
 * Can be overridden with NOTION_DATA_SOURCE_ID.
 */
async function resolveDataSourceId() {
  if (cachedDataSourceId) return cachedDataSourceId;

  const override = process.env.NOTION_DATA_SOURCE_ID;
  if (override) {
    cachedDataSourceId = override;
    return cachedDataSourceId;
  }

  const notion = getNotionClient();
  if (!notion) throw new Error('Notion client is not configured');

  const { databaseId } = getNotionConfig();
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSources = database.data_sources || [];

  if (!dataSources.length) {
    throw new Error('Notion database has no data sources');
  }

  if (dataSources.length === 1) {
    cachedDataSourceId = dataSources[0].id;
    return cachedDataSourceId;
  }

  let best = null;
  let bestCount = -1;
  for (const ds of dataSources) {
    try {
      const detail = await notion.dataSources.retrieve({ data_source_id: ds.id });
      const count = Object.keys(detail.properties || {}).length;
      if (count > bestCount) {
        bestCount = count;
        best = ds.id;
      }
    } catch (error) {
      console.warn('Could not inspect data source', ds.id, error.message);
    }
  }

  cachedDataSourceId = best || dataSources[0].id;
  return cachedDataSourceId;
}

async function getDataSourceSchema() {
  const notion = getNotionClient();
  const dataSourceId = await resolveDataSourceId();
  const detail = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  return { dataSourceId, properties: detail.properties || {} };
}

function resetDataSourceCache() {
  cachedDataSourceId = null;
}

module.exports = {
  getNotionClient,
  isNotionConfigured,
  resolveDataSourceId,
  getDataSourceSchema,
  resetDataSourceCache
};
