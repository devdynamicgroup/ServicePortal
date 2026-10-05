/**
 * Phase 2C (fb-xxxx entropy increase + pre-lookup rate limiting) coverage.
 *
 * Covers the approved D1-D21 decisions against the REAL
 * services/case-tokens.js generator and the REAL
 * services/workflow-service.js:linkLineUser() rate-limit gate, using the
 * same monkeypatch-before-require stubbing technique as
 * scripts/test-line-link-ownership.js / test-line-link-audit.js /
 * test-line-token-lifecycle.js.
 *
 * Test numbering follows the approved test plan (1-20); a handful of
 * numbers are intentionally satisfied by inspection/comment rather than a
 * separate runtime check where the real answer is "this isn't reachable in
 * the current single-call-site architecture" -- noted inline, not skipped
 * silently.
 *
 * Run: node scripts/test-line-token-rate-limit.js
 */
'use strict';
const assert = require('assert');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
async function check(fn, name) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }

// ---- monkeypatch dependencies BEFORE requiring case-tokens.js / workflow-service.js ----
const notionClients = require('../services/notion/clients');
const clientFeedback = require('../services/client-feedback');
const dualWrite = require('../services/migration/dual-write');
const observability = require('../services/observability');

let store = null;
let emittedEvents = [];
let nextLogShouldThrow = false;
let notionLookupCalls = 0;

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
  if (patch.caseWorkflowStatus !== undefined) store.workflow = { ...store.workflow, status: patch.caseWorkflowStatus };
  return clone(store);
};
// Never a real match -- case-tokens.js's uniqueness check must not find a collision.
notionClients.findClientByFeedbackToken = async () => null;
notionClients.findClientByReportToken = async () => null;

clientFeedback.getFeedbackByToken = async (token) => {
  notionLookupCalls += 1;
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

const { generateFeedbackToken, generateReportToken, isValidTokenFormat } = require('../services/case-tokens');
const { linkLineUser } = require('../services/workflow-service');

function freshCase(token, overrides = {}) {
  return {
    id: `case-${token}`,
    notionId: `case-${token}`,
    name: 'Rate Limit Test Client',
    createdTime: '2026-10-06T00:00:00.000Z', // after Phase 2B rollout -- lifecycle rules apply normally
    line: { userId: '', linked: false, displayName: '', linkedAt: null },
    workflow: { status: 'result_sent' },
    result: { waterScore: 90, reportUrl: '', publicReportToken: '' },
    feedback: { token, url: '', status: 'not_sent' },
    review: { url: '', status: 'not_requested' },
    notification: { status: 'not_sent', resultSentAt: null, lineMessageId: '', lastError: '' },
    customer: { id: '', pageId: '' },
    ...overrides
  };
}

function reset() { emittedEvents = []; nextLogShouldThrow = false; notionLookupCalls = 0; }

let uniqueCounter = 0;
function uniqueKey(label) { uniqueCounter += 1; return `${label}-${uniqueCounter}`; }

(async () => {
  // ---------------- Token generation ----------------

  console.log('=== Test 1: new feedback tokens are fb- + 24 lowercase base36 chars ===');
  await check(async () => {
    const alphabet = /^[0-9a-z]{24}$/;
    for (let i = 0; i < 25; i += 1) {
      const token = await generateFeedbackToken();
      assert.ok(token.startsWith('fb-'), `token must start with fb-: ${token}`);
      const suffix = token.slice(3);
      assert.strictEqual(suffix.length, 24, `suffix must be exactly 24 chars: ${token}`);
      assert.ok(alphabet.test(suffix), `suffix must be lowercase base36 only: ${token}`);
    }
  }, '25 generated tokens all match fb-<24 lowercase base36 chars> (no statistical randomness claim needed, just format)');

  console.log('\n=== Test 2: legacy 48-bit fallback-shaped tokens remain structurally valid ===');
  await check(async () => {
    const legacyToken = 'fb-9f3c7a01de22'; // 12 hex chars, the newToken('fb') shape
    assert.ok(isValidTokenFormat('fb', legacyToken), 'a 12-char legacy suffix must still pass the unchanged validator');
  }, 'isValidTokenFormat() still accepts the legacy 48-bit fallback shape');

  console.log('\n=== Test 3: existing 4-character (pre-Phase-2C) tokens remain valid ===');
  await check(async () => {
    const oldToken = 'fb-a1b2'; // the previous production shape
    assert.ok(isValidTokenFormat('fb', oldToken), 'a 4-char suffix must still pass the unchanged validator');
  }, 'isValidTokenFormat() still accepts the pre-Phase-2C 4-char shape');

  console.log('\n=== Test 4: a new 24-character token works through the same lookup/redemption path ===');
  await check(async () => {
    const token = await generateFeedbackToken();
    store = freshCase(token);
    reset();
    const result = await linkLineUser(token, 'U_NEW_FORMAT', '', { source: 'chat' });
    assert.strictEqual(result.linked, true, 'a freshly generated 24-char token must redeem successfully, same as any other fb- token');
  }, 'new 24-char tokens are indistinguishable to linkLineUser() -- no special-casing needed');

  console.log('\n=== Test 4b (incidental): generateReportToken() is unaffected -- still 4-char suffix ===');
  await check(async () => {
    const reportToken = await generateReportToken();
    assert.strictEqual(reportToken.slice(4).length, 4, 'report tokens were not touched by Phase 2C D1 (feedback tokens only)');
  }, 'generateReportToken() unchanged -- confirms D1 scope was respected (feedback token only)');

  // ---------------- Rate limiting ----------------

  console.log('\n=== Test 5: under the limit -- requests remain allowed ===');
  await check(async () => {
    const token = uniqueKey('fb-under-limit');
    store = freshCase(token);
    reset();
    for (let i = 0; i < 5; i += 1) {
      // same user retried a few times (e.g. flaky network) -- well under any threshold
      const result = await linkLineUser(token, 'U_NORMAL', '', { source: 'chat' });
      assert.notStrictEqual(result.reason, 'rate_limited', `attempt ${i + 1} must not be throttled`);
    }
  }, '5 legitimate attempts against one token/identity stay under every threshold');

  console.log('\n=== Test 6: IP limit (LIFF-only dimension) trips after the threshold ===');
  await check(async () => {
    const ip = uniqueKey('203.0.113');
    let lastResult;
    for (let i = 0; i < 21; i += 1) {
      const token = uniqueKey('fb-ip-guess'); // different token each time -- isolates the IP dimension specifically
      store = freshCase(token);
      reset();
      lastResult = await linkLineUser(token, '', '', { source: 'liff', ip }); // no lineUserId -- simulates a pre-auth guess burst from one IP
    }
    assert.strictEqual(lastResult.reason, 'rate_limited', '21st attempt from the same IP within the window must be throttled');
    assert.strictEqual(notionLookupCalls, 0, 'the throttled attempt itself must not have reached getFeedbackByToken()');
  }, '21 distinct-token attempts from one IP (liff) trips the 20/10min IP threshold, no Notion lookup on the throttled call');

  console.log('\n=== Test 7: token-fingerprint limit trips, and the raw token never appears in any audit field ===');
  await check(async () => {
    const token = uniqueKey('fb-fp-guess');
    store = freshCase(token);
    let lastResult;
    for (let i = 0; i < 11; i += 1) {
      reset();
      lastResult = await linkLineUser(token, uniqueKey('U_VARY'), '', { source: 'chat' }); // varying identity so only the token dimension trips
    }
    assert.strictEqual(lastResult.reason, 'rate_limited');
    const text = JSON.stringify(emittedEvents);
    assert.ok(!text.includes(token), 'raw token must never appear in the RATE_LIMITED audit event');
    assert.strictEqual(emittedEvents[0].event, 'RATE_LIMITED');
    assert.strictEqual(emittedEvents[0].fields.extra.rateLimitDimension, 'tokenFingerprint');
  }, '11 attempts against one token (varying identity) trips the 10/10min token-fingerprint threshold; no raw token logged');

  console.log('\n=== Test 8: verified-identity limit trips for repeated guessing from one LINE user ===');
  await check(async () => {
    const userId = uniqueKey('U_GUESSER');
    let lastResult;
    for (let i = 0; i < 21; i += 1) {
      const token = uniqueKey('fb-identity-guess'); // different token each time -- isolates the identity dimension
      store = freshCase(token);
      reset();
      lastResult = await linkLineUser(token, userId, '', { source: 'chat' });
    }
    assert.strictEqual(lastResult.reason, 'rate_limited', '21st distinct-token attempt from one verified LINE identity must be throttled');
  }, '21 distinct-token attempts from one verified LINE identity trips the 20/10min identity threshold');

  console.log('\n=== Test 9: chat and liff sources do not share a rate-limit bucket ===');
  await check(async () => {
    const token = uniqueKey('fb-source-split');
    store = freshCase(token);
    // Drive the chat bucket for this token to just below its own limit...
    for (let i = 0; i < 9; i += 1) {
      reset();
      await linkLineUser(token, uniqueKey('U_CHAT'), '', { source: 'chat' });
    }
    // ...then a fresh liff attempt against the SAME token must still be allowed,
    // because D11 requires separate accounting per source.
    reset();
    const liffResult = await linkLineUser(token, 'U_LIFF_FRESH', '', { source: 'liff' });
    assert.notStrictEqual(liffResult.reason, 'rate_limited', 'liff must have its own counter, unaffected by the chat bucket for the same token');
  }, 'per-source bucketing: 9 chat attempts against a token do not consume the liff bucket for that same token');

  console.log('\n=== Test 10: a legitimate customer who mistypes once then submits the correct token can still recover ===');
  await check(async () => {
    const wrongToken = uniqueKey('fb-typo-wrong');
    const rightToken = uniqueKey('fb-typo-right');
    store = freshCase(rightToken);
    reset();
    const wrongAttempt = await linkLineUser(wrongToken, 'U_TYPO', '', { source: 'chat' });
    assert.strictEqual(wrongAttempt.linked, false); // not found, but NOT rate-limited after just 1 attempt
    assert.notStrictEqual(wrongAttempt.reason, 'rate_limited');
    const rightAttempt = await linkLineUser(rightToken, 'U_TYPO', '', { source: 'chat' });
    assert.strictEqual(rightAttempt.linked, true, 'the very next, correct attempt must succeed -- one mistake does not lock the customer out');
  }, 'a single mistyped token followed by the correct one is never throttled -- thresholds are not unusably aggressive');

  console.log('\n=== Test 11: a throttled request never reaches getFeedbackByToken() (resource-exhaustion protection) ===');
  await check(async () => {
    const token = uniqueKey('fb-pre-lookup-check');
    store = freshCase(token);
    for (let i = 0; i < 10; i += 1) {
      reset();
      await linkLineUser(token, uniqueKey('U_SPEND'), '', { source: 'chat' }); // spends the token-fingerprint budget
    }
    reset();
    const result = await linkLineUser(token, 'U_OVER', '', { source: 'chat' });
    assert.strictEqual(result.reason, 'rate_limited');
    assert.strictEqual(notionLookupCalls, 0, 'getFeedbackByToken() must NOT have been called on the throttled attempt');
  }, 'rate-limit decision happens strictly before the Notion lookup, confirmed by a call counter, not just by the returned reason');

  console.log('\n=== Test 12: audit-logger failure cannot break the rate-limit decision itself ===');
  await check(async () => {
    const token = uniqueKey('fb-audit-throw-rl');
    store = freshCase(token);
    for (let i = 0; i < 10; i += 1) {
      reset();
      await linkLineUser(token, uniqueKey('U_SPEND2'), '', { source: 'chat' });
    }
    reset();
    nextLogShouldThrow = true;
    const result = await linkLineUser(token, 'U_OVER2', '', { source: 'chat' });
    assert.strictEqual(result.linked, false);
    assert.strictEqual(result.reason, 'rate_limited', 'the throttle decision must still be returned correctly even if the audit emission throws');
  }, 'RATE_LIMITED is still returned correctly when the audit logger itself throws -- no crash, no silent bypass');

  // ---------------- Enumeration ----------------

  console.log('\n=== Test 13: a random nonexistent token and a real expired token remain distinguishable (documented, not silently normalized) ===');
  await check(async () => {
    const randomToken = uniqueKey('fb-does-not-exist');
    store = freshCase(uniqueKey('fb-other-case'));
    reset();
    const notFoundResult = await linkLineUser(randomToken, 'U_PROBE', '', { source: 'chat' });
    assert.strictEqual(notFoundResult.reason, 'feedback_not_found');

    const expiredToken = uniqueKey('fb-really-expired');
    store = freshCase(expiredToken, { notification: { status: 'sent', resultSentAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() } });
    reset();
    const expiredResult = await linkLineUser(expiredToken, 'U_PROBE', '', { source: 'chat' });
    assert.strictEqual(expiredResult.reason, 'token_expired');

    // D15: this distinction is approved to remain (preserving existing customer
    // UX, per the readiness report's documented tradeoff) -- this test proves
    // and documents the current behavior rather than silently changing it.
    assert.notStrictEqual(notFoundResult.reason, expiredResult.reason, 'not-found vs expired remain distinguishable by design (D15 tradeoff, not fixed in this phase)');
  }, 'not-found vs expired remain distinguishable -- documented known tradeoff, not a regression');

  console.log('\n=== Test 14: already-linked (same identity) still behaves correctly under rate limiting ===');
  await check(async () => {
    const token = uniqueKey('fb-already-linked-rl');
    store = freshCase(token, { line: { userId: 'U_OWNER', linked: true, displayName: 'Owner', linkedAt: '2026-10-07T00:00:00.000Z' } });
    reset();
    const result = await linkLineUser(token, 'U_OWNER', 'Owner', { source: 'chat' });
    assert.strictEqual(result.alreadyLinked, true);
    assert.notStrictEqual(result.reason, 'rate_limited', 'a single legitimate idempotent retry must never be mistaken for abuse');
  }, 'a lone idempotent retry by the real owner is unaffected by rate limiting');

  console.log('\n=== Test 15: different LINE identity still receives the correct rejection under rate limiting ===');
  await check(async () => {
    const token = uniqueKey('fb-wrong-identity-rl');
    store = freshCase(token, { line: { userId: 'U_OWNER2', linked: true, displayName: 'Owner', linkedAt: '2026-10-07T00:00:00.000Z' } });
    reset();
    const result = await linkLineUser(token, 'U_ATTACKER', 'Attacker', { source: 'chat' });
    assert.strictEqual(result.reason, 'linked_to_another_user');
    assert.notStrictEqual(result.reason, 'rate_limited', 'a single wrong-identity attempt is a security rejection, not a rate-limit event');
  }, 'a lone wrong-identity attempt is correctly rejected, not conflated with throttling');

  // ---------------- Lifecycle regression (Phase 2B, unmodified) ----------------

  console.log('\n=== Test 16: expired token remains TOKEN_EXPIRED when rate limiting is NOT triggered ===');
  await check(async () => {
    const token = uniqueKey('fb-expired-regress');
    store = freshCase(token, { notification: { status: 'sent', resultSentAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() } });
    reset();
    const result = await linkLineUser(token, 'U_REGRESS1', '', { source: 'chat' });
    assert.strictEqual(result.reason, 'token_expired');
    assert.strictEqual(emittedEvents[0].event, 'TOKEN_EXPIRED');
  }, 'Phase 2B expiry gate untouched by Phase 2C');

  console.log('\n=== Test 17: cancelled Case remains TOKEN_CANCELLED ===');
  await check(async () => {
    const token = uniqueKey('fb-cancelled-regress');
    store = freshCase(token, { workflow: { status: 'cancelled' } });
    reset();
    const result = await linkLineUser(token, 'U_REGRESS2', '', { source: 'chat' });
    assert.strictEqual(result.reason, 'case_cancelled');
    assert.strictEqual(emittedEvents[0].event, 'TOKEN_CANCELLED');
  }, 'Phase 2B cancellation gate untouched by Phase 2C');

  console.log('\n=== Test 18: grandfathered Case remains valid ===');
  await check(async () => {
    const token = uniqueKey('fb-grandfather-regress');
    store = freshCase(token, {
      createdTime: '2026-10-01T00:00:00.000Z', // before PHASE_2B_ROLLOUT_AT default
      notification: { status: 'sent', resultSentAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString() }
    });
    reset();
    const result = await linkLineUser(token, 'U_REGRESS3', '', { source: 'chat' });
    assert.strictEqual(result.linked, true, 'grandfathering untouched by Phase 2C');
  }, 'Phase 2B grandfathering untouched by Phase 2C');

  console.log('\n=== Test 19: expired + same identity does NOT become idempotent ===');
  await check(async () => {
    const token = uniqueKey('fb-expired-same-identity');
    const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    store = freshCase(token, {
      line: { userId: 'U_SAME', linked: true, displayName: 'Same', linkedAt: '2026-01-01T00:00:00.000Z' },
      notification: { status: 'sent', resultSentAt: expiredAt }
    });
    reset();
    const result = await linkLineUser(token, 'U_SAME', 'Same', { source: 'chat' });
    assert.strictEqual(result.reason, 'token_expired', 'expiry must still gate before the identity/idempotency check, exactly as Phase 2B established');
    assert.notStrictEqual(result.reason, 'already_linked');
  }, 'idempotency cannot bypass expiry -- Phase 2B ordering (D16) preserved exactly');

  // ---------------- Concurrency ----------------

  console.log('\n=== Test 20: simultaneous same-Case redemption attempts -- in-process locking intact ===');
  await check(async () => {
    const token = uniqueKey('fb-concurrent');
    store = freshCase(token);
    reset();
    // Two different LINE users racing for the same unbound Case's token.
    const [resultA, resultB] = await Promise.all([
      linkLineUser(token, 'U_RACE_A', '', { source: 'chat' }),
      linkLineUser(token, 'U_RACE_B', '', { source: 'chat' })
    ]);
    const linkedCount = [resultA, resultB].filter(r => r.linked && !r.alreadyLinked).length;
    assert.strictEqual(linkedCount, 1, 'exactly one of the two simultaneous first-redemption attempts must win -- withCaseLock() serializes them within this process');
    // NOTE (architectural limitation, reported per D10/Step 20, not fixed here):
    // withCaseLock() is a module-level, per-process Map (services/workflow-service.js).
    // This test proves in-process serialization only. It cannot prove -- and this
    // phase does not implement -- protection across multiple Node processes/instances.
  }, 'in-process withCaseLock() correctly serializes two racing first-redemption attempts for the same Case (cross-instance race remains an open architectural limitation, not addressed here)');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
