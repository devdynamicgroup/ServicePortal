/**
 * QA sweep (2026-08-27) of the LINE OA webhook's inbound decision tree --
 * api/line-routes.js:resolveInboundDecision/detectOaIntent/
 * parseOaPostbackData/extractFeedbackToken. None of these had ANY
 * executable test coverage before this file (test-line-lifecycle.js only
 * covers services/line-contacts.js, services/line-result-resolver.js and
 * services/line-notifications.js's message builders -- never the actual
 * routing logic that decides which one of those gets used for a given
 * inbound LINE event).
 *
 * Covers every branch of the "1 token, 2 postback, 3 intent, 4 default"
 * priority order, plus deliberately malformed/impossible inputs (no event
 * type, unhandled event types, tokens embedded inside other words, mixed
 * case, empty strings) to document what the code actually does with them,
 * not just the happy path.
 *
 * Run: node scripts/test-line-webhook-decision-tree.js
 */
'use strict';
const assert = require('assert');
const {
  resolveInboundDecision,
  detectOaIntent,
  parseOaPostbackData,
  extractFeedbackToken
} = require('../api/line-routes');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
function check(fn, name) {
  try { fn(); ok(name); } catch (e) { fail(name, e); }
}

console.log('=== extractFeedbackToken(text) ===');
check(() => assert.strictEqual(extractFeedbackToken('fb-tq3x'), 'fb-tq3x'), 'bare token, already lowercase');
check(() => assert.strictEqual(extractFeedbackToken('FB-TQ3X'), 'fb-tq3x'), 'uppercase token is normalized to lowercase');
check(() => assert.strictEqual(extractFeedbackToken('please send fb-ab12 thanks'), 'fb-ab12'), 'token embedded in a sentence is extracted');
check(() => assert.strictEqual(extractFeedbackToken('  fb-ab12  '), 'fb-ab12'), 'surrounding whitespace does not break extraction');
check(() => assert.strictEqual(extractFeedbackToken('fb-aaaa and fb-bbbb'), 'fb-aaaa'), 'multiple tokens in one message -- only the first is used');
check(() => assert.strictEqual(extractFeedbackToken(''), ''), 'empty string -> no token');
check(() => assert.strictEqual(extractFeedbackToken(null), ''), 'null -> no token, does not throw');
check(() => assert.strictEqual(extractFeedbackToken(undefined), ''), 'undefined -> no token, does not throw');
check(() => assert.strictEqual(extractFeedbackToken('   '), ''), 'whitespace-only string -> no token');
check(() => assert.strictEqual(extractFeedbackToken('fb-'), ''), '"fb-" with no suffix characters -> no token (impossible/malformed)');
check(() => assert.strictEqual(extractFeedbackToken('xfb-abcd'), ''), '"fb-" glued onto another word (no word boundary before it) -> NOT extracted, prevents false positives from unrelated text that happens to contain "fb-"');
check(() => assert.strictEqual(extractFeedbackToken('เชื่อมด้วยรหัส fb-99zz นะครับ'), 'fb-99zz'), 'token embedded in a Thai sentence is still extracted');
check(() => assert.strictEqual(extractFeedbackToken('fb-AB-12'), 'fb-ab-12'), 'token with an internal hyphen is allowed and lowercased (matches generateUniqueToken\'s charset)');

console.log('\n=== parseOaPostbackData(data) ===');
check(() => assert.strictEqual(parseOaPostbackData('action=view_latest'), 'view_latest'), 'canonical OA_POSTBACK.VIEW_LATEST value');
check(() => assert.strictEqual(parseOaPostbackData('action=history'), 'history'), 'canonical OA_POSTBACK.HISTORY value');
check(() => assert.strictEqual(parseOaPostbackData('action=book_again'), 'book_again'), 'canonical OA_POSTBACK.BOOK_AGAIN value');
check(() => assert.strictEqual(parseOaPostbackData('view_latest'), 'view_latest'), 'legacy bare-string value (no "action=" prefix) still recognized');
check(() => assert.strictEqual(parseOaPostbackData('history'), 'history'), 'legacy bare-string "history" still recognized');
check(() => assert.strictEqual(parseOaPostbackData('book_again'), 'book_again'), 'legacy bare-string "book_again" still recognized');
check(() => assert.strictEqual(parseOaPostbackData('  action=view_latest  '), 'view_latest'), 'surrounding whitespace is trimmed');
check(() => assert.strictEqual(parseOaPostbackData('action=View_Latest'), ''), 'wrong case ("View_Latest") is NOT matched -- comparison is case-sensitive, unlike detectOaIntent\'s text matching');
check(() => assert.strictEqual(parseOaPostbackData('action=unknown_thing'), ''), 'unrecognized action string -> empty (becomes postback_unknown upstream)');
check(() => assert.strictEqual(parseOaPostbackData(''), ''), 'empty string -> empty');
check(() => assert.strictEqual(parseOaPostbackData(null), ''), 'null -> empty, does not throw');
check(() => assert.strictEqual(parseOaPostbackData(undefined), ''), 'undefined -> empty, does not throw');
check(() => assert.strictEqual(parseOaPostbackData(12345), ''), 'non-string (number) input -> empty, does not throw');

console.log('\n=== detectOaIntent(text) ===');
check(() => assert.strictEqual(detectOaIntent('ดูผลตรวจ'), 'view_latest'), 'Thai view_latest keyword');
check(() => assert.strictEqual(detectOaIntent('view latest'), 'view_latest'), 'English view_latest keyword');
check(() => assert.strictEqual(detectOaIntent('VIEW LATEST SCORE'), 'view_latest'), 'uppercase English still matches (case-insensitive)');
check(() => assert.strictEqual(detectOaIntent('ดูคะแนนน้ำ'), 'view_latest'), 'alternate Thai view_latest phrasing');
check(() => assert.strictEqual(detectOaIntent('ประวัติ'), 'history'), 'Thai history keyword');
check(() => assert.strictEqual(detectOaIntent('previous scores'), 'history'), 'English history keyword');
check(() => assert.strictEqual(detectOaIntent('นัดตรวจ'), 'book_again'), 'Thai book_again keyword');
check(() => assert.strictEqual(detectOaIntent('book again'), 'book_again'), 'English book_again keyword');
check(() => assert.strictEqual(detectOaIntent('สวัสดีครับ'), ''), 'unrelated Thai greeting -> no intent');
check(() => assert.strictEqual(detectOaIntent('hello there'), ''), 'unrelated English text -> no intent');
check(() => assert.strictEqual(detectOaIntent(''), ''), 'empty string -> no intent');
check(() => assert.strictEqual(detectOaIntent(null), ''), 'null -> no intent, does not throw');
check(() => assert.strictEqual(detectOaIntent(undefined), ''), 'undefined -> no intent, does not throw');
check(() => assert.strictEqual(detectOaIntent('   '), ''), 'whitespace-only -> no intent');
check(() => assert.strictEqual(detectOaIntent('ดูผลตรวจ ประวัติ นัดตรวจ'), 'view_latest'), 'message matching all three intents -> view_latest wins (checked first, matches detectOaIntent\'s own if/else-if source order)');
check(() => assert.strictEqual(detectOaIntent('ประวัติ นัดตรวจ'), 'history'), 'message matching history + book_again (no view_latest) -> history wins (checked before book_again)');

console.log('\n=== resolveInboundDecision(event) -- full priority tree ===');
check(() => {
  const d = resolveInboundDecision({ type: 'message', message: { type: 'text', text: 'fb-tq3x' } });
  assert.strictEqual(d.kind, 'feedback_token');
  assert.strictEqual(d.priority, 1);
  assert.strictEqual(d.token, 'fb-tq3x');
}, 'text with a valid token -> feedback_token, priority 1');

check(() => {
  const d = resolveInboundDecision({ type: 'message', message: { type: 'text', text: 'fb-tq3x ดูผลตรวจ ประวัติ' } });
  assert.strictEqual(d.kind, 'feedback_token');
}, 'token AND intent keywords both present in the same message -> token still wins (priority 1 beats priority 3)');

check(() => {
  const d = resolveInboundDecision({ type: 'postback', postback: { data: 'action=view_latest' } });
  assert.strictEqual(d.kind, 'postback');
  assert.strictEqual(d.priority, 2);
  assert.strictEqual(d.intent, 'view_latest');
}, 'postback with a recognized action -> postback, priority 2');

check(() => {
  const d = resolveInboundDecision({ type: 'postback', postback: { data: 'action=something_new' } });
  assert.strictEqual(d.kind, 'postback_unknown');
  assert.strictEqual(d.priority, 2);
}, 'postback with an unrecognized action -> postback_unknown, still priority 2');

check(() => {
  const d = resolveInboundDecision({ type: 'postback', postback: {} });
  assert.strictEqual(d.kind, 'postback_unknown');
}, 'postback with no data at all -> postback_unknown, does not throw');

check(() => {
  const d = resolveInboundDecision({ type: 'message', message: { type: 'text', text: 'ดูผลตรวจ' } });
  assert.strictEqual(d.kind, 'intent');
  assert.strictEqual(d.priority, 3);
  assert.strictEqual(d.intent, 'view_latest');
}, 'text with an intent keyword, no token -> intent, priority 3');

check(() => {
  const d = resolveInboundDecision({ type: 'message', message: { type: 'text', text: 'สวัสดีครับ' } });
  assert.strictEqual(d.kind, 'default');
  assert.strictEqual(d.priority, 4);
}, 'plain text, no token, no intent -> default, priority 4');

check(() => {
  const d = resolveInboundDecision({ type: 'message', message: { type: 'text', text: '' } });
  assert.strictEqual(d.kind, 'default');
}, 'empty text message -> default, not a crash');

check(() => {
  const d = resolveInboundDecision({ type: 'follow' });
  assert.strictEqual(d.kind, 'follow');
  assert.strictEqual(d.priority, 4);
}, 'follow event -> follow');

check(() => {
  const d = resolveInboundDecision({ type: 'message', message: { type: 'image' } });
  assert.strictEqual(d.kind, 'ignore');
  assert.strictEqual(d.reason, 'unhandled_type');
}, 'non-text message (image) -> ignore/unhandled_type -- neither the token nor intent branches apply to non-text messages');

check(() => {
  const d = resolveInboundDecision({ type: 'message', message: { type: 'sticker' } });
  assert.strictEqual(d.kind, 'ignore');
}, 'sticker message -> ignore, does not throw on missing .text');

check(() => {
  const d = resolveInboundDecision({ type: 'unsend' });
  assert.strictEqual(d.kind, 'ignore');
  assert.strictEqual(d.reason, 'unhandled_type');
  assert.strictEqual(d.eventType, 'unsend');
}, 'unhandled LINE event type (unsend) -> ignore/unhandled_type, with the type echoed back for logging');

check(() => {
  const d = resolveInboundDecision(null);
  assert.strictEqual(d.kind, 'ignore');
  assert.strictEqual(d.reason, 'missing_event');
}, 'null event -> ignore/missing_event, does not throw');

check(() => {
  const d = resolveInboundDecision({});
  assert.strictEqual(d.kind, 'ignore');
  assert.strictEqual(d.reason, 'missing_event');
}, 'event object with no .type -> ignore/missing_event');

check(() => {
  const d = resolveInboundDecision(undefined);
  assert.strictEqual(d.kind, 'ignore');
}, 'undefined event -> ignore, does not throw');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
