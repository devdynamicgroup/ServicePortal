# Score Publication Ledger — Gate A contract

**Status:** Application implementation PASS; durable Notion ledger provisioned; **GATE A = BLOCKED** pending production configuration and end-to-end verification  
**Live ledger:** requires ops-created `NOTION_SCORE_PUBLICATIONS_DATABASE_ID`  
**Scoring:** frozen — this contract does not change Quality V3, country engines, α, or F  
**Phase B:** LOCKED until Gate A PASS

```text
Publication #1  → IMMUTABLE
Republish       → Publication #2 (new token)
Publication #1  → UNCHANGED FOREVER
Latest Water Score → compatibility pointer only
```

### Gate A lock (current)

```text
Application implementation   PASS
Immutability logic            PASS
Republish 90 → 80             PASS (in-memory / app tests)
Old token remains frozen      PASS (in-memory / app tests)
Public route ledger-first     PASS
Close-case path               PASS
Reconciler safety             PASS
Gate A tests                  PASS
Existing regressions          PASS

Durable Notion ledger         PROVISIONED
NOTION_SCORE_PUBLICATIONS_DATABASE_ID
                              NOT CONFIGURED IN PRODUCTION

GATE A                       BLOCKED
PHASE B                      LOCKED
SCORING CODE                 OFF
α / F                        TBD
REAL SCORE                   UNCHANGED
```

**Hard rule:** Never use `Latest Water Score` (or Case-only mutable fields) as a fallback to claim Gate A PASS. Missing ledger → fail closed (`503 LEDGER_REQUIRED`).

### Post-provision verification (required before Gate A PASS)

After ops configures `NOTION_SCORE_PUBLICATIONS_DATABASE_ID` in production and deploys (+ integration share already verified):

1. Use an **existing** allowed test Case only — do not create synthetic production Cases.
2. Publish `90` → `TOKEN_A`.
3. Republish `80` → `TOKEN_B` (new publication + new token).
4. Resolve `TOKEN_A` → still `90`; resolve `TOKEN_B` → `80`.
5. Confirm Case `Latest Water Score` is only the latest pointer (`80`).
6. Confirm both ledger rows are unchanged (no overwrite of immutable fields).
7. Retry/idempotency: same key replays the same publication; no mutation.
8. Reconciler: repairs pointer only; never mutates snapshot / score / token / publishedAt.
9. `/r/{token}` and `/api/report/{token}` resolve ledger-first from durable store.
10. After deploy/restart, both publications still resolve correctly.

Only when all of the above pass:

```text
GATE A: PASS
PHASE B: UNLOCKED
V7 SCORING: OFF
α / F: TBD
```

Phase B (when unlocked) still must not choose α or F; canonical skeleton remains `NOT_CALIBRATED` until Calibration Gate.

---

## Entity

A **publication** is the authoritative historical Water Score artifact.

| Field | Required | Notes |
|-------|----------|--------|
| `publicationId` | yes | Opaque id, unique, never reused |
| `clientPageId` | yes | Case Notion page id (rich_text, not a Notion relation) |
| `caseId` | no | Compact/business Case id when known |
| `publishedAt` | yes | Server ISO timestamp at create |
| `publishedScore` | yes | Numeric score as supplied; never recalculated |
| `scoreType` | yes | `quality-v3` for new publishes; `legacy-publication` for freeze-copies |
| `modelVersion` | no | Known runtime version (`quality-v3.0`) or `UNKNOWN` |
| `benchmarkVersion` | no | `UNKNOWN` / omitted unless a genuine source supplied it |
| `publicReportToken` | yes | Unique token bound to **this** publication |
| `publicationSnapshot` | yes | Frozen public-result projection (see below) |
| `idempotencyKey` | yes | Durable retry identity; not public |
| `pointerSyncState` | yes | `synced` \| `pointer_pending` |

Immutable after create: `publicationId`, `publishedScore`, `scoreType`, `modelVersion`, `benchmarkVersion`, `publishedAt`, `publicReportToken`, `publicationSnapshot`, `idempotencyKey`, `clientPageId`.

The only allowed post-create write is `pointerSyncState` (recovery).

---

## Bounded snapshot (schemaVersion 1)

JSON only. No photos, no full Case, no assessment snapshot blob.

```text
{
  schemaVersion: 1,
  publicationId,
  clientPageId,
  caseId,
  publishedScore,
  scoreType,
  modelVersion,          // string or "UNKNOWN"
  benchmarkVersion,      // string or "UNKNOWN"
  complianceStatus,      // PASS|WARNING|FAIL or null
  resultSummary,
  publishedAt,
  publicReportToken,
  reportUrl,
  readings               // optional compact {ph,tds,chlorine,turbidity,orp,do,temp}
}
```

Must serialize under Notion rich_text limits (chunked at 1900 chars). Tests reject oversized snapshots.

---

## Notion schema (ops-created database)

Env: `NOTION_SCORE_PUBLICATIONS_DATABASE_ID`  
Alias: `NOTION_PUBLICATION_LEDGER_DATABASE_ID`  
Optional: `NOTION_SCORE_PUBLICATIONS_DATA_SOURCE_ID`

Ops creates and shares the database with the integration. The app does not call `databases.create`.
Production publishing remains blocked until this variable is configured and the schema is verified.
Missing configuration returns `503 LEDGER_REQUIRED`; the application never falls back to mutable Case-only publication.

| Property | Type |
|----------|------|
| Publication ID | title |
| Client Page ID | rich_text |
| Case ID | rich_text |
| Published Score | number |
| Score Type | select (`quality-v3`, `legacy-publication`) |
| Model Version | rich_text |
| Benchmark Version | rich_text |
| Published At | date |
| Public Report Token | rich_text |
| Publication Snapshot | rich_text |
| Idempotency Key | rich_text |
| Pointer Sync State | select (`synced`, `pointer_pending`) |

Existing Case properties are **not renamed**: `Latest Water Score`, `Public Report Token`, `Report URL`, `Compliance Status`, `Result Summary`.

---

## Public identity

```text
GET /r/{token}
GET /api/report/{token}
GET /api/public/score-card/{token}
        → Publication Ledger exact token match
        → frozen snapshot score
        → Case used only for non-score display context
```

Legacy: if no ledger row exists, exact Case `Public Report Token` lookup (unchanged historical Q-V3).

Duplicate tokens → integrity error (do not pick an arbitrary row).

---

## Intents

| Intent | Behavior |
|--------|----------|
| `publish` (default) | If a publication/legacy pointer exists → return it, no score write. Else create Publication #1. |
| `republish` | Freeze legacy Case pointer onto the ledger if needed, then create a **new** publication and new token. Never mutate Publication #1. |

Retry with the same `Idempotency-Key` replays the created publication. A new republish needs a new key.

---

## Invariants

- INV-PUB-01 unique `publicationId`
- INV-PUB-02 listed fields immutable
- INV-PUB-03 republish does not mutate #1
- INV-PUB-04 republish creates #2
- INV-PUB-05 old `/r/{token}` stays on its publication
- INV-PUB-06 Case `Latest Water Score` is a pointer
- INV-PUB-07 historical score is not reconstructed from live scoring
- INV-PUB-08 `publishedScore` + `modelVersion` + `benchmarkVersion` stored, not recalculated
- INV-PUB-09 reconciliation may only update `pointerSyncState` and Case pointer fields; it cannot edit the publication snapshot or any immutable publication field
