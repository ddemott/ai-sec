-- Add ON DELETE CASCADE to service_employee.tenant_id_fkey.
--
-- Discovered 2026-05-12 while writing dashboard/e2e/wizard-solo-path.spec.ts.
-- The test's cleanup (`DELETE FROM tenants WHERE tenant_id = $1`) failed
-- with `update or delete on table "tenants" violates foreign key
-- constraint "service_employee_tenant_id_fkey"`. Inspection of
-- `pg_constraint.confdeltype` confirmed the FK had `'a'` (no action)
-- instead of `'c'` (cascade), while the sibling
-- `service_resource.tenant_id_fkey` had the correct `'c'`.
--
-- Origin (March 2026):
--   - `20260309000001_fix_rls.sql:1` adds tenant_id to service_employee
--     WITHOUT a CASCADE clause:
--       ALTER TABLE service_employee ADD COLUMN IF NOT EXISTS tenant_id
--         UUID REFERENCES tenants(id);
--   - `20260309000002_fix_service_resource.sql:23` tries to "fix" it
--     with a CASCADE clause:
--       ALTER TABLE service_employee ADD COLUMN IF NOT EXISTS tenant_id
--         UUID REFERENCES tenants(id) ON DELETE CASCADE;
--     ...but `ADD COLUMN IF NOT EXISTS` is a no-op when the column
--     already exists (it does — added 1 migration earlier), so the
--     CASCADE was silently never applied. `service_resource` got the
--     correct CASCADE in the same file because that path uses
--     `DROP TABLE service_resource CASCADE` + `CREATE TABLE` with the
--     CASCADE clause in the new column definition. `service_employee`
--     fell through the gap.
--
-- Same class of bug `20260511000000_employees_services_tenant_fk_cascade.sql`
-- fixed for `employees` + `services` (different root cause — there the FK
-- was missing entirely; here the FK exists with the wrong action mode —
-- but the observable symptom is the same: `DELETE FROM tenants` fails or
-- leaves orphan rows pointing at a dead tenant_id).
--
-- Impact pre-fix:
--   * `DELETE /tenants/:id` (super-admin offboarding) fails with FK
--     violation if the tenant has any service-employee mappings.
--   * E2E cleanup has to manually `DELETE FROM service_employee WHERE
--     tenant_id = $1` before deleting the tenant. Workaround in place
--     in `dashboard/e2e/wizard-solo-path.spec.ts:cleanupTenant`.
--
-- Forward fix: drop the existing constraint, recreate with CASCADE.
-- Idempotent — uses `IF EXISTS` so re-applying against a DB where this
-- migration already ran is a no-op (the second ADD CONSTRAINT would
-- still succeed because the first DROP succeeded). Pre-flight orphan
-- cleanup defends against any future state where a tenant was deleted
-- by force-bypassing the constraint (e.g., manual SQL with the FK
-- temporarily dropped).

-- Step 1: clean up orphans (defensive — local DBs report 0 today).
DELETE FROM service_employee WHERE tenant_id NOT IN (SELECT tenant_id FROM tenants);

-- Step 2: drop the existing no-CASCADE constraint.
ALTER TABLE service_employee
    DROP CONSTRAINT IF EXISTS service_employee_tenant_id_fkey;

-- Step 3: re-add with ON DELETE CASCADE. Name kept identical to what
-- Postgres would auto-generate, matching the convention every other
-- tenant-scoped table uses.
ALTER TABLE service_employee
    ADD CONSTRAINT service_employee_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE;

