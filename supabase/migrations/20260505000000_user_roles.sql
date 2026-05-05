-- Add a role column to users so the dashboard can hide Back Office tabs
-- from front-desk-only logins.
--
-- Today every regular tenant user implicitly sees Front Desk + Back Office.
-- Owners need a way to give shop staff a stripped-down view that only
-- exposes the daily-use surface (today's schedule, quick book, customer
-- lookup) without the Resources/Skills/Vocabulary/Version-History tabs.
--
-- Two roles for now:
--   'owner'      — full access (default; preserves existing behavior)
--   'front_desk' — Front Desk tab only
--
-- Super-admins are still identified by tenant_id = '00000000-...' and
-- are not affected by this column.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner'
  CHECK (role IN ('owner', 'front_desk'));
