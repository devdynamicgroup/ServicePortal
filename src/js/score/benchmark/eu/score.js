/**
 * EU benchmark engine — parametric / indicator comparison philosophy.
 * Free-chlorine residual band is PROJECT-DEFINED (PD-008) — not Directive 2020/2184.
 * Critical chlorine outside project band triggers hard composite cap (PD-002 gate 65).
 * Owns EU-specific metadata explanations.
 */
(function registerEuBenchmarkEngine() {
  const L = window.EuBenchmarkLimits;
  const W = window.EuBenchmarkWeights;
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
    if (tds <= L.tds.displayMax) return clamp(100 - (tds - 300) / 200 * 25);
    return clamp(70 - (tds - L.tds.steepAfter) / 20);
  }
  function gradeChlorine(cl) {
    if (cl >= L.chlorine.min && cl <= L.chlorine.max) return 100;
    if (cl < L.chlorine.min) return clamp(cl / L.chlorine.min * 40);
    if (cl <= 1.0) return clamp(55 - (cl - L.chlorine.max) * 50);
    return clamp(25 - (cl - 1) * 10);
  }
  function gradeTurbidity(turb) {
    if (turb <= L.turbidity.ideal) return 100;
    if (turb <= L.turbidity.hardFail) return clamp(100 - (turb - L.turbidity.ideal) / (L.turbidity.hardFail - L.turbidity.ideal) * 55);
    return clamp(35 - (turb - L.turbidity.hardFail) * 8);
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
    if (![ph, tds, turb, orp, cl, do_].every(Number.isFinite)) {
      return incomplete('EU', 'eu', { readings, engineVersion: 'v3', standardRevision: 'EU-engine project benchmark (Directive-inspired; free-Cl residual project-defined)' });
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
    const chlorineFail = cl < L.chlorine.min || cl > L.chlorine.max;

    const classifications = {
      ph: (ph >= L.ph.min && ph <= L.ph.max) ? 'PASS' : (params.ph >= 70 ? 'WARNING' : 'FAIL'),
      tds: tds <= L.tds.displayMax ? 'PASS' : (params.tds >= 70 ? 'WARNING' : 'FAIL'),
      chlorine: chlorineFail ? 'CRITICAL' : 'PASS',
      turbidity: turb <= L.turbidity.ideal ? 'PASS' : (turb <= L.turbidity.hardFail ? 'FAIL' : 'CRITICAL'),
      orp: (orp >= L.orp.min && orp <= L.orp.max) ? 'PASS' : 'WARNING',
      do: do_ >= L.do.min ? 'PASS' : 'FAIL',
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

    const score = Math.min(gateScore, severity.score);

    const reasons = [];
    if (cl > L.chlorine.max) {
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
    if (do_ < L.do.min) {
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
