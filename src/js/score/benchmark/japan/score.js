/**
 * Japan benchmark engine — national criteria with turbidity/chlorine emphasis.
 * Owns Japan-specific metadata explanations.
 * PD-012 B (2026-08-13): DO excluded from Japan Compliance Index (NOT_EVALUATED).
 * JP-WEIGHTS values unchanged (PD-013 A); do:0.12 retained in weights.js but skipped in num/den.
 */
(function registerJapanBenchmarkEngine() {
  const L = window.JapanBenchmarkLimits;
  const W = window.JapanBenchmarkWeights;
  const clamp = typeof scoreClamp === 'function' ? scoreClamp : (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata : () => ({ score: null });

  /** Scored Compliance Index params only — DO excluded (PD-012 B). */
  const SCORED_KEYS = Object.freeze(['ph', 'tds', 'chlorine', 'turbidity', 'orp']);

  function lerp(x, x0, x1, y0, y1) {
    if (x1 === x0) return y0;
    const t = (x - x0) / (x1 - x0);
    return y0 + (y1 - y0) * Math.max(0, Math.min(1, t));
  }
  /**
   * 2026-08-17 (PO-approved, evidence: MHLW-style municipal 水質管理目標設定項目
   * tables cite the comfortable-water pH target at ~7.5). Legal band
   * (5.8-8.6) unchanged; adds an inner ideal window (7.3-7.7) with a steep
   * ramp to the project-chosen edge grade (40) by 6.7/8.3, then flat to the
   * legal edge — mirrors the turbidity precedent (PASS != high grade).
   */
  function gradePh(ph) {
    const P = L.ph;
    if (ph >= P.idealMin && ph <= P.idealMax) return 100;
    if (ph < P.idealMin) {
      if (ph >= P.steepEndLow) return clamp(lerp(ph, P.steepEndLow, P.idealMin, P.edgeGrade, 100));
      return clamp(P.edgeGrade - (P.steepEndLow - ph) * 10);
    }
    if (ph <= P.steepEndHigh) return clamp(lerp(ph, P.idealMax, P.steepEndHigh, 100, P.edgeGrade));
    return clamp(P.edgeGrade - (ph - P.steepEndHigh) * 10);
  }
  /**
   * 2026-08-17 (PO-approved, evidence: same municipal tables cite the
   * comfortable-water TDS/evaporation-residue target at 30-200 mg/L). Legal
   * ceiling (500) unchanged; adds a steep ramp from the cited 200 mg/L
   * upper bound to the project-chosen edge grade (40) by 350, then flat to
   * the legal ceiling.
   */
  function gradeTds(tds) {
    const T = L.tds;
    if (tds <= T.idealMax) return 100;
    if (tds <= T.steepEnd) return clamp(lerp(tds, T.idealMax, T.steepEnd, 100, T.edgeGrade));
    if (tds <= T.displayMax) return T.edgeGrade;
    return clamp(T.edgeGrade - (tds - T.displayMax) / 15);
  }
  /**
   * 2026-08-17 (PO-approved): no official MHLW comfortable-water target
   * exists for residual chlorine — this ideal window (0.2-0.5 mg/L) and its
   * edge grade (40) at the legal boundary (0.1/1.0) are project-defined,
   * explicitly approved by PO, reusing the Thailand chlorine ideal band as
   * a project convention (not a Japan-specific citation).
   */
  function gradeChlorine(cl) {
    const C = L.chlorine;
    if (cl >= C.idealMin && cl <= C.idealMax) return 100;
    if (cl < C.idealMin) return clamp(lerp(cl, C.min, C.idealMin, C.edgeGrade, 100));
    return clamp(lerp(cl, C.idealMax, C.max, 100, C.edgeGrade));
  }
  /**
   * 2026-08-17 (PO-approved, evidence: MHLW 快適水質項目 aesthetic target =
   * half the legal standard, i.e. 1 NTU vs the 2 NTU legal limit). The 2 NTU
   * compliance/PASS boundary (L.turbidity.ideal) is unchanged; this adds an
   * inner grade-100 threshold at the cited 1 NTU target and a steep ramp
   * down to the PASS-edge grade at 2 NTU, mirroring the Thailand chlorine
   * noticeable-band precedent (PASS does not imply a high grade).
   */
  function gradeTurbidity(turb) {
    const excellent = L.turbidity.excellentMax;
    const idealEdge = L.turbidity.ideal;
    const edgeGrade = L.turbidity.passEdgeGrade;
    if (turb <= excellent) return 100;
    if (turb <= idealEdge) {
      return clamp(100 - (turb - excellent) / (idealEdge - excellent) * (100 - edgeGrade));
    }
    if (turb <= L.turbidity.steepEnd) {
      return clamp(edgeGrade + (turb - idealEdge) / (L.turbidity.steepEnd - idealEdge) * (40 - edgeGrade));
    }
    return clamp(40 - (turb - L.turbidity.steepEnd) * 6);
  }
  /**
   * PD-014 D1 (2026-08-14): project-defined inner severity within the locked
   * 200/600 outer band. No cited standard — see UNRESOLVED_DECISIONS.md
   * PD-014 §D1. Outer limits (200/600) unchanged.
   */
  function gradeOrp(orp) {
    // Outer branches anchored at 70 (not 100) to stay continuous with the
    // new inner ramp's edge value — the old formulas anchored at 100, which
    // would jump upward just past 200/600 if left unanchored (monotonicity bug).
    if (orp < L.orp.min) return clamp(orp / L.orp.min * 70);
    if (orp > L.orp.max) return clamp(70 - (orp - L.orp.max) / 10);
    if (orp >= 350 && orp <= 450) return 100;
    if (orp < 350) return clamp(70 + (orp - 200) / 150 * 30);
    return clamp(100 - (orp - 450) / 150 * 30);
  }

  function classify(grade, pass) {
    if (pass) return 'PASS';
    if (grade >= 75) return 'WARNING';
    if (grade >= 45) return 'FAIL';
    return 'CRITICAL';
  }

  function verdictFrom(score) {
    if (score >= 85) return 'Excellent';
    if (score >= 72) return 'Good';
    if (score >= 60) return 'Acceptable';
    if (score >= 40) return 'Attention';
    return 'Poor';
  }

  function statusOf(param, value) {
    // PD-012 B: DO is excluded from Japan Compliance Index — never good/attn from ≥5.
    if (param === 'do') return 'pending';
    const n = Number(value);
    if (!Number.isFinite(n)) return 'pending';
    if (param === 'ph') return n >= L.ph.min && n <= L.ph.max ? 'good' : 'attn';
    if (param === 'tds') return n <= L.tds.displayMax ? 'good' : 'attn';
    if (param === 'chlorine') return n >= L.chlorine.min && n <= L.chlorine.max ? 'good' : 'attn';
    if (param === 'turbidity') return n <= L.turbidity.ideal ? 'good' : 'attn';
    if (param === 'orp') return n >= L.orp.min && n <= L.orp.max ? 'good' : 'attn';
    if (param === 'temp') return n <= L.temp.max ? 'good' : 'attn';
    return 'good';
  }

  function calculate(readings) {
    const toFin = typeof toFiniteReading === 'function' ? toFiniteReading : (v) => { if (v === null || v === undefined || v === '' || v === false) return NaN; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
    const ph = toFin(readings.ph);
    const tds = toFin(readings.tds);
    const turb = toFin(readings.turbidity);
    const orp = toFin(readings.orp);
    const cl = toFin(readings.chlorine);
    const do_ = toFin(readings.do);
    // PD-012 B: five scored params only — DO not required for a complete Japan score.
    if (![ph, tds, turb, orp, cl].every(Number.isFinite)) {
      return incomplete('Japan', 'japan', {
        readings,
        engineVersion: 'v3',
        standardRevision: 'Japan-style Compliance Index (project engine; DO NOT_EVALUATED — PD-012 B; JP-WEIGHTS values unchanged — PD-013 A)'
      });
    }
    const params = {
      ph: gradePh(ph),
      tds: gradeTds(tds),
      chlorine: gradeChlorine(cl),
      turbidity: gradeTurbidity(turb),
      orp: gradeOrp(orp)
      // do intentionally omitted from graded params (PD-012 B)
    };
    let num = 0;
    let den = 0;
    // PD-012 B + PD-013 A (I2): keep W.do = 0.12 in weights.js; exclude from both num and den.
    const scoredGrades = [];
    Object.keys(W).forEach((key) => {
      if (key === 'do') return;
      if (!SCORED_KEYS.includes(key)) return;
      if (!Number.isFinite(params[key])) return;
      num += params[key] * W[key];
      den += W[key];
      scoredGrades.push(params[key]);
    });
    // 2026-08-17 (PO-approved, weakest-link share 0.25 — weaker than
    // Thailand's 0.5): pulls the raw weighted mean 25% toward the single
    // weakest scored parameter so it isn't diluted away by the other four.
    let rawScore = null;
    if (den > 0 && scoredGrades.length) {
      const mean = num / den;
      const weakest = Math.min(...scoredGrades);
      const share = Number(L.weakestLinkShare) || 0;
      rawScore = Math.round((1 - share) * mean + share * weakest);
    }

    const pass = {
      ph: ph >= L.ph.min && ph <= L.ph.max,
      tds: tds <= L.tds.displayMax,
      chlorine: cl >= L.chlorine.min && cl <= L.chlorine.max,
      turbidity: turb <= L.turbidity.ideal,
      orp: orp >= L.orp.min && orp <= L.orp.max
      // do excluded — never pass/fail Compliance Index via ≥5
    };
    const tempVal = toFin(readings.temp);
    const classifications = {
      ph: classify(params.ph, pass.ph),
      tds: classify(params.tds, pass.tds),
      chlorine: classify(params.chlorine, pass.chlorine),
      turbidity: classify(params.turbidity, pass.turbidity),
      orp: classify(params.orp, pass.orp),
      // PD-012 B: DO excluded from Japan Compliance Index.
      do: 'NOT_EVALUATED',
      // Not Measured must never read as PASS. temp is not part of the Japan
      // scoring formula (zero weight — see weights.js), so this only affects
      // the classification/metadata bucket, never the score.
      temp: !Number.isFinite(tempVal) ? 'NOT_MEASURED' : (
        (Number.isFinite(tempVal) && tempVal <= L.temp.max) ? 'PASS' : 'WARNING'
      )
    };

    // Score Architecture V2 (2026-08-17, PO-approved additive contract):
    // capture severity protection as an inspectable stage. Same cap math as
    // before (applyCountrySeverityProtection, called internally) — this only
    // exposes whether it fired and what the pre-cap score was.
    const severity = (typeof computeCountrySeverityProtection === 'function')
      ? computeCountrySeverityProtection(rawScore, classifications)
      : { score: rawScore, applied: false, worstClassification: null, cap: null, preCapScore: rawScore };

    const reasons = [];
    if (!pass.turbidity) {
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds Japanese drinking-water recommendation (≤ 2 NTU).' });
    }
    if (!pass.chlorine && cl > L.chlorine.max) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine exceeds Japan residual recommendation (≤ 1 mg/L).' });
    } else if (!pass.chlorine && cl < L.chlorine.min) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine is below Japan residual recommendation (≥ 0.1 mg/L).' });
    }
    if (!pass.ph) {
      reasons.push({ parameter: 'ph', severity: classifications.ph.toLowerCase(), message: 'pH is outside Japan national drinking-water range (5.8–8.6).' });
    }
    if (!pass.tds) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds Japan comparison ceiling (≤ 500 mg/L).' });
    }

    const verdict = verdictFrom(rawScore);
    let summary = 'Meets this project’s Japan-style Compliance Index criteria for this comparison (DO not evaluated — PD-012 B).';
    if (!reasons.length && verdict === 'Excellent') {
      summary = 'Strong alignment with this project’s Japan-style Compliance Index criteria (DO not evaluated — PD-012 B).';
    } else if (reasons.length) {
      summary = 'One or more Japan-style comparison criteria used by this project engine need attention (DO not evaluated — PD-012 B).';
    }

    const statuses = {
      ph: statusOf('ph', ph),
      tds: statusOf('tds', tds),
      chlorine: statusOf('chlorine', cl),
      turbidity: statusOf('turbidity', turb),
      orp: statusOf('orp', orp),
      do: statusOf('do', do_),
      temp: statusOf('temp', readings.temp)
    };
    const findings = reasons.map(r => ({ label: r.message, val: String(readings[r.parameter] ?? ''), note: '' }));

    const topPositiveFactors = [];
    const topNegativeFactors = [];
    if (pass.ph) topPositiveFactors.push('pH is within Japan national range (5.8–8.6)');
    if (pass.tds) topPositiveFactors.push('TDS is within Japan comparison ceiling (≤ 500 mg/L)');
    if (pass.chlorine) topPositiveFactors.push('Free chlorine residual meets Japan recommendation (0.1–1 mg/L)');
    if (pass.turbidity) topPositiveFactors.push('Turbidity meets Japanese drinking-water recommendation (≤ 2 NTU)');
    if (pass.orp) topPositiveFactors.push('ORP is inside the operational window used for Japan comparison');
    reasons.forEach(r => topNegativeFactors.push(r.message));

    return wrap({
      engine: 'Japan',
      engineKey: 'japan',
      // Country severity protection (product decision, 2026-08-14): FAIL/CRITICAL/
      // WARNING classifications cap the composite. See src/js/score/util/
      // benchmarkMetadata.js for the shared, engine-agnostic implementation.
      // Does not affect grades, weights, or aggregation above.
      score: severity.score,
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
      // v2 (2026-08-17, Score Architecture V2): marks the first version-tracked
      // release. Versions before this point were never bumped despite real
      // curve changes (turbidity commit 72512555, pH/TDS/chlorine commit
      // e277362f both shipped as 'v1.0') — v1 does not correspond to any
      // single historical baseline, so this is a fresh starting point, not a
      // precise reconstruction of prior history.
      engineVersion: 'v3',
      standardRevision: 'Japan-style Compliance Index (project engine; DO NOT_EVALUATED — PD-012 B; JP-WEIGHTS values unchanged — PD-013 A)'
    });

  }

  window.WaterScoreBenchmarkRegistry.register({
    key: 'japan',
    labelKey: 'score.refStandard.japan',
    shortKey: 'score.refStandard.short.japan',
    display: L.display,
    limits: L,
    weights: W,
    calculate,
    evaluateStatus: statusOf
  });
})();
