-- Add a per-tenant "default buffer between appointments" to tenants.
--
-- Feature: owners can set a gap (in minutes) the AI must leave between
-- back-to-back bookings so the operator can gather notes, take a break, etc.
-- A meeting at 8:00-9:00 with a 15-minute buffer means the AI will not offer
-- or book the resource/employee again until 9:15. The buffer is applied
-- symmetrically (before and after each existing appointment) at every
-- customer-facing availability + booking surface so the AI never OFFERS a
-- slot the booking path would then reject.
--
-- Scope (product decision 2026-06-07): the buffer gates AI / customer-facing
-- bookings only. An owner manually placing a back-to-back appointment in the
-- dashboard is an explicit human choice and stays unrestricted.
--
-- One column:
--   default_buffer_minutes — INTEGER, NOT NULL DEFAULT 0. Zero means "no
--     buffer" — the current behavior — so every existing tenant is unchanged
--     until they deliberately set a value in the Phone Assistant config. This
--     is the inert/no-op default on purpose: the feature ships dormant and
--     turns on per-tenant when an owner asks for it.
--
-- Buffer only applies to NEW bookings going forward. Appointments already on
-- the calendar (possibly back-to-back, booked when the buffer was 0) are never
-- retroactively rejected — there is no validation sweep, the buffer lives only
-- in the forward-looking overlap checks.
--
-- Forward-only safe: ADD COLUMN IF NOT EXISTS with a constant DEFAULT
-- backfills every existing row in one statement. Zero downtime, zero data loss.

BEGIN;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS default_buffer_minutes INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN tenants.default_buffer_minutes IS 'Minutes of gap the AI must leave between back-to-back bookings (applied symmetrically around each existing appointment at every availability + booking surface). Default 0 = no buffer (current behavior). AI/customer-facing bookings only; owner manual dashboard bookings are unrestricted.';

COMMIT;
