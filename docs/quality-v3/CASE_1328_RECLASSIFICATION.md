# Case 1328 — Reclassification

**No measurement value in Case 1328 is changed by this document.** This is
a classification correction only, so that the repository cannot be read as
claiming independent validation where none exists.

## Classification

```
Case 1328
= historical calibration/reference fixture
= NOT independent validation evidence
= NOT holdout evidence
= cannot be used to claim generalization
```

Registered as such in `docs/quality-v3/evidence-registry.json`
(`sample_id: "CASE-1328"`, `partition: "CALIBRATION"`).

## Why

Reconstructed from git history (`git log --follow -p -- src/js/score/production/computeQualityScoreV2.js` and related commits):

1. **The sample predates the model it is now used to describe.** Case 1328's
   readings (`ph:7.79, tds:92, turbidity:0.12, orp:434.1, do:6.34,
   chlorine:0.3, temp:28.06`) were first introduced in an earlier commit
   (`750ba466`, eligibility work) — before Quality V2 or V3 existed.

2. **Quality V2 was introduced *and* its test assertions were rewritten in
   the same commit.** Commit `d261a780` ("fix(score): calibrate quality
   score to separate pass from near-ideal") created
   `computeQualityScoreV2.js` from scratch **and**, in that same commit,
   edited `tests/score/case-1328-calibration-baseline.test.js`, changing
   the assertion from "Production Case 13.28 = 100" to "Quality V2 Case
   13.28 < 100." The model and the test expectation around this sample
   were authored together, by the same author, in the same change.

3. **Quality V3 followed 33 minutes later.** Commit `33968d9b` ("feat(score):
   quality-v3 calibration...") rewrote the majority of the file's curves,
   still using Case 1328 as the only real reference point, in the same
   short working session.

4. **Therefore the model and the test outcome are not independent.** A test
   that says "Case 1328 scores under 96" is not evidence that the model is
   correct — it is a record of what the model was tuned to produce for this
   one sample. Treating that assertion as validation would be circular: the
   number the test checks for is the number the author chose while writing
   the curve, using this exact sample as the reference.

## What this does NOT mean

- It does not mean Case 1328 is unreliable data — it is real, field-observed
  measurements, and remains useful as a **regression anchor**: if a future
  change to the frozen formula moves this sample's score, that is a
  meaningful signal that the formula changed, which is exactly why the
  existing test (`tests/score/case-1328-calibration-baseline.test.js`,
  unmodified) is worth keeping.
- It does not mean the sample must be deleted, renamed, or hidden.
- It does not mean the current curve shapes are wrong — only that this
  sample cannot be cited as evidence that they are right.

## What would change this classification

Per the partition rule in `docs/quality-v3/CALIBRATION_WORKFLOW.md`, Case
1328 can never be promoted to validation or holdout status for
`quality-v3.0` — it has already been used to shape that model version. A
**new**, independently collected sample, frozen and never inspected during
calibration of a **future** model version, would be eligible to serve as
validation or holdout evidence for that future version.
