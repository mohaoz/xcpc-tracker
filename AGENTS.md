# xcpc-vp-gather AGENTS

## Project Summary
- If scope is unclear, then optimize for a local-first XCPC/ACM VP gather MVP.
- If choosing the first OJ provider, then use Codeforces Gym.
- If defining MVP outcomes, then prioritize: `VP before` identify contests/problems nobody on the tracked team has solved or tried, and `VP after` identify problems still needing upsolve.
- If describing current shipped UI, then note the main views are Contest Pool, Contest Intake, Contest Detail, and Members.
- If a feature does not directly help contest sync, member history sync, problem/resource gathering, VP-before coverage checks, VP-after upsolve checks, or local VP console, then exclude it from v1.
- If a design choice conflicts with "local web app + localhost service", then keep the localhost service model.

## Architecture Boundaries
- If code runs in browser, then it may render UI, cache view state, and trigger tasks; it must not crawl OJ pages directly.
- If code needs network, browser automation, filesystem writes, or DB writes, then it belongs to the Python localhost service.
- If a feature implies remote multi-user backend, cloud sync, judge, or auth platform, then reject it.
- If data is durable, then SQLite is the source of truth; browser storage is cache only.
- If content is large or binary, then store file on disk and metadata in SQLite.

## Provider Rules
- If integrating any OJ, then implement it behind `Provider` interfaces only.
- If the provider is Codeforces, then prefer official API for contest, standings, submission, and public metadata acquisition.
- If Codeforces API does not expose required resource metadata or files, then use browser automation as a supplement, not the default path.
- If a provider can expose per-member solved/tried problem history more cheaply than per-contest submissions, then make member-history sync the primary path.
- If logic is site-specific, then keep it inside provider modules; do not leak site branches into service/core layers.
- If provider returns data, then return raw payload plus minimally normalized records.
- If behavior requires existing user permissions, then reuse local browser state when possible; do not design bypass flows.
- If v1 supports one OJ only, then still require `provider_key` on provider-facing contracts and persisted records.

## Unified Schema Principles
- If data enters the system, then map it into the canonical entities: `contest`, `problem`, `artifact`, `submission`, `identity_binding`; if MVP needs a team/member problem-state cache, then add a focused supporting table instead of overloading `submission`.
- If the product question is "has this member solved/tried this problem before VP", then model that state directly.
- If UI or API lists tracked members, then default to grouping by `local_member_key`; treat provider bindings as secondary detail for the same local person.
- If upstream fields are ambiguous, then preserve raw source payload alongside normalized columns.
- If an entity cannot be made stable across providers, then define provider-scoped external IDs plus internal UUIDs.
- If schema adds a new table, then document ownership, lifecycle, and relation to the five canonical entities.

## Frontend / Acquisition Decoupling
- If UI needs data, then request it from local API; never scrape from frontend.
- If UI triggers a sync, then call task endpoints and poll/read task state.
- If acquisition shape changes, then keep SPA contracts stable through service-layer DTOs.

## Directory And Naming
- If code is shared across providers, then place it in core/service modules, not provider folders.
- If module is provider-specific, then name paths with provider key and keep tests beside fixtures.
- If naming DB tables, API fields, or Python modules, then prefer `snake_case`.
- If naming TypeScript/Vue components or types, then prefer `PascalCase` for components and `camelCase` for variables.
- If creating new top-level directories, then justify them in architecture docs first.

## Testing And Fixtures
- If adding provider logic, then include deterministic fixtures for HTML/JSON/PDF metadata and normalized outputs.
- If adding Codeforces coverage, then separate API fixtures from HTML fixtures.
- If a test needs live network or real login, then it is not a default CI test.
- If browser automation is added, then keep replayable fixtures or captured pages for parser coverage.
- If changing schema or contracts, then add migration tests or contract snapshots.

## When To Add A Skill
- If a workflow is repeated across tasks and needs stable steps, then promote it to a skill.
- If a workflow needs provider onboarding, fixture capture, schema migration, or release checklist reuse, then consider a skill.
- If a workflow is still volatile or one-off, then do not create a skill yet.

## When Not To Expand Scope
- If a request adds accounts, cloud sync, judge, remote collaboration, push notifications, mobile app, or full-text search, then defer it.
- If a request adds complex ranking analytics or recommendation systems before MVP sync works, then defer it.
- If a request increases supported OJs before provider abstraction and first provider are stable, then defer it.
- If Codeforces Gym data is already available from official API, then do not scrape the same field from pages without a concrete gap.
- If a feature is about reconstructing full contest-time submission timelines, then defer it unless it directly improves VP-before or upsolve decisions.

## Codex Execution Rules
- If starting work, then design first, code second.
- If building a new area, then create skeletons and contracts before detailed implementation.
- If v1 behavior is uncertain, then choose the smallest MVP that preserves future extensibility.
- If CLI already proves the service logic, then shift next work to local API and frontend integration instead of continuing CLI productization.
- If a capability is only useful as terminal UX polish, then defer it until API and SPA foundations are complete.
- If a decision belongs in this file, then update `AGENTS.md` immediately.
- If unrelated code or speculative polish appears, then stop and cut scope back.
