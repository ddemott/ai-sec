-- Mark rows created by the setup-wizard's auto-seed (vs typed by the
-- owner) so a business-type change can roll back stale defaults from a
-- prior template without touching anything the owner added themselves.
--
-- Origin: 2026-05-28. Dale picked Bakery in the wizard but the services
-- step still listed answering-service defaults ("Phone Consultation",
-- "Message Taking", ...) because a prior pass had already seeded them
-- and the wizard's `services.length > 0` gate skipped re-seeding.
-- In-memory tracking via autoSeededServiceIdsRef only covered same-session
-- re-pick; a page reload (or earlier session) lost the set.
--
-- The cleanup itself lives in POST /tenants/:id/update-config — whenever
-- business_type changes, DELETE all rows where is_auto_seeded = true so
-- the wizard's next runSeed sees an empty catalog and reseeds for the
-- chosen template.

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS is_auto_seeded BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS is_auto_seeded BOOLEAN NOT NULL DEFAULT false;
