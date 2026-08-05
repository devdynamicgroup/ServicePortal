# Water Motion Service Portal — Customer Communication & Water Score Architecture

> **Audience:** Product, engineering, and AI agents working on this codebase.  
> **Purpose:** Explain the *why* of the design so changes keep the architecture intact.  
> **Rule:** Prefer Event-Driven customer care over Command-Driven “type a code” chatbots.

---

## Project Vision

Water Motion is not only a system that delivers water-test results. It is a **Water Care Platform** that supports customers across the full service lifecycle.

LINE OA is **not** a Q&A chatbot. It is a **Customer Service Assistant** that communicates based on **service state** (Service Lifecycle).

Core idea:

> The system notifies the customer when something important happens (**Event-Driven**), more than waiting for the customer to type commands (**Command-Driven**).

---

## Core Philosophy

### What we do **not** want

```text
Customer
  → remembers a code
  → types a command
  → system looks up
  → replies
```

Customers should **not** have to remember:

- Tokens (`fb-xxxx`, `rpt-xxxx`)
- Report IDs / Feedback IDs
- Case IDs
- How the database works

### What we want

```text
Event occurs
  → system already knows the customer
  → system pushes the message
  → customer taps to open
```

The customer should barely need to do anything.

---

## Customer Identity

Each customer has one primary identity chain:

```text
Customer
  → LINE User ID
  → Cases
  → Reports
  → History
```

After LINE is linked, the system must identify the customer immediately from `lineUserId`.

After that, customers should **not** need to type:

- `fb-xxxx`
- `rpt-xxxx`
- name
- phone number

(as the normal path to get results).

---

## Current Token Design

The system still has:

| Token | Example | Role |
|-------|---------|------|
| `feedbackToken` | `fb-xxxx` | First-time LINE link + feedback URL `/f/fb-xxxx` |
| `publicReportToken` | `rpt-xxxx` | Public Water Score report `/r/rpt-xxxx` |

**Tokens remain in the system.** They are infrastructure for:

1. Binding LINE once (bootstrap)
2. Opening shareable / public links

They are **not** the long-term customer identity, and they are **not** something customers should memorize.

---

## Target Customer Experience

After LINE is linked successfully:

- Customers do **not** need tokens for day-to-day use.
- To view results they can:
  - Tap **ดูผลตรวจ**
  - Or type natural phrases such as: `ดูผลตรวจ`, `ดูผลน้ำ`, `ขอดูผลตรวจ`, `ผลตรวจล่าสุด`
- The system resolves:

```text
lineUserId → Customer → Cases → Report(s)
```

and returns the latest report (or a list), without asking for codes.

---

## Event-Driven Architecture

The product is driven by **events**, not by customer command vocabulary as the primary interface.

### Event 1 — Customer Linked

| | |
|--|--|
| **Trigger** | Customer successfully links LINE |
| **System** | Bind `LINE User ID` to Customer |
| **Reply** | Welcome / link success |

### Event 2 — General Inspection Completed

| | |
|--|--|
| **Trigger** | Staff taps **Complete** in the portal |
| **System** | Finalize Water Score + report → **Push LINE** |
| **Customer** | Receives “ผลตรวจของคุณพร้อมแล้ว” immediately |

### Event 3 — Laboratory Result Ready

| | |
|--|--|
| **Trigger** | Lab upload / result approved |
| **System** | Generate report → **Push LINE** automatically |
| **Note** | Customer may wait days; when ready, system must push — do not wait for them to ask |

### Event 4 — Customer Requests Report

| | |
|--|--|
| **Trigger** | Customer asks to see results (button or natural language) |
| **System** | Lookup by `lineUserId` → send latest report or report list |

### Event 5 — 6-Month Reminder

| | |
|--|--|
| **Trigger** | ~6 months since last inspection |
| **System** | Push LINE **Service Reminder** (care, not marketing) |

Example tone:

```text
💧 ผ่านมาแล้วประมาณ 6 เดือนนับจากการตรวจคุณภาพน้ำครั้งล่าสุด
คุณภาพน้ำอาจเปลี่ยนแปลงได้ตามสภาพท่อ ระบบกรอง หรือแหล่งน้ำที่ใช้งาน
เพื่อความสะอาดและความปลอดภัยในการใช้น้ำ
แนะนำให้ตรวจคุณภาพน้ำอีกครั้ง
[นัดตรวจ] [สอบถามเจ้าหน้าที่]
```

---

## Inspection Types

### 1. General Inspection

```text
Pre-assessment
  → Assessment
  → Water Score
  → Feedback
  → Complete
  → Push Result
```

Customer receives results promptly after Complete.

### 2. Laboratory Inspection

```text
Collect Sample
  → Waiting Lab
  → Lab Analysis
  → Upload / Approve Result
  → Generate Report
  → Push Result
```

Latency may be days; the **push when ready** contract still holds.

Both types should feel consistent to the customer (same LINE care channel, same “open report” experience), even if internal workflows differ.

---

## Customer Timeline (History)

Example lifecycle:

```text
12 Jan — Inspection → Water Score 81 → Feedback
  → 6-month reminder
20 Jul — Inspection → Water Score 88 → Recommendation
```

Longer term: Water History / compare past scores.

---

## LINE OA Role

LINE OA = **Customer Communication Platform** (care channel), not a trivia chatbot.

Responsibilities:

- Notify inspection / lab results
- 6-month (and future) reminders
- Deliver report links
- Collect feedback
- Support rebooking
- Basic Q&A
- Show past results

### Future Rich Menu (direction)

```text
📊 ผลตรวจของฉัน
📅 นัดตรวจ
💧 ความรู้เรื่องน้ำ
📞 ติดต่อเจ้าหน้าที่
```

Customers should be able to use the product with **minimal typing**.

---

## Customer Interaction Philosophy

Minimize typing. Do not force customers to remember:

- Feedback token
- Report token
- Raw URLs
- Case codes

Primary lookup key after link:

```text
LINE User ID
```

---

## Internal Architecture (Logical)

```text
Customer
  → LINE User
  → Cases
  → Assessments
  → Water Score
  → Reports
  → Notifications
  → Reminder Scheduler
```

A **Notification Engine** (event → message policy) decides *when* to send.  
Chatbot NLP is secondary and must not become the source of truth for delivery.

---

## Long-Term Vision — Customer Lifecycle

```text
Interest
  → Inspection
  → Receive result
  → Follow-up
  → ~6 months
  → Reminder to retest
  → New inspection
  → Compare history
  → Ongoing care
```

The goal is continuous water care — not a one-shot “send PDF once” tool.

---

## Implementation Notes (Current → Target)

These notes help agents avoid “fixing” the product in the wrong direction.

| Area | Current (as of portal) | Target |
|------|------------------------|--------|
| LINE text handling | Primarily parses `fb-xxxx` for linking | After link: natural language / menu by `lineUserId` |
| Result delivery | Push on case **close / send-result** when LINE linked | Keep push-on-event; expand to lab-ready + reminders |
| Tokens | Required for bootstrap + public URLs | Keep internally; never require memorization for linked users |
| Staff Complete | Should call close API → push | Must remain the General Inspection completion event |

Public report URL shape (infrastructure, not customer memory):

```text
https://<host>/r/<publicReportToken>
```

Feedback URL shape:

```text
https://<host>/f/<feedbackToken>
```

---

## Hard Rules for AI / Engineers

1. **Do not replace Event-Driven with Command-Driven** as the primary UX (customers must not need complex codes for normal use).
2. **Do not treat tokens as primary identity after LINE is linked.** `fb-xxxx` / `rpt-xxxx` are bootstrap + public-link tokens only.
3. **Inspection / lab results must Push when the event happens** — do not design “customer must ask first” as the happy path.
4. **Customer data lookup after link must prefer `lineUserId` → Customer → Cases** — not name/phone/token typing.
5. **LINE OA is a Customer Care Channel** across the lifecycle — not only a Q&A bot.
6. **Support both General and Lab inspection workflows** with different triggers but coherent customer experience.
7. **Keep the architecture extensible for new events** (filter change reminders, appointments, loyalty offers, post-fix follow-ups) without rewriting the core identity / notification model.

---

## Why This Document Exists

If another AI or teammate only sees “what the code does today,” they may propose shortcuts that:

- Make customers type tokens forever
- Turn LINE into a command console
- Delay results until the customer asks
- Split identity across ad-hoc strings

Understanding **why** we designed Event-Driven care first keeps future work aligned with the Water Care Platform vision.
