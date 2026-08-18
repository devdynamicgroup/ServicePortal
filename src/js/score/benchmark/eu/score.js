/**
 * EU benchmark engine — parametric / indicator comparison philosophy.
 * 2026-08-18 (PO-approved): the base score is computed by the shared
 * cross-country formula (computeSharedBenchmarkBase); this engine's own job
 * is only the EU-specific PASS/FAIL thresholds, severity handling, and its
 * own PD-002 chlorine gate below.
 * Free-chlorine residual band is PROJECT-DEFINED (PD-008) — not Directive 2020/2184.
 * Critical chlorine outside project band triggers hard composite cap (PD-002 gate 65).
 * Owns EU-specific metadata explanations.
 */
(function registerEuBenchmarkEngine() {
  const L = window.EuBenchmarkLimits;
  const W = window.EuBenchmarkWeights;
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata : () => ({ score: null });

  function verdictFrom(score, chlorineFail) {
    if (chlorineFail && score <= L.gateCapOnChlorineFail) {
      if (score >= 60) return 'Attention';
      if (score >= 40) return 'Attention';
      return 'Poor';
    }
    if (score >= 85) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 55) return 'Acceptable';
    if (score >= 40) return 'Attention';
    return 'Poor';
  }

  function statusOf(param, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'pending';
    if (param === 'ph') return n >= L.ph.min && n <= L.ph.max ? 'good' : 'attn';
    if (param === 'tds') return n <= L.tds.displayMax ? 'good' : 'attn';
    if (param === 'chlorine') return n >= L.chlorine.min && n <= L.chlorine.max ? 'good' : 'attn';
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
    const cl = toFin(readings.chlorine);
    const do_ = toFin(readings.do);
    // 2026-08-18 (PO-approved): chlorine and DO alone no longer block the
    // score — either may genuinely not be measured yet. ph/tds/turbidity/orp
    // remain required.
    if (![ph, tds, turb, orp].every(Number.isFinite)) {
      return incomplete('EU', 'eu', { readings, engineVersion: 'v3', standardRevision: 'EU-engine project benchmark (Directive-inspired; free-Cl residual project-defined)' });
    }
    // 2026-08-18 (PO-approved): one shared grading formula (Quality V3's
    // curves), computed once and reused as every country's base score. EU
    // differs from the other engines only in the PASS/FAIL thresholds,
    // severity handling, and its own PD-002 chlorine gate below — never in
    // how a value is graded. See computeSharedBenchmarkBase in
    // computeQualityScoreV2.js.
    const base = computeSharedBenchmarkBase(readings);
    const params = base.params;
    const rawScore = base.score;
    const chlorineFail = cl < L.chlorine.min || cl > L.chlorine.max;

    const classifications = {
      ph: (ph >= L.ph.min && ph <= L.ph.max) ? 'PASS' : (params.ph >= 70 ? 'WARNING' : 'FAIL'),
      tds: tds <= L.tds.displayMax ? 'PASS' : (params.tds >= 70 ? 'WARNING' : 'FAIL'),
      // Missing chlorine is an absent measurement, not a failed one —
      // NOT_MEASURED (same convention already used for temp below), so it
      // never triggers the PD-002 gate below (that's only for a *measured*
      // out-of-band reading). The explicit score cap further down is what
      // stops it from presenting as a pass.
      chlorine: !Number.isFinite(cl) ? 'NOT_MEASURED' : (chlorineFail ? 'CRITICAL' : 'PASS'),
      turbidity: turb <= L.turbidity.ideal ? 'PASS' : (turb <= L.turbidity.hardFail ? 'FAIL' : 'CRITICAL'),
      orp: (orp >= L.orp.min && orp <= L.orp.max) ? 'PASS' : 'WARNING',
      // Missing DO is an absent measurement, not a failed one — same
      // NOT_MEASURED convention as chlorine/temp (2026-08-18).
      do: !Number.isFinite(do_) ? 'NOT_MEASURED' : (do_ >= L.do.min ? 'PASS' : 'FAIL'),
      // Not Measured must never read as PASS. temp is not part of the EU
      // scoring formula (zero weight — see weights.js), so this only affects
      // the classification/metadata bucket, never the score.
      // Use toFin — Number(null)===0 must not become a measured temp.
      temp: !Number.isFinite(toFin(readings.temp))
        ? 'NOT_MEASURED'
        : (toFin(readings.temp) <= L.temp.max ? 'PASS' : 'WARNING')
    };

    // EU chlorine-specific hard gate (PD-002, unchanged) — dominant for chlorine failures.
    // Score Architecture V2 (2026-08-17, PO-approved additive contract):
    // captured as an inspectable countryGate stage — same math as before.
    const gateScore = chlorineFail ? Math.min(rawScore, L.gateCapOnChlorineFail) : rawScore;
    const countryGate = {
      applied: Boolean(chlorineFail) && gateScore < rawScore,
      type: 'EU-PD-002-chlorine-gate',
      cap: L.gateCapOnChlorineFail,
      preGateScore: rawScore
    };

    // Non-chlorine severity-protection coverage (product decision, 2026-08-14):
    // reuses the exact shared mechanism already deployed for Japan/WHO/US EPA
    // (applyCountrySeverityProtection / worstBenchmarkClassification) — no new
    // mechanism, no new cap values. Chlorine is explicitly excluded from this
    // call (forced to 'PASS' in a local copy) so a chlorine-CRITICAL reading
    // is governed only by the dedicated 65 gate above and can never be pulled
    // down to the generic CRITICAL=60 — the existing PD-002 outcome (65) stays
    // dominant whenever chlorine itself is the failing parameter. Now also
    // captured as an inspectable severityProtection stage (same math as before).
    const nonChlorineClassifications = { ...classifications, chlorine: 'PASS' };
    const severity = (typeof computeCountrySeverityProtection === 'function')
      ? computeCountrySeverityProtection(rawScore, nonChlorineClassifications)
      : { score: rawScore, applied: false, worstClassification: null, cap: null, preCapScore: rawScore };

    const cappedScore = Math.min(gateScore, severity.score);
    // 2026-08-18 (PO-approved): a score computed without chlorine must never
    // present as a pass/good verdict — cap below the pass-band threshold
    // regardless of how well the other params scored.
    const score = (!Number.isFinite(cl) && Number.isFinite(cappedScore))
      ? Math.min(cappedScore, 79)
      : cappedScore;

    const reasons = [];
    if (!Number.isFinite(cl)) {
      reasons.push({ parameter: 'chlorine', severity: 'warning', message: 'Free chlorine has not been measured yet — this score is provisional and excludes chlorine until it is captured.' });
    } else if (cl > L.chlorine.max) {
      reasons.push({ parameter: 'chlorine', severity: 'critical', message: 'Free chlorine exceeds the EU-engine project residual band (≤ 0.5 mg/L; not a Directive free-Cl residual). Score capped.' });
    } else if (cl < L.chlorine.min) {
      reasons.push({ parameter: 'chlorine', severity: 'critical', message: 'Free chlorine is below the EU-engine project residual band (0.1–0.5 mg/L; not a Directive free-Cl residual). Score capped.' });
    }
    if (turb > L.turbidity.ideal) {
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds EU drinking-water parametric expectation (≤ 1 NTU).' });
    }
    if (tds > L.tds.displayMax) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds EU indicator threshold used in this comparison (≤ 500 mg/L).' });
    }
    if (ph < L.ph.min || ph > L.ph.max) {
      reasons.push({ parameter: 'ph', severity: classifications.ph.toLowerCase(), message: 'pH is outside EU drinking-water range (6.5–9.5).' });
    }
    if (!Number.isFinite(do_)) {
      reasons.push({ parameter: 'do', severity: 'warning', message: 'Dissolved oxygen has not been measured yet — this score is provisional and excludes DO until it is captured.' });
    } else if (do_ < L.do.min) {
      reasons.push({ parameter: 'do', severity: 'fail', message: 'Dissolved oxygen is below EU comparison minimum (≥ 6 mg/L).' });
    }

    const verdict = verdictFrom(score, chlorineFail);
    let summary = 'Meets EU-engine comparison expectations for this reading set.';
    if (chlorineFail) summary = 'Fails EU-engine project chlorine check — composite score is gated (PD-002).';
    else if (reasons.length) summary = 'One or more EU-engine parametric/indicator expectations are not met.';

    const statuses = {
      ph: statusOf('ph', ph), tds: statusOf('tds', tds), chlorine: statusOf('chlorine', cl),
      turbidity: statusOf('turbidity', turb), orp: statusOf('orp', orp), do: statusOf('do', do_),
      temp: statusOf('temp', readings.temp)
    };
    const findings = reasons.map(r => ({ label: r.message, val: String(readings[r.parameter] ?? ''), note: '' }));

    
    const topPositiveFactors = [];
    const topNegativeFactors = [];
    if (ph >= L.ph.min && ph <= L.ph.max) topPositiveFactors.push('pH is within EU drinking-water range (6.5–9.5)');
    if (tds <= L.tds.displayMax) topPositiveFactors.push('TDS is within EU indicator threshold used here (≤ 500 mg/L)');
    if (turb <= L.turbidity.ideal) topPositiveFactors.push('Turbidity meets EU parametric expectation (≤ 1 NTU)');
    if (do_ >= L.do.min) topPositiveFactors.push('Dissolved oxygen meets EU comparison minimum (≥ 6 mg/L)');
    if (!chlorineFail) topPositiveFactors.push('Free chlorine is inside the EU-engine project residual band (0.1–0.5 mg/L)');
    if (orp >= L.orp.min && orp <= L.orp.max) topPositiveFactors.push('ORP is inside the operational window used for EU comparison');
    reasons.forEach(r => topNegativeFactors.push(r.message));

    return wrap({
      engine: 'EU',
      engineKey: 'eu',
      score,
      rawAggregate: rawScore,
      severityProtection: severity,
      countryGate,
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
      standardRevision: 'EU-engine project benchmark (Directive-inspired; free-Cl residual project-defined)',
      gated: chlorineFail
    });

  }

  window.WaterScoreBenchmarkRegistry.register({
    key: 'eu',
    labelKey: 'score.refStandard.eu',
    shortKey: 'score.refStandard.short.eu',
    display: L.display,
    limits: L,
    weights: W,
    calculate,
    evaluateStatus: statusOf
  });
})();
