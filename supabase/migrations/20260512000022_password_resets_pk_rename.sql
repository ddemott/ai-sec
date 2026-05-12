-- Pilot #22 of the PK naming convention conversion (per CLAUDE.md).
-- Renames password_resets.id → password_reset_id.
--
-- Terminal in the schema (zero inbound FKs). Not versioned, not audited.
-- No RPCs reference the column. Consumers:
--   - src/routes/auth.ts /reset-password: SELECT PK + 1× UPDATE WHERE PK
--     (the second UPDATE keys on user_id, not the PK).
--   - src/routes/users.ts /users/invite: INSERT only (no PK reference).
--   - src/multi-tenant-isolation.test.ts: INSERT + SELECT user_id (no PK).
--   - src/auth.test.ts: string-match assertion on the SELECT query.
--   - dashboard/e2e/auth-flows.spec.ts: UPDATE...WHERE id = (SELECT id ...)
--     constructs a known-hash token by replacing the random one server-side
--     generated, mirroring the email link's hash.
--   - dashboard/e2e/workflows.spec.ts: SELECT 1 / DELETE WHERE user_id (no PK).
--
-- The auth.ts SELECT keeps `password_reset_id AS id` so the destructuring
-- `const { id: resetId, user_id: userId } = r.rows[0]` stays valid.

BEGIN;

ALTER TABLE password_resets RENAME COLUMN id TO password_reset_id;

COMMIT;
