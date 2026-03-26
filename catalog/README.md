# catalog

Human-edited curated dataset source files live here.

Rules:

- keep the built-in default source in a single bundled JSON file
- avoid repeating fields that can be derived from tags
- reviewed, versioned data only
- this directory is the canonical source of truth for curated contest metadata
- imported data must be normalized and reviewed before entering this directory
- generated artifacts belong in `generated/`, not here

Planned layout:

```text
default-catalog.min.json
```

Recommended contest fields:

- `id`: stable internal contest id, currently a UUID
- `title`: primary display title
- `aliases`: alternative titles or well-known formal names
- `tags`: browsing and filtering tags
- `start_at`: optional ISO-like start timestamp when known
- `curation_status`: `contest_stub`, `problem_listed`, or `reviewed`
- `sources`: external source links and provider identifiers
- `problems`: curated problem list, possibly empty for early stubs
- `notes`: optional curator notes
