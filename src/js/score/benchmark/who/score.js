/**
 * WHO benchmark engine — WHO guideline proximity / DWQI-style index.
 * 2026-08-18 (PO-approved): the base score is computed by the shared
 * cross-country formula (computeSharedBenchmarkBase); this engine's own job
 * is only the WHO-specific PASS/FAIL thresholds and severity handling below.
 * Owns WHO-specific metadata explanations (does not call production).
 */
(function registerWhoBenchmarkEngine() {
  const L = window.WhoBenchmarkLimits;
  const W = window.WhoBenchmarkWeights;
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata : () => ({ score: null });

  function classify(grade, inIdeal) {
    if (inIdeal) return 'PASS';
    if (grade >= 80) return 'WARNING';
    if (grade >= 50) return 'FAIL';
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
    if (param === 'tds') return n <= L.tds.displayMax ? 'good' : 'attn';
    if (param === 'chlorine') return n >= L.chlorine.idealMin && n <= L.chlorine.idealMax ? 'good' : 'attn';
    if (param === 'turbidity') return n <= L.turbidity.ideal ? 'good' : 'attn';
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
    const fcl = toFin(readings.chlorine);
    const do_ = toFin(readings.do);
    // 2026-08-18 (PO-approved): chlorine and DO alone no longer block the
    // score — either may genuinely not be measured yet. ph/tds/turbidity/orp
    // remain required.
    if (![ph, tds, turb, orp].every(Number.isFinite)) {
      return incomplete('WHO', 'who', { readings, engineVersion: 'v3', standardRevision: 'WHO-inspired guideline proximity engine (project scoring; not an official WHO index)' });
    }
    // 2026-08-18 (PO-approved): one shared grading formula (Quality V3's
    // curves), computed once and reused as every country's base score. WHO
    // differs from the other engines only in the PASS/FAIL thresholds and
    // severity handling below — never in how a value is graded. See
    // computeSharedBenchmarkBase in computeQualityScoreV2.js.
    const base = computeSharedBenchmarkBase(readings);
    const params = base.params;
    const rawScore = base.score;

    const ideal = {
      ph: ph >= L.ph.min && ph <= L.ph.max,
      tds: tds <= L.tds.displayMax,
      chlorine: fcl >= L.chlorine.idealMin && fcl <= L.chlorine.idealMax,
      turbidity: turb <= L.turbidity.ideal,
      orp: orp >= L.orp.min && orp <= L.orp.max,
      do: do_ >= L.do.min,
      // Not Measured must never read as PASS. temp is not part of the WHO
      // scoring formula (zero weight — see weights.js), so this only affects
      // the classification/metadata bucket, never the score.
      // Use toFin — Number(null)===0 must not become a measured temp.
      temp: Number.isFinite(toFin(readings.temp)) && toFin(readings.temp) <= L.temp.max
    };
    const tempVal = toFin(readings.temp);
    const classifications = {
      ph: classify(params.ph, ideal.ph),
      tds: classify(params.tds, ideal.tds),
      // Missing chlorine is an absent measurement, not a failed one —
      // NOT_MEASURED (same convention already used for temp below) so
      // severity protection ignores it instead of reading it as
      // CRITICAL/FAIL. The explicit score cap below (not this
      // classification) is what stops it from presenting as a pass.
      chlorine: Number.isFinite(fcl) ? classify(params.chlorine, ideal.chlorine) : 'NOT_MEASURED',
      turbidity: classify(params.turbidity, ideal.turbidity),
      orp: classify(params.orp, ideal.orp),
      // Missing DO is an absent measurement, not a failed one — same
      // NOT_MEASURED convention as chlorine/temp (2026-08-18).
      do: Number.isFinite(do_) ? classify(params.do, ideal.do) : 'NOT_MEASURED',
      temp: !Number.isFinite(tempVal) ? 'NOT_MEASURED' : (ideal.temp ? 'PASS' : 'WARNING')
    };

    const reasons = [];
    if (!Number.isFinite(fcl)) {
      reasons.push({ parameter: 'chlorine', severity: 'warning', message: 'Free chlorine has not been measured yet — this score is provisional and excludes chlorine until it is captured.' });
    } else if (!ideal.chlorine && fcl > L.chlorine.idealMax) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine exceeds the WHO residual-guidance band used by this project engine (0.2–0.5 mg/L).' });
    } else if (!ideal.chlorine && fcl < L.chlorine.idealMin) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine is below the WHO residual-guidance band used by this project engine (0.2–0.5 mg/L).' });
    }
    if (!ideal.turbidity) {
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds the WHO-style turbidity target used by this project engine (≤ 1 NTU).' });
    }
    if (!ideal.tds) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds the WHO aesthetic-guideline ceiling used by this project engine (≤ 500 mg/L).' });
    }
    if (!ideal.ph) {
      reasons.push({ parameter: 'ph', severity: classifications.ph.toLowerCase(), message: 'pH is outside the WHO-style comparison band used by this project engine (6.5–8.5).' });
    }
    if (!Number.isFinite(do_)) {
      reasons.push({ parameter: 'do', severity: 'warning', message: 'Dissolved oxygen has not been measured yet — this score is provisional and excludes DO until it is captured.' });
    } else if (!ideal.do) {
      reasons.push({ parameter: 'do', severity: classifications.do.toLowerCase(), message: 'Dissolved oxygen is below the project WHO-engine DO floor (≥ 6 mg/L — not a WHO Ideal / health guideline).' });
    }
    if (!ideal.orp) {
      reasons.push({ parameter: 'orp', severity: classifications.orp.toLowerCase(), message: 'ORP is outside the shared project operational window used for WHO comparison (200–600 mV — not a WHO Ideal).' });
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
    const finalScore = (!Number.isFinite(fcl) && Number.isFinite(severity.score))
      ? Math.min(severity.score, 79)
      : severity.score;

    const verdict = verdictFrom(rawScore);
    let summary = 'Meets this project’s WHO-inspired guideline proximity targets for the scored indicators.';
    if (reasons.length) summary = 'Does not fully meet this project’s WHO-inspired guideline proximity targets for all indicators.';
    if (verdict === 'Excellent' && !reasons.length) summary = 'Aligns closely with this project’s WHO-inspired proximity targets (not an official WHO score).';

    const statuses = {
      ph: statusOf('ph', ph), tds: statusOf('tds', tds), chlorine: statusOf('chlorine', fcl),
      turbidity: statusOf('turbidity', turb), orp: statusOf('orp', orp), do: statusOf('do', do_),
      temp: statusOf('temp', readings.temp)
    };
    const findings = reasons.map(r => ({ label: r.message, val: String(readings[r.parameter] ?? ''), note: '' }));

    
    const topPositiveFactors = [];
    const topNegativeFactors = [];
    if (ideal.ph) topPositiveFactors.push('pH is within the WHO-style comparison band used by this project engine (6.5–8.5)');
    if (ideal.tds) topPositiveFactors.push('TDS is at or below the WHO aesthetic-guideline ceiling used by this project engine (≤ 500 mg/L)');
    if (ideal.turbidity) topPositiveFactors.push('Turbidity meets the WHO-style turbidity target used by this project engine (≤ 1 NTU)');
    if (ideal.orp) topPositiveFactors.push('ORP is inside the shared project operational window (200–600 mV — not a WHO Ideal)');
    if (ideal.do) topPositiveFactors.push('Dissolved oxygen meets the project WHO-engine DO floor (≥ 6 mg/L — not a WHO Ideal)');
    if (ideal.chlorine) topPositiveFactors.push('Free chlorine is inside the WHO residual-guidance band used by this project engine (0.2–0.5 mg/L)');
    reasons.forEach(r => topNegativeFactors.push(r.message));

    return wrap({
      engine: 'WHO',
      engineKey: 'who',
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
      standardRevision: 'WHO-inspired guideline proximity engine (project scoring; not an official WHO index)'
    });

  }

  window.WaterScoreBenchmarkRegistry.register({
    key: 'who',
    labelKey: 'score.refStandard.who',
    shortKey: 'score.refStandard.short.who',
    display: L.display,
    limits: L,
    weights: W,
    calculate,
    evaluateStatus: statusOf
  });
})();
