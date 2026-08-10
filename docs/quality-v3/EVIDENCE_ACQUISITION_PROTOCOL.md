# Quality V3 — Evidence Acquisition Protocol

This is the required process for bringing new measurement evidence into the
Quality V3 evidence base. It exists to prevent a second version of the
Case-1328 pattern: seeing a value, adjusting a curve, generating a synthetic
case that "looks reasonable" against the adjusted curve, and then treating
that synthetic case as if it were independent confirmation.

## Hard rule

> **No scoring code (`computeQualityScoreV2.js`, `computeProductionScore.js`,
> any country benchmark engine) may be changed until the evidence base meets
> the readiness criteria in §5.** Collecting evidence is itself explicitly
> **not** a trigger to start adjusting curves — evidence acquisition and
> recalibration are separate, sequential phases (see
> `CALIBRATION_WORKFLOW.md` §5).

This protocol only governs how evidence enters `evidence-registry.json`. It
does not authorize, and must never be read as authorizing, any change to
scoring behavior.

## 1. Who can submit a sample

Anyone with access to a real measurement (technician reading, lab result,
customer-reported meter values) observed independently of any attempt to
test or tune Quality V3.

## 2. What must NOT be submitted as evidence

- A value chosen because it produces a "nice-looking" score.
- A value copied from an existing test fixture, ladder profile, or
  diagnostic script (`.tmp_probe/*.js`, `tests/**/*.test.js`).
- A value invented to fill in a gap in the sampling ranges described in
  `CALIBRATION_WORKFLOW.md` §6, without a real underlying measurement.
- Anything without a plausible provenance story (who measured it, when,
  with what).

## 3. Intake steps

```
1. Take the raw measurement (ph, tds, turbidity, orp, chlorine, do, temp)
   BEFORE looking at what Quality V3 would score it.
2. Fill out docs/quality-v3/SAMPLE_INTAKE_TEMPLATE.json with the reading
   and whatever outcome information is actually available (lab result,
   technician assessment, customer assessment, regulatory status — leave
   any you don't have as null; never fabricate one to fill the gap).
3. Run the novelty + shape check:
     node -e "
       const { validateIntakeCandidate, loadRegistry } = require('./scripts/quality-v3/evidenceRegistry.js');
       const candidate = require('./path/to/your-candidate.json');
       const registry = loadRegistry('./docs/quality-v3/evidence-registry.json');
       console.log(validateIntakeCandidate(candidate, registry.samples));
     "
   This throws if the candidate:
     - fingerprint-matches a known synthetic/regression fixture
       (KNOWN_SYNTHETIC_FINGERPRINTS in evidenceRegistry.js — every ladder
       profile, LOCKED/FULL_READINGS/SAMPLE, DIFF, and every other
       hand-authored test value already used while the model's behavior
       was visible),
     - fingerprint-matches a REAL sample already in the registry under a
       different sample_id,
     - reuses an existing sample_id,
     - or claims a partition (CALIBRATION/VALIDATION/HOLDOUT) without any
       used_for_* flag actually set.
   A passing check means the candidate is *novel*. It does NOT mean the
   candidate is *correct*, *sufficient*, or *ready to use* — those are
   separate judgments made in step 5.
4. If the check throws, the candidate is not new evidence. Do not
   route around the check (e.g. by rounding the numbers slightly) — if a
   value is a near-duplicate of a known fixture, treat that as a signal to
   go find an actually independent measurement, not as an obstacle to work
   around.
5. If the check passes, a human reviewer — not a script — decides:
     a. Does this sample belong to CALIBRATION, VALIDATION, or HOLDOUT?
     b. Once assigned VALIDATION or HOLDOUT, the sample must not be
        inspected again outside its designated evaluation step (see
        CALIBRATION_WORKFLOW.md §5).
   Only after this deliberate decision is the record appended to
   evidence-registry.json (manually — this protocol has no auto-write
   step, by design).
```

## 4. Partition assignment guidance (for the human reviewer in step 5)

- Early samples, while the evidence base is still thin, generally belong in
  **CALIBRATION** — but each one, once assigned, is permanently calibration
  data for the current model version (`CALIBRATION_WORKFLOW.md` §2).
- Once a reasonable calibration set exists (§5 below defines "reasonable"),
  **new, never-before-seen** samples should be split toward VALIDATION and
  HOLDOUT rather than added to an ever-growing calibration set — an
  evidence base with 40 calibration samples and 0 validation samples is not
  meaningfully better validated than one with 5.
- HOLDOUT samples must be selected and frozen (`used_for_holdout: true`)
  **before** any recalibration attempt begins, not after.

## 5. Readiness criteria (when recalibration may be considered)

At minimum, before any scoring code change is even proposed:

```
real samples:                 enough to cover the sampling ranges in
                               CALIBRATION_WORKFLOW.md §6 (normal,
                               borderline, poor, extreme conditions per
                               parameter) — a handful of near-duplicate
                               "normal" readings does not satisfy this
independent validation samples: at least a small set, never used for
                               calibration, per CALIBRATION_WORKFLOW.md §2
holdout samples:               at least one, frozen and uninspected until
                               the final evaluation step
outcome-labelled samples:      at least some — a dataset of measurements
                               with zero outcome information (as today)
                               cannot validate what "quality" should mean,
                               only what a curve currently outputs
```

This repository currently has 1 real sample, 0 validation, 0 holdout, 0
outcome-labelled — see `MODEL_PROVENANCE.md`. The result is
`NOT READY FOR CALIBRATION`, verified programmatically by
`computeEvidenceInventory()`, not asserted by hand.

## 6. What this protocol deliberately does not do

- It does not auto-append anything to the registry — every addition is a
  deliberate, reviewed, human action.
- It does not decide partition assignment for you — that is a judgment
  call the protocol requires be made explicitly, not inferred.
- It does not evaluate whether a sample is "good" or "bad" water — it only
  checks whether a sample is *novel* (not reused from something the model
  author already saw) and *well-formed*.
- It does not touch, require, or reference any scoring engine. Verified by
  `tests/evidence/intake-protocol.test.js`.
