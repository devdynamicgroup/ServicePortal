# Quality V3 — Decision Matrix

Consolidates every open decision point from the existing evidence framework
(`MODEL_PROVENANCE.md`, `UNRESOLVED_DECISIONS.md`,
`docs/QUALITY_V3_MODEL_SPECIFICATION.md` §7) plus two new empirical findings
produced for this pass, into one table. **This document decides nothing.**
Every row's "Proposed Action" is a candidate, not a selection — selection
requires the human sign-off in the last column, per
`CALIBRATION_WORKFLOW.md` §5 and `EVIDENCE_ACQUISITION_PROTOCOL.md` §5.

Nothing here changes `computeQualityScoreV2.js` or any benchmark engine.
Both new findings below were produced by
`.tmp_probe/quality-v3-aggregation-and-plateau-audit.js` — a read-only VM
sandbox probe of the unmodified production code, same pattern as the prior
`.tmp_probe/quality-v3-full-audit.js` / `quality-v3-calibration-audit.js`
(see `audit-output.txt` for those). Raw output:
`.tmp_probe/aggregation-plateau-output.txt`.

## New finding 1 — Aggregation sensitivity (Case A / Case B, curves unchanged)

Computed directly from the parameter grades already produced by the frozen
`computeQualityScoreV2.js` for `CASE-1328` and `SYNTHETIC-CASE-B` (see
`evidence-registry.json`) — no curve was touched to produce these numbers.

| Aggregation | CASE-1328 (Case A) | SYNTHETIC-CASE-B (Case B) | Δ vs. arithmetic (A) |
|---|---:|---:|---:|
| Arithmetic mean (current) | 91.64 → rounds to **92** | 72.86 → rounds to **73** | — |
| Geometric mean | 91.17 | 72.11 | −0.47 |
| Harmonic mean | 90.65 | 71.32 | −0.99 |
| Min-capped blend (50% mean / 50% min — illustrative only, not a proposal) | 83.22 | 64.03 | −8.42 |
| Min (single worst parameter) | 74.8 | 55.2 | −16.84 |

**Reading this correctly:** geometric and harmonic mean — the two
"standard" nonlinear aggregation alternatives — move Case A by under one
point. They do **not** materially address the "one weak parameter gets
diluted by five strong ones" behavior documented in
`UNRESOLVED_DECISIONS.md` §1. Only an aggregation that explicitly weights
toward the minimum produces a meaningful shift, and how much weight to give
the minimum is itself an unconstrained design choice with no evidence
behind any particular blend factor — the `minCapped50` row is a
50/50 split chosen only to show the effect exists, not a recommendation.

**What this does and doesn't tell us:** it tells us candidate `E`
(nonlinear aggregation) in `UNRESOLVED_DECISIONS.md` §1 needs to be split
into "mild nonlinear (geometric/harmonic) — insufficient by itself" vs.
"minimum-weighted — meaningful but arbitrary blend factor" as two distinct
sub-options, not one. It does not tell us which one (if either) is correct,
and it does not tell us anything about candidates `B` (weighted average),
`C` (hard safety gate), or `D` (Quality+Compliance hybrid), which are
structurally different and weren't probed here.

## New finding 2 — Country plateau audit (flat-100 inside PASS window)

Longest consecutive run of `score === 100` observed while sweeping one
parameter across its own PASS window, holding all others at the Quality V3
ideal baseline (`ph:7.2, tds:80, turbidity:0.08, orp:400, chlorine:0.3, do:8.0`).
This is a **within-engine, own-standard** sweep — no cross-country
comparison is implied by these numbers alone.

| Country | Parameter | Probed range | Longest flat-100 run | Notes |
|---|---|---|---:|---|
| Thailand | TDS | 0–1200 ppm (17 points) | 16/17 — flat from 0 to 1000, first drop at 1200 | Widest plateau observed |
| WHO | TDS | 0–1000 ppm (11 points) | 4/11 — flat 0–300, declines from 400 | |
| EU | TDS | 0–1000 ppm (11 points) | 4/11 — flat 0–300, declines from 400 | |
| EU | Chlorine | 0–0.5 mg/L (6 points) | 5/6 — flat 0.1–0.5 | Only the 0 mg/L point breaks the plateau |
| Japan | TDS | 0–300 ppm (7 points) | 7/7 — flat across the entire probed PASS range | Narrower absolute range than others, but 100% of it is flat |
| Japan | Chlorine | 0–2 mg/L (8 points) | 6/8 — flat 0.1–1.0 | |
| US EPA | TDS | 0–800 ppm (9 points) | 4/9 — flat 0–300, declines from 400 | |

**Reading this correctly:** the "PASS region → flat 100" pattern described
qualitatively in this conversation is real and present in every engine
probed, at varying widths. It is **not** evidence about whether any of
these plateaus is wrong — per §10/§11 of the reviewed recalibration
prompt and `QUALITY_V3_MODEL_SPECIFICATION.md` §4, grading *within* a PASS
window requires its own preferred-range/ideal-band evidence per country,
which — same as the Quality-side curves — does not currently exist in this
repository for any of the 5 engines. Thailand's TDS plateau is the widest
in absolute terms, but "widest" is not "most wrong": a country's own limit
being wide is a fact about that country's regulatory band, not a defect.

## Consolidated decision matrix

| Issue | Evidence found | Proposed action (candidate, not selected) | Approval required |
|---|---|---|---|
| Quality curve discrimination (pH/TDS/Turbidity/ORP/Chlorine/DO near-ideal bands) | `PARAMETER_EVIDENCE_MATRIX.md` — all 6 centers LOW/UNKNOWN confidence, all breakpoints UNKNOWN provenance; `.tmp_probe/quality-v3-full-audit.js` boundary scan shows curves are internally monotonic (no cliffs) but generous near center | Do not touch until real samples exist per `CALIBRATION_WORKFLOW.md` §6 (minimum sampling ranges) — or, if product wants to proceed without full evidence, an explicit product decision to treat current centers as accepted product judgment and revise only slope/breakpoint spacing | **YES** — product/domain owner |
| Aggregation model (single weak parameter diluted by average) | New finding 1 above — geometric/harmonic mean insufficient; minimum-weighted blend has an effect but no evidence for blend factor; `UNRESOLVED_DECISIONS.md` §1 candidates A–E | Decide what Quality V3 is supposed to represent (closeness index vs. safety-adjacent signal) before selecting an aggregation family — this is a product-definition question, not a math question | **YES** — product owner (definition), then evidence-backed parameter selection if a nonlinear form is chosen |
| ORP ideal center (400 mV, shared across Quality + all 5 country engines) | `PARAMETER_EVIDENCE_MATRIX.md`, `QUALITY_V3_MODEL_SPECIFICATION.md` §4 — self-admitted `INTERNAL_LEGACY_CONSTANT`, byte-identical across all 5 country `limits.js` files | At minimum, document explicitly as `SHARED_OPERATIONAL_CONSTANT` everywhere it's displayed (already done in §4); do not derive 5 independent "national" ORP preferences without genuine per-country sourcing | **YES** — if any per-country differentiation is ever proposed |
| Country PASS-window plateau (flat 100 inside limits) | New finding 2 above — confirmed present in all 5 engines, Thailand TDS widest (16/17 probed points) | Do not invent a within-PASS ideal/preferred band or distance-to-boundary score for any country without a cited source for that country's preferred range; where no such source exists, leave the engine as pass/fail-graded and record `DECISION REQUIRED` rather than implementing a guess | **YES** — per-country, requires a domain/regulatory source before any change |
| Chlorine curve (discontinuous branch structure) | `QUALITY_V3_MODEL_SPECIFICATION.md` §3 — structurally most complex curve, `INTERNAL_LEGACY_CONSTANT`, no rationale for branch boundaries | Evidence acquisition across the 0.1/0.22/1.0 branch boundaries (per §8 of the same doc) before simplifying or re-deriving | **YES** |
| Case-A/Case-B numeric targets (78–84 / 58–68) as acceptance criteria | This conversation's earlier draft prompt proposed these as hard targets | Rejected as a primary success criterion — see reasoning earlier in this thread and `CALIBRATION_WORKFLOW.md`'s partition rule (CASE-1328 is permanently calibration data, `SYNTHETIC-CASE-B` is `REGRESSION_ONLY`, neither can be a target). May be kept as a **non-binding product expectation** for human review only | N/A — already resolved by existing framework discipline |

## Update — findings from `SCORING_DIAGNOSTIC_REPORT.md`

A follow-up read-only diagnostic pass (dense curve probing at fine step
sizes, plus a boundary-aware sweep of every country engine's own PASS
window) found two additional rows for this matrix, and one correction to
the "Country PASS-window plateau" row above:

| Issue | Evidence found | Proposed action | Approval required |
|---|---|---|---|
| Quality chlorine cliff | `computeQualityScoreV2.js` chlorine curve jumps +18 points (46→64) for a 0.01 mg/L change at the 0.08 mg/L branch boundary — quantified for the first time | Either document why a step function is intentional there, or treat as a candidate for evidence-backed smoothing | **YES** |
| EU chlorine cliff | EU country-benchmark chlorine engine jumps ±35 points at its 0.1/0.5 mg/L band edges — not previously documented anywhere | Same as above, for the EU engine specifically | **YES** |
| Country PASS-window plateau (correction) | "Flat 100 inside PASS" is **not uniform** across engines — WHO already implements graded (non-flat) scoring for TDS/Turbidity via `ideal/fair/poor` bands in `who/score.js`; Thailand does not for the same parameters | Per-engine, not blanket: check whether an engine already grades before assuming it needs to | **YES**, per engine — and for WHO specifically, whether its existing `ideal/fair/poor` values have any external source is itself unresolved |

## What remains genuinely open after this pass

Everything in the table above is still `DECISION REQUIRED`. This pass adds
two things that didn't exist before it: actual numbers for how much
aggregation choice alone would move Case A/B, and actual confirmation
(not just qualitative description) of where country plateaus are widest.
Neither number selects a curve, an aggregation formula, or a country
grading scheme. Per `MODEL_PROVENANCE.md`, Quality V3 remains
`NOT READY FOR CALIBRATION` — this document does not change that status.
