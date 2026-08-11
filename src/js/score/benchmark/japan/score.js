/**
 * Japan benchmark engine — national criteria with turbidity/chlorine emphasis.
 * Owns Japan-specific metadata explanations.
 */
(function registerJapanBenchmarkEngine() {
  const L = window.JapanBenchmarkLimits;
  const W = window.JapanBenchmarkWeights;
  const clamp = typeof scoreClamp === 'function' ? scoreClamp : (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata : () => ({ score: null });

  function gradePh(ph) {
    if (ph >= L.ph.min && ph <= L.ph.max) return 100;
    const dist = ph < L.ph.min ? L.ph.min - ph : ph - L.ph.max;
    return clamp(100 - dist * 45);
  }
  function gradeTds(tds) {
    if (tds <= 300) return 100;
    if (tds <= L.tds.displayMax) return clamp(100 - (tds - 300) / 200 * 20);
    return clamp(75 - (tds - L.tds.displayMax) / 15);
  }
  function gradeChlorine(cl) {
    if (cl >= L.chlorine.min && cl <= L.chlorine.max) return 100;
    if (cl < L.chlorine.min) return clamp(cl / L.chlorine.min * 55);
    if (cl <= 1.5) return clamp(85 - (cl - L.chlorine.max) * 40);
    return clamp(40 - (cl - 1.5) * 15);
  }
  function gradeTurbidity(turb) {
    if (turb <= L.turbidity.ideal) return 100;
    if (turb <= L.turbidity.steepEnd) {
      return clamp(100 - (turb - L.turbidity.ideal) / (L.turbidity.steepEnd - L.turbidity.ideal) * 50);
    }
    return clamp(40 - (turb - L.turbidity.steepEnd) * 6);
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
      return incomplete('Japan', 'japan', { readings, engineVersion: 'v1.0', standardRevision: 'Japan Drinking Water Standard 2023' });
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
      tds: tds <= L.tds.displayMax,
      chlorine: cl >= L.chlorine.min && cl <= L.chlorine.max,
      turbidity: turb <= L.turbidity.ideal,
      orp: orp >= L.orp.min && orp <= L.orp.max,
      do: do_ >= L.do.min,
      // Not Measured must never read as PASS. temp is not part of the Japan
      // scoring formula (zero weight — see weights.js), so this only affects
      // the classification/metadata bucket, never the score.
      temp: Number.isFinite(Number(readings.temp)) && Number(readings.temp) <= L.temp.max
    };
    const classifications = {
      ph: classify(params.ph, pass.ph),
      tds: classify(params.tds, pass.tds),
      chlorine: classify(params.chlorine, pass.chlorine),
      turbidity: classify(params.turbidity, pass.turbidity),
      orp: classify(params.orp, pass.orp),
      do: classify(params.do, pass.do),
      temp: !Number.isFinite(Number(readings.temp)) ? 'NOT_MEASURED' : (pass.temp ? 'PASS' : 'WARNING')
    };

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
    if (!pass.do) {
      reasons.push({ parameter: 'do', severity: classifications.do.toLowerCase(), message: 'Dissolved oxygen is below Japan comparison minimum (≥ 5 mg/L).' });
    }

    const verdict = verdictFrom(score);
    let summary = 'Meets Japanese drinking-water criteria for this comparison.';
    if (!reasons.length && verdict === 'Excellent') summary = 'Strong alignment with Japanese drinking-water criteria.';
    else if (reasons.length) summary = 'One or more Japanese drinking-water criteria need attention.';

    const statuses = {
      ph: statusOf('ph', ph), tds: statusOf('tds', tds), chlorine: statusOf('chlorine', cl),
      turbidity: statusOf('turbidity', turb), orp: statusOf('orp', orp), do: statusOf('do', do_),
      temp: statusOf('temp', readings.temp)
    };
    const findings = reasons.map(r => ({ label: r.message, val: String(readings[r.parameter] ?? ''), note: '' }));

    
    const topPositiveFactors = [];
    const topNegativeFactors = [];
    if (pass.ph) topPositiveFactors.push('pH is within Japan national range (5.8–8.6)');
    if (pass.tds) topPositiveFactors.push('TDS is within Japan comparison ceiling (≤ 500 mg/L)');
    if (pass.chlorine) topPositiveFactors.push('Free chlorine residual meets Japan recommendation (0.1–1 mg/L)');
    if (pass.turbidity) topPositiveFactors.push('Turbidity meets Japanese drinking-water recommendation (≤ 2 NTU)');
    if (pass.do) topPositiveFactors.push('Dissolved oxygen meets Japan comparison minimum (≥ 5 mg/L)');
    if (pass.orp) topPositiveFactors.push('ORP is inside the operational window used for Japan comparison');
    reasons.forEach(r => topNegativeFactors.push(r.message));

    return wrap({
      engine: 'Japan',
      engineKey: 'japan',
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
      standardRevision: 'Japan Drinking Water Standard 2023'
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
