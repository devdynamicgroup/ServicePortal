# Water Score Full Assessment Customer Parity — Decision Log

**Status:** Release commit from base `9c1c59d1`. Deployment is confirmed only when production health reports this commit.
**Base commit:** `9c1c59d1a0be8e12c512c8e3c6444f85e128945c`
**Workspace:** `D:\Service Portal-production-main`
**Inspection date:** 2026-10-09
**Implementation date:** 2026-10-09

This file is the dedicated decision record for Staff and Full Assessment point/country viewing parity. It is not an entry in `docs/quality-v3/UNRESOLVED_DECISIONS.md`. That log remains the formula and model-governance record (PD-001–PD-015). No scoring formula, weight, limit, severity rule, gate, or ceiling is selected for change here.

Implementation is recorded in this decision log. Scoring formulas, weights, limits, severity, gates, and the ceiling are unchanged.

## Approved decisions

### A1 — Point and Country gauge behavior

- Staff and Full Assessment customers use the same canonical scoring behavior for the same Point, Country, and reading set.
- All means Whole House.
- A named Point is scored using only its own readings.
- Country switching preserves the selected Point and uses the existing country scoring rules.
- An empty or incomplete Point is Unavailable. It is never 0 and never a Whole House fallback.
- Returning to All restores the Whole House score.
- Country formulas, limits, weights, severity rules, gates, and ceilings stay as they are.

### B1 — Existing publication compatibility

- Existing publications remain Whole House-only when they lack valid per-point historical readings.
- The original published score and the frozen Whole House readings stay under the existing contract.
- Historical readings are not fabricated, old publications are not backfilled, and current live readings are not substituted for missing historical data.
- Old Whole House reports stay accessible.
- When a customer selects a point that has no historical snapshot, the report shows a clear unavailable message.

### Future publications (approved design, now implemented in this worktree)

- An additive, optional per-point reading snapshot may be captured at publication time.
- The Whole House publication score and publication semantics stay as they are.
- Both `quality-v3` and `country-benchmark` stay.
- New snapshot data is immutable after publication.
- Whole House readings are never copied into a missing Point.
- The implementation record below is this design. It is not committed or deployed.

## Architecture

Case remains the aggregate root. A publication belongs to the Case. Customer remains identity only. Offer, workflow, booking, feedback, and reports stay on the Case. This design does not add a Customer-owned score, does not rename a Notion property, and does not change `POST /api/cases` or `GET /api/public/water-check-offer`. The optional point list, if later implemented, lives inside the existing Publication Snapshot JSON rich-text field. No new ledger column and no Case migration are required for A1 or B1.

## Current Production publication contract

Verified on this commit.

A publication is an append-only ledger row. `createOrReusePublication` in `services/score-publication-service.js` either replays an existing row or creates a new one. `updatePointerSyncState` updates only the pointer-sync field (`services/notion/score-publications.js`). The snapshot JSON is not rewritten after create.

`resolveScoreRequest` treats a request as country-benchmark only when `scoreType` is exactly `country-benchmark` and `standardKey` is a registered engine. Every other payload remains Quality V3.

`publicationMatchesRequest` reuses a Quality V3 or legacy row for a non-country request. A country request matches only a `country-benchmark` row with the same `standardKey`.

For a genuinely new row, the server recomputes the score from the Case’s current persisted readings:

- Quality V3: `computeCanonicalScore(job)` → `resolveScoreReadings(job)` then `computeQualityScoreDetail`.
- Country: `computeCanonicalCountryScore(job, standardKey)` → the same `resolveScoreReadings(job)` then `WaterScoreBenchmarkRegistry.calculate`.

`canonical.score === null` throws `SCORE_UNAVAILABLE` (409). A rounded mismatch throws `SCORE_MISMATCH` (409). `Number(null)` is not treated as a publishable 0. The new snapshot stores `readings: canonical.readings` from that same call, `publishedScore` as the rounded submitted score, and, for country, `standardKey`, `scorePayload.classifications`, and compliance from that same engine run.

`buildSnapshot` (`services/score-publication-snapshot.js`) writes schema version 1. `readings` is one object, compacted to finite `ph`, `tds`, `chlorine`, `turbidity`, `orp`, `do`, and `temp`. An empty compact result deletes `readings`. Country snapshots require `standardKey`. Serialized JSON must stay within `MAX_SNAPSHOT_CHARS` (1900 × 8). The snapshot is stored in the existing Notion rich-text property `Publication Snapshot`. `parseSnapshot` returns the parsed object, so unknown keys already stored in that JSON survive a read. `buildSnapshot` itself copies only the keys it knows, so a new key is stored only after `buildSnapshot` is taught to copy it.

`completeFrozenReadings` returns the reading object only when `scoreType` is `quality-v3` (all six scored keys) or `country-benchmark` (`ph`, `tds`, `turbidity`, `orp`). Legacy rows, missing readings, and incomplete sets return null.

`applyPublicationToJob` sets `result.publicationSource = 'ledger'`, copies `publishedScore` onto `result.waterScore`, and copies `snapshot.readings` onto `draft.scoreBaseReadings` when present. When `completeFrozenReadings` succeeds, `frozenTapData` writes those Whole House readings onto tap index 0 as `standardMeasurement` and strips measurement layers from every other tap. Draft field fallbacks are removed by `withoutReadingFields`. Room names and photos are kept. The comment on `frozenTapData` states that per-room history is not stored.

`freezeLegacyPointer` stores `scoreType: 'legacy-publication'` and does not store readings. A legacy score was never checked against measurements.

Idempotency: the same key returns the existing record and does not mint a second snapshot. A country key is suffixed with `::{standardKey}`. Republish with a new key creates a new row. The previous row stays.

## Current Staff scoring and point selection

Verified on this commit. Production does not yet implement A1.

The Staff gauge is the selected country engine applied to Whole House readings. `renderWaterScore` and `setScoreReferenceStandard` both call `resolveScoreReadings(job)` and then `getCountryBenchmarkScore(readings, standardKey)`. `resolvePublishScoreRequest` publishes that same Whole House country score. It does not read `S.scoreTapFilter`.

`resolveScoreReadings` merges `readingsFromTapData` (average of every tap’s `standardMeasurement`, then legacy meter/chlorine layers) with `draft.fields`, then strips implausible or invalid scored keys through `MeasurementValidator`. It does not read `scoreBaseReadings`. Explicit `null` is missing, not zero.

`setScoreTapFilter` stores the selected label and re-renders parameter rows, improvement text, and photos. It does not recalculate the gauge.

Point rows use `scoreTapRows` → `getRoomReadings`:

- `all` averages taps that pass `hasTapReadingSource`. It does not use the field-merge path inside `resolveScoreReadings`.
- A named label is resolved with `taps.indexOf(tapKey)`. If that tap has any finite reading, `readingsFromSingleTap(tap, {})` is used.
- If the named tap has no reading source, `getRoomReadings` returns a copy of the Whole House base. That is a display fallback. A1 forbids using it as the Point score.

`draft.taps` is an array of display strings. `draft.tapData[i]` is the parallel measurement object. `addTap` appends `Tap N`. `liveUpdateTapName` replaces the string at the current index. No remove or reorder function was found. Assessment persistence (`buildTapSnapshot`) stores `index` and `name` only. No tap UUID exists.

`hasTapReadingSource` is true when any finite number exists on `standardMeasurement`, `meterReadings`, or `chlorineReadings`. A partial tap is therefore “present” for row display and still incomplete for a country engine. Country engines return `incompleteBenchmarkMetadata` with `score: null` when required readings are missing (Thailand requires finite `ph`, `tds`, `turbidity`, and `orp`; chlorine may be absent and is then capped by the existing engine, not invented here). `buildComparisonScoreResult` keeps a non-finite engine score as `null`. `setScoreHeroLoading` shows `—` when `showScore` is false.

Full Assessment access, verified:

- `isFullAssessmentCase` is `pkg === 'full'`.
- `isFreeInspectionJob` is any other package. `reportHtml` serves the Essential poster. The Full Assessment page is `/score/{token}` (`api/case-flow-routes.js`).
- `lockedPublishedStandardKey` returns null for Full Assessment, so the existing country control can browse. Other public reports stay locked to `publishedReportStandardKey`.
- `public-report.js` sets `S.publicScoreView` and hides staff navigation. Share on that page forwards the page link. It does not open assessment editing.
- When the public view’s selected standard matches the published country, `resolveDisplayedScore` returns the stored integer and does not recalculate it. A Full Assessment country switch recalculates from the readings passed in, which on a frozen report are the overlaid Whole House readings.

## Audit answers

Facts below were read from this commit. Assumptions are marked.

### 1. Where does Staff currently get the selected Point’s readings?

Parameter rows: `getRoomReadings` in `src/js/flows/score.js`, called by `scoreTapRows`. A named point uses `readingsFromSingleTap` when `hasTapReadingSource` is true. Otherwise the rows copy the Whole House base.

The gauge does not use the selected Point. `setScoreTapFilter` does not rescore. The gauge and `resolvePublishScoreRequest` use `resolveScoreReadings`, which is the Whole House merge.

### 2. What function should both Staff and Full Assessment call?

No current function scores a selected Point. Both surfaces should call the existing country entry with an explicit reading set:

`getCountryBenchmarkScore(readings, standardKey)` → `buildComparisonScoreResult` → `WaterScoreBenchmarkRegistry.calculate`.

The server twin for Whole House is `computeCanonicalCountryScore`. It must remain the authority for the published Whole House integer.

Proposed shared reading choice, not present in code today:

- All, and every publish: `resolveScoreReadings(job)`.
- Named Point: that index’s own layers through `readingsFromSingleTap`, and only when `hasTapReadingSource` is true. Run the same validator strip `resolveScoreReadings` uses. If the tap has no own source, pass `{}`.
- Do not call `getRoomReadings` for the gauge. Its empty-point branch copies Whole House readings.

`score === null` stays Unavailable. Do not wrap it in `Number()`.

### 3. Does a stable Point identifier exist?

No independent identifier exists. Verified identity is the parallel index of `draft.taps[i]` and `draft.tapData[i]`. The label is mutable (`liveUpdateTapName`). `scoreTapFilter` stores the label, and `indexOf` returns the first match, so duplicate labels are ambiguous.

Inside one immutable publication, the stable identity can be the ordinal captured at publish time, stored with the label captured at that same moment. Later renames of the live Case must not be required to resolve the historical point. A new Case field or a backfilled UUID is not required for A1/B1 and is not approved.

Assumption: append-only tap order at publish time is the identity the snapshot freezes. Reorder is not implemented today. If reorder is added later, ordinals already stored in a publication stay historical and are not remapped.

### 4. Where are Point readings stored before publication?

On the Case draft: `draft.tapData[i].standardMeasurement`, with legacy `meterReadings` and `chlorineReadings`. Labels live in `draft.taps[i]`. The assessment snapshot (`src/js/assessment-snapshot.js`) persists that same pair as `index` and `name` plus the measurement objects. `draft.fields` is a Whole House fallback layer, not a Point store. `S.tapData` may supply taps only while scoring the active Case and only when `draft.tapData` is absent (`resolveJobTapDataForScore`).

### 5. Can publication capture a consistent per-point set at the same moment as the Whole House score?

Yes, from the same `job` already passed into `createOrReusePublication`, immediately beside the existing `computeCanonicalScore` / `computeCanonicalCountryScore` call. Those functions already call `resolveScoreReadings` on that job. The Case’s `draft.taps` and `draft.tapData` are on that same object. The server must derive point readings itself. The client must not submit them.

The Whole House `canonical.readings` object is not defined as the average of the point objects. It can include `draft.fields` and the validator. Point capture must not “correct” that object. `publishedScore` continues to be the Whole House score that already matched `canonical.score`.

Capture is possible only for a new row, after reuse and legacy-pointer return, and before `createLedgerRecord`. A replay must return the stored snapshot unchanged.

### 6. How are missing or invalid readings represented?

- Non-numeric values become `undefined` (`numOrUndefined`), not 0.
- Explicit `null` on a tap layer is missing and blocks sibling fallback (`readingsFromSingleTap`).
- `compactReadings` omits non-finite keys and deletes `readings` when nothing finite remains.
- Implausible or invalid scored keys are deleted before the engines run (`resolveScoreReadings`).
- Incomplete country input returns `score: null` and `reason: 'INCOMPLETE_READINGS'` (`incompleteBenchmarkMetadata`).
- Publish rejects a null canonical score with `SCORE_UNAVAILABLE`.

`getRoomReadings` does not follow that rule for an empty named point. It substitutes Whole House readings. That path is the one A1 must not use for a Point score.

### 7. Can a snapshot store optional point data without breaking existing records or idempotency?

Yes, if the new field is optional and written only while building a new snapshot.

- Existing rows have no such field. `applyPublicationToJob` ignores keys it does not read. `completeFrozenReadings` looks only at `snapshot.readings` and `scoreType`.
- `parseSnapshot` preserves extra JSON keys already stored. No new Notion property is required. The JSON remains in `Publication Snapshot`.
- Schema version stays 1. Old readers that only understand version 1 keep working. A version bump is not required and would risk rejecting old rows.
- Idempotency returns the existing record before the canonical check and does not call `buildSnapshot` again. Adding the field on the create path does not rewrite old rows.
- `publishedScore`, `scoreType`, `standardKey`, and Whole House `readings` stay the fields the current contract uses.
- Size risk: several short labels and numeric readings fit the existing 15,200-character cap. Photos, tasks, and image payloads must not be copied into this field.

### 8. How does the customer report distinguish historical snapshot data from live Case data?

`resolveReportByToken` loads the live Case and then `applyPublicationToJob`. That sets `result.publicationSource = 'ledger'`, replaces the score with `snapshot.publishedScore`, and, when frozen readings are complete, replaces tap measurement layers and strips draft reading fields. `renderWaterScore` on the public page uses that overlaid job. The public gauge uses the stored integer when the viewed standard is the published one.

There is no per-point historical marker today. After `frozenTapData`, tap 0 carries the Whole House readings, and other taps have their measurement layers removed. `getRoomReadings` then shows Whole House values for those rooms. That is why an old publication must not be treated as per-point history.

### 9. Smallest safe unavailable message for old publications, without Staff privileges

On a public report (`S.publicScoreView`) whose snapshot has no point-reading field:

- All keeps the current published score, frozen Whole House readings, and country browse already allowed for Full Assessment.
- A named point shows an explicit unavailable message and does not calculate a score.
- Do not read live `tapData` or copy tap 0’s frozen Whole House readings into that point.
- Do not add assessment editing, publish, or package changes. Essential Cases stay on the poster (`isFreeInspectionJob`). `lockedPublishedStandardKey` stays null only for `pkg === 'full'`.

The location control already exists (`renderLocationSelect`). The change is what a named selection is allowed to display, not a new Staff capability.

### 10. Which tests protect the current contract, and which new tests are necessary?

Existing tests to keep and run unchanged after any later implementation:

- `tests/publish/publication-country-benchmark.test.js`
- `tests/publish/publication-frozen-readings.test.js`
- `tests/publish/publication-availability.test.js`
- `tests/publish/publication-idempotency.test.js`
- `tests/publish/immutable-publication.test.js`
- `tests/publish/publication-store-contract.test.js`
- `tests/publish/publication-close-path.test.js`
- `tests/publish/publication-recovery.test.js`
- `tests/score/staff-country-primary.test.js`
- `tests/score/staff-country-publish.test.js`
- `tests/score/param-status-ui-mapping.test.js`
- `tests/score/displayed-score-country-switch.test.js`

New tests, not written in this phase:

- The same Point ordinal, country, and reading set produce the same score for Staff and for a Full Assessment public view.
- All uses `resolveScoreReadings` and the selected country engine. Publish still sends that Whole House country score even if a point is selected on screen.
- A named point with its own readings does not include another point’s values or `draft.fields`.
- An empty point and a point missing the engine’s required keys score `null`, not 0, and not the Whole House score. `Number(null)` is not published.
- Country switch keeps the point ordinal. Returning to All restores the Whole House score.
- An old snapshot with no point field still resolves the published Whole House score and frozen readings. Selecting a point yields the unavailable message and does not use live Case readings.
- A new snapshot may contain the optional point field. A point with no own readings is stored empty. `publishedScore` and `readings` stay the Whole House pair. `quality-v3` and `country-benchmark` both still create. Replay does not change the stored snapshot. Legacy freeze still stores no readings.
- Essential `pkg` still receives the card page, not the Full Assessment page.

## Proposed future snapshot structure

Not implemented. Proposed shape inside the existing schema version 1 snapshot:

```text
pointReadings: [
  {
    ordinal: 0,
    label: "Kitchen",
    readings: { ph, tds, chlorine, turbidity, orp, do, temp }
  },
  {
    ordinal: 1,
    label: "Tap 2",
    readings: null
  }
]
```

Rules:

- Omit `pointReadings` entirely on old rows and on any create path that cannot see `draft.tapData`. Absence means “per-point history unavailable,” not “empty house.”
- `ordinal` is the `tapData` index at publish time. `label` is `draft.taps[ordinal]` captured then.
- `readings` is that tap’s own compacted finite readings, or `null` when `hasTapReadingSource` is false. Never copy `snapshot.readings` or another point into that slot.
- `snapshot.readings` remains the Whole House set from `canonical.readings`.
- `publishedScore` remains the Whole House score. Point scores are not stored. A later view calculates them with `getCountryBenchmarkScore` on the frozen point readings and the selected country. The headline All view keeps the stored integer when the selected country is the published one.
- Do not store photos, tasks, or meter images in this field.

## Backward compatibility for old publications

- No migration and no backfill.
- Rows without `pointReadings` keep today’s Whole House overlay (`frozenTapData`, stripped fields, stored `publishedScore`).
- The Full Assessment page remains available.
- Named-point selection on those rows shows the unavailable message and does not invent readings.
- Legacy publications still have no reading history. `completeFrozenReadings` still returns null for them, so their current Case rendering behavior stays.

## Risks

- Using `getRoomReadings` for the new gauge would silently restore the Whole House fallback A1 forbids.
- Selecting by label (`indexOf`) is wrong when two points share a name. Selection for scoring must use `ordinal`.
- `frozenTapData` puts Whole House readings on tap 0. A point browser that trusts overlaid `tapData` will label the Whole House set as the first room.
- Point scores calculated at view time will move if a country engine later changes. The stored Whole House `publishedScore` will not. A1 forbids changing those engines in this work. The risk is future engine edits, not this design.
- A partial tap can be stored and still score null for a country that requires four keys. That is Unavailable, not a house score.
- Snapshot size grows with the point count. The existing character cap still applies. Photo payloads would break create.
- Staff gauge behavior changes relative to today: the gauge begins to follow the selected point. Publish must stay Whole House so the ledger contract does not change.
- `getRoomReadings('all')` and `resolveScoreReadings` are different populations. All and publish must keep `resolveScoreReadings`.

## Assumptions

- The same `job` object in `createOrReusePublication` is a consistent publication-time source for both Whole House and point readings.
- Append-only tap order is stable enough to freeze as `ordinal` for a new publication. No durable UUID is required.
- Full Assessment viewing does not need a stored per-point score integer. Frozen readings plus the existing country registry are enough.
- Keeping schema version 1 with an optional JSON key is compatible with current readers.

## Unresolved questions

These do not require a new product decision before implementation review. They are constraints the implementation must follow.

1. Duplicate labels: live selection must use ordinal, not `indexOf(label)`. The snapshot stores both.
2. A point that has some own readings but not the engine’s required set is stored with those own readings and displayed as Unavailable. It is not omitted and not filled from Whole House.
3. The unavailable copy should be a new i18n string. The existing `score.readiness.incompleteTitle` text means “still gathering readings” and must not be reused for missing history.
4. No decision is open on changing formulas, migrating old rows, or publishing a point score as `publishedScore`.

## Regression test plan

Run the existing publication and staff-country tests listed in answer 10 on this worktree after implementation. Add the new tests in that same list. Do not delete or weaken an existing assertion to make a new point test pass. Do not use a live customer Case as a fixture.

## Explicit statements

The release commit contains this implementation. Production deployment is verified only by the live health version, not by this document.

## Implementation record

### Files

- `src/js/flows/score.js` — Staff and Full Assessment gauges share `applyGaugePopulation`. All uses `resolveScoreReadings`. A named point uses `resolveOwnPointReadings` or, on a public report, frozen `result.pointReadings`. The location control values are ordinals. `resolvePublishScoreRequest` still publishes the Whole House country score.
- `src/js/i18n.js` — English and Thai copy for missing point history and for a point with no usable own readings.
- `services/canonical-score.js` — `captureCanonicalPointReadings` runs the same `capturePublicationPointReadings` function in the existing score sandbox.
- `services/score-publication-service.js` — New publications copy that point list onto the snapshot after the canonical Whole House check. Idempotent replay returns before this. The size cap can omit the list.
- `services/score-publication-snapshot.js` — Optional `pointReadings` on schema version 1. `applyPublicationToJob` copies it onto `result.pointReadings` and still overlays Whole House readings the existing way.
- `tests/score/point-country-parity.test.js` — Gauge, ordinal, empty point, parity, old publications, and read-only customer page.
- `tests/publish/publication-point-readings.test.js` — Freeze, replay, legacy, availability, mismatch, and the size fallback.

No country formula, limit, weight, severity rule, gate, or ceiling file was edited.

### Snapshot representation

Schema version stays 1. Existing rows omit the field. A new row may contain:

```text
pointReadings: [
  { ordinal: 0, label: "Kitchen", readings: { ph, tds, chlorine, turbidity, orp, do, temp } },
  { ordinal: 1, label: "Empty", readings: null }
]
```

`ordinal` is the tap index at publication time. `label` is display text, at most 80 characters. `readings` is the finite own-reading map, or `null`. Photos and tasks are not stored. `publishedScore` and `snapshot.readings` remain the Whole House pair. `quality-v3` and `country-benchmark` both use this supplemental field.

### Validation and freeze

`capturePublicationPointReadings` reads `draft.taps` and `draft.tapData` on the same Case object the canonical score just used. A tap is included only from its own `standardMeasurement`, `meterReadings`, and `chlorineReadings`. `draft.fields` are not copied into a point. The existing measurement validator strips implausible and invalid scored keys. Non-finite values are omitted. A tap with no remaining own readings is stored as `null`. The server ignores any client-supplied point list. Replay and legacy freeze do not write a new snapshot.

### Old publications

Rows without `pointReadings` keep the current Whole House overlay and stored score. On a Full Assessment report, All still shows that stored score for the published standard. A named point shows `score.pointHistory.unavailable` and a null gauge. Live taps and the tap 0 Whole House overlay are not used as that point’s score.

### Size limit

`serializeSnapshot` still rejects payloads above 15,200 characters. If the failure is caused by `pointReadings`, the publication is stored again without that field. The point list is not truncated in place. The Whole House score and readings remain. That publication then behaves as an old publication: point browsing is unavailable. If the Whole House snapshot itself exceeds the cap, creation still fails.

### Tests run on 2026-10-09

Passed, exit 0:

- `node tests/score/point-country-parity.test.js` — 21 passed, 0 failed
- `node tests/publish/publication-point-readings.test.js` — 10 passed, 0 failed
- `node tests/publish/publication-country-benchmark.test.js` — 62 passed, 0 failed
- `node tests/publish/publication-frozen-readings.test.js` — 30 passed, 0 failed
- `node tests/publish/publication-availability.test.js` — 33 passed, 0 failed
- `node tests/publish/publication-idempotency.test.js` — 7 passed, 0 failed
- `node tests/publish/immutable-publication.test.js` — PASS
- `node tests/score/staff-country-primary.test.js` — 43 passed, 0 failed
- `node tests/score/staff-country-publish.test.js` — 90 passed, 0 failed
- `node tests/score/param-status-ui-mapping.test.js` — 55 passed, 0 failed
- `node tests/score/displayed-score-country-switch.test.js` — 91 passed, 0 failed

### Limitations

- There is still no point UUID. Identity inside a publication is the frozen ordinal.
- The selected point is session state. It is not written onto the Case draft.
- `getRoomReadings` still has its previous Whole House display fallback. The gauge and the selected-point rows do not call it.
- A point the country engine cannot score shows Unavailable and blank rows. A point the engine can score from a partial own set shows that score.
- Point scores are calculated at view time from frozen readings. A later engine change would move those viewed scores. This change does not edit the engines. The stored Whole House `publishedScore` stays the published integer.
- A publication whose point list does not fit the snapshot cap has no point history.
