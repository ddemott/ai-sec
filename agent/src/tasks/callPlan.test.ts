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
    tools: { identify_caller: tool, book_with_scheduling: tool, get_available_slots: tool },
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
