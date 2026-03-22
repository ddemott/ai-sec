-- Solo wizard branching support.
-- team_size determines wizard flow: 1 = SoloWizard, >1 = SetupWizard
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS team_size INTEGER DEFAULT 1;

-- For solo operators: flag to mark the auto-created personal resource
ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_personal BOOLEAN DEFAULT false;
