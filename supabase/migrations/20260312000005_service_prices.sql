-- Add price to services for revenue estimation
ALTER TABLE services ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) DEFAULT 0.00;

-- Update existing services with some default prices based on duration
UPDATE services SET price = 50.00 WHERE duration_minutes <= 30 AND price = 0;
UPDATE services SET price = 100.00 WHERE duration_minutes > 30 AND price = 0;
