# 11 — Deep Runtime QA: การพิสูจน์เส้นทางข้อมูลจริงตั้งแต่ต้นจนจบ

| หัวข้อ | รายละเอียด |
| --- | --- |
| วันที่ตรวจ | 2026-08-20 |
| ผู้ตรวจ | QA / System Test (AI-assisted deep trace) |
| ขอบเขต | Website → Cal.com → Webhook → createCase → Notion → Rehydration → Measurement → OCR → Validation → Score Engine → Country Benchmark → Quality V3 → Hero → Publish → Public Report → Score Card → LINE → Dashboard |
| Production SHA (ขณะตรวจ) | `c0eac4e896d840a358c26193ced84a00420ede1e` (`GET /api/ops/health`) |
| การแก้ไขระบบ | **ไม่มี** — ไม่แก้ production code / scoring source / test code / expected values |
| การเขียนข้อมูล production | **ไม่มี** — ใช้ HTTP `GET` เท่านั้น ไม่มี `POST` ใด ๆ ไปยัง production |
| Staging | **ไม่มี** — ทุกเส้นทางที่ต้องเขียนข้อมูลถูกระบุว่า `BLOCKED — ENVIRONMENT GAP` |
| เอกสารก่อนหน้า | `08_MASTER_TEST_CASE_MATRIX.md` (258 cases), `09_FULL_SYSTEM_TEST_REPORT.md`, `10_DEEP_QA_EXECUTION_TRACE.md` |

---

## 0. ระดับหลักฐาน (Evidence Level) ที่ใช้ในเอกสารนี้

เอกสารนี้ **ไม่ใช้คำว่า PASS** ถ้าไม่มีหลักฐานที่ตรงกับชั้นนั้นจริง คำที่ใช้มีความหมายตายตัวดังนี้

| ระดับ | ความหมาย | ตัวอย่างหลักฐานที่ยอมรับ |
| --- | --- | --- |
| `RUNTIME VERIFIED` | **รันโค้ดจริง** ของ production module ในรอบตรวจนี้ และเห็นค่าที่ออกมาทุกขั้น | รัน `WaterScoreBenchmarkRegistry.calculate()` แล้วอ่าน `rawAggregate` / `severityProtection` / `ceiling` ออกมาเป็นตัวเลข |
| `SOURCE PROVEN` | เส้นทางเป็น deterministic expression เดียวที่อ่านจาก source ได้ครบ ไม่มี branch ซ่อน (พิสูจน์ได้ทางตรรกะ แต่ยังไม่ได้รันใน browser จริง) | `avgKey(standardRows,'ph') ?? avgKey(meterRows,'ph')` — precedence คงที่แน่นอน |
| `UNIT ONLY` | มี unit test ครอบ แต่ **ไม่เคยวิ่งผ่าน runtime จริง** ของชั้นนั้น | `tests/score/*.test.js` ที่รันใน vm sandbox |
| `BLOCKED` | ต้องเขียนข้อมูล / ต้องมี browser / ต้องมี Staging → ตรวจไม่ได้ในกฎปัจจุบัน | `POST /api/cases`, publish, ส่ง LINE |
| `UNKNOWN` | ไม่มีทั้ง test และ evidence ใด ๆ | — |

**หมายเหตุสำคัญ:** `UNIT ONLY` ไม่ถูกนับเป็น runtime evidence ตามกฎข้อ 9 ของงานนี้

---

# PART 1 — Runtime Trace Map

ตารางหลัก: ทุก node ระบุ input, ฟังก์ชันจริง, output, field ที่ถูกอ่าน/สร้าง/แปลง/persist, fallback, silent coercion และวิธีจัดการ error

| # | Node | Input (มาจากไหน / field ที่อ่าน) | Function / API (ไฟล์:บรรทัด) | Output (field ที่สร้าง / แปลง) | Persistence & Source of Truth | Fallback / Silent coercion | Error handling | Environment | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Website (Framer) | ผู้ใช้กรอกในฟอร์ม Framer / กดปุ่ม CTA | หน้า Framer เรียก `GET /api/public/water-check-offer` เพื่ออ่านโควตา แล้วส่งผู้ใช้ไป Cal.com | `totalSlots`, `used`, `remaining` | ไม่ persist (อ่านอย่างเดียว) | ถ้า API ล่ม หน้าเว็บยังแสดงปุ่มได้ (ฝั่ง Framer) | ฝั่ง client จัดการเอง | Production (READ-ONLY) | `RUNTIME VERIFIED` — probe: `200 {"ok":true,"totalSlots":100,"used":11,"remaining":89}` |
| 2 | Cal.com booking | ผู้ใช้กรอก name / email / phone / address + เลือก slot บน Cal.com | ระบบภายนอก (Cal.com) | booking payload: `uid`, `startTime`, `endTime`, `attendees[]`, `responses`, `eventType` | Cal.com เป็น SoT ชั่วคราวจนกว่า webhook จะยิง | — | ถ้า Cal.com ไม่ยิง webhook → ไม่มี Case (เงียบสนิท) | External | `BLOCKED` — ไม่สร้าง booking จริงตามกฎข้อ 4 |
| 3 | Webhook receive | HTTP `POST /api/cal/webhook` + header `x-cal-signature-256` | `api/cal-routes.js` | ตรวจลายเซ็นก่อน parse | ยังไม่ persist | — | ลายเซ็นผิด/ไม่มี → ปฏิเสธก่อนแตะข้อมูล | Production | `RUNTIME VERIFIED (config)` — `GET /api/cal/webhook/status` → `hasWebhookSecret: true`, `signatureHeader: "x-cal-signature-256"`, `mode: "booking_created_active"` / `BLOCKED (runtime reject path)` — ต้อง POST จึงพิสูจน์ 401 ได้ |
| 4 | Signature verification | raw body + `CAL_WEBHOOK_SECRET` | `services/cal-webhook.js` → `verifyCalSignature()` | boolean | — | ถ้า secret ว่าง = โหมด dev (ปัจจุบัน production มี secret) | ปฏิเสธคำขอ | Production | `SOURCE PROVEN` + `RUNTIME VERIFIED (config)` |
| 5 | Payload validation | `triggerEvent`, `payload.uid`, `attendees[0]` | `services/cal-booking-adapter.js` | ผ่าน/ไม่ผ่าน | — | เฉพาะ `BOOKING_CREATED` ที่สร้าง Case; event อื่น ack แล้วจบ | ไม่ผ่าน → ตอบ ack ไม่สร้าง Case | Production | `SOURCE PROVEN`, `UNIT ONLY` |
| 6 | Campaign / Product mapping | `eventType.slug` | `services/cal-offer-mapping.js` | `campaignOffer` | เขียนลง Notion ต่อ | ถ้า map ไม่ได้ → offer ว่าง → LINE จะจัดเป็น `PAID_ASSESSMENT` (`services/line-result-resolver.js:45-53`) | ไม่ throw | Production | `SOURCE PROVEN` |
| 7 | `createCase()` | ผลจาก adapter | `services/case-creation-service.js` | สร้าง `notificationStatus: 'not_sent'`, `feedbackStatus: 'not_sent'` (บรรทัด 68-69) | **Notion = Source of Truth** | — | error → โยนขึ้นไปที่ route | Production | `BLOCKED` — สร้าง Case จริงไม่ได้ |
| 8 | Notion persistence | property map | `services/notion/mapper.js` | `notionId` (page id), `calBookingId` | Notion page = persistence layer, `customerId` = business id | `notificationStatus`/`feedbackStatus` อ่านไม่ได้ → default `'not_sent'` (mapper.js:319, 331) — เป็น safe default | Notion ล่ม → throw ขึ้นไป | Production | `BLOCKED` |
| 9 | Case rehydration | `GET /api/clients` | `src/js/job-state.js` → `loadJobsFromApi()` | เขียนทับ array `JOBS`, เก็บ `wm-active-case-ref` ใน localStorage | API + Notion เป็น SoT; `JOBS` เป็น cache ใน memory | ถ้า API ล่ม → คืน `false` → มี branch ที่ทำให้ dashboard ใช้ mock CSV | `try/catch` + log | Production/Browser | `UNIT ONLY` (`tests/case-persistence-rehydration.test.js`) — runtime `BLOCKED` |
| 10 | Measurement input (ฟอร์ม) | ผู้ใช้พิมพ์ในช่อง `m-ph`, `m-tds`, `m-turb`, `m-orp`, `m-do`, `m-free-cl`, `m-temp` | `src/js/flows/assessment.js:1461,1480` → `readMeterReadingFields()` → `mergeMeterReadings()` | เขียนเข้า **`tap.meterReadings` เท่านั้น** | `tap.meterReadings` | ไม่มีการเขียนกลับเข้า `standardMeasurement` | — | Browser | `SOURCE PROVEN` (call site เดียว) |
| 11 | OCR | รูปมิเตอร์ → `POST /api/ocr/read-meter` | `src/js/flows/assessment.js:667-748` → `detectMeterReadingsFromImage()` | 2 สาย: `readings` (map + filter) และ `rawMeasurement` = `freezeMeasurement(body.data)` **ไม่กรอง** (บรรทัด 739) | `tap.rawMeasurement` (immutable evidence) | OCR ล่ม → คืน `{readings:{}, rawMeasurement:{}}` ไม่โยน error (`catch` บรรทัด 749-768) | บาง error code โยนต่อ (OCR_OFFLINE/TIMEOUT) ที่เหลือกลืน | Browser + Production API | `RUNTIME VERIFIED` — `GET /api/ocr/read-meter` → `405 METHOD_NOT_ALLOWED`; เส้น OCR จริง `BLOCKED` |
| 12 | OCR → form mapping | `body.data` | `mapOcrDataToMeterReadings()` (assessment.js:475-526) | `tap.meterReadings` (ค่าที่ **ผู้ใช้เห็นบนจอ**) | `tap.meterReadings` | **false-zero filter** (บรรทัด 511): ถ้า `Number(value)===0` และ key เป็น `ph`/`temp`/`turbidity` → **ทิ้งค่า** | ทิ้งเงียบ (log ลง console เท่านั้น) | Browser | `SOURCE PROVEN` |
| 13 | Conversion (Layer 2) | `tap.rawMeasurement` (ไม่ผ่าน filter ข้อ 12) | `src/js/conversion/engine.js` → `toStandardMeasurement()` | `tap.standardMeasurement` + `applied[]` + `missing[]` + `rawSnapshot` | `tap.standardMeasurement` | `ec → tds × 0.5`, `°F → °C`; `do_percent` **ไม่แปลง** แต่บันทึกเหตุผลไว้; `toFiniteNumber(' ') === 0`, `toFiniteNumber([]) === 0` | ไม่ throw | Browser | `RUNTIME VERIFIED` (รัน engine.js จริง — ดู PART 4) |
| 14 | Score input assembly | `tap.standardMeasurement` (ลำดับ 1) → `tap.meterReadings` (ลำดับ 2) → `draft.fields` (ลำดับ 3) | `src/js/flows/score.js:718-742` `readingsFromTapData()` + `:744-759` `mergeReadingLayers()` + `:799-805` `resolveScoreReadingsPresent()` | object readings ที่จะเข้า engine | ไม่ persist (คำนวณสดทุกครั้ง) | **`standardMeasurement` ชนะ `meterReadings` เสมอ** ผ่าน `??` | — | Browser | `RUNTIME VERIFIED` — รัน `readingsFromTapData()` จริง (ดู PART 4 / RUNTIME-01) |
| 15 | Validation | readings จากข้อ 14 | `src/js/score/validation/measurementValidator.js` + `score.js:878-903` `resolveScoreReadings()` | ลบ key ที่เป็น `IMPLAUSIBLE`/`INVALID_TYPE` เท่านั้น | `S.lastReadingsValidation`, `S.lastReadingsPresent` (memory) | ค่าที่อยู่ในช่วง plausible **ผ่านทั้งหมด** รวม `ph = 0` (min = 0) | ไม่ throw | Browser | `RUNTIME VERIFIED` (ดู PART 5) |
| 16 | Quality V3 | readings | `computeQualityScoreDetail()` (`computeQualityScoreV2.js`) | `params{6}` → ค่าเฉลี่ยแบบ **flat weight = 1 ทุกตัว** → `score` | ค่าที่ publish ใช้ | ขาด param ที่จำเป็น → `incomplete: true`, `score: null` (ไม่ใช่ 0) | — | Browser/Node | `RUNTIME VERIFIED` (PART 6) |
| 17 | Country Benchmark | readings + `standardKey` | `WaterScoreBenchmarkRegistry.calculate(key, readings)` | `rawAggregate` → `severityProtection` → `countryGate` (EU) → `ceiling` → `score` | ไม่ persist (Hero คำนวณสด) | key ที่ไม่รู้จัก → **fallback ไป thailand เงียบ ๆ** | param หลักขาด → `incomplete` | Browser/Node | `RUNTIME VERIFIED` (PART 6, 7, 8) |
| 18 | Hero score (แสดงผล) | ผล engine ที่เลือก | `score.js:265-293` `resolveDisplayedScore()` | ตัวเลขบนจอ | ไม่ persist | `publicView && Number.isFinite(publishedScore)` → ใช้ **Published Quality V3**; ที่เหลือใช้ country benchmark | — | Browser | `SOURCE PROVEN` |
| 19 | Publication | `POST /api/cases/:id/score` + `{score, intent, idempotencyKey}` | `services/score-publication-service.js:191-234` `createOrReusePublication()` | `publicationId`, `publicReportToken`, `job.result.waterScore` | **Notion publication ledger = SoT ของค่าที่เผยแพร่** | ไม่มี ledger → `503 LEDGER_REQUIRED`; ซ้ำ idempotencyKey → คืนรายการเดิม (`reused: true`) | score นอก 0-100 → `400` | Production | `BLOCKED` |
| 20 | Public report | `GET /r/:token` → `GET /api/report/:token` | `api/public-routes.js` | HTML + JSON ของรายงาน | อ่านจาก Notion ผ่าน token | token ไม่พบ → `404` | — | Production | `RUNTIME VERIFIED (negative path)` — `/api/report/rpt-zzzz` → `404 {"ok":false,"error":"Report not found"}`; `/r/fake-token-qa` → `404` HTML |
| 21 | Score card | `GET /api/public/score-card/:token` | `api/public-routes.js:98-110` + `services/score-share-card.js:645` `cardOptionsFromJob()` | PNG | — | **ก่อน render มี guard**: `!Number.isFinite(Number(job.result?.waterScore))` → `404 "Score not published"` (บรรทัด 105) | — | Production | `RUNTIME VERIFIED` — token ปลอม → `404`; `/demo` → `200 image/png` |
| 22 | LINE notification | `POST /api/cases/:id/notify-result` | `services/workflow-service.js:237-354` `executeSendCaseResult()` | `notificationStatus`, `resultSentAt`, `lineMessageId`, `lastNotificationError` | Notion (Case-owned) | ไม่มี `lineUserId` → `action:'skipped'` แต่ **`ok: true`**; ส่งไม่สำเร็จ → `action:'failed'` แต่ **`ok: true`** (บรรทัด 353) | ยังไม่ completed → `409`; ไม่มี reportUrl → `422` | Production | `SOURCE PROVEN` / `BLOCKED` (ห้ามส่งจริง) |
| 23 | Dashboard / Feedback | `GET /api/clients`, `GET /api/feedback/:token` | `api/clients-routes.js`, `api/feedback-*` | ตาราง Case + ฟอร์ม feedback | Notion | `GET /api/clients` ไม่มี cookie → `401`; feedback token ปลอม → `404` | `catch` → `502` + log (clients-routes) | Production | `RUNTIME VERIFIED` — `401 UNAUTHENTICATED`, `404 "Feedback not found"` |

---

# PART 2 — Trace Case Creation

## 2.1 Website

| หัวข้อ | ผลตรวจ | Evidence |
| --- | --- | --- |
| CTA ไปที่ไหน | ไปที่ Cal.com booking page — **ไม่ยิง `POST /api/cases` จากเว็บ** | `SOURCE PROVEN` — ไม่มี call site ของ `POST /api/cases` ในโค้ดฝั่ง Framer/public |
| มี `POST /api/cases` หรือไม่ | มี endpoint อยู่ แต่ต้องมี auth (ใช้โดย operator/adapter) | `api/case-flow-routes.js` |
| ข้อมูลลูกค้าเข้าระบบทางไหน | ผ่าน Cal.com booking → webhook เท่านั้น (เส้นทางเดียว) | `SOURCE PROVEN` |
| field ที่ลูกค้ากรอก | name, email, phone, address (อยู่ใน `responses` ของ Cal.com), + slot เวลา | `BLOCKED` — ยืนยัน payload จริงไม่ได้เพราะห้ามสร้าง booking |
| โควตาแคมเปญ | `GET /api/public/water-check-offer` → `used: 11 / 100` | `RUNTIME VERIFIED` |

## 2.2 Cal.com payload

| Field ที่ระบบต้องใช้ | สถานะการพิสูจน์ |
| --- | --- |
| `payload.uid` (→ `calBookingId`) | `SOURCE PROVEN` (adapter อ่านค่านี้), runtime `BLOCKED` |
| `payload.attendees[0].name / email / phone` | `SOURCE PROVEN`, runtime `BLOCKED` |
| address (จาก `responses`) | `SOURCE PROVEN`, runtime `BLOCKED` |
| `payload.startTime` / `endTime` | `SOURCE PROVEN`, runtime `BLOCKED` |
| `payload.eventType.slug` → `campaignOffer` | `SOURCE PROVEN`, runtime `BLOCKED` |
| `triggerEvent` | `RUNTIME VERIFIED (config)` — production เปิดเฉพาะ `BOOKING_CREATED` (`mode: "booking_created_active"`) |

## 2.3 Webhook

| กรณี | พฤติกรรมตามโค้ด | สถานะ |
| --- | --- | --- |
| ลายเซ็นถูกต้อง | เข้าสู่ adapter | `BLOCKED` |
| ลายเซ็นผิด | ปฏิเสธก่อน parse body (ไม่มีการสร้าง Case) | `SOURCE PROVEN` — runtime ต้อง `POST` จึงพิสูจน์ได้ → **ไม่ทำตามกฎข้อ 5/6** |
| ไม่มี header ลายเซ็น | ปฏิเสธ | `SOURCE PROVEN` |
| payload พัง (JSON ไม่ถูก) | ปฏิเสธ | `SOURCE PROVEN` |
| webhook ซ้ำ (uid เดิม) | กันซ้ำด้วย `calBookingId` + `withCaseLock(notionId)` | `SOURCE PROVEN` / `UNIT ONLY` |
| idempotency ข้าม process | `withCaseLock` เป็น lock **ใน memory ของ process เดียว** — ถ้า scale หลาย instance การกันซ้ำจะอ่อนลง เหลือพึ่ง `calBookingId` query | `SOURCE PROVEN` — **ความเสี่ยงที่ยังไม่มี test** |
| ยืนยันว่า secret เปิดอยู่จริง | `hasWebhookSecret: true`, `dedupePlaceholderEnabled` ปรากฏใน status | `RUNTIME VERIFIED (config)` |

## 2.4 Field mapping ทีละ field

| Source (Cal.com) | Adapter | createCase | Notion | หายระหว่างทางหรือไม่ |
| --- | --- | --- | --- | --- |
| `payload.uid` | `calBookingId` | `calBookingId` | property `calBookingId` | ไม่หาย (เป็น dedupe key) |
| `attendees[0].name` | `customerName` | ชื่อ Case | Title | ไม่หาย |
| `attendees[0].email` | `email` (normalize) | `email` | property email | ไม่หาย |
| phone จาก `responses` | `phone` (normalize) | `phone` | property phone | ไม่หาย |
| address จาก `responses` | `address` | `address` | property address | ไม่หาย |
| `startTime`/`endTime` | `appointmentAt` | เวลานัด | property วันเวลา | ไม่หาย |
| `eventType.slug` | `campaignOffer` | `campaignOffer` | property campaignOffer | **อาจว่าง** ถ้า map ไม่เจอ → มีผลต่อการจัดประเภทข้อความ LINE |
| — | — | `notificationStatus='not_sent'` | property | ถูก**สร้างใหม่** ที่ชั้นนี้ |
| — | — | `feedbackStatus='not_sent'` | property | ถูก**สร้างใหม่** ที่ชั้นนี้ |

**สรุป PART 2:** โครงสร้าง mapping อ่านได้ครบจาก source แต่ **ไม่มี runtime evidence แม้แต่ field เดียว** เพราะการพิสูจน์ต้องสร้าง booking จริง → `BLOCKED — ENVIRONMENT GAP`

---

# PART 3 — Case Persistence / Rehydration

| Lifecycle ที่ต้องทดสอบ | สิ่งที่ต้องพิสูจน์ | สถานะ | Evidence / เหตุผล |
| --- | --- | --- | --- |
| Create → Persist → คืน `notionId` | `notionId` ถูกคืนและใช้อ้างอิงได้ | `BLOCKED` | ต้องสร้าง Case จริง |
| Create → reload | `notionId` ไม่เปลี่ยน, readings ไม่หาย | `UNIT ONLY` | `tests/case-persistence-rehydration.test.js` — ทดสอบใน vm ไม่ใช่ browser จริง |
| Create → restart (process ใหม่) | Case ยังอยู่ (เพราะ Notion เป็น SoT) | `SOURCE PROVEN` | `JOBS` เป็น memory cache; ข้อมูลจริงอยู่ Notion |
| A → B → A (สลับ Case) | readings ของ A ไม่ปนกับ B | `UNIT ONLY` + `SOURCE PROVEN` | `score.js:767-769` `isActiveScoreJob()` กันไม่ให้ session globals ของ Case อื่นรั่วเข้า |
| Create → refresh → reopen | active case ref ถูกอ่านจาก `localStorage` (`wm-active-case-ref`) ไม่ใช่ memory เท่านั้น | `SOURCE PROVEN` | `src/js/job-state.js` |
| local-only Case ไม่ถูก API reload ลบทิ้ง | ต้องมี merge ไม่ใช่ overwrite | `UNIT ONLY` — **ความเสี่ยงยังอยู่** | `loadJobsFromApi()` เขียนทับ array `JOBS`; ถ้า Case ที่ยังไม่ sync ไม่อยู่ใน response จะหายจากจอ |
| Duplicate create → retry | ไม่เกิด Case ซ้ำ | `SOURCE PROVEN` (dedupe ด้วย `calBookingId` + lock ใน process) | runtime `BLOCKED` |
| API ล่มระหว่าง reload | `loadJobsFromApi()` คืน `false` → มี branch ที่ทำให้ dashboard ใช้ **mock CSV** | `SOURCE PROVEN` — **ยังไม่มี test** | ผู้ใช้อาจเห็นข้อมูลตัวอย่างโดยไม่รู้ว่าไม่ใช่ข้อมูลจริง |

**สรุป PART 3:** ไม่มี runtime evidence สำหรับ lifecycle ใดเลย — ทั้งหมดเป็น `UNIT ONLY` หรือ `SOURCE PROVEN`

---

# PART 4 — Measurement Data Lineage (จุดสำคัญที่สุดของรายงานนี้)

## 4.1 สองสายข้อมูลที่แยกจากกัน

```text
OCR body.data
   ├── mapOcrDataToMeterReadings()  ──►  tap.meterReadings   ──►  ค่าที่ "ผู้ใช้เห็นบนจอ" (แก้ไขด้วยมือได้)
   │        (มี false-zero filter)
   └── freezeMeasurement(body.data) ──►  tap.rawMeasurement
                                            └── ConversionEngine ──► tap.standardMeasurement
                                                                          │
                                                        readingsFromTapData() เลือก "standardMeasurement ก่อน"
                                                                          ▼
                                                                   ค่าที่ "engine ใช้จริง"
```

โค้ดที่กำหนดลำดับความสำคัญ (ไม่มี branch อื่น):

```734:741:src/js/flows/score.js
    ph: avgKey(standardRows, 'ph') ?? avgKey(meterRows, 'ph'),
    tds: avgKey(standardRows, 'tds') ?? avgKey(meterRows, 'tds'),
    turbidity: avgKey(standardRows, 'turbidity') ?? avgKey(meterRows, 'turbidity'),
    orp: avgKey(standardRows, 'orp') ?? avgKey(meterRows, 'orp'),
    do: avgKey(standardRows, 'do') ?? avgKey(meterRows, 'do'),
    temp: avgKey(standardRows, 'temp') ?? avgKey(meterRows, 'temp'),
    chlorine: avgKey(standardRows, 'chlorine') ?? avgKey(chlorineRows, 'freeChlorine') ?? avgKey(chlorineRows, 'chlorine')
```

ตัวกรอง false-zero ที่มี **เฉพาะฝั่งที่ผู้ใช้เห็น** ไม่ได้มีในฝั่งที่ engine ใช้:

```510:514:src/js/flows/assessment.js
    // Never auto-fill false zeros (keypad "0" / missing parse) into the form.
    if (Number(value) === 0 && (key === 'ph' || key === 'temp' || key === 'turbidity')) {
      dropped.push({ key, reason: 'false_zero_filter', value });
      return;
    }
```

## 4.2 🔴 RUNTIME-01 — ค่าที่ผู้ใช้เห็น ≠ ค่าที่ engine ใช้ (พิสูจน์ด้วยการรันจริง)

รัน `readingsFromTapData()` **ตัวจริงจาก `src/js/flows/score.js`** แล้วส่งเข้า Thailand engine ตัวจริง

| สถานการณ์ | `tap.standardMeasurement` (จาก OCR) | `tap.meterReadings` (ที่ผู้ใช้เห็น/แก้) | readings ที่ engine ได้รับจริง | คะแนน TH ที่ระบบให้ | คะแนนที่ควรได้ (ตามค่าบนจอ) | ผลกระทบ |
| --- | --- | --- | --- | --- | --- | --- |
| A. OCR อ่าน pH = 0 (ช่องบนจอว่างเพราะ false-zero filter) | `ph: 0` | `ph: '7.2'` | `{"ph":0,...}` | **60** (CRITICAL) | **94** | คะแนนต่ำผิด 34 แต้ม โดยจอไม่แสดงค่า pH เลย |
| B. OCR อ่านผิด pH = 8.9 แล้วช่างแก้เป็น 7.2 ด้วยมือ | `ph: 8.9` | `ph: '7.2'` | `{"ph":8.9,...}` | **75** | **94** | **การแก้ค่าด้วยมือไม่มีผลต่อคะแนน** ต่ำผิด 19 แต้ม |

*Evidence: `RUNTIME VERIFIED` — โหลด `src/js/flows/score.js` จริงใน sandbox (DOM stub) แล้วเรียก `readingsFromTapData()` + `WaterScoreBenchmarkRegistry.calculate('thailand', …)` เมื่อ 2026-08-20*

**ทำไมจึงเกิดขึ้นได้จริง (พิสูจน์จาก source):**

| ข้อเท็จจริง | หลักฐาน |
| --- | --- |
| `standardMeasurement` ถูกเขียนจาก **OCR เท่านั้น** (call site เดียว) | `src/js/flows/assessment.js:1275` `storeRawAndStandardMeasurements()` |
| การแก้ค่าด้วยมือเขียนเข้า **`meterReadings` เท่านั้น** | `src/js/flows/assessment.js:1480` |
| ไม่มีโค้ดใดลบ/อัปเดต `standardMeasurement` เมื่อผู้ใช้แก้ฟอร์ม | ค้นทั้ง `src/js` — พบการเขียน `standardMeasurement` เฉพาะใน path การแปลงของ OCR |
| `standardMeasurement` ชนะเสมอด้วย `??` | `score.js:734-741` (ข้างบน) |
| `ph = 0` ไม่ถูก validator ตัด | validator plausible range ของ pH คือ `min: 0` → state = `VALID` (ดู PART 5) |

**ขอบเขตความมั่นใจ:** เส้นทางนี้ `RUNTIME VERIFIED` ที่ระดับฟังก์ชัน (ใช้ tapData สังเคราะห์) + `SOURCE PROVEN` ที่ระดับ call site ส่วนการยืนยันแบบ end-to-end ใน browser จริงเป็น `BLOCKED — ENVIRONMENT GAP` (ไม่มี Staging) เงื่อนไขเดียวที่จะทำให้ไม่เกิดคือ OCR ต้องไม่เคยคืนค่าที่ถูก filter ทิ้ง และช่างต้องไม่เคยแก้ค่าที่ OCR อ่านมา — ซึ่งคอมเมนต์ในโค้ดเอง (`keypad "0" / missing parse`) ยืนยันว่ากรณีแรกเกิดขึ้นจริงจนต้องเขียน filter

## 4.3 🟠 RUNTIME-02 — ค่าของ tap อื่นถูกตัดออกจากค่าเฉลี่ยแบบเงียบ

| กรณี | ผลลัพธ์จริง | ที่ควรเป็น |
| --- | --- | --- |
| tap1 `standardMeasurement.ph=6`, tap2 `standardMeasurement.ph=8` | `ph = 7` (เฉลี่ยถูกต้อง) | 7 |
| tap1 `standardMeasurement.ph=6`, tap2 มีแต่ `meterReadings.ph=8` | **`ph = 6`** — ค่าของ tap2 **หายไปทั้งหมด** | 7 |
| tap1 `meterReadings.ph=6`, tap2 `meterReadings.ph=8` | `ph = 7` (เฉลี่ยถูกต้อง) | 7 |

*Evidence: `RUNTIME VERIFIED` — สาเหตุคือ `??` ตัดสินที่ระดับ "ทั้ง array" ไม่ใช่ระดับ tap ดังนั้นถ้ามี tap ใดมี `standardMeasurement` ค่าจาก `meterReadings` ของ tap อื่นจะไม่ถูกนำมาเฉลี่ยเลย*

## 4.4 ตาราง lineage ต่อ parameter

`OCR Raw` / `Parsed` ต้องมี OCR จริงจึงเก็บได้ → `BLOCKED` ส่วนคอลัมน์ที่เหลือรันจริงได้

| Parameter | OCR Raw | Parsed (ที่ผู้ใช้เห็น) | Validated | `meterReadings` | `standardMeasurement` | Actual scoring input | เท่ากันหรือไม่ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pH | `BLOCKED` | ตัดค่า 0 ทิ้ง (filter) | ผ่านทุกค่า 0–14 | string จากฟอร์ม/OCR | number จาก raw (ไม่กรอง 0) | **จาก `standardMeasurement`** | ❌ ต่างได้ (RUNTIME-01) |
| TDS | `BLOCKED` | ไม่กรอง 0 | 0–100000 = VALID | string | number; **แปลงจาก `ec × 0.5` ได้** | จาก `standardMeasurement` | ⚠️ อาจเป็นค่าที่คำนวณจาก EC |
| EC | `BLOCKED` | มี field `ec` | ไม่อยู่ใน SCORED_KEYS | มี | **ไม่มี** (ถูกแปลงเป็น TDS) | ไม่เข้า engine โดยตรง | ⚠️ ค่าที่แสดง TDS อาจไม่ใช่ค่าที่วัด |
| Turbidity | `BLOCKED` | ตัดค่า 0 ทิ้ง | 0–100000 = VALID | string | number (ไม่กรอง 0) | จาก `standardMeasurement` | ❌ ต่างได้ + **0 NTU = เกรด 100** |
| ORP | `BLOCKED` | ไม่กรอง 0 | -2000…2000 | string | number | จาก `standardMeasurement` | ⚠️ `orp=0` → เกรด 8 / CRITICAL |
| DO | `BLOCKED` | `do_mg_l ?? do` (ไม่ปน `do_percent`) | 0–25 | string | number; **`do_percent` ไม่ถูกแปลง** | จาก `standardMeasurement` | ⚠️ ถ้าวัดมาเป็น % จะไม่มี DO เข้า engine |
| Chlorine | `BLOCKED` | เข้า `chlorineReadings.freeChlorine` | 0–1000 | `chlorineReadings` | `chlorine` | `standardMeasurement.chlorine` → `freeChlorine` → `chlorine` | ⚠️ 3 ชั้น fallback |
| Temperature | `BLOCKED` | ตัดค่า 0 ทิ้ง; `temp ?? temperature` | ไม่อยู่ใน plausible ranges | string | number; **แปลง °F → °C อัตโนมัติ** | ไม่มีน้ำหนักในทุก engine | ✅ ไม่กระทบคะแนน |

## 4.5 ConversionEngine — รันจริง

| Input (raw) | `standardMeasurement` ที่ได้ | `applied[]` (บันทึกที่มา) | `missing[]` |
| --- | --- | --- | --- |
| ครบทุกค่า (FX-1328) | `{ph:7.79, turbidity:0.12, orp:434.1, temp:28.06, chlorine:0.3, tds:92, do:6.34}` | passthrough ทุก field | — |
| มีแต่ `ec: '400'` | `tds: 200` | `{field:'tds', reason:'ec_to_tds', factor:0.5, from:'ec', ec:400}` | — |
| `temperature_f: '82.4'` | `temp: 28` | `{field:'temp', reason:'fahrenheit_to_celsius'}` | — |
| `do_percent: '85'` | **ไม่มี `do`** | `{field:'do', reason:'do_percent_requires_expert_formula', doPercent:85}` | `['chlorine','do']` |
| `chlorine: '0'` | `chlorine: 0` | passthrough | — |
| **`ph: ' '` (ช่องว่าง)** | **`ph: 0`** | passthrough | — |

*Evidence: `RUNTIME VERIFIED` — รัน `ConversionEngine.toStandardMeasurement()` จริง*

**ข้อดีที่ต้องบันทึก:** ConversionEngine มี provenance ledger (`applied[]`, `missing[]`, `rawSnapshot`) ครบ ทุกการแปลงตรวจย้อนได้ ไม่ใช่การแปลงแบบเงียบ — เป็นจุดแข็งของสถาปัตยกรรมนี้

---

# PART 5 — Missing / Invalid Data

ทดสอบ 15 ค่า ป้อนที่ `chlorine` บนชุดค่าอื่นที่สมบูรณ์ (`ph 7.2, tds 100, turbidity 0.5, orp 400, do 7`) — **รันจริงทุกแถว**

| Input | `toFiniteReading()` (engine guard) | `numOrUndefined()` (app guard) | Validator state | ถูกตัดที่ชั้น app? | Quality V3 | Thailand grade | Thailand score | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `null` | `NaN` | `undefined` | `MISSING` | ไม่ (ไม่มีค่าอยู่แล้ว) | `null` (incomplete) | – | **79** (cap ไม่มี Cl) | `NOT_MEASURED` |
| `undefined` | `NaN` | `undefined` | `MISSING` | ไม่ | `null` (incomplete) | – | 79 | `NOT_MEASURED` |
| `""` | `NaN` | `undefined` | `MISSING` | ไม่ | `null` (incomplete) | – | 79 | `NOT_MEASURED` |
| **`" "`** | **`0`** ⚠️ | `undefined` ✅ | **`MISSING`** ⚠️ | **ไม่** | 77 | **5** | **60** | **CRITICAL** |
| `false` | `NaN` | `undefined` | `INVALID_TYPE` | ใช่ | `null` (incomplete) | – | 79 | `NOT_MEASURED` |
| `[]` | **`0`** ⚠️ | `undefined` ✅ | `INVALID_TYPE` | ใช่ | 77 | 5 | 60 | CRITICAL |
| `{}` | `NaN` | `undefined` | `INVALID_TYPE` | ใช่ | `null` | – | 79 | `NOT_MEASURED` |
| `"abc"` | `NaN` | `undefined` | `INVALID_TYPE` | ใช่ | `null` | – | 79 | `NOT_MEASURED` |
| `NaN` | `NaN` | `undefined` | `INVALID_TYPE` | ใช่ | `null` | – | 79 | `NOT_MEASURED` |
| `Infinity` | `NaN` | `undefined` | `INVALID_TYPE` | ใช่ | `null` | – | 79 | `NOT_MEASURED` |
| `-Infinity` | `NaN` | `undefined` | `INVALID_TYPE` | ใช่ | `null` | – | 79 | `NOT_MEASURED` |
| `"0"` | `0` | `0` | `VALID` | ไม่ | 77 | 5 | 60 | CRITICAL |
| `0` | `0` | `0` | `VALID` | ไม่ | 77 | 5 | 60 | CRITICAL |
| `true` | **`1`** ⚠️ | `undefined` ✅ | `INVALID_TYPE` | ใช่ | 84 | 46 | 83 | PASS |
| `[5]` | **`5`** ⚠️ | `5` ⚠️ | `INVALID_TYPE` | ใช่ | 77 | 8 | 60 | CRITICAL |

## 5.1 พิสูจน์ `missing ≠ 0`

| กรณี | Quality V3 | Thailand grade | Thailand score | Classification |
| --- | --- | --- | --- | --- |
| ไม่มี chlorine เลย (key หายไป) | **`null`** + `incomplete: true` | ไม่มีเกรด | **79** (cap เพราะขาด Cl) | `NOT_MEASURED` |
| chlorine = **0** (วัดได้ว่าไม่มีคลอรีน) | **77** | 5 | **60** | `CRITICAL` |

✅ **ยืนยัน `missing ≠ 0` และ `invalid ≠ 0` ที่ระดับ runtime** — ไม่มีจุดใดที่ `null` กลายเป็น 0 ในสายการคำนวณคะแนน และการค้นทั้ง `api/`, `services/`, `src/js/` ไม่พบ `|| 0` หรือ `?? 0` บน parameter การวัดแม้แต่จุดเดียว

## 5.2 🟠 RUNTIME-03 — `" "` เป็นค่าเดียวที่เจาะ guard ได้ทุกชั้น

| ชั้นป้องกัน | ผลกับ `" "` | ควรเป็น |
| --- | --- | --- |
| `toFiniteReading()` (`src/js/score/util/clamp.js:10-14`) | **`0`** (เพราะ `Number(' ') === 0` และโค้ดเช็คแค่ `''`) | `NaN` |
| `ConversionEngine.toFiniteNumber()` | **`0`** | `null` |
| `MeasurementValidator` | จัดเป็น **`MISSING`** → **ไม่ถูกตัดออก** (`resolveScoreReadings` ตัดแค่ `IMPLAUSIBLE`/`INVALID_TYPE`) | `INVALID_TYPE` |
| `numOrUndefined()` (`parseFloat`) | `undefined` ✅ | ✅ ชั้นเดียวที่กันได้ |
| `mergeRawMeasurement()` (`assessment.js:545`) | ผ่าน (กรองแค่ `undefined`/`null`/`''`) | ควรกรอง whitespace |

**สรุป:** ระบบมีเพียง **1 ชั้น** ที่กัน `" "` ได้ และชั้นนั้นไม่อยู่บนเส้นทาง `rawMeasurement → standardMeasurement` ดังนั้น ถ้า OCR คืน whitespace-only string จะได้ `standardMeasurement.<param> = 0` และไหลเข้า engine ตาม RUNTIME-01

---

# PART 6 — Score Data Lineage (รันจริงทุก fixture ทุก engine)

## 6.1 ตรวจเลขคณิตของ aggregate

รันแล้วเทียบกับสูตร weighted mean ที่คำนวณแยกเป็นอิสระ: **ตรงกัน 30/30 (6 fixtures × 5 engines)** — ไม่มี engine ใดคำนวณผิดจากน้ำหนักที่ประกาศไว้

| Engine | น้ำหนักที่ใช้จริง (จาก runtime) | ผลรวมน้ำหนัก | Parameter ที่เข้าสูตร | Parameter ที่ถูกกันออก |
| --- | --- | --- | --- | --- |
| Thailand | ph 1, tds 1, chlorine 1, turbidity 1, orp 1 | 5 | 5 ตัว | **DO, temp** |
| Japan | turbidity .22, chlorine .22, ph .16, tds .16, orp .12 | **0.88** | 5 ตัว | **DO, temp** |
| WHO | ph 1, tds 1, turbidity 1, orp 1, chlorine 1, do 1 | 6 | 6 ตัว | temp |
| EU | chlorine .25, turbidity .25, tds .15, ph .15, do .1, orp .1 | 1.00 | 6 ตัว | temp |
| US EPA | turbidity .3, tds .2, chlorine .15, ph .15, do .1, orp .1 | 1.00 | 6 ตัว | temp |
| Quality V3 | ทุกตัว = 1 (flat) | 6 | 6 ตัว | temp |

## 6.2 FX-IDEAL (`ph 7.2, tds 80, turb 0.1, orp 400, do 8, cl 0.3, temp 25`)

Quality V3: เกรดทุกตัว = 100 → flat mean 100 → **score 100**

| Engine | เกรดรวม (raw) | Severity | Country gate | Hero ceiling | คะแนนสุดท้าย | ที่มาของตัวเลข |
| --- | --- | --- | --- | --- | --- | --- |
| Thailand | 100 | PASS ไม่ cap | – | **100 → 99** | **99** | เพดาน Hero 99 |
| Japan | 100 | **WARNING → cap 85** | – | ไม่ทำงาน | **85** | pH 7.2 อยู่นอกช่วง 7.3–7.7 ของญี่ปุ่น |
| WHO | 100 | PASS | – | 100 → 99 | **99** | เพดาน Hero |
| EU | 100 | PASS | ไม่ทำงาน (Cl 0.3 ผ่าน) | 100 → 99 | **99** | เพดาน Hero |
| US EPA | 100 | PASS | – | 100 → 99 | **99** | เพดาน Hero |

## 6.3 FX-NEAR-IDEAL (`ph 7.2, tds 70, turb 0.06, orp 400, do 8.2, cl 0.3`)

Quality V3: เกรดทุกตัว 100 → **score 100**; country engines ให้ผลเหมือน FX-IDEAL ทุกช่อง (TH/WHO/EU/EPA = 99, JP = 85)

## 6.4 FX-BASE (`ph 7.85, tds 175, turb 0.42, orp 515, do 5.3, cl 0.7, temp 25`)

**Quality V3 แบบละเอียด:**

| ขั้น | ค่า | Source |
| --- | --- | --- |
| เกรด pH | 82.5 | shared grade curve |
| เกรด TDS | 83.75 | shared |
| เกรด Turbidity | 77.73 | shared |
| เกรด ORP | 74.0 | shared |
| เกรด Chlorine | 78.4 | shared |
| เกรด DO | 56.8 | shared |
| ค่าเฉลี่ย flat (÷6) | 75.53 | คำนวณอิสระ |
| **Quality V3 score** | **76** | ปัดจาก 75.53 |
| Compliance | `FAIL` | เกณฑ์ compliance แยกจากคะแนน |

**Country engines:**

| Engine | Weighted raw | Severity (worst → cap → ผล) | Gate | Ceiling | สุดท้าย | ทำไมได้เลขนี้ |
| --- | --- | --- | --- | --- | --- | --- |
| Thailand | 79 | PASS → ไม่ cap | – | – | **79** | ทุก param อยู่ในกรอบไทย |
| Japan | 79 | WARNING → cap 85 → **76** | – | – | **76** | cap 85 ไม่กด แต่มี min-deduction −3 |
| WHO | 76 | FAIL → cap 75 → **70** | – | – | **70** | มี param ที่ FAIL ตามเกณฑ์ WHO |
| EU | 77 | FAIL → cap 75 → 71 | **Cl 0.7 > 0.5 → cap 65** | – | **65** | `min(gate 65, severity 71)` |
| US EPA | 77 | FAIL → cap 75 → **71** | – | – | **71** | severity cap + deduction |

## 6.5 FX-DIFF-TH-SAFE (`ph 8.0, tds 350, turb 0.5, orp 400, do 6, cl 0.5, temp 26`)

Quality V3 = **81** (flat mean 80.67, compliance `WARNING`)

| Engine | raw | Severity | Gate | สุดท้าย |
| --- | --- | --- | --- | --- |
| Thailand | 83 | PASS | – | **83** |
| Japan | 83 | FAIL → cap 75 | – | **75** |
| WHO | 81 | PASS | – | **81** |
| EU | 82 | PASS | ไม่ทำงาน (Cl 0.5 = ขอบ) | **82** |
| US EPA | 79 | PASS | – | **79** |

## 6.6 FX-LOCKED (`ph 7.2, tds 450, cl 0.8, turb 2.5, orp 350, do 6.5, temp 28`)

Quality V3 = **73** (เกรด: ph 100, tds 56, turb 45, orp 92.2, cl 67.6, do 78; flat mean 73.14)

| Engine | raw | Severity (worst → cap → ผล) | Gate | สุดท้าย |
| --- | --- | --- | --- | --- |
| Thailand | 72 | FAIL → cap 75 → **66** | – | **66** |
| Japan | 69 | FAIL → cap 75 → **63** | – | **63** |
| WHO | 73 | **CRITICAL → cap 60** | – | **60** |
| EU | 69 | FAIL → cap 75 → 63 | cap 65 ทำงาน | **63** (`min(65,63)`) |
| US EPA | 67 | CRITICAL → cap 60 → **57** | – | **57** |

## 6.7 FX-1328 (`ph 7.79, tds 92, turb 0.12, orp 434.1, do 6.34, cl 0.3, temp 28.06`)

**Quality V3 = 92** — ที่มาของ 92:

| ขั้น | ค่า |
| --- | --- |
| เกรด pH | 84.3 |
| เกรด TDS | 97.6 |
| เกรด Turbidity | 97.6 |
| เกรด ORP | 97.17 |
| เกรด Chlorine | 100 |
| เกรด DO | 74.8 |
| flat mean | 91.91 |
| **score** | **92** |

| Engine | weighted raw | Severity | สุดท้าย | หมายเหตุ |
| --- | --- | --- | --- | --- |
| Thailand | 95 | PASS | **95** | น้ำหนักเท่ากันหมด, DO ไม่นับ → สูงกว่า Q-V3 |
| Japan | 96 | WARNING → cap 85 | **85** | pH 7.79 นอกช่วง 7.3–7.7 |
| WHO | 92 | PASS | **92** | นับ DO ด้วย น้ำหนักเท่ากัน → เท่ากับ Q-V3 |
| EU | 94 | PASS | **94** | DO น้ำหนักแค่ 0.1 |
| US EPA | 94 | PASS | **94** | DO น้ำหนักแค่ 0.1 |

**ข้อสังเกต:** ตัวเลขทั้ง 30 ช่องตรงกับค่าที่ล็อกไว้ใน `08_MASTER_TEST_CASE_MATRIX.md` ทุกช่อง — ยืนยันว่าค่า expected ในเอกสารไม่ได้เพี้ยนจาก source ปัจจุบัน

## 6.8 🟡 พบ dead config + คอมเมนต์ที่ขัดกับโค้ด

| หัวข้อ | ผลตรวจ |
| --- | --- |
| `weakestLinkShare` ใน `limits.js` | มีค่าอยู่จริง: thailand **0.5**, japan/who/eu/usEpa **0.25** |
| มีโค้ดอ่านค่านี้ไปคำนวณหรือไม่ | **ไม่มี** — `rawScore` มาจาก `computeSharedBenchmarkBase(readings, W)` ตรง ๆ (`thailand/score.js:73-75`) |
| คอมเมนต์ในโค้ด | `thailand/score.js:106` เขียนว่า *"no change to … the PD-015 weakest-link blend above"* — แต่ **ไม่มี blend ดังกล่าวในโค้ด** |
| ความเสี่ยง | ใครอ่านคอมเมนต์/config จะเข้าใจสูตรผิด และถ้าวันหนึ่งมีคน "เปิดใช้" ค่านี้ คะแนนทั้งระบบจะเปลี่ยนโดยไม่มี test จับ |

---

# PART 7 — Country Isolation

| ข้อที่ต้องพิสูจน์ | ผล | Evidence |
| --- | --- | --- |
| ใช้ weight profile ของตัวเอง | ✅ ต่างกันจริงทั้ง 5 (ดูตาราง 6.1) | `RUNTIME VERIFIED` — อ่าน object น้ำหนักจาก runtime |
| ใช้ classification / threshold ของตัวเอง | ✅ FX-LOCKED ให้ worst-classification ต่างกัน (TH/JP/EU = FAIL, WHO/EPA = CRITICAL) | `RUNTIME VERIFIED` |
| ใช้ severity cap ของตัวเอง | ✅ ใช้ shared cap table (WARNING 85 / FAIL 75 / CRITICAL 60) แต่ trigger จาก classification ของตัวเอง | `RUNTIME VERIFIED` |
| ใช้ country gate ของตัวเอง | ✅ มีแค่ EU ที่มี gate (`EU-PD-002-chlorine-gate`, cap 65) — engine อื่นคืน `countryGate: null` | `RUNTIME VERIFIED` |
| ไม่มี engine อ่าน weight ของประเทศอื่น | ✅ | `RUNTIME VERIFIED` — object น้ำหนักทั้ง 5 เป็น `Object.isFrozen() === true` |
| ไม่มี shared mutable state | ✅ รัน japan → eu → usEpa → japan ซ้ำ ได้ 76 เท่าเดิม | `RUNTIME VERIFIED` |
| ไม่ fallback ไป flat mean โดยไม่ตั้งใจ | ✅ weighted mean ที่คำนวณอิสระตรงกับ `rawAggregate` 30/30 (ถ้า fallback เป็น flat mean จะไม่ตรงสำหรับ JP/EU/EPA) | `RUNTIME VERIFIED` |
| ⚠️ key ที่ไม่รู้จัก | `has('atlantis') === false` แต่ `calculate('atlantis', …)` **คืนผลของ thailand เงียบ ๆ** (score 79 เท่ากันทุก field) | `RUNTIME VERIFIED` — `registry.js:20-22` |

## 7.1 Japan × DO — พิสูจน์ว่า DO ไม่เข้าคะแนน

รันบน FX-BASE เปลี่ยนเฉพาะ DO

| DO | เกรด DO ที่ engine คำนวณได้ | Classification | **คะแนน Japan** | Thailand | WHO | EU | US EPA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ไม่มีค่า | ไม่คิดเกรด | `NOT_EVALUATED` | **76** | 79 | 73 | 65 | 80 |
| 0 | 5 | `NOT_EVALUATED` | **76** | 79 | 57 | 65 | 60 |
| 5 | 52 | `NOT_EVALUATED` | **76** | 79 | 69 | 65 | 71 |
| 9 | 100 | `NOT_EVALUATED` | **76** | 79 | 75 | 65 | 82 |
| 8.2 | 100 | `NOT_EVALUATED` | **76** | 79 | 75 | 65 | 82 |
| 25 | 100 | `NOT_EVALUATED` | **76** | 79 | 75 | 65 | 82 |

✅ **พิสูจน์แล้วที่ระดับ runtime:** Japan classification = `NOT_EVALUATED` ทุกกรณี และคะแนน **นิ่งที่ 76 ไม่ขยับเลย** แม้ DO เปลี่ยนจาก 0 → 25 (Thailand ก็นิ่งที่ 79 เช่นกัน) ขณะที่ WHO เปลี่ยน 57→75 และ EPA เปลี่ยน 60→82 ตาม DO — ยืนยันว่า DO ถูกคิดเกรดแต่ **ไม่ถูกนำเข้า aggregate** ของ TH/JP จริง

> **หมายเหตุ EU:** ค่า EU นิ่งที่ 65 ทุกแถว **ไม่ใช่** เพราะ EU ไม่นับ DO (EU ให้น้ำหนัก DO 0.1) แต่เพราะ chlorine 0.7 ของ FX-BASE ทำให้ gate 65 ทำงานและกดคะแนนคงที่ — เป็นตัวอย่างว่า gate สามารถบดบังความไวของ parameter อื่นได้

## 7.2 🟡 พบ cliff ที่ขอบ band ของญี่ปุ่น

| pH | เกรด (shared curve) | Japan classification | raw | severity | คะแนน Japan |
| --- | --- | --- | --- | --- | --- |
| 7.2 | 100.0 | **WARNING** | 100 | cap 85 | **85** |
| 7.3 | 100.0 | PASS | 100 | – | **99** |
| 7.5 | 94.0 | PASS | 99 | – | **99** |
| 7.6 | 90.0 | PASS | 98 | – | **98** |
| 7.7 | 87.0 | PASS | 98 | – | **98** |
| 7.8 | 84.0 | **WARNING** | 97 | cap 85 | **85** |

ผลคือคะแนน Japan **กระโดด 14 แต้มจาก pH ต่างกัน 0.1** (7.2 → 7.3) ซึ่งเป็นพฤติกรรมตามการออกแบบ (band ของญี่ปุ่นคือ 7.3–7.7 ขณะที่ shared curve ให้เกรดสูงสุดที่ 7.2) แต่ **ไม่มี test ตรวจค่าที่ขอบ (7.29 / 7.30 / 7.70 / 7.71)** และเป็นเหตุผลที่ Japan ไม่ผ่านการทดสอบ monotonicity แบบทั่วไป (ดู PART 8)

---

# PART 8 — Score Invariants

## 8.1 Hero ceiling

| input | output | ผล |
| --- | --- | --- |
| 120 | 99 | ✅ |
| 100 | 99 | ✅ |
| 99 | 99 | ✅ |
| 98 | 98 | ✅ ไม่แตะค่าที่ต่ำกว่าเพดาน |
| 0 | 0 | ✅ ไม่ยกขึ้น |

`RUNTIME VERIFIED` — `applyCountryBenchmarkHeroCeiling()`; ในทางปฏิบัติเห็นทำงานจริงที่ FX-IDEAL/FX-NEAR-IDEAL (100 → 99) ใน 4 engine

## 8.2 Severity เป็น ceiling ไม่ใช่ floor

| raw | worst classification | ผลลัพธ์จริง | ถ้าเป็น floor จะได้ | สรุป |
| --- | --- | --- | --- | --- |
| 100 | PASS | 100 | – | ✅ |
| 90 | WARNING | **85** | 85 | ✅ กดลง |
| 50 | FAIL | **44** | ~~75~~ | ✅ **ไม่ถูกยกขึ้น** |
| 50 | CRITICAL | **40** | ~~60~~ | ✅ ไม่ถูกยกขึ้น |
| 30 | CRITICAL | **20** | ~~60~~ | ✅ |
| 5 | CRITICAL | **0** | ~~60~~ | ✅ |

✅ **ยืนยันชัดเจน: cap คือเพดาน ไม่ใช่พื้น** และมี min-deduction เพิ่มเข้ามาเสมอ (50 → 44 = ลด 6, 30 → 20 = ลด 10) ดังนั้นน้ำที่แย่จะไม่ถูก "ช่วย" ให้ดูดีขึ้น

ทดสอบซ้ำด้วยค่าน้ำแย่จริง (`ph 4.5, tds 1800, turb 9, orp 120, cl 4.5, do 2`):

| Engine | raw | worst | cap | หลัง severity | สุดท้าย | ถูกยกขึ้นเหนือ raw? |
| --- | --- | --- | --- | --- | --- | --- |
| Thailand | 19 | CRITICAL | 60 | 9 | **9** | ไม่ |
| Japan | 17 | CRITICAL | 60 | 7 | **7** | ไม่ |
| WHO | 19 | CRITICAL | 60 | 9 | **9** | ไม่ |
| EU | 17 | CRITICAL | 60 | 7 | **7** | ไม่ |
| US EPA | 17 | CRITICAL | 60 | 7 | **7** | ไม่ |

## 8.3 Monotonicity — 30 ชุด (5 engine × 6 parameter)

ไล่ค่าจากดีไปแย่บน FX-IDEAL

| Engine | pH | TDS | Turbidity | ORP | Chlorine | DO |
| --- | --- | --- | --- | --- | --- | --- |
| Thailand | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 | ✅ นิ่ง 99 (ไม่นับ DO) |
| Japan | ⚠️ ดู 8.4 | ✅ 85→60 | ✅ 85→60 | ✅ 85→60 | ✅ 85→60 | ✅ นิ่ง 85 |
| WHO | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 |
| EU | ✅ 99→75 | ✅ 99→75 | ✅ 99→60 | ✅ 99→85 | ✅ 99→65 | ✅ 99→75 |
| US EPA | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 | ✅ 99→60 |

**ผล: 29/30 ชุด monotonic non-increasing**

## 8.4 กรณีเดียวที่ไม่ monotonic — Japan / pH (เป็นไปตามการออกแบบ)

`ph 7.2 → 85` แต่ `ph 7.6 → 98` (คะแนน **เพิ่ม** เมื่อ pH ห่างจาก 7.2)

สาเหตุอธิบายได้ครบใน 8.2/7.2: จุดอ้างอิงของญี่ปุ่นไม่ใช่ 7.2 แต่เป็น band 7.3–7.7 → การวัด monotonicity ต้องวัด **เทียบ band ของแต่ละประเทศ** ไม่ใช่เทียบระยะห่างจาก 7.2 ⇒ ถ้าอนาคตมีคนเขียน regression test แบบ "ค่ายิ่งห่าง 7.2 คะแนนต้องยิ่งลด" test นั้นจะ **fail แบบ false-positive** กับ Japan

---

# PART 9 — Publish Lineage

| ขั้น | โค้ด | พฤติกรรม | สถานะ |
| --- | --- | --- | --- |
| Case → calculate | `renderWaterScore()` (`score.js:916+`) | คำนวณสดจาก readings ทุกครั้ง ไม่เชื่อ cache | `SOURCE PROVEN` |
| save score / publish | `POST /api/cases/:id/score` → `publishCaseScore()` → `createOrReusePublication()` | ตรวจ `score` ต้องเป็นเลข 0–100 ไม่งั้น **400** | `SOURCE PROVEN` |
| publication ledger | `services/score-publication-service.js:204-209` | ถ้าไม่ตั้ง `NOTION_SCORE_PUBLICATIONS_DATABASE_ID` → **503 `LEDGER_REQUIRED`** (ไม่ publish แบบครึ่ง ๆ) | `SOURCE PROVEN` |
| retry / duplicate publish | `:211-229` ถ้ามี `idempotencyKey` ซ้ำ → คืนรายการเดิม `reused: true` | ไม่สร้าง publication ซ้ำ | `SOURCE PROVEN`, `UNIT ONLY` |
| pointer ค้าง | `pointerSyncState: 'pointer_pending'` → พยายาม sync ใหม่; ถ้าไม่สำเร็จคืน `pointerPending: true` + `warning` | ไม่กลืน error แต่ก็ไม่ fail | `SOURCE PROVEN` |
| public token | `job.result.publicReportToken` | ใช้ค้นหา Case | `RUNTIME VERIFIED (negative)` — token ปลอม → 404 |
| `/r/:token` | `api/public-routes.js` | token ไม่พบ → 404 HTML "Report not found" | `RUNTIME VERIFIED` |
| `/api/report/:token` | `api/public-routes.js` | 404 JSON `{"ok":false,"error":"Report not found"}` | `RUNTIME VERIFIED` |
| public report ใช้ค่าอะไร | `score.js:265-293` — ถ้า `publicView && Number.isFinite(publishedScore)` → ใช้ **`published` / `quality-v3`** ไม่ใช่ session Hero | ✅ ตรงตามข้อกำหนด | `SOURCE PROVEN` |
| เปลี่ยน session score หลัง publish | public artifact อ่านจาก `job.result.waterScore` (Notion) ไม่ใช่ state ใน browser | ค่าที่เผยแพร่ไม่เปลี่ยนย้อนหลัง | `SOURCE PROVEN` — runtime `BLOCKED` |
| unpublished Case | `!Number.isFinite(job.result?.waterScore)` → **404 "Score not published"** | ไม่แสดง 0 | `RUNTIME VERIFIED (negative)` |

**สรุป PART 9:** ตรรกะ "public report ต้องใช้ Published Quality V3" พิสูจน์ได้จาก source แบบไม่มี branch ซ่อน แต่ **ไม่มี runtime evidence ของการ publish จริงแม้แต่ครั้งเดียว** → `BLOCKED — ENVIRONMENT GAP`

---

# PART 10 — Score Card

## 10.1 พฤติกรรมจริงของ `cardOptionsFromJob()` (รันจริง)

| `job.result.waterScore` | `cardOptionsFromJob().score` | ชนิด | ประเมิน |
| --- | --- | --- | --- |
| `null` | **0** | number | ⚠️ `null → 0` |
| `undefined` | **0** | number | ⚠️ |
| ไม่มี object `result` เลย | **0** | number | ⚠️ |
| `NaN` | **0** | number | ⚠️ |
| `'abc'` | **0** | number | ⚠️ |
| `0` | 0 | number | ✅ ถูกต้อง |
| `50` | 50 | number | ✅ |
| `99` | 99 | number | ✅ |
| `100` | 100 | number | ✅ |

## 10.2 แต่เส้นทางจริงถูก guard ไว้แล้ว

```105:107:api/public-routes.js
      if (!job || !Number.isFinite(Number(job.result?.waterScore))) {
        sendJson(res, 404, { ok: false, error: 'Score not published' });
        return true;
      }
```

| ข้อเท็จจริง | ผล |
| --- | --- |
| จำนวน call site ของ `cardOptionsFromJob` ในระบบ | **1 แห่งเดียว** (`api/public-routes.js:110`) |
| call site นั้นมี guard `Number.isFinite` ก่อนหรือไม่ | ✅ มี (บรรทัด 105) → ตอบ **404** ไม่ใช่ card 0 |
| ยืนยันด้วย runtime | `GET /api/public/score-card/rpt-zzzz` → `404 {"ok":false,"error":"Score not published"}` |
| ⚠️ endpoint `/demo` | `api/public-routes.js:71` ใช้ `Number.isFinite(score) ? score : 65` → **hardcode 65** และ runtime ตอบ `200 image/png` |

**สรุป PART 10:** ข้อกำหนด "ห้าม `null → 0` อัตโนมัติ" **ปัจจุบันไม่ถูกละเมิดในเส้นทางที่ใช้งานจริง** เพราะ route guard ตอบ 404 ก่อน แต่ตัวฟังก์ชันเองยัง coerce เป็น 0 อยู่ → ถือเป็น **latent risk**: ถ้ามีคนเพิ่ม caller ที่สองในอนาคต (เช่น ส่งการ์ดทาง LINE, batch render) จะได้การ์ดคะแนน 0 ทันทีโดยไม่มี test จับ

---

# PART 11 — LINE State Machine

**ไม่มีการส่ง LINE จริงในงานนี้** — ตรวจจาก source ของ `services/workflow-service.js:237-354`

| State ตั้งต้น | เงื่อนไข | State ปลายทาง | HTTP / return | หมายเหตุ |
| --- | --- | --- | --- | --- |
| `not_sent` / `ready` / `failed` | ครบเงื่อนไขทุกข้อ | `sending` → `sent` | `ok:true, action:'sent'` + `caseWorkflowStatus:'result_sent'`, `resultSentAt`, `lineMessageId` | เส้นทางปกติ |
| `not_sent` | provider ตอบ fail | `sending` → **`failed`** | **`ok:true`**, `action:'failed'`, `lastNotificationError` | ⚠️ ตอบ ok:true ทั้งที่ส่งไม่สำเร็จ (บรรทัด 353) |
| `sent` | เรียกซ้ำ | `sent` (ไม่เปลี่ยน) | `ok:true, idempotent:true, action:'already_sent'` | ✅ กันส่งซ้ำ |
| `sending` (สดใหม่) | เรียกซ้ำภายใน `STALE_SENDING_MS` | `sending` | `ok:true, idempotent:true, action:'already_sending'` | ✅ กันซ้อน |
| `sending` (ค้างเกินเวลา / process restart) | `sendingStartedAt` ไม่มี entry หรือหมดอายุ | ปลดล็อกแล้วส่งใหม่ | log `notification_stale_sending_recovered` | ✅ กู้จากสถานะค้างได้ |
| ทุก state | ไม่มี `lineUserId` | ไม่เปลี่ยน | **`ok:true`**, `action:'skipped'`, `reason:'no_line_user_id'` | ⚠️ "สำเร็จ" ทั้งที่ไม่ได้ส่ง |
| ทุก state | workflow ยังไม่ `completed` | ไม่เปลี่ยน | **throw 409** "Case is not completed yet" | ✅ |
| ทุก state | ไม่มี `reportUrl` | ไม่เปลี่ยน | **throw 422** "Report URL is missing" | ✅ |
| — | หา Case ไม่เจอ | — | **throw 404** | ✅ |
| `failed` | retry ผ่าน `repairCaseResultNotification()` | เข้าเส้นทางเดิมอีกครั้ง | เหมือน `sendCaseResult` | ✅ |
| missing score | **ไม่มีการตรวจ score โดยตรง** — ตรวจผ่าน `reportUrl` (ซึ่งได้มาจาก publication) | — | 422 (ทางอ้อม) | ⚠️ ไม่ใช่ guard ที่ชัดเจน |

**ความเสี่ยงที่พบ:**

| # | เรื่อง | รายละเอียด |
| --- | --- | --- |
| L-1 | `ok:true` เมื่อส่งไม่สำเร็จ | ผู้เรียกต้องอ่าน `action`/`line.ok` เอง — dashboard/monitor ที่ดูแค่ HTTP 200 จะเข้าใจว่าส่งสำเร็จ |
| L-2 | `ok:true` เมื่อ skip | เหมือนกัน — Case ที่ไม่มี LINE จะดูเหมือนแจ้งเตือนเรียบร้อย |
| L-3 | `sendingStartedAt` เป็น `Map` ใน memory | ถ้ารันหลาย instance การกันส่งซ้ำจะอ่อนลง (แต่ละ process มี map ของตัวเอง) |
| L-4 | ไม่มี test ครอบ state machine นี้ | ไม่มีไฟล์ทดสอบใดใน `tests/` เรียก `executeSendCaseResult` |

สถานะโดยรวม: `SOURCE PROVEN` (ครบทุก transition) + `BLOCKED` (runtime) + ไม่มี unit test

---

# PART 12 — API Boundary QA

**ยิงจริงกับ production ด้วย `GET` เท่านั้น** (ไม่มี POST/PUT/DELETE ตามกฎข้อ 5-6)

| Endpoint | Method | Auth | ผลที่คาด | **Actual** | Content-Type | สถานะ |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/ops/health` | GET | ไม่ต้อง | 200 | **200** | `application/json` | ✅ |
| `/api/ops/readiness` | GET | ไม่ต้อง | 200 | **200** (`notion/lineSend/lineWebhook/publicHttps: ready`) | json | ✅ |
| `/api/public/water-check-offer` | GET | ไม่ต้อง | 200 | **200** | json | ✅ |
| `/api/cal/webhook/status` | GET | ไม่ต้อง | 200 | **200** (`hasWebhookSecret:true`) | json | ✅ |
| `/api/line/status` | GET | ไม่ต้อง | 200 | **200** (channel ตั้งค่าครบ) | json | ✅ |
| `/api/clients` | GET | ต้องมี | 401 | **401** `UNAUTHENTICATED` | json | ✅ |
| `/api/report/rpt-zzzz` | GET | ไม่ต้อง | 404 | **404** "Report not found" | json | ✅ |
| `/r/fake-token-qa` | GET | ไม่ต้อง | 404 | **404** | text/html | ✅ |
| `/api/public/score-card/rpt-zzzz` | GET | ไม่ต้อง | 404 | **404** "Report not found" | json | ✅ |
| `/api/public/score-card/demo` | GET | ไม่ต้อง | 200 | **200** | `image/png` | ⚠️ คะแนน default 65 |
| `/api/feedback/fake-token-qa` | GET | ไม่ต้อง | 404 | **404** "Feedback not found" | json | ✅ |
| `/api/ocr/read-meter` | GET | ต้องมี | 405 | **405** `METHOD_NOT_ALLOWED` | json | ✅ ตรวจ method ก่อน auth |
| `/api/cases` | GET | — | 404/405 | 🔴 **200 + HTML ของ SPA** | `text/html` | ❌ ผิด |
| `/api/cases/nonexistent-id/score` | GET | — | 404/405 | 🔴 **200 + HTML ของ SPA** | `text/html` | ❌ ผิด |
| `/api/line/webhook` | GET | — | 404/405 | 🔴 **200 + HTML ของ SPA** | `text/html` | ❌ ผิด |

## 12.1 🟠 RUNTIME-04 — ไม่มี catch-all 404 สำหรับ `/api/*`

สาเหตุ (source):

```384:391:server.js
  fs.stat(filePath, (statErr, stat) => {
    const isAssetRequest = req.url.startsWith('/src/') || req.url.includes('.');
    if ((statErr || !stat.isFile()) && isAssetRequest) {
      send(res, 404, 'Not Found');
      return;
    }

    const servePath = !statErr && stat.isFile() ? filePath : path.join(root, 'index.html');
```

route ที่รับเฉพาะ `POST` จะคืน false เมื่อถูกเรียกด้วย `GET` แล้ว request ตกลงมาถึง static handler ซึ่งเห็นว่า path ไม่มีจุด (`.`) และไม่ได้ขึ้นต้นด้วย `/src/` → **ส่ง `index.html` พร้อม HTTP 200**

| ผลกระทบ | ระดับ |
| --- | --- |
| Monitor/uptime check ที่ยิง GET ไป endpoint API จะได้ 200 ตลอด แม้ API พังจริง (false green) | 🟠 |
| client ที่คาด JSON จะได้ HTML → JSON parse error แทน 404 ที่อ่านรู้เรื่อง | 🟠 |
| ไม่มี test ใดใน 258 cases ตรวจ method/path ที่ไม่ตรง | 🟠 |

## 12.2 สถานะที่ยังพิสูจน์ไม่ได้

| Status | ต้องทำอะไรจึงพิสูจน์ได้ | สถานะ |
| --- | --- | --- |
| 400 | ต้อง POST body ที่ผิด (เช่น score 150) | `BLOCKED` |
| 403 | ต้องมี session ที่ role ไม่พอ | `BLOCKED` |
| 409 | ต้อง POST notify กับ Case ที่ยังไม่ completed | `BLOCKED` |
| 422 | ต้อง POST notify กับ Case ที่ไม่มี reportUrl | `BLOCKED` |
| 500 / 502 | ต้องทำให้ dependency ล่ม | `BLOCKED` |
| 503 | ต้องถอด `NOTION_SCORE_PUBLICATIONS_DATABASE_ID` | `BLOCKED` |
| 401 บน webhook ลายเซ็นผิด | ต้อง POST | `BLOCKED` |

---

# PART 13 — Error Propagation

| Node ที่ fail | ระบบแจ้ง error หรือไม่ | กลืน error หรือไม่ | สร้างข้อมูลครึ่ง ๆ หรือไม่ | Case ถูก mark สำเร็จผิดหรือไม่ | retry ซ้ำแล้วเกิด duplicate หรือไม่ | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| OCR fail (offline/timeout) | ✅ โยน code `OCR_OFFLINE`/`OCR_TIMEOUT` ขึ้น UI | บาง error โยน บางกรณีคืน `{readings:{}}` เงียบ (`assessment.js:749-768`) | ไม่ (ไม่เขียน readings) | ไม่ | ไม่ | `SOURCE PROVEN` |
| OCR อ่านผิด (แต่สำเร็จ) | ❌ **ไม่มีใครรู้** | – | ✅ เขียน `standardMeasurement` ที่ผิด | ⚠️ คะแนนผิดโดยไม่มีสัญญาณ | – | **RUNTIME-01** |
| Parser drop ค่า | log ลง console เท่านั้น | ✅ กลืน (dropped array ไม่ขึ้น UI) | ค่าหายจากฟอร์มแต่ยังอยู่ใน raw | ⚠️ | – | `SOURCE PROVEN` (`assessment.js:511-524`) |
| Validation ตัดค่า | ✅ มี `S.lastReadingsPresent` เก็บค่าเดิมไว้แสดงพร้อมหมายเหตุ | ไม่ | ไม่ | ไม่ | – | `SOURCE PROVEN` |
| Notion fail (create) | ✅ throw ขึ้น route | ไม่ | ⚠️ อาจสร้าง Case แล้ว dual-write ล้ม (dual-write ออกแบบเป็น non-blocking) | ไม่ | กัน duplicate ด้วย `calBookingId` | `SOURCE PROVEN` / `BLOCKED` |
| Score คำนวณไม่ได้ | ✅ `incomplete: true`, `score: null` (ไม่ใช่ 0) | ไม่ | ไม่ | ไม่ | – | `RUNTIME VERIFIED` |
| Publish fail (ไม่มี ledger) | ✅ **503** `LEDGER_REQUIRED` | ไม่ | ไม่ (หยุดก่อนเขียน) | ไม่ | idempotencyKey กัน | `SOURCE PROVEN` |
| Publish fail (pointer sync) | ⚠️ คืน `ok` + `warning` + `pointerPending:true` | กึ่งกลืน | ✅ ledger มีแล้วแต่ Case pointer ยังไม่ sync | ⚠️ เป็นไปได้ | มี state ให้ retry | `SOURCE PROVEN` |
| LINE fail (provider error) | ⚠️ **`ok:true` + `action:'failed'`** | กึ่งกลืน (บันทึก `lastNotificationError`) | ไม่ | ⚠️ ถ้าดูแค่ HTTP status จะเข้าใจผิด | ป้องกันด้วย state machine | `SOURCE PROVEN` |
| LINE ไม่มีปลายทาง | ⚠️ **`ok:true` + `action:'skipped'`** | กึ่งกลืน | ไม่ | ⚠️ เช่นเดียวกัน | – | `SOURCE PROVEN` |
| Report fail (token ไม่พบ) | ✅ 404 ชัดเจน | ไม่ | ไม่ | ไม่ | – | `RUNTIME VERIFIED` |
| API ล่มตอน dashboard reload | ⚠️ `loadJobsFromApi()` คืน `false` → มี branch ไป mock CSV | กลืน (log) | ไม่ | – | – | `SOURCE PROVEN` |
| `/api/*` path/method ไม่ตรง | ❌ **200 + HTML** | กลืนสมบูรณ์ | ไม่ | ⚠️ monitor เข้าใจผิด | – | **RUNTIME-04** |

---

# PART 14 — False Success Detection

ค้นทั้ง `api/`, `services/`, `src/js/`

| Pattern | จำนวนที่พบ | การประเมิน |
| --- | --- | --- |
| `catch {}` (ว่างเปล่าจริง) | **2** — `src/js/job-state.js:914`, `:921` (ทั้งคู่คือ `localStorage.setItem/removeItem`) | **Safe fallback** — quota/private-mode ล้มเหลวไม่ควรทำให้แอปตาย |
| `catch (e) { console.* ; ส่ง error response }` | ~70 | **Safe** — แจ้ง status code ที่ถูกต้องกลับไป (เช่น `clients-routes.js` → 502) |
| `catch (e) { console.warn(...) }` แล้วเดินต่อ | ~14 (เช่น `client-feedback.js`, `customer-domain/repository.js`, `drive-audit.js`) | **Dangerous fallback (ระดับกลาง)** — งานเสริมล้มเหลวเงียบ ๆ ไม่มี metric |
| `catch → return ok:true` | **0 ในรูปแบบตรง** แต่มี **2 เทียบเท่า**: `workflow-service.js:353` (`action:'failed'` + `ok:true`), `:280-285` (`action:'skipped'` + `ok:true`) | **Silent data corruption risk (ระดับ signal)** — ไม่ทำข้อมูลเสีย แต่ทำให้ผู้เรียกเข้าใจผิด |
| `\|\| 0` | 57 จุด | ตรวจแล้วทั้งหมด: เป็น counter, timestamp (`Date.parse(...) \|\| 0`), revision, สถิติ — **ไม่มีจุดใดอยู่บนค่าการวัดหรือคะแนนที่เผยแพร่** |
| `?? 0` | 1 จุด (`src/js/flows/score.js:609` — นับจำนวนช่องที่กรอกแล้วในข้อความ UI) | **Safe** |
| `Number(x) \|\| 0` บนคะแนน | 3 จุด: `score.js:407` (ความยาวแถบคะแนน), `score-share-card.js:198`, `:304` (วาด SVG) | **Safe แบบมีเงื่อนไข** — เป็นชั้นวาดภาพ และ `score.js:407` มี `if (loading) return` คุมอยู่ก่อน; แต่ถ้า `incomplete` แถบจะยาว 0% (อ่านได้ว่า "คะแนน 0") |
| `Number(value)` / `parseFloat(value)` บน measurement | ใช้ผ่าน `numOrUndefined` / `toFiniteReading` / `toFiniteNumber` เท่านั้น | **Safe ยกเว้น `" "`** — ดู RUNTIME-03 |
| `fallback` แบบ engine | `registry.get()` fallback ไป thailand เมื่อ key ไม่รู้จัก | **Dangerous fallback** — เงียบสนิท ไม่มี log ไม่มี error |
| `default` ค่าคะแนน | `public-routes.js:71` → `score : 65` (endpoint `/demo`) | **Dangerous (จำกัดวง)** — เป็น demo แต่ให้ภาพการ์ดที่ดูเหมือนข้อมูลจริง |
| `mock` | `loadJobsFromApi()` คืน false → dashboard ใช้ mock CSV | **Dangerous fallback** — ผู้ใช้อาจตัดสินใจจากข้อมูลปลอม |
| `localStorage` | `wm-active-case-ref`, `wm-jobs-source`, ค่าฟอร์ม | **Safe** — Notion เป็น SoT, localStorage เป็นเพียง pointer |
| `sessionStorage` | ไม่พบการใช้กับข้อมูลการวัด | — |

---

# PART 15 — Environment Parity

ดึงไฟล์จาก production (`GET` static asset) มาเทียบ hash กับ working tree ในเครื่อง

| Component | ไฟล์ | Local SHA-256 (12) | Production SHA-256 (12) | Byte parity | หลัง normalize CRLF→LF |
| --- | --- | --- | --- | --- | --- |
| Score util | `src/js/score/util/clamp.js` | `5b8d094da204` | `249f34c9f192` | ❌ (553 vs 539 B) | ✅ **เหมือนกัน** |
| Score util | `src/js/score/util/benchmarkMetadata.js` | `5880b07fdbbd` | `944ba49c03ea` | ❌ (10371 vs 10141) | ✅ เหมือนกัน |
| Quality V3 | `src/js/score/production/computeQualityScoreV2.js` | `96fe3afe999f` | `96fe3afe999f` | ✅ ตรงทุกไบต์ | ✅ |
| Validator | `src/js/score/validation/measurementValidator.js` | `57b85fe39437` | `57b85fe39437` | ✅ | ✅ |
| Registry | `src/js/score/benchmark/registry.js` | `c7de929d0423` | `5cf911a4eaf1` | ❌ (1328 vs 1327) | ✅ |
| Thailand | `benchmark/thailand/weights.js` | `96b30a1f5495` | `081e3517cab1` | ❌ (281 vs 280) | ✅ |
| Thailand | `benchmark/thailand/score.js` | `8558b1091ff4` | `8558b1091ff4` | ✅ | ✅ |
| Japan | `benchmark/japan/weights.js` | `71a77e7b6c73` | `f630a371d4fa` | ❌ (1194 vs 1172) | ✅ |
| Japan | `benchmark/japan/score.js` | `bd69e987cfe3` | `bd69e987cfe3` | ✅ | ✅ |
| WHO | `benchmark/who/weights.js` | `705fddd1ac61` | `d98a9f519584` | ❌ (187 vs 186) | ✅ |
| EU | `benchmark/eu/weights.js` | `d8af16e1533c` | `1c9116328cef` | ❌ (208 vs 207) | ✅ |
| EU | `benchmark/eu/score.js` | `2d675c2a4599` | `2d675c2a4599` | ✅ | ✅ |
| US EPA | `benchmark/usEpa/weights.js` | `111ea883ba53` | `4886edcb7a6a` | ❌ (227 vs 226) | ✅ |
| Score flow | `src/js/flows/score.js` | `05ce20703ae9` | `05ce20703ae9` | ✅ (67440 B ตรงกัน) | ✅ |
| Case state | `src/js/job-state.js` | `5f388ef60911` | `bc82fd07db8a` | ❌ (44959 vs 43767) | ✅ |

**ผลสรุป parity:**

| ข้อสรุป | รายละเอียด |
| --- | --- |
| ความต่างทั้ง 8 ไฟล์เกิดจากอะไร | **CRLF ล้วน** — นับ `\r\n` ได้ local 14/1/1/22/1/1/1/230/1192 ตัว, production **0 ตัวทุกไฟล์**; เทียบทีละบรรทัดหลัง normalize ไม่พบบรรทัดใดต่างกันเลย |
| Semantic parity | ✅ **100% (15/15 ไฟล์)** — โค้ดที่รันบน production คือชุดเดียวกับที่ตรวจในเครื่อง |
| Production version | `c0eac4e896d840a358c26193ced84a00420ede1e` |
| Origin / Staging | 🔴 **BLOCKED — ENVIRONMENT GAP** — ไม่มี staging environment ให้เทียบ |
| Runtime parity ของ server-side (api/, services/) | 🔴 **BLOCKED** — ไม่ถูก serve เป็น static asset จึงเทียบ byte ไม่ได้; ยืนยันได้แค่ระดับ commit SHA |

> ⚠️ **ข้อควรระวังจาก parity นี้:** ผล `RUNTIME VERIFIED` ทั้งหมดใน PART 5–8 เป็นการรันไฟล์ในเครื่อง ซึ่งพิสูจน์แล้วว่า **byte-identical (หลัง normalize) กับ production** ⇒ ถือเป็นหลักฐานที่ใช้แทนพฤติกรรม production ได้เฉพาะ "ชั้นคำนวณคะแนนล้วน" เท่านั้น **ไม่รวม** ชั้น browser, network, Notion, LINE

---

# PART 16 — Untested Node Inventory

| Node | Tested? | Evidence | Risk | ทำไมยังไม่ถูกทดสอบ |
| --- | --- | --- | --- | --- |
| Website CTA → Cal.com | `BLOCKED` | — | กลาง | อยู่นอกระบบ ต้องสร้าง booking จริง |
| Cal.com payload | `BLOCKED` | — | **สูง** | ห้ามสร้าง booking (กฎข้อ 4) |
| Signature verification (reject path) | `UNIT ONLY` | มี unit; runtime ต้อง POST | **สูง** | ต้อง POST → ขัดกฎ read-only |
| Payload validation | `UNIT ONLY` | `tests/` | กลาง | ต้องมี staging |
| Campaign mapping | `UNIT ONLY` | `tests/` | ต่ำ | — |
| `createCase()` | `BLOCKED` | — | **สูง** | ห้ามสร้าง Case ใน production |
| Notion persistence | `BLOCKED` | — | **สูง** | เขียน production |
| Case rehydration | `UNIT ONLY` | `tests/case-persistence-rehydration.test.js` | **สูง** | ต้องมี browser จริง |
| `loadJobsFromApi()` branch mock CSV | `UNKNOWN` | ไม่มี test | **สูง** | ต้องจำลอง API ล่ม |
| Measurement input (ฟอร์ม) | `SOURCE PROVEN` | call site | กลาง | ต้องมี browser |
| OCR call | `BLOCKED` | 405 บน GET | **สูง** | ต้องมีรูปจริง + auth |
| `mapOcrDataToMeterReadings` false-zero filter | `UNKNOWN` | ไม่มี test | **สูง** | ไม่เคยถูกมองว่าเป็นจุดเสี่ยง |
| ConversionEngine | `RUNTIME VERIFIED` | รันจริงในรอบนี้ | ต่ำ | — |
| **`readingsFromTapData` precedence** | `UNKNOWN` → รอบนี้ `RUNTIME VERIFIED` (พบ defect) | RUNTIME-01 | 🔴 **สูงสุด** | ไม่มี test ใดสร้าง tap ที่ std ≠ meter |
| Multi-tap averaging | `UNKNOWN` → รอบนี้ `RUNTIME VERIFIED` (พบ defect) | RUNTIME-02 | สูง | ไม่มี fixture หลาย tap |
| MeasurementValidator | `RUNTIME VERIFIED` | PART 5 | ต่ำ | — |
| Quality V3 | `RUNTIME VERIFIED` | PART 6 | ต่ำ | — |
| Country engines × 5 | `RUNTIME VERIFIED` | PART 6-8 | ต่ำ | — |
| Registry unknown-key fallback | `RUNTIME VERIFIED` (พบพฤติกรรมเงียบ) | PART 7 | กลาง | ไม่มี test เดิม |
| Severity / ceiling | `RUNTIME VERIFIED` | PART 8 | ต่ำ | — |
| Japan band cliff (7.29/7.30) | `UNKNOWN` | ไม่มี boundary test | กลาง | ไม่เคยระบุเป็น requirement |
| `resolveDisplayedScore` (Hero vs Published) | `UNIT ONLY` | `displayed-score-country-switch.test.js` | กลาง | ต้องมี Case ที่ publish แล้ว |
| Publish / ledger | `UNIT ONLY` + `BLOCKED` | — | **สูง** | ห้าม publish |
| Public report | `RUNTIME VERIFIED (negative)` | 404 จริง | กลาง | positive path ต้องมี Case จริง |
| Score card guard | `RUNTIME VERIFIED (negative)` | 404 จริง | ต่ำ | — |
| `cardOptionsFromJob` null→0 | `RUNTIME VERIFIED` (latent) | PART 10 | ต่ำ (ปัจจุบัน) | มี caller เดียวและมี guard |
| LINE state machine | `SOURCE PROVEN` เท่านั้น | — | **สูง** | ห้ามส่ง LINE + ไม่มี unit test |
| API catch-all 404 | `RUNTIME VERIFIED` (พบ defect) | RUNTIME-04 | กลาง | ไม่มีใครทดสอบ path/method ผิด |
| Dashboard rendering | `BLOCKED` | 401 จริง | กลาง | ต้อง login |
| Feedback flow | `RUNTIME VERIFIED (negative)` | 404 จริง | กลาง | positive path ต้องมี token จริง |
| `weakestLinkShare` dead config | `RUNTIME VERIFIED` (ยืนยันว่าไม่ถูกใช้) | PART 6.8 | กลาง | test เดิมทดสอบ "ค่ามีอยู่" ไม่ได้ทดสอบ "ถูกใช้" |

---

# PART 17 — Final QA Coverage Map

## A. เส้นทางที่พิสูจน์ครบ (RUNTIME VERIFIED)

| เส้นทาง | หลักฐาน |
| --- | --- |
| readings → grade → weight → weighted aggregate | 30/30 ช่อง ตรงกับสูตรที่คำนวณอิสระ |
| weighted aggregate → severity → gate → ceiling → คะแนนสุดท้าย | ครบทุก stage ของ 6 fixture × 5 engine |
| Quality V3 (flat weight ทั้ง 6 param) | เกรดรายตัว + flat mean + score ครบทุก fixture |
| การแยก Quality V3 ออกจาก Country Hero | Q-V3 ของ FX-1328 = 92 ขณะ TH = 95, JP = 85 |
| Japan / Thailand ไม่คิด DO | คะแนนนิ่งแม้ DO เปลี่ยน 0→25 |
| severity เป็นเพดานไม่ใช่พื้น | raw 50 + FAIL = 44 (ไม่ใช่ 75) |
| Hero ceiling 99 | 120/100 → 99, 98 → 98, 0 → 0 |
| monotonicity 29/30 ชุด | ไล่ค่า 6 ค่าต่อ parameter |
| missing ≠ 0 และ invalid ≠ 0 | ตาราง 15 ค่า (PART 5) |
| การแยก state ระหว่าง engine | ไม่มี shared mutable state, weights ทั้งหมด frozen |
| ConversionEngine + provenance ledger | ทุกการแปลงบันทึกใน `applied[]` |
| byte parity ของ scoring source กับ production | 15/15 ไฟล์เหมือนกันหลัง normalize CRLF |
| negative path ของ public API | 404/401/405 ตรงตามที่ควรเป็น |

## B. เส้นทางที่พิสูจน์เฉพาะ Unit (ห้ามนับเป็น runtime)

| เส้นทาง | test ที่มี |
| --- | --- |
| Case rehydration / reload | `tests/case-persistence-rehydration.test.js` |
| Cal payload validation + dedupe | `tests/` ชุด cal-* |
| publication idempotency | ชุด publication test |
| การสลับประเทศบนหน้าจอ (`S.scoreVal` คงที่) | `displayed-score-country-switch.test.js` |
| fixture ทั้ง 6 | `tests/score/*.test.js` (รอบนี้ยืนยันซ้ำด้วยการรัน engine ตรง) |

## C. เส้นทางที่ Runtime ยังไม่เคยวิ่งจริง

1. Website → Cal.com → Webhook → `createCase` → Notion (ทั้งเส้น)
2. Case rehydration ใน browser จริง (reload / restart / A→B→A)
3. OCR รูปจริง → raw token → parser
4. publish → ledger → token → `/r/:token` (positive path)
5. LINE: `not_sent → sending → sent` / `→ failed` / retry
6. Dashboard หลัง login
7. Feedback positive path
8. HTTP 400 / 403 / 409 / 422 / 500 / 502 / 503

## D. จุดที่ข้อมูลเปลี่ยนระหว่างทาง

| จุด | การเปลี่ยน | ตรวจย้อนได้? |
| --- | --- | --- |
| `mapOcrDataToMeterReadings` | ทิ้งค่า 0 ของ ph/temp/turbidity | ❌ log console เท่านั้น |
| `ConversionEngine` | `ec × 0.5 → tds`, `°F → °C` | ✅ มี `applied[]` |
| `ConversionEngine` | `do_percent` **ไม่แปลง** → DO หายจากคะแนน | ✅ อยู่ใน `missing[]` |
| `toFiniteNumber(' ') → 0` | whitespace → 0 | ❌ |
| `readingsFromTapData` | `standardMeasurement` ทับ `meterReadings` | ❌ ไม่มีร่องรอย |
| multi-tap | ค่า tap ที่ไม่มี std ถูกตัดออกจากค่าเฉลี่ย | ❌ |
| severity / gate / ceiling | กดคะแนนลง | ✅ มี sub-object ครบ (จุดแข็ง) |
| Hero vs Published | คนละตัวเลขโดยการออกแบบ | ✅ มี `source` field |

## E. จุดที่มี fallback

| จุด | ประเภท |
| --- | --- |
| `registry.get()` → thailand เมื่อ key ไม่รู้จัก | 🟠 Dangerous (เงียบ) |
| `loadJobsFromApi()` → mock CSV | 🟠 Dangerous |
| `/api/*` ไม่ตรง → SPA HTML 200 | 🟠 Dangerous |
| `/api/public/score-card/demo` → 65 | 🟡 จำกัดวง |
| `cardOptionsFromJob` → 0 | 🟡 latent (มี guard คุม) |
| `notificationStatus` อ่านไม่ได้ → `'not_sent'` | ✅ Safe |
| `campaignOffer` ว่าง → `PAID_ASSESSMENT` | 🟡 เปลี่ยนเนื้อหาข้อความ |
| `catch {}` บน localStorage | ✅ Safe |
| chlorine 3 ชั้น (`standard → freeChlorine → chlorine`) | 🟡 ควรมี test |

## F. จุดที่มี silent failure risk

1. OCR อ่านค่าผิดแต่สำเร็จ → คะแนนผิดโดยไม่มีสัญญาณเตือน (**RUNTIME-01**)
2. การแก้ค่าด้วยมือไม่มีผลต่อคะแนน (**RUNTIME-01 case B**)
3. ค่าของ tap อื่นถูกตัดออกจากค่าเฉลี่ย (**RUNTIME-02**)
4. `" "` → 0 ผ่าน 3 ชั้นป้องกัน (**RUNTIME-03**)
5. `/api/*` ผิด path/method → 200 (**RUNTIME-04**)
6. LINE ส่งไม่สำเร็จแต่ตอบ `ok:true`
7. LINE ไม่มีปลายทางแต่ตอบ `ok:true`
8. registry fallback ไป thailand เงียบ ๆ
9. dashboard ใช้ mock CSV เมื่อ API ล่ม
10. `weakestLinkShare` + คอมเมนต์ที่ขัดกับโค้ด ทำให้คนแก้ไขในอนาคตเข้าใจสูตรผิด

## G. จุดที่ยังไม่มี test

| # | จุด | ความเสี่ยง |
| --- | --- | --- |
| G-1 | `readingsFromTapData` precedence (std vs meter) | 🔴 |
| G-2 | multi-tap averaging ข้าม layer | 🔴 |
| G-3 | false-zero filter ฝั่ง UI เทียบกับฝั่ง engine | 🔴 |
| G-4 | `" "` / `[]` / `true` ที่ระดับ input boundary | 🟠 |
| G-5 | LINE state machine ทั้งชุด | 🔴 |
| G-6 | `/api/*` catch-all 404 / method mismatch | 🟠 |
| G-7 | `loadJobsFromApi()` branch ที่ล้มเหลว | 🟠 |
| G-8 | registry unknown-key fallback | 🟠 |
| G-9 | Japan band boundary (7.29 / 7.30 / 7.70 / 7.71) | 🟡 |
| G-10 | `weakestLinkShare` ว่า "ไม่ถูกใช้" (test ป้องกันการเปิดใช้โดยไม่ตั้งใจ) | 🟡 |
| G-11 | `cardOptionsFromJob` null → 0 | 🟡 |
| G-12 | ไม่มี `npm test` / CI / git hook — test ทั้ง 258 ต้องรันมือทั้งหมด | 🔴 |

## H. จุดที่ BLOCKED เพราะไม่มี Staging

| # | รายการ |
| --- | --- |
| H-1 | สร้าง booking Cal.com จริง |
| H-2 | webhook POST (ทั้ง valid และ invalid signature) |
| H-3 | `createCase` + Notion persistence |
| H-4 | Case reload / restart / สลับ Case ใน browser จริง |
| H-5 | OCR ด้วยรูปจริง |
| H-6 | publish + publication ledger + token |
| H-7 | `/r/:token` positive path |
| H-8 | ส่ง LINE ทุก transition |
| H-9 | HTTP 400 / 403 / 409 / 422 / 500 / 503 |
| H-10 | Dashboard หลัง login + feedback positive path |
| H-11 | Environment parity ของ `api/` + `services/` (ไม่ถูก serve เป็น static) |

---

# Final Verdict

```text
SYSTEM QA STATUS

Score Mathematics        : VERIFIED   (runtime, 30/30 ช่อง + invariant ครบ)
Country Engine Isolation : VERIFIED   (weights frozen, ไม่มี shared state, DO ถูกกันออกจริง)
Measurement Lineage      : PARTIAL — พบ defect (RUNTIME-01/02/03: ค่าที่ผู้ใช้เห็น ≠ ค่าที่ engine ใช้)
Case Persistence         : BLOCKED    (unit only; ไม่มี runtime evidence)
API Boundary             : PARTIAL — พบ defect (RUNTIME-04: /api/* ที่ไม่ตรงคืน 200 HTML)
Publication              : BLOCKED    (ห้าม publish; source proven เท่านั้น)
Report/Card              : PARTIAL    (negative path VERIFIED, positive path BLOCKED)
LINE                     : BLOCKED    (source proven; ไม่มี unit test, ห้ามส่งจริง)
Dashboard                : BLOCKED    (401 ยืนยันแล้ว, ที่เหลือต้อง login)
Full E2E                 : BLOCKED — ENVIRONMENT GAP (ไม่มี Staging)
```

## ถ้าระบบพังในแต่ละจุด เรามี test/evidence ที่จะจับมันได้หรือไม่?

| จุดที่อาจพัง | จับได้หรือไม่ | เครื่องมือที่จะจับ |
| --- | --- | --- |
| สูตรคะแนน / น้ำหนัก / เกรด เปลี่ยน | ✅ **จับได้** | fixture lock 6 ชุด × 5 engine (แต่ต้องรันมือ) |
| severity / ceiling / gate เปลี่ยน | ✅ จับได้ | `country-hero-ceiling.test.js` + stage sub-object |
| engine อ่านน้ำหนักประเทศอื่น | ✅ จับได้ | `country-sensitivity-audit.test.js` + frozen weights |
| DO หลุดเข้าคะแนนไทย/ญี่ปุ่น | ✅ จับได้ | fixture + DO sweep |
| `null` กลายเป็น 0 ในคะแนน | ✅ จับได้ | validator test + `incomplete` contract |
| **OCR อ่านผิดแล้วช่างแก้ไม่ติด** | ❌ **จับไม่ได้** | ไม่มี test ที่ std ≠ meter |
| **ค่า 0 จาก OCR เข้าคะแนนทั้งที่จอว่าง** | ❌ **จับไม่ได้** | ไม่มี test |
| **ค่าของ tap ที่ 2 หายจากค่าเฉลี่ย** | ❌ **จับไม่ได้** | ไม่มี fixture หลาย tap |
| **`" "` → 0** | ❌ **จับไม่ได้** | validator จัดเป็น MISSING แล้วไม่ตัด |
| Cal webhook หยุดสร้าง Case | ❌ **จับไม่ได้** | ไม่มี synthetic monitor; ไม่มี alert |
| Notion เปลี่ยนชื่อ property | ⚠️ จับได้บางส่วน | `/api/ops/readiness` บอกแค่ `notion: ready` |
| publish เขียน ledger แต่ pointer ไม่ sync | ⚠️ มี state (`pointer_pending`) แต่ไม่มีคนเฝ้า | ไม่มี alert |
| **LINE ส่งไม่ออกทุก Case** | ❌ **จับไม่ได้จากสถานะ HTTP** | ต้องอ่าน `action`/`line.ok` ซึ่งไม่มี test/monitor |
| **API route หาย / method เปลี่ยน** | ❌ **จับไม่ได้** | GET ที่ผิดคืน 200 HTML → monitor เห็นเขียวตลอด |
| **Dashboard แสดง mock CSV เพราะ API ล่ม** | ❌ **จับไม่ได้** | ไม่มี test, ไม่มี banner เตือนผู้ใช้ |
| deploy โค้ดไม่ตรงกัน | ✅ จับได้ | parity check (byte-level) แบบที่ทำในรอบนี้ |
| test พังแต่ deploy ผ่าน | ❌ **จับไม่ได้** | ไม่มี CI gate เลย (`render.yaml` ไม่รัน test) |

## จุดที่ระบบสามารถพังแล้ว QA ปัจจุบัน "ไม่รู้"

| ลำดับ | จุด | ความรุนแรง | สาเหตุที่ QA ไม่รู้ |
| --- | --- | --- | --- |
| 1 | **RUNTIME-01** — `standardMeasurement` (OCR) ทับค่าที่ช่างเห็นและแก้ไข → คะแนนที่ลูกค้าได้รับผิด (พิสูจน์แล้ว: 60 หรือ 75 แทนที่จะเป็น 94) | 🔴 สูงสุด | test ทุกชุดป้อน readings ตรงเข้า engine ไม่มีชุดใดสร้าง tapData ที่สองชั้นข้อมูลขัดกัน |
| 2 | **RUNTIME-02** — ค่าของ tap ที่ไม่มี `standardMeasurement` หายจากค่าเฉลี่ยทั้งหมด | 🔴 สูง | ไม่มี fixture หลาย tap |
| 3 | **G-12** — ไม่มี `npm test` / CI / git hook → โค้ดที่ทำ fixture พังยัง deploy ได้ | 🔴 สูง | ไม่เคยมีการตรวจ infrastructure ของ test เอง |
| 4 | **LINE** — ส่งไม่สำเร็จแต่ API ตอบ `ok:true` และไม่มี test ครอบ state machine | 🔴 สูง | ห้ามส่งจริง + ไม่มี unit test |
| 5 | **RUNTIME-04** — `/api/*` ที่ผิด path/method คืน 200 HTML | 🟠 กลาง | ไม่มีใครทดสอบ negative HTTP contract |
| 6 | **RUNTIME-03** — `" "` เจาะ guard ได้ทุกชั้นที่อยู่บนเส้น raw → standard | 🟠 กลาง | test ตรวจ `null`/`''` แต่ไม่ตรวจ whitespace |
| 7 | registry fallback ไป thailand เมื่อ key ไม่รู้จัก | 🟠 กลาง | test ใช้ key ที่ถูกต้องเสมอ |
| 8 | dashboard fallback ไป mock CSV | 🟠 กลาง | ไม่มีการจำลอง API ล่ม |
| 9 | `weakestLinkShare` เป็น dead config + คอมเมนต์ขัดกับโค้ด | 🟡 ต่ำ-กลาง | test ตรวจว่า "ค่ามีอยู่" ไม่ได้ตรวจว่า "ถูกใช้" |
| 10 | Japan band cliff (pH 7.2 → 85 แต่ 7.3 → 99) | 🟡 ต่ำ | ไม่มี boundary test และไม่มีเอกสารระบุว่าตั้งใจให้กระโดด |

---

## ภาคผนวก — วิธีการเก็บหลักฐานในรอบนี้

| ประเภท | รายละเอียด |
| --- | --- |
| การรัน scoring modules | โหลดไฟล์จริงจาก `src/js/score/**` เข้า `vm` sandbox แล้วเรียกฟังก์ชัน production ตรง ๆ (6 fixture × 5 engine, coercion 15 ค่า, DO sweep 6 ค่า, monotonicity 30 ชุด, severity 6 ชุด) |
| การรัน measurement pipeline | โหลด `src/js/conversion/engine.js` และ `src/js/flows/score.js` จริง (stub DOM) แล้วเรียก `toStandardMeasurement()`, `readingsFromTapData()`, `mergeReadingLayers()`, `readingsFromFieldMap()` |
| การรัน card renderer | `require('./services/score-share-card.js')` แล้วเรียก `cardOptionsFromJob()` ด้วย 8 ค่า |
| Production probe | `GET` 15 endpoint + `GET` static asset 15 ไฟล์ (ไม่มี POST/PUT/DELETE) |
| การเปลี่ยนแปลงระบบ | ไม่มี — ไม่แตะ `src/`, `api/`, `services/`, `tests/`, Notion, LINE, การ deploy; สคริปต์ probe อยู่ใน `.tmp_probe/` (โฟลเดอร์ชั่วคราวที่ไม่อยู่ใน build) |

## ข้อเสนอลำดับถัดไป (ยังไม่ดำเนินการ — รออนุมัติ)

| ลำดับ | งาน | เหตุผล |
| --- | --- | --- |
| 1 | ยืนยัน RUNTIME-01 ว่าเป็น defect หรือเป็นการออกแบบ กับเจ้าของผลิตภัณฑ์ | เป็นเรื่องความถูกต้องของคะแนนที่ลูกค้าได้รับ ต้องตัดสินใจก่อนเขียนโค้ดใด ๆ |
| 2 | สร้าง Staging environment | ปลด `BLOCKED` 11 รายการใน PART 17-H |
| 3 | เพิ่ม `npm test` + CI gate | ปิด G-12 ซึ่งเป็นเหตุให้ทุก fixture lock ไม่มีผลบังคับ |
| 4 | เพิ่ม test ที่ std ≠ meter, multi-tap, `" "`, LINE state machine, `/api/*` 404 | ปิด G-1 ถึง G-8 |
