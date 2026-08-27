/**
 * Guards the LINE OA link-prompt copy (2026-08-27, direct request): once
 * the poster QR started encoding a per-Case LIFF bind link (see
 * services/score-share-card.js:renderDynamicCtaBadge), most customers
 * connect automatically and never see these two chat fallbacks
 * (buildLinkPromptTextMessage / buildFollowWelcomeMessage) at all. The
 * copy must reflect that the fb-xxxx code is now a manual backup, not the
 * primary/required way to link -- reverting to "please send code" wording
 * with no mention of the automatic QR path would resurrect the exact
 * confusion this was fixed for.
 *
 * Run: node scripts/test-line-link-prompt-copy.js
 */
'use strict';
const assert = require('assert');
const { buildLinkPromptTextMessage, buildFollowWelcomeMessage } = require('../services/line-notifications');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
function check(fn, name) { try { fn(); ok(name); } catch (e) { fail(name, e); } }

const promptText = buildLinkPromptTextMessage().text;
const welcomeText = buildFollowWelcomeMessage().text;

check(() => assert.ok(/QR/.test(promptText), 'link-prompt fallback mentions the automatic QR path, not just the manual code'), 'buildLinkPromptTextMessage mentions QR');
check(() => assert.ok(/fb-xxxx/.test(promptText), 'the manual fb-xxxx code stays available as a fallback for customers who reach this without having scanned the QR'), 'buildLinkPromptTextMessage still offers the fb-xxxx fallback');
check(() => assert.ok(/อัตโนมัติ/.test(promptText), 'copy frames connecting as automatic by default'), 'buildLinkPromptTextMessage says the connection is automatic');
check(() => assert.ok(!/^กรุณาส่งรหัส/.test(promptText.trim()), 'must not open by commanding the customer to send a code, as if that were the only/required way'), 'buildLinkPromptTextMessage does not open with a "please send the code" command');

check(() => assert.ok(/QR/.test(welcomeText), 'follow-welcome mentions the automatic QR path too'), 'buildFollowWelcomeMessage mentions QR');
check(() => assert.ok(/fb-xxxx/.test(welcomeText), 'follow-welcome still mentions fb-xxxx as an alternative'), 'buildFollowWelcomeMessage still offers the fb-xxxx fallback');
check(() => assert.ok(!/^ยินดีต้อนรับสู่ Water Motion\nส่งรหัส/.test(welcomeText), 'must not jump straight from the greeting to commanding a code send'), 'buildFollowWelcomeMessage does not command a code send right after the greeting');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
