# Google Drive integration (OAuth)

Field photos upload into the **My Drive** of the Google account that completed OAuth (`/auth/google`).

This replaces the previous **Service Account** flow (which fails with `storageQuotaExceeded` on My Drive).

## Folders

| Key | Env var | Use |
|-----|---------|-----|
| `main` | `GOOGLE_DRIVE_MAIN_FOLDER_ID` | Visit/display photos: tap, visual, meter, chlorine, payment slip |
| `data` | `GOOGLE_DRIVE_DATA_FOLDER_ID` | Secondary/raw/OCR/internal captures |

Legacy `GOOGLE_DRIVE_FOLDER_ID` still maps to **main**.

## OAuth setup (Render)

See [README.md](../README.md#google-drive-uploads-oauth-20) for the full checklist.

Required env:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://YOUR-APP.onrender.com/auth/google/callback
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_MAIN_FOLDER_ID=
GOOGLE_DRIVE_DATA_FOLDER_ID=
```

One-time: open `/auth/google`, approve, copy refresh token into Render, redeploy.

## API (unchanged for the frontend)

- `GET /api/drive/status`
- `POST /api/drive/images` (app session required)
- `GET /api/drive/images`, `GET/DELETE /api/drive/images/:id`, `GET .../content`

OAuth bootstrap routes:

- `GET /auth/google`
- `GET /auth/google/callback`

## Notes

- Uses `googleapis` with automatic access-token refresh from `GOOGLE_REFRESH_TOKEN`.
- Refresh token may also be cached under `data/google-drive-oauth.json` locally (`data/` is gitignored).
- Google Business Profile sync still uses separate `GOOGLE_BUSINESS_*` variables.
