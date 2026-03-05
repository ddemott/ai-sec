-- Migration to add first_name and last_name to users

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Best-effort backfill from full_name where possible.
-- Heuristic: first token = first_name, everything after first space = last_name.
UPDATE users
SET
  first_name = COALESCE(first_name, split_part(full_name, ' ', 1)),
  last_name = COALESCE(
    last_name,
    NULLIF(
      CASE
        WHEN full_name IS NULL THEN NULL
        WHEN full_name NOT LIKE '% %' THEN NULL
        ELSE substr(full_name, position(' ' IN full_name) + 1)
      END,
      ''
    )
  )
WHERE full_name IS NOT NULL;
