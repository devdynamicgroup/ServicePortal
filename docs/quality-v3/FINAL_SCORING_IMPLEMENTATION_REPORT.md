```text
STATUS UPDATE: the Chlorine >0.5 mg/L segment described in this report (§2,
health-ceiling-anchored) was reviewed and explicitly REJECTED by the
product owner — see the chlorine decision-table exchange later in this
thread. It conflated a safety ceiling (5.0 mg/L, "not dangerous") with a
quality target ("still good"), inflating scores for elevated-but-plausible
readings (e.g. 1.0 mg/L -> 90, when WHO frames that value as an
outbreak-only allowance, not a normal target).

CURRENT STATE (working tree, still uncommitted): the flat 0.2-0.5 mg/L
band and the cliff fix are UNCHANGED and remain uncontested. The >0.5
mg/L segment has been reset to an INTERIM shape re-anchored to the same
46-at-1.0 / 28-at-2.0 / floor-8 values already shipped in production
before this review series began (continuous with the new flat band, but
explicitly not evidence-backed for this range — see the code comment in
computeQualityScoreV2.js). This is a placeholder, not a decision.

Turbidity (0.08->0.1) is unaffected by any of this and remains approved.

BLOCKING DECISION: what Quality V3 is meant to measure (closeness-to-ideal
index vs. safety-adjacent signal) must be resolved — docs/quality-v3/UNRESOLVED_DECISIONS.md
§1 — before the >0.5 mg/L chlorine shape can be finalized. Numbers below
reflect the interim state, not final numbers.

UNRELATED, SEPARATE UPDATE (this pass): Country Benchmark's own semantic
question (Compliance Score vs. Quality Level — a different question from
the Quality V3 aggregation question above) has since been resolved and
implemented — see docs/quality-v3/COUNTRY_SCORE_SEMANTICS_REVIEW.md
"IMPLEMENTATION STATUS." That work only touched src/js/flows/score.js
(Hero display binding) and does not change, and is not blocked by, the
Quality V3 chlorine decision still pending above.
```

```text
IMPLEMENTED IN WORKING TREE — NOT COMMITTED — NOT DEPLOYED
Awaiting review of this report before any commit, per this task's own
instruction: "ก่อน deploy production ต้องส่ง FINAL_SCORING_IMPLEMENTATION_REPORT.md
พร้อม Before/After table มา review ก่อนเสมอ"
```

# Quality V3 — Final Scoring Implementation Report

Both approved changes are implemented in the real production file. Nothing
was committed or deployed. One pre-existing test suite has 2 failing
assertions — both explained below, neither hidden, neither fixed by
silently editing the test.

---

## 1. Files Changed

```text
src/js/score/production/computeQualityScoreV2.js
```

**Only this file.** No other file under `src/` was touched. No country
`limits.js` or `score.js`, no UI, no Notion, no Case data, no aggregation
code.

---

## 2. Exact Changes

### `gradeTurbidity()`

```diff
- if (turb <= 0.08) return 100;
- if (turb <= 0.2) return lerp(turb, 0.08, 100, 0.2, 88);
+ if (turb <= 0.1) return 100;
+ if (turb <= 0.2) return lerp(turb, 0.1, 100, 0.2, 88);
```

All other breakpoints unchanged. Comment added citing WHO's "ideally <0.1
NTU for effective disinfection" and this report.

### `gradeChlorine()`

```diff
- const ideal = 0.3;
- const d = Math.abs(fcl - ideal);
- if (d <= 0.025) return 100;
- if (d <= 0.08) return lerp(d, 0.025, 100, 0.08, 88);
- if (d <= 0.15) return lerp(d, 0.08, 88, 0.15, 74);
- if (d <= 0.22) return lerp(d, 0.15, 74, 0.22, 64);
- if (fcl < 0.1) return clamp(lerp(fcl, 0, 18, 0.1, 58), 8, 58);
- if (fcl <= 1.0) return lerp(Math.max(fcl, 0.52), 0.52, 64, 1.0, 46);
- if (fcl <= 2.0) return lerp(fcl, 1.0, 46, 2.0, 28);
- return clamp(28 - (fcl - 2) * 8, 8, 28);
+ if (fcl >= 0.2 && fcl <= 0.5) return 100;
+ if (fcl < 0.2) return clamp(lerp(fcl, 0, 5, 0.2, 100), 2, 100);
+ if (fcl <= 5.0) return clamp(lerp(fcl, 0.5, 100, 5.0, 10), 2, 100);
+ return clamp(10 - (fcl - 5) * 2, 2, 10);
```

Full replacement — the two colliding branches (distance-from-0.3 +
raw-value-below-0.1) are gone, replaced by one continuous function
anchored to WHO's cited floor (0.2), target band (0.2–0.5), and
health-based ceiling (5.0). Comment added citing the evidence and the
cliff mechanism documented in `EVIDENCE_BASED_SCORING_AUDIT.md` §6.

The file's top-of-file rationale comment block was also updated to
describe these two changes accurately (previously described the old
0.08/0.30 values).

**`ENGINE_VERSION` was NOT bumped** (`'quality-v3.0'` unchanged) — not
authorized by this task's scope, confirmed in regression check #8 below.

---

## 3. Before / After (Quality Hero Score)

| Fixture | Quality Before | Quality After |
|---|---:|---:|
| Case A (1328) | 92 | **92** |
| Case B (synthetic) | 73 | **78** |
| LOCKED | 71 | **78** |
| POOR | 39 | **46** |
| CRITICAL | 21 | **26** |

No target was set for any of these before implementing. Case A landed
back at exactly 92 (turbidity's small parameter-level move, +1.6, wasn't
enough to shift the rounded composite) — reported as-is, not adjusted.
Case B, LOCKED, POOR, and CRITICAL all move up, entirely from the
chlorine fix (see §4) — also reported as-is.

---

## 4. Parameter-Level — Chlorine (measured directly against the edited production file)

| Value | Before | After |
|---:|---:|---:|
| 0.07 | 46.00 | **38.25** |
| 0.08 | 64.00 | **43.00** |
| 0.29 | 100.00 | 100.00 |
| 0.30 | 100.00 | 100.00 |
| 0.31 | 100.00 | 100.00 |
| 0.50 | 64.00 | **100.00** |
| 0.70 | — | **96.00** |
| 1.00 | 46.00 | **90.00** |
| 1.50 | 37.00 | **80.00** |
| 2.00 | 28.00 | **70.00** |

The cliff (0.07→0.08, was +18.00) is now +4.75, in line with the
surrounding local rate. 0.29/0.30/0.31 remain flat at 100 in both
versions — correctly, since all three sit inside WHO's own evidenced
0.2–0.5 mg/L band; this was never expected to change and did not.

### Turbidity (for completeness, though only the center moved)

| Value | After |
|---:|---:|
| 0.08 | 100.00 |
| 0.09 | 100.00 |
| 0.10 | 100.00 |
| 0.11 | 98.80 |
| 0.12 | 97.60 |
| 0.20 | 88.00 |
| 0.50 | 74.00 |
| 1.00 | 60.00 |

---

## 5. Country Regression

Verified two ways, both against the real, unmodified country engines:

**5a. Code-level isolation** — `grep` across every file in
`src/js/score/benchmark/**` finds zero references to
`computeQualityScoreV2.js`, `computeQualityScoreDetail`, or
`computeScoreFromReadings`. The two systems share no code path; a change
inside `computeQualityScoreV2.js` cannot reach any country engine.

**5b. Execution comparison** — every country score for every fixture,
before and after, is identical:

| Fixture | TH | JP | WHO | EU | EPA |
|---|---:|---:|---:|---:|---:|
| Case A | 100 → 100 | 100 → 100 | 100 → 100 | 100 → 100 | 100 → 100 |
| Case B | 100 → 100 | 100 → 100 | 98 → 98 | 99 → 99 | 99 → 99 |
| LOCKED | 100 → 100 | 96 → 96 | 93 → 93 | 65 → 65 | 91 → 91 |
| POOR | 87 → 87 | 69 → 69 | 64 → 64 | 52 → 52 | 67 → 67 |
| CRITICAL | 56 → 56 | 28 → 28 | 28 → 28 | 16 → 16 | 30 → 30 |

**Confirmed: Quality → independent, TH/JP/WHO/EU/EPA → all independent
and unchanged.**

---

## 6. Regression Result

Two suites were run: a purpose-built validation script against the edited
production file (12 checks), and the repository's own pre-existing test
files (unmodified).

### 6a. Purpose-built validation (`.tmp_probe/quality-v3-final-regression.js`)

```text
12 PASS, 0 FAIL
```

Covering: country scores unchanged (6 fixtures), turbidity monotonicity
(fine sweep), chlorine monotonicity (fine sweep), no cliff-scale
discontinuity remains, Case ordering (B < A), full 7-point calibration
ladder strictly decreasing, engine version unchanged.

### 6b. Existing repository test suites (unmodified, run as-is)

```text
tests/score/quality-v2-calibration.test.js       50 passed, 2 FAILED
tests/score/case-1328-calibration-baseline.test.js  23 passed, 0 failed
tests/score/thailand-japan-flow.test.js          66 passed, 0 failed
tests/evidence/evidence-framework.test.js        33 passed, 0 failed
tests/evidence/intake-protocol.test.js           12 passed, 0 failed
─────────────────────────────────────────────────────────────────
TOTAL                                            184 passed, 2 failed
```

**The 2 failures are explained in full in §7 — not hidden, and not
silently fixed by editing the test.**

---

## 7. Unexpected Changes — Reported, Not Hidden

### 7a. Two pre-existing test assertions now fail — expected and explained

```js
// tests/score/quality-v2-calibration.test.js, lines 163-170
const center = q({ ...base, ph: 7.2, chlorine: 0.3 });
assert(q({ ...base, chlorine: 0.2 }) < center, 'Cl 0.2 < ideal');
assert(q({ ...base, chlorine: 0.5 }) < center, 'Cl 0.5 < ideal');
```

These two assertions encode the **old** curve's assumption: that 0.30
mg/L is a uniquely "ideal" point and 0.20/0.50 mg/L (the WHO-cited band's
own edges) must score strictly lower. Under the new, WHO-anchored curve,
0.2, 0.3, and 0.5 mg/L all correctly score 100 (flat across the entire
evidenced band) — so `100 < 100` is false and both assertions fail.

**This is not a bug in the implementation. It is the test asserting
exactly the behavior this whole review series concluded was not
evidence-backed** (`REALITY_FIRST_SCORING_REVIEW.md` §7, False Precision
Risk #1: "WHO frames this entire range as one operationally-equivalent
acceptable residual zone — it does not say 0.35 mg/L is better than 0.22
or 0.48 mg/L"). The test was written under the old assumption and now
correctly disagrees with the new, evidence-based one.

**Not fixed here.** Per this task's own rule and an earlier round's
explicit instruction ("ห้ามแก้ existing regression fixtures เพื่อให้ test
ผ่าน" / do not modify tests merely to make a candidate pass), this test
was left exactly as-is. It requires an explicit decision: update the
assertion to match the new evidence-based expectation (e.g. assert
`chlorine 0.2/0.3/0.5` are all equal, or assert against a value outside
the band instead), or revert the implementation. **This is now the single
open item blocking a clean test run**, separate from and in addition to
the production-code approval itself.

### 7b. Magnitude of the chlorine-driven increases

Already flagged in `REALITY_FIRST_IMPLEMENTATION_REPORT.md` §7 and
reconfirmed here against the real edited file: LOCKED/POOR/CRITICAL each
move up 5–7 points at the composite level (30–43 points at the chlorine
parameter level) because the old curve's raw-value branches were
considerably steeper than WHO's actual band throughout the range above
0.5 mg/L, not just discontinuous at 0.08. Every number in §4 was produced
by running the real edited function, not adjusted afterward.

---

## Final status

```text
PRODUCTION CODE CHANGED: YES — src/js/score/production/computeQualityScoreV2.js
  (working tree only — NOT committed, NOT deployed)
COUNTRY LIMITS CHANGED: NO
COUNTRY ENGINES CHANGED: NO (verified: code isolation + execution comparison)
CASE DATA CHANGED: NO
UI CHANGED: NO
AGGREGATION CHANGED: NO
pH / ORP / DO CHANGED: NO

REGRESSION: 184 passed, 2 failed (both explained in §7a — pre-existing
  test assertions that encoded the now-superseded old-curve assumption)

STOP CONDITIONS TRIGGERED: NONE
  (the 2 test failures are explained, not unexplained; no aggregation,
  pH, ORP, DO, or country-limit change was required or made; no Case
  A/B target was used)

READY FOR REVIEW: YES
READY FOR COMMIT: NOT YET — pending explicit decision on the 2 test
  assertions in §7a, and pending your review of this report
```
