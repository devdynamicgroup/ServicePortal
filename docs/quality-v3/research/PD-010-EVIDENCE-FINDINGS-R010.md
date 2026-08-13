# PD-010 Evidence Research Findings — R-010-1…5

**Pass type:** READ / RESEARCH ONLY  
**Date:** 2026-08-13  
**Product Decision:** PD-010 = DECIDED B (RESEARCH BLOCK) — **no numeric change authorized**  
**Runtime scoring:** UNTOUCHED  
**Case Flow:** UNTOUCHED  
**New Product Decision created this pass:** NO  
**Numeric repair this pass:** NO

```text
NO CITATION / INSUFFICIENT EVIDENCE  where semantic match fails.
Nearby numbers ≠ Ideal evidence.
```

---

## Summary table

| Ticket | Current Value | Best Evidence | Exact Clause | Semantic Match | Class | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| **R-010-1** | pH center **7.2** | WHO pH background (2007); EPA NSDWR pH 6.5–8.5 | WHO: no health GV; most DW in 6.5–8.5; optimum often 6.5–9.5; Cl disinfection preferably pH &lt;8.0. EPA secondary aesthetic 6.5–8.5 | **No.** No Ideal/center at 7.2. Midpoint of 6.5–8.5 = **7.5** (not 7.2) | **UNSUPPORTED** (PROJECT-DEFINED) | KEEP numbers; label project Ideal; new PD before any change |
| **R-010-2** | TDS NI **≤80** mg/L | WHO TDS background + GDWQ Ch.10; Japan “おいしい水” evaporative residue **30–200** mg/L (1985 taste committee); EPA SMCL TDS **500** | WHO: excellent palatability **&lt;300**; good 300–600; no health GV. Japan taste preference **30–200** (not ≤80). EPA aesthetic SMCL 500 | **No** for ≤80 as Ideal. 80 is arbitrary inside Japan 30–200; WHO “excellent” is &lt;300 not ≤80 | **UNSUPPORTED** for ≤80 Ideal; **PARTIAL** framing only via Japan 30–200 taste band | KEEP ≤80; do not claim WHO Ideal; new PD before change |
| **R-010-3** | ORP **400±25** mV | WHO GDWQ operational monitoring (addendum / §4.2.2 style text) | ORP usable for ops disinfection monitoring; **minimum ORP case-by-case; universal values cannot be recommended** | **No.** Explicitly rejects universal Ideal. 400±25 = midpoint of project ops band 200–600 (PD-004), not regulatory Ideal | **UNSUPPORTED** / **PROJECT-DEFINED** | KEEP; RESEARCH remains open for ops labeling only; new PD before Ideal change |
| **R-010-4** | DO NI **≥8.0** mg/L | WHO GDWQ Ch.10 Acceptability — Dissolved oxygen | **No health-based guideline** recommended; depletion can cause nitrite/sulfide/iron issues; **very high DO may exacerbate corrosion** | **No.** Not a potable Ideal ≥8. ≥8 typical of **aquatic-life / surface-water** health, not drinking-water Ideal | **UNSUPPORTED** | KEEP; do not cite as WHO Ideal; new PD before change |
| **R-010-5** | Cl flat **0.2–0.5**; ramp **≈46@1.0 / 28@2.0 / floor≈8** | WHO GDWQ free chlorine remarks; WHO SEARO chlorination guidance; EPA MRDL **4.0** mg/L (40 CFR 141.65) | WHO: ≥0.5 after ≥30 min contact (pH&lt;8) for disinfection; **0.2 at point of delivery**; health-based GV **5** mg/L (C). SEARO: target residual often **0.2–0.5** through distribution. EPA MRDL 4.0 = health max, not quality curve | Band **0.2–0.5**: **PARTIAL** (disinfection residual / delivery mins — not “quality Ideal score=100”). High-side anchors **46/28/8**: **NO** authoritative graded curve | Band **PARTIALLY VERIFIED**; high-side curve **UNSUPPORTED** | KEEP interim curve; new PD before any high-side reshape |

---

## R-010-1 — pH center 7.2

### 1. Evidence found
- **WHO** — *pH in Drinking-water*, WHO/SDE/WSH/07.01/1 (2007): https://cdn.who.int/media/docs/default-source/wash-documents/wash-chemicals/ph.pdf  
- **US EPA** — National Secondary Drinking Water Regulations: pH **6.5–8.5** (aesthetic / non-enforceable federal secondary): https://www.epa.gov/sdwa/drinking-water-regulations-and-contaminants  

### 2. What the source actually means
- WHO: pH is primarily **operational** (treatment, disinfection, corrosion). **No health-based guideline value.** Most drinking-water lies in **6.5–8.5**. Optimum for a given system often **6.5–9.5**. For chlorine disinfection, pH preferably **&lt; 8.0**.
- EPA: **aesthetic secondary** range 6.5–8.5 — not a graded Ideal center.

### 3. Why it does / does not support the model
- Model claims Near-Ideal **center = 7.2**.
- Code comment “midpoint of 6.5–8.5” is **arithmetically false**: \((6.5+8.5)/2 = 7.5\).
- Even midpoint of disinfection-friendly 6.5–8.0 would be **7.25**, still not a cited Ideal.
- **No source specifies Ideal/center 7.2.**

### 4. Unit/context caveat
pH · drinking water · **operational / aesthetic range ≠ quality Ideal center**.

### 5. Final classification
**UNSUPPORTED** (retain as **PROJECT-DEFINED**). Citation status remains **NO CITATION** for Ideal 7.2.

### 6. Future Product Decision?
**YES** before any numeric Ideal change.  
Evidence candidate for *range framing* (6.5–8.5) exists — **does not** authorize moving center to 7.5 or any other value without a new PD.

---

## R-010-2 — TDS Near-Ideal ≤80 mg/L

### 1. Evidence found
- **WHO** — *Total dissolved solids in Drinking-water*, WHO/SDE/WSH/03.04/16 (2003): https://cdn.who.int/media/docs/default-source/wash-documents/wash-chemicals/tds.pdf  
- **WHO GDWQ** Ch.10 Acceptability: palatability good at TDS **&lt; ~600**; increasingly unpalatable **&gt; ~1000**; no health GV.  
- **Japan** — Ministry “おいしい水研究会” (Good-Tasting Water Research Committee, 1985): evaporative residue (**蒸発残留物**) preference **30–200 mg/L** (taste target, not Waterworks Act mandatory Ideal ≤80). Summarized in Japan Water Works Association / utility materials (e.g. JWRC English research brief listing Total residue 30–200 mg/L).  
- **US EPA** — NSDWR / SMCL TDS **500 mg/L** (aesthetic secondary).

### 2. What the source actually means
- WHO organoleptic rating (Bruvold & Ongerth via WHO fact sheet): **excellent &lt;300**; good 300–600; fair 600–900; poor 900–1200; unacceptable &gt;1200 mg/L. Also: extremely **low** TDS may be flat/insipid and corrosive.
- Japan 30–200: **taste preference** for “delicious water,” complementary to safety standards (evaporative residue mandatory criterion is typically **≤500 mg/L** under Water Quality Ordinance).
- EPA 500: aesthetic SMCL, not Near-Ideal ≤80.

### 3. Why it does / does not support the model
- **≤80 is not** WHO excellent (&lt;300), **not** EPA SMCL (500), **not** the Japan taste band ceiling (200).
- ≤80 is a **stricter project cut** possibly *inside* Japan 30–200, but **no clause sets Ideal = 80**.

### 4. Unit/context caveat
mg/L · **palatability / aesthetic / taste preference ≠ health Ideal ≠ mandatory limit**.

### 5. Final classification
**UNSUPPORTED** as Near-Ideal ≤80.  
**PARTIAL** only for “low mineral preference exists in Japan 30–200 taste guidance.”

### 6. Future Product Decision?
**YES** before changing 80.  
If product wants WHO “excellent &lt;300” or Japan 30–200 framing: that is a **new PD** — do not silent-retune.

---

## R-010-3 — ORP Ideal 400±25 mV

### 1. Evidence found
- **WHO GDWQ** (rolling revision / first addendum material to 3rd ed.; operational monitoring): ORP may be used for **operational monitoring of disinfection efficacy**; a minimum ORP for effective disinfection **must be determined case-by-case**; **“universal values cannot be recommended.”**  
  WHO IRIS addendum excerpt: https://iris.who.int/server/api/core/bitstreams/08f2c432-662f-47f5-b92d-a84fb8874d73/content  
- Project **PD-004**: shared ORP **200–600** = **OPERATIONAL / PROJECT** band (already decided).

### 2. What the source actually means
ORP is an **operational disinfection-monitoring tool**, not a national quality Ideal magnitude. WHO **rejects universal Ideal numbers**.

### 3. Why it does / does not support the model
- Model Ideal **400±25** = arithmetic midpoint of project **200–600** ops band — **not** WHO Ideal.
- Commercial claims (e.g. 650 mV “safe drinking water”) are **not** WHO universal Ideal and often pool/disinfection context; **not used as VERIFIED here**.

### 4. Unit/context caveat
mV · **ops disinfection monitoring ≠ graded drinking-water quality Ideal**. Drinking vs pool contexts must not be mixed.

### 5. Final classification
**UNSUPPORTED** / **PROJECT-DEFINED**. Keep **RESEARCH_BLOCKED**.

### 6. Future Product Decision?
**YES** before any Ideal magnitude change. Ops labeling under PD-004 remains separate.

---

## R-010-4 — DO Ideal ≥8.0 mg/L

### 1. Evidence found
- **WHO GDWQ** Ch.10 Acceptability — Dissolved oxygen (4th ed. with addenda materials): https://cdn.who.int/media/docs/default-source/wash-documents/water-safety-and-quality/dwq-guidelines-4/gdwq4-with-add1-chap10.pdf  
- **US EPA** NPDWR / NSDWR lists: **no** primary or secondary drinking-water standard for dissolved oxygen (DO not on EPA secondary table with pH/TDS).

### 2. What the source actually means
- WHO: DO depends on source/temperature/treatment/biology. Depletion can encourage nitrate→nitrite, sulfate→sulfide, ferrous iron then discoloration. **No health-based guideline recommended.** Very **high** DO may **exacerbate corrosion**.
- Typical **≥8 mg/L** figures in environmental literature refer to **healthy surface waters / aquatic life**, not potable Ideal.

### 3. Why it does / does not support the model
- Model treats ≥8 as Near-Ideal **100** for drinking-water quality index — **no WHO/EPA potable Ideal ≥8**.

### 4. Unit/context caveat
mg/L · **potable acceptability / corrosion ops ≠ aquatic-life criterion**.

### 5. Final classification
**UNSUPPORTED**.

### 6. Future Product Decision?
**YES** before any DO Ideal change. Distinguish clearly from JP DO compliance floor (separate deferred item).

---

## R-010-5 — Chlorine &gt;0.5 quality curve

### 1. Evidence found
- **WHO GDWQ** free chlorine remarks (Table of GVs for treatment chemicals): health-based GV **5 mg/L** (C); for effective disinfection residual free chlorine **≥0.5 mg/L** after ≥30 min at pH &lt;8; maintain residual in distribution; **minimum 0.2 mg/L at point of delivery**.  
  NCBI table mirror: https://www.ncbi.nlm.nih.gov/books/NBK579467/table/ch8.tab17/  
- **WHO SEARO** *Principles and Practices of Drinking-water Chlorination*: target residual often **0.2–0.5 mg/L** through distribution to delivery; higher residuals may be needed early in the system; **do not compromise disinfection for aesthetics**; high Cl causes taste/odour complaints.  
- **US EPA** MRDL free chlorine **4.0 mg/L** (40 CFR 141.65) — **health maximum residual**, not graded quality Ideal.

### 2. What the source actually means
- **0.2** = delivery **minimum residual** (disinfection safety).  
- **0.5** = **contact-time disinfection residual** / operational target — **not** “quality score Ideal = 100 forever.”  
- **5 (WHO) / 4 (EPA MRDL)** = **health ceilings**, not quality degradation anchors at 1.0 or 2.0.  
- Taste/odour: individuals often detect Cl at low concentrations; **no authoritative table** maps mg/L → quality grades 46 / 28 / 8.

### 3. Why it does / does not support the model
- Flat **0.2–0.5 → 100**: **PARTIALLY VERIFIED** as aligning with WHO residual **guidance band** (disinfection/delivery semantics), **not** as a proven “quality Ideal” definition.  
- Ramp **46@1.0 / 28@2.0 / floor 8**: **UNSUPPORTED** — production interim reuse; **no clause** supports those magnitudes.  
- Using MRDL 4.0 or GV 5.0 as curve endpoints would still be **semantic mismatch** (health max ≠ quality Ideal) without a new PD.

### 4. Unit/context caveat
mg/L free residual · **disinfection residual / health max / taste acceptability** are three different semantics — model mixes Ideal quality grading with residual guidance.

### 5. Final classification
- Band 0.2–0.5: **PARTIALLY VERIFIED** (residual guidance).  
- High-side curve: **UNSUPPORTED** / interim PROJECT-DEFINED.

### 6. Future Product Decision?
**YES** before changing high-side curve or redefining what “100” means above 0.5.  
Report only: *Evidence candidate found for residual band — numeric curve change requires a new Product Decision.*

---

## Cross-ticket notes

| Claim type | Allowed as Ideal evidence? |
| --- | --- |
| WHO/EPA health GV or MRDL | Supports **health limit**, not automatic Ideal |
| WHO residual 0.2 / 0.5 | Supports **disinfection residual**, PARTIAL for band only |
| WHO/EPA aesthetic SMCL / palatability categories | Supports **acceptability tiers**, not arbitrary tighter Ideal |
| Japan おいしい水 30–200 | Supports **taste preference range**, not ≤80 Ideal |
| WHO ORP “no universal value” | **Blocks** Ideal 400±25 |
| Aquatic DO ≥8 | **Wrong context** for potable Ideal |
| Midpoint of a range without citation of Ideal | **Not evidence** (and 6.5–8.5 midpoint ≠ 7.2) |

---

## Final check

| Item | Status |
| --- | --- |
| Numeric model unchanged | ✅ |
| Baseline 76 / 100 / 100 / 95 / 65 / 99 | ✅ (no scoring code edited this pass) |
| Case Flow untouched | ✅ |
| No Product Decision created | ✅ |
| No numeric repair | ✅ |
| No commit / push / deploy | ✅ |

### Bucket summary

```text
SAFE TO REPAIR NOW:        (none)
REQUIRES PRODUCT DECISION: R-010-1, R-010-2, R-010-3, R-010-4, R-010-5 (high-side);
                           any Ideal magnitude / curve reshape
REQUIRES MORE RESEARCH:    optional deeper Japan primary PDF archival for おいしい水
                           1985 committee original; optional national DO potable
                           surveys — will not unlock repair without PD
UNSUPPORTED:               pH Ideal 7.2; TDS Ideal ≤80; ORP Ideal 400±25;
                           DO Ideal ≥8; Cl high-side 46/28/8 curve
CONFLICTING:               Code claim “pH 7.2 = midpoint of 6.5–8.5” vs arithmetic 7.5;
                           TDS ≤80 vs WHO excellent <300 / Japan taste 30–200
PARTIALLY VERIFIED:        Cl residual band framing 0.2–0.5 (disinfection/delivery);
                           TDS “low mineral taste preference exists” (Japan 30–200 only)
```

**Do not proceed to Model Repair.** Values remain frozen under PD-010 B.
