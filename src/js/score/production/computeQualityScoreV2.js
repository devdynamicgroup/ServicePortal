/**
 * Production Quality Score V3 — Near-Ideal proximity (recalibrated).
 *
 * Product decisions:
 *   100 = genuinely Near-Ideal / Exceptional Quality
 *   PASS ≠ 100
 *   Quality ≠ country Benchmark
 *   Country differences live in Benchmark engines, not in this Quality model
 *
 * Architecture:
 *   Measurements → Compliance (PASS/WARNING/FAIL)
 *               → Quality Score 0–100 (this module)
 *               → Benchmark Comparison (Thailand / Japan / WHO / EU / US EPA)
 *
 * Weights: UNCHANGED equal average of 6 scored parameters.
 * Temp / EC / DO% / Total Chlorine: NOT SCORED.
 *
 * V3 vs V2 calibration (evidence-based narrowing — not arbitrary score-=N):
 * - Near-Ideal zones narrowed so "normal clean drinking water" does not land 95–100.
 * - Former Prod/WHO 100 plateaus remain COMPLIANCE only.
 * - pH center 7.2 = midpoint of common 6.5–8.5 acceptability band.
 * - TDS Near-Ideal ≤80 aligns under Japan complementary residue preference (30–200)
 *   and well below EPA SMCL 500 / former Prod ≤300 Quality plateau.
 * - Turbidity Near-Ideal ≤0.10 NTU: WHO Guidelines for Drinking-water Quality
 *   states turbidity should ideally be below 0.1 NTU for effective disinfection
 *   (changed from ≤0.08; see docs/quality-v3/REALITY_FIRST_IMPLEMENTATION_REPORT.md).
 * - Free Cl: flat 100 across WHO's cited floor-to-target band (0.2-0.5 mg/L),
 *   continuous ramp below 0.2. Replaces a prior two-branch curve whose
 *   unchecked overlap produced an undocumented +18pt cliff at 0.08 mg/L — see
 *   docs/quality-v3/EVIDENCE_BASED_SCORING_AUDIT.md §6. The >0.5 mg/L shape is
 *   an INTERIM placeholder (reused pre-existing 46-at-1.0/28-at-2.0/floor-8
 *   anchors, not evidence-derived for this range) pending a product decision
 *   on what Quality V3 measures — see docs/quality-v3/UNRESOLVED_DECISIONS.md §1
 *   and the full rationale in gradeChlorine() below. Do not read >0.5 mg/L as approved.
 * - ORP center 400 = midpoint of former operational 200–600 (no external Ideal); NI |Δ|≤25.
 * - DO Near-Ideal ≥8.0; ≥6.0 is Compliance floor (~68), not exceptional.
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
    const d = Math.abs(ph - 7.2);
    if (d <= 0.15) return 100;
    if (d <= 0.4) return lerp(d, 0.15, 100, 0.4, 90);
    if (d <= 0.8) return lerp(d, 0.4, 90, 0.8, 78);
    if (d <= 1.3) return lerp(d, 0.8, 78, 1.3, 66);
    if (d <= 1.8) return lerp(d, 1.3, 66, 1.8, 48);
    return clamp(48 - (d - 1.8) * 22, 8, 48);
  }

  function gradeTds(tds) {
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
    // Flat 100 across WHO's cited floor-to-target band (0.2-0.5 mg/L: 0.2 =
    // minimum at point of delivery, 0.5 = target after contact time for
    // effective disinfection) and a continuous ramp below 0.2 toward the
    // under-disinfection floor. This removes the prior two-branch collision
    // (a distance-from-0.3 branch plus a separate raw-value branch below 0.1)
    // that produced an undocumented +18pt cliff at 0.08 mg/L — see
    // docs/quality-v3/EVIDENCE_BASED_SCORING_AUDIT.md §6. NEITHER of these two
    // pieces is in dispute.
    //
    // INTERIM, NOT FINAL: the shape above 0.5 mg/L is unresolved. WHO's 0.5-1.0
    // mg/L range is an outbreak-context allowance and its 5.0 mg/L figure is a
    // health-based (safety) ceiling, not a quality target — using either as a
    // "quality curve anchor" requires first deciding what Quality V3 is meant
    // to measure (open since docs/quality-v3/UNRESOLVED_DECISIONS.md §1; see
    // the chlorine-specific decision table in this thread's history). Pending
    // that decision, this segment is re-anchored to the same 46-at-1.0 /
    // 28-at-2.0 / floor-8 values already shipped in production before any
    // change in this review series (docs/quality-v3/CANDIDATE_SCORING_TABLE.md
    // predecessor curve) — reused rather than re-derived, and continuous with
    // the now-uncontested flat band, but explicitly NOT an evidence-backed
    // choice for this range. Do not read this segment as approved.
    if (fcl >= 0.2 && fcl <= 0.5) return 100;
    if (fcl < 0.2) return clamp(lerp(fcl, 0, 5, 0.2, 100), 2, 100);
    if (fcl <= 1.0) return lerp(fcl, 0.5, 100, 1.0, 46);
    if (fcl <= 2.0) return lerp(fcl, 1.0, 46, 2.0, 28);
    return clamp(28 - (fcl - 2) * 8, 8, 28);
  }

  function gradeOrp(orp) {
    const d = Math.abs(orp - 400);
    if (d <= 25) return 100;
    if (d <= 70) return lerp(d, 25, 100, 70, 86);
    if (d <= 130) return lerp(d, 70, 86, 130, 70);
    if (d <= 200) return lerp(d, 130, 70, 200, 58);
    if (orp < 200) return clamp((orp / 200) * 58, 8, 58);
    return clamp(58 - (orp - 600) / 8, 8, 58);
  }

  function gradeDo(doValue) {
    if (doValue >= 8.0) return 100;
    if (doValue >= 7.2) return lerp(doValue, 7.2, 90, 8.0, 100);
    if (doValue >= 6.5) return lerp(doValue, 6.5, 78, 7.2, 90);
    if (doValue >= 6.0) return lerp(doValue, 6.0, 68, 6.5, 78);
    if (doValue >= 5.0) return lerp(doValue, 5.0, 52, 6.0, 68);
    if (doValue >= 3.0) return lerp(doValue, 3.0, 28, 5.0, 52);
    return clamp((doValue / 3) * 28, 5, 28);
  }

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
  global.QUALITY_SCORE_ENGINE_VERSION = ENGINE_VERSION;

  if (typeof window !== 'undefined') {
    window.computeQualityScoreDetail = computeQualityScoreDetail;
    window.computeQualityScoreV2 = computeQualityScoreDetail;
    window.computeQualityScoreV3 = computeQualityScoreDetail;
    window.computeScoreFromReadings = computeScoreFromReadings;
    window.QUALITY_SCORE_ENGINE_VERSION = ENGINE_VERSION;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
