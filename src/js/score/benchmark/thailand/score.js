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

  function gradePh(ph) {
    if (ph >= L.ph.min && ph <= L.ph.max) return 100;
    const dist = ph < L.ph.min ? L.ph.min - ph : ph - L.ph.max;
    return clamp(100 - dist * 35);
  }
  function gradeTds(tds) {
    if (tds <= L.tds.passMax) return 100;
    if (tds <= L.tds.softEnd) {
      return clamp(100 - (tds - L.tds.softStart) / (L.tds.softEnd - L.tds.softStart) * 40);
    }
    return clamp(40 - (tds - L.tds.softEnd) / 50);
  }
  function gradeChlorine(cl) {
    if (cl >= L.chlorine.min && cl <= L.chlorine.max) return 100;
    if (cl < L.chlorine.min) return clamp(cl / L.chlorine.min * 70);
    return clamp(100 - (cl - L.chlorine.max) * 25);
  }
  function gradeTurbidity(turb) {
    if (turb <= L.turbidity.passMax) return 100;
    if (turb <= L.turbidity.softEnd) {
      return clamp(100 - (turb - L.turbidity.passMax) / (L.turbidity.softEnd - L.turbidity.passMax) * 45);
    }
    return clamp(40 - (turb - L.turbidity.softEnd) * 4);
  }
  function gradeOrp(orp) {
    if (orp >= L.orp.min && orp <= L.orp.max) return 100;
    if (orp < L.orp.min) return clamp(orp / L.orp.min * 100);
    return clamp(100 - (orp - L.orp.max) / 10);
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
    if (![ph, tds, turb, orp, cl].every(Number.isFinite)) {
      return incomplete('Thailand', 'thailand', { readings, engineVersion: 'v1.0', standardRevision: 'Thailand Compliance Index (project bands; Cl 0.2–2.0 project-defined — PD-008)' });
    }
    const params = {
      ph: gradePh(ph),
      tds: gradeTds(tds),
      chlorine: gradeChlorine(cl),
      turbidity: gradeTurbidity(turb),
      orp: gradeOrp(orp)
    };
    let num = 0;
    let den = 0;
    Object.keys(W).forEach(key => {
      if (!Number.isFinite(params[key])) return;
      num += params[key] * W[key];
      den += W[key];
    });
    const score = den > 0 ? Math.round(num / den) : null;

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
      chlorine: classify(params.chlorine, pass.chlorine),
      turbidity: classify(params.turbidity, pass.turbidity),
      orp: classify(params.orp, pass.orp),
      // PD-003: DO/Temp are excluded by project design. They must never classify
      // as PASS/GOOD merely because a value exists (or because Number(null)===0).
      // NOT_EVALUATED = engine does not score this parameter.
      do: 'NOT_EVALUATED',
      temp: 'NOT_EVALUATED'
    };

    const reasons = [];
    if (!pass.chlorine && cl > L.chlorine.max) {
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
