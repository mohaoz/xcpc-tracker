# Data maintenance and validation

All scripts here are build-time or maintenance tools; normal use of the site never depends on them. `catalog/default-catalog.min.json` is the canonical data and must never be rebuilt from old scrape results.

Upstream data comes from [algoUX srk-collection](https://github.com/algoux/srk-collection) (standings, via RankLand) and [XCPC Rating](https://github.com/Hei-MaoM/xcpcrating) (tags, ratings, practice links). Licensing and attribution: [catalog/README.md](../catalog/README.md).

## Everyday commands

```sh
npm run catalog:refresh        # validate the current catalog and generate static assets; no network
npm run deploy:build           # tool/data tests, CF/QOJ checks, frontend unit tests, generated-asset checks, static build
npm test                       # frontend unit tests (web/tests/unit) and tool/data tests (tests/tools)
npm run test:e2e               # Playwright browser tests (tests/e2e); starts the dev server itself
```

This directory holds only build and data-maintenance tools. Tests live in `tests/tools/` (Vitest, for these tools and the catalog data), `web/tests/unit/` (Vitest, frontend) and `tests/e2e/` (Playwright Test). `check-production-assets.mjs` checks the GitHub Pages build output in CI; `source-schemas.mjs` is the shared JSON Schema / snapshot validator used by tools and tests.

- `npm run catalog:discover` manually discovers new contests, problem-list leads and standings/Rating changes. It only writes review reports and never applies changes to the catalog. Caching and failure retention: [discovery docs](../docs/discovery/README.md). `catalog:validate-discovery` uses offline fixtures and never contacts upstreams. Discovery is not wired into any schedule or CI.
- Legacy scripts such as `catalog:generate-default` and `catalog:build-final` exist only for explicit migrations. Back up and review their output before running them; they are not part of refresh or deployment.

## Audit history

The 2026-10-01 completion audit: [summary](../docs/catalog-completion-2026-10-01.md), [award/source receipt](../fixtures/imports/rankland/2026-10-01-completion.json), [CF problem lists](../fixtures/imports/codeforces/2026-10-01-review.md). It re-reviewed all 59 retained estimates. Historical receipts stay unchanged; offline tests overlay corrected/withdrawn fields from the new receipt and require every remaining estimate to have current eligibility and no-tie evidence.

## Award computation rules

- `calculateBoardAwards` is the single calculator for official teams, highest group, CE/PE/`is_ignore`, second/millisecond timestamps and configured penalty modes. Legacy Board refresh entry points reuse it so old penalty bugs cannot return. Contests with an independent primary `award_rules` reject automatic Board replacement.
- Board estimates apply `floor` to each tier's 10%/20%/30% separately and then accumulate boundaries; a boundary tie on solved count and penalty is rejected. Invitational beats provincial and undergraduate beats vocational; an unknown higher/lower group never falls back to all official teams. Upstream-verified 10-digit Unix-second timestamps, terminal-status aliases and boolean/numeric official markers are accepted. If an award config exists but cannot be mapped to the highest group, estimation is refused. Pending results, unknown teams and eligibility conflicts in raw standings are never treated as zero.
- The CCPC preset is a cumulative `ceil` of 10%/30%/60% of valid official teams. It is an explicit source rule, not a generic estimate.
- Unknown group, unfinished contest or a tie across a boundary keeps the gap blocked.

## Award gap tools

- **XCPCIO gap fill**: save the target contest's `config/team/run.json`, then run `node scripts/apply-xcpcio-gaps.mjs <cache dir>`. It only fills missing cutoffs and never changes sources; an unclear official group blocks the apply. Evidence is in `fixtures/imports/xcpcio-2026-gap-awards.json`; `tests/tools/xcpcio-gaps.test.ts` checks that CE adds no penalty, second-level accumulation and rounding, and award-config precedence. The script rewrites its review attachment: keep the original before re-running and review the diff. An entry leaving the gap set after being applied does not mean its evidence can be deleted.
- **Estimates for standings without award config**: `node scripts/build-medal-estimates.mjs <reviewed SRK cache dir>` writes a separate `estimatedAwardCutoffs`; skip reasons go to the review attachment. The management page enables estimates by default; the same setting also controls proportional estimates already in the catalog.

## XCPC Rating

```sh
npm run catalog:rating -- fetch tmp/sources/rating-problems.json
npm run catalog:rating -- inspect tmp/sources/rating-problems.json tmp/sources/rating-review.json
# review matched/unmatched entries, then add review: {status:"approved", reviewed_by:"..."}
npm run catalog:rating -- apply tmp/sources/rating-problems.json tmp/sources/rating-review.json
```

- The review package is bound to the SHA256 of its input and of the catalog. Matching uses provider problem ID plus title, or a complete contest mapping plus ordinal/title. An identical problem list does not prove an identical standing.
- Apply only promotes community tags and whole-contest practice links. It never changes member status, internal IDs or per-problem interaction.
- Numeric-only rows may have an exact problem URL but no title. Since the 2026-10-01 second pass, a Rating is filled only when the full problem-ID set matches one-to-one, the catalog already has the reviewed original-event RankLand path, and original start times agree. The source `source_title` stays absent; never fabricate an upstream title. See `2026-10-01-numeric-identity-review.json` and its values receipt. Missing IDs, partial lists and date/identity conflicts are rejected; conflicting values stay unset. Classification `confidence/status` describes tag review, not numeric Rating uncertainty.
- **Ratings for already reviewed problems**: `node scripts/enrich-reviewed-ratings.mjs <raw problems-index.json> [review JSON] [catalog JSON]`. Omitting the review argument uses the original `2026-09-review.json`; new batches must name their own review package. It checks approval status, raw-file SHA, source identity and title, and writes only finite non-negative numbers through reviewed source mappings. Conflicts and gaps are not estimated; problem IDs and member status are untouched.

## RankLand

```sh
npm run catalog:rankland -- fetch tmp/sources/srk tmp/sources/rating-review.json
npm run catalog:rankland -- inspect tmp/sources/srk tmp/sources/rating-review.json tmp/sources/rankland-review.json
# review .audit.json and approve exact mappings per schemas/rankland-review.schema.json
# fill tmp/sources/rankland-review.json.awards.json separately (rankland-award-review schema)
npm run catalog:rankland -- apply tmp/sources/srk tmp/sources/rating-review.json tmp/sources/rankland-review.json
```

- The pinned srk-collection commit lives in `import-rankland-standings.mjs`. To upgrade, use a new cache directory and review again. Fetch handles candidate standings only and keeps the last good data on failure; inspect only writes reports. Apply verifies raw content hashes, page identity, problem count/ordinals, dates and review binding, then writes atomically. Re-applying is idempotent; if the catalog changed, the CLI requires a new review.
- Only promote explicit official gold/silver/bronze counts or a supported official ratio rule, from complete final standings with clear eligibility, interpretable units and no boundary ties. For multiple groups use the highest: invitational over provincial, undergraduate over vocational; an unknown tier stays blocked. Unexplained differences between old and new values keep their review evidence. Legacy XCPCIO refresh skips contests migrated to RankLand; CF Gym never provides onsite award estimates.
- **Refreshing existing mappings**: `node scripts/refresh-standings-audit.mjs <new cache dir>` fetches the current SRK commit, per-contest pages and Board catalog/config, plus team/run for Board contests missing cutoffs. It only writes the cache and an audit report; `--offline` recomputes from downloaded data. After checking identity, ordinals, dates, groups and the report, `node scripts/apply-standings-refresh.mjs <cache dir> <new review attachment path>` fills only missing RankLand cutoffs and never overwrites existing awards or default sources. The published catalog SHA and raw-file SHAs must still match the review. New mappings and conflicts with old values are reviewed separately; never run the old Board full apply over migrated results.
- 2026-09-17 fixed the freeze duration being read as the current frozen state; see `fixtures/imports/rankland/2026-09-17-refresh.json`. Older review attachments are kept as history and no longer describe current gap reasons.
- Official ratio rules are recorded in `fixtures/imports/rankland/2026-09-17-official-ratios.json`; Nanchang and the girls' contests use SRK's cumulative ratio with default `ceil`, and their source stays `explicit`.
- **Estimate eligibility**: `node scripts/audit-estimate-eligibility.mjs <refresh cache>` verifies official-team scope of existing estimates online (`--offline` reuses the cache) and only writes a report. After review, `node scripts/apply-estimate-eligibility-audit.mjs <report> <new attachment>` withdraws estimates whose eligibility cannot be proven; old values are kept in the attachment. The first pass `2026-09-17-estimate-eligibility.json` was followed by the highest-group check `2026-09-17-highest-group-audit.json`; current gaps and replacements are in the [checklist](../docs/contest-update-todo.md#当前牌线缺口2026-09-17). Never reintroduce full-board, cross-group or CF Gym practice-team estimates from historical inputs.
- `fixtures/imports/rankland/2026-09-*` holds mapping reviews, award reviews, full-catalog decisions, diffs and correction evidence; Rating snapshot hashes and per-problem matches are in their own directory. Large raw SRK files are not committed. Synthetic fixtures are for tests only and must never be applied. AGPL data attribution and license ship with the public catalog.

## CF / QOJ problem lists

- CF additions and historical source corrections from 2026-10-02: [review notes](../docs/cf-metadata-import-2026-10-02.md). Sichuan's original 13 problems vs. the current 12-problem CF set is a precise reviewed exception. CF mirror letters for 2016 China Final and 2017 EC Final differ from the original booklets, so the original problem IDs are kept by verified identity. The Qingdao onsite contest no longer carries the 11 online-contest sources.
- CF import validates the whole problem list, ownership of all existing sources and reviewed titles before a single write. Matching letters alone is not enough; unknown titles, duplicate ownership and empty/partial lists are never silently accepted or turned into aliases. A new mirror must name its complete target explicitly; when several contests share a source, never rely on iteration order. `tests/tools/codeforces-import-safety.test.ts` checks failure atomicity and idempotence; `web/tests/unit/codeforces-catalog-repairs.test.ts` checks booklet mappings and simulated member sync, and `web/tests/unit/codeforces-generated-mappings.test.ts` checks generated details and the lookup (`npm run catalog:validate-generated-mappings`).
- `catalog:import-reviewed-cf-problems` and `catalog:import-reviewed-qoj-problems` apply the review files named in those commands; the latter only covers the original eight-contest QOJ batch. Online Contest II uses `node scripts/import-qoj-problems-export.mjs fixtures/imports/qoj/2026-online-ii-problem-list.json`. `catalog:check-reviewed-qoj-problems` checks both batches, including `fixtures/imports/qoj/2026-10-01-reviewed-problem-lists.json`. The `catalog:check-*` commands check completeness and no-op re-imports offline and never write the catalog. A new contest with an already complete problem list can be added only when the export contains `target_contest(s)`.
- **New QOJ problem lists**: log in to QOJ in your own browser and run `browser-fetch-current-contest-problems.mjs` (single contest) or `browser-fetch-qoj-problems.mjs` (batch, with a chosen list of candidate URLs). The `?v=` version must be kept; empty lists, login redirects or a lost version require a re-export. Review the returned contest identity, ordinals, titles, links and version, add explicit targets, then run `scripts/import-qoj-problems-export.mjs <reviewed JSON>`. For a new mirror, an existing target must match problem count, ordinals and reviewed titles/aliases; a real title change is cross-reviewed before adding an alias. Exclusion evidence in `fixtures/imports/qoj/qoj-problem-import-exclusions.json` must not be bypassed. Candidates without a problem list stay in `docs/`. `catalog:refresh` only validates and generates assets; it never imports or fetches.

## Full metadata refresh of existing values

A "refresh" must compare populated fields; the older fill-gaps commands are not a full refresh. Coverage, authentication blockers and per-contest results of the 2026-10-01 full public-source pass are in `fixtures/imports/catalog-completion/2026-10-01-source-refresh.json` and `2026-10-01-source-coverage.json`: all 152 SRK and 143 Board contests got complete current data; for CF only the public catalog could be refreshed because the problem-list API requires authentication; a PTA page shell is not a final standing. QOJ accepts only exports from the user's own authorized browser; server-side scraping or borrowed login state is forbidden.

Save the old raw Rating file first, then fetch a complete new one. The default fill-gaps tool never overwrites; an explicitly authorized full refresh uses:

```sh
node scripts/refresh-xcpc-rating-metadata.mjs inspect old-problems.json new-problems.json review.json catalog/default-catalog.min.json
# review old/new values, tag ownership, direct-source conflicts and source SHA; set review.status=approved and reviewed_by
node scripts/refresh-xcpc-rating-metadata.mjs apply old-problems.json new-problems.json review.json catalog/default-catalog.min.json
# later refreshes pass the applied receipt(s) as trailing arguments
node scripts/refresh-xcpc-rating-metadata.mjs inspect new-problems.json next-problems.json next-review.json catalog/default-catalog.min.json review.json
```

- The receipt records full matches, old→new values, removal grounds, raw SHAs, apply time and output SHA. Existing sources, primary titles, IDs and member status are unchanged.
- A tag is removed only when every historical owner is explicitly superseded by a current classified source. Numeric-only matches without a title, missing, `unknown` and `null` do not authorize removal. Manual and other-source values are kept; a shared provider ID is used only for auditing and never extends ownership transitively. With conflicting values from several direct sources, only the old scalar provably owned by Rating is withdrawn.
