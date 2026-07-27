-- 20260724000050_rls_close_gaps.sql
--
-- STEP 1b. Runs between the null-safe rewrite and the role switch.
--
-- WHAT THIS FIXES: `message_delivery_status` carries a tenant_id and had RLS
-- neither enabled nor forced, and zero policies. Every row in it was readable
-- by any authenticated database session regardless of tenant.
--
-- That was invisible while the app connected as a BYPASSRLS role, because in
-- that world no table was protected and this one was not distinguishable from
-- the other thirty-six. It becomes a live cross-tenant leak the moment the role
-- switch lands and everything ELSE starts being enforced — the most dangerous
-- shape of gap, because the surrounding change makes people believe coverage is
-- now complete.
--
-- Found by tests/regression/rlsIsolation.test.ts, which asserts that every table
-- with a tenant_id column has RLS enabled AND forced. That test is the reason
-- this file exists, and it is why the assertion is written against the catalog
-- rather than against a hand-maintained list of tables.
--
-- Written generically: it protects ANY tenant-scoped table that is missing RLS,
-- not just the one found today. A future migration that adds a table and
-- forgets its policy is repaired by re-running this, and the regression test
-- fails until someone does.

DO $close_gaps$
DECLARE
  tbl     RECORD;
  closed  INT := 0;
BEGIN
  FOR tbl IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
       )
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
     ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.tablename);
    -- FORCE matters independently: ENABLE alone still exempts the table OWNER,
    -- and migrations run as the owner.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl.tablename);

    -- Same two-policy shape as every other tenant-scoped table: isolation for
    -- normal traffic, plus an admin path for the internal cross-tenant sweeps
    -- that run with no context. Both go through the null-safe helpers from
    -- 20260724000000 rather than reading the GUC directly.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING (tenant_id = tenant_ctx_uuid()) WITH CHECK (tenant_id = tenant_ctx_uuid())',
      tbl.tablename || '_tenant_isolation', tbl.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING (tenant_ctx() = '''') WITH CHECK (tenant_ctx() = '''')',
      tbl.tablename || '_admin_bypass', tbl.tablename
    );

    RAISE NOTICE 'rls_close_gaps: protected %', tbl.tablename;
    closed := closed + 1;
  END LOOP;

  RAISE NOTICE 'rls_close_gaps: closed % gap(s)', closed;
END
$close_gaps$;

-- Prove there is nothing left unprotected.
DO $verify$
DECLARE
  gaps TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO gaps
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   WHERE c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema = 'public' AND col.table_name = c.relname
                    AND col.column_name = 'tenant_id')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);

  IF gaps IS NOT NULL THEN
    RAISE EXCEPTION 'rls_close_gaps: still unprotected: %', gaps;
  END IF;
END
$verify$;
