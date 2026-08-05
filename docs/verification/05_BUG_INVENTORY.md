# 05 — Bug Inventory (Confirmed Findings Only)

**Mode:** Document only — **do not fix**  
**Standard:** Report only issues verified by static analysis against intended architecture or known-by-design tradeoffs explicitly called out. Speculative items omitted.

---

## Categories used

Logic · Data consistency · State management · API · UI · Performance · Operational · Documentation

---

## Confirmed findings

| ID | Category | Severity | Title | Verified basis | Notes |
|----|----------|----------|-------|----------------|-------|
| F01 | Operational | Medium | Checkpoint A evidence not filled | Evidence pack is blank template; no archived dry-run proof attached in-repo | Blocks human GO, not a code defect |
| F02 | Operational | Medium | Checkpoint A unsigned | Sign-off record status awaiting signatures | Process gate |
| F03 | Operational | Medium | Care single-runner not enforced in software | Runbooks require single runner; no distributed lock in care-lifecycle | Idempotency mitigates duplicates; multi-instance residual risk |
| F04 | Documentation | Low | Overlapping Care go/no-go checklists | M9.1 + M9.4 + M9.6 Track A coexist | Front door documented as Track A |
| F05 | Documentation | Low | Outcome REPORT flag vs CLI | CLI can generate file report while `CARE_OUTCOME_REPORT=false` | Documented independence |
| F06 | Reliability | Low | Dual-write best-effort by design | Case create succeeds if dual-write fails when flags ON | Intentional M8 tradeoff; latent identity gap if flags ON |

---

## Not listed as bugs (verified intentional)

| Topic | Why excluded |
|-------|----------------|
| Care not calling `executeSendCaseResult` | Required isolation |
| All Care/Customer flags default false | Required gating |
| Care reading `notificationStatus` for before/after | Observe-only |
| Exact-match-only identity | Architecture lock |
| Empty Actual columns in QA matrix | Required blank for manual QA |

---

## Categories with zero confirmed defects (this pass)

| Category | Confirmed count |
|----------|-----------------|
| Logic | **0** |
| Data consistency (active with flags OFF) | **0** |
| State management | **0** |
| API | **0** |
| UI | **0** |
| Performance | **0** |

---

## Summary

| Severity | Count |
|----------|-------|
| High | 0 |
| Medium | 3 (all operational/process) |
| Low | 3 |

**No logic bugs confirmed in Care↔Case notification isolation or ownership inversion.**  
**Do not treat this inventory as authorization to change code.**
