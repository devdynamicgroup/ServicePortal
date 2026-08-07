/** Thailand benchmark — display ranges & compliance limits (local Pass/Fail). */
window.ThailandBenchmarkLimits = Object.freeze({
  display: Object.freeze({
    ph: '6.5 - 8.5',
    tds: '<= 1000 mg/L',
    chlorine: '0.2 - 2.0 mg/L',
    turbidity: '<= 5 NTU',
    orp: '200 - 600 mV',
    do: 'Not specified',
    temp: 'Not specified'
  }),
  ph: Object.freeze({ min: 6.5, max: 8.5 }),
  tds: Object.freeze({ passMax: 1000, softStart: 1000, softEnd: 1500 }),
  chlorine: Object.freeze({ min: 0.2, max: 2.0 }),
  turbidity: Object.freeze({ passMax: 5, softEnd: 12 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ unbounded: true }),
  temp: Object.freeze({ unbounded: true })
});
