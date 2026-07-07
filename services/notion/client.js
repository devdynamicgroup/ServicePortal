const { Client } = require('@notionhq/client');
const { getNotionConfig } = require('../../config/env');

let notionClient = null;

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

module.exports = { getNotionClient, isNotionConfigured };
