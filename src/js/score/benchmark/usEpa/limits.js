/** US EPA — MCL/SMCL/TT-inspired comparison limits. */
window.UsEpaBenchmarkLimits = Object.freeze({
  display: Object.freeze({
    ph: '6.5 - 8.5',
    tds: '<= 500 mg/L',
    chlorine: '<= 4 mg/L',
    turbidity: '<= 1 NTU',
    orp: '200 - 600 mV',
    do: '>= 6 mg/L',
    temp: '<= 30°C'
  }),
  ph: Object.freeze({ min: 6.5, max: 8.5 }),
  tds: Object.freeze({ smcl: 500 }),
  chlorine: Object.freeze({ min: 0.2, max: 4.0 }),
  turbidity: Object.freeze({ ttIdeal: 1, steepEnd: 5 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ min: 6 }),
  temp: Object.freeze({ max: 30 })
});
