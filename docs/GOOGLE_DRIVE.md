# Google Drive integration (OAuth)

Field photos upload into the **My Drive** of the Google account that completed OAuth (`/auth/google`).

This replaces the previous **Service Account** flow (which fails with `storageQuotaExceeded` on My Drive).

Auth remains **OAuth 2.0** (not a Service Account). Folder creation and file access use that same OAuth client.

## Root folders (env)

| Key | Env var | Role |
|-----|---------|------|
| `main` | `GOOGLE_DRIVE_MAIN_FOLDER_ID` | Parent root for **customer folders** and images |
| `data` | `GOOGLE_DRIVE_DATA_FOLDER_ID` | Fallback root for anonymous JSON uploads (no case id) |

Legacy `GOOGLE_DRIVE_FOLDER_ID` still maps to **main**.

## Customer folder hierarchy

On each upload with a Notion case id, the server ensures:

```
GOOGLE_DRIVE_MAIN_FOLDER_ID/
 └── Customer Name [a1b2c3d4]/
     ├── Site Inspection   ← tap / visual / meter / chlorine photos
     ├── Before Service    ← purpose: before-service
     ├── After Service     ← purpose: after-service
     ├── Documents         ← JSON / reports / metadata
     └── Payment           ← payment slips ONLY (created lazily)
```

Rules:

- Customer folder is created once, then reused (`wmCustomerId` appProperty + Notion `Drive Folder ID` cache).
- Category folders are created **lazily** on first upload for that category.
- **Payment** is created only when a payment-slip upload runs — customers without payments never get an empty Payment folder.

Purpose → category:

| Purpose | Category |
|---------|----------|
| `tapphoto`, `visual`, `meter`, `chlorine`, `photo` | Site Inspection |
| `before`, `before-service` | Before Service |
| `after`, `after-service` | After Service |
| `json`, `assessment`, `export`, `report`, `documents` | Documents |
| `payment`, `slip`, `receipt` | Payment |

## Image retrieval in the portal

Uploaded metadata (draft + API response) includes:

- `fileId` — Google Drive file id
- `contentUrl` — `/api/drive/images/:fileId/content` (requires app login session)
- `webViewLink` — Google Drive UI link
- `folderId` / `customerFolderId` / `category` — hierarchy context

The UI loads previews via authenticated `contentUrl` (`DrivePhoto.hydrateImg`). Nested files under customer folders are allowed (ancestor check against the configured roots).

## Notion properties (optional but recommended)

Add these **URL / text** properties on the clients database so uploads can persist links:

| Property name | Suggested type | Field |
|---------------|----------------|-------|
| Drive Folder ID | Text / rich text | `driveFolderId` |
| Drive Folder URL | URL / text | `driveFolderUrl` |
| Drive Latest File ID | Text | `driveLatestFileId` |
| Drive Latest File URL | URL | `driveLatestFileUrl` |
| Drive Latest Category | Text | `driveLatestCategory` |
| Drive Latest Purpose | Text | `driveLatestPurpose` |

If a property is missing, uploads still succeed; Notion save is best-effort and logged.

## OAuth setup (Render)

See [README.md](../README.md#google-drive-uploads-oauth-20) for the checklist.

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://YOUR-APP.onrender.com/auth/google/callback
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_MAIN_FOLDER_ID=
GOOGLE_DRIVE_DATA_FOLDER_ID=
```

## API

- `GET /api/drive/status`
- `POST /api/drive/images` — body may include `notionId`, `customerName`, `customerFolderId`, `purpose`, `folder`, `dataUrl`
- `GET /api/drive/images`, `GET/DELETE /api/drive/images/:id`, `GET .../content`

## Logging (no secrets)

Safe logs emitted:

- `[drive-folders] creating/reusing folder`
- `[UPLOAD REQUEST]` / `[UPLOAD RECEIVED]`
- `[drive-notion] metadata saved|skipped`

Never logged: OAuth client secret, refresh token, Service Account JSON.
