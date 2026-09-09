/**
 * Weak-signal Customer match guard (2026-08-27, forensic trace fix).
 *
 * Root cause traced end-to-end: Case creation/Complete calls
 * dualWriteAfterCaseSuccess -> resolveAndLinkCustomer -> matchCustomer.
 * matchCustomer treats a phone (or email) hit exactly the same as a LINE
 * hit -- both collapse into status:'one', and resolver.js used to write
 * customerId/customerPageId onto the NEW Case for ANY status:'one' match,
 * regardless of which channel produced it. A phone number is a signal, not
 * proof of identity (it can be reused, reassigned, or mistyped) -- so a
 * phone-only match must never let a brand-new Case inherit an existing
 * Customer's LINE identity as a notification destination. This is currently
 * inert in production (CUSTOMER_DOMAIN_ENABLED=false) but the flag can be
 * turned on later without a second forensic pass if the guard is already in
 * place -- see services/customer-domain/resolver.js's STRONG_MATCH_CHANNELS.
 *
 * This test monkeypatches matchCustomer (services/customer-domain/matcher.js)
 * and linkCaseToCustomer/createCustomerFromIdentity/applyIdentityPatch
 * BEFORE requiring resolver.js, so resolver's own destructured references
 * point at the stubs (same technique used for line-routes.js tests earlier
 * this session) -- no real Notion calls happen.
 *
 * Run: node scripts/test-customer-domain-weak-match-guard.js
 */
'use strict';
const assert = require('assert');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
async function checkAsync(fn, name) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }

const matcherModule = require('../services/customer-domain/matcher');
const linkerModule = require('../services/customer-domain/linker');
const creatorModule = require('../services/customer-domain/creator');

let mockMatch = { status: 'none', customers: [], via: [] };
let linkCalls = 0;
let patchCalls = 0;

matcherModule.matchCustomer = async () => mockMatch;
linkerModule.linkCaseToCustomer = async (caseNotionId, customer) => {
  linkCalls += 1;
  return { caseId: caseNotionId, customerId: customer.customerId, customerPageId: 'page-x', job: {} };
};
creatorModule.applyIdentityPatch = async (customerId, input, options) => {
  patchCalls += 1;
  return { customerId, notionPageId: 'page-x' };
};
let allowCreate = false;
creatorModule.createCustomerFromIdentity = async () => {
  if (!allowCreate) throw new Error('should not create a new Customer in this test');
  return { customerId: 'cust_brand_new', notionPageId: 'page-new' };
};

const { resolveAndLinkCustomer } = require('../services/customer-domain/resolver');

const EXISTING_CUSTOMER = { customerId: 'cust_existing', notionPageId: 'page-x', lineUserId: 'U_original_owner', phone: '66812340000' };

(async () => {
  await checkAsync(async () => {
    linkCalls = 0; patchCalls = 0;
    mockMatch = { status: 'one', customers: [EXISTING_CUSTOMER], via: ['phone'] };
    const result = await resolveAndLinkCustomer({
      caseNotionId: 'case-new-1',
      identity: { phone: '0812340000', name: 'New Person Same Phone' }
    });
    assert.strictEqual(result.status, 'weak_match', 'phone-only match must not be reported as matched/linked');
    assert.strictEqual(linkCalls, 0, 'must NOT call linkCaseToCustomer for a phone-only match -- this is the exact write that used to leak the Case to the wrong Customer');
    assert.strictEqual(patchCalls, 0, 'must NOT patch the existing Customer record from an unrelated new Case\'s identity');
    assert.strictEqual(result.customerId, 'cust_existing', 'customerId still surfaced for observability/logging, even though no link was written');
    assert.strictEqual(result.conflicts[0].type, 'weak_signal_match');
  }, 'a phone-only match ("one" via phone) is downgraded to weak_match: no link written, no identity patch applied');

  await checkAsync(async () => {
    linkCalls = 0; patchCalls = 0;
    mockMatch = { status: 'one', customers: [EXISTING_CUSTOMER], via: ['email'] };
    const result = await resolveAndLinkCustomer({
      caseNotionId: 'case-new-2',
      identity: { email: 'x@example.com' }
    });
    assert.strictEqual(result.status, 'weak_match');
    assert.strictEqual(linkCalls, 0);
  }, 'an email-only match is also downgraded to weak_match (email is equally reassignable/typo-prone)');

  await checkAsync(async () => {
    linkCalls = 0; patchCalls = 0;
    mockMatch = { status: 'one', customers: [EXISTING_CUSTOMER], via: ['phone', 'email'] };
    const result = await resolveAndLinkCustomer({
      caseNotionId: 'case-new-3',
      identity: { phone: '0812340000', email: 'x@example.com' }
    });
    assert.strictEqual(result.status, 'weak_match', 'stacking two weak channels is still not proof of identity');
    assert.strictEqual(linkCalls, 0);
  }, 'phone+email together (no line/customerId) is still weak_match, not matched');

  await checkAsync(async () => {
    linkCalls = 0; patchCalls = 0;
    mockMatch = { status: 'one', customers: [EXISTING_CUSTOMER], via: ['line'] };
    const result = await resolveAndLinkCustomer({
      caseNotionId: 'case-new-4',
      identity: { lineUserId: 'U_original_owner' }
    });
    assert.strictEqual(result.status, 'matched', 'a real LINE-channel match is still authoritative and unaffected by this guard');
    assert.strictEqual(linkCalls, 1, 'the Case IS linked when the match came via LINE');
  }, 'a LINE match (via: ["line"]) is unaffected -- still links normally, proving the guard is scoped to weak channels only');

  await checkAsync(async () => {
    linkCalls = 0; patchCalls = 0;
    mockMatch = { status: 'one', customers: [EXISTING_CUSTOMER], via: ['customerId'] };
    const result = await resolveAndLinkCustomer({
      caseNotionId: 'case-new-5',
      existingCustomerId: 'cust_existing',
      identity: { phone: '0812340000' }
    });
    assert.strictEqual(result.status, 'linked', 'a Case that already carried this exact customerId forward is still treated as authoritative (re-confirmation, not a fresh phone inference)');
    assert.strictEqual(linkCalls, 1);
  }, 'an existingCustomerId match (via: ["customerId"]) is unaffected -- re-affirms a link the Case already had');

  await checkAsync(async () => {
    linkCalls = 0; patchCalls = 0;
    mockMatch = { status: 'none', customers: [], via: [] };
    allowCreate = true;
    const result = await resolveAndLinkCustomer({
      caseNotionId: 'case-new-6',
      identity: { phone: '0899999999', name: 'Brand New Person' }
    });
    assert.strictEqual(result.status, 'created', 'no existing match at all -- create + link path is unaffected by this guard');
    assert.strictEqual(linkCalls, 1);
  }, 'status:"none" (no candidate at all) still creates + links a brand-new Customer as before');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
