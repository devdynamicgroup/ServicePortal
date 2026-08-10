# Cal.com Phase 1 Implementation Review

**Document type:** Phase 1 Implementation Review (pre–PR-1)  
**Mode:** Review only — **no code, no patch, no architecture expansion, no M3/M5/Notification/Care/Customer changes**  
**Date:** 2026-08-05  

**Inputs requested:**

| Source | Used? |
|--------|--------|
| [`CALCOM_IMPLEMENTATION_HANDOFF.md`](./CALCOM_IMPLEMENTATION_HANDOFF.md) | Yes — inbox still empty for payloads |
| [`CALCOM_PHASE1_DESIGN_REVIEW.md`](./CALCOM_PHASE1_DESIGN_REVIEW.md) | Yes — field/lifecycle contracts |
| **Payload จริงจาก Cal.com (Water Motion)** | **Not found in workspace** |

**Evidence search (this review):**

- Handoff §2 Cal.com inbox: `BOOKING_CREATED` / `CANCELLED` / `RESCHEDULED` still placeholders (`_paste redacted…_`)
- [`CALCOM_EXTERNAL_INPUT_CHECKLIST.md`](./CALCOM_EXTERNAL_INPUT_CHECKLIST.md) §1: payload samples marked ❌ Not received
- Repo / `docs/` / handoff: no redacted JSON artifact from the Water Motion Cal account
- Cal.com **public documentation** examples exist (e.g. help docs nested `payload.uid`) — **not accepted here as Water Motion “payload จริง”** (same evidence rule as Blocker Resolution / Readiness Gate: no guessing / no substituting docs for account samples)

---

## 1. Validate Payload

### Mapping table status

| Cal Field (semantic) | Target Field | Transform | Required | Path from WM sample |
|----------------------|--------------|-----------|----------|---------------------|
| Booking id | `calBookingId` | verbatim | Required | **UNKNOWN — no WM sample** |
| Delivery / event id | dedupe only | none | Required (processing) | **UNKNOWN — no WM sample** |
| Customer name | `fullName` | none | Required | **UNKNOWN — no WM sample** |
| Phone | `phone` | none | Optional | **UNKNOWN — no WM sample** |
| Email | `email` | none | Optional | **UNKNOWN — no WM sample** |
| LINE | `lineId` | never `lineUserId` | Optional | **UNKNOWN — no WM sample** |
| Appointment start/end | appointment fields | timezone-safe | Required | **UNKNOWN — no WM sample** |
| Event type | Offer map input | lookup | Required (Offer-safe) | **UNKNOWN — no WM sample** |

### Fields that do not match

**Cannot list mismatches.**  
Mismatch analysis requires a concrete Water Motion webhook body. None was available to this review.

**Not reported as mismatches (intentionally):** differences between Cal.com *docs* examples and Phase 0 speculative readers (`payload.uid` / `bookingUid` / etc.) — those are **unverified hypotheses**, not confirmed gaps.

---

## 2. Confirm Event Handling

Against locked lifecycle (DDR / Design Review / Gate) — **design alignment only**, not payload-path confirmation:

| Cal trigger (expected name) | Lifecycle intent | Maps to Case contract? | Notes |
|----------------------------|------------------|------------------------|-------|
| `BOOKING_CREATED` | Create Case via `createCase()` → `scheduled` | **Yes (design)** | PR-3+, not PR-1 |
| `BOOKING_CANCELLED` | Update Case → `cancelAppointment` + guards | **Yes (design)** | PR-4 / Phase 2 |
| `BOOKING_RESCHEDULED` | Update same Case appointment fields + guards | **Yes (design)** | PR-4 / Phase 2; booking-id stability **unconfirmed** without RESCHEDULED sample |

**Payload confirmation of trigger strings / nesting for this account:** **Not done** (no sample).

---

## 3. Update Implementation Checklist

**Action taken:** **No UNKNOWN → real path updates.**

| Checklist artifact | Change |
|--------------------|--------|
| Handoff inbox | Unchanged — still awaiting paste |
| External Input Checklist mapping rows | Remain `UNKNOWN` |
| Phase 1 Design Review §3 paths | Remain `UNKNOWN — confirm from sample` |

Filling paths from Cal.com public docs would violate **ห้ามเดา**.

---

## 4. PR-1 Scope Confirmation

| | |
|--|--|
| **IN** | Webhook receive · signature verify · config (`CAL_WEBHOOK_SECRET` / status) — Phase 0 baseline; PR-1 may refine envelope logging **only after** real paths exist |
| **OUT** | `createCase()` · Notion Case write · Offer update / `launchOffer` attribution · cancel/reschedule business handling · durable create dedupe that mutates Cases |

**Scope confirmation:** **Aligned** with Handoff §3 / Execution Checklist §6 for PR-1.

**Unchanged domains:** M3 Offer · M5 idempotency · Notification SM · Care · Customer — **out of PR-1**.

---

## 5. Final Verdict

## **BLOCKED**

**Reason (short):**  
No Water Motion **Cal.com webhook payload sample** is present in the handoff inbox or repository. Without it, field paths cannot be frozen, mismatches cannot be listed, and PR-1 cannot honestly upgrade Phase 0 from speculative envelope reads to “field-path-accurate” receive/verify work.

**What unblocks PR-1:**

1. Paste redacted `BOOKING_CREATED` (minimum) into [`CALCOM_IMPLEMENTATION_HANDOFF.md`](./CALCOM_IMPLEMENTATION_HANDOFF.md) §2  
2. Re-run this review to fill paths and flip verdict to **READY FOR PR-1 IMPLEMENTATION**  
3. (Recommended, not PR-1-hard) staging `CAL_WEBHOOK_SECRET` confirmed for live Cal test-send  

**Not blockers for architecture:** ownership model remains READY; Phase 0 receive endpoint already exists.

---

**No code change. No implementation. No deploy.**
