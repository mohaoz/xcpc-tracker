# Roadmap

Proposed direction, not a commitment. Every item must respect the product constraints in [AGENTS.md](../AGENTS.md#product-invariants) and is designed separately before implementation. Per-contest catalog work is tracked in the [contest checklist](contest-update-todo.md).

Items are grouped by the four uses: (1) see what teammates have done, (2) find contests the team has not touched, (3) write catalog problems individually, (4) check how the team did.

Use 4 is already covered: the contest list shows the selected members' Fe/Cu/Ag/Au range for every touched contest, and searching `au`/`ag`/`cu`/`fe` together with the "已做" mode and the result count gives the per-tier totals.

## Proposed

### Incremental UX improvements (all uses)

Principles: improve one page or one flow per change; never remove a feature (moving or renaming is fine); keep URLs, stored data and existing interactions working; each step ships with a visual check and the relevant browser tests. Spoiler, "未做" and English CP terms (solved, fresh, Fe/Cu/Ag/Au) are not changed by UX work.

Steps 1–3 (consistency and copy, each use's main action, separating maintenance from everyday use) and the narrow-screen overflow fix are done. Remaining:

**Step 4 — visual system cleanup**

- Component styles hard-code colors (`#146e75`, `#fffdf9`, `#657482`, …) instead of the shared tokens, and many templates use inline `style=""`. Move them onto tokens/classes so later visual changes stay consistent.
- List cards nest buttons (medal badge, tag chips) inside the card link; make the interactive structure valid without changing what each click does.

### Saved teams (uses 2, 4)

A team is syntactic sugar over the member selection; coverage, "未做", placement and spoiler defaults already follow the selection.

- Save named member combinations (`team = [members]`) and switch between them; today a team is only the current member selection or the `members` URL parameter.
- Needs a new IndexedDB store: document the upgrade and migration intent in `docs/architecture.md` first, and decide whether teams belong in member backups.

### Teammate activity (use 1)

- List teammates' recent solves of catalog problems.
- Blocker: local `firstSeenAt`/`lastSeenAt` are import times, and a first sync stamps the whole history with one time. CF submissions carry their own submission time, so the CF importer could store it; QOJ profiles list problem IDs only, so QOJ entries can only show "first seen since a sync". Changing what is stored needs an architecture note before implementation.

### Link to XCPC Rating per contest (use 3)

- From a contest detail page, link to XCPC Rating's `#/contest/<slug>` or `#/problems?contest=<slug>` so difficulty-based problem picking happens there instead of being reimplemented. The slug is already stored in `xcpc_rating` problem sources.
- XCPC Rating has no per-problem page, so links are per contest. The link reveals difficulty; decide whether it shows only in spoiler mode.

### Catalog gaps (all uses)

- About 107 contests have no verified or estimated medal lines, so use 4 shows nothing for them.
- About 100 contests have no start date, which affects ordering and any time-based view.
- XCPC Rating lists 220 contests not yet linked to the catalog; 120 of them have problem URLs for every problem and are candidates for review. They enter only through the existing review process.

### Maintenance

- Move tests out of `scripts/` into a real TypeScript test setup (unit tests with a test runner, browser tests with Playwright Test), so `scripts/` holds only build and data tools; then convert the remaining `.mjs` tools to TypeScript.
- One step of `validate-qoj-manual.mjs` (manual-to-userscript handoff with no script) fails because something answers the bridge `hello` in that test; the failure predates current work.

## Not planned

- Penalty-based placement (no penalty data).
- Problem-level difficulty browsing (XCPC Rating), full standings browsing (RankLand/XCPCIO Board), individual player rating (XCPC Rating).
- Personal cross-OJ dashboards, training journals, timers, LLM contest generation (OJ Insight's area).
- Cloud or file-based team sharing; each teammate adds the team's accounts in their own browser.

## Deferred

- Contributing reviewed CF/QOJ mappings back to XCPC Rating.
