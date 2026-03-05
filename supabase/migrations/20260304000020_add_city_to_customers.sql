-- Add city field to customers for structured address entry

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS city TEXT;
