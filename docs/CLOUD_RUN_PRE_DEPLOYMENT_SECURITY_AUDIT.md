# Cloud Run Pre-Deployment Security & Failure-Window Audit

**AUDIT ONLY. No code, configuration, infrastructure, credential, or production data was changed. No secret value was read, printed, or logged anywhere in this document — structural key-name checks only.**

Branch audited: `chore/cloud-run-staging` @ `55f87d34`
Date: 2026-09-14
Scope: one targeted follow-up round to `docs/CLOUD_RUN_PRODUCTION_READINESS_GAP_AUDIT.md`, answering eight specific failure-window questions plus a full secrets inventory. This round deliberately does **not** re-run the broad audit; it goes deep on narrow interactions between the Docker build context, the static file server, the credential architecture, and multi-instance failure windows.

Evidence classification: **PROVEN** (verified by direct code read or command output in this round) / **SUPPORTED** (strong indirect evidence) / **MISSING** (no evidence either way).

---

## 1. Executive Summary

This round **confirms the prior P0 and narrows its fix from "risky" to "safe"**, while surfacing four genuinely new findings that the previous audit's breadth did not reach. On the central question — does removing the Google service-account JSON from the Docker image break anything? — the answer is an unambiguous **no**: every Google integration in the deployed runtime (`server.js`, `api/`, `services/`, `config/`) authenticates via OAuth client-id/secret/refresh-token read from environment variables, or via a plain browser-exposed API key. There is **zero** occurrence of `GOOGLE_APPLICATION_CREDENTIALS`, `keyFile`, `credentials:`, `GoogleAuth`, `JWT(`, or `GOOGLE_SERVICE_ACCOUNT_*` anywhere in runtime code, and `getDriveStatus()` hardcodes `authMode: 'oauth'` and `serviceAccountEmail: null` (`services/google-drive.js:245,248`). The three credential files are orphaned artifacts of a July 2026 setup script (`scripts/build-render-sa-json.js`) for an auth mode that `docs/ENVIRONMENT.md:31,78` explicitly documents as **deprecated and no longer used**. Deleting or `.dockerignore`-ing them is a pure security win with zero feature risk.

The P0's **severity is unchanged, but its blast radius is larger than recorded**: the prior audit named three credential files; this round proves the static handler at `server.js:386-408` serves *any* file under `root` regardless of whether its extension is in the MIME map (unknown extensions fall through to `application/octet-stream` at `:403`, still a full-content 200). So `render.yaml`, `backups/notion-clients-backup-*.json` (491 KB of real customer records), `tmp/customer-backfill/*` and `tmp/customer-merge/*` operator outputs, `clients_30_mock_data.csv`, and `_wm_index.html` are equally servable. The fix approach — extend `.dockerignore` — still holds, but it must be paired with a **static-serving allow-list**, because `.dockerignore` protects only against files that exist *today*; it does not prevent the next `.gitignore`d artifact from becoming a public download.

Four new findings this round, none of which require another audit round to resolve: public report/feedback tokens carry only **4 characters of base-36 entropy** with no rate limiting anywhere in the codebase; `/auth/google/callback` is unauthenticated and mutates the live Drive refresh token in-process; there are **two inconsistent definitions of "production"** in the codebase; and the LINE post-200 block has a proven mutation-ordering window in which a customer receives their result message while Notion still reads `sending`, which the stale-recovery logic then converts into a **guaranteed duplicate send**.

---

## 2. Q1 — Credential Architecture After JSON Removal

### 2.1 Method

Grepped the deployed runtime surface only (`server.js`, `api/`, `services/`, `config/` — `scripts/` and `tests/` excluded, both because they are not in the image and because the question is about runtime dependency):

```
grep -rn "GOOGLE_APPLICATION_CREDENTIALS|keyFile|readFileSync|require(...json)|credentials:|GoogleAuth|JWT(" server.js api/ services/ config/
grep -rn "GOOGLE_SERVICE_ACCOUNT" server.js api/ services/ config/     → NONE
grep -rn "solar-bolt|5fa018d4a911|service-account" server.js api/ services/ config/
```

**`GOOGLE_APPLICATION_CREDENTIALS`: zero matches. `keyFile`: zero matches. `credentials:` passed to a googleapis constructor: zero matches. `GoogleAuth` / `JWT(`: zero matches. `GOOGLE_SERVICE_ACCOUNT_*`: zero matches. PROVEN.**

Every `fs.readFileSync` in runtime code was individually classified. None reads a credential keyfile:

| File:line | Reads | Credential? |
|---|---|---|
| `server.js:20` | `.env`, regex-extracts `NODE_ENV` only | No |
| `api/case-flow-routes.js:125` | `src/pages/score.html` | No |
| `services/canonical-score.js:53` | score engine source into a `vm` sandbox | No |
| `services/care-lifecycle/audit.js:33` | `tmp/care-lifecycle/idempotency-index.json` | No (dormant) |
| `services/care-lifecycle/outcome-report.js:19` | `events.jsonl` | No (dormant) |
| `services/customer-domain/merge/audit.js:32`, `merge/queue.js:21` | operator merge artifacts | No (dormant) |
| **`services/google-drive-oauth.js:32`** | `data/google-drive-oauth.json` | **Yes — a Drive *refresh token*, not a service-account key.** Optional third-choice fallback only |
| `services/line-contacts.js:40` | `tmp/line-contacts/<id>.json` contact cache | No |
| `services/migration/customer-backfill.js:430,645`, `customer-reconcile/report.js:129` | migration reports | No (operator scripts) |
| `services/score-share-card.js:106` | font/asset file | No |

### 2.2 Google Drive — `services/google-drive.js`, `services/google-drive-oauth.js`

`google-drive.js` holds **no auth logic at all**; it imports everything from `google-drive-oauth.js` (`:1-8`). That module's complete credential surface is `getOAuthEnv()` (`:20-27`):

```
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI / GOOGLE_REFRESH_TOKEN
```

The client is constructed as `new google.auth.OAuth2(clientId, clientSecret, redirectUri)` (`:88`) and credentialed with `client.setCredentials({ refresh_token: refreshToken })` (`:100`) — the three-legged OAuth refresh-token flow, never a service account. `getRefreshToken()` (`:39-45`) resolves in order: in-process `runtimeRefreshToken` → `process.env.GOOGLE_REFRESH_TOKEN` → `readStoredRefreshToken()` from `data/google-drive-oauth.json`. That third source is the only disk read, and it holds a refresh token, not a keyfile. `getDriveStatus()` (`services/google-drive.js:244-248`) returns literal `authMode: 'oauth'` and literal `serviceAccountEmail: null`. **Env-var-only. PROVEN.**

### 2.3 Google Business — `services/googleBusinessAuth.js`, `services/google-business.js`

`googleBusinessAuth.js` does not import `googleapis` at all. It POSTs `client_id` / `client_secret` / `refresh_token` / `grant_type=refresh_token` directly to `https://oauth2.googleapis.com/token` with `fetch` (`:114-134`), reading only `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`, `GOOGLE_BUSINESS_REFRESH_TOKEN`, `GOOGLE_BUSINESS_REDIRECT_URI` (`:15-21`). **Env-var-only, and dormant in production. PROVEN.**

### 2.4 Google Maps

`server.js:334-339` — `/api/maps-config` returns `process.env.GOOGLE_MAPS_API_KEY` to the browser. A plain API key, not a credential file; no service account involved at any point. **PROVEN.**

### 2.5 The `solar-bolt-501808-u9-5fa018d4a911.json` file itself

Structural check (key **names** only, extracted with `grep -o '"[a-z_]*"[[:space:]]*:'` — no value was displayed):

| File | Bytes | Structural keys present |
|---|---|---|
| `solar-bolt-501808-u9-5fa018d4a911.json` | 2384 | `type`, `project_id`, `private_key_id`, `private_key`, `client_email`, `client_id`, `auth_uri`, `token_uri`, `universe_domain` |
| `render-google-service-account-env.txt` | 2366 | identical key set |
| `render-google-service-account-json-only.txt` | 2338 | identical key set |

All three carry the exact key shape of a **real GCP service-account key**, including a `private_key` member. **They must be treated as live credentials until proven rotated.**

**Provenance — PROVEN.** `scripts/build-render-sa-json.js:5-7` names all three files as its `srcPath` / `saPath` / `outPath`, and `:13,20,99` show it stripping a `GOOGLE_SERVICE_ACCOUNT_JSON=` prefix. They are the input, key source, and output of a one-time July 2026 helper that reformatted a service-account key for pasting into a Render environment variable. `docs/ENVIRONMENT.md:31` states *"Do **not** use a Service Account for Drive uploads (`GOOGLE_SERVICE_ACCOUNT_JSON` is deprecated for this app)"* and `:78` strikes through *"Service Account ... is no longer used for uploads."* The auth mode these files served was abandoned; the files were not.

### 2.6 Q1 Conclusion — definitive

> **The application does not need `solar-bolt-501808-u9-5fa018d4a911.json` or either `render-google-service-account-*.txt` file. Every Google integration in the deployed runtime authenticates purely from environment variables (OAuth client id/secret/refresh token, or a plain Maps API key). These three files are orphaned artifacts of a deprecated auth mode, read by nothing in `server.js`, `api/`, `services/`, or `config/`. Removing them from the Docker image — or from the working tree entirely — is a pure security win with zero feature risk, and requires no Secret Manager keyfile mount.**

No Cloud Run keyfile/Secret-Manager-mount work is needed to close the P0. The only Secret Manager work remains the ordinary env-var injection already recorded in the prior audit.

**Corollary risk (unchanged, still real):** because the keys are live-shaped, the prior audit's instruction to confirm no image containing them was ever pushed to a registry, and to rotate if one was, still stands.

---

## 3. Q2 — Full Docker Image Content Inventory

`Dockerfile:8` is `COPY . .` against `root = __dirname`. Docker consults **only** `.dockerignore`; `.gitignore` is irrelevant to the build context. Full 13-line `.dockerignore`: `.git`, `.gitignore`, `node_modules`, `.env`, `.env.*`, `*.log`, `logs/`, `docs/`, `scripts/`, `ocr-service/`, `.claude/`, `.vscode/`, `.idea/`.

### 3.1 The static-serving escape hatch — an important correction to the prior audit

The prior audit reasoned that exposure depended on `.json` being in the MIME map (`server.js:121`). **That is not the gate.** Reading `server.js:386-408` in full:

- `isAssetRequest = req.url.startsWith('/src/') || req.url.includes('.')` (`:387`) — every filename below contains a dot.
- If the file exists, `servePath = filePath` (`:393`), `fs.readFile` (`:396`), then `res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' })` (`:402-403`).

**An unknown extension does not block the response — it falls through to `application/octet-stream` and the full file body is still returned with a 200.** `.txt`, `.yaml`, `.jsonl`, `.bat`, `.md` are all servable. **PROVEN.** This widens the P0 from three files to every unexcluded artifact in the tree.

### 3.2 Every root-level entry, cross-referenced

| Root entry | Size | `.gitignore` | `.dockerignore` | In image? | Belongs in a production runtime image? |
|---|---|---|---|---|---|
| `.claude/`, `.vscode/`, `.git`, `.gitignore` | — | mixed | **Y** | No | n/a |
| `.cursor/` (3 `.mdc` rule files) | small | N | **N** | **Yes** | No — editor config, dead weight |
| `.dockerignore`, `Dockerfile` | — | N | N | Yes | Harmless |
| `.env` | 821 B | Y | **Y** | No | Correctly excluded |
| `.env.example` | 7.9 KB | N (negated) | **Y** (`.env.*`) | No | Correctly excluded |
| `.node-server.*.log`, `.review-server.*.log`, `.server.*.log`, `feedback-review.log` | ≤17 KB | Y | **Y** (`*.log`) | No | Correctly excluded |
| **`.venv/`** | **28 MB** | Y | **N** | **Yes** | **No** — Python virtualenv, includes `pip/_vendor/certifi/cacert.pem` |
| `FLOW_STRUCTURE.md`, `README.md` | small | N | N | Yes | Harmless, minor info disclosure |
| **`_wm_index.html`** | 32 KB | N | N | **Yes** | **No** — stale duplicate of the portal UI, servable at `/_wm_index.html` |
| `api/`, `config/`, `services/`, `src/`, `server.js`, `index.html`, `favicon.ico`, `package*.json` | — | N | N | Yes | **Required** |
| **`backups/`** | **516 KB** | Y | **N** | **Yes** | **No — real customer PII.** `notion-clients-backup-2026-08-24T*.json` (491 KB), `drive-site-inspection-manifest-*.json` (35 KB) |
| **`clients_30_mock_data.csv`** | 7.7 KB | N | **N** | **Yes** | **No** — mock customer records; `.csv` **is** in the MIME map (`server.js:122`) |
| **`data/`** | 8 KB | Y | **N** | **Yes** | **No** — `drive-upload-audit.jsonl`; this is also the write target for `data/google-drive-oauth.json` (Drive **refresh token**) at `google-drive-oauth.js:56` |
| **`diagnostics/`** | 468 KB | N | **N** | **Yes** | **No** — OCR test images, Python scripts, `__pycache__`, JSON reports |
| `docs/`, `scripts/`, `node_modules`, `ocr-service/` | — | mixed | **Y** | No | Correctly excluded |
| **`ocr/`** | **26 MB** | N | **N** | **Yes** | **No** — Paddle demo + test image corpus |
| **`render-google-service-account-env.txt`** | 2366 B | Y | **N** | **Yes** | **NO — GCP service-account private key (P0)** |
| **`render-google-service-account-json-only.txt`** | 2338 B | Y | **N** | **Yes** | **NO — GCP service-account private key (P0)** |
| **`render.yaml`** | 5.1 KB | N | **N** | **Yes** | **No** — Render service definition; discloses env var names and service topology |
| `requirements-supported.txt` | 1.4 KB | N | N | Yes | No — Python deps, dead weight |
| **`solar-bolt-501808-u9-5fa018d4a911.json`** | 2384 B | Y | **N** | **Yes** | **NO — GCP service-account private key (P0)** |
| `start-app.bat` | 191 B | N | N | Yes | No — Windows dev launcher |
| **`tests/`** | 520 KB | N | **N** | **Yes** | No — 44 offline test files, dead weight |
| **`tmp/`** | **22 MB** | Y | **N** | **Yes** | **No — customer PII.** `customer-backfill/*.json`, `customer-merge/*.json`, `customer-merge-test/audits/*`, `care-lifecycle-scheduler-test/*` (incl. `idempotency-index.json`), `wqr_dump.json`, `score-share/mock/` |

### 3.3 Targeted credential-extension sweep

`find` for `*.pem`, `*.key`, `*.p12`, `*.pfx` and for filenames containing `secret` / `credential` / `service-account` / `private` / `token` (case-insensitive), excluding `node_modules`, `.git`, `.claude`, `.venv`, `ocr-service/`:

| Hit | Assessment |
|---|---|
| `render-google-service-account-env.txt`, `render-google-service-account-json-only.txt` | The P0 files |
| `scripts/debug-feedback-token.js`, `scripts/get-refresh-token.js`, `scripts/test-feedback-token-fallback.js`, `scripts/verify-auth-secret.js` | Tooling by name; `scripts/` is dockerignored |
| `services/case-tokens.js` | Source code (token *generator*), not a credential |
| `.venv/Lib/site-packages/pip/_vendor/certifi/cacert.pem` | Public CA bundle, not a secret. Dead weight only |
| `ocr-service/.venv/**` (~40 `.pem`/`token`/`credential` hits) | All third-party Python library test fixtures. `ocr-service/` **is** dockerignored — not in the image |

**No `*.key`, `*.p12`, or `*.pfx` exists anywhere in the repository outside `node_modules`. No `credentials/` or `secrets/` directory exists. PROVEN.**

### 3.4 Q2 Conclusion

There is **one class** of leak — "`.gitignore`d-but-not-`.dockerignore`d artifacts become public HTTP downloads" — but it has **three distinct severities**, not one:

1. **Live credentials** — the three service-account key files (P0, already recorded).
2. **Customer PII** — `backups/` (491 KB Notion client backup), `tmp/customer-backfill/`, `tmp/customer-merge/`, `clients_30_mock_data.csv`, `data/drive-upload-audit.jsonl`. The prior audit noted these in passing; this round confirms they are servable **regardless of MIME map**, which was the prior audit's stated precondition.
3. **Dead weight / info disclosure** — `.venv/`, `ocr/`, `diagnostics/`, `tests/`, `render.yaml`, `_wm_index.html`, `.cursor/`, `start-app.bat`, `requirements-supported.txt`. ~76 MB, plus topology disclosure.

No fourth class was discovered. No additional credential file exists.

---

## 4. Q3 — Cloud Run Auth Model vs Route-Level Authorization

### 4.1 Complete route gating map

Built from `grep -n "urlPath ===|urlPath.match|assertAppAuth"` across every file in `api/`, plus the inline routes in `server.js`.

| Route | Method | Gate in code | Evidence |
|---|---|---|---|
| **Staff portal — session-gated (`assertAppAuth` → `requireAppAuth`)** | | | |
| `/api/clients`, `/api/debug/dataset`, `/api/debug/clients` | GET | `assertAppAuth` | `clients-routes.js:18,48,79` |
| `/api/cases` | POST | `assertAppAuth` | `case-flow-routes.js:660` |
| `/api/cases/:id/{start,close,cancel,score,score-standard,assessment,send-result,line-connect}` | POST/GET | `assertAppAuth` | `case-flow-routes.js:616,631,646,686,727,739,762,778` |
| `/api/cases/repair-notifications`, `/api/debug/client-feedback*` | POST/GET | `assertAppAuth` | `case-flow-routes.js:790,807,817` |
| `/api/drive/images` (+ `/:id` variants) | GET/POST/… | `assertAppAuth` | `google-drive-routes.js:108,129,291,311,326` |
| `/api/ocr/read-meter`, `/api/ocr/debug-read` | POST | `assertAppAuth` | `ocr-proxy-routes.js:57,131` |
| `/api/google-business/*`, `/api/google-reviews/*`, `/api/debug/{env,business,notion}` | GET/POST | `assertAppAuth` | `google-review-routes.js:35,49,95,107,121,140,164,173,189` |
| `/api/auth/me` | GET | `requireAppAuth` | `server.js:257` |
| **Public by token possession — NO session, NO signature** | | | |
| `/api/report/:token` | GET | token only | `case-flow-routes.js:827-828` |
| `/api/feedback/:token` | GET **and POST** | token only | `case-flow-routes.js:838-839,845` |
| `/r/:token`, `/f/:token` | GET | token only | `case-flow-routes.js:863,874` |
| `/api/public/score-card/:token`, `/api/public/score-card/demo`, `/api/public/water-check-offer` | GET | token only / none | `public-routes.js:64,83,149` (CORS allow-list at `:30-40`) |
| `/liff/bind/:token` | GET | token only — renders customer data | `liff-routes.js:222-227` |
| `/api/liff/bind/:token` | POST | token **+** `verifyLiffIdToken(payload.idToken)` — a real second factor | `liff-routes.js:230-235` |
| `/api/cases/:id/preassessment` | POST | **none** — writes Notion | `case-flow-routes.js:711-712` (no `assertAppAuth`) |
| `/api/cases/:id/feedback` | POST | **none** — writes Notion | `case-flow-routes.js:749-750` |
| **Webhooks — cryptographic signature only** | | | |
| `/api/cal/webhook` | POST | HMAC `x-cal-signature-256`; **fails OPEN if `CAL_WEBHOOK_SECRET` unset** | `cal-routes.js:84-105` |
| `/api/line/webhook` | POST | LINE signature; **fails CLOSED** | `line-routes.js:711-715` |
| `/api/cal/webhook/status`, `/api/line/webhook/status` | GET | **none** | `cal-routes.js:56`, `line-routes.js:684` |
| **Ops / health — open** | | | |
| `/api/ops/health` | GET | **none** — always 200, `ok:true` hardcoded | `ops-routes.js:101,174` |
| `/api/ops/readiness` | GET | **none** — 503 when `notionOk` false | `ops-routes.js:178-181` |
| **Other open routes** | | | |
| `/auth/google`, **`/auth/google/callback`**, `/auth/google/status` | GET | **none** | `google-drive-oauth-routes.js:39,59,104` |
| `/api/google-business/oauth/callback` | GET | **none** | `google-review-routes.js:66` |
| `/api/drive/status` | GET | **none** | `google-drive-routes.js:88` |
| `/api/feedback/suggest` | GET/POST | **none** — calls OpenAI | `feedback-suggest-routes.js:27,36` |
| `/api/auth-config`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/forgot-password`, `/api/address-search`, `/api/maps-config` | — | none by design | `server.js:220,230,274,284,292,334` |
| **All static files under `__dirname`** | GET/HEAD | **none** | `server.js:380-408` |

**No rate limiting of any kind exists.** `grep -rni "rate.?limit|throttl" server.js api/ services/` returns **zero matches**. **PROVEN.**

### 4.2 `/api/test/create-case` — exact re-verification

`api/case-flow-routes.js:696-709`, read verbatim:

```js
if (urlPath === '/api/test/create-case' && req.method === 'POST') {
  const testApiEnabled = process.env.ENABLE_TEST_API === 'true' || process.env.NODE_ENV !== 'production';
  if (!testApiEnabled) {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return true;
  }
```

It is gated by **either** condition — `ENABLE_TEST_API` is an *additional enable*, not an additional requirement. There is no `assertAppAuth` on this route.

> **Plain statement:** on a Cloud Run revision with `NODE_ENV=production` set and `ENABLE_TEST_API` unset, `process.env.NODE_ENV !== 'production'` evaluates `false` and `process.env.ENABLE_TEST_API === 'true'` evaluates `false`, so `testApiEnabled` is `false` and **line 700 returns HTTP 404**. That is the proving line. Conversely, setting `ENABLE_TEST_API=true` re-opens the route *even under `NODE_ENV=production`* — it must stay unset on every deployed revision.

Note this check uses the **naive** `NODE_ENV !== 'production'` form and does **not** consult `isProductionRuntime()`. See Q4.

### 4.3 Is `--allow-unauthenticated` the right control?

**Yes, and it is the only workable setting — but it is not a security control for this app.**

- Cal.com signs its webhook with an HMAC (`x-cal-signature-256`) and has no facility for minting a Google-issued OIDC identity token. Cloud Run IAM invoker auth requires exactly that. Cal.com therefore **cannot** reach an IAM-gated service. `cal-routes.js:84-105` confirms the route is built to authenticate the *caller* itself, at the application layer.
- LINE is identical: it signs with `x-line-signature` and cannot present a Google identity token. `line-routes.js:711` confirms application-layer verification.
- Public report links (`/r/:token`), feedback pages (`/f/:token`), LIFF bind pages, and score-card images are delivered to customers in LINE messages. Those customers have no Google identity.

So the service **must** be deployed `--allow-unauthenticated`.

**The consequence, stated plainly:** with `--allow-unauthenticated`, Cloud Run's own auth layer permits every request from anyone on the internet to reach the Node process. **The app's own route-level code is the only authorization boundary that exists.** Every row in §4.1 marked "none" is reachable by an anonymous internet caller, and this is true on Render today — Cloud Run does not make it worse, it simply removes any illusion that a platform layer might help.

### 4.4 Routes with ZERO gating at any layer

Auditing §4.1 for routes that are (a) unauthenticated at Cloud Run, (b) have no session check, (c) have no signature check, and (d) are not intentionally public:

| Route | Why this is not acceptable as "intentionally public" | Severity |
|---|---|---|
| **`/auth/google/callback`** | Completes a Google OAuth code exchange and calls `saveRefreshToken()`, which sets `runtimeRefreshToken`, **overwrites `process.env.GOOGLE_REFRESH_TOKEN` in the live process** (`google-drive-oauth.js:51-52`), and writes `data/google-drive-oauth.json` (`:56`). An anonymous caller who walks the consent screen with their own Google account redirects all subsequent customer photo uploads into *their* Drive, silently, until restart. **New P1.** | **P1** |
| **All static files under `__dirname`** | The P0's delivery mechanism. Not gated at any layer | **P0** |
| `/api/google-business/oauth/callback` | Same class as above, but Google Business is inert in production (no credentials) so there is nothing to hijack today | P2 |
| `/api/feedback/suggest` | Unauthenticated OpenAI-backed endpoint — cost amplification / prompt abuse by anonymous callers | P2 |
| `/api/cal/webhook` when `CAL_WEBHOOK_SECRET` is unset | Fails open — already recorded as P2-6 in the prior audit | P2 (prior) |
| `/api/cases/:id/preassessment`, `/api/cases/:id/feedback` | Write to Notion without a session, but the path segment is the same unguessable Case identifier the customer already holds — **intentionally public, acceptable** | — |
| `/api/ops/health`, `/api/ops/readiness` | **Must stay open** — Cloud Run startup/liveness probes send no auth header and cannot present one. Leaving them ungated is correct for Cloud Run, and the disclosure (flag states, integration booleans, `publicBaseUrlHost`) is reconnaissance-grade only. `/api/ops/readiness` is the correct probe path since it 503s when Notion is unconfigured (`ops-routes.js:178-181`) | Correct as-is |

### 4.5 Public token entropy — new finding

Every public route in §4.1 gated "by token possession" relies on tokens generated by `services/case-tokens.js:18-24`:

```js
function randomTokenSuffix(length = 4) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  ...crypto.randomInt(0, alphabet.length)
}
```

called as `` `${prefix}-${randomTokenSuffix(4)}` `` (`:42`) → `fb-a3k9`, `rpt-x2m7`. **The entire keyspace is 36⁴ = 1,679,616 values** (`crypto.randomInt` is cryptographically sound; the *length* is the defect). `generateUniqueToken` re-rolls on collision up to 16 times (`:40-49`), which confirms the space is small enough that collisions are an expected operational event.

With **no rate limiting anywhere in the codebase** (§4.1) and Cloud Run autoscaling happily absorbing the load, the full keyspace is enumerable in hours. A hit on `/api/report/:token` or `/liff/bind/:token` returns a real customer's report/contact data. This is **pre-existing on Render** — it is not introduced by containerisation — but it is genuinely new to this audit series and materially worse under a platform designed to scale into a brute-force attempt. **New P1.**

---

## 5. Q4 — `NODE_ENV` / `isProductionRuntime()` Full Behavior Matrix

Full grep of `NODE_ENV` and `isProductionRuntime` over `server.js`, `api/`, `services/`, `config/` (13 + 10 hits respectively; `scripts/` reported separately in §5.3).

### 5.1 The matrix

| Behavior | Development (`NODE_ENV` unset/`development`) | Production (`NODE_ENV=production`) | File:line |
|---|---|---|---|
| `NODE_ENV` resolution at boot | Off Render: `.env`'s `NODE_ENV` **overrides the shell value** (with a warning); if neither, defaults to `'development'` | On Render (`RENDER`/`RENDER_SERVICE_ID` set): `.env` is not consulted at all, returns immediately | `server.js:13-41` |
| `AUTH_SESSION_SECRET` required | No — falls back to the literal `'wm-dev-auth-session-secret'` with a console warning | **Yes — `process.exit(1)` with `[FATAL]` if unset** | `app-auth.js:94-126` (guard at `:108`) |
| Dev placeholder secret accepted | Yes | **No — `process.exit(1)`** if the configured value equals the dev fallback | `app-auth.js:98-103` |
| `AUTH_ALLOW_DEV_USERS=true` | Permitted — injects the `dev`/`dev` login | **Fatal — `process.exit(1)`** | `app-auth.js:34`, `:69`, `DEV_ONLY_USERS` at `:7-9` |
| **`/api/test/create-case`** | **Enabled — unauthenticated, creates a real Notion Case** | **404** (line `700`) unless `ENABLE_TEST_API=true` re-opens it | `case-flow-routes.js:697-700` |
| OCR localhost URL | Permitted — `http://127.0.0.1:5055` default is used as-is | **Hard 503 `OCR_MISCONFIGURED`** if `OCR_SERVICE_URL` is unset or localhost | `ocrClient.js:21-31` |
| `/api/ops/health` `environment` field | reports `'development'` | reports `'production'` | `ops-routes.js:105` |
| Session cookie `Secure` | — | — | **No `NODE_ENV` dependency.** Derived solely from `PUBLIC_BASE_URL.startsWith('https')` — `app-auth.js:297,309` |
| Session cookie `HttpOnly` / `SameSite` | Always `HttpOnly`, always `SameSite=Lax` | Identical | `app-auth.js:299-302` |
| Error-detail verbosity in responses | Identical | Identical | No `NODE_ENV` branch. `server.js:359` always returns the generic `'Internal server error'`; route handlers always return `error.message` in both modes |
| Stack traces in HTTP responses | **None in either mode** | None | `logErrorStack` writes to `console.error` only; no response body carries a stack |
| Debug routes | Same set in both modes — `/api/debug/{dataset,clients,env,business,notion,client-feedback}` exist always, all `assertAppAuth`-gated; `/api/ocr/debug-read` and `/api/cal/webhook/status` and `/api/line/webhook/status` exist always | Identical | `clients-routes.js`, `google-review-routes.js`, `ocr-proxy-routes.js:38`, `cal-routes.js:56`, `line-routes.js:684` |
| Logging verbosity | Identical | Identical | Gated by `OCR_DEBUG`/`DEBUG`/`NOTION_DEBUG_DATES` only, never `NODE_ENV` |
| `LINE_MOCK_SEND` | Independent of `NODE_ENV` — **the mock applies in production too if the variable is set** | Same | No `NODE_ENV` interaction anywhere. **Confirmed by grep** |

### 5.2 Are there two definitions of "production"? — **Yes. PROVEN.**

`isProductionRuntime()` (`services/app-auth.js:11-17`):

```js
const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
if (nodeEnv === 'production') return true;
if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return true;
return false;
```

It is exported (`:325`) but `grep` proves it is **referenced only inside `app-auth.js` itself** (`:34, 69, 98, 108`). **No other file in the repository calls it.**

Two other runtime files make their own, narrower `NODE_ENV` check:

| File:line | Check | Accepts `RENDER*` as production? |
|---|---|---|
| `services/app-auth.js:11-17` | `NODE_ENV==='production' \|\| RENDER \|\| RENDER_SERVICE_ID` | **Yes** |
| `api/case-flow-routes.js:697` | `process.env.NODE_ENV !== 'production'` | **No** |
| `services/ocrClient.js:21` | `String(process.env.NODE_ENV\|\|'').toLowerCase() !== 'production'` | **No** |

**This is a second, inconsistent definition of "production."** The divergence is not hypothetical: on a Render revision where `NODE_ENV` were ever unset or mis-set while `RENDER_SERVICE_ID` was present, `app-auth` would correctly enforce production secret requirements while `/api/test/create-case` would be **wide open and unauthenticated** and the OCR localhost guard would be **disabled**. The two most security-relevant `NODE_ENV` branches in the codebase are precisely the two that do **not** use the shared helper.

On Cloud Run this collapses to a simpler but sharper rule: no `RENDER*` variable will ever exist, so **all three checks agree iff `NODE_ENV=production` is literally set**. `Dockerfile:10` (`ENV NODE_ENV=production`) supplies it, but that is a single point of failure — an operator `--set-env-vars NODE_ENV=staging`, or any switch to a source/buildpack deploy that bypasses the Dockerfile, silently opens an unauthenticated Notion-write endpoint. **New P2** (hardening; the immediate risk is already covered by prior P1-7's verification step).

### 5.3 `scripts/` findings (excluded from the matrix — not in the image)

`scripts/` is `.dockerignore`d, so nothing there affects the deployed image. No `NODE_ENV`-dependent behavior in `scripts/` alters runtime semantics.

---

## 6. Q5 — LINE `runAfterResponse` Exact Lifecycle

Current line numbers verified this round (they have **not** shifted from the prior audit).

### 6.1 What is sent, and what triggers the deferred code

`api/line-routes.js:739-741`:

```js
sendJson(res, 200, { ok: true, results });
// Always start auto-send AFTER the webhook HTTP 200 has been written.
backgroundTasks.forEach(task => runAfterResponse(res, task));
```

`sendJson` calls `res.writeHead(...)` + `res.end(...)`, so LINE receives **HTTP 200 with `{ok:true, results:[...]}`**.

`runAfterResponse` (`:149-167`) is **a genuine post-response callback, not merely source-order execution** — this distinction matters and the code gets it right:

```js
if (!res || res.writableEnded || res.finished) { start(); return; }   // :158-161
res.once('finish', start);                                             // :163
res.once('close',  start);                                             // :164
setTimeout(start, 5000);                                               // :166  last-resort
```

and `start()` → `scheduleBackground(task)` (`:140-147`), which uses `setImmediate(run)` with an explicit comment: *"Do not use microtasks here — they can run before the HTTP response is flushed."*

**However**, because `sendJson` at `:739` already called `res.end()` **before** `runAfterResponse` is invoked at `:741`, `res.writableEnded` is already `true` — so the `:158` early-return branch fires and `start()` is called **synchronously**, scheduling via `setImmediate`. The `'finish'`/`'close'` listeners are never reached in the normal path. The in-code comment at `:157` acknowledges this: *"sendJson()/res.end() sets writableEnded before we schedule, so this path is normal."*

**Consequence for Cloud Run — PROVEN:** `res.end()` having returned means the data is queued to the socket, not necessarily flushed to the client. The work is therefore scheduled on the **very next event-loop check phase**, which is typically *before or racing with* the actual socket flush. In practice the task starts almost immediately after the 200, and then runs for the full duration of a Notion read + Notion write + LINE push + Notion write — **all of it after the response is complete**, which is exactly the window Cloud Run's default CPU throttling deallocates CPU in. **`--no-cpu-throttling` (CPU always allocated) is a hard requirement, not a tuning preference.**

### 6.2 Every mutation inside the after-response block, in order

The only background task constructed is at `line-routes.js:604-672`, gated on `linked.linked && linked.pendingAutoSend` (`:605`). Its single call is `await sendCaseResult(caseId)` (`:611`) → `services/workflow-service.js:395-407` → `executeSendCaseResult` (`:265-388`). Traced in execution order:

| # | Operation | Kind | Code |
|---|---|---|---|
| 1 | `resolveJob(caseId)` | Notion **read** | `workflow-service.js:396` |
| 2 | `withCaseLock(initial.notionId, …)` | **In-memory** `Map` mutation (process-local) | `:405`, lock impl `:68-76` |
| 3 | `getClient(initial.notionId)` | Notion **read** | `:406` |
| 4 | `resolveNotifyLineDestination(job)` | Notion read (M8 flags OFF → Case fallback) | `:268` |
| 5 | Early-return checks: `already_sent`, `already_sending`, `no_line_user_id`, `not completed` | no mutation | `:277-330` |
| 6 | **`updateClient(notionId, { notificationStatus: 'sending' })`** | **Notion WRITE #1** | `:344` |
| 7 | `sendingStartedAt.set(job.notionId, Date.now())` | **In-memory** write | `:345` |
| 8 | **`sendCaseResultNotification(sendJob, {...})`** | **LINE push — a real customer-visible message** | `:361` |
| 9 | **`updateClient(notionId, sent ? {caseWorkflowStatus:'result_sent', notificationStatus:'sent', resultSentAt, lineMessageId, lastNotificationError:''} : {notificationStatus:'failed', lastNotificationError})`** | **Notion WRITE #2** | `:370-377` |
| 10 | `sendingStartedAt.delete(job.notionId)` | In-memory write | `:378` |
| 11 | On throw: `markCaseResultNotificationFailed(caseId, error)` → `updateClient(..., {notificationStatus:'failed'})` | Notion **write** | `line-routes.js:641` → `workflow-service.js:409-419` |

Note that the reply message to the customer and the `linkLineUser` Notion write happen **inline, before the 200** — only the *result auto-send* is deferred. That bounds the exposure, but the deferred part is the highest-value mutation in the whole flow.

### 6.3 Inconsistent states if the process freezes mid-block

| Freeze point | Resulting state |
|---|---|
| Between #6 and #8 | Notion says `notificationStatus: 'sending'`, **no LINE message was ever sent**. The customer bound their LINE account, got the confirmation reply, and then receives nothing. The Case looks in-flight forever |
| **Between #8 and #9** | **The customer has received their full water-quality result on LINE, but Notion still reads `notificationStatus: 'sending'`, `workflow.status` is not `result_sent`, `resultSentAt` is unset, and `lineMessageId` is empty.** The system has no record that the highest-value customer touchpoint occurred |
| Between #9 and #10 | Notion is fully correct; only the process-local `sendingStartedAt` entry leaks. Harmless — and moot, since the process is gone |

The #8→#9 window is the dangerous one, and the recovery logic **turns it into a guaranteed duplicate**. `executeSendCaseResult:291-293`:

```js
const sendingSince = sendingStartedAt.get(job.notionId);
const isStale = !sendingSince || (Date.now() - sendingSince) > STALE_SENDING_MS;
```

`sendingStartedAt` is a process-local `Map` (`:30`). On **any other instance, or after any restart**, `sendingSince` is `undefined`, so `isStale` is `true` **immediately** — the 3-minute `STALE_SENDING_MS` window never applies. The code logs `notification_stale_sending_recovered` (`:305`) and **falls through to re-send**. So the next `sendCaseResult` for that Case — from a staff "Send Result" click, `repairCaseResultNotification`, `closeCase`, or a LIFF re-bind — **sends the customer a second copy of their result.** This is the concrete, customer-visible harm of freezing in the #8→#9 window. **PROVEN by code read.**

### 6.4 Does LINE's retry behavior save this? — **No. It makes it worse.**

LINE retries a webhook delivery only on a non-2xx response or a delivery timeout. Here the 200 is written at `:739` **before** the background task is even scheduled at `:741`. LINE therefore records the delivery as successful the instant the response flushes, regardless of what happens next.

> **If the after-response block is throttled, stalled, or killed by SIGTERM (and `grep 'SIGTERM'` over `server.js api/ services/ config/` still returns nothing — no handler exists), LINE will NOT retry, because from LINE's perspective the webhook already succeeded. The mutation is permanently lost, with no durable record that it was ever attempted and no external system that will re-drive it.** The only recovery path is a human noticing a Case stuck at `notificationStatus: 'sending'` and clicking "Send Result" — which, per §6.3, is also the path that produces the duplicate send.

This confirms and sharpens prior P1-2 and P1-6: they are not two independent findings but one compound failure mode, and `--no-cpu-throttling` alone does **not** close it — SIGTERM during a revision replacement produces the same outcome with CPU fully allocated.

---

## 7. Q6 — Cal.com Webhook Failure-Window Analysis

### 7.1 The actual sequence

`api/cal-routes.js:72` (`POST /api/cal/webhook`) → `readRawBody` (1 MiB cap) → signature verify (`:84-105`, **fails open if `CAL_WEBHOOK_SECRET` unset**) → `JSON.parse` (`:110`) → `buildDedupeKey` + `noteCalDelivery` (`:117-118`) → `logEvent` (`:120-128`) → non-`BOOKING_CREATED` short-circuit (`:135-146`) → `processBookingCreated(payload, correlationId)` (`:149`).

`services/cal-booking-adapter.js:131-161`:

```js
return deps.withCaseLock(`cal-booking:${fields.calBookingId}`, async () => {   // :138
  const existing = await deps.findClientByCalBookingId(fields.calBookingId);   // :139  DURABLE READ
  if (existing) return { ok: true, idempotent: true, ... };                    // :140-147
  const { customerPayload, options } = buildCreateCaseInput(fields, correlationId);
  const result = await deps.createCase(customerPayload, options);              // :151  DURABLE WRITE
  ...
});
```

Two facts establish the durable check's real strength:

1. **`findClientByCalBookingId` is a genuine live Notion query** — `services/notion/clients.js:167-192`: resolves the data source, finds the `Cal Booking ID` property key, and issues `notion.dataSources.query({ filter: {equals: normalized}, page_size: 1 })` wrapped in `withRetry`. Exact match, no cache. **PROVEN.**
2. **`createCase` writes `calBookingId` atomically in the page-create call** — `services/case-creation-service.js:214` is a single `await createClient(notionPayload)`, and `services/notion/clients.js:485` (`setText(FIELD_ALIASES.calBookingId, payload.calBookingId)`) maps it into the properties of that same create. There is **no** follow-up update that adds the booking id later. So the moment the Notion page exists, it is already findable by `findClientByCalBookingId`. **PROVEN.**

`deps.withCaseLock` is `services/workflow-service.js:68-76` — a promise chain in a module-level `const locks = new Map()` (`:24`). **Per-process. Two instances hold two independent empty maps and both believe they hold the lock. PROVEN.**

One further detail widens the race window materially: between the durable read (`:139`) and the durable write (`:151`), `createCase` first calls `generateFeedbackToken()` and `generateReportToken()` (`case-creation-service.js:205-206`), each of which performs **its own Notion uniqueness query per attempt** (`services/case-tokens.js:27-38, 40-49`). So the read-to-write gap is not microseconds — it is **at least two additional Notion round-trips**, typically hundreds of milliseconds.

### 7.2 Scenario A — same booking delivered to instance A and instance B near-simultaneously

Sequence per instance, interleaved at the worst point:

| t | Instance A | Instance B |
|---|---|---|
| 1 | acquires `withCaseLock('cal-booking:uid')` in **A's** map | acquires `withCaseLock('cal-booking:uid')` in **B's** map — succeeds, maps are independent |
| 2 | `findClientByCalBookingId(uid)` → Notion → **null** | `findClientByCalBookingId(uid)` → Notion → **null** |
| 3 | `generateFeedbackToken()` + `generateReportToken()` (2 Notion queries) | same |
| 4 | `createClient(...)` → **Case created** | `createClient(...)` → **second Case created** |

The durable check at step 2 happens **BEFORE** the create in each instance, and **there is a window — spanning step 2 through step 4, widened by two token-uniqueness queries — in which both instances have already passed the durable check before either has written.** Notion enforces no unique constraint on `Cal Booking ID`.

> **A — Can more than 1 Case result? YES.** Evidence: `cal-booking-adapter.js:138` (process-local lock), `:139` (read), `:151` (write); `workflow-service.js:24,68-76` (the `Map` is module-level, not shared); `case-creation-service.js:205-206,214` (two extra Notion round-trips between read and write).

### 7.3 Scenario B — A's Notion create succeeds, then A crashes before updating local state or responding

`createClient(notionPayload)` returns only after Notion has committed the page, and that page already carries `calBookingId` (§7.1 fact 2). So the instant the create returns — and indeed the instant Notion commits, even if A dies before the return value is observed — **a durable record exists that `findClientByCalBookingId` will find.**

Cal.com sees no response (or a 5xx) and retries. The retry lands on any instance, acquires that instance's own lock trivially (uncontended), calls `findClientByCalBookingId(uid)`, gets the page A created, and returns `{ ok: true, idempotent: true }` at `:141-147`. No second create.

The in-memory lock state and `cal-dedupe-placeholder` entries that A lost are irrelevant — neither is consulted for the skip decision. `api/cal-routes.js:127,140` show `dedupe.seen` feeding only a log field and a response body, never a control-flow branch. **PROVEN.**

> **B — Can more than 1 Case result? NO.** The durable, atomic `calBookingId` on the created page is sufficient. Evidence: `case-creation-service.js:214` + `notion/clients.js:485` (atomic write), `cal-booking-adapter.js:139-147` (durable read short-circuits the retry).

### 7.4 Scenario C — create succeeded, but Cal.com's sender didn't see the response and retries later

Identical to B in every mechanical respect; the only difference is that the first instance may still be alive and healthy. The later retry — whether to the same instance or a different one — performs the same `findClientByCalBookingId` before any create, finds the existing page, and returns `idempotent: true`.

This is the case the design was actually built for, and the in-code comment at `cal-booking-adapter.js:34` (*"dedupe (findClientByCalBookingId before createCase) can be proven…"*) confirms it was deliberate. It is the genuinely well-built part of this architecture.

> **C — Can more than 1 Case result? NO.** Same evidence as B. Sequential redelivery is fully idempotent at any interval.

### 7.5 Would `--max-instances=1` fully close A, B, and C?

**No — and this must not be treated as the fix.**

- **Scenario A:** `max-instances=1` closes it *only while the constraint holds*. It is a deployment-config coincidence, not a correctness property. It breaks the moment anyone raises the ceiling for capacity, and it does **not** survive a Cloud Run **revision replacement**, during which the old revision and the new revision both serve traffic simultaneously — that is two processes with two independent lock maps, under `max-instances=1`. **A can therefore still occur under `max-instances=1`, during every deploy.** It is also not closed during a Render↔Cloud Run cutover window, when both platforms are live.
- **Scenarios B and C:** already closed, by the durable Notion read — `max-instances=1` contributes nothing to them.

> **Net: `max-instances=1` reduces the likelihood of scenario A and closes nothing else. It is a capacity ceiling that happens to narrow one race; it is not durable correctness.** Durable correctness for A requires the read-then-write to become atomic or externally serialised — e.g. a Notion-side conditional create, a durable lease keyed on `cal-booking:<uid>` (Notion row, Firestore doc, or Cloud Tasks dedupe key), or routing Cal webhooks through a single-concurrency Cloud Tasks queue keyed on the booking uid. Recording only; no change made.

---

## 8. Q7 — URL / Cookie Cutover Inventory

Full grep over the repository excluding `node_modules`, `.git`, `.claude/worktrees` for `PUBLIC_BASE_URL`, `onrender.com`, `run.app`, `localhost`, `127.0.0.1`, plus every link-generating helper.

| URL/cookie concern | Source location | Current production value/behavior | Cloud Run behavior if unchanged | Must change at cutover? |
|---|---|---|---|---|
| **Canonical public base URL** | `services/url-builder.js:10` | `PUBLIC_BASE_URL` → `RENDER_EXTERNAL_URL` → hardcoded `https://serviceportal.onrender.com` | `RENDER_EXTERNAL_URL` absent ⇒ **silently emits the Render domain**, no error, no log | **YES — set `PUBLIC_BASE_URL`** |
| Duplicate base-URL chain | `services/client-feedback.js:214` | Same three-step chain, copy-pasted | Same silent failure | **YES** (same variable) |
| Public **report** link `/r/:token` | `url-builder.js:14-18` via `buildReportUrl` | `<base>/r/rpt-xxxx` — sent to customers in LINE | Points at Render unless `PUBLIC_BASE_URL` set | **YES** |
| Public **feedback** link `/f/:token` | `url-builder.js:20-24` via `buildFeedbackUrl` | `<base>/f/fb-xxxx` — sent to customers in LINE | Same | **YES** |
| **LIFF bind URL** | `url-builder.js:40-45` | `https://liff.line.me/${LIFF_ID}/<token>` — **hardcoded LINE host, independent of `PUBLIC_BASE_URL`** | **Unaffected by the cutover.** But the LIFF app's *Endpoint URL* is registered in the LINE Developers console and points at this service | **LIFF app endpoint: YES (console-side, outside this repo).** The generated URL itself: no |
| **QR codes** (3 sites) | `api/case-flow-routes.js:278`, `services/workflow-service.js:56`, `services/score-share-card.js:249` | All three call `buildLiffBindUrl(...)` and encode the `liff.line.me` URL | **Unaffected** — no QR encodes `PUBLIC_BASE_URL`. Verified at all three call sites | **NO** — clean |
| Drive asset public links | `services/google-drive.js:298` | `options.publicBaseUrl \|\| PUBLIC_BASE_URL \|\| ''` — **no Render fallback here** | Empty base ⇒ relative links, not wrong-host links | Follows `PUBLIC_BASE_URL` |
| **Session cookie `Secure` flag** | `services/app-auth.js:297`, appended at `:309` | `PUBLIC_BASE_URL.startsWith('https')` — **not** derived from the actual connection | Unset ⇒ **staff session cookie issued without `Secure` over an HTTPS connection**, silently | **YES** (same variable; verify a real `Set-Cookie`) |
| Session cookie `Domain` | `app-auth.js:298-302` | **No `Domain` attribute is ever set** — host-only cookie, `Path=/`, `HttpOnly`, `SameSite=Lax` | Host-only ⇒ a domain change **logs every staff user out** (cookie is scoped to the old host), even though the HMAC itself would still verify | **Verify** — a custom domain fronting both platforms avoids this entirely |
| Session HMAC secret | `app-auth.js:95,127` | `AUTH_SESSION_SECRET \|\| SESSION_SECRET`, resolved once at load; stateless | Must be **byte-identical** across platforms | **Must NOT change** |
| Cal webhook `status` display URL | `api/cal-routes.js:67` | `PUBLIC_BASE_URL \|\| RENDER_EXTERNAL_URL \|\| 'http://127.0.0.1:3040'` | Display only, but an operator reading this during cutover reads **the app's guess, not Cal.com's actual config** | Cosmetic; operator trap |
| LINE webhook `status` display URL | `api/line-routes.js:692` | `PUBLIC_BASE_URL \|\| RENDER_EXTERNAL_URL \|\| ''` | Display only | Cosmetic |
| **Cal.com webhook callback URL** | **NOT IN THIS REPO** — configured in the Cal.com dashboard. Nothing in the codebase writes it | Points at the Render host | Bookings keep flowing to Render until manually repointed | **YES — manual, external, atomic** |
| **LINE webhook URL** | **NOT IN THIS REPO** — configured in the LINE Developers console | Points at the Render host | Same; one channel has exactly one webhook URL ⇒ **no dual-running period** | **YES — manual, external, atomic** |
| **Google OAuth redirect URI (Drive)** | `GOOGLE_REDIRECT_URI` env, consumed at `services/google-drive-oauth.js:24,88` and echoed into `generateAuthUrl` | Registered in the Google Cloud console against the Render host | The `/auth/google` flow 400s with `redirect_uri_mismatch` until the new host is added to the console allow-list | **Verify** — only blocks the re-auth flow, not normal uploads (which use the stored refresh token) |
| Google Business OAuth redirect | `GOOGLE_BUSINESS_REDIRECT_URI`, `services/googleBusinessAuth.js:19` | Unset/inert in production | No impact | No |
| OCR service URL | `services/ocrClient.js:9` | `OCR_SERVICE_URL`, default `http://127.0.0.1:5055` | Guarded — production rejects a localhost value with 503 (`:21-31`) | Value **must NOT change**; verify in-region reachability |
| Google Maps API key | `server.js:336` | `GOOGLE_MAPS_API_KEY` returned to the browser by design | If HTTP-referrer-restricted to the Render/production domain, maps break on the new host | **Verify / change the key restriction** |
| Public CORS allow-list | `api/public-routes.js:30-40` | `PUBLIC_API_ALLOWED_ORIGINS`, default `water-motion.co` / `www.water-motion.co` | Unaffected unless the marketing site origin changes | No |
| Default Google review URL | `services/url-builder.js:7`, `api/case-flow-routes.js:80` | Hardcoded `https://g.page/r/...` (duplicated in two files) | External Google URL, host-independent | No |
| `new URL(req.url, 'http://localhost')` | `server.js:205,294`, `api/google-drive-oauth-routes.js:60`, `api/public-routes.js:145` | Parsing-only dummy base for `searchParams` | **Not a real URL.** No risk | No |
| `index.html:36` | static help text | — | No risk | No |

**`run.app` appears in no application source file** — the OCR URL is entirely env-driven (it does appear in `docs/CLOUD_RUN_STAGING_ENV_VARS.md:43,133` as documentation). Correct. **PROVEN.**

**Two cutover items live entirely outside this repository** and cannot be verified or changed by any code review: the **Cal.com dashboard webhook URL** and the **LINE Developers console webhook URL** (plus the LIFF app's Endpoint URL). Both are atomic manual switches with no dual-running period.

---

## 9. Q8 — OCR Nested Timeout Chain

Every value below is read verbatim from source; none is estimated or rounded.

| Layer | Value | Source |
|---|---|---|
| Per-request OCR timeout (`OCR_TIMEOUT`) | **120 000 ms** default (`Number(process.env.OCR_TIMEOUT)` used only if finite and > 0) | `services/ocrClient.js:34-40` |
| Enforcement mechanism | `AbortController` + `setTimeout(() => controller.abort(), timeoutMs)` per attempt | `ocrClient.js:263` (`readMeterOnce`), `:347` (`debugReadMeter`) |
| Retry count | **`MAX_READ_ATTEMPTS = 3`** | `ocrClient.js:50` |
| Retries are sequential | `for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) { lastResult = await readMeterOnce(...) }` — **`await` inside the loop; strictly sequential, never parallel** | `ocrClient.js:395-396` |
| Inter-attempt delay (standard) | **`RETRY_DELAY_MS = 5 000`** | `ocrClient.js:51` |
| Inter-attempt delay (engine cold start) | **`ENGINE_WARMUP_DELAY_MS = 8 000`** — used when `errorCode === 'ENGINE_UNAVAILABLE'` | `ocrClient.js:52`, selected at `:403-405` |
| Number of inter-attempt delays | **2** (after attempts 1 and 2; none after attempt 3, loop breaks at `:400`) | `ocrClient.js:398-408` |
| Retryable error codes | `ENGINE_UNAVAILABLE`, `OCR_OFFLINE`, `OCR_TIMEOUT`, `OCR_INTERNAL_ERROR` | `ocrClient.js:43-48` |
| Proxy-route timeout | **NONE.** `api/ocr-proxy-routes.js` (read in full, 168 lines) sets no `res.setTimeout`, no `req.setTimeout`, no `AbortController` of its own. It `await`s `readMeter(...)` at `:102` with no bound | `ocr-proxy-routes.js:102-105` |
| Proxy body cap | `OCR_PROXY_MAX_BODY_BYTES` default **28 000 000** bytes, accumulated as one JS string | `ocr-proxy-routes.js:20-35` |
| Node HTTP server settings in `server.js` | **NONE set.** `server.js:412` is a bare `http.createServer(handleRequest)`; no `requestTimeout`, `headersTimeout`, `keepAliveTimeout`, or `setTimeout` assignment anywhere in the file | `server.js:411-447` |
| Node 20 defaults (measured on this machine, unchanged since Node 18) | `requestTimeout: 300000`, `headersTimeout: 60000`, `keepAliveTimeout: 5000`, `timeout: 0` | verified by `node -e "const s=require('http').createServer(); console.log(s.requestTimeout, s.headersTimeout, s.keepAliveTimeout, s.timeout)"` |

### 9.1 Worst-case wall clock — exact sum

The maximum is three full-timeout attempts separated by the two **longest** inter-attempt delays (the `ENGINE_UNAVAILABLE` cold-start path, 8 000 ms, which is precisely the OCR-cold-start case the 120 s default exists for):

```
3 × 120 000 ms   (MAX_READ_ATTEMPTS × OCR_TIMEOUT default)   = 360 000 ms
2 ×   8 000 ms   (two ENGINE_WARMUP_DELAY_MS gaps)           =  16 000 ms
                                                   TOTAL     = 376 000 ms
```

> **Worst case: 376 000 ms = 376 seconds = 6 minutes 16 seconds.**
>
> (The all-`OCR_TIMEOUT`/`OCR_OFFLINE` variant, using `RETRY_DELAY_MS = 5 000` twice, is `360 000 + 10 000 = 370 000 ms`. **376 000 ms is the true worst case.**)

This figure excludes request-body upload time for up to 28 MB, which is additional.

### 9.2 Which layer gives up first — a correction

The prior audit's figure of "~360 s" omitted the two inter-attempt delays; the correct app-internal ceiling is **376 s**.

More importantly, **no Node-level layer ever gives up.** Node's `server.requestTimeout` (300 000 ms) bounds *receiving the complete request from the client*, not generating the response — once the body is fully read it no longer applies. `server.timeout` is `0` (disabled). `headersTimeout` (60 000 ms) applies only to header receipt. So Node will happily let the handler run for 376 s.

> **The first layer to give up is therefore Cloud Run's request timeout — 300 s by default, i.e. 76 000 ms before the app's own retry budget is exhausted.** The client receives a Cloud Run-generated 504, not the app's structured `OCR_TIMEOUT`/`OCR_OFFLINE` error object, so the field user sees a generic gateway failure instead of the actionable OCR message. This confirms prior P1-5 with exact numbers: either set the Cloud Run `--timeout` to **≥ 380 s** (400 s gives sane headroom), or set `OCR_TIMEOUT` such that `3 × OCR_TIMEOUT + 16 000 ms` fits inside the configured Cloud Run timeout.

---

## 10. Secrets Inventory (Cross-Cutting)

**No secret value was read, printed, or logged. Structural key-name checks only (`grep -o '"[a-z_]*"[[:space:]]*:'`), and only on the three files already known to be credential-shaped.**

| Filename | Path | Apparent credential type | Gitignored | Dockerignored | Runtime code reads it? |
|---|---|---|---|---|---|
| `solar-bolt-501808-u9-5fa018d4a911.json` | repo root | **GCP service-account key** — has `type`, `project_id`, `private_key_id`, **`private_key`**, `client_email`, `client_id`, `auth_uri`, `token_uri`, `universe_domain` | **Y** (`.gitignore:29` `solar-bolt-*.json`) | **N** | **NO** — PROVEN. Referenced only by `scripts/build-render-sa-json.js:6` (dockerignored). Zero `GOOGLE_APPLICATION_CREDENTIALS`/`keyFile`/`GOOGLE_SERVICE_ACCOUNT_*` in runtime code |
| `render-google-service-account-env.txt` | repo root | **GCP service-account key** (same key set, prefixed `GOOGLE_SERVICE_ACCOUNT_JSON=`) | **Y** (`.gitignore:31`) | **N** | **NO** — `scripts/build-render-sa-json.js:5` only |
| `render-google-service-account-json-only.txt` | repo root | **GCP service-account key** (same key set, prefix stripped) | **Y** (`.gitignore:31`) | **N** | **NO** — `scripts/build-render-sa-json.js:7` output only |
| `.env` | repo root | All live runtime secrets | **Y** (`.gitignore:1`) | **Y** (`.dockerignore:4`) | **Yes** — `server.js:7,19-20` (dotenv + a `NODE_ENV` regex). Correctly excluded from the image |
| `.env.example` | repo root | **Template — key names only** | N (negated at `.gitignore:3`) | **Y** (`.dockerignore:5` `.env.*`) | No |
| `ocr-service/.env.example` | `ocr-service/` | Template | N | **Y** (`ocr-service/`) | No |
| `data/google-drive-oauth.json` | `data/` | **Google Drive OAuth refresh token** (does not currently exist; created by `saveRefreshToken`) | **Y** (`.gitignore:7` `data/`) | **N** | **Yes, optionally** — `services/google-drive-oauth.js:32` (third-choice fallback after env). **Written** at `:56`. Would be HTTP-servable at `/data/google-drive-oauth.json` if present in the image |
| `data/drive-upload-audit.jsonl` | `data/` | Audit trail (Drive file ids, no credentials) | **Y** | **N** | Written by `services/drive-audit.js:70` |
| `tmp/care-lifecycle-scheduler-test/idempotency-index.json` | `tmp/` | Send-idempotency record (no credentials) | **Y** (`.gitignore:8`) | **N** | `services/care-lifecycle/audit.js:33` (dormant) |
| `tmp/line-contacts/*.json` | `tmp/` | LINE user contact cache — **customer PII** | **Y** | **N** | `services/line-contacts.js:40,57` |
| `backups/notion-clients-backup-2026-08-24T*.json` (491 KB) | `backups/` | **Customer PII bulk export** — no credentials | **Y** (`.gitignore:32`) | **N** | **No** — but HTTP-servable |
| `backups/drive-site-inspection-manifest-*.json` (35 KB) | `backups/` | Drive file manifest | **Y** | **N** | No — HTTP-servable |
| `tmp/customer-backfill/*.json`, `tmp/customer-merge*/**` | `tmp/` | **Customer PII** migration outputs | **Y** | **N** | Read only by operator scripts — HTTP-servable |
| `clients_30_mock_data.csv` | repo root | Mock customer records | **N (tracked in git)** | **N** | **No** — HTTP-servable, and `.csv` **is** in the MIME map (`server.js:122`) |
| `render.yaml` | repo root | Render service definition — **env var names, not values** | N (tracked) | **N** | No — HTTP-servable; discloses service topology |
| `.venv/Lib/site-packages/pip/_vendor/certifi/cacert.pem` | `.venv/` | Public CA bundle — **not a secret** | **Y** (`.gitignore:16`) | **N** | No — dead weight only |
| `ocr-service/.venv/**` (~40 `.pem` / `token` / `credential` matches) | `ocr-service/` | Third-party Python test fixtures — **not secrets** | Y | **Y** (`ocr-service/`) | No |
| `scripts/verify-auth-secret.js`, `scripts/get-refresh-token.js`, `scripts/debug-feedback-token.js`, `scripts/test-feedback-token-fallback.js` | `scripts/` | Tooling by name; no embedded values | N (tracked) | **Y** (`scripts/`) | No |
| `services/case-tokens.js` | `services/` | Source code (token **generator**) | N (tracked) | N | Yes — it *is* runtime code |

**Nothing beyond the three already-known files carries a `private_key`-shaped credential. No `*.key`, `*.p12`, or `*.pfx` exists outside `node_modules`. No `credentials/` or `secrets/` directory exists. PROVEN.**

**Git-tracked secret check:** the three credential files are all `.gitignore`d and untracked. Files matching secret-ish patterns that *are* tracked (`.env.example`, `ocr-service/.env.example`, `scripts/verify-auth-secret.js`, `services/case-tokens.js`, `render.yaml`) are templates, tooling, or source by both name and inspection.

---

## 11. Updated Findings — NEW this round only

Prior-audit findings are **not** restated. Everything below was discovered in this round.

### P0 — new

**No new P0.** The single existing P0 stands. However, **its scope and its fix are both amended** — see §11.4 and §12.

### P1 — new

**NEW-P1-1 — `/auth/google/callback` is unauthenticated and mutates the live Drive refresh token in-process**
- **Evidence:** `api/google-drive-oauth-routes.js:59` registers `GET /auth/google/callback` with **no** `assertAppAuth` (contrast `google-drive-routes.js:108,129` on the neighbouring Drive routes). At `:68` it calls `exchangeCode(code)` → `services/google-drive-oauth.js:115-138`, which on a returned `refresh_token` calls `saveRefreshToken()` (`:124`) → sets the module-level `runtimeRefreshToken` (`:51`), **overwrites `process.env.GOOGLE_REFRESH_TOKEN` in the running process** (`:52`), and writes `data/google-drive-oauth.json` (`:56`). `getRefreshToken()` (`:39-45`) prefers `runtimeRefreshToken` above all else, so every subsequent `getDriveClient()` (`:144-147`) uses the injected token. `/auth/google` (`:39`) is likewise unauthenticated.
- **Impact:** An anonymous internet caller who hits `/auth/google`, completes the Google consent screen with their own account, and lands on the callback **silently redirects all subsequent customer photo uploads into their own Google Drive** until the process restarts. No log line records the takeover as suspicious (`:70` logs only *"OAuth success — refresh token saved"*).
- **Likelihood:** Requires the attacker to reach the registered `GOOGLE_REDIRECT_URI`, which is this host. Low-effort once known.
- **Current state:** **Already true on Render.** Not introduced by containerisation.
- **Required before production:** Gate `/auth/google` and `/auth/google/callback` behind `assertAppAuth`, or bind the flow to a signed, single-use `state` value that only an authenticated staff session can mint (`generateAuthUrl` already accepts a `state` argument — `google-drive-oauth.js:104-113` — but passes the constant `'drive-setup'` and never validates it on return).

**NEW-P1-2 — Public report/feedback tokens carry only 4 characters of entropy, with no rate limiting anywhere**
- **Evidence:** `services/case-tokens.js:18-24` — `randomTokenSuffix(length = 4)` over a 36-character alphabet, called as `` `${prefix}-${randomTokenSuffix(4)}` `` at `:42`. Keyspace = 36⁴ = **1 679 616**. `generateUniqueToken` (`:40-49`) re-rolls on collision up to `MAX_ATTEMPTS = 16`, confirming the space is small enough for collisions to be routine. `grep -rni "rate.?limit|throttl" server.js api/ services/` → **zero matches**. Consuming routes with no other gate: `/api/report/:token` (`case-flow-routes.js:827`), `/api/feedback/:token` GET **and POST** (`:838,845`), `/r/:token` (`:863`), `/f/:token` (`:874`), `/api/public/score-card/:token` (`public-routes.js:83`), `/liff/bind/:token` (`liff-routes.js:222`).
- **Impact:** Full enumeration of the keyspace discloses every customer's water-quality report and contact details, and `POST /api/feedback/:token` allows writing feedback against arbitrary Cases.
- **Mitigating factor:** `POST /api/liff/bind/:token` additionally requires a verified LINE ID token (`liff-routes.js:235`), so LINE-account binding is **not** brute-forceable — only data disclosure is.
- **Likelihood:** Moderate. Trivially automatable; Cloud Run autoscaling absorbs the request volume without degrading, which removes the accidental rate limit that a single Render instance provides.
- **Current state:** **Already true on Render.** Not introduced by containerisation, but materially amplified by a platform that scales into the attack.
- **Required before production:** Raise the suffix length (a 4→12 change in one default argument multiplies the keyspace by 36⁸ ≈ 2.8 × 10¹²) and/or add rate limiting on the token routes. Note: **lengthening the generator does not retroactively lengthen already-issued tokens**, which are live in delivered LINE messages — so rate limiting is the only measure that protects existing customers.

**NEW-P1-3 — LINE result auto-send has a mutation-ordering window that converts an interrupted send into a guaranteed duplicate customer message**
- **Evidence:** §6.2 trace. `workflow-service.js:344` (Notion write `sending`) → `:361` (**LINE push to the customer**) → `:370-377` (Notion write `sent`/`failed`). If the process is throttled or killed between `:361` and `:370`, the customer has the message and Notion does not know. Recovery is governed by `:291-293`: `sendingStartedAt` is a process-local `Map` (`:30`), so on any other instance or after any restart `sendingSince` is `undefined` ⇒ `isStale` is `true` **immediately** — `STALE_SENDING_MS` (3 min, `:28`) never applies — and `:305-307` logs `notification_stale_sending_recovered` and **falls through to re-send**.
- **Compound with LINE retry:** `line-routes.js:739` writes HTTP 200 **before** `:741` schedules the task, so LINE considers the webhook successful and **will never retry**. The mutation is permanently lost with no external system to re-drive it (§6.4).
- **Impact:** Either a customer receives their water-quality result twice, or a completed service silently never reaches the customer with the Case stuck at `notificationStatus: 'sending'`.
- **Likelihood:** Certain on every revision replacement that lands mid-send, given **no SIGTERM handler exists** (`grep 'SIGTERM|SIGINT'` over `server.js api/ services/ config/` → zero matches, re-verified this round).
- **Relationship to prior findings:** This is the concrete customer-visible harm behind prior P1-2 and P1-6, which were recorded separately and abstractly. **`--no-cpu-throttling` alone does not close it** — SIGTERM during a deploy produces the identical outcome with CPU fully allocated.
- **Required before production:** Both halves of prior P1-2 and P1-6 must ship together (CPU always allocated **and** a SIGTERM handler that drains outstanding background tasks), or the send must acquire a durable claim before `:361`.

### P2 — new

**NEW-P2-1 — Two inconsistent definitions of "production"**
`isProductionRuntime()` (`services/app-auth.js:11-17`) accepts `NODE_ENV=production` **or** `RENDER`/`RENDER_SERVICE_ID`, and is exported at `:325` — but `grep` proves it is called **only inside `app-auth.js` itself** (`:34,69,98,108`). The two most security-relevant `NODE_ENV` branches in the codebase use their own naive check that ignores `RENDER*`: `api/case-flow-routes.js:697` (`NODE_ENV !== 'production'` gating the unauthenticated Case-creating `/api/test/create-case`) and `services/ocrClient.js:21` (localhost-OCR guard). On Cloud Run all three agree iff `NODE_ENV=production` is literally set — supplied by `Dockerfile:10`, a single point of failure. Hardening, not an active defect.

**NEW-P2-2 — Unauthenticated `/api/feedback/suggest` calls OpenAI**
`api/feedback-suggest-routes.js:27,36` register GET and POST with no `assertAppAuth`. Anonymous callers can drive `OPENAI_API_KEY`-billed requests. Cost amplification and prompt abuse; no data disclosure identified.

**NEW-P2-3 — Unauthenticated `/api/google-business/oauth/callback`**
`api/google-review-routes.js:66` — same class as NEW-P1-1, but Google Business is inert in production (no `GOOGLE_BUSINESS_*` credentials, `isReadyToSync()` false every cycle), so there is nothing to hijack today. Fix alongside NEW-P1-1.

**NEW-P2-4 — Unauthenticated `/api/drive/status` and `/auth/google/status`**
`google-drive-routes.js:88`, `google-drive-oauth-routes.js:104`. Disclose whether Drive OAuth is configured and whether a refresh token is present. Reconnaissance value only — but they are precisely the reconnaissance an attacker needs before attempting NEW-P1-1.

### P3 — new

**NEW-P3-1 — `_wm_index.html` (32 KB) is a tracked, unexcluded, stale duplicate of the portal UI** servable at `/_wm_index.html`. Dead code and a source of confusion about which UI is live.

**NEW-P3-2 — `render.yaml` is servable from the image**, disclosing the Render service definition and the names of every configured environment variable.

**NEW-P3-3 — `clients_30_mock_data.csv` is git-tracked, unexcluded, and `.csv` is in the MIME map** (`server.js:122`), so it is served as `text/csv` directly to a browser.

**NEW-P3-4 — The public base-URL fallback chain is duplicated verbatim** in `services/url-builder.js:10` and `services/client-feedback.js:214`, and the default Google review URL is duplicated in `services/url-builder.js:7` and `api/case-flow-routes.js:80`. `url-builder.js`'s own header comment (`:1-5`) states it exists to be the single source of truth. Drift risk.

### 11.4 Does this round CHANGE how the existing P0 should be fixed? — **YES**

Two amendments, both load-bearing:

1. **`.dockerignore` alone is necessary but not sufficient.** §3.1 proves the static handler serves **any** file under `root`, not only files whose extension is in the MIME map — unknown extensions fall through to `application/octet-stream` at `server.js:403` and still return a full 200. The prior audit's remediation list was built on the MIME-map premise and therefore under-scopes the exposure. The fix must **also** restrict static serving to an explicit allow-list of directories (`src/`, plus `index.html` and `favicon.ico` at root), because `.dockerignore` only protects against the artifacts that exist *today* — it does nothing about the next `.gitignore`d file someone drops in the working tree before a build. The prior audit called the allow-list "defence in depth, out of scope"; this round's evidence promotes it to **part of the fix**.
2. **The `.dockerignore` list must be broader than recorded.** The prior audit's proposed list omits `.venv/`, `render.yaml`, `_wm_index.html`, `.cursor/`, `start-app.bat`, and `requirements-supported.txt`. §3.2 enumerates every root entry; the complete exclusion set is derivable from that table's final column.

**What this round did NOT change:** the P0's severity (still P0), its root cause (Docker ignores `.gitignore`), and — critically — the absence of any functional dependency. Q1 proves conclusively that removing the credential files breaks nothing.

---

## 12. Revised Recommendation

### 12.1 Does the "just extend `.dockerignore`" fix approach still hold?

**Partially — it is still the right *first* action, and it carries zero feature risk, but it is no longer the *whole* fix.**

- **Zero functional dependency: CONFIRMED.** Q1 is definitive. No Secret Manager keyfile mount, no `GOOGLE_APPLICATION_CREDENTIALS`, no code change is required to remove those three files. The team can delete them from the working tree outright (after confirming the key is rotated or was never in a pushed image) and nothing in the application will notice.
- **But the fix must be paired with a static-serving allow-list** (§11.4 item 1), because the exposure class is structural — "any file under `__dirname` is a public download" — and `.dockerignore` treats only today's instance of it.
- **And the exclusion list must be extended** beyond what the prior audit recorded (§11.4 item 2, §3.2).

### 12.2 Is the team clear to move to a Fix phase?

# YES — proceed to the Fix phase. No further audit round is required.

Every question posed this round was answered definitively from source. Nothing was left as MISSING or unresolved. The four new findings are all **fully characterised with line-level evidence and a stated remedy** — they are work items, not open questions. Notably, **NEW-P1-1 and NEW-P1-2 are pre-existing conditions on Render, not migration risks**; they do not gate the Cloud Run work, and they should be scheduled as security work on their own track rather than being allowed to expand the migration's scope.

Recommended Fix-phase ordering:

1. **P0 (blocks any image build):** extend `.dockerignore` per §3.2; add the static-serving allow-list; delete the three credential files from the working tree; confirm no image containing them was ever pushed, and rotate the service-account key if one was. Verify with `docker build` + `docker run --rm <img> ls -la /app` and a `curl` for each formerly-exposed path before any push.
2. **Prior P1s (blocks production cutover):** `PUBLIC_BASE_URL`; Cloud Run `--timeout ≥ 380` (§9.1's exact 376 000 ms); `--no-cpu-throttling` **together with** a SIGTERM handler that drains background tasks (NEW-P1-3 proves these are one fix, not two); `max-instances=1` as an explicitly documented capacity ceiling that **does not** close the Cal duplicate-Case race during revision replacement (§7.5); verify `POST /api/test/create-case` returns 404 on the live revision and that `ENABLE_TEST_API` is unset.
3. **NEW-P1-1 (`/auth/google/callback`):** gate it. Small, contained, no behavioral risk to the upload path, which uses the env-supplied token.
4. **NEW-P1-2 (token entropy):** schedule as security work independent of the migration. Rate limiting first — it is the only measure that protects tokens already delivered to customers.
5. **Durable correctness for Cal scenario A** (§7.5) before `max-instances` is ever raised above 1.

### 12.3 Safety confirmation

Nothing was deployed, created, modified, enabled, or sent. No Cloud Run service, GCP resource, IAM binding, billing setting, or Secret Manager entry was touched. No Render, Cal.com, LINE, or DNS configuration was changed. No Notion data was read or written. No Case was created. No LINE message was sent. No scheduler or M8/M9 flag was activated. No scoring, business logic, or UI code was modified. `Dockerfile`, `.dockerignore`, `package.json`, `package-lock.json`, and every source and test file are byte-for-byte unchanged. The P0 and all P1s were recorded, not fixed. **No secret value, private key content, or token value was read, printed, or logged at any point — the only inspection of a credential file was a structural extraction of JSON key *names*.**
