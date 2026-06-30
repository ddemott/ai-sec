-- Editable assistant name (persona_name).
--
-- The assistant's name (e.g. "Chris") lived only inside the free-text
-- tenants.system_prompt, so a client couldn't change it without editing the
-- raw prompt. This adds a first-class column the dashboard can edit on the
-- Business Settings overview; the agent prompt injects it as an authoritative
-- "Your name is X" line that overrides any name baked into the prompt text.
--
-- NULL = no explicit name → the prompt keeps whatever the system_prompt /
-- default identity already says (prior behavior preserved).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS persona_name TEXT;

-- Best-effort backfill: pull the name out of an existing "You are <Name>,"
-- opening line in the system_prompt so current tenants get a sensible value
-- instead of NULL. Only sets it when a clean single-word name is found and
-- persona_name isn't already set.
UPDATE tenants
SET persona_name = substring(system_prompt FROM 'You are ([A-Z][a-zA-Z]+)[,. ]')
WHERE persona_name IS NULL
  AND system_prompt ~ 'You are [A-Z][a-zA-Z]+[,. ]';
