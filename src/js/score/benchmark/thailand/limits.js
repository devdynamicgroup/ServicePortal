/** Thailand benchmark — display ranges & compliance limits (local Pass/Fail).
 * PD-008 (2026-08-13): TH-CHLORINE-BAND — NO SAFE NUMERIC CHANGE to Cl 0.2–2.0.
 * PD-015 (2026-08-14): ordinary-band excellent inners narrowed (PROJECT-DEFINED).
 * Outer compliance ceilings unchanged. See PD-015-THAILAND-CALIBRATION-SPEC.md. */
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
    // PD-015: preferred / excellent inner inside the compliance band.
    preferredMin: 6.8,
    preferredMax: 7.8,
    // Grade at pass edge when inside pass but outside preferred.
    edgeGrade: 85
  }),
  tds: Object.freeze({
    passMax: 1000,
    softStart: 1000,
    softEnd: 1500,
    // PD-015: ordinary-band resolution (was 300).
    gradeExcellentMax: 80,
    // Points lost from excellentMax → passMax (was 25).
    inBandDecline: 60
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
    })
  }),
  turbidity: Object.freeze({
    passMax: 5,
    softEnd: 12,
    // PD-015: ordinary-band resolution (was 1).
    gradeExcellentMax: 0.3,
    // Points lost from excellentMax → passMax (was 40).
    inBandDecline: 50
  }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ unbounded: true }),
  temp: Object.freeze({ unbounded: true })
});
