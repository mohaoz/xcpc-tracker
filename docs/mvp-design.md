# xcpc-vp-gather MVP Design

## 1. Overall Technical Architecture

### Assumptions
- v1 supports one OJ only, and that provider is Codeforces Gym; every persisted record and provider contract still keeps `provider_key`.
- The product is local-first and single-user.
- The service can read pages and downloads the user can already access through their local browser session.
- Codeforces official API is preferred whenever it exposes the needed field.
- MVP answers a VP decision question, not a full contest replay question.

### Why These Choices

#### Vue 3 SPA
- Best fit for a local operations console: router, state tooling, component ecosystem, and fast iteration.
- Keeps frontend focused on visibility and task control, not acquisition.
- Easy to package later without changing architecture.

#### Python Localhost Service
- Natural fit for orchestration, SQLite, filesystem, parsing, and Playwright Python.
- Keeps acquisition and persistence in one runtime.
- Easier to test provider parsers and normalization in a deterministic way.

#### Playwright Python
- Handles authenticated read-only browsing for statement pages, PDFs, editorials, and other assets the API does not expose.
- Supports persistent contexts, downloads, screenshots, and page snapshots for fixture capture.
- Gives one supplemental acquisition substrate for Codeforces now and future providers later.

#### SQLite
- Correct local system-of-record for metadata and task state.
- Transactional, portable, inspectable, and enough for v1 scale.
- Avoids running a separate database service.

#### Local Artifact Cache
- PDF, HTML snapshot, and downloaded editorial assets belong on disk.
- Disk cache reduces DB bloat and supports manual inspection and parser replay.
- SQLite stores metadata, integrity fields, provenance, and local path only.

### Layering

#### provider / acquisition
- OJ-specific API clients, browser automation, light parsing, raw payload capture.
- No business read-model assembly.

#### normalization
- Converts provider DTOs into canonical entities and relationship edges.
- Maintains normalized per-member per-problem historical status for fast local joins.
- Preserves raw source payloads for audit/debug.

#### service / task orchestration
- Runs jobs, de-duplicates work, persists task state, manages retries and file cache.

#### local API
- Exposes localhost endpoints for UI reads and task triggers.
- Returns stable DTOs independent of provider internals, including contest coverage matrices and freshness summaries.

#### SPA
- Displays dashboards and details, triggers sync, polls task status.
- Browser storage caches only UI/session state.

### Boundaries And Tradeoffs
- For the VP tool, member-history sync is the primary model because the core question is whether tracked members solved or tried a problem before VP.
- For Codeforces Gym, direct API calls still cover contest metadata and can optionally enrich status, but they should not force the whole product into a contest-submission-centric design.
- Browser automation is slower than direct APIs, but remains necessary for statement/editorial/page-derived assets and for future providers with weaker APIs.
- SQLite is ideal for local durability; large binaries still stay out of DB.
- Provider isolation costs some boilerplate, but prevents core-layer contamination once provider count grows.

## 2. Monorepo Directory Structure

### Proposed Structure
```text
xcpc-vp-gather/
  AGENTS.md
  README.md
  .gitignore
  docs/
    architecture.md
    mvp-design.md
  apps/
    web/
      src/
      public/
      tests/
    service/
      src/
        xcpc_vp_gather/
          api/
          core/
          db/
          models/
          providers/
          services/
          tasks/
      tests/
  packages/
    schemas/
    api-contract/
  fixtures/
    providers/
      <provider_key>/
        api/
        html/
        pdf/
  var/
    sqlite/
    artifacts/
    browser-state/
    logs/
```

### Directory Rules
- `apps/web`: Vue 3 SPA only.
- `apps/service`: Python localhost service only.
- `packages/schemas`: shared canonical schema docs and example payloads, not runtime scraping logic.
- `packages/api-contract`: OpenAPI or typed DTO definitions shared across layers.
- `fixtures/providers/*`: deterministic test inputs and expected normalized outputs.
- `fixtures/providers/codeforces/api`: raw JSON fixtures from official Codeforces API.
- `fixtures/providers/codeforces/html`: statement/editorial/resource page fixtures.
- `var/*`: runtime data, never committed.

### Naming Conventions
- Python package root: `xcpc_vp_gather`.
- Provider key examples: `domjudge`, `codeforces`, `pc2mirror`; use lowercase `snake_case`.
- Artifact kinds: controlled enum names, not free-form labels.

## 3. Minimal Viable Data Model And Tables

### Design Principles
- Internal rows use stable local IDs.
- External identity always includes `provider_key` and provider-scoped external ID.
- Raw payload retention is allowed at entity or ingestion-event level for debugging.
- Large files stay on disk; DB stores metadata and path.
- MVP query paths should read from a precomputed member-problem status cache rather than scan raw submissions on every contest view.

### Core Tables

#### `contest`
- `id` TEXT PRIMARY KEY
- `provider_key` TEXT NOT NULL
- `provider_contest_id` TEXT NOT NULL
- `slug` TEXT
- `title` TEXT NOT NULL
- `official_url` TEXT
- `start_time` TEXT
- `end_time` TEXT
- `timezone` TEXT
- `source_payload_json` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- Unique: (`provider_key`, `provider_contest_id`)

#### `problem`
- `id` TEXT PRIMARY KEY
- `provider_key` TEXT NOT NULL
- `provider_problem_id` TEXT NOT NULL
- `contest_id` TEXT NOT NULL
- `problem_code` TEXT
- `title` TEXT NOT NULL
- `ordinal` TEXT
- `official_url` TEXT
- `statement_url` TEXT
- `source_payload_json` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- Unique: (`provider_key`, `provider_problem_id`)

#### `artifact`
- `id` TEXT PRIMARY KEY
- `provider_key` TEXT NOT NULL
- `owner_type` TEXT NOT NULL
- `owner_id` TEXT NOT NULL
- `artifact_kind` TEXT NOT NULL
- `title` TEXT
- `source_url` TEXT
- `local_path` TEXT
- `mime_type` TEXT
- `checksum_sha256` TEXT
- `status` TEXT NOT NULL
- `is_public` INTEGER NOT NULL DEFAULT 0
- `metadata_json` TEXT
- `source_payload_json` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

#### `submission`
- `id` TEXT PRIMARY KEY
- `provider_key` TEXT NOT NULL
- `provider_submission_id` TEXT NOT NULL
- `problem_id` TEXT NOT NULL
- `contest_id` TEXT
- `identity_binding_id` TEXT
- `submitted_at` TEXT
- `verdict` TEXT
- `language` TEXT
- `score` REAL
- `is_solved` INTEGER NOT NULL DEFAULT 0
- `source_url` TEXT
- `source_payload_json` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- Unique: (`provider_key`, `provider_submission_id`)

#### `member_problem_status`
- `id` TEXT PRIMARY KEY
- `provider_key` TEXT NOT NULL
- `local_member_key` TEXT NOT NULL
- `identity_binding_id` TEXT
- `problem_id` TEXT NOT NULL
- `provider_problem_id` TEXT NOT NULL
- `status` TEXT NOT NULL
- `last_source_kind` TEXT NOT NULL
- `source_url` TEXT
- `source_payload_json` TEXT
- `first_seen_at` TEXT NOT NULL
- `last_seen_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- Unique: (`provider_key`, `local_member_key`, `provider_problem_id`)

#### `identity_binding`
- `id` TEXT PRIMARY KEY
- `provider_key` TEXT NOT NULL
- `provider_user_id` TEXT
- `provider_handle` TEXT
- `local_member_key` TEXT NOT NULL
- `display_name` TEXT
- `binding_status` TEXT NOT NULL
- `source_payload_json` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- Unique: (`provider_key`, `local_member_key`, `provider_handle`)

### Supporting Tables

#### `task_run`
- Tracks local job execution, state, step, error, and timestamps.

#### `task_event`
- Append-only task log for UI progress and debugging.

#### `sync_cursor`
- Stores per-provider checkpoints such as last sync time or opaque tokens.

#### `vp_session` 
- Optional later table for recording a local VP run and post-VP upsolve outcomes.

### Deliberate Omissions
- No user/account table.
- No remote permission model.
- No source-code blob table.
- No generalized search index table in v1.
- No full contest replay model as a primary product requirement.

## 4. Provider Interface

### Goals
- v1 implements one provider, but the contracts are provider-keyed from day one.
- Provider returns acquisition results and light normalization only.
- Provider does not assemble UI DTOs or make cross-provider business decisions.
- Provider should expose the cheapest reliable path for member-history sync when available.

### Python Interface Sketch
```python
from dataclasses import dataclass
from typing import Iterable, Protocol


@dataclass
class ProviderContext:
    provider_key: str
    browser_state_dir: str
    artifact_root: str
    now_iso: str


@dataclass
class ProviderContestRef:
    provider_key: str
    provider_contest_id: str
    contest_url: str | None = None


@dataclass
class ProviderProblemRef:
    provider_key: str
    provider_problem_id: str
    provider_contest_id: str
    problem_url: str | None = None


class Provider(Protocol):
    provider_key: str

    async def sync_contest(
        self, ctx: ProviderContext, ref: ProviderContestRef
    ) -> "ContestSyncResult": ...

    async def sync_member_problem_status(
        self, ctx: ProviderContext, binding: "IdentityBindingRef"
    ) -> "MemberProblemStatusSyncResult": ...

    async def fetch_problem_resources(
        self, ctx: ProviderContext, problems: Iterable[ProviderProblemRef]
    ) -> "ProblemResourceBatchResult": ...

    async def download_artifact(
        self, ctx: ProviderContext, artifact_id: str
    ) -> "ArtifactDownloadResult": ...

    async def sync_submissions(
        self, ctx: ProviderContext, contest: ProviderContestRef
    ) -> "SubmissionSyncResult": ...
```

### Provider Output Rules
- Return provider-scoped IDs and URLs.
- Include raw response/page metadata needed for debugging.
- Allow partial success per problem/artifact.
- Do not write directly to SPA-facing read models.
- If provider cannot produce reliable submission timelines, it must still try to produce reliable member-problem solved/tried states.

### Codeforces v1 Mapping
- `contest.list?gym=true`: discover or validate Gym contests.
- `contest.standings`: fetch contest metadata and normalized problem list for a Gym contest.
- `user.status`: primary source for tracked-member historical problem status in MVP.
- `contest.status`: optional enrichment source for contest-specific debugging or later replay-like features.
- Browser automation: fetch problem statements, downloadable PDFs when present, official/editorial/public solution links, and page-derived metadata.

### First Provider Boundary
- Implement one concrete provider under `apps/service/src/xcpc_vp_gather/providers/<provider_key>/`.
- Any helper that contains selectors, URL rules, or parsing assumptions for that OJ stays inside that subtree.

## 5. Local Task Flows

### `synchronize_contest`
- Input: `provider_key`, `provider_contest_id` or contest URL.
- Steps:
  1. Resolve provider and normalize contest reference.
  2. For Codeforces, call `contest.standings` first and use page parsing only for missing metadata.
  3. Upsert `contest`.
  4. Extract problems and upsert `problem`.
  5. Emit task events and next-step recommendations.
- Output: contest snapshot and discovered problem count.

### `sync_member_problem_status`
- Input: `identity_binding_id` or tracked member key.
- Steps:
  1. Resolve provider binding and sync strategy.
  2. For Codeforces, call user-centric endpoints and aggregate historical status per problem.
  3. Upsert `member_problem_status`.
  4. Update cursors and emit status counts: solved, tried, unseen-not-materialized.
- Output: member history delta and freshness timestamp.

### `fetch_problem_resources`
- Input: `contest_id` or problem IDs.
- Steps:
  1. For each Codeforces problem, open problem and related pages as needed and acquire statement/editorial/resource links.
  2. Upsert `artifact` metadata rows with `pending` or `available`.
  3. Optionally queue direct downloadable artifacts.
- Output: artifact inventory per problem.

### `download_pdf`
- Input: `artifact_id`.
- Steps:
  1. Resolve artifact source and download policy.
  2. Download or save page-rendered PDF into `var/artifacts/...`.
  3. Compute checksum and update artifact row.
- Output: local file path and checksum.

### `sync_solved_submission_status`
- Input: `contest_id`.
- Steps:
  1. Resolve identity bindings for local members.
  2. Use contest submission sync only when provider supports it and when finer post-hoc analysis is needed.
  3. Upsert `submission`.
  4. Do not make this task a prerequisite for the MVP coverage matrix.
- Output: submission delta count and solved summary.

### Tasking Principles
- Tasks must be idempotent for the same provider reference.
- Long-running work emits progress through `task_event`.
- Failure of one problem/artifact should not abort the entire contest sync unless the root contest fetch failed.
- The default contest view should be computable from `contest` + `problem` + `member_problem_status` without requiring raw submission sync.

## 6. Local API Design

### API Style
- Local HTTP JSON API over `http://127.0.0.1:<port>`.
- Read endpoints are stable and provider-agnostic where possible.
- Task-trigger endpoints return `task_run_id` immediately.

### Endpoints

#### Health
- `GET /api/health`

#### Contests
- `GET /api/contests`
- `GET /api/contests/:contestId`
- `GET /api/contests/:contestId/coverage`
- `POST /api/contests/sync`
  - body: `provider_key`, `provider_contest_id` or `contest_url`

#### Problems
- `GET /api/contests/:contestId/problems`
- `GET /api/problems/:problemId`
- `POST /api/problems/resources/sync`
  - body: `problem_ids[]`

#### Artifacts
- `GET /api/problems/:problemId/artifacts`
- `POST /api/artifacts/:artifactId/download`

#### Member History / Coverage
- `GET /api/members/problem-status`
- `POST /api/members/problem-status/sync`
- `GET /api/contests/:contestId/freshness`

#### Submissions / Solved Status
- `GET /api/contests/:contestId/submissions`
- `GET /api/contests/:contestId/solved-summary`
- `POST /api/contests/:contestId/submissions/sync`

#### Identity Bindings
- `GET /api/identity-bindings`
- `POST /api/identity-bindings`

#### Tasks
- `GET /api/tasks`
- `GET /api/tasks/:taskRunId`
- `GET /api/tasks/:taskRunId/events`

### API Non-Goals
- No public auth.
- No websocket requirement in v1; polling is enough.
- No generic query language.

## 7. Vue SPA Information Architecture And Routes

### Core Pages

#### Dashboard
- Route: `/`
- Shows recent contests, recent task runs, quick sync entry, and candidate contests with high fresh-problem coverage.

#### Contest Detail
- Route: `/contests/:contestId`
- Shows contest metadata, problem list, per-member three-state matrix, team-fresh problems, and resource sync actions.

#### Problem Detail
- Route: `/problems/:problemId`
- Shows canonical problem info, artifact inventory, local file availability, and source links.

#### Tasks
- Route: `/tasks`
- Shows running/completed task history and drill-down progress.

#### Settings
- Route: `/settings`
- Shows provider configuration, browser state path status, artifact root, tracked members, and identity bindings.

### SPA State Boundaries
- Server state comes from local API.
- Browser storage keeps UI preferences, selected filters, and ephemeral draft forms only.
- Any freshness, three-state matrix, or upsolve summary should come from service read models, not reimplemented independently in frontend.

## 8. Skills To Extract

### Skill 1: `provider-onboarding`
- Trigger when adding a new OJ provider.
- Covers folder scaffold, provider contract checklist, required fixtures, and exit criteria.

### Skill 2: `fixture-capture-playwright`
- Trigger when capturing or refreshing provider HTML/PDF/JSON fixtures.
- Covers persistent-context browser usage, naming, redaction, and reproducibility.

### Skill 3: `schema-migration-contracts`
- Trigger when changing SQLite schema or local API contracts.
- Covers migration authoring, snapshot updates, backward-compat checks, and doc updates.

### Skill 4: `task-flow-implementation`
- Trigger when adding a new local sync task.
- Covers idempotency, progress events, retry boundaries, and API exposure.

### Skill 5: `vp-coverage-evaluation`
- Trigger when changing freshness rules, three-state mapping, or upsolve heuristics.
- Covers status precedence, read-model calculation, and regression cases.

## 9. Phase-1 Development Plan

### Thread A: Service Skeleton And Schema
- Goal: stand up Python service skeleton, DB bootstrap, migrations, canonical models.
- Directories: `apps/service`, `packages/schemas`, `docs`.
- Boundary: no provider-specific scraping logic.
- Acceptance:
  - service starts locally
  - SQLite schema can initialize and migrate
  - canonical entity models plus `member_problem_status` repository interfaces exist

### Thread B: Provider Framework And First Provider Skeleton
- Goal: implement provider contracts, Codeforces API client, Playwright session management, and the first Codeforces Gym skeleton with fixtures.
- Directories: `apps/service/src/xcpc_vp_gather/providers`, `fixtures/providers`.
- Boundary: no SPA pages; no cross-provider logic outside contracts.
- Acceptance:
  - provider registry resolves by `provider_key`
  - `sync_contest` skeleton works on Codeforces API fixtures
  - `sync_member_problem_status` skeleton works on Codeforces API fixtures
  - fixture set exists for Codeforces API plus statement/resource HTML pages

### Thread C: Local API And Task Orchestration
- Goal: add task-run model, sync orchestration, and localhost JSON API.
- Directories: `apps/service/src/xcpc_vp_gather/api`, `services`, `tasks`.
- Boundary: no frontend implementation details.
- Acceptance:
  - task endpoints return task IDs
  - polling endpoints show status/events
  - contest coverage and member-status read endpoints return stable DTOs

### Thread D: Vue SPA Console Skeleton
- Goal: create Vue 3 SPA skeleton with routes, layout, API client, and task polling.
- Directories: `apps/web`, `packages/api-contract`.
- Boundary: no direct scraping, no provider selectors.
- Acceptance:
  - routes render dashboard, contest, problem, tasks, settings shells
  - app can call local API contracts
  - contest three-state matrix and freshness summary can be displayed from mock or live local API

## 10. What Should Not Be Implemented Yet
- Full provider production parser before contracts and fixtures stabilize.
- Download manager sophistication like resumable multipart downloads.
- Websocket push updates; polling is enough for v1.
- Packaging/installer complexity before local dev loop is working.
- Advanced analytics, ranking visualizations, or code archive features.
- Codeforces API key flows unless a concrete MVP gap requires them.
- Full post-VP session recorder before the pre-VP freshness workflow is working end to end.

## 11. Suggested Next Files
- `apps/service/pyproject.toml`
- `apps/service/src/xcpc_vp_gather/main.py`
- `apps/service/src/xcpc_vp_gather/api/app.py`
- `apps/service/src/xcpc_vp_gather/db/schema.sql`
- `apps/service/src/xcpc_vp_gather/providers/base.py`
- `apps/service/src/xcpc_vp_gather/providers/codeforces/api_client.py`
- `apps/service/src/xcpc_vp_gather/providers/codeforces/provider.py`
- `apps/service/src/xcpc_vp_gather/providers/registry.py`
- `apps/service/tests/test_schema_init.py`
- `apps/web/package.json`
- `apps/web/src/main.ts`
- `apps/web/src/router.ts`
- `apps/web/src/views/DashboardView.vue`
- `packages/api-contract/openapi.yaml`
- `fixtures/providers/codeforces/README.md`
