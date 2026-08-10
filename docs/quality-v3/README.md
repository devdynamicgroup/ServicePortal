# Quality V3 Evidence Framework

This directory is the evidence boundary for Quality V3 (`src/js/score/production/computeQualityScoreV2.js`).
It exists to make it structurally hard to repeat the Case-1328 overfitting
pattern: calibrating a model against one sample, then citing the same
sample's post-hoc test assertions as if they were independent validation.

**Nothing in this directory changes model behavior.** It is pure
documentation and data-governance tooling (`scripts/quality-v3/evidenceRegistry.js`
has zero dependency on any scoring engine — see the accompanying test suite).

## Contents

- [`evidence-registry.json`](evidence-registry.json) — machine-readable record of every known measurement sample (real or synthetic) and what it has/hasn't been used for.
- [`CASE_1328_RECLASSIFICATION.md`](CASE_1328_RECLASSIFICATION.md) — why Case 1328 is calibration data, not validation evidence, and cannot become holdout evidence.
- [`MODEL_PROVENANCE.md`](MODEL_PROVENANCE.md) — the authoritative record of what evidence Quality V3 `quality-v3.0` currently rests on.
- [`PARAMETER_EVIDENCE_MATRIX.md`](PARAMETER_EVIDENCE_MATRIX.md) — per-parameter (pH/TDS/turbidity/ORP/chlorine/DO) evidence classification.
- [`CALIBRATION_WORKFLOW.md`](CALIBRATION_WORKFLOW.md) — the four evidence categories, the partition rule, the anti-pattern this framework exists to prevent, and the required future workflow.
- [`UNRESOLVED_DECISIONS.md`](UNRESOLVED_DECISIONS.md) — safety-aggregation and customer-copy questions intentionally left open, with candidate options recorded but none selected.

## The one rule that matters most

```
A sample used to change a model parameter is calibration data, permanently,
for that model version. It can never later be described as validation or
holdout evidence — no matter how the test assertions around it are written.
```

See `docs/QUALITY_V3_MODEL_SPECIFICATION.md` (repo root `docs/`) for the
model's parameter-provenance table and known-gap documentation from the
prior boundary-hardening pass — this directory extends that work with the
evidence-partition discipline needed before any future recalibration.
