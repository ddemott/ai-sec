/**
 * Call context stamped onto an appointment's description by the voice agent.
 *
 * Two producers write these lines (src/routes/agentTools):
 *   - capture-job-inquiry appends `Job details: …` (the job summary for a meeting
 *     booked around a role)
 *   - attach-meeting-notes appends `Caller notes: …` (the caller's answer to the
 *     meeting-goals rung's wrap-up question)
 *
 * The dashboard needs to show that context WITH the meeting — but `description` also
 * carries the service/booking label the appointment views use as their headline (and,
 * in the edit panel, as the service selector). This module is the single definition of
 * the stamp prefixes and the splitter, shared by both runtimes, so the backend can
 * never stamp a line the dashboard does not recognize.
 */

export const JOB_DETAILS_PREFIX = 'Job details: ';
export const CALLER_NOTES_PREFIX = 'Caller notes: ';

/**
 * Flatten free text into the single line a stamp must be. The splitter below is
 * line-based, so a newline inside the stamped text would spill the remainder into
 * `serviceText` — the headline, and the edit panel's service field. Every stamp
 * writer passes its text through here; the model's strings are not trusted to be
 * one line.
 */
export function toStampText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export interface SplitDescription {
  /** The description with the call-context lines removed — the service/booking label
   *  the views were already using as the headline. */
  serviceText: string;
  /** The stamped call-context lines ("Job details: …", "Caller notes: …"), in the
   *  order they were written. Empty for appointments with no call context. */
  callContext: string[];
}

/** Split an appointment description into its headline and the voice-call context. */
export function splitCallContext(description?: string | null): SplitDescription {
  const callContext: string[] = [];
  const rest: string[] = [];
  for (const line of (description ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(JOB_DETAILS_PREFIX) || trimmed.startsWith(CALLER_NOTES_PREFIX)) {
      callContext.push(trimmed);
    } else {
      rest.push(line);
    }
  }
  return { serviceText: rest.join('\n').trim(), callContext };
}
