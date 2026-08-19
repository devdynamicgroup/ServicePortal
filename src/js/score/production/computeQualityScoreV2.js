/**
 * Production Quality Score V3 — Near-Ideal proximity (recalibrated).
 *
 * Product decisions:
 *   100 = genuinely Near-Ideal / Exceptional Quality (PROJECT Ideal index)
 *   PASS ≠ 100
 *   Quality ≠ country Benchmark
 *   Country differences live in Benchmark engines, not in this Quality model
 *
 * Architecture:
 *   Measurements → Compliance (PASS/WARNING/FAIL)
 *               → Quality Score 0–100 (this module)
 *               → Benchmark Comparison (Thailand / Japan / WHO / EU / US EPA)
 *
 * Weights: UNCHANGED equal average of 6 scored parameters (PD-007 D).
 * Temp / EC / DO% / Total Chlorine: NOT SCORED.
 *
 * PD-011 A (2026-08-13) — KEEP + LABEL for Ideal magnitudes (NO numeric change):
 * - pH center 7.2, TDS NI ≤80, ORP Ideal 400±25, DO NI ≥8, Cl >0.5 curve
 *   are PROJECT-DEFINED product rules — NOT WHO / EPA / JP / national Ideals.
 * - Historical claim “pH 7.2 = midpoint of 6.5–8.5” is FALSE (true mid = 7.5)
 *   and must not be restated as justification.
 * - Free Cl flat 0.2–0.5 reuses WHO residual *guidance framing* only; it is not
 *   a verified “quality Ideal = 100” regulatory standard. High-side >0.5 curve
 *   remains PROJECT interim (46@1.0 / 28@2.0 / floor 8) — not evidence-derived.
 * - Turbidity NI ≤0.1 retains PARTIAL WHO disinfection Ideal framing (unchanged).
 * - ORP 400±25 is project Ideal, separate from shared operational band 200–600 (PD-004).
 *
 * Legacy DWQI remains in computeLegacyDwqiScore (frozen reference).
 */
(function initQualityScoreV3(global) {
  const ENGINE_VERSION = 'quality-v3.0';

  function clamp(n, lo, hi) {
    if (typeof scoreClamp === 'function') return scoreClamp(n, lo, hi);
    return Math.max(lo, Math.min(hi, n));
  }

  function lerp(x, x0, y0, x1, y1) {
    if (x <= x0) return y0;
    if (x >= x1) return y1;
    return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
  }

  function gradePh(ph) {
    // PD-011 A: PROJECT-DEFINED Ideal center 7.2 (NOT a WHO/EPA Ideal; NOT midpoint of 6.5–8.5).
    const d = Math.abs(ph - 7.2);
    if (d <= 0.15) return 100;
    if (d <= 0.4) return lerp(d, 0.15, 100, 0.4, 90);
    if (d <= 0.8) return lerp(d, 0.4, 90, 0.8, 78);
    if (d <= 1.3) return lerp(d, 0.8, 78, 1.3, 66);
    if (d <= 1.8) return lerp(d, 1.3, 66, 1.8, 48);
    return clamp(48 - (d - 1.8) * 22, 8, 48);
  }

  function gradeTds(tds) {
    // PD-011 A: PROJECT-DEFINED Near-Ideal ≤80 (NOT WHO excellent <300; NOT Japan taste 30–200 Ideal).
    if (tds <= 80) return 100;
    if (tds <= 120) return lerp(tds, 80, 100, 120, 92);
    if (tds <= 200) return lerp(tds, 120, 92, 200, 80);
    if (tds <= 300) return lerp(tds, 200, 80, 300, 68);
    if (tds <= 500) return lerp(tds, 300, 68, 500, 52);
    if (tds <= 1000) return lerp(tds, 500, 52, 1000, 34);
    return clamp(34 - (tds - 1000) / 40, 5, 34);
  }

  function gradeTurbidity(turb) {
    // Near-Ideal 0.10 NTU (WHO: "ideally <0.1 NTU for effective disinfection",
    // Guidelines for Drinking-water Quality, turbidity fact sheet). Changed
    // from 0.08 — see docs/quality-v3/REALITY_FIRST_IMPLEMENTATION_REPORT.md.
    if (turb <= 0.1) return 100;
    if (turb <= 0.2) return lerp(turb, 0.1, 100, 0.2, 88);
    if (turb <= 0.5) return lerp(turb, 0.2, 88, 0.5, 74);
    if (turb <= 1.0) return lerp(turb, 0.5, 74, 1.0, 60);
    if (turb <= 3.0) return lerp(turb, 1.0, 60, 3.0, 40);
    if (turb <= 5.0) return lerp(turb, 3.0, 40, 5.0, 28);
    return clamp(28 - (turb - 5) * 4, 5, 28);
  }

  function gradeChlorine(fcl) {
    // PD-011 A: Flat 0.2–0.5 uses WHO residual *guidance framing* only (delivery min /
    // disinfection contact) — NOT a verified regulatory “quality Ideal = 100”.
    // High-side >0.5 (46@1.0 / 28@2.0 / floor 8) is PROJECT-DEFINED interim —
    // NOT derived from MRDL/GV/taste. Magnitudes unchanged.
    if (fcl >= 0.2 && fcl <= 0.5) return 100;
    if (fcl < 0.2) return clamp(lerp(fcl, 0, 5, 0.2, 100), 2, 100);
    if (fcl <= 1.0) return lerp(fcl, 0.5, 100, 1.0, 46);
    if (fcl <= 2.0) return lerp(fcl, 1.0, 46, 2.0, 28);
    return clamp(28 - (fcl - 2) * 8, 8, 28);
  }

  function gradeOrp(orp) {
    // PD-011 A: PROJECT-DEFINED Ideal 400±25 — NOT a WHO universal Ideal.
    // Separate from shared operational band 200–600 (PD-004).
    const d = Math.abs(orp - 400);
    if (d <= 25) return 100;
    if (d <= 70) return lerp(d, 25, 100, 70, 86);
    if (d <= 130) return lerp(d, 70, 86, 130, 70);
    if (d <= 200) return lerp(d, 130, 70, 200, 58);
    if (orp < 200) return clamp((orp / 200) * 58, 8, 58);
    return clamp(58 - (orp - 600) / 8, 8, 58);
  }

  function gradeDo(doValue) {
    // PD-011 A: PROJECT-DEFINED Near-Ideal ≥8 — NOT a potable WHO Ideal; NOT aquatic-life criterion.
    if (doValue >= 8.0) return 100;
    if (doValue >= 7.2) return lerp(doValue, 7.2, 90, 8.0, 100);
    if (doValue >= 6.5) return lerp(doValue, 6.5, 78, 7.2, 90);
    if (doValue >= 6.0) return lerp(doValue, 6.0, 68, 6.5, 78);
    if (doValue >= 5.0) return lerp(doValue, 5.0, 52, 6.0, 68);
    if (doValue >= 3.0) return lerp(doValue, 3.0, 28, 5.0, 52);
    return clamp((doValue / 3) * 28, 5, 28);
  }

  /**
   * Shared benchmark base (2026-08-18, PO-approved; weighting restored
   * 2026-08-19 after forensic audit — see below): a single grading formula —
   * this module's existing curves — computed once and reused as the base
   * score for every country engine (Thailand/Japan/WHO/EU/US EPA), replacing
   * each engine's own separate per-parameter grade curves. Countries differ
   * in their own PASS/WARNING/FAIL/CRITICAL thresholds, severity caps, and
   * gates (e.g. EU's PD-002 chlorine gate) — applied by each engine on top of
   * this shared number — AND, as of 2026-08-19, in how much each already-
   * graded parameter counts toward the composite, via each engine's own
   * `*BenchmarkWeights` (Japan/EU/EPA/WHO/Thailand — unchanged files, already
   * documented with country-specific rationale). The underlying curve shape
   * (what a given raw pH/TDS/turbidity/etc. value grades to) stays 100%
   * identical across every country — only the aggregation weighting differs.
   *
   * 2026-08-19 forensic finding: between 2026-08-18 and 2026-08-19 this
   * function accepted only `readings`, always producing a flat unweighted
   * mean — every `*BenchmarkWeights` file was destructured into a local `W`
   * in each engine's score.js but never read, making 4 of 5 countries'
   * weight profiles (Thailand/WHO/EU/US EPA — Japan differentiates via its
   * own narrow PASS band regardless) dead configuration. That silent gap is
   * why Thailand/WHO/EU/US EPA converged to identical numbers whenever all
   * four happened to classify PASS on every parameter: the raw composite
   * literally could not know which country asked for it. This restores the
   * weighting; no new numbers were introduced, no per-Case logic, no country
   * name checks — `weights` is an optional 2nd argument so any caller that
   * omits it (computeQualityScoreDetail below is a wholly separate function
   * and is not affected either way) keeps today's flat-average behavior.
   *
   * Deliberately more tolerant than computeQualityScoreDetail (the Quality V3
   * publish/share score) above: ph/tds/turbidity/orp are required, but
   * chlorine and do are graded only when present and simply excluded from
   * the average otherwise, so a Case missing either can still produce a
   * benchmark base score instead of every country going incomplete at once.
   * This does not change computeQualityScoreDetail's own (stricter, all-6)
   * requirement — that publish-path score is untouched.
   */
  function computeSharedBenchmarkBase(readings, weights) {
    const toFin = typeof toFiniteReading === 'function' ? toFiniteReading : (v) => { if (v === null || v === undefined || v === '' || v === false) return NaN; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
    const ph = toFin(readings.ph);
    const tds = toFin(readings.tds);
    const turb = toFin(readings.turbidity);
    const orp = toFin(readings.orp);
    const fcl = toFin(readings.chlorine);
    const do_ = toFin(readings.do);

    if (![ph, tds, turb, orp].every(Number.isFinite)) {
      return { score: null, params: null, complete: false };
    }

    const params = {
      ph: gradePh(ph),
      tds: gradeTds(tds),
      turbidity: gradeTurbidity(turb),
      orp: gradeOrp(orp)
    };
    if (Number.isFinite(fcl)) params.chlorine = gradeChlorine(fcl);
    if (Number.isFinite(do_)) params.do = gradeDo(do_);

    const grades = Object.values(params);
    let score;
    if (weights && typeof weights === 'object') {
      // Weighted mean over whichever params are present. A param key absent
      // from the given weights object (e.g. Thailand's do/temp omission,
      // documented in thailand/weights.js) contributes zero — same effect
      // as "not scored", not "scored at equal weight".
      let weightedSum = 0;
      let weightTotal = 0;
      Object.keys(params).forEach((key) => {
        const w = Number(weights[key]);
        if (!Number.isFinite(w) || w <= 0) return;
        weightedSum += params[key] * w;
        weightTotal += w;
      });
      score = weightTotal > 0
        ? Math.round(weightedSum / weightTotal)
        : Math.round(grades.reduce((sum, g) => sum + g, 0) / grades.length);
    } else {
      score = Math.round(grades.reduce((sum, g) => sum + g, 0) / grades.length);
    }

    return { score, params, complete: true };
  }

  function evaluateCompliance(readings) {
    const toFin = typeof toFiniteReading === 'function' ? toFiniteReading : (v) => { if (v === null || v === undefined || v === '' || v === false) return NaN; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
    const ph = toFin(readings.ph);
    const tds = toFin(readings.tds);
    const turb = toFin(readings.turbidity);
    const orp = toFin(readings.orp);
    const fcl = toFin(readings.chlorine);
    const do_ = toFin(readings.do);

    const checks = {
      ph: ph >= 6.5 && ph <= 8.5,
      tds: tds <= 300,
      turbidity: turb <= 1,
      orp: orp >= 200 && orp <= 600,
      chlorine: fcl >= 0.2 && fcl <= 0.5,
      do: do_ >= 6
    };

    const failed = Object.keys(checks).filter((k) => checks[k] === false);
    const marginal = [];
    if (Number.isFinite(ph) && (ph < 6.7 || ph > 8.3) && checks.ph) marginal.push('ph');
    if (Number.isFinite(tds) && tds > 250 && checks.tds) marginal.push('tds');
    if (Number.isFinite(turb) && turb > 0.7 && checks.turbidity) marginal.push('turbidity');
    if (Number.isFinite(fcl) && (fcl <= 0.22 || fcl >= 0.48) && checks.chlorine) marginal.push('chlorine');
    if (Number.isFinite(do_) && do_ < 6.3 && checks.do) marginal.push('do');

    let status = 'PASS';
    if (failed.length) status = failed.length >= 2 ? 'FAIL' : 'WARNING';
    else if (marginal.length >= 2) status = 'WARNING';

    return {
      status,
      checks,
      failedParameters: failed,
      marginalParameters: marginal,
      standardRevision: 'Quality V3 compliance checks use project pass bands; Near-Ideal Quality targets are PROJECT-DEFINED (PD-011 A), not national Ideals'
    };
  }

  function computeQualityScoreDetail(readings) {
    const toFin = typeof toFiniteReading === 'function' ? toFiniteReading : (v) => { if (v === null || v === undefined || v === '' || v === false) return NaN; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
    const ph = toFin(readings.ph);
    const tds = toFin(readings.tds);
    const turb = toFin(readings.turbidity);
    const orp = toFin(readings.orp);
    const fcl = toFin(readings.chlorine);
    const do_ = toFin(readings.do);

    if (![ph, tds, turb, orp, fcl, do_].every(Number.isFinite)) {
      return {
        score: null,
        params: null,
        compliance: null,
        engineVersion: ENGINE_VERSION,
        incomplete: true,
        type: 'quality'
      };
    }

    const params = {
      ph: gradePh(ph),
      tds: gradeTds(tds),
      turbidity: gradeTurbidity(turb),
      orp: gradeOrp(orp),
      chlorine: gradeChlorine(fcl),
      do: gradeDo(do_)
    };

    const score = Math.round(
      (params.ph + params.tds + params.turbidity + params.orp + params.chlorine + params.do) / 6
    );

    return {
      score,
      params,
      compliance: evaluateCompliance(readings),
      engineVersion: ENGINE_VERSION,
      incomplete: false,
      type: 'quality',
      version: ENGINE_VERSION,
      weights: Object.freeze({ ph: 1, tds: 1, turbidity: 1, orp: 1, chlorine: 1, do: 1 }),
      notScored: Object.freeze(['temp', 'ec', 'doPercent', 'totalChlorine'])
    };
  }

  function computeScoreFromReadings(readings) {
    const detail = computeQualityScoreDetail(readings);
    if (detail.incomplete || !Number.isFinite(detail.score)) {
      if (typeof console !== 'undefined' && console.log) {
        console.log('FINAL SCORE skipped — incomplete readings (quality-v3)');
      }
      return null;
    }
    if (typeof console !== 'undefined' && console.log) {
      console.log('FINAL SCORE', detail.score, {
        engine: ENGINE_VERSION,
        params: detail.params,
        compliance: detail.compliance && detail.compliance.status
      });
    }
    return detail.score;
  }

  global.computeQualityScoreDetail = computeQualityScoreDetail;
  global.computeQualityScoreV2 = computeQualityScoreDetail;
  global.computeQualityScoreV3 = computeQualityScoreDetail;
  global.computeScoreFromReadings = computeScoreFromReadings;
  global.computeSharedBenchmarkBase = computeSharedBenchmarkBase;
  global.QUALITY_SCORE_ENGINE_VERSION = ENGINE_VERSION;

  if (typeof window !== 'undefined') {
    window.computeQualityScoreDetail = computeQualityScoreDetail;
    window.computeQualityScoreV2 = computeQualityScoreDetail;
    window.computeQualityScoreV3 = computeQualityScoreDetail;
    window.computeScoreFromReadings = computeScoreFromReadings;
    window.computeSharedBenchmarkBase = computeSharedBenchmarkBase;
    window.QUALITY_SCORE_ENGINE_VERSION = ENGINE_VERSION;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
