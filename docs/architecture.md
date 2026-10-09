# Architecture and data contracts

XCPC Tracker is a static Vue/TypeScript frontend. It reads a Git-managed catalog plus member data stored in the browser (IndexedDB via Dexie). There is no runtime backend, account system or cloud sync.

Product rules and source-priority rules live in [AGENTS.md](../AGENTS.md). Maintenance commands live in [scripts/README.md](../scripts/README.md). This file records current runtime and persistence contracts.

## Static catalog

- `catalog/default-catalog.min.json` is the only canonical catalog.
- The build generates a contest index, a coverage basis (problem IDs per contest), a CF/QOJ problem lookup and per-contest detail files. The browser fetches them on demand. A catalog version change must never trigger a full in-browser catalog initialization.
- Internal contest/problem IDs, primary titles and CF/QOJ mappings are stable.
- IndexedDB `catalogContests` / `catalogProblems` hold only local manual edits. At runtime a local contest is used when the bundled catalog lacks it or when it has `generatedFrom: "manual"`; a local deletion marker hides the contest. Local edits are whole-contest snapshots and are not part of member backups.

## Standings and awards

RankLand/SRK, XCPC Rating and onsite standings are fetched, matched and reviewed at build time only. The browser never requests SRK or Rating upstreams and never derives member status from standings or ratings.

- SRK `contest.frozenDuration` is the scheduled freeze length, not the current frozen state; missing means zero. A standing is usable only when the contest has ended, every row has complete problem statuses with no unrevealed/pending results, and solved totals agree. A non-zero freeze length alone does not reject a historical final standing. Spec: https://srk.algoux.org/en/guide/contest-and-problems
- An SRK `rule.options.ratio` set by the upstream is an official award rule. It is not affected by the estimate setting. Boundaries use the upstream cumulative ratio and rounding (default `ceil`). Only the "all official teams" denominator is supported; other denominators, combined rules and boundary ties stay pending review.
- Fallback estimates (`estimatedAwardCutoffs`) are built from complete, verified standings: gold/silver/bronze counts are each `floor(eligible × 10%/20%/30%)` (cumulative 10%/30%/60%). A tier with fewer than one team gets no cutoff. Highest-group and official-team filtering apply; incomplete standings or an unknown group produce no estimate.
- CF Gym `CONTESTANT` rows do not prove onsite official status and must not be used for estimates. A Board without an explicit official-team marker must not fall back to the full board.
- List and detail share one award selection: explicit awards first; estimates only when `allow_medal_estimates` is on.

## Local storage

Database `xcpc_tracker_local`, current Dexie version 7. Schema history that affects existing data:

- v5 adds `contestPreferences` (key `contest_id`): `{ contest_id, spoiler_mode: "spoiler" | "non_spoiler" }`. Only manual per-contest choices are stored.
- v6 adds `appSettings` (key `key`) for settings: `allow_medal_estimates` (default true), `auto_sync` (legacy `qoj_auto_sync` is read when missing), `qoj_use_userscript` (default false), `spoiler_default` (string `all` / `touched` / `none`, default `touched`; the only non-boolean value, unknown values read as `touched`), `spoiler_prefs_v2` (one-time cleanup flag, see Coverage, list and spoilers) and `qoj_script_intro_seen`.
- v7 adds an optional `handleId` index to `memberProblemStatus`. Statuses are stored per member, problem and account, and merged per member for display (solved beats attempted). The upgrade only re-keys legacy rows whose account can be determined from `sourceRecordId` or import metadata; unattributable rows are kept as-is. Overlapping multi-account evidence already merged by older versions cannot be recovered; re-syncing the remaining accounts restores it.

### Identity

- Members and accounts carry a local `identityRevision`. Deleting a member or unlinking an account soft-deletes it (`deletedAt`); a deleted account no longer claims the platform handle and may be re-linked to a new member. Re-linking does not inherit the old display name, creation time or problem statuses.
- An active account binding is never transferred between members.
- Every sync captures the member/account identity before queuing (batch syncs capture once per batch) and re-checks it inside the write transaction. A response for a deleted, recreated, unlinked or re-linked identity must not restore data. The QOJ manual dialog captures target identities when it generates the export script; waiting for paste, locks or catalog loading does not re-authorize them.
- Manual marks on the detail heatmap carry the visible member's `identityRevision`; both read and write transactions verify it.
- Existing member and account display names are preserved on sync; there is no reliable "edited by user" marker, so names are not overwritten.

### Imports

- CF and QOJ payloads are normalized, validated and mapped first, then members, accounts, statuses, sources and sync records are written in one transaction. Validation errors, ownership conflicts, write failures or cancellation leave no partial import.
- Missing solved/attempted arrays are a parse error, never an empty record.
- An explicit per-account fetch failure inside a payload records failure evidence and keeps that account's previous status; valid results in the same payload are still imported.
- Unmatched records stay in import source metadata. Imports report results and failures in the import flow only; the contest list/detail import-gap banner stays removed.

## Backups

- Member backups use `schemaVersion: 1` ([schema](../schemas/local-runtime-snapshot.schema.json)). `handleId` is optional for compatibility; legacy statuses without it use the v7 attribution rule, and unknown ownership is never guessed.
- Backups may include `contest_preferences` and `app_settings: { allow_medal_estimates, spoiler_default }`. A backup missing a setting keeps the current value. `contest_preferences` are restored only from backups that contain `spoiler_default`; older backups may hold bulk-written rows for every contest, so their per-contest rows are ignored. `identityRevision` is never exported; restores generate new revisions (overwrite/re-link) or keep local ones for still-valid identities (merge).
- Restores validate structure, enums, timestamps, unique keys and references before writing, then apply in one transaction.
- **Overwrite** replaces members and statuses; with "include statuses" unchecked it clears statuses. The UI states this and confirms current vs. imported counts before writing. **Merge** never transfers an active account binding; without statuses it keeps existing statuses.

## Coverage, list and spoilers

- "未做" means no selected member has attempted or solved any problem in the contest.
- The contest list batch-reads members, accounts and statuses once and computes coverage in memory; changing filters reuses that snapshot instead of reading the database per contest. Committed Dexie writes invalidate it; failed loads can be retried.
- The list renders every matching contest (no pagination). Each card is memoized on its coverage summary, award range and spoiler state so filter changes only re-render affected cards. The list is kept alive across navigation. The URL stores the query, list mode and selected members.
- Contest detail and member detail subscribe with Dexie `liveQuery` to committed changes from this and other tabs. Subscriptions are cancelled on route change/unmount; stale async results must not overwrite a newer page.
- Contest detail renders the member-row/problem-column coverage heatmap above the award card, so toggling spoilers does not move it; nothing above the heatmap depends on spoiler state. Each member row ends with solved/attempted totals, and a "全队" row shows the merged status per problem, whose solved count drives placement. Cells are buttons only in mark mode. A right-hand "来源与整理说明" column always shows aliases and every contest source as a card; contest links (CF Gym / QOJ) and standings (RankLand / XCPCIO) are shown equally and regardless of spoiler state, so nothing in the layout depends on spoilers. Edit/delete live in a collapsed "维护" section. Problem tags and Rating are a separate table.
- The contest list and contest detail share one member selection (`selectedMemberIds` in the contest-list store). Coverage, "未做", placement and the spoiler default are all computed from it. The store keeps an explicit "follow all members" intent, so members added later, or recreated after the pool was empty, are selected automatically; a deliberate subset only loses deleted members.
- The selection is mirrored to a `members` URL parameter on both pages (omitted while following all members), and list links to detail carry it. URLs are read when a page first loads (a detail URL's own `members` wins there); while the app runs, the shared selection is authoritative, so browser back to the list keeps changes made on detail and the list rewrites its URL on re-activation. The list only writes its URL while it is the active page, because it stays alive behind detail. Member detail's "查看 TA 的比赛" sets the selection directly.
- Detail subscribes to member data with `liveQuery` and derives coverage in memory from the selection, so changing members needs no new subscription. Placement requires the selected members to have touched the contest: attempts without solves place at Fe; no attempts (including an empty selection) means no placement.
- Spoilers: a manual per-contest choice wins; otherwise `spoiler_default` decides (`all`: every contest shows spoilers; `touched`: only contests touched by the selected members; `none`: no contest, and touched contests show ✓ in the list). Changing the selection can change the default; opening a detail page does not. Until preferences and the setting load, spoilers stay hidden. Both sync across pages and tabs.
- Every flip of a detail page's spoiler switch is stored in `contestPreferences` and kept until reset: "恢复默认" next to the switch removes one row (the button keeps its space when idle so the layout above the heatmap never shifts), and management's "全部恢复默认" clears all rows. The list's `✓` badge marks a touched contest whose spoilers are hidden by such a manual choice.
- Earlier versions implemented the bulk switch by writing a row for every contest, which cannot be told apart from manual choices. On first load `migrateSpoilerPreferencesOnce` clears `contestPreferences` once and sets `spoiler_prefs_v2` in the same transaction, so everyone starts from the default. This deliberately avoids a schema version bump, which would disconnect open tabs running older code and prevent rolling the site back.
- Non-spoiler hides award cutoffs, award ranges, the award card, related gap notices, problem tags and Rating, and makes award search tokens not match. Coverage, practice links and general contest info stay visible. The editor keeps tag data but does not expose tags in the manual problem-list JSON.
- The management page's "默认剧透" selector only writes `spoiler_default`; it never touches manual choices.

## CF and QOJ sync

### Modes and settings

- CF uses the official API from the browser.
- QOJ defaults to **manual import**: one dialog to copy an export script, open QOJ, run it in the user's own console, then paste or upload the JSON. The script copies its result to the clipboard, or downloads a JSON file if clipboard access is denied.
- `qoj_use_userscript` switches QOJ member creation and updates to the **userscript bridge** (`scripts/qoj-sync.user.js`); manual export remains available as a fallback. Switching modes never clears records.
- `auto_sync` (default off) runs CF and QOJ periodically and also enables userscript mode, including for first imports. Turning auto sync off keeps userscript mode; turning userscript mode off also turns auto sync off. When legacy data has only auto sync enabled, it is read as userscript mode, and the next toggle writes both keys in one transaction. These settings are not part of backups.
- A one-time startup dialog introduces the userscript without enabling, installing or opening anything. It is claimed transactionally across tabs and yields to other dialogs.

### Scheduling and failures

- CF and QOJ are scheduled in parallel; each processes accounts serially and neither blocks the other on failure.
- Automatic runs happen only while the page is visible, skip accounts synced successfully within 30 minutes, and re-check when the window regains focus.
- Web Locks serialize sync across same-origin tabs, and sync records are re-read after acquiring the lock. Without Web Locks, automatic sync is refused rather than duplicating requests. Different origins (localhost vs. production) share neither locks nor databases.
- Ordinary failures back off exponentially from 1 to 30 minutes; HTTP 429 waits at least 5 minutes and honors `Retry-After`. Login, challenge, permission and parse failures pause scheduled retries until the user acts. Manual syncs also respect rate limits.
- A manual sync runs once. Its failure is marked `summaryJson.manual` and is never retried automatically, even with auto sync on; a later manual success restores normal scheduling.
- Cancellation reasons are stored in `syncRecords.summaryJson.cancellation_reason`: `settings_disabled`, `user_cancelled` or `target_removed`. Only automatic runs interrupted by `settings_disabled` resume when auto sync is re-enabled (without counting as a backoff failure, and only after the old run finishes). Manual failures, user stops, removed targets and legacy cancellations without a reason are not resumed.
- Failures never clear the last successful data. Sync times, errors and backoff state live in `syncRecords.summaryJson`; no extra store.

### Userscript bridge

- The frontend talks to the script with same-window, same-origin, versioned `xcpc-sync` messages: `hello`, `syncMember`, `cancel`. `hello` does not touch QOJ.
- The script fetches only fixed QOJ profile URLs using the user's own browser session. It accepts no arbitrary URLs, headers or code, never exports cookies, and does not cache results. Requests are serial with timeouts, cancellation, throttling and strict parsing; a missing solved/attempted section is a parse error.
- Production builds (including preview) and the repository script only allow `https://mohaoz.github.io/xcpc-tracker/`. Only the script served by the Vite dev server additionally allows `localhost`/`127.0.0.1:5173`. Installing the script is the authorization; no second confirmation is stored.
- Updates are detected by the site, not by the userscript manager (`@downloadURL none`). The build emits the `.user.js` and a version manifest. With a connected script, the site checks the same-origin manifest at most every 6 hours (5 minutes after a failure). An outdated script triggers a "QOJ 脚本有更新" dialog once per version pair per page session; it never overrides another dialog and never appears when the script is not connected. Below the minimum protocol version, sync is blocked until the user updates. Every release of the script must bump `@version`.

### Feedback and help

- Site-wide help lives at `/help`, linked from the header nav ("帮助") only. It explains the four uses, "未做", the shared member selection, search syntax, placement rules, spoilers, sync, backups and data sources, and links to `/help/qoj`. The header link matters because the contest list renders every contest, so the footer is far down the page.

- The members page shows CF and QOJ sync buttons side by side in one card. The script connection state is shown inside the QOJ button; there is no separate "check connection" button or permanent install notice.
- One shared feedback dialog reports manual successes, failures and connection checks. In the background, the same error for the same account is shown at most once per page session (cleared on success). Connection state is shown separately and does not replace the failure reason.
- Help is a linkable page at `/help/qoj`, not a dialog. It covers both modes, live script status with install/update, auto-sync rules, troubleshooting per error code (using the same messages as the sync store) and permissions/privacy. Entry points: the "?" in the QOJ button group (shown in both modes), the manual dialog, the startup intro, the site help page, and the short "未连接 QOJ 同步脚本" dialog shown when a manual sync finds no script. Opening pages, silent checks and background checks never open help on their own.

## Testing notes

- `tests/e2e/qoj-userscript-bridge.spec.ts` (run with `npm run test:e2e`, which starts the dev server) uses isolated browser storage and a mocked QOJ transport to test the script, importers, scheduling, dialogs and cross-tab locks; it never contacts QOJ or touches user data. Frontend logic is covered by Vitest in `web/tests/unit/`, tools and catalog data by Vitest in `tests/tools/`.
- Cross-origin behavior, real login state and userscript-manager permissions must be checked in a real browser with the userscript installed; mocked responses do not replace that. Auto sync does not bypass QOJ challenges and does not run while the site is closed.
