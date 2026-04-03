# Frontend-First Pivot

## Current repo audit

### Keep
- `web` Vue 3 SPA shell, router, and current page-level information architecture.
- Coverage concepts already present in contest list and contest detail views.
- Local member grouping concepts from the current member list.
- Existing fixtures and deterministic-testing mindset.
- Useful Codeforces domain knowledge and matching heuristics from the service layer.

### Remove
- Python localhost service as the expected runtime dependency.
- SQLite-backed local API as the normal data source for the SPA.
- Backend provider orchestration as the central ingestion model.
- CLI-first contest/member sync workflows in the product surface.

### Rewrite
- Architecture docs and contributor instructions.
- Frontend data access layer so it reads the bundled default catalog and IndexedDB instead of localhost API endpoints.
- Runtime data model around browser-local entities and import provenance.
- Build and release workflow around dataset validation and static deployment.

### Migrate gradually
- Existing contest list, detail, and member views.
- Coverage and freshness business concepts.
- Useful export/import shapes from the current app where they still fit local browser backup flows.
- Select backend parsing or matching logic, but only after moving it into frontend/tooling-appropriate modules.

## Keep / Remove / Rewrite / Migrate

### Keep
- Vue 3 + TypeScript frontend stack.
- Contest coverage UX patterns.
- Local member identity as a first-class concept.
- Codeforces as the first fully supported live data source.

### Remove
- FastAPI as a required runtime dependency.
- Service-owned DTOs as the primary contract surface.
- Runtime assumption that browser storage is cache only.

### Rewrite
- Repo layout narrative.
- Data ownership model.
- Import pipeline boundaries.
- CI/CD expectations.

### Migrate
- Old service export/import logic into one-time scripts where useful.
- Current curated concepts like aliases and tags into Git catalog files.
- Current status-merging heuristics into frontend import matchers.

## Target architecture

### Runtime
- Static Vue 3 + TypeScript app.
- Bundled default catalog JSON served as a static asset.
- IndexedDB for local members, status, sync history, and provenance.
- Direct Codeforces public API access from the browser.
- QOJ userscript JSON import through explicit user action.

### Build-time
- JSON Schema validation for curated catalog files.
- Frontend build using the bundled default catalog asset.
- Static deployment through GitHub Actions or similar CI.

### Current repository shape
- The shipped product lives in `web` plus repo-level catalog, schema, and script directories.
- Old backend-runtime code is not part of the active architecture.

## New data layout

### Repo directories

```text
catalog/default-catalog.min.json
schemas/
  contest.schema.json
  qoj-import.schema.json
  codeforces-import.schema.json
fixtures/
  imports/
    codeforces/
    qoj/
scripts/
  validate-catalog.*
  generate-catalog.*
```

### Ownership rules

- `catalog/` is the canonical hand-edited source of truth.
- imported payloads belong in runtime storage or fixture/sample areas, not in `catalog/` unless they are manually normalized first.
- import flows may generate reviewable drafts, but they should not silently overwrite curated files.
- a user-saved QOJ contests HTML or MHT export may be normalized into baseline contest stubs and then promoted into `catalog/` intentionally.

### Curated contest file shape

Recommended top-level fields:

- `id`
- `title`
- `aliases`
- `tags`
- `start_at`
- `curation_status`
- `sources`
- `problems`
- `notes`

Recommended `sources` item fields:

- `provider`
- `kind`
- `url`
- `provider_contest_id`

Recommended `problems` item fields:

- `id`
- `ordinal`
- `title`
- `aliases`
- `sources`

Rules:

- The built-in default catalog is stored as a single bundled JSON file.
- Human-edited files stay under `catalog/`.
- Frontend should consume the bundled default catalog directly for built-in data.
- `curation_status` allows us to carry partial curated contests during migration, for example contest metadata present but problem list not finished yet.
- `aliases` should store normal alternative titles or well-known formal names, not old console-oriented short codes.
- provider-only shorthand should stay in `sources` metadata rather than becoming the primary human-facing alias model.

## Frontend local data model

### TypeScript entities

```ts
type ContestRecord = {
  contestId: string;
  title: string;
  aliases: string[];
  tags: string[];
  problemIds: string[];
  sources: SourceRef[];
  catalogVersion: string;
};

type ProblemRecord = {
  problemId: string;
  contestId: string;
  ordinal: string;
  title: string;
  aliases: string[];
  sources: SourceRef[];
};

type MemberRecord = {
  memberId: string;
  displayName: string;
  handles: MemberHandleRecord[];
  createdAt: string;
  updatedAt: string;
};

type MemberProblemStatusRecord = {
  memberId: string;
  problemId: string;
  provider: "codeforces" | "qoj";
  status: "solved" | "attempted";
  firstSeenAt: string;
  lastSeenAt: string;
  sourceRecordId: string;
  matchMethod: "provider_id" | "contest_ordinal" | "alias" | "manual";
};

type SyncRecord = {
  syncId: string;
  sourceRecordId: string;
  adapter: "catalog" | "codeforces_api" | "qoj_userscript";
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed";
  summaryJson: Record<string, unknown>;
};

type ImportSourceRecord = {
  sourceRecordId: string;
  kind: "catalog" | "codeforces_api" | "qoj_userscript_json";
  label: string;
  importedAt: string;
  rawMetaJson: Record<string, unknown>;
};
```

### IndexedDB stores

- `catalog_contests`
- `catalog_problems`
- `members`
- `member_handles`
- `member_problem_status`
- `import_sources`
- `sync_records`
- `problem_match_cache`

Indexes to prioritize:

- contest by tag
- problem by contest id
- member handles by provider and handle
- status by member id
- status by problem id
- status by provider plus external reference
- sync records by adapter and time

### Import/export boundaries

- Curated catalog import is read-only from bundled static JSON assets.
- Member/runtime export should serialize members, handles, statuses, and provenance from IndexedDB.
- Member/runtime import should support restoring that export into IndexedDB.
- QOJ import accepts userscript JSON snapshots, validates them, and persists raw metadata plus normalized records.
- Contest metadata imports should produce draft candidates or helper material for curators, not direct canonical writes.

## Import pipeline design

### Catalog importer
- Loads the bundled default catalog JSON.
- Refreshes `catalog_contests` and `catalog_problems` stores.
- Writes a catalog provenance/import record with version or commit metadata.

### Codeforces API adapter
- Fetches member submissions or status-relevant public API data from the browser.
- Normalizes provider problem references.
- Maps provider references to curated contest/problem IDs.
- Upserts member handles, statuses, source metadata, and sync records.
- Handles rate limits with local batching and retry-aware UX.

### QOJ userscript adapter
- Tracker site opens `https://qoj.ac/?xvg_sync=1...`.
- Installed userscript detects sync mode.
- Userscript reads requested handles or batch payload from the URL or pasted config.
- Userscript collects profile/problem status data and exports structured JSON.
- User imports that JSON back into the tracker app.
- App validates snapshot shape, stores raw provenance, and maps statuses to curated problems.

### Matching strategy

Order of confidence:

1. Explicit provider problem ID match from curated source metadata.
2. Contest source match plus problem ordinal.
3. Contest title/alias plus problem title alias.
4. Manual unresolved review queue if ambiguity remains.

## CI/CD design

### Validate
- Lint or schema-check every curated contest JSON file.
- Validate import example fixtures against JSON Schema.
- Fail CI on duplicate IDs, malformed source refs, or generated output drift.

### Generate
- Build aggregated contest indexes and per-contest generated payloads.
- Optionally emit lightweight search/filter helpers for frontend use.
- Keep generation deterministic so CI can diff outputs cleanly.

### Build
- Install frontend dependencies.
- Run TypeScript checks and static build.
- Ensure generated assets are included in the build output.

### Deploy
- Publish the static site to GitHub Pages, Netlify, or similar.
- Treat catalog validation and generation as required pre-deploy steps.
- Avoid any deployment dependency on Python service availability.

## Phased migration plan

### Phase 1: Direction reset
- Rewrite docs and contributor rules.
- Add new top-level data/tooling directories.
- Define schemas, generated artifacts, and frontend local data model.

### Phase 2: Catalog foundation
- Add first curated contest JSON files.
- Implement schema validation and index generation scripts.
- Serve the bundled default catalog asset from the frontend.

### Phase 3: Frontend local store
- Introduce IndexedDB data layer and repository helpers.
- Load catalog data into browser-local stores or cache as needed.
- Rewire list/detail/member views away from localhost API.

### Phase 4: Import adapters
- Add Codeforces API import flow.
- Add QOJ userscript import contract and local import UI.
- Persist sync provenance and unresolved matches.

### Phase 5: Remove legacy runtime assumptions
- Stop documenting `make dev` as the main product path.
- Remove legacy backend code once the frontend-only path is stable.
- Delete backend-only abstractions that no longer serve build-time needs.

## Recommended first patch set

- Rewrite `AGENTS.md` around the new product direction.
- Rewrite repo-level architecture docs and plan docs.
- Keep `catalog/`, `schemas/`, and `scripts/` focused on the shipped frontend.
- Document curated file shape, IndexedDB schema, importer boundaries, and CI/CD flow.
- Leave application runtime code unchanged in this first pass.
