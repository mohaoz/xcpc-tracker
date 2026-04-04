# catalog

The bundled default contest catalog lives here.

Current file:

```text
default-catalog.min.json
```

Current bundle shape:

- top-level snapshot metadata such as `schemaVersion`, `exportKind`, `version`, and `exportedAt`
- `contests[]` records with fields such as `contestId`, `title`, `aliases`, `tags`, `startAt`, `curationStatus`, `problemIds`, `sources`, and optional `notes`
- `problems[]` records with fields such as `problemId`, `contestId`, `ordinal`, `title`, `aliases`, and `sources`

Rules:

- keep the built-in default catalog in this single bundled JSON file
- treat this directory as the canonical source of truth for curated contest metadata
- keep imported data out of `catalog/` until it has been normalized and reviewed
- preserve upstream provenance on `sources`
- prefer stable internal contest and problem IDs over provider-scoped IDs
- keep the bundled catalog `version` aligned with the current release when regenerating the file
