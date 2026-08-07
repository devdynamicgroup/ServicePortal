/**
 * Thailand benchmark engine — local acceptability philosophy.
 * Soft Pass/Fail index. DO and Temp are not scored.
 * Independent of WHO/EU/Japan/EPA engines.
 */
(function registerThailandBenchmarkEngine() {
  const L = window.ThailandBenchmarkLimits;
  const W = window.ThailandBenchmarkWeights;
  const clamp = typeof scoreClamp === 'function' ? scoreClamp : (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

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

  function statusOf(param, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'pending';
    if (param === 'ph') return n >= L.ph.min && n <= L.ph.max ? 'good' : 'attn';
    if (param === 'tds') return n <= L.tds.passMax ? 'good' : 'attn';
    if (param === 'chlorine') return n >= L.chlorine.min && n <= L.chlorine.max ? 'good' : 'attn';
    if (param === 'turbidity') return n <= L.turbidity.passMax ? 'good' : 'attn';
    if (param === 'orp') return n >= L.orp.min && n <= L.orp.max ? 'good' : 'attn';
    if (param === 'do' || param === 'temp') return 'good';
    return 'good';
  }

  function findingsFrom(readings) {
    const out = [];
    const ph = Number(readings.ph);
    const tds = Number(readings.tds);
    const cl = Number(readings.chlorine);
    const turb = Number(readings.turbidity);
    if (Number.isFinite(cl) && cl > L.chlorine.max) out.push({ labelKey: 'score.concern.highChlorine', val: cl + ' mg/L' });
    if (Number.isFinite(cl) && cl < L.chlorine.min) out.push({ labelKey: 'score.concern.lowChlorine', val: cl + ' mg/L' });
    if (Number.isFinite(turb) && turb > L.turbidity.passMax) out.push({ labelKey: 'score.concern.highTurbidity', val: turb + ' NTU' });
    if (Number.isFinite(ph) && (ph < L.ph.min || ph > L.ph.max)) out.push({ labelKey: 'score.concern.phRange', val: String(ph) });
    if (Number.isFinite(tds) && tds > L.tds.passMax) out.push({ labelKey: 'score.concern.highTds', val: tds + ' mg/L' });
    return out;
  }

  function calculate(readings) {
    const ph = Number(readings.ph);
    const tds = Number(readings.tds);
    const turb = Number(readings.turbidity);
    const orp = Number(readings.orp);
    const cl = Number(readings.chlorine);
    if (![ph, tds, turb, orp, cl].every(Number.isFinite)) {
      return { score: null, params: null, findings: [], statuses: {} };
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
    const statuses = {
      ph: statusOf('ph', ph),
      tds: statusOf('tds', tds),
      chlorine: statusOf('chlorine', cl),
      turbidity: statusOf('turbidity', turb),
      orp: statusOf('orp', orp),
      do: statusOf('do', readings.do),
      temp: statusOf('temp', readings.temp)
    };
    return { score, params, findings: findingsFrom(readings), statuses };
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
