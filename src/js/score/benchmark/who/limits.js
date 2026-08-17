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
  // 2026-08-17 (PO-approved, evidence: WHO/SDE/WSH/07.01/1 "pH in
  // Drinking-water" background document — "the pH should preferably be
  // less than 8.0" for effective chlorine disinfection). Asymmetric: only
  // an upper ceiling is cited, no lower-bound evidence exists, so the
  // existing flat-100 zone from the legal min (6.5) through the cited
  // ceiling (8.0) is unchanged. edgeGrade (40) at the legal max (8.5) is
  // project-chosen steepness, mirroring the Japan precedent.
  ph: Object.freeze({ min: 6.5, max: 8.5, fairMin: 6, fairMax: 9, poorMin: 5.5, poorMax: 9.5, idealCeiling: 8.0, edgeGrade: 40 }),
  tds: Object.freeze({ ideal: 300, fair: 600, poor: 1000, displayMax: 500 }),
  // 2026-08-17 (PO-approved, evidence: WHO Technical Notes on Drinking-water,
  // Sanitation and Hygiene in Emergencies, Note 11.1-11.4 — "the optimum
  // chlorine residual... is in the range of 0.2 to 0.5mg/l", citing WHO
  // Guidelines for Drinking-water Quality 4th ed. Same WHO taste-threshold
  // evidence already used for Thailand's chlorine curve applied here: the
  // 0.5-1.0 mg/L decline is steepened from the prior flat 80 to a ramp
  // 100->40, then continued to the existing poor(2)=25 floor to preserve
  // monotonic continuity (was a flat-then-flat-then-flat step pattern).
  chlorine: Object.freeze({ idealMin: 0.2, idealMax: 0.5, fair: 1, poor: 2, noticeableGrade: 40, poorGrade: 25 }),
  turbidity: Object.freeze({ ideal: 1, fair: 5, poor: 10 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ min: 6 }),
  temp: Object.freeze({ max: 30 }),
  // 2026-08-17 (PO-approved, weaker than Thailand's 0.5): pulls the raw
  // weighted-mean composite 25% toward the single weakest scored parameter,
  // so one materially weak parameter has a proportionate effect instead of
  // being diluted by five unrelated PASS parameters (same architectural
  // gap Thailand's PD-015 already closed).
  weakestLinkShare: 0.25
});
