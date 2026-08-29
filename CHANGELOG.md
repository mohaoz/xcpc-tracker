# Changelog

## 0.6.0

### Added

- added build-time XCPCIO Board and Codeforces official standings award cutoff data
- added contest list medal progress filters and award cutoff progress cards
- documented 29 candidate contests without complete problem lists while excluding them from the public catalog and generated site assets
- public catalog validation now rejects empty problem lists and `contest_stub` records
- added 100 verified problem records across eight 2026 contests from seven Codeforces Gym problemsets, with explicit shared mapping for Jiangsu/Guangdong and mirror provenance for CCPC Nanchang
- Codeforces member imports now apply an exact provider problem match to every curated problem that shares it, so shared contest problemsets update coverage on both contests

## 0.5.0

### Changed

- tightened curated catalog filtering for practice contests and multi-provincial tagging
- merged cross-platform contest duplicates when tag subset evidence and problem ordinals support a shared problem set
- refreshed the bundled default catalog for the 0.5.0 release

## 0.3.0

### Added

- browser-local member import and sync through Codeforces handles
- QOJ browser-script member import flow
- local contest detail editing and manual metadata updates in the frontend
- deploy-time generated static catalog assets for faster first load

### Changed

- the product is now documented and shipped as a static, frontend-first XCPC tracker
- `/manage` now focuses on member-data import and export workflows
- default contest catalog is consumed directly from static assets instead of browser-side full initialization

### Notes

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
