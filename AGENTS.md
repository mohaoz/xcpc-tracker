# XCPC Tracker

## Product invariants

### Purpose

- Describe the product as an XCPC problem-solving tracker ("XCPC 做题情况追踪"), not as a VP selection tool. Whole-contest VP is one use case, not the product's identity.
- It serves four uses, all anchored to the curated XCPC contest catalog:
  1. **See what teammates have done**: per-member attempt/solve status, visible to the whole team.
  2. **Find contests the team has not touched**, to pick the next whole-contest VP.
  3. **Write catalog problems individually**, e.g. regional problems on one's own.
  4. **Check how the team did**: where the team's solved count falls against a contest's medal lines.
- Keep existing features when adding new ones; do not remove a feature unless explicitly requested.

### Use-case constraints

- "未做" means no selected member has attempted or solved any problem in the contest; an attempt counts even without acceptance. Once anyone has touched a contest it is no longer a clean VP, so individual practice (use 3) intentionally removes contests from the "未做" pool. This is expected, not a conflict.
- Practice links and "未做" filtering operate on whole contests. Results (use 4) compare solved count only; there is no penalty data, so penalty-based placement is out of scope. Contests without verified or estimated medal lines show no placement.
- Choosing problems by difficulty is served by XCPC Rating's problems page; do not reimplement problem-level difficulty browsing.
- Data stays in each user's browser. Each teammate adds the whole team's CF/QOJ accounts in their own browser; there is no cloud or file-based team sharing. Team composition is the member selection (and the `members` URL parameter). The contest list and contest detail use the same selection, and it can be changed on either page; coverage, "未做", medal placement and spoiler defaults always reflect it. A saved team is only a named member selection. A contest with no solves but at least one attempt by the selected members is placed at Fe; with no attempts it has no placement.
- Every catalog problem has a CF or QOJ source and is tracked automatically; problems written elsewhere are recorded with manual marks.
- The catalog already covers all XCPC categories (regional, provincial, invitational, finals, online preliminaries, girls', vocational). It grows by filling missing contests and data, not by adding categories.
- Out of near-term scope unless explicitly requested: new OJs, cloud sync, multi-user backends, push notifications, mobile apps and heavy analytics. Lightweight progress history (e.g. a solved-count trend) is in scope.

### Spoilers

- Untouched contests default to non-spoiler; an attempt or solve by any selected member makes a contest touched, so the default follows the member selection. Opening details does not change it. Explicit per-contest preferences win; bulk spoilers default off and medal estimates default on, preserving saved settings.
- Non-spoiler hides medal cutoffs, medals, problem tags and ratings, including medal-based search. Coverage and whole-contest practice links remain available.

### Data rules

- For multiple eligible groups, use the verified highest group; invitational takes precedence over provincial. Record the group and never merge uncertain groups.
- A full metadata refresh compares existing populated fields, not only gaps. Remove tags only with approved historical source ownership and current explicit classified replacement evidence; absent/null/unknown or numeric-only matches do not authorize deletion. Preserve manual/other-source values, keep old/new hashes and direct-source conflicts, and do not infer transitive ownership through shared problem IDs.
- Problem ratings use verified XCPC Rating values and CF rank colors; missing values stay unset. Coverage is a compact member-row/problem-column heatmap above awards; tags/ratings belong in a separate table and bulk settings in management.
- A numeric XCPC Rating row without a title may be used only when every problem in its contest has a one-to-one exact CF/QOJ ID match, the catalog already has the reviewed original-event RankLand path, and original start times agree. Keep the absent upstream title absent in provenance; do not infer numeric values or use ordinal-only/partial-list matching.

## Upstreams and differentiation

- The project builds on and re-curates two upstreams: [algoUX srk-collection](https://github.com/algoux/srk-collection) (standings, viewed on RankLand) and [XCPC Rating](https://github.com/Hei-MaoM/xcpcrating) by Hei-MaoM (problem tags, ratings, practice-link candidates). Credit both visibly in the site and README, and follow the licensing notes in `catalog/README.md`.
- Do not rebuild what upstreams already provide. Full standings browsing belongs to RankLand/XCPCIO Board; individual player rating and problem difficulty browsing belong to XCPC Rating. Consume their reviewed results and link back.
- Stay distinct from [OJ Insight](https://github.com/Whalica/OJ_Insight), a cross-OJ desktop app for individual training (dashboards, problem lists, journals, VP timers, LLM contest generation, plus a per-person ICPC/CCPC tracker). This project is a zero-install static website where the whole team sees each member's progress, centered on a curated, source-audited XCPC contest catalog (complete problem lists across CF/QOJ mirrors, verified medal lines, spoiler control). Do not add personal cross-OJ dashboards, training journals, timers or LLM-based contest generation unless explicitly requested; features stay anchored to catalog contests and problems.

## Architecture and ownership

- Ship a static Vue/TypeScript frontend; no localhost backend is required in normal usage. Build-time/migration tooling belongs in `scripts/`.
- Git-managed `catalog/default-catalog.min.json` is the single bundled canonical catalog. IndexedDB stores local members, handles, statuses, sync/import records and preferences, not curated catalog truth.
- Consume prebuilt static indexes/details on demand; do not initialize the entire catalog in the browser on version changes. Do not commit duplicate generated/runtime catalog copies.
- CF official API is frontend member-status sync, not a runtime contest-sync button. QOJ uses a user-installed userscript bridge in the user's browser, with JSON export/import as fallback; never a server scraper or another user's login state. One opt-in periodic sync setting controls CF and QOJ concurrently and enables QOJ userscript mode for both first imports and updates. Disabling periodic sync retains script mode; explicitly disabling script mode also stops periodic sync. Both use frontend persistence only and preserve successful data on failure.
- QOJ contest-list HTML/MHT exports provide review candidates only. Promote a contest-page export only with a reviewed problem list and source provenance.
- Catalog discovery is manually invoked and produces review artifacts only, outside public assets; no scheduled workflow or generated QOJ export queue. Preserve each source's last successful snapshot on failure; QOJ contest acquisition stays in the user's browser. See `docs/discovery/README.md`.
- QOJ defaults to manual import; preserve explicitly saved mode preferences. A one-time startup announcement introduces the optional userscript without enabling it. A global QOJ userscript preference applies to both member creation and updates. Manual export/import stays in one dialog; switching modes preserves records. Periodic synchronization remains a separate opt-in.
- RankLand standings/SRK and XCPC Rating enrichment are audited at build time. Preserve CF/QOJ problem and member-status ownership. Rating data may enrich tags, ratings and whole-contest practice links; do not change whole-contest link interaction or infer member status from standings/rating data.
- Preserve useful coverage and local-member identity concepts when refactoring; do not reintroduce the retired Python runtime service.

## Catalog and import contracts

- Every published contest must have curated problems; reject empty lists and `contest_stub`. Keep uncurated candidates under `docs/`, outside public assets. Align bundled catalog and app versions when changing a catalog release.
- Use stable internal contest/problem IDs. Keep provider IDs, upstream titles and provenance in `sources`; source objects use `provider`, `kind`, `url` and relevant optional mappings. Preserve the curator's primary title; aggregate upstream titles into `aliases` instead of overwriting it.
- A provider's problem letter is not an original problem identity. Require a unique reviewed title/provider mapping and complete source list before importing; reject conflicting owners, unknown title changes and incomplete lists atomically. An unrelated primary title must never become an alias through ordinal fallback. Legitimate cross-contest mirrors require explicit reviewed targets.
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
- Keep durable product constraints here, runtime/persistence details in `docs/architecture.md`, maintenance commands in `scripts/README.md`, product direction in `docs/roadmap.md`, and pending contest work in the contest checklist. Use links instead of copying workflows; historical changelog entries are not current instructions.
- Agent/maintainer docs (`AGENTS.md`, `docs/architecture.md`, `scripts/README.md`) are written in English. `README.md`, the contest checklist and UI copy stay Chinese. UI keeps standard competitive-programming terms in English (solved, attempted, fresh, Fe/Cu/Ag/Au, Rating).
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
