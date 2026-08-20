```text
PRODUCTION CODE CHANGED: NO
GRADING CHANGED: NO
WEIGHTS CHANGED: NO
AGGREGATION CHANGED: NO
THRESHOLDS CHANGED: NO
UI / HERO / QUALITY V3 / ORP: NOT TOUCHED THIS PASS
```

# Country Benchmark — Score Semantics Review (all 5 engines)

**Update (this pass): extended from the original Thailand/Japan case study
to cover all 5 engines explicitly** (§ "All-5-Country Semantic Table" and
§ "Chlorine = 0.5 Across All 5 Engines" below are new). The
Thailand/Japan-specific sections below are kept as the worked example —
every finding in them is confirmed to generalize identically to WHO/EU/US
EPA, not a TH/JP-specific pattern.

Continues directly from `Thailand vs Japan — Score Realism Audit` (this
thread). That audit proved TH/JP diverge extensively and correctly outside
their shared PASS zones, and found no aggregation/rounding bug. This
document answers the harder question that audit surfaced but did not
resolve: **is `PASS = 100` the actual intended semantic of Country
Benchmark, or is the current flat-100-within-band behavior an accidental
side effect of a model that was meant to express something more
granular?**

---

## Current Score Semantics — Traced from Code, Not Assumed

### 1–5: What does `100`, `PASS`, `WARNING`, `FAIL` currently mean?

Read directly from all 5 `score.js` files (not inferred from naming).
Every engine has **two separate outputs that are computed independently
and never cross-reference each other**:

```
params[param]   — a 0–100 number from the grading curve (flat-in-band,
                  then linear/ramped outside it — already characterized
                  in full in the prior Realism Audit)

classifications[param] — PASS / WARNING / FAIL / CRITICAL, computed by a
                  separate classify() function that checks band membership
                  directly against limits.js, not by reading the grade
```

Example, Thailand (`thailand/score.js`):
```js
function classify(grade, inPass) {
  if (inPass && grade >= 95) return 'PASS';
  if (inPass) return 'PASS';
  if (grade >= 70) return 'WARNING';
  if (grade >= 40) return 'FAIL';
  return 'CRITICAL';
}
```
`inPass` here is a **separate boolean** (`ph >= L.ph.min && ph <= L.ph.max`,
computed independently in `calculate()`), not derived from the grade. The
grade and the PASS/WARNING/FAIL status are two parallel outputs of the same
input, not one derived from the other.

**Then, on top of both of those, every engine computes a `verdict` label**
from the *final aggregate score* — and this is the most revealing part:

```js
// thailand/score.js
function verdictFrom(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Acceptable';
  if (score >= 40) return 'Attention';
  return 'Poor';
}
// japan/score.js — same 5-tier shape, different cutoffs (85/72/60/40)
```

**This is the key finding.** A pure compliance model has no reason to
define 5 quality tiers (Excellent/Good/Acceptable/Attention/Poor) — a
compliance model only needs PASS/FAIL. The fact that every one of the 5
country engines independently implements a 5-tier **quality-gradient**
verdict system is direct code evidence that **the numeric score was
designed to communicate more than binary compliance** — but the underlying
parameter grading curves (flat-100-within-band) only deliver that gradient
*outside* the ideal zone, not inside it. **The verdict system's own top
tier, "Excellent," cannot currently distinguish "just crossed into the
ideal zone" from "dead center of the ideal zone"** — both are 100, both
say "Excellent," with no further resolution available.

### 6: Is score/compliance one layer or two?

**Two layers, by construction, confirmed in code — but only one of them
(`classifications`) is genuinely binary.** The numeric `score` (and its
`verdict` label) is a continuous 0–100 aggregate that degrades smoothly
*outside* PASS bands but is flat *inside* them. This is architecturally
identical to the separation already documented for Quality V3 itself
(`docs/QUALITY_V3_MODEL_SPECIFICATION.md` §2: Compliance ≠ Quality) — the
*same tension exists one level down, inside each country engine*, between
its own `classifications` (binary) and its own `score`/`verdict`
(intended-gradient, but only partially delivered).

### 7: Does any existing repo document already settle this?

**No.** Searched `docs/quality-v3/*`, `docs/QUALITY_V3_MODEL_SPECIFICATION.md`,
and this thread's own prior audits. `UNRESOLVED_DECISIONS.md` §1 addresses
a related but distinct question (Quality V3's *aggregation*, i.e. whether
one catastrophic parameter should be able to average out). **No existing
document states what Country Benchmark's own numeric score is supposed to
mean once compliance is satisfied.** This is a genuine gap, not a
previously-answered question being re-litigated.

**Explicit conflict check (this pass):** re-read `QUALITY_V3_MODEL_SPECIFICATION.md`,
`UNRESOLVED_DECISIONS.md`, `DECISION_MATRIX.md`,
`FINAL_SCORING_IMPLEMENTATION_REPORT.md`, `COUNTRY_SCORE_REALISM_AUDIT.md`
side by side specifically looking for a contradiction. **No conflict
found.** Every prior document is consistent with (and several directly
anticipate) this finding: `QUALITY_V3_MODEL_SPECIFICATION.md` §2 already
draws the Compliance≠Quality distinction for Quality V3 itself;
`COUNTRY_SCORE_REALISM_AUDIT.md` already flagged the flat-in-band pattern
as CASE C without resolving what it should mean; nothing anywhere claims
Country Score was ever decided to be pure compliance or pure quality-
gradient. This document narrows an open gap; it does not overturn a prior
decision.

---

## All-5-Country Semantic Table

Extends the Thailand/Japan trace above to WHO, EU, and US EPA — confirming
the verdict/grading inconsistency is a **model-wide pattern**, not
specific to any two countries.

| Country | Score meaning (as coded) | Parameter grade behavior | Verdict behavior | Hard gate | Aggregation | Final semantic interpretation |
|---|---|---|---|---|---|---|
| Thailand | Weighted avg of 5 params (DO excluded) | Flat-in-band, linear outside | `verdictFrom`: 90/75/60/40 → Excellent/Good/Acceptable/Attention/Poor | none | equal weight (1 each) | Same ambiguity as below — labels imply gradient, math delivers compliance |
| Japan | Weighted avg of 6 params (custom weights) | Flat-in-band, linear outside | `verdictFrom`: 85/72/60/40 → same 5-tier labels | none | custom (turbidity/chlorine 0.22 each) | Same ambiguity |
| WHO | Weighted avg of 6 params (equal) | **Mixed**: TDS/Turbidity are genuine 3-tier ramps (already graded within what others call "PASS"); pH/Chlorine are flat-in-band **discrete step functions** (100/70/40/15 and 100/80/50/25) | `verdictFrom`: 80/70/60/40 → same 5-tier labels | none | equal weight (1 each) | **Partially resolves its own ambiguity for TDS/Turbidity** (some real within-zone gradient exists) but not for pH/Chlorine |
| EU | Weighted avg of 6 params (custom, chlorine/turbidity 0.25 each) | Flat-in-band, linear outside | `verdictFrom`: 85/70/55/40 → same 5-tier labels, **plus a chlorine-hard-gate override** (`gateCapOnChlorineFail`) that can force "Attention"/"Poor" regardless of the tier the raw score would imply | **YES — chlorine only** | custom weights | Verdict language is compliance-flavored at the gate ("Fails EU parametric chlorine check") even though the surrounding tier system is quality-gradient-flavored — the clearest internal mix of both semantics in one engine |
| US EPA | Weighted avg of 6 params (custom, turbidity 0.30) | Flat-in-band, linear outside | `verdictFrom`: 80/70/60/40 → same 5-tier labels | none | custom weights | Same ambiguity as Thailand/Japan |

**Conclusion: the verdict/grading tension identified in the TH/JP case
study is present in all 5 engines.** WHO is the partial exception — its
TDS and Turbidity curves already deliver some of what "quality gradient"
would require, but its pH and Chlorine curves are step functions (even
coarser than flat — see `SCORING_RESOLUTION_REVIEW.md` §5.4, already
documented) that don't. No engine resolves the ambiguity consistently
across all of its own parameters.

---

## Current TH vs JP Behavior — Realism Sweep (exact requested value sets)

### Chlorine

| Input | TH score | JP score | TH status | JP status |
|---:|---:|---:|---|---|
| 0.10 | 87 | 100 | CRITICAL | PASS |
| 0.15 | 91 | 100 | FAIL | PASS |
| 0.20 | 100 | 100 | PASS | PASS |
| 0.30 | 100 | 100 | PASS | PASS |
| 0.50 | 100 | 100 | PASS | PASS |
| 0.70 | 100 | 100 | PASS | PASS |
| 1.00 | 100 | 100 | PASS | PASS |
| 1.20 | 100 | 95 | PASS | WARNING |
| 1.50 | 100 | 92 | PASS | FAIL |
| 2.00 | 100 | 85 | PASS | CRITICAL |

### TDS

| Input | TH score | JP score | TH status | JP status |
|---:|---:|---:|---|---|
| 100 | 100 | 100 | PASS | PASS |
| 200 | 100 | 100 | PASS | PASS |
| 300 | 100 | 100 | PASS | PASS |
| 400 | 100 | 98 | PASS | PASS |
| 500 | 100 | 97 | PASS | PASS |
| 700 | 100 | 94 | PASS | FAIL |
| 1000 | 100 | 91 | PASS | CRITICAL |

### Turbidity

| Input | TH score | JP score | TH status | JP status |
|---:|---:|---:|---|---|
| 0.5 | 100 | 100 | PASS | PASS |
| 1.0 | 100 | 100 | PASS | PASS |
| 2.0 | 100 | 100 | PASS | PASS |
| 2.5 | 100 | 99 | PASS | WARNING |
| 3.0 | 100 | 97 | PASS | WARNING |
| 4.0 | 100 | 95 | PASS | WARNING |
| 5.0 | 100 | 92 | PASS | FAIL |

### pH

| Input | TH score | JP score | TH status | JP status |
|---:|---:|---:|---|---|
| 5.8 | 95 | 100 | WARNING | PASS |
| 6.0 | 97 | 100 | WARNING | PASS |
| 6.5 | 100 | 100 | PASS | PASS |
| 7.0 | 100 | 100 | PASS | PASS |
| 7.5 | 100 | 100 | PASS | PASS |
| 8.0 | 100 | 100 | PASS | PASS |
| 8.5 | 100 | 100 | PASS | PASS |
| 8.6 | 99 | 100 | WARNING | PASS |
| 9.0 | 97 | 97 | WARNING | WARNING |

### DO

| Input | TH score | JP score | TH status | JP status |
|---:|---:|---:|---|---|
| 4.0 | 100 | 98 | PASS | WARNING |
| 4.5 | 100 | 99 | PASS | WARNING |
| 5.0 | 100 | 100 | PASS | PASS |
| 5.3 | 100 | 100 | PASS | PASS |
| 6.0 | 100 | 100 | PASS | PASS |
| 8.0 | 100 | 100 | PASS | PASS |

**Observation, restated from the prior audit and reconfirmed with these
exact requested values:** real, substantial differentiation exists and is
clean everywhere outside the shared PASS zone (Chlorine 0.10–0.15 and
1.20–2.00; TDS 700–1000; Turbidity 2.5–5.0; pH 5.8–6.0 and 8.6–9.0; DO
4.0–4.5). Inside the shared PASS zone, both are flat 100 — no exceptions
found in this sweep either.

---

## Why 100/100 Happens — Full Trace at Chlorine = 0.5 mg/L

```
Thailand                              Japan
threshold: {min:0.2, max:2.0}         threshold: {min:0.1, max:1.0}
weight: 1 (equal-weight, 5 params)    weight: 0.22 (custom, turbidity/chlorine emphasized)
0.5 is inside [0.2, 2.0]              0.5 is inside [0.1, 1.0]
parameter grade: 100                  parameter grade: 100
classification: PASS                  classification: PASS
verdict: Excellent                    verdict: Excellent
all other params also 100 (baseline)  all other params also 100 (baseline)
final score: 100                      final score: 100
```

**Both numbers are correct outputs of the code as written.** Thailand's
band is 10× wider than Japan's (1.8 mg/L vs 0.9 mg/L) — 0.5 mg/L sits at
27.8% of the way through Thailand's band and 44.4% through Japan's — **two
meaningfully different positions relative to each country's own
threshold**, and this position is **not read by either grading function**.
Both `gradeChlorine()` implementations check band membership only
(`if cl >= min && cl <= max return 100`) — margin-to-threshold is computed
nowhere.

**This is not resolution loss** (no information that the model computed
was subsequently discarded by aggregation or rounding) — **the
margin-to-threshold information was never computed by the parameter
grading function in the first place.** That distinction matters for
Step 4's classification below.

### Chlorine = 0.5 mg/L Across All 5 Engines

| Country | Threshold | Weight | Param grade | Classification | Verdict | Final score |
|---|---|---:|---:|---|---|---:|
| Thailand | 0.2–2.0 | 1 | 100 | PASS | Excellent | 100 |
| Japan | 0.1–1.0 | 0.22 | 100 | PASS | Excellent | 100 |
| WHO | idealMin 0.2–idealMax 0.5 | 1 | 100 | PASS | Excellent | 100 |
| EU | 0.1–0.5 | 0.25 | 100 | PASS | Excellent | 100 |
| US EPA | 0.2–4.0 | 0.15 | 100 | PASS | Excellent | 100 |

**All 5 give identically 100/PASS/Excellent** for this one reading — and
this is a genuinely interesting edge case: 0.5 mg/L sits at 5 meaningfully
different relative positions (28% through Thailand's band, 44% through
Japan's, exactly at WHO's and EU's upper edge, 8% through EPA's) and every
one of those positions is invisible to the current grading math.

**Does this let a user conclude "Thailand standard ≈ Japan standard ≈ WHO
≈ EU ≈ EPA"?** Yes, at this specific reading, a user comparing only the
headline number and verdict label would have no way to see that WHO and EU
consider 0.5 mg/L to be sitting exactly at their upper edge (any small
increase would immediately leave their band) while Thailand and EPA have
enormous headroom above 0.5 before their own bands end (2.0 and 4.0 mg/L
respectively).

**Classification of this specific confusion risk:**
- **Not a scoring defect** — every number is the correct output of the code as written.
- **Not purely a UI/communication problem either** — the `classifications`/`reasons` data that *could* disambiguate this (band edges, margin) is not fully surfaced at the per-parameter level in the current UI, but even if it were, the headline `score`/`verdict` would still read identically across all 5, because the underlying numbers genuinely are identical.
- **Root cause: a semantic/definition gap.** The confusion is possible *specifically because* the product has not decided whether "100" is supposed to mean "safely passing" (in which case near-identical scores at a shared-pass reading are correct and expected, full stop) or "how good, on this country's own scale" (in which case near-identical scores here would be under-informative and arguably misleading). Which of these it is determines whether this is even a problem worth solving.

---

## Resolution Analysis — Case Classification

| Case | Definition | Applies here? |
|---|---|---|
| **A — True equivalence** | Both standards evaluate this reading at the same level | Only true in the pure compliance sense (both say PASS/Excellent) — not true in a margin-to-threshold sense, since 27.8% vs 44.4% through band *is* a real difference the model doesn't read |
| **B — Resolution loss** | Parameter-level info differs, but grading/aggregation/rounding erases it before the final score | **Not what's happening.** Nothing is computed and then discarded — margin-to-threshold is never computed at all |
| **C — Intended compliance behavior** | Both countries consider this reading PASS, and the model is *deliberately* PASS=100 | **Cannot be confirmed as intended** — see below. The verdict-tier system (Excellent/Good/Acceptable/Attention/Poor) is inconsistent with a purely-intentional PASS=100 design, because a 5-tier quality-gradient label system implies the score should distinguish quality levels, not just compliance |
| **D — Implementation defect** | Code fails to preserve a difference the standard/logic intended to create | **Not proven** — there's no evidence either threshold intended margin-grading and a bug removed it. The curves were written flat-in-band from the start (same pattern across all 5 engines, confirmed in the prior audit) |

**Conclusion: this situation doesn't cleanly fit any single case as
originally defined.** It's closest to a **hybrid of C and a documentation
gap**: the *classification* layer (PASS/WARNING/FAIL) is unambiguously
intentional compliance behavior. The *score/verdict* layer's intent is
genuinely unclear from the code — the verdict tier names imply one design
goal (quality gradient) while the grading curves deliver another (flat
compliance signal dressed in a 5-tier label).

---

## Product Definition Gap

> **Country Benchmark ควรเป็น "Compliance Score" หรือ "Quality Level
> relative to the country's standard"?**

The code cannot answer this — it currently does **neither one cleanly**:

- If it were meant to be Definition A (Compliance Score), the verdict
  labels should be PASS/FAIL, not a 5-tier Excellent→Poor scale that
  implies graduated quality.
- If it were meant to be Definition B (Quality-level), the grading curves
  should read distance-to-threshold *inside* the band, which none of the 5
  engines do.

**This is the actual product definition gap** this task set out to find —
not a bug, not a missing feature, but an **unresolved tension between the
engines' own labeling (implies B) and their own grading math (implements
A)**, present identically across all 5 country engines, not specific to
Thailand or Japan.

---

## Design Options (no formulas, no implementation)

### Option A — Keep Compliance Score

Formalize what the grading curves already do: `PASS = 100` inside each
country's own band, full stop. **Change required:** none to scoring math;
would require relabeling `verdictFrom()`'s output to PASS/FAIL-style
language instead of Excellent/Good/Acceptable/Attention/Poor, since the
current 5-tier labels overstate the resolution the underlying grade
actually has *inside* a PASS band. **Impact:** UI copy/labels only
(out of scope for this pass — flagged, not touched). Existing scores
numerically unchanged.

**Pros:** matches current grading math exactly, zero scoring risk, honest
about what the number represents.
**Cons:** cannot express "how comfortably" a country passes; TH/JP-type
apparent-equality cases persist by design, which may not match product
expectations (Thailand pass vs Japan pass at the same reading will keep
looking identical even where margins clearly differ).

### Option B — Introduce Quality-Level Resolution Inside PASS Bands

**Where the change would need to happen:** the *parameter-level grading
function* for each country (not aggregation — aggregation already
faithfully sums whatever the parameter functions hand it, confirmed no
aggregation-level loss in either audit). Every one of the 5 engines'
`grade*()` functions would need a within-band curve, not just a flat
`return 100`.

**Scope of impact if approved:**
- All 5 country engines' grading functions (not just Thailand/Japan) —
  the same flat-in-band pattern exists identically in WHO, EU, US EPA.
- Every existing test asserting a specific score for an in-band reading
  (`tests/score/thailand-japan-flow.test.js`, `case-1328-calibration-baseline.test.js`,
  and others) would need review — some in-band assertions currently
  compare `TH === JP` deliberately to prove "same standard region"
  behavior; those specific assertions would need to be reclassified as
  intentional-equality checks with a defined tolerance, not exact equality.
- `verdictFrom()` label boundaries (90/75/60/40 etc., different per
  country) would need to be re-examined — a within-band gradient changes
  what "Excellent" means at the edges.

**Evidence required before this can be implemented:** this is a
parameter-curve change like any other in this review series — it falls
under the same evidence discipline established in
`CALIBRATION_WORKFLOW.md`: real samples, not invented margin-to-threshold
formulas. **No such evidence exists yet for any of the 5 countries'
within-band curves.**

**Pros:** would resolve the verdict-label/grading-math inconsistency found
above; would let "just passed" and "comfortably passed" look different.
**Cons:** highest-effort option; touches all 5 engines, not just TH/JP;
requires new evidence acquisition before any number can be chosen;
directly risks recreating the exact overfitting pattern this whole review
series (`CALIBRATION_WORKFLOW.md`) was built to prevent if done without
real field data.

### Option C — Separate Compliance and Quality Explicitly

Split each country engine's output into two independently-labeled
channels: `Compliance` (PASS/WARNING/FAIL, already computed, already
correct) and `Quality Level` (a numeric/tiered indicator, computed
separately, not required to be 100 the instant compliance is met).

**Architecture check — does the current code already have enough
separation to support this?** **Partially.** `classifications` (per-
parameter PASS/WARNING/FAIL/CRITICAL) and `params` (per-parameter 0–100
grade) are already computed as parallel, independent outputs inside every
engine's `calculate()` — the *data* separation already exists. What does
**not** exist yet is a second, independent *aggregate* number for "quality
level" distinct from the current single `score` — today there is one
composite number serving both roles at once.

**Impact if approved (analysis only, not proposed for implementation):**
- **API:** `buildComparisonScoreResult()` (`flows/score.js`) would need a
  new field; `WaterScoreBenchmarkRegistry.calculate()`'s return shape
  would change for every engine — a breaking change for any consumer
  reading `.score` and assuming it means "compliance."
- **UI:** the Hero binding just implemented in this thread
  (`flows/score.js`, selected-country score → Hero) would need a decision
  about which of the two new numbers it displays — reopens exactly the
  question this thread already resolved once for Quality V3 vs Country
  Benchmark, one layer deeper.
- **Existing consumers:** `public-report.js` and any other reader of
  `comparisonScoreResult.score` would need to be audited for which
  semantic they currently assume.
- **Tests:** every existing country-engine test asserting a numeric
  `.score` value would need re-evaluation against whichever channel it's
  actually meant to check.
- **Backwards compatibility:** any external integration or saved report
  referencing a historical `.score` value would need a defined mapping
  (does old data mean "compliance" or "quality" under the new split?).

**Pros:** philosophically cleanest; matches the same Quality-vs-Compliance
separation already established for Quality V3 itself, extended consistently
down into each country engine.
**Cons:** largest-blast-radius option of the three; touches API contract,
UI, and every existing test; not something this review series' "smallest
possible fix" discipline would default to without a very clear product
mandate.

---

## Recommendation

**Not selecting an option.** Per this task's own instruction, this is a
product/model decision, not an engineering judgment call. Restated with
evidence, code fact, decision, and consequence kept strictly separate for
each option, per this task's required framing:

### Option A

- **EVIDENCE:** none required beyond what already exists — Thailand/WHO/
  EU/Japan/EPA's own regulatory bands are already the compliance boundary.
- **CURRENT CODE FACT:** this is what the grading math already does today,
  in all 5 engines, with zero exceptions found across ~250 swept points
  in this and the prior audit.
- **PRODUCT DECISION:** confirm that "100 = safely within this country's
  accepted range" is the intended and sufficient meaning of the number.
- **IMPLEMENTATION CONSEQUENCE:** zero scoring changes. Only consequence is
  a documentation/label consequence — `verdictFrom()`'s Excellent/Good/
  Acceptable/Attention/Poor language would need review for whether it
  still fits a compliance-only number (out of scope to change here).

### Option B

- **EVIDENCE:** **does not exist yet.** No real, outcome-labelled samples
  spanning within-band positions exist anywhere in this repository for
  any of the 5 countries (same gap already documented for Quality V3 in
  `MODEL_PROVENANCE.md` — this is the country-engine equivalent of that
  same gap).
- **CURRENT CODE FACT:** all 5 engines' `grade*()` functions return a flat
  100 for any in-band value; WHO's TDS/Turbidity are the sole partial
  exception.
- **PRODUCT DECISION:** confirm the product actually wants "quality level
  under this country's standard" as the number's meaning, accepting that
  this requires new field-evidence collection before any specific curve
  can be chosen (not implementable from a decision alone).
- **IMPLEMENTATION CONSEQUENCE:** touches all 5 engines' grading functions,
  not just TH/JP; every existing regression fixture asserting an in-band
  score needs re-examination; is the only option requiring genuinely new
  data collection, not just an architecture change.

### Option C

- **EVIDENCE:** the data-layer separation (`params` vs `classifications`)
  already exists in every engine today — no new evidence needed to *split
  the display*, only to decide what a second aggregate number would mean
  (which folds back into whichever of A/B is chosen for the "quality"
  channel).
- **CURRENT CODE FACT:** only one aggregate `score` exists per engine
  today; splitting it is a new aggregate, not a relabeling of an existing
  one.
- **PRODUCT DECISION:** confirm the product wants two separately-displayed
  numbers per country (Compliance + Quality) rather than one.
- **IMPLEMENTATION CONSEQUENCE:** the largest of the three — breaking API
  change (`WaterScoreBenchmarkRegistry.calculate()` return shape), Hero
  binding decision reopened, every test asserting `.score` re-evaluated,
  backwards-compatibility question for historical saved reports.

### Blast-radius dependency map (informational, not a plan)

```
Any change to within-band grading semantics touches, transitively:

grade*() functions (5 engines)
  → params{} (per-engine output)
    → classify() / classifications{} (reads params, may need re-tuning
      if grade distribution inside "PASS" changes)
    → weighted aggregate → score
      → verdictFrom() (tier boundaries likely need re-derivation)
        → buildComparisonScoreResult() (flows/score.js)
          → S.comparisonScoreResult
            → Hero binding (flows/score.js, this thread's most recent change)
            → findings/reasons rendering (score.js, unchanged data shape
              assumed — would need re-verification)
            → public-report.js (separate rendering path, not audited this
              pass — flagged, not touched)
        → every test asserting a specific in-band .score value
          (tests/score/thailand-japan-flow.test.js and others)
```

Nothing in this map has been touched. It exists to show the true size of
Option B or C before either is approved.

---

## ORP — Tracked Separately, Not Used in This Decision

Per this task's explicit instruction: ORP's finding (`COUNTRY_SCORE_REALISM_AUDIT.md`,
CASE E — byte-identical formula and band across all 5 engines, no cited
standard for any country) is **not** evidence for or against any option
above, and was not used to reach any conclusion in this document. It
remains open as its own, separate unresolved issue:

```
Status: SCORING DESIGN DEFECT (confirmed, prior pass)
Track: independent of the Compliance-vs-Quality-Gradient decision above
Reason for separation: ORP's problem is "no per-country differentiation
  exists in the code at all" — a missing-standard problem. The TH/JP
  chlorine-at-0.5 problem is "per-country differentiation exists and is
  correct, but the model doesn't grade position-within-band" — a
  resolution-depth problem. These are different questions with different
  fixes; conflating them risks the wrong fix being proposed for either.
Action: none this pass. Still requires its own product decision per
  COUNTRY_SCORE_REALISM_AUDIT.md §F.
```

---

## Final Diagnostic — 14 Questions

1. **ปัจจุบัน Country Score มี semantic ว่าอะไร?** — สอง layer คู่ขนาน: `classifications` (compliance ล้วน, ชัดเจน) และ `score`/`verdict` (ตั้งใจให้เป็น quality gradient ตาม verdict label 5 ระดับ แต่ grading curve ยังไม่ส่งมอบ resolution นั้นจริงภายใน band)
2. **`100` หมายถึงอะไร?** — "อยู่ในหรือใกล้ ideal band ของประเทศนั้น" ไม่ใช่ "อยู่กึ่งกลาง band พอดี" — ไม่มี margin-to-threshold ผสมอยู่
3. **PASS = 100 เป็น intended design จริงหรือไม่?** — **พิสูจน์ไม่ได้ทั้งสองทาง** จากโค้ดอย่างเดียว — verdict label ขัดกับ grading math เอง (ดู Product Definition Gap)
4. **TH=100/JP=100 ถูกต้องตาม definition หรือไม่?** — ถูกต้องตาม compliance definition (Definition A) เสมอ เพราะนั่นคือสิ่งที่ grading curve ทำจริงตอนนี้ — แต่ยังไม่ยืนยันว่านี่คือ definition ที่ตั้งใจ
5. **ทำไมดูไม่สมจริงใน UX?** — เพราะ verdict label ("Excellent") ให้ความรู้สึกว่าเป็น quality assessment ละเอียด ไม่ใช่แค่ pass/fail — ผู้ใช้คาดหวัง resolution ที่ label สื่อ แต่ตัวเลขไม่ได้ให้จริง
6. **ถ้าไม่ถูกต้อง ปัญหาอยู่ที่ grading หรือ aggregation?** — **grading เท่านั้น** — aggregation พิสูจน์แล้วว่าทำงานถูกต้อง (audit ก่อนหน้า, ไม่พบ resolution loss จาก aggregation เลย)
7. **TH/JP มี meaningful differentiation ตรงไหนแล้ว?** — กว้างมาก นอกโซน PASS ร่วม (ตามตาราง sweep ข้างบน) — ครอบคลุมสถานการณ์จริงส่วนใหญ่ที่น้ำไม่ perfect
8. **จุดที่เท่ากันเป็นอะไร?** — Hybrid ระหว่าง CASE C (compliance ตั้งใจ) กับ documentation/definition gap (verdict label ไม่ตรงกับ grading resolution จริง) — ไม่ใช่ CASE B หรือ D
9. **Product ต้องการ compliance หรือ quality level?** — **ยังไม่มีคำตอบ ต้องตัดสินใจ**
10. **ถ้าต้องการ quality level ต้องเปลี่ยนตรงไหน?** — parameter-level grading function ของทั้ง 5 ประเทศ (ไม่ใช่แค่ TH/JP, ไม่ใช่ aggregation)
11. **มี evidence พอ implement หรือยัง?** — **ยังไม่มี** สำหรับ Option B (ต้องมี field data ใหม่); Option C มี data-layer พื้นฐานอยู่แล้วบางส่วนแต่ยังไม่มี mandate ด้าน architecture
12. **จุดแก้ที่เล็กที่สุด?** — ถ้าเลือก Option A: แก้แค่ label ของ `verdictFrom()` ให้ตรงกับสิ่งที่คะแนนสื่อจริง (ไม่แตะ scoring math เลย)
13. **อะไรทำได้ทันที?** — ไม่มี — แม้แต่ Option A's label fix ก็ยังต้องรอ product decision ว่าจะเลือก Option ไหนก่อน
14. **อะไรต้องรอ Product Decision?** — **ทุกอย่าง** ทั้ง 3 ตัวเลือก ตามที่ระบุไว้ใน Recommendation

---

---

## FINAL PRODUCT DEFINITION ANALYSIS

### The decisive piece of evidence — the project's own architecture diagram

`computeQualityScoreV2.js`, lines 1–13, verbatim, authored by this project
(not inferred, not paraphrased):

```
Product decisions:
  100 = genuinely Near-Ideal / Exceptional Quality
  PASS ≠ 100
  Quality ≠ country Benchmark
  Country differences live in Benchmark engines, not in this Quality model

Architecture:
  Measurements → Compliance (PASS/WARNING/FAIL)
              → Quality Score 0–100 (this module)
              → Benchmark Comparison (Thailand / Japan / WHO / EU / US EPA)
```

**This is the single strongest piece of original-intent evidence found in
the entire repository for this decision.** The project's own architecture
diagram places "Benchmark Comparison" as a **peer of "Compliance
(PASS/WARNING/FAIL)"** — both are downstream outcomes of Measurements,
listed alongside, but explicitly *separate from*, "Quality Score 0–100."
The role of being a continuous 0–100 quality index was **already
explicitly assigned to Quality V3, by name, in this exact comment** — "100
= genuinely Near-Ideal / Exceptional Quality" is stated as a Quality V3
product decision, not a Country Benchmark one. "Country differences live
in Benchmark engines, not in this Quality model" is the project stating,
in its own words, that Country Benchmark's job is to hold *country
differences* (i.e., compare against each country's standard), not to
duplicate Quality V3's near-ideal-proximity role five more times.

### A. Original product intent — compliance, quality, comparison, or combination?

**Comparison/compliance**, per the architecture diagram above. "Benchmark
Comparison" sits in the same architectural tier as "Compliance
(PASS/WARNING/FAIL)" — the naming itself ("Benchmark" = measured against a
reference point) is a compliance-family concept, not a quality-index
concept. Quality V3 was given that role explicitly and separately.

### B. Are Excellent/Good/Acceptable/Attention/Poor labels a semantic contract or presentation?

**Presentation, not a semantic contract**, based on the following: the
labels exist in every engine but are computed from the same flat-in-band
score that the code elsewhere treats as compliance-equivalent (`params`
and `classifications` are computed independently and `classifications`
is unambiguously PASS/WARNING/FAIL/CRITICAL — a compliance vocabulary).
No document or code comment anywhere in the repository states that these
5 tiers were meant to carry graduated meaning *within* a PASS band — they
read as a friendlier restatement of the compliance rollup (a common,
legitimate UX pattern — e.g. health-inspection scores commonly use
"Excellent/Good" language over what is fundamentally a compliance/
violation-count number, not a continuous chemistry index). The tension
identified in the prior pass of this review is real as a *communication*
observation, but does not itself prove the number was intended as a
quality gradient.

### C. Does "100 = perfect quality" or "100 = full compliance" have repo evidence?

**"100 = full compliance," confirmed by the architecture diagram's own
explicit assignment of "Near-Ideal / Exceptional Quality" to Quality V3
specifically, not to Country Benchmark.** No Country Benchmark engine, no
`limits.js`, no `weights.js`, and no doc anywhere claims Country
Benchmark's `100` represents "perfect" or "ideal" water — every engine's
own grading function reaches 100 the instant a value crosses into that
country's accepted range, consistent with compliance semantics only.

---

## Product Flow Impact If Semantic Changed (Compliance → Quality Level) — Not Implemented, Traced Only

```
country selection → country engine → parameter grading → aggregate
  → verdict → comparison result → Hero → findings → API/report
```

If Country Score's semantic were changed from Compliance to Quality
Level, every stage from "parameter grading" onward would need review:

- **parameter grading** — every `grade*()` function's flat-in-band
  behavior would need replacing (evidence does not exist yet, per prior
  pass)
- **aggregate** — unaffected mechanically, but its *meaning* changes
- **verdict** — tier boundaries (90/75/60/40 etc., different per country)
  would need re-derivation against a differently-distributed score
- **comparison result / Hero** — the number displayed changes meaning
  under the user's eyes with no code change needed there, but the Hero
  binding implemented earlier in this thread would now be showing
  "quality level," a claim it doesn't currently make
- **findings** — currently phrased around compliance language ("Free
  chlorine exceeds EU parametric residual value") — would read oddly next
  to a "quality level" framing without a copy review
- **API / reports** — any historical saved score would need a documented
  meaning-shift disclaimer
- **tests** — every in-band exact-value assertion would need review
- **documentation** — this document itself, `COUNTRY_SCORE_REALISM_AUDIT.md`,
  and `SCORING_RESOLUTION_REVIEW.md` all currently describe/assume
  compliance semantics and would need updating

**None of this was changed. This is the traced impact only, per Step 2's instruction.**

---

## User Interpretation Analysis — Chlorine = 0.5 mg/L, All 5 Engines

```
Calculation correctness:  100% correct. Every one of the 5 numbers
                          (100/100/100/100/100) is the accurate output
                          of the code as written, verified in the prior
                          pass.

Semantic correctness:     Also correct, IF Country Score = Compliance
                          Score (this analysis's conclusion) — "all 5
                          countries accept this reading" is a true
                          statement, not an error.

User interpretation risk: Real, but distinct from both of the above. A
                          user who has not been told the number means
                          "compliance" may read identical scores as
                          "identical standards" — a false inference the
                          number does not make, but also does not
                          actively prevent.
```

**These three are genuinely different failure surfaces**, and only the
third is a live concern once Compliance is confirmed as the intended
semantic — and per this task's own hard rule, **fixing that surface is a
UI/communication task explicitly out of scope for this pass**, not a
scoring change.

---

## DECISION MATRIX

| Dimension | Compliance Score | Quality Level |
|---|---|---|
| Meaning of 100 | Fully within the selected country's accepted range | Reading sits at the theoretically ideal point under that country's standard |
| Meaning of PASS | Same event as reaching ~100 (already true in current code) | A separate, lower bar than reaching 100 (PASS could be well below 100) |
| Meaning of "Excellent" | A friendly restatement of "comfortably compliant" | A claim about proximity to the country's own ideal |
| Can two countries both score 100? | Yes, whenever both consider the reading fully accepted — expected, not an error | Only if the reading is equally close to *both* countries' ideal points — coincidental, not expected |
| Does threshold difference need to change score inside PASS band? | No — compliance is binary-flavored by nature | Yes — this is the entire point of the model |
| Evidence required | **None beyond what exists** — current `limits.js` bands already are the evidence | **New field data required**, none exists today (confirmed, prior pass) |
| Current code compatibility | **Matches current implementation almost exactly**, in all 5 engines | Matches only WHO's TDS/Turbidity partially; contradicts the other ~90% of grading logic across all 5 engines |
| Precision risk | Low — no precision claimed beyond band membership | High — any within-band curve invented without evidence repeats the exact overfitting pattern `CALIBRATION_WORKFLOW.md` was built to prevent |
| User interpretation risk | Present (see above), but classified as a communication task, not a scoring task | Would be reduced, at the cost of a much larger and currently-unfunded evidence/build effort |
| Implementation scope | **None required** — already the de facto behavior | 5 engines' grading functions, verdict tiers, tests, docs, API meaning |
| Backward compatibility | Full — no score changes | Broken — every existing in-band score's meaning would shift |

**Qualitative reasoning, not scored:** Compliance Score fits the existing
architecture, existing evidence, and existing code almost exactly, with
zero implementation cost. Quality Level would better match the intuitive
feel of "Excellent/Good/Poor" language and would reduce the specific
misreading risk this whole review thread started from, but requires
evidence collection this project does not currently have, and would
duplicate work Quality V3 already exists to do.

---

## RECOMMENDED SEMANTICS

> **Country Score = Compliance Score.**

**Why:** this is not a preference — it is the semantic the project's own
architecture comment already assigned to Country Benchmark, the semantic
its current code already implements almost universally (4 of 5 engines
purely, WHO mostly), and the only option with zero outstanding evidence
gap. Choosing Quality Level would mean overriding the project's own
documented architecture decision without new evidence to justify doing so
— exactly the kind of ungrounded model change this entire review series
exists to prevent.

**Explicitly not recommending Option C (two-layer model)** — per this
task's own instruction, C requires evidence that the problem is actually
solved by splitting semantics, not just that splitting "looks cleanest."
No such evidence exists: the *actual* problem (verdict labels overstating
resolution) is addressed by Option A plus a documentation/label fix, not
by adding a second number.

---

## Answering Compliance = Correct (Step 7 branch)

Per Step 7's instruction, since Option A is the recommendation:

- **`Thailand = 100` and `Japan = 100` on the same input is confirmed NOT
  a bug.** It is the correct, expected output of a compliance-semantic
  model whenever both countries' standards accept the reading.
- **The remaining, real issue is a SEMANTIC COMMUNICATION GAP** — the
  verdict labels (Excellent/Good/Acceptable/Attention/Poor) currently
  imply more resolution than a compliance score is meant to carry. This
  is a labeling/communication question, not a scoring bug.
- **Scoring engine: should not be changed.**
- **Grading curves: should not be changed.**
- **Aggregation: should not be changed.**
- **Any future fix belongs to how the result is communicated** (copy,
  labels, or supplementary explanatory text — e.g. showing margin-to-
  threshold as informational context alongside, not replacing, the
  compliance number) — **not implemented or designed in this pass**, per
  the hard stop on UI changes.

---

## IMPLEMENTATION CONSEQUENCES

```text
Immediate (this pass): NONE. No code touched.

If this recommendation is later approved by the product owner:
  - No scoring code changes required (grading/aggregation/weights/limits
    already match this semantic).
  - Verdict-label review becomes a legitimate, separately-scoped future
    task (copy/communication, not scoring) — e.g. whether
    "Excellent/Good/Acceptable/Attention/Poor" should be re-labeled to
    avoid implying more resolution than the number carries, or whether
    supplementary margin-to-threshold context should be added to the UI
    without changing the headline number's meaning.
  - ORP's defect (docs/quality-v3/COUNTRY_SCORE_REALISM_AUDIT.md, CASE E)
    remains open and unaffected by this decision either way — it's a
    missing-standard problem, not a semantics problem.
```

---

---

## COUNTRY SCORE REALISM / OVERFITTING AUDIT

Read-only. No production code changed. Source:
`.tmp_probe/overfitting-audit-sweep.js` → `overfitting-wide-sweep.json` /
`overfitting-audit-output.txt` (218-point wide single-parameter sweep per
country: pH 5.0–10.0, TDS 0–2200, Turbidity 0–16, Chlorine 0–5.5, ORP
0–800, DO 0–12, step sizes per the task's own ranges) plus git-history
investigation of the 5 engines' origin commits.

### 1. Current behavior

The reported spread (`TH=100, JP=100, WHO=95, EU=65, EPA=99`) is
reproduced and explained parameter-by-parameter in this document's
earlier sections (Chlorine=0.5/0.7 traces) — not new here. This section
adds what wasn't yet checked: whether the *model itself* generalizes, or
whether it was shaped around specific samples.

### 2. Overfitting evidence — found, but narrower than "the whole model is overfit"

**Git history:** all 5 country engines were created in a single commit,
`f5579564` ("Separate Water Score benchmarks into independent country
engines"), co-authored by an AI agent (`Co-authored-by: Cursor
<cursoragent@cursor.com>`), and modified together (never individually) in
exactly 3 subsequent commits, all touching all 5 engines at once. **No
iterative "adjust until sample X looks right" pattern found** — each
constant appears exactly once in history, no back-and-forth revisions.

**But:** the same founding commit added `docs/BENCHMARK_ENGINE_COMPARISON_SAMPLE.md`
— a document containing **exactly one sample reading** (`ph:7.2, tds:450,
chlorine:0.8, turbidity:2.5, orp:350, do:6.5, temp:28` — this is the same
reading referred to as "LOCKED" earlier in this thread), with a table of
all 5 engines' scores on that one sample and a single headline metric:
**"Spread: 35 points."** This is the project's own documentation of how
the engines were validated at creation time — **by checking that one
sample produced a satisfying-looking spread, not by citing external
per-country regulatory sources for each threshold.** This is real,
concrete evidence of a validation-by-single-sample pattern (milder than
iterative fixture-fitting, since nothing was found to have been
*adjusted* afterward — but the same category of risk this whole review
series' `CALIBRATION_WORKFLOW.md` exists to prevent, one level removed).

**Classification: MODEL-DERIVED for the overall philosophy (per-country
weight emphasis, hard-gate concept), UNKNOWN PROVENANCE for most specific
numeric anchors** (consistent with `PARAMETER_EVIDENCE_MATRIX.md`'s
existing findings for Quality V3 — the pattern repeats one layer down).

### 3. Parameter-level findings

**No monotonicity violations found anywhere** in the 218-point wide sweep
across all 6 parameters × 5 countries (pH 5.0–10.0, TDS 0–2200,
Turbidity 0–16, Chlorine 0–5.5, ORP 0–800, DO 0–12). Every country's score
moves in the correct direction as every parameter worsens, with no
reversals, across a far wider range than any previous pass tested. **This
is a genuine, positive generalization result** — the concern that the
model "looks fit to fixtures and breaks elsewhere" is not supported by
this sweep.

### 4. Anchor provenance

Restates and reconfirms `PARAMETER_EVIDENCE_MATRIX.md`'s existing
classification (not re-litigated, cross-checked): centers/breakpoints
across all 5 engines are predominantly `EXPERT_DECISION` /
`INTERNAL_LEGACY_CONSTANT` / `UNKNOWN`, essentially none `DIRECT_STANDARD`.
This audit's new contribution is the **git-history confirmation** that
this isn't merely "undocumented" but **was never derived from cited
external sources at any point in this project's history** — the founding
commit's own validation artifact (`BENCHMARK_ENGINE_COMPARISON_SAMPLE.md`)
confirms the check performed was sample-comparison, not citation-matching.

### 5. Hard-gate findings — EU's `gateCapOnChlorineFail: 65`

- **No comment or citation anywhere** explaining why 65 specifically (contrast with
  other constants elsewhere in this codebase that at least have a prose
  rationale, even if evidence-weak).
- **Appeared once**, in the founding commit, never revised.
- **Quantified dominance, this pass:** re-running the wide sweep, **51 of
  218 points (23.4%)** — spanning many different parameter combinations,
  not just chlorine values — land at **exactly** 65, because the gate
  overrides whatever the raw weighted composite would have been. Concrete
  example from this pass's own profile sweep: `chlorine_borderline`
  (0.55 mg/L, everything else ideal) has a raw weighted composite of
  **88** before the gate, but the gate forces the displayed score to
  **65** — a 23-point forced reduction with no intermediate value
  possible for any reading between 0.5 and roughly 1.0 mg/L.
- **This does not mean the gate is wrong** — the code comment ("Critical
  chlorine outside band triggers a hard composite cap") states clear
  intent, and a hard safety-style gate is a legitimate design pattern
  (matches candidate `C` in `UNRESOLVED_DECISIONS.md` §1). But **the
  specific value 65, and the specific decision to gate on chlorine only
  and not any other parameter, both have unknown provenance** — this is a
  real, quantified finding, not a hypothesis.

### 6. Score distribution (218-point wide sweep, per country)

| Country | 60–70 | 70–80 | 80–90 | 90–100 | Exactly 100 |
|---|---:|---:|---:|---:|---:|
| Thailand | 0 | 0 | 42 | 176 | 105 (48.2%) |
| Japan | 0 | 28 | 59 | 131 | 70 (32.1%) |
| WHO | 0 | 0 | 80 | 138 | 55 (25.2%) |
| EU | **51** | 20 | 24 | 123 | 62 (28.4%) |
| US EPA | 0 | 22 | 32 | 164 | 92 (42.2%) |

No sweep point landed below 60 for any country except in the 10
representative profiles' deliberately extreme cases (§9 below). All 5
distributions skew heavily toward 90–100 — consistent with a compliance
score under a wide synthetic sweep that spends much of its range inside
various countries' generous PASS bands, not inherently a defect. **EU is
the only country with a discontinuous-looking distribution** — the 51-point
spike exactly at 65 is the hard gate creating a visible plateau in what
would otherwise be a continuous distribution, visible directly in this
histogram.

### 7. Generalization results

Confirmed via the 10 representative profiles (§9) and the 218-point sweep:
**the model generalizes correctly on inputs never referenced in any
fixture or prior audit.** Ordering is sensible (`severe_failure` <
`mixed_failure` < everything else, consistently across all 5 countries),
no reversals, no discontinuities except the one already-known EU gate.
This is evidence *against* "the whole model is fit to look nice on known
fixtures and breaks elsewhere" — that specific failure mode was tested for
directly and not found.

### 8 & 9. TH vs JP / WHO vs EU vs EPA comparison, plus 10 representative profiles

| Profile | TH | JP | WHO | EU | EPA |
|---|---:|---:|---:|---:|---:|
| clearly_excellent | 100 | 100 | 100 | 100 | 100 |
| slightly_imperfect | 100 | 100 | 100 | 100 | 100 |
| chlorine_borderline (0.55) | 100 | 100 | 97 | **65** | 100 |
| high_tds (900) | 100 | 92 | 93 | 93 | 89 |
| high_turbidity (6) | 99 | 89 | 94 | 80 | 78 |
| low_do (3.5) | 100 | 96 | 93 | 96 | 96 |
| low_ph (6.0) | 97 | 100 | 95 | 97 | 97 |
| high_ph (9.0) | 97 | 97 | 95 | 100 | 97 |
| mixed_failure | 98 | 81 | 75 | 62 | 79 |
| severe_failure | **43** | **19** | **29** | **22** | **27** |

Full parameter-level trace, two representative rows (rest in
`overfitting-audit-output.txt`):

**chlorine_borderline** (`chlorine=0.55`, rest ideal): TH/JP/EPA chlorine
param=100 (inside their wide bands); WHO chlorine param=80 (outside its
narrower ideal, "fair" tier); **EU chlorine param=52.5, raw weighted
composite=88, gated final=65.**

**mixed_failure** (`ph=8.8, tds=700, turbidity=3, orp=250, chlorine=1.5, do=4.5`):
params differ meaningfully per engine (e.g. WHO ph=70 vs EU ph=100 — EU's
band is 6.5–9.5, comfortably includes 8.8; WHO's is 6.5–8.5 with a
fair/poor step function, 8.8 falls in "fair") — final scores 98/81/75/62/79,
correctly ordered and none identical, confirming real differentiation
survives a genuinely mixed-quality input.

**No forced ranking observed anywhere** (per Step 11's instruction) —
Japan is not systematically lower or higher than Thailand; the ordering
flips depending on which parameter is stressed (Japan scores worse on
`high_tds`/`high_turbidity`/`mixed_failure` due to its narrower TDS/
turbidity bands and heavier turbidity weight, but scores *better* than
Thailand on `low_ph` due to its wider pH band) — exactly the "different
standard → different evaluation, not a fixed hierarchy" behavior the task
required checking for.

### 10. Root cause

```
I. Combination of B + D + E + H, with a mild form of C:

B — Low-resolution grading model: confirmed, already documented
    (flat-in-band grading across all 5 engines, COUNTRY_SCORE_REALISM_AUDIT.md)

D — Arbitrary anchor selection: confirmed via git history — most
    numeric anchors have no external citation anywhere in this
    project's history, across all 5 engines

E — Hard-gate product design: the GATE CONCEPT is intentional and
    documented; the SPECIFIC VALUE (65) has unknown provenance,
    confirmed via git history (appears once, uncited) and quantified
    this pass (23.4% of a wide sweep collapses to exactly this number)

H — Mixed semantics: already resolved earlier in this document
    (Compliance Score, approved)

C (mild) — Validation-by-single-sample: the founding commit's own
    BENCHMARK_ENGINE_COMPARISON_SAMPLE.md shows the engines were
    checked against one sample's "spread," not derived from cited
    per-country standards -- a milder, one-time version of
    fixture-driven tuning, not iterative overfitting (no evidence of
    repeated adjustment found)

NOT implicated:
A alone -- the model is not simply "correct as-is with nothing to note"
F -- ORP is the only confirmed missing-standard case, tracked separately
G -- aggregation itself tested clean; no monotonicity violations,
     no unexplained aggregation-level discontinuity found anywhere
     in the 218-point sweep
```

### 11. Minimum safe fix

**None proposed this pass.** Per the task's own STOP condition
("arbitrary tuning / fixture-driven anchor / unsupported scoring rule
found → STOP, do not substitute a new guessed number"): the specific
anchor with the clearest, most quantified case for revision — EU's
`gateCapOnChlorineFail: 65` — has no evidence trail to derive a
replacement value from. **Substituting any other number (60? 70? 50?)
would be exactly the same unsupported-anchor problem, just with a
different number.** No fix is proposed.

### 12. Evidence required

To responsibly revisit EU's `65` (or any other flagged anchor): a cited
EU regulatory source specifically addressing what composite consequence
should follow from a chlorine parametric-value exceedance (the EU
Drinking Water Directive 2020/2184 itself is already cited elsewhere in
this codebase for the *band*, 0.1–0.5 mg/L — but not for what a
downstream composite penalty should be), or an explicit product decision
to treat 65 as an intentionally-chosen, non-regulatory product threshold
(in which case it should be documented as such, not left silent).

### 13. Product decision required

1. Should EU's hard-gate value (65) be kept as-is (documented as a
   product choice, not a regulatory citation) or revisited?
2. Should the same "validate by checking a handful of samples" pattern
   found at all 5 engines' founding commit be revisited more broadly, now
   that `CALIBRATION_WORKFLOW.md`'s evidence-partition discipline exists
   and postdates that commit?
3. (Unchanged from earlier in this document) Compliance vs. Quality Level
   semantic decision — approved as Compliance, implemented.

### 14. Production code status

```text
PRODUCTION CODE CHANGED: NO
```

---

---

## COUNTRY SCORE REALISM / OVERFITTING / CALIBRATION RE-AUDIT (Round 2)

Read-only, continues directly from the Overfitting Audit above rather than
repeating it — new work this round: a full weights/hard-gate provenance
table, deliberately-designed cross-country stress profiles (computed
blind, not assumed), and the explicit Case A–F classification this task
requires. `src/js/page-loader.js` was opened in the IDE alongside this
request — noted, not touched, unrelated to this audit.

### 1. Current model origin

**Mixed, and this pass narrows exactly how.** Regulatory-band edges (the
`min`/`max` in each `limits.js`, e.g. pH 6.5–8.5, ORP 200–600) plausibly
trace to real published standards for several parameters — most
credibly, **US EPA's TDS `smcl: 500` matches EPA's actual published
Secondary Maximum Contaminant Level for TDS** (500 mg/L is a real,
independently well-known EPA figure — noted here as external verification
only, per this task's own rule, not as a project citation, since no
in-repo comment cites it). But **weights, hard-gate values, and internal
score-curve anchors not present in `limits.js` (e.g. every engine's
hardcoded `if (tds <= 300)`) have no citation anywhere in the codebase or
its git history.** Confirmed this round: every weights.js file has a
**prose design philosophy** ("turbidity & residual chlorine emphasized,"
"turbidity (TT-like) weighted highest") but **zero justification for the
specific magnitude** (why Japan's turbidity+chlorine are each exactly
0.22, not 0.20 or 0.25).

### 2. Overfitting evidence

```
PROVEN:    validation-by-single-sample at the founding commit
           (BENCHMARK_ENGINE_COMPARISON_SAMPLE.md, one reading, "Spread: 35
           points" as the headline metric) — this is not inferred, it is
           what the project's own founding-commit documentation shows.

LIKELY:    EU's gateCapOnChlorineFail=65 was set with awareness of that
           same sample (both introduced in the identical commit) — cannot
           be proven as "chosen because of" vs. "happened to coincide
           with" from git history alone, since both appeared in one
           commit with no intermediate history to inspect. Stated as
           LIKELY, not PROVEN, for exactly this reason.

POSSIBLE:  the same pattern for other engines' weight distributions —
           plausible given the shared founding commit, not independently
           confirmed for each one.

NOT FOUND: iterative fixture-chasing (repeatedly adjusting a constant
           until a specific sample hit a target score). Git history shows
           every constant appearing exactly once, never revised — this
           specific failure mode was checked for directly and is absent.
```

### 3. Unsupported constants — full provenance table (weights, gates, internal anchors not sourced from `limits.js`)

| Country | Constant | Value | Code location | Type | Provenance | Confidence |
|---|---|---:|---|---|---|---|
| Thailand | all 5 weights | 1 (equal) | `thailand/weights.js` | weight | Comment states "equal weights," no external source needed for equal-weighting itself, but the choice to exclude DO/Temp entirely is undocumented | MODEL-DESIGN, stated but unsourced |
| Japan | turbidity, chlorine weight | 0.22 each | `japan/weights.js` | weight | "turbidity & residual chlorine emphasized" — philosophy stated, magnitude not | MODEL-DESIGN, unsupported magnitude |
| Japan | ph, tds weight | 0.16 each | `japan/weights.js` | weight | No comment addressing these specifically | UNSUPPORTED |
| Japan | do, orp weight | 0.12 each | `japan/weights.js` | weight | No comment | UNSUPPORTED |
| WHO | all 6 weights | 1 (equal) | `who/weights.js` | weight | "equal DWQI-style weights" — names a style, not a source | MODEL-DESIGN, unsupported magnitude |
| EU | chlorine, turbidity weight | 0.25 each | `eu/weights.js` | weight | "chlorine & turbidity dominate" — philosophy stated | MODEL-DESIGN, unsupported magnitude |
| EU | **gateCapOnChlorineFail** | **65** | `eu/limits.js` | hard gate | **No comment, no citation, appeared once at founding commit alongside the single-sample validation doc** | **UNSUPPORTED ANCHOR** |
| US EPA | turbidity weight | 0.30 | `usEpa/weights.js` | weight | "turbidity (TT-like) weighted highest" — references EPA's real Treatment Technique concept for turbidity by name, but not the specific 0.30 magnitude | MODEL-DESIGN, partially-named concept, unsupported magnitude |
| Japan/EU/US EPA | TDS internal "ideal ≤300" | 300 | hardcoded in each `gradeTds()`, not in `limits.js` | internal ramp anchor | Same bare `300` in all three, byte-identical, no comment in any of the three | UNSUPPORTED, and identically shared across 3 engines with no per-country derivation shown |
| All 5 | ORP band 200–600 | — | `limits.js` × 5, `gradeOrp()` × 5 | band + full formula | Already documented (`COUNTRY_SCORE_REALISM_AUDIT.md` CASE E) — byte-identical formula, not just the band | **CONFIRMED UNSUPPORTED, separate track, not re-litigated here** |

**Effect on score, where measurable:** EU's 65 gate — already quantified
(23.4% of a 218-point sweep, up to a 23-point forced reduction from the
uncapped composite in the worked `chlorine_borderline` example). Weight
magnitudes' effect is continuous and smaller per-point but shapes which
parameter dominates each country's composite (e.g. Japan's turbidity
weight 0.22 vs. Thailand's 0.20-equivalent under equal-weighting — a real
but modest difference, not independently quantified further this round).

### 4. Generalization — calibration vs. hold-out

**Calibration set** (present at or used throughout model creation/tuning):
`CASE-1328`, `SYNTHETIC-CASE-B`, `LOCKED`, `POOR`, the
`BENCHMARK_ENGINE_COMPARISON_SAMPLE.md` reading — all pre-existing in this
repository before this audit began.

**Hold-out set** (this pass, and the prior Overfitting Audit pass): the
218-point wide single-parameter sweep, the 10 representative profiles, and
this round's 6 cross-country stress profiles — **none of these values
appear anywhere in git history prior to this review series**, and no
engine constant has been revised since its founding commit (confirmed —
zero follow-up tuning commits exist), so nothing in the "hold-out" set
could have influenced any constant.

**Result: hold-out behavior matches calibration behavior** — same
monotonicity, same ordering logic, no cliff or reversal exclusive to
either set. This is the strongest available evidence that **the
mechanism generalizes**, even though several of its specific constants
remain evidentially unsupported (§3). These are separate findings, not
contradictory ones.

### 5. Hard-gate audit (EU `gateCapOnChlorineFail: 65`, the only hard gate in the system)

| Question | Answer |
|---|---|
| Regulatory evidence for 65 specifically? | **No** |
| Mathematical transformation or product decision? | Product decision (explicit `Math.min(score, cap)`, not derived from any formula) |
| Evidence 65 is the right cap? | **No** |
| Why not 60/70/80? | No basis found for any specific value |
| Set before or after seeing the sample? | **Cannot be determined from git history** — both introduced in the same commit |
| Raw vs. gated difference (worked example)? | 88 → 65 (−23 points), `chlorine_borderline` profile, this round |
| % of a wide sweep affected? | 23.4% (51/218 points), confirmed prior round |
| Does the cap change country ranking? | **Yes, materially** — e.g. this round's `EPA-favoring` profile: EU=65 vs. EPA=100, Thailand=95 — EU drops from what would likely be a top-3 finish to last, solely due to the gate, for a reading where EU's *other* 5 parameters are all ideal |

### 6. Semantic mismatch check

Already resolved earlier in this document (Compliance Score, approved,
implemented). Re-confirmed this round: no new mismatch found between
architecture/implementation/UI in the areas newly audited this pass.

### 7. Thailand vs Japan — systematic, computed not assumed

| Stress profile (designed to test a specific known threshold gap) | TH | JP | Result matches design intent? |
|---|---:|---:|---|
| Chlorine=1.8 (inside TH 0.2–2.0, outside JP 0.1–1.0) | 100 | 86 | **Yes** — TH > JP as the band difference predicts |
| pH=6.0 (outside TH 6.5–8.5, inside JP 5.8–8.6) | 97 | 100 | **Yes** — JP > TH as the band difference predicts |
| Deep-inside-all baseline | 100 | 100 | Yes — both correctly agree when nothing distinguishes them |

Both directions confirmed computationally, not assumed — satisfying this
task's explicit requirement not to presume a fixed hierarchy.

### 7 (continued). WHO / EU / EPA — including one self-correction, reported transparently

| Stress profile | WHO | EU | Result |
|---|---:|---:|---|
| pH=9.0 (outside WHO 6.5–8.5, inside EU 6.5–9.5) | 95 | 100 | EU > WHO, as designed |
| **Chlorine=0.15 (below both WHO's 0.2 floor and EU's 0.1 floor)** | **97** | **100** | **This profile was labeled "WHO-favoring vs EU" when designed, predicting WHO would score higher. The computed result shows the opposite: EU=100 > WHO=97**, because EU's chlorine floor (0.1) is actually *more* permissive than WHO's (0.2) at this specific value — the initial prediction was wrong, and is reported as such rather than relabeled after the fact, per this task's own "compute, don't assume" instruction. |
| Chlorine=3.0 (inside EPA 0.2–4.0, outside everyone else) | 88 | 65 | EPA=100 highest, as designed; EU lowest due to its gate, not because EU is "stricter" in a simple sense — the gate dominates regardless of magnitude |

### 8. Parameter-level audit summary

Full per-parameter, per-country threshold/weight/gate table already exists
in this document's earlier sections and in `COUNTRY_SCORE_REALISM_AUDIT.md`
§B — not reproduced a third time here. This round's addition is the
weights/gate provenance table in §3 above, which that earlier table did
not include.

### 9. Root cause classification — Case A–F

```
Case A (generalizes, semantics not realistic-looking to a user):
  APPLIES. Confirmed §4 — mechanism generalizes cleanly; the
  "doesn't look realistic" reaction traces to the semantic gap already
  resolved earlier in this document (Compliance, not Quality Level),
  not to a mechanical defect.

Case B (unsupported constants, monotonic behavior):
  APPLIES. Confirmed §3 — most weights, the EU gate value, and the
  shared TDS "300" anchor are unsupported; §4 confirms monotonic,
  non-defective behavior around them.

Case C (fit to one fixture):
  PARTIALLY APPLIES, narrowly. Confirmed as "validation-by-single-sample
  at founding" (PROVEN, §2) — but NOT iterative fixture-fitting (checked
  for and NOT FOUND, §2). This is Case C in its mildest form, not its
  worst form.

Case D (implementation defect):
  NOT FOUND. Zero monotonicity violations across 218+ new sweep points
  and 6 new stress profiles this round; TH/JP/WHO/EU/EPA all respond
  correctly and in the predicted direction to genuine threshold
  differences (§7), with the one exception being a wrong prediction on
  this analyst's part, not a code defect (§7 continued).

Case E (low resolution, intentional):
  APPLIES. Flat-in-band grading, already established, now confirmed
  compatible with the approved Compliance semantic (not a defect under
  that semantic).

Case F (mixed semantics):
  DOES NOT APPLY, this round. Already resolved earlier in this document.
```

### 10. Recommendation

```
SAFE TO IMPLEMENT NOW:        Nothing — this remains a read-only audit,
                               no fix is ready or proposed.

REQUIRES EVIDENCE:            EU gateCapOnChlorineFail value (65);
                               the shared, uncited TDS "ideal=300" anchor
                               duplicated across Japan/EU/US EPA;
                               ORP (tracked separately, unchanged).

REQUIRES PRODUCT DECISION:    Whether unsupported weight magnitudes
                               (§3) should be reviewed/re-derived at all,
                               given the mechanism already generalizes
                               correctly under them (§4) — revisiting
                               them is a "how confident do we want the
                               provenance story to be" choice, not a
                               "something is currently broken" one.

DO NOT CHANGE:                Aggregation formula (weighted average
                               itself — tested clean); grading curve
                               shapes (flat-in-band is the approved
                               Compliance semantic, not a bug); any
                               constant for the sole reason that "the
                               resulting number looks high or low."
```

### 11. Exact minimum fix

```text
NO SAFE FIX YET.
```

No constant identified in this or the prior audit round has both (a) a
confirmed defect and (b) sufficient evidence to derive a specific
replacement value. Per this task's own Hard Stop: substituting any number
for `65`, for the shared `300`, or for any weight, without an evidence
trail, would not be a fix — it would be the same unsupported-anchor
problem wearing a different number.

```text
MODEL OUTPUT IS A CONSEQUENCE OF CURRENT, LARGELY UNVERIFIED-BUT-
INTERNALLY-CONSISTENT SEMANTICS. STOPPING HERE.

Production code: READ ONLY, this round — confirmed unchanged.
UI: READ ONLY — confirmed unchanged.
Country engines: READ ONLY — confirmed unchanged.
Quality V3: READ ONLY — confirmed unchanged.
```

---

---

## FINAL CONSTANT PROVENANCE AUDIT

Read-only, final evidence pass. Continues from the two Overfitting Audit
rounds above — this section is the complete inventory those rounds
sampled from, with exact `file:line` for every constant, and the strict
A–E classification this task requires. No production code touched.

### STEP 1/2 — Complete constant inventory, classified

Classification key: **A** = direct standard evidence in repo docs, **B** =
derived from a standard already in the repo, **C** = product/model
decision with documentation, **D** = calibration/assumption, no
standard/evidence, **E** = unknown provenance. Per instruction, D/E are
never upgraded to A/B merely because a comment states intent.

**Thailand** (`limits.js` all constants at lines 12–16; `weights.js` lines
3–7; `score.js` grading functions lines 15–41; `verdictFrom` 90/75/60/40
not shown in the earlier line dump, function follows the grade functions):

| Constant | Value | File:Line | Function | Class | Provenance |
|---|---:|---|---|---|---|
| pH band | 6.5–9.5→ *(Thailand is 6.5–8.5)* | `limits.js:12` | `gradePh` | **C** | `display` string names a band; matches a commonly-published operational pH range, but no in-repo citation to Thailand's actual 2024 standard document |
| pH outside-band slope | 35 | `score.js:18` | `gradePh` | **E** | No comment, no derivation |
| TDS passMax/softStart/softEnd | 1000/1000/1500 | `limits.js:13` | `gradeTds` | **D** | No citation; comment elsewhere in this doc series already noted this is the widest of all 5 engines with no stated reason for the width |
| TDS soft-zone/post-zone slopes | /40, /50 | `score.js:23,25` | `gradeTds` | **E** | No derivation |
| Chlorine band | 0.2–2.0 | `limits.js:14` | `gradeChlorine` | **C** | Matches `display` string, no external citation |
| Chlorine outside-band slopes | ×70, ×25 | `score.js:29-30` | `gradeChlorine` | **E** | No derivation |
| Turbidity passMax/softEnd | 5/12 | `limits.js:15` | `gradeTurbidity` | **D** | No citation |
| Turbidity slopes | ×45, ×4 | `score.js:35,37` | `gradeTurbidity` | **E** | No derivation |
| ORP band | 200–600 | `limits.js:16` | `gradeOrp` | **E** | Already confirmed cross-engine defect, not re-litigated (§8 below) |
| Weights (ph/tds/chlorine/turbidity/orp) | 1 each | `weights.js:3-7` | — | **C** | "equal weights" stated as a choice; DO/Temp exclusion undocumented |
| Verdict tiers | 90/75/60/40 | `score.js` (`verdictFrom`) | `verdictFrom` | **E** | No derivation for these specific cut points |

**Japan** (`limits.js:12-18`, `weights.js:3-8`, `score.js:13-38`):

| Constant | Value | File:Line | Function | Class | Provenance |
|---|---:|---|---|---|---|
| pH band | 5.8–8.6 | `limits.js:12` | `gradePh` | **C** | Named band, no citation to specific Japanese standard |
| pH outside-band slope | 45 | `score.js:16` | `gradePh` | **E** | No derivation |
| TDS internal ideal | **300 (hardcoded, not in limits.js)** | `score.js:19` | `gradeTds` | **D** | Bare literal, no comment, identical to EU/EPA's hardcoded 300 |
| TDS displayMax | 500 | `limits.js:13` | `gradeTds` | **C** | Named in `display`, no citation |
| TDS slopes | /200×20, /15 | `score.js:20-21` | `gradeTds` | **E** | No derivation |
| Chlorine band | 0.1–1.0 | `limits.js:14` | `gradeChlorine` | **C** | Named, no citation |
| Chlorine slopes | ×55, ×40, ×15 | `score.js:25-27` | `gradeChlorine` | **E** | No derivation |
| Turbidity ideal/steepEnd | 2/6 | `limits.js:15` | `gradeTurbidity` | **D** | No citation |
| Turbidity slopes | ×50, ×6 | `score.js:32,34` | `gradeTurbidity` | **E** | No derivation |
| ORP band | 200–600 | `limits.js:16` | `gradeOrp` | **E** | Shared cross-engine defect |
| DO floor | 5 | `limits.js:17` | `gradeDo` | **C** | Named, plausible but uncited |
| Weights | 0.22/0.22/0.16/0.16/0.12/0.12 | `weights.js:3-8` | — | **C** | Philosophy named ("turbidity & chlorine emphasized"), magnitude unsupported |
| Verdict tiers | 85/72/60/40 | `score.js` | `verdictFrom` | **E** | No derivation |

**WHO** (`limits.js:12-18`, `weights.js:3`, `score.js:13-37`):

| Constant | Value | File:Line | Function | Class | Provenance |
|---|---:|---|---|---|---|
| pH band + fair/poor | 6.5-8.5 / 6-9 / 5.5-9.5 | `limits.js:12` | `gradePh` | **C** | Named tiers, no citation for the specific fair/poor cut points |
| pH step values | 100/70/40 | `score.js:14-16` | `gradePh` | **E** | No derivation for why 70 and 40 specifically |
| TDS ideal/fair/poor | 300/600/1000 | `limits.js:13` | `gradeTds` | **B** | Tier *locations* match WHO's own published 5-tier palatability scale (excellent<300 etc.) — already verified via external search in `EVIDENCE_BASED_SCORING_AUDIT.md` §Step 3, the strongest-evidenced constant in this entire audit series |
| TDS tier slopes | 20/30 pts per tier | `score.js:21-22` | `gradeTds` | **D** | Tier *locations* are evidenced (above); the score *drop per tier* (20 then 30 points) is not |
| Chlorine idealMin/Max, fair, poor | 0.2/0.5/1/2 | `limits.js:14` | `gradeChlorine` | **B** (band) / **E** (fair/poor) | Band matches WHO's cited operational floor/target (`EVIDENCE_BASED_SCORING_AUDIT.md`); fair/poor cut points uncited |
| Chlorine step values | 100/80/50/25 | `score.js:37-40` (fn continues past shown range) | `gradeChlorine` | **E** | No derivation |
| Turbidity ideal/fair/poor | 1/5/10 | `limits.js:15` | `gradeTurbidity` | **B** | Center matches WHO's own "<0.1... <1 generally" language loosely (center is 1, not 0.1 — this engine's turbidity ideal is looser than Quality V3's own 0.1 NTU finding) |
| Turbidity tier slopes | 30/40 pts | `score.js:27-28` | `gradeTurbidity` | **D** | Same pattern as TDS |
| ORP band | 200–600 | `limits.js:16` | `gradeOrp` | **E** | Shared cross-engine defect |
| DO floor | 6 | `limits.js:17` | `gradeDo` | **C** | Plausible, uncited |
| Weights | 1 each (equal) | `weights.js:3` | — | **C** | "equal DWQI-style" names a style, not a source |
| Verdict tiers | 80/70/60/40 | `score.js` | `verdictFrom` | **E** | No derivation |

**EU** (`limits.js:12-19`, `weights.js:3-8`, `score.js:14-38`):

| Constant | Value | File:Line | Function | Class | Provenance |
|---|---:|---|---|---|---|
| pH band | 6.5–9.5 | `limits.js:12` | `gradePh` | **C** | Widest pH band of the 5 engines, no citation |
| pH slope | 40 | `score.js:17` | `gradePh` | **E** | No derivation |
| TDS internal ideal | **300 (hardcoded)** | `score.js:20` | `gradeTds` | **D** | Same bare literal as Japan/EPA |
| TDS displayMax/steepAfter | 500/500 | `limits.js:13` | `gradeTds` | **C** | Named, uncited |
| TDS slopes | /200×25, /20 | `score.js:21-22` | `gradeTds` | **E** | No derivation |
| Chlorine band | 0.1–0.5 | `limits.js:14` | `gradeChlorine` | **B** | Matches EU Drinking Water Directive 2020/2184's cited parametric value, already referenced in this codebase's own error messages |
| Chlorine slopes | ×40, ×50, ×10 | `score.js:26-28` | `gradeChlorine` | **E** | No derivation |
| **gateCapOnChlorineFail** | **65** | `limits.js:19` | used in `calculate()`, not shown in grade-function dump | **E — UNKNOWN PROVENANCE, full audit in §5 below** | |
| Turbidity ideal/hardFail | 1/4 | `limits.js:15` | `gradeTurbidity` | **C** | Named, uncited |
| Turbidity slopes | ×55, ×8 | `score.js:32-33` | `gradeTurbidity` | **E** | No derivation |
| ORP band | 200–600 | `limits.js:16` | `gradeOrp` | **E** | Shared cross-engine defect |
| DO floor | 6 | `limits.js:17` | `gradeDo` | **C** | Plausible, uncited |
| Weights | 0.25/0.25/0.15/0.15/0.10/0.10 | `weights.js:3-8` | — | **C** | Philosophy named, magnitude unsupported |
| Verdict tiers | 85/70/55/40 | `score.js` | `verdictFrom` | **E** | No derivation |

**US EPA** (`limits.js:12-18`, `weights.js:3-8`, `score.js:13-38`):

| Constant | Value | File:Line | Function | Class | Provenance |
|---|---:|---|---|---|---|
| pH band | 6.5–8.5 | `limits.js:12` | `gradePh` | **C** | Named, uncited |
| pH slope | 40 | `score.js:16` | `gradePh` | **E** | No derivation |
| TDS internal ideal | **300 (hardcoded)** | `score.js:19` | `gradeTds` | **D** | Same bare literal as Japan/EU |
| TDS smcl | 500 | `limits.js:13` | `gradeTds` | **A** | **This is EPA's actual, real, publicly-published Secondary Maximum Contaminant Level for TDS — external verification only, per this task's own rule, since no in-repo comment cites it, but the number is independently, externally confirmable as a real EPA standard, not invented** |
| TDS slopes | /200×18, /12 | `score.js:20-21` | `gradeTds` | **E** | No derivation |
| Chlorine band | 0.2–4.0 | `limits.js:14` | `gradeChlorine` | **C** | Widest chlorine band of the 5, no citation |
| Chlorine slopes | ×60, ×30 | `score.js:25-26` | `gradeChlorine` | **E** | No derivation |
| Turbidity ttIdeal/steepEnd | 1/5 | `limits.js:15` | `gradeTurbidity` | **C** | `ttIdeal` name references EPA's real Treatment Technique concept, value itself uncited |
| Turbidity slopes | ×60, ×5 | `score.js:31,33` | `gradeTurbidity` | **E** | No derivation |
| ORP band | 200–600 | `limits.js:16` | `gradeOrp` | **E** | Shared cross-engine defect |
| DO floor | 6 | `limits.js:17` | `gradeDo` | **C** | Plausible, uncited |
| Weights | 0.30/0.20/0.15/0.15/0.10/0.10 | `weights.js:3-8` | — | **C** | Philosophy named, magnitude unsupported |
| Verdict tiers | 80/70/60/40 | `score.js` | `verdictFrom` | **E** | No derivation |

**Summary count across all 5 engines:** 2 constants classified **A/B**
(WHO's TDS tier locations, US EPA's TDS `smcl`) — both externally
verifiable against real published standards. 1 constant (EU chlorine
band) classified **B** via an already-cited EU Directive. The
overwhelming majority — every slope, every internal ramp rate, every
verdict tier boundary, all weight magnitudes, and the EU hard-gate value
— are **C** (named philosophy, unsupported magnitude), **D** (bare
numbers with no citation), or **E** (fully unknown), consistently across
all 5 engines. No D/E constant was upgraded based on comment text alone.

---

### STEP 5 — Special audit: EU = 65, full 10-question answer

1. **Who set 65?** Cannot be individually attributed — commit
   `f5579564` is a single squashed commit, co-authored with an AI agent.
2. **Which commit added it?** `f5579564`, "Separate Water Score
   benchmarks into independent country engines," 2026-08-07.
3. **Any document referencing it?** Only indirectly —
   `docs/BENCHMARK_ENGINE_COMPARISON_SAMPLE.md`, added in the *same*
   commit, shows the *output* (EU=65 on the sample reading) but does not
   explain *why* 65 was chosen as the cap.
4. **Any standard supporting it?** None found, across three research
   passes in this review series (internal repo, external WHO/EU search in
   `EVIDENCE_BASED_SCORING_AUDIT.md`, this pass).
5. **Compliance requirement or product decision?** Product decision —
   it's an explicit `Math.min(score, 65)` in code, not a transcription of
   any cited rule.
6. **Calibration anchor?** Cannot be proven either way from git history —
   see Q10.
7. **Raw composite without the gate, representative cases?** From this
   review series' own worked examples: `chlorine_borderline` (0.55 mg/L,
   rest ideal) → raw 88, gated to 65. `LOCKED` fixture (chlorine 0.8,
   mixed other params) → raw composite would need recomputation without
   the gate; not re-derived here since it wasn't requested this round,
   available on request.
8. **Information loss?** Quantified in Round 2: 23.4% of a 218-point wide
   sweep lands at exactly 65.
9. **Any fixture created with 65 as an expected/target output?** Not
   found as an explicit assertion in any test file — `65` does not appear
   as a hardcoded expected value in any `.test.js` file's assertions
   (only as a live-computed value in diagnostic scripts written *during
   this review series*, not pre-existing test expectations).
10. **Chosen before or after seeing sample output?** **Cannot be
    determined** — both the constant and the sample-output document were
    introduced in the same commit, and git history has no finer-grained
    record of authoring order within a single commit. Stated as an
    honest evidentiary limit, not resolved by inference.

### STEP 6 — Special audit: weights, all 5 engines

- **Source?** None of the 30 individual weight values (5 engines × 5–6
  parameters) has a citation.
- **Regulatory or product weighting?** Product weighting — every
  `weights.js` file's comment describes an emphasis choice ("turbidity &
  chlorine emphasized," "turbidity weighted highest"), never a regulatory
  weighting scheme.
- **Mathematical normalization or preference?** Preference — each set
  sums to 1.0 (or is implicitly equal), which is a normalization
  *requirement*, not evidence for the specific *distribution* chosen
  among parameters.
- **Why these specific numbers?** Not determinable from any artifact in
  this repository.
- **Evidence before implementation?** None found.
- **Heuristic chosen by the model's author?** Most consistent
  explanation given the evidence available: yes — round, emphasis-
  consistent numbers (0.22, 0.25, 0.30 as "high," 0.10–0.16 as "low")
  chosen to sum to 1 and match a stated philosophy, not derived from an
  external weighting study.

### STEP 7 — Special audit: TDS = 300

**Standard vs. shared-code-because-no-country-specific-evidence — resolved per engine:**

- **WHO's 300**: comes from `limits.js`'s `tds.ideal`, and — uniquely
  among all 5 engines — has **real external support**: WHO's own
  published 5-tier palatability scale names <300 mg/L as "excellent."
  This one is genuinely standard-derived (Class B).
- **Japan/EU/US EPA's 300**: hardcoded directly in `score.js`, **not**
  read from `limits.js`, byte-identical across all three, **zero
  citation for any of the three specifically**. This is the "shared
  because no country-specific evidence exists" case — three engines
  reusing the same bare number, most plausibly because WHO's evidenced
  figure was copied into the other three without independently deriving
  whether 300 mg/L is *also* the right "ideal" point for Japanese, EU, or
  US drinking water preference specifically (their own `limits.js` files
  define different, larger figures — `displayMax`/`smcl` 500 — for their
  actual regulatory ceiling; 300 only governs where each engine's *ideal*
  zone happens to end, a different concept).
- **Thailand**: does not use 300 at all — its TDS model doesn't have this
  ideal/tiered concept at all (flat `passMax: 1000`), which is itself
  informative — Thailand's engine wasn't built with the same tiered-ideal
  concept as the other four, another sign these curves are more
  ad hoc per-engine than a single shared design.

### STEP 8 — ORP, classification update only (no new research)

Confirmed unchanged from `COUNTRY_SCORE_REALISM_AUDIT.md` CASE E:
**Class E — Unknown Provenance**, for all 5 engines, both the `200–600`
band and the full `gradeOrp()` formula shape (identical across all 5,
not just the band). Not re-researched this round per instruction.

---

### STEP 9 — Overfitting risk vs. constant validity, kept separate

| Constant | Evidence before implementation | Derived from standard | Sample-driven | Arbitrary | Confidence |
|---|---|---|---|---|---|
| WHO TDS tiers (300/600/1000) | Plausible (WHO's own scale) | Yes | No | No | Medium-High |
| US EPA TDS smcl (500) | Plausible (real EPA SMCL) | Yes (externally verified) | No | No | Medium-High |
| EU chlorine band (0.1-0.5) | Yes (cited EU Directive elsewhere in codebase) | Yes | No | No | Medium |
| EU gate cap (65) | No | No | Cannot rule out | Likely | Low |
| All weight magnitudes (30 values) | No | No | No (git history shows no iteration) | Yes, as a design heuristic | Low |
| Shared TDS "ideal=300" in JP/EU/EPA | No (for those 3 specifically) | Partially (copied from WHO's evidenced figure) | No | Partially | Low-Medium |
| ORP band + formula (all 5) | No | No | No | Yes | Low |
| All within-band/outside-band slopes (~40 values) | No | No | No | Yes, as design heuristics | Low |

**Model mechanism generalization** (does the machinery behave sensibly on
new inputs) is confirmed strong across two full audit rounds — this is a
**separate finding** from **constant provenance validity** (do the
specific numbers trace to evidence), which is weak for the large majority
of constants. Both statements are true simultaneously and are not in
tension.

### STEP 10 — Realism impact of low-provenance constants (existing inputs only, no new ranking assumed)

Using only already-computed results from this review series:

- **EU hard-gate**: **high impact** — single-handedly determines whether
  EU appears as the lowest-scoring engine in any chlorine-out-of-band
  scenario, independent of how good every other parameter is (confirmed,
  `EPA-favoring` profile: EU=65 despite 5 of 6 parameters ideal).
- **TDS internal "300"**: **medium impact** — governs exactly where
  Japan/EU/EPA's TDS scoring starts declining; since it's shared
  identically across three engines, it caps how *differentiated* those
  three can be from each other in the 0–300 range specifically (they're
  forced to agree there), while remaining free to diverge above 300 via
  their genuinely different slopes (already confirmed, `SCORING_RESOLUTION_REVIEW.md` §C4).
- **ORP**: **zero impact on differentiation, by construction** — already
  fully documented, produces identical output for all 5 engines at every
  tested input, for any value.
- **Weight magnitudes**: **moderate, diffuse impact** — no single
  dramatic effect like the EU gate, but shapes which parameter dominates
  each country's composite (e.g. Japan's high turbidity+chlorine weights
  vs. Thailand's flat equal-weighting), consistent with, not contradicting,
  each engine's stated philosophy.
- **Thailand vs. Japan specifically**: most-differentiating unsupported
  constant is **each engine's own weight distribution**, not any single
  threshold — Thailand's flat equal-weight vs. Japan's turbidity/chlorine-
  heavy weighting is what makes the *same* parameter-level gap translate
  into different-sized score gaps between the two.

No replacement number proposed for any of the above.

---

### STEP 11 — Final Decision Matrix

| Constant | Current value | Provenance | Evidence strength | Realism risk | Can implement now? | Needs Product Decision? |
|---|---:|---|---|---|---|---|
| WHO TDS tiers | 300/600/1000 | B | Medium-High | Low | — | No — already adequate |
| US EPA TDS smcl | 500 | A (external) | Medium-High | Low | — | No — already adequate |
| EU chlorine band | 0.1–0.5 | B | Medium | Low | — | No — already adequate |
| EU gate cap | 65 | E | Low | **High** | No | **NEEDS EVIDENCE or PRODUCT DECISION** |
| Shared TDS "ideal=300" (JP/EU/EPA) | 300 | D | Low-Medium | Medium | No | **NEEDS EVIDENCE** (or explicit acceptance as intentionally shared) |
| ORP band + formula (all 5) | 200–600 | E | Low | Medium (zero differentiation, by design flaw) | No | **NEEDS PRODUCT DECISION** (already tracked separately) |
| All weight magnitudes (30 values) | various | C | Low | Medium (diffuse) | No | **NEEDS PRODUCT DECISION** — is re-derivation worth the effort given mechanism already generalizes correctly? |
| All within/outside-band slopes (~40 values) | various | E | Low | Low-Medium (smooth, monotonic, but unexplained specific rates) | No | **DOCUMENT ONLY** — lowest priority, no evidence of realism-breaking behavior found despite unsupported magnitudes |
| Verdict tier boundaries (5 engines) | various | E | Low | Low (cosmetic, already flagged as a separate label question earlier in this document) | No | **DOCUMENT ONLY** |

No row is marked "IMPLEMENT NOW" for a change — this remains a read-only
audit. The two constants marked "already adequate" require no action
because their evidence is already sufficient, not because a change was
made.

---

### FINAL REPORT — 15 Questions

1. **All numeric constants?** Full inventory above — approximately 90
   individual constants across 5 engines (bands, slopes, weights, one
   hard gate, verdict tiers).
2. **Where does each come from?** Per-constant in the tables above; in
   aggregate: 2 from real external standards (WHO TDS tiers, EPA TDS
   smcl), 1 from an already-cited EU Directive (chlorine band), the rest
   uncited.
3. **Which have real evidence?** WHO TDS tiers, US EPA TDS smcl, EU
   chlorine band — 3 of ~90.
4. **Which are product/model decisions?** All weight magnitudes (30),
   all band edges without external citation (~25), documented as design
   choices even where the specific number isn't derived.
5. **Which are calibration?** Shared TDS "300" in Japan/EU/EPA (D);
   arguably the EU gate cap, though this can't be proven vs. disproven
   from git history (E, not D, for this reason).
6. **Which are UNKNOWN?** The large majority — every slope coefficient
   (~40), every verdict tier boundary (~20), the ORP band+formula (5),
   the EU gate value (1).
7. **EU = 65, origin?** Full answer, §5 above — unresolvable to a
   specific rationale from available evidence.
8. **Weights, origin?** Full answer, §6 above — heuristic, philosophy-
   documented, magnitude-unsupported.
9. **TDS = 300, origin?** Full answer, §7 above — genuinely evidenced for
   WHO, copied without independent derivation for Japan/EU/EPA.
10. **ORP = 200–600, origin?** Confirmed unchanged, Class E, all 5
    engines, both band and formula.
11. **Highest realism risk?** EU's gate cap (65) — quantified, high-impact,
    zero evidence.
12. **Highest impact on TH vs. JP specifically?** Weight distribution
    (§10) — not any single threshold.
13. **Fixable with evidence already in the repo?** None of the flagged
    D/E constants — everything fixable from in-repo evidence alone (WHO
    TDS, EPA TDS, EU chlorine band) was already correctly classified A/B
    and needs no fix.
14. **Needs Product Decision?** EU gate value, ORP (already tracked),
    weight magnitudes, shared TDS "300" — per the Decision Matrix above.
15. **Enough evidence to change the scoring model now?** **No** — for
    every flagged constant. This is the honest terminus of three audit
    rounds: the mechanism is sound, several specific numbers are not
    evidenced, and no replacement number can responsibly be chosen from
    what currently exists in this repository or its history.

```text
Production code: UNCHANGED
UI: UNCHANGED
Country engines: UNCHANGED
Quality V3: UNCHANGED
```

---

---

## FINAL COUNTRY SCORE TRUSTWORTHINESS REVIEW

Read-only, final synthesis of everything established across the three
prior audit rounds in this document plus new evidence gathered this
round (Profiles I/J/H-detail, artificial-ranking win-count check). No
production code touched.

### 1. Executive conclusion

**Country Benchmark's implementation is correct; its constants are
mostly unverified; and cross-country score comparison currently carries
real, quantified risk that is not disclosed anywhere in the product.**
The honest answer to this round's core question — is Country Benchmark
trustworthy enough to use as a real comparative score — is: **trustworthy
as a compliance signal for a single country in isolation, not yet
trustworthy for numeric cross-country comparison ("Thailand 90 vs. Japan
85").** This is stated directly, not softened.

### 2. Implementation correctness — **HIGH**

Confirmed across three rounds: zero monotonicity violations in 218+ swept
points plus this round's new profiles; deterministic; engines
architecturally isolated (no shared code path, verified via `grep`);
aggregation performs exactly the weighted sum its weights specify; no
implementation defect found anywhere.

### 3. Model validity — **LOW to MEDIUM, uneven across constants**

Of ~90 inventoried constants, 3 trace to real evidence (WHO TDS tiers, US
EPA TDS SMCL, EU chlorine band). The rest — every slope, all 30 weight
values, all verdict tiers, the EU gate value, the ORP band+formula — are
product-decision-documented-but-unsupported or fully unknown provenance.
**Implementation correctness does not imply model validity — these are
confirmed as genuinely separate findings, not in tension.**

### 4. Evidence provenance — summary (full inventory already in this document)

```
3 of ~90 constants:  Class A/B (real evidence)
~87 of ~90:          Class C/D/E (documented-but-unsupported / calibration / unknown)
```

### 5. Cross-country comparability — **LOW, newly quantified this round**

**New finding, this round:** across 11 representative/stress profiles run
throughout this review series, **Thailand scores highest (or ties for
highest) in 9 of 11 (82%)**, versus Japan 4/11, EU 3/11, US EPA 3/11, WHO
2/11 (ties possible, counts overlap). This is not random — it traces
directly to Thailand's engine having the widest, least-evidenced flat
bands in the entire inventory (TDS passMax 1000 vs. others' ~500, both
Class D). **This means "Thailand scored higher than Japan" on a given
reading may partly reflect Thailand's engine having structurally wider
tolerance bands, not necessarily that the water is closer to a
Thailand-specific ideal in any evidenced sense.** A user comparing
`Thailand: 90` against `Japan: 85` has no way to know whether that gap
reflects a real regulatory difference or an artifact of unequal band
width — **this is a direct, quantified answer to Step 8.7's question,
and it is a real risk, not a hypothetical one.**

### 6. Overfitting assessment — unchanged from Round 2, restated briefly

`PROVEN`: validation-by-single-sample at the founding commit.
`NOT FOUND`: iterative fixture-chasing. Mechanism generalizes correctly
on never-seen inputs (re-confirmed again this round with 3 new profiles).

### 7. Unsupported constants — see full inventory above; headline risk items

EU `gateCapOnChlorineFail: 65` (highest realism risk, quantified below);
all 30 weight values; the Japan/EU/US EPA shared, uncited TDS "ideal=300";
ORP (band + entire formula, all 5 engines).

### 8. Semantic risks — including one newly precise finding

**Newly precise this round (Profile I):** ORP's *parameter grade* is
confirmed byte-identical across all 5 engines at every tested value
(unchanged finding) — but this round's Profile I shows the *final
composite* can still differ slightly at extreme ORP values (e.g.
orp=100: TH=90, JP=94, WHO=92, EU=95, EPA=95). **This difference is not a
country-specific ORP judgment** — it is purely an artifact of each
engine's *other* weights diluting the identical ORP grade differently.
Stating this precisely to avoid a false impression that ORP has become
differentiated: it has not: the input parameter itself still receives
identical treatment everywhere; only the arithmetic surrounding it
differs.

**Newly quantified this round (Profile H, "unsupported precision"
pathology, Step 8.5):** EU chlorine at 0.55, 0.8, and 1.5 mg/L — genuinely
different water conditions, with genuinely different raw composites (88,
85, 80) — **all display as identically 65** once the gate applies. A
16-point real difference in the underlying assessment is compressed to
zero visible difference. This is a confirmed, concrete instance of "model
displays precision (65) that the underlying evidence does not
support distinguishing further" — worth stating plainly as a semantic
risk: the number 65 looks precise but actually represents "chlorine
failed," nothing more granular.

### 9. Ten hold-out profile results (A–J, this round + reused from Rounds 1–2)

| Profile | TH | JP | WHO | EU | EPA | Structural expectation | Met? |
|---|---:|---:|---:|---:|---:|---|---|
| A — near ideal | 100 | 100 | 100 | 100 | 100 | All should pass comfortably | Yes |
| B — one param borderline (chlorine 0.55) | 100 | 100 | 97 | 65 | 100 | Narrower-band countries should show more effect | Yes |
| C — one param clearly bad (TDS 900) | 100 | 92 | 93 | 93 | 89 | Score should decline, more for narrower-band countries | Yes |
| D — mixed moderate (Profile J: ph7.8/tds350/turb1.5/orp470/cl0.65/do6.2) | 100 | 99 | 95 | **65** | 97 | No single reading should dominate unless a gate applies | Gate dominates EU regardless — see §8 |
| E — mixed severe | 43 | 19 | 29 | 22 | 27 | All should decline sharply, ordering may vary | Yes, no reversals |
| F — country-discriminating (chlorine 1.8) | 100 | 86 | 92 | 65 | 100 | Standards should diverge where bands differ | Yes |
| G — reverse discriminator (pH 6.0, Japan's band is wider here) | 97 | **100** | 95 | 97 | 97 | Japan should score higher than Thailand here specifically | **Yes — confirmed Japan > Thailand where Japan's standard is genuinely more permissive** |
| H — EU chlorine gate, 3 magnitudes | — | — | — | 65/65/65 | — | Raw composite should differ (it does: 88/85/80); final should not (by gate design) | Gate confirmed to erase a real 16-point spread |
| I — ORP-only variation | varies slightly at extremes | | | | | Parameter grade identical everywhere; composite differences are weight-dilution artifacts only | Confirmed, explained §8 |
| J — no single parameter dominates | 100 | 99 | 95 | 65 | 97 | (same as D — same profile) | Gate still dominates even with nothing else extreme |

### 10. Trust scorecard

| Parameter | Country | Threshold evidence | Grading evidence | Weight evidence | Hard-gate evidence | Trust status |
|---|---|---|---|---|---|---|
| TDS | WHO | Verified (B) | Partial (tier locations yes, slopes no) | Unsupported | N/A | **PARTIALLY VERIFIED** |
| TDS | US EPA | Verified (A, external) | Unsupported | Unsupported | N/A | **PARTIALLY VERIFIED** |
| TDS | Japan, EU | Unsupported (internal "300" uncited for these 2) | Unsupported | Unsupported | N/A | **UNSUPPORTED** |
| TDS | Thailand | Unsupported | Unsupported | Unsupported | N/A | **UNSUPPORTED** |
| Chlorine | EU | Verified (B, cited Directive) | Unsupported | Unsupported | **Unsupported (65)** | **PARTIALLY VERIFIED** (band only) |
| Chlorine | Thailand/Japan/WHO/EPA | Unsupported | Unsupported | Unsupported | N/A | **UNSUPPORTED** |
| pH | all 5 | Unsupported (named, uncited) | Unsupported | Unsupported | N/A | **UNSUPPORTED** |
| Turbidity | all 5 | Unsupported | Unsupported | Unsupported | N/A | **UNSUPPORTED** |
| DO | Japan/WHO/EU/EPA | Unsupported (plausible, uncited) | Unsupported | Unsupported | N/A | **UNSUPPORTED** |
| DO | Thailand | Not scored | N/A | N/A | N/A | **UNRESOLVED** (scope difference, not a grading gap) |
| ORP | all 5 | **Unsupported, confirmed identical across all 5** | **Unsupported, confirmed identical formula** | Unsupported | N/A | **UNSUPPORTED** |

No cell uses "reasonable" as evidence. No cell was upgraded based on
in-code comment text alone.

### 11. Decision matrix

| Area | Current status | Safe to keep? | Evidence needed | Product decision needed |
|---|---|---|---|---|
| WHO TDS tiers | Class B | **SAFE TO KEEP** | — | — |
| US EPA TDS SMCL | Class A | **SAFE TO KEEP** | — | — |
| EU chlorine band | Class B | **SAFE TO KEEP** | — | — |
| Implementation mechanism (aggregation, monotonicity, isolation) | Correct, verified 3 rounds | **SAFE TO KEEP** | — | — |
| All other bands/slopes/verdict tiers | Class C/D/E | **DOCUMENT ONLY** | Would need per-country regulatory research | No — not currently misbehaving |
| Weight magnitudes (30 values) | Class C | **DOCUMENT ONLY** | Would need a weighting study | Yes — is re-derivation worth the cost given mechanism already generalizes? |
| EU gate value (65) | Class E | **NEEDS EVIDENCE** | EU-specific regulatory source for a composite penalty | Yes — or explicit acceptance as a labeled product choice |
| Shared TDS "300" (Japan/EU/EPA) | Class D | **NEEDS EVIDENCE** | Per-country derivation, or accept as intentionally shared | Yes |
| ORP (band + formula, all 5) | Class E | **BLOCKED** | No standard found in 3 independent search passes | Yes — must decide keep/relabel/remove |
| **Cross-country numeric comparability** (new this round) | Not calibrated across engines, quantified structural bias toward Thailand | **BLOCKED for cross-country use** | Would need a cross-country calibration study, which doesn't exist and may not be meaningful to build | **Yes — highest-priority decision this round** |

### 12. Safe-to-implement changes

**None.** Consistent with all three prior rounds — no code change is
proposed or safe to make from current evidence.

### 13. Blocked changes

ORP (any per-country differentiation attempt); any numeric replacement
for the EU gate; any numeric replacement for weights; any attempt to
"calibrate" cross-country comparability without a defined study —
all blocked for the same reason: no evidence exists to derive a specific
replacement, and guessing would not be a fix.

### 14. Required evidence

Per-country regulatory citations for: TDS internal ideal (Japan/EU/EPA
specifically), the EU chlorine hard-gate consequence value, weight
distributions, ORP (any country). None of this exists in the repository
today.

### 15. Required product decisions

1. (Carried from Round 3) EU gate value, shared TDS "300," weight
   magnitudes, ORP.
2. **New, highest priority this round:** should Country Benchmark scores
   ever be displayed or described as cross-country comparable (`"Thailand
   90 vs. Japan 85"` framed as "Thailand's water is better-suited to
   Thai standards than Japan's is to Japanese standards")? Given the
   quantified 82%-Thailand-wins pattern traces partly to unsupported band
   width rather than confirmed regulatory reality, **this specific
   framing carries real risk if presented to users without qualification**
   — a decision, not a code fix.

---

### STEP 11 — Compliance / Quality / Comparative / Hybrid, re-confirmed with no new assumption

Unchanged from the earlier Compliance Score decision in this document —
not re-opened here. **New nuance added by this round:** even under the
confirmed Compliance semantic, "Compliance under Thailand's standard" and
"Compliance under Japan's standard" are **not the same measurement scale**
merely because both output a 0–100 number — §5's finding is precisely
that comparing them numerically requires an additional assumption (that
the two engines' scales are equivalent) which is **not currently
evidenced**. This does not reopen the Compliance-vs-Quality decision; it
adds a **second, separate open question**: compliance-with-A vs.
compliance-with-B being numerically comparable at all.

---

---

## CROSS-COUNTRY COMPARABILITY & REALISM REMEDIATION — FINAL SYNTHESIS

Read-only, final round. Model frozen as baseline throughout (§Step 1
requirement) — nothing below changes any country limit, weight, grading
function, gate, ORP, Quality V3, Hero, or UI. This section answers the
question the previous round could only flag: **exactly why** does
Thailand win/tie 9 of 11 profiles, decomposed cause-by-cause.

### STEP 4 — Decomposing the 82% Thailand pattern (new this round)

| Profile | TH | JP | WHO | EU | EPA | Main cause of TH's result |
|---|---:|---:|---:|---:|---:|---|
| A — clearly excellent | 100 | 100 | 100 | 100 | 100 | Tie — reading genuinely inside every band, not a TH-specific effect |
| B — chlorine borderline (0.55) | 100 | 100 | 97 | 65 | 100 | 3-way tie (TH/JP/EPA) — not TH-specific |
| high_tds (900) | **100** | 92 | 93 | 93 | 89 | **TH wins alone — unsupported wide TDS band (passMax 1000, Class D) — not a confirmed regulatory fact** |
| high_turbidity (6) | **99** | 89 | 94 | 80 | 78 | **TH wins alone — unsupported wide turbidity band (passMax 5, Class D)** |
| low_do (3.5) | **100** | 96 | 93 | 96 | 96 | **TH wins alone — Thailand's engine does not score DO at all (structural exclusion, not a threshold comparison)** |
| low_ph (6.0) | 97 | **100** | 95 | 97 | 97 | TH does **not** win — Japan's genuinely wider pH band (5.8 vs 6.5) wins here |
| high_ph (9.0) | 97 | 97 | 95 | **100** | 97 | TH does **not** win — EU's genuinely wider pH band (to 9.5) wins here |
| mixed_failure | **98** | 81 | 75 | 62 | 79 | **TH wins alone — combined effect of wide TDS+turbidity+chlorine bands, all Class D** |
| severe_failure | **43** | 19 | 29 | 22 | 27 | **TH wins alone even at extreme values — wide bands persist furthest into clearly-bad territory** |
| Profile J (moderate, no single param extreme) | **100** | 99 | 95 | 65 | 97 | **TH wins alone — same wide-band effect, plus EU's gate independently drags EU down** |
| H (EU gate detail) | — | — | — | 65/65/65 | — | Not a TH comparison — gate-specific |

**Decomposition result: of the 6 profiles where Thailand wins *alone*
(not tied), all 6 trace to either (a) Thailand's unsupported, Class-D
wide TDS/Turbidity bands, or (b) Thailand's engine not scoring DO at
all — zero of Thailand's solo wins trace to a confirmed, evidenced
Thailand-specific regulatory advantage.** In the two profiles where a
country's *wider band* genuinely reflects a documented (if uncited)
design choice specific to that parameter (`low_ph`, `high_ph`), **Thailand
does not win** — Japan and EU do, respectively, each on their own wider
band. This is the direct, decomposed answer: **Thailand's apparent
advantage is a construction artifact, not standard-derived, in every
case where it actually determines the outcome alone.**

### STEP 5 — Score-meaning test cases (Profiles A–F, decomposed traces)

**Profile B — Thailand-favorable, Japan stricter** (chlorine 1.8: inside
TH 0.2–2.0, outside JP 0.1–1.0): TH param=100×weight1→final 100; JP
param=65×weight0.22 (diluted into a composite with 5 other ideal
params)→final 86. **Real standard-width difference, both bands are at
least named/documented (Class C), not purely unsupported** — this one
*is* closer to a legitimate standard-derived difference, distinct from
the high_tds/high_turbidity cases above.

**Profile C — Japan-favorable, Thailand stricter** (pH 6.0): JP
param=100 (inside 5.8–8.6)→final 100; TH param=82.5 (outside 6.5–8.5,
declining)→final 97. Same category as above — legitimate band-width
difference, both named.

**Profile D — EU hard-gate** (chlorine 0.55/0.8/1.5, rest ideal): raw
composite 88/85/80 (genuinely different) → all capped to final **65**
(identical) — reconfirmed exact figures from Round 4, not re-derived
differently this round.

**Profile E — Missing parameter** (`low_do`, DO=3.5, rest ideal): **TH=100
(DO not scored, structurally cannot reflect this reading at all)**;
JP=96, WHO=93, EU=96, EPA=96 (all correctly penalize the low DO). This is
the clearest possible demonstration that Thailand's score for this
reading is not "Thailand judges this water good" — it is "Thailand's
model has no opinion on this parameter at all," a meaningfully different
statement conflated by a single number.

**Profile F — Extreme** (`severe_failure`): all 5 decline sharply, no
reversals, Thailand still lowest-total-decline due to band width even
here (43 vs 19–29 for the rest).

### STEP 6 — Does 0–100 mean the same thing across countries?

**No — or more precisely, not yet demonstrated to.** Traced per this
task's required sources:

- **Architecture**: `computeQualityScoreV2.js`'s own comment (already
  quoted earlier in this document) assigns Country Benchmark the
  Compliance role — this defines what the number means *within* one
  engine, not whether two engines' numbers are on the same scale.
- **Comments**: each engine's own weights.js states a *different*
  emphasis philosophy (Japan emphasizes turbidity+chlorine; EU emphasizes
  the same two differently; Thailand is flat-equal) — **by construction,
  a "90" under Japan's weighting scheme and a "90" under Thailand's are
  produced by different formulas**, not a shared one.
- **API**: `WaterScoreBenchmarkRegistry.calculate(key, readings)` returns
  a `score` field with identical shape (0–100) for every engine, but
  nothing in the registry or its callers asserts or enforces cross-engine
  equivalence.
- **UI/verdict**: same 0–100 range and similar (not identical) verdict
  tier boundaries per engine (§7) — presented identically to a user
  regardless of which engine produced it.
- **Tests**: no existing test asserts cross-engine numeric equivalence
  claims (e.g. no test checks "TH=90 and JP=90 must mean the same thing")
  — the codebase has never made this claim explicitly, positively or
  negatively.

**Conclusion: the system does not currently claim cross-country numeric
equivalence anywhere — but it also does nothing to prevent a user from
assuming it, since the presentation (identical 0–100 range, similar
verdict language) invites that assumption.** This is model B in this
task's Step 6 framing is closest — "90/100 water quality" is the
*apparent* framing to a user — but the underlying mechanism is closer to
model A ("compliance with that country's own, differently-constructed
formula"), and **the two are not the same claim.**

### STEP 7 — Verdict semantics vs. score, all 5 engines

Re-confirmed from Round 3's inventory: every engine's `verdictFrom()`
uses a 5-tier Excellent/Good/Acceptable/Attention/Poor-style label
(exact words vary slightly), each with **different numeric cut points**
(Thailand 90/75/60/40; Japan 85/72/60/40; WHO 80/70/60/40; EU 85/70/55/40;
US EPA 80/70/60/40). **A score of exactly 85 is labeled differently
depending on which engine produced it** — "Excellent" under Japan or EU's
cutoffs, but only "Good" under WHO's. This is a **second, distinct
instance of SEMANTIC MISMATCH**, additional to the Compliance-vs-Quality
question already resolved earlier in this document: even confirming
"Compliance Score" as the intended meaning does not resolve that the same
number gets a different adjective depending on which engine happens to
be selected. **Not fixed this pass** — flagged only, per instruction.

### STEP 8 — EU hard gate, final confirmation

```
chlorine=0.55: raw=88 -> capped=65  (Δ -23)
chlorine=0.80: raw=85 -> capped=65  (Δ -20)
chlorine=1.50: raw=80 -> capped=65  (Δ -15)
```

Re-confirmed exact, unchanged from Round 4. **Evidence-backed compliance
cap, or implementation/product assumption?** — **Implementation/product
assumption.** No regulatory source found across 4 research passes now
(3 prior + this one); `65` is a `Math.min()` literal with no citation.
**No replacement number proposed.**

### STEP 9 — ORP, confirmed unresolved, not touched

```
ORP STANDARD DEFINITION: UNRESOLVED
Country-specific evidence: NONE found (4 research passes)
Shared operational indicator: YES, by construction (byte-identical
  formula across all 5 engines, confirmed via 71-point sweep, Round 1)
Regulatory parameter for any of the 5 countries specifically: NOT
  CONFIRMED
Current 200-600 origin: Founding commit f5579564, no citation, no
  revision history
```

Not re-researched further, per instruction. Not conflated with the
cross-country comparability question — ORP's problem (zero
differentiation possible for any input) is structurally different from
Thailand's problem (differentiation exists, but partly traces to
unsupported band width) — both are real, both are separate.

### STEP 10 — Three safe product options (analysis only, none implemented)

**Option A — Compliance-only Country Benchmark.** Matches current
architecture exactly. Requires: no code change. Requires: explicit
product/UI acknowledgment that cross-country numeric comparison is not
endorsed (a documentation/copy decision, not a scoring one). This is the
lowest-disruption option and the only one requiring zero new evidence.

**Option B — Country Compliance + Quality Gradient, two channels.**
Blast radius already fully mapped in this document's earlier "Design
Options" section (Option C there) — `WaterScoreBenchmarkRegistry` return
shape, Hero binding, `public-report.js`, every existing test asserting
`.score`, backward compatibility for historical reports. Not re-derived
a second time here; cross-referenced only. Still not implemented,
still requires product approval.

**Option C — Rebuild Country Benchmark from verified standards only.**
Given this round's complete inventory (~90 constants, only 3 Class A/B),
a from-verified-evidence-only rebuild would currently leave **most of the
model undefined** — every unsupported band, slope, weight, and the EU
gate would need to be marked `REMOVE / DOCUMENT / MARK UNKNOWN` rather
than populated, per this option's own rule against guessing. **This
option is evidence-blocked today, not implementation-blocked** — it
cannot proceed further than producing an inventory (already done) until
real per-country regulatory research is conducted, which is outside this
audit's scope (documentation/code investigation only, not external
regulatory research commissioning).

### STEP 11 — Trust level scorecard

| Dimension | Status |
|---|---|
| Code correctness | **VERIFIED** |
| Country threshold evidence | **PARTIAL** (3 of ~90 constants verified; rest documented-but-unsupported or unknown) |
| Weight evidence | **BLOCKED** (0 of 30 weight values evidenced) |
| Grading evidence | **PARTIAL** (WHO's TDS/Turbidity tier locations verified; all slopes/rates unverified across all 5 engines) |
| Hard-gate evidence | **BLOCKED** (the only hard gate, EU's 65, has no evidence) |
| ORP evidence | **BLOCKED** |
| Cross-country comparability | **BLOCKED** (this round's new finding: quantified, decomposed, traced to specific unsupported constants) |
| Product semantics | **NEEDS DECISION** (Compliance-vs-Quality resolved; cross-engine verdict-tier consistency and cross-country comparability claims remain open) |

### STEP 12 — FINAL GO / NO-GO

```text
STATUS: YELLOW — SAFE AS COUNTRY-SPECIFIC COMPLIANCE SIGNAL

Country Benchmark can be used, as-is, to answer "does this reading
comply with Thailand's [or Japan's, WHO's, EU's, US EPA's] own stated
band, per that engine's own formula" — implementation is verified
correct for that purpose.

Country Benchmark must NOT be presented or interpreted as a
cross-country numeric ranking ("Thailand 90 vs Japan 85 means Thailand's
water is better/closer-to-ideal than Japan's") until normalization,
weight, and grading evidence exists to make 0-100 mean the same thing
across engines. This round decomposed and confirmed, case by case, that
the clearest present symptom of this gap (Thailand winning 9/11
profiles) traces to unsupported model construction in 6 of 6 solo-win
cases, not confirmed regulatory reality.
```

### REQUIRED FINAL ANSWERS (17 questions)

1. **What does each Country Benchmark actually mean?** Degree of match to
   that engine's own coded band/weight/gate structure — confirmed
   Compliance-flavored (earlier decision), not necessarily meaning the
   same thing engine-to-engine (this round's finding).
2. **Same semantic across countries?** Not demonstrated — see §6.
3. **Can Thailand 90 vs Japan 85 mean Thailand is "better"?** **No, not
   responsibly** — §4's decomposition shows apparent Thailand advantages
   trace to unsupported construction, not confirmed standard difference.
4. **Why does Thailand win/tie 9/11?** Decomposed §4 — wide unsupported
   TDS/Turbidity bands (Class D) and DO not being scored at all, in every
   solo-win case.
5. **What's a real standard difference?** pH band width differences
   (Japan wider low end, EU wider high end) — Class C, at least named,
   the closest thing to legitimate differentiation found.
6. **What's an implementation/construction difference?** Thailand's
   unsupported TDS/Turbidity band width; DO exclusion; the EU gate value.
7. **What's an unsupported constant?** ~87 of ~90 inventoried constants,
   per Round 3's complete table.
8. **Does EU's 65 have evidence?** No — confirmed again this round, 4th
   research pass.
9. **ORP status?** UNRESOLVED, tracked separately, unchanged.
10. **Do verdict labels match score semantics?** No — new finding this
    round: the same number gets a different adjective depending on engine
    (§7), a second, distinct semantic mismatch beyond the Compliance-vs-
    Quality question.
11. **Cross-country numeric comparison — pass?** **No — BLOCKED.**
12. **Country-specific compliance — pass?** **Yes — VERIFIED correct for
    this narrower use.**
13. **What needs fixing?** Nothing in code, this pass — the "fix" needed
    is either evidence acquisition (weights, EU gate, TDS 300, ORP) or a
    product decision on framing (§10 options), not a code change.
14. **What must not be changed without evidence?** Every Class D/E
    constant identified across all four rounds — no exceptions.
15. **What Product Decisions are needed?** All from Round 4's Open
    Decisions list, plus this round's new #9 (cross-country comparability
    framing) as the single highest-priority item.
16. **Minimum safe implementation?** **None proposed.** If forced to name
    the lowest-risk possible action: Option A (§10) requires zero code
    change, only a documentation/UI-copy acknowledgment that cross-
    country comparison isn't endorsed — but even that copy change is
    explicitly out of scope for this read-only audit.
17. **Regression tests needed before any future deploy?** All existing
    suites (188+ tests across `tests/score/`, `tests/evidence/`,
    `tests/case-persistence-rehydration.test.js` — unchanged, all
    passing per every prior round); plus, if Option A's documentation
    change is ever made, no regression test is needed since no
    computable behavior changes; if Option B or C is ever pursued, full
    new test coverage per the blast-radius map already on record.

```text
Production code: UNCHANGED
Country limits/weights/grading/gates: UNCHANGED
ORP: UNCHANGED, UNRESOLVED
Quality V3: UNCHANGED
UI / Hero: UNCHANGED
No deploy. No commit required by this audit.
```

---

## OPEN DECISIONS

1. **Is "Country Score = Compliance Score" formally approved?** — this
   document recommends it with evidence; approval is still the product
   owner's call.
2. **Should verdict labels be revised** to avoid overstating resolution,
   or is the current Excellent/Good/Poor framing acceptable as
   presentation-only language for a compliance score? — a copy/UX
   decision, out of scope for this pass.
3. **Should supplementary margin-to-threshold information be surfaced**
   (e.g. in findings/reasons) without changing the headline score's
   meaning? — a UI-scoped follow-up, not evaluated here.
4. **ORP** — remains its own, fully separate open decision
   (`COUNTRY_SCORE_REALISM_AUDIT.md` §F), untouched by this document's
   conclusion.
5. **EU's `gateCapOnChlorineFail: 65`** — added by the Overfitting Audit
   above: keep as a documented product choice, or seek/derive a specific
   evidence-backed replacement? No default proposed.
6. **The single-sample validation pattern** used at all 5 engines'
   founding commit — worth a broader review now that
   `CALIBRATION_WORKFLOW.md` exists, or accept as historical and
   unchanged? Not decided here.
7. **The shared, uncited `TDS ideal=300`** hardcoded identically in
   Japan/EU/US EPA's `gradeTds()` — accept as-is (slopes past it differ
   meaningfully, per `SCORING_RESOLUTION_REVIEW.md` §C4) or seek per-
   country derivation? Not decided here.
8. **Unsupported weight magnitudes** (all 5 engines) — worth a dedicated
   re-derivation effort, or accept given the mechanism already
   generalizes correctly under them (Round 2 Overfitting Audit §4/§10)?
   Not decided here.
9. **Cross-country numeric comparability** (Final Trustworthiness Review)
   — should the product ever frame `"Thailand: 90 vs. Japan: 85"` as
   meaning Thailand's water is closer to Thai ideals than Japan's is to
   Japanese ideals? Quantified 82%-Thailand-wins pattern across 11
   profiles traces partly to unsupported band width, not confirmed
   regulatory reality. **Confirmed and decomposed in the final round
   (all 6 solo-win cases trace to unsupported construction, zero to
   confirmed standard difference) — remains the single highest-priority
   open decision from this entire audit series.**
10. **Cross-engine verdict-tier inconsistency** (new, final round) — the
    same numeric score (e.g. 85) is labeled "Excellent" under some
    engines' cutoffs and only "Good" under others'. A second, distinct
    semantic mismatch from the Compliance-vs-Quality question. Not
    decided here.

---

## STOP

```text
MODEL / PRODUCT DEFINITION DECISION REQUIRED
```

This document now provides a specific, evidence-grounded recommendation
(**Compliance Score**) rather than presenting the options neutrally — but
per this task's own instruction, the final approval remains the product
owner's decision, not this document's. Current implementation is
internally consistent with itself (compliance math is correct, aggregation
is correct, no defect found) and — per this pass's finding — **already
matches its own project's documented architectural intent.** The
remaining gap is how the result is communicated, not how it is computed.
**No production code changed in this pass.**

---

## IMPLEMENTATION STATUS (this pass)

```text
Decision:
  Country Benchmark Score = Compliance Score          APPROVED, IMPLEMENTED

Production scoring math (5 country engines):           UNCHANGED
Country thresholds/limits:                              UNCHANGED
Aggregation / weights:                                  UNCHANGED
Quality V3 formula/parameters:                          UNCHANGED
ORP:                                                     UNRESOLVED / NOT MODIFIED
                                                          (separate track, per
                                                          COUNTRY_SCORE_REALISM_AUDIT.md §F)

Files changed this pass:
  src/js/flows/score.js — Hero display now prefers the selected country's
    comparisonScore (WaterScoreBenchmarkRegistry.calculate() output via
    buildComparisonScoreResult()) over Quality V3, falling back to Quality
    V3 only when no comparison score is available, and to the published
    score for the read-only public report view — unchanged from that
    prior behavior. This was already implemented in an earlier pass of
    this thread and is re-verified here as consistent with the Compliance
    Score decision: the binding is semantic-neutral (it displays whatever
    the selected engine computes) and required no further change once the
    semantic decision was confirmed.

Verdict labels (Excellent/Good/Acceptable/Attention/Poor):
  NOT CHANGED this pass. Traced usage: 5 country score.js engines →
  benchmarkMetadata.js (wrapper) → flows/score.js (renderer) →
  i18n.js (translated EN+TH strings). Blast radius spans multiple files
  and both languages — explicitly deferred as its own, separately-scoped
  future task per this pass's STOP-before-relabeling instruction, not
  attempted here.

Verification (this pass, against real production code):
  Group A (overlapping PASS zones, e.g. chlorine 0.2-1.0): TH=JP=WHO=EU=EPA
    all correctly flat/near-flat — confirmed not a defect.
  Group B (threshold-differentiation zones, e.g. TDS>300, Turbidity>2,
    Chlorine<0.2 or >1.0, pH<6.5, DO<5): all 5 engines diverge correctly
    and meaningfully, confirmed with real sweep data.
  Group C (existing fixtures Case A/B): matches previously-documented
    engine output exactly, no new expected values invented.
  Regression: 234 total tests across all existing repo suites, 0 failures.
```
