/**
 * Regression suite for the poster-vs-full-report routing fix (2026-08-26).
 *
 * Direct request: the customer-facing report (/r/{token}) and the LINE
 * result message should both be driven by the customer's actual package
 * choice (Essential = free poster/short message, Full Assessment = paid
 * Water Score page/full message) -- not by campaignOffer (how the Case was
 * originally booked), which could diverge from the package the customer
 * actually selected in the pre-assessment form.
 *
 *   api/case-flow-routes.js:isFreeInspectionJob(job)
 *   services/line-result-resolver.js:resolveResultType(job)
 *
 * Both now read job.pkg exclusively. Extracts the real function out of
 * case-flow-routes.js via regex (it isn't exported, matching this
 * codebase's established testing convention for route-internal helpers);
 * resolveResultType is imported directly since it IS exported.
 *
 * Run: node scripts/test-report-package-routing.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const ROOT = 'D:/Service Portal';

console.log('=== isFreeInspectionJob(job) — report page routing ===');
{
  const src = fs.readFileSync(path.join(ROOT, 'api/case-flow-routes.js'), 'utf8');
  const fnMatch = src.match(/function isFreeInspectionJob\(job\) \{[\s\S]*?\n\}/);
  assert(!!fnMatch, 'isFreeInspectionJob() found in case-flow-routes.js (test in sync)');
  if (fnMatch) {
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(fnMatch[0], sandbox, { filename: 'case-flow-routes.js (isFreeInspectionJob excerpt)' });

    assert(sandbox.isFreeInspectionJob({ pkg: 'essential' }) === true, 'pkg=essential => poster (free) report');
    assert(sandbox.isFreeInspectionJob({ pkg: 'full' }) === false, 'pkg=full => full Water Score report');
    assert(sandbox.isFreeInspectionJob({}) === true, 'no pkg at all => defaults to poster (matches mapper.js\'s own "essential" default), not silently promoted to full');
    assert(sandbox.isFreeInspectionJob({ pkg: 'FULL' }) === true, 'pkg is case-sensitive by design -- "FULL" (wrong case) is NOT treated as full, fails safe to poster rather than guessing');
    assert(sandbox.isFreeInspectionJob({ campaignOffer: 'Launch Offer 2026', pkg: 'full' }) === false, 'pkg wins over campaignOffer: a Full Assessment customer who booked via a campaign link still gets the full report, not the poster');
    assert(sandbox.isFreeInspectionJob({ campaignOffer: '', pkg: 'essential' }) === true, 'pkg wins over campaignOffer the other way too: an Essential customer booked outside any campaign still gets the poster');
    assert(sandbox.isFreeInspectionJob(null) === true, 'null job does not throw, fails safe to poster');
    assert(sandbox.isFreeInspectionJob(undefined) === true, 'undefined job does not throw, fails safe to poster');
  }
}

console.log('\n=== resolveResultType(job) — LINE message variant routing ===');
{
  const { resolveResultType, RESULT_TYPES } = require(path.join(ROOT, 'services/line-result-resolver'));

  assert(resolveResultType({ pkg: 'essential' }) === RESULT_TYPES.FREE_WATER_CHECK, 'pkg=essential => free-style LINE message');
  assert(resolveResultType({ pkg: 'full' }) === RESULT_TYPES.PAID_ASSESSMENT, 'pkg=full => paid-style LINE message');
  assert(resolveResultType({}) === RESULT_TYPES.FREE_WATER_CHECK, 'no pkg at all => defaults to free-style, not silently promoted to paid');
  assert(resolveResultType({ campaignOffer: 'Launch Offer 2026', pkg: 'full' }) === RESULT_TYPES.PAID_ASSESSMENT, 'pkg wins over campaignOffer: a Full Assessment customer from a campaign link still gets the paid-style message');
  assert(resolveResultType({ campaignOffer: '', pkg: 'essential' }) === RESULT_TYPES.FREE_WATER_CHECK, 'pkg wins over campaignOffer the other way too');
  assert(resolveResultType(null) === RESULT_TYPES.FREE_WATER_CHECK, 'null job does not throw, fails safe to free-style');

  // The two surfaces (report page + LINE message) must agree for the same job shape --
  // this is the actual bug that was reported (customer saw inconsistent treatment).
  const src = fs.readFileSync(path.join(ROOT, 'api/case-flow-routes.js'), 'utf8');
  const fnMatch = src.match(/function isFreeInspectionJob\(job\) \{[\s\S]*?\n\}/);
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(fnMatch[0], sandbox, { filename: 'case-flow-routes.js (isFreeInspectionJob excerpt)' });
  for (const job of [{ pkg: 'essential' }, { pkg: 'full' }, {}, { campaignOffer: 'Launch Offer 2026', pkg: 'full' }]) {
    const reportIsFree = sandbox.isFreeInspectionJob(job);
    const lineIsFree = resolveResultType(job) === RESULT_TYPES.FREE_WATER_CHECK;
    assert(reportIsFree === lineIsFree, `report page and LINE message agree for ${JSON.stringify(job)} (report free=${reportIsFree}, line free=${lineIsFree})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
