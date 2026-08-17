/**
 * US EPA benchmark engine — MCL/SMCL/TT-aware comparison index.
 * Owns EPA-specific metadata explanations.
 */
(function registerUsEpaBenchmarkEngine() {
  const L = window.UsEpaBenchmarkLimits;
  const W = window.UsEpaBenchmarkWeights;
  const clamp = typeof scoreClamp === 'function' ? scoreClamp : (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata : () => ({ score: null });

  function gradePh(ph) {
    if (ph >= L.ph.min && ph <= L.ph.max) return 100;
    const dist = ph < L.ph.min ? L.ph.min - ph : ph - L.ph.max;
    return clamp(100 - dist * 40);
  }
  function gradeTds(tds) {
    if (tds <= 300) return 100;
    if (tds <= L.tds.smcl) return clamp(100 - (tds - 300) / 200 * 18);
    return clamp(78 - (tds - L.tds.smcl) / 12);
  }
  /**
   * PD-014 D2 (2026-08-14): project-defined inner residual severity within
   * the locked 0.2/4.0 outer band. Inner plateau (0.2-1.0) sourced from
   * cited utility operator-training "optimal range" guidance (ASDWA/PA DEP),
   * not TH or Q-V3. Decline slope to MRDL is project-defined, no citation —
   * see UNRESOLVED_DECISIONS.md PD-014 §D2. Outer limits unchanged.
   */
  function gradeChlorine(cl) {
    const lo = L.chlorine.projectMin ?? L.chlorine.min;
    const hi = L.chlorine.mrdlMax ?? L.chlorine.max;
    if (cl < lo) return clamp(cl / lo * 60);
    // Anchored at 60 (not 100) to stay continuous with the new inner curve's
    // value at hi (4.0) — the old formula anchored at 100, which would jump
    // upward just past MRDL if left unanchored (monotonicity bug).
    if (cl > hi) return clamp(60 - (cl - hi) * 30);
    if (cl <= 1.0) return 100;
    return clamp(100 - (cl - 1.0) / 3.0 * 40);
  }
  function gradeTurbidity(turb) {
    if (turb <= L.turbidity.ttIdeal) return 100;
    if (turb <= L.turbidity.steepEnd) {
      return clamp(100 - (turb - L.turbidity.ttIdeal) / (L.turbidity.steepEnd - L.turbidity.ttIdeal) * 60);
    }
    return clamp(30 - (turb - L.turbidity.steepEnd) * 5);
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
  function gradeDo(doValue) {
    if (doValue >= L.do.min) return 100;
    return clamp(doValue / L.do.min * 100);
  }

  function classify(grade, pass, criticalish) {
    if (pass) return 'PASS';
    if (criticalish) return grade < 50 ? 'CRITICAL' : 'FAIL';
    if (grade >= 75) return 'WARNING';
    if (grade >= 45) return 'FAIL';
    return 'CRITICAL';
  }

  function verdictFrom(score) {
    if (score >= 80) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Acceptable';
    if (score >= 40) return 'Attention';
    return 'Poor';
  }

  function statusOf(param, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'pending';
    if (param === 'ph') return n >= L.ph.min && n <= L.ph.max ? 'good' : 'attn';
    if (param === 'tds') return n <= L.tds.smcl ? 'good' : 'attn';
    if (param === 'chlorine') {
      const lo = L.chlorine.projectMin ?? L.chlorine.min;
      const hi = L.chlorine.mrdlMax ?? L.chlorine.max;
      return n >= lo && n <= hi ? 'good' : 'attn';
    }
    if (param === 'turbidity') return n <= L.turbidity.ttIdeal ? 'good' : 'attn';
    if (param === 'orp') return n >= L.orp.min && n <= L.orp.max ? 'good' : 'attn';
    if (param === 'do') return n >= L.do.min ? 'good' : 'attn';
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
    if (![ph, tds, turb, orp, cl, do_].every(Number.isFinite)) {
      return incomplete('US EPA', 'usEpa', { readings, engineVersion: 'v3', standardRevision: 'US EPA-inspired Compliance Index (Cl: project floor 0.2 + MRDL 4.0; MCL/SMCL/TT-style)' });
    }
    const params = {
      ph: gradePh(ph), tds: gradeTds(tds), chlorine: gradeChlorine(cl),
      turbidity: gradeTurbidity(turb), orp: gradeOrp(orp), do: gradeDo(do_)
    };
    let num = 0; let den = 0;
    const scoredGrades = [];
    Object.keys(W).forEach(key => { num += params[key] * W[key]; den += W[key]; scoredGrades.push(params[key]); });
    // 2026-08-17 (PO-approved, weakest-link share 0.25 — weaker than
    // Thailand's 0.5): pulls the raw weighted mean 25% toward the single
    // weakest scored parameter so it isn't diluted away by the other five.
    const mean = num / den;
    const weakest = Math.min(...scoredGrades);
    const share = Number(L.weakestLinkShare) || 0;
    const rawScore = Math.round((1 - share) * mean + share * weakest);

    const pass = {
      ph: ph >= L.ph.min && ph <= L.ph.max,
      tds: tds <= L.tds.smcl,
      chlorine: cl >= (L.chlorine.projectMin ?? L.chlorine.min) && cl <= (L.chlorine.mrdlMax ?? L.chlorine.max),
      turbidity: turb <= L.turbidity.ttIdeal,
      orp: orp >= L.orp.min && orp <= L.orp.max,
      do: do_ >= L.do.min,
      // Not Measured must never read as PASS. temp is not part of the US EPA
      // scoring formula (zero weight — see weights.js), so this only affects
      // the classification/metadata bucket, never the score.
      // Use toFin — Number(null)===0 must not become a measured temp.
      temp: Number.isFinite(toFin(readings.temp)) && toFin(readings.temp) <= L.temp.max
    };
    const tempVal = toFin(readings.temp);
    const classifications = {
      ph: classify(params.ph, pass.ph, false),
      tds: classify(params.tds, pass.tds, false),
      chlorine: classify(params.chlorine, pass.chlorine, false),
      turbidity: classify(params.turbidity, pass.turbidity, true),
      orp: classify(params.orp, pass.orp, false),
      do: classify(params.do, pass.do, false),
      temp: !Number.isFinite(tempVal) ? 'NOT_MEASURED' : (pass.temp ? 'PASS' : 'WARNING')
    };

    const reasons = [];
    if (!pass.turbidity) {
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds US EPA treatment-technique style target used here (≤ 1 NTU).' });
    }
    if (!pass.tds) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds US EPA secondary (SMCL) aesthetic guideline (≤ 500 mg/L).' });
    }
    if (!pass.chlorine && cl > (L.chlorine.mrdlMax ?? L.chlorine.max)) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine exceeds US EPA MRDL ceiling (≤ 4.0 mg/L as Cl2; 40 CFR 141.65).' });
    } else if (!pass.chlorine && cl < (L.chlorine.projectMin ?? L.chlorine.min)) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine is below the project residual floor used with EPA comparison (≥ 0.2 mg/L — not an EPA MRDL lower bound).' });
    }
    if (!pass.ph) {
      reasons.push({ parameter: 'ph', severity: classifications.ph.toLowerCase(), message: 'pH is outside US EPA secondary range (6.5–8.5).' });
    }
    if (!pass.do) {
      reasons.push({ parameter: 'do', severity: classifications.do.toLowerCase(), message: 'Dissolved oxygen is below the project EPA-engine DO floor (≥ 6 mg/L — not an EPA primary/secondary standard).' });
    }

    // Score Architecture V2 (2026-08-17, PO-approved additive contract):
    // capture severity protection as an inspectable stage — same cap math as
    // before, now exposed as a discrete sub-object.
    const severity = (typeof computeCountrySeverityProtection === 'function')
      ? computeCountrySeverityProtection(rawScore, classifications)
      : { score: rawScore, applied: false, worstClassification: null, cap: null, preCapScore: rawScore };

    const verdict = verdictFrom(rawScore);
    let summary = 'Meets US EPA comparison expectations for this reading set.';
    if (!reasons.length && verdict === 'Excellent') summary = 'Strong alignment with US EPA MCL/SMCL/TT-style comparison targets.';
    else if (reasons.length) summary = 'One or more US EPA comparison expectations need attention.';

    const statuses = {
      ph: statusOf('ph', ph), tds: statusOf('tds', tds), chlorine: statusOf('chlorine', cl),
      turbidity: statusOf('turbidity', turb), orp: statusOf('orp', orp), do: statusOf('do', do_),
      temp: statusOf('temp', readings.temp)
    };
    const findings = reasons.map(r => ({ label: r.message, val: String(readings[r.parameter] ?? ''), note: '' }));

    
    const topPositiveFactors = [];
    const topNegativeFactors = [];
    if (pass.ph) topPositiveFactors.push('pH is within US EPA secondary range (6.5–8.5)');
    if (pass.tds) topPositiveFactors.push('TDS is at or below US EPA SMCL aesthetic guideline (≤ 500 mg/L)');
    if (pass.chlorine) topPositiveFactors.push('Free chlorine is within EPA Compliance Index window (project floor ≥0.2 + MRDL ≤4.0 mg/L)');
    if (pass.turbidity) topPositiveFactors.push('Turbidity meets US EPA treatment-technique style target (≤ 1 NTU)');
    if (pass.do) topPositiveFactors.push('Dissolved oxygen meets the project EPA-engine DO floor (≥ 6 mg/L — not an EPA primary/secondary standard)');
    if (pass.orp) topPositiveFactors.push('ORP is inside the operational window used for EPA comparison');
    reasons.forEach(r => topNegativeFactors.push(r.message));

    return wrap({
      engine: 'US EPA',
      engineKey: 'usEpa',
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
      engineVersion: 'v3',
      standardRevision: 'US EPA-inspired Compliance Index (Cl: project floor 0.2 + MRDL 4.0; MCL/SMCL/TT-style)'
    });

  }

  window.WaterScoreBenchmarkRegistry.register({
    key: 'usEpa',
    labelKey: 'score.refStandard.usEpa',
    shortKey: 'score.refStandard.short.usEpa',
    display: L.display,
    limits: L,
    weights: W,
    calculate,
    evaluateStatus: statusOf
  });
})();
