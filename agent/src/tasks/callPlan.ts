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
import { type llm, type voice, beta } from '@livekit/agents';
import type { SessionContext } from '../sessionContext.js';
import { makeIdentityRung, type IdentityResult } from './identityTask.js';
import { makeBookMeetingRung, type BookMeetingResult } from './bookMeetingTask.js';
import { makeJobIntakeRung, type JobIntakeResult } from './jobIntakeTask.js';
import { makeTakeMessageRung, type TakeMessageResult } from './takeMessageTask.js';
import { makeSchedulingRung, type ScheduleChangeResult } from './schedulingTask.js';

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
  /** They want to CHANGE an existing appointment — cancel it or move it. Optional (absent =
   *  false) so the three original goals keep their existing call sites; the intent router
   *  always supplies it explicitly. */
  wantsScheduleChange?: boolean;
  /** They want to leave a message for the owner — a question, a callback request, anything a
   *  booking or a role does not cover. The universal catch-all. Optional for the same
   *  call-site-compatibility reason as wantsScheduleChange. */
  wantsToLeaveMessage?: boolean;
  /** In their own words, for the service matcher. */
  requestedService?: string;
}

/** Everything a task needs, gathered once and threaded through the plan. */
/**
 * The runtime facts a task cannot guess and must not: what day it is, when the business
 * is open, the timezone. buildSystemPrompt injects these into the prompt on the current
 * agent — but each task REPLACES that prompt with its own, so without threading these
 * through, the model books blind. On the first live call it guessed October dates and
 * every booking failed EMPLOYEE_NOT_SCHEDULED. A task that does not know what today is
 * cannot book tomorrow.
 */
export interface CallRuntime {
  /** e.g. "Wednesday, July 15, 2026" — same format buildSystemPrompt uses. */
  currentDate: string;
  timezone: string;
  /** e.g. "Monday to Friday, 1:00 PM to 5:00 PM", or null if nobody is scheduled. */
  businessHours: string | null;
  /** Last date anyone is scheduled, so the model does not offer beyond it. */
  bookableThrough: string | null;
}

/** What later rungs are told about the caller identity already collected. */
export function knownCallerLine(state: CallState): string {
  if (state.callerName && state.callerPhone) {
    return `The caller is ${state.callerName}, phone ${state.callerPhone}. You ALREADY have these — use them (pass the phone to any tool that needs one) and do NOT ask for them again.`;
  }
  return '';
}

/** The preamble every task prepends, so no rung is blind to the date or the hours. */
export function runtimePreamble(rt: CallRuntime): string {
  const hours = rt.businessHours
    ? `We are open ${rt.businessHours}.${rt.bookableThrough ? ` You can book through ${rt.bookableThrough}.` : ''}`
    : `No one is currently scheduled, so do not claim to be open.`;
  return `Today is ${rt.currentDate} (${rt.timezone}). ${hours} When the caller names a day like "tomorrow" or "Friday", resolve it against TODAY'S date above — never guess a month or year.`;
}

/**
 * STATE THAT FLOWS BETWEEN RUNGS. Each task is a separate agent with its own prompt, so
 * what the identity rung learns (the caller's name and confirmed number) is invisible to
 * the booking rung unless it is carried HERE. The first real E2E caught exactly this: the
 * caller gave and confirmed a number, then the booking tool asked for it again because the
 * booking task had no idea it existed. A shared, mutable object is the carrier — identity
 * writes it, later rungs read it (their factories run AFTER identity completes, so the
 * value is there).
 */
export interface CallState {
  callerName?: string;
  callerPhone?: string;
}

export interface CallDeps {
  ctx: SessionContext;
  runtime: CallRuntime;
  /** Written by the identity rung, read by every later rung. */
  state: CallState;
  /** The full ToolContext from buildTools() — tasks take the slices they need. */
  tools: llm.ToolContext;
  onIdentified?: (r: IdentityResult) => Promise<void> | void;
  onBooked?: (r: BookMeetingResult) => Promise<void> | void;
  onCaptured?: (r: JobIntakeResult) => Promise<void> | void;
  onMessageTaken?: (r: TakeMessageResult) => Promise<void> | void;
  onScheduleChanged?: (r: ScheduleChangeResult) => Promise<void> | void;
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
/**
 * Pick a NAMED SUBSET of tools. This is the point of the whole architecture — a task sees
 * only the tools its rung needs — and it is the fix for the first real call: I handed
 * BookMeetingTask the ENTIRE toolbox (deps.tools), so the model reached past
 * get_available_slots (clean 15-minute grid) for get_scheduling_options (raw
 * "soonest-from-now" times like 1:41 PM that drift minute by minute and wander to
 * October). A tool the task does not have is a tool the model cannot misfire.
 */
function pick(tools: llm.ToolContext, names: string[]): llm.ToolContext {
  const out: llm.ToolContext = {};
  for (const n of names) if (tools[n]) out[n] = tools[n];
  return out;
}

export function planCallTasks(goals: CallerGoals, deps: CallDeps): TaskSpec[] {
  const specs: TaskSpec[] = [];

  // CallRootAgent is told to send requested_service = "" when the ask is unclear, and `??`
  // would let that empty string through as the service intent (degrading the semantic match
  // and the "already asked" opener). Treat blank as ABSENT here, once, so every rung sees a
  // real value or nothing.
  const requestedService = goals.requestedService?.trim() || undefined;

  // RUNG 1 — always. You cannot book a meeting or brief the owner on a caller you cannot
  // name or reach. Identity is not a goal the caller states; it is the floor under all of
  // them.
  specs.push({
    id: 'identity',
    description: "Get and confirm the caller's name and phone number.",
    factory: () =>
      makeIdentityRung({
        ctx: deps.ctx,
        identifyCaller: deps.tools['identify_caller'],
        requestedService,
        onIdentified: async (r) => {
          // Carry the confirmed identity forward to every later rung.
          deps.state.callerName = r.name;
          deps.state.callerPhone = r.phone;
          await deps.onIdentified?.(r);
        },
      }),
  });

  // RUNG 2 — the meeting, if they want one. FIRST among their actual goals, because it is
  // what they rang for; the details are preparation for it.
  if (goals.wantsMeeting) {
    specs.push({
      id: 'book_meeting',
      description: 'Book the appointment the caller asked for.',
      factory: () =>
        makeBookMeetingRung({
          schedulingTools: pick(deps.tools, [
            'get_available_slots',
            'get_service_catalog',
            'book_with_scheduling',
          ]),
          requestedService: requestedService ?? 'a meeting',
          runtimePreamble: [runtimePreamble(deps.runtime), knownCallerLine(deps.state)]
            .filter(Boolean)
            .join(' '),
          knownPhone: deps.state.callerPhone,
          knownName: deps.state.callerName,
          // Fallback so a booking that cannot happen becomes a RECORDED message, never a
          // promise with no tool behind it (the 2026-07-16 dead-end).
          takeMessage: deps.tools['take_message'],
          onBooked: deps.onBooked,
          onMessageTaken: deps.onMessageTaken,
        }),
    });
  }

  // RUNG 3 — the intake, if there is a role to brief. AFTER the booking, deliberately:
  // preparation comes after the thing it prepares for. THIS is the rung the prompt ladder
  // kept skipping; as a registered task the loop will not end without it.
  if (goals.hasJobInquiry) {
    specs.push({
      id: 'job_intake',
      description: 'Collect the role details and record them for the owner.',
      factory: () =>
        makeJobIntakeRung({
          messagingTools: pick(deps.tools, ['capture_job_inquiry']),
          knownCaller: knownCallerLine(deps.state),
          meetingBooked: goals.wantsMeeting,
          onCaptured: deps.onCaptured,
        }),
    });
  }

  // RUNG 4 — take a message, if they want one. The universal catch-all: a need that a
  // booking or a role does not cover still gets handled, by recording a message. Placed
  // AFTER book + intake, mirroring the composed-script order (take_message is the ELSE rung
  // after the vertical intake). As a registered task the loop will not end without the
  // take_message write — the exact fix for the ladder narrating the save without doing it.
  if (goals.wantsToLeaveMessage) {
    specs.push({
      id: 'take_message',
      description: 'Record a message from the caller for the owner.',
      factory: () =>
        makeTakeMessageRung({
          messagingTools: pick(deps.tools, ['take_message']),
          knownCaller: knownCallerLine(deps.state),
          knownName: deps.state.callerName,
          onMessageTaken: deps.onMessageTaken,
        }),
    });
  }

  // RUNG 5 — change an EXISTING appointment, if they came to cancel or reschedule. It reads
  // (get_my_appointments) then mutates; a manage call has three honest endings, so the rung
  // carries three completions (see schedulingTask). Placed last: it concerns an appointment
  // that already exists, independent of anything booked or briefed on this call.
  if (goals.wantsScheduleChange) {
    specs.push({
      id: 'schedule_change',
      description: 'Cancel or reschedule an existing appointment for the caller.',
      factory: () =>
        makeSchedulingRung({
          manageTools: pick(deps.tools, [
            'get_my_appointments',
            'cancel_appointment',
            'reschedule_appointment',
            'get_available_slots',
          ]),
          knownCaller: knownCallerLine(deps.state),
          runtimePreamble: runtimePreamble(deps.runtime),
          onChanged: deps.onScheduleChanged,
        }),
    });
  }

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
