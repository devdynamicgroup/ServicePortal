const fs = require('fs');
const path = require('path');

const AUDIT_DIR = path.join(process.cwd(), 'data');
const AUDIT_FILE = path.join(AUDIT_DIR, 'drive-upload-audit.jsonl');
const AUDIT_MAX_BYTES = Number(process.env.DRIVE_AUDIT_MAX_BYTES || 2 * 1024 * 1024);
const AUDIT_KEEP_FILES = Math.max(1, Number(process.env.DRIVE_AUDIT_KEEP_FILES || 5));

function listRotatedAuditFiles() {
  try {
    return fs.readdirSync(AUDIT_DIR)
      .filter(name => /^drive-upload-audit-.+\.jsonl$/i.test(name))
      .map(name => ({
        name,
        path: path.join(AUDIT_DIR, name),
        mtimeMs: fs.statSync(path.join(AUDIT_DIR, name)).mtimeMs
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

function pruneOldAuditFiles() {
  const rotated = listRotatedAuditFiles();
  rotated.slice(AUDIT_KEEP_FILES).forEach(file => {
    try {
      fs.unlinkSync(file.path);
    } catch (error) {
      console.warn('[drive-audit] prune failed', file.name, error.message);
    }
  });
}

function rotateAuditFileIfNeeded() {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return;
    const size = fs.statSync(AUDIT_FILE).size;
    if (size < AUDIT_MAX_BYTES) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(AUDIT_DIR, `drive-upload-audit-${stamp}.jsonl`);
    fs.renameSync(AUDIT_FILE, target);
    pruneOldAuditFiles();
  } catch (error) {
    console.warn('[drive-audit] rotation failed', error.message);
  }
}

/**
 * Append a metadata-only Drive upload audit line (JSONL).
 * Never stores image bytes. Rotates when the active file exceeds size limit.
 */
function appendDriveUploadAudit(entry = {}) {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    rotateAuditFileIfNeeded();

    const record = {
      timestamp: entry.timestamp || new Date().toISOString(),
      user: entry.user || null,
      filename: entry.filename || null,
      purpose: entry.purpose || null,
      folder: entry.folder || null,
      jobId: entry.jobId != null ? String(entry.jobId) : null,
      success: Boolean(entry.success),
      error: entry.error ? String(entry.error).slice(0, 500) : null,
      fileId: entry.fileId || null
    };
    fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    console.warn('[drive-audit] append failed', error.message);
  }
}

module.exports = {
  appendDriveUploadAudit,
  AUDIT_FILE,
  AUDIT_MAX_BYTES,
  AUDIT_KEEP_FILES
};
