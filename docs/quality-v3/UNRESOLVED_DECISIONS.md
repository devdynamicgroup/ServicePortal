# Quality V3 — Product Decision Log

```text
Layer:
EVIDENCE → SEMANTICS → PRODUCT DECISION → MODEL → SCORE

Current layer: PRODUCT DECISION

Model status: FROZEN
Score status: FROZEN
```

**Nothing below is selected or implemented unless Status = `DECIDED` with an
explicit Product Owner sign-off in that record.**

```text
Architect recommendation ≠ Product Owner approval
Product recommendation ≠ Product Owner approval
Audit finding ≠ Product Owner decision
```

Related semantic contract (documentation of clarified semantics — **not** PO
approval): `COUNTRY_BENCHMARK_SEMANTIC_CONTRACT.md`

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
Semantics:       Clarified (Country Benchmark = country-specific
                 compliance / benchmark signal — NOT universal quality,
                 NOT official regulatory score, NOT cross-country ranking)
Model:           FROZEN
Score:           FROZEN
Evidence tracks: DECIDED A — all five PDs approved (PD-001–PD-005)
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

1. **PD-005** — Cross-country ranking policy — **DECIDED A**
2. **PD-001** — Verdict semantics for comparison score — **DECIDED A**
3. **PD-002 / PD-003 / PD-004** — **DECIDED A** (Product Owner, 2026-08-11)

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

```text
PD approval does not automatically authorize model changes.
```

---

## Prior open items (Quality V3 — preserved)

The following predate the Country Benchmark PD series. They remain open and
are **not** superseded by PD-001–PD-005.

### 1. Quality index vs. safety signal

Current behavior (unweighted arithmetic mean of 6 equally-weighted
parameters): one catastrophic parameter + five ideal parameters ≈ 84–87.
This is mathematically expected under averaging — whether it is acceptable
product behavior depends on whether Quality V3 is a closeness-to-ideal index
or a safety signal.

Candidates (none selected): A equal-weight (current) · B weighted · C hard
safety gate · D Quality+Compliance hybrid · E nonlinear aggregation.

**Candidate Product Definition — Status: CANDIDATE, NOT APPROVED**

```text
Quality Score = Normal Drinking Water Quality
(separated from Compliance, Outbreak Context, Health/Safety Ceiling)
```

Chlorine >0.5 mg/L case study and aggregation empirics remain as previously
documented; no selection made here.

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

## After sign-off rules

| Condition | Allowed | Forbidden |
| --- | --- | --- |
| No PO sign-off | Docs / workshop records only | Any `src/**` score/engine/threshold/weight/gate/ORP/DO change |
| PD-005 DECIDED A | Policy / UX / docs / anti-ranking tests | MODEL/SCORE still frozen |
| PD-001 DECIDED A | Verdict semantics (copy/metadata as scoped) | Scoring math change |
| PD-002/003/004 DECIDED A | Docs/semantic framing only | Gate/DO/ORP numeric changes (none required for A) |
| PD-002/003/004 DECIDED A | Docs/semantic framing only | Model/score change (none required for A) |
| PD-002/003/004 DECIDED B or C | Separate implementation task only | Same-pass engine edits |
| PD-006 DECIDED A | Docs/UI/tests locking Compliance Index identity | Country quality dual-score; numeric country edits |

```text
EVIDENCE → SEMANTICS → PRODUCT DECISION → MODEL → SCORE
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

MODEL = FROZEN
SCORE = FROZEN
BASELINE = UNCHANGED (76 / 100 / 100 / 95 / 65 / 99)
```

```text
PD-001–PD-005 DECIDED A; PD-006 DECIDED A (COMPLIANCE INDEX)
MODEL FROZEN
SCORE FROZEN
```

---

## STOP

```text
PD-001 / PD-002 / PD-003 / PD-004 / PD-005 / PD-006 — DECIDED (006 = A COMPLIANCE INDEX)
MODEL FROZEN
SCORE FROZEN
NO NUMERIC TUNING
NO ARTIFICIAL COUNTRY DIFFERENTIATION
NO REGULATORY CLAIM INVENTION
NO MODEL CHANGE
NO SCORE CHANGE
```
