/**
 * RUNG — TAKE A MESSAGE. The universal catch-all, as a rung the model cannot fake.
 *
 * On the prompt ladder this is the flow that failed most embarrassingly and most often: a
 * caller asks to leave a message, the agent gathers it, then SAYS "I've passed that along"
 * — and never calls take_message. Nothing is saved. The owner never hears about the job,
 * the caller hangs up sure it landed. It is root cause 3 in its purest form: a sentence
 * ("I've passed that along") is free, a tool call is work, and offered both the model
 * takes the sentence (BUILDING_SCRIPT_NOTES.md, gotcha C). No amount of prompt wording
 * beat it on the ladder — we watched it narrate the save on a live call after the exact
 * instruction forbade it.
 *
 * As a rung it cannot happen: take_message IS the completion. The TaskGroup loop does not
 * end until this rung completes, and the only thing that completes it is the real write
 * returning a message_id. Saying "I'll pass that along" advances nothing — same structural
 * fix that stopped the job-intake rung being skipped.
 *
 * take_message is reused untouched (agent/src/tools.ts): it already sources the callback
 * number from the confirmed session phone (ctx.spokenPhone, set by the identity rung), so
 * this rung never re-asks for a number the caller already gave — the pivot that burned us
 * on 2026-07-13. The rung's only job is to draw out the message itself and record it.
 */
import { type llm, type voice } from '@livekit/agents';
import { makeRung, idExtractor } from './rung.js';

export interface TakeMessageResult {
  messageId: string;
  raw: unknown;
}

export interface TakeMessageTaskOptions {
  /** The messaging tools from buildTools() — must include take_message. */
  messagingTools: llm.ToolContext;
  /** The caller identity from the identity rung — the message is attributed to them and
   *  take_message reuses their confirmed number, so we never re-ask. */
  knownCaller?: string;
  /** The confirmed name, defaulted into take_message's caller_name so a model that forgets
   *  to pass it still records the message (gotcha #2 — merge known facts before the call). */
  knownName?: string;
  onMessageTaken?: (r: TakeMessageResult) => Promise<void> | void;
}

/**
 * The instructions. Positive framing throughout (gotcha G) and ACTION-FIRST (rule 9): the
 * message body may mention a job, a callback, or an appointment — those words do NOT send
 * the rung back to booking or role intake, because the caller ASKED to leave a message.
 * That confusion is exactly what broke the ladder call on 2026-07-16.
 */
export const TAKE_MESSAGE_INTRO = `The caller wants to leave a message for the owner. Open with something like: "Of course — what would you like me to pass on to the owner?"`;

export const TAKE_MESSAGE_INSTRUCTIONS = `Your one job is to take a message for the owner. You already have the caller's name and number — do NOT ask for them again; take_message reuses the confirmed number automatically.

Draw out the message itself — the actual thing they want the owner to know or do — in their own words. Ask what they would like to say, then get any detail that matters: who it is about, what they need, and how soon.

A message that mentions a job, a callback, or an appointment is STILL a message. The caller asked to leave one, so record it here — do not switch to booking a meeting or taking role details because a word inside the message sounds like one.

The instant you have the message, your VERY NEXT action is to CALL take_message — call it BEFORE you say anything back to the caller. Pass caller_name and the message content; leave callback_phone out, the number they already gave is filled in for you. CALLING the tool is the only thing that records the message and finishes this step; a spoken "I'll pass that along" or "I've saved that" records NOTHING and is true only AFTER the tool has run — so run it first, then say it.

Only after take_message returns do you confirm out loud, as ONE short natural sentence ("Got it — I'll make sure that reaches the owner."). This is a PHONE CALL: no bulleted list, no field labels, no dashes, no markdown of any kind.`;

/**
 * Rung as an ACTION rung (see rung.ts): the whole point is the take_message write, so the
 * rung ends the instant it returns a message_id. The recording IS the transition — there
 * is no "finish message" tool for the model to skip or fake, which is the exact fix for the
 * narrate-instead-of-act failure the prompt ladder kept hitting.
 */
export function makeTakeMessageRung(
  opts: TakeMessageTaskOptions
): voice.AgentTask<TakeMessageResult> {
  const { messagingTools, knownName, onMessageTaken } = opts;

  const realTakeMessage = messagingTools['take_message'];
  if (!realTakeMessage) {
    throw new Error('makeTakeMessageRung requires take_message in messagingTools');
  }

  return makeRung<TakeMessageResult>({
    instructions: [opts.knownCaller, TAKE_MESSAGE_INTRO, TAKE_MESSAGE_INSTRUCTIONS]
      .filter(Boolean)
      .join('\n\n'),
    // No passthrough tools: take_message IS the completion and the rung needs nothing else
    // to finish (gotcha #8 — a tool a rung doesn't have is a tool it cannot misfire).
    tools: {},
    completion: {
      kind: 'action',
      toolName: 'take_message',
      realTool: realTakeMessage,
      // Default the confirmed name in so a model that omits caller_name still records the
      // message; the phone is filled in by take_message itself from the session.
      argDefaults: knownName ? (args) => ({ caller_name: knownName, ...args }) : undefined,
      extract: idExtractor('message_id', (id, raw) => ({ messageId: id, raw })),
      onDone: onMessageTaken,
    },
  });
}
