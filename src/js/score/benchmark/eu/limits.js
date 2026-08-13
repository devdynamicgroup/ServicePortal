/** EU benchmark — parametric / indicator oriented limits.
 * PD-008 (2026-08-13): EU-CHLORINE-BAND — NO SAFE NUMERIC CHANGE.
 * Free-chlorine 0.1–0.5 is PROJECT-DEFINED (not Directive 2020/2184 residual).
 * gateCapOnChlorineFail = 65 remains PD-002 PROJECT RULE / UNSUPPORTED ANCHOR. */
window.EuBenchmarkLimits = Object.freeze({
  display: Object.freeze({
    ph: '6.5 - 9.5',
    tds: '<= 500 mg/L',
    chlorine: '0.1 - 0.5 mg/L (project band)',
    turbidity: '<= 1 NTU',
    orp: '200 - 600 mV',
    do: '>= 6 mg/L',
    temp: '<= 25°C'
  }),
  ph: Object.freeze({ min: 6.5, max: 9.5 }),
  tds: Object.freeze({ displayMax: 500, steepAfter: 500 }),
  chlorine: Object.freeze({
    min: 0.1,
    max: 0.5,
    minProvenance: 'project-defined',
    maxProvenance: 'project-defined',
    directiveFreeChlorineResidual: false
  }),
  turbidity: Object.freeze({ ideal: 1, hardFail: 4 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ min: 6 }),
  temp: Object.freeze({ max: 25 }),
  gateCapOnChlorineFail: 65,
  gateCapProvenance: 'project-defined-pd-002',
  gateCapEvidenceClass: 'UNSUPPORTED'
});
