/**
 * The retrieval parameters the LIVE agent answers with — one definition, two
 * readers: /agent-tools/policy-answer (which uses them to answer a caller) and
 * the /knowledge/explain debugger (which uses them to tell an owner what that
 * answer will be).
 *
 * THIS FILE EXISTS BECAUSE A COMMENT FAILED AT THE JOB. The debugger carried a
 * `// kept in sync with /agent-tools/policy-answer` note over its own copy of
 * these numbers, and it was not in sync: the live threshold was lowered 0.5 →
 * 0.30 after an eval, and the copy under the comment stayed at 0.5. Nothing
 * failed. The debugger simply began reporting `would_answer: false` for the
 * entire 0.30–0.5 band — which is precisely the band the lowering existed to
 * capture — so an owner checking a question the agent answers correctly was told
 * their KB could not answer it, and the obvious response is to add a second copy
 * of content that was already working. A comment asks a future editor to
 * remember two places; an import makes the second place impossible.
 *
 * Changing a number here changes what callers hear. Re-run the eval
 * (`./scripts/simulate.sh rag`) before touching one.
 */

/**
 * Minimum cosine similarity for a chunk to be worth answering from.
 *
 * 0.30, down from 0.5: validated against a widened eval set (8 paraphrased
 * positives + true out-of-scope negatives). text-embedding-3-small clusters
 * tightly (~0.2–0.65 here), so 0.5 was unreachable for any vocabulary-gap query
 * — "what's your address" against a doc that says "located" scored 0.31. 0.30
 * sits in the measured ~0.13 gap between the lowest expanded positive (0.377)
 * and the highest true negative (0.248).
 */
export const PROD_THRESHOLD = 0.3;

/** How many chunks are joined into the context the agent reads. */
export const PROD_MATCH_COUNT = 3;
