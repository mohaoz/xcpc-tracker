# XCPC-Tracker Architecture

## Assumptions

- The target product is a static, frontend-first XCPC tracker.
- The normal user flow must not require any backend service.
- Curated contest metadata lives in Git-managed JSON files.
- Codeforces member status comes from public API access in the frontend.
- QOJ member status comes from userscript-exported JSON imports.
- Browser-local persistence is the primary runtime store.

## Non-Goals

- Rebuilding a backend service as the core runtime.
- Remote multi-user backend, auth platform, or cloud sync.
- Server-side scraping for QOJ.
- Contest replay timelines, judge features, or ranking-heavy analytics before import and coverage are stable.

## System Layers

### 1. Catalog Source
- Human-edited curated contest JSON in `catalog/`.
- The built-in default catalog lives in a single bundled JSON file.
- Stores stable IDs, tags, aliases, problem definitions, and external source links.
- This is the canonical product dataset.

### 2. Validation
- Scripts validate curated JSON against JSON Schema in `schemas/`.
- CI runs validation before frontend build and deployment.

### 3. Import Inputs
- Imported data can come from Codeforces API sessions, QOJ userscript exports, or one-time tooling.
- Imported payloads are not automatically canonical source data.
- Import flows should produce normalized local runtime records and, when useful, reviewable draft catalog material.

### 4. Frontend Import Adapters
- Codeforces adapter fetches member submissions/status from the public API.
- Codeforces contest adapter fetches contest problem lists from the public API.
- QOJ adapter imports userscript-exported JSON snapshots.
- Catalog adapter loads the bundled default catalog JSON.
- Adapters preserve raw import metadata and provenance alongside normalized records.

### 5. Browser-Local Data Layer
- Dexie-backed IndexedDB is the main runtime store.
- Stores local members, imported handles, problem-status records, sync records, and import provenance.
- Stores contest problem snapshots, resolved provider-problem mappings, and local coverage inputs.

### 6. Vue SPA
- Renders curated contest browsing, member coverage, and import workflows.
- Reads curated dataset and local status data to compute VP-before freshness views.
- Supports import/export of browser-local member state.
- Can be hosted as a static site without any companion service.

## Runtime Data Flow

1. Curated contests are authored in `catalog/`.
2. Optional import flows produce runtime data and, when needed, draft metadata for review.
3. Scripts validate the catalog bundle against repo rules and schema.
4. The static site ships with the bundled default catalog as a static asset.
5. The browser loads the default catalog and stores catalog snapshots in Dexie.
6. Codeforces API imports refresh local member-problem status and can also refresh contest problem snapshots.
7. QOJ userscript JSON imports will refresh additional member-problem status records.
8. Coverage views join locally cached contest problems with local member status records.

## Why This Architecture

### Static Frontend
- Matches the narrowed product shape better than a local control-plane service.
- Simplifies deployment, distribution, and onboarding.
- Keeps the normal runtime entirely inside the browser.

### IndexedDB
- Fits local-only runtime persistence without introducing a backend dependency.
- Supports structured data, indexes, and versioned migrations.
- Makes import/export of local member state straightforward.

### Dexie
- Provides a much cleaner browser-local database layer than raw IndexedDB wrappers.
- Fits the project well once multiple stores, joins, and import flows exist.
- Keeps frontend import and coverage code readable while staying entirely local.

### Git-Managed Catalog
- Keeps curated contest metadata reviewable and versioned.
- Avoids a hidden mutable database for canonical contest definitions.
- Supports generated indexes and automated validation in CI.

### Frontend Adapters Instead Of Backend Providers
- Matches the new source model: public API in-browser and userscript JSON imports.
- Makes runtime dependencies explicit at the UI layer where the user triggers them.
- Avoids carrying forward server-oriented abstractions that no longer fit.

## Tradeoffs

- Browser-only persistence is simpler for users but requires careful import/export for backup.
- Codeforces API access in the frontend is easy to distribute but may need rate-limit-aware batching.
- QOJ userscript import avoids a backend scraper, but the workflow is intentionally semi-manual.
- Generated indexes improve load performance, but introduce a build step that must stay deterministic.

## Current State

- Contest list, contest detail, member list, and manage tools run on the frontend-first path.
- Catalog validation and generation are handled by repo-level scripts.
- Codeforces contest and member sync run directly in the browser.
- Contest list filters are stored locally in app state rather than in URL query parameters.
