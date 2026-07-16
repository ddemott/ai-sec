/**
 * The Q&A rung's guarantees: a questions-call cannot end mid-question (the loop holds
 * until questions_answered fires), a KB miss cannot strand the caller (take_message is
 * a real ACTION ending, so "the owner will get back to you" always has a write behind
 * it), and answering runs through RETRIEVAL — the model holds no other tool it could
 * substitute an invented answer with... structurally. (What it SAYS is still prompt
 * discipline; what it can DO is pinned here.)
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { llm, initializeLogger } from '@livekit/agents';
import {
  makePolicyQaRung,
  POLICY_QA_INSTRUCTIONS,
  POLICY_QA_INTRO,
  QA_BOOKING_FOLLOWS,
  QA_NO_BOOKING_FOLLOWS,
  QA_KB_MISS_WITH_MESSAGE,
  QA_KB_MISS_NO_MESSAGE,
} from './policyQaTask.js';

beforeAll(() => {
  initializeLogger({ pretty: false, level: 'silent' });
});

function fakeTool(returns: unknown) {
  return llm.tool({
    description: 'x',
    parameters: { type: 'object', properties: {} },
    execute: async () => returns,
  });
}

async function callTool(
  task: ReturnType<typeof makePolicyQaRung>,
  name: string,
  args: unknown = {}
): Promise<unknown> {
  const tool = (task.toolCtx as Record<string, unknown>)[name] as {
    execute: (a: unknown, c: unknown) => Promise<unknown>;
  };
  expect(tool, `the rung must expose ${name}`).toBeDefined();
  return tool.execute(args, { ctx: {}, toolCallId: 'tc' });
}

describe('PolicyQaTask — answers come from retrieval, and the call ends properly', () => {
  it('HAPPY: questions_answered ends the rung with outcome=answered', async () => {
    const onAnswered = vi.fn();
    const task = makePolicyQaRung({
      knowledgeTools: { get_company_policy_answer: fakeTool('We open at 8am.') },
      onAnswered,
    });
    expect(task.done).toBe(false);
    await callTool(task, 'questions_answered', {});
    expect(task.done, 'saying "that is all" via the tool ends the rung').toBe(true);
    expect(onAnswered).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'answered' }));
  });

  it('SAD: ASKING a question (the retrieval tool) does NOT end the rung', async () => {
    // Looking something up is not being done — the caller may have five questions.
    const task = makePolicyQaRung({
      knowledgeTools: { get_company_policy_answer: fakeTool('We open at 8am.') },
    });
    await callTool(task, 'get_company_policy_answer', { question: 'when are you open?' });
    expect(task.done, 'a retrieval never completes the rung').toBe(false);
  });

  it('HAPPY: the take_message FALLBACK records a real message and ends the rung', async () => {
    // The KB miss pivot: the route's fallback text offers "I can take a message" —
    // this rung must be able to DO that, or it promises a save it cannot perform.
    const onAnswered = vi.fn();
    const task = makePolicyQaRung({
      knowledgeTools: { get_company_policy_answer: fakeTool('no info') },
      takeMessage: fakeTool(JSON.stringify({ saved: true, message_id: 'msg-qa-1' })),
      onAnswered,
    });
    await callTool(task, 'take_message', {
      caller_name: 'Pat',
      callback_phone: '555-000-1111',
      message: 'Do you service diesel engines?',
    });
    expect(task.done).toBe(true);
    expect(onAnswered).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'message', messageId: 'msg-qa-1' })
    );
  });

  it('SAD: a REFUSED take_message (no id) keeps the rung open', async () => {
    const task = makePolicyQaRung({
      knowledgeTools: { get_company_policy_answer: fakeTool('no info') },
      takeMessage: fakeTool(JSON.stringify({ error: 'missing name or number' })),
    });
    await callTool(task, 'take_message', { message: 'question' });
    expect(task.done, 'no id back = not saved = rung stays open').toBe(false);
  });

  it('SAD: the rung holds ONLY retrieval + its exits — nothing to wander into', () => {
    const task = makePolicyQaRung({
      knowledgeTools: {
        get_company_policy_answer: fakeTool('x'),
        get_service_catalog: fakeTool('x'), // must be dropped — not this rung's job
      },
      takeMessage: fakeTool('{}'),
    });
    expect(Object.keys(task.toolCtx).sort()).toEqual([
      'get_company_policy_answer',
      'questions_answered',
      'take_message',
    ]);
  });

  it('SAD: it refuses to build without the retrieval tool', () => {
    expect(() => makePolicyQaRung({ knowledgeTools: {} })).toThrow(/requires/i);
  });

  it('SAD: the rung is not an ISLAND — it knows whether a booking step follows', () => {
    // The 0/4 live-LLM run: mid-questions the caller said "can I go ahead and book?"
    // and the rung — holding no booking tools — truthfully said "I don't have the
    // ability to book", torpedoing the booking rung queued right behind it. With
    // bookingFollows the instructions make "I want to book" the completion cue; and
    // without it, the rung offers a real recorded message instead of a dead "I can't".
    const mixed = makePolicyQaRung({
      knowledgeTools: { get_company_policy_answer: fakeTool('x') },
      bookingFollows: true,
    }) as unknown as { instructions: string };
    expect(mixed.instructions).toContain('A BOOKING STEP COMES RIGHT AFTER');
    expect(mixed.instructions).toMatch(/NEVER say you cannot book/);

    const solo = makePolicyQaRung({
      knowledgeTools: { get_company_policy_answer: fakeTool('x') },
      takeMessage: fakeTool('{}'),
    }) as unknown as { instructions: string };
    expect(solo.instructions).toContain(QA_NO_BOOKING_FOLLOWS);
    expect(solo.instructions).not.toContain(QA_BOOKING_FOLLOWS);
  });

  it('SAD: the instructions never name a tool the rung does not hold', () => {
    // Copilot review catch (2026-07-16): the KB-miss guidance told the model to CALL
    // take_message unconditionally, but takeMessage is optional — an instruction
    // naming an absent tool is impossible to follow, and impossible instructions
    // strand callers.
    const withMsg = makePolicyQaRung({
      knowledgeTools: { get_company_policy_answer: fakeTool('x') },
      takeMessage: fakeTool('{}'),
    }) as unknown as { instructions: string };
    expect(withMsg.instructions).toContain(QA_KB_MISS_WITH_MESSAGE);

    const withoutMsg = makePolicyQaRung({
      knowledgeTools: { get_company_policy_answer: fakeTool('x') },
    }) as unknown as { instructions: string };
    expect(withoutMsg.instructions).toContain(QA_KB_MISS_NO_MESSAGE);
    expect(withoutMsg.instructions).not.toMatch(/CALL take_message/);
  });

  it('SAD: instructions are retrieval-first and action-first, with no real names', () => {
    expect(POLICY_QA_INSTRUCTIONS).toMatch(/VERY NEXT action is to CALL get_company_policy_answer/);
    expect(POLICY_QA_INSTRUCTIONS).toMatch(/never answer from memory/i);
    expect(POLICY_QA_INSTRUCTIONS).toMatch(/VERY NEXT action is to CALL questions_answered/);
    expect(POLICY_QA_INSTRUCTIONS).not.toMatch(/dale/i);
    expect(POLICY_QA_INTRO).not.toMatch(/dale/i);
  });
});
