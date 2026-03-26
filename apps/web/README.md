# apps/web

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
  local workspace for catalog import/export, default catalog import, and one-click sync
- `/contests/new`
  add a contest into local catalog
- `/contests/:contestId`
  contest detail and coverage matrix
- `/members`
  tracked member overview
- `/members/new`
  import a member from Codeforces

## Notes

- the frontend consumes a generated static catalog bundle from `generated/catalog.json`
- runtime state lives in Dexie / IndexedDB
- the frontend talks to Codeforces public API directly for member and contest sync
