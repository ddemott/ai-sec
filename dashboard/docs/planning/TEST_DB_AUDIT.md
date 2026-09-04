# Test DB Audit

**Purpose:** Real Postgres for RLS, regression, realdb tests and migration validation. Mocked DB is insufficient for constraint, trigger, RLS policy, and transaction behavior.

**Connection:** `postgres://postgres:postgres@localhost:5433/postgres`

**Bootstrap (no Dale):**
```bash
cd /home/dale/projects/secretary-hq/dashboard
./scripts/start-test-db.sh
```

Script handles create/start, waits for ready, tests SELECT 1, prints connection string.

**Stop:**
```bash
docker stop secretary-test-db && docker rm secretary-test-db
```

**In tests:** e2e specs use Pool with this URL. afterAll scopes cleanup to PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'.

**RLS note:** Real DB tests must bypass or test policies explicitly. See rlsIsolation.test.ts (9 cases, null-context landmines).

**Last verified:** 2026-09-04 (container running, connection good, customer-preferences-config.spec.ts passes with scoped afterAll).

**Remaining:** integration with CI (GitHub runner may need docker service), full RLS regression suite expansion.

Updated per 2026-09-04 hygiene pass.
