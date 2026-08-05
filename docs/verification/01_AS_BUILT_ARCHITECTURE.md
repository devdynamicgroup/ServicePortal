# 01 — As-Built Architecture (Discovery)

**Source of truth for this doc:** current codebase (reverse-engineered)  
**Intended architecture reference:** `docs/WATER_MOTION_ARCHITECTURE_GUIDE.md`, M8–M9 docs  
**Entry points:** `server.js` · SPA `index.html` / `src/js/app.js`

---

## Phase 1 — High-level architecture

### 1.1 Domains and module boundaries

| Domain | Primary modules | Responsibility |
|--------|-----------------|----------------|
| **Booking** | `case-creation-service.js`, `booking-validation.js` | Validate intake; create Case with system defaults |
| **Case** | `notion/clients.js`, `notion/mapper.js` | Persist operational aggregate (“Clients” Notion DB) |
| **Offer** | `water-check-offer-service.js` | Campaign slot capacity SoT (counts active offer Cases) |
| **Workflow** | `workflow-service.js` | LINE link, start/close, result send SM, feedback bridge, score |
| **Notification (result)** | `workflow-service.js` + `line-notifications.js` | Case-owned `notificationStatus` + result Flex push |
| **Customer Domain** | `services/customer-domain/*` | Identity match/create/link; LINE/notify **read** paths |
| **Migration** | `services/migration/*` | Dual-write, backfill, reconcile, merge (adjacent to Customer) |
| **Care Lifecycle** | `services/care-lifecycle/*` | Eligibility, Care Audit, care LINE push, outcomes |
| **Feedback** | `client-feedback.js` + workflow | Feedback Notion DB + Case feedback status/tokens |
| **Report / Score** | case-flow public routes, `url-builder`, `score-share-card` | Tokenized public report + score assets |
| **LINE OA** | `api/line-routes.js`, `line-notifications.js` | Webhook, signature, push/reply |
| **Ops / Care CLI** | `api/ops-routes.js`, `scripts/run-care-*.js` | Health/readiness; Care scan/report (not SPA-critical) |

### 1.2 Ownership (who owns / may read / may update / lifecycle)

#### Case (Operational SSOT)

| Aspect | Detail |
|--------|--------|
| **Owns** | Booking fields, job/workflow status, campaign offer link, Case LINE fields, `notificationStatus` / `resultSentAt`, feedback status + tokens, report tokens, score fields |
| **May read** | Workflow, offer counter, Care eligibility, Customer linker (link fields), public report/feedback by token, SPA/API |
| **May update** | `case-creation-service`, `workflow-service`, `notion/clients` writers used by those services; cancel appointment paths |
| **Must not update** | Care runtime (observe only); Customer Domain must not rewrite Case notification SM |
| **Lifecycle** | create (`not_sent`) → link LINE (`ready`) → start → close → send result (`sending`/`sent`/`failed`) → feedback/report/score |

#### Customer (Identity only)

| Aspect | Detail |
|--------|--------|
| **Owns** | `customerId`, normalized phone/email/LINE ids, `consentLine`, identity timestamps |
| **May read** | dual-write/resolver, line-reader, notify-reader, Care destination (if READ_NOTIFY), merge/reconcile |
| **May update** | `customer-domain/repository` via creator/resolver/linker/merge/reconcile — **only when flags allow** |
| **Lifecycle** | match exact → create if needed → link Case; optional manual merge; consent may flip later |
| **Must not own** | Booking, workflow, offer slots, result notification state, Care policy |

#### Offer

| Aspect | Detail |
|--------|--------|
| **Owns** | Slot total/remaining computation for named campaign offer |
| **May read** | Public API, booking create (campaign resolution) |
| **May update** | Does not own Case rows; Case cancel/create changes counts indirectly |
| **Lifecycle** | Cache (~60s) → recount active offer Cases → status JSON |

#### Workflow

| Aspect | Detail |
|--------|--------|
| **Owns** | Case state transitions and orchestration of result send / feedback ensure |
| **May read** | Case, Feedback DB, notify-reader, LINE |
| **May update** | Case via Notion; Feedback via `client-feedback`; dual-write after link |
| **Lifecycle** | Per Case operational progression (see Case) |

#### Booking

| Aspect | Detail |
|--------|--------|
| **Owns** | Intake validation + initial Case shape (not a separate DB entity) |
| **May read** | Offer status for campaign |
| **May update** | Creates Case; triggers dual-write hook |
| **Lifecycle** | Request → validate → Case create → optional Customer sync |

#### Feedback

| Aspect | Detail |
|--------|--------|
| **Owns** | Feedback Notion DB records |
| **Case holds** | feedback token/status pointers |
| **May update** | `recordFeedback` / `submitCaseFeedback` / ensure helpers |
| **Lifecycle** | token issued at create → customer submits → Case status updated |

#### Report

| Aspect | Detail |
|--------|--------|
| **Owns** | Public presentation of Case report data via `rpt-*` token |
| **May read** | Public/unauthenticated with valid token |
| **May update** | Report content lives on Case; tokens set at create/workflow |
| **Lifecycle** | token → public HTML/API → optional score card |

#### Notification (result send)

| Aspect | Detail |
|--------|--------|
| **Owns** | Case `notificationStatus` state machine + result Flex content |
| **May read** | Destination via Case LINE and optional Customer notify-reader |
| **May update** | **Only** workflow-service Case updates (`sending`/`sent`/`failed`) |
| **Lifecycle** | `not_sent` → `ready` → `sending` → `sent` \| `failed` → repair/retry |
| **Isolated from** | Care Audit / Care SEND |

#### Care

| Aspect | Detail |
|--------|--------|
| **Owns** | Eligibility policy, CareAuditEvent store, care templates, outcomes, governance docs/CDRs |
| **May read** | Case history for eligibility; optional Customer LINE if READ_NOTIFY |
| **May update** | Care audit files (± Notion Care Audits); **never** Case `notificationStatus` |
| **Lifecycle** | evaluate → skip/dry_run/send → audit → optional outcome measure → CDR for policy change |
| **Flags** | ENABLED / SEND / OUTCOME_* default OFF; SEND requires ENABLED |

---

## Phase 2 — Diagrams

### Diagram 1 — System diagram

```mermaid
flowchart TB
  subgraph External
    SPA[Field Tech SPA]
    Framer[Framer / Booking]
    LINEU[LINE Users]
    Public[Public Web]
  end

  subgraph App["Node server.js"]
    API[API Routers]
    WF[Workflow]
    Book[Booking / Case Create]
    Offer[Offer Service]
    LN[LINE Notifications]
    CD[Customer Domain]
    Care[Care Lifecycle]
    Mig[Migration Dual-Write]
    FB[Feedback Service]
  end

  subgraph Data
    Cases[(Notion Cases)]
    Cust[(Notion Customers)]
    FBdb[(Notion Feedback)]
    CareFS[(Care Audit files)]
  end

  SPA --> API
  Framer --> API
  LINEU --> API
  Public --> API
  API --> WF & Book & Offer & LN & CD & Care & FB
  Book --> Cases
  Book --> Mig --> CD --> Cust
  WF --> Cases
  WF --> LN
  WF --> CD
  Offer --> Cases
  Care --> CareFS
  Care --> LN
  FB --> FBdb
  WF --> FB
```

### Diagram 2 — End-to-end user flow (ops chain)

```mermaid
flowchart TD
  A[Booking] --> B[Offer slot check]
  B --> C[Case created]
  C --> D[Workflow / Inspection]
  D --> E[Close Case]
  E --> F[Report ready]
  F --> G[Result Notification]
  G --> H[Feedback]
  C -.-> I[Optional Customer dual-write]
  C -.-> J[Care eligibility later]
  J --> K[Care Audit]
  K -.->|forbidden| G
```

### Diagram 3 — Use case diagram

```mermaid
flowchart LR
  Customer([Customer])
  Tech([Field Tech])
  Ops([Operator])
  Steward([Identity Steward])
  Oncall([On-call])

  Customer --> UC1[Book / Offer]
  Customer --> UC2[LINE OA]
  Customer --> UC3[View Report]
  Customer --> UC4[Submit Feedback]
  Tech --> UC5[Start / Close Case]
  Tech --> UC6[Send Result]
  Tech --> UC7[Publish Score]
  Ops --> UC8[Care Dry-run]
  Ops --> UC9[Outcome Report]
  Ops --> UC10[Reconcile / Gates]
  Steward --> UC11[Manual Merge]
  Oncall --> UC12[Care Rollback Flags]
```

### Diagram 4 — Sequence: Booking → Case

```mermaid
sequenceDiagram
  participant C as Client
  participant API as case-flow-routes
  participant CCS as case-creation-service
  participant O as offer-service
  participant N as notion/clients
  participant DW as dual-write

  C->>API: POST /api/cases
  API->>CCS: createCase
  CCS->>CCS: validate
  Note over CCS,O: campaign/offer resolved as needed
  CCS->>N: createClient notificationStatus=not_sent
  N-->>CCS: Case
  CCS->>DW: dualWriteAfterCaseSuccess if flags
  CCS-->>API: Case
```

### Diagram 5 — Sequence: Result notification

```mermaid
sequenceDiagram
  participant A as Tech/API/LINE
  participant WF as workflow-service
  participant NR as notify-reader
  participant N as notion/clients
  participant LN as line-notifications

  A->>WF: sendCaseResult / executeSendCaseResult
  WF->>NR: resolveNotifyLineDestination
  WF->>N: notificationStatus=sending
  WF->>LN: sendCaseResultNotification
  alt ok
    WF->>N: sent + resultSentAt
  else fail
    WF->>N: failed
  end
```

### Diagram 6 — Sequence: Customer identity lookup (LINE)

```mermaid
sequenceDiagram
  participant WH as line-routes
  participant LR as line-reader
  participant Case as Cases
  participant Cust as Customers

  WH->>LR: history/latest
  alt READ_LINE on
    LR->>Cust: exact LINE
    LR->>Case: by customerId
  else shadow
    LR->>Case: authoritative
    LR->>Cust: compare only
  else OFF
    LR->>Case: Case LINE only
  end
```

### Diagram 7 — Sequence: Care lifecycle

```mermaid
sequenceDiagram
  participant CLI as run-care-lifecycle
  participant Run as care run
  participant Pol as policy
  participant Aud as audit
  participant S as sender
  participant LN as line-notifications

  CLI->>Run: scan/send
  Run->>Pol: evaluate
  Run->>Aud: record dry_run/skip/send
  alt ENABLED+SEND
    Run->>S: sendCareMessages
    S->>LN: sendLinePush
  end
  Note over Run: Case notificationStatus read-only observe
```

### Diagram 8 — Sequence: Feedback

```mermaid
sequenceDiagram
  participant U as Customer
  participant API as case-flow
  participant WF as workflow-service
  participant FB as client-feedback
  participant N as Cases

  U->>API: feedback token submit
  API->>WF: recordFeedback
  WF->>FB: upsert Feedback DB
  WF->>N: update feedback status
```

### Diagram 9 — Class / module diagram

```mermaid
classDiagram
  class CaseCreationService {
    createCase()
    cancelAppointment()
  }
  class WorkflowService {
    linkLineUser()
    startCase()
    closeCase()
    executeSendCaseResult()
    recordFeedback()
    publishCaseScore()
  }
  class OfferService {
    getOfferStatus()
  }
  class NotifyReader {
    resolveNotifyLineDestination()
  }
  class DualWrite {
    dualWriteAfterCaseSuccess()
  }
  class CareRun {
    runCareLifecycle()
  }
  class CareAudit {
    recordCareAudit()
  }
  class CareSender {
    sendCareMessages()
  }
  class LineNotifications {
    sendCaseResultNotification()
    sendLinePush()
  }

  CaseCreationService --> DualWrite
  WorkflowService --> NotifyReader
  WorkflowService --> LineNotifications
  WorkflowService --> DualWrite
  CareRun --> CareAudit
  CareRun --> CareSender
  CareSender --> LineNotifications
  WorkflowService .. CareRun : no dependency
```

### Diagram 10 — Data flow diagram

```mermaid
flowchart LR
  subgraph Inputs
    BookIn[Booking payload]
    LineIn[LINE events]
    TechIn[Tech actions]
    CareCLI[Care CLI]
  end

  subgraph Processing
    BookSvc[Booking]
    WF[Workflow]
    Care[Care]
    CD[Customer Domain]
  end

  subgraph Stores
    Case[(Case)]
    Cust[(Customer)]
    FB[(Feedback)]
    Audit[(Care Audit)]
  end

  subgraph Outputs
    LINEOut[LINE messages]
    ReportOut[Public report]
    OpsOut[Ops reports JSON]
  end

  BookIn --> BookSvc --> Case
  BookSvc --> CD --> Cust
  LineIn --> WF --> Case
  TechIn --> WF
  WF --> LINEOut
  WF --> FB
  Case --> ReportOut
  CareCLI --> Care --> Audit
  Care --> LINEOut
  Care --> OpsOut
  Case -.->|eligibility read| Care
```

### Diagram 11 — Domain relationship / ownership highlight

```mermaid
flowchart TB
  Case[Case Ops SSOT]
  Customer[Customer Identity]
  Care[Care Policy+Audit]

  Case -->|result notificationStatus| Notify[Result Notification]
  Case -->|campaign fields| Offer[Offer counts]
  Customer -.->|link only| Case
  Care -->|reads history| Case
  Care -->|CareAudit| Audit[Care Audit]
  Care -.->|NEVER writes| Notify
  Care -.->|optional READ_NOTIFY| Customer
```

### Diagram 12 — Feature flag relationships

```mermaid
flowchart TB
  subgraph Customer["Customer Domain defaults false"]
    CE[ENABLED]
    CE --> DW[DUAL_WRITE]
    CE --> RL[READ_LINE]
    CE --> RN[READ_NOTIFY]
    RL -.-> RLS[SHADOW]
    RN -.-> RNS[SHADOW]
    CE --> ME[MERGE]
  end
  subgraph CareF["Care defaults false"]
    CLE[ENABLED]
    CLE --> CLS[SEND]
    COT[OUTCOME_TRACKING]
    COR[OUTCOME_REPORT]
  end
  Customer ~~~ CareF
```

---

## Key file index

| Concern | Path |
|---------|------|
| Server | `server.js` |
| Case create / cancel | `services/case-creation-service.js` |
| Workflow / notify SM | `services/workflow-service.js` |
| Offer | `services/water-check-offer-service.js` |
| LINE | `services/line-notifications.js`, `api/line-routes.js` |
| Customer flags | `services/customer-domain/flags.js` |
| Care flags / run | `services/care-lifecycle/flags.js`, `run.js` |
| Dual-write | `services/migration/dual-write.js` |
| Intended arch | `docs/WATER_MOTION_ARCHITECTURE_GUIDE.md` |

**Diagram count in this file: 12**
