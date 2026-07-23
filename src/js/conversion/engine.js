/**
 * Layer 2 — Conversion Engine
 *
 * Accepts Raw Measurement and produces Standard Measurement.
 * Pure functions only. Never mutates Raw. Never touches OCR or DWQI.
 *
 * Expert formulas are replaceable via options / registered converters
 * without changing OCR or scoring code.
 *
 * PR1: module exists and is testable; no production callers yet.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.ConversionEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Standard Measurement keys consumed by DWQI (Layer 3). */
  const STANDARD_KEYS = Object.freeze([
    'ph',
    'tds',
    'chlorine',
    'turbidity',
    'orp',
    'do',
    'temp'
  ]);

  /**
   * Replaceable expert defaults.
   * EC→TDS factor is a common NaCl approximation (0.5). Experts may override.
   */
  const DEFAULTS = Object.freeze({
    ecToTdsFactor: 0.5
  });

  function isPresent(value) {
    return value !== undefined && value !== null && value !== '';
  }

  function toFiniteNumber(value) {
    if (!isPresent(value)) return null;
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Normalize OCR / form Raw shapes into a flat raw object (copy).
   * Accepts either a flat raw map or { rawMeasurement: {...} }.
   */
  function unwrapRaw(rawInput) {
    if (!rawInput || typeof rawInput !== 'object') return {};
    if (rawInput.rawMeasurement && typeof rawInput.rawMeasurement === 'object') {
      return { ...rawInput.rawMeasurement };
    }
    return { ...rawInput };
  }

  /**
   * EC (µS/cm) → TDS (mg/L). Pure; does not invent when EC missing.
   */
  function convertEcToTds(ec, factor) {
    const ecN = toFiniteNumber(ec);
    if (ecN === null) {
      return { value: null, reason: 'ec_missing' };
    }
    const f = toFiniteNumber(factor);
    const useFactor = f !== null && f > 0 ? f : DEFAULTS.ecToTdsFactor;
    return {
      value: +(ecN * useFactor).toFixed(2),
      reason: 'ec_to_tds',
      factor: useFactor
    };
  }

  /**
   * DO % saturation → DO mg/L.
   * Explicitly unavailable until an expert formula is registered.
   * Never invents a concentration from saturation alone.
   */
  function convertDoPercentToMgL(doPercent, context) {
    const pct = toFiniteNumber(doPercent);
    if (pct === null) {
      return { value: null, reason: 'do_percent_missing' };
    }
    const custom = context && typeof context.convertDoPercentToMgL === 'function'
      ? context.convertDoPercentToMgL
      : null;
    if (!custom) {
      return {
        value: null,
        reason: 'do_percent_requires_expert_formula',
        doPercent: pct
      };
    }
    const out = custom(pct, context);
    const value = out && typeof out === 'object' ? toFiniteNumber(out.value) : toFiniteNumber(out);
    return {
      value,
      reason: value === null ? 'expert_formula_returned_null' : 'expert_do_percent_to_mg_l',
      doPercent: pct
    };
  }

  function pickRawDoMgL(raw) {
    // Prefer explicit mg/L keys; never treat do_percent / doPercent as mg/L.
    if (isPresent(raw.do_mg_l)) return toFiniteNumber(raw.do_mg_l);
    if (isPresent(raw.doMgL)) return toFiniteNumber(raw.doMgL);
    if (isPresent(raw.do)) return toFiniteNumber(raw.do);
    return null;
  }

  function pickRawDoPercent(raw) {
    if (isPresent(raw.do_percent)) return toFiniteNumber(raw.do_percent);
    if (isPresent(raw.doPercent)) return toFiniteNumber(raw.doPercent);
    return null;
  }

  function pickChlorine(raw) {
    if (isPresent(raw.chlorine)) return toFiniteNumber(raw.chlorine);
    if (isPresent(raw.freeChlorine)) return toFiniteNumber(raw.freeChlorine);
    if (isPresent(raw.totalChlorine)) return toFiniteNumber(raw.totalChlorine);
    return null;
  }

  /**
   * Convert Raw Measurement → Standard Measurement.
   *
   * @param {object} rawInput - Raw measurement (or { rawMeasurement })
   * @param {object} [options]
   * @param {number} [options.ecToTdsFactor]
   * @param {function} [options.convertDoPercentToMgL] - expert override
   * @returns {{
   *   standardMeasurement: object,
   *   applied: Array<object>,
   *   missing: Array<string>,
   *   rawSnapshot: object
   * }}
   */
  function toStandardMeasurement(rawInput, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const raw = unwrapRaw(rawInput);
    const rawSnapshot = Object.freeze({ ...raw });

    const standard = {};
    const applied = [];
    const missing = [];

    // Pass-through Standard fields when already present on Raw.
    const ph = toFiniteNumber(raw.ph);
    if (ph !== null) {
      standard.ph = ph;
      applied.push({ field: 'ph', reason: 'passthrough_raw' });
    } else {
      missing.push('ph');
    }

    const turbidity = toFiniteNumber(raw.turbidity);
    if (turbidity !== null) {
      standard.turbidity = turbidity;
      applied.push({ field: 'turbidity', reason: 'passthrough_raw' });
    } else {
      missing.push('turbidity');
    }

    const orp = toFiniteNumber(raw.orp);
    if (orp !== null) {
      standard.orp = orp;
      applied.push({ field: 'orp', reason: 'passthrough_raw' });
    } else {
      missing.push('orp');
    }

    const temp = toFiniteNumber(raw.temp ?? raw.temperature);
    if (temp !== null) {
      standard.temp = temp;
      applied.push({ field: 'temp', reason: 'passthrough_raw' });
    } else {
      missing.push('temp');
    }

    const chlorine = pickChlorine(raw);
    if (chlorine !== null) {
      standard.chlorine = chlorine;
      applied.push({ field: 'chlorine', reason: 'passthrough_raw' });
    } else {
      missing.push('chlorine');
    }

    // TDS: prefer measured TDS; else derive from EC when possible.
    const tdsMeasured = toFiniteNumber(raw.tds);
    if (tdsMeasured !== null) {
      standard.tds = tdsMeasured;
      applied.push({ field: 'tds', reason: 'passthrough_raw' });
    } else {
      const derived = convertEcToTds(raw.ec, opts.ecToTdsFactor);
      if (derived.value !== null) {
        standard.tds = derived.value;
        applied.push({
          field: 'tds',
          reason: derived.reason,
          factor: derived.factor,
          from: 'ec',
          ec: toFiniteNumber(raw.ec)
        });
      } else {
        missing.push('tds');
        applied.push({ field: 'tds', reason: derived.reason, from: 'ec' });
      }
    }

    // DO mg/L: prefer measured mg/L; never treat % as mg/L.
    const doMgL = pickRawDoMgL(raw);
    if (doMgL !== null) {
      standard.do = doMgL;
      applied.push({ field: 'do', reason: 'passthrough_raw_mg_l' });
    } else {
      const fromPct = convertDoPercentToMgL(pickRawDoPercent(raw), {
        temp: standard.temp ?? temp,
        convertDoPercentToMgL: opts.convertDoPercentToMgL
      });
      if (fromPct.value !== null) {
        standard.do = fromPct.value;
        applied.push({
          field: 'do',
          reason: fromPct.reason,
          from: 'do_percent',
          doPercent: fromPct.doPercent
        });
      } else {
        missing.push('do');
        applied.push({
          field: 'do',
          reason: fromPct.reason,
          from: 'do_percent',
          doPercent: fromPct.doPercent
        });
      }
    }

    return {
      standardMeasurement: standard,
      applied,
      missing,
      rawSnapshot
    };
  }

  return Object.freeze({
    STANDARD_KEYS,
    DEFAULTS,
    toStandardMeasurement,
    convertEcToTds,
    convertDoPercentToMgL,
    unwrapRaw,
    toFiniteNumber
  });
});
