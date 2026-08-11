# Quality V3 — Candidate Scoring Design Review

**Research and proposal only. No code was touched, no number was selected.**
This document exists to put actual candidate values in front of a human
decision-maker, each with its source, rationale, and an honest confidence
rating — including where the honest answer is "no defensible candidate
exists." Selecting any row below is a product/domain decision belonging to
the reader, not this document.

Built on top of `EVIDENCE_BASED_SCORING_AUDIT.md` (external WHO/regulatory
research) and `PARAMETER_EVIDENCE_MATRIX.md` (internal repo provenance).
Where that audit said "NO EVIDENCE — DO NOT LOCK THIS NUMBER," this review
goes one step further: it shows what a candidate would look like *if* one
were built from the best available evidence, so the gap between "no
evidence" and "a real number" is visible and inspectable rather than just
asserted.

---

## How to read the confidence column

- **HIGH** — value is stated directly by a cited authoritative source as a threshold/target.
- **MEDIUM** — the threshold/tier is cited, but translating it into a 0–100 score is a design choice not specified by the source.
- **LOW** — internally consistent (e.g. correct arithmetic) but no independent scientific/regulatory basis for the choice itself.
- **NONE** — no defensible candidate found; row exists to make the absence explicit, not to fill a gap.

---

## pH

| Candidate | Value | Source | Rationale | Confidence |
|---|---|---|---|---|
| **A — Remove the graded curve; pass/fail only** | Inside 6.5–8.5 → uniform score (e.g. 100), no distance decay | WHO Guidelines for Drinking-water Quality, pH fact sheet: "no health-based guideline value is proposed... not considered necessary" | This is the only option WHO's own guidance directly supports. A graded curve implies pH 7.2 is "better" than 6.6 or 8.4 — WHO explicitly does not make that claim | **HIGH confidence that WHO supports A over any graded alternative** |
| **B — Keep graded curve, correct the center to the actual midpoint** | Center = 7.5 | Arithmetic correction of the code's own cited rationale ("midpoint of 6.5–8.5") | Fixes the math error found in `EVIDENCE_BASED_SCORING_AUDIT.md` §Step 6, but inherits the same lack of scientific basis for grading at all | LOW — internally consistent, not evidence-based |
| **C — Keep graded curve, center on chemical neutrality** | Center = 7.0 | General chemistry convention (pH 7 = neutral at 25°C) | A different, equally-common convention; not specific to drinking-water quality preference | LOW — plausible convention, not a water-quality-specific source |
| **D — Keep current (7.2, current breakpoints)** | Center = 7.2, current slopes | No change | Preserves current behavior exactly; the tradeoff is keeping a center whose only stated rationale is mathematically wrong | LOW — same as before, now with the error documented rather than hidden |

---

## TDS

| Candidate | Value | Source | Rationale | Confidence |
|---|---|---|---|---|
| **A — Adopt WHO's 5-tier palatability scale as breakpoints** | <300 / 300–600 / 600–900 / 900–1200 / >1200 mg/L | WHO Guidelines for Drinking-water Quality, TDS fact sheet, explicit "excellent/good/fair/poor/unacceptable" tiers | These are WHO's own named tiers — the strongest-sourced breakpoint set found for any parameter in this review. What score (0–100) to assign each tier is not specified by WHO and remains a design choice | MEDIUM — tier locations HIGH, score-per-tier mapping is undetermined |
| **B — Illustrative score mapping for Candidate A** (shown only to make the design choice visible, not a proposal) | <300→100, 300–600→ramp to 80, 600–900→ramp to 55, 900–1200→ramp to 30, >1200→declining | Same WHO tiers as A, scores invented purely to illustrate what "adopting the tiers" would look like | Demonstrates the gap between "we have the tiers" and "we have a scoring function" — the numeric mapping itself would need its own sign-off | LOW — the tier locations are sourced, the specific scores attached to them are not |
| **C — Keep current strict ideal (≤80), reframe honestly** | Center = 80, current slopes | Japan drinking-water standard, "Residue on evaporation" complementary item, cited target range 30–200 mg/L (verified this pass) | The citation is real, but note it: (1) is a "complementary/management" item, not Japan's core health-based limit, and (2) the current ≤80 sits at the strict low end of that 30–200 range, stricter than the range's own target framing | LOW-MEDIUM — real citation exists, but the specific cutoff is a product choice layered on top of it |

---

## Turbidity

| Candidate | Value | Source | Rationale | Confidence |
|---|---|---|---|---|
| **A — Center at WHO's specific disinfection-effectiveness figure** | Ideal ≤0.1 NTU | WHO: "turbidity should be kept... ideally below 0.1 NTU for effective disinfection" | Most directly-sourced center of any parameter in this whole review — a specific number, from a named authority, tied to a stated mechanism (disinfection efficacy) | **MEDIUM-HIGH** — the single strongest candidate in this document |
| **B — Keep current (≤0.08 NTU)** | Center = 0.08 | Code comment: "stricter than former ≤1 plateau... under EU plant operational ref 0.3 NTU" | Already close to Candidate A's WHO-sourced figure; slightly stricter with no specific justification for the extra 0.02 NTU of strictness | LOW-MEDIUM — directionally aligned with A, exact value not independently derived |
| **C — Secondary tier at WHO's general acceptability threshold** | ~1.0 NTU as a "still acceptable" boundary further down the curve | WHO: "<1 NTU generally" (the broader, non-"ideal" statement) | Gives the curve a second WHO-anchored point beyond the center, rather than only unsourced intermediate breakpoints (0.2/0.5/3.0/5.0 remain unsourced either way) | MEDIUM for the boundary's location; the ramp shape between 0.1 and 1.0 remains a design choice |

---

## ORP

| Candidate | Value | Source | Rationale | Confidence |
|---|---|---|---|---|
| **A — Remove the graded quality curve entirely; keep as compliance-only or informational** | N/A (no scored curve) | No authoritative drinking-water source found for ORP as a graded quality signal, confirmed by two independent searches (internal repo audit + external WHO/regulatory search) | If no source exists for any value, the more defensible design choice is not to imply precision that doesn't exist, rather than pick any specific replacement center | Structural option — **not a number**, so "confidence" doesn't apply the same way; but the case for *not* scoring ORP gradedly is the strongest-supported option in this row |
| **B — Keep current (center 400, distance-decay)** | Center = 400 mV | Code comment: "midpoint of former operational 200–600 (no external Ideal)" — self-admitted | No change; the honest label is already "no external ideal" in the code itself | **NONE** — no evidence exists for this value or any alternative |

---

## Free Chlorine

| Candidate | Value | Source | Rationale | Confidence |
|---|---|---|---|---|
| **A — Floor/target/ceiling structure from WHO's actual cited figures** | Floor 0.2 mg/L (minimum at delivery), target ≥0.5 mg/L (post-contact-time disinfection effectiveness), health ceiling 5 mg/L, outbreak range 0.5–1.0 mg/L | WHO Guidelines for Drinking-water Quality, chlorine fact sheet — all four figures stated directly | These are real, specific, WHO-cited thresholds — stronger sourcing than any "ideal center" framing, but they describe a **floor + conditional target + ceiling**, not a symmetric "distance from center" shape the current curve uses | MEDIUM-HIGH for the four cited values themselves; LOW for how to turn a floor/target/ceiling structure into a continuous 0–100 curve, since WHO doesn't specify that either |
| **B — Keep current band (0.2–0.5), correct the center to the actual midpoint** | Center = 0.35 | Arithmetic correction of the code's own cited rationale ("midpoint of 0.2–0.5") | Fixes the same kind of math error found for pH; the band itself (0.2–0.5) is WHO-aligned even though a symmetric center within it is not something WHO specifies | LOW for the center specifically — band MEDIUM, center itself not WHO-derivable either way |
| **C — Keep current (0.30, current branches)** | Center = 0.30, current mixed branches | No change | Preserves current behavior; inherits both the math-error rationale and the undocumented cliff at 0.08 mg/L (`EVIDENCE_BASED_SCORING_AUDIT.md` §Step 6) — that cliff is a **separate decision** from the center value regardless of which candidate is chosen here | LOW, and the cliff question is orthogonal to whichever center is picked |

---

## DO

| Candidate | Value | Source | Rationale | Confidence |
|---|---|---|---|---|
| **A — Remove from Quality scoring; keep as a non-scored/informational reading** | N/A (no scored curve) | DO is not a WHO or any national drinking-water regulatory parameter found in this review — it belongs to surface-water/aquatic-life frameworks, not potable-water delivery standards | Same structural logic as ORP: if the parameter itself isn't a recognized drinking-water quality signal, scoring it gradedly implies a precision/authority that doesn't exist | Structural option — the strongest-supported choice in this row is *not* to score it as a graded quality dimension |
| **B — Keep current (ideal ≥8.0, no upper bound)** | Center = 8.0 mg/L | Code comment: "Near-Ideal ≥8.0" — no linked source | The externally-circulating "6.5–8 mg/L healthy" figures found in this review trace to commercial water-sensor vendor blogs, not government/scientific sources — not a stronger basis than the current unlinked comment | **NONE** — no evidence exists for this value or any alternative |

---

## Cross-cutting items not tied to a single parameter

| Item | Note |
|---|---|
| Aggregation (equal-weight arithmetic mean) | **Out of scope for this review** — remains LOCKED per the standing instruction across every pass of this audit series |
| Chlorine cliff at 0.08 mg/L (Quality V3) | A **structural** decision, independent of which chlorine center candidate (A/B/C above) is chosen — see `EVIDENCE_BASED_SCORING_AUDIT.md` §Step 6 for the full mechanism |
| Country-engine plateau/grading differences (Thailand flat vs. WHO graded vs. EU hard-gated) | Each engine is a **separate decision**, not one candidate table — see `DECISION_MATRIX.md` and `SCORING_DIAGNOSTIC_REPORT.md` Part 3 |
| WHO country-benchmark engine's own pH band (`fairMin:6, fairMax:9, poorMin:5.5, poorMax:9.5` in `who/limits.js`) | Not evidence-checked by any pass so far — flagged here as an open item, not evaluated in this review |

---

## What this document does not do

- Does not select a winner from any row above.
- Does not change `computeQualityScoreV2.js`, any benchmark engine, or any Case value.
- Does not treat Candidate A/B/C labeling as a ranking — "A" is not "best," it is simply listed first per parameter, usually because it is the option WHO's own position most directly supports, which is not the same as it being the right product choice.

```text
IMPLEMENTATION READY: NO
PRODUCTION CODE CHANGED: NO
SCORING MODEL CHANGED: NO
CASE VALUES CHANGED: NO
SELECTION MADE: NO — awaiting human review of the candidates above
```
