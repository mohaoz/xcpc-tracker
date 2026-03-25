# xcpc-vp-gather Project Plan

This file tracks the next work after `0.1.1`, not the original bootstrap plan.

## Shipped In 0.1.1

- Contest pool page with pagination and tag filtering
- Pool scope modes including `no-fresh-only`
- Contest-card per-problem status strips
- Contest detail coverage matrix
- Root-level manage page
- Contest import/export
- Member import/export
- Sync missing contests
- Member last-sync display and in-list sync action
- Intake operation logs
- Summary-cache backfill for old rows

## Next Phase Focus

### Goal
- Make local sync flows explain themselves clearly and reduce ambiguity around what is synced, when it was synced, and what failed.

### Recommended Order
1. Add richer task progress reporting
   - expose task events for long-running syncs
   - let the UI show live progress instead of only final summaries
2. Improve missing-contest recovery
   - surface why a contest is unsynced directly in the list or intake logs
   - allow retry of specific failed contests
3. Tighten sync provenance across the product
   - distinguish imported-only, synced, partially failed, and stale data
   - show last successful sync time separately from metadata update time
4. Tighten contest detail metadata
   - show alias, updated time, and sync provenance in detail view
   - make it obvious why a contest appears in the pool and what is missing
5. Prepare for artifact/resource gathering
   - keep it behind provider boundaries
   - do not let it distort the MVP sync loop

## Explicit Non-Goals For The Next Phase

- Do not add multi-OJ support yet.
- Do not add remote backend or collaboration features.
- Do not add full contest replay timelines as a primary feature.
- Do not let frontend start scraping directly.
- Do not build recommendation or ranking systems before sync provenance is solid.
