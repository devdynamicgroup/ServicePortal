/**
 * Production Quality Score V2 — Near-Ideal proximity model.
 *
 * Product decision (Calibration Implementation):
 *   100 = Near-Ideal / Exceptional Quality
 *   PASS ≠ 100
 *   Regulatory / acceptability compliance ≠ quality perfection
 *
 * Architecture:
 *   Measurements → Compliance Status (PASS/WARNING/FAIL)
 *               → Quality Score 0–100 (this module; equal weights)
 *               → Benchmark Comparison (unchanged country engines)
 *
 * Weights: UNCHANGED equal average of the same 6 scored parameters as legacy DWQI.
 * Temp / EC / DO% / Total Chlorine: NOT SCORED (unchanged).
 *
 * Calibration basis (not arbitrary per-case hard-coding):
 * - Acceptable ceilings reuse former Production/WHO 100 plateaus as COMPLIANCE,
 *   not as Quality 100.
 * - Near-ideal zones tighten around documented midpoints / operational clusters:
 *   pH midpoint of 6.5–8.5 → 7.2; Cl midpoint of former 0.2–0.5 → ~0.30;
 *   ORP midpoint of former 200–600 → 400; TDS near-ideal inside JP complementary
 *   residue preference band (30–200) and well below EPA SMCL 500; Turbidity
 *   near-ideal stricter than former flat ≤1 and aligned under EU plant ref 0.3;
 *   DO near-ideal above former minimum ≥6.
 *
 * Legacy DWQI formula remains in computeLegacyDwqiScore (frozen reference).
 */
(function initQualityScoreV2(global) {
  const ENGINE_VERSION = 'quality-v2.0';

  function clamp(n, lo, hi) {
    if (typeof scoreClamp === 'function') return scoreClamp(n, lo, hi);
    return Math.max(lo, Math.min(hi, n));
  }

  function lerp(x, x0, y0, x1, y1) {
    if (x <= x0) return y0;
    if (x >= x1) return y1;
    return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
  }

  /** Two-sided distance from ideal center. */
  function gradePh(ph) {
    const d = Math.abs(ph - 7.2);
    if (d <= 0.25) return 100; // Near-Ideal
    if (d <= 0.5) return lerp(d, 0.25, 100, 0.5, 92); // Very Good
    if (d <= 0.9) return lerp(d, 0.5, 92, 0.9, 82); // Good
    if (d <= 1.3) return lerp(d, 0.9, 82, 1.3, 72); // Acceptable (covers ~6.5 / ~8.5)
    if (d <= 1.8) return lerp(d, 1.3, 72, 1.8, 55); // Borderline / Poor
    return clamp(55 - (d - 1.8) * 25, 10, 55); // Critical approach
  }

  /** Lower TDS is better within aesthetic drinking-water framing; ≤300 was former Quality-100. */
  function gradeTds(tds) {
    if (tds <= 100) return 100; // Near-Ideal
    if (tds <= 150) return lerp(tds, 100, 100, 150, 94); // Very Good
    if (tds <= 250) return lerp(tds, 150, 94, 250, 84); // Good
    if (tds <= 300) return lerp(tds, 250, 84, 300, 74); // Acceptable (former Prod plateau edge)
    if (tds <= 500) return lerp(tds, 300, 74, 500, 58); // toward EPA SMCL
    if (tds <= 1000) return lerp(tds, 500, 58, 1000, 40);
    return clamp(40 - (tds - 1000) / 40, 5, 40);
  }

  /** Lower turbidity is better; former ≤1 = 100 becomes Acceptable, not Ideal. */
  function gradeTurbidity(turb) {
    if (turb <= 0.15) return 100; // Near-Ideal
    if (turb <= 0.3) return lerp(turb, 0.15, 100, 0.3, 94); // Very Good (EU plant ref cluster)
    if (turb <= 0.6) return lerp(turb, 0.3, 94, 0.6, 86); // Good
    if (turb <= 1.0) return lerp(turb, 0.6, 86, 1.0, 74); // Acceptable (former Prod 100 edge)
    if (turb <= 3.0) return lerp(turb, 1.0, 74, 3.0, 52);
    if (turb <= 5.0) return lerp(turb, 3.0, 52, 5.0, 38); // TH compliance ceiling region
    return clamp(38 - (turb - 5) * 4, 5, 38);
  }

  /**
   * Free chlorine — two-sided around residual target cluster (~0.30),
   * derived from midpoint of former Production ideal band 0.2–0.5.
   * Context note: tap residual; post-filter / bottled may need Product revisit.
   */
  function gradeChlorine(fcl) {
    const ideal = 0.3;
    const d = Math.abs(fcl - ideal);
    if (d <= 0.05) return 100; // 0.25–0.35 Near-Ideal
    if (d <= 0.12) return lerp(d, 0.05, 100, 0.12, 93); // ~0.18–0.42 Very Good
    if (d <= 0.2) return lerp(d, 0.12, 93, 0.2, 84); // covers ~0.10–0.50 Good/Acceptable edge
    if (fcl < 0.1) return clamp(lerp(fcl, 0, 20, 0.1, 70), 10, 70);
    if (fcl <= 1.0) return lerp(fcl, 0.5, 84, 1.0, 62);
    if (fcl <= 2.0) return lerp(fcl, 1.0, 62, 2.0, 40);
    return clamp(40 - (fcl - 2) * 10, 10, 40);
  }

  /** ORP — no external Ideal; use midpoint of former operational band 200–600. */
  function gradeOrp(orp) {
    const d = Math.abs(orp - 400);
    if (d <= 50) return 100; // Near-Ideal around operational center
    if (d <= 100) return lerp(d, 50, 100, 100, 92);
    if (d <= 150) return lerp(d, 100, 92, 150, 82);
    if (d <= 200) return lerp(d, 150, 82, 200, 72); // edges ~200 / ~600
    if (orp < 200) return clamp((orp / 200) * 72, 10, 72);
    return clamp(72 - (orp - 600) / 8, 10, 72);
  }

  /** DO — former ≥6 = 100 becomes high-Acceptable, not Near-Ideal. */
  function gradeDo(doValue) {
    if (doValue >= 7.5) return 100;
    if (doValue >= 7.0) return lerp(doValue, 7.0, 96, 7.5, 100);
    if (doValue >= 6.5) return lerp(doValue, 6.5, 90, 7.0, 96);
    if (doValue >= 6.0) return lerp(doValue, 6.0, 84, 6.5, 90); // former minimum → ~84
    if (doValue >= 5.0) return lerp(doValue, 5.0, 68, 6.0, 84);
    if (doValue >= 3.0) return lerp(doValue, 3.0, 40, 5.0, 68);
    return clamp((doValue / 3) * 40, 5, 40);
  }

  /**
   * Compliance uses former Production/WHO acceptability plateaus (PASS bands),
   * intentionally separate from Near-Ideal Quality 100.
   */
  function evaluateCompliance(readings) {
    const ph = Number(readings.ph);
    const tds = Number(readings.tds);
    const turb = Number(readings.turbidity);
    const orp = Number(readings.orp);
    const fcl = Number(readings.chlorine);
    const do_ = Number(readings.do);

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
      standardRevision: 'Former Production/WHO acceptability plateaus (compliance only)'
    };
  }

  function computeQualityScoreDetail(readings) {
    const ph = Number(readings.ph);
    const tds = Number(readings.tds);
    const turb = Number(readings.turbidity);
    const orp = Number(readings.orp);
    const fcl = Number(readings.chlorine);
    const do_ = Number(readings.do);

    if (![ph, tds, turb, orp, fcl, do_].every(Number.isFinite)) {
      return {
        score: null,
        params: null,
        compliance: null,
        engineVersion: ENGINE_VERSION,
        incomplete: true
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
      weights: Object.freeze({ ph: 1, tds: 1, turbidity: 1, orp: 1, chlorine: 1, do: 1 }),
      notScored: Object.freeze(['temp', 'ec', 'doPercent', 'totalChlorine'])
    };
  }

  /** Drop-in numeric API used by share / publish / assessment. */
  function computeScoreFromReadings(readings) {
    const detail = computeQualityScoreDetail(readings);
    if (detail.incomplete || !Number.isFinite(detail.score)) {
      if (typeof console !== 'undefined' && console.log) {
        console.log('FINAL SCORE skipped — incomplete readings (quality-v2)');
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
  global.computeScoreFromReadings = computeScoreFromReadings;
  global.QUALITY_SCORE_ENGINE_VERSION = ENGINE_VERSION;

  if (typeof window !== 'undefined') {
    window.computeQualityScoreDetail = computeQualityScoreDetail;
    window.computeQualityScoreV2 = computeQualityScoreDetail;
    window.computeScoreFromReadings = computeScoreFromReadings;
    window.QUALITY_SCORE_ENGINE_VERSION = ENGINE_VERSION;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
