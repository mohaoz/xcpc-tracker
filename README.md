# XCPC-Tracker

Static, frontend-first XCPC tracker for curated contest browsing, local member coverage, and VP-before freshness checks.

## What It Does

- browse a curated XCPC contest pool
- compute local contest/problem coverage in the browser
- manage local contest/member data with import and export tools
- ship as a static site without any required backend service

## Current Stack

- Vue 3 + TypeScript
- Vite
- Pinia
- Dexie / IndexedDB
- Bundled default catalog under `catalog/`

## Repo Shape

```text
XCPC-Tracker/
  web/            shipped frontend app
  catalog/        canonical bundled catalog source
  schemas/        JSON Schema files
  scripts/        validation tools
  docs/           architecture and product notes
  fixtures/       import fixtures and samples
```

## Commands

Catalog:

```bash
npm run catalog:build-final
npm run catalog:generate-default
npm run catalog:refresh
npm run catalog:validate
```

Catalog flow:

1. Run `scripts/browser-fetch-contests.mjs` in the browser to export candidate contests into `result.json`.
2. Save the exported file as `data/contests.json`.
3. Run `npm run catalog:build-final` to build `data/final.json`.
4. Run `npm run catalog:generate-default` to build `catalog/default-catalog.min.json`.
5. Or run `npm run catalog:refresh` to execute the full chain.

Frontend:

```bash
cd web
npm install
npm run build
```

## Netlify Deploy

- GitHub repository: [mohaoz/xcpc-tracker](https://github.com/mohaoz/xcpc-tracker)
- Recommended production branch: `release`
- Build command: `npm ci --prefix web && npm run catalog:validate && npm run build --prefix web`
- Publish directory: `web/dist`
- Repo-level `netlify.toml` is included, so Netlify can use the default settings directly
- Keep day-to-day development on `main`
- Merge or push to `release` only when you want Netlify to publish a new version

## App Routes

- `/contests`: contest list with unified search, member filter, pagination, and per-problem status strips
- `/contests/:contestId`: contest detail, local coverage matrix, and metadata editor
- `/members`: tracked members and local coverage status
- `/members/new`: QOJ member import script
- `/manage`: local data import/export tools

## Related Docs

- [AGENTS.md](./AGENTS.md)
- [scripts/README.md](./scripts/README.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/project-plan.md](./docs/project-plan.md)
- [docs/mvp-design.md](./docs/mvp-design.md)
- [docs/frontend-first-pivot.md](./docs/frontend-first-pivot.md)
