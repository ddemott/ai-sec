-- Create a table for Business Templates
CREATE TABLE IF NOT EXISTS business_templates (
    business_type TEXT PRIMARY KEY, -- e.g., 'mobile-tire', 'salon', 'auto-shop', 'dentist'
    display_name TEXT NOT NULL,
    system_prompt_template TEXT NOT NULL,
    first_message TEXT NOT NULL,
    voice_id TEXT, -- Default voice ID for this business type
    default_resource_name TEXT NOT NULL,
    default_resource_description TEXT
);

-- Ensure first_message column exists on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS first_message TEXT;

-- Enable RLS for business_templates (publicly readable for the app)
ALTER TABLE business_templates ENABLE ROW LEVEL SECURITY;
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Publicly readable templates') THEN
        CREATE POLICY "Publicly readable templates" ON business_templates FOR SELECT USING (true);
    END IF;
END $$;

-- Initial Business Templates
INSERT INTO business_templates (business_type, display_name, system_prompt_template, first_message, voice_id, default_resource_name, default_resource_description)
VALUES
(
    'mobile-tire',
    'Mobile Tire Shop',
    'You are a professional secretary for a mobile tire repair shop. Your goal is to help customers book appointments for tire services. Collect their name, vehicle info, and tire issue. Check availability before confirming.',
    'Thanks for calling! This is your mobile tire assistant. How can I help you today?',
    'ba124806-6962-4354-94a0-7607775952f4',
    'Service Truck 1',
    'Main mobile unit for tire repairs'
),
(
    'salon',
    'Hair Salon',
    'You are a professional receptionist for a hair salon. Your goal is to book appointments for haircuts, coloring, and styling. Collect the customer''s name and the specific service they need. Check stylist availability.',
    'Welcome to the salon! This is your booking assistant. Would you like to schedule a haircut or coloring today?',
    '21m00Tcm4llvDq8ikWAM', -- Rachel voice (ElevenLabs)
    'Styling Station 1',
    'Main chair for hair services'
),
(
    'auto-shop',
    'Auto Repair Shop',
    'You are a professional service advisor for an auto repair shop. Your goal is to schedule repairs and maintenance. Collect the customer''s name, vehicle year/make/model, and the issue they are experiencing.',
    'Thanks for calling the auto shop! How can we help with your vehicle today?',
    'pNInz6ovDWjNkhCspfAY', -- Josh voice (ElevenLabs)
    'Service Bay 1',
    'Standard repair and maintenance bay'
),
(
    'dentist',
    'Dental Clinic',
    'You are a professional patient coordinator for a dental clinic. Your goal is to schedule cleanings, exams, and emergency visits. Collect the patient''s name and the reason for their visit.',
    'Thank you for calling our dental office. Are you looking to schedule a cleaning or a consultation?',
    'ErXwSzhRj4IW3zYCt9a2', -- Antoni voice (ElevenLabs)
    'Operatory 1',
    'Main dental examination room'
)
ON CONFLICT (business_type) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    system_prompt_template = EXCLUDED.system_prompt_template,
    first_message = EXCLUDED.first_message,
    voice_id = EXCLUDED.voice_id,
    default_resource_name = EXCLUDED.default_resource_name,
    default_resource_description = EXCLUDED.default_resource_description;

-- Function to apply template DEFAULTS to a new tenant BEFORE insert
CREATE OR REPLACE FUNCTION apply_business_template_defaults()
RETURNS TRIGGER AS $$
DECLARE
    v_template business_templates%ROWTYPE;
BEGIN
    -- Look up the template for the business type
    SELECT * INTO v_template FROM business_templates WHERE business_type = NEW.business_type;
    
    -- If template exists, apply defaults to the tenant if they are NULL
    IF FOUND THEN
        IF NEW.system_prompt IS NULL THEN
            NEW.system_prompt := v_template.system_prompt_template;
        END IF;
        
        IF NEW.voice_id IS NULL THEN
            NEW.voice_id := v_template.voice_id;
        END IF;

        IF NEW.first_message IS NULL THEN
            NEW.first_message := v_template.first_message;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to apply defaults BEFORE tenant creation
DROP TRIGGER IF EXISTS on_tenant_created_defaults ON tenants;
CREATE TRIGGER on_tenant_created_defaults
    BEFORE INSERT ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION apply_business_template_defaults();

-- Function to create default resources AFTER tenant insertion
CREATE OR REPLACE FUNCTION create_default_resources()
RETURNS TRIGGER AS $$
DECLARE
    v_template business_templates%ROWTYPE;
BEGIN
    -- Look up the template for the business type
    SELECT * INTO v_template FROM business_templates WHERE business_type = NEW.business_type;
    
    -- If template exists, create the default resource
    IF FOUND THEN
        INSERT INTO resources (tenant_id, name, description)
        VALUES (NEW.id, v_template.default_resource_name, v_template.default_resource_description);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create resources AFTER tenant creation
DROP TRIGGER IF EXISTS on_tenant_created_resources ON tenants;
CREATE TRIGGER on_tenant_created_resources
    AFTER INSERT ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION create_default_resources();
