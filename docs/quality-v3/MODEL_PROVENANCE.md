# Quality V3 — Model Provenance Record

Authoritative statement of what evidence the current Quality V3 model
version rests on. Written so a future engineer cannot look at this
repository and mistakenly conclude "Quality V3 has been validated."

```
model_version:    quality-v3.0
created_at:       2026-08-10 (commit 33968d9b, 33 minutes after the V2
                   commit d261a780 that preceded it)
formula_version:  src/js/score/production/computeQualityScoreV2.js
                   (ENGINE_VERSION = 'quality-v3.0')
```

## Parameter definitions

See `docs/quality-v3/PARAMETER_EVIDENCE_MATRIX.md` for the full per-parameter
table (centers, breakpoints, slopes, source classification). Summary of
aggregation: unweighted arithmetic mean of 6 parameter scores (ph, tds,
turbidity, orp, chlorine, do), each weight = 1, single `Math.round` at the
end. `temp`, `ec`, `doPercent`, `totalChlorine` are collected but not scored.

## Evidence datasets

```
calibration dataset:  [CASE-1328]                (1 real sample)
validation dataset:   []                          (none)
holdout dataset:      []                          (none)
```

See `docs/quality-v3/evidence-registry.json` for the machine-readable record.
Synthetic fixtures (`SYNTHETIC-CASE-B`, `SYNTHETIC-LADDER-FIXTURES`) exist
for regression/monotonicity testing only and are explicitly excluded from
all three datasets above — see `docs/quality-v3/CALIBRATION_WORKFLOW.md` §3.

## Explicit evidence statement

```
calibration evidence:
    Case 1328 only

validation evidence:
    none

holdout evidence:
    none

outcome-labelled samples:
    zero
```

No sample anywhere in this repository has a lab result, technician
assessment, customer-confirmed outcome, or regulatory classification
attached (`reference_result`, `technician_assessment`, `customer_assessment`,
`regulatory_status`, and `outcome_label` are all `null` for every record in
`evidence-registry.json`). This means no accuracy, sensitivity, or
generalization claim can currently be made about Quality V3 against any
external ground truth — only internal consistency claims (determinism,
monotonicity, continuity), which are a separate and much weaker property
than validity.

## Known limitations

- Calibration and the only real evidence sample are not independent (see
  `CASE_1328_RECLASSIFICATION.md`) — this is a generalization risk, not a
  correctness bug.
- Several curve breakpoints/slopes have no documented source at all (see
  `PARAMETER_EVIDENCE_MATRIX.md`) — only curve **centers** have any
  in-repo rationale, and even those are prose assertions, not linked
  external sources.
- ORP's 200–600 mV band is shared byte-for-byte across all 5 country
  benchmark engines with no independent per-country derivation — see
  `docs/QUALITY_V3_MODEL_SPECIFICATION.md` §4 (repo-root `docs/`).
- The single-catastrophic-parameter aggregation behavior (one parameter at
  a dangerous extreme + five near-ideal → Quality still in the 80s,
  Compliance only downgrades to WARNING) is mathematically expected under
  equal-weight averaging and is an open product decision, not a bug — see
  `UNRESOLVED_DECISIONS.md`.

## Unresolved product decisions

Explicitly not decided by this or any prior boundary-hardening pass — see
`UNRESOLVED_DECISIONS.md` for full detail:

- Safety aggregation model (equal-weight average vs. weighted vs. hard
  safety gate vs. hybrid vs. nonlinear)
- pH model shape (pass-window vs. distance-decay)
- TDS ideal center and breakpoints
- Turbidity ideal center and breakpoints
- ORP provenance/model (shared constant vs. genuine per-country derivation)
- Chlorine curve shape (currently a discontinuous mix of distance-from-center
  and raw-value branches)
- DO ideal center and upper physical-plausibility semantics (the plausibility
  *guard* is handled at the input-validation layer, per
  `src/js/score/validation/measurementValidator.js`; the *ideal* value 8.0
  itself remains an undocumented expert decision)
- Customer-facing Quality vs. Safety language (current copy uses "safe" /
  "meets international standards" bound to the Quality score band, not to
  the separate Compliance channel)

## Readiness

```
READY FOR CALIBRATION:      NO
NOT READY FOR CALIBRATION:  YES
```

Reason: 1 real sample, 0 independent validation samples, 0 holdout samples,
0 outcome labels. See `docs/quality-v3/CALIBRATION_WORKFLOW.md` §6 for the
minimum evidence required before this readiness status can change.
