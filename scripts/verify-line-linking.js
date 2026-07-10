#!/usr/bin/env node
/**
 * Verify linkLineUser still works with optional lineDisplayName.
 * Does not call LINE API or modify production data unless DRY_RUN=false.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const DRY_RUN = process.env.VERIFY_LINE_DRY_RUN !== 'false';

async function main() {
  const { linkLineUser } = require('../services/workflow-service');
  const { getFeedbackByToken } = require('../services/client-feedback');
  const { getClient } = require('../services/notion/clients');

  // Signature check: 3-parameter function with default
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services/workflow-service.js'), 'utf8');
  const hasDisplayNameParam = /async function linkLineUser\([^)]*lineDisplayName/.test(src);
  const savesDisplayName = src.includes('lineDisplayName: displayName');
  console.log(JSON.stringify({
    check: 'linkLineUser_signature',
    hasDisplayNameParam,
    savesDisplayName,
    ok: hasDisplayNameParam && savesDisplayName
  }, null, 2));

  if (DRY_RUN) {
    console.log(JSON.stringify({ check: 'linkLineUser_integration', skipped: true, reason: 'DRY_RUN (set VERIFY_LINE_DRY_RUN=false to run)' }, null, 2));
    return;
  }

  const token = process.argv[2] || 'fb-0001';
  const feedback = await getFeedbackByToken(token);
  if (!feedback?.clientPageId) {
    console.error(JSON.stringify({ ok: false, error: 'feedback token not found', token }));
    process.exit(1);
  }

  const before = await getClient(feedback.clientPageId);
  const testUserId = before?.line?.userId || 'Uverify000000000000000000000001';
  const result = await linkLineUser(token, testUserId, 'Verify Display Name');
  const after = await getClient(feedback.clientPageId);

  console.log(JSON.stringify({
    check: 'linkLineUser_integration',
    token,
    result,
    beforeLine: before?.line || null,
    afterLine: after?.line || null,
    displayNameSaved: after?.line?.displayName === 'Verify Display Name' || result.alreadyLinked
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
