/** Thailand benchmark — display ranges & compliance limits (local Pass/Fail).
 * PD-008 (2026-08-13): TH-CHLORINE-BAND — NO SAFE NUMERIC CHANGE.
 * DoH residual note is 0.2–0.5 mg/L at pipe end for surveillance — not proven
 * as a mandatory legal Pass/Fail band for this Compliance Index. Upper 2.0 has
 * NO CITATION. Band 0.2–2.0 remains PROJECT-DEFINED / CONFLICTING (keep numbers;
 * do not claim verified Thai regulatory Ideal). */
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
  ph: Object.freeze({ min: 6.5, max: 8.5 }),
  tds: Object.freeze({ passMax: 1000, softStart: 1000, softEnd: 1500 }),
  chlorine: Object.freeze({
    min: 0.2,
    max: 2.0,
    // Provenance (PD-008): numbers unchanged; semantics explicit.
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
  turbidity: Object.freeze({ passMax: 5, softEnd: 12 }),
  orp: Object.freeze({ min: 200, max: 600 }),
  do: Object.freeze({ unbounded: true }),
  temp: Object.freeze({ unbounded: true })
});
