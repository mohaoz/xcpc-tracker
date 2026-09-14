# XCPC Tracker

## Product invariants

- Core value: select a **whole-contest VP**, supported by curated browsing, member coverage and CF/QOJ imports. Partial practice, new OJs, cloud sync, multi-user backends, push notifications, mobile apps and heavy analytics are outside the near-term scope unless explicitly requested.
- “未做” means no selected member has attempted or solved any problem in the contest. An attempt counts even without acceptance.
- Untouched contests default to non-spoiler; any active member's attempt/solve makes a contest touched. Opening details or changing selected members does not change this default. Explicit per-contest preferences win; bulk spoilers default off and medal estimates default on, preserving saved settings.
- Non-spoiler hides medal cutoffs, medals, problem tags and ratings, including medal-based search. Coverage and whole-contest practice links remain available.
- For multiple eligible groups, use the verified highest group; invitational takes precedence over provincial. Record the group and never merge uncertain groups.
- Problem ratings use verified XCPC Rating values and CF rank colors; missing values stay unset. Coverage is a compact member-row/problem-column heatmap above awards; tags/ratings belong in a separate table and bulk settings in management.

## Architecture and ownership

- Ship a static Vue/TypeScript frontend; no localhost backend is required in normal usage. Build-time/migration tooling belongs in `scripts/`.
- Git-managed `catalog/default-catalog.min.json` is the single bundled canonical catalog. IndexedDB stores local members, handles, statuses, sync/import records and preferences, not curated catalog truth.
- Consume prebuilt static indexes/details on demand; do not initialize the entire catalog in the browser on version changes. Do not commit duplicate generated/runtime catalog copies.
- CF official API is frontend member-status sync, not a runtime contest-sync button. QOJ uses user-browser/userscript JSON exports, never a server scraper or another user's login state.
- QOJ contest-list HTML/MHT exports provide review candidates only. Promote a contest-page export only with a reviewed problem list and source provenance.
- RankLand standings/SRK and XCPC Rating enrichment are audited at build time. Preserve CF/QOJ problem and member-status ownership. Rating data may enrich tags, ratings and whole-contest practice links; do not change whole-contest link interaction or infer member status from standings/rating data.
- Preserve useful coverage and local-member identity concepts when refactoring; do not reintroduce the retired Python runtime service.

## Catalog and import contracts

- Every published contest must have curated problems; reject empty lists and `contest_stub`. Keep uncurated candidates under `docs/`, outside public assets. Align bundled catalog and app versions when changing a catalog release.
- Use stable internal contest/problem IDs. Keep provider IDs, upstream titles and provenance in `sources`; source objects use `provider`, `kind`, `url` and relevant optional mappings. Preserve the curator's primary title; aggregate upstream titles into `aliases` instead of overwriting it.
- Preserve existing persisted field names; the shipped snapshot uses camelCase entity fields and snake_case source mappings/preferences. Use the applicable schema/type, not a mechanical naming conversion. New fields should not duplicate tag semantics without a concrete need; TypeScript uses camelCase/PascalCase.
- Manual contests may have no contest sources; use `manual` primarily for hand-entered problem sources/status provenance.
- Default standings source: explicit `sources[*].is_default`, then verified RankLand, then existing standings. Keep fallback sources and do not relabel old award values as a new source.
- Prefer explicit awards. Only use proportional estimates when enabled and complete audited standings establish highest-group eligibility. Gold/silver/bronze counts are floor(eligible × 10%/20%/30%); retain an estimate label. Unknown groups or incomplete standings remain gaps.
- Group people by stable local identity with linked provider handles. Normalize payloads while retaining raw metadata, match evidence and unresolved records. Failed imports preserve previous successful status.
- Import payloads are drafts/fixtures, not automatically canonical. Provider-specific mapping belongs in frontend adapters/importers. Suggested catalog changes require reviewable patches.
- Do not guess CF access scope or completeness. Private contests need the user's own authorized account/credentials. Keep failures visible in the import flow; retain unmatched evidence without restoring the removed list/detail import-gap banner.

## Task-scoped workflow

- Inspect relevant implementation and existing changes before editing. Preserve unrelated user work. Do not require a whole-repository audit or documentation update for every change.
- Read `docs/architecture.md` for architecture, coverage, spoiler or persistence changes; `scripts/README.md` for catalog enrichment/import tooling; `README.md` and `.github/workflows/` for deployment. Read only references needed for the task.
- Keep durable product constraints here, runtime/persistence details in `docs/architecture.md`, maintenance commands in `scripts/README.md`, and pending work in the contest checklist. Use links instead of copying workflows; historical changelog entries are not current instructions.
- Update product/architecture instructions when those decisions change. Document IndexedDB upgrade and migration intent before implementing schema changes. Ordinary style, copy and local UI edits do not require new design documents.
- Complete requested implementation, relevant checks and fixes for regressions caused by the change. Resolve routine implementation choices locally. Ask when a missing fact changes product meaning, data accuracy, authority or a significant external action.
- Diagnosis/review does not authorize implementation; a plan request ends with a plan. “Local preview, no commit” ends with a working preview and relevant checks. Git sync/deployment requires current authorization; persistence does not expand scope. Report remaining blockers honestly.

## Validation

- Match local checks to risk: UI changes need relevant type/interaction/visual checks; imports need raw/normalized fixtures and failure-preservation tests; awards need group, penalty and boundary cases.
- Catalog changes require JSON Schema validation and deterministic generation checks, including rejection of empty contests/stubs. Import-contract changes include accepted JSON examples. Schema files belong in `schemas/`.
- Run safe, relevant local tests and rerun affected checks after fixes without asking at each step. Inspect external effects before running unfamiliar scripts; do not assume every test is disposable.
- Preserve release CI: catalog validation, static-index generation, frontend checks and static build. Live network, login and manual userscript tests are not default offline CI requirements.

## Branches and delivery

- `main` is canonical development; `release` deploys GitHub Pages at `https://mohaoz.github.io/xcpc-tracker/` through Actions. Runtime/build/catalog/schema/script changes must reach `release` when publishing.
- Make all changes on main. Publish by fast-forwarding release to the same commit; do not create release-only changes or merge commits. Between releases, main may be ahead. Keep branch contents identical at publication; select website assets through the build, not branch-specific document deletion.
- Keep `README.md`, `CHANGELOG.md`, required licenses and provenance for release. Internal design/workflow docs need not be published unless required there; check purpose before removing documents.
- A branch-policy change updates this file and a user-facing document together. Verify the authorized delivery stage: local preview, pushed branches, or deployed site; do not confuse one with another.
