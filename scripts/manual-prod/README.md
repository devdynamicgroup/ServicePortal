# scripts/manual-prod/

Scripts in this directory contact **real production** (Notion and/or the live
`serviceportal.onrender.com` API) using real credentials from `.env`. Some
create real Cases; none are idempotent regression tests.

**Never run anything here as part of a normal regression pass.** Never loop
over `scripts/*.js` or `scripts/test-*.js` and expect these to be excluded
automatically by name alone — that exact assumption caused a real incident on
2026-09-09 (see `feedback_test_scripts_not_automatically_safe` in project
memory) where re-running "the regression suite" created 3 unwanted production
Notion Cases.

Before running any file in this directory:
1. Read the file's own header comment for what it does and what it creates.
2. Confirm you actually intend to touch production right now.
3. After running, if it created a test Case, clean it up via the existing
   supported `cancelAppointment()` mechanism (see the 2026-09-08/09 cleanup
   reports) — never delete/archive Notion pages directly.

| File | What it does | Mutates production? |
|---|---|---|
| `verify-package-history-live.js` | Creates one throwaway Case, writes `package:'full'`, reads it back directly from Notion | YES — creates a Case |
| `repro-maps-link-persistence.js` | One-shot repro: logs in as a real operator, creates a Case, saves `ci-maps`, reloads fresh from the server | YES — creates a Case, not idempotent (a new Case every run) |
