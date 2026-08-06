'use strict';

/**
 * Lightweight LINE Contact store (OA identity before Case linking).
 * Exact lineUserId only. Never attaches to Case. Not Customer Domain.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(process.cwd(), 'tmp', 'line-contacts');

function contactsDir(dir) {
  if (dir) return path.resolve(dir);
  const fromEnv = String(process.env.LINE_CONTACTS_DIR || '').trim();
  return fromEnv ? path.resolve(fromEnv) : DEFAULT_DIR;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFileKey(lineUserId) {
  return String(lineUserId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 200);
}

function contactPath(lineUserId, dir) {
  const key = sanitizeFileKey(lineUserId);
  if (!key) return null;
  return path.join(contactsDir(dir), `${key}.json`);
}

function readContact(lineUserId, options = {}) {
  const file = contactPath(lineUserId, options.dir);
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeContact(record, options = {}) {
  const userId = String(record?.lineUserId || '').trim();
  const file = contactPath(userId, options.dir);
  if (!file) return null;
  ensureDir(contactsDir(options.dir));
  const payload = {
    lineUserId: userId,
    lineDisplayName: String(record.lineDisplayName || '').trim(),
    followedAt: record.followedAt || null,
    lastSeenAt: record.lastSeenAt || null
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/**
 * Record OA follow. Sets followedAt once; always refreshes lastSeenAt / displayName.
 * Does not write Case.
 */
function recordLineFollow({ lineUserId, lineDisplayName } = {}, options = {}) {
  const userId = String(lineUserId || '').trim();
  if (!userId) return null;

  const now = options.now || new Date().toISOString();
  const existing = readContact(userId, options);
  return writeContact(
    {
      lineUserId: userId,
      lineDisplayName:
        String(lineDisplayName || '').trim()
        || existing?.lineDisplayName
        || '',
      followedAt: existing?.followedAt || now,
      lastSeenAt: now
    },
    options
  );
}

/**
 * Touch lastSeenAt (and optional displayName). Creates a contact without followedAt
 * if the user interacted before a follow event was captured.
 */
function touchLineContact(lineUserId, patch = {}, options = {}) {
  const userId = String(lineUserId || '').trim();
  if (!userId) return null;

  const now = options.now || new Date().toISOString();
  const existing = readContact(userId, options);
  const displayName = Object.prototype.hasOwnProperty.call(patch, 'lineDisplayName')
    ? String(patch.lineDisplayName || '').trim()
    : (existing?.lineDisplayName || '');

  return writeContact(
    {
      lineUserId: userId,
      lineDisplayName: displayName,
      followedAt: existing?.followedAt || null,
      lastSeenAt: now
    },
    options
  );
}

/**
 * Exact userId lookup only — display name is never a match key.
 */
function findContactByLineUserId(lineUserId, options = {}) {
  const userId = String(lineUserId || '').trim();
  if (!userId) return null;
  const row = readContact(userId, options);
  if (!row) return null;
  if (String(row.lineUserId || '').trim() !== userId) return null;
  return row;
}

module.exports = {
  DEFAULT_DIR,
  contactsDir,
  recordLineFollow,
  touchLineContact,
  findContactByLineUserId,
  readContact,
  writeContact
};
