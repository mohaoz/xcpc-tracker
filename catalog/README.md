# catalog

The bundled default contest catalog lives here.

Current file:

```text
default-catalog.min.json
```

Current bundle shape:

- top-level snapshot metadata such as `schemaVersion`, `exportKind`, `version`, and `exportedAt`
- `contests[]` records with fields such as `contestId`, `title`, `aliases`, `tags`, `startAt`, `curationStatus`, `problemIds`, `sources`, optional `awardCutoffs`, and optional `notes`
- `problems[]` records with fields such as `problemId`, `contestId`, `ordinal`, `title`, `aliases`, and `sources`

Rules:

- keep the built-in default catalog in this single bundled JSON file
- treat this directory as the canonical source of truth for curated contest metadata
- keep imported data out of `catalog/` until it has been normalized and reviewed
- publish a contest only after its reviewed problem list is available; keep no-problem candidates in project documentation instead of this public bundle
- reject contests with empty problem lists or `curationStatus = contest_stub` during public catalog validation
- preserve upstream provenance on `sources`
- preserve existing optional source metadata: `variant` on contest/problem sources and `notes` on contest sources; the contest JSON Schema accepts these strings
- keep derived award cutoff provenance in `awardCutoffs.sourceProvider`, `awardCutoffs.sourceLabel`, and `awardCutoffs.sourceUrl`
- prefer verified RankLand standings and audited official award cutoffs; preserve XCPCIO / Codeforces fallbacks where a migration is blocked or unverified
- prefer stable internal contest and problem IDs over provider-scoped IDs
- keep the bundled catalog `version` aligned with the current release when regenerating the file

## Attribution and data license

RankLand summaries derive from [algoUX / srk-collection](https://github.com/algoux/srk-collection), pinned at `a820e48181a28a1a30bfbcf965b320606e337e15`. Upstream contributors include XCPCIO and algoUX. The SRK-derived catalog data and its review evidence are provided under AGPL-3.0; see [LICENSE-SRK.txt](LICENSE-SRK.txt) and the editable catalog/source history in this repository. This data notice does not relicense unrelated application code.

Problem tags and whole-contest practice-link candidates come from [XCPC Rating](https://hei-maom.github.io/xcpcrating/#/problems), by [Hei-MaoM](https://github.com/Hei-MaoM/xcpcrating). Metadata provenance is recorded on problem sources; community tags are visible only in spoiler mode. CF/QOJ problem mappings remain authoritative for individual member coverage. Other source attributions remain attached to each contest/problem.
