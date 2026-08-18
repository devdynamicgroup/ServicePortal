/**
 * Japan benchmark engine — national criteria with turbidity/chlorine emphasis.
 * Owns Japan-specific metadata explanations.
 * PD-012 B (2026-08-13): DO excluded from Japan Compliance Index (NOT_EVALUATED).
 * JP-WEIGHTS values unchanged (PD-013 A); do:0.12 retained in weights.js but skipped in num/den.
 */
(function registerJapanBenchmarkEngine() {
  const L = window.JapanBenchmarkLimits;
  const W = window.JapanBenchmarkWeights;
  const wrap = typeof finalizeBenchmarkMetadata === 'function' ? finalizeBenchmarkMetadata : (x) => x;
  const incomplete = typeof incompleteBenchmarkMetadata === 'function'
    ? incompleteBenchmarkMetadata : () => ({ score: null });

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
    // PD-012 B: DO is excluded from Japan Compliance Index — never good/attn from ≥5.
    if (param === 'do') return 'pending';
    const n = Number(value);
    if (!Number.isFinite(n)) return 'pending';
    // 2026-08-18 (PO-approved, evidence: MHLW 水質管理目標設定項目/快適水質項目
    // "comfortable water" targets — see limits.js citations): the visible
    // Good/Attention status now follows the same tighter government target
    // band used for classification below (idealMin/idealMax/excellentMax),
    // not the wider legal-minimum band — so a value reading "Good" here
    // genuinely means it meets Japan's own stricter target, not just the
    // legal floor every engine's shared base already accounts for.
    if (param === 'ph') return n >= L.ph.idealMin && n <= L.ph.idealMax ? 'good' : 'attn';
    if (param === 'tds') return n <= L.tds.idealMax ? 'good' : 'attn';
    if (param === 'chlorine') return n >= L.chlorine.min && n <= L.chlorine.max ? 'good' : 'attn';
    if (param === 'turbidity') return n <= L.turbidity.excellentMax ? 'good' : 'attn';
    if (param === 'orp') return n >= L.orp.min && n <= L.orp.max ? 'good' : 'attn';
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
    // PD-012 B: DO not required for a complete Japan score. 2026-08-18
    // (PO-approved): chlorine is no longer required either — it may
    // genuinely not be measured yet. ph/tds/turbidity/orp remain required.
    if (![ph, tds, turb, orp].every(Number.isFinite)) {
      return incomplete('Japan', 'japan', {
        readings,
        engineVersion: 'v3',
        standardRevision: 'Japan-style Compliance Index (project engine; DO NOT_EVALUATED — PD-012 B; JP-WEIGHTS values unchanged — PD-013 A)'
      });
    }
    // 2026-08-18 (PO-approved): one shared grading formula (Quality V3's
    // curves), computed once and reused as every country's base score.
    // Japan differs from the other engines only in the PASS/FAIL thresholds
    // and severity handling below — never in how a value is graded.
    // See computeSharedBenchmarkBase in computeQualityScoreV2.js. DO still
    // has no PASS/FAIL opinion in Japan's own classification (PD-012 B,
    // unchanged) even though it now enters the shared base like any engine.
    const base = computeSharedBenchmarkBase(readings);
    const params = base.params;
    const rawScore = base.score;

    // 2026-08-18 (PO-approved): PASS now requires meeting Japan's own
    // government-cited "comfortable water" target band (水質管理目標設定項目/
    // 快適水質項目 — see limits.js citations: pH ~7.5 target from two
    // independent municipal sources; TDS 30-200 mg/L same sources; turbidity
    // ≤1 NTU = half the legal 2 NTU limit, MHLW), not just the wider legal
    // minimum every engine's shared base already has to clear — so Japan
    // now visibly differs from Thailand's own (looser) legal thresholds for
    // water that would previously have passed both. No official target
    // exists for chlorine (limits.js notes this explicitly), so chlorine
    // stays on the legal band.
    const pass = {
      ph: ph >= L.ph.idealMin && ph <= L.ph.idealMax,
      tds: tds <= L.tds.idealMax,
      chlorine: cl >= L.chlorine.min && cl <= L.chlorine.max,
      turbidity: turb <= L.turbidity.excellentMax,
      orp: orp >= L.orp.min && orp <= L.orp.max
      // do excluded — never pass/fail Compliance Index via ≥5
    };
    const tempVal = toFin(readings.temp);
    const classifications = {
      ph: classify(params.ph, pass.ph),
      tds: classify(params.tds, pass.tds),
      // Missing chlorine is an absent measurement, not a failed one —
      // NOT_MEASURED (same convention already used for temp below) so
      // severity protection ignores it instead of reading it as
      // CRITICAL/FAIL. The explicit score cap below (not this
      // classification) is what stops it from presenting as a pass.
      chlorine: Number.isFinite(cl) ? classify(params.chlorine, pass.chlorine) : 'NOT_MEASURED',
      turbidity: classify(params.turbidity, pass.turbidity),
      orp: classify(params.orp, pass.orp),
      // PD-012 B: DO excluded from Japan Compliance Index.
      do: 'NOT_EVALUATED',
      // Not Measured must never read as PASS. temp is not part of the Japan
      // scoring formula (zero weight — see weights.js), so this only affects
      // the classification/metadata bucket, never the score.
      temp: !Number.isFinite(tempVal) ? 'NOT_MEASURED' : (
        (Number.isFinite(tempVal) && tempVal <= L.temp.max) ? 'PASS' : 'WARNING'
      )
    };

    // Score Architecture V2 (2026-08-17, PO-approved additive contract):
    // capture severity protection as an inspectable stage. Same cap math as
    // before (applyCountrySeverityProtection, called internally) — this only
    // exposes whether it fired and what the pre-cap score was.
    const severity = (typeof computeCountrySeverityProtection === 'function')
      ? computeCountrySeverityProtection(rawScore, classifications)
      : { score: rawScore, applied: false, worstClassification: null, cap: null, preCapScore: rawScore };
    // 2026-08-18 (PO-approved): a score computed without chlorine must never
    // present as a pass/good verdict — cap below the pass-band threshold
    // regardless of how well the other params scored.
    const finalScore = (!Number.isFinite(cl) && Number.isFinite(severity.score))
      ? Math.min(severity.score, 79)
      : severity.score;

    const reasons = [];
    if (!pass.turbidity) {
      reasons.push({ parameter: 'turbidity', severity: classifications.turbidity.toLowerCase(), message: 'Turbidity exceeds Japan’s comfortable-water target (≤ 1 NTU — half the 2 NTU legal limit; MHLW 快適水質項目).' });
    }
    if (!Number.isFinite(cl)) {
      reasons.push({ parameter: 'chlorine', severity: 'warning', message: 'Free chlorine has not been measured yet — this score is provisional and excludes chlorine until it is captured.' });
    } else if (!pass.chlorine && cl > L.chlorine.max) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine exceeds Japan residual recommendation (≤ 1 mg/L).' });
    } else if (!pass.chlorine && cl < L.chlorine.min) {
      reasons.push({ parameter: 'chlorine', severity: classifications.chlorine.toLowerCase(), message: 'Free chlorine is below Japan residual recommendation (≥ 0.1 mg/L).' });
    }
    if (!pass.ph) {
      reasons.push({ parameter: 'ph', severity: classifications.ph.toLowerCase(), message: 'pH is outside Japan’s comfortable-water target (7.3–7.7, ~7.5 target — MHLW‑style municipal tables); still within the wider 5.8–8.6 legal range.' });
    }
    if (!pass.tds) {
      reasons.push({ parameter: 'tds', severity: classifications.tds.toLowerCase(), message: 'TDS exceeds Japan’s comfortable-water target (≤ 200 mg/L; still within the wider 500 mg/L legal ceiling).' });
    }

    const verdict = verdictFrom(rawScore);
    let summary = 'Meets this project’s Japan-style Compliance Index criteria for this comparison (DO not evaluated — PD-012 B).';
    if (!reasons.length && verdict === 'Excellent') {
      summary = 'Strong alignment with this project’s Japan-style Compliance Index criteria (DO not evaluated — PD-012 B).';
    } else if (reasons.length) {
      summary = 'One or more Japan-style comparison criteria used by this project engine need attention (DO not evaluated — PD-012 B).';
    }

    const statuses = {
      ph: statusOf('ph', ph),
      tds: statusOf('tds', tds),
      chlorine: statusOf('chlorine', cl),
      turbidity: statusOf('turbidity', turb),
      orp: statusOf('orp', orp),
      do: statusOf('do', do_),
      temp: statusOf('temp', readings.temp)
    };
    const findings = reasons.map(r => ({ label: r.message, val: String(readings[r.parameter] ?? ''), note: '' }));

    const topPositiveFactors = [];
    const topNegativeFactors = [];
    if (pass.ph) topPositiveFactors.push('pH meets Japan’s comfortable-water target (7.3–7.7)');
    if (pass.tds) topPositiveFactors.push('TDS meets Japan’s comfortable-water target (≤ 200 mg/L)');
    if (pass.chlorine) topPositiveFactors.push('Free chlorine residual meets Japan recommendation (0.1–1 mg/L)');
    if (pass.turbidity) topPositiveFactors.push('Turbidity meets Japan’s comfortable-water target (≤ 1 NTU)');
    if (pass.orp) topPositiveFactors.push('ORP is inside the operational window used for Japan comparison');
    reasons.forEach(r => topNegativeFactors.push(r.message));

    return wrap({
      engine: 'Japan',
      engineKey: 'japan',
      // Country severity protection (product decision, 2026-08-14): FAIL/CRITICAL/
      // WARNING classifications cap the composite. See src/js/score/util/
      // benchmarkMetadata.js for the shared, engine-agnostic implementation.
      // Does not affect grades, weights, or aggregation above.
      score: finalScore,
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
      // v2 (2026-08-17, Score Architecture V2): marks the first version-tracked
      // release. Versions before this point were never bumped despite real
      // curve changes (turbidity commit 72512555, pH/TDS/chlorine commit
      // e277362f both shipped as 'v1.0') — v1 does not correspond to any
      // single historical baseline, so this is a fresh starting point, not a
      // precise reconstruction of prior history.
      engineVersion: 'v3',
      standardRevision: 'Japan-style Compliance Index (project engine; DO NOT_EVALUATED — PD-012 B; JP-WEIGHTS values unchanged — PD-013 A)'
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
