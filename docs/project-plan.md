# xcpc-vp-gather Project Plan

This file tracks the next work after `0.1.1`, not the original bootstrap plan.

## Shipped In 0.1.1

- Contest pool page with pagination and tag filtering
- Pool scope modes including `no-fresh-only`
- Contest-card per-problem status strips
- Contest detail coverage matrix
- Contest intake page
- Contest import/export
- Sync missing contests
- Intake operation logs
- Summary-cache backfill for old rows

## Next Phase Focus

### Goal
- Make local sync flows more observable and more robust without expanding provider scope.

### Recommended Order
1. Add richer task progress reporting
   - expose task events for long-running syncs
   - let the UI show live progress instead of only final summaries
2. Improve missing-contest recovery
   - surface why a contest is unsynced directly in the list or intake logs
   - allow retry of specific failed contests
3. Tighten contest detail metadata
   - show alias, updated time, and sync provenance in detail view
4. Improve member workflows
   - make tracked-member sync more visible from the UI
   - surface per-member freshness context more clearly
5. Prepare for artifact/resource gathering
   - keep it behind provider boundaries
   - do not let it distort the MVP sync loop

## Explicit Non-Goals For The Next Phase

- Do not add multi-OJ support yet.
- Do not add remote backend or collaboration features.
- Do not add full contest replay timelines as a primary feature.
- Do not let frontend start scraping directly.
