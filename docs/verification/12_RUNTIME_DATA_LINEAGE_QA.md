# 12 — Deep Runtime Data-Lineage QA Audit (Full System Execution Trace)

**วันที่ตรวจ:** 2026-08-20
**ขอบเขต:** ตรวจเส้นทางเดินของข้อมูลจริงตั้งแต่ Website → Cal.com → Webhook → Case → OCR → Measurement → Score → Publish → Report → Card → LINE → Dashboard → Feedback
**โหมด:** Read-only ทั้งหมด
**Production:** ใช้ HTTP GET เท่านั้น (ไม่มี POST/PUT/PATCH/DELETE)
**ไม่มีการแก้:** source code, test, expected value, production data, ไม่ deploy, ไม่สร้าง Case, ไม่ publish, ไม่ส่ง LINE

---

## 0. วิธีเก็บหลักฐาน และนิยามระดับหลักฐาน

| ระดับ | ความหมาย | วิธีที่ใช้ในรอบนี้ |
| --- | --- | --- |
| `RUNTIME VERIFIED` | รันฟังก์ชัน production จริงและอ่านค่าจริงที่ออกมาทีละ stage | โหลดไฟล์ production เข้า Node `vm` sandbox แล้วเรียก entry point จริง (`resolveScoreReadings`, `resolveDisplayedScore`, `AssessmentSnapshot.*`, engine registry) + HTTP GET production |
| `SOURCE PROVEN` | อ่านโค้ดจนได้ข้อสรุปเดียวที่เป็นไปได้ พร้อมเลขบรรทัดอ้างอิง | เส้นทางที่ต้อง POST/เขียน Notion ซึ่งกฎห้ามรัน |
| `UNIT ONLY` | มีเฉพาะไฟล์ test ในโปรเจกต์ ยังไม่ได้เห็นเส้นทาง runtime ปลายทาง | ไฟล์ใน `tests/` |
| `BLOCKED` | ไม่มี environment ที่ทดสอบได้อย่างปลอดภัย | ทุกเส้นทาง write บน Notion/LINE/Cal |
| `UNKNOWN` | ยังพิสูจน์ไม่ได้ในรอบนี้ | ระบุเหตุผลไว้ทุกจุด |

### เครื่องมือที่ใช้ (ชั่วคราว อยู่นอก source tree)

| Probe | เนื้อหา | ผลลัพธ์ |
| --- | --- | --- |
| `.tmp_probe/lineage-qa.js` | เรียก `resolveScoreReadings(job)` จริง 21 เคส + weighted contribution รายพารามิเตอร์ 5 engine × 5 fixture + country switch | `lineage-qa.out.json` |
| `.tmp_probe/rehydration-qa.js` | เรียก `AssessmentSnapshot.preferDraft / mergeSnapshots / mergeReadingMaps / asMeasurementNumber` จริง | `rehydration-qa.out.json` |
| `.tmp_probe/roundtrip-qa.js` | round-trip เต็ม: OCR → `buildSnapshot` → แก้ไข → `buildSnapshot` → `mergeSnapshots` → `applySnapshotToDraft` → `resolveScoreReadings` → engine | `roundtrip-qa.out.json` |

**หมายเหตุสำคัญเรื่องความน่าเชื่อถือของ probe:** probe ทั้งสามตัวโหลดไฟล์ production ตัวจริงจาก `src/js/**` เข้า sandbox โดยไม่แก้ไขไฟล์ ไม่ mock ฟังก์ชันคำนวณใด ๆ และเรียก entry point เดียวกับที่ browser เรียก (`resolveScoreReadings` ไม่ต้องมี DOM เพราะรับ `job` object โดยตรง — ดู `src/js/flows/score.js:799-805`) ค่าที่รายงานคือค่าที่ฟังก์ชันคืนออกมาจริง

---

## 1. สรุปผู้บริหาร (อ่านหัวข้อนี้ก่อน)

พบข้อบกพร่องเชิง data-lineage ที่ยืนยันด้วย runtime **7 รายการ** โดย 3 รายการรุนแรงระดับที่ทำให้ **คะแนนที่ลูกค้าเห็นเปลี่ยนเองหลัง reload โดยไม่มีใครแก้ข้อมูล**

| # | ข้อบกพร่อง | ผลกระทบที่วัดได้จริง |
| --- | --- | --- |
| DL-01 | `standardMeasurement` มีสิทธิ์เหนือ `meterReadings` เสมอ | ช่างแก้ pH 8.9 → 7.2 แต่ engine ยังใช้ 8.9 → Thailand 75 แทน 94 |
| DL-02 | คะแนนเปลี่ยนเองหลัง save/reload | หน้าจอเดิม ข้อมูลเดิม: ก่อน reload 94 → หลัง reload **75** |
| DL-03 | ลบค่าที่ผิดออกไม่ได้ | ลบ pH ทิ้ง → หลัง reload ค่า 8.9 กลับมาเอง; ลบ chlorine → 1.9 กลับมาเอง |
| DL-04 | ช่องว่าง `" "` กลายเป็น `0` ที่ชั้น persistence | พิมพ์ space ในช่อง pH → เก็บลง `meterReadings.ph = 0` → Thailand 60 |
| DL-05 | ค่า `0` ที่ UI กรองทิ้ง ยังไปถึง engine ผ่าน `standardMeasurement` | pH 0 → 60 (ต่ำผิด), turbidity 0 → **99** (สูงผิด = อันตรายกว่า) |
| DL-06 | multi-tap averaging ทิ้ง tap ที่มีแต่ `meterReadings` | tap2 pH 8 ถูกละเลยทั้งค่า เหลือ tap1 อย่างเดียว |
| DL-07 | `preferDraft` เลือก draft ทั้งก้อน ไม่ merge ระดับ field | ค่าที่มีเฉพาะฝั่งที่แพ้หายทั้งหมด → score กลายเป็น incomplete |

และข้อบกพร่องเชิงกระบวนการที่สำคัญที่สุด: **64% ของผลลัพธ์ PASS ทั้งหมดในรายงาน 09 อ้างอิงหลักฐานชิ้นเดียวกัน** และ repo ไม่มี `npm test` / CI / git hook ที่จะรัน test ให้อัตโนมัติ

---

## 2. PART 1 — Architecture Path Reconstruction

### 2.1 ตารางเส้นทางจริงทีละ transition

| # | From | To | Function / Endpoint | Input | Transformation | Output | Storage | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | Website / Framer | Cal.com | ลิงก์จองภายนอก | คลิกผู้ใช้ | — | เปิดหน้าจอง Cal | — | GET `https://www.water-motion.co/` = 200 | `RUNTIME VERIFIED` |
| T02 | Cal.com | Webhook | `POST /api/cal/webhook` | booking payload + `x-cal-signature-256` | — | เข้าสู่ handler | — | GET `/api/cal/webhook/status` = 200, `hasWebhookSecret:true`, `signatureHeader:"x-cal-signature-256"`, `createsCasesFor:["BOOKING_CREATED"]` | `RUNTIME VERIFIED` (GET status) |
| T03 | Webhook | Signature verification | `verifyCalSignature` (`services/cal-webhook.js`) | raw body + header | HMAC-SHA256 เทียบ secret | ผ่าน/ไม่ผ่าน | — | `api/cal-routes.js:72` | `SOURCE PROVEN` |
| T04 | Signature | Payload validation | `cal-booking-adapter.js` | payload | ดึง email/phone/เวลา/แผน + normalize | booking object | — | source | `SOURCE PROVEN` |
| T05 | Validation | Campaign / product mapping | `createCase(body, {launchOffer, campaignOffer})` | booking object | map campaign → offer | case input | — | `api/case-flow-routes.js:604-627` | `SOURCE PROVEN` |
| T06 | Mapping | `createCase()` | `POST /api/cases` | case input | `withIdempotency(bookingIdempotencyKey)` | Case + 201 | Notion | `api/case-flow-routes.js:608-622` | `SOURCE PROVEN` / write `BLOCKED` |
| T07 | createCase | Notion | Notion API | case fields | map → Notion properties | Notion page | Notion DB | ต้องเขียนจริง | `BLOCKED — ENVIRONMENT GAP` |
| T08 | Notion | Case list | `GET /api/clients` | cookie session | Notion page → job object | jobs[] | memory | GET production = **401** เมื่อไม่มี session | `RUNTIME VERIFIED` |
| T09 | API | Case rehydration | `loadJobsFromApi()` | payload.jobs | กรอง cancelled → normalize → merge draft → `JOBS.splice` → เก็บ manual job → คืน active case | `JOBS[]`, `S.activeJob` | memory + `localStorage['wm-jobs']` | `src/js/job-state.js:1044-1160` | `SOURCE PROVEN` |
| T10 | Rehydration | เลือก draft | `AssessmentSnapshot.preferDraft(local, remote)` | 2 draft | เลือก**ทั้งก้อน** ตาม localEditedAt → assessmentUpdatedAt → revision | draft ที่ชนะ | memory | probe P1–P7 | `RUNTIME VERIFIED` |
| T11 | Case | Measurement input | ฟอร์ม `#m-*` | ผู้ใช้พิมพ์ | เก็บเป็น string | `tap.meterReadings` | draft | `src/js/flows/score.js:701-711` | `SOURCE PROVEN` |
| T12 | กล้อง | OCR | `POST /api/ocr/read-meter` | ภาพมิเตอร์ | OCR → `body.data` | rawMeasurement | — | production ต้อง auth (401) | `SOURCE PROVEN` / `BLOCKED` |
| T13 | OCR | ฟอร์ม | `mapOcrDataToMeterReadings(data)` | rawMeasurement | **กรอง false-zero** (`ph`/`temp`/`turbidity` ที่เป็น 0 ถูกทิ้ง) | meterReadings (กรองแล้ว) | `tap.meterReadings` | `src/js/flows/assessment.js:475+` | `SOURCE PROVEN` |
| T14 | OCR | Normalization | `ConversionEngine.toStandardMeasurement(rawInput)` | rawMeasurement **ดิบ ไม่ผ่านตัวกรอง** | EC→TDS, DO%→mg/L, °F→°C + `applied[]`/`missing[]` | standardMeasurement | `tap.standardMeasurement` | exports: `toStandardMeasurement, convertEcToTds, convertDoPercentToMgL, convertFahrenheitToCelsius, unwrapRaw, toFiniteNumber` | `RUNTIME VERIFIED` (exports) / `SOURCE PROVEN` (call site) |
| T15 | Save | Snapshot | `AssessmentSnapshot.buildSnapshot()` | draft.tapData | `compactReadings` (ตัด null/ค่าที่แปลงไม่ได้), **สังเคราะห์ `standardMeasurement.chlorine` จาก `freeChlorine`** | snapshot (frozen) | Notion + localStorage | probe: input freeChlorine 0.42 → `standardMeasurement:{chlorine:0.42}` | `RUNTIME VERIFIED` |
| T16 | Reload | Merge snapshot | `mergeSnapshots(existing, incoming)` | 2 snapshot | revision/updatedAt แล้ว **merge ระดับ field** (absent ≠ clear) | snapshot รวม | draft | probe: `{tds:92}`+`{ph:7.9}` → `{ph:7.9,tds:92}` | `RUNTIME VERIFIED` |
| T17 | Draft | Score input | `resolveScoreReadings(job)` | job.draft | `readingsFromTapData` (std → meter → chlorineReadings) แล้ว merge กับ `draft.fields` | readings 7 คีย์ | memory | probe 21 เคส | `RUNTIME VERIFIED` |
| T18 | Readings | Validation | `MeasurementValidator` | readings | จัดสถานะ VALID / PARTIAL / MISSING | validation object | `S.lastReadingsValidation` | probe: ครบ = VALID, ขาด tds = PARTIAL | `RUNTIME VERIFIED` |
| T19 | Readings | Country engine | `WaterScoreBenchmarkRegistry.calculate(key, readings)` | readings + key | เลือก engine (fallback → thailand) | ผลลัพธ์ engine | memory | probe: `atlantis` → engineKey `thailand`, คะแนนเท่ากับ thailand | `RUNTIME VERIFIED` |
| T20 | Engine | Parameter grade | `computeSharedBenchmarkBase` | ค่าดิบต่อพารามิเตอร์ | curve ต่อพารามิเตอร์ → 0–100 | `params{}` | memory | probe contribution table | `RUNTIME VERIFIED` |
| T21 | Grade | Weight | `{Thailand,Japan,Who,Eu,UsEpa}BenchmarkWeights` | grade | คูณน้ำหนัก | weighted | memory | น้ำหนักรวม TH 5 / JP 0.88 / WHO 6 / EU 1 / EPA 1 | `RUNTIME VERIFIED` |
| T22 | Weight | Raw aggregate | weighted mean | weighted | Σ(grade×w)/Σw | `rawAggregate` | memory | ผลรวม contribution = raw ทุกแถว | `RUNTIME VERIFIED` |
| T23 | Raw | Classification | `statusOf` / `classifications` | ค่าดิบ | PASS/WARNING/FAIL/CRITICAL | classifications | memory | probe | `RUNTIME VERIFIED` |
| T24 | Classification | Severity protection | `computeCountrySeverityProtection` | raw + classifications | `min(cap, raw − minDeduction)`; cap WARNING 85 / FAIL 75 / CRITICAL 60; deduction 3/6/10 | score หลัง severity | memory | `src/js/score/util/benchmarkMetadata.js:49,63,76-80` + 16 แถว runtime ตรงสูตรทั้งหมด | `RUNTIME VERIFIED` |
| T25 | Severity | Country gate (EU) | `EU-PD-002-chlorine-gate` | chlorine | ถ้า chlorine fail → cap 65 | gateScore | memory | FX-BASE EU: sev 71 → gate 65 → hero 65 | `RUNTIME VERIFIED` |
| T26 | Gate | Hero ceiling | `finalizeBenchmarkMetadata` | score | เพดาน 99 | Hero | `S.displayedScore` | FX-IDEAL: raw 100 → 99 (TH/WHO/EU/EPA) | `RUNTIME VERIFIED` |
| T27 | Readings | Quality V3 | `computeQualityScoreDetail(readings)` | readings เดียวกัน | น้ำหนักเท่ากันทุกพารามิเตอร์ + compliance | Q-V3 score | `S.currentScoreResult` | probe: Q-V3 ไม่เปลี่ยนเมื่อสลับประเทศ 6 ครั้ง | `RUNTIME VERIFIED` |
| T28 | Q-V3 | Publish | `POST /api/cases/:id/score` | body + `Idempotency-Key` | `publishCaseScore` | publication + token | Notion ledger | `api/case-flow-routes.js:575-587` | `SOURCE PROVEN` / `BLOCKED` |
| T29 | Publish | Public report | `GET /api/report/:token` | token | อ่าน publication | report payload | Notion | GET token ปลอม = **404 JSON** | `RUNTIME VERIFIED` (negative path) |
| T30 | Report | หน้าจอลูกค้า | `public-report.js` → `resolveDisplayedScore({publicView:true})` | published score | ใช้ published Q-V3 ไม่ใช่ Hero | ตัวเลขที่ลูกค้าเห็น | — | probe: `publishedScore 92` + `standardKey japan` → 92, `source:"published"`, `engineKey:"quality-v3"` | `RUNTIME VERIFIED` |
| T31 | Report | Score card | `GET /api/public/score-card/:token` | token | render การ์ด | PNG/HTML | — | GET token ปลอม = **404 JSON** | `RUNTIME VERIFIED` (negative path) |
| T32 | Publish | LINE | `executeSendCaseResult` (`services/workflow-service.js`) | case + token | ส่งข้อความ → เขียน `notificationStatus` | ผลส่ง | Notion | ต้องส่งจริง | `BLOCKED — ENVIRONMENT GAP` |
| T33 | LINE | Dashboard | `GET /api/clients` | session | อ่าน `notificationStatus` | ตาราง Dashboard | — | ต้องมี session + ข้อมูลจริง | `BLOCKED — ENVIRONMENT GAP` |
| T34 | Dashboard | Feedback | `GET /api/feedback/:token` / `POST /api/feedback/:token` | token | บันทึกความเห็น | feedback | Notion | GET token ปลอม = 404 JSON; write `BLOCKED` | `RUNTIME VERIFIED` (negative) / `BLOCKED` (write) |

### 2.2 จุดที่ architecture ที่ออกแบบไว้ ≠ execution path จริง

| ประเด็น | ตามที่ออกแบบ | ที่เกิดขึ้นจริง | หลักฐาน |
| --- | --- | --- | --- |
| ตัวกรอง false-zero | ค่า 0 จาก OCR ต้องไม่ไหลเข้าคะแนน | กรองเฉพาะทาง `meterReadings` แต่ `standardMeasurement` รับค่าดิบและมีสิทธิ์เหนือกว่า | DL-05 |
| ผู้ใช้แก้ไขได้ | ค่าที่ช่างแก้คือค่าที่ใช้คำนวณ | `standardMeasurement` ชนะทุกกรณี ทั้งจากฟอร์มและ `draft.fields` | DL-01 (เคส C, C2) |
| การ merge ข้อมูล | merge ระดับ field | มี 2 กลไกที่ไม่เหมือนกัน: `mergeSnapshots` merge ระดับ field แต่ `preferDraft` เลือกทั้งก้อน | DL-07 |
| `/api/*` ที่ไม่รู้จัก | ควรได้ 404/405 | ได้ **200 text/html** (SPA fallback) | DL-11 |

---

## 3. PART 2 — Data Lineage รายพารามิเตอร์

### 3.1 ตาราง lineage: แต่ละ node อ่าน field อะไรจริง

| ข้อมูล | ต้นทาง | เขียนโดย | เก็บที่ | `readingsFromTapData` อ่านลำดับ | Engine อ่าน | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| pH | OCR / ฟอร์ม | ConversionEngine + ฟอร์ม | `standardMeasurement.ph`, `meterReadings.ph` | `avg(std.ph) ?? avg(meter.ph)` | `toFiniteReading(readings.ph)` | `RUNTIME VERIFIED` |
| TDS | OCR / ฟอร์ม / แปลงจาก EC | ConversionEngine (`convertEcToTds`) | เหมือนกัน | `avg(std.tds) ?? avg(meter.tds)` | เหมือนกัน | `RUNTIME VERIFIED` |
| EC | OCR | ConversionEngine | ไม่ถูกเก็บเป็นคีย์คะแนน (แปลงเป็น TDS) | — | ไม่อ่านตรง | `SOURCE PROVEN` |
| Turbidity | OCR / ฟอร์ม | เหมือน pH | เหมือนกัน | `avg(std.turbidity) ?? avg(meter.turbidity)` | เหมือนกัน | `RUNTIME VERIFIED` |
| ORP | OCR / ฟอร์ม | เหมือน pH | เหมือนกัน | `avg(std.orp) ?? avg(meter.orp)` | เหมือนกัน | `RUNTIME VERIFIED` |
| DO | OCR / ฟอร์ม / DO% | `convertDoPercentToMgL` | เหมือนกัน | `avg(std.do) ?? avg(meter.do)` | Thailand/Japan **น้ำหนัก 0**; WHO/EU/EPA อ่าน | `RUNTIME VERIFIED` |
| Chlorine | ชุดทดสอบ | ฟอร์ม + `buildTapSnapshot` (สังเคราะห์) | `standardMeasurement.chlorine`, `chlorineReadings.freeChlorine` | `avg(std.chlorine) ?? avg(chlorineReadings.freeChlorine) ?? avg(chlorineReadings.chlorine)` | ทุก engine + gate EU | `RUNTIME VERIFIED` |
| Temperature | OCR / ฟอร์ม | `convertFahrenheitToCelsius` | เหมือนกัน | ไม่อยู่ใน `readingsFromTapData` (มาทาง `draft.fields`) | มีผลต่อ status ไม่มีน้ำหนักคะแนน | `RUNTIME VERIFIED` |
| country / standard | ผู้ใช้เลือก | `POST /api/cases/:id/score-standard` | `draft.scoreStandardKey` (Notion) + localStorage | — | ใช้เลือก engine | `SOURCE PROVEN` |
| caseId | createCase | API | `job.id` | — | ไม่เกี่ยวคะแนน | `SOURCE PROVEN` |
| notionId | Notion | API | `job.notionId` | — | ใช้จับคู่ active case | `SOURCE PROVEN` |
| scoreStandardKey | ผู้ใช้ | API (ค่า remote ชนะ local ถ้า valid) | draft | — | เลือก engine; ค่าที่ไม่รู้จัก fallback thailand | `RUNTIME VERIFIED` (fallback) |
| Quality V3 | readings เดียวกัน | `computeQualityScoreDetail` | `S.currentScoreResult.score` | — | ใช้ publish/share | `RUNTIME VERIFIED` |
| Hero score | engine ที่เลือก | `resolveDisplayedScore` | `S.displayedScore` | — | แสดงบนหน้าจอ | `RUNTIME VERIFIED` |
| publicationId | publish | `publishCaseScore` | Notion ledger | — | — | `BLOCKED` |
| report token | publish | `publishCaseScore` | Notion | — | ใช้เปิด `/r/{token}` | `BLOCKED` (write) / `RUNTIME VERIFIED` (404 path) |
| notificationStatus | LINE | `workflow-service` | Notion | — | Dashboard อ่าน | `BLOCKED` |

### 3.2 เส้นทางที่พิสูจน์ได้แบบต่อเนื่อง (pH เป็นตัวอย่าง)

```
OCR body.data.ph = 8.9
  → mapOcrDataToMeterReadings  → meterReadings.ph = "8.9"   (ตัวกรอง false-zero ไม่ตัด เพราะ ≠ 0)
  → ConversionEngine           → standardMeasurement.ph = 8.9 (จากค่าดิบ ไม่ผ่านตัวกรอง)
  → ช่างแก้ในฟอร์ม             → meterReadings.ph = "7.2"   (standardMeasurement ไม่ถูกแก้)
  → buildSnapshot × 2 + mergeSnapshots → std.ph = 8.9 ยังอยู่ (absent ≠ clear)
  → readingsFromTapData        → เลือก std ก่อน = 8.9        ← จุดที่ข้อมูลผู้ใช้ถูกทิ้ง
  → grade(8.9)                 → 30 (Thailand)
  → weighted                   → raw 81
  → severity FAIL              → min(75, 81−6) = 75
  → Hero                       → 75   (ค่าที่ควรได้จาก 7.2 คือ 94)
```

---

## 4. PART 3 — Precedence Audit

### 4.1 คำตอบตรงคำถามทั้ง 9 ข้อ

| # | คำถาม | คำตอบ | หลักฐาน |
| --- | --- | --- | --- |
| 1 | มีทั้ง `standardMeasurement.tds` และ `meterReadings.tds` ระบบใช้ตัวไหน | ใช้ **`standardMeasurement`** เสมอ | เคส B: std 138 / meter 92 → scorer ได้ **138** |
| 2 | ใครสร้าง `standardMeasurement` | 2 ผู้เขียน: (ก) `ConversionEngine.toStandardMeasurement` ตอน OCR (ข) `AssessmentSnapshot.buildTapSnapshot` สังเคราะห์ `chlorine` จาก `freeChlorine` ทุกครั้งที่ save | probe chlorine synthesis: input ไม่มี std → output `{chlorine:0.42}` |
| 3 | สร้างเมื่อไหร่ | ตอนประมวลผลภาพ OCR และตอนสร้าง snapshot ทุกครั้งที่บันทึก | `SOURCE PROVEN` + `RUNTIME VERIFIED` |
| 4 | ใคร update | ไม่มีเส้นทางจากการแก้ฟอร์มมาอัปเดต `standardMeasurement.ph/tds/turbidity/orp/do` | เคส C/C2 + R1 |
| 5 | เมื่อ user แก้ `meterReadings` มีการ update `standardMeasurement` ไหม | **ไม่** | R1: หลังแก้ merged std ยังเป็น `ph:8.9` |
| 6 | ถ้าไม่ update scoring ใช้ค่าไหน | ใช้ค่าเก่าใน `standardMeasurement` | R1 ก่อน reload 94 / หลัง reload 75 |
| 7 | หลัง reload ยังใช้ค่าเดิมไหม | ใช่ และแย่กว่าเดิม เพราะ merge ทำให้ค่าเก่ากลับมาแทนที่ค่าใหม่ | R1 `changedByReload: true` |
| 8 | หลัง Case rehydration precedence เปลี่ยนไหม | ลำดับ precedence ไม่เปลี่ยน (std ก่อน meter เสมอ) แต่ **ชุดข้อมูล** เปลี่ยนได้จาก `preferDraft` | P1–P7 + R1 |
| 9 | หลัง save/reload ค่าใน UI กับค่า scoring ตรงกันไหม | **ไม่ตรง** เมื่อมี `standardMeasurement` ค้าง | R1 |

### 4.2 ตาราง precedence

| Field | Source A (ชนะ) | Source B | Precedence | Writer | Reader | เก่าค้างได้? | Runtime Evidence | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ph | `standardMeasurement.ph` | `meterReadings.ph` | A > B > `draft.fields['m-ph']` | ConversionEngine | `readingsFromTapData` | **ได้** | B/C/C2/H/R1 | สูง |
| tds | `standardMeasurement.tds` | `meterReadings.tds` | A > B | ConversionEngine (EC→TDS ด้วย) | เหมือนกัน | **ได้** | B: 138 ชนะ 92 | สูง |
| turbidity | `standardMeasurement.turbidity` | `meterReadings.turbidity` | A > B | ConversionEngine | เหมือนกัน | **ได้** | J: std 0 → hero 99 | สูง |
| orp | `standardMeasurement.orp` | `meterReadings.orp` | A > B | ConversionEngine | เหมือนกัน | ได้ | เคส A–H | กลาง |
| do | `standardMeasurement.do` | `meterReadings.do` | A > B | ConversionEngine (DO%→mg/L) | เหมือนกัน | ได้ | เคส A–H | กลาง (TH/JP น้ำหนัก 0) |
| chlorine | `standardMeasurement.chlorine` | `chlorineReadings.freeChlorine` → `chlorineReadings.chlorine` | A > B > C | ConversionEngine **+ buildTapSnapshot** | เหมือนกัน | **ได้** | N: std 1.9 ชนะ freeChlorine 0.3; R5 ค่าที่ลบกลับมา | สูง |
| temp | `draft.fields['m-temp']` | — | fields เท่านั้น | ฟอร์ม | `readingsFromFieldMap` | — | O | ต่ำ |
| tapData layer vs fields layer | `tapData` | `draft.fields` | tapData ชนะ | — | `mergeReadingLayers(fromTaps, fromFields)` | — | C2: แก้ `m-ph` แล้วยังได้ 8.9 | สูง |
| draft ทั้งก้อน | ผู้ชนะจาก `preferDraft` | ผู้แพ้ถูกทิ้งทั้งก้อน | localEditedAt > assessmentUpdatedAt > revision | `saveActiveJobState` / API | `loadJobsFromApi` | ได้ | P1–P7 | กลาง |
| scoreStandardKey | ค่าจาก API | ค่าจาก localStorage | remote ชนะถ้า valid | `POST score-standard` | `loadJobsFromApi` | ไม่ | `job-state.js:1116-1122` | ต่ำ |

---

## 5. PART 4 — Mutation / State Transition Audit

### 5.1 Mutation ฝั่ง client

| Mutation | Fields Changed | Before | After | Persisted? | Storage | Reload Safe? | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `saveActiveJobState()` | `draft.*` + `draft.localEditedAt` | draft เดิม | draft + timestamp ใหม่ | ใช่ | localStorage + คิว sync | ใช่ | `job-state.js:212-224` `SOURCE PROVEN` |
| `persistJobs()` | `wm-jobs` ทั้งก้อน | — | JSON ของ `JOBS` | ใช่ | localStorage | ใช่ | `job-state.js:533-539` |
| `persistActiveCaseRef(job)` | `wm-active-case-ref` | — | `{id,notionId,date}` | ใช่ | localStorage | ใช่ | `job-state.js:33-46` |
| กรอกฟอร์มมิเตอร์ | `tap.meterReadings.*` | ค่าเดิม | ค่าใหม่ | ใช่ (ผ่าน save) | draft | **ไม่ปลอดภัย** — ถูก `standardMeasurement` ทับตอนคำนวณ | DL-01 |
| OCR สำเร็จ | `tap.meterReadings` (กรอง) + `tap.standardMeasurement` (ไม่กรอง) + `tap.meterImages` | ว่าง | 2 ชุดที่อาจไม่ตรงกัน | ใช่ | draft | ไม่ | `assessment.js:605+`, DL-05 |
| `mergeMeterReadings(existing, detected)` | `meterReadings` | ค่าเดิม | เขียนทับเฉพาะค่าที่ไม่ว่าง | ใช่ | draft | **ลบค่าไม่ได้** (`undefined/null/''` ถูก skip) | `assessment.js:456-459` `SOURCE PROVEN` |
| `buildSnapshot()` | `standardMeasurement.chlorine` | ไม่มี | = `freeChlorine` | ใช่ | Notion + localStorage | สร้างค่า derived ใหม่เอง | `RUNTIME VERIFIED` |
| `mergeSnapshots()` | ทุก reading | 2 ชุด | รวมระดับ field, absent ≠ clear | ใช่ | draft | **ค่าเก่าไม่หาย** | R5/R6 |
| `preferDraft()` | draft ทั้งก้อน | 2 draft | เลือกก้อนเดียว | ใช่ | memory | ทำให้ค่าฝั่งแพ้หาย | P1–P7 |
| `loadJobsFromApi()` | `JOBS` ทั้ง array (`splice`) | jobs เดิม | jobs จาก Notion + manual job ที่ถูกเก็บไว้ | ใช่ | memory + localStorage | ใช่ (มี `preservedManualJobs` + `collectLocalOnlyUnsyncedJobs`) | `job-state.js:1078-1138` |
| เลือกประเทศ | `draft.scoreStandardKey`, `S.comparisonScoreResult`, `S.displayedScore` | engine เดิม | engine ใหม่ | ใช่ (POST) | Notion + localStorage | ใช่ | PART 8 |
| `renderWaterScore()` | `S.scoreVal`, `S.scoreBaseReadings`, `S.currentScoreResult`, `S.displayedScore`, `S.publicScoreView` | — | เขียน state ใหม่ทุกครั้งที่ render | ไม่ | memory | — | `score.js:947-990` |

### 5.2 API mutation endpoint (นับจาก source)

| Endpoint | Auth | Idempotency | Error mapping | Status |
| --- | --- | --- | --- | --- |
| `POST /api/cal/webhook` | signature | dedupe ผ่าน `calBookingId` | — | `SOURCE PROVEN` |
| `POST /api/cases` | `assertAppAuth` | `withIdempotency(bookingIdempotencyKey, TTL)` | `error.statusCode \|\| 502` | `SOURCE PROVEN` |
| `POST /api/cases/:id/score` | `assertAppAuth` | รับ `Idempotency-Key` header → body | `error.statusCode \|\| 502` | `SOURCE PROVEN` |
| `POST /api/cases/:id/score-standard` | `assertAppAuth` | ไม่มี | เหมือนกัน | `SOURCE PROVEN` |
| `POST /api/cases/:id/assessment` | `assertAppAuth` | ไม่มี | เหมือนกัน | `SOURCE PROVEN` |
| `POST /api/cases/:id/start` | `assertAppAuth` | ไม่มี | เหมือนกัน | `SOURCE PROVEN` |
| `POST /api/cases/:id/close` / `cancel` / `feedback` / `send-result` | `assertAppAuth` | ไม่มี | เหมือนกัน | `SOURCE PROVEN` |
| `POST /api/cases/:id/preassessment` | **ไม่มี** `assertAppAuth` (public carve-out) | ไม่มี | เหมือนกัน | `SOURCE PROVEN` |
| `POST /api/test/create-case` | **ไม่มี** `assertAppAuth` — กันด้วย `ENABLE_TEST_API === 'true' \|\| NODE_ENV !== 'production'` เท่านั้น | ไม่มี | เหมือนกัน | `SOURCE PROVEN` / reachability `UNKNOWN` |
| `POST /api/line/webhook` | LINE signature | — | — | `SOURCE PROVEN` |
| `POST /api/drive/images`, `DELETE /api/drive/...`, `POST /api/google-reviews/sync`, `POST /api/feedback/suggest` | ตรวจแล้วมี auth ตามไฟล์ | — | — | `SOURCE PROVEN` |

### 5.3 ตรวจรูปแบบความเสี่ยงที่ระบุไว้

| รูปแบบ | พบหรือไม่ | รายละเอียด | Evidence |
| --- | --- | --- | --- |
| fire-and-forget write | **พบ** | `scheduleAssessmentSync` เขียน Notion แบบไม่บล็อก UI; `assessmentUpdatedAt` ขยับเฉพาะเมื่อ sync สำเร็จ | `SOURCE PROVEN` |
| localStorage-only state | **พบ** | `wm-active-case-ref`, `wm-jobs`, `draft.localEditedAt` (ไม่ส่ง API) | `SOURCE PROVEN` |
| memory-only state | **พบ** | `S.displayedScore`, `S.comparisonScoreResult`, `S.lastReadingsValidation`, `S.scoreBaseReadings` | `RUNTIME VERIFIED` |
| stale derived field | **พบ (รุนแรง)** | `standardMeasurement` ทุกคีย์ | DL-01/02/03 |
| partial persistence | **พบ** | `compactReadings` ตัดค่าที่แปลงเป็นตัวเลขไม่ได้ทิ้งเงียบ ๆ | `RUNTIME VERIFIED` |
| overwrite จาก API response | **พบแบบควบคุมได้** | `JOBS.splice` แล้วเติม manual job คืน + คืน active case | `job-state.js:1130-1155` |
| race condition | **พบและมีการป้องกันแล้ว** | `localEditedAt` ถูกเพิ่มเพื่อแก้ race ระหว่าง edit ที่ยังไม่ sync กับ reload | `job-state.js:216-224` + P4 |

---

## 6. PART 5 — Score Input Truth Audit

### 6.1 กรณีปกติ (ไม่มี `standardMeasurement` ค้าง) — FX-1328 / Thailand

| Parameter | UI | Stored | Selected by scorer | Grade input | Grade | Weight | Final contribution |
| --- | --: | --: | --: | --: | --: | --: | --: |
| ph | 7.79 | 7.79 | 7.79 | 7.79 | 84.30 | 1 | 16.86 |
| tds | 92 | 92 | 92 | 92 | 97.60 | 1 | 19.52 |
| turbidity | 0.12 | 0.12 | 0.12 | 0.12 | 97.60 | 1 | 19.52 |
| orp | 434.1 | 434.1 | 434.1 | 434.1 | 97.17 | 1 | 19.43 |
| chlorine | 0.3 | 0.3 | 0.3 | 0.3 | 100.00 | 1 | 20.00 |
| do | 6.34 | 6.34 | 6.34 | 6.34 | 74.80 | **0** | 0.00 (ตัดออก) |
| **รวม** | | | | | | 5 | **95.33 → raw 95 → Hero 95** |

สรุป: UI = stored = scorer input ทุกตัว → **ไม่มี defect ในเส้นทางนี้** (`RUNTIME VERIFIED`)

### 6.2 กรณีมี `standardMeasurement` ค้าง — ช่างแก้ pH 8.9 → 7.2 (Thailand)

| Parameter | UI (ช่างเห็น) | Stored `meterReadings` | Stored `standardMeasurement` | Selected by scorer | Grade | Weight | Contribution |
| --- | --: | --: | --: | --: | --: | --: | --: |
| **ph** | **7.2** | **7.2** | **8.9** | **8.9** ← | 30.00 | 1 | 6.00 |
| tds | 100 | 100 | 100 | 100 | 100.00 | 1 | 20.00 |
| turbidity | 0.5 | 0.5 | 0.5 | 0.5 | 74.00 | 1 | 14.80 |
| orp | 400 | 400 | 400 | 400 | 100.00 | 1 | 20.00 |
| chlorine | 0.3 | — | 0.3 | 0.3 | 100.00 | 1 | 20.00 |
| do | 7 | 7 | 7 | 7 | 100.00 | 0 | 0.00 |
| **ผลลัพธ์** | ช่างคาด **94** | | | | | | **Hero 75** |

> **RUNTIME DATA-LINEAGE DEFECT** — UI ≠ scorer input
> ค่าที่ช่างเห็นและแก้แล้ว (7.2) ไม่ใช่ค่าที่ engine ใช้ (8.9) ส่วนต่าง Hero = **19 คะแนน**
> ยืนยันด้วย: เคส C (`meterReadings` เท่านั้น), เคส C2 (แก้ทั้ง `meterReadings` และ `draft.fields` ก็ยังแพ้), R1 (ผ่าน save/reload จริง)

---

## 7. PART 6 — Adversarial Data-Lineage Tests (รันผ่าน `resolveScoreReadings(job)` จริง)

| ID | Scenario | `standardMeasurement` | `meterReadings` | scorer ใช้ | Thailand | Japan | Q-V3 | Validation | ผลตัดสิน |
| --- | --- | --: | --: | --: | --: | --: | --: | --- | --- |
| A | ตรงกัน | tds 100 | tds 100 | **100** | 94 | 85 | 93 | VALID | ไม่ต่าง (แยกไม่ได้ว่าใช้ตัวไหน) |
| B | ขัดกัน | tds 138 | tds 92 | **138** | 93 | 85 | 92 | VALID | **std ชนะ** |
| C | OCR ผิด ช่างแก้ | ph 8.9 | ph 7.2 | **8.9** | 75 | 75 | 85 | VALID | **std ชนะ — DEFECT** |
| C2 | แก้ทั้งฟอร์มและ `draft.fields` | ph 8.9 | ph 7.2 + `m-ph`=7.2 | **8.9** | 75 | 75 | 85 | VALID | **std ชนะ — ไม่มีทางแก้จาก UI** |
| D | ไม่มี std เลย | — | ครบ | ค่าจาก meter | 94 | 85 | 93 | VALID | fallback ทำงานถูก |
| D2 | std ขาดเฉพาะ tds | ไม่มี tds | tds 92 | **92** | 94 | 85 | 93 | VALID | fallback ระดับคีย์ทำงานถูก |
| E | `std.tds = null` | null | 92 | **92** | 94 | 85 | 93 | VALID | null ไม่กลายเป็น 0 |
| E2 | ไม่มี tds ที่ไหนเลย | — | — | **undefined** | **null** | **null** | **null** | **PARTIAL** | **missing ≠ 0 พิสูจน์แล้ว** |
| F | `std.tds = ""` | `""` | 92 | **92** | 94 | 85 | 93 | VALID | ปลอดภัยที่ชั้นนี้ |
| F2 | `std.tds = " "` | `" "` | 92 | **92** | 94 | 85 | 93 | VALID | ปลอดภัย**ที่ชั้นนี้** (แต่ดู R7) |
| G | `std.tds = false` | false | 92 | **92** | 94 | 85 | 93 | VALID | ปลอดภัยที่ชั้นนี้ |
| G2 | `std.tds = []` | `[]` | 92 | **92** | 94 | 85 | 93 | VALID | ปลอดภัยที่ชั้นนี้ |
| G3 | `std.tds = [92]` | `[92]` | 92 | **92** | 94 | 85 | 93 | VALID | array ที่มีเลขถูกยอมรับเป็น 92 |
| H | derived ค้างหลังแก้ | tds 138 | tds 92 | **138** | 93 | 85 | 92 | VALID | **เหมือน B — ยืนยันซ้ำ** |
| I | `std.ph = 0` (UI กรองทิ้งแล้ว) | ph 0 | ph 7.2 | **0** | **60** | 60 | 77 | **VALID** | **DEFECT — คะแนนต่ำผิด และ validator บอกว่า VALID** |
| J | `std.turbidity = 0` | turb 0 | turb 0.5 | **0** | **99** | 85 | 97 | VALID | **DEFECT — คะแนนสูงผิด (99) อันตรายกว่าข้อ I** |
| K | multi-tap: tap1 std ph 6 / tap2 meter ph 8 | tap1 = 6 | tap2 = 8 | **6** | 75 | 75 | 87 | VALID | **tap2 ถูกละเลยทั้งค่า** |
| L | multi-tap: std ทั้งสอง (6, 8) | 6 และ 8 | — | **7** (เฉลี่ย) | 94 | 85 | 92 | VALID | เฉลี่ยถูกต้อง |
| M | chlorine จาก `freeChlorine` | ไม่มี chlorine | `freeChlorine` 0.3 | **0.3** | 94 | 85 | 93 | VALID | fallback ถูกต้อง |
| N | `std.chlorine` 1.9 vs `freeChlorine` 0.3 | 1.9 | 0.3 | **1.9** | 80 | **60** | 81 | VALID | **std ชนะ — Japan ตก 25 คะแนน** |
| O | ไม่มี `tapData` มีแต่ `draft.fields` | — | `m-*` ครบ | ค่าจาก fields | 94 | 85 | 93 | VALID | fallback ชั้นสุดท้ายทำงาน |

### 7.1 ตารางการแปลงค่าที่ชั้น persistence (`AssessmentSnapshot.asMeasurementNumber`)

| Input | ผลลัพธ์ | ถูกบันทึกลง storage? | หมายเหตุ |
| --- | --- | --- | --- |
| `" "` | **0** | **ใช่** | **สร้าง false zero** |
| `""` | undefined | ไม่ | ปลอดภัย |
| `"abc"` | undefined | ไม่ | ปลอดภัย |
| `null` | undefined | ไม่ | ปลอดภัย |
| `undefined` | undefined | ไม่ | ปลอดภัย |
| `false` | **0** | **ใช่** | **สร้าง false zero** |
| `true` | **1** | **ใช่** | **สร้างค่าปลอม** |
| `[]` | **0** | **ใช่** | **สร้าง false zero** |
| `[5]` | 5 | ใช่ | ยอมรับ array ชั้นเดียว |
| `{}` | undefined | ไม่ | ปลอดภัย |
| `NaN` / `Infinity` | undefined | ไม่ | ปลอดภัย |
| `"0"` / `0` | 0 | ใช่ | ถูกต้อง (0 ที่ผู้ใช้ตั้งใจ) |
| `"  7.2  "` | 7.2 | ใช่ | trim ถูกต้อง |

### 7.2 Round-trip เต็ม (save → reload) — หลักฐานที่หนักที่สุดของรอบนี้

| ID | Scenario | scorer ก่อน reload | Hero ก่อน | scorer หลัง reload | Hero หลัง | เปลี่ยน? |
| --- | --- | --- | --: | --- | --: | --- |
| R1 | OCR ph 8.9 → ช่างแก้ 7.2 (แก้เฉพาะ `meterReadings`) | ph 7.2 | **94** | ph **8.9** | **75** | **ใช่** |
| R2 | เหมือน R1 แต่อัปเดต `standardMeasurement` ด้วย | ph 7.2 | 94 | ph 7.2 | 94 | ไม่ |
| R3 | ไม่มี `standardMeasurement` เลย | ph 7.2 | 94 | ph 7.2 | 94 | ไม่ |
| R4 | chlorine 0.3 → แก้เป็น 1.9 | cl 1.9 | 80 | cl 1.9 | 80 | ไม่ |
| R5 | ลบ chlorine ออก (`""`) | cl undefined | 79 (Q-V3 null) | cl **1.9 กลับมา** | 80 | **ใช่** |
| R6 | ลบ ph ออกทั้งช่อง (`""`) | ph undefined | **null** | ph **8.9 กลับมา** | 75 | **ใช่** |
| R7 | พิมพ์ `" "` ในช่อง ph | ph undefined | **null** | ph **0** | **60** | **ใช่** |

ข้อสังเกตจาก R2/R3: ปัญหาเกิดเฉพาะเมื่อ **มี `standardMeasurement` อยู่แล้วและไม่ถูกอัปเดตพร้อมการแก้ไข** — เคสที่กรอกมือล้วน (R3) ทำงานถูกต้องสมบูรณ์

---

## 8. PART 7 — Country Engine Trace

### 8.1 สรุปทุก fixture × ทุก engine

| Fixture | Engine | Raw | Severity (worst / cap / หลังหัก) | Country gate | Ceiling 99 | Hero | Q-V3 |
| --- | --- | --: | --- | --- | --- | --: | --: |
| FX-IDEAL | thailand | 100 | PASS / — / 100 | — | ใช้ | **99** | 100 |
| FX-IDEAL | japan | 100 | WARNING / 85 / 85 | — | ไม่ใช้ | **85** | 100 |
| FX-IDEAL | who | 100 | PASS / — / 100 | — | ใช้ | **99** | 100 |
| FX-IDEAL | eu | 100 | PASS / — / 100 | ไม่ทำงาน (cap 65) | ใช้ | **99** | 100 |
| FX-IDEAL | usEpa | 100 | PASS / — / 100 | — | ใช้ | **99** | 100 |
| FX-BASE | thailand | 79 | PASS / — / 79 | — | ไม่ใช้ | **79** | 76 |
| FX-BASE | japan | 79 | WARNING / 85 / **76** | — | ไม่ใช้ | **76** | 76 |
| FX-BASE | who | 76 | FAIL / 75 / **70** | — | ไม่ใช้ | **70** | 76 |
| FX-BASE | eu | 77 | FAIL / 75 / 71 | **ทำงาน → 65** | ไม่ใช้ | **65** | 76 |
| FX-BASE | usEpa | 77 | FAIL / 75 / **71** | — | ไม่ใช้ | **71** | 76 |
| FX-DIFF-TH-SAFE | thailand | 83 | PASS / — / 83 | — | ไม่ใช้ | **83** | 81 |
| FX-DIFF-TH-SAFE | japan | 83 | FAIL / 75 / **75** | — | ไม่ใช้ | **75** | 81 |
| FX-DIFF-TH-SAFE | who | 81 | PASS / — / 81 | — | ไม่ใช้ | **81** | 81 |
| FX-DIFF-TH-SAFE | eu | 82 | PASS / — / 82 | ไม่ทำงาน | ไม่ใช้ | **82** | 81 |
| FX-DIFF-TH-SAFE | usEpa | 79 | PASS / — / 79 | — | ไม่ใช้ | **79** | 81 |
| FX-LOCKED | thailand | 72 | FAIL / 75 / **66** | — | ไม่ใช้ | **66** | 73 |
| FX-LOCKED | japan | 69 | FAIL / 75 / **63** | — | ไม่ใช้ | **63** | 73 |
| FX-LOCKED | who | 73 | CRITICAL / 60 / **60** | — | ไม่ใช้ | **60** | 73 |
| FX-LOCKED | eu | 69 | FAIL / 75 / 63 | ทำงาน (65) | ไม่ใช้ | **63** | 73 |
| FX-LOCKED | usEpa | 67 | CRITICAL / 60 / **57** | — | ไม่ใช้ | **57** | 73 |
| FX-1328 | thailand | 95 | PASS / — / 95 | — | ไม่ใช้ | **95** | 92 |
| FX-1328 | japan | 96 | WARNING / 85 / **85** | — | ไม่ใช้ | **85** | 92 |
| FX-1328 | who | 92 | PASS / — / 92 | — | ไม่ใช้ | **92** | 92 |
| FX-1328 | eu | 94 | PASS / — / 94 | ไม่ทำงาน | ไม่ใช้ | **94** | 92 |
| FX-1328 | usEpa | 94 | PASS / — / 94 | — | ไม่ใช้ | **94** | 92 |

### 8.2 น้ำหนักรายพารามิเตอร์ (อ่านจาก object จริงใน runtime)

| Engine | ph | tds | turbidity | orp | chlorine | do | รวม | DO |
| --- | --: | --: | --: | --: | --: | --: | --: | --- |
| thailand | 1 | 1 | 1 | 1 | 1 | **0** | 5 | **ตัดออก** |
| japan | 0.16 | 0.16 | 0.22 | 0.12 | 0.22 | **0** | 0.88 | **ตัดออก** |
| who | 1 | 1 | 1 | 1 | 1 | 1 | 6 | รวม |
| eu | 0.15 | 0.15 | 0.25 | 0.10 | 0.25 | 0.10 | 1.00 | รวม |
| usEpa | 0.15 | 0.20 | 0.30 | 0.10 | 0.15 | 0.10 | 1.00 | รวม |
| Quality V3 | เท่ากันทุกตัว | | | | | | — | รวม |

### 8.3 ตรวจ invariant

| Invariant | ผล | หลักฐาน |
| --- | --- | --- |
| Thailand ตัด DO | **ผ่าน** | weight `do` = 0, contribution 0 ทุก fixture |
| Japan ตัด DO | **ผ่าน** | weight `do` = 0, contribution 0 ทุก fixture |
| WHO รวม DO | **ผ่าน** | weight 1, contribution 9.47–16.67 |
| EU weights | **ผ่าน** | รวม = 1.00 พอดี |
| EPA weights | **ผ่าน** | รวม = 1.00 พอดี |
| Hero ≤ 99 | **ผ่าน** | FX-IDEAL raw 100 → 99 ทั้ง 4 engine ที่ไม่ติด severity |
| severity = ceiling ไม่ใช่ floor | **ผ่าน** | 16/16 แถวที่ severity ทำงาน Hero < raw เสมอ; ไม่มีแถวใด Hero > raw; สูตร `min(cap, raw − deduction)` ตรงทุกแถว |
| Q-V3 แยกจาก country engine | **ผ่าน** | สลับ engine 6 ครั้ง Q-V3 = 76 คงที่; รัน engine ทั้ง 5 แล้ว Q-V3 ยัง 92 และ readings ไม่ถูก mutate |
| ไม่มี country-specific Case patch | **ผ่าน** | ค่า readings object ไม่เปลี่ยนหลังรันทุก engine (`readingsMutated: false`, object frozen ยังใช้งานได้) |
| น้ำหนักถูก freeze | **ผ่าน** | `sumOfContributions` = `rawAggregate` ทุกแถว (30/30) |

---

## 9. PART 8 — Country Switch Trace

รัน `resolveDisplayedScore()` ตัวจริงตามลำดับ โดยใช้ readings ชุดเดียว (frozen object) FX-BASE

| Step | Before | After | Case ID | Readings same? | Engine changed? | Weight changed? | Hero | Q-V3 | Status |
| --: | --- | --- | --- | --- | --- | --- | --: | --: | --- |
| 1 | (เริ่ม) | thailand | ไม่เปลี่ยน | ใช่ | ใช่ | รวม 5 | **79** | 76 | PASS |
| 2 | thailand | japan | ไม่เปลี่ยน | ใช่ | ใช่ | รวม 0.88 | **76** | 76 | PASS |
| 3 | japan | thailand | ไม่เปลี่ยน | ใช่ | ใช่ | รวม 5 | **79** | 76 | PASS (กลับค่าเดิมเป๊ะ — ไม่มี stale) |
| 4 | thailand | who | ไม่เปลี่ยน | ใช่ | ใช่ | รวม 6 | **70** | 76 | PASS |
| 5 | who | eu | ไม่เปลี่ยน | ใช่ | ใช่ | รวม 1.00 | **65** | 76 | PASS |
| 6 | eu | usEpa | ไม่เปลี่ยน | ใช่ | ใช่ | รวม 1.00 | **71** | 76 | PASS |

| ตรวจเพิ่ม | ผล |
| --- | --- |
| `displayedScore.source` ทุก step | `country-benchmark` (ไม่ใช่ published) |
| `displayedScore` = ค่าจาก engine โดยตรง | ตรงกันทั้ง 6 step |
| Q-V3 ก่อน/หลังทั้งลำดับ | 76 / 76 |
| readings object หลังสลับ 6 ครั้ง | `{"ph":7.85,"tds":175,"turbidity":0.42,"orp":515,"do":5.3,"chlorine":0.7,"temp":25}` เหมือนเดิมทุก byte |
| `standardKey` ที่ไม่รู้จัก (`atlantis`) | fallback → `thailand` เงียบ ๆ คะแนน 79 (DL-15) |

**สรุป PART 8: ผ่านทั้งหมด** — การสลับประเทศไม่แตะข้อมูล ไม่ทำ Q-V3 เสีย ไม่มีคะแนนค้างจาก engine ก่อนหน้า (`RUNTIME VERIFIED`)

---

## 10. PART 9 — Persistence / Rehydration Trace

### 10.1 การเลือก draft ตอน reload (`preferDraft` ตัวจริง)

| ID | Scenario | local | remote | ผู้ชนะ | ค่าที่ใช้ต่อ |
| --- | --- | --: | --: | --- | --: |
| P1 | local มีค่า / remote ว่าง | 7.2 | — | local | 7.2 |
| P2 | remote มีค่า / local ว่าง | — | 7.9 | remote | 7.9 |
| P3 | ว่างทั้งคู่ | — | — | local | — |
| P4 | ทั้งคู่มีค่า, `localEditedAt` ใหม่กว่า | 7.2 | 7.9 | **local** | 7.2 (แก้ race ได้ถูกต้อง) |
| P5 | ทั้งคู่มีค่า, remote `assessmentUpdatedAt` ใหม่กว่า | 7.2 | 7.9 | remote | 7.9 |
| P6 | timestamp เท่ากัน, remote revision สูงกว่า | 7.2 | 7.9 | remote | 7.9 |
| P7 | ไม่มี timestamp/revision เลย | 7.2 | 7.9 | local | 7.2 |

### 10.2 การสูญหายของข้อมูลจากการเลือกทั้งก้อน

| Scenario | ผู้ชนะ | คีย์ที่เหลือ | คีย์ที่หาย | ผลต่อคะแนน |
| --- | --- | --- | --- | --- |
| local มีเฉพาะ `tds:92` / remote มีเฉพาะ `ph:7.9` | local | `["tds"]` | **`["ph"]`** | scorer ได้ tds แต่ไม่มี ph → **Thailand = null (incomplete)** |

เทียบกับ `mergeSnapshots` ที่ merge ระดับ field: input เดียวกันได้ `{ph:7.9, tds:92}` ครบทั้งสองคี่ → **มี 2 กลไก merge ที่ให้ผลต่างกันในระบบเดียว**

### 10.3 การล้างค่า

| การทดสอบ | ผล | สรุป |
| --- | --- | --- |
| `mergeReadingMaps({ph:7.2,tds:92}, {ph:null})` | `{tds:92}` — ลบ ph ได้ | โค้ดรองรับการลบ |
| `buildSnapshot` จาก `{ph:null, tds:92}` | `{tds:92}` — null ถูกตัดออกก่อน | **null ไม่เคยเดินทางไปถึง `mergeReadingMaps`** |
| ผลรวม | ไม่มีเส้นทางลบค่าผ่าน snapshot | สาขา delete-on-null **unreachable** (DL-08) |
| `mergeMeterReadings` กับค่าว่าง | `undefined/null/''` ถูก skip | ลบค่าไม่ได้ที่ชั้น OCR merge ด้วย |

### 10.4 การจัดประเภท state

| ประเภท | ตัวอย่างจริง | ความเสี่ยง |
| --- | --- | --- |
| memory-only | `S.displayedScore`, `S.comparisonScoreResult`, `S.lastReadingsValidation` | หายเมื่อ refresh — คำนวณใหม่ได้ |
| localStorage-only | `wm-active-case-ref`, `draft.localEditedAt`, `wm-jobs` | ต่างเครื่อง/ต่าง browser ไม่เห็นกัน |
| Notion-only | `notificationStatus`, publication ledger, report token | client ไม่มีสำเนา |
| stale | **`standardMeasurement` ทุกคีย์** | **DL-01/02/03** |

### 10.5 สลับ Case A → B → A

| ตรวจ | กลไกที่พบ | Evidence |
| --- | --- | --- |
| `notionId` / `caseId` คงที่ | `findJobByCaseRef` จับคู่ด้วย id, notionId, notionId ที่ตัด `-` | `job-state.js:1139-1151` `SOURCE PROVEN` |
| readings ไม่ปนกันข้าม Case | `resolveScoreReadings` ใช้ `job.draft` เท่านั้น; DOM `#m-*` ถูกตัดออกโดยเจตนา | `score.js:791-805` + comment ในโค้ด |
| active case หลัง cold boot | `restoreActiveCaseFromPersistence()` + ดึงปฏิทินเฉพาะ `in_progress` | `job-state.js:98-112` |
| ต้องรันจริงบน browser หลาย Case | ยังไม่ได้ทำ | `BLOCKED — ENVIRONMENT GAP` (ต้องมี session + Case จริง) |

---

## 11. PART 10 — API Boundary Audit

### 11.1 ผล GET จริงบน production (2026-08-20)

| Endpoint | Method | Auth | Observed | Content-Type | Consumer | Contract | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/clients` | GET | required | **401** `{"code":"UNAUTHENTICATED"}` | json | Dashboard | ถูกต้อง | `RUNTIME VERIFIED` |
| `/api/debug/env` | GET | required | **401** | json | ops | ถูกต้อง | `RUNTIME VERIFIED` |
| `/api/cases` | **GET** (endpoint เป็น POST) | — | **200 + HTML 5,720 bytes** | text/html | — | **ผิด: ควร 404/405** | `RUNTIME VERIFIED` (DL-11) |
| `/api/this-route-does-not-exist` | GET | — | **200 + HTML 5,720 bytes** | text/html | — | **ผิด: ควร 404** | `RUNTIME VERIFIED` (DL-11) |
| `/api/report/rpt-does-not-exist` | GET | public | **404** `{"error":"Report not found"}` | json | หน้ารายงาน | ถูกต้อง | `RUNTIME VERIFIED` |
| `/api/public/score-card/rpt-nope` | GET | public | **404** | json | การ์ด | ถูกต้อง | `RUNTIME VERIFIED` |
| `/api/feedback/nope` | GET | public | **404** | json | feedback | ถูกต้อง | `RUNTIME VERIFIED` |
| `/api/cal/webhook/status` | GET | public | **200** `hasWebhookSecret:true` | json | ops | ถูกต้อง | `RUNTIME VERIFIED` |
| `/api/public/water-check-offer` | GET | public | **200** `{totalSlots:100,used:11,remaining:89}` | json | Framer | ถูกต้อง | `RUNTIME VERIFIED` |
| `/api/ops/readiness` | GET | public | **200** `notion:"ready", lineSend:"ready"` | json | ops | ถูกต้อง | `RUNTIME VERIFIED` |
| `/api/ops/health` | GET | public | **TIMEOUT ที่ 20 วินาที** | — | ops | ตรวจซ้ำได้ | `UNKNOWN` (DL-17) |
| `/r/nope` | GET | public | **404 + HTML** | text/html | ลูกค้า | ถูกต้อง | `RUNTIME VERIFIED` |

### 11.2 สถานะที่ยังทดสอบไม่ได้

| Status | ทดสอบได้? | เหตุผล |
| --- | --- | --- |
| 200 (success path ที่มีข้อมูลจริง) | **ไม่** | ต้องมี session + Case จริง | 
| 400 / 422 | **ไม่** | ต้อง POST body ที่ผิดรูป → เขียน production | 
| 401 | **ได้** | ยืนยันแล้ว 2 endpoint |
| 403 (role ไม่ถูก) | **ไม่** | ต้องมี session ของ role อื่น |
| 404 | **ได้** | ยืนยันแล้ว 4 endpoint |
| 409 (duplicate/idempotency) | **ไม่** | ต้อง POST ซ้ำ |
| 500 / 502 / 503 | **ไม่** | ต้องทำให้ dependency ล้ม |

> ทุกช่องที่ตอบ "ไม่" = `BLOCKED — ENVIRONMENT GAP` ไม่มีการเดา behavior

### 11.3 ความพยายามสร้าง runtime evidence เพิ่มเติมและผลที่ได้

| ความพยายาม | ผล | สรุป |
| --- | --- | --- |
| รัน `scripts/test-p0-security.js` (มีอยู่ใน repo, ทดสอบ auth boundary ด้วย HTTP จริงบน localhost) | ส่วน static ผ่าน 7/7; ส่วน HTTP ล้มที่ `P0 HTTP test server boot — timeout` | 11 assertion เรื่อง 401/404 **ไม่ได้ถูกรัน** |
| boot server ในเครื่องด้วย env ที่ล้าง credential ทั้งหมด (Notion/LINE/Google/OpenAI) เพื่อ probe GET แบบไม่มีทางเขียน production | ล้มเหลว: `Sandbox policy 'workspace_readwrite' is not supported on this system` | **เป็นข้อจำกัดของ environment ที่ใช้ตรวจ ไม่ใช่ข้อบกพร่องของโค้ด** |

ดังนั้นสถานะของ HTTP boundary ในเครื่อง = `BLOCKED — ENVIRONMENT GAP` และ **ไม่นำผล timeout ไปตีความว่าโค้ดผิด**

---

## 12. PART 11 — Authentication / Security Trace

### 12.1 Cal webhook

| Scenario | เส้นทางที่โค้ดกำหนด | ทดสอบแล้ว? | Status |
| --- | --- | --- | --- |
| valid signature | `verifyCalSignature` ผ่าน → adapter → `createCase` | ไม่ (ต้องสร้าง Case) | `BLOCKED — ENVIRONMENT GAP` |
| invalid signature | ปฏิเสธก่อนแตะ Notion | ไม่ (ต้อง POST production) | `SOURCE PROVEN` / `BLOCKED` |
| missing signature | `hasWebhookSecret:true` → ต้องมี header `x-cal-signature-256` | ไม่ | `SOURCE PROVEN` (GET status ยืนยันว่ามี secret) |
| malformed payload | validation ที่ adapter | ไม่ | `SOURCE PROVEN` |
| duplicate booking | dedupe ด้วย `calBookingId` + `withCaseLock` | ไม่ | `SOURCE PROVEN` |

### 12.2 API authentication

| Scenario | Observed / โค้ด | Status |
| --- | --- | --- |
| unauthenticated | `/api/clients` = 401, `/api/debug/env` = 401 | `RUNTIME VERIFIED` |
| missing token (cookie-only session) | session เป็น cookie-only, `/api/auth/me` เป็นตัวตรวจ | `RUNTIME VERIFIED` (static assertion ผ่านในสคริปต์ P0.4) |
| wrong role | ทุก write endpoint ใช้ `assertAppAuth` เหมือนกัน ไม่พบการแยกสิทธิ์ตาม role ใน route layer | `SOURCE PROVEN` |
| expired token | ต้องมี session จริงที่หมดอายุ | `BLOCKED — ENVIRONMENT GAP` |
| public carve-out | `/api/report/:token`, `/api/feedback/:token`, `/api/public/*`, `/api/cases/:id/preassessment`, Cal/LINE webhook | `SOURCE PROVEN` + `RUNTIME VERIFIED` (ไม่ใช่ 401) |
| `POST /api/test/create-case` | **ไม่มี `assertAppAuth`** กันด้วย `ENABLE_TEST_API === 'true' \|\| NODE_ENV !== 'production'` เท่านั้น — ถ้า `NODE_ENV` บน production ไม่ใช่สตริง `'production'` เป๊ะ ๆ route นี้จะสร้าง Case จริงได้โดยไม่ต้อง login | `SOURCE PROVEN`; reachability `UNKNOWN` (พิสูจน์ได้ด้วยการ POST เท่านั้น ซึ่งกฎห้าม) |

---

## 13. PART 12 — Publish Lineage

| ขั้น | เส้นทาง | ตรวจได้จริง? | Evidence |
| --- | --- | --- | --- |
| Hero → Publish | Hero **ไม่ถูก publish**; ค่าที่ publish คือ Quality V3 (`S.currentScoreResult.score`) | ใช่ (อ่านค่า state จริง) | `RUNTIME VERIFIED` |
| Public report ใช้ Published Q-V3 ไม่ใช่ session Hero | `resolveDisplayedScore({publicView:true, publishedScore:92, standardKey:'japan'})` → **92**, `source:"published"`, `engineKey:"quality-v3"` ขณะที่ field view ด้วย readings เดียวกันได้ **76** | ใช่ | `RUNTIME VERIFIED` |
| publication ledger | `publishCaseScore` ต้องมี ledger | ไม่ | `SOURCE PROVEN` / `BLOCKED` |
| report token → `/r/{token}` | token ปลอม → API 404 JSON, หน้า `/r/` 404 HTML | บางส่วน | `RUNTIME VERIFIED` (negative path) |
| score-card | token ปลอม → 404 JSON | บางส่วน | `RUNTIME VERIFIED` (negative path) |
| first publish | — | ไม่ | `BLOCKED` |
| duplicate publish / retry / already published | `Idempotency-Key` header → body (`case-flow-routes.js:579-581`) | ไม่ | `SOURCE PROVEN` / `BLOCKED` |
| null score | `resolveDisplayedScore` กับ `publishedScore: null` บน public view → **แสดง 0 และติดป้าย `source:"published"`** | ใช่ | `RUNTIME VERIFIED` (DL-10) |
| missing ledger | — | ไม่ | `BLOCKED` |
| immutable publication | — | ไม่ | `BLOCKED` |
| PUB-010 | ไม่รันบน production ตามข้อกำหนด | — | `BLOCKED` (โดยเจตนา) |

**หมายเหตุ DL-10:** `Number(null) === 0` และ `Number.isFinite(0) === true` ทำให้เงื่อนไข `publicView && Number.isFinite(Number(publishedScore))` ที่ `score.js:271` เป็นจริง แล้วคืนคะแนน 0 พร้อม `showScore:true` เส้นทางเข้าถึงถูกกันไว้บางส่วน (หน้า `/r/` ไม่ render ถ้าไม่มี `payload.report` และ `/api/public/score-card` ตอบ 404 เมื่อ `waterScore` ไม่ finite) แต่มี call site 3 จุด (`score.js:495`, `:663`, `:1246`) ที่ส่ง `S.currentScoreResult?.score` ซึ่ง**เป็น `null` ได้เมื่อ Q-V3 คำนวณไม่ครบ** จึงจัดเป็นความเสี่ยงที่มีอยู่จริงในสัญญาของฟังก์ชัน ไม่ใช่แค่ทฤษฎี

---

## 14. PART 13 — LINE / Dashboard / Feedback

| Scenario | State ที่โค้ดกำหนด | ตรวจได้จริง? | Status |
| --- | --- | --- | --- |
| publish → notification state | `not_sent` เริ่มต้น | ไม่ | `BLOCKED — ENVIRONMENT GAP` |
| กำลังส่ง | `sending` | ไม่ | `BLOCKED` |
| ส่งสำเร็จ | `sent` | ไม่ | `BLOCKED` |
| ส่งไม่สำเร็จ | `failed` | ไม่ | `BLOCKED` |
| ส่งซ้ำ | `already_sent` | ไม่ | `BLOCKED` |
| `executeSendCaseResult` คืน `ok:true` แม้ส่งไม่สำเร็จหรือถูกข้าม | ผู้เรียกต้องอ่านฟิลด์ `action` ประกอบ ไม่พอที่จะดู `ok` | ไม่ (source) | `SOURCE PROVEN` — ความเสี่ยงที่ caller ตีความผิดว่าสำเร็จ |
| Dashboard อ่าน `notificationStatus` | `GET /api/clients` | ไม่ (401 ไม่มี session) | `BLOCKED` |
| feedback | `GET/POST /api/feedback/:token` | GET token ปลอม = 404 เท่านั้น | `BLOCKED` (write) |

**ยืนยันตามข้อกำหนด:** ไม่ใช้ผล 404 probe เป็นหลักฐานว่า success path ผ่าน — ทุกช่อง success ข้างต้นคง `BLOCKED`

---

## 15. PART 14 — Observability / Failure Detection

| Failure | ควรจับได้? | มี test? | Runtime detection? | Monitoring? | เกิดแบบเงียบได้? |
| --- | --- | --- | --- | --- | --- |
| HTTP contract break (`/api/*` คืน HTML 200) | ใช่ | **ไม่มี** | ไม่ (client เจอ JSON parse error) | ไม่ | **ได้** (DL-11) |
| wrong payload key | ใช่ | บางส่วน (unit) | ไม่ | ไม่ | ได้ |
| stale measurement (`standardMeasurement` ค้าง) | ใช่ | **ไม่มี** | ไม่ — validator ตอบ **VALID** | ไม่ | **ได้ (รุนแรง)** |
| `" "` → 0 ที่ persistence | ใช่ | **ไม่มี** | ไม่ | ไม่ | **ได้** |
| ค่าที่ลบแล้วกลับมา | ใช่ | **ไม่มี** | ไม่ | ไม่ | **ได้** |
| auth failure | ใช่ | มี (`scripts/test-p0-security.js`) แต่ส่วน HTTP ไม่ได้รันในรอบนี้ | 401 จริงบน production | ไม่มี alert | บางส่วน |
| webhook rejection | ใช่ | ไม่พบ test แบบ end-to-end | `logEvent` | ไม่มี alert | ได้ |
| Case persistence failure | ใช่ | ไม่ | `console.warn` ใน catch | ไม่ | **ได้** |
| score mismatch (UI ≠ scorer) | ใช่ | **ไม่มี** | มี `console.log('DISPLAY SCORE PATH', ...)` แต่ไม่มีใครอ่าน | ไม่ | **ได้** |
| publication failure | ใช่ | unit บางส่วน | `error.statusCode \|\| 502` | ไม่ | ได้ |
| LINE failure | ใช่ | unit บางส่วน | `ok:true` ปิดทับ | ไม่ | **ได้** |
| SPA fallback masking API 404 | ใช่ | **ไม่มี** | ไม่ | ไม่ | **ได้** |
| unknown `standardKey` | ใช่ | ไม่ | fallback thailand เงียบ | ไม่ | **ได้** (DL-15) |

### 15.1 โครงสร้างการรัน test

| สิ่งที่ตรวจ | ผล |
| --- | --- |
| `package.json` scripts | มีเพียง `{"start": "node server.js"}` — **ไม่มี `test`** |
| `.github/workflows` | **ไม่มี** |
| `.husky` | **ไม่มี** |
| `.git/hooks` | ว่าง (ไม่มี hook ที่เปิดใช้) |

แปลว่า: test ทุกไฟล์ใน `tests/` ต้องรันด้วยมือทีละไฟล์ ไม่มีอะไรบังคับให้รันก่อน commit/deploy

---

## 16. PART 15 — False Green Audit

### 16.1 ตัวเลขจากรายงาน 09 (258 เคส)

| ตัวชี้วัด | ค่า | วิธีคำนวณ |
| --- | --- | --- |
| ผลรวม | PASS 113 / FAIL 0 / BLOCKED 134 / NOT RUN 11 | จาก `09_FULL_SYSTEM_TEST_RESULTS.json` |
| **Evidence Reuse Rate** | **71%** (80 จาก 113 แถว PASS ใช้ evidence ที่ซ้ำกับแถวอื่น) | นับ evidence string ที่ไม่ unique |
| **หลักฐานชิ้นเดียวรองรับ** | **72 แถว = 64% ของ PASS ทั้งหมด** อ้าง evidence ก้อนเดียว (`unit locks 2026-08-20: case-1328, country-hero-ceiling, displayed-score-country-switch, thailand...`) | นับซ้ำสูงสุด |
| จำนวน evidence string ที่ไม่ซ้ำ | **38** สำหรับ 113 PASS | — |
| PASS ที่มาจาก HTTP/browser probe | 7 | จัดกลุ่มจากข้อความ evidence |
| PASS ที่มาจาก source inspection | 18 | เช่นเดียวกัน |
| PASS ที่มาจากการรัน unit test | 1 (batch เดียวที่ครอบ 72 แถว) | เช่นเดียวกัน |
| **Critical Path Coverage (runtime จริง end-to-end)** | **0%** — ไม่มีเคสใดที่เดินจาก Cal → Case → Notion → publish → LINE ได้จริง | ทุกเคสในเส้นนี้เป็น BLOCKED |
| **Untested Node Count** | **12 จาก 34 transition** (T06, T07, T12, T28, T32, T33 + success path ของ T29/T31/T34 + 400/403/409/503) | จากตาราง PART 1 |
| **False Green Risk** | **สูง** | 64% ของ PASS พึ่งหลักฐานชิ้นเดียว; unit ที่ผ่านไม่ครอบ defect DL-01..DL-07 เลย |

### 16.2 หลักฐานที่ยืนยันว่า unit ผ่าน ≠ ระบบถูก

defect DL-01 ถึง DL-07 ทั้งเจ็ดรายการเกิดในเส้นทางที่ **unit test ชุดที่รองรับ 72 แถว PASS ไม่ได้แตะ** เพราะ test เหล่านั้นป้อน `readings` object เข้า engine ตรง ๆ ไม่ได้เดินผ่าน `resolveScoreReadings(job)` / `buildSnapshot` / `mergeSnapshots` ซึ่งเป็นจุดที่ข้อมูลถูกเลือกและถูกทำให้เก่า

---

## 17. PART 16 — Full Coverage Graph

| Node | tested? | runtime? | unit? | HTTP? | persistent? | customer-visible? | ช่องว่าง |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Website / Framer | ใช่ | ใช่ | — | GET 200 | — | ใช่ | ไม่มี booking จริง |
| Cal.com | บางส่วน | — | — | — | — | ใช่ | `BLOCKED` |
| Cal webhook | บางส่วน | — | — | GET status | — | ไม่ | success path `BLOCKED` |
| Signature verification | source | — | — | — | — | ไม่ | ไม่มี runtime |
| Payload validation | source | — | — | — | — | ไม่ | ไม่มี runtime |
| Campaign mapping | source | — | — | — | — | ใช่ | ไม่มี runtime |
| `createCase()` | source | — | — | — | Notion | ใช่ | **`BLOCKED`** |
| Notion write | ไม่ | — | — | — | Notion | ใช่ | **`BLOCKED`** |
| Case list (`/api/clients`) | ใช่ | 401 | — | ใช่ | — | ใช่ | success path `BLOCKED` |
| Case rehydration | ใช่ | **ใช่** | บางส่วน | — | localStorage | ใช่ | ไม่ได้รันบน browser จริง |
| `preferDraft` | ใช่ | **ใช่** | — | — | — | ใช่ | — |
| Measurement input | ใช่ | **ใช่** | ใช่ | — | draft | ใช่ | ไม่มี DOM จริง |
| OCR endpoint | ไม่ | — | — | — | — | ไม่ | **`BLOCKED`** (ต้อง auth + ภาพ) |
| `mapOcrDataToMeterReadings` | source | — | — | — | draft | ใช่ | ไม่ได้รันตรง |
| ConversionEngine | บางส่วน | exports | ใช่ | — | draft | ใช่ | ยังไม่ trace ทุก conversion |
| `buildSnapshot` | ใช่ | **ใช่** | ใช่ | — | Notion+LS | ใช่ | — |
| `mergeSnapshots` | ใช่ | **ใช่** | ใช่ | — | draft | ใช่ | — |
| `resolveScoreReadings` | ใช่ | **ใช่ (21 เคส)** | — | — | — | ใช่ | — |
| MeasurementValidator | ใช่ | **ใช่** | ใช่ | — | — | ใช่ | ไม่จับ false-zero |
| Country engines × 5 | ใช่ | **ใช่ (25 ชุด)** | ใช่ | — | — | ใช่ | — |
| Severity / gate / ceiling | ใช่ | **ใช่ (16 แถว)** | ใช่ | — | — | ใช่ | — |
| Quality V3 | ใช่ | **ใช่** | ใช่ | — | Notion | ใช่ | — |
| `resolveDisplayedScore` | ใช่ | **ใช่** | ใช่ | — | — | ใช่ | — |
| Publish | ไม่ | — | บางส่วน | — | Notion | ใช่ | **`BLOCKED`** |
| Publication ledger | ไม่ | — | บางส่วน | — | Notion | ไม่ | **`BLOCKED`** |
| Report token | บางส่วน | 404 | — | ใช่ | Notion | ใช่ | success `BLOCKED` |
| Public report page | บางส่วน | **ใช่** (`publicView`) | — | 404 | — | ใช่ | ไม่มี token จริง |
| Score card | บางส่วน | — | — | 404 | — | ใช่ | success `BLOCKED` |
| LINE send | ไม่ | — | บางส่วน | — | Notion | ใช่ | **`BLOCKED`** |
| `notificationStatus` | ไม่ | — | — | — | Notion | ใช่ | **`BLOCKED`** |
| Dashboard | ไม่ | — | — | 401 | — | ไม่ | **`BLOCKED`** |
| Feedback | บางส่วน | — | — | 404 | Notion | ใช่ | success `BLOCKED` |

### 17.1 Node ที่ไม่มีหลักฐาน runtime เลย

`createCase` · Notion write · OCR endpoint · publish · publication ledger · LINE send · `notificationStatus` · Dashboard · feedback write · signature verification · payload validation · campaign mapping

---

## 18. PART 17 — Final QA Verdict

| Layer | Coverage | Runtime | Unit | Persistence | Customer-visible | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Website | GET 200 หน้าแรก | มี | — | — | ใช่ | `PARTIALLY VERIFIED` |
| Cal | ไม่มี booking จริง | ไม่มี | — | — | ใช่ | `BLOCKED — ENVIRONMENT GAP` |
| Webhook | GET status เท่านั้น | บางส่วน | — | — | ไม่ | `BLOCKED — ENVIRONMENT GAP` |
| Case | rehydration/merge รันจริง แต่ create/write ไม่ได้ | บางส่วน | บางส่วน | localStorage ยืนยันแล้ว / Notion ไม่ได้ | ใช่ | `PARTIALLY VERIFIED` |
| OCR | endpoint ไม่ได้ยิง | ไม่มี | บางส่วน | draft | ไม่ | `BLOCKED — ENVIRONMENT GAP` |
| Measurement | 21 เคส adversarial + 7 round-trip | **มี** | มี | **ยืนยันแล้ว** | ใช่ | **`NOT READY`** (DL-01..DL-05) |
| Score | 25 ชุด + severity 16 แถว ตรงสูตรทุกแถว | **มี** | มี | — | ใช่ | `PRODUCTION VERIFIED` (คณิตศาสตร์) |
| Country | สลับ 6 ครั้ง readings/Q-V3 ไม่เปลี่ยน | **มี** | มี | remote ชนะ local | ใช่ | `PRODUCTION VERIFIED` |
| Publish | เฉพาะ negative path | บางส่วน | บางส่วน | ไม่ได้ | ใช่ | `BLOCKED — ENVIRONMENT GAP` |
| Report | 404 path + `publicView` logic | บางส่วน | — | ไม่ได้ | ใช่ | `PARTIALLY VERIFIED` |
| Card | 404 path | บางส่วน | — | ไม่ได้ | ใช่ | `BLOCKED — ENVIRONMENT GAP` |
| LINE | ไม่มีเลย | ไม่มี | บางส่วน | ไม่ได้ | ใช่ | `BLOCKED — ENVIRONMENT GAP` |
| Dashboard | 401 เท่านั้น | ไม่มี | — | ไม่ได้ | ไม่ | `BLOCKED — ENVIRONMENT GAP` |
| Feedback | 404 เท่านั้น | ไม่มี | — | ไม่ได้ | ใช่ | `BLOCKED — ENVIRONMENT GAP` |

### 18.1 คำตัดสินรวม

> # NOT READY

**เหตุผลที่ตรวจสอบได้:**

1. **มี data-lineage defect ที่ยืนยันด้วย runtime และมองเห็นได้จากลูกค้า** — ค่าที่ช่างแก้ไม่ใช่ค่าที่ระบบคำนวณ (DL-01) และคะแนนเปลี่ยนเองหลัง reload จาก 94 เป็น 75 โดยไม่มีใครแก้ข้อมูล (DL-02) ทั้งสองข้อรันผ่านฟังก์ชัน production จริง
2. **ค่าที่ผิดลบออกไม่ได้** (DL-03) — เมื่อ OCR อ่านผิด ช่างไม่มีวิธีใดใน UI ที่จะทำให้ระบบเลิกใช้ค่านั้น
3. **ระบบตรวจสอบภายในไม่จับ defect เหล่านี้** — `MeasurementValidator` ตอบ `VALID` ในเคส I ที่ pH = 0 และในทุกเคสที่ `standardMeasurement` ค้าง
4. **Critical path ยังไม่เคยถูก execute จริงเลย 0%** — Cal → Case → Notion → publish → LINE ทุกโหนดเป็น `BLOCKED — ENVIRONMENT GAP` เพราะไม่มี staging
5. **64% ของผลลัพธ์ PASS เดิมพึ่งหลักฐานชิ้นเดียว** และไม่มี `npm test`/CI/git hook ที่จะทำให้หลักฐานนั้นถูกสร้างซ้ำโดยอัตโนมัติ

**สิ่งที่ผ่านจริงและควรบันทึกไว้:** คณิตศาสตร์ของ engine ทั้ง 5 ประเทศ + Quality V3, กลไก severity (ceiling ไม่ใช่ floor), เพดาน 99, การตัด DO ของไทย/ญี่ปุ่น, การแยก Q-V3 ออกจาก country engine, การสลับประเทศที่ไม่ทำข้อมูลเสีย และการที่ public report ใช้ published Quality V3 ไม่ใช่ session Hero — ทั้งหมด `RUNTIME VERIFIED`

### 18.2 จุดที่ระบบพังได้โดย QA ปัจจุบันไม่รู้ตัว

| จุด | ทำไม QA ไม่เห็น |
| --- | --- |
| `standardMeasurement` ค้างหลังแก้ไข | unit test ป้อน readings เข้า engine ตรง ๆ ไม่ผ่าน `resolveScoreReadings` |
| `" "` → 0 ที่ persistence | ไม่มี test ครอบ `asMeasurementNumber` |
| ค่าที่ลบแล้วกลับมา | ไม่มี test ครอบ round-trip `buildSnapshot` → `mergeSnapshots` |
| turbidity 0 → Hero 99 | ไม่มี test ที่ตรวจ "คะแนนสูงผิด" มีแต่ตรวจคะแนนต่ำ |
| multi-tap ที่ผสม std/meter | test มีแต่ tap เดียว |
| `/api/*` คืน HTML 200 | ไม่มี test contract ของ API |
| `standardKey` ที่ไม่รู้จัก | fallback เงียบ ไม่มี log ไม่มี test |
| LINE `ok:true` เมื่อส่งไม่สำเร็จ | ไม่มี staging ให้ยิง |

---

## 19. ทะเบียนข้อค้นพบ (Findings Registry)

| ID | Layer | Scenario | Evidence | Observed | Expected | Risk | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DL-01 | Measurement / Score | `standardMeasurement.ph` 8.9 ค้าง ขณะ `meterReadings.ph` = 7.2 | `RUNTIME VERIFIED` — เคส C/C2/B/H ผ่าน `resolveScoreReadings` | scorer ใช้ 8.9 → Thailand 75 | ใช้ค่าที่ผู้ใช้แก้ล่าสุด → 94 | **สูง** | **OPEN** |
| DL-02 | Persistence / Score | save → reload หลังแก้ค่า | `RUNTIME VERIFIED` — R1 round-trip เต็ม | ก่อน reload 94 หลัง reload 75 | คะแนนคงที่ | **สูง** | **OPEN** |
| DL-03 | Persistence | ลบค่า ph / chlorine ทิ้ง | `RUNTIME VERIFIED` — R5, R6 | ค่าเก่ากลับมาหลัง reload (8.9 / 1.9) | ค่าถูกลบจริง | **สูง** | **OPEN** |
| DL-04 | Persistence | พิมพ์ `" "` ในช่อง ph | `RUNTIME VERIFIED` — R7 + `asMeasurementNumber(' ')` | บันทึก `ph: 0` → Thailand 60 | ถือเป็นค่าว่าง | **สูง** | **OPEN** |
| DL-05 | Measurement | `standardMeasurement` มีค่า 0 ที่ UI กรองทิ้ง | `RUNTIME VERIFIED` — เคส I, J | ph 0 → 60; turbidity 0 → **99** | ไม่ใช้ค่า 0 ที่ถูกกรอง | **สูง** | **OPEN** |
| DL-06 | Measurement | tap1 มี std, tap2 มีแต่ meter | `RUNTIME VERIFIED` — เคส K | ใช้เฉพาะ tap1 (ph 6) | เฉลี่ยทั้งสอง tap | กลาง | **OPEN** |
| DL-07 | Persistence | local มีเฉพาะ tds / remote มีเฉพาะ ph | `RUNTIME VERIFIED` — probe data-loss | ph หายทั้งค่า → score incomplete | merge ระดับ field เหมือน `mergeSnapshots` | กลาง | **OPEN** |
| DL-08 | Persistence | `mergeReadingMaps` มีสาขา delete-on-null | `RUNTIME VERIFIED` — clear attempt | `compactReadings` ตัด null ก่อน สาขานี้ไม่ถูกใช้ | มีเส้นทางลบค่าได้จริง | กลาง | **OPEN** |
| DL-09 | Persistence | `false` / `true` / `[]` ผ่าน `asMeasurementNumber` | `RUNTIME VERIFIED` | ได้ 0 / 1 / 0 และถูกบันทึก | ปฏิเสธทั้งหมด | กลาง | **OPEN** |
| DL-10 | Report | `publicView:true` + `publishedScore:null` | `RUNTIME VERIFIED` — `resolveDisplayedScore` | คืน 0 พร้อม `source:"published"` | ไม่แสดงคะแนน | กลาง | **OPEN** |
| DL-11 | API | GET `/api/cases`, GET `/api/this-route-does-not-exist` | `RUNTIME VERIFIED` — production GET | 200 + HTML 5,720 bytes | 404 / 405 JSON | กลาง | **OPEN** |
| DL-12 | Security | `POST /api/test/create-case` | `SOURCE PROVEN`; reachability `UNKNOWN` | ไม่มี `assertAppAuth` กันด้วย env เท่านั้น | ต้องมี auth หรือถอดออกจาก production build | กลาง | **OPEN** |
| DL-13 | Persistence | `buildTapSnapshot` สังเคราะห์ `standardMeasurement.chlorine` | `RUNTIME VERIFIED` | std มี 2 ผู้เขียน | ผู้เขียนเดียวที่ระบุชัด | ต่ำ–กลาง | **OPEN** |
| DL-14 | Process | นับ evidence ในรายงาน 09 | `RUNTIME VERIFIED` — คำนวณจากไฟล์ผลจริง | 72/113 PASS (64%) ใช้หลักฐานชิ้นเดียว; ไม่มี `npm test`/CI/hook | หลักฐานกระจายและรันซ้ำได้อัตโนมัติ | **สูง** | **OPEN** |
| DL-15 | Score | `standardKey` = `atlantis` | `RUNTIME VERIFIED` | fallback → thailand เงียบ ๆ | log/แจ้งเตือนค่าที่ไม่รู้จัก | ต่ำ | **OPEN** |
| DL-16 | LINE | `executeSendCaseResult` เมื่อส่งไม่สำเร็จ/ถูกข้าม | `SOURCE PROVEN` | คืน `ok:true` | สะท้อนผลจริงใน `ok` | กลาง | **OPEN** |
| DL-17 | Ops | GET `/api/ops/health` | `UNKNOWN` | timeout ที่ 20 วินาที ขณะ `/api/ops/readiness` ตอบ 200 | ตอบภายในไม่กี่วินาที | ต่ำ | ต้องตรวจซ้ำ |

---

## 20. ขอบเขตที่รายงานนี้ไม่ครอบคลุม

| หัวข้อ | เหตุผล |
| --- | --- |
| Cal → Case → Notion → publish → LINE แบบ end-to-end | ไม่มี staging; กฎห้ามเขียน production |
| 400 / 403 / 409 / 422 / 500 / 503 | ต้อง POST หรือทำให้ dependency ล้ม |
| พฤติกรรมบน browser จริง (DOM, หลาย Case, หลายแท็บ) | ต้องมี session และ Case จริง |
| OCR accuracy | ต้องยิง endpoint ที่ต้อง auth พร้อมภาพจริง |
| ความถูกต้องของค่า benchmark เทียบมาตรฐานจริง | ไม่อยู่ในขอบเขต data-lineage |

ไม่มีการแก้ source code, test, expected value หรือ production data ในการตรวจครั้งนี้ ไม่มีการ deploy ไม่มีการสร้าง Case ไม่มีการ publish และไม่มีการส่ง LINE
