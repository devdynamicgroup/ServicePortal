const path = require('path');
const dotenv = require('dotenv');

function loadDotEnv() {
  if (global.__SERVICE_PORTAL_ENV_LOADED__) return;
  const envPath = path.join(__dirname, '..', '.env');
  dotenv.config({ path: envPath, quiet: true });
  global.__SERVICE_PORTAL_ENV_LOADED__ = true;
}

loadDotEnv();

function getNotionConfig() {
  return {
    apiKey: process.env.NOTION_API_KEY || process.env.NOTION_TOKEN || '',
    databaseId: process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID || ''
  };
}

module.exports = { loadDotEnv, getNotionConfig };
