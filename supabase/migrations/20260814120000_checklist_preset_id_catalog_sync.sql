-- Re-sync tenants.checklist_preset_id's CHECK constraint with the preset catalog
-- the code actually ships.
--
-- TWO PRESETS WERE ADDED IN CODE AND NEVER ADDED HERE.
--
--   1. `owner_for_hire_front_desk` shipped 2026-08-13 in #343 as the fix for the
--      unreachable `job` tree. The constraint written by 20260812000100 still
--      enumerated only the original three ids, so the column physically could
--      not hold the new one:
--
--        ERROR: new row for relation "tenants" violates check constraint
--               "tenants_checklist_preset_id_valid"
--
--      That makes `scripts/pin-owner-for-hire-preset.sql` — the ops step
--      HANDOFF.md says to run against prod after the agent deploys — fail on
--      its UPDATE. Verified by running that exact UPDATE against a real tenant
--      row on 2026-08-14; it aborts, it does not silently no-op.
--
--   2. `law_firm_front_desk` is added in this same change (small plaintiff-side
--      firms: case intake for attorney take-or-decline review).
--
-- WHY THIS KEPT SLIPPING, and what to do about it. The preset catalog lives in
-- FOUR places that must agree: agent/src/checklist/presets.ts (the trees),
-- shared/checklistPresetDerivation.ts (ChecklistPresetId + the runtime mirror),
-- this CHECK constraint, and the dashboard picker. Only the first two are
-- type-checked against each other. The constraint is the one that fails LOUDLY
-- but LATE — at an UPDATE against prod, which is the worst place to find out.
-- `presetCatalogConstraint.test.ts` now asserts this list against the shipped
-- PRESET_LIBRARY so the next preset fails in CI instead.
--
-- Widening a CHECK is non-destructive: it only ever accepts more values, no
-- existing row can violate it, and no rewrite is required. Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_checklist_preset_id_valid'
  ) THEN
    ALTER TABLE tenants
      DROP CONSTRAINT tenants_checklist_preset_id_valid;
  END IF;

  ALTER TABLE tenants
    ADD CONSTRAINT tenants_checklist_preset_id_valid
    CHECK (
      checklist_preset_id IS NULL OR checklist_preset_id IN (
        'auto_shop_front_desk',
        'salon_front_desk',
        'local_service_front_desk',
        'owner_for_hire_front_desk',
        'law_firm_front_desk'
      )
    );
END $$;

COMMENT ON COLUMN tenants.checklist_preset_id IS
  'Optional explicit checklist preset override. NULL = derive from business_type. The allowed list here MUST match PRESET_LIBRARY in agent/src/checklist/presets.ts and ChecklistPresetId in shared/checklistPresetDerivation.ts — presetCatalogConstraint.test.ts enforces it.';
