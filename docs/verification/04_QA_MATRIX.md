# 04 — Manual QA Matrix

**Mode:** Manual testing preparation  
**Rule:** Leave **Actual / Pass-Fail / Notes** blank until a human runs the test  
**Baseline:** All `CUSTOMER_DOMAIN_*` and Care SEND flags **OFF** unless the row says staging-flag-on  

| Flow | Test Case | Expected | Actual | Pass/Fail | Notes |
|------|-----------|----------|--------|-----------|-------|
| Booking | QA-B01 Valid create Case | Case created; `notificationStatus=not_sent` | | | |
| Booking | QA-B02 Invalid payload | 4xx; no Case | | | |
| Booking | QA-B03 Dual-write OFF | Case OK without Customer | | | |
| Booking | QA-B04 Cancel appointment | Case cancelled; offer recount sane | | | |
| Booking | QA-B05 Preassessment submit | Case fields updated | | | |
| Offer | QA-O01 GET offer status | Slots match active Cases | | | |
| Offer | QA-O02 New offer Case | Used slots increase | | | |
| Offer | QA-O03 Cancel frees slot | Remaining increases | | | |
| Offer | QA-O04 Cache behavior | Stable under refresh; no crash | | | |
| Workflow | QA-W01 startCase | Valid transition | | | |
| Workflow | QA-W02 closeCase | Case closed | | | |
| Workflow | QA-W03 Illegal transition | Rejected safely | | | |
| LINE | QA-L01 Link user | Case LINE set; ready if applicable | | | |
| LINE | QA-L02 Bad webhook signature | Rejected | | | |
| LINE | QA-L03 History flags OFF | Case LINE path | | | |
| Notification | QA-N01 Send with LINE | sending→sent; message received | | | |
| Notification | QA-N02 Send without LINE | failed/skip; not falsely sent | | | |
| Notification | QA-N03 LINE API error | notificationStatus=failed | | | |
| Retry | QA-N04 Re-send after failed | Can reach sent | | | |
| Recovery | QA-N05 Repair notification | Recoverable per design | | | |
| Notification | QA-N06 Care OFF during result send | No Care Audit side effects | | | |
| Report | QA-R01 Valid rpt token | Report renders | | | |
| Report | QA-R02 Invalid token | Denied | | | |
| Feedback | QA-F01 Valid fb token | Feedback DB + Case status | | | |
| Feedback | QA-F02 Invalid token | Denied | | | |
| Feedback | QA-F03 Resubmit/update | Consistent upsert | | | |
| Score | QA-S01 Publish score | Persisted | | | |
| Score | QA-S02 Score card image | Asset loads | | | |
| Customer Identity | QA-CI01 Exact phone match (staging DW) | Links existing Customer | | | |
| Customer Identity | QA-CI02 No name fuzzy merge | Separate identities remain | | | |
| Customer Identity | QA-CI03 Flags OFF create Case | No Customer required | | | |
| Merge | QA-M01 MERGE OFF | Execute refused | | | |
| Merge | QA-M02 Manual merge staging | Steward rules; rollback works | | | |
| Reconcile | QA-RC01 Scan-only | Report only; no Case notify writes | | | |
| Reconcile | QA-RC02 Repair mode | Only intended identity fixes | | | |
| Notify dest | QA-ND01 Flags OFF | Case LINE used | | | |
| Notify dest | QA-ND02 READ_NOTIFY staging | Customer LINE when appropriate | | | |
| Notify dest | QA-ND03 Diverge staging | Case wins | | | |
| LINE lookup | QA-LL01 READ_LINE_SHADOW | Case authoritative | | | |
| LINE lookup | QA-LL02 READ_LINE primary | Exact Customer LINE → Cases | | | |
| Care lifecycle | QA-CF01 Dry-run | Audits written; no care push | | | |
| Care lifecycle | QA-CF02 ENABLED SEND false | Send refused | | | |
| Care lifecycle | QA-CF03 SEND without ENABLED | Refused/warned | | | |
| Care eligibility | QA-CF04 too_recent | skipped | | | |
| Care eligibility | QA-CF05 missing_anchor | skipped | | | |
| Care eligibility | QA-CF06 no_line | skipped | | | |
| Care eligibility | QA-CF07 consent_line_false | skipped | | | |
| Care eligibility | QA-CF08 eligible dry_run | dry_run audit; Case notify unchanged | | | |
| Care audit | QA-CA01 events.jsonl | Appended | | | |
| Care audit | QA-CA02 notify before=after | Unchanged | | | |
| Care audit | QA-CA03 No historical rewrite | Past rows intact after report | | | |
| Idempotency | QA-ID01 Second scan | No duplicate planned send | | | |
| Idempotency | QA-ID02 Index retained | File present | | | |
| Outcome reporting | QA-OR01 Generate report | latest-outcome-report.json | | | |
| Outcome reporting | QA-OR02 Rebook exact id 30d | rebooked | | | |
| Outcome reporting | QA-OR03 Name-only Case | Not attributed | | | |
| Outcome reporting | QA-OR04 no_response 7d | Measured | | | |
| Governance | QA-GV01 CDR process | No apply without approval | | | |
| Governance | QA-GV02 check-care-patterns | Advisory; flags unchanged | | | |
| Governance | QA-GV03 check-care-steady-state | No SEND enable | | | |
| Rollback | QA-RB01 Flag order | SEND then ENABLED | | | |
| Rollback | QA-RB02 Non-actions | No Case rewrite; audits kept | | | |
| Feature flags | QA-FF01 Defaults | Customer+Care OFF | | | |
| Feature flags | QA-FF02 Ops readiness | Flag meta; no secrets | | | |
| Feature flags | QA-FF03 Care ⊥ Customer | Care dry-run with Customer OFF | | | |
| Track A | QA-TA01 Evidence pack fillable | From dry-run artifacts | | | |
| Track A | QA-TA02 Sign-off unsigned | Does not set env | | | |
| Track A | QA-TA03 No prod SEND in QA phase | SEND remains false | | | |
| Edge | QA-EC01 Empty eligible set | Clean empty report | | | |
| Edge | QA-EC02 Thai/Unicode names | No crash | | | |
| Edge | QA-EC03 No Care Notion DB | File audit works | | | |
| Security | QA-SEC01 Invalid public tokens | Denied | | | |
| Security | QA-SEC02 Webhook signature | Reject bad sig | | | |
| Security | QA-SEC03 Care logs | Dest hashed / samples safe | | | |
| Performance | QA-PERF01 Dry-run full set | Completes acceptably | | | |
| Performance | QA-PERF02 Offer under refresh | Cache OK | | | |
| Reliability | QA-REL01 Dual-write fail | Case still created | | | |
| Reliability | QA-REL02 Care push fail staging | Audit FAILED; Case notify OK | | | |
| Documentation | QA-DOC01 PROJECT_STATE vs flags | Both OFF | | | |
| Documentation | QA-DOC02 verification docs present | README→05 linked | | | |

**Row count: 80**

---

## QA execution notes

1. Do not enable production `CARE_LIFECYCLE_SEND` during this matrix unless Checkpoint A is signed and staging/prod policy allows.  
2. Prefer staging for any Customer Domain ON tests.  
3. Record Actual/Pass/Fail only after observing the system.
