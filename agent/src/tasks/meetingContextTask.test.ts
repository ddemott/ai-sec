/**
 * The meeting-goals rung (rung 3): context attaches to the meeting through a WRITE, and
 * the template — job intake vs. one light notes question — is data, not a new rung. The
 * notes rung has three honest endings (attached / nothing to add / recorded as a message)
 * and one host-code decision: no meeting on the call → no question asked, ever.
 *
 * These call the wrapped tools directly, the way the model would — no LLM, no backend.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { llm, initializeLogger } from '@livekit/agents';
import {
  makeMeetingContextRung,
  makeMeetingNotesRung,
  MEETING_NOTES_INSTRUCTIONS,
} from './meetingContextTask.js';
import { JOB_INTAKE_INSTRUCTIONS } from './jobIntakeTask.js';

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
  task: { toolCtx: Record<string, unknown>; done: boolean },
  name: string,
  args: unknown = {}
): Promise<unknown> {
  const tool = task.toolCtx[name] as {
    execute: (a: unknown, c: unknown) => Promise<unknown>;
  };
  expect(tool, `the rung must expose ${name}`).toBeDefined();
  return tool.execute(args, { ctx: {}, toolCallId: 'tc' });
}

describe('MeetingContextTask — notes template: the attach IS the transition', () => {
  it('HAPPY: a successful attach_meeting_notes (appointment_id back) ends the rung', async () => {
    const task = makeMeetingNotesRung({
      meetingBooked: true,
      notesTool: fakeTool(JSON.stringify({ appointment_id: 'appt-1', message: 'Noted.' })),
    });
    expect(task.done).toBe(false);
    await callTool(task, 'attach_meeting_notes', { notes: 'bring the contract paperwork' });
    expect(task.done, 'a real appointment_id ends the rung').toBe(true);
  });

  it('HAPPY: no_notes ends the rung without any write — the honest "nothing to add" exit', async () => {
    const task = makeMeetingNotesRung({
      meetingBooked: true,
      notesTool: fakeTool('{}'),
    });
    await callTool(task, 'no_notes');
    expect(task.done, 'a caller with nothing to add must not hang the loop').toBe(true);
  });

  it('SAD: a FAILED attach (no appointment_id back) does NOT end the rung', async () => {
    // The safe direction: if the write did not land, the rung stays open — never a note
    // reported as saved that was not.
    const task = makeMeetingNotesRung({
      meetingBooked: true,
      notesTool: fakeTool(JSON.stringify({ error: 'not found' })),
    });
    await callTool(task, 'attach_meeting_notes', { notes: 'x' });
    expect(task.done, 'no id back = not saved = rung stays open').toBe(false);
  });

  it('HAPPY: the take_message FALLBACK completes the rung — an offer to pass along always has a write behind it', async () => {
    const onMessageTaken = vi.fn();
    let seen: Record<string, unknown> | undefined;
    const task = makeMeetingNotesRung({
      meetingBooked: true,
      knownName: 'Priya',
      notesTool: fakeTool('{}'),
      takeMessage: fakeTool(JSON.stringify({ saved: true, message_id: 'msg-9' }), (a) => {
        seen = a as Record<string, unknown>;
      }),
      onMessageTaken,
    });
    await callTool(task, 'take_message', { message: 'have the owner call me first' });
    expect(task.done).toBe(true);
    expect(seen?.caller_name, 'known name is injected (gotcha #2)').toBe('Priya');
    expect(onMessageTaken).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-9' }));
  });

  it('SAD: NO booked meeting → the rung completes on entry, in host code, without a spoken turn', async () => {
    // The booking fell back to a message: there is no appointment to note against, and
    // the caller must never be asked about a meeting that does not exist.
    const task = makeMeetingNotesRung({
      meetingBooked: false,
      notesTool: fakeTool('{}'),
    });
    expect(task.done).toBe(false);
    await (task as unknown as { onEnter: () => Promise<void> }).onEnter();
    expect(task.done, 'skip is a host-code decision, not a model choice').toBe(true);
  });

  it('SAD: no attach tool in this session → same host-code skip (capability off ≠ dead rung)', async () => {
    const task = makeMeetingNotesRung({ meetingBooked: true });
    await (task as unknown as { onEnter: () => Promise<void> }).onEnter();
    expect(task.done).toBe(true);
  });

  it('SAD: the instructions are ACTION-FIRST, ask ONCE, and never re-collect identity', () => {
    // Rule 9 (reorder beats prohibition): the tool call comes before the confirmation
    // sentence, and one light question is the WHOLE step — not an interview.
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(/VERY NEXT action is to CALL attach_meeting_notes/);
    // Tightened on #286 review: ONE notes question + at most the single point-1
    // follow-up — anything further is forbidden explicitly.
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(/Ask the notes question ONCE/);
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(/at most, the single follow-up/);
    // The 2026-07-18 curveball: "he'll need my address" was attached AS the
    // note — a pointer, not the address. The rule: when the answer refers to a
    // concrete thing the caller hasn't spoken, ask for the thing itself.
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(/ASK FOR THE THING ITSELF/);
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(
      /The information is the note; the mention of it is not/
    );
    // The sim caught the model attaching its own summary ("Consulting work discussion")
    // as a note the caller never spoke — the ask-first rule is load-bearing.
    // Strengthened 2026-07-18: asking is now the mandated VERY NEXT action, and
    // the tool is forbidden before an answer exists (the topic-label bug).
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(/VERY NEXT action is to ASK/);
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(/only run AFTER the caller has ANSWERED/);
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(/not your summary/);
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(/no_notes/);
    expect(MEETING_NOTES_INSTRUCTIONS).toMatch(/Do not re-ask their name or number/);
    // No real person's name baked into a shared rung (gotcha E).
    expect(MEETING_NOTES_INSTRUCTIONS).not.toMatch(/dale/i);
  });

  it('SAD: instructions never name a tool the rung does not hold — take_message is a silent fallback', () => {
    // The cc23340 rule: the model must not be told to call a tool it cannot see. The
    // fallback is wired as a completion, but the INSTRUCTIONS never send the model to it;
    // the attach route's own error text does that, only when the fallback is live.
    expect(MEETING_NOTES_INSTRUCTIONS).not.toMatch(/take_message/);
  });
});

describe('MeetingContextTask — template dispatch', () => {
  it('HAPPY: template "job" builds the job intake rung (capture_job_inquiry is the completion)', () => {
    const task = makeMeetingContextRung({
      template: 'job',
      messagingTools: { capture_job_inquiry: fakeTool('{}') },
      meetingBooked: true,
    });
    // not_a_job joined 2026-07-18 — the escape hatch for a misrouted call
    // (intent flapped "fix my computer" into has_job_inquiry and the caller
    // was trapped in a job interrogation with no exit).
    expect(Object.keys(task.toolCtx).sort()).toEqual(['capture_job_inquiry', 'not_a_job']);
  });

  it('HAPPY: mid-intake "just take a message" is a REAL exit — take_message completes the job rung', async () => {
    // WHO: Dale's question, 2026-07-18: "in the middle of asking for a job can
    //       someone ask just to leave a message instead?" Before this, the job
    //       rung held no message tool, so the honest answer was a refusal.
    // WHAT: with takeMessage wired, the fallback mirrors the booking and notes
    //        rungs — a real write, and a real message_id completes the rung
    //        with outcome 'message'.
    const onMessageTaken = vi.fn();
    const captureCalled = vi.fn();
    const capture = fakeTool(JSON.stringify({ job_inquiry_id: 'never' }), captureCalled);
    const takeMessage = fakeTool(JSON.stringify({ saved: true, message_id: 'msg-77' }));
    const task = makeMeetingContextRung({
      template: 'job',
      messagingTools: { capture_job_inquiry: capture },
      takeMessage,
      meetingBooked: true,
      onMessageTaken,
    });
    expect(Object.keys(task.toolCtx)).toContain('take_message');
    const tool = (task.toolCtx as Record<string, unknown>).take_message as {
      execute: (a: unknown, c: unknown) => Promise<unknown>;
    };
    await tool.execute(
      { message: 'have Dale call me about the role' },
      { ctx: {}, toolCallId: 'tc' }
    );
    expect(task.done, 'a real message_id ends the rung').toBe(true);
    expect(onMessageTaken).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-77' }));
    expect(captureCalled, 'no job row when the caller bailed to a message').not.toHaveBeenCalled();
  });

  it('HAPPY: not_a_job ESCAPES a misrouted job rung — no backend call, rung done (2026-07-18)', async () => {
    // WHO: the live caller who wanted a computer repair; intent flapped
    //       has_job_inquiry=true and the unskippable rung became a trap ("I
    //       can only assist with job inquiries… I can't take messages" → hung
    //       up). WHAT: calling not_a_job completes the rung immediately with
    //       outcome 'not_a_job'; capture_job_inquiry is never invoked, and the
    //       group can move on to the anything-else loop-back.
    const captureCalled = vi.fn();
    const capture = fakeTool(JSON.stringify({ job_inquiry_id: 'never' }), captureCalled);
    const task = makeMeetingContextRung({
      template: 'job',
      messagingTools: { capture_job_inquiry: capture },
      meetingBooked: true,
    });
    expect(task.done).toBe(false);
    const tool = (task.toolCtx as Record<string, unknown>).not_a_job as {
      execute: (a: unknown, c: unknown) => Promise<unknown>;
    };
    await tool.execute({}, { ctx: {}, toolCallId: 'tc' });
    expect(task.done, 'not_a_job completes the rung').toBe(true);
    expect(captureCalled, 'the escape must not touch the backend').not.toHaveBeenCalled();
  });

  it('SAD: the escape is taught FIRST — it outranks the interview', () => {
    expect(JOB_INTAKE_INSTRUCTIONS.indexOf('CALL not_a_job')).toBeGreaterThan(-1);
    expect(JOB_INTAKE_INSTRUCTIONS.indexOf('CALL not_a_job')).toBeLessThan(
      JOB_INTAKE_INSTRUCTIONS.indexOf('caller_company')
    );
    expect(JOB_INTAKE_INSTRUCTIONS).toMatch(/outranks everything below/i);
  });

  it('HAPPY: template "default" builds the notes rung (attach + no_notes, plus the fallback)', () => {
    const task = makeMeetingContextRung({
      template: 'default',
      messagingTools: {},
      notesTool: fakeTool('{}'),
      takeMessage: fakeTool('{}'),
      meetingBooked: true,
    });
    const names = Object.keys(task.toolCtx).sort();
    expect(names).toEqual(['attach_meeting_notes', 'no_notes', 'take_message']);
  });
});
