/**
 * RUNG 2 — BOOK THE MEETING, AS CODE.
 *
 * The second piece of the spike. Rung 1 (IdentityTask) proved a rung can be a task; this
 * one proves the interesting property: THE BOOKING IS THE TRANSITION.
 *
 * The research (Pipecat Flows) put it as "routing lives on the function" — the tool call
 * IS the edge, so the model cannot advance the conversation with a sentence. LiveKit's
 * TaskGroup is the same idea from the other side: a task ends only when complete() is
 * called, and complete() is called from inside a tool.
 *
 * So this task does NOT give the model a separate "I'm done booking" tool to call — that
 * would be one more thing it can forget, or claim it did. Instead the REAL booking tool
 * is wrapped: when book_with_scheduling actually returns an appointment_id, the wrapper
 * calls this.complete(). The task is over the instant a booking exists, and not one turn
 * before, and there is no way to leave it WITHOUT a booking except the caller giving up
 * (which the group's loop handles by not registering this task at all — see the header
 * on toolPhases / the intent step).
 *
 * REUSE, not reinvention: get_available_slots, get_scheduling_options, get_service_catalog
 * and book_with_scheduling are the EXACT tools from buildTools(). They took a week of real
 * calls to get right (open_times as a list not a range, service matched by meaning, the
 * inclusive 5:00 boundary). The task receives them. It wraps only the booking tool, and
 * only to notice success.
 */
import { type llm, type voice } from '@livekit/agents';
import { makeRung, idExtractor, type RungCompletion } from './rung.js';

export interface BookMeetingResult {
  /** 'booked' when a meeting went in the diary; 'message' when the caller could not be
   *  booked (no open times, or they'd rather leave a message) and one was recorded instead. */
  outcome: 'booked' | 'message';
  /** Present when outcome is 'booked'. */
  appointmentId?: string;
  /** Present when outcome is 'message'. */
  messageId?: string;
  /** The raw JSON the completing tool returned — the spoken time/employee, or the saved-message reply. */
  bookedResult: unknown;
}

export interface BookMeetingTaskOptions {
  /**
   * The scheduling tools from buildTools(), unchanged. At minimum:
   * get_available_slots, get_scheduling_options, get_service_catalog, book_with_scheduling.
   * They are used exactly as they are on a live call.
   */
  schedulingTools: llm.ToolContext;
  /** What the caller asked for, in THEIR words — passed to the service matcher. */
  requestedService: string;
  /** Date + hours the model must not guess (see callPlan.runtimePreamble). */
  runtimePreamble?: string;
  /** The confirmed number from the identity rung — defaulted into the booking call so a
   *  model that forgets to pass it still books, instead of asking again. */
  knownPhone?: string;
  knownName?: string;
  /** The take_message tool — added as a FALLBACK completion. When a booking truly cannot
   *  happen (no open times, or the caller would rather leave a message), calling it RECORDS
   *  the message and completes the rung. Without this the model offers to "pass something
   *  along" it has no way to save (the 2026-07-16 dead-end). Omit → no fallback. */
  takeMessage?: llm.ToolContext[string];
  onBooked?: (r: BookMeetingResult) => Promise<void> | void;
  /** Called when the fallback message path completes instead of a booking. */
  onMessageTaken?: (r: { messageId: string; raw: unknown }) => Promise<void> | void;
}

export const BOOK_MEETING_INSTRUCTIONS = `Your ONE job right now is to get a meeting into the diary. Nothing else — not the details of why they are coming, not their preferences. Just the booking.

You already have their name and number. Do NOT ask for them again.

- If you do not yet know what the meeting is for, offer the services with get_service_catalog and let them choose — but if their own words already make it clear ("a meeting about a contract role", "a call with the owner"), just pass those words along; the system matches them to the right service.
- Call get_available_slots to see what is actually open. Offer ONLY the times it returns in open_times. Never state a time that is not in that list, and never refuse one that is.
- WAIT for them to CHOOSE a time. "Yeah", "okay" and "sure" are not a choice — a time is chosen only when they name one, or say something clearly tied to one ("the 4:30", "the first one"). If you did not clearly hear one of the times you offered, ASK AGAIN. Never guess, and never take the first or last option as a default.
- When they have picked, your VERY NEXT action is to CALL book_with_scheduling — call it BEFORE you say the booking is done. Only CALLING the tool books the meeting; saying "you're booked in" without calling it books NOTHING. Run it first, then confirm the ACTUAL booked time it returns, out loud.

No open times on ONE day does NOT mean the booking cannot happen — evenings, today is often already over. When a day comes back empty, say so and CHECK THE NEXT DAY (call get_available_slots again) and offer those times. Only a caller who declines them — or several days with nothing — means the booking is off.

If — and ONLY if — a booking genuinely cannot happen (several days of get_available_slots come back with no open times, or the caller says they would rather just leave a message than pick a time), take a message instead: CALL take_message with their name and what they want passed on. Calling take_message is the ONLY thing that records it — offering to "pass it along" or "have someone get back to them" WITHOUT calling take_message saves NOTHING and misleads the caller. So if you say it, call it. Do NOT drop to a message just because they are slow to choose; a message is for when a booking truly is not going to happen.

Booking the meeting — or, when it cannot happen, recording a message — is what finishes this step. There is nothing to say or do after it.`;

/**
 * Rung 2 as an ACTION rung (see rung.ts): the whole point is one real backend write,
 * book_with_scheduling, so the rung ends the instant it returns an appointment_id. The
 * booking IS the transition — the model has no "finish booking" tool to skip or to claim
 * it called. get_available_slots / get_service_catalog ride along as the passthrough
 * tools the model needs to reach that write.
 */
export function makeBookMeetingRung(
  opts: BookMeetingTaskOptions
): voice.AgentTask<BookMeetingResult> {
  const { schedulingTools, onBooked } = opts;

  const realBooking = schedulingTools['book_with_scheduling'];
  if (!realBooking) {
    throw new Error('makeBookMeetingRung requires book_with_scheduling in schedulingTools');
  }

  // What the caller ALREADY told us they want. Injected so the rung opens by acting on it —
  // going straight to get_available_slots — instead of asking "what would you like to
  // book?" when they already said. Only ask what the meeting is for if they never said.
  const alreadyAsked = opts.requestedService?.trim()
    ? `The caller has already told you what they want: "${opts.requestedService.trim()}". Open immediately by finding them a time for it — call get_available_slots right away and offer the open times.`
    : '';

  // The passthrough scheduling tools, minus the completion tool (makeRung re-adds it).
  const { book_with_scheduling: _drop, ...passthrough } = schedulingTools;
  void _drop;

  // The PRIMARY completion: a real booking. The rung ends the instant book_with_scheduling
  // returns an appointment_id.
  const completions: RungCompletion<BookMeetingResult>[] = [
    {
      kind: 'action',
      toolName: 'book_with_scheduling',
      realTool: realBooking,
      // DEFAULT the identity we already hold. book_with_scheduling REQUIRES a phone; the
      // caller gave it in the identity rung, so a model that omits it here should still
      // book, not ask again. (The first E2E failed exactly here.)
      // Trim before the `||` fallback: a whitespace-only value (" ") is truthy and would
      // block the fallback to the known identity, recreating the "blank strings block
      // fallbacks" gotcha (see tools.ts). Trimmed empty → falsy → falls back correctly.
      argDefaults: (args) => ({
        ...args,
        phone: (args.phone as string)?.trim() || opts.knownPhone,
        name: (args.name as string)?.trim() || opts.knownName,
      }),
      extract: idExtractor('appointment_id', (id, raw) => ({
        outcome: 'booked' as const,
        appointmentId: id,
        bookedResult: raw,
      })),
      onDone: onBooked,
    },
  ];

  // The FALLBACK completion: when a booking cannot happen, a message CAN be recorded — and
  // the write is what completes the rung, so the model can no longer promise to "pass it
  // along" without take_message actually running (the 2026-07-16 dead-end). Same
  // multi-completion shape the scheduling rung uses; the first to succeed wins.
  if (opts.takeMessage) {
    completions.push({
      kind: 'action',
      toolName: 'take_message',
      realTool: opts.takeMessage,
      argDefaults: opts.knownName
        ? (args) => ({ caller_name: opts.knownName, ...args })
        : undefined,
      extract: idExtractor('message_id', (id, raw) => ({
        outcome: 'message' as const,
        messageId: id,
        bookedResult: raw,
      })),
      onDone: opts.onMessageTaken
        ? (r) => opts.onMessageTaken!({ messageId: r.messageId ?? '', raw: r.bookedResult })
        : undefined,
    });
  }

  return makeRung<BookMeetingResult>({
    // The runtime preamble goes FIRST — the model must know what today is before it reads
    // a single instruction about booking, or it books blind (the first live call guessed
    // October and every booking failed EMPLOYEE_NOT_SCHEDULED).
    instructions: [opts.runtimePreamble, alreadyAsked, BOOK_MEETING_INSTRUCTIONS]
      .filter(Boolean)
      .join('\n\n'),
    tools: passthrough,
    completion: completions,
  });
}
