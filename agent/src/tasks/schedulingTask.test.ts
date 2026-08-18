/**
 * The scheduling rung proves two things the earlier rungs did not have to: a rung can have
 * MORE THAN ONE way to finish, and a lookup-then-act rung still ends only on a real write.
 *
 * A manage call has three honest endings — cancel, reschedule, or "nothing to change" — and
 * each is a completion tool. The mutation IS the transition (same guarantee as booking): the
 * rung ends the instant cancel_appointment or reschedule_appointment returns an
 * appointment_id, and there is no exit the model can reach by TALKING. The one synthetic exit
 * (no_appointment_change) is there so a caller with nothing upcoming cannot hang the loop.
 *
 * These call the wrapped tools directly, the way the model would — no LLM, no backend.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { llm, initializeLogger } from '@livekit/agents';
import { makeSchedulingRung, SCHEDULING_INSTRUCTIONS } from './schedulingTask.js';
import { getTaskTool, getTaskToolNames } from './testToolCtx.js';
import type { ToolMap } from '../tools.js';

beforeAll(() => {
  initializeLogger({ pretty: false, level: 'silent' });
});

/** A stand-in tool whose return value the test controls. */
function fakeTool(returns: unknown) {
  return llm.tool({
    description: 'x',
    parameters: { type: 'object', properties: {} },
    execute: async () => returns,
  });
}

function manageTools(overrides: Partial<Record<string, ToolMap[string]>> = {}): ToolMap {
  return {
    get_my_appointments: fakeTool(JSON.stringify({ appointments: [] })),
    cancel_appointment: fakeTool(JSON.stringify({ cancelled: true, appointment_id: 'appt-1' })),
    reschedule_appointment: fakeTool(
      JSON.stringify({ rescheduled: true, appointment_id: 'appt-1' })
    ),
    get_available_slots: fakeTool(JSON.stringify({ open_times: ['1:00 PM'] })),
    ...overrides,
  };
}

async function callTool(
  task: ReturnType<typeof makeSchedulingRung>,
  name: string,
  args: unknown = {}
): Promise<unknown> {
  const tool = getTaskTool(task, name);
  expect(tool, `the rung must expose ${name}`).toBeDefined();
  return tool!.execute(args, { ctx: {}, toolCallId: 'tc' });
}

describe('SchedulingTask — the mutation IS the transition, and it has three endings', () => {
  it('HAPPY: a successful cancel ends the rung with action=canceled', async () => {
    const onChanged = vi.fn();
    const task = makeSchedulingRung({ manageTools: manageTools(), onChanged });
    expect(task.done).toBe(false);
    await callTool(task, 'cancel_appointment', { appointment_id: 'appt-1' });
    expect(task.done, 'a real appointment_id ends the rung').toBe(true);
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'canceled', appointmentId: 'appt-1' })
    );
  });

  it('HAPPY: a successful reschedule ends the rung with action=rescheduled', async () => {
    const onChanged = vi.fn();
    const task = makeSchedulingRung({ manageTools: manageTools(), onChanged });
    await callTool(task, 'reschedule_appointment', { appointment_id: 'appt-1' });
    expect(task.done).toBe(true);
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rescheduled', appointmentId: 'appt-1' })
    );
  });

  it('HAPPY: no_appointment_change ends the rung with action=none', async () => {
    // The escape hatch: a caller with nothing upcoming, or who decides not to change
    // anything, must be able to leave the rung without a mutation — or the loop hangs.
    const task = makeSchedulingRung({ manageTools: manageTools() });
    await callTool(task, 'no_appointment_change', {});
    expect(task.done, 'the "nothing to change" exit completes the rung').toBe(true);
  });

  it('SAD: a REFUSED cancel (no appointment_id in the result) does NOT end the rung', async () => {
    // The safe direction: if the backend could not find/cancel it, the rung stays open and
    // the model tries again, rather than reporting a cancellation that never happened.
    const task = makeSchedulingRung({
      manageTools: manageTools({
        cancel_appointment: fakeTool(JSON.stringify({ error: 'not found under your number' })),
      }),
    });
    await callTool(task, 'cancel_appointment', { appointment_id: 'nope' });
    expect(task.done, 'no id back = not canceled = rung stays open').toBe(false);
  });

  it('SAD: reading get_my_appointments does NOT end the rung — only a mutation does', async () => {
    // The lookup is a passthrough, not a completion. Looking is not acting.
    const task = makeSchedulingRung({ manageTools: manageTools() });
    await callTool(task, 'get_my_appointments', {});
    expect(task.done, 'a read must never complete a manage rung').toBe(false);
  });

  it('SAD: the rung gets the read + slot finder + both mutations + the escape hatch, nothing else', () => {
    const task = makeSchedulingRung({ manageTools: manageTools() });
    expect(getTaskToolNames(task)).toEqual([
      'cancel_appointment',
      'get_available_slots',
      'get_my_appointments',
      'no_appointment_change',
      'reschedule_appointment',
    ]);
  });

  it('SAD: it refuses to build without the tools it depends on', () => {
    // A manage rung with no cancel/reschedule tool is a rung that can never complete — fail
    // loudly at construction, not silently at 2am on a live call.
    expect(() =>
      makeSchedulingRung({ manageTools: { get_my_appointments: fakeTool('{}') } })
    ).toThrow(/requires/i);
  });

  it('SAD: the instructions are ACTION-FIRST — call the tool, THEN say it is done', () => {
    // The hardening-pass rule (BUILDING_SCRIPT_NOTES rule 9): reordering beats prohibition.
    expect(SCHEDULING_INSTRUCTIONS).toMatch(/VERY NEXT action is to CALL/);
    expect(SCHEDULING_INSTRUCTIONS).toMatch(/get_my_appointments/);
    // and it must never end a real request with the escape hatch.
    expect(SCHEDULING_INSTRUCTIONS).toMatch(/no_appointment_change/);
  });
});
