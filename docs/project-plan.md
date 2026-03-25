# xcpc-vp-gather Design Pack

This file is the working design pack for MVP initialization. It should evolve before large-scale implementation.

## Next Phase Focus

### Goal
- Shift from CLI-first validation to local-API-first integration for the upcoming Vue SPA.

### Why
- Current CLI already validates the core flows: contest sync, member sync, coverage, and config import/export.
- Additional CLI productization is lower priority than stabilizing API contracts for frontend work.

### Planned Order
1. Add `GET /api/contests`
   - Support provider filter, tag filter, and optional coverage summary.
2. Add `GET /api/members`
   - Return tracked member bindings in a frontend-friendly DTO.
3. Add `GET /api/contests/:contestId`
   - Return contest metadata without forcing frontend to fetch full coverage first.
4. Stabilize DTOs used by frontend
   - Contest list item
   - Member list item
   - Coverage payload
5. Start minimal Vue SPA shells
   - Contest list
   - Contest coverage
   - Member list

### Explicit Non-Goals For The Next Phase
- Do not continue CLI productization unless it is needed to validate a backend/API change.
- Do not add multi-OJ support.
- Do not add private-team-contest support.
- Do not add automatic contest discovery/catalog features.
