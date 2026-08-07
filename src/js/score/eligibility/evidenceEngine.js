/**
 * Evidence Engine — describes WHERE each measurement came from.
 *
 * Pure utility. Never invents values, never defaults a missing measurement,
 * never computes a score. Sits in front of the (frozen) production/benchmark
 * engines and does not call them.
 */

const EVIDENCE_STATE = Object.freeze({
  MEASURED: 'Measured',
  MISSING: 'Missing',
  INVALID: 'Invalid',
  ESTIMATED: 'Estimated',
  IMPORTED: 'Imported'
});

/**
 * Classify one measurement's evidence.
 *
 * @param {*} value - the raw reading value (may be undefined/null/NaN/number/string)
 * @param {object} [source] - optional metadata describing provenance
 * @param {string} [source.origin] - e.g. 'OCR', 'Manual', 'Imported', 'Estimated'
 * @param {number} [source.confidence] - 0-100
 * @param {string} [source.timestamp] - ISO timestamp
 */
function describeMeasurementEvidence(value, source = {}) {
  const present = value !== undefined && value !== null && value !== '';
  const n = Number(value);
  const isFiniteNumber = present && Number.isFinite(n);

  let state;
  if (!present) {
    state = EVIDENCE_STATE.MISSING;
  } else if (!isFiniteNumber) {
    state = EVIDENCE_STATE.INVALID;
  } else if (source && source.origin === 'Estimated') {
    state = EVIDENCE_STATE.ESTIMATED;
  } else if (source && source.origin === 'Imported') {
    state = EVIDENCE_STATE.IMPORTED;
  } else {
    state = EVIDENCE_STATE.MEASURED;
  }

  return Object.freeze({
    state,
    value: isFiniteNumber ? n : null,
    source: (source && source.origin) || null,
    confidence: (source && Number.isFinite(Number(source.confidence)))
      ? Number(source.confidence)
      : null,
    timestamp: (source && source.timestamp) || null
  });
}

/**
 * Build an evidence map for a full readings object.
 *
 * @param {object} readings - flat readings, e.g. { ph, tds, chlorine, turbidity, orp, do, temp }
 * @param {object} [sourceMeta] - optional per-key provenance, e.g. { ph: { origin:'OCR', confidence:96 } }
 * @param {string[]} [keys] - measurement keys to describe; defaults to the standard set
 * @returns {Record<string, ReturnType<typeof describeMeasurementEvidence>>}
 */
function buildEvidenceMap(readings = {}, sourceMeta = {}, keys) {
  const measurementKeys = keys || ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'];
  const evidence = {};
  measurementKeys.forEach(key => {
    evidence[key] = describeMeasurementEvidence(readings[key], sourceMeta[key]);
  });
  return Object.freeze(evidence);
}

if (typeof window !== 'undefined') {
  window.EvidenceEngine = Object.freeze({
    STATE: EVIDENCE_STATE,
    describeMeasurementEvidence,
    buildEvidenceMap
  });
}
