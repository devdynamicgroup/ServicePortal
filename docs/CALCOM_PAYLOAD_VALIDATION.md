# Cal.com Payload Validation Review

**Document type:** CAL-G01 payload validation (pre–PR-1)  
**Mode:** Validation only — **no code, no patch, no deploy, no new architecture**  
**Date:** 2026-08-05  

**Inputs claimed:** “Cal.com webhook payload จริงที่แนบมา” (re-check 2026-08-05 11:46)  
**Inputs actually available to this review:**

| Source | Result |
|--------|--------|
| Chat attachment / embedded JSON (11:35 + 11:46 turns) | **Not present** — transcript `message.content` is **text-only**; no file path, no JSON blob |
| [`CALCOM_IMPLEMENTATION_HANDOFF.md`](./CALCOM_IMPLEMENTATION_HANDOFF.md) §2 inbox | Still empty placeholders |
| Repo / Downloads / Desktop / project uploads | **No** Water Motion webhook JSON with `triggerEvent` (re-searched) |
| Cal.com public docs samples (agent-tools cache) | **Excluded** — not WM account payload; must not close CAL-G01 |

**References:** [`CALCOM_PHASE1_IMPLEMENTATION_REVIEW.md`](./CALCOM_PHASE1_IMPLEMENTATION_REVIEW.md), [`CALCOM_PHASE1_DESIGN_REVIEW.md`](./CALCOM_PHASE1_DESIGN_REVIEW.md)

---

## 1. Payload Mapping Review

| Cal Path | Example | Target Field | Required | Transform |
|----------|---------|--------------|----------|-----------|
| *(not observed)* | — | `calBookingId` | Required | — |
| *(not observed)* | — | dedupe delivery id | Required (processing) | — |
| *(not observed)* | — | `fullName` | Required | — |
| *(not observed)* | — | `email` | Optional | — |
| *(not observed)* | — | `phone` | Optional | — |
| *(not observed)* | — | appointment start/end | Required | timezone TBD |
| *(not observed)* | — | event type → Offer map | Required (Offer-safe) | lookup |
| *(not observed)* | — | cancel lookup key | Required (PR-4) | exact match |
| *(not observed)* | — | reschedule lookup key | Required (PR-4) | exact match |

**Checked semantics (booking id, attendee, email, phone, time, event type, cancel/reschedule refs):**  
**Cannot validate** — no WM payload body to read paths from.

---

## 2. Event Verification

| Event | มีจริงใน sample ที่แนบ? | Payload ต่างกันอย่างไร | Lifecycle map (design, not sample-proven) |
|-------|-------------------------|-------------------------|-------------------------------------------|
| `BOOKING_CREATED` | **Not observed** | — | Design: → `createCase()` → `scheduled` (PR-3+) |
| `BOOKING_CANCELLED` | **Not observed** | — | Design: → `cancelAppointment` + guards (PR-4) |
| `BOOKING_RESCHEDULED` | **Not observed** | — | Design: → same-Case appointment update (PR-4) |

Trigger **names** are known from Cal product docs and Phase 0 code comments; **account-specific payloads** for all three events were **not** supplied in this turn.

---

## 3. Security Verification

| Check | Status | Evidence |
|-------|--------|----------|
| Signature header | **Confirmed in code/docs** | `x-cal-signature-256` (`services/cal-webhook.js` `SIGNATURE_HEADER`) |
| Verification requirement | **Required when secret set** | HMAC-SHA256 hex over **raw body**; reject 401 on mismatch |
| Secret usage | Env `CAL_WEBHOOK_SECRET` only; never log/commit secret | Phase 0 pattern; **no secret value shown or inspected here** |
| Sample-delivered signature headers | **Not observed** | No attached HTTP request to inspect |

---

## 4. Update Blocker Status

| ID | Status | Notes |
|----|--------|-------|
| **CAL-G01** | **Remaining** | Cannot close — WM payload not received by the agent |
| **CAL-G02** | **Closed** (decision) / **Remaining** (Notion property execution) | Unchanged — identity decision already locked; schema create still ops |
| **CAL-G03** | **Remaining** (concrete type→Offer values) | Unchanged — rules locked; Product map values still pending |

---

## 5. PR-1 Gate

## **BLOCKED**

**Reason:** Claimed attachment was **not delivered** to this session (no file path, no JSON in message, nothing in handoff inbox). CAL-G01 field paths remain unfrozen. Closing CAL-G01 or declaring READY would require guessing or using public Cal docs samples — both forbidden.

**Unblock:** Re-attach or paste a **redacted** `BOOKING_CREATED` webhook JSON (minimum) into chat **or** save under the repo (e.g. `docs/samples/cal-booking-created.redacted.json`) and point this review at that path. Then re-run Payload Validation.

**PR-1 scope reminder (unchanged):** IN = receive / signature verify / config · OUT = `createCase` / Notion write / Offer update.

---

**No code change. No architecture change. No secret disclosed.**
