# Cloud Run Production Readiness — Gap Audit

**Audit only. No code, configuration, infrastructure, or production data was changed.**

Branch audited: `chore/cloud-run-staging` @ `b3928dc8`
Date: 2026-09-14
Scope: can Cloud Run replace Render **Production** without behavioral, persistence, security, concurrency, webhook, or operational regression — not merely "does the process start".

Evidence classification used throughout: **PROVEN** (verified by a code read or command output in this audit) / **SUPPORTED** (strong indirect evidence) / **ASSUMED** (plausible, unverified) / **MISSING** (no evidence either way) / **BLOCKED** (could not be verified in this environment).

---

## 1. Executive Summary

The application is architecturally close to Cloud-Run-compatible: it binds `process.env.PORT` on `0.0.0.0`, holds no server-side session store, and both background schedulers are provably inert today. The prior "READY FOR STAGING" conclusion holds for *process startup*.

It is **not** ready as written, for one concrete, migration-introduced reason and a cluster of multi-instance correctness gaps:

- **P0 — the Docker build context bakes Google service-account private keys into the image, and `server.js` would serve them over unauthenticated HTTP.** `.dockerignore` excludes `.env` but not `solar-bolt-501808-u9-5fa018d4a911.json`, `render-google-service-account-*.txt`, `data/`, `tmp/`, or `backups/`. Docker ignores `.gitignore`, so files that never reach Render (git-based deploy) *do* reach a Cloud Run image (`COPY . .`). Because `server.js` serves any file under `root = __dirname` with no auth and `.json` in its MIME map, `GET /solar-bolt-501808-u9-5fa018d4a911.json` would return a private key. This is a new exposure created by containerisation, not an existing Render defect.
- **P1 — every concurrency primitive in the app is process-local.** `withCaseLock`, `withIdempotency`, `sendingStartedAt`, the LINE `processedEvents` map, and the Cal dedupe placeholder are all in-memory `Map`s. The Cal path *does* have a durable Notion read (`findClientByCalBookingId`) — but it is guarded only by the process-local lock, so two instances can both miss and both create a Case.
- **P1 — the LINE webhook performs its real work *after* sending HTTP 200** (`runAfterResponse`). Cloud Run's default CPU-throttling deallocates CPU once the response is flushed; that work can stall indefinitely. Render does not throttle this way.
- **P1 — `PUBLIC_BASE_URL` falls back to the hardcoded Render domain**, so an unset variable silently keeps generating `serviceportal.onrender.com` links *and* silently drops the `Secure` flag from the session cookie.
- **P1 — the OCR path can exceed Cloud Run's default 300 s request timeout** (3 attempts × 120 s default).
- **P1 — no SIGTERM handling.** Cloud Run signals every scale-in and revision replacement.

Docker build was **NOT PROVEN** — the local Docker daemon is not running (client 29.7.2 present, `npipe` engine unreachable).

**Verdict: `NOT READY`** — resolvable, but the P0 must be closed before any image is built or pushed.

---

## 2. Current Architecture

| Element | Evidence |
|---|---|
| HTTP server | Raw `node:http` (`server.js:412`), not Express. One `handleRequest` dispatching to 12 API route modules, then static file serving. **PROVEN** |
| Static serving | `root = __dirname` (`server.js:113`), `types` MIME map (`:117-129`), SPA fallback to `index.html` (`:393`). No auth gate on static paths. **PROVEN** |
| Database of record | Notion (`@notionhq/client` ^5.22.0). **PROVEN** |
| Sessions | Stateless HMAC-SHA256 cookie, no store (`services/app-auth.js`). **PROVEN** |
| OCR | Proxied out to a separate Cloud Run service (`services/ocrClient.js`). The main app does no image processing for OCR. **PROVEN** |
| Image generation | `sharp` + librsvg, only in `services/score-share-card.js`. **PROVEN** |
| Schedulers | Two `setInterval` schedulers, both started at `listen()` callback (`server.js:442-443`), both currently inert. **PROVEN** |
| Webhooks inbound | Cal.com (`/api/cal/webhook`), LINE (`/api/line/webhook`). **PROVEN** |
| Local file persistence | `data/`, `tmp/line-contacts/`, `tmp/care-lifecycle/`. **PROVEN** |

---

## 3. Runtime Compatibility

| Check | Finding | Class |
|---|---|---|
| Node version | `Dockerfile` pins `node:20-slim`. `package.json` has **no `engines` field** — nothing asserts the required version. Code uses global `fetch` (Node ≥18) throughout; no Node-21+ syntax observed. Node 20 is adequate. | SUPPORTED |
| Startup command | `CMD ["node","server.js"]`, matching `npm start`. | PROVEN |
| PORT / host | `const port = Number(process.env.PORT) \|\| 3000; const bindHost = process.env.BIND_HOST \|\| '0.0.0.0'` (`server.js:114-115`), `server.listen(nextPort, bindHost, …)` (`:440`). Cloud-Run-correct. | PROVEN |
| Port fallback | On `EADDRINUSE` the server **increments the port and retries** (`server.js:430-438`). On Cloud Run this would silently listen on `PORT+1`, failing the startup probe with a misleading "container failed to listen on PORT" rather than the real cause. Low likelihood; poor failure semantics. | PROVEN |
| SIGTERM / SIGINT | **No handler anywhere.** `grep 'SIGTERM\|SIGINT'` over `server.js api/ services/ config/` returns nothing. Only `uncaughtException` and `unhandledRejection` handlers exist (`server.js:415-428`), both calling `process.exit(1)`. | PROVEN |
| Uncaught handlers | Present, log-and-exit. Correct for a container (fail fast, let the platform restart), but combined with no SIGTERM handling every shutdown is abrupt. | PROVEN |
| Startup side effects | `registerCustomerDomain()`, `validateProductionConfig()`, `getDriveStatus()`, and `require('./services/app-auth')` all run at module load. `app-auth` calls `process.exit(1)` on missing `AUTH_USERS_JSON` / `AUTH_SESSION_SECRET` — a fast, loud, correct container failure mode. | PROVEN |
| `.env` reading at startup | `server.js:19-25` reads `.env` from disk and **overrides `NODE_ENV`** when not on Render. `.dockerignore` excludes `.env`, so in the image `fromFile` is empty and the Dockerfile's `ENV NODE_ENV=production` survives. Correct — but it is load-bearing that `.env` never enters the image. | PROVEN |
| Child processes / native deps | No `child_process` in runtime code. `sharp` is the only native dependency. | PROVEN |

---

## 4. Persistence / State

Module-level mutable state, from `grep` over `services/` and `api/`:

| Location | State | Durability | Cloud Run safety |
|---|---|---|---|
| `services/workflow-service.js:24` | `const locks = new Map()` (`withCaseLock`) | Ephemeral, process-local | **Unsafe multi-instance** |
| `services/workflow-service.js:30` | `const sendingStartedAt = new Map()` — stale-`sending` detection, 3 min window | Ephemeral, process-local | **Unsafe multi-instance**; reconstructable only as "treat as stale" |
| `services/idempotency-store.js:9` | `const entries = new Map()`, 30 s TTL. Its own header comment: *"Process-local … single-instance only"* | Ephemeral | **Unsafe multi-instance** |
| `services/cal-dedupe-placeholder.js:9` | `const entries = new Map()`, 1 h TTL. Header: *"must NOT be treated as production-ready idempotency for createCase()"* | Ephemeral | Observability only — the real guard is the Notion read |
| `api/line-routes.js:184` | `const processedEvents = new Map()`, 10 min TTL — LINE `webhookEventId` dedupe | Ephemeral | **Unsafe multi-instance** |
| `services/water-check-offer-service.js:19` | `offerCache`, 60 s TTL | Reconstructable | Safe (60 s staleness per instance) |
| `services/notion/client.js:5-6` | `notionClient`, `cachedDataSourceId` | Reconstructable | Safe |
| `services/customer-domain/repository.js:15` | `cachedCustomersDataSourceId` | Reconstructable | Safe |
| `services/googleBusinessAuth.js:5` | `tokenCache` | Reconstructable | Safe (dormant today) |
| `services/google-drive-oauth.js:11` | `runtimeRefreshToken` + `data/google-drive-oauth.json` | Ephemeral file + process-local var | Degraded — see §9 |
| `services/canonical-score.js:40` | `cachedSandbox` | Reconstructable | Safe |
| `api/case-flow-routes.js:121` | `scorePagePartial` (HTML fragment cache) | Reconstructable | Safe |

**The important correction to "Notion solves everything":** it partly does for Cal. `services/cal-booking-adapter.js:139` performs `await deps.findClientByCalBookingId(fields.calBookingId)` — a genuine **durable** read against Notion before `createCase`. That is real idempotency for *sequential* retries. What is *not* durable is the mutual exclusion around it (`deps.withCaseLock` at `:138`), so it does not protect against *concurrent* delivery to two instances. **PROVEN.**

Nothing else in the request path depends on in-memory state for correctness of a Notion write; the Case is always re-read via `resolveJob` / `getClient`.

---

## 5. Concurrency

### Scenario A — two concurrent requests on two instances, same lock key
`withCaseLock` (`services/workflow-service.js:68-76`) chains promises in a per-process `Map`. Two instances each hold an independent empty `Map`. **Both believe they hold the lock. PROVEN.** Affects `assessment-persistence-service.js:171`, `case-score-standard-service.js:84`, and `cal-booking-adapter.js:138`. Mitigating factor: the assessment/score paths additionally reject stale revisions (`assessment-persistence-service.js:152` — *"rejects stale revisions"*), so the damage there is a rejected write rather than a corrupted one. The Cal path has no such revision guard.

### Scenario B — same Cal webhook delivered twice, to two instances
Path: `api/cal-routes.js:72` → signature verify (`:87`) → `noteCalDelivery` (placeholder, in-memory, advisory only — its result is logged at `:127` but never used to skip processing) → `processBookingCreated` → `withCaseLock('cal-booking:<uid>')` → `findClientByCalBookingId` → `createCase`.

- Sequential redelivery (Cal retry seconds/minutes later, either instance): the Notion lookup finds the Case, returns `{ idempotent: true }`. **Safe. PROVEN.**
- Truly concurrent delivery to two instances: both locks are separate, both `findClientByCalBookingId` calls run before either `createCase` commits, both return null, **both create a Case**. **PROVEN by code read.** There is no unique constraint in Notion to catch this.

Note the placeholder dedupe is *not* load-bearing — `dedupe.seen` only feeds a log field and the non-`BOOKING_CREATED` acknowledgement body (`cal-routes.js:140`). Removing single-instance behaviour therefore loses nothing that was protecting correctness; the exposure is purely the un-serialised read-then-write.

### Scenario C — crash after an external mutation, before local state update
- Cal: a crash after `createCase` but before the response means Cal retries; the next delivery finds the Case in Notion and returns idempotent. **Safe.**
- LINE: `claimEvent` (`api/line-routes.js:187-197`) marks the event processed *before* the work runs, and the background task runs *after* the 200 (`:741`). A crash mid-background-task leaves the send half-done with no durable record that it was attempted; a LINE redelivery to a *different* instance would find `processedEvents` empty and re-run it, so a **duplicate LINE send / Notion write is possible**. **PROVEN.** This is already true across Render restarts; multi-instance widens the window from "restart" to "always".
- Care Lifecycle has real durable idempotency (`hasTerminalSend(idempotencyKey)`, `services/care-lifecycle/policy.js:65`) — but it is backed by a **local file** (`tmp/care-lifecycle/idempotency-index.json`), which is per-instance and ephemeral. Dormant today; blocking for M9 on Cloud Run.

### Scenario D — scale 1 → 2 instances
Breaks: Cal concurrent-create dedupe (B), LINE event dedupe (C), all `withCaseLock` serialisation (A), the 30 s `withIdempotency` window, `sendingStartedAt` stale detection, and any Drive OAuth refresh token written at runtime to `data/`. Does **not** break: sessions, static assets, Notion reads/writes themselves, OCR proxying, CORS.

**Conclusion: `max-instances=1` is the only currently-correct Cloud Run configuration** unless the locks are made durable. That is a deliberate capacity ceiling, not a fix.

---

## 6. Auth / Sessions

Read in full: `services/app-auth.js`.

| Property | Finding | Class |
|---|---|---|
| Mechanism | `base64url(JSON payload) + '.' + HMAC-SHA256(payload, secret)` (`:141-149`, `:175-185`). No server-side store of any kind. | PROVEN |
| Signing key | `process.env.AUTH_SESSION_SECRET \|\| process.env.SESSION_SECRET` (`:95`), resolved **once at module load** into `RESOLVED_SESSION_SECRET` (`:127`). Not random, not boot-time-derived. | PROVEN |
| Survives restart / instance hop | Yes, provided the same env value is on every revision and instance. Verification uses `crypto.timingSafeEqual` (`:196`). **No sticky sessions needed.** | PROVEN |
| Production guard | `isProductionRuntime()` true ⇒ dev fallback secret rejected and process exits (`:108-114`); dev placeholder value rejected (`:98`). | PROVEN |
| `HttpOnly` | Always set (`:301`). | PROVEN |
| `SameSite` | Always `Lax` (`:302`). | PROVEN |
| `Secure` | **Conditional**: `String(process.env.PUBLIC_BASE_URL \|\| '').startsWith('https')` (`:297`). If `PUBLIC_BASE_URL` is unset on Cloud Run, the staff session cookie is issued **without `Secure`**, even though the connection is HTTPS. | PROVEN |
| Render proxy assumptions | None. The code never inspects `X-Forwarded-Proto`, `X-Forwarded-For`, or `req.socket.encrypted` for auth decisions. Cloud Run's proxy changes nothing here. | PROVEN |
| Token sources | `Authorization: Bearer`, `wm_session` cookie, `x-wm-session` header (`:230-242`). No origin binding — acceptable given the CORS allow-list and `SameSite=Lax`. | PROVEN |

### Every behavioural branch on `NODE_ENV` / `RENDER*` (full repo grep)

| Location | Behaviour when `NODE_ENV=production` | Behaviour otherwise |
|---|---|---|
| `services/app-auth.js:11-17` | `isProductionRuntime()` true → `AUTH_SESSION_SECRET` mandatory, `AUTH_ALLOW_DEV_USERS` fatal | Dev fallback secret allowed, `dev/dev` login possible |
| `api/case-flow-routes.js:697` | `/api/test/create-case` returns 404 | **Enabled — unauthenticated endpoint that creates a real Notion Case via `createTestCase()`** |
| `services/ocrClient.js:21` | Returns a hard 503 when `OCR_SERVICE_URL` is unset or points at localhost | Localhost OCR permitted |
| `server.js:13-41` | On Render, `.env` is not consulted; off Render, `.env`'s `NODE_ENV` wins, else defaults to `development` | — |
| `api/ops-routes.js:105` | Reported in the health payload | — |
| `api/ops-routes.js:104`, `services/migration/customer-backfill.js:450` | `RENDER_GIT_COMMIT` used as a version label — will read `unknown`/`null` on Cloud Run | — |
| `services/url-builder.js:10`, `services/client-feedback.js:214`, `api/cal-routes.js:67`, `api/line-routes.js:692` | `RENDER_EXTERNAL_URL` as second-choice base URL — never set on Cloud Run | — |

`RENDER` / `RENDER_SERVICE_ID` are read only as production *signals*. Their absence on Cloud Run is correct and must be compensated **solely** by `NODE_ENV=production`. The Dockerfile does set `ENV NODE_ENV=production` (`Dockerfile:10`), which closes this — but only as long as nobody overrides it at deploy time or switches to a source/buildpack deploy.

---

## 7. External Dependencies

| Service | Used by | URL / config source | Auth | R/W | Cloud Run concern |
|---|---|---|---|---|---|
| Notion | everything (`services/notion/*`, all Case/Customer/feedback/publication paths) | `NOTION_API_KEY` / `NOTION_TOKEN` + DB ids (`config/env.js`) | Bearer token via SDK | Read + **Write** | None technical. Same egress. Retry via `services/retry.js` (429/5xx, exp. backoff, 3 attempts). No per-request idempotency key — see §5 B |
| LINE Messaging | `services/line-notifications.js`, `api/line-routes.js` | `https://api.line.me` (hardcoded, correct) | `LINE_CHANNEL_ACCESS_TOKEN` Bearer; inbound verified with `LINE_CHANNEL_SECRET` | Read + **Write (sends)** | Background sends after response — CPU throttling (§10) |
| Cal.com | `api/cal-routes.js`, `services/cal-webhook.js` | Inbound only; webhook URL is configured **at Cal.com**, not here | HMAC `x-cal-signature-256` | Inbound write-trigger | Webhook URL must be re-pointed at cutover; concurrent-delivery duplicate risk |
| OCR service | `services/ocrClient.js`, `api/ocr-proxy-routes.js` | `OCR_SERVICE_URL`, default `http://127.0.0.1:5055` | None observed (public Cloud Run URL) | Read | **Timeout math exceeds Cloud Run default** (§5/§16). Same-region call is a latency improvement |
| Google Drive | `services/google-drive.js`, `api/google-drive-routes.js` | OAuth via `googleapis` | `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` | Read + Write | Runtime-refreshed token persisted to ephemeral local disk (§9) |
| Google Maps | `server.js:334` (`/api/maps-config`), client-side | `GOOGLE_MAPS_API_KEY` | API key **returned to the browser** by design | Read | Key is browser-exposed by design; must be domain-restricted to the new host at cutover |
| Google Business | `services/google-business.js`, review scheduler | `GOOGLE_BUSINESS_*` | OAuth | Read | Inert — no credentials in production (**PROVEN** by `isReadyToSync()` gate, §12) |
| OpenAI | `services/feedback-suggest.js` | `OPENAI_API_KEY`, `OPENAI_BASE_URL` | Bearer | Read | Synchronous external call — classify potentially-long |
| Nominatim (OSM) | `server.js:306-318` | Hardcoded `nominatim.openstreetmap.org` | None; custom `User-Agent` | Read | Up to **3 sequential** fetches per request. Rate-limited by OSM policy; no backoff. Egress IP changes at cutover — OSM rate-limits by IP, so behaviour may differ |
| Framer (marketing site) | `api/public-routes.js` CORS allow-list | `PUBLIC_API_ALLOWED_ORIGINS`, defaulting to `water-motion.co` / `www.water-motion.co` | n/a | Inbound read | Unaffected by cutover unless the portal host changes |

Retry/rate-limit handling: `services/retry.js` is a competent shared wrapper (429 + 5xx + `ECONNRESET/ETIMEDOUT/EAI_AGAIN/ENOTFOUND/ENETUNREACH`, exponential backoff from 250 ms, 3 attempts). It is applied to Notion and LINE. It is **not** applied to Nominatim or the Google Maps config endpoint. **PROVEN.**

---

## 8. Environment Variables

`docs/CLOUD_RUN_STAGING_ENV_VARS.md` was read first, then `process.env.` was independently re-grepped across `server.js`, `api/`, `services/`, `config/`. The doc is accurate and comprehensive; it is not a reconstruction. Diff:

**Missing from the doc (all minor):**

| Variable | Location | Note |
|---|---|---|
| `LINE_CONTACTS_DIR` | `services/line-contacts.js:16` | Overrides the local contact-cache directory. Relevant on Cloud Run only because the default (`tmp/line-contacts`) is ephemeral |
| `CARE_LIFECYCLE_SCHEDULER_ENABLED` | `services/care-lifecycle-scheduler.js` (`isSchedulerEnabled()`) | Referenced in the scheduler's own log message at `:122`; the doc lists `CARE_LIFECYCLE_SCHEDULER_RUN_ON_START` but not this one |
| `npm_package_version` | `api/ops-routes.js:104` | npm-injected, not operator-set. Harmless |

**Possible mis-classification:** the doc's Cloud Run note (line 138) states `AUTH_SESSION_SECRET` "is only enforced if `NODE_ENV=production` is explicitly set", implying the operator must remember to set it. The `Dockerfile` already pins `ENV NODE_ENV=production` (`Dockerfile:10`), so the guard is active by default for this image. The doc's advice is still correct (set it explicitly at the service level too, so it survives a base-image or build-method change), but the framing overstates the current risk. Documentation drift, not a defect.

**Specifically verified:**

| Variable | Verified behaviour |
|---|---|
| `NODE_ENV` | Gates four distinct behaviours (§6 table). Most consequential: `/api/test/create-case`. **Must be `production`.** |
| `AUTH_USERS_JSON` | Required; parsed once at load; invalid JSON, non-array, empty array, or an entry missing username/password each `process.exit(1)` with a `[FATAL]` line (`app-auth.js:41-83`). Container will crash-loop visibly, not start degraded. Good. |
| `AUTH_SESSION_SECRET` / `SESSION_SECRET` | Either name accepted (`:95`). Required under `isProductionRuntime()`. Must be **byte-identical** across Render and Cloud Run if sessions are to survive a cutover or rollback. |
| `PORT` | Read at `server.js:114`, injected by Cloud Run. Do not set manually. Confirmed correct. |
| `OCR_SERVICE_URL` | Default is `http://127.0.0.1:5055` (`ocrClient.js:9`). Under `NODE_ENV=production`, a localhost value is rejected with a 503 rather than silently failing (`:17-28`) — good fail-closed design. **Must be set.** |
| `PUBLIC_BASE_URL` | Fallback chain ends at a **hardcoded `https://serviceportal.onrender.com`** (`url-builder.js:10`, `client-feedback.js:214`). Unset ⇒ silently wrong links **and** a non-`Secure` session cookie. **Must be set.** |

---

## 9. Filesystem

Cloud Run's filesystem is an in-memory tmpfs: writes consume the instance's memory allocation and are lost on instance stop, and are never shared between instances.

| Write | Path | Needs to survive? | Verdict |
|---|---|---|---|
| `services/google-drive-oauth.js:56` | `data/google-drive-oauth.json` — **Drive OAuth refresh token** | Only if the OAuth re-auth flow is used at runtime | Degraded on Cloud Run: a token obtained via `/api/google-drive/oauth/...` is lost on restart and invisible to other instances (`runtimeRefreshToken` is also process-local). Harmless **while** `GOOGLE_REFRESH_TOKEN` is set in env. **Separately: this file sits under `root`, and `.json` is in the static MIME map — see §14.** |
| `services/line-contacts.js:57` | `tmp/line-contacts/<lineUserId>.json` — customer contact cache | Reconstructable from LINE/Notion | Ephemeral; per-instance divergence. Cache only |
| `services/care-lifecycle/audit.js:41,106,127-128` | `tmp/care-lifecycle/idempotency-index.json`, `events.jsonl`, reports | **Yes — this is the Care Lifecycle send-idempotency record** | Ephemeral ⇒ duplicate-send risk **if M9 is ever enabled**. Dormant today, so no current impact, but this is a hard blocker for enabling Care Lifecycle on Cloud Run |
| `services/drive-audit.js:70` | `data/drive-upload-audit.jsonl` | Audit trail only | Ephemeral; audit lines lost on restart |
| `services/customer-domain/merge/*`, `services/migration/*` | `tmp/` reports, queues, tickets | Operator-run migrations, not request paths | Not a runtime concern |
| `services/score-share-card.js:57-89` | `os.tmpdir()/water-motion-fontconfig/{fonts.conf,cache}` | No — rebuilt on demand | Safe. Guarded by `if (process.env.FONTCONFIG_PATH \|\| !fs.existsSync(FONT_DIR)) return`. Note it consumes instance **memory** on Cloud Run, and the font source `src/assets/fonts` must be in the image (it is — `src/` is not in `.dockerignore`) |

No OCR temp files exist in the Node app — OCR is a pure HTTP proxy (`api/ocr-proxy-routes.js`), image bytes stay in memory. `services/google-drive.js` does **not** stage files on local disk before upload. **PROVEN** — both are clean.

---

## 10. Webhooks

### Cal.com — `/api/cal/webhook`
1. `readRawBody` with a 1 MiB cap (`cal-routes.js:32-49`).
2. Signature: `verifyCalSignature(rawBody, signature)` on `x-cal-signature-256`. **Fails closed only when configured** — if `CAL_WEBHOOK_SECRET` is unset, the request is accepted with a warning (`:100-105`). On a staging deploy without the secret, *any* unsigned POST could create a Case. **PROVEN.**
3. JSON parse → `buildDedupeKey` → `noteCalDelivery` (advisory, in-memory, result only logged).
4. Non-`BOOKING_CREATED` events acknowledged 200, not processed (by design).
5. `processBookingCreated` → process-local lock → **durable Notion lookup** → `createCase`.

Idempotency: durable for sequential retries, not for concurrent ones (§5 B).
Retry-safety: a 5xx returned from `createCase` surfaces as 502 (`:164`), which Cal.com will retry — correct, and the durable lookup makes that retry safe.

### LINE — `/api/line/webhook`
1. `readRawBody`, 1 MiB cap.
2. Signature: `if (!isLineWebhookConfigured() || !verifyLineSignature(...)) → 401` (`line-routes.js:711`). **Genuinely fails closed** — the comment at `:705-710` documents a previously-fixed defect where an unsigned POST was trusted. This is stricter than the Cal path and is the correct pattern. **PROVEN.**
3. Per-event `claimEvent` on `webhookEventId` — **in-memory `Map`, 10 min TTL** (`:184-197`). Instance-local.
4. `handleLineEvent` awaited inline; returns an optional `backgroundTask`.
5. HTTP 200 sent (`:739`), **then** `backgroundTasks.forEach(task => runAfterResponse(res, task))` (`:741`).

`runAfterResponse` (`:149-167`) defers to `res.on('finish')` → `setImmediate`. **This is the single most Cloud-Run-sensitive line in the codebase:** under Cloud Run's default CPU allocation, CPU is throttled to near-zero once the response is flushed and no other request is in flight. A deferred Notion write or LINE push can stall until the next request arrives or the instance is reclaimed. On Render the process always has CPU. **PROVEN by code read; behaviour under throttling is SUPPORTED (documented Cloud Run semantics), not measured here.**

Multi-instance effect on LINE conversation state: `processedEvents` is the only conversational state, and it is dedupe-only — there is no multi-turn conversation buffer. So the exposure is bounded to duplicate processing of a redelivered event, not a broken conversation.

---

## 11. URLs / Domains

All hits from `grep 'onrender\.com\|run\.app\|localhost\|127\.0\.0\.1\|PUBLIC_BASE_URL\|RENDER_EXTERNAL_URL'` across `server.js`, `api/`, `services/`, `config/`, `index.html`:

| Location | Kind | Cutover risk |
|---|---|---|
| `services/url-builder.js:10` | **Generated public link base**, falls back to hardcoded `https://serviceportal.onrender.com` | **Silently wrong** if `PUBLIC_BASE_URL` unset. Feeds report URLs, feedback URLs, LIFF bind URLs |
| `services/client-feedback.js:214` | Same hardcoded fallback, duplicated | Same |
| `services/app-auth.js:297` | `Secure` cookie flag derived from `PUBLIC_BASE_URL` | **Silently drops `Secure`** if unset |
| `api/cal-routes.js:67` | Reported webhook URL on `/api/cal/webhook/status`, falls back to `http://127.0.0.1:3040` | Display only — but an operator reading a wrong value here during cutover is a real trap |
| `api/line-routes.js:692` | Reported LINE webhook URL, falls back to `''` | Display only |
| `services/ocrClient.js:9` | **Internal service URL**, falls back to `http://127.0.0.1:5055` | Guarded: production rejects localhost with a 503 (`:17-28`) |
| `services/google-drive.js:298` | Public base for Drive-hosted asset links | Follows `PUBLIC_BASE_URL` |
| `api/google-drive-oauth-routes.js:77` | OAuth post-redirect home, falls back to `/` | Safe |
| `server.js:205,294`, `api/*.js` (`new URL(req.url, 'http://localhost')`) | Parsing-only dummy base for `searchParams` | **Dev-only idiom, not a real URL.** No risk |
| `index.html:36` | Static help text | No risk |
| `services/config-validation.js:29` | Startup warning if the base URL is not https | Warns only, never blocks |

No `run.app` reference exists in application code — the OCR URL is entirely env-driven. Correct.

---

## 12. Schedulers

Re-confirmed from source, not from prior audits:

**Google Review sync** (`services/google-review-scheduler.js`): `startGoogleReviewScheduler()` runs unconditionally from `server.js:442`. `GOOGLE_REVIEW_SYNC_ENABLED` **defaults to true** (`boolEnv(name, fallback = true)`, `:10-14`), so the `setInterval` **is created** every 15 minutes and a startup run is scheduled at +5 s. Each tick calls `isReadyToSync()` (`:21-24`), which requires `status.businessProfileConfigured`. With no `GOOGLE_BUSINESS_*` credentials, that is false, and the function logs and returns `null` before any API call. **Inert — PROVEN.** The timer itself does spin; it is a no-op log every 15 min.

**Care Lifecycle** (`services/care-lifecycle-scheduler.js:118-149`): checks `isSchedulerEnabled()`, then `getCareLifecycleFlags().enabled`. `CARE_LIFECYCLE_ENABLED` defaults **false** via `parseBool(value, false)` (`services/care-lifecycle/flags.js:8-20`). On false it logs and returns **before `setInterval` is ever called** (`:127-132`) — no timer is created at all. **Inert — PROVEN**, and more strongly inert than the review scheduler.

Both timers are `.unref()`'d, so neither holds the process open.

**Cloud Run consideration (forward-looking, no action now):** with default CPU allocation, `setInterval` does not fire reliably between requests. Before either scheduler is ever enabled on Cloud Run, the work must move to Cloud Scheduler + an HTTP endpoint, or the service must run with CPU always allocated and `min-instances ≥ 1`. Additionally Care Lifecycle's durable idempotency lives on ephemeral local disk (§9) — that must be relocated to Notion first. Recording as a constraint, not a current finding.

---

## 13. Observability

Sampled: `services/observability.js`, `api/line-routes.js`, `api/cal-routes.js`, `api/ocr-proxy-routes.js`, `services/google-drive.js`, `services/retry.js`.

Good: `logEvent` emits structured single-line JSON with `ts`, `event`, and a `correlationId` (`observability.js:14-22`). Cal and LINE paths thread a correlation id through the whole flow and log `caseId` / `calBookingId` / `lineUserId` / `durationMs` / `failureReason`. `logClassifiedError` routes through `error-taxonomy.js`. This is genuinely good for a Cloud Logging environment.

Gaps (all minor):
- No Cloud Logging `severity` field. Cloud Logging will infer severity from the stream (`console.error` → stderr), so errors will still be visible as errors, but log-based alerting on a `severity` field will not work without a change. **P3.**
- Only one silently-swallowing catch in runtime code: `api/liff-routes.js:189`, and it is inside client-side HTML (`liff.closeWindow()`), not server logic. Everything else logs. Notably `getDriveStatus`, `validateProductionConfig`, and `registerCustomerDomain` failures at startup are caught and warned rather than fatal (`server.js:101-111`, `:132-144`) — deliberate, and the health endpoint surfaces the resulting state.
- `api/ocr-proxy-routes.js:41-46` still carries a `// TEMP debug — remove after OCR fill investigation` `console.warn` on every request. Logs only method/path/content-length — no secrets. Noise, not a leak. **P3.**
- Secret leakage in logs: none found. `server.js:43-74` deliberately logs only `Boolean(...)` presence flags, never values. `api/ocr-proxy-routes.js:98` logs `imageUrl.slice(0, 48)` — a prefix of a data URI or Drive URL, not a credential.

---

## 14. Security

| Check | Finding |
|---|---|
| `.env` git-tracked? | No. `git ls-files --error-unmatch .env` → *"did not match any file"*. Ignored via `.gitignore:1-2`. **PROVEN.** |
| `.env` in Docker context? | No. `.dockerignore:4-5` excludes `.env` and `.env.*`. **PROVEN.** |
| Secrets committed to git? | Tracked files matching secret-ish patterns: `.env.example`, `ocr-service/.env.example`, `scripts/verify-auth-secret.js`. All are templates/tooling by name and purpose. No secret values printed or inspected in this audit. |
| **Secrets in the Docker build context** | **Failure.** Present in the repo root and *not* excluded by `.dockerignore`: `solar-bolt-501808-u9-5fa018d4a911.json`, `render-google-service-account-env.txt`, `render-google-service-account-json-only.txt`, plus `data/` (contains `drive-upload-audit.jsonl`, and would contain `google-drive-oauth.json` if the OAuth flow ever ran locally), `tmp/` (22 MB, includes `customer-backfill/`, `customer-merge/` operator outputs), `backups/` (Notion client backup + Drive manifest), `.venv/` (28 MB), `ocr/` (26 MB). **These are all `.gitignore`d — which is exactly why they are invisible on Render and newly exposed under Docker.** `COPY . .` (`Dockerfile:8`) copies them. **PROVEN by `ls` + reading both ignore files.** |
| **Static serving of those secrets** | `server.js` serves any file under `root = __dirname` with no authentication (`handleApiRequest` returns false for non-`/api` paths, then `resolvePath` → `fs.readFile` → 200). `.json` is in the `types` map (`:121`). So in the built image, `GET /solar-bolt-501808-u9-5fa018d4a911.json` returns a Google service-account private key, and `GET /data/google-drive-oauth.json` returns a Drive refresh token if that file exists. **PROVEN by code read.** |
| Path traversal | `resolvePath` (`:344-351`) decodes, joins under `root`, `path.normalize`s, then rejects anything not `startsWith(root)`. `path.join('/app', '/../etc/passwd')` normalises to `/etc/passwd`, which fails the prefix check → 403. **Adequate. PROVEN.** |
| `/api/ops/health` secret leakage | None. Returns feature booleans, flag states, `publicBaseUrlHost` (host only), and `RENDER_GIT_COMMIT`. No ids, tokens, or database ids — `scorePublicationLedgerMeta()` explicitly documents "never returns database IDs or secrets" and honours it. **PROVEN.** It is however **unauthenticated** and reveals which integrations are configured plus every M8/M9 flag state — reconnaissance value, low. |
| CORS | `api/public-routes.js:30-40` — explicit allow-list, never `*`, `Vary: Origin` set, methods limited to `GET, OPTIONS`. Correct. |
| LINE webhook | Fails closed. Correct. |
| Cal webhook | Fails **open** when `CAL_WEBHOOK_SECRET` is unset. Set in production; a gap for any staging deploy. |
| `/api/test/create-case` | Unauthenticated, creates a real Notion Case, enabled whenever `NODE_ENV !== 'production'`. |

---

## 15. Docker / Build

`Dockerfile` (13 lines) read in full.

| Aspect | Finding |
|---|---|
| Base image | `node:20-slim` — Debian bookworm slim. Reasonable size/compatibility balance |
| `sharp` support | `package-lock.json` contains 7 `sharp-linux-x64` / `sharp-libvips-linux-x64` entries, so the Linux prebuilt binaries (which bundle libvips including librsvg, pango and fontconfig) are resolvable. No system libraries need adding to `node:20-slim`. **SUPPORTED** — unproven without a build |
| Runtime deps only | `npm install --omit=dev` is safe: `linkedom` (the sole devDependency) is required **only** by 7 files under `scripts/`, never by `server.js`, `api/`, `services/`, or `config/`. **PROVEN by grep.** No runtime require of a devDependency exists |
| `postinstall` | None in `package.json` (only `start`). **PROVEN** |
| Reproducibility | `npm install`, not `npm ci` — the lockfile is present but not enforced, so a rebuild can drift. No `engines` field to pin the Node version contractually |
| Layer caching | `COPY package.json package-lock.json*` before `RUN npm install`, then `COPY . .` — correct ordering |
| Permissions | Runs as **root**. `node:20-slim` ships a `node` user; no `USER node` directive. Not a Cloud Run sandbox escape risk, but not least-privilege |
| Exposed port | No `EXPOSE`. Harmless on Cloud Run (it uses `PORT`) |
| Secret leakage | **Fails — see §14.** The build context is the dominant defect |
| Image size | `tmp/` (22 MB) + `.venv/` (28 MB) + `ocr/` (26 MB) + `backups/` all copied in. ~76 MB of dead weight plus slower builds and slower cold starts |
| `.dockerignore` vs frontend assets | `src/assets`, `src/css`, `src/js`, `src/pages` are **all present and none excluded**; `index.html` and `favicon.ico` at root are included. `docs/` and `scripts/` are correctly excluded and nothing at runtime reads them. **PROVEN — static serving will work** |

**Docker build: NOT PROVEN.** `docker version` reports client 29.7.2 but `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine … The system cannot find the file specified` — the Linux engine is not running. No build was attempted, no image was created, nothing was pushed. Per the brief this is **not** treated as a Dockerfile defect.

---

## 16. Deployment Configuration

| Setting | Value | Basis |
|---|---|---|
| GCP project | `478904721531` | **known** — same project as the live OCR service |
| Region | `asia-southeast1` | **recommended** — co-locate with the OCR service to keep the proxy hop in-region |
| Service name | — | **unknown** — operator decision |
| `NODE_ENV` | `production` | **must-verify on the deployed revision.** Already `ENV`'d in the image; verify it is not overridden and that a source/buildpack deploy is never used instead |
| `PORT` | do not set | **known** — Cloud Run injects it |
| CPU | 1 vCPU, **CPU always allocated** | **recommended, justified**: OCR is proxied to a separate service so the app is not CPU-bound for OCR; the one genuinely CPU-heavy path is `sharp` share-card rendering, which 1 vCPU handles. "Always allocated" is **required**, not a preference, because the LINE webhook performs its real work after the response (§10) |
| Memory | **must-verify** | Do not guess. Drivers: `sharp` + libvips working buffers, the 28 MB OCR proxy body cap held fully in memory as a string, and every tmpfs write (fontconfig cache, contact cache) counting against memory. Measure with a real share-card render and a real OCR upload before fixing a number |
| Min instances | `1` | **recommended** — avoids cold-start latency on webhook delivery and keeps the (currently inert) timers alive |
| Max instances | **`1`** | **required given current evidence.** §5 shows every lock, dedupe map, and idempotency store is process-local. `max-instances=1` is the only configuration that preserves today's Render behaviour. Treat as a capacity ceiling to be lifted only after durable locking exists |
| Request timeout | **must-verify, ≥ 400 s** | Justified: `services/ocrClient.js` defaults `OCR_TIMEOUT` to 120 000 ms with `MAX_READ_ATTEMPTS = 3` — up to ~360 s of proxied OCR in a single request, above Cloud Run's **300 s default**. Either raise the service timeout or lower `OCR_TIMEOUT` |
| Request body limit | **must-verify** | Cloud Run caps HTTP/1 requests at 32 MiB; `OCR_PROXY_MAX_BODY_BYTES` defaults to 28 000 000 bytes (`api/ocr-proxy-routes.js:20`). Inside the cap, but with little headroom |
| Env vars | per `docs/CLOUD_RUN_STAGING_ENV_VARS.md` + the three additions in §8 | **known** |
| Secrets | Secret Manager for `NOTION_API_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `CAL_WEBHOOK_SECRET`, `AUTH_USERS_JSON`, `AUTH_SESSION_SECRET`, `GOOGLE_*`, `OPENAI_API_KEY` | **recommended** |
| Service account | dedicated, minimal | **must-verify** — the app authenticates to Google via OAuth refresh token, not ADC, so it needs no Google API roles of its own |
| Ingress | all | **known** — Cal.com and LINE must reach the webhooks |
| Auth (IAM invoker) | `allUsers` | **known** — required for public webhooks and public report links. Application-level auth guards staff routes |
| Health check path | `/api/ops/readiness` | **recommended** — it returns 503 when Notion is unconfigured, unlike `/api/ops/health` which always returns 200 |

### Health check audit (§17 of the brief)

`/api/ops/health` (`api/ops-routes.js:174`) — **always returns HTTP 200 with `ok: true` hardcoded** (`:101-102`). It verifies **nothing live**. Every field is a static config boolean: `isLineConfigured()`, `isNotionConfigured()`, flag getters, a scheduler status object, and `publicBaseUrlHost`. It does **not** ping Notion, LINE, OCR, or Google. A fully-broken Notion token reports `ok: true`. **PROVEN.**

`/api/ops/readiness` (`:178`) — better: returns **503** when `notionOk` is false, `degraded` (still 200) when LINE send, LINE webhook, or https base URL are missing. But `notionOk` is still only `isNotionConfigured()` — presence of a key and database id, not a successful API call. **PROVEN.**

`/api/cal/webhook/status` (`api/cal-routes.js:57-70`) — reports `hasWebhookSecret` (boolean, no value), the signature header name, `dedupePlaceholderEntries` (in-memory count, meaningless across instances), `createsCases: true`, and a **constructed** `webhookUrl` from `PUBLIC_BASE_URL || RENDER_EXTERNAL_URL || 'http://127.0.0.1:3040'`. It does **not** verify that Cal.com is actually pointed at that URL, nor that the secret matches Cal's. An operator using this endpoint to confirm a cutover would be reading the app's own guess, not reality. **PROVEN.**

**Net: no endpoint in this app proves an external dependency is working.** Cloud Run startup/liveness probes against any of them will report healthy on a service that cannot reach Notion.

---

## 17. Cutover Dependencies

| Item | Classification |
|---|---|
| Cal.com webhook URL | **must-change** — repointed at the Cloud Run URL at cutover. Until then Cases keep flowing to Render |
| `CAL_WEBHOOK_SECRET` | **must-remain-unchanged** — rotating it during cutover would break both sides simultaneously |
| LINE webhook URL | **must-change** — one LINE channel has one webhook URL; this is an atomic switch with no dual-running period |
| `LINE_CHANNEL_SECRET` / access token | **must-remain-unchanged** |
| `PUBLIC_BASE_URL` | **must-change** — and this is the highest-risk single variable (§11) |
| DNS / custom domain | **must-verify** — if a custom domain fronts the portal, mapping it to Cloud Run makes `PUBLIC_BASE_URL` unchanged and removes most link risk. If not, every already-issued public link points at Render |
| Public report / feedback links already sent to customers | **must-verify** — links live in delivered LINE messages and Notion records. If the domain changes, previously-sent links only keep working while Render stays up. Argues strongly for a custom domain rather than a raw `run.app` URL |
| `AUTH_SESSION_SECRET` | **must-remain-unchanged** — identical value on both platforms keeps staff logged in across the cutover *and* across a rollback |
| All other secrets | **must-remain-unchanged**, re-injected via Secret Manager |
| Notion databases | **must-remain-unchanged** — same workspace, same database ids, no migration |
| `OCR_SERVICE_URL` | **must-remain-unchanged** (value), **must-verify** (that the in-region call actually works from the new service) |
| Google Maps API key restrictions | **must-change** if the key is HTTP-referrer-restricted to the Render/production domain |
| Google Drive OAuth redirect URI | **must-verify** — `GOOGLE_REDIRECT_URI` and the Google Cloud console's authorised redirect list must include the new host before the OAuth flow is used |
| OpenAI | **must-remain-unchanged** |
| Scheduled jobs | **must-remain-unchanged** (both inert). Must **not** be enabled as part of cutover |
| Monitoring / alerting | **must-change** — Render log alerts do not follow to Cloud Logging |
| Rollback plan | **must-verify** before cutover, not after |

---

## 18. Rollback

Rolling back from Cloud Run to Render is **feasible but not instantaneous**, and the hard constraint is webhook repointing, not deployment.

| Dimension | Assessment |
|---|---|
| Cloud Run revision rollback | Trivial — traffic reassignment to a prior revision. Only helps for a Cloud-Run-to-Cloud-Run regression |
| Render rollback | Only clean if the Render service is **kept running and warm**, not suspended, throughout the cutover window |
| Cal webhook rollback | Manual change at Cal.com. During the gap, a booking is delivered to whichever URL is configured — deliveries are not queued for the other side |
| LINE webhook rollback | Manual change in the LINE console. Same gap semantics. LINE will retry a failed delivery, which partially covers a short gap |
| Duplicate-Case risk during rollback | **Low, thanks to the durable Notion lookup.** If a Cal delivery reaches Cloud Run and a retry reaches Render, `findClientByCalBookingId` on the Render side finds the Case and returns idempotent. This is the one genuinely well-built part of the design. The exception is the concurrent-delivery window in §5 B |
| Duplicate LINE send risk | **Higher.** `processedEvents` is per-process, so an event processed on Cloud Run and redelivered to Render is reprocessed from scratch. Bounded by LINE's own retry policy |
| Data consistency | No risk — both platforms write to the same Notion databases with the same code. Nothing to migrate, nothing to reconcile |
| Session impact | **None, if `AUTH_SESSION_SECRET` is identical.** Stateless HMAC cookies verify on either platform (§6). If the secret differs, every staff member is logged out on both the cutover and the rollback |
| Public links | The blocker. Links issued while `PUBLIC_BASE_URL` pointed at Cloud Run keep pointing there after a rollback and will 404 if the service is deleted. Mitigated entirely by a custom domain; otherwise keep the Cloud Run service alive after rollback |
| Deployment versioning | Cloud Run keeps revisions; `RENDER_GIT_COMMIT` will read `unknown` on Cloud Run so `/api/ops/health` loses its version label (§13) |

**Recommended posture:** custom domain in front of both, Render kept warm for at least one full business cycle, `AUTH_SESSION_SECRET` held constant, and a written, pre-agreed webhook-repoint runbook covering both directions.

---

## 19. Test Coverage

| Surface | Count | Classification |
|---|---|---|
| `tests/` | 44 `*.test.js` across `assessment/`, `benchmark/`, `cal/`, `canonical-score/`, `eligibility/`, `evidence/`, `line/`, `persistence/`, `publish/`, `score/` | **Pure / read-only.** `grep 'NOTION_API_KEY\|@notionhq' tests/` returns **nothing** — no test in this directory touches live Notion. **PROVEN** |
| `scripts/test-*.js` | 71 total; **35** reference `createCase`, `notion`, `fetch(`, or `NOTION_API_KEY` | **Mutation-capable / production-dangerous / unknown.** Consistent with the standing rule that these must never be run blind against production |
| Test runner | `package.json` has only a `start` script — **no `test` script, no CI configuration.** Nothing runs `tests/` automatically | |

**Cloud-Run-specific scenarios with zero coverage today:**

- Multi-instance behaviour — no test exercises two processes against one Case or one booking uid.
- Instance restart mid-flight — no test kills a process between an external mutation and its local state update.
- Webhook retry — Cal's durable dedupe is exercised in-process (`tests/cal/`), but never across a restart or two processes.
- Concurrent webhook delivery — the exact §5 B race is untested.
- Missing-env startup failure — the `process.exit(1)` paths in `app-auth.js` are not asserted by any test.
- Graceful shutdown — nothing to test; no handler exists.
- Container startup — no smoke test that the built image boots and answers `/api/ops/readiness`.

None of these are regressions; they are gaps that only *become* material under Cloud Run.

---

## 20. Findings by Priority

### P0 — blocks deployment

**P0-1 — Google service-account private keys enter the Docker image and are servable over unauthenticated HTTP**

- **Evidence:** `.dockerignore` (13 lines, read in full) excludes `.env`, `.env.*`, `node_modules`, `docs/`, `scripts/`, `ocr-service/`, `.claude/`, `.vscode/`, `.idea/`, `*.log`, `.git` — and nothing else. `ls` of the repo root shows `solar-bolt-501808-u9-5fa018d4a911.json` (2 384 B), `render-google-service-account-env.txt` (2 366 B), `render-google-service-account-json-only.txt` (2 338 B), plus `data/`, `tmp/` (22 MB), `backups/`, `.venv/`, `ocr/`. All are `.gitignore`d (`.gitignore:23-30`) — **Docker does not read `.gitignore`**, so `COPY . .` (`Dockerfile:8`) includes every one. `server.js:113` sets `root = __dirname`; `server.js:380-408` serves any file resolving under `root` with no authentication; `'.json'` is in the `types` map at `server.js:121`. Therefore `GET /solar-bolt-501808-u9-5fa018d4a911.json` against the built image returns the private key body with `Content-Type: application/json`. *(No secret value was read or printed during this audit — the exposure was established from the ignore files, the directory listing, and the static-serving code path.)*
- **Impact:** Full compromise of a Google service-account credential to anyone who can reach the service — and the service must be publicly invokable for the webhooks to work. Secondary: `backups/` contains a Notion clients backup and `tmp/` contains customer-backfill/merge outputs, both customer PII, similarly servable.
- **Likelihood:** Certain, on the first build from this working directory.
- **Current state:** Not exposed on Render, because Render deploys from git and these files are git-ignored. **This is introduced by containerisation.**
- **Required before staging:** Extend `.dockerignore` to exclude `*service-account*.json`, `solar-bolt-*.json`, `render-google-service-account*.txt`, `data/`, `tmp/`, `backups/`, `.venv/`, `ocr/`, `tests/`, `diagnostics/`, `*.csv`. Then verify with `docker build` + `docker run --rm <img> ls -la /app` before any push. Consider also restricting static serving to an allow-list of directories — defence in depth, but out of scope for this audit.
- **Required before production:** Same, plus confirm the exposed service-account key was never pushed to a registry; rotate it if any image was built and pushed from a working tree containing it.

### P1 — must fix or verify before production cutover

**P1-1 — Concurrent Cal.com webhook delivery to two instances can create duplicate Cases**
- **Evidence:** `services/cal-booking-adapter.js:138-159` — `deps.withCaseLock('cal-booking:'+uid, …)` wraps `findClientByCalBookingId` → `createCase`. `withCaseLock` is a per-process `Map` (`services/workflow-service.js:24,68-76`). The placeholder dedupe (`services/cal-dedupe-placeholder.js`) is documented as non-durable and its result is only logged (`api/cal-routes.js:118,127`), never used to skip. Notion has no unique constraint.
- **Impact:** Two Cases for one booking — customer-visible, needs manual Notion cleanup.
- **Likelihood:** Low at current volume with `max-instances=1`; real as soon as scaling is enabled.
- **Current state:** Safe on Render (single instance). Sequential retries are already safe via the durable lookup.
- **Required before staging:** Deploy with `max-instances=1`. Document the ceiling.
- **Required before production:** Same, or make the dedupe durable (a Notion-side conditional create, or an external lock) before lifting the ceiling.

**P1-2 — LINE webhook does its real work after the HTTP response, which Cloud Run's default CPU throttling can starve**
- **Evidence:** `api/line-routes.js:739-741` — `sendJson(res, 200, …)` then `backgroundTasks.forEach(task => runAfterResponse(res, task))`; `runAfterResponse` (`:149-167`) defers via `res.on('finish')` → `setImmediate`. Cloud Run's default CPU allocation throttles CPU to near-zero after the response is flushed.
- **Impact:** Result-delivery LINE sends and their Notion writes stall or never complete, with the customer already acknowledged.
- **Likelihood:** High under default CPU allocation.
- **Current state:** Works on Render, which never throttles CPU.
- **Required before staging:** Deploy with **CPU always allocated**. Exercise a LINE webhook against staging and confirm the deferred work completes.
- **Required before production:** Same; treat "CPU always allocated" as a hard service requirement, not a tuning preference.

**P1-3 — LINE webhook event dedupe is instance-local**
- **Evidence:** `api/line-routes.js:184-197` — `processedEvents` is an in-process `Map` keyed on `webhookEventId`, 10 min TTL. `claimEvent` marks before the work runs; on a thrown error the claim is released (`:735`), but a crash after the 200 leaves it claimed on a process that is gone.
- **Impact:** A LINE redelivery landing on a different instance reprocesses the event — possible duplicate customer message and duplicate Notion write.
- **Likelihood:** Moderate with >1 instance; low with `max-instances=1`.
- **Current state:** Effective on Render; already ineffective across restarts.
- **Required before staging:** `max-instances=1`.
- **Required before production:** Same, or move the claim into Notion.

**P1-4 — `PUBLIC_BASE_URL` falls back to the hardcoded Render domain and silently un-`Secure`s the session cookie**
- **Evidence:** `services/url-builder.js:10` and `services/client-feedback.js:214` both end their fallback chain at `'https://serviceportal.onrender.com'`. `services/app-auth.js:297` computes `const secure = String(process.env.PUBLIC_BASE_URL || '').startsWith('https')` and only then appends `Secure` (`:309`).
- **Impact:** With the variable unset, every generated report/feedback/LIFF link points at the old Render host *and* the staff session cookie is transmitted without `Secure` — with **no error and no log line**, because `services/config-validation.js:29` only warns and never blocks.
- **Likelihood:** Moderate — it is exactly the kind of variable an operator assumes the platform provides, as `RENDER_EXTERNAL_URL` did.
- **Current state:** Correct on Render via `RENDER_EXTERNAL_URL`, which does not exist on Cloud Run.
- **Required before staging:** Set `PUBLIC_BASE_URL` explicitly to the staging URL. Verify by reading `publicBaseUrlHost` from `/api/ops/health` and inspecting a real `Set-Cookie`.
- **Required before production:** Set it to the production URL and confirm `Secure` is present on the issued cookie.

**P1-5 — The OCR request path can exceed Cloud Run's default 300 s request timeout**
- **Evidence:** `services/ocrClient.js:36-41` — `getOcrTimeoutMs()` defaults to `120000`; `:50` — `MAX_READ_ATTEMPTS = 3`; `:392-396` — retries on `ENGINE_UNAVAILABLE`/`OCR_OFFLINE`/`OCR_TIMEOUT`/`OCR_INTERNAL_ERROR`. Worst case ≈ 360 s inside a single proxied request. Cloud Run's default request timeout is 300 s.
- **Impact:** Cloud Run terminates the request at 300 s and the field user sees a generic failure rather than the app's structured OCR error.
- **Likelihood:** Low per request (requires repeated OCR cold starts), but this is exactly the OCR-cold-start case the 120 s default was chosen for.
- **Current state:** No such platform ceiling on Render.
- **Required before staging:** Set the Cloud Run request timeout to ≥ 400 s, or set `OCR_TIMEOUT` low enough that 3 × timeout < the configured timeout.
- **Required before production:** Same, with one real end-to-end OCR read verified through the deployed service.

**P1-6 — No SIGTERM handling; every Cloud Run shutdown is abrupt**
- **Evidence:** `grep 'SIGTERM\|SIGINT'` over `server.js`, `api/`, `services/`, `config/` returns **no matches**. Only `uncaughtException`/`unhandledRejection` handlers exist (`server.js:415-428`).
- **Impact:** Cloud Run sends SIGTERM on every scale-in, revision replacement, and instance recycle. Node's default is immediate termination: in-flight requests are dropped, and any `runAfterResponse` LINE task mid-execution is lost — potentially after the Notion write but before the LINE send, or vice versa.
- **Likelihood:** Certain — it happens on every deploy.
- **Current state:** Render also restarts without a graceful window, so this is a pre-existing gap. It matters more on Cloud Run because instance recycling is routine rather than deploy-only.
- **Required before staging:** None (staging tolerates it). Record it.
- **Required before production:** Add a SIGTERM handler that stops accepting connections, drains in-flight requests, and awaits outstanding background tasks before exiting — **and** set Cloud Run's shutdown grace period accordingly.

**P1-7 — `/api/test/create-case` is unauthenticated and enabled whenever `NODE_ENV !== 'production'`**
- **Evidence:** `api/case-flow-routes.js:696-709` — `const testApiEnabled = process.env.ENABLE_TEST_API === 'true' || process.env.NODE_ENV !== 'production'`. No `assertAppAuth` call on this route, unlike its neighbours at `:686` and `:727`. `createTestCase` (`services/case-creation-service.js:276-292`) calls the real `createCase` against the real Notion database.
- **Impact:** Anyone who can reach the service can create real Notion Cases by POSTing an empty body.
- **Likelihood:** Currently mitigated — `Dockerfile:10` sets `ENV NODE_ENV=production`. The risk is an operator-set env var overriding it, or a deploy method (source/buildpack) that bypasses the Dockerfile.
- **Current state:** Safe on Render, which sets `NODE_ENV=production` platform-side.
- **Required before staging:** Confirm `NODE_ENV=production` on the deployed revision (`gcloud run services describe`), then confirm `POST /api/test/create-case` returns **404**.
- **Required before production:** Same verification, as an explicit, checked-off cutover step.

### P2 — should fix around production, does not block staging

1. **`npm install` rather than `npm ci`, and no `engines` field** — `Dockerfile:6`, `package.json`. A rebuild of the same commit can produce a different dependency tree; nothing contractually pins Node 20.
2. **~76 MB of dead weight in the image** — `tmp/`, `.venv/`, `ocr/`, `backups/` (§14). Slower builds and cold starts. Fixed by the same `.dockerignore` change as P0-1.
3. **Drive OAuth refresh token persisted to ephemeral local disk** — `services/google-drive-oauth.js:56` writes `data/google-drive-oauth.json`. Lost on restart, invisible to other instances. Harmless while `GOOGLE_REFRESH_TOKEN` is set in env; a trap if anyone ever relies on the runtime re-auth flow. Note the file is also servable by the static handler (folded into P0-1's remediation).
4. **Care Lifecycle send-idempotency lives on ephemeral local disk** — `services/care-lifecycle/audit.js:41` / `policy.js:65`. No current impact (M9 dormant), but a **hard blocker for enabling Care Lifecycle on Cloud Run**: on ephemeral storage the duplicate-send guard silently stops guarding.
5. **`EADDRINUSE` increments the port** — `server.js:430-438`. On Cloud Run this converts a clear "port in use" into an opaque "container failed to listen on `$PORT`".
6. **Cal webhook fails open when `CAL_WEBHOOK_SECRET` is unset** — `api/cal-routes.js:100-105`. Production sets it; a staging deploy that forgets it would accept unsigned Case-creating POSTs. The LINE path's fail-closed pattern (`line-routes.js:711`) is the right model.
7. **`OCR_PROXY_MAX_BODY_BYTES` default of 28 MB sits close to Cloud Run's 32 MiB request cap** — `api/ocr-proxy-routes.js:20`, and the body is accumulated as a single JS string in memory.
8. **No health endpoint verifies any live dependency** — §16. Startup and liveness probes will report healthy on a service that cannot reach Notion.
9. **Runs as root** — no `USER node` in the Dockerfile.
10. **Nominatim address search issues up to 3 sequential unretried external fetches per request** — `server.js:306-318`. Egress IP changes at cutover, and OSM rate-limits by IP.

### P3 — operational / documentation

1. `docs/CLOUD_RUN_STAGING_ENV_VARS.md:138` overstates the `NODE_ENV` risk given `Dockerfile:10` already pins it (§8).
2. Three env vars absent from that doc: `LINE_CONTACTS_DIR`, `CARE_LIFECYCLE_SCHEDULER_ENABLED`, `npm_package_version` (§8).
3. `/api/ops/health` will report `version: "unknown"` on Cloud Run — `RENDER_GIT_COMMIT` does not exist there (`api/ops-routes.js:104`).
4. Structured logs omit a Cloud Logging `severity` field (`services/observability.js:14-22`).
5. `// TEMP debug` `console.warn` on every OCR proxy request — `api/ocr-proxy-routes.js:41-46`.
6. No `test` npm script and no CI configuration; `tests/` (44 files) never runs automatically.
7. No container smoke test — nothing verifies the built image boots and answers `/api/ops/readiness`.
8. `/api/ops/health` is unauthenticated and discloses every M8/M9 flag state and which integrations are configured. Low value to an attacker; worth an access decision.

### NO ACTION REQUIRED — evidence shows the current implementation is already correct

1. **Sessions are genuinely stateless and migration-safe.** HMAC over an env-supplied secret resolved once at load; no store, no boot-time randomness, no sticky-session requirement (`services/app-auth.js:95,127,141-149`). Survives instance hops, restarts, and a Render↔Cloud Run cutover unchanged. **PROVEN.**
2. **No runtime file requires a devDependency.** `linkedom` appears only in 7 files under `scripts/`, which `.dockerignore` excludes anyway. `npm install --omit=dev` is safe. **PROVEN by grep.**
3. **Both schedulers are inert.** Care Lifecycle never creates its `setInterval` (`care-lifecycle-scheduler.js:127-132` + `flags.js:20` default false); Google Review sync creates a timer but every tick short-circuits at `isReadyToSync()` (`google-review-scheduler.js:21-24,32-38`). **PROVEN from source, not from memory.**
4. **Static path-traversal protection is adequate** — `server.js:344-351` normalises then enforces the `root` prefix. **PROVEN.**
5. **`sharp` needs no extra system libraries on `node:20-slim`** — `package-lock.json` carries the `sharp-linux-x64` / `sharp-libvips-linux-x64` prebuilt entries. **SUPPORTED** (build unproven).
6. **No Render-proxy coupling.** Nothing reads `X-Forwarded-*` or `req.socket.encrypted` for any decision; the single `req.socket.remoteAddress` use (`api/google-drive-routes.js:143`) is one log field. Cloud Run's proxy changes no behaviour. **PROVEN.**
7. **CORS is a strict explicit allow-list, never `*`**, with `Vary: Origin` and `GET, OPTIONS` only (`api/public-routes.js:30-40`). **PROVEN.**
8. **The LINE webhook fails closed on signature verification** (`api/line-routes.js:711`), with the prior defect documented in-line. Correct. **PROVEN.**
9. **No OCR or Drive temp files on local disk.** OCR is a pure in-memory HTTP proxy; `services/google-drive.js` does not stage uploads locally. **PROVEN.**
10. **`.env` is git-ignored and excluded from the Docker build context.** **PROVEN.**
11. **Retry handling is sound** — shared exponential-backoff wrapper with correct transient classification, applied to Notion and LINE (`services/retry.js`). **PROVEN.**
12. **`PORT` / host binding is already Cloud-Run-correct** and needs no code change (`server.js:114-115,440`). **PROVEN.**
13. **Startup misconfiguration fails loudly, not silently** — missing `AUTH_USERS_JSON` or `AUTH_SESSION_SECRET` exits 1 with a `[FATAL]` line, which Cloud Run surfaces as a clean crash-loop (`services/app-auth.js:19-22,89-92`). **PROVEN.**
14. **`tests/` is entirely offline** — no live Notion reference in any of the 44 files. **PROVEN by grep.**
15. **All frontend assets survive `.dockerignore`** — `src/assets`, `src/css`, `src/js`, `src/pages`, `index.html`, `favicon.ico` all included; only `docs/`, `scripts/`, `ocr-service/` and editor/VCS directories are excluded, none of which are read at runtime. **PROVEN.**

---

## 21. Production Readiness Verdict

# NOT READY

One P0 (service-account private keys baked into the image and servable over unauthenticated HTTP) must be closed before any image is built or pushed. Seven P1s must be resolved or explicitly accepted before a production cutover, and the Docker build itself remains unproven.

This is a **fixable** verdict, not a structural one. The P0 is a `.dockerignore` change. Four of the seven P1s are Cloud Run *service configuration* (`max-instances=1`, CPU always allocated, request timeout, `PUBLIC_BASE_URL`), not code. Once P0-1 is closed and the image is built and verified clean, this repository moves to **READY FOR STAGING ONLY**.

---

## 22. Exact Next Actions

**Before any image is built (P0):**
1. Extend `.dockerignore` with `*service-account*.json`, `solar-bolt-*.json`, `render-google-service-account*.txt`, `data/`, `tmp/`, `backups/`, `.venv/`, `ocr/`, `tests/`, `diagnostics/`, `*.csv`.
2. Start the Docker daemon and run `docker build -t serviceportal-staging-local .`, then verify the context is clean: `docker run --rm serviceportal-staging-local sh -c "ls -la /app && ls /app/data /app/tmp 2>&1"`. Expect no credential files, no `data/`, no `tmp/`. Remove the local image afterwards.
3. Confirm no image built from a working tree containing those credential files has ever been pushed to any registry. If one has, rotate the service-account key.

**Before a staging deploy:**
4. Confirm `sharp` resolves and `/api/public/...` share-card rendering works inside the container (this is the only path exercising native code).
5. Deploy with: `NODE_ENV=production`, `PUBLIC_BASE_URL=<staging URL>`, `OCR_SERVICE_URL=https://ocr-service-478904721531.asia-southeast1.run.app`, `--max-instances=1`, `--no-cpu-throttling`, `--min-instances=1`, `--timeout=400`, region `asia-southeast1`, all `CUSTOMER_DOMAIN_*` and `CARE_LIFECYCLE_*` unset.
6. Verify on the live revision: `POST /api/test/create-case` returns **404**; the login `Set-Cookie` carries `Secure`; `/api/ops/health` reports the staging host in `publicBaseUrlHost`; `/api/ops/readiness` returns 200.
7. Exercise one LINE webhook against staging and confirm the deferred `runAfterResponse` work actually completes (this is the P1-2 proof).
8. Do **not** repoint the Cal.com or LINE production webhooks at staging.

**Before a production cutover:**
9. Add SIGTERM handling with in-flight request draining and background-task awaiting (P1-6).
10. Decide the `max-instances=1` question: accept the capacity ceiling, or make `withCaseLock` / Cal dedupe / LINE event dedupe durable (P1-1, P1-3).
11. Measure memory under a real share-card render and a 28 MB OCR upload, and fix the memory allocation from that measurement rather than a guess.
12. Decide the domain question — a custom domain in front of both platforms removes most of the public-link and rollback risk (§17, §18).
13. Write the bidirectional webhook-repoint runbook and confirm `AUTH_SESSION_SECRET` is byte-identical on both platforms.
14. Switch `npm install` to `npm ci` and add an `engines` field (P2-1).
