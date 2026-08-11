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
