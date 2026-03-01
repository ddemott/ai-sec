-- Add owner_phone to tenants for SMS notifications
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_phone TEXT;

-- Update the RLS policy to ensure it still works with the new column (redundant but safe)
-- Row Level Security policies automatically apply to new columns unless specified otherwise.
