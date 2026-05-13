-- Recreate `deleted_customers` view to expose the renamed `customer_id`
-- column directly, matching the convention the May 12 sprint applied to
-- every other surface (and that pilot 1 already applied to the sibling
-- `recent_record_changes` view in `20260512000000_record_versions_pk_rename.sql`).
--
-- The original view from `20260409100000_version_history_and_soft_delete.sql:711`
-- selected `c.*` plus a correlated subquery on `rv.record_id = c.id`. After
-- pilot 15 renamed `customers.id → customer_id`, Postgres auto-rewrote the
-- view's underlying SELECT list to `c.customer_id` but kept the view's
-- external attribute name as `id` (bound at create time via `c.*`
-- expansion of `c.id`). The correlated subquery still works because the
-- column rename also auto-rewrote it to `c.customer_id` — but the view's
-- public surface still exposes `id`, which is exactly the `AS id` alias
-- pattern the convention rules out.
--
-- DROP + CREATE rebinds the view's public columns at the new schema.
-- `c.customer_id` becomes the natural public column name; no alias.
--
-- Zero consumers — grep over src/, dashboard/, agent/, shared/, tests/
-- finds no reference to `deleted_customers` outside this migration and
-- the originating one. The dashboard's DeletedRecordsPanel uses
-- `GET /records/customers/deleted` which queries `customers` directly
-- via `versionHistory.ts`, not this view. Preserving (rather than
-- deleting) follows the May 12 sprint's pattern for the sibling view —
-- the surface is cheap to keep, and a future admin/audit feature may
-- want the shorthand.

BEGIN;

DROP VIEW IF EXISTS deleted_customers;

CREATE VIEW deleted_customers AS
SELECT
  c.*,
  (SELECT COUNT(*) FROM record_versions rv
   WHERE rv.record_id = c.customer_id AND rv.table_name = 'customers') AS version_count
FROM customers c
WHERE c.is_deleted = true;

COMMIT;
