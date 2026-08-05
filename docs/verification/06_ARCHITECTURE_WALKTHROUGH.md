# 06 — Architecture Walkthrough

**Audience:** Senior backend engineer onboarding before Manual QA  
**Mode:** Analysis only — no code changes, no patches, no fixes, no flag enablement  
**Sources:** Implementation + `docs/verification/01`–`05`, `docs/WATER_MOTION_ARCHITECTURE_GUIDE.md`, M8–M9 docs  

Diagrams (system, sequences, ownership, flags) live in  
[`01_AS_BUILT_ARCHITECTURE.md`](./01_AS_BUILT_ARCHITECTURE.md) — open that file beside this walkthrough.  
User cases: [`03_USER_CASE_INVENTORY.md`](./03_USER_CASE_INVENTORY.md).  
QA: [`04_QA_MATRIX.md`](./04_QA_MATRIX.md).

---

# Chapter 1 — Overall Architecture

## Why this architecture exists

Water Motion runs a **field-service portal**: customers book water checks, technicians execute jobs, results go out on LINE, and customers can open reports and leave feedback. The product also has a **Framer/public booking** surface and a **LINE OA**.

The system grew as a **Case-centric** operational model on Notion. Later, two additive domains were introduced without rewriting production:

1. **Customer Domain (M8)** — a true identity record so the same person is not reinvented on every Case.  
2. **Care Lifecycle (M9)** — reinspection reminders and learning, **separate** from “we just finished your job” result notifications.

That split exists so you never confuse:

- “Did we send the **job result**?” (Case notification state machine)  
- “Should we send a **care reminder** six months later?” (Care Audit)  
- “Who is this person across Cases?” (Customer identity)

## Design philosophy

- **Extend, don’t rewrite.** Public APIs, Dashboard, Framer contracts, and LINE OA behavior stay stable.  
- **Feature flags default OFF.** New domains must not change production until humans decide.  
- **Exact identity only.** No fuzzy name merge.  
- **Human-gated Care send.** Dry-run and Checkpoint A exist because Care messages are customer-facing.  
- **Case remains the operational single source of truth.** Customer and Care attach to it; they do not replace it.

## Major domains and relationships

Think of three pillars:

| Pillar | Role |
|--------|------|
| **Case** | The job: booking data, workflow, offer link, result notify, report/feedback tokens |
| **Customer** | The person: phone/email/LINE ids, consent — identity only |
| **Care** | The follow-up policy: eligibility, Care Audit, outcomes, CDRs |

Everything else is supporting machinery:

- **Booking** — how a Case is born  
- **Offer** — campaign capacity counted from Cases  
- **Workflow** — how a Case moves and how results are sent  
- **Notification** — the Case result LINE path (not Care)  
- **Report / Feedback / Score** — post-job customer surfaces  
- **LINE** — transport + webhook  
- **Migration** — dual-write / reconcile / merge around Customer  

See Diagram 1 (system) and Diagram 11 (ownership) in `01_AS_BUILT_ARCHITECTURE.md`.

## Runtime boundaries

| Boundary | Meaning |
|----------|---------|
| HTTP API (`server.js` → `api/*`) | SPA, Framer, public tokens, LINE webhook |
| Services | Domain logic; Notion persistence |
| Care CLI (`scripts/run-care-lifecycle.js`, etc.) | Ops-driven Care; not the main SPA path |
| Flags | Customer Domain and Care are independently gated |

Today, with flags OFF, production behavior is essentially **pre-M8/M9 Case ops**. Customer and Care code is present but dormant unless operators enable it.

---

# Chapter 2 — Request Lifecycle

Imagine a customer journey end-to-end. This is the mental spine of the product.

```text
Customer → Landing / Framer
    → API
    → Booking (+ Offer check)
    → Case created
    → Workflow / Inspection (tech SPA)
    → Close
    → Report available
    → Result Notification (LINE)
    → Feedback
    → (months later) Care evaluation
```

### Where data appears

| Stage | Created | Updated | Read | Stored |
|-------|---------|---------|------|--------|
| Offer check | — | — | Active Cases with campaign | Computed (cached) |
| Booking | Case (+ tokens, `not_sent`) | — | Offer/campaign rules | Notion Cases |
| Dual-write (if ON) | Customer / link | Customer | Exact match keys | Notion Customers |
| LINE link | — | Case LINE, often `ready` | Token / webhook | Cases (± Customer) |
| Start/close | — | Workflow status | Case | Cases |
| Report | — | — | Case by `rpt-*` | Cases (public read) |
| Result notify | — | `sending`/`sent`/`failed`, `resultSentAt` | Dest LINE | Cases + LINE API |
| Feedback | Feedback row | Case feedback status | `fb-*` | Feedback DB + Cases |
| Care dry-run | CareAuditEvent | — | Case history | `tmp/care-lifecycle/` |
| Care send (if ON) | Care audit SENT/FAILED | — | Dest LINE | Audit + LINE push |

**Critical:** Care does **not** advance Case `notificationStatus`. Result notification and Care are different timelines that share LINE as transport.

Detailed sequences: Diagrams 4–8 in `01_AS_BUILT_ARCHITECTURE.md`. Full case list: UC-01–UC-28 in `03_USER_CASE_INVENTORY.md`.

---

# Chapter 3 — Domain Walkthrough

## Case

**Purpose.** The operational aggregate for one service job. If you ask “what happened on this booking?”, the answer lives on the Case.

**Why it exists.** Field ops, Framer, reports, and result LINE all need one durable record. Notion “Clients” DB is that record.

**Responsibilities.** Persist booking fields; hold workflow state; carry campaign offer linkage; retain Case LINE; own result notification state; hold report/feedback tokens and score fields.

**Owned data.** Essentially everything operational on the job page — including `notificationStatus` / `resultSentAt`.

**Dependencies.** Notion client/mapper; written by booking + workflow; read by offer, Care eligibility, public report.

**Entry points.** `POST /api/cases`, workflow APIs, LINE link, cancel.

**Exit points.** Public report/feedback URLs; LINE result message; dual-write hook; Care eligibility reads.

**Flags.** None of its own; always on.

**Failure handling.** Notion failures fail the request; dual-write failures must not undo Case create.

---

## Customer

**Purpose.** Stable identity across Cases — “same phone / email / LINE = same person” by **exact** match only.

**Why it exists.** Without it, identity scatters across Case rows. With fuzzy merge, you get silent wrong merges. Exact-only is a deliberate safety choice.

**Responsibilities.** Match/create/link; expose LINE/notify **reads** when flagged; manual merge; offline reconcile. **Not** booking, slots, or result notify state.

**Owned data.** `customerId`, normalized identifiers, `consentLine`.

**Dependencies.** Notion Customers DB; invoked via `services/migration/dual-write` and readers; Care may reuse notify-reader if `READ_NOTIFY` is on.

**Entry points.** Dual-write after Case create/link; line-reader; notify-reader; merge/reconcile CLIs.

**Exit points.** Link fields written back onto Case; metrics for shadow modes.

**Flags.** Entire `CUSTOMER_DOMAIN_*` family — **default false**. Master is `ENABLED`.

**Failure handling.** Dual-write is best-effort: Case remains valid if Customer sync fails. Merge refuses when flag off.

---

## Offer

**Purpose.** Tell Framer/public whether campaign slots remain.

**Why it exists.** Campaign capacity is a product constraint. The SoT is **counting Cases** with the campaign offer that are still active — not a separate inventory table.

**Responsibilities.** `getOfferStatus`, cache (~60s), classify active vs cancelled offer bookings.

**Owned data.** Computed status only (totals, used, remaining).

**Dependencies.** Notion Cases.

**Entry.** `GET /api/public/water-check-offer`.  
**Exit.** JSON consumed by booking UX.

**Flags.** None.  
**Failure.** Notion/schema issues surface as API errors; cache reduces stampede risk.

---

## Booking

**Purpose.** Safe intake path that creates a Case with correct defaults.

**Why it exists.** Validation, tokens (`fb-*`, `rpt-*`), initial `notificationStatus=not_sent`, and campaign offer resolution need a single create pipeline — `case-creation-service`.

**Responsibilities.** Validate; create Case; optional dual-write; cancel appointment; preassessment updates.

**Owned data.** No separate store — produces Cases.

**Dependencies.** Booking validation, Notion, offer naming/campaign helpers, dual-write.

**Entry.** Case create APIs / test helpers.  
**Exit.** Case id + tokens to clients; DW side effect.

**Flags.** Dual-write only when Customer flags allow.  
**Failure.** Validation → 4xx; Notion fail → no Case; DW fail → Case still exists.

---

## Workflow

**Purpose.** Orchestrate the job after it exists: link LINE, start, close, send result, feedback, score.

**Why it exists.** State transitions and “send result” are dangerous if scattered. `workflow-service` owns the orchestration and locking helpers.

**Responsibilities.** Transition rules; `executeSendCaseResult`; ensure feedback records; publish score; repair failed notifies.

**Owned data.** Does not own a DB — mutates Case (and Feedback via helper).

**Dependencies.** Notion, LINE notifications, notify-reader, dual-write on link, client-feedback.

**Entry.** Case-flow routes, LINE routes.  
**Exit.** Updated Case; LINE pushes; Feedback rows.

**Flags.** Notify destination affected by Customer `READ_NOTIFY*` when ENABLED.  
**Failure.** Illegal transitions rejected; send failures mark `failed`; repair/retry paths exist.

---

## Notification (result)

**Purpose.** Deliver the **job result** Flex message and keep an honest state machine on the Case.

**Why it is separate from Care.** “Result of today’s inspection” is operational completion. Care is a later lifecycle message. Mixing them corrupted ownership in earlier designs — hence the hard split.

**Responsibilities.** Resolve destination; set `sending` → push → `sent`/`failed`; repair.

**Owned data.** Case notification fields + message content via `line-notifications.sendCaseResultNotification`.

**Dependencies.** Workflow; LINE; optional Customer notify-reader.

**Entry.** Send/close/repair paths.  
**Exit.** LINE + Case status.

**Flags.** Destination only.  
**Failure.** No LINE → fail path; API errors → `failed`; retry via repair/send again.

---

## Report

**Purpose.** Let customers open a shareable report without logging into the tech SPA.

**Why.** Tokenized public access (`rpt-*`) keeps Notion auth out of customer browsers.

**Responsibilities.** Resolve Case by token; render HTML/API; score card images related to Case score.

**Owned data.** Presentation; content fields live on Case.

**Dependencies.** Case tokens from create/workflow; url-builder; score-share-card.

**Entry.** Public report routes.  
**Exit.** HTML/JSON/image.

**Flags.** None.  
**Failure.** Invalid token → deny.

---

## Feedback

**Purpose.** Capture customer feedback in a dedicated Feedback DB while Case keeps status/token.

**Why two stores.** Feedback volume and shape differ from Case ops fields; Case still needs “has feedback?” for workflow.

**Responsibilities.** Upsert Feedback; update Case feedback status through workflow.

**Owned data.** Feedback DB rows; Case holds pointers/status.

**Dependencies.** Workflow, Notion Feedback, tokens from Case create.

**Entry.** Public feedback URL / case feedback APIs.  
**Exit.** Feedback + Case updates.

**Flags.** None.  
**Failure.** Bad token → deny; DB errors fail the call.

---

## Care

**Purpose.** Evaluate who should get a **reinspection care** message, record an immutable Care Audit, optionally send LINE care content, measure outcomes, and improve via human CDRs.

**Why it exists.** Long-cycle care must not hijack the result-notification state machine. Care has its own audit trail under `tmp/care-lifecycle/` (and optional Notion Care Audits DB).

**Responsibilities.** Eligibility/policy; destination; sender (`sendLinePush` only); audit; outcomes; CLI run; governance is docs (M9.3–M9.5).

**Owned data.** CareAuditEvent (+ outcome fields), run reports, CDRs (docs).

**Dependencies.** Case history (read); LINE push; optional notify-reader; **never** `executeSendCaseResult`.

**Entry.** `scripts/run-care-lifecycle.js`, outcome/governance CLIs.  
**Exit.** Audit files, optional LINE care message, outcome JSON.

**Flags.** `CARE_LIFECYCLE_ENABLED`, `SEND`, `OUTCOME_*` — all default **false**. SEND requires ENABLED.

**Failure handling.** Skips with reasons; send failures → FAILED audit; rollback is **flag-only**; Case notification untouched by design (asserted in tests).

---

# Chapter 4 — Sequence Walkthrough

Narratives below match UC inventory and sequences in `01`. Use them as QA mental scripts.

### Create Case

1. Client posts booking payload.  
2. Validation runs.  
3. System defaults attach feedback/report tokens; `notificationStatus=not_sent`.  
4. Notion Case created.  
5. If Customer ENABLED+DUAL_WRITE: exact match or create Customer; link Case (best-effort).  
6. Response returns Case. Offer counts will include it if campaign-active.

### Cancel Booking

1. Cancel API with Case id.  
2. Case marked cancelled/inactive for offer purposes.  
3. Next offer status recount frees a slot.  
4. No Care send; no result notify required.

### Merge Customer

1. Steward runs merge with `MERGE_ENABLED`.  
2. Validator enforces exact rules — not name fuzzy.  
3. Surviving Customer updated; losers linked/retired per merge design.  
4. Rollback path exists; Case notification SM untouched.

### Reconcile

1. Offline CLI scans Cases vs Customers.  
2. Report-only or repair mode.  
3. Repairs identity drift only.  
4. Must not rewrite `notificationStatus`.

### Send Result

1. Tech/API invokes send (or close path leads here).  
2. Destination resolved (Case LINE; Customer if READ_NOTIFY).  
3. Case → `sending`.  
4. Result Flex via `sendCaseResultNotification`.  
5. Success → `sent` + timestamp; failure → `failed`.

### Retry Notification

1. Start from `failed` (or repair helper).  
2. Re-enter send path.  
3. Same ownership: Case fields only.  
4. Care audits stay out of this loop.

### Care Dry Run

1. Operator runs scan `--mode=dry-run`.  
2. Eligibility/policy classify each Case.  
3. Care Audit records `dry_run` or `skipped` + reason.  
4. Report shows `notificationStatusBefore === After`.  
5. No customer-facing Care push.

### Care Send

1. Only after human flags ENABLED+SEND and Track A Checkpoint A.  
2. Limit ladder (10 → 50 → uncapped).  
3. Audit SENDING → LINE `sendLinePush` → SENT/FAILED.  
4. Fail-pause and rollback cards apply.  
5. Still no Case notification writes.

### Care Outcome

1. `run-care-outcome-report.js` reads audits (± Cases).  
2. Delivery mirrored from audit status; rebook via exact id/LINE within 30d.  
3. Writes `latest-outcome-report.json`.  
4. Does not enable SEND.

### Policy Review

1. Weekly classify (healthy / investigate / propose_change).  
2. CDR for timing/copy/throttle/eligibility.  
3. Reviewer approves; operator applies; dry-run validates.  
4. No auto-tuning.

### Track A

1. Fill evidence pack from dry-runs.  
2. Operator + Reviewer + On-call sign GO/NO-GO.  
3. GO authorizes **humans** to set flags — documents never set env.  
4. Then first-send plan; M9.5 steady state after uncapped.

---

# Chapter 5 — Data Ownership

### Who owns what (and why)

| Data | Owner | Why |
|------|-------|-----|
| Booking & job fields | Case | Ops truth for the visit |
| `notificationStatus` / `resultSentAt` | Case | Result-send lifecycle only |
| Case LINE fields | Case | Retained fallback even if Customer exists |
| Campaign offer on Case | Case (Offer reads) | Slots are Case counts |
| Feedback token/status on Case | Case | Workflow needs status |
| Feedback body/ratings | Feedback DB | Separate concern |
| Report token / report content | Case | Public report projects Case |
| `customerId` + identifiers | Customer | Identity SSOT |
| `consentLine` | Customer | Consent is identity-adjacent |
| CareAuditEvent | Care | Separate from result notify |
| CDR markdown | Care governance docs | Decisions ≠ delivery history |

### Must never be modified by the wrong owner

- Care must **never** write Case `notificationStatus` / `resultSentAt`.  
- Customer Domain must **never** become ops SSOT or invent fuzzy merges.  
- Offer must **not** invent a parallel Case store.  
- Result notify must **not** write Care audits (and vice versa for Case notify).  
- Do **not** delete Care audit / idempotency index mid-incident “to clean up.”

### What may be denormalized

- Case may store a **link** to `customerId` and retain LINE for fallback.  
- Case may store feedback/report **tokens** while bodies live elsewhere.  
- Care destination may **read** Customer LINE when flags say so — still a read, not ownership transfer.  
- Shadow modes may compute compare metrics without changing who is authoritative.

---

# Chapter 6 — Flags

All defaults below are **false** unless noted. Enablement is **human ops**, usually with M8.8 / M9.4 checklists — not app auto-promotion.

### Customer Domain

| Flag | Default | Depends on | Who enables | Rollback | Risks |
|------|---------|------------|-------------|----------|-------|
| `CUSTOMER_DOMAIN_ENABLED` | false | — | Ops after M8 gates | Set false | Master; other flags should not run alone long-term |
| `DUAL_WRITE` | false | ENABLED + Customers DB | Ops | false | Partial identity if DW fails (Case still OK) |
| `READ_LINE` | false | ENABLED | Ops | false | Wrong history if bad links |
| `READ_LINE_SHADOW` | false | ENABLED; ignored if READ_LINE | Ops | false | Metric noise only |
| `READ_NOTIFY` | false | ENABLED | Ops | false | Wrong recipient if diverge mishandled — Case-wins rule exists |
| `READ_NOTIFY_SHADOW` | false | ENABLED; ignored if READ_NOTIFY | Ops | false | Compare only |
| `MERGE_ENABLED` | false | ENABLED | Steward | false | Merge mistakes — keep manual |

### Care

| Flag | Default | Depends on | Who enables | Rollback | Risks |
|------|---------|------------|-------------|----------|-------|
| `CARE_LIFECYCLE_ENABLED` | false | — | Ops (Phase 1) | false | Evaluation/cron load |
| `CARE_LIFECYCLE_SEND` | false | ENABLED | Ops after Checkpoint A | **false first** | Customer-facing care spam |
| `CARE_OUTCOME_TRACKING` | false | — | Ops optional | false | Audit enrichment writes |
| `CARE_OUTCOME_REPORT` | false | — | Ops optional | false | CLI may still read files without it |
| `CARE_REINSPECTION_DAYS` | 182 | — | Ops via CDR for changes | prior value | Timing thrash |

**Independence:** Care SEND does **not** require Customer Domain flags.  
**Rollback Care:** `SEND=false` then `ENABLED=false` if needed — see M9.4 rollback card.

Flag relationship diagram: Diagram 12 in `01`.

---

# Chapter 7 — Failure Scenarios

### LINE unavailable during result send

**Expected:** Case moves to `failed` (or never reaches `sent`).  
**Recovery:** Repair/retry when LINE recovers.  
**Not expected:** Care Audit changes; Customer identity rewrite.

### LINE unavailable during Care send

**Expected:** Care audit `failed`; Case `notificationStatus` unchanged.  
**Recovery:** Fix LINE; re-run with idempotency; or pause SEND.  
**Rollback:** Flag-only if spike.

### Notion timeout on Case create

**Expected:** Request fails; no Case (or incomplete — treat as error).  
**Recovery:** Retry create; do not assume dual-write ran.

### Notion timeout mid-workflow

**Expected:** Transition/send fails for that call; Case may be mid-state (`sending` possible).  
**Recovery:** Repair/retry paths; inspect Case status before resending.

### Duplicate booking

**Expected:** Two Cases if API called twice with two payloads — product may allow; offer counts both if both active.  
**Recovery:** Cancel duplicate; ops judgment.  
**Not:** Auto-merge Customers by name.

### Notification crash after `sending`

**Expected:** May leave `sending` until timeout/repair logic; must not claim `sent` without success.  
**Recovery:** `repairCaseResultNotification` / re-send.

### Care disabled (flags OFF)

**Expected:** No care pushes; dry-run may still be used with CLI allow-disabled patterns for fixtures.  
**Recovery:** N/A — safe default for production today.

### Customer merge conflict

**Expected:** Validator rejects unsafe merge when MERGE on; when OFF, execute refused.  
**Recovery:** Steward resolves manually; rollback merge if supported.

### Dual-write failure

**Expected:** Case remains; identity may be missing until reconcile/backfill.  
**Recovery:** Reconcile / retry DW paths — do not delete Case.

---

# Chapter 8 — Architecture Validation

### Matches design well

- Case as Ops SSOT  
- Customer identity-only + exact match  
- Care isolated from Case notification SM  
- Flag defaults OFF; Care ⊥ Customer  
- Offer as Case-count SoT  
- Result notify owned by workflow  

### Intentionally different / layered

- Dual-write/migration live under `services/migration/` (not inside `customer-domain/`) — layering, not ownership break  
- Care uses shared LINE **transport** (`sendLinePush`) but not result-notify API  
- Outcome report CLI can run without `CARE_OUTCOME_REPORT` — observe convenience  

### Minor deviations (no fixes here)

Listed in `02_ARCHITECTURE_COMPARISON.md` (checklist sprawl, outcome flag semantics, etc.).  
**Major deviations: none** in verification.

---

# Chapter 9 — Mental Model

**If you remember only these points before changing anything:**

1. Case is the operational SSOT for a job.  
2. Customer is identity only — never ops workflow.  
3. Care is a separate lifecycle from result notification.  
4. `notificationStatus` is sacred to Case result-send.  
5. Care writes Care Audit, not Case notify fields.  
6. Care sends via `sendLinePush`, not `executeSendCaseResult`.  
7. Exact match only — no fuzzy name merge.  
8. Case LINE fields stay as fallback forever.  
9. All Customer Domain flags default OFF.  
10. All Care flags default OFF.  
11. Care SEND requires ENABLED.  
12. Care and Customer flags are independent.  
13. Dual-write must not fail Case create.  
14. Offer capacity is counted from Cases.  
15. Feedback body ≠ Case; Case holds tokens/status.  
16. Report is tokenized Case projection.  
17. Shadow read modes never flip authority silently.  
18. READ_NOTIFY: Case wins on LINE diverge.  
19. Idempotency protects Care from duplicate sends.  
20. Multi-instance Care cron is an ops hazard — single runner.  
21. Dry-run before SEND; never skip Track A evidence.  
22. Checkpoint A is human GO — docs don’t set env.  
23. Rollback Care with flags only — don’t rewrite Cases.  
24. Don’t delete Care audits mid-incident.  
25. Policy changes need CDR + Reviewer.  
26. No auto-tuning / ML policy mutation.  
27. Extend production contracts; don’t casually break Framer/LINE/Dashboard.  
28. Manual QA matrix Actual columns stay blank until observed.  
29. Prefer reading `docs/verification/` + architecture guide before coding.  
30. If a change moves ownership between Case/Customer/Care — stop and get explicit approval.

---

## Suggested reading order for QA week

1. This walkthrough (06)  
2. Diagrams in 01  
3. User cases in 03  
4. Comparison in 02  
5. Fill Track A evidence while running Care dry-runs  
6. Execute 04 QA matrix on staging  
7. Only then consider Checkpoint A signatures  

**Do not enable production Care SEND from this document.**
