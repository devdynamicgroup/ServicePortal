/** Japan national drinking-water criteria (comparison).
 * PD-012 B (2026-08-13): DO is NOT scored in Japan Compliance Index (NOT_EVALUATED).
 * do.min = 5 retained for provenance/compatibility only — not a scored national Ideal;
 * magnitude MUST NOT be replaced or treated as Compliance Index criterion. */
window.JapanBenchmarkLimits = Object.freeze({
  display: Object.freeze({
    ph: '5.8 - 8.6',
    tds: '<= 500 mg/L',
    chlorine: '<= 1 mg/L',
    turbidity: '<= 2 NTU',
    orp: '200 - 600 mV',
    do: 'not evaluated (PD-012 B)',
    temp: '<= 30°C'
  }),
  ph: Object.freeze({ min: 5.8, max: 8.6 }),
  tds: Object.freeze({ displayMax: 500 }),
  chlorine: Object.freeze({ min: 0.1, max: 1.0 }),
  turbidity: Object.freeze({ ideal: 2, steepEnd: 6 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ min: 5 }),
  temp: Object.freeze({ max: 30 })
});
