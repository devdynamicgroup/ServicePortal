# 10 — Deep QA Execution Trace (Source-Verified)

> **Purpose.** The Master Test Case Matrix (`08_MASTER_TEST_CASE_MATRIX.md`, 258 cases) answers *"did each case pass?"*.
> This document answers a different question: **"does the current QA set actually cover the system's real execution path, and if the system breaks tomorrow, would we know?"**
>
> **Method.** Every claim here is traced to source (`file:line`) or explicitly marked `NOT FOUND` / `NOT VERIFIED` / `NOT DEFINED`. Nothing is inferred from test names or from prior docs.
>
> **Mode.** Read-only. No production source, scoring source, test, or expected value was modified. No Case created, nothing published, no LINE sent, no Notion mutation. Production was touched only with idempotent `GET` probes.

| Field | Value |
| --- | --- |
| Generated | 2026-08-20 |
| HEAD / origin/main / production | `c0eac4e896d840a358c26193ced84a00420ede1e` |
| Baseline matrix | `08_MASTER_TEST_CASE_MATRIX.md` (258 cases) |
| Baseline results | `09_FULL_SYSTEM_TEST_RESULTS.json` (113 PASS / 0 FAIL / 134 BLOCKED / 11 NOT RUN) |
| Test files under `tests/` | 40 (tracked) |
| Automated test runner | **NONE** — see Gap G-01 |

---

## 0. Headline findings

| # | Finding | Class | Section |
| --- | --- | --- | --- |
| G-01 | No `npm test`, no CI workflow, no git hook. All 258 cases are manual. | **Infrastructure defect** | §14 |
| G-02 | `tests/` covers scoring/publish/eligibility only. Zero tests for `api/*-routes.js`, Cal adapter, LINE state machine, feedback, OCR proxy, Notion mapper HTTP paths. | **Coverage gap** | §6 |
| G-03 | `weakestLinkShare` exists in all 5 `limits.js` but is read by **no code**; a test asserts the constant. | **Dead config + false coverage** | §8, §14 |
| G-04 | 72 of 113 PASS rows share one evidence string (a single unit-lock bundle), including `E2E-007` whose declared environment is Staging. | **False coverage** | §8 |
| G-05 | Displayed Hero (country engine) ≠ published score (Quality V3) by design, but no test asserts the invariant end-to-end through publish. | **Untested transition** | §7, §11 |
| G-06 | Multi-tap scoring averages **all** taps, including taps the operator is not viewing. No test covers the averaging semantics. | **Untested behavior** | §7 |
| G-07 | `loadJobsFromApi()` returning `false` makes the app fall back to `clients_30_mock_data.csv` (mock data on a real dashboard). No test covers this branch. | **Latent risk, untested** | §10, §14 |
| G-08 | Matrix `API-006` guesses 500 for malformed JSON; source yields **502**. | **Doc/source divergence** | §9 |
| G-09 | Registry `get()` silently falls back to Thailand for an unknown country key. No test. | **Untested failure path** | §9 |
| G-10 | Cal `BOOKING_CANCELLED` / `BOOKING_RESCHEDULED` have no handler (by design) — so a customer cancelling in Cal leaves the Case live. | **Requirement gap** | §14 |

---

## 1. Actual System Execution Map

Reconstructed from source, not from the assumed diagram in the request. Two of the assumed transitions do **not** exist in this repository.

### 1.1 Intake

| From | To | File:line | Function | Trigger | Data passed | Persistence boundary | Error path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Framer site | Offer status | `api/public-routes.js:139` | `handlePublicRoute` → `getOfferStatus` | `GET /api/public/water-check-offer` | none | reads Notion via `getAllClients()`, 60 s cache | **502** `Offer status is temporarily unavailable` |
| Framer site | Cal.com booking UI | **NOT FOUND** | — | CTA click | — | external (Cal.com) | n/a — booking UI is not in this repo |
| Framer site | Case creation | **NOT FOUND** | — | — | — | — | `POST /api/cases` requires staff auth; the public site cannot create a Case |
| Cal.com | Webhook body | `api/cal-routes.js:76` | `readRawBody` | `POST /api/cal/webhook` | raw bytes, 1 MiB limit | in-memory buffer | **400** `Request body too large` |
| Webhook | Signature gate | `api/cal-routes.js:83-99` | `verifyCalSignature` (`services/cal-webhook.js:9-29`) | after body read | raw body + `x-cal-signature-256` | none | **401** `Invalid Cal signature` |
| Webhook | Unsigned path | `api/cal-routes.js:100-105` | `isCalWebhookConfigured` | `CAL_WEBHOOK_SECRET` unset | — | none | **no rejection** — warn `cal_webhook_secret_missing`, processing continues. Production probe: `hasWebhookSecret: true`, so not active in prod |
| Webhook | JSON parse | `api/cal-routes.js:107-114` | inline | after signature | UTF-8 string | parsed payload | **400** `Invalid JSON` |
| Webhook | Delivery dedupe | `api/cal-routes.js:117-118` | `buildDedupeKey`, `noteCalDelivery` | every POST | dedupe key | **process-local Map (non-durable)** | none — does not block the adapter |
| Webhook | Non-`BOOKING_CREATED` | `api/cal-routes.js:135-146` | `handleCalRoute` | any other trigger | envelope summary | none | **200** ack, `processed:false`, `createsCases:false` |
| Webhook | Adapter | `api/cal-routes.js:150` | `processBookingCreated` | `BOOKING_CREATED` | full payload | Notion (downstream) | **400** validation / **502** default |
| Adapter | Field extraction | `services/cal-booking-adapter.js:56-79` | `extractBookingCreatedFields` | — | uid, name, email, phone, lineId, address, eventTypeId, start/end, utcOffset | none | — |
| Adapter | Rejections | `services/cal-booking-adapter.js:118-120` | `rejectPayload` (`:32` sets 400) | missing field | — | none | **400** `Missing Cal booking identifier (uid)` / `Missing attendee name` / `Missing appointment start/end time` |
| Adapter | Dedupe (durable) | `services/cal-booking-adapter.js:123` | `findClientByCalBookingId` (`services/notion/clients.js:167`) | before create | `calBookingId` | **Notion query — the real idempotency SoT** | existing Case returned → route **200** `duplicate:true` |
| Adapter | Concurrency lock | `services/cal-booking-adapter.js:122` | `withCaseLock('cal-booking:'+uid)` (`services/workflow-service.js:40`) | concurrent replay | lock key | **in-process only** — no cross-instance guarantee | errors propagate |
| Adapter | Case creation | `services/cal-booking-adapter.js:134` | `createCase` | validated payload | customer + `{skipMap:true, source:'cal.com'}` | Notion | propagates |

### 1.2 Case creation and persistence

| From | To | File:line | Function | Data passed | Persistence boundary | Error path |
| --- | --- | --- | --- | --- | --- | --- |
| Route/adapter | Validation | `services/case-creation-service.js:134` | `validateCustomerInput` (`services/booking-validation.js:6`) | `fullName` only required | none | **400** `Full Name is required` |
| createCase | Campaign resolution | `services/case-creation-service.js:119-127` | `resolveCampaignOffer`; `services/cal-offer-mapping.js:21` `resolveCampaignAttribution` | eventTypeId `6040165` → `Launch Offer 2026` | Case field only | unknown event → no launch flag |
| createCase | Token mint | `services/case-creation-service.js:139-140` | `generateFeedbackToken` / `generateReportToken` (`services/case-tokens.js`) | prefixes `fb-`, `rpt-` | Notion props | **500** `Could not generate unique fb/rpt token` |
| createCase | System defaults | `services/case-creation-service.js:60-73` | `buildSystemDefaults` | `caseWorkflowStatus:'scheduled'`, `notificationStatus:'not_sent'`, `feedbackStatus:'not_sent'`, `reviewStatus:'not_requested'` | Notion | — |
| createCase | Notion write | `services/notion/clients.js:457` | `createClient` → `buildNotionProperties(:391)` → `notion.pages.create` | mapped props via `FIELD_ALIASES` (`services/notion/mapper.js:4`) | **Notion page = SoT** | throws → **502** `NOTION_API_KEY and NOTION_DATABASE_ID must be configured` or API message |
| Notion | Job shape | `services/notion/mapper.js:234-274` | `notionPageToJob` | returns both `notionId` (UUID) and `id` (compact UUID) | — | unknown/missing schema columns silently skipped |
| SPA | `POST /api/cases` | `api/case-flow-routes.js:604-626` | `assertAppAuth` → `readJson` → `withIdempotency` → `createCase` | JSON body | Notion | **401/403** auth; **400** validation; **502** everything else incl. malformed JSON; success **201** |

### 1.3 Rehydration

| From | To | File:line | Function | Data passed | Persistence boundary | Error path |
| --- | --- | --- | --- | --- | --- | --- |
| Boot | API load | `src/js/app.js:7-8` | `loadJobsFromApi` | `GET /api/clients` | replaces `JOBS` | `false` → CSV/localStorage fallback (`app.js:10-17`) |
| API | JOBS replace | `src/js/job-state.js:1130` | `JOBS.splice(0, JOBS.length, ...normalizedJobs)` | Notion jobs + preserved drafts | `localStorage` `wm-jobs` | try/catch at `:1045`/`:1167` |
| API | Local-only preservation | `src/js/job-state.js:1078-1091, 1131-1138` | `collectLocalOnlyUnsyncedJobs`, `preservedManualJobs` | manual + unsynced Cases re-appended | localStorage | `manualPending && !notionId` excluded |
| Operator | Active Case ref | `src/js/job-state.js:31-45` | `persistActiveCaseRef` | `{id, notionId, date}` | `localStorage` `wm-active-case-ref` | silent warn on quota |
| Cold boot | Active Case restore | `src/js/job-state.js:98-111, 1152-1155` | `restoreActiveCaseFromPersistence` | ref + JOBS | none | `null` if Case not in list |

### 1.4 Measurement

| From | To | File:line | Function | Data passed | Persistence boundary | Error path |
| --- | --- | --- | --- | --- | --- | --- |
| Camera/photo | OCR proxy | `api/ocr-proxy-routes.js:37-108` | `handleOcrProxyRoute` → `readMeter` | `{image_url, meter_type}` | none (stateless proxy) | **405** `Use POST /api/ocr/read-meter`; **400** `image_url and meter_type are required`; OCR failures returned as **HTTP 200** with `{success:false, error:'OCR_*'}` |
| OCR response | Form/tap keys | `src/js/flows/assessment.js:475-525` | `mapOcrDataToMeterReadings` | ph, tds, ec, temp, turbidity, orp, do, doPercent | `tap.meterReadings` | **false-zero filter drops `0` for `ph`/`temp`/`turbidity` only** (`:510-514`) |
| OCR chlorine | `freeChlorine` | `src/js/flows/assessment.js:781-845` | `detectChlorineFromImage` | `body.data.chlorine` | `tap.chlorineReadings` | empty readings on failure |
| Raw + standard | Conversion | `src/js/flows/assessment.js:605-644` → `src/js/conversion/engine.js:164-283` | `storeRawAndStandardMeasurements` → `toStandardMeasurement` | EC→TDS factor 0.5, °F→°C; DO% never invented | `Object.freeze` on both snapshots | conversion absent → key stays missing |
| Manual field edit | `meterReadings` only | `src/js/flows/assessment.js:1478-1480` | `persistMeterReadings` | DOM `#m-*` values | tap | **does not refresh `standardMeasurement`** — see §11 C-03 |
| Tap data | Score input | `src/js/flows/score.js:799-805` | `resolveScoreReadingsPresent` → `readingsFromTapData(:718)` + `readingsFromFieldMap(:689)` | `standardMeasurement ?? meterReadings` per key, **averaged across all taps** | none | non-numeric → `undefined` via `numOrUndefined(:683)` |
| Score input | Validator gate | `src/js/flows/score.js:878-902` | `MeasurementValidator.validateMeasurements` | strips `IMPLAUSIBLE` / `INVALID_TYPE` scored keys | `S.lastReadingsValidation` | browser-only wiring (guarded by `typeof`) |
| Draft | Notion snapshot | `services/assessment-persistence-service.js` via `POST /api/cases/:id/assessment` (`api/case-flow-routes.js:589`) | `submitCaseAssessment` | meter + standard + chlorine | Notion `Assessment Snapshot` | stale revision → `{skipped:true, reason:'stale_revision'}`; **`rawMeasurement` is not in the snapshot schema** |

### 1.5 Scoring

See §3 and §4. Two independent computations, not a chain:

| From | To | File:line | Function | Output |
| --- | --- | --- | --- | --- |
| readings | Quality V3 | `src/js/score/production/computeQualityScoreV2.js:247-269` | `computeQualityScoreDetail` | `S.scoreVal` — published/shared value, can reach 100 |
| readings | Country Hero | `src/js/score/benchmark/registry.js:32` → `{country}/score.js` | `calculate` | `S.comparisonScoreResult` — displayed value, capped at 99 |
| both | Gauge decision | `src/js/flows/score.js:265-294` | `resolveDisplayedScore` | live = country; `publicView` = published Quality V3 |

### 1.6 Publication and communication

| From | To | File:line | Function | Data passed | Persistence boundary | Error path |
| --- | --- | --- | --- | --- | --- | --- |
| Share button | `POST /api/cases/:id/score` | `src/js/flows/score.js:1483-1565` | `shareScore` | `{score: S.scoreVal, complianceStatus, intent:'publish', idempotencyKey}` | — | toast only; gate is `canCalculateScore` (`:1502`) |
| Close flow | same endpoint | `src/js/common.js:89-164` | `publishScoreBeforeClose` | same shape | — | throws `NOT_ELIGIBLE`; gate is `canPublishReport` (`:100-111`) |
| Route | Publication service | `api/case-flow-routes.js:574-586` | `publishCaseScore` (`services/workflow-service.js:385`) | body + `Idempotency-Key` header | — | **404** Case not found; **400** score range; **503** `LEDGER_REQUIRED`; **502** default |
| Service | Ledger + pointer | `services/score-publication-service.js:192-300` | `createOrReusePublication` | snapshot, `scoreType:'quality-v3'` | **Notion publications DB = immutable ledger**; Case pointer is a cache | **409** `TOKEN_DUPLICATE` on resolve; **502** token mint exhaustion; `{pointerPending:true}` when pointer write fails |
| closeCase | implicit publish | `services/workflow-service.js:469-485` | `closeCase` | publishes when no pointer and finite score | ledger | propagates |
| Token | Public report | `services/case-flow.js:14-18` | `getReportByToken` → `resolveReportByToken`, then **full-scan fallback** over all Cases | token | ledger snapshot overlays `result.waterScore` (`services/score-publication-snapshot.js:106-120`) | **404** `Report not found`; **409** duplicate |
| Route | `/r/:token`, `/api/report/:token` | `api/case-flow-routes.js:755-763` and HTML route | — | full job object embedded in HTML (`:253-256`) | — | 404/409/502 |
| Token | Score card PNG | `api/public-routes.js:83-117` | `handleScoreCardRoute` | `job.result.waterScore` | PNG, `Cache-Control: public, max-age=300` | **404** `Score not published` (`:105`); **409** conflict; **502** render |
| Card options | SVG score | `services/score-share-card.js:645-658` | `cardOptionsFromJob` | — | — | **null score → `0`** |
| closeCase | LINE send | `services/workflow-service.js:237-354` | `executeSendCaseResult` | Case + reportUrl | Notion `notificationStatus` state machine | **409** `Case is not completed yet`; **422** `Report URL is missing for this case`; `already_sent` / `already_sending` / `no_line_user_id` early returns; failure → `notificationStatus:'failed'` |
| Send | LINE push | `services/line-notifications.js:71-75, 518-520, 686-688` | `sendCaseResultNotification` | flex with score in header + score-card image | LINE API | mock-send when token absent; text fallback contains link only, no score |
| LINE | Webhook in | `api/line-routes.js:663-666` | `verifyLineSignature` | raw body + signature | — | **401** `Invalid LINE signature` |
| Dashboard | Case list | `api/clients-routes.js:47-66` → `src/js/flows/dashboard.js:262-296` | `buildApptCard` | name, address, time, tags — **no score on the card** | JOBS | **401** unauth; **503** Notion unconfigured; **502** fetch failure |
| Feedback | Submit | `api/case-flow-routes.js:773-787` → `services/workflow-service.js` `recordFeedback` | token lookup then upsert | rating + comment | Notion feedback DB or Clients DB | **404** `Feedback link not found`; **400** `Rating must be between 1 and 5` / `Comment is required`; duplicate → **200** idempotent |

### 1.7 Transitions that do **not** exist

| Assumed transition | Verdict | Evidence |
| --- | --- | --- |
| `POST /api/line/send-result` | **NOT FOUND** | only `POST /api/cases/:id/send-result` (`api/case-flow-routes.js:705`) exists; the other name appears solely in debug text |
| Cal `BOOKING_CANCELLED` → Case cancel | **NOT FOUND** (by design) | `api/cal-routes.js:131-146` acknowledges without a handler |
| Cal `BOOKING_RESCHEDULED` → Case reschedule | **NOT FOUND** (by design) | same |
| Framer → Case creation (direct) | **NOT FOUND** | public routes are GET-only; `POST /api/cases` is auth-gated |
| Country Hero → published score | **NOT FOUND** (by design) | publish body sends `S.scoreVal` (Quality V3) at `src/js/flows/score.js:1529` |
| `weakestLinkShare` → aggregation | **NOT FOUND** | constant defined in 5 `limits.js`, read nowhere |

---

## 2. Data Lineage Map

Legend for Q6: **S** = can go stale, **O** = can be overwritten, **D** = can diverge from SoT.

### 2.1 Case identity

| Field | Created | Transformed | Persisted | Read back | Source of truth | Stale/overwrite/diverge | Tests | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `calBookingId` | Cal payload `payload.uid` (`cal-booking-adapter.js:56`) | trim/string | Notion `Cal Booking ID` | `findClientByCalBookingId` (`notion/clients.js:167`) | **Notion property** | **D** — if the Notion column is missing, `buildNotionProperties` silently skips it and dedupe stops working, allowing duplicate Cases | none | **COVERAGE GAP** |
| in-memory dedupe key | `buildDedupeKey` (`cal-routes.js:117`) | sha256 fingerprint | process Map | same process only | not authoritative | **S** — cleared on every restart/deploy. Production probe: `dedupePlaceholderEntries: 0` | none | **COVERAGE GAP** (documented as placeholder in `CAL-015`) |
| `notionId` | `notion.pages.create` → `page.id` | — | Notion page id | `notionPageToJob:272` | **Notion** | low | `case-persistence-rehydration.test.js` | PASS — UNIT ONLY |
| `id` (compact) | `compactNotionId(page.id)` (`mapper.js:272`) | dash-strip | localStorage `wm-jobs` | JOBS / `isActiveScoreJob:767-777` | derived from `notionId` | **D** — five separate id-comparison forms exist in `isActiveScoreJob`, indicating identity matching is non-trivial | `case-readings-isolation.test.js` (isolation only) | PARTIAL |
| `feedbackToken` (`fb-`) | `case-tokens.js` `generateFeedbackToken` | — | Notion `Feedback Token` | `findClientByFeedbackToken` | Notion | **O** — no rotation logic found | none | **COVERAGE GAP** |
| `publicReportToken` (`rpt-`) | created at Case create **and** minted again per publication (`score-publication-service.js:122-130`) | — | Notion Case pointer + ledger row | `resolveReportByToken` + full-scan fallback (`case-flow.js:14-18`) | **ledger row** | **D** — duplicate ledger rows for one token surface as **409 TOKEN_DUPLICATE** | `publish/immutable-publication.test.js` | STRONG (unit) |
| `wm-active-case-ref` | `persistActiveCaseRef:33` | `{id,notionId,date}` | localStorage | `restoreActiveCaseFromPersistence:98` | UI convenience only | **S** — points at a Case that may no longer be in `JOBS` | `case-persistence-rehydration.test.js` | STRONG (unit) |

### 2.2 Measurement

| Field | Created | Transformed | Persisted | Read back | Source of truth | Stale/overwrite/diverge | Tests | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rawMeasurement` | `freezeMeasurement(body.data)` (`assessment.js:538`) | frozen, never converted | live `S.tapData` only | in-session only | OCR response | **S** — **not part of the Notion snapshot schema, so it is lost on reload/deploy** | none (inferred from schema) | **COVERAGE GAP** |
| `meterReadings` | OCR merge (`assessment.js:1274`) or manual (`:1478`) | string values | draft + Notion snapshot | UI fill (`:1465`), scoring fallback | Case draft | **O** — manual edit overwrites OCR values | `assessment/assessment-snapshot.test.js` | STRONG (unit) |
| `standardMeasurement` | `storeRawAndStandardMeasurements` (`assessment.js:605`) | EC→TDS ×0.5, °F→°C | draft + Notion snapshot | scoring, **preferred over `meterReadings`** (`score.js:1037`) | conversion engine | **S** — manual edits do not refresh it, so a stale converted value can outrank a fresh manual entry | `scripts/test-pr3-score-standard-source.js` (outside `tests/`) | **WEAK — see C-03** |
| normalized score readings | `resolveScoreReadingsPresent` (`score.js:799`) | `numOrUndefined`, tap averaging, layer merge | not persisted | engines | derived | **D** — averages **all** taps, including non-active ones | `case-readings-isolation.test.js` (isolation only, not averaging) | **COVERAGE GAP** |
| `tapData[]` | `S.taps` / `S.tapData` (`assessment.js:18-31`) | per-tap objects | draft | `resolveJobTapDataForScore:784` | Case draft | **O** — `S.tapData` only allowed for the active Case, guarded at `:787` | `case-readings-isolation.test.js` Test D | STRONG (unit) |

### 2.3 Score

| Field | Created | Transformed | Persisted | Read back | Source of truth | Stale/overwrite/diverge | Tests | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| parameter grades | `grade*` in `computeQualityScoreV2.js:45+` | curve/anchor lerp | not persisted | aggregation | pure function of readings | none | `quality-v2-calibration`, `thailand-ph-monotonicity`, `pd014-severity-regression` | **STRONG** |
| raw aggregate | Quality V3 flat mean (`:267`) / `computeSharedBenchmarkBase:176-191` weighted mean | rounding | not persisted | severity stage | pure | **D** — a weight key absent or `<= 0` silently drops the parameter | `quality-v2-calibration`, `country-sensitivity-audit` | STRONG for the happy path, **no test for `weightTotal === 0` fallback** |
| severity | `applyCountrySeverityProtection` (`benchmarkMetadata.js:76-87`) | `min(score, cap, score-deduction)`, floor 0 | not persisted | ceiling stage | pure | none — can only lower | `country-severity-protection`, `thailand-severity-protection`, `INV-007` | **STRONG** |
| country ceiling | `applyCountryBenchmarkHeroCeiling` (`benchmarkMetadata.js:16-20`) | cap 99 | not persisted | display | pure | none | `country-hero-ceiling.test.js` | **STRONG** |
| Hero (displayed) | `resolveDisplayedScore` (`score.js:283-293`) | — | **not persisted** | gauge only | selected country engine | **D** — differs from the published number by design | `displayed-score-country-switch.test.js` | STRONG (unit) |
| Quality V3 | `computeQualityScoreDetail` | flat mean of 6 | `S.scoreVal` → publish body | ledger | engine at publish time | **S** — the ledger keeps the value from the moment of publish; later reading edits do not update it | `quality-v2-calibration`, `case-1328-calibration-baseline` | STRONG (unit) |
| published score | ledger `snapshot.publishedScore` (`score-publication-service.js:270-285`) | clamped 0–100 at display | **Notion ledger (immutable)** + Case pointer | `applyPublicationToJob:106-120` | **ledger** | **D** — pointer can drift; `pointerPending` / `reconcilePointer` exist to heal it | `publish/immutable-publication`, `publication-recovery` | **STRONG (unit)** |

### 2.4 Publish

| Field | Created | Transformed | Persisted | Read back | Source of truth | Stale/overwrite/diverge | Tests | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| publication state | `createOrReusePublication` | `pointerSyncState: 'pointer_pending' → synced` | ledger row | `reconcilePointer:304-320` | ledger | **S** — stuck `pointer_pending` if reconcile never runs | `publication-recovery.test.js` | STRONG (unit) |
| Case pointer | `syncCasePointer:132-141` | writes `latestWaterScore`, `publicReportToken`, `reportUrl` | Notion Case | dashboard, LINE, score card | cache of the ledger | **O/D** — overwritten on republish | `publication-close-path.test.js` (static check) | MEDIUM |
| report token | `mintUniqueToken:122-130` | 5 attempts | ledger + pointer | `resolveReportByToken` | ledger | **D** — duplicates → 409 | `immutable-publication.test.js` | STRONG (unit) |
| score-card source | `cardOptionsFromJob:645` | `Number(job.result.waterScore)` | none (rendered PNG, cached 300 s) | LINE image, share | Case pointer | **S** — CDN/browser cache for 300 s after a republish; **null → 0** | none | **COVERAGE GAP** |

---

## 3. Score Execution Trace

Stage-by-stage, proven from source. The two paths are shown separately because they are separate.

### 3.1 Shared pre-stages

| Stage | Where | Behavior |
| --- | --- | --- |
| Raw reading | tap `standardMeasurement` / `meterReadings` / draft fields | strings or numbers |
| Normalization | `numOrUndefined` (`score.js:683`) | `parseFloat`; non-finite → `undefined`. This is what stops `[]`, `true`, `''` from ever reaching an engine |
| Tap aggregation | `readingsFromTapData` (`score.js:718-741`) | **mean across all taps that have a value**, `standardMeasurement` preferred per key |
| Layer merge | `mergeReadingLayers` (`score.js:744-758`) | first non-empty layer wins; tap layer beats draft fields |
| Validation | `validateMeasurements` (`score.js:880`) | strips only `IMPLAUSIBLE` and `INVALID_TYPE` scored keys; `MISSING` is left missing |
| Engine-side coercion | `toFiniteReading` (`src/js/score/util/clamp.js:10-14`) | `null`/`undefined`/`''`/`false` → `NaN`. **Verified by execution:** `[]` → `0`, `true` → `1`, `[5]` → `5` — reachable only by calling engines directly, not through the app path |

### 3.2 Quality V3 path (published)

```
readings → toFiniteReading → gradePh/gradeTds/gradeTurbidity/gradeChlorine/gradeOrp/gradeDo
         → require all 6 finite (else score:null, incomplete:true)   [computeQualityScoreV2.js:247-256]
         → flat mean ÷ 6 → Math.round                               [:267-269]
         → S.scoreVal → POST /api/cases/:id/score                    [score.js:1529]
```

- Weights: equal, `{ph:1,tds:1,turbidity:1,orp:1,chlorine:1,do:1}` (`:279`)
- Not scored: `temp`, `ec`, `doPercent`, `totalChlorine` (`:280`)
- **No severity cap, no 99 ceiling** — Quality V3 can legitimately return 100
- Confirmed: `computeQualityScoreDetail` contains no reference to `applyCountryBenchmarkHeroCeiling` or the registry

### 3.3 Country Hero path (displayed)

```
readings → toFiniteReading → same shared grade curves
         → require ph, tds, turbidity, orp (chlorine/do optional)   [computeSharedBenchmarkBase:161-163]
         → weighted mean over present params, skipping any key whose
           weight is absent / non-finite / <= 0                      [:176-191]
         → fallback to unweighted mean when weightTotal === 0        [:189-191]
         → country classification (per-engine classify)
         → applyCountrySeverityProtection: min(score, cap, score-deduction), floor 0
                                                                     [benchmarkMetadata.js:76-87]
         → EU only: PD-002 chlorine gate min(score, 65)              [eu/score.js:92-101]
         → all 5: missing chlorine → min(score, 79)                  [thailand:119 japan:130 who:133 eu:122 usEpa:135]
         → applyCountryBenchmarkHeroCeiling: cap 99                  [benchmarkMetadata.js:16-20]
         → S.comparisonScoreResult → gauge                            [score.js:283-293]
```

Severity constants (`benchmarkMetadata.js:49-63`): caps `WARNING 85 / FAIL 75 / CRITICAL 60`; minimum deductions `WARNING 3 / FAIL 6 / CRITICAL 10`.
`worstBenchmarkClassification` (`:65-74`) skips `temp` explicitly and ignores `NOT_EVALUATED` / `NOT_MEASURED` because they are absent from the order map.
**Neither cap can raise a score** — both are `min`-based with a `Math.max(0, …)` floor.

### 3.4 Proof the two paths are separate

| Evidence | Location |
| --- | --- |
| Different functions, different required-parameter sets (6 vs 4) | `computeQualityScoreV2.js:247` vs `:161` |
| Different aggregation (flat mean vs weighted mean) | `:267` vs `:176` |
| Different ceilings (none vs 99) | `benchmarkMetadata.js:16` applied only via `finalizeBenchmarkMetadata` |
| Different client state | `S.scoreVal` / `S.currentScoreResult` vs `S.comparisonScoreResult` (`score.js:946-970`) |
| Different consumers | gauge takes country; publish body takes `S.scoreVal` (`score.js:1529`) |
| Source comment states the split | `score.js:913-914` |

### 3.5 No identity branching in scoring

Grep over `src/js/score/**` for `caseId`, `notionId`, `clientName`, `customerId`, `job.`: the only hit is `eligibility/reportEligibility.js` (2 hits), which decides *whether readings exist*, not how they are graded. Grep for the locked fixture values (`1328`, `13.28`) inside `src/js/score`: **zero matches**. Scoring is a pure function of readings plus country key. This substantiates `INV-010` — though see §8 for how that row was evidenced.

---

## 4. Country Engine Trace

| Country | Input | Grade source | Weight profile (sum) | Included in composite | Excluded (mechanism) | `do` / `temp` classification | Severity | Ceiling | Country gate / cap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Thailand** | ph, tds, turbidity, orp (+cl, do optional) | shared `computeSharedBenchmarkBase` | `ph 1, tds 1, chlorine 1, turbidity 1, orp 1` (**5**) | ph, tds, chlorine*, turbidity, orp | **`do`** — no weight key (`thailand/weights.js:2-8`); **`temp`** — never graded | `do: NOT_EVALUATED`, `temp: NOT_EVALUATED` (`thailand/score.js:98-99`); `statusOf` returns `'pending'` (`:36-37`) | yes | 99 | missing Cl → 79 (`:119`) |
| **Japan** | same | shared | `turbidity .22, chlorine .22, ph .16, tds .16, orp .12` (**0.88**) | ph, tds, chlorine*, turbidity, orp | **`do`** — absent from `japan/weights.js:16-22`; `temp` — no weight | `do: NOT_EVALUATED` (`japan/score.js:109`); `temp: PASS/WARNING/NOT_MEASURED`, warn above `L.temp.max = 30` (`:114-116`, `limits.js:55`) | yes | 99 | missing Cl → 79 (`:130`) |
| **WHO** | same | shared | `ph 1, tds 1, turbidity 1, orp 1, chlorine 1, do 1` (**6**) | all six when present | `temp` only | `do` graded or `NOT_MEASURED`; `temp` metadata only | yes | 99 | missing Cl → 79 (`:133`) |
| **EU** | same | shared | `chlorine .25, turbidity .25, tds .15, ph .15, do .10, orp .10` (**1.0**) | all six when present | `temp` only | `do: PASS/FAIL/NOT_MEASURED`; `temp` metadata | yes, computed on `nonChlorineClassifications` (chlorine forced PASS) | 99 | **PD-002 chlorine gate `min(score, 65)`** (`eu/score.js:92-101`, `limits.js:28`) **then** missing Cl → 79 (`:122`) |
| **US EPA** | same | shared | `turbidity .30, tds .20, chlorine .15, ph .15, do .10, orp .10` (**1.0**) | all six when present | `temp` only | `do` graded or `NOT_MEASURED`; `temp` metadata | yes | 99 | missing Cl → 79 (`:135`) |

\* chlorine participates only when finite; otherwise the 79 cap applies.

### 4.1 Thailand — required answers

| Question | Answer | Evidence |
| --- | --- | --- |
| Is DO graded? | **Yes**, `gradeDo` runs and `params.do` is populated | `computeSharedBenchmarkBase` grades whatever is finite |
| Does DO enter the aggregate? | **No** — the key is absent from the weights object, so it contributes zero | `thailand/weights.js:2-8` + skip logic `computeQualityScoreV2.js:184-186` |
| Is temp evaluated? | **No** — `NOT_EVALUATED`, status `'pending'` | `thailand/score.js:98-99, 36-37` |
| Is the weight profile actually used? | **Yes**, but all five weights are `1`, so the weighted mean equals the unweighted mean of those five | `thailand/weights.js` |

The last row matters for QA: because Thailand's weights are uniform, **a bug that ignored the weights object entirely would produce identical Thailand scores**. Thailand is therefore the wrong engine to detect weight-plumbing regressions; Japan/EU/EPA are the discriminating cases.

### 4.2 Japan — required answers

| Question | Answer | Evidence |
| --- | --- | --- |
| Is `do` in `weights.js`? | **No.** Object is turbidity/chlorine/ph/tds/orp, sum **0.88** | `japan/weights.js:16-22` |
| DO classification | `NOT_EVALUATED` | `japan/score.js:109` |
| Can DO move the composite? | **No** — no weight key, so varying DO cannot change the aggregate | verified by the skip branch; asserted by `JP-002` / `INV-005` |
| pH comfort band | PASS when `7.3 ≤ ph ≤ 7.7` (`L.ph.idealMin/idealMax`) | `japan/score.js:89-90` |
| TDS / turbidity comfort | TDS ≤ 200 mg/L; turbidity ≤ 1 NTU | `:91`, `:93` |
| Temperature warning | `WARNING` above 30 °C, `NOT_MEASURED` when absent | `:114-116` |
| Severity cap | shared caps apply, and `temp: WARNING` **cannot** pull the score down because `worstBenchmarkClassification` skips `temp` | `benchmarkMetadata.js:67` |

Note the sum of 0.88 is harmless: the aggregation divides by `weightTotal`, so profiles need not be normalized.

### 4.3 WHO / EU / EPA — not interchangeable

Sharing grade curves does not make these engines equivalent. Differences proven from source: weight profiles differ (WHO uniform, EU and EPA skewed in different directions), EU is the only engine with a named gate (PD-002 chlorine, cap 65), EU computes severity on a chlorine-neutralized classification copy, and each engine has its own `classify`/threshold constants in its own `limits.js`. WHO and EPA both include `do` in the composite while Thailand and Japan do not.

---

## 5. 258 Test → Execution Node Coverage Map

Environment key: **U** = local unit, **P-RO** = production read-only, **S** = requires staging (absent), **X** = no automated coverage.

| Flow node | Source function | Test IDs | Tested? | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| Framer page / CTA | external | WEB-001…016 | PARTIAL | P-RO browser + curl | 9 BLOCKED (mobile emulation, Framer source absent) |
| Public offer API | `getOfferStatus` | WEB-006, PROD-009 | YES | P-RO | no unit test for slot arithmetic |
| CORS allowlist | `applyCors` | WEB-007, WEB-008 | YES | P-RO | X unit |
| Cal webhook status | `handleCalRoute` | CAL-001 | YES | P-RO | — |
| Cal signature verify | `verifyCalSignature` | CAL-002, CAL-003, CAL-004 | **NO** | S | **X — no unit test exists for HMAC verify** |
| Cal body/JSON guards | `readRawBody`, `JSON.parse` | CAL-005, CAL-006 | NO | S/U claimed, not run | X |
| Cal trigger scope | `handleCalRoute:135` | CAL-007, CAL-008 | NO | S | X + requirement gap |
| Cal adapter validation | `rejectPayload` | CAL-014, CAL-016 | **NO** | S | **X — pure function, unit-testable today** |
| Cal dedupe (durable) | `findClientByCalBookingId` | CAL-010, CAL-011 | NO | S | X |
| Cal offer mapping | `resolveCampaignAttribution` | CAL-012, CAL-017 | **NO** | S | **X — pure function, unit-testable today** |
| `POST /api/cases` | route + `createCase` | API-001…007 | PARTIAL | API-004 P-RO 401 only | X for 201/400/idempotency |
| Case creation service | `createCase` | API-001, CASE-001 | **NO** | S | **X — no `createCase` unit test** |
| Token mint | `generateFeedbackToken/ReportToken` | CASE-005…007 | NO | S | X |
| Notion property map | `buildNotionProperties` | NOTION-001…010 | PARTIAL | `publish/compliance-persistence.test.js` (compliance fields only) | X for intake fields, alias fallback, missing-column skip |
| Notion → job | `notionPageToJob` | NOTION-004, SCORE-013 | PARTIAL | `country-standard-case-contract.test.js` | X for intake fields |
| Case rehydration | `loadJobsFromApi` | CASE-002, CASE-003, CASE-009 | **YES** | U `case-persistence-rehydration.test.js` (34 assertions) | strongest server-adjacent coverage in the repo |
| Active-case ref | `persistActiveCaseRef` | CASE-004 | YES | U | — |
| CSV fallback branch | `loadJobsFromCsv` | — | **NO** | X | **untested node, see G-07** |
| OCR proxy route | `handleOcrProxyRoute` | OCR-001…004 | **NO** | S/X | **X — all four BLOCKED** |
| OCR key mapping | `mapOcrDataToMeterReadings` | MEAS-007 (partly) | **NO** | X | **X — false-zero filter has no test** |
| Conversion engine | `toStandardMeasurement` | MEAS-012 | PARTIAL | `scripts/test-conversion-engine.js` (outside `tests/`) | not in the locked suite |
| Score input assembly | `resolveScoreReadingsPresent` | MEAS-011, SCORE-001 | PARTIAL | `case-readings-isolation.test.js` | X for tap averaging |
| Validator gate | `validateMeasurements` | MEAS-001…013 | YES | U `measurement-validation.test.js` (57) | wiring into `resolveScoreReadings` is browser-only, unproven end-to-end |
| `toFiniteReading` | `clamp.js` | INV-004 (indirect) | **NO** | X | **X — no direct test** |
| Quality V3 | `computeQualityScoreDetail` | QV3-001…004, SCORE-002…009 | YES | U `quality-v2-calibration.test.js` (54) | **STRONG** |
| Shared benchmark base | `computeSharedBenchmarkBase` | SCORE-010…017, INV-001…003 | YES | U | X for `weightTotal === 0` fallback |
| Thailand engine | `thailand/score.js` | TH-001…012 | YES | U (4 dedicated files) | — |
| Japan engine | `japan/score.js` | JP-001…008 | YES | U | — |
| WHO engine | `who/score.js` | WHO-001, WHO-002 | PARTIAL | U | only 2 cases for a full engine |
| EU engine | `eu/score.js` | EU-001, EU-002 | PARTIAL | U + `pd008-chlorine-repair.test.js` | only 2 cases; gate covered indirectly |
| EPA engine | `usEpa/score.js` | EPA-001, EPA-002 | PARTIAL | U | only 2 cases |
| Severity / ceiling | `benchmarkMetadata.js` | INV-007, INV-008, INV-009, INV-012 | YES | U | **STRONG** |
| Registry routing | `registry.calculate` | INV-001, SCORE-011 | PARTIAL | U | X for unknown-key fallback |
| Displayed vs published | `resolveDisplayedScore` | SCORE-012, INV-011, E2E-009 | PARTIAL | U `displayed-score-country-switch.test.js` (91) | X end-to-end through publish |
| Publish service | `createOrReusePublication` | PUB-001…010 | YES | U (6 publish test files) | X for `LEDGER_REQUIRED`, token exhaustion |
| Publish HTTP route | `POST /api/cases/:id/score` | API-032, PUB-001 | **NO** | S | X |
| Token resolution | `resolveReportByToken` + fallback scan | REPORT-001…010 | PARTIAL | U for ledger; X for the full-scan fallback and HTTP | X |
| `/r/:token` HTML | route | REPORT-003, REPORT-004 | PARTIAL | P-RO 404 only | X for the success path |
| Public report client | `public-report.js` | REPORT-005…010 | **NO** | S | X |
| Score card PNG | `handleScoreCardRoute` | CARD-001…012 | PARTIAL | P-RO 404 only | **X — `cardOptionsFromJob` null→0 untested** |
| LINE state machine | `executeSendCaseResult` | LINE-001…011 | **NO** | all 11 BLOCKED | **X — 409/422/already_sent untested** |
| LINE message build | `sendCaseResultNotification` | LINE-004, LINE-009 | PARTIAL | `scripts/test-line-lifecycle.js` (outside `tests/`) | X |
| LINE webhook signature | `verifyLineSignature` | API-018 | PARTIAL | P-RO GET only | X for the 401 POST path |
| Dashboard render | `buildApptCard` | DASH-001…011 | **NO** | all 11 BLOCKED | X |
| Feedback | `recordFeedback`, `client-feedback` | FB-001…010 | PARTIAL | FB-008 P-RO 404 | **X — validation and idempotency untested** |
| Production invariants | health/version | PROD-001…012 | YES | P-RO | — |
| E2E critical path | whole chain | E2E-001…010 | **NO** | 7 BLOCKED, 3 mislabelled PASS | **see §8** |

---

## 6. Untested Nodes

Source functions that carry real risk and have **no** automated test under `tests/`.

| # | Node | File | Why it matters | Unit-testable today without staging? |
| --- | --- | --- | --- | --- |
| N-01 | `verifyCalSignature` | `services/cal-webhook.js:9-29` | the only authentication on the Case-creation entry point | **Yes** — pure HMAC |
| N-02 | `extractBookingCreatedFields` + `rejectPayload` | `services/cal-booking-adapter.js:56-120` | decides which bookings become Cases | **Yes** — pure |
| N-03 | `resolveCampaignAttribution` | `services/cal-offer-mapping.js:21-34` | launch-offer attribution and slot counting | **Yes** — pure |
| N-04 | `createCase` | `services/case-creation-service.js:131-184` | Case SSOT creation, token mint, defaults | **Yes** with a Notion stub |
| N-05 | `buildNotionProperties` (intake fields) | `services/notion/clients.js:391-454` | silently skips unknown columns — the `calBookingId` dedupe failure mode | **Yes** |
| N-06 | `handleOcrProxyRoute` | `api/ocr-proxy-routes.js:37-108` | 405/400/auth contract | **Yes** with a fake req/res |
| N-07 | `mapOcrDataToMeterReadings` + false-zero filter | `src/js/flows/assessment.js:475-525` | wrong key mapping silently loses a reading | **Yes** — pure |
| N-08 | `toFiniteReading` | `src/js/score/util/clamp.js:10-14` | the false-zero guard for every engine | **Yes** |
| N-09 | `executeSendCaseResult` state machine | `services/workflow-service.js:237-354` | duplicate or lost customer LINE messages | **Yes** with a stubbed LINE client |
| N-10 | `cardOptionsFromJob` | `services/score-share-card.js:645-658` | renders **0** for a null score | **Yes** — pure |
| N-11 | `client-feedback` validation and upsert | `services/client-feedback.js` | customer-facing 400/404 contract | **Yes** with a Notion stub |
| N-12 | `loadJobsFromCsv` fallback | `src/js/job-state.js:1173` | mock data can reach a real dashboard | **Yes** in the existing sandbox harness |
| N-13 | `readingsFromTapData` averaging | `src/js/flows/score.js:718-741` | changes the score of every multi-tap Case | **Yes** — pure |
| N-14 | Registry unknown-key fallback | `src/js/score/benchmark/registry.js:20-22` | silently scores with Thailand | **Yes** |

Eleven of these fourteen are pure functions or already-stubbable modules. **The dominant blocker is not the missing staging environment — it is that no one has written the test.**

---

## 7. Untested Transitions

Both endpoints have coverage, the hop between them does not.

| # | From (tested) | To (tested) | Untested hop | Risk if it breaks | Evidence |
| --- | --- | --- | --- | --- | --- |
| T-01 | `validateMeasurements` (unit) | engines (unit) | the wiring at `score.js:878-902` that actually strips invalid keys | an implausible DO could reach an engine and silently distort the Hero | wiring is browser-only, guarded by `typeof MeasurementValidator !== 'undefined'` |
| T-02 | Quality V3 value (unit) | ledger `publishedScore` (unit) | `shareScore` → HTTP → `publishCaseScore` | the wrong number could be published while both ends still pass | no test executes `shareScore` |
| T-03 | ledger row (unit) | `/r/{token}` rendering | token → HTTP → client render | a customer could see a stale or absent score | no HTTP test for either report route |
| T-04 | published pointer (unit) | score card PNG | `cardOptionsFromJob` + 300 s cache | republish shows the old card; null shows a card reading **0** | no test |
| T-05 | Case completed (unit) | LINE delivered | `closeCase` → `executeSendCaseResult` → push | duplicate or missing customer notification | no test |
| T-06 | OCR response (script) | `standardMeasurement` (script) | manual edit → stale standard precedence | operator's corrected value is ignored in favour of a stale converted one | `score.js:1037` prefers `standard`; only `scripts/` covers the happy path |
| T-07 | tap snapshot (unit) | score input | multi-tap averaging | adding a tap changes the Hero with no visible cause | `score.js:733-740` |
| T-08 | Notion snapshot (unit) | `rawMeasurement` | raw is absent from the snapshot schema | raw OCR evidence is unrecoverable after reload | schema inspection |
| T-09 | `GET /api/clients` 200 (P-RO) | JOBS rendered | `loadJobsFromApi` returning `false` → CSV mock | mock customers on a real dashboard | `app.js:10-17` |

---

## 8. False Coverage

Cases that pass, or are reported as passing, without proving what their name claims.

| # | ID(s) | Claim | Reality | Correct label |
| --- | --- | --- | --- | --- |
| F-01 | `E2E-007` | "Switch Case → return", environment **Staging** in the matrix | reported PASS with evidence "unit locks 2026-08-20 …", the same bundle string used by 71 other rows | **BLOCKED — ENVIRONMENT GAP** |
| F-02 | `E2E-009` | benchmark switch on a Case, environment "Staging / Local-unit" | only the unit half ran | **PASS — UNIT ONLY** |
| F-03 | `INV-010` | "Scoring has no Case-id branch", environment `n/a`, method "grep/policy" | reported PASS via the unit bundle, which cannot prove a grep result. The claim is true (re-verified in §3.5) but the evidence attached to it was wrong | **PASS — UNIT ONLY**, evidence corrected to grep |
| F-04 | `PUB-003` | explicit republish creates a second ledger row | genuinely covered by `publication-idempotency.test.js`, but the row is attributed to the generic bundle rather than the assertion | PASS — UNIT ONLY, evidence too coarse |
| F-05 | 72 PASS rows | individually verified | share one identical evidence string; no row-level assertion mapping | **evidence-granularity defect** |
| F-06 | `weakestLinkShare` assertions in `thailand-ordinary-band-calibration.test.js` | Thailand aggregation behavior | asserts a constant that no code reads | **MISLEADING** |
| F-07 | All Thailand weight-profile cases | "weight profile is used" | Thailand's weights are all `1`, so the weighted and unweighted means coincide; the test cannot distinguish them | **WEAK** — use Japan/EU/EPA instead |

Quantified: **72 of 113 PASS rows (64%)** carry the same bundle evidence, and **3 of those are E2E rows** whose declared environment is Staging.

---

## 9. Failure Path Matrix

`NOT DEFINED` = neither source nor test defines the behavior. `X` = no automated test.

| Failure | Where detected | Expected behavior (from source) | Test ID | Tested? | Environment |
| --- | --- | --- | --- | --- | --- |
| Cal signature invalid | `cal-routes.js:87` | **401** `Invalid Cal signature`, no Case | CAL-003 | **NO** | S |
| Cal secret unset | `cal-routes.js:100` | signature **not enforced**, warn log; prod probe shows `hasWebhookSecret:true` | CAL-004 | NO | local |
| Cal body oversized | `cal-routes.js:39` | **400** `Request body too large` | CAL-005 | NO | local |
| Cal malformed JSON | `cal-routes.js:110` | **400** `Invalid JSON` | CAL-006 | NO | local |
| Cal duplicate delivery | `noteCalDelivery:118` + `findClientByCalBookingId:123` | in-memory flag then durable Notion dedupe; **200** `duplicate:true`, one Case | CAL-010, CAL-011, CAL-015 | NO | S |
| Cal missing uid/name/times | `cal-booking-adapter.js:118-120` | **400** with the specific message | CAL-014, CAL-016 | **NO** | S (unit-testable) |
| Notion column `Cal Booking ID` absent | `buildNotionProperties:391` | property silently skipped → **dedupe stops working, duplicate Cases possible** | NOTION-007 | **NO** | X |
| Case creation failure | `createCase` (no try/catch) | error bubbles; route returns `error.statusCode \|\| 502` | API-006, CASE-008 | NO | S |
| Token mint exhausted | `case-creation-service.js:139` | **500** `Could not generate unique fb/rpt token` | CASE-006 | NO | X |
| Notion unconfigured | `notion/clients.js` | **502** `NOTION_API_KEY and NOTION_DATABASE_ID must be configured` | NOTION-001 | NO | X |
| `POST /api/cases` malformed JSON | `case-flow-routes.js:607` (`readJson` has no try/catch) → `:624` | **502** with the `SyntaxError` message | API-006 | NO | local — **matrix guessed 500; source yields 502** |
| Unauthenticated staff route | `assertAppAuth` | **401**; **403** for a valid session whose user was removed | API-004, API-009 | YES | P-RO |
| Case missing | `resolveJob` | `statusCode` 404, else 502 | API-011 | NO | S |
| Case reload loses active Case | `loadJobsFromApi:1139-1155` | active Case re-resolved, else restored from `wm-active-case-ref` | CASE-002, CASE-003 | **YES** | U |
| `GET /api/clients` failure | `job-state.js:1049` | returns `false` → **CSV mock fallback** | — | **NO** | X |
| OCR method not allowed | `ocr-proxy-routes.js:47` | **405** `Use POST /api/ocr/read-meter` | — | **NO** | X |
| OCR missing fields | `:86` | **400** `image_url and meter_type are required` | OCR-002 | NO | X |
| OCR engine unavailable/timeout | `ocrClient` | **HTTP 200** with `{success:false, error:'OCR_*'}`; client throws for user-facing codes | OCR-003, OCR-004 | NO | X |
| `Number(null)` / false zero | `numOrUndefined:683`, `toFiniteReading:10`, validator | `null`/`''`/`false` never become `0` in the app path | MEAS-001, INV-004 | **YES** | U |
| Invalid numeric type | `measurementValidator` `INVALID_TYPE` | stripped before engines | MEAS-002…005 | YES | U |
| Implausible value | `PLAUSIBLE_RANGES` | stripped, still displayed with a note | MEAS-008 | YES | U |
| Missing scored parameter (Quality V3) | `computeQualityScoreV2.js:247` | `score:null, incomplete:true` | QV3-003 | YES | U |
| Missing chlorine (country) | all 5 engines | score capped at **79** | TH-011, SCORE-015 | YES | U |
| Missing weight key | `computeQualityScoreV2.js:184` | parameter contributes zero | JP-002, INV-005 | YES | U |
| `weightTotal === 0` | `:189-191` | falls back to unweighted mean | — | **NO** | X |
| Unknown country key | `registry.js:20` | **silently falls back to Thailand** (UI guards with `has()`) | — | **NO** | X |
| Score out of range at publish | `score-publication-service.js:192` | **400** `Score must be between 0 and 100` | PUB-005 | YES (service level) | U |
| Ledger not configured | `:204` | **503** `LEDGER_REQUIRED` | PUB-007 | **NO** | X |
| Publish retry / same key | `:211-229` | replay returns the same publication; heals `pointer_pending` | PUB-001, PUB-002 | YES | U |
| Publish duplicate token | `:329` | **409** `TOKEN_DUPLICATE` on resolve | REPORT-002 | YES | U |
| Pointer write failure | `:295-300` | **200** `{pointerPending:true, warning}`; `reconcilePointer` heals | PUB-010 | YES | U |
| Public token invalid | `case-flow-routes.js:755` | **404** `Report not found` (JSON) / 404 HTML | REPORT-003, REPORT-004 | YES | P-RO |
| Score null at card | `public-routes.js:105` | **404** `Score not published` | CARD-003 | PARTIAL (unknown token only) | P-RO |
| Score null inside card renderer | `score-share-card.js:645` | **renders `0`** | — | **NO** | X |
| LINE send before completion | `workflow-service.js:288` | **409** `Case is not completed yet` | API-014 | **NO** | X |
| LINE send without report URL | `:299` | **422** `Report URL is missing for this case` | API-014 | **NO** | X |
| LINE duplicate send | `:264` | **200** `{action:'already_sent', idempotent:true}` | LINE-006 | **NO** | X |
| LINE concurrent send | `:270` | `already_sending`; stale `sending` older than 3 min retried | LINE-007 | **NO** | X |
| No LINE user id | `:280` | `{action:'skipped', reason:'no_line_user_id'}` | LINE-008 | **NO** | X |
| LINE push failure | `:337-340` | `notificationStatus:'failed'`, `lastNotificationError` set, HTTP **200** | LINE-010 | **NO** | X |
| LINE token absent | `line-notifications.js:71` | mock send unless `LINE_MOCK_SEND=false` | LINE-011 | NO | local |
| LINE webhook bad signature | `line-routes.js:663` | **401** `Invalid LINE signature` | API-018 | PARTIAL (GET probe only) | P-RO |
| Feedback token unknown | `client-feedback.js` | **404** `Feedback link not found` | FB-008 | YES (P-RO 404) | P-RO |
| Feedback rating out of range | `client-feedback.js` | **400** `Rating must be between 1 and 5` | FB-003 | **NO** | X |
| Feedback duplicate submit | `workflow-service.js:556-564` | **200** idempotent | FB-006 | **NO** | X |
| Feedback token belongs to another Case | — | **NOT DEFINED** — lookup is token-only, no cross-check | FB-009 | NO | X |
| Cal booking cancelled by customer | `cal-routes.js:135` | acknowledged, **Case stays live** | CAL-007 | NO | requirement gap |

---

## 10. Persistence Boundary Audit

| Boundary | Owner | Cache | Who overwrites whom | Lost on reload | Lost on deploy/restart | Can go stale |
| --- | --- | --- | --- | --- | --- | --- |
| Notion Clients DB | **SoT for Case** | — | API writes win | no | no | — |
| Notion publications DB | **SoT for published score** (immutable, append-only) | — | never overwritten; republish appends | no | no | — |
| Case pointer fields (`latestWaterScore`, `publicReportToken`) | cache of the ledger | yes | republish overwrites; `reconcilePointer` heals | no | no | **yes** (`pointer_pending`) |
| Notion `Assessment Snapshot` | SoT for measurements | — | revision-guarded; stale writes skipped | no | no | no |
| `localStorage wm-jobs` | cache of `/api/clients` | yes | replaced wholesale at `job-state.js:1130` | no | no | yes |
| `localStorage wm-active-case-ref` | UI pointer | yes | `persistActiveCaseRef` | no | no | yes — may name a Case not in `JOBS` |
| `JOBS` (in-memory) | render list | yes | `splice` replace, then manual/local-only re-append | **yes** (rebuilt) | yes | yes |
| `S.activeJob` | session | yes | re-resolved after load; cleared if cancelled | rebuilt from ref | yes | yes |
| `S.tapData` | live session measurements | yes | only used for the active Case (`score.js:787`) | **yes** unless saved to `draft.tapData` | yes | yes |
| `rawMeasurement` | OCR evidence | — | frozen | **yes — not in the snapshot schema** | yes | — |
| Cal in-memory dedupe Map | replay hint | yes | — | — | **yes** — prod probe shows `dedupePlaceholderEntries: 0` | yes |
| `withCaseLock` | concurrency guard | — | — | — | yes | **in-process only, no cross-instance guarantee** |
| Booking idempotency store (30 s TTL) | replay guard | yes | entry removed on failed create | — | yes | yes |
| Score card PNG | derived render | HTTP `max-age=300` | — | — | — | **yes for 300 s after republish** |
| `S.scoreVal` / `S.comparisonScoreResult` | derived score | — | recomputed on every render | yes | yes | no |

### 10.1 Regression: "Case created → reload → active Case disappears"

**Covered.** `loadJobsFromApi` re-resolves the active Case by `id`, `notionId`, or compact-id (`job-state.js:1139-1147`) and otherwise calls `restoreActiveCaseFromPersistence` (`:1152-1155`). `tests/case-persistence-rehydration.test.js` (34 assertions) asserts exactly this, plus durable identity for `createDurablePortalCase` / `createManualCaseInNotion` and that a failed create leaves `JOBS` empty. **Status: 🟢 VERIFIED (unit).**

### 10.2 Regression: "Calendar/local Case → API reload → JOBS replaced → Case disappears"

**Covered for the unsynced case.** `collectLocalOnlyUnsyncedJobs` (`:970-987`) plus the re-append loop (`:1131-1138`) preserves local-only Cases, and the same test file asserts it. **Two residual holes:**

1. `manualPending && !notionId` Cases are deliberately excluded and are discarded by `discardUnsavedManualCases` (`src/js/flows/dashboard.js:119-124`) on dashboard navigation. Intended, but no test pins the intent.
2. If `loadJobsFromApi` returns `false`, `app.js:10-17` may load `clients_30_mock_data.csv` into `JOBS`. **Status: 🟡 PARTIALLY VERIFIED.**

---

## 11. UI → API → Storage Consistency Audit

| # | UI element | UI source | API source | Storage SoT | Consistent? | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | Case name | `buildApptCard` (`dashboard.js:262`) | `GET /api/clients` | Notion `Full Name` | yes | — |
| C-02 | Case identity | `S.activeJob.id` / `notionId` | both returned by `notionPageToJob:272` | Notion page id | yes, via five comparison forms | **expected design behavior** (`isActiveScoreJob:767-777`) |
| C-03 | Readings shown vs readings scored | DOM `#m-*` fill from `meterReadings` | — | `standardMeasurement` preferred for scoring (`score.js:1037`) | **NO** | **actual bug risk** — after a manual edit the operator sees their value while the engine may use a stale converted one, because `persistMeterReadings` never refreshes `standardMeasurement`. Untested (T-06) |
| C-04 | Displayed Hero vs published score | country engine | publish body sends `S.scoreVal` | ledger stores Quality V3 | **NO** | **expected design behavior** — documented at `score.js:913-914`; risk is that no end-to-end test pins it (G-05) |
| C-05 | Hero label vs severity | classifications from the engine | — | — | yes — `worstBenchmarkClassification` skips `temp` and `NOT_EVALUATED` | expected design (`INV-012`) |
| C-06 | Selected benchmark | `S.scoreStandardKey` | Case draft `scoreStandardKey`, API-backed | Notion draft | yes — remote wins, local fills legacy (`job-state.js:1116-1123`) | expected design, tested by `country-standard-persistence.test.js` |
| C-07 | Public report score | `resolveDisplayedScore` `publicView` branch | `/api/report/:token` | ledger snapshot | yes | expected design |
| C-08 | Public report benchmark context | forced to `thailand` (`public-report.js:81`) | — | — | **mismatch in appearance** | **expected design** — Hero is the published Quality V3 while the parameter table uses Thailand limits; worth an explicit test |
| C-09 | Score card vs report | `job.result.waterScore` | same pointer | ledger | yes, but | **stale data** — 300 s PNG cache plus `null → 0` fallback (`score-share-card.js:645`) |
| C-10 | LINE message score | flex header from the same pointer | — | ledger | yes | text fallback carries no number — expected design |
| C-11 | Dashboard score | **not rendered on the card** | — | — | n/a | **test limitation** — DASH-* rows imply a visible score; the card shows name/address/time/tags only |
| C-12 | Multi-tap "room" reading vs Hero | `getRoomReadings(tapKey)` per tap | — | — | **NO** | **expected design, undocumented** — per-room rows show one tap while the Hero averages all taps (`score.js:733-740`). Untested (T-07) |

---

## 12. Test Quality Audit

| Test file | Behavior or implementation? | Expected values from | Can pass while prod is broken? | Grade |
| --- | --- | --- | --- | --- |
| `score/quality-v2-calibration.test.js` | behavior — curves, monotonicity, PASS≠100 | fixtures + derived | no, for the Quality V3 math | **STRONG** |
| `score/case-1328-calibration-baseline.test.js` | behavior — locked real Case | hardcoded lock | no | **STRONG** (intentional golden lock) |
| `score/country-hero-ceiling.test.js` | behavior — 99 cap, Q-V3 independence | derived + baselines | no | **STRONG** |
| `score/country-severity-protection.test.js` | behavior — caps and deductions | constants + derived | no | **STRONG** |
| `score/displayed-score-country-switch.test.js` | behavior — gauge vs `S.scoreVal` | hardcoded baselines | **yes** — proves the client function, not the publish HTTP hop | **MEDIUM** |
| `score/measurement-validation.test.js` | behavior — the false-zero contract | hardcoded inputs | **yes** — the production wiring is browser-only | **MEDIUM** |
| `score/thailand-*` (4 files) | behavior + constants | mixed | partly | **MEDIUM to STRONG** |
| `score/thailand-ordinary-band-calibration.test.js` | asserts `weakestLinkShare`, which no code reads | constant | **yes** | **MISLEADING** |
| `score/country-benchmark-semantics.test.js` | presentation contract + doc cross-check | doc tables | yes — docs can agree while code drifts | **MEDIUM** |
| `score/case-readings-isolation.test.js` | behavior — cross-Case bleed | derived | no | **STRONG** |
| `score/country-sensitivity-audit.test.js` | behavior — full RAW→Hero matrix | forensic fixtures | no | **STRONG** |
| `assessment/assessment-snapshot.test.js` | behavior — round-trip and merge | derived | no | **STRONG** |
| `case-persistence-rehydration.test.js` | behavior — the actual reported regression | derived | no | **STRONG** |
| `publish/immutable-publication.test.js` | behavior — ledger immutability, 409 | derived | no | **STRONG** |
| `publish/publication-idempotency.test.js` | behavior — replay vs republish | derived | no | **STRONG** |
| `publish/publication-recovery.test.js` | behavior — pointer healing | derived | no | **STRONG** |
| `publish/publication-close-path.test.js` | **static source inspection** — asserts closeCase calls a function | source text | **yes** — a refactor keeping the call but breaking behavior still passes | **WEAK** |
| `publish/publication-store-contract.test.js` | contract shape | derived | partly | MEDIUM |
| `eligibility/*` (5 files) | behavior — gate separation | fixtures | no | **STRONG** |
| `evidence/*` (3 files) | governance over docs/constants | registry | yes — governs documents, not runtime | MEDIUM (by design) |
| `benchmark/benchmark-isolation.test.js` | behavior — engine isolation | derived | no | STRONG |
| `canonical-score/canonical-skeleton.test.js` | skeleton contract | derived | partly | MEDIUM |

**Aggregate.** The scoring core is genuinely well tested: expected values are largely derived from the engines and re-verified against locked fixtures, and the golden Case (13.28) plus the invariant set would catch a maths regression. The weakness is structural, not mathematical:

1. **Every test is an in-process sandbox test.** No test crosses an HTTP boundary, so a route-level regression (wrong status code, missing auth, changed payload key) is invisible to the suite.
2. **Two files assert non-behavior**: a dead constant (`weakestLinkShare`) and source text (`publication-close-path`).
3. **False-negative risk is concentrated in the client wiring**: validator gating, `shareScore`, publish HTTP, LINE state machine.
4. **False-positive risk is low** in scoring (derived expectations) and **high** in the reporting layer, where 72 rows share one evidence string.

---

## 13. QA Coverage Heatmap

🟢 VERIFIED · 🟡 PARTIALLY VERIFIED · 🔴 FAILED · ⚪ NOT TESTED · 🚫 BLOCKED

```
SYSTEM
├── Intake
│   ├── Website ................ 🟡  WEB-001…016 (P-RO)          strength: LOW (7 PASS / 9 BLOCKED)
│   ├── Cal .................... 🚫  CAL-002…017 (needs staging)  strength: NONE for create path
│   └── Webhook ................ 🟡  CAL-001 P-RO status only     strength: LOW — signature verify ⚪
├── Case
│   ├── Creation ............... 🚫  API-001, CASE-001            strength: NONE — createCase ⚪
│   ├── Persistence (Notion) ... 🟡  NOTION-001…010               strength: LOW — mapper tested only for compliance fields
│   └── Rehydration ............ 🟢  CASE-002/003/004/009 (U)     strength: HIGH — 34 assertions
├── Measurement
│   ├── OCR .................... ⚪  OCR-001…004 all BLOCKED      strength: NONE
│   ├── Normalization .......... 🟡  MEAS-012 (script only)       strength: MEDIUM — outside locked suite
│   └── Validation ............. 🟢  MEAS-001…013 (U, 57)         strength: HIGH for the gate, wiring ⚪
├── Scoring
│   ├── Quality V3 ............. 🟢  QV3-001…004, SCORE-002…009   strength: HIGH
│   ├── Thailand ............... 🟢  TH-001…012 (4 files)         strength: HIGH (but weights are non-discriminating)
│   ├── Japan .................. 🟢  JP-001…008                   strength: HIGH
│   ├── WHO .................... 🟡  WHO-001, WHO-002             strength: LOW — 2 cases
│   ├── EU ..................... 🟡  EU-001, EU-002 + PD-008      strength: MEDIUM — gate covered indirectly
│   └── EPA .................... 🟡  EPA-001, EPA-002             strength: LOW — 2 cases
├── Publication
│   ├── Publish (service) ...... 🟢  PUB-001…010 (6 files)        strength: HIGH
│   ├── Publish (HTTP) ......... 🚫  API-032                      strength: NONE
│   ├── Report ................. 🟡  REPORT-003/004 404 only      strength: LOW
│   └── Score Card ............. 🟡  CARD-002 404 only            strength: LOW — null→0 ⚪
└── Communication
    ├── LINE ................... 🚫  LINE-001…011 all BLOCKED     strength: NONE
    ├── Dashboard .............. 🚫  DASH-001…011 all BLOCKED     strength: NONE
    └── Feedback ............... 🟡  FB-008 404 only              strength: LOW
```

| Layer | 🟢 | 🟡 | ⚪ | 🚫 |
| --- | --- | --- | --- | --- |
| Intake | 0 | 2 | 0 | 1 |
| Case | 1 | 1 | 0 | 1 |
| Measurement | 1 | 1 | 1 | 0 |
| Scoring | 3 | 3 | 0 | 0 |
| Publication | 1 | 2 | 0 | 1 |
| Communication | 0 | 1 | 0 | 2 |
| **Total nodes** | **6** | **10** | **1** | **5** |

Coverage is inverted relative to customer risk: the deepest verification sits on the pure maths, while everything the customer actually receives — the LINE message, the public report, the score card — is unverified.

---

## 14. Critical Gaps

### G-01 — No automated test execution anywhere

- **ROOT CAUSE** `package.json` defines only `{"start": "node server.js"}`; there is no `.github/workflows/`, no non-sample hook in `.git/hooks`, no `.husky`, and `render.yaml` builds with `npm install` and starts with `npm start`.
- **IMPACT** All 40 test files and all 258 matrix rows are manual. A commit that breaks a locked score can be deployed with nothing objecting.
- **AFFECTED FLOW** every flow.
- **EVIDENCE** `package.json:2-4`; `render.yaml:9-10`; empty hook and workflow enumeration.
- **CURRENT TEST COVERAGE** none — this is the gap that makes every other PASS provisional.
- **MISSING TEST** an `npm test` runner over `tests/**/*.test.js` plus a CI job on push, ideally with the unit locks as a required check.

### G-02 — Server-side and client-wiring layers have no tests at all

- **ROOT CAUSE** `tests/` contains only `score/`, `publish/`, `eligibility/`, `evidence/`, `benchmark/`, `assessment/`, `canonical-score/` and one root persistence file.
- **IMPACT** the Cal webhook, Case creation, OCR proxy, LINE state machine, feedback, score card, and every HTTP status contract are unverified. §6 lists 14 such nodes, 11 of which need no staging to test.
- **EVIDENCE** `git ls-files tests` (40 files); §5 coverage map.
- **CURRENT TEST COVERAGE** partial and outside the suite, via `scripts/test-*.js`, which nothing runs automatically.
- **MISSING TEST** unit tests for N-01…N-14, starting with `verifyCalSignature`, `rejectPayload`, `executeSendCaseResult`, and `cardOptionsFromJob`.

### G-03 — `weakestLinkShare` is dead config with a test guarding it

- **ROOT CAUSE** the constant is defined in all five `limits.js` (TH `0.5`; JP/WHO/EU/EPA `0.25`) but is read by no aggregation code.
- **IMPACT** a documented scoring concept does not exist at runtime; the test that mentions it gives false assurance and would not notice if aggregation changed.
- **AFFECTED FLOW** country Hero for all five engines.
- **EVIDENCE** grep over `src/`: hits only in `limits.js`; `computeSharedBenchmarkBase:176-191` never reads it.
- **CURRENT TEST COVERAGE** `tests/score/thailand-ordinary-band-calibration.test.js` asserts the constant's value.
- **MISSING TEST** either wire the concept and test the blended aggregate, or delete the constant and its assertion. **Do not change either without a product decision** — this report only records the divergence.

### G-04 — Evidence granularity makes 64% of PASS rows unverifiable

- **ROOT CAUSE** `09_FULL_SYSTEM_TEST_RESULTS.json` assigns one shared bundle string to 72 rows.
- **IMPACT** a row cannot be traced to an assertion, so `E2E-007` (Staging) was reported PASS from unit tests.
- **EVIDENCE** §8, F-01…F-05.
- **MISSING TEST** per-row evidence must name a file plus a test name; E2E rows must be `BLOCKED — ENVIRONMENT GAP` until a staging environment exists.

### G-05 — The customer-facing chain is entirely unverified

- **ROOT CAUSE** publish, report, score card, and LINE are only testable end-to-end against a live environment, and there is no staging.
- **IMPACT** the exact artifacts a customer receives are the least verified part of the system: `LINE 0/11`, `DASH 0/11`, `REPORT 2/10`, `CARD 2/12`, all from 404 probes.
- **EVIDENCE** §13; `09_FULL_SYSTEM_TEST_RESULTS.json` per-layer counts.
- **STATUS** **BLOCKED — ENVIRONMENT GAP.** Not convertible to PASS.
- **MISSING TEST** a staging deployment with a synthetic Case, plus in-process tests for the state machines that need no network (N-09, N-10, N-11).

### G-06 — Manual edit can be outranked by a stale converted value

- **ROOT CAUSE** `persistMeterReadings` (`assessment.js:1478`) writes `meterReadings` only, while scoring prefers `standardMeasurement` per key (`score.js:1037`). `storeRawAndStandardMeasurements` runs on the OCR path only (`assessment.js:1275`).
- **IMPACT** if OCR produced a value and the operator corrects it by hand, the engine may keep using the OCR-derived converted value; the UI shows the corrected number, so the discrepancy is invisible.
- **AFFECTED FLOW** measurement → score → publish, i.e. the published number.
- **EVIDENCE** single call site for `storeRawAndStandardMeasurements`; the precedence expression at `score.js:1037`.
- **CURRENT TEST COVERAGE** `scripts/test-pr3-score-standard-source.js` covers the happy precedence only, and is outside the suite.
- **MISSING TEST** OCR fills a value → operator edits it → assert the scored input equals the edited value (or, if precedence is intended, assert and document that).
- **NOTE** classified as a **bug risk**, not a confirmed customer-visible defect: reproducing it requires the OCR-then-edit sequence, which was not executed under the read-only policy.

### G-07 — API failure can put mock customers on a real dashboard

- **ROOT CAUSE** `loadJobsFromApi` returns `false` on any thrown error, and `app.js:10-17` then loads `clients_30_mock_data.csv`.
- **IMPACT** the dashboard could show fabricated Cases. Related: `job-state.js:1163` evaluates `typeof OperatorNotificationObserver?.syncFromJobs`, which throws a `ReferenceError` if that global was never declared — the exact error observed in the test sandbox. In the browser this cannot fire because `index.html:74-75` loads `observer.js` and `bridge.js` before `app.js`, so this is a **latent risk, not a production defect**.
- **EVIDENCE** `job-state.js:1161-1169`; `app.js:10-17`; `index.html:74-75`.
- **CURRENT TEST COVERAGE** none for the fallback branch.
- **MISSING TEST** `loadJobsFromApi` throws → assert no CSV seeding and a visible error state instead of mock data.

### G-08 — Cal cancel and reschedule have no handler

- **ROOT CAUSE** by design, only `BOOKING_CREATED` is handled (`cal-routes.js:131-146`).
- **IMPACT** a customer cancelling or moving a booking in Cal.com leaves the Case scheduled; an operator may travel to a cancelled appointment.
- **STATUS** **NEED REQUIREMENT** — not a code defect until the product decides the behavior.
- **MISSING TEST** none until the requirement exists.

### G-09 — Two smaller divergences worth recording

| Item | Detail |
| --- | --- |
| `API-006` | matrix predicts 500 for malformed JSON; source produces **502** (`case-flow-routes.js:624`, `SyntaxError` has no `statusCode`). Documentation defect, not a code defect. |
| Registry fallback | an unknown country key silently scores with Thailand (`registry.js:20-22`). UI callers guard with `has()`, and server-side keys are validated by `country-standard-case-contract.test.js`, so the impact is contained — but the fallback itself has no test. |

---

## 15. Final QA Verdict

> **PRODUCTION NOT VERIFIED — EXECUTION PATH PARTIALLY TRACED, CUSTOMER-FACING CHAIN UNVERIFIED**

### 1. Have we traced the real execution path?

**Yes, now.** All six segments were reconstructed from source with `file:line` citations (§1), and six assumed transitions were proven not to exist (§1.7) — including `POST /api/line/send-result`, direct Framer→Case creation, and any path from the displayed Hero to the published score. The trace itself was the missing artifact: the 258-row matrix described endpoints, not the path between them.

### 2. Are there important source functions with no test?

**Yes — 14, listed in §6.** The most consequential are `verifyCalSignature` (the only authentication on Case creation), `createCase` (Case SSOT), `executeSendCaseResult` (the customer's LINE message), and `cardOptionsFromJob` (renders `0` for a null score). **Eleven of the fourteen are pure functions or already-stubbable and need no staging** — the blocker is authorship, not environment.

### 3. Are there important transitions with no test?

**Yes — 9, listed in §7.** The pattern is consistent: both endpoints are tested in isolation while the hop between them is not. The most serious are validator→engine wiring (T-01), Quality V3→ledger via HTTP (T-02), and Case completed→LINE delivered (T-05).

### 4. Do 258 cases cover real behavior, or is there false coverage?

**Both.** The scoring core is genuine, derived-expectation coverage. But 72 of 113 PASS rows (64%) share a single evidence string, one test asserts a constant that no code reads, one asserts source text rather than behavior, and three E2E rows were reported PASS from unit tests. Corrected labels are in §8.

### 5. Is the critical path Website → Publish → Report → LINE complete?

**No. BLOCKED — ENVIRONMENT GAP.** Every write step needs either staging or a production mutation that policy forbids. Measured coverage: LINE 0/11, Dashboard 0/11, Report 2/10 (404 probes), Card 2/12 (404 probes). No Case has been driven end-to-end in any environment this QA can reach.

### 6. Is the score engine traced from reading to displayed score?

**Yes — this is the strongest part of the system.** Every stage is cited (§3), the two paths are proven separate by five independent pieces of evidence (§3.4), all five engines are tabulated with their real weights and exclusions (§4), and scoring is proven free of Case-identity branching (§3.5). Residual holes are narrow: the `weightTotal === 0` fallback, the registry unknown-key fallback, `toFiniteReading` itself, and multi-tap averaging.

### 7. If a regression happens tomorrow, where would QA miss it?

**Would be caught** (assuming someone runs the tests manually): any change to grade curves, weights, severity caps, the 99 ceiling, the 79 missing-chlorine cap, Quality V3 aggregation, the locked Case 13.28 baseline, publication idempotency and ledger immutability, measurement validation, and Case rehydration after reload.

**Would NOT be caught:**

| Blind spot | Why |
| --- | --- |
| Any HTTP status or payload change | no test crosses an HTTP boundary |
| A broken Cal signature check or adapter validation | N-01, N-02 have no tests |
| Duplicate or missing customer LINE messages | N-09 has no test |
| A score card rendering **0** instead of failing | N-10 has no test |
| Feedback accepting an invalid rating | N-11 has no test |
| A stale `standardMeasurement` overriding an operator's correction | G-06 |
| Mock CSV customers appearing on a real dashboard | G-07 |
| Aggregation semantics changing while `weakestLinkShare` assertions still pass | G-03 |
| A country key typo silently scoring as Thailand | G-09 |
| Multi-tap averaging changing a Hero score | T-07 |
| **Any regression at all, if nobody remembers to run the tests** | **G-01 — no runner, no CI, no hook** |

### Recommended order of work (no code changed by this report)

1. **G-01** — add `npm test` and a CI check. Nothing else durably matters until the locks run automatically.
2. **G-02** — write the 11 staging-free unit tests from §6, starting with `verifyCalSignature`, `rejectPayload`, `executeSendCaseResult`, `cardOptionsFromJob`.
3. **G-04** — re-issue per-row evidence; demote the three mislabelled E2E rows.
4. **G-06** — decide the intended precedence between a manual edit and a stale conversion, then pin it with a test.
5. **G-03 / G-08** — product decisions required before any code moves.
6. **G-05** — a staging environment is the only way to close the customer-facing chain.

---

### Read-only compliance statement

No production source, scoring source, test, or expected value was modified. No commit, push, or deploy. No Case created; nothing published or republished; no LINE message sent; no Notion data mutated. Production was accessed only through idempotent `GET` requests (`/api/cal/webhook/status`). Scoring modules were executed in-process as pure functions to verify `toFiniteReading` behavior; no file was written by those runs.
