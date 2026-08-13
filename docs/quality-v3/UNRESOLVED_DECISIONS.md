# Quality V3 — Product Decision Log

```text
Layer:
EVIDENCE REGISTRY (SoT) → PRODUCT DECISION → MODEL REPAIR (gated) → SCORE

Current layer: PRODUCT DECISION (PD-012 DECIDED B — JP DO removed; PD-013 DECIDED A×5)

Model status: FROZEN Ideals/weight magnitudes; PD-012 B Japan DO composition authorized
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
Semantics:       PD-006 A · PD-007 D · PD-008 partial · PD-009 B · PD-010 B · PD-011 A · PD-012 B · PD-013 A×5
Model:           FROZEN Ideals/weights magnitudes; PD-012 B Japan DO composition only
Score formula:   FROZEN (mean/6)
Evidence SoT:    evidence-registry/constants.json
Closed PDs:      PD-001–PD-013 (008 partial)
Open PDs:        (none required for JP DO / composite KEEP pack)
```

**Synthetic baseline (construction output only — NOT a calibration target):**

```text
readings: { ph:7.85, tds:175, turbidity:0.42, orp:515, do:5.30, chlorine:0.70, temp:25 }
HEAD: Quality V3=76 · TH=100 · JP=100 · WHO=95 · EU=65 · EPA=99
```

| Valid for | Not valid for |
| --- | --- |
| Regression replay | Calibration target |
| Behavior verification | Desired output / ranking target |
| Semantic audit | Justification for thresholds / weights / EU 65 |
| Detecting unintended score changes | Tuning for visual spread |

**Decision queue (priority):**

1. PD-012 B / PD-013 A×5 — JP-DO REMOVE · weights/WHO tiers/EPA-300 KEEP — **DECIDED** (closed)
2. PD-011 — Ideal KEEP+LABEL (all five A) — **DECIDED**
3. Ideal research (PD-010 B) — **COMPLETE**
4. PD-009 — WARNING presentation — **DECIDED B**
5. PD-008 — Cl provenance partial (JP DO later closed by PD-012 B) — **DECIDED partial**
6. PD-006 / PD-007 — Compliance Index + mean/6+FAIL — **DECIDED**
7. PD-001–PD-005 — **DECIDED A**

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

MODEL = FROZEN Ideals/weights magnitudes; PD-012 B JP DO composition authorized
SCORE FORMULA = FROZEN (mean/6)
BASELINE = UNCHANGED (76 / 100 / 100 / 95 / 65 / 99)
REGISTRY = SoT (PD-012 B + PD-013 A×5 recorded)
CASE FLOW = UNTOUCHED
```

---

## STOP

```text
PD-001…013 — DECIDED (008 partial)
PD-012 B — JP DO NOT_EVALUATED (no replacement Ideal)
PD-013 A×5 — NO NUMERIC REPAIR to listed composite ids
PD-011 A — Ideal KEEP+LABEL only (not national Ideal certification)
NO AUTO-REPLACE (7.2→7.5, ≤80→200/300, ORP from 200–600, aquatic DO, Cl curve from MRDL)
NO ARTIFICIAL COUNTRY DIFFERENTIATION
NO CASE FLOW CHANGES
NO COMMIT / PUSH / DEPLOY WITHOUT SEPARATE AUTH
```
