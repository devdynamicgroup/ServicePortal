# Water Motion Service Portal

Node.js field service portal (static SPA + API) deployed on Render.

## Google Drive uploads (OAuth 2.0)

Photo uploads use **OAuth 2.0** into the **authenticated user's My Drive** (not a Google Service Account).

Service accounts have no My Drive storage quota and will fail with `storageQuotaExceeded`. This project no longer uses `GOOGLE_SERVICE_ACCOUNT_JSON` for uploads.

### 1. Google Cloud Console

1. Create (or reuse) a Google Cloud project.
2. Enable **Google Drive API**.
3. Create **OAuth client ID** → Application type **Web application**.
4. Add Authorized redirect URIs, for example:
   - Local: `http://127.0.0.1:3040/auth/google/callback`
   - Render: `https://YOUR-APP.onrender.com/auth/google/callback`
5. Copy Client ID and Client Secret.

### 2. Environment variables (Render + local `.env`)

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://YOUR-APP.onrender.com/auth/google/callback
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_MAIN_FOLDER_ID=...
GOOGLE_DRIVE_DATA_FOLDER_ID=...
```

Also keep portal auth:

```env
NODE_ENV=production
AUTH_SESSION_SECRET=   # openssl rand -hex 32
PUBLIC_BASE_URL=https://YOUR-APP.onrender.com
```

These Drive OAuth vars are **separate** from Google Business review-sync vars (`GOOGLE_BUSINESS_*`).

### 3. One-time authorization (get refresh token)

1. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` on Render (or local `.env`).
2. Deploy / start the server.
3. Open in a browser (use the Google account that **owns** the Drive folders):

   `https://YOUR-APP.onrender.com/auth/google`

4. Approve access.
5. On the callback page, copy **`GOOGLE_REFRESH_TOKEN`** into Render Environment (and local `.env`).
6. Redeploy / restart.

Local helper (prints the auth URL):

```bash
node scripts/authorize-google-drive.js
```

### 4. Folders

Create two folders in that user's **My Drive** and set their IDs:

| Env | Use |
|-----|-----|
| `GOOGLE_DRIVE_MAIN_FOLDER_ID` | Root for customer folders + all images |
| `GOOGLE_DRIVE_DATA_FOLDER_ID` | Fallback for anonymous JSON uploads |

### 5. Verify

```bash
curl https://YOUR-APP.onrender.com/api/drive/status
# configured + credentialsLoaded + refreshTokenSet should be true
```

Frontend upload API is unchanged: `POST /api/drive/images` (still requires app login session).

### 6. Run locally

```bash
cp .env.example .env
# fill GOOGLE_CLIENT_* , folders, AUTH_SESSION_SECRET / NODE_ENV=development
npm install
yarn start
# or: node server.js
```

Open `http://127.0.0.1:3040/auth/google` once if `GOOGLE_REFRESH_TOKEN` is empty.

More detail: [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md), [docs/GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md).
