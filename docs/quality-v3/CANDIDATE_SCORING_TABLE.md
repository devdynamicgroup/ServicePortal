```text
PRODUCTION CODE CHANGED: NO
SCORING MODEL CHANGED: NO
COUNTRY LIMITS CHANGED: NO
CASE VALUES CHANGED: NO
UI CHANGED: NO

CANDIDATE DESIGN READY: PARTIAL — 2 of 6 parameters have an evidence-backed
                          candidate curve (Turbidity, Chlorine). pH has an
                          evidence-backed candidate SHAPE (flat within
                          6.5–8.5) with an unevidenced slope outside it.
                          TDS has evidence-backed breakpoint LOCATIONS with
                          an undisclosed-by-WHO score mapping. ORP and DO
                          have NO evidence-backed candidate — both are
                          recommended to remain unchanged this pass.
EVIDENCE GAPS: 7
DECISIONS REQUIRED: 9
```

# Quality V3 — Candidate Scoring Table

This file contains only the proposed design and its evidence, per this
task's own instruction. Read-only design work — nothing below is
implemented. The candidate curves exist only in
`.tmp_probe/quality-v3-candidate-curve-probe.js`, an isolated script that
never touches `computeQualityScoreV2.js`.

**Headline finding, stated up front because it reframes what follows:**
*following the evidence rules strictly does not uniformly increase
resolution.* For pH, WHO's own position (no health-based guideline
necessary) means the evidence-backed candidate is **flatter** than the
current curve, not more granular. For Chlorine within its WHO-cited
0.2–0.5 mg/L band, the evidence supports staying flat — grading inside
that band would be inventing precision WHO doesn't provide. Only Turbidity
(center shift) and, partially, TDS (more tiers matched to a named source,
at the cost of some resolution in the 80–300 range vs. the current curve)
move toward more resolution while staying evidence-aligned. This is
reported honestly rather than suppressed, per this task's own "no
artificial penalty" and "no unexplained numbers" rules — those rules cut
both ways.

---

## A. Current Baseline (V3.0, exact, from `computeQualityScoreV2.js`)

| Parameter | Center/target | Breakpoints |
|---|---|---|
| pH | 7.2 (`\|Δ\|`) | 0.15→100, 0.4→90, 0.8→78, 1.3→66, 1.8→48, beyond→floor 8 |
| TDS | ≤80 | 120→92, 200→80, 300→68, 500→52, 1000→34, beyond→floor 5 |
| Turbidity | ≤0.08 | 0.2→88, 0.5→74, 1.0→60, 3.0→40, 5.0→28, beyond→floor 5 |
| ORP | 400 (`\|Δ\|`) | 25→100, 70→86, 130→70, 200→58, beyond→floor 8 (both directions) |
| Chlorine | 0.30 (`\|Δ\|`) + a **separate, colliding** raw-value branch below 0.1 | 0.025→100, 0.08→88, 0.15→74, 0.22→64; then `fcl<0.1`→18–58 (undocumented +18pt cliff at 0.08, mechanism in `EVIDENCE_BASED_SCORING_AUDIT.md` §6) |
| DO | ≥8.0 | 7.2→90, 6.5→78, 6.0→68, 5.0→52, 3.0→28, beyond→floor 5; no upper bound |

---

## B. Evidence-Backed Candidate Table

| Parameter | Candidate rule | Evidence type | Source |
|---|---|---|---|
| pH | Flat 100 for 6.5 ≤ ph ≤ 8.5; outside, linear decline (slope 35, **borrowed from Thailand's existing outside-band precedent**, not independently sourced) | Band: WHO guideline (operational). Slope: existing project constant (internal precedent, not external evidence) | WHO pH fact sheet (band); `thailand/score.js` `gradePh()` (slope precedent) |
| TDS | ≤300→100; 300–600→lerp 100→75; 600–900→lerp 75→50; 900–1200→lerp 50→25; beyond→decline | Breakpoint locations: WHO guideline. Score-per-tier: **evenly-spaced design choice, not WHO-specified** | WHO TDS fact sheet (tier locations only) |
| Turbidity | ≤0.1→100; all other breakpoints **unchanged** from current (0.2/0.5/1.0/3.0/5.0) | Center: WHO guideline, specific and named. Remaining breakpoints: existing project constants, no new evidence found or applied | WHO turbidity fact sheet ("ideally <0.1 NTU for effective disinfection") |
| ORP | **Unchanged.** No candidate proposed. | No evidence found, any value | Confirmed absent across 3 independent search passes |
| Chlorine | Flat 100 for 0.2–0.5 mg/L (matches WHO exactly); single continuous linear ramp 0→0.2 (from near-zero risk floor up to 100); single continuous linear ramp 0.5→5.0 (down toward WHO's health-based ceiling); decline beyond 5.0 | Anchors (0.2, 0.5, 5.0): WHO guideline, all three cited directly. Linear shape between anchors: **disclosed design choice**, not WHO-specified | WHO chlorine fact sheet (floor/target/ceiling values) |
| DO | **Unchanged.** No candidate proposed. | Not a recognized drinking-water regulatory parameter in any source found | Confirmed absent across 3 independent search passes |

---

## C. Evidence for Every Breakpoint

| Breakpoint | Value | Classification |
|---|---|---|
| pH band | 6.5–8.5 | WHO guideline (operational) |
| pH outside-band slope | 35 (coefficient) | Existing project constant (internal precedent) — **DECISION REQUIRED** |
| TDS tier locations | 300 / 600 / 900 / 1200 | WHO guideline (named tiers) |
| TDS score-per-tier | 100 / 75 / 50 / 25 | Design choice (evenly spaced) — **DECISION REQUIRED** |
| TDS beyond-1200 decline rate | `/40` divisor | Design choice, mathematical consequence of the prior anchor, no independent evidence — **DECISION REQUIRED** |
| Turbidity center | 0.1 NTU | WHO guideline (named, specific) |
| Turbidity breakpoints beyond center (0.2/0.5/1.0/3.0/5.0) | unchanged from current | Existing project constants — **DECISION REQUIRED** (not newly evidenced by this pass, only carried forward unexamined) |
| Chlorine floor | 0.2 mg/L | WHO guideline (minimum at delivery) |
| Chlorine target-band ceiling | 0.5 mg/L | WHO guideline (post-contact-time effective disinfection concentration) |
| Chlorine health ceiling | 5.0 mg/L | WHO guideline (health-based) |
| Chlorine ramp shape (linear) | — | Design choice — **DECISION REQUIRED** |
| Chlorine near-zero floor score | 5 (at fcl=0) | Design choice, no evidence for the specific floor value — **DECISION REQUIRED** |
| ORP (all) | 400, all breakpoints | **NO EVIDENCE — DO NOT LOCK. Unchanged this pass. DECISION REQUIRED**: keep, remove, or relabel |
| DO (all) | 8.0, all breakpoints | **NO EVIDENCE — DO NOT LOCK. Unchanged this pass. DECISION REQUIRED**: keep, remove, or relabel |

---

## D. Case A/B (and other existing fixtures) — Current vs. Candidate

Computed by running the real production engine and the isolated candidate
script side by side against identical inputs
(`.tmp_probe/candidate-curve-probe-output.txt`). No fixture value was
changed; no tuning toward any target was performed.

| Fixture | Current Quality | Candidate Quality | Difference | Why |
|---|---:|---:|---:|---|
| CASE_A (1328) | 92 | **95** | +3 | pH 84.3→100 (now inside the flat 6.5–8.5 band) and TDS 97.6→100 (now inside the flat ≤300 tier) both move up; nothing moves down |
| CASE_B (synthetic) | 73 | **84** | +11 | Same mechanism, larger effect: pH 81→100, TDS 86.75→100, Chlorine 66.86→100 (0.50 mg/L is inside the WHO 0.2–0.5 flat band) |
| LOCKED | 71 | **83** | +12 | TDS 56→87.5, Chlorine 53.5→94 — both move toward the WHO-anchored bands |
| POOR | 39 | **55** | +16 | pH 48→82.5, Chlorine 37→80, TDS 44.8→66.7 |
| NEAR_IDEAL | 100 | 100 | 0 | Already inside every band in both curve sets |
| CRITICAL | 21 | **27** | +6 | Smaller effect at extreme values, but still upward |

**This candidate design raises every non-ideal fixture's score, never
lowers one.** This is a direct, unforced consequence of following the
evidence (WHO's actual bands are, in every case checked, wider/more
permissive than this codebase's current internally-invented curves) — not
a target this design was tuned to hit. Per this task's own rule ("if
evidence says a value is excellent, the score must remain excellent"),
this is the expected and correct outcome of evidence-alignment here, not
a defect — but it is the opposite direction from what "resolution
improvement" might be assumed to mean, and should not be approved without
that being understood explicitly.

---

## E. Country Comparison (unchanged — no country engine was touched by this candidate)

This candidate only redesigns Quality V3's own curves. Country benchmark
engines are untouched, so their outputs for these fixtures are exactly as
already reported in `SCORING_RESOLUTION_IMPLEMENTATION_REVIEW.md` §D3
(reused here for reference, not recomputed):

| Fixture | TH | JP | WHO | EU | EPA |
|---|---:|---:|---:|---:|---:|
| CASE_A | 100 | 100 | 100 | 100 | 100 |
| CASE_B | 100 | 100 | 98 | 99 | 99 |
| LOCKED | 100 | 96 | 93 | 65 | 91 |
| POOR | 87 | 69 | 64 | 52 | 67 |

**Expected-same** (comfortably inside all standards): CASE_A, most of
CASE_B. **Expected-different** (measurement inside a genuine gap between
standards): LOCKED's EU=65 (chlorine hard gate — TH/JP/WHO/EPA all pass
LOCKED's chlorine=0.8, only EU's 0.1–0.5 band excludes it). No forcing
applied; these differences existed before this candidate and are
unaffected by it, since Quality and country engines are architecturally
separate (unchanged, per the hard rules).

---

## F. Resolution Analysis

| Stage | Status | Detail |
|---|---|---|
| Parameter resolution — Turbidity | **IMPROVED** | Center now matches WHO's specific figure instead of an unlinked internal choice; shape unchanged |
| Parameter resolution — TDS | **MIXED** | Gains a named-source anchor at 300/600/900/1200; **loses** granularity in the 80–300 ppm range versus the current curve's 80/120/200/300 breakpoints (current curve already differentiates there; candidate is flat 100 across the whole 0–300 range) |
| Parameter resolution — pH | **REDUCED, correctly** | WHO does not support grading inside 6.5–8.5 at all; the evidence-aligned candidate is flatter than current by design, not by omission |
| Parameter resolution — Chlorine (0.29/0.30/0.31, the original test case) | **NO MATERIAL RESOLUTION LOSS RESOLVED** | Re-tested directly (§ below): still 100/100/100 in the candidate, because all three values sit inside WHO's own evidenced 0.2–0.5 mg/L flat band — grading here would require inventing precision, which is exactly what this task forbids |
| Parameter resolution — Chlorine (cliff at 0.08) | **IMPROVED** | The undocumented +18pt jump is gone — verified monotonic and continuous across the full 0–6 mg/L range in the candidate (§ monotonicity spot-check) |
| Parameter resolution — ORP, DO | **UNCHANGED** | No evidence exists to improve or justify changing either |
| Aggregation resolution | **UNCHANGED — LOCKED** | Per this task's rule 7; the TDS-299-vs-301 / Turbidity-0.09-vs-0.11 dilution documented in `SCORING_RESOLUTION_IMPLEMENTATION_REVIEW.md` §D2 is unaffected by any candidate curve, since it is a property of averaging six parameters, not any single curve's shape |
| Rounding resolution | **UNCHANGED — LOCKED** | Not addressed; single `Math.round()` still applies in both current and candidate |

**Chlorine re-test (0.29/0.30/0.31), current vs. candidate:**

| Input | Current param | Current composite | Candidate param | Candidate composite |
|---|---:|---:|---:|---:|
| 0.29 | 100 | 100 | 100 | 100 |
| 0.30 | 100 | 100 | 100 | 100 |
| 0.31 | 100 | 100 | 100 | 100 |

Identical in both — confirming the finding above directly.

---

## G. Unresolved Decisions

All marked `DECISION REQUIRED` — none are silently chosen by this document:

1. **pH outside-band slope (coefficient 35)** — borrowed from Thailand's
   existing engine as internal precedent; no independent evidence for this
   specific rate.
2. **TDS score-per-tier values (100/75/50/25)** — tier *locations* are
   WHO-sourced, the *scores* are an evenly-spaced design choice.
3. **TDS beyond-1200 decline rate** — mathematical consequence of the
   prior anchor, not independently evidenced.
4. **Turbidity breakpoints beyond the center (0.2/0.5/1.0/3.0/5.0)** —
   carried forward unchanged and unexamined; this pass only touched the
   center.
5. **Chlorine ramp shape (linear vs. any other curve)** between the WHO
   anchors — WHO gives points, not a function.
6. **Chlorine near-zero floor score** (5 at fcl=0) — no evidence for this
   specific floor value.
7. **ORP** — keep as an unevidenced curve, remove from Quality's scored
   set (requires touching the locked aggregation/parameter composition —
   out of scope this pass), or relabel as informational/compliance-only.
8. **DO** — same three-way decision as ORP, same scope conflict with the
   locked aggregation.
9. **Whether the net score increase across every non-ideal fixture (§D)
   is an acceptable consequence of evidence-alignment**, given it moves in
   the opposite direction from what "increase resolution" might be assumed
   to imply — this is a product framing question, not a technical one, and
   is the single most important decision in this document.

**Structural note on items 7 and 8:** both ORP and DO's most defensible
evidence-based recommendation (remove from the graded Quality curve) is
blocked by this task's own instruction to keep the six-parameter equal-weight
aggregation unchanged this round. That restriction is respected here — both
parameters are left exactly as they are in production — but it means the
"no defensible curve exists" finding for these two parameters cannot be
acted on without a future decision to revisit the aggregation/parameter-set
question this task explicitly locked. Flagging this rather than silently
picking one side of the conflicting instructions.

---

*No file under `src/` was created, edited, or deleted to produce this
document. The candidate curves exist only in
`.tmp_probe/quality-v3-candidate-curve-probe.js`.*
