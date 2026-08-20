-- Narrow two provider CHECK constraints to the CRM that still exists.
--
-- Jobber, HubSpot and ServiceTitan were deleted on 2026-06-12 — 21 dormant CRM
-- adapters removed under "test it or delete it", none of which had ever touched
-- a real CRM. The TypeScript went with them; only Square remains. But both
-- provider CHECK constraints still enumerate the dead three:
--
--   entity_sync_map_provider_check
--   tenant_integration_settings_provider_check
--
-- A constraint is a statement about what this system supports. Leaving three
-- providers in it says the product can sync Jobber, and the next person to read
-- the schema has no way to know that is false — the adapters are gone, so
-- nothing would ever write those values, and if something did the row would be
-- accepted and then serviced by nothing.
--
-- VERIFIED AGAINST PROD BEFORE WRITING THIS: both tables hold ZERO ROWS, so
-- narrowing the allowed set cannot reject existing data.
--
-- Square is kept, plus the calendar providers already handled elsewhere are not
-- part of these two constraints. If a CRM is ever added back, widening a CHECK
-- is one line — and it should be added when the adapter lands, not before.

ALTER TABLE public.entity_sync_map
  DROP CONSTRAINT IF EXISTS entity_sync_map_provider_check;
ALTER TABLE public.entity_sync_map
  ADD CONSTRAINT entity_sync_map_provider_check
  CHECK (provider = ANY (ARRAY['square'::text]));

ALTER TABLE public.tenant_integration_settings
  DROP CONSTRAINT IF EXISTS tenant_integration_settings_provider_check;
ALTER TABLE public.tenant_integration_settings
  ADD CONSTRAINT tenant_integration_settings_provider_check
  CHECK (provider = ANY (ARRAY['square'::text]));
