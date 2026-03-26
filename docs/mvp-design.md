# xcpc-vp-gather MVP Design

## New MVP Shape

The next MVP is no longer a localhost-service-led gather tool. It is a static XCPC tracker with three core inputs:

- curated contest metadata from repository JSON
- Codeforces member status from public API
- QOJ member status from userscript-exported JSON

## MVP Outcomes

- Browse a curated subset of XCPC-like contests.
- Show contest/problem coverage for selected local members.
- Import or refresh Codeforces member status from the browser.
- Import QOJ solved/attempted snapshots from userscript JSON.
- Persist member state, provenance, and mappings in IndexedDB.
- Deploy the whole app as a static site.

## Core Product Loop

1. Maintainer curates contest metadata in Git.
2. CI validates catalog files and generates indexes.
3. User opens the static app and loads curated contests.
4. User imports member status from Codeforces and QOJ.
5. App computes coverage and freshness locally in the browser.

## Deliberate Scope Cuts

- No required localhost service for normal operation.
- No Python scraper for QOJ.
- No server-owned primary database.
- No multi-user synchronization.
- No broad provider abstraction designed around backend orchestration.

## MVP Design Principles

- Curated data is explicit and reviewable.
- Runtime state is local to the browser and exportable.
- Provider-specific import logic stays at adapter boundaries.
- Coverage answers should remain understandable and provenance-aware.
