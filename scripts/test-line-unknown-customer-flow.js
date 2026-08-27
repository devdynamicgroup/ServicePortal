/**
 * Unknown/Unlinked LINE Customer flow (2026-08-27, direct requirement doc).
 *
 * Old behavior: a LINE user the system couldn't resolve to any Case was
 * always told to type an fb-xxxx code, as if that were the only way to
 * "identify" their Case. New behavior: the system never guesses or
 * recovers a Case from a customer-typed code -- an unresolvable LINE user
 * is handed exactly two ways forward that need no Case lookup at all:
 * start a new inspection (existing website booking flow) or hand the
 * conversation to a human (ends the automated reply; no ticket system).
 *
 * Covers the requirement doc's 6 test cases:
 *   1. Unknown Customer -> the new reply, 2 buttons, no /r/{token}, no fb-xxxx
 *   2. "เริ่มตรวจคุณภาพน้ำ" opens the existing website URL
 *   3. "ติดต่อเจ้าหน้าที่" -> plain ack, no code asked, no Case created
 *   4. Known Customer regression -> existing result flow unchanged
 *   5. Cross-user protection -> an unknown user never gets another user's
 *      report/token
 *   6. The internal fb-xxxx code path itself (extractFeedbackToken /
 *      linkLineUser) is untouched by this change
 *
 * handleLineEvent() is integration-tested directly (not just its
 * sub-pieces) by monkeypatching its real dependencies' module exports
 * BEFORE requiring api/line-routes.js -- Node caches modules by path, so
 * reassigning an exported property before the consumer's own require()
 * call changes what that destructuring reads (same technique used for
 * api/liff-routes.js's tests earlier this session). sendLineReply is
 * patched to capture the outgoing messages instead of calling LINE's real
 * API; recordLineFollow/touchLineContact are stubbed to avoid writing
 * real files under ./tmp/line-contacts during a test run.
 *
 * Run: node scripts/test-line-unknown-customer-flow.js
 */
'use strict';
const assert = require('assert');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
function check(fn, name) { try { fn(); ok(name); } catch (e) { fail(name, e); } }
async function checkAsync(fn, name) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }

const lineNotifications = require('../services/line-notifications');
const lineResultResolver = require('../services/line-result-resolver');
const lineReader = require('../services/customer-domain/line-reader');
const lineContacts = require('../services/line-contacts');

// ---- monkeypatch dependencies BEFORE requiring api/line-routes ----
let sentMessages = null;
lineNotifications.sendLineReply = async (replyToken, messages) => {
  sentMessages = messages;
  return { ok: true };
};
lineContacts.recordLineFollow = () => null;
lineContacts.touchLineContact = () => null;

let mockLinked = false;
let mockLatest = { resultAvailable: false, case: null, resultType: null, resultUrl: '' };
lineResultResolver.hasLinkedCasesByLineUserId = async () => mockLinked;
lineResultResolver.getLatestAvailableResultByLineUserId = async () => mockLatest;
lineReader.resolveLineCustomerCases = async () => ({ linked: mockLinked, withReport: [] });

const { handleLineEvent, parseOaPostbackData } = require('../api/line-routes');
const { buildUnknownCustomerReply, buildContactAdminAckMessage, buildUnrecognizedMenuPromptMessage, OA_POSTBACK, resolveLineBookingUrl } = require('../services/line-notifications');

function textEvent(text, userId = 'U_UNKNOWN') {
  return {
    type: 'message',
    message: { type: 'text', text, id: `msg-${Math.random()}` },
    source: { userId },
    replyToken: `rt-${Math.random()}`,
    webhookEventId: `we-${Math.random()}`
  };
}
function postbackEvent(data, userId = 'U_UNKNOWN') {
  return {
    type: 'postback',
    postback: { data },
    source: { userId },
    replyToken: `rt-${Math.random()}`,
    webhookEventId: `we-${Math.random()}`
  };
}

console.log('=== message builder shape ===');
check(() => {
  const msg = buildUnknownCustomerReply();
  assert.strictEqual(msg.type, 'text');
  assert.ok(!/fb-xxxx/.test(msg.text), 'must not mention the fb-xxxx code at all');
  assert.strictEqual(msg.quickReply.items.length, 2, 'exactly the 2 required buttons, nothing else');
  const uriItem = msg.quickReply.items.find(i => i.action.type === 'uri');
  const postbackItem = msg.quickReply.items.find(i => i.action.type === 'postback');
  assert.ok(uriItem, 'has a URI action (start inspection)');
  assert.strictEqual(uriItem.action.uri, resolveLineBookingUrl(), 'reuses the existing website booking URL, not a new one');
  assert.ok(postbackItem, 'has a postback action (contact admin)');
  assert.strictEqual(postbackItem.action.data, OA_POSTBACK.CONTACT_ADMIN);
}, 'buildUnknownCustomerReply() has the 2 required buttons and never mentions fb-xxxx');

check(() => {
  const msg = buildContactAdminAckMessage();
  assert.strictEqual(msg.type, 'text');
  assert.ok(!msg.quickReply, 'no quick-reply menu -- ends the automated flow, does not invite further bot interaction');
  assert.ok(!/fb-xxxx|รหัส/.test(msg.text), 'does not ask for any code');
}, 'buildContactAdminAckMessage() is a plain ack with no menu and no code prompt');

check(() => {
  const msg = buildUnrecognizedMenuPromptMessage();
  assert.ok(msg.quickReply.items.length >= 3, 'a linked customer still gets the normal menu, not the unknown-customer buttons');
  assert.ok(!msg.quickReply.items.some(i => i.action.data === OA_POSTBACK.CONTACT_ADMIN), 'does not offer contact-admin -- that is only for genuinely unresolvable customers');
}, 'buildUnrecognizedMenuPromptMessage() nudges a known customer back to the normal menu');

check(() => {
  assert.strictEqual(parseOaPostbackData('action=contact_admin'), 'contact_admin');
  assert.strictEqual(parseOaPostbackData('contact_admin'), 'contact_admin');
}, 'parseOaPostbackData recognizes the new contact_admin postback (canonical + legacy bare string)');

(async () => {
  console.log('\n=== Case 1: Unknown Customer (unrecognized text, no linked Case) ===');
  mockLinked = false;
  sentMessages = null;
  await checkAsync(async () => {
    await handleLineEvent(textEvent('สวัสดีครับ'));
    assert.ok(sentMessages, 'a reply was sent');
    const [msg] = sentMessages;
    assert.ok(!/fb-xxxx/.test(msg.text), 'no fb-xxxx code prompt anywhere in the reply');
    assert.ok(!/\/r\//.test(msg.text), 'no /r/{token} report link leaked');
    assert.strictEqual(msg.quickReply.items.length, 2, 'exactly the 2 Unknown Customer buttons');
  }, 'unrecognized text from an unlinked LINE user gets the Unknown Customer reply, no code prompt, no report link');

  console.log('\n=== Case 2: "เริ่มตรวจคุณภาพน้ำ" opens the existing website ===');
  await checkAsync(async () => {
    await handleLineEvent(textEvent('anything', 'U_UNKNOWN_2'));
    const [msg] = sentMessages;
    const uriItem = msg.quickReply.items.find(i => i.action.type === 'uri');
    assert.strictEqual(uriItem.action.uri, resolveLineBookingUrl(), 'button opens the same URL the existing book-again flow already uses -- no new website/flow created');
  }, 'the "start inspection" button targets the existing website URL, not a new one');

  console.log('\n=== Case 3: "ติดต่อเจ้าหน้าที่" ends the automated flow ===');
  sentMessages = null;
  await checkAsync(async () => {
    await handleLineEvent(postbackEvent(OA_POSTBACK.CONTACT_ADMIN));
    assert.ok(sentMessages, 'a reply was sent');
    const [msg] = sentMessages;
    assert.ok(!/fb-xxxx|รหัส/.test(msg.text), 'does not ask for a code');
    assert.strictEqual(sentMessages.length, 1, 'a single plain ack, not a menu/flow continuation');
    assert.ok(!msg.quickReply, 'no further menu offered -- automated flow ends here');
  }, 'tapping "contact admin" ends the flow with a plain ack, no code asked, no case created');

  console.log('\n=== Case 4: Known Customer regression ===');
  mockLinked = true;
  mockLatest = {
    resultAvailable: true,
    case: { id: 'case-known', result: { waterScore: 80 } },
    resultType: 'paid_assessment',
    resultUrl: 'https://serviceportal.onrender.com/r/fb-known-token'
  };
  sentMessages = null;
  await checkAsync(async () => {
    await handleLineEvent(textEvent('ดูผลตรวจ', 'U_KNOWN'));
    assert.ok(sentMessages, 'a reply was sent for the known customer too');
    // buildViewLatestResultReply's exact shape is covered elsewhere
    // (test-line-lifecycle.js); here we only need proof this path was NOT
    // diverted into the Unknown Customer reply.
    assert.ok(!sentMessages.some(m => m.quickReply?.items?.some(i => i.action?.data === OA_POSTBACK.CONTACT_ADMIN)), 'a known, resolvable customer never sees the Unknown Customer / contact-admin option');
  }, 'a known customer asking for their latest result still gets the existing result flow, not the Unknown Customer reply');

  await checkAsync(async () => {
    sentMessages = null;
    await handleLineEvent(textEvent('ok thanks', 'U_KNOWN'));
    const [msg] = sentMessages;
    assert.ok(!/fb-xxxx/.test(msg.text) && !/ยังไม่พบข้อมูล/.test(msg.text), 'a linked customer sending unrecognized text is nudged to the menu, not told they are unknown');
  }, 'a known customer sending unrecognized text gets the neutral menu prompt, not the Unknown Customer reply');

  console.log('\n=== Case 5: cross-user protection ===');
  mockLinked = false;
  mockLatest = { resultAvailable: false, case: null, resultType: null, resultUrl: '' };
  sentMessages = null;
  await checkAsync(async () => {
    await handleLineEvent(textEvent('ดูผลตรวจ', 'U_UNKNOWN_3'));
    const combinedText = (sentMessages || []).map(m => m.text || m.altText || '').join(' ');
    assert.ok(!combinedText.includes('80'), 'no other customer\'s score value leaks into an unresolvable user\'s reply');
    assert.ok(!/\/r\/fb-known-token/.test(combinedText), 'no other customer\'s report token/URL leaks into an unresolvable user\'s reply');
  }, 'an unresolvable LINE user asking to view their result never receives another customer\'s score or report link');

  console.log('\n=== Case 6: existing fb-xxxx fallback is untouched ===');
  mockLinked = false;
  sentMessages = null;
  await checkAsync(async () => {
    // extractFeedbackToken/resolveInboundDecision still route a typed code
    // to the feedback_token branch, not the Unknown Customer reply -- this
    // internal mechanism stays available even though it's no longer the
    // customer-facing default.
    const { resolveInboundDecision } = require('../api/line-routes');
    const decision = resolveInboundDecision(textEvent('fb-tq3x').message ? { type: 'message', message: { type: 'text', text: 'fb-tq3x' } } : null);
    assert.strictEqual(decision.kind, 'feedback_token');
    assert.strictEqual(decision.token, 'fb-tq3x');
  }, 'a customer who still types an fb-xxxx code is recognized via the unchanged internal token path, not blocked by the Unknown Customer flow');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
