# apps/web

Vue 3 SPA for the local VP console.

Version: `0.1.1`

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

## API Base

The SPA reads `VITE_API_BASE`.

Default:

```text
http://127.0.0.1:8000
```

## Current Views

- `/contests`
  contest pool with tag filters, pool scope, pagination, and per-problem status strips
- `/contests/intake`
  contest intake, import/export, sync missing contests, and operation logs
- `/contests/:contestId`
  contest detail and coverage matrix
- `/members`
  tracked member overview

## Notes

- the frontend never scrapes OJ pages directly
- durable data stays in the Python service and SQLite
- browser-side state is UI cache only
