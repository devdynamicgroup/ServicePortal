/**
 * Regression suite for the post-submit LINE connect payload (2026-09-03):
 * when "Send Result" runs against a Case that isn't LINE-linked yet, the
 * existing POST /api/cases/:id/send-result response must now also carry the
 * canonical LIFF connect URL + a matching QR, computed from the SAME
 * buildLiffBindUrl() the score poster and report banner already use -- no
 * new endpoint, no new token, no new binding mechanism.
 *
 * SCOPE: services/workflow-service.js:executeSendCaseResult() only.
 *   - Score engine: NOT imported, NOT exercised, NOT modified.
 *   - services/notion/clients and services/line-notifications mocked via
 *     require.cache substitution, same technique as
 *     scripts/test-send-result-via-line.js.
 *
 * Run: node scripts/test-line-connect-payload.js
 */
'use strict';
const path = require('path');

let passed = 0;
let failed = 0;
function assert(cond, msg, detail) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }
}

const ROOT = path.join(__dirname, '..');
const clientsPath = require.resolve(path.join(ROOT, 'services/notion/clients'));
const lineNotifyPath = require.resolve(path.join(ROOT, 'services/line-notifications'));

const db = new Map();

function makeJob(id, overrides = {}) {
  return {
    id,
    notionId: id,
    name: 'QA Connect-Payload Fixture',
    workflow: { status: 'completed', ...(overrides.workflow || {}) },
    status: 'in_progress',
    result: { waterScore: 82, publicReportToken: 'rpt-fixture', reportUrl: 'https://example.test/r/rpt-fixture' },
    notification: { status: 'not_sent' },
    feedback: { token: 'fb-connect-9x', status: 'not_sent', url: '' },
    line: { userId: '', linked: false },
    review: {},
    draft: { fields: {} },
    ...overrides
  };
}

const fakeClientsModule = {
  async getClient(notionId) {
    const job = db.get(notionId);
    if (!job) throw new Error('not found');
    return job;
  },
  async updateClient(notionId, patch) {
    const existing = db.get(notionId) || makeJob(notionId);
    const updated = { ...existing, notification: { ...existing.notification, ...(patch.notificationStatus ? { status: patch.notificationStatus } : {}) } };
    db.set(notionId, updated);
    return updated;
  },
  async findClientByFeedbackToken() { return null; },
  async findClientByReportToken() { return null; },
  async getAllClients() { return Array.from(db.values()); }
};
require.cache[clientsPath] = { id: clientsPath, filename: clientsPath, loaded: true, exports: fakeClientsModule };

const lineSendCalls = [];
const fakeLineNotifyModule = {
  async sendCaseResultNotification(job, opts) {
    lineSendCalls.push({ notionId: job.notionId, ...opts });
    return { ok: true, status: 'sent', messageId: `msg-${lineSendCalls.length}`, format: 'flex' };
  }
};
require.cache[lineNotifyPath] = { id: lineNotifyPath, filename: lineNotifyPath, loaded: true, exports: fakeLineNotifyModule };

async function main() {
  const { sendCaseResult } = require(path.join(ROOT, 'services/workflow-service'));
  const { buildLiffBindUrl } = require(path.join(ROOT, 'services/url-builder'));

  console.log('=== not LINE-linked -> connect payload present ===');
  {
    const id = '11111111-1111-1111-1111-111111111111';
    const job = makeJob(id);
    db.set(id, job);
    const result = await sendCaseResult(id);

    assert(result.ok === true, 'top-level ok:true even though no LINE send was attempted (unchanged behavior)');
    assert(result.line.status === 'skipped' && result.line.reason === 'no_line_user_id', 'unchanged skip reason (no regression to the existing signal the client already reads)');
    assert(lineSendCalls.length === 0, 'no LINE push attempted for an unlinked customer (no behavior change to the send path)');

    const expectedUrl = buildLiffBindUrl('fb-connect-9x');
    assert(result.line.connectUrl === expectedUrl, `connectUrl matches buildLiffBindUrl(job.feedback.token) exactly -- one canonical URL, not a second one (got ${result.line.connectUrl}, expected ${expectedUrl})`);
    assert(typeof result.line.connectQr === 'string' && result.line.connectQr.startsWith('data:image/png;base64,'), 'connectQr is a real inline PNG data URI, not a broken/missing image');
  }

  console.log('\n=== already LINE-linked -> no connect payload needed (untouched path) ===');
  {
    const id = '22222222-2222-2222-2222-222222222222';
    const job = makeJob(id, { line: { userId: 'Ureal123', linked: true } });
    db.set(id, job);
    const result = await sendCaseResult(id);
    assert(result.line.ok === true && result.line.status === 'sent', 'already-linked Case still sends normally, unaffected by this change');
    assert(result.line.connectUrl === undefined && result.line.connectQr === undefined, 'no connectUrl/connectQr clutter on the response when the customer is already linked -- the field only appears when actually needed');
  }

  console.log('\n=== missing feedback token -> never throws, just empty payload ===');
  {
    const id = '33333333-3333-3333-3333-333333333333';
    const job = makeJob(id, { feedback: { token: '', status: 'not_sent', url: '' } });
    db.set(id, job);
    const result = await sendCaseResult(id);
    assert(result.line.connectUrl === '' && result.line.connectQr === '', 'no feedbackToken on the Case -> empty strings, not a throw or an undefined crash downstream');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
