/**
 * Phase 2B (fb-xxxx token lifecycle hardening) coverage for
 * services/workflow-service.js:linkLineUser()'s new lifecycle gate --
 * approved policy A3 (Case-lifecycle-bound expiry, 30-day grace from
 * notification.resultSentAt) + B2 (deny redemption on a cancelled Case,
 * via the existing isTerminalCaseStatus() predicate) + C1 (grandfather
 * every Case created before the Phase 2B rollout instant).
 *
 * Same stubbing technique as scripts/test-line-link-ownership.js and
 * scripts/test-line-link-audit.js (monkeypatch before require). Time is
 * injected via linkLineUser()'s `context.now` -- no sleep(), no real
 * waiting, deterministic down to the millisecond for the boundary test.
 *
 * Run: node scripts/test-line-token-lifecycle.js
 */
'use strict';
const assert = require('assert');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
async function check(fn, name) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }

// ---- monkeypatch dependencies BEFORE requiring workflow-service.js ----
const notionClients = require('../services/notion/clients');
const clientFeedback = require('../services/client-feedback');
const dualWrite = require('../services/migration/dual-write');
const observability = require('../services/observability');

let store = null;
let emittedEvents = [];
let nextLogShouldThrow = false;

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

notionClients.getClient = async () => clone(store);

notionClients.updateClient = async (pageId, patch) => {
  store.line = {
    ...store.line,
    userId: patch.lineUserId !== undefined ? patch.lineUserId : store.line.userId,
    linked: patch.lineLinked !== undefined ? patch.lineLinked : store.line.linked,
    displayName: patch.lineDisplayName !== undefined ? patch.lineDisplayName : store.line.displayName,
    linkedAt: patch.lineLinkedAt !== undefined ? patch.lineLinkedAt : store.line.linkedAt
  };
  if (patch.caseWorkflowStatus !== undefined) {
    store.workflow = { ...store.workflow, status: patch.caseWorkflowStatus };
  }
  return clone(store);
};

clientFeedback.getFeedbackByToken = async (token) => {
  if (!store || token !== store.feedback.token) return null;
  return { clientPageId: store.notionId, clientName: store.name, feedbackToken: store.feedback.token };
};

dualWrite.dualWriteAfterCaseSuccess = async () => ({ status: 'failed', customerId: null, caseId: null, conflicts: [], error: 'stubbed' });

observability.logLineLifecycle = (level, event, fields) => {
  if (nextLogShouldThrow) {
    nextLogShouldThrow = false;
    throw new Error('simulated audit logger failure');
  }
  emittedEvents.push({ level, event, fields });
};

const { linkLineUser } = require('../services/workflow-service');

const ROLLOUT = new Date('2026-10-05T00:00:00.000Z');
const GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const AFTER_ROLLOUT = new Date(ROLLOUT.getTime() + 24 * 60 * 60 * 1000).toISOString(); // 1 day after rollout -> a "new" Case
const BEFORE_ROLLOUT = new Date(ROLLOUT.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 1 day before rollout -> a "legacy" Case

function freshCase(overrides = {}) {
  return {
    id: 'case-lifecycle-1',
    notionId: 'case-lifecycle-1',
    name: 'Lifecycle Test Client',
    createdTime: AFTER_ROLLOUT,
    line: { userId: '', linked: false, displayName: '', linkedAt: null },
    workflow: { status: 'result_sent', serviceStartedAt: null, serviceCompletedAt: null, closedAt: null },
    result: { waterScore: 90, reportUrl: '', publicReportToken: '' },
    feedback: { token: 'fb-cycle', url: '', status: 'not_sent' },
    review: { url: '', status: 'not_requested' },
    notification: { status: 'sent', resultSentAt: null, lineMessageId: '', lastError: '' },
    customer: { id: '', pageId: '' },
    ...overrides
  };
}

function reset() { emittedEvents = []; nextLogShouldThrow = false; }

(async () => {
  console.log('=== Test 1: active Case (result not yet sent) -> LINK_SUCCESS regardless of age ===');
  await check(async () => {
    // Phase 2C: each test uses its own token so the new per-tokenFingerprint
    // rate limiter (10 attempts/10min, shared across this whole process run)
    // never collides between otherwise-unrelated lifecycle scenarios.
    store = freshCase({ feedback: { token: 'fb-cycle-t1', url: '', status: 'not_sent' }, notification: { status: 'not_sent', resultSentAt: null } });
    reset();
    const result = await linkLineUser('fb-cycle-t1', 'U_ACTIVE', '', { source: 'chat' });
    assert.strictEqual(result.linked, true, 'a Case still in its active lifecycle (no resultSentAt yet) must never be treated as expired');
    assert.strictEqual(emittedEvents[0].event, 'LINK_SUCCESS');
  }, 'resultSentAt absent => still within active lifecycle, token valid');

  console.log('\n=== Test 2: same-user retry within grace -> LINK_IDEMPOTENT ===');
  await check(async () => {
    const resultSentAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago, well within 30
    store = freshCase({
      feedback: { token: 'fb-cycle-t2', url: '', status: 'not_sent' },
      line: { userId: 'U_A', linked: true, displayName: 'Alice', linkedAt: '2026-10-06T00:00:00.000Z' },
      notification: { status: 'sent', resultSentAt }
    });
    reset();
    const result = await linkLineUser('fb-cycle-t2', 'U_A', 'Alice', { source: 'chat' });
    assert.strictEqual(result.alreadyLinked, true);
    assert.strictEqual(emittedEvents[0].event, 'LINK_IDEMPOTENT');
  }, 'within grace + same user => idempotent, unchanged from Phase 2A');

  console.log('\n=== Test 3: different-user retry within grace -> LINK_REJECTED_IDENTITY, owner unchanged ===');
  await check(async () => {
    const resultSentAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    store = freshCase({
      feedback: { token: 'fb-cycle-t3', url: '', status: 'not_sent' },
      line: { userId: 'U_A', linked: true, displayName: 'Alice', linkedAt: '2026-10-06T00:00:00.000Z' },
      notification: { status: 'sent', resultSentAt }
    });
    reset();
    const result = await linkLineUser('fb-cycle-t3', 'U_B', 'Bob', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'linked_to_another_user');
    assert.strictEqual(store.line.userId, 'U_A', 'owner unchanged');
    assert.strictEqual(emittedEvents[0].event, 'LINK_REJECTED_IDENTITY');
  }, 'within grace + different user => rejected, exactly like Phase 0/2A');

  console.log('\n=== Test 4: expiry boundary (30-day grace), -1ms / exact / +1ms ===');
  await check(async () => {
    const now = new Date('2026-12-01T00:00:00.000Z');
    const resultSentAt = new Date(now.getTime() - GRACE_MS);

    // boundary - 1ms: still valid
    store = freshCase({ feedback: { token: 'fb-cycle-t4', url: '', status: 'not_sent' }, notification: { status: 'sent', resultSentAt: new Date(resultSentAt.getTime() + 1).toISOString() } });
    reset();
    let result = await linkLineUser('fb-cycle-t4', 'U_BOUNDARY', '', { source: 'chat', now });
    assert.strictEqual(result.linked, true, 'one ms before the 30-day boundary must still be valid');

    // exact boundary instant: "now > expiry" is false when equal, so still valid
    store = freshCase({ feedback: { token: 'fb-cycle-t4', url: '', status: 'not_sent' }, notification: { status: 'sent', resultSentAt: resultSentAt.toISOString() } });
    reset();
    result = await linkLineUser('fb-cycle-t4', 'U_BOUNDARY', '', { source: 'chat', now });
    assert.strictEqual(result.linked, true, 'the exact boundary instant must still be valid (expiry is exclusive, not inclusive)');

    // boundary + 1ms: expired
    store = freshCase({ feedback: { token: 'fb-cycle-t4', url: '', status: 'not_sent' }, notification: { status: 'sent', resultSentAt: new Date(resultSentAt.getTime() - 1).toISOString() } });
    reset();
    result = await linkLineUser('fb-cycle-t4', 'U_BOUNDARY', '', { source: 'chat', now });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'token_expired');
  }, 'deterministic 30-day boundary: -1ms valid, exact valid, +1ms expired');

  console.log('\n=== Test 5: expired token -> TOKEN_EXPIRED, zero mutation ===');
  await check(async () => {
    const resultSentAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(); // 31 days ago, past grace
    store = freshCase({ feedback: { token: 'fb-cycle-t5', url: '', status: 'not_sent' }, notification: { status: 'sent', resultSentAt } });
    reset();
    const result = await linkLineUser('fb-cycle-t5', 'U_LATE', 'Late User', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'token_expired');
    assert.strictEqual(store.line.userId, '', 'no lineUserId mutation on expiry');
    assert.strictEqual(store.line.linkedAt, null, 'no lineLinkedAt mutation on expiry');
    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].event, 'TOKEN_EXPIRED');
    assert.strictEqual(emittedEvents[0].fields.success, false);
  }, 'past 30-day grace => TOKEN_EXPIRED, no Case mutation of any kind');

  console.log('\n=== Test 6: cancelled Case -> rejected, zero mutation ===');
  await check(async () => {
    store = freshCase({ feedback: { token: 'fb-cycle-t6', url: '', status: 'not_sent' }, workflow: { status: 'cancelled' }, notification: { status: 'not_sent', resultSentAt: null } });
    reset();
    const result = await linkLineUser('fb-cycle-t6', 'U_CANCELLED_ATTEMPT', '', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'case_cancelled');
    assert.strictEqual(store.line.userId, '', 'no mutation on a cancelled Case');
    assert.strictEqual(emittedEvents[0].event, 'TOKEN_CANCELLED');
  }, 'cancelled Case rejects redemption even though the token itself has not expired');

  console.log('\n=== Test 7: grandfathered legacy Case (created before rollout) -> still redeemable past 30 days ===');
  await check(async () => {
    const resultSentAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(); // over a year ago
    store = freshCase({ feedback: { token: 'fb-cycle-t7', url: '', status: 'not_sent' }, createdTime: BEFORE_ROLLOUT, notification: { status: 'sent', resultSentAt } });
    reset();
    const result = await linkLineUser('fb-cycle-t7', 'U_LEGACY', 'Legacy Customer', { source: 'chat' });
    assert.strictEqual(result.linked, true, 'C1: a Case created before Phase 2B must never be retroactively expired, no matter how old resultSentAt is');
    assert.strictEqual(emittedEvents[0].event, 'LINK_SUCCESS');
  }, 'Case created before Phase 2B rollout is grandfathered: no expiry ever applies');

  console.log('\n=== Test 8: grandfathered legacy Case still enforces identity protection ===');
  await check(async () => {
    const resultSentAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    store = freshCase({
      feedback: { token: 'fb-cycle-t8', url: '', status: 'not_sent' },
      createdTime: BEFORE_ROLLOUT,
      line: { userId: 'U_A', linked: true, displayName: 'Alice', linkedAt: '2025-01-01T00:00:00.000Z' },
      notification: { status: 'sent', resultSentAt }
    });
    reset();
    const result = await linkLineUser('fb-cycle-t8', 'U_B', 'Bob', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'linked_to_another_user');
    assert.strictEqual(store.line.userId, 'U_A', 'grandfathering affects expiry only, never the identity guard');
  }, 'grandfathering does not weaken different-user rejection');

  console.log('\n=== Test 9: audit logger throws -> every lifecycle outcome is unchanged ===');
  await check(async () => {
    // valid token still links
    store = freshCase({ feedback: { token: 'fb-cycle-t9a', url: '', status: 'not_sent' }, notification: { status: 'not_sent', resultSentAt: null } });
    reset();
    nextLogShouldThrow = true;
    let result = await linkLineUser('fb-cycle-t9a', 'U_R1', '', { source: 'chat' });
    assert.strictEqual(result.linked, true);

    // expired token still rejects
    const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    store = freshCase({ feedback: { token: 'fb-cycle-t9b', url: '', status: 'not_sent' }, notification: { status: 'sent', resultSentAt: expiredAt } });
    reset();
    nextLogShouldThrow = true;
    result = await linkLineUser('fb-cycle-t9b', 'U_R2', '', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'token_expired');

    // cancelled still rejects
    store = freshCase({ feedback: { token: 'fb-cycle-t9c', url: '', status: 'not_sent' }, workflow: { status: 'cancelled' } });
    reset();
    nextLogShouldThrow = true;
    result = await linkLineUser('fb-cycle-t9c', 'U_R3', '', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'case_cancelled');

    // wrong identity still rejects
    store = freshCase({ feedback: { token: 'fb-cycle-t9d', url: '', status: 'not_sent' }, line: { userId: 'U_A', linked: true, displayName: 'Alice', linkedAt: '2026-10-06T00:00:00.000Z' }, notification: { status: 'not_sent', resultSentAt: null } });
    reset();
    nextLogShouldThrow = true;
    result = await linkLineUser('fb-cycle-t9d', 'U_B', '', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'linked_to_another_user');
  }, 'audit isolation holds for every new Phase 2B outcome, not just Phase 2A ones');

  console.log('\n=== Test 10: no raw token in any emitted log field ===');
  await check(async () => {
    const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    store = freshCase({ feedback: { token: 'fb-raw-secret-check', url: '', status: 'not_sent' }, notification: { status: 'sent', resultSentAt: expiredAt } });
    reset();
    await linkLineUser('fb-raw-secret-check', 'U_X', '', { source: 'chat' });
    const text = JSON.stringify(emittedEvents);
    assert.ok(!text.includes('fb-raw-secret-check'), 'raw token must never appear in an expiry-rejection log line either');
    assert.ok(emittedEvents[0].fields.extra.tokenFingerprint, 'fingerprint still present');
  }, 'TOKEN_EXPIRED events never leak the raw token, same contract as Phase 2A');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
