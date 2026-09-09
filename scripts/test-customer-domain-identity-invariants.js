/**
 * Customer Domain identity invariants (2026-08-27, follow-up forensic pass).
 *
 * scripts/test-customer-domain-weak-match-guard.js proves resolver.js's own
 * branch logic in isolation (matchCustomer itself is mocked there). This
 * file closes the gaps that isolation can't reach:
 *
 *   1. Real +66/0-prefix phone normalization (services/customer-domain/
 *      validate.js:normalizePhone) actually collapses all three input
 *      formats to the SAME matcher.js candidate -- proving normalization
 *      is real, while still proving the fix means a phone match alone is
 *      never enough to link.
 *   2. Two Customers sharing the same normalized phone must fail CLOSED
 *      (ambiguous, no link) -- not silently pick the first/newest/whichever
 *      has a LINE id.
 *   3. A weak_match now does not permanently poison a Case -- a later call
 *      carrying a real lineUserId (the explicit LINE-bind path) still
 *      succeeds and links normally.
 *   4. The actual notification path (services/customer-domain/notify-
 *      reader.js) is exercised end-to-end for a Case left unlinked by a
 *      weak_match: it must fall back to Case-only and never resolve to
 *      the phone-matched Customer's LINE id, even in 'primary' read mode.
 *
 * Technique: matcher.js accesses `repository.findAllByPhone` etc. via
 * property lookup on the whole imported module object (not destructured),
 * so repository's exports can be stubbed with an in-memory Customer list
 * AFTER matcher.js is required -- unlike resolver.js's own destructured
 * `const { matchCustomer } = require('./matcher')`, which is why the
 * earlier test file mocks matchCustomer directly instead. This lets this
 * file exercise the REAL matcher.js + REAL resolver.js + REAL
 * normalizePhone, with only the Notion I/O stubbed out.
 *
 * Run: node scripts/test-customer-domain-identity-invariants.js
 */
'use strict';
const assert = require('assert');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
async function checkAsync(fn, name) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }

const repository = require('../services/customer-domain/repository');
const linker = require('../services/customer-domain/linker');
const creator = require('../services/customer-domain/creator');

// ---- in-memory Customer store, stubbed onto repository BEFORE matcher/resolver run ----
let customers = [];
repository.findByCustomerId = async (id) => customers.find(c => c.customerId === String(id || '').trim()) || null;
repository.findAllByLineUserId = async (lineUserId) => {
  const id = String(lineUserId || '').trim();
  return id ? customers.filter(c => String(c.lineUserId || '').trim() === id) : [];
};
repository.findAllByPhone = async (normalizedPhone) => {
  return normalizedPhone ? customers.filter(c => c.phone === normalizedPhone) : [];
};
repository.findAllByEmail = async (normalizedEmail) => {
  return normalizedEmail ? customers.filter(c => c.email === normalizedEmail) : [];
};

let linkCalls = [];
linker.linkCaseToCustomer = async (caseNotionId, customer) => {
  linkCalls.push({ caseNotionId, customerId: customer.customerId });
  return { caseId: caseNotionId, customerId: customer.customerId, customerPageId: customer.notionPageId || 'page-x', job: {} };
};
creator.applyIdentityPatch = async (customerId) => customers.find(c => c.customerId === customerId) || null;
creator.createCustomerFromIdentity = async () => {
  throw new Error('unexpected create in these scenarios');
};

const { resolveAndLinkCustomer } = require('../services/customer-domain/resolver');
const { resolveNotifyLineDestination } = require('../services/customer-domain/notify-reader');
const { normalizePhone } = require('../services/customer-domain/validate');

const CUSTOMER_A = { customerId: 'cust_a', notionPageId: 'page-a', phone: '66812345678', email: 'a@example.com', lineUserId: 'U_A' };

(async () => {
  // ---- 1. real +66 normalization ----
  for (const rawPhone of ['0812345678', '+66812345678', '66812345678']) {
    await checkAsync(async () => {
      assert.strictEqual(normalizePhone(rawPhone), '66812345678', 'sanity: all 3 formats normalize identically');
      customers = [CUSTOMER_A];
      linkCalls = [];
      const result = await resolveAndLinkCustomer({
        caseNotionId: `case-norm-${rawPhone}`,
        identity: { phone: rawPhone }
      });
      assert.strictEqual(result.status, 'weak_match', `input format "${rawPhone}" must still be treated as weak evidence, not proof of LINE ownership`);
      assert.strictEqual(linkCalls.length, 0, 'normalization finding the same candidate must not itself upgrade trust enough to link');
    }, `real normalizePhone("${rawPhone}") matches Customer A but stays weak_match (Section 5/Case A)`);
  }

  // ---- 2. duplicate/conflict fails closed ----
  await checkAsync(async () => {
    const CUSTOMER_B = { customerId: 'cust_b', notionPageId: 'page-b', phone: '66812345678', email: '', lineUserId: 'U_B' };
    customers = [CUSTOMER_A, CUSTOMER_B];
    linkCalls = [];
    const result = await resolveAndLinkCustomer({
      caseNotionId: 'case-conflict-1',
      identity: { phone: '0812345678' }
    });
    assert.strictEqual(result.status, 'ambiguous', 'two Customers sharing a phone must yield an explicit ambiguous/unresolved state, never a guess');
    assert.strictEqual(linkCalls.length, 0, 'no Customer -- not the first, not the newest, not the one with a LINE id -- may be auto-selected');
    assert.strictEqual(result.customerId, null);
  }, 'Customer A + Customer B sharing the same normalized phone: fails closed as ambiguous, picks neither (Section 6)');

  // ---- 3. weak_match now does not block a later explicit LINE bind ----
  await checkAsync(async () => {
    customers = [CUSTOMER_A];
    linkCalls = [];
    const firstAttempt = await resolveAndLinkCustomer({
      caseNotionId: 'case-later-bind',
      identity: { phone: '0812345678' }
    });
    assert.strictEqual(firstAttempt.status, 'weak_match');
    assert.strictEqual(linkCalls.length, 0);

    // Later: the customer does an explicit LINE bind (QR/LIFF/fb-xxxx) --
    // dual-write is re-invoked with a real lineUserId, as
    // workflow-service.js:linkLineUser actually does.
    const secondAttempt = await resolveAndLinkCustomer({
      caseNotionId: 'case-later-bind',
      identity: { lineUserId: 'U_A', phone: '0812345678' }
    });
    assert.strictEqual(secondAttempt.status, 'matched', 'a subsequent real LINE identity must still resolve to a strong match');
    assert.strictEqual(linkCalls.length, 1, 'the explicit bind must be allowed to link -- an earlier weak_match must not have poisoned this Case');
    assert.strictEqual(linkCalls[0].customerId, 'cust_a');
  }, 'a weak_match now does not prevent a correct strong link once the customer explicitly LINE-binds later (Section 7)');

  // ---- 4. notification never inherits a phone-matched Customer's LINE id ----
  await checkAsync(async () => {
    customers = [CUSTOMER_A];
    // Simulate the Case exactly as weak_match leaves it: no customerId ever
    // written (this is the real shape resolveAndLinkCustomer's caller sees
    // -- job.customer.id stays unset because linkCaseToCustomer was never
    // called).
    const unlinkedJob = { id: 'case-notify-1', notionId: 'case-notify-1', line: { userId: '' }, customer: {} };
    const destination = await resolveNotifyLineDestination(unlinkedJob, {
      flags: { enabled: true, readNotify: true, readNotifyShadow: false },
      deps: { findByCustomerId: repository.findByCustomerId }
    });
    assert.strictEqual(destination.lineUserId, '', 'no destination at all -- must NOT resolve to Customer A\'s U_A just because their phone matched earlier');
    assert.strictEqual(destination.source, 'case', 'falls back to the (empty) Case-owned LINE id, never the Customer path, when Case.customerId was never set');
    assert.notStrictEqual(destination.lineUserId, 'U_A');
  }, 'a Case left unlinked by weak_match never receives Customer A\'s lineUserId as a notification destination, even in primary read mode (Section 8)');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
