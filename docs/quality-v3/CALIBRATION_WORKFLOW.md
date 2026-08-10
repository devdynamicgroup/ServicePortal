# Quality V3 — Calibration Workflow & Anti-Overfitting Discipline

This document is the required process for any future Quality V3
recalibration. **No recalibration is happening now** — this defines the
rules for when it eventually does.

## 1. Four categories that must never be conflated

```
A. Calibration data
   Data allowed to influence model parameters.

B. Validation data
   Data used to evaluate a model AFTER calibration. Parameters must not
   change in response to validation results beyond deciding "revise and
   recalibrate" vs. "accept" — validation data is never fed back into the
   curve directly.

C. Holdout data
   Data that must remain completely untouched — not even inspected — until
   the final evaluation of a frozen candidate model.

D. Regression fixtures
   Existing deterministic fixtures (synthetic or real) used only to detect
   accidental code changes to an already-decided formula.
```

Two rules follow directly from this:

> A regression fixture is NOT validation evidence.

> A case used to choose a threshold cannot later be described as an
> independent validation case.

Both rules are violated by the current repository's only real sample (Case
1328) if it is ever cited as evidence of correctness — see
`CASE_1328_RECLASSIFICATION.md`. They are enforced going forward by the
registry integrity checks in `scripts/quality-v3/evidenceRegistry.js`.

## 2. The partition rule

```
CALIBRATION
    ↓
MODEL PARAMETERS MAY CHANGE

VALIDATION
    ↓
MODEL PARAMETERS MUST NOT CHANGE
    ↓
evaluate performance

HOLDOUT
    ↓
never inspect during calibration
    ↓
final generalization check
```

**Once a sample has been used to modify a center, breakpoint, slope,
weight, aggregation, or threshold, that sample is permanently considered
calibration data for that model version.** It cannot later be promoted to
validation or holdout — no matter how a subsequent test assertion is
worded. This is enforced programmatically: `assertPartitionIntegrity()` in
`scripts/quality-v3/evidenceRegistry.js` throws if a record claims both
`used_for_calibration` and `used_for_holdout`, or both
`used_for_calibration` and `used_for_validation`.

## 3. Synthetic data stays labeled

Synthetic fixtures remain useful for deterministic testing, boundary
testing, monotonicity testing, and regression testing. They must never be
represented as field evidence, calibration evidence, validation evidence,
or scientific outcome evidence. Every synthetic entry in
`evidence-registry.json` carries `source_type: "SYNTHETIC"` and
`partition: "REGRESSION_ONLY"` — the registry loader rejects any record
missing an explicit `source_type` rather than defaulting it (see test #5 in
`tests/evidence/evidence-framework.test.js`), so a synthetic fixture can
never accidentally end up classified `REAL`.

## 4. The anti-pattern this framework exists to prevent

```
BAD (what happened for V2 → V3):

Case 1328
    ↓
observe score
    ↓
change DO ideal
    ↓
observe score
    ↓
change pH width
    ↓
observe score
    ↓
write assertion
    ↓
declare calibration successful
```

```
GOOD (the only accepted future workflow):

collect independent dataset
        ↓
freeze validation/holdout
        ↓
calibrate on calibration subset ONLY
        ↓
evaluate frozen model against validation
        ↓
inspect errors
        ↓
only then revise
        ↓
repeat with a NEW frozen validation split
        ↓
evaluate holdout EXACTLY ONCE, at the very end
```

A future model change must never use the holdout result and then claim
that same result as independent evidence of generalization.

## 5. Required future calibration workflow (step by step)

```
1. Collect raw real samples
2. Freeze raw evidence (append-only to evidence-registry.json; never edit
   a sample's measurements after it is recorded)
3. Attach provenance (source_type, source_context, measurement_timestamp,
   country_context)
4. Attach outcome/reference labels where available (see §8 — kept as
   separate fields, never collapsed into one "truth" value)
5. Partition calibration / validation / holdout BEFORE looking at how any
   candidate model performs on them
6. Freeze validation + holdout (mark used_for_validation /
   used_for_holdout; from that point, assertPartitionIntegrity() blocks
   any calibration use of those records)
7. Fit/recalibrate using calibration samples only
8. Evaluate the frozen candidate against validation
9. Freeze the model candidate (no further parameter changes)
10. Evaluate holdout exactly once
11. Record results in an updated MODEL_PROVENANCE.md for the new version
12. Only then consider release
```

## 6. Minimum evidence before recalibration may begin

Real samples covering (sampling targets to expose the model to variation —
**not** claims about what the "correct" scoring targets are):

```
pH:         6.0 → 9.0+
TDS:        50 → 1000+
Turbidity:  0 → 5+ NTU
ORP:        instrument-valid operational range
Chlorine:   below / inside / above the current branch boundaries (0.1, 0.22, 1.0)
DO:         low oxygen → normal → high saturation/error cases
```

Per-sample structure (matches `evidence-registry.json`'s schema):

```
sample_id, source_type, source_context, measurement_timestamp,
country_context, measurements {ph, tds, turbidity, orp, chlorine, do, temp},
reference_result, technician_assessment, customer_assessment,
regulatory_status, outcome_label, used_for_calibration, used_for_validation,
used_for_holdout, partition, notes
```

## 7. Anti-overfitting checks to support once enough data exists

- **Sensitivity analysis** — how much output changes as each parameter
  moves through realistic ranges.
- **Parameter dominance analysis** — whether one parameter controls a
  disproportionate share of the final score.
- **Leave-one-sample-out evaluation** — once enough real data exists.
- **Cross-validation** — only once the dataset is large enough for it to
  be meaningful; do not fabricate statistical significance from a tiny
  dataset.
- **Holdout evaluation** — mandatory before claiming generalization.
- **Distribution coverage check** — verify calibration data actually spans
  normal, borderline, poor, and extreme conditions, not just clustered
  near one profile (as it currently does, with n=1).

## 8. Outcome information stays disaggregated

Do not collapse multiple outcome signals into one artificial "truth"
field. This is valid, expected evidence and must be kept as separate
labels:

```
regulatory_status:     PASS
technician_assessment: ACCEPTABLE
customer_assessment:   POOR
```

`evidence-registry.json` reflects this with four independent fields
(`reference_result`, `technician_assessment`, `customer_assessment`,
`regulatory_status`) plus a single `outcome_label` reserved for an
explicit, deliberately-defined ground truth if and when the product
decides what that means — never auto-derived from the other four.

## 9. Standards are not training labels

Regulatory standards answer "does this measurement fall inside a
regulatory/pass range?" Quality V3 answers "how close is this measurement
to the model's preferred quality profile?" These are different targets.

```
Do NOT silently turn PASS into QUALITY = 100.
Do NOT silently turn FAIL into QUALITY = 0.
```

...unless a future product/scientific decision explicitly defines that
relationship. Nothing in this framework performs that conversion anywhere.
