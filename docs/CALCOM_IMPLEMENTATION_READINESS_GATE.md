# Cal.com Booking Integration — Final Implementation Readiness Gate

**Document type:** Final Implementation Readiness Review
**Mode:** Gate only — **no code, no patch, no deploy, no production flag**
**Date:** 2026-08-05
**Reviewer role:** Principal Engineer + Architecture Reviewer
**Inputs:** [`CALCOM_PHASE1_DESIGN_REVIEW.md`](./CALCOM_PHASE1_DESIGN_REVIEW.md), [`CALCOM_IMPLEMENTATION_GATE.md`](./CALCOM_IMPLEMENTATION_GATE.md), [`CALCOM_BLOCKER_RESOLUTION.md`](./CALCOM_BLOCKER_RESOLUTION.md), [`CALCOM_IMPLEMENTATION_PLAN.md`](./CALCOM_IMPLEMENTATION_PLAN.md), [`CALCOM_PHASE0_VERIFICATION_REPORT.md`](./CALCOM_PHASE0_VERIFICATION_REPORT.md), `docs/verification/01–07`
**Live code re-verified for this gate (2026-08-05, no changes since Phase 1 Design Review):** `api/cal-routes.js`, `services/cal-webhook.js`, `services/cal-dedupe-placeholder.js`, `services/case-creation-service.js`, `services/workflow-service.js`, `services/notion/mapper.js`, `services/notion/clients.js`, `services/notion/client.js`, `services/idempotency-store.js`, `services/retry.js` — confirmed via `git status`: only Phase 0 files exist (`api/cal-routes.js`, `services/cal-webhook.js`, `services/cal-dedupe-placeholder.js`); `calBookingId` is confirmed still absent from `FIELD_ALIASES` (grep returns no match)

**Purpose:** the single consolidated go/no-go gate for starting Phase 1 coding. This document does not re-derive design (that's `CALCOM_PHASE1_DESIGN_REVIEW.md`'s job, already done) — it re-verifies that design against current source one more time, in the specific shape (Must/May/Must-NOT-change; template tables with `UNKNOWN` where no real data exists; gap-only dedupe critique) this final gate was asked to produce.

---

## 1. Implementation Boundary

| Component | Existing? | Change Needed | Risk |
|---|---|---|---|
| **Webhook receiver** (`api/cal-routes.js`) | ✅ Exists (Phase 0, verified live and via 22 passing runtime tests in `CALCOM_PHASE0_VERIFICATION_REPORT.md`) | None for receive/verify/log; needs a new branch to call the Phase 1 dedupe→mapper→create chain instead of stopping at "receive only" | **Low** — the receive/verify/log portion is proven; the new branch is additive, doesn't remove the Phase 0 behavior for events it doesn't yet handle |
| **Signature verification** (`services/cal-webhook.js`) | ✅ Exists, verified against real HMAC computation (Phase 0 report §4, all 4 cases passed) | None | **None** — already production-shaped, no further change identified |
| **Dedupe** | ⚠️ Phase 0 placeholder exists (`services/cal-dedupe-placeholder.js`), explicitly non-durable by its own doc comment | **New**: durable mechanism per Phase 1 Design Review §5 (Option B — `calBookingId` Notion lookup — plus `withCaseLock()` reuse) | **Medium** — this is the one genuinely new piece of logic with a concurrency-correctness requirement; mitigated by reusing `withCaseLock`, a pattern already proven in `workflow-service.js` |
| **Mapper** (`services/cal-booking-adapter.js`, proposed) | ❌ Does not exist | **New file** — payload → `createCase()`/`cancelAppointment()` input shape | **Medium, entirely data-dependent** — the mapping *mechanism* is simple (pure function, no I/O); the *risk* is 100% about unverified field paths (CAL-G01), not the code structure |
| **`createCase()` integration** | ✅ Exists, unmodified, already the entry point for every other caller | **None to the function itself** — only a new caller | **Low** — traced through live code in Phase 1 Design Review §6; zero regression found across validation, M3, M5, dual-write, Notion write, notification state |
| **Notion schema** (`calBookingId` property) | ❌ Does not exist | **New property + one `FIELD_ALIASES` entry** | **Low** — additive only; confirmed no existing read path breaks from an unpopulated new property (Phase 1 Design Review §4) |
| **Cancellation** (`cancelAppointment()` call from Cal) | ✅ `cancelAppointment()` itself exists, unmodified | **New**: adapter-side resolve-by-`calBookingId` + guard logic before calling it | **Not in Phase 1 scope** — explicitly deferred to Phase 2 by every prior document; listed here for completeness only |
| **Reschedule** (appointment-field update from Cal) | ⚠️ No dedicated function exists today (only `submitCustomerPreassessment`-style field updates as precedent) | **New**: adapter-side resolve + field-update call | **Not in Phase 1 scope** — same deferral as cancellation; additionally has the one genuinely open lifecycle question (reschedule during `in_progress`), which is Phase 2's problem to close, not Phase 1's |

**Section verdict:** Phase 1's actual new-code surface is small and precisely bounded: one new file (mapper), one enhancement to the dedupe mechanism, one Notion schema addition, and a new branch in the existing webhook route. Everything downstream of the mapper (`createCase()` through Notion through Offer/Workflow/Notification) is 100% reused, unmodified code.

---

## 2. Code Touch Map

### Must Change

| File | Why |
|---|---|
| `api/cal-routes.js` | Add the Phase 1 branch: after dedupe passes, call the mapper and `createCase()` instead of stopping at receive-only ack. The existing signature/parse/log logic is reused, not rewritten. |
| `services/notion/mapper.js` | Add one `FIELD_ALIASES` entry (`calBookingId`) — additive, no existing key touched |
| `scripts/sync-notion-case-flow-schema.js` | Add one schema row for `calBookingId` — same additive pattern as every existing row |

### May Change

| File | Why |
|---|---|
| `services/cal-webhook.js` | `summarizeCalEnvelope()`'s field-reading may need real paths once CAL-G01 payload samples arrive (currently speculative per its own comment) — this is a refinement of existing Phase 0 code, not new architecture |
| `services/cal-dedupe-placeholder.js` | May be superseded/renamed once the durable mechanism (§5) is built — or kept as a fast in-memory first-pass filter in front of the durable check, an implementation-time choice, not an architecture one |
| `config/env.js` or direct `process.env.*` read (pattern already used by `CAL_WEBHOOK_SECRET`) | Only if a new env var is needed beyond `CAL_WEBHOOK_SECRET`, which already exists per Phase 0 — likely no change needed |

### New file (neither "change" nor reuse — net new)

| File | Why |
|---|---|
| `services/cal-booking-adapter.js` | Payload mapper — pure translation function, per Phase 1 Design Review §2 step 5 |

### Must NOT Change

| File | Confirmed unmodified as of this gate |
|---|---|
| `services/case-creation-service.js` | Not in any change-set; `createCase()`/`cancelAppointment()`/`validateCustomerInput` usage confirmed byte-identical to M5 |
| `services/workflow-service.js` | Not in any change-set; no Cal file imports it |
| `services/water-check-offer-service.js` | Not in any change-set; not imported by any Cal file; Offer continues counting Cases exactly as M3 left it |
| `services/idempotency-store.js` | Not in any change-set; M5's 30s protection for direct `POST /api/cases` callers is untouched and unrelated to the new Cal-specific durable dedupe |
| `services/line-notifications.js` | Not in any change-set; not imported by any Cal file |
| `services/customer-domain/*`, `services/migration/dual-write.js` | Not in any change-set; Cal inherits the existing unconditional-but-flag-gated-OFF dual-write hook inside `createCase()` with zero special-casing |
| `services/care-lifecycle/*` | Not in any change-set; structurally unreachable from any Cal file (re-confirmed: no `require()` of any care-lifecycle path anywhere in `api/cal-routes.js`, `services/cal-webhook.js`, `services/cal-dedupe-placeholder.js`) |
| `services/retry.js`, `services/notion/clients.js`, `services/notion/client.js` | Retry-wrapping is reused as-is; the mapper/dedupe layer calls into these exactly as any other caller would, no wrapper changes needed |

### Explicit confirmations requested

| Confirmation | Status |
|---|---|
| M3 offer logic ไม่เปลี่ยน | ✅ Confirmed — `water-check-offer-service.js` not in touch map at all |
| M5 booking hardening ไม่เปลี่ยน | ✅ Confirmed — `idempotency-store.js`, `retry.js` not modified; Cal's dedupe is additive and earlier-in-the-chain, not a replacement |
| Notification state machine ไม่เปลี่ยน | ✅ Confirmed — `workflow-service.js`, `line-notifications.js` not in touch map; `notificationStatus` remains reachable only from those unmodified files |
| Care lifecycle ไม่เปลี่ยน | ✅ Confirmed — `services/care-lifecycle/*` not in touch map, structurally unreachable |
| Customer flags ไม่เปลี่ยน | ✅ Confirmed — no flag file in touch map; `CUSTOMER_DOMAIN_*` env vars are not referenced by any Cal file |

---

## 3. CAL-G01 Closure — Payload Mapping Template

**No JSON path below is guessed.** Every "Cal Field" cell that has not been directly observed in a real Cal.com payload is marked `UNKNOWN`, per the evidence rule already established in `CALCOM_BLOCKER_RESOLUTION.md`. This table is the concrete artifact that gets filled in — not re-derived — once a real payload sample exists.

| Cal Field | Required | Target Field | Transform |
|---|---|---|---|
| `UNKNOWN` (booking identifier) | Yes | `calBookingId` | None — stored verbatim as the correlation key |
| `UNKNOWN` (webhook delivery/event id) | Yes | *(not a Case field — dedupe-only)* | None |
| `UNKNOWN` (attendee name) | Yes | `fullName` | None expected, pending sample confirmation |
| `UNKNOWN` (attendee email) | No | `email` | None expected |
| `UNKNOWN` (attendee phone / custom question) | No | `phone` | None expected; location in payload unconfirmed |
| `UNKNOWN` (start time) | Yes | `appointmentDate` + `appointmentStart` | `UNKNOWN` — timezone interpretation must be confirmed before any conversion logic is written; must not shift the calendar day (per existing `notion/mapper.js` UTC-based `isoDateOnly`/`weekdayIndex` precedent) |
| `UNKNOWN` (end time) | Yes | `appointmentEnd` | Same caveat as start time |
| `UNKNOWN` (event type id/slug) | Yes | Input to CAL-G03 mapping (§4) — not a direct Case field | None — feeds a lookup, not a direct copy |
| `UNKNOWN` (LINE custom question, if configured) | No | `lineId` | None; **never** map to `lineUserId` |
| `UNKNOWN` (location/address) | No | `address` | None expected |
| `UNKNOWN` (cancellation booking reference) | Yes, for cancel path only (Phase 2) | Used to look up Case by `calBookingId` | N/A — lookup key, not a Case field |
| `UNKNOWN` (reschedule booking reference) | Yes, for reschedule path only (Phase 2) | Used to look up Case by `calBookingId` | **Critical unknown**: whether this value equals the original `calBookingId` — determines whether reschedule can even be distinguished from a new booking |
| *(literal, not from Cal)* | N/A | `source` | Set to the literal string `'cal.com'` — already a supported `createCase()` input field today, zero schema change |

### CAL-G01 status

**Not closed by this gate.** The template is complete and ready to receive real values; no cell was filled with a guess. This remains the top blocker.

---

## 4. CAL-G03 Closure — Event Type → Offer Mapping

| Cal Event Type | Action | `launchOffer` | Owner Approval |
|---|---|---|---|
| `UNKNOWN` (presumed: Free Water Check / `watermotion/60min` or equivalent) | Create Case | `true` | **Pending Product sign-off** |
| `UNKNOWN` (presumed: paid Full Assessment, if it exists as a separate Cal event type) | Create Case | `false` (or a different named campaign, if Product specifies one) | **Pending Product sign-off** |
| Any event type not in the approved rows above | Create Case | `false` (locked default — **never** default an unmapped type to `true`, per `CALCOM_BLOCKER_RESOLUTION.md` CAL-G03) | **Closed rule**, no approval needed — this row requires no further sign-off, it is already a locked architectural default |

### Required sign-off

**Product must supply the real event type id/slug values for the first two rows before Phase 1 can be considered Offer-safe.** The *mechanism* (event type → `options.launchOffer`/`campaignOffer` → unmodified `createCase()`) is fully closed and requires no further architecture decision — only the concrete identifiers are missing.

### CAL-G03 status

**Not closed by this gate** for the concrete mapping values (same status as `CALCOM_BLOCKER_RESOLUTION.md` left it — this gate does not claim new closure here, only re-confirms the rule and the template).

---

## 5. Durable Dedupe Implementation Review

**Scope of this section, per instruction: identify gaps only — do not propose a new architecture.** The design under review is the one already locked in `CALCOM_PHASE1_DESIGN_REVIEW.md` §5: **Option B (`calBookingId` lookup against the live Notion Cases DB) + `withCaseLock()` reuse for per-key serialization.**

| Question | Is it sufficient? | Gap (if any) |
|---|---|---|
| **Duplicate webhook พร้อมกัน (concurrent)** | **Yes, sufficient as designed** — `withCaseLock(calBookingId)` serializes concurrent deliveries for the same key; the second request's lookup runs only after the first's create has committed, per the same lock semantics already proven for `startCase`/`closeCase`/`sendCaseResult` in `workflow-service.js` | **None for same-process concurrency.** Gap: `withCaseLock` is an in-process `Map` (confirmed live: `const locks = new Map();` in `workflow-service.js`) — it does **not** coordinate across multiple simultaneous process instances. This is not a new gap; it is the same already-accepted limitation M3's offer cache carries today under the current single-instance deployment. Not proposing a fix — flagging that it inherits, not introduces, this limitation. |
| **Restart หลัง process ตาย** | **Yes, sufficient** — the `calBookingId` lookup reads real, persisted Notion data; a process restart doesn't affect what's already durably written. A retried webhook after a restart finds the already-created Case exactly as if no restart occurred. | **None identified.** This is precisely what disqualified the Phase 0 placeholder (in-memory) and precisely what Option B's Notion-backed lookup solves by construction — the durability isn't a store, it's the Case row itself. |
| **Retry หลัง timeout** (Cal times out waiting for a response, though `createCase()` actually succeeded) | **Yes, sufficient** — same mechanism as restart: the retry's lookup finds the Case that was in fact created, regardless of whether the *original* HTTP response ever reached Cal.com | **One process-ordering gap worth naming, not fixing here:** if the adapter's ack-to-Cal happens *before* confirming the create is durably committed (i.e., acking optimistically), a timeout-driven retry racing the original request's own in-flight commit could theoretically still hit the same concurrent-delivery case already covered by `withCaseLock` above — so this reduces to the same first row, not a distinct new gap, **provided** the implementation acks only after the lock-protected create/lookup sequence fully resolves (already the locked "ack only after durable success" rule from `CALCOM_BLOCKER_RESOLUTION.md` CAL-G04). |
| **Notion latency** (the lookup or the create itself is slow, not failing — just slow) | **Mostly sufficient, one real gap to name** | **Gap:** `withCaseLock` holds its lock for the full duration of the locked operation — if Notion is slow, a concurrent duplicate delivery for the *same* `calBookingId` simply waits longer (correct, not a bug), **but** a burst of *many different* `calBookingId`s all experiencing Notion latency simultaneously has no queuing/backpressure design discussed anywhere in the reviewed documents. This is not a correctness gap (no duplicate Cases result), it is a **throughput/latency gap** under sustained high concurrency — worth naming as a monitoring consideration for Phase 3 rollout, not a blocker for Phase 1's much lower expected volume (a single small business's booking traffic). |

### Summary of gaps (identification only, per instruction — no new architecture proposed)

1. **Cross-instance coordination** — inherited limitation from existing `withCaseLock`/offer-cache precedent, not new, not proposed to be fixed here.
2. **Throughput under sustained concurrent load across many distinct bookings** — a latency/monitoring consideration, not a correctness gap; flagged for Phase 3 operational awareness, not a Phase 1 blocker given expected traffic volume.

**No third gap was found in duplicate-handling, restart-survival, or timeout-retry correctness** — those three scenarios are each sufficiently covered by the Option B + `withCaseLock` design as already specified.

---

## 6. Lifecycle Decision Matrix

States: `scheduled`, `in_progress`, `completed`, `result_sent`, `feedback_submitted`, `cancelled` (live-verified, unchanged from every prior document in this chain).

| Event | scheduled | in_progress | completed | result_sent | feedback_submitted | cancelled |
|---|---|---|---|---|---|---|
| **BOOKING_CREATED** (new `calBookingId`) | N/A — this event *produces* `scheduled`, doesn't act on an existing state | N/A | N/A | N/A | N/A | N/A |
| **BOOKING_CREATED** (duplicate `calBookingId`) | Idempotent — return existing Case | Idempotent — return existing Case | Idempotent — return existing Case | Idempotent — return existing Case | Idempotent — return existing Case | Idempotent — return existing Case |
| **BOOKING_CANCELLED** | ✅ Allow → `cancelled` | ⚠️ Guard — no silent cancel (Phase 2 UX open) | ⚠️ Guard — no silent cancel | ⚠️ Guard — no silent cancel | ⚠️ Guard — no silent cancel | ✅ Idempotent no-op |
| **BOOKING_RESCHEDULED** | ✅ Allow — update appointment fields, same Case | ⚠️ **Open** — no locked guard anywhere in the DDR chain (re-confirmed, not resolved by this gate) | ❌ Reject — no valid ops meaning | ❌ Reject | ❌ Reject | ❌ Reject — no silent resurrect via reschedule |

**Phase 1 scope note (re-stated, not new):** Phase 1 implements only the top-left cell family — `BOOKING_CREATED` against no-existing-Case and duplicate-`calBookingId`. Every `BOOKING_CANCELLED`/`BOOKING_RESCHEDULED` row is shown for completeness against the Gate's own state table but is **Phase 2 scope**, not authorized for building now.

---

## 7. Phase 1 QA Gate

| ID | Scenario | Expected | Covers |
|---|---|---|---|
| **CAL-P1-001** | Valid booking creates one Case | One Case; `scheduled`; `notificationStatus=not_sent`; `calBookingId` persisted | Happy path |
| **CAL-P1-002** | Duplicate delivery (sequential) | Second delivery returns the first Case; zero new Cases | Dedupe correctness |
| **CAL-P1-003** | Concurrent delivery (simultaneous requests, same `calBookingId`) | Exactly one Case — proves `withCaseLock` serialization, not just sequential dedupe | §5's core correctness claim |
| **CAL-P1-004** | Invalid signature | 401; zero Case mutation | Security, re-proven with a real event body (Phase 0 already proved this with a synthetic body) |
| **CAL-P1-005** | Notion failure during create | Non-success to Cal; Cal retries; exactly one Case after recovery | M5 `withRetry` + dedupe interaction |
| **CAL-P1-006** | Retry after simulated restart | Same Case returned, zero duplicates, after dedupe/lock state is reset (simulating a process restart) | Durability (the specific gap the Phase 0 placeholder could not close) |
| **CAL-P1-007** | Missing required field (no attendee name) | 4xx; no Case created | Validation reuse (`validateCustomerInput`) |
| **CAL-P1-008** | Cancel booking | **Not in Phase 1 build scope** — this ID reserved for Phase 2; listed here only to confirm it is *not* silently included in Phase 1's QA claim | Scope discipline |
| **CAL-P1-009** | Reschedule booking | **Not in Phase 1 build scope** — reserved for Phase 2, same reasoning as CAL-P1-008 | Scope discipline |
| **CAL-P1-010** | Offer attribution (mapped launch event type) | Case created with `launchOffer:true`; Offer `used`+1 | Requires CAL-G03 values first |
| **CAL-P1-011** | Offer non-attribution (unmapped event type) | Case created without launch attribution; Offer unchanged | Locked default behavior, testable even before CAL-G03 values arrive |

**Required regression set, unchanged:** QA-B01–B04, QA-O01–O03 from `docs/verification/04_QA_MATRIX.md` must remain green.

**Note on CAL-P1-008/009:** including cancel/reschedule IDs in this numbering makes the scope boundary explicit rather than implying Phase 1 is QA-complete once CAL-P1-001–007/010/011 pass — those two IDs exist specifically to be marked "N/A — Phase 2" in execution, not skipped silently.

---

## 8. Final Gate

## **READY WITH CONDITIONS (Gate status: B — unchanged from every prior document in this chain)**

### What is genuinely ready right now

- Implementation boundary is fully mapped (§1) — small, precise new-code surface
- Code touch map is explicit, with every "Must NOT Change" file re-confirmed absent from any change-set (§2)
- Durable dedupe design has **zero remaining correctness gaps** for its three core scenarios (duplicate-concurrent, restart, timeout-retry) — only an inherited, already-accepted cross-instance limitation and a Phase-3-relevant throughput note (§5)
- Lifecycle matrix is complete and scope-disciplined (§6)
- QA gate is concrete and executable, with explicit scope guards preventing Phase 2 work from silently riding along (§7)

### Remaining blockers (unchanged in substance from `CALCOM_BLOCKER_RESOLUTION.md` — this gate closes no new blocker, it confirms none were missed)

| Blocker | What's needed |
|---|---|
| **CAL-G01** | Real Cal.com `BOOKING_CREATED` (and later CANCEL/RESCHEDULE) payload samples to fill §3's template — currently every field path is `UNKNOWN`, correctly, not guessed |
| **CAL-G03 (values)** | Product-signed event type → campaign mapping rows for §4's template |
| **CAL-G02 (execution)** | Create the `calBookingId` Notion property — a decided, ready-to-execute step, not an open question |

### Why not READY FOR IMPLEMENTATION

Two of the three remaining items are external data inputs (real payloads, Product's mapping decision) that no amount of additional architecture review can substitute for — writing the mapper (§3) or finalizing Offer attribution (§4) against `UNKNOWN` values would mean shipping guessed field paths, which every document in this chain has consistently and correctly refused to do.

### Why this is not a step backward from B

This gate found **zero new architecture gaps** and **zero new blockers** — it re-verified the Phase 1 design against live source one more time and found it holds. The distance from here to **A** is now purely: obtain the payload samples, get Product's sign-off, create one Notion property. No further design review is expected to be needed once those three land — implementation can begin as soon as they do.

**No code, patch, deploy, or production flag was created by this gate.**
