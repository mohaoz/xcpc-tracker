# xcpc-vp-gather Project Plan

## Goal

Move the repository from a localhost-service-first VP gather MVP to a static, frontend-first XCPC tracker with curated Git data and browser-local persistence.

## Current Repo Audit

### Keep
- Vue 3 SPA foundation and route-level page structure.
- Core coverage concept: member-problem status joined against curated contest problems.
- Local member identity concept and grouped person view.
- Existing docs as rewrite targets instead of deleting all project history.
- Deterministic fixture mindset for provider/import testing.
- The idea that some data may be seeded by import and then maintained manually.

### Remove
- Python localhost service as the primary runtime architecture.
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
- Legacy backend code that may help bootstrap fixtures, exports, or one-time migration scripts.

## Recommended Order

1. Freeze the new architecture in repo docs and directory conventions.
2. Add catalog/schema/generated/script scaffolding with explicit ownership.
3. Design frontend local data model and import-versus-curation boundaries.
4. Add CI checks for catalog validation, generation, and static frontend build.
5. Rewire the SPA to consume generated catalog JSON and IndexedDB.
6. Add Codeforces frontend import flow.
7. Add QOJ userscript-assisted import flow.
8. Remove or archive the Python backend from normal development workflows.

## Current Progress

Completed:

- architecture docs and repo direction have been rewritten
- curated catalog, schema, generated, and script directories exist
- catalog validation and generation scripts exist
- CI validates catalog data and builds the static frontend
- frontend now reads generated contest data directly
- Dexie-backed local storage is in place
- contest list and contest detail run on the frontend-first path
- local member view runs on the frontend-first path
- Codeforces member import runs in the frontend
- Codeforces contest problem sync runs in the frontend
- local contest coverage is computed in the browser

Remaining high-priority work:

- QOJ userscript-assisted import flow
- clearer provider/problem provenance and unresolved mapping handling
- cleanup or archival of the old Python service path
- documentation refresh for the current implemented UI and workflows

## Near-Term Non-Goals

- Supporting more OJs before Codeforces and QOJ flows are stable.
- Rebuilding artifact scraping in a backend.
- Shipping advanced analytics before core import and coverage views work.
