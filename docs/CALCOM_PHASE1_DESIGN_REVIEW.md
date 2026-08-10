# Cal.com Booking Integration — Phase 1 Design Review

**Document type:** Architecture + Implementation Planning Review
**Mode:** Design only — **no code, no patch, no deploy, no production flag**
**Date:** 2026-08-05
**Reviewer role:** Principal Engineer + Architecture Reviewer
**Builds on:** [`CALCOM_PHASE0_VERIFICATION_REPORT.md`](./CALCOM_PHASE0_VERIFICATION_REPORT.md) (Phase 0: A — PASS), [`CALCOM_IMPLEMENTATION_GATE.md`](./CALCOM_IMPLEMENTATION_GATE.md) (Gate B), [`CALCOM_BLOCKER_RESOLUTION.md`](./CALCOM_BLOCKER_RESOLUTION.md) (G01–G05), [`CALCOM_IMPLEMENTATION_PLAN.md`](./CALCOM_IMPLEMENTATION_PLAN.md), [`CALCOM_DESIGN_CLOSURE_REVIEW.md`](./CALCOM_DESIGN_CLOSURE_REVIEW.md), `docs/verification/01–07`
**Live code re-verified for this document:** `api/cal-routes.js`, `services/cal-webhook.js`, `services/cal-dedupe-placeholder.js`, `services/case-creation-service.js`, `services/booking-validation.js`, `services/notion/mapper.js`, `services/notion/clients.js`, `services/idempotency-store.js`, `services/retry.js`, `services/water-check-offer-service.js`, `services/migration/dual-write.js`, `services/workflow-service.js` (`withCaseLock`), `services/case-tokens.js` (`generateUniqueToken`)

**Purpose:** design (not implement) the exact path from Cal.com webhook to a Notion Case, close CAL-G01/G02/G04 with concrete-enough decisions to unblock coding, and produce a Phase 1 QA plan — while re-confirming, against current source, that nothing about this path requires touching Case/Offer/Notification/Customer/Care ownership.

---

## 1. Current Boundary

| Layer | Owner | Cal ทำอะไรได้ | Cal ห้ามทำ |
|---|---|---|---|
| **Intake (webhook receipt)** | **Cal.com adapter** (`api/cal-routes.js`, `services/cal-webhook.js` — Phase 0, live) | Receive, verify signature, summarize envelope, log, placeholder-dedupe | Nothing here reaches any domain — verified structurally in Phase 0 report §5/§6 |
| **Dedupe / correlation** | **Adapter** (Phase 1: durable, see §5) | Decide "have I already processed this `calBookingId`+event" | Cannot decide Case content or state — dedupe answers "process or replay," never "what workflow state should this be" |
| **Mapping** | **Adapter** (Phase 1: new, `services/cal-booking-adapter.js` per prior Plan) | Translate Cal payload → `createCase()`/`cancelAppointment()` input shape | Cannot write Notion directly; cannot bypass `validateCustomerInput()`; cannot invent a `caseWorkflowStatus` value outside what `createCase()` already sets internally |
| **Case creation** | **Case Domain** (`services/case-creation-service.js` — unmodified) | N/A (Cal is a caller, not this layer) | This layer is Cal's only entry point into persistence — it owns the Notion write, the token generation, the offer-cache invalidation, the dual-write hook |
| **Case = Ops SSOT** | **Case** (Notion `Clients` DB, mapped via `notion/mapper.js`) | N/A | Cal never becomes a second source of the Case row; after `createCase()` returns, the Case is indistinguishable from a Manual/API-created Case |
| **Offer** | **`water-check-offer-service.js`** (M3, unmodified) | Cal's `launchOffer`/`campaignOffer` choice, passed as `createCase()` options, is the **only** lever Cal has — it never writes `used`/`remaining` itself | Cannot count directly, cannot invent a campaign name not already known to the offer service |
| **Workflow** | **`workflow-service.js`** (unmodified) | N/A — Cal never calls this layer in Phase 1 (CREATE only); cancel/reschedule in later phases still route through `cancelAppointment()`/an appointment-field update, never workflow's state-transition functions | Cannot set `caseWorkflowStatus` beyond what `createCase()`'s own `buildSystemDefaults()` sets (`scheduled`) |
| **Notification** | **`workflow-service.js` + `line-notifications.js`** (unmodified) | N/A | Cal never reaches `notificationStatus`; confirmed no import path exists from any Cal file |
| **Customer** | **`services/customer-domain/*` + `services/migration/dual-write.js`** (unmodified) | N/A — Cal inherits whatever `dualWriteAfterCaseSuccess()` already does inside `createCase()` for every caller, flag-gated OFF today | Cannot enable flags, cannot bypass the existing dual-write no-op behavior |
| **Care** | **`services/care-lifecycle/*`** (unmodified) | N/A | Structurally unreachable — not required by any file in the Cal path |

**Verdict §1:** re-confirmed against live source (not just re-stated from prior documents): Cal.com is Intake Channel only; Case is Ops SSOT after ingest; Notification/Care/Workflow ownership is unmoved. No new finding here beyond what `CALCOM_DESIGN_CLOSURE_REVIEW.md` §1 and `CALCOM_IMPLEMENTATION_GATE.md` already locked — this table exists to make the boundary explicit per-layer for Phase 1 implementers, not to reopen it.

---

## 2. Phase 1 Flow Design

```
Cal.com
  │  POST, raw body + X-Cal-Signature-256 header
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Webhook Route (api/cal-routes.js — EXISTS, Phase 0)          │
│    Input:  raw HTTP request                                     │
│    Output: parsed JSON payload, or 400/413 on malformed/oversize │
│    Failure: body>1MB → destroy+reject; malformed JSON → 400      │
│    Retry:  none needed here — Cal retries the whole delivery     │
└───────────────────────────┬───────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Signature Verification (services/cal-webhook.js — EXISTS)     │
│    Input:  raw body, X-Cal-Signature-256 header                  │
│    Output: pass → continue; fail → 401, zero mutation             │
│    Failure: reject closed (proven in Phase 0 report §4)          │
│    Retry:  none — a bad signature should not be retried blindly; │
│            Cal will keep retrying on 401 per its own policy,     │
│            which is correct (secret misconfig needs a human fix, │
│            not a code-level backoff)                              │
└───────────────────────────┬───────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Event Normalization (services/cal-webhook.js's                │
│    summarizeCalEnvelope() — EXISTS but Phase 0 shape only;        │
│    Phase 1 needs the REAL field-path version, gated by §3 below) │
│    Input:  parsed payload                                        │
│    Output: { triggerEvent, calBookingId, deliveryId,              │
│              customer:{name,email,phone}, appointment:{...},      │
│              eventType }  — normalized, not yet validated         │
│    Failure: missing required field → reject before dedupe/create  │
│    Retry:  N/A — a structurally invalid payload is a permanent    │
│            rejection, not transient                               │
└───────────────────────────┬───────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Durable Dedupe (NEW — Phase 1, see §5 design)                 │
│    Input:  calBookingId + triggerEvent (+ delivery id)            │
│    Output: "new" → continue to mapping/create;                    │
│            "already processed" → return prior outcome, no create  │
│    Failure: dedupe-check itself fails (e.g., Notion lookup        │
│             errors) → fail closed, non-success response so Cal    │
│             retries rather than risk creating on an unverifiable  │
│             dedupe state                                          │
│    Retry:  the dedupe check inherits M5's `withRetry` if its      │
│            backing lookup is a Notion query (see §5 option B)     │
└───────────────────────────┬───────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Payload Mapper (NEW — Phase 1, services/cal-booking-adapter.js)│
│    Input:  normalized event (step 3)                              │
│    Output: { customerPayload: {fullName,phone,email,address,      │
│              appointmentDate,appointmentStart,appointmentEnd,     │
│              source:'cal.com'}, options:{launchOffer|campaignOffer,│
│              skipMap:true, correlationId} }                       │
│    Failure: missing fullName → reject (mirrors                    │
│             validateCustomerInput's existing rule — no new rule)  │
│    Retry:  N/A — mapping is pure/deterministic, no I/O            │
└───────────────────────────┬───────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. createCase() (services/case-creation-service.js — UNMODIFIED)  │
│    Input:  customerPayload, options (exactly as any other caller) │
│    Output: { ok, case, tokens, systemDefaults }                   │
│    Failure: validateCustomerInput throws 400 → adapter surfaces   │
│             4xx to Cal, no retry; createClient Notion failure →   │
│             already retried internally by M5's withRetry (§6      │
│             below), then propagates as a hard failure             │
│    Retry:  M5's withRetry (services/notion/clients.js) already    │
│            absorbs transient Notion 429/5xx — unmodified, free    │
└───────────────────────────┬───────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Notion Cases (services/notion/clients.js createClient —       │
│    UNMODIFIED)                                                    │
│    Output: new Case row; calBookingId persisted (once schema      │
│            exists per §4); notificationStatus='not_sent';         │
│            caseWorkflowStatus='scheduled'                         │
└───────────────────────────┬───────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. Existing Workflow (dormant until start/close — UNCHANGED)      │
│    Offer cache invalidated automatically if campaignOffer set     │
│    (existing createCase() behavior, M3/M5, unmodified)            │
│    Dual-write hook fires automatically, no-op while flags OFF     │
│    (existing createCase() behavior, unmodified)                   │
└─────────────────────────────────────────────────────────────────┘
                             ▼
              Adapter acks Cal.com only after this
              entire chain durably succeeds (§5's ack rule)
```

**Every "UNMODIFIED"/"EXISTS" label above was re-verified against live source for this document** — not assumed from prior documents. Steps 4 and 5 are the only new code Phase 1 requires; steps 1–3 already exist from Phase 0 (step 3 needs its Phase 1-real-field-path upgrade per §3); steps 6–8 are 100% reused, unmodified.

---

## 3. Closing CAL-G01 — Payload Field Checklist

Per the evidence rule already established in `CALCOM_BLOCKER_RESOLUTION.md`: **no field path is guessed here.** This section locks *which semantic fields are required* and *where they land on the Case*; it does not invent a JSON path Cal.com hasn't been confirmed to send. Every row's "Cal JSON path" column is marked `UNKNOWN — confirm from sample` unless already directly observed in this codebase's own `services/cal-webhook.js` Phase 0 envelope reader (which itself only reads `payload.uid`/`payload.bookingUid` speculatively, per its own comment: *"Paths may be absent until CAL-G01 payload pack is confirmed"*).

| Field | Cal JSON path | Case destination | Required / Optional / Ignored |
|---|---|---|---|
| Booking identifier (`calBookingId`) | `UNKNOWN — confirm from sample` (Phase 0 code speculatively checks `payload.uid` / `payload.bookingUid` / `root.uid` / `root.bookingId`) | New Case property `calBookingId` (§4) | **Required** |
| Webhook delivery/event id | `UNKNOWN — confirm from sample` | Dedupe store only, never a Case field | **Required** (for dedupe, not for Case content) |
| Attendee identity (name) | `UNKNOWN — confirm from sample` (commonly `payload.attendees[0].name` in Cal's documented shape, but **not verified against a real payload in this repo**) | `fullName` | **Required** — `validateCustomerInput()` already rejects a missing value; no new rule needed |
| Email | `UNKNOWN — confirm from sample` | `email` | **Optional** (Case accepts empty; recommended for customer contact) |
| Phone | `UNKNOWN — confirm from sample`, commonly a custom question in Cal rather than a fixed field | `phone` | **Optional** — do not block create solely on phone (already the Plan's locked rule) |
| Start time | `UNKNOWN — confirm from sample` | `appointmentDate` + `appointmentStart` | **Required** |
| End time | `UNKNOWN — confirm from sample` | `appointmentEnd` | **Required** |
| Timezone representation | `UNKNOWN — confirm from sample` | Interpretation only — must not shift the calendar day when converted (per `notion/mapper.js`'s own `isoDateOnly`/`weekdayIndex` UTC-based logic) | **Required** to interpret correctly, not a Case field itself |
| Event type id/slug | `UNKNOWN — confirm from sample` | Input to CAL-G03 mapping → `options.launchOffer`/`campaignOffer` | **Required** for Offer-safe create |
| LINE handle (if a custom question) | `UNKNOWN — confirm from sample`, only if Cal form collects it | `lineId` (never `lineUserId`) | **Optional** |
| Address/location | `UNKNOWN — confirm from sample` | `address` | **Optional** |
| Cancellation reference | `UNKNOWN — confirm from sample` — must resolve back to the same booking identifier used at create | Used only to look up the Case by `calBookingId` for `cancelAppointment()` | **Required** for the cancel path (Phase 2, not Phase 1) |
| Reschedule reference | `UNKNOWN — confirm from sample` — specifically whether `calBookingId` is preserved across a reschedule | Used to look up the Case by `calBookingId` for an appointment-field update | **Required** for the reschedule path (Phase 2, not Phase 1); **this is the single most consequential unknown for Phase 2**, since if it's *not* preserved, reschedule cannot be distinguished from a new booking without a separate correlation strategy |
| Any other Cal field not listed above | N/A | N/A | **Ignored** — the mapper must not read/forward fields outside this checklist; an unlisted field arriving in a payload is not an error, it is simply not mapped |

### CAL-G01 status after this document

**Still not fully closed** — this review adds structure (the Required/Optional/Ignored split, and explicit "must not shift calendar day" framing for timezone) but **cannot supply the actual JSON paths** without a real Cal.com payload sample, consistent with the evidence rule already set in `CALCOM_BLOCKER_RESOLUTION.md`. This remains the top blocking item for Phase 1 coding.

---

## 4. Closing CAL-G02 — `calBookingId` Schema Decision

### What the Case must hold

| Field | Purpose | Decision |
|---|---|---|
| `calBookingId` | Primary Cal↔Case correlation | New Case property; string; not currently in `FIELD_ALIASES` (re-confirmed live: grep of `services/notion/mapper.js` shows no `calBookingId` key today) |
| `calEventId` / delivery id | Secondary, processing-only dedupe key | **Not** a Case property — lives only in the durable dedupe mechanism (§5), never persisted on the Notion Case row, consistent with `CALCOM_BLOCKER_RESOLUTION.md`'s CAL-G02 closure ("Case correlation" vs. "processing dedupe" are different roles, different lifetimes) |
| `source = 'cal.com'` | Audit marker distinguishing Cal-origin Cases from Manual/API | **Already supported today, zero schema change** — `source` is already in `CUSTOMER_INPUT_FIELDS` (`services/case-creation-service.js`), already an accepted `createCase()` input; the adapter simply passes `source: 'cal.com'` like any other caller could pass any other source string |

### Answering the four required questions

| Question | Answer |
|---|---|
| **Immutable หรือไม่?** | **Yes.** Written once at create; no function in `case-creation-service.js` or `workflow-service.js` is proposed to ever update it post-create. This matches `CALCOM_BLOCKER_RESOLUTION.md`'s CAL-G02 decision exactly. |
| **Unique constraint อยู่ตรงไหน?** | **Not enforced by Notion itself** — Notion has no native unique-constraint mechanism on a property (verified against this codebase's own existing precedent: `case-tokens.js`'s `generateUniqueToken()` exists specifically *because* Notion cannot guarantee uniqueness at write time — it does a pre-write existence check plus retry-on-collision instead of relying on a database constraint). The uniqueness of `calBookingId` must therefore be enforced at the **application layer**, via the durable dedupe mechanism in §5 — this is not a gap unique to Cal, it is the same shape of problem this codebase already solves for `feedbackToken`/`publicReportToken`. |
| **Migration impact?** | **None to existing data.** This is a net-new, optional property — no existing Case row needs a value, no existing read path (`notion/mapper.js`'s `notionPageToJob()`) breaks by an unpopulated new field (verified: `getPropertyValue()` already returns a fallback for absent/empty properties on any existing alias, and adding a new alias entry doesn't touch any existing one). |
| **Notion property impact?** | **One new property + one new `FIELD_ALIASES` entry.** Same pattern as every other property in this file (e.g., `feedbackToken: ['Feedback Token', 'feedbackToken']`). No existing property is renamed, retyped, or removed. `scripts/sync-notion-case-flow-schema.js` needs one additive entry, same pattern as its existing rows. |

### CAL-G02 status after this document

**Confirmed closed as a decision** (matches `CALCOM_BLOCKER_RESOLUTION.md`'s own verdict). The only remaining step is **execution** — actually creating the Notion property and adding the mapper alias — which is a Phase 0/1 checklist item, not an open architecture question.

---

## 5. Closing CAL-G04 — Durable Dedupe Design

### Why in-memory is disqualified (re-confirmed against both existing stores)

| Store | TTL/durability | Verdict for Cal |
|---|---|---|
| `services/idempotency-store.js` (M5) | 30s, in-process `Map` | Disqualified — built for browser double-click bursts, explicitly not reused for this purpose per every prior Cal document |
| `services/cal-dedupe-placeholder.js` (Phase 0) | 1h, in-process `Map`, **explicitly self-labeled non-durable** | Disqualified for Phase 1 by its own doc comment: *"must NOT be treated as production-ready idempotency for createCase()"* |

Neither survives a process restart. Render's deployment profile (already established as a real operational characteristic in this project's own M3/M5 history) makes restart-loss a realistic, not theoretical, failure mode.

### Option comparison

| Option | Description | Fit with existing architecture | Concurrent-delivery safety | New infrastructure required |
|---|---|---|---|---|
| **A — Webhook event table** | A dedicated store (e.g., a new Notion database, or a Notion property list) recording every processed delivery id | Consistent in *shape* with `client-feedback.js`'s separate-database pattern already used in this codebase, but adds a **second Notion database** purely for plumbing — heavier than needed for a single boolean fact ("have I seen this delivery") | No better than B on its own — Notion still has no atomic insert-if-absent; the race exists identically | New Notion database + schema + sync script entry |
| **B — Case `calBookingId` unique lookup** | Before create, query existing Cases for a matching `calBookingId` (same shape as `findClientByFeedbackToken`/`findClientByReportToken` in `services/notion/clients.js`); if found, return that Case instead of creating | **Most consistent with existing precedent** — reuses the exact lookup-before-write idiom this codebase already established for token collision-avoidance (`case-tokens.js`) | **Alone, has the same check-then-act race** as any lookup-then-write approach — two concurrent requests can both find nothing and both create | None — reuses the existing Notion Cases DB and existing query patterns |
| **C — Generic idempotency storage (new KV/SQL/Redis-style store)** | A dedicated, purpose-built durable idempotency backend | **Inconsistent with this project's established constraints** — M5's own design work explicitly rejected introducing Redis/SQL/external stores for a structurally identical problem (the M3 offer-capacity race), on the grounds that it added infrastructure the project doesn't otherwise need | Would be genuinely atomic if implemented with the right primitive (e.g., a real unique-constraint database) | **New infrastructure** — directly against prior architectural precedent in this repo |

### Recommended design (per existing architecture, not a new pattern)

**Combine B with the existing per-key serialization idiom already proven in this codebase — `workflow-service.js`'s `withCaseLock()`.**

- **Durability across restarts:** Option B — a `calBookingId` lookup against the real Notion Cases DB before calling `createCase()`. This is durable by construction: the "already processed" fact **is** the Case row itself, not a separate ledger that could drift out of sync. This directly answers "retry after server restart" (§ scenario table below) without any new store.
- **Atomicity under concurrent delivery (same process):** reuse `withCaseLock(calBookingId, ...)` — the exact same lock primitive `workflow-service.js` already uses to serialize `startCase`/`closeCase`/`sendCaseResult` per Case. Two concurrent webhook deliveries for the same `calBookingId` would serialize through the same lock key, so the second one's lookup runs *after* the first's create has completed — closing the check-then-act race within a single process, using a pattern this codebase already trusts for an analogous problem.
- **What this does *not* solve:** if the Portal ever runs as more than one process/instance simultaneously, `withCaseLock`'s in-memory lock would not coordinate across instances — this is the **same explicitly-accepted limitation** M3's offer cache and M5's `withCaseLock` already carry today, re-confirmed as acceptable under the current single-instance Render deployment, and already documented as a "revisit if this ever runs as more than one process" caveat elsewhere in this codebase. Not a new risk Phase 1 introduces — an existing, already-accepted one it inherits.
- **Secondary key (delivery id):** still recorded (in whatever store houses the dedupe check — could be as simple as a field on the eventual webhook-event record, or reuse of Option B's `calBookingId` correlation for `CANCELLED`/`RESCHEDULED` kinds) purely to short-circuit *exact* redelivery of the identical HTTP payload without even reaching the lock, as a cheap first-pass filter — not a substitute for the `calBookingId` lock+lookup, which remains the actual correctness guarantee.

### Scenario walkthrough

| Scenario | Behavior under recommended design |
|---|---|
| **Duplicate webhook delivered concurrently** (two simultaneous requests, same `calBookingId`) | Both acquire `withCaseLock(calBookingId)` sequentially (lock serializes); first one's `calBookingId` lookup finds nothing, creates the Case; second one's lookup (running after the first releases the lock) finds the Case the first one just created, returns it instead of creating a second one |
| **Retry after server restart** (process died between original delivery and Cal's retry) | `withCaseLock`'s in-memory lock is gone (harmless — nothing was "stuck" mid-lock across a hard process death), and the `calBookingId` lookup against Notion is unaffected by the restart, since it reads real persisted data — the retry finds the already-created Case exactly as if no restart had happened |
| **Network timeout** (Cal.com times out waiting for the Portal's response, though the Portal's `createCase()` actually completed) | Same as "retry after restart," structurally — Cal redelivers, the lookup finds the already-created Case, no duplicate. This is precisely the scenario the Pre-Implementation Review flagged as needing "check-before-create" ordering, which this design satisfies by construction (lookup always precedes create, under the lock) |

### CAL-G04 status after this document

**Closed as a concrete, architecture-consistent design** — a specific recommendation (B + `withCaseLock`), not just a requirements list. Still requires implementation-time confirmation that the *actual* Cal.com retry horizon (an unknown, per §7 of `CALCOM_DESIGN_CLOSURE_REVIEW.md`) doesn't demand something beyond what a live Notion lookup already provides indefinitely (it does not have this limitation — a Notion lookup is durable for as long as the Case exists, i.e., effectively forever, which exceeds any plausible Cal retry horizon).

---

## 6. `createCase()` Integration Check — Regression Confirmation

When the Cal adapter calls `createCase()`, tracing through the **unmodified, live** function:

| Concern | What happens | Regression? |
|---|---|---|
| **Validation** | `validateCustomerInput(customer)` runs exactly as it does for every other caller — rejects if `fullName` is empty, same 400/`statusCode` shape | **No** — same function, same rule, Cal is just another caller |
| **Idempotency (M5)** | If the Cal adapter's `createCase()` call goes through the same `POST /api/cases`-style route wrapping (or a structurally similar call site), M5's `withIdempotency` in `api/case-flow-routes.js` would apply — but the **Phase 1 design here calls `createCase()` directly from the adapter**, not through the HTTP route, so M5's route-level idempotency does not automatically apply to the Cal path. This is expected and consistent with every prior document's framing: Cal needs its **own** durable dedupe (§5), which happens *before* `createCase()` is ever reached, making M5's shorter-lived protection redundant-but-harmless for this path rather than relied-upon | **No regression** — M5's own protection is untouched for its original callers (direct `POST /api/cases`); Cal's dedupe is additive, at an earlier stage |
| **Offer counting (M3)** | `resolveCampaignOffer()` + `invalidateOfferCache()` run exactly as today, driven only by whatever `options.launchOffer`/`options.campaignOffer` the adapter passes | **No** — same mechanism, correctness depends on CAL-G03 mapping values (a data input, not a code risk) |
| **Customer dual-write** | `dualWriteAfterCaseSuccess()` fires unconditionally inside `createCase()`, exactly as for every caller; no-op while flags OFF | **No** — confirmed in the Pre-Implementation Review §3.4 and re-confirmed here; Cal gets no special path in or around this hook |
| **Notion write** | `createClient()` → `withRetry()`-wrapped `notion.pages.create()`, identical to any other caller | **No** — M5's retry layer is unmodified and applies transparently |
| **Notification state** | `buildSystemDefaults()` sets `notificationStatus: 'not_sent'` unconditionally — the same default every Case gets at creation, regardless of caller | **No** — Cal cannot set any other value; the field is never touched again until `workflow-service.js`'s own functions run, later, driven by staff action, not by Cal |

**Verdict §6:** tracing the actual function bodies confirms zero regression risk to any of the five systems checked. The only conditional/data-dependent outcome (Offer correctness) depends on a Product input (CAL-G03), not on any code change this integration requires.

---

## 7. Lifecycle Matrix (Phase 1 scope: CREATE only; cancel/reschedule shown for completeness per Gate's own state table, not newly authorized here)

States used are the **real, live** `caseWorkflowStatus` values only (re-confirmed by the same grep used in `CALCOM_IMPLEMENTATION_GATE.md`): `scheduled`, `in_progress`, `completed`, `result_sent`, `feedback_submitted`, `cancelled`.

| Event | Current State | Action | Allowed | Block |
|---|---|---|---|---|
| Booking created (`calBookingId` not seen before) | *(no Case)* | `createCase()` | ✅ | — |
| Booking created (duplicate — same `calBookingId` already has a Case) | any | Return existing Case, no new `createCase()` call | ✅ (idempotent) | New Case creation is blocked by design (§5) |
| Cancel | `scheduled` | `cancelAppointment()` | ✅ | — |
| Cancel | `in_progress` | Guarded — no silent cancel | ⚠️ Requires ops UX decision (already flagged, not a Phase 1 blocker since Phase 1 is CREATE-only) | Silent force-cancel is blocked |
| Cancel | `completed` / `result_sent` / `feedback_submitted` | Guarded — no silent cancel | ⚠️ Same as above | Silent force-cancel is blocked |
| Cancel | `cancelled` (already) | Idempotent no-op | ✅ | — |
| Cancel | unknown `calBookingId` | Alert, no Case invented | ❌ (by design) | Case invention is blocked |
| Reschedule | `scheduled` | Update appointment fields, same Case | ✅ | — |
| Reschedule | `in_progress` | **Still the one open cell** (re-confirmed, not resolved by this document — out of Phase 1 scope entirely since Phase 1 is CREATE-only) | ⚠️ Open | N/A to Phase 1 |
| Reschedule | terminal states | Reject — no valid ops meaning | ❌ | Rewrite of completed ops history is blocked |
| Reschedule | unknown `calBookingId` | No Case invented | ❌ | — |
| Retry webhook (any event, already successfully processed) | any | Dedupe hit (§5) → return prior outcome | ✅ (idempotent) | Re-execution of the mutating action is blocked |

**Note:** Phase 1, as scoped by every prior document (`CALCOM_IMPLEMENTATION_GATE.md` §8), is **CREATE only** — the cancel/reschedule rows above are shown because the Gate's own state table includes them, but implementing them is explicitly Phase 2's job, not Phase 1's. This matrix does not authorize building cancel/reschedule now.

---

## 8. QA Plan — Phase 1

| ID | Scenario | Setup | Expected | Exit proof |
|---|---|---|---|---|
| **QA-CAL-P1-01** | Create booking (happy path) | Valid signed `BOOKING_CREATED`, all required fields present | One Case created; `scheduled`; `notificationStatus=not_sent`; `calBookingId` persisted; visible via `GET /api/clients` | Case count +1; fields match mapping (§3) |
| **QA-CAL-P1-02** | Duplicate webhook (sequential, same process) | Same `BOOKING_CREATED` delivered twice, seconds apart | Second delivery returns the first Case; zero new Cases | Case count +1 total, not +2 |
| **QA-CAL-P1-03** | Concurrent webhook (simultaneous) | Same `BOOKING_CREATED` delivered as two near-simultaneous requests | Exactly one Case created — proves the `withCaseLock`+lookup design from §5, not just sequential dedupe | Case count +1; both responses resolve to the same Case id |
| **QA-CAL-P1-04** | Invalid signature | `BOOKING_CREATED` with a wrong/missing signature, secret configured | 401; zero Case mutation | Case count +0; matches Phase 0 report §4 behavior, now with a real event body |
| **QA-CAL-P1-05** | Notion failure during create | Simulated transient Notion 5xx during `createClient()` | Non-success response to Cal; Cal retries; after recovery, exactly one Case (M5 `withRetry` absorbs the transient failure first; if it still fails, dedupe ensures the eventual retry doesn't double-create) | Case count +1 after retry completes, not +0 or +2 |
| **QA-CAL-P1-06** | Cal retry after long delay (simulated restart) | Create the dedupe/lookup state, restart the process (or simulate via fresh module state), redeliver the same event | Same Case returned, zero new Cases — proves durability beyond in-memory TTL | Case count unchanged after "restart" redelivery |
| **QA-CAL-P1-07** | Missing required field | `BOOKING_CREATED` with no attendee name mapped | 4xx; no Case created | Case count +0 |
| **QA-CAL-P1-08** | Unknown/unmapped event type (CAL-G03 default) | Valid `BOOKING_CREATED` with an event type not in the Product-approved mapping | Case created **without** `launchOffer` attribution (locked default per `CALCOM_BLOCKER_RESOLUTION.md` CAL-G03: "do not default unknown types to Launch Offer") | Case created; Offer `used` unchanged |
| **QA-CAL-P1-09** | Offer attribution (mapped launch event type) | Valid `BOOKING_CREATED` with a Product-confirmed launch event type | Case created with `launchOffer:true`; Offer `used`+1, `remaining`-1 | Offer status delta matches exactly +1/-1 |
| **QA-CAL-P1-10** | Regression — existing Manual/API booking path unaffected | `POST /api/cases` direct call, unrelated to Cal | Behaves identically to pre-Cal-integration baseline (M5's own QA-B01–B04) | No behavior change in the non-Cal path |

**Cancelled-booking and reschedule scenarios are intentionally excluded from this Phase 1 QA plan** — they belong to Phase 2 per the Gate's own phase boundaries (§7's note); listing them here would imply Phase 1 builds them, which it does not.

**Required regression set alongside the above:** QA-B01–B04, QA-O01–O03 (`docs/verification/04_QA_MATRIX.md`), unchanged from every prior Cal document's requirement.

---

## 9. Final Verdict

## **B — READY WITH CONDITIONS**

### What this document closes

| Item | Status after this document |
|---|---|
| CAL-G02 (`calBookingId` schema) | **Confirmed closed** — concrete field/immutability/uniqueness-mechanism/migration answers given (§4) |
| CAL-G04 (durable dedupe) | **Closed with a concrete, architecture-consistent design** — Option B (`calBookingId` Notion lookup) + `withCaseLock` reuse, not just a requirements list (§5) |
| Phase 1 flow | **Fully sequenced** with input/output/failure/retry at every step (§2) |
| `createCase()` regression risk | **Confirmed zero**, traced through live function bodies for all five subsystems asked about (§6) |
| Lifecycle matrix | **Complete for Phase 1's CREATE-only scope**, with cancel/reschedule correctly deferred (§7) |
| QA plan | **10 concrete, executable test cases**, mapped to real exit proof (§8) |

### What remains blocking (unchanged in kind, not newly discovered)

| Blocker | Why it still blocks |
|---|---|
| **CAL-G01** | Real Cal.com payload samples — this document adds the Required/Optional/Ignored structure but still cannot supply actual JSON field paths without external data, per the standing evidence rule |
| **CAL-G03 (values)** | Product must still supply the concrete Cal event type → campaign mapping rows; the *rule* (unmapped ≠ launch) is closed, the *table* is not |
| **CAL-G02 (execution)** | The schema *decision* is closed (§4), but the Notion property itself must still be created — an execution step, not a design question |

### Why not A

Coding cannot begin against unverified field paths (CAL-G01) without repeating the exact mistake this entire review chain has consistently refused to make — guessing a JSON shape. This is the same reasoning every prior document has given; this review does not relax it.

### Why not C

Every design question this document was asked to resolve **was** resolved, with concrete, codebase-consistent answers (not deferred further) — the durable dedupe design in particular moves from "requirements only" (prior Gate status) to a specific, named mechanism reusing two patterns already proven in this exact codebase. No remaining item requires an architecture decision; all three remaining blockers are external inputs or execution steps.

### Path to A

1. Capture real Cal.com `BOOKING_CREATED` payload sample(s) → freeze §3's field paths
2. Product signs the CAL-G03 mapping table with real event type identifiers
3. Create the `calBookingId` Notion property (execution of the already-closed §4 decision)
4. Implement §2/§5 as designed here — at that point, and only then, does this move from a design document to code

**No code, patch, deploy, or production flag was created by this document.**
