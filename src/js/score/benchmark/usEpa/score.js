/**
 * US EPA benchmark engine — MCL/SMCL/TT-aware comparison index.
 * 2026-08-18 (PO-approved): the base score is computed by the shared
 * cross-country formula (computeSharedBenchmarkBase); this engine's own job
 * is only the EPA-specific PASS/FAIL thresholds and severity handling below.
 * Owns EPA-specific metadata explanations.
 */
(function registerUsEpaBenchmarkEngine() {
  const L = window.UsEpaBenchmarkLimits;
  const W = window.UsEpaBenchmarkWeights;
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata : () => ({ score: null });

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
    // 2026-08-18 (PO-approved): chlorine and DO alone no longer block the
    // score — either may genuinely not be measured yet. ph/tds/turbidity/orp
    // remain required.
    if (![ph, tds, turb, orp].every(Number.isFinite)) {
      return incomplete('US EPA', 'usEpa', { readings, engineVersion: 'v3', standardRevision: 'US EPA-inspired Compliance Index (Cl: project floor 0.2 + MRDL 4.0; MCL/SMCL/TT-style)' });
    }
    // 2026-08-18 (PO-approved): one shared grading formula (Quality V3's
    // curves), computed once and reused as every country's base score. US
    // EPA differs from the other engines only in the PASS/FAIL thresholds
    // and severity handling below — never in how a value is graded. See
    // computeSharedBenchmarkBase in computeQualityScoreV2.js.
    const base = computeSharedBenchmarkBase(readings, W);
    const params = base.params;
    const rawScore = base.score;

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
      // Missing chlorine is an absent measurement, not a failed one —
      // NOT_MEASURED (same convention already used for temp below) so
      // severity protection ignores it instead of reading it as
      // CRITICAL/FAIL. The explicit score cap below (not this
      // classification) is what stops it from presenting as a pass.
      chlorine: Number.isFinite(cl) ? classify(params.chlorine, pass.chlorine, false) : 'NOT_MEASURED',
      turbidity: classify(params.turbidity, pass.turbidity, true),
      orp: classify(params.orp, pass.orp, false),
      // Missing DO is an absent measurement, not a failed one — same
      // NOT_MEASURED convention as chlorine/temp (2026-08-18).
      do: Number.isFinite(do_) ? classify(params.do, pass.do, false) : 'NOT_MEASURED',
      temp: !Number.isFinite(tempVal) ? 'NOT_MEASURED' : (pass.temp ? 'PASS' : 'WARNING')
    };

    const reasons = [];
    if (!pass.turbidity) {
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds US EPA treatment-technique style target used here (≤ 1 NTU).' });
    }
    if (!pass.tds) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds US EPA secondary (SMCL) aesthetic guideline (≤ 500 mg/L).' });
    }
    if (!Number.isFinite(cl)) {
      reasons.push({ parameter: 'chlorine', severity: 'warning', message: 'Free chlorine has not been measured yet — this score is provisional and excludes chlorine until it is captured.' });
    } else if (!pass.chlorine && cl > (L.chlorine.mrdlMax ?? L.chlorine.max)) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine exceeds US EPA MRDL ceiling (≤ 4.0 mg/L as Cl2; 40 CFR 141.65).' });
    } else if (!pass.chlorine && cl < (L.chlorine.projectMin ?? L.chlorine.min)) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine is below the project residual floor used with EPA comparison (≥ 0.2 mg/L — not an EPA MRDL lower bound).' });
    }
    if (!pass.ph) {
      reasons.push({ parameter: 'ph', severity: classifications.ph.toLowerCase(), message: 'pH is outside US EPA secondary range (6.5–8.5).' });
    }
    if (!Number.isFinite(do_)) {
      reasons.push({ parameter: 'do', severity: 'warning', message: 'Dissolved oxygen has not been measured yet — this score is provisional and excludes DO until it is captured.' });
    } else if (!pass.do) {
      reasons.push({ parameter: 'do', severity: classifications.do.toLowerCase(), message: 'Dissolved oxygen is below the project EPA-engine DO floor (≥ 6 mg/L — not an EPA primary/secondary standard).' });
    }

    // Score Architecture V2 (2026-08-17, PO-approved additive contract):
    // capture severity protection as an inspectable stage — same cap math as
    // before, now exposed as a discrete sub-object.
    const severity = (typeof computeCountrySeverityProtection === 'function')
      ? computeCountrySeverityProtection(rawScore, classifications)
      : { score: rawScore, applied: false, worstClassification: null, cap: null, preCapScore: rawScore };
    // 2026-08-18 (PO-approved): a score computed without chlorine must never
    // present as a pass/good verdict — cap below the pass-band threshold
    // regardless of how well the other params scored.
    const finalScore = (!Number.isFinite(cl) && Number.isFinite(severity.score))
      ? Math.min(severity.score, 79)
      : severity.score;

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
      score: finalScore,
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
