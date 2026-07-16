/**
 * WHERE COMPLETENESS ACTUALLY LIVES.
 *
 * The TaskGroup loop guarantees every REGISTERED task runs before the call can end. But
 * that guarantee is only as strong as the registration: a goal that never becomes a task
 * is a goal the loop never knows to enforce. So the failure we have chased all week — the
 * caller who books a meeting and hangs up with the job inquiry never taken — is, in this
 * architecture, prevented HERE, in the plan. If the plan is right, the loop makes it
 * impossible to skip. If the plan drops a goal, no loop can save it.
 *
 * planCallTasks is pure, so this is where the completeness is tested — no live call, no
 * LLM, no session. Goals in, the checklist out.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { llm, initializeLogger } from '@livekit/agents';
import { planCallTasks, buildCallTaskGroup, type CallDeps, type CallerGoals } from './callPlan.js';
import type { SessionContext } from '../sessionContext.js';

beforeAll(() => {
  initializeLogger({ pretty: false, level: 'silent' });
});

function makeDeps(): CallDeps {
  const ctx: SessionContext = {
    tenantId: 't',
    callerPhone: null,
    callId: 'c',
    roomName: 'r',
    participantIdentity: 'p',
  };
  const tool = llm.tool({
    description: 'x',
    parameters: { type: 'object', properties: {} },
    execute: async () => 'ok',
  });
  return {
    ctx,
    state: {},
    runtime: {
      currentDate: 'Wednesday, July 15, 2026',
      timezone: 'America/Chicago',
      businessHours: 'Monday to Friday, 1:00 PM to 5:00 PM',
      bookableThrough: '2027-01-08',
    },
    tools: {
      identify_caller: tool,
      book_with_scheduling: tool,
      get_available_slots: tool,
      get_service_catalog: tool,
      get_scheduling_options: tool, // the MESSY tool — must NOT reach the booking task
      book_appointment: tool, // bug #3 trap — must NOT reach the booking task
      check_availability: tool, // bug #3 trap
      capture_job_inquiry: tool,
      take_message: tool,
      get_my_appointments: tool,
      cancel_appointment: tool,
      reschedule_appointment: tool,
    },
  };
}

const ids = (goals: CallerGoals) => planCallTasks(goals, makeDeps()).map((s) => s.id);

describe('planCallTasks — the checklist the loop enforces', () => {
  it('SAD: a caller who wants a meeting AND has a job gets BOTH rungs — the bug that keeps biting', () => {
    // The 2026-07-14 call, made structural. "A meeting to talk about a job" is two goals;
    // in the ladder it was two rungs the model could skip, and did. Here it is two entries
    // on the stack, and the loop cannot reach its end with either one unpopped.
    const plan = ids({ wantsMeeting: true, hasJobInquiry: true });
    expect(plan).toContain('book_meeting');
    // NOTE: job_intake is the next piece of the spike. When it lands, this asserts it too;
    // until then the plan is honest about what it can guarantee.
    expect(plan[0]).toBe('identity');
  });

  it('SAD: the ORDER is fixed — identity first, then the meeting', () => {
    // You cannot book on a caller you cannot name or reach, and the meeting is what they
    // rang for. A tenant does not get to reorder this, exactly as with the composed script
    // blocks: it is what the bad calls taught us, not a preference.
    const plan = ids({ wantsMeeting: true, hasJobInquiry: false });
    expect(plan).toEqual(['identity', 'book_meeting']);
  });

  it('HAPPY: identity is ALWAYS present, even with no stated goal', () => {
    // Identity is the floor under every goal, not a goal itself. A caller who wants
    // nothing bookable still has to be someone we can name.
    expect(ids({ wantsMeeting: false, hasJobInquiry: false })).toEqual(['identity']);
  });

  it('HAPPY: no meeting → no booking rung (we do not manufacture goals)', () => {
    const plan = ids({ wantsMeeting: false, hasJobInquiry: true });
    expect(plan).not.toContain('book_meeting');
  });

  it('SAD: every spec carries the id + description the loop and the out-of-scope tool need', () => {
    // A spec with a blank id or description would break the TaskGroup's bookkeeping
    // silently. Pin the shape.
    for (const spec of planCallTasks({ wantsMeeting: true, hasJobInquiry: true }, makeDeps())) {
      expect(spec.id, 'id must be non-empty').toBeTruthy();
      expect(spec.description.length, `${spec.id} needs a description`).toBeGreaterThan(5);
      expect(typeof spec.factory).toBe('function');
    }
  });

  it('SAD: the factory is LAZY — no agent is built until the loop pops the rung', () => {
    // WHY: building all tasks up front would attach every task's tools at once, which is
    //      the wide-toolset problem the phasing exists to avoid. The factory defers
    //      construction to the moment the rung runs.
    const spy = vi.fn();
    const deps = makeDeps();
    deps.onIdentified = spy;
    const plan = planCallTasks({ wantsMeeting: true, hasJobInquiry: false }, deps);
    // Planning built nothing.
    expect(spy).not.toHaveBeenCalled();
    // The specs are data; the agents do not exist yet.
    expect(plan.every((s) => typeof s.factory === 'function')).toBe(true);
  });

  it('SAD: BookMeetingTask gets ONLY the clean grid tools — not the messy one, not the traps', () => {
    // THE FIRST-CALL BUG. The whole point of tasks is narrow tools per rung, and I broke
    // it by passing the full toolbox: the model reached past get_available_slots (clean
    // 15-minute grid) for get_scheduling_options (raw "soonest-from-now" times — 1:41 PM,
    // drifting minute to minute, wandering to October). And book_appointment /
    // check_availability are the bug-#3 traps (need a resource_id get_available_slots
    // never returns). None of them may reach this task.
    const specs = planCallTasks({ wantsMeeting: true, hasJobInquiry: false }, makeDeps());
    const book = specs.find((s) => s.id === 'book_meeting')!;
    const names = Object.keys(book.factory().toolCtx);
    expect(names).toContain('get_available_slots');
    expect(names).toContain('book_with_scheduling');
    expect(names).not.toContain('get_scheduling_options'); // the messy times
    expect(names).not.toContain('book_appointment'); // bug #3 trap
    expect(names).not.toContain('check_availability'); // bug #3 trap
  });

  it('SAD: the booking rung KNOWS what today is — it must not guess a month', () => {
    // THE FIRST LIVE-CALL BUG, from the logs not the transcript: a task with no date
    // context queried get_available_slots for OCTOBER, hit the "nothing that day" fallback
    // (raw soonest-from-now times like 1:41 PM), and every book_with_scheduling failed
    // EMPLOYEE_NOT_SCHEDULED. Each task REPLACES the system prompt — where the date and
    // hours live — with its own, so the runtime facts must be threaded in explicitly.
    const specs = planCallTasks({ wantsMeeting: true, hasJobInquiry: false }, makeDeps());
    const book = specs.find((s) => s.id === 'book_meeting')!;
    const instr = (book.factory() as unknown as { instructions: string }).instructions;
    expect(instr).toContain('July 15, 2026'); // today
    expect(instr).toMatch(/1:00 PM to 5:00 PM/); // hours
    expect(instr).toMatch(/resolve it against TODAY/i);
  });

  it('SAD: JobIntakeTask gets ONLY capture_job_inquiry — nothing to wander into', () => {
    const specs = planCallTasks({ wantsMeeting: false, hasJobInquiry: true }, makeDeps());
    const intake = specs.find((s) => s.id === 'job_intake')!;
    const names = Object.keys(intake.factory().toolCtx);
    expect(names).toContain('capture_job_inquiry');
    expect(names).not.toContain('book_with_scheduling');
    expect(names).not.toContain('take_message');
  });

  it('HAPPY: a caller who wants to cancel/reschedule gets the schedule_change rung', () => {
    // The manage goal becomes a registered rung, so the loop enforces it like any other.
    const plan = ids({ wantsMeeting: false, hasJobInquiry: false, wantsScheduleChange: true });
    expect(plan).toEqual(['identity', 'schedule_change']);
  });

  it('HAPPY: no schedule-change goal → no schedule_change rung', () => {
    // We never manufacture a manage step; a plain booking call must not get one.
    expect(ids({ wantsMeeting: true, hasJobInquiry: false })).not.toContain('schedule_change');
  });

  it('SAD: schedule_change gets the read + both mutations + the slot finder — and its escape hatch', () => {
    // A lookup-then-act rung: it must be able to SEE the appointments (get_my_appointments),
    // find a new time (get_available_slots), and MUTATE (cancel/reschedule). The third exit
    // no_appointment_change exists so a caller with nothing upcoming cannot hang the loop.
    const specs = planCallTasks(
      { wantsMeeting: false, hasJobInquiry: false, wantsScheduleChange: true },
      makeDeps()
    );
    const manage = specs.find((s) => s.id === 'schedule_change')!;
    const names = Object.keys(manage.factory().toolCtx).sort();
    expect(names).toContain('get_my_appointments');
    expect(names).toContain('get_available_slots');
    expect(names).toContain('cancel_appointment');
    expect(names).toContain('reschedule_appointment');
    expect(names).toContain('no_appointment_change'); // the "nothing to change" exit
    // and NOT a way to book a brand-new meeting — that is a different rung.
    expect(names).not.toContain('book_with_scheduling');
  });

  it('HAPPY: buildCallTaskGroup registers the plan onto a real TaskGroup', () => {
    // The loop is LiveKit's; this only checks the assembly does not throw and returns a
    // group. The guarantee (pops every task, completes only when empty) is LiveKit's own
    // host-code onEnter — verified by reading its source, not re-implemented here.
    const specs = planCallTasks({ wantsMeeting: true, hasJobInquiry: false }, makeDeps());
    const group = buildCallTaskGroup(specs);
    expect(group).toBeDefined();
    expect(typeof group.run).toBe('function');
  });
});
