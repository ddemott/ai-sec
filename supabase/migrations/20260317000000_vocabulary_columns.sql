-- Add business-specific vocabulary columns to business_templates
-- These provide per-business-type labels for the dashboard UI

ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS resource_label TEXT NOT NULL DEFAULT 'Resource';
ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS resource_plural TEXT NOT NULL DEFAULT 'Resources';
ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS employee_label TEXT NOT NULL DEFAULT 'Employee';
ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS employee_plural TEXT NOT NULL DEFAULT 'Employees';
ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS booking_label TEXT NOT NULL DEFAULT 'Appointment';
ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS example_services TEXT[] DEFAULT '{}';

-- Populate vocabulary for existing 4 templates
UPDATE business_templates SET
    resource_label = 'Truck',
    resource_plural = 'Trucks',
    employee_label = 'Technician',
    employee_plural = 'Technicians',
    booking_label = 'Appointment'
WHERE business_type = 'mobile-tire';

UPDATE business_templates SET
    resource_label = 'Chair',
    resource_plural = 'Chairs',
    employee_label = 'Stylist',
    employee_plural = 'Stylists',
    booking_label = 'Appointment'
WHERE business_type = 'salon';

UPDATE business_templates SET
    resource_label = 'Bay',
    resource_plural = 'Bays',
    employee_label = 'Mechanic',
    employee_plural = 'Mechanics',
    booking_label = 'Appointment'
WHERE business_type = 'auto-shop';

UPDATE business_templates SET
    resource_label = 'Operatory',
    resource_plural = 'Operatories',
    employee_label = 'Hygienist',
    employee_plural = 'Hygienists',
    booking_label = 'Visit'
WHERE business_type = 'dentist';
