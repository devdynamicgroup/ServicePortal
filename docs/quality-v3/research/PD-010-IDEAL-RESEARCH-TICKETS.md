# PD-010 Research Tickets — Q-V3 Ideal Pack (RESEARCH BLOCK)

**Status:** OPEN RESEARCH (values frozen)  
**Product Decision:** PD-010 = **DECIDED B** (2026-08-13)  
**Approved by:** Nattakamon Ph.  
**Numeric change authorized:** **NO** — until a later Product Decision cites constant `id`s after evidence closes

```text
NO CITATION / INSUFFICIENT EVIDENCE  until an authoritative source
with semantic match is recorded in evidence-registry/constants.json.
```

**Hard lock:** Do not modify `code_value` in `computeQualityScoreV2.js` or
registry numeric fields under these tickets alone.

**Case Flow:** UNTOUCHED

---

## Ticket R-010-1 — QV3-PH-CENTER

| Field | Value |
| --- | --- |
| Constant id | `QV3-PH-CENTER` |
| Current value | `center=7.2` |
| Code location | `src/js/score/production/computeQualityScoreV2.js` (`gradePh`, `Math.abs(ph - 7.2)`) |
| Evidence class | PROJECT-DEFINED |
| Citation status | **NO CITATION** / INSUFFICIENT EVIDENCE |
| Existing claim | Comment: midpoint of common 6.5–8.5 acceptability band |
| Semantic gap | True arithmetic midpoint of 6.5–8.5 is **7.5**, not 7.2; no cited Ideal drinking-water center at 7.2 |
| Research question | Is there an authoritative drinking-water Ideal / guideline that specifies a graded quality **center** at 7.2 (or another exact Ideal), with matching unit/context? |
| Required source type | National standard, WHO GDWQ (or equivalent), or explicit project-defined acceptance (not blogs) |
| Required clause/section | Named clause/section stating Ideal or graded center (not merely 6.5–8.5 acceptability band) |
| Unit / context | pH · drinking-water quality Ideal (not process-control alone) |
| Could evidence authorize numeric change? | Only after **new Product Decision** citing `QV3-PH-CENTER` |
| New PD required before numeric edit? | **YES** |

---

## Ticket R-010-2 — QV3-TDS-NI

| Field | Value |
| --- | --- |
| Constant id | `QV3-TDS-NI` |
| Current value | Near-Ideal ≤80 mg/L |
| Code location | `src/js/score/production/computeQualityScoreV2.js` (`gradeTds`, `tds <= 80`) |
| Evidence class | PROJECT-DEFINED (PARTIAL framing only) |
| Citation status | **PARTIAL** framing / **INSUFFICIENT** for cutoff 80 |
| Existing claim | Framed under Japan complementary residue preference 30–200 |
| Semantic gap | ≤80 is stricter than and not identical to the cited complementary range; not a verified health Ideal |
| Research question | What authoritative source (if any) justifies a Near-Ideal TDS ceiling of **80 mg/L** for a quality index, with semantic match? |
| Required source type | National / WHO / EPA aesthetic guideline with Ideal or preference ceiling — or PROJECT-DEFINED acceptance |
| Required clause/section | Clause stating the preference/Ideal ceiling used as NI |
| Unit / context | mg/L · drinking water · Ideal vs aesthetic vs health |
| Could evidence authorize numeric change? | Only after **new Product Decision** citing `QV3-TDS-NI` |
| New PD required before numeric edit? | **YES** |

---

## Ticket R-010-3 — QV3-ORP-NI

| Field | Value |
| --- | --- |
| Constant id | `QV3-ORP-NI` |
| Current value | center=400, NI \|Δ\|≤25 mV |
| Code location | `src/js/score/production/computeQualityScoreV2.js` (`gradeOrp`, `Math.abs(orp - 400)`) |
| Evidence class | UNSUPPORTED |
| Citation status | **NO CITATION** / INSUFFICIENT EVIDENCE |
| Existing claim | Midpoint of operational band 200–600 (PD-004 shared ops band) |
| Semantic gap | Operational band midpoint ≠ verified quality Ideal magnitude |
| Research question | Does any authoritative drinking-water or disinfection standard define an ORP **Ideal** near 400±25 for graded quality scoring? |
| Required source type | Standard / guideline with ORP Ideal (not commercial pool blogs) |
| Required clause/section | Clause with Ideal or target ORP and context |
| Unit / context | mV · drinking water vs pool/process |
| Could evidence authorize numeric change? | Only after **new Product Decision** citing `QV3-ORP-NI` |
| New PD required before numeric edit? | **YES** |

---

## Ticket R-010-4 — QV3-DO-NI

| Field | Value |
| --- | --- |
| Constant id | `QV3-DO-NI` |
| Current value | Near-Ideal ≥8.0 mg/L |
| Code location | `src/js/score/production/computeQualityScoreV2.js` (`gradeDo`, NI floor ≥8.0) |
| Evidence class | UNSUPPORTED |
| Citation status | **NO CITATION** / INSUFFICIENT EVIDENCE |
| Existing claim | Project model assumption (code comments) |
| Semantic gap | No locked drinking-water Ideal ≥8 found in registry hunt; aggressive vs many country floors |
| Research question | What authoritative drinking-water Ideal (if any) supports DO Near-Ideal ≥8.0 mg/L for a quality index? |
| Required source type | National / WHO-equivalent drinking-water DO Ideal — or PROJECT-DEFINED acceptance |
| Required clause/section | Clause stating Ideal / preference floor |
| Unit / context | mg/L · drinking water (not aquaculture alone unless product accepts that context) |
| Could evidence authorize numeric change? | Only after **new Product Decision** citing `QV3-DO-NI` |
| New PD required before numeric edit? | **YES** |

---

## Ticket R-010-5 — QV3-CHLORINE-BAND-CURVE (>0.5 side)

| Field | Value |
| --- | --- |
| Constant id | `QV3-CHLORINE-BAND-CURVE` |
| Current value | Flat 0.2–0.5; continuous ramp **>0.5** (e.g. interim 46@1.0 / 28@2.0 / floor 8) |
| Code location | `src/js/score/production/computeQualityScoreV2.js` (`gradeChlorine`) |
| Evidence class | PARTIALLY VERIFIED (band) / project interim (high side) |
| Citation status | Band PARTIAL (WHO residual 0.2–0.5); **>0.5 curve = NO CITATION / INSUFFICIENT** |
| Existing claim | WHO residual guidance for band; high-side curve marked interim in code/comments |
| Semantic gap | >0.5 descending curve is project interim — not evidence-backed Ideal shape |
| Research question | What authoritative source (if any) justifies the **shape/magnitude** of Quality grades for free chlorine **above 0.5 mg/L**? |
| Required source type | WHO / national residual + taste/odor or safety grading guidance — or PROJECT-DEFINED acceptance of interim curve |
| Required clause/section | Clause matching free chlorine residual above Ideal band |
| Unit / context | mg/L · free residual · drinking water delivery |
| Could evidence authorize numeric change? | Only after **new Product Decision** citing `QV3-CHLORINE-BAND-CURVE` (high-side) |
| New PD required before numeric edit? | **YES** |

---

## Out of scope for PD-010 B

- Turbidity NI ≤0.1 (`QV3-TURBIDITY-NI`) — not in this PO research pack (LOCKED_KEEP / PARTIAL)
- Country Compliance bands, EU gate 65, TH/EPA/EU Cl magnitudes, JP DO
- Any silent Ideal retune from baseline aesthetics

## Close criteria (per ticket)

1. Authoritative SOURCE + DOCUMENT + CLAUSE  
2. SEMANTIC MATCH + UNIT + CONTEXT  
3. CONFIDENCE recorded in `constants.json`  
4. **New Product Decision** citing `id` before any `code_value` change  

Until then: **NO CITATION / INSUFFICIENT EVIDENCE** · values frozen · Model Repair LOCKED.

---

## Research pass status (2026-08-13)

**Findings document:** [`PD-010-EVIDENCE-FINDINGS-R010.md`](PD-010-EVIDENCE-FINDINGS-R010.md)

| Ticket | Class after research | Numeric change |
| --- | --- | --- |
| R-010-1 pH 7.2 | **UNSUPPORTED** (PROJECT-DEFINED); midpoint claim **CONFLICTING** (true mid 7.5) | **NONE** — needs new PD |
| R-010-2 TDS ≤80 | **UNSUPPORTED** as Ideal; PARTIAL Japan 30–200 taste framing only | **NONE** — needs new PD |
| R-010-3 ORP 400±25 | **UNSUPPORTED** / PROJECT-DEFINED (WHO: no universal ORP) | **NONE** — needs new PD |
| R-010-4 DO ≥8 | **UNSUPPORTED** (no potable Ideal; aquatic context mismatch) | **NONE** — needs new PD |
| R-010-5 Cl &gt;0.5 curve | Band 0.2–0.5 **PARTIALLY VERIFIED**; high-side curve **UNSUPPORTED** | **NONE** — needs new PD |

```text
SAFE TO REPAIR NOW: (none)
READY FOR PO PRODUCT DECISION: PD-011
NOT READY FOR NUMERIC MODEL REPAIR
Disposition matrix: PD-011-IDEAL-DISPOSITION-MATRIX.md
```
