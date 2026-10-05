/**
 * Save confirmation must come from a direct page read (pages.retrieve via
 * getClient), not the lagging list query. Offline: Notion calls are stubbed
 * on the clients module before case-creation-service loads.
 *
 * Run: node scripts/test-save-confirmation-direct-read.js
 */
'use strict';
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const clients = require(path.join(ROOT, 'services/notion/clients.js'));

const PAGE_ID = '3f09a92d-fb61-81e0-ada7-db7d92c0d21c';
const T1 = '2026-10-05T17:00:00.000Z';
const T2 = '2026-10-05T18:00:00.000Z';

const listCalls = { count: 0 };
clients.getAllClients = async () => {
  listCalls.count += 1;
  return [{ notionId: PAGE_ID, draft: { fields: { 'ci-line': 'oldlineid' } }, lastEditedTime: T1 }];
};
clients.updateClient = async () => ({ notionId: PAGE_ID, draft: { fields: { 'ci-line': 'newlineid' } }, lastEditedTime: T2 });
clients.getClient = async (id) => {
  assert.strictEqual(id, PAGE_ID);
  return { notionId: PAGE_ID, draft: { fields: { 'ci-line': 'newlineid' } }, lastEditedTime: T2 };
};

const workflowPath = require.resolve(path.join(ROOT, 'services/workflow-service.js'));
require.cache[workflowPath] = {
  id: workflowPath, filename: workflowPath, loaded: true,
  exports: { resolveJob: async () => ({ notionId: PAGE_ID }) }
};

const { submitCustomerPreassessment } = require(path.join(ROOT, 'services/case-creation-service.js'));

let passed = 0;
let failed = 0;
async function run(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok    ${name}`); }
  catch (e) { failed += 1; console.error(`  FAIL  ${name}: ${e.message}`); }
}

(async () => {
  await run('save confirmation returns the directly-read page, not the lagging list', async () => {
    const result = await submitCustomerPreassessment(PAGE_ID, {
      fields: { 'ci-fname': 'testOPline02', 'ci-lname': 'T.', 'ci-line': 'newlineid' }
    });
    assert.strictEqual(result.case.draft.fields['ci-line'], 'newlineid', 'confirmed ci-line is the saved value');
    assert.strictEqual(result.case.lastEditedTime, T2, 'confirmed lastEditedTime is the saved page freshness');
    assert.strictEqual(listCalls.count, 0, 'the lagging list query is not used for save confirmation');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
