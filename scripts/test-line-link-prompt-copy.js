/**
 * Guards the LINE OA follow-welcome copy (2026-08-27, direct request):
 * once the poster QR started encoding a per-Case LIFF bind link (see
 * services/score-share-card.js:renderDynamicCtaBadge), most customers
 * connect automatically and never see this chat fallback at all. The
 * copy must reflect that the fb-xxxx code is a manual backup, not the
 * primary/required way to link -- reverting to "please send code" wording
 * with no mention of the automatic QR path would resurrect the exact
 * confusion this was fixed for.
 *
 * buildLinkPromptTextMessage() (originally guarded here too) was replaced
 * outright by the Unknown Customer flow (buildUnknownCustomerReply()) in
 * every real call site -- see scripts/test-line-unknown-customer-flow.js --
 * so it and its assertions were removed rather than left half-covering a
 * function nothing calls anymore.
 *
 * Run: node scripts/test-line-link-prompt-copy.js
 */
'use strict';
const assert = require('assert');
const { buildFollowWelcomeMessage } = require('../services/line-notifications');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
function check(fn, name) { try { fn(); ok(name); } catch (e) { fail(name, e); } }

const welcomeText = buildFollowWelcomeMessage().text;

check(() => assert.ok(/QR/.test(welcomeText), 'follow-welcome mentions the automatic QR path too'), 'buildFollowWelcomeMessage mentions QR');
check(() => assert.ok(/fb-xxxx/.test(welcomeText), 'follow-welcome still mentions fb-xxxx as an alternative'), 'buildFollowWelcomeMessage still offers the fb-xxxx fallback');
check(() => assert.ok(!/^ยินดีต้อนรับสู่ Water Motion\nส่งรหัส/.test(welcomeText), 'must not jump straight from the greeting to commanding a code send'), 'buildFollowWelcomeMessage does not command a code send right after the greeting');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
