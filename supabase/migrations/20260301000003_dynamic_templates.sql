-- Update business templates to use dynamic placeholders
UPDATE business_templates SET system_prompt_template = REPLACE(system_prompt_template, 'a mobile tire repair shop', 'a mobile tire repair shop called {{business_name}}') WHERE business_type = 'mobile-tire';
UPDATE business_templates SET system_prompt_template = REPLACE(system_prompt_template, 'a hair salon', 'a hair salon called {{business_name}}') WHERE business_type = 'salon';
UPDATE business_templates SET system_prompt_template = REPLACE(system_prompt_template, 'an auto repair shop', 'an auto repair shop called {{business_name}}') WHERE business_type = 'auto-shop';
UPDATE business_templates SET system_prompt_template = REPLACE(system_prompt_template, 'a dental clinic', 'a dental clinic called {{business_name}}') WHERE business_type = 'dentist';

-- Update the apply_business_template_defaults function to replace the placeholder
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
            -- Replace {{business_name}} placeholder with actual business name
            NEW.system_prompt := REPLACE(v_template.system_prompt_template, '{{business_name}}', NEW.name);
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
