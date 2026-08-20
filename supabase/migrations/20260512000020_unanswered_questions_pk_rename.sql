-- Pilot #20 of the PK naming convention conversion (per CLAUDE.md).
-- Renames unanswered_questions.id → unanswered_question_id.
--
-- Terminal in the schema (zero inbound FKs). Not versioned, not audited.
-- No RPCs reference the column. Consumers:
--   - src/routes/knowledge.ts GET /knowledge/unanswered + PATCH resolve
--   - src/routes/agentTools.ts INSERT (no PK reference)
--   - src/unanswered-questions.test.ts INSERT + RETURNING id reads
--
-- The dashboard consumer (`dashboard/lib/api.ts` -> `Api.knowledge.unanswered`)
-- only reads `questions.length` for the badge count — no PK reference.
-- The route keeps `SELECT unanswered_question_id AS id` to preserve the
-- existing response shape (`Array<{ id: string; ... }>`).

ALTER TABLE unanswered_questions RENAME COLUMN id TO unanswered_question_id;

