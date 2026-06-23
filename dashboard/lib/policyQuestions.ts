/**
 * Re-export shim. The policy question bank now lives in `/shared/questionBank.ts`
 * so the Fastify backend and this dashboard share one source of truth (it was
 * moved out of here 2026-06-19 — see that file's header). Existing dashboard
 * imports (`from '../lib/policyQuestions'`) keep working unchanged.
 */
export {
  type PolicyQuestion,
  type ResolvedQuestion,
  POLICY_CATEGORIES,
  POLICY_QUESTIONS,
  resolveQuestions,
} from '../../shared/questionBank';
