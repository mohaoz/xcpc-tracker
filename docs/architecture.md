# xcpc-vp-gather Architecture

## Assumptions
- v1 supports one OJ provider only: Codeforces Gym.
- v1 runs as a local webpage plus localhost Python service on a single machine.
- v1 focuses on contest sync, tracked-member history sync, problem/resource gathering, VP-before coverage checks, VP-after upsolve checks, and local VP console.
- Provider automation reads content the user can already access; it does not bypass permissions.
- Codeforces official API is the primary acquisition path for contest, standings, and submission data; browser automation supplements resource acquisition.
- The current shipped UI includes a contest pool, intake page, contest detail page, and member page.

## Non-Goals
- Online judge, remote backend, SaaS, multi-user collaboration.
- Cloud sync, notifications, mobile app, full-text search engine.
- Automatic judging, sandboxed code execution, or submission dispatch.

## System Layers

### 1. Provider / Acquisition
- Owns OJ-specific API clients, navigation, parsing, browser automation, and fetch adapters.
- Emits raw source payloads plus lightly normalized provider DTOs.
- Reuses user-local browser state where available.

### 2. Normalization
- Maps provider DTOs into canonical entities: `contest`, `problem`, `artifact`, `submission`, `identity_binding`.
- Maintains a provider-agnostic member-problem history cache for fast VP eligibility checks.
- Maintains `contest_coverage_summary` as a focused read-model table owned by the service layer.
- `contest_coverage_summary` lifecycle: recomputed after contest sync and member-history sync; it derives from `contest`, `problem`, and `member_problem_status`, and is not a source-of-truth replacement for those canonical entities.
- Preserves `provider_key`, upstream external IDs, and raw payload snapshots.
- Enforces canonical enums and relationship rules.

### 3. Service / Task Orchestration
- Schedules sync jobs and step-level tasks.
- Coordinates provider calls, normalization, persistence, file cache, and retries.
- Tracks task runs and exposes progress to local API.
- Maintains contest summary backfills for imported-but-unsynced contests and old summary rows missing problem-state strips.

### 4. Local API
- Serves SPA-friendly read models and task-trigger endpoints over localhost.
- Hides provider details behind stable DTOs.
- Returns task state, contest summaries, member-problem coverage, VP-before freshness, and artifact availability.
- Exposes targeted actions such as contest sync, missing-contest sync, and member-history sync.

### 5. SPA
- Displays local dashboard, contest pages, problem/resource views, and sync controls.
- Uses browser storage as cache only.
- Never performs cross-site scraping.
- Contest cards are intentionally summary-first: title, tags, problem count, solved count, and per-problem status strips.

## Technology Choices

### Vue 3 SPA
- Fits a local control console well: reactive UI, router, component ecosystem, and low deployment friction.
- Keeps frontend concerns narrow: view state, task triggering, and local read-model presentation.
- Easy to evolve from single-provider MVP to richer local dashboards without coupling to scraping logic.

### Python Localhost Service
- Strong fit for task orchestration, SQLite access, filesystem management, and data normalization.
- Best language match for Playwright Python and parsing-heavy workflows.
- Simple local distribution story for a single-user tool.

### Playwright Python
- Stable browser automation for authenticated read-only capture when API coverage is insufficient.
- Can launch persistent browser contexts and reuse existing local login state patterns.
- Supports deterministic page capture/screenshots/download flows needed for fixtures and debugging.

### SQLite
- Correct default for local-first single-user persistence.
- Good enough for contest/problem/submission metadata with transactional writes and simple backup story.
- Avoids premature operational complexity.

### Local Artifact Cache Directory
- Binary assets like PDFs, HTML snapshots, and downloaded editorials should live on disk, not inside SQLite blobs by default.
- File cache makes re-open, re-parse, and manual inspection cheap.
- DB stores path, checksum, type, provenance, and lifecycle metadata.

## Tradeoffs
- Localhost service avoids cloud complexity but requires local runtime setup.
- Member-history sync matches the VP decision problem better and generalizes to OJs without contest APIs.
- Codeforces API is still valuable for contest metadata and optional submission-level enrichment, while browser automation remains necessary for page-derived assets.
- SQLite keeps ops trivial but should not become a dumping ground for large binaries.

## Minimal MVP Boundaries
- One provider: Codeforces Gym.
- One machine, one user.
- Read-only sync of contests, problems, artifacts, tracked-member problem history, and optional submission enrichment.
- No judge, no remote accounts, no collaboration.
- Current web workflow centers on Intake for mutation and Contest Pool for read-only VP decisions.
