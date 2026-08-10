# Cal.com Booking Integration — External Input Checklist

**Document type:** External Dependency Closure Checklist
**Mode:** Tracking only — **no code, no patch, no deploy, no architecture change**
**Date:** 2026-08-05
**Inputs:** [`CALCOM_PHASE1_EXECUTION_CHECKLIST.md`](./CALCOM_PHASE1_EXECUTION_CHECKLIST.md), [`CALCOM_IMPLEMENTATION_READINESS_GATE.md`](./CALCOM_IMPLEMENTATION_READINESS_GATE.md), [`CALCOM_PHASE1_DESIGN_REVIEW.md`](./CALCOM_PHASE1_DESIGN_REVIEW.md)
**Live re-check:** `git status` shows no new Cal-related code since the last gate (still only Phase 0's `api/cal-routes.js`, `services/cal-webhook.js`, `services/cal-dedupe-placeholder.js`); `calBookingId` still absent from `services/notion/mapper.js`; `CAL_WEBHOOK_SECRET` not present in this workspace's shell environment (this only reflects the local dev shell — it does not confirm or deny whether the variable is set in Render's actual staging/production environment, which this workspace cannot inspect)

**Purpose:** a single tracking sheet for everything that must arrive from *outside* this codebase before Phase 1 coding starts. Every row traces to a blocker already identified in a prior document — this checklist adds no new blocker and closes no new blocker; it exists to make external-dependency status legible at a glance.

---

## 1. Cal.com Input Required

| Input | Required | Source | Status |
|---|---|---|---|
| Webhook payload sample — `BOOKING_CREATED` (redacted) | **Yes — blocks PR-1/PR-2** | Cal.com dashboard test-send, or a real staging booking | ❌ Not received |
| Webhook payload sample — `BOOKING_CANCELLED` (redacted) | Yes — blocks Phase 2 (PR-4), not PR-1–3 | Cal.com dashboard test-send, or a real staging cancellation | ❌ Not received |
| Webhook payload sample — `BOOKING_RESCHEDULED` (redacted) | Yes — blocks Phase 2 (PR-4), not PR-1–3; also the sample that answers whether `calBookingId` survives reschedule | Cal.com dashboard test-send, or a real staging reschedule | ❌ Not received |
| Signature header name | **Confirmed already** — no longer blocking | Cal.com's own webhook documentation, cross-checked against this codebase's own working implementation | ✅ **Done** — `x-cal-signature-256`, HMAC-SHA256-hex over raw body; implemented in `services/cal-webhook.js` and verified against a real computed signature in Phase 0 testing (all 4 signature cases passed) |
| Webhook secret (real value) | **Yes — blocks PR-1 going live against real Cal traffic** | Cal.com webhook subscription setup (per event, or per account) | ❌ Not confirmed present in any deploy target; the code path that reads/enforces it is ready (`CAL_WEBHOOK_SECRET` env var) |
| Event type identifier(s) | **Yes — blocks PR-3's Offer attribution** | Cal.com account's configured event types (e.g., the `watermotion/60min` slug and any others) | ❌ Not enumerated — no event type inventory exists in any reviewed document |
| Booking id semantics (is the id stable across reschedule? what field carries it?) | Yes — blocks PR-2's mapper for the primary correlation key, and specifically blocks PR-4's reschedule handling | Real payload samples (same source as the three payload rows above) | ❌ Not confirmed — `services/cal-webhook.js`'s current envelope reader only *speculatively* checks `payload.uid`/`bookingUid`/`root.uid`/`root.bookingId`, explicitly marked unverified in its own code comment |
| Timezone behavior (what format/offset Cal sends start/end times in) | Yes — blocks PR-1/PR-2's date/time mapping correctness | Real payload samples | ❌ Not confirmed |

**Section verdict:** 1 of 8 items closed (signature header name — because it was verifiable against this codebase's own already-working implementation rather than requiring new external data). The remaining 7 all require a real Cal.com artifact (payload sample, account configuration, or secret) that does not exist anywhere in this repository.

---

## 2. Payload Mapping Preparation

Per the standing evidence rule (carried through every document in this chain since `CALCOM_BLOCKER_RESOLUTION.md`): **no field path below is guessed.** Every row is `UNKNOWN` until a real sample fills it in.

| Cal Field Path | Example Value | Target Case Field | Transform |
|---|---|---|---|
| `UNKNOWN` | `UNKNOWN` | `calBookingId` | None — stored verbatim |
| `UNKNOWN` (delivery/event id) | `UNKNOWN` | *(dedupe-only, not a Case field)* | None |
| `UNKNOWN` (attendee name) | `UNKNOWN` | `fullName` | None expected |
| `UNKNOWN` (attendee email) | `UNKNOWN` | `email` | None expected |
| `UNKNOWN` (attendee phone) | `UNKNOWN` | `phone` | None expected; location in payload unconfirmed (often a custom question in Cal, not a fixed field) |
| `UNKNOWN` (start time) | `UNKNOWN` | `appointmentDate` + `appointmentStart` | `UNKNOWN` — timezone interpretation must be confirmed first; conversion must not shift the calendar day (existing UTC-based precedent in `notion/mapper.js`'s `isoDateOnly`/`weekdayIndex`) |
| `UNKNOWN` (end time) | `UNKNOWN` | `appointmentEnd` | Same caveat as start time |
| `UNKNOWN` (event type id/slug) | `UNKNOWN` | Feeds §3's mapping decision, not a direct Case field | None — lookup input |
| `UNKNOWN` (LINE custom question, if any) | `UNKNOWN` | `lineId` | None; never `lineUserId` |
| `UNKNOWN` (location/address) | `UNKNOWN` | `address` | None expected |
| *(literal, not from Cal)* | `'cal.com'` | `source` | Set as a literal — already a supported `createCase()` input, zero schema change needed for this one row |

**Rule enforcement check:** every cell that would require external data is `UNKNOWN`. The only non-`UNKNOWN` row is the literal `source` marker, which is not a Cal field at all — it is a constant this codebase chooses to write, consistent with the rule that only *confirmed* Cal data may populate the "Cal Field Path"/"Example Value" columns.

---

## 3. Product Decision Required

| Decision | Owner | Status |
|---|---|---|
| Cal event type → `launchOffer` (which event type(s) count as the Free Water Check / current Launch Offer) | **Product** | ❌ **Pending** — template exists (`CALCOM_IMPLEMENTATION_READINESS_GATE.md` §4), no signed values |
| Campaign attribution (whether any non-launch Cal event type should map to a *different* named existing campaign, vs. no campaign at all) | **Product** | ❌ **Pending** — no row filled beyond the locked default |
| Non-launch booking behavior (confirm the default: unmapped/non-launch event types create a Case **without** offer attribution, never silently defaulted to launch) | **Product** (to *confirm*, not to decide — this default is already architecturally locked) | ✅ **Rule already closed, no Product action blocking it** — `CALCOM_BLOCKER_RESOLUTION.md` CAL-G03 locked "do not default unknown types to Launch Offer" as a standing rule; Product may *override* toward stricter behavior (e.g., reject non-launch bookings entirely) but the safe default requires no sign-off to proceed with |

**Section verdict:** 2 of 3 rows are genuinely pending Product action; the third is a pre-closed safe default that does not block implementation, only refinement.

---

## 4. Notion Schema Preparation

| Aspect | Decision |
|---|---|
| **Property to add** | `calBookingId` |
| **Type** | Text/string (rich text or title-equivalent — same class of property as the existing `Feedback Token`/`Public Report Token` properties already in the schema, per `services/notion/mapper.js`'s `FIELD_ALIASES` pattern) |
| **Purpose** | Primary Cal.com ↔ Case correlation key — the value that lets a later `BOOKING_CANCELLED`/`BOOKING_RESCHEDULED` webhook find the right Case, and lets a redelivered `BOOKING_CREATED` recognize it already has a Case |
| **Immutable rule** | Written once, at Case creation, from the adapter's mapped payload; no function anywhere in `case-creation-service.js` or `workflow-service.js` is proposed to ever update it afterward — confirmed as a locked decision in `CALCOM_PHASE1_DESIGN_REVIEW.md` §4, not reopened here |
| **Unique enforcement location** | **Not enforced by Notion itself** (Notion has no native unique-constraint mechanism on a property — confirmed by this codebase's own existing precedent, `services/case-tokens.js`'s `generateUniqueToken()`, which exists specifically because Notion cannot guarantee this at write time). Enforcement happens at the **application layer**: the durable dedupe design (`calBookingId` lookup against the live Notion Cases DB, executed under `workflow-service.js`'s existing `withCaseLock()` primitive) is what guarantees at most one Case per `calBookingId` — not a database-level constraint |
| **Current status** | ❌ **Not created** — confirmed absent via live grep of `FIELD_ALIASES`; this is a ready-to-execute step (the decision above is closed), blocked only on someone with schema-edit access actually adding it and one corresponding `FIELD_ALIASES` entry (additive, no existing key touched) |

---

## 5. Environment Checklist

| Environment | Requirement | Status |
|---|---|---|
| **Local** | `CAL_WEBHOOK_SECRET` set for local signature testing | ❌ Not set in this workspace's shell (confirmed via direct check) — expected for local dev, not itself a blocker for design work, but must be set before any local end-to-end test against a real Cal.com test-send |
| **Local** | Webhook URL reachable from Cal.com (requires a tunnel — e.g., ngrok-style — for any local real-webhook test) | ❌ Not applicable/configured — no tunnel referenced in any reviewed document |
| **Local** | Endpoint availability | ✅ `GET /api/cal/webhook/status` and `POST /api/cal/webhook` both exist and respond correctly today (Phase 0, verified) |
| **Staging** | `CAL_WEBHOOK_SECRET` set in the staging deploy target | ❓ **Unconfirmed** — this workspace cannot inspect Render's actual environment variables; status is unknown, not confirmed-absent |
| **Staging** | Webhook URL registered with Cal.com, pointed at the staging deployment | ❌ Not confirmed configured in any reviewed document |
| **Staging** | Endpoint availability | ✅ Same code as local — if deployed, the route exists and responds; deployment status itself is outside this workspace's visibility |
| **Production** | `CAL_WEBHOOK_SECRET` set in the production deploy target | ❓ **Unconfirmed**, same visibility limitation as staging |
| **Production** | Webhook URL registered with Cal.com, pointed at production | ❌ **Must remain not-configured until Phase 3** — registering a production webhook before Phase 1–2 are complete and QA'd would start real Cal traffic flowing into a still-incomplete integration, which no reviewed document authorizes |
| **Production** | Endpoint availability | N/A until Phase 3 rollout, per the phase sequencing already locked in `CALCOM_IMPLEMENTATION_GATE.md` §8 |

**Section verdict:** Local/staging environment readiness is a mix of "code-ready, config-unconfirmed" (secret values, webhook registration) — none of which this workspace can directly verify or set, since they live in Cal.com's dashboard and Render's environment configuration, both outside this repository. Production is correctly **not** meant to be ready yet.

---

## 6. Implementation Start Gate

| PR | Starts when | Current status against that condition |
|---|---|---|
| **PR-1** (receive + verify + config) | Signature confirmed **and** webhook secret available | Signature mechanism: ✅ confirmed (§1). Webhook secret: ❌ real value not confirmed present in any deploy target (§1, §5). **PR-1 is not yet clear to start** on the secret half of its own gate condition, though the code-side work (upgrading the envelope reader once payloads arrive) can be prepared in parallel. |
| **PR-2** (dedupe + mapper) | Payload confirmed | ❌ Not clear — CAL-G01 payload samples (§1) are the hard blocker; §2's mapping template is 100% `UNKNOWN` |
| **PR-3** (`createCase()` integration) | Product mapping approved **and** Notion property ready | ❌ Not clear on either condition — §3's Product decisions are pending; §4's Notion property has not been created |

**Section verdict:** none of the three PRs' start conditions are currently met. This is not a new finding — it is the same three-blocker set (`Cal payload`, `Product mapping`, `Notion property`) re-expressed against each PR's specific entry gate.

---

## 7. Final Verdict

## **WAITING FOR EXTERNAL INPUT**

### Why not READY FOR PR-1

PR-1's own stated start condition — "signature confirmed **and** webhook secret available" — is only half met. Signature *mechanism* is confirmed and already implemented/tested; the webhook *secret value* itself is not confirmed present in any deploy target this workspace can verify. Until that's confirmed (or set), PR-1 cannot be declared clear to start against its own gate, even though it is the closest of the three PRs to ready.

### What closes this

| Blocker | Closes when |
|---|---|
| Cal payload (CREATED/CANCELLED/RESCHEDULED samples) | Product/Eng capture a real redacted sample from Cal.com's dashboard test-send or a real staging booking |
| Product mapping | Product signs the event-type → campaign table |
| Notion property | Whoever holds Notion schema access adds `calBookingId` |
| Webhook secret confirmation | Ops confirms (or sets) `CAL_WEBHOOK_SECRET` in the relevant deploy target |

**No architecture proposal was made and no code was changed to produce this checklist.**
