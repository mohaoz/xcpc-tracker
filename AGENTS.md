# xcpc-tracker Pivot AGENTS

## Product Summary
- If scope is unclear, then optimize for an XCPC tracker that ships as a static frontend-first site.
- If choosing the first live sync source, then use Codeforces public API directly from the frontend.
- If choosing the second source, then use QOJ userscript-assisted JSON import; do not build a Python scraper for it.
- If choosing the curated data source, then keep contest and artifact metadata in Git-managed JSON files.
- If describing the main user value, then prioritize: browse curated contests, inspect member coverage, import member status, and answer VP-before freshness questions.
- If a feature does not directly help curated contest browsing, member coverage tracking, Codeforces import, QOJ import, or static deployment, then cut it from the near-term plan.

## Architecture Boundaries
- If code runs in the browser, then it may fetch public APIs, read curated JSON, persist to IndexedDB, and compute local coverage views.
- If durable runtime state is needed, then IndexedDB is the primary application store.
- If data is curated and versioned, then keep it in Git as JSON files; do not treat IndexedDB as the source for curated catalog data.
- If a feature requires a running localhost backend in normal usage, then reject it by default.
- If a backend/tooling task is still useful, then keep it as build-time or migration-time tooling only, not as the primary runtime architecture.
- If content is large or derived, then commit only the single bundled default catalog and keep runtime-only copies out of the repo.

## Data And Catalog Rules
- If adding curated contest metadata, then keep the built-in default catalog in a single bundled JSON file under `catalog/`.
- If data is intended to be canonical and reviewable, then it must live under `catalog/` and be editable by hand.
- If data comes from import flows, then treat it as candidate or draft input until it is normalized into curated catalog files.
- If adding schema validation, then validate curated files against JSON Schema before build or deploy.
- If adding canonical catalog fields, then prefer `id`, `title`, `aliases`, `tags`, `problems`, `sources`, and optional provenance notes; do not duplicate obvious tag semantics into separate fields without a concrete product need.
- If storing external links, then use a `sources` array with objects shaped like `provider`, `kind`, and `url`.
- If contest/problem IDs are needed, then use stable internal IDs in curated data and keep provider-scoped IDs inside source mappings.

## Import Rules
- If the source is Codeforces, then use official public API access from the frontend.
- If the source is QOJ, then use userscript-exported JSON snapshots imported into the app.
- If import data is stored in the repository, then keep it as fixture or draft material, not as the canonical curated dataset.
- If import logic is provider-specific, then keep it in frontend adapters/importers, not in a server-provider abstraction.
- If import output is ambiguous, then preserve raw import payload metadata and provenance alongside normalized local records.
- If matching imported member status to curated problems is imperfect, then keep explicit match evidence and unresolved records rather than silently dropping them.
- If an import suggests new contest metadata, then generate a reviewable draft or patch instead of mutating curated source of truth silently.
- If a workflow depends on user login state or browser-local permissions, then design it around the user's own browser environment instead of service-side automation.

## Frontend Data Model
- If modeling runtime entities, then define frontend-oriented records for `contest`, `problem`, `member`, `member_problem_status`, `sync_record`, and `import_source`.
- If the product question is "has this member solved or tried this curated problem", then model that directly in IndexedDB.
- If UI lists tracked people, then group by stable local member identity and treat provider handles as linked sources.
- If upstream fields differ across providers, then keep normalized columns plus raw payload metadata.
- If schema changes, then document IndexedDB version upgrades and migration intent before implementation.

## Directory And Naming
- If code belongs to the shipped product, then prefer TypeScript modules under the frontend app and repo-level data/tooling directories.
- If code is only for migration or validation, then place it under `scripts/`.
- If adding curated source data, then place it under `catalog/`.
- If adding schemas, then place them under `schemas/`.
- If naming JSON fields, TypeScript types, or generated file keys, then prefer `snake_case` for persisted JSON and `camelCase` / `PascalCase` for TypeScript code.

## Testing And Validation
- If adding catalog data, then add schema validation and deterministic generation checks.
- If adding provider import logic, then include fixtures for raw payloads and normalized mapping outputs.
- If a test requires live network, browser login, or manual userscript interaction, then it is not a default CI test.
- If CI runs, then it should validate catalog JSON, generate indexes, run frontend checks, and build the static app.
- If changing import contracts, then add snapshot examples for accepted JSON payload shapes.

## Scope Cuts
- If a request reintroduces the Python localhost service as the core runtime, then reject it.
- If a request adds multi-user backend, cloud sync, push notifications, mobile app, or full-text search, then defer it.
- If a request adds heavy analytics before the import and coverage loop is stable, then defer it.
- If a request adds new OJs before the Codeforces and QOJ flows are solid, then defer it.
- If a request adds backend scraping for QOJ, then reject it in favor of the userscript bridge.

## Codex Execution Rules
- If starting work, then audit first, document second, code third.
- If the product direction changes, then update `AGENTS.md` and architecture docs before touching implementation.
- If preserving useful existing code is possible, then migrate it deliberately instead of rewriting by reflex.
- If a current module encodes a useful domain concept such as coverage or local member identity, then preserve the concept even if the implementation moves layers.
- If a runtime subsystem no longer matches the product direction, then de-emphasize it quickly and plan its removal explicitly.
- If a decision belongs in this file, then update `AGENTS.md` in the same patch.
