/**
 * buildChecklistPrompt — the system prompt for the question-tree flow.
 *
 * These guard the WRONG BUSINESS branch added 2026-07-22 after a live call
 * froze and hung up: "Is this Bob's waxing service?" was routed by "THE ELSE"
 * to a speculative message tree, which locked the goodbye gate on a caller who
 * had nothing to leave. The fix lives in the prompt (the host gate is
 * deliberately strict — see checklistTools.test.ts), so a prompt that loses
 * this guidance silently reopens the deadlock. These tests fail if it does.
 */
import { describe, it, expect } from 'vitest';
import { buildChecklistPrompt } from './checklistAgent.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';

const prompt = buildChecklistPrompt({
  persona: 'You are Chris, the receptionist for Thinking Hammer.',
  runtime: {
    currentDate: 'Wednesday, July 22, 2026',
    timezone: 'America/Chicago',
    businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
    bookableThrough: 'Friday, August 21, 2026',
  },
  library: PLATFORM_TREE_LIBRARY,
  callerPhone: '+12624979039',
});

describe('buildChecklistPrompt — wrong-business handling', () => {
  it('carries an explicit WRONG BUSINESS branch that answers in plain text and selects no tree', () => {
    // WHO: the "is this <other business>?" caller | WHERE: set_purpose guidance
    // WHY: selecting a tree here jams the goodbye gate — the exact freeze bug.
    expect(prompt).toMatch(/WRONG BUSINESS/);
    expect(prompt).toMatch(/do NOT select any tree/i);
    // The graceful answer the caller expected: restate who this business is.
    expect(prompt).toMatch(/No, this is/i);
  });

  it('gives a wrong-number EXIT — deselect via wrong_trees, then finish_call — if a tree was already selected', () => {
    // WHO: a model that speculatively selected before realizing the wrong number
    // WHY: the gate stays strict; the escape is removing the tree, not weakening
    //      the gate, so the caller is never stranded on dead air.
    expect(prompt).toMatch(/wrong_trees/);
    expect(prompt).toMatch(/finish_call/);
  });

  it('scopes THE ELSE so a bare identity question is NOT auto-routed to a message', () => {
    // WHO: THE ELSE catch-all | WHY: it used to fire message+generic_subject for
    // ANY unclassifiable input, including a wrong-number question — the trap.
    expect(prompt).toMatch(/wants something FROM THIS business/i);
  });
});
