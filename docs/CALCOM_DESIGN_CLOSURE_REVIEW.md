# Cal.com Booking Integration — Design Closure Review

**Document type:** Design Closure Review (implementation approval gate)
**Mode:** Architecture Review Only — **no code, no patch, no flags, no deploy, no real webhook**
**Date:** 2026-08-05
**Reviewer role:** Principal Engineer + Architecture Reviewer
**Inputs reviewed:** [`CALCOM_BOOKING_INTEGRATION_DESIGN_DECISION_RECORD.md`](./CALCOM_BOOKING_INTEGRATION_DESIGN_DECISION_RECORD.md) (DDR), [`CALCOM_IMPLEMENTATION_PLAN.md`](./CALCOM_IMPLEMENTATION_PLAN.md) (Plan), [`CALCOM_PRE_IMPLEMENTATION_REVIEW.md`](./CALCOM_PRE_IMPLEMENTATION_REVIEW.md) (Prior Review), [`verification/01_AS_BUILT_ARCHITECTURE.md`](./verification/01_AS_BUILT_ARCHITECTURE.md), [`verification/04_QA_MATRIX.md`](./verification/04_QA_MATRIX.md), plus live source re-verification of `services/case-creation-service.js`, `services/workflow-service.js`, `services/water-check-offer-service.js`, `services/idempotency-store.js`, `services/notion/mapper.js`

**Purpose:** consolidate every prior Cal.com review into one closure gate. This document does not re-derive conclusions already proven in the Pre-Implementation Review — it re-verifies them against current source and adds the specific analyses this closure asked for that the prior documents did not fully cover (concurrent-delivery, long-delay retry, race conditions, and a corrected lifecycle state list — see §2).

---

## 1. Boundary Verification

### Does Cal.com become an owner of Case lifecycle?

**No.** Verified three independent ways:

1. **Call-surface check (live code):** the only Case-domain entry points any Cal adapter design has ever proposed calling are `createCase()`, `cancelAppointment()` (both `services/case-creation-service.js`), and an appointment-field `updateClient()` call for reschedule. None of these functions are modified by any reviewed document — all three prior reviews list them "No Change." A caller that never gains write access to `caseWorkflowStatus` transition logic, `notificationStatus`, or Care fields cannot become an owner of any of them by construction.
2. **Require-graph check (live code):** `services/care-lifecycle/*` is required only by `services/config-validation.js` and its own `audit.js` — not by `case-creation-service.js`, `workflow-service.js`, or any `api/*-routes.js`. No Cal.com design document proposes changing this. Care remains structurally unreachable from any booking path, Cal-origin or not.
3. **Field-write check:** the only field Cal.com uniquely contributes is `calBookingId` — a **correlation key**, not an operational field. Nothing about knowing a Cal booking id lets Cal.com influence workflow, notification, or offer state; those all continue to be driven entirely by Case-side logic that has no awareness `calBookingId` exists as anything other than an opaque string.

### Is Case still SSOT after ingest?

**Yes.** Once `createCase()` runs (regardless of caller — Manual, direct API, or future Cal adapter), the resulting row is an ordinary Case: same Notion page, same `notionPageToJob()` mapper, same read path for Dashboard/Offer/Workflow/Care-eligibility. There is no second copy of booking truth anywhere in the design — Cal.com's own booking record remains in Cal.com's database as intake history, never read back into Portal logic after the initial ingest call.

### Field ownership — what Cal.com may / may not hold

| Field | Cal.com may hold (its own native record)? | Cal.com may **write into Case**? |
|---|---|---|
| `calBookingId` | Yes — native to Cal | Once, at create, immutable after |
| Cal booking/appointment status (Cal's own UI state) | Yes | **No** — never mapped 1:1 to `caseWorkflowStatus` |
| Attendee name/email/phone as submitted to Cal | Yes | Yes, at create, into Case booking fields only |
| Appointment start/end time | Yes (Cal calendar) | Yes, at create/reschedule — but **Case is ops SSOT after ingest**; if Cal and Case diverge later, Case wins for ops purposes |
| Event type / campaign signal | Yes | Indirectly, via adapter mapping to `launchOffer`/`campaignOffer` — Cal never writes a `campaignOffer` string directly; the adapter translates |
| `workflow status` (`caseWorkflowStatus`) | No — not a Cal concept | **Forbidden** |
| `notificationStatus` | No — not a Cal concept | **Forbidden** |
| Care fields (eligibility, audit, outcome) | No — not a Cal concept | **Forbidden**, and structurally unreachable per the require-graph check above |
| Customer identity (`customerId`) | No | **Forbidden** — any Customer sync happens via the existing `dualWriteAfterCaseSuccess()` hook inside `createCase()` itself, which is flag-gated and identical for every caller; Cal gets no special or additional identity-writing path |

**Verdict §1:** Boundary holds. No document reviewed, at any layer (DDR → Plan → Pre-Implementation Review → this closure), proposes or permits Cal.com to become an owner of anything beyond its own native booking record plus a copy of its own id on the Case.

---

## 2. Lifecycle Review

### Correction to the requested state list

The state list given for this review — `scheduled, confirmed, in_progress, closed, cancelled` — does not match the live system. Verified by grepping every `caseWorkflowStatus` write in the current codebase:

| Requested state | Actually exists in code? |
|---|---|
| `scheduled` | ✅ Yes — set by `buildSystemDefaults()` at create |
| `confirmed` | ❌ **Does not exist anywhere in the codebase.** No function reads or writes this value. |
| `in_progress` | ✅ Yes — set by `startCase()` and by `createCase({ startOnSite: true })` |
| `closed` | ❌ **Never written anywhere** (already flagged as dead in M4's audit and M5's implementation report — `WORKFLOW_STATES` array lists it, `startCase()`'s terminal guard checks for it, but no code path ever sets it) |
| `cancelled` | ✅ Yes — set by `cancelAppointment()` |
| *(not requested, but real)* `completed` | ✅ Yes — set by `closeCase()` |
| *(not requested, but real)* `result_sent` | ✅ Yes — set by `executeSendCaseResult()` on successful notify |
| *(not requested, but real)* `feedback_submitted` | ✅ Yes — set by `recordFeedback()` |

This review evaluates lifecycle correctness against the **real** state set (`scheduled`, `in_progress`, `completed`, `cancelled`, `result_sent`, `feedback_submitted`), not the requested-but-fictional one, per this document's own rule against altering architecture — inventing a `confirmed` state or treating `closed` as reachable would itself be an undocumented architecture change.

### BOOKING_CREATED

```
Cal → Adapter → createCase() → Notion (Case row, caseWorkflowStatus='scheduled') → Offer (used+1 if launchOffer) → Workflow (dormant until start/close)
```

Verified against live code: `buildSystemDefaults()` unconditionally sets `caseWorkflowStatus: 'scheduled'`, `notificationStatus: 'not_sent'`. Offer impact is conditional and correct: `invalidateOfferCache()` fires only `if (campaignOffer)` inside `createCase()` — a Cal booking without `launchOffer`/`campaignOffer` has zero Offer-side effect, exactly as any other non-launch `createCase()` call today.

### BOOKING_CANCELLED

```
Cal → Adapter → resolve Case by calBookingId → cancelAppointment(caseId) → guard check → cancel or no-op
```

| Case state at cancel time | Allowed transition? |
|---|---|
| `scheduled` | ✅ → `cancelled` |
| `in_progress` | ⚠️ Guarded — DDR §5a locks "must not silently force-cancel"; exact UX (reject vs. flag) still open, correctly scoped to Phase 3 |
| `completed` | ⚠️ Same guard applies — "closed" in DDR's language maps to the real `completed`/`result_sent`/`feedback_submitted` terminal states, not a literal `closed` value that doesn't exist |
| `cancelled` (already) | ✅ Idempotent no-op — verified live: `cancelAppointment()` checks `isCancelledJob(job)` before writing anything |
| unknown `calBookingId` | ❌ No Case invented — log + alert only |

### BOOKING_RESCHEDULED

```
Cal → Adapter → resolve Case by calBookingId → update appointmentDate/appointmentStart/appointmentEnd on same Case
```

| Case state at reschedule time | Allowed transition? |
|---|---|
| `scheduled` | ✅ Update fields, no state change |
| `in_progress` | ⚠️ **Still the one open cell** — neither the DDR nor the Plan locks a guard here (DDR §5a only guards *cancel* against `in_progress`/`closed`). The Pre-Implementation Review (§7) already flagged this as the single most important open lifecycle item. This closure review confirms it remains open and unresolved as of this document — **no new information changes that status.** |
| `completed`/`result_sent`/`feedback_submitted` | ❌ Reject/ignore — "no valid ops meaning" per Plan §7 |
| unknown `calBookingId` | ❌ No Case invented |

**Verdict §2:** Lifecycle design is sound and DDR-traceable for 5 of 6 non-trivial transition cells (cancel × 3 real states + unknown-id cases). The reschedule-during-`in_progress` cell remains genuinely open — not newly discovered here, but re-confirmed as still unresolved, and it is the correct thing to gate Phase 3 on rather than paper over with an assumed default.

---

## 3. Data Ownership Review

| Data | Owner | Cal Write | Case Write | Notes |
|---|---|---|---|---|
| `calBookingId` | Cal.com (native); Case holds correlation copy | Yes (native) | Once, at create, immutable | New Notion property — not yet added (confirmed: `FIELD_ALIASES` in `services/notion/mapper.js` has no `calBookingId` entry today) |
| `eventId` (webhook delivery/event id) | Cal.com | Yes (native, per delivery) | **Never persisted on Case** — used only inside the dedupe mechanism, a layer entirely outside the Case schema | Prevents dedupe plumbing from leaking into the Case's operational data model |
| Appointment date/time | Case (ops SSOT after ingest) | Cal has its own calendar copy | Yes, at create/reschedule | Case wins for ops purposes if the two ever diverge post-ingest — locked in DDR §6 ownership matrix, unchanged by this closure |
| Customer info (name/phone/email) | Case (booking fields) | Cal has attendee-submitted copy | Yes, at create, via existing `createCase()` validation/mapping | Same write path as every existing caller — no new validation rule introduced for Cal specifically |
| Campaign/offer | Offer, derived from Case's `campaignOffer` (M3, unchanged) | No — Cal only signals event type; adapter translates | Yes, at create, via `options.launchOffer`/`options.campaignOffer` passed into unmodified `createCase()` | No new Offer store; verified live that `water-check-offer-service.js` counts Cases exactly as before, caller-agnostic |
| `notificationStatus` | Case (`workflow-service.js` only) | **No** | Only by `workflow-service.js`'s existing functions | Confirmed unreachable from any Cal-adapter call surface across all three prior reviews |
| Workflow status (`caseWorkflowStatus`) | Case only | **No** | Only by `case-creation-service.js`/`workflow-service.js` existing functions | Cal booking/appointment status never maps 1:1 — locked DDR rule, re-confirmed here |
| Care fields (eligibility, audit, outcome) | Care domain only | **No** | Only by `services/care-lifecycle/*`, via separate CLI/cron | Structurally unreachable — confirmed via require-graph in §1 |

**Verdict §3:** No ownership ambiguity found. Every row with a "No" in the Cal-write columns is enforced structurally (unreachable code path), not merely by convention or documentation promise.

---

## 4. Idempotency Review

### Is M5's existing idempotency sufficient?

**No — re-confirmed.** Live-verified: `services/idempotency-store.js` uses `DEFAULT_TTL_MS = 30 * 1000` (30 seconds) on a plain in-process `Map`, with entries swept on read (`sweepExpired`) and no persistence layer. This was built for one narrow case — a client double-clicking "Book Now" within the same request burst on the same running process — and is correct and sufficient **for that case only**.

### Where is durable dedupe actually necessary?

| Requirement | Why M5's 30s TTL cannot cover it |
|---|---|
| Cal.com redelivers a failed webhook minutes to hours later | Entry has long since been swept from the `Map` |
| Render process restarts between original delivery and a retry | In-memory `Map` is gone entirely — a restart is not a slow sweep, it's a hard reset to empty |
| An operator manually re-triggers a webhook from the Cal.com dashboard days later | Same as above — no realistic in-memory TTL value bridges "days" without becoming a memory-growth liability of its own |

### What happens on a duplicate webhook event today, if no Cal adapter dedupe existed?

Two full, independent `createCase()` calls with the same customer/booking data → two Notion pages, two report/feedback token pairs, and (if `launchOffer` is set) the Offer counter's `used` value incremented twice for one real booking — this is the exact failure mode M4's original audit (`api/case-flow-routes.js` direct-API path) already documented for double-clicks, and Cal webhook redelivery is architecturally the same failure class at a longer time horizon.

### What happens on a retry after 24 hours, specifically?

- **Without durable dedupe:** identical to "duplicate webhook" above — a second Case is created 24 hours later with no memory of the first, since the in-memory `Map` and even the process itself will very likely have cycled by then on Render's free-tier deployment pattern (already noted as a real operational characteristic in this project's own M3 audit history, not a new assumption).
- **With durable dedupe as designed (Plan §6):** the dedupe key (`calBookingId + eventType`, or the `calBookingId`-lookup-against-Notion fallback) is checked before any `createCase()` call. A 24-hour-old retry finds the existing Case (created 24 hours prior) and returns that outcome instead of creating a second one — correct behavior, provided the dedupe key's effective retention genuinely exceeds Cal's real retry horizon (Plan §6 leaves the exact retention "ops-defined," which is the one number this review recommends be nailed down as an explicit config value before Phase 2, not left implicit).

### Scenario table

| Scenario | Expected Behavior | Risk |
|---|---|---|
| Duplicate webhook, same process, within seconds | M5's 30s TTL alone would already catch this if the Cal adapter reused it — but the Plan correctly does **not** rely on this; durable dedupe catches it too | Low — double-covered |
| Duplicate webhook, same process, 5 minutes later | M5 TTL has expired; **durable dedupe is the only protection** | **High if durable dedupe is skipped or scoped too narrowly** |
| Duplicate webhook, after a process restart | In-memory state (both M5's store and any naive in-adapter cache) is gone; **only a persistence-backed dedupe (or the Notion-lookup fallback) catches this** | **High** — this is exactly what QA-CAL-08 must prove |
| Duplicate webhook, two deliveries processed **concurrently** (not sequentially) | A check-then-act race: both requests could pass a "does a Case exist for this `calBookingId`?" read before either has written the Case | **Medium-High, and not yet explicitly closed by any reviewed document** — flagged in the Pre-Implementation Review §6 as a named risk deferred to Phase 2 implementation choice; still open at this closure point, see §8 |
| Retry after 24+ hours | Same as "after a process restart" in practice, given this deployment's operational profile | **High if retention window is left implicit rather than an explicit, deliberately-chosen value** |
| Cancel event redelivered after the Case is already cancelled | Idempotent no-op — inherits `cancelAppointment()`'s existing M3 guard regardless of webhook-level dedupe | Low |
| Reschedule event redelivered with identical new times | Idempotent in effect (same field values written twice is harmless), but should still be dedupe-gated to avoid redundant Notion writes and log noise | Low |

**Verdict §4:** Durable dedupe is necessary and correctly identified as necessary by every document reviewed. The **specific, still-open gap** is the concurrent-delivery race — real and named, but not yet closed by a chosen mechanism. This is the second load-bearing open item for this closure gate (alongside the reschedule/`in_progress` lifecycle gap from §2).

---

## 5. Mapping Review

```
Cal Event Type (id/slug)
  ↓
Adapter mapping table (new, config-level — not a new domain, per DDR §7)
  ↓
options.launchOffer:true  |  options.campaignOffer:"<existing campaign name>"
  ↓
createCase(payload, options)   ← existing function, unmodified
  ↓
Offer counts Case as used/not-used, exactly as any other campaign-tagged Case
```

### Mapping ที่ล็อกแล้ว (locked)

| Decision | Locked by |
|---|---|
| Cal event type is the **primary discriminator** for Offer attribution (not name/phone matching, not a metadata blob) | DDR §7 |
| No new Offer store, no `campaignId`/`launchOfferId` Portal concept invented | DDR §7 |
| Any `campaignOffer` string used must match an **existing** campaign name already known to `water-check-offer-service.js` | DDR §7, re-confirmed live: the only campaign-name source is `WATER_CHECK_CAMPAIGN_OFFER` env var, read identically by both `case-creation-service.js` and `water-check-offer-service.js` — no second naming authority exists to accidentally diverge from |
| `createCase()` itself requires zero modification to accept this mapping — `options.launchOffer`/`options.campaignOffer` are already its accepted parameters today (verified live: this is the same code path `body.launchOffer === true` from `api/case-flow-routes.js` already exercises for non-Cal callers) | Confirmed live in `services/case-creation-service.js` `resolveCampaignOffer()` |

### Mapping ที่ยังต้อง Product approve

| Item | Status |
|---|---|
| Which specific Cal.com event type id/slug(s) correspond to "Free Water Check" / the current Launch Offer | **Not yet supplied** — blocking, per every prior document's Final Verdict/Gate section |
| Whether any *other* Cal.com event type (e.g., a paid full assessment) should map to a *different* named campaign, or to no campaign at all | **Not yet supplied** — absence of a decision here defaults safely to "no campaign, no Offer impact," which is the safe default direction (under-attribution, not over-attribution), but should still be an explicit Product answer rather than an assumed default |

**Verdict §5:** The mapping **mechanism** is fully locked and requires no new architecture. The mapping **values** (which event type = which campaign) are a pure data/config input still pending Product — this was already true in every prior document and remains true here; this closure adds no new mapping risk, it only re-confirms the mechanism is sound enough that Product's answer is a config change, not a code change.

---

## 6. Failure Scenario Review

| Scenario | Expected | Risk | Owner |
|---|---|---|---|
| Cal webhook timeout (Portal too slow to respond within Cal's timeout window) | Cal.com treats as failed delivery, retries later per its own schedule | Low if durable dedupe is in place; **High if not**, since a slow-but-eventually-successful first attempt plus a retry both landing would double-create | Adapter (dedupe) + Case write path (M5 `withRetry`, unmodified, absorbs the Notion-side portion of the slowness) |
| Invalid signature | Reject (401/403), zero Case mutation | Outage risk only if the secret itself is misconfigured — not an architecture risk | Security/Adapter |
| Duplicate delivery (any cause — Cal-side retry policy, manual resend, network duplication) | Zero additional Cases/mutations; dedupe hit | **High without durable dedupe; Low with it** — this is the central risk this entire integration exists to solve correctly | Adapter dedupe store |
| Notion down during create | Non-success response so Cal retries; M5's `withRetry` already absorbs transient 429/5xx before the adapter even needs to react; a hard/prolonged outage surfaces as a clean failure, not a silent partial write | Low-Medium — bounded by M5's existing retry ceiling, unmodified | Case/Notion write path (M5) |
| `createCase()` succeeds but the HTTP response back to Cal.com fails (network drop, process crash after Notion write, before ack) | Cal.com sees this as a failed delivery and retries; the retry **must** hit the dedupe check and find the already-created Case | **This is precisely the scenario durable dedupe (keyed on `calBookingId`, checked before create) is designed to solve** — correctly covered by design, contingent on Phase 2 actually implementing the check-before-create ordering rather than a fire-and-forget create | Adapter (dedupe ordering) + Case write path |
| Cancel after Case is already closed (i.e., `completed`/`result_sent`/`feedback_submitted` in the real state model — see §2's correction) | Guarded — do not silently force-cancel a Case whose service already happened | Medium — exact UX (reject vs. flag-and-alert) still an open Phase 3 ops decision, but the **principle** (don't silently cancel) is locked by DDR §5a | Case cancel policy + Ops |
| Reschedule after workflow has started (`in_progress`) | **Still genuinely undecided** — see §2; Plan's provisional default is "update fields, do not block," not yet ops-approved | **Medium-High** — this is the scenario most likely to produce a confusing real-world outcome (a customer's Cal-side reschedule silently changing the appointment time on a Case a technician is already mid-service on) if shipped with the unapproved default rather than a deliberate one | Product + Ops decision required, per Plan §7's own framing |

**Verdict §6:** Five of seven scenarios have a locked, safe expected behavior. Two (concurrent/duplicate-after-partial-success, and reschedule-during-`in_progress`) are correctly identified as depending on Phase 2/Phase 3 decisions not yet made — consistent with, not contradicting, the Pre-Implementation Review's findings.

---

## 7. QA Design — QA-CAL-01 to QA-CAL-10 (revised for this closure)

This closure review **extends** the QA-CAL set from the Implementation Plan and Pre-Implementation Review with the specific additional coverage this review's terms of reference required (concurrent delivery, long-delay retry, cancel/reschedule race, idempotency persistence) — folded into the existing 10 IDs rather than creating a parallel numbering scheme, since the DDR fixes "QA-CAL-01…10" as the canonical set size.

| ID | Scenario | Expected | Risk if uncovered |
|---|---|---|---|
| CAL-01 | Booking Created (valid signed webhook) | One Case; tokens set; `notificationStatus=not_sent`; visible via `GET /api/clients` | Mapping bugs produce incomplete Cases |
| CAL-02 | Duplicate Event (same delivery replayed immediately) | Zero second Case; Offer unchanged | Double offer burn |
| CAL-03 | Cancel | Case → `cancelled`; Offer `remaining` +1 if was launch; Dashboard hides cancelled Case | Cancel-after-service-start if guard is wrong |
| CAL-04 | Reschedule | Same Case id; new times; Offer unchanged | Accidental second Case if `calBookingId` doesn't survive Cal-native reschedule |
| CAL-05 | Invalid Signature | Rejected; zero Case mutation | Secret-rotation outage if verification logic itself is broken (not just misconfigured) |
| CAL-06 | Payload Missing Required Field | Create rejected; no partial Case | Silent Case creation with garbled/missing customer data |
| CAL-07 | Notion Failure on Create | Non-success; Cal retries; exactly one Case after recovery | Lost or duplicated booking depending on ack timing |
| CAL-08 | **Replay across process restart AND concurrent redelivery (both variants required)** | Restart variant: same outcome as CAL-02 after a full process restart between attempts. **Concurrent variant (new emphasis this closure adds):** two simultaneous deliveries for the same `calBookingId` must still yield exactly one Case — this is the check-then-act race named in §4/§6 and must be proven, not assumed, before Phase 2 closes | **This is the single highest-value test in the entire matrix** — it is the only test that actually proves durable dedupe works under real-world webhook conditions rather than the easy sequential case |
| CAL-09 | Offer Attribution | Free Water Check Cal event type → `launchOffer:true` → `used`/`remaining` move correctly; non-launch event type does not move them | Wrong campaign mapping causes silent Offer miscount that looks like a code bug but is a data/config gap |
| CAL-10 | Rollback | Cal intake disabled (webhook + adapter route) → zero new Cases from Cal; all existing Cases and Offer counts intact | Confusion during a partial cutover if rollback isn't actually two-sided (Cal-side and Portal-side) |

### Additional scenarios this closure specifically requires beyond the original 10 (folded into the table above, named explicitly per the terms of reference)

| Requirement from this closure's brief | Where it lands |
|---|---|
| Concurrent webhook delivery | CAL-08 (concurrent variant) |
| Retry after long delay (24h+) | CAL-08 (restart variant) + §4's 24-hour scenario analysis |
| Cancel/reschedule race condition (e.g., a cancel and a reschedule for the same booking arriving close together, or reschedule arriving while workflow has started) | CAL-04 (must include an out-of-order variant: reschedule delivered after a cancel for the same `calBookingId`) + CAL-03 (must include the `in_progress` guard case) |
| Idempotency persistence (survives restart, not just in-process) | CAL-08 (restart variant) — this is the literal definition of "persistence" being tested, not a separate ID |

**Required regression set, unchanged from prior documents:** QA-B01–B04, QA-O01–O03 from `docs/verification/04_QA_MATRIX.md` (confirmed still present in that file).

---

## 8. Implementation Gate

### READY (locked, no further decision needed)

- Cal.com = External Intake Channel only, never Domain/SSOT — locked at DDR level, re-verified structurally in §1 of this closure
- Case remains Ops SSOT after ingest — re-verified against live `createCase()`/`cancelAppointment()` contracts, unmodified
- Adapter's only write surface = `createCase()`, `cancelAppointment()`, one appointment-field update — no new Case-domain functions needed
- Offer, Notification, Customer, Care ownership all unaffected by construction — verified via require-graph and field-write analysis, not just prose assertion
- `calBookingId` as sole correlation key, exact-match only, no fuzzy merge — locked at DDR level
- Cal booking/appointment status never maps 1:1 to `caseWorkflowStatus` — locked
- No auto-backfill in v1 — locked
- M3 Offer math and M5 booking hardening (idempotency/retry/notify-recovery) require zero modification — re-verified against live source in this and the prior review
- Mapping **mechanism** (event type → `options.launchOffer`/`campaignOffer` → unmodified `createCase()`) is architecturally complete

### BLOCKED (must be resolved before coding starts, i.e., before Phase 0/1)

| # | Item | Blocks |
|---|---|---|
| 1 | Real Cal.com webhook payload samples (create/cancel/reschedule) | All field mapping (§5 of the Plan; this review adds no new mapping risk but confirms none of it can be frozen without this) |
| 2 | Notion schema approval + property creation for `calBookingId` | Phase 0 itself; also blocks any dedupe design that uses a Notion-lookup fallback |
| 3 | Product sign-off on Cal event type → `launchOffer`/campaign mapping values | CAL-09 meaningfulness; Offer correctness at go-live |
| 4 | **Explicit decision on the concurrent-delivery dedupe mechanism** (not just "durable," but specifically race-safe under simultaneous requests) | Phase 2 close-out; CAL-08 concurrent variant cannot pass without this being a deliberate design choice, not an assumption |
| 5 | **Ops/Product decision on reschedule-during-`in_progress`** | Phase 3 close-out; this is the one lifecycle cell with no locked guard anywhere in the DDR |

### UNKNOWN (must be proven against real Cal.com behavior, not decided by architecture)

| # | Item | Why it can't be resolved on paper |
|---|---|---|
| 1 | Whether `calBookingId` is stable across a Cal-native reschedule | Only Cal.com's actual API behavior can answer this — DDR §5 already flags this as "must be verified against real payloads at implement time" |
| 2 | Cal.com's actual webhook retry schedule/horizon (minutes? hours? days?) | Determines the *minimum* required retention for the durable dedupe store — currently "ops-defined" with no concrete number because the real upstream behavior hasn't been observed |
| 3 | Exact signature header name/algorithm version | Must be read from Cal.com's current webhook documentation or a live test payload, not assumed |
| 4 | Whether Cal.com can, in practice, deliver two webhooks for the same event close enough together to trigger the concurrent-delivery race in §4/§6 | Theoretically possible in any webhook system; whether Cal.com's specific infrastructure makes this a realistic-frequency event or a rare edge case affects how much engineering effort CAL-08's concurrent variant deserves — still worth building correctly regardless, but the *urgency* is unknown until observed |

### Final Verdict

## **B — READY WITH CONDITIONS**

**Rationale:** Every architecture-level question this closure was asked to verify — boundary integrity, ownership, lifecycle guard correctness, data ownership, mapping mechanism soundness — checks out clean against live source, not just against prior documents' prose. This is not a "start over" or "redesign" verdict.

It is not a flat **A (READY FOR IMPLEMENTATION)** because five concrete items remain genuinely unresolved (three data/config inputs already known from prior documents, plus two design decisions this closure specifically sharpened: the concurrent-delivery dedupe mechanism, and the reschedule-during-`in_progress` guard). None of these five require touching Case, Offer, Notification, Customer, or Care architecture — they are Adapter-layer decisions and external inputs, which is exactly the shape of "conditions," not "blockers to the design itself."

It is not **C (NOT READY)** because there is no remaining architecture ambiguity, no ownership leak, and no unresolved boundary question — every prior review's compliance table and this closure's independent re-verification agree on that point.

**Conditions for upgrading to A:** resolve BLOCKED items 1–5 above. Items 1–3 are inputs (payload samples, schema approval, product sign-off) that were already known; items 4–5 are the two design decisions this closure review adds precision to. No new architecture review should be required once these five are resolved — a short confirmation note appended to this document (or a v2) should suffice, not a fourth full closure cycle.

---

## Summary for sign-off

| Section | Result |
|---|---|
| 1. Boundary Verification | ✅ Pass — Cal.com cannot become a Case-lifecycle owner by construction |
| 2. Lifecycle Review | ⚠️ Pass with 1 open cell (reschedule during `in_progress`); requested state list corrected (`confirmed`/`closed` don't exist in live code) |
| 3. Data Ownership Review | ✅ Pass — no ambiguity, all "No Cal-write" rows structurally enforced |
| 4. Idempotency Review | ⚠️ Pass on necessity/design; concurrent-delivery race still open |
| 5. Mapping Review | ✅ Mechanism locked; values pending Product (known, not new) |
| 6. Failure Scenario Review | ⚠️ 5/7 locked; 2 depend on items 4–5 above |
| 7. QA Design | ✅ Extended CAL-01…10 with concurrent/long-delay/race coverage as required |
| 8. Implementation Gate | **B — READY WITH CONDITIONS** |

**No code, patch, webhook, flag, or deploy action was taken to produce this document.**
