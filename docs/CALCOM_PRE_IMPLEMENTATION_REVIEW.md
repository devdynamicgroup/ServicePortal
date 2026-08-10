# Cal.com Booking Integration — Pre-Implementation Architecture Review

**Document type:** Pre-Implementation Architecture Review
**Mode:** Review Only — **no code, no patch, no file edits outside this document, no webhook, no migration, no flags, no deploy**
**Date:** 2026-08-05
**Reviewer role:** Principal Engineer + Architecture Reviewer
**Reviewed:** [`docs/CALCOM_BOOKING_INTEGRATION_DESIGN_DECISION_RECORD.md`](./CALCOM_BOOKING_INTEGRATION_DESIGN_DECISION_RECORD.md) (DDR, CLOSED) against [`docs/CALCOM_IMPLEMENTATION_PLAN.md`](./CALCOM_IMPLEMENTATION_PLAN.md) (Plan)
**Also cross-checked against:** [`docs/CALCOM_INTEGRATION_ARCHITECTURE_READINESS.md`](./CALCOM_INTEGRATION_ARCHITECTURE_READINESS.md), [`docs/verification/01_AS_BUILT_ARCHITECTURE.md`](./verification/01_AS_BUILT_ARCHITECTURE.md), [`docs/verification/04_QA_MATRIX.md`](./verification/04_QA_MATRIX.md), and the live source: `services/case-creation-service.js`, `services/workflow-service.js`, `services/water-check-offer-service.js`, `services/idempotency-store.js`, `services/migration/dual-write.js`, `services/customer-domain/flags.js`, `services/care-lifecycle/flags.js`, `services/care-lifecycle/run.js`

**Purpose of this review:** confirm the Plan can add Cal.com intake capability **without** breaking the existing architecture, before a single line of adapter code is written.

---

## 1. Architecture Compliance Review

| Decision | Expected (DDR / Lock) | Implementation Plan | Status |
|---|---|---|---|
| Cal.com ownership | External Intake Channel only; not a Domain; not SSOT | §2 diagram + §3 boundary statement: adapter has "exactly one write capability" — calls existing Case entry points only | ✅ Compliant |
| Case ownership | Case remains Ops SSOT for booking/workflow/notification | §3: `case-creation-service.js`, `workflow-service.js` both marked **No Change**; adapter is "a new caller, not a new behavior" | ✅ Compliant |
| Offer ownership | Offer counts Cases only, via `campaignOffer`/`launchOffer` — no new Offer store | §3: `water-check-offer-service.js` **No Change**; §5 mapping explicitly forbids inventing new campaign vocabulary ("must match an existing campaign string") | ✅ Compliant |
| Notification ownership | Case-owned `notificationStatus`; booking webhook must never write it | §5 "Explicit non-mapping" clause states Cal never sets `notificationStatus`; §8 "Privilege boundary" lists only `createCase`/`cancelAppointment`/appointment-update as reachable | ✅ Compliant |
| Care isolation | Care never touched by booking webhooks; no SEND from Cal path | §1 scope explicitly excludes any Care flag change; §3 does not list any `services/care-lifecycle/*` file as touched | ✅ Compliant |
| Customer identity ownership | Identity-only; Cal must not invent Customer ownership of bookings | §1 scope excludes Customer Domain flag changes; §3 does not touch `services/migration/dual-write.js` or `services/customer-domain/*` | ✅ Compliant (see §3.4 below for a nuance worth naming explicitly) |
| Adapter identity model | `calBookingId` primary, webhook event/delivery id secondary; exact match only, no fuzzy merge | §5 mapping table and §6 dedupe design both use `calBookingId` as the sole correlation key; §5 states "no new campaign vocabulary invented" and nowhere proposes name/phone matching | ✅ Compliant |
| M3/M5 non-rewrite | Do not rewrite Offer math or booking hardening | §1 scope, §3 file table (both marked No Change), §9 explicitly routes transient Notion failure handling through "M5's existing `withRetry`... unmodified" | ✅ Compliant |
| Backfill | None in v1 | §1 scope excludes backfill; §12 Phase plan contains no backfill phase | ✅ Compliant |

**Section verdict:** the Plan does not deviate from any locked DDR decision. No item in this table is marked non-compliant.

---

## 2. File Impact Review

From Plan §3:

| Category | Files |
|---|---|
| **Add** | `api/cal-routes.js`, `services/cal-booking-adapter.js`, `services/cal-dedupe-store.js`, `tests/` (new dir) |
| **Modify** | `server.js` (route registration), `services/notion/mapper.js` (add `calBookingId` alias), `config/env.js` (add secret var), `scripts/sync-notion-case-flow-schema.js` (add property), `docs/verification/04_QA_MATRIX.md`, `docs/verification/01_AS_BUILT_ARCHITECTURE.md`, `docs/PROJECT_STATE.md` |
| **Reuse, no modification** | `services/case-creation-service.js`, `services/workflow-service.js`, `services/water-check-offer-service.js`, `services/idempotency-store.js`, `services/observability.js`, `services/retry.js`, `api/line-routes.js` (pattern reference only), `api/case-flow-routes.js` |

### แตะ Core flow มากเกินไปหรือไม่ (does this touch core flow too much)?

**No.** Every file marked "Modify" is additive at the edges:
- `server.js` — adding one more `handleXRoute` dispatch call is the exact same pattern already used for `handleLineRoute`, `handleCaseFlowRoute`, `handlePublicRoute`. This is registration, not logic change.
- `services/notion/mapper.js` — adding one key to `FIELD_ALIASES` (verified live: the object currently has ~30 keys, e.g. `fullName`, `phone`, `lineUserId` — see file). Appending `calBookingId: [...]` does not alter how any existing key is read/written; `getPropertyValue`/`findPropertyKey` are alias-driven lookups, unaffected by adding an unrelated key.
- `config/env.js` — currently exports only `loadDotEnv`/`getNotionConfig` (verified live). A new webhook secret would most naturally follow the `process.env.LINE_CHANNEL_SECRET`-style direct read already used in `line-notifications.js`, not require a `config/env.js` change at all — **the Plan's own file table over-scopes this row**: `config/env.js` does not need to change for a webhook secret to exist, since the LINE precedent reads the env var directly in its own service file. This is a minor inaccuracy, not a compliance risk (see §9 risk table).
- `scripts/sync-notion-case-flow-schema.js` — additive schema entry, same pattern as every existing property in that file.

**Core write paths (`createCase`, `cancelAppointment`, `workflow-service.js`, `water-check-offer-service.js`) are correctly listed as No Change**, which is the single most important compliance fact in this review: the adapter is designed to be a **caller**, not a **modifier**, of the Case domain.

### โอกาส regression จุดไหน (regression risk points)?

1. **`services/notion/mapper.js` alias addition** — near-zero risk (additive key), but *any* touch to this shared file means it must be re-verified against the existing M3/M5 regression evidence (the same file M5's own audit walked line-by-line) before merge — not because the change is risky, but because this file is load-bearing for every domain that reads a Case (Offer, Workflow, Dashboard, Care eligibility).
2. **`server.js` route registration** — low risk structurally, but route-dispatch ordering matters in this codebase's existing handler chain (`handlePublicRoute` → `handleCaseFlowRoute` → `handleLineRoute` pattern, each returning a boolean to signal "handled"). A new `handleCalRoute` must be inserted without altering the return-boolean short-circuit contract the others rely on. Not flagged as a blocker, but a concrete implementation-time watch-item.
3. **Any future accidental import of `case-creation-service.js` internals by the adapter** instead of calling only its public `createCase`/`cancelAppointment` exports — the Plan's diagram (§2) correctly shows only the public entry points, but this is worth naming as the one discipline that, if violated during coding, would be the actual mechanism of an ownership breach (see §3 Dependency check below).

---

## 3. Existing Flow Impact

### 3.1 M3 Offer

| Check | Plan's treatment | Verified against live code |
|---|---|---|
| Slot counting | `water-check-offer-service.js` No Change; adapter only ever calls `createCase({ launchOffer })` | Confirmed live: `getWaterCheckOfferStatus`/`countUsedOffers` in `water-check-offer-service.js` read `job.campaignOffer` from whatever Cases exist — mechanism is caller-agnostic by construction, so a new caller (the adapter) requires zero change here |
| Campaign attribution | Plan §5: Cal event type → `launchOffer:true`/`campaignOffer` string, "must match an existing campaign string already known to `water-check-offer-service.js`" | Correct constraint — `DEFAULT_LAUNCH_CAMPAIGN_OFFER` in `case-creation-service.js` and the offer service's `getCampaignOfferName()` both resolve from the same `WATER_CHECK_CAMPAIGN_OFFER` env var; Plan does not propose a second campaign-name source, so no divergence risk |
| Cancellation | Plan §4 BOOKING_CANCELLED → `cancelAppointment(caseId)`, unchanged | Confirmed live: `cancelAppointment()` already invalidates the offer cache when `job.campaignOffer` is set (M3 behavior) — the adapter inherits this for free by calling the existing function |

**M3 impact verdict:** No modification to Offer math; correctness depends entirely on Phase-0 product confirmation of the event-type→campaign mapping (already flagged as a non-blocking-but-required input in Plan §Final Verdict) — this is a **data/config risk**, not an **architecture risk**.

### 3.2 M5 Booking Hardening

| Check | Plan's treatment | Verified against live code |
|---|---|---|
| Idempotency | Plan §6 explicitly states M5's `idempotency-store.js` (30s TTL) stays as-is; Cal path adds a **separate, durable** dedupe layer | Confirmed live: `services/idempotency-store.js` is a plain in-memory `Map` with a 30s TTL sweep — correctly identified by the Plan as insufficient for webhook redelivery across a process restart. The DDR (§4) independently locks this same conclusion. **Compliant** and technically accurate. |
| Retry | Plan §9: transient Notion failures during CREATE are "absorbed" by M5's existing `withRetry` wrapping `createClient`/`updateClient`, unmodified | Confirmed live: `services/notion/clients.js` wraps `pages.create`/`pages.update`/schema reads in `withRetry` from `services/retry.js`. The adapter calling `createCase()` inherits this transparently — correct, no new retry logic needed in the adapter itself. |
| Recovery | Plan does not propose adapter-level notification recovery (correctly — booking creation never sets `notificationStatus` beyond the existing `not_sent` default) | Confirmed: `buildSystemDefaults()` sets `notificationStatus: 'not_sent'` unconditionally on create; the M5 stale-`'sending'` recovery logic in `workflow-service.js` `executeSendCaseResult()` is only reachable once a case is closed and a send is attempted — entirely outside the Cal adapter's reach by construction |

**M5 impact verdict:** Plan correctly treats M5 as a floor to build on top of, not a layer to touch. The one open engineering task M5 does **not** already solve — durable dedupe — is correctly identified as new, additive work (Plan §6), not a retrofit of M5.

### 3.3 Notification

| Check | Plan's treatment | Verified against live code |
|---|---|---|
| `notificationStatus` ownership | Plan §5 "Explicit non-mapping": Cal booking status must not map to `caseWorkflowStatus`; Cal never sets `notificationStatus` | Confirmed live: the only writers of `notificationStatus` in the codebase are `buildSystemDefaults()` (initial `not_sent`) and `workflow-service.js`'s `executeSendCaseResult()`/`markCaseResultNotificationFailed()`. Neither is in the adapter's proposed call surface (`createCase`, `cancelAppointment`, appointment-field update). |
| Retry behavior | Not modified; adapter has no LINE-send responsibility | Confirmed — `line-notifications.js` is not listed anywhere in Plan §3's file table, correctly, since booking intake never sends a result notification |

**Notification impact verdict:** Zero impact by design; verified the adapter's proposed surface area has no path into this domain.

### 3.4 Customer Domain

| Check | Plan's treatment | Verified against live code |
|---|---|---|
| Dual-write | Plan §3 lists Customer Domain as untouched, flags stay OFF | **Nuance the Plan should state more precisely:** `dualWriteAfterCaseSuccess()` is called **unconditionally inside `createCase()` itself** (confirmed live at `services/case-creation-service.js` line ~155), not behind an adapter-level decision. This means the Cal adapter does not need to (and should not) call it separately — it fires automatically for every `createCase()` caller, Cal included, and is a guaranteed no-op while `CUSTOMER_DOMAIN_ENABLED`/`CUSTOMER_DOMAIN_DUAL_WRITE` are OFF (verified live in `services/customer-domain/flags.js` — both default `false`). The Plan's claim of "No Change" is **correct in outcome** but slightly underspecified in mechanism — it should say the hook fires automatically rather than implying it's simply absent from the Cal path. Not a blocker; a documentation precision note. |
| Identity linking | Plan does not propose any Cal→Customer identity logic | Confirmed no fuzzy-match or Customer-write logic anywhere in Plan §4/§5 |

### 3.5 Care

| Check | Plan's treatment | Verified against live code |
|---|---|---|
| Flags | Plan §1 scope explicitly excludes any Care flag change | Confirmed live: `CARE_LIFECYCLE_ENABLED`/`CARE_LIFECYCLE_SEND` both default `false` in `services/care-lifecycle/flags.js`, and neither is referenced anywhere in the Plan |
| SEND isolation | Plan proposes no Care invocation from the adapter | Confirmed live: `services/care-lifecycle/*` is required only by `services/config-validation.js` and its own `audit.js` — **not** by `case-creation-service.js`, `workflow-service.js`, or any `api/*-routes.js` file. Care is invoked exclusively via separate CLI scripts (`scripts/run-care-lifecycle.js` per `docs/PROJECT_STATE.md`), structurally unreachable from the booking path today, and the Plan does not propose changing that. |
| `notificationStatus` read-only claim | N/A to Plan directly, but relevant to the isolation guarantee it relies on | Confirmed live: `services/care-lifecycle/run.js` reads `job?.notification?.status` for before/after audit logging only — grep confirms zero `updateClient` calls touching `notificationStatus` anywhere under `services/care-lifecycle/` |

**Section 3 overall verdict:** every domain the Plan claims is unaffected is verifiably unaffected in the current source tree, not merely asserted.

---

## 4. Event Contract Review

### BOOKING_CREATED

| Check | Assessment |
|---|---|
| Required fields complete? | Plan §4/§5 lists name, email, start/end time, Cal booking uid, event type, signature. **Gap:** phone number's location in the payload is marked "to confirm" (§5) — acceptable, since Plan §Final Verdict already lists real payload capture as a blocking input, not something silently assumed. |
| Ordering problem? | Not directly applicable to CREATE (no prior state to conflict with) |
| Duplicate handling? | Plan §6 covers this — `calBookingId + eventType` primary key |
| Replay handling? | Plan §6 "Replay behavior" table explicitly covers CREATE replay → zero new Cases |

### BOOKING_CANCELLED

| Check | Assessment |
|---|---|
| Required fields complete? | Cal booking uid + signature — sufficient to resolve and act |
| Ordering problem? | **Identified and handled**: Plan §9 explicitly covers "CANCEL arrives before CREATE is processed" — no Case invented, logged as orphan for ops review. This matches DDR §8 failure #7 exactly. |
| Duplicate handling? | Plan §7 lifecycle table: cancel-on-already-cancelled is idempotent (inherits `cancelAppointment()`'s existing M3 idempotency) |
| Replay handling? | Plan §6 replay table covers CANCEL replay |

### BOOKING_RESCHEDULED

| Check | Assessment |
|---|---|
| Required fields complete? | Depends on `calBookingId` surviving reschedule — Plan correctly flags this as **unverified** (§5, §Final Verdict item 3) rather than assuming it |
| Ordering problem? | **Partially open**: Plan §7 flags reschedule-during-`in_progress` as "ops policy needed... open confirmation item" — this is the one place the Plan is honest about an unresolved lifecycle question rather than papering over it. See §9 of this review for risk framing. |
| Duplicate handling? | Covered by the same `calBookingId+eventType` dedupe key as CREATE/CANCEL |
| Replay handling? | Plan §6 replay table covers RESCHEDULE replay |

**Section 4 verdict:** all three event contracts are structurally sound. The one genuine open item (reschedule during `in_progress`) is **already surfaced by the Plan itself**, not a gap this review discovered independently — which is itself a good sign of the Plan's honesty about its own limits.

---

## 5. Data Ownership Review

| Field | Owner | Writer | Reader | Risk |
|---|---|---|---|---|
| `calBookingId` | Cal.com (native id); Case holds a **copy** for correlation | Adapter, once, at create time only (per DDR §3: "immutable" after write) | Adapter (cancel/reschedule lookup), ops/debug | Low — write-once field, no update path proposed, so no risk of drift once set |
| Webhook event/delivery id | Cal.com | Dedupe store only (never persisted on Case) | Adapter dedupe logic only | Low — scoped entirely to the new dedupe mechanism, isolated from Case schema |
| Customer name | Case (booking field) | `createCase()` (existing, unchanged) via adapter mapping | Case, Dashboard, Offer (indirectly via campaign), Customer dual-write (if flags ever on) | Low — same write path every other `createCase()` caller already uses |
| Phone | Case (booking field) | Same as name | Same as name | **Medium** — payload location unconfirmed (Plan §5 flags this); wrong mapping produces a Case with a missing/garbled phone, not a wrong-owner problem, but a data-quality one to catch in Phase 0/QA-CAL-06 |
| Email | Case (booking field) | Same as name | Same as name | Low |
| Appointment time | Case (ops SSOT after ingest, per DDR §6 ownership matrix) | `createCase()`/reschedule-update, via adapter | Case, Dashboard, workflow scheduling logic | **Medium** — timezone conversion risk explicitly named in Plan §5 ("must not silently shift the calendar day"); this is a correctness risk in the *mapping*, not an ownership risk, and is appropriately scoped to Phase 0 payload verification |
| Campaign / `launchOffer` | Offer (via Case's `campaignOffer` field — no new Offer store, per DDR §7) | `createCase()`, via adapter's event-type mapping | `water-check-offer-service.js` (M3, unchanged) | **Medium** — attribution mapping is a *product* input, not yet supplied; wrong mapping causes Offer over/under-count but does **not** break Offer's ownership model itself |
| Workflow state (`caseWorkflowStatus`) | Case only | `case-creation-service.js`/`workflow-service.js` only | Everything downstream | Low — Plan never proposes the adapter writing this directly; only `createCase`'s existing internal default and `cancelAppointment`'s existing internal write path touch it |
| `notificationStatus` | Case only | `workflow-service.js` only | Notification/LINE flow | **None** — confirmed structurally unreachable from the adapter's proposed surface (§3.3 above) |
| Care fields (audit, eligibility, outcomes) | Care domain only | `services/care-lifecycle/*` only, via separate CLI/cron | Care ops tooling | **None** — confirmed structurally unreachable (§3.5 above); Care isn't even in the same require-graph as the booking path today |

**Section 5 verdict:** no field in this table has an ownership ambiguity. The only real risks are **mapping-correctness** risks (phone location, timezone, campaign attribution), all of which the Plan already routes through Phase 0 verification and QA-CAL-06/09 rather than treating as solved.

---

## 6. Idempotency Review

| Question | Answer |
|---|---|
| Does M5's 30s TTL cover Cal's requirement? | **No**, and the Plan does not claim it does — Plan §6 states this explicitly with a comparison table, matching DDR §4's own conclusion word-for-word in substance. Verified live: `idempotency-store.js`'s `DEFAULT_TTL_MS = 30 * 1000` with a plain in-process `Map` — confirmed this cannot survive a Render restart, which is exactly the failure mode Cal redelivery needs covered. |
| Is the design's dedupe key clear? | **Yes, at the concept level required by this planning stage.** Primary: `calBookingId + eventType`. Secondary: webhook delivery/event id for exact-replay detection. This is a two-tier key, which is appropriate — the primary key protects against "Cal fully retried the whole booking flow," the secondary protects against "the exact same HTTP delivery arrived twice." |
| Is replay handled safely? | **Yes, at the policy level.** Plan §6's replay table (CREATE/CANCEL/RESCHEDULE) matches DDR §4's locked requirement exactly: replay of any event after a prior success must produce zero additional Case mutations. The Plan does not yet specify the storage mechanism (deliberately, per its own text: "does not select a specific store... that is an implementation-time decision") — which is correct scoping for a design document, not a gap. |
| Any design-level idempotency risk not yet named? | **One, worth naming:** the Plan's fallback suggestion — using a `calBookingId` lookup against Notion itself as a durable dedupe surface, avoiding a new store — introduces a **check-then-act race** if two webhook deliveries for the same new booking are processed concurrently by two request handlers before either has written the Case yet (a genuine possibility under retry storms, e.g. Cal redelivering while the first attempt is still in flight due to Notion latency). The Plan does not explicitly rule this race in or out; it is deferred to "implementation-time tradeoff." This is **appropriate for a design document** but should be a named acceptance criterion for whichever storage option is chosen in Phase 2 — i.e., Phase 2 must prove CAL-08 passes under concurrent (not just sequential) redelivery, not just restart-survival. |

**Section 6 verdict:** design is sound and appropriately unresolved at the implementation-choice level. One refinement recommended for Phase 2's QA criteria (concurrent redelivery, not just sequential restart-survival) — see §9.

**No code proposed in this section, per instruction.**

---

## 7. Lifecycle Review

| Event | Case State | Update allowed? | Guard correct? | Edge case? |
|---|---|---|---|---|
| Create | *(none)* | ✅ Yes | N/A | Duplicate `calBookingId` on create → correctly treated as idempotent no-op (Plan §7), not an error |
| Cancel | `scheduled` | ✅ Yes | Correct — matches DDR §5b Option A | None |
| Cancel | `in_progress` | ⚠️ Guarded (no auto-cancel) | **Correct per DDR §5b's explicit locked guard** ("If Case is already in_progress or closed, Adapter must not silently force-cancel") | Plan defers exact UX (reject vs. flag-and-no-op) to ops — acceptable, since the *guard itself* (don't silently cancel) is what DDR locks, not the HTTP status code used to express it |
| Cancel | `closed` | ⚠️ Guarded | Same as above | Same |
| Cancel | `cancelled` (already) | ✅ Idempotent no-op | Correct — inherits `cancelAppointment()`'s existing M3 behavior | None |
| Cancel | unknown `calBookingId` | ❌ Reject/alert, no Case invented | **Correct** — matches DDR §8 failure #7 exactly ("never invent a Case from cancel") | None |
| Reschedule | `scheduled` | ✅ Yes, update fields on same Case | Correct — matches DDR §5b Option A | None |
| Reschedule | `in_progress` | ⚠️ **Open question**, Plan defaults to "update fields, do not block" pending ops sign-off | **This is the one lifecycle cell without a locked guard in either the DDR or the Plan.** The DDR only explicitly guards *cancel* against `in_progress`/`closed` (§5a); it is silent on reschedule against `in_progress`. The Plan correctly notices this gap (§7) rather than inventing a guard unilaterally, but it also does not block on it — it proposes a default behavior ("update fields, do not block") that has not been ops-approved. | **This is a real open item, not a defect** — flagged as non-blocking-for-Phase-1/2 but **blocking for Phase 3** in the Plan's own sequencing (§12). Confirmed consistent with the Plan's own Final Verdict, which lists "ops sign-off on cancel/reschedule guard UX" as a required input. |
| Reschedule | `closed`/`cancelled` | ❌ Reject/ignore | Correct — Plan states this has "no valid ops meaning" | None |
| Reschedule | unknown `calBookingId` | ❌ No Case invented | Correct — same principle as cancel | None |

**Section 7 verdict:** 10 of 11 lifecycle cells have a locked, DDR-traceable guard. The one open cell (reschedule during `in_progress`) is **correctly self-identified by the Plan** and is already scoped as a Phase 3 gate, not silently shipped with an unapproved default. This is the single most important open item in this entire review — see Final Gate.

---

## 8. Security Review

| Area | Plan's coverage | Assessment |
|---|---|---|
| Webhook authentication | §8: HMAC signature over raw body, mirroring `verifyLineSignature`/`lineSignatureDebug` in `api/line-routes.js` | Sound precedent — verified live that the LINE pattern does timing-safe comparison (`crypto.timingSafeEqual`) over raw bytes before JSON parsing; Plan correctly proposes reusing this exact shape rather than inventing new verification logic |
| Secret handling | §8: new env var, read via `process.env.*`, quote-stripping pattern reused from `getLineChannelSecret()`/`normalizeLineChannelSecret()` | Sound — this reuses a pattern that (per this project's own history) already fixed a real prior LINE-secret parsing issue; proposing the same defensive parsing for the Cal secret is appropriate, not over-engineering |
| Replay protection | §8: explicitly states "signature validity alone is not sufficient... combine with durable dedupe" | **Correct and important** — this is the right security posture; a valid signature does not prove freshness, only authenticity |
| Payload validation | §8: reject 4xx on missing required fields before calling `createCase()`, mirroring `validateCustomerInput()` | Correct — reuses existing validation rather than introducing a second validation rule for the same constraint (`fullName` required) |
| Logging | §8: reuse `services/observability.js`, no raw secret/payload logging | Correct — matches the M5-established `logEvent`/correlation-id pattern; verified `observability.js` already supports structured, additive logging without altering existing console output |

**Gap check:** the Plan does not explicitly discuss **rate limiting** or **body-size caps** beyond a passing mention of "1MB ceiling already used elsewhere" — this is a minor omission worth naming (see §9), not a blocker, since it mirrors existing endpoints that also don't have dedicated rate limiting today (this is a pre-existing project-wide posture, not something the Cal adapter introduces as a new weakness).

---

## 9. Failure Scenario Review

| Scenario | Expected Behavior (Plan) | Risk | Covered? |
|---|---|---|---|
| Duplicate webhook | Zero new Cases; dedupe hit | Duplicate Case / double Offer burn if dedupe is weak | ✅ Covered (§6, §9 of Plan; CAL-02) |
| Delayed webhook | Apply if still valid; state-guarded against stale application | Dual Case if ops manually created a twin Case in the meantime | ✅ Covered as a named risk (Plan §9 "out-of-order event"), but the **resolution** for the twin-Case case is explicitly "ops review... no automatic reconciliation invented" — i.e., **covered as a detection/alerting responsibility, not a fully automated resolution.** This is an acceptable scope boundary, not a gap, provided ops actually has the alert to act on (see §12 gate). |
| Invalid signature | 401/403; zero mutation | Outage if secret misconfigured | ✅ Covered (§9, CAL-05) |
| Cal downtime | N/A to Portal directly — Cal is the publisher; Portal has nothing to do until Cal recovers and redelivers | Not applicable as a Portal-side failure mode | ✅ Implicitly covered — no gap, since the Plan's dedupe design already assumes Cal will retry after any outage on either side |
| Notion downtime | Non-success response; Cal retries; exactly one Case after recovery via dedupe | Lost booking if ack-before-write; duplicate if fail-after-write without dedupe | ✅ Covered (§9 of Plan; CAL-07), and correctly delegates transient-failure absorption to M5's existing `withRetry` before ever reaching the "give up and let Cal retry" branch |
| Partial create (e.g., Notion write succeeds but adapter crashes before ack) | Not explicitly named as its own row in Plan §9 | **This exact scenario is the strongest argument for durable dedupe being correct** — if the adapter crashes after `createCase()` succeeds but before marking the dedupe key as processed, Cal will redeliver, and the dedupe check must find the *already-created* Case (e.g., via the `calBookingId` Notion lookup path the Plan names as one option) rather than creating a second one. **The Plan's §6 fallback design (lookup-by-`calBookingId` before create) already handles this correctly if chosen**, but the Plan does not spell out this specific interleaving as an explicit scenario. Recommend naming it explicitly in Phase 2's test design (feeds into the same CAL-08 concurrent-redelivery recommendation from §6 of this review). | ⚠️ Implicitly covered by design, not explicitly named as a scenario — minor documentation gap, not an architecture gap |
| Out-of-order events | Timestamp + state guards; never un-cancel from a stale create; unknown-id cancel does not invent a Case | Wrong-state application | ✅ Covered (§9 of Plan, matches DDR §8 failure #3 exactly) |

**Section 9 verdict:** all DDR-mandated failure scenarios are covered. One scenario (partial-create-then-crash) is **correctly handled by the proposed design** but not **explicitly named** as its own row — a documentation completeness note, not a design flaw, since the mechanism that would handle it (durable dedupe keyed on `calBookingId`) is already the Plan's stated approach.

---

## 10. QA Coverage Review

| Scenario | Covered by Plan? | Missing? |
|---|---|---|
| CAL-01 Booking Created | ✅ Yes (§10) | — |
| CAL-02 Duplicate Event | ✅ Yes (§10) | — |
| CAL-03 Cancel | ✅ Yes (§10) | — |
| CAL-04 Reschedule | ✅ Yes (§10) | — |
| CAL-05 Invalid Signature | ✅ Yes (§10) — Security | — |
| CAL-06 Payload Missing | ✅ Yes (§10) | — |
| CAL-07 Notion Failure | ✅ Yes (§10) — Reliability | — |
| CAL-08 Replay Across Restart | ✅ Yes (§10) — Reliability, explicitly framed as "the test that actually proves the durable dedupe requirement is met" | **Recommend strengthening**: add a concurrent-redelivery variant (two simultaneous deliveries, not just sequential-after-restart) per §6/§9 of this review |
| CAL-09 Offer Attribution | ✅ Yes (§10) — Functional | — |
| CAL-10 Rollback | ✅ Yes (§10) — Rollback | — |
| Functional coverage | ✅ CAL-01, 03, 04, 09 | — |
| Security coverage | ✅ CAL-05; general payload validation via CAL-06 | Rate-limiting/body-size behavior not explicitly tested (matches §8's minor gap) |
| Reliability coverage | ✅ CAL-02, 07, 08 | Concurrent-redelivery variant recommended (above) |
| Rollback coverage | ✅ CAL-10 | — |
| **Required regression set** | ✅ Plan explicitly requires QA-B01–B04 and QA-O01–O03 from `docs/verification/04_QA_MATRIX.md` alongside CAL-01…10 | Confirmed these rows exist in the live QA matrix (verified: `04_QA_MATRIX.md` contains QA-B01–B04 and QA-O01–O03 exactly as referenced) |

**Section 10 verdict:** QA coverage is comprehensive against the DDR's 10 required scenarios. Two refinements recommended (concurrent-redelivery variant of CAL-08; explicit rate-limit/body-size test) — both **non-blocking enhancements**, not missing coverage of a required scenario.

---

## 11. Rollback Review

| Question | Answer (from Plan §11, verified for consistency with live architecture) |
|---|---|
| ปิดตรงไหน (where to disable) | Two-sided: (1) Cal.com dashboard webhook subscription off, (2) adapter route disabled/unregistered in Portal. Plan correctly notes this must be two-sided, not reliant on Cal.com cooperation alone. |
| ระบบเดิมยังทำงานได้ไหม (does the existing system keep working)? | **Yes, verifiably** — every existing intake path (`POST /api/cases` direct callers, Manual Create dashboard flow) is structurally independent of whether `api/cal-routes.js` exists or is registered, since the adapter is a new caller of unmodified functions, not a modification of the functions themselves. This is the direct payoff of the "No Change" file list in §3. |
| Case data เสียไหม (is Case data lost)? | **No** — Cases already created from Cal bookings before rollback remain valid, ordinary Cases; nothing about disabling intake retroactively invalidates them (correctly stated in Plan §11 point 2). |
| Offer counter เสียไหม (is the Offer counter broken)? | **No** — `water-check-offer-service.js` counts whatever Cases exist at any given time with no adapter-awareness baked in; rollback requires zero Offer-side action (correctly stated in Plan §11 point 3). |

**Section 11 verdict:** rollback plan is sound and consistent with the "adapter is purely additive" architecture established in §1–§3 of this review. No gap found.

---

## 12. Final Gate

### Verdict: **NOT READY (conditionally) — one blocking item, remainder are non-blocking preconditions already correctly identified by the Plan itself**

This is deliberately not a flat "NOT READY" without qualification: the Plan is architecturally sound, DDR-compliant in every dimension checked in §1–§11, and already self-identifies almost all of its own open items rather than hiding them. The gate below separates what **blocks starting Phase 0/1 coding** from what the Plan already correctly scoped as **later-phase gates**.

### Blocking Items (must resolve before Phase 1 coding begins)

| # | Item | Why it blocks | Source |
|---|---|---|---|
| 1 | **Real Cal.com webhook payload samples** (create/cancel/reschedule) not yet captured | Every field mapping in Plan §5 is marked "to confirm" against real data — coding a mapper against assumed field paths risks building against a schema that doesn't match production, which is exactly the class of error M4's earlier audit (this project's history) flagged when it found unverified assumptions baked into code | Plan §Final Verdict, DDR §7.4 non-blocking-confirmations list, this review §4 |
| 2 | **Notion schema approval for `calBookingId` property** not yet granted | Phase 0 itself requires this; without it there is no durable correlation key to design the dedupe store against | Plan §12 Phase 0, this review §2 |
| 3 | **Product sign-off on Cal event type → `launchOffer`/campaign mapping** not yet given | Required for CAL-09 to be meaningfully testable and for M3 Offer correctness post-launch — coding without this risks a correct-code, wrong-data Offer miscount that would look like a *bug* but is actually a *missing input* | Plan §Final Verdict, this review §3.1 |

**None of these three are architecture defects.** They are the exact "required inputs before coding begins" the Plan itself already lists in its Final Verdict section — this review independently confirms they are correctly identified as blocking, not optional.

### Non-blocking preconditions (must resolve before the phase that needs them, not before Phase 0/1 starts)

| # | Item | Needed by |
|---|---|---|
| 4 | Ops sign-off on cancel-guard UX (reject vs. flag-and-no-op) for `in_progress`/`closed` | Phase 3 (Plan already sequences this correctly) |
| 5 | Ops decision on reschedule-during-`in_progress` (the one lifecycle cell without a locked guard — this review §7) | Phase 3 |
| 6 | Storage choice for durable dedupe (§6 of this review notes the concurrent-redelivery race as an acceptance criterion to add) | Phase 2 |
| 7 | Confirmation that `calBookingId` survives Cal-native reschedule | Phase 3 (blocks CAL-04 specifically) |

### Minor documentation refinements (non-blocking, quality-of-plan only)

- Plan §3's `config/env.js` "Modify" row is likely unnecessary given the live LINE-secret precedent reads `process.env.*` directly in its own service file — worth simplifying at implementation time, not a correctness issue.
- Plan §3's Customer Domain "No Change" characterization is correct in outcome but should note the dual-write hook fires automatically and unconditionally inside `createCase()` (this review §3.4) rather than implying it's simply absent from the Cal path.
- CAL-08 (replay across restart) should be extended with a concurrent-redelivery variant, not just sequential-after-restart (this review §6, §9, §10).
- A rate-limit/body-size test is not explicitly present in the QA mapping (this review §8, §10) — minor.

### Explicit confirmation of the review's core question

**Is Cal.com still merely an entry gate, and does Case still own the entire system, in this Plan?**

**Yes, unambiguously.** Every domain boundary check in §1, every field ownership check in §5, and every "structurally unreachable" verification in §3.3/§3.5 (done against live source, not just the Plan's prose) confirms: the Plan's only write surface into the system is the same two existing functions (`createCase`, `cancelAppointment`) plus one new appointment-field update path, all of which are Case-domain-owned and unmodified by this work. No ownership transfer, no new SSOT, no Care/Notification leakage was found anywhere in the Plan.

---

## Summary for sign-off

| Gate | Result |
|---|---|
| Architecture compliance (§1) | ✅ Pass |
| File impact / core-flow touch (§2) | ✅ Pass (minor scoping note on `config/env.js`) |
| M3/M5/Notification/Customer/Care impact (§3) | ✅ Pass on all five, verified against live code |
| Event contracts (§4) | ✅ Pass (one self-identified open item, correctly gated to Phase 3) |
| Data ownership (§5) | ✅ Pass |
| Idempotency design (§6) | ✅ Pass (one refinement recommended for Phase 2 QA) |
| Lifecycle rules (§7) | ⚠️ 10/11 cells locked; 1 cell (reschedule during in_progress) correctly flagged as open, not silently defaulted |
| Security (§8) | ✅ Pass (minor rate-limit note) |
| Failure scenarios (§9) | ✅ Pass |
| QA coverage (§10) | ✅ Pass (two enhancement recommendations) |
| Rollback (§11) | ✅ Pass |
| **Overall** | **NOT READY — 3 blocking inputs required (real payloads, schema approval, Offer-mapping sign-off); zero architecture redesign required** |

**No code, patch, webhook, migration, or flag change was made by this review.**
