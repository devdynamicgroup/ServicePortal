/** Japan national drinking-water criteria (comparison).
 * PD-012 B (2026-08-13): DO is NOT scored in Japan Compliance Index (NOT_EVALUATED).
 * do.min = 5 retained for provenance/compatibility only — not a scored national Ideal;
 * magnitude MUST NOT be replaced or treated as Compliance Index criterion. */
window.JapanBenchmarkLimits = Object.freeze({
  // 2026-08-18 (PO-approved): display now shows the government "comfortable
  // water" target band actually enforced for PASS (ph/tds/turbidity — see
  // citations below), not the wider legal-minimum band. Chlorine has no
  // official target (see chlorine citation below) so it still shows the
  // legal band.
  display: Object.freeze({
    ph: '7.3 - 7.7',
    tds: '<= 200 mg/L',
    chlorine: '<= 1 mg/L',
    turbidity: '<= 1 NTU',
    orp: '200 - 600 mV',
    do: 'not evaluated (PD-012 B)',
    temp: '<= 30°C'
  }),
  // 2026-08-17 (PO-approved, evidence: 水質管理目標設定項目/comfortable water
  // quality target for pH is cited at approximately 7.5 — two independent
  // municipal water-quality tables (Aichi Prefecture Institute of Public
  // Health; Fukui City) both list "7.5程度". Legal band (5.8-8.6) unchanged.
  // idealMin/idealMax define a narrow window around the cited 7.5 target;
  // window width and the 40 edge grade at 6.7/8.3 (steepEnd) are project-
  // chosen steepness, not themselves cited — mirrors the turbidity/chlorine
  // precedent (PASS does not imply a high grade).
  ph: Object.freeze({ min: 5.8, max: 8.6, idealMin: 7.3, idealMax: 7.7, steepEndLow: 6.7, steepEndHigh: 8.3, edgeGrade: 40 }),
  // 2026-08-17 (PO-approved, evidence: 水質管理目標設定項目/comfortable water
  // quality target for 蒸発残留物 (TDS) is cited at 30-200 mg/L — same two
  // independent municipal sources as pH above. Legal ceiling (500) unchanged.
  // steepEnd/edgeGrade steepness beyond the cited 200 upper bound is
  // project-chosen, not itself cited.
  tds: Object.freeze({ displayMax: 500, idealMin: 30, idealMax: 200, steepEnd: 350, edgeGrade: 40 }),
  // 2026-08-17 (PO-approved): no official MHLW comfortable-water-quality
  // target exists for residual chlorine (confirmed absent from the same
  // 26-item tables cited for pH/TDS/turbidity above) — this ideal window and
  // its edge grade are entirely project-defined, explicitly approved by PO,
  // mirroring the Thailand chlorine noticeable-band precedent and reusing
  // its numeric ideal band (0.2-0.5 mg/L) as a project convention. Legal
  // band (0.1-1.0) unchanged.
  chlorine: Object.freeze({ min: 0.1, max: 1.0, idealMin: 0.2, idealMax: 0.5, edgeGrade: 40, provenance: 'project-defined' }),
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
  temp: Object.freeze({ max: 30 }),
  // 2026-08-17 (PO-approved, weaker than Thailand's 0.5): pulls the raw
  // weighted-mean composite 25% toward the single weakest scored parameter,
  // so one materially weak parameter has a proportionate effect instead of
  // being diluted by four unrelated PASS parameters.
  weakestLinkShare: 0.25
});
