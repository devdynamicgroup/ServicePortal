/**
 * Score Architecture V2 (2026-08-17, PO-approved additive contract).
 * Deterministic trace utility — Reading -> Grade -> Weight -> Raw Aggregate ->
 * Classification -> Severity Protection -> Country Gate -> Ceiling -> Final Score.
 *
 * Pure function of (readings, standardKey): delegates entirely to
 * WaterScoreBenchmarkRegistry.calculate(), which itself never touches Case
 * state, DOM, localStorage, or Notion. Same readings + same standardKey +
 * same deployed model always produce the same explanation — callable
 * identically from UI, tests, scripts, or a server context.
 */
(function initExplainScore(global) {
  function formatGrade(v) {
    if (v === null || v === undefined) return 'n/a';
    return Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : String(v);
  }

  /**
   * @param {object} readings - ph, tds, turbidity, orp, chlorine, do, temp
   * @param {string} standardKey - 'thailand' | 'japan' | 'eu' | 'who' | 'usEpa'
   * @returns {{ result: object, lines: string[], text: string }}
   */
  function explainScore(readings, standardKey) {
    const registry = global.WaterScoreBenchmarkRegistry;
    if (!registry) throw new Error('WaterScoreBenchmarkRegistry not loaded');
    const result = registry.calculate(standardKey, readings || {});
    const lines = [];
    lines.push(`${result.engine || standardKey} (modelVersion=${result.modelVersion || 'unknown'})`);

    if (!result.complete) {
      lines.push(`  INCOMPLETE — ${result.reason || 'unknown reason'}`);
      lines.push('  finalScore = null');
      return { result, lines, text: lines.join('\n') };
    }

    const params = result.params || {};
    const classifications = result.classifications || {};
    Object.keys(params).forEach((key) => {
      const reading = readings ? readings[key] : undefined;
      lines.push(`  ${key.padEnd(10)} ${String(reading).padEnd(8)} -> ${formatGrade(params[key]).padEnd(6)} ${classifications[key] || ''}`);
    });

    lines.push(`  rawAggregate = ${formatGrade(result.rawAggregate)}`);

    if (result.countryGate) {
      lines.push(`  countryGate  = ${result.countryGate.applied
        ? `${result.countryGate.type} -> capped at ${result.countryGate.cap} (was ${formatGrade(result.countryGate.preGateScore)})`
        : 'not applied'}`);
    }

    if (result.severityProtection) {
      lines.push(`  severity     = ${result.severityProtection.applied
        ? `${result.severityProtection.worstClassification} -> capped at ${result.severityProtection.cap} (was ${formatGrade(result.severityProtection.preCapScore)})`
        : `none (worst=${result.severityProtection.worstClassification || 'n/a'})`}`);
    }

    if (result.ceiling) {
      lines.push(`  ceiling      = ${result.ceiling.applied
        ? `99 (was ${formatGrade(result.ceiling.preCeilingScore)})`
        : 'not applied'}`);
    }

    lines.push(`  final = ${result.score}`);
    return { result, lines, text: lines.join('\n') };
  }

  global.explainScore = explainScore;
  if (typeof module !== 'undefined' && module.exports) module.exports = { explainScore };
})(typeof globalThis !== 'undefined' ? globalThis : window);
