/**
 * Regression suite for the LIFF "Case Bind" flow (2026-08-26).
 *
 * Direct request: let a customer tap a link to bind their LINE account to a
 * Case automatically via LIFF's login/profile SDK, instead of typing the
 * fb-xxxx code by hand in chat. The actual bind reuses
 * services/workflow-service.js:linkLineUser verbatim (same code path as the
 * manual chat flow); the new part is:
 *
 *   services/url-builder.js:buildLiffBindUrl(token)
 *   api/liff-routes.js:verifyLiffIdToken(idToken)  -- server-side ID token
 *     verification against LINE's own endpoint, so a client can never just
 *     POST an arbitrary lineUserId and hijack a Case's result-delivery target.
 *   api/liff-routes.js:handleLiffRoute(req, res, urlPath)
 *
 * Monkeypatches services/case-flow.js and services/workflow-service.js
 * exports BEFORE requiring api/liff-routes.js, so the route file's
 * destructured references pick up the mocks (Node caches modules by path;
 * reassigning an exported property before the consumer's require() call
 * changes what that destructuring reads).
 *
 * Run: node scripts/test-liff-bind.js
 */
'use strict';
const assert = require('assert');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const ROOT = 'D:/Service Portal';

async function main() {

// ---- buildLiffBindUrl ----
console.log('=== buildLiffBindUrl(token) ===');
{
  const { buildLiffBindUrl } = require(`${ROOT}/services/url-builder`);
  check(buildLiffBindUrl('fb-tq3x') === 'https://liff.line.me/2011272555-MAtmaEy4/fb-tq3x', 'builds the expected liff.line.me URL with the default LIFF ID, token as a path segment (not a query string -- server.js strips query strings before any route matches)');
  check(buildLiffBindUrl('') === '', 'empty token => empty string, no throw');
  check(buildLiffBindUrl(null) === '', 'null token => empty string, no throw');
}

// ---- monkeypatch service deps BEFORE requiring api/liff-routes ----
const caseFlow = require(`${ROOT}/services/case-flow`);
const workflowService = require(`${ROOT}/services/workflow-service`);

let mockFeedback = { clientPageId: 'page-1', clientName: 'Test Client', feedbackToken: 'fb-test' };
let mockLinkResult = null;
let mockSendCaseResultCalls = [];
let mockSendCaseResultThrows = null;

caseFlow.getFeedbackByToken = async (token) => mockFeedback;
workflowService.linkLineUser = async (token, userId, displayName) => mockLinkResult;
workflowService.sendCaseResult = async (caseId) => {
  mockSendCaseResultCalls.push(caseId);
  if (mockSendCaseResultThrows) throw mockSendCaseResultThrows;
  return { action: 'sent' };
};
workflowService.markCaseResultNotificationFailed = async () => {};

const { handleLiffRoute, verifyLiffIdToken, liffBindHtml } = require(`${ROOT}/api/liff-routes`);

// ---- verifyLiffIdToken (mocks global.fetch) ----
console.log('\n=== verifyLiffIdToken(idToken) ===');
const realFetch = global.fetch;
async function withFetch(mockImpl, fn) {
  global.fetch = mockImpl;
  try { return await fn(); } finally { global.fetch = realFetch; }
}

{
  const result = await withFetch(
    async () => ({ ok: true, json: async () => ({ sub: 'Uabc123', aud: '2011272555', name: 'Somchai' }) }),
    () => verifyLiffIdToken('token123')
  );
  check(result.userId === 'Uabc123' && result.displayName === 'Somchai', 'valid token + matching audience => returns verified userId/displayName');
}
{
  let threw = null;
  await withFetch(
    async () => ({ ok: true, json: async () => ({ sub: 'Uabc123', aud: 'SOME_OTHER_CHANNEL', name: 'Somchai' }) }),
    async () => { try { await verifyLiffIdToken('token123'); } catch (e) { threw = e; } }
  );
  check(threw && threw.message === 'id_token_wrong_audience' && threw.statusCode === 401, 'token verified by LINE but issued for a DIFFERENT channel => rejected (prevents cross-channel token reuse)');
}
{
  let threw = null;
  await withFetch(
    async () => ({ ok: false, json: async () => ({ error: 'invalid_request', error_description: 'expired' }) }),
    async () => { try { await verifyLiffIdToken('bad-token'); } catch (e) { threw = e; } }
  );
  check(threw && threw.statusCode === 401, 'LINE rejects the id_token => 401, not silently accepted');
}
{
  let threw = null;
  try { await verifyLiffIdToken(''); } catch (e) { threw = e; }
  check(threw && threw.statusCode === 400, 'empty id_token => 400, never reaches the network call');
}

// ---- fake req/res for handleLiffRoute ----
// `url` defaults to '' (no query string) -- matches every pre-existing call
// site below, which passes the effective path directly as the 3rd arg to
// handleLiffRoute() and never relied on req.url. Tests that need to prove
// the real liff.state query-unwrapping pass `url` explicitly.
function fakeReq(method, body, url = '') {
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}
function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(chunk) { this.body = chunk; }
  };
}

// ---- canonical URL <-> real route contract (2026-09-03, corrected) ----
// The 2026-09-03 "fix" that changed buildLiffBindUrl() from `?token=` to a
// path segment was based on a WRONG assumption: that LIFF forwards the part
// after the LIFF ID as a literal path segment on the Endpoint URL. A real
// redirect trace proved otherwise -- LIFF actually bundles it into a
// `liff.state` QUERY PARAMETER on the bare Endpoint URL:
//   https://liff.line.me/{liffId}/fb-xxxx
//     -> https://serviceportal.onrender.com/liff/bind?liff.state=%2Ffb-xxxx
// NOT `/liff/bind/fb-xxxx`. The previous version of this test simulated the
// wrong shape and therefore "passed" while the real scan 404'd -- exactly
// the kind of gap this test exists to catch. This block reconstructs the
// ACTUAL redirect shape (verified against a live https://liff.line.me
// redirect, not assumed) and proves resolveLiffEffectivePath() unwraps it
// correctly before handleLiffRoute()'s path regex ever sees it.
console.log('\n=== canonical URL -> real route contract (liff.state) ===');
{
  const { buildLiffBindUrl } = require(`${ROOT}/services/url-builder`);
  const { resolveLiffEffectivePath } = require(`${ROOT}/api/liff-routes`);
  const ENDPOINT_URL = '/liff/bind'; // the app's registered LIFF Endpoint URL path (verified in LINE Developers Console, no trailing slash)
  const canonicalUrl = buildLiffBindUrl('fb-contract-9x');
  const liffOrigin = new URL(canonicalUrl);
  const liffIdSegment = `/${liffOrigin.pathname.split('/')[1]}`; // "/2011272555-MAtmaEy4"
  const extraAfterLiffId = liffOrigin.pathname.slice(liffIdSegment.length); // "/fb-contract-9x" -- what LIFF actually wraps into liff.state

  // The REAL shape LIFF produces: bare Endpoint URL + `?liff.state=<encoded extra path>`.
  const realForwardedUrl = `${ENDPOINT_URL}?liff.state=${encodeURIComponent(extraAfterLiffId)}`;
  check(realForwardedUrl === '/liff/bind?liff.state=%2Ffb-contract-9x', `matches the exact shape observed from a live LIFF redirect (got ${realForwardedUrl})`);

  // server.js: `const urlPath = req.url.split('?')[0]` -- the query string (and liff.state with it) is stripped here.
  const urlPathAfterServerStrip = realForwardedUrl.split('?')[0];
  check(urlPathAfterServerStrip === '/liff/bind', 'server.js\'s own query-strip leaves a bare path with the token gone -- proves handleLiffRoute() cannot skip resolveLiffEffectivePath()');

  // handleLiffRoute() must re-derive the token from req.url's liff.state, not from the already-stripped urlPath.
  const effectivePath = resolveLiffEffectivePath({ url: realForwardedUrl }, urlPathAfterServerStrip);
  check(effectivePath === '/liff/bind/fb-contract-9x', `resolveLiffEffectivePath() reconstructs the real path from liff.state (got ${effectivePath})`);

  mockFeedback = { clientPageId: 'page-1', clientName: 'Somchai', feedbackToken: 'fb-contract-9x' };
  const res = fakeRes();
  const handled = await handleLiffRoute(fakeReq('GET', undefined, realForwardedUrl), res, urlPathAfterServerStrip);
  check(handled === true, 'end-to-end: the URL buildLiffBindUrl() actually generates resolves to a route handleLiffRoute() recognizes, through the REAL liff.state shape');
  check(res.statusCode === 200, 'and that route serves the bind page (200), not a 404 -- this is the exact request shape that 404\'d on a real phone before this fix');
  check(res.body.includes('/api/liff/bind/fb-contract-9x'), 'and the served page posts back using the SAME token buildLiffBindUrl() was given -- nothing lost in the round trip');
}

console.log('\n=== GET /liff/bind/:token (page) ===');
{
  mockFeedback = { clientPageId: 'page-1', clientName: 'Somchai', feedbackToken: 'fb-test' };
  const res = fakeRes();
  const handled = await handleLiffRoute(fakeReq('GET'), res, '/liff/bind/fb-test');
  check(handled === true, 'route matched');
  check(res.statusCode === 200, 'known token => 200');
  check(res.body.includes('2011272555-MAtmaEy4'), 'page embeds the LIFF ID for liff.init()');
  check(res.body.includes('/api/liff/bind/fb-test'), 'page posts back to the token-specific bind API path');
}
{
  mockFeedback = null;
  const res = fakeRes();
  await handleLiffRoute(fakeReq('GET'), res, '/liff/bind/unknown-token');
  check(res.statusCode === 404, 'unknown token => 404, not a silent 200');
}

console.log('\n=== POST /api/liff/bind/:token (bind) ===');
async function postBind(linkResult, opts = {}) {
  mockLinkResult = linkResult;
  mockSendCaseResultCalls = [];
  mockSendCaseResultThrows = opts.sendThrows || null;
  const fetchImpl = opts.fetchImpl || (async () => ({ ok: true, json: async () => ({ sub: 'Uabc123', aud: '2011272555', name: 'Somchai' }) }));
  return withFetch(fetchImpl, async () => {
    const res = fakeRes();
    await handleLiffRoute(fakeReq('POST', { idToken: 'tok' }), res, '/api/liff/bind/fb-test');
    return res;
  });
}

{
  const res = await postBind({ linked: true, alreadyLinked: false, feedbackToken: 'fb-test', caseId: 'case-1', pendingAutoSend: false });
  const data = JSON.parse(res.body);
  check(res.statusCode === 200 && data.ok === true && data.reason === 'linked', 'fresh bind => 200 ok, reason=linked');
  check(mockSendCaseResultCalls.length === 0, 'no pending result => sendCaseResult NOT called');
}
{
  const res = await postBind({ linked: true, alreadyLinked: false, feedbackToken: 'fb-test', caseId: 'case-1', pendingAutoSend: true });
  const data = JSON.parse(res.body);
  check(data.ok === true && data.pendingAutoSend === true, 'bind with a completed-but-unsent case => pendingAutoSend true in response');
  check(mockSendCaseResultCalls.length === 1 && mockSendCaseResultCalls[0] === 'fb-test', 'pendingAutoSend => sendCaseResult(feedbackToken) called exactly once, matching the manual chat flow\'s convention (api/line-routes.js uses feedbackToken as the caseId arg, not linked.caseId)');
}
{
  const res = await postBind({ linked: true, alreadyLinked: true, reason: 'already_linked', feedbackToken: 'fb-test' });
  const data = JSON.parse(res.body);
  check(data.ok === true && data.reason === 'already_linked', 'idempotent re-bind (same user) => ok, reason=already_linked');
}
{
  const res = await postBind({ linked: false, reason: 'linked_to_another_user' });
  const data = JSON.parse(res.body);
  check(res.statusCode === 409 && data.ok === false && data.reason === 'linked_to_another_user', 'token already bound to a DIFFERENT LINE account => 409, never silently overwritten');
}
{
  const res = await postBind({ linked: false, reason: 'feedback_not_found' });
  const data = JSON.parse(res.body);
  check(res.statusCode === 404 && data.ok === false, 'unknown feedback token at bind time => 404');
}
{
  // Spoofing attempt: verify step itself rejects (wrong audience) -- bind must never be attempted.
  const res = await postBind(
    { linked: true, alreadyLinked: false, feedbackToken: 'fb-test', caseId: 'case-1', pendingAutoSend: false },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ sub: 'Uattacker', aud: 'WRONG_CHANNEL', name: 'Attacker' }) }) }
  );
  check(res.statusCode === 401, 'id_token from a different channel => 401 before linkLineUser is ever reached (anti-spoofing)');
}
{
  // sendCaseResult throws -> bind itself must still report success to the customer.
  const res = await postBind(
    { linked: true, alreadyLinked: false, feedbackToken: 'fb-test', caseId: 'case-1', pendingAutoSend: true },
    { sendThrows: new Error('line push failed') }
  );
  const data = JSON.parse(res.body);
  check(res.statusCode === 200 && data.ok === true, 'sendCaseResult failing after a successful bind does not fail the bind response (best-effort auto-send)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
