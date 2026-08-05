'use strict';

/**
 * M8.7 — Customer reconcile fixture tests (no Notion, no flag enable).
 *
 * Usage: node scripts/test-customer-reconcile.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  scanIdentityDrift,
  proposeRepairs,
  runRepairs,
  evaluateGates,
  runReconcileScan,
  getReconcileStatus,
  ALLOWED_ACTIONS
} = require('../services/migration/customer-reconcile');
const { getCustomerDomainFlags } = require('../services/customer-domain/flags');

function job(partial = {}) {
  return {
    notionId: partial.notionId || 'notion-1',
    id: partial.id || 'case-1',
    line: { userId: partial.lineUserId || '' },
    customer: { id: partial.customerId || '', pageId: partial.customerPageId || '' },
    draft: {
      fields: {
        'ci-phone': partial.phone || '',
        'ci-email': partial.email || ''
      }
    },
    ...partial
  };
}

function customer(partial = {}) {
  return {
    customerId: partial.customerId || 'cust_1',
    notionPageId: partial.notionPageId || 'cpage_1',
    lineUserId: partial.lineUserId || '',
    phone: partial.phone || '',
    email: partial.email || '',
    status: partial.status || 'active',
    ...partial
  };
}

async function test(name, fn) {
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-reconcile-'));

  await run('1. missing_customer_link detection', async () => {
    const scanned = scanIdentityDrift({
      jobs: [job({ lineUserId: 'U_LINE_AAAA', customerId: '' })],
      customers: []
    });
    assert.strictEqual(scanned.counters.missingCustomerLink, 1);
    assert.strictEqual(scanned.findings[0].type, 'missing_customer_link');
  });

  await run('2. orphan_customer_link + line_diverge', async () => {
    const scanned = scanIdentityDrift({
      jobs: [
        job({ notionId: 'n-orphan', customerId: 'cust_gone', lineUserId: 'U_A' }),
        job({
          notionId: 'n-div',
          customerId: 'cust_div',
          lineUserId: 'U_CASE_LINE'
        })
      ],
      customers: [
        customer({ customerId: 'cust_div', lineUserId: 'U_CUST_LINE' })
      ]
    });
    assert.strictEqual(scanned.counters.orphanCustomerLink, 1);
    assert.strictEqual(scanned.counters.lineDiverge, 1);
  });

  await run('3. line_case_only / line_customer_only / soft conflicts', async () => {
    const scanned = scanIdentityDrift({
      jobs: [
        job({
          notionId: 'n1',
          customerId: 'cust_a',
          lineUserId: 'U_ONLY_CASE',
          phone: '0812345678',
          email: 'a@ex.com'
        }),
        job({
          notionId: 'n2',
          customerId: 'cust_b',
          lineUserId: '',
          phone: '0899999999',
          email: 'b@ex.com'
        })
      ],
      customers: [
        customer({
          customerId: 'cust_a',
          lineUserId: '',
          phone: '66811111111',
          email: 'other@ex.com'
        }),
        customer({
          customerId: 'cust_b',
          lineUserId: 'U_ONLY_CUST',
          phone: '66899999999',
          email: 'b@ex.com'
        })
      ]
    });
    assert.strictEqual(scanned.counters.lineCaseOnly, 1);
    assert.strictEqual(scanned.counters.lineCustomerOnly, 1);
    assert.ok(scanned.counters.softPhoneConflict >= 1);
    assert.ok(scanned.counters.softEmailConflict >= 1);
  });

  await run('4. no name matching / empty strong identity ignored', async () => {
    const scanned = scanIdentityDrift({
      jobs: [job({ notionId: 'n-name', lineUserId: '', phone: '', email: '', customerId: '' })],
      customers: [customer({ customerId: 'cust_x', lineUserId: '' })]
    });
    assert.strictEqual(scanned.counters.missingCustomerLink, 0);
  });

  await run('5. link_missing dry-run unique LINE match', async () => {
    const jobs = [job({ notionId: 'n-link', lineUserId: 'U_MATCH', customerId: '' })];
    const customers = [customer({ customerId: 'cust_m', lineUserId: 'U_MATCH', notionPageId: 'pg_m' })];
    const scanned = scanIdentityDrift({ jobs, customers });
    const result = await runRepairs('link_missing', {
      dryRun: true,
      findings: scanned.findings,
      jobs,
      customers
    });
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.repairsProposed, 1);
    assert.strictEqual(result.repairsApplied, 0);
    assert.strictEqual(result.proposals[0].customerId, 'cust_m');
  });

  await run('6. link_missing skips ambiguous; line_diverge never proposed', async () => {
    const jobs = [
      job({ notionId: 'n-amb', lineUserId: '', phone: '0811111111', customerId: '' }),
      job({ notionId: 'n-div', customerId: 'cust_1', lineUserId: 'U_CASE' })
    ];
    const customers = [
      customer({ customerId: 'cust_1', lineUserId: 'U_OTHER' }),
      customer({ customerId: 'cust_2', phone: '66811111111' }),
      customer({ customerId: 'cust_3', phone: '66811111111' })
    ];
    const scanned = scanIdentityDrift({ jobs, customers });
    assert.ok(scanned.findings.some(f => f.type === 'line_diverge'));
    const divergeProposals = proposeRepairs('link_missing', {
      findings: scanned.findings.filter(f => f.type === 'line_diverge'),
      jobs,
      customers
    });
    assert.strictEqual(divergeProposals.length, 0);
    const linkResult = await runRepairs('link_missing', {
      dryRun: true,
      findings: scanned.findings,
      jobs,
      customers
    });
    assert.ok(linkResult.proposals.some(p => p.status === 'skipped' && p.reason === 'ambiguous_match'));
  });

  await run('7. fill_case_line / fill_customer_line write with mocks', async () => {
    const jobs = [
      job({ notionId: 'n-fill-case', customerId: 'cust_f', lineUserId: '' }),
      job({ notionId: 'n-fill-cust', customerId: 'cust_g', lineUserId: 'U_FROM_CASE' })
    ];
    const customers = [
      customer({ customerId: 'cust_f', lineUserId: 'U_FROM_CUST' }),
      customer({ customerId: 'cust_g', lineUserId: '' })
    ];
    const scanned = scanIdentityDrift({ jobs, customers });

    let linkedLine = null;
    const fillCase = await runRepairs('fill_case_line_from_customer', {
      dryRun: false,
      findings: scanned.findings,
      jobs,
      customers,
      deps: {
        updateClient: async (id, payload) => {
          linkedLine = { id, ...payload };
          return {};
        }
      }
    });
    assert.strictEqual(fillCase.repairsApplied, 1);
    assert.strictEqual(linkedLine.lineUserId, 'U_FROM_CUST');

    let patched = null;
    const fillCust = await runRepairs('fill_customer_line_from_case', {
      dryRun: false,
      findings: scanned.findings,
      jobs,
      customers,
      deps: {
        applyIdentityPatch: async (customerId, input) => {
          patched = { customerId, ...input };
          return {};
        }
      }
    });
    assert.strictEqual(fillCust.repairsApplied, 1);
    assert.strictEqual(patched.lineUserId, 'U_FROM_CASE');
  });

  await run('8. gates fail on diverge; scan writes report', async () => {
    const result = await runReconcileScan({
      dir: tmpDir,
      jobs: [job({ notionId: 'n-g', customerId: 'cust_g', lineUserId: 'U_1' })],
      customers: [customer({ customerId: 'cust_g', lineUserId: 'U_2' })]
    });
    assert.strictEqual(result.gateResult.passed, false);
    assert.ok(result.gateResult.failures.includes('lineDivergeMax'));
    assert.ok(fs.existsSync(result.paths.summaryPath));
  });

  await run('9. default dryRun=true; unsupported action throws', async () => {
    assert.ok(ALLOWED_ACTIONS.includes('link_missing'));
    await assert.rejects(
      () => runRepairs('line_diverge', { findings: [], jobs: [], customers: [] }),
      /Unsupported repair action/
    );
    const status = getReconcileStatus({ dir: tmpDir });
    assert.strictEqual(status.flags.CUSTOMER_DOMAIN_ENABLED, false);
    assert.ok(status.latestReconcile);
  });

  await run('10. flags remain OFF in process', async () => {
    const flags = getCustomerDomainFlags();
    assert.strictEqual(flags.enabled, false);
    assert.strictEqual(flags.readLine, false);
    assert.strictEqual(flags.readNotify, false);
    assert.strictEqual(flags.mergeEnabled, false);
  });

  // gate helper smoke
  const gateOk = evaluateGates({
    counters: { orphanCustomerLink: 0, lineDiverge: 0, missingCustomerLink: 0 },
    casesWithLine: 10
  });
  assert.strictEqual(gateOk.passed, true);

  console.log(`\n${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
