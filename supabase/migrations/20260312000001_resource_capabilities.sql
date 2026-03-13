-- Add capabilities to resources to mirror employee skills
ALTER TABLE resources ADD COLUMN IF NOT EXISTS capabilities TEXT[] DEFAULT '{}';

-- Update the existing search logic/view if necessary (optional for now, 
-- but helps with consistency in the UI)
COMMENT ON COLUMN resources.capabilities IS 'List of skills or services this resource can handle (e.g. "cut-hair", "alignment")';
