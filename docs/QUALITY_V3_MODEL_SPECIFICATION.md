# Quality V3 Model Specification

Authoritative documentation for `src/js/score/production/computeQualityScoreV2.js`
(engine version `quality-v3.0`). This file exists to make explicit what the
model means, what evidence backs each constant, and what it does not yet
prove — none of which was previously written down anywhere but a single code
comment. Written as part of a boundary-hardening pass; **no scoring constant
described here was changed by that pass.**

## 1. Model status (read this first)

```
model_status:       PROVISIONAL
validation_status:  INSUFFICIENT_EVIDENCE
calibration_status: NOT_VALIDATED
```

The repository currently contains **one** unique real measurement profile
("Case 1328" — see `tests/eligibility/score-vs-publish-eligibility.test.js`,
commented `real meter values observed on Score UI`) and **zero**
outcome-labelled samples (no record anywhere ties a set of readings to a
lab result, technician judgment, or customer-confirmed outcome). Case 1328
was used to shape the V2→V3 calibration (both versions were authored and
the test assertions rewritten in the same short session — see git history
of `computeQualityScoreV2.js`), so it is a calibration anchor, not an
independent validation sample.

**Quality V3 must not be interpreted as a scientifically validated safety
probability or regulatory compliance score.** It is a deterministic,
internally consistent "distance from a preferred target" index whose
specific centers and breakpoints are documented below as either standard-
adjacent, internally-derived, or undocumented — never as independently
validated.

## 2. What the three channels mean (read before touching UI copy)

```
Compliance   = Does the measurement satisfy the applicable standard?
               PASS / WARNING / FAIL. Uses the wide former-production/WHO
               bands (evaluateCompliance() in this file).

Quality      = How close is the measurement to the product's preferred
               "near-ideal" target? 0-100. Distance-from-center curves,
               deliberately stricter than Compliance in several places.

Safety       = Not a separate computed channel today. Compliance FAIL is
               the closest existing signal, and per the audit it is not
               currently guaranteed to be equally prominent, or equally
               durable, alongside the Quality number (see §5).
```

Hard rules, stated explicitly because nothing enforced them before this doc:

- `Compliance PASS` **≠** `Quality 100`. A sample can pass every compliance
  band and still score well under 100 on Quality (Case 1328 itself: all 5
  country benchmarks and legacy DWQI score it 100; Quality V3 scores it 92).
- `Quality 100` **≠** a safety guarantee. Quality measures closeness to an
  internally-chosen ideal, not risk.
- `Quality 85` **≠** "85% safe". There is no percentage-safety semantic
  anywhere in this model; reading the number that way is a category error
  the UI copy does not currently prevent (see §5).

## 3. Parameter provenance registry

Source categories used below: `DIRECT_STANDARD`, `DERIVED_FROM_STANDARD`,
`INTERNAL_LEGACY_CONSTANT`, `EXPERT_DECISION`, `PRODUCT_DECISION`, `UNKNOWN`.
Nothing is marked `DIRECT_STANDARD`/`EVIDENCE_BACKED` merely because a cited
number is nearby — only the **center** of each curve has any in-repo
rationale; every breakpoint/slope below it is `UNKNOWN` provenance.

| Parameter | Center / Near-Ideal | Breakpoints | Curve type | Weight | Source (center) | Source category | Verified in repo? | Known limitation |
|---|---|---|---|---|---|---|---|---|
| pH | 7.2 | 0.15 / 0.4 / 0.8 / 1.3 / 1.8 (`\|Δ\|`) | Distance-from-center | 1 | "midpoint of common 6.5–8.5 acceptability band" | `DERIVED_FROM_STANDARD` (center only) | Band named, not linked/sourced | Standards generally use a pass-window (inside range = pass), not distance-from-center; this design choice is undocumented beyond the center rationale |
| TDS | ≤80 | 120 / 200 / 300 / 500 / 1000 | One-sided ramp from ideal | 1 | "Japan complementary residue preference (30–200)... EPA SMCL 500" | `DERIVED_FROM_STANDARD` (center only, self-acknowledged stricter than cited values) | Cited standards not linked/verifiable | 80 is well below the cited EPA SMCL 500 and even below the low end some cited ranges call acceptable — intentional, but not documented as a product decision outside this file |
| Turbidity | ≤0.08 | 0.2 / 0.5 / 1.0 / 3.0 / 5.0 | One-sided ramp | 1 | "stricter than former ≤1 plateau and under EU plant operational ref 0.3 NTU (ops ≠ Ideal)" | `EXPERT_DECISION` | Comment itself flags "ops ≠ Ideal" — i.e. explicitly not a standards citation | Same shape-choice gap as TDS |
| ORP | 400 | 25 / 70 / 130 / 200 (`\|Δ\|`) | Distance-from-center | 1 | "midpoint of former operational 200–600 **(no external Ideal)**" | `INTERNAL_LEGACY_CONSTANT` | Self-admitted no external source | The identical 200–600 mV band is also copy-pasted byte-for-byte across all 5 country benchmark engines (`thailand/japan/who/eu/usEpa` `limits.js`) — see §4 |
| Chlorine (free) | 0.30 | 0.025 / 0.08 / 0.15 / 0.22, plus raw-value branches below 0.1 and up to 2.0 | Mixed distance-from-center + raw-value branches (structurally the most complex curve in the file) | 1 | "midpoint of former Prod residual 0.2–0.5" | `INTERNAL_LEGACY_CONSTANT` | Derived from a prior internal constant, not an external standard | Curve has a discontinuous branch structure; no documented rationale for the specific branch boundaries |
| DO | ≥8.0 | 7.2 / 6.5 / 6.0 / 5.0 / 3.0 | One-sided ramp, **no upper bound** | 1 | "Near-Ideal ≥8.0; ≥6.0 is Compliance floor (~68), not exceptional" | `EXPERT_DECISION` | Not linked to an external source | No physical ceiling in this file — hardened upstream, not here (see §6) |

Aggregation: unweighted arithmetic mean of all 6 parameter scores, single
`Math.round` at the end (`weights: {ph:1, tds:1, turbidity:1, orp:1,
chlorine:1, do:1}`). `temp`, `ec`, `doPercent`, `totalChlorine` are
collected but explicitly `notScored`.

## 4. ORP: shared operational constant, not five independent standards

`{min:200, max:600}` and the scoring formula built on it are byte-identical
across `src/js/score/benchmark/{thailand,japan,who,eu,usEpa}/limits.js` and
`score.js`. There is no per-country derivation anywhere in the repository.

**This must be represented honestly as:**

```
ORP = SHARED_OPERATIONAL_CONSTANT
```

not as five independently-sourced national standards. This is a
documentation correction only — the benchmark engines are not modified by
this pass (they are frozen), and no code deduplication was performed,
since that would require proving behavioral equivalence and adding
regression coverage across 5 files for a finding that is about honesty of
representation, not a functional bug.

## 5. Known gap: customer-facing copy

`src/js/i18n.js` binds language like *"Your water meets international
standards. Clean and balanced at every tap"* (`score.msg.excellent`, ≥80)
and *"Clean, safe water for daily use"* (`score.msg.goodDetail`, ≥60)
directly to the Quality V3 numeric band — not to the separate Compliance
channel. A user can reasonably read a Quality score as a safety/standards
claim even though the model computes distance-from-ideal.

This is flagged here as a **known gap requiring a product/brand decision**.
No i18n strings were changed in this pass — rewriting persuasive customer
copy is outside a boundary-hardening change and needs sign-off on the
replacement wording, not an engineering judgment call.

## 6. Input contract (hardened separately from this file)

This file's own coercion (`Number(readings.x)` + `Number.isFinite`) is
unchanged and remains the last line of defense, but the primary hardening
lives upstream in `src/js/score/validation/measurementValidator.js`, which
the client-side readings pipeline (`resolveScoreReadings` in
`src/js/flows/score.js`) now runs before any reading reaches this file or
any benchmark engine. It rejects non-numeric-coercible values (`null`,
`""`, booleans, arrays — previously silently turned into `0`/`1` by bare
`Number(x)`) and flags physically-implausible values (e.g. `DO=1000`,
`ORP=5000`) as `IMPLAUSIBLE`, stripping them so this file's existing
`incomplete: true` branch is what actually handles them — no change was
needed inside this file for that to work. The plausibility bounds there are
explicitly `PROVISIONAL` / `INPUT_PLAUSIBILITY_GUARD` — wide,
sensor-impossibility-only guards, never quality judgments, and never to be
confused with the ideal/breakpoint curves in §3.

## 7. Unresolved decisions (not addressed by this pass)

These require a product and/or scientific decision, not an engineering
judgment call, and remain open:

- Safety aggregation model — should a single catastrophic parameter be able
  to average out to a mid-80s Quality score? (average-only vs. weighted vs.
  hard safety gate vs. hybrid score+compliance vs. nonlinear aggregation)
- pH: pass-window vs. distance-decay as the fundamental curve shape.
- TDS / Turbidity / ORP / DO ideal centers and every breakpoint/slope in §3.
- Chlorine's discontinuous branch structure — simplify or justify as-is.
- Whether/how the Compliance channel should visually out-rank the Quality
  number in the UI when they disagree (currently Quality is the hero number
  everywhere; Compliance is a secondary line).

## 8. Future evidence-acquisition plan

Before any constant in §3 is recalibrated, the following must exist:

**Minimum per-sample structure:**
```
sample_id, date, source/context, ph, tds, turbidity, orp, chlorine, do,
lab/reference result (if available), technician assessment (if available),
regulatory pass/fail
```

**Split:** calibration set ≠ validation set ≠ holdout set — never tune and
validate on the same samples. Case 1328 must not be retroactively relabeled
as a holdout; it was already used to tune V2→V3.

**Evidence required per parameter before changing it:**

| Parameter | Evidence needed |
|---|---|
| pH | Real samples spanning ~6.0–9.0+ with technician/lab quality judgments, to decide pass-window vs. decay shape |
| TDS | Samples spanning ~50–1000+ ppm with outcome labels, to test whether the ≤80 ideal tracks any real preference signal |
| Turbidity | Samples in the 0–5 NTU range with paired technician/customer assessments |
| ORP | Either genuine per-country regulatory sourcing, or an explicit decision to keep treating it as one shared constant |
| Chlorine | Samples across the existing branch boundaries (0.1, 0.22, 1.0) to check whether the curve shape reflects anything real |
| DO | Real sensor readings including edge/error cases, to set a defensible upper bound and confirm 8.0 mg/L as the right ideal |

A safety-model decision (aggregation approach, listed in §7) must also be
made explicitly before recalibration — it is a precondition, not a
byproduct, of picking new numbers.
