const crypto = require('crypto');
const { findClientByFeedbackToken, findClientByReportToken } = require('./notion/clients');

const TOKEN_PATTERN = /^[a-z0-9-]+$/i;
const MAX_ATTEMPTS = 16;

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidTokenFormat(prefix, token) {
  const normalized = normalizeToken(token);
  if (!normalized.startsWith(`${prefix}-`)) return false;
  const suffix = normalized.slice(prefix.length + 1);
  return suffix.length >= 4 && suffix.length <= 32 && TOKEN_PATTERN.test(suffix);
}

function randomTokenSuffix(length = 4) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

async function feedbackTokenExists(token) {
  const normalized = normalizeToken(token);
  if (!normalized) return false;
  const match = await findClientByFeedbackToken(normalized);
  return Boolean(match?.clientPageId);
}

async function reportTokenExists(token) {
  const normalized = normalizeToken(token);
  if (!normalized) return false;
  const match = await findClientByReportToken(normalized);
  return Boolean(match?.clientPageId);
}

async function generateUniqueToken(prefix, existsFn, suffixLength = 4) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const token = `${prefix}-${randomTokenSuffix(suffixLength)}`;
    if (!isValidTokenFormat(prefix, token)) continue;
    if (!(await existsFn(token))) return token;
  }
  const error = new Error(`Could not generate unique ${prefix} token`);
  error.statusCode = 500;
  throw error;
}

// Phase 2C (D1): new feedback tokens use a 24-char base36 suffix (~124 bits
// of entropy, 36^24) instead of the previous 4-char suffix (~20.7 bits,
// 36^4) -- the production entropy a brute-force/first-redeemer attack
// relied on. generateReportToken() below is intentionally left at the
// default 4-char suffix: it is out of Phase 2C's approved scope (D1 only
// covers the feedback/linking token) and changing it was not requested.
// isValidTokenFormat()'s existing 4-32 char range already accepts a 24-char
// suffix, so no validator change was needed for this length to pass.
const FEEDBACK_TOKEN_SUFFIX_LENGTH = 24;

async function generateFeedbackToken() {
  return generateUniqueToken('fb', feedbackTokenExists, FEEDBACK_TOKEN_SUFFIX_LENGTH);
}

async function generateReportToken() {
  return generateUniqueToken('rpt', reportTokenExists);
}

module.exports = {
  normalizeToken,
  isValidTokenFormat,
  feedbackTokenExists,
  reportTokenExists,
  generateFeedbackToken,
  generateReportToken
};
