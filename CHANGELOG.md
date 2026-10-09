# Changelog

## Unreleased

- The contest list and contest detail share one member selection, editable on both pages and kept in the `members` URL. Coverage, "未做", placement and spoiler defaults all follow the selected members; attempts without solves place at Fe, untouched contests have no placement.
- Contest detail: whole-contest practice links under the title; heatmap with per-member totals and a merged "全队" row; mark mode next to the heatmap with an explanation; sources and edit/delete in a collapsed "来源与维护" section; no horizontal page overflow on phones.
- Member detail links to that member's contests and can add another account to the member. Visible search syntax help, readable list badges, one color for "attempted", and stale or internal messages removed.
- QOJ help is now a linkable page (`/help/qoj`) covering both sync modes, live script status, auto sync, error codes and privacy.
- Docs: English agent/maintainer docs, product constraints and a roadmap. Removed the generated `.archify` report.

## 0.8.4

- Add the verified 2025 Guizhou provincial contest with 13 problems, 13 XCPC Rating values, original date and explicit awards. Review the user's CF export without inferring anonymous Gym access.
- Correct Sichuan 2021's CF C mapping to original J (Ants), add the existing I mirror, and keep the original 13-problem identity despite the current 12-problem CF list.
- Remove 11 Qingdao online-contest sources accidentally attached to onsite problems; correct five China Final 2016 and two EC Final 2017 mirror mappings. Remove 18 false cross-problem aliases using uploaded dashboards and original contest booklets.
- Reject ambiguous ownership, ordinal-only title mismatches and incomplete CF imports atomically; verify idempotence and generated lookup ownership. Stop fabricating missing CF problem URLs from contest IDs and original letters.
- Apply corrected mappings to future imports while retaining historical member evidence; no inferred status migration or database schema upgrade is included.

## 0.8.3

- Add Guangxi 2023–2025 with 38 reviewed problems and the 11-problem CF mirror for the existing 2018 World Finals. Preserve existing contest/problem IDs, titles and mappings.
- Fill 14 standings source entries, 127 original-event dates, 62 verified problem ratings and additional community tags on 682 problems. Keep conflicting ratings unset.
- Add cutoffs for eight contests; replace eight old estimates with verified explicit awards and correct 31 estimates. Withdraw 12 estimates with tied boundaries, incomplete feeds or unresolved highest groups, retaining all previous values and source evidence.
- Correct Board per-medal rounding, boundary ties, highest-group selection, legacy timestamp/status/official-marker compatibility; validate the completion receipts in offline release checks. Keep candidates without verified complete lists outside the published catalog.

- Integrate the user’s reviewed 12-contest/150-problem QOJ export: add three contests/37 problems and 113 existing-problem mirrors; preserve exact QOJ versions and curated primary titles.
- Audit XCPC Rating numeric-only full-ID matches, then refresh populated source-owned metadata: final 1706 ratings, with old/new ownership receipts, stale-tag removals, manual-value preservation and direct-source conflict handling.
- Verify original DOMjudge/ICPC World Finals awards, CCPC school-ranked rules, CCPC preset semantics and all public RankLand/Board snapshots. Correct nine additional explicit cutoffs and add four, reaching 123 explicit awards and 28 labeled estimates.
- Track the remaining full-QOJ export, authenticated CF problem lists and incomplete Pintia standings separately; no incomplete source is represented as fully refreshed.

## 0.8.2

- Add five complete 2026 contests: CCPC Online, Beijing, CCPC Qinhuangdao/Hebei, ICPC Guizhou and Hong Kong Joint, totaling 62 problems.
- Keep both official and unofficial CF mirrors for CCPC Nanchang, with all 13 problem mappings; add the CF mirror to the existing 12-problem ICPC Online II contest. Preserve existing IDs, QOJ sources and awards.
- Permit explicitly reviewed CF mirrors only when their complete problem counts, ordinals and titles match.

## 0.8.1

- Enabling automatic sync also enables QOJ userscript mode for first imports and updates, including previously saved automatic-only settings. Missing scripts show installation help instead of manual import.
- Add a management-page action to QOJ setup help. Keep script and automatic-sync settings consistent without clearing member records.

## 0.8.0

- Refresh verified RankLand and XCPCIO Board sources. Correct SRK freeze-duration interpretation and support official ratio rules, including Nanchang. Remove unaudited Gym/all-team/mixed-group estimates, replace verified sources, and retain explicit unresolved gaps.

- Keep QOJ manual import as the default and introduce the optional userscript in a one-time startup dialog. Preserve saved mode preferences.
- Unify QOJ member creation and updates under a global userscript setting; keep manual export/import in one dialog and periodic sync opt-in.
- Add browser-assisted QOJ sync, concise failure dialogs, failure-preserving imports, cross-tab locking and site-driven script update prompts.
- One optional automatic-sync setting updates CF and QOJ concurrently. Manual failures are not retried automatically; missing browser globals no longer break Node CI.
- Keep CF/QOJ actions together on members, manual import in a dialog, and aligned backup import/export in management. Fix generated detail JSON availability during local catalog refresh.
- Add Cloudflare Web Analytics to the page entry point for site traffic statistics.

## 0.7.1

- Backfill five XCPCIO award datasets with audited group/penalty rules; retain explicit gaps for Shaanxi/GBA group ambiguity. Default bulk spoilers off and medal estimates on, preserving saved preferences.
- Add the 2026 ICPC Asia East Continent Online Contest (II), with 12 reviewed QOJ problems from a user-saved contest page.
- Put the coverage heatmap in its own card above awards to keep its position stable when spoiler information is toggled.
- Split member-row/problem-column heatmap from metadata, move management actions to the bottom, use CF rating colors, and add a default-on persistent medal ratio estimate setting.
- Separate tags and XCPC Rating into spoiler-only columns; compact member coverage into a per-problem/per-member heatmap, add management bulk spoiler control, and align footer with the content edge.
- Hide the date on contest list cards; retain date metadata and chronological sorting.
- Move spoiler controls into a compact detail-header switch; remove duplicate standings entry and redundant date disclaimer.
- Remove the import-gap notice from contest list and detail pages; retain import records and import-flow feedback.

## 0.7.0

- Add persistent per-contest spoiler controls across list/detail: untouched contests hide medal cutoffs, awards and problem tags; manual choices override attempted/solved defaults.
- Correct “未做” to mean no attempted or solved problems among selected members.
- Integrate 139 verified RankLand standings, 10 audited award cutoffs and 1413 community-tagged problems from XCPC Rating; retain whole-contest practice links and explicit source fallbacks.
- Use the highest eligible group for VP reference awards, including invitational over provincial; remove the incorrect ICPC standings and award data from 2025 CCPC Nanchang.
- Show simple import freshness/failure/unmatched summaries; retain CF unresolved provenance and last successful status on failure.
- Add offline schema/data/state checks and browser regression; simplify refresh to preserve the canonical catalog and remove obsolete planning documents.

### Added

- added 103 reviewed QOJ problems across eight 2026 contests, including online contest I, Shenzhen, Zhejiang, Xi’an, Wuhan/Hubei, Shandong, Shanghai, and Shenyang

- added 39 reviewed problems across the 2026 Heilongjiang provincial contest, CCPC Fujian/Fuzhou invitational, and Chongqing provincial contest, with Codeforces problem sources and PTA standings links

### Changed

- preserve QOJ version parameters in contest exports and report empty lists, login redirects, and version changes as failures
- allow explicitly reviewed QOJ drafts to create complete contests, with offline regression and repeat-import checks in deployment validation

- aligned the contest JSON Schema with existing optional source variant and provenance notes
- batch contest coverage reads and reuse indexed member status when changing filters
- retain the contest list across navigation and refresh it after local data changes without hiding existing cards


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
