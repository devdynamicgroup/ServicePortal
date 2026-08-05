'use strict';

/**
 * M8.6 — Customer notification destination read fixture tests (no Notion, no flags on).
 *
 * Usage: node scripts/test-customer-notify-read.js
 */

const assert = require('assert');
const {
  resolveNotifyLineDestination,
  resolveNotifyReadMode,
  applyDestinationToJob
} = require('../services/customer-domain/notify-reader');
const metrics = require('../services/customer-domain/notify-read-metrics');
const { getCustomerDomainFlags } = require('../services/customer-domain/flags');
const { resolveLineReadMode } = require('../services/customer-domain/line-reader');

function flags(partial = {}) {
  return {
    enabled: false,
    dualWrite: false,
    readLine: false,
    readLineShadow: false,
    readNotify: false,
    readNotifyShadow: false,
    mergeEnabled: false,
    ...partial
  };
}

function job(partial = {}) {
  return {
    id: 'case-1',
    notionId: 'notion-1',
    customer: { id: '', pageId: '' },
    line: { userId: 'U_CASE_LINE_AAAAAAAA' },
    notification: { status: 'ready' },
    ...partial,
    customer: { id: '', pageId: '', ...(partial.customer || {}) },
    line: { userId: 'U_CASE_LINE_AAAAAAAA', ...(partial.line || {}) },
    notification: { status: 'ready', ...(partial.notification || {}) }
  };
}

async function test(name, fn) {
  metrics.resetMetrics();
  try {
    await fn();
    console.log(`PASS  ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL  ${name}: ${error.message}`);
    return false;
  }
}

async function main() {
  let passed = 0;
  let total = 0;

  async function run(name, fn) {
    total += 1;
    if (await test(name, fn)) passed += 1;
  }

  assert.strictEqual(resolveNotifyReadMode(flags()), 'case_only');
  assert.strictEqual(resolveNotifyReadMode(flags({ enabled: true, readNotify: true })), 'primary');
  assert.strictEqual(
    resolveNotifyReadMode(flags({ enabled: true, readNotifyShadow: true })),
    'shadow'
  );
  assert.strictEqual(
    resolveNotifyReadMode(flags({ enabled: true, readNotify: true, readNotifyShadow: true })),
    'primary'
  );

  await run('1. flags OFF → Case LINE, no Customer calls', async () => {
    let customerCalls = 0;
    const input = job();
    const resolved = await resolveNotifyLineDestination(input, {
      flags: flags(),
      deps: {
        findByCustomerId: async () => {
          customerCalls += 1;
          return null;
        }
      }
    });
    assert.strictEqual(customerCalls, 0);
    assert.strictEqual(resolved.lineUserId, 'U_CASE_LINE_AAAAAAAA');
    assert.strictEqual(resolved.source, 'case');
    assert.strictEqual(resolved.mode, 'case_only');
    assert.strictEqual(metrics.getSnapshot().casePrimaryHits, 1);
    assert.strictEqual(input.notification.status, 'ready', 'must not mutate notification');
  });

  await run('2. primary equal LINE → Customer source (same value)', async () => {
    const resolved = await resolveNotifyLineDestination(
      job({ customer: { id: 'cust_1' } }),
      {
        flags: flags({ enabled: true, readNotify: true }),
        deps: {
          findByCustomerId: async (id) => {
            assert.strictEqual(id, 'cust_1');
            return { customerId: id, lineUserId: 'U_CASE_LINE_AAAAAAAA' };
          }
        }
      }
    );
    assert.strictEqual(resolved.lineUserId, 'U_CASE_LINE_AAAAAAAA');
    assert.strictEqual(resolved.source, 'customer');
    assert.strictEqual(metrics.getSnapshot().customerHits, 1);
    assert.strictEqual(metrics.getSnapshot().caseFallbacks, 0);
  });

  await run('3. primary Case empty + Customer LINE → Customer', async () => {
    const resolved = await resolveNotifyLineDestination(
      job({ line: { userId: '' }, customer: { id: 'cust_2' } }),
      {
        flags: flags({ enabled: true, readNotify: true }),
        deps: {
          findByCustomerId: async () => ({
            customerId: 'cust_2',
            lineUserId: 'U_CUSTOMER_ONLY_BBBB'
          })
        }
      }
    );
    assert.strictEqual(resolved.lineUserId, 'U_CUSTOMER_ONLY_BBBB');
    assert.strictEqual(resolved.source, 'customer');
  });

  await run('4. primary no customer.id → Case LINE + missingLinks', async () => {
    let customerCalls = 0;
    const resolved = await resolveNotifyLineDestination(job({ customer: { id: '' } }), {
      flags: flags({ enabled: true, readNotify: true }),
      deps: {
        findByCustomerId: async () => {
          customerCalls += 1;
          return null;
        }
      }
    });
    assert.strictEqual(customerCalls, 0);
    assert.strictEqual(resolved.source, 'case');
    assert.strictEqual(resolved.lineUserId, 'U_CASE_LINE_AAAAAAAA');
    assert.strictEqual(metrics.getSnapshot().missingLinks, 1);
    assert.strictEqual(metrics.getSnapshot().caseFallbacks, 1);
  });

  await run('5a. primary Customer missing → Case fallback', async () => {
    const resolved = await resolveNotifyLineDestination(
      job({ customer: { id: 'cust_missing' } }),
      {
        flags: flags({ enabled: true, readNotify: true }),
        deps: { findByCustomerId: async () => null }
      }
    );
    assert.strictEqual(resolved.source, 'case');
    assert.strictEqual(metrics.getSnapshot().customerMisses, 1);
    assert.strictEqual(metrics.getSnapshot().caseFallbacks, 1);
  });

  await run('5b. primary Customer no LINE → Case fallback', async () => {
    const resolved = await resolveNotifyLineDestination(
      job({ customer: { id: 'cust_noline' } }),
      {
        flags: flags({ enabled: true, readNotify: true }),
        deps: {
          findByCustomerId: async () => ({ customerId: 'cust_noline', lineUserId: '' })
        }
      }
    );
    assert.strictEqual(resolved.source, 'case');
    assert.strictEqual(metrics.getSnapshot().customerNoLine, 1);
    assert.strictEqual(metrics.getSnapshot().caseFallbacks, 1);
  });

  await run('6. primary mismatch → Case wins', async () => {
    const resolved = await resolveNotifyLineDestination(
      job({ customer: { id: 'cust_div' } }),
      {
        flags: flags({ enabled: true, readNotify: true }),
        deps: {
          findByCustomerId: async () => ({
            customerId: 'cust_div',
            lineUserId: 'U_OTHER_LINE_CCCCCCC'
          })
        }
      }
    );
    assert.strictEqual(resolved.lineUserId, 'U_CASE_LINE_AAAAAAAA');
    assert.strictEqual(resolved.source, 'case');
    const snap = metrics.getSnapshot();
    assert.strictEqual(snap.mismatches, 1);
    assert.strictEqual(snap.customerHits, 1);
    assert.strictEqual(snap.caseFallbacks, 1);
  });

  await run('7. shadow mismatch → send Case + metric', async () => {
    const resolved = await resolveNotifyLineDestination(
      job({ customer: { id: 'cust_s' } }),
      {
        flags: flags({ enabled: true, readNotifyShadow: true }),
        deps: {
          findByCustomerId: async () => ({
            customerId: 'cust_s',
            lineUserId: 'U_SHADOW_DIFF_DDDDDD'
          })
        }
      }
    );
    assert.strictEqual(resolved.mode, 'shadow');
    assert.strictEqual(resolved.lineUserId, 'U_CASE_LINE_AAAAAAAA');
    assert.strictEqual(resolved.source, 'case');
    assert.strictEqual(metrics.getSnapshot().mismatches, 1);
    assert.strictEqual(metrics.getSnapshot().casePrimaryHits, 1);
  });

  await run('8. Customer path throws → Case fallback', async () => {
    const resolved = await resolveNotifyLineDestination(
      job({ customer: { id: 'cust_err' } }),
      {
        flags: flags({ enabled: true, readNotify: true }),
        deps: {
          findByCustomerId: async () => {
            throw new Error('notion_down');
          }
        }
      }
    );
    assert.strictEqual(resolved.lineUserId, 'U_CASE_LINE_AAAAAAAA');
    assert.strictEqual(resolved.source, 'case');
    assert.strictEqual(metrics.getSnapshot().errors, 1);
    assert.strictEqual(metrics.getSnapshot().caseFallbacks, 1);
  });

  await run('9. READ_LINE does not change notify mode', async () => {
    assert.strictEqual(
      resolveNotifyReadMode(flags({ enabled: true, readLine: true })),
      'case_only'
    );
    assert.strictEqual(
      resolveLineReadMode(flags({ enabled: true, readNotify: true })),
      'case_only'
    );
    const resolved = await resolveNotifyLineDestination(job(), {
      flags: flags({ enabled: true, readLine: true }),
      deps: {
        findByCustomerId: async () => {
          throw new Error('should not call');
        }
      }
    });
    assert.strictEqual(resolved.mode, 'case_only');
  });

  await run('10. applyDestinationToJob does not mutate notification lifecycle', async () => {
    const input = job({
      notification: { status: 'sending', lineMessageId: '' },
      line: { userId: 'U_CASE_LINE_AAAAAAAA' }
    });
    const patched = applyDestinationToJob(input, 'U_CUSTOMER_ONLY_BBBB');
    assert.notStrictEqual(patched, input);
    assert.strictEqual(patched.line.userId, 'U_CUSTOMER_ONLY_BBBB');
    assert.strictEqual(input.line.userId, 'U_CASE_LINE_AAAAAAAA');
    assert.strictEqual(input.notification.status, 'sending');
    assert.strictEqual(patched.notification.status, 'sending');
    const same = applyDestinationToJob(input, 'U_CASE_LINE_AAAAAAAA');
    assert.strictEqual(same, input);
  });

  const live = getCustomerDomainFlags();
  console.log('\nFlag defaults in this process:', {
    CUSTOMER_DOMAIN_ENABLED: live.enabled,
    CUSTOMER_DOMAIN_READ_NOTIFY: live.readNotify,
    CUSTOMER_DOMAIN_READ_NOTIFY_SHADOW: live.readNotifyShadow,
    CUSTOMER_DOMAIN_READ_LINE: live.readLine
  });

  console.log(`\n${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
