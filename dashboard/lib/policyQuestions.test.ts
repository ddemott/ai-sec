/**
 * WHO:   dashboard consumers of the policy question bank (SetupWizard,
 *        KnowledgeBaseView, Step7WebsiteScan/CallerQuestions)
 * WHAT:  policyQuestions.ts is now a thin re-export of shared/questionBank.ts
 * WHEN:  every wizard / KB render that imports POLICY_QUESTIONS / resolveQuestions
 * WHERE: dashboard/lib/policyQuestions.ts → ../../shared/questionBank
 * WHY:   the move to /shared was only typechecked + matched the proven phone.ts
 *        pattern. This executes the re-export at runtime so a broken module path
 *        or missing export fails here, not silently at dashboard build/render.
 */

import { describe, it, expect } from 'vitest';
import {
  POLICY_QUESTIONS,
  POLICY_CATEGORIES,
  resolveQuestions,
  type PolicyQuestion,
} from './policyQuestions';

describe('policyQuestions re-export shim', () => {
  it('HAPPY: re-exports a populated, well-formed bank from /shared', () => {
    // WHY: the shim must surface the real shared data, not undefined/empty
    expect(Array.isArray(POLICY_QUESTIONS)).toBe(true);
    expect(POLICY_QUESTIONS.length).toBeGreaterThan(0);
    expect(POLICY_CATEGORIES.length).toBeGreaterThan(0);
    const sample: PolicyQuestion = POLICY_QUESTIONS[0];
    expect(sample.id).toBeTruthy();
    expect(sample.question).toBeTruthy();
    expect(POLICY_CATEGORIES).toContain(sample.category);
  });

  it('HAPPY: re-exports the resolveQuestions helper and it runs', () => {
    // WHY: KB/import consumers call resolveQuestions through this shim
    const resolved = resolveQuestions({ customs: ['Do you offer gift cards?'] });
    expect(resolved.length).toBe(POLICY_QUESTIONS.length + 1);
    expect(resolved.some((q) => q.question === 'Do you offer gift cards?')).toBe(true);
  });
});
