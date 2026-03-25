# packages/schemas

Canonical schema notes and examples shared across service and frontend contracts.

Current project status:

- canonical storage currently lives in the service SQLite schema
- the key entities remain `contest`, `problem`, `artifact`, `submission`, and `identity_binding`
- `member_problem_status` and `contest_coverage_summary` are focused supporting tables for MVP query speed and list rendering
- this package is reserved for future extracted schema docs and examples once cross-package reuse becomes worthwhile
