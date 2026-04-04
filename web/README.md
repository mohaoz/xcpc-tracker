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

```bash
npm run build
```

## Current Views

- `/contests`
  contest pool with unified search, member filter, pagination, and per-problem status strips
- `/manage`
  one-click init plus local contest/member import and export
- `/contests/:contestId`
  contest detail, coverage matrix, and metadata editor
- `/members`
  tracked member overview with Codeforces sync
- `/members/new`
  add member by Codeforces handle or start the QOJ import flow

## Notes

- the frontend reads the bundled default catalog from `catalog/default-catalog.min.json`
- runtime state lives in Dexie / IndexedDB
- contest data is curated/imported locally; the frontend does not provide contest-side online sync
- member-side Codeforces sync is still available in the browser
