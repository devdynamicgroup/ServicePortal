```text
NO PRODUCTION CODE CHANGE HAS BEEN MADE.
This report exists so the before/after table and evidence for every
changed number are available for review BEFORE any file under src/ is
touched, per this task's own Hard Safety Rule.
```

# Quality V3 — Reality-First Implementation Report

Scope: **exactly two changes**, both already approved as ready-to-implement
in `REALITY_FIRST_SCORING_REVIEW.md` §8 (items #1 and #2). Nothing else was
touched, explored, or expanded. Validated in isolation via
`.tmp_probe/quality-v3-implementation-report-validation.js` (never
modifies `src/`) against the real, unmodified production engine and all 5
real, unmodified country engines.

---

## 1. Baseline (production, unmodified, re-confirmed this pass)

| Fixture | Quality | TH | JP | WHO | EU | EPA |
|---|---:|---:|---:|---:|---:|---:|
| CASE_A (1328) | 92 | 100 | 100 | 100 | 100 | 100 |
| CASE_B (synthetic) | 73 | 100 | 100 | 98 | 99 | 99 |
| LOCKED | 71 | 100 | 96 | 93 | 65 | 91 |
| POOR | 39 | 87 | 69 | 64 | 52 | 67 |
| CRITICAL | 21 | 56 | 28 | 28 | 16 | 30 |
| NEAR_IDEAL | 100 | 100 | 100 | 100 | 100 | 100 |

---

## 2. Exact Changes Proposed

### Change 1 — Turbidity ideal center

```text
Current:  if (turb <= 0.08) return 100;
Proposed: if (turb <= 0.1)  return 100;
```

All other breakpoints (0.2 / 0.5 / 1.0 / 3.0 / 5.0 and their target scores
88/74/60/40/28) are **unchanged**. No new breakpoint was added.

### Change 2 — Chlorine curve continuity

```text
Current (two colliding branches — see EVIDENCE_BASED_SCORING_AUDIT.md §6
for the full collision mechanism):
  distance-from-0.3 branches for |Δ| ≤ 0.22 (covers fcl ≥ 0.08)
  PLUS a separate raw-value branch for fcl < 0.1
  → these overlap at fcl ∈ [0.08, 0.1) and produce a +18pt cliff at 0.08

Proposed (single continuous function, no overlapping branches):
  if (fcl >= 0.2 && fcl <= 0.5) return 100;
  if (fcl < 0.2)  return clamp(lerp(fcl, 0, 5, 0.2, 100), 2, 100);
  if (fcl <= 5.0) return clamp(lerp(fcl, 0.5, 100, 5.0, 10), 2, 100);
  return clamp(10 - (fcl - 5) * 2, 2, 10);
```

---

## 3. Evidence Supporting Each Change

| Change | Evidence | Source |
|---|---|---|
| Turbidity 0.08→0.1 | "turbidity should be kept... ideally below 0.1 NTU for effective disinfection" — specific, named, mechanism-linked (disinfection efficacy) | WHO Guidelines for Drinking-water Quality, turbidity fact sheet |
| Chlorine flat band 0.2–0.5 | Minimum 0.2 mg/L at point of delivery; ≥0.5 mg/L target for effective disinfection after contact time | WHO Guidelines for Drinking-water Quality, chlorine fact sheet |
| Chlorine ceiling anchor 5.0 mg/L | Health-based guideline value | Same WHO source |
| Chlorine ramp shape (linear, both sides) | **No WHO source specifies a shape between these points** — disclosed as a design choice, not claimed as evidence-derived. Flagged in `REALITY_FIRST_SCORING_REVIEW.md` §8 item #3 as the weakest-held part of this change | — |
| Removing the branch collision itself | Mechanism fully traced: the two original branches were independently authored and never checked for continuity at their shared boundary — not evidence-based, a defect | `EVIDENCE_BASED_SCORING_AUDIT.md` §6 |

---

## 4. Before / After Scoring Table

| Fixture | Quality Before | Quality After | Δ | TH | JP | WHO | EU | EPA |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| CASE_A (1328) | 92 | **92** | 0 | 100 | 100 | 100 | 100 | 100 |
| CASE_B (synthetic) | 73 | **78** | +5 | 100 | 100 | 98 | 99 | 99 |
| LOCKED | 71 | **78** | +7 | 100 | 96 | 93 | 65 | 91 |
| POOR | 39 | **46** | +7 | 87 | 69 | 64 | 52 | 67 |
| CRITICAL | 21 | **26** | +5 | 56 | 28 | 28 | 16 | 30 |
| NEAR_IDEAL | 100 | 100 | 0 | 100 | 100 | 100 | 100 | 100 |

**Country columns are identical before and after in every row** — confirmed
both architecturally (`grep` across every `benchmark/*/score.js` file finds
zero references to `computeQualityScoreV2.js` or `computeQualityScoreDetail`
— the two systems share no code) and empirically (re-ran all 5 country
engines against every fixture post-change; outputs byte-identical to §1).

### Per-parameter attribution (why each Δ happened)

| Fixture | Δ composite | Δ turbidity (param) | Δ chlorine (param) | Attribution |
|---|---:|---:|---:|---|
| CASE_A | 0 | +1.6 | 0.0 | Turbidity 0.12 NTU moved from 96→97.6 at the parameter level, but this alone wasn't enough to shift the rounded 6-parameter composite |
| CASE_B | +5 | 0.0 | +33.1 | Chlorine 0.50 mg/L — exactly WHO's band edge; old distance-decay curve gave 66.86, new WHO-anchored flat band gives 100 |
| LOCKED | +7 | 0.0 | +40.5 | Chlorine 0.80 mg/L — old raw-value branch gave 53.5, new continuous ramp gives 94 |
| POOR | +7 | 0.0 | +43.0 | Chlorine 1.50 mg/L — old branch gave 37, new ramp gives 80 |
| CRITICAL | +5 | 0.0 | +30.0 | Chlorine 3.00 mg/L — old branch gave 20, new ramp gives 50 |

**Every observed change in this table is chlorine-driven, not
turbidity-driven.** Turbidity's center shift only measurably affected
CASE_A among the six fixtures tested, and even there it didn't move the
rounded composite.

---

## 5. Country Comparison

Reconfirmed unaffected (§4 table, TH/JP/WHO/EU/EPA columns). The gap
fixture cited in this task's own prompt was re-verified directly against
the real, unmodified country engines and matches exactly:

| Fixture | TH | JP | WHO | EU | EPA |
|---|---:|---:|---:|---:|---:|
| Chlorine = 0.7 (GAP_CL07) | 100 | 100 | 97 | **65** | 100 |

Confirms: TH/JP/EPA's wider chlorine bands pass this value; WHO's narrower
band produces a moderate decline; EU's band excludes it and triggers EU's
own intentional hard gate. This capability is untouched by the two changes
in this report and continues to work exactly as before.

---

## 6. Regression Results

| Check | Result | Evidence |
|---|---|---|
| Monotonicity — Turbidity, full range [0,8] step 0.02 | **PASS** | No violation found in fine sweep |
| Monotonicity — Chlorine, full range [0,6] step 0.005 | **PASS** | No violation found in fine sweep |
| No new discontinuity — Chlorine | **PASS** | Largest single step in the entire fine sweep is 2.375 points per 0.005 mg/L (at the 0.16 breakpoint join) — an order of magnitude smaller than the +18pt cliff being removed |
| Old cliff zone specifically re-checked | **RESOLVED** | 0.07→38.25, 0.08→43.00 under the candidate (Δ=4.75, consistent with surrounding rate) vs. 0.07→46, 0.08→64 in production (Δ=18) |
| No score inversion | **PASS** | Case ordering check: Case B (78) < Case A (92) holds after the change |
| Clean water not artificially penalized | **PASS** | NEAR_IDEAL unchanged at 100; CASE_A unchanged at 92 (not lowered) |
| Poor water does not improve without cause | **Reviewed, see §7** | POOR and CRITICAL both increase — not "improving without cause," but a direct, evidence-traceable consequence of the chlorine fix (see attribution table, §4) |
| Case B remains worse than Case A | **PASS** | 78 < 92 |
| Quality not overwritten by benchmark engine | **PASS** | Architecturally separate; no shared code path (verified by grep, §4) |
| Country engines remain isolated | **PASS** | Zero references between benchmark engines and the Quality production file |
| Existing country limits unchanged | **PASS** | No `limits.js` file was read for modification, only for reference (already established in prior passes of this review series) |
| Existing Case data unchanged | **PASS** | No Case, fixture, or test file was modified; all inputs used were read-only copies |

---

## 7. Unexpected Score Movement — Flagged, Not Hidden

**The chlorine fix's magnitude is larger in practice than "removing an
18-point cliff" might suggest.** At readings well outside the 0.2–0.5 mg/L
band (0.7, 0.8, 1.5, 3.0 mg/L), the *old* production curve's raw-value
branches were considerably more punishing (e.g. 1.5 mg/L → 37) than the
new WHO-anchored continuous ramp (1.5 mg/L → 80, a +43 point parameter-level
change). This is because the old branches were never evidence-derived —
they were an internally-invented decline rate with no cited basis — while
the new ramp is anchored to WHO's actual floor (0.2), target (0.5), and
health ceiling (5.0). **The old curve was not simply "the same shape with
a cliff removed" — it was substantially steeper throughout its
non-evidenced range**, and correcting the anchor points changes more than
just the discontinuity.

This means: for any real fixture with chlorine meaningfully above 0.5 mg/L
(POOR, CRITICAL, LOCKED, and the between-country gap fixtures), this
change produces a real, several-point composite score increase, not just
a fix at one boundary. **This is reported explicitly because it is larger
than a narrow reading of "fix the cliff" might lead a reviewer to expect,
even though every step of the underlying evidence is sound and was not
adjusted to produce this outcome.**

---

## 8. Remaining Unresolved Decisions — Explicitly Not Expanded

Per this task's own instruction: these two changes do **not** fully solve
the resolution problem this review series started from, and scope is
**not** being expanded to address them without separate approval:

- **Chlorine 0.29/0.30/0.31 remains flat (100/100/100) after this change**
  — correctly so, since all three values sit inside WHO's own evidenced
  0.2–0.5 mg/L flat band. This is not a defect; grading inside it would be
  false precision (`REALITY_FIRST_SCORING_REVIEW.md` §7, risk #1).
- **TDS 299/300/301 and Turbidity 0.09/0.10/0.11 aggregation dilution is
  untouched** — both are properties of the locked 6-parameter equal-weight
  average, not of any individual curve, and this task did not authorize
  touching aggregation.
- **pH, ORP, DO curves are completely untouched**, per explicit
  instruction — no evidence-backed change exists for any of them, and no
  attempt was made to invent one.
- **Country engines are completely untouched**, confirmed both
  architecturally and empirically in §4–§5.

**This report stops here, as instructed, rather than expanding scope to
address the above.** Any further change requires a new, separately-scoped
approval.

---

## Final status

```text
PRODUCTION CODE CHANGED: NO
COUNTRY LIMITS CHANGED: NO
CASE DATA CHANGED: NO
UI CHANGED: NO

CHANGES VALIDATED AND READY FOR REVIEW: 2 (Turbidity center, Chlorine continuity)
REGRESSION CHECKS: ALL PASS
UNEXPECTED MOVEMENT FLAGGED: YES (§7 — chlorine fix magnitude beyond the cliff itself, fully evidence-traced)
SCOPE EXPANSION: NONE — resolution problem not fully solved, not expanded to address, per instruction
```
