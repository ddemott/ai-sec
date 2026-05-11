-- Add the missing tenant FK constraint to `employees` and `services`.
--
-- Discovered 2026-05-11 while writing E2E coverage for the tenant-delete
-- cascade (docs/TODO.md P2). The DELETE /tenants/:id route is just
-- `DELETE FROM tenants WHERE id = $1` and relies entirely on FK CASCADE
-- to remove dependent rows across the 25+ tenant-scoped tables. Auditing
-- pg_constraint surfaced two outliers — `employees.tenant_id` and
-- `services.tenant_id` are declared `NOT NULL UUID` but lack the
-- `REFERENCES tenants(id) ON DELETE CASCADE` clause that every other
-- tenant-scoped table has. (The initial-schema migration appears to have
-- intended the FK — its source says `REFERENCES tenants(id) ON DELETE
-- CASCADE` — but the constraint is missing from the live schema. Most
-- likely cause: a column-rename or table-recreate dropped it at some
-- point and the rebuild forgot to restore the constraint.)
--
-- Impact: tenant offboarding leaves orphan `employees` and `services`
-- rows pointing at a dead tenant_id. Not catastrophic on the privacy
-- axis (employees stores name/email/phone; services stores name +
-- duration — neither is high-PII), but it breaks the implicit "delete
-- the tenant, delete the data" contract and would silently grow the
-- two tables over time as tenants come and go. Real-world local impact
-- before this migration: 77 orphan employees + 8 orphan services
-- accumulated from past E2E runs.
--
-- Forward fix is two steps:
--   1. Clean up existing orphan rows so the ADD CONSTRAINT doesn't fail
--      with a constraint violation against the historical data.
--   2. Add the missing FK constraints with ON DELETE CASCADE.
--
-- Apply order is safe: BOTH tables are referenced by other tables
-- (employees by appointments, employee_schedule, service_employee;
-- services by service_employee, service_resource), but those references
-- already cascade or set-null from the child side, so deleting an
-- orphan employees/services row doesn't blow up any well-tenant'd data.
-- We're only removing rows whose tenant is already gone.

BEGIN;

-- Step 1: clean up orphans (rows whose tenant_id no longer exists).
DELETE FROM employees WHERE tenant_id NOT IN (SELECT id FROM tenants);
DELETE FROM services  WHERE tenant_id NOT IN (SELECT id FROM tenants);

-- Step 2: add the missing FK constraints. Name them with the same
-- `<table>_tenant_id_fkey` shape Postgres uses by default elsewhere.
ALTER TABLE employees
  ADD CONSTRAINT employees_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE services
  ADD CONSTRAINT services_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

COMMIT;
