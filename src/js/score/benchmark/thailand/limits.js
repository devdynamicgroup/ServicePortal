/** Thailand benchmark — display ranges & compliance limits (local Pass/Fail).
 * PD-008: Cl compliance 0.2–2.0 unchanged.
 * PD-015: excellent inners (pH 6.8–7.8, TDS ≤80, turb ≤0.3) kept.
 * 2026-08-14 ordinary-band severity: piecewise in-pass curves + weakest-link
 * share so ordinary water is not averaged into 90–99. Outer pass ceilings
 * unchanged. */
window.ThailandBenchmarkLimits = Object.freeze({
  display: Object.freeze({
    ph: '6.5 - 8.5',
    tds: '<= 1000 mg/L',
    chlorine: '0.2 - 2.0 mg/L (project band)',
    turbidity: '<= 5 NTU',
    orp: '200 - 600 mV',
    do: 'Not specified',
    temp: 'Not specified'
  }),
  ph: Object.freeze({
    min: 6.5,
    max: 8.5,
    preferredMin: 6.8,
    preferredMax: 7.8,
    // Pass-edge grade (6.5 / 8.5). Preferred inner still 100.
    edgeGrade: 70
  }),
  tds: Object.freeze({
    passMax: 1000,
    softStart: 1000,
    softEnd: 1500,
    gradeExcellentMax: 80,
    goodMax: 150,
    ordinaryMax: 300,
    goodGrade: 84,
    ordinaryGrade: 68,
    passEdgeGrade: 40
  }),
  chlorine: Object.freeze({
    min: 0.2,
    max: 2.0,
    minProvenance: 'project-defined',
    maxProvenance: 'project-defined',
    maxCitationStatus: 'NO CITATION',
    citedSurveillanceResidual: Object.freeze({
      min: 0.2,
      max: 0.5,
      evidenceClass: 'OPERATIONAL',
      context: 'DoH pipe-end surveillance residual — not adopted as this engine Compliance Ideal'
    }),
    noticeableMax: 1.0,
    // 2026-08-17 (PO-approved, evidence: WHO Guidelines for Drinking-water
    // Quality 4th ed. — average person detects chlorine taste/odor at
    // 0.5-1.0 mg/L, an aesthetic threshold distinct from the cited 0.2-0.5
    // ideal residual band above). Steepened from 78 so this range genuinely
    // reads as degraded quality instead of "almost perfect".
    noticeableGrade: 40,
    passEdgeGrade: 10
  }),
  turbidity: Object.freeze({
    passMax: 5,
    softEnd: 12,
    gradeExcellentMax: 0.3,
    ordinaryMax: 1,
    ordinaryGrade: 70,
    passEdgeGrade: 50
  }),
  orp: Object.freeze({
    min: 200,
    max: 600,
    excellentMin: 350,
    excellentMax: 450,
    goodMin: 300,
    goodMax: 500,
    goodGrade: 78
  }),
  // After equal-weight mean: pull 50% toward the weakest scored parameter
  // (2026-08-17, PO-approved; raised from 0.25) so one materially weak
  // parameter has a proportionate effect on the composite instead of
  // being diluted by four unrelated PASS parameters.
  weakestLinkShare: 0.5
});
