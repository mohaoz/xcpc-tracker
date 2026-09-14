# fixtures/imports

Sample import payloads and provider-side export examples live here.

Use this area for:

- maintainer-reviewed Codeforces problem-list fixtures, including explicit target contest IDs when one upstream Gym maps to multiple curated contests
- QOJ userscript JSON samples
- draft payload examples used by validation and mapper tests

`qoj/2026-pending-contests-draft.json` is the historical browser-export input for
the completed eight-contest batch, not today's pending list. It contains URLs,
not curated problems. Current candidates are tracked in
[the contest checklist](../../docs/contest-update-todo.md).

`qoj/qoj-members-batch.json` is the accepted snapshot shape produced by the
member-page QOJ batch console script. It intentionally includes both successful
members and a per-handle fetch failure so import behavior remains reviewable.

Do not treat this directory as canonical product data. The canonical curated dataset lives under `catalog/`.

QOJ 2026 contest curation fixtures:

- `qoj/2026-xcpc-browser-export.json`: original user export, five complete contests and three empty responses.
- `qoj/2026-xcpc-browser-retry-export.json`: successful version-preserving retry of Shenzhen, Zhejiang, and Wuhan (39 problems).
- `qoj/2026-xcpc-problem-lists.json`: reviewed `target_contest` metadata with eight complete problem lists (103 problems); imported into the canonical catalog. Generic exported `QOJ.ac` headings remain raw evidence, not contest aliases.
- `qoj/2026-online-ii-problem-list.json`: reviewed QOJ 4113 A–L problem list from a user-saved contest page; contains catalog metadata only, not the saved user's solve state.
- `qoj/contest-export-regression.json`: synthetic offline fixture for query parameters, relative links, and unrelated contest links.
- `qoj/2026-retry-contests-draft.json`: historical retry input; all three contests are now curated.

RankLand fixtures live in `rankland/`: `mapping-review.example.json` and `award-review.example.json` are synthetic and must never be applied. `2026-09-*` contains actual audited source identities, award decisions, differences, fallbacks and corrections. `xcpc-rating/2026-09-review.json` records the source snapshot hash, matches and unresolved rows. `xcpcio-2026-gap-awards.json` records the later XCPCIO award backfill and blocked groups. These are provenance and regression inputs, not another canonical catalog. See [maintenance instructions](../../scripts/README.md) for commands.
