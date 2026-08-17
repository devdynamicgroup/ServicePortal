# Water Motion Architecture Guide (AI Edition)

**Version:** 1.0  
**Status:** Production Architecture  
**Audience:** AI Assistants, Developers, Architects

---

# 1. Purpose

This document is the primary architecture reference for the Water Motion Service Platform.

Every AI assistant or developer must read and understand this guide before implementing any feature.

The purpose of this document is to preserve the production architecture, maintain backward compatibility, and ensure every implementation follows existing business rules and system contracts.

This guide is **not** a task specification. It defines how the system works. Feature specifications (such as M8.3 or M9) are separate documents that build upon this architecture.

---

# 2. Core Principles

The repository is an existing production system.

The first responsibility is **not to write code**.

The first responsibility is **to understand the architecture**.

Before making any changes:

* Understand the existing architecture.
* Understand the business domains.
* Understand the production contracts.
* Understand migration strategy.
* Understand regression risks.

Only after these steps should implementation begin.

---

# 3. Engineering Principles

Always preserve backward compatibility.

Never redesign the production architecture unless explicitly requested.

Never replace working modules simply because a different design appears cleaner.

Prefer extending the system over rewriting it.

Minimize changes.

Keep migrations incremental.

Maintain compatibility at every layer.

---

# 4. Production Contracts

The following production contracts are considered stable.

They must not be broken without explicit approval.

## API

* Public REST APIs
* Internal APIs
* Existing request payloads
* Existing response payloads

## Dashboard

Dashboard integrations must remain compatible.

## Framer

Framer payloads must remain unchanged.

## LINE OA

LINE Webhook payloads must remain compatible.

## Notion

Database schemas and property names are production contracts.

---

# 5. Architecture Overview

Water Motion Service Platform consists of multiple business domains.

The platform currently manages:

* Customers
* Cases
* Water Assessment
* Booking
* Workflow
* Offers
* Feedback
* Public Reports
* Notifications
* OCR
* LINE OA
* Dashboard

The current production architecture is **Case-centric**.

Customer Domain is being introduced gradually through an incremental migration.

---

# 6. Domain Model

## Customer Domain

Responsible for identity.

Customer represents a real person or organization.

Customer owns identity only.

Customer does not own workflow.

Customer does not own reports.

Customer does not own offers.

---

## Case Domain

Case is the primary business aggregate.

Most operational data belongs to a Case.

Case references Customer.

---

## Booking Domain

Responsible for booking operations.

Booking belongs to Case.

---

## Workflow Domain

Responsible for operational workflow.

Workflow belongs to Case.

---

## Offer Domain

Responsible for quotations and offers.

Offer belongs to Case.

---

## Feedback Domain

Feedback belongs to Case.

---

## Report Domain

Reports belong to Case.

---

## Notification Domain

Responsible for notification delivery.

---

## LINE Domain

Responsible for LINE Official Account integration.

Webhook contracts must remain compatible.

---

## Dashboard Domain

Responsible for analytics and reporting.

Dashboard payloads must remain backward compatible.

---

# 7. Business Rules

The following business rules are mandatory.

## Identity

Customer owns identity.

## Ownership

Offer belongs to Case.

Workflow belongs to Case.

Feedback belongs to Case.

Report belongs to Case.

Booking belongs to Case.

Customer never owns operational records.

---

## Matching

Never fuzzy match customers.

Only exact matching is allowed.

Phone numbers must be normalized.

Emails must be normalized.

Names must never be auto-merged.

---

# 8. System Invariants

The following rules are always true.

Case ID is immutable.

Customer ID is immutable.

Offer always references Case.

Workflow always references Case.

Feedback always references Case.

Report always references Case.

Dashboard contracts remain backward compatible.

Framer contracts remain backward compatible.

LINE webhook contracts remain backward compatible.

Public APIs remain compatible.

---

# 9. Architecture Decision Records (ADR)

## ADR-001

Case is the aggregate root.

Reason:

* Existing production implementation
* Dashboard dependency
* LINE dependency
* Workflow dependency

Consequence:

* Offer remains under Case.
* Workflow remains under Case.
* Feedback remains under Case.
* Report remains under Case.

---

## ADR-002

Customer is introduced as an identity layer.

Reason:

Incremental migration without breaking production.

Consequence:

Customer stores identity.

Operational records continue to belong to Case.

---

# 10. Notion Mapping

Production Notion databases:

| Notion DB | Domain |
|-----------|--------|
| Clients DB (`NOTION_DATABASE_ID`) | **Case** (primary operational aggregate) |
| Customers DB (`NOTION_CUSTOMERS_DATABASE_ID`) | **Customer** (identity layer; incremental introduction) |
| Feedback DB (`NOTION_CLIENT_FEEDBACK_DATABASE_ID`) | **Feedback** (linked to Case via `Client Page ID`) |
| Score Publications DB (`NOTION_SCORE_PUBLICATIONS_DATABASE_ID`) | **Publication ledger** (Case-owned, append-only; linked via `Client Page ID`) |

Case-scoped concerns stored **on the Case (Clients DB)**, not as separate Notion databases:

| Concern | Production storage |
|---------|-------------------|
| Booking | Creates/updates a Case page |
| Offer | Case property `Campaign Offer` |
| Workflow | Case workflow properties (e.g. `Case Workflow Status`) |
| Reports | Case tokens/properties (`Public Report Token`, report URL, `Latest Water Score` as **latest pointer**). Immutable historical artifacts live in the Score Publications ledger. |
| Notifications | Case notification properties |

Never rename production properties.

Never remove production properties.

---

# 11. Stable API Contracts

The following interfaces are protected.

`POST /api/cases`

`GET /api/public/water-check-offer`

LINE Webhook

Dashboard payload

Framer payload

Any change requires explicit approval.

---

# 12. Forbidden Changes

The following changes are prohibited unless explicitly instructed.

Do not rewrite Booking.

Do not rewrite Workflow.

Do not rewrite Offer.

Do not rename APIs.

Do not rename routes.

Do not rename Notion properties.

Do not remove compatibility.

Do not introduce fuzzy customer matching.

Do not move Offer under Customer.

Do not move Workflow under Customer.

Do not move Feedback under Customer.

Do not move Reports under Customer.

Do not break Dashboard.

Do not break Framer.

Do not break LINE OA.

---

# 13. Non-Goals

Unless explicitly requested, do not:

Redesign the architecture.

Refactor unrelated modules.

Introduce CQRS.

Replace the database.

Optimize unrelated performance.

Migrate unrelated services.

Change deployment architecture.

---

# 14. Implementation Workflow

Before implementing any feature:

1. Read this architecture guide.
2. Read the relevant domain documents.
3. Read the business rules.
4. Read the migration strategy.
5. Review protected contracts.
6. Assess regression risks.
7. Implement only the requested scope.

---

# 15. Required Implementation Report

Every implementation must explain:

## Architecture Understanding

Summary of the affected architecture.

## Implementation Plan

Planned changes.

## Affected Modules

Files and modules that will change.

## Compatibility Analysis

How backward compatibility is preserved.

## Regression Analysis

Possible regressions.

## Migration Impact

Database, API, Dashboard, Framer, LINE, Notion.

## Performance Impact

Expected performance implications.

## Rollback Plan

How to revert safely.

## Verification

Tests performed.

Validation completed.

Remaining risks.

---

# 16. Definition of Done

A task is complete only when:

* Architecture is preserved.
* Business rules are preserved.
* Public contracts remain compatible.
* Regression risks are documented.
* Rollback plan exists.
* Migration impact is documented.
* Verification is completed.
* Existing functionality continues to work.

---

# 17. Using This Guide

For every implementation:

1. Read this Architecture Guide.
2. Read the relevant Domain documents.
3. Read the Milestone Specification (e.g., M8.3, M9).
4. Implement only the requested milestone.
5. Preserve all production contracts.
6. Follow all forbidden rules.

This guide serves as the permanent architectural reference for the Water Motion Service Platform. All milestone documents inherit these principles unless explicitly stated otherwise.

---

## Related documents

* `docs/CUSTOMER_COMMUNICATION_ARCHITECTURE.md` — LINE / Water Score event-driven care model
* M8 Customer Domain design + M8.1 readiness plan (milestone specs; inherit this guide)
