#!/usr/bin/env node
'use strict';

/**
 * Ensure Score Publication Ledger properties on an ops-created Notion database.
 * Does not create the database. Does not change scoring.
 *
 * Usage: node scripts/sync-notion-score-publications-schema.js
 */
require('../config/env');

const {
  isScorePublicationsConfigured,
  getScorePublicationsDatabaseId,
  ensureScorePublicationsSchema,
  SCHEMA
} = require('../services/notion/score-publications');

async function main() {
  if (!isScorePublicationsConfigured()) {
    console.log(JSON.stringify({
      ok: false,
      configured: false,
      definitions: SCHEMA.map((item) => item.name),
      note: 'Set NOTION_SCORE_PUBLICATIONS_DATABASE_ID after ops creates and shares the database'
    }, null, 2));
    process.exit(1);
  }

  const result = await ensureScorePublicationsSchema();
  console.log(JSON.stringify({
    ok: true,
    configured: true,
    databaseId: getScorePublicationsDatabaseId(),
    dataSourceId: result.dataSourceId,
    created: result.created
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
