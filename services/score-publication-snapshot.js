/**
 * Bounded publication snapshot — Gate A (PD-V7-09).
 * Pure functions. No scoring, no Notion I/O.
 */
const { buildReportUrl } = require('./url-builder');

const SNAPSHOT_SCHEMA_VERSION = 1;
const UNKNOWN = 'UNKNOWN';
const SCORE_TYPES = Object.freeze(['quality-v3', 'legacy-publication', 'country-benchmark']);
const READING_KEYS = Object.freeze(['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp']);
const SCORED_READING_KEYS = Object.freeze(['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do']);
// A frozen set is usable when it holds every reading its score needed: all six
// for Quality V3; for a country benchmark, the four every engine requires
// (chlorine and DO are optional there, exactly as the engines treat them).
const FROZEN_REQUIRED_KEYS = Object.freeze({
  'quality-v3': SCORED_READING_KEYS,
  'country-benchmark': Object.freeze(['ph', 'tds', 'turbidity', 'orp'])
});
// Every draft.fields key the report's reading resolver falls back to.
const DRAFT_READING_FIELD_KEYS = Object.freeze([
  'm-ph', 'ph', 'm-tds', 'tds', 'm-free-cl', 'freeChlorine', 'chlorine',
  'm-turb', 'turbidity', 'm-orp', 'orp', 'm-do', 'do', 'm-temp', 'temp'
]);
const NOTION_RICH_TEXT_CHUNK = 1900;
const MAX_SNAPSHOT_CHARS = 1900 * 8;

function compactReadings(source) {
  if (!source || typeof source !== 'object') return undefined;
  const out = {};
  READING_KEYS.forEach((key) => {
    const n = Number(source[key]);
    if (Number.isFinite(n)) out[key] = n;
  });
  return Object.keys(out).length ? out : undefined;
}

function provenance(value) {
  const text = String(value == null ? '' : value).trim();
  return text || UNKNOWN;
}

/**
 * Optional per-point readings. Omitted entirely when absent or empty.
 * A null readings value means that point had no own measurements.
 * Labels are display text. Identity is ordinal.
 */
function sanitizePointReadings(points) {
  if (!Array.isArray(points) || !points.length) return undefined;
  const out = [];
  points.forEach((point) => {
    if (!point || typeof point !== 'object') return;
    const ordinal = Number(point.ordinal);
    if (!Number.isInteger(ordinal) || ordinal < 0) return;
    const rawLabel = point.label == null ? '' : String(point.label).trim();
    const label = (rawLabel || `Tap ${ordinal + 1}`).slice(0, 80);
    const readings = point.readings == null ? null : (compactReadings(point.readings) || null);
    out.push({ ordinal, label, readings });
  });
  out.sort((left, right) => left.ordinal - right.ordinal);
  const seen = new Set();
  const unique = out.filter((point) => {
    if (seen.has(point.ordinal)) return false;
    seen.add(point.ordinal);
    return true;
  });
  return unique.length ? unique : undefined;
}

function buildSnapshot(input = {}) {
  const publishedScore = Number(input.publishedScore);
  if (!Number.isFinite(publishedScore)) {
    throw new Error('Publication snapshot requires a finite publishedScore');
  }
  const scoreType = SCORE_TYPES.includes(input.scoreType) ? input.scoreType : 'quality-v3';
  const publicReportToken = String(input.publicReportToken || '').trim();
  if (!publicReportToken) {
    throw new Error('Publication snapshot requires publicReportToken');
  }
  const publicationId = String(input.publicationId || '').trim();
  if (!publicationId) {
    throw new Error('Publication snapshot requires publicationId');
  }
  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    publicationId,
    clientPageId: String(input.clientPageId || '').trim(),
    caseId: String(input.caseId || '').trim() || null,
    publishedScore: Math.round(publishedScore),
    scoreType,
    modelVersion: provenance(input.modelVersion),
    benchmarkVersion: provenance(input.benchmarkVersion),
    complianceStatus: input.complianceStatus || null,
    resultSummary: String(input.resultSummary || `Water score ${Math.round(publishedScore)}/100`),
    publishedAt: String(input.publishedAt || new Date().toISOString()),
    publicReportToken,
    reportUrl: String(input.reportUrl || buildReportUrl(publicReportToken)),
    readings: compactReadings(input.readings)
  };
  if (snapshot.readings === undefined) delete snapshot.readings;
  if (scoreType === 'country-benchmark') {
    const standardKey = String(input.standardKey || '').trim();
    if (!standardKey) {
      throw new Error('Country benchmark publication snapshot requires standardKey');
    }
    snapshot.standardKey = standardKey;
  }
  if (input.scorePayload && typeof input.scorePayload === 'object') {
    snapshot.scorePayload = input.scorePayload;
  }
  const pointReadings = sanitizePointReadings(input.pointReadings);
  if (pointReadings) snapshot.pointReadings = pointReadings;
  return snapshot;
}

function serializeSnapshot(snapshot) {
  const json = JSON.stringify(snapshot);
  if (json.length > MAX_SNAPSHOT_CHARS) {
    const error = new Error('Publication snapshot exceeds bounded size');
    error.code = 'SNAPSHOT_TOO_LARGE';
    throw error;
  }
  return json;
}

function parseSnapshot(raw) {
  if (raw && typeof raw === 'object' && raw.schemaVersion) return raw;
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function chunkRichText(text) {
  const content = String(text || '');
  if (!content) return [];
  const chunks = [];
  for (let i = 0; i < content.length; i += NOTION_RICH_TEXT_CHUNK) {
    chunks.push({ text: { content: content.slice(i, i + NOTION_RICH_TEXT_CHUNK) } });
  }
  return chunks;
}

function joinRichTextSegments(segments) {
  if (!Array.isArray(segments)) return '';
  return segments.map((item) => item?.plain_text || item?.text?.content || '').join('');
}

/**
 * Frozen readings are only applied when all six scored parameters are present.
 * Older publications (no readings, or an incomplete set) return null and keep
 * rendering from the Case as before -- nothing is reconstructed for them.
 * Only publications whose score was verified against their readings qualify
 * (quality-v3, country-benchmark). A legacy-publication score was never checked
 * against any readings, so readings stored beside it are not its history.
 */
function completeFrozenReadings(snapshot) {
  const required = FROZEN_REQUIRED_KEYS[snapshot?.scoreType];
  if (!required) return null;
  const readings = compactReadings(snapshot?.readings);
  if (!readings) return null;
  return required.every((key) => Number.isFinite(readings[key])) ? readings : null;
}

/**
 * Put the frozen whole-house readings on the first tap and drop the live
 * measurement layers from every tap. Room names, photos, and every other tap
 * field are kept. Rooms other than the first carry no readings of their own,
 * so the report shows the whole-house values for them (per-room history is
 * not stored in the snapshot).
 */
function frozenTapData(tapData, readings) {
  const taps = Array.isArray(tapData) && tapData.length ? tapData : [{}];
  return taps.map((tap, index) => {
    const { standardMeasurement, meterReadings, chlorineReadings, ...rest } = tap || {};
    return index === 0 ? { ...rest, standardMeasurement: { ...readings } } : rest;
  });
}

/** Live draft fields must not refill a reading the frozen set does not have. */
function withoutReadingFields(fields) {
  const next = { ...(fields || {}) };
  DRAFT_READING_FIELD_KEYS.forEach((key) => { delete next[key]; });
  return next;
}

/**
 * Overlay frozen publication score onto a Case job for public render.
 * Never uses mutable Latest Water Score for a ledger token.
 */
function applyPublicationToJob(job, publication) {
  const snapshot = publication?.snapshot || publication;
  if (!snapshot || !Number.isFinite(Number(snapshot.publishedScore))) {
    return job;
  }
  const next = {
    ...(job || {}),
    draft: { ...((job && job.draft) || {}) },
    result: { ...((job && job.result) || {}) }
  };
  next.result.waterScore = snapshot.publishedScore;
  next.result.complianceStatus = snapshot.complianceStatus || null;
  next.result.summary = snapshot.resultSummary || next.result.summary || '';
  next.result.publicReportToken = snapshot.publicReportToken;
  next.result.reportUrl = snapshot.reportUrl || buildReportUrl(snapshot.publicReportToken);
  next.result.publicationId = snapshot.publicationId;
  next.result.scoreType = snapshot.scoreType;
  if (snapshot.standardKey) next.result.standardKey = snapshot.standardKey;
  if (Array.isArray(snapshot.pointReadings)) {
    next.result.pointReadings = snapshot.pointReadings.map((point) => ({
      ordinal: Number(point.ordinal),
      label: String(point.label || ''),
      readings: point.readings == null ? null : { ...point.readings }
    }));
  }
  next.result.modelVersion = snapshot.modelVersion;
  next.result.benchmarkVersion = snapshot.benchmarkVersion;
  next.result.publishedAt = snapshot.publishedAt;
  next.result.publicationSource = 'ledger';
  if (snapshot.readings) {
    next.draft.scoreBaseReadings = { ...snapshot.readings };
  }
  const frozen = completeFrozenReadings(snapshot);
  if (frozen) {
    next.draft.tapData = frozenTapData(next.draft.tapData, frozen);
    next.draft.fields = withoutReadingFields(next.draft.fields);
  }
  return next;
}

function minimalJobFromSnapshot(snapshot) {
  return applyPublicationToJob({
    id: snapshot.caseId || snapshot.clientPageId,
    notionId: snapshot.clientPageId,
    name: 'Published report',
    draft: { fields: {}, tapData: [] },
    result: {},
    drive: {}
  }, { snapshot });
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  UNKNOWN,
  SCORE_TYPES,
  READING_KEYS,
  MAX_SNAPSHOT_CHARS,
  compactReadings,
  sanitizePointReadings,
  provenance,
  buildSnapshot,
  serializeSnapshot,
  parseSnapshot,
  chunkRichText,
  joinRichTextSegments,
  applyPublicationToJob,
  minimalJobFromSnapshot
};
