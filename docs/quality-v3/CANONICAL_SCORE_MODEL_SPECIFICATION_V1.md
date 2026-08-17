# Canonical Score Model Specification V1 — Design Only

**Status:** DESIGN GATE — awaiting Product Decision  
**Scope:** Scoring-model architecture only (Country Benchmark live path + shared quality/compliance/risk semantics)  
**Non-scope:** Portal architecture, Case lifecycle, OCR, Notion property renames, UI workflow redesign, Q-V3 curve retuning as implementation  
**Predecessor:** Score Model V6 investigation (`REBUILD` — scoring architecture)  
**Implementation:** Forbidden until Implementation Readiness Gate = READY  

**Evidence tags used throughout**

| Tag | Meaning |
|-----|---------|
| CODE FACT | Observed in current production source |
| REAL DATA | Observed from production/cached Case readings |
| PRODUCT DECISION REQUIRED | Product must choose; not derivable from code |
| UNKNOWN | Insufficient evidence; do not invent |
| MATHEMATICAL CONSEQUENCE | Follows from a proposed formula |
| CALIBRATION ASSUMPTION | Would require evidence before locking numbers |

---

## 1. Executive Summary

Current Country Benchmark engines are **arithmetically consistent with their own code**, yet **semantically inconsistent with the product need to interpret 0–99 as water quality**.

Root structural issues (V6 + source audit):

1. Parameter grades are often **flat inside PASS** → `PASS` behaves like quality 100.
2. Aggregation philosophies **differ by country** (Thailand weakest-link hybrid vs weighted/equal means elsewhere).
3. **Severity caps**, **EU chlorine gate 65**, and **Hero ceiling 99** act as post-hoc patches rather than first-class risk semantics.
4. Verdict labels imply a quality gradient while grades implement compliance-style flats.
5. Calibration evidence for “what 85 means in the real world” is **insufficient** (very few complete Cases; Case 1328 is calibration-contaminated for Quality work).

**Decision from V6 (architecture only):** `REBUILD` the scoring-model architecture — **not** the Portal.

**This V1 specification** defines the contracts Product must approve before any V7 implementation. It **does not** pick numeric constants, does **not** declare that 94 is “too high,” and does **not** finalize the risk→finalScore formula without Product comparison of Models A/B/C.

---

## 2. Problem Definition

### What is broken

| Problem | Type | Symptom |
|---------|------|---------|
| Quality conflated with compliance | Semantic | In-band reading → grade 100 → Hero near 99 with “Excellent” |
| Dilution | Mathematical | One mediocre/critical parameter averaged away |
| Country-specific aggregation | Architectural | Same readings, different philosophies beyond benchmark limits |
| Patch layering | Architectural | Caps/gates applied after aggregation to force “realism” |
| Evidence gap | Calibration | Cannot validate whether 70/80/90 match real quality intuition |

### What is *not* the problem

- UI displaying the wrong engine output (display matches engine).
- Need to “make Thailand lower” as a goal in itself.
- Portal / Case / Notion ownership model.

### Success criterion for V7 (when implemented later)

> When a user sees a score, they can interpret **water quality** correctly for the selected benchmark profile, without needing to know which country engine implementation is behind it — and without mistaking `PASS` for “near perfect.”

---

## 3. Product Semantics

### Questions each output must answer

| Output | Question answered | Must NOT be used as |
|--------|-------------------|---------------------|
| `parameterQuality` | How close is this reading to the benchmark **ideal**? | Compliance pass/fail |
| `qualityScore` | What is the overall **quality** of the measured set under this profile? | Legal status |
| `complianceStatus` | Does each/all parameters meet **compliance limits**? | Quality magnitude |
| `riskSeverity` | What is the **worst risk tier** implied by compliance (and any critical flags)? | Continuous quality grade |
| `finalScore` | What single number should the operator Hero show under the chosen Final Score Semantics? | Automatic proof of calibration |

### Forbidden assumptions (explicit)

```text
FORBIDDEN:
  PASS → 100
  PASS → score must decrease
  FAIL → score must be 0
  “94 looks too high” → therefore wrong
  “PASS so 94 is fine” → therefore correct
```

Interpretation of any numeric Hero value is **undefined** until:

1. Final Score Semantics is chosen (Product Decision), and  
2. An interpretation framework is derived from the mathematical model + calibration evidence (or marked UNKNOWN).

---

## 4. Semantic Contract

### 4.1 Proposed live-score identity (PRODUCT DECISION REQUIRED vs legacy)

**Legacy (current documented Country Benchmark contract):** compliance/benchmark index; flat-in-band 100 common; not universal quality.

**Proposed V7 direction (from Product intent in this gate):**  
`0–99` on the live Score Hero should communicate **Quality under the selected Benchmark Profile**, with Compliance and Risk as **separate explicit outputs**.

This **would supersede** PD-006 “Country Benchmark = Compliance Index” for the live Hero if Product approves. Until then:

```text
PRODUCT DECISION REQUIRED:
  Live Hero finalScore semantics =
    A) Quality only
    B) Risk-adjusted quality
    C) Composite quality + compliance
    D) Other (specify)
```

### 4.2 Interpretation framework (bands) — structure only

Bands below are **placeholders for derivation method**, not locked meanings:

| Band | Intended derivation method | Locked meaning now |
|------|----------------------------|--------------------|
| 99 | Near-ideal on all scored parameters under profile; still reserved vs Q-V3’s ability to show 100 | UNKNOWN until model + evidence |
| ~95 | Small total deviation from ideals | UNKNOWN |
| ~90 | Noticeable but limited deviation | UNKNOWN |
| ~80 | Clear quality degradation, often still compliant | UNKNOWN |
| ~70 | Substantial degradation and/or elevated risk interaction (depends on Final Score model) | UNKNOWN |
| ~60 | Severe degradation / risk-bound region (if ceiling model) | UNKNOWN |
| ≤50 | Dominant poor parameter quality and/or critical risk presentation | UNKNOWN |

**How bands become locked later**

1. Mathematical model defines monotonic mapping from deviations → `parameterQuality` → `qualityScore`.  
2. Calibration Evidence Contract supplies cited or Product-decided anchors.  
3. Only then may Product publish an interpretation card for operators/customers.

### 4.3 PASS semantics (locked proposal for Design Gate)

```text
PASS  = meets complianceLimits for that parameter / overall rule
PASS ≠ quality 100
PASS ≠ automatic penalty
FAIL / WARNING / CRITICAL = compliance/risk vocabulary only
```

**PRODUCT DECISION REQUIRED:** exact overall compliance aggregation rule  
(e.g. worst-of-parameters vs any-fail → overall FAIL).

---

## 5. Parameter Quality Contract

### Purpose

`parameterQuality ∈ [0, 100]` (internal; may display 0–99 after composite rules) answers:

> Distance from **ideal** (and preferred range if defined) under the active Benchmark Profile.

### Separation from compliance

```text
Reading A: near ideal, within complianceLimits → high parameterQuality, PASS
Reading B: far from ideal, still within complianceLimits → lower parameterQuality, PASS
```

Both PASS. A quality > B quality. B must **not** auto-grade to 100. B must **not** be treated as FAIL solely because quality is lower.

### Curve family (design, not numbers)

Allowed curve families (choose per parameter with provenance):

1. Ideal-centered distance (two-sided or one-sided)  
2. Piecewise quality curve with preferred band → soft degrade → continue past compliance edge  
3. Explicit step function **only** if evidence justifies discontinuity  

```text
FORBIDDEN as sole grade rule:
  if inComplianceLimits return 100
```

### Completeness

If a required parameter for the profile is missing/invalid → Case score path is `NOT COMPUTABLE` (see §11). Do not invent fills.

### Evidence status per parameter (initial)

| Parameter | Ideal definition | Compliance limits | Notes |
|-----------|------------------|-------------------|-------|
| pH | Mix of cited bands + project preferred | Mostly cited/project | Per-country preferred bands need provenance |
| TDS | Often project ideal (e.g. shared 300) | Mix cited/project | Shared “300” flagged UNKNOWN/provenance weak for some countries |
| Turbidity | Mix | Mix | |
| Chlorine | Project residual bands common | Mix MRDL / project | Wide EPA pass window drives flat quality today |
| ORP | Shared project band | Shared | CODE FACT: near-identical across engines — UNKNOWN as national standard |
| DO | Mix / excluded in TH & JP score | Mix | Param-set policy PRODUCT DECISION REQUIRED |

---

## 6. Canonical Aggregation Candidates

### Non-negotiable

```text
ONE canonical aggregation mathematics for all countries.
Country profiles may supply weights (with provenance), not alternate aggregators.
```

### Candidates (compare; do not lock without Product + simulation)

| ID | Formula (conceptual) | Dilution | Worst-param sensitivity | Cumulative mediocre | Notes |
|----|----------------------|----------|-------------------------|---------------------|-------|
| AGG-1 Arithmetic weighted mean | Σ wᵢqᵢ / Σ wᵢ | High | Low | Mild | Status quo for most engines |
| AGG-2 Weakest-link | min(qᵢ) | None | Extreme | Floor only | Harsh; ignores remaining excellence |
| AGG-3 Geometric mean | exp(avg ln qᵢ) | Medium | Medium-high | Compounds | Needs floor for zeros |
| AGG-4 Hybrid mean+min | α·mean + (1−α)·min | Medium-low | Tunable | Steady | TH already uses α=0.5 variant — α is PRODUCT/CALIBRATION |
| AGG-5 Severity-weighted mean | weights ↑ as quality ↓ | Medium-low | Medium | Compounds | Still a mean family |

**α and weights:** UNKNOWN / PRODUCT DECISION REQUIRED — do not invent “looks right” values.

### Required simulation scenarios (mathematical correctness)

| Scenario | Intent |
|----------|--------|
| A All ideal | Max qualityScore for profile |
| B One param small degrade | Observable decrease (if within quality domain) |
| C One param large degrade, still PASS | Must not be fully diluted to ~ideal score |
| D One param FAIL | qualityScore reflects quality; complianceStatus FAIL separate |
| E One param CRITICAL | riskSeverity visible; quality not redefined as compliance |
| F Multiple degrade together | Monotone non-increasing cumulative effect |

V6 harness already showed AGG-1 dilution and severity-floor plateaus under current engines — evidence that canonical choice must be simulation-gated.

---

## 7. Risk / Severity Candidates

**Do not assume** `finalScore = min(qualityScore, severityBound)` is correct.

### Model A — Severity Ceiling

```text
finalScore = min(qualityScore, severityBound(riskSeverity))
```

| Criterion | Assessment |
|-----------|------------|
| Semantic clarity | finalScore becomes **risk-bounded quality** |
| Quality/risk separation | Partial — risk collapses into the number |
| Critical hidden by aggregate? | No, if bound ≤ quality |
| User misread risk? | Medium — may think “quality is 60” not “quality 78 capped by CRITICAL” |
| Evidence/requirement | Matches desire to prevent hidden critical; bound values UNKNOWN |
| Migration | Hero numbers change when bounds bind; need versioning |

### Model B — Severity Penalty

```text
finalScore = qualityScore − riskPenalty(riskSeverity, …)
```

| Criterion | Assessment |
|-----------|------------|
| Semantic clarity | finalScore is **penalized quality**; penalty function must be evidenced |
| Separation | Weaker — risk enters as arithmetic debt |
| Critical hidden? | Depends on penalty magnitude |
| User misread? | High if penalty opaque |
| Evidence | UNKNOWN — no validated penalty schedule |
| Migration | Harder to explain historical deltas |

### Model C — Fully Separate

```text
finalScore = qualityScore
riskSeverity = separate output (and UI must show it)
```

| Criterion | Assessment |
|-----------|------------|
| Semantic clarity | Strongest separation |
| Critical hidden in the number? | Yes, in the number — **must not** be hidden in the **UI** |
| User misread? | Low for quality; high if UI omits risk |
| Evidence | Fits “PASS ≠ penalty” and “quality ≠ compliance” strictly |
| Migration | Clearest audit: quality and risk versioned independently |

```text
PRODUCT DECISION REQUIRED: choose Model A | B | C
  (or hybrid: C for storage + A for Hero display — specify explicitly)
```

**Recommendation for discussion (not approved):** prefer **Model C for data contract**, and decide separately whether Hero display uses A. Do not silently bake A into “quality.”

---

## 8. Final Score Semantics

```text
PRODUCT DECISION REQUIRED — pick exactly one primary definition:

A. Quality score only          → finalScore := qualityScore (bounded)
B. Risk-adjusted quality       → finalScore := f(qualityScore, riskSeverity)
C. Composite quality+compliance→ finalScore := g(quality, compliance)  [discouraged: re-blurs semantics]
D. Other                       → must specify equation + user-facing meaning
```

### Display bound

```text
Live country/benchmark Hero composite remains ≤ 99
100 reserved for Quality V3 Near-Ideal publish semantics (existing product rule)
```

This is an existing product architecture rule (CODE FACT), not a calibration proof.

### Anti-patterns to forbid after approval

1. Compliance PASS ⇒ force finalScore to 99/100 without quality evidence.  
2. Compliance PASS ⇒ subtract points merely for “not ideal” **outside** the parameterQuality function (double-counting). Deviation from ideal belongs **inside** `parameterQuality`, not as a PASS surcharge.

---

## 9. Country Benchmark Profile Contract

```text
BenchmarkProfile {
  benchmarkKey          // thailand | japan | who | eu | usEpa
  modelVersion          // canonical model id, e.g. canonical-v1
  parameters: {
    [paramKey]: {
      ideal               // point or preferred interval
      qualityCurve        // curve family id + coefficients (when evidenced)
      complianceLimits    // legal/guideline band used for complianceStatus
      weight              // relative importance inside CANONICAL aggregator
      provenance: CITED | PRODUCT_DECISION | UNKNOWN
    }
  }
  requiredParameters    // drives NOT COMPUTABLE
  notes
}
```

### Rules

1. Profiles change **benchmark semantics** (ideals, limits, weights, provenance) only.  
2. Profiles **must not** embed alternate aggregation, country-only gates, or post-hoc caps as private math.  
3. `UNKNOWN` must remain `UNKNOWN` — never filled to “complete” the table.  
4. EU chlorine gate 65, if retained, must be reclassified as either:
   - a **compliance/risk rule in the canonical risk layer**, with provenance, or  
   - removed / replaced after Product Decision  
   — not a one-off engine branch.

### Initial provenance posture (summary)

| Area | Posture |
|------|---------|
| Per-country regulatory limits (many pH/TDS/turb caps) | Mix CITED / PROJECT — verify registry before lock |
| Shared ORP band/formula | UNKNOWN as national differentiation (CODE FACT shared) |
| EU gate 65 | UNSUPPORTED ANCHOR → PRODUCT DECISION REQUIRED |
| Japan DO weight present but unscored | Architectural inconsistency → PROFILE POLICY decision |
| Thailand DO excluded | PRODUCT DECISION REQUIRED + citation hunt |

---

## 10. Evidence / Calibration Contract

### Split two correctness notions

| Kind | Passes when | Fails when |
|------|-------------|------------|
| Mathematical correctness | Invariants hold on fixtures/sweeps | Dilution, inversion, missing→high, nondeterminism |
| Calibration correctness | Anchors match cited science or explicit Product decisions + labelled outcomes | “Looks about right” |

### Current REAL DATA posture (do not overclaim)

From V6 read-only investigation caches (not a full population census):

- Evidence snapshot referenced **84** clients in one pull.  
- Filtered evidence subset: **14** rows; **3** Cases with complete scored readings for country simulation; **11** empty/incomplete in that subset.  
- Quality/calibration literature in-repo still treats **Case 1328 as calibration-contaminated** for Quality generalization claims.

```text
UNKNOWN: population-wide distribution of readings / scores
UNKNOWN: outcome labels (customer/expert quality ratings) linked to scores
FORBIDDEN: claim calibration correctness from incomplete Cases or n≈1–3
```

### Confidence levels

| Claim type | Max confidence allowed now |
|------------|----------------------------|
| Structural defect of current engines | High (code + matrices) |
| Canonical architecture direction | Medium-high (product intent + math) |
| Any specific score band meaning (e.g. “85 = …”) | Low / UNKNOWN |
| Country ideal coefficients | UNKNOWN until registry + PD |

### Calibration gate (before model declared “correct”)

For any proposed score movement (e.g. 95→82):

1. Name the parameters and quality deltas that caused it.  
2. Cite curve/provenance entries.  
3. State whether the delta is mathematical-only or calibration-claimed.  
4. If calibration-claimed → require evidence id or `PRODUCT_DECISION` id.

---

## 11. Missing Data Contract

```text
IF any requiredParameters missing OR invalid under MeasurementValidator rules:
  status = NOT_COMPUTABLE
  qualityScore = null
  finalScore = null
  complianceStatus = may still report partial per-parameter if desired
                    but MUST NOT present a composite Hero number
```

Forbidden:

- Averaging only present params and showing a “real” Hero without disclosure.  
- Demo/HTML placeholder fills.  
- Inferring TDS/chlorine from unrelated fields.

---

## 12. Mathematical Invariants

Proposed invariants for any approved V7 model. If Product semantics conflict, **stop** and flag PD.

1. Ideal does not score below a degraded reading (same other inputs).  
2. Small degradation is observable when within the quality domain.  
3. Larger degradation never improves score (monotonicity away from ideal).  
4. PASS does not imply 100.  
5. PASS does not automatically cause a penalty outside parameterQuality.  
6. Compliance does not redefine parameterQuality.  
7. Critical risk cannot be silently hidden (in number **or** in mandatory UI, depending on Model A/B/C).  
8. Missing required data → `NOT_COMPUTABLE`.  
9. Deterministic.  
10. Bounded live composite 0–99.  
11. Country profile changes benchmark semantics, not aggregation mathematics.  
12. Explainable parameter-by-parameter.  
13. Historical published scores are immutable under normal re-share.

---

## 13. Real-Case Simulation Plan

### Data classes (segregated)

| Class | Use |
|-------|-----|
| Actual production complete Cases | Before/after impact table |
| Synthetic fixtures | Mathematical invariant tests only |
| Hypothetical narratives | Illustration only — never as calibration proof |

### Required table columns

```text
CaseId
Readings
Completeness (complete | NOT_COMPUTABLE)
Country/Profile
CurrentScore (engine today)
Proposed parameterQuality map
Proposed qualityScore
ComplianceStatus
RiskSeverity
Proposed finalScore (under each open Final Score model A/B/C if still undecided)
Delta
Reason (parameter-level)
Provenance (actual | synthetic)
```

### Initial computable Cases (actual)

| Case | Notes |
|------|-------|
| New C. 2026-08-11 | Complete; chlorine 0.7 drives EU gate today |
| New C. 2026-08-10 | Use standardMeasurement TDS (not legacy meter TDS alone) |
| 13.28 | Near-ideal; high scores may be legitimate under quality semantics |

All others in sparse subsets: `NOT_COMPUTABLE` until complete readings exist.

---

## 14. Historical / Published Score Contract

### Channels (must remain distinct)

| Channel | Today | V7 rule |
|---------|-------|---------|
| Live Hero | Country engine | Canonical model + selected BenchmarkProfile |
| Published `/r/{token}` | Persisted `Latest Water Score` (Quality V3 publish) | **Immutable snapshot**; display persisted number |
| Country Score Standard | Case Notion select | Remains profile selector; not publish score |

### Required snapshot fields (additive — design)

```text
publishedScore
modelVersion          // e.g. quality-v3.0 or future
benchmarkVersion      // optional if publish stays Q-V3-only
calculatedAt
inputFingerprint      // optional but recommended
```

### Close re-publish overwrite gap (mandatory before rollout)

**CODE FACT:** `POST /api/cases/:id/score` currently overwrites `Latest Water Score` with live `S.scoreVal`.

Design requirement:

```text
Default re-share / re-open publish path: DO NOT overwrite publishedScore
Explicit operator action: “Recalculate & republish” with new modelVersion
  → writes a new snapshot (or versioned history), never silent clobber
```

---

## 15. Versioning

### Recommended minimal dimensions

| Dimension | Purpose | When it changes |
|-----------|---------|-----------------|
| `modelVersion` | Canonical pipeline + aggregation + output semantics | Architecture/semantics change |
| `benchmarkVersion` | Profile ideals/limits/weights/provenance set | Country profile evidence update |
| `curveVersion` | **Optional** — only if curves version independently of benchmark bundle | Prefer folding into `benchmarkVersion` unless release process needs finer grain |

**Default recommendation:** start with **`modelVersion` + `benchmarkVersion` only**. Do not add `curveVersion` until operationally necessary.

Every stored/published result must answer:

> Which model and which benchmark definition produced this number?

---

## 16. Migration Strategy

```text
Phase 0  Approve Semantic + Final Score + Risk Model (this Design Gate)
Phase 1  Freeze published overwrite behavior (write-once / explicit republish)
Phase 2  Implement canonical pipeline behind flag (no default production Hero change)
Phase 3  Port five countries → BenchmarkProfile data only
Phase 4  Real complete-Case before/after simulation report (actual readings)
Phase 5  Calibration evidence program (expand complete Cases + labels) — gate for “correctness” claims
Phase 6  Staged rollout; live Hero switches by flag
Phase 7  Remove dead country-specific aggregators/gates or fold into risk layer explicitly
```

Rollback: feature flag off → previous engines; published snapshots untouched.

Q-V3 remains isolated publish engine unless a **separate** PD opens Quality rebuild.

---

## 17. Open Product Decisions

| ID | Decision | Options |
|----|----------|---------|
| PD-V7-01 | Live Hero `finalScore` identity | A Quality only / B Risk-adjusted / C Composite / D Other |
| PD-V7-02 | Risk integration model | A Ceiling / B Penalty / C Separate (UI-mandatory) |
| PD-V7-03 | Canonical aggregator | AGG-1…AGG-5 (+ α if hybrid) |
| PD-V7-04 | Supersede PD-006 compliance-index meaning for live Hero? | Yes / No / Dual-display |
| PD-V7-05 | Required parameter sets (esp. DO) per profile | Include / Exclude / Display-only |
| PD-V7-06 | ORP role | National differentiated / Shared operational / Remove from score |
| PD-V7-07 | EU chlorine gate 65 | Fold into risk layer / Replace / Remove |
| PD-V7-08 | Overall compliance aggregation | Worst-of / Any-fail / Weighted count |
| PD-V7-09 | Publish write-once policy | Approve gap fix before any live model switch |
| PD-V7-10 | Interpretation band card | Defer until calibration evidence OR publish as provisional |

---

## 18. Explicit Non-Goals

- Rewriting Portal, Case workflow, OCR, Framer, LINE, Dashboard contracts.  
- Renaming Notion properties.  
- “Make Thailand scores lower” as an objective.  
- Inventing numeric ideals/caps because they “look reasonable.”  
- Using incomplete Cases as calibration proof.  
- Implementing V7 code in this gate.  
- Auto-recalculating historical published Quality scores.  
- Merging Q-V3 and Country into one number without a dedicated PD.

---

## 19. Implementation Readiness Gate

| Gate | Status now |
|------|------------|
| V6 architecture REBUILD justified | PASS (investigation) |
| Semantic Contract drafted | PASS (this doc) — **approval pending** |
| Final Score semantics chosen | **FAIL** — PRODUCT DECISION REQUIRED |
| Risk model A/B/C chosen | **FAIL** — PRODUCT DECISION REQUIRED |
| Canonical aggregator chosen | **FAIL** — PRODUCT DECISION REQUIRED |
| Benchmark profiles filled without UNKNOWN sprawl | **FAIL** — evidence program needed |
| Missing data = NOT_COMPUTABLE specified | PASS (design) |
| Historical immutability + overwrite gap fix designed | PASS (design) — **implementation pending** |
| Real complete-Case simulation executed on proposed math | **FAIL** — needs approved math first |
| Calibration correctness claimed | **FAIL** — UNKNOWN / insufficient data |

```text
IMPLEMENTATION READINESS: NOT READY
Next step: Product Decision workshop on PD-V7-01, PD-V7-02, PD-V7-03, PD-V7-04, PD-V7-09
Then: Mathematical Model lock → profile porting plan → simulation → only then V7 implementation prompt
```

---

## 20. Pipeline under review (not final math)

Default candidate pipeline for discussion:

```text
Reading
  → Validation
  → Parameter Quality          // ideal distance
  → Canonical Quality Aggregation
  → qualityScore
  → Compliance Evaluation      // limits → complianceStatus
  → riskSeverity               // from compliance / critical rules
  → Final Score                // per PD-V7-01/02
```

### Alternative order (only if justified)

**Compliance-first gating before quality aggregate** — rejected as default because it re-entangles PASS with quality magnitude. May be used only for `NOT_COMPUTABLE` / hard safety stop decisions, not for grading.

**Risk before aggregation** — only meaningful for Model B-style per-parameter penalties; increases complexity; requires evidence.

---

## 21. Product Decision Log

### PD-V7-01 — APPROVED

**Ratified:** 2026-08-17  
**Decision:** **A — Quality Score**

```text
finalScore = qualityScore

0–99 = water quality relative to the ideal of the active BenchmarkProfile.
finalScore is not a compliance pass/fail score.

complianceStatus = separate output
riskSeverity     = separate output

PASS ≠ 100
PASS ≠ automatic penalty
```

Consequences:

1. A Severity Ceiling or Severity Penalty applied to `finalScore` would
   contradict this approved identity by turning it into risk-adjusted quality.
2. `riskSeverity` must remain explicit and cannot be silently hidden. The
   remaining PD-V7-02 decision is therefore how the separate risk output is
   made mandatory and unambiguous in the eventual UI contract; it does not
   reopen the meaning of `finalScore`.
3. A low `finalScore` with `PASS` is valid when parameter quality is distant
   from ideal. A high `finalScore` with `CRITICAL` is semantically possible,
   but the critical risk must be made explicit at the presentation contract.
4. Cross-Case magnitude comparison is allowed only under the same
   `modelVersion` and `benchmarkVersion`. Cross-country magnitude ranking
   remains prohibited.

### PD-V7-02 — APPROVED

**Ratified:** 2026-08-17  
**Decision:** **C — Separate Risk**

```text
finalScore   = qualityScore
riskSeverity = separate mandatory output
```

Severity ceiling / penalty on the quality digit are forbidden under this decision.

### Package ratification — APPROVED

**Ratified:** 2026-08-17 — Product `APPROVE V7 DESIGN PACKAGE`

| ID | Status |
|----|--------|
| PD-V7-03 | APPROVED — HYBRID-FAMILY (`α` / exact `F` = TBD until Calibration Gate) |
| PD-V7-RANGE | APPROVED — A — live `finalScore ∈ [0,99]` |
| PD-V7-04 | APPROVED — SUPERSEDE PD-006 live-Hero identity + gate legacy matrix |
| PD-V7-09 | APPROVED — WRITE-ONCE |

```text
DESIGN GATE: APPROVED
IMPLEMENTATION READINESS: READY FOR V7 IMPLEMENTATION PLANNING
```

Execution contract: [`V7_IMPLEMENTATION_PROMPT.md`](./V7_IMPLEMENTATION_PROMPT.md).  
Scoring code remains frozen until plan phases + calibration gate allow.

---

## Document control

| Field | Value |
|-------|-------|
| Title | Canonical Score Model Specification V1 — Design Only |
| Authoring mode | Design / investigation; no production mutation |
| Related | V6 canvas investigation; `COUNTRY_BENCHMARK_SEMANTIC_CONTRACT.md` (legacy); `MODEL_GOVERNANCE.md` |
| Approval | DESIGN GATE APPROVED 2026-08-17 — see V7_IMPLEMENTATION_PROMPT.md |
