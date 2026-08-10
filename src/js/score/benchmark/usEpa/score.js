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
  function gradeChlorine(cl) {
    if (cl >= L.chlorine.min && cl <= L.chlorine.max) return 100;
    if (cl < L.chlorine.min) return clamp(cl / L.chlorine.min * 60);
    return clamp(100 - (cl - L.chlorine.max) * 30);
  }
  function gradeTurbidity(turb) {
    if (turb <= L.turbidity.ttIdeal) return 100;
    if (turb <= L.turbidity.steepEnd) {
      return clamp(100 - (turb - L.turbidity.ttIdeal) / (L.turbidity.steepEnd - L.turbidity.ttIdeal) * 60);
    }
    return clamp(30 - (turb - L.turbidity.steepEnd) * 5);
  }
  function gradeOrp(orp) {
    if (orp >= L.orp.min && orp <= L.orp.max) return 100;
    if (orp < L.orp.min) return clamp(orp / L.orp.min * 100);
    return clamp(100 - (orp - L.orp.max) / 10);
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
    if (param === 'chlorine') return n >= L.chlorine.min && n <= L.chlorine.max ? 'good' : 'attn';
    if (param === 'turbidity') return n <= L.turbidity.ttIdeal ? 'good' : 'attn';
    if (param === 'orp') return n >= L.orp.min && n <= L.orp.max ? 'good' : 'attn';
    if (param === 'do') return n >= L.do.min ? 'good' : 'attn';
    if (param === 'temp') return n <= L.temp.max ? 'good' : 'attn';
    return 'good';
  }

  function calculate(readings) {
    const ph = Number(readings.ph);
    const tds = Number(readings.tds);
    const turb = Number(readings.turbidity);
    const orp = Number(readings.orp);
    const cl = Number(readings.chlorine);
    const do_ = Number(readings.do);
    if (![ph, tds, turb, orp, cl, do_].every(Number.isFinite)) {
      return incomplete('US EPA', 'usEpa', { readings, engineVersion: 'v1.0', standardRevision: 'US EPA MCL / SMCL / TT comparison set 2024' });
    }
    const params = {
      ph: gradePh(ph), tds: gradeTds(tds), chlorine: gradeChlorine(cl),
      turbidity: gradeTurbidity(turb), orp: gradeOrp(orp), do: gradeDo(do_)
    };
    let num = 0; let den = 0;
    Object.keys(W).forEach(key => { num += params[key] * W[key]; den += W[key]; });
    const score = Math.round(num / den);

    const pass = {
      ph: ph >= L.ph.min && ph <= L.ph.max,
      tds: tds <= L.tds.smcl,
      chlorine: cl >= L.chlorine.min && cl <= L.chlorine.max,
      turbidity: turb <= L.turbidity.ttIdeal,
      orp: orp >= L.orp.min && orp <= L.orp.max,
      do: do_ >= L.do.min,
      // Not Measured must never read as PASS. temp is not part of the US EPA
      // scoring formula (zero weight — see weights.js), so this only affects
      // the classification/metadata bucket, never the score.
      temp: Number.isFinite(Number(readings.temp)) && Number(readings.temp) <= L.temp.max
    };
    const classifications = {
      ph: classify(params.ph, pass.ph, false),
      tds: classify(params.tds, pass.tds, false),
      chlorine: classify(params.chlorine, pass.chlorine, false),
      turbidity: classify(params.turbidity, pass.turbidity, true),
      orp: classify(params.orp, pass.orp, false),
      do: classify(params.do, pass.do, false),
      temp: !Number.isFinite(Number(readings.temp)) ? 'NOT_MEASURED' : (pass.temp ? 'PASS' : 'WARNING')
    };

    const reasons = [];
    if (!pass.turbidity) {
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds US EPA treatment-technique style target used here (≤ 1 NTU).' });
    }
    if (!pass.tds) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds US EPA secondary (SMCL) aesthetic guideline (≤ 500 mg/L).' });
    }
    if (!pass.chlorine && cl > L.chlorine.max) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine exceeds US EPA MRDL-style upper comparison (≤ 4 mg/L).' });
    } else if (!pass.chlorine && cl < L.chlorine.min) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine is below the operational residual floor used for EPA comparison (≥ 0.2 mg/L).' });
    }
    if (!pass.ph) {
      reasons.push({ parameter: 'ph', severity: classifications.ph.toLowerCase(), message: 'pH is outside US EPA secondary range (6.5–8.5).' });
    }
    if (!pass.do) {
      reasons.push({ parameter: 'do', severity: classifications.do.toLowerCase(), message: 'Dissolved oxygen is below EPA comparison minimum (≥ 6 mg/L).' });
    }

    const verdict = verdictFrom(score);
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
    if (pass.chlorine) topPositiveFactors.push('Free chlorine is within US EPA MRDL-style comparison band (0.2–4 mg/L)');
    if (pass.turbidity) topPositiveFactors.push('Turbidity meets US EPA treatment-technique style target (≤ 1 NTU)');
    if (pass.do) topPositiveFactors.push('Dissolved oxygen meets EPA comparison minimum (≥ 6 mg/L)');
    if (pass.orp) topPositiveFactors.push('ORP is inside the operational window used for EPA comparison');
    reasons.forEach(r => topNegativeFactors.push(r.message));

    return wrap({
      engine: 'US EPA',
      engineKey: 'usEpa',
      score,
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
      engineVersion: 'v1.0',
      standardRevision: 'US EPA MCL / SMCL / TT comparison set 2024'
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
