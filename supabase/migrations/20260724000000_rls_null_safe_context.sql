-- 20260724000000_rls_null_safe_context.sql
--
-- STEP 1 OF 3 in making RLS actually enforce. This one is safe to apply on its
-- own and MUST land before the role switch — see the ordering note at the end.
--
-- ============================================================================
-- WHAT IS WRONG TODAY
-- ============================================================================
--
-- The app connects as a role with rolbypassrls, so every policy in this
-- database is inert and none of the bugs below can be observed. FORCE ROW LEVEL
-- SECURITY does not override BYPASSRLS. Local and CI connect as superuser,
-- which also bypasses, which is why no test has ever caught any of this.
--
-- Two independent defects were verified empirically against this schema on a
-- non-bypassing probe role (2026-07-24):
--
--   LANDMINE 1 — SILENT EMPTY RESULTS (known, documented in CLAUDE.md)
--
--     The admin-bypass policies read:
--         current_setting('app.current_tenant_id', true) = ''
--
--     They are meant to say "no tenant context is set, so this is an internal
--     cross-tenant sweep — allow it". But on a COLD pool connection the GUC has
--     never been set, so current_setting(..., true) returns NULL, and
--     NULL = '' is NULL — not true. The policy denies.
--
--     Measured:  SELECT count(*) FROM reminder_schedules  ->  0 rows
--
--     getDueReminders() is exactly this shape: a cross-tenant sweep on a fresh
--     connection with no tenant context. Under a non-bypassing role it returns
--     nothing, forever, and EVERY REMINDER SILENTLY STOPS. No error, no log.
--
--   LANDMINE 2 — A HARD ERROR ON EVERY REUSED CONNECTION (not previously known)
--
--     Most tenant-isolation policies read:
--         tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid
--
--     clearTenantContext() sets that GUC to the EMPTY STRING on release
--     (src/database/index.ts). '' is not a valid uuid, so the cast does not
--     yield NULL — it raises:
--
--     Measured:  ERROR: invalid input syntax for type uuid: ""
--
--     This is worse than landmine 1 because it is not a quiet deny, it is a
--     500 on the next request that borrows that pooled connection. It would
--     have surfaced within seconds of the role switch, on every table, and it
--     is nowhere in the docs.
--
-- ============================================================================
-- THE FIX
-- ============================================================================
--
-- Two helper functions, and every policy rewritten to use them. Centralizing
-- the context read means the null-handling is written once and correctly,
-- rather than re-derived (and re-fumbled) in fifty policy expressions.

/**
 * The tenant context as TEXT. Empty string when unset.
 *
 * coalesce is the whole point: current_setting(..., true) returns NULL on a
 * connection where the GUC was never set, and NULL breaks every comparison it
 * touches by evaluating to NULL rather than false.
 */
CREATE OR REPLACE FUNCTION tenant_ctx() RETURNS TEXT AS $$
  SELECT coalesce(current_setting('app.current_tenant_id', true), '');
$$ LANGUAGE sql STABLE;

/**
 * The tenant context as UUID, or NULL when unset.
 *
 * NULLIF before the cast is what prevents landmine 2: an empty context becomes
 * NULL rather than an invalid-uuid exception. `tenant_id = NULL` is NULL, so an
 * unset context denies every row — fails CLOSED, which is the correct posture
 * for an isolation policy.
 */
CREATE OR REPLACE FUNCTION tenant_ctx_uuid() RETURNS UUID AS $$
  SELECT NULLIF(tenant_ctx(), '')::uuid;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- REWRITE EVERY POLICY
-- ============================================================================
--
-- Driven off the catalog rather than a hand-written list of fifty CREATE POLICY
-- statements. Three reasons:
--
--   * Exhaustive. It rewrites whatever is actually there, including policies
--     added by migrations after this one was written and any that were created
--     out-of-band.
--   * No transcription errors. Hand-copying fifty expressions is a job with a
--     guaranteed typo, and a typo in a policy is a silent data leak.
--   * Idempotent. Re-running changes nothing once every expression is already
--     null-safe.
--
-- The substitution list is ordered most-specific-first: the bare
-- current_setting replacement must run LAST or it would corrupt the more
-- specific patterns that contain it.

DO $rewrite$
DECLARE
  pol        RECORD;
  new_qual   TEXT;
  new_check  TEXT;
  ddl        TEXT;
  role_list  TEXT;
  rewritten  INT := 0;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%current_setting%'
     ORDER BY tablename, policyname
  LOOP
    new_qual  := pol.qual;
    new_check := pol.with_check;

    -- Longest / most specific patterns first.
    FOR ddl IN SELECT unnest(ARRAY[
      '(( SELECT current_setting(''app.current_tenant_id''::text, true) AS current_setting))::uuid',
      '(NULLIF(current_setting(''app.current_tenant_id''::text, true), ''''::text))::uuid',
      '(current_setting(''app.current_tenant_id''::text, true))::uuid',
      'NULLIF(current_setting(''app.current_tenant_id''::text, true), ''''::text)',
      'current_setting(''app.current_tenant_id''::text, true)'
    ])
    LOOP
      -- The first four all denote "the tenant context as a uuid"; the last is
      -- the raw text read.
      IF ddl = 'current_setting(''app.current_tenant_id''::text, true)' THEN
        new_qual  := replace(new_qual,  ddl, 'tenant_ctx()');
        new_check := replace(new_check, ddl, 'tenant_ctx()');
      ELSE
        new_qual  := replace(new_qual,  ddl, 'tenant_ctx_uuid()');
        new_check := replace(new_check, ddl, 'tenant_ctx_uuid()');
      END IF;
    END LOOP;

    IF new_qual IS NOT DISTINCT FROM pol.qual
       AND new_check IS NOT DISTINCT FROM pol.with_check THEN
      CONTINUE;  -- already null-safe
    END IF;

    role_list := array_to_string(ARRAY(SELECT quote_ident(r) FROM unnest(pol.roles) AS r), ', ');

    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);

    ddl := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
                  pol.policyname, pol.tablename,
                  CASE WHEN pol.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                  pol.cmd, role_list);

    -- INSERT policies take only WITH CHECK; SELECT and DELETE take only USING.
    IF new_qual IS NOT NULL AND pol.cmd <> 'INSERT' THEN
      ddl := ddl || format(' USING (%s)', new_qual);
    END IF;
    IF new_check IS NOT NULL THEN
      ddl := ddl || format(' WITH CHECK (%s)', new_check);
    END IF;

    EXECUTE ddl;
    rewritten := rewritten + 1;
  END LOOP;

  RAISE NOTICE 'rls_null_safe_context: rewrote % policies', rewritten;
END
$rewrite$;

-- ============================================================================
-- PROVE IT
-- ============================================================================
--
-- A migration that claims to fix a security control should demonstrate it,
-- not assert it. Any expression still reading the GUC directly is a policy this
-- rewrite missed, and shipping that would leave exactly the landmine this file
-- exists to remove.
DO $verify$
DECLARE
  unsafe INT;
BEGIN
  SELECT count(*) INTO unsafe
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%current_setting(%';

  IF unsafe > 0 THEN
    RAISE EXCEPTION
      'rls_null_safe_context: % policies still read current_setting() directly — the rewrite missed a shape',
      unsafe;
  END IF;
END
$verify$;

-- ============================================================================
-- ORDERING — DO NOT REORDER THESE MIGRATIONS
-- ============================================================================
--
--   1. THIS FILE                     (safe alone; policies are still inert)
--   2. 20260724000100_app_user_role  (creates the non-bypassing role)
--   3. repoint DATABASE_URL          (the moment policies become live)
--
-- Applying 2 and 3 without 1 is the failure mode CLAUDE.md warns about: every
-- reminder stops silently, and — per landmine 2 above — every reused pooled
-- connection starts throwing invalid-uuid errors on top.
