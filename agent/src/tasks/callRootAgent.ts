/**
 * THE RUNNER — where the whole architecture actually runs as one call.
 *
 * Everything else in tasks/ is a piece. This is the assembly: a root Agent that greets,
 * works out what the caller wants, and then hands the call to the TaskGroup — which pops
 * every rung and cannot reach its end with a goal unmet.
 *
 * WHY A ROOT AGENT AND NOT JUST A GROUP. The research was specific: build the group AFTER
 * an intent step returns the caller's goals, because the group's task stack is snapshotted
 * when it starts. So the root agent IS the intent step. It has exactly one tool,
 * begin_call — the model calls it once it understands the ask, with booleans for each
 * goal. Inside that tool (a valid context for AgentTask.run()) we build the plan from
 * those goals and run the group. When the group returns, every rung is done, and the root
 * agent closes.
 *
 * The model's ONLY job at the top of the call is to classify: does this person want a
 * meeting? do they have a role to brief us on? That is a narrow judgement it is reliably
 * good at — reading one sentence and ticking boxes — as opposed to the thing it is bad at
 * and we have watched it fail all week: sequencing a five-step call over four minutes
 * without dropping a step. The sequencing is now the loop's job, in host code.
 *
 * Nothing here is wired into index.ts yet by default — it runs only under
 * ENABLE_TASK_GROUP, alongside the existing agent, so a real call can be made through it
 * without disturbing the one that answers the phone today.
 */
import { llm, voice } from '@livekit/agents';
import { sanitizeStream } from '../speechSanitizer.js';
import { getLogger } from '../logger.js';
import type { SessionContext } from '../sessionContext.js';
import { planCallTasks, buildCallTaskGroup, type CallDeps, type CallRuntime } from './callPlan.js';
import type { IdentityResult } from './identityTask.js';
import type { BookMeetingResult } from './bookMeetingTask.js';
import type { JobIntakeResult } from './jobIntakeTask.js';

export interface CallRootOptions {
  ctx: SessionContext;
  /** The full ToolContext from buildTools() — the rungs take the slices they need. */
  tools: llm.ToolContext;
  /** The tenant's persona line, so the greeting/identity sound like the business. */
  persona: string;
  /** Date + hours the rungs must not guess. */
  runtime: CallRuntime;
  onIdentified?: (r: IdentityResult) => Promise<void> | void;
  onBooked?: (r: BookMeetingResult) => Promise<void> | void;
  onCaptured?: (r: JobIntakeResult) => Promise<void> | void;
}

export class CallRootAgent extends voice.Agent {
  #opts: CallRootOptions;
  #started = false;

  constructor(opts: CallRootOptions) {
    super({
      instructions: `${opts.persona}

You are at the very start of a call. Your ONE job right now is to understand what the caller wants, then hand off. Greet them warmly, ask how you can help if they have not already said, and listen.

As soon as you know what they are calling about, call begin_call with:
- wants_meeting: true if they want ANY kind of appointment, meeting, call, viewing or demo — even mentioned in passing.
- has_job_inquiry: true if they mentioned a job, role, contract, project, or hiring.
- requested_service: their OWN WORDS for what they want ("a meeting about a contract role", "a call with the owner"). Leave blank if unclear.

When in doubt, say YES to a goal — it is far better to ask an extra question later than to miss what they rang for. If a caller says "I'd like a meeting to talk about a job", that is BOTH: wants_meeting=true AND has_job_inquiry=true.

Do not try to book, or take details, or collect their name yet. Just understand the ask and call begin_call. Everything after that is handled for you.`,
      tools: {
        begin_call: llm.tool({
          description:
            'Call this ONCE you understand what the caller wants. It starts handling their request. Pass a boolean for each kind of goal and their own words for the service.',
          parameters: {
            type: 'object',
            properties: {
              wants_meeting: {
                type: 'boolean',
                description: 'They want an appointment/meeting/call/viewing/demo.',
              },
              has_job_inquiry: {
                type: 'boolean',
                description: 'They mentioned a job, role, contract, project, or hiring.',
              },
              requested_service: {
                type: 'string',
                description: "The caller's own words for what they want, for the service matcher.",
              },
            },
            required: ['wants_meeting', 'has_job_inquiry'],
          },
          execute: async (args: {
            wants_meeting: boolean;
            has_job_inquiry: boolean;
            requested_service?: string;
          }): Promise<string> => this.#runGroup(args),
        }),
      },
    });
    this.#opts = opts;
  }

  // No onEnter greeting on purpose: index.ts speaks the tenant's PRE-GENERATED greeting
  // (zero TTS latency, the right voice), then the caller answers, and begin_call fires on
  // that first turn. Greeting here too would double it.

  async #runGroup(goals: {
    wants_meeting: boolean;
    has_job_inquiry: boolean;
    requested_service?: string;
  }): Promise<string> {
    // begin_call can only fire once. A second classification mid-call is the
    // goal-discovery case the snapshotted stack cannot handle — logged, not acted on, so
    // the spike's known limit is visible rather than silent.
    if (this.#started) {
      getLogger().warn(
        { event: 'task_group_begin_twice' },
        'begin_call fired again mid-call — the running group cannot take a new goal (known spike limit)'
      );
      return 'Already handling this call.';
    }
    this.#started = true;

    const state = {}; // filled by the identity rung, read by the rest AND by the goodbye
    const deps: CallDeps = {
      ctx: this.#opts.ctx,
      runtime: this.#opts.runtime,
      state,
      tools: this.#opts.tools,
      onIdentified: this.#opts.onIdentified,
      onBooked: this.#opts.onBooked,
      onCaptured: this.#opts.onCaptured,
    };
    const specs = planCallTasks(
      {
        wantsMeeting: goals.wants_meeting,
        hasJobInquiry: goals.has_job_inquiry,
        requestedService: goals.requested_service,
      },
      deps
    );

    getLogger().info(
      { event: 'task_group_start', rungs: specs.map((s) => s.id) },
      `task group starting — ${specs.length} rungs: ${specs.map((s) => s.id).join(' → ')}`
    );

    const group = buildCallTaskGroup(specs);
    // THE HANDOFF. run() blocks until the loop pops every rung. It is awaited inside this
    // tool's execute — a valid AgentTask context — so the sub-tasks can take over the
    // session in turn. When it resolves, every goal the caller stated is DONE, with a
    // tool result to prove each one.
    const result = await group.run();

    getLogger().info(
      { event: 'task_group_done', completed: Object.keys(result.taskResults) },
      `task group complete — every rung done: ${Object.keys(result.taskResults).join(', ')}`
    );

    // THE CALL IS OVER. END IT — do not hand back to the free-running root agent.
    //
    // When the group returns, control would otherwise fall back to THIS agent, whose
    // instructions are the START-of-call intent step ("understand the ask, collect
    // identity"). It has no memory that the sub-agents already did all of that, so with
    // nothing left to do it reverts to its opening job and asks for the name and number
    // AGAIN — which is exactly what a real call did after everything was booked and
    // recorded ("I'll need your name and the best phone number...").
    //
    // So we speak a fixed, definitive goodbye (no LLM generation, no question that invites
    // more) and CLOSE the session. The rungs already confirmed the concrete outcomes (the
    // booked time, the recorded inquiry) as they happened, so there is nothing left to say.
    const name = (state as { callerName?: string }).callerName;
    const goodbye = name
      ? `You're all set, ${name}. Thanks for calling, and have a great day!`
      : `You're all set. Thanks for calling, and have a great day!`;
    try {
      await this.session.say(goodbye, { allowInterruptions: false }).waitForPlayout();
    } catch {
      /* if say fails, still close — a silent hangup beats a re-collection loop */
    }
    await this.session.close();
    return 'Call complete.';
  }

  // MARKDOWN MUST NEVER REACH THE VOICE — the same guarantee SpeakingAgent gives the main
  // path. The task-group path is plain voice.Agent, so without this a model that answers
  // with a bulleted summary ("- Caller Company: ABC") gets its dashes and newlines read
  // straight to Deepgram, which collapses them into one flat run with no pauses. That is
  // the "it ran the lines together" report from the first successful voice call.
  override async ttsNode(
    text: ReadableStream<string>,
    modelSettings: Parameters<typeof voice.Agent.default.ttsNode>[2]
  ): ReturnType<typeof voice.Agent.default.ttsNode> {
    return voice.Agent.default.ttsNode(this, sanitizeStream(text), modelSettings);
  }
}
