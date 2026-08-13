# PD-011 Preparation — Q-V3 Ideal Disposition Matrix (OPEN)

**Status:** DECIDED — A ×5 (KEEP+LABEL)  
**Approved by:** Nattakamon Ph. · **Date:** 2026-08-13  
**Numeric Ideal change:** NONE  
**Opened:** 2026-08-13  
**Depends on:** PD-010 DECIDED B + research complete (`PD-010-EVIDENCE-FINDINGS-R010.md`)  
**Does not authorize:** any Ideal magnitude / curve / formula change  
**Case Flow:** UNTOUCHED  
**Model Repair:** LOCKED until a future DECIDED PD cites constant `id`s

```text
SAFE TO REPAIR NOW = NONE
READY FOR PO PRODUCT DECISION
NOT READY FOR NUMERIC MODEL REPAIR

Facilitator recommendation ≠ PO approval
Evidence class ≠ authorization to change numbers
Nearby authoritative numbers ≠ automatic replacements
```

**Constant ids (registry):**

| Ticket | Constant id | Code path |
| --- | --- | --- |
| R-010-1 | `QV3-PH-CENTER` | `computeQualityScoreV2.js` `gradePh` |
| R-010-2 | `QV3-TDS-NI` | `gradeTds` |
| R-010-3 | `QV3-ORP-NI` | `gradeOrp` |
| R-010-4 | `QV3-DO-NI` | `gradeDo` |
| R-010-5 | `QV3-CHLORINE-BAND-CURVE` (high-side) | `gradeChlorine` |

---

## Option legend (same letters for every Ideal)

| Option | Meaning | Numeric model? |
| --- | --- | --- |
| **A — KEEP + LABEL** | Keep current number; disclose PROJECT-DEFINED / interim provenance in docs/UI | **NONE** (copy/label only) |
| **B — RESEARCH BLOCK / DEFER** | Keep behavior; forbid treating as authoritative Ideal; may continue research | **NONE** |
| **C — REDEFINE** | Change semantic definition and/or magnitude **only after PO specifies** the new definition; still needs citations or explicit PROJECT-DEFINED acceptance | **YES** if magnitude/shape changes |
| **D — REMOVE FROM QUALITY INDEX** | Stop grading this param in mean/6 (or exclude from Ideal curve) | **YES** (aggregation composition) |
| **E — SPLIT INDEX / SEMANTIC SEPARATION** | Keep number for ops/aspirational channel; Quality Index uses different framing or strip | **NONE** preferred; **YES** only if scoring path splits |

**Forbidden under any option without a separate DECIDED PD citing ids:** inventing Ideal values; auto-replacing 7.2→7.5, ≤80→200/300, ORP Ideal from 200–600, DO from aquatic life, Cl curve from MRDL/GV.

---

## Summary matrix

| ID | Current | Evidence | Problem | Option A | Option B | Option C | Option D/E | Numeric Impact | New PD Required |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **R-010-1** | pH Ideal center **7.2** | UNSUPPORTED; midpoint claim **CONFLICTING** (true mid of 6.5–8.5 = **7.5**) | Sold as Ideal/midpoint without citation | KEEP 7.2 + label project Ideal; fix false midpoint *wording* | Keep; do not cite as WHO Ideal | Redefine Ideal semantics (e.g. flat band 6.5–8.5) — **PO must specify**; do **not** auto-set 7.5 | D remove pH from Q index · E ops pH vs quality Ideal split | A/B: none · C/D/E may change scores | **YES** (this workshop / PD-011) |
| **R-010-2** | TDS NI **≤80** mg/L | UNSUPPORTED as Ideal; PARTIAL Japan taste **30–200** only | ≤80 not WHO excellent (&lt;300), not JP ceiling (200), not EPA SMCL (500) | KEEP ≤80 + label project NI | Keep; forbid WHO Ideal claim | Redefine NI semantics — **PO specifies**; do **not** auto 200/300 | D remove TDS Ideal / E aesthetic strip vs quality | A/B: none · C/D/E may change | **YES** |
| **R-010-3** | ORP Ideal **400±25** mV | UNSUPPORTED; WHO: no universal ORP | Ideal manufactured from ops band 200–600 (PD-004) | KEEP 400±25 + label project Ideal (≠ regulatory) | Keep; separate from ops band in copy | Redefine / remove Ideal magnitude — **PO specifies**; do **not** invent from 200–600 | D remove ORP from Q Ideal · E ops ORP strip only | A/B: none · C/D/E may change | **YES** |
| **R-010-4** | DO NI **≥8** mg/L | UNSUPPORTED (no potable Ideal; aquatic mismatch) | ≥8 looks like surface-water health, not drinking Ideal | KEEP ≥8 + label project | Keep; forbid aquatic-as-potable claim | Redefine DO role — **PO specifies**; no aquatic substitution | D exclude DO from Q Ideal · E ops/corrosion note only | A/B: none · C/D/E may change | **YES** |
| **R-010-5** | Flat **0.2–0.5**; ramp **≈46@1 / 28@2 / floor≈8** | Band PARTIAL (residual guidance); high-side **UNSUPPORTED** | Curve mixes disinfection residual, health max, and uncited quality grades | KEEP interim curve + label band vs high-side | Keep; forbid “evidence-backed curve” claim | Redefine high-side meaning — **PO specifies shape/anchors**; do **not** derive from MRDL 4 / GV 5 / taste alone | D flatten/cap / remove high-side grading · E split residual Compliance vs Quality taste | A/B: none · C/D/E may change | **YES** |

---

## Per-item detail

### R-010-1 — pH center 7.2 (`QV3-PH-CENTER`)

1. **Current value:** center = 7.2 (distance grading in `gradePh`)  
2. **Current semantic meaning:** Near-Ideal Quality V3 pH sweet spot  
3. **Evidence classification:** **UNSUPPORTED** / PROJECT-DEFINED; historical midpoint claim **CONFLICTING**  
4. **Evidence DOES support:** WHO/EPA **ranges** (≈6.5–8.5 aesthetic/ops; no health GV); disinfection preference pH &lt;8  
5. **Evidence DOES NOT support:** Ideal/center **exactly 7.2**; claim that 7.2 is midpoint of 6.5–8.5  
6. **Risk if kept unchanged:** Continues false midpoint narrative if docs/comments claim it; customers may think 7.2 is WHO Ideal  
7. **Risk if removed (D):** pH stops contributing graded Ideal signal; mean/6 composition changes; may under-weight a commonly measured param  
8. **Options:** A / B / C / D / E as above — **C must not silently become 7.5**  
9. **Numeric impact:** A/B none; C/D/E yes if approved with scope  
10. **New PD required:** **YES**

### R-010-2 — TDS ≤80 (`QV3-TDS-NI`)

1. **Current value:** Near-Ideal ceiling ≤80 mg/L  
2. **Current semantic meaning:** Excellent / NI mineral level for Quality index  
3. **Evidence classification:** **UNSUPPORTED** as Ideal ≤80; PARTIAL Japan taste **30–200** framing only  
4. **Evidence DOES support:** WHO palatability tiers (excellent &lt;300, etc.); Japan delicious-water residue **30–200**; EPA SMCL 500 aesthetic  
5. **Evidence DOES NOT support:** ≤80 as authoritative Near-Ideal  
6. **Risk if kept:** Over-penalizes normal potable TDS (e.g. 100–250) as “far from Ideal”  
7. **Risk if removed:** Loses mineral-taste differentiation in Quality index  
8. **Options:** A–E; **do not auto-replace with 200 or 300**  
9. **Numeric impact:** A/B none; C/D/E conditional  
10. **New PD required:** **YES**

### R-010-3 — ORP 400±25 (`QV3-ORP-NI`)

1. **Current value:** Ideal center 400 mV, NI half-width ±25  
2. **Current semantic meaning:** Quality Near-Ideal ORP  
3. **Evidence classification:** **UNSUPPORTED** / PROJECT-DEFINED  
4. **Evidence DOES support:** ORP as **operational** disinfection monitoring (WHO: case-by-case; no universal value); PD-004 ops band 200–600  
5. **Evidence DOES NOT support:** Ideal 400±25 as drinking-water quality Ideal  
6. **Risk if kept:** Implies regulatory Ideal where WHO forbids universal values  
7. **Risk if removed:** ORP Ideal signal disappears from Quality (ops strip via E may remain)  
8. **Options:** A–E; **do not manufacture Ideal from 200–600 midpoint** under C without explicit PO PROJECT-DEFINED acceptance of that method  
9. **Numeric impact:** A/B none; C/D/E conditional  
10. **New PD required:** **YES**

### R-010-4 — DO ≥8 (`QV3-DO-NI`)

1. **Current value:** Near-Ideal floor ≥8.0 mg/L  
2. **Current semantic meaning:** Quality Ideal dissolved oxygen  
3. **Evidence classification:** **UNSUPPORTED**  
4. **Evidence DOES support:** WHO: no health GV; depletion can cause secondary water-quality issues; very high DO may worsen corrosion  
5. **Evidence DOES NOT support:** potable Ideal ≥8; aquatic-life thresholds as drinking Ideal  
6. **Risk if kept:** Inflates “quality” for high DO without potable Ideal basis; confuses with JP DO compliance (separate)  
7. **Risk if removed:** DO grade drops out of mean/6 Ideal path  
8. **Options:** A–E; **no aquatic substitution**  
9. **Numeric impact:** A/B none; C/D/E conditional  
10. **New PD required:** **YES**

### R-010-5 — Chlorine &gt;0.5 curve (`QV3-CHLORINE-BAND-CURVE`)

1. **Current value:** Flat 100 for 0.2–0.5; continuous ramp ≈46@1.0 / 28@2.0 / floor ≈8  
2. **Current semantic meaning:** Quality Ideal residual band + high-side quality degradation  
3. **Evidence classification:** Band **PARTIALLY VERIFIED** (disinfection/delivery residual guidance); high-side **UNSUPPORTED**  
4. **Evidence DOES support:** WHO 0.2 at delivery; ≥0.5 after contact for disinfection; residual often targeted 0.2–0.5 in distribution guidance; health ceilings WHO 5 / EPA MRDL 4  
5. **Evidence DOES NOT support:** quality grades 46/28/8; using MRDL/GV as Ideal curve anchors; equating residual guidance with “quality Ideal = 100” without product definition  
6. **Risk if kept:** High Cl (still safe under MRDL) looks “poor quality” via uncited curve; semantics blur safety vs taste vs Ideal  
7. **Risk if removed / flattened:** May under-signal high residual taste issues; or over-accept high Cl as Ideal if band extended wrongly  
8. **Options:** A–E; **do not derive a new curve** from residual/max/taste sources in this workshop  
9. **Numeric impact:** A/B none; C/D/E conditional  
10. **New PD required:** **YES**

---

## Formal PO Decision Interface (PD-011)

**Status remains OPEN until all fields below are filled with real values.**

Selection alone ≠ DECIDED.  
DECIDED ≠ automatic numeric Model Repair.  
Options **A** / **B** → presentation/provenance only (no Ideal magnitude change).  
Options **C** / **D** / **E** → may need a **follow-up** implementation authorization if numeric/model path changes; do not invent Ideal numbers here.

### Options (every Ideal)

| Letter | Name |
| --- | --- |
| **A** | KEEP + LABEL (PROJECT-DEFINED; disclose provenance) |
| **B** | DEFER / RESEARCH BLOCK (keep behavior; not authoritative) |
| **C** | REDEFINE (PO must specify meaning; no auto-replacement numbers) |
| **D** | REMOVE from current Quality Ideal concept |
| **E** | SPLIT INDEX (separate ops/compliance/quality semantics) |

### Hard constraints (do not override in this reply)

- No auto 7.2 → 7.5  
- No auto TDS ≤80 → 200 or 300  
- No ORP Ideal derived from 200–600  
- No aquatic-life DO as potable Ideal  
- No new Cl curve from MRDL / GV / taste / residual alone  

### Exact PO reply format

```text
R-010-1 = A/B/C/D/E
R-010-2 = A/B/C/D/E
R-010-3 = A/B/C/D/E
R-010-4 = A/B/C/D/E
R-010-5 = A/B/C/D/E
Approved by = <real PO name>
Date = <YYYY-MM-DD>
```

If any letter is missing, placeholder, or Approved by / Date incomplete → **DO NOT DECIDE**.

### PO Decision Questions (unanswered)

1. **R-010-1 / pH 7.2:** Should 7.2 remain a project-defined Quality V3 Ideal, or should the Ideal concept be redefined, deferred, removed, or split?  
2. **R-010-2 / TDS ≤80:** Should ≤80 remain a project-defined Near-Ideal, or should the concept be redefined, deferred, removed, or split?  
3. **R-010-3 / ORP 400±25:** Should 400±25 remain a project-defined Quality Ideal, or should ORP become operational-only, be redefined, removed, or split?  
4. **R-010-4 / DO ≥8:** Should ≥8 remain a project-defined drinking-water Quality Ideal, or should DO be redefined, deferred, removed, or split?  
5. **R-010-5 / Cl >0.5 curve:** Should the current interim curve remain project-defined, or should the chlorine quality concept be redefined, deferred, removed, or split?

### Required PO approval format (legacy pack line — optional extra)

```text
Authorized constant ids for numeric change = none
```

Default for A/B packages: `none`.  
If C/D/E implies numeric change: list ids only after a **separate** repair authorization — not by inventing values in this workshop.

---

## Final verification (this prep pass)

| Check | Status |
| --- | --- |
| Numeric model | unchanged |
| Baseline | 76 / 100 / 100 / 95 / 65 / 99 |
| Case Flow | untouched |
| New numeric values | none |
| Model Repair | none |
| PD-011 status | **OPEN** (not DECIDED) |
| Commit / push / deploy | none |

```text
READY FOR PO PRODUCT DECISION
NOT READY FOR NUMERIC MODEL REPAIR
PD-011 = OPEN
```
