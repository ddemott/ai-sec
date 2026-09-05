# Test DB Audit

**Purpose:** Real Postgres (with pgvector for embeddings) for RLS, regression, realdb tests, migration validation, and constraint/trigger behavior. Mocked DB is insufficient.

**Connection:** `postgres://postgres:postgres@localhost:5433/postgres` (some tests use `test_db` — created on first migrate).

**Bootstrap (no Dale):**
```bash
./scripts/start-test-db.sh
```

Script uses `docker compose up -d db` (canonical ankane/pgvector service from docker-compose.yml), waits on healthcheck (`pg_isready`), tests SELECT 1.

**Stop:**
```bash
docker compose stop db
```

**Reset volume (for fresh test_db):**
```bash
docker compose down -v
./scripts/start-test-db.sh
npm run db:rebuild -- --yes
```

**In tests:** e2e specs and realdb tests use Pool with this URL. afterAll scopes cleanup to the PLATFORM_TENANT_ID.

**RLS note:** Real DB tests must test policies explicitly (bypass or withTenantClient). See rlsIsolation.test.ts (null-context landmines, 9 cases).

**Last verified:** 2026-09-04 (container running via compose, connection good, customer-preferences-config.spec.ts runs clean with scoped afterAll).

**Remaining:** CI runner docker service integration, full RLS regression expansion.

Updated per 2026-09-04 hygiene pass and Copilot review on PR #402 (canonical compose + pgvector + readiness instead of plain postgres:15 + sleep).
