/**
 * Utility only — shapes benchmark metadata envelope.
 * Does NOT score parameters or encode country philosophy.
 */
function finalizeBenchmarkMetadata(input) {
  const classifications = input.classifications || {};
  const passedParameters = [];
  const warningParameters = [];
  const failedParameters = [];
  const criticalFailures = [];
  Object.keys(classifications).forEach(param => {
    const c = classifications[param];
    if (c === 'PASS') passedParameters.push(param);
    else if (c === 'WARNING') warningParameters.push(param);
    else if (c === 'FAIL') failedParameters.push(param);
    else if (c === 'CRITICAL') criticalFailures.push(param);
  });
  return {
    engine: input.engine,
    engineKey: input.engineKey,
    score: input.score,
    verdict: input.verdict,
    summary: input.summary,
    passedParameters,
    warningParameters,
    failedParameters,
    criticalFailures,
    reasons: Array.isArray(input.reasons) ? input.reasons : [],
    classifications,
    params: input.params || null,
    statuses: input.statuses || {},
    findings: input.findings || [],
    gated: Boolean(input.gated)
  };
}

function incompleteBenchmarkMetadata(engine, engineKey) {
  return finalizeBenchmarkMetadata({
    engine,
    engineKey,
    score: null,
    verdict: 'Attention',
    summary: 'Insufficient readings to evaluate this benchmark.',
    classifications: {},
    reasons: [],
    params: null,
    statuses: {},
    findings: []
  });
}
