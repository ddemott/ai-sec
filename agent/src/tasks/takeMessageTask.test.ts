/**
 * The take-message rung proves the narrate-instead-of-act failure is now structurally
 * impossible: the rung ends ONLY when take_message returns a real message_id. Saying "I've
 * passed that along" — the exact sentence that lost a message on the 2026-07-16 ladder
 * call — advances nothing, because the completion lives inside the tool.
 *
 * These call the wrapped tool directly, the way the model would — no LLM, no backend.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { llm, initializeLogger } from '@livekit/agents';
import {
  makeTakeMessageRung,
  TAKE_MESSAGE_INSTRUCTIONS,
  TAKE_MESSAGE_INTRO,
} from './takeMessageTask.js';

beforeAll(() => {
  initializeLogger({ pretty: false, level: 'silent' });
});

/** A stand-in tool whose return value + received args the test controls. */
function fakeTool(returns: unknown, onCall?: (args: unknown) => void) {
  return llm.tool({
    description: 'x',
    parameters: { type: 'object', properties: {} },
    execute: async (args: unknown) => {
      onCall?.(args);
      return returns;
    },
  });
}

async function callTool(
  task: ReturnType<typeof makeTakeMessageRung>,
  name: string,
  args: unknown = {}
): Promise<unknown> {
  const tool = (task.toolCtx as Record<string, unknown>)[name] as {
    execute: (a: unknown, c: unknown) => Promise<unknown>;
  };
  expect(tool, `the rung must expose ${name}`).toBeDefined();
  return tool.execute(args, { ctx: {}, toolCallId: 'tc' });
}

describe('TakeMessageTask — the write IS the transition', () => {
  it('HAPPY: a successful take_message (message_id back) ends the rung', async () => {
    const onMessageTaken = vi.fn();
    const task = makeTakeMessageRung({
      messagingTools: {
        take_message: fakeTool(JSON.stringify({ saved: true, message_id: 'msg-1' })),
      },
      onMessageTaken,
    });
    expect(task.done).toBe(false);
    await callTool(task, 'take_message', { caller_name: 'Jack', message: 'call me' });
    expect(task.done, 'a real message_id ends the rung').toBe(true);
    expect(onMessageTaken).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-1' }));
  });

  it('SAD: a REFUSED take_message (no message_id) does NOT end the rung', async () => {
    // The safe direction: if the write did not land, the rung stays open and the model
    // tries again — never a message reported as saved that was not.
    const task = makeTakeMessageRung({
      messagingTools: {
        take_message: fakeTool(JSON.stringify({ error: 'missing name or number' })),
      },
    });
    await callTool(task, 'take_message', { message: 'call me' });
    expect(task.done, 'no id back = not saved = rung stays open').toBe(false);
  });

  it('SAD: caller_name is defaulted from the known identity when the model omits it', async () => {
    // gotcha #2: merge known facts before the call, so a model that forgets caller_name
    // still records the message under the confirmed name.
    let seen: Record<string, unknown> | undefined;
    const task = makeTakeMessageRung({
      knownName: 'Dale',
      messagingTools: {
        take_message: fakeTool(JSON.stringify({ saved: true, message_id: 'msg-2' }), (a) => {
          seen = a as Record<string, unknown>;
        }),
      },
    });
    await callTool(task, 'take_message', { message: 'have him call me' });
    expect(seen?.caller_name, 'known name is injected').toBe('Dale');
    expect(task.done).toBe(true);
  });

  it('SAD: the rung carries ONLY take_message — nothing to wander into', () => {
    const task = makeTakeMessageRung({
      messagingTools: {
        take_message: fakeTool('{}'),
        capture_job_inquiry: fakeTool('{}'), // should be dropped as passthrough noise
      },
    });
    expect(Object.keys(task.toolCtx)).toEqual(['take_message']);
  });

  it('SAD: it refuses to build without take_message', () => {
    // A take-message rung with no take_message tool can never complete — fail loudly at
    // construction, not silently on a live call.
    expect(() => makeTakeMessageRung({ messagingTools: {} })).toThrow(/requires/i);
  });

  it('SAD: the instructions are ACTION-FIRST and keep a message a message', () => {
    // Rule 9 (reorder beats prohibition) + the 2026-07-16 disambiguation: a message that
    // mentions a job/callback is still a message, not a booking or a role.
    expect(TAKE_MESSAGE_INSTRUCTIONS).toMatch(/VERY NEXT action is to CALL take_message/);
    expect(TAKE_MESSAGE_INSTRUCTIONS).toMatch(/still a message/i);
    // No real person's name may be baked into a shared rung (gotcha E).
    expect(TAKE_MESSAGE_INSTRUCTIONS).not.toMatch(/dale/i);
    expect(TAKE_MESSAGE_INTRO).not.toMatch(/dale/i);
  });
});
