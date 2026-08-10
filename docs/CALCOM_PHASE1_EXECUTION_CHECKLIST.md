# Cal.com Booking Integration — Phase 1 Execution Checklist

**Document type:** Pre-Implementation Execution Checklist
**Mode:** Preparation only — **no code, no patch, no file edits outside this document, no deploy**
**Date:** 2026-08-05
**Inputs:** [`CALCOM_IMPLEMENTATION_READINESS_GATE.md`](./CALCOM_IMPLEMENTATION_READINESS_GATE.md) (Gate B), [`CALCOM_PHASE1_DESIGN_REVIEW.md`](./CALCOM_PHASE1_DESIGN_REVIEW.md), [`CALCOM_IMPLEMENTATION_PLAN.md`](./CALCOM_IMPLEMENTATION_PLAN.md), [`CALCOM_PHASE0_VERIFICATION_REPORT.md`](./CALCOM_PHASE0_VERIFICATION_REPORT.md)
**Live code re-checked:** `git status` confirms no new Cal-related files since the last gate — Phase 0 code (`api/cal-routes.js`, `services/cal-webhook.js`, `services/cal-dedupe-placeholder.js`) is still the entire implementation footprint; `calBookingId` still absent from `services/notion/mapper.js`

**Purpose:** the literal go/no-go checklist an implementer opens on day one of Phase 1 coding. Every item below traces to a decision already closed in a prior document — this file does not reopen any of them, it converts them into an execution-ready list.

---

## 1. Pre-Implementation Checklist

| Item | Status | Owner | Evidence |
|---|---|---|---|
| Cal webhook payload received (real CREATE sample, redacted) | ❌ **Not done** | Product + Eng (capture) / Cal admin | No sample exists in this repo — confirmed by `CALCOM_BLOCKER_RESOLUTION.md`'s own evidence rule and re-confirmed in every subsequent Cal document up to and including `CALCOM_IMPLEMENTATION_READINESS_GATE.md` §3 |
| Cal webhook secret available (staging) | ⚠️ **Partially done** | Eng Lead / Cal admin | `CAL_WEBHOOK_SECRET` env var is already read and enforced correctly by live code (`services/cal-webhook.js` `isCalWebhookConfigured()`/`verifyCalSignature()`, verified in Phase 0 report §4 with a real HMAC computation) — the **mechanism** is ready; an actual **staging secret value** from Cal.com has not been confirmed present in this repo's environment |
| Signature header confirmed | ✅ **Done** | Eng (already implemented) | `SIGNATURE_HEADER = 'x-cal-signature-256'`, HMAC-SHA256-hex over raw body — implemented and verified against real signature computation in Phase 0 (all 4 signature test cases passed) |
| Event type list confirmed (which Cal event types exist for this account) | ❌ **Not done** | Product / Cal admin | No event type inventory exists in any reviewed document — this is a prerequisite to CAL-G03's mapping table, not yet supplied |
| Product offer mapping approved (CAL-G03 concrete values) | ❌ **Not done** | Product | `CALCOM_IMPLEMENTATION_READINESS_GATE.md` §4 template exists with every row marked pending sign-off; no signed table exists |
| Notion `calBookingId` property created | ❌ **Not done** | Notion schema owner + Eng | Confirmed absent via live grep of `FIELD_ALIASES` in `services/notion/mapper.js`; the *decision* (immutable, string, new property) is closed per `CALCOM_PHASE1_DESIGN_REVIEW.md` §4 — only the execution step remains |
| Environment variable prepared (`CAL_WEBHOOK_SECRET` in the actual deploy target) | ⚠️ **Partially done** | Ops / Eng Lead | The code path to read it is production-ready; whether the variable is actually set in Render's environment (staging or prod) was not verified as part of any document in this chain — this is an ops action item, not a design gap |
| Staging endpoint ready (a Cal.com webhook actually pointed at a reachable staging URL) | ❌ **Not done** | Ops / Eng Lead | No staging webhook subscription has been referenced as configured in any reviewed document; `GET /api/cal/webhook/status` (live, Phase 0) already reports a computed `webhookUrl` value ready to be registered with Cal.com once staging is up |

**Section verdict:** 1 of 8 items fully done, 2 partially done (mechanism ready, real value/config pending), 5 not started. All 5 "not done" items are external inputs or ops actions, not code-design gaps — consistent with every prior gate's "READY WITH CONDITIONS" framing.

---

## 2. Exact Implementation Scope

### IN (Phase 1 build scope)

- Webhook receive (already exists from Phase 0 — reused, not rebuilt)
- Signature verification (already exists from Phase 0 — reused, not rebuilt)
- Event normalization with **real** field paths (upgrade from Phase 0's speculative envelope reader, once CAL-G01 closes)
- Durable dedupe (`calBookingId` Notion lookup + `withCaseLock()` reuse, per `CALCOM_PHASE1_DESIGN_REVIEW.md` §5 — new code, existing pattern)
- `createCase()` adapter (new mapper file calling the unmodified `createCase()`)
- Cancel adapter (resolve by `calBookingId` → call unmodified `cancelAppointment()`, with the guard matrix from the Gate's §6 lifecycle table)
- Reschedule adapter (resolve by `calBookingId` → appointment-field update on the same Case)

### OUT (explicitly not touched by this work)

- Booking logic rewrite — `createCase()`/`cancelAppointment()` internals are untouched; Phase 1 is a new *caller*, never a modifier
- Offer rewrite — `water-check-offer-service.js` (M3) untouched; Cal only ever supplies `options.launchOffer`/`campaignOffer`, exactly like any other existing caller
- Notification rewrite — `workflow-service.js`/`line-notifications.js` untouched; `notificationStatus` remains unreachable from any Cal file
- Customer migration — `services/customer-domain/*`, `services/migration/dual-write.js` untouched; Cal inherits the existing flag-gated-OFF dual-write hook with zero special-casing
- Care changes — `services/care-lifecycle/*` untouched; structurally unreachable from the Cal path (no `require()` anywhere in the Cal file set)

**Note on scope sequencing:** although "Cancel adapter" and "Reschedule adapter" are listed under IN per this checklist's requested scope statement, every prior document (`CALCOM_IMPLEMENTATION_GATE.md` §8, `CALCOM_PHASE1_DESIGN_REVIEW.md` §7, `CALCOM_IMPLEMENTATION_READINESS_GATE.md` §6) has consistently scoped Phase 1's *first working slice* as CREATE-only, with cancel/reschedule as Phase 2. This checklist reconciles that by placing cancel/reschedule in their own PR boundary (§6, PR-4) rather than the initial build — "in scope for Phase 1 planning" is not the same as "in scope for Phase 1's first PR," and §6 makes that distinction explicit.

---

## 3. Runtime Flow Contract

```
INPUT
  Cal.com webhook POST
  → raw body + X-Cal-Signature-256 header

PROCESSING
  1. Verification
     - HMAC-SHA256-hex signature check over raw body (EXISTS, Phase 0)
     - fail → reject, stop here

  2. Dedupe
     - calBookingId + event kind lookup against Notion (NEW, Phase 1)
     - under withCaseLock(calBookingId) for concurrent-delivery safety
     - already processed → return prior outcome, stop here (no re-mapping, no re-create)

  3. Mapping
     - normalize payload → { customerPayload, options } (NEW, Phase 1)
     - missing required field → reject, stop here

  4. createCase() (UNMODIFIED, M5)
     - validateCustomerInput → Notion write → offer invalidate (if attributed) →
       dual-write hook (no-op, flags OFF) → notificationStatus='not_sent'

OUTPUT (one of exactly three)
  a) Case created            → 2xx to Cal, new Notion Case row exists
  b) Duplicate ignored        → 2xx to Cal (idempotent-success shape), zero new Case
  c) Rejected                 → 4xx/401 to Cal, zero Case mutation, zero Notion write
```

**Contract rule:** there is no fourth outcome. A Cal webhook either results in exactly one Case (new or previously-existing-and-returned), or results in zero Case mutation with an explicit rejection. No partial-write state is a valid contract outcome — this mirrors `createCase()`'s own existing all-or-nothing behavior (a single `createClient()` call, no multi-step Case assembly to leave half-done).

---

## 4. Failure Contract

| Failure | Behavior |
|---|---|
| **Invalid signature** | Reject (401), zero Case mutation, zero Notion write, zero dedupe-store write. Already implemented and verified (Phase 0 report §4, Cases A/C). |
| **Duplicate event** (any redelivery — sequential, concurrent, or post-restart) | Accept (2xx), zero new Case, response indicates the existing outcome rather than a fresh create. Per §5 of `CALCOM_PHASE1_DESIGN_REVIEW.md`, correctness holds for all three redelivery shapes via the `calBookingId` lookup + `withCaseLock` design. |
| **Cal retry** (Cal.com redelivering after not receiving a timely 2xx, for any reason on either side) | Treated identically to "duplicate event" once it reaches the adapter — the contract does not distinguish *why* a redelivery happened, only *that* it did, which is what makes the dedupe key (`calBookingId`+event kind) durability-first rather than reason-first. |
| **Notion unavailable during create** | Non-success response to Cal (so Cal retries per its own policy); M5's existing `withRetry` (unmodified, wraps `createClient`/`updateClient` in `services/notion/clients.js`) already absorbs transient 429/5xx before this failure mode is even reached by the adapter; a sustained outage surfaces as a clean failure, never a silent partial Case. |
| **`createCase()` failure** (any reason — validation, Notion, or otherwise) | Adapter surfaces the failure's own `statusCode`/message as the HTTP response to Cal; no Case is left in an indeterminate state, since `createCase()` itself either fully succeeds (Notion write committed) or throws before any write occurs (validation) — there is no code path in the existing function that partially writes. |

**No failure mode listed above requires new error-handling architecture** — each one is answered either by Phase 0's already-verified behavior, by M5's already-verified retry layer, or by the dedupe design already closed in the readiness gate.

---

## 5. Rollback Plan

| Question | Answer |
|---|---|
| **ถ้า Phase 1 มีปัญหา ปิด webhook route ได้ไหม?** | **Yes, two-sided and independent of code changes:** (1) disable the webhook subscription in the Cal.com dashboard — stops new deliveries at the source; (2) the Portal-side route (`api/cal-routes.js`'s `/api/cal/webhook` handler) can be disabled by removing its registration in `server.js` (currently a 2-line addition, per the Phase 0 report's own diff evidence) or by unsetting/rotating `CAL_WEBHOOK_SECRET` so all deliveries are rejected at the signature-verification step — no Case-domain code needs to change to achieve either. |
| **ระบบเดิมได้รับผลกระทบไหม?** | **No.** Every file the Cal path touches beyond its own new files is **unmodified** — `createCase()`, `cancelAppointment()`, `water-check-offer-service.js`, `workflow-service.js`, `idempotency-store.js`, and every Customer/Care file are byte-identical to their pre-Cal-integration state (re-confirmed via `git status` at the top of this document). Disabling the Cal route removes a *caller*, not a *capability* — `POST /api/cases`, Manual Create, and every other existing intake path are structurally unaware the Cal adapter exists at all. |
| **Case ที่สร้างไปแล้วจัดการอย่างไร?** | **They remain as ordinary Cases — no special handling needed or possible.** Once `createCase()` returns for a Cal-origin booking, the resulting Notion row is indistinguishable in kind from a Manual/API-created Case (it just happens to also carry a `calBookingId` value and `source:'cal.com'`). Rolling back Cal intake does not, and structurally cannot, retroactively invalidate, hide, or corrupt those rows — they continue through the normal Case lifecycle (start/close/notify/feedback) exactly like any other Case. If a specific Cal-origin Case needs manual correction (e.g., it was created from a since-recognized bad mapping), that is an ordinary Case-editing operation via the existing dashboard/API, not a Cal-specific recovery procedure. |

---

## 6. First Implementation PR Boundary

**Explicit rule: these four PRs must not be merged as one.** Each has its own exit criteria and its own point at which it can be safely reviewed/tested in isolation.

| PR | Scope | Exit criteria | Depends on |
|---|---|---|---|
| **PR-1** | Receive + verify + config | Confirm/upgrade the already-existing Phase 0 receive/verify code against real payload samples (CAL-G01); add any newly-needed env var wiring; **no new mutation capability added** — this PR should be behaviorally close to Phase 0, just field-path-accurate instead of speculative | CAL-G01 payload samples |
| **PR-2** | Dedupe + mapper | Implement the `calBookingId` Notion lookup + `withCaseLock()` durable dedupe (§5 of the readiness gate); implement `services/cal-booking-adapter.js`'s pure mapping function; **still does not call `createCase()`** — testable in isolation against CAL-P1-002/003/006 (duplicate, concurrent, restart-simulated) without touching Notion Cases at all if the mapper output is logged/returned rather than passed to create yet | PR-1; `calBookingId` Notion property must exist (execution of the closed CAL-G02 decision) |
| **PR-3** | `createCase()` integration | Wire PR-2's mapper output into the existing, unmodified `createCase()`; this is the PR that actually starts creating Cases from Cal — must ship together with CAL-P1-001/004/005/007/010/011 passing (per `CALCOM_IMPLEMENTATION_READINESS_GATE.md` §7) | PR-2; CAL-G03 mapping values (for Offer-safe attribution) |
| **PR-4** | Cancel / reschedule | Resolve-by-`calBookingId` + guard matrix (§6 of the readiness gate) for `cancelAppointment()` and the appointment-field update path; this is Phase 2 work by every prior document's own phase boundary, listed here only to make the PR sequence explicit and to keep it **out of PR-1–3** | PR-3; the still-open reschedule-during-`in_progress` ops decision (never resolved in any document in this chain) must close before PR-4's reschedule half can ship, even though its cancel half could ship independently |

**Why four, not one:** each PR has an independent, verifiable exit condition (§7's QA IDs map cleanly onto PR-2/PR-3), and PR-4 in particular depends on an ops decision (reschedule-during-`in_progress`) that has never been the bottleneck for PR-1–3 — bundling them would make the whole integration wait on the one item least likely to close quickly.

---

## 7. Final Decision

**Architecture:** READY
**Implementation:** WAITING EXTERNAL INPUT

### Blockers (unchanged from `CALCOM_IMPLEMENTATION_READINESS_GATE.md` — no new blocker identified by this checklist)

- **Cal payload** — real CREATE (and later CANCEL/RESCHEDULE) samples; blocks PR-1's field-accurate normalization and PR-2's mapper
- **Product mapping** — signed CAL-G03 event type → campaign table; blocks PR-3's Offer-safe attribution
- **Notion property** — `calBookingId` creation; blocks PR-2's dedupe lookup entirely (no correlation key to look up against)

No architecture question remains open for Phase 1's PR-1–3. PR-4 additionally waits on the reschedule-during-`in_progress` ops decision, which is a Phase 2 concern and does not block PR-1–3 from proceeding once the three blockers above close.

**No code was written, no file was modified, and no deploy action was taken to produce this checklist.**
