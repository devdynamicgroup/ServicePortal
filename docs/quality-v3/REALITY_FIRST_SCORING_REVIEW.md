```text
PRODUCTION CODE CHANGED: NO
SCORING MODEL CHANGED: NO
COUNTRY LIMITS CHANGED: NO
CASE VALUES CHANGED: NO
UI CHANGED: NO
DEPLOYED: NO
COMMITTED: NO

REALITY-FIRST REVIEW: READY

EVIDENCE-BACKED CHANGES: 2 (Turbidity center; Chlorine cliff removal)
UNRESOLVED DECISIONS: 9
FALSE-PRECISION RISKS: 4
```

# Quality V3 — Reality-First Scoring Decision & Candidate Revision

This document reuses the candidate curves and fixture numbers already
computed and verified in `CANDIDATE_SCORING_TABLE.md`
(`.tmp_probe/quality-v3-candidate-curve-probe.js`, isolated from
production) rather than re-deriving them, and restructures them around
this task's specific requirement: **explicitly separating "evidence
supports a number" from "evidence supports a gradient,"** and stating a
recommended option per open decision rather than leaving every row
equally undecided. No recommendation below is implemented. All still
require approval.

---

## 1. Current V3.0 Baseline (exact, from `computeQualityScoreV2.js`)

| Parameter | Current range | Current score behavior | Evidence status |
|---|---|---|---|
| pH | `\|Δ from 7.2\|` | Smooth symmetric decay, 100 at center, floor 8 | Center's "midpoint of 6.5–8.5" comment is arithmetically wrong (true midpoint 7.5); no health-based basis for grading exists at all per WHO |
| TDS | ≤80 ideal, ramps to floor 5 by 1000+ | Smooth one-sided ramp | Center stricter than every cited source (WHO excellent-tier <300, Japan target 30–200) |
| Turbidity | ≤0.08 ideal, ramps to floor 5 by 5.0+ | Smooth one-sided ramp | Center close to but not exactly matching WHO's own "<0.1 NTU ideal" language |
| ORP | `\|Δ from 400\|` | Smooth symmetric decay | **NO EVIDENCE**, self-admitted in the code's own comment, confirmed by 3 independent search passes across this review series |
| Chlorine | `\|Δ from 0.30\|` + a colliding raw-value branch below 0.1 | Smooth above 0.1, **genuine +18pt cliff at 0.08** (mechanism: two independently-authored branches overlap and the wrong one wins — `EVIDENCE_BASED_SCORING_AUDIT.md` §6) | Band (0.2–0.5) is WHO-aligned; center's "midpoint" comment is arithmetically wrong (true midpoint 0.35) |
| DO | ≥8.0 ideal, no upper bound | Smooth one-sided ramp | **NOT a recognized drinking-water regulatory parameter in any source found**; "8.0 ideal" traces to commercial vendor blogs, not science |

---

## 2. Evidence-Backed Candidate

Only two parameters have a change that clears the "graded score, not just a
threshold" bar (Step 6/10 of this task's own test):

| Parameter | Candidate rule | Evidence | Passes Step 10's 8 questions? |
|---|---|---|---|
| **Turbidity** | Center ≤0.08 → **≤0.1 NTU**; all other breakpoints unchanged | WHO: "ideally <0.1 NTU for effective disinfection" — specific, named, mechanism-linked | Yes on all 8 — real evidence, genuinely a gradient (disinfection efficacy varies continuously with turbidity), no false precision, no cliff introduced, monotonic |
| **Chlorine (cliff only)** | Replace the two colliding branches with one continuous function: flat 100 for 0.2–0.5 (matches WHO's band exactly), linear ramp 0→0.2 mg/L (risk of under-disinfection), linear ramp 0.5→5.0 mg/L (WHO health ceiling), decline beyond | WHO: 0.2 floor, 0.5 target, 5.0 health ceiling — all three cited directly | Yes on 7 of 8 — **Question 3 (false precision) is genuinely debatable for the exact ramp shape**, see §7 |

Full breakpoint-by-breakpoint candidate curve, evidence classification, and
JS implementation: `CANDIDATE_SCORING_TABLE.md` §A–C (not repeated here in
full to avoid duplicating ~40 already-verified rows).

**No other parameter has a candidate.** This is not an oversight — it is
this task's own Step 6 principle applied literally: a curve becomes more
granular only when the measurement change has "a meaningful,
evidence-supported interpretation," and for pH, TDS's low range, ORP, and
DO, no such interpretation was found.

---

## 3. Unchanged Parameters — Explicit, With Reasons

| Parameter | Why unchanged | Evidence status |
|---|---|---|
| **pH — the graded shape itself** | WHO explicitly states no health-based guideline is necessary for pH. There is no "meaningful, evidence-supported interpretation" of pH 7.3 being better than pH 7.6 within the acceptable band — grading it at all is arguably already false precision in the *current* production code, not something this candidate should extend further. A structural change (flatten to pass/fail within 6.5–8.5) was explored in `CANDIDATE_SCORING_TABLE.md` but is listed there as requiring approval, not adopted here as "the" candidate, because removing graded pH scoring is itself a product decision about what Quality V3 is supposed to communicate — see §8 |
| **ORP — entire curve** | No evidence found in any of 3 independent search passes (internal repo history, external WHO/regulatory search, this pass). Per this task's Final Rule: "if evidence says there is no defensible way to assign a more detailed score, do not add detail." The current curve is neither improved nor degraded — it is left exactly as-is, flagged `DECISION REQUIRED` for its very existence (§8) |
| **DO — entire curve** | Same reasoning as ORP: not a recognized drinking-water regulatory parameter in any source found. The popular "8.0 mg/L ideal" traces to commercial vendor content, not science. Also unchanged this pass because removing it from the scored set would touch the six-parameter aggregation, which this task locks |
| **TDS — breakpoints below 300 ppm** | The current curve (80/120/200/300 breakpoints) already differentiates within this range more finely than WHO's own tiers do (WHO's first tier is a single flat "<300 excellent" bucket). Adopting WHO's tiers as a full replacement would *reduce* resolution here for no evidence-based gain — see False Precision Risk #2 below. Left unchanged rather than degraded for the sake of "using WHO's numbers everywhere" |
| **Turbidity — breakpoints beyond the new center (0.2/0.5/1.0/3.0/5.0)** | Only the center has specific WHO backing. The remaining breakpoints are existing project constants with no new evidence found this pass. Changing them without evidence would be inventing precision, which this task explicitly forbids |

---

## 4. Resolution Findings

| Stage | Status | Evidence |
|---|---|---|
| **Curve resolution — Chlorine cliff (0.07→0.08)** | LOSS, now addressed in candidate | +18pt jump for a 0.01 mg/L change, confirmed mechanism: branch collision, not intentional |
| **Curve resolution — Chlorine near-ideal (0.29/0.30/0.31)** | **NO MATERIAL LOSS** — re-classified this pass | All three values sit inside WHO's own 0.2–0.5 mg/L evidenced flat band in *both* the current and candidate curves. This was the original diagnostic example that motivated this whole review thread — and the reality-first conclusion is that its flatness is **correct, not a defect** |
| **Curve resolution — Turbidity center** | LOSS, addressed (center moved to WHO's own figure) | — |
| **Curve resolution — pH, ORP, DO** | Not evidenced either way | No change proposed; flatness (or lack thereof) in these curves is not shown to be wrong, only unproven |
| **Aggregation resolution — TDS 299/300/301** | **LOSS, confirmed, NOT addressed (locked)** | TDS parameter grade moves 68.12→68.00→67.92 continuously; rounded Quality composite stays 95 at all three (`SCORING_RESOLUTION_IMPLEMENTATION_REVIEW.md` §D2) |
| **Aggregation resolution — Turbidity 0.09/0.10/0.11** | **LOSS, confirmed, NOT addressed (locked)** | Same pattern: parameter grade moves 99→98→97, composite rounds to 100 throughout |
| **Rounding resolution** | Unaffected by this candidate | Single `Math.round()` still applies identically in current and candidate |

**Reality-first conclusion:** of the three resolution-loss mechanisms
identified across this review series, only one (a genuine curve
authoring defect — the chlorine cliff) has an unambiguous fix. The other
two (chlorine's flat WHO band, and aggregation dilution) are **not
defects** — one is evidence-correct as-is, the other is a locked
architectural property this task explicitly declined to touch.

---

## 5. Case A / Case B — Validation, Not Calibration

Two different candidates exist in this review thread, and conflating them
would be misleading, so both are reported separately:

**5a. The conservative candidate — only the two items §8 recommends as
ready-to-implement today (Turbidity center + Chlorine cliff fix; pH, TDS,
ORP, DO all identical to current production):**

| Fixture | Current Quality | Conservative candidate | Change | Naturally occurs because |
|---|---:|---:|---:|---|
| CASE_A (1328) | 92 | **92** | 0 | Neither Turbidity (0.12, already fine on both sides of the 0.08/0.1 boundary) nor Chlorine (0.30, inside the flat band on both curves) crosses a changed boundary for this specific measurement |
| CASE_B (synthetic) | 73 | **78** | +5 | Chlorine 0.50 lands exactly at the WHO band edge — current curve's distance-decay gives 66.86, the continuous WHO-anchored candidate gives 100 (0.50 is literally inside WHO's cited 0.2–0.5 target) |
| LOCKED | 71 | **78** | +7 | Chlorine 0.8 — current curve's raw-value branch gives 53.5 for this value, more than a WHO-aligned continuous ramp would (candidate gives 94-equivalent contribution once the cliff/branch collision is removed) |
| POOR | 39 | **46** | +7 | Chlorine 1.5 moves similarly |
| NEAR_IDEAL | 100 | 100 | 0 | Already inside every band under both curve sets |
| CRITICAL | 21 | **26** | +5 | Even at extreme values, the chlorine ramp fix moves the score up slightly, since the old curve's low branch was steeper than the evidence-anchored replacement |

**5b. The fuller exploratory candidate** (also includes the weakly-held,
not-yet-recommended pH-flatten and TDS-tier options from §8 items 4–5),
for reference only, **not what §8 recommends implementing**:
CASE_A 92→95, CASE_B 73→84, LOCKED 71→83, POOR 39→55, CRITICAL 21→27 — full
detail in `CANDIDATE_SCORING_TABLE.md` §D. The gap between 5a and 5b is
almost entirely the pH and TDS changes that §3/§8 explicitly do **not**
recommend adopting without separate, dedicated product sign-off.

**Every movement in both candidates is an increase, never a decrease**,
and none was targeted — each is the direct arithmetic consequence of
WHO's real bands being wider than this codebase's previously-invented
ones, or of removing a bug-like discontinuity. Per this task's own
principle ("if genuinely clean water deserves a high score, it must
remain high" / "do not lower scores merely because they look too high"),
this is the correct outcome to report honestly, not a result to suppress
or re-tune.

---

## 6. Country Comparison

Country engines are untouched by this candidate (only Quality V3's own
curves were touched). Reused from
`SCORING_RESOLUTION_IMPLEMENTATION_REVIEW.md` §D3 for reference:

| Fixture | TH | JP | WHO | EU | EPA |
|---|---:|---:|---:|---:|---:|
| CASE_A | 100 | 100 | 100 | 100 | 100 |
| CASE_B | 100 | 100 | 98 | 99 | 99 |
| LOCKED | 100 | 96 | 93 | **65** | 91 |
| POOR | 87 | 69 | 64 | 52 | 67 |

**Why scores are the same (CASE_A, most of CASE_B):** the measurement is
comfortably inside every engine's compliance band — TH/JP/WHO/EU/EPA all
independently agree this water passes, using their own real limits. No
differentiation is manufactured because none is warranted.

**Why scores differ (LOCKED, chlorine=0.8 mg/L):** Thailand's chlorine
band (0.2–2.0) and EPA's (0.2–4.0) both include 0.8; Japan's (0.1–1.0)
includes it near its upper edge (JP=96, slightly discounted); WHO's
(0.2–0.5) excludes it (WHO=93, moderate decline); **EU's (0.1–0.5)
excludes it and triggers EU's intentional hard composite gate** (EU=65,
sharp, documented, deliberate). This is standards genuinely disagreeing
at a real measurement — not forced differentiation.

---

## 7. False Precision Risk

Explicitly identifying where *more* granularity would make the model
**less** trustworthy, per this task's Step 6/10 requirement:

1. **Chlorine within 0.2–0.5 mg/L.** WHO frames this entire range as one
   operationally-equivalent "acceptable residual" zone — it does not say
   0.35 mg/L is better than 0.22 or 0.48 mg/L. Adding a sub-gradient
   inside this band (e.g. peaking at some invented "true ideal" like 0.30
   or 0.35) would manufacture a preference WHO's own guidance does not
   support. **Risk level: HIGH if attempted — this is exactly the pattern
   this whole review series exists to prevent.**
2. **TDS below 300 ppm, if forced onto WHO's tier structure.** WHO's own
   "excellent" tier is a single flat bucket (<300). The *current*
   production curve already has more internal structure here (80/120/200
   breakpoints) than WHO provides evidence for. Naively replacing the
   current curve with WHO's tiers, as explored in
   `CANDIDATE_SCORING_TABLE.md`, would *remove* real internal structure
   without any evidence that WHO's coarser tier is actually more correct
   — a different, subtler false-precision risk (removing defensible
   detail in the name of "using a named source"). **Risk level: MEDIUM —
   this is why §3 recommends leaving this range unchanged rather than
   adopting the WHO-tier candidate wholesale.**
3. **pH graded scoring in general.** The entire premise of a
   distance-from-7.2 curve implies pH 7.3 is measurably better than pH
   7.6. WHO's position is that no such gradient exists within the
   acceptable band. The current production curve already carries this
   risk; this review does not extend it, but flags that the *existing*
   curve is itself in this category. **Risk level: HIGH, pre-existing,
   not introduced by this pass.**
4. **Chlorine's candidate ramp shape (linear) between WHO's 0.2/0.5/5.0
   anchors.** The anchor points are evidence-backed; the specific linear
   interpolation between them is not — WHO gives three points, not a
   function. A linear ramp is the simplest defensible choice, not a
   proven one. **Risk level: LOW-MEDIUM — the anchors constrain the risk,
   but the exact shape is still an unevidenced design choice.**

---

## 8. Decision Required

| # | Issue | Evidence | Options | Recommended option | Why | Approval required |
|---|---|---|---|---|---|---|
| 1 | Turbidity center | WHO: "ideally <0.1 NTU" | (a) Keep 0.08 (b) Change to 0.1 | **(b)** | Directly matches a specific, named WHO figure; smallest, most evidence-aligned change available in this entire review series | **YES** |
| 2 | Chlorine cliff at 0.08 mg/L | Confirmed unintentional branch collision, no rationale found anywhere | (a) Leave as-is, documented (b) Replace with single continuous function (candidate in §2) | **(b)** | An undocumented, apparently-accidental discontinuity has no defensible reason to keep; continuity is free (doesn't require inventing new evidence, just removing a bug-like interaction) | **YES** |
| 3 | Chlorine ramp shape between WHO anchors | WHO gives points (0.2/0.5/5.0), not a function | (a) Linear (b) Some other curve shape (c) Leave the region entirely un-graded beyond the flat band | **(a)** as a placeholder, weakly held | Simplest, most auditable default; genuinely no evidence prefers it over alternatives — flagged explicitly as the weakest recommendation in this table | **YES** |
| 4 | TDS structure | Current curve already more granular than WHO's tiers below 300; WHO's tiers better-named above 300 | (a) Keep current curve entirely (b) Adopt WHO tiers entirely (c) Hybrid: current curve below 300, WHO-tier-inspired ramp above 300 | **(a)**, keep current | Current curve is not shown to be wrong anywhere; WHO's tiers would remove resolution below 300 for no evidence gain (False Precision Risk #2) | **YES** |
| 5 | pH graded curve, structural | WHO: no health-based guideline necessary at all | (a) Keep current graded curve (b) Flatten to pass/fail within 6.5–8.5 (c) Something between | **(b)**, weakly held | Most literal reading of the evidence; but this is the single decision in this document most likely to surprise stakeholders (it *raises* many scores, per §5), so it's flagged as needing explicit product sign-off on the framing, not just the number | **YES** |
| 6 | pH outside-band slope (if (b) above is approved) | No evidence for any specific rate; Thailand's engine uses coefficient 35 as internal precedent | (a) Reuse Thailand's coefficient (b) Pick a different rate (c) Treat as compliance-only, no score at all outside the band either | **(a)**, weakly held | Reusing an existing, already-shipped project pattern is more defensible than inventing a new number from nothing, but it is still not externally evidenced | **YES** |
| 7 | ORP — does a Quality curve belong here at all | No evidence found, 3 independent search passes | (a) Keep current curve, labeled explicitly as unevidenced (b) Remove from scored parameters (touches locked aggregation) (c) Relabel as informational/compliance-only, not part of Quality's 0–100 | **(a)** for this pass only, by necessity | (b) and (c) both require revisiting the aggregation/parameter-set lock this task explicitly keeps in place; (a) is the only option available without violating that constraint — **this is a scope conflict, not a genuine recommendation of (a) on its merits** | **YES**, and specifically: approval to revisit the aggregation lock is a prerequisite for (b)/(c) |
| 8 | DO — does a Quality curve belong here at all | Not a recognized drinking-water regulatory parameter in any source found | Same three options as ORP | **(a)** for this pass only, by necessity | Identical reasoning and identical scope conflict as #7 | **YES**, same prerequisite as #7 |
| 9 | Net score increase across non-ideal fixtures (§5) | Direct, unforced arithmetic consequence of evidence-alignment, not tuning | (a) Accept as the correct evidence-based outcome (b) Reject the evidence-based candidate because of its direction (c) Adopt only the two highest-confidence items (Turbidity, Chlorine cliff) and defer the rest | No default recommended — **this is a framing decision for the product owner, not a technical one** | Recommending a technical answer here would overstep into a product-communication decision (how "Quality" should be marketed/explained) that this document is not positioned to make | **YES**, this is the most consequential single approval in the document |

---

## Summary for approval

**Ready to implement today, if approved:** items #1 (Turbidity center)
and #2 (Chlorine cliff fix) — both pass every question in this task's
Step 10 test cleanly, both are small, isolated, single-parameter changes,
neither touches aggregation, country limits, or any other locked area.

**Everything else genuinely requires a product decision first**, not
further research — the evidence ceiling has been reached with what's
available. No file under `src/` was created, edited, or deleted to
produce this document; the candidate curves exist only in
`.tmp_probe/quality-v3-candidate-curve-probe.js`.
