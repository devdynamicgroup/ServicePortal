/** US EPA — MCL/SMCL/TT-inspired comparison limits.
 * PD-008 (2026-08-13): EPA-CHLORINE-BAND — semantic repair, numbers unchanged.
 * max 4.0 = EPA MRDL (40 CFR 141.65) VERIFIED ceiling.
 * min 0.2 = PROJECT-DEFINED residual floor (NOT an EPA MRDL lower bound).
 * Compliance Index pass window = projectMin..mrdlMax; do not call 0.2–4.0 an EPA Ideal. */
window.UsEpaBenchmarkLimits = Object.freeze({
  display: Object.freeze({
    ph: '6.5 - 8.5',
    tds: '<= 500 mg/L',
    chlorine: '<= 4 mg/L MRDL; project floor >= 0.2',
    turbidity: '<= 1 NTU',
    orp: '200 - 600 mV',
    do: '>= 6 mg/L',
    temp: '<= 30°C'
  }),
  ph: Object.freeze({ min: 6.5, max: 8.5 }),
  tds: Object.freeze({ smcl: 500 }),
  chlorine: Object.freeze({
    min: 0.2,
    max: 4.0,
    projectMin: 0.2,
    mrdlMax: 4.0,
    minProvenance: 'project-defined',
    maxProvenance: 'epa-mrdl-40-cfr-141.65',
    minEvidenceClass: 'PROJECT_DEFINED',
    maxEvidenceClass: 'VERIFIED'
  }),
  turbidity: Object.freeze({ ttIdeal: 1, steepEnd: 5 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ min: 6 }),
  temp: Object.freeze({ max: 30 })
});
