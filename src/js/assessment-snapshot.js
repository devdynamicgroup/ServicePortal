/**
 * Assessment Snapshot contract — Case-level measurement persistence.
 *
 * Pure functions only. No Score / Eligibility / Notion I/O.
 *
 * Semantics for reading fields on merge:
 *   - key absent            → not supplied (keep existing)
 *   - key: number           → set
 *   - key: null             → explicit clear
 *   - '' / undefined never stored as measurements
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.AssessmentSnapshot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const METER_KEYS = Object.freeze([
    'ph', 'tds', 'ec', 'temp', 'turbidity', 'orp', 'do', 'doPercent'
  ]);
  const CHLORINE_KEYS = Object.freeze(['freeChlorine', 'totalChlorine']);
  const STANDARD_KEYS = Object.freeze([
    'ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'
  ]);
  const TASK_KEYS = Object.freeze([
    'tapphoto', 'meter', 'visual', 'chlorine', 'pressure', 'infra'
  ]);
  const NOTION_RICH_TEXT_CHUNK = 1900;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isDataUrl(value) {
    return typeof value === 'string' && /^data:/i.test(value);
  }

  /** Finite number only — never coerce '', null, or garbage into 0. */
  function asMeasurementNumber(value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  /**
   * Compact a readings map.
   * omitCleared=false keeps null markers for explicit clears (merge payloads).
   */
  function compactReadings(source, keys, { keepNull = false } = {}) {
    if (!isPlainObject(source)) return {};
    const out = {};
    keys.forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(source, key)) return;
      const raw = source[key];
      if (raw === null) {
        if (keepNull) out[key] = null;
        return;
      }
      const n = asMeasurementNumber(raw);
      if (n !== undefined) out[key] = n;
    });
    return out;
  }

  function compactTasks(tasks) {
    if (!isPlainObject(tasks)) return {};
    const out = {};
    TASK_KEYS.forEach(key => {
      if (tasks[key]) out[key] = true;
    });
    return out;
  }

  /** Photo references only — never persist base64 / data URLs. */
  function compactPhotoRef(photo) {
    if (!photo) return undefined;
    if (typeof photo === 'string') {
      if (isDataUrl(photo)) return undefined;
      const trimmed = photo.trim();
      return trimmed ? { contentUrl: trimmed } : undefined;
    }
    if (!isPlainObject(photo)) return undefined;
    const ref = {};
    if (photo.fileId) ref.fileId = String(photo.fileId);
    if (photo.contentUrl && !isDataUrl(photo.contentUrl)) {
      ref.contentUrl = String(photo.contentUrl);
    }
    if (photo.name) ref.name = String(photo.name);
    if (photo.purpose) ref.purpose = String(photo.purpose);
    return Object.keys(ref).length ? ref : undefined;
  }

  function compactPhotos(photos) {
    if (!isPlainObject(photos)) return {};
    const out = {};
    Object.keys(photos).forEach(key => {
      const ref = compactPhotoRef(photos[key]);
      if (ref) out[key] = ref;
    });
    return out;
  }

  function compactMeterImages(images) {
    if (!Array.isArray(images) || !images.length) return undefined;
    const out = images.map(entry => {
      if (!isPlainObject(entry)) return null;
      const photo = compactPhotoRef(entry.photo || entry);
      const item = {};
      if (entry.id) item.id = String(entry.id);
      if (photo) item.photo = photo;
      const std = compactReadings(entry.standardMeasurement, STANDARD_KEYS);
      const meter = compactReadings(entry.detected || entry.meterReadings, METER_KEYS);
      if (Object.keys(std).length) item.standardMeasurement = std;
      if (Object.keys(meter).length) item.meterReadings = meter;
      return Object.keys(item).length ? item : null;
    }).filter(Boolean);
    return out.length ? out : undefined;
  }

  function buildTapSnapshot(tap, index, name) {
    const meterReadings = compactReadings(tap?.meterReadings, METER_KEYS);
    const chlorineReadings = compactReadings(tap?.chlorineReadings, CHLORINE_KEYS);
    const standardMeasurement = compactReadings(tap?.standardMeasurement, STANDARD_KEYS);
    // Prefer freeChlorine when standardMeasurement.chlorine is absent.
    if (
      standardMeasurement.chlorine === undefined
      && chlorineReadings.freeChlorine !== undefined
    ) {
      standardMeasurement.chlorine = chlorineReadings.freeChlorine;
    }
    const tasks = compactTasks(tap?.tasks);
    const photos = compactPhotos(tap?.photos);
    const meterImages = compactMeterImages(tap?.meterImages);

    const out = {
      index: Number(index) || 0,
      name: String(name || `Tap ${(Number(index) || 0) + 1}`)
    };
    if (Object.keys(meterReadings).length) out.meterReadings = meterReadings;
    if (Object.keys(chlorineReadings).length) out.chlorineReadings = chlorineReadings;
    if (Object.keys(standardMeasurement).length) out.standardMeasurement = standardMeasurement;
    if (Object.keys(tasks).length) out.tasks = tasks;
    if (Object.keys(photos).length) out.photos = photos;
    if (meterImages) out.meterImages = meterImages;
    return out;
  }

  /**
   * Build snapshot from portal job draft / live S state.
   * @param {object} params
   * @param {string[]} [params.taps]
   * @param {object[]} [params.tapData]
   * @param {number} [params.revision]
   * @param {string} [params.updatedAt]
   */
  function buildSnapshot({
    taps = [],
    tapData = [],
    revision = 1,
    updatedAt = new Date().toISOString()
  } = {}) {
    const names = Array.isArray(taps) && taps.length
      ? taps.slice()
      : (tapData || []).map((_, i) => `Tap ${i + 1}`);
    const rows = Array.isArray(tapData) ? tapData : [];
    const count = Math.max(names.length, rows.length);
    const snapshotTaps = [];
    for (let i = 0; i < count; i += 1) {
      snapshotTaps.push(buildTapSnapshot(rows[i] || {}, i, names[i]));
    }
    return Object.freeze({
      version: VERSION,
      updatedAt: String(updatedAt || new Date().toISOString()),
      revision: Math.max(1, Math.floor(Number(revision) || 1)),
      taps: snapshotTaps
    });
  }

  function isValidSnapshot(snapshot) {
    if (!isPlainObject(snapshot)) return false;
    if (Number(snapshot.version) !== VERSION) return false;
    if (!Array.isArray(snapshot.taps)) return false;
    if (!snapshot.updatedAt || typeof snapshot.updatedAt !== 'string') return false;
    if (!Number.isFinite(Number(snapshot.revision))) return false;
    return true;
  }

  function parseSnapshot(raw) {
    if (raw == null || raw === '') return null;
    let value = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      try {
        value = JSON.parse(trimmed);
      } catch (error) {
        return null;
      }
    }
    if (!isValidSnapshot(value)) return null;
    return value;
  }

  function serializeSnapshot(snapshot) {
    if (!isValidSnapshot(snapshot)) {
      throw new Error('Invalid assessment snapshot');
    }
    return JSON.stringify(snapshot);
  }

  /** Split long JSON across Notion rich_text segments (no space between chunks). */
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
    return segments.map(item => item?.plain_text || item?.text?.content || '').join('');
  }

  /**
   * Field-level merge for one readings object.
   * Incoming absent → keep; null → clear; number → set.
   */
  function mergeReadingMaps(existing = {}, incoming, keys) {
    const base = compactReadings(existing, keys);
    if (!isPlainObject(incoming)) return base;
    const out = { ...base };
    keys.forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(incoming, key)) return;
      const raw = incoming[key];
      if (raw === null) {
        delete out[key];
        return;
      }
      const n = asMeasurementNumber(raw);
      if (n !== undefined) out[key] = n;
    });
    return out;
  }

  function mergeTap(existingTap = {}, incomingTap = {}) {
    const meterReadings = mergeReadingMaps(
      existingTap.meterReadings, incomingTap.meterReadings, METER_KEYS
    );
    const chlorineReadings = mergeReadingMaps(
      existingTap.chlorineReadings, incomingTap.chlorineReadings, CHLORINE_KEYS
    );
    const standardMeasurement = mergeReadingMaps(
      existingTap.standardMeasurement, incomingTap.standardMeasurement, STANDARD_KEYS
    );
    const tasks = {
      ...compactTasks(existingTap.tasks),
      ...compactTasks(incomingTap.tasks)
    };
    const photos = {
      ...compactPhotos(existingTap.photos),
      ...compactPhotos(incomingTap.photos)
    };
    const meterImages = incomingTap.meterImages !== undefined
      ? compactMeterImages(incomingTap.meterImages)
      : compactMeterImages(existingTap.meterImages);

    const out = {
      index: Number.isFinite(Number(incomingTap.index))
        ? Number(incomingTap.index)
        : (Number(existingTap.index) || 0),
      name: String(incomingTap.name || existingTap.name || '')
    };
    if (Object.keys(meterReadings).length) out.meterReadings = meterReadings;
    if (Object.keys(chlorineReadings).length) out.chlorineReadings = chlorineReadings;
    if (Object.keys(standardMeasurement).length) out.standardMeasurement = standardMeasurement;
    if (Object.keys(tasks).length) out.tasks = tasks;
    if (Object.keys(photos).length) out.photos = photos;
    if (meterImages) out.meterImages = meterImages;
    return out;
  }

  /**
   * Merge snapshots. Incoming wins on revision/updatedAt when newer;
   * within equal revision, field-level merge (absent ≠ clear).
   */
  function mergeSnapshots(existing, incoming) {
    if (!isValidSnapshot(incoming)) return existing || null;
    if (!isValidSnapshot(existing)) return incoming;

    const existingRev = Number(existing.revision) || 0;
    const incomingRev = Number(incoming.revision) || 0;
    if (incomingRev < existingRev) return existing;

    const existingTs = Date.parse(existing.updatedAt) || 0;
    const incomingTs = Date.parse(incoming.updatedAt) || 0;
    if (incomingRev === existingRev && incomingTs < existingTs) return existing;

    const byIndex = new Map();
    (existing.taps || []).forEach(tap => {
      byIndex.set(Number(tap.index) || 0, tap);
    });
    (incoming.taps || []).forEach(tap => {
      const idx = Number(tap.index) || 0;
      byIndex.set(idx, mergeTap(byIndex.get(idx), tap));
    });

    const taps = Array.from(byIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, tap]) => tap);

    return Object.freeze({
      version: VERSION,
      updatedAt: incomingTs >= existingTs ? incoming.updatedAt : existing.updatedAt,
      revision: Math.max(existingRev, incomingRev),
      taps
    });
  }

  function snapshotHasMeasurements(snapshot) {
    if (!isValidSnapshot(snapshot)) return false;
    return snapshot.taps.some(tap => {
      const meter = tap.meterReadings || {};
      const chlorine = tap.chlorineReadings || {};
      const standard = tap.standardMeasurement || {};
      return Object.keys(meter).length
        || Object.keys(chlorine).length
        || Object.keys(standard).length;
    });
  }

  /** Reconstruct draft.taps / draft.tapData from a validated snapshot. */
  function applySnapshotToDraft(draft, snapshot) {
    const target = draft && typeof draft === 'object' ? draft : {};
    if (!isValidSnapshot(snapshot)) return target;

    const taps = snapshot.taps.map((tap, i) => String(tap.name || `Tap ${i + 1}`));
    const tapData = snapshot.taps.map(tap => {
      const row = {
        tasks: { ...(tap.tasks || {}) },
        photos: { ...(tap.photos || {}) }
      };
      if (tap.meterReadings) row.meterReadings = { ...tap.meterReadings };
      if (tap.chlorineReadings) row.chlorineReadings = { ...tap.chlorineReadings };
      if (tap.standardMeasurement) row.standardMeasurement = { ...tap.standardMeasurement };
      if (Array.isArray(tap.meterImages)) row.meterImages = tap.meterImages.slice();
      return row;
    });

    target.taps = taps;
    target.tapData = tapData;
    target.assessmentUpdatedAt = snapshot.updatedAt;
    target.assessmentRevision = snapshot.revision;
    target.assessmentSnapshotVersion = snapshot.version;
    return target;
  }

  function draftHasMeasurements(draft) {
    const tapData = draft?.tapData;
    if (!Array.isArray(tapData)) return false;
    return tapData.some(tap => {
      if (!tap) return false;
      return Boolean(
        Object.keys(tap.meterReadings || {}).length
        || Object.keys(tap.chlorineReadings || {}).length
        || Object.keys(tap.standardMeasurement || {}).length
      );
    });
  }

  /** Prefer richer / newer draft when merging local cache with Notion job. */
  function preferDraft(localDraft, remoteDraft) {
    const localHas = draftHasMeasurements(localDraft);
    const remoteHas = draftHasMeasurements(remoteDraft);
    if (localHas && !remoteHas) return localDraft;
    if (remoteHas && !localHas) return remoteDraft;
    if (!localHas && !remoteHas) return localDraft || remoteDraft || null;

    const localTs = Date.parse(localDraft?.assessmentUpdatedAt || 0) || 0;
    const remoteTs = Date.parse(remoteDraft?.assessmentUpdatedAt || 0) || 0;
    if (remoteTs > localTs) return remoteDraft;
    if (localTs > remoteTs) return localDraft;

    const localRev = Number(localDraft?.assessmentRevision) || 0;
    const remoteRev = Number(remoteDraft?.assessmentRevision) || 0;
    return remoteRev > localRev ? remoteDraft : localDraft;
  }

  return {
    VERSION,
    METER_KEYS,
    CHLORINE_KEYS,
    STANDARD_KEYS,
    TASK_KEYS,
    buildSnapshot,
    isValidSnapshot,
    parseSnapshot,
    serializeSnapshot,
    chunkRichText,
    joinRichTextSegments,
    mergeSnapshots,
    mergeReadingMaps,
    snapshotHasMeasurements,
    applySnapshotToDraft,
    draftHasMeasurements,
    preferDraft,
    compactPhotoRef,
    asMeasurementNumber
  };
});
