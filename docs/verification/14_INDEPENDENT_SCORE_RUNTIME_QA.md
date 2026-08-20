# 14 — Independent Score Calculation vs Real UI Runtime QA

**วันที่:** 2026-08-20 (~13:00–13:20 ICT)  
**สภาพแวดล้อม:** `http://127.0.0.1:3177/` · Case CSV `1001` (อานนท์ ศ. · `notionId = null`) · `AUTH_ALLOW_DEV_USERS`  
**Production write:** ไม่สร้าง Case / ไม่ publish / ไม่ส่ง LINE  
**ไม่แก้:** source, test, expected ของ test suite  
**Expected:** `.tmp_probe/independent-calc.js` — **ไม่ import** `src/js/score/**`

คะแนนอยู่ที่ **Case / Assessment / Water Score** (Case = aggregate root; Customer = identity เท่านั้น)

---

## คำตัดสิน 4 ระดับ

| ระดับ | ผล | ความหมาย |
| --- | --- | --- |
| **ARITHMETIC VERIFIED** | **ใช่** | สูตรที่ถอดจาก source แล้วคำนวณเอง ได้เลขเดียวกับ `#gauge-val` ทุกเคสที่อินพุตถึง engine (ผลต่าง = 0) |
| **RUNTIME INPUT VERIFIED** | **ไม่ใช่** | ลบ TDS แล้วค่าเก่ายังเข้า engine; reload แล้วค่าที่เพิ่งกรอกหายจาก `wm-jobs` |
| **UI SCORE VERIFIED** | **ใช่ (มีเงื่อนไข)** | ตัวเลข Hero ตรงเมื่อ lineage ครบ — แต่ตารางพารามิเตอร์แสดงค่าสังเคราะห์ของก๊อกที่ไม่ได้วัด |
| **FULL SCORE FLOW VERIFIED** | **ไม่ใช่** | คนกรอก → ระบบเก็บ → ระบบเลือก → สูตร → UI **ไม่ครบเส้น** |

ห้ามอ่านว่า “Score ผ่าน” — ตัวเลขตรงกันแต่ lineage ผิดต้องเป็น **LINEAGE MISMATCH**

---

## Phase A — SOURCE FORMULA vs INDEPENDENT EXPECTED FORMULA

ทั้งสองชุดเป็นสูตรเดียวกันที่ถอดจาก HEAD ด้วยมือ แล้วพิมพ์ใหม่ใน calculator — **ไม่ได้เรียก** `WaterScoreBenchmarkRegistry.calculate` / `computeQualityScoreDetail` เพื่อสร้าง expected

| หัวข้อ | SOURCE FORMULA (ที่โค้ดทำจริง) | INDEPENDENT EXPECTED |
| --- | --- | --- |
| Grade curve | `computeQualityScoreV2.js` — pH/TDS/Turb/Cl/ORP/DO เส้นเดียวกันทุกประเทศ | ถอดเส้นเดียวกันใน `independent-calc.js` |
| Weight | TH เท่ากัน 5 ตัว **ไม่มี do**; JP 0.22/0.22/0.16/0.16/0.12 **ไม่มี do**; WHO ทั้ง 6 = 1; EU 0.25/0.25/0.15/0.15/0.10/0.10; EPA 0.30/0.20/0.15/0.15/0.10/0.10 | ตาราง `WEIGHTS` ชุดเดียวกัน |
| Aggregation | `weightedSum / weightTotal` แล้ว `Math.round` | เหมือนกัน |
| Weakest-link | `weakestLinkShare` มีในทุก `limits.js` — **`computeSharedBenchmarkBase` ไม่ได้อ่าน** | ไม่ใช้เช่นกัน |
| Severity | cap 85/75/60 หัก 3/6/10; EU บังคับ chlorine=PASS ตอนคิด severity แล้วค่อย PD-002 gate 65 | เหมือนกัน |
| Country ceiling | Hero `score > 99 ? 99 : score` | เหมือนกัน |
| Thailand 90 | **ไม่ใช่เพดานคะแนน** — `THAILAND_EXCELLENT_MIN = 90` เป็นแค่ป้าย Excellent ของไทย | ใช้เฉพาะตอนเทียบ label ไม่แตะเลข Hero |
| Missing | บังคับ ph/tds/turb/orp; Cl/DO ขาดได้ (หลุดจากตัวหาร); ขาด Cl → เพดาน 79 | เหมือนกัน |
| DO / Temp | TH/JP: DO ไม่มีน้ำหนัก + `NOT_EVALUATED`; WHO/EU/EPA ประเมิน DO; Temp ไม่เข้าน้ำหนักทุกประเทศ | เหมือนกัน |
| Quality V3 | ค่าเฉลี่ยเท่าของ 6 grade, ไม่มี severity, ไม่มีเพดาน 99, ขาดตัวเดียว = `null` | เหมือนกัน |
| Country switch | เปลี่ยน `#score-standard-select` เปลี่ยนกฎ ไม่ควรเปลี่ยน readings | ตรวจ runtime แล้ว readings คงที่ |

`toFiniteReading`: `null` / `undefined` / `''` / `false` → ไม่ใช่ตัวเลข; `Number(' ')===0` และ `Number([])===0` **ถูกรับเป็น 0** ในชั้นสูตร — แต่ช่อง `type=number` ของ UI ปฏิเสธ space/abc ตั้งแต่ต้นทาง

---

## Phase B — Independent calculator (ตัวอย่างขั้นกลาง)

**TC-001 Ideal · Japan** (grade ทุกตัว = 100 แต่ pH 7.2 อยู่นอกช่วง PASS ของญี่ปุ่น 7.3–7.7)

| Parameter | Reading | Grade | Weight | Contribution |
| --- | ---: | ---: | ---: | ---: |
| pH | 7.2 | 100 | 0.16 | 16.00 |
| TDS | 80 | 100 | 0.16 | 16.00 |
| Turbidity | 0.10 | 100 | 0.22 | 22.00 |
| Chlorine | 0.35 | 100 | 0.22 | 22.00 |
| ORP | 400 | 100 | 0.12 | 12.00 |
| DO | 8.0 | 100 | **0 (ไม่คิด)** | 0 |
| **Raw** | | | **0.88** | **100** หลังหาร |

```text
classification pH = WARNING (นอก 7.3–7.7 แม้ grade 100)
severity      = min(100, cap 85, 100-3) = 85
hero ceiling  = ไม่ทำงาน
final Hero    = 85
```

**UI จริงรอบนี้:** `#gauge-val` = 85, ป้าย = Excellent — ผลต่างคะแนน 0

**Invariant ที่ตรวจจาก calculator (ไม่เรียก engine จริง)**

| Invariant | ผล |
| --- | --- |
| `sum(contribution) = weightedSum` | ผ่าน |
| `round(weightedSum/weightTotal) = rawAggregate` | ผ่าน |
| `sum(active weights) = 1` | **ไม่เป็นจริงใน source** — ไทยรวม 5, ญี่ปุ่นรวม 0.88; การหารด้วย `weightTotal` ทำให้สัดส่วนถูกต้อง |
| severity ลดได้อย่างเดียว | ผ่าน |
| Hero ≤ 99 | ผ่าน (TC-001 raw 100 → 99) |
| missing ≠ 0 ในสูตรเมื่อค่าเป็น `null`/`''` | ผ่าน |
| `' '` และ `[]` ในสูตร | **กลายเป็น 0** (ชั้น `Number`) |

---

## Phase C — ชุดทดสอบที่สร้างเอง (18 เคสหลัก + sensitivity)

| ID | กลุ่ม | ค่าหลัก |
| --- | --- | --- |
| TC-001 Ideal | Normal | 7.2 / 80 / 0.10 / 400 / 0.35 / 8.0 |
| TC-002 Near ideal | Normal | 7.3 / 100 / 0.15 / 420 / 0.30 / 7.6 |
| TC-003 Good (baseline) | Normal | 7.5 / 150 / 0.30 / 450 / 0.40 / 7.0 |
| TC-018 Average | Normal | **7.8 / 280 / 0.6 / 320 / 0.7 / 6.2** |
| TC-004 Border PASS TH | Boundary | 8.5 / 500 / 1.0 / 600 / 2.0 / 6.0 |
| TC-005 Border FAIL | Boundary | 8.6 / 501 / 1.1 / 601 / 2.1 / 5.9 |
| TC-008 WARNING | Boundary + isolation pH | pH 6.45 จาก baseline |
| TC-009 FAIL turb | Boundary | turb 1.5 |
| TC-010 CRITICAL Cl | Boundary + EU gate | Cl 3.0 |
| SEN-B…G | Isolation | เปลี่ยนทีละ pH/TDS/Turb/Cl/ORP/DO |
| TC-014/015/016 | Missing | ขาด Cl / ขาด TDS / ทั้งคู่ |
| TC-017 | Invalid-looking | pH = 0 |

---

## Phase D/E — กรอก UI จริง + เทียบ Independent vs Runtime

วิธี: `openJob(1001)` → กรอก `#m-*` + event `input`/`change` → `MeterReadingCapture.save` / `completeSub` → `goScreen('s-score')` → รอ `#gauge-val` นิ่ง 4 ครั้ง · **ไม่เรียก scoring function จากสคริปต์**

### คะแนน (ผลต่างต้องเป็น 0 ถึงจะ PASS)

| TC | Engine | Expected | Actual `#gauge-val` | Diff | Result |
| --- | --- | ---: | ---: | ---: | --- |
| TC-001 | TH/JP/WHO/EU/EPA/Q-V3 | 99/85/99/99/99/100 | 99/85/99/99/99/100 | 0 | PASS |
| TC-003 | ทั้ง 6 | 91/91/91/91/89/91 | 91/91/91/91/89/91 | 0 | PASS |
| TC-008 | ทั้ง 6 | 85/85/75/85/84/88 | 85/85/75/85/84/88 | 0 | PASS |
| TC-010 | ทั้ง 6 | 60/60/60/65/77/77 | 60/60/60/65/77/77 | 0 | PASS |
| TC-018 Average | ทั้ง 6 | 77/71/71/65/75/77 | 77/71/71/65/75/77 | 0 | PASS |
| TC-002…007,009,011–017, SEN-A–G | ทั้ง 6 | ตาม independent-calc | ตามรอบ UI ก่อนหน้าวันนี้บนเซิร์ฟเวอร์เดียวกัน | 0 | PASS (คะแนน) |
| DEL-TDS | ทั้ง 6 | `null` | 99/85/99/99/99/100 | — | **LINEAGE MISMATCH** |

### Lineage (ห้าม PASS สมบูรณ์ถ้าคะแนนตรงแต่อินพุตคนละค่า)

| TC | Typed | Persisted `meterReadings` | Scoring `lastReadingsPresent` | Expected | Actual | Result |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-001 | 7.2/80/0.1/400/0.35/8 | ตรงทุกคีย์ | ตรงทุกคีย์ | 99 | 99 | PASS |
| TC-003 | 7.5/150/0.3/450/0.4/7 | ตรง | ตรง | 91 | 91 | PASS |
| TC-018 | 7.8/280/0.6/320/0.7/6.2 | ตรง | ตรง | 77 | 77 | PASS |
| TC-008 | pH 6.45 | ตรง | ตรง | 85 | 85 | PASS |
| TC-010 | Cl 3.0 | `freeChlorine:"3"` | `chlorine:3` | 60 | 60 | PASS |
| **DEL-TDS** | ช่อง TDS = `""` | **ยังเป็น `"80"`** | **ยังเป็น `80`** | `null` | **99** | **LINEAGE MISMATCH** |
| DEL-CL | ช่อง Cl = `""` | `freeChlorine:""` | **ไม่มีคีย์ chlorine** | 79 + Q-V3 null | 79 + Q-V3 null | PASS |
| R-TC-003 reload | 7.5/150/… | **หลัง reload ว่าง** | **{}** | 91 | **Not Eligible** | **FAIL** |

Country switch ใน TC-001/003/008/010/018: `lastReadingsPresent` **ไม่เปลี่ยน** ทั้ง 5 ประเทศ — เปลี่ยนเฉพาะกฎ

---

## Parameter sensitivity (Δ จาก TC-003)

Independent และ UI รอบก่อนหน้าวันนี้ตรงกันทุกแถว (ผลต่าง Δ = 0)

| Parameter | Baseline | Changed | Expected Δ TH | Actual Δ TH | ประเทศอื่น | Result |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| pH | 7.5 | 8.2 | 91→87 (−4) | −4 | JP 91→75 (WARNING cap) | PASS |
| TDS | 150 | 350 | 91→87 (−4) | −4 | JP →75 | PASS |
| Turbidity | 0.3 | 0.8 | 91→88 (−3) | −3 | | PASS |
| Chlorine | 0.4 | 1.2 | 91→80 (−11) | −11 | WHO/JP →60, EU gate 65 | PASS |
| ORP | 450 | 250 | 91→86 (−5) | −5 | | PASS |
| DO | 7.0 | 5.5 | **91→91 (0)** | **0** | WHO/EU/EPA →75 | PASS |

พารามิเตอร์ที่ไม่ได้เปลี่ยนไม่ขยับ — ยืนยันจาก SEN-G ว่าไทย/ญี่ปุ่นไม่ให้น้ำหนัก DO

---

## Cross-country (ชุดเดียวกัน)

| Reading set | TH | JP | WHO | EU | EPA | Q-V3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TC-001 Expected | 99 | 85 | 99 | 99 | 99 | 100 |
| TC-001 Actual | 99 | 85 | 99 | 99 | 99 | 100 |
| TC-018 Expected | 77 | 71 | 71 | 65 | 75 | 77 |
| TC-018 Actual | 77 | 71 | 71 | 65 | 75 | 77 |
| TC-010 Expected | 60 | 60 | 60 | 65 | 77 | 77 |
| TC-010 Actual | 60 | 60 | 60 | 65 | 77 | 77 |

Q-V3 ไม่ขยับเมื่อสลับประเทศในเคสเดียวกัน

---

## Persistence / Reload

| เคส | ก่อน reload | หลัง `location.reload` + `openJob(1001)` | ผล |
| --- | --- | --- | --- |
| R-TC-003 | Hero TH 91, meter ครบ, Cl 0.4, `standardMeasurement = null` | `wm-jobs` ของ 1001 เป็นก๊อกว่าง, `#gauge-val` ไม่มีเลข, ป้าย **Not Eligible** | **FAIL** |
| R-02 / R-03 | ไม่รันต่อ | ค่าถูกล้างแล้ว | **UNKNOWN** (ถูกบล็อกโดย FAIL ของ R-01) |

ไม่มี `standardMeasurement` กลับมาทับในเคสนี้ (ชั้นนั้นว่างทั้งก่อนและหลัง) — ปัญหาคือ **ค่าที่เพิ่งกรอกไม่รอดข้าม reload**

---

## OCR / `standardMeasurement` lineage

**จาก source (`readingsFromTapData`):** ต่อคีย์ใช้ `avg(standardMeasurement)` ก่อน แล้วค่อย `avg(meterReadings)` / `freeChlorine`

```text
Actual precedence in source:
standardMeasurement > meterReadings   (per key, then average across taps)
```

**จาก runtime รอบนี้:** ใส่ `standardMeasurement` บนก๊อก live หลังกรอกมือ แล้วยังได้ `lastReadingsPresent` จาก meter (7.2/80) เพราะ scoring อ่าน **`job.draft.tapData`** เป็นหลัก ไม่ใช่ object live ที่เพิ่งฉีด

- พฤติกรรมนี้ = **designed** ถ้า draft คือ SoT ของ Case  
- เป็น **suspicious** ถ้า OCR เขียนลง live tap แต่ยังไม่ merge เข้า draft ก่อนคิดคะแนน  
- เส้นทาง OCR จริง (ถ่ายรูป + endpoint) = **BLOCKED** (ต้องมีภาพและ auth)

รายงาน 11/12 ยืนยันที่ระดับฟังก์ชันว่าถ้า `standardMeasurement` อยู่ใน tap ที่ถูก resolve จริง มันทับ meter ได้ — รอบนี้ไม่ได้ทำซ้ำด้วยภาพ OCR

---

## Delete / empty / invalid

| ค่าที่กรอก | ช่อง UI | ถูก persist | เข้า engine | คะแนน | ประเมิน |
| --- | --- | --- | --- | --- | --- |
| ลบ TDS `""` | ว่าง | **ค่าเก่า 80** | 80 | 99 | **defect** — missing ไม่เกิด |
| ลบ Cl `""` | ว่าง | ว่าง | ไม่มี chlorine | 79, Q-V3 null | ถูกต้อง |
| `" "` ที่ pH | กลายเป็น `""` | ค่าเก่ายังอยู่ถ้า save | ค่าเก่า | ค่าเก่า | invalid ไม่เป็น 0 **ที่ UI** แต่ลบไม่ได้ |
| `"abc"` ที่ pH | กลายเป็น `""` | เช่นกัน | ค่าเก่า | ค่าเก่า | เช่นกัน |
| `"0"` ที่ pH | รับ, validity true | `"0"` | 0 | คำนวณจริง (TC-017 = 51) | missing ≠ 0 ผ่าน; 0 = ค่าวัด |
| `null`/`false` ในสูตร | — | — | NaN | incomplete | ผ่านที่ชั้นสูตร |
| `" "` / `[]` ในสูตร (ไม่ผ่านช่อง number) | — | — | **0** | คะแนนจาก 0 | ถ้ายิงตรงที่ `toFinite` จะไม่เท่า missing |

---

## Classification QA (อย่าดูแค่เลข)

ป้ายลูกค้ามาจาก `customerVerdictForEngine`: ไทย Excellent ที่ **90+**; ประเทศอื่น **81+**; Good 51+; สีน้ำเงิน/เขียว/แดงตามนั้น — **ไม่ override จาก WARNING/FAIL/CRITICAL** (PD-001)

| TC | Hero | Label | Color | Parameter class | Severity | Math | Policy | UX |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| TC-001 TH | 99 | Excellent | น้ำเงิน | ทุกตัว PASS | ไม่ทำงาน | ถูก | ถูก | สอดคล้อง |
| TC-001 JP | 85 | **Excellent** | น้ำเงิน | **pH WARNING** | cap 85 | ถูก | ถูกตาม PD-001 | **ขัดกัน** — Excellent ทั้งที่ pH นอกช่วงญี่ปุ่น |
| TC-003 TH | 91 | Excellent | น้ำเงิน | PASS | ไม่ทำงาน | ถูก | ไทย 90+ | สอดคล้อง |
| TC-008 TH | 85 | **Good** | เขียว | pH WARNING | cap 85 | ถูก | ไทย Excellent ต้อง ≥90 | สอดคล้องนโยบายไทย |
| TC-008 JP | 85 | Excellent | น้ำเงิน | pH WARNING | cap 85 | ถูก | PD-001 | **ขัดกัน** |
| TC-008 WHO | 75 | Good | เขียว | pH FAIL | cap 75 | ถูก | ถูก | พอรับได้ |
| TC-010 TH | 60 | **Good** | เขียว | **Cl CRITICAL** | cap 60 | ถูก | 51+ = Good | **ขัดกันชัด** — Hero 60 + Good + CRITICAL |
| TC-010 EU | 65 | Good | เขียว | Cl CRITICAL | gate 65 | ถูก | ถูก | ป้าย Good ทั้งที่ Cl CRITICAL |
| TC-018 TH | 77 | Good | เขียว | PASS | ไม่ทำงาน | ถูก | 77 < 90 | สอดคล้อง |

ตารางใต้คะแนนโหมด All locations แสดงค่าเฉลี่ยสังเคราะห์ (เช่น TC-001 วัด 7.2/80 แต่ตาราง 7.3 / 97 mg/L) — **Hero ใช้ค่าวัดจริง, ตารางไม่ใช่**

---

## สรุปตามหมวด (ภาษาไทย)

นับเฉพาะข้อที่มีหลักฐานรอบนี้ (ไม่นับ unit test)

| หมวด | ทั้งหมด | PASS | FAIL | BLOCKED | UNKNOWN |
| --- | ---: | ---: | ---: | ---: | ---: |
| Arithmetic | 18 เคส × 6 มาตรฐาน (ชุด expected) + 5 เคส lineage เต็มที่ UI วันนี้ | ครบเมื่ออินพุตถึง engine | 0 ทางคณิตศาสตร์ | 0 | 0 |
| Input lineage | 8 | 6 | 2 (DEL-TDS, reload) | 0 | 0 |
| UI runtime (Hero) | 5 เคสเต็มวันนี้ + ชุดเดิมบนเซิร์ฟเวอร์เดียวกัน | ตรงทุกค่าที่ lineage ครบ | 0 (คะแนน) | 0 | 0 |
| Country | 5 ชุด × สลับ 5 ประเทศ | readings ไม่เปลี่ยน, คะแนนเปลี่ยนตามกฎ | 0 | 0 | 0 |
| Severity | TC-008/009/010/017 | ตรง cap 85/75/60 และ EU 65 | 0 | 0 | 0 |
| Missing/Invalid | 7 | 4 (null/''/false ในสูตร, ลบ Cl, 0 เป็นค่าวัด, UI ปฏิเสธ abc) | 2 (ลบ TDS, space ในสูตร→0) | 0 | 1 (`[]` ผ่าน UI ไม่ได้) |
| Persistence | 3 ที่ตั้งใจ | 0 | 1 (reload ล้างค่า) | 0 | 2 (ไม่ได้รันต่อ) |
| OCR lineage | 1 เส้นทางภาพ + 1 ฉีดชั้น | 0 | 0 | 1 (OCR จริง) | 1 (ฉีด live ไม่เข้า draft) |
| Classification | 9 แถวด้านบน | math/policy ส่วนใหญ่ | 0 ทางเลข | 0 | UX contradiction 4 แถว (ไม่ใช่เลขผิด) |
| E2E ทั้งเส้น | 1 | 0 | 1 | 0 | 0 |
| **รวมคำตัดสิน** | — | เลขคณิต+Hero ตรง | lineage+reload | OCR ภาพ | reload เคส 2–3 |

---

## Top findings (ไม่เกิน 10)

1. **Confirmed correct** — สูตรประเทศ + Q-V3 + severity + เพดาน 79/99 + นโยบาย DO ไทย/ญี่ปุ่น ตรงกับที่คำนวณเองทุกเคสที่อินพุตถึง engine  
2. **Confirmed correct** — สลับประเทศไม่เปลี่ยน `lastReadingsPresent`; Q-V3 ไม่ตามน้ำหนักประเทศ  
3. **Confirmed defect** — ลบ TDS แล้ว Complete ค่า `"80"` ยังอยู่ใน `meterReadings` และยังคิดคะแนน 99 (**LINEAGE MISMATCH**)  
4. **Confirmed defect** — ลบคลอรีนได้จริง (เขียนทับทั้งก้อน) แต่ลบช่อง meter ไม่ได้ — สองมาตรฐานใน Assessment เดียวกัน  
5. **Data lineage mismatch** — ตาราง All locations แสดงค่าสังเคราะห์ของก๊อกที่ไม่ได้วัด ขณะที่ Hero ใช้ค่าวัดจริง  
6. **Confirmed defect** — reload จริงแล้ว `wm-jobs` ของเคส 1001 กลายเป็นก๊อกว่าง คะแนนเป็น Not Eligible ทั้งที่ก่อน reload เป็น 91  
7. **Suspicious / policy vs UX** — Hero 85 + ป้าย Excellent + pH WARNING (ญี่ปุ่น); Hero 60 + ป้าย Good + Cl CRITICAL (ไทย) — ถูกตาม PD-001 แต่ลูกค้าเห็นคำกับสีไม่สื่อความเสี่ยงของพารามิเตอร์  
8. **Confirmed correct (policy)** — ไทยใช้ Excellent ที่ 90 ไม่ใช่เพดานคะแนน 90; TC-008 ไทยได้ 85 ป้าย Good ขณะที่ญี่ปุ่น 85 ป้าย Excellent  
9. **Missing coverage** — OCR ภาพจริงยัง BLOCKED; reload ทำได้ครบแค่ 1 เคส  
10. **Environment blocked** — publish / LINE / Case ที่มี `notionId` จริง ไม่ได้ทดสอบตามกติกา

---

## Evidence index

| รายการ | ที่เก็บ |
| --- | --- |
| Independent expected + ขั้นกลาง | `.tmp_probe/independent-calc.js` / `.out.json` |
| UI actual รอบก่อน (คะแนน) | `.tmp_probe/ui-fill-this-run.json` |
| รอบนี้ | CDP บน `127.0.0.1:3177` · เคส 1001 · 2026-08-20 |
| ไม่ใช้ | ผล unit test / expected ใน test suite เป็นตัวตั้งต้น |

ไม่มีการแก้โค้ดระหว่าง QA
