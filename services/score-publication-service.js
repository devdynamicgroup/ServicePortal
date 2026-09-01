/**
 * Case-owned write-once Water Score publication (PD-V7-09).
 *
 * 2026-09-01 (score-consistency fix): a NEW publication's submitted score
 * is now cross-checked against the canonical Quality V3 score computed
 * server-side from the Case's own current readings (services/canonical-score.js)
 * before being persisted -- see createOrReusePublication()'s validation
 * block below. This does not apply to replay/reuse paths (idempotency
 * replay, existing-pointer reuse), which persist nothing new.
 */
const crypto = require('crypto');
const { getClient, updateClient, findClientByReportToken } = require('./notion/clients');
const { createNotionPublicationStore, isScorePublicationsConfigured } = require('./notion/score-publications');
const { withPublicationStoreContract } = require('./publication-store');
const { buildReportUrl } = require('./url-builder');
const { computeCanonicalScore } = require('./canonical-score');
const {
  UNKNOWN,
  compactReadings,
  buildSnapshot,
  applyPublicationToJob,
  minimalJobFromSnapshot
} = require('./score-publication-snapshot');

const KNOWN_Q_V3_MODEL_VERSION = 'quality-v3.0';
const VALID_COMPLIANCE_STATUSES = ['PASS', 'WARNING', 'FAIL'];
const VALID_INTENTS = new Set(['publish', 'republish']);

let injectedStore = null;
let caseAdapter = {
  getClient,
  updateClient,
  findClientByReportToken
};

function setPublicationStore(store) {
  injectedStore = store;
}

function setPublicationCaseAdapter(adapter) {
  caseAdapter = {
    getClient,
    updateClient,
    findClientByReportToken,
    ...adapter
  };
}

function resetPublicationDependencies() {
  injectedStore = null;
  caseAdapter = {
    getClient,
    updateClient,
    findClientByReportToken
  };
}

function getPublicationStore() {
  return withPublicationStoreContract(injectedStore || createNotionPublicationStore());
}

function ledgerAvailable() {
  const store = getPublicationStore();
  if (store.kind === 'memory') return true;
  return isScorePublicationsConfigured();
}

function newPublicationId() {
  return `pub-${crypto.randomBytes(8).toString('hex')}`;
}

function newReportToken() {
  return `rpt-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeIntent(value) {
  const intent = String(value || 'publish').trim().toLowerCase();
  return VALID_INTENTS.has(intent) ? intent : 'publish';
}

function normalizeCompliance(value) {
  return VALID_COMPLIANCE_STATUSES.includes(value) ? value : undefined;
}

function readingsFromJob(job) {
  return compactReadings(
    job?.draft?.scoreBaseReadings
    || job?.result?.readings
    || {}
  );
}

function responseFromPublication(publication, extras = {}) {
  const snapshot = publication.snapshot || publication;
  return {
    ok: true,
    caseId: extras.caseId || snapshot.caseId || null,
    score: snapshot.publishedScore,
    complianceStatus: snapshot.complianceStatus || extras.complianceStatus,
    reportToken: snapshot.publicReportToken,
    reportUrl: snapshot.reportUrl || buildReportUrl(snapshot.publicReportToken),
    publicationId: snapshot.publicationId,
    scoreType: snapshot.scoreType,
    modelVersion: snapshot.modelVersion,
    benchmarkVersion: snapshot.benchmarkVersion,
    publishedAt: snapshot.publishedAt,
    reused: Boolean(extras.reused),
    pointerSyncState: publication.pointerSyncState || extras.pointerSyncState || 'synced'
  };
}

// Equality, not presence: null/undefined must never compare equal to a
// defined score (including a genuine 0) via bare Number() coercion, or a
// Case with no score yet would be reported as "already matching" a ledger
// record whose real published score happens to be exactly 0 -- skipping a
// resync that was actually needed (forensic investigation, 2026-08-25).
function casePointerMatchesPublication(job, publication) {
  const snapshot = publication.snapshot || publication;
  const caseScore = job?.result?.waterScore;
  const publicationScore = snapshot.publishedScore;
  if (caseScore === null || caseScore === undefined) return false;
  if (publicationScore === null || publicationScore === undefined) return false;
  return Number(caseScore) === Number(publicationScore)
    && String(job?.result?.publicReportToken || '') === String(snapshot.publicReportToken || '');
}

async function tokenIsTaken(store, token) {
  const ledger = await store.findByToken(token);
  if (ledger.records.length) return true;
  try {
    const existingCase = await caseAdapter.findClientByReportToken(token);
    return Boolean(existingCase?.clientPageId);
  } catch {
    return false;
  }
}

async function mintUniqueToken(store) {
  for (let i = 0; i < 5; i += 1) {
    const token = newReportToken();
    if (!(await tokenIsTaken(store, token))) return token;
  }
  const error = new Error('Could not allocate a unique public report token');
  error.statusCode = 502;
  throw error;
}

async function syncCasePointer(job, publication) {
  const snapshot = publication.snapshot || publication;
  const updated = await caseAdapter.updateClient(job.notionId, {
    latestWaterScore: snapshot.publishedScore,
    complianceStatus: snapshot.complianceStatus || undefined,
    resultSummary: snapshot.resultSummary,
    reportUrl: snapshot.reportUrl || buildReportUrl(snapshot.publicReportToken),
    publicReportToken: snapshot.publicReportToken
  });
  return updated;
}

async function createLedgerRecord(store, fields) {
  const snapshot = buildSnapshot(fields);
  const record = {
    publicationId: snapshot.publicationId,
    clientPageId: snapshot.clientPageId,
    caseId: snapshot.caseId,
    publishedScore: snapshot.publishedScore,
    scoreType: snapshot.scoreType,
    modelVersion: snapshot.modelVersion,
    benchmarkVersion: snapshot.benchmarkVersion,
    publishedAt: snapshot.publishedAt,
    publicReportToken: snapshot.publicReportToken,
    reportUrl: snapshot.reportUrl,
    idempotencyKey: fields.idempotencyKey,
    pointerSyncState: 'pointer_pending',
    snapshot
  };
  return store.create(record);
}

async function freezeLegacyPointer(store, job, extras = {}) {
  const token = String(job.result?.publicReportToken || '').trim();
  const rawScore = job.result?.waterScore;
  // Strict presence, not bare coercion -- see casePointerMatchesPublication
  // above and hasPointer below for the same class of bug this closes.
  if (rawScore === null || rawScore === undefined) return null;
  const score = Number(rawScore);
  if (!token || !Number.isFinite(score)) return null;
  const existing = await store.findByToken(token);
  if (existing.records.length) return existing.records[0];
  return createLedgerRecord(store, {
    publicationId: newPublicationId(),
    clientPageId: job.notionId,
    caseId: extras.caseId || job.id,
    publishedScore: score,
    scoreType: 'legacy-publication',
    modelVersion: UNKNOWN,
    benchmarkVersion: UNKNOWN,
    publishedAt: new Date().toISOString(),
    publicReportToken: token,
    reportUrl: job.result?.reportUrl || buildReportUrl(token),
    complianceStatus: job.result?.complianceStatus || null,
    resultSummary: job.result?.summary || `Water score ${Math.round(score)}/100`,
    readings: readingsFromJob(job),
    idempotencyKey: `legacy-freeze:${job.notionId}:${token}`
  });
}

/**
 * Create or reuse an immutable publication. Caller must hold withCaseLock.
 */
async function createOrReusePublication({ job, payload = {}, caseId } = {}) {
  const score = Number(payload.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    const error = new Error('Score must be between 0 and 100');
    error.statusCode = 400;
    throw error;
  }
  const intent = normalizeIntent(payload.intent);
  const complianceStatus = normalizeCompliance(payload.complianceStatus);
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  const store = getPublicationStore();
  const hasLedger = ledgerAvailable();

  if (!hasLedger) {
    const error = new Error('Score publication ledger is not configured; NOTION_SCORE_PUBLICATIONS_DATABASE_ID is required');
    error.statusCode = 503;
    error.code = 'LEDGER_REQUIRED';
    throw error;
  }

  if (hasLedger && idempotencyKey) {
    await store.ensureSchema();
    const replay = await store.findByIdempotencyKey(idempotencyKey);
    if (replay) {
      if (replay.pointerSyncState === 'pointer_pending') {
        try {
          await syncCasePointer(job, replay);
          await store.updatePointerSyncState(replay.publicationId, 'synced');
          replay.pointerSyncState = 'synced';
        } catch (error) {
          return {
            ...responseFromPublication(replay, { caseId, reused: true, pointerSyncState: 'pointer_pending' }),
            pointerPending: true,
            warning: error.message
          };
        }
      }
      return responseFromPublication(replay, { caseId, reused: true, complianceStatus });
    }
  }

  const latestLedger = await store.findLatestByClientPageId(job.notionId);
  const rawWaterScore = job.result?.waterScore;
  const hasPointer = rawWaterScore !== null
    && rawWaterScore !== undefined
    && Number.isFinite(Number(rawWaterScore))
    && String(job.result?.publicReportToken || '').trim();

  if (intent === 'publish' && latestLedger) {
    if (casePointerMatchesPublication(job, latestLedger)) {
      return responseFromPublication(latestLedger, { caseId, reused: true, complianceStatus });
    }
    try {
      const updated = await syncCasePointer(job, latestLedger);
      await store.updatePointerSyncState(latestLedger.publicationId, 'synced');
      return {
        ...responseFromPublication(latestLedger, { caseId: updated.id, reused: true, complianceStatus }),
        case: updated
      };
    } catch (error) {
      return {
        ...responseFromPublication(latestLedger, { caseId, reused: true, pointerSyncState: 'pointer_pending' }),
        pointerPending: true,
        warning: error.message
      };
    }
  }

  await store.ensureSchema();
  if (hasPointer && !latestLedger) {
    const legacyPublication = await freezeLegacyPointer(store, job, { caseId });
    if (intent === 'publish' && legacyPublication) {
      return responseFromPublication(legacyPublication, { caseId, reused: true, complianceStatus });
    }
  }

  // 2026-09-01 (score-consistency fix): from here on, a genuinely NEW
  // publication record is about to be persisted (nothing above this line
  // wrote anything new -- both earlier branches only replay/reuse an
  // existing record). Cross-check the submitted score against the
  // canonical Quality V3 score computed server-side from this Case's own
  // current readings before minting anything. REJECT on mismatch rather
  // than silently correcting -- a mismatch means the client submitted a
  // stale or otherwise wrong value, and the caller must refresh and retry
  // rather than have a different number silently published on their
  // behalf. canonical.score === null (incomplete readings) is not treated
  // as a mismatch -- that case is already blocked upstream by eligibility.
  const canonical = computeCanonicalScore(job);
  if (canonical.score !== null && Math.round(canonical.score) !== Math.round(score)) {
    const mismatchError = new Error(
      'Submitted score no longer matches the current assessment. Refresh the score and try again.'
    );
    mismatchError.statusCode = 409;
    mismatchError.code = 'SCORE_MISMATCH';
    throw mismatchError;
  }

  const publicReportToken = await mintUniqueToken(store);
  const publicationId = newPublicationId();
  const publishedAt = new Date().toISOString();
  const scoreType = 'quality-v3';
  const modelVersion = String(payload.modelVersion || KNOWN_Q_V3_MODEL_VERSION).trim() || KNOWN_Q_V3_MODEL_VERSION;
  const benchmarkVersion = String(payload.benchmarkVersion || '').trim() || UNKNOWN;
  const created = await createLedgerRecord(store, {
    publicationId,
    clientPageId: job.notionId,
    caseId: caseId || job.id,
    publishedScore: Math.round(score),
    scoreType,
    modelVersion,
    benchmarkVersion,
    publishedAt,
    publicReportToken,
    reportUrl: buildReportUrl(publicReportToken),
    complianceStatus: complianceStatus || null,
    resultSummary: payload.resultSummary || `Water score ${Math.round(score)}/100`,
    readings: readingsFromJob(job),
    idempotencyKey: idempotencyKey || `minted:${publicationId}`
  });

  try {
    const updated = await syncCasePointer(job, created);
    await store.updatePointerSyncState(created.publicationId, 'synced');
    created.pointerSyncState = 'synced';
    return {
      ...responseFromPublication(created, { caseId: updated.id, complianceStatus }),
      case: updated
    };
  } catch (error) {
    return {
      ...responseFromPublication(created, { caseId, pointerSyncState: 'pointer_pending' }),
      pointerPending: true,
      warning: error.message
    };
  }
}

async function reconcilePointer(publicationId) {
  const store = getPublicationStore();
  const publication = await store.findByPublicationId(publicationId);
  if (!publication) {
    const error = new Error('Publication not found');
    error.statusCode = 404;
    throw error;
  }
  const job = await caseAdapter.getClient(publication.clientPageId);
  if (!job?.notionId) {
    const error = new Error('Case not found');
    error.statusCode = 404;
    throw error;
  }
  const updated = await syncCasePointer(job, publication);
  await store.updatePointerSyncState(publication.publicationId, 'synced');
  return { ok: true, publicationId: publication.publicationId, case: updated, pointerSyncState: 'synced' };
}

async function resolveReportByToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;
  const store = getPublicationStore();
  if (ledgerAvailable()) {
    const found = await store.findByToken(normalized);
    if (found.duplicate) {
      const error = new Error('Duplicate public report token');
      error.statusCode = 409;
      error.code = 'TOKEN_DUPLICATE';
      throw error;
    }
    if (found.records[0]) {
      const publication = found.records[0];
      const snapshot = publication.snapshot || publication;
      try {
        const job = publication.clientPageId ? await caseAdapter.getClient(publication.clientPageId) : null;
        if (job) return applyPublicationToJob(job, publication);
      } catch (error) {
        console.warn('[publication] Case lookup failed; serving snapshot only', error.message);
      }
      return minimalJobFromSnapshot(snapshot);
    }
  }
  return null;
}

module.exports = {
  KNOWN_Q_V3_MODEL_VERSION,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies,
  getPublicationStore,
  ledgerAvailable,
  createOrReusePublication,
  reconcilePointer,
  resolveReportByToken,
  applyPublicationToJob,
  syncCasePointer,
  // Exported for regression tests only (forensic investigation,
  // 2026-08-25) -- not part of the public service contract.
  casePointerMatchesPublication,
  freezeLegacyPointer
};
