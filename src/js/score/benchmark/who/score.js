/**
 * WHO benchmark engine — WHO guideline proximity / DWQI-style index.
 * Owns its own copy of WHO ladders (does not call production computeScoreFromReadings).
 */
(function registerWhoBenchmarkEngine() {
  const L = window.WhoBenchmarkLimits;
  const W = window.WhoBenchmarkWeights;
  const clamp = typeof scoreClamp === 'function' ? scoreClamp : (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

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

  function findingsFrom(readings) {
    const out = [];
    const ph = Number(readings.ph);
    const tds = Number(readings.tds);
    const fcl = Number(readings.chlorine);
    const turb = Number(readings.turbidity);
    if (Number.isFinite(fcl) && fcl > L.chlorine.idealMax) out.push({ labelKey: 'score.concern.highChlorine', val: fcl + ' mg/L' });
    if (Number.isFinite(fcl) && fcl < L.chlorine.idealMin) out.push({ labelKey: 'score.concern.lowChlorine', val: fcl + ' mg/L' });
    if (Number.isFinite(turb) && turb > L.turbidity.ideal) out.push({ labelKey: 'score.concern.highTurbidity', val: turb + ' NTU' });
    if (Number.isFinite(ph) && (ph < L.ph.min || ph > L.ph.max)) out.push({ labelKey: 'score.concern.phRange', val: String(ph) });
    if (Number.isFinite(tds) && tds > L.tds.displayMax) out.push({ labelKey: 'score.concern.highTds', val: tds + ' mg/L' });
    return out;
  }

  function calculate(readings) {
    const ph = Number(readings.ph);
    const tds = Number(readings.tds);
    const turb = Number(readings.turbidity);
    const orp = Number(readings.orp);
    const fcl = Number(readings.chlorine);
    const do_ = Number(readings.do);
    if (![ph, tds, turb, orp, fcl, do_].every(Number.isFinite)) {
      return { score: null, params: null, findings: [], statuses: {} };
    }
    const params = {
      ph: gradePh(ph),
      tds: gradeTds(tds),
      turbidity: gradeTurbidity(turb),
      orp: gradeOrp(orp),
      chlorine: gradeChlorine(fcl),
      do: gradeDo(do_)
    };
    let num = 0; let den = 0;
    Object.keys(W).forEach(key => {
      num += params[key] * W[key];
      den += W[key];
    });
    const score = Math.round(num / den);
    const statuses = {
      ph: statusOf('ph', ph), tds: statusOf('tds', tds), chlorine: statusOf('chlorine', fcl),
      turbidity: statusOf('turbidity', turb), orp: statusOf('orp', orp), do: statusOf('do', do_),
      temp: statusOf('temp', readings.temp)
    };
    return { score, params, findings: findingsFrom(readings), statuses };
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
