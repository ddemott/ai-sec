-- Pilot #2 for the PK naming convention (per CLAUDE.md).
-- Renames tenant_skills.id → tenant_skill_id.
--
-- Why tenant_skills as the second pilot:
--   - Zero inbound FKs (skills are referenced by name via TEXT[] columns
--     on services + employees, never by id). Same low blast radius as
--     record_versions but a different layer of the app — dashboard CRUD
--     surface (SkillManagementView) instead of audit/versioning.
--   - Zero RPCs or views reference the column.
--   - Real consumer code: src/routes/skills.ts + SkillManagementView +
--     real-DB tests in src/crud-routes.test.ts and
--     src/multi-tenant-isolation.test.ts.
--
-- Naming note: the convention is `<table_singular>_id`. Table is
-- `tenant_skills` (plural), so PK becomes `tenant_skill_id`. The
-- `tenant_` prefix on the table name is a separate inconsistency
-- with `customers` / `employees` / etc. — not addressed here.

BEGIN;

ALTER TABLE tenant_skills RENAME COLUMN id TO tenant_skill_id;

COMMIT;
