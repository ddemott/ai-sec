-- Split names and addresses into structured fields for customers and users

-- Customers: add first/last name and structured address fields
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT;

-- Backfill first_name / last_name from existing name where possible
UPDATE customers
SET
  first_name = COALESCE(first_name, NULLIF(split_part(name, ' ', 1), '')),
  last_name = COALESCE(
    last_name,
    NULLIF(
      btrim(
        CASE
          WHEN position(' ' IN name) > 0 THEN substring(name FROM position(' ' IN name) + 1)
          ELSE ''
        END
      ),
      ''
    )
  )
WHERE name IS NOT NULL;

-- Users: add first/last name alongside full_name
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Backfill from full_name
UPDATE users
SET
  first_name = COALESCE(first_name, NULLIF(split_part(full_name, ' ', 1), '')),
  last_name = COALESCE(
    last_name,
    NULLIF(
      btrim(
        CASE
          WHEN position(' ' IN full_name) > 0 THEN substring(full_name FROM position(' ' IN full_name) + 1)
          ELSE ''
        END
      ),
      ''
    )
  )
WHERE full_name IS NOT NULL;
