-- Widen tenants.checklist_preset_id's CHECK constraint for the 28 vertical
-- front-desk presets added alongside the per-vertical slot-filling intake trees.
--
-- WHAT CHANGED IN CODE. agent/src/checklist/verticalIntakeTrees.ts adds a
-- slot-filling intake tree, a conversation block, and (for 28 of the 30
-- verticals) a front-desk preset for each supported business vertical. auto_shop
-- and salon already had presets (their intake block was wired in directly);
-- the other 28 are new preset ids. shared/checklistPresetDerivation.ts lists all
-- of them in CHECKLIST_PRESET_IDS, so the CHECK constraint enumerating
-- tenants.checklist_preset_id must be widened to match — the exact drift
-- 20260814120000 was written to prevent, now enforced by
-- tests/presetCatalogConstraint.test.ts against this list.
--
-- NOTE ON answering_service_front_desk. It ships as a reachable catalog entry
-- (and is therefore listed here), but no business_type resolves to it:
-- 'answering-service' stays mapped to owner_for_hire_front_desk so the
-- owner-for-hire `job` lane is preserved (see the 2026-08-13 regression in
-- shared/checklistPresetDerivation.ts). Listing it here is still correct — the
-- constraint is a CEILING of ids the column may hold, and an operator may pin a
-- tenant to it explicitly.
--
-- Widening a CHECK is non-destructive: it only ever accepts more values, no
-- existing row can violate it, and no rewrite is required. Idempotent.

-- DROP ... IF EXISTS is table-scoped (it only ever touches tenants' own
-- constraint) and a no-op when absent, so it is both idempotent and immune to
-- the conname collision a bare pg_constraint lookup would risk — a constraint of
-- the same name on another table can neither satisfy nor block this DROP.
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_checklist_preset_id_valid;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_checklist_preset_id_valid
  CHECK (
    checklist_preset_id IS NULL OR checklist_preset_id IN (
        'auto_shop_front_desk',
        'salon_front_desk',
        'local_service_front_desk',
        'owner_for_hire_front_desk',
        'law_firm_front_desk',
        'mobile_tire_front_desk',
        'car_detailing_front_desk',
        'body_shop_front_desk',
        'oil_change_front_desk',
        'car_wash_front_desk',
        'barbershop_front_desk',
        'nail_salon_front_desk',
        'spa_front_desk',
        'med_spa_front_desk',
        'lash_studio_front_desk',
        'plumber_front_desk',
        'electrician_front_desk',
        'hvac_front_desk',
        'pest_control_front_desk',
        'cleaning_front_desk',
        'landscaping_front_desk',
        'garage_door_front_desk',
        'locksmith_front_desk',
        'personal_trainer_front_desk',
        'yoga_studio_front_desk',
        'tax_prep_front_desk',
        'tutoring_front_desk',
        'photography_front_desk',
        'real_estate_front_desk',
        'insurance_front_desk',
        'answering_service_front_desk',
        'bakery_front_desk',
        'catering_front_desk'
    )
  );

COMMENT ON COLUMN tenants.checklist_preset_id IS
  'Optional explicit checklist preset override. NULL = derive from business_type. The allowed list here MUST match PRESET_LIBRARY in agent/src/checklist/presets.ts and ChecklistPresetId in shared/checklistPresetDerivation.ts — presetCatalogConstraint.test.ts enforces it.';
