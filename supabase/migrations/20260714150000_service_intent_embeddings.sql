-- MATCH THE SERVICE TO WHAT THE CALLER MEANT, NOT TO WHAT THEY HAPPENED TO SAY.
--
-- resolveServiceForBooking's first step is an ILIKE substring match, which can only
-- succeed if something hands it a string that literally contains the service's name.
-- A caller never does. They say "a meeting", "I want to talk to Dale about a role",
-- "can he look at a project" — and the file's own header has said so from the start:
--
--     "Callers almost never say the exact service name — 'a meeting', 'consulting',
--      'talk to Dale' — none of which substring-match 'Programming Consultation'."
--
-- What it did instead was lean on the LLM: the agent GUESSED a catalog name and passed
-- it down, and the ILIKE match dutifully found whatever the model had guessed. On
-- 2026-07-14 a caller asked for a meeting to discuss a six-month contract and the model
-- passed "Personal Callback" — a 15-minute call-me-back — and the resolver matched it
-- perfectly. The wrong answer arrived through a working mechanism.
--
-- Asking a small model to pick from a catalog is a RETRIEVAL problem dressed up as a
-- reasoning one, and we already have the machinery for retrieval: pgvector, and the
-- same text-embedding-3-small the knowledge base uses. So the model no longer chooses.
-- It reports WHAT THE CALLER SAID, and the database finds the nearest service by
-- meaning.
--
-- The embedding covers name + subtitle + description, because the description is where
-- the intent actually lives: "Discuss a software project or role" is what makes
-- "I want to talk to him about a position" land on Programming Consultation, and
-- nothing in the NAME would ever have got you there.

ALTER TABLE services ADD COLUMN IF NOT EXISTS embedding vector(1536);

COMMENT ON COLUMN services.embedding IS
  'text-embedding-3-small over "name. subtitle. description" — used to match a caller''s spoken intent to a service (serviceResolver). NULL means never embedded; the resolver back-fills lazily and falls back to ILIKE + the tenant default.';

-- Cosine distance, tenant-scoped. Returns the closest service and its similarity so the
-- caller can enforce a threshold — a BAD match is worse than no match, because it books
-- someone into the wrong thing silently, and the default-service fallthrough at least
-- lands on something the owner deliberately chose.
CREATE OR REPLACE FUNCTION match_service_by_intent(
    p_tenant_id uuid,
    p_query_embedding vector(1536)
)
RETURNS TABLE (
    service_id uuid,
    name text,
    duration_minutes int,
    price float8,
    required_skills text[],
    similarity float8
)
LANGUAGE sql
STABLE
AS $$
    SELECT s.service_id,
           s.name,
           s.duration_minutes::int,
           CASE WHEN s.price IS NULL THEN NULL ELSE s.price::float8 END,
           COALESCE(s.required_skills, '{}'),
           1 - (s.embedding <=> p_query_embedding) AS similarity
      FROM services s
     WHERE s.tenant_id = p_tenant_id
       AND s.embedding IS NOT NULL
       AND (s.is_deleted IS NULL OR s.is_deleted = false)
     ORDER BY s.embedding <=> p_query_embedding
     LIMIT 1;
$$;
