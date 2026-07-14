# Google Drive integration

This project uses a **Google Cloud service account** to upload, list, read, and delete images in configured Drive folders.

No new npm packages are required. Auth is done with a signed JWT + Google token endpoint (same lightweight style as the existing Google Business helpers).

## Folders

| Key | Env var | Use |
|-----|---------|-----|
| `main` | `GOOGLE_DRIVE_MAIN_FOLDER_ID` | Visit/display photos: tap, visual, meter, chlorine, payment slip |
| `data` | `GOOGLE_DRIVE_DATA_FOLDER_ID` | Secondary/raw/OCR/internal captures |

Legacy `GOOGLE_DRIVE_FOLDER_ID` still maps to **main** if `GOOGLE_DRIVE_MAIN_FOLDER_ID` is unset.

Default for upload/list APIs is **main** (backward compatible). Pass `folder: "data"` or a purpose such as `ocr` / `raw` to use the data folder.

## 1. Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) for the project that owns the service account.
2. Enable **Google Drive API**.
3. Create (or reuse) a **Service Account**, then download the JSON key.
4. Create (or reuse) the **main** and **data** Drive folders.
5. Share **both** folders with the service account email (from the JSON `client_email`) as **Editor**.
6. Copy each folder ID from the Drive URL:
   - `https://drive.google.com/drive/folders/<FOLDER_ID>`

## 2. Place credentials (do not commit)

Recommended local layout:

```text
credentials/google-service-account.json
```

If you already downloaded a key to the project root (for example `solar-bolt-….json`), either:

- Move/rename it to `credentials/google-service-account.json`, or
- Point `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` at the existing file.

Sensitive paths are ignored by `.gitignore` (`credentials/`, `solar-bolt-*.json`, `*service-account*.json`).

For Render / other hosts without a file mount, paste the whole JSON into `GOOGLE_SERVICE_ACCOUNT_JSON` instead of using a path.

## 3. Environment variables

Copy from `.env.example` into `.env`:

```env
GOOGLE_DRIVE_MAIN_FOLDER_ID=1-mS_IbW95JGqbD9JZFvpIRkSxTjCjLXH
GOOGLE_DRIVE_DATA_FOLDER_ID=14Fug6zCjbtBt6I9ab4R-bWOo1FXRkHQx
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/google-service-account.json
# GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_DRIVE_MAKE_PUBLIC=false
PUBLIC_BASE_URL=http://127.0.0.1:3000
AUTH_SESSION_SECRET=replace-with-a-long-random-string
NODE_ENV=development
```

Max image size is **15 MB** (decoded). JSON upload bodies allow base64 overhead. Optional `GOOGLE_DRIVE_FETCH_TIMEOUT_MS` (default 60000) limits Google token/Drive API calls; the browser client aborts at 90s.

**App auth:** All `/api/drive/images*` routes (including `/content`) require a session from the existing portal login (`Authorization: Bearer <token>` or `wm_session` cookie). `GET /api/drive/status` stays open for health checks.

**`AUTH_SESSION_SECRET`:** Required in production (`NODE_ENV=production` or Render). The server **exits on startup** if it is missing. A weak fallback is allowed only when `NODE_ENV=development`.

**Audit logs:** Metadata-only lines append to `data/drive-upload-audit.jsonl`. When the file exceeds ~2 MB (`DRIVE_AUDIT_MAX_BYTES`), it rotates to timestamped files and keeps the newest `DRIVE_AUDIT_KEEP_FILES` (default 5).

| Variable | Required | Purpose |
|----------|----------|---------|
| `GOOGLE_DRIVE_MAIN_FOLDER_ID` | Yes* | Main image folder |
| `GOOGLE_DRIVE_DATA_FOLDER_ID` | Recommended | Secondary/data folder |
| `GOOGLE_DRIVE_FOLDER_ID` | Legacy | Alias for main folder |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | One of path/JSON | Path to service account JSON |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | One of path/JSON | Inline JSON (production-friendly) |
| `GOOGLE_DRIVE_MAKE_PUBLIC` | No | If `true`, set anyone-with-link reader on upload |
| `GOOGLE_DRIVE_FETCH_TIMEOUT_MS` | No | Google API fetch timeout (ms, default 60000) |
| `AUTH_SESSION_SECRET` | Yes in production | Signs portal session tokens used by Drive routes |
| `NODE_ENV` | Recommended | `development` for local fallback; `production` on deploy |
| `DRIVE_AUDIT_MAX_BYTES` | No | Rotate audit log above this size (default 2097152) |
| `DRIVE_AUDIT_KEEP_FILES` | No | Rotated audit files to keep (default 5) |
| `PUBLIC_BASE_URL` | Recommended | Builds absolute `contentUrl` values |

\* Or set legacy `GOOGLE_DRIVE_FOLDER_ID`.

## 4. API endpoints

Base URL examples assume the app is running locally.

### Status

```http
GET /api/drive/status
```

Returns `folders.main`, `folders.data`, and `configured`.

### Upload image (JSON + base64 / data URL)

```http
POST /api/drive/images
Content-Type: application/json

{
  "filename": "tap-kitchen.jpg",
  "contentType": "image/jpeg",
  "purpose": "tapphoto",
  "dataUrl": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

Also accepts `base64` instead of `dataUrl`.

Optional routing fields (pick one):

- `folder`: `"main"` | `"data"`
- `purpose` / `useCase` / `type`: e.g. `tapphoto`, `payment`, `ocr`, `raw`

If omitted, uploads go to **main**.

### List images

```http
GET /api/drive/images?pageSize=20
GET /api/drive/images?folder=data
GET /api/drive/images?purpose=ocr
```

### Get metadata

```http
GET /api/drive/images/<fileId>
```

Returned fields include `id`, `name`, `mimeType`, `size`, `webViewLink`, `thumbnailLink`, and `contentUrl` (proxied through this app).

### Download bytes (authenticated by the service account)

```http
GET /api/drive/images/<fileId>/content
```

### Delete

```http
DELETE /api/drive/images/<fileId>
```

## 5. Run and test

```bash
node server.js
```

Check configuration:

```bash
curl http://127.0.0.1:3000/api/drive/status
```

You should see `"configured": true` and the service account email when credentials + folder id are set.

Upload a tiny test image (PowerShell):

```powershell
$bytes = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("not-a-real-image"))
# Prefer a real JPEG/PNG base64 for a real upload smoke test.
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/drive/images -ContentType 'application/json' -Body (@{
  filename = 'smoke-test.png'
  contentType = 'image/png'
  dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
} | ConvertTo-Json)
```

Then list and delete with the returned `file.id`.

## Field app capture → Drive

The assessment/payment camera flow uploads to Drive after capture:

`Camera/File → data URL preview → POST /api/drive/images → store Drive metadata in job draft`

- Visit photos (`tapphoto`, `visual`, `meter`, `chlorine`, payment slip) → folder **main**
- Meter/chlorine also store an OCR copy → folder **data** (`ocrFileId`)
- Legacy jobs with base64 `data:` strings still preview correctly
- Draft save does not re-upload when `fileId` already exists

Client helper: `src/js/services/google-drive-client.js`

## 7. Troubleshooting

- **403 / insufficient permissions**: share the folder with the service account email.
- **configured: false**: missing `GOOGLE_DRIVE_MAIN_FOLDER_ID` (or legacy `GOOGLE_DRIVE_FOLDER_ID`) or credentials path/JSON.
- **Drive API not enabled**: enable it in Google Cloud for the same project as the key.
- **Invalid JWT / private key**: keep `\n` newlines in `private_key` when using `GOOGLE_SERVICE_ACCOUNT_JSON`.
