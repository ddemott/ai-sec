-- Tenant sort order for admin dashboard (drag-and-drop reordering)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
