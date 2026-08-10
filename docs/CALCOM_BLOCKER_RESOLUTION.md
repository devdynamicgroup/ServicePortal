# Cal.com Booking Integration — Blocker Resolution (CAL-G01…G05)

**Document type:** Design Decision Closure for Implementation Gate blockers  
**Mode:** Design decision closure only — **no code, no webhook, no migration, no flag, no deploy**  
**Date:** 2026-08-05  
**Authority:** Resolves / attempts to close items from [`CALCOM_IMPLEMENTATION_GATE.md`](./CALCOM_IMPLEMENTATION_GATE.md) §2  

**Inputs:** DDR, Implementation Plan, Pre-Implementation Review, Design Closure Review, `verification/01`, `verification/04`, live Case/workflow/offer writers  

**Immutable principles (not reopened):**

| Principle | |
|-----------|--|
| Cal.com | External Intake Channel |
| Case | Operational SSOT after ingest |
| Customer | Identity Domain only |
| Care | Policy / Audit / Outcome |
| Notification | Case-owned lifecycle |

**Forbidden:** ownership moves; inventing Cal JSON paths; implementation/storage product picks beyond **requirements**.

**Evidence rule for CAL-G01:** No redacted Cal webhook sample exists in this repository. Field **paths** that are not proven from a live sample are marked **Need Cal confirmation** — not guessed.

---

## Status at a glance

| Gate | Topic | Closure in this document |
|------|--------|---------------------------|
| **CAL-G01** | Payload contract | **Partially closed** — required *semantics* locked; **JSON paths Unknown** until Cal samples |
| **CAL-G02** | `calBookingId` identity | **Closed** (decision) |
| **CAL-G03** | Event type → Offer | **Partially closed** — rules + default locked; **concrete type ids Unknown** until Product/Cal |
| **CAL-G04** | Concurrent dedupe | **Closed** (requirements decision) |
| **CAL-G05** | Reschedule/cancel guards | **Closed** (state matrix) |

**Implementation Readiness after this document:** **B — READY WITH CONDITIONS**  
(Cannot upgrade to **A** while G01 paths and G03 concrete mappings lack external confirmation.)

---

## CAL-G01 — Cal.com Payload Contract

### Decision (what we lock without guessing paths)

| Semantic | Required for create? | Case destination (existing Case fields / options) | Path status |
|----------|----------------------|-----------------------------------------------------|-------------|
| Stable booking identity | **Yes** | Case correlation property (`calBookingId` — see G02) | **Need Cal confirmation** of which payload field is the stable uid |
| Delivery / event id | **Yes** (dedupe only) | Not a Case ops field | **Need Cal confirmation** |
| Customer display name | **Yes** | `fullName` (validated by `booking-validation` / `createCase`) | **Need Cal confirmation** |
| Phone | Recommended | `phone` | **Need Cal confirmation** (often custom question) |
| Email | Recommended | `email` | **Need Cal confirmation** |
| LINE handle | Optional | `lineId` only — never `lineUserId` | **Need Cal confirmation** (only if Cal form collects it) |
| Appointment start/end | **Yes** | `appointmentDate` / `appointmentStart` / `appointmentEnd` | **Need Cal confirmation** |
| Timezone | **Yes** (interpretation) | Conversion into Case date/time labels must not silently shift calendar day | **Need Cal confirmation** of Cal’s timezone representation |
| Event type | **Yes** for Offer map | Drives G03 → `launchOffer` / `campaignOffer` options into `createCase` | **Need Cal confirmation** of id/slug field |
| Campaign information | Derived | Case `campaignOffer` via G03 — Cal must not be Offer SoT | **Known** (mechanism); values → G03 |
| Cancellation information | **Yes** for cancel path | Resolve by `calBookingId` → `cancelAppointment` | **Need Cal confirmation** of cancel payload shape + id stability |
| Reschedule information | **Yes** for reschedule path | Same Case appointment fields | **Need Cal confirmation** that booking id is stable across reschedule |

### Contract table

| Field | Cal Source | Case Destination | Required | Decision |
|-------|------------|------------------|----------|----------|
| Booking id | Cal native booking identity (field name **Unknown**) | Case `calBookingId` (G02) | **Yes** | **Need Cal confirmation** — must be non-empty, exact-match key |
| Event / delivery id | Cal webhook delivery identity (**Unknown** path) | Dedupe registry only | **Yes** (processing) | **Need Cal confirmation** — secondary idempotency key (G04) |
| Customer name | Attendee / responses (**Unknown** path) | `fullName` | **Yes** | Reject create if missing after map (**Known** rule) |
| Phone | Attendee / custom Q (**Unknown**) | `phone` | No (recommended) | Map if present; do not block create solely on phone (**Known** rule) |
| Email | Attendee (**Unknown**) | `email` | No (recommended) | Map if present (**Known** rule) |
| LINE | Custom Q if any (**Unknown**) | `lineId` | No | Optional; never map to LINE User ID (**Known**) |
| Appointment start | Start time (**Unknown**) | `appointmentDate` + `appointmentStart` | **Yes** | **Need Cal confirmation** + timezone rule |
| Appointment end | End time (**Unknown**) | `appointmentEnd` | **Yes** | Same |
| Timezone | Cal tz metadata (**Unknown**) | Interpretation only | **Yes** | **Need Cal confirmation**; Case remains ops SSOT after ingest |
| Event type | Event type id/slug (**Unknown**) | Input to G03 only | **Yes** (for Offer-correct create) | **Need Cal confirmation** |
| Campaign information | Not Cal SoT | `campaignOffer` via G03 | Derived | **Known** — never invent Offer DB |
| Cancellation information | Cancel webhook (**Unknown**) | Cancel path via `calBookingId` | **Yes** for cancel | **Need Cal confirmation** |
| Reschedule information | Reschedule webhook (**Unknown**) | Same-Case appointment update | **Yes** for reschedule | **Need Cal confirmation** of id continuity |

### Legend

| Tag | Meaning |
|-----|---------|
| **Known** | Decidable from DDR + Case contracts without a Cal sample |
| **Unknown** | Not present / not proven in repo |
| **Need Cal confirmation** | Must capture real CREATE/CANCEL/RESCHEDULE payloads (redacted) before Phase 1 mapper freeze |

### CAL-G01 closure verdict

**Not fully closed.** Semantics and reject rules are locked; **payload paths remain open**.  
**Blocker for A / Phase 1 mapper freeze:** live Cal samples.

---

## CAL-G02 — calBookingId Identity Decision

### Decisions (closed)

| Question | Decision |
|----------|----------|
| เก็บที่ไหน? | **On the Case** as a dedicated correlation property (Notion Cases DB), read/write via Case mapper aliases when schema exists — **Case owns the copy**; Cal owns the native id |
| Unique? | **Yes** — at most **one Case per `calBookingId`** (exact match). Duplicate create attempts resolve to the existing Case |
| ใช้ร่วมกับ event id? | **Yes, but different roles:** `calBookingId` = Case correlation; webhook event/delivery id = **processing** dedupe only (not ops SSOT, not Customer id) |
| Lifecycle ของ id | Written **once at create**; **immutable** thereafter; used for cancel, reschedule, retry, duplicate webhook resolution |

### Identifier table

| Identifier | Purpose | Lifetime | Owner |
|------------|---------|----------|-------|
| `calBookingId` | Primary Cal↔Case correlation; cancel/reschedule/retry lookup | From Case create until Case forever (immutable value) | Cal native; **Case** holds copy |
| Webhook event / delivery id | Exactly-once *processing* of a delivery | ≥ Cal retry horizon (durable) | Cal delivery; Adapter dedupe registry |
| `calBookingId` + event kind (`CREATED`/`CANCELLED`/`RESCHEDULED`) | Business-level idempotency of lifecycle actions | Same as durable dedupe retention | Adapter + Case outcome |
| Notion Case id | Ops SSOT row identity | Case lifetime | **Case** |

### Lifecycle use

| Situation | Behavior |
|-----------|----------|
| **create** | Persist `calBookingId` on new Case; if already present → return existing Case |
| **cancel** | Lookup by `calBookingId` only (no fuzzy) |
| **reschedule** | Lookup by same `calBookingId`; update appointment fields |
| **retry** | Same keys → no second Case |
| **duplicate webhook** | Delivery id and/or `calBookingId`+kind → idempotent success |

### Schema note (decision, not migration)

Property does **not** exist in `FIELD_ALIASES` today (confirmed in Design Closure Review). Creating it is a **future schema action outside this document**. This DDR-level decision is: **name/purpose/uniqueness/immutability** — not a migration script.

### CAL-G02 closure verdict

**Closed** as an identity decision. Remaining ops step (approve/add Notion property) is **execution**, not an open architecture question — still a **Phase 0 exit checklist item**, not a reason to reopen ownership.

---

## CAL-G03 — Event Type → Offer Mapping

### Mapping table (values pending confirmation)

| Cal Event Type | Launch Offer | Campaign | Owner | Status |
|----------------|--------------|----------|-------|--------|
| Free Water Check / `watermotion/60min` (or equivalent) | `launchOffer: true` → existing default Launch campaign via `createCase` options | Existing Launch campaign string already used by M3 (e.g. env/`WATER_CHECK_CAMPAIGN_OFFER` / `Launch Offer 2026` as today) | **Product** approves which Cal type(s) | **Need Cal + Product confirmation** of exact type id/slug |
| Full Assessment / paid event type(s) | `launchOffer: false` | No launch campaign (unless Product assigns a different existing campaign string) | **Product** | **Need confirmation** |
| Any **unmapped** / unknown type | See default below | Must **not** invent a new campaign vocabulary | Adapter policy (this doc) | **Closed rule** |

### Approval

| Role | Responsibility |
|------|----------------|
| **Product** | Approves which Cal event type id/slug → launch vs non-launch |
| **Architecture** | Forbids Cal as Offer SoT; forbids new Offer store |
| **Eng** | Implements map as config under approved values — not decided here |

### Default when mapping ไม่เจอ (closed)

| Decision | |
|----------|--|
| **Do not** invent or guess a campaign | Locked |
| **Do not** default unknown types to Launch Offer | Locked — prevents silent Offer burn |
| **Allow** Case create **without** `launchOffer` / without `campaignOffer` when type unknown **or** reject create if Product later requires “Cal only carries Free Water Check” | **Default for v1:** **create without launch attribution** + alert/log for ops; Product may tighten to **reject** before production if Cal should only ever send mapped types |

### Prevent wrong campaign

1. Only Product-approved rows may set `launchOffer: true`.  
2. Adapter never writes Offer counts directly — only Case fields/options → existing M3.  
3. CAL-GQA-09 / QA-O regressions must pass with approved map before Phase 3.

### CAL-G03 closure verdict

**Rules closed; concrete type→campaign rows still Need confirmation.**  
**Partial blocker for A** (Offer-safe Phase 1 exit / Phase 3).

---

## CAL-G04 — Concurrent Webhook Deduplication

### Race (named)

```text
Webhook A: check → no Case for calBookingId
Webhook B: check → no Case for calBookingId
Both call createCase() → two Cases + possible double Offer burn
```

M5 `idempotency-store.js` (≈30s in-memory) **does not** close this across restart or long Cal retries (Gate / Plan / Closure).

### Decisions (closed — requirements only)

| Topic | Decision |
|-------|----------|
| **Dedupe key (create)** | Primary business key: **`calBookingId` + CREATED**; secondary processing key: **webhook event/delivery id** |
| **Dedupe key (cancel/reschedule)** | **`calBookingId` + event kind**; delivery id still recorded to ignore pure redelivery |
| **Storage requirement** | Must **survive process restart**; retention ≥ observed Cal retry horizon (horizon itself **Need Cal confirmation**, minimum design bar: **multi-hour**, not 30s) |
| **Atomicity requirement** | Under concurrent delivery, system must still yield **at most one Case per `calBookingId`**. Check-then-act without mutual exclusion is **non-compliant**. Exact mutex/store technology is **out of scope** of this document |
| **Retry behavior** | Transient Case/Notion failure → non-success to Cal; after success or durable dedupe hit → success-equivalent ack; never ack-before-durable-create |
| **Relationship to M5** | Keep M5 for `POST /api/cases` API bursts; Cal path **adds** durable race-safe layer — does not rewrite M5 |

### Scenario table

| Scenario | Expected Result | Decision |
|----------|-----------------|----------|
| Same event retry (sequential) | One Case / one cancel effect | **Closed** |
| Concurrent delivery | Still one Case | **Closed** (atomicity required) |
| Delayed delivery | Same as sequential if key retained | **Closed** |
| Server restart between attempts | Still one Case | **Closed** (durable required) |

### CAL-G04 closure verdict

**Closed** at requirements level. Choosing a specific store is deferred to implementation planning — **not** an ownership or domain redesign. Gate upgrade to A still needs G01/G03 external inputs; G04 is no longer an open *policy* gap.

---

## CAL-G05 — Reschedule / Cancel Guard

### States (from live writers only)

`scheduled` · `in_progress` · `completed` · `result_sent` · `feedback_submitted` · `cancelled`  

Sources: `case-creation-service.js` (`scheduled`, `cancelled`); `workflow-service.js` (`in_progress`, `completed`, `result_sent`, `feedback_submitted`).

### Matrix (closed)

| Current State | Cancel | Reschedule | Decision |
|---------------|--------|------------|----------|
| `scheduled` | **Allow** → `cancelAppointment` | **Allow** → update appointment fields on **same** Case | Closed |
| `in_progress` | **Deny** silent cancel (reject or no-op + alert; no force) | **Deny** silent reschedule (reject or no-op + alert) | Closed — protects live service |
| `completed` | **Deny** silent cancel | **Deny** | Closed — service already happened |
| `result_sent` | **Deny** silent cancel | **Deny** | Closed |
| `feedback_submitted` | **Deny** silent cancel | **Deny** | Closed |
| `cancelled` | **Idempotent** allow (already cancelled) | **Deny** (no resurrect via reschedule) | Closed |
| Unknown `calBookingId` | **Deny** inventing Case | **Deny** inventing Case | Closed — alert only |

**No new workflow states introduced.**

### CAL-G05 closure verdict

**Closed.**

---

## Cross-System Failure Review

| Failure | Expected Behavior | Owner |
|---------|-------------------|-------|
| 1. Cal ส่งสำเร็จ แต่ Case สร้างไม่สำเร็จ | Portal returns non-success; Cal retries; eventually one Case via G02/G04; customer may see Cal confirmation while Dashboard empty until retry succeeds — ops monitor lag | Adapter ack policy + Case/Notion + Ops awareness |
| 2. Case สร้างสำเร็จ แต่ webhook response fail | Cal retries; lookup by `calBookingId` → idempotent success; **no** second Case | Adapter + G02/G04 |
| 3. Duplicate webhook | Idempotent; Offer unchanged on dup create | Adapter dedupe (G04) |
| 4. Cancel หลัง workflow เริ่ม (`in_progress`+) | Per G05 — **no** silent cancel; alert/ops | Case cancel policy + Ops |
| 5. Reschedule หลัง workflow เริ่ม | Per G05 — **no** silent appointment rewrite; alert/ops | Case update policy + Ops |

---

## Final Decision Gate

### Closed Decisions

| ID | Closed content |
|----|----------------|
| **CAL-G02** | Case holds unique immutable `calBookingId` copy; event/delivery id is processing-only |
| **CAL-G04** | Durable, race-safe dedupe requirements; keys; ack rules; M5 unchanged |
| **CAL-G05** | Full cancel/reschedule matrix on real six states |
| **CAL-G01** (partial) | Required semantics + reject-if-no-name; **not** JSON paths |
| **CAL-G03** (partial) | Unmapped ≠ Launch; Product owns type map; no new Offer store |

### Remaining Decisions / Confirmations

| ID | Remaining | Blocks |
|----|-----------|--------|
| **CAL-G01** | Real CREATE/CANCEL/RESCHEDULE payload samples + field path freeze + timezone + reschedule id stability | Phase 0 exit / Phase 1 mapper |
| **CAL-G03** | Exact Cal event type id/slug → launch / non-launch rows signed by Product | Offer-safe Phase 1 exit / Phase 3 |
| **CAL-G02 (ops)** | Notion property creation approval (execution of closed decision) | Phase 0 exit checklist |
| **CAL-G04 (ops)** | Concrete durable store meeting atomicity bar (execution) | Phase 2 exit / CAL-GQA-08 |

### Implementation Readiness

## **B — READY WITH CONDITIONS**

| Why not **A** | G01 payload paths and G03 concrete mappings are still **Need Cal / Product confirmation**. Claiming A would require guessing Cal payloads — forbidden. |
| Why not **C** | Ownership model unchanged; G02/G04/G05 policy closed; architecture remains an intake extension of Case SSOT. |

### Conditions to upgrade to **A — READY FOR IMPLEMENTATION**

1. Attach redacted Cal payload pack resolving **CAL-G01** paths (and reschedule id continuity).  
2. Product-signed **CAL-G03** mapping table with real event type identifiers.  
3. Record Phase 0 checklist: schema approval ticket for `calBookingId` (executes G02).  
4. Short amendment to this file flipping G01/G03 to **Closed** with evidence links — **no architecture reopen**.

Until then: Gate remains **B**. No implementation, webhook, migration, flag, or deploy is authorized by this document.

---

## Sign-off

| Role | On this resolution | Date |
|------|--------------------|------|
| Architecture | ☐ Accept G02/G04/G05 closed; G01/G03 partial | |
| Product | ☐ Supply G03 values; assist G01 capture | |
| Ops | ☐ Accept G05 deny matrix for post-`scheduled` | |
| Eng Lead | ☐ No Phase 1 mapper freeze until G01 Closed | |
