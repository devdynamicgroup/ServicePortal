# 02 — Architecture Verification (Implementation vs Approved)

**Approved references:** `docs/WATER_MOTION_ARCHITECTURE_GUIDE.md`, M8.* / M9.* architecture & plans, `docs/CUSTOMER_COMMUNICATION_ARCHITECTURE.md`, `docs/PROJECT_STATE.md`  
**Method:** Static code review of ownership writers/readers and flag defaults  
**Constraint:** No fix recommendations in this phase (deviations listed only)

---

## Verification matrix

| Check | Approved intent | As-built | Result |
|-------|-----------------|----------|--------|
| Case Ops SSOT | Case owns ops aggregate | Case create + workflow + Notion Clients | **Match** |
| Customer Identity only | Exact match; no fuzzy; Case LINE retained | `matcher.js` exact; Case LINE kept; dual-write gated | **Match** |
| Care isolated | Care ≠ Case notification lifecycle | Care uses `sendLinePush`; observes notify status only | **Match** |
| Notification ownership | Case `notificationStatus` SM | Written only in workflow / case-creation defaults | **Match** |
| Offer ownership | Offer service SoT for slots | `water-check-offer-service` counts Cases | **Match** |
| Workflow ownership | Workflow orchestrates Case ops | `workflow-service.js` | **Match** |
| Report ownership | Tokenized Case report | case-flow public report + Case tokens | **Match** |
| Feedback ownership | Feedback DB + Case status | `client-feedback` + workflow | **Match** |
| Customer flags | Default OFF; human-gated | `customer-domain/flags.js` | **Match** |
| Care flags | Default OFF; SEND needs ENABLED | `care-lifecycle/flags.js` + validation | **Match** |
| Rollout path | OFF→ENABLED→dry-run→SEND→ladder | Docs + gate scripts; no auto-promote | **Match** |
| No ownership leakage | Care/Customer not ops SSOT | No Care→`executeSendCaseResult` | **Match** |

---

## Matches

1. Result notification state machine remains Case-owned.  
2. Customer Domain is additive and flag-gated (dual-write, reads, merge).  
3. Care Audit is separate (file ± optional Notion); governance/CDR outside audit jsonl.  
4. Offer remains Case-count based.  
5. Care and Customer Domain flag families are independent.  
6. Track A is ops documentation only; runtime does not auto-enable SEND.

---

## Minor deviations

| ID | Deviation | Notes |
|----|-----------|-------|
| D1 | `CARE_OUTCOME_REPORT` does not strictly gate CLI report generation | Documented; observe-only |
| D2 | Migration/dual-write lives under `services/migration/` not inside `customer-domain/` | Intentional layering |
| D3 | Multiple Care checklists (M9.1 / M9.4 / M9.6) | Docs composition; Track A is front door |
| D4 | Care may call `notify-reader` when Customer READ_NOTIFY on | Same pattern as result notify; flags OFF today |
| D5 | Outcome fields always on CareAuditEvent schema; TRACKING gates write-back intent | M9.2 Option A |

---

## Major deviations

**None identified.**

---

## Summary

| Category | Count |
|----------|-------|
| Matches | All core ownership / flag / isolation checks |
| Minor deviations | 5 |
| Major deviations | **0** |

**Architecture verification: PASS (with minor docs/layering notes).**  
Production Care SEND still blocked on ops Checkpoint A, not on architecture mismatch.
