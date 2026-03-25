# xcpc-vp-gather

Local-first XCPC/ACM VP gather tool for building a contest pool, syncing tracked member history, and deciding which contests or problems are worth a virtual participation.

Version: `0.1.1`

中文说明见 [README.zh-CN.md](./README.zh-CN.md).

## What It Does

- Sync Codeforces Gym contests into a local SQLite-backed pool.
- Sync tracked member problem history from Codeforces.
- Show contest-level coverage summaries for VP decisions.
- Show per-problem status strips directly in the contest list.
- Filter the contest pool by tags and pool scope.
- Re-sync contests that were imported but never fully synced.
- Keep a lightweight operation log in the Intake view.

## Current MVP Scope

- One provider: Codeforces Gym.
- One machine, one local user.
- Local web app plus localhost Python service.
- SQLite as the durable source of truth.
- Contest sync, member-history sync, coverage summary, import/export, and local browsing.

## Repo Layout

```text
xcpc-vp-gather/
  apps/
    service/   Python localhost service and CLI
    web/       Vue 3 SPA
  docs/        Architecture and design notes
  fixtures/    Provider fixtures
  packages/    Shared docs placeholders
```

## Quick Start

From the repo root:

```bash
make dev
```

This will:

- create `apps/service/.venv` if needed
- install Python dependencies for the localhost service
- install web dependencies if `apps/web/node_modules` is missing
- start the FastAPI service on `http://127.0.0.1:8000`
- start the Vue app on `http://127.0.0.1:5173`
- open the web UI when possible

## Bootstrap Only

```bash
make bootstrap
```

Force dependency refresh:

```bash
XVG_BOOTSTRAP_FORCE=1 make bootstrap
```

## Manual Development

Service:

```bash
cd apps/service
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -m uvicorn xcpc_vp_gather.main:app --reload
```

Web:

```bash
cd apps/web
npm install
npm run dev
```

## Main Views

- `/contests`: contest pool with pagination, tag filtering, pool scope, and per-problem status strips
- `/manage`: add contest, add member, import/export, sync missing contests, and operation logs
- `/contests/:contestId`: contest detail and coverage matrix
- `/members`: tracked member overview

## Typical Workflow

1. Add or import contests and members in Manage.
2. Sync tracked members when needed.
3. Use Contest Pool to scan which contests are fresh or already touched.
4. Open a contest detail page to inspect per-member coverage.

## Import And Missing Sync

If a contest card shows `0 problems`, it usually means the contest record exists locally but the contest itself was not fully synced yet. Use `Sync Missing Contests` in the Manage page to sync only contests that still have no problem rows.

## Suggested Next Phase

After `0.1.1`, the recommended next phase is not a new provider or more analytics. The highest-value work is improving sync observability and provenance: make long-running syncs show progress, clearly distinguish imported-only versus fully synced data, and surface why a contest or member view is incomplete.

## Testing

Service tests:

```bash
cd apps/service
./.venv/bin/pytest tests/test_sync_and_coverage.py tests/test_schema_init.py
```

Web build check:

```bash
cd apps/web
npm run build
```

## Related Docs

- [CHANGELOG.md](./CHANGELOG.md)
- [README.zh-CN.md](./README.zh-CN.md)
- [AGENTS.md](./AGENTS.md)
- [apps/service/README.md](./apps/service/README.md)
- [apps/web/README.md](./apps/web/README.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/mvp-design.md](./docs/mvp-design.md)
