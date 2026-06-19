-- Voice style checkboxes: cheerful (xAI tag), formal/warm/concise (prompt injection).
-- All nullable boolean; NULL = off (same pattern as tts_soft).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tts_cheerful boolean,
  ADD COLUMN IF NOT EXISTS tts_formal   boolean,
  ADD COLUMN IF NOT EXISTS tts_warm     boolean,
  ADD COLUMN IF NOT EXISTS tts_concise  boolean;
