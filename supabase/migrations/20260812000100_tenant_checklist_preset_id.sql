-- Explicit tenant checklist preset override for Step 8.
--
-- business_type still seeds the default preset, but owners can now choose a
-- different supported preset without forking the rest of tenant config.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS checklist_preset_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_checklist_preset_id_valid'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_checklist_preset_id_valid
      CHECK (
        checklist_preset_id IS NULL OR checklist_preset_id IN (
          'auto_shop_front_desk',
          'salon_front_desk',
          'local_service_front_desk'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN tenants.checklist_preset_id IS
  'Optional explicit checklist preset override. NULL = derive from business_type.';