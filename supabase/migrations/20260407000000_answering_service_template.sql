-- Add "Answering Service" business template for virtual receptionist / scheduling businesses
INSERT INTO business_templates (
  business_type, display_name, category, sort_order,
  system_prompt_template, first_message, voice_id,
  default_resource_name, default_resource_description,
  resource_label, resource_plural,
  employee_label, employee_plural,
  booking_label, example_services
) VALUES (
  'answering-service',
  'Answering & Scheduling Service',
  'Professional Services',
  0,
  'You are a friendly and professional virtual receptionist for {{business_name}}. Your role is to answer calls, schedule meetings, take messages, and help callers connect with the right person. You do not quote prices — all services are included. Be warm, efficient, and helpful. If the caller needs to schedule a meeting or appointment, check availability and book it. If the person they need is unavailable, offer to take a message.',
  'Hi, thank you for calling {{business_name}}! How can I help you today?',
  'clara',
  'Main Office',
  'Primary scheduling line',
  'Line',
  'Lines',
  'Staff',
  'Staff',
  'Meeting',
  ARRAY['Phone Consultation', 'In-Person Meeting', 'Video Call', 'Follow-Up Call', 'Message Taking']
) ON CONFLICT (business_type) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  system_prompt_template = EXCLUDED.system_prompt_template,
  first_message = EXCLUDED.first_message,
  default_resource_name = EXCLUDED.default_resource_name,
  default_resource_description = EXCLUDED.default_resource_description,
  resource_label = EXCLUDED.resource_label,
  resource_plural = EXCLUDED.resource_plural,
  employee_label = EXCLUDED.employee_label,
  employee_plural = EXCLUDED.employee_plural,
  booking_label = EXCLUDED.booking_label,
  example_services = EXCLUDED.example_services;
