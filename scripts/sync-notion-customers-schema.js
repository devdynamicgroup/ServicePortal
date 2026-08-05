#!/usr/bin/env node
'use strict';

/**
 * Additive schema sync for Customers DB only.
 * Does not modify Clients/Case DB properties.
 *
 * Usage: node scripts/sync-notion-customers-schema.js
 * Requires: NOTION_API_KEY, NOTION_CUSTOMERS_DATABASE_ID
 */

require('../config/env');

const { ensureCustomersSchema } = require('../services/customer-domain');
const { isCustomersDbConfigured } = require('../services/customer-domain/config');

async function main() {
  if (!isCustomersDbConfigured()) {
    console.error('NOTION_CUSTOMERS_DATABASE_ID (and NOTION_API_KEY) are required');
    process.exit(1);
  }

  const result = await ensureCustomersSchema();
  console.log(JSON.stringify({
    ok: result.status.ok,
    databaseId: result.databaseId,
    dataSourceId: result.dataSourceId,
    created: result.created,
    missingRequired: result.status.missingRequired
  }, null, 2));

  process.exit(result.status.ok ? 0 : 2);
}

main().catch(error => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
