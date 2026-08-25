# 18 — Critical Coverage Gap Forensic QA

**Mode:** QA / forensic only — **no code changes**  
**Date:** 2026-08-21  
**Production SHA:** `a92935f0c92668cf5563f30140826fc9e5751a7d` (Expected == Actual)  
**Health:** ok · Ledger configured (`RUNTIME_OK`) · LINE configured · Notion configured  
**Verdict:** **PRODUCTION QA PASS — EVIDENCE LIMITED**  
**First violated invariant:** **NONE PROVEN**

---

## 1. Production Identity

| Field | Value |
| --- | --- |
| Expected SHA | `a92935f0c92668cf5563f30140826fc9e5751a7d` |
| Actual SHA | `a92935f0c92668cf5563f30140826fc9e5751a7d` — match |
| Health | ok |
| Ledger | configured:true, status:configured, code:RUNTIME_OK |
| LINE | configured |
| Notion | configured |

---

## 2. Critical Coverage Results

| Area | Status | Evidence |
| --- | --- | --- |
| Publication duplicate-close | **PASS** | Real suite `tests/publish/*.test.js` (6 files) + 1 temp test for ledger-unavailable fail-closed |
| Cal duplicate webhook | **PASS** (malformed/signature/extraction); **EVIDENCE LIMITED** (duplicate-Case-suppression integration) | New temp adapter tests 12/12; durable path is `withCaseLock` + `findClientByCalBookingId` (code-read); placeholder dedupe is logging-only |
| Case switching | **PASS** | New temp vm test loading real `job-state.js`, 14/14 |

### Detail — Publication duplicate-close

Fresh run of existing suite:

| File | Result |
| --- | --- |
| compliance-persistence.test.js | 13 passed, 0 failed |
| immutable-publication.test.js | PASS |
| publication-close-path.test.js | PASS |
| publication-idempotency.test.js | 7 passed, 0 failed |
| publication-recovery.test.js | 10 passed, 0 failed |
| publication-store-contract.test.js | PASS |

Mission Cases A/B/C/E covered by suite. Case D (ledger unavailable → fail closed) had no prior coverage — memory-store pattern cannot test it (`ledgerAvailable()` hardcodes true for `store.kind==='memory'`). Temporary real test unset `NOTION_SCORE_PUBLICATIONS_DATABASE_ID` and called real `createOrReusePublication()`:

```text
THREW AS EXPECTED: statusCode 503, code LEDGER_REQUIRED
PASS: fail-closed, no fake publication, no pointer mutation
Throw site: services/score-publication-service.js:204-209 (before store/Notion)
```

### Detail — Cal.com duplicate webhook

No existing automated tests for `cal-webhook.js` / `cal-booking-adapter.js` / `cal-dedupe-placeholder.js`.  
`cal-dedupe-placeholder.js` is **process-local, non-durable**, used only for a logging field — **not** a gate on `processBookingCreated()`.

Real duplicate suppression: `cal-booking-adapter.js` → `withCaseLock('cal-booking:${calBookingId}')` + `findClientByCalBookingId()` before `createCase()`.

Temp tests (pre-Notion rejection + signature), **12 passed, 0 failed**:

- missing uid / name / start-end → 400 before Notion
- extract uid, attendee name, Line-ID, nested `location.optionValue`
- valid / invalid / empty / unconfigured Cal HMAC → fail-closed
- same booking uid → same dedupe key despite wrapper fields

**Not proven without production data or DI:** 2nd identical delivery → existing Case found → no 2nd `createCase()`. Classified **EVIDENCE LIMITED**.

### Detail — Case switching / cross-Case leakage

Prior blind spot. Temp vm test, real `src/js/job-state.js`, two synthetic in-memory Cases (no production touch), **14/14**:

- A/B drafts isolate taps, meterReadings, scoreBaseReadings
- `currentScoreResult` reset on switch
- A→B→A and repeated switches restore own state, no cross-contamination

Scenario C (cold reload via `restoreActiveCaseFromPersistence`) **NOT RE-TESTED THIS PASS** (code-read only).

---

## 3. Idempotency Matrix

| Path | First call | Duplicate | Partial failure | Proof | Status |
| --- | --- | --- | --- | --- | --- |
| Case creation (manual) | Code trace | Not exercised | Not exercised | Code trace | EVIDENCE LIMITED |
| Cal webhook → Case | Code trace: lock+find | Not executable without mock/data | Not exercised | Code + shared primitive | EVIDENCE LIMITED |
| Publication (close/publish) | Real: 1 row | Real: replay, no 2nd | Real: pointer-sync recovery | Real suite + Case D temp | **PASS** |
| LINE webhook (dedup) | claimEvent Map | Code trace this pass | N/A | Code trace | NOT RE-TESTED |
| LINE notification (sendCaseResult) | already_sent/sending | Real (lifecycle) | N/A | Real | **PASS** |
| OCR retry | Serial queue | Not exercised | N/A | Code trace | NOT RE-TESTED |

---

## 4. State Leakage Matrix

| State var | Owner | Reset on switch | Reload | Cross-Case proof |
| --- | --- | --- | --- | --- |
| taps | Case draft | overwritten from draft | hydrate via restore | Proven this pass |
| tapData | Case draft | fastDeepClone | same | Proven |
| scoreBaseReadings | Case draft | reset to own/null | same | Proven |
| currentScoreResult | Volatile | null on loadJobState | recompute | Proven |
| activeTap | Case draft | from draft | same | Proven (implicit) |
| meterReadings | Nested tapData | via tapData clone | same | Proven |
| notionId | Notion identity | N/A | SoT for findJob | Code trace |
| Publication pointer | Ledger + token | immutable | idempotent reuse | Proven (real) |
| LINE identity | Case-owned | N/A | withCaseLock | Code trace |

---

## 5. Test Integrity

| Class | Items |
| --- | --- |
| REAL BEHAVIORAL | `tests/publish/*.test.js`; LINE/signature/security/conversion/PR2-3/score-lineage/care/customer/journey/notif/ocr-client scripts; **+ 3 new temp scripts** this pass |
| SOURCE INSPECTION ONLY | `scripts/test-ocr-ux-wording.js` (6 checks, zero runtime) |
| WEAK ASSERTION | `scripts/test-feedback-token-fallback.js` |
| STALE TEST | `scripts/test-benchmark-engines.js` (2/12; pre-recalibration) |
| BROKEN HARNESS | `scripts/test-payment-screen.js` (missing linkedom) |
| UNTESTED PATH (new/disclosed) | Cal duplicate-found branch; cold-reload `restoreActiveCaseFromPersistence`; LINE `claimEvent` not re-run; OCR queue retry |

---

## 6. Production Journey

| Stage | Status |
| --- | --- |
| Customer → Case | EVIDENCE LIMITED |
| Case → Assessment | PASS (zero diff) |
| Assessment → OCR | PASS (historical PaddleOCR; zero diff) |
| OCR → meterReadings | PASS (65/65) |
| meterReadings → Score | PASS (65/65 + 21/21) |
| Score → Eligibility | PASS |
| Completion → Ledger | **PASS** (suite + Case D temp) |
| Ledger → LINE | PASS (code trace) |
| LINE → Notification | PASS (6/6 + signature) |
| Persistence → Reopen | PASS in-session switch; EVIDENCE LIMITED cold-reload |

---

## 7. Security

No regression from prior pass. Auth fail-closed (real HTTP). LINE fail-closed (real signature).  
**New this pass:** Cal.com signature verification executed (valid/invalid/empty/unconfigured).

---

## 8. External Services

No new live mutating calls beyond baseline health/readiness/ledger check. SHA/health/ledger stable.

---

## 9. First Violated Invariant

**NONE PROVEN**

---

## 10. Evidence Limitations

**PROVEN PASS:** publication idempotency A–E; Case-switch isolation 14/14; Cal input+signature 12/12; score lineage / LINE lifecycle / auth / conversion (carried forward).

**NOT TESTED (honest gaps):** Cal duplicate-found → no 2nd createCase; cold-reload restore path; LINE claimEvent re-run; OCR retry-after-failure queue.

**BLOCKED:** Authenticated production OCR/TDS/Turbidity/browser E2E (credentials).

**EVIDENCE LIMITED:** Turbidity generalization (1 real source photo).

---

## 11. Code Changes

**NONE**

---

## 12. Final Verdict

```text
PRODUCTION QA PASS — EVIDENCE LIMITED
```

Closed two of three named blind spots with real execution (publication duplicate-close including ledger-unavailable; Case-switch isolation).  
Cal.com duplicate webhook is better characterized (validation + signature proven); the actual duplicate-Case-suppression integration remains a **disclosed gap**, not an assumed pass.
