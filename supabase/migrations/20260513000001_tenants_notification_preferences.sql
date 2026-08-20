-- Add sms_enabled + email_enabled columns to tenants for per-channel
-- notification preferences.
--
-- Closes the Phase 2 reminder-prefs gap surfaced in the 2026-05-13
-- Communications/Reminders TODO reconciliation. PostgresTenantConfigService
-- (`src/services/tenants/index.ts:166-167`) was already mapping these column
-- names into its `NotificationPreferences` shape via `row.sms_enabled !==
-- false`, but the columns themselves had never been added. Any call to
-- `getTenantConfigAsync` against a real DB would have raised `column
-- "sms_enabled" does not exist`. The reminder worker currently never
-- exercises that path (its `configService` import is dangling — no
-- `.getNotificationPreferences(...)` call yet), so the bug was latent.
-- This migration brings the schema in line with what the code already
-- expects, so the next caller to wire delivery-time consent gating into
-- the worker can read these columns without scaffolding the schema first.
--
-- Why default true (not false): an existing tenant who never set a
-- preference should opt IN to both channels by default — that matches
-- the legacy InMemoryTenantConfigService's hardcoded defaults. Tenants
-- who want to opt OUT do so by explicit UPDATE; opt-in is the operator
-- expectation ("I told you to send reminders, why aren't they going out?"
-- is the support nightmare we're avoiding).
--
-- Forward-only safe: ADD COLUMN with NOT NULL + DEFAULT TRUE backfills
-- every existing row in one statement. Zero downtime, zero data loss.
--
-- Other dormant fields that PostgresTenantConfigService references but
-- the tenants table doesn't yet have (`business_name`, `owner_email`,
-- `phone`) are explicitly OUT of scope here — adding them would require
-- product decisions about what data shape we actually want long-term
-- (e.g., do we keep `owner_phone` AND add `phone`?). Flagged as a
-- follow-up in docs/TODO.md.

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN tenants.sms_enabled IS 'Per-tenant SMS reminder channel toggle. Default TRUE — owner opts out by explicit UPDATE.';
COMMENT ON COLUMN tenants.email_enabled IS 'Per-tenant email reminder channel toggle. Default TRUE — owner opts out by explicit UPDATE.';

