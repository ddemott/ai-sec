/**
 * WHO:   a business owner using the KB answer debugger, and every caller the
 *        agent answers a policy question for.
 * WHAT:  /agent-tools/policy-answer (what a caller is TOLD) and /knowledge/explain
 *        (what an owner is SHOWN about that) must retrieve on identical terms.
 * WHEN:  the threshold was lowered 0.5 → 0.30 against a widened RAG eval. Only
 *        the live route was updated. The debugger kept 0.5 under a comment
 *        reading "kept in sync with /agent-tools/policy-answer".
 * WHERE: src/routes/agentTools/knowledge.ts, src/services/knowledge/answerExplainer.ts,
 *        both now reading src/services/knowledge/retrievalParams.ts.
 * WHY:   the drift was SILENT and worse than a crash. For every question scoring
 *        in the 0.30–0.5 band — exactly the band the lowering existed to capture
 *        — the debugger reported `would_answer: false` about a question the
 *        agent answers correctly. The owner's rational response to "your KB
 *        can't answer this" is to write the content again, so a tool sold as
 *        removing guesswork was manufacturing duplicate KB entries.
 *
 * WHY A SOURCE-READING TEST: with both sides importing one module the values
 *        cannot differ, so asserting they are equal would compare a constant to
 *        itself and prove nothing. The failure mode that actually happened, and
 *        the only one still available, is a future edit typing a number back in
 *        at a call site. That is what this reads for. Same shape and same reason
 *        as policyFallbackContract.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROD_MATCH_COUNT, PROD_THRESHOLD } from '../../src/services/knowledge/retrievalParams';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const LIVE_ROUTE = 'src/routes/agentTools/knowledge.ts';
const DEBUGGER = 'src/services/knowledge/answerExplainer.ts';

describe('the retrieval parameters a caller is answered on and an owner is shown', () => {
  it('the live policy-answer route passes the shared constants, not literals, to the RPC', () => {
    const src = read(LIVE_ROUTE);
    // The RPC's 3rd/4th arguments are the threshold and match count.
    const call = /search_tenant_docs_normalized[\s\S]{0,400}?\[([\s\S]*?)\]\s*\)/.exec(src);
    expect(call, `no search_tenant_docs_normalized call found in ${LIVE_ROUTE}`).not.toBeNull();
    const args = call![1];
    expect(
      args.includes('PROD_THRESHOLD') && args.includes('PROD_MATCH_COUNT'),
      `${LIVE_ROUTE} no longer passes PROD_THRESHOLD / PROD_MATCH_COUNT to ` +
        `search_tenant_docs_normalized. If a number was typed in here, the ` +
        `/knowledge/explain debugger now reports retrieval parameters the live ` +
        `path does not use, and owners will be told their KB cannot answer ` +
        `questions the agent answers. Import them from services/knowledge/retrievalParams.`
    ).toBe(true);
  });

  it('the answer debugger imports the constants rather than declaring its own', () => {
    const src = read(DEBUGGER);
    expect(src).toContain("from './retrievalParams'");
    expect(
      /const\s+PROD_(THRESHOLD|MATCH_COUNT)\s*=/.test(src),
      `${DEBUGGER} declares its own PROD_THRESHOLD/PROD_MATCH_COUNT. That local ` +
        `copy is exactly how the debugger fell out of step with production ` +
        `before — it sat under a comment promising it was in sync. Import from ` +
        `./retrievalParams instead.`
    ).toBe(false);
  });

  it('the shared values are the ones the RAG eval validated', () => {
    // WHY pin the literals HERE and nowhere else: retrievalParams is the one
    // place a change is deliberate and reviewable. Re-tuning is expected — the
    // failing assertion is the prompt to re-run `./scripts/simulate.sh rag` and
    // update this line in the same commit, not a claim the number is immutable.
    expect(PROD_THRESHOLD).toBe(0.3);
    expect(PROD_MATCH_COUNT).toBe(3);
  });
});
