/**
 * EU benchmark engine — parametric compliance philosophy.
 * Critical chlorine outside band triggers a hard composite cap.
 */
(function registerEuBenchmarkEngine() {
  const L = window.EuBenchmarkLimits;
  const W = window.EuBenchmarkWeights;
  const clamp = typeof scoreClamp === 'function' ? scoreClamp : (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

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
    // Above parametric max — steep penalty (not WHO soft steps)
    if (cl <= 1.0) return clamp(55 - (cl - L.chlorine.max) * 50);
    return clamp(25 - (cl - 1) * 10);
  }
  function gradeTurbidity(turb) {
    if (turb <= L.turbidity.ideal) return 100;
    if (turb <= L.turbidity.hardFail) return clamp(100 - (turb - L.turbidity.ideal) / (L.turbidity.hardFail - L.turbidity.ideal) * 55);
    return clamp(35 - (turb - L.turbidity.hardFail) * 8);
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

  function findingsFrom(readings) {
    const out = [];
    const ph = Number(readings.ph);
    const tds = Number(readings.tds);
    const cl = Number(readings.chlorine);
    const turb = Number(readings.turbidity);
    if (Number.isFinite(cl) && cl > L.chlorine.max) out.push({ labelKey: 'score.concern.highChlorine', val: cl + ' mg/L' });
    if (Number.isFinite(cl) && cl < L.chlorine.min) out.push({ labelKey: 'score.concern.lowChlorine', val: cl + ' mg/L' });
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
    const cl = Number(readings.chlorine);
    const do_ = Number(readings.do);
    if (![ph, tds, turb, orp, cl, do_].every(Number.isFinite)) {
      return { score: null, params: null, findings: [], statuses: {} };
    }
    const params = {
      ph: gradePh(ph), tds: gradeTds(tds), chlorine: gradeChlorine(cl),
      turbidity: gradeTurbidity(turb), orp: gradeOrp(orp), do: gradeDo(do_)
    };
    let num = 0; let den = 0;
    Object.keys(W).forEach(key => { num += params[key] * W[key]; den += W[key]; });
    let score = Math.round(num / den);
    const chlorineFail = cl < L.chlorine.min || cl > L.chlorine.max;
    if (chlorineFail) score = Math.min(score, L.gateCapOnChlorineFail);
    const statuses = {
      ph: statusOf('ph', ph), tds: statusOf('tds', tds), chlorine: statusOf('chlorine', cl),
      turbidity: statusOf('turbidity', turb), orp: statusOf('orp', orp), do: statusOf('do', do_),
      temp: statusOf('temp', readings.temp)
    };
    return { score, params, findings: findingsFrom(readings), statuses, gated: chlorineFail };
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
