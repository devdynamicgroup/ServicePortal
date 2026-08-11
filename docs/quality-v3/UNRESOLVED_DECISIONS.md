# Quality V3 — Unresolved Decisions

Explicitly recorded so no future engineer "fixes" either of these through
an ad-hoc code change. Both require a product decision (and, for the
safety model, evidence per `CALIBRATION_WORKFLOW.md`) before any
implementation. **Nothing below is selected or implemented by this
document.**

## 1. Quality index vs. safety signal

Current behavior (unweighted arithmetic mean of 6 equally-weighted
parameters):

```
one catastrophic parameter
+
five ideal parameters
=
approximately 84–87
```

This is **mathematically expected** under equal weighting — it is not a
bug in the formula, it is what an average does. Whether it is *acceptable
product behavior* is the open question, and it depends entirely on what
Quality V3 is supposed to communicate: a closeness-to-ideal index (where
this behavior is unremarkable) or something closer to a safety signal
(where it likely is not).

Candidate future approaches, recorded without selecting one:

```
A. Equal-weight average (current)
B. Weighted average — some parameters count more than others
C. Hard safety gate — a catastrophic single parameter caps or zeroes the
   overall score regardless of the others
D. Quality + Compliance hybrid — combine the existing separate Compliance
   channel (PASS/WARNING/FAIL) with Quality into one displayed signal
E. Nonlinear aggregation — e.g. geometric mean, min-weighted blend, or
   another function that penalizes outliers more than a simple average
```

Selecting one of these requires: (1) an explicit product decision on what
Quality V3 is supposed to represent, and (2) for anything beyond a pure
product/UX choice, evidence per `CALIBRATION_WORKFLOW.md` — a change to
aggregation is a model-parameter change like any other and falls under the
same calibration/validation/holdout discipline.

**Candidate Product Definition — Status: CANDIDATE, NOT APPROVED**

```
Quality Score = คุณภาพน้ำในสภาวะปกติ (Normal Drinking Water Quality)
                โดยแยกออกจาก Compliance, Outbreak Context, และ
                Health/Safety Ceiling
```

Proposed during the Chlorine >0.5 mg/L review (case study below) as a
candidate answer to this section's central open question. **Not selected,
not implemented, not to be treated as decided.** If approved in a future
session, it would directly resolve the Chlorine >0.5 mg/L placeholder
below (by ruling out using outbreak-allowance or health-ceiling values as
quality-curve anchors) and would narrow candidates A-E above toward
whichever one best represents "distance from normal-condition ideal"
specifically, excluding safety-signal framings (C, and part of D).
Anyone opening this document should read this as: *this is where the
thinking currently stands, not what was decided.*

**Chlorine >0.5 mg/L case study (concrete instance of this same open
question):** an implementation pass proposed anchoring the Quality V3
chlorine curve's upper ramp to WHO's 5.0 mg/L health-based ceiling. This
was reviewed against a 3-option evidence-context decision table (Normal
Drinking Water / Outbreak Context / Health-Based Ceiling, kept separate)
and rejected — it answers "is this safe" (a ceiling question) while being
used to answer "is this good quality" (a target question), inflating
scores for outbreak-context-only concentrations under normal conditions.
No replacement was approved; production currently carries an interim,
explicitly-labeled-as-unapproved placeholder for this range (see
`FINAL_SCORING_IMPLEMENTATION_REPORT.md` status update). **This is the
same unresolved question as this section, seen through one parameter** —
resolving §1 in general would resolve this specific case too, and vice
versa a decision here should be checked for consistency with whatever §1
eventually decides.

**Empirical update:** `DECISION_MATRIX.md` ("New finding 1") computed what
Case A (`CASE-1328`) and Case B (`SYNTHETIC-CASE-B`) would score under
geometric mean, harmonic mean, and a minimum-weighted blend, using the
existing parameter grades — no curve was changed to produce these numbers.
Result: geometric/harmonic mean move Case A by under 1 point (91.64 →
91.17 / 90.65) — candidate `E` as commonly understood ("nonlinear
aggregation") does not by itself address the single-weak-parameter dilution
this section describes. Only a minimum-weighted blend produces a material
shift, and that blend's weighting factor has no evidence behind it either.
This doesn't resolve the decision — it narrows what "candidate E" can
mean if chosen.

## 2. Customer-facing Quality vs. Safety language

`src/js/i18n.js` currently binds language directly to the Quality V3
numeric band, not to the separate Compliance channel:

```
score.msg.excellent (≥80): "Your water meets international standards.
                             Clean and balanced at every tap."
score.msg.goodDetail (≥60): "Clean, safe water for daily use."
```

This is a product-communication risk because:

```
Quality score ≠ regulatory compliance
Quality score ≠ health safety
Quality score ≠ laboratory certification
```

A user reading "85 / Excellent / meets international standards" has no
structural reason to know that number is a distance-from-ideal index built
on one uncalibrated real sample, rather than a safety or compliance claim.

**This document does not propose replacement copy.** Rewriting
persuasive customer-facing text is a product/brand decision requiring
sign-off on the specific replacement wording, not an engineering judgment
call — and is explicitly out of scope for this and prior hardening passes.

## What would resolve these

For #1: a product decision on Quality V3's intended meaning, followed by
evidence-backed aggregation work per `CALIBRATION_WORKFLOW.md` if the
resolution requires a parameter-level change.

For #2: a product/brand decision on replacement copy that accurately
separates Quality, Compliance, and (if introduced) a Safety signal, per the
distinctions documented in `docs/QUALITY_V3_MODEL_SPECIFICATION.md` §2.
