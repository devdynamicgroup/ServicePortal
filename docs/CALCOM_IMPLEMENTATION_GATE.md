# Cal.com Booking Integration — Implementation Gate

**Document type:** Architecture / Implementation Gate Review  
**Mode:** Gate only — **no code, no patch, no webhook, no endpoint, no flag enable, no deploy**  
**Date:** 2026-08-05  
**Role:** Principal Software Architect + Implementation Gate Reviewer  

**Authority chain (read-only inputs):**

| Document | Role |
|----------|------|
| [`CALCOM_BOOKING_INTEGRATION_DESIGN_DECISION_RECORD.md`](./CALCOM_BOOKING_INTEGRATION_DESIGN_DECISION_RECORD.md) | Locked DDR |
| [`CALCOM_IMPLEMENTATION_PLAN.md`](./CALCOM_IMPLEMENTATION_PLAN.md) | Planning artifact (not authorization to code) |
| [`CALCOM_PRE_IMPLEMENTATION_REVIEW.md`](./CALCOM_PRE_IMPLEMENTATION_REVIEW.md) | Pre-impl architecture review |
| [`CALCOM_DESIGN_CLOSURE_REVIEW.md`](./CALCOM_DESIGN_CLOSURE_REVIEW.md) | Design closure / prior gate **B** |
| [`verification/01_AS_BUILT_ARCHITECTURE.md`](./verification/01_AS_BUILT_ARCHITECTURE.md) | As-built domains |
| [`verification/04_QA_MATRIX.md`](./verification/04_QA_MATRIX.md) | Baseline QA-B / QA-O |

**Live code anchors (state & entry points only):**

- `services/case-creation-service.js` — `createCase()` sets `caseWorkflowStatus: 'scheduled'`; `cancelAppointment()` sets `'cancelled'`
- `services/workflow-service.js` — writes `'in_progress'`, `'completed'`, `'result_sent'`, `'feedback_submitted'` (among ranked `WORKFLOW_STATES`)
- `services/water-check-offer-service.js` — Offer counts Cases; cancelled excluded via `isCancelledJob`
- `services/idempotency-store.js` — in-memory ~30s TTL (insufficient alone for Cal)

**Locked architecture (must not change under this gate):**

| Rule | |
|------|--|
| Cal.com | External Intake / Scheduling Channel only |
| Case | Operational SSOT after ingest |
| Customer | Identity only |
| Care | Policy / audit / outcome — not Case notification |
| Notification | Case-owned lifecycle (`notificationStatus`) |

**Forbidden under Cal intake:**

- Cal owns workflow  
- Cal writes `notificationStatus`  
- Cal holds Offer truth  
- Cal holds Care lifecycle  
- Cal invents Customer identity outside existing `createCase` dual-write hook (flags OFF)

---

## 1. Approved Architecture Decisions

| Decision | Status | Source |
|----------|--------|--------|
| **Boundary:** Cal = Intake Channel, not Domain / not SSOT | **Approved** | DDR §1; Closure §1 |
| **Ownership:** Case = Ops SSOT after ingest; Cal keeps Cal-native record only | **Approved** | DDR §6; As-built Case ownership |
| **Booking lifecycle create:** `BOOKING_CREATED` → `createCase()` | **Approved** | DDR §2 |
| **Cancel behavior:** Option A — update existing Case via `cancelAppointment`; no invent-Case-from-cancel | **Approved** | DDR §5a |
| **Cancel guard principle:** do not silently force-cancel when Case already past service start / terminal ops | **Approved** (principle) | DDR §5a; Closure §2 |
| **Reschedule behavior:** Option A — update appointment on **same** Case; no cancel+create | **Approved** | DDR §5b |
| **Idempotency principle:** M5 30s insufficient; durable Cal-key dedupe required; ack only after durable success or durable dedupe hit | **Approved** | DDR §4, §8 |
| **Offer mapping principle:** Cal **event type** → existing `launchOffer` / `campaignOffer`; Offer still counts Cases only | **Approved** (mechanism) | DDR §7; M3 as-built |
| **Backfill:** A — no historical Cal import in v1 | **Approved** | DDR §9 |
| **Fuzzy match:** forbidden for Cal↔Case correlation | **Approved** | DDR §3 |
| Exact Cal event-type **values** → campaign strings | **Deferred** | Product config input |
| Concurrent-delivery **race-safe** dedupe mechanism choice | **Not approved** (open) | Closure §4, §8 |
| Reschedule when Case already `in_progress` (exact allow/reject) | **Not approved** (open) | Closure §2; Pre-impl §7 |
| Durable dedupe **storage backend** | **Deferred** | Plan §6 (implementation-time) |
| Customer / Care flag enable for Cal | **Not approved** (explicitly out of scope) | DDR; Plan §1 |

### Legend

| Tag | Meaning |
|-----|---------|
| **Approved** | Locked; may not be reopened without a new DDR |
| **Not approved** | Still open; blocks the phase that depends on it |
| **Deferred** | Intentionally later / config; not an architecture redesign |

---

## 2. Remaining Blocking Decisions

| ID | Decision | Why Needed | Owner | Status |
|----|----------|------------|-------|--------|
| **CAL-G01** | Payload contract จริงจาก Cal.com (CREATE / CANCEL / RESCHEDULE samples, redacted) | Freeze field paths; confirm phone/LINE/timezone; verify whether booking id survives reschedule | Product + Eng (capture) / Cal admin | **Open — blocks Phase 0 exit & Phase 1 start** |
| **CAL-G02** | `calBookingId` storage/schema (Notion property + alias approval) | Primary correlation key; cancel/reschedule lookup; durable create dedupe surface | Notion schema owner + Eng | **Open — blocks Phase 0 exit** |
| **CAL-G03** | Event type → `launchOffer` / `campaignOffer` mapping values | M3 Offer correctness; CAL-09 / gate QA meaningful | Product | **Open — blocks Phase 1 exit (Offer-safe create)** |
| **CAL-G04** | Concurrent webhook dedupe strategy (race-safe under simultaneous delivery) | Prevents double Case / double Offer burn; CAL-08 concurrent variant | Eng Lead + Architecture | **Open — blocks Phase 2 exit** |
| **CAL-G05** | Reschedule guard เมื่อ Case state เปลี่ยนแล้ว (`in_progress` and beyond) | Avoid changing appointment under live service without ops policy | Product + Ops | **Open — blocks Phase 2 exit / Phase 3** |

**Non-blocking unknowns** (prove against Cal; do not redesign domains): signature header/algorithm version; Cal retry horizon length; frequency of true concurrent delivery.

---

## 3. Lifecycle Contract

### Case workflow states used in this gate (from live writers only)

| State | Written by (code) | Notes |
|-------|-------------------|--------|
| `scheduled` | `createCase` → `buildSystemDefaults` | Initial Case after booking create |
| `in_progress` | `workflow-service` start-on-site path | Specialist opened job |
| `completed` | `workflow-service` close path | Service completed |
| `result_sent` | `workflow-service` after result send | Notification SM advanced |
| `feedback_submitted` | `workflow-service` / feedback path | Feedback recorded on Case |
| `cancelled` | `cancelAppointment` | Cancel path; Offer excludes via `isCancelledJob` |

**Not used in this gate as Case workflow labels:** invented states such as `confirmed` that do not appear as `caseWorkflowStatus` writers above.  
**Note:** `workflow-service.js` also ranks additional tokens (`created`, `line_linked`, `service_in_progress`, `review_requested`, `closed`) for `stateAtLeast` — Cal intake must not invent or drive those; cancel/reschedule guards below use the six states in the table.

### BOOKING_CREATED

```text
Cal
 ↓
Webhook Adapter
 ↓
Validation (signature + required fields)
 ↓
Dedup (calBookingId / event keys — durable)
 ↓
createCase()
 ↓
Case SSOT  (caseWorkflowStatus = scheduled;
            notificationStatus = not_sent via system defaults;
            Offer invalidate only if campaign attributed)
```

| If Case already exists for `calBookingId` | Idempotent success — **no** second Case |

### BOOKING_CANCELLED

```text
Cal
 ↓
Adapter
 ↓
Resolve Case by calBookingId (exact)
 ↓
Cancel guard
 ↓
Case update via cancelAppointment() → cancelled
```

| Current Case state | Contract |
|--------------------|----------|
| `scheduled` | **Allow** cancel |
| Unknown `calBookingId` | **Do not** invent Case; alert |
| `in_progress` | **Guard** — do not silently force-cancel (DDR); exact reject vs alert UX = ops (ties to CAL-G05 family) |
| `completed` / `result_sent` / `feedback_submitted` | **Guard** — do not silently force-cancel |
| Already `cancelled` | Idempotent no-op (existing cancel idempotency) |

### BOOKING_RESCHEDULED

```text
Cal
 ↓
Adapter
 ↓
Resolve Case by calBookingId
 ↓
Policy: update appointment fields on same Case  OR  reject
```

| Current Case state | Contract |
|--------------------|----------|
| `scheduled` | **Allow** appointment field update on same Case |
| `cancelled` | **Reject** silent resurrect via reschedule |
| Unknown id | **Do not** invent Case |
| `in_progress` | **Open — CAL-G05** (update vs reject) |
| `completed` / `result_sent` / `feedback_submitted` | **Reject** appointment rewrite that rewrites completed ops history without human policy |

**Invariant:** Reschedule never calls `createCase()` under approved Option A.

---

## 4. Data Contract Review

| Field | Owner | Source | Destination | Decision |
|-------|-------|--------|-------------|----------|
| `calBookingId` | Cal native; Case holds **copy** | Cal webhook | Case property (CAL-G02) | **Required**; immutable after create; primary correlation |
| Webhook event / delivery id | Cal delivery | Cal webhook | Dedupe registry only (not ops SSOT) | **Required** for secondary dedupe |
| Customer name | Case booking fields after ingest | Cal attendee | Case via `createCase` (`fullName` required) | Cal → Case on create |
| Phone | Case booking fields | Cal (path TBD — CAL-G01) | Case | Cal → Case if present; mapping unconfirmed until G01 |
| Email | Case booking fields | Cal attendee | Case | Cal → Case on create |
| LINE (`lineId` handle) | Case booking fields | Cal custom Q if any | Case | Optional Cal → Case; **≠** LINE User ID |
| Appointment time | Case ops SSOT after ingest | Cal start/end | Case appointment fields | Cal → Case on create/reschedule; timezone per G01 |
| Campaign / offer | Case `campaignOffer` / create options | Adapter map from Cal event type (G03) | Case → Offer count | Mechanism approved; **values** open (G03) |
| Workflow status | **Case only** | Portal ops / cancel API | Case | **Cal must not write** except via `cancelAppointment` path |
| `notificationStatus` | **Case only** | `buildSystemDefaults` / workflow send | Case | **Forbidden from Cal**; create leaves `not_sent` |

---

## 5. Reliability Gate

| Scenario | Expected Result | Open Decision |
|----------|-----------------|---------------|
| Same event redelivered (sequential) | One Case / one cancel effect; Offer unchanged on dup create | None (principle locked) |
| Concurrent delivery (two in-flight) | Still exactly one Case | **CAL-G04** |
| Delayed retry (hours–day) | Same as sequential dedupe if key retained | Retention vs Cal retry horizon (unknown; prove in Phase 0/2) |
| Cal timeout then retry | First success wins; retry hits dedupe | Ordering: check-before-create (principle locked; mechanism G04) |
| Signature fail | Reject; no Case mutation | Exact header/algorithm (prove G01 / Cal docs) |
| Notion unavailable on create | Non-success; Cal retries; eventually one Case | None (fail-closed locked) |
| `createCase` success but webhook response fails | Cal retries; must resolve to existing Case via `calBookingId` | Relies on G02 + G04 |

---

## 6. Security Gate

| Control | Gate requirement | Status |
|---------|------------------|--------|
| Webhook signature | Verify before trust; reject on mismatch | Required — algorithm/header pending Cal contract (G01) |
| Secret management | Server env only; never Framer; never commit; never log raw secret | Required |
| Replay protection | Signature **plus** durable event/`calBookingId` dedupe | Required (DDR); storage race → G04 |
| Payload validation | Required fields before `createCase`; no partial Case | Required |
| Logging policy | Correlation ids OK; no full PII dumps; no secrets | Required |
| Privilege | Adapter may only reach create / cancel / appointment update — not notify SM, Care, Customer merge | Locked |

**This document contains no secrets.**

---

## 7. QA Gate

Checklist IDs for **this gate** (maps to DDR QA-CAL-01…10 / Closure extensions):

| ID | Scenario | Exit proof |
|----|----------|------------|
| **CAL-GQA-01** | Booking created | One Case; `scheduled`; `notificationStatus=not_sent`; visible on `GET /api/clients` |
| **CAL-GQA-02** | Duplicate webhook (sequential) | Zero second Case; Offer unchanged |
| **CAL-GQA-03** | Delayed retry | Same as GQA-02 after long delay / restart |
| **CAL-GQA-04** | Cancel (`scheduled`) | Case `cancelled`; Offer frees if launch |
| **CAL-GQA-05** | Reschedule (`scheduled`) | Same Case id; new times; Offer unchanged |
| **CAL-GQA-06** | Invalid signature | Reject; no mutation |
| **CAL-GQA-07** | Notion failure on create | Non-success; recovery → exactly one Case |
| **CAL-GQA-08** | Concurrent duplicate delivery | Exactly one Case (**requires CAL-G04**) |
| **CAL-GQA-09** | Offer attribution | Launch event type moves slots; non-launch does not (**requires CAL-G03**) |
| **CAL-GQA-10** | Rollback | Intake disabled; no new Cal Cases; existing Cases intact |

**Regressions (from `verification/04_QA_MATRIX.md`):** QA-B01–B04, QA-O01–O03 must remain green across phases.

---

## 8. Implementation Phases

Planning phases only — **this gate does not authorize writing code.**

### Phase 0 — Receive-only validation

| | |
|--|--|
| **Goal** | Freeze Cal contract & schema without Case mutation from production Cal traffic |
| **Entry criteria** | DDR signed conceptually; this Gate accepted as working authority |
| **Exit criteria** | **CAL-G01** samples captured; **CAL-G02** schema approved (property may exist unused); signature docs noted; no production webhook writing Cases |
| **Risk** | Mapping assumptions if Phase 1 starts without G01 |

### Phase 1 — Create Case integration

| | |
|--|--|
| **Goal** | `BOOKING_CREATED` → `createCase()` only (staging) |
| **Entry criteria** | Phase 0 exit; G01+G02 closed; staging secret present |
| **Exit criteria** | CAL-GQA-01/02/06/07 pass; **CAL-G03** closed before claiming Offer-safe; no cancel/reschedule yet |
| **Risk** | Offer miscount if G03 open; duplicate Case if durable dedupe incomplete (mitigate: limit traffic / staging only) |

### Phase 2 — Cancel / reschedule sync

| | |
|--|--|
| **Goal** | CANCEL + RESCHEDULE against same Case with guards |
| **Entry criteria** | Phase 1 exit; **CAL-G04** decided and proven (GQA-08); G01 confirms booking id on reschedule |
| **Exit criteria** | CAL-GQA-03/04/05/08 pass; **CAL-G05** closed for `in_progress` policy; cancel guards for post-`scheduled` verified |
| **Risk** | Twin Manual+Cal Cases; reschedule under live service |

### Phase 3 — Production rollout

| | |
|--|--|
| **Goal** | Production Cal webhook → Portal; rollback drilled |
| **Entry criteria** | Phase 2 exit; full CAL-GQA-01…10; QA-B/O regressions; human sign-off |
| **Exit criteria** | CAL-GQA-10 rollback proven; monitored create/cancel/reschedule; flags Customer/Care still OFF |
| **Risk** | Partial cutover confusion; Offer counter step-change as Cal demand finally lands in Cases |

---

## 9. Final Gate Decision

### **B. READY WITH CONDITIONS**

Architecture is **not** blocking a redesign. Domain ownership remains intact.  
Implementation must **not** start Phase 1 Case writes until conditions below are closed (Phase 0 may proceed only as receive/contract/schema prep without production ingest).

### Conditions (must close — maps to §2)

| Before | Must close |
|--------|------------|
| Phase 0 exit | **CAL-G01**, **CAL-G02** |
| Phase 1 exit (Offer-safe) | **CAL-G03** |
| Phase 2 exit | **CAL-G04**, **CAL-G05** |
| Phase 3 | All GQA + regressions + sign-off |

### Why not A

Five gate decisions (**CAL-G01…G05**) remain **Open**. Per Design Closure Review and Pre-Implementation Review, these are real inputs/mechanism choices — not paper theater.

### Why not C

No remaining question requires changing Case / Customer / Care / Offer / Notification ownership or rewriting M3/M5 algorithms. Boundary and DDR remain valid.

### Upgrade path to A

Close **CAL-G01 through CAL-G05** with recorded evidence (payload pack, schema ticket, product mapping table, race-safe dedupe decision note, reschedule guard decision). Append a short **Gate Amendment** to this file — do not reopen architecture.

---

## Sign-off

| Role | Decision | Date | Signature |
|------|----------|------|-----------|
| Architecture | ☐ Accept Gate **B** as authority | | |
| Product | ☐ Own G01 (assist) / G03 / G05 | | |
| Ops | ☐ Own G05 cancel/reschedule UX | | |
| Eng Lead | ☐ Own G02 / G04; no Phase 1 without G01+G02 | | |

**No code, patch, webhook, flag, or deploy action is authorized by creating this document.**
