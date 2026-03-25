# Codeforces Fixtures

Fixtures under this directory should support deterministic tests for the current Codeforces Gym MVP.

## Rules
- Keep API fixtures under `api/`.
- Keep statement/editorial/resource HTML fixtures under `html/`.
- Keep downloaded PDFs or derived PDF metadata fixtures under `pdf/`.
- Name fixtures by endpoint or page role plus a stable sample identifier.
- Keep normalized expectations beside the raw fixture when parser behavior depends on it.

## Recommended Coverage
- `contest.standings` sample for a Gym contest.
- `user.status` samples for tracked members with solved and tried outcomes.
- samples that exercise imported contests later receiving a full sync.
- HTML placeholder samples for statement/resource extraction.
