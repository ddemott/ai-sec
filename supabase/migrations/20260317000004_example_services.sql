-- Populate example_services for all 20 business templates
-- Used by onboarding wizard to pre-fill service suggestions

UPDATE business_templates SET example_services = ARRAY['Tire Rotation', 'Flat Tire Repair', 'Mobile Tire Install', 'Tire Balancing'] WHERE business_type = 'mobile-tire';
UPDATE business_templates SET example_services = ARRAY['Haircut', 'Coloring', 'Blowout', 'Deep Conditioning', 'Highlights'] WHERE business_type = 'salon';
UPDATE business_templates SET example_services = ARRAY['Oil Change', 'Brake Service', 'Engine Diagnostic', 'Tire Rotation', 'State Inspection'] WHERE business_type = 'auto-shop';
UPDATE business_templates SET example_services = ARRAY['Cleaning', 'Exam', 'Filling', 'Crown', 'Whitening'] WHERE business_type = 'dentist';
UPDATE business_templates SET example_services = ARRAY['Checkup', 'Vaccination', 'Dental Cleaning', 'Surgery Consult', 'Grooming'] WHERE business_type = 'vet-clinic';
UPDATE business_templates SET example_services = ARRAY['Adjustment', 'Initial Consultation', 'X-Ray', 'Follow-up Visit'] WHERE business_type = 'chiropractor';
UPDATE business_templates SET example_services = ARRAY['Haircut', 'Beard Trim', 'Hot Shave', 'Kids Cut'] WHERE business_type = 'barbershop';
UPDATE business_templates SET example_services = ARRAY['Manicure', 'Pedicure', 'Gel Nails', 'Acrylic Full Set', 'Nail Art'] WHERE business_type = 'nail-salon';
UPDATE business_templates SET example_services = ARRAY['Swedish Massage', 'Deep Tissue Massage', 'Facial', 'Body Wrap', 'Hot Stone Therapy'] WHERE business_type = 'spa';
UPDATE business_templates SET example_services = ARRAY['Leak Repair', 'Drain Cleaning', 'Toilet Install', 'Water Heater Service', 'Pipe Inspection'] WHERE business_type = 'plumber';
UPDATE business_templates SET example_services = ARRAY['Outlet Install', 'Panel Upgrade', 'Wiring Repair', 'Lighting Install', 'Safety Inspection'] WHERE business_type = 'electrician';
UPDATE business_templates SET example_services = ARRAY['AC Repair', 'Furnace Tune-up', 'Duct Cleaning', 'Thermostat Install', 'Full System Install'] WHERE business_type = 'hvac';
UPDATE business_templates SET example_services = ARRAY['Initial Inspection', 'Interior Treatment', 'Exterior Treatment', 'Rodent Control', 'Termite Inspection'] WHERE business_type = 'pest-control';
UPDATE business_templates SET example_services = ARRAY['Regular Cleaning', 'Deep Clean', 'Move-in/Move-out Clean', 'Office Cleaning', 'Window Cleaning'] WHERE business_type = 'cleaning';
UPDATE business_templates SET example_services = ARRAY['Lawn Mowing', 'Hedge Trimming', 'Leaf Removal', 'Mulching', 'Spring Cleanup'] WHERE business_type = 'landscaping';
UPDATE business_templates SET example_services = ARRAY['1-on-1 Session', 'Fitness Assessment', 'Group Training', 'Nutrition Consult'] WHERE business_type = 'personal-trainer';
UPDATE business_templates SET example_services = ARRAY['Vinyasa Flow', 'Hot Yoga', 'Beginner Basics', 'Meditation', 'Private Session'] WHERE business_type = 'yoga-studio';
UPDATE business_templates SET example_services = ARRAY['Individual Tax Filing', 'Business Tax Filing', 'Tax Planning Consult', 'Audit Support'] WHERE business_type = 'tax-prep';
UPDATE business_templates SET example_services = ARRAY['Math Tutoring', 'Science Tutoring', 'SAT Prep', 'Essay Review', 'Study Skills Coaching'] WHERE business_type = 'tutoring';
UPDATE business_templates SET example_services = ARRAY['Headshots', 'Family Portrait', 'Event Photography', 'Product Photography', 'Mini Session'] WHERE business_type = 'photography';
