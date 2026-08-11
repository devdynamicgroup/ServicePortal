# Quality Score Evidence-Based Scoring Audit

**Research & proposal only.** Nothing in this document changed
`computeQualityScoreV2.js`, any `src/js/score/benchmark/**` engine, or any
Case value. See §11 for the explicit change-log.

Steps 1, 2, 5, 7, 8 of this audit's brief largely re-verify ground already
covered by `SCORING_DIAGNOSTIC_REPORT.md` and `PARAMETER_EVIDENCE_MATRIX.md`
against the live code — those sections below summarize and cite rather than
re-derive from scratch. Steps 3, 4, 6, 9, 10, 11 are genuinely new work for
this pass: external regulatory/scientific research, a full mechanism
explanation for the chlorine cliff, and the evidence-classified candidate
table.

---

## Step 1–2 — Current implementation & breakpoint audit (verified against live code)

Read directly from `src/js/score/production/computeQualityScoreV2.js`
(reproduced exactly, not paraphrased):

| Parameter | Ideal/center | Breakpoints (as coded) | Curve type | Source/comment found in repo | Evidence status |
|---|---|---|---|---|---|
| pH | 7.2 | `\|Δ\|` ≤0.15→100, ≤0.4→90, ≤0.8→78, ≤1.3→66, ≤1.8→48, then `clamp(48-(d-1.8)*22, 8, 48)` | Symmetric distance-decay | "midpoint of common 6.5–8.5 acceptability band" | **Center rationale contains a math error — see Step 3/4** |
| TDS | ≤80 | 80→100, 120→92, 200→80, 300→68, 500→52, 1000→34, then `clamp(34-(tds-1000)/40, 5, 34)` | One-sided ramp | "Japan complementary residue preference (30–200)... EPA SMCL 500" | Center citation verified real (Step 3); cutoff choice beyond it is a product decision |
| Turbidity | ≤0.08 | 0.08→100, 0.2→88, 0.5→74, 1.0→60, 3.0→40, 5.0→28, then `clamp(28-(turb-5)*4, 5, 28)` | One-sided ramp | "stricter than former ≤1 plateau and under EU plant operational ref 0.3 NTU (ops ≠ Ideal)" | Center well-aligned with a specific WHO figure (Step 3) — the strongest-supported of the six |
| ORP | 400 | `\|Δ\|` ≤25→100, ≤70→86, ≤130→70, ≤200→58, then two more clamped branches below 200 / above 600 | Symmetric distance-decay | "midpoint of former operational 200–600 (no external Ideal)" — self-admitted | **No source found anywhere, confirmed by external search too** |
| Chlorine | 0.30 | Mixed: distance branches (`\|Δ\|` ≤0.025→100 ... ≤0.22→64) **and** raw-value branches (`fcl<0.1`, `fcl≤1.0`, `fcl≤2.0`) that are separately authored and do not meet continuously — see Step 6 | Mixed distance + raw-value, structurally the most complex curve | "midpoint of former Prod residual 0.2–0.5" | **Center rationale contains the same type of math error as pH — see Step 3/4. Also has a genuine +18pt cliff at 0.08 mg/L — see Step 6** |
| DO | ≥8.0 | 8.0→100, 7.2→90, 6.5→78, 6.0→68, 5.0→52, 3.0→28, then `clamp((doValue/3)*28, 5, 28)`; **no upper bound in this file** | One-sided ramp | "Near-Ideal ≥8.0; ≥6.0 is Compliance floor (~68), not exceptional" | Not a recognized drinking-water regulatory parameter at all — confirmed by external search (Step 3) |
| Aggregation | — | `round((ph+tds+turbidity+orp+chlorine+do)/6)` | Unweighted arithmetic mean, single rounding point | — | LOCKED for this audit per brief — not evaluated for change |

Compliance (`evaluateCompliance()`, separate channel, unchanged by anything
in this audit): `ph 6.5–8.5, tds ≤300, turbidity ≤1, orp 200–600,
chlorine 0.2–0.5, do ≥6` — PASS/WARNING/FAIL only, does not feed Quality.

---

## Step 3 — Evidence Mapping (external research, this pass)

Searched WHO's *Guidelines for Drinking-water Quality* (4th edition +
addenda) chemical/physical fact sheets and related regulatory sources.
**Repository-internal provenance was checked first in prior passes**
(`PARAMETER_EVIDENCE_MATRIX.md`) before this external research began, per
the brief's Step 2 instruction.

| Parameter | WHO/regulatory value found | Classification | What it actually supports |
|---|---|---|---|
| pH | **No health-based guideline value is proposed for pH** — WHO states explicitly that one is not necessary. 6.5–8.5 is treated as an *operational* convenience range, not a health or even a graded-quality target. | Operational only | Supports a **pass/fail-style acceptability band**, not a distance-from-center quality gradient. WHO's own position implies there is no scientific basis for treating pH 7.2 as "better" than pH 6.6 or 8.4, as long as both are inside the operational band. |
| TDS | No health-based guideline (TDS is "not of health concern at levels found in drinking-water"). WHO palatability rating: excellent <300, good 300–600, fair 600–900, poor 900–1200, unacceptable >1200 mg/L. Separately, **Japan's drinking-water standard lists "Residue on evaporation" as a complementary/target-management item with a target range of 30–200 mg/L** (verified via Japan's official standards-revision document) — this is the source the code's comment cites. | Aesthetic/acceptability (WHO) + verified real citation for the Japan figure (complementary item, not core health/regulatory limit) | WHO's own palatability scale would call the code's entire "Near-Ideal" cutoff (≤80) **"excellent"** territory several times over — WHO's own "excellent" starts at <300, nearly 4× more lenient. The Japan citation is real, but the code sets its ideal at the strict low end of that range, not the range's target value itself. |
| Turbidity | WHO: turbidity should be kept **below 1 NTU generally, ideally below 0.1 NTU for effective disinfection** — explicitly tied to disinfection efficacy (chlorine demand, UV shielding of pathogens), not aesthetics. | Operational, disinfection-effectiveness-based | **This is the strongest-supported center in the model.** The code's ≤0.08 NTU ideal sits inside WHO's own "ideally <0.1 NTU for effective disinfection" figure — a specific, cited, disinfection-effectiveness rationale, not an arbitrary aesthetic choice. |
| ORP | No authoritative drinking-water regulatory or scientific standard found specifying an "ideal" ORP value anywhere. Secondary/commercial sources describe 200–600 mV as a *typical observed* range for tap/bottled/rain water — descriptive, not prescriptive. Higher ORP (500+ mV, up to 650+ mV in pools) is associated with active disinfection/oxidation processes, a different context from a "target" for delivered water. | **Unsupported / no evidence found** | Confirms, via independent external search, the same conclusion the repository's own code comment already reached ("no external Ideal"). |
| Chlorine | WHO: **minimum 0.2 mg/L at point of delivery**; **≥0.5 mg/L after ≥30 min contact** for effective disinfection at pH <8.0; up to **5 mg/L** health-based ceiling; **0.5–1.0 mg/L** recommended during diarrhoeal-disease outbreaks or when source water is turbid/alkaline. | Operational (disinfection-effectiveness) + health-based ceiling | The code's 0.2–0.5 mg/L "former Prod residual" band matches WHO's operational range well. This is reasonable evidence for the **band**, but not for a specific "ideal center" within it — WHO does not state that 0.3, or 0.35, or any single point inside 0.2–0.5 is preferable to another; the guidance is a *minimum floor* (0.2) plus a *contact-time-conditional target* (0.5), not a symmetric "ideal center" the way the code's distance-decay curve implies. |
| DO | **Not a WHO or national drinking-water regulatory parameter.** No WHO drinking-water guideline addresses DO at all — it is standard in *surface water/aquatic-life* quality frameworks, not potable-water delivery standards. The "6.5–8 mg/L healthy" figures found in this search trace to **commercial water-sensor vendor blogs** (Atlas Scientific, Sensorex), not government, WHO, or peer-reviewed sources. | **Unsupported / no evidence found — and the closest thing to "evidence" is marketing content, not science** | Confirms and *strengthens* the existing `EXPERT_DECISION, no external source` classification: the popular "8.0 mg/L ideal" framing appears to originate from commercial content, not any authoritative body. |

---

## Step 4 — Quality meaning vs. score, per parameter

| Parameter | What the evidence tells us | Acceptable range (evidenced) | "Good/very good/excellent" gradient evidenced? | Continuous degradation evidenced? | Scientifically justified ideal/center? | Current ideal is... |
|---|---|---|---|---|---|---|
| pH | Operational band exists, no health basis for grading within it | 6.5–8.5 (near-universal convention) | **No** — WHO explicitly declines to grade pH | No | **No** | A product/operational assumption, and its "midpoint" justification is internally miscalculated (Step 6) |
| TDS | Aesthetic/palatability tiers exist from WHO; a real but narrow regulatory-adjacent citation exists for the specific 80 cutoff's neighborhood | <300 "excellent" (WHO); 30–200 "target" (Japan, complementary item) | Yes, for palatability (WHO's 5-tier scale) — but the code's curve does not use WHO's tiers, it uses a different, stricter breakpoint set | Plausible (WHO's tiered scale implies continuous degradation in palatability) | Partial — Japan citation is real but describes a range, not a single ideal point | A product decision layered on top of a real but narrow citation |
| Turbidity | Direct WHO operational statement tied to disinfection effectiveness | <1 NTU general, <0.1 NTU ideal (WHO) | Implicit (lower = more effective disinfection, not a graded "quality" claim) | Plausible, disinfection-effectiveness-based | **Closest thing to yes** of the six parameters | Reasonably evidence-aligned, though breakpoints beyond the center (0.2/0.5/1.0/3.0/5.0) remain unsourced |
| ORP | No authoritative source of any kind | Not established | No | No | **No** | A legacy/internal operational assumption, confirmed by both prior repo audit and this pass's external search |
| Chlorine | WHO operational band + health ceiling exist | 0.2–0.5 mg/L operational (WHO); ≤5 mg/L health ceiling | No graded "ideal-within-band" from WHO — the floor/target framing is not symmetric | Not evidenced for the "distance from ideal" shape the code uses | No — band yes, center no | Band is evidence-aligned; center (0.30) and its stated derivation are not (Step 6) |
| DO | Not a drinking-water parameter in any authoritative source found | Not established for potable water | No | No | **No** | An expert/product assumption with no regulatory or scientific standing found |

---

## Step 5 — Scoring resolution (dense probing)

**Already produced and verified against live code** in
`SCORING_DIAGNOSTIC_REPORT.md` Part 1, at the exact step sizes specified in
this audit's brief (pH 0.1, TDS 10, Turbidity 0.01/0.5, ORP 10, Chlorine
0.01/0.1, DO 0.1). Restating only the conclusion relevant to this pass:
five of six curves (pH, TDS, Turbidity, ORP, DO) are smooth and monotonic
with no unsupported precision or hidden cliffs; Chlorine has one genuine
discontinuity, mechanism explained fully in Step 6 below. Full point-by-
point tables (every value, every delta) are in that report — not
reproduced here to avoid duplicating ~500 already-verified data rows.

---

## Step 6 — The chlorine cliff: full mechanism explanation

**Investigated directly in the source** (`gradeChlorine()`,
`computeQualityScoreV2.js` lines 76–87). This is not a rounding artifact —
it is a **structural collision between two independently-authored branches
of the same function** that were never checked for continuity where they
meet.

```js
function gradeChlorine(fcl) {
  const ideal = 0.3;
  const d = Math.abs(fcl - ideal);
  if (d <= 0.025) return 100;
  if (d <= 0.08) return lerp(d, 0.025, 100, 0.08, 88);
  if (d <= 0.15) return lerp(d, 0.08, 88, 0.15, 74);
  if (d <= 0.22) return lerp(d, 0.15, 74, 0.22, 64);   // ← branch A (distance-based)
  if (fcl < 0.1) return clamp(lerp(fcl, 0, 18, 0.1, 58), 8, 58);  // ← branch B (raw-value)
  ...
}
```

Trace for the two values where the cliff was found:

- `fcl = 0.08`: `d = |0.08 − 0.3| = 0.22`. The check `d <= 0.22` is
  evaluated **first** in the if-chain and is true (0.22 ≤ 0.22), so
  **branch A** fires: `lerp(0.22, 0.15, 74, 0.22, 64)` → returns `64`
  (the branch's own upper `x` bound, `d=0.22`, maps exactly to its `y1`
  value, `64`).
- `fcl = 0.07`: `d = |0.07 − 0.3| = 0.23`. This fails `d <= 0.22`, so
  control falls through to **branch B**: `fcl < 0.1` is true, so
  `clamp(lerp(0.07, 0, 18, 0.1, 58), 8, 58)` → `18 + 40×0.7 = 46`.

**Why this produces a cliff and not a smooth join:** branch A (the
symmetric "distance from the 0.30 ideal" curve) governs every `fcl` where
`d ≤ 0.22`, i.e. `fcl ∈ [0.08, 0.52]`. Branch B (a *different*, raw-value-
based ramp, apparently intended to model "chlorine so low it risks
under-disinfection" as a distinct concern from "merely far from ideal") is
only reached when `fcl < 0.1` **and** branch A didn't already claim the
value. Because branch A's own window (`fcl ≥ 0.08`) overlaps branch B's
intended window (`fcl < 0.1`), the two formulas fight over `fcl ∈ [0.08,
0.1)`, and branch A wins that overlap because it's checked first in the
if-chain. The result: **the last point still governed by branch A
(`fcl=0.08` → 64) and the first point actually governed by branch B just
below it (`fcl=0.0999` → `lerp(0.0999,0,18,0.1,58)` ≈ 58, and falling
further to `fcl=0.07` → 46) do not agree with each other at their shared
edge** — because they were never designed as one continuous function,
just two separate ones with an unexamined overlap.

- **Is it mathematically intentional?** No evidence of intent found. There
  is no comment anywhere in the file explaining the `fcl < 0.1` branch's
  relationship to the `d <= 0.22` branch immediately above it, and their
  respective y-values at the shared boundary (64 vs. ~58, trending toward
  46) do not match — the hallmark of two formulas authored independently
  rather than one designed curve.
- **Scientific/regulatory justification?** None found. WHO's guidance
  (Step 3) does support treating "chlorine below the operational floor" as
  a distinct, more serious concern than "chlorine merely below the ideal
  center" (under-disinfection risk) — so the *idea* of branch B existing
  is not unreasonable. But WHO's guidance gives no basis for the specific
  shape or the specific 0.1 mg/L cutover point chosen here, and certainly
  no basis for the resulting 18-point jump.
- **Should it remain?** Not addressed by this audit — this is exactly a
  `DECISION REQUIRED` item, not an automatic fix, per this audit's hard
  rules.
- **Separate decision needed?** Yes — whether to (a) leave as-is with the
  rationale now documented, (b) smooth the join between the two branches,
  or (c) redesign the low-chlorine "under-disinfection" concern as an
  explicit, separately-labeled signal rather than a silent branch
  collision, are three materially different choices requiring sign-off.

**Country-benchmark chlorine discontinuities, investigated separately:**
the EU engine's chlorine cliff (`src/js/score/benchmark/eu/score.js`,
`limits.js`) is **structurally different and is explicitly intentional**:
its file header states *"Critical chlorine outside band triggers a hard
composite cap"*, and the code implements exactly that —
`if (chlorineFail) score = Math.min(score, L.gateCapOnChlorineFail)` where
`gateCapOnChlorineFail = 65`. This is a documented, deliberate hard-safety-
gate design (matching candidate `C` — "hard safety gate" — from
`UNRESOLVED_DECISIONS.md` §1, already implemented for one engine/parameter
combination), not an accidental branch collision like the Quality V3 case.
**The two cliffs found in this and the prior diagnostic pass are not the
same kind of issue** — one is undocumented and looks unintentional, the
other is documented and intentional. This distinction was not previously
recorded anywhere.

---

## Step 7 — Case A / Case B: demonstration only

| Parameter | Case A value | Score A | Case B value | Score B |
|---|---:|---:|---:|---:|
| pH | 7.79 | 84.30 | 7.90 | 81.00 |
| TDS | 92 | 97.60 | 155 | 86.75 |
| Turbidity | 0.12 | 96.00 | 0.60 | 71.20 |
| ORP | 434.1 | 97.17 | 507 | 76.13 |
| Chlorine | 0.30 | 100.00 | 0.50 | 66.86 |
| DO | 6.34 | 74.80 | 5.20 | 55.20 |
| **Hero** | | **92** | | **73** |

Per-parameter evidence judgment (not a judgment of the final number):

- **Turbidity (both cases):** appropriately granular and evidence-aligned — Case A's 0.12 NTU sits just above the WHO-aligned 0.08 ideal, and its 96.0 score plausibly reflects a real, small disinfection-effectiveness cost. Case B's 0.60 NTU (71.2) is well past WHO's <1 NTU general threshold's midpoint — reasonable directionally, exact number unsupported.
- **Chlorine (Case A specifically):** 0.30 mg/L scoring 100 is **impossible to fully judge** — it sits exactly on the undocumented center, inside the WHO-supported 0.2–0.5 operational band, but the center's own derivation contains a math error (Step 3/4), so "100" is not wrong, but it is not independently justified either.
- **pH (both cases):** unsupported by WHO's own position that no graded scoring is warranted at all within the acceptability band — both scores are the output of a curve WHO's guidance says shouldn't exist in this graded form, though both values (7.79, 7.90) are comfortably inside every regulatory acceptability band found.
- **ORP, DO (both cases):** impossible to judge against any external evidence — no authoritative source exists for what these numbers should be at all, for either case.
- **TDS (both cases):** overly coarse relative to WHO's own 5-tier palatability scale — the code's curve does not track WHO's excellent/good/fair/poor/unacceptable bands, so Case A's 97.6 and Case B's 86.75 cannot be checked against that scale directly.

**Neither Hero score (92, 73) is judged here as "too high" or "too low."**
The judgment is per-parameter and evidence-based, per this audit's
non-negotiable principle #1.

---

## Step 8 — Country benchmark audit (per-engine, not uniform)

**Already produced against live code** in `SCORING_DIAGNOSTIC_REPORT.md`
Part 3 and `DECISION_MATRIX.md`'s update section. Restating the governing
finding since this audit's brief explicitly warns against assuming
uniformity: engines use **at least 4 different limit/scoring shapes**
(`{min,max}` flat-PASS, `{passMax,softEnd}` ramped-tail, `{ideal,fair,poor}`
fully graded, and several single-sided/display-only shapes). **WHO already
implements genuine graded (non-flat) scoring for TDS and Turbidity**
within what other engines treat as one flat PASS band (`who/score.js`
lines 20–29) — confirmed by direct code read, not assumed. Thailand does
not grade the same parameters the same way (flat-100 across its entire
probed TDS PASS range, 0–1000 ppm). EU implements an intentional hard-gate
cap on out-of-band chlorine (Step 6). This audit did not re-run the
boundary probes; see the diagnostic report for the full per-country,
per-parameter table.

---

## Step 9 — Candidate scoring table (evidence-supported only)

Per the brief: propose a value **only** where evidence supports it; write
`NO EVIDENCE — DO NOT LOCK THIS NUMBER` everywhere it doesn't. This section
proposes zero replacement breakpoints — evidence found this pass supports
*direction and band*, never a specific replacement curve.

| Parameter | Range | Proposed score | Evidence | Confidence |
|---|---|---|---|---|
| pH | Inside 6.5–8.5 | **NO EVIDENCE — DO NOT LOCK THIS NUMBER.** WHO does not support any graded scoring inside this band at all. | — | — |
| pH | Outside 6.5–8.5 | Not evaluated — this audit's scope was the current graded-curve shape, not the compliance boundary | — | — |
| TDS | <300 mg/L | **NO EVIDENCE for a specific score-per-value.** WHO's own tiering (excellent<300/good300–600/fair600–900/poor900–1200) is the only externally-sourced gradient found, but adopting it would be a specific proposal requiring its own sign-off, not an automatic replacement | WHO palatability tiers exist but were never adopted anywhere in this codebase | LOW |
| Turbidity | ≤0.1 NTU | Current ≤0.08 ideal is reasonably evidence-aligned with WHO's "ideally <0.1 NTU for effective disinfection" language | WHO chemical/turbidity fact sheet | MEDIUM — supports the *center*, not the specific breakpoints beyond it |
| ORP | Any | **NO EVIDENCE — DO NOT LOCK THIS NUMBER**, for any value | No authoritative source found in either repo or external search | — |
| Chlorine | 0.2–0.5 mg/L | Band itself is evidence-aligned (WHO operational minimum/target); **no evidence for any single "ideal center" point within it** — DO NOT LOCK a specific center value | WHO chlorine fact sheet | MEDIUM for band, NONE for center |
| DO | Any | **NO EVIDENCE — DO NOT LOCK THIS NUMBER**, for any value | Not a drinking-water regulatory parameter in any source found | — |

The only thing this pass can respons­ibly propose with above-LOW
confidence is: *(a)* Turbidity's center is reasonably defensible as-is,
and *(b)* Chlorine and TDS's **bands** (not centers) have real external
support. Everything else remains **NO EVIDENCE**.

---

## Step 10 — Current vs. evidence-supported alternative (impact analysis only)

| Parameter | Current rule | Evidence-supported alternative | Why |
|---|---|---|---|
| pH | Distance-decay from 7.2 | None proposed — evidence supports pass/fail only, not a replacement gradient | WHO: no graded quality basis exists; proposing a different center (e.g. 7.5, the actual midpoint) would still be inventing a gradient WHO doesn't support |
| TDS | Distance ramp, ideal ≤80 | None proposed — WHO's tiering exists but adopting it is a distinct proposal, not derivable from current evidence alone | Current ideal is ~4× stricter than WHO's own "excellent" tier; not wrong, but not derived from WHO's tiering either |
| Turbidity | Distance ramp, ideal ≤0.08 | **No change proposed** — current center is the best-evidenced of the six | WHO's "ideally <0.1 NTU" independently supports roughly the current center |
| ORP | Distance-decay from 400 | None proposed | No evidence exists for any alternative either |
| Chlorine | Mixed distance + raw-value branches, ideal 0.30, undocumented cliff at 0.08 | None proposed for the center; the **cliff itself** (not the center) is the item most ready for a decision, since it's a structural authoring gap rather than a value-selection question | Band (0.2–0.5) is evidence-aligned; center (0.30) is not derivable from WHO guidance, which gives a floor+target, not a symmetric ideal |
| DO | Distance ramp, ideal ≥8.0, no upper bound | None proposed | Not a regulated parameter in any source found; any alternative would be equally unsupported |

**Case A/B under both models, as impact analysis only** — since Step 9
proposed no replacement breakpoints for 5 of 6 parameters, there is no
second model to run Case A/B against. The only theoretically available
comparison (Turbidity's center, already near-current) would produce no
material change to either case. **No optimization toward a desired Case
A/B outcome was performed or attempted**, consistent with this audit's
non-negotiable principle #2.

---

## Step 11 — Decision gates

| Parameter | Gate | Why |
|---|---|---|
| pH | 🔴 **RED** | Curve shape itself (graded distance-decay) is not supported by WHO's own position that no health-based gradient is warranted; center's stated "midpoint" derivation is mathematically wrong (7.2 claimed as midpoint of 6.5–8.5, actual midpoint is 7.5) |
| TDS | 🟡 **YELLOW** | Band/direction has real external support (WHO tiers + verified Japan citation); exact breakpoint values are a product decision not derivable from either source as currently structured |
| Turbidity | 🟡 **YELLOW**, closest to GREEN | Center is the best-evidenced of the six (WHO's own "<0.1 NTU ideal" language); breakpoints beyond the center remain unsourced |
| ORP | 🔴 **RED** | No source found anywhere, by two independent audit passes (internal + external) |
| Chlorine | 🔴 **RED** | Band is evidence-aligned but center's stated derivation is mathematically wrong (0.30 claimed as midpoint of 0.2–0.5, actual midpoint is 0.35); additionally contains an undocumented, apparently-unintentional +18pt discontinuity at 0.08 mg/L (Step 6) |
| DO | 🔴 **RED** | Not a recognized drinking-water regulatory parameter in any source found; the closest thing to "evidence" for the popular 8.0 mg/L figure traces to commercial marketing content, not science |
| Country plateau structure | 🟡 **YELLOW** | Confirmed non-uniform across engines (Step 8) — some already graded (WHO), some intentionally gated (EU), some flat (Thailand); needs per-engine review, not a blanket fix |
| Aggregation | Not evaluated | LOCKED per this audit's brief |

```text
IMPLEMENTATION READY: NO

PRODUCTION CODE CHANGED: NO

SCORING MODEL CHANGED: NO

CASE VALUES CHANGED: NO

DECISIONS REQUIRED:
1. pH — should Quality even grade pH beyond pass/fail, given WHO's explicit
   position that no health-based gradient exists? If yes, on what basis
   (the current 7.2 center has no valid derivation once its stated
   "midpoint" rationale is corrected)?
2. Chlorine center (0.30) — same math-error problem as pH; WHO supports the
   0.2–0.5 band but gives no basis for a symmetric "ideal center" within it.
3. Chlorine cliff at 0.08 mg/L — keep as-is (with the mechanism now
   documented), smooth the join between the two branches, or redesign the
   low-chlorine concern as an explicit separate signal?
4. TDS ideal (≤80) — keep as a stricter-than-cited product decision, or
   revisit against WHO's own 5-tier palatability scale?
5. ORP center/curve (400, distance-decay) — no evidence exists for any
   value; decide whether to keep as a labeled operational assumption,
   remove the graded curve, or seek a different kind of justification
   entirely (e.g. redefine what ORP is meant to signal in this product).
6. DO center/curve (8.0, no upper bound) — same category as ORP; also
   decide whether an upper physical bound belongs in this curve at all
   (currently handled upstream, not here).
7. Country plateau — WHO's engine already grades TDS/Turbidity within-band;
   decide whether other engines (starting with Thailand, the widest
   plateau found) should follow suit, and if so, on what evidence — the
   EU chlorine hard-gate pattern is a validated precedent for one
   *kind* of within-band severity handling, not necessarily a template
   for graded scoring generally.
```
