# fixtures/imports

Sample import payloads and provider-side export examples live here.

Use this area for:

- maintainer-reviewed Codeforces problem-list fixtures, including explicit target contest IDs when one upstream Gym maps to multiple curated contests
- QOJ userscript JSON samples
- draft payload examples used by validation and mapper tests

`qoj/2026-pending-contests-draft.json` is a candidate URL list for the existing
`scripts/browser-fetch-qoj-problems.mjs` browser export flow. It contains no
curated problems and is not included in the shipped catalog. Export and review
the problem lists before promoting any of these contests.

`qoj/qoj-members-batch.json` is the accepted snapshot shape produced by the
member-page QOJ batch console script. It intentionally includes both successful
members and a per-handle fetch failure so import behavior remains reviewable.

Do not treat this directory as canonical product data. The canonical curated dataset lives under `catalog/`.

QOJ 2026 contest curation fixtures:

- `qoj/2026-xcpc-browser-export.json`: original user export, five complete contests and three empty responses.
- `qoj/2026-xcpc-browser-retry-export.json`: successful version-preserving retry of Shenzhen, Zhejiang, and Wuhan (39 problems).
- `qoj/2026-xcpc-problem-lists.json`: reviewed `target_contest` metadata with eight complete problem lists (103 problems); imported into the canonical catalog. Generic exported `QOJ.ac` headings remain raw evidence, not contest aliases.
- `qoj/contest-export-regression.json`: synthetic offline fixture for query parameters, relative links, and unrelated contest links.
- `qoj/2026-retry-contests-draft.json`: historical retry input; all three contests are now curated.

RankLand design fixtures live in `rankland/`: `mapping-review.example.json` and `award-review.example.json` cover review states, pinned provenance and medal group semantics. Both are synthetic and must never be applied to the catalog. See `docs/rankland-schema-design.md` for the contract and optional offline Python validation command.
