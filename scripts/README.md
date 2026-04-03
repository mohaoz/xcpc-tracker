# scripts

Build-time and migration-time scripts live here.

Expected responsibilities:

- validate curated catalog JSON
- support one-time migration/export tasks from legacy runtime data when needed

Normal product usage must not depend on these scripts running locally.

Current commands:

- `npm run catalog:validate`
- `node scripts/import-qoj-contests-page.mjs /path/to/qoj-contests.md [output.json]`
- `node scripts/extract-qoj-contests-from-mht.mjs [input.mht] [output.json]`
- `node scripts/extract-qoj-contests-from-mht.mjs --mode=catalog [input.mht] [output.json]`
- `node scripts/merge-platform-catalogs.mjs [codeforces-catalog.json] [qoj-catalog.json] [output.json]`
- `node scripts/convert-qoj-browser-export-to-catalog.mjs [browser-export.json] [output.json]`

Current implementation notes:

- tooling is written in TypeScript
- the first pass intentionally uses minimal dependencies and repo-local validation rules
- the built-in source catalog is read from `catalog/default-catalog.min.json`

CI:

- `.github/workflows/static-catalog.yml` installs frontend dependencies, validates curated catalog files, and builds the SPA
