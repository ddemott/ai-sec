/**
 * WHO:   resolveQuestions — question-bank resolver for the website-import extractor
 * WHAT:  static policy bank + owner custom questions, deduped
 * WHEN:  owner runs a website scan during onboarding (POST /knowledge/import-website)
 * WHERE: shared/questionBank.ts (consumed by backend + dashboard)
 * WHY:   the extractor must always receive a NON-EMPTY question list. A prior bug
 *        resolved the bank to [] via a brittle cross-package import, silently
 *        extracting nothing. These tests pin the regression shut.
 */

import { describe, it, expect } from 'vitest';
import {
  POLICY_QUESTIONS,
  POLICY_CATEGORIES,
  resolveQuestions,
  type ResolvedQuestion,
} from './questionBank';

describe('question bank static data', () => {
  it('HAPPY: ships a non-empty bank with every question categorized + unique id', () => {
    // WHY: the extractor and the wizard both depend on a populated, well-formed bank
    expect(POLICY_QUESTIONS.length).toBeGreaterThan(0);
    const ids = POLICY_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    for (const q of POLICY_QUESTIONS) {
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(POLICY_CATEGORIES).toContain(q.category);
    }
  });
});

describe('resolveQuestions', () => {
  it('HAPPY: returns the full static bank when no customs are given', () => {
    // WHO: a tenant with zero owner-authored custom questions
    // WHAT: resolver still returns every static bank question
    // WHY: guards the silent-[] regression — bank must never resolve empty
    const resolved = resolveQuestions();
    expect(resolved.length).toBe(POLICY_QUESTIONS.length);
    expect(resolved.every((q: ResolvedQuestion) => q.id !== null)).toBe(true);
  });

  it('HAPPY: appends owner custom questions with null id (no question_bank id)', () => {
    // WHO: owner who added "Do you offer gift cards?" as a custom question
    // WHAT: the custom question is appended so the scan also targets it
    // WHY: "customs" half of the TODO — extractor should answer owner-specific Qs
    const resolved = resolveQuestions({ customs: ['Do you offer gift cards?'] });
    expect(resolved.length).toBe(POLICY_QUESTIONS.length + 1);
    const custom = resolved.find((q) => q.question === 'Do you offer gift cards?');
    expect(custom).toBeDefined();
    expect(custom!.id).toBeNull();
  });

  it('HAPPY: dedupes a custom question that restates a bank question (case-insensitive)', () => {
    // WHAT: a custom question matching a bank question by normalized text is dropped
    // WHY: avoid asking the LLM the same question twice / duplicate suggestions
    const dupe = POLICY_QUESTIONS[0].question.toUpperCase();
    const resolved = resolveQuestions({ customs: [dupe] });
    expect(resolved.length).toBe(POLICY_QUESTIONS.length);
  });

  it('SAD: ignores blank / whitespace-only custom questions', () => {
    // WHAT: empty, whitespace, and undefined-ish entries are filtered out
    // WHY: a blank custom row must not inject an empty question into the prompt
    const resolved = resolveQuestions({ customs: ['', '   ', 'Real custom question?'] });
    expect(resolved.length).toBe(POLICY_QUESTIONS.length + 1);
    expect(resolved.some((q) => q.question === 'Real custom question?')).toBe(true);
  });

  it('SAD: dedupes duplicate customs against each other', () => {
    // WHAT: the same custom question passed twice yields a single entry
    // WHY: a tenant_docs query could return near-duplicate rows; resolver must collapse
    const resolved = resolveQuestions({ customs: ['Same Q?', 'same q?'] });
    expect(resolved.length).toBe(POLICY_QUESTIONS.length + 1);
  });
});
