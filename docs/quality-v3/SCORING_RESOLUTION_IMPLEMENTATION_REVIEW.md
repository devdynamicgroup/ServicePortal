```text
PRODUCTION CODE CHANGED: NO
SCORING MODEL CHANGED: NO
COUNTRY LIMITS CHANGED: NO
CASE VALUES CHANGED: NO
UI CHANGED: NO
NOTION CHANGED: NO
NO NEW CASES CREATED
NO DEPLOY
NO COMMIT REQUIRED BY THIS DOCUMENT
```

# Scoring Resolution & Country Benchmark Differentiation — Implementation Review

**READ → TRACE → PROBE → COMPARE → REPORT. Nothing else.** This document
is the most implementation-focused pass in this review series — it exists
specifically to answer the 9 questions in §Final Question with direct
evidence, and to state exactly which files would need to change if only
the two stated goals (resolution, country differentiation) were approved.
It reuses the matrices already verified in `SCORING_RESOLUTION_REVIEW.md`
rather than re-deriving them, and adds new probes this pass required:
adjacent-value resolution tests with the curve-vs-aggregation distinction
made explicit, and gap fixtures built only from limits already in the
code (including the repo's own existing `LOCKED` and `POOR` test
fixtures, not new ones).

---

## A. Current Implementation (summary — full detail in prior docs)

**Quality V3** (`src/js/score/production/computeQualityScoreV2.js`):
6 independently-curved parameters (pH, TDS, Turbidity, ORP, Chlorine, DO),
unweighted arithmetic mean, single `Math.round` at the end. Full curve
tables: `SCORING_DIAGNOSTIC_REPORT.md` Part 1, `SCORING_RESOLUTION_REVIEW.md` §2.

**Thailand** (`benchmark/thailand/{limits,score}.js`): flat-100 within
pH 6.5–8.5 / ORP 200–600 / Chlorine 0.2–2.0; wide flat zone for TDS
(≤1000, `passMax`) and Turbidity (≤5 NTU, `passMax`) before any grading
starts; DO not scored (zero weight).

**Japan** (`benchmark/japan/{limits,score}.js`): flat-100 within
pH 5.8–8.6 / ORP 200–600 / Chlorine 0.1–1.0; TDS/Turbidity grade starting
at 300 ppm / 2 NTU (narrower flat zone than Thailand); DO one-sided,
floor at 5 mg/L.

**WHO** (`benchmark/who/{limits,score}.js`): flat-100 within
pH 6.5–8.5 (then a 3-step function: 70/40/15, not a ramp) / ORP 200–600 /
Chlorine 0.2–0.5 (then a 3-step function: 80/50/25 — confirmed this pass
to be *coarser* than the other engines' chlorine ramps, see §D); TDS/
Turbidity use genuine 3-tier ramps (`ideal/fair/poor`), the most granular
of the five engines for those two parameters specifically.

**EU** (`benchmark/eu/{limits,score}.js`): flat-100 within
pH 6.5–9.5 / ORP 200–600; Chlorine 0.1–0.5 **plus an intentional hard
composite-score gate** (`gateCapOnChlorineFail: 65`, documented in the
file header) that caps the *entire* score, not just the chlorine
parameter, whenever chlorine is out of band; TDS/Turbidity grade from
300 ppm / 1 NTU.

**US EPA** (`benchmark/usEpa/{limits,score}.js`): flat-100 within
pH 6.5–8.5 / ORP 200–600 / Chlorine 0.2–4.0 (widest chlorine tolerance of
the five); TDS/Turbidity grade from 300 ppm / 1 NTU.

---

## B. Resolution Findings

Four distinct mechanisms cause coarse-feeling scores, and **this pass
distinguishes them precisely for the first time** using a controlled
adjacent-value test (§D):

1. **Parameter curve flatness** — some curves have a genuine flat zone
   *at the parameter-grade level itself* (e.g. Quality V3 chlorine within
   ±0.025 of 0.30 mg/L: 0.29/0.30/0.31 all grade 100 — confirmed, §D).
   This is resolution loss **inside the curve**, before aggregation even
   happens.
2. **Aggregation/rounding dilution** — other cases show the *parameter*
   grade genuinely changing, but the 6-parameter average moves too little
   to survive `Math.round()`. Confirmed directly: TDS 299→300→301 moves
   the TDS parameter grade 68.12→68.00→67.92 (real, continuous movement)
   but the rounded Quality score stays 95 at all three points. Turbidity
   0.09→0.10→0.11 shows the same pattern (98/97/96... rounds to 100 at
   all three). **This is resolution loss at aggregation, not the curve.**
3. **Country plateau width** — Thailand's TDS/Turbidity flat zones are
   wide (1000 ppm / 5 NTU) vs. the other four engines' ~300 ppm / ~1–2 NTU
   — verified in `SCORING_RESOLUTION_REVIEW.md` §3b, not re-probed here.
4. **Hard gates** — EU's chlorine gate (`gateCapOnChlorineFail`) is a
   different mechanism entirely: intentional, documented, and it produces
   a large, deliberate score movement (100→65) rather than a coarse/flat
   one. Not a resolution problem — the opposite, in fact (§D gap fixtures
   show it's the sharpest differentiator among the five engines).

---

## C. Existing Limits (from code, unchanged, for reference only)

| Parameter | Thailand | Japan | WHO | EU | US EPA |
|---|---|---|---|---|---|
| pH | 6.5–8.5 | 5.8–8.6 | 6.5–8.5 (fair 6–9, poor 5.5–9.5) | 6.5–9.5 | 6.5–8.5 |
| TDS | passMax 1000, softEnd 1500 | ideal 300 (coded), displayMax 500 | ideal 300, fair 600, poor 1000 | ideal 300 (coded), displayMax 500 | ideal 300 (coded), smcl 500 |
| Turbidity | passMax 5, softEnd 12 | ideal 2, steepEnd 6 | ideal 1, fair 5, poor 10 | ideal 1, hardFail 4 | ttIdeal 1, steepEnd 5 |
| ORP | 200–600 | 200–600 | 200–600 | 200–600 | 200–600 |
| Chlorine | 0.2–2.0 | 0.1–1.0 | idealMin/Max 0.2–0.5, fair 1, poor 2 | 0.1–0.5 (+ hard gate) | 0.2–4.0 |
| DO | not scored | ≥5 | ≥6 | ≥6 | ≥6 |

No value above was changed by this or any prior pass in this review series.

---

## D. Diagnostic Score Tables

### D1. Current Quality parameter scores & composite (existing Case A/B, for reference)

| Case | pH | TDS | Turb | ORP | Cl | DO | **Composite** |
|---|---:|---:|---:|---:|---:|---:|---:|
| CASE_A (1328) | 84.30 | 97.60 | 96.00 | 97.17 | 100.00 | 74.80 | **92** |
| CASE_B (synthetic) | 81.00 | 86.75 | 71.20 | 76.13 | 66.86 | 55.20 | **73** |

### D2. Adjacent-value resolution test — curve vs. aggregation, distinguished

| Input | Parameter grade | Raw 6-param mean | Rounded Quality | Where resolution is lost |
|---|---:|---:|---:|---|
| TDS = 299 | 68.12 | 94.687 | 95 | — |
| TDS = 300 | 68.00 | 94.667 | 95 | — |
| TDS = 301 | 67.92 | 94.653 | 95 | **AGGREGATION/ROUNDING** — parameter grade moves (68.12→67.92), composite doesn't |
| Turbidity = 0.09 | 99 | 99.833 | 100 | — |
| Turbidity = 0.10 | 98 | 99.667 | 100 | — |
| Turbidity = 0.11 | 97 | 99.500 | 100 | **AGGREGATION/ROUNDING** — parameter grade moves (99→97), composite doesn't |
| Chlorine = 0.29 | 100 | 100 | 100 | — |
| Chlorine = 0.30 | 100 | 100 | 100 | — |
| Chlorine = 0.31 | 100 | 100 | 100 | **PARAMETER CURVE** — the curve itself is flat here (±0.025 near-ideal zone), the parameter grade never moves, so there's nothing for aggregation to dilute |

**This is the direct, requested answer to §4 of the task brief:** TDS and
Turbidity lose resolution at the **aggregation/rounding** step (the curve
is fine; the average erases it). Chlorine at exactly this location loses
resolution at the **parameter curve** step (the curve itself has a flat
zone here) — a different mechanism requiring a different fix if ever
approved. Conflating these two would lead to the wrong remedy being
applied to the wrong layer.

### D3. Country benchmark comparison — gap fixtures from existing limits only

All fixtures below use either the repository's own existing test fixtures
(`tests/score/quality-v2-calibration.test.js`) or new points chosen
strictly from the limit values already in `limits.js` — no new standard,
band, or threshold was introduced to construct any of them.

| Fixture | Measurement (key values) | Quality | TH | JP | WHO | EU | EPA |
|---|---|---:|---:|---:|---:|---:|---:|
| CASE_A (existing) | ph 7.79, tds 92, turb 0.12, orp 434, cl 0.30, do 6.34 | 92 | 100 | 100 | 100 | 100 | 100 |
| CASE_B (existing) | ph 7.90, tds 155, turb 0.60, orp 507, cl 0.50, do 5.20 | 73 | 100 | 100 | 98 | 99 | 99 |
| LOCKED (existing — referred to earlier in this thread as "MID") | ph 7.2, tds 450, cl 0.8, turb 2.5, orp 350, do 6.5 | 71 | 100 | 96 | 93 | **65** | 91 |
| POOR (existing) | ph 9.0, tds 700, turb 4, orp 100, do 4.0, cl 1.5 | 39 | 87 | 69 | 64 | 52 | 67 |
| DEEP_INSIDE_ALL (new, deep inside every standard) | ph 7.3, tds 100, turb 0.15, orp 410, cl 0.35, do 7.5 | 96 | 100 | 100 | 100 | 100 | 100 |
| BETWEEN_TH_JP (new — chlorine 1.5, inside TH's 0.2–2.0, outside JP's 0.1–1.0) | cl 1.5, rest ideal | 90 | 100 | 92 | 92 | **65** | 100 |
| BETWEEN_JP_WHO (new — pH 8.55, inside JP's 5.8–8.6, outside WHO's 6.5–8.5) | ph 8.55, rest ideal | 94 | 100 | 100 | 95 | 100 | 100 |
| BETWEEN_EU_EPA (new — chlorine 2.0, inside EPA's 0.2–4.0, outside EU's 0.1–0.5) | cl 2.0, rest ideal | 88 | 100 | 85 | 92 | **65** | 100 |

**Note on LOCKED:** this thread's opening message cited this fixture's
figures from memory as "TH 100, JP 95, WHO 91, EU 65, EPA 91." Probed
directly against the current code this pass, the actual values are
**TH 100, JP 96, WHO 93, EU 65, EPA 91** — close, but not identical
(likely the code shifted slightly since that recollection, or the
recollection itself was approximate). The implementation is the source of
truth per this task's own instruction (§2); the number above is what the
code produces today, not what was recalled earlier.

**Reading D3:** the gap fixtures prove genuine, evidence-grounded
differentiation exists and is reachable through the current code without
inventing anything — TH≠JP≠WHO≠EU≠EPA at BETWEEN_TH_JP and BETWEEN_EU_EPA
specifically *because* their real, existing chlorine bands differ (not
because of any artificial adjustment). DEEP_INSIDE_ALL correctly produces
identical 100s everywhere, proving the system isn't forcing fake
differences when standards genuinely agree.

---

## E. Before / Potential After (not implemented)

No candidate curve is implemented anywhere in this document. Two
**illustrative, non-binding** sketches, shown only to make a potential
direction concrete for product review — neither is proposed as a final
number:

| Item | Current | Potential (illustrative only, NOT proposed) | What would change |
|---|---|---|---|
| Quality chlorine near-ideal zone | Flat 100 for `\|Δ\|≤0.025` (0.275–0.325 mg/L) | Narrower flat zone, e.g. `\|Δ\|≤0.01` | Would let 0.29 vs. 0.30 vs. 0.31 differ — **requires evidence for the new width, which does not currently exist (§9 rule: NO EVIDENCE — DO NOT LOCK THIS NUMBER)** |
| Aggregation rounding | Single `Math.round()` on the final mean | Round each parameter grade to 1 decimal before final rounding, or report an unrounded/higher-precision internal value even if the displayed number stays an integer | Would preserve some of the TDS 299/300/301 distinction internally without necessarily changing the displayed integer — a **mathematical-consequence** change, not a curve or evidence change, and still requires approval since it changes what gets stored/compared internally |
| Thailand TDS/Turbidity flat zone | 1000 ppm / 5 NTU | Narrow to align with the other four engines' ~300 ppm / ~1–2 NTU pattern | Would make Thailand's shape consistent with its peers — **but Thailand's own code/comments give no evidence this width was accidental rather than deliberate**, so this remains a product decision, not a default |

---

## F. Decision Matrix

| Issue | Evidence | Proposed Change | Risk | Approval |
|---|---|---|---|---|
| Quality resolution (chlorine near-ideal flat zone) | Directly demonstrated, §D2 — parameter-curve-level flatness | Narrow the `\|Δ\|≤0.025` zone | No evidence for what the new width should be; risk of inventing precision | **REQUIRED** |
| Quality resolution (TDS/Turbidity aggregation dilution) | Directly demonstrated, §D2 — real parameter movement erased by rounding | None proposed — this is a property of averaging 6 parameters, not a single curve | Any fix here is necessarily an aggregation-layer change, explicitly out of scope per this task's own rule (§5) | **REQUIRED** (decision is whether to revisit the aggregation-change restriction at all) |
| Country resolution (gap fixtures) | Directly demonstrated, §D3 — real differentiation already reachable via existing limits at BETWEEN_TH_JP / BETWEEN_EU_EPA | None required — the capability already exists in the current code; no change needed to prove standards can differ | None — this row confirms current behavior is already correct where it matters | **NOT REQUIRED** — informational |
| Thailand TDS/Turbidity plateau width | Confirmed wider than the other 4 engines, no internal rationale found for the gap | Narrow to ~300 ppm / ~1–2 NTU to match peers, OR document as deliberate | Could be reversing a genuine Thailand-specific product decision | **REQUIRED** |
| Aggregation (arithmetic vs. alternatives) | `SCORING_RESOLUTION_REVIEW.md` §4/§8 — geometric/harmonic move Case A/B by <1 point; only a minimum-weighted blend produces material movement, with no evidence for its blend factor | None proposed — explicitly locked for this and all prior passes | Changing this without cause risks exactly the "lower Case A" pattern this whole review series was built to prevent | **REQUIRED**, and flagged as the change most likely to actually move the resolution needle if ever revisited |
| Rounding (single integer `Math.round`) | Directly demonstrated, §D2 | None proposed — illustrative alternative shown in §E only | Changing internal precision without changing the displayed integer is low-risk but still touches shared calculation code | **REQUIRED** |
| WHO chlorine step-function coarseness | Confirmed this pass, §A/§D — coarser than the other 4 engines' ramps | None proposed | Changing the WHO-named engine carries reputational sensitivity (§ prior review, `SCORING_RESOLUTION_REVIEW.md` §10) | **REQUIRED** |

---

## Final Question

**1. สูตร Quality หลักผิดหรือไม่?**
ไม่ผิด. คณิตศาสตร์ถูกต้องทุกจุดที่ตรวจสอบ (ยืนยันซ้ำหลายรอบในเอกสารชุดนี้). ปัญหาที่พบทั้งหมดเป็นเรื่อง resolution/evidence ไม่ใช่ arithmetic bug.

**2. ปัญหาหลักคือ scoring resolution หรือ aggregation?**
**ทั้งสองเรื่อง แต่คนละจุดกัน** — พิสูจน์แยกกันได้ชัดเจนครั้งแรกในรอบนี้ (§D2): Chlorine ใกล้ 0.30 สูญเสีย resolution ที่ **parameter curve** เอง (curve แบนจริง); TDS/Turbidity ที่ breakpoint 300/0.1 สูญเสีย resolution ที่ **aggregation/rounding** (parameter เปลี่ยนจริงแต่ composite ปัดทิ้ง). ต้องแก้คนละวิธีถ้าจะแก้.

**3. Country engines มีความแตกต่างตาม standards อยู่แล้วตรงไหน?**
ที่ chlorine band (TH 0.2–2.0 vs JP 0.1–1.0 vs WHO/EU 0.2–0.5/0.1–0.5 vs EPA 0.2–4.0) และที่ pH band ส่วนขอบ (JP 8.6 vs WHO/TH/EPA 8.5 vs EU 9.5) — พิสูจน์ตรงด้วย gap fixtures จริงใน §D3 (BETWEEN_TH_JP, BETWEEN_JP_WHO, BETWEEN_EU_EPA ทั้งสามแสดงผลต่างจริง ไม่ได้ประดิษฐ์ขึ้น).

**4. จุดไหนยัง flat / coarse เกินไป?**
Quality chlorine near-ideal zone (±0.025 mg/L, parameter-level flat), Quality TDS/Turbidity ที่ breakpoint ใกล้เคียงกัน (aggregation-level flat แม้ curve จะเกรดอยู่), Thailand TDS/Turbidity plateau (0-1000ppm/0-5NTU, กว้างกว่า 4 engine อื่นมาก), WHO chlorine step function (coarse กว่า ramp ของที่อื่น).

**5. จุดไหนควรเพิ่ม resolution?**
ตามหลักฐานที่มี: Quality chlorine flat zone (แต่ยังไม่มีตัวเลขทดแทนที่มีหลักฐาน — ต้อง PRODUCT DECISION), Thailand's TDS/Turbidity plateau width (เทียบกับ 4 engine อื่นที่มี pattern คล้ายกันอยู่แล้ว), WHO chlorine (เปลี่ยนจาก step-function เป็น ramp แบบเดียวกับ engine อื่น).

**6. จุดไหนไม่ควรแตะ เพราะมีเหตุผลรองรับอยู่แล้ว?**
EU chlorine hard gate (`gateCapOnChlorineFail:65`) — ตั้งใจจริง มีคอมเมนต์อธิบายในโค้ด และพิสูจน์แล้วว่าเป็นตัว differentiator ที่คมที่สุดในบรรดา 5 engines (§D3). Turbidity center ของ Quality V3 (≤0.08 NTU) — มีหลักฐาน WHO สนับสนุนใกล้เคียงอยู่แล้ว (`SCORING_RESOLUTION_REVIEW.md` §6). ORP curve ทั้งหมด — ไม่มีหลักฐานสนับสนุนตัวเลขไหนเลย ดังนั้น "ไม่แตะ" ในที่นี้หมายถึง "ไม่แตะเพราะไม่มีฐานให้เลือกเลข ไม่ใช่เพราะของเดิมถูกต้อง".

**7. มีตัวเลขใดที่สามารถเปลี่ยนได้จาก evidence ที่มีอยู่จริง?**
มีเพียงจุดเดียวที่มี evidence สนับสนุนตัวเลขทดแทนโดยตรง: **Turbidity ideal center จาก ≤0.08 → ≤0.1 NTU** (ตรงกับ WHO "ideally <0.1 NTU for effective disinfection"). ที่เหลือทั้งหมดเป็น PRODUCT DECISION หรือ NO EVIDENCE ตาม classification ใน `EVIDENCE_BASED_SCORING_AUDIT.md`.

**8. จุดใดต้องให้ product owner ตัดสินใจ?**
ทุกแถวใน §F ที่ทำเครื่องหมาย REQUIRED — โดยเฉพาะ: ความกว้างใหม่ของ chlorine flat zone (ไม่มีหลักฐาน), การแก้ Thailand plateau (อาจเป็น product decision เดิมที่ตั้งใจ), การแก้ WHO chlorine curve (sensitivity เพราะชื่อ WHO), และว่าจะเปิดประเด็น aggregation อีกครั้งหรือไม่.

**9. ถ้าปรับเฉพาะ "2 เรื่องที่ต้องการ" (scoring resolution + country differentiation) จะต้องแก้ไฟล์ production ใดบ้าง?**

หากได้รับอนุมัติเฉพาะรายการที่มีหลักฐานรองรับจริงและอยู่ในขอบเขตนี้ (ไม่รวม aggregation ซึ่งถูกล็อกไว้):

```text
src/js/score/production/computeQualityScoreV2.js
  - gradeTurbidity(): เปลี่ยน ideal cutoff จาก 0.08 → 0.1 (เท่านั้น, ถ้าอนุมัติ)
  - gradeChlorine(): เท่านั้นถ้า product owner อนุมัติเปลี่ยนความกว้าง near-ideal zone
    (ยังไม่มีตัวเลขทดแทนที่มีหลักฐาน ณ ตอนนี้)

src/js/score/benchmark/thailand/limits.js
  - tds.passMax / turbidity.passMax: เท่านั้นถ้า product owner อนุมัติให้แคบลง
    ให้สอดคล้องกับ engine อื่น

src/js/score/benchmark/who/score.js
  - gradeChlorine(): เท่านั้นถ้า product owner อนุมัติเปลี่ยนจาก step-function
    เป็น ramp (ยังไม่มีตัวเลขทดแทนที่มีหลักฐาน ณ ตอนนี้)
```

**ไฟล์ที่จะไม่ต้องแก้แม้อนุมัติทั้งหมดข้างต้น**: UI/HTML/CSS,
Notion persistence, Case lifecycle, Compliance logic
(`evaluateCompliance()`), country limits ของ Japan/WHO/EU/US EPA (ไม่มี
หลักฐานให้แก้), aggregation formula ทั้งหมด — ตรงตาม non-negotiable
rules ในโจทย์นี้ทุกข้อ

**ไม่มีไฟล์ใดถูกแก้จริงในรอบนี้** — รายการข้างต้นคือ "ถ้าอนุมัติ" เท่านั้น
