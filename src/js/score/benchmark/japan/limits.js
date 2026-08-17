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
  // 2026-08-17 (PO-approved, evidence: MHLW 快適水質項目/comfortable water
  // quality target sets turbidity aesthetic target at half the legal
  // standard — 1 NTU vs the 2 NTU legal limit (JICA/NIPH sources). ideal=2
  // remains the legal compliance/PASS boundary (unchanged); excellentMax=1
  // is the new inner "true ideal" grade-100 threshold. passEdgeGrade is the
  // grade at the 2 NTU compliance edge (still PASS, quality clearly lower) —
  // project-chosen steepness, not itself cited, mirroring the Thailand
  // chlorine noticeable-band precedent (PASS classification does not imply
  // a high grade).
  turbidity: Object.freeze({ excellentMax: 1, ideal: 2, passEdgeGrade: 40, steepEnd: 6 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ min: 5 }),
  temp: Object.freeze({ max: 30 })
});
