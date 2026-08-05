'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const repository = require('../repository');
const { CUSTOMER_STATUS } = require('../aliases');
const { normalizePhone, normalizeEmail } = require('../validate');

const DEFAULT_DIR = path.join(process.cwd(), 'tmp', 'customer-merge');

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `dup-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function isActiveCustomer(customer) {
  const status = String(customer?.status || '').toLowerCase();
  if (status === CUSTOMER_STATUS.MERGED || status === CUSTOMER_STATUS.ANONYMIZED) return false;
  return Boolean(customer?.customerId);
}

function clusterKey(customerIds) {
  return [...customerIds].sort().join('|');
}

/**
 * Exact duplicate detection only (LINE / phone / email).
 * @param {{ customers?: object[], reportDir?: string }} [options]
 */
async function detectDuplicateCustomers(options = {}) {
  const runId = options.runId || createRunId();
  const timestamp = new Date().toISOString();
  const customers = Array.isArray(options.customers)
    ? options.customers
    : await repository.listAllCustomers({ limit: 10000 });

  const active = customers.filter(isActiveCustomer);
  const byLine = new Map();
  const byPhone = new Map();
  const byEmail = new Map();

  const add = (map, key, customer) => {
    if (!key) return;
    const list = map.get(key) || [];
    list.push(customer);
    map.set(key, list);
  };

  for (const customer of active) {
    add(byLine, String(customer.lineUserId || '').trim(), customer);
    add(byPhone, normalizePhone(customer.phone), customer);
    add(byEmail, normalizeEmail(customer.email), customer);
  }

  const seen = new Map(); // clusterKey → cluster

  const consider = (map, matchedBy) => {
    for (const [value, list] of map.entries()) {
      if (!list || list.length < 2) continue;
      const ids = list.map(c => c.customerId);
      const key = clusterKey(ids);

      let confidence = 'C3';
      if (matchedBy === 'line') {
        confidence = 'C1';
      } else if (matchedBy === 'phone') {
        const emails = new Set(list.map(c => normalizeEmail(c.email)).filter(Boolean));
        confidence = emails.size === 1 && list.every(c => normalizeEmail(c.email)) ? 'C2' : 'C3';
      } else if (matchedBy === 'email') {
        const phones = new Set(list.map(c => normalizePhone(c.phone)).filter(Boolean));
        confidence = phones.size === 1 && list.every(c => normalizePhone(c.phone)) ? 'C2' : 'C3';
      }

      const rank = { C1: 3, C2: 2, C3: 1 };
      const existing = seen.get(key);
      if (!existing || rank[confidence] > rank[existing.confidence]) {
        seen.set(key, {
          confidence,
          matchedBy,
          matchedValue: value,
          customers: list.map(c => ({
            customerId: c.customerId,
            notionPageId: c.notionPageId,
            displayName: c.displayName,
            phone: c.phone,
            email: c.email,
            lineUserId: c.lineUserId,
            status: c.status
          }))
        });
      }
    }
  };

  consider(byLine, 'line');
  consider(byPhone, 'phone');
  consider(byEmail, 'email');

  const clusters = [...seen.values()];
  const counters = {
    c1: clusters.filter(c => c.confidence === 'C1').length,
    c2: clusters.filter(c => c.confidence === 'C2').length,
    c3: clusters.filter(c => c.confidence === 'C3').length
  };

  const report = {
    runId,
    timestamp,
    clusters,
    counters,
    scannedCustomers: active.length
  };

  const reportDir = options.reportDir || DEFAULT_DIR;
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${runId}.detect.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  report.reportPath = reportPath;
  return report;
}

module.exports = {
  detectDuplicateCustomers,
  createRunId,
  isActiveCustomer,
  DEFAULT_DIR
};
