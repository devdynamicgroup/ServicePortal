# Quality V3 — Product Decision Log

```text
Layer:
EVIDENCE REGISTRY (SoT) → PRODUCT DECISION → MODEL REPAIR (gated) → SCORE

Current layer: MODEL REPAIR (gated) — PD-015 Thailand calibration AUTHORIZED

Model status: Ideals/weights magnitudes frozen except Thailand excellent-band calibration per PD-015
Score formula status: FROZEN (mean/6)
Case flow: UNTOUCHED
```

**Nothing below is selected or implemented unless Status = `DECIDED` with an
explicit Product Owner sign-off in that record.**

```text
Architect recommendation ≠ Product Owner approval
Product recommendation ≠ Product Owner approval
Audit finding ≠ Product Owner decision
Evidence class ≠ authorization to change numbers
```

**Constant status SoT:** `evidence-registry/constants.json`
**Process:** `MODEL_GOVERNANCE.md`
**Country channel:** PD-006 DECIDED A — Compliance Index
**Quality aggregation:** PD-007 DECIDED D — mean/6 + FAIL publish override
**Cl provenance:** PD-008 DECIDED partial — TH/EPA/EU label repair; JP DO closed by PD-012 B
**Publish safety:** PD-009 DECIDED B — WARNING presentation override
**Ideal research:** PD-010 DECIDED B — RESEARCH COMPLETE; SAFE TO REPAIR NOW = NONE
**Ideal disposition:** PD-011 DECIDED A — all five KEEP+LABEL (PROJECT-DEFINED; no Ideal numeric change)
**Japan DO:** PD-012 DECIDED B — REMOVE DO from Japan Compliance Index
**Composite design:** PD-013 DECIDED A×5 — KEEP weights / WHO tiers / EPA-300 (no numeric change)
**Country model shape:** PD-014 DECIDED + IMPLEMENTED
**Thailand ordinary-band calibration:** PD-015 DECIDED — see `PD-015-THAILAND-CALIBRATION-SPEC.md`

---

## Decision status policy

| Status | Meaning |
| --- | --- |
| **OPEN** | Recommendation may exist; Product Owner has **not** approved. |
| **DECIDED** | Explicit PO sign-off exists in the PO SIGN-OFF block. |
| **DEFERRED** | Intentionally postponed pending evidence or another decision. |
| **IMPLEMENTED** | Implementation completed **after** `DECIDED` (not used until then). |

**Rules:**

- Do **not** mark `DECIDED` without explicit Product Owner approval.
- Do **not** invent Approved by / Date / Decision fields.
- Do **not** convert architect or facilitator recommendations into approval.
- **PD approval does not automatically authorize model changes.**
  Model changes require a separate implementation / evidence gate.

---

## Governance context

```text
Semantics:       PD-006 A · PD-007 D · PD-008 partial · PD-009 B · PD-010 B · PD-011 A · PD-012 B · PD-013 A×5 · PD-014 · PD-015
Model:           Ideals/weights frozen; PD-015 authorizes Thailand excellent-band calibration only
Score formula:   FROZEN (mean/6)
Evidence SoT:    evidence-registry/constants.json
Closed PDs:      PD-001–PD-015 (008 partial)
Open PDs:        (none for Thailand ordinary-band calibration)
```

**Synthetic baseline (construction output only — NOT a calibration target):**

```text
readings: { ph:7.85, tds:175, turbidity:0.42, orp:515, do:5.30, chlorine:0.70, temp:25 }
Pre-PD-015: Quality V3=76 · TH=97 · JP=98 · WHO=93 · EU=65 · EPA=98
PD-015 TH expectation (same readings): TH=95 (Japan/WHO/EU/EPA unchanged)
```

| Valid for | Not valid for |
| --- | --- |
| Regression replay | Calibration target |
| Behavior verification | Desired output / ranking target |
| Semantic audit | Justification for thresholds / weights / EU 65 |
| Detecting unintended score changes | Tuning for visual spread |

**Decision queue (priority):**

0. **PD-015 — Thailand Country Benchmark ordinary-band calibration — DECIDED (implement)**
1. PD-014 — Country Score model shape — **DECIDED + IMPLEMENTED**
2. PD-012 B / PD-013 A×5 — **DECIDED** (closed)
3. PD-011 — Ideal KEEP+LABEL — **DECIDED**
4. Ideal research (PD-010 B) — **COMPLETE**
5. PD-009 — WARNING presentation — **DECIDED B**
6. PD-008 — Cl provenance partial — **DECIDED partial**
7. PD-006 / PD-007 — **DECIDED**
8. PD-001–PD-005 — **DECIDED A**

**Verified root-cause position (summary):** Pipeline/arithmetic are **not** the
problem. Issues are semantic / construction (different engine semantics,
flat-100, EU gate unsupported anchor, TH DO exclusion by design, shared ORP,
weights without sufficient evidence). Magnitude ranking across countries is
not currently valid.

---

## Impact matrix

| Decision | UI | i18n | Metadata | Model | Score | Evidence | Product approval |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **PD-005** | possible | possible | possible | **NONE** | **NONE** | NO (policy) | **REQUIRED** |
| **PD-001** | yes | yes | possible | **NONE** | **NONE** | NO (UX semantics) | **REQUIRED** |
| **PD-002** | possible | possible | possible | **YES** (if changed) | **YES** | YES / product rationale | **REQUIRED** |
| **PD-003** | possible | possible | possible | **YES** | **YES** | YES | **REQUIRED** |
| **PD-004** | possible | possible | possible | **YES** | **YES** | YES | **REQUIRED** |
| **PD-006** | yes | yes | possible | **NONE** if A; **MAJOR** if B | **NONE** if A | NO for A | **REQUIRED** |
| **PD-007** | possible | possible | possible | **NONE** if A/D; **YES** if B/C/E | same | depends | **REQUIRED** |
| **PD-008** | possible | possible | possible | **YES** (cited ids only) | **YES** | YES | **REQUIRED** |
| **PD-009** | yes | yes | possible | **NONE** if A/B; **YES** if C/D | possible | NO for A/B | **REQUIRED** |
| **PD-010** | possible | possible | possible | **YES** if ideals change | **YES** | YES / research | **REQUIRED** |
| **PD-011** | possible | yes (labels) | possible | **YES** if C/D and ids cited | possible | YES | **REQUIRED** |
| **PD-014** | none until DECIDED+spec | none until DECIDED+spec | none until DECIDED | **YES** only if any B + follow-up spec approved | **YES** only if any B + spec | YES for any B | **REQUIRED** (four A/B) |

```text
PD approval does not automatically authorize model changes.
```

---

## Prior open items (Quality V3 — preserved)

§1 (Quality index vs safety / aggregation) was formalized as **PD-007**
(DECIDED D). Remaining gap: single-parameter catastrophe → Compliance
**WARNING** (not FAIL) so PD-007 D override may not fire — see **PD-009**.
Unsupported Q-V3 Ideal magnitudes — see **PD-010**. §2 (customer-facing
Quality vs Safety language) remains open and may follow PD-009/010.

### 2. Customer-facing Quality vs. Safety language

Quality-channel copy (e.g. “meets international standards”) remains a
product/brand decision separate from Country Benchmark PD-001. Prior
semantic-clarification copy for the **comparison** channel does **not**
close this Quality-channel item.

---

## PD-005 — Cross-country Benchmark Ranking Policy

- **Status:** DECIDED
- **Owner:** Product Owner
- **Date:** 2026-08-11
- **Priority:** 1

### Question

Can the 0–100 Country Benchmark scores be used to **rank countries**
(e.g. “Japan better than EU because 100 > 65”)?

### Options

#### A — FORBID MAGNITUDE RANKING

Scores may be shown independently:

```text
Under Thailand benchmark: 100
Under Japan benchmark: 100
Under WHO-style benchmark: 95
...
```

Product must **not** imply Japan > Thailand, Thailand > EU, EPA > WHO from
magnitude alone. **Equal scores remain valid.**

Allowed: per-engine score · per-parameter view within an engine ·
compliance interpretation within one engine.

Forbidden: cross-country ranking · sorting countries as best/worst by raw score.

#### B — REDESIGN COMPARISON SEMANTICS

Replace scalar ranking with e.g. parameter-level pass matrix /
benchmark-specific compliance status / evidence-backed comparison
dimensions. Larger product/model project — keep model frozen until redesign
is separately approved.

#### C — HARMONIZE THEN RANK

Allow ranking only after common parameter set, comparable semantics,
evidence-backed limits, comparable grading/weights/gates. **Major model
project** — mark Model Change Required; require evidence before
implementation.

### Recommendation (historical — superseded by PO decision)

**A — FORBID MAGNITUDE RANKING** *(facilitator recommendation only)*

### PO DECISION

- **Status:** DECIDED
- **Decision:** A — FORBID MAGNITUDE RANKING
- **Decision meaning:** Country Benchmark 0–100 scores MUST NOT be ranked against each other by magnitude.
- **Approved by:** User instruction / Product Owner instruction
- **Date:** 2026-08-11
- **Notes:** Implementation authorized for policy/copy/UX/semantic tests only. No model/score numeric change. Equal scores remain valid.

### Rationale

Engines differ in parameter inclusion, grading, weights, gates, and evidence
strength. Shared display scale ≠ shared measurement scale. Baseline
`100/100/95/65/99` is construction output, not ranking ground truth.

### Evidence Required

**NO** regulatory citation for the policy itself.

### Allowed Changes After Approval

- Documentation / product copy reinforcing no-ranking
- Policy-level prevention of “better country” language
- Semantic / policy tests
- UI labels that do not imply magnitude ranking

**Model and score math: NONE.**

### Explicitly Forbidden

- Numeric tuning · threshold / weight / gate / ORP / DO changes
- Artificial country differentiation
- Calibrating against `76 / 100 / 100 / 95 / 65 / 99`

### Acceptance Criteria

1. Product must not describe raw country scores as a ranking.
2. Equal scores remain valid.
3. No score math changes required.
4. No artificial country differentiation.
5. Baseline and production math unchanged.

---

## PD-001 — Country Benchmark Verdict Semantics

- **Status:** DECIDED
- **Owner:** Product Owner
- **Date:** 2026-08-11
- **Priority:** 2

### Question

Should comparison scores use quality-gradient verdict labels
(`Excellent` / `Good` / `Fair` / `Poor`) when engines often use flat pass
bands?

### Audit finding (not a decision)

```text
Flat-100 ⇒ 100 often means within accepted / pass band
100 ≠ proven “perfect” or “excellent” water quality
```

### Options

#### A — PASS-BAND LANGUAGE

Wording such as: Within pass band · Comparison pass · Within selected
comparison limits (instead of implying superior water quality).

Advantages: smallest blast radius · preserves scoring · describes flat-100 ·
no regulatory evidence required.

#### B — STRICT COMPLIANCE VERDICT

Use only PASS / WARNING / FAIL (or equivalent). Strongest semantic
alignment; potentially larger UX/product change. Define exact compliance
states before implementation.

#### C — KEEP CURRENT VERDICT + DISCLAIMER

Keep Excellent/Good/… with explicit disclaimer. Minimal change; **residual
semantic risk remains.** **Not recommended.**

### Recommendation (historical — superseded by PO decision)

**A** *(facilitator recommendation only)*

### PO DECISION

- **Status:** DECIDED
- **Decision:** A — PASS-BAND / COMPARISON-PASS LANGUAGE
- **Decision meaning:** Country Benchmark comparison scores MUST use pass-band/comparison-pass semantics rather than quality-gradient wording such as Excellent/Good.
- **Approved by:** User instruction / Product Owner instruction
- **Date:** 2026-08-11
- **Notes:** Presentation/i18n/badge layer only. Do not change scoring math, thresholds, weights, or gates. Baseline must remain 76/100/100/95/65/99.

### Rationale

Quality-gradient labels overclaim what flat-100 establishes. PD-005 forbids
ranking; PD-001 ensures a single-engine view does not overclaim quality.

### Evidence Required

**NO** regulatory citation — UX / product semantics decision.

### Allowed Changes After Approval

- Verdict copy · i18n · UI badges · metadata display labels
- Tests protecting verdict semantics

**Score calculation, thresholds, weights, gates: unchanged.**

### Explicitly Forbidden

- Tuning curves to “justify Excellent”
- Threshold / weight / gate changes
- Artificial country differentiation
- Changing baseline numbers

### Acceptance Criteria

1. Comparison verdict wording does not claim universal quality.
2. Score 100 is not presented as “perfect” / “Excellent” for Country Benchmark.
3. Pass-band wording is used instead.
4. No scoring math change; baseline unchanged; tests green.

---

## PD-002: EU chlorine hard-gate anchor

- **Status:** DECIDED
- **Decision:** A — KEEP AS EXPLICIT PROJECT HARD GATE (UNSUPPORTED ANCHOR)
- **Recommendation:** A
- **Owner:** Product
- **PO Approval:** APPROVED
- **Approved by:** Product Owner
- **Date:** 2026-08-11

**Do not merge** into PD-005 / PD-001 (already DECIDED).

### Question

What should happen to `gateCapOnChlorineFail = 65` in the EU Country Benchmark engine?

### Evidence

```text
Code:          src/js/score/benchmark/eu/limits.js → gateCapOnChlorineFail: 65
Origin:        commit f5579564 (2026-08-07)
Mechanism:     chlorine outside EU engine band → Math.min(score, 65)
Directive:     NO AUTHORITATIVE SOURCE defines 65 as EU regulatory /
               Directive score, penalty, or mandated composite cap
Derivation:    NO mathematical derivation from Directive 2020/2184
Test lock:     behavior lock ≠ regulatory evidence
```

```text
65 = UNSUPPORTED ANCHOR
gate intent = project / engineering design
```

Safe product wording:

```text
EU 65 is a project hard-gate outcome after chlorine is outside
this engine's band.

65 is NOT an EU Directive score.

65 remains an UNSUPPORTED ANCHOR.
```

### Options

**A — KEEP AS EXPLICIT PRODUCT RULE** — Keep `65` unchanged. Document as project hard gate; retain UNSUPPORTED ANCHOR; never describe as EU regulatory scoring; no model or numeric change.

**B — REMOVE HARD CAP** — Remove hard-cap behavior; expose uncapped composite. Requires explicit Product Decision before implementation. **No implementation in this task.**

**C — REPLACE WITH EVIDENCE-BACKED VALUE** — Replace only after authoritative evidence or explicit Product Owner rationale. Forbidden: 65 → 60/70/80 for realism. **No implementation in this task.**

### Recommendation

A

```text
Recommendation ≠ Approval
```

### Rationale

Preserves current behavior and regression stability. Separates product rule from regulation without pretending 65 is evidence-derived. Avoids arbitrary numeric replacement. Keeps future evidence/model review open. **A does NOT upgrade 65 from UNSUPPORTED ANCHOR.**

### Evidence requirement

| Option | Evidence required |
| --- | --- |
| **A** | NO (Product accepts named product rule while documenting UNSUPPORTED ANCHOR) |
| **B** | Impact analysis on EU composite behavior; explicit PO approval |
| **C** | Authoritative citation **or** explicit PO rationale explaining why chlorine failure triggers a hard gate **and** why the replacement number is justified |

### Allowed implementation after approval

| If Decision | Allowed now | Follow-up |
| --- | --- | --- |
| **A** | Governance/documentation semantics only | None required |
| **B** | Planning only | Separate EU engine implementation task |
| **C** | Planning only | Separate evidence review + EU engine implementation task |

### Explicitly forbidden

- Changing 65 → another number for realism (65 → 60 / 70 / 80)
- Removing/replacing gate without DECIDED + scoped implementation
- Claiming “EU Directive score = 65” or that EU law requires 65
- Using baseline EU=65 as calibration target
- Marking DECIDED without explicit PO sign-off

### Acceptance criteria

**If A is eventually approved:**

```text
gateCap remains 65
65 remains explicitly classified UNSUPPORTED ANCHOR
no claim that 65 is EU regulatory score
no formula/threshold change
```

**If B is approved:** only then may implementation planning begin.

**If C is approved:** citation + rationale must exist before numeric replacement.

Baseline regression reference unchanged: `76 / 100 / 100 / 95 / 65 / 99`.

### PO DECISION

- **Status:** DECIDED
- **Decision:** A — KEEP AS EXPLICIT PROJECT HARD GATE (UNSUPPORTED ANCHOR)
- **Decision meaning:** EU `gateCapOnChlorineFail = 65` is retained as a project hard-gate outcome. 65 is NOT an EU Directive score. 65 remains classified as UNSUPPORTED ANCHOR. No numeric, threshold, weight, or model change.
- **Approved by:** Product Owner
- **Date:** 2026-08-11
- **Notes:** Documentation/semantic framing only. No model change required or authorized.

---

## PD-003: Thailand DO treatment

- **Status:** DECIDED
- **Decision:** A — KEEP DO EXCLUDED AS PROJECT DESIGN
- **Recommendation:** A
- **Owner:** Product
- **PO Approval:** APPROVED
- **Approved by:** Product Owner
- **Date:** 2026-08-11

**Do not merge** into PD-005 / PD-001 (already DECIDED).

### Question

Should Thailand continue to exclude DO from the Country Benchmark score?

### Evidence

```text
Code:     thailand/weights.js — DO/Temp omitted from weights
          thailand/limits.js — do: Not specified; unbounded: true
          thailand/score.js — “DO and Temp are not scored”
Comment:  “Thailand does not score them” = project statement
Origin:   founding commit f5579564
Lists:    DO not found among reviewed DoH recommendation / MWA surveillance params
Legal:    NO AUTHORITATIVE CLAUSE found stating Thai DW regulation explicitly excludes DO
```

```text
PROJECT DESIGN: DO EXCLUDED

+
DO was not found in reviewed Thai drinking-water
recommendation / potable surveillance parameter lists

BUT

legal exclusion is NOT established
```

Safe product wording:

```text
This project does not score DO for the Thailand Country Benchmark.

DO exclusion is project design.

DO was not found among the reviewed Thai drinking-water
recommendation / potable surveillance parameter lists.

This does NOT prove that Thai law explicitly excludes DO.
```

Never state “Thai law excludes DO” unless an authoritative citation explicitly proves it.

### Options

**A — KEEP DO EXCLUDED AS PROJECT DESIGN** — Keep current model unchanged. Document PROJECT DESIGN: DO EXCLUDED. No regulatory claim. No model, numeric, or threshold change.

**B — INCLUDE DO USING CITED THAI LIMIT** — Only after authoritative Thai drinking-water evidence establishes the relevant limit and PO explicitly approves model change. Do not invent the limit. **No implementation now.**

**C — INCLUDE DO AS OPERATIONAL INDICATOR** — Requires Product Decision defining composite vs display-only vs operational status. **No implementation now.**

### Recommendation

A

```text
Recommendation ≠ Approval
```

### Rationale

Matches current product design. Avoids unsupported legal claims. Avoids importing foreign DO limits. No model change without Thai evidence basis. Preserves documented bias (weak DO does not reduce TH score) as a known model characteristic.

### Evidence requirement

| Option | Evidence required |
| --- | --- |
| **A** | NO (honest project-design wording) |
| **B** | Authoritative Thai drinking-water source; specific applicable criterion; numeric limit; scope; rationale for scoring role |
| **C** | Product definition of operational semantics (composite impact, display-only, status channel) |

### Allowed implementation after approval

| If Decision | Allowed now | Follow-up |
| --- | --- | --- |
| **A** | Docs/wording only | None required |
| **B** | Planning only | Separate TH engine implementation after cited limit |
| **C** | Planning only | Separate product + model design task |

### Explicitly forbidden

- Claiming “Thai law excludes DO” without cited article
- Adding DO for score spread / TH↔JP differentiation
- Importing non-Thai DO thresholds as Thai regulatory
- Marking DECIDED without explicit PO sign-off

### Acceptance criteria

**If A is eventually approved:**

```text
Thailand continues excluding DO
wording remains PROJECT DESIGN
no claim that Thai law explicitly excludes DO
```

**If B is approved:** authoritative Thai citation required before implementation.

**If C is approved:** Product must explicitly define operational semantics before implementation.

Baseline regression reference unchanged: `76 / 100 / 100 / 95 / 65 / 99`.

### PO DECISION

- **Status:** DECIDED
- **Decision:** A — KEEP DO EXCLUDED AS PROJECT DESIGN
- **Decision meaning:** Thailand Country Benchmark continues to exclude DO. DO exclusion is project design. This does NOT prove that Thai law explicitly excludes DO. No model, numeric, or threshold change.
- **Approved by:** Product Owner
- **Date:** 2026-08-11
- **Notes:** Documentation/semantic framing only. No model change required or authorized.

---

## PD-004: ORP role in country benchmark

- **Status:** DECIDED
- **Decision:** A — KEEP AS SHARED OPERATIONAL / PROJECT BAND
- **Recommendation:** A
- **Owner:** Product
- **PO Approval:** APPROVED
- **Approved by:** Product Owner
- **Date:** 2026-08-11

**Do not merge** into PD-005 / PD-001 (already DECIDED).

### Question

How should ORP 200–600 be treated in country engines?

### Evidence

```text
Code:     ORP min=200 max=600 identical across TH/JP/WHO/EU/EPA limits.js
Origin:   founding commit f5579564 (shared copy)
TH:       no country-specific DW ORP band verified
JP:       not among MHLW 51 water-quality criteria; ops monitoring ≠ criterion 200–600
WHO:      operational disinfection monitoring; universal ORP values cannot be recommended
EU:       no Directive parametric ORP 200–600 verified
EPA:      no MCL/MRDL/SMCL for ORP 200–600 verified
```

```text
NO COUNTRY-SPECIFIC DRINKING-WATER STANDARD VERIFIED

ORP 200–600 = shared operational / project construction

NOT

five independent national drinking-water standards
```

### Options

**A — KEEP AS SHARED OPERATIONAL / PROJECT BAND** — Keep `200–600` unchanged. Label as shared operational indicator / project construction; not a national drinking-water standard. No numeric or model change.

**B — REMOVE ORP FROM COUNTRY COMPOSITES** — ORP becomes display/operational only. Requires model redesign and explicit Product Decision. **No implementation now.**

**C — CREATE COUNTRY-SPECIFIC ORP BANDS** — Only after authoritative country-specific evidence per jurisdiction. Do not derive values for differentiation. **No implementation now.**

### Recommendation

A

```text
Recommendation ≠ Approval
```

### Rationale

Evidence does not support national regulatory framing for any engine. Semantic correction is sufficient. Avoids arbitrary per-country bands and unnecessary model change. Preserves regression stability.

### Evidence requirement

| Option | Evidence required |
| --- | --- |
| **A** | NO (Product accepts shared operational framing) |
| **B** | Impact analysis on all five composites; explicit PO approval |
| **C** | Authoritative per-country drinking-water evidence for each band; no artificial differentiation |

### Allowed implementation after approval

| If Decision | Allowed now | Follow-up |
| --- | --- | --- |
| **A** | Docs/labels reinforcing shared-ops framing | None required |
| **B** | Planning only | Separate model redesign task |
| **C** | Planning only | Separate per-country evidence + implementation |

### Explicitly forbidden

- Claiming five independent national ORP standards
- Inventing country-specific ORP for spread
- Claiming 200–600 is a WHO guideline value or EPA MCL
- Copying 200–600 and relabeling as country-specific evidence
- Marking DECIDED without explicit PO sign-off

### Acceptance criteria

**If A is eventually approved:**

```text
ORP remains 200–600
ORP is labeled shared operational/project construction
no country-specific standard claim
```

**If B is approved:** model redesign required before implementation.

**If C is approved:** authoritative country-specific evidence required; no artificial differentiation.

Baseline regression reference unchanged: `76 / 100 / 100 / 95 / 65 / 99`.

### PO DECISION

- **Status:** DECIDED
- **Decision:** A — KEEP AS SHARED OPERATIONAL / PROJECT BAND
- **Decision meaning:** ORP 200–600 is retained as a shared operational/project band. It is NOT five independent national drinking-water standards. No country-specific ORP bands created. No numeric, threshold, weight, or model change.
- **Approved by:** Product Owner
- **Date:** 2026-08-11
- **Notes:** Documentation/semantic framing only. No model change required or authorized.

---

## PD-006: Country Score channel identity

- **Status:** DECIDED
- **Owner:** Product Owner
- **Date opened:** 2026-08-13
- **Date decided:** 2026-08-13
- **Priority:** 1
- **Depends on:** Evidence registry SoT locked; PD-001 / PD-005 DECIDED A
- **Blocks:** _(cleared — PD-008 may open after PD-007 also DECIDED)_

### Question

Is Country Benchmark permanently a **Compliance / Benchmark Index** (flat
in-band pass semantics), or must the product also expose a separate
**country-linked Quality** score?

### Evidence (not a decision)

```text
Code behavior:     flat-in-band → grade 100 on most country engines
PD-001:            comparison UI = pass-band language (DECIDED A)
PD-005:            no cross-country magnitude ranking (DECIDED A)
Contract doc:      Country Benchmark = compliance / benchmark signal
Architecture:      Quality V3 · Compliance (PASS/WARNING/FAIL) · Country
                   Benchmark are three parallel channels
Registry:          many country constants CONFLICTING / UNSUPPORTED /
                   PROJECT-DEFINED — unsafe to call “national quality score”
```

### Options

#### A — COMPLIANCE INDEX (formalize current truth)

Country Score = **Compliance / Benchmark Index** for the selected engine only.

- Keep flat-in-band construction as the intended meaning of 100
- Quality remains **Quality V3 only**
- PASS/WARNING/FAIL remains the separate Compliance channel
- Do **not** invent a fourth “country quality” score in this PD

**Model impact if A:** NONE required. Label/docs/tests only.

#### B — DUAL OUTPUT (compliance + country quality)

Each country engine must eventually emit both:

1. compliance / pass-band signal  
2. a graded quality-like score under that engine’s limits  

**Model impact if B:** MAJOR redesign. Requires separate curves, evidence,
and later Model Repair — **not** authorized by choosing B alone.

#### C — RENAME ONLY / DEFER SUBSTANCE

Keep math; only rename product strings (e.g. “Compliance Index”) without
locking the long-term channel model.

**Model impact if C:** NONE. Residual ambiguity remains (not recommended as
final).

### Recommendation (facilitator only — NOT approval)

**A — COMPLIANCE INDEX**

Matches shipped behavior, PD-001/005, and the semantic contract. Avoids
building a second quality model on unsupported constants.

```text
Recommendation ≠ Approval
```

### Evidence Required

| Option | Evidence required |
| --- | --- |
| **A** | NO (product accepts compliance identity) |
| **B** | Full redesign brief + evidence for quality curves per engine |
| **C** | NO (but leaves PD-006 effectively unresolved) |

### Allowed after DECIDED

| Decision | Allowed now | Forbidden |
| --- | --- | --- |
| **A** | Docs, UI copy, semantic tests locking compliance identity | Threshold/weight/curve/gate changes |
| **B** | Planning docs only | Same-pass engine math changes |
| **C** | Copy experiments only | Claiming the channel question is closed |

### Explicitly Forbidden

- Marking DECIDED without PO sign-off
- Using PD-006 to authorize TH Cl / JP DO / EU Cl / EPA Cl numeric edits
- Artificial country score spread

### PO DECISION

- **Status:** DECIDED
- **Decision:** A — COMPLIANCE INDEX (formalize current truth)
- **Decision meaning:** Country Benchmark / Country Score is a **Compliance / Benchmark Index** for the selected engine only. Flat-in-band 100 means within modeled pass bands — **not** “best quality.” Quality remains **Quality V3 only**. PASS/WARNING/FAIL remains the separate Compliance channel. No fourth “country quality” score is authorized by this decision.
- **Approved by:** Product Owner
- **Date:** 2026-08-13
- **Notes:** Documentation / UI copy / semantic tests only. **No model, threshold, weight, curve, or gate change.** Baseline unchanged. Unlocks opening PD-008 after PD-007 also DECIDED.

---

## PD-007: Quality V3 aggregation (`mean / 6`)

- **Status:** DECIDED
- **Owner:** Product Owner
- **Date opened:** 2026-08-13
- **Date decided:** 2026-08-13
- **Priority:** 2
- **Depends on:** Evidence registry SoT; prior §1 candidate definition
- **Blocks:** _(cleared — PD-008 may open)_

### Question

Should Quality V3 continue as an **unweighted arithmetic mean of 6
parameter grades**, accepting that one catastrophic parameter + five ideals
≈ **84–87**, or must aggregation change so catastrophe cannot hide in the
average?

### Evidence (not a decision)

```text
Code:           computeQualityScoreV2.js — equal mean of ph/tds/turb/orp/cl/do
Dilution:       mathematically expected under averaging
Separate:       Compliance channel already PASS/WARNING/FAIL on bands
Open history:   UNRESOLVED §1 (promoted here); Candidate Product Definition
                “Normal Drinking Water Quality” = CANDIDATE, NOT APPROVED
Registry:       Q-V3 ideals mostly PROJECT-DEFINED / UNSUPPORTED / PARTIAL
```

### Options

#### A — KEEP MEAN AS QUALITY INDEX

Quality V3 = closeness-to-ideal index via `mean/6`. Catastrophe is allowed
to dilute **if** Compliance (and UX) still surface FAIL/WARNING honestly.

**Model impact if A:** NONE for aggregation. Ideals still gated elsewhere.

#### B — WEIGHTED MEAN

Assign unequal weights to parameters. Magnitudes need Product Decision +
evidence; do not invent weights from baseline aesthetics.

**Model impact if B:** YES (weights). Requires evidence / explicit magnitudes.

#### C — HARD SAFETY GATE ON QUALITY

Cap or override Quality when any critical parameter is catastrophic
(EU-style gate pattern). Must define which parameters are “critical.”

**Model impact if C:** YES (gate rule + critical set).

#### D — QUALITY + COMPLIANCE HYBRID (presentation / publish rule)

Keep `mean/6` math; publish path must not show a high Quality score alone
when Compliance is FAIL (or equivalent hybrid rule).

**Model impact if D:** Possibly NONE on formula; YES on publish/UX rules.

#### E — NONLINEAR AGGREGATION

e.g. geometric mean, min-primary, softmin. Research + Product Decision on
formula; high false-precision risk.

**Model impact if E:** YES (formula).

### Recommendation (facilitator only — NOT approval)

**A or D** — keep mean as quality index; ensure catastrophe is visible via
Compliance / publish rules rather than silently retuning ideals.

Prefer **D** if product risk is “customer sees 85 and thinks water is fine
while Compliance is FAIL.” Prefer **A** if Compliance UI already blocks that
misread.

```text
Recommendation ≠ Approval
```

### Evidence Required

| Option | Evidence required |
| --- | --- |
| **A** | NO (accept dilution as quality-index math) |
| **B** | Weight rationale + evidence; no baseline tuning |
| **C** | Critical-parameter definition + gate rationale |
| **D** | Publish/UX rule definition; may need no formula change |
| **E** | Formula paper / product rationale; holdout plan |

### Allowed after DECIDED

| Decision | Allowed now | Forbidden |
| --- | --- | --- |
| **A** | Docs clarifying “quality index ≠ safety score” | Quiet weight/curve edits |
| **B/C/E** | Planning only until magnitudes/rules specified | Same-pass numeric invention |
| **D** | Publish/UX/semantic tests | Using D to change TH/JP/EU/EPA bands |

### Explicitly Forbidden

- Approving PD-007 by “making Case baseline look better”
- Changing Q-V3 ideals under the cover of aggregation choice
- Marking DECIDED without PO sign-off

### PO DECISION

- **Status:** DECIDED
- **Decision:** D — QUALITY + COMPLIANCE HYBRID (presentation / publish rule)
- **Decision meaning:** Quality V3 **keeps** unweighted `mean/6` math (quality index may dilute a catastrophic parameter). Publish / Quality presentation **must not** show Excellent/Good (or equivalent “น้ำดี”) alone when Compliance is **FAIL**. Compliance FAIL overrides quality-gradient wording on the Quality/publish path. Numeric score unchanged. No new weights, hard gates, or ideal retunes authorized by this decision.
- **Approved by:** Product Owner
- **Date:** 2026-08-13
- **Notes:** Presentation/UX/semantic tests authorized. Formula frozen. Baseline `76/100/100/95/65/99` unchanged. Opens PD-008 together with PD-006 A.

---

## PD-008: Model Repair authorization (registry-gated)

- **Status:** DECIDED (partial — JP-DO-MIN deferred)
- **Owner:** Product Owner
- **Date opened:** 2026-08-13
- **Date decided:** 2026-08-13
- **Priority:** next (after PD-006 / PD-007)
- **Depends on:** PD-006 DECIDED A · PD-007 DECIDED D · `constants.json` SoT

### Question

Which registry `id`s are authorized for numeric change, and what replacement
**semantic** (not merely what “nicer number”) is approved?

### Gate context (locked by prior decisions)

```text
PD-006 A → Country Score = Compliance Index (not quality)
PD-007 D → Quality math stays mean/6; FAIL overrides Quality wording
Therefore Model Repair must not “fix country quality spread” or
retune Q-V3 ideals to dodge dilution — those semantics are closed.
```

### Gated candidates (minimum set — workshop now)

| Registry `id` | Class | Code | Proposed workshop options |
| --- | --- | --- | --- |
| `TH-CHLORINE-BAND` | CONFLICTING | `0.2–2.0` | **A** KEEP+LABEL (admit non-DoH) · **B** REPLACE upper with cited `0.2–0.5` residual · **C** REMOVE Cl from TH composite · **D** PROJECT-DEFINED band (explicit, labeled) |
| `EPA-CHLORINE-BAND` | CONFLICTING | `0.2–4.0` Ideal | **A** KEEP+LABEL as MRDL ceiling framing (not Ideal) · **B** score as MRDL-only (max 4.0, no 0.2 Ideal floor) · **C** REMOVE from Ideal composite · **D** PROJECT-DEFINED residual band (cited separately) |
| `EU-CHLORINE-BAND` | CONFLICTING | `0.1–0.5` | **A** KEEP+LABEL as project residual (not Directive) · **B** REMOVE free-Cl band / gate-only · **C** Member-state inspired PROJECT-DEFINED · **D** wait for MS citation |
| `JP-DO-MIN` | UNSUPPORTED | `≥5` | **A** KEEP+LABEL as project/ops · **B** REMOVE from JP composite (display only) · **C** RESEARCH then cite · **D** PROJECT-DEFINED with explicit non-criterion label |

Also deferred under `PD_REQUIRED` / `RESEARCH` (not in this minimum set unless PO expands scope): JP/EU/EPA weights, WHO tier scores, Q-V3 ideals/curves.

### Options (process)

For **each** `id` above, PO must pick one letter option (or DEFER that id).
A single PD-008 decision record may authorize a **subset** of ids.

```text
No id may change without appearing in the PO SIGN-OFF id list.
Unlisted constants remain frozen.
```

### Recommendation (facilitator only — NOT approval)

Workshop in this order: **TH Cl → EPA Cl → EU Cl → JP DO**.
Prefer options that **remove false national claims** (LABEL / REMOVE / cited REPLACE) over inventing new Ideal magnitudes.

```text
Recommendation ≠ Approval
```

### Evidence Required

| Path | Evidence |
| --- | --- |
| REPLACE with source_value | Authoritative citation already in registry (or newly added with clause) |
| PROJECT-DEFINED | Explicit PO acceptance that number is project, not national |
| REMOVE from composite | Impact note on that engine’s weights/normalization |
| KEEP+LABEL | Copy/tests only — **no numeric change** |

### Allowed after DECIDED

| If PO cites ids + options | Allowed | Forbidden |
| --- | --- | --- |
| KEEP+LABEL only | Docs/labels/tests | Code value edits |
| REPLACE / REMOVE / PROJECT-DEFINED | Model Repair **only** for cited ids | Unlisted ids; Q-V3 mean change; Case flow; baseline-targeted tuning |

### Explicitly Forbidden

- Opening numeric edits while any cited option lacks evidence/label clarity
- Using PD-008 to reopen PD-006/PD-007 semantics
- Artificial TH≠JP differentiation for UI cosmetics
- Marking DECIDED without id list + Approved by + Date

### PO DECISION

- **Status:** DECIDED (partial — three ids; JP deferred)
- **Decision:**
  - `TH-CHLORINE-BAND` → **NO SAFE NUMERIC CHANGE** (KEEP + LABEL / PROJECT-DEFINED band; DoH 0.2–0.5 surveillance residual not adopted as legal compliance Ideal)
  - `EPA-CHLORINE-BAND` → **SEMANTIC REPAIR** (KEEP numbers; split `projectMin=0.2` PROJECT-DEFINED + `mrdlMax=4.0` EPA MRDL VERIFIED; stop Ideal/MRDL-band overclaim)
  - `EU-CHLORINE-BAND` → **NO SAFE NUMERIC CHANGE** (KEEP + LABEL as PROJECT-DEFINED; de-claim Directive free-Cl residual; **gate 65 unchanged** per PD-002)
  - `JP-DO-MIN` → **DEFERRED** (no numeric repair)
- **Authorized constant ids:** `TH-CHLORINE-BAND`, `EPA-CHLORINE-BAND`, `EU-CHLORINE-BAND` (label/provenance only; no band magnitude change)
- **Approved by:** Product Owner (PD-008 forensic implementation task)
- **Date:** 2026-08-13
- **Notes:** Baseline `76/100/100/95/65/99` unchanged. Case flow untouched. No Q-V3 / WHO / JP numeric edits.

---

## PD-009: Quality catastrophe / publish safety meaning

- **Status:** DECIDED
- **Opened:** 2026-08-13
- **Priority:** P1 — finishes “what does a high Quality number mean when water is unsafe?”
- **Depends on:** PD-007 D (mean/6 + FAIL override already live)
- **Does not reopen:** PD-006 Compliance Index · PD-008 Cl provenance · Case flow
- **Does not invent:** new gate magnitudes, fail thresholds, or regulatory claims

### Why this is open

PD-007 D only overrides Excellent/Good when Compliance status is **FAIL**.
Compliance FAIL currently requires **≥2 failed parameters**. A single
catastrophic parameter (e.g. Cl≈0 dilution, extreme turbidity) yields
Compliance **WARNING** + Quality still high (~83–84) from mean/6 dilution
of five strong parameters. That is a **publish-meaning** gap, not a
Country Index bug.

### Evidence pack (decision inputs — not approvals)

| Evidence | Class | What it supports | What it does NOT authorize |
| --- | --- | --- | --- |
| PD-007 D live rule: override only on Compliance FAIL | Product contract | Hybrid publish already exists | Extending override to WARNING |
| Compliance FAIL iff `failed.length >= 2` (production path) | Code behavior | Explains dilution gap | Changing fail count without PO |
| Mean/6 arithmetic dilution (one ~0 + five highs ≈ mid-80s) | Math fact | Why high Quality coexists with catastrophe | Changing formula without PD-010 / separate auth |
| Registry: no verified “catastrophe hard gate” constant | Evidence SoT | Gate numbers are unsupported if invented | Inventing a magic number (e.g. 40) |
| Baseline Cl=0.7 path is non-catastrophic | Regression ref | Baseline can stay 76 under A/B | Using baseline to pick gate size |

### Options (choose one primary)

| Option | Meaning | Model / score | UI / publish | Evidence need |
| --- | --- | --- | --- | --- |
| **A — KEEP PD-007 D only** | Override stays FAIL-only; WARNING + high Quality allowed | **NONE** | Docs/copy clarify WARNING ≠ safe | None (acceptance of current gap) |
| **B — Extend override to WARNING** | Any Compliance WARNING blocks Excellent/Good wording | **NONE** (presentation) | Broader wording override | Product policy only |
| **C — Catastrophe hard gate (numeric)** | Cap or force FAIL when any param below product catastrophe band | **YES** — needs cited constant ids + magnitudes | Strong safety signal | **HIGH** — must not invent numbers |
| **D — Hybrid publish (score + safety strip)** | Keep mean/6 number; always show Safety/Compliance strip as co-primary | **NONE** preferred | Layout/copy | Product UX only |
| **E — DEFER** | Wait for PD-010 Ideal pack / research | **NONE** | Workshop only | Explicit deferral |

```text
Recommendation (facilitator — NOT approval · 2026-08-13):
  PD-009 = B

  Meaning if PO later approves B:
    Extend presentation override so Compliance WARNING from critical
    failure is not communicated as Excellent/Good.
    No formula change. No score magnitude change.

  Why B (conservative):
    Closes the publish-meaning gap without inventing catastrophe gates.
    Prefer B (or D) before C. Do not invent gate magnitudes under C.

  Status remains OPEN until Product Owner fills PO DECISION below.
```

### If DECIDED — what unlocks

| Choice | Allowed next | Still forbidden |
| --- | --- | --- |
| A | Docs clarifying WARNING vs FAIL | Numeric gates; formula change |
| B | Presentation/i18n extend override to WARNING | Changing fail-count math without separate auth |
| C | Model Repair **only** for cited catastrophe constant ids | Invented undocumented thresholds |
| D | Publish UX / share card layout | Silent Ideal retuning |
| E | Keep workshop open | Treating deferral as KEEP forever |

### Explicitly Forbidden

- Inventing catastrophe gate numbers “because 40 feels right”
- Using PD-009 to retune Q-V3 Ideals (that is **PD-010**)
- Using PD-009 to force TH≠JP or change Country Compliance bands
- Case / Notion / Booking / Calendar / API route changes
- Marking DECIDED without Approved by + Date + chosen option letter

### PO DECISION

- **Status:** DECIDED
- **Decision:** B — EXTEND PRESENTATION OVERRIDE TO WARNING
- **Decision meaning:** On the Quality / publish path, Compliance **WARNING** must not be presented as unqualified Excellent/Good. Presentation-only: Quality V3 score, mean/6, parameter grades, Compliance FAIL/WARNING calculation, and PD-007 D FAIL override remain unchanged. WARNING uses distinct copy from FAIL. No numeric catastrophe gate.
- **Authorized scope:** `qualityPublishPresentation` + i18n + Quality/publish notes; preserve `complianceStatus` on share/persist paths already in architecture.
- **Excluded scope:** Numeric gates/thresholds/weights/curves/aggregation; country scoring; Case Flow / api / services / Notion / Calendar / Booking / OCR; Ideal retunes (PD-010).
- **Approved by:** Nattakamon Ph.
- **Date:** 2026-08-13
- **Notes:** Facilitator recommendation was B; PO approved B. Baseline `76/100/100/95/65/99` must remain unchanged. Numeric model LOCKED.

---

## PD-010: Quality V3 Ideal pack (unsupported ideals)

- **Status:** DECIDED
- **Opened:** 2026-08-13
- **Priority:** P1 — finishes “what do Quality points measure against?”
- **Depends on:** PD-007 D (formula mean/6 kept unless this PD changes aggregation — default: keep mean/6)
- **Does not reopen:** PD-006 · PD-008 Cl provenance bands · PD-002 EU gate 65
- **Default freeze:** leave `code_value` unchanged until a **new** Product Decision cites Ideal ids after research

### Why this is open

Quality V3 grades parameters toward Ideal targets. Several Ideals are
**project / unsupported** relative to registry evidence (not verified
regulatory midpoints). Changing them changes the **meaning of the number**,
not just cosmetics. PD-010 decides KEEP / RESEARCH / REDEFINE per Ideal —
numeric Model Repair only after cited ids.

### Ideal candidates (registry-gated)

| Constant / topic | Code today (approx) | Evidence class (summary) | Known issue |
| --- | --- | --- | --- |
| **Q-V3 pH Ideal** | ~7.2 (curve treats as sweet spot) | Unsupported / project | Midpoint claim vs drinking-water bands; e.g. pH 7.5 often scores lower than “Ideal” framing suggests |
| **Q-V3 TDS Ideal** | ≤80 | Unsupported / project | Tight aesthetic Ideal; not a verified health limit |
| **Q-V3 ORP Ideal** | 400 ±25 | Operational / project | Shared ops band ≠ verified quality Ideal magnitude |
| **Q-V3 DO Ideal** | ≥8 | Unsupported / project | Aggressive vs many country floors; interacts with TH DO unscored |
| **Q-V3 Cl residual (>0.5 curve)** | interim curve above 0.5 | Project / interim | Chlorine “more is better until…” curve lacks strong Ideal citation |

*(Exact `id` strings must match `evidence-registry/constants.json` at Model Repair time.)*

### Evidence pack (decision inputs)

| Evidence | Class | What it supports | What it does NOT authorize |
| --- | --- | --- | --- |
| Registry rows for Q-V3 ideals / curves (`PD_REQUIRED` / RESEARCH) | SoT | Freeze until PD cites ids | Silent Ideal edits |
| Numeric forensic: no Ideal is SAFE TO REPAIR NOW without research | Audit | Prefer RESEARCH or KEEP+LABEL | Inventing new Ideal numbers |
| PD-007 D: mean/6 kept | Product contract | Aggregation default unchanged | Changing Ideal ≠ changing mean/6 automatically |
| Baseline pH 7.85 → Quality 76 under current Ideals | Regression | Replay after Ideal change | Target-tuning to keep 76 |
| Country Compliance bands (TH/JP/WHO/EU/EPA) | Separate channel | Do not copy country bands into Quality Ideals by default | Merging Compliance into Quality |

### Options (pack decision + per-Ideal matrix)

**Pack-level (choose one):**

| Option | Meaning | Numeric Ideals | Evidence need |
| --- | --- | --- | --- |
| **A — KEEP ALL + LABEL** | Ideals stay; UI/docs say “project Ideal index,” not regulatory midpoint | **NONE** | Product labeling |
| **B — RESEARCH BLOCK** | Freeze all listed Ideals; open citation tasks; no Model Repair | **NONE** | Research tickets |
| **C — REDEFINE pack (authorized ids)** | Replace only cited Ideal magnitudes after evidence | **YES** cited only | Citation or explicit PROJECT-DEFINED acceptance |
| **D — SPLIT INDEX** | Keep Compliance; Quality Ideals become “aspirational project curve” with separate label | **NONE** preferred | Brand/UX |
| **E — DEFER pack** | Wait for PD-009 publish-safety first | **NONE** | Explicit order |

**Per-Ideal matrix (fill when deciding C, or annotate under A/B):**

| Ideal | KEEP+LABEL | RESEARCH | REDEFINE (new value + citation) | REMOVE from Quality |
| --- | --- | --- | --- | --- |
| pH Ideal ~7.2 | ☐ | ☐ | ☐ ____ | ☐ |
| TDS Ideal ≤80 | ☐ | ☐ | ☐ ____ | ☐ |
| ORP Ideal 400±25 | ☐ | ☐ | ☐ ____ | ☐ |
| DO Ideal ≥8 | ☐ | ☐ | ☐ ____ | ☐ |
| Cl >0.5 curve | ☐ | ☐ | ☐ ____ | ☐ |

```text
Recommendation (facilitator — NOT approval · 2026-08-13):
  PD-010 = B

  Meaning if PO later approves B:
    RESEARCH BLOCK — do not retune Ideal/curve magnitudes without
    sufficient evidence. Keep current numbers as project-defined;
    strengthen provenance / labeling; open citation research tickets.
    No Ideal magnitude change in this pass.

  Why B (conservative):
    Avoids inventing Ideal values from air. Prefer A or B before C.
    Open C only with citations or explicit PROJECT-DEFINED acceptance.

  Status remains OPEN until Product Owner fills PO DECISION below.
```

### If DECIDED — what unlocks

| Choice | Allowed next | Still forbidden |
| --- | --- | --- |
| A | Docs/i18n Ideal labeling | Numeric Ideal changes |
| B | Research tickets; registry RESEARCH_BLOCKED | Model Repair without closed research / later PD |
| C | Model Repair **only** for listed Ideal ids + new values | Unlisted Ideals; baseline-targeted tuning |
| D | UX split labeling | Silent Compliance/Quality merge |
| E | PD-009 first | Treating deferral as Ideal KEEP forever |

### Explicitly Forbidden

- Inventing Ideal values without citation or explicit PROJECT-DEFINED acceptance
- Using PD-010 to change Country Compliance bands / EU gate 65 / TH Cl 0.2–2.0 magnitudes
- Artificial TH≠JP differentiation
- Case flow changes
- Marking DECIDED without Approved by + Date + pack option (+ per-Ideal if C)

### PO DECISION

- **Status:** DECIDED
- **Pack decision:** B — RESEARCH BLOCK
- **Decision meaning:** Do not retune Q-V3 Ideal/curve magnitudes. Keep current numbers as project-defined / interim. Open research tickets for insufficiently evidenced Ideals. Strengthen provenance labeling via research records. **No numeric Model Repair** under this decision.
- **Authorized Ideal research ids:** `QV3-PH-CENTER`, `QV3-TDS-NI`, `QV3-ORP-NI`, `QV3-DO-NI`, `QV3-CHLORINE-BAND-CURVE` (>0.5 side)
- **Research tickets:** `docs/quality-v3/research/PD-010-IDEAL-RESEARCH-TICKETS.md`
- **Research findings (complete):** `docs/quality-v3/research/PD-010-EVIDENCE-FINDINGS-R010.md` — SAFE TO REPAIR NOW = **NONE**
- **Next gate:** PD-011 Ideal disposition workshop (OPEN) — `docs/quality-v3/research/PD-011-IDEAL-DISPOSITION-MATRIX.md`
- **Per-Ideal decisions:** RESEARCH (freeze) for all five — see tickets R-010-1…5
- **Authorized constant ids for numeric change:** _(none)_
- **Excluded scope:** Any Ideal magnitude change; country bands; EU gate; Case Flow; inventing citations
- **Approved by:** Nattakamon Ph.
- **Date:** 2026-08-13
- **Notes:** Facilitator recommendation was B; PO approved B. Research pass completed 2026-08-13. All five Ideal magnitudes remain locked. Disposition requires **new** Product Decision (PD-011). Baseline unchanged.

---

## PD-011: Q-V3 Ideal disposition (post-research)

- **Status:** DECIDED
- **Opened:** 2026-08-13
- **Priority:** P1 — decide KEEP+LABEL / REDEFINE / REMOVE / SPLIT per Ideal after PD-010 evidence
- **Depends on:** PD-010 DECIDED B + `PD-010-EVIDENCE-FINDINGS-R010.md`
- **Workshop matrix:** `docs/quality-v3/research/PD-011-IDEAL-DISPOSITION-MATRIX.md`
- **Does not authorize:** inventing Ideal numbers; auto 7.2→7.5; auto TDS 200/300; ORP Ideal from 200–600; aquatic DO; new Cl curve from MRDL/GV
- **SAFE TO REPAIR NOW (numeric Ideal):** NONE

### Scope

Per-Ideal disposition for:

| Ticket | Constant id | Current | Decision |
| --- | --- | --- | --- |
| R-010-1 | `QV3-PH-CENTER` | 7.2 | **A** KEEP+LABEL |
| R-010-2 | `QV3-TDS-NI` | ≤80 | **A** KEEP+LABEL |
| R-010-3 | `QV3-ORP-NI` | 400±25 | **A** KEEP+LABEL |
| R-010-4 | `QV3-DO-NI` | ≥8 | **A** KEEP+LABEL |
| R-010-5 | `QV3-CHLORINE-BAND-CURVE` | high-side interim | **A** KEEP+LABEL |

### Explicitly Forbidden under this decision

- Any Ideal `code_value` / curve magnitude change
- Claiming Ideals are WHO/EPA/JP/national standards
- Restoring false pH midpoint-of-6.5–8.5 claim
- Case Flow / api / services changes
- Commit / push / deploy without separate auth

### PO DECISION

- **Status:** DECIDED
- **R-010-1:** A — KEEP + LABEL
- **R-010-2:** A — KEEP + LABEL
- **R-010-3:** A — KEEP + LABEL
- **R-010-4:** A — KEEP + LABEL
- **R-010-5:** A — KEEP + LABEL
- **Decision meaning:** All five Ideal magnitudes remain unchanged as **PROJECT-DEFINED** product rules. Semantic/provenance labeling only. Remove unsupported or conflicting regulatory Ideal claims (including false pH midpoint rationale). Does **not** certify that 7.2 / 80 / 400±25 / 8 / Cl high-side curve are national Ideals.
- **Authorized constant ids for numeric change:** _(none)_
- **Authorized implementation:** label/docs/comments/i18n/registry provenance only
- **Approved by:** Nattakamon Ph.
- **Date:** 2026-08-13
- **Notes:** Facilitator lean was all-A; PO approved all-A. Baseline must remain 76/100/100/95/65/99. Future Ideal magnitude changes require a **new** Product Decision.

## PD-012: Japan DO Compliance Index participation (`JP-DO-MIN`)

- **Status:** DECIDED
- **Decision:** B — REMOVE DO from Japan Compliance Index
- **Depends on:** PD-008 deferred JP-DO-MIN; evidence UNSUPPORTED as Japan national drinking-water criterion
- **Does not authorize:** replacement DO Ideal number; Q-V3 DO ≥8 change; weight redistribution

### PO DECISION

- **Status:** DECIDED
- **Decision:** B — REMOVE DO from Japan Compliance Index
- **Decision meaning:** DO is excluded from Japan Compliance Index scoring composition. Classification = `NOT_EVALUATED`. Missing DO must not force incomplete when ph/tds/turbidity/orp/chlorine are present. No replacement DO threshold. `do.min = 5` may remain as provenance residue only — not a scored national Ideal.
- **Implementation approach (I2):** Keep `JP-WEIGHTS.do = 0.12` unchanged (PD-013 A); exclude `do` from both `num` and `den` (effective den = 0.88). Do **not** redistribute 0.12.
- **Approved by:** Nattakamon Ph.
- **Date:** 2026-08-13
- **Notes:** Composition/policy correction for unsupported JP DO criterion. Baseline expectation JP=100 unchanged for current fixture.

## PD-013: Country composite design KEEP pack

- **Status:** DECIDED
- **Decision:** A ×5 — KEEP CURRENT as PROJECT-DEFINED for all listed ids
- **Ids:** `JP-WEIGHTS`, `EU-WEIGHTS`, `EPA-WEIGHTS`, `WHO-TIER-SCORES`, `EPA-TDS-INTERNAL-300`
- **Does not authorize:** equalizing weights; replacing 300 with SMCL 500; inventing WHO score percentages; redesigning JP weights after PD-012 B

### PO DECISION

- **Status:** DECIDED
- **JP-WEIGHTS:** A — KEEP CURRENT
- **EU-WEIGHTS:** A — KEEP CURRENT
- **EPA-WEIGHTS:** A — KEEP CURRENT
- **WHO-TIER-SCORES:** A — KEEP CURRENT
- **EPA-TDS-INTERNAL-300:** A — KEEP CURRENT
- **Decision meaning:** All five remain PROJECT-DEFINED product rules with **no numeric change**. PD-012 B must not rewrite JP weight magnitudes.
- **Approved by:** Nattakamon Ph.
- **Date:** 2026-08-13
- **Notes:** NO NUMERIC REPAIR under PD-013 A×5.

---

# PD WORKSHOP — COUNTRY SCORE MODEL SHAPE

## PD-014: Country Score model-shape (ORP / EPA Cl / WHO Cl below-min / PD-006 scope)

- **Status:** DECIDED (governance layer only — see Implementation Readiness below)
- **Owner:** Product Owner
- **Date opened:** 2026-08-13
- **Date decided:** 2026-08-14
- **Priority:** 1 (next; remaining Country P1 shape after forensic PASS)
- **Depends on:** Forensic HOLD at HEAD `41654b42`; TH severity `7a3f35a7`; PD-004 A; PD-006 A; PD-008 partial; PD-013 A×5
- **Blocks:** `src/js/score/**` Country shape edit — still blocked; see §10 Specification Attempt below
- **Type:** Decision-only. No implementation in this record.
- **Approved by:** Product Owner (chat instruction, 2026-08-14, HEAD `bac4044c`)
- **PO Decision:** D1 ORP = B · D2 EPA Cl = B · D3 WHO Cl&lt;0.2 = B · D4 PD-006 scope = B
- **PO Approval:** APPROVED
- **Explicit scope of B (per PO instruction, recorded verbatim):** "authorize specification work" only — does NOT authorize copying Q-V3, does NOT authorize copying TH, does NOT authorize inventing any score/breakpoint, does NOT authorize code without an approved specification. This PD reopens/supersedes PD-004 and PD-006 **only** within the scope of D1–D4 as written here; PD-004/PD-006 records themselves are preserved unmodified below (history not deleted).

```text
This record does not select A or B.
This record does not invent formulas, curves, tiers, thresholds, or ideals.
Existing implementation is evidence only, not authorization.
Audit finding ≠ Product Owner decision.
```

### Hard locks (not decision variables)

| Locked | Value / rule |
| --- | --- |
| ORP band numbers | 200 / 600 |
| EPA chlorine numbers | projectMin 0.2 / MRDL 4.0 |
| TH passMax / Cl band ceilings | unchanged (`7a3f35a7` inner curves only; ceilings already governed) |
| Weights | LOCKED (PD-013) |
| Aggregation | LOCKED (weighted mean) |
| Math.round | LOCKED |
| Q-V3 | LOCKED (including ORP 400±25 and Cl 0.2–0.5) |
| JP DO exclusion | LOCKED (PD-012 B) |
| EU gate 65 | LOCKED (PD-002) |
| WHO existing tier scores (100 / 80 / 50 / 25) | LOCKED unless PO explicitly chooses Decision 3 B **and** a follow-up spec is approved |
| Case Flow / API / Notion / UI routing / Hero channel split | UNTOUCHED |
| Production | HOLD — no push, no deploy |

### Three concepts (must not be collapsed)

| Concept | Meaning | Example |
| --- | --- | --- |
| **1. LIMIT** | Governed number that must not move in this workshop | EPA MRDL 4.0; ORP 200 and 600 |
| **2. COMPLIANCE PASS BAND** | In-band → Country 100 under Compliance Index | “inside 0.2–4.0 is a pass” |
| **3. QUALITY SEVERITY CURVE** | Worse-in-band values score lower while still inside the limit | Q-V3 Cl 0.3 ≠ 3.9 |

A locked LIMIT does not prove an equally-ideal QUALITY curve.  
Absence of a curve does not prove a curve must be invented.  
That distinction is what the four A/B decisions establish.

---

## 1. Current SoT

```text
HEAD:                 41654b42
Prior authorized fix: 7a3f35a7 (TH TDS / turbidity / chlorine inner severity)
Forensic:             PASS
Pipeline RAW→Hero:    PASS
TH severity fix:      PASS (DIFF Thailand Hero 87)
Remaining model shape: HOLD
Production:           HOLD (older production commit; do not deploy)
Q-V3 isolation:       PASS (publish channel stays quality-v3)
Country switch:       PASS (TH→JP→EU→WHO→EPA→TH = 87,78,61,81,79,87)
```

**Already authorized and in the live path (do not reopen here):**

- Thailand TDS: inner plateau ≤300, then decline to passMax 1000
- Thailand turbidity: inner plateau ≤1, then decline to passMax 5
- Thailand chlorine: inner 0.2–0.5, then decline to max 2.0
- RAW immutability; no null/false→0
- JP DO excluded (PD-012 B); den 0.88
- Country Hero ≠ Q-V3

**P1 remaining — this workshop only:**

| ID | What code does today | What prior PD actually locked | What this PD must decide |
| --- | --- | --- | --- |
| **1 ORP** | All five Country engines: 200–600 → grade 100 | PD-004 A: shared operational **band** 200–600; no model change **at that time** | Flat vs inner band **shape** (numbers 200/600 stay) |
| **2 EPA Cl** | 0.2–4.0 → grade 100, therefore 0.3 == 3.9 | PD-008: KEEP 0.2 and 4.0; split provenance; do not call the window Ideal | Flat vs residual inner **shape** (0.2 / 4.0 stay) |
| **3 WHO Cl &lt;0.2** | Below 0.2 shares grade 80 with 0.51–1.0; 0 == 1.0 | PD-013: KEEP WHO-TIER-SCORES | Keep in 80-tier vs distinct below-min **tier** (do not invent the new score here) |
| **4 PD-006 scope** | Country = Compliance Index; TH later received scoped inner severity | PD-006 A: Compliance Index; flat-in-band as meaning of 100 | TH exception stays scoped **or** severity may be general |

Q-V3 already distinguishes ORP 200 vs 400 vs 600 and Cl 0.3 vs 3.9. That is **Quality-channel** evidence. Copying Q-V3 magnitudes into Country Score is **forbidden** unless a later spec cites them after PO selects B.

---

## 2. Decision 1 — ORP

**Question:** Should Country Score treat every value in the governed 200–600 operational band as grade 100, or may an inner ORP band exist **inside** those same ceilings?

### A — 200–600 remains flat

1. **What changes semantically:** Nothing. Country 100 means “inside the shared operational/project ORP band.” 200, 400, and 600 remain equally 100.
2. **What does NOT change:** Band 200/600; weights; aggregation; rounding; Q-V3 400±25; all five Country `gradeOrp` formulas.
3. **Locked limits:** ORP min 200, max 600.
4. **Evidence available:** Shared inherited `gradeOrp`; PD-004 A (keep band; not five national standards); no verified country-specific drinking-water ORP 200–600.
5. **Evidence missing:** None required to **keep** A. (A is the current lock remaining in force.)
6. **Risk of A:** Country Hero cannot show in-band ORP severity; Q-V3 will continue to be the only channel that treats 200 ≠ 400 ≠ 600. Forensic P1 remains as accepted product meaning.
7. **Risk of B:** See B.
8. **Implementation allowed immediately:** **No.** A requires no code. Status quo HOLD.
9. **Follow-up model specification:** **No** if A.

### B — Introduce inner ORP band

1. **What changes semantically:** Country 100 would mean “inside an inner ORP band,” not merely “inside 200–600.” Values still inside 200–600 could score below 100.
2. **What does NOT change in this workshop:** The numbers 200 and 600. Q-V3. Weights. Aggregation. Rounding. No inner numbers are chosen here.
3. **Locked limits:** 200 / 600 remain the outer operational band.
4. **Evidence available:** Forensic proof that 200==400==600 on all five Country engines; Q-V3 uses a different (Quality) shape. PD-004 evidence that 200–600 is **not** a national DW standard.
5. **Evidence missing:** Authoritative inner-band definition per engine or an explicit **project-defined** inner spec. **Q-V3 400±25 is not authorization** to copy into Country Score.
6. **Risk of A:** See A.
7. **Risk of B:** Reopens PD-004’s “no model change”; risk of copying Quality ideals into Compliance Index; risk of five invented “national” ORP curves from one shared helper.
8. **Implementation allowed immediately:** **No.**
9. **Follow-up model specification:** **Yes — required** before any code. Spec must define inner band(s), which engines, and provenance (project vs cited). Must not invent values in the spec workshop without evidence/PO numbers.

**Recommendation:** PO decision required.

PD-004 A currently keeps the **limit** and forbade a model change in that PD. It did **not** independently prove that in-band equality is the intended quality meaning. This workshop is the reopen/confirm of **shape**, not a silent license to implement B.

---

## 3. Decision 2 — EPA Chlorine

**Question:** Should EPA Country Score treat the entire governed window 0.2–4.0 as grade 100, or may a residual inner band exist **inside** those same ceilings?

### A — 0.2–4.0 remains flat

1. **What changes semantically:** Nothing. Country 100 means “inside projectMin..MRDL.” 0.3 and 3.9 remain equally 100.
2. **What does NOT change:** 0.2; 4.0; provenance labels from PD-008; EPA Cl weight 0.15; Q-V3 Cl curve; the rule that 0.2–4.0 is **not** an EPA Ideal.
3. **Locked limits:** projectMin 0.2 (PROJECT-DEFINED); mrdlMax 4.0 (EPA MRDL 40 CFR 141.65).
4. **Evidence available:** PD-008 KEEP numbers + semantic repair; forensic 0.3 == 3.9; DIFF Cl 1.5 still EPA grade 100.
5. **Evidence missing:** None required to **keep** A.
6. **Risk of A:** Strongest remaining P1 vs Quality-channel intuition; EPA Hero will not punish high-but-legal residual. Accepted if Country remains Compliance Index for this param.
7. **Risk of B:** See B.
8. **Implementation allowed immediately:** **No.** A = no code.
9. **Follow-up model specification:** **No** if A.

### B — Introduce residual inner band

1. **What changes semantically:** Country 100 would mean “inside an EPA residual inner band,” not “anywhere from 0.2 to MRDL 4.0.” 0.3 could outscore 3.9 while both remain ≤4.0 and ≥0.2.
2. **What does NOT change in this workshop:** 0.2 floor; 4.0 MRDL; weights; aggregation; rounding; Q-V3. **No inner residual numbers are chosen here.**
3. **Locked limits:** 0.2 / 4.0.
4. **Evidence available:** PD-008 explicitly forbade calling 0.2–4.0 Ideal; Q-V3 already distinguishes 0.3 vs 3.9 **on the Quality channel**; TH already has a scoped Cl inner 0.2–0.5 (DoH surveillance residual — not adopted as TH legal Ideal).
5. **Evidence missing:** An EPA-Country inner residual definition that is **not** a silent copy of TH 0.2–0.5 or Q-V3 0.2–0.5 unless PO later cites that as project-defined. PD-008 option D (project residual) was **not** selected.
6. **Risk of A:** See A.
7. **Risk of B:** Converts Compliance-window 100 into a quality curve; may be read as claiming an EPA “ideal residual” that PD-008 rejected; TH 0.2–0.5 is not EPA evidence.
8. **Implementation allowed immediately:** **No.**
9. **Follow-up model specification:** **Yes — required** before any code.

**Recommendation:** PO decision required.

---

## 4. Decision 3 — WHO Chlorine &lt;0.2

**Question:** Should WHO Country chlorine values below 0.2 remain in the existing grade-80 fair tier (same bucket as 0.51–1.0), or should below-min be a distinct tier?

### A — Remains grade-80 tier

1. **What changes semantically:** Nothing. Coarse WHO-style buckets stay: 0.2–0.5 → 100; otherwise ≤1 → 80 (including 0 and 1.0); ≤2 → 50; else 25.
2. **What does NOT change:** Existing tier scores 100/80/50/25 (PD-013 KEEP WHO-TIER-SCORES); ideal 0.2–0.5; validator rejection of negative Cl (not in scope).
3. **Locked limits:** idealMin 0.2, idealMax 0.5, fair 1, poor 2 — **and the numeric tier scores themselves** unless B is later specified.
4. **Evidence available:** Executable WHO `gradeChlorine`; forensic Cl 0 == Cl 1.0 at 80; PD-013 A KEEP WHO-TIER-SCORES; negatives never reach the engine.
5. **Evidence missing:** None required to **keep** A.
6. **Risk of A:** Below-min disinfection residual is not distinguished from high-but-fair residual. Accepted if coarse tiers are the intended WHO-engine meaning.
7. **Risk of B:** See B.
8. **Implementation allowed immediately:** **No.** A = no code.
9. **Follow-up model specification:** **No** if A.

### B — Introduce separate below-min tier

1. **What changes semantically:** Cl &lt; 0.2 would no longer share meaning with Cl = 1.0. Below-min would be its own Country-score class.
2. **What does NOT change in this workshop:** Existing 100/80/50/25 values are **not** rewritten here. No new tier number is invented here. Validator unchanged.
3. **Locked limits:** 0.2 / 0.5 / 1 / 2 remain the declared breakpoints until a spec says otherwise. **The new tier score is not a decision variable in this workshop.**
4. **Evidence available:** Formula has no below-min branch; `fcl <= fair` catches 0 and 1.0; this is a hole relative to TH (which has below-min) but may be intentional WHO-tier coarseness.
5. **Evidence missing:** The below-min **score**, whether 0 is worse than 0.19, and whether this overrides PD-013 KEEP WHO-TIER-SCORES.
6. **Risk of A:** See A.
7. **Risk of B:** Reopens PD-013; silent new WHO tier is exactly the unauthorized invention this workshop forbids; risk of copying TH below-min `cl/min*70` without WHO evidence.
8. **Implementation allowed immediately:** **No.**
9. **Follow-up model specification:** **Yes — required**, and it must **explicitly override PD-013** for the cited WHO chlorine tier id.

**Recommendation:** PO decision required.

---

## 5. Decision 4 — PD-006 Semantics

**Question:** After the authorized Thailand TDS / turbidity / chlorine inner-severity exception, is Country Score still a Compliance Index whose default meaning of 100 is “inside the modeled pass band,” with that TH exception **scoped**, or may Country Score **generally** contain parameter-specific severity inside governed limits?

This is **not** original PD-006 option B (dual country-quality score). Dual output remains out of scope unless a separate PD reopens it.

### A — Compliance Index remains default; existing TH exception stays scoped

1. **What changes semantically:** Clarifies that `7a3f35a7` is a **named, already-authorized exception** (TH TDS / turb / Cl only). Default Country 100 remains “in the modeled compliance/pass band.” ORP / EPA Cl / WHO Cl stay flat/tiered unless Decisions 1–3 separately add **additional named exceptions**.
2. **What does NOT change:** PD-006 A channel identity (Country ≠ Quality V3); PD-001 pass-band language; PD-005 no magnitude ranking; Q-V3 as the quality channel; TH inner ceilings.
3. **Locked limits:** All currently governed Country ceilings.
4. **Evidence available:** PD-006 A text (“flat-in-band as the intended meaning of 100”); later TH inner curves authorized as saturation repair using **existing project inners**, not a general redesign; forensic HOLD on remaining plateaus.
5. **Evidence missing:** None required to **keep** A. PO must still not treat TH as silent permission for EPA/ORP/WHO.
6. **Risk of A:** Remaining P1 plateaus persist unless Decisions 1–3 independently select B as **additional scoped exceptions**. Product must live with EPA 0.3==3.9 if Decision 2 is also A.
7. **Risk of B:** See B.
8. **Implementation allowed immediately:** **No.** A is a governance clarification. No code by itself.
9. **Follow-up model specification:** **No** for A alone. Any later B on Decisions 1–3 still needs its own spec.

### B — Country Score may generally use parameter-specific severity

1. **What changes semantically:** In-band Country 100 is no longer the default meaning. Parameter-specific severity **inside** governed limits becomes an allowed Country-Score design, not a rare exception. This **refines/reopens** PD-006’s “flat-in-band = 100” sentence without creating a second country-quality number.
2. **What does NOT change in this workshop:** Q-V3; weights; aggregation; rounding; ceilings; no new curves invented here. Original PD-006 dual-score option remains **not** selected by this B.
3. **Locked limits:** Unchanged numbers; meaning of 100 changes.
4. **Evidence available:** TH exception already exists; forensic remaining flats; Quality vs Compliance channel split still desired.
5. **Evidence missing:** Which parameters/engines are in scope; whether B **requires** Decisions 1–3 B or only **permits** them; how PD-001 “pass-band language” is rewritten.
6. **Risk of A:** See A.
7. **Risk of B:** Scope creep (pH, DO min-gates, JP Cl, EU Cl) if “generally” is read as a mandate to curve everything; conflict with PD-001/PD-005 if Country starts looking like a quality ranking; still needs per-parameter specs — B is permission, not a formula.
8. **Implementation allowed immediately:** **No.**
9. **Follow-up model specification:** **Yes** before any new severity beyond the existing TH exception. B does not itself authorize ORP/EPA/WHO numbers.

**Recommendation:** PO decision required.

Do **not** infer B from the existence of the Thailand exception.

---

## 6. Cross-decision consequences

Notation: four letters = ORP, EPA Cl, WHO Cl&lt;0.2, PD-006 scope.

### Combinations that preserve Compliance Index semantics

| Combo | Meaning | New model spec? | Code after DECIDED? |
| --- | --- | --- | --- |
| **A A A A** | Full status quo. TH exception remains the only in-band Country severity. Remaining P1 accepted as Compliance Index. | No | **No** (HOLD continues; tests/docs only if desired) |
| **A A A + Decision 4 B** | Policy says severity *may* exist, but the three P1 params stay flat/tiered. Internally weak: permission without use. | Policy rewrite only | **No** engine change |
| **B or EPA B or WHO B + Decision 4 A** | Additional **named, scoped** exceptions (same class as TH), while default remains Compliance Index. Internally consistent **if** PO lists the exception(s) explicitly. | **Yes**, per selected B | Only after that spec is approved |
| **A A B + Decision 4 A** | WHO below-min as a scoped tier exception; ORP/EPA stay compliance-flat. | **Yes** (WHO tier spec; PD-013 override) | Only after spec |

### Combinations that expand Country Score toward severity semantics

| Combo | Meaning | New model spec? |
| --- | --- | --- |
| **Decision 4 B + any of Decisions 1–3 B** | General permission + at least one new in-band/below-min severity. Country 100 is no longer uniformly “in-band.” | **Yes** for each selected B |
| **B B B B** | Maximum expansion: ORP inner + EPA residual inner + WHO below-min + general severity policy. | **Yes**, three specs (do not share one invented curve). Reopens PD-004 / PD-008 / PD-013 / PD-006 flat-in-band sentence. |

### Combinations that are inconsistent or incomplete

| Combo | Problem |
| --- | --- |
| Any **B** on 1–3 **without** a follow-up spec | Forbidden. This workshop must not be treated as formula authorization. |
| Decision 4 **A** + implementing EPA/ORP/WHO severity **without** listing them as new scoped exceptions | Would silently convert TH-only exception into general redesign. |
| Copying Q-V3 400±25 or Cl 0.2–0.5 into Country engines because a B was selected | Forbidden even after B, until the **spec** cites those values as project-defined Country numbers. |
| Changing 200, 600, 0.2, 4.0, weights, mean, or rounding because B was selected | Forbidden. Those are not decision variables. |
| Decision 4 **B** read as original PD-006 dual country-quality score | Out of scope. Dual output needs its own PD. |

### Implementation sequencing (after PO fills the sheet)

```text
1. PO selects A/B for all four. Record DECIDED + Approved by + Date.
2. If all A: stop. No engine change. Shape HOLD becomes accepted product law.
3. If any B: open a Model Specification / evidence review for THAT item only.
4. Spec cites constant ids, inner numbers or tier score, engines in scope.
5. Separate implementation pass. Still no push/deploy without explicit auth.
```

---

## 7. Protected Contracts

Untouched regardless of A/B:

- Case aggregate root; Customer identity only
- `POST /api/cases`, `GET /api/public/water-check-offer`
- Dashboard / Framer / LINE envelopes
- Notion property names
- Offer / Workflow / Booking / Feedback / Reports ownership (Case)
- Exact customer match; no fuzzy; no name auto-merge
- Quality V3 engine, ideals, mean/6, publish `S.scoreVal` / `currentScoreResult`
- Live Hero routing (selected country vs published Quality)
- Country weights, aggregation, `Math.round`
- ORP 200/600, EPA Cl 0.2/4.0, TH passMax, EU gate 65, JP DO exclusion
- WHO tier **scores** unless Decision 3 B + later spec
- Production deployment

---

## 8. Implementation Gate

```text
NO CODE CHANGE
NO COMMIT
NO PUSH
NO DEPLOY

until PO has explicitly selected A/B for all four decisions
AND any required model specification has been approved.
```

Selecting **A** on an item = keep current engine behavior; still **no** opportunistic refactors.

Selecting **B** on an item = **authorization to specify**, not authorization to invent numbers in `src/js/score/**`.

`src/js/score/**` remains frozen while this PD is OPEN.

**Implementation Readiness:** `NOT READY`

---

## 9. PO Decision Sheet

Fill only in a later PO SIGN-OFF. Do not infer from code.

```text
ORP:          [ A / B / PENDING ]
EPA Cl:       [ A / B / PENDING ]
WHO Cl <0.2:  [ A / B / PENDING ]
PD-006:       [ A / B / PENDING ]
```

Current values:

```text
ORP:          B  (specification authorization only)
EPA Cl:       B  (specification authorization only)
WHO Cl <0.2:  B  (specification authorization only)
PD-006:       B  (general severity permitted, still per-parameter spec required)
```

### PO SIGN-OFF

- **Status:** DECIDED
- **Decision:** D1=B, D2=B, D3=B, D4=B
- **Approved by:** Product Owner (chat instruction)
- **Date:** 2026-08-14
- **Notes:** Workshop opened 2026-08-13 from forensic HOLD; decided 2026-08-14 at HEAD `bac4044c`. This decision authorizes specification work per item, explicitly NOT implementation, per the PO's own instruction ("B = specification authorization; B != implementation authorization"). See §10 for the specification attempt and where each item hit the no-invented-numbers wall.

---

## 10. Specification Attempt (post-decision, 2026-08-14)

Attempted immediately after PO sign-off, per §6 "Implementation sequencing" step 3
("If any B: open a Model Specification / evidence review for THAT item only").
Result: **every item that requires a numeric inner value stops at the same wall.**
This section records exactly where, per item, so this is not a repeat of a vague
"blocked" — it is the specific line each spec cannot cross without inventing a
number this repository has no evidence for.

### D1 — ORP inner band: BLOCKED at step "inner numbers"

- Outer limits (fixed, not reopened): 200 / 600.
- Required next field per §2.B item 9: "Spec must define inner band(s), which
  engines, and provenance (project vs cited)."
- Searched this pass (again) for any cited ORP drinking-water severity source
  in this repo: none exists beyond Q-V3's own `400±25`, which item 5 of §2.B
  explicitly disqualifies as authorization ("Q-V3 400±25 is not authorization
  to copy into Country Score").
- **Cannot proceed**: no inner band value, no per-engine provenance, without
  inventing one. Per §6 "Combinations that are inconsistent or incomplete":
  "Any B on 1–3 without a follow-up spec | Forbidden."

### D2 — EPA Chlorine inner band: BLOCKED at step "inner numbers"

- Outer limits (fixed): projectMin 0.2 / MRDL 4.0.
- §3.B item 5 already names the two candidates that would be needed and
  explicitly forbids both without new authorization: TH's 0.2–0.5 (surveillance
  residual, not EPA evidence) and Q-V3's own Cl curve.
- No EPA-specific residual source is cited anywhere in this repo (`PD-008`
  explicitly declined to select the "project residual" option that would have
  supplied one).
- **Cannot proceed**: same wall as D1 — no number to write into the spec that
  isn't a forbidden copy or an invention.

### D3 — WHO Chlorine &lt;0.2: BLOCKED at step "tier score"

- Existing tiers (100/80/50/25) stay locked per PD-013 unless this spec
  explicitly overrides the below-min one.
- §4.B item 5: "Evidence missing: The below-min score, whether 0 is worse than
  0.19." No WHO-cited source in this repo distinguishes those two values.
- **Cannot proceed**: the one number this spec exists to produce (the below-min
  tier score) has no evidentiary basis; copying TH's `cl/min*70` shape is
  explicitly named as a risk to avoid in §4.B item 7.

### D4 — PD-006 scope: SPECIFIABLE AS POLICY, but unlocks nothing by itself

- This item does not require an invented number — it is a policy statement
  ("parameter-specific severity is a permitted Country-Score design, not
  reserved to the TH exception").
- Recorded as: **general severity is now permitted in principle.**
- Per §6 "Combinations that expand Country Score toward severity semantics":
  D4=B only takes effect *combined with* a completed D1/D2/D3 spec. Since none
  of those three can be completed without an invented number (above), D4=B has
  no parameter left to apply to yet.

### Net result

```text
D1 spec: BLOCKED — no inner ORP number without invention or a forbidden copy
D2 spec: BLOCKED — no inner EPA residual number without invention or a forbidden copy
D3 spec: BLOCKED — no below-min WHO tier score without invention or a forbidden copy
D4 spec: RECORDED (policy only) — inert until D1/D2/D3 unblock

IMPLEMENTATION READINESS: NOT READY
src/js/score/**: FROZEN (unchanged this pass — confirmed empty git diff)
```

This is not a re-statement of "PD-014 pending" — PD-014 is now DECIDED. The
remaining block is that a specification, to be real, needs a number; no number
exists in this repository's evidence base for any of D1–D3, and the PO's own
instruction for this decision explicitly withheld authorization to invent one
("B != permission to invent numbers/breakpoint"). The next unblocking action
is not another PD sign-off — it is someone supplying an actual number with
provenance (a cited standard, or an explicit "this is a project-invented value,
approved as such") for at least one of D1/D2/D3.

---

## 11. Implementation Record (2026-08-14)

The PO supplied explicit numeric approval for the exact §10 candidates (verbatim,
no changes). Implemented:

```text
D1 (all 5 engines, gradeOrp):
  350-450        -> 100
  200 <= orp<350 -> 70 + (orp-200)/150*30
  450<orp<=600   -> 100 - (orp-450)/150*30
  orp<200        -> orp/200*70   [anchor corrected from *100 to *70 — see below]
  orp>600        -> 70-(orp-600)/10   [anchor corrected from 100 to 70 — see below]

D2 (usEpa only, gradeChlorine):
  0.2<=cl<=1.0   -> 100
  1.0<cl<=4.0    -> 100-(cl-1.0)/3.0*40
  cl<0.2         -> unchanged (cl/0.2*60, pre-existing, out of D2 scope)
  cl>4.0         -> 60-(cl-4.0)*30   [anchor corrected from 100 to 60 — see below]

D3 (who only, gradeChlorine):
  0<=cl<0.2      -> cl/0.2*80
  >=0.2          -> unchanged (existing 100/80/50/25 tiers, PD-013)
```

**One implementation-level correction made to the approved candidates:** the
outer-decline branches for D1 (below 200 / above 600) and D2 (above 4.0) were
originally specified anchored at 100 (their pre-D1/D2 starting value). Left
as literally specified, this produced a discontinuity — grade would jump
*upward* just past the outer limit (e.g. ORP 600 -> 70, but ORP 601 -> ~95
under the unmodified old formula), violating the spec's own monotonicity
requirement. Corrected by anchoring those same formulas (same slope, same
shape) at the new boundary value (70 for D1, 60 for D2) instead of 100. No
new number was invented — only the vertical anchor of an already-approved
linear formula was shifted to preserve continuity with the newly-approved
inner curve. Flagged here rather than applied silently.

**Discrepancy noted, not silently resolved:** the approved D3 worked example
listed `Cl=0.20 -> 80`, which conflicts with both the approved D3 formula
(`0<=cl<0.2`, i.e. strictly less than 0.2) and the explicit protected-contract
instruction ("existing WHO tiers >=0.2 unchanged"). Implemented per the
formula and the protection rule (0.2 stays 100, the pre-existing ideal-tier
value) — the worked-example row's `0.20` was treated as the off-by-one error,
not a separate instruction to lower the ideal tier.

**Result:** realistic-grid raw=100 share (84,035-combination sweep,
`.tmp_probe/plateau-forensic-sweep.js`):

```text
              before PD-014   after PD-014
Thailand      25.7%           7.7%
Japan         42.0%           18.0%
WHO           10.5%           3.9%
EU            11.2%           4.8%
US EPA        16.8%           6.4%
```

Tests: 1315 passed, 0 failed (incl. new `tests/score/pd014-severity-regression.test.js`,
147 assertions). Q-V3 verified unchanged (empty git diff on computeQualityScoreV2.js /
computeProductionScore.js). Not pushed or deployed as of this record.

---

## After sign-off rules

| Condition | Allowed | Forbidden |
| --- | --- | --- |
| No PO sign-off | Docs / workshop records only | Any `src/**` score/engine/threshold/weight/gate/ORP/DO change |
| PD-005 DECIDED A | Policy / UX / docs / anti-ranking tests | MODEL/SCORE still frozen |
| PD-001 DECIDED A | Verdict semantics (copy/metadata as scoped) | Scoring math change |
| PD-002/003/004 DECIDED A | Docs/semantic framing only | Gate/DO/ORP numeric changes (none required for A) |
| PD-002/003/004 DECIDED B or C | Separate implementation task only | Same-pass engine edits |
| PD-006 DECIDED A | Docs/UI/tests locking Compliance Index identity | Country quality dual-score; numeric country edits |
| PD-007 DECIDED D | Quality/publish presentation override when Compliance FAIL; semantic tests | mean/6 change; new weights/gates/ideals |
| PD-008 DECIDED partial | Label/provenance for cited Cl ids only | Band magnitude change; JP DO numeric |
| PD-009 OPEN | Workshop docs only | Catastrophe gates / WARNING override impl without DECIDED |
| PD-009 DECIDED B | Presentation/i18n WARNING override; semantic tests | Numeric gates; FAIL/WARNING math change; formula |
| PD-009 DECIDED A/D | Presentation/docs/UX as scoped | Invented numeric gates |
| PD-009 DECIDED C | Model Repair only for cited catastrophe ids | Invented undocumented thresholds |
| PD-010 OPEN | Workshop docs only | Ideal magnitude edits |
| PD-010 DECIDED B | Research tickets + findings; freeze Ideal numbers | Any Ideal `code_value` change without new PD (PD-011+) |
| PD-010 DECIDED A/D/E | Label/research/UX as scoped | Ideal numbers |
| PD-010 DECIDED C | Model Repair only for cited Ideal ids | Unlisted Ideal / baseline tuning |
| PD-011 OPEN | Workshop matrix / docs only | Ideal magnitude / curve / formula edits |
| PD-011 DECIDED A (all five) | Label/docs/comments/i18n/registry provenance; remove false Ideal claims | Ideal `code_value` / curve magnitude change |
| PD-011 DECIDED B | Docs marking non-authoritative | Ideal numbers |
| PD-011 DECIDED C/D/E with cited ids | Model Repair **only** for cited Ideal ids after follow-up auth | Invented replacements; Case Flow |
| PD-012 DECIDED B | Japan DO excluded from Compliance Index; tests/registry; I2 den exclude | New DO Ideal number; JP weight redistribution; Q-V3 DO |
| PD-013 DECIDED A×5 | Explicit KEEP of listed composite constants | Any magnitude change to those five ids |
| PD-014 OPEN | This workshop record only | Any `src/js/score/**` shape/curve/tier/ideal edit; inventing inner numbers; push/deploy |
| PD-014 DECIDED all A | Docs/tests locking accepted plateaus | Engine math change |
| PD-014 DECIDED any B | Follow-up model specification for cited item(s) only | Immediate formula invention; copying Q-V3; changing locked ceilings |
```text
EVIDENCE REGISTRY → PRODUCT DECISION → MODEL REPAIR → SCORE
Forbidden reverse: DESIRED SCORE → TUNE → JUSTIFY
```

If two countries score equal under correct semantics — **accept equal
scores.** Do not create artificial differentiation for UI cosmetics.

---

## Current decision state

```text
PD-005 = DECIDED — A (FORBID MAGNITUDE RANKING)
PD-001 = DECIDED — A (PASS-BAND / COMPARISON-PASS LANGUAGE)
PD-002 = DECIDED — A (KEEP EU GATE 65 AS PROJECT HARD GATE / UNSUPPORTED ANCHOR)
PD-003 = DECIDED — A (KEEP THAILAND DO EXCLUDED AS PROJECT DESIGN)
PD-004 = DECIDED — A (KEEP ORP 200–600 AS SHARED OPERATIONAL / PROJECT BAND)

PD-006 = DECIDED — A (COUNTRY SCORE = COMPLIANCE INDEX)
PD-007 = DECIDED — D (MEAN/6 KEPT + FAIL PUBLISH OVERRIDE)
PD-008 = DECIDED (partial) — TH/EPA/EU Cl semantic repair; JP DO later closed by PD-012 B

PD-009 = DECIDED — B (WARNING PRESENTATION OVERRIDE; NO NUMERIC GATE)
PD-010 = DECIDED — B (RESEARCH COMPLETE; IDEAL NUMBERS FROZEN; SAFE TO REPAIR = NONE)
PD-011 = DECIDED — A ×5 (KEEP+LABEL PROJECT-DEFINED; NO IDEAL NUMERIC CHANGE)
PD-012 = DECIDED — B (REMOVE DO FROM JAPAN COMPLIANCE INDEX)
PD-013 = DECIDED — A ×5 (KEEP WEIGHTS / WHO TIERS / EPA-300; NO NUMERIC CHANGE)
PD-014 = DECIDED + IMPLEMENTED (2026-08-14) — COUNTRY SCORE MODEL SHAPE (ORP / EPA Cl / WHO Cl<0.2 / PD-006 SCOPE)
         PO SHEET: ORP B · EPA Cl B · WHO Cl<0.2 B · PD-006 B  (decided 2026-08-14, HEAD bac4044c)
         PO NUMERIC APPROVAL: exact candidate numbers from §10 approved verbatim
         (2026-08-14) — see §11 for the implementation record.
         IMPLEMENTATION READINESS = DONE. src/js/score/{thailand,japan,who,eu,usEpa}/score.js
         gradeOrp() (all 5) and usEpa/who gradeChlorine() updated. Outer limits
         (200/600, 0.2/4.0, WHO tiers >=0.2) unchanged — verified via empty
         git diff on every limits.js/weights.js. 1315 tests passed, 0 failed.

PD-015 = DECIDED (2026-08-14) — THAILAND COUNTRY BENCHMARK ORDINARY-BAND CALIBRATION
         Spec: docs/quality-v3/PD-015-THAILAND-CALIBRATION-SPEC.md
         Scope: Thailand engine only. Outer compliance ceilings unchanged.
         Hero ceiling 99 KEEP. Q-V3 / JP / WHO / EU / EPA untouched.
         Implementation Readiness: READY (numeric spec approved in this record).

MODEL = Ideals/weights magnitudes frozen except PD-015 Thailand excellent-band edits
SCORE FORMULA = FROZEN (mean/6)
CASE FLOW = UNTOUCHED
```

---

## PD-015: Thailand Country Benchmark ordinary-band calibration

- **Status:** DECIDED
- **Owner:** Product Owner
- **Date opened:** 2026-08-14
- **Date decided:** 2026-08-14
- **Priority:** 1
- **Depends on:** Case isolation fix; PD-006 A; PD-008 partial; TH severity `7a3f35a7`; PD-014 D1 ORP; forensic proof that 97–99 is legitimate plateau compression
- **Blocks:** none after DECIDED — implementation authorized by this record + `PD-015-THAILAND-CALIBRATION-SPEC.md`
- **Type:** Product Decision + Model Specification (Thailand only)
- **Approved by:** Product Owner (chat instruction: PD-015 DECISION + IMPLEMENTATION TASK, 2026-08-14)
- **PO Decision:** Authorize PROJECT-DEFINED Thailand excellent-band narrowing and in-pass severity slopes per Model Spec
- **PO Approval:** APPROVED
- **Spec file:** `docs/quality-v3/PD-015-THAILAND-CALIBRATION-SPEC.md`

### Problem (locked forensic)

Ordinary acceptable water collapses into Thailand Hero **97–99** because pH / TDS / turbidity remain flat-100 across a wide ordinary region while only mild ORP/Cl ramps remain.

### Decision

1. Thailand Country Benchmark **may** use parameter-specific excellent / preferred bands **narrower** than compliance pass bands (same design class as `7a3f35a7` / PD-014), **Thailand only**.
2. Exact numbers are those in `PD-015-THAILAND-CALIBRATION-SPEC.md` (PROJECT-DEFINED).
3. Hero ceiling **99 KEEP**. Weights / aggregation / Math.round **KEEP**.
4. Japan / WHO / EU / US EPA / Q-V3 / Case / resolver / registry **UNTOUCHED**.

### Authorized numbers (copy of spec)

| Parameter | Change |
| --- | --- |
| pH | Preferred 6.8–7.8 → 100; pass edges → 85; outside pass ×35 unchanged |
| TDS | excellentMax 300→**80**; in-pass decline 25→**60**; soft zone continuous |
| Turbidity | excellentMax 1→**0.3**; in-pass decline 40→**50**; soft zone continuous |
| Chlorine | unchanged (0.2–0.5 excellent) |
| ORP | unchanged (350–450 excellent) |

### Implementation Readiness

```text
READY — numeric Model Spec approved
```

### PO SIGN-OFF

- **Status:** DECIDED
- **Decision:** Authorize PD-015 Thailand calibration per Model Spec
- **Approved by:** Product Owner
- **Date:** 2026-08-14

---

## STOP

```text
STOP — do not invent further Country thresholds beyond an approved Model Spec.
PD-015 numbers are the only Thailand excellent-band change authorized by this log entry.
PD-001…014 — DECIDED as recorded above (008 partial)
NO COPY Q-V3 ideals into Country engines beyond an approved Country Model Spec
NO ARTIFICIAL CROSS-COUNTRY DIFFERENTIATION
NO CASE FLOW CHANGES
```
