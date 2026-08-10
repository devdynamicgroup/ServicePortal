# Project State — Water Motion Service Portal

**Updated:** 2026-08-05 (architecture verification & QA prep)

## Milestones

| Milestone | Status |
|-----------|--------|
| M3–M7 | Complete |
| M8.1–M8.9 Customer Domain | Complete (flags OFF; governance docs) |
| M9.0 Care Lifecycle Events | Implemented — `care.reinspection_6mo`; CARE flags **OFF** |
| M9.1 Care Ops Readiness | **Ops package complete** — **CARE flags still OFF** |
| M9.2 Care Outcome Reporting | **Implemented** — **CARE_SEND OFF** |
| M9.3 Care Decision Governance | **Implemented** — CDR + review; **no SEND** |
| M9.4 Care Production Rollout Readiness | **Package implemented** — **flags remain OFF**; no production SEND |
| M9.5 Care Steady State & Optimization | **Package implemented** — handbook + metrics/CDR/incident ops; **no SEND** |
| M9.6 Track A | Launch checklist + evidence pack ready; Checkpoint A **unsigned**; **flags OFF** |
| Architecture verification | **Complete** — `docs/verification/` (analysis only; no SEND) |
| Cal.com → Case bridge | **Architecture review only** — `docs/CALCOM_CASE_BRIDGE_ARCHITECTURE_REVIEW.md` (no code / no deploy) |
| Cal.com integration readiness | **Design closed** — see DDR below (was Verdict B) |
| Cal.com Design Decision Record | **CLOSED / READY FOR IMPLEMENTATION** — `docs/CALCOM_BOOKING_INTEGRATION_DESIGN_DECISION_RECORD.md` (no code yet) |
| Cal.com Implementation Gate | **B — READY WITH CONDITIONS** — `docs/CALCOM_IMPLEMENTATION_GATE.md` (CAL-G01…G05 open; no code) |
| Cal.com Blocker Resolution | **B retained** — `docs/CALCOM_BLOCKER_RESOLUTION.md` (G02/G04/G05 closed; G01/G03 need Cal/Product) |
| Cal.com Phase 0 | **Receive-only webhook** — `POST /api/cal/webhook` (no createCase / no Notion write) |
| Cal.com Implementation Handoff | **READY TO RECEIVE INPUT** — `docs/CALCOM_IMPLEMENTATION_HANDOFF.md` (waiting external inputs for PR-1) |
| Cal.com Phase 1 Impl Review | **BLOCKED** — `docs/CALCOM_PHASE1_IMPLEMENTATION_REVIEW.md` (no WM Cal payload in workspace) |
| Cal.com Payload Validation | **BLOCKED** — `docs/CALCOM_PAYLOAD_VALIDATION.md` (claimed attachment not received) |

## Runtime

- Case = operational SSOT  
- Customer = identity only  
- Care = policy + events + audits + outcomes + CDRs  
- **All Customer Domain flags OFF**  
- **CARE_LIFECYCLE_ENABLED / SEND default OFF**  
- **CARE_OUTCOME_TRACKING / REPORT default OFF** (REPORT may be recommended post-uncapped — human only)  
- Production SEND requires **M9.4 Checkpoint A** — not executed by M9.5  

## Care ops (M9.1–M9.5)

```bash
node scripts/check-care-rollout-gates.js
node scripts/check-care-production-readiness.js
node scripts/check-care-steady-state.js
node scripts/test-care-lifecycle.js
node scripts/run-care-lifecycle.js scan --event=reinspection_6mo --mode=dry-run
node scripts/test-care-outcomes.js
node scripts/run-care-outcome-report.js
node scripts/check-care-patterns.js
node scripts/test-care-governance.js
node scripts/test-care-production-readiness.js
node scripts/test-care-steady-state.js
```

Docs: `docs/M9.5_CARE_STEADY_STATE_HANDBOOK.md` · `docs/M9.5_CARE_METRICS_OWNERSHIP.md` · `docs/M9.5_CARE_CDR_OPERATIONS.md` · `docs/M9.5_CARE_INCIDENT_OPERATIONS.md` · `docs/M9.4_CARE_PRODUCTION_RUNBOOK.md` · `docs/M9.3_CARE_DECISION_RECORDS.md`

## References

- `docs/CALCOM_CASE_BRIDGE_ARCHITECTURE_REVIEW.md` — public booking gap (Cal.com) → proposed Case bridge
- `docs/M9.0_IMPLEMENTATION_PLAN.md`
- `docs/M9.1_ARCHITECTURE_REVIEW.md`
- `docs/M9.1_IMPLEMENTATION_PLAN.md`
- `docs/M9.2_ARCHITECTURE_REVIEW.md`
- `docs/M9.2_IMPLEMENTATION_PLAN.md`
- `docs/M9.3_ARCHITECTURE_REVIEW.md`
- `docs/M9.3_IMPLEMENTATION_PLAN.md`
- `docs/M9.4_ARCHITECTURE_REVIEW.md`
- `docs/M9.4_IMPLEMENTATION_PLAN.md`
- `docs/M9.5_ARCHITECTURE_REVIEW.md`
- `docs/M9.5_IMPLEMENTATION_PLAN.md`
- `docs/M9.6_ARCHITECTURE_REVIEW.md`
- `docs/M9.6_TRACK_DECISION.md`
- `docs/M9.6_TRACK_A_LAUNCH_CHECKLIST.md`
- `docs/M9.6_CHECKPOINT_A_EVIDENCE_PACK.md`
- `docs/M9.6_CHECKPOINT_A_SIGNOFF_RECORD.md`
- `docs/verification/README.md`
- `docs/CUSTOMER_COMMUNICATION_ARCHITECTURE.md`
