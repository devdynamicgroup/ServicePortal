'use strict';

/**
 * Infrastructure validators for future Customer Domain milestones.
 * M8.1: not wired into booking / LINE / workflow.
 */

const { isValidCustomerId } = require('./model');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Deterministic TH-friendly phone normalize for exact match (future matcher).
 * Returns '' when input cannot be normalized safely (do not guess).
 */
function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  digits = digits.replace(/\D/g, '');

  if (!digits) return '';

  // Thailand: 0XXXXXXXXX (10) ↔ 66XXXXXXXXX (11)
  if (digits.length === 10 && digits.startsWith('0')) {
    return `66${digits.slice(1)}`;
  }
  if (digits.length === 11 && digits.startsWith('66')) {
    return digits;
  }
  if (digits.length >= 8 && digits.length <= 15) {
    return digits;
  }
  return '';
}

function assertValidCustomerId(customerId) {
  if (!isValidCustomerId(customerId)) {
    const error = new Error('Invalid customerId format (expected cust_…)');
    error.code = 'invalid_customer_id';
    error.statusCode = 400;
    throw error;
  }
  return String(customerId).trim();
}

module.exports = {
  normalizeEmail,
  normalizePhone,
  assertValidCustomerId
};
