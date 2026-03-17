-- Add nullable vocabulary override columns to tenants
-- NULL means "use the business_templates default for this business_type"
-- Non-NULL means the tenant has customized this label

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS resource_label TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS resource_plural TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS employee_label TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS employee_plural TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_label TEXT;
