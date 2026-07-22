# Environment variables

This document inventories every environment variable used by the Service Portal and
keeps **Auth**, **Google Drive**, and **Google Business OAuth** clearly separate.

> These credential families are **not interchangeable**:
> - `AUTH_SESSION_SECRET` — app login / session HMAC (protects Drive APIs)
> - `GOOGLE_SERVICE_ACCOUNT_*` — Google Drive file uploads (service account JSON)
> - `GOOGLE_BUSINESS_CLIENT_SECRET` — Google Business Profile OAuth (review sync)
>
> Never substitute a Google Business client secret for `AUTH_SESSION_SECRET`,
> or a service-account JSON for OAuth client credentials.

Copy `.env.example` → `.env` for local work. **Never commit `.env`.**

---

## Credential families (do not mix)

| Family | Typical vars | Purpose |
|--------|--------------|---------|
| Auth / session | `AUTH_SESSION_SECRET`, `AUTH_USERS_JSON` | Portal login sessions |
| Google Drive OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_*_FOLDER_ID` | Field photo upload to **My Drive** |
| Google Business / OAuth | `GOOGLE_BUSINESS_*` | Review sync from Business Profile |
| Maps | `GOOGLE_MAPS_API_KEY` | Maps / Places in the field UI |
| Notion | `NOTION_*` | Jobs, feedback, reviews storage |
| LINE | `LINE_*` | Messaging / webhook |
| Hosting | `PORT`, `NODE_ENV`, `PUBLIC_BASE_URL`, `RENDER*` | Runtime / public URLs |
| OCR Service | `OCR_SERVICE_URL`, `OCR_TIMEOUT` | Proxy to isolated Python OCR service |

> Do **not** use a Service Account for Drive uploads (`GOOGLE_SERVICE_ACCOUNT_JSON` is deprecated for this app).  
> Do **not** substitute `GOOGLE_BUSINESS_CLIENT_SECRET` for `GOOGLE_CLIENT_SECRET` unless you intentionally share one OAuth client.

---

## Full audit

Legend: **R** = required, **O** = optional, **—** = not needed for that mode.

### Runtime / hosting

| Variable | Where used | Required? | Local | Production |
|----------|------------|-----------|-------|------------|
| `NODE_ENV` | `server.js`, `services/app-auth.js`, case-flow | O (defaults) | `development` (preferred) | `production` |
| `PORT` | `server.js` | O (default 3000) | O | O |
| `BIND_HOST` | `server.js` | O (default `0.0.0.0`) | O | O |
| `PUBLIC_BASE_URL` | Drive content URLs, LINE, reports, cookies | Recommended | O (`http://127.0.0.1:3040`) | R (https app URL) |
| `RENDER` / `RENDER_SERVICE_ID` / `RENDER_EXTERNAL_URL` | Host detection / URL fallback | Host-set | — | Set by Render |

### Auth / session

| Variable | Where used | Required? | Local | Production |
|----------|------------|-----------|-------|------------|
| `AUTH_SESSION_SECRET` | `services/app-auth.js` (login token HMAC) | **R in prod** | O (warned fallback if empty) | **R — server exits if missing** |
| `SESSION_SECRET` | Alias of `AUTH_SESSION_SECRET` | O | O | Prefer `AUTH_SESSION_SECRET` |
| `AUTH_USERS_JSON` | `services/app-auth.js` | O (built-in demo users) | O | Recommended |

Generate: `openssl rand -hex 32`

### Google Drive (OAuth — My Drive uploads)

| Variable | Where used | Required? | Local | Production |
|----------|------------|-----------|-------|------------|
| `GOOGLE_CLIENT_ID` | `services/google-drive-oauth.js` | R for Drive | R* | R* |
| `GOOGLE_CLIENT_SECRET` | same | R for Drive | R* | R* |
| `GOOGLE_REDIRECT_URI` | `/auth/google/callback` | R for Drive | R* | R* |
| `GOOGLE_REFRESH_TOKEN` | Drive client auth | R for uploads | R* (after `/auth/google`) | R* |
| `GOOGLE_DRIVE_MAIN_FOLDER_ID` | `services/google-drive.js` | R* for Drive | R* | R* |
| `GOOGLE_DRIVE_FOLDER_ID` | Legacy alias → main | O | O | O |
| `GOOGLE_DRIVE_DATA_FOLDER_ID` | JSON / non-image data files | Recommended | Recommended | Recommended |
| `GOOGLE_DRIVE_MAKE_PUBLIC` | Public link on upload | O (`false`) | O | O |
| `DRIVE_AUDIT_MAX_BYTES` | Audit log rotation | O | O | O |
| `DRIVE_AUDIT_KEEP_FILES` | Keep N rotated audits | O | O | O |

\* Required when using photo upload. Authorize once via `GET /auth/google`.

~~Service Account (`GOOGLE_SERVICE_ACCOUNT_JSON` / `KEY_PATH`) is no longer used for uploads.~~

### Google Business / OAuth (review sync)

| Variable | Where used | Required? | Local | Production |
|----------|------------|-----------|-------|------------|
| `GOOGLE_BUSINESS_CLIENT_ID` | `services/googleBusinessAuth.js` | R for review sync | O if unused | R if sync enabled |
| `GOOGLE_BUSINESS_CLIENT_SECRET` | same | R for review sync | O if unused | R if sync enabled |
| `GOOGLE_BUSINESS_REDIRECT_URI` | OAuth callback | R for OAuth setup | O | R if sync enabled |
| `GOOGLE_BUSINESS_REFRESH_TOKEN` | Token refresh | R for review sync | O | R if sync enabled |
| `GOOGLE_BUSINESS_ACCOUNT_ID` | `services/google-business.js` | R for sync | O | R if sync enabled |
| `GOOGLE_BUSINESS_LOCATION_ID` | same | R for sync | O | R if sync enabled |
| `GOOGLE_BUSINESS_LOCATION_NAME` | Display / labels | O | O | O |
| `GOOGLE_BUSINESS_LOCATIONS_PAGE_SIZE` | List locations | O | O | O |
| `GOOGLE_REVIEWS_PAGE_SIZE` | Reviews page size | O | O | O |
| `GOOGLE_REVIEW_SYNC_ENABLED` | Scheduler | O | O | O |
| `GOOGLE_REVIEW_SYNC_INTERVAL_MINUTES` | Scheduler | O | O | O |
| `GOOGLE_REVIEW_SYNC_RUN_ON_START` | Scheduler | O | O | O |
| `GOOGLE_REVIEW_URL` | Feedback / case flow links | Recommended | O | Recommended |

This is **OAuth 2 client** credentials for Google Business Profile — not a service account.

### Maps / Places

| Variable | Where used | Required? | Local | Production |
|----------|------------|-----------|-------|------------|
| `GOOGLE_MAPS_API_KEY` | `server.js` `/api/maps-config`, preassessment maps | Recommended | O | Recommended |
| `GOOGLE_API_KEY` | Debug scripts only (alias) | O | O | O |
| `GOOGLE_PLACE_ID` | Debug scripts only | O | O | O |

### Notion

| Variable | Where used | Required? | Local | Production |
|----------|------------|-----------|-------|------------|
| `NOTION_API_KEY` / `NOTION_TOKEN` | `config/env.js`, Notion clients | R for Notion | R if using Notion | R |
| `NOTION_DATABASE_ID` / `NOTION_DB_ID` | Clients / jobs DB | R for jobs | R if using Notion | R |
| `NOTION_DATA_SOURCE_ID` | Notion data source override | O | O | O |
| `NOTION_CLIENT_FEEDBACK_DATABASE_ID` | Client feedback flow | Recommended | O | Recommended |
| `NOTION_CLIENT_FEEDBACK_DATA_SOURCE_ID` | Feedback data source | O | O | O |
| `NOTION_FEEDBACK_DATABASE_ID` | Feedback / Google reviews Notion DB | Recommended | O | Recommended |
| `NOTION_FEEDBACK_DATA_SOURCE_ID` | Reviews data source | O | O | O |
| `NOTION_DEBUG_DATES` | Mapper debug | O | O | O |

### LINE

| Variable | Where used | Required? | Local | Production |
|----------|------------|-----------|-------|------------|
| `LINE_CHANNEL_ID` | LINE routes status | O / R for LINE | O | R if LINE live |
| `LINE_CHANNEL_SECRET` | Webhook signature | R for webhook | O | R if LINE live |
| `LINE_CHANNEL_ACCESS_TOKEN` | Send messages | R for send | O | R if LINE live |
| `LINE_MOCK_SEND` | Mock outbound LINE | O (`true` local) | Recommended `true` | `false` when live |

### Other

| Variable | Where used | Required? | Local | Production |
|----------|------------|-----------|-------|------------|
| `IT_SUPPORT_CONTACT` / `IT_SUPPORT_LINE` | Auth config / forgot password | O | O | O |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | Feedback AI suggest | O | O | O |
| `ENABLE_TEST_API` | Case-flow test APIs | O | O | Keep unset/`false` |
| `VERIFY_LINE_DRY_RUN` | Scripts only | O | O | — |

### Listed in `.env.example` but unused by runtime app code

| Variable | Notes |
|----------|-------|
| `CALCOM_API_KEY` | Placeholder only (no runtime reader found) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Placeholder only |
| `AUTH_REDIRECT_URL` | Placeholder only |

Keep them only if you plan future integrations; they are not required to start the server.

---

## Startup behavior

| Mode | Detection | `AUTH_SESSION_SECRET` |
|------|-----------|------------------------|
| Local | `NODE_ENV=development`, or unset locally (defaults to development). Not on Render. | Optional — empty uses warned fallback |
| Production | `NODE_ENV=production` **or** `RENDER` / `RENDER_SERVICE_ID` set | **Required** — missing → `[FATAL]` and process exit |

Local note: if the shell exports `NODE_ENV=production` but `.env` has `NODE_ENV=development`, `server.js` prefers the `.env` value when **not** on Render.

---

## Git safety

| Path | Git status |
|------|------------|
| `.env` | Ignored |
| `.env.*` | Ignored except `.env.example` |
| `credentials/` | Ignored |
| `*service-account*.json`, `solar-bolt-*.json` | Ignored |
| `data/` (audit logs) | Ignored |

Startup logs print **booleans** for secrets (`authSessionSecret`, Business secret present), never secret values.

---

## Minimal sets

### Local start (portal + Drive photos)

```env
NODE_ENV=development
AUTH_SESSION_SECRET=
PORT=3040
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://127.0.0.1:3040/auth/google/callback
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DRIVE_MAIN_FOLDER_ID=...
GOOGLE_DRIVE_DATA_FOLDER_ID=...
PUBLIC_BASE_URL=http://127.0.0.1:3040
```

### Production (Render) — always

```env
NODE_ENV=production
AUTH_SESSION_SECRET=<openssl rand -hex 32>
PUBLIC_BASE_URL=https://your-app.onrender.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-app.onrender.com/auth/google/callback
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DRIVE_MAIN_FOLDER_ID=...
GOOGLE_DRIVE_DATA_FOLDER_ID=...
```

## Render (hosted) deployment

When deploying to Render (or similar managed hosts), follow these rules:

- Provide secrets via the Render dashboard **Environment** settings — do not commit secret files to the repository.
- For Google Drive service account credentials, set `GOOGLE_SERVICE_ACCOUNT_JSON` with the entire JSON content (recommended) or use Render secret file storage and set `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` to that secure path.
- Set `GOOGLE_DRIVE_MAIN_FOLDER_ID` and `GOOGLE_DRIVE_DATA_FOLDER_ID` in the dashboard.
- Ensure `AUTH_SESSION_SECRET` is set to a strong random value (server exits if missing in production).
- Deploy **both** Blueprint services (`water-motion-service-portal` and `water-motion-ocr-service`). Sync the Blueprint or create the OCR service and set portal `OCR_SERVICE_URL` to the OCR public URL.
- After deployment restart, verify with `GET /api/drive/status` which reports non-sensitive fields: `configured`, `credentialsLoaded`, `mainFolderConfigured`, `dataFolderConfigured`, and `serviceAccountEmail`.
- Verify OCR with `GET {OCR_SERVICE_URL}/health` and confirm portal logs do not use `127.0.0.1:5055`.

Recommended Render env variables example:

```
NODE_ENV=production
AUTH_SESSION_SECRET=<openssl rand -hex 32>
PUBLIC_BASE_URL=https://your-app.onrender.com
GOOGLE_SERVICE_ACCOUNT_JSON=<paste entire JSON here>
GOOGLE_DRIVE_MAIN_FOLDER_ID=1-mS_IbW95JGqbD9JZFvpIRkSxTjCjLXH
GOOGLE_DRIVE_DATA_FOLDER_ID=14Fug6zCjbtBt6I9ab4R-bWOo1FXRkHQx
# Set automatically by render.yaml Blueprint fromService; override only if needed:
# OCR_SERVICE_URL=https://water-motion-ocr-service.onrender.com
OCR_TIMEOUT=120000
```

Do not expose `private_key` or other secret fields in logs. The app intentionally only reports the service account email and boolean flags for configured state.

**If meter OCR returns `OCR_OFFLINE` / `OCR_MISCONFIGURED` on Render:** the OCR web service is missing or `OCR_SERVICE_URL` still points at localhost. Create/sync `water-motion-ocr-service` from `render.yaml`, wait until `GET {OCR_URL}/health` returns `ready: true`, then set portal `OCR_SERVICE_URL` to that public URL and restart the portal.

---

## OCR Service (isolated Python process)

The main Node backend does **not** run OCR. It proxies to a separate service.

| Variable | Default | Purpose |
|----------|---------|---------|
| `OCR_SERVICE_URL` | `http://127.0.0.1:5055` | Base URL of the OCR Service (**required** in production — must not be localhost on Render) |
| `OCR_TIMEOUT` | `30000` | Outbound request timeout in milliseconds |
| `OCR_DEBUG` | unset | When `true`, log connection error details |

### Local development

1. Start OCR: `cd ocr-service && .\run.ps1` (uses `.\.venv\Scripts\python.exe`, verifies versions, sets `PADDLE_PDX_CACHE_HOME=C:\paddlex_cache` when missing, then binds `http://0.0.0.0:5055`).
2. Leave `OCR_SERVICE_URL` unset in portal `.env`, or set:

```
OCR_SERVICE_URL=http://127.0.0.1:5055
OCR_TIMEOUT=30000
```

### Production (Render)

`render.yaml` defines two web services:

| Service | Role |
|---------|------|
| `water-motion-service-portal` | Node portal |
| `water-motion-ocr-service` | Python OCR (`rootDir: ocr-service`) |

The portal receives `OCR_SERVICE_URL` from the OCR service’s `RENDER_EXTERNAL_URL` (Blueprint `fromService`). Do **not** set `OCR_SERVICE_URL=http://127.0.0.1:5055` on Render — that targets the portal process and yields `[ocr-client] … reason: 'offline'`.

If the Blueprint is not synced, set the portal env manually to the OCR service URL, e.g. `https://water-motion-ocr-service.onrender.com` (no trailing slash).

Verify after deploy:

1. `GET {OCR_SERVICE_URL}/health` → `ready: true`
2. Portal logs for OCR must show that host, **not** `127.0.0.1:5055`
3. Meter Reading capture → `POST /api/ocr/read-meter` succeeds and form fields update

Portal route: `POST /api/ocr/read-meter` → OCR Service `POST /ocr/read-meter`.
