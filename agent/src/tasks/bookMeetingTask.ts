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
import { llm, voice } from '@livekit/agents';

export interface BookMeetingResult {
  appointmentId: string;
  /** The raw JSON the booking tool returned — the spoken time, employee, etc. */
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
  onBooked?: (r: BookMeetingResult) => Promise<void> | void;
}

export const BOOK_MEETING_INSTRUCTIONS = `Your ONE job right now is to get a meeting into the diary. Nothing else — not the details of why they are coming, not their preferences. Just the booking.

You already have their name and number. Do NOT ask for them again.

- If you do not yet know what the meeting is for, offer the services with get_service_catalog and let them choose — but if their own words already make it clear ("a meeting about a contract role", "a call with the owner"), just pass those words along; the system matches them to the right service.
- Call get_available_slots to see what is actually open. Offer ONLY the times it returns in open_times. Never state a time that is not in that list, and never refuse one that is.
- WAIT for them to CHOOSE a time. "Yeah", "okay" and "sure" are not a choice — a time is chosen only when they name one, or say something clearly tied to one ("the 4:30", "the first one"). If you did not clearly hear one of the times you offered, ASK AGAIN. Never guess, and never take the first or last option as a default.
- When they have picked, call book_with_scheduling. Confirm the ACTUAL booked time it returns, out loud.

Booking the meeting is what finishes this step. There is nothing to say or do after it — the moment it is booked, you are done here.`;

export class BookMeetingTask extends voice.AgentTask<BookMeetingResult> {
  constructor(opts: BookMeetingTaskOptions) {
    const { schedulingTools, onBooked } = opts;

    const realBooking = schedulingTools['book_with_scheduling'];
    if (!realBooking) {
      throw new Error('BookMeetingTask requires book_with_scheduling in schedulingTools');
    }

    // WRAP the real booking tool. Call it exactly as a live call would, then look at
    // what it returned: an appointment_id means the booking LANDED, and that is the only
    // thing that ends this task. The model does not get a vote — there is no "finish
    // booking" tool for it to skip or to claim it called.
    const wrappedBooking = llm.tool({
      description: (realBooking as unknown as { description: string }).description,
      parameters: (realBooking as unknown as { parameters: Record<string, unknown> }).parameters,
      execute: async (args: unknown, ctx: unknown): Promise<unknown> => {
        // DEFAULT the identity we already hold. book_with_scheduling REQUIRES a phone; the
        // caller gave it in the identity rung, so a model that omits it here should still
        // book, not ask again. (The first E2E failed exactly here.)
        const withIdentity =
          args && typeof args === 'object'
            ? {
                ...(args as Record<string, unknown>),
                phone: (args as { phone?: string }).phone || opts.knownPhone,
                name: (args as { name?: string }).name || opts.knownName,
              }
            : args;
        const raw = await (
          realBooking as unknown as { execute: (a: unknown, c: unknown) => Promise<unknown> }
        ).execute(withIdentity, ctx);

        const appointmentId = extractAppointmentId(raw);
        if (appointmentId) {
          const result: BookMeetingResult = { appointmentId, bookedResult: raw };
          await onBooked?.(result);
          this.complete(result); // ← the booking IS the transition
        }
        // Whether it booked or not, hand the tool's own words back to the model so it can
        // speak them (confirm the time, or relay why it failed and try again).
        return raw;
      },
    });

    super({
      // The runtime preamble goes FIRST — the model needs to know what today is before
      // it reads a single instruction about booking. Without it, it books blind (the
      // first live call guessed October and every booking failed EMPLOYEE_NOT_SCHEDULED).
      instructions: opts.runtimePreamble
        ? `${opts.runtimePreamble}

${BOOK_MEETING_INSTRUCTIONS}`
        : BOOK_MEETING_INSTRUCTIONS,
      tools: {
        ...schedulingTools,
        book_with_scheduling: wrappedBooking,
      },
    });
  }
}

/**
 * Pull an appointment_id out of whatever book_with_scheduling returned.
 *
 * The tool returns a JSON STRING to the LLM (`{ success: true, appointment_id: … }` on
 * success, an error shape otherwise). Parse it and read the id. Anything unparseable, or
 * any shape without an id, means "not booked" — so the task stays open, which is the
 * safe direction: a missed success just keeps trying; a false success would end the rung
 * with no meeting.
 */
function extractAppointmentId(toolResult: unknown): string | null {
  if (typeof toolResult !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolResult);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const id = (parsed as { appointment_id?: unknown }).appointment_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
