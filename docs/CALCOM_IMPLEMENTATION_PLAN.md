# Cal.com Booking Integration — Implementation Plan

**Document type:** Implementation Plan (planning artifact only)
**Mode:** Implementation Planning Only — **no code, no patch, no file edits outside this document, no endpoint, no deploy, no flags enabled**
**Date:** 2026-08-05
**Author role:** Senior Backend Architect + Technical Lead
**Input DDR (locked):** [`docs/CALCOM_BOOKING_INTEGRATION_DESIGN_DECISION_RECORD.md`](./CALCOM_BOOKING_INTEGRATION_DESIGN_DECISION_RECORD.md) — Status: **CLOSED / READY FOR IMPLEMENTATION**
**Also grounded in:** [`docs/CALCOM_INTEGRATION_ARCHITECTURE_READINESS.md`](./CALCOM_INTEGRATION_ARCHITECTURE_READINESS.md), [`docs/CALCOM_CASE_BRIDGE_ARCHITECTURE_REVIEW.md`](./CALCOM_CASE_BRIDGE_ARCHITECTURE_REVIEW.md), [`docs/verification/01_AS_BUILT_ARCHITECTURE.md`](./verification/01_AS_BUILT_ARCHITECTURE.md), [`docs/verification/04_QA_MATRIX.md`](./verification/04_QA_MATRIX.md)

**This document does not authorize implementation.** It defines *how* implementation would proceed once a human approves it. No file in this repository other than this one was created or modified to produce this plan.

---

## 1. Implementation Scope

### ทำ (in scope)

- Cal.com webhook adapter: new route + signature verification, modeled on the existing `api/line-routes.js` pattern
- Payload validation and mapping: Cal payload → `createCase()` / `cancelAppointment()` inputs
- Durable dedupe (design + storage concept only — see §6): survives process restart, covers Cal's retry horizon
- Lifecycle handling for `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`
- Persisting `calBookingId` as a correlation key on the Case (new Notion property + mapper alias)
- Structured logging via existing `services/observability.js` (`logEvent`/correlation id pattern, same as M5)
- QA-CAL-01…10 execution plan (test design, not automated test code)

### ไม่ทำ (explicitly out of scope)

- Rewriting `case-creation-service.js`, `workflow-service.js`, or `water-check-offer-service.js` internals — the adapter **calls** these, it does not modify them
- Rewriting M3 Offer math or M5 idempotency/retry/notification-recovery mechanisms
- Any Customer Domain change or flag flip (`CUSTOMER_DOMAIN_*` stay OFF)
- Any Care Lifecycle change or flag flip (`CARE_LIFECYCLE_*` / `CARE_SEND` stay OFF)
- Cal.com UI/embed changes on the Framer site
- Historical backfill of existing Cal-only bookings (DDR §9 — explicitly deferred)
- Enabling `notificationStatus` transitions or Care SEND from the booking webhook (forbidden by DDR §6 ownership matrix)
- Any production deploy or Cal.com dashboard webhook subscription activation

---

## 2. Proposed Architecture

```
Cal.com
  |
  |  POST (signed webhook: BOOKING_CREATED / _CANCELLED / _RESCHEDULED)
  v
api/cal-routes.js  (new — thin HTTP layer, mirrors api/line-routes.js)
  |  1. verify signature (fail closed)
  |  2. parse + shape-validate payload
  |  3. durable dedupe check (calBookingId + eventType, or webhook delivery id)
  v
services/cal-booking-adapter.js  (new — translator, not a domain)
  |  map Cal payload -> { customerPayload, options }
  v
existing Case Domain APIs (UNCHANGED)
  |  createCase()            <- BOOKING_CREATED
  |  cancelAppointment()     <- BOOKING_CANCELLED
  |  updateClient() appointment fields  <- BOOKING_RESCHEDULED
  v
Case = Ops SSOT
  |
  +--> Offer (water-check-offer-service, M3 — unchanged math)
  +--> Workflow (workflow-service — unchanged)
  +--> Notification (line-notifications — NOT invoked by this adapter)
  +--> Report (url-builder / tokens — unchanged)
  +-.-> Care (read-only, later, unaffected by this adapter)
```

**Boundary statement:** `api/cal-routes.js` and `services/cal-booking-adapter.js` together form the **Adapter layer**. The adapter has exactly three responsibilities — verify, dedupe, map — and exactly one write capability: calling the three existing Case Domain entry points already used by every other caller (`POST /api/cases`, `POST /api/cases/:id/cancel`, and an appointment-field update path equivalent to what `submitCustomerPreassessment` already does). It does not gain a Notion client of its own, does not compute offer counts, and does not touch `notificationStatus` — consistent with the DDR's ownership matrix (§6) and the as-built domain boundaries in `docs/verification/01_AS_BUILT_ARCHITECTURE.md`.

---

## 3. File Impact Analysis

| File | Action | Reason |
|---|---|---|
| `api/cal-routes.js` | **Add** | New HTTP entry point for Cal.com webhooks (signature verify, dedupe gate, route dispatch) — mirrors `api/line-routes.js` structure |
| `services/cal-booking-adapter.js` | **Add** | Payload mapping (Cal → `createCase`/`cancelAppointment`/reschedule input); owns no state |
| `services/cal-dedupe-store.js` | **Add** | Durable dedupe interface (see §6) — concept module; storage backend chosen at implementation time |
| `server.js` | **Modify** | Register `handleCalRoute` alongside existing route handlers (same pattern as `handleLineRoute`, `handleCaseFlowRoute`) |
| `services/notion/mapper.js` | **Modify** | Add `calBookingId` to `FIELD_ALIASES` once the Notion property exists (read/write mapping only — no logic change) |
| `services/case-creation-service.js` | **No Change** | `createCase()`/`cancelAppointment()` contracts stay exactly as M5 left them; adapter is a new caller, not a new behavior |
| `services/workflow-service.js` | **No Change** | Not touched — booking webhooks never reach workflow/notification state per DDR §6 |
| `services/water-check-offer-service.js` | **No Change** | Offer continues counting Cases via existing `campaignOffer` logic; adapter only ever calls `createCase({ launchOffer })`, same as any other caller |
| `services/idempotency-store.js` (M5) | **No Change** | Remains the short-TTL protection for direct `POST /api/cases` callers; Cal path adds its **own** durable layer alongside it, does not replace it |
| `services/observability.js` | **No Change** (reused) | `newCorrelationId`/`logEvent` reused as-is for adapter logging |
| `services/retry.js` | **No Change** (reused) | If the adapter needs outbound retry (none currently identified — it only calls in-process functions), reuse as-is |
| `config/env.js` | **Modify** | Add `CAL_WEBHOOK_SECRET` (or equivalent) to the same simple `process.env.*` pattern already used for `LINE_CHANNEL_SECRET` — no new config framework |
| `scripts/sync-notion-case-flow-schema.js` | **Modify** | Add `calBookingId` (or agreed property name) to the schema sync definition, same pattern as existing properties |
| `docs/verification/04_QA_MATRIX.md` | **Modify** | Append QA-CAL-01…10 rows (blank Actual/Pass-Fail, per existing convention) |
| `docs/verification/01_AS_BUILT_ARCHITECTURE.md` | **Modify** (post-implementation) | Add Cal Adapter to Diagram 1/System diagram once built — documentation only, not a design change |
| `docs/PROJECT_STATE.md` | **Modify** (post-implementation) | Update milestone row once implemented — documentation only |
| `tests/` | **Add** (new directory — none exists today) | Adapter unit tests (mapping, dedupe, signature) — repo currently has no `tests/` directory; this would be the first, scoped narrowly to the adapter |
| `database/` | **N/A** | No relational database in this repo; "database" impact is entirely the Notion schema change captured under `scripts/sync-notion-case-flow-schema.js` and the dedupe store (§6) |
| `api/line-routes.js` | **No Change** (reference only) | Used as the structural precedent for signature verification + dedup + background-task pattern; not modified |
| `api/case-flow-routes.js` | **No Change** | `POST /api/cases` contract stays exactly as-is; Cal adapter is a parallel intake, not a modification of this route |

---

## 4. Event Contract Design

### BOOKING_CREATED

| | |
|---|---|
| **Source** | Cal.com webhook, event type `BOOKING_CREATED` (exact trigger name to be confirmed against live Cal.com webhook config — DDR §7.4 non-blocking confirmation item) |
| **Required fields** | Attendee name, attendee email, start time, end time, Cal booking uid, Cal event type id/slug, webhook signature header |
| **Consumer** | `services/cal-booking-adapter.js` → `createCase()` (existing entry point, unchanged) |
| **Expected result** | Exactly one new Case; `calBookingId` persisted; system defaults applied (`notificationStatus=not_sent`, tokens, `caseWorkflowStatus=scheduled`); Offer `used` count increments only if the Cal event type maps to the launch campaign |

### BOOKING_CANCELLED

| | |
|---|---|
| **Source** | Cal.com webhook, event type `BOOKING_CANCELLED` |
| **Required fields** | Cal booking uid (to resolve the Case), webhook signature header |
| **Consumer** | `services/cal-booking-adapter.js` → resolve Case by `calBookingId` → `cancelAppointment(caseId)` (existing entry point, unchanged) |
| **Expected result** | Case marked cancelled (existing M3 cancel + offer-cache-invalidate behavior fires unchanged); guard: if Case is already `in_progress` or `closed`, adapter does **not** auto-cancel — surfaces for ops per DDR §5 lifecycle guard |

### BOOKING_RESCHEDULED

| | |
|---|---|
| **Source** | Cal.com webhook, event type `BOOKING_RESCHEDULED` |
| **Required fields** | Cal booking uid (stable across reschedule — to be verified against real payload per DDR §5), new start/end time |
| **Consumer** | `services/cal-booking-adapter.js` → resolve Case by `calBookingId` → update `appointmentDate`/`appointmentStart`/`appointmentEnd` on the **same** Case (no new `createCase()` call) |
| **Expected result** | Same Case id; new appointment times; **zero** new Cases; Offer count unaffected (Case was already active) |

No code is defined for any of the above in this document — only the contract each event must satisfy.

---

## 5. Data Mapping Plan

| Cal Field (expected path — to confirm) | Case Field | Required? | Validation |
|---|---|---|---|
| Booking `uid` | `calBookingId` (new property, see §3) | **Required** | Non-empty string; used as primary correlation key — exact match only, no fuzzy fallback (forbidden by DDR §3) |
| Webhook `triggerEvent` / delivery id | *(not persisted on Case)* — used only by dedupe store | **Required** | Used as secondary dedupe key (§6) |
| `payload.attendees[0].name` (typical Cal shape) | `fullName` | **Required** | Existing `validateCustomerInput()` already enforces non-empty — reused unchanged |
| `payload.attendees[0].email` | `email` | Recommended | Existing `CUSTOMER_INPUT_FIELDS` accepts as-is |
| Custom question or `attendees[0].phoneNumber` | `phone` | Recommended | Location in payload **must be confirmed** against a real sample — Cal often puts phone in a custom-question array, not a fixed field |
| Custom question (if configured) | `lineId` | Optional | Only if Cal form has a LINE-ID question configured — confirm before implementation |
| `payload.startTime` | `appointmentDate` + `appointmentStart` | **Required** | Confirm timezone: Cal typically sends UTC ISO 8601; Case fields are date/time-label pairs (see `services/notion/mapper.js` `scheduleFromDate`/`formatTimeLabel`) — conversion must not silently shift the calendar day |
| `payload.endTime` | `appointmentEnd` | Required | Same timezone caveat |
| `payload.eventType.id` / `.slug` | Drives `options.launchOffer` (boolean) passed to `createCase()` | **Required for Offer correctness** | Exact mapping table (which Cal event type = Free Water Check) is a **product confirmation**, not an architecture decision — DDR §7 |
| — | `options.campaignOffer` (string, alternative to `launchOffer`) | Optional | Only if a non-default campaign name is needed; must match an existing campaign string already known to `water-check-offer-service.js` — no new campaign vocabulary invented here |
| `payload.location` / custom question | `address` | Optional | Confirm whether Cal collects this for the `60min` event type |
| — | `source` | Recommended | Set to a literal marker (e.g. `"cal.com"`) for audit, following the existing `source` field already in `CUSTOMER_INPUT_FIELDS` |
| — (system-generated, unchanged) | `feedbackToken`, `publicReportToken`, `reportUrl`, `feedbackUrl`, `caseWorkflowStatus`, `notificationStatus`, etc. | N/A | Produced entirely by `buildSystemDefaults()` inside the existing `createCase()` — the adapter supplies **none** of these |

**Explicit non-mapping (forbidden by DDR §6 ownership matrix):** Cal booking/appointment status must **not** be mapped 1:1 to `caseWorkflowStatus`; Cal never sets `notificationStatus`; Cal never writes `lineUserId` (that is LINE-link-flow-owned only).

---

## 6. Durable Dedup Design

### Why the M5 30-second in-memory TTL is not sufficient

M5's `services/idempotency-store.js` was designed for one scenario: a browser double-click or refresh resubmitting the *same* `POST /api/cases` request within seconds, on the *same* running process. Cal.com webhook delivery is a different failure class entirely:

| Dimension | M5 (`idempotency-store.js`) | Cal.com webhook reality |
|---|---|---|
| Retry window | Seconds (30s TTL) | Cal.com retries webhook delivery over **minutes to hours** on failure |
| Process lifetime assumption | Same process instance | Render can restart the process between the original delivery and a retry — **in-memory state is gone** |
| Duplicate trigger | Client-side double-submit | Server-side redelivery, out-of-order delivery, or an ops-triggered manual resend from the Cal.com dashboard |
| Consequence of a miss | One extra Case from a rare UI double-click | **Every** retried webhook (a routine, expected occurrence in webhook systems) becomes a duplicate Case + double Offer-slot burn |

The DDR (§4) and readiness review (§7.2 item 3) both lock this as a **requirement**, not a suggestion: Cal-path dedup must survive a process restart.

### Dedup key

- **Primary:** `calBookingId + eventType` for `BOOKING_CREATED` (one Case per booking, ever)
- **Secondary:** raw webhook delivery/event id, for exact-replay detection of *any* event type (covers the case where Cal redelivers the identical webhook body)
- Cancel/reschedule dedupe by `calBookingId + eventType` as well — a redelivered cancel should be a no-op against an already-cancelled Case (already partially true via `cancelAppointment()`'s existing idempotency guard, per M3/M5), but the webhook-level dedupe still prevents redundant work and redundant logging

### Storage concept (no implementation choice made here)

The record needed per dedupe key is small: `{ key, calBookingId, eventType, caseId, processedAt }`. This needs to be:
- Readable/writable from the Node process handling the webhook
- Durable across a process restart
- Retained for at least the Cal retry horizon (an ops-defined window — DDR leaves this ops-defined, but it must be **meaningfully longer** than a single request lifecycle, e.g. hours-to-days, not seconds)

This document intentionally does **not** select a specific store (Notion property, a lightweight file, a KV store, etc.) — that is an implementation-time decision constrained only by "must survive restart," consistent with the instruction not to choose a database implementation here. One option already visible in this codebase's own conventions: the Case's own `calBookingId` property *is itself* a durable dedup surface for `BOOKING_CREATED` — a lookup by `calBookingId` before create (similar in spirit to `findClientByFeedbackToken`/`findClientByReportToken` in `services/notion/clients.js`) would satisfy durability without a new store, at the cost of one extra Notion read per webhook. Whether that lookup-based approach or a dedicated dedupe store is preferred is an implementation-time tradeoff, not an architecture decision.

### Replay behavior (locked by DDR §4, restated here for implementation)

| Replay of | Expected behavior |
|---|---|
| `BOOKING_CREATED` after prior success | Return the prior outcome; **zero** new Cases created |
| `BOOKING_CANCELLED` after prior success | Idempotent cancelled state; **zero** additional Case mutations beyond what's already true |
| `BOOKING_RESCHEDULED` after prior success | Same Case, same (or latest) times; **zero** new Cases |

### Retry-vs-reject behavior (locked by DDR §8, restated here)

| Failure class | Response to Cal.com |
|---|---|
| Transient (Case/Notion write failure) | Non-success response → Cal retries → dedupe on the eventual successful attempt still yields exactly one Case |
| Permanent (validation failure, invalid signature) | Non-retryable rejection → Cal should not keep retrying a payload that will never succeed |

---

## 7. Lifecycle Rules

| Event | Case State | Allowed? | Action |
|---|---|---|---|
| CREATE | *(no Case yet)* | ✅ | `createCase()` — new Case, `scheduled` |
| CREATE | *(duplicate `calBookingId` already has a Case)* | ✅ (idempotent) | No-op; return existing Case reference |
| CANCEL | `scheduled` | ✅ | `cancelAppointment()` — normal path |
| CANCEL | `in_progress` | ⚠️ **Guarded** | Do **not** auto-cancel (DDR §5 lifecycle guard) — surface to ops (reject webhook processing with an alert-worthy log, or accept-and-flag; exact UX is an implementation-time ops decision, not an architecture decision) |
| CANCEL | `closed` | ⚠️ **Guarded** | Same as `in_progress` — no silent force-cancel of a completed case |
| CANCEL | `cancelled` (already) | ✅ (idempotent) | No-op — matches existing `cancelAppointment()` idempotency (M3) |
| CANCEL | *(unknown `calBookingId`, no matching Case)* | ❌ | Do not invent a Case from a cancel event; log + alert (DDR §8, failure #7) |
| RESCHEDULE | `scheduled` | ✅ | Update appointment fields on same Case |
| RESCHEDULE | `in_progress` | ⚠️ **Ops policy needed** | DDR does not explicitly guard this state for reschedule (only cancel) — flagged as an open confirmation item for implementation time, defaulting to "update fields, do not block," pending ops sign-off |
| RESCHEDULE | `closed` / `cancelled` | ❌ | Reject or log-and-ignore — rescheduling a closed/cancelled Case has no valid ops meaning; exact rejection semantics are an implementation-time detail within the locked "no silent Case reinvention" principle |
| RESCHEDULE | *(unknown `calBookingId`)* | ❌ | Same as CANCEL — no Case invented from a reschedule alone |

---

## 8. Security Plan

| Area | Plan |
|---|---|
| **Webhook verification** | Verify Cal.com's signature on the **raw** request body before parsing/trusting JSON, mirroring the exact precedent in `api/line-routes.js` (`verifyLineSignature`/`lineSignatureDebug` pattern: HMAC over raw bytes, timing-safe comparison). Exact algorithm/header name (`x-cal-signature-256` or current Cal.com documented scheme) must be confirmed from Cal.com's current webhook docs at implementation time — not guessed. |
| **Secret management** | New env var (e.g. `CAL_WEBHOOK_SECRET`), read via `process.env.*` exactly like `LINE_CHANNEL_SECRET` today (`services/line-notifications.js` `getLineChannelSecret()`/`normalizeLineChannelSecret()` pattern — quote-stripping included, since that already solved a real prior issue for the LINE secret). Never logged, never present in any Framer/client-side code. |
| **Replay protection** | Signature validity alone is not sufficient (a captured valid signed payload could be replayed) — combine with durable dedupe (§6) as the actual replay defense, consistent with the readiness review's explicit note that "signature alone ≠ enough if body is replayed within skew." |
| **Payload validation** | Reject (4xx) on missing required fields (name at minimum, mirroring `validateCustomerInput()`'s existing rule) before ever calling `createCase()` — no partial-Case writes. |
| **Logging** | Reuse `services/observability.js` (`newCorrelationId`, `logEvent`) exactly as M5 established for booking/cancel events — structured, additive, no PII beyond what already appears in existing `booking_created`/`booking_cancelled` log lines. Do not log the raw webhook secret or full raw payload bodies (mirrors the "minimal PII in logs" requirement in the readiness review §6). |
| **Endpoint exposure** | Public HTTPS route, no session/cookie auth — signature **is** the auth, same trust model as `/api/line/webhook` today. Body-size cap consistent with existing `readJson`/`readRawBody` patterns (1MB ceiling already used elsewhere in this codebase). |
| **Privilege boundary** | The adapter may only reach `createCase`, `cancelAppointment`, and an appointment-field update — nothing else. It must not gain access to Care SEND, Customer merge, or any admin-only route. |

---

## 9. Failure Handling Plan

| Scenario | Expected | Recovery | Owner |
|---|---|---|---|
| Cal.com webhook delivery timeout (Portal too slow to respond) | Cal.com times out and retries later | Durable dedupe (§6) ensures the eventual successful attempt is the only one that counts | Adapter (dedupe) + Case write path |
| Duplicate webhook (same event redelivered) | Zero new Cases/mutations; 2xx (or dedupe-equivalent) response | Dedupe hit on `calBookingId+eventType` or delivery id | Adapter dedupe store |
| Notion unavailable during CREATE | Non-success response (5xx-equivalent); **no** false "booked" acknowledgment | Cal retries; M5's existing `withRetry` (already wraps `createClient`/`updateClient` in `services/notion/clients.js`) absorbs transient Notion 429/5xx first; only a hard failure surfaces to the adapter, which then declines to ack | Case/Notion write path (existing M5 retry layer, unmodified) |
| Invalid payload (missing required field) | 4xx; no Case created | None needed — this is a terminal rejection, not a retry case; ops fixes the Cal form/question mapping | Adapter validation |
| Invalid signature | 401/403; zero Case mutation | None needed if attacker; if legitimate (rotated secret), ops fixes `CAL_WEBHOOK_SECRET` and Cal.com's dashboard config to match | Security/Adapter |
| Out-of-order event (e.g. CANCEL arrives before CREATE is processed) | Prefer timestamp + state guards: if no Case exists yet for a CANCEL, do not invent one — log + alert; if a RESCHEDULE arrives for a Case that a later-processed CANCEL will affect, never let a stale CREATE un-cancel an already-cancelled Case | Ops review of alerted orphan events; no automatic reconciliation invented here (DDR §8, failure #3) | Adapter + Case (state-guarded) |

---

## 10. QA Mapping

| Test Case | Requirement (DDR / Readiness source) | Expected Result |
|---|---|---|
| **CAL-01** Booking Created | DDR §2, §5 | One Case created; tokens present; `notificationStatus=not_sent`; visible via `GET /api/clients` |
| **CAL-02** Duplicate Event | DDR §4 | Zero second Case; Offer `used` unchanged |
| **CAL-03** Cancel | DDR §5b | Case cancelled; Offer `remaining` increases if it was a launch Case; Dashboard hides cancelled Case (existing behavior, unchanged) |
| **CAL-04** Reschedule | DDR §5b | Same Case id; new appointment times; Offer unchanged |
| **CAL-05** Invalid Signature | DDR §8 (rule 6) | Rejected; zero Case mutation |
| **CAL-06** Payload Missing Required Field | DDR §8 (rule 5) | Create rejected; no partial Case |
| **CAL-07** Notion Failure on Create | DDR §8 (rule 4) | Non-success response; Cal retries; exactly one Case after recovery (via dedupe) |
| **CAL-08** Replay Across Process Restart | DDR §4 | Same outcome as CAL-02, specifically verified **after** a process restart between the original delivery and the replay — this is the test that actually proves the durable dedupe requirement (§6) is met, not just the in-memory case |
| **CAL-09** Offer Attribution | DDR §7 | Free Water Check Cal event type → `launchOffer:true` → Offer `used` decrements `remaining`; a non-launch event type does not |
| **CAL-10** Rollback | DDR §8 verdict, §11 (this doc) | Cal intake disabled (webhook subscription off and/or adapter route disabled) → zero new Cases from Cal; all previously-created Cases remain intact and unaffected |

**Required regression set alongside CAL-01…10** (per DDR §10 and readiness review §7): `QA-B01–B04` (booking) and `QA-O01–O03` (offer) from `docs/verification/04_QA_MATRIX.md` — proving the Cal adapter does not regress the existing Manual/API booking path or the M3 offer counter math.

---

## 11. Rollback Plan

### If the Cal integration has a problem after go-live

**The existing system must keep working exactly as it does today, independent of Cal integration health**, because the adapter is additive:

1. **Disable intake, not the Case system.** Turn off the Cal.com webhook subscription (Cal.com dashboard) and/or gate `api/cal-routes.js` behind a route-level off-switch. `POST /api/cases`, the Manual Create dashboard flow, and every other existing intake path are untouched and continue working — they never depended on the Cal adapter existing.
2. **No mass Case deletion.** Any Cases already created from Cal bookings before the rollback remain valid Cases — they are indistinguishable from any other Case once created (Case is the SSOT; the adapter's job was already done for those rows). Rolling back does not retroactively invalidate them.
3. **Offer counts remain Case-derived.** `water-check-offer-service.js` (M3, untouched by this work) keeps counting whatever Cases exist at rollback time — no special-casing needed, no Offer logic to revert.
4. **No Customer/Care flag rollback needed.** This integration never touches those flags — they stay exactly at their current OFF state regardless of Cal adapter status, per the DDR's explicit non-goals.
5. **What ops needs to do:** disable the webhook at the Cal.com dashboard (stops new deliveries at the source) **and** confirm the adapter route returns a clear non-2xx or is unregistered (stops accidental processing if a stale webhook still arrives) — a two-sided rollback, not reliant on Cal.com's cooperation alone.

### What is *not* part of rollback

- No data migration to undo — nothing was migrated, only newly-created Cases exist
- No dedupe store to purge — leaving stale dedupe records behind after a rollback is harmless (they just prevent redundant processing if intake is later re-enabled with the same historical events replayed, which is the safe default)

---

## 12. Implementation Sequence

### Phase 0 — Prepare (no code)

- Capture real Cal.com webhook payload samples for `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED` (redacted) — required to freeze §5's field paths and confirm whether `calBookingId` survives reschedule
- Confirm signature scheme/header name from current Cal.com docs
- Product confirms: which Cal event type(s) → `launchOffer:true`
- Ops confirms: cancel-after-`in_progress`/`closed` guard behavior (reject vs. flag-and-no-op), and the reschedule-during-`in_progress` open question from §7
- Add `calBookingId` Notion property (schema change, via existing `scripts/sync-notion-case-flow-schema.js` pattern) and its `FIELD_ALIASES` entry — this alone is safe to do early since an unused property has zero runtime effect

### Phase 1 — Adapter (CREATE only)

- Build `api/cal-routes.js` + `services/cal-booking-adapter.js` for `BOOKING_CREATED` only
- Signature verification wired and tested against CAL-05
- Payload mapping wired and tested against CAL-01, CAL-06
- Staging webhook subscription only — no production Cal.com webhook enabled yet

### Phase 2 — Durable Dedup

- Implement the dedupe mechanism chosen at this stage (§6 leaves the storage choice open)
- CAL-02 and CAL-08 (the restart-survival test) must both pass before proceeding
- This phase gates Phase 3 — lifecycle handling is unsafe to add on top of non-durable dedupe

### Phase 3 — Lifecycle (Cancel + Reschedule)

- Add `BOOKING_CANCELLED` handling with the `in_progress`/`closed` guard (CAL-03)
- Add `BOOKING_RESCHEDULED` handling as same-Case update (CAL-04)
- Resolve the open reschedule-during-`in_progress` question from §7 before this phase closes

### Phase 4 — QA

- Execute CAL-01…10 in full (per §10)
- Execute required regression set: QA-B01–B04, QA-O01–O03
- Only after QA sign-off does production Cal.com webhook subscription activation become an organizational decision (not an architecture one) — matching the DDR's own framing that sign-off, not this document, authorizes go-live

---

## Final Verdict

### Implementation plan complete: **Yes**, at the design-document level requested by this task. All 12 sections are filled with decisions traceable to the locked DDR, the readiness review, and the as-built architecture docs — no section was left as a placeholder.

### Remaining unknowns (must be resolved with real data, not more design work)

1. Exact Cal.com webhook payload shape (field paths for name/email/phone/address, timezone format) — **cannot be finalized without a real sample**
2. Exact signature header name/algorithm from Cal.com's current webhook documentation
3. Whether `calBookingId` is stable across a Cal.com-native reschedule (assumed yes per DDR §5, must be verified against a real reschedule payload)
4. Which Cal.com event type id(s) correspond to the Free Water Check / Launch Offer campaign
5. Ops decision on exact cancel-guard and reschedule-during-`in_progress` UX (reject vs. flag-and-no-op) — DDR locks the *principle* (no silent force-cancel/force-reschedule), not the exact response code/message
6. Storage choice for the durable dedupe store (§6 deliberately leaves this open)

### Required inputs before coding begins

| Input | Source | Blocking? |
|---|---|---|
| Real webhook payload samples (create/cancel/reschedule) | Cal.com dashboard test-send or a staging booking | **Yes** — mapping in §5 cannot be frozen without this |
| Staging Cal.com webhook + secret | Cal.com account admin | **Yes** — needed for Phase 1 |
| Product sign-off on event-type → Offer mapping | Product | **Yes** — needed for §9's CAL-09 to be meaningful |
| Ops sign-off on cancel/reschedule guard UX | Ops | Blocking for Phase 3 only, not Phase 1 |
| Notion schema change approval for `calBookingId` property | Whoever owns the Notion workspace schema | **Yes** — needed even for Phase 0 |
| Human sign-off per the DDR's sign-off block | Architecture / Product / Ops / Eng Lead | **Yes** — DDR itself states "implementation scheduling is an organizational choice" pending these signatures |

**No code, webhook, migration, or production flow was created by this document.**
