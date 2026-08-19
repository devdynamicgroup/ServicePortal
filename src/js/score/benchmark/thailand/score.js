/**
 * Thailand benchmark engine — local acceptability philosophy.
 * 2026-08-18 (PO-approved): the base score is computed by the shared
 * cross-country formula (computeSharedBenchmarkBase); this engine's own job
 * is only the Thailand-specific PASS/FAIL thresholds and severity handling
 * below. Thailand still has no PASS/FAIL opinion on DO or Temp (classified
 * NOT_EVALUATED, unchanged) — if DO is present it still enters the shared
 * base number like any other engine, but Thailand never judges it.
 * Owns Thailand-specific metadata explanations.
 */
(function registerThailandBenchmarkEngine() {
  const L = window.ThailandBenchmarkLimits;
  const W = window.ThailandBenchmarkWeights;
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata
    : () => ({ score: null });

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
      return incomplete('Thailand', 'thailand', { readings, engineVersion: 'v3', standardRevision: 'Thailand Compliance Index (project bands; Cl 0.2–2.0 project-defined — PD-008)' });
    }
    // 2026-08-18 (PO-approved): one shared grading formula (Quality V3's
    // curves), computed once and reused as every country's base score.
    // Thailand differs from the other engines only in the PASS/FAIL
    // thresholds and severity handling below — never in how a value is
    // graded. See computeSharedBenchmarkBase in computeQualityScoreV2.js.
    const base = computeSharedBenchmarkBase(readings, W);
    const params = base.params;
    const rawScore = base.score;

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
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds Thailand local acceptability limit (≤ 1.0 NTU — MWA operating specification).' });
    }
    if (!pass.tds) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds Thailand reference ceiling (≤ 500 mg/L — DOH 2020).' });
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
    if (pass.tds) topPositiveFactors.push('TDS is within Thailand local acceptability (≤ 500 mg/L)');
    if (pass.chlorine) topPositiveFactors.push('Free chlorine residual is within the Thailand project compliance band (0.2–2.0 mg/L)');
    if (pass.turbidity) topPositiveFactors.push('Turbidity meets Thailand local limit (≤ 1.0 NTU)');
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
      engineVersion: 'v3',
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
