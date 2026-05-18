-- Composite-key retrofit pilot #2 — `tenant_skills`.
--
-- Drop the surrogate `tenant_skill_id` UUID column and promote the
-- existing UNIQUE (tenant_id, name) to be the PK directly.
--
-- Why this qualifies under CLAUDE.md "Composite / natural keys preferred":
--
--   1. Natural key is 2 columns: (tenant_id, name).
--
--   2. Both columns are effectively immutable:
--      - tenant_id never changes (rows don't migrate tenants).
--      - `name` is normalized to a URL-safe slug at INSERT in
--        src/routes/skills.ts:38 (`name.toLowerCase().trim()
--        .replace(/\s+/g, '-')`), AND there is no PATCH/PUT route
--        for tenant_skills — once created, only GET/DELETE. So
--        names are slug-stable for the row's lifetime.
--
--   3. Zero foreign keys to `tenant_skill_id` from any other table.
--      The link between a skill and the entities that use it lives
--      in `services.required_skills text[]` and `employees.skills
--      text[]` — both store the skill NAME as text, not the surrogate
--      UUID. So removing the surrogate breaks nothing structurally.
--
--   4. The one criterion in CLAUDE.md for keeping a surrogate that
--      could apply — "needs portable identifier in URLs" — is satisfied
--      by the slug-name itself. The DELETE /skills/:id route changes
--      to DELETE /skills/:name in the same commit; names are already
--      URL-safe (lowercase + dashes), so this is a straight swap.
--
-- Migration order matches pilot #1 (drop UNIQUE → drop old PK → drop
-- surrogate column → add composite PK) so a partial apply leaves a
-- recognizable half-state instead of an ambiguous one.

ALTER TABLE tenant_skills
    DROP CONSTRAINT tenant_skills_tenant_id_name_key;

ALTER TABLE tenant_skills
    DROP CONSTRAINT tenant_skills_pkey;

ALTER TABLE tenant_skills
    DROP COLUMN tenant_skill_id;

ALTER TABLE tenant_skills
    ADD CONSTRAINT tenant_skills_pkey PRIMARY KEY (tenant_id, name);
