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

- `catalog-snapshot.schema.json` validates the actual flat bundled catalog, including optional problem tags, source defaults and award cutoffs; `catalog-bundle.schema.json` describes the legacy nested bundle
- provider import schemas are for accepted raw payload examples and fixture validation
- runtime IndexedDB records are validated by application code rather than stored as schema-authored repo data

RankLand source, mapping-review and award-review schemas bind fixed Git paths and content hashes to independently reviewed links and medal groups. Node validation runs in the default build. Synthetic examples must never be applied. Optional Python schema design checks remain available for maintainers.
