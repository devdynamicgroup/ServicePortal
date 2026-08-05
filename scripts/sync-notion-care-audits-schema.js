#!/usr/bin/env node
'use strict';

/**
 * Optional: print Care Audits schema expectations (no Notion writes unless --ensure).
 * M9.0 primary audit path is local files; Notion is optional.
 */

require('../config/env');

const {
  isCareAuditsDbConfigured,
  getCareAuditsDatabaseId,
  getCareLifecycleFlags
} = require('../services/care-lifecycle');

const DEFINITIONS = [
  { key: 'id', name: 'Audit ID', schema: { rich_text: {} } },
  { key: 'caseId', name: 'Case ID', schema: { rich_text: {} } },
  { key: 'customerId', name: 'Customer ID', schema: { rich_text: {} } },
  { key: 'eventType', name: 'Event Type', schema: { rich_text: {} } },
  { key: 'idempotencyKey', name: 'Idempotency Key', schema: { rich_text: {} } },
  { key: 'status', name: 'Status', schema: { rich_text: {} } },
  { key: 'destinationType', name: 'Destination Type', schema: { rich_text: {} } },
  { key: 'destinationIdHash', name: 'Destination Id Hash', schema: { rich_text: {} } },
  { key: 'templateVersion', name: 'Template Version', schema: { rich_text: {} } },
  { key: 'failureReason', name: 'Failure Reason', schema: { rich_text: {} } }
];

async function main() {
  const ensure = process.argv.includes('--ensure');
  console.log(JSON.stringify({
    configured: isCareAuditsDbConfigured(),
    databaseId: getCareAuditsDatabaseId() || null,
    flags: getCareLifecycleFlags(),
    ensureRequested: ensure,
    note: ensure
      ? 'Notion schema ensure not auto-applied in M9.0 — create DB manually from docs/M9.0_CARE_AUDIT_SCHEMA.md'
      : 'File audit works without Care Audits DB',
    definitions: DEFINITIONS
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
