/**
 * Session-scoped tracker for what HAPPENED on a call, so the shutdown hook can
 * report it to /agent-tools/voice-session-end. Mirrors TranscriptRecorder: one
 * instance per call, mutated by the tools as the call progresses, read once at
 * teardown.
 *
 * - recordBooking(id): a booking tool succeeded → outcome 'booked' + the
 *   appointment_id to back-link the call to the appointment.
 * - recordTransfer(): the live transfer succeeded → outcome 'transferred'.
 * - recordMessage(): take_message / page_owner_via_sms succeeded → 'message'.
 *
 * Default outcome is null (unclassified) — we never fabricate one. A call that
 * does none of the three leaves outcome null rather than guessing; the post-call
 * WHY classifier (callClassify.ts) only ever runs on a null.
 *
 * PRECEDENCE: 'message' is the WEAKEST outcome — a call that takes a message and
 * then books (or transfers) is a BOOKED (or TRANSFERRED) call; the message is a
 * detail of it. So recordMessage never overwrites an existing outcome, while
 * recordBooking/recordTransfer overwrite anything (unchanged: a re-book on the
 * same call must move the appointment link, and last-write-wins between those
 * two is the pre-existing behaviour).
 *
 * WHY 'message' is recorded from the TOOL and not left to the classifier
 * (Camille, 2026-07-25): she asked for help with groceries, the agent took a
 * message, the message row was written — and the LLM classifier labelled the
 * call `wrong_service`, because groceries are indeed not a service this business
 * offers. Both statements are true; only one is the OUTCOME. When a tool has
 * already established what happened, that fact outranks a guess about it, and
 * "did a message get written" is never something we need to infer.
 */
export class CallOutcomeTracker {
  private outcome: string | null = null;
  private appointmentId: string | null = null;

  /** A booking tool returned success with this appointment_id. */
  recordBooking(appointmentId: string): void {
    this.appointmentId = appointmentId;
    this.outcome = 'booked';
  }

  /** The live cold-transfer to a human succeeded. */
  recordTransfer(): void {
    this.outcome = 'transferred';
  }

  /**
   * take_message or page_owner_via_sms persisted a message for the owner.
   * Weakest outcome: never overwrites a booking/transfer already recorded.
   */
  recordMessage(): void {
    if (this.outcome === null) this.outcome = 'message';
  }

  /** Snapshot for the session-end payload. */
  result(): { outcome: string | null; appointmentId: string | null } {
    return { outcome: this.outcome, appointmentId: this.appointmentId };
  }
}
