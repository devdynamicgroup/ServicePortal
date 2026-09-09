'use strict';

/**
 * ============================================================
 *  MANUAL PRODUCTION TOOL -- NOT A REGRESSION TEST
 *  Split out of scripts/test-package-history-write.js on
 *  2026-09-09 (test-script isolation safety pass) -- this exact
 *  filename pattern (test-*.js) being treated as automatically
 *  safe caused a real incident: re-running "the regression
 *  suite" created 3 unwanted production Notion Cases.
 *
 *  Running this script creates ONE real Case in production
 *  Notion every single time it runs. See scripts/manual-prod/README.md.
 *
 *  The pure/safe unit-test coverage for this same fix (tests 1-7
 *  of the original file) still lives at
 *  scripts/test-package-history-write.js and IS safe to run
 *  generically -- only this live round-trip needed isolating.
 * ============================================================
 *
 * Live production round-trip for the "pkg doesn't persist" fix (2026-09-08):
 * creates a throwaway Case, writes package:'full' through the real
 * submitCustomerPreassessment() API, then re-fetches directly from Notion
 * (not the app's cached HTTP response) to prove the value actually landed --
 * this is the exact check that would have caught the original bug, where
 * the HTTP response was 200 but the "Package History" property never landed
 * (multi_select vs select schema mismatch -- see the full root-cause writeup
 * in scripts/test-package-history-write.js's header comment).
 *
 * Run: node scripts/manual-prod/verify-package-history-live.js
 */

require('dotenv').config();
const { createTestCase, submitCustomerPreassessment } = require('../../services/case-creation-service');
const { getClient } = require('../../services/notion/clients');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

async function main() {
  console.log('=== Live round-trip against real Notion (read-back, not just HTTP 200) ===');
  const created = await createTestCase({
    fullName: `QA-PKG-WRITE-DELETE-ME ${Date.now()}`
  });
  const caseId = created.case.notionId;

  const result = await submitCustomerPreassessment(caseId, {
    fields: {},
    fullName: created.case.name,
    package: 'full'
  });
  assert(result.ok === true, 'submitCustomerPreassessment responds ok:true');

  const rawPage = await getClient(caseId);
  const pkgProp = rawPage?.pkg;
  assert(pkgProp === 'full', `re-fetched Case from Notion shows pkg === 'full' (got "${pkgProp}")`);

  console.log(`  (throwaway test Case created: ${caseId} -- tagged QA-PKG-WRITE-DELETE-ME, needs manual cleanup via cancelAppointment())`);
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(error => {
  console.error('FAILED', error);
  process.exit(1);
});
