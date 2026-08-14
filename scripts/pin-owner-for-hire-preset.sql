-- Thinking Hammer LLC: pin the checklist preset that can actually reach the `job` tree.
--
-- THE STATE THIS FIXES (prod, 2026-08-13 — CALL1.md / CALL2.md):
--
--   Two recruiter calls from +1 262-497-9039 (SCL_3a8SkDKzxN4B 19:46 CT,
--   SCL_KLvqZ2JkaQFU 19:49 CT) wrote ZERO rows to job_inquiries. The line's own
--   greeting says "Dale is available for hire".
--
--   Cause: `job` was listed in forbidden_trees on ALL THREE presets, and
--   ChecklistOverrides can only SUBTRACT blocks (disabled_conversation_blocks) —
--   never add. So no configuration of any tenant could select the job tree.
--   business_type 'answering-service' with checklist_preset_id NULL fell through
--   resolveChecklistPresetId to local_service_front_desk, whose block list has no
--   `job`. On call 1 the model asked for the tree BY NAME and the host answered
--   `No tree called "job"`; capture_job_inquiry never entered the toolset, the
--   goodbye gate never saw the tree, and finish_call closed the call clean.
--
-- THIS SCRIPT IS BELT-AND-BRACES, NOT THE FIX. The code change already routes
-- business_type 'answering-service' to owner_for_hire_front_desk by default, so a
-- tenant with a NULL preset gets the job tree the moment the agent deploys. This
-- pins it EXPLICITLY so the tenant stops depending on a business_type string
-- mapping — a later edit to business_type in the dashboard would silently move
-- the preset back, which is the same class of invisible failure being fixed here.
--
-- ORDER MATTERS: run this AFTER the agent worker has deployed the new preset.
-- A preset id the running agent does not recognize falls back through
-- resolveChecklistPresetId to local_service_front_desk — i.e. today's broken
-- state. Running it early is a silent no-op, not an error.
--
-- Idempotent: safe to re-run.

\set tenant '''d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0'''

-- BLAST RADIUS: 1 tenant, 1 column. Read this before the UPDATE.
SELECT tenant_id,
       name,
       business_type,
       checklist_preset_id AS preset_before,
       checklist_overrides
  FROM tenants
 WHERE tenant_id = :tenant;

BEGIN;

UPDATE tenants
   SET checklist_preset_id = 'owner_for_hire_front_desk'
 WHERE tenant_id = :tenant;

-- Must print exactly 1. Anything else, roll back.
SELECT count(*) AS rows_updated
  FROM tenants
 WHERE tenant_id = :tenant
   AND checklist_preset_id = 'owner_for_hire_front_desk';

COMMIT;

-- VERIFY. The agent reads this through /agent-tools/tenant-config →
-- deriveChecklistRuntimeConfig, so the row alone is not proof the call changed —
-- confirm on the next real call that set_purpose can select `job` and that a
-- job_inquiries row lands. `./scripts/simulate.sh call --tenant d5e3c6a1-...`
-- reaches the same code path without a phone.
SELECT tenant_id, business_type, checklist_preset_id AS preset_after
  FROM tenants
 WHERE tenant_id = :tenant;
