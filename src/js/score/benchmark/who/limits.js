/** WHO benchmark — guideline display & bands (comparison only). */
window.WhoBenchmarkLimits = Object.freeze({
  display: Object.freeze({
    ph: '6.5 - 8.5',
    tds: '<= 500 mg/L',
    chlorine: '0.2 - 0.5 mg/L',
    turbidity: '<= 1 NTU',
    orp: '200 - 600 mV',
    do: '>= 6 mg/L',
    temp: '<= 30°C'
  }),
  ph: Object.freeze({ min: 6.5, max: 8.5, fairMin: 6, fairMax: 9, poorMin: 5.5, poorMax: 9.5 }),
  tds: Object.freeze({ ideal: 300, fair: 600, poor: 1000, displayMax: 500 }),
  chlorine: Object.freeze({ idealMin: 0.2, idealMax: 0.5, fair: 1, poor: 2 }),
  turbidity: Object.freeze({ ideal: 1, fair: 5, poor: 10 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ min: 6 }),
  temp: Object.freeze({ max: 30 })
});
