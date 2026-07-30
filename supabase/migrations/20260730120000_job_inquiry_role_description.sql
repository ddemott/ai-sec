-- role_description: the role itself, in the caller's own words — title, tech,
-- responsibilities, whatever they led with.
--
-- The job question tree has ALWAYS collected this (node 'role_description',
-- agent/src/checklist/trees.ts) — the agent asks "could you provide the exact
-- role description as you would like me to record it?", the caller dictates a
-- paragraph, the tracker marks the node ✓ … and the write layer dropped it: no
-- tool param, no Zod field, no column. Verified against prod 2026-07-30 on call
-- SCL_nRKo3KEVw8Yh (Sage / eTeam → Capgemini): every OTHER field landed; the one
-- describing WHAT JOB survives only in the raw transcript. The owner's inquiry
-- view showed employment type, rate, and location for a role with no name.
--
-- Same "state theater" class as the dropped location_type lesson in
-- checklistTools.ts: host-owned state that the write ignores. The companion
-- completeness test (tests in agent/src/checklist) now asserts every collected
-- tree node maps to a tool param, so the next added node cannot silently vanish.
ALTER TABLE job_inquiries
  ADD COLUMN role_description TEXT;

COMMENT ON COLUMN job_inquiries.role_description IS
  'The role in the caller''s own words (title, tech, responsibilities) — collected by the job tree''s role_description node.';
