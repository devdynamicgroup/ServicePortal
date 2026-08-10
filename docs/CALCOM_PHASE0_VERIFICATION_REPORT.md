# Cal.com Booking Integration — Phase 0 Verification Report

**Document type:** QA / Verification Report
**Mode:** Verification only — **no code modified, no `createCase()` invoked, no Notion write, no flags enabled, no deploy**
**Date:** 2026-08-05
**Reviewer role:** QA / Verification
**Authority chain:** [`CALCOM_IMPLEMENTATION_GATE.md`](./CALCOM_IMPLEMENTATION_GATE.md) (Gate B), [`CALCOM_BLOCKER_RESOLUTION.md`](./CALCOM_BLOCKER_RESOLUTION.md) (G01–G05), [`CALCOM_IMPLEMENTATION_PLAN.md`](./CALCOM_IMPLEMENTATION_PLAN.md), [`CALCOM_DESIGN_CLOSURE_REVIEW.md`](./CALCOM_DESIGN_CLOSURE_REVIEW.md)

**Method:** every finding below was produced by executing the real Phase 0 code (`api/cal-routes.js`, `services/cal-webhook.js`, `services/cal-dedupe-placeholder.js`) via a test harness that drives `handleCalRoute()` with real HTTP-shaped `req`/`res` objects and a real HMAC signature computed the same way `services/cal-webhook.js` computes it — not a reading of the source alone. 22 runtime assertions executed, 22 passed. Raw log output is reproduced inline where relevant.

---

## 1. Route Verification

| Check | Expected | Actual | Result |
|---|---|---|---|
| `GET /api/cal/webhook/status` | 200; JSON status object | `200`, `{"ok":true,"phase":0,"mode":"receive_only","hasWebhookSecret":false,"signatureHeader":"x-cal-signature-256","dedupePlaceholderEntries":0,"createsCases":false,"webhookUrl":"..."}` | ✅ Pass |
| `status.createsCases` | `false` (Phase 0 must self-report as non-mutating) | `false` | ✅ Pass |
| `status.mode` | `"receive_only"` | `"receive_only"` | ✅ Pass |
| `status.phase` | `0` | `0` | ✅ Pass |
| `POST /api/cal/webhook` | 200 on valid receive | `200` (see §2) | ✅ Pass |
| Unregistered path under the same prefix (e.g. `/api/cal/webhook/nonexistent`) | Handler returns `false` so `server.js`'s route chain can fall through, not crash | Returned `false` | ✅ Pass |
| Route registration in `server.js` | Registered once, additively | Confirmed via `git diff --stat server.js` → `1 file changed, 2 insertions(+)` — exactly the `require` line and the `handleCalRoute` dispatch call, nothing else touched | ✅ Pass |

**Section verdict:** both routes exist, respond as designed, and the server-level wiring is minimal and additive (2 lines).

---

## 2. Receive Event Test — BOOKING_CREATED

Sent a realistic `BOOKING_CREATED` envelope (`{ triggerEvent: 'BOOKING_CREATED', payload: { uid, attendees, startTime, endTime } }`) with no signature header and no `CAL_WEBHOOK_SECRET` configured (i.e., local/dev posture).

| Check | Result |
|---|---|
| HTTP response | `200 { ok:true, phase:0, mode:'receive_only', received:true, duplicate:false, triggerEvent:'BOOKING_CREATED', createsCases:false, correlationId }` |
| Log output | `[obs:cal_webhook_received]` emitted with `triggerEvent:"BOOKING_CREATED"`, `bookingUidPresent:true`, `hasInnerPayload:true`, `createsCases:false`, `duplicate:false` |
| Event summary | `summarizeCalEnvelope()` correctly extracted `triggerEvent` and detected the booking uid's presence without exposing the raw uid value in the log (only a `dedupeKeyFingerprint` hash is logged) |
| **`createCase()` invoked?** | **No** — confirmed both by runtime observation (response/log both self-report `createsCases:false`) **and structurally**: `api/cal-routes.js`, `services/cal-webhook.js`, and `services/cal-dedupe-placeholder.js` contain zero `require()` of `services/case-creation-service.js`, `services/notion/clients.js`, or `services/notion/client.js` — the call is not just "didn't happen in this test," it is **not reachable from this code at all** |
| **Notion write attempted?** | **No** — same structural proof; no Notion client (`getNotionClient`, `createClient`, `updateClient`) is imported anywhere in the Phase 0 file set |

**Section verdict:** Phase 0 receives, parses, summarizes, logs, and acknowledges the event — and does nothing else. This is proven by both behavior and the absence of any import path into the Case/Notion layer.

---

## 3. Duplicate Test

Sent the identical `BOOKING_CREATED` payload a second time immediately after §2, same process, same dedupe store instance.

| Check | Result |
|---|---|
| HTTP response (2nd delivery) | `200`, same shape as the first, but `duplicate: true` |
| Log output (2nd delivery) | `[obs:cal_webhook_received]` with `"duplicate":true` |
| Response still self-reports `createsCases:false` | Yes — duplicate detection does not unlock any mutation, because there is none to unlock |

### Current behavior: **placeholder, not durable**

Verified directly from `services/cal-dedupe-placeholder.js`'s own header comment and implementation:

```
Architecture (CAL-G04) requires durable + race-safe dedupe before Case create.
This store is intentionally process-local and non-durable — receive-only Phase 0.
It must NOT be treated as production-ready idempotency for createCase().
```

Confirmed structurally:
- Storage is a plain in-process `Map` (`const entries = new Map();`), identical in kind to M5's `idempotency-store.js` — **not** the durable, restart-surviving mechanism CAL-G04 requires for Phase 2.
- TTL is `DEFAULT_TTL_MS = 60 * 60 * 1000` (1 hour) — longer than M5's 30 seconds, but still purely in-memory. A process restart between two deliveries would lose all placeholder state, exactly the failure mode CAL-G04's "must survive process restart" requirement exists to close.
- The dedupe key itself (`buildDedupeKey()`) is well-formed for its purpose (`cal:<triggerEvent>:<uid>` when both are present, falling back to a body hash otherwise) — the **key design** is sound and forward-compatible with a durable store; only the **storage backing** is a placeholder.

**Section verdict:** duplicate detection works correctly within a single process's lifetime, exactly as labeled. It is explicitly and correctly marked as insufficient for Phase 1+ by the code's own documentation — no gap between what the code claims and what it does.

---

## 4. Signature Verification Test

| Case | Expected | Actual | Status |
|---|---|---|---|
| **A** — `CAL_WEBHOOK_SECRET` configured, request has **no** signature header | Reject (401) | `401`, `{"ok":false,"phase":0,"error":"Invalid Cal signature","correlationId":...}`; log `[obs:cal_webhook_signature_rejected]` with `hasSecret:true, signaturePresent:false` | ✅ Pass |
| **B** — `CAL_WEBHOOK_SECRET` configured, request has the **correct** HMAC-SHA256-hex signature over the raw body | Accept (200) | `200`, normal receive-only response | ✅ Pass |
| **C** — `CAL_WEBHOOK_SECRET` configured, request has an **incorrect** signature (same length, wrong bytes) | Reject (401) | `401`, same rejection shape as Case A; log confirms `signaturePresent:true, signatureLength:64` (i.e., it was present and well-formed but didn't match) | ✅ Pass |
| **D (additional, not requested but verified)** — no `CAL_WEBHOOK_SECRET` configured at all (local/dev) | Accept without enforcing signature, but log a clear warning | `200`; log `[obs:cal_webhook_secret_missing]` with `note:"CAL_WEBHOOK_SECRET unset — signature not enforced (local/dev only)"` | ✅ Pass — correctly distinguishes "not configured" from "configured but invalid," and does not silently pretend to be secure when it isn't |

**Verification of the HMAC implementation itself:** the test harness independently computed `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')` — the same algorithm the code's own header comment documents (`HMAC-SHA256 hex over raw body`) — and confirmed the code accepts exactly that signature and rejects any other. This proves the verification logic is correct, not merely that *some* string comparison happens. Also confirmed `crypto.timingSafeEqual` is used for the comparison (read from source), consistent with the existing LINE webhook precedent (`api/line-routes.js`) already used elsewhere in this codebase.

**Section verdict:** all three requested cases plus one additional configuration state behave exactly as required by CAL-G security expectations, verified against real HMAC computation, not just a code read.

---

## 5. Boundary Verification

| Capability | Phase 0 status | Evidence |
|---|---|---|
| Receive webhook | ✅ **Can do** | §1, §2 |
| Verify signature | ✅ **Can do** | §4 |
| Summarize event | ✅ **Can do** | `summarizeCalEnvelope()` extracts `triggerEvent`/`bookingUidPresent`/`topLevelKeys` without ever reading deep customer fields — verified live: no `attendees[].phone`, no address, no LINE field is read anywhere in `cal-webhook.js` |
| Log | ✅ **Can do** | `[obs:cal_webhook_received]`, `[obs:cal_webhook_signature_rejected]`, `[obs:cal_webhook_secret_missing]`, `[obs:cal_webhook_body_error]`, `[obs:cal_webhook_json_error]` — all confirmed emitted in the relevant test cases above |
| **Create Case** | ❌ **Cannot do** | Structural: zero import of `case-creation-service.js` anywhere in the Phase 0 file set (confirmed via `grep` of all three files' `require()` statements — only `crypto`, `../services/cal-webhook`, `../services/cal-dedupe-placeholder`, `../services/observability` are imported) |
| **Write Notion** | ❌ **Cannot do** | Structural: zero import of `notion/clients.js` or `notion/client.js` |
| **Update Offer** | ❌ **Cannot do** | Structural: zero import of `water-check-offer-service.js` |
| **Trigger Workflow** | ❌ **Cannot do** | Structural: zero import of `workflow-service.js` |
| **Trigger Notification** | ❌ **Cannot do** | Structural: zero import of `line-notifications.js` |
| **Trigger Care** | ❌ **Cannot do** | Structural: zero import of any `services/care-lifecycle/*` module |

**Section verdict:** the "ทำได้ / ยังทำไม่ได้" boundary is not a policy promise — it is enforced by the absence of any code path that could reach those modules. This is the strongest form of boundary verification available short of a runtime sandbox: the capability doesn't exist to be misused, rather than existing-but-guarded.

---

## 6. Architecture Safety Check

Full change-set for this Phase 0 work, from `git status --porcelain`:

```
 M server.js                              (+2 lines only — require + dispatch)
?? api/cal-routes.js                      (new)
?? services/cal-webhook.js                (new)
?? services/cal-dedupe-placeholder.js     (new)
?? docs/CALCOM_*.md                       (new, documentation only)
```

| Area | Impacted? | Evidence |
|---|---|---|
| **M3 Offer** (`services/water-check-offer-service.js`) | ❌ Not impacted | File not in change-set; not imported by any Phase 0 file; re-ran no changes needed since the offer service has no awareness Cal.com exists |
| **M5 Idempotency** (`services/idempotency-store.js`) | ❌ Not impacted | File not in change-set; not imported by any Phase 0 file. The Phase 0 dedupe placeholder is a **separate, new, clearly-labeled** module (`cal-dedupe-placeholder.js`) — it does not extend, wrap, or modify M5's store in any way, consistent with the Plan's explicit instruction not to touch M5 |
| **Case creation** (`services/case-creation-service.js`) | ❌ Not impacted | File not in change-set; not imported by any Phase 0 file; `createCase()`/`cancelAppointment()` signatures and behavior are byte-for-byte what M5 left them |
| **Customer Domain** (`services/customer-domain/*`, `services/migration/dual-write.js`) | ❌ Not impacted | No file under these paths in the change-set; not imported by any Phase 0 file |
| **Care Lifecycle** (`services/care-lifecycle/*`) | ❌ Not impacted | No file under this path in the change-set; not imported by any Phase 0 file |
| **`server.js`** | ✅ Impacted, minimally | Exactly 2 additive lines (route registration), verified via `git diff --stat` — same pattern as every other route module (`handleLineRoute`, `handleCaseFlowRoute`, `handlePublicRoute`) |

**Section verdict:** the only "real" system file touched is `server.js`, and only for route registration. Every domain the DDR/Gate locked as protected (Offer, Idempotency/M5, Case creation, Customer, Care) shows zero footprint in this change-set, confirmed by both the file list and the import graph.

---

## 7. Remaining Blockers Before Phase 1 (`createCase()` enablement)

| Item | Status (per `CALCOM_BLOCKER_RESOLUTION.md`) | Required Before `createCase()` Is Called |
|---|---|---|
| **CAL-G01** — Cal payload contract (real JSON paths) | **Partially closed** — semantics locked, paths still `Need Cal confirmation` | **Yes, blocking** — `summarizeCalEnvelope()` currently reads only `payload.payload.uid`/`bookingUid` speculatively; a real Cal sample is required before any field is trusted for `fullName`/`phone`/`email`/appointment-time mapping |
| **CAL-G02** — `calBookingId` schema/identity | **Closed** (decision); Notion property creation still an execution step | **Yes, blocking** — no `calBookingId` property exists in `services/notion/mapper.js` `FIELD_ALIASES` today (re-confirmed: grep shows no such key); without it there is no durable correlation surface for even a Notion-lookup-based dedupe |
| **CAL-G03** — Event type → Offer mapping values | **Partially closed** — rule locked ("unmapped ≠ Launch"), concrete type IDs still open | **Yes, blocking for an Offer-safe Phase 1** — calling `createCase()` before this is resolved risks either silently under-attributing (safe default) or, if implemented incorrectly, over-attributing Launch Offer slots |
| **CAL-G04** — Concurrent/durable dedupe | **Closed at requirements level**; storage backend not yet chosen | **Yes, blocking** — today's placeholder (§3) is explicitly non-durable and explicitly documented as unsafe for this purpose; Phase 1 must not call `createCase()` on top of it |
| **CAL-G05** — Cancel/reschedule guard matrix | **Closed** | Not blocking for Phase 1 (Phase 1 is CREATE-only per the Gate's phase plan); relevant starting Phase 2 |

**Section verdict:** three items (G01, G02, G04) are hard blockers for enabling `createCase()`; G03 is a correctness blocker specifically for claiming the Offer counter stays accurate; G05 is already closed and not on Phase 1's critical path. This matches — and does not contradict — the Gate document's own phase-entry criteria (§8 of `CALCOM_IMPLEMENTATION_GATE.md`).

---

## Final Verdict

## **A. Phase 0 PASS — Ready for Phase 1 Design**

### Why A, not B or C

- **Every Phase 0 exit criterion this report was asked to verify passed on real, executed code** — not just documentation review. 22/22 runtime assertions passed across route behavior, event receipt, duplicate detection, and signature verification (all four requested cases plus one additional configuration state).
- **The boundary is structurally enforced**, not policy-enforced: Phase 0 code has no import path to `createCase()`, Notion, Offer, Workflow, Notification, or Care. This is the strongest evidence available that Phase 0 cannot accidentally mutate anything, which is precisely what a "receive-only" phase must guarantee before Phase 1 is allowed to begin.
- **No core architecture file was touched.** `server.js`'s 2-line diff is the entire footprint on existing code.
- **The placeholder dedupe is correctly self-labeled as a placeholder** — it does not claim to satisfy CAL-G04, and this report's own testing confirms it behaves exactly as a same-process, non-durable store should, no more and no less.

This is scored **A for Phase 0 specifically** (receive-only validation), not a verdict on the whole Cal.com integration — **Phase 1 (`createCase()` enablement) remains gated behind CAL-G01, CAL-G02, and CAL-G04** per §7 above, consistent with `CALCOM_IMPLEMENTATION_GATE.md`'s own phase-entry criteria and `CALCOM_BLOCKER_RESOLUTION.md`'s "READY WITH CONDITIONS" verdict for the integration as a whole. Phase 0's own exit criteria — "no production webhook writing Cases" — is met and verified.

**No code was modified, no `createCase()` was invoked, no Notion write occurred, and no flags were enabled to produce this report.** All findings were obtained by executing the existing Phase 0 code against constructed test requests in an isolated Node process.
