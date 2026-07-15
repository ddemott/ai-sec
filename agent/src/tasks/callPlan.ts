/**
 * THE PLAN: which of the caller's goals become which tasks, in what order.
 *
 * This is the piece the research flagged as the real design work — "build the group AFTER
 * an intent step returns the caller's goals, so a second goal is a second task." The
 * TaskGroup loop then guarantees every registered task runs before the call can end. But
 * that guarantee is only as good as the REGISTRATION: a goal that never becomes a task is
 * a goal the loop never knows to enforce. So the completeness of the whole system lives
 * HERE, and it must be testable on its own, without a live call.
 *
 * So `planCallTasks` is pure: goals in, an ordered list of task specs out. It builds no
 * agents and touches no session. `buildCallTaskGroup` turns that plan into a real
 * TaskGroup. The split is deliberate — the plan is the checklist, and a checklist you can
 * read is a checklist you can trust.
 *
 * ORDER IS NOT NEGOTIABLE. Identity first (you cannot book or brief without a name and
 * number). Then the meeting — it is what they RANG FOR, and everything else is
 * preparation for it. Then the intake. A tenant chooses their INTAKE questions; they do
 * not get to choose this order, exactly as with the composed script blocks, and for the
 * same reason: it is what the bad calls taught us, not a preference.
 */
import { llm, voice, beta } from '@livekit/agents';
import type { SessionContext } from '../sessionContext.js';
import { IdentityTask, type IdentityResult } from './identityTask.js';
import { BookMeetingTask, type BookMeetingResult } from './bookMeetingTask.js';

/**
 * What the caller wants ACCOMPLISHED by the time they hang up — the output of the intent
 * step, not the words they opened with. Booleans, because a goal is present or it is not,
 * and the loop needs a yes/no per task.
 */
export interface CallerGoals {
  /** They want an appointment — a meeting, call, viewing, demo. */
  wantsMeeting: boolean;
  /** They mentioned a role, contract, project, or hiring — details to brief the owner. */
  hasJobInquiry: boolean;
  /** In their own words, for the service matcher. */
  requestedService?: string;
}

/** Everything a task needs, gathered once and threaded through the plan. */
export interface CallDeps {
  ctx: SessionContext;
  /** The full ToolContext from buildTools() — tasks take the slices they need. */
  tools: llm.ToolContext;
  onIdentified?: (r: IdentityResult) => Promise<void> | void;
  onBooked?: (r: BookMeetingResult) => Promise<void> | void;
}

/**
 * One entry on the stack. `factory` is lazy (TaskGroup calls it when the rung is popped);
 * `id` and `description` are what the loop and the out-of-scope tool use. Kept as data so
 * a test can read the WHOLE plan without constructing a single agent.
 */
export interface TaskSpec {
  id: string;
  description: string;
  factory: () => voice.AgentTask;
}

/**
 * Turn the caller's goals into the ordered list of rungs the call must complete.
 *
 * Pure. This is the checklist, and the loop's guarantee is exactly as strong as this
 * list is complete: every goal here becomes a task the caller cannot leave without.
 */
export function planCallTasks(goals: CallerGoals, deps: CallDeps): TaskSpec[] {
  const specs: TaskSpec[] = [];

  // RUNG 1 — always. You cannot book a meeting or brief the owner on a caller you cannot
  // name or reach. Identity is not a goal the caller states; it is the floor under all of
  // them.
  specs.push({
    id: 'identity',
    description: "Get and confirm the caller's name and phone number.",
    factory: () =>
      new IdentityTask({
        ctx: deps.ctx,
        identifyCaller: deps.tools['identify_caller'],
        onIdentified: deps.onIdentified,
      }),
  });

  // RUNG 2 — the meeting, if they want one. FIRST among their actual goals, because it is
  // what they rang for; the details are preparation for it.
  if (goals.wantsMeeting) {
    specs.push({
      id: 'book_meeting',
      description: 'Book the appointment the caller asked for.',
      factory: () =>
        new BookMeetingTask({
          schedulingTools: deps.tools,
          requestedService: goals.requestedService ?? 'a meeting',
          onBooked: deps.onBooked,
        }),
    });
  }

  // RUNG 3 — the intake, if there is a role to brief. AFTER the booking, deliberately:
  // preparation comes after the thing it prepares for. (The task itself is the next piece
  // of the spike; registered here so the PLAN is complete and testable now.)
  // if (goals.hasJobInquiry) specs.push({ id: 'job_intake', ... });

  return specs;
}

/**
 * Assemble a real TaskGroup from a plan.
 *
 * Thin on purpose: the interesting decisions are all in planCallTasks (which is tested on
 * its own); this just registers them in order. The TaskGroup's own onEnter loop then does
 * the guaranteeing — it pops every registered task and only completes when the stack is
 * empty, in host code the model cannot reach.
 */
export function buildCallTaskGroup(specs: TaskSpec[]): beta.TaskGroup {
  const group = new beta.TaskGroup();
  for (const spec of specs) {
    group.add(spec.factory, { id: spec.id, description: spec.description });
  }
  return group;
}
