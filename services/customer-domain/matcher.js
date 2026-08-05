'use strict';

/**
 * Exact Customer matching (no fuzzy, no name merge).
 * Persistence via repository only.
 */

const repository = require('./repository');
const { normalizePhone, normalizeEmail } = require('./validate');
const { isValidCustomerId } = require('./model');

/**
 * @param {{ existingCustomerId?: string, lineUserId?: string, phone?: string, email?: string }} keys
 * @returns {Promise<{ status: 'none'|'one'|'many', customers: object[], via: string[] }>}
 */
async function matchCustomer(keys = {}) {
  const found = [];
  const via = [];

  const pushUnique = (customer, channel) => {
    if (!customer?.customerId) return;
    if (found.some(item => item.customerId === customer.customerId)) return;
    found.push(customer);
    via.push(channel);
  };

  const existingId = String(keys.existingCustomerId || '').trim();
  if (existingId && isValidCustomerId(existingId)) {
    const byId = await repository.findByCustomerId(existingId);
    if (byId) {
      return { status: 'one', customers: [byId], via: ['customerId'] };
    }
  }

  const lineUserId = String(keys.lineUserId || '').trim();
  if (lineUserId) {
    const rows = await repository.findAllByLineUserId(lineUserId, { limit: 5 });
    rows.forEach(row => pushUnique(row, 'line'));
  }

  const phone = normalizePhone(keys.phone);
  if (phone) {
    const rows = await repository.findAllByPhone(phone, { limit: 5 });
    rows.forEach(row => pushUnique(row, 'phone'));
  }

  const email = normalizeEmail(keys.email);
  if (email) {
    const rows = await repository.findAllByEmail(email, { limit: 5 });
    rows.forEach(row => pushUnique(row, 'email'));
  }

  if (found.length === 0) return { status: 'none', customers: [], via };
  if (found.length === 1) return { status: 'one', customers: found, via };
  return { status: 'many', customers: found, via };
}

module.exports = {
  matchCustomer
};
