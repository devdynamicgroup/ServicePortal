# Canonical Score Model V7 — skeleton (Commit B)

**Status:** Isolated simulation only. **Not live. Hero OFF. α / F = TBD.**  
**Does not depend on:** Notion, Render, Case persistence, public tokens, `Latest Water Score`.

```text
Gate A (publication durability)  ≠  Canonical skeleton
Calibration Gate                 ≠  architecture executability
V7 Hero                          = OFF
```

## Pipeline

```text
Readings + BenchmarkProfile
  → completeness (COMPUTABLE | NOT_COMPUTABLE)
  → parameterQuality (NOT_CALIBRATED until curves are evidenced)
  → complianceStatus (NOT_CALIBRATED until limits are evidenced)
  → riskSeverity (separate; never writes finalScore)
  → aggregateQuality → NOT_CALIBRATED  (HYBRID-FAMILY; α/F TBD)
  → qualityScore / finalScore
```

PD-V7-01: `finalScore = qualityScore`  
PD-V7-02: `riskSeverity` is separate  
PD-V7-03: aggregator family is Hybrid; **coefficients are not implemented**

Missing required data → `NOT_COMPUTABLE` (not 0, not 100).  
Complete data with uncalibrated curves → `COMPUTABLE` + `qualityScore = NOT_CALIBRATED`.

## Run

```text
node scripts/simulate-canonical-score.js
node tests/canonical-score/canonical-skeleton.test.js
```

Optional read-only Case mapping (`--case-id=`) never writes and never publishes.

## Non-goals (this commit)

- α / F
- country curve/weight port
- Q-V3 edits
- Hero / UI activation
- Gate A production E2E
