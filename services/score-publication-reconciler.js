/**
 * Recover Case latest-pointer projection after a partial publication write.
 * Never mutates immutable publication fields.
 */
const { withCaseLock } = require('./workflow-service');
const { reconcilePointer } = require('./score-publication-service');

async function reconcileScorePublicationPointer(publicationId, clientPageId) {
  if (clientPageId) {
    return withCaseLock(clientPageId, () => reconcilePointer(publicationId));
  }
  return reconcilePointer(publicationId);
}

module.exports = { reconcileScorePublicationPointer };
