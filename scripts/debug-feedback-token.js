require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
require('../config/env');

const { getNotionClient, resolveDataSourceId } = require('../services/notion/client');
const { getFeedbackByToken, isClientFeedbackConfigured } = require('../services/client-feedback');
const { findPropertyKey, getPropertyValue } = require('../services/notion/props');
const { FIELD_ALIASES } = require('../services/notion/mapper');

const TOKEN = process.argv[2] || 'fb-0001';

async function searchClientsDb(token) {
  const notion = getNotionClient();
  const dataSourceId = await resolveDataSourceId();
  const detail = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = detail.properties || {};
  const key = findPropertyKey(properties, FIELD_ALIASES.feedbackToken);
  console.log('Clients DB dataSourceId:', dataSourceId);
  console.log('Clients DB feedbackToken property:', key, key ? properties[key]?.type : null);

  if (!key) {
    return { count: 0, matches: [], property: null };
  }

  const type = properties[key]?.type;
  const filter = type === 'title'
    ? { property: key, title: { equals: token } }
    : type === 'rich_text'
      ? { property: key, rich_text: { equals: token } }
      : null;

  if (!filter) {
    return { count: 0, matches: [], property: key, type };
  }

  const result = await notion.dataSources.query({ data_source_id: dataSourceId, filter, page_size: 10 });
  const matches = (result.results || []).map(page => ({
    pageId: page.id,
    name: getPropertyValue(page.properties, FIELD_ALIASES.fullName),
    token: getPropertyValue(page.properties, FIELD_ALIASES.feedbackToken)
  }));
  return { count: matches.length, matches, property: key, type };
}

async function searchFeedbackDb(token) {
  const configured = isClientFeedbackConfigured();
  const databaseId = process.env.NOTION_CLIENT_FEEDBACK_DATABASE_ID
    || process.env.NOTION_FEEDBACK_DATABASE_ID
    || '';
  console.log('Feedback DB configured:', configured, 'databaseId:', databaseId || '(none)');

  if (!configured) {
    return { count: 0, feedback: null, configured: false };
  }

  const feedback = await getFeedbackByToken(token);
  return {
    count: feedback ? 1 : 0,
    feedback,
    configured: true,
    databaseId
  };
}

async function main() {
  console.log('Searching for token:', TOKEN);
  const clients = await searchClientsDb(TOKEN);
  console.log('Clients DB result:', JSON.stringify(clients, null, 2));
  const feedback = await searchFeedbackDb(TOKEN);
  console.log('Feedback DB result:', JSON.stringify(feedback, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
