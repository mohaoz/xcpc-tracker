# Changelog

## 0.3.0

### Added

- browser-local member import and sync through Codeforces handles
- QOJ browser-script member import flow
- one-click local initialization from the bundled default catalog
- automatic forced re-init when the bundled catalog minor version is newer than the locally applied version
- local contest detail editing and manual metadata updates in the frontend

### Changed

- the product is now documented and shipped as a static, frontend-first XCPC tracker
- `/manage` now acts as the local workspace for init, import, and export workflows
- the bundled default catalog carries a release-aligned `version` field

### Notes

- forced local re-init clears browser-local member data and requires member imports to be run again
- curated contest data remains Git-managed; runtime member state remains browser-local

## 0.1.1

### Added

- contest pool pagination with page-number jumps
- pool scope filtering including `no-fresh-only`
- per-problem status strips on contest cards
- contest intake page for import/export and sync actions
- `Sync Missing Contests` flow for contests imported without full problem sync
- intake operation logs for sync, import, and export actions
- Chinese project README at `README.zh-CN.md`

### Changed

- contest cards are now more compact and focus on problem count, solved count, tags, and status strips
- old summary rows are backfilled so newly added problem-state strips appear for existing data
- documentation across root docs, app READMEs, and design notes was updated to match the current MVP
- project version bumped to `0.1.1`

### Notes

- a contest showing `0 problems` usually means the contest record exists locally but the contest has not been fully synced yet
- use `Sync Missing Contests` from the Intake page to sync only those contests
