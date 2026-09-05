# Directory Structure - SecretaryHQ Dashboard

Updated: 2026-09-04 from live filesystem search

## Core
- app/: Next.js App Router (11 page.tsx routes for dashboard, auth, self-service, legal, demo)
- components/: 258 UI components (CRM, calendar, forms, admin panels)
- lib/: Contexts, hooks, utils, date handling, 104 test files across lib/ and app/
- docs/planning/: TODO.md (live only), RESOLVED.md (pruned items), handoff docs
- e2e/, test-results/, vitest.config.ts: Testing setup
- railway.json, server.js: Deployment and local server

No migrations or backend routes in this package (Fastify backend is separate with its own route count).

See README.md for running instructions. All counts verified via terminal find commands. No stale paths.
