/**
 * Thailand benchmark engine — local acceptability philosophy.
 * Soft Pass/Fail index. DO and Temp are not scored.
 * Owns Thailand-specific metadata explanations.
 */
(function registerThailandBenchmarkEngine() {
  const L = window.ThailandBenchmarkLimits;
  const W = window.ThailandBenchmarkWeights;
  const clamp = typeof scoreClamp === 'function' ? scoreClamp : (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata
    : () => ({ score: null });

  function lerp(x, x0, x1, y0, y1) {
    if (x1 === x0) return y0;
    const t = (x - x0) / (x1 - x0);
    return y0 + (y1 - y0) * Math.max(0, Math.min(1, t));
  }
  function gradePh(ph) {
    // Outer branches anchored at edgeGrade (not 100) to stay continuous with
    // the inner branch's value at min/max — anchoring at 100 made the grade
    // jump upward just past 6.5/8.5 (monotonicity bug, found in acceptance
    // review of bf3342db). Same decline slope (35/unit), same edgeGrade (70),
    // same min/max — only the vertical anchor moved.
    const edge = L.ph.edgeGrade;
    if (ph < L.ph.min) {
      return clamp(edge - (L.ph.min - ph) * 35);
    }
    if (ph > L.ph.max) {
      return clamp(edge - (ph - L.ph.max) * 35);
    }
    const prefMin = L.ph.preferredMin;
    const prefMax = L.ph.preferredMax;
    if (ph >= prefMin && ph <= prefMax) return 100;
    if (ph < prefMin) return clamp(lerp(ph, L.ph.min, prefMin, edge, 100));
    return clamp(lerp(ph, prefMax, L.ph.max, 100, edge));
  }
  /**
   * Piecewise in-pass TDS: excellent / good / ordinary / remaining pass.
   * passMax / softEnd unchanged. passEdgeGrade keeps PD-015 continuity at 1000.
   */
  function gradeTds(tds) {
    const excellent = L.tds.gradeExcellentMax;
    const passEdge = L.tds.passEdgeGrade;
    if (tds <= excellent) return 100;
    if (tds <= L.tds.goodMax) return clamp(lerp(tds, excellent, L.tds.goodMax, 100, L.tds.goodGrade));
    if (tds <= L.tds.ordinaryMax) return clamp(lerp(tds, L.tds.goodMax, L.tds.ordinaryMax, L.tds.goodGrade, L.tds.ordinaryGrade));
    if (tds <= L.tds.passMax) return clamp(lerp(tds, L.tds.ordinaryMax, L.tds.passMax, L.tds.ordinaryGrade, passEdge));
    if (tds <= L.tds.softEnd) {
      return clamp(passEdge - (tds - L.tds.passMax) / (L.tds.softEnd - L.tds.passMax) * 35);
    }
    return clamp(Math.max(0, passEdge - 35) - (tds - L.tds.softEnd) / 50);
  }
  function gradeChlorine(cl) {
    const excellentMax = L.chlorine.citedSurveillanceResidual.max;
    if (cl >= L.chlorine.min && cl <= excellentMax) return 100;
    if (cl < L.chlorine.min) return clamp(cl / L.chlorine.min * 70);
    if (cl <= L.chlorine.noticeableMax) {
      return clamp(lerp(cl, excellentMax, L.chlorine.noticeableMax, 100, L.chlorine.noticeableGrade));
    }
    if (cl <= L.chlorine.max) {
      return clamp(lerp(cl, L.chlorine.noticeableMax, L.chlorine.max, L.chlorine.noticeableGrade, L.chlorine.passEdgeGrade));
    }
    return clamp(L.chlorine.passEdgeGrade - (cl - L.chlorine.max) * 25);
  }
  function gradeTurbidity(turb) {
    const excellent = L.turbidity.gradeExcellentMax;
    const passEdge = L.turbidity.passEdgeGrade;
    if (turb <= excellent) return 100;
    if (turb <= L.turbidity.ordinaryMax) {
      return clamp(lerp(turb, excellent, L.turbidity.ordinaryMax, 100, L.turbidity.ordinaryGrade));
    }
    if (turb <= L.turbidity.passMax) {
      return clamp(lerp(turb, L.turbidity.ordinaryMax, L.turbidity.passMax, L.turbidity.ordinaryGrade, passEdge));
    }
    if (turb <= L.turbidity.softEnd) {
      return clamp(passEdge - (turb - L.turbidity.passMax) / (L.turbidity.softEnd - L.turbidity.passMax) * 20);
    }
    return clamp(Math.max(0, passEdge - 20) - (turb - L.turbidity.softEnd) * 4);
  }
  /**
   * PD-014 D1 inner 350–450 kept. Ordinary 250–300 / 500–520 now occupies the
   * good/remaining segments instead of a shallow linear ramp across 200–600.
   */
  function gradeOrp(orp) {
    if (orp < L.orp.min) return clamp(orp / L.orp.min * 70);
    if (orp > L.orp.max) return clamp(70 - (orp - L.orp.max) / 10);
    if (orp >= L.orp.excellentMin && orp <= L.orp.excellentMax) return 100;
    if (orp < L.orp.excellentMin) {
      if (orp >= L.orp.goodMin) return clamp(lerp(orp, L.orp.goodMin, L.orp.excellentMin, L.orp.goodGrade, 100));
      return clamp(lerp(orp, L.orp.min, L.orp.goodMin, 70, L.orp.goodGrade));
    }
    if (orp <= L.orp.goodMax) return clamp(lerp(orp, L.orp.excellentMax, L.orp.goodMax, 100, L.orp.goodGrade));
    return clamp(lerp(orp, L.orp.goodMax, L.orp.max, L.orp.goodGrade, 70));
  }

  function classify(grade, inPass) {
    if (inPass && grade >= 95) return 'PASS';
    if (inPass) return 'PASS';
    if (grade >= 70) return 'WARNING';
    if (grade >= 40) return 'FAIL';
    return 'CRITICAL';
  }

  function verdictFrom(score) {
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Good';
    if (score >= 60) return 'Acceptable';
    if (score >= 40) return 'Attention';
    return 'Poor';
  }

  function statusOf(param, value) {
    // PD-003: DO/Temp are excluded from Thailand scoring — never "good"/PASS.
    if (param === 'do' || param === 'temp') return 'pending';
    const toFin = typeof toFiniteReading === 'function'
      ? toFiniteReading
      : (v) => {
        if (v === null || v === undefined || v === '' || v === false) return NaN;
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
      };
    const n = toFin(value);
    if (!Number.isFinite(n)) return 'pending';
    if (param === 'ph') return n >= L.ph.min && n <= L.ph.max ? 'good' : 'attn';
    if (param === 'tds') return n <= L.tds.passMax ? 'good' : 'attn';
    if (param === 'chlorine') return n >= L.chlorine.min && n <= L.chlorine.max ? 'good' : 'attn';
    if (param === 'turbidity') return n <= L.turbidity.passMax ? 'good' : 'attn';
    if (param === 'orp') return n >= L.orp.min && n <= L.orp.max ? 'good' : 'attn';
    return 'good';
  }

  function calculate(readings) {
    const toFin = typeof toFiniteReading === 'function' ? toFiniteReading : (v) => { if (v === null || v === undefined || v === '' || v === false) return NaN; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
    const ph = toFin(readings.ph);
    const tds = toFin(readings.tds);
    const turb = toFin(readings.turbidity);
    const orp = toFin(readings.orp);
    const cl = toFin(readings.chlorine);
    // 2026-08-18 (PO-approved): chlorine alone no longer blocks the score —
    // it may genuinely not be measured yet. The other four params are still
    // required; only chlorine's absence is tolerated here.
    if (![ph, tds, turb, orp].every(Number.isFinite)) {
      return incomplete('Thailand', 'thailand', { readings, engineVersion: 'v2', standardRevision: 'Thailand Compliance Index (project bands; Cl 0.2–2.0 project-defined — PD-008)' });
    }
    const params = {
      ph: gradePh(ph),
      tds: gradeTds(tds),
      // Grade chlorine only when present, so the weighted-mean/weakest-link
      // loop below (which already skips non-finite params) excludes it
      // naturally instead of scoring a phantom reading.
      chlorine: Number.isFinite(cl) ? gradeChlorine(cl) : undefined,
      turbidity: gradeTurbidity(turb),
      orp: gradeOrp(orp)
    };
    let num = 0;
    let den = 0;
    const scoredGrades = [];
    Object.keys(W).forEach(key => {
      if (!Number.isFinite(params[key])) return;
      num += params[key] * W[key];
      den += W[key];
      scoredGrades.push(params[key]);
    });
    let rawScore = null;
    if (den > 0 && scoredGrades.length) {
      const mean = num / den;
      const weakest = Math.min(...scoredGrades);
      const share = Number(L.weakestLinkShare) || 0;
      rawScore = Math.round((1 - share) * mean + share * weakest);
    }

    const pass = {
      ph: ph >= L.ph.min && ph <= L.ph.max,
      tds: tds <= L.tds.passMax,
      chlorine: cl >= L.chlorine.min && cl <= L.chlorine.max,
      turbidity: turb <= L.turbidity.passMax,
      orp: orp >= L.orp.min && orp <= L.orp.max
    };
    const classifications = {
      ph: classify(params.ph, pass.ph),
      tds: classify(params.tds, pass.tds),
      // Missing chlorine is an absent measurement, not a failed one —
      // NOT_MEASURED (same convention already used for temp elsewhere) so
      // severity protection ignores it instead of reading it as
      // CRITICAL/FAIL. The explicit score cap below (not this
      // classification) is what stops it from presenting as a pass.
      chlorine: Number.isFinite(cl) ? classify(params.chlorine, pass.chlorine) : 'NOT_MEASURED',
      turbidity: classify(params.turbidity, pass.turbidity),
      orp: classify(params.orp, pass.orp),
      // PD-003: DO/Temp are excluded by project design. They must never classify
      // as PASS/GOOD merely because a value exists (or because Number(null)===0).
      // NOT_EVALUATED = engine does not score this parameter.
      do: 'NOT_EVALUATED',
      temp: 'NOT_EVALUATED'
    };

    // Thailand severity-protection coverage (product decision, 2026-08-17):
    // reuses the exact shared mechanism already deployed for Japan/WHO/US EPA/EU
    // (applyCountrySeverityProtection / worstBenchmarkClassification) — no new
    // mechanism, no new cap values, no change to Thailand's own grade curves,
    // weights, limits, classification thresholds, or the PD-015 weakest-link
    // blend above. This only caps the already-computed composite when
    // Thailand's own classification (unchanged) says WARNING/FAIL/CRITICAL.
    // Score Architecture V2 (2026-08-17, PO-approved additive contract):
    // now captured as an inspectable stage — same cap math, exposed as a
    // discrete sub-object.
    const severity = (typeof computeCountrySeverityProtection === 'function')
      ? computeCountrySeverityProtection(rawScore, classifications)
      : { score: rawScore, applied: false, worstClassification: null, cap: null, preCapScore: rawScore };
    // 2026-08-18 (PO-approved): a score computed without chlorine must never
    // present as a pass/good verdict — cap below the pass-band threshold
    // regardless of how well the other params scored.
    const score = (!Number.isFinite(cl) && Number.isFinite(severity.score))
      ? Math.min(severity.score, 79)
      : severity.score;

    const reasons = [];
    if (!Number.isFinite(cl)) {
      reasons.push({ parameter: 'chlorine', severity: 'warning', message: 'Free chlorine has not been measured yet — this score is provisional and excludes chlorine until it is captured.' });
    } else if (!pass.chlorine && cl > L.chlorine.max) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine is above the Thailand project compliance band (0.2–2.0 mg/L; not a verified DoH Ideal — PD-008).' });
    } else if (!pass.chlorine && cl < L.chlorine.min) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine is below the Thailand project compliance band (≥ 0.2 mg/L) — disinfection residual may be insufficient.' });
    }
    if (!pass.turbidity) {
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds Thailand local acceptability limit (≤ 5 NTU).' });
    }
    if (!pass.tds) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds Thailand reference ceiling (≤ 1000 mg/L).' });
    }
    if (!pass.ph) {
      reasons.push({ parameter: 'ph', severity: classifications.ph.toLowerCase(), message: 'pH is outside Thailand recommended band (6.5–8.5).' });
    }
    if (!pass.orp) {
      reasons.push({ parameter: 'orp', severity: classifications.orp.toLowerCase(), message: 'ORP is outside the operational window used for Thailand comparison (200–600 mV).' });
    }

    const verdict = verdictFrom(score);
    let summary = 'Meets Thailand local drinking-water acceptability for scored indicators.';
    if (verdict === 'Excellent') summary = 'Strong match to Thailand local drinking-water acceptability.';
    else if (reasons.length) summary = 'Some indicators need attention against Thailand local guidance.';
    else if (verdict === 'Poor' || verdict === 'Attention') summary = 'Below Thailand local acceptability for one or more scored indicators.';

    const statuses = {
      ph: statusOf('ph', ph),
      tds: statusOf('tds', tds),
      chlorine: statusOf('chlorine', cl),
      turbidity: statusOf('turbidity', turb),
      orp: statusOf('orp', orp),
      do: statusOf('do', readings.do),
      temp: statusOf('temp', readings.temp)
    };

    const findings = reasons.map(r => ({
      label: r.message,
      val: String(readings[r.parameter] ?? ''),
      note: ''
    }));

    
    const topPositiveFactors = [];
    const topNegativeFactors = [];
    if (pass.ph) topPositiveFactors.push('pH is within Thailand recommended range (6.5–8.5)');
    if (pass.tds) topPositiveFactors.push('TDS is within Thailand local acceptability (≤ 1000 mg/L)');
    if (pass.chlorine) topPositiveFactors.push('Free chlorine residual is within the Thailand project compliance band (0.2–2.0 mg/L)');
    if (pass.turbidity) topPositiveFactors.push('Turbidity meets Thailand local limit (≤ 5 NTU)');
    if (pass.orp) topPositiveFactors.push('ORP is inside the operational window used for Thailand comparison');
    topPositiveFactors.push('Dissolved oxygen is not scored under Thailand local comparison');
    reasons.forEach(r => topNegativeFactors.push(r.message));

    return wrap({
      engine: 'Thailand',
      engineKey: 'thailand',
      score,
      rawAggregate: rawScore,
      severityProtection: severity,
      verdict,
      summary,
      classifications,
      reasons,
      topPositiveFactors,
      topNegativeFactors,
      params,
      statuses,
      findings,
      readings,
      engineVersion: 'v2',
      standardRevision: 'Thailand Compliance Index (project bands; Cl 0.2–2.0 project-defined — PD-008)'
    });

  }

  window.WaterScoreBenchmarkRegistry.register({
    key: 'thailand',
    labelKey: 'score.refStandard.thailand',
    shortKey: 'score.refStandard.short.thailand',
    display: L.display,
    limits: L,
    weights: W,
    calculate,
    evaluateStatus: statusOf
  });
})();
