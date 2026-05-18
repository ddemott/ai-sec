-- Composite-key retrofit pilot #1 — `tenant_integration_settings`.
--
-- Background (CLAUDE.md "Composite / natural keys preferred"):
-- Every existing surrogate-UUID-PK table is on the retrofit queue.
-- Cadence: one table per day, CI-green per commit before next pilot.
-- The mental rule for whether to retrofit:
--   surrogate UUID only when the natural key is 3+ columns, any part
--   of it is mutable, or the row needs URL identity. None of those
--   apply here.
--
-- Why this table is the lowest-risk first pilot:
--   1. Natural key is exactly 2 columns: (tenant_id, provider).
--   2. The UNIQUE constraint on (tenant_id, provider) already exists
--      and has been the authoritative identity since the table was
--      introduced — every production query in src/routes/{jobber,
--      hubspot,square,servicetitan}.ts + src/services/{tokenManagement,
--      crmDisconnect,oauthCallbackFactory,syncMapHelpers}.ts uses
--      `WHERE tenant_id = $1 AND provider = $2` (or ON CONFLICT
--      (tenant_id, provider)) — NONE reference the surrogate.
--   3. `provider` is locked to one of four values by a CHECK constraint
--      (jobber/hubspot/square/servicetitan) — immutable in practice.
--   4. `tenant_id` is immutable by convention (a row never changes
--      tenants — you delete + re-insert).
--   5. NO other table has a foreign key to tenant_integration_setting_id.
--      A `grep -rn "REFERENCES tenant_integration_settings" supabase/`
--      returns zero hits. The surrogate is purely an internal row id
--      no one else depends on.
--   6. The only TypeScript reference to the surrogate is one block in
--      `src/pk-rename-coverage.test.ts` that pinned the original
--      `id → tenant_integration_setting_id` rename; that block is
--      rewritten in the same commit to assert the composite-PK shape
--      instead.
--
-- Order of operations:
--   1. Drop the redundant UNIQUE on (tenant_id, provider) — promoting
--      that pair to PK supersedes it. Postgres allows UNIQUE and PK
--      on the same columns simultaneously, but it's wasteful (two
--      btree indexes covering the identical set).
--   2. Drop the surrogate PK.
--   3. Drop the surrogate column itself. Doing this BEFORE adding the
--      new PK keeps the table in only one of {surrogate, composite}
--      states — never both — so a failed apply leaves a recognizable
--      half-state instead of a "looks fine but ambiguous" state.
--   4. Add the new composite PK. Implicit NOT NULL on the columns is
--      enforced by the PK definition itself (Postgres requires PK
--      columns be NOT NULL); both columns were already NOT NULL so
--      no data scan needed.

ALTER TABLE tenant_integration_settings
    DROP CONSTRAINT tenant_integration_settings_tenant_id_provider_key;

ALTER TABLE tenant_integration_settings
    DROP CONSTRAINT tenant_integration_settings_pkey;

ALTER TABLE tenant_integration_settings
    DROP COLUMN tenant_integration_setting_id;

ALTER TABLE tenant_integration_settings
    ADD CONSTRAINT tenant_integration_settings_pkey PRIMARY KEY (tenant_id, provider);
