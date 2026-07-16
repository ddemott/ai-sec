/**
 * RUNG 4 — CHANGE AN EXISTING APPOINTMENT (cancel or reschedule).
 *
 * The first LOOKUP-THEN-ACT rung, and the first with more than one way to finish. The
 * three rungs before it each do ONE write (identity confirms, book books, intake records).
 * This one reads first — get_my_appointments — reads the options back so the caller can say
 * WHICH appointment they mean, and only then cancels or moves it. Same guarantee as the
 * others: the mutation IS the completion (the rung ends the instant cancel_appointment or
 * reschedule_appointment returns its appointment_id), so the model cannot end the rung by
 * SAYING it canceled something.
 *
 * Why it is still just an ACTION rung (see rung.ts): the read tool is a passthrough; the
 * COMPLETIONS are the two mutations. It passes THREE completions, because a manage call has
 * three honest endings:
 *   - cancel_appointment succeeds   → canceled
 *   - reschedule_appointment succeeds → rescheduled
 *   - no_appointment_change          → nothing to change (they have none upcoming, or they
 *                                       looked and decided not to). Without this third exit a
 *                                       caller with no appointment would HANG the loop — the
 *                                       rung could never complete. It is deliberately narrow
 *                                       (the instructions say when it is allowed) so it does
 *                                       not become a way for the model to skip the work.
 *
 * Phone: get_my_appointments / cancel / reschedule look up BY the caller's number. On a
 * spoken-number call that is ctx.spokenPhone, which the identity rung set and which those
 * tools now fall back to (booking already trusts the same number) — so a forwarded-line
 * caller can manage their own appointment, which before they simply could not.
 */
import { type llm, type voice } from '@livekit/agents';
import { makeRung, idExtractor } from './rung.js';

export interface ScheduleChangeResult {
  action: 'canceled' | 'rescheduled' | 'none';
  /** The appointment that changed. Absent when action is 'none'. */
  appointmentId?: string;
  raw: unknown;
}

export interface ScheduleChangeTaskOptions {
  /** The manage tools from buildTools(): get_my_appointments, cancel_appointment,
   *  reschedule_appointment, and get_available_slots (to find a new time on a reschedule). */
  manageTools: llm.ToolContext;
  /** The caller identity from the identity rung — the manage tools look up by this number. */
  knownCaller?: string;
  /** Date + hours, so a reschedule resolves "tomorrow" and does not offer a closed time. */
  runtimePreamble?: string;
  onChanged?: (r: ScheduleChangeResult) => Promise<void> | void;
}

export const SCHEDULING_INSTRUCTIONS = `The caller wants to change an appointment they already have — cancel it, or move it to a different time. You already have their name and number; do NOT ask for them again.

Start by calling get_my_appointments to see what they actually have booked. Read the options back plainly so they can tell you WHICH one they mean ("you have a Programming Consultation on Thursday at 2 PM — is that the one?"). Never act on an appointment until they have clearly identified which.

- To CANCEL: once they confirm which appointment, your VERY NEXT action is to CALL cancel_appointment with that appointment_id — call it BEFORE you say it is canceled. Only calling the tool cancels it; saying "that's canceled" without calling it changes nothing. Then confirm it is done, in one short natural sentence.
- To RESCHEDULE: once they confirm which appointment, find them a new time — call get_available_slots and offer only the times it returns. WAIT for them to choose one (a named time, not "yeah" or "sure"). Then your VERY NEXT action is to CALL reschedule_appointment with the appointment_id and the new start and end time — before you say it is moved. Then confirm the new time, in one short natural sentence.

If get_my_appointments shows they have NOTHING upcoming, tell them that plainly and call no_appointment_change. If they look at their appointments and decide they do not want to change anything after all, also call no_appointment_change. Do not invent a change they did not ask for, and do not book a brand-new appointment here — that is a different step.

Speak like a person on a phone call: no bulleted lists, no field labels, no markdown.`;

/**
 * Build the scheduling rung. Reused tools, three honest endings, every rung guarantee
 * (onEnter, ttsNode, completion-in-a-tool) inherited from makeRung.
 */
export function makeSchedulingRung(
  opts: ScheduleChangeTaskOptions
): voice.AgentTask<ScheduleChangeResult> {
  const { manageTools, onChanged } = opts;

  const getMine = manageTools['get_my_appointments'];
  const cancel = manageTools['cancel_appointment'];
  const reschedule = manageTools['reschedule_appointment'];
  if (!getMine || !cancel || !reschedule) {
    throw new Error(
      'makeSchedulingRung requires get_my_appointments, cancel_appointment, reschedule_appointment'
    );
  }

  // Passthrough tools the model needs to REACH a mutation: the read (which appointment?)
  // and the slot finder (a new time, on a reschedule). The mutations themselves are the
  // completions below, so they are NOT listed here (makeRung adds them).
  const passthrough: llm.ToolContext = { get_my_appointments: getMine };
  if (manageTools['get_available_slots']) {
    passthrough['get_available_slots'] = manageTools['get_available_slots'];
  }

  return makeRung<ScheduleChangeResult>({
    instructions: [opts.runtimePreamble, opts.knownCaller, SCHEDULING_INSTRUCTIONS]
      .filter(Boolean)
      .join('\n\n'),
    tools: passthrough,
    completion: [
      {
        kind: 'action',
        toolName: 'cancel_appointment',
        realTool: cancel,
        extract: idExtractor('appointment_id', (id, raw) => ({
          action: 'canceled' as const,
          appointmentId: id,
          raw,
        })),
        onDone: onChanged,
      },
      {
        kind: 'action',
        toolName: 'reschedule_appointment',
        realTool: reschedule,
        extract: idExtractor('appointment_id', (id, raw) => ({
          action: 'rescheduled' as const,
          appointmentId: id,
          raw,
        })),
        onDone: onChanged,
      },
      {
        kind: 'collect',
        toolName: 'no_appointment_change',
        description:
          'Call this ONLY when get_my_appointments showed the caller has no upcoming appointment to change, OR when they looked at their appointments and decided not to change anything. It ends this step with no change made. Do NOT call it to skip work the caller actually asked for.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        build: (): ScheduleChangeResult => ({ action: 'none', raw: null }),
        ack: 'No problem.',
        onDone: onChanged,
      },
    ],
  });
}
