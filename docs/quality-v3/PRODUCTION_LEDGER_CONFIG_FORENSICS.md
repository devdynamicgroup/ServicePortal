# Production ledger configuration forensics (Gate A)

**Status:** Recorded 2026-08-17. Gate A remains a **publication-durability** gate, independent of the V7 canonical score skeleton.  
**Scoring:** frozen. This document does not change Q-V3, country engines, α, or F.

Production probe (`GET https://serviceportal.onrender.com/api/ops/health`):

```text
version = 19d2ab24990a4ade7b2100351f42b1dc65e1f17e
scorePublicationLedger.configured = false
scorePublicationLedger.status = not_configured
scorePublicationLedger.code = LEDGER_REQUIRED
```

Notion Score Publications database (already provisioned; do not recreate):

```text
eb1026b8-bc27-47ae-9996-97711d9fe672
```

---

## A–J

| # | Question | Answer |
|---|----------|--------|
| A | Is the variable declared in `render.yaml`? | **Yes.** Portal service `water-motion-service-portal` declares `NOTION_SCORE_PUBLICATIONS_DATABASE_ID`. |
| B | Is `sync: false` intentional? | **Yes.** Same pattern as `NOTION_API_KEY` / `NOTION_DATABASE_ID`: Dashboard-set secret/id, never hardcoded. Blueprint sync does **not** inject the value. |
| C | Is the deployed Render service the one in `render.yaml`? | **EXTERNAL** for dashboard service-id mapping. Correlated evidence: health `publicBaseUrlHost = serviceportal.onrender.com` and `version` matches commit `19d2ab24` on `origin/main`. |
| D | Is the env var present in the deployed process? | **No.** Health uses the same `isScorePublicationsConfigured()` check as the ledger. `configured=false` / `LEDGER_REQUIRED` means API key and/or database id is empty at runtime. Cases DB Notion is `configured: true`, so the missing piece is the **publications database id**. |
| E | Does the app read `process.env` at runtime? | **Yes.** [`config/env.js`](../../config/env.js) `getNotionConfig().scorePublicationsDatabaseId` and [`services/notion/score-publications.js`](../../services/notion/score-publications.js) `getScorePublicationsDatabaseId()`. |
| F | dotenv / config-loader ordering issue? | **Unlikely on Render.** `dotenv.config` loads local `.env` once; it does not override already-set process env. Production `NODE_ENV=production` is host-injected. Empty publications id is not explained by local `.env` masking. |
| G | Variable-name mismatch? | **No.** Runtime names: `NOTION_SCORE_PUBLICATIONS_DATABASE_ID` (primary) and alias `NOTION_PUBLICATION_LEDGER_DATABASE_ID`. Health and ledger share that reader. |
| H | Does health read the same config object as the ledger? | **Yes.** [`api/ops-routes.js`](../../api/ops-routes.js) `scorePublicationLedgerMeta()` calls `isScorePublicationsConfigured()` from the ledger module. |
| I | Does Render require a restart after setting the variable? | **EXTERNAL.** Typical Dashboard “Save” restarts the service; this workspace cannot observe Render events. |
| J | Is the current deployment from the expected branch/service? | **Commit: yes** (`19d2ab24` = `origin/main` Phase A). **Render service id / auto-deploy wiring: EXTERNAL.** |

---

## Classification

```text
BLOCKER CLASS: B — Production environment configuration missing
```

Not a score-model defect. Not a second Notion database. Not a reason to couple canonical scoring to Render.

Fail-closed behavior is preserved:

```text
ledger unavailable → 503 LEDGER_REQUIRED
no Latest Water Score fallback
```

Canonical V7 simulation must run **without** this variable.
