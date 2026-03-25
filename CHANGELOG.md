# Changelog

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
