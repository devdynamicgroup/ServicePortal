/**
 * Offline migration/reconcile weak-match guard (2026-08-27, follow-up
 * forensic fix).
 *
 * The live request path (services/customer-domain/resolver.js) already
 * refuses to auto-link a Case to a Customer on phone/email-only evidence
 * (see scripts/test-customer-domain-weak-match-guard.js). This session's
 * audit found the SAME bug living in two offline tools that reimplemented
 * their own candidate matching instead of going through resolver.js:
 *
 *   - services/migration/customer-backfill.js:planForCase() -- a unique
 *     phone-only or email-only candidate was treated exactly like a LINE
 *     match ('action: match'), writing Case.customerId/customerPageId
 *     directly.
 *   - services/migration/customer-reconcile/repair.js:proposeRepairs()
 *     ('link_missing') -- same pattern via findUniqueCustomerForCase(),
 *     writing through linkCaseToCustomer() directly.
 *
 * Both are now fixed to share the SAME strength classification the live
 * path uses -- services/customer-domain/matcher.js:isStrongMatch(), a
 * single exported function neither tool re-derives. This file proves both
 * tools now downgrade a weak candidate to a report-only outcome (no write),
 * while a real LINE-channel match still proceeds normally in both.
 *
 * Run: node scripts/test-migration-weak-match-guard.js
 */
'use strict';
const assert = require('assert');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
function check(fn, name) { try { fn(); ok(name); } catch (e) { fail(name, e); } }
async function checkAsync(fn, name) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }

console.log('=== customer-backfill.js: planForCase() ===');
{
  const { planForCase, indexCustomers, emptyReport } = require('../services/migration/customer-backfill');

  const CUSTOMER_A = { customerId: 'cust_a', notionPageId: 'page-a', phone: '66812345678', email: 'a@example.com', lineUserId: 'U_A' };

  check(() => {
    const index = indexCustomers([CUSTOMER_A]);
    const report = emptyReport({});
    const identity = { caseNotionId: 'case-1', displayName: 'B', phone: '66812345678', email: '', lineUserId: '', hasStrong: true, eligible: true, linkedCustomerId: '' };
    const plan = planForCase(identity, index, report);
    assert.strictEqual(plan.action, 'weak_candidate', 'a unique phone-only candidate must be report-only, not action:"match"');
    assert.strictEqual(plan.via, 'phone');
    assert.strictEqual(plan.customerId, 'cust_a', 'candidate id still surfaced for human review');
  }, 'phone-only unique candidate -> weak_candidate (no write)');

  check(() => {
    const index = indexCustomers([CUSTOMER_A]);
    const report = emptyReport({});
    const identity = { caseNotionId: 'case-2', displayName: 'B', phone: '', email: 'a@example.com', lineUserId: '', hasStrong: true, eligible: true, linkedCustomerId: '' };
    const plan = planForCase(identity, index, report);
    assert.strictEqual(plan.action, 'weak_candidate');
    assert.strictEqual(plan.via, 'email');
  }, 'email-only unique candidate -> weak_candidate (no write)');

  check(() => {
    const index = indexCustomers([CUSTOMER_A]);
    const report = emptyReport({});
    const identity = { caseNotionId: 'case-3', displayName: 'B', phone: '66812345678', email: 'a@example.com', lineUserId: '', hasStrong: true, eligible: true, linkedCustomerId: '' };
    const plan = planForCase(identity, index, report);
    assert.strictEqual(plan.action, 'weak_candidate', 'phone+email together is still weak evidence, not proof of LINE ownership');
  }, 'phone+email unique candidate -> still weak_candidate');

  check(() => {
    const index = indexCustomers([CUSTOMER_A]);
    const report = emptyReport({});
    const identity = { caseNotionId: 'case-4', displayName: 'B', phone: '', email: '', lineUserId: 'U_A', hasStrong: true, eligible: true, linkedCustomerId: '' };
    const plan = planForCase(identity, index, report);
    assert.strictEqual(plan.action, 'match', 'a real LINE match must still be proposed for write, unaffected by the guard');
    assert.strictEqual(plan.customerId, 'cust_a');
  }, 'LINE match -> action:"match" unaffected');
}

console.log('\n=== customer-reconcile/repair.js: proposeRepairs("link_missing") ===');
{
  const { proposeRepairs } = require('../services/migration/customer-reconcile/repair');

  const job = (overrides = {}) => ({
    notionId: overrides.notionId,
    id: overrides.notionId,
    line: { userId: overrides.lineUserId || '' },
    customer: { id: overrides.customerId || '' },
    draft: { fields: { 'ci-phone': overrides.phone || '', 'ci-email': overrides.email || '' } }
  });
  const customer = (overrides = {}) => ({
    customerId: overrides.customerId,
    notionPageId: overrides.notionPageId || `pg_${overrides.customerId}`,
    phone: overrides.phone || '',
    email: overrides.email || '',
    lineUserId: overrides.lineUserId || '',
    status: 'active'
  });

  check(() => {
    const jobs = [job({ notionId: 'n-phone', phone: '0812340000' })];
    const customers = [customer({ customerId: 'cust_p', phone: '66812340000' })];
    const findings = [{ type: 'missing_customer_link', caseNotionId: 'n-phone' }];
    const proposals = proposeRepairs('link_missing', { findings, jobs, customers });
    assert.strictEqual(proposals.length, 1);
    assert.strictEqual(proposals[0].status, 'skipped', 'a unique phone-only match must be skipped, not proposed for write');
    assert.strictEqual(proposals[0].reason, 'weak_evidence_no_auto_link');
    assert.strictEqual(proposals[0].customerId, 'cust_p', 'candidate id still surfaced for review even though skipped');
  }, 'phone-only unique match -> skipped (weak_evidence_no_auto_link)');

  check(() => {
    const jobs = [job({ notionId: 'n-email', email: 'a@example.com' })];
    const customers = [customer({ customerId: 'cust_e', email: 'a@example.com' })];
    const findings = [{ type: 'missing_customer_link', caseNotionId: 'n-email' }];
    const proposals = proposeRepairs('link_missing', { findings, jobs, customers });
    assert.strictEqual(proposals[0].status, 'skipped');
    assert.strictEqual(proposals[0].reason, 'weak_evidence_no_auto_link');
  }, 'email-only unique match -> skipped (weak_evidence_no_auto_link)');

  check(() => {
    const jobs = [job({ notionId: 'n-both', phone: '0812340000', email: 'a@example.com' })];
    const customers = [customer({ customerId: 'cust_b', phone: '66812340000', email: 'a@example.com' })];
    const findings = [{ type: 'missing_customer_link', caseNotionId: 'n-both' }];
    const proposals = proposeRepairs('link_missing', { findings, jobs, customers });
    assert.strictEqual(proposals[0].status, 'skipped', 'phone+email together is still not sufficient');
    assert.strictEqual(proposals[0].reason, 'weak_evidence_no_auto_link');
  }, 'phone+email unique match -> still skipped');

  check(() => {
    const jobs = [job({ notionId: 'n-line', lineUserId: 'U_MATCH' })];
    const customers = [customer({ customerId: 'cust_m', lineUserId: 'U_MATCH' })];
    const findings = [{ type: 'missing_customer_link', caseNotionId: 'n-line' }];
    const proposals = proposeRepairs('link_missing', { findings, jobs, customers });
    assert.strictEqual(proposals[0].status, 'proposed', 'a real LINE match must still be proposed for write, unaffected by the guard');
    assert.strictEqual(proposals[0].customerId, 'cust_m');
  }, 'LINE match -> still proposed (unaffected)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
