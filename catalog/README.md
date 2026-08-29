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
- keep derived award cutoff provenance in `awardCutoffs.sourceProvider`, `awardCutoffs.sourceLabel`, and `awardCutoffs.sourceUrl`
- prefer XCPCIO Board award cutoffs when available; use Codeforces official standings as a build-time fallback for Codeforces contests without board cutoffs
- prefer stable internal contest and problem IDs over provider-scoped IDs
- keep the bundled catalog `version` aligned with the current release when regenerating the file
