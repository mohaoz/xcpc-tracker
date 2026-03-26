# xcpc-vp-gather

This repository is pivoting from a localhost-service-first VP gather tool into a static, frontend-first XCPC tracker.

Version: `0.2.0-planning`

中文说明后续会按新方向更新；当前以仓库内架构文档为准。

## Product Direction

The target product is an `xcpc-tracker`-style site that:

- browses a curated subset of XCPC-like contests
- shows contest/problem coverage for selected members
- imports Codeforces member status through public API access in the frontend
- imports QOJ member status through userscript-exported JSON snapshots
- consumes curated contest and artifact metadata from Git-managed JSON files
- deploys as a static site on GitHub Pages, Netlify, or similar

The curated dataset is expected to support two inputs:

- hand-edited canonical catalog files
- imported raw or semi-normalized data that helps produce reviewable catalog drafts

## Current Transition Status

This repository still contains the old Python localhost service and service-oriented docs from `0.1.1`, but the repo direction has changed.

The current migration priorities are:

- move architecture docs to frontend-first and static-data-first assumptions
- introduce curated dataset directories and schemas
- design IndexedDB as the main runtime store
- replace localhost API assumptions with frontend adapters/importers
- phase out the Python backend from normal usage

## Target Repo Shape

```text
xcpc-vp-gather/
  apps/
    web/          Vue 3 + TypeScript static app
    service/      legacy migration/tooling code only during transition
  catalog/        human-edited curated contest metadata
  generated/      derived indexes and aggregated JSON for frontend consumption
  schemas/        JSON Schema files for catalog/import validation
  scripts/        validation, generation, and migration scripts
  docs/           architecture, migration plan, and product notes
  fixtures/       provider/import fixtures and sample payloads
```

## New Runtime Model

- Frontend: Vue 3 + TypeScript
- Persistence: Dexie-backed IndexedDB in the browser
- Curated data: versioned JSON files in Git
- Canonical source of truth: hand-edited `catalog/`
- Live imports: Codeforces public API and QOJ userscript JSON
- Imported data: candidate input for local runtime state or curated draft generation
- Deployment: static hosting
- Backend: not required for normal usage

## Current Implemented Path

The current frontend-first path is already working for the main loop:

- curated contests load from generated static JSON
- catalog snapshots are cached into Dexie
- Codeforces member status imports run directly in the frontend
- Codeforces contest problem lists can be synced directly in the frontend
- contest coverage is computed locally from contest problems plus imported member statuses
- contest list and contest detail pages no longer require the localhost API

The remaining legacy area is mostly the old Python service code that still lives in the repository during transition.

## Immediate Plan

1. Finalize architecture and migration docs.
2. Introduce catalog/schema/generated/script directory conventions.
3. Build frontend data adapters around curated JSON and IndexedDB.
4. Remove or reduce the localhost backend once the frontend import loop is in place.

## Current Tooling Commands

Catalog:

```bash
npm run catalog:validate
npm run catalog:generate
```

Frontend:

```bash
cd apps/web
npm run build
```

Current CI validates catalog JSON, regenerates derived catalog artifacts, and then builds the frontend.

Current frontend runtime pages:

- `/contests`: static catalog list plus local coverage summary strips
- `/contests/:id`: local contest coverage matrix with Codeforces problem sync
- `/members`: local Dexie-backed member view
- `/manage`: local workspace for catalog refresh, Codeforces import, and runtime backup

## Related Docs

- [AGENTS.md](./AGENTS.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/project-plan.md](./docs/project-plan.md)
- [docs/mvp-design.md](./docs/mvp-design.md)
- [docs/frontend-first-pivot.md](./docs/frontend-first-pivot.md)
