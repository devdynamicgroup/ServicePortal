/**
 * PublicationStore contract (PD-V7-09).
 * Scoring models must not import Notion, Case, or Render.
 *
 * Required store methods (existing Phase A):
 *   create, findByToken, findByPublicationId, findByIdempotencyKey,
 *   findLatestByClientPageId, updatePointerSyncState, ensureSchema
 *
 * Contract aliases:
 *   createPublication, getPublication, getPublicationByToken, listPublications
 */

function withPublicationStoreContract(store) {
  if (!store || typeof store !== 'object') {
    throw new Error('PublicationStore is required');
  }
  return {
    ...store,
    createPublication(record) {
      return store.create(record);
    },
    getPublication(publicationId) {
      return store.findByPublicationId(publicationId);
    },
    async getPublicationByToken(token) {
      const found = await store.findByToken(token);
      if (found?.duplicate) {
        const error = new Error('Duplicate public report token');
        error.statusCode = 409;
        error.code = 'TOKEN_DUPLICATE';
        throw error;
      }
      return found?.records?.[0] || null;
    },
    async listPublications(query = {}) {
      const caseId = String(query.caseId || '').trim();
      const clientPageId = String(query.clientPageId || '').trim();
      if (typeof store.listByClientPageId === 'function' && clientPageId) {
        return store.listByClientPageId(clientPageId);
      }
      if (typeof store.listByCaseId === 'function' && caseId) {
        return store.listByCaseId(caseId);
      }
      if (typeof store.findLatestByClientPageId === 'function' && clientPageId) {
        const latest = await store.findLatestByClientPageId(clientPageId);
        return latest ? [latest] : [];
      }
      return [];
    }
  };
}

module.exports = { withPublicationStoreContract };
