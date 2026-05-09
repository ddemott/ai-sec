-- Enable RLS on password_resets (created 2026-04-22 with no RLS at all).
--
-- Threat model: password_resets holds short-lived tokens that, if leaked,
-- allow account takeover. The application accesses this table only via
-- /forgot-password (INSERT) and /reset-password (SELECT by token_hash +
-- UPDATE used_at). Both are PUBLIC_ROUTES — no JWT, no tenant context set.
--
-- Defense in depth: even though no production route in src/routes/*.ts
-- queries password_resets from a tenant-context-set connection, RLS gives
-- us a floor. If a future route, an SQL-injection vector, or a stray join
-- ever tried to read this table from an authenticated tenant session, the
-- policy would deny it.
--
-- Why no FORCE: not needed here. The pattern is "deny when tenant context
-- is set; allow when it's not." Even superuser/postgres pays attention to
-- USING clauses on a permissive policy when no other policy grants access.
-- (FORCE is the bigger hammer — it makes the policy apply to BYPASSRLS roles.
-- Adding it for password_resets is fine and matches the rest of the schema,
-- so we include it.)
--
-- Existing rows: forward-only by definition — there are zero pre-existing
-- rows on prod (the forgot-password flow has never been used by a real
-- customer), and even if there were, they'd remain accessible from the
-- same unauthenticated routes that wrote them.

ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets FORCE ROW LEVEL SECURITY;

-- Permissive policy: allow access when no tenant context is set.
-- This matches the unauthenticated /forgot-password and /reset-password
-- flow shape — both run via withPoolClient (no setTenantContext call),
-- so app.current_tenant_id stays at its default empty value.
--
-- Authenticated callers (whose preHandler sets app.current_tenant_id to
-- their JWT's tenant_id) get NO access — there's no policy that allows
-- them to read or write password_resets. Defense in depth.
CREATE POLICY password_resets_unauthenticated_only ON password_resets
    USING (NULLIF(current_setting('app.current_tenant_id', TRUE), '') IS NULL)
    WITH CHECK (NULLIF(current_setting('app.current_tenant_id', TRUE), '') IS NULL);

COMMENT ON POLICY password_resets_unauthenticated_only ON password_resets IS
'Only the unauthenticated forgot-password / reset-password flow can read or write this table. Authenticated tenant sessions (with app.current_tenant_id set) cannot. Added 2026-05-09 — closes RLS gap from migration 20260422.';
