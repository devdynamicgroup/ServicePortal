/**
 * Phase 2A (LINE linking audit) coverage for
 * services/workflow-service.js:linkLineUser()'s new, additive audit
 * emission -- added alongside the existing wrong-user ownership guard
 * tested by scripts/test-line-link-ownership.js (same stubbing technique,
 * reused here rather than duplicated into that file, since this file's
 * subject is the audit layer, not the ownership guard itself).
 *
 * Proves, against the REAL linkLineUser():
 *   1. First valid redemption (chat)  -> LINK_SUCCESS, source=chat
 *   2. First valid redemption (liff)  -> LINK_SUCCESS, source=liff
 *   3. Same-user retry                -> LINK_IDEMPOTENT
 *   4. Different-user retry           -> LINK_REJECTED_IDENTITY
 *   5. Unknown token                  -> TOKEN_NOT_FOUND
 *   6. Audit logger throws            -> linking result is UNCHANGED
 *      (both on a success path and a reject path) -- the one requirement
 *      that actually matters for Phase 2A: observability must never become
 *      a second point of failure for the real linking decision.
 *
 * Also proves the token-fingerprint contract: same token -> same
 * fingerprint, different token -> different fingerprint, and that no log
 * line ever contains the raw `fb-xxxx` token or any LINE credential.
 *
 * Run: node scripts/test-line-link-audit.js
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

// Capture every audit emission exactly as linkLineUser() produces it, and
// let a single test flip on a simulated logger failure to prove isolation.
observability.logLineLifecycle = (level, event, fields) => {
  if (nextLogShouldThrow) {
    nextLogShouldThrow = false; // one-shot, like a transient logging-infra blip
    throw new Error('simulated audit logger failure');
  }
  emittedEvents.push({ level, event, fields });
};

const { linkLineUser } = require('../services/workflow-service');

function freshCase(overrides = {}) {
  return {
    id: 'case-audit-1',
    notionId: 'case-audit-1',
    name: 'Audit Test Client',
    line: { userId: '', linked: false, displayName: '', linkedAt: null },
    workflow: { status: 'scheduled', serviceStartedAt: null, serviceCompletedAt: null, closedAt: null },
    result: { waterScore: null, reportUrl: '', publicReportToken: '' },
    feedback: { token: 'fb-audit-test', url: 'https://serviceportal.onrender.com/f/fb-audit-test', status: 'not_sent' },
    review: { url: '', status: 'not_requested' },
    notification: { status: 'not_sent' },
    customer: { id: '', pageId: '' },
    ...overrides
  };
}

function reset() { emittedEvents = []; nextLogShouldThrow = false; }

function allLoggedText() {
  return JSON.stringify(emittedEvents);
}

(async () => {
  console.log('=== Test 1: first valid redemption via chat -> LINK_SUCCESS, source=chat ===');
  await check(async () => {
    store = freshCase();
    reset();
    const result = await linkLineUser('fb-audit-test', 'U_CHAT', 'Chat User', { source: 'chat', correlationId: 'corr-chat-1' });
    assert.strictEqual(result.linked, true);
    assert.strictEqual(emittedEvents.length, 1);
    const e = emittedEvents[0];
    assert.strictEqual(e.event, 'LINK_SUCCESS');
    assert.strictEqual(e.fields.caseId, 'case-audit-1');
    assert.strictEqual(e.fields.lineUserId, 'U_CHAT');
    assert.strictEqual(e.fields.extra.source, 'chat');
    assert.strictEqual(e.fields.correlationId, 'corr-chat-1', 'caller-supplied correlationId is reused, not regenerated');
    assert.ok(e.fields.extra.tokenFingerprint, 'fingerprint present');
  }, 'chat redemption emits exactly one LINK_SUCCESS with source=chat');

  console.log('\n=== Test 2: first valid redemption via liff -> LINK_SUCCESS, source=liff ===');
  await check(async () => {
    store = freshCase({ feedback: { token: 'fb-audit-liff', url: '', status: 'not_sent' } });
    reset();
    const result = await linkLineUser('fb-audit-liff', 'U_LIFF', 'Liff User', { source: 'liff' });
    assert.strictEqual(result.linked, true);
    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].event, 'LINK_SUCCESS');
    assert.strictEqual(emittedEvents[0].fields.extra.source, 'liff');
  }, 'liff redemption emits exactly one LINK_SUCCESS with source=liff');

  console.log('\n=== Test 3: same-user retry -> LINK_IDEMPOTENT ===');
  await check(async () => {
    store = freshCase({ line: { userId: 'U_A', linked: true, displayName: 'Alice', linkedAt: '2026-01-01T00:00:00.000Z' } });
    reset();
    const result = await linkLineUser('fb-audit-test', 'U_A', 'Alice', { source: 'chat' });
    assert.strictEqual(result.alreadyLinked, true);
    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].event, 'LINK_IDEMPOTENT');
    assert.strictEqual(emittedEvents[0].fields.success, true);
  }, 'same-user replay emits exactly one LINK_IDEMPOTENT');

  console.log('\n=== Test 4: different-user retry -> LINK_REJECTED_IDENTITY ===');
  await check(async () => {
    store = freshCase({ line: { userId: 'U_A', linked: true, displayName: 'Alice', linkedAt: '2026-01-01T00:00:00.000Z' } });
    reset();
    const result = await linkLineUser('fb-audit-test', 'U_B', 'Bob', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'linked_to_another_user');
    assert.strictEqual(emittedEvents.length, 1);
    const e = emittedEvents[0];
    assert.strictEqual(e.event, 'LINK_REJECTED_IDENTITY');
    assert.strictEqual(e.fields.success, false);
    assert.strictEqual(e.fields.lineUserId, 'U_B', 'logs the identity that was attempting the bind');
    assert.strictEqual(e.fields.extra.existingLineUserId, 'U_A', 'logs the identity that already owns the Case, for incident reconstruction');
  }, 'wrong-user attempt emits exactly one LINK_REJECTED_IDENTITY with both identities');

  console.log('\n=== Test 5: unknown token -> TOKEN_NOT_FOUND ===');
  await check(async () => {
    store = freshCase();
    reset();
    const result = await linkLineUser('fb-does-not-exist', 'U_X', '', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'feedback_not_found');
    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].event, 'TOKEN_NOT_FOUND');
    assert.strictEqual(emittedEvents[0].fields.caseId, null, 'no Case to attribute when the token itself is unresolvable');
  }, 'unknown token emits exactly one TOKEN_NOT_FOUND with caseId=null');

  console.log('\n=== Test 6a: audit logger throws on a SUCCESS path -> linking result unchanged ===');
  await check(async () => {
    store = freshCase({ feedback: { token: 'fb-audit-throw-a', url: '', status: 'not_sent' } });
    reset();
    nextLogShouldThrow = true;
    const result = await linkLineUser('fb-audit-throw-a', 'U_RESILIENT', 'Resilient', { source: 'chat' });
    assert.strictEqual(result.linked, true, 'a thrown audit logger must not turn a successful bind into a failure');
    assert.strictEqual(store.line.userId, 'U_RESILIENT', 'the Case write still happened despite the audit failure');
  }, 'audit failure on the success path does not alter the linking outcome');

  console.log('\n=== Test 6b: audit logger throws on a REJECT path -> rejection still happens correctly ===');
  await check(async () => {
    store = freshCase({ line: { userId: 'U_A', linked: true, displayName: 'Alice', linkedAt: '2026-01-01T00:00:00.000Z' } });
    reset();
    nextLogShouldThrow = true;
    const result = await linkLineUser('fb-audit-test', 'U_B', 'Bob', { source: 'chat' });
    assert.strictEqual(result.linked, false, 'audit failure must not accidentally let a wrong-user attempt succeed');
    assert.strictEqual(result.reason, 'linked_to_another_user');
    assert.strictEqual(store.line.userId, 'U_A', 'original owner is still intact');
  }, 'audit failure on the reject path does not weaken the security guard');

  console.log('\n=== Test 7: token fingerprint contract ===');
  await check(async () => {
    store = freshCase({ feedback: { token: 'fb-fingerprint-same', url: '', status: 'not_sent' } });
    reset();
    await linkLineUser('fb-fingerprint-same', 'U_1', '', { source: 'chat' });
    const fp1 = emittedEvents[0].fields.extra.tokenFingerprint;

    store = freshCase({ feedback: { token: 'fb-fingerprint-same', url: '', status: 'not_sent' } });
    reset();
    await linkLineUser('fb-fingerprint-same', 'U_2', '', { source: 'chat' });
    const fp2 = emittedEvents[0].fields.extra.tokenFingerprint;
    assert.strictEqual(fp1, fp2, 'same token must always produce the same fingerprint');

    store = freshCase({ feedback: { token: 'fb-fingerprint-diff', url: '', status: 'not_sent' } });
    reset();
    await linkLineUser('fb-fingerprint-diff', 'U_3', '', { source: 'chat' });
    const fp3 = emittedEvents[0].fields.extra.tokenFingerprint;
    assert.notStrictEqual(fp1, fp3, 'different tokens must produce different fingerprints');
    assert.ok(!fp1.includes('fingerprint-same'), 'fingerprint must not contain any raw token substring');
  }, 'fingerprint is deterministic per-token, distinct across tokens, and non-reversible');

  console.log('\n=== Test 8: no raw token or credential ever appears in any emitted log field ===');
  await check(async () => {
    store = freshCase({ feedback: { token: 'fb-secret-raw-value', url: '', status: 'not_sent' } });
    reset();
    await linkLineUser('fb-secret-raw-value', 'U_SECRET', 'Secret', { source: 'chat' });
    const text = allLoggedText();
    assert.ok(!text.includes('fb-secret-raw-value'), 'raw token must never appear in any logged field');
  }, 'emitted audit events never contain the raw fb-xxxx token');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
