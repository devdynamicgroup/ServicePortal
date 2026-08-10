# CAL-G01 — Runtime Payload Audit

**Mode:** Runtime payload audit only — no code, no redesign, no implementation  
**Date:** 2026-08-05  
**Scope:** Exact webhook JSON Water Motion receives from Cal.com for Free Water Check booking  

---

## Executive verdict

| Question | Result |
|----------|--------|
| Was a real WM Cal webhook payload observed this audit? | **No** |
| Complete webhook JSON captured? | **No** |
| Can field paths be frozen? | **No** |
| **CAL-G01 Payload Specification** | **NOT FROZEN** — **FAIL** |

**Reason:** No Water Motion account webhook delivery body exists in repo, logs, handoff inbox, Downloads, or agent transcripts. Cal.com event-type Webhooks UI has **no configured webhooks** (only **New**), so Cal has nowhere to deliver / no delivery history to inspect. Production Portal has **no** Cal receive endpoint that could have archived a body. Public Cal.com documentation samples were found in agent-tools cache and are **explicitly excluded** (not WM account runtime).

---

## Task results

### 1. Verify actual booking payload from WM Cal event
**FAIL / NOT VERIFIED** — No runtime webhook body from Water Motion’s Cal account was available to verify.

### 2. Capture complete webhook JSON
**FAIL** — Nothing to capture.

| Source checked | Result |
|----------------|--------|
| `docs/samples/` | Does not exist |
| Repo `*.json` with `triggerEvent` / `BOOKING_CREATED` | **NONE** |
| `docs/CALCOM_IMPLEMENTATION_HANDOFF.md` inbox | Placeholder only — empty |
| Portal logs / payload dumps | No `logs/` dir; Phase 0 does not persist bodies |
| Downloads (`*cal*` / `*webhook*` / JSON with triggerEvent) | **NONE** |
| Agent transcripts | Mentions / synthetic stubs only — **no** full WM delivery JSON |
| Cal.com UI `event-types/6040165` → Webhooks | No webhooks listed; cannot open delivery / Test Event for a configured endpoint |
| Prod `POST/GET /api/cal/webhook*` | Not a JSON Cal API on production (SPA HTML) — cannot have received deliveries |

### 3. Identify every field
**NOT VERIFIED** — Requires an observed JSON object. No field list can be enumerated from runtime.

*(Cal Booking form tab was opened; accessibility snapshot did not expose form field labels in this session — form field inventory also **NOT VERIFIED** from UI. Even if form labels were listed, that would **not** prove webhook JSON paths.)*

### 4. Which fields map directly to `createCase()`
**NOT VERIFIED** — No observed Cal paths to map.

**Reference only (Portal side — not Cal observation):**

`createCase` customer input keys (`CUSTOMER_INPUT_FIELDS`):  
`fullName`, `address`, `phone`, `email`, `lineId`, `waterConcerns`, `propertyType`, `propertyAge`, `source`, `currentFilter`, `packageHistory`, `consentSigned`, `appointmentDate`, `appointmentStart`, `appointmentEnd`, `campaignOffer`

Hard validation (`validateCustomerInput`): **`fullName` required**.

Correlation / adapter (architecture, not observed in payload): **`calBookingId`** (Case property; not in `CUSTOMER_INPUT_FIELDS` today).

Options (not payload fields): `skipMap`, `launchOffer`, `campaignOffer`, `correlationId`.

### 5. Required fields missing
**Cannot determine missing-from-payload** without an observed body.

| Required for Cal → `createCase` (architecture / Portal rules) | Observed in WM webhook? | Status |
|---------------------------------------------------------------|-------------------------|--------|
| Booking id → `calBookingId` | Never observed | **NOT VERIFIED** |
| Trigger / event type (`BOOKING_CREATED`) | Never observed | **NOT VERIFIED** |
| Delivery / event id (dedupe secondary) | Never observed | **NOT VERIFIED** |
| Name → `fullName` | Never observed | **NOT VERIFIED** |
| Email → `email` | Never observed | **NOT VERIFIED** |
| Phone → `phone` | Never observed | **NOT VERIFIED** |
| Appointment start → `appointmentStart` / date | Never observed | **NOT VERIFIED** |
| Appointment end → `appointmentEnd` | Never observed | **NOT VERIFIED** |
| Event type id/slug → Offer map | Never observed | **NOT VERIFIED** |
| Address / other optional customer fields | Never observed | **NOT VERIFIED** |

### 6. Freeze payload specification
**FAIL** — Specification **must not** be frozen without observation. Guessing or copying Cal public docs samples is forbidden.

---

## Required-field scorecard (runtime observation)

| Field (semantic) | Portal target | Observed Cal JSON path | PASS / FAIL / NOT VERIFIED |
|------------------|---------------|------------------------|----------------------------|
| Booking identifier | `calBookingId` | — | **NOT VERIFIED** |
| Webhook trigger | (routing) | — | **NOT VERIFIED** |
| Delivery / event id | (dedupe only) | — | **NOT VERIFIED** |
| Full name | `fullName` (**required** by `validateCustomerInput`) | — | **NOT VERIFIED** |
| Email | `email` | — | **NOT VERIFIED** |
| Phone | `phone` | — | **NOT VERIFIED** |
| Appointment start | `appointmentStart` (+ date) | — | **NOT VERIFIED** |
| Appointment end | `appointmentEnd` | — | **NOT VERIFIED** |
| Event type | `launchOffer` / `campaignOffer` options | — | **NOT VERIFIED** |
| Source marker | `source` (e.g. literal after map) | — | **NOT VERIFIED** |
| Address | `address` | — | **NOT VERIFIED** |
| Signature header presence on real delivery | `x-cal-signature-256` (code expects; delivery not seen) | — | **NOT VERIFIED** |

**No row is PASS.**  
**No row is FAIL for “field absent from payload”** — absence was not observed; observation itself failed.

---

## CAL-G01 Payload Specification

### Status: **NOT FROZEN**

```text
STATUS: FAIL — cannot publish immutable mapping contract

complete_webhook_json: NOT CAPTURED
observed_trigger_events: NONE
observed_field_paths: NONE
excluded_sources:
  - Cal.com public documentation samples
  - Phase 0 synthetic test stubs
  - Speculative paths in services/cal-webhook.js summarizeCalEnvelope()
```

### Immutable contract body

*(Intentionally empty — freezing empty or guessed paths would violate the evidence rule.)*

| Cal JSON path | Example (redacted) | → Portal / createCase | Required | Status |
|---------------|--------------------|------------------------|----------|--------|
| — | — | — | — | **NOT VERIFIED** |

### Signature / envelope (code expectation — **not** runtime-verified on WM delivery)

| Item | Code / design note | WM runtime |
|------|--------------------|------------|
| Header `x-cal-signature-256` | Phase 0 `services/cal-webhook.js` | **NOT VERIFIED** on a real WM delivery |
| HMAC-SHA256 hex over raw body | Same | **NOT VERIFIED** |

### What would unblock freeze

1. Configure a Cal webhook that can deliver (or Test Event) **or** paste a redacted real delivery JSON into the handoff inbox / `docs/samples/`.  
2. Re-run this audit against that body.  
3. Only then fill paths and mark PASS/FAIL per field.  
4. Publish frozen table as the immutable CAL-G01 contract.

---

## Explicit non-sources (do not use to freeze)

- Cal.com docs “Pro Example” / placeholder payloads in agent-tools scrapes  
- Synthetic `{ triggerEvent: 'BOOKING_CREATED', payload: { uid, … } }` from Phase 0 tests  
- Speculative `payload.uid` / `bookingUid` reads in `summarizeCalEnvelope` (comment: paths unconfirmed until CAL-G01)

---

## Final

| Gate | Verdict |
|------|---------|
| **CAL-G01** | **FAIL** — Payload Specification **not** established |
| Complete JSON capture | **FAIL** |
| Field inventory | **NOT VERIFIED** |
| createCase mapping | **NOT VERIFIED** |
| Immutable mapping contract | **NOT READY** |

No code. No redesign. No implementation.
