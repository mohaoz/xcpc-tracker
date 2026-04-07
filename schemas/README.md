# schemas

JSON Schema files for curated catalog data and import payload validation live here.

Current schemas:

- `catalog-bundle.schema.json`
- `contest.schema.json`
- `qoj-import.schema.json`
- `codeforces-import.schema.json`

QOJ member import is browser-assisted:

- run the browser console script on a QOJ user profile page
- export a raw `provider = "qoj"` JSON payload
- import that JSON through the app's member import flow

Schema validation should run in CI before static deployment.

Current usage notes:

- `catalog-bundle.schema.json` validates the bundled catalog artifact shape used at build and release time
- provider import schemas are for accepted raw payload examples and fixture validation
- runtime IndexedDB records are validated by application code rather than stored as schema-authored repo data
