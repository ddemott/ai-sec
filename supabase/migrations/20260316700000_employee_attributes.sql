-- Add richer employee attributes: first_name, last_name, email, phone
-- Migrate existing 'name' data into first_name/last_name

ALTER TABLE employees ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT;

-- Migrate existing name data: split on first space
UPDATE employees
SET first_name = split_part(name, ' ', 1),
    last_name  = CASE
      WHEN position(' ' in name) > 0
      THEN substring(name from position(' ' in name) + 1)
      ELSE NULL
    END
WHERE first_name IS NULL;
