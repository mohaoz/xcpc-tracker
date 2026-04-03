# schemas

JSON Schema files for curated catalog data and import payload validation live here.

Planned schemas:

- `contest.schema.json`
- `qoj-import.schema.json`
- `codeforces-import.schema.json`

QOJ member import is browser-assisted:

- run the browser console script on a QOJ user profile page
- export a raw `provider = "qoj"` JSON payload
- import that JSON through the app's member import flow

Schema validation should run in CI before static deployment.
