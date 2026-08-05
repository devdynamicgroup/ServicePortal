'use strict';

/**
 * M8.5 — Customer LINE read unit/fixture tests (no production flags, no Notion).
 *
 * Usage: node scripts/test-customer-line-read.js
 */

const assert = require('assert');
const {
  resolveLineCustomerCases,
  resolveLineReadMode
} = require('../services/customer-domain/line-reader');
const metrics = require('../services/customer-domain/line-read-metrics');
const { getCustomerDomainFlags } = require('../services/customer-domain/flags');

function job(notionId, extras = {}) {
  return {
    notionId,
    id: notionId,
    result: { publicReportToken: extras.token || `rpt-${notionId}`, reportUrl: '' },
    notification: { resultSentAt: extras.sentAt || '2026-01-01T00:00:00.000Z' },
    ...extras
  };
}

function flags(partial = {}) {
  return {
    enabled: false,
    dualWrite: false,
    readLine: false,
    readLineShadow: false,
    readNotify: false,
    mergeEnabled: false,
    ...partial
  };
}

async function runCase(name, fn) {
  metrics.resetMetrics();
  await fn();
  return { name, ok: true };
}

async function main() {
  const results = [];
  let failed = 0;

  async function test(name, fn) {
    try {
      await runCase(name, fn);
      results.push({ name, ok: true });
      console.log(`PASS  ${name}`);
    } catch (error) {
      failed += 1;
      results.push({ name, ok: false, error: error.message });
      console.error(`FAIL  ${name}: ${error.message}`);
    }
  }

  // Mode matrix
  assert.strictEqual(resolveLineReadMode(flags()), 'case_only');
  assert.strictEqual(resolveLineReadMode(flags({ enabled: true, readLine: true })), 'primary');
  assert.strictEqual(
    resolveLineReadMode(flags({ enabled: true, readLineShadow: true })),
    'shadow'
  );
  assert.strictEqual(
    resolveLineReadMode(flags({ enabled: true, readLine: true, readLineShadow: true })),
    'primary'
  );
  assert.strictEqual(
    resolveLineReadMode(flags({ enabled: true, readNotify: true })),
    'case_only'
  );

  // 1) flags OFF — Case only; no Customer calls
  await test('1. flags OFF keeps Case-only behavior', async () => {
    let customerCalls = 0;
    let caseCalls = 0;
    const caseJobs = [job('case-a')];
    const resolved = await resolveLineCustomerCases('U_LINE_1', {
      flags: flags(),
      deps: {
        findClientsByLineUserId: async () => {
          caseCalls += 1;
          return caseJobs;
        },
        findAllByLineUserId: async () => {
          customerCalls += 1;
          return [];
        },
        findClientsByCustomerId: async () => {
          customerCalls += 1;
          return [];
        }
      }
    });
    assert.strictEqual(caseCalls, 1);
    assert.strictEqual(customerCalls, 0);
    assert.strictEqual(resolved.linked, true);
    assert.strictEqual(resolved.jobs.length, 1);
    assert.strictEqual(resolved.latest?.notionId, 'case-a');
    assert.ok(resolved.withReport.length === 1);
    const snap = metrics.getSnapshot();
    assert.strictEqual(snap.mode, 'case_only');
    assert.strictEqual(snap.totalLookups, 1);
    assert.strictEqual(snap.casePrimaryHits, 1);
    assert.strictEqual(snap.customerHits, 0);
  });

  // 2) Customer exact match (primary)
  await test('2. Customer exact LINE match (primary)', async () => {
    let caseLineCalls = 0;
    const custJobs = [job('case-linked')];
    const resolved = await resolveLineCustomerCases('U_LINE_2', {
      flags: flags({ enabled: true, readLine: true }),
      deps: {
        findClientsByLineUserId: async () => {
          caseLineCalls += 1;
          return [job('case-line-only')];
        },
        findAllByLineUserId: async (id) => {
          assert.strictEqual(id, 'U_LINE_2');
          return [{ customerId: 'cust_exact_1', lineUserId: id }];
        },
        findClientsByCustomerId: async (cid) => {
          assert.strictEqual(cid, 'cust_exact_1');
          return custJobs;
        }
      }
    });
    assert.strictEqual(caseLineCalls, 0, 'primary hit must not fall back');
    assert.strictEqual(resolved.latest?.notionId, 'case-linked');
    const snap = metrics.getSnapshot();
    assert.strictEqual(snap.mode, 'primary');
    assert.strictEqual(snap.customerHits, 1);
    assert.strictEqual(snap.caseFallbacks, 0);
  });

  // 3) missing Customer → Case fallback
  await test('3. missing Customer → Case fallback', async () => {
    const resolved = await resolveLineCustomerCases('U_MISSING', {
      flags: flags({ enabled: true, readLine: true }),
      deps: {
        findClientsByLineUserId: async () => [job('case-fallback')],
        findAllByLineUserId: async () => [],
        findClientsByCustomerId: async () => {
          throw new Error('should not query Cases by Customer when miss');
        }
      }
    });
    assert.strictEqual(resolved.latest?.notionId, 'case-fallback');
    const snap = metrics.getSnapshot();
    assert.strictEqual(snap.customerMisses, 1);
    assert.strictEqual(snap.caseFallbacks, 1);
  });

  // 4) Customer exists but no Cases → missingLinks + Case fallback
  await test('4. Customer exists but no Cases → fallback', async () => {
    const resolved = await resolveLineCustomerCases('U_NOLINK', {
      flags: flags({ enabled: true, readLine: true }),
      deps: {
        findClientsByLineUserId: async () => [job('case-old-line')],
        findAllByLineUserId: async () => [{ customerId: 'cust_empty', lineUserId: 'U_NOLINK' }],
        findClientsByCustomerId: async () => []
      }
    });
    assert.strictEqual(resolved.latest?.notionId, 'case-old-line');
    const snap = metrics.getSnapshot();
    assert.strictEqual(snap.missingLinks, 1);
    assert.strictEqual(snap.caseFallbacks, 1);
  });

  // 5) duplicate LINE conflict — no guessing
  await test('5. duplicate LINE conflict → Case fallback', async () => {
    let customerIdQueries = 0;
    const resolved = await resolveLineCustomerCases('U_DUP', {
      flags: flags({ enabled: true, readLine: true }),
      deps: {
        findClientsByLineUserId: async () => [job('case-from-line')],
        findAllByLineUserId: async () => [
          { customerId: 'cust_a', lineUserId: 'U_DUP' },
          { customerId: 'cust_b', lineUserId: 'U_DUP' }
        ],
        findClientsByCustomerId: async () => {
          customerIdQueries += 1;
          return [job('should-not-use')];
        }
      }
    });
    assert.strictEqual(customerIdQueries, 0, 'must not pick a Customer on conflict');
    assert.strictEqual(resolved.latest?.notionId, 'case-from-line');
    const snap = metrics.getSnapshot();
    assert.strictEqual(snap.conflicts, 1);
    assert.strictEqual(snap.caseFallbacks, 1);
  });

  // 6) shadow mismatch detection — reply still Case
  await test('6. shadow mismatch detection', async () => {
    const resolved = await resolveLineCustomerCases('U_SHADOW', {
      flags: flags({ enabled: true, readLineShadow: true }),
      deps: {
        findClientsByLineUserId: async () => [job('case-only')],
        findAllByLineUserId: async () => [{ customerId: 'cust_s', lineUserId: 'U_SHADOW' }],
        findClientsByCustomerId: async () => [job('case-cust')]
      }
    });
    assert.strictEqual(resolved.latest?.notionId, 'case-only', 'shadow reply is Case');
    const snap = metrics.getSnapshot();
    assert.strictEqual(snap.mode, 'shadow');
    assert.strictEqual(snap.casePrimaryHits, 1);
    assert.strictEqual(snap.customerHits, 1);
    assert.strictEqual(snap.mismatches, 1);
  });

  // 7) READ_NOTIFY isolation
  await test('7. READ_NOTIFY remains untouched / does not change mode', async () => {
    let customerCalls = 0;
    const resolved = await resolveLineCustomerCases('U_NOTIFY', {
      flags: flags({ enabled: true, readNotify: true }),
      deps: {
        findClientsByLineUserId: async () => [job('case-notify')],
        findAllByLineUserId: async () => {
          customerCalls += 1;
          return [];
        },
        findClientsByCustomerId: async () => {
          customerCalls += 1;
          return [];
        }
      }
    });
    assert.strictEqual(customerCalls, 0);
    assert.strictEqual(resolved.latest?.notionId, 'case-notify');
    assert.strictEqual(resolveLineReadMode(flags({ enabled: true, readNotify: true })), 'case_only');
    // line-reader must not read notification modules
    assert.strictEqual(typeof require('../services/customer-domain/line-reader').resolveLineCustomerCases, 'function');
  });

  // Process env defaults remain OFF (this process should not have them set for CI)
  const live = getCustomerDomainFlags();
  console.log('\nFlag defaults in this process:', {
    CUSTOMER_DOMAIN_ENABLED: live.enabled,
    CUSTOMER_DOMAIN_READ_LINE: live.readLine,
    CUSTOMER_DOMAIN_READ_LINE_SHADOW: live.readLineShadow,
    CUSTOMER_DOMAIN_READ_NOTIFY: live.readNotify
  });

  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
