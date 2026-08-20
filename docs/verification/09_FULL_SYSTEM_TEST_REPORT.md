# Full System Test Report

**Mode:** Verify only — no scoring/production code changes, no production Case create/publish/LINE/Notion mutation  
**Run:** 2026-08-20 09:28–09:40 UTC+7  
**Checklist SoT:** `docs/verification/08_MASTER_TEST_CASE_MATRIX.md` (258 IDs)  
**Row ledger:** `docs/verification/09_FULL_SYSTEM_TEST_RESULTS.json`

---

## Environment

| Item | Value |
|------|--------|
| Branch | `main` (tracks `origin/main`) |
| HEAD | `c0eac4e896d840a358c26193ced84a00420ede1e` |
| origin/main | `c0eac4e896d840a358c26193ced84a00420ede1e` (0 ahead / 0 behind) |
| Production SHA | `c0eac4e896d840a358c26193ced84a00420ede1e` (`GET /api/ops/health` → `version`) |
| Local vs deployed | **Match** — unit tests ran against the same commit production reports |
| Production | `https://serviceportal.onrender.com` — **read-only** |
| Staging | **Not configured in repo** — all staging writes BLOCKED |
| Dirty tracked files | Docs + `scripts/simulate-canonical-score.js` + `services/canonical-score/simulate.js` (canonical skeleton only; **not** Quality V3 / country engines used in locks) |
| Untracked | Matrix, this report, `.tmp_probe/` (ignored for scoring) |
| Flags (prod health) | Customer Domain **OFF**; Care lifecycle **OFF** |
| Production ledger | `scorePublicationLedger.configured=false` / `LEDGER_REQUIRED` |

HEAD message: `fix(score): exclude DO from Japan Compliance Index weights` (2026-08-19).

---

## Overall

| Metric | Count |
|--------|------:|
| Total | **258** |
| PASS | **113** |
| FAIL | **0** |
| BLOCKED | **134** |
| NOT RUN | **11** |

**FINAL GATE: PRODUCTION NOT VERIFIED — BLOCKED**

Reason: critical E2E write path (E2E-001…006, E2E-008) and all staging Case/Cal/publish/LINE/dashboard writes were not executed. Zero FAIL on executed unit + Prod-RO rows does **not** verify production end-to-end.

---

## By Layer

| Layer | PASS | FAIL | BLOCKED | NOT RUN |
|-------|-----:|-----:|--------:|--------:|
| WEB | 7 | 0 | 9 | 0 |
| CAL | 1 | 0 | 12 | 4 |
| API | 9 | 0 | 22 | 6 |
| CASE | 2 | 0 | 13 | 0 |
| NOTION | 0 | 0 | 10 | 0 |
| OCR | 0 | 0 | 4 | 0 |
| MEAS | 12 | 0 | 1 | 0 |
| SCORE | 17 | 0 | 1 | 0 |
| TH | 11 | 0 | 1 | 0 |
| JP | 8 | 0 | 0 | 0 |
| WHO | 2 | 0 | 0 | 0 |
| EU | 2 | 0 | 0 | 0 |
| EPA | 2 | 0 | 0 | 0 |
| QV3 | 4 | 0 | 0 | 0 |
| INV | 12 | 0 | 0 | 0 |
| PUBLISH | 7 | 0 | 3 | 0 |
| REPORT | 2 | 0 | 8 | 0 |
| CARD | 2 | 0 | 9 | 1 |
| LINE | 0 | 0 | 11 | 0 |
| DASHBOARD | 0 | 0 | 11 | 0 |
| FEEDBACK | 1 | 0 | 9 | 0 |
| PROD-RO | 9 | 0 | 3 | 0 |
| E2E | 3 | 0 | 7 | 0 |

---

## Phase 0 — Safety lock

- Production writes: **not performed**.
- Cal webhook POST: **not performed** (prod `hasWebhookSecret: true`; unsigned POST would be unsafe to trial).
- LINE send: **not performed**.
- Dirty `canonical-score/simulate.js` does not sit on the Quality V3 / country Hero path used by unit locks.

---

## Phase 1 — Architecture (read-only)

| Layer | Entry | Source | Persistence / external | Safe env | Matrix IDs |
|-------|--------|--------|------------------------|----------|------------|
| WEB | Framer `https://www.water-motion.co/` | External (not in repo) | Offer GET only | Prod-RO | WEB-* |
| CAL | `POST /api/cal/webhook` | `api/cal-routes.js` → `cal-booking-adapter.js` | Notion Case on `BOOKING_CREATED` | Staging POST; Prod GET status | CAL-* |
| Case create | adapter / `POST /api/cases` | `case-creation-service.js` | Notion `notionId` | Staging | CASE-*, API-001 |
| Notion | mapper | `services/notion/mapper.js` | Protected property names | Prod-RO schema; staging write | NOTION-* |
| OCR | `POST /api/ocr/read-meter` | `ocr-proxy-routes.js` → `assessment.js` `mapOcrDataToMeterReadings` | `rawMeasurement` / `standardMeasurement` / `meterReadings` | Staging | OCR-*, MEAS-* |
| Score | `src/js/flows/score.js` | `computeQualityScoreV2.js` + `benchmark/*/score.js` | Session `S.scoreVal` = Quality; gauge = country | Local-unit | SCORE-*, TH/JP/WHO/EU/EPA, QV3, INV |
| Publish | `POST /api/cases/:id/score` | `score-publication-service.js` | Ledger + Case pointer | Staging; **prod ledger not configured** | PUB-* |
| Report / card | `GET /r/:token`, `/api/report/:token`, `/api/public/score-card/:token` | `case-flow-routes.js`, `public-routes.js` | Published Quality | Prod-RO existing tokens | REPORT-*, CARD-* |
| LINE | `POST /api/cases/:id/send-result` | `workflow-service.js` | Case `notificationStatus` | Staging | LINE-* |
| Feedback | `GET/POST /api/feedback/:token` | `client-feedback.js` | Notion feedback | Staging POST; Prod-RO unknown token | FB-* |

Cancel/reschedule: acknowledged, **not processed** (`CAL-007/008`).

---

## Phase 2 — Unit locks (executed)

All eight matrix lock files: **0 failed**.

| File | Result |
|------|--------|
| `tests/score/case-1328-calibration-baseline.test.js` | 24 passed |
| `tests/score/country-hero-ceiling.test.js` | 36 passed |
| `tests/score/displayed-score-country-switch.test.js` | 91 passed |
| `tests/score/thailand-japan-flow.test.js` | 68 passed |
| `tests/score/quality-v2-calibration.test.js` | 54 passed |
| `tests/score/measurement-validation.test.js` | 57 passed |
| `tests/case-persistence-rehydration.test.js` | 34 passed |
| `tests/publish/publication-idempotency.test.js` | 7 passed |

Additional (same HEAD): architecture-v2 (217), country-benchmark-semantics (106), thailand-severity-protection (28), case-readings-isolation (53), eligibility (40), immutable-publication, publication-recovery (10), thailand-ordinary-band (27), pd008-chlorine-repair (116).

**Observation (not FAIL):** `case-persistence-rehydration.test.js` logged `ReferenceError: OperatorNotificationObserver is not defined` inside `loadJobsFromApi`; assertions still passed.

---

## Phase 3 — Locked fixtures (executed)

| Fixture | Expected (matrix) | Actual | Status |
|---------|-------------------|--------|--------|
| FX-IDEAL | Hero 99 except JP 85 | TH/WHO/EU/EPA 99; JP 85 | PASS |
| FX-NEAR-IDEAL | Q-V3 100 | 100 | PASS |
| FX-BASE | Q-V3 76; TH 79 JP 76 WHO 70 EU 65 EPA 71 | same | PASS |
| FX-DIFF-TH-SAFE | TH 83 JP 75 | 83 / 75 | PASS |
| FX-LOCKED | TH66 WHO60 EU63 JP63 EPA57; legacy 93 | same | PASS |
| FX-1328 | TH95 WHO92 EU94 JP85 EPA94; Q-V3 92 | same; canCalculate **true**, canPublish **false** | PASS |
| FX-TARGET-ID | Identity lock only | notionId `3b59a92d-…bacac`; not mutated | PASS (identity unit) |

Country Hero ≤99; Q-V3 isolated (`S.scoreVal` unchanged on country switch); TH/JP DO `NOT_EVALUATED`; JP `do` omitted from weights; missing Cl on TH → `NOT_MEASURED`, composite **79**; EU Cl gate **65**; null/''/false/[] never become 0.

**No scoring regression** on these locks.

---

## Critical Path (E2E-001 → E2E-010)

| ID | Status | Evidence |
|----|--------|----------|
| E2E-001 Website → Case | **BLOCKED** | No staging Cal webhook POST; production Case create forbidden |
| E2E-002 Measure → Score on Case | **BLOCKED** | Staging Case write forbidden; **engine** path for FX-1328 verified as SCORE-014 |
| E2E-003 Publish → `/r/:token` | **BLOCKED** | Staging publish forbidden; prod ledger `not_configured` |
| E2E-004 Score-card | **BLOCKED** | No staging/published token; unknown token 404 (CARD-002) |
| E2E-005 LINE send-result | **BLOCKED** | Production LINE send forbidden; no staging |
| E2E-006 Create → reload | **BLOCKED** | No staging create; unit rehydration PASS as CASE-003 |
| E2E-007 Switch Case A→B→A | **PASS** | `case-readings-isolation.test.js` — readings/identity do not leak |
| E2E-008 OCR → score | **BLOCKED** | No staging OCR |
| E2E-009 Benchmark switch BASE | **PASS** | displayed-score-country-switch: TH79 JP76 WHO70 EU65 EPA71; Q-V3 76 |
| E2E-010 Japan DO | **PASS** | JP score identical 76 across DO 5.3 / 0 / null / 20 |

---

## Failures

**None** (FAIL = 0). No scoring expected value was changed to force a pass.

### Production finding (not a matrix FAIL row)

`GET /api/ops/health` → `scorePublicationLedger.configured: false`, `code: LEDGER_REQUIRED`.

Impact: production **publish** (`POST /api/cases/:id/score`) is expected to 503 until a publications DB is configured. Health/readiness remain ok/ready. This **blocks** production publish verification. No write was attempted.

---

## Blocked (134) — real reasons

| Reason | Examples |
|--------|----------|
| No staging environment in repo | CAL-009/010, API-001, CASE-001, E2E-001, LINE-*, DASH-* |
| Production write forbidden | PUB-010, Cal POST, LINE send, Notion mutate |
| Existing customer public token not used (PII) | API-019, PROD-005/006/011, REPORT-001 |
| NEED REQUIREMENT | WEB-013/014, MEAS-011, TH-011, LINE-009, REPORT-005 |
| Must not take prod Notion down | WEB-008 |
| Mobile visual | WEB-003 — CDP 390px emulation corrupted Framer layout; contrast not re-checked |

---

## NOT RUN (11)

Local probes not started this session (no local server / no signed local webhook):

`CAL-004`, `CAL-005`, `CAL-006`, `CAL-015`, `API-006`, `API-025`, `API-026`, `API-027`, `API-033`, `API-037`, `CARD-012`

CARD-012 remains a documented helper risk (`cardOptionsFromJob` → 0 if unguarded); the **route** 404s unknown tokens.

---

## Regression

**No scoring/publish unit-lock regression** on HEAD `c0eac4e8` (same SHA as production).

Do not treat BLOCKED E2E as a score-engine regression.

---

## Invariants (from executed evidence)

| Invariant | Result |
|-----------|--------|
| Country Hero 0–99 (never 100) | Held (IDEAL → 99; JP 85) |
| Quality V3 isolated from country switch | Held (`S.scoreVal` / `quality-v3.0`) |
| Country weights applied (TH ≠ JP on DIFF) | Held (83 vs 75) |
| Thailand DO excluded | Held (`NOT_EVALUATED`; weights omit `do`) |
| Japan DO excluded | Held (identical composite; `do` key removed) |
| missing ≠ 0 | Held (validator + missing Cl 79 / NOT_MEASURED) |
| Severity ceilings (85/75/60) | Held (JP IDEAL 85; orp=199 → 75; Cl=0 → 60) |
| Case identity stable (unit) | Held (rehydration + isolation) |
| Publish channel = Quality V3 | Held in unit; **not** proven on live `/r/:token` |
| Null score never becomes 0 on public card route | Unknown-token 404; live null-score Case not exercised |
| No Case-specific scoring patch | Held (no Case-id branch in engines) |

---

## Prod-RO snapshot (safe)

- Offer: `{totalSlots:100, used:11, remaining:89}`; Framer banner **89 spots left** (after load; first paint showed Loading).
- CORS: `Origin: https://www.water-motion.co` → ACAO echo; `example.com` → no ACAO.
- Homepage 200; CTA `Book Free Water Check`; nav href `./#cta`; other CTAs `https://cal.com/watermotion/60min`.
- Unknown report/card/feedback tokens → **404** (not 401, not score 0).
- Unauth `POST /api/cases` / `GET /api/clients` → **401**.
- `POST /api/test/create-case` → **404**.
- Cal status: `createsCases: true` for `BOOKING_CREATED` only.

---

## Next to clear the gate

1. Provide a **staging** base URL + staff session (or dedicated staging Notion).
2. Run CAL-009/010, E2E-001/002/003/004/006 (staging Case only).
3. Configure production score-publication ledger **or** document why health reports `LEDGER_REQUIRED`.
4. Re-check WEB-003 on a real phone (do not trust CDP device metrics against Framer).
5. Optionally run the 11 local NOT RUN IDs against `node server.js` locally — still no production writes.

Until staging E2E and ledger/publish-on-token are evidenced, the gate stays **PRODUCTION NOT VERIFIED — BLOCKED**.
