# Production Readiness Audit — Booking Pipeline

**Mode:** Verify only — no fixes, no code, no redesign  
**Date:** 2026-08-05  
**Architecture contract:** Website → Customer input → Cal booking → Webhook → Adapter → `createCase()` → Notion → Dashboard  

**Evidence sources:** workspace code, `git` HEAD vs working tree, live `serviceportal.onrender.com` probes, Cal.com UI snapshot (event type 6040165 Webhooks tab), prior docs for open gates only where still current.

---

## Stage verdicts (summary)

| Stage | Match architecture? | Production ready? | Verdict |
|-------|---------------------|-------------------|---------|
| 1. Website | Yes (role) | **NOT VERIFIED** (live book UX) | **NOT VERIFIED** |
| 2. Cal.com | Yes (role) | No (no webhook emit to Portal) | **FAIL** |
| 3. Webhook (Cal → Portal) | Yes (intended) | No | **FAIL** |
| 4. Portal receive | Partial (local Phase 0 only) | No | **FAIL** |
| 5. Adapter | Missing | No | **FAIL** |
| 6. `createCase()` | Yes (exists; Cal never calls) | Yes for Manual/API; No for Cal path | **FAIL** (pipeline) |
| 7. Notion | Yes via `createCase` → `createClient` | Yes for ops DB; No Cal correlation prop | **FAIL** (Cal path) |
| 8. Dashboard | Yes (read model) | Yes (Notion-backed list) | **PASS** |

**End-to-end Website → Dashboard via Cal:** **FAIL**

---

## 1. Website (Framer)

| # | Finding |
|---|---------|
| **1. Expected** | UI collects customer booking input; submits booking to Cal; does **not** create Cases; does **not** own Ops SSOT. |
| **2. Current** | Architecture docs and product describe Framer as booking UI. Public offer API used by site is live. Live Framer→Cal book click **not re-exercised in this audit**. |
| **3. Evidence** | `GET https://serviceportal.onrender.com/api/public/water-check-offer` → `200` JSON `{"ok":true,"totalSlots":100,"used":5,"remaining":95}`. Docs: Framer contracts / booking flow. No Framer source in this repo (hosted externally). |
| **4. Matches architecture?** | **Yes** (role: UI / customer input collector). |
| **5. Production ready?** | Offer counter: yes. Full book form → Cal: **NOT VERIFIED** this session. |
| **6. Missing** | Live confirmation of embed/book success in this audit turn. |
| **7. Blocking?** | Not the primary production Case gap (Cases fail later). |
| **8. Issue type** | N/A for Case create; live UX = **NOT VERIFIED** |

**Stage: NOT VERIFIED** (role OK; live book path not re-proven here)

---

## 2. Cal.com

| # | Finding |
|---|---------|
| **1. Expected** | Booking provider: store booking submitted by customer; emit booking events (webhook) to Portal. Not Case creator; not identity owner. |
| **2. Current** | Event type **Free Water Check** (`/event-types/6040165`) exists. **Webhooks tab selected; no webhook list entries visible** — only **New**. No delivery target for Portal. |
| **3. Evidence** | Browser snapshot 2026-08-05: `https://app.cal.com/event-types/6040165?tabName=webhooks` — Webhooks tab selected; interactive control **New**; no webhook rows in AX tree. Account-level webhooks page **not opened this turn** → account-wide config **NOT VERIFIED** beyond event-type tab. |
| **4. Matches architecture?** | **Yes** as scheduler/store. **Emit step not configured** → pipeline incomplete. |
| **5. Production ready?** | **No** for Portal integration. |
| **6. Missing** | Webhook subscription pointing at Portal `POST /api/cal/webhook` with secret + `BOOKING_CREATED` (at minimum). |
| **7. Blocking** | Cal does not notify Portal. |
| **8. Issue type** | **Missing webhook** · **Configuration** |

**Stage: FAIL**

---

## 3. Webhook (Cal → Portal transport)

| # | Finding |
|---|---------|
| **1. Expected** | Signed HTTP POST of booking event to Portal; Cal retries on failure. |
| **2. Current** | No Cal webhook configured to Portal (stage 2). Even if configured, Portal prod has no Cal JSON endpoint (stage 4). |
| **3. Evidence** | Cal UI empty webhooks (stage 2). Prod `GET /api/cal/webhook/status` → `200` **`text/html`** SPA shell (not JSON). |
| **4. Matches architecture?** | Design matches; **runtime path absent**. |
| **5. Production ready?** | **No** |
| **6. Missing** | Cal webhook config + reachable Portal receiver. |
| **7. Blocking** | No events reach Portal. |
| **8. Issue type** | **Missing webhook** · **Missing deployment** · **Configuration** |

**Stage: FAIL**

---

## 4. Portal (receive endpoint)

| # | Finding |
|---|---------|
| **1. Expected** | `POST /api/cal/webhook` receives raw body; verifies signature; hands off to adapter. Status probe for ops. |
| **2. Current** | **Working tree (uncommitted):** Phase 0 receive-only — `api/cal-routes.js`, `services/cal-webhook.js`, `services/cal-dedupe-placeholder.js`; `server.js` dirty wires `handleCalRoute`. Explicitly **`createsCases: false`**; no mapping; no `createCase`. **HEAD / origin / production:** Cal routes **not tracked**; HEAD `server.js` has **no** `handleCalRoute`. |
| **3. Evidence** | `git ls-files` empty for cal route/services. HEAD `9caa4012`. Prod status URL returns SPA HTML. Local Phase 0 code comments + status JSON shape document receive-only. Phase 0 report: local harness passed receive-only (not prod). |
| **4. Matches architecture?** | Phase 0 **aligns** with “receive before create” and **does not** violate “only `createCase` writes Cases” (it creates none). Full architecture (event → adapter → createCase) **not implemented**. |
| **5. Production ready?** | **No** — not deployed; incomplete pipeline. |
| **6. Missing** | Commit + deploy of receiver; production `CAL_WEBHOOK_SECRET`; adapter wiring (later stages). |
| **7. Blocking** | Production has no Cal webhook API. |
| **8. Issue type** | **Missing deployment** (primary) · incomplete feature (receive-only) |

**Stage: FAIL**

---

## 5. Adapter (payload normalization)

| # | Finding |
|---|---------|
| **1. Expected** | Normalize Cal booking event → `createCase` input only; no Notion write; no business rules beyond map/dedupe gate. |
| **2. Current** | **`services/cal-booking-adapter.js` does not exist.** Phase 0 has envelope peek / placeholder dedupe only — not Case mapping. |
| **3. Evidence** | Filesystem: no `cal-booking-adapter*`. `api/cal-routes.js` does not `require` case-creation / Notion. CAL-G01: WM payload paths **not frozen** (`docs/CALCOM_PAYLOAD_VALIDATION.md`). |
| **4. Matches architecture?** | **Missing piece** of locked flow — not an alternate architecture. |
| **5. Production ready?** | **No** |
| **6. Missing** | Adapter module; frozen field paths (CAL-G01); event-type → Offer map values (CAL-G03); durable dedupe (not in-memory placeholder). |
| **7. Blocking** | Cannot map booking event → Case input. |
| **8. Issue type** | **Mapping** (absent) · validation paths **NOT VERIFIED** without WM sample |

**Stage: FAIL**

---

## 6. `createCase()`

| # | Finding |
|---|---------|
| **1. Expected** | Sole Case creation: validate, tokens, offer resolution, Notion write. Cal path must call this only. |
| **2. Current** | Implemented and used by `POST /api/cases`. Cal path **never calls it** (no adapter; Phase 0 forbids create). |
| **3. Evidence** | `services/case-creation-service.js` `createCase` → `validateCustomerInput` → `createClient`. `api/case-flow-routes.js` `POST /api/cases`. Cal routes: comment + no require of `createCase`. |
| **4. Matches architecture?** | **Yes** for Manual/API. Cal pipeline **does not reach** it — gap, not a second writer. |
| **5. Production ready?** | Function: **yes** for existing callers. Cal booking pipeline: **no**. |
| **6. Missing** | Adapter invocation of `createCase(..., { skipMap, launchOffer, correlationId })` after validation/dedupe. |
| **7. Blocking** | Website Cal bookings never invoke Case create. |
| **8. Issue type** | Not architecture mismatch of `createCase` itself — **pipeline incomplete** (missing adapter + deploy + webhook) |

**Stage: FAIL** (for Website→Cal→Case pipeline) · Manual/API create path separately healthy

---

## 7. Notion

| # | Finding |
|---|---------|
| **1. Expected** | Ops DB; Cases written only through `createCase` → `createClient`. Additive `calBookingId` for correlation when Cal path live. |
| **2. Current** | Notion-backed Cases readable in prod (`count: 74`). `FIELD_ALIASES` has **no** `calBookingId`. No Cal-origin write path in production. |
| **3. Evidence** | Prod `GET /api/clients` → `{"ok":true,"source":"notion","count":74,...}`. `services/notion/mapper.js` aliases through `customerPageId` — no Cal booking id key. |
| **4. Matches architecture?** | Ops storage via `createCase`: **yes**. Cal correlation property: **not present**. |
| **5. Production ready?** | Ops Case DB: **yes**. Cal idempotent create: **no**. |
| **6. Missing** | Notion property + mapper alias for `calBookingId` (execution of CAL-G02). |
| **7. Blocking** | Blocks durable Cal dedupe / correlation (when create is wired). |
| **8. Issue type** | **Configuration** / schema additive · not alternate write path |

**Stage: FAIL** (Cal-ready) · **PASS** as general Ops DB for existing Cases

*(Reported as **FAIL** for this pipeline audit because Cal path cannot complete idempotently without it.)*

---

## 8. Dashboard

| # | Finding |
|---|---------|
| **1. Expected** | Read-only view of Notion Cases via existing API. Not SSOT; not Case creator. |
| **2. Current** | Loads jobs from `GET /api/clients`. Prod API returns Notion jobs. |
| **3. Evidence** | `src/js/job-state.js` `loadJobsFromApi` → `fetch('/api/clients')`. Prod clients JSON as above. |
| **4. Matches architecture?** | **Yes** |
| **5. Production ready?** | **Yes** for displaying Cases that exist. Will not show Cal bookings until Cases are created. |
| **6. Missing** | Nothing for Dashboard itself; upstream Case create missing. |
| **7. Blocking** | Downstream symptom only. |
| **8. Issue type** | None on Dashboard |

**Stage: PASS**

---

## Cross-cutting gates (still open)

| Gate | Status | Notes |
|------|--------|-------|
| CAL-G01 WM webhook payload paths | **Open / NOT VERIFIED** | No WM sample in repo; cannot freeze mapping |
| CAL-G02 `calBookingId` Notion property | Decision documented; **execution missing** | No mapper alias |
| CAL-G03 event type → Offer map | **NOT VERIFIED** concrete values | Product table not confirmed in this audit |
| Durable dedupe | Placeholder only (local Phase 0) | Explicitly non-production |

---

## Architecture compliance check

| Forbidden action | Observed? |
|------------------|-----------|
| Business logic in Cal | **No** |
| Cal creates Cases | **No** |
| Webhook writes Notion directly | **No** (no live webhook path; Phase 0 has no Notion import) |
| Duplicate `createCase` logic | **No** |
| Second Case creation path from Cal | **No** (Cal creates **zero** Cases) |
| Dashboard as SSOT | **No** |

**Conclusion:** Architecture contract is **not violated** by existing code. Production failure is **pipeline incompleteness** (config + undeployed receive + missing adapter + missing schema), not an alternate architecture.

---

## Blocking chain (ordered)

1. **Missing webhook** (Cal config) — no events leave Cal toward Portal  
2. **Missing deployment** — prod has no `/api/cal/webhook` JSON API  
3. **Missing adapter / mapping** — no normalize → `createCase`  
4. **Missing `calBookingId` schema** — no durable Cal correlation  
5. **CAL-G01 NOT VERIFIED** — mapping paths unsafe to implement without sample  

---

## Final scorecard

| Stage | PASS / FAIL / NOT VERIFIED |
|-------|----------------------------|
| Website | **NOT VERIFIED** |
| Cal.com | **FAIL** |
| Webhook | **FAIL** |
| Portal | **FAIL** |
| Adapter | **FAIL** |
| `createCase()` (Cal pipeline) | **FAIL** |
| Notion (Cal-ready) | **FAIL** |
| Dashboard | **PASS** |
| **E2E Website → Dashboard via Cal** | **FAIL** |

**Production readiness for public Cal booking → Case → Dashboard: FAIL**

No fixes proposed. No code. No redesign.
