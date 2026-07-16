/**
 * The property this rung exists to prove: THE BOOKING IS THE TRANSITION.
 *
 * A caller can talk all day; the task does not end. It ends the instant
 * book_with_scheduling returns an appointment_id, and there is no other exit — no
 * "finish booking" tool the model can call by mistake, and none it can SAY it called
 * without calling. That is the research's whole point (Pipecat: "routing lives on the
 * function"; LiveKit: complete() lives inside a tool), and it is the fix for the failure
 * we have chased all week — the model advancing the call with a sentence instead of a
 * tool.
 *
 * These tests do NOT need a real LLM or a real backend: they call the wrapped tool
 * directly, the way the model would, and check what the task does.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { llm, initializeLogger } from '@livekit/agents';
import { makeBookMeetingRung, BOOK_MEETING_INSTRUCTIONS } from './bookMeetingTask.js';

beforeAll(() => {
  initializeLogger({ pretty: false, level: 'silent' });
});

/** A stand-in book_with_scheduling whose return value the test controls. */
function fakeBookingTool(returns: unknown) {
  return llm.tool({
    description: 'book it',
    parameters: { type: 'object', properties: {} },
    execute: async () => returns,
  });
}

function schedulingTools(booking: llm.ToolContext[string]): llm.ToolContext {
  return {
    get_available_slots: llm.tool({
      description: 'slots',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'ok',
    }),
    get_service_catalog: llm.tool({
      description: 'catalog',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'ok',
    }),
    book_with_scheduling: booking,
  };
}

async function callBooking(
  task: ReturnType<typeof makeBookMeetingRung>,
  args: unknown = {}
): Promise<unknown> {
  const tool = (task.toolCtx as Record<string, unknown>).book_with_scheduling as {
    execute: (a: unknown, c: unknown) => Promise<unknown>;
  };
  return tool.execute(args, { ctx: {}, toolCallId: 'tc' });
}

describe('BookMeetingTask — the booking IS the transition', () => {
  it('HAPPY: a booking that returns an appointment_id ends the task', async () => {
    const onBooked = vi.fn();
    const booking = fakeBookingTool(
      JSON.stringify({ success: true, appointment_id: 'appt-123', booked_time: '3:30 PM' })
    );
    const task = makeBookMeetingRung({
      schedulingTools: schedulingTools(booking),
      requestedService: 'a meeting about a contract',
      onBooked,
    });

    expect(task.done).toBe(false);
    await callBooking(task);

    expect(task.done, 'a real appointment_id ends the rung').toBe(true);
    expect(onBooked).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: 'appt-123' }));
  });

  it('SAD: a FAILED booking does NOT end the task — the caller has no meeting', async () => {
    // WHY: the safe direction. A slot-taken error, a validation failure — none of those
    //      are a booking, and the task must stay open so the model tries again. Ending
    //      here would drop the caller with nothing in the diary, which is the exact bug
    //      the whole structure exists to prevent.
    const booking = fakeBookingTool(
      JSON.stringify({
        error: 'Requested time slot is already booked',
        error_code: 'TIMESLOT_OCCUPIED',
      })
    );
    const task = makeBookMeetingRung({
      schedulingTools: schedulingTools(booking),
      requestedService: 'a meeting',
    });

    const relayed = await callBooking(task);
    expect(task.done, 'a failed booking is not a booking').toBe(false);
    // ...and the tool's own error is handed back so the model can relay it and retry.
    expect(String(relayed)).toContain('TIMESLOT_OCCUPIED');
  });

  it('SAD: an UNPARSEABLE result does not falsely complete', async () => {
    // WHY: a missed success just keeps the task trying; a FALSE success ends the rung
    //      with no meeting. When in doubt, stay open.
    const booking = fakeBookingTool('the booking system is having trouble right now');
    const task = makeBookMeetingRung({
      schedulingTools: schedulingTools(booking),
      requestedService: 'a meeting',
    });
    await callBooking(task);
    expect(task.done).toBe(false);
  });

  it('SAD: there is NO separate "finish" tool for the model to skip or fake', async () => {
    // THE POINT. The only tools are the real scheduling ones. The transition is welded to
    // book_with_scheduling — the model cannot end this rung by talking, and cannot end it
    // by claiming it booked. It has to actually book.
    const booking = fakeBookingTool(JSON.stringify({ appointment_id: 'x' }));
    const task = makeBookMeetingRung({
      schedulingTools: schedulingTools(booking),
      requestedService: 'a meeting',
    });
    const toolNames = Object.keys(task.toolCtx);
    expect(toolNames).toContain('book_with_scheduling');
    expect(toolNames).not.toContain('finish');
    expect(toolNames).not.toContain('confirm_booking');
    expect(toolNames).not.toContain('done');
  });

  it('HAPPY: when a booking cannot happen, take_message RECORDS the message and ends the rung', async () => {
    // The 2026-07-16 dead-end: booking failed (no open times), the caller wanted a callback,
    // and the model said "I'll pass it along" with no tool behind it — nothing saved. The
    // take_message FALLBACK makes the save real: calling it completes the rung with a message.
    const onMessageTaken = vi.fn();
    const booking = fakeBookingTool(JSON.stringify({ error: 'NO_AVAILABILITY' }));
    const takeMessage = fakeBookingTool(JSON.stringify({ saved: true, message_id: 'msg-9' }));
    const task = makeBookMeetingRung({
      schedulingTools: schedulingTools(booking),
      requestedService: 'a meeting',
      knownName: 'Scott',
      takeMessage,
      onMessageTaken,
    });
    expect(Object.keys(task.toolCtx)).toContain('take_message');
    expect(task.done).toBe(false);
    const tool = (task.toolCtx as Record<string, unknown>).take_message as {
      execute: (a: unknown, c: unknown) => Promise<unknown>;
    };
    await tool.execute({ message: 'have him call me back' }, { ctx: {}, toolCallId: 'tc' });
    expect(task.done, 'a real message_id ends the rung').toBe(true);
    expect(onMessageTaken).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-9' }));
  });

  it('SAD: no take_message tool given → no fallback, booking is the only exit', () => {
    const booking = fakeBookingTool(JSON.stringify({ appointment_id: 'x' }));
    const task = makeBookMeetingRung({
      schedulingTools: schedulingTools(booking),
      requestedService: 'a meeting',
    });
    expect(Object.keys(task.toolCtx)).not.toContain('take_message');
  });

  it('SAD: the fallback is ACTION-FIRST — call take_message, do not just promise it', () => {
    expect(BOOK_MEETING_INSTRUCTIONS).toMatch(/CALL take_message/);
    expect(BOOK_MEETING_INSTRUCTIONS).toMatch(/saves NOTHING/i);
  });

  it('SAD: it reuses the real scheduling tools — it does not reinvent booking', async () => {
    const booking = fakeBookingTool(JSON.stringify({ appointment_id: 'x' }));
    const task = makeBookMeetingRung({
      schedulingTools: schedulingTools(booking),
      requestedService: 'a meeting',
    });
    // get_available_slots / get_service_catalog pass straight through, unwrapped.
    expect(task.toolCtx).toHaveProperty('get_available_slots');
    expect(task.toolCtx).toHaveProperty('get_service_catalog');
  });

  it('SAD: the hard-won booking rules survive the move', async () => {
    // Each cost a real call. open_times not a range; wait for a real choice; do not
    // re-ask name/number; one job only.
    expect(BOOK_MEETING_INSTRUCTIONS).toMatch(/ONLY the times it returns in open_times/i);
    expect(BOOK_MEETING_INSTRUCTIONS).toMatch(/WAIT for them to CHOOSE/i);
    expect(BOOK_MEETING_INSTRUCTIONS).toMatch(/never take the first or last option/i);
    expect(BOOK_MEETING_INSTRUCTIONS).toMatch(/do NOT ask for them again/i);
    expect(BOOK_MEETING_INSTRUCTIONS).toMatch(/ONE job/i);
  });
});
