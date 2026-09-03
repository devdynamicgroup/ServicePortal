/**
 * Regression suite for the persistent LINE-binding lifecycle (2026-09-03):
 * binding a Case to a LINE User must happen once; every subsequent
 * "Send Result" must reuse that binding and never show a QR/re-bind prompt
 * again, regardless of how many times the Case is (re)sent as staff fills in
 * more data.
 *
 * This proves the lifecycle end to end using EXISTING functions only:
 *   - services/workflow-service.js:linkLineUser()      (the one binding authority)
 *   - services/workflow-service.js:sendCaseResult()     (delivery, reused as-is)
 *   - services/workflow-service.js:buildLineConnectPayload() (via executeSendCaseResult)
 * No new binding mechanism, no new token, no new Case-LINE mapping is
 * introduced anywhere in this test or the code it exercises.
 *
 * Verifies the "when linkLineUser() binds a Case, what sends the pending
 * result?" question directly: pendingAutoSend on linkLineUser()'s return
 * value is the existing signal api/liff-routes.js already uses to
 * auto-call sendCaseResult() right after a successful bind (see
 * scripts/test-liff-bind.js's "pendingAutoSend => sendCaseResult() called"
 * coverage) -- this file proves pendingAutoSend itself is computed
 * correctly for both the incomplete-Case and complete-Case cases, which is
 * the one part of that chain test-liff-bind.js does NOT cover (it mocks
 * linkLineUser's return value rather than exercising the real function).
 *
 * SCOPE: services/workflow-service.js only.
 *   - Score engine: NOT imported, NOT exercised, NOT modified.
 *   - services/notion/clients mocked via require.cache substitution.
 *   - services/client-feedback runs FOR REAL in its unconfigured/local
 *     fallback mode (confirmed by reading the file: falls back to
 *     findClientByFeedbackToken() on the mocked clients module -- no
 *     network), same precedent as scripts/test-send-result-via-line.js.
 *   - services/line-notifications mocked (no real LINE push).
 *
 * Run: node scripts/test-line-binding-lifecycle.js
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
    name: 'QA Lifecycle Fixture',
    workflow: { status: 'service_in_progress', ...(overrides.workflow || {}) }, // "Case incomplete" by default
    status: 'in_progress',
    result: { waterScore: null, publicReportToken: '', reportUrl: '' },
    notification: { status: 'not_sent', ...(overrides.notification || {}) },
    feedback: { token: overrides.feedbackToken || 'fb-lifecycle', status: 'not_sent', url: '' },
    line: { userId: '', linked: false, ...(overrides.line || {}) },
    review: {},
    draft: { fields: {} },
    ...overrides
  };
}

const updateCalls = [];
const fakeClientsModule = {
  async getClient(notionId) {
    const job = db.get(notionId);
    if (!job) throw new Error('not found');
    return job;
  },
  async updateClient(notionId, patch) {
    updateCalls.push({ notionId, patch });
    const existing = db.get(notionId) || makeJob(notionId);
    const updated = {
      ...existing,
      line: {
        ...existing.line,
        ...(patch.lineUserId !== undefined ? { userId: patch.lineUserId } : {}),
        ...(patch.lineDisplayName !== undefined ? { displayName: patch.lineDisplayName } : {}),
        ...(patch.lineLinked !== undefined ? { linked: patch.lineLinked } : {}),
        ...(patch.lineLinkedAt !== undefined ? { linkedAt: patch.lineLinkedAt } : {})
      },
      workflow: {
        ...existing.workflow,
        ...(patch.caseWorkflowStatus ? { status: patch.caseWorkflowStatus } : {})
      },
      notification: {
        ...existing.notification,
        ...(patch.notificationStatus ? { status: patch.notificationStatus } : {})
      }
    };
    db.set(notionId, updated);
    return updated;
  },
  async findClientByFeedbackToken(token) {
    const normalized = String(token || '').trim().toLowerCase();
    for (const job of db.values()) {
      if (String(job.feedback?.token || '').toLowerCase() === normalized) {
        return { clientPageId: job.notionId, tokenProperty: 'feedbackToken' };
      }
    }
    return null;
  },
  async findClientByReportToken() { return null; },
  async getAllClients() { return Array.from(db.values()); }
};
require.cache[clientsPath] = { id: clientsPath, filename: clientsPath, loaded: true, exports: fakeClientsModule };

const lineSendCalls = [];
const fakeLineNotifyModule = {
  async sendCaseResultNotification(job, opts) {
    lineSendCalls.push({ notionId: job.notionId, lineUserId: job.line?.userId, ...opts });
    return { ok: true, status: 'sent', messageId: `msg-${lineSendCalls.length}`, format: 'flex' };
  }
};
require.cache[lineNotifyPath] = { id: lineNotifyPath, filename: lineNotifyPath, loaded: true, exports: fakeLineNotifyModule };

async function main() {
  const { sendCaseResult, linkLineUser } = require(path.join(ROOT, 'services/workflow-service'));
  const { buildLiffBindUrl } = require(path.join(ROOT, 'services/url-builder'));

  // ---- Test A: first send, unlinked, Case incomplete ----
  console.log('=== Test A: first send, unlinked, Case incomplete -> connection payload available ===');
  const idA = '11111111-0000-0000-0000-00000000000a';
  db.set(idA, makeJob(idA, { feedbackToken: 'fb-case-a' }));
  {
    const result = await sendCaseResult(idA);
    assert(result.ok === true, 'send succeeds at the top level even though nothing was pushed yet');
    assert(result.line.reason === 'no_line_user_id', 'unlinked -> the existing skip signal, unchanged');
    assert(result.line.connectUrl === buildLiffBindUrl('fb-case-a'), 'connectUrl is the one canonical LIFF URL for this Case');
    assert(typeof result.line.connectQr === 'string' && result.line.connectQr.length > 0, 'connectQr present so the customer can bind');
    assert(lineSendCalls.length === 0, 'no LINE push happened yet -- nothing to push to');
  }

  // ---- Test C: customer scans while Case is still incomplete ----
  console.log('\n=== Test C: customer binds LINE while Case is incomplete -> bound, but told to wait ===');
  {
    const linkResult = await linkLineUser('fb-case-a', 'Ucustomer-a', 'Somchai A');
    assert(linkResult.linked === true, 'binding succeeds');
    assert(linkResult.pendingAutoSend === false, 'Case workflow status is not yet "completed" -> pendingAutoSend is false, so nothing auto-sends (matches the LIFF success page\'s default "we\'ll send it via LINE when ready" wait message)');

    const persisted = db.get(idA);
    assert(persisted.line.userId === 'Ucustomer-a', 'lineUserId persisted on the Case record');
    assert(persisted.workflow.status === 'service_in_progress', 'binding does NOT fabricate completeness -- workflow status is untouched (was already past "line_linked" in the state order, so it is preserved, not downgraded or upgraded)');
  }

  // ---- Test D: staff completes the remaining measurements later ----
  console.log('\n=== Test D: staff finishes the Case after binding already happened ===');
  {
    const job = db.get(idA);
    db.set(idA, {
      ...job,
      workflow: { ...job.workflow, status: 'completed' },
      result: { waterScore: 88, publicReportToken: 'rpt-a', reportUrl: 'https://example.test/r/rpt-a' }
    });
    assert(db.get(idA).workflow.status === 'completed', 'Case now complete (simulates the existing, unmodified completeJob()/closeCase() flow -- out of scope here)');
  }

  // ---- Test E: second "Send Result" on an already-linked, now-complete Case ----
  console.log('\n=== Test E: second send on already-linked Case -> direct delivery, no QR, no rebinding ===');
  {
    const result = await sendCaseResult(idA);
    assert(result.line.ok === true && result.line.status === 'sent', 'the completed Case is delivered directly through the existing send path');
    assert(result.line.connectUrl === undefined && result.line.connectQr === undefined, 'no connectUrl/connectQr -- no QR is shown for an already-bound Case');
    assert(lineSendCalls.length === 1 && lineSendCalls[0].lineUserId === 'Ucustomer-a', 'delivered to the SAME lineUserId established during the one bind -- no new binding, no different user');
  }

  // ---- Test F: repeated second sends stay idempotent, no re-binding, no new QR ----
  console.log('\n=== Test F: repeated sends on the same bound Case -> stable, no drift ===');
  {
    const before = db.get(idA).line.userId;
    const result = await sendCaseResult(idA, { force: true });
    assert(result.line.connectUrl === undefined, 'still no QR on a repeat send');
    assert(db.get(idA).line.userId === before, 'lineUserId never changes across repeat sends');
    assert(lineSendCalls.length === 2, 'each repeat send delivers again (force resend), but through the SAME established binding -- not a new one');
  }

  // ---- Test B: first send, unlinked, Case ALREADY complete at bind time ----
  console.log('\n=== Test B: first send unlinked while Case is already complete -> bind triggers immediate delivery ===');
  const idB = '11111111-0000-0000-0000-00000000000b';
  db.set(idB, makeJob(idB, { feedbackToken: 'fb-case-b', workflow: { status: 'completed' }, result: { waterScore: 91, publicReportToken: 'rpt-b', reportUrl: 'https://example.test/r/rpt-b' } }));
  {
    const sendResult = await sendCaseResult(idB);
    assert(sendResult.line.reason === 'no_line_user_id', 'still unlinked -> connection payload shown first, exactly like the incomplete case (Case completeness never skips the binding step)');

    const linkResult = await linkLineUser('fb-case-b', 'Ucustomer-b', 'Somchai B');
    assert(linkResult.pendingAutoSend === true, 'Case was ALREADY complete + never sent at bind time -> pendingAutoSend true, the existing trigger api/liff-routes.js uses to call sendCaseResult() immediately so the customer is not made to wait unnecessarily');
  }

  // ---- Test G: submit failure never shows a connection prompt ----
  console.log('\n=== Test G: failed send (unknown Case) -> no QR, no binding prompt, no false success ===');
  {
    let threw = null;
    try { await sendCaseResult('99999999-9999-9999-9999-999999999999'); } catch (e) { threw = e; }
    assert(threw && threw.statusCode === 404, 'unknown Case throws (404), not a fabricated success/connection payload');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
