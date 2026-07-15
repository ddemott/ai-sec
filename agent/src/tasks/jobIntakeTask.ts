/**
 * RUNG 3 — THE JOB INTAKE. THE RUNG THAT KEEPS GETTING SKIPPED.
 *
 * This is the whole reason the spike exists. In the prompt-based ladder this rung was a
 * paragraph, and the model skipped it — booked the meeting and hung up without ever
 * asking what the job was, twice, on real calls. As a task it CANNOT be skipped: the
 * TaskGroup loop registered it, the loop is host code, and the loop does not reach its
 * end until this task's complete() fires.
 *
 * Same shape as BookMeetingTask: the RECORDING is the transition. There is no "finish
 * intake" tool for the model to skip or fake. capture_job_inquiry is reused untouched —
 * two-companies logic, the refuse-without-name-or-number gate, the real email to the
 * owner — and wrapped only to notice success: when it returns a job_inquiry_id, the task
 * completes.
 *
 * The refuse gate matters here and works WITH the loop, not against it: if the caller has
 * not given a name and number, capture_job_inquiry refuses, this task stays open, and the
 * model is told to go get what is missing. Since identity always runs FIRST (see
 * callPlan), that should already be in hand — but the belt-and-braces is real: a lead the
 * owner cannot answer never gets recorded as "done".
 */
import { llm, voice } from '@livekit/agents';
import { sanitizeStream } from '../speechSanitizer.js';

export interface JobIntakeResult {
  jobInquiryId: string;
  raw: unknown;
}

export interface JobIntakeTaskOptions {
  /** The messaging tools from buildTools() — must include capture_job_inquiry. */
  messagingTools: llm.ToolContext;
  /** The caller identity from the identity rung — capture_job_inquiry refuses without a
   *  name and number, and both were already collected. */
  knownCaller?: string;
  onCaptured?: (r: JobIntakeResult) => Promise<void> | void;
}

/**
 * The intake questions. These MIRROR the intake_job_inquiry script block
 * (src/services/scripts/blocks.ts) — the block is the source of truth for the prompt
 * ladder, and this string is its task-shaped twin. If the spike wins, one of them
 * becomes generated from the other; for now they are kept deliberately identical so the
 * two paths ask the same questions in the same order.
 */
export const JOB_INTAKE_INSTRUCTIONS = `You have booked the meeting. NOW take the details of the role, so the owner can come to it prepared. You already have the caller's name and number — do NOT ask again.

Say: "Great — you're booked in. While I have you, let me grab a few details about the role."

Then work these questions ONE AT A TIME. Skip any they have already answered. Acknowledge each answer before the next.

THERE ARE TWO COMPANIES AND THEY ARE NOT THE SAME. Never ask a bare "what company?".
- "What company are you calling from?" → that is the CALLER'S company (caller_company), the agency that rang.
- "Are you hiring for your own company, or placing someone with a client?"
  - Placing with a client → "Which company would the work actually be for?" → client_company. represents_company = false.
  - Their own company → the two are the same; do NOT ask again. represents_company = true.
- "Is this a contract position or full time?"
  - Contract → "What rate range?" and "What length of contract?"
  - Full time → "What salary range?"
- "Is this onsite, remote, or hybrid?"
  - Onsite/hybrid → "What is the address of the position?"
  - Remote → "What timezone, so they know the office hours?"

When you have the answers, call capture_job_inquiry. Pass employment_type as "contract" or "full_time"; location_type as "onsite", "remote", or "hybrid". Omit anything you did not get. Recording it is what finishes this step — merely saying "I've noted that" does nothing. If capture_job_inquiry refuses because a name or number is missing, ask for it and call it again.

DO NOT read back a bulleted list or a field-by-field summary — this is a PHONE CALL, and a list of "Caller Company: X, Client Company: Y" reads aloud as one flat run-on with no pauses. If you confirm anything, say it as ONE short natural sentence ("So that's a six-month hybrid contract with Northern Trust, sixty-five to eighty-two an hour — got it, I'll pass that to the owner."). No dashes, no bullet points, no field labels, no markdown of any kind.`;

export class JobIntakeTask extends voice.AgentTask<JobIntakeResult> {
  constructor(opts: JobIntakeTaskOptions) {
    const { messagingTools, onCaptured } = opts;

    const realCapture = messagingTools['capture_job_inquiry'];
    if (!realCapture) {
      throw new Error('JobIntakeTask requires capture_job_inquiry in messagingTools');
    }

    const wrappedCapture = llm.tool({
      description: (realCapture as unknown as { description: string }).description,
      parameters: (realCapture as unknown as { parameters: Record<string, unknown> }).parameters,
      execute: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const raw = await (
          realCapture as unknown as { execute: (a: unknown, c: unknown) => Promise<unknown> }
        ).execute(args, ctx);

        const jobInquiryId = extractInquiryId(raw);
        if (jobInquiryId) {
          const result: JobIntakeResult = { jobInquiryId, raw };
          await onCaptured?.(result);
          this.complete(result); // ← the recording IS the transition
        }
        // Hand the tool's own words back — its refusal reason on a miss, its confirmation
        // + email instruction on success — so the model can relay it.
        return raw;
      },
    });

    super({
      instructions: opts.knownCaller
        ? `${opts.knownCaller}\n\n${JOB_INTAKE_INSTRUCTIONS}`
        : JOB_INTAKE_INSTRUCTIONS,
      tools: {
        ...messagingTools,
        capture_job_inquiry: wrappedCapture,
      },
    });
  }

  // Speak when this rung takes over — see IdentityTask.onEnter. A task with no onEnter
  // becomes the active agent and stays silent, and the call hangs.
  override async onEnter(): Promise<void> {
    this.session.generateReply();
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

/**
 * A job_inquiry_id in the returned JSON means the inquiry was RECORDED (and emailed to
 * the owner). A refusal (missing name/number) has no id, so the task stays open — the
 * safe direction, exactly as with the booking: a missed success retries; a false success
 * would tell the owner a lead exists that does not.
 */
function extractInquiryId(toolResult: unknown): string | null {
  if (typeof toolResult !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolResult);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const id = (parsed as { job_inquiry_id?: unknown }).job_inquiry_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
