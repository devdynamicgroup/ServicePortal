# Cal.com Booking Integration — Implementation Handoff

**Document type:** Implementation Intake Preparation / Workspace Handoff  
**Mode:** Tracking + intake only — **no code, no patch, no deploy, no architecture change**  
**Date:** 2026-08-05  

**Read with:**

| Document | Role |
|----------|------|
| [`CALCOM_EXTERNAL_INPUT_CHECKLIST.md`](./CALCOM_EXTERNAL_INPUT_CHECKLIST.md) | External dependency tracker |
| [`CALCOM_PHASE1_EXECUTION_CHECKLIST.md`](./CALCOM_PHASE1_EXECUTION_CHECKLIST.md) | Day-one Phase 1 / PR boundaries |
| [`CALCOM_IMPLEMENTATION_READINESS_GATE.md`](./CALCOM_IMPLEMENTATION_READINESS_GATE.md) | Final readiness gate **B** |

**Purpose:** one place to paste external inputs so the team can start **PR-1** as soon as blockers clear — without reopening architecture.

---

## 1. Current State

| Layer | Status |
|-------|--------|
| **Architecture** | **READY** |
| **Implementation** | **WAITING FOR EXTERNAL INPUT** |

### Architecture readiness

- Cal.com = External Intake Channel (not Domain / not SSOT)  
- Case = Operational SSOT after ingest  
- Customer / Care / Notification / Offer ownership **unchanged**  
- Phase 0 receive-only path exists (`POST /api/cal/webhook`) — verify + log + placeholder dedupe; **does not** create Cases  

### Architecture blockers

**None remaining.**  
Open items are **external inputs / ops execution**, not design gaps (per Readiness Gate §8 and External Input Checklist §7).

### What blocks coding (external only)

| Blocker | Blocks |
|---------|--------|
| Real Cal payload samples (esp. `BOOKING_CREATED`) | PR-1 field paths, PR-2 mapper |
| Product event-type → Offer map | PR-3 Offer-safe attribution |
| Notion `calBookingId` property creation | PR-2 durable lookup |
| Staging `CAL_WEBHOOK_SECRET` + webhook URL registration | PR-1 live Cal traffic (mechanism already in code) |

---

## 2. External Input Inbox

*Fill below as artifacts arrive. Do not invent JSON paths. Paste redacted samples only.*

### Cal.com

| Field | Value (fill in) |
|-------|-----------------|
| **Webhook URL** | _e.g. staging `https://…/api/cal/webhook`_ |
| **Secret** | _store in env only — do not commit; confirm set in target_ |
| **Signature header** | `x-cal-signature-256` (**already confirmed** in Phase 0 / `services/cal-webhook.js`) |
| **BOOKING_CREATED payload** | _paste redacted JSON or link to secure paste_ |
| **BOOKING_CANCELLED payload** | _paste redacted JSON or link_ |
| **BOOKING_RESCHEDULED payload** | _paste redacted JSON or link — also confirms booking-id stability_ |

**Capture checklist when pasting payloads**

- [ ] Booking id field path identified  
- [ ] Attendee name / email / phone paths identified (or marked N/A)  
- [ ] Start/end + timezone format noted  
- [ ] Event type id/slug noted  
- [ ] Reschedule: same booking id as create? (yes/no + evidence)

### Product

| Field | Value (fill in) |
|-------|-----------------|
| **Event type mapping** | _Cal type id/slug → Free Water Check / Full Assessment / other_ |
| **Launch offer mapping** | _which types → `launchOffer: true`_ |
| **Campaign attribution** | _named existing campaign string if any; else none_ |

**Locked default (do not reopen):** unmapped / unknown event type → **do not** default to Launch Offer (create without launch attribution, or Product may later require reject).

| Approver | Date | Signature |
|----------|------|-----------|
| Product | | ☐ Signed |

### Notion

| Field | Value (fill in) |
|-------|-----------------|
| **calBookingId property created** | ☐ Yes / ☐ No |
| **Property type** | _text / rich_text (per closed decision)_ |
| **Verified by** | _name + date_ |

**Rules (already closed):** written once at create; immutable; uniqueness enforced in app (lookup + lock), not by Notion DB constraint.

### Environment

| Target | Ready? | Notes (fill in) |
|--------|--------|-----------------|
| **Local** | | `CAL_WEBHOOK_SECRET` set? tunnel URL if testing real Cal send? |
| **Staging** | | Secret set in Render? Cal webhook subscribed to staging URL? |
| **Production** | | **Must stay unregistered until Phase 3 / PR sequence complete** |

---

## 3. PR Execution Checklist

| PR | Scope | Dependency | Ready |
|----|-------|------------|-------|
| **PR-1** | Receive + verify + config (upgrade Phase 0 against real payloads; **no Case create**) | Signature ✅; secret confirmed in target; **CREATED payload** for path accuracy | ☐ No — waiting input |
| **PR-2** | Mapping + durable dedupe (`calBookingId` lookup / lock pattern); **still no `createCase` call** in isolation tests | PR-1; Notion `calBookingId` property; CREATED payload | ☐ No — waiting input |
| **PR-3** | `createCase()` integration (unmodified Case entry) | PR-2; Product Offer map for Offer-safe create | ☐ No — waiting input |
| **PR-4** | Cancel / reschedule (resolve by `calBookingId` + guard matrix) | PR-3; CANCEL/RESCHEDULE payloads; reschedule-during-`in_progress` ops decision | ☐ No — waiting input |

**Rule:** do **not** merge PR-1…4 as one PR. Each has independent exit criteria ([`CALCOM_PHASE1_EXECUTION_CHECKLIST.md`](./CALCOM_PHASE1_EXECUTION_CHECKLIST.md) §6).

### When PR-1 becomes Ready

Mark Ready only when:

1. Inbox **BOOKING_CREATED** sample filled (paths no longer `UNKNOWN`)  
2. Staging (or local-with-tunnel) **secret** confirmed  
3. Implementer acknowledges Do Not Change list (§5)

---

## 4. Verification Evidence

Evidence required **before merge** of the relevant PR (accumulate in this section or link PRs):

| Evidence | Required for | Link / note (fill in) |
|----------|--------------|------------------------|
| **Test result** | Each PR (unit / route / QA IDs for that slice) | |
| **Webhook example** | PR-1+ (redacted request/response) | |
| **Duplicate test** | PR-2+ (sequential; concurrent before claiming durable dedupe) | |
| **Notion record** | PR-3+ (one Case with `calBookingId`; Offer check if launch) | |
| **Rollback confirmation** | Before production traffic (disable Cal subscription and/or reject via secret; existing Cases untouched) | |

Regressions (unchanged baseline): QA-B01–B04, QA-O01–O03 from [`verification/04_QA_MATRIX.md`](./verification/04_QA_MATRIX.md).

Phase 1 QA IDs (reference): CAL-P1-001…011 in [`CALCOM_IMPLEMENTATION_READINESS_GATE.md`](./CALCOM_IMPLEMENTATION_READINESS_GATE.md) §7 — cancel/reschedule IDs are Phase 2 / PR-4.

---

## 5. Do Not Change List

**Locked — any PR that touches these is out of scope and must be rejected in review:**

| Forbidden change | Why |
|------------------|-----|
| **Case ownership** | Case remains Ops SSOT; Cal is intake only |
| **M3 offer logic** | `water-check-offer-service.js` untouched; Cal only passes `launchOffer` / `campaignOffer` options |
| **M5 idempotency logic** | `idempotency-store.js` / booking hardening for `POST /api/cases` untouched; Cal durable dedupe is **additive** |
| **Notification state machine** | No Cal write to `notificationStatus`; `workflow-service` / LINE notify untouched |
| **Care lifecycle** | No Care SEND / audit from booking webhook |
| **Customer migration** | No Customer Domain / dual-write / flag changes; flags stay OFF |

Also forbidden without a new architecture decision: inventing Cal JSON paths, auto-backfill of historical Cal bookings, registering **production** Cal webhook before PR-3 QA + Phase sequencing allow it.

---

## 6. Final Status

## **READY TO RECEIVE INPUT**

| | |
|--|--|
| Architecture | Ready — **no architecture blocker left** |
| Code in this handoff | **None** — no implementation in this document |
| Next human action | Fill §2 inbox (Cal payloads, Product map, Notion property, env) |
| Next eng action after inbox | Start **PR-1** only when §3 Ready column can flip for PR-1 |

**No code change. No implementation. No deploy. No architecture change.**

---

## Handoff sign-off (optional)

| Role | Ready to receive / supply input | Date |
|------|--------------------------------|------|
| Architecture | ☐ | |
| Product | ☐ | |
| Ops / Notion schema | ☐ | |
| Eng Lead | ☐ | |
