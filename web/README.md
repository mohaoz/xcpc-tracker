# web

Vue 3 SPA for the static, local-first XCPC tracker.

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
  local workspace for catalog import/export and default catalog import
- `/contests/:contestId`
  contest detail and coverage matrix
- `/members`
  tracked member overview
- `/members/new`
  QOJ member import script

## Notes

- the frontend reads the bundled default catalog from `catalog/default-catalog.min.json`
- runtime state lives in Dexie / IndexedDB
