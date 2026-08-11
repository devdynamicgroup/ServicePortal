```text
PRODUCTION CODE CHANGED: NO
SCORING MODEL CHANGED: NO
COUNTRY LIMITS CHANGED: NO
CASE VALUES CHANGED: NO
UI CHANGED: NO
IMPLEMENTATION READY: NO
```

# Quality Score + Country Benchmark — Evidence-Based Scoring Resolution Review

Read-only design review. Every number below was produced by loading the
real, unmodified engines into a `vm` sandbox and reading/probing them
directly — never by trusting prior documentation without re-checking it
against the current code. This pass **found and corrects one meaningful
oversimplification in the prior diagnostic series** (§5).

---

## 1. Executive Summary

**The problem is real and is now precisely located.** Quality V3's
arithmetic-mean aggregation dilutes individual parameter differences —
verified directly: at TDS=301 vs. TDS=299 (a real breakpoint shared by 4
of 5 country engines), **every engine's rounded composite score is
identical** despite the underlying parameter score genuinely changing,
because a single parameter's movement is too small a fraction of a
6-parameter weighted average to survive rounding. This is not a hypothesis
— it's demonstrated in §8/§13 below with the current, unmodified code.

**Two distinct kinds of "flat" were previously conflated and are now
separated:**
1. **Within-band flatness** (pH/ORP/Chlorine: flat-100 strictly inside the
   compliance band, grading only starts once you're outside it) — this
   pattern is **uniform across all 5 country engines**, not a Thailand-only
   or "unlike WHO" issue as a prior pass in this series stated.
2. **Beyond-ideal grading width** (TDS/Turbidity: how far past the "ideal"
   point before grading starts) — this genuinely **does** vary a lot by
   engine: Thailand's flat zone is very wide (TDS to 1000 ppm, Turbidity to
   5 NTU) vs. Japan/EU/EPA (flat to 300 ppm / ~1–2 NTU, then a graded ramp)
   vs. WHO (flat to its own ideal, then a 3-tier graded ramp).

**Evidence supports a real candidate for exactly one parameter's center**
(Turbidity, WHO's own "<0.1 NTU ideal" language) and **real candidates for
two parameters' bands** (Chlorine, TDS — via WHO's operational floor/target
and palatability tiers respectively). **Evidence does not support inventing
within-band grading for pH, ORP, or Chlorine for any engine** — WHO's own
position is that pH doesn't need graded scoring at all, and no source
found (internal or external, across three research passes now) supports a
preference gradient for ORP. Two concrete implementation defects were found
and are not resolution-improvement candidates but pre-existing bugs: the
Quality V3 chlorine curve's undocumented +18pt cliff at 0.08 mg/L, and
confirmation that its root cause is a branch-authoring gap, not a design
choice.

**No number is recommended for production implementation by this
document.** Every proposed change below is marked with its evidence basis
and requires explicit approval.

---

## 2. Current Quality Scoring Matrix (verified against `computeQualityScoreV2.js`)

| Parameter | Measurement ranges (coded) | Score ranges (coded) | Curve behavior | Evidence status | Problem |
|---|---|---|---|---|---|
| pH | `\|Δ from 7.2\|`: ≤0.15 / ≤0.4 / ≤0.8 / ≤1.3 / ≤1.8 / beyond | 100 → 90 → 78 → 66 → 48 → 8 (floor) | Smooth symmetric distance-decay, no cliffs | Center's stated "midpoint of 6.5–8.5" rationale is **numerically wrong** (true midpoint 7.5); WHO itself proposes no graded guideline for pH at all | Curve shape has no scientific basis per WHO's own position; center has no valid derivation once the stated one is corrected |
| TDS | ≤80 / ≤120 / ≤200 / ≤300 / ≤500 / ≤1000 / beyond | 100 → 92 → 80 → 68 → 52 → 34 → 5 (floor) | Smooth one-sided ramp, no cliffs | Center (≤80) is stricter than the real Japan citation it references (30–200 mg/L target range); WHO's own 5-tier palatability scale (<300/600/900/1200) exists but was never adopted here | Curve is internally smooth but its anchor points don't track any single cited source's own tiers |
| Turbidity | ≤0.08 / ≤0.2 / ≤0.5 / ≤1.0 / ≤3.0 / ≤5.0 / beyond | 100 → 88 → 74 → 60 → 40 → 28 → 5 (floor) | Smooth one-sided ramp, no cliffs | Center (≤0.08 NTU) is close to WHO's own "ideally <0.1 NTU for effective disinfection" — best-evidenced center of the six | Breakpoints beyond the center (0.2/0.5/1.0/3.0/5.0) remain unsourced even though the center itself is reasonably supported |
| ORP | `\|Δ from 400\|`: ≤25 / ≤70 / ≤130 / ≤200 / beyond | 100 → 86 → 70 → 58 → floor(8) both directions | Smooth symmetric distance-decay | **No source found**, confirmed independently three times (internal repo audit, external WHO/regulatory search, this pass) | Entire curve is an internal operational assumption with zero external grounding |
| Chlorine | Mixed: distance branches (`\|Δ from 0.3\|` ≤0.025…≤0.22) **and** raw-value branches (`<0.1`, `≤1.0`, `≤2.0`) that were never checked for continuity | 100 → 88 → 74 → 64, then a **second, disconnected formula** for `<0.1` (18→58) | **Genuine +18pt cliff at 0.08 mg/L** — confirmed mechanism: two independently-authored branches overlap at `fcl∈[0.08,0.1)` and the earlier-checked branch wins, producing a discontinuous join | Band (0.2–0.5) is WHO-aligned; center's stated "midpoint" rationale is **numerically wrong** (true midpoint 0.35); the cliff is a structural authoring gap, not evidenced |
| DO | ≥8.0 / ≥7.2 / ≥6.5 / ≥6.0 / ≥5.0 / ≥3.0 / below, **no upper bound** | 100 → 90 → 78 → 68 → 52 → 28 → floor(5) | Smooth one-sided ramp | **Not a recognized drinking-water regulatory parameter in any source found** — the popular "8.0 ideal" figure traces to commercial vendor blogs, not science or regulation | Entire curve lacks any authoritative basis; also has no physical ceiling in this file |
| Aggregation | `round(mean of 6 equally-weighted params)` | — | Single rounding point | LOCKED for this review | Diluting effect demonstrated directly in §8/§13 — not being changed here, but is the single largest driver of "resolution feels coarse" |

---

## 3. Current Country Scoring Matrix (verified against all 5 `score.js` files this pass — corrects a prior oversimplification, see §5)

### 3a. pH / ORP / Chlorine — uniform pattern across all 5 engines

Every engine uses **flat-100 strictly inside its own compliance band**,
grading only once a measurement falls outside it. This is identical in
shape across Thailand, Japan, WHO, EU, and US EPA — **WHO does not do
anything different here**, contrary to what an earlier pass in this
document series stated:

| Country | pH band (flat-100) | ORP band (flat-100) | Chlorine band (flat-100) | Grading outside band |
|---|---|---|---|---|
| Thailand | 6.5–8.5 | 200–600 | 0.2–2.0 | Linear distance-based decline, all three parameters |
| Japan | 5.8–8.6 | 200–600 | 0.1–1.0 | Linear distance-based decline |
| WHO | 6.5–8.5 (then step to 70 at 6–9, 40 at 5.5–9.5, 15 beyond) | 200–600 | 0.2–0.5 (then **step function**: 80 if ≤fair(1), 50 if ≤poor(2), else 25) | **Discrete steps**, not smooth ramps — WHO is actually the *least* granular of the five for chlorine (0.07 and 0.08 mg/L score identically — see §13 scenario E1/E2) |
| EU | 6.5–9.5 | 200–600 | 0.1–0.5 (out-of-band **also triggers a hard composite-score cap at 65**, `gateCapOnChlorineFail`) | Linear decline, plus the intentional hard gate on chlorine specifically |
| US EPA | 6.5–8.5 | 200–600 | 0.2–4.0 | Linear decline |

### 3b. TDS / Turbidity — genuinely varies by engine (all 5 grade eventually, flat-zone width differs)

| Country | TDS flat-zone | TDS graded region | Turbidity flat-zone | Turbidity graded region |
|---|---|---|---|---|
| Thailand | 0–1000 ppm (`passMax`) | 1000–1500 ppm (`softEnd`), then further decline | 0–5 NTU (`passMax`) | 5–12 NTU (`softEnd`), then further decline |
| Japan | 0–300 ppm (hardcoded in `score.js`, not `limits.js`) | 300–500 ppm ramp 100→80, then decline | 0–2 NTU (`ideal`) | 2–6 NTU (`steepEnd`) ramp 100→50, then decline |
| WHO | 0–300 ppm (`tds.ideal`) | **3-tier**: 300–600 ramp 100→80, 600–1000 ramp 80→50, then decline | 0–1 NTU (`ideal`) | **3-tier**: 1–5 ramp 100→70, 5–10 ramp 70→30, then decline |
| EU | 0–300 ppm (hardcoded) | 300–500 ppm ramp 100→75, then decline | 0–1 NTU (`ideal`) | 1–4 NTU (`hardFail`) ramp 100→45, then decline |
| US EPA | 0–300 ppm (hardcoded) | 300–500 ppm (`smcl`) ramp 100→82, then decline | 0–1 NTU (`ttIdeal`) | 1–5 NTU (`steepEnd`) ramp 100→40, then decline |

**Correction to record:** the prior diagnostic pass characterized this as
"WHO already grades, Thailand doesn't, others unknown." The accurate
statement, verified this pass by reading every `score.js` directly, is:
**four of five engines (Japan/WHO/EU/EPA) already grade TDS and Turbidity
beyond a ~300 ppm / ~1–2 NTU flat zone; only Thailand has a genuinely wide
flat zone (1000 ppm / 5 NTU) before any grading begins.** WHO's grading is
the most granular (3 tiers vs. others' 1–2 segments), not the only one that
exists.

### 3c. DO — one-sided, all engines except Thailand (which doesn't score it)

Japan/WHO/EU/EPA: flat-100 at/above their minimum, linear decline below,
no upper bound anywhere. Thailand assigns DO zero weight (not scored at
all in its composite).

---

## 4. Evidence Mapping (consolidated from prior passes, re-verified)

| Parameter | External evidence found | Internal code citation | Verified this pass? |
|---|---|---|---|
| pH | WHO: no health-based guideline; 6.5–8.5 is a near-universal operational convention (used identically by TH/WHO/EPA; JP/EU use slightly wider bands) | "midpoint of 6.5–8.5" — **math error**, true midpoint 7.5 | Yes, re-derived arithmetically this pass |
| TDS | WHO 5-tier palatability scale (<300 excellent...>1200 unacceptable); Japan complementary-item target 30–200 mg/L (verified real document, not core health limit) | "Japan complementary residue preference (30–200)... EPA SMCL 500" | Yes, citation confirmed real via external search in a prior pass |
| Turbidity | WHO: "<1 NTU generally, ideally <0.1 NTU for effective disinfection" — specific, named, mechanism-linked (disinfection efficacy) | "stricter than former ≤1 plateau... EU plant operational ref 0.3 NTU (ops≠Ideal)" | Yes |
| ORP | No authoritative source found in three independent search passes (internal repo, external regulatory, this pass) | "midpoint of former operational 200–600 (no external Ideal)" — self-admitted | Yes, still none found |
| Chlorine | WHO: 0.2 mg/L minimum at delivery, ≥0.5 mg/L post-contact-time target, 5 mg/L health ceiling, 0.5–1.0 mg/L outbreak range | "midpoint of former Prod residual 0.2–0.5" — **math error**, true midpoint 0.35 | Yes, re-derived arithmetically this pass |
| DO | Not a WHO or national drinking-water regulatory parameter in any source found; popular "6.5–8 mg/L" figures trace to commercial vendor blogs | "Near-Ideal ≥8.0" — no linked source | Yes, still none found |

---

## 5. Identified Resolution Problems

1. **Aggregation dilution (verified directly, §13 scenario E5/E6):** at
   TDS=299 vs. TDS=301 — a real breakpoint 4 of 5 country engines treat as
   meaningful — every engine's rounded composite score is unchanged. A
   single parameter's movement is too small a share of a 6-parameter
   (weighted or unweighted) average to survive rounding. This is the
   single largest contributor to "resolution feels coarse," and it is
   **not fixable by touching any individual curve** — it is a property of
   averaging across 6 parameters, locked for this review.
2. **Within-band flatness is uniform, not engine-specific** (§3a) — for
   pH/ORP/Chlorine, all 5 engines treat "anywhere inside the compliance
   band" as equally good. No engine has cited evidence for grading inside
   these bands specifically (WHO's step-function chlorine grading starts
   *outside* its own idealMin/idealMax, same as everyone else).
3. **Quality V3 chlorine cliff** (§2, mechanism in prior audit) — a
   genuine, undocumented, apparently-unintentional +18pt jump, structurally
   independent from the resolution question.
4. **WHO's own chlorine curve is coarser than the ramped alternatives** —
   a discrete 4-step function (100/80/50/25) means, e.g., 0.07 mg/L and
   0.6 mg/L (both "≤fair") score identically despite being materially
   different concentrations. This was not previously documented.
5. **Two parameter centers (pH, Chlorine) have code comments whose own
   stated math is wrong** — already flagged in the prior audit, restated
   here because it directly undermines confidence in "the center is
   evidence-based" for those two specific parameters.

---

## 6. Candidate Quality Scoring Design

No production change. Each row states the single best-evidenced candidate
found (not a menu) — see `CANDIDATE_SCORING_DESIGN_REVIEW.md` for the fuller
multi-option comparison this table distills from.

| Parameter | Current rule | Proposed rule | New breakpoint/anchor | Source | Confidence | Why this improves resolution | Approval required |
|---|---|---|---|---|---|---|---|
| pH | Graded distance-decay from 7.2 | **PRODUCT DECISION REQUIRED** — no proposed replacement number; the open question is structural (should pH be graded at all) | — | WHO pH fact sheet: no health-based guideline necessary | N/A — this is a shape question, not a breakpoint question | Not a resolution improvement — a prerequisite decision that determines whether resolution work on pH is even meaningful | **YES** |
| TDS | ≤80 ideal, single ramp | **PRODUCT DECISION REQUIRED** — WHO's tiers exist but translating them into 0–100 scores is undetermined | Tier locations: <300/600/900/1200 | WHO TDS fact sheet | MEDIUM for tier locations, LOW for any specific score-per-tier mapping | Would let TDS resolution track a named external scale instead of an internally-invented one, IF a mapping is approved | **YES** |
| Turbidity | ≤0.08 ideal | Center → **≤0.1 NTU** | Single breakpoint change | WHO turbidity fact sheet, "ideally <0.1 NTU for effective disinfection" | **EVIDENCE-BACKED** (strongest of the six) | Ties the model's strictest, most consequential threshold to a named mechanism (disinfection efficacy) instead of an internal comparison | **YES** — still requires sign-off even though evidence is strong |
| ORP | Distance-decay from 400 | **NO EVIDENCE** — no replacement proposed for any value | — | Confirmed absent, 3 independent searches | NONE | N/A | **YES** (decision is whether to keep, remove, or relabel the curve, not what number to use) |
| Chlorine (band) | 0.2–0.5 (via center±breakpoints) | Reframe explicitly as floor(0.2)/target(≥0.5)/ceiling(5.0) rather than symmetric center | Same band, different internal shape | WHO chlorine fact sheet | **EXISTING-STANDARD-BACKED** for the 3 cited values | Matches how WHO actually frames chlorine guidance (floor+target+ceiling), not a symmetric ideal | **YES** |
| Chlorine (cliff) | Undocumented +18pt jump at 0.08 | **PRODUCT DECISION REQUIRED** — keep documented as-is, smooth the join, or redesign as an explicit separate signal | — | Mechanism fully explained, no evidence for any specific fix | N/A | Removes an accidental discontinuity, independent of the center/band decision | **YES** |
| DO | ≥8.0 ideal, no ceiling | **NO EVIDENCE** — no replacement proposed | — | Not a drinking-water regulatory parameter in any source found | NONE | N/A | **YES** (decision is whether to keep, remove, or relabel, not what number to use) |

---

## 7. Candidate Country Scoring Design

| Engine / Parameter | Current behavior | Evidence for internal grading? | Proposed rule | Approval required |
|---|---|---|---|---|
| All 5 / pH within band | Flat-100 | **INSUFFICIENT EVIDENCE FOR INTERNAL GRADING** — WHO explicitly does not support grading pH at all | No change proposed | N/A |
| All 5 / ORP within band | Flat-100 | **INSUFFICIENT EVIDENCE FOR INTERNAL GRADING** — no source found for any ORP preference, anywhere | No change proposed | N/A |
| All 5 / Chlorine within band | Flat-100 (WHO's within-band is also flat, its step-function starts outside) | **INSUFFICIENT EVIDENCE FOR INTERNAL GRADING** — WHO's own guidance is floor+target, not a within-band gradient | No change proposed | N/A |
| Thailand / TDS, Turbidity | Very wide flat zone (1000 ppm / 5 NTU) before any grading | **EXISTING-CODE-BACKED precedent exists in the *other four* engines** (all use a ~300 ppm / ~1–2 NTU flat zone) — but Thailand's own `limits.js`/`score.js`/comments give no independent rationale for why its flat zone should be this much wider | Whether Thailand's flat zone should narrow to align with the other four engines' pattern, or whether its width is itself a deliberate Thailand-specific product decision, is unresolved | **YES** |
| WHO / TDS, Turbidity | Already 3-tier graded | No change needed — already the most granular | No change proposed | N/A |
| EU / Chlorine hard gate | Intentional, documented (`gateCapOnChlorineFail: 65`) | **EXISTING-CODE-BACKED** — explicitly documented design, not evidence-derived but also not accidental | No change proposed; flagged only as a validated precedent for "hard gate" as *one* valid design pattern, not a template to copy elsewhere without its own justification | N/A |
| WHO / Chlorine step function | 4-step (100/80/50/25) | Coarser than other engines' ramps (§5.4) | **PRODUCT DECISION REQUIRED** — whether WHO's chlorine curve should become a ramp like the others, given WHO is meant to track WHO's own guideline most closely | **YES** |

---

## 8. Diagnostic Before/After Table

**"Before/after" here means current-code-only** — no candidate design was
implemented, so this table reports the same current formulas probed at
different, deliberately chosen inputs (existing fixtures, and new
scenario points chosen to expose real cross-standard differences). No
tuning toward a target was performed.

| Measurement | Quality | TH | JP | WHO | EU | EPA |
|---|---:|---:|---:|---:|---:|---:|
| CASE-1328 (Case A) | 92 | 100 | 100 | 100 | 100 | 100 |
| SYNTHETIC-CASE-B | 73 | 100 | 100 | 98 | 99 | 99 |

Full scenario A–E results in §13.

---

## 9. Parameter-by-Parameter Decision Matrix

| Parameter | Evidence found | What we know | What we don't know | Decision required |
|---|---|---|---|---|
| pH | No health-based guideline (WHO); band is a convention | The 6.5–8.5-ish band is near-universal across all 5 engines | Whether a graded curve should exist at all; if yes, on what basis | **YES** |
| TDS | WHO 5-tier palatability + real Japan citation | Tiers and citation exist | How to turn either into a 0–100 function; whether current ≤80 (stricter than both sources' own framing) is intentional | **YES** |
| Turbidity | WHO "<0.1 NTU ideal" | Center is well-aligned | Whether breakpoints beyond the center (0.2/0.5/1.0/3.0/5.0) have any basis | **YES**, lower priority — center is close to defensible already |
| ORP | None found, 3 searches | Nothing | Whether to keep, remove, or relabel the entire curve | **YES** |
| Chlorine center/cliff | WHO floor/target/ceiling; cliff mechanism fully explained | Band is defensible; cliff is a bug-like authoring gap, not a value question | Whether to smooth the cliff, and what center (if any) replaces the mathematically-wrong "midpoint" claim | **YES** |
| DO | None found as a regulatory drinking-water parameter | Nothing | Whether to keep, remove, or relabel; whether an upper bound belongs here at all | **YES** |
| Aggregation dilution | Directly demonstrated (§8/§13) | It is real and large enough to erase a real cross-engine breakpoint | Whether product wants to address it (out of scope for this review — LOCKED) | **YES**, but explicitly deferred |
| Country within-band grading | Uniformly absent across all 5 engines for pH/ORP/Chlorine | No engine currently does this | Whether any engine should, and on what evidence | **YES**, per engine |
| Thailand's wide TDS/Turbidity flat zone | Differs from the other 4 engines' pattern | The other 4 use a narrower flat zone | Whether Thailand's width is deliberate or an oversight | **YES** |
| WHO's coarse chlorine step function | Confirmed less granular than ramped alternatives (§13 E1/E2) | It under-differentiates low-chlorine readings | Whether WHO should move to a ramp | **YES** |

---

## 10. Risks / Unknowns

- **Any change to Quality V3's chlorine curve to fix the cliff will move
  Case 1328's score** (it currently scores 0.30, right at the undocumented
  center) — this is expected and acceptable per the evidence framework
  (Case 1328 is calibration data, not a target to protect), but should be
  anticipated, not treated as a regression.
- **Turbidity's center change (0.08→0.1) is the smallest, best-evidenced
  change available, but even this "safe" change has never been tested
  against real field samples** — no outcome-labelled evidence exists
  anywhere in this repository (per `MODEL_PROVENANCE.md`, unchanged status:
  `NOT READY FOR CALIBRATION`).
- **Thailand's flat-zone width may be intentional** (a genuine local
  acceptability judgment reflecting different infrastructure/water-source
  conditions) rather than an oversight — narrowing it without confirming
  which is true risks removing a deliberate product decision.
- **WHO engine changes carry reputational risk specifically** — it's the
  one engine explicitly named after an international authority; any
  internally-invented grading added to it needs to be extremely clearly
  labeled as a product enhancement, not attributed to WHO itself.
- **This review did not test interaction effects** between a Quality
  change and a country-engine change happening in the same release — per
  the phased-rollout principle already established in this document
  series (`SCORING_DIAGNOSTIC_REPORT.md`), any implementation should still
  land one engine at a time.

---

## 11. Explicit Approval Requirements

Every row in §6, §7, and §9 marked "YES" requires an explicit go/no-go
decision from the product/domain owner before any code is touched. None of
those decisions are made by this document. Two decisions are structurally
prior to the rest and should be resolved first, since they change what
"resolution improvement" even means for the affected parameter:
1. Should pH have a graded curve at all? (affects Quality V3 and, if yes,
   whether any country engine should also add within-band pH grading)
2. Should ORP and DO remain as graded quality signals, or be relabeled/
   removed given the total absence of supporting evidence?

---

## 12. Recommendation

**To the product owner, in plain terms:**

- The one change this review can recommend with real confidence is
  **Turbidity's ideal center, from ≤0.08 NTU to ≤0.1 NTU** — it's a small
  change, moves the model *toward* its cited source (not away from it),
  and is the only parameter where WHO gives a specific enough number to
  anchor a center directly. It still needs your sign-off, and it should
  not be treated as validated just because the evidence is comparatively
  strong — no field data exists to confirm the change matters.
- **Two real bugs, independent of any resolution redesign, are worth a
  decision now regardless of the rest of this review**: the Quality V3
  chlorine cliff at 0.08 mg/L (unintentional, mechanism fully documented),
  and the two code comments (pH, Chlorine) whose stated "midpoint" math is
  simply wrong and should at minimum be corrected in the comment even if
  the underlying number isn't changed.
- **Everything else — TDS tiers, chlorine band reframing, ORP/DO's very
  premise, and any country-engine within-band grading — is a genuine
  product decision, not something more research will resolve.** The
  evidence ceiling has been reached for those items with what's available
  in the public WHO guidelines and the repository's own history; further
  progress requires either a product decision to proceed without full
  evidence (labeled as such) or real field data collection per
  `EVIDENCE_ACQUISITION_PROTOCOL.md`.
- **The aggregation-dilution finding (§8/§13, TDS 299 vs. 301 producing
  identical rounded scores everywhere) is arguably the most important
  single finding in this entire review series** — it means no amount of
  per-parameter curve tuning alone will fully solve "resolution feels
  coarse," because the dilution happens at the averaging step, which this
  review was explicitly told not to touch. Recording this clearly so it
  isn't lost: **if resolution is still unsatisfying after any subset of
  the above changes ships, the aggregation question (already tracked as
  open in `UNRESOLVED_DECISIONS.md` §1) is very likely why.**

---

## 13. Diagnostic Scenarios A–E (full results, current code only)

Source: `.tmp_probe/quality-v3-resolution-review-diagnostics.js` →
`resolution-review-diagnostics-output.txt`. No candidate design was
implemented or tuned toward any of these results.

| Scenario | Measurement | Quality | TH | JP | WHO | EU | EPA |
|---|---|---:|---:|---:|---:|---:|---:|
| A — genuinely clean water | ph 7.2, tds 60, turb 0.05, orp 400, cl 0.3, do 8.5 | **100** | 100 | 100 | 100 | 100 | 100 |
| B — moderately degraded | ph 7.6, tds 350, turb 0.8, orp 470, cl 0.6, do 6.2 | **73** | 100 | 99 | 96 | **65** | 99 |
| C1 — TDS=400 (crosses 4 engines' 300-ideal cutoff, still inside TH's 1000 flat zone) | ph 7.2, tds 400, turb 0.08, orp 400, cl 0.3, do 8.0 | 93 | 100 | 98 | 99 | 98 | 98 |
| C2 — Chlorine=0.7 (inside TH/JP/EPA bands, outside WHO/EU bands) | ph 7.2, tds 80, turb 0.08, orp 400, cl 0.7, do 8.0 | 93 | 100 | 100 | 97 | **65** | 100 |
| C3 — pH=8.6 (inside JP/EU bands, outside TH/WHO/EPA bands) | ph 8.6, tds 80, turb 0.08, orp 400, cl 0.3, do 8.0 | 94 | 99 | 100 | 95 | 100 | 99 |
| D — deep inside every standard | ph 7.3, tds 100, turb 0.15, orp 410, cl 0.35, do 7.5 | 96 | 100 | 100 | 100 | 100 | 100 |
| E1 — Quality chlorine 0.07 (just below cliff) | (all else ideal) | 91 | 85 | 86 | 97 | 65 | 88 |
| E2 — Quality chlorine 0.08 (at cliff) | (all else ideal) | **94** | 86 | 88 | 97 | 65 | 89 |
| E3 — EU chlorine 0.5 (EU's own boundary) | (all else ideal) | 94 | 100 | 100 | 100 | 100 | 100 |
| E4 — EU chlorine 0.508 (just past EU boundary) | (all else ideal) | 94 | 100 | 100 | 97 | **65** | 100 |
| E5 — TDS=299 (just under shared 300-ideal cutoff) | (all else ideal) | 95 | 100 | 100 | 100 | 100 | 100 |
| E6 — TDS=301 (just over shared 300-ideal cutoff) | (all else ideal) | 95 | 100 | 100 | 100 | 100 | 100 |

**Reading the scenarios:**

- **A confirms** genuinely clean water still gets a perfect/near-perfect
  score everywhere — no artificial suppression exists.
- **B and C2 show real, meaningful cross-standard differentiation**: EU's
  hard chlorine gate produces a dramatic, correctly-triggered 65 while
  other engines stay high — this is standards genuinely disagreeing, not
  noise. C3 shows the same for pH (JP/EU pass at 8.6, others don't).
- **D confirms** deep-inside-every-standard measurements can legitimately
  score identically across all 5 country engines (all at 100) even while
  Quality V3 (tighter bands) still shows some discrimination (96) — proving
  country engines aren't being forced to differ artificially, and
  incidentally showing Quality V3 already has finer resolution than any
  single country engine in this particular region.
- **E1/E2 confirms** the chlorine cliff's real-world composite impact
  (Quality 91→94, a 3-point jump for a 0.01 mg/L change) and additionally
  reveals **WHO's own chlorine curve doesn't move at all** between these
  two inputs (97→97) — both values fall in the same coarse WHO step,
  independently confirming finding §5.4.
- **E3/E4 confirms** EU's chlorine gate is real, sharp, and isolated to EU
  — no other engine's score changes between 0.5 and 0.508 mg/L except a
  small WHO decline (100→97, its own band edge at the same 0.5 value,
  much gentler than EU's hard gate).
- **E5/E6 is the review's central finding**: crossing a breakpoint that 4
  of 5 engines treat as meaningful (TDS 300 mg/L) produces **zero change**
  in every rounded composite score. This is aggregation dilution,
  demonstrated at a real, evidence-backed threshold — not a hypothetical.
