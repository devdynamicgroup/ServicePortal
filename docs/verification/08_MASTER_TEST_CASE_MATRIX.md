# 08 — Master Test Case Matrix (End-to-End System Test)

**Mode:** Analysis only — no code changes, no Case creation, no Publish/Republish of customer data  
**Date:** 2026-08-20  
**Author role:** QA / System Test Engineer  
**Baseline flags:** `CUSTOMER_DOMAIN_* = false`, `CARE_LIFECYCLE_* = false` unless a row says otherwise  
**Status rule:** every row starts as **NOT RUN**. Do not mark PASS from memory.

This document is the checklist for:

> Framer Website → Booking → Webhook → Backend → Notion Case → Service Portal → Measurement/OCR → Water Score → Benchmark/Country → Publish → Public Report → Share Card → LINE → Dashboard → Feedback → Persistence → Reload → Production

It supersedes `04_QA_MATRIX.md` for **system-wide** coverage. Keep `04` for Care/Customer-flag rows that are out of the current production path.

---

## Architecture understanding (required context)

- **Case** is the operational aggregate root (booking, workflow, offer attribution, feedback status, report tokens, `notificationStatus`).
- **Customer** is identity-only and **OFF** in production defaults. Exact match only; no fuzzy; no name auto-merge.
- **Framer** (`https://www.water-motion.co`) is an external marketing site. This repo owns `GET /api/public/water-check-offer` and Cal webhook intake. Framer payloads are a protected contract.
- **Cal.com** is an external intake channel. `BOOKING_CREATED` is the only trigger that creates a Case. Cancel/reschedule are acknowledged but **not processed**.
- **Displayed Country Hero** comes from `WaterScoreBenchmarkRegistry.calculate(selectedKey)`. **Published Quality V3** stays on `S.scoreVal` / `currentScoreResult` (`quality-v3.0`).
- Country Hero composite is capped at **99**. Severity protection is a **ceiling + guaranteed deduction**, never a floor that raises a score. `NOT_EVALUATED` / `NOT_MEASURED` are excluded from worst-classification.

## How to use

1. Run **Local (unit)** rows with `node tests/...` first — those lock expected numbers.
2. Staging/Test for any write path (`POST /api/cases`, Cal webhook, publish, LINE send).
3. Production is **read-only** unless a signed exception exists. Rows marked **NOT SAFE TO RUN IN PRODUCTION** must not be executed against live customer Cases.
4. If observed ≠ expected: classify using § Failure classification. Do **not** patch a single Case.
5. If no source of truth exists: leave expected as **NOT VERIFIED / NEED REQUIREMENT**. Do not invent a score.

## Source of truth index

| Area | Source |
|------|--------|
| Case create / tokens / notify default | `services/case-creation-service.js`, `services/booking-validation.js` |
| Cal webhook / adapter | `api/cal-routes.js`, `services/cal-booking-adapter.js`, `services/cal-webhook.js` |
| Offer | `services/water-check-offer-service.js`, `api/public-routes.js` |
| Persistence / reload | `tests/case-persistence-rehydration.test.js`, `src/js/job-state.js` |
| Measurement gate | `src/js/score/validation/measurementValidator.js`, `tests/score/measurement-validation.test.js` |
| Shared grade + weights | `computeSharedBenchmarkBase` in `src/js/score/production/computeQualityScoreV2.js` |
| TH/JP/WHO/EU/EPA | `src/js/score/benchmark/*/limits.js`, `weights.js`, `score.js` |
| Hero 99 + severity | `src/js/score/util/benchmarkMetadata.js` |
| Locked scores | `tests/score/case-1328-calibration-baseline.test.js`, `country-hero-ceiling.test.js`, `displayed-score-country-switch.test.js`, `thailand-japan-flow.test.js`, `quality-v2-calibration.test.js`, `country-benchmark-semantics.test.js` |
| Publish idempotency | `tests/publish/publication-idempotency.test.js` |
| Report / card | `api/case-flow-routes.js`, `api/public-routes.js`, `services/score-share-card.js` |
| Feedback | `services/client-feedback.js` |
| LINE | `api/line-routes.js`, `services/workflow-service.js` |
| Health | `api/ops-routes.js` |

**Known fixture (do not recreate):** Case name `13.28`, `notionId` `3b59a92d-fb61-81d0-b8dd-f85d416bacac` — identity lock only (`tests/case-persistence-rehydration.test.js`). Scoring uses the **reading object** `CASE_1328`, not live mutation of that Case.

---

# Part 1 — Master Test Case Matrix

All **Status** = `NOT RUN`. **Actual** is recorded by the tester in Notes/Evidence after execution.

Legend — Environment: `Local-unit` · `Local` · `Staging` · `Prod-RO` · `UNSAFE-PROD`  
Legend — Risk: `L` `M` `H` `C`

---

## A. Website / Customer Entry (`WEB`)

Framer source is **not in this repo**. Visual/CTA expected results are from the live public site observed 2026-08-20 and from Portal contracts. Field-level Framer form rules are **NEED REQUIREMENT** unless mapped through Cal adapter.

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| WEB-001 | Website | Load | Homepage loads | Public DNS | `GET https://www.water-motion.co/` | Open URL | HTTP 200; title contains Water Motion | Marketing site independent of Portal writes | Prod-RO | L | NOT RUN | Live 2026-08-20 snapshot | Framer hosted externally |
| WEB-002 | Website | Responsive | Desktop hero readable | Desktop viewport ≥1200 | n/a | Load homepage | Primary CTA `Book Free Water Check` visible; rating line readable on dark photo | Visual contract | Prod-RO | M | NOT RUN | Live snapshot | |
| WEB-003 | Website | Responsive | Phone hero contrast | Width ~390 | n/a | Load homepage on phone | Rating/meta line must remain readable over photo (white-on-light fade is a known visual risk) | Contrast of hero meta text | Prod-RO | H | NOT RUN | Live mobile snapshot 2026-08-20 | Visual only; not a Portal bug |
| WEB-004 | Website | CTA | Book Free Water Check | Site loaded | n/a | Click primary CTA | Navigates to in-page Cal embed (anchor), not `POST /api/cases` | Framer must not create Cases | Prod-RO | H | NOT RUN | Prior booking audit; `docs/CALCOM_*` | Protected Framer contract |
| WEB-005 | Website | Offer counter | Live remaining slots | Portal up | `GET /api/public/water-check-offer` | Load homepage; compare banner vs API | Banner remaining equals API `remaining` (cache ≤60s) | Offer SoT is Case-derived | Prod-RO | M | NOT RUN | `water-check-offer-service.js` TTL 60s | Stale up to 60s is specified |
| WEB-006 | Website | Offer API CORS | Allowed origin | Request from water-motion.co | Origin header | Browser fetch offer API | 200 `{ok:true,totalSlots,used,remaining}` | CORS allow-list only | Prod-RO | M | NOT RUN | `api/public-routes.js` | `*` never allowed |
| WEB-007 | Website | Offer API CORS | Disallowed origin | Other Origin | Origin `https://example.com` | Fetch offer API | No `Access-Control-Allow-Origin` for that origin | Public API scoped | Local | L | NOT RUN | `getAllowedOrigins()` | |
| WEB-008 | Website | Offer API error | Notion down | Force offer failure locally | n/a | GET offer when Notion fails | 502 `{ok:false,error:'Offer status is temporarily unavailable'}` — no internal leak | Public error opacity | Local | M | NOT RUN | `handlePublicRoute` catch | Do not take Portal down in prod to test |
| WEB-009 | Cal embed | Booking UI | Calendar renders | Cal embed URL | `app.cal.com/watermotion/60min` | Open embed | Calendar UI loads | External Cal | Prod-RO | M | NOT RUN | Prior audit embed URL | |
| WEB-010 | Cal embed | Required identity | Missing attendee name | Staging Cal | Booking without name | Submit | Adapter rejects: `Missing attendee name` → **400**; **no Case** | `fullName` required | Staging | H | NOT RUN | `cal-booking-adapter.js` | Do not use prod Cal |
| WEB-011 | Cal embed | Required uid | Missing booking uid | Staging | Payload without `uid` | POST webhook | Reject `Missing Cal booking identifier (uid)`; no Case | Durable Cal id required | Staging | H | NOT RUN | adapter L118 | |
| WEB-012 | Website | Duplicate submit | Double book same slot | Staging | Same Cal uid twice | Submit twice | Second delivery idempotent: same `caseId`, `duplicate:true` | One Case per `calBookingId` | Staging | H | NOT RUN | adapter `findClientByCalBookingId` | UNSAFE-PROD |
| WEB-013 | Website | Refresh | Reload during booking | Staging Cal | Mid-form | Reload page | Cal embed state is Cal's; Portal must not have a Case until BOOKING_CREATED succeeds | No speculative Case | Staging | M | NOT RUN | Cal creates only on webhook | NEED REQUIREMENT for Framer form persistence |
| WEB-014 | Website | Back/forward | Browser history | Staging | n/a | Back/forward around embed | NEED REQUIREMENT — Framer/Cal history not specified in repo | Not inventable | Staging | L | NOT RUN | none | NEED REQUIREMENT |
| WEB-015 | Website | Address | Address captured on Case | Staging booking | Address in Cal responses | Complete BOOKING_CREATED | Case stores mapped address from adapter field extract | Case holds booking address | Staging | M | NOT RUN | adapter extract `address` | Schema mapping via Notion mapper |
| WEB-016 | Website | Date/time | Appointment persisted | Staging | Known start/end ISO | Complete booking | Case `appointmentStart`/`appointmentEnd`/`appointmentDate` from Cal times | Booking time on Case | Staging | H | NOT RUN | adapter + `CUSTOMER_INPUT_FIELDS` | |

---

## B. Cal.com / Booking (`CAL`)

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| CAL-001 | Cal | Status | Webhook status | Server up | GET `/api/cal/webhook/status` | GET | 200; `createsCases:true`; `createsCasesFor:['BOOKING_CREATED']` | Status is observational | Prod-RO | L | NOT RUN | `api/cal-routes.js` | |
| CAL-002 | Cal | Signature | Valid signature | `CAL_WEBHOOK_SECRET` set | Signed BOOKING_CREATED | POST `/api/cal/webhook` | 200 `processed:true` if payload valid | Secret enforces HMAC | Staging | H | NOT RUN | `verifyCalSignature` | |
| CAL-003 | Cal | Signature | Invalid signature | Secret set | Bad `X-Cal-Signature-256` | POST | **401** `{error:'Invalid Cal signature'}`; no Case | Reject before parse-process | Staging | C | NOT RUN | cal-routes L87–98 | Header name from `SIGNATURE_HEADER` |
| CAL-004 | Cal | Signature | Secret unset | Local only | Any body | POST | Signature **not** enforced; warn log `cal_webhook_secret_missing` | Dev-only hole | Local | H | NOT RUN | cal-routes L100–105 | Must not be true in prod |
| CAL-005 | Cal | Body | Oversized body | n/a | >1 MiB | POST | 400; connection destroyed | DoS guard | Local | M | NOT RUN | `readRawBody` 1024*1024 | |
| CAL-006 | Cal | Body | Invalid JSON | Valid sig | `{` | POST | 400 `{error:'Invalid JSON'}` | | Local | L | NOT RUN | L108–113 | |
| CAL-007 | Cal | Scope | BOOKING_CANCELLED | Valid sig | `triggerEvent=BOOKING_CANCELLED` | POST | 200 `processed:false`, `createsCases:false`; **Case unchanged** | Cancel out of scope by design | Staging | H | NOT RUN | cal-routes L131–146 | REQUIREMENT GAP if product wants cancel |
| CAL-008 | Cal | Scope | BOOKING_RESCHEDULED | Valid sig | reschedule event | POST | Same as CAL-007 | No Case update | Staging | H | NOT RUN | same | REQUIREMENT GAP |
| CAL-009 | Cal | Create | BOOKING_CREATED happy path | Staging Notion | Valid attendee name + uid | POST | 200 `caseCreated:true`, `caseId` = Notion id | Successful create ⇒ durable `notionId` | Staging | C | NOT RUN | adapter + `createCase` | UNSAFE-PROD |
| CAL-010 | Cal | Idempotency | Duplicate webhook | Existing Case with same uid | Replay same payload | POST | 200 `duplicate:true`, `caseCreated:false`, same `caseId` | One Case per uid | Staging | C | NOT RUN | `withCaseLock('cal-booking:'+uid)` | |
| CAL-011 | Cal | Retry | Cal retries after 502 | First attempt failed after Case write | Same uid | POST retry | Must resolve existing Case; must not second Case | Dedupe before create | Staging | C | NOT RUN | adapter L122–130 | |
| CAL-012 | Cal | Mapping | launchOffer / campaign | Staging | Event type mapped to launch | Create | `campaignOffer` = `WATER_CHECK_CAMPAIGN_OFFER` or `'Launch Offer 2026'` | Offer attribution via Case field only | Staging | H | NOT RUN | `resolveCampaignOffer` | Cal must not write used/remaining |
| CAL-013 | Cal | Mapping | Date/time | Staging | Known ISO start | Create | Persisted on Case customer fields | | Staging | H | NOT RUN | adapter extract start/end | |
| CAL-014 | Cal | Missing name | No attendee name | Valid sig | uid present, name empty | POST | **400** `Missing attendee name`; no Case | Adapter `rejectPayload` | Staging | H | NOT RUN | cal-booking-adapter.js | |
| CAL-016 | Cal | Missing times | No start/end | Valid sig | uid+name, no times | POST | **400** `Missing appointment start/end time`; no Case | Times required | Staging | H | NOT RUN | adapter L120 | Phone/email/address optional |
| CAL-017 | Cal | Launch offer | Known event type | Staging | `eventTypeId === 6040165` | Create | `{ launchOffer: true, campaignOffer: 'Launch Offer 2026' }` | Unknown event type does **not** default to launch | Staging | H | NOT RUN | `services/cal-offer-mapping.js` | |
| CAL-015 | Cal | In-memory dedupe | Replay placeholder | Process memory | Same raw body twice quickly | POST twice | `noteCalDelivery` may flag `duplicate` even before adapter | Placeholder ≠ durable SoT | Local | M | NOT RUN | `cal-dedupe-placeholder` | Durable SoT is Notion `calBookingId` |

---

## C. Backend / API (`API`)

Auth: **401** `UNAUTHENTICATED` if session missing/invalid; **403** `FORBIDDEN` if session is valid but the user is no longer in `AUTH_USERS_JSON` (`services/app-auth.js`).

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| API-001 | API | POST /api/cases | Valid | Auth session | `{fullName:'QA Staging'}` + skipMap | POST | **201** `{ok:true, case, tokens}`; `notificationStatus=not_sent`; `caseWorkflowStatus=scheduled` | Case SSOT | Staging | C | NOT RUN | case-creation-service; case-flow-routes L604 | UNSAFE-PROD |
| API-002 | API | POST /api/cases | Missing fullName | Auth | `{}` | POST | **400** `Full Name is required`; no Case | Only required customer field | Staging | H | NOT RUN | booking-validation.js | |
| API-003 | API | POST /api/cases | Empty fullName | Auth | `{fullName:'   '}` via map | POST | 400 (trim empty fails `if (!customer?.fullName)`) | | Staging | M | NOT RUN | pickCustomerInput skips `''` | |
| API-004 | API | POST /api/cases | Unauthorized | No cookie | Valid body | POST | **401** | Staff route | Local | H | NOT RUN | assertAppAuth | |
| API-005 | API | POST /api/cases | Duplicate idempotency | Auth | Same Idempotency-Key | POST twice | Second is replay (`wasReplayed`); no second Notion Case | `withIdempotency` | Staging | H | NOT RUN | case-flow-routes L608–621 | |
| API-006 | API | POST /api/cases | Malformed JSON | Auth | `{` | POST | Likely **500** (`readJson` `JSON.parse` uncaught) — **NOT VERIFIED** by test | | Local | L | NOT RUN | `readJson` | Do not invent 400 unless a test asserts it |
| API-007 | API | POST /api/cases | launchOffer | Auth | `{fullName, launchOffer:true}` | POST | `campaignOffer` default Launch Offer 2026; offer cache invalidated | Offer counts Case | Staging | H | NOT RUN | resolveCampaignOffer | UNSAFE-PROD |
| API-008 | API | GET clients | List Cases | Auth | n/a | GET `/api/clients` | 200 list of Cases | Case list from Notion | Staging | M | NOT RUN | clients-routes.js | |
| API-009 | API | GET clients | Unauthorized | None | n/a | GET | 401 | | Local | M | NOT RUN | assertAppAuth | |
| API-010 | API | POST start | Valid | Auth, Case exists | Case id | POST `/api/cases/:id/start` | 200; workflow advanced | Legal transition | Staging | H | NOT RUN | workflow-service startCase | UNSAFE-PROD |
| API-011 | API | POST start | Not found | Auth | Unknown id | POST | statusCode 404 or 502 | | Staging | M | NOT RUN | resolveJob | Exact 404 vs 502: follow thrown `statusCode` |
| API-012 | API | POST close | Valid | Auth, started Case | id | POST close | 200 Case closed; may publish if no pointer yet | | Staging | H | NOT RUN | closeCase | UNSAFE-PROD |
| API-013 | API | POST cancel | Valid | Auth | id | POST cancel | 200; cancelled; offer slot may free | `isCancelledJob` | Staging | H | NOT RUN | cancelAppointment | UNSAFE-PROD |
| API-014 | API | POST send-result | Valid LINE | Auth, linked LINE, published | id | POST send-result | notify SM sending→sent or failed; **409** if Case not completed; **422** if no report URL | Case owns notificationStatus | Staging | C | NOT RUN | workflow-service L288–302 | UNSAFE-PROD |
| API-015 | API | POST send-result | Unauthorized | None | id | POST | 401 | | Local | M | NOT RUN | assertAppAuth | |
| API-016 | API | POST preassessment | Valid | Case exists | Mapped fields + fullName | POST `/api/cases/:id/preassessment` | 200 Case fields updated | | Staging | H | NOT RUN | submitCustomerPreassessment | Public-ish; still mutates |
| API-017 | API | POST preassessment | Unknown Case | n/a | bad id | POST | **404** `Case not found` | | Staging | M | NOT RUN | L190–193 | |
| API-018 | API | POST /api/test/create-case | Prod disabled | NODE_ENV=production | any | POST | **404** Not found | Test API off in prod | Prod-RO | H | NOT RUN | case-flow-routes L641–645 | Never enable in prod |
| API-019 | API | GET /api/report/:token | Valid | Published token | real rpt token | GET | 200 `{ok:true, report}` | Public, no 401 | Prod-RO | H | NOT RUN | case-flow-routes L755–763; P0.2 test | Use existing published token only |
| API-020 | API | GET /api/report/:token | Unknown | n/a | `rpt-zzzz` | GET | **404** `{ok:false,error:'Report not found'}` | | Prod-RO | M | NOT RUN | same | scripts/test-p0-security.js expects not 401 |
| API-021 | API | GET /r/:token | Unknown | n/a | fake | GET | **404** HTML “Report not found” | | Prod-RO | M | NOT RUN | reportNotFoundHtml | |
| API-022 | API | GET /api/feedback/:token | Unknown | n/a | fake | GET | 404 Feedback not found | | Prod-RO | L | NOT RUN | L767–770 | |
| API-023 | API | POST /api/feedback/:token | Invalid rating | Valid token | rating 0 or 6 | POST | **400** `Rating must be between 1 and 5` | | Staging | M | NOT RUN | client-feedback.js L310–315 | |
| API-024 | API | POST /api/feedback/:token | Empty comment | Valid token | rating 5, comment '' | POST | **400** `Comment is required` | | Staging | M | NOT RUN | L317–322 | |
| API-025 | API | POST /api/ocr/read-meter | Missing fields | Auth | `{}` | POST | **400** `image_url and meter_type are required` | Proxy does not parse OCR | Local | M | NOT RUN | ocr-proxy-routes.js | |
| API-026 | API | POST /api/ocr/read-meter | Wrong method | Auth | GET | GET | **405** METHOD_NOT_ALLOWED | | Local | L | NOT RUN | L47–53 | |
| API-027 | API | POST /api/ocr/read-meter | Unauthorized | None | valid body | POST | 401 | | Local | M | NOT RUN | assertAppAuth | |
| API-028 | API | GET /api/ops/health | Health | n/a | n/a | GET | **200** health payload | Never secret leak | Prod-RO | L | NOT RUN | ops-routes.js | |
| API-029 | API | GET /api/ops/readiness | Ready/not | n/a | n/a | GET | 200 or **503** if `status==='not_ready'` | | Prod-RO | M | NOT RUN | L178–181 | |
| API-030 | API | GET /api/line/webhook | Wrong method | n/a | GET | GET | not processed as webhook | POST only | Local | L | NOT RUN | line-routes | Exact GET status NOT VERIFIED |
| API-031 | API | POST /api/line/webhook | Bad signature | Secret set | bad `x-line-signature` | POST | **401** Invalid LINE signature | | Staging | H | NOT RUN | line-routes L663–665 | |
| API-032 | API | POST /api/cases/:id/score | Publish score | Auth | score 0–100 + optional Idempotency-Key | POST | **200** `publishCaseScore` / `createOrReusePublication`; **400** bad score; **503** ledger missing | This is publish, not draft save | Staging | H | NOT RUN | case-flow-routes.js L574–586 | UNSAFE-PROD |
| API-033 | API | Timeout | Notion timeout | Local mock | n/a | Any write | 502 `{ok:false,error}` typical | No silent success | Local | H | NOT RUN | `error.statusCode \|\| 502` pattern | |
| API-034 | API | POST /api/cases/:id/score-standard | Persist country key | Auth | `scoreStandardKey` ∈ thailand\|japan\|eu\|who\|usEpa | POST | **200**; **400** unsupported key; **409** wrong Notion type | Session vs Case field | Staging | M | NOT RUN | case-flow-routes.js L559–571 | UNSAFE-PROD |
| API-035 | API | POST /api/cases/:id/assessment | Snapshot | Auth | valid snapshot | POST | **200**; stale revision `{skipped:true, reason:'stale_revision'}` | | Staging | M | NOT RUN | case-flow-routes.js L589 | UNSAFE-PROD |
| API-036 | API | POST send-result | Already sent | Auth, status sent | POST again | `{action:'already_sent'}` idempotent | Duplicate send blocked | Staging | H | NOT RUN | workflow-service.js | |
| API-037 | API | Auth | Stale user | Valid cookie, user removed from AUTH_USERS_JSON | GET /api/auth/me or staff route | **403** FORBIDDEN | Distinct from 401 | Local | M | NOT RUN | app-auth.js | |

---

## D. Case Lifecycle (`CASE`)

Invariant for the whole section: **a Case the system reports as created must have durable identity (`notionId`) and must be retrievable after reload/remount.**

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| CASE-001 | Case | Create | Success identity | Staging | unique name | createCase | Returns `ok:true`, `case.notionId` set, tokens `fb-*`/`rpt-*` | Durable Notion id | Staging | C | NOT RUN | createCase return | UNSAFE-PROD |
| CASE-002 | Case | Persistence | Active ref | Unit | TARGET fixture object | persistActiveCaseRef | `wm-active-case-ref` stores notionId+id+date | | Local-unit | H | NOT RUN | case-persistence-rehydration.test.js | Do not recreate 13.28 |
| CASE-003 | Case | Rehydrate | S reset | Unit | TARGET job in JOBS | Clear S.activeJob; restore | Same notionId, measurements intact | Reload must restore Case | Local-unit | C | NOT RUN | same test | |
| CASE-004 | Case | Reload | Notion list replace JOBS | Unit | TARGET + API refresh sim | merge list | TARGET still present; local-only unsynced not wiped | | Local-unit | C | NOT RUN | same test | |
| CASE-005 | Case | Switch | A→B→A | Staging portal | two Cases | Open A, switch B, return A | Identity of A unchanged; readings of A not B’s | No identity swap | Staging | C | NOT RUN | job-state + score isolation tests | |
| CASE-006 | Case | Multiple | Two Cases independent | Staging | two bookings | Create two | Distinct notionId, tokens, calBookingId | | Staging | H | NOT RUN | createCase | UNSAFE-PROD |
| CASE-007 | Case | Disappear | After deploy/restart | Staging | known notionId | Restart server; reload SPA | Case still in GET clients | Server memory is not SoT | Staging | C | NOT RUN | Notion is SoT | |
| CASE-008 | Case | Local-only | Unsynced draft | Unit | job without notionId | Refresh from API | Local-only jobs not deleted by merge | | Local-unit | H | NOT RUN | rehydration test | |
| CASE-009 | Case | Notion fail | createClient throws | Local mock | valid payload | createCase | Error; no successful ok:true | No fake success | Local | H | NOT RUN | createCase awaits createClient | |
| CASE-010 | Case | Dual-write OFF | Default flags | Staging | create | createCase | Case OK without Customer row | DW non-blocking; flags OFF | Staging | M | NOT RUN | dualWriteAfterCaseSuccess | |
| CASE-011 | Case | Duplicate Cal | Same uid | Staging | replay | second create via adapter | idempotent true | | Staging | C | NOT RUN | CAL-010 | |
| CASE-012 | Case | Open | Dashboard open | Portal | existing Case | Click Case | S.activeJob matches notionId | | Staging | M | NOT RUN | UI | |
| CASE-013 | Case | Browser refresh | Mid-score | Portal | active Case | Refresh | restoreActiveCaseFromPersistence | | Staging | H | NOT RUN | job-state.js | |
| CASE-014 | Case | Score isolation | Switch Case | Unit | different readings | switch | displayed score follows active Case readings | case-readings-isolation.test.js | Local-unit | H | NOT RUN | tests/score/case-readings-isolation.test.js | |
| CASE-015 | Case | Tokens | Unique | Staging | two creates | compare | Distinct feedbackToken and publicReportToken | generateUniqueToken | Staging | H | NOT RUN | case-tokens.js | UNSAFE-PROD |

---

## E. Notion (`NOTION`)

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| NOTION-001 | Notion | Create | Read-after-write | Staging | createCase | getClient(created.notionId) | Same identity fields | resolveCreatedJob | Staging | H | NOT RUN | createCase L150–151 | UNSAFE-PROD |
| NOTION-002 | Notion | Mapping | Property names | Schema | FIELD_ALIASES | Inspect mapper | Names match production schema; no rename | Protected Notion props | Prod-RO | C | NOT RUN | services/notion/mapper.js | Never rename |
| NOTION-003 | Notion | Campaign | Missing Campaign Offer prop | Schema without prop | getOfferStatus | used=0 not jobs.length | Offer must not count untagged history | Offer L81–86 | Staging | H | NOT RUN | water-check-offer-service.js | |
| NOTION-004 | Notion | Empty | Empty select/text | Staging | empty optional fields | create | Create succeeds; empty omitted by pickCustomerInput | | Staging | M | NOT RUN | pickCustomerInput | |
| NOTION-005 | Notion | Invalid prop | Unknown key | Staging | extra JSON key | create | Ignored or Notion error — observe; do not invent | NEED REQUIREMENT if undocumented | Staging | M | NOT RUN | mapper | |
| NOTION-006 | Notion | Auth fail | Bad token | Local | invalid NOTION_KEY | any read | Failure; health/readiness reflect | | Local | H | NOT RUN | notion/client | |
| NOTION-007 | Notion | Duplicate | Two pages same calBookingId | Must not happen | n/a | Adapter lookup first | findClientByCalBookingId prevents second | | Staging | C | NOT RUN | adapter | If Notion **Cal Booking ID** property missing, lookup returns null → duplicate Cases possible |
| NOTION-008 | Notion | Update | Preassessment | Staging | known Case | update fields | Read-back matches written mapped fields | | Staging | H | NOT RUN | updateClient | UNSAFE-PROD |
| NOTION-009 | Notion | Persistence | Restart | Staging | known id | restart; getClient | Still exists | | Staging | H | NOT RUN | | |
| NOTION-010 | Notion | Schema mismatch | Renamed prop | Do not rename in prod | n/a | If a prop missing | Mapper alias may miss; field empty | Protected contract | Prod-RO | C | NOT RUN | FIELD_ALIASES | Observe only |

---

## F. Measurement / OCR (`OCR` / `MEAS`)

Scored keys: `ph, tds, turbidity, orp, chlorine, do`. Passthrough (not scored): `temp, ec, doPercent, totalChlorine`.

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| OCR-001 | OCR | Proxy valid | Auth + fields | OCR service | image_url, meter_type | POST /api/ocr/read-meter | 200 body from ocrClient (statusCode stripped) | Proxy does not interpret | Staging | M | NOT RUN | ocr-proxy-routes.js | |
| OCR-002 | OCR | Missing | Empty body | Auth | `{}` | POST | 400 VALIDATION_ERROR | | Local | L | NOT RUN | L80–90 | |
| OCR-003 | OCR | Unauth | No session | n/a | valid | POST | 401 | | Local | M | NOT RUN | | |
| OCR-004 | OCR | Binding | meter_type mismatch | Auth | pH image + tds type | POST | Observe returned value; binding correctness is OCR service — NEED REQUIREMENT for expected digits | Do not invent reading | Staging | H | NOT RUN | ocrClient | |
| MEAS-001 | Measurement | Invalid null | Scoring gate | Unit | chlorine=null | validateMeasurements | field.value `null`, not `0` | Number(null) must not become 0 | Local-unit | C | NOT RUN | measurement-validation.test.js | |
| MEAS-002 | Measurement | Invalid empty | Scoring gate | Unit | `''`, `'   '` | validate | MISSING, value null | | Local-unit | C | NOT RUN | same | |
| MEAS-003 | Measurement | Invalid types | Scoring gate | Unit | false/true/[]/{} | validate | INVALID_TYPE, value null | | Local-unit | C | NOT RUN | same | |
| MEAS-004 | Measurement | NaN/Infinity | Scoring gate | Unit | NaN, ±Infinity | validate | not a valid number | | Local-unit | C | NOT RUN | same | |
| MEAS-005 | Measurement | String number | Decimal | Unit | `'7.79'` | validate | finite 7.79 VALID | | Local-unit | M | NOT RUN | coerceStrictNumber | |
| MEAS-006 | Measurement | Negative | Domain | Unit | ph=-1 | IMPLAUSIBLE if outside 0–14 | pH min 0 max 14 | Plausibility ≠ quality | Local-unit | M | NOT RUN | PLAUSIBLE_RANGES | |
| MEAS-007 | Measurement | Zero | Allowed if in range | Unit | tds=0 | VALID 0 | Zero is not missing | | Local-unit | M | NOT RUN | | OCR mapping drops false-zero for ph/temp/turbidity |
| MEAS-008 | Measurement | DO implausible | 1000 | Unit | do=1000 | IMPLAUSIBLE (max 25) | | Local-unit | M | NOT RUN | PLAUSIBLE_RANGES.do | |
| MEAS-009 | Measurement | Persistence | meterReadings | Unit/UI | CASE_1328 readings | save on Case draft | draft.tapData[0].meterReadings.ph===7.79 after restore | Same object used for score | Local-unit | C | NOT RUN | rehydration test | |
| MEAS-010 | Measurement | Stale | Old tap vs new | Portal | two taps | score uses active readings | No silent mix | Isolation tests | Staging | H | NOT RUN | case-readings-isolation | |
| MEAS-011 | Measurement | Duplicate | Two OCR for same field | Portal | two values | Last write wins? | NEED REQUIREMENT | Do not invent merge rule | Staging | M | NOT RUN | none | NEED REQUIREMENT |
| MEAS-012 | Measurement | EC/DO%/TCl | Collected not scored | Unit | only those set | engines ignore keys | notScored in Q-V3; EC→TDS factor **0.5** if TDS absent | Local-unit | M | NOT RUN | measurementValidator PASSTHROUGH_KEYS; ConversionEngine | Score prefers `standardMeasurement`, falls back to `meterReadings` |
| MEAS-013 | Measurement | toFiniteReading | false/'' | Unit | false | NaN | Same as validator intent | Local-unit | H | NOT RUN | clamp.js toFiniteReading | |

---

## G. Water Score Engine (`SCORE`)

Pipeline (country): reading → `toFiniteReading` → shared `grade*` → **weights keys only** → round → classifications → severity (cap+deduction) → optional missing-Cl cap 79 → **Hero ceiling 99**.

Quality V3 publish path does **not** call `applyCountryBenchmarkHeroCeiling`.

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| SCORE-001 | Score | Ideal Hero | All engines IDEAL | Unit | `{ph:7.2,tds:80,turbidity:0.1,orp:400,do:8,chlorine:0.3,temp:25}` | registry.calculate each | TH/WHO/EU/EPA **99**; **Japan 85** (pH 7.2 is WARNING vs 7.3–7.7) | Country Hero never 100 | Local-unit | C | NOT RUN | country-hero-ceiling.test.js Case A | |
| SCORE-002 | Score | Q-V3 vs Hero | BASE | Unit | BASE `{ph:7.85,tds:175,turbidity:0.42,orp:515,do:5.3,chlorine:0.7,temp:25}` | Q-V3 + JP | Q-V3 **76**; JP **76** (coincide OK); COINCIDE ph=7.5 → JP **81** vs Q-V3 **77** | Same number ≠ leak | Local-unit | C | NOT RUN | country-hero-ceiling Case C | |
| SCORE-003 | Score | WHO BASE | BASE | Unit | BASE | who | **70** | FAIL + deduction | Local-unit | H | NOT RUN | Case B | |
| SCORE-004 | Score | EU BASE | BASE | Unit | BASE | eu | **65** | PD-002 chlorine gate | Local-unit | H | NOT RUN | Case B | |
| SCORE-005 | Score | EPA DIFF | DIFF | Unit | DIFF `{ph:7.2,tds:800,turbidity:3.5,orp:350,do:5.5,chlorine:1.5,temp:28}` | usEpa | **45** | CRITICAL + deduction | Local-unit | H | NOT RUN | Case B | |
| SCORE-006 | Score | Bounds | All keys IDEAL/DIFF | Unit | all engines | score | `0 ≤ score ≤ 99` for country; finite or null | No >99 country Hero | Local-unit | C | NOT RUN | Case D | |
| SCORE-007 | Score | Incomplete | Missing pH | Unit | JP without ph | displayed | score `null`, showScore false | No Q-V3 fallback | Local-unit | C | NOT RUN | displayed-score-country-switch.test.js | |
| SCORE-008 | Score | Missing Cl | TH without chlorine | Unit | ph/tds/turb/orp present, cl missing | TH calculate | Score finite; Cl `NOT_MEASURED`; composite capped **≤79** | Missing ≠ fail class | Local-unit | H | NOT RUN | thailand/score.js L115–120 | Exact number: run engine, do not invent |
| SCORE-009 | Score | Severity ceiling | WARNING | Unit | JP IDEAL | JP | 85 cap | Ceiling never raises | Local-unit | H | NOT RUN | COUNTRY_SEVERITY_CAPS.WARNING=85 | |
| SCORE-010 | Score | Monotonicity | Worse pH | Unit | CASE_1328 vs ph=9.5 | Q-V3 | worse reading **must not increase** Quality | | Local-unit | C | NOT RUN | case-1328 test Boundary | |
| SCORE-011 | Score | Displayed switch | BASE all countries | Unit | BASE | resolveDisplayedScore | TH **79**, JP **76**, WHO **70**, EU **65**, EPA **71**; Q-V3 stays **76** | Displayed ≠ publish | Local-unit | C | NOT RUN | displayed-score-country-switch.test.js | |
| SCORE-012 | Score | Publish tag | After JP switch | Unit | BASE | switch japan | `currentScoreResult.standardKey === 'quality-v3'`; `S.scoreVal===76` | Q-V3 isolated | Local-unit | C | NOT RUN | same | |
| SCORE-013 | Score | Locked sample | LOCKED | Unit | `{ph:7.2,tds:450,chlorine:0.8,turbidity:2.5,orp:350,do:6.5,temp:28}` | all engines | TH **66**, WHO **60**, EU **63**, JP **63**, EPA **57**; legacy DWQI **93** | Frozen lock | Local-unit | C | NOT RUN | case-1328-calibration-baseline.test.js | |
| SCORE-014 | Score | CASE_1328 | Fixture readings | Unit | `{ph:7.79,tds:92,turbidity:0.12,orp:434.1,do:6.34,chlorine:0.3,temp:28.06}` | engines | TH **95**, WHO **92**, EU **94**, JP **85**, EPA **94**; Q-V3 **92** | | Local-unit | C | NOT RUN | case-1328 + thailand-japan-flow L267 | Not live Case mutation |
| SCORE-015 | Score | TH Cl 0.8 | Still pass Cl | Unit | CASE_1328 + cl=0.8 | TH | score **89**; statuses.chlorine **good** | Compliance ≠ high grade | Local-unit | H | NOT RUN | same Boundary | |
| SCORE-016 | Score | Weights | JP vs equal | Unit | coincide BASE ph=7.5 | JP vs Q-V3 | 81 vs 77 | Weight profile affects aggregate | Local-unit | H | NOT RUN | ceiling Case C | |
| SCORE-017 | Score | Classification | PASS/WARN/FAIL/CRIT | Unit | fixtures | inspect classifications | Labels from engine classify() | Do not invent extra states | Local-unit | M | NOT RUN | th/jp score.js | |
| SCORE-018 | Score | Stored vs displayed | After switch | Portal staging | BASE on Case | switch benchmark | Gauge shows country Hero; stored publish score remains Quality until publish | | Staging | H | NOT RUN | SCORE-011/012 | |

---

## H. Country Benchmark (`TH` / `JP` / `WHO` / `EU` / `EPA` / `QV3`)

Default registry key: **`thailand`**.

### Thailand

Policy locked in `thailand/limits.js`: TDS **passMax 500**; turbidity **passMax 1.0**; Excellent verdict **≥90**; DO/Temp **NOT_EVALUATED**; equal weights ph/tds/cl/turb/orp; no `do`/`temp` keys in weights.

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| TH-001 | TH | TDS pass | TDS=500 | Unit | CASE_1328-like with tds=500 | pass.tds | `tds <= 500` true | Legal PASS ceiling | Local-unit | H | NOT RUN | limits.tds.passMax | Exact Hero: run calculate |
| TH-002 | TH | TDS fail | TDS=501 | Unit | tds=501 | pass.tds false | Classification not PASS | Just outside | Local-unit | H | NOT RUN | L79 | Do not invent composite |
| TH-003 | TH | Turb pass | 1.0 | Unit | turbidity=1.0 | pass.turbidity true | passMax 1.0 | Local-unit | H | NOT RUN | limits.turbidity.passMax | |
| TH-004 | TH | Turb fail | 1.01 | Unit | 1.01 | pass false | | Local-unit | H | NOT RUN | | |
| TH-005 | TH | Excellent | CASE_1328 | Unit | CASE_1328 | TH 95 | verdict Excellent (≥90) | Local-unit | H | NOT RUN | verdictFrom; SCORE-014 | |
| TH-006 | TH | DO class | Any DO | Unit | do=0 or 20 | classifications.do | **NOT_EVALUATED** | Never PASS from Number(null) | Local-unit | C | NOT RUN | thailand/score.js L95–99 | |
| TH-007 | TH | Temp class | Any temp | Unit | temp missing/present | **NOT_EVALUATED** | | Local-unit | C | NOT RUN | same | |
| TH-008 | TH | Weights | DO present | Unit | CASE_1328 vs do=0 | scores | Must not change TH composite (do key omitted from weights) | Shared base skips w<=0 / missing key | Local-unit | C | NOT RUN | computeSharedBenchmarkBase L183–188; weights.js | |
| TH-009 | TH | pH band | 6.5 and 8.5 | Unit | ph=6.5 / 8.5 | pass.ph true | min/max 6.5–8.5 | Local-unit | M | NOT RUN | limits.ph | |
| TH-010 | TH | Cl project band | 0.2–2.0 | Unit | cl=0.2 and 2.0 | pass.chlorine true | project-defined | Local-unit | M | NOT RUN | PD-008 | |
| TH-011 | TH | Selection persist | Session | Portal | setScoreReferenceStandard('thailand') | reload SPA | Session key may reset — **NEED REQUIREMENT** if must persist on Case | Cases have no country field | Staging | M | NOT RUN | thailand-japan-flow.test.js | Benchmark is session selection |
| TH-012 | TH | DIFF_TH_SAFE vs JP | Differentiation | Unit | `{ph:8.0,tds:350,turbidity:0.5,orp:400,do:6,chlorine:0.5,temp:26}` | TH vs JP | TH **83**, JP **75** | Same readings, different country rules | Local-unit | H | NOT RUN | country-benchmark-semantics.test.js L199; country-hero-ceiling Case E | |

### Japan

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| JP-001 | JP | DO class | Any DO | Unit | do=3,6,12,null | classifications.do | **NOT_EVALUATED** | PD-012 B | Local-unit | C | NOT RUN | japan/score.js; displayed-score DO variants | |
| JP-002 | JP | DO aggregate | Vary DO | Unit | BASE with do in {null, 3, 8, 20} | displayed JP score | **Identical** score set size 1 | DO excluded from weights | Local-unit | C | NOT RUN | displayed-score-country-switch.test.js | E2E-010 |
| JP-003 | JP | Weights | Keys | Unit | weights.js | inspect | turbidity 0.22, chlorine 0.22, ph 0.16, tds 0.16, orp 0.12; **no do** | Removing key is the exclusion | Local-unit | C | NOT RUN | japan/weights.js | |
| JP-004 | JP | pH comfort | 7.2 vs 7.5 | Unit | IDEAL vs coincide | IDEAL JP **85**; ph=7.5 coincide **81** on BASE variant | Comfort 7.3–7.7 | Local-unit | H | NOT RUN | limits.ph.idealMin/Max | |
| JP-005 | JP | TDS comfort | 200 vs 350 | Unit | tds=200 vs 350 | pass.tds `tds<=idealMax 200` | Legal displayMax 500 ≠ PASS | Local-unit | H | NOT RUN | limits.tds | Composite: run engine |
| JP-006 | JP | Turb comfort | 1 NTU | Unit | turb=1 vs 2 | pass uses excellentMax 1 | Legal ideal=2 is not the PASS used | Local-unit | H | NOT RUN | japan/score.js pass.turbidity | |
| JP-007 | JP | Incomplete | Missing orp | Unit | drop orp | incomplete score null | Required ph/tds/turb/orp | Local-unit | H | NOT RUN | japan/score.js L61–67 | |
| JP-008 | JP | CASE_1328 | pH 7.79 | Unit | CASE_1328 | JP **85** | WARNING cap | Local-unit | C | NOT RUN | SCORE-014 | |

### WHO / EU / US EPA / Quality V3

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| WHO-001 | WHO | Weights | Equal 6 params | Unit | weights.js | ph=tds=turb=orp=cl=do=1 | DO is scored unlike TH/JP | Local-unit | H | NOT RUN | who/weights.js | |
| WHO-002 | WHO | LOCKED | LOCKED | Unit | LOCKED | **60** | | Local-unit | H | NOT RUN | SCORE-013 | |
| EU-001 | EU | Cl gate | BASE | Unit | BASE | **65** | PD-002 gateCap 65 | Local-unit | H | NOT RUN | SCORE-004; eu/limits gateCapOnChlorineFail | UNSUPPORTED ANCHOR documented |
| EU-002 | EU | Weights | chlorine/turb 0.25 | Unit | weights.js | inspect | | Local-unit | M | NOT RUN | eu/weights.js | |
| EPA-001 | EPA | LOCKED | LOCKED | Unit | LOCKED | **57** | | Local-unit | H | NOT RUN | SCORE-013 | |
| EPA-002 | EPA | Cl MRDL | max 4.0 | Unit | limits | mrdlMax 4.0 verified; min 0.2 project | Do not call 0.2–4 an EPA Ideal | Local-unit | M | NOT RUN | usEpa/limits.js | |
| QV3-001 | Q-V3 | Version | Engine tag | Unit | n/a | QUALITY_SCORE_ENGINE_VERSION | `quality-v3.0` | Isolated from country weights | Local-unit | H | NOT RUN | case-1328 test | |
| QV3-002 | Q-V3 | Eligibility | CASE_1328 | Unit | EligibilityEngine | canCalculateScore true; canPublishReport **false** | Score ≠ publish | Local-unit | H | NOT RUN | case-1328 eligibility block | |
| QV3-003 | Q-V3 | All-6 required | Missing do | Unit | 5 params | computeScoreFromReadings | `score: null`, `incomplete: true` | Stricter than country base | Local-unit | H | NOT RUN | computeQualityScoreV2.js | |
| QV3-004 | Q-V3 | Near-ideal 100 | NEAR_IDEAL | Unit | `{ph:7.2,tds:70,turb:0.06,orp:400,do:8.2,cl:0.3}` | Quality | **100** | Country Hero still ≤99 | Local-unit | H | NOT RUN | quality-v2-calibration.test.js | Q-V3 may equal 100; country composite may not |

---

## I. Score Regression / Invariants (`INV`)

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| INV-001 | Invariant | Determinism | Same readings twice | Unit | CASE_1328 | calculate×2 | Identical score | | Local-unit | C | NOT RUN | registry | |
| INV-002 | Invariant | Cross-country | Same readings | Unit | CASE_1328 | 5 engines | May differ; locked table SCORE-014 | Different benchmark may differ | Local-unit | H | NOT RUN | | |
| INV-003 | Invariant | Monotonic | Worse reading | Unit | SCORE-010 | Quality must not improve | | Local-unit | C | NOT RUN | | |
| INV-004 | Invariant | Missing ≠ 0 | null chlorine | Unit | MEAS-001 + engines | null not graded as 0 | toFiniteReading | Local-unit | C | NOT RUN | | |
| INV-005 | Invariant | NOT_EVALUATED | JP DO | Unit | JP-002 | score unchanged across DO | | Local-unit | C | NOT RUN | | |
| INV-006 | Invariant | Weights matter | JP coincide | Unit | SCORE-016 | JP≠Q-V3 | | Local-unit | H | NOT RUN | | |
| INV-007 | Invariant | Severity ceiling | Never raises | Unit | raw below cap | min(score,cap,score-deduction) ≥0 | Ceiling not floor | Local-unit | C | NOT RUN | applyCountrySeverityProtection | |
| INV-008 | Invariant | No score >99 | Country | Unit | IDEAL | ≤99 | COUNTRY_BENCHMARK_HERO_MAX | Local-unit | C | NOT RUN | | |
| INV-009 | Invariant | No score <0 | Extreme fail | Unit | catastrophic | ≥0 | Math.max(0,…) | Local-unit | H | NOT RUN | benchmarkMetadata.js L86 | |
| INV-010 | Invariant | No Case patch | Any | n/a | grep/policy | Scoring has no Case-id branch | | Local-unit | C | NOT RUN | architecture | |
| INV-011 | Invariant | Q-V3 isolation | Switch countries | Unit | SCORE-012 | S.scoreVal unchanged | | Local-unit | C | NOT RUN | | |
| INV-012 | Invariant | worst class ignores NE | classifications | Unit | do:NOT_EVALUATED | worstBenchmarkClassification skips non PASS/WARN/FAIL/CRIT | temp skipped too | Local-unit | C | NOT RUN | worstBenchmarkClassification | |

---

## J. Publish / Result Persistence (`PUB`)

**UNSAFE-PROD** unless using a dedicated staging Case.

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| PUB-001 | Publish | Idempotent retry | Same key | Unit store | score 91, key `same-op` | publish twice | same publicationId; score stays **91**; reused true | Retry ≠ new score | Local-unit | C | NOT RUN | publication-idempotency.test.js | |
| PUB-002 | Publish | Double submit | Different key still first | Unit | second intent publish | still 91, one ledger row | No extra row | Local-unit | H | NOT RUN | same | |
| PUB-003 | Publish | Explicit republish | intent republish | Unit | score 77 new key | new publicationId; score **77**; 2 rows | Immutable ledger append | Local-unit | H | NOT RUN | same | UNSAFE-PROD if live |
| PUB-004 | Publish | Eligibility | CASE_1328 | Unit | QV3-002 | canCalculateScore **true**; canPublishReport **false** | Share uses `canCalculateScore`, not `canPublishReport` | Local-unit | H | NOT RUN | EligibilityEngine; score.js shareScore | |
| PUB-005 | Publish | Save vs publish | Portal | Staging Case | save draft score | Save must not mint public token unless publish path | Distinct intents | Staging | H | NOT RUN | publication-store-contract / close-path tests | |
| PUB-006 | Publish | Stale | UI vs ledger | Staging | change readings after publish | Report still old published score until republish | Immutable publication | Staging | H | NOT RUN | immutable-publication.test.js | |
| PUB-007 | Publish | Mismatch | Displayed country vs published Q-V3 | Staging | Hero 85, Quality 92 | Public report shows **published Quality**, not session Hero unless product says otherwise | Publish channel is Quality | Staging | C | NOT RUN | score.js public report comment; SCORE-012 | Confirm on /r/:token |
| PUB-008 | Publish | Failure | Store down | Local | mock fail | no ok success; no half token | | Local | H | NOT RUN | publication-recovery.test.js | |
| PUB-009 | Publish | Partial | Notion write fail after ledger | Local | injected fail | recovery path per publication-recovery.test.js | | Local-unit | H | NOT RUN | tests/publish/publication-recovery.test.js | |
| PUB-010 | Publish | Prod mutate | Live customer | Production Case | n/a | **DO NOT RUN** | Customer report would change | UNSAFE-PROD | C | NOT RUN | policy | |

---

## K. Public Report (`REPORT`)

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| REPORT-001 | Report | Valid token | Existing published | Known rpt | GET `/r/{token}` | 200 HTML | Token→that Case | Prod-RO | H | NOT RUN | case-flow-routes L791–795 | Use already-public URL only |
| REPORT-002 | Report | API valid | Same token | GET `/api/report/{token}` | 200 `{ok:true,report}` | Same Case identity | Prod-RO | H | NOT RUN | L755–763 | |
| REPORT-003 | Report | Invalid | rpt-zzzz | GET API | 404 | Not 401 | Prod-RO | M | NOT RUN | P0.2 | |
| REPORT-004 | Report | HTML unknown | fake | GET `/r/fake` | 404 HTML | | Prod-RO | M | NOT RUN | reportNotFoundHtml | |
| REPORT-005 | Report | Expiry | Old token | n/a | n/a | **NEED REQUIREMENT** — no TTL found in handlers | Do not invent expiry | Prod-RO | M | NOT RUN | none | NOT VERIFIED |
| REPORT-006 | Report | Reload | Valid | GET twice cache-no-store | Same score | public-report.js cache:'no-store' | Prod-RO | M | NOT RUN | src/js/public-report.js | |
| REPORT-007 | Report | Score display | Published | Compare API waterScore vs page | Match published | PUB-007 | Prod-RO | C | NOT RUN | | |
| REPORT-008 | Report | Missing score | Token exists unpublished | Staging | GET | Observe 200 vs empty score — **do not assume 404** | HTML route does not check finite score (only token→job) | Staging | H | NOT RUN | getReportByToken; compare CARD-003 | Possible product gap |
| REPORT-009 | Report | Identity | Token | API body | notionId/name consistent | | Prod-RO | H | NOT RUN | | |
| REPORT-010 | Report | Conflict | Duplicate token | If 409 path | GET score-card | 409 Report token conflict on **score-card** | Ledger conflict | Staging | H | NOT RUN | public-routes.js L91–94 | |

---

## L. Share Card (`CARD`)

Route guard: `!Number.isFinite(Number(job.result?.waterScore))` → **404 Score not published**.  
Helper `cardOptionsFromJob` still does `Number.isFinite(score) ? score : 0` — **must not be reachable** without the guard.

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| CARD-001 | Card | Valid | Published token | GET `/api/public/score-card/{token}` | 200 image/png | Score from job.result.waterScore | Prod-RO | H | NOT RUN | public-routes.js L83–113 | |
| CARD-002 | Card | Unknown token | fake | GET | 404 Report not found | | Prod-RO | M | NOT RUN | L97–101 | |
| CARD-003 | Card | Missing score | Token, waterScore null | Staging | GET | **404** `Score not published` | Number(null) must not render 0 | Staging | C | NOT RUN | L105–107 | Critical coercion guard |
| CARD-004 | Card | Invalid score | waterScore `'abc'` | Staging | GET | 404 Score not published | Number.isFinite false | Staging | H | NOT RUN | same | |
| CARD-005 | Card | Score 0 | Genuine 0 | Staging published 0 | GET | 200 PNG (0 is finite) | 0 ≠ missing | Staging | H | NOT RUN | Number(0) is finite | Distinguish from CARD-003 |
| CARD-006 | Card | Score 99 | Published 99 | GET | 200 | Country Hero max | Staging | M | NOT RUN | | |
| CARD-007 | Card | Story format | `?format=story` | valid token | 1080×1920 | FORMATS.story | Prod-RO | L | NOT RUN | score-share-card.js FORMATS | |
| CARD-008 | Card | Landscape | default | valid | 1200×630 | | Prod-RO | L | NOT RUN | | |
| CARD-009 | Card | Cache | Cache-Control | GET | `public, max-age=300` | | Prod-RO | L | NOT RUN | sendPng 300 | |
| CARD-010 | Card | Demo | `/demo?score=` | GET demo no score | defaults **65** not 0 | Demo only | Prod-RO | M | NOT RUN | L67–71 | |
| CARD-011 | Card | Consistency | Same token | report API vs card | Card depicts same published number | | Prod-RO | C | NOT RUN | | Visual compare |
| CARD-012 | Card | Helper coercion | Unit | job.result.waterScore=null | cardOptionsFromJob | score **0** | Unsafe helper; route must 404 first | Local-unit | C | NOT RUN | score-share-card.js L645–658 | Documented risk |

---

## M. LINE (`LINE`)

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| LINE-001 | LINE | Webhook sig | Invalid | Secret set | bad sig | 401 | | Staging | H | NOT RUN | line-routes.js | |
| LINE-002 | LINE | Link | Valid link | Staging | link event/token | Case lineUserId set; notificationStatus **ready** if linked | lineUserId primary after link | Staging | H | NOT RUN | workflow-service L511 | UNSAFE-PROD |
| LINE-003 | LINE | Send result | Linked + published | Staging | POST send-result | sending → sent; Flex without score preview (score on /r/token) | Case notify SM | Staging | C | NOT RUN | line-notifications.js comment; workflow L305–338 | UNSAFE-PROD |
| LINE-004 | LINE | Missing lineUserId | Unlinked | Staging | send-result | `{status:'skipped', reason:'no_line_user_id'}` — not falsely sent | | Staging | H | NOT RUN | workflow-service.js | |
| LINE-005 | LINE | Invalid lineUserId | Bad id | Staging | send | notificationStatus **failed**; lastNotificationError set | | Staging | H | NOT RUN | workflow failed branch | |
| LINE-006 | LINE | Duplicate send | Already sent | Staging | send twice | `{action:'already_sent'}` — no second send | Idempotent | Staging | H | NOT RUN | workflow-service.js L244–251 | |
| LINE-007 | LINE | Retry | After failed | Staging | repair/send | Can reach sent | repairCaseResultNotification | Staging | H | NOT RUN | `/api/cases/repair-notifications` | |
| LINE-008 | LINE | Correct Case | Two Cases one LINE | Staging | send on A | Message/report token for A not B | Case identity | Staging | C | NOT RUN | | UNSAFE-PROD |
| LINE-009 | LINE | After publish | Order | Staging | send before publish | Observe — NEED REQUIREMENT | | Staging | M | NOT RUN | | |
| LINE-010 | LINE | Card URL | Sent payload | Staging | inspect Flex | score-card URL uses report token | | Staging | M | NOT RUN | line-notifications scoreCardImageUrl | |
| LINE-011 | LINE | Care OFF | Send result | Flags OFF | send | No Care audit side effects | Care ⊥ Case notify | Staging | M | NOT RUN | architecture | |

---

## N. Dashboard / Portal UI (`DASH`)

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| DASH-001 | UI | Case list | Load | Auth | n/a | Open dashboard | Cases from /api/clients | | Staging | M | NOT RUN | | |
| DASH-002 | UI | Current job | Open Case | list | click | S.activeJob identity | CASE-005 | Staging | H | NOT RUN | | |
| DASH-003 | UI | Score gauge | BASE | unit/UI | switch TH/JP | numbers SCORE-011 | Displayed country Hero | Staging | H | NOT RUN | | |
| DASH-004 | UI | Benchmark select | Default | n/a | registry.defaultKey | **thailand** | registry.js | Staging | M | NOT RUN | | |
| DASH-005 | UI | Measurements | CASE_1328 readings | show fields | match meterReadings | MEAS-009 | Staging | H | NOT RUN | | |
| DASH-006 | UI | Empty | No jobs | empty list | empty state not crash | | Staging | L | NOT RUN | | NEED REQUIREMENT copy |
| DASH-007 | UI | Error | API 500 | mock | error state | | Local | M | NOT RUN | | |
| DASH-008 | UI | Stale | After switch | CASE-005 | no leftover score | Isolation | Staging | H | NOT RUN | | |
| DASH-009 | UI | Mobile/desktop | Portal | viewports | usable | | Staging | L | NOT RUN | | |
| DASH-010 | UI | Reload | Refresh | CASE-013 | same Case | | Staging | H | NOT RUN | | |
| DASH-011 | UI | Loading | Slow Notion | observe | no blank identity swap | | Staging | M | NOT RUN | | |

---

## O. Feedback (`FB`)

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| FB-001 | Feedback | GET valid | Known fb token | GET `/api/feedback/{token}` | 200 | | Prod-RO | M | NOT RUN | | Use existing token only |
| FB-002 | Feedback | GET invalid | fake | 404 | | Prod-RO | L | NOT RUN | | |
| FB-003 | Feedback | POST valid | Staging token | rating 1–5 + comment | 200 upsert | rating+comment required | Staging | H | NOT RUN | submitFeedback | UNSAFE-PROD |
| FB-004 | Feedback | Validation rating | 6 | 400 | | Staging | M | NOT RUN | | |
| FB-005 | Feedback | Validation comment | empty | 400 | | Staging | M | NOT RUN | | |
| FB-006 | Feedback | Duplicate | Second POST | same token | upsert same record (update) | Consistent upsert | Staging | M | NOT RUN | upsertFeedbackRecord | |
| FB-007 | Feedback | Wrong Case | token of A on Case B UI | must not write B | Token binds Case | Staging | H | NOT RUN | getFeedbackByToken | |
| FB-008 | Feedback | Page | GET `/f/{token}` | unknown | 404 HTML | | Prod-RO | L | NOT RUN | L802–806 | |
| FB-009 | Feedback | Persistence | After POST | reread GET | rating persisted | | Staging | H | NOT RUN | | |
| FB-010 | Feedback | Reload | page refresh | still submitted | | Staging | M | NOT RUN | | |

---

## P. Production Verification (`PROD`) — read-only

| ID | Layer | Feature | Scenario | Preconditions | Test Data | Steps | Expected Result | Invariant | Environment | Risk | Status | Evidence | Notes |
| -- | ----- | ------- | -------- | ------------- | --------- | ----- | --------------- | --------- | ----------- | ---- | ------ | -------- | ----- |
| PROD-001 | Prod | Health | GET /api/ops/health | 200 | no secrets | Prod-RO | L | NOT RUN | ops-routes | |
| PROD-002 | Prod | Readiness | GET /api/ops/readiness | 200 or 503 | | Prod-RO | M | NOT RUN | | |
| PROD-003 | Prod | SHA | Render/release | compare git SHA vs deployed | NEED REQUIREMENT for how SHA is exposed | If not in health payload: NOT VERIFIED | Prod-RO | M | NOT RUN | buildHealthPayload | |
| PROD-004 | Prod | Offer API | GET public offer | 200 shape | totalSlots default 100 unless env | Prod-RO | M | NOT RUN | | |
| PROD-005 | Prod | Report | Existing /r/token | 200 | customer data already public | Prod-RO | H | NOT RUN | | Do not hunt PII |
| PROD-006 | Prod | Score card | Existing token with score | 200 PNG | | Prod-RO | H | NOT RUN | | |
| PROD-007 | Prod | Cal status | GET webhook/status | createsCases true | | Prod-RO | M | NOT RUN | | Do not POST |
| PROD-008 | Prod | Test API off | POST /api/test/create-case | 404 | | Prod-RO | H | NOT RUN | API-018 | |
| PROD-009 | Prod | Auth | Unauth POST /api/cases | 401 | | Prod-RO | H | NOT RUN | | |
| PROD-010 | Prod | JS parity | Score files | compare deployed JS vs git for score engines | Country weights/limits match git | Prod-RO | C | NOT RUN | forensic probes in .tmp_probe (not SoT) | Prefer tagged release |
| PROD-011 | Prod | Runtime errors | Browser console on /r/token | no uncaught | | Prod-RO | M | NOT RUN | | |
| PROD-012 | Prod | Flags | Health/readiness meta | Customer+Care OFF | | Prod-RO | H | NOT RUN | PROJECT_STATE / ops meta | |

---

# Part 2 — Test Data Matrix

**Rule:** numeric expected scores are taken only from locked tests. Blank expected score ⇒ run `WaterScoreBenchmarkRegistry.calculate` locally; never fill from intuition.

## 2.1 Locked fixtures (from tests)

| ID | Kind | Readings | Locked expected | Source |
| -- | ---- | -------- | --------------- | ------ |
| FX-IDEAL | Near-ideal | ph 7.2, tds 80, turb 0.1, orp 400, do 8, cl 0.3, temp 25 | Country Hero: TH/WHO/EU/EPA **99**; JP **85** | country-hero-ceiling.test.js |
| FX-NEAR-IDEAL | Quality ceiling | ph 7.2, tds 70, turb 0.06, orp 400, do 8.2, cl 0.3 | Q-V3 **100** (country Hero still ≤99) | quality-v2-calibration.test.js |
| FX-BASE | Ordinary | ph 7.85, tds 175, turb 0.42, orp 515, do 5.3, cl 0.7, temp 25 | Q-V3 **76**; displayed TH **79** JP **76** WHO **70** EU **65** EPA **71** | displayed-score-country-switch + ceiling |
| FX-BASE-PH75 | Cross-weight | BASE with ph **7.5** | JP **81**, Q-V3 **77** | country-hero-ceiling Case C |
| FX-DIFF | Harsh | ph 7.2, tds 800, turb 3.5, orp 350, do 5.5, cl 1.5, temp 28 | EPA **45**; Q-V3 ≠ JP | ceiling Case B/C |
| FX-DIFF-TH-SAFE | Cross-country | ph 8.0, tds 350, turb 0.5, orp 400, do 6, cl 0.5, temp 26 | TH **83**, JP **75** | country-benchmark-semantics.test.js L199; country-hero-ceiling Case E |
| FX-LOCKED | Regression | ph 7.2, tds 450, cl 0.8, turb 2.5, orp 350, do 6.5, temp 28 | TH66 WHO60 EU63 JP63 EPA57; legacy DWQI **93** | case-1328-calibration-baseline.test.js |
| FX-1328 | Calibration readings | ph 7.79, tds 92, turb 0.12, orp 434.1, do 6.34, cl 0.3, temp 28.06 | TH95 WHO92 EU94 JP85 EPA94; Q-V3 **92**; TH+cl0.8 → **89** | case-1328 + thailand-japan-flow L267 (readings only — do not mutate live Case 13.28) |
| FX-TARGET-ID | Identity only | name 13.28, notionId `3b59a92d-fb61-81d0-b8dd-f85d416bacac` | Identity lock; **no score claim from live page** | case-persistence-rehydration.test.js |

## 2.2 Boundary / just-inside / just-outside (Thailand policy)

Expected **classification/pass flags** from `thailand/score.js` `pass.*`. Composite scores: **compute, do not invent**.

| Param | Just inside PASS | Boundary PASS | Just outside | Source |
|-------|------------------|---------------|--------------|--------|
| pH | 6.51 / 8.49 | 6.5 / 8.5 | 6.49 / 8.51 | TH limits min/max |
| TDS | 499 | 500 | 501 | passMax 500 (DOH 2020 citation in file) |
| Turbidity | 0.99 | 1.0 | 1.01 | passMax 1.0 (MWA spec citation in file) |
| Cl | 0.21 / 1.99 | 0.2 / 2.0 | 0.19 / 2.01 | project band 0.2–2.0 |
| ORP | 201 / 599 | 200 / 600 | 199 / 601 | 200–600 |

## 2.3 Japan comfort (PASS uses comfort, not legal floor)

| Param | PASS used in engine | Legal/display note | Source |
|-------|---------------------|--------------------|--------|
| pH | 7.3–7.7 | Legal 5.8–8.6 still in limits.min/max | japan/score.js pass.ph |
| TDS | ≤200 | displayMax 500 | pass.tds |
| Turbidity | ≤1 (excellentMax) | legal ideal 2 | pass.turbidity |
| Cl | 0.1–1.0 legal | ideal 0.2–0.5 project | pass.chlorine |
| DO | **not PASS/FAIL** | NOT_EVALUATED | PD-012 B |

## 2.4 Missing / invalid / extreme (measurement gate)

| Class | Values | Expected at validator | Source |
|-------|--------|----------------------|--------|
| Missing | null, undefined, `''`, `'   '` | MISSING, value null | measurement-validation.test.js |
| Invalid type | false, true, [], {}, `'abc'` | INVALID_TYPE, value null | same |
| Non-finite | NaN, ±Infinity | not valid number | same |
| Extreme implausible | do=1000, ph=15 | IMPLAUSIBLE | PLAUSIBLE_RANGES |
| Extreme but plausible | tds=0, orp=-500 | may be VALID | ranges |

## 2.5 Cross-country matrix (same readings)

Run FX-1328 and FX-BASE through all five keys. Expected **only** where locked above. Any other cell: execute tests, do not fill.

## 2.6 Offer / booking data

| Field | Default / rule | Source |
|-------|----------------|--------|
| totalSlots | env `WATER_CHECK_OFFER_TOTAL_SLOTS` or **100** | offer service |
| campaign name | env or `'Launch Offer 2026'` | same |
| createCase required | `fullName` only | booking-validation.js |
| Cal required | `uid` + attendee name | cal-booking-adapter.js |
| Offer used | campaign match AND not cancelled | isActiveOfferBooking |
| Cache | 60s | OFFER_CACHE_TTL_MS |

---

# Part 3 — E2E Critical Path

Do **not** run E2E-001/003/004/005 against production customer data.

| ID | Path | Steps (actual system) | Expected (sourced) | Env | Status |
| -- | ---- | --------------------- | ------------------ | --- | ------ |
| E2E-001 | Website → Booking → Webhook → Case → Notion | Cal BOOKING_CREATED signed → adapter → createCase → Notion page | 200 processed; `caseId` durable; GET client returns same notionId; `notificationStatus=not_sent` | Staging | NOT RUN |
| E2E-002 | Case → Measurement → Score → Save | Enter FX-1328 readings on staging Case → compute | Displayed TH **95** if thailand selected; Q-V3 **92**; draft meterReadings match inputs | Staging | NOT RUN |
| E2E-003 | Score → Publish → Public Report | Publish Quality (if eligible) → open `/r/{token}` + `/api/report/{token}` | Token resolves that Case; score = published Quality not session Hero | Staging | NOT RUN |
| E2E-004 | Publish → Share Card | GET score-card | 200 PNG; number matches published; null score would 404 not 0 | Staging | NOT RUN |
| E2E-005 | Publish → LINE | send-result | SM sent/failed honestly; Flex links `/r/{token}`; no score spoiler in LINE copy | Staging | NOT RUN |
| E2E-006 | Create → Reload | createCase → restart/reload | Case still listed; active ref restores | Staging | NOT RUN |
| E2E-007 | Switch Case → return | A→B→A | Same notionId and readings as A | Staging | NOT RUN |
| E2E-008 | OCR → stored → score | OCR value written to meterReadings → calculate | Scoring input equals stored number (no silent coerce) | Staging | NOT RUN |
| E2E-009 | Benchmark switch | FX-BASE on Case; TH→JP→WHO→EU→EPA | Displayed matches SCORE-011; `S.scoreVal` stays 76 | Staging / Local-unit | NOT RUN |
| E2E-010 | Japan NOT_EVALUATED DO | Vary DO, keep other BASE fields | JP displayed score **identical**; `classifications.do=NOT_EVALUATED` | Local-unit | NOT RUN |

```text
[Framer] --embed--> [Cal.com]
                         | BOOKING_CREATED + HMAC
                         v
              [POST /api/cal/webhook]
                         | adapter + withCaseLock(uid)
                         v
              [createCase → Notion Case]
                         | offer count if campaign
                         v
              [Portal dashboard / measurements]
                         | validator → engines
                         v
         [Displayed Country Hero]  [Quality V3 publish channel]
                         |                    |
                         |              [publication ledger]
                         v                    v
              [GET /r/token + /api/report]  [score-card]
                         |
              [LINE send-result] → Case notificationStatus
```

---

# Part 4 — Verification Dashboard

**Execution date:** 2026-08-20. Row-level Actual/Status: `09_FULL_SYSTEM_TEST_RESULTS.json`. Narrative: `09_FULL_SYSTEM_TEST_REPORT.md`.

| Metric | Count |
|--------|------:|
| Total test cases (Part 1 IDs) | **258** |
| PASS | **113** |
| FAIL | **0** |
| BLOCKED | **134** |
| NOT VERIFIABLE | **0** |
| NOT RUN | **11** |
| Critical-risk rows | 40+ (C in Risk column) |
| UNSAFE-PROD rows | All create/publish/send/feedback writes |
| Locked numeric score cells | See Part 2 FX-* |
| Requirement gaps | 13 listed below |

### By layer (inventory)

| Layer | IDs | Runnable now without mutating prod |
|-------|-----|-------------------------------------|
| WEB | 16 | Prod-RO visual + offer GET |
| CAL | 17 | Status GET only in prod |
| API | 37 | Auth/404/health in prod; writes staging |
| CASE | 15 | Unit persistence tests |
| NOTION | 10 | Schema RO; writes staging |
| OCR | 4 | Staging / local |
| MEAS | 13 | Validator unit |
| SCORE | 18 | **All Local-unit** |
| TH / JP / WHO / EU / EPA / QV3 | 30 | **All Local-unit** |
| INV | 12 | Local-unit |
| PUB | 10 | Unit + staging; PUB-010 never |
| REPORT | 10 | Prod-RO with existing tokens |
| CARD | 12 | Prod-RO + CARD-003 staging |
| LINE | 11 | Staging writes |
| DASH | 11 | Staging |
| FB | 10 | GET RO; POST staging |
| PROD | 12 | Read-only |
| E2E | 10 | Staging / unit |

### Critical failures

None recorded — **NOT RUN**.

### High-risk failures

None recorded — **NOT RUN**.

### Regression locks to run first (before any staging write)

```text
node tests/score/case-1328-calibration-baseline.test.js
node tests/score/country-hero-ceiling.test.js
node tests/score/displayed-score-country-switch.test.js
node tests/score/thailand-japan-flow.test.js
node tests/score/quality-v2-calibration.test.js
node tests/score/measurement-validation.test.js
node tests/case-persistence-rehydration.test.js
node tests/publish/publication-idempotency.test.js
```

If any of these fail: classify as **REGRESSION**, layer = score/publish/persistence — **do not** retune a single Case.

### Requirement gaps / NOT VERIFIED

| Gap | Why | Impact |
|-----|-----|--------|
| Framer field-level validation, back/forward, address autocomplete | No Framer source in repo | WEB-013/014 |
| Report token TTL/expiry | Handlers only 404 unknown | REPORT-005 |
| Duplicate OCR merge rule | No documented last-write policy | MEAS-011 |
| Send-before-publish | Not specified | LINE-009 |
| Deployed SHA in health | May be absent | PROD-003 |
| Cal cancel/reschedule → Case | Explicitly out of scope in code | CAL-007/008 product gap |
| Unpublished `/r/{token}` score UX | Token may 200 with empty score while card 404s | REPORT-008 vs CARD-003 |
| `cardOptionsFromJob` → 0 | Helper unsafe; route guarded | CARD-012 |
| `POST /api/cases` invalid JSON status | `readJson` parse may be uncaught | API-006 — likely 500, not asserted |
| Missing Notion Cal Booking ID property | Lookup returns null → duplicate Cases possible | NOTION-007 |
| `POST /api/line/send-result` | Does **not** exist; use `POST /api/cases/:id/send-result` | LINE-003 |
| Dedicated LINE notification integration suite | No dedicated test file found | LINE-* unit coverage |
| Feedback token vs wrong Case | Token is identity; no extra case-id cross-check | FB submit |

### Failure classification template (use on every FAIL)

```text
ID:
Classification: BUG | REGRESSION | DATA ISSUE | CONFIGURATION ISSUE | TEST EXPECTATION ISSUE | ENVIRONMENT ISSUE | REQUIREMENT GAP | NOT VERIFIABLE
Observed:
Expected (cite file):
Actual:
Root cause layer: Website | Cal | Adapter | API | Case | Notion | OCR | Validator | Engine | Publish | Report | Card | LINE | UI
Evidence:
Forbidden: Case-specific scoring patch
```

---

## Compatibility / regression / rollback notes (QA, not implementation)

- Running this matrix does **not** change production architecture.
- Unit tests are the rollback check for score: if they pass, engines match git.
- Staging writes should use clearly named QA Cases and never republish a real customer `rpt-*`.
- Customer Domain / Care remain **OFF**; do not enable to “make a test pass”.
)