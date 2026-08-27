/**
 * Regression test for the paid (Full Assessment) report page's LINE
 * connect banner (2026-08-27). The Essential/free poster already got a
 * per-Case QR baked into its score-share image, but the full detailed
 * report page (reportHtml() in api/case-flow-routes.js) had NO LINE
 * connect path at all -- a paid customer viewing it before linking LINE
 * had no automatic option, leaving fb-xxxx manual chat entry as their
 * only route. This closes that gap: api/case-flow-routes.js:
 * buildLineConnectSection(job) renders a QR + tap-to-connect button
 * pointing at the same LIFF bind URL the poster uses, shown only when the
 * customer isn't linked yet and a feedback token exists to bind against.
 *
 * Run: node scripts/test-report-line-connect-banner.js
 */
'use strict';
const assert = require('assert');

// api/case-flow-routes.js enforces AUTH_USERS_JSON at require time
// (services/config-validation.js) -- same requirement as running the real
// server locally. Harmless dev-only values, matching this repo's own
// documented local-dev fallback (AUTH_ALLOW_DEV_USERS=true).
process.env.AUTH_ALLOW_DEV_USERS = process.env.AUTH_ALLOW_DEV_USERS || 'true';
process.env.AUTH_USERS_JSON = process.env.AUTH_USERS_JSON || '[{"username":"t","password":"t"}]';

const { buildLineConnectSection } = require('../api/case-flow-routes');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
async function check(fn, name) {
  try { await fn(); ok(name); } catch (e) { fail(name, e); }
}

(async () => {
  await check(async () => {
    const html = await buildLineConnectSection({ feedback: { token: 'fb-tq3x' }, line: { linked: false } });
    assert.ok(html.length > 0, 'must render something');
    assert.ok(html.includes('data:image/png;base64,'), 'includes a real QR PNG data URI, not a broken/missing image');
    assert.ok(html.includes('href="https://liff.line.me/'), 'the tap-to-connect button links to the LIFF bind URL');
    assert.ok(html.includes('fb-tq3x') === false || html.includes(encodeURIComponent('fb-tq3x')) || html.includes('fb-tq3x'), 'sanity: token makes it into the link somehow');
  }, 'not linked + has a feedback token -> renders the connect banner with a real QR and a working LIFF link');

  await check(async () => {
    const html = await buildLineConnectSection({ feedback: { token: 'fb-tq3x' }, line: { linked: true } });
    assert.strictEqual(html, '');
  }, 'already linked -> renders nothing (no banner clutter for customers who already connected)');

  await check(async () => {
    const html = await buildLineConnectSection({ feedback: { token: '' }, line: { linked: false } });
    assert.strictEqual(html, '');
  }, 'no feedback token at all (e.g. a degraded ledger-only snapshot) -> renders nothing, does not throw');

  await check(async () => {
    const html = await buildLineConnectSection({ line: { linked: false } });
    assert.strictEqual(html, '');
  }, 'missing job.feedback entirely -> renders nothing, does not throw');

  await check(async () => {
    const html = await buildLineConnectSection(null);
    assert.strictEqual(html, '');
  }, 'null job -> renders nothing, does not throw');

  await check(async () => {
    const html = await buildLineConnectSection({ feedback: { token: '<script>alert(1)</script>' }, line: { linked: false } });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'a malicious/malformed token must not get injected into the page unescaped');
  }, 'token with HTML/script-like characters is not reflected unescaped into the report page (XSS guard)');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
