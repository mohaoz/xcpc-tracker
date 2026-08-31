# fixtures/imports

Sample import payloads and provider-side export examples live here.

Use this area for:

- maintainer-reviewed Codeforces problem-list fixtures, including explicit target contest IDs when one upstream Gym maps to multiple curated contests
- QOJ userscript JSON samples
- draft payload examples used by validation and mapper tests

`qoj/qoj-members-batch.json` is the accepted snapshot shape produced by the
member-page QOJ batch console script. It intentionally includes both successful
members and a per-handle fetch failure so import behavior remains reviewable.

Do not treat this directory as canonical product data. The canonical curated dataset lives under `catalog/`.
