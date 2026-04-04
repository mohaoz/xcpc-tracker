# XCPC-Tracker Project Plan

## Goal

Keep the repository aligned with a static, frontend-first XCPC tracker with curated Git data and browser-local persistence.

## Branch Policy

- `main` is the canonical branch for development, scripts, architecture notes, and planning docs.
- `release` is the Netlify deploy branch and should stay focused on files that affect build output, runtime behavior, bundled data, and minimal release-facing docs.

## Current Repo Audit

### Keep
- Vue 3 SPA foundation and route-level page structure.
- Core coverage concept: member-problem status joined against curated contest problems.
- Local member identity concept and grouped person view.
- Existing docs as rewrite targets instead of deleting all project history.
- Deterministic fixture mindset for provider/import testing.
- The idea that some data may be seeded by import and then maintained manually.

### Remove
- SQLite as the canonical runtime store for normal usage.
- Service-driven API contracts as the default data path for the SPA.
- CLI-first workflows that only make sense for backend orchestration.
- Backend-provider abstractions that assume server-side ingestion.

### Rewrite
- `AGENTS.md` to reflect the frontend-first static tracker direction.
- Root and app READMEs to stop advertising localhost-service setup as the main path.
- Architecture and MVP docs around IndexedDB, curated JSON, and import adapters.
- Frontend data access layer away from `VITE_API_BASE` and localhost endpoints.

### Migrate Gradually
- Existing Vue pages and their information architecture.
- Coverage list/detail semantics and freshness calculations.
- Useful Codeforces matching heuristics where they still apply to curated problem mapping.

## Recommended Order

1. Freeze the new architecture in repo docs and directory conventions.
2. Add catalog/schema/script scaffolding with explicit ownership.
3. Design frontend local data model and import-versus-curation boundaries.
4. Add CI checks for catalog validation, generation, and static frontend build.
5. Rewire the SPA to consume the bundled catalog JSON and IndexedDB.
6. Add Codeforces frontend import flow.
7. Add QOJ userscript-assisted import flow.
8. Keep the repository structure aligned with the shipped frontend-first product.

## Current Progress

Completed:

- architecture docs and repo direction have been rewritten
- curated catalog, schema, and script directories exist
- catalog validation scripts exist
- CI validates catalog data and builds the static frontend
- frontend now reads bundled catalog data directly
- Dexie-backed local storage is in place
- contest list and contest detail run on the frontend-first path
- local member view runs on the frontend-first path
- Codeforces member import runs in the frontend
- Codeforces contest problem sync runs in the frontend
- local contest coverage is computed in the browser

Remaining high-priority work:

- QOJ userscript-assisted import flow
- clearer provider/problem provenance and unresolved mapping handling
- documentation refresh for the current implemented UI and workflows

## Near-Term Non-Goals

- Supporting more OJs before Codeforces and QOJ flows are stable.
- Rebuilding artifact scraping in a backend.
- Shipping advanced analytics before core import and coverage views work.
