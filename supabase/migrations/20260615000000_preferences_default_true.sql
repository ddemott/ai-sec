-- Migration: default save_preferences_enabled to true
--
-- Preference capture was opt-in (default false). Product decision 2026-06-15:
-- on by default — any caller who gives their name or books should have durable
-- preferences tracked. Owners can still opt out via the AI Persona dashboard.
--
-- Two steps:
-- 1. Flip existing rows (all tenants currently have false because they never
--    explicitly opted in — no tenant has actively opted out).
-- 2. Change the column default so new tenants get it on immediately.

UPDATE tenants SET save_preferences_enabled = true WHERE save_preferences_enabled = false;

ALTER TABLE tenants ALTER COLUMN save_preferences_enabled SET DEFAULT true;

COMMENT ON COLUMN public.tenants.save_preferences_enabled IS
  'Preference capture enabled by default. Owners can opt out via the AI Persona dashboard.';
