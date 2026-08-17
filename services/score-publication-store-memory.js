/**
 * In-memory Score Publication Ledger for tests and local Gate A proofs.
 * Append-only: create never mutates immutable fields.
 */
function createMemoryPublicationStore() {
  const rows = [];

  function clone(row) {
    return JSON.parse(JSON.stringify(row));
  }

  return {
    kind: 'memory',
    isConfigured() {
      return true;
    },
    async ensureSchema() {
      return { ok: true, created: [] };
    },
    async create(record) {
      const token = String(record.publicReportToken || '').trim();
      const key = String(record.idempotencyKey || '').trim();
      if (token && rows.some((row) => row.publicReportToken === token)) {
        const error = new Error('Duplicate public report token');
        error.code = 'TOKEN_COLLISION';
        error.statusCode = 409;
        throw error;
      }
      if (key && rows.some((row) => row.idempotencyKey === key)) {
        return clone(rows.find((row) => row.idempotencyKey === key));
      }
      const stored = clone(record);
      stored.pageId = stored.pageId || `mem-${rows.length + 1}`;
      rows.push(stored);
      return clone(stored);
    },
    async findByToken(token) {
      const normalized = String(token || '').trim();
      const matches = rows.filter((row) => row.publicReportToken === normalized);
      return { records: matches.map(clone), duplicate: matches.length > 1 };
    },
    async findByIdempotencyKey(idempotencyKey) {
      const key = String(idempotencyKey || '').trim();
      if (!key) return null;
      const hit = rows.find((row) => row.idempotencyKey === key);
      return hit ? clone(hit) : null;
    },
    async findByPublicationId(publicationId) {
      const id = String(publicationId || '').trim();
      const hit = rows.find((row) => row.publicationId === id);
      return hit ? clone(hit) : null;
    },
    async findLatestByClientPageId(clientPageId) {
      const id = String(clientPageId || '').trim();
      const matches = rows.filter((row) => row.clientPageId === id);
      if (!matches.length) return null;
      return clone(matches[matches.length - 1]);
    },
    async updatePointerSyncState(publicationId, pointerSyncState) {
      const row = rows.find((item) => item.publicationId === publicationId);
      if (!row) return null;
      row.pointerSyncState = pointerSyncState;
      return clone(row);
    },
    _rows: rows
  };
}

module.exports = { createMemoryPublicationStore };
