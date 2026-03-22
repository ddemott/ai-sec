-- Update auto-shop example_services to reflect real shop workflow
-- Order follows car journey: diagnose → inspect → fix

UPDATE business_templates
SET example_services = ARRAY[
  'Diagnostics',
  'Inspections',
  'Basic Service',
  'Brakes',
  'Suspension & Steering',
  'Engine Repair',
  'A/C & Heating'
]
WHERE business_type = 'auto-shop';
