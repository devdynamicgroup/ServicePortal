/** EU benchmark — parametric / indicator oriented limits. */
window.EuBenchmarkLimits = Object.freeze({
  display: Object.freeze({
    ph: '6.5 - 9.5',
    tds: '<= 500 mg/L',
    chlorine: '<= 0.5 mg/L',
    turbidity: '<= 1 NTU',
    orp: '200 - 600 mV',
    do: '>= 6 mg/L',
    temp: '<= 25°C'
  }),
  ph: Object.freeze({ min: 6.5, max: 9.5 }),
  tds: Object.freeze({ displayMax: 500, steepAfter: 500 }),
  chlorine: Object.freeze({ min: 0.1, max: 0.5 }),
  turbidity: Object.freeze({ ideal: 1, hardFail: 4 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ min: 6 }),
  temp: Object.freeze({ max: 25 }),
  gateCapOnChlorineFail: 65
});
