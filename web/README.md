# web

Vue 3 SPA for the static, frontend-first XCPC tracker.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

From the repo root:

```bash
npm ci --prefix web
npm run catalog:generate-web-assets
npm run build --prefix web
```

## Current Views

- `/contests`
  contest pool with unified search, member filter, pagination, and per-problem status strips
- `/manage`
  local member import and export
- `/contests/:contestId`
  contest detail, coverage matrix, and metadata editor
- `/members`
  tracked member overview with Codeforces sync and a one-run QOJ batch update script
- `/members/new`
  add member by Codeforces handle or start the QOJ import flow

## Notes

- the frontend reads the bundled default catalog and generated static assets from `catalog/`
- runtime state lives in Dexie / IndexedDB
- contest data is curated/imported locally; the frontend does not provide contest-side online sync
- member-side Codeforces sync is still available in the browser
- member-side QOJ refresh generates a console script for every currently linked QOJ handle; it runs inside the user's QOJ browser session and returns one batch JSON payload for `/manage`
