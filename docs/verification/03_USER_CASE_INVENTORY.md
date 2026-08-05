# 03 — User Case Inventory

**Total: 28 user/system cases**  
Format: ID · Name · Actor · Trigger · Preconditions · Main · Alternate · Error · Expected Result

---

### UC-01 Create Case (Booking)

| Field | Content |
|-------|---------|
| Actor | Customer (via Framer/API), System |
| Trigger | `POST /api/cases` |
| Preconditions | Valid payload; Notion up |
| Main | Validate → create Case (`notificationStatus=not_sent`) → return Case |
| Alternate | Dual-write ON → Customer match/create + link |
| Error | Validation/Notion fail → no Case / error |
| Expected | Case is ops SSOT; DW non-blocking |

### UC-02 Cancel appointment

| Field | Content |
|-------|---------|
| Actor | Operator / API |
| Trigger | `cancelAppointment` |
| Preconditions | Case exists |
| Main | Mark cancelled; offer slot may free |
| Alternate | Already cancelled |
| Error | Notion update fail |
| Expected | Case updated; Offer recount reflects inactive |

### UC-03 Customer preassessment submit

| Field | Content |
|-------|---------|
| Actor | Customer |
| Trigger | Preassessment API on Case |
| Preconditions | Case id valid |
| Main | Map payload → update Case fields |
| Alternate | Partial fields |
| Error | Invalid Case / Notion fail |
| Expected | Case holds preassessment data |

### UC-04 Offer status

| Field | Content |
|-------|---------|
| Actor | Public / Framer |
| Trigger | `GET /api/public/water-check-offer` |
| Preconditions | Notion readable |
| Main | Count active offer Cases → slots remaining |
| Alternate | Cache hit |
| Error | Notion/schema error |
| Expected | Offer SoT; no Customer Domain |

### UC-05 Booking with campaign offer

| Field | Content |
|-------|---------|
| Actor | Customer, System |
| Trigger | createCase with campaign offer |
| Preconditions | Slots available (caller may check UC-04 first) |
| Main | Case created with campaign field |
| Alternate | No campaign |
| Error | Create fail |
| Expected | Later counts include Case if active |

### UC-06 LINE link user to Case

| Field | Content |
|-------|---------|
| Actor | Customer (LINE), System |
| Trigger | Webhook link / feedback token link |
| Preconditions | Valid token / Case |
| Main | Set Case LINE; `notificationStatus=ready` if linked; optional DW |
| Alternate | Already linked |
| Error | Bad token / Notion fail |
| Expected | Case LINE retained |

### UC-07 LINE webhook intents / OA

| Field | Content |
|-------|---------|
| Actor | Customer, System |
| Trigger | `POST /api/line/webhook` |
| Preconditions | Valid signature |
| Main | Route event (follow, message, postback) |
| Alternate | Ignored event types |
| Error | Bad signature → reject |
| Expected | No Case notify write unless explicit send path |

### UC-08 Start Case

| Field | Content |
|-------|---------|
| Actor | Field tech |
| Trigger | `startCase` |
| Preconditions | Case exists; transition allowed |
| Main | Update workflow status |
| Alternate | Idempotent if already started |
| Error | Illegal transition / Notion fail |
| Expected | Case ops state advanced |

### UC-09 Close Case

| Field | Content |
|-------|---------|
| Actor | Field tech |
| Trigger | `closeCase` |
| Preconditions | Start completed as required |
| Main | Close; may prepare result URLs |
| Alternate | Already closed |
| Error | Illegal transition |
| Expected | Case closed; notify may follow |

### UC-10 Send Case result notification

| Field | Content |
|-------|---------|
| Actor | Tech / System |
| Trigger | `sendCaseResult` / execute path |
| Preconditions | Destination resolvable |
| Main | `sending` → LINE Flex → `sent` |
| Alternate | READ_NOTIFY destination resolve |
| Error | No LINE / API fail → `failed` |
| Expected | Case notification SM only; Care untouched |

### UC-11 Repair / retry result notification

| Field | Content |
|-------|---------|
| Actor | Tech / System |
| Trigger | `repairCaseResultNotification` / re-send |
| Preconditions | `failed` or recoverable state |
| Main | Re-enter send path |
| Alternate | Already `sent` → reusable result |
| Error | Persistent LINE failure |
| Expected | Case-owned recovery |

### UC-12 Mark notification failed

| Field | Content |
|-------|---------|
| Actor | System |
| Trigger | Send exception path |
| Preconditions | Send attempted |
| Main | Persist `failed` |
| Error | Persist fail |
| Expected | Honest failed state |

### UC-13 Public report view

| Field | Content |
|-------|---------|
| Actor | Customer / public |
| Trigger | Report URL `rpt-*` |
| Preconditions | Valid token |
| Main | Render report from Case |
| Alternate | API JSON variant |
| Error | Invalid token |
| Expected | Case data only |

### UC-14 Feedback via token

| Field | Content |
|-------|---------|
| Actor | Customer |
| Trigger | Feedback URL / API |
| Preconditions | Valid `fb-*` |
| Main | Upsert Feedback DB + Case status |
| Alternate | Update existing feedback |
| Error | Invalid token |
| Expected | Feedback DB + Case pointers |

### UC-15 Submit Case feedback (authenticated/tech path)

| Field | Content |
|-------|---------|
| Actor | Tech / system |
| Trigger | `submitCaseFeedback` |
| Preconditions | Case id |
| Main | Record feedback against Case |
| Error | Notion/Feedback fail |
| Expected | Consistent Case + Feedback |

### UC-16 Publish Case score / share card

| Field | Content |
|-------|---------|
| Actor | Tech / public image consumer |
| Trigger | `publishCaseScore` / score-card API |
| Preconditions | Score payload |
| Main | Persist score; generate card |
| Error | Missing data / render fail |
| Expected | Case-centric score assets |

### UC-17 Customer dual-write after Case create

| Field | Content |
|-------|---------|
| Actor | System |
| Trigger | After successful Case create |
| Preconditions | ENABLED + DUAL_WRITE + DB |
| Main | Exact match/create Customer; link |
| Alternate | Flags OFF → no-op |
| Error | DW error logged; Case remains |
| Expected | Non-blocking identity sync |

### UC-18 Customer dual-write after LINE link

| Field | Content |
|-------|---------|
| Actor | System |
| Trigger | After `linkLineUser` success |
| Preconditions | Same as UC-17 |
| Main | Sync LINE identity to Customer |
| Alternate | Flags OFF |
| Error | Non-blocking |
| Expected | Case LINE already set |

### UC-19 Customer LINE history read

| Field | Content |
|-------|---------|
| Actor | System / OA tools |
| Trigger | History/latest resolution |
| Preconditions | Flag matrix |
| Main | Customer exact LINE → Cases OR Case fallback |
| Alternate | Shadow compare |
| Error | Missing ids |
| Expected | No fuzzy match |

### UC-20 Notify destination resolve

| Field | Content |
|-------|---------|
| Actor | System (inside result send) |
| Trigger | `resolveNotifyLineDestination` |
| Preconditions | Case loaded |
| Main | Case LINE (default) |
| Alternate | Customer LINE if READ_NOTIFY; Case wins on diverge |
| Error | Empty destination |
| Expected | Read-only resolve |

### UC-21 Customer manual merge

| Field | Content |
|-------|---------|
| Actor | Identity steward |
| Trigger | Merge CLI/API |
| Preconditions | MERGE_ENABLED |
| Main | Manual merge per rules |
| Alternate | Rollback merge |
| Error | Validation reject |
| Expected | Never auto-merge |

### UC-22 Customer reconcile offline

| Field | Content |
|-------|---------|
| Actor | Operator |
| Trigger | `run-customer-reconcile.js` |
| Preconditions | Offline job |
| Main | Scan/report; optional repair |
| Alternate | Report-only |
| Error | Partial repair logged |
| Expected | No Care SEND; no Case notify rewrite |

### UC-23 Care dry-run scan

| Field | Content |
|-------|---------|
| Actor | Operator |
| Trigger | `run-care-lifecycle.js scan --mode=dry-run` |
| Preconditions | CLI; SEND false |
| Main | Evaluate → audit dry_run/skip → report |
| Alternate | Allow-disabled dry-run for local |
| Error | Notion load fail |
| Expected | Case `notificationStatus` unchanged |

### UC-24 Care SEND (gated — future)

| Field | Content |
|-------|---------|
| Actor | Operator post Checkpoint A |
| Trigger | `send --mode=write --limit=N` |
| Preconditions | ENABLED + SEND; human GO |
| Main | Audit send + `sendLinePush` |
| Alternate | Skip already_sent |
| Error | LINE fail → FAILED audit |
| Expected | Care Audit only; Case notify untouched |

### UC-25 Care outcome report

| Field | Content |
|-------|---------|
| Actor | Operator |
| Trigger | `run-care-outcome-report.js` |
| Preconditions | Audit files |
| Main | Rollup delivery/response/rebook |
| Alternate | `--with-cases` for attribution |
| Error | Missing files → empty |
| Expected | Read-only; no flag enable |

### UC-26 Care governance / CDR

| Field | Content |
|-------|---------|
| Actor | Operator, Reviewer |
| Trigger | Weekly review / policy proposal |
| Preconditions | Reports available |
| Main | Classify → CDR → approve → apply |
| Alternate | no_change |
| Error | Apply without approval (process) |
| Expected | No auto policy mutation |

### UC-27 Care / ops rollback

| Field | Content |
|-------|---------|
| Actor | On-call |
| Trigger | Incident / fail-pause |
| Preconditions | May have SEND on |
| Main | SEND=false then ENABLED=false |
| Alternate | SEND-only pause |
| Error | Env not restarted |
| Expected | No Case rewrite; retain audits |

### UC-28 Checkpoint A sign-off (Track A)

| Field | Content |
|-------|---------|
| Actor | Operator, Reviewer, On-call |
| Trigger | Ops meeting |
| Preconditions | Evidence pack complete |
| Main | Triple GO → humans may set flags later |
| Alternate | NO-GO |
| Error | Incomplete evidence |
| Expected | Docs do not mutate runtime |

---

## Coverage map

| Area | UC IDs |
|------|--------|
| Booking / Case / Offer | 01–05 |
| LINE / Workflow / Notify | 06–12 |
| Report / Feedback / Score | 13–16 |
| Customer Domain | 17–22 |
| Care / Governance / Track A | 23–28 |
