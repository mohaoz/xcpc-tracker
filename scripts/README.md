# scripts

Build-time and migration-time scripts live here.

Expected responsibilities:

- validate curated catalog JSON
- support one-time migration/export tasks from legacy runtime data when needed

Normal product usage must not depend on these scripts running locally.

Current commands:

- `npm run catalog:validate`

Current implementation notes:

- tooling is written in TypeScript
- the first pass intentionally uses minimal dependencies and repo-local validation rules
- the built-in source catalog is read from `catalog/default-catalog.min.json`

CI:

- `.github/workflows/static-catalog.yml` installs frontend dependencies, validates curated catalog files, and builds the SPA
