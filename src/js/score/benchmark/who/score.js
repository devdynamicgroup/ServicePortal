/**
 * WHO benchmark engine — WHO guideline proximity / DWQI-style index.
 * Owns WHO-specific metadata explanations (does not call production).
 */
(function registerWhoBenchmarkEngine() {
  const L = window.WhoBenchmarkLimits;
  const W = window.WhoBenchmarkWeights;
  const clamp = typeof scoreClamp === 'function' ? scoreClamp : (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata : () => ({ score: null });

  function gradePh(ph) {
    if (ph >= L.ph.min && ph <= L.ph.max) return 100;
    if (ph >= L.ph.fairMin && ph <= L.ph.fairMax) return 70;
    if (ph >= L.ph.poorMin && ph <= L.ph.poorMax) return 40;
    return 15;
  }
  function gradeTds(tds) {
    if (tds <= L.tds.ideal) return 100;
    if (tds <= L.tds.fair) return 100 - (tds - L.tds.ideal) / (L.tds.fair - L.tds.ideal) * 20;
    if (tds <= L.tds.poor) return 80 - (tds - L.tds.fair) / (L.tds.poor - L.tds.fair) * 30;
    return clamp(50 - (tds - L.tds.poor) / 30);
  }
  function gradeTurbidity(turb) {
    if (turb <= L.turbidity.ideal) return 100;
    if (turb <= L.turbidity.fair) return 100 - (turb - L.turbidity.ideal) / (L.turbidity.fair - L.turbidity.ideal) * 30;
    if (turb <= L.turbidity.poor) return 70 - (turb - L.turbidity.fair) / (L.turbidity.poor - L.turbidity.fair) * 40;
    return clamp(30 - (turb - L.turbidity.poor) * 3);
  }
  function gradeOrp(orp) {
    if (orp >= L.orp.min && orp <= L.orp.max) return 100;
    if (orp < L.orp.min) return clamp(orp / L.orp.min * 100);
    return clamp(100 - (orp - L.orp.max) / 10);
  }
  function gradeChlorine(fcl) {
    if (fcl >= L.chlorine.idealMin && fcl <= L.chlorine.idealMax) return 100;
    if (fcl <= L.chlorine.fair) return 80;
    if (fcl <= L.chlorine.poor) return 50;
    return 25;
  }
  function gradeDo(doValue) {
    if (doValue >= L.do.min) return 100;
    return clamp(doValue / L.do.min * 100);
  }

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
    const ph = Number(readings.ph);
    const tds = Number(readings.tds);
    const turb = Number(readings.turbidity);
    const orp = Number(readings.orp);
    const fcl = Number(readings.chlorine);
    const do_ = Number(readings.do);
    if (![ph, tds, turb, orp, fcl, do_].every(Number.isFinite)) {
      return incomplete('WHO', 'who', { readings, engineVersion: 'v1.0', standardRevision: 'WHO Drinking Water Guideline 2025' });
    }
    const params = {
      ph: gradePh(ph), tds: gradeTds(tds), turbidity: gradeTurbidity(turb),
      orp: gradeOrp(orp), chlorine: gradeChlorine(fcl), do: gradeDo(do_)
    };
    let num = 0; let den = 0;
    Object.keys(W).forEach(key => { num += params[key] * W[key]; den += W[key]; });
    const score = Math.round(num / den);

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
      temp: Number.isFinite(Number(readings.temp)) && Number(readings.temp) <= L.temp.max
    };
    const classifications = {
      ph: classify(params.ph, ideal.ph),
      tds: classify(params.tds, ideal.tds),
      chlorine: classify(params.chlorine, ideal.chlorine),
      turbidity: classify(params.turbidity, ideal.turbidity),
      orp: classify(params.orp, ideal.orp),
      do: classify(params.do, ideal.do),
      temp: !Number.isFinite(Number(readings.temp)) ? 'NOT_MEASURED' : (ideal.temp ? 'PASS' : 'WARNING')
    };

    const reasons = [];
    if (!ideal.chlorine && fcl > L.chlorine.idealMax) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine exceeds WHO guideline residual band (0.2–0.5 mg/L).' });
    } else if (!ideal.chlorine && fcl < L.chlorine.idealMin) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine is below WHO recommended residual for drinking water.' });
    }
    if (!ideal.turbidity) {
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds WHO drinking-water guideline (≤ 1 NTU).' });
    }
    if (!ideal.tds) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds WHO aesthetic guideline (≤ 500 mg/L).' });
    }
    if (!ideal.ph) {
      reasons.push({ parameter: 'ph', severity: classifications.ph.toLowerCase(), message: 'pH is outside WHO recommended range (6.5–8.5).' });
    }
    if (!ideal.do) {
      reasons.push({ parameter: 'do', severity: classifications.do.toLowerCase(), message: 'Dissolved oxygen is below WHO comparison minimum (≥ 6 mg/L).' });
    }
    if (!ideal.orp) {
      reasons.push({ parameter: 'orp', severity: classifications.orp.toLowerCase(), message: 'ORP is outside the WHO comparison operational window (200–600 mV).' });
    }

    const verdict = verdictFrom(score);
    let summary = 'Meets WHO drinking water recommendations.';
    if (reasons.length) summary = 'Does not fully meet WHO drinking-water guideline proximity for all indicators.';
    if (verdict === 'Excellent' && !reasons.length) summary = 'Aligns closely with WHO drinking-water guideline targets.';

    const statuses = {
      ph: statusOf('ph', ph), tds: statusOf('tds', tds), chlorine: statusOf('chlorine', fcl),
      turbidity: statusOf('turbidity', turb), orp: statusOf('orp', orp), do: statusOf('do', do_),
      temp: statusOf('temp', readings.temp)
    };
    const findings = reasons.map(r => ({ label: r.message, val: String(readings[r.parameter] ?? ''), note: '' }));

    
    const topPositiveFactors = [];
    const topNegativeFactors = [];
    if (ideal.ph) topPositiveFactors.push('pH is within WHO recommended range (6.5–8.5)');
    if (ideal.tds) topPositiveFactors.push('TDS is at or below WHO aesthetic guideline (≤ 500 mg/L)');
    if (ideal.turbidity) topPositiveFactors.push('Turbidity meets WHO drinking-water guideline (≤ 1 NTU)');
    if (ideal.orp) topPositiveFactors.push('ORP indicates an effective disinfection / redox window (200–600 mV)');
    if (ideal.do) topPositiveFactors.push('Dissolved oxygen meets WHO comparison minimum (≥ 6 mg/L)');
    if (ideal.chlorine) topPositiveFactors.push('Free chlorine is inside WHO residual band (0.2–0.5 mg/L)');
    reasons.forEach(r => topNegativeFactors.push(r.message));

    return wrap({
      engine: 'WHO',
      engineKey: 'who',
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
      standardRevision: 'WHO Drinking Water Guideline 2025'
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
