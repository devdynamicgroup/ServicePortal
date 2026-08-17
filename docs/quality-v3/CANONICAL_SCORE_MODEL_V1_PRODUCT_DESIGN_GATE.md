# Canonical Score Model V1 — Product Design Gate Result

**Status:** DESIGN GATE **APPROVED** — Product ratified full package 2026-08-17  
**Mode:** Design complete · Scoring code still frozen until Implementation Plan + Calibration Gate  
**Baseline:** [`CANONICAL_SCORE_MODEL_SPECIFICATION_V1.md`](./CANONICAL_SCORE_MODEL_SPECIFICATION_V1.md)  
**Next:** [`V7_IMPLEMENTATION_PROMPT.md`](./V7_IMPLEMENTATION_PROMPT.md)

```text
DESIGN GATE: APPROVED
IMPLEMENTATION READINESS: READY FOR V7 IMPLEMENTATION PLANNING

PD-V7-01     APPROVED — A (Quality Score)
PD-V7-02     APPROVED — C (Separate Risk)
PD-V7-03     APPROVED — HYBRID-FAMILY (α / exact F = TBD — calibration gate)
PD-V7-RANGE  APPROVED — A (live finalScore ∈ [0,99])
PD-V7-04     APPROVED — SUPERSEDE per package legacy matrix
PD-V7-09     APPROVED — WRITE-ONCE

CODE CHANGED: NO (this ratification does not authorize scoring edits)
```

---

## Decision order lock

```text
PD-V7-01  →  PD-V7-02  →  PD-V7-03  →  PD-V7-04  →  PD-V7-09
```

All five package decisions are **APPROVED**. Later implementation must not reopen them as Product questions. Numeric `α` / `F` remain Calibration Gate only.

---

## PD-V7-01 — What is `finalScore`?

### Status

```text
PD-V7-01 = APPROVED — A (Quality Score)
Ratified by Product: 2026-08-17
```

### Options (unchanged from Spec V1)

| Option | Formula idea | User-facing claim |
|--------|--------------|-------------------|
| **A — Quality Score** | `finalScore = qualityScore` (bounded 0–99) | “How good is the water vs ideal under this profile?” |
| **B — Risk-adjusted Quality** | `finalScore = f(qualityScore, riskSeverity)` | “Quality after risk is folded into the number.” |
| **C — Composite** | `finalScore = composite(quality, compliance, risk)` | “One blended score of several meanings.” |

### Required answers (framework — for Product to lock)

| Question | If Product chooses **A** | If **B** | If **C** |
|----------|--------------------------|----------|----------|
| Is finalScore quality or composite? | Quality only | Risk-adjusted quality | Composite |
| Does PASS affect finalScore? | No direct effect (PASS is compliance) | Only via riskSeverity mapping | Yes — compliance enters blend |
| Does PASS mean 100? | **No** | **No** | **No** |
| Does PASS cause a penalty? | **No** | **No** (penalty/bound comes from riskSeverity, not from PASS itself) | Dangerous — easy to reintroduce PASS→penalty |
| Can Cases be compared? | Yes, under **same** BenchmarkProfile + modelVersion | Same | Weak / discouraged |
| Can countries be compared by magnitude? | **No** (PD-005 retained) | **No** | **No** |
| quality high + risk CRITICAL — user sees? | High finalScore **and** mandatory CRITICAL risk UI | Lower/bounded finalScore; risk still labeled | Blended number — highest misread risk |
| quality low + still PASS — user sees? | Low/mid finalScore + PASS compliance | Same quality path; risk may still be PASS | Blended — may hide “still legal” |

### Band meanings 90 / 80 / 70

```text
UNKNOWN as calibrated real-world labels.
After PD-V7-01 is ratified, bands are derived from mathematical model + calibration evidence.
FORBIDDEN: invent “90 means excellent” from intuition alone.
```

### Ratified Product decision

**Option A — Quality Score** was selected because it matches the Product non-negotiables:

- `0–99 = Quality`
- `PASS ≠ 100`
- `PASS ≠ automatic penalty`
- Quality ≠ Compliance
- Goal is correct meaning, not lower numbers

Under **A**, compliance and risk remain first-class **separate outputs**. Critical risk cannot be “solved” by quietly lowering the quality number unless Product later chooses **B** deliberately.

### Rejected alternatives

| Option | Why not default |
|--------|-----------------|
| B | Changes the meaning of the Hero digit to risk-adjusted; valid only if Product wants that claim on the number itself |
| C | Re-blurs semantics; recreates PASS/quality conflation that V6 diagnosed |

### PD-V7-01 OUTPUT

```text
PD-V7-01 Decision:        APPROVED A — Quality Score
Rationale:                Matches locked Product intent: finalScore communicates
                          distance-from-ideal quality under BenchmarkProfile.
Rejected alternatives:    B (risk folded into digit), C (semantic blend)
User-facing meaning:      “Quality vs ideal for the selected country profile
                          (0–99). Compliance and risk are shown separately.”
Impact on qualityScore:   finalScore := qualityScore (after bound ≤99)
Impact on compliance:     Separate channel; PASS/FAIL never writes the digit
Impact on risk:           Separate channel under this proposal
Open questions:           (1) How separate CRITICAL risk must be presented.
                          (2) Exact operator/customer copy for dual display.
```

### Consequence

```text
PD-V7-02 may now be decided.
PD-V7-03 remains blocked until PD-V7-02 is approved.
```

---

## PD-V7-02 — How does `riskSeverity` affect `finalScore`?

### Status

```text
PD-V7-02 = APPROVED — C (Separate Risk)
PD-V7-01 = APPROVED A (Quality Score)
```

### Consistency with approved PD-V7-01

| Option | Formula | Compatible with `finalScore = qualityScore`? |
|--------|---------|-----------------------------------------------|
| **A — Ceiling** | `min(qualityScore, severityBound)` | **No** — digit becomes risk-bounded quality (= PD-V7-01 B) |
| **B — Penalty** | `qualityScore − riskPenalty` | **No** — digit becomes risk-penalized quality (= PD-V7-01 B) |
| **C — Separate** | `finalScore = qualityScore`; risk separate | **Yes** — preserves approved identity |

```text
Selecting A or B for risk without reopening PD-V7-01 would silently
contradict the ratified Quality Score identity.
```

### Critical questions — answers under Proposed C

| # | Question | Answer under C |
|---|----------|----------------|
| 1 | qualityScore=94, risk=PASS → finalScore? | **94** (risk shown as PASS separately) |
| 2 | qualityScore=94, risk=WARNING → finalScore? | **94** (WARNING mandatory separate) |
| 3 | qualityScore=94, risk=FAIL → finalScore? | **94** (FAIL mandatory separate) |
| 4 | qualityScore=94, risk=CRITICAL → finalScore? | **94** (CRITICAL mandatory separate — digit does not absorb risk) |
| 5 | Low quality + compliance PASS → finalScore reflects quality? | **Yes** — via parameterQuality / qualityScore only; PASS does not force 100 and does not add a surcharge |
| 6 | High quality + risk CRITICAL → finalScore must change? | **No** under C — finalScore stays quality; CRITICAL must be impossible to miss in presentation |
| 7 | How user sees quality and risk together? | **PRODUCT DECISION REQUIRED** for exact UI copy/layout; contract requires both outputs always present when computable — risk not optional chrome |
| 8 | Any case where risk must change finalScore? | **None under Proposed C.** If Product later needs the digit to move with CRITICAL, that is a **reopen of PD-V7-01 to B**, not a silent patch |

### Option comparison (no new numbers)

| Criterion | A Ceiling | B Penalty | C Separate |
|-----------|-----------|-----------|------------|
| Semantic vs PD-V7-01 | Contradicts | Contradicts | Aligns |
| Critical hidden in digit? | No | Depends on UNKNOWN schedule | Digit: yes → **UI must forbid hide** |
| PASS-but-degraded | Quality path only if curves allow | Same + opaque penalty risk | Quality path only |
| Explainability | “Why 60 if quality 94?” confuses | Penalty schedule UNKNOWN | Two clear answers: quality digit + risk label |
| Calibration impact | Would invent bounds — forbidden here | Would invent penalties — forbidden here | No new numeric risk schedule required for this PD |
| Migration / historical | Hero meaning shifts mid-flight | Same | Clearest: digit stays quality forever under modelVersion |

**Aggregation vs risk (do not conflate):**  
Dilution of one bad **quality** grade is PD-V7-03. Hiding **CRITICAL** inside a high digit is a presentation/risk-contract failure under C — fixed by mandatory risk output, not by inventing a ceiling in this gate.

### PD-V7-02 OUTPUT

```text
PD-V7-02 Decision:        APPROVED C — Separate Risk
Selected risk semantics:  riskSeverity is separate from finalScore
Formula:                  finalScore = qualityScore
                          riskSeverity = separate mandatory output
Why:                      Only option consistent with APPROVED PD-V7-01 A;
                          no new caps/penalties; quality ≠ risk ≠ compliance
Rejected alternatives:    A Ceiling, B Penalty (both rewrite finalScore meaning)
Interaction with finalScore: None — risk never writes the digit under C
Open questions:           Mandatory presentation contract for WARNING/FAIL/CRITICAL
                          (wording, placement, share/publish surfaces)
                          Deferred presentation contract; does not change score math

No numeric cap/penalty proposed.
PD-V7-03 may now be decided.
```

---

## PD-V7-03 — Canonical quality aggregator

### Status

```text
PD-V7-03 = APPROVED — HYBRID-FAMILY
Ratified: 2026-08-17
α / exact F = TBD — Calibration Gate (do not invent)
PD-V7-01 = APPROVED A (Quality Score)
PD-V7-02 = APPROVED C (Separate Risk)
```

### Non-negotiable (already in Spec; not a numeric choice)

```text
ONE canonical aggregator for all countries.
Country = BenchmarkProfile only (ideal, curves, limits, weights, provenance).
```

### Candidates (behavior comparison only)

| ID | Idea | Dilution | Worst-param | Notes |
|----|------|----------|-------------|-------|
| Mean | Weighted arithmetic | High | Low | Status-quo family |
| Weakest | min(qᵢ) | None | Extreme | Harsh |
| Hybrid | α·mean+(1−α)·min | Tunable | Tunable | α = UNKNOWN / PD later — not “to make scores low” |

### Existing V6 mathematical evidence (normalized grade vectors)

These values are from the existing read-only V6 structural audit, not new
calibration constants and not a claim about real-world score magnitude.

| Grade vector | Mean | Weakest-link | Geometric | Hybrid at the **existing TH 50/50 share** |
|--------------|------|--------------|-----------|--------------------------------------------|
| 5×100 + 1×70 | 95 | 70 | 94 | 83 |
| 5×100 + 1×40 | 90 | 40 | 86 | 65 |
| 5×100 + 1×10 | 85 | 10 | 68 | 48 |
| 1 mediocre 70 | 95 | 70 | 94 | 83 |
| 5 mediocre 70 | 75 | 70 | 74 | 73 |

**Mathematical consequence:** mean dilutes a poor parameter; min ignores all
other parameter quality; a hybrid makes the trade-off explicit. The shown
50/50 share is **historical Thailand code evidence only** — it is **not**
proposed as a V7 constant.

### PD-V7-03 decision framing

| Candidate | Why it can represent quality | Rejected concern |
|-----------|------------------------------|------------------|
| Weighted Mean | Overall average quality under profile weights | One poor parameter may be nearly hidden |
| Weakest Link | Quality constrained by its poorest measured dimension | A single noisy/secondary parameter dominates all other quality |
| Hybrid / bounded aggregation | Separates average quality from weakest-dimension sensitivity in one deterministic function | Requires Product decision on the blend function and calibration evidence; no α may be invented |

Under approved PD-V7-02 C:

```text
Quality degradation → canonical aggregator → qualityScore/finalScore
Compliance failure  → complianceStatus/riskSeverity separately
CRITICAL risk       → separate mandatory output; it does not rewrite quality
Missing required data → NOT_COMPUTABLE
```

### Required simulations (math behavior only — no production mutation)

| Case | Question to answer after 01/02 locked |
|------|----------------------------------------|
| 1 All ideal | Max quality under profile |
| 2 Small degrade | Observable Δ if quality contract requires |
| 3 One degraded + PASS | Reflect in finalScore per 01 |
| 4 One CRITICAL | Risk layer per 02 |
| 5 Multi degrade | Cumulative monotone effect |
| 6 One excellent + one poor | Dilution test |
| 7 Missing | `NOT_COMPUTABLE` — never fill |

```text
PD-V7-03 proposal: Hybrid / bounded aggregation family
Canonical aggregator: UNKNOWN until Product selects the exact family and
                         calibration evidence establishes any blend parameters.
Mathematical rationale: avoids mean dilution without turning all quality into
                        a single worst parameter.
Rejected alternatives: mean-only (dilution); min-only (over-dominance).
Country independence: one formula; profile weights only.
Calibration implications: α/bounds are UNKNOWN and need evidence/PD.

PRODUCT DECISION (ratified 2026-08-17):
  PD-V7-03: APPROVED — HYBRID-FAMILY
  α / exact F: TBD — Calibration Gate only
```

---

## PD-V7-04 — Supersede legacy decisions (esp. PD-006)

### Status

```text
PD-V7-04 = APPROVED — SUPERSEDE per Final Package legacy matrix
Ratified: 2026-08-17
```

### Contingent note on PD-006

| If PD-V7-01 | PD-006 (Country = Compliance Index) |
|-------------|-------------------------------------|
| A or B (quality / risk-adjusted quality on live Hero) | Likely **SUPERSEDE** or **PARTIALLY SUPERSEDE** for **live Hero identity** |
| Keep compliance-index Hero | **KEEP** PD-006 A |

Supersede must be explicit:

```text
Old: PD-006 A — Country live score = Compliance Index
New: (only if 01 ratified as quality-family)
Reason: Product requires 0–99 quality semantics on live Hero
Effective modelVersion: canonical-v1 / country-benchmark-v7 (TBD at implementation)
Migration: live path only; published Q-V3 snapshots not auto-recalculated
Historical: immutable
```

Other legacy PDs (EU gate 65, ORP, DO sets, etc.) stay **out of this gate’s approval set** until 01–03 land — flag as follow-on PDs, not silent edits.

---

## PD-V7-09 — Published score write-once

### Status

```text
PD-V7-09 = APPROVED — WRITE-ONCE
Ratified: 2026-08-17
```

### CODE FACT (impact only)

`POST /api/cases/:id/score` can overwrite `Latest Water Score` with live `S.scoreVal` on re-publish/share paths.

### Ratified policy

```text
WRITE-ONCE / IMMUTABLE for publishedScore snapshot
Re-publish: explicit “Recalculate & republish” → new versioned publication event
Silent overwrite: FORBIDDEN
Fields: publishedScore + modelVersion + calculatedAt (+ fingerprint recommended)
Country Score Standard: remains Case preference; not the published Quality number
```

Must be closed in Implementation Phase A **before** any live V7 Hero rollout. Does not authorize inventing α or switching live math without Calibration Gate.

---

## Design Gate matrix

| Decision | Status | Choice | Notes |
|----------|--------|--------|-------|
| PD-V7-01 | **APPROVED** | A — Quality Score | Locked |
| PD-V7-02 | **APPROVED** | C — Separate Risk | Locked |
| PD-V7-03 | **APPROVED** | Hybrid-family | `α` / exact `F` = **TBD** until calibration gate |
| PD-V7-RANGE | **APPROVED** | A — live `[0,99]` | 100 reserved for Q-V3 |
| PD-V7-04 | **APPROVED** | SUPERSEDE PD-006 live Hero + matrix | Historical immutable |
| PD-V7-09 | **APPROVED** | WRITE-ONCE | Close overwrite before live rollout |

**Package ratification:** Product `APPROVE V7 DESIGN PACKAGE` — 2026-08-17.


---

## Autonomous analysis — PD-V7-03 Aggregator

### Comparison (mathematical properties only)

| Property | Weighted Mean | Weakest-Link | Hybrid Family |
|----------|---------------|--------------|---------------|
| Dilution of one poor grade | High (fails Invariant C) | None | Controlled by blend |
| Single-dimension domination | Low | Extreme (fails Invariant D unless justified) | Bounded by mean term |
| Monotonicity (away from ideal) | Yes if grades monotone | Yes | Yes if both terms monotone |
| Interpretability | High (“average quality”) | High (“worst dimension”) | Medium — needs explicit contract |
| Country independence | Yes if formula shared | Yes | Yes |
| Risk independence (PD-V7-02) | Compatible | Compatible | Compatible |
| Fits `finalScore = qualityScore` | Yes | Yes | Yes |

V6 normalized evidence (not calibration): mean hides a 40-grade among 100s (→90); min collapses to 40; historical TH 50/50 hybrid lands at 65 — shows the **trade-off exists**, not which α to ship.

### APPROVED AGGREGATOR

```text
APPROVED AGGREGATOR: HYBRID-FAMILY

Mathematical family (symbolic):
  Q_mean = Σ(wᵢ qᵢ) / Σ wᵢ     // profile weights only
  Q_min  = min(qᵢ)               // over scored/applicable params
  qualityScore = round( α·Q_mean + (1−α)·Q_min )
  // or equivalent monotone F(Q_mean, Q_min) in the same family

α / exact F coefficients: TBD — CALIBRATION DECISION (not invented here)

WHY:
  Product needs quality that responds to degraded dimensions (no mean-only
  dilution) without collapsing every Case to its noisiest single sensor
  (no min-only domination). Hybrid is the only family that makes that
  trade-off an explicit mathematical contract while keeping one algorithm
  for every BenchmarkProfile.

BENEFITS:
  - One canonical algorithm (country = profile only)
  - Compatible with PD-V7-01/02
  - Separates architectural choice from numeric calibration

RISKS:
  - Without ratified α, implementation of live numbers is not ready
  - Poor α calibration can reintroduce dilution or over-dominance

KNOWN UNKNOWN:
  - Exact α or F(·)
  - Whether weights enter only Q_mean or also Q_min selection set
  - Score-band interpretation labels (Excellent/Good/…)
```

Architectural decision ≠ calibration approval.

---

## Autonomous analysis — PD-V7-RANGE

| Option | Range | Fits continuous ideal? | Q-V3 separation | Legacy Hero ceiling 99 |
|--------|-------|------------------------|-----------------|------------------------|
| **A** | `[0,99]` | Ideal maps to **99** max on live Hero | Strong — **100 reserved for Q-V3 Near-Ideal publish** | Matches CODE FACT |
| **B** | `[0,100]` | Ideal can be **100** | Weakens channel separation; live Hero can equal Q-V3 “perfect” symbol | Conflicts with existing product architecture comment |

```text
PD-V7-RANGE: APPROVED — A

finalScore / live qualityScore display domain: [0, 99]
Internal parameterQuality may use [0, 100] before aggregate.
At all-ideal: qualityScore = 99 (maximum under live contract), not 100.

RATIONALE:
  Preserves Q-V3 exclusivity of 100; honors earlier Product lock “0–99 = Quality”
  for the live/canonical Hero channel; avoids PASS≠100 confusion with a
  second path to 100; lowest migration conflict with applyCountryBenchmarkHeroCeiling.

MIGRATION IMPACT:
  Existing country Hero ≤99 behavior stays; no need to rewrite published Q-V3 100 semantics.

LEGACY CONFLICT:
  Spec draft line allowing “100 when math quality = 100” is SUPERSEDED for the
  *live canonical/country Hero*. Q-V3 publish may still show 100.

UNKNOWN:
  Whether public marketing copy must say “99 = near-ideal on this profile”
```

---

## Autonomous analysis — PD-V7-04 Legacy policies

| Legacy Policy | Current meaning | Compatible with V7? | RECOMMENDED | Note |
|---------------|-----------------|---------------------|-------------|------|
| **PD-006 A** Country = Compliance Index | Live Hero as compliance | **No** — conflicts PD-V7-01 | **SUPERSEDE** (live Hero identity) | Effective on new `modelVersion` only |
| PD-001 pass-band UI language | Avoid quality-tier overclaim | Partial | **PARTIALLY SUPERSEDE** | Live Hero is quality; compliance/risk labels stay separate |
| PD-005 no cross-country magnitude rank | Comparison ≠ ranking | Yes | **KEEP** | |
| PD-002 EU Cl gate 65 | Hard composite cap | Conflicts PD-V7-02 if it rewrites finalScore | **SUPERSEDE as score rewrite**; may become **risk/compliance rule** only if re-specified | Numeric 65 remains UNSUPPORTED until separate PD |
| Shared severity caps on composite | Post-hoc min() on score | Conflicts PD-V7-02 | **SUPERSEDE** for quality digit | Caps must not write `finalScore` |
| Hero ceiling 99 | Composite ≤99 | Aligns with RANGE A | **KEEP** (as live domain) | |
| Per-country aggregation (TH weakest-link share, etc.) | Different algorithms | Conflicts canonical aggregator | **SUPERSEDE** | Profiles keep weights only |
| Q-V3 isolation | Separate publish channel | Yes | **KEEP** | |
| PD-012 JP DO not scored | Applicability | Profile-level | **KEEP** as BenchmarkProfile applicability | NOT_APPLICABLE ≠ quality 100 |
| Published Latest Water Score | Q-V3 publish number | Yes with write-once | See PD-V7-09 | |

```text
PD-V7-04: APPROVED — SUPERSEDE PD-006 for live Hero meaning
           (PARTIALLY KEEP other PD-006 documentation history)

Old: Live Country Benchmark score = Compliance Index (PD-006 A)
New: Live finalScore = qualityScore under BenchmarkProfile (PD-V7-01)
Reason: Product ratified quality semantics; compliance/risk are separate
Effective Version: upon package ratification + modelVersion bump
Impact: Live Hero interpretation changes; published Q-V3 unchanged
Migration: Feature-flag live path; no silent historical rewrite
Historical Score Behavior: immutable (PD-V7-09)
```

---

## Autonomous analysis — PD-V7-09 Write-once

CODE FACT: `POST /api/cases/:id/score` can overwrite `Latest Water Score` with live `S.scoreVal`.

```text
PD-V7-09: APPROVED — WRITE-ONCE

Published score immutable?: YES for a given publication identity
Re-publish behavior: explicit “Recalculate & republish” → NEW publication event / version
Version behavior: store modelVersion + calculatedAt (+ fingerprint recommended)
Historical behavior: never silent clobber
Latest-score behavior: “latest” may point to newest publication, but prior rows/artifacts retained
Q-V3 behavior: published Q-V3 snapshot immutable under same rules
Country-score behavior: live quality is not the published Q-V3 number; Country Score Standard remains preference select
Migration requirement: close overwrite gap BEFORE any live V7 Hero rollout
```

### Versioning (KEEP SIMPLE)

```text
APPROVED FIELDS:
  modelVersion          // canonical pipeline + semantics
  benchmarkVersion      // profile ideals/limits/weights bundle
  publishedScore
  publishedAt / calculatedAt
OPTIONAL later: curveVersion only if ops need finer grain
```

---

## Calibration gate (separate from architecture)

```text
ARCHITECTURE: APPROVED (this package)
CALIBRATION: NOT YET CALIBRATED

Protocol before shipping numeric α / curve coefficients:
  1. Complete real Cases only
  2. Boundary + sensitivity sweeps (synthetic OK for math only)
  3. Provenance CITED | PRODUCT_DECISION | UNKNOWN — never invent
  4. Before/after table on complete Cases
  5. Explicit Product approval of each numeric constant id
```

REAL DATA LIMITATION: sparse complete Cases in evidence caches; incomplete → `NOT_COMPUTABLE`; Case 1328 calibration-contaminated for Quality generalization.

---

## Canonical pipeline (recommended)

```text
Reading → Validation → Parameter Quality → Canonical Hybrid Aggregation
  → qualityScore → Compliance Evaluation → riskSeverity
  → finalScore (= qualityScore, domain [0,99])
  → Display (Quality + Compliance + Risk + Computability)
```

---

## FINAL PRODUCT DESIGN GATE PACKAGE — RATIFIED

```text
CANONICAL SCORE MODEL V1
FINAL PRODUCT DESIGN GATE PACKAGE — APPROVED 2026-08-17

PD-V7-01: APPROVED — A
PD-V7-02: APPROVED — C
PD-V7-03: APPROVED — HYBRID-FAMILY (α / exact F = TBD)
PD-V7-RANGE: APPROVED — A (live [0,99])
PD-V7-04: APPROVED — SUPERSEDE per package matrix
PD-V7-09: APPROVED — WRITE-ONCE

DESIGN GATE: APPROVED
IMPLEMENTATION READINESS: READY FOR V7 IMPLEMENTATION PLANNING

CODE CHANGED: NO
DEPLOYED: NO
REAL SCORE CHANGED: NO
```

**Hard constraint still in force:** no scoring-code edits until the V7 Implementation Plan is followed and the Calibration Gate clears numeric constants (`α` / `F`).

**Product reply that ratified:** `APPROVE V7 DESIGN PACKAGE`

Next document: [`V7_IMPLEMENTATION_PROMPT.md`](./V7_IMPLEMENTATION_PROMPT.md)

