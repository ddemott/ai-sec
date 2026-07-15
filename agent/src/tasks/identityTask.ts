/**
 * RUNG 1, AS CODE INSTEAD OF AS A PARAGRAPH.
 *
 * This is the first piece of the spike. The question it is here to answer is narrow:
 * can a rung of our ladder be an `AgentTask`, driven by a host-code loop, using the
 * tools we already have?
 *
 * WHY WE ARE DOING THIS AT ALL. Today the ladder lives in `tenants.system_prompt` as a
 * STRING. The model reads it and, demonstrably, sometimes just does not do a rung. On
 * 2026-07-14 a caller said "a call with the owner to talk about a job", got booked in
 * perfectly, and hung up without ever being asked a single thing about the job. There
 * is no code anywhere that says "rung 3 must happen" — only a paragraph asking nicely.
 *
 * LiveKit ships the fix, in the version already in our node_modules. `TaskGroup.onEnter`
 * is a `while (taskStack.length > 0)` loop in HOST CODE, and `complete()` sits AFTER the
 * loop. The model has no tool that exits the group early. It cannot narrate its way past
 * a rung, and it cannot hang up with a goal undone, because the exit is unreachable
 * until the stack is empty.
 *
 * THE SHAPE OF A TASK, and it is the whole trick:
 *
 *   - An AgentTask IS an Agent. It has its OWN instructions and its OWN tools.
 *   - It talks to the caller until something calls `this.complete(result)`.
 *   - `complete()` is called from inside a TOOL. So THE ONLY WAY OUT IS THE WORK.
 *
 * That last line is the point. "Let me check…" advances nothing. "Thank you, have a
 * great day" advances nothing. The transition IS the tool call — which is the same idea
 * Pipecat Flows arrived at (routing hangs off the function, `next_node_id`), and it
 * kills the failure we have been fighting all week: the model satisfying an instruction
 * with a SENTENCE where we wanted an ACTION.
 *
 * NOTE ON REUSE: this deliberately does NOT invent new tools. `identify_caller` already
 * exists and already works — the task just receives it, plus one small completion tool.
 * The whole spike is about moving the LADDER down a layer, not rebuilding the rungs.
 */
import { llm, voice } from '@livekit/agents';
import { sanitizeStream } from '../speechSanitizer.js';
import type { SessionContext } from '../sessionContext.js';

export interface IdentityResult {
  name: string;
  /** E.164. Confirmed by the caller, or taken from caller ID. */
  phone: string;
  /** True when the caller read it back and agreed — false when it came from caller ID. */
  confirmedAloud: boolean;
}

export interface IdentityTaskOptions {
  ctx: SessionContext;
  /** The real identify_caller tool from buildTools() — not a new one. */
  identifyCaller: llm.ToolContext[string];
  /** What the caller ALREADY said they want (from the intent step). Injected so identity
   *  does not re-ask "how can I help?" after confirming — it knows, and the next rung
   *  handles it. */
  requestedService?: string;
  /** Called with the confirmed values, so the caller record is saved exactly as today. */
  onIdentified?: (r: IdentityResult) => Promise<void> | void;
}

/**
 * Every line of these instructions was paid for by a real call, and they are the SAME
 * lines as the `identity` script block — deliberately. If the spike wins, the block
 * becomes the source and this string goes away; if it loses, we have not forked the
 * wording in the meantime.
 */
export const IDENTITY_INSTRUCTIONS = `Your ONLY job right now is to get the caller's NAME and a PHONE NUMBER they confirm.

Do not book anything. Do not take any details about why they called — that comes next, and it is not your job. If they start telling you why they rang, that is fine and welcome: say you have got that, and get their name and number first.

- Ask for their name. Wait for the answer.
- Ask for the best number to reach them.
- READ THE NUMBER BACK and ask if it is right. Then STOP TALKING and wait. Do not act, do not "process", do not call a tool while they are still answering.
- If they say it is wrong, ask again. Never proceed on a number they did not confirm.
- If you only caught part of it, say which part you got and ask for the rest ("I only caught 555-111 — can you give me the last four?").

When you have BOTH the name and a number they have confirmed, call confirm_identity. That is the only way to finish here — and the ONLY tool you actually need. If you happen to look the caller up and that lookup reports any trouble, carry right on: you already have their name and number, so call confirm_identity with those and move the call forward. A lookup hiccup never blocks you from finishing here.

The moment you call confirm_identity, your job is DONE and the system moves the caller straight into what they rang for. So your very last words are simply a short, warm acknowledgement using their name — for example "Perfect, thanks Scott." — three or four words, and then you are finished. The next step already knows what they want and will take it from there.`;

export class IdentityTask extends voice.AgentTask<IdentityResult> {
  constructor(opts: IdentityTaskOptions) {
    const { ctx, identifyCaller, onIdentified } = opts;

    // A caller-ID number is already attested by the carrier — there is nothing to
    // read back, and asking a man to confirm a number we can already see is the
    // "never re-ask what you already have" rule broken in its most annoying form.
    const known = ctx.callerPhone;

    const askLine = opts.requestedService?.trim()
      ? `You already know why the caller rang: "${opts.requestedService.trim()}". Your only task here is their name and number; the system will act on their request the instant you confirm their identity.`
      : '';
    super({
      instructions: [
        IDENTITY_INSTRUCTIONS,
        askLine,
        known
          ? `You ALREADY have their number (${known}) from caller ID. Do NOT ask for it and do NOT read it back. You need only their NAME — then call confirm_identity with the name and that number.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),

      tools: {
        // The existing tool, untouched. The task does not reinvent the CRM write.
        identify_caller: identifyCaller,

        // THE ONLY EXIT. There is no other way to end this task — no sentence, no
        // apology, no "have a great day". The loop advances when the work is done and
        // not one turn before.
        confirm_identity: llm.tool({
          description:
            'Call this ONCE you have the caller\'s name AND a phone number they have confirmed (or that came from caller ID). This finishes the identity step. Do not call it on a number they have not agreed to.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: "The caller's name, as they gave it." },
              phone: {
                type: 'string',
                description: 'The confirmed phone number.',
              },
            },
            required: ['name', 'phone'],
          },
          execute: async (args: { name: string; phone: string }) => {
            const result: IdentityResult = {
              name: args.name.trim(),
              phone: args.phone.trim(),
              confirmedAloud: !known,
            };
            // Record on the shared session context too, so any backend tool that falls
            // back to ctx.spokenPhone (booking, take-message) has the number even if the
            // model omits it from the call. "Spoken", not callerPhone — the caller told
            // us; the carrier did not attest it. Good enough to call back, not to unlock
            // an account.
            ctx.spokenPhone = result.phone;
            await onIdentified?.(result);
            this.complete(result); // ← resolves run(); the TaskGroup loop moves on
            return 'Got it.';
          },
        }),
      },
    });
  }

  // SPEAK WHEN THIS RUNG TAKES OVER. Without an onEnter the task becomes the active agent
  // and sits SILENT — exactly how the first live call got stuck: begin_call handed off to
  // identity, and identity never asked for the name while the caller said "hello? you
  // there?". The shipped WarmTransferTask defines onEnter for the same reason.
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
