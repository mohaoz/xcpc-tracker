# apps/service

Python localhost service for provider acquisition, normalization, SQLite persistence, coverage summaries, import/export, and the local API.

Version: `0.1.1`

## Responsibilities

- Sync contest metadata and problems from Codeforces Gym
- Sync tracked member problem history
- Maintain `contest_coverage_summary` read models
- Expose localhost API endpoints for the SPA
- Support import/export and CLI validation flows

## Setup

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
```

## Run Tests

```bash
./.venv/bin/pytest tests
```

Targeted checks:

```bash
./.venv/bin/pytest tests/test_sync_and_coverage.py tests/test_schema_init.py
```

## Run The API

```bash
./.venv/bin/python -m uvicorn xcpc_vp_gather.main:app --reload
```

Default local API:

```text
http://127.0.0.1:8000
```

## Useful CLI Commands

```bash
./.venv/bin/xvg --help
./.venv/bin/xvg contest sync https://codeforces.com/gym/615540 --alias ccinv25db --tag "ccpc inv. 2025" --tag "东北"
./.venv/bin/xvg contest list
./.venv/bin/xvg contest list --with-coverage
./.venv/bin/xvg contest annotate 615540 --alias ccinv25db --tag "ccpc inv. 2025" --tag "东北"
./.venv/bin/xvg contest export --output ./xvg-contests.json
./.venv/bin/xvg contest import ./xvg-contests.json --sync
./.venv/bin/xvg member sync alice tourist
./.venv/bin/xvg member list
./.venv/bin/xvg coverage ccinv25db
./.venv/bin/xvg config export --output ./xvg-config.json
./.venv/bin/xvg config import ./xvg-config.json
```

## Notes On Imported But Unsynced Contests

If a contest exists in `contest` but still has no `problem` rows, the web UI may show `0 problems`. The SPA now exposes a `Sync Missing Contests` action that only syncs those contests.

## Optional Codeforces Credentials

You can provide Codeforces API credentials through environment variables:

```bash
export XVG_CODEFORCES_API_KEY="your_key"
export XVG_CODEFORCES_API_SECRET="your_secret"
```

Notes:

- credentials are optional
- credentials are read from environment variables only
- credentials are not exported by config export flows
- authenticated requests may help some API access patterns, but they do not guarantee that every Gym contest is syncable

## API Surface In Current MVP

- `GET /api/contests`
- `POST /api/contests/sync`
- `POST /api/contests/sync-missing`
- `POST /api/contests/annotate`
- `GET /api/contests/:contestId`
- `GET /api/contests/:contestId/coverage`
- `GET /api/members`
- `POST /api/members/problem-status/sync`
- import/export endpoints for contests and config

Prefer `./.venv/bin/...` for all service commands instead of relying on global Python tools.
