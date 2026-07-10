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

async function generateUniqueToken(prefix, existsFn) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const token = `${prefix}-${randomTokenSuffix(4)}`;
    if (!isValidTokenFormat(prefix, token)) continue;
    if (!(await existsFn(token))) return token;
  }
  const error = new Error(`Could not generate unique ${prefix} token`);
  error.statusCode = 500;
  throw error;
}

async function generateFeedbackToken() {
  return generateUniqueToken('fb', feedbackTokenExists);
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
